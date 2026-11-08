"""Runs one Audio Lab job in its own process:   python worker.py <job_dir>

<job_dir>/job.json says what to do (paths relative to the job folder):
  {"tabla": "in/tabla.mp4", "lehra": "in/lehra.mp3" | null, "reference": null, "recorder": null, "vocal": null,
   "options": {...}, "display_name": "my clip.mp4", "mode": "master" | "analyse",
   "lead": true, "require_pass": true}          (the last two: see run_pipeline; both default to true)

Progress goes to stdout as one JSON object per line:
  {"type": "progress", "stage": "...", "progress": 0.42, "message": "..."}
  {"type": "done"}   or   {"type": "error", "code": "...", "message": "..."}
Everything else the libraries print is sent to stderr.  A job in its own
process means a crash or a runaway job cannot take the server down, and the
server can stop it by killing the process.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from audio_lab.processing import AudioLabError, JobOptions, JobSpec, run_analysis, run_pipeline  # noqa: E402


def main() -> int:
    out = sys.stdout
    sys.stdout = sys.stderr            # stray prints from libraries must not corrupt the protocol

    def emit(obj: dict) -> None:
        out.write(json.dumps(obj) + "\n")
        out.flush()

    job_dir = Path(sys.argv[1]).resolve()
    try:
        job = json.loads((job_dir / "job.json").read_text(encoding="utf-8"))

        def inside(rel):
            if rel is None:
                return None
            p = (job_dir / rel).resolve()
            if job_dir not in p.parents:
                raise AudioLabError("bad_job", "A job file points outside its folder.", 400)
            return p

        spec = JobSpec(tabla=inside(job["tabla"]), lehra=inside(job.get("lehra")), reference=inside(job.get("reference")),
                       recorder=inside(job.get("recorder")), vocal=inside(job.get("vocal")),
                       out_dir=job_dir / "out", options=JobOptions.from_dict(job.get("options")),
                       display_name=job.get("display_name") or "recording")
        def report(stage, frac, msg):
            emit({"type": "progress", "stage": stage, "progress": round(frac, 3), "message": msg})

        if job.get("mode") == "analyse":
            run_analysis(spec, report)
        else:                                  # "lead"/"require_pass": a job split by version (serverless.py)
            run_pipeline(spec, report, lead=bool(job.get("lead", True)), require_pass=bool(job.get("require_pass", True)))
        emit({"type": "done"})
        return 0
    except AudioLabError as e:
        emit({"type": "error", "code": e.code, "message": e.message})
    except MemoryError:
        emit({"type": "error", "code": "memory", "message": "That recording is too large to process on this server."})
    except Exception as e:                       # noqa: BLE001 — report anything, the server shows a generic message
        print(f"worker crashed: {e!r}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        emit({"type": "error", "code": "internal", "message": "Something went wrong while processing. Please try again."})
    return 1


if __name__ == "__main__":
    sys.exit(main())
