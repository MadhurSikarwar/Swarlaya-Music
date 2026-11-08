"""Audio Lab web service (FastAPI).  The DSP is in processing.py; this file only
accepts uploads, queues jobs, streams progress and serves the results.

  uvicorn audio_lab.server:app --port 8100        (from webapp/)

Routes are all under /api/master/ so they sit beside the Drogon server's
/api/separate, /api/job_status … without touching them: put both behind one
host (a reverse proxy, or a Vercel rewrite of /api/master/*) and the site's
pages call same-origin URLs.

  GET    /api/master/health
  POST   /api/master/jobs                    multipart: tabla, [lehra] [reference] [recorder] [vocal], options (JSON
                                             text), mode = master (default) | analyse
  POST   /api/master/jobs/{id}/master        master an analysed upload (no second upload): options, [lehra] [reference] [vocal]
  GET    /api/master/jobs/{id}               status, progress, and the report when finished
  GET    /api/master/jobs/{id}/events        the same as a server-sent event stream
  GET    /api/master/jobs/{id}/files/{name}  a result file (?download=1 to save it)
  DELETE /api/master/jobs/{id}               remove the job and its files now

Settings come from environment variables (AUDIO_LAB_*, see Config).
Job ids are 128-bit random hex: knowing the id is the access control, as in the
stem separator.  Uploads are stored under names this server chooses; the
visitor's file name is only ever shown back to them, sanitised.
"""
from __future__ import annotations

import asyncio
import importlib.util
import json
import mimetypes
import os
import queue
import re
import secrets
import shutil
import subprocess
import sys
import threading
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, FastAPI, File, Form, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from starlette.concurrency import run_in_threadpool

from . import __version__
from .processing import (ALLOWED_FORMATS, PROFILES, REVERBS, TANPURA_FILE, TARGETS, VARIANTS, AudioLabError, JobOptions,
                         demucs_available as DEMUCS_AVAILABLE, probe)

HERE = Path(__file__).resolve().parent
WORKER = HERE / "worker.py"
ID_RE = re.compile(r"^[0-9a-f]{32}$")
FILE_RE = re.compile(r"^[A-Za-z0-9_.]{1,80}$")
TERMINAL = ("done", "failed")
INPUTS = ("tabla", "lehra", "reference", "recorder", "vocal")
MB = 1024 * 1024


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, default))
    except ValueError:
        return default


@dataclass
class Config:
    data_dir: Path = field(default_factory=lambda: Path(os.environ.get("AUDIO_LAB_DATA", HERE / "data")))
    max_upload_mb: float = field(default_factory=lambda: _env_float("AUDIO_LAB_MAX_UPLOAD_MB", 500))
    max_side_upload_mb: float = field(default_factory=lambda: _env_float("AUDIO_LAB_MAX_SIDE_UPLOAD_MB", 100))
    max_seconds: float = field(default_factory=lambda: _env_float("AUDIO_LAB_MAX_SECONDS", 900))
    ttl_hours: float = field(default_factory=lambda: _env_float("AUDIO_LAB_TTL_HOURS", 24))
    max_queue: int = field(default_factory=lambda: int(_env_float("AUDIO_LAB_MAX_QUEUE", 8)))
    max_active_per_ip: int = field(default_factory=lambda: int(_env_float("AUDIO_LAB_MAX_ACTIVE_PER_IP", 2)))
    job_timeout_s: float = field(default_factory=lambda: _env_float("AUDIO_LAB_JOB_TIMEOUT_S", 3600))
    max_store_gb: float = field(default_factory=lambda: _env_float("AUDIO_LAB_MAX_STORE_GB", 10))
    cors_origins: list = field(default_factory=lambda: [o.strip() for o in os.environ.get(
        "AUDIO_LAB_CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000,http://localhost:3107,http://localhost:3108"
    ).split(",") if o.strip()])
    cleanup_every_s: float = 300.0


def _sanitise(name: str) -> str:
    stem = re.sub(r"[^A-Za-z0-9._ -]", "_", Path(name or "recording").name).strip(" .")
    return (stem or "recording")[:80]


def _error(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse({"error": message, "code": code}, status_code=status, headers={"Cache-Control": "no-store"})


class _TooLarge(Exception):
    pass


class BodyLimit:
    """Refuse a request body past `limit` bytes, counting what actually arrives (a Content-Length can lie)."""

    def __init__(self, app, limit: int, path: str):
        self.app, self.limit, self.path = app, limit, path

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["method"] != "POST" or scope["path"] != self.path:
            return await self.app(scope, receive, send)
        declared = dict(scope["headers"]).get(b"content-length")
        if declared and declared.isdigit() and int(declared) > self.limit:
            return await self._refuse(send)
        seen = 0
        started = False

        async def counting_receive():
            nonlocal seen
            message = await receive()
            if message["type"] == "http.request":
                seen += len(message.get("body", b""))
                if seen > self.limit:
                    raise _TooLarge()
            return message

        async def tracking_send(message):
            nonlocal started
            started = started or message["type"] == "http.response.start"
            await send(message)

        try:
            await self.app(scope, counting_receive, tracking_send)
        except _TooLarge:
            if not started:
                await self._refuse(send)

    async def _refuse(self, send):
        body = json.dumps({"error": "That upload is too large.", "code": "too_large"}).encode()
        await send({"type": "http.response.start", "status": 413,
                    "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode()),
                                (b"connection", b"close")]})
        await send({"type": "http.response.body", "body": body})


class JobManager:
    """Job records, the queue, one worker thread (a job is CPU-heavy: one at a time), and expiry."""

    def __init__(self, cfg: Config):
        self.cfg = cfg
        self.jobs: dict = {}
        self.lock = threading.RLock()
        self.q: "queue.Queue[Optional[str]]" = queue.Queue()        # mastering, one at a time
        self.fast: "queue.Queue[Optional[str]]" = queue.Queue()     # analyses (seconds each), their own lane
        self.order: list = []                      # queued job ids, oldest first
        self.procs: dict = {}
        self.threads: list = []
        self.stop = threading.Event()
        cfg.data_dir.mkdir(parents=True, exist_ok=True)
        self._load()

    # -- persistence ---------------------------------------------------------
    def _path(self, job_id: str) -> Path:
        return self.cfg.data_dir / job_id

    def _save(self, job: dict) -> None:
        d = self._path(job["id"])
        if d.exists():
            tmp = d / "state.json.tmp"
            tmp.write_text(json.dumps(job), encoding="utf-8")
            os.replace(tmp, d / "state.json")

    def _load(self) -> None:
        for d in self.cfg.data_dir.iterdir():
            f = d / "state.json"
            if not (d.is_dir() and ID_RE.match(d.name) and f.exists()):
                continue
            try:
                job = json.loads(f.read_text(encoding="utf-8"))
            except ValueError:
                shutil.rmtree(d, ignore_errors=True)
                continue
            if job["status"] not in TERMINAL:      # the server stopped mid-job
                job.update(status="failed", message="The server restarted while this was processing.",
                           error={"code": "restarted", "message": "The server restarted while this was processing. Please upload again."})
            self.jobs[job["id"]] = job

    # -- lifecycle -----------------------------------------------------------
    def start(self) -> None:
        for name, target in (("master", lambda: self._work(self.q)), ("analyse", lambda: self._work(self.fast)),
                             ("sweep", self._sweep)):
            t = threading.Thread(target=target, daemon=True, name=f"audio-lab-{name}")
            t.start()
            self.threads.append(t)

    def shutdown(self) -> None:
        self.stop.set()
        self.q.put(None)
        self.fast.put(None)
        for proc in list(self.procs.values()):
            proc.kill()

    # -- jobs ----------------------------------------------------------------
    def new_id(self) -> str:
        return secrets.token_hex(16)

    def active_for(self, ip: str) -> int:
        with self.lock:
            return sum(1 for j in self.jobs.values() if j.get("ip") == ip and j["status"] not in TERMINAL)

    def queue_depth(self) -> int:
        with self.lock:
            return sum(1 for j in self.jobs.values() if j["status"] in ("queued", "running") and j.get("kind") != "analyse")

    def submit(self, job: dict) -> None:
        with self.lock:
            self.jobs[job["id"]] = job
            if job.get("kind") != "analyse":
                self.order.append(job["id"])
            self._save(job)
        (self.fast if job.get("kind") == "analyse" else self.q).put(job["id"])

    def update(self, job_id: str, **changes) -> None:
        with self.lock:
            job = self.jobs.get(job_id)
            if job is None:
                return
            job.update(changes)
            job["updated"] = time.time()
            job["rev"] = job.get("rev", 0) + 1
            self._save(job)

    def get(self, job_id: str) -> Optional[dict]:
        with self.lock:
            job = self.jobs.get(job_id)
            return dict(job) if job else None

    def public(self, job: dict, with_report: bool = True) -> dict:
        with self.lock:
            position = self.order.index(job["id"]) + 1 if job["id"] in self.order else 0
        out = {
            "id": job["id"], "status": job["status"], "stage": job.get("stage"), "progress": job.get("progress", 0.0),
            "message": job.get("message", ""), "queue_position": position, "error": job.get("error"),
            "name": job.get("name"), "created": job["created"], "expires": job["created"] + self.cfg.ttl_hours * 3600,
            "has_video": job.get("has_video", False), "rev": job.get("rev", 0), "kind": job.get("kind", "master"),
            "source": job.get("source"),
        }
        if job["status"] == "done" and with_report:
            key, name = ("analysis", "analysis.json") if job.get("kind") == "analyse" else ("report", "report.json")
            path = self._path(job["id"]) / "out" / name
            if path.exists():
                out[key] = json.loads(path.read_text(encoding="utf-8"))
        return out

    def result_files(self, job_id: str) -> set:
        """The files this job may serve: what its report lists, plus the report itself."""
        out = self._path(job_id) / "out"
        names = {"report.json", "spectrograms.json", "original.mp3", "analysis.json", "preview.mp3"}
        for listing in ("report.json", "analysis.json"):
            path = out / listing
            if not path.exists():
                continue
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
            except ValueError:
                continue
            for v in data.get("variants", {}).values():
                names.update(v.get("files", {}).values())
            names.update(v for v in data.get("files", {}).values() if isinstance(v, str))
        return {n for n in names if (out / n).is_file()}

    def delete(self, job_id: str) -> bool:
        with self.lock:
            job = self.jobs.pop(job_id, None)
            if job_id in self.order:
                self.order.remove(job_id)
            proc = self.procs.pop(job_id, None)
        if proc and proc.poll() is None:
            proc.kill()
        shutil.rmtree(self._path(job_id), ignore_errors=True)
        return job is not None

    # -- the worker thread -----------------------------------------------------
    def _work(self, lane: "queue.Queue[Optional[str]]") -> None:
        while not self.stop.is_set():
            job_id = lane.get()
            if job_id is None:
                return
            with self.lock:
                if job_id in self.order:
                    self.order.remove(job_id)
                job = self.jobs.get(job_id)
            if job is None:                                  # deleted while waiting
                continue
            self._run(job_id)

    def _run(self, job_id: str) -> None:
        d = self._path(job_id)
        self.update(job_id, status="running", stage="start", progress=0.01, message="Starting")
        try:
            proc = subprocess.Popen([sys.executable, str(WORKER), str(d)], stdout=subprocess.PIPE,
                                    stderr=(d / "worker.log").open("wb"), stdin=subprocess.DEVNULL, cwd=str(d),
                                    creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        except OSError:
            self.update(job_id, status="failed", message="Could not start the worker.",
                        error={"code": "spawn", "message": "The processing worker could not start."})
            return
        self.procs[job_id] = proc
        timed_out = threading.Event()

        def kill_late():
            timed_out.set()
            proc.kill()

        timer = threading.Timer(self.cfg.job_timeout_s, kill_late)
        timer.start()
        final = None
        try:
            for raw in proc.stdout:
                try:
                    msg = json.loads(raw.decode("utf-8", "replace"))
                except ValueError:
                    continue
                if msg.get("type") == "progress":
                    self.update(job_id, stage=msg.get("stage"), progress=float(msg.get("progress", 0)),
                                message=str(msg.get("message", ""))[:200])
                elif msg.get("type") in ("done", "error"):
                    final = msg
            proc.wait()
        finally:
            timer.cancel()
            self.procs.pop(job_id, None)
        if self.get(job_id) is None:
            return                                           # deleted while running
        if final and final["type"] == "done" and proc.returncode == 0:
            self.update(job_id, status="done", stage="done", progress=1.0, message="Finished")
        elif timed_out.is_set():
            self.update(job_id, status="failed", message="Processing took too long and was stopped.",
                        error={"code": "timeout", "message": "Processing took too long and was stopped."})
        elif final and final["type"] == "error":
            self.update(job_id, status="failed", message=final["message"], error={"code": final["code"], "message": final["message"]})
        else:
            self.update(job_id, status="failed", message="Processing stopped unexpectedly.",
                        error={"code": "crashed", "message": "Processing stopped unexpectedly. Please try again."})

    # -- expiry ------------------------------------------------------------------
    def sweep(self, now: Optional[float] = None) -> int:
        """Delete jobs past their lifetime, then the oldest if the store is over its size cap."""
        now = now or time.time()
        removed = 0
        with self.lock:
            ids = list(self.jobs)
        for job_id in ids:
            job = self.get(job_id)
            if job and job["status"] in TERMINAL and now - job["created"] > self.cfg.ttl_hours * 3600:
                self.delete(job_id)
                removed += 1
        for d in self.cfg.data_dir.iterdir():             # folders with no record (a failed upload)
            if d.is_dir() and ID_RE.match(d.name) and d.name not in self.jobs and now - d.stat().st_mtime > 3600:
                shutil.rmtree(d, ignore_errors=True)
        cap = self.cfg.max_store_gb * 1024 ** 3
        sizes = {}
        for job_id in list(self.jobs):
            sizes[job_id] = sum(f.stat().st_size for f in self._path(job_id).rglob("*") if f.is_file())
        for job_id in sorted(sizes, key=lambda i: self.jobs[i]["created"]):
            if sum(sizes.values()) <= cap:
                break
            if self.jobs[job_id]["status"] in TERMINAL:
                sizes.pop(job_id)
                self.delete(job_id)
                removed += 1
        return removed

    def _sweep(self) -> None:
        while not self.stop.wait(self.cfg.cleanup_every_s):
            try:
                self.sweep()
            except Exception:                             # noqa: BLE001 — never let the sweeper die
                pass


def _save_upload(upload: UploadFile, dest: Path, limit_bytes: int) -> int:
    total = 0
    with dest.open("wb") as out:
        while True:
            chunk = upload.file.read(MB)
            if not chunk:
                break
            total += len(chunk)
            if total > limit_bytes:
                raise AudioLabError("too_large", f"That file is larger than {limit_bytes // MB} MB.", 413)
            out.write(chunk)
    return total


def _extension(upload: UploadFile) -> str:
    ext = Path(upload.filename or "").suffix.lower()
    return ext if re.fullmatch(r"\.[a-z0-9]{1,5}", ext) else ".bin"


def create_app(cfg: Optional[Config] = None) -> FastAPI:
    cfg = cfg or Config()
    manager = JobManager(cfg)

    @asynccontextmanager
    async def lifespan(_app):
        manager.start()
        yield
        manager.shutdown()

    app = FastAPI(title="Swaralaya Audio Lab", version=__version__, lifespan=lifespan,
                  docs_url=None, redoc_url=None, openapi_url=None)
    app.state.manager = manager
    app.state.config = cfg
    router = APIRouter(prefix="/api/master")

    @router.get("/health")
    async def health():
        return JSONResponse({
            "status": "ok", "service": "audio-lab", "version": __version__,
            "limits": {"max_upload_mb": cfg.max_upload_mb, "max_side_upload_mb": cfg.max_side_upload_mb, "max_seconds": cfg.max_seconds, "ttl_hours": cfg.ttl_hours,
                       "formats": sorted(ALLOWED_FORMATS)},
            "features": {"demucs": DEMUCS_AVAILABLE(),
                         "matchering": importlib.util.find_spec("matchering") is not None,
                         "tanpura": TANPURA_FILE.exists(),
                         "variants": {k: v["label"] for k, v in VARIANTS.items()},
                         "profiles": {k: v["label"] for k, v in PROFILES.items()},
                         "reverbs": list(REVERBS), "targets": {k: v for k, v in TARGETS.items()}},
            "queue": manager.queue_depth(),
        }, headers={"Cache-Control": "no-store"})

    def parse_options(options: str):
        raw = json.loads(options or "{}")
        if not isinstance(raw, dict):
            raise ValueError
        JobOptions.from_dict(raw)       # only to validate now; the worker reads the same options again
        return raw

    def limits_ok(ip: str, kind: str):
        if kind != "analyse" and manager.queue_depth() >= cfg.max_queue:
            return _error(503, "busy", "The studio is busy right now. Please try again in a few minutes.")
        if manager.active_for(ip) >= cfg.max_active_per_ip:
            return _error(429, "too_many", "You already have recordings processing. Wait for one to finish.")
        return None

    async def save_inputs(folder: Path, uploads: dict) -> dict:
        """Store each upload under a name chosen here, and check it is audio/video we can read."""
        job_files = {}
        caps = {"tabla": cfg.max_upload_mb, "recorder": cfg.max_upload_mb}
        for key, upload in uploads.items():
            if upload is None or not upload.filename:
                continue
            rel = f"in/{key}{_extension(upload)}"
            await run_in_threadpool(_save_upload, upload, folder / rel, int(caps.get(key, cfg.max_side_upload_mb) * MB))
            info = await run_in_threadpool(probe, folder / rel)
            if info["duration_s"] > cfg.max_seconds * (1.5 if key == "recorder" else 1):
                raise AudioLabError("too_long", f"That recording is longer than {cfg.max_seconds / 60:.0f} minutes.", 413)
            job_files[key] = (rel, info)
        return job_files

    def enqueue(job_id: str, folder: Path, spec: dict, ip: str, name: str, kind: str, has_video: bool,
                source: Optional[str] = None) -> JSONResponse:
        spec.update(mode=kind)
        (folder / "job.json").write_text(json.dumps(spec), encoding="utf-8")
        now = time.time()
        manager.submit({"id": job_id, "status": "queued", "stage": "queued", "progress": 0.0,
                        "message": "Waiting for the studio", "created": now, "updated": now, "rev": 0, "ip": ip,
                        "name": name, "error": None, "has_video": has_video, "kind": kind, "source": source})
        return JSONResponse({"job_id": job_id, "kind": kind, "status_url": f"/api/master/jobs/{job_id}",
                             "events_url": f"/api/master/jobs/{job_id}/events"}, status_code=202,
                            headers={"Cache-Control": "no-store"})

    @router.post("/jobs", status_code=202)
    async def create_job(request: Request, tabla: UploadFile = File(...), lehra: Optional[UploadFile] = File(None),
                         reference: Optional[UploadFile] = File(None), recorder: Optional[UploadFile] = File(None),
                         vocal: Optional[UploadFile] = File(None), options: str = Form("{}"), mode: str = Form("master")):
        ip = request.client.host if request.client else "?"
        kind = "analyse" if mode == "analyse" else "master"
        refused = limits_ok(ip, kind)
        if refused:
            return refused
        try:
            raw = parse_options(options)
        except ValueError:
            return _error(400, "bad_option", "The settings were not understood.")
        except AudioLabError as e:
            return _error(e.status, e.code, e.message)

        job_id = manager.new_id()
        folder = cfg.data_dir / job_id
        (folder / "in").mkdir(parents=True)
        try:
            job_files = await save_inputs(folder, {"tabla": tabla, "lehra": lehra, "reference": reference,
                                                   "recorder": recorder, "vocal": vocal})
            if "tabla" not in job_files:
                raise AudioLabError("no_file", "Choose a tabla recording to process.", 400)
        except AudioLabError as e:
            shutil.rmtree(folder, ignore_errors=True)
            return _error(e.status, e.code, e.message)
        except Exception:                                    # noqa: BLE001
            shutil.rmtree(folder, ignore_errors=True)
            return _error(500, "upload_failed", "The upload could not be saved.")

        name = _sanitise(tabla.filename)
        spec = {k: job_files[k][0] if k in job_files else None for k in INPUTS}
        spec.update(options=raw, display_name=name)
        return enqueue(job_id, folder, spec, ip, name, kind, bool(job_files["tabla"][1]["has_video"]))

    @router.post("/jobs/{job_id}/master", status_code=202)
    async def master_analysed(job_id: str, request: Request, lehra: Optional[UploadFile] = File(None),
                              reference: Optional[UploadFile] = File(None), vocal: Optional[UploadFile] = File(None),
                              options: str = Form("{}")):
        """Master an upload that was analysed first, without sending it again."""
        src = find(job_id)
        if src is None or src.get("kind") != "analyse" or src["status"] != "done":
            return _error(404, "not_found", "That analysed recording was not found. Upload it again.")
        ip = request.client.host if request.client else "?"
        refused = limits_ok(ip, "master")
        if refused:
            return refused
        try:
            raw = parse_options(options)
        except ValueError:
            return _error(400, "bad_option", "The settings were not understood.")
        except AudioLabError as e:
            return _error(e.status, e.code, e.message)
        src_dir = cfg.data_dir / job_id
        src_spec = json.loads((src_dir / "job.json").read_text(encoding="utf-8"))
        new_id = manager.new_id()
        folder = cfg.data_dir / new_id
        (folder / "in").mkdir(parents=True)
        try:
            spec = {}
            for key in INPUTS:                       # the analysed files, linked (or copied) across
                rel = src_spec.get(key)
                if rel and re.fullmatch(r"in/[a-z]+\.[a-z0-9]{1,5}", rel) and (src_dir / rel).is_file():
                    try:
                        os.link(src_dir / rel, folder / rel)
                    except OSError:
                        shutil.copyfile(src_dir / rel, folder / rel)
                    spec[key] = rel
                else:
                    spec[key] = None
            added = await save_inputs(folder, {"lehra": lehra, "reference": reference, "vocal": vocal})
            for key, (rel, _info) in added.items():
                spec[key] = rel
        except AudioLabError as e:
            shutil.rmtree(folder, ignore_errors=True)
            return _error(e.status, e.code, e.message)
        except Exception:                                    # noqa: BLE001
            shutil.rmtree(folder, ignore_errors=True)
            return _error(500, "upload_failed", "The upload could not be saved.")
        spec.update(options=raw, display_name=src_spec.get("display_name") or src.get("name") or "recording")
        return enqueue(new_id, folder, spec, ip, src.get("name") or "recording", "master", bool(src.get("has_video")),
                       source=job_id)

    def find(job_id: str):
        if not ID_RE.match(job_id):
            return None
        return manager.get(job_id)

    @router.get("/jobs/{job_id}")
    async def job_status(job_id: str):
        job = find(job_id)
        if job is None:
            return _error(404, "not_found", "That job was not found. Jobs are removed after 24 hours.")
        return JSONResponse(manager.public(job), headers={"Cache-Control": "no-store"})

    @router.get("/jobs/{job_id}/events")
    async def job_events(job_id: str, request: Request):
        if find(job_id) is None:
            return _error(404, "not_found", "That job was not found. Jobs are removed after 24 hours.")

        async def stream():
            last = -1
            idle = 0.0
            while True:
                job = manager.get(job_id)
                if job is None:
                    yield "event: gone\ndata: {}\n\n"
                    return
                if job.get("rev", 0) != last:
                    last = job.get("rev", 0)
                    idle = 0.0
                    yield f"event: update\ndata: {json.dumps(manager.public(job, with_report=job['status'] == 'done'))}\n\n"
                    if job["status"] in TERMINAL:
                        return
                elif idle >= 15:
                    idle = 0.0
                    yield ": keep-alive\n\n"
                if await request.is_disconnected():
                    return
                await asyncio.sleep(0.4)
                idle += 0.4

        return StreamingResponse(stream(), media_type="text/event-stream",
                                 headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})

    @router.get("/jobs/{job_id}/files/{name}")
    async def job_file(job_id: str, name: str, download: int = 0):
        job = find(job_id)
        if job is None or job["status"] != "done" or not FILE_RE.match(name):
            return _error(404, "not_found", "That file was not found.")
        if name not in manager.result_files(job_id):
            return _error(404, "not_found", "That file was not found.")
        path = cfg.data_dir / job_id / "out" / name
        mime = {".wav": "audio/wav", ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".mp4": "video/mp4",
                ".json": "application/json"}.get(path.suffix.lower()) or mimetypes.guess_type(name)[0] or "application/octet-stream"
        headers = {"Cache-Control": "private, max-age=3600"}
        if download:
            label = {"balanced": "balanced", "phone_bass": "phone-bass", "soft_highs": "soft-highs",
                     "ab_clip": "before-after"}.get(path.stem, path.stem)
            headers["Content-Disposition"] = f'attachment; filename="{Path(job["name"]).stem}-{label}{path.suffix}"'
        return FileResponse(path, media_type=mime, headers=headers)

    @router.delete("/jobs/{job_id}")
    async def job_delete(job_id: str):
        if not ID_RE.match(job_id) or not await run_in_threadpool(manager.delete, job_id):
            return _error(404, "not_found", "That job was not found.")
        return JSONResponse({"deleted": True}, headers={"Cache-Control": "no-store"})

    app.include_router(router)

    @app.middleware("http")
    async def security_headers(request: Request, call_next):
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        return response

    app.add_middleware(CORSMiddleware, allow_origins=cfg.cors_origins, allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
                       allow_headers=["Content-Type"], max_age=600)
    request_limit = int((cfg.max_upload_mb + 2 * cfg.max_side_upload_mb) * MB) + MB
    app.add_middleware(BodyLimit, limit=request_limit, path="/api/master/jobs")
    return app


app = create_app() if os.environ.get("AUDIO_LAB_NO_AUTOAPP") != "1" else None
