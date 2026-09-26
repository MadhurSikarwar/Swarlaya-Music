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
*   **Tanpura:** The drone is resampled live to the selected Sa — either the recorded drone (`tanpura_06_01.wav`, Pa–Sa–Sa–Sa with Sa = F) or a plucked tanpura built from single-string recordings (see *Custom tanpura* below). Changing the tanpura while playing crossfades.
*   **Locked metronome:** Metronome ticks and the matra display are scheduled from the engine's own musical clock, so they stay on the lehra's beats through every tempo change. The click samples' own AAC encoder delay (~37 ms) is skipped, so clicks land on the beat.

### Advanced Lehra Features
- **Remembers your setup:** Instrument, taal, raag, tempo, Sa (including fine-tune), volumes, effects, metronome options, loop, wake lock and the tools below are saved in `localStorage` and restored on the next visit (the raag is decoded in the background, so Play starts at once). **Presets** save, apply and delete named setups.
- **Theka:** The taal's theka is shown under the beat dots, grouped in vibhags with their X/2/0/3 markers, and the current bol lights up. Teentaal, Jhaptaal, Ektaal, Roopak (and Roopak Double Cycle), Dhamar and Sool Taal have one; the rarer taals (Jai, Matta, Rudra, Neel, Sunand, Sardha Roopak, Pancham Sawari) deliberately have none rather than a guessed one — add a `theka` string to `catalogue.js` to fill them in.
- **Lock-screen & headphone controls:** Raag · instrument · taal appear in the phone's media controls (Media Session), with play/pause/stop; unplugging headphones pauses the lehra. The output is routed through a hidden `<audio>` element for this (it also keeps phones playing in the background) — measured at about 10–20 ms of extra output latency, so it can be switched off in *Studio FX*.
- **Laya trainer:** Ramp from a start to a target tempo by a step every N taal cycles; cycles are counted on the engine's clock so each change lands on sam. A manual tempo change or stopping cancels it.
- **Practice timer & count-in:** Stop after N minutes or N cycles — always exactly on sam (the engine's loop-off fade). An optional one-cycle metronome count-in leads into the lehra's first sam.
- **Riyaz Tracker:** Daily practice time over the last 7 days (in `localStorage`), with a daily goal (a goal line on the chart) and the streak of days that met it.
- **Custom tanpura:** A plucked tanpura (male set, Sa C#; female set, Sa G#; or *auto* by your Sa) with the first string on **Pa, Ma or Ni** and a slow/medium/fast pace. The string recordings (`assets/tn{1,2}str{10,20,40}.wav`) were measured: each is one pluck of one string — Pa, Sa and kharaj Sa of each set. There is no Ma or Ni recording, so the first string is resampled from the Pa pluck to an exact just interval (which also corrects the female set's Pa, recorded 12 cents flat). They're loaded only when chosen, never precached.
- **Record your riyaz:** Records your microphone together with the lehra and tanpura (MediaRecorder, webm/opus) as takes you can play back and download. The lehra is delayed by the measured output + input latency so it lines up with what you played. Takes never leave the browser.
- **Studio Effects:** Built-in Bass and Treble EQ, along with a dynamically synthesized Reverb effect to simulate concert halls.
- **Visualizer & Fullscreen:** An audio-reactive, pulsing mandala syncs to the music.

---

## 🎼 Notation Editor

Write tabla bols or sargam in Bhatkhande or Paluskar notation, in English or Hindi, and export to PDF.
- **Save & share:** Save compositions in the browser (Ctrl+S), export/import them as `.json`, or copy a **share link** that carries the whole composition, deflate-compressed, in the URL (`/notation#n=…`) — nothing is uploaded.
- **Playback:** Tabla bols are synthesized with Web Audio — the dayan rings at your Sa, the bayan booms or slaps, compound bols (Dha = Na + Ge) sound together and Tirakita-style bols split the matra. Sargam is sung by a formant-filtered voice in just intonation (komal/tivra and saptak marks included); the words of a bandish stay silent. Playback follows the Lehra player's tempo and Sa.

## 🪘 Carnatic Suite

- **Shruti:** A drone at your kattai (1 = C … 7 = B, or fine-tuned in Hz) — the plucked tanpura (Pa, Ma or Ni) or a synthesized reed shruti box.
- **Talam:** A metronome with its own lookahead scheduler that shows the angas (laghu I, drutam O, anudrutam U) and plays and displays each kriya — clap, wave and finger counts. Adi, Rupaka, Misra Chapu, Khanda Chapu, Tisra Triputa, Khanda Ata, Misra Jhampa, Chatusra Matya/Dhruva/Eka, Tisra Eka, or any of the 35 suladi talas by tala and jati; 1 or 2 kalai; optional nadai subdivisions. The chapu talas are kept by claps on the first beat of each group (Misra 3+2+2: claps on 1, 4, 6; Khanda 2+3: on 1, 3).

## 🎙️ Swar Tuner

The tuning-fork button in the header listens to your microphone, detects your pitch (YIN, in an AudioWorklet) and shows the nearest swar relative to the current page's Sa — mandra/madhya/taar, komal/tivra, and the deviation in cents on a steadied needle — against just intonation or equal temperament. The microphone is only analysed; it is never played back, recorded or sent anywhere.

---

## 🎶 Feature 2: AI Stem Separator

The Stem Separator allows users to upload any song and extract the individual instruments using Facebook's powerful **Hybrid Demucs (htdemucs_6s)** deep learning model.

### Deep Learning Pipeline
*   **Hybrid Demucs Extraction:** The backend spawns a background Demucs process to analyze uploaded `.wav`, `.mp3`, or `.m4a` files. It utilizes hybrid transformer layers to perfectly isolate **Vocals, Drums, Bass, Guitar, Piano, and Other** instruments.
*   **Live Neural Network Streaming:** The frontend features a sleek, mobile-responsive hacker-style terminal. The backend intercepts `stdout` from the Demucs Python process and streams descriptive AI milestones directly to the user (e.g., *Loading model weights...*, *Separating harmonic and percussive components...*) in real-time without exposing raw progress bars.
*   **Interactive Multitrack Player:** Once the AI finishes separating the stems, the user is presented with a beautiful, responsive Multitrack UI. Users can visually adjust volumes, **Solo** specific tracks, or **Mute** unwanted tracks using custom UI controls with dynamic color styling.
*   **ZIP Export:** Users can download all extracted stems packaged neatly into a `.zip` file for use in DAWs like Ableton or Logic Pro.
*   **Fast mode:** At upload, choose *Fast · 2 stems* (`demucs --two-stems vocals`, same model) to get just `vocals.mp3` and `no_vocals.mp3` — measured 15–25% quicker on a 30 s clip, since fewer stems are written and encoded.
*   **Practise along:** From the results, *Practise along* opens `/practice?job=<id>` on the main site: the accompaniment (`no_vocals.mp3`, or the sum of the non-vocal stems — tick stems in or out, vocals included) plays through the Lehra engine in *song mode* — the whole track as one segment — transposed to your Sa (by semitones, or *Match* the song's Sa to yours) and at 50–150% speed, live, with seeking and loop on/off. Expired jobs (after an hour) are reported rather than failing.
*   **Server limits:** Demucs needs several GB of RAM, so the server runs one separation at a time, accepts uploads up to 100 MB, queues at most 4 jobs (further uploads get a "busy, try again" message), and deletes every upload and its results an hour after it was made.

---

## 🎨 Premium Aesthetics & Mobile Responsiveness
Both applications are built with a breathtaking, dark-mode premium aesthetic:
- **Cinzel Typography:** Indian-classical inspired serif typography mixed with clean modern sans-serifs.
- **Glassmorphism:** Frosted glass panels with subtle ambient animated backgrounds.
- **Fully Responsive:** The entire layout perfectly reflows and resizes paddings for mobile screens so it feels like a native app on iOS or Android.

---

## 🆕 Recent Updates

- **Practice tools:** Remembered setup and presets, theka display, lock-screen controls, laya trainer, practice timer, goals and count-in, custom plucked tanpura, swar tuner, riyaz recording, notation save/share with synthesized tabla and voice, the Carnatic suite, fast 2-stem separation and practising along with any song.
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
npm test        # Lehra engine (incl. song mode), tanpura, tuner, notation, Carnatic talas, settings, service worker, catalogue
```
`bash tests/smoke.sh http://localhost:3000` checks a running server (pages, security, API validation incl. separation modes and stem names). GitHub Actions (`.github/workflows/ci.yml`) runs all of these on every push and builds the Docker image, so C++ compile errors show up there before Render.

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
public/js/core/     shared helpers: DOM, the single AudioContext and master output, media session, microphone, view routing
public/js/lehra/    Lehra player: real-time engine (engine.js + engine.worklet.js), controls, metronome, riyaz, settings,
                    theka, laya trainer, practice timer, tanpura, recorder
public/js/notation/ Notation Editor (library/share links, tabla and voice synthesis)
public/js/carnatic/ Carnatic suite: shruti box, talam metronome, talas
public/js/tuner/    swar tuner (pitch.worklet.js: YIN)
public/js/practice/ practise along with a separated song (Lehra engine in song mode)
public/separator/   exported Stem Separator app (source in stem-frontend/)
assets/             lehra recordings, tanpura (recorded drone + single-string plucks), metronome sounds
tests/              unit tests (node --test) and the server smoke test
```
