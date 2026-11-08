"""The Audio Lab as a Vercel Function (the serverless build) — the same pipeline as server.py, without a disk.

A function has no disk that outlives a request, a 4.5 MB request body and a
time limit (300 s on the free plan), so it works differently from server.py:

* recordings go from the browser straight to Vercel Blob (a short-lived signed
  URL from api/master-upload.js), under audio-lab/<job>/in/<role>.<ext>;
* one request runs one piece of work start to finish and streams its progress
  back as JSON lines (application/x-ndjson): fetch the inputs from Blob, run
  worker.py on them exactly as server.py does, put the results in Blob under
  audio-lab/<job>/out/<run>/, and end with the report;
* a long recording is mastered as several requests (one per version) that the
  page starts together and puts back together — see run_pipeline(lead=…).

Nothing is kept here between requests: the job id (128 random bits, made by the
page) is the only key, as in server.py.  Blob files older than a day are
deleted by the daily cron (vercel.json → /api/master/cleanup).

  GET  /api/master/health
  POST /api/master/run       JSON {job, run, mode: analyse|master, inputs: {role: pathname}, options,
                             name, lead, require_pass}  →  JSON lines: progress…, then result or error
  POST /api/master/delete    JSON {job, paths: [pathname, …]}
  GET  /api/master/cleanup   (Vercel Cron; Authorization: Bearer $CRON_SECRET when that is set)

The routes are reached through the vercel.json rewrite /api/master/:op → /api/master?op=:op,
so they are dispatched on the path *or* that query parameter.
"""
from __future__ import annotations

import asyncio
import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

TMP = Path(tempfile.gettempdir())
os.environ.setdefault("NUMBA_CACHE_DIR", str(TMP / "numba-cache"))   # librosa's JIT cache needs a writable place

from starlette.applications import Starlette                      # noqa: E402
from starlette.requests import Request                            # noqa: E402
from starlette.responses import JSONResponse, Response, StreamingResponse  # noqa: E402
from starlette.routing import Route                               # noqa: E402

from . import __version__                                         # noqa: E402
from .processing import (ALLOWED_FORMATS, PROFILES, REVERBS, TANPURA_FILE, TARGETS, VARIANTS, AudioLabError,  # noqa: E402
                         JobOptions, probe)

HERE = Path(__file__).resolve().parent
WORKER = HERE / "worker.py"
MB = 1024 * 1024
PREFIX = "audio-lab/"
ROLES = ("tabla", "lehra", "reference", "recorder", "vocal")
JOB_RE = re.compile(r"^[0-9a-f]{32}$")
RUN_RE = re.compile(r"^[0-9a-f]{8,32}$")
INPUT_RE = re.compile(r"^audio-lab/([0-9a-f]{32})/in/(tabla|lehra|reference|recorder|vocal)(?:-[0-9a-f]{8})?\.([a-z0-9]{1,5})$")
OUTPUT_RE = re.compile(r"^audio-lab/([0-9a-f]{32})/(?:in|out)/[A-Za-z0-9_.\-/]{1,160}$")
MIME = {".wav": "audio/wav", ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".mp4": "video/mp4", ".json": "application/json"}
LABELS = {"balanced": "balanced", "phone_bass": "phone-bass", "soft_highs": "soft-highs", "ab_clip": "before-after",
          "original": "original", "preview": "preview"}


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, default))
    except ValueError:
        return default


# What one request may take on.  The free plan gives a function 300 s, 2 GB and one CPU; these leave room for
# fetching the inputs and storing the results.  The page reads them from /health and splits its work to fit.
MAX_SECONDS = _env_float("AUDIO_LAB_MAX_SECONDS", 200)            # longest recording that can be mastered (after a trim): memory
MAX_ANALYSE_SECONDS = _env_float("AUDIO_LAB_MAX_ANALYSE_SECONDS", 900)
BUDGET_S = _env_float("AUDIO_LAB_BUDGET_S", 280)                  # stop a run that is still going after this long
MAX_UPLOAD_MB = _env_float("AUDIO_LAB_MAX_UPLOAD_MB", 150)
MAX_SIDE_UPLOAD_MB = _env_float("AUDIO_LAB_MAX_SIDE_UPLOAD_MB", 50)
TTL_HOURS = _env_float("AUDIO_LAB_TTL_HOURS", 24)
# Each upload is an "advanced operation" (2,000 a month on the free plan) and a multipart upload is one per part
# plus two, so files go up in one piece unless they are big, and then in big parts.
SINGLE_PUT_MAX = 100 * MB
PART = 32 * MB

_busy = threading.Lock()          # one piece of work per instance: the CPU is shared by everything an instance runs


def _blob_ready() -> bool:
    return bool(os.environ.get("BLOB_READ_WRITE_TOKEN") or os.environ.get("BLOB_STORE_ID"))


def _json(body: dict, status: int = 200) -> JSONResponse:
    return JSONResponse(body, status_code=status, headers={"Cache-Control": "no-store"})


def _error(status: int, code: str, message: str) -> JSONResponse:
    return _json({"error": message, "code": code}, status)


def _safe_stem(name: str) -> str:
    stem = re.sub(r"[^A-Za-z0-9_-]+", "-", Path(name or "recording").stem).strip("-_")
    return (stem or "recording")[:60]


def _display_name(name: str) -> str:
    return (re.sub(r"[^A-Za-z0-9._ ()-]", "_", Path(name or "recording").name).strip(" .") or "recording")[:80]


# ── Blob (the Python SDK: OIDC + BLOB_STORE_ID on Vercel, or BLOB_READ_WRITE_TOKEN) ────────────────────────────

def _blob():
    from vercel.blob import sync as blob
    return blob


def _download(pathname: str, dest: Path, limit_bytes: int) -> int:
    blob = _blob()
    total = 0
    with blob.stream_blob(pathname, access="public") as stream, dest.open("wb") as out:
        for chunk in stream:
            total += len(chunk)
            if total > limit_bytes:
                raise AudioLabError("too_large", f"That file is larger than {limit_bytes // MB} MB.", 413)
            out.write(chunk)
    return total


def _upload(path: Path, pathname: str) -> dict:
    """Put a result in Blob; returns the URLs the page uses (to play it, and to save it)."""
    blob = _blob()
    mime = MIME.get(path.suffix.lower(), "application/octet-stream")
    size = path.stat().st_size
    if size <= SINGLE_PUT_MAX:
        with path.open("rb") as f:
            r = blob.put_blob(pathname, f, access="public", content_length=size, content_type=mime,
                              allow_overwrite=True, cache_control_max_age=3600)
    else:
        with blob.multipart_upload_blob(pathname, access="public", content_type=mime, allow_overwrite=True,
                                        cache_control_max_age=3600) as up, path.open("rb") as f:
            while True:
                part = f.read(PART)
                if not part:
                    break
                up.upload_part(part)
        r = up.result
    return {"url": r.url, "download": r.download_url or r.url, "pathname": r.pathname}


# ── The routes ──────────────────────────────────────────────────────────────────────────────────────────────

def features() -> dict:
    return {"demucs": False,                       # PyTorch does not fit a function; the Docker build has it
            "matchering": importlib.util.find_spec("matchering") is not None,
            "tanpura": TANPURA_FILE.exists(),
            "variants": {k: v["label"] for k, v in VARIANTS.items()},
            "profiles": {k: v["label"] for k, v in PROFILES.items()},
            "reverbs": list(REVERBS), "targets": {k: v for k, v in TARGETS.items()}}


async def health(_request: Request) -> Response:
    tmp_free = shutil.disk_usage(TMP).free // MB
    return _json({
        "status": "ok" if _blob_ready() else "unconfigured",
        "service": "audio-lab", "version": __version__,
        "serverless": {"max_seconds": MAX_SECONDS, "budget_s": BUDGET_S, "tmp_free_mb": tmp_free,
                       "upload_url": "/api/master-upload", "ttl_hours": TTL_HOURS},
        "limits": {"max_upload_mb": MAX_UPLOAD_MB, "max_side_upload_mb": MAX_SIDE_UPLOAD_MB,
                   "max_seconds": MAX_SECONDS, "ttl_hours": TTL_HOURS, "formats": sorted(ALLOWED_FORMATS)},
        "features": features(),
        "queue": 0,
    })


def _validate_run(body: dict) -> dict:
    """The run request, checked: every pathname must be an input of this job."""
    job, run = str(body.get("job", "")), str(body.get("run", ""))
    if not JOB_RE.match(job) or not RUN_RE.match(run):
        raise AudioLabError("bad_request", "That request was not understood.", 400)
    mode = "analyse" if body.get("mode") == "analyse" else "master"
    inputs = {}
    for role, pathname in (body.get("inputs") or {}).items():
        if pathname is None:
            continue
        m = INPUT_RE.match(str(pathname))
        if role not in ROLES or not m or m.group(1) != job or m.group(2) != role:
            raise AudioLabError("bad_request", "That request was not understood.", 400)
        inputs[role] = str(pathname)
    if "tabla" not in inputs:
        raise AudioLabError("no_file", "Choose a tabla recording to process.", 400)
    raw = body.get("options") or {}
    if not isinstance(raw, dict):
        raise AudioLabError("bad_option", "The settings were not understood.", 400)
    JobOptions.from_dict(raw)                                   # raises AudioLabError on a bad setting
    return {"job": job, "run": run, "mode": mode, "inputs": inputs, "options": raw,
            "name": _display_name(str(body.get("name") or "recording")),
            "lead": bool(body.get("lead", True)), "require_pass": bool(body.get("require_pass", True))}


def _line(obj: dict) -> bytes:
    return (json.dumps(obj, separators=(",", ":")) + "\n").encode("utf-8")


def _kept_seconds(duration: float, options: dict) -> float:
    start = float(options.get("trim_start") or 0.0)
    end = options.get("trim_end")
    end = float(end) if end is not None else duration
    return max(0.0, min(end, duration) - max(0.0, start)) / float(options.get("tempo_factor") or 1.0)


def _result_files(out: Path, report: dict) -> list:
    names = set()
    for v in (report.get("variants") or {}).values():
        names.update((v.get("files") or {}).values())
    names.update(v for v in (report.get("files") or {}).values() if isinstance(v, str))
    return sorted(n for n in names if re.fullmatch(r"[A-Za-z0-9_.]{1,80}", n) and (out / n).is_file())


def _out_name(local: str, stem: str) -> str:
    p = Path(local)
    return f"{stem}-{LABELS.get(p.stem, p.stem)}{p.suffix.lower()}"


async def run(request: Request) -> Response:
    if not _blob_ready():
        return _error(503, "unconfigured", "The audio studio's storage is not connected yet.")
    try:
        body = await request.json()
        req = _validate_run(body if isinstance(body, dict) else {})
    except AudioLabError as e:
        return _error(e.status, e.code, e.message)
    except ValueError:
        return _error(400, "bad_request", "That request was not understood.")
    return StreamingResponse(_work(req), media_type="application/x-ndjson",
                             headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})


async def _work(req: dict):
    """One run, as JSON lines.  The lock is taken here, inside the stream, so it is always given back."""
    if not _busy.acquire(blocking=False):
        yield _line({"type": "error", "code": "busy", "message": "This server is busy with another recording.", "retry": True})
        return
    t0 = time.time()
    work = TMP / f"audio-lab-{req['run']}"
    proc: Optional[subprocess.Popen] = None
    try:
        shutil.rmtree(work, ignore_errors=True)
        (work / "in").mkdir(parents=True)
        yield _line({"type": "progress", "stage": "fetch", "progress": 0.01, "message": "Fetching your recording"})

        # 1 ─ the inputs, from Blob
        local = {}
        for role, pathname in req["inputs"].items():
            ext = INPUT_RE.match(pathname).group(3)
            dest = work / "in" / f"{role}.{ext}"
            cap = MAX_UPLOAD_MB if role in ("tabla", "recorder") else MAX_SIDE_UPLOAD_MB
            await asyncio.to_thread(_download, pathname, dest, int(cap * MB))
            local[role] = f"in/{role}.{ext}"
        info = await asyncio.to_thread(probe, work / local["tabla"])
        limit = MAX_ANALYSE_SECONDS if req["mode"] == "analyse" else MAX_SECONDS
        kept = info["duration_s"] if req["mode"] == "analyse" else _kept_seconds(info["duration_s"], req["options"])
        if kept > limit + 0.5:
            raise AudioLabError("over_limit", f"On this site a recording can be up to {limit / 60:.1f} minutes long "
                                f"(this one is {kept / 60:.1f}). Trim it in step 2, or run the Audio Lab on your own computer "
                                "for longer recordings.", 413)

        # 2 ─ the pipeline, in worker.py (its own process: its memory is all given back when it ends)
        spec = {k: local.get(k) for k in ROLES}
        spec.update(options=req["options"], display_name=req["name"], mode=req["mode"], lead=req["lead"],
                    require_pass=req["require_pass"])
        (work / "job.json").write_text(json.dumps(spec), encoding="utf-8")
        env = dict(os.environ, PYTHONUNBUFFERED="1")
        with (work / "worker.log").open("wb") as log:              # the child keeps its own copy of the handle
            proc = subprocess.Popen([sys.executable, str(WORKER), str(work)], stdout=subprocess.PIPE, stderr=log,
                                    stdin=subprocess.DEVNULL, cwd=str(work), env=env)
        lines: asyncio.Queue = asyncio.Queue()
        loop = asyncio.get_running_loop()

        def pump():
            for raw in proc.stdout:
                loop.call_soon_threadsafe(lines.put_nowait, raw)
            loop.call_soon_threadsafe(lines.put_nowait, None)

        threading.Thread(target=pump, daemon=True).start()
        final = None
        while True:
            left = BUDGET_S - (time.time() - t0)
            if left <= 0:
                proc.kill()
                raise AudioLabError("timeout", "This took longer than the site allows for one go.", 504)
            try:
                raw = await asyncio.wait_for(lines.get(), timeout=min(10.0, left))
            except asyncio.TimeoutError:
                yield _line({"type": "ping"})                       # keeps proxies from closing a quiet stream
                continue
            if raw is None:
                break
            try:
                msg = json.loads(raw.decode("utf-8", "replace"))
            except ValueError:
                continue
            if msg.get("type") == "progress":
                yield _line({"type": "progress", "stage": msg.get("stage"), "message": str(msg.get("message", ""))[:200],
                             "progress": round(0.05 + 0.85 * float(msg.get("progress", 0)), 3)})
            elif msg.get("type") in ("done", "error"):
                final = msg
        await asyncio.to_thread(proc.wait)
        if not final or final["type"] != "done" or proc.returncode != 0:
            if final and final["type"] == "error":
                raise AudioLabError(final["code"], final["message"], 500)
            raise AudioLabError("crashed", "Processing stopped unexpectedly (the server may have run out of memory). "
                                "Please try again, or try a shorter recording.", 500)

        # 3 ─ the results, to Blob
        out = work / "out"
        listing = "analysis.json" if req["mode"] == "analyse" else "report.json"
        report = json.loads((out / listing).read_text(encoding="utf-8"))
        spectro = None
        if req["mode"] == "master" and (out / "spectrograms.json").exists():
            spectro = json.loads((out / "spectrograms.json").read_text(encoding="utf-8"))
        names = _result_files(out, report)
        stem = _safe_stem(req["name"])
        files = {}
        for i, name in enumerate(names):
            yield _line({"type": "progress", "stage": "store", "progress": round(0.9 + 0.09 * i / max(1, len(names)), 3),
                         "message": "Saving the results"})
            pathname = f"{PREFIX}{req['job']}/out/{req['run']}/{_out_name(name, stem)}"
            files[name] = await asyncio.to_thread(_upload, out / name, pathname)
        yield _line({"type": "result", "kind": req["mode"], "report": report, "spectrograms": spectro, "files": files,
                     "seconds": round(time.time() - t0, 1)})
    except AudioLabError as e:
        yield _line({"type": "error", "code": e.code, "message": e.message})
    except Exception as e:                                       # noqa: BLE001 — the page shows a plain message
        print(f"audio-lab run failed: {e!r}", file=sys.stderr)
        log = work / "worker.log"
        if log.exists():
            print(log.read_text(encoding="utf-8", errors="replace")[-4000:], file=sys.stderr)
        yield _line({"type": "error", "code": "internal", "message": "Something went wrong on the server. Please try again."})
    finally:
        if proc and proc.poll() is None:
            proc.kill()
        shutil.rmtree(work, ignore_errors=True)
        _busy.release()


async def delete(request: Request) -> Response:
    try:
        body = await request.json()
    except ValueError:
        return _error(400, "bad_request", "That request was not understood.")
    job = str((body or {}).get("job", ""))
    paths = [str(p) for p in (body or {}).get("paths") or []][:200]
    if not JOB_RE.match(job) or any((m := OUTPUT_RE.match(p)) is None or m.group(1) != job for p in paths):
        return _error(400, "bad_request", "That request was not understood.")
    if paths and _blob_ready():
        await asyncio.to_thread(_blob().delete_blob, paths)       # deleting is free; missing files are fine
    return _json({"deleted": len(paths)})


async def cleanup(request: Request) -> Response:
    """Daily (Vercel Cron): delete every Audio Lab file older than the time the page promises."""
    secret = os.environ.get("CRON_SECRET")
    if secret and request.headers.get("authorization") != f"Bearer {secret}":
        return _error(401, "unauthorised", "Not allowed.")
    if not _blob_ready():
        return _json({"deleted": 0})

    def sweep() -> int:
        blob = _blob()
        cutoff = datetime.now(timezone.utc) - timedelta(hours=TTL_HOURS)
        old = [b.pathname for b in blob.query_blobs(prefix=PREFIX)
               if (b.uploaded_at if b.uploaded_at.tzinfo else b.uploaded_at.replace(tzinfo=timezone.utc)) < cutoff]
        for i in range(0, len(old), 1000):
            blob.delete_blob(old[i:i + 1000])
        return len(old)

    return _json({"deleted": await asyncio.to_thread(sweep)})


ROUTES = {("GET", "health"): health, ("POST", "run"): run, ("POST", "delete"): delete, ("GET", "cleanup"): cleanup}


async def dispatch(request: Request) -> Response:
    path = request.url.path.rstrip("/")
    op = path.rsplit("/", 1)[-1] if path.startswith("/api/master/") else request.query_params.get("op", "")
    handler = ROUTES.get((request.method, op))
    if handler is None:
        return _error(404 if op not in {o for _, o in ROUTES} else 405, "not_found", "Not found.")
    return await handler(request)


app = Starlette(routes=[Route("/api/master", dispatch, methods=["GET", "POST"]),
                        Route("/api/master/{op}", dispatch, methods=["GET", "POST"])])
