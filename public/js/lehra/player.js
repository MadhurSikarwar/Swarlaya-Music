/**
 * Lehra playback: start/pause/stop, raag switching, and live tempo/pitch.
 *
 * Like the Android app (LehraApp.UpdateParameters), every control only
 * updates parameters the real-time engine reads on its next block; nothing
 * is re-rendered and the cycle never restarts from sam.
 */
import { $ } from '../core/dom.js';
import { startMediaOutput, stopMediaOutput } from '../core/audio-output.js';
import { clearMediaSession, setMediaPlaybackState, showMediaSession } from '../core/media-session.js';
import { audio, ensureAudio } from './audio.js';
import { CATALOGUE } from './catalogue.js';
import { loadMetronomeSounds } from './metronome.js';
import { processRiyazSession } from './riyaz.js';
import { schedulerTick, startScheduler, stopScheduler, resyncScheduler, updateMatraDisplay, showMatraRow } from './scheduler.js';
import { BASE_HZ, TANPURA_BASE_HZ, emit, settingsChanged, state } from './state.js';
import { applyTanpura } from './tanpura.js';
import { showPlay, showPause, setStatus, setBadge } from './ui.js';
import { startVisualizer, startWaveform, clearWaveform } from './visuals.js';
import { requestWakeLock, releaseWakeLock } from './wakelock.js';

let isLoading = false;
let fetchId = 0;       // bumped to abandon an in-flight load
let hooked = false;

// Lock-screen / headphone controls while the lehra owns the media session.
const MEDIA_ACTIONS = {
  play: () => { if (!state.isPlaying) togglePlay(); },
  pause: () => pausePlayback(),
  stop: () => stopPlayback(),
};

function mediaInfo() {
  const taal = (state.taal || '').replace(/\s*\(.*\)$/, '');
  return { title: state.raag || 'Lehra', artist: [state.instrument, taal].filter(Boolean).join(' · '), album: 'Swaralaya Lehra' };
}

// The first time, the media element needs a moment to start; don't let it
// clip the opening sam.
const MEDIA_START_WAIT_MS = 800;

/**
 * Audio graph + engine, with this module's engine callbacks attached.
 * `resume: false` for background work (preloading) that must not wait for
 * the user gesture a suspended context needs.
 */
async function ensureEngine(opts) {
  await ensureAudio(opts);
  loadMetronomeSounds();
  applyTanpura();
  if (!hooked) {
    hooked = true;
    audio.engine.onEnded = () => {
      // Loop switched off: the engine stopped at the end of the cycle.
      if (!state.isPlaying) return;
      state.isPlaying = false;
      processRiyazSession();
      state.playingTaal = null;
      releaseWakeLock();
      setMediaPlaybackState('paused');
      onStopped();
      emit('playback', 'ended');
    };
    // After a taal change the new sam is ~80 ms away: schedule it right away.
    audio.engine.onClock = () => schedulerTick();
  }
}

// ── Pitch ──────────────────────────────────────────────────────────
// NOTE on TuningCoeff (matches Android LehraApp / LehraAudioEngineWrapper):
// each instrument's recordings were made at 146.83 × tuningCoeff Hz (the
// Sarangi files are in D#, the rest in D). Like the app, the pitch is one
// global parameter and the tuning coefficient travels with each raag.
function lehraPitch() {
  return state.pitchHz / BASE_HZ;
}

function instrumentTuning() {
  return CATALOGUE[state.instrument]?.tuningCoeff ?? 1.0;
}

function tanpuraPitchRatio() {
  return state.pitchHz / TANPURA_BASE_HZ;
}

/** Apply state.pitchHz live — no reload, no restart. */
export function applyPitchChange() {
  if (audio.engine) {
    audio.engine.setParams({ pitch: lehraPitch(), tanpuraRatio: tanpuraPitchRatio() });
  }
  settingsChanged();
}

// ── Tempo / loop ───────────────────────────────────────────────────
// The engine picks the new tempo up on its next grain (~20 ms), keeps its
// place in the taal cycle and moves to a better-matching recording on its own.
export function applyTempoChange() {
  settingsChanged();
  if (!audio.engine) return;
  audio.engine.setParams({ bpm: state.bpm });
  if (state.isPlaying) setStatus(playingStatus(), 'playing');
}

/** Loop off = finish the current cycle and stop at sam. */
export function setLooping(on) {
  state.isLooping = on;
  if (audio.engine) audio.engine.setParams({ loop: on });
  settingsChanged();
}

// ── Playback ───────────────────────────────────────────────────────
function currentRaagFile() {
  return CATALOGUE[state.instrument]?.taals[state.taal]?.raags[state.raag]?.file || null;
}

function playingStatus() {
  return `Playing: ${state.raag} · ${state.instrument} · ${state.bpm} BPM`;
}

async function loadAndPlay(mediaReady = Promise.resolve()) {
  if (!state.raag || !state.taalData) {
    setStatus('Select instrument → taal → raag first', '');
    return;
  }
  const file = currentRaagFile();
  if (!file) { setStatus('Could not resolve audio path', ''); return; }
  const taal = state.taalData;

  isLoading = true;
  const currentFetchId = ++fetchId;

  try {
    await ensureEngine();
    const engine = audio.engine;
    if (!engine.isRaagLoaded(file, taal)) {
      setStatus('Loading audio…', 'loading');
      setBadge('Loading…', true);
    }
    const id = await engine.loadRaag(file, taal, instrumentTuning());
    if (currentFetchId !== fetchId) return; // request overridden
    const countIn = state.countInEnabled;
    const wait = [mediaReady, applyTanpura()];
    if (countIn) wait.push(loadMetronomeSounds()); // the count-in's first click
    await Promise.race([Promise.all(wait), new Promise(r => setTimeout(r, MEDIA_START_WAIT_MS))]);
    if (currentFetchId !== fetchId) return;

    // Count-in: one cycle of metronome, then the lehra enters on sam.
    const delay = countIn ? taal.beats * 60 / state.bpm : 0;
    state.countInBeats = countIn ? taal.beats : 0;
    const samTime = engine.play(id, {
      bpm: state.bpm,
      pitch: lehraPitch(),
      tanpuraRatio: tanpuraPitchRatio(),
      loop: state.isLooping,
      delay
    });
    state.playingTaal = taal;

    state.isPlaying = true;
    showPause();
    startWaveform();
    startScheduler();
    schedulerTick(); // the first click is at most 40 ms away: don't wait for the timer
    $('nowPlayingCard').classList.add('playing');
    requestWakeLock();
    state.riyazStart = Date.now() + delay * 1000; // riyaz counts from sam
    if (countIn) {
      setStatus(`Count-in: the lehra starts on sam (${taal.beats} beats)`, 'playing');
      const session = fetchId;
      setTimeout(() => {
        if (state.isPlaying && session === fetchId) setStatus(playingStatus(), 'playing');
      }, Math.max(0, (samTime - audio.ctx.currentTime) * 1000));
    } else {
      setStatus(playingStatus(), 'playing');
    }
    setBadge('Playing', false);
    $('infoDot').className = 'info-dot playing';
    startVisualizer();
    showMatraRow(true);
    showMediaSession(mediaInfo(), MEDIA_ACTIONS);
    emit('playback', 'playing');

  } catch (err) {
    if (currentFetchId !== fetchId) return; // Ignore errors from overridden requests
    console.error('Audio load error:', err);
    setStatus('Audio error: ' + err.message, '');
    setBadge('Error', false);
    state.isPlaying = false;
    showPlay();
  } finally {
    if (currentFetchId === fetchId) isLoading = false;
  }
}

/**
 * Raag picked while playing: crossfade to it like the app does, keeping the
 * position in the cycle when the taal is unchanged (sam otherwise).
 */
export async function switchPlayingRaag() {
  const file = currentRaagFile();
  const taal = state.taalData;
  if (!file || !taal || !audio.engine) return;
  const currentFetchId = ++fetchId;
  try {
    if (!audio.engine.isRaagLoaded(file, taal)) setStatus('Loading audio…', 'loading');
    const id = await audio.engine.loadRaag(file, taal, instrumentTuning());
    if (currentFetchId !== fetchId || !state.isPlaying) return;
    const resetPhase = !state.playingTaal || state.playingTaal.beats !== taal.beats;
    audio.engine.setParams({ bpm: state.bpm });
    audio.engine.switchRaag(id, resetPhase);
    state.playingTaal = taal;
    if (resetPhase) resyncScheduler();
    setStatus(playingStatus(), 'playing');
    showMediaSession(mediaInfo(), MEDIA_ACTIONS);
  } catch (err) {
    if (currentFetchId !== fetchId) return;
    console.error('Audio load error:', err);
    setStatus('Audio error: ' + err.message, '');
  }
}

/** Decode the selected raag in the background so pressing play starts instantly. */
export function preloadSelectedRaag() {
  const file = currentRaagFile(), taal = state.taalData, tuning = instrumentTuning();
  if (!file || !taal) return;
  ensureEngine({ resume: false })
    .then(() => audio.engine.loadRaag(file, taal, tuning))
    .catch(err => console.warn('Preload failed:', err));
}

export function pausePlayback() {
  if (!state.isPlaying) return;
  state.isPlaying = false;
  processRiyazSession();
  if (audio.engine) audio.engine.stop();
  state.playingTaal = null;
  showPlay();
  stopScheduler();
  $('nowPlayingCard').classList.remove('playing');
  releaseWakeLock();
  $('infoDot').className = 'info-dot';
  setStatus('Paused', '');
  setMediaPlaybackState('paused');
  emit('playback', 'paused');
}

export function stopPlayback() {
  state.isPlaying = false;
  processRiyazSession();
  if (audio.engine) audio.engine.stop();
  state.playingTaal = null;
  state.beatIndex = 0;
  showPlay();
  stopScheduler();
  clearWaveform();
  $('nowPlayingCard').classList.remove('playing');
  releaseWakeLock();
  $('infoDot').className = 'info-dot';
  setStatus('Stopped', '');
  setBadge('Web Player', false);
  updateMatraDisplay(0, state.taalData?.beats || 0);
  clearMediaSession(MEDIA_ACTIONS);
  stopMediaOutput();
  emit('playback', 'stopped');
}

function onStopped() {
  stopScheduler();
  clearWaveform();
  showPlay();
  $('nowPlayingCard').classList.remove('playing');
  $('infoDot').className = 'info-dot';
  setStatus('Ready', '');
}

export async function togglePlay() {
  if (isLoading) {
    fetchId++; // abandon the pending load
    isLoading = false;
    showPlay();
    setStatus('Ready', '');
    return;
  }
  if (state.isPlaying) {
    pausePlayback();
  } else {
    // Started here, inside the user's gesture: browsers only let a gesture start media.
    await loadAndPlay(startMediaOutput());
  }
}
