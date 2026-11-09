# Audio Lab

Takes a raw tabla recording (audio or video) and, optionally, a lehra, and returns a cleaned, mixed,
loudness-matched version — three of them, to compare by ear — plus the original video with the new audio
in it. The page is `/audio` on the site (`public/js/audiolab/`); this folder is the service behind it.

**What this can and cannot tell you.** Nothing here can hear. Every claim in the report is a measurement
(loudness, peaks, band energy, pitch, tempo) and every gate is checked on the file that was written. The EQ
values are starting points. Tone is for your ears: that is why there are three versions, and why the page can
play them against each other.

```
audio_lab/
  processing.py   all of the DSP, one module (the web layer only calls run_pipeline)
  worker.py       runs one job in its own process, reports progress as JSON lines
  server.py       FastAPI service: upload, queue, progress stream, downloads, expiry
  serverless.py   the same pipeline as a Vercel Function (no disk, no queue: see "On Vercel" below)
  cli.py          the same pipeline from a terminal
  fonts/          Cinzel (the site's heading font, SIL Open Font License, OFL.txt) for video titles
  tests/          synthetic tabla/lehra signals; no recordings needed
```

## Run it

Python 3.12 and ffmpeg (with libmp3lame) on the PATH. From `webapp/`:

```bash
python -m venv .venv && .venv/Scripts/activate        # (or: source .venv/bin/activate)
pip install -r audio_lab/requirements.txt
python -m uvicorn audio_lab.server:app --port 8100
python tools/dev_server.py 3000                        # the site; it forwards /api/master/ to :8100
```

Open `http://localhost:3000/audio`. Without a browser, the same pipeline:

```bash
python -m audio_lab.cli tabla.mp4 --lehra lehra.mp3 --target reel --out results/
```

Tests (about two minutes; they run the real worker process): `python -m pytest audio_lab/tests -q`
(needs `pip install -r audio_lab/requirements-dev.txt`). The page's own tests run with the rest of the site's:
`npm test`.

## What happens to a recording

| # | Step | Notes |
|---|---|---|
| 1 | Decode | ffmpeg → 48 kHz stereo float32. The video stream is never decoded; the MP4 export copies it (`-c:v copy`). |
| 2 | Measure | Integrated LUFS, sample and true peak (4× oversampled), clipping events, noise floor, 8 band energies, mono-fold loss, mains hum, stroke count and tempo (librosa), the pitch the dayan rings at (pYIN, 110–700 Hz). |
| 3 | Drums (optional) | Demucs `htdemucs` two-stem, when the upload is a full song. Needs `demucs` installed. |
| 4 | Repair | Declip (cubic rebuild of runs ≤ 48 samples), 50/60 Hz notch when a narrow line is found, stationary noise reduction (`prop_decrease` 0.6) learned from the quietest passage when there is one. After noise reduction the dayan's ring (150–1500 Hz tail against its stroke) is re-measured; if it lost more than 2 dB the original is blended back 50 %. |
| 5 | Tabla chain | Brought to −20 LUFS first, so the fixed thresholds mean something. Gate −55 dB 1.6:1 250 ms · HPF 35 Hz · low shelf +1.5 dB @110 · peak −2.5 dB @320 Q1 · peak −1 dB @900 Q1.2 · peak +2 dB @3.5 k Q0.9 · high shelf +1 dB @9 k · compressor −18 dB 2.5:1 12/120 ms · small room (0.18 / wet 0.06). **The EQ gains are scaled from the measurement and clamped to ±4 dB** (deeper mud cut when 250–500 Hz is within 3 dB of the bayan band, bigger 3.5 kHz lift when the attack band is under −20 dBr, and so on). Every change is listed, with its reason, in the report. |
| 6 | Lehra | HPF 90 · low shelf −1.5 @200 · peak −1 @500 · peak −2 @3.2 k (a pocket for the tabla's attack) · LPF 13 k · 2:1. Looped with a 50 ms equal-power crossfade **kept at the loop's exact period** (the crossfade shortens the loop by 50 ms, which would drift 0.5 % a cycle out of step with the tabla, so it is stretched back). Levelled by LUFS to `tabla + lehra_db` (default −7), ducked up to 3 dB by a smoothed envelope of the tabla, faded out over 0.5 s. |
| 7 | Alignment | Tempo of both by beat tracking (double/half time allowed). Offset: the tabla's onset strength folded onto one lehra period and correlated; used only when its confidence is ≥ 0.6, otherwise 0. Pitch: where the lehra's nearest strong note sits against the dayan's pitch class, in cents; a shift is offered above 20 cents and applied only if asked, and only when the dayan's reading is trustworthy. |
| 8 | Master | HPF 30 · peak −1.8 @300 · glue compressor −14 dB 1.8:1 · high shelf +0.5 @8 k · our own look-ahead true-peak limiter (pedalboard's `Limiter` adds make-up gain that depends on its threshold, so a loudness target cannot be hit with it) · gain iterated until the loudness is within 0.1 LU (the gate allows 0.3). |
| 9 | Reference (optional) | matchering, then the loudness target is applied again. |
| 10 | Export | 24-bit WAV, MP3 320k, AAC 256k, MP4 (video uploads). |

## Around the pipeline

* **Analyse first.** Choosing a recording uploads it for a quick look (`mode=analyse`, a few seconds, its own lane
  so it never waits behind a long job): loudness, noise, clipping, hum, tempo, the dayan's pitch and a suggested Sa,
  and a preview for the page's waveform. Mastering then reuses that upload (`POST /jobs/{id}/master`).
* **Prepare (in the page).** Trim with two handles; mark a noise-only stretch for the noise reduction to learn from;
  play the recording with the lehra looping under it and tap on each sam to set the lehra's offset (±10 ms nudges).
* **A Swaralaya lehra.** Any raag/taal/instrument of the site's catalogue, rendered in the page with the Lehra
  Player's own engine at the tabla's tempo and Sa, as whole cycles starting on sam — so its sams are known exactly.
* **A second recorder.** The same performance on a better microphone is lined up with the video's sound by GCC-PHAT
  (to the millisecond; clock drift between devices measured and corrected) and used instead. On the user's own raw
  takes against their final exports it found every offset with 0.0 ms residual at the start, middle and end.
* **More tracks.** A vocal (its own chain, level and offset), a tanpura bed at the Sa (the site's tanpura recording),
  a reference track (matchering).
* **Sound.** Instrument profiles (tabla, pakhawaj, Kathak, vocal, harmonium, sitar), rooms (dry, small room, hall,
  temple), targets (Reels/Shorts, YouTube, loud, Spotify, Apple Music, podcast, custom), pitch shift (e.g. "tune to
  Sa"), speed change (audio only: a video cannot follow), fades.
* **Video.** 9:16 or square framing (blurred fill, nothing cropped), a title (Cinzel; Devanagari falls back to a
  Devanagari font), a waveform video for audio-only uploads, a before/after clip of the loudest passage.
* **Riyaz insights** (percussion profiles): tempo over time with rushed/dragged stretches, stroke-level evenness and
  trend, sam accuracy (catalogue lehra: exact sams), the dayan against Sa/Pa/Ma in cents, and stroke families
  (combined, resonant, bass, closed) — experimental, judged by what each stroke adds, not bol recognition.
* **In the page:** recording straight from the microphone, presets kept in the browser, the version you keep
  downloading selected first, batch processing of several recordings, a notification when a job is done.
* **Lossy-safe peaks.** If MP3/AAC encoding pushes a peak above −1 dBTP, the version is re-mastered with a lower
  ceiling (up to twice).

**Versions.** *Balanced*: the measured fix. *Phone + bass* (the default): bayan +2 dB (peak at 90 Hz) and 22 % parallel
tanh saturation of 40–160 Hz, for the harmonics a phone speaker can reproduce. *Soft highs*: high shelf −3 dB from
3.2 kHz (taken from the measured gap between your own "Mastered" and "softer highs" files). Sliders for brightness
and bass add to all three.

## Quality gates

Checked on the written file, per version. A version that fails a hard gate is withheld (no downloads); if every
version fails the job fails and says why. When the tone gate trips, the version is redone with the EQ at 50 %, then 20 %.

| Gate | Limit | Kind |
|---|---|---|
| Loudness, pyloudnorm and ffmpeg `ebur128` | target ± 0.3 LU (−14 reel/YouTube, −11 loud) | hard |
| True peak (worse of ours and ffmpeg's) | ≤ −1 dBTP | hard |
| No new clipping | 0 events | hard |
| Tone change | any band moves ≤ 6 dB relative to the whole (plus what the version or a slider asked for) against the input — or, with a lehra, against the unprocessed mix | hard |
| Duration | within 50 ms of the input (audio and the MP4) | hard |
| True peak after MP3 / AAC | ≤ −0.7 dBTP | advisory |
| Dayan ring | not down more than 3 dB (tabla-only jobs) | advisory |

## HTTP API

All under `/api/master/`, which does not overlap any route of the Drogon server (`/api/separate`, `/api/job_status`,
`/api/stems`, `/api/download`, `/api/cleanup`, `/api/status`, `/api/health`; `tests/audiolab.test.js` checks it).

| Method and path | |
|---|---|
| `GET /health` | status, limits, which optional features are installed |
| `POST /jobs` | multipart: `tabla` (required), `lehra`, `reference`, `recorder`, `vocal`, `options` (JSON text), `mode` (`master` or `analyse`) → `202 {job_id, kind}` |
| `POST /jobs/{id}/master` | master an analysed upload without sending it again: `options`, optional `lehra`, `reference`, `vocal` |
| `GET /jobs/{id}` | `{status: queued\|running\|done\|failed, progress, message, queue_position, report?}` |
| `GET /jobs/{id}/events` | the same as server-sent events (`update`, then the stream ends) |
| `GET /jobs/{id}/files/{name}` | a result file; `?download=1` saves it under a tidy name |
| `DELETE /jobs/{id}` | remove it now |

`options`: `target` reel\|youtube\|loud\|spotify\|apple\|podcast\|custom (+ `custom_lufs`) · `profile` · `reverb` ·
`lehra_db` · `offset_seconds` (null = detect) · `lehra_meta` {bpm, beats} · `brightness_db` · `bass_db` · `shift_cents` ·
`tempo_factor` · `trim_start` · `trim_end` · `fade_in_ms` · `fade_out_ms` · `noise_region` [start, end] · `denoise`
auto\|on\|off · `hum_removal` auto\|off · `separate_drums` · `match_pitch` · `match_tempo` · `sa_hz` · `tanpura_db` ·
`vocal_db` · `vocal_offset` · `video_format` original\|vertical\|square · `title` · `audio_video` · `ab_clip` · `variants`.
Times (trim, noise region, lehra offset) are on the upload's own timeline.

## Settings (environment)

| Variable | Default | |
|---|---|---|
| `AUDIO_LAB_DATA` | `audio_lab/data` | where uploads and results live |
| `AUDIO_LAB_MAX_UPLOAD_MB` / `_MAX_SIDE_UPLOAD_MB` | 500 / 100 | the tabla / the lehra and reference |
| `AUDIO_LAB_MAX_SECONDS` | 900 | longest recording |
| `AUDIO_LAB_TTL_HOURS` | 24 | files are deleted after this (a sweep runs every 5 minutes) |
| `AUDIO_LAB_MAX_QUEUE` / `_MAX_ACTIVE_PER_IP` | 8 / 2 | jobs waiting at once / per visitor |
| `AUDIO_LAB_JOB_TIMEOUT_S` | 3600 | a job running longer is killed |
| `AUDIO_LAB_MAX_STORE_GB` | 10 | oldest finished jobs are removed beyond this |
| `AUDIO_LAB_CORS_ORIGINS` | localhost dev origins | comma-separated origins allowed to call the API from another host |
| `AUDIO_LAB_DEMUCS_PYTHON` | — | a Python that has Demucs, if it lives in its own environment |
| `AUDIO_LAB_TANPURA` | `assets/tanpura_06_01.wav` | the tanpura recording for the tanpura bed |
| `AUDIO_LAB_FONT` | Cinzel, then system fonts | a font file for video titles |

## Putting it behind the site

The page calls `/api/master/…` on its own address, as the stem separator calls `/api/…`. Pick one:

* **One host (recommended).** A reverse proxy sends `/api/master/` to this service and everything else to the Drogon
  server. nginx: `location /api/master/ { proxy_pass http://audio-lab:8100; proxy_buffering off; client_max_body_size 1100m; }`
  (`proxy_buffering off` keeps the progress stream live).
* **On Vercel itself** — see the next section. This is what the live site uses.
* **The Vercel site, with this service elsewhere.** Replace the `/api/master/:op` rewrite in `vercel.json` with
  `{ "source": "/api/master/:path*", "destination": "https://<your-audio-host>/api/master/:path*" }`.
  (Vercel buffers a rewritten response, so the page falls back to polling every 1.5 s — progress still moves,
  just not as smoothly. `tools/build-static.mjs` ignores this rewrite when deciding whether the stem separator is live.)
* **Another origin.** Set `AUDIO_LAB_API` in `public/js/audiolab/config.js` to the full address and list the site in
  `AUDIO_LAB_CORS_ORIGINS`.
* **Docker, locally.** `docker compose --profile audio up --build` runs the site on :3000 and this service on :8100;
  on localhost the page finds it by itself.

The Docker service needs a host that can run Python and ffmpeg with real CPU time and about 2 GB of memory (a
3-minute video peaks at ~1.8 GB). Processing takes roughly 1–2× the length of the recording on one CPU (the 67 s
"7 in 4" clip with a lehra: 124 s for all three versions; the 3-minute kayada: 301 s), one job at a time.

## On Vercel

The same pipeline runs as a Vercel Function, so the site needs no other server. A function has no disk that lasts,
takes at most 4.5 MB per request and stops after 300 s (free plan: 2 GB, one CPU), so the parts move:

```
browser ──(signed PUT link from /api/master/upload-url)──▶ Backblaze B2   audio-lab/<job>/in/<role>-<id>.<ext>
browser ──POST /api/master/run──▶ api/master.py (audio_lab/serverless.py)
              fetch the inputs from B2 → worker.py (exactly as server.py runs it) → results to B2
              ◀── progress as JSON lines, then the report and signed links to the files
```

* **Files** live in a private Backblaze B2 bucket, reached through its S3 API by `audio_lab/s3.py` (standard library
  only: SigV4 presigned URLs). The browser uploads with a link that can put one pathname for an hour, and plays and
  downloads with links that last as long as the files are kept. No credential reaches the browser. The function
  sets the bucket's CORS rules itself (`AUDIO_LAB_SITE_ORIGINS`), once per instance.
* **Long recordings** are mastered as several runs at once, one or two versions each (`planRuns` in `format.js`,
  from the measured cost: ~0.25 s per second of audio per run plus ~0.5 s per version, ×1.5 for a slower CPU).
  Only the first ("lead") run makes the shared files — the riyaz insights, the loudness-matched original, the
  before/after clip (`run_pipeline(lead=…)`). The page puts the runs back together (`mergeRuns`).
* **One run per instance.** Vercel may send several requests to one instance; a second run there gets "busy" at
  once and the page tries again a few seconds later.
* **Nothing is kept on the function.** The page holds the job (and its finished result in localStorage, so a reload
  shows it again); each run first deletes expired files (at most every 5 minutes per instance) and the daily cron `/api/master/cleanup` does too; files are kept 6 hours (`AUDIO_LAB_TTL_HOURS`; one master keeps ~75–100 MB), and "Delete now"
  deletes them at once.
* **What it needs on the Vercel project:** `B2_ENDPOINT` (the bucket's S3 endpoint, e.g.
  `s3.us-west-004.backblazeb2.com`), `B2_BUCKET`, `B2_KEY_ID` and `B2_APPLICATION_KEY` (an application key that may
  read, write and set the bucket's CORS — "all buckets", read and write), and `VERCEL_SUPPORT_LARGE_FUNCTIONS=1` (the Python bundle — librosa/numba, scipy, a static
  ffmpeg — is ~700 MB, over the 500 MB standard limit). Optional: `CRON_SECRET` (then only Vercel Cron can run the
  clean-up), `AUDIO_LAB_MAX_SECONDS` (200), `AUDIO_LAB_BUDGET_S` (280), `AUDIO_LAB_MAX_UPLOAD_MB` (150).
* **Dependencies:** the root `pyproject.toml` + `uv.lock` are this function's alone (Vercel installs them for
  `api/master.py`; `vercel-blob` there is left over from when files were in Vercel Blob). The Docker images do not use them.
* **Limits on the free plan:** recordings up to 3 min 20 s (after a trim; a 3-minute video peaks at 1.6 GB of the 2 GB), uploads up to 150 MB; B2's free tier
  stores 10 GB, with daily caps on downloads and calls (a free account without a card: 1 GB downloaded a day), and
  Vercel functions have 4 hours of CPU a month — the tightest: roughly 50–80 one-minute clips, or ~25 three-minute
  recordings (estimates from the timings above). No drum separation (PyTorch does not fit a function). (Vercel Blob,
  used before, paused the whole store for the month once its free allowance was used up.)

## Safety

Uploads are stored under names the server chooses; the visitor's file name is only shown back, sanitised. Every
ffmpeg and ffprobe call is an argument list with `-protocol_whitelist file`, so a playlist or concat file cannot make
it read other files or the network (tested). Container formats are checked against an allow-list after probing.
The request body is counted as it arrives and cut off past the limit. Job ids are 128 random bits. Each job runs in
its own process, with a timeout. Files are deleted after 24 hours or on request. For a public deployment, run the
container as the provided non-root user and put a body-size limit on the proxy as well.

## Tuning

The numbers that shape the sound are in `processing.py`: `BASE_EQ` (the tabla EQ), `adaptive_eq()` (how it scales),
`lehra_board()`, `VARIANTS` and `SOFT_HIGHS_HZ`, and `master()`. After listening to the three versions, change those,
run the tests, and compare the report of the same recording before and after: the per-band tonal balance is in
`report.json` for exactly that.
