"""Vercel Function: the Audio Lab's /api/master/* (see audio_lab/serverless.py; vercel.json routes the paths here).

The site's static build is unaffected: Vercel builds files in api/ as functions,
and the dependencies are the root pyproject.toml (only for this function).
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from audio_lab.serverless import app  # noqa: E402,F401
