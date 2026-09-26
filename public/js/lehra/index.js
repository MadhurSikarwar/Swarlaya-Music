/**
 * Lehra player.
 *
 * AUDIO ARCHITECTURE (matching Android LehraApp / LehraAudioEngineWrapper):
 * The native Android app decodes every lehra file up front and runs a
 * real-time engine: the UI only updates a parameter array (playing, pitch,
 * bpm, volumes) that the engine reads on every audio block, so tempo and
 * pitch changes are instant and never restart the cycle.
 *
 * The web app does the same in an AudioWorklet (engine.worklet.js, driven by
 * engine.js): the raag's .aac is decoded once in the browser, split into its
 * per-tempo recordings, and rendered live with band-limited resampling
 * (pitch) + WSOLA (tempo). The metronome and beat display follow the
 * engine's own musical clock (scheduler.js).
 */
import { initControls } from './controls.js';
import { initLayaTrainer } from './laya.js';
import { initMixer } from './mixer.js';
import { stopPlayback } from './player.js';
import { initPracticeTimer } from './practice.js';
import { initRecorder, stopRecording } from './recorder.js';
import { checkpointRiyaz, initRiyazGoal } from './riyaz.js';
import { showMatraRow } from './scheduler.js';
import { renderInstruments } from './selection.js';
import { initSettings } from './settings.js';
import { initTanpuraOptions } from './tanpura.js';
import { state } from './state.js';
import { showPlay, setStatus } from './ui.js';
import { initWaveformCanvas } from './visuals.js';
import { requestWakeLock } from './wakelock.js';

export function initLehra() {
  renderInstruments();
  initMixer();
  initControls();
  initWaveformCanvas();
  initLayaTrainer();
  initPracticeTimer();
  initRiyazGoal();
  initTanpuraOptions();
  initRecorder();
  showPlay();
  showMatraRow(false);
  setStatus('Ready — select a raag to begin', '');
  // Last: restores the saved setup through the controls initialised above.
  initSettings();
  if (state.raag) setStatus('Ready — your last setup is restored', '');

  // Server-rendered lehra audio used to be cached here; the engine no longer
  // needs it, so free that storage.
  try { indexedDB.deleteDatabase('lehra-audio-cache'); } catch { /* unavailable */ }

  document.addEventListener('visibilitychange', () => {
    // The browser drops the wake lock whenever the page is hidden (or refused
    // it because it was hidden), so take it again on return.
    if (document.visibilityState === 'visible' && state.isPlaying) {
      requestWakeLock();
    } else if (document.visibilityState === 'hidden') {
      checkpointRiyaz(); // the tab may never come back (closed, killed on mobile)
    }
  });
  window.addEventListener('pagehide', () => checkpointRiyaz());
}

/** Stop the lehra (and any recording) when the user leaves its page. */
export function leaveLehra() {
  stopRecording();
  if (state.isPlaying) stopPlayback();
}
