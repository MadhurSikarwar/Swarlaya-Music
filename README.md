# Lehra Studio Web & AI Stem Separator

A premium, interactive web application designed for Indian Classical music practice (Riyaz) and advanced AI Audio Processing. This project brings the functionality of the mobile Lehra Studio app into the browser, and introduces a powerful new **AI Stem Separator** using state-of-the-art deep learning.

> [!IMPORTANT]
> **Educational Use Only**
> This project was built strictly for **educational purposes** to explore advanced Web Audio API, digital signal processing techniques, and machine learning models in Python. It utilizes some copyrighted audio assets which are included under fair use for educational demonstration only. 

---

## 🎵 Feature 1: The Lehra Player (Indian Classical Practice)

The Lehra Player is a beautifully crafted distraction-free UI complete with real-time pitch shifting, tempo adjustments, and a practice tracker.

### How the Background Audio Engineering Works
Like the Android app's native engine, the Lehra Player renders audio **live in the browser**, so tempo and pitch changes are instant and never restart the cycle:

*   **Decode once:** Each raag's `.aac` holds one recorded taal cycle per preset tempo. The browser decodes it once, skips the AAC encoder delay (1640 samples), and splits it into seamless per-tempo loops (a short crossfade into the audio that precedes each sam removes the tick at every loop point).
*   **Real-time engine (AudioWorklet):** `public/js/lehra/engine.worklet.js` resamples for pitch (band-limited sinc) and time-stretches with WSOLA, always reading the recording whose tempo — after the pitch shift — is closest, so the residual stretch stays within about ±15%. Moving between recordings crossfades at the same position in the cycle.
*   **Tanpura:** The drone (`tanpura_06_01.wav`, tuned with Sa = F) is resampled live to the selected Sa.
*   **Locked metronome:** Metronome ticks and the matra display are scheduled from the engine's own musical clock, so they stay on the lehra's beats through every tempo change.

### Advanced Lehra Features
- **Riyaz Tracker:** Automatically tracks your daily practice sessions and visualizes your progress over a 7-day period using browser `localStorage`.
- **Studio Effects:** Built-in Bass and Treble EQ, along with a dynamically synthesized Reverb effect to simulate concert halls.
- **Visualizer & Fullscreen:** An audio-reactive, pulsing mandala syncs to the music.

---

## 🎶 Feature 2: AI Stem Separator

The Stem Separator allows users to upload any song and extract the individual instruments using Facebook's powerful **Hybrid Demucs (htdemucs_6s)** deep learning model.

### Deep Learning Pipeline
*   **Hybrid Demucs Extraction:** The backend spawns a background Demucs process to analyze uploaded `.wav`, `.mp3`, or `.m4a` files. It utilizes hybrid transformer layers to perfectly isolate **Vocals, Drums, Bass, Guitar, Piano, and Other** instruments.
*   **Live Neural Network Streaming:** The frontend features a sleek, mobile-responsive hacker-style terminal. The backend intercepts `stdout` from the Demucs Python process and streams descriptive AI milestones directly to the user (e.g., *Loading model weights...*, *Separating harmonic and percussive components...*) in real-time without exposing raw progress bars.
*   **Interactive Multitrack Player:** Once the AI finishes separating the stems, the user is presented with a beautiful, responsive Multitrack UI. Users can visually adjust volumes, **Solo** specific tracks, or **Mute** unwanted tracks using custom UI controls with dynamic color styling.
*   **ZIP Export:** Users can download all extracted stems packaged neatly into a `.zip` file for use in DAWs like Ableton or Logic Pro.
*   **Server limits:** Demucs needs several GB of RAM, so the server runs one separation at a time, accepts uploads up to 100 MB, queues at most 4 jobs (further uploads get a "busy, try again" message), and deletes every upload and its results an hour after it was made.

---

## 🎨 Premium Aesthetics & Mobile Responsiveness
Both applications are built with a breathtaking, dark-mode premium aesthetic:
- **Cinzel Typography:** Indian-classical inspired serif typography mixed with clean modern sans-serifs.
- **Glassmorphism:** Frosted glass panels with subtle ambient animated backgrounds.
- **Fully Responsive:** The entire layout perfectly reflows and resizes paddings for mobile screens so it feels like a native app on iOS or Android.

---

## 🆕 Recent Updates

- **Frontend & UI:** Initialized `stem-frontend` layout with Next.js, added play/pause notation controls, and deployed static separator assets with service worker updates.
- **Audio Engine:** Implemented the core Web Audio engine for robust, artifact-free playback.
- **Real-time Lehra engine:** Tempo, pitch and raag changes now happen live in the browser (AudioWorklet) instead of being re-rendered on the server; loops are seamless and the tanpura plays in tune.
- **Docker & Deployment:** Added `Dockerfile` using Gunicorn, fixed file serving issues in Docker slim images by adding `mailcap` for MIME types, and set up Cloudflare tunneling.

---

## 🚀 Getting Started

### Prerequisites
- Git
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) — the site runs as one Docker image, locally and in production
- Node.js 22+ (only for the tests and for rebuilding the Stem Separator frontend)

### Run it locally
```bash
git clone <repository-url>
cd <repository-folder>/webapp
docker compose up --build
```
Open `http://localhost:3000`.

The first build compiles the C++ server and takes a while; later builds are cached. The website files (`index.html`, `public/`, `assets/`, …) are mounted into the container, so frontend edits show up on reload. Changes under `drogon_server/` need `docker compose up --build`.

### Tests
```bash
npm install     # once: ESLint
npm run lint    # site modules, service worker, tests
npm test        # Lehra engine, service worker, catalogue, riyaz
```
`bash tests/smoke.sh http://localhost:3000` checks a running server (pages, security, API validation). GitHub Actions (`.github/workflows/ci.yml`) runs all of these on every push and builds the Docker image, so C++ compile errors show up there before Render.

### Rebuilding the Stem Separator frontend
Only needed when changing `stem-frontend/`:
```bash
cd stem-frontend
npm install
npm run build   # also replaces ../public/separator with the new export
```
For live development, `npm run dev` serves it on http://localhost:3001 and talks to the server on port 3000.

### Project structure
```
drogon_server/      C++ server (Drogon): static files, stem separation jobs, waveform peaks
public/js/main.js   entry point (ES modules, no build step)
public/js/core/     shared helpers: DOM, the single AudioContext, view routing
public/js/lehra/    Lehra player: real-time engine (engine.js + engine.worklet.js), controls, metronome, riyaz
public/js/notation/ Notation Editor
public/separator/   exported Stem Separator app (source in stem-frontend/)
assets/             lehra recordings, tanpura, metronome sounds
tests/              unit tests (node --test) and the server smoke test
```
