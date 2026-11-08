"""Audio Lab: automatic clean-up, mixing and mastering for tabla and lehra recordings.

  processing.py   all of the DSP (one tested module) — the only place audio is touched
  worker.py       runs one job in its own process (reads job.json, prints progress)
  server.py       FastAPI service: uploads, a job queue, progress streaming, downloads
  cli.py          the same pipeline from a terminal

The web layer only calls processing.run_pipeline().
"""
__version__ = "1.0.0"
