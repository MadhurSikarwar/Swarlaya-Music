#!/bin/bash
set -e

# Start C++ Sidecar in the background and capture its PID
/app/peaks_server &
SIDECAR_PID=$!

echo "[startup] C++ Peaks Sidecar started (PID: $SIDECAR_PID)"

# Monitor sidecar health in background — if it dies, log a warning.
# Flask has a graceful librosa fallback so the web server stays alive.
(
  while true; do
    sleep 30
    if ! kill -0 $SIDECAR_PID 2>/dev/null; then
      echo "[startup] WARNING: C++ sidecar (PID $SIDECAR_PID) has exited. Peaks API will fall back to librosa."
      break
    fi
  done
) &

# Start Flask/Gunicorn — exec replaces this shell so signals propagate correctly
exec gunicorn --bind 0.0.0.0:${PORT:-3000} --workers 1 --threads 4 server:app
