"""The Audio Lab as a Vercel Function (the serverless build) — the same pipeline as server.py, without a disk.

A function has no disk that outlives a request, a 4.5 MB request body and a
time limit (300 s on the free plan), so it works differently from server.py:

* recordings go from the browser straight to the file store (Backblaze B2, through its
  S3 API: a short-lived signed URL from /api/master/upload-url), under audio-lab/<job>/in/<role>.<ext>;
  results are reached the same way, by signed links (audio_lab/s3.py);
* one request runs one piece of work start to finish and streams its progress
  back as JSON lines (application/x-ndjson): fetch the inputs from Blob, run
  worker.py on them exactly as server.py does, put the results in Blob under
  audio-lab/<job>/out/<run>/, and end with the report;
* a long recording is mastered as several requests (one per version) that the
  page starts together and puts back together — see run_pipeline(lead=…).

Nothing is kept here between requests: the job id (128 random bits, made by the
page) is the only key, as in server.py.  Files older than TTL_HOURS are deleted before
each run and by the daily cron (vercel.json → /api/master/cleanup).

  GET  /api/master/health
  POST /api/master/upload-url  JSON {pathname, size}  →  {url, pathname}: where the browser PUTs one recording
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
from . import s3                                                  # noqa: E402
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
# One 3-version master keeps ~75-100 MB, and the free store is 10 GB (Backblaze B2): files are kept for hours, not a day
TTL_HOURS = _env_float("AUDIO_LAB_TTL_HOURS", 6)
SWEEP_EVERY_S = 300                 # a run first deletes what has expired, at most this often per instance
LINK_S = int(min(7 * 86400, TTL_HOURS * 3600 + 1800))            # how long the page's links to results work
UPLOAD_EXTENSIONS = {"wav", "mp3", "m4a", "aac", "flac", "ogg", "oga", "opus", "mp4", "mov", "mkv", "webm", "avi",
                     "aif", "aiff", "wma", "caf"}
# The pages that may upload to and play from the store (its CORS rules, set by this function)
SITE_ORIGINS = [o.strip() for o in os.environ.get("AUDIO_LAB_SITE_ORIGINS", ",".join([
    "https://swarlaya-music.vercel.app", "https://swarlaya-music-madhursikarwars-projects.vercel.app",
    "https://swarlaya-music-git-main-madhursikarwars-projects.vercel.app",
    "https://swarlaya-music-git-audio-lab-madhursikarwars-projects.vercel.app",
    "http://localhost:3000", "http://localhost:3001"])).split(",") if o.strip()]

_busy = threading.Lock()          # one piece of work per instance: the CPU is shared by everything an instance runs


def _store() -> Optional[s3.Store]:
    return s3.Store.from_env()


def _blob_ready() -> bool:
    return _store() is not None


def _json(body: dict, status: int = 200) -> JSONResponse:
    return JSONResponse(body, status_code=status, headers={"Cache-Control": "no-store"})


def _error(status: int, code: str, message: str) -> JSONResponse:
    return _json({"error": message, "code": code}, status)


def _safe_stem(name: str) -> str:
    stem = re.sub(r"[^A-Za-z0-9_-]+", "-", Path(name or "recording").stem).strip("-_")
    return (stem or "recording")[:60]


def _display_name(name: str) -> str:
    return (re.sub(r"[^A-Za-z0-9._ ()-]", "_", Path(name or "recording").name).strip(" .") or "recording")[:80]


# ── The file store (Backblaze B2 through its S3 API; audio_lab/s3.py) ────────────────────────────────────────

def _download(pathname: str, dest: Path, limit_bytes: int) -> int:
    total = 0
    with _store().open(pathname) as stream, dest.open("wb") as out:
        while chunk := stream.read(1 << 20):
            total += len(chunk)
            if total > limit_bytes:
                raise AudioLabError("too_large", f"That file is larger than {limit_bytes // MB} MB.", 413)
            out.write(chunk)
    return total


def _upload(path: Path, pathname: str) -> dict:
    """Put a result in the store; returns the links the page uses (to play it, and to save it)."""
    store = _store()
    store.put_file(pathname, path, MIME.get(path.suffix.lower(), "application/octet-stream"))
    name = pathname.rsplit("/", 1)[-1]
    return {"url": store.get_url(pathname, LINK_S), "download": store.get_url(pathname, LINK_S, download_name=name),
            "pathname": pathname}


_cors_done = False


def _ensure_cors() -> None:
    """The browser uploads to and plays from the store directly: its CORS rules must name the site (once per instance)."""
    global _cors_done
    if _cors_done:
        return
    try:
        _store().put_cors(SITE_ORIGINS)
        _cors_done = True
    except Exception as e:                                       # noqa: BLE001 — set by hand in the B2 console instead
        print(f"audio-lab: could not set the store's CORS rules: {e!r}", file=sys.stderr)


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
                       "upload_url": "/api/master/upload-url", "ttl_hours": TTL_HOURS},
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


def _worker_env() -> dict:
    """The worker's environment. Vercel's Python runtime adds the function's packages to sys.path at
    start-up instead of installing them in site-packages, so a child Python sees none of them unless
    this process's sys.path is handed over as PYTHONPATH.

    A function has one CPU, and the worker takes all it can: on Vercel this process, which streams the
    progress and a ping every 10 s, was seen to send nothing for 73 s mid-run. The worker lowers its own
    priority (AUDIO_LAB_NICE), so it still gets every spare cycle but this process runs when it must."""
    paths = [p for p in sys.path if p] + [p for p in os.environ.get("PYTHONPATH", "").split(os.pathsep) if p]
    return dict(os.environ, PYTHONUNBUFFERED="1", PYTHONPATH=os.pathsep.join(dict.fromkeys(paths)), AUDIO_LAB_NICE="10")


def _log_worker(work: Path, why: str) -> None:
    """Puts the end of the worker's own output in the function log (the work folder is deleted after)."""
    print(f"audio-lab worker failed: {why}", file=sys.stderr)
    log = work / "worker.log"
    if log.exists():
        print(log.read_text(encoding="utf-8", errors="replace")[-4000:], file=sys.stderr)


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


async def upload_url(request: Request) -> Response:
    """A link the browser can PUT one recording to (for an hour), and nothing else."""
    if not _blob_ready():
        return _error(503, "unconfigured", "The audio studio's storage is not connected yet.")
    try:
        body = await request.json()
    except ValueError:
        return _error(400, "bad_request", "That request was not understood.")
    pathname, size = str((body or {}).get("pathname", "")), (body or {}).get("size")
    m = INPUT_RE.match(pathname)
    if not m or m.group(3) not in UPLOAD_EXTENSIONS:
        return _error(400, "bad_request", "That upload is not allowed.")
    cap = MAX_UPLOAD_MB if m.group(2) in ("tabla", "recorder") else MAX_SIDE_UPLOAD_MB
    if not isinstance(size, (int, float)) or size <= 0 or size > cap * MB:
        return _error(413, "too_large", f"That file is larger than {cap:.0f} MB.")
    await asyncio.to_thread(_ensure_cors)
    return _json({"url": _store().upload_url(pathname, 3600), "pathname": pathname})


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
    headers = {"Cache-Control": "no-store", "X-Accel-Buffering": "no"}
    if not _busy.acquire(blocking=False):
        busy = _line({"type": "error", "code": "busy", "message": "This server is busy with another recording.", "retry": True})
        return StreamingResponse(iter([busy]), media_type="application/x-ndjson", headers=headers)
    events: asyncio.Queue = asyncio.Queue()
    _start(req, events)
    return StreamingResponse(_relay(events), media_type="application/x-ndjson", headers=headers)


# Runs going on now. Vercel's edge cuts a browser's HTTP/2 stream after about a minute (RST_STREAM CANCEL),
# while the function goes on. So the work runs as a task of its own, which a dropped client cannot cancel,
# and its last line (the result or the error) is also kept in Blob as out/<run>/result.json, where the
# page collects it when its stream was cut. (The set keeps the tasks referenced until they end.)
_tasks: set = set()


def _start(req: dict, events: asyncio.Queue) -> asyncio.Task:
    """Run one job in the background (the caller holds the lock; it is given back here)."""
    async def drive():
        try:
            # where the page collects the last line if its stream is cut (a signed link: the store is private)
            events.put_nowait(_line({"type": "started", "result_url": _store().get_url(_result_pathname(req), LINK_S)}))
            async for msg in _work(req):
                if msg["type"] in ("result", "error"):
                    await asyncio.to_thread(_keep_result, req, msg)
                events.put_nowait(_line(msg))
        finally:
            _busy.release()
            events.put_nowait(None)

    task = asyncio.create_task(drive())
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)
    return task


async def _relay(events: asyncio.Queue):
    while (line := await events.get()) is not None:
        yield line


def _result_pathname(req: dict) -> str:
    return f"{PREFIX}{req['job']}/out/{req['run']}/result.json"


def _keep_result(req: dict, msg: dict) -> None:
    path = TMP / f"audio-lab-result-{req['run']}.json"
    try:
        path.write_bytes(json.dumps(msg, separators=(",", ":")).encode("utf-8"))
        _upload(path, _result_pathname(req))
    except Exception as e:                                       # noqa: BLE001 — the stream still carries it
        print(f"audio-lab: could not keep the result of run {req['run']}: {e!r}", file=sys.stderr)
    finally:
        path.unlink(missing_ok=True)


async def _work(req: dict):
    """One run, as messages (dicts): progress, pings, then a result or an error."""
    t0 = time.time()
    work = TMP / f"audio-lab-{req['run']}"
    proc: Optional[subprocess.Popen] = None
    try:
        shutil.rmtree(work, ignore_errors=True)
        (work / "in").mkdir(parents=True)
        await asyncio.to_thread(_sweep_now_and_then)
        yield {"type": "progress", "stage": "fetch", "progress": 0.01, "message": "Fetching your recording"}

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
        env = _worker_env()
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
                yield {"type": "ping"}                         # keeps proxies from closing a quiet stream
                continue
            if raw is None:
                break
            try:
                msg = json.loads(raw.decode("utf-8", "replace"))
            except ValueError:
                continue
            if msg.get("type") == "progress":
                yield {"type": "progress", "stage": msg.get("stage"), "message": str(msg.get("message", ""))[:200],
                             "progress": round(0.05 + 0.85 * float(msg.get("progress", 0)), 3)}
            elif msg.get("type") in ("done", "error"):
                final = msg
        await asyncio.to_thread(proc.wait)
        if not final or final["type"] != "done" or proc.returncode != 0:
            _log_worker(work, f"exit code {proc.returncode}, last message {final and final.get('type')!r}")
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
            yield {"type": "progress", "stage": "store", "progress": round(0.9 + 0.09 * i / max(1, len(names)), 3),
                         "message": "Saving the results"}
            pathname = f"{PREFIX}{req['job']}/out/{req['run']}/{_out_name(name, stem)}"
            files[name] = await asyncio.to_thread(_upload, out / name, pathname)
        yield {"type": "result", "kind": req["mode"], "report": report, "spectrograms": spectro, "files": files,
                     "seconds": round(time.time() - t0, 1)}
    except AudioLabError as e:
        yield {"type": "error", "code": e.code, "message": e.message}
    except Exception as e:                                       # noqa: BLE001 — the page shows a plain message
        _log_worker(work, repr(e))
        if any(w in str(e).lower() for w in ("quota", "cap_exceeded", "cap exceeded", "storage_cap")):
            yield {"type": "error", "code": "storage_full", "message": "The studio's storage is full right now. "
                   "Files are deleted after a few hours, so please try again later."}
            return
        yield {"type": "error", "code": "internal", "message": "Something went wrong on the server. Please try again."}
    finally:
        if proc and proc.poll() is None:
            proc.kill()
        shutil.rmtree(work, ignore_errors=True)


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
        await asyncio.to_thread(lambda: [_store().delete(p) for p in paths])   # missing files are fine
    return _json({"deleted": len(paths)})


async def cleanup(request: Request) -> Response:
    """Daily (Vercel Cron): delete every Audio Lab file older than the time the page promises."""
    secret = os.environ.get("CRON_SECRET")
    if secret and request.headers.get("authorization") != f"Bearer {secret}":
        return _error(401, "unauthorised", "Not allowed.")
    if not _blob_ready():
        return _json({"deleted": 0})

    return _json({"deleted": await asyncio.to_thread(_sweep)})


def _sweep() -> int:
    """Delete every Audio Lab file older than TTL_HOURS; returns how many."""
    store = _store()
    cutoff = datetime.now(timezone.utc) - timedelta(hours=TTL_HOURS)
    old = [item.key for item in store.list(PREFIX) if item.modified < cutoff]
    for key in old:
        store.delete(key)
    return len(old)


_last_sweep = 0.0


def _sweep_now_and_then() -> None:
    """Before a run: the daily cron alone would let the 1 GB store fill up in an afternoon."""
    global _last_sweep
    if time.time() - _last_sweep < SWEEP_EVERY_S:
        return
    _last_sweep = time.time()
    try:
        _sweep()
    except Exception as e:                                       # noqa: BLE001 — the run goes on regardless
        print(f"audio-lab: sweep failed: {e!r}", file=sys.stderr)


ROUTES = {("GET", "health"): health, ("POST", "upload-url"): upload_url, ("POST", "run"): run, ("POST", "delete"): delete, ("GET", "cleanup"): cleanup}


async def dispatch(request: Request) -> Response:
    path = request.url.path.rstrip("/")
    op = path.rsplit("/", 1)[-1] if path.startswith("/api/master/") else request.query_params.get("op", "")
    handler = ROUTES.get((request.method, op))
    if handler is None:
        return _error(404 if op not in {o for _, o in ROUTES} else 405, "not_found", "Not found.")
    return await handler(request)


app = Starlette(routes=[Route("/api/master", dispatch, methods=["GET", "POST"]),
                        Route("/api/master/{op}", dispatch, methods=["GET", "POST"])])
