"""Tests for the Audio Lab's second wave: edits, recorder sync, tanpura, riyaz insights, video and clips.

Synthetic signals only.  Run from webapp/:   python -m pytest audio_lab/tests -q
"""
import json
import math
import shutil
import subprocess

import numpy as np
import pytest
import soundfile as sf

import synth
from audio_lab import processing as P

SR = P.SR
needs_ffmpeg = pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg not installed")


def write(path, x):
    sf.write(path, x, SR, subtype="PCM_24")
    return path


def video_size(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height",
                          "-of", "json", str(path)], capture_output=True, text=True).stdout
    s = json.loads(out)["streams"][0]
    return s["width"], s["height"]


def make_video(tmp_path, audio, seconds=5):
    video = tmp_path / "clip.mp4"
    r = subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"testsrc=size=320x240:rate=25:duration={seconds}",
                        "-i", str(audio), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(video)])
    assert r.returncode == 0
    return video


# ── Edits ────────────────────────────────────────────────────────────────────

def test_trim_speed_and_pitch_edits():
    x = synth.make_tabla(10)
    y, info = P.apply_edits(x, P.JobOptions.from_dict({"trim_start": 2, "trim_end": 6}))
    assert abs(len(y) / SR - 4.0) < 1e-3 and info["trim"] == [2.0, 6.0] and info["start_s"] == 2.0
    faster, info = P.apply_edits(x, P.JobOptions.from_dict({"tempo_factor": 1.25}))
    assert abs(len(faster) / SR - 8.0) < 0.05 and info["tempo_factor"] == 1.25
    up, _ = P.apply_edits(x, P.JobOptions.from_dict({"shift_cents": 100}))
    assert abs(len(up) - len(x)) < SR * 0.02, "pitch shift keeps the length (the video stays in sync)"
    before, after = P.estimate_dayan_pitch(P.to_mono(x)), P.estimate_dayan_pitch(P.to_mono(up))
    assert 1200 * math.log2(after["hz"] / before["hz"]) == pytest.approx(100, abs=15)


def test_fades_start_and_end_in_silence():
    x = np.ones((SR * 2, 2), dtype=np.float32)
    y = P.apply_fades(x, 500, 1000)
    assert y[0, 0] == pytest.approx(0, abs=1e-6) and y[-1, 0] == pytest.approx(0, abs=1e-3)
    assert y[SR, 0] == 1.0 and y[int(0.25 * SR), 0] == pytest.approx(0.5, abs=0.02)


def test_sa_folds_into_the_lehra_players_range():
    assert P.fold_sa(277.18) == pytest.approx(138.59)
    assert P.fold_sa(69.3) == pytest.approx(138.6)
    assert 87.31 <= P.fold_sa(500.0) <= 207.65


# ── A second recorder ────────────────────────────────────────────────────────

def _other_mic(x, delay_s, seed=4):
    """The same performance through another microphone: different tone, more noise, started at another time."""
    import scipy.signal as sps
    rng = np.random.default_rng(seed)
    sos = sps.butter(2, [120, 6000], btype="band", fs=SR, output="sos")
    y = sps.sosfilt(sos, x, axis=0).astype(np.float32) * 0.6
    y += rng.normal(0, 10 ** (-42 / 20), y.shape).astype(np.float32)
    if delay_s >= 0:
        y = np.concatenate([rng.normal(0, 10 ** (-42 / 20), (int(delay_s * SR), 2)).astype(np.float32), y])
    else:
        y = y[int(-delay_s * SR):]
    return y


@pytest.mark.parametrize("delay", [1.2345, -0.8])
def test_a_second_recorder_is_found_to_the_millisecond(delay):
    x = synth.make_tabla(20, pattern=["dha", "na", "ka", "dha", "ge", "na", "na", "ka", "dha", "ka", "na", "ge", "na", "dha", "ka", "na"])
    other = _other_mic(x, delay)
    s = P.sync_recordings(x, other)
    assert s["lag_s"] == pytest.approx(delay, abs=0.002)
    assert s["confidence"] > 0.5
    aligned = P.align_recording(other, len(x), s["lag_s"])
    again = P.sync_recordings(x, aligned, max_lag_s=2.0)
    assert abs(again["lag_s"]) < 0.002


def test_clock_drift_between_two_devices_is_measured_and_corrected():
    import soxr
    x = synth.make_tabla(75, pattern=["dha", "na", "ka", "dha", "ge", "na", "na", "ka", "dha", "ka", "na", "ge", "na", "dha", "ka", "na"])
    drift = 120e-6     # the other device's clock runs 120 ppm fast: the same music takes longer there
    stretched = soxr.resample(x, SR, SR * (1 + drift)).astype(np.float32)
    other = _other_mic(stretched, 0.5)
    s = P.sync_recordings(x, other)
    assert s["drift_ppm"] == pytest.approx(120, abs=25)
    aligned = P.align_recording(other, len(x), s["lag_s"], s["drift_ppm"])
    tail = P.sync_recordings(x[-20 * SR:], aligned[-20 * SR:], max_lag_s=1.0)
    assert abs(tail["lag_s"]) < 0.002, "still lined up at the end"


# ── Tanpura ──────────────────────────────────────────────────────────────────

@pytest.mark.skipif(not P.TANPURA_FILE.exists(), reason="the site's tanpura recording is not here")
def test_the_tanpura_is_tuned_to_the_chosen_sa():
    t = P.build_tanpura(SR * 12, 138.59)
    assert t.shape == (SR * 12, 2) and np.isfinite(t).all()
    p = P.estimate_dayan_pitch(P.to_mono(t), fmin=65.0)
    rel = (1200 * math.log2(p["hz"] / 138.59)) % 1200
    assert min(rel, 1200 - rel, abs(rel - 702)) < 25, f"lands on Sa or Pa of C#, not {rel:.0f} cents"


# ── Riyaz insights ───────────────────────────────────────────────────────────

def test_laya_report_sees_rushing_and_steadiness():
    steady = P.laya_report(P.to_mono(synth.make_tabla(30)))
    rushed = P.laya_report(P.to_mono(synth.make_tabla(30, accelerate=0.15)))
    assert abs(steady["drift_pct"]) < 3 and steady["variation_pct"] < 3
    assert rushed["drift_pct"] > 8
    assert len(rushed["curve"]) > 10


def test_stroke_levels_measure_evenness_and_trend():
    x = synth.make_tabla(20, pattern=["na"] * 16, noise_db=-70)
    even = P.stroke_levels(x, P.analyze_rhythm(P.to_mono(x))["onset_times"])
    fade = x * np.linspace(1.0, 10 ** (-12 / 20), len(x), dtype=np.float32)[:, None]
    fading = P.stroke_levels(fade, P.analyze_rhythm(P.to_mono(fade))["onset_times"])
    assert even["spread_db"] < 2
    assert fading["trend_db_per_min"] < -20      # −12 dB over 20 s


def test_stroke_types_sort_the_four_families():
    pattern = ["dha", "na", "ge", "ka"] * 4
    x = synth.make_tabla(19.2, pattern=pattern, noise_db=-70, beat=0.3)
    onsets = P.analyze_rhythm(P.to_mono(x))["onset_times"]
    r = P.stroke_types(x, onsets, 196.0)
    want = {"dha": "combined", "na": "resonant", "ge": "bass", "ka": "closed"}
    right = total = 0
    for t, kind in r["strokes"]:
        i = round(t / 0.3)
        if abs(t - i * 0.3) < 0.03:
            total += 1
            right += kind == want[pattern[i % len(pattern)]]
    assert total > 40 and right / total >= 0.85, f"{right}/{total}"


def test_sam_accuracy_in_milliseconds():
    sams = [2.0, 7.0, 12.0, 17.0]
    onsets = [1.98, 2.5, 7.03, 9.0, 12.01, 16.5]
    r = P.sam_accuracy(onsets, sams)
    assert r["hit"] == 3 and r["missed"] == 1
    assert r["mean_ms"] == pytest.approx((-20 + 30 + 10) / 3, abs=0.01)


def test_tuning_check_against_sa_pa_and_ma():
    assert P.tuning_check({"hz": 277.18}, 138.59)["tuned_to"] == "Sa"
    pa = P.tuning_check({"hz": 207.65}, 138.59)
    assert pa["tuned_to"] == "Pa" and abs(pa["cents"]) < 5
    off = P.tuning_check({"hz": 277.18 * 2 ** (30 / 1200)}, 138.59)
    assert off["cents"] == pytest.approx(30, abs=0.5) and not off["in_tune"]
    assert P.tuning_check(None, 138.59) is None


# ── Video and clips ──────────────────────────────────────────────────────────

@needs_ffmpeg
def test_vertical_video_with_a_title_in_two_scripts(tmp_path):
    audio = write(tmp_path / "a.wav", synth.make_tabla(5))
    video = make_video(tmp_path, audio)
    out = tmp_path / "v.mp4"
    P.render_video(audio=audio, out=out, work=tmp_path / "w", video=video, fmt="vertical", title="Raag Bhimpalasi · तीनताल")
    assert video_size(out) == (1080, 1920)
    assert abs(P.probe(out)["duration_s"] - 5.0) < 0.1


@needs_ffmpeg
def test_trimmed_video_keeps_the_kept_part(tmp_path):
    audio = write(tmp_path / "a.wav", synth.make_tabla(3))
    video = make_video(tmp_path, write(tmp_path / "full.wav", synth.make_tabla(8)), seconds=8)
    out = tmp_path / "t.mp4"
    P.render_video(audio=audio, out=out, work=tmp_path / "w", video=video, start_s=2.0, duration_s=3.0)
    assert abs(P.probe(out)["duration_s"] - 3.0) < 0.1 and video_size(out) == (320, 240)


@needs_ffmpeg
def test_audio_only_gets_a_waveform_video(tmp_path):
    audio = write(tmp_path / "a.wav", synth.make_tabla(4))
    out = tmp_path / "w.mp4"
    P.render_video(audio=audio, out=out, work=tmp_path / "w", video=None, fmt="square", title="Kaida")
    info = P.probe(out)
    assert info["has_video"] and abs(info["duration_s"] - 4.0) < 0.1 and video_size(out) == (1080, 1080)


@needs_ffmpeg
@pytest.mark.parametrize("with_video", [True, False])
def test_before_after_clip(tmp_path, with_video):
    before = synth.make_tabla(10, level_db=-20)
    after = synth.make_tabla(10, level_db=-6)
    video = make_video(tmp_path, write(tmp_path / "a.wav", before), seconds=10) if with_video else None
    out = tmp_path / "ab.mp4"
    clip = P.make_ab_clip(before=before, after=after, out=out, work=tmp_path / "w", video=video, seconds=3.0,
                          fmt="vertical" if with_video else "square")
    assert clip["seconds"] == pytest.approx(3.0)
    assert abs(P.probe(out)["duration_s"] - 6.0) < 0.15


# ── The analysis job and a full run with the new options ─────────────────────

@needs_ffmpeg
def test_analysis_gives_a_preview_and_suggestions(tmp_path):
    src = write(tmp_path / "t.wav", synth.make_tabla(10, f0=277.18))
    r = P.run_analysis(P.JobSpec(tabla=src, out_dir=tmp_path / "out"))
    assert (tmp_path / "out" / "preview.mp3").stat().st_size > 1000
    assert r["suggested_sa"]["note"] == "C#3" and abs(r["suggested_sa"]["hz"] - 138.59) < 1.5
    assert json.loads((tmp_path / "out" / "analysis.json").read_text(encoding="utf-8"))["kind"] == "analysis"


@needs_ffmpeg
def test_full_run_with_trim_tanpura_catalogue_lehra_and_clip(tmp_path):
    src = write(tmp_path / "t.wav", synth.make_tabla(16, mud_db=3))
    lehra = write(tmp_path / "l.wav", synth.make_lehra(6.4))
    opts = P.JobOptions.from_dict({
        "trim_start": 1.0, "trim_end": 15.0, "fade_out_ms": 800, "reverb": "temple",
        "tanpura_db": -16 if P.TANPURA_FILE.exists() else None, "sa_hz": 196.0,
        "lehra_meta": {"bpm": 150, "beats": 16}, "offset_seconds": 0.0,
        "audio_video": True, "video_format": "square", "title": "Teentaal", "ab_clip": True,
        "variants": ["balanced"],
    })
    r = P.run_pipeline(P.JobSpec(tabla=src, lehra=lehra, out_dir=tmp_path / "out", options=opts))
    v = r["variants"]["balanced"]
    assert v["passed"], [g for g in v["gates"] if not g["pass"]]
    assert abs(v["after"]["duration_s"] - 14.0) < 0.01
    assert {"wav", "mp3", "aac", "mp4"} <= set(v["files"])
    assert (tmp_path / "out" / "ab_clip.mp4").exists() and r["files"]["ab_clip"] == "ab_clip.mp4"
    ins = r["insights"]
    assert ins["laya"] and ins["strokes"] and ins["stroke_types"] and ins["tuning"]["tuned_to"] == "Sa"
    assert ins["sam"]["sams"] == 2, "a catalogue lehra gives exact sams: 5.4 s and 11.8 s after the trim"
    assert r["edits"]["trim"] == [1.0, 15.0]
    assert r["baseline"]["kind"] in ("tabla_and_lehra", "all_tracks")


@pytest.mark.parametrize("profile", ["vocal", "harmonium", "sitar", "pakhawaj", "kathak"])
def test_every_profile_has_a_complete_chain(profile):
    x = synth.make_tabla(4)
    plan = P.adaptive_eq(P.analyze(x), profile=profile)
    y = P.process_tabla(x, plan, profile=profile, reverb="hall")
    assert y.shape == x.shape and np.isfinite(y).all()
    for band in plan["bands"]:
        assert abs(band.get("gain_db", 0)) <= P.EQ_CLAMP_DB + 1e-9


def test_new_options_are_validated():
    bad = [{"noise_region": [3, 3.1]}, {"noise_region": "x"}, {"trim_start": 5, "trim_end": 5.5},
           {"lehra_meta": {"bpm": 5000, "beats": 16}}, {"lehra_meta": "x"}, {"profile": "guitar"},
           {"reverb": "cathedral"}, {"video_format": "wide"}, {"title": 5}, {"tempo_factor": True}]
    for raw in bad:
        with pytest.raises(P.AudioLabError):
            P.JobOptions.from_dict(raw)
    o = P.JobOptions.from_dict({"target": "custom", "custom_lufs": -30, "title": "a\nb\x07c" + "x" * 200, "tempo_factor": 3})
    assert o.target_lufs == -24 and o.title.startswith("a b c") and len(o.title) == 80 and o.tempo_factor == 1.25
