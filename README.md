# Swaralaya — Indian Classical Practice Studio

**Swaralaya** is a practice companion for Indian classical musicians that runs entirely in the browser: a real-time **lehra player** with tanpura, metronome and practice tools, a **swar tuner**, a **notation editor**, a **Carnatic suite** (shruti box and talam), and an **AI stem separator** that lets you practise along with any song at your own Sa and tempo.

It began as a web port of the Android app *Lehra Studio* and now goes well beyond it.

> [!IMPORTANT]
> **Educational use only.** This project was built to explore the Web Audio API, digital signal processing and machine-learning audio separation. It includes some copyrighted audio recordings, used under fair use for educational demonstration only.

---

## Contents

- [At a glance](#at-a-glance)
- [Quick start](#quick-start)
- [The Lehra Player](#the-lehra-player)
  - [Choose, tune, set the tempo, play](#1-choose-what-to-play) · [Beat display & theka](#the-beat-display-and-theka) · [Tanpura](#tanpura) · [Metronome & count-in](#metronome-and-count-in) · [Laya trainer](#laya-trainer) · [Practice timer](#practice-timer) · [Riyaz tracker](#riyaz-tracker-daily-goal-and-streak) · [Presets](#your-saved-setup-and-presets) · [Studio FX & lock screen](#studio-fx-and-lock-screen-controls) · [Recording](#record-your-riyaz) · [Shortcuts](#keyboard-shortcuts)
- [Swar Tuner](#swar-tuner)
- [Notation Editor](#notation-editor)
- [Carnatic Suite](#carnatic-suite)
- [AI Stem Separator](#ai-stem-separator)
- [Practise Along with any song](#practise-along-with-any-song)
- [Your data and privacy](#your-data-and-privacy)
- [Browsers, phones and tips](#browsers-phones-and-tips)
- [Troubleshooting](#troubleshooting)
- [For developers](#for-developers)
- [Reference: instruments, taals and raags](#reference-instruments-taals-and-raags)

---

## At a glance

| Page | Open it from | What it's for |
|---|---|---|
| **Lehra Player** | Hindustani → *Lehra Player* (`/lehra`) | Play a recorded lehra (Sarangi, Esraj, Harmonium or Sitar) in any taal and raag, at your Sa and tempo, with tanpura, metronome, theka, laya trainer, practice timer and recording |
| **Notation Editor** | Hindustani → *Notation Editor* (`/notation`) | Write tabla bols or sargam, hear them played, save, share by link, export to PDF |
| **Carnatic Suite** | *Carnatic* in the top bar (`/carnatic`) | Shruti box and a talam metronome that shows every kriya |
| **Swar Tuner** | The tuning-fork button in the top bar, on any page | See which swar you're singing or playing, and how many cents off |
| **Stem Separator** | *STEM* in the top bar (`/separator/`) | Split a song into vocals, drums, bass, guitar, piano and other — or just vocals and accompaniment |
| **Practise Along** | *Practise along* in the separator's results, or Hindustani → *Practise Along* | Play a song's accompaniment transposed to your Sa and slowed down or sped up |

Everything you set up — your instrument, taal, raag, Sa, tempo, mix and tools — is remembered by your browser for next time.

---

## Quick start

1. Open the site and go to **Hindustani → Lehra Player**.
2. Pick an **instrument**, then a **taal**, then a **raag**.
3. Choose your **Sa** with *Scale* in the top bar (or type an exact frequency in Hz).
4. Pick a **tempo**: a preset, the slider, the ± buttons, or tap it with **TAP**.
5. Press **▶** (or the **Space** bar). The lehra starts on sam; the beat dots and theka follow it.

Change the tempo, Sa or even the raag while it plays — nothing restarts.

---

## The Lehra Player

### 1. Choose what to play

Work from left to right: **Instrument → Taal → Raag**. Each taal button shows its number of beats. The full list is in the [reference section](#reference-instruments-taals-and-raags).

You can pick another raag while the lehra plays: it crossfades to it, keeping your place in the cycle if the taal is the same, or landing on the new taal's sam if it isn't.

### 2. Set your Sa

*Scale* (top bar) offers every Sa from **F# (low)** to **G (high)**; the recordings were made in D (Sarangi in D#). For anything in between, type a frequency in the **Hz** box — anything from **87.31 to 207.65 Hz** — and press Enter. The lehra and tanpura follow instantly, without restarting.

### 3. Set the tempo

- **Preset pills** — the tempos the instrument was actually recorded at (the best-sounding choices).
- **Slider** and the **− / +** buttons (hold to repeat) — any tempo in the taal's range, shown next to *Tempo*.
- **Type** a BPM in the big number and press Enter (↑/↓ nudge it by 1).
- **TAP** — tap along a few times; the average of your taps becomes the tempo.

The engine always plays the recording closest to your tempo and time-stretches it, so any tempo in range sounds natural.

### 4. Play, pause, stop and loop

| Button | What it does |
|---|---|
| ▶ / ⏸ | Play from sam / pause |
| ■ | Stop and reset |
| ⟲ (loop) | On: the cycle repeats. **Off: the lehra finishes the current cycle and stops exactly on sam.** |

The ⛶ button on the *Now Playing* card switches to a distraction-free full-screen view.

### The beat display and theka

Under the transport:

- **Beat dots** — one per matra. The large gold dot is **sam**, filled dots are **taali**, dashed ones **khali**. The current matra lights up.
- **Theka** — the taal's bols, grouped in vibhags with their markers (**X** sam, **2 3 4** taali, **0** khali); the current bol is highlighted. Teentaal, Jhaptaal, Ektaal, Roopak, Dhamar and Sool Taal have thekas (see the [reference](#thekas)). The rarer taals — Jai, Matta, Rudra, Neel, Sunand, Sardha Roopak and Pancham Sawari — show beat dots only.
- **Matra counter** on the *Now Playing* card.

The display is timed to when you *hear* each beat, not when it is computed.

### Tanpura

The tanpura plays with the lehra; set its level with the **Tanpura** slider. Under the slider, choose its sound:

| Sound | Description |
|---|---|
| **Classic recording** | The original recorded tanpura (Pa–Sa–Sa–Sa) |
| **Plucked · auto** | A plucked tanpura built string by string; picks the male or female instrument that suits your Sa |
| **Plucked · male (Sa C#)** / **female (Sa G#)** | Choose the instrument yourself |

For the plucked tanpura you also choose:
- **First string: Pa, Ma or Ni** — for raags that omit Pa (e.g. Ma for Malkauns-type raags, Ni for others).
- **Pace: slow, medium or fast** plucking.

Every string is tuned to exact (just) intervals of your Sa. Changing any of these while playing crossfades smoothly.

### Metronome and count-in

In the options row:

- **Metronome** on/off, with its own volume slider.
- **Sound**: Classic, Digital Beep or Woodblock.
- **Subdivisions**: 1×, 2×, 3× (triplets) or 4× per beat.
- **Khali/Taali accents**: sam and taali louder, khali softer (off = the same click on every beat, sam still marked).
- **Count-in**: before the lehra starts, the metronome plays **one full cycle** (even if the metronome is off); the lehra then enters on sam.

The metronome is locked to the lehra's own clock, so it stays on the beat through every tempo change.

### Laya trainer

Build speed gradually. Open **Laya trainer** in the Tempo panel:

| Field | Meaning |
|---|---|
| Start | Tempo to begin at |
| Target | Tempo to finish at (higher or lower than Start) |
| Step | BPM to change by each time |
| Every … cycles | How many full taal cycles to play before each change |

Press **Start** (the lehra starts if it isn't playing). Each change happens on sam; the bar and message show where you are ("92 BPM → 120 · next +4 in 2 cycles"). It stops when the target is reached. Changing the tempo yourself, pausing or stopping cancels it.

*Example:* Start 60, Target 120, Step 5, Every 2 — two cycles at 60, two at 65, … then stays at 120.

### Practice timer

Open **Practice timer** (under the options) and set **Stop after** *N* **minutes** or *N* **cycles** (or *off*). When you press play:

- **Minutes** — when the time is up, the lehra finishes the cycle it's in and stops on sam.
- **Cycles** — it plays exactly that many cycles and stops on sam.

A bar shows the time left or the cycle you're in. Counting starts at the first sam (after any count-in).

### Riyaz tracker, daily goal and streak

The **bar-chart button** (top bar) opens the *Riyaz Tracker*:
- The last 7 days of Lehra practice (time the lehra was actually playing, counted per local day, including the session in progress).
- **Daily goal** in minutes (default 15) — a dashed goal line on the chart, and a bar for today's progress.
- **Streak** — consecutive days you met the goal. Today counts once you've met it; until then the streak runs to yesterday.

### Your saved setup and presets

The player **remembers everything automatically**: instrument, taal, raag, tempo, Sa (including a typed frequency), volumes, Studio FX, metronome options, loop, count-in, tanpura sound, wake-lock, laya-trainer and timer settings. When you come back, your last raag is already loaded, so ▶ starts instantly.

**Presets** (button next to *Studio FX*) let you keep several named setups — e.g. *Morning Yaman*, *Fast Teentaal*:
- Type a name and press **Save current** (saving an existing name replaces it; up to 50 presets).
- **Apply** switches to a preset — live, even while playing.
- **×** deletes one.

### Studio FX and lock-screen controls

**Studio FX** opens:
- **Bass** and **Treble** (±12 dB) and **Reverb**.
- **Lock-screen controls & background playback** (on by default). On phones the lehra then shows in the notification/lock screen with its raag, instrument and taal, play/pause/stop work from headphones and the lock screen, and unplugging headphones pauses it. It keeps playing when the screen is off. This path adds roughly 10–20 ms of output delay — switch it off if you need the tightest possible timing.

**Keep Screen Awake** stops the screen dimming while the lehra plays.

### Record your riyaz

Open **Record riyaz** (under the options):
1. Press **● Record** and allow the microphone. The meter shows your input level.
2. Play the lehra and sing or play along. The recording contains **your microphone plus the lehra and tanpura** (not the metronome), lined up for the delay of your speakers and microphone.
3. Press **■ Stop**. The take appears below with a player, **Download** (webm, or m4a on Safari) and **×** delete.

Takes stay only in this browser tab until you download them — the page warns you before closing with takes you haven't saved. Use headphones for the cleanest recordings.

### Keyboard shortcuts

| Key | Where | Action |
|---|---|---|
| Space | Lehra Player | Play / pause |
| ↑ / ↓ | Lehra Player | Tempo ±1 BPM |
| Enter | Tempo box | Apply the typed tempo |
| Ctrl/⌘ + S | Notation Editor | Save the composition in the browser |

---

## Swar Tuner

The **tuning-fork button** in the top bar opens the tuner on any page.

1. Press **Start microphone** and allow access.
2. Sing or play a steady note.

You'll see the **nearest swar** relative to your Sa (e.g. *Ga*, with *komal* or *tivra* where relevant, and *mandra / madhya / taar*), how many **cents** sharp or flat you are, and your frequency. The needle is green within ±10¢, gold within ±25¢.

- **Which Sa?** On the Hindustani pages, the Lehra player's Sa; on the Carnatic page, your shruti's Sa (with Carnatic names — S R1 R2 G2 G3 M1 M2 P D1 D2 N2 N3); on Practise Along, your Sa there.
- **Just intonation** (default) measures against the pure intervals a tanpura produces; **Equal temperament** against a harmonium/keyboard.
- Use **headphones** while the lehra plays, so the tuner hears only you.

The microphone is only analysed — it is never played back, recorded or sent anywhere. Closing the tuner turns it off.

---

## Notation Editor

Write compositions in Bhatkhande or Paluskar notation.

**Set up the page** (top bar):
- **Tabla** or **Vocal** mode, **Bhatkhande** or **Paluskar** system, **English** or **हिंदी** (switching language translates what you've written).
- **Taal**: Teentaal (16), Ektaal (12), Jhaptaal (10), Keharwa (8), Rupak (7), Dadra (6), Dhamar (14) or Deepchandi (14). Vibhags and X/2/0/3 markers are drawn for you.
- **Templates**: Kaida, Rela and Tukda (tabla); Sargam Geet in Yaman, a Bhairav bandish and a Bilawal lakshan geet (vocal).

**Write:** click a cell and type, or click items in the **Palette** (searchable). Several bols or swaras in one cell share its matra. Use `-` or `ऽ` for a held/silent matra. **+ Add Line** adds a row; ↶ / ↷ undo and redo.

**Formatting marks** (select a cell, then a button):

| Button | Mark | Meaning |
|---|---|---|
| <u>R</u> | underline | komal (vocal) / double speed |
| Ṣ | dot below | mandra saptak |
| Ṡ | dot above | taar saptak |
| M\| | vertical line | tivra Ma |
| ⨂ | — | clear the mark |

**Play (▶):** tabla bols are played by a synthesized tabla — the dayan tuned to your Sa, the bayan below it; *Dha* sounds as *Na + Ge*, and bols like *Tirakita* are split within the matra. Sargam is sung by a synthesized voice in just intonation, with komal, tivra and saptak marks; the words of a bandish stay silent. Playback uses the **Lehra player's tempo and Sa** (shown next to ▶).

**Save / Share** (💾 button):
- **Save in browser** — keep compositions in this browser (Ctrl+S saves under the title). **Open** or **×** delete them later.
- **Export .json / Import .json** — move compositions between devices or back them up.
- **Copy share link** — a link that *contains* the whole composition (compressed). Anyone who opens it sees it in the editor; nothing is uploaded.

**PDF / PNG** exports the page for printing.

---

## Carnatic Suite

### Shruti

| Control | Options |
|---|---|
| Sa | 1 kattai (C) … 7 kattai (B), including the half-kattais (e.g. 1½ = C#) |
| Fine | An exact Sa in Hz (leave empty to use the kattai) |
| Sound | **Tanpura (plucked)** or **Shruti box (reed)** |
| With | The drone's other note: **Pa**, **Ma** or **Ni** |
| Pace | Plucking pace of the tanpura |

**Start** / **Stop** and a volume slider. Changes glide or crossfade while it plays.

### Talam

Choose a **tala**, set the **BPM** (akshara speed; − / + change it by 2) and press **Start**.

- **Tala**: Adi, Rupaka, Misra Chapu, Khanda Chapu, Tisra Triputa, Khanda Ata, Misra Jhampa, Chatusra Matya, Chatusra Dhruva, Chatusra Eka, Tisra Eka — or **Other suladi tala…** to pick any of the seven suladi talas in any of the five jatis (35 in all).
- **Kalai**: 1 or 2 (in 2 kalai every akshara is held for a second count).
- **Nadai**: optional quiet subdivisions — 2, tisra 3, chatusra 4, khanda 5, misra 7.

The display shows the angas — **I** laghu (with its jati), **O** drutam, **U** anudrutam — with each beat's kriya. The current kriya is shown large, with *Beat n / N* and the avartanam count. Each kriya has its own sound: a **clap** (louder on sam), a softer **wave**, and a light tick for **finger counts** (little → ring → middle → index → thumb).

The chapu talas are counted in groups with a clap on the first beat of each: **Misra Chapu 3+2+2** (claps on 1, 4, 6) and **Khanda Chapu 2+3** (claps on 1, 3); the other beats are counted silently. All kriyas are listed in the [reference](#carnatic-talas).

Leaving the page stops the shruti and talam. They also work with the lock screen and headphone buttons.

---

## AI Stem Separator

Open **STEM** in the top bar.

1. **Drop a song** on the upload area or click to choose one: MP3, WAV, FLAC, AAC, OGG, M4A, WMA, AIFF, ALAC — or a video (MP4, MKV, MOV, WEBM, AVI); up to **100 MB**.
2. Choose the separation:
   - **Full · 6 stems** — vocals, drums, bass, guitar, piano, other.
   - **Fast · 2 stems** — vocals and accompaniment (everything else). Quicker, and all you need to practise along.
3. Press **Separate Stems Now**. A live log follows the AI's progress (usually a minute or two for a song; the server separates one song at a time, so you may wait in a queue).
4. In the **results**:
   - ▶ plays all stems together; drag any waveform to seek.
   - Per stem: a volume slider, **SOLO** and **MUTE**.
   - **Download ZIP** — every stem as an MP3.
   - **Practise along** — opens the song in [Practise Along](#practise-along-with-any-song).
   - **Start New** deletes this separation from the server.

**Separations are kept for one hour**, then deleted from the server automatically. If the server is busy (four songs already waiting), you'll be asked to try again in a few minutes.

---

## Practise Along with any song

After separating a song, press **Practise along**. The song's accompaniment opens on the main site, played through the same real-time engine as the lehra:

| Control | What it does |
|---|---|
| ▶ / ⏸, ■, ⟲ | Play/pause, stop (back to the start), loop on/off (off = stops at the end of the song) |
| Position bar | Drag to jump anywhere in the song |
| **Transpose** − / + | Move the song up or down in semitones (±12) without changing its speed |
| **Speed** | 50 %–150 % (± 5 % buttons) without changing its pitch |
| **Song's Sa / Your Sa / Match** | Pick the song's Sa and yours, then **Match** transposes the song the shortest way (at most 6 semitones) so its Sa becomes yours |
| **Play** (stem toggles) | Which stems you hear: the accompaniment by default; add **Vocals** to hear the original singer, or drop e.g. drums |
| **Song** / **Tanpura** | Volumes. The tanpura (off by default) drones on *your* Sa |

Everything changes live while it plays. The page works as long as it's open; if you come back after the separation has expired (one hour), it tells you and links back to the separator.

---

## Your data and privacy

**No accounts, no tracking.** Everything personal stays in your browser:

| What | Where it's kept |
|---|---|
| Your setup, presets, riyaz time and goal, tuner and Carnatic settings | Your browser's local storage (this device and browser only) |
| Saved notation compositions | Local storage; share links carry the composition inside the link itself |
| Riyaz recordings | Only in the open tab, until you download them |
| Microphone audio (tuner, recorder) | Never leaves your device |
| Songs you upload to the Stem Separator | Sent to the server for separation; the upload and its stems are **deleted after one hour** (or when you press *Start New*) |

Clearing your browser data (or using a private window) removes the saved items.

---

## Browsers, phones and tips

- Works in current **Chrome, Edge, Firefox and Safari** (desktop, Android and iOS). The player needs AudioWorklet support (any browser from the last few years).
- The first sound needs a tap or click — browsers don't allow pages to play audio on their own.
- **Install it** as an app (browser menu → *Install* / *Add to Home Screen*). After your first visit the app and the recordings you've used are cached, so the Lehra player, tuner, notation editor and Carnatic suite work **offline**. The Stem Separator and Practise Along need the server.
- **Headphones** make the tuner and recordings much more accurate.
- On **iPhone**, turn on *Lock-screen controls & background playback* (Studio FX) so audio keeps playing with the ring switch on silent and when the screen locks.

---

## Troubleshooting

| Problem | Try this |
|---|---|
| No sound | Click anywhere on the page once (browsers need a gesture), check the Lehra / Tanpura / Metronome sliders, and that the device isn't muted. |
| The lehra takes a moment to start | The first play of a raag downloads and decodes it (a few MB). It's cached afterwards; your last raag is pre-loaded when you return. |
| I hear clicks though the metronome is off | That's the **count-in** (options row). Turn it off if you don't want it. |
| The count-in is very long | It's one full cycle — at slow tempos (e.g. Teentaal at 40 BPM, 24 s) that takes a while. |
| The laya trainer stopped by itself | It stops when you change the tempo by hand, pause or stop — and when it reaches the target. |
| "Microphone permission was refused" | Allow the microphone in the browser's site settings (padlock icon in the address bar) and try again. |
| The tuner jumps between swaras | Use headphones, and sing or play a steady, clear note close to the device. |
| "This separation has expired" | Separations are deleted after an hour. Separate the song again. |
| "The separator is busy" | Four songs are already queued — try again in a few minutes. |
| My presets / settings disappeared | They live in the browser: private windows and clearing site data remove them. |
| Audio is slightly behind on Bluetooth headphones | Bluetooth adds its own delay; wired headphones are best for playing along. |

---

## For developers

### Architecture

```
Browser (no build step, ES modules)                          Server (C++ / Drogon, one Docker image)
┌──────────────────────────────────────────────────────┐    ┌─────────────────────────────────────────┐
│ index.html + public/js/main.js                        │    │ StaticController  site files, SPA routes │
│  core/     AudioContext, master output → <audio>,     │    │ StemController    /api/separate, status, │
│            media session, microphone, routing         │◄──►│                   stems, peaks, ZIP      │
│  lehra/    engine.js ⇄ engine.worklet.js (WSOLA +     │    │ JobWorkerPool     python3 -m demucs      │
│            sinc resampling), player, tools…           │    │                   (one job at a time)    │
│  notation/ carnatic/ tuner/ practice/                 │    │ Peaks.cpp         waveform peaks         │
│ public/separator/  (Next.js export of stem-frontend/) │    └─────────────────────────────────────────┘
└──────────────────────────────────────────────────────┘
```

- **Lehra engine.** Each raag's `.aac` holds one recorded cycle per preset tempo. It is decoded once in the browser, the AAC encoder delay (1640 samples) is skipped, and it's split into seamless per-tempo loops. The AudioWorklet (`public/js/lehra/engine.worklet.js`) resamples for pitch (Kaiser-windowed sinc) and time-stretches with WSOLA, always reading the recording whose tempo — after the pitch shift — is closest. It reports its musical clock (beat ↔ time), which drives the metronome, beat display, theka, laya trainer and practice timer.
- **Song mode.** Practise Along loads a whole track as a single "cycle" of one beat, so the same engine gives live speed, transpose, seeking and loop-off for any song.
- **Output.** Everything connects to one master gain (`core/audio-output.js`), routed through a `MediaStreamAudioDestinationNode` into a hidden `<audio>` element while playing — that is what lets phones show lock-screen controls — or straight to the speakers.

### Run it locally

Prerequisites: Git, [Docker Desktop](https://www.docker.com/products/docker-desktop/), and Node.js 22+ (only for tests and for rebuilding the separator).

```bash
git clone <repository-url>
cd <repository-folder>/webapp
docker compose up --build
```

Open `http://localhost:3000`. The first build compiles the C++ server and takes a while; later builds are cached. The site files (`index.html`, `public/`, `assets/`, …) are mounted into the container, so frontend edits show on reload. Changes under `drogon_server/` need `docker compose up --build`.

Frontend only, without Docker: `python -m http.server 3000` in `webapp/` serves the site, but not the API or the SPA paths (`/lehra` etc. — load `/` and navigate).

### Tests

```bash
npm install     # once: ESLint
npm run lint    # site modules, service worker, tests
npm test        # engine (incl. song mode), tanpura, tuner, notation, Carnatic talas, settings, service worker, catalogue
bash tests/smoke.sh http://localhost:3000   # a running server: pages, security, API validation
```

The engine tests drive the real AudioWorklet DSP offline on synthetic audio (e.g. playback at a recorded tempo is bit-exact; loop-off and the practice timer end within 5 ms of sam). GitHub Actions (`.github/workflows/ci.yml`) runs lint and tests on every push and builds and smoke-tests the Docker image.

### Rebuilding the Stem Separator frontend

```bash
cd stem-frontend
npm install
npm run build   # also replaces ../public/separator with the new export
```

`npm run dev` serves it on http://localhost:3001 against the server on port 3000.

### Server API

| Method & path | Purpose |
|---|---|
| `POST /api/separate` | Multipart upload: `file`, optional `mode` = `6stems` (default) or `2stems`. → `202 { job_id, status, mode }` |
| `GET /api/job_status/{id}` | `{ status: queued/processing/completed/error, progress, logs, mode, stems }` |
| `GET /api/stems/{id}/{stem}.mp3` | One stem: vocals, drums, bass, guitar, piano, other, no_vocals |
| `GET /api/stems_peaks/{id}` | Waveform peaks for the separator's player |
| `GET /api/download/{id}` | All stems as a ZIP |
| `DELETE /api/cleanup/{id}` | Delete a job and its files |
| `GET /health` | Health check |

Limits: 100 MB uploads, one separation at a time, at most 4 queued or running jobs (then `503`), everything deleted an hour after upload.

### Project structure

```
drogon_server/       C++ server (Drogon): static files, stem separation jobs, waveform peaks
public/js/main.js    entry point
public/js/core/      shared: DOM, the single AudioContext and master output, media session, microphone, routing
public/js/lehra/     Lehra player: engine (engine.js + engine.worklet.js), player, selection, controls, metronome,
                     scheduler, theka, tanpura, laya trainer, practice timer, recorder, riyaz, settings, catalogue
public/js/notation/  Notation Editor, library & share links, tabla/voice synthesis
public/js/carnatic/  Carnatic suite: shruti, talam, talas
public/js/tuner/     swar tuner (pitch.worklet.js: YIN)
public/js/practice/  Practise Along (song mode)
public/separator/    exported Stem Separator (source in stem-frontend/)
assets/              lehra recordings, tanpura (recorded drone + single-string plucks), metronome sounds
tests/               unit tests (node --test) and the server smoke test
```

### Extending the catalogue

- **A raag**: add the `.aac` to `assets/` and an entry to the taal's `raags` in `public/js/lehra/catalogue.js`. The file must hold one cycle per tempo in `tempos`, in that order.
- **A theka**: add a `theka` string to the taal — bols separated by spaces, vibhags by `|`, starting on sam and on each taali/khali matra (`npm test` checks this).

---

## Reference: instruments, taals and raags

<details>
<summary><strong>All 27 instrument–taal combinations and their raags</strong></summary>

| Instrument | Taal | Beats | Tempo range (BPM) | Raags |
|---|---|---|---|---|
| Sarangi | Roopak | 7 | 60–240 | Charukeshi |
| Sarangi | Jhaptaal | 10 | 30–180 | Bageshree, Bahar |
| Sarangi | Jai Taal | 13 | 45–180 | Jog |
| Sarangi | Pancham Sawari | 15 | 60–180 | Charukeshi |
| Sarangi | Teentaal | 16 | 30–500 | Bhairavi, Bhupali, Desh, Jog, Madhukauns, Mand, Nat Bhairav, Kalawati, Gorak Kalyan, Chandrakauns, Binna Shadja |
| Esraj | Roopak Taal | 7 | 65–240 | Kedar |
| Esraj | Matta Taal | 9 | 50–150 | Darbari Kanada |
| Esraj | Jai Taal | 13 | 50–180 | Alhayia Bilwal |
| Esraj | Roopak Double Cycle | 14 (2 × 7) | 65–240 | Kedar |
| Esraj | Teentaal | 16 | 30–500 | Chandrakauns, Bageshree, Sohini, Kirwani, Misra Tilang, Jaijaiwanti, Charukeshi, Madhuwanti, Saraswati |
| Harmonium | Roopak Taal | 7 | 55–240 | Patdeep |
| Harmonium | Jhaptaal | 10 | 30–180 | Jaijawanti, Tilang |
| Harmonium | Sool Taal | 10 | 55–180 | Kedar |
| Harmonium | Ektaal | 12 | 50–240 | Gavti |
| Harmonium | Dhamar | 14 | 55–180 | Charukeshi |
| Harmonium | Pancham Sawari | 15 | 45–180 | Chandrakauns |
| Harmonium | Teentaal | 16 | 30–500 | Kirwani, Misra Bhairavi, Bilaskhani Todi, Misra Kirwani, Misra Madhuwanti, Todi |
| Sitar | Roopak Taal | 7 | 60–240 | Bageshree |
| Sitar | Jhaptaal | 10 | 30–150 | Tilak Kamod, Shivranjani |
| Sitar | Rudra Taal | 11 | 50–180 | Kedar |
| Sitar | Ektaal | 12 | 50–240 | Kedar |
| Sitar | Jai Taal | 13 | 45–180 | Hindol |
| Sitar | Neel Taal | 15 | 60–180 | Bageshree |
| Sitar | Pancham Sawari | 15 | 45–180 | Hansadhwani |
| Sitar | Teentaal | 16 | 30–500 | Bhimpalasi, Charukeshi, Basant |
| Sitar | Sunand Taal | 19 | 45–180 | Hansadhwani |
| Sitar | Sardha Roopak | 21 | 30–150 | Bhimpalashree |

Neel, Sunand and Sardha Roopak (7½, 9½ and 10½ beats) are recorded as two cycles per loop.

</details>

### Thekas

| Taal | Theka (vibhag marker in bold) |
|---|---|
| Teentaal (16) | **X** Dha Dhin Dhin Dha &#124; **2** Dha Dhin Dhin Dha &#124; **0** Dha Tin Tin Ta &#124; **3** Ta Dhin Dhin Dha |
| Jhaptaal (10) | **X** Dhi Na &#124; **2** Dhi Dhi Na &#124; **0** Ti Na &#124; **3** Dhi Dhi Na |
| Ektaal (12) | **X** Dhin Dhin &#124; **0** DhaGe TiRaKiTa &#124; **2** Tu Na &#124; **0** Kat Ta &#124; **3** DhaGe TiRaKiTa &#124; **4** Dhi Na |
| Roopak (7) | **0** Tin Tin Na &#124; **1** Dhi Na &#124; **2** Dhi Na |
| Dhamar (14) | **X** Ka Dhi Ta Dhi Ta &#124; **2** Dha – &#124; **0** Ga Ti Ta &#124; **3** Ti Ta Ta – |
| Sool Taal (10) | **X** Dha Dha &#124; **0** Din Ta &#124; **2** Kita Dha &#124; **3** Tita Kata &#124; **0** Gadi Gana |

### Carnatic talas

| Tala | Angas | Aksharas | Kriyas |
|---|---|---|---|
| Adi | I₄ O O | 8 | Clap, Little, Ring, Middle, Clap, Wave, Clap, Wave |
| Rupaka | O I₄ | 6 | Clap, Wave, Clap, Little, Ring, Middle |
| Misra Chapu | 3+2+2 | 7 | Clap, ·, ·, Clap, ·, Clap, · |
| Khanda Chapu | 2+3 | 5 | Clap, ·, Clap, ·, · |
| Tisra Triputa | I₃ O O | 7 | Clap, Little, Ring, Clap, Wave, Clap, Wave |
| Khanda Ata | I₅ I₅ O O | 14 | Clap, Little, Ring, Middle, Index, Clap, Little, Ring, Middle, Index, Clap, Wave, Clap, Wave |
| Misra Jhampa | I₇ U O | 10 | Clap, Little, Ring, Middle, Index, Thumb, Little, Clap, Clap, Wave |
| Chatusra Matya | I₄ O I₄ | 10 | Clap, Little, Ring, Middle, Clap, Wave, Clap, Little, Ring, Middle |
| Chatusra Dhruva | I₄ O I₄ I₄ | 14 | Clap, Little, Ring, Middle, Clap, Wave, Clap, Little, Ring, Middle, Clap, Little, Ring, Middle |
| Chatusra Eka | I₄ | 4 | Clap, Little, Ring, Middle |
| Tisra Eka | I₃ | 3 | Clap, Little, Ring |

(· = a silently counted beat.)

### Shruti (kattai)

| Kattai | 1 | 1½ | 2 | 2½ | 3 | 4 | 4½ | 5 | 5½ | 6 | 6½ | 7 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Sa | C | C# | D | D# | E | F | F# | G | G# | A | A# | B |
| Hz | 130.81 | 138.59 | 146.83 | 155.56 | 164.81 | 174.61 | 185.00 | 196.00 | 207.65 | 220.00 | 233.08 | 246.94 |
