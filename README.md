# Lehra Studio Web & AI Stem Separator

A premium, interactive web application designed for Indian Classical music practice (Riyaz) and advanced AI Audio Processing. This project brings the functionality of the mobile Lehra Studio app into the browser, and introduces a powerful new **AI Stem Separator** using state-of-the-art deep learning.

> [!IMPORTANT]
> **Educational Use Only**
> This project was built strictly for **educational purposes** to explore advanced Web Audio API, digital signal processing techniques, and machine learning models in Python. It utilizes some copyrighted audio assets which are included under fair use for educational demonstration only. 

---

## 🎵 Feature 1: The Lehra Player (Indian Classical Practice)

The Lehra Player is a beautifully crafted distraction-free UI complete with real-time pitch shifting, tempo adjustments, and a practice tracker.

### How the Background Audio Engineering Works
Achieving high-fidelity audio manipulation in a web browser is incredibly challenging. To avoid robotic "buzzing" artifacts, Lehra Studio Web uses a **Hybrid Client-Server Audio Architecture**:

*   **Segment Slicing:** The Python backend calculates the exact timestamp (`start` and `end`) for the closest recorded tempo segment in the original track.
*   **Time-Stretching:** If the requested BPM isn't an exact match, `librosa` stretches the audio perfectly in time using PSOLA without changing its pitch.
*   **Pitch-Shifting:** It then shifts the audio to your target scale (e.g., C#) using a high-quality `kaiser_best` resampling algorithm.
*   **Zero-Drift Synchronization:** The frontend plays the pristine audio at `playbackRate=1.0`. To ensure the metronome and visualizers stay perfectly in sync over long practice sessions, we use a Web Audio lookahead `nextNoteTime` loop instead of a standard JavaScript `setInterval`.

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

---

## 🎨 Premium Aesthetics & Mobile Responsiveness
Both applications are built with a breathtaking, dark-mode premium aesthetic:
- **Cinzel Typography:** Indian-classical inspired serif typography mixed with clean modern sans-serifs.
- **Glassmorphism:** Frosted glass panels with subtle ambient animated backgrounds.
- **Fully Responsive:** The entire layout perfectly reflows and resizes paddings for mobile screens so it feels like a native app on iOS or Android.

---

## Getting Started

1. Install Python dependencies (requires `torch` and `demucs`):
   ```bash
   pip install flask librosa soundfile numpy demucs
   ```
2. Run the Next.js production build and copy to public (optional, if you're modifying frontend source code):
   ```bash
   cd stem-frontend
   npm install
   npm run build
   cp -r out/* ../public/separator/
   ```
3. Run the Python backend server:
   ```bash
   cd webapp
   python server.py
   ```
4. Open `http://localhost:3000` in your web browser.
