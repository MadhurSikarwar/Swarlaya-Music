"""Tests for the serverless build (audio_lab/serverless.py, the Vercel Function) and what it relies on:
the ffmpeg-only probe, and run_pipeline split by version (lead / require_pass).

Vercel Blob is replaced by a dictionary; the worker process, ffmpeg and the DSP are real.
Run from webapp/:   python -m pytest audio_lab/tests/test_serverless.py -q
"""
import io
import json
import os
import shutil
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest
import soundfile as sf

import synth
from starlette.testclient import TestClient

from audio_lab import processing as P
from audio_lab import serverless as S

pytestmark = pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg not installed")

JOB = "0123456789abcdef0123456789abcdef"
TABLA = f"audio-lab/{JOB}/in/tabla-1a2b3c4d.wav"


def wav_bytes(x):
    buf = io.BytesIO()
    sf.write(buf, x, 48000, format="WAV", subtype="PCM_16")
    return buf.getvalue()


@pytest.fixture()
def store(monkeypatch):
    """A fake Blob store: pathname → bytes."""
    files = {}
    monkeypatch.setenv("BLOB_STORE_ID", "store_test")

    def download(pathname, dest, limit):
        if pathname not in files:
            raise P.AudioLabError("not_found", "missing", 404)
        data = files[pathname]
        if len(data) > limit:
            raise P.AudioLabError("too_large", "too large", 413)
        Path(dest).write_bytes(data)
        return len(data)

    def upload(path, pathname):
        files[pathname] = Path(path).read_bytes()
        return {"url": f"https://blob.test/{pathname}", "download": f"https://blob.test/{pathname}?download=1",
                "pathname": pathname}

    monkeypatch.setattr(S, "_download", download)
    monkeypatch.setattr(S, "_upload", upload)
    return files


@pytest.fixture(scope="module")
def client():
    # one client, started once: on Windows a TestClient's event-loop thread can fail to start (and hang) when many
    # are created in one process — a test-harness problem; Vercel runs the app in its own server
    with TestClient(S.app) as c:
        yield c


def lines(response):
    return [json.loads(line) for line in response.text.splitlines() if line.strip()]


def run(client, **body):
    payload = {"job": JOB, "run": "a1b2c3d4", "mode": "master", "inputs": {"tabla": TABLA}, "options": {}, "name": "my take.wav"}
    payload.update(body)
    return lines(client.post("/api/master/run", json=payload))


# ── the ffmpeg-only probe ────────────────────────────────────────────────────────────────────────────────

def test_probe_without_ffprobe_matches_ffprobe(tmp_path, monkeypatch):
    if shutil.which("ffprobe") is None:
        pytest.skip("needs ffprobe to compare against")
    wav = tmp_path / "a.wav"
    sf.write(wav, synth.make_tabla(3), 48000, subtype="PCM_16")
    mp4 = tmp_path / "v.mp4"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=160x120:rate=25:duration=3",
                    "-i", str(wav), "-c:v", "libx264", "-c:a", "aac", "-shortest", str(mp4)], check=True)
    mono = tmp_path / "m.mp3"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(wav), "-ac", "1", str(mono)], check=True)
    real = P._find_binary
    for f in (wav, mp4, mono):
        a = P.probe(f)
        monkeypatch.setattr(P, "_find_binary", lambda n: None if n == "ffprobe" else real(n))
        b = P.probe(f)
        monkeypatch.setattr(P, "_find_binary", real)
        assert {k: v for k, v in a.items() if k != "duration_s"} == {k: v for k, v in b.items() if k != "duration_s"}
        assert abs(a["duration_s"] - b["duration_s"]) < 0.011


def test_probe_without_ffprobe_rejects_non_media(tmp_path, monkeypatch):
    junk = tmp_path / "x.wav"
    junk.write_bytes(b"this is not audio" * 100)
    real = P._find_binary
    monkeypatch.setattr(P, "_find_binary", lambda n: None if n == "ffprobe" else real(n))
    with pytest.raises(P.AudioLabError):
        P.probe(junk)


# ── the function ────────────────────────────────────────────────────────────────────────────────────────

def test_health(client, monkeypatch):
    monkeypatch.delenv("BLOB_STORE_ID", raising=False)
    monkeypatch.delenv("BLOB_READ_WRITE_TOKEN", raising=False)
    h = client.get("/api/master/health").json()
    assert h["service"] == "audio-lab" and h["status"] == "unconfigured"      # the page then says "not connected"
    monkeypatch.setenv("BLOB_STORE_ID", "store_x")
    h = client.get("/api/master?op=health").json()                             # how the vercel.json rewrite calls it
    assert h["status"] == "ok" and h["serverless"]["max_seconds"] == S.MAX_SECONDS
    assert h["features"]["demucs"] is False and "phone_bass" in h["features"]["variants"]
    assert client.get("/api/master/nothing").status_code == 404
    assert client.get("/api/master/run").status_code == 405


@pytest.mark.parametrize("body", [
    {"job": "nothex"},
    {"inputs": {"tabla": f"audio-lab/{'f' * 32}/in/tabla.wav"}},          # another job's upload
    {"inputs": {"tabla": f"audio-lab/{JOB}/in/../../etc/passwd"}},
    {"inputs": {"lehra": f"audio-lab/{JOB}/in/tabla.wav"}},               # a role must be its own file
    {"inputs": {"lehra": f"audio-lab/{JOB}/in/lehra.wav"}},               # no tabla
    {"options": {"target": "nonsense"}},
])
def test_run_rejects_bad_requests(client, store, body):
    payload = {"job": JOB, "run": "a1b2c3d4", "mode": "master", "inputs": {"tabla": TABLA}, "options": {}}
    payload.update(body)
    r = client.post("/api/master/run", json=payload)
    assert r.status_code == 400


def test_run_needs_storage(client, monkeypatch):
    monkeypatch.delenv("BLOB_STORE_ID", raising=False)
    monkeypatch.delenv("BLOB_READ_WRITE_TOKEN", raising=False)
    r = client.post("/api/master/run", json={"job": JOB, "run": "a1b2c3d4", "inputs": {"tabla": TABLA}})
    assert r.status_code == 503 and r.json()["code"] == "unconfigured"


def test_analyse_then_master_by_version(client, store):
    store[TABLA] = wav_bytes(synth.make_tabla(8, mud_db=3))
    out = run(client, mode="analyse", run="0000aaaa")
    assert out[0]["type"] == "progress" and out[-1]["type"] == "result", out[-1]
    res = out[-1]
    assert res["kind"] == "analyse"
    assert res["report"]["kind"] == "analysis" and "preview.mp3" in res["files"]
    preview = res["files"]["preview.mp3"]["pathname"]
    assert preview == f"audio-lab/{JOB}/out/0000aaaa/my-take-preview.mp3" and preview in store
    assert all(0 <= m["progress"] <= 1 for m in out if m["type"] == "progress")

    lead = run(client, run="1111bbbb", options={"variants": ["phone_bass"], "ab_clip": True}, lead=True, require_pass=False)[-1]
    other = run(client, run="2222cccc", options={"variants": ["balanced"]}, lead=False, require_pass=False)[-1]
    assert lead["type"] == other["type"] == "result"
    assert set(lead["report"]["variants"]) == {"phone_bass"} and "original.mp3" in lead["files"]
    assert "ab_clip.mp4" in lead["files"] and lead["spectrograms"]["phone_bass"]
    assert "original.mp3" not in other["files"] and set(other["report"]["variants"]) == {"balanced"}
    for name, f in {**lead["files"], **other["files"]}.items():
        assert f["pathname"] in store and f["pathname"].startswith(f"audio-lab/{JOB}/out/")
        assert f["download"].endswith("?download=1")
    assert lead["files"]["phone_bass.wav"]["pathname"].endswith("/my-take-phone-bass.wav")
    assert not list(S.TMP.glob("audio-lab-1111bbbb")), "the work folder is removed"
    # every run's last line is also kept in Blob: a browser whose stream the edge cut collects it from there
    for run_id, line in (("0000aaaa", res), ("1111bbbb", lead), ("2222cccc", other)):
        assert json.loads(store[f"audio-lab/{JOB}/out/{run_id}/result.json"]) == line


def test_run_limits(client, store, monkeypatch):
    store[TABLA] = wav_bytes(synth.make_tabla(8))
    monkeypatch.setattr(S, "MAX_SECONDS", 5)
    out = run(client)
    assert out[-1]["type"] == "error" and out[-1]["code"] == "over_limit"
    out = run(client, options={"trim_start": 1.0, "trim_end": 5.5, "variants": ["balanced"]}, lead=False)
    assert out[-1]["type"] == "result"                                         # what is kept is what counts
    monkeypatch.setattr(S, "MAX_UPLOAD_MB", 0.01)
    out = run(client)
    assert out[-1]["code"] == "too_large"
    out = run(client, inputs={"tabla": TABLA, "lehra": f"audio-lab/{JOB}/in/lehra-00000000.wav"})   # not uploaded
    assert out[-1]["type"] == "error"


def test_one_run_at_a_time(client, store):
    store[TABLA] = wav_bytes(synth.make_tabla(4))
    assert S._busy.acquire(blocking=False)
    try:
        out = run(client)
    finally:
        S._busy.release()
    assert out == [{"type": "error", "code": "busy", "message": out[0]["message"], "retry": True}]
    assert S._busy.acquire(blocking=False)                       # a finished run gives the lock back
    S._busy.release()


def test_bad_input_is_reported_and_the_lock_released(client, store):
    store[TABLA] = b"not audio at all" * 200
    out = run(client)
    assert out[-1]["type"] == "error" and out[-1]["code"] in ("unreadable", "unsupported")
    assert S._busy.acquire(blocking=False)
    S._busy.release()
    assert json.loads(store[f"audio-lab/{JOB}/out/a1b2c3d4/result.json"]) == out[-1], "the error is kept too"


def test_a_run_finishes_and_keeps_its_result_with_nobody_reading(store):
    # On Vercel the edge cuts a browser's HTTP/2 stream after about a minute; the work must not depend on it
    import asyncio
    store[TABLA] = wav_bytes(synth.make_tabla(4))
    req = S._validate_run({"job": JOB, "run": "3333dddd", "mode": "analyse", "inputs": {"tabla": TABLA}, "name": "t.wav"})
    assert S._busy.acquire(blocking=False)

    async def main():
        task = S._start(req, asyncio.Queue())               # nobody ever reads its queue
        await asyncio.wait_for(task, 240)

    asyncio.run(main())
    assert json.loads(store[f"audio-lab/{JOB}/out/3333dddd/result.json"])["type"] == "result"
    assert S._busy.acquire(blocking=False), "the lock is given back"
    S._busy.release()


class FakeBlob:
    def __init__(self, listing):
        self.listing, self.deleted = listing, []

    def query_blobs(self, prefix=None):
        return [b for b in self.listing if b.pathname.startswith(prefix or "")]

    def delete_blob(self, paths):
        self.deleted.extend([paths] if isinstance(paths, str) else paths)


def test_delete_only_this_jobs_files(client, monkeypatch):
    monkeypatch.setenv("BLOB_STORE_ID", "store_x")
    fake = FakeBlob([])
    monkeypatch.setattr(S, "_blob", lambda: fake)
    ok = [TABLA, f"audio-lab/{JOB}/out/1111bbbb/my-take-phone-bass.wav"]
    assert client.post("/api/master/delete", json={"job": JOB, "paths": ok}).json() == {"deleted": 2}
    assert fake.deleted == ok
    for bad in ([f"audio-lab/{'e' * 32}/in/tabla.wav"], ["somewhere/else.wav"], [f"audio-lab/{JOB}/../x"]):
        assert client.post("/api/master/delete", json={"job": JOB, "paths": bad}).status_code == 400
    assert fake.deleted == ok


def test_cleanup_deletes_only_old_files(client, monkeypatch):
    monkeypatch.setenv("BLOB_STORE_ID", "store_x")
    now = datetime.now(timezone.utc)
    fake = FakeBlob([SimpleNamespace(pathname="audio-lab/a/in/tabla.wav", uploaded_at=now - timedelta(hours=30)),
                     SimpleNamespace(pathname="audio-lab/b/in/tabla.wav", uploaded_at=now - timedelta(hours=2)),
                     SimpleNamespace(pathname="other/keep.png", uploaded_at=now - timedelta(days=90))])
    monkeypatch.setattr(S, "_blob", lambda: fake)
    monkeypatch.setenv("CRON_SECRET", "s3cret")
    assert client.get("/api/master/cleanup").status_code == 401
    r = client.get("/api/master/cleanup", headers={"Authorization": "Bearer s3cret"})
    assert r.json() == {"deleted": 1} and fake.deleted == ["audio-lab/a/in/tabla.wav"]


def test_the_worker_sees_the_same_packages(monkeypatch):
    # Vercel's Python runtime puts the function's packages on sys.path at start-up (no site-packages),
    # so a plain `python worker.py` child could not import numpy and died at once: pass the path on.
    monkeypatch.setattr(sys, "path", ["", "/var/task/_vendor", "/var/task"])
    monkeypatch.setenv("PYTHONPATH", "/already/set")
    env = S._worker_env()
    assert env["PYTHONPATH"].split(os.pathsep) == ["/var/task/_vendor", "/var/task", "/already/set"]
    assert env["PYTHONUNBUFFERED"] == "1"
    # a function has one CPU: the worker yields it to this process, which streams the progress and the pings
    assert env["AUDIO_LAB_NICE"] == "10"


def test_the_worker_lowers_its_own_priority_when_asked(monkeypatch):
    import audio_lab.worker as W
    calls = []
    monkeypatch.setattr(os, "nice", lambda n: calls.append(n) or n, raising=False)
    monkeypatch.setenv("AUDIO_LAB_NICE", "10")
    W.lower_priority()
    monkeypatch.delenv("AUDIO_LAB_NICE")
    W.lower_priority()
    assert calls == [10]


def test_lazy_stubs_stand_in_when_the_bundle_drops_pyi_files(tmp_path, monkeypatch):
    # Vercel's bundle leaves out *.pyi, and librosa builds its namespace from them (lazy_loader.attach_stub):
    # `import librosa` failed with "Cannot load imports from non-existent stub". A package with no .pyi
    # beside it must load from audio_lab/lazy_stubs/<package>.pyi.txt instead.
    pkg = tmp_path / "pkgs" / "stubbed"
    pkg.mkdir(parents=True)
    (pkg / "__init__.py").write_text("import lazy_loader as lazy\n__getattr__, __dir__, __all__ = lazy.attach_stub(__name__, __file__)\n")
    (pkg / "inner.py").write_text("def twice(x):\n    return 2 * x\n")
    stubs = tmp_path / "stubs"
    stubs.mkdir()
    (stubs / "stubbed.pyi.txt").write_text("from .inner import twice\n")
    monkeypatch.setattr(P, "LAZY_STUBS", stubs)
    monkeypatch.syspath_prepend(str(tmp_path / "pkgs"))
    P.use_bundled_lazy_stubs()
    import stubbed
    assert stubbed.twice(21) == 42


def test_libatomic_is_loaded_from_the_bundle_only_when_the_system_has_none(monkeypatch):
    # Vercel's image has no libatomic.so.1, so `from pedalboard import …` failed when mastering
    import ctypes
    loaded = []

    def cdll(name, mode=0):
        if name == "libatomic.so.1" and missing:
            raise OSError("libatomic.so.1: cannot open shared object file")
        loaded.append((name, mode))

    monkeypatch.setattr(ctypes, "CDLL", cdll)
    monkeypatch.setattr(sys, "platform", "linux")
    missing = False
    assert P.preload_libatomic() == "system" and loaded == [("libatomic.so.1", ctypes.RTLD_GLOBAL)]
    loaded.clear()
    missing = True
    assert P.preload_libatomic() == "bundled"
    assert loaded == [(str(P.NATIVE / "libatomic.so.1"), ctypes.RTLD_GLOBAL)]
    assert (P.NATIVE / "libatomic.so.1").read_bytes()[:4] == b"\x7fELF"
    monkeypatch.setattr(sys, "platform", "win32")
    assert P.preload_libatomic() is None


def test_the_bundled_librosa_stubs_are_librosas_own():
    pytest.importorskip("librosa")
    import librosa
    root = Path(librosa.__file__).parent
    for name, rel in [("librosa", "__init__.pyi"), ("librosa.core", "core/__init__.pyi"),
                      ("librosa.feature", "feature/__init__.pyi"), ("librosa.util", "util/__init__.pyi")]:
        ours = (P.LAZY_STUBS / f"{name}.pyi.txt").read_text(encoding="utf-8")
        assert ours == (root / rel).read_text(encoding="utf-8"), name


def test_vercel_config_matches_the_function():
    root = Path(__file__).resolve().parents[2]
    cfg = json.loads((root / "vercel.json").read_text(encoding="utf-8"))
    assert cfg["functions"]["api/master.py"]["maxDuration"] >= S.BUDGET_S + 10
    assert {"source": "/api/master/:op", "destination": "/api/master?op=:op"} in cfg["rewrites"]
    assert any(c["path"] == "/api/master/cleanup" for c in cfg["crons"])
    assert (root / "api" / "master.py").exists() and (root / "api" / "master-upload.js").exists()
    excluded = cfg["functions"]["api/master.py"]["excludeFiles"]
    assert "assets/*.aac" in excluded and "assets/**" not in excluded            # the tanpura stays in the bundle
    assert len(excluded) <= 256                                                  # Vercel's schema rejects a longer excludeFiles
    import tomllib
    deps = {d.split("==")[0] for d in tomllib.loads((root / "pyproject.toml").read_text(encoding="utf-8"))["project"]["dependencies"]}
    assert {"imageio-ffmpeg", "vercel-blob", "starlette", "librosa", "pedalboard"} <= deps
    assert not deps & {"demucs", "torch", "fastapi"}       # too big for a function / a framework Vercel would detect


# ── run_pipeline split by version (last: it runs the DSP in this process) ────────────────────────────────────────────────────────────────────────

def test_pipeline_split_runs(tmp_path):
    src = tmp_path / "t.wav"
    sf.write(src, synth.make_tabla(8, mud_db=3), 48000, subtype="PCM_16")
    lead = P.run_pipeline(P.JobSpec(tabla=src, out_dir=tmp_path / "lead",
                                    options=P.JobOptions.from_dict({"variants": ["phone_bass"]})), lead=True, require_pass=False)
    other = P.run_pipeline(P.JobSpec(tabla=src, out_dir=tmp_path / "other",
                                     options=P.JobOptions.from_dict({"variants": ["balanced"]})), lead=False, require_pass=False)
    assert set(lead["variants"]) == {"phone_bass"} and set(other["variants"]) == {"balanced"}
    assert lead["files"].get("original") == "original.mp3" and (tmp_path / "lead" / "original.mp3").exists()
    assert "original" not in other["files"] and not (tmp_path / "other" / "original.mp3").exists()
    assert lead["insights"] and other["insights"] == {}
    # the shared measurements agree: each run measured the same input the same way
    assert lead["before"]["lufs"] == pytest.approx(other["before"]["lufs"])


def test_expired_files_are_swept_before_a_run_and_a_full_store_is_said_plainly(monkeypatch):
    # Blob on the free plan holds 1 GB and a 3-version master keeps ~75-100 MB, while the cron runs once a day:
    # a run first clears what has expired (at most every few minutes), and a store that is still full says so.
    import asyncio
    assert S.TTL_HOURS <= 6
    now = datetime.now(timezone.utc)
    fake = FakeBlob([SimpleNamespace(pathname="audio-lab/a/out/r/x.wav", uploaded_at=now - timedelta(hours=S.TTL_HOURS + 1)),
                     SimpleNamespace(pathname="audio-lab/b/in/tabla.wav", uploaded_at=now - timedelta(minutes=5))])
    monkeypatch.setattr(S, "_blob", lambda: fake)
    monkeypatch.setattr(S, "_last_sweep", 0.0)

    def full(*a, **k):
        raise RuntimeError("Vercel Blob: Storage quota exceeded for Hobby plan (1GB maximum)")

    monkeypatch.setattr(S, "_download", full)
    req = S._validate_run({"job": JOB, "run": "4444eeee", "inputs": {"tabla": TABLA}})

    async def collect():
        return [m async for m in S._work(req)]

    out = asyncio.run(collect())
    assert fake.deleted == ["audio-lab/a/out/r/x.wav"]
    assert out[-1]["type"] == "error" and out[-1]["code"] == "storage_full", out[-1]
    assert asyncio.run(collect()) and fake.deleted == ["audio-lab/a/out/r/x.wav"], "not swept again straight away"
