"""Audio Lab DSP: the whole tabla/lehra pipeline in one module.

Everything that touches audio lives here; the web layer (server.py, worker.py)
only calls run_pipeline().  Nothing in this file can hear: every claim it makes
is a measurement (loudness, peak, band energy, pitch, tempo), and the numbers
that shape the sound (the EQ values below) are starting points to be judged by
ear, not facts.

Pipeline (run_pipeline), in order
  1  decode everything to 48 kHz stereo float32 with ffmpeg (video stream untouched)
  2  analyse: LUFS, peaks, clipping, noise floor, 8 band energies, hum, rhythm, dayan pitch
  3  optional: Demucs drums stem (when the upload is a full song)
  4  repair: declip, mains-hum notch, conservative stationary noise reduction
  5  tabla chain (adaptive EQ, gate, compressor, small room)
  6  lehra chain, loop, pitch/tempo/offset alignment, LUFS-relative level, ducking
  7  per variant: bass/saturation or soft highs, master chain, loudness iteration
  8  optional reference match (matchering)
  9  quality gates, exports (24-bit WAV, MP3, AAC, MP4 with the new audio), report

Conventions
  * audio arrays are float32, shape (frames, channels), 48 kHz, stereo
  * "dB" band levels are relative to the signal's total power ("dBr") so that
    a louder or quieter file has the same shape
  * every external program is run with an argument list, never through a shell,
    and never with a user-supplied file name (the server stores uploads under
    names it chose itself)
"""
from __future__ import annotations

import functools
import importlib.util
import json
import math
import os
import re
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Optional

import numpy as np
import scipy.signal as sps
import soundfile as sf

SR = 48000

# ── Lazy-loader stubs ────────────────────────────────────────────────────────
# librosa builds its namespace from .pyi files (lazy_loader.attach_stub), and
# Vercel's function bundle leaves *.pyi out, so `import librosa` failed there.
# Copies of librosa's own stubs (the pinned 0.10.2.post1, ISC licence) are kept
# in lazy_stubs/ as .txt and used only when a package's stub is missing.
LAZY_STUBS = Path(__file__).resolve().parent / "lazy_stubs"


def use_bundled_lazy_stubs() -> None:
    try:
        import lazy_loader
    except ImportError:
        return
    original = getattr(lazy_loader.attach_stub, "__wrapped__", lazy_loader.attach_stub)

    def attach_stub(package_name: str, filename: str):
        stub = filename if filename.endswith("i") else f"{os.path.splitext(filename)[0]}.pyi"
        ours = LAZY_STUBS / f"{package_name}.pyi.txt"
        if not os.path.exists(stub) and ours.exists():
            import tempfile
            copy = Path(tempfile.gettempdir()) / "audio-lab-stubs" / f"{package_name}.pyi"
            copy.parent.mkdir(parents=True, exist_ok=True)
            copy.write_text(ours.read_text(encoding="utf-8"), encoding="utf-8")
            stub = str(copy)                     # attach_stub reads a filename ending in "i" as the stub itself
        return original(package_name, stub)

    attach_stub.__wrapped__ = original
    lazy_loader.attach_stub = attach_stub


use_bundled_lazy_stubs()

# pedalboard's native module needs libatomic.so.1, which Vercel's runtime image
# lacks; a copy is in native/ (see native/README.md). Loaded globally, it then
# satisfies pedalboard's dependency by its soname.
NATIVE = Path(__file__).resolve().parent / "native"


def preload_libatomic() -> Optional[str]:
    """Which libatomic is loaded: "system", "bundled", or None (not Linux, or not found)."""
    if not sys.platform.startswith("linux"):
        return None
    import ctypes
    try:
        ctypes.CDLL("libatomic.so.1", mode=ctypes.RTLD_GLOBAL)
        return "system"
    except OSError:
        pass
    bundled = NATIVE / "libatomic.so.1"
    if not bundled.exists():
        return None
    ctypes.CDLL(str(bundled), mode=ctypes.RTLD_GLOBAL)
    return "bundled"


preload_libatomic()

# ── Constants ────────────────────────────────────────────────────────────────

# Integrated loudness each destination normalises to ("custom" uses JobOptions.custom_lufs)
TARGETS = {"reel": -14.0, "youtube": -14.0, "loud": -11.0, "spotify": -14.0, "apple": -16.0, "podcast": -16.0, "custom": None}
LOUDNESS_TOLERANCE_LU = 0.3
TRUE_PEAK_CEILING_DBTP = -1.0
MAX_BAND_TILT_DB = 6.0
DURATION_TOLERANCE_S = 0.05
WORKING_LEVEL_LUFS = -20.0       # the tabla is brought here first so the fixed thresholds below mean something
MIN_SECONDS = 1.0
CLIP_LEVEL = 0.999
MIN_CREST_DB = 10.0            # peak-to-average of the master; below this the strokes are being flattened
MIN_DAYAN_SUPPORT = 0.35        # below this share of the voiced frames in one pitch class, the dayan's pitch is not trusted
EQ_CLAMP_DB = 4.0
LIMITER_RELEASE_DB_PER_MS = 0.05   # how fast the limiter lets go after a peak
EQ_STRENGTHS = (1.0, 0.5, 0.2)   # tried in turn when a pass moves a band more than the tilt gate allows

BANDS = [  # name, low Hz, high Hz
    ("sub", 20, 60),
    ("bayan", 60, 120),
    ("low_mid", 120, 250),
    ("mud", 250, 500),
    ("mid", 500, 2000),
    ("attack", 2000, 5000),
    ("brilliance", 5000, 10000),
    ("air", 10000, 24000),
]
BAND_NAMES = [b[0] for b in BANDS]

VARIANTS = {
    "balanced": {
        "label": "Balanced",
        "description": "The measured fix, nothing extra.",
        "bayan_db": 0.0, "saturation": 0.0, "soft_highs_db": 0.0,
    },
    "phone_bass": {
        "label": "Phone + bass",
        "description": "Bayan +2 dB and mild saturation, so the bass still reads on a phone speaker.",
        "bayan_db": 2.0, "saturation": 0.22, "soft_highs_db": 0.0,
    },
    "soft_highs": {
        "label": "Soft highs",
        "description": "High shelf −3 dB from 3.2 kHz for a gentler top end.",
        "bayan_db": 0.0, "saturation": 0.0, "soft_highs_db": -3.0,
    },
}
DEFAULT_VARIANT = "phone_bass"
SOFT_HIGHS_HZ = 3200.0   # chosen from the measured gap between the user's own "Mastered" and "softer highs" files

ALLOWED_FORMATS = {
    "mov,mp4,m4a,3gp,3g2,mj2", "mp3", "wav", "flac", "ogg", "matroska,webm", "aac",
    "avi", "aiff", "w64", "caf", "amr", "asf",
}

# Starting values per instrument; adaptive_eq() scales the gains from the analysis.
#   low_shelf (Hz, dB) · mud/box/attack (Hz, dB, Q) · air (Hz, dB)
#   gate (threshold dB, ratio, release ms) or None · comp (threshold dB, ratio, attack ms, release ms)
#   percussive: strokes, so the dayan-ring check, stroke analysis and the gate apply
# The tabla values are the user's own tested chain (tools/tabla_mix.py); the others
# are conventional starting points for those instruments, to be judged by ear.
PROFILES = {
    "tabla": {
        "label": "Tabla", "hpf_hz": 35.0, "low_shelf": (110.0, 1.5), "mud": (320.0, -2.5, 1.0),
        "box": (900.0, -1.0, 1.2), "attack": (3500.0, 2.0, 0.9), "air": (9000.0, 1.0),
        "gate": (-55.0, 1.6, 250.0), "comp": (-18.0, 2.5, 12.0, 120.0), "percussive": True, "low_word": "bayan",
    },
    "pakhawaj": {
        "label": "Pakhawaj", "hpf_hz": 30.0, "low_shelf": (90.0, 2.0), "mud": (350.0, -2.5, 1.0),
        "box": (800.0, -1.0, 1.2), "attack": (3000.0, 1.5, 0.9), "air": (8000.0, 0.5),
        "gate": (-55.0, 1.6, 300.0), "comp": (-18.0, 2.5, 15.0, 150.0), "percussive": True, "low_word": "bass head",
    },
    "kathak": {   # tabla with ghungroo: keep the bells' shimmer, gate gently so footwork survives
        "label": "Kathak (tabla + ghungroo)", "hpf_hz": 35.0, "low_shelf": (110.0, 1.5), "mud": (320.0, -2.5, 1.0),
        "box": (900.0, -1.0, 1.2), "attack": (3500.0, 1.5, 0.9), "air": (10000.0, 1.5),
        "gate": (-60.0, 1.3, 300.0), "comp": (-18.0, 2.0, 15.0, 150.0), "percussive": True, "low_word": "bayan",
    },
    "vocal": {
        "label": "Vocal", "hpf_hz": 80.0, "low_shelf": (150.0, -1.0), "mud": (300.0, -2.0, 1.0),
        "box": (1000.0, -0.5, 1.2), "attack": (3000.0, 2.0, 1.0), "air": (10000.0, 1.5),
        "gate": None, "comp": (-20.0, 3.0, 8.0, 120.0), "percussive": False, "low_word": "low end",
    },
    "harmonium": {
        "label": "Harmonium", "hpf_hz": 60.0, "low_shelf": (150.0, 0.0), "mud": (350.0, -2.0, 1.0),
        "box": (1200.0, -1.5, 1.4), "attack": (3000.0, 1.0, 0.9), "air": (9000.0, 0.5),
        "gate": None, "comp": (-20.0, 2.0, 20.0, 200.0), "percussive": False, "low_word": "low end",
    },
    "sitar": {
        "label": "Sitar", "hpf_hz": 60.0, "low_shelf": (120.0, 1.0), "mud": (300.0, -1.5, 1.0),
        "box": (800.0, -1.0, 1.2), "attack": (2500.0, 1.5, 0.9), "air": (10000.0, 1.0),
        "gate": None, "comp": (-20.0, 2.0, 25.0, 250.0), "percussive": False, "low_word": "low end",
    },
}
BASE_EQ = PROFILES["tabla"]

# Algorithmic rooms (pedalboard's Freeverb): room size, damping, wet, dry, width
REVERBS = {
    "none": None,
    "room": (0.18, 0.6, 0.06, 0.94, 0.8),
    "hall": (0.55, 0.45, 0.11, 0.9, 1.0),
    "temple": (0.85, 0.3, 0.16, 0.86, 1.0),
}


class AudioLabError(Exception):
    """A problem the user can act on (bad file, silent recording …)."""

    def __init__(self, code: str, message: str, status: int = 422):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status


ProgressFn = Callable[[str, float, str], None]


def _noop_progress(stage: str, fraction: float, message: str) -> None:
    return None


# ── Options ──────────────────────────────────────────────────────────────────

@dataclass
class JobOptions:
    # loudness and tone
    target: str = "reel"                 # see TARGETS
    custom_lufs: float = -14.0           # used when target == "custom"
    profile: str = "tabla"               # see PROFILES
    reverb: str = "room"                 # see REVERBS
    brightness_db: float = 0.0           # extra high shelf on the master, −3…+3
    bass_db: float = 0.0                 # extra low shelf on the master, −3…+3
    variants: tuple = ("balanced", "phone_bass", "soft_highs")
    # repair
    denoise: str = "auto"                # auto | on | off
    hum_removal: str = "auto"            # auto | off
    noise_region: Optional[tuple] = None  # (start, end) s of a noise-only stretch to learn from
    separate_drums: bool = False         # the upload is a full song: extract the drums first
    # edits
    trim_start: Optional[float] = None   # seconds into the upload
    trim_end: Optional[float] = None
    fade_in_ms: float = 0.0
    fade_out_ms: float = 0.0
    shift_cents: float = 0.0             # move the whole recording (e.g. onto an exact Sa)
    tempo_factor: float = 1.0            # >1 faster; the video cannot follow, so no MP4 then
    # lehra, tanpura, vocal
    lehra_db: float = -7.0               # lehra loudness relative to the tabla (LU)
    offset_seconds: Optional[float] = None   # None = detect
    match_pitch: bool = False            # shift the lehra to the dayan if it is > 20 cents off
    match_tempo: bool = False            # stretch the lehra to the tabla's tempo if close
    lehra_meta: Optional[dict] = None    # {"bpm", "beats"} when the lehra came from the site's catalogue (it starts on sam)
    sa_hz: Optional[float] = None        # the Sa for the tanpura and the tuning check
    tanpura_db: Optional[float] = None   # a tanpura bed this many LU under the tabla; None = none
    vocal_db: float = 0.0                # the vocal track against the tabla (LU)
    vocal_offset: float = 0.0            # seconds to move the vocal track later (+) or earlier (−)
    # output
    export_mp4: bool = True
    video_format: str = "original"       # original | vertical (9:16) | square
    title: str = ""                      # drawn on the video, lower third
    audio_video: bool = False            # make a waveform video for an audio-only upload
    ab_clip: bool = False                # a before/after clip to share

    @classmethod
    def from_dict(cls, raw: Optional[dict]) -> "JobOptions":
        raw = dict(raw or {})
        o = cls()

        def num(key, lo, hi, default):
            v = raw.get(key, default)
            if v is None:
                return default
            if isinstance(v, bool):
                raise AudioLabError("bad_option", f"“{key}” must be a number.", 400)
            try:
                v = float(v)
            except (TypeError, ValueError):
                raise AudioLabError("bad_option", f"“{key}” must be a number.", 400)
            if not math.isfinite(v):
                raise AudioLabError("bad_option", f"“{key}” must be a finite number.", 400)
            return min(hi, max(lo, v))

        def optional(key, lo, hi):
            v = raw.get(key)
            return None if v in (None, "", "auto") else num(key, lo, hi, None)

        def choice(key, allowed, default):
            v = raw.get(key, default)
            if v not in allowed:
                raise AudioLabError("bad_option", f"“{key}” must be one of {', '.join(allowed)}.", 400)
            return v

        o.target = choice("target", tuple(TARGETS), o.target)
        o.custom_lufs = num("custom_lufs", -24.0, -8.0, o.custom_lufs)
        o.profile = choice("profile", tuple(PROFILES), o.profile)
        o.reverb = choice("reverb", tuple(REVERBS), o.reverb)
        o.brightness_db = num("brightness_db", -3.0, 3.0, o.brightness_db)
        o.bass_db = num("bass_db", -3.0, 3.0, o.bass_db)
        o.denoise = choice("denoise", ("auto", "on", "off"), o.denoise)
        o.hum_removal = choice("hum_removal", ("auto", "off"), o.hum_removal)
        region = raw.get("noise_region")
        if region not in (None, "", []):
            if not (isinstance(region, (list, tuple)) and len(region) == 2):
                raise AudioLabError("bad_option", "“noise_region” must be [start, end] in seconds.", 400)
            try:
                a, b = float(region[0]), float(region[1])
            except (TypeError, ValueError):
                raise AudioLabError("bad_option", "“noise_region” must be [start, end] in seconds.", 400)
            if not (math.isfinite(a) and math.isfinite(b) and 0 <= a and b - a >= 0.2):
                raise AudioLabError("bad_option", "Mark at least 0.2 s of noise to learn from.", 400)
            o.noise_region = (a, b)
        o.trim_start = optional("trim_start", 0.0, 86400.0)
        o.trim_end = optional("trim_end", 0.0, 86400.0)
        if o.trim_start is not None and o.trim_end is not None and o.trim_end - o.trim_start < 1.0:
            raise AudioLabError("bad_option", "Keep at least one second when trimming.", 400)
        o.fade_in_ms = num("fade_in_ms", 0.0, 5000.0, o.fade_in_ms)
        o.fade_out_ms = num("fade_out_ms", 0.0, 10000.0, o.fade_out_ms)
        o.shift_cents = num("shift_cents", -300.0, 300.0, o.shift_cents)
        o.tempo_factor = num("tempo_factor", 0.75, 1.25, o.tempo_factor)
        o.lehra_db = num("lehra_db", -20.0, 0.0, o.lehra_db)
        # up to half a long lehra either way: the sync editor sends the offset modulo the lehra's length
        o.offset_seconds = optional("offset_seconds", -3600.0, 3600.0)
        meta = raw.get("lehra_meta")
        if meta:
            if not isinstance(meta, dict):
                raise AudioLabError("bad_option", "“lehra_meta” must be an object.", 400)
            try:
                bpm, beats = float(meta.get("bpm")), int(meta.get("beats"))
            except (TypeError, ValueError):
                raise AudioLabError("bad_option", "“lehra_meta” needs bpm and beats.", 400)
            if not (20 <= bpm <= 600 and 2 <= beats <= 64):
                raise AudioLabError("bad_option", "“lehra_meta” bpm or beats out of range.", 400)
            o.lehra_meta = {"bpm": bpm, "beats": beats, "cycle_seconds": beats * 60.0 / bpm,
                            "name": str(meta.get("name", ""))[:120]}
        o.sa_hz = optional("sa_hz", 60.0, 500.0)
        o.tanpura_db = optional("tanpura_db", -30.0, 0.0)
        o.vocal_db = num("vocal_db", -20.0, 10.0, o.vocal_db)
        o.vocal_offset = num("vocal_offset", -30.0, 30.0, o.vocal_offset)
        for key in ("separate_drums", "match_pitch", "match_tempo", "export_mp4", "audio_video", "ab_clip"):
            setattr(o, key, bool(raw.get(key, getattr(o, key))))
        o.video_format = choice("video_format", ("original", "vertical", "square"), o.video_format)
        title = raw.get("title") or ""
        if not isinstance(title, str):
            raise AudioLabError("bad_option", "“title” must be text.", 400)
        o.title = re.sub(r"[\x00-\x1f\x7f]", " ", title).strip()[:80]
        wanted = raw.get("variants")
        if wanted:
            if not isinstance(wanted, (list, tuple)) or any(v not in VARIANTS for v in wanted):
                raise AudioLabError("bad_option", "“variants” must be a list of known variants.", 400)
            o.variants = tuple(dict.fromkeys(wanted))
        return o

    @property
    def target_lufs(self) -> float:
        return self.custom_lufs if self.target == "custom" else TARGETS[self.target]

    @property
    def percussive(self) -> bool:
        return PROFILES[self.profile]["percussive"]


@dataclass
class JobSpec:
    tabla: Path
    out_dir: Path
    lehra: Optional[Path] = None
    reference: Optional[Path] = None
    recorder: Optional[Path] = None      # better audio of the same performance, to sync to the video
    vocal: Optional[Path] = None         # a vocal track to mix in
    options: JobOptions = field(default_factory=JobOptions)
    display_name: str = "recording"


# ── Small numeric helpers ────────────────────────────────────────────────────

def db(x: float, floor: float = -200.0) -> float:
    """20·log10 of an amplitude, never −inf."""
    return max(floor, 20.0 * math.log10(max(float(x), 1e-10)))


def from_db(x: float) -> float:
    return 10.0 ** (x / 20.0)


def to_mono(x: np.ndarray) -> np.ndarray:
    return x.mean(axis=1) if x.ndim == 2 else x


def _frames_rms(mono: np.ndarray, size: int, hop: int) -> np.ndarray:
    if len(mono) < size:
        return np.array([float(np.sqrt(np.mean(mono ** 2))) if len(mono) else 0.0])
    n = 1 + (len(mono) - size) // hop
    idx = np.arange(size)[None, :] + hop * np.arange(n)[:, None]
    return np.sqrt(np.mean(mono[idx].astype(np.float64) ** 2, axis=1))


def _clean(obj):
    """JSON-safe copy: numpy → Python, ±inf/NaN → None."""
    if isinstance(obj, dict):
        return {str(k): _clean(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_clean(v) for v in obj]
    if isinstance(obj, np.ndarray):
        return _clean(obj.tolist())
    if isinstance(obj, (np.floating, float)):
        v = float(obj)
        return v if math.isfinite(v) else None
    if isinstance(obj, np.integer):
        return int(obj)
    if isinstance(obj, np.bool_):
        return bool(obj)
    if isinstance(obj, Path):
        return obj.name
    return obj


def _board(*plugins):
    from pedalboard import Pedalboard
    return Pedalboard([p for p in plugins if p is not None])


def apply_board(board, x: np.ndarray, sr: int = SR) -> np.ndarray:
    """Run a pedalboard on (frames, channels) audio."""
    y = board(np.ascontiguousarray(x.T, dtype=np.float32), sr)
    return np.ascontiguousarray(y.T, dtype=np.float32)


# ── ffmpeg / ffprobe ─────────────────────────────────────────────────────────

def _bundled_ffmpeg() -> Optional[str]:
    """The static ffmpeg of the imageio-ffmpeg package (how the serverless build gets one).

    A function bundle is read-only and may lose the executable bit; then a copy
    goes to the temporary folder once and is made executable there.
    """
    global _BUNDLED
    if _BUNDLED is not None:
        return _BUNDLED or None
    _BUNDLED = ""
    try:
        import imageio_ffmpeg
        exe = imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:                                  # noqa: BLE001 — not installed, or no binary for this platform
        return None
    if exe and not os.access(exe, os.X_OK):
        import stat
        import tempfile
        copy = Path(tempfile.gettempdir()) / "audio-lab-ffmpeg"
        if not os.access(copy, os.X_OK):
            shutil.copyfile(exe, copy)
            copy.chmod(copy.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
        exe = str(copy)
    _BUNDLED = exe or ""
    return exe or None


_BUNDLED: Optional[str] = None


def _find_binary(name: str) -> Optional[str]:
    path = os.environ.get(f"AUDIO_LAB_{name.upper()}") or shutil.which(name)
    if not path and name == "ffmpeg":
        path = _bundled_ffmpeg()
    return path


def _binary(name: str) -> str:
    path = _find_binary(name)
    if not path:
        raise AudioLabError("no_ffmpeg", f"{name} is not installed on the server.", 500)
    return path


def _run(cmd: list, timeout: float = 600) -> subprocess.CompletedProcess:
    """Run a program with an argument list (never a shell string)."""
    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    try:
        return subprocess.run(cmd, capture_output=True, timeout=timeout, check=False,
                              stdin=subprocess.DEVNULL, creationflags=flags)
    except subprocess.TimeoutExpired:
        raise AudioLabError("timeout", f"{Path(cmd[0]).stem} took too long.", 504)


_CHANNEL_LAYOUTS = {"mono": 1, "stereo": 2, "2.1": 3, "3.0": 3, "quad": 4, "4.0": 4, "5.0": 5, "5.1": 6, "6.1": 7, "7.1": 8}


def _probe_with_ffmpeg(path: Path) -> dict:
    """ffprobe's answer, read from `ffmpeg -i` instead — for a server that has ffmpeg but no ffprobe.

    Only the fields probe() uses: the container's format name and duration, and
    per stream its type, codec, sample rate, channels and whether a video stream
    is cover art.  ffmpeg prints the duration to the centisecond.
    """
    cmd = [_binary("ffmpeg"), "-nostdin", "-hide_banner", "-protocol_whitelist", "file", "-i", str(path)]
    r = _run(cmd, timeout=60)                       # exits 1 ("no output file"): the header is what we want
    text = r.stderr.decode("utf-8", "replace")
    m = re.search(r"^Input #0, (.+?), from '", text, re.M)
    if not m:
        return {}
    fmt: dict = {"format_name": m.group(1)}
    d = re.search(r"^\s*Duration: (\d+):(\d\d):(\d\d(?:\.\d+)?)", text, re.M)
    if d:
        fmt["duration"] = str(int(d.group(1)) * 3600 + int(d.group(2)) * 60 + float(d.group(3)))
    streams = []
    for line in re.findall(r"^\s*Stream #0:\d+.*$", text, re.M):
        s = re.search(r": (Audio|Video): ([A-Za-z0-9_]+)", line)
        if not s:
            continue
        stream: dict = {"codec_type": s.group(1).lower(), "codec_name": s.group(2)}
        if stream["codec_type"] == "audio":
            hz = re.search(r", (\d+) Hz", line)
            if hz:
                stream["sample_rate"] = hz.group(1)
            ch = re.search(r" Hz, ([^,]+)", line)
            if ch:
                layout = ch.group(1).strip()
                n = re.match(r"(\d+) channels?", layout)
                stream["channels"] = int(n.group(1)) if n else _CHANNEL_LAYOUTS.get(layout.split("(")[0], 2)
        elif "(attached pic)" in line:
            stream["disposition"] = {"attached_pic": 1}
        streams.append(stream)
    return {"format": fmt, "streams": streams}


def probe(path: Path) -> dict:
    """What ffprobe says about a file; raises AudioLabError if it is not usable audio/video."""
    if _find_binary("ffprobe"):
        cmd = [_binary("ffprobe"), "-v", "error", "-protocol_whitelist", "file",
               "-print_format", "json", "-show_format", "-show_streams", str(path)]
        r = _run(cmd, timeout=60)
        if r.returncode != 0:
            raise AudioLabError("unreadable", "That file could not be read as audio or video.", 415)
        try:
            data = json.loads(r.stdout.decode("utf-8", "replace"))
        except ValueError:
            raise AudioLabError("unreadable", "That file could not be read as audio or video.", 415)
    else:
        data = _probe_with_ffmpeg(path)
        if not data:
            raise AudioLabError("unreadable", "That file could not be read as audio or video.", 415)
    fmt = data.get("format", {})
    if fmt.get("format_name") not in ALLOWED_FORMATS:
        raise AudioLabError("unsupported", "That file type is not supported. Use WAV, MP3, M4A, AAC, FLAC, OGG, MP4 or MOV.", 415)
    streams = data.get("streams", [])
    audio = next((s for s in streams if s.get("codec_type") == "audio"), None)
    if audio is None:
        raise AudioLabError("no_audio", "That file has no audio track.", 422)
    video = next((s for s in streams if s.get("codec_type") == "video"
                  and not s.get("disposition", {}).get("attached_pic")), None)
    duration = float(fmt.get("duration") or audio.get("duration") or 0)
    return {
        "duration_s": duration,
        "format": fmt.get("format_name"),
        "audio_codec": audio.get("codec_name"),
        "sample_rate": int(audio.get("sample_rate") or 0),
        "channels": int(audio.get("channels") or 0),
        "has_video": video is not None,
        "video_codec": video.get("codec_name") if video else None,
    }


def decode_audio(path: Path, sr: int = SR) -> np.ndarray:
    """Decode the first audio track to float32 (frames, 2) at `sr`."""
    cmd = [_binary("ffmpeg"), "-nostdin", "-hide_banner", "-loglevel", "error", "-protocol_whitelist", "file",
           "-i", str(path), "-map", "0:a:0", "-vn", "-ac", "2", "-ar", str(sr), "-f", "f32le", "-"]
    r = _run(cmd, timeout=900)
    if r.returncode != 0 or not r.stdout:
        raise AudioLabError("decode_failed", "The audio in that file could not be decoded.", 415)
    x = np.frombuffer(r.stdout, dtype="<f4").reshape(-1, 2).copy()
    return np.nan_to_num(x, nan=0.0, posinf=0.0, neginf=0.0)


# ── Measurements ─────────────────────────────────────────────────────────────

@functools.lru_cache(maxsize=4)
def _k_weighting(sr: int) -> np.ndarray:
    """pyloudnorm's own K-weighting stages for this rate, as one cascade of second-order sections."""
    import pyloudnorm as pyln
    return np.array([np.concatenate([f.passband_gain * np.asarray(f.b, dtype=np.float64), f.a])
                     for f in pyln.Meter(sr)._filters.values()])


_LUFS_GAINS = (1.0, 1.0, 1.0, 1.41, 1.41)      # BS.1770 channel weights: L, R, C, Ls, Rs


def measure_lufs(x: np.ndarray, sr: int = SR) -> float:
    """Integrated loudness (ITU-R BS.1770-4, gated).  −inf for silence.

    pyloudnorm's meter step for step (its filters, block bounds and gates; a test holds the two to
    1e-6 LU), with its two filter passes run as one cascade and its per-block Python loop as one
    array operation: the pipeline measures loudness dozens of times per run.
    """
    if len(x) < int(0.45 * sr):
        ms = float(np.mean(x.astype(np.float64) ** 2) * x.shape[1]) if len(x) else 0.0
        return -0.691 + 10 * math.log10(ms) if ms > 0 else -math.inf
    x = x[:, None] if x.ndim == 1 else x
    n, channels = x.shape
    if channels > len(_LUFS_GAINS):
        return -math.inf
    y = sps.sosfilt(_k_weighting(sr), np.ascontiguousarray(x.T, dtype=np.float64), axis=1)    # (channels, frames)
    t_g, step = 0.400, 1.0 - 0.75                  # 400 ms blocks, 75 % overlap
    blocks = int(np.round((n / sr - t_g) / (t_g * step))) + 1
    j = np.arange(blocks)
    lo = np.minimum((t_g * (j * step) * sr).astype(np.int64), n)
    hi = np.minimum((t_g * (j * step + 1) * sr).astype(np.int64), n)
    sq = np.zeros((channels, n + 1))               # the extra zero lets the last bound be a valid index
    np.square(y, out=sq[:, :n])
    bounds = np.empty(2 * blocks, dtype=np.int64)
    bounds[0::2], bounds[1::2] = lo, hi
    sums = np.add.reduceat(sq, bounds, axis=1)[:, 0::2]          # sq[lo:hi] per block (odd slots are gaps)
    sums[:, lo >= hi] = 0.0
    z = (1.0 / (t_g * sr)) * sums
    g = np.array(_LUFS_GAINS[:channels])[:, None]
    with np.errstate(divide="ignore", invalid="ignore"):
        level = -0.691 + 10.0 * np.log10((g * z).sum(axis=0))
        gated = level >= -70.0                     # the absolute gate
        if not gated.any():
            return -math.inf
        relative = -0.691 + 10.0 * np.log10((g[:, 0] * z[:, gated].mean(axis=1)).sum()) - 10.0
        gated = (level > relative) & (level > -70.0)
        if not gated.any():
            return -math.inf
        v = float(-0.691 + 10.0 * np.log10((g[:, 0] * z[:, gated].mean(axis=1)).sum()))
    return v if math.isfinite(v) else -math.inf


def sample_peak_db(x: np.ndarray) -> float:
    return db(np.max(np.abs(x))) if len(x) else -200.0


_OS_BLOCK = 1 << 15      # frames per block of the oversampled peak scan (small enough to stay in the CPU cache)
_OS_TAPS = 10            # input samples each side that resample_poly's 4× filter reaches


@functools.lru_cache(maxsize=1)
def _os_phases() -> np.ndarray:
    """The filter resample_poly(x, 4, 1) designs for float32 input, split into its four phases (rows).

    Output sample 4q + p of the oversampled signal is phase p's 21 taps run over input samples
    q − 10 … q + 10, so each phase is an ordinary short convolution.
    """
    h =sps.firwin(2 * 4 * _OS_TAPS + 1, 1.0 / 4, window=("kaiser", 5.0)).astype(np.float32) * 4
    k = np.zeros((4, 2 * _OS_TAPS + 1), dtype=np.float32)
    for p in range(4):
        for d in range(-_OS_TAPS, _OS_TAPS + 1):
            i = 4 * d + p + 4 * _OS_TAPS
            if 0 <= i < len(h):
                k[p, d + _OS_TAPS] = h[i]
    return k


def oversampled_peaks(x: np.ndarray) -> np.ndarray:
    """Per frame, the largest |sample| of the 4×-oversampled signal over all channels.

    The same numbers as resample_poly(x, 4, 1) over the whole recording (a test holds them to 1e-6),
    worked out phase by phase in blocks: about 4× faster, and memory for one block instead of four
    copies of the recording.  Phase 0 is the input itself (its other taps are ~1e-17), scaled by its
    centre tap; phases 1–3 are 21-tap convolutions.  The true peak is measured dozens of times per
    run (the limiter, every check), so this was the slowest step of a master.
    """
    from scipy.ndimage import convolve1d
    n = len(x)
    if not n:
        return np.zeros(0, dtype=np.float32)
    k = _os_phases()
    xt = np.ascontiguousarray(np.asarray(x, dtype=np.float32).T)       # (channels, frames)
    env = np.abs(xt).max(axis=0) * k[0, _OS_TAPS]
    buf = np.empty((xt.shape[0], min(n, _OS_BLOCK + 2 * _OS_TAPS)), dtype=np.float32)
    for a in range(0, n, _OS_BLOCK):
        b = min(n, a + _OS_BLOCK)
        lo, hi = max(0, a - _OS_TAPS), min(n, b + _OS_TAPS)
        seg, out, e = xt[:, lo:hi], buf[:, :hi - lo], env[a:b]
        for p in (1, 2, 3):
            convolve1d(seg, k[p], axis=1, mode="constant", cval=0.0, output=out)
            np.abs(out, out=out)
            np.maximum(e, out[:, a - lo:b - lo].max(axis=0), out=e)
    return env


def true_peak_db(x: np.ndarray, sr: int = SR) -> float:
    """Inter-sample peak by 4× oversampling (the BS.1770 method), dBTP."""
    if not len(x):
        return -200.0
    return db(float(oversampled_peaks(x).max()))


def count_clipping(x: np.ndarray, level: float = CLIP_LEVEL) -> dict:
    """Clipping events: runs of ≥2 samples at digital full scale, or ≥3 identical samples near it."""
    events = 0
    samples = 0
    for ch in range(x.shape[1]):
        a = np.abs(x[:, ch])
        hot = a >= level
        flat = np.zeros_like(hot)
        if len(a) > 2 and a.max() >= 0.9:
            same = np.abs(np.diff(a)) < 1e-7
            flat[1:-1] = same[:-1] & same[1:] & (a[1:-1] >= 0.9 * a.max()) & (a[1:-1] >= 0.9)
        mask = hot | flat
        samples += int(mask.sum())
        if not mask.any():
            continue
        edges = np.diff(np.concatenate(([0], mask.view(np.int8), [0])))
        starts = np.flatnonzero(edges == 1)
        ends = np.flatnonzero(edges == -1)
        events += int(np.sum((ends - starts) >= 2))
    return {"events": events, "samples": samples}


def band_energies(mono: np.ndarray, sr: int = SR) -> dict:
    """Energy in the 8 bands, in dB relative to the total power (dBr)."""
    if len(mono) < 2048:
        return {n: -120.0 for n in BAND_NAMES}
    f, p = sps.welch(mono.astype(np.float64), sr, nperseg=min(16384, len(mono)))
    df = f[1] - f[0]
    total = float(np.sum(p) * df) + 1e-30
    out = {}
    for name, lo, hi in BANDS:
        m = (f >= lo) & (f < hi)
        e = float(np.sum(p[m]) * df) + 1e-30
        out[name] = 10 * math.log10(e / total)
    return out


def bandwidth_hz(mono: np.ndarray, sr: int = SR) -> float:
    """Highest frequency with real content (finds the low-pass of lossy sources)."""
    if len(mono) < 4096:
        return sr / 2
    f, p = sps.welch(mono.astype(np.float64), sr, nperseg=8192)
    pdb = 10 * np.log10(p + 1e-20)
    ref = np.median(pdb[(f > 1000) & (f < 4000)])
    k = max(1, int(len(pdb) / 200))
    smooth = np.convolve(pdb, np.ones(k) / k, mode="same")
    above = np.flatnonzero(smooth > ref - 55)
    return float(f[above[-1]]) if len(above) else sr / 2


def detect_hum(mono: np.ndarray, sr: int = SR) -> Optional[dict]:
    """Mains hum: a line at 50 or 60 Hz that is both well above its surroundings and *narrow*.

    Music (the bayan's boom, a tanpura string) has bumps a few Hz wide; hum is
    a single line, so the peak must also stand ≥10 dB over the bins 1.5–3 Hz
    either side of it.
    """
    if len(mono) < 4 * sr:
        return None
    f, p = sps.welch(mono.astype(np.float64), sr, nperseg=2 ** 16)
    pdb = 10 * np.log10(p + 1e-20)
    best = None
    for f0 in (50.0, 60.0):
        near = np.abs(f - f0) <= 0.6
        wide = (np.abs(f - f0) >= 3) & (np.abs(f - f0) <= 12)
        inner = (np.abs(f - f0) >= 1.5) & (np.abs(f - f0) <= 3)
        if not (near.any() and wide.any() and inner.any()):
            continue
        peak = float(pdb[near].max())
        prominence = peak - float(np.median(pdb[wide]))
        narrow = peak - float(np.max(pdb[inner]))
        if prominence >= 15 and narrow >= 10 and (best is None or prominence > best["prominence_db"]):
            best = {"hz": f0, "prominence_db": prominence}
    return best


def analyze(x: np.ndarray, sr: int = SR) -> dict:
    """The measurements every decision and every quality gate is made from."""
    mono = to_mono(x)
    lufs = measure_lufs(x, sr)
    peak = sample_peak_db(x)
    rms = db(float(np.sqrt(np.mean(mono.astype(np.float64) ** 2)))) if len(mono) else -200.0
    frames = _frames_rms(mono, int(0.05 * sr), int(0.025 * sr))
    levels = 20 * np.log10(np.maximum(frames, 1e-10))
    live = levels[levels > -90]
    noise_floor = float(np.percentile(live, 10)) if len(live) else -120.0
    loud = float(np.percentile(live, 95)) if len(live) else -120.0
    clip = count_clipping(x)
    bands = band_energies(mono, sr)
    # stereo: correlation, and what folding to mono costs (a phone speaker is mono)
    left, right = x[:, 0].astype(np.float64), x[:, 1].astype(np.float64)
    den = math.sqrt(float(np.sum(left ** 2) * np.sum(right ** 2))) + 1e-20
    corr = float(np.sum(left * right) / den)
    stereo_rms = math.sqrt(float(np.mean(left ** 2 + right ** 2)) / 2) + 1e-20
    mono_rms = math.sqrt(float(np.mean(((left + right) / 2) ** 2))) + 1e-20
    return {
        "duration_s": len(x) / sr,
        "lufs": lufs,
        "sample_peak_db": peak,
        "true_peak_db": true_peak_db(x, sr),
        "rms_db": rms,
        "crest_db": peak - rms,
        "clip_events": clip["events"],
        "clip_samples": clip["samples"],
        "noise_floor_db": noise_floor,
        "signal_db": loud,
        "snr_db": loud - noise_floor,
        "bands_db": bands,
        "bandwidth_hz": bandwidth_hz(mono, sr),
        "dc_offset": float(np.mean(mono)),
        "stereo_correlation": corr,
        "mono_loss_db": db(mono_rms) - db(stereo_rms),
        "hum": detect_hum(mono, sr),
    }


# ── Rhythm and pitch ─────────────────────────────────────────────────────────

ANALYSIS_SR = 22050
_HOP = 256


def _resample(mono: np.ndarray, sr_in: int, sr_out: int = ANALYSIS_SR) -> np.ndarray:
    g = math.gcd(sr_in, sr_out)
    return sps.resample_poly(mono.astype(np.float32), sr_out // g, sr_in // g).astype(np.float32)


def onset_envelope(mono22: np.ndarray, hop: int = _HOP) -> np.ndarray:
    import librosa
    return librosa.onset.onset_strength(y=mono22, sr=ANALYSIS_SR, hop_length=hop)


def analyze_rhythm(mono: np.ndarray, sr: int = SR) -> dict:
    """Stroke count and tempo (a beat-tracker's estimate: label it so)."""
    import librosa
    y = _resample(mono, sr)
    env = onset_envelope(y)
    onsets = librosa.onset.onset_detect(onset_envelope=env, sr=ANALYSIS_SR, hop_length=_HOP, units="time")
    tempo, beats = librosa.beat.beat_track(onset_envelope=env, sr=ANALYSIS_SR, hop_length=_HOP)
    bpm = float(np.atleast_1d(tempo)[0])
    steadiness = None
    if len(beats) > 4:
        ibi = np.diff(librosa.frames_to_time(beats, sr=ANALYSIS_SR, hop_length=_HOP))
        steadiness = float(np.std(ibi) / (np.mean(ibi) + 1e-9))
    return {
        "bpm": bpm if bpm > 0 else None,
        "strokes": int(len(onsets)),
        "strokes_per_second": float(len(onsets) / max(len(mono) / sr, 1e-9)),
        "beat_irregularity": steadiness,   # std/mean of beat gaps: ~0 is steady
        "onset_times": [round(float(t), 4) for t in onsets[:2000]],
    }


NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def hz_to_note(hz: float) -> dict:
    midi = 69 + 12 * math.log2(hz / 440.0)
    nearest = int(round(midi))
    return {"note": f"{NOTE_NAMES[nearest % 12]}{nearest // 12 - 1}", "cents": round((midi - nearest) * 100, 1)}


def _loudest_window(y: np.ndarray, sr: int, seconds: float) -> np.ndarray:
    n = int(seconds * sr)
    if len(y) <= n:
        return y
    hop = sr
    best, best_i = -1.0, 0
    for i in range(0, len(y) - n + 1, hop):
        e = float(np.mean(y[i:i + n:8] ** 2))
        if e > best:
            best, best_i = e, i
    return y[best_i:best_i + n]


def _pyin_track(y: np.ndarray, fmin: float, fmax: float) -> np.ndarray:
    """Voiced fundamental estimates (Hz) from pYIN."""
    import librosa
    f0, voiced, prob = librosa.pyin(y, fmin=fmin, fmax=fmax, sr=ANALYSIS_SR, frame_length=2048, hop_length=512)
    keep = voiced & (prob > 0.6) & np.isfinite(f0)
    return f0[keep]


def _circular_mode(cents: np.ndarray, bin_cents: float = 5.0, spread: float = 12.0) -> tuple:
    """The most common pitch class (cents mod 1200) and how much of the data sits near it."""
    c = np.mod(cents, 1200.0)
    nb = int(1200 / bin_cents)
    hist, _ = np.histogram(c, bins=nb, range=(0, 1200))
    k = max(1, int(spread / bin_cents))
    ker = np.exp(-0.5 * (np.arange(-3 * k, 3 * k + 1) / k) ** 2)
    smooth = np.convolve(np.concatenate([hist[-3 * k:], hist, hist[:3 * k]]).astype(float), ker, mode="same")[3 * k:-3 * k]
    centre = (np.argmax(smooth) + 0.5) * bin_cents
    d = (c - centre + 600) % 1200 - 600
    near = np.abs(d) <= 30
    return float(centre + (d[near].mean() if near.any() else 0.0)) % 1200, float(near.mean())


def estimate_dayan_pitch(mono: np.ndarray, sr: int = SR, fmin: float = 110.0) -> Optional[dict]:
    """The pitch the dayan rings at (≈ Sa), from the voiced frames of its sustain."""
    y = _loudest_window(_resample(mono, sr), ANALYSIS_SR, 45.0)
    try:
        f0 = _pyin_track(y, fmin, 700.0)
    except Exception:
        return None
    if len(f0) < 12:
        return None
    cents = 1200 * np.log2(f0 / 440.0)
    centre, support = _circular_mode(cents)
    d = (np.mod(cents, 1200.0) - centre + 600) % 1200 - 600
    members = f0[np.abs(d) <= 30]
    hz = float(np.median(members))
    note = hz_to_note(hz)
    return {"hz": hz, **note, "support": float(support), "voiced_frames": int(len(f0))}


def pitch_relation(dayan_hz: float, lehra_mono: np.ndarray, sr: int = SR) -> Optional[dict]:
    """How far the lehra's tonic sits from the dayan's pitch, in cents (+ = lehra sharp)."""
    y = _loudest_window(_resample(lehra_mono, sr), ANALYSIS_SR, 30.0)
    try:
        f0 = _pyin_track(y, 80.0, 1000.0)
    except Exception:
        return None
    if len(f0) < 20:
        return None
    rel = 1200 * np.log2(f0 / dayan_hz)
    rel = (rel + 600) % 1200 - 600                    # nearest octave of the dayan's pitch class
    near = rel[np.abs(rel) <= 100]
    if len(near) < 0.05 * len(rel) or len(near) < 10:
        return {"offset_cents": None, "reason": "no_tonic_near_dayan", "support": float(len(near) / len(rel))}
    hist, edges = np.histogram(near, bins=100, range=(-100, 100))
    ker = np.exp(-0.5 * (np.arange(-9, 10) / 3.0) ** 2)
    smooth = np.convolve(hist.astype(float), ker, mode="same")
    peak = (edges[np.argmax(smooth)] + edges[np.argmax(smooth) + 1]) / 2
    members = near[np.abs(near - peak) <= 15]
    offset = float(np.mean(members))
    return {"offset_cents": offset, "support": float(len(members) / len(rel)), "voiced_frames": int(len(f0))}


# ── Alignment ────────────────────────────────────────────────────────────────

def _bpm_candidates(bpm: float) -> list:
    return [bpm * r for r in (1.0, 2.0, 0.5, 1.5, 2 / 3)]


def compare_tempo(tabla_bpm: Optional[float], lehra_bpm: Optional[float]) -> dict:
    """Closest match between the two beat-tracker tempi, allowing for double/half-time picks."""
    if not tabla_bpm or not lehra_bpm:
        return {"tabla_bpm": tabla_bpm, "lehra_bpm": lehra_bpm, "stretch_factor": None, "agree": None}
    best = min(_bpm_candidates(lehra_bpm), key=lambda b: abs(math.log(tabla_bpm / b)))
    ratio = tabla_bpm / best                 # >1: the lehra is slower than the tabla
    return {"tabla_bpm": tabla_bpm, "lehra_bpm": lehra_bpm, "lehra_bpm_matched": best,
            "stretch_factor": ratio, "agree": abs(ratio - 1) <= 0.03}


def estimate_offset(tabla_mono: np.ndarray, lehra_mono: np.ndarray, sr: int = SR) -> dict:
    """Phase of the lehra loop that lines its note onsets up with the tabla's strokes.

    The tabla's onset strength is folded onto one lehra period and correlated
    (circularly) with the lehra's own.  The answer is `offset_seconds`: the
    lehra loop is started that much later (+) or earlier (−).  `confidence` is
    how far the best phase stands above the rest (0–1); low means "not
    informative", and the pipeline then leaves the offset at 0.
    """
    hop = 128
    et = onset_envelope(_resample(tabla_mono, sr), hop)
    el = onset_envelope(_resample(lehra_mono, sr), hop)
    period = len(el)
    if period < 16 or len(et) < period:
        return {"offset_seconds": 0.0, "confidence": 0.0}
    fold = np.zeros(period)
    for i in range(0, len(et), period):
        seg = et[i:i + period]
        fold[:len(seg)] += seg
    fold -= fold.mean()
    el = el - el.mean()
    corr = np.real(np.fft.ifft(np.fft.fft(fold) * np.conj(np.fft.fft(el))))   # corr[s] = Σ el[k]·fold[k+s]: the tabla shows a lehra feature s later
    best = int(np.argmax(corr))
    spread = corr.std() + 1e-12
    z = (corr[best] - np.median(corr)) / spread
    confidence = float(np.clip((z - 2.5) / 5.0, 0.0, 1.0))
    frame_s = hop / ANALYSIS_SR
    shift = best * frame_s
    loop_s = period * frame_s
    if shift > loop_s / 2:
        shift -= loop_s
    return {"offset_seconds": float(shift), "confidence": confidence, "z_score": float(z)}


# ── Repair ───────────────────────────────────────────────────────────────────

def declip(x: np.ndarray, level: float = CLIP_LEVEL, max_run: int = 48) -> tuple:
    """Rebuild short clipped peaks with a cubic through the samples around them."""
    from scipy.interpolate import CubicSpline
    y = x.copy()
    repaired = 0
    for ch in range(x.shape[1]):
        a = np.abs(x[:, ch])
        mask = a >= level
        if not mask.any():
            continue
        edges = np.diff(np.concatenate(([0], mask.view(np.int8), [0])))
        starts = np.flatnonzero(edges == 1)
        ends = np.flatnonzero(edges == -1)
        for s, e in zip(starts, ends):
            n = e - s
            if n < 2 or n > max_run or s < 4 or e + 4 > len(a):
                continue
            idx = np.concatenate([np.arange(s - 4, s), np.arange(e, e + 4)])
            if mask[idx].any():
                continue
            sign = 1.0 if x[s, ch] > 0 else -1.0
            cs = CubicSpline(idx, x[idx, ch])
            fill = cs(np.arange(s, e))
            y[s:e, ch] = sign * np.clip(np.abs(fill), a[s:e], 2.5)
            repaired += 1
    return y, repaired


def notch_hum(x: np.ndarray, hz: float, sr: int = SR) -> np.ndarray:
    y = x.copy()
    for k in (1, 2, 3, 4):
        f = hz * k
        if f >= 400:
            break
        b, a = sps.iirnotch(f, 40.0, fs=sr)
        y = sps.filtfilt(b, a, y, axis=0).astype(np.float32)
    return y


def ring_retention_db(x: np.ndarray, onset_times: list, sr: int = SR) -> Optional[float]:
    """Median level of the dayan's ring 80–160 ms after a stroke, relative to the stroke itself (dB).

    Compared between input and output, a drop means the sustain is being eaten
    (by a gate or noise reduction): that is the thing the chain must not do.
    """
    if len(onset_times) < 4:
        return None
    sos = sps.butter(2, [150, 1500], btype="band", fs=sr, output="sos")
    band = sps.sosfilt(sos, to_mono(x).astype(np.float64))
    step = int(0.01 * sr)
    env = _frames_rms(band, step, step)
    vals = []
    t = np.asarray(onset_times)
    for i, t0 in enumerate(t):
        f0 = int(t0 / 0.01)
        if i + 1 < len(t) and t[i + 1] - t0 < 0.19:
            continue
        if f0 + 17 >= len(env):
            continue
        peak = env[f0:f0 + 4].max()
        tail = env[f0 + 8:f0 + 17].mean()
        if peak > 1e-5:
            vals.append(20 * math.log10(max(tail, 1e-9) / peak))
    return float(np.median(vals)) if len(vals) >= 3 else None


def quiet_segment(mono: np.ndarray, sr: int = SR, seconds: float = 0.5) -> Optional[np.ndarray]:
    """The quietest stretch of the recording, if it is clearly quieter than the music (a noise profile)."""
    size = int(seconds * sr)
    if len(mono) < 4 * size:
        return None
    rms = _frames_rms(mono, size, size // 2)
    i = int(np.argmin(rms))
    if rms[i] < 1e-6:
        return None
    if db(float(np.percentile(rms, 95))) - db(float(rms[i])) < 10:
        return None
    start = i * (size // 2)
    return mono[start:start + size]


def reduce_noise(x: np.ndarray, sr: int = SR, prop: float = 0.6, onset_times: Optional[list] = None,
                 noise_clip: Optional[np.ndarray] = None) -> tuple:
    """Stationary noise reduction learned from the quietest part, never touching the dayan's ring."""
    import noisereduce as nr
    learned = "your marked stretch" if noise_clip is not None else "the quietest passage"
    noise = noise_clip if noise_clip is not None else quiet_segment(to_mono(x), sr)
    if noise is None:
        return x, {"applied": False, "reason": "no quiet passage to learn the noise from"}
    y = nr.reduce_noise(y=x.T.astype(np.float32), sr=sr, y_noise=noise.astype(np.float32), stationary=True,
                        prop_decrease=prop, n_std_thresh_stationary=1.5).T.astype(np.float32)
    # The sustain check: if the 150–1500 Hz tail lost more than 2 dB, blend the original back in
    rhythm_times = onset_times if onset_times is not None else analyze_rhythm(to_mono(x), sr)["onset_times"]
    before = ring_retention_db(x, rhythm_times, sr)
    after = ring_retention_db(y, rhythm_times, sr)
    info = {"applied": True, "prop_decrease": prop, "ring_change_db": None, "blended_dry": 0.0, "learned_from": learned}
    if before is not None and after is not None:
        drop = after - before
        info["ring_change_db"] = drop
        if drop < -2.0:
            wet = 0.5
            y = (wet * y + (1 - wet) * x).astype(np.float32)
            info["blended_dry"] = 1 - wet
    return y, info


# ── Tabla chain ──────────────────────────────────────────────────────────────

def _clamp(v: float) -> float:
    return float(max(-EQ_CLAMP_DB, min(EQ_CLAMP_DB, v)))


def adaptive_eq(an: dict, strength: float = 1.0, profile: str = "tabla") -> dict:
    """Scale the profile's starting EQ from the measured band balance; every gain is within ±4 dB.

    Returns {"bands": [...], "decisions": [plain-language reasons]}.
    """
    b = an["bands_db"]
    decisions = []
    scale = strength
    BASE_EQ = PROFILES[profile]
    low_word = BASE_EQ["low_word"]

    hpf = BASE_EQ["hpf_hz"]
    if b["sub"] > b["bayan"] + 3:
        hpf = max(hpf, 45.0)
        decisions.append(f"Sub-bass (20–60 Hz) is {b['sub'] - b['bayan']:.1f} dB above the 60–120 Hz band, so the high-pass moves up to {hpf:.0f} Hz.")

    # 250–500 Hz "mud" against the bayan band
    gap = b["bayan"] - b["mud"]
    mud = BASE_EQ["mud"][1]
    if gap < 3:
        mud -= min(1.5, (3 - gap) * 0.5)
        decisions.append(f"250–500 Hz is within {max(gap, 0):.1f} dB of the {low_word} band, so the {BASE_EQ['mud'][0]:.0f} Hz cut deepens to {_clamp(mud):.1f} dB.")
    elif gap > 9:
        mud = -1.0
        decisions.append(f"250–500 Hz is already {gap:.1f} dB below the {low_word} band, so the {BASE_EQ['mud'][0]:.0f} Hz cut eases to −1.0 dB.")

    # dull attack
    attack = BASE_EQ["attack"][1]
    if b["attack"] < -20:
        attack += min(2.0, (-20 - b["attack"]) * 0.25)
        decisions.append(f"The 2–5 kHz attack band is at {b['attack']:.1f} dBr (dull), so the {BASE_EQ['attack'][0] / 1000:.1f} kHz lift grows to +{_clamp(attack):.1f} dB.")
    elif b["attack"] > -10:
        attack = 0.5
        decisions.append(f"The attack band is already bright ({b['attack']:.1f} dBr), so the {BASE_EQ['attack'][0] / 1000:.1f} kHz lift is only +0.5 dB.")

    # weak bass
    low = BASE_EQ["low_shelf"][1]
    weak = b["mid"] - b["bayan"]
    if weak > 6:
        low += min(1.5, (weak - 6) * 0.25)
        decisions.append(f"The {low_word} sits {weak:.1f} dB under the mids, so the {BASE_EQ['low_shelf'][0]:.0f} Hz shelf rises to {_clamp(low):+.1f} dB.")

    # boxy mids
    box = BASE_EQ["box"][1]
    if b["mid"] - b["attack"] > 12:
        box -= 0.5
        decisions.append(f"The mids sit well above the attack band, so the {BASE_EQ['box'][0]:.0f} Hz cut deepens by 0.5 dB.")

    # top end
    air = BASE_EQ["air"][1]
    if an.get("bandwidth_hz", 24000) < 8000:
        air = 0.0
        decisions.append(f"The recording stops at about {an['bandwidth_hz'] / 1000:.1f} kHz, so there is nothing to lift at {BASE_EQ['air'][0] / 1000:.0f} kHz.")
    elif b["brilliance"] > -22:
        air = 0.0
        decisions.append(f"The 5–10 kHz band is already strong, so the {BASE_EQ['air'][0] / 1000:.0f} kHz shelf is left flat.")

    bands = [
        {"type": "highpass", "hz": hpf},
        {"type": "low_shelf", "hz": BASE_EQ["low_shelf"][0], "gain_db": _clamp(low) * scale},
        {"type": "peak", "hz": BASE_EQ["mud"][0], "gain_db": _clamp(mud) * scale, "q": BASE_EQ["mud"][2]},
        {"type": "peak", "hz": BASE_EQ["box"][0], "gain_db": _clamp(box) * scale, "q": BASE_EQ["box"][2]},
        {"type": "peak", "hz": BASE_EQ["attack"][0], "gain_db": _clamp(attack) * scale, "q": BASE_EQ["attack"][2]},
        {"type": "high_shelf", "hz": BASE_EQ["air"][0], "gain_db": _clamp(air) * scale},
    ]
    if profile != "tabla":
        decisions.insert(0, f"Starting from the {BASE_EQ['label'].lower()} settings.")
    if not decisions:
        decisions.append("The band balance is close to the starting EQ, so the starting values are used as they are.")
    if strength < 1.0:
        decisions.append(f"Reduced strength: every EQ gain is scaled to {strength:.0%} because the full-strength pass changed the tone by more than {MAX_BAND_TILT_DB:.0f} dB in a band.")
    return {"bands": bands, "decisions": decisions}


def tabla_board(plan: dict, profile: str = "tabla", reverb: str = "room"):
    """The source chain: gate (percussion only), the planned EQ, compressor, room."""
    from pedalboard import Compressor, HighpassFilter, HighShelfFilter, LowShelfFilter, NoiseGate, PeakFilter, Reverb
    prof = PROFILES[profile]
    plugins = []
    if prof["gate"]:
        threshold, ratio, release = prof["gate"]
        plugins.append(NoiseGate(threshold_db=threshold, ratio=ratio, attack_ms=2.0, release_ms=release))
    for band in plan["bands"]:
        t = band["type"]
        if t == "highpass":
            plugins.append(HighpassFilter(band["hz"]))
        elif t == "low_shelf":
            plugins.append(LowShelfFilter(band["hz"], band["gain_db"]))
        elif t == "peak":
            plugins.append(PeakFilter(band["hz"], band["gain_db"], band["q"]))
        elif t == "high_shelf":
            plugins.append(HighShelfFilter(band["hz"], band["gain_db"]))
    threshold, ratio, attack, release = prof["comp"]
    plugins.append(Compressor(threshold_db=threshold, ratio=ratio, attack_ms=attack, release_ms=release))
    room = REVERBS[reverb]
    if room:
        size, damping, wet, dry, width = room
        plugins.append(Reverb(room_size=size, damping=damping, wet_level=wet, dry_level=dry, width=width))
    return _board(*plugins)


def process_tabla(x: np.ndarray, plan: dict, sr: int = SR, profile: str = "tabla", reverb: str = "room") -> np.ndarray:
    """Level to the working loudness, then the source chain."""
    lufs = measure_lufs(x, sr)
    gain = from_db(WORKING_LEVEL_LUFS - lufs) if math.isfinite(lufs) else 1.0
    return apply_board(tabla_board(plan, profile, reverb), x * gain, sr)


def bass_exciter(x: np.ndarray, amount: float, sr: int = SR) -> np.ndarray:
    """Parallel tanh saturation of the 40–160 Hz band: harmonics a phone speaker can actually reproduce."""
    if amount <= 0:
        return x
    sos = sps.butter(2, [40, 160], btype="band", fs=sr, output="sos")
    low = sps.sosfilt(sos, x, axis=0)
    drive = 3.0
    sat = np.tanh(drive * low) / math.tanh(drive)
    return (x + amount * (sat - low)).astype(np.float32)


def variant_tabla(tabla: np.ndarray, variant: str, sr: int = SR) -> np.ndarray:
    from pedalboard import PeakFilter
    v = VARIANTS[variant]
    y = tabla
    if v["bayan_db"]:
        y = apply_board(_board(PeakFilter(90.0, v["bayan_db"], 0.8)), y, sr)
    if v["saturation"]:
        y = bass_exciter(y, v["saturation"], sr)
    return y


# ── Lehra chain ──────────────────────────────────────────────────────────────

def lehra_board():
    from pedalboard import Compressor, HighpassFilter, LowpassFilter, LowShelfFilter, PeakFilter
    return _board(
        HighpassFilter(90.0),
        LowShelfFilter(200.0, -1.5),
        PeakFilter(500.0, -1.0, 0.8),
        PeakFilter(3200.0, -2.0, 0.9),        # a pocket for the tabla's attack
        LowpassFilter(13000.0),
        Compressor(threshold_db=-20, ratio=2.0, attack_ms=25, release_ms=200),
    )


def make_seamless_loop(x: np.ndarray, sr: int = SR, xfade_ms: float = 50.0) -> np.ndarray:
    """A loop whose seam is a 50 ms equal-power crossfade, restored to the original length.

    Crossfading the tail into the head shortens the loop by the fade length;
    left alone that would pull the lehra out of step with the tabla by 50 ms a
    cycle, so the loop is stretched back to its exact period (≈0.5 % for a
    10 s cycle, pitch unchanged).
    """
    n = len(x)
    xf = int(xfade_ms / 1000 * sr)
    if n < 8 * xf:
        raise AudioLabError("lehra_short", "The lehra recording is too short to loop (under half a second).", 422)
    t = np.linspace(0.0, np.pi / 2, xf, dtype=np.float32)[:, None]
    fade_in, fade_out = np.sin(t), np.cos(t)
    body = x[xf:].copy()                            # starts where the head's fade ends
    body[-xf:] = x[-xf:] * fade_out + x[:xf] * fade_in
    from pedalboard import time_stretch
    stretched = time_stretch(np.ascontiguousarray(body.T, dtype=np.float32), sr,
                             stretch_factor=len(body) / n, high_quality=True)
    out = np.ascontiguousarray(stretched.T)
    if len(out) > n:
        out = out[:n]
    elif len(out) < n:
        out = np.pad(out, ((0, n - len(out)), (0, 0)), mode="edge")
    return out


def tile_loop(loop: np.ndarray, frames: int, phase: int) -> np.ndarray:
    """`frames` samples of the loop, starting `phase` samples into it."""
    n = len(loop)
    idx = (np.arange(frames, dtype=np.int64) + phase) % n
    return loop[idx]


def duck_gain(tabla: np.ndarray, depth_db: float = 3.0, sr: int = SR) -> np.ndarray:
    """A per-sample gain that dips the lehra up to `depth_db` under each tabla stroke (smoothed)."""
    mono = np.abs(to_mono(tabla))
    block = sr // 1000
    n = len(mono) // block
    if n < 2:
        return np.ones(len(tabla), dtype=np.float32)
    env = mono[:n * block].reshape(n, block).max(axis=1)
    att = 1 - math.exp(-1 / 5.0)         # 5 ms attack at 1 kHz
    rel = 1 - math.exp(-1 / 150.0)       # 150 ms release
    sm = np.empty(n)
    acc = 0.0
    for i, v in enumerate(env):
        acc += (att if v > acc else rel) * (v - acc)
        sm[i] = acc
    ref = float(np.percentile(sm, 95)) + 1e-9
    depth = np.clip(sm / ref, 0, 1) * depth_db
    gain_db = -depth
    t = (np.arange(len(tabla)) + 0.5) / block - 0.5
    return from_db(np.interp(t, np.arange(n), gain_db)).astype(np.float32)


def build_lehra_track(lehra: np.ndarray, tabla: np.ndarray, lehra_db: float, offset_s: float,
                      sr: int = SR) -> tuple:
    """The processed, looped, levelled and ducked lehra, ready to add to the tabla."""
    chain = apply_board(lehra_board(), lehra, sr)
    loop = make_seamless_loop(chain, sr)
    phase = int(round(-offset_s * sr)) % len(loop)
    track = tile_loop(loop, len(tabla), phase)
    tabla_lufs = measure_lufs(tabla, sr)
    track_lufs = measure_lufs(track, sr)
    if not (math.isfinite(tabla_lufs) and math.isfinite(track_lufs)):
        raise AudioLabError("lehra_silent", "The lehra recording is silent.", 422)
    gain_db = (tabla_lufs + lehra_db) - track_lufs
    track = track * from_db(gain_db)
    ducking = duck_gain(tabla, 3.0, sr)
    track = track * ducking[:, None]
    fade = min(len(track), int(0.5 * sr))
    track[-fade:] *= np.linspace(1.0, 0.0, fade, dtype=np.float32)[:, None]
    return track.astype(np.float32), {
        "loop_seconds": len(loop) / sr, "gain_db": gain_db, "ducking_max_db": float(-20 * np.log10(ducking.min() + 1e-9)),
        "lufs_target": tabla_lufs + lehra_db,
    }


# ── Master ───────────────────────────────────────────────────────────────────

def true_peak_limiter(x: np.ndarray, ceiling_db: float, sr: int = SR, lead_ms: float = 2.0, hold_ms: float = 6.0,
                      smooth_ms: float = 2.0, release_db_per_ms: float = 0.05) -> tuple:
    """A look-ahead limiter that keeps the *true* peak under `ceiling_db`.

    (pedalboard's Limiter adds make-up gain that depends on its threshold, which
    makes a loudness target impossible to hit precisely, so this is our own.)
    The gain needed at each sample comes from the 4×-oversampled peak; it is
    held for a few ms, smoothed so it never clicks, and recovers no faster than
    `release_db_per_ms`.  Returns (audio, deepest gain reduction in dB).
    """
    from scipy.ndimage import minimum_filter1d
    n = len(x)
    ceiling = from_db(ceiling_db)
    env = oversampled_peaks(x)
    need = np.minimum(1.0, ceiling / np.maximum(env, 1e-9))
    if need.min() >= 1.0:
        return x, 0.0
    lead = max(2, int(lead_ms * sr / 1000))
    hold = max(lead, int(hold_ms * sr / 1000))
    if (hold - lead) % 2:
        hold += 1
    centred = minimum_filter1d(need, size=hold + lead + 1, mode="nearest")
    d = (hold - lead) // 2
    held = np.empty_like(centred)
    held[d:] = centred[:n - d] if d else centred
    held[:d] = centred[0]
    smooth = max(3, int(smooth_ms * sr / 1000)) | 1
    win = np.hanning(smooth + 2)[1:-1]
    win /= win.sum()
    safe = np.minimum(sps.fftconvolve(held, win, mode="same"), 1.0)
    # slow release, worked out once per millisecond
    block = max(1, sr // 1000)
    nb = -(-n // block)
    padded = np.concatenate([safe, np.ones(nb * block - n)])
    low = 20 * np.log10(np.maximum(padded.reshape(nb, block).min(axis=1), 1e-6))
    for i in range(1, nb):
        low[i] = min(low[i], low[i - 1] + release_db_per_ms)
    slow = from_db(np.interp(np.arange(n), (np.arange(nb) + 0.5) * block - 0.5, low))
    gain = np.minimum(safe, slow).astype(np.float32)
    return (x * gain[:, None]).astype(np.float32), float(-20 * np.log10(max(gain.min(), 1e-6)))


def master(mix: np.ndarray, target_lufs: float, variant: str, opts: JobOptions,
           ceiling_db: float = TRUE_PEAK_CEILING_DBTP, strength: float = 1.0, sr: int = SR) -> tuple:
    """Master chain, then gain until the integrated loudness is on target and the true peak under the ceiling."""
    from pedalboard import Compressor, Gain, HighpassFilter, HighShelfFilter, LowShelfFilter, PeakFilter
    scale = strength
    v = VARIANTS[variant]
    eq = apply_board(_board(
        HighpassFilter(30.0),
        PeakFilter(300.0, -1.8 * scale, 0.8),
        LowShelfFilter(110.0, opts.bass_db) if opts.bass_db else None,
    ), mix, sr)
    shelf_db = 0.5 * scale + opts.brightness_db
    top = _board(
        Compressor(threshold_db=-14, ratio=1.8, attack_ms=30, release_ms=150),
        HighShelfFilter(8000.0, shelf_db),
        HighShelfFilter(SOFT_HIGHS_HZ, v["soft_highs_db"]) if v["soft_highs_db"] else None,
    )
    lufs0 = measure_lufs(eq, sr)
    if not math.isfinite(lufs0):
        raise AudioLabError("silent_mix", "Nothing audible was left after processing.", 422)
    gain = target_lufs - lufs0
    limit_db = ceiling_db - 0.05        # a little under the ceiling, for the 24-bit rounding
    history = []
    y, reduction = eq, 0.0
    for _ in range(12):
        pre = apply_board(top, apply_board(_board(Gain(gain)), eq, sr), sr)
        y, reduction = true_peak_limiter(pre, limit_db, sr, release_db_per_ms=LIMITER_RELEASE_DB_PER_MS)
        lufs = measure_lufs(y, sr)
        err = target_lufs - lufs
        history.append((gain, lufs))
        if abs(err) <= 0.05:
            break
        slope = 1.0
        if len(history) >= 2 and abs(history[-1][0] - history[-2][0]) > 1e-3:
            slope = (history[-1][1] - history[-2][1]) / (history[-1][0] - history[-2][0])
            slope = min(1.0, max(0.2, slope))
        gain += err / slope
    tp = true_peak_db(y, sr)
    if tp > ceiling_db:                      # last resort: a plain trim
        y = (y * from_db(ceiling_db - tp - 0.01)).astype(np.float32)
        lufs, tp = measure_lufs(y, sr), true_peak_db(y, sr)
    return y, {
        "gain_db": gain, "iterations": len(history), "limiter_reduction_db": reduction,
        "lufs": lufs, "true_peak_db": tp,
    }


def apply_reference(mix: np.ndarray, reference: Path, workdir: Path, sr: int = SR) -> np.ndarray:
    """Match the mix to a reference track's tone with matchering (loudness is set afterwards)."""
    if importlib.util.find_spec("matchering") is None:
        raise AudioLabError("no_matchering", "Reference matching is not installed on this server.", 501)
    import matchering as mg
    src, dst = workdir / "ref_in.wav", workdir / "ref_out.wav"
    sf.write(src, mix, sr, subtype="PCM_24")
    mg.process(target=str(src), reference=str(reference), results=[mg.pcm24(str(dst))])
    y, rate = sf.read(dst, dtype="float32", always_2d=True)
    if rate != sr:
        y = sps.resample_poly(y, sr, rate, axis=0).astype(np.float32)
    if y.shape[1] == 1:
        y = np.repeat(y, 2, axis=1)
    out = np.zeros_like(mix)
    n = min(len(out), len(y))
    out[:n] = y[:n]
    return out


def _demucs_python() -> Optional[str]:
    """A Python that has Demucs: AUDIO_LAB_DEMUCS_PYTHON (Demucs and PyTorch are large, so they may live in
    their own environment), else this one if it has it."""
    env = os.environ.get("AUDIO_LAB_DEMUCS_PYTHON")
    if env and Path(env).exists():
        return env
    return sys.executable if importlib.util.find_spec("demucs") is not None else None


def demucs_available() -> bool:
    return _demucs_python() is not None


def separate_drums(wav_path: Path, workdir: Path, timeout: float = 1800) -> Path:
    """Demucs two-stem split; returns the drums stem as a WAV."""
    python = _demucs_python()
    if python is None:
        raise AudioLabError("no_demucs", "Drum separation (Demucs) is not installed on this server.", 501)
    cmd = [python, "-m", "demucs", "--two-stems=drums", "-n", "htdemucs", "-o", str(workdir), str(wav_path)]
    r = _run(cmd, timeout=timeout)
    stem = workdir / "htdemucs" / wav_path.stem / "drums.wav"
    if r.returncode != 0 or not stem.exists():
        raise AudioLabError("demucs_failed", "Separating the drums failed.", 500)
    return stem


# ── Exports and measurement of the exported files ────────────────────────────

def ffmpeg_loudness(path: Path) -> dict:
    """Integrated loudness and true peak of a file as ffmpeg's ebur128 filter measures them."""
    cmd = [_binary("ffmpeg"), "-nostdin", "-hide_banner", "-nostats", "-protocol_whitelist", "file", "-i", str(path),
           "-filter_complex", "ebur128=peak=true", "-f", "null", "-"]
    r = _run(cmd, timeout=600)
    text = r.stderr.decode("utf-8", "replace")
    summary = text[text.rfind("Summary:"):] if "Summary:" in text else text
    i = re.search(r"\bI:\s+(-?[\d.]+|-inf)\s+LUFS", summary)
    p = re.search(r"Peak:\s+(-?[\d.]+|-inf)\s+dBFS", summary)
    if not i:
        raise AudioLabError("measure_failed", "ffmpeg could not measure the output.", 500)
    return {"lufs": float(i.group(1)), "true_peak_db": float(p.group(1)) if p else None}


def export_lossy(wav: Path, out: Path, codec: str) -> None:
    args = {"mp3": ["-c:a", "libmp3lame", "-b:a", "320k"], "aac": ["-c:a", "aac", "-b:a", "256k"]}[codec]
    cmd = [_binary("ffmpeg"), "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-protocol_whitelist", "file",
           "-i", str(wav), "-vn", *args, str(out)]
    if _run(cmd, timeout=600).returncode != 0:
        raise AudioLabError("encode_failed", f"Could not encode the {codec.upper()} file.", 500)


def mux_video(video: Path, wav: Path, out: Path) -> None:
    """The original video stream, untouched, with the new audio."""
    cmd = [_binary("ffmpeg"), "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-protocol_whitelist", "file",
           "-i", str(video), "-i", str(wav), "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy",
           "-c:a", "aac", "-b:a", "256k", "-movflags", "+faststart", "-shortest", str(out)]
    if _run(cmd, timeout=900).returncode != 0:
        raise AudioLabError("mux_failed", "Could not put the new audio into the video.", 500)


# ── Spectrogram for the before/after view ────────────────────────────────────

def spectrogram_data(x: np.ndarray, sr: int = SR, columns: int = 240, rows: int = 96) -> dict:
    """A log-frequency spectrogram (40 Hz–16 kHz) as bytes 0–255 for dBFS −100…−30, row 0 = lowest."""
    import base64
    mono = to_mono(x).astype(np.float32)
    n_fft = 4096
    hop = max(256, (len(mono) - n_fft) // max(columns - 1, 1)) if len(mono) > n_fft else 256
    if len(mono) < n_fft:
        mono = np.pad(mono, (0, n_fft - len(mono)))
    win = np.hanning(n_fft).astype(np.float32)
    n = 1 + (len(mono) - n_fft) // hop
    n = min(n, columns)
    idx = np.arange(n_fft)[None, :] + hop * np.arange(n)[:, None]
    mag = np.abs(np.fft.rfft(mono[idx] * win, axis=1)) / (n_fft / 4)
    freqs = np.fft.rfftfreq(n_fft, 1 / sr)
    edges = np.geomspace(40, 16000, rows + 1)
    out = np.zeros((rows, n), dtype=np.float32)
    for r in range(rows):
        m = (freqs >= edges[r]) & (freqs < edges[r + 1])
        if not m.any():
            m = np.zeros_like(freqs, dtype=bool)
            m[np.argmin(np.abs(freqs - np.sqrt(edges[r] * edges[r + 1])))] = True
        out[r] = np.sqrt(np.mean(mag[:, m] ** 2, axis=1))
    level = 20 * np.log10(out + 1e-9)
    img = np.clip((level + 100.0) / 70.0 * 255.0, 0, 255).astype(np.uint8)
    return {"columns": int(n), "rows": rows, "seconds": float(len(x) / sr),
            "f_low": 40, "f_high": 16000, "db_low": -100, "db_high": -30,
            "data": base64.b64encode(img.tobytes()).decode("ascii")}


# ── Quality gates ────────────────────────────────────────────────────────────

def gate(name: str, ok: bool, value, limit, detail: str = "") -> dict:
    return {"name": name, "pass": bool(ok), "value": value, "limit": limit, "detail": detail}


def tilt_allowance(variant: str, opts: "JobOptions") -> dict:
    """Extra dB a band may move because the variant or a slider asked for it (the 6 dB is for everything else)."""
    v = VARIANTS[variant]
    extra = {n: 0.0 for n in BAND_NAMES}
    extra["bayan"] += abs(v["bayan_db"]) + (1.0 if v["saturation"] else 0.0) + abs(opts.bass_db)
    extra["sub"] += abs(opts.bass_db)
    for n in ("attack", "brilliance", "air"):
        extra[n] += abs(v["soft_highs_db"]) + abs(opts.brightness_db)
    return extra


def evaluate_gates(*, baseline: dict, after: dict, ffm: dict, target: float, input_duration: float,
                   output_duration: float, allowance: Optional[dict] = None) -> list:
    """The checks a finished variant must pass; failing any of them withholds its files."""
    allowance = allowance or {}
    gates = []
    l_err = after["lufs"] - target
    gates.append(gate("loudness_pyloudnorm", abs(l_err) <= LOUDNESS_TOLERANCE_LU, round(after["lufs"], 2),
                      f"{target:+.1f} ± {LOUDNESS_TOLERANCE_LU} LUFS", "integrated loudness, pyloudnorm (BS.1770-4)"))
    f_err = ffm["lufs"] - target
    gates.append(gate("loudness_ffmpeg", abs(f_err) <= LOUDNESS_TOLERANCE_LU, round(ffm["lufs"], 2),
                      f"{target:+.1f} ± {LOUDNESS_TOLERANCE_LU} LUFS", "integrated loudness of the written file, ffmpeg ebur128"))
    tp = max(after["true_peak_db"], ffm["true_peak_db"] if ffm["true_peak_db"] is not None else -200)
    gates.append(gate("true_peak", tp <= TRUE_PEAK_CEILING_DBTP + 0.01, round(tp, 2),
                      f"≤ {TRUE_PEAK_CEILING_DBTP} dBTP", "worse of our measurement and ffmpeg's"))
    clip_ok = after["clip_events"] <= baseline["clip_events"]
    gates.append(gate("no_new_clipping", clip_ok and after["clip_events"] == 0, after["clip_events"],
                      f"0 (input had {baseline['clip_events']})", "runs of full-scale samples"))
    worst, worst_band, worst_over = 0.0, None, 0.0
    shown, shown_band = 0.0, None
    for band in BAND_NAMES:
        if baseline["bands_db"][band] < -55:
            continue                      # a band with next to nothing in it can swing wildly without meaning
        d = after["bands_db"][band] - baseline["bands_db"][band]
        over = abs(d) - (MAX_BAND_TILT_DB + allowance.get(band, 0.0))
        if over > worst_over:
            worst_over, worst, worst_band = over, d, band
        if abs(d) > abs(shown):
            shown, shown_band = d, band
    if worst_band is None:
        worst, worst_band = shown, shown_band
    limit = MAX_BAND_TILT_DB + allowance.get(worst_band, 0.0)
    gates.append(gate("band_tilt", worst_over <= 0, round(worst, 2), f"± {limit:.1f} dB",
                      f"largest change in relative band energy ({worst_band or 'none'})"))
    gates.append(gate("duration", abs(output_duration - input_duration) <= DURATION_TOLERANCE_S,
                      round(output_duration - input_duration, 4), f"± {DURATION_TOLERANCE_S * 1000:.0f} ms",
                      "output length against the input"))
    return gates


def advisory_gates(lossy_peaks: dict, ring_change: Optional[float]) -> list:
    """Checks that are shown but never withhold a file."""
    gates = []
    for codec, peak in lossy_peaks.items():
        gates.append(gate(f"true_peak_{codec}", peak is None or peak <= TRUE_PEAK_CEILING_DBTP + 0.3,
                          None if peak is None else round(peak, 2), f"≤ {TRUE_PEAK_CEILING_DBTP + 0.3:.1f} dBTP",
                          f"after {codec.upper()} encoding (advisory)"))
    if ring_change is not None:
        gates.append(gate("dayan_ring", ring_change >= -3.0, round(ring_change, 2), "≥ −3 dB",
                          "sustain of the dayan against its stroke, before → after (advisory)"))
    return gates


HARD_GATES = {"loudness_pyloudnorm", "loudness_ffmpeg", "true_peak", "no_new_clipping", "band_tilt", "duration",
              "duration_video"}


def hard_pass(gates: list) -> bool:
    return all(g["pass"] for g in gates if g["name"] in HARD_GATES)


# ── Edits: trim, speed, pitch, fades ─────────────────────────────────────────

def fold_sa(hz: float, lo: float = 87.31, hi: float = 207.65) -> float:
    """The same pitch class moved by octaves into the lehra player's Sa range."""
    while hz > hi:
        hz /= 2
    while hz < lo:
        hz *= 2
    return hz


def apply_edits(x: np.ndarray, opts: "JobOptions", sr: int = SR) -> tuple:
    """Trim, then change speed and/or pitch in one pass. Returns (audio, {what was done})."""
    info = {}
    start = 0.0
    if opts.trim_start is not None or opts.trim_end is not None:
        dur = len(x) / sr
        a = min(max(0.0, opts.trim_start or 0.0), dur)
        b = min(dur, opts.trim_end if opts.trim_end is not None else dur)
        if b - a < MIN_SECONDS:
            raise AudioLabError("bad_trim", "The trimmed part is shorter than one second.", 422)
        x = x[int(round(a * sr)):int(round(b * sr))]
        start = a
        info["trim"] = [a, b]
    if abs(opts.tempo_factor - 1.0) > 1e-4 or abs(opts.shift_cents) > 0.5:
        from pedalboard import time_stretch
        y = time_stretch(np.ascontiguousarray(x.T, dtype=np.float32), sr, stretch_factor=opts.tempo_factor,
                         pitch_shift_in_semitones=opts.shift_cents / 100.0, high_quality=True)
        x = np.ascontiguousarray(y.T, dtype=np.float32)
        if abs(opts.tempo_factor - 1.0) > 1e-4:
            info["tempo_factor"] = opts.tempo_factor
        if abs(opts.shift_cents) > 0.5:
            info["shift_cents"] = opts.shift_cents
    info["start_s"] = start
    return x, info


def apply_fades(x: np.ndarray, fade_in_ms: float, fade_out_ms: float, sr: int = SR) -> np.ndarray:
    """Raised-cosine fades at the ends (kept inside the loudness iteration, so the gates still hold)."""
    y = x.copy()
    n_in = min(len(y) // 2, int(fade_in_ms / 1000 * sr))
    n_out = min(len(y) // 2, int(fade_out_ms / 1000 * sr))
    if n_in > 1:
        y[:n_in] *= (0.5 - 0.5 * np.cos(np.linspace(0, np.pi, n_in, dtype=np.float32)))[:, None]
    if n_out > 1:
        y[-n_out:] *= (0.5 + 0.5 * np.cos(np.linspace(0, np.pi, n_out, dtype=np.float32)))[:, None]
    return y


# ── A second recorder: find its offset (and clock drift) against the video's sound ──

SYNC_SR = 8000


def _phat(ref: np.ndarray, other: np.ndarray, max_lag: int, exclude: int, centre: int = 0) -> tuple:
    """GCC-PHAT: the lag (samples) at which `other` matches `ref` (other[n + lag] ≈ ref[n]), searched within
    ±max_lag of `centre`, and how far that peak stands above the best rival more than `exclude` away.

    Phase-only correlation ignores the two microphones' different tone, and its
    peak is sharp; repeated theka cycles are never sample-identical, so the true
    lag beats a lag one cycle off by a wide margin (plain correlation of the
    rhythm cannot tell those apart).
    """
    n = 1 << int(np.ceil(np.log2(len(ref) + len(other))))
    G = np.fft.rfft(other, n) * np.conj(np.fft.rfft(ref, n))
    G /= np.abs(G) + 1e-12
    cc = np.fft.irfft(G, n)
    lags = np.concatenate([np.arange(0, n // 2), np.arange(-n // 2, 0)])
    keep = np.abs(lags - centre) <= max_lag
    cc, lags = cc[keep], lags[keep]
    i = int(np.argmax(cc))
    far = np.abs(lags - lags[i]) > exclude
    rival = float(cc[far].max()) if far.any() else 0.0
    return int(lags[i]), (float(cc[i]) / rival if rival > 0 else float("inf"))


def sync_recordings(reference: np.ndarray, other: np.ndarray, sr: int = SR, max_lag_s: float = 60.0) -> dict:
    """How much later (s) the performance appears in `other` than in `reference`, plus clock drift.

    GCC-PHAT at 8 kHz on 200 Hz – 3 kHz over the first two minutes; drift from
    the same, done again on 20 s at the start and at the end of a long recording.
    """
    fs = SYNC_SR
    sos = sps.butter(4, [200, 3000], btype="band", fs=fs, output="sos")
    r8 = sps.sosfilt(sos, sps.resample_poly(to_mono(reference).astype(np.float64), 1, sr // fs))
    o8 = sps.sosfilt(sos, sps.resample_poly(to_mono(other).astype(np.float64), 1, sr // fs))
    head = r8[:int(120 * fs)]
    reach = int(max_lag_s * fs)
    lag, clarity = _phat(head, o8[:len(head) + reach], reach, int(0.02 * fs))
    confidence = float(np.clip((clarity - 1.2) / 1.8, 0.0, 1.0)) if math.isfinite(clarity) else 1.0

    def lag_at(t0: float, span: float) -> Optional[float]:
        a, b = int(t0 * fs), int((t0 + span) * fs)
        if b > len(r8) or b - a < 2 * fs:
            return None
        oa = max(0, a + lag - int(0.2 * fs))
        ob = min(len(o8), b + lag + int(0.2 * fs))
        if ob - oa < (b - a):
            return None
        local, _ = _phat(r8[a:b], o8[oa:ob], int(0.1 * fs), int(0.02 * fs), centre=a + lag - oa)
        return (local + oa - a) / fs

    dur = len(reference) / sr
    drift_ppm = 0.0
    lag_s = lag / fs
    if dur >= 60:
        t_first, t_last = 2.0, dur - 22.0
        first, last = lag_at(t_first, 20.0), lag_at(t_last, 20.0)
        if first is not None and last is not None:
            d = (last - first) / (t_last - t_first) * 1e6
            if 3.0 < abs(d) < 500.0:
                drift_ppm = d
                lag_s = first - d * 1e-6 * t_first      # the lag at time zero
    return {"lag_s": float(lag_s), "drift_ppm": float(drift_ppm), "confidence": confidence,
            "clarity": float(clarity) if math.isfinite(clarity) else None}


def align_recording(other: np.ndarray, frames: int, lag_s: float, drift_ppm: float = 0.0, sr: int = SR) -> np.ndarray:
    """`other` moved onto the reference's timeline (and its clock corrected), `frames` long.

    other(lag + t·(1 + drift)) is the moment the reference has at t.
    """
    if abs(drift_ppm) > 0:
        import soxr
        k = 1 + drift_ppm / 1e6
        # `other` runs k times as long for the same music: resample it onto the reference's clock
        other = soxr.resample(other.astype(np.float32), sr * k, sr).astype(np.float32)
        lag_s = lag_s / k
    start = int(round(lag_s * sr))
    out = np.zeros((frames, other.shape[1]), dtype=np.float32)
    if start >= 0:
        seg = other[start:start + frames]
        out[:len(seg)] = seg
    else:
        seg = other[:frames + start]
        out[-start:-start + len(seg)] = seg
    return out


# ── Tanpura bed and a vocal track ────────────────────────────────────────────

TANPURA_SA_HZ = 174.61           # tanpura_06_01.wav: Sa = F3 (as the site's player)
TANPURA_FILE = Path(os.environ.get("AUDIO_LAB_TANPURA",
                                   Path(__file__).resolve().parent.parent / "assets" / "tanpura_06_01.wav"))


def build_tanpura(frames: int, sa_hz: float, sr: int = SR) -> np.ndarray:
    """The site's tanpura recording at `sa_hz` (folded into its range), looped to `frames`."""
    if not TANPURA_FILE.exists():
        raise AudioLabError("no_tanpura", "The tanpura recording is not available on this server.", 501)
    import soxr
    raw, rate = sf.read(TANPURA_FILE, dtype="float32", always_2d=True)
    sa = fold_sa(sa_hz)
    # resampling by the pitch ratio, as the site's engine does (it changes speed too, as a real retuned tanpura would sound)
    y = soxr.resample(raw, rate * sa / TANPURA_SA_HZ, sr).astype(np.float32)
    if y.shape[1] == 1:
        y = np.repeat(y, 2, axis=1)
    loop = make_seamless_loop(y[:, :2], sr, xfade_ms=250.0)
    from pedalboard import HighpassFilter, LowpassFilter
    loop = apply_board(_board(HighpassFilter(60.0), LowpassFilter(9000.0)), loop, sr)
    return tile_loop(loop, frames, 0)


def fit_track(x: np.ndarray, frames: int, offset_s: float, sr: int = SR) -> np.ndarray:
    """A separately recorded track placed `offset_s` later (+) or earlier (−), cut or padded to `frames`."""
    return align_recording(x, frames, -offset_s, 0.0, sr)


# ── Riyaz insights: laya, sam, strokes, tuning ───────────────────────────────

def laya_report(mono: np.ndarray, sr: int = SR) -> Optional[dict]:
    """Tempo over time from the beat tracker: drift from start to end, steadiness, rushed and dragged stretches."""
    import librosa
    y = _resample(mono, sr)
    env = onset_envelope(y)
    _, beats = librosa.beat.beat_track(onset_envelope=env, sr=ANALYSIS_SR, hop_length=_HOP, units="time")
    if len(beats) < 12:
        return None
    ibi = np.diff(beats)
    local = 60.0 / np.clip(ibi, 0.08, 4.0)
    k = 9 if len(local) >= 9 else (len(local) // 2) * 2 + 1
    smooth = sps.medfilt(local, k)
    times = (beats[1:] + beats[:-1]) / 2
    centre = float(np.median(smooth))
    n_edge = max(4, len(smooth) // 8)
    start_bpm, end_bpm = float(np.median(smooth[:n_edge])), float(np.median(smooth[-n_edge:]))
    cv = float(np.std(smooth) / (centre + 1e-9))
    rel = smooth / centre - 1.0
    sections = []
    state, since = 0, 0
    for i, r in enumerate(np.append(rel, 0.0)):
        s = 1 if r > 0.03 else (-1 if r < -0.03 else 0)
        if s != state:
            if state != 0 and i - since >= 4:
                sections.append({"kind": "rushing" if state > 0 else "dragging", "from_s": float(times[since]),
                                 "to_s": float(times[min(i, len(times)) - 1]), "by_pct": float(np.mean(rel[since:i]) * 100)})
            state, since = s, i
    step = max(1, len(times) // 400)
    return {
        "bpm": centre, "start_bpm": start_bpm, "end_bpm": end_bpm,
        "drift_pct": (end_bpm / start_bpm - 1) * 100 if start_bpm > 0 else 0.0,
        "variation_pct": cv * 100,
        "sections": sections[:40],
        "curve": [[round(float(t), 2), round(float(b), 1)] for t, b in zip(times[::step], smooth[::step])],
        "note": "From a beat tracker: it can lock onto half or double the tempo, and cross-rhythms confuse it.",
    }


def stroke_levels(x: np.ndarray, onset_times: list, sr: int = SR) -> Optional[dict]:
    """How evenly the strokes are played: the peak of each stroke, its spread and its trend."""
    if len(onset_times) < 8:
        return None
    mono = to_mono(x)
    win = int(0.03 * sr)
    levels = []
    for t in onset_times:
        a = int(t * sr)
        seg = mono[a:a + win]
        if len(seg):
            levels.append(db(float(np.max(np.abs(seg)))))
    levels = np.asarray(levels)
    ref = float(np.percentile(levels, 90))
    rel = levels - ref
    times = np.asarray(onset_times[:len(levels)])
    trend = float(np.polyfit(times, levels, 1)[0] * 60) if len(times) > 2 and times[-1] > times[0] else 0.0
    step = max(1, len(levels) // 800)
    return {
        "strokes": int(len(levels)),
        "spread_db": float(np.percentile(levels, 90) - np.percentile(levels, 10)),
        "std_db": float(np.std(levels)),
        "trend_db_per_min": trend,
        "series": [[round(float(t), 3), round(float(v), 1)] for t, v in zip(times[::step], rel[::step])],
    }


STROKE_TYPES = {
    "combined": "bayan and dayan together (Dha, Dhin)",
    "resonant": "open dayan, ringing (Na, Ta, Tin)",
    "bass": "bayan alone (Ge, Ghe)",
    "closed": "short, damped (Ka, Te, Ti, Ra, Kat)",
}


def stroke_types(x: np.ndarray, onset_times: list, dayan_hz: Optional[float] = None, sr: int = SR) -> Optional[dict]:
    """Experimental: sorts strokes into four families by sound — not bol names.

    Strokes overlap (the previous one is still ringing), so each stroke is
    judged by what it *adds* compared with the moment before it:
      bass   the energy below 160 Hz in its first 80 ms against just before it
      ring   the dayan band (around its pitch) 60–140 ms after it against just before it
    A bayan stroke raises the first, an open dayan stroke the second, Dha/Dhin both,
    and a closed stroke (Ka, Te, Ti) neither: it clicks and stops.
    """
    if len(onset_times) < 8:
        return None
    mono = to_mono(x).astype(np.float64)
    sos_low = sps.butter(4, 160, btype="low", fs=sr, output="sos")
    lo_f, hi_f = (max(160.0, dayan_hz * 0.8), min(dayan_hz * 6, 3000)) if dayan_hz else (160, 1500)
    sos_ring = sps.butter(2, [lo_f, hi_f], btype="band", fs=sr, output="sos")
    low = sps.sosfilt(sos_low, mono)
    ring = sps.sosfilt(sos_ring, mono)

    def rms(sig, a, b):
        a, b = max(0, a), min(len(sig), b)
        return float(np.sqrt(np.mean(sig[a:b] ** 2))) + 1e-7 if b > a else 1e-7

    ms = lambda v: int(v * sr / 1000)  # noqa: E731
    t = np.asarray(onset_times)
    out = []
    for i, t0 in enumerate(t):
        a = int(t0 * sr)
        nxt = int(t[i + 1] * sr) if i + 1 < len(t) else len(mono)
        tail_end = min(a + ms(140), nxt - ms(20))
        if tail_end - (a + ms(60)) < ms(30):
            out.append(None)                      # too fast to hear the ring before the next stroke
            continue
        pre_a, pre_b = a - ms(70), a - ms(25)     # before the stroke (the onset time can be a little late)
        bass_db = 20 * math.log10(rms(low, a - ms(10), a + ms(80)) / rms(low, pre_a, pre_b))
        ring_db = 20 * math.log10(rms(ring, a + ms(60), tail_end) / rms(ring, pre_a, pre_b))
        bass = bass_db >= 6.0
        rings = ring_db >= 3.0
        kind = "combined" if bass and rings else "bass" if bass else "resonant" if rings else "closed"
        out.append({"t": round(float(t0), 3), "type": kind, "bass_db": round(bass_db, 1), "ring_db": round(ring_db, 1)})
    kept = [s for s in out if s]
    if len(kept) < 8:
        return None
    counts = {k: sum(1 for s in kept if s["type"] == k) for k in STROKE_TYPES}
    return {
        "counts": counts, "share": {k: counts[k] / len(kept) for k in counts}, "labels": STROKE_TYPES,
        "strokes": [[s["t"], s["type"]] for s in kept[:3000]],
        "skipped": len(out) - len(kept),
        "note": "Experimental: families of sound, sorted by measurement — not bol recognition. Strokes too close "
                "together to hear their ring are skipped.",
    }


def sam_accuracy(onset_times: list, sam_times: list, window: float = 0.12) -> Optional[dict]:
    """How close a stroke lands to each sam of the lehra (+ late, − early), in ms."""
    if not onset_times or len(sam_times) < 2:
        return None
    on = np.asarray(onset_times)
    devs, missed = [], 0
    for s in sam_times:
        i = int(np.argmin(np.abs(on - s)))
        d = on[i] - s
        if abs(d) <= window:
            devs.append(d * 1000)
        else:
            missed += 1
    if len(devs) < 2:
        return {"sams": len(sam_times), "hit": len(devs), "missed": missed, "mean_ms": None}
    d = np.asarray(devs)
    return {
        "sams": len(sam_times), "hit": len(devs), "missed": missed,
        "mean_ms": float(d.mean()), "median_abs_ms": float(np.median(np.abs(d))),
        "within_30ms_pct": float(np.mean(np.abs(d) <= 30) * 100),
        "deviations_ms": [round(float(v), 1) for v in d[:400]],
    }


def tuning_check(pitch: Optional[dict], sa_hz: Optional[float]) -> Optional[dict]:
    """The dayan's pitch against Sa (or Pa/Ma, which drums are also tuned to), in cents."""
    if not pitch or not sa_hz:
        return None
    rel = (1200 * math.log2(pitch["hz"] / sa_hz)) % 1200
    best = None
    for name, cents in (("Sa", 0.0), ("Pa", 702.0), ("Ma", 498.0), ("Sa", 1200.0)):
        d = rel - cents
        if best is None or abs(d) < abs(best[1]):
            best = (name, d)
    return {"tuned_to": best[0], "cents": float(best[1]), "sa_hz": float(sa_hz), "dayan_hz": float(pitch["hz"]),
            "in_tune": abs(best[1]) <= 15}


# ── Video: reframing, a title, a waveform for audio-only uploads, a before/after clip ──

FONT_DIR = Path(__file__).resolve().parent / "fonts"
LATIN_FONTS = [FONT_DIR / "Cinzel.ttf", Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
               Path("C:/Windows/Fonts/segoeuib.ttf"), Path("C:/Windows/Fonts/arialbd.ttf")]
INDIC_FONTS = [Path("/usr/share/fonts/truetype/noto/NotoSansDevanagari-Bold.ttf"),
               Path("/usr/share/fonts/truetype/noto/NotoSansDevanagari-Regular.ttf"),
               Path("/usr/share/fonts/truetype/lohit-devanagari/Lohit-Devanagari.ttf"),
               Path("C:/Windows/Fonts/NirmalaB.ttf"), Path("C:/Windows/Fonts/Nirmala.ttf")]
FRAMES = {"vertical": (1080, 1920), "square": (1080, 1080), "landscape": (1920, 1080)}


def _font_for(text: str) -> Optional[Path]:
    env = os.environ.get("AUDIO_LAB_FONT")
    if env and Path(env).exists():
        return Path(env)
    latin = all(ord(c) < 0x250 for c in text)
    for p in (LATIN_FONTS if latin else INDIC_FONTS + LATIN_FONTS):
        if p.exists():
            return p
    return None


def _text_layer(work: Path, name: str, text: str, size_expr: str, y_expr: str, colour: str = "0xEDE0CC") -> str:
    """A drawtext filter reading its text from a file (no escaping of the visitor's words into the filter graph)."""
    font = _font_for(text)
    if not text or font is None:
        return ""
    (work / f"{name}.txt").write_text(text, encoding="utf-8")
    shutil.copyfile(font, work / f"{name}{font.suffix}")
    return (f"drawtext=fontfile={name}{font.suffix}:textfile={name}.txt:expansion=none:fontsize={size_expr}"
            f":fontcolor={colour}:x=(w-text_w)/2:y={y_expr}:box=1:boxcolor=0x090806@0.55:boxborderw=22")


def _frame_filter(fmt: str, tag: str = "f") -> str:
    """Reframe to 9:16 or 1:1 with a blurred copy of the picture behind it (nothing is cropped away)."""
    if fmt not in ("vertical", "square"):
        return "setsar=1"
    w, h = FRAMES[fmt]
    return (f"split=2[{tag}bs][{tag}fs];[{tag}bs]scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h},"
            f"boxblur=24:2[{tag}bg];[{tag}fs]scale={w}:{h}:force_original_aspect_ratio=decrease[{tag}fg];"
            f"[{tag}bg][{tag}fg]overlay=(W-w)/2:(H-h)/2,setsar=1")


def _encode(cmd_inputs: list, graph: str, out: Path, work: Path, audio_map: str, extra: Optional[list] = None,
            timeout: float = 1800) -> None:
    cmd = [_binary("ffmpeg"), "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-protocol_whitelist", "file,pipe",
           *cmd_inputs, "-filter_complex", graph, "-map", "[v]", "-map", audio_map,
           "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
           "-c:a", "aac", "-b:a", "256k", "-movflags", "+faststart", *(extra or []), str(out.resolve())]
    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    try:
        r = subprocess.run(cmd, capture_output=True, timeout=timeout, check=False, stdin=subprocess.DEVNULL,
                           creationflags=flags, cwd=str(work))
    except subprocess.TimeoutExpired:
        raise AudioLabError("timeout", "Making the video took too long.", 504)
    if r.returncode != 0:
        raise AudioLabError("video_failed", "Could not make the video.", 500)


def render_video(*, audio: Path, out: Path, work: Path, video: Optional[Path] = None, start_s: float = 0.0,
                 duration_s: Optional[float] = None, fmt: str = "original", title: str = "") -> None:
    """The new audio with the uploaded video (re-encoded only if it is trimmed, reframed or titled),
    or — for an audio-only upload — over a waveform on the site's dark background."""
    work.mkdir(parents=True, exist_ok=True)
    text = _text_layer(work, "title", title, "h*0.042", "h*0.84")
    if video is not None and fmt == "original" and not text and start_s == 0 and duration_s is None:
        mux_video(video, audio, out)
        return
    if video is not None:
        inputs = []
        if start_s > 0:
            inputs += ["-ss", f"{start_s:.3f}"]
        if duration_s is not None:
            inputs += ["-t", f"{duration_s:.3f}"]
        inputs += ["-i", str(Path(video).resolve()), "-i", str(Path(audio).resolve())]
        chain = _frame_filter(fmt) + (f",{text}" if text else "")
        graph = f"[0:v]{chain}[v]"
        _encode(inputs, graph, out, work, "1:a:0", ["-shortest"])
        return
    w, h = FRAMES["square" if fmt in ("original", "square") else "vertical"]
    dur = duration_s if duration_s is not None else sf.info(str(audio)).duration
    inputs = ["-f", "lavfi", "-i", f"color=c=0x090806:s={w}x{h}:r=30:d={dur:.3f}", "-i", str(Path(audio).resolve())]
    wave = (f"[1:a]aformat=channel_layouts=mono,showwaves=s={int(w * 0.86)}x{int(h * 0.22)}:mode=cline:rate=30"
            f":colors=0xf5a623:scale=sqrt,format=rgba[wv];[0:v][wv]overlay=(W-w)/2:(H-h)/2")
    graph = wave + (f",{text}" if text else "") + "[v]"
    _encode(inputs, graph, out, work, "1:a:0", ["-shortest"])


def make_ab_clip(*, before: np.ndarray, after: np.ndarray, out: Path, work: Path, video: Optional[Path],
                 video_offset_s: float = 0.0, seconds: float = 8.0, fmt: str = "original", sr: int = SR) -> dict:
    """The same passage twice — as recorded, then mastered — labelled, for sharing the difference."""
    work.mkdir(parents=True, exist_ok=True)
    n = min(int(seconds * sr), len(after))
    hop = sr // 2
    best, at = -1.0, 0
    mono = to_mono(after)
    for i in range(0, max(1, len(after) - n + 1), hop):
        e = float(np.mean(mono[i:i + n:16] ** 2))
        if e > best:
            best, at = e, i
    a = before[at:at + n]
    b = after[at:at + n]
    xf = int(0.03 * sr)
    clip = np.concatenate([a, b]).astype(np.float32)
    ramp = np.linspace(0, 1, xf, dtype=np.float32)[:, None]
    clip[n - xf:n] *= (1 - ramp)
    clip[n:n + xf] *= ramp
    wav = work / "ab.wav"
    sf.write(wav, clip, sr, subtype="PCM_24")
    secs = n / sr
    lb = _text_layer(work, "before", "Before", "h*0.05", "h*0.08", "0xEDE0CC")
    la = _text_layer(work, "after", "After", "h*0.05", "h*0.08", "0xF5A623")
    if video is not None:
        start = video_offset_s + at / sr
        inputs = ["-ss", f"{start:.3f}", "-t", f"{secs:.3f}", "-i", str(Path(video).resolve()),
                  "-ss", f"{start:.3f}", "-t", f"{secs:.3f}", "-i", str(Path(video).resolve()), "-i", str(wav.resolve())]
        graph = (f"[0:v]{_frame_filter(fmt, 'a')}{',' + lb if lb else ''}[va];"
                 f"[1:v]{_frame_filter(fmt, 'b')}{',' + la if la else ''}[vb];"
                 f"[va][vb]concat=n=2:v=1:a=0[v]")
        _encode(inputs, graph, out, work, "2:a:0", ["-shortest"])
    else:
        w, h = FRAMES["square" if fmt in ("original", "square") else "vertical"]
        inputs = ["-f", "lavfi", "-i", f"color=c=0x090806:s={w}x{h}:r=30:d={2 * secs:.3f}", "-i", str(wav.resolve())]
        lb_t = lb.replace("drawtext=", f"drawtext=enable='lt(t,{secs:.3f})':") if lb else ""
        la_t = la.replace("drawtext=", f"drawtext=enable='gte(t,{secs:.3f})':") if la else ""
        layers = ",".join(x for x in (lb_t, la_t) if x)
        graph = (f"[1:a]aformat=channel_layouts=mono,showwaves=s={int(w * 0.86)}x{int(h * 0.22)}:mode=cline:rate=30"
                 f":colors=0xf5a623:scale=sqrt,format=rgba[wv];[0:v][wv]overlay=(W-w)/2:(H-h)/2"
                 + (f",{layers}" if layers else "") + "[v]")
        _encode(inputs, graph, out, work, "1:a:0", ["-shortest"])
    return {"start_s": at / sr, "seconds": secs}


# ── The pipeline ─────────────────────────────────────────────────────────────

def _safe_name(name: str) -> str:
    stem = re.sub(r"[^A-Za-z0-9._ -]", "_", Path(name).stem).strip(" .") or "recording"
    return stem[:60]


def _prepare_source(spec: JobSpec, warnings: list, edit: bool = True) -> dict:
    """Decode the upload (and a second recorder, synced to it), then the trim / speed / pitch edits."""
    opts = spec.options
    info = probe(spec.tabla)
    max_s = float(os.environ.get("AUDIO_LAB_MAX_SECONDS", 900))
    if info["duration_s"] > max_s:
        raise AudioLabError("too_long", f"That recording is longer than the {max_s / 60:.0f}-minute limit.", 413)
    raw = decode_audio(spec.tabla)
    if len(raw) / SR < MIN_SECONDS:
        raise AudioLabError("too_short", "That recording is shorter than one second.", 422)
    source, sync = raw, None
    if spec.recorder:
        rinfo = probe(spec.recorder)
        if rinfo["duration_s"] > max_s * 1.5:
            raise AudioLabError("too_long", "The second recording is too long.", 413)
        rec = decode_audio(spec.recorder)
        sync = sync_recordings(raw, rec)
        source = align_recording(rec, len(raw), sync["lag_s"], sync["drift_ppm"])
        covered = float(np.mean(np.abs(to_mono(source)) > 1e-6))
        sync["coverage"] = covered
        if sync["confidence"] < 0.35:
            warnings.append("The second recording did not line up clearly with the video's sound — check it is the same performance. "
                            f"It was placed {sync['lag_s']:+.3f} s from the video.")
        if covered < 0.97:
            warnings.append(f"The second recording covers only {covered:.0%} of the video; the rest is silent.")
    pre_frames = len(source)
    edits = {"start_s": 0.0}
    if edit:
        source, edits = apply_edits(source, opts)
    return {"info": info, "source": source, "edits": edits, "sync": sync, "pre_frames": pre_frames}


def run_analysis(spec: JobSpec, progress: ProgressFn = _noop_progress) -> dict:
    """The quick look the page shows while you set things up: loudness, tempo, the dayan's pitch, a preview."""
    t0 = time.time()
    out = Path(spec.out_dir)
    out.mkdir(parents=True, exist_ok=True)
    warnings: list = []
    progress("decode", 0.1, "Reading your recording")
    prep = _prepare_source(spec, warnings, edit=False)
    x = prep["source"]
    progress("analyse", 0.35, "Measuring loudness, noise and tone")
    an = analyze(x)
    if not math.isfinite(an["lufs"]) or an["sample_peak_db"] < -80:
        raise AudioLabError("silent_input", "That recording is silent, so there is nothing to master.", 422)
    progress("analyse", 0.6, "Finding the tempo and the dayan's pitch")
    mono = to_mono(x)
    rhythm = analyze_rhythm(mono)
    pitch = estimate_dayan_pitch(mono)
    sure = bool(pitch and pitch["support"] >= MIN_DAYAN_SUPPORT)
    sa = fold_sa(pitch["hz"]) if sure else None
    progress("preview", 0.85, "Making a preview")
    wav = out / "preview_src.wav"
    sf.write(wav, x, SR, subtype="PCM_16")
    cmd = [_binary("ffmpeg"), "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-protocol_whitelist", "file",
           "-i", str(wav), "-vn", "-ac", "2", "-c:a", "libmp3lame", "-b:a", "160k", str(out / "preview.mp3")]
    if _run(cmd).returncode != 0:
        raise AudioLabError("encode_failed", "Could not make the preview.", 500)
    wav.unlink(missing_ok=True)
    report = {
        "version": 1, "kind": "analysis", "name": _safe_name(spec.display_name), "input": prep["info"],
        "duration_s": len(x) / SR,
        "before": {k: an[k] for k in ("lufs", "sample_peak_db", "true_peak_db", "clip_events", "noise_floor_db",
                                      "snr_db", "bands_db", "hum", "mono_loss_db", "bandwidth_hz")},
        "rhythm": {k: v for k, v in rhythm.items() if k != "onset_times"},
        "dayan_pitch": pitch,
        "suggested_sa": {"hz": sa, **hz_to_note(sa)} if sa else None,
        "sync": prep["sync"],
        "files": {"preview": "preview.mp3"},
        "warnings": warnings,
        "seconds_taken": round(time.time() - t0, 1),
    }
    (out / "analysis.json").write_text(json.dumps(_clean(report), indent=1), encoding="utf-8")
    progress("done", 1.0, "Ready")
    return report


def _level_to(track: np.ndarray, reference_lufs: float, rel_db: float) -> tuple:
    lufs = measure_lufs(track)
    if not math.isfinite(lufs):
        return track, None
    gain = (reference_lufs + rel_db) - lufs
    return (track * from_db(gain)).astype(np.float32), gain


def _to_timeline(t: float, edits: dict, tempo: float) -> float:
    """A time on the upload's timeline (as the page shows it) on the edited timeline."""
    return (t - edits.get("start_s", 0.0)) / tempo


def run_pipeline(spec: JobSpec, progress: ProgressFn = _noop_progress, *, lead: bool = True,
                 require_pass: bool = True) -> dict:
    """Run the whole job; returns the report (also written to out_dir/report.json).

    A job can also be split by version across several runs (the serverless
    build does, to stay inside a function's time limit): each run masters some
    of `options.variants`, and only the `lead` run makes what is shared — the
    riyaz insights, the loudness-matched original and the before/after clip.
    With `require_pass=False` a run whose versions all fail its checks still
    returns its report instead of raising, so the page can put the runs together.
    """
    t0 = time.time()
    opts = spec.options
    out = Path(spec.out_dir)
    out.mkdir(parents=True, exist_ok=True)
    work = out / "work"
    work.mkdir(exist_ok=True)
    warnings: list = []
    target = opts.target_lufs
    tempo = opts.tempo_factor

    # 1 ─ decode (and sync a second recorder), then the edits
    progress("decode", 0.02, "Reading your recording")
    prep = _prepare_source(spec, warnings)
    info, edits = prep["info"], prep["edits"]
    tabla_in = prep["source"]
    if len(tabla_in) / SR < MIN_SECONDS:
        raise AudioLabError("too_short", "What is left after trimming is shorter than one second.", 422)
    video_ok = info["has_video"] and abs(tempo - 1.0) < 1e-4
    if info["has_video"] and not video_ok:
        warnings.append("The speed was changed, so the video could not follow: no MP4 was made (the audio files are complete).")

    lehra_in = None
    if spec.lehra:
        probe(spec.lehra)
        lehra_in = decode_audio(spec.lehra)
        if len(lehra_in) / SR < 0.5:
            raise AudioLabError("lehra_short", "The lehra recording is too short to loop (under half a second).", 422)

    # 2 ─ analyse
    progress("analyse", 0.08, "Measuring loudness, noise and tone")
    before = analyze(tabla_in)
    if not math.isfinite(before["lufs"]) or before["sample_peak_db"] < -80:
        raise AudioLabError("silent_input", "That recording is silent, so there is nothing to master.", 422)
    if before["lufs"] < -50:
        warnings.append(f"The recording is very quiet ({before['lufs']:.0f} LUFS): bringing it up also brings up its noise.")
    rhythm = analyze_rhythm(to_mono(tabla_in))
    progress("analyse", 0.14, "Finding the pitch")
    pitch = estimate_dayan_pitch(to_mono(tabla_in)) if opts.percussive else estimate_dayan_pitch(to_mono(tabla_in), fmin=65.0)
    if before["mono_loss_db"] < -1.5:
        warnings.append(f"Folded to mono (a phone speaker) the recording loses {abs(before['mono_loss_db']):.1f} dB: it has phase problems between the channels.")

    source = tabla_in
    separation = {"applied": False}
    if opts.separate_drums:
        progress("separate", 0.18, "Separating the drums from the song (this is the slow part)")
        tmp = work / "song.wav"
        sf.write(tmp, tabla_in, SR, subtype="FLOAT")
        drums, rate = sf.read(separate_drums(tmp, work), dtype="float32", always_2d=True)
        if rate != SR:
            drums = sps.resample_poly(drums, SR, rate, axis=0).astype(np.float32)
        drums = np.repeat(drums, 2, axis=1) if drums.shape[1] == 1 else drums[:, :2]
        source = np.zeros_like(tabla_in)
        n = min(len(source), len(drums))
        source[:n] = drums[:n]
        separation = {"applied": True, "model": "htdemucs", "stem": "drums"}

    # 3 ─ repair
    progress("repair", 0.26, "Repairing clipping, hum and noise")
    repairs: dict = {}
    if before["clip_events"] > 0:
        source, n_fixed = declip(source)
        repairs["declip"] = {"applied": True, "runs_repaired": n_fixed, "clip_events_before": before["clip_events"]}
        if n_fixed < before["clip_events"]:
            warnings.append(f"{before['clip_events'] - n_fixed} clipped passages were too long to repair and stay as they were.")
    hum = before["hum"]
    if hum and opts.hum_removal == "auto":
        source = notch_hum(source, hum["hz"])
        repairs["hum"] = {"applied": True, **hum}
    noise_clip = None
    if opts.noise_region:
        a = _to_timeline(opts.noise_region[0], edits, tempo)
        b = _to_timeline(opts.noise_region[1], edits, tempo)
        ia, ib = max(0, int(a * SR)), min(len(source), int(b * SR))
        if ib - ia >= int(0.2 * SR):
            noise_clip = to_mono(source[ia:ib])
        else:
            warnings.append("The marked noise stretch falls outside the part you kept, so the noise was learned automatically.")
    wants_nr = noise_clip is not None or opts.denoise == "on" or (
        opts.denoise == "auto" and (before["clip_events"] > 0 or before["noise_floor_db"] > -55 or before["snr_db"] < 30))
    if wants_nr and opts.denoise != "off":
        source, nr_info = reduce_noise(source, onset_times=rhythm["onset_times"], noise_clip=noise_clip)
        repairs["noise_reduction"] = nr_info
    else:
        repairs["noise_reduction"] = {"applied": False, "reason": "switched off" if opts.denoise == "off" else "not needed"}

    # 4 ─ the source chain
    progress("tabla", 0.36, f"Shaping the {PROFILES[opts.profile]['label'].lower()}")
    repaired = bool(repairs.get("declip") or repairs.get("hum") or repairs["noise_reduction"].get("applied") or separation["applied"])
    after_repair = analyze(source) if repaired else before
    plan = adaptive_eq(after_repair, profile=opts.profile)
    tabla_base = process_tabla(source, plan, profile=opts.profile, reverb=opts.reverb)
    ring_before = ring_retention_db(tabla_in, rhythm["onset_times"]) if opts.percussive else None
    tabla_lufs = measure_lufs(tabla_base)

    # 5 ─ lehra, tanpura, vocal
    extras: list = []            # processed tracks to add to every variant
    raw_extras: list = []        # the same, unprocessed, for the "no processing" baseline
    lehra_report, sam_times = None, []
    if lehra_in is not None:
        progress("lehra", 0.44, "Aligning the lehra to the tabla")
        lehra_mono = to_mono(lehra_in)
        lr = analyze_rhythm(lehra_mono)
        tempo_cmp = compare_tempo(rhythm["bpm"], lr["bpm"])
        if opts.lehra_meta:
            tempo_cmp["lehra_bpm_catalogue"] = opts.lehra_meta["bpm"]
        lehra_work = lehra_in
        if abs(tempo - 1.0) > 1e-4:          # the tabla was sped up or slowed: the lehra follows
            from pedalboard import time_stretch
            lehra_work = np.ascontiguousarray(time_stretch(np.ascontiguousarray(lehra_work.T, dtype=np.float32), SR,
                                                           stretch_factor=tempo).T)
        align = estimate_offset(to_mono(tabla_in), to_mono(lehra_work))
        lehra_pitch = None
        if pitch and pitch["support"] >= MIN_DAYAN_SUPPORT:
            lehra_pitch = pitch_relation(pitch["hz"], to_mono(lehra_work))
        else:
            lehra_pitch = {"offset_cents": None, "reason": "dayan_pitch_uncertain"}
        if opts.offset_seconds is not None:
            offset = _to_timeline(opts.offset_seconds, edits, tempo)
            offset_source = "chosen by you"
        elif align["confidence"] >= 0.6:
            offset, offset_source = align["offset_seconds"], f"detected (confidence {align['confidence']:.0%})"
        else:
            offset, offset_source = 0.0, "not detected (the onsets did not line up clearly), left at 0"
        applied_shift = None
        if lehra_pitch and lehra_pitch.get("offset_cents") is not None:
            cents = lehra_pitch["offset_cents"]
            if abs(cents) > 20:
                if opts.match_pitch and abs(cents) <= 60:
                    from pedalboard import time_stretch
                    lehra_work = np.ascontiguousarray(time_stretch(np.ascontiguousarray(lehra_work.T, dtype=np.float32), SR,
                                                                   stretch_factor=1.0, pitch_shift_in_semitones=-cents / 100.0).T)
                    applied_shift = -cents
                else:
                    warnings.append(f"The lehra sits {cents:+.0f} cents from the dayan. Switch on “Match the lehra’s pitch” to shift it by {-cents:+.0f} cents.")
        if not opts.lehra_meta and tempo_cmp.get("agree") is False and tempo_cmp["stretch_factor"]:
            if opts.match_tempo and 0.85 <= tempo_cmp["stretch_factor"] <= 1.18:
                from pedalboard import time_stretch
                lehra_work = np.ascontiguousarray(time_stretch(np.ascontiguousarray(lehra_work.T, dtype=np.float32), SR,
                                                               stretch_factor=tempo_cmp["stretch_factor"]).T)
            elif abs(tempo_cmp["stretch_factor"] - 1) > 0.08:
                warnings.append(f"The lehra’s tempo (≈{tempo_cmp['lehra_bpm_matched']:.0f} BPM) differs from the tabla’s (≈{tempo_cmp['tabla_bpm']:.0f} BPM) by {abs(tempo_cmp['stretch_factor'] - 1) * 100:.0f} %. Beat tracking is an estimate and can misjudge cross-rhythms such as 7 in 4; if the lehra really is off, switch on “Match the lehra’s tempo”.")
        lehra_track, level = build_lehra_track(lehra_work, tabla_base, opts.lehra_db, offset)
        extras.append(lehra_track)
        raw_lehra = tile_loop(lehra_work, len(tabla_in), int(round(-offset * SR)) % len(lehra_work))
        raw_extras.append(_level_to(raw_lehra, measure_lufs(tabla_in), opts.lehra_db)[0])
        if opts.lehra_meta:              # a catalogue lehra starts on sam: the sams are known exactly
            cycle = opts.lehra_meta["cycle_seconds"] / tempo
            k0 = math.ceil((0 - offset) / cycle)
            dur = len(tabla_in) / SR
            sam_times = [offset + k * cycle for k in range(k0, k0 + int(dur / cycle) + 2) if 0 <= offset + k * cycle < dur]
        lehra_report = {
            "tempo": tempo_cmp, "alignment": {**align, "offset_used_s": offset, "offset_source": offset_source},
            "pitch": {"relation": lehra_pitch, "applied_cents": applied_shift}, "level": level,
            "catalogue": opts.lehra_meta,
        }

    sa_hz = opts.sa_hz
    if sa_hz is None and pitch and pitch["support"] >= MIN_DAYAN_SUPPORT:
        sa_hz = fold_sa(pitch["hz"])
    extras_report: dict = {}
    if opts.tanpura_db is not None:
        if sa_hz is None:
            warnings.append("No tanpura was added: choose a Sa (the dayan's pitch was not clear enough to use).")
        else:
            progress("tanpura", 0.48, "Tuning the tanpura")
            tan = build_tanpura(len(tabla_in), sa_hz)
            tan_track, gain = _level_to(tan, tabla_lufs, opts.tanpura_db)
            extras.append(tan_track)
            raw_extras.append(_level_to(tan, measure_lufs(tabla_in), opts.tanpura_db)[0])
            extras_report["tanpura"] = {"sa_hz": fold_sa(sa_hz), **hz_to_note(fold_sa(sa_hz)), "level_db": opts.tanpura_db}
    if spec.vocal:
        progress("vocal", 0.5, "Shaping the vocal")
        probe(spec.vocal)
        vocal = fit_track(decode_audio(spec.vocal), prep["pre_frames"], opts.vocal_offset)
        vocal, _ = apply_edits(vocal, opts)
        vocal = vocal[:len(tabla_in)]
        if len(vocal) < len(tabla_in):
            vocal = np.pad(vocal, ((0, len(tabla_in) - len(vocal)), (0, 0)))
        v_an = analyze(vocal)
        if math.isfinite(v_an["lufs"]):
            v_plan = adaptive_eq(v_an, profile="vocal")
            v_proc = process_tabla(vocal, v_plan, profile="vocal", reverb=opts.reverb)
            v_track, gain = _level_to(v_proc, tabla_lufs, opts.vocal_db)
            extras.append(v_track)
            raw_extras.append(_level_to(vocal, measure_lufs(tabla_in), opts.vocal_db)[0])
            extras_report["vocal"] = {"level_db": opts.vocal_db, "offset_s": opts.vocal_offset, "eq": v_plan["decisions"]}
        else:
            warnings.append("The vocal track is silent, so it was left out.")

    baseline = after_repair if separation["applied"] else before
    baseline_kind = "input"
    if raw_extras:
        mix0 = tabla_in.copy()
        for tr in raw_extras:
            mix0 = mix0 + tr
        baseline = analyze(mix0)
        baseline_kind = "tabla_and_lehra" if lehra_in is not None and len(raw_extras) == 1 else "all_tracks"
    baseline_info = {"kind": baseline_kind, "bands_db": baseline["bands_db"]}

    # 6 ─ the versions: master, check, export
    variants_out: dict = {}
    spectro = {"before": spectrogram_data(tabla_in)}
    names = list(opts.variants)
    ref_path = spec.reference
    in_duration = len(tabla_in) / SR
    for vi, name in enumerate(names):
        base = 0.55 + 0.33 * vi / max(len(names), 1)
        span = 0.33 / max(len(names), 1)
        progress("master", base, f"Mastering “{VARIANTS[name]['label']}”")
        result, minfo = None, None
        allowance = tilt_allowance(name, opts)
        for attempt, strength in enumerate(EQ_STRENGTHS, 1):
            p = plan if strength == 1.0 else adaptive_eq(after_repair, strength, profile=opts.profile)
            tb = tabla_base if strength == 1.0 else process_tabla(source, p, profile=opts.profile, reverb=opts.reverb)
            mix = variant_tabla(tb, name)
            for tr in extras:
                mix = mix + tr
            if ref_path is not None:
                progress("reference", base + span * 0.2, "Matching the reference track")
                mix = apply_reference(mix, ref_path, work)
            mix = apply_fades(mix, opts.fade_in_ms, opts.fade_out_ms)
            ceiling = TRUE_PEAK_CEILING_DBTP
            for lossy_try in range(3):
                y, minfo = master(mix, target, name, opts, ceiling_db=ceiling, strength=strength)
                if lossy_try:
                    minfo["lossy_ceiling_db"] = ceiling          # lowered because the MP3/AAC went over
                result = _check_variant(name, y, minfo, out, baseline, in_duration, target, allowance)
                if not result["ok"]:
                    break
                overshoot = _export_lossy(result, name, out)
                if overshoot <= 0.0 or lossy_try == 2:
                    break
                ceiling -= overshoot + 0.05
            if result["ok"] or attempt == len(EQ_STRENGTHS):
                result["entry"]["attempt"] = attempt
                result["entry"]["eq_strength"] = strength
                break
            warnings.append(f"“{VARIANTS[name]['label']}”: the first pass changed the tone by more than {MAX_BAND_TILT_DB:.0f} dB in a band, so it was redone with the EQ at {EQ_STRENGTHS[attempt] * 100:.0f} % strength.")
        if result["ok"]:
            progress("export", base + span * 0.75, f"Exporting “{VARIANTS[name]['label']}”")
            _export_video(result, name, spec, out, work, info, edits, video_ok, in_duration)
            ring_ok = ring_before if (opts.percussive and not extras) else None
            _advisories(result, rhythm, ring_ok)
        crest = result["entry"]["after"]["crest_db"]
        if opts.percussive and crest < MIN_CREST_DB:
            warnings.append(f"“{VARIANTS[name]['label']}”: at {target:.0f} LUFS the peaks are only {crest:.0f} dB above the average level (it was {before['crest_db']:.0f} dB), so the strokes may sound flattened. A quieter target is gentler.")
        variants_out[name] = result["entry"]
        spectro[name] = result["spectrogram"]

    passed = [n for n, v in variants_out.items() if v["passed"]]
    report = _assemble(spec, info, before, rhythm, pitch, separation, repairs, plan, lehra_report, variants_out,
                       warnings, t0, ring_before, passed, baseline_info)
    if not passed and require_pass:
        failures = {n: [g["name"] for g in v["gates"] if g["name"] in HARD_GATES and not g["pass"]] for n, v in variants_out.items()}
        _write_report(out, report, spectro)
        raise AudioLabError("gates_failed", "Every version failed its quality checks: " + json.dumps(failures), 500)

    # 7 ─ insights, the original for comparison, the before/after clip
    insights: dict = {}
    if lead and opts.percussive:
        progress("insights", 0.9, "Looking at timing and strokes")
        onsets = rhythm["onset_times"]
        insights["laya"] = laya_report(to_mono(tabla_in))
        insights["strokes"] = stroke_levels(tabla_in, onsets)
        insights["stroke_types"] = stroke_types(source, onsets, pitch["hz"] if pitch and pitch["support"] >= MIN_DAYAN_SUPPORT else None)
        if sam_times:
            insights["sam"] = sam_accuracy(onsets, sam_times)
        insights["tuning"] = tuning_check(pitch if pitch and pitch["support"] >= MIN_DAYAN_SUPPORT else None, opts.sa_hz or (sa_hz if opts.lehra_meta else None))
    report["insights"] = insights
    report["edits"] = {k: v for k, v in edits.items()}
    report["sync"] = prep["sync"]
    report["extras"] = extras_report
    report["profile"] = {"name": opts.profile, "label": PROFILES[opts.profile]["label"], "reverb": opts.reverb}

    progress("report", 0.95, "Writing the report")
    default = report["default_variant"]
    if lead:
        matched = _original_matched(tabla_in, target)
        prev = work / "original_matched.wav"
        sf.write(prev, matched, SR, subtype="PCM_24")
        export_lossy(prev, out / "original.mp3", "mp3")
        report["files"]["original"] = "original.mp3"
    if lead and opts.ab_clip and default:
        progress("clip", 0.97, "Making the before/after clip")
        after_audio, _ = sf.read(out / variants_out[default]["files"]["wav"], dtype="float32", always_2d=True)
        clip = make_ab_clip(before=matched, after=after_audio, out=out / "ab_clip.mp4", work=work / "ab",
                            video=spec.tabla if video_ok else None, video_offset_s=edits.get("start_s", 0.0),
                            fmt=opts.video_format)
        report["files"]["ab_clip"] = "ab_clip.mp4"
        report["ab_clip"] = {**clip, "variant": default}
    report["seconds_taken"] = round(time.time() - t0, 1)
    _write_report(out, report, spectro)
    shutil.rmtree(work, ignore_errors=True)
    progress("done", 1.0, "Finished")
    return report


def _original_matched(tabla_in: np.ndarray, target: float) -> np.ndarray:
    """The recording as it came in (after your edits), brought to the target loudness: a fair A/B."""
    from pedalboard import Gain
    lufs = measure_lufs(tabla_in)
    y, _ = true_peak_limiter(apply_board(_board(Gain(target - lufs)), tabla_in), TRUE_PEAK_CEILING_DBTP - 0.05)
    return y


def _check_variant(name, y, minfo, out, baseline, in_duration, target, allowance) -> dict:
    """Write the 24-bit WAV, measure it two ways and run the hard gates."""
    wav = out / f"{name}.wav"
    sf.write(wav, y, SR, subtype="PCM_24")
    written, _ = sf.read(wav, dtype="float32", always_2d=True)
    after = analyze(written)
    ffm = ffmpeg_loudness(wav)
    gates = evaluate_gates(baseline=baseline, after=after, ffm=ffm, target=target, input_duration=in_duration,
                           output_duration=len(written) / SR, allowance=allowance)
    ok = hard_pass(gates)
    entry = {
        "label": VARIANTS[name]["label"], "description": VARIANTS[name]["description"],
        "passed": ok, "gates": gates, "after": after, "master": minfo, "files": {}, "ring_change_db": None,
    }
    return {"ok": ok, "entry": entry, "wav": wav, "written": written, "spectrogram": spectrogram_data(written),
            "lossy": {}}


def _export_lossy(result: dict, name: str, out: Path) -> float:
    """MP3 and AAC; returns how far the worse of them overshoots −1 dBTP (≤ 0: fine)."""
    wav = result["wav"]
    mp3, m4a = out / f"{name}.mp3", out / f"{name}.m4a"
    export_lossy(wav, mp3, "mp3")
    export_lossy(wav, m4a, "aac")
    peaks = {}
    for codec, path in (("mp3", mp3), ("aac", m4a)):
        try:
            peaks[codec] = ffmpeg_loudness(path)["true_peak_db"]
        except AudioLabError:
            peaks[codec] = None
    result["lossy"] = peaks
    result["entry"]["files"] = {"wav": wav.name, "mp3": mp3.name, "aac": m4a.name}
    worst = max((p for p in peaks.values() if p is not None), default=-200.0)
    return worst - TRUE_PEAK_CEILING_DBTP


def _export_video(result: dict, name: str, spec, out: Path, work: Path, info: dict, edits: dict, video_ok: bool,
                  in_duration: float) -> None:
    """The MP4: the uploaded video with the new audio, or a waveform video for an audio-only upload."""
    opts = spec.options
    entry = result["entry"]
    mp4 = out / f"{name}.mp4"
    if info["has_video"] and video_ok and opts.export_mp4:
        trimmed = "trim" in edits
        render_video(audio=result["wav"], out=mp4, work=work / f"v_{name}", video=spec.tabla,
                     start_s=edits.get("start_s", 0.0) if trimmed else 0.0,
                     duration_s=in_duration if trimmed else None, fmt=opts.video_format, title=opts.title)
        expected = in_duration if trimmed else probe(spec.tabla)["duration_s"]
    elif not info["has_video"] and opts.audio_video:
        render_video(audio=result["wav"], out=mp4, work=work / f"v_{name}", video=None, fmt=opts.video_format,
                     title=opts.title)
        expected = in_duration
    else:
        return
    got = probe(mp4)["duration_s"]
    g = gate("duration_video", abs(got - expected) <= DURATION_TOLERANCE_S, round(got - expected, 4),
             f"± {DURATION_TOLERANCE_S * 1000:.0f} ms", "the MP4 against what was kept of the upload")
    entry["gates"].append(g)
    if g["pass"]:
        entry["files"]["mp4"] = mp4.name
    else:
        entry["passed"] = False
        result["ok"] = False
        entry["files"] = {}


def _advisories(result: dict, rhythm: dict, ring_before) -> None:
    entry = result["entry"]
    ring_change = None
    if ring_before is not None:
        ring_after = ring_retention_db(result["written"], rhythm["onset_times"])
        ring_change = None if ring_after is None else ring_after - ring_before
    entry["ring_change_db"] = ring_change
    entry["gates"].extend(advisory_gates(result["lossy"], ring_change))


def _assemble(spec, info, before, rhythm, pitch, separation, repairs, plan, lehra_report, variants, warnings, t0,
              ring_before, passed, baseline_info) -> dict:
    opts = spec.options
    default = DEFAULT_VARIANT if DEFAULT_VARIANT in passed else (passed[0] if passed else None)
    return {
        "version": 2,
        "kind": "master",
        "name": _safe_name(spec.display_name),
        "input": info,
        "target": {"name": opts.target, "lufs": opts.target_lufs, "true_peak_db": TRUE_PEAK_CEILING_DBTP},
        "options": {k: getattr(opts, k) for k in ("target", "custom_lufs", "profile", "reverb", "lehra_db", "offset_seconds",
                                                    "brightness_db", "bass_db", "denoise", "hum_removal", "separate_drums",
                                                    "match_pitch", "match_tempo", "shift_cents", "tempo_factor", "trim_start",
                                                    "trim_end", "fade_in_ms", "fade_out_ms", "tanpura_db", "sa_hz", "vocal_db",
                                                    "video_format", "title")},
        "before": before,
        "baseline": baseline_info,
        "rhythm": {k: v for k, v in rhythm.items() if k != "onset_times"},
        "dayan_pitch": pitch,
        "separation": separation,
        "repairs": repairs,
        "eq": plan,
        "lehra": lehra_report,
        "variants": variants,
        "default_variant": default,
        "files": {},
        "warnings": warnings,
        "seconds_taken": round(time.time() - t0, 1),
        "notes": "Every number here is a measurement. The EQ values are starting points: judge the result by ear.",
    }


def _write_report(out: Path, report: dict, spectro: dict) -> None:
    (out / "report.json").write_text(json.dumps(_clean(report), indent=1), encoding="utf-8")
    (out / "spectrograms.json").write_text(json.dumps(_clean(spectro)), encoding="utf-8")
