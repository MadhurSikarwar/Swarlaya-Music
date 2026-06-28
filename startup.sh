#!/bin/bash
# Start Flask/Gunicorn
exec gunicorn --bind 0.0.0.0:${PORT:-3000} --workers 1 --threads 4 server:app
