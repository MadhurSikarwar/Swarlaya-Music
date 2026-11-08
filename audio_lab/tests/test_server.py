"""Tests for the Audio Lab web service: uploads, limits, the job lifecycle, progress streaming, expiry.

The service runs the real worker process on synthetic audio, so these are slow
(a minute or so).  Run from webapp/:   python -m pytest audio_lab/tests/test_server.py -q
"""
import io
import json
import os
import shutil
import time

import pytest
import soundfile as sf

os.environ["AUDIO_LAB_NO_AUTOAPP"] = "1"

import synth  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from audio_lab import server  # noqa: E402

pytestmark = pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg not installed")


def wav_bytes(x):
    buf = io.BytesIO()
    sf.write(buf, x, 48000, format="WAV", subtype="PCM_16")
    return buf.getvalue()


@pytest.fixture()
def client(tmp_path):
    cfg = server.Config(data_dir=tmp_path / "data", max_upload_mb=5, max_side_upload_mb=5, max_seconds=60,
                        max_queue=3, max_active_per_ip=2, cleanup_every_s=3600)
    app = server.create_app(cfg)
    with TestClient(app) as c:
        c.cfg = cfg
        yield c


def post(client, tabla=None, lehra=None, options=None, name="my clip.wav"):
    files = {"tabla": (name, tabla if tabla is not None else wav_bytes(synth.make_tabla(8, mud_db=3)), "audio/wav")}
    if lehra:
        files["lehra"] = ("lehra.wav", lehra, "audio/wav")
    return client.post("/api/master/jobs", files=files, data={"options": json.dumps(options or {"variants": ["balanced"]})})


def wait_done(client, job_id, timeout=240):
    end = time.time() + timeout
    while time.time() < end:
        s = client.get(f"/api/master/jobs/{job_id}").json()
        if s["status"] in ("done", "failed"):
            return s
        time.sleep(1)
    raise AssertionError("job did not finish")


def test_health_reports_limits_and_features(client):
    r = client.get("/api/master/health")
    h = r.json()
    assert r.status_code == 200 and h["status"] == "ok"
    assert h["limits"]["max_upload_mb"] == 5 and "phone_bass" in h["features"]["variants"]
    assert r.headers["x-content-type-options"] == "nosniff"


def test_a_job_runs_from_upload_to_download_and_delete(client):
    r = post(client, lehra=wav_bytes(synth.make_lehra(6.4)), options={"variants": ["balanced"], "target": "reel"})
    assert r.status_code == 202
    body = r.json()
    job_id = body["job_id"]
    assert len(job_id) == 32 and body["events_url"].endswith("/events")
    status = wait_done(client, job_id)
    assert status["status"] == "done", status
    report = status["report"]
    v = report["variants"]["balanced"]
    assert v["passed"] and all(g["pass"] for g in v["gates"] if g["name"].startswith(("loudness", "true_peak")) and "_" not in g["name"][9:])
    wav = client.get(f"/api/master/jobs/{job_id}/files/balanced.wav")
    assert wav.status_code == 200 and wav.headers["content-type"] == "audio/wav" and wav.content[:4] == b"RIFF"
    dl = client.get(f"/api/master/jobs/{job_id}/files/balanced.mp3?download=1")
    assert 'filename="my clip-balanced.mp3"' in dl.headers["content-disposition"]
    assert client.get(f"/api/master/jobs/{job_id}/files/original.mp3").status_code == 200
    assert client.get(f"/api/master/jobs/{job_id}/files/spectrograms.json").json()["balanced"]["rows"] == 96
    assert client.delete(f"/api/master/jobs/{job_id}").json() == {"deleted": True}
    assert client.get(f"/api/master/jobs/{job_id}").status_code == 404
    assert not (client.cfg.data_dir / job_id).exists()


def test_progress_streams_as_server_sent_events(client):
    job_id = post(client).json()["job_id"]
    seen = []
    with client.stream("GET", f"/api/master/jobs/{job_id}/events") as r:
        assert r.headers["content-type"].startswith("text/event-stream")
        for line in r.iter_lines():
            if line.startswith("data: "):
                seen.append(json.loads(line[6:]))
                if seen[-1]["status"] in ("done", "failed"):
                    break
    assert seen[-1]["status"] == "done" and "report" in seen[-1]
    progress = [s["progress"] for s in seen]
    assert progress == sorted(progress) and len(seen) >= 3


def test_bad_uploads_are_refused_with_a_reason(client):
    r = post(client, tabla=b"definitely not audio", name="x.wav")
    assert r.status_code == 415 and r.json()["code"] in ("unreadable", "unsupported")
    big = post(client, tabla=b"\0" * (6 * 1024 * 1024), name="big.wav")
    assert big.status_code == 413 and big.json()["code"] in ("too_large",)
    assert post(client, options={"target": "radio"}).status_code == 400
    r = client.post("/api/master/jobs", data={"options": "{}"})
    assert r.status_code == 422                     # no file at all
    assert list(client.cfg.data_dir.iterdir()) == [], "refused uploads leave nothing behind"


def test_over_long_recordings_are_refused(client):
    r = post(client, tabla=wav_bytes(synth.make_tabla(70)), name="long.wav")
    assert r.status_code in (413, 415) and r.json()["code"] in ("too_long", "too_large")


def test_unsafe_names_and_ids_cannot_reach_other_files(client):
    job_id = post(client).json()["job_id"]
    wait_done(client, job_id)
    for bad in ("..%2Fjob.json", "job.json", "state.json", "..%2F..%2Fstate.json", "balanced.wav%00", "%2Fetc%2Fpasswd"):
        assert client.get(f"/api/master/jobs/{job_id}/files/{bad}").status_code in (404, 422), bad
    assert client.get("/api/master/jobs/not-a-real-id").status_code == 404
    assert client.get("/api/master/jobs/../health").status_code in (200, 404)
    assert client.delete("/api/master/jobs/0123").status_code == 404


def test_the_queue_and_per_visitor_limits(client):
    first = post(client)
    second = post(client)
    third = post(client)
    assert first.status_code == 202 and second.status_code == 202
    assert third.status_code == 429 and third.json()["code"] == "too_many"
    client.manager = client.app.state.manager
    for r in (first, second):
        client.delete(f"/api/master/jobs/{r.json()['job_id']}")


def test_expired_jobs_are_swept(client):
    job_id = post(client).json()["job_id"]
    wait_done(client, job_id)
    manager = client.app.state.manager
    assert manager.sweep() == 0
    assert manager.sweep(now=time.time() + 25 * 3600) == 1
    assert client.get(f"/api/master/jobs/{job_id}").status_code == 404
    assert not (client.cfg.data_dir / job_id).exists()


def test_a_worker_failure_is_reported_not_hidden(client):
    r = post(client, tabla=wav_bytes(synth.make_tabla(4) * 0), name="silent.wav")
    status = wait_done(client, r.json()["job_id"])
    assert status["status"] == "failed" and status["error"]["code"] == "silent_input"
    assert "silent" in status["error"]["message"].lower()


def test_cors_is_limited_to_configured_origins(client):
    ok = client.get("/api/master/health", headers={"Origin": "http://localhost:3000"})
    other = client.get("/api/master/health", headers={"Origin": "https://evil.example"})
    assert ok.headers.get("access-control-allow-origin") == "http://localhost:3000"
    assert "access-control-allow-origin" not in other.headers


def test_the_api_stays_out_of_the_drogon_servers_routes():
    import re
    from pathlib import Path
    root = Path(server.__file__).resolve().parents[1] / "drogon_server" / "controllers"
    paths = set()
    for hpp in root.glob("*.hpp"):
        paths.update(re.findall(r'ADD_METHOD(?:_TO|_VIA_REGEX)\([^,]+,\s*"([^"]+)"', hpp.read_text(encoding="utf-8")))
    assert paths, "found the C++ routes"
    mine = [p for p in paths if p.startswith("/api/master")]
    assert mine == [], "the Drogon server must not register /api/master"
    # …and its catch-all leaves every /api/ path alone, so the two services can share one host
    assert any("(?!api/)" in p for p in paths)

def test_analyse_first_then_master_without_uploading_again(client):
    files = {"tabla": ("take.wav", wav_bytes(synth.make_tabla(8, f0=277.18)), "audio/wav")}
    r = client.post("/api/master/jobs", files=files, data={"options": "{}", "mode": "analyse"})
    assert r.status_code == 202 and r.json()["kind"] == "analyse"
    first = wait_done(client, r.json()["job_id"])
    assert first["status"] == "done" and first["kind"] == "analyse"
    assert first["analysis"]["suggested_sa"]["note"] == "C#3"
    assert client.get(f"/api/master/jobs/{first['id']}/files/preview.mp3").status_code == 200
    m = client.post(f"/api/master/jobs/{first['id']}/master",
                    files={"lehra": ("lehra.wav", wav_bytes(synth.make_lehra(6.4, tonic_hz=277.18)), "audio/wav")},
                    data={"options": json.dumps({"variants": ["balanced"], "lehra_meta": {"bpm": 150, "beats": 16}})})
    assert m.status_code == 202 and m.json()["kind"] == "master"
    done = wait_done(client, m.json()["job_id"])
    assert done["status"] == "done", done
    assert done["source"] == first["id"] and done["report"]["lehra"]["catalogue"]["beats"] == 16
    assert client.get(f"/api/master/jobs/{done['id']}/files/balanced.wav").status_code == 200
    # only an analysed upload can be mastered this way
    assert client.post(f"/api/master/jobs/{done['id']}/master", data={"options": "{}"}).status_code == 404
    assert client.post("/api/master/jobs/0123/master", data={"options": "{}"}).status_code == 404


def test_health_lists_profiles_and_features(client):
    h = client.get("/api/master/health").json()
    assert "vocal" in h["features"]["profiles"] and "temple" in h["features"]["reverbs"]
    assert h["features"]["targets"]["apple"] == -16
