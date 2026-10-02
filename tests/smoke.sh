#!/usr/bin/env bash
# Smoke-test a running server (CI runs this against the Docker image).
#   bash tests/smoke.sh [base-url]        default: http://localhost:3000
set -u
BASE="${1:-http://localhost:3000}"
failures=0

expect() { # expect <status> <path> [extra curl args...]
  local want="$1" path="$2"; shift 2
  local got
  got=$(curl -s -o /dev/null -w '%{http_code}' "$@" "$BASE$path")
  if [ "$got" = "$want" ]; then
    echo "ok    $got $path"
  else
    echo "FAIL  $got $path (expected $want)"
    failures=$((failures + 1))
  fi
}

expect_type() { # expect_type <path> <content-type substring>
  local type
  type=$(curl -s -o /dev/null -w '%{content_type}' "$BASE$1")
  if [[ "$type" == *"$2"* ]]; then
    echo "ok    $1 is $type"
  else
    echo "FAIL  $1 is '$type' (expected $2)"
    failures=$((failures + 1))
  fi
}

echo "== website"
for path in / /index.html /lehra /hindustani /carnatic /notation /practice /games /sw.js /manifest.json /favicon.ico /robots.txt \
            /public/css/style.css /public/icons/icon-192.png /separator/ \
            /assets/Metronome.aac /assets/tanpura_06_01.wav; do
  expect 200 "$path"
done
# ES modules and the AudioWorklet refuse to load without a JavaScript MIME type
expect_type /public/js/main.js javascript
expect_type /public/js/lehra/engine.worklet.js javascript

echo "== health"
expect 200 /health
expect 200 /api/status

echo "== only the website is public"
for path in /config.json /lehra_server /requirements.txt /Dockerfile /uploads/stems \
            /drogon_server/main.cpp /missing-page /public/js/does-not-exist.js /api/audio; do
  expect 404 "$path"
done
# Path traversal: any 4xx means it was refused (the router may answer 400/403)
code=$(curl -s -o /dev/null -w '%{http_code}' --path-as-is "$BASE/public/../config.json")
if [[ "$code" == 4* ]]; then
  echo "ok    $code /public/../config.json"
else
  echo "FAIL  $code /public/../config.json (expected 4xx)"
  failures=$((failures + 1))
fi

echo "== stem separator API validation"
expect 400 /api/job_status/not-a-job-id
expect 400 /api/stems/not-a-job-id/vocals.mp3
bad_upload=$(mktemp --suffix=.exe)
echo "not audio" > "$bad_upload"
expect 400 /api/separate -X POST -F "file=@$bad_upload"
rm -f "$bad_upload"
# Separation mode: 6stems (default) or 2stems; anything else is refused before a job exists
bad_mode=$(mktemp --suffix=.mp3)
echo "not audio" > "$bad_mode"
expect 400 /api/separate -X POST -F "file=@$bad_mode" -F "mode=10stems"
rm -f "$bad_mode"
# Stem names are allowlisted: no_vocals.mp3 (2-stem mode) is a known stem (404: no such job), others are refused
unknown_job=00000000-0000-4000-8000-000000000000
expect 404 "/api/stems/$unknown_job/no_vocals.mp3"
expect 400 "/api/stems/$unknown_job/everything.mp3"
expect 404 "/api/job_status/$unknown_job"

echo
if [ "$failures" -eq 0 ]; then
  echo "All smoke checks passed."
else
  echo "$failures smoke check(s) failed."
  exit 1
fi
