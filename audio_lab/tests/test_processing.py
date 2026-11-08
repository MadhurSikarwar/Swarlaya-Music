"""Tests for audio_lab.processing on synthetic tabla/lehra signals.

Run from webapp/:   python -m pytest audio_lab/tests -q
No real recordings are used or needed.  The tests check measurements (loudness,
peak, band balance, pitch, timing); whether anything sounds good is for ears.
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


def write(path, x, subtype="PCM_24"):
    sf.write(path, x, SR, subtype=subtype)
    return path


def spec_for(tmp_path, tabla, lehra=None, **opts):
    out = tmp_path / "out"
    return P.JobSpec(tabla=tabla, lehra=lehra, out_dir=out, options=P.JobOptions.from_dict(opts), display_name="test clip")


# ── Measurements ─────────────────────────────────────────────────────────────

def test_loudness_agrees_between_pyloudnorm_and_ffmpeg(tmp_path):
    x = synth.make_tabla(10)
    path = write(tmp_path / "a.wav", x)
    ours = P.measure_lufs(sf.read(path, dtype="float32", always_2d=True)[0])
    theirs = P.ffmpeg_loudness(path)["lufs"]
    assert abs(ours - theirs) < 0.1


def test_true_peak_sees_what_the_sample_peak_misses():
    n = SR
    t = np.arange(n)
    x = np.sin(2 * np.pi * (SR / 4) * t / SR + math.pi / 4).astype(np.float32)   # samples at ±0.707, true peak 1.0
    x = np.stack([x, x], axis=1)
    assert P.sample_peak_db(x) == pytest.approx(-3.0, abs=0.1)
    assert P.true_peak_db(x) > -0.5


def test_bands_cover_the_spectrum_and_follow_the_signal():
    t = np.arange(SR * 4) / SR
    low = np.sin(2 * np.pi * 90 * t).astype(np.float32)
    high = np.sin(2 * np.pi * 3500 * t).astype(np.float32)
    b_low, b_high = P.band_energies(low), P.band_energies(high)
    assert max(b_low, key=b_low.get) == "bayan"
    assert max(b_high, key=b_high.get) == "attack"
    assert set(b_low) == set(P.BAND_NAMES) and len(P.BANDS) == 8


def test_clipping_is_counted_and_clean_audio_has_none():
    clipped = synth.make_tabla(8, clip_at=0.999)
    clean = synth.make_tabla(8, level_db=-12)
    assert P.count_clipping(clipped)["events"] > 0
    assert P.count_clipping(clean)["events"] == 0


def test_declip_moves_toward_the_original():
    t = np.arange(SR) / SR
    original = (1.15 * np.sin(2 * np.pi * 200 * t)).astype(np.float32)
    clipped = np.clip(original, -1.0, 1.0)
    stereo = np.stack([clipped, clipped], axis=1)
    fixed, runs = P.declip(stereo)
    mask = np.abs(clipped) >= 0.999
    assert runs > 0
    err_before = np.mean(np.abs(clipped[mask] - original[mask]))
    err_after = np.mean(np.abs(fixed[:, 0][mask] - original[mask]))
    assert err_after < 0.5 * err_before


def test_hum_is_found_and_notched():
    x = synth.make_tabla(10, hum_hz=50.0)
    hum = P.detect_hum(P.to_mono(x))
    assert hum and hum["hz"] == 50.0
    y = P.notch_hum(x, 50.0)
    assert P.detect_hum(P.to_mono(y)) is None
    assert P.detect_hum(P.to_mono(synth.make_tabla(10))) is None


def test_dayan_pitch_is_found_within_a_few_cents():
    x = synth.make_tabla(12, f0=196.0)
    p = P.estimate_dayan_pitch(P.to_mono(x))
    assert p and abs(1200 * math.log2(p["hz"] / 196.0)) < 10


def test_rhythm_counts_strokes_and_tempo():
    x = synth.make_tabla(14, beat=0.4)
    r = P.analyze_rhythm(P.to_mono(x))
    assert 30 <= r["strokes"] <= 38                      # 35 strokes in 14 s
    assert abs(r["bpm"] - 150) < 6


# ── Plans and chains ─────────────────────────────────────────────────────────

def _an(**bands):
    base = {"sub": -30, "bayan": -9, "low_mid": -8, "mud": -14, "mid": -10, "attack": -15, "brilliance": -25, "air": -35}
    base.update(bands)
    return {"bands_db": base, "bandwidth_hz": 20000}


def test_eq_gains_are_always_within_4_db():
    for bands in ({}, {"mud": -8, "attack": -40}, {"bayan": -40, "mid": 0}, {"attack": -5, "brilliance": -10}):
        plan = P.adaptive_eq(_an(**bands))
        for b in plan["bands"]:
            if "gain_db" in b:
                assert abs(b["gain_db"]) <= P.EQ_CLAMP_DB + 1e-9


def test_eq_adapts_to_the_measured_balance():
    base = {b["hz"]: b for b in P.adaptive_eq(_an())["bands"]}
    muddy = {b["hz"]: b for b in P.adaptive_eq(_an(mud=-9.5))["bands"]}          # within 3 dB of the bayan band
    dull = {b["hz"]: b for b in P.adaptive_eq(_an(attack=-30))["bands"]}
    assert muddy[320.0]["gain_db"] < base[320.0]["gain_db"]
    assert dull[3500.0]["gain_db"] > base[3500.0]["gain_db"]
    assert P.adaptive_eq(_an(attack=-30), strength=0.5)["bands"][4]["gain_db"] < dull[3500.0]["gain_db"]


def test_eq_leaves_a_bandlimited_top_alone():
    an = _an()
    an["bandwidth_hz"] = 6000
    air = [b for b in P.adaptive_eq(an)["bands"] if b["type"] == "high_shelf"][0]
    assert air["gain_db"] == 0.0


def test_limiter_holds_the_true_peak_ceiling():
    x = synth.make_tabla(10) * 40
    x = np.clip(x, -3, 3)
    y, reduction = P.true_peak_limiter(x, -1.0)
    assert P.true_peak_db(y) <= -0.95
    assert reduction > 3
    quiet = synth.make_tabla(5, level_db=-20)
    same, none = P.true_peak_limiter(quiet, -1.0)
    assert none == 0.0 and np.array_equal(same, quiet)


@pytest.mark.parametrize("target", ["reel", "loud"])
def test_master_lands_on_the_loudness_target(target):
    x = synth.make_tabla(12, mud_db=3)
    t = P.process_tabla(x, P.adaptive_eq(P.analyze(x)))
    y, info = P.master(t, P.TARGETS[target], "balanced", P.JobOptions())
    assert abs(P.measure_lufs(y) - P.TARGETS[target]) <= 0.1
    assert P.true_peak_db(y) <= P.TRUE_PEAK_CEILING_DBTP + 0.01
    assert info["iterations"] <= 8


def test_variants_differ_in_the_intended_bands():
    x = synth.make_tabla(12, mud_db=3)
    t = P.process_tabla(x, P.adaptive_eq(P.analyze(x)))
    out = {}
    for v in P.VARIANTS:
        y, _ = P.master(P.variant_tabla(t, v), -14.0, v, P.JobOptions())
        out[v] = P.analyze(y)["bands_db"]
    assert out["phone_bass"]["bayan"] > out["balanced"]["bayan"] + 1.0
    assert out["soft_highs"]["brilliance"] < out["balanced"]["brilliance"] - 1.0


# ── Lehra ────────────────────────────────────────────────────────────────────

def test_loop_keeps_its_length_and_smooths_the_seam():
    t = np.arange(int(SR * 2.003)) / SR                    # a non-integer number of cycles: a click at the seam
    x = np.stack([0.5 * np.sin(2 * np.pi * 220 * t)] * 2, axis=1).astype(np.float32)
    jump_before = abs(float(x[0, 0] - x[-1, 0]))
    loop = P.make_seamless_loop(x)
    assert len(loop) == len(x)
    assert abs(float(loop[0, 0] - loop[-1, 0])) < jump_before or jump_before < 0.02
    tiled = P.tile_loop(loop, len(loop) * 3, 0)
    assert np.max(np.abs(np.diff(tiled[:, 0]))) < 0.1       # no step anywhere, seams included


def test_ducking_stays_within_3_db_and_follows_the_tabla():
    tabla = synth.make_tabla(10)
    gain = P.duck_gain(tabla, 3.0)
    depth = -20 * np.log10(gain)
    assert depth.max() <= 3.01 and depth.max() > 2.0
    loud = np.argmax(np.abs(P.to_mono(tabla)))
    assert depth[loud:loud + 2000].mean() > depth.mean()


def test_lehra_level_follows_the_requested_loudness():
    tabla = P.process_tabla(synth.make_tabla(12), P.adaptive_eq(P.analyze(synth.make_tabla(12))))
    lehra = synth.make_lehra(6.4)
    track, info = P.build_lehra_track(lehra, tabla, -7.0, 0.0)
    want = P.measure_lufs(tabla) - 7.0
    # ducked up to 3 dB, so the finished track sits between target−3 and the target
    assert want - 3.5 <= P.measure_lufs(track) <= want + 0.5
    assert len(track) == len(tabla)
    assert abs(track[-1, 0]) < 1e-3                       # faded out


def test_offset_estimate_finds_a_known_shift():
    rng = np.random.default_rng(3)
    period = 4.0
    n_loop = int(period * SR)
    onsets = np.sort(rng.uniform(0, period - 0.3, 9))     # an irregular pattern, so the answer is unique
    onsets = np.round(onsets / 0.05) * 0.05

    def pulses(times, n, shift=0.0):
        y = np.zeros(n)
        for tt in times:
            a = int(((tt + shift) % period) * SR)
            seg = np.arange(int(0.12 * SR)) / SR
            y[a:a + len(seg)] += (np.sin(2 * np.pi * 400 * seg) * np.exp(-seg / 0.02))[:max(0, n - a)]
        return y

    lehra = pulses(onsets, n_loop)
    tabla = np.concatenate([pulses(onsets, n_loop, shift=0.6)] * 4)
    est = P.estimate_offset(tabla, lehra)
    assert est["offset_seconds"] == pytest.approx(0.6, abs=0.05)
    assert est["confidence"] > 0.5


def test_pitch_relation_measures_a_detuned_lehra():
    lehra = synth.make_lehra(9.6, tonic_hz=196.0, detune_cents=30.0)
    rel = P.pitch_relation(196.0, P.to_mono(lehra))
    assert rel and rel["offset_cents"] == pytest.approx(30.0, abs=10.0)
    in_tune = P.pitch_relation(196.0, P.to_mono(synth.make_lehra(9.6, tonic_hz=196.0)))
    assert abs(in_tune["offset_cents"]) < 10


def test_tempo_comparison_allows_double_and_half_time():
    assert P.compare_tempo(90.0, 180.0)["agree"] is True
    assert P.compare_tempo(150.0, 75.0)["agree"] is True
    assert P.compare_tempo(150.0, 120.0)["agree"] is False


def test_ring_retention_drops_when_a_gate_eats_the_sustain():
    x = synth.make_tabla(14, noise_db=-70)
    times = P.analyze_rhythm(P.to_mono(x))["onset_times"]
    before = P.ring_retention_db(x, times)
    from pedalboard import NoiseGate
    chopped = P.apply_board(P._board(NoiseGate(threshold_db=-14, ratio=10, attack_ms=1, release_ms=10)), x)
    after = P.ring_retention_db(chopped, times)
    assert before is not None and after is not None and after < before - 3


# ── Options, files and failure paths ─────────────────────────────────────────

def test_options_are_validated_and_clamped():
    o = P.JobOptions.from_dict({"lehra_db": -50, "bass_db": 9, "target": "loud", "offset_seconds": "auto"})
    assert o.lehra_db == -20 and o.bass_db == 3 and o.target_lufs == -11 and o.offset_seconds is None
    for bad in ({"target": "radio"}, {"lehra_db": "loud"}, {"variants": ["nope"]}, {"denoise": "maybe"}, {"bass_db": float("nan")}):
        with pytest.raises(P.AudioLabError) as e:
            P.JobOptions.from_dict(bad)
        assert e.value.status == 400


@needs_ffmpeg
def test_a_silent_recording_fails_gracefully(tmp_path):
    silent = write(tmp_path / "silent.wav", np.zeros((SR * 3, 2), dtype=np.float32))
    with pytest.raises(P.AudioLabError) as e:
        P.run_pipeline(spec_for(tmp_path, silent))
    assert e.value.code == "silent_input"
    near = write(tmp_path / "near.wav", np.random.default_rng(0).normal(0, 1e-6, (SR * 3, 2)).astype(np.float32))
    with pytest.raises(P.AudioLabError) as e:
        P.run_pipeline(spec_for(tmp_path, near))
    assert e.value.code == "silent_input"


@needs_ffmpeg
def test_too_short_and_not_audio_are_refused(tmp_path):
    short = write(tmp_path / "short.wav", synth.make_tabla(0.5))
    with pytest.raises(P.AudioLabError) as e:
        P.run_pipeline(spec_for(tmp_path, short))
    assert e.value.code == "too_short"
    fake = tmp_path / "fake.wav"
    fake.write_text("this is not audio at all")
    with pytest.raises(P.AudioLabError) as e:
        P.run_pipeline(spec_for(tmp_path, fake))
    assert e.value.code in ("unreadable", "unsupported")


@needs_ffmpeg
def test_ffmpeg_cannot_be_pointed_at_other_files_or_the_network(tmp_path):
    playlist = tmp_path / "evil.m3u8"
    playlist.write_text("#EXTM3U\n#EXTINF:1,\nhttp://127.0.0.1:9/never\n#EXT-X-ENDLIST\n")
    with pytest.raises(P.AudioLabError):
        P.probe(playlist)
    concat = tmp_path / "list.txt"
    concat.write_text("file '/etc/passwd'\n")
    with pytest.raises(P.AudioLabError):
        P.probe(concat)


def test_a_failed_gate_is_reported_loudly():
    base = P.analyze(synth.make_tabla(8))
    after = dict(base, lufs=-9.0, true_peak_db=0.5, clip_events=3, bands_db={**base["bands_db"], "attack": base["bands_db"]["attack"] + 9})
    gates = P.evaluate_gates(baseline=base, after=after, ffm={"lufs": -9.0, "true_peak_db": 0.5}, target=-14.0,
                             input_duration=8.0, output_duration=8.2)
    failed = {g["name"] for g in gates if not g["pass"]}
    assert failed == {"loudness_pyloudnorm", "loudness_ffmpeg", "true_peak", "no_new_clipping", "band_tilt", "duration"}
    assert not P.hard_pass(gates)


def test_the_tilt_gate_allows_what_a_variant_asks_for():
    base = P.analyze(synth.make_tabla(8))
    moved = dict(base, lufs=-14.0, true_peak_db=-1.5, clip_events=0, bands_db={**base["bands_db"], "bayan": base["bands_db"]["bayan"] + 7.5})
    ffm = {"lufs": -14.0, "true_peak_db": -1.5}
    plain = P.evaluate_gates(baseline=base, after=moved, ffm=ffm, target=-14.0, input_duration=8, output_duration=8)
    bass = P.evaluate_gates(baseline=base, after=moved, ffm=ffm, target=-14.0, input_duration=8, output_duration=8,
                            allowance=P.tilt_allowance("phone_bass", P.JobOptions()))
    assert not next(g for g in plain if g["name"] == "band_tilt")["pass"]
    assert next(g for g in bass if g["name"] == "band_tilt")["pass"]


# ── The whole pipeline ───────────────────────────────────────────────────────

@needs_ffmpeg
def test_tabla_only_pipeline_passes_every_gate(tmp_path):
    src = write(tmp_path / "tabla.wav", synth.make_tabla(12, mud_db=3))
    steps = []
    report = P.run_pipeline(spec_for(tmp_path, src, target="reel"), lambda s, f, m: steps.append((s, f)))
    assert [f for _, f in steps] == sorted(f for _, f in steps) and steps[-1] == ("done", 1.0)
    assert report["default_variant"] == "phone_bass"
    assert set(report["variants"]) == {"balanced", "phone_bass", "soft_highs"}
    for name, v in report["variants"].items():
        assert v["passed"], (name, [g for g in v["gates"] if not g["pass"]])
        gates = {g["name"]: g for g in v["gates"]}
        assert abs(gates["loudness_pyloudnorm"]["value"] + 14) <= 0.3 and abs(gates["loudness_ffmpeg"]["value"] + 14) <= 0.3
        assert gates["true_peak"]["value"] <= -0.99
        for key in ("wav", "mp3", "aac"):
            assert (tmp_path / "out" / v["files"][key]).stat().st_size > 1000
    info = sf.info(tmp_path / "out" / "balanced.wav")
    assert info.subtype == "PCM_24" and info.samplerate == SR
    assert (tmp_path / "out" / "original.mp3").exists()
    data = json.loads((tmp_path / "out" / "report.json").read_text(encoding="utf-8"))   # strict JSON: no NaN/Infinity
    assert data["before"]["lufs"] == pytest.approx(report["before"]["lufs"], abs=1e-6)
    assert data["dayan_pitch"]["hz"] == pytest.approx(196.0, rel=0.01)
    spectro = json.loads((tmp_path / "out" / "spectrograms.json").read_text())
    assert {"before", "balanced", "phone_bass", "soft_highs"} <= set(spectro)
    assert not (tmp_path / "out" / "work").exists()


@needs_ffmpeg
def test_a_clipped_noisy_input_is_repaired_and_still_passes(tmp_path):
    x = synth.make_tabla(12, clip_at=0.999, noise_db=-40, hum_hz=50.0)
    src = write(tmp_path / "bad.wav", x)
    report = P.run_pipeline(spec_for(tmp_path, src, target="reel", variants=["balanced"]))
    assert report["before"]["clip_events"] > 0
    assert report["repairs"]["declip"]["applied"]
    assert report["repairs"]["hum"]["hz"] == 50.0
    v = report["variants"]["balanced"]
    assert v["passed"] and v["after"]["clip_events"] == 0


@needs_ffmpeg
def test_video_in_video_out_with_a_lehra(tmp_path):
    audio = write(tmp_path / "a.wav", synth.make_tabla(10, mud_db=3))
    video = tmp_path / "clip.mp4"
    r = subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=160x120:rate=25:duration=10",
                        "-i", str(audio), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(video)])
    assert r.returncode == 0
    lehra = write(tmp_path / "lehra.wav", synth.make_lehra(6.4))
    report = P.run_pipeline(spec_for(tmp_path, video, lehra, target="youtube", variants=["balanced", "phone_bass"]))
    assert report["input"]["has_video"] and report["lehra"]["level"]["ducking_max_db"] <= 3.01
    for v in report["variants"].values():
        assert v["passed"], [g for g in v["gates"] if not g["pass"]]
        out = tmp_path / "out" / v["files"]["mp4"]
        info_in, info_out = P.probe(video), P.probe(out)
        assert info_out["video_codec"] == info_in["video_codec"] == "h264"
        assert abs(info_out["duration_s"] - info_in["duration_s"]) <= 0.05
    # the video stream is copied, not re-encoded: same frame count
    def frames(p):
        o = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-count_packets", "-show_entries",
                            "stream=nb_read_packets", "-of", "csv=p=0", str(p)], capture_output=True, text=True)
        return int(o.stdout.strip())
    assert frames(video) == frames(tmp_path / "out" / report["variants"]["balanced"]["files"]["mp4"])


@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="needs ffmpeg")
def test_reference_matching_when_matchering_is_installed(tmp_path):
    pytest.importorskip("matchering")
    mix = synth.make_tabla(10, mud_db=3)
    ref = write(tmp_path / "ref.wav", synth.make_tabla(10, seed=5, level_db=-9))
    y = P.apply_reference(mix, ref, tmp_path)
    assert y.shape == mix.shape and np.isfinite(y).all() and P.sample_peak_db(y) > -30
