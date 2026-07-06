#!/bin/bash
set -e

# Start C++ Sidecar in the background and capture its PID
/app/peaks_server &
SIDECAR_PID=$!

echo "[startup] C++ Peaks Sidecar started (PID: $SIDECAR_PID)"

# Monitor sidecar health in background — if it dies, log a warning.
# The Drogon C++ server has a graceful librosa fallback via pitch_shift_fallback.py.
(
  while true; do
    sleep 30
    if ! kill -0 $SIDECAR_PID 2>/dev/null; then
      echo "[startup] WARNING: C++ sidecar (PID $SIDECAR_PID) has exited. API will fall back to pitch_shift_fallback.py."
      break
    fi
  done
) &

# Start Drogon C++ Server — exec replaces this shell so signals propagate correctly
echo "[startup] Starting Lehra Studio Drogon C++ Backend on port ${PORT:-3000}..."
exec /app/lehra_server
