#!/usr/bin/env python3
"""
Lehra Studio — Python Fallback CLI for Audio Pitch Shifting & Peak Generation
=============================================================================
Called by Drogon C++ server (AudioProcessorService / JobWorkerPool) when:
  1) Audio cache miss occurs (handles fast sidecar call OR librosa fallback + OGG encoding).
  2) C++ sidecar (/peaks) is offline after stem separation.
"""

import sys
import os
import argparse
import pathlib
import tempfile
import subprocess
import math
import logging

logging.basicConfig(level=logging.INFO, format="[pitch_shift_fallback] %(levelname)s: %(message)s")
log = logging.getLogger("pitch_shift_fallback")

SIDECAR_URL = os.environ.get("SIDECAR_URL", "http://localhost:3001")


def run_audio_process(input_path: str, output_path: str, pitch_hz: float, start: float, end: float, stretch: float, base_hz: float):
    import numpy as np
    import soundfile as sf
    import librosa
    import requests

    n_semitones = 12.0 * math.log2(pitch_hz / base_hz) if pitch_hz > 0 and base_hz > 0 else 0.0
    duration = end - start if end > 0 else None

    temp_in_fd, temp_in_path = tempfile.mkstemp(suffix=".wav")
    temp_out_fd, temp_out_path = tempfile.mkstemp(suffix=".wav")
    os.close(temp_in_fd)
    os.close(temp_out_fd)

    try:
        ffmpeg_cmd = ["ffmpeg", "-y", "-i", input_path]
        if start > 0:
            ffmpeg_cmd.extend(["-ss", str(start)])
        if duration is not None:
            ffmpeg_cmd.extend(["-t", str(duration)])
        ffmpeg_cmd.extend(["-ar", "44100", "-ac", "1", "-f", "wav", temp_in_path])

        subprocess.run(ffmpeg_cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)

        sidecar_success = False
        try:
            import socket
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(0.05)
            if sock.connect_ex(('127.0.0.1', 3001)) == 0:
                sock.close()
                resp = requests.post(
                    f"{SIDECAR_URL}/process_audio",
                    json={
                        "input": temp_in_path,
                        "output": temp_out_path,
                        "pitch_semitones": float(n_semitones),
                        "tempo": float(1.0 / stretch) if stretch > 0 else 1.0
                    },
                    timeout=1.5
                )
                resp.raise_for_status()
                sidecar_success = True
                log.info(f"Processed via C++ sidecar: {output_path}")
            else:
                sock.close()
        except Exception as err:
            log.warning(f"Sidecar processing failed ({err}). Falling back to pedalboard / librosa.")

        if sidecar_success:
            y, sr = sf.read(temp_out_path, dtype='float32')
            if y.ndim > 1: y = y.mean(axis=1)
        else:
            y, sr = sf.read(temp_in_path, dtype='float32')
            if y.ndim > 1: y = y.mean(axis=1)
            try:
                import pedalboard
                y = pedalboard.time_stretch(y, float(sr), stretch_factor=float(stretch), pitch_shift_in_semitones=float(n_semitones))
                if y.ndim > 1: y = y.squeeze()
                log.info(f"Processed via ultra-fast Pedalboard C++ SIMD: {output_path}")
            except Exception as pb_err:
                log.warning(f"Pedalboard C++ SIMD processing failed ({pb_err}). Falling back to librosa.")
                if stretch != 1.0 and stretch > 0:
                    y = librosa.effects.time_stretch(y, rate=stretch)
                if n_semitones != 0.0:
                    y = librosa.effects.pitch_shift(y, sr=sr, n_steps=n_semitones)

        # Apply 15ms seamless loop sine fade in/out
        fade_ms = 15
        fade_samples = int((fade_ms / 1000.0) * sr)
        if fade_samples * 2 < len(y):
            t = np.sin(np.linspace(0, np.pi/2, fade_samples, dtype=np.float32))
            y[:fade_samples] *= t
            y[-fade_samples:] *= t[::-1]

        # Save as OGG Vorbis
        os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
        with sf.SoundFile(output_path, 'w', samplerate=sr, channels=1, format='OGG', subtype='VORBIS') as f:
            chunk_size = 44100
            for i in range(0, len(y), chunk_size):
                f.write(y[i:i+chunk_size])

        log.info(f"Successfully generated OGG Vorbis file: {output_path}")

    finally:
        for p in [temp_in_path, temp_out_path]:
            if os.path.exists(p):
                try: os.unlink(p)
                except Exception: pass


def run_peaks_process(target_dir: str):
    import numpy as np
    import librosa
    import json

    out_dir = pathlib.Path(target_dir)
    if not out_dir.exists() or not out_dir.is_dir():
        log.error(f"Target directory does not exist: {target_dir}")
        sys.exit(1)

    expected_stems = ["vocals.mp3", "drums.mp3", "bass.mp3", "guitar.mp3", "piano.mp3", "other.mp3"]
    stem_names = [s.replace(".mp3", "") for s in expected_stems]
    peaks_data = {}
    resolution = 800

    for stem_name in stem_names:
        stem_file = out_dir / f"{stem_name}.mp3"
        if stem_file.exists():
            try:
                y, _ = librosa.load(str(stem_file), sr=None, mono=True)
                chunk_size = max(1, len(y) // resolution)
                peaks = []
                for i in range(0, len(y), chunk_size):
                    chunk = y[i:i + chunk_size]
                    peaks.append(float(np.max(np.abs(chunk))))
                max_val = max(peaks) if peaks else 1.0
                if max_val > 0:
                    peaks = [round(p / max_val, 4) for p in peaks]
                peaks_data[stem_name] = peaks[:resolution]
            except Exception as e:
                log.warning(f"Peaks fallback failed for {stem_name}: {e}")
                peaks_data[stem_name] = []

    peaks_path = out_dir / "peaks.json"
    with open(str(peaks_path), "w") as pf:
        json.dump(peaks_data, pf, separators=(",", ":"))
    log.info(f"Waveform peaks saved to {peaks_path}")


def main():
    parser = argparse.ArgumentParser(description="Lehra Studio Python Fallback Tool")
    parser.add_argument("--process", action="store_true", help="Run audio pitch shift/time stretch and OGG encoding")
    parser.add_argument("--mode", type=str, choices=["peaks"], help="Run standalone waveform peaks generation")
    parser.add_argument("--dir", type=str, help="Directory containing stem files for peaks generation")
    parser.add_argument("--in", dest="input", type=str, help="Input asset file path")
    parser.add_argument("--out", dest="output", type=str, help="Output cache file path")
    parser.add_argument("--hz", type=float, default=146.83, help="Target pitch in Hz")
    parser.add_argument("--start", type=float, default=0.0, help="Loop start time in seconds")
    parser.add_argument("--end", type=float, default=0.0, help="Loop end time in seconds")
    parser.add_argument("--stretch", type=float, default=1.0, help="Time stretch factor")
    parser.add_argument("--base-hz", dest="base_hz", type=float, default=146.83, help="Base frequency of instrument")

    args = parser.parse_args()

    if args.mode == "peaks":
        if not args.dir:
            log.error("Missing --dir argument for peaks mode")
            sys.exit(1)
        run_peaks_process(args.dir)
    elif args.process:
        if not args.input or not args.output:
            log.error("Missing --in or --out arguments for process mode")
            sys.exit(1)
        run_audio_process(args.input, args.output, args.hz, args.start, args.end, args.stretch, args.base_hz)
    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
