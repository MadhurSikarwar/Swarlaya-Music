/**
 * Lehra player state and tuning constants.
 *
 * PITCH TABLE (UIMain.java pitchFreqs array):
 *   F#=92.5  G=98.0  G#=103.83  A=110.0  A#=116.54  B=123.47
 *   C=130.81  C#=138.59  D=146.83(base)  D#=155.56  E=164.81  F=174.61
 *   F#hi=185.0  Ghi=196.0
 */

// The pitch all recordings were made at (Sarangi: × its tuningCoeff)
export const BASE_HZ = 146.83; // D
// tanpura_06_01.wav is tuned Pa–Sa–Sa–Sa with Sa = F3 (its long-term
// spectrum peaks at 174.6 Hz with C3 as mandra Pa), not D.
export const TANPURA_BASE_HZ = 174.61;
export const TANPURA_URL = '/assets/tanpura_06_01.wav';

// Same span as the app: F# (low) − 100 cents … G (high) + 100 cents. The
// lehra and tanpura can both follow any pitch in this range.
export const FINE_TUNE_MIN_HZ = 87.31;
export const FINE_TUNE_MAX_HZ = 207.65;

export const state = {
  instrument: null,
  taal: null,
  taalData: null,
  raag: null,
  bpm: 90,
  isPlaying: false,
  isLooping: true,
  pitchHz: BASE_HZ,
  metronomeSubdivision: 1,
  playingTaal: null, // taal of the raag the engine is currently playing

  // Beat / Matra tracking
  beatIndex: 0,
  matraCount: 0,

  // Tap tempo
  tapTimes: [],

  // Options
  metronomeEnabled: false,
  metronomeSound: 'classic',
  // true = Sam/Taali loud, Khali softer (recommended for riyaz)
  // false = flat uniform click on every beat
  metronomeAccents: true,
  wakeLockEnabled: true,
  countInEnabled: false, // one cycle of metronome before the lehra starts
  countInBeats: 0,       // count-in beats of the current play (0 = none)

  // Riyaz
  riyazStart: 0,
};

// Tiny event bus between the Lehra modules:
//   'settings'  selection, tempo, pitch or loop changed (settings.js saves)
//   'playback'  'playing' | 'paused' | 'stopped' | 'ended' (player.js)
//   'matra'     (matra, total) the matra now sounding, 0 when stopped (scheduler.js)
const listeners = {};
export function on(event, fn) { (listeners[event] ||= []).push(fn); }
export function emit(event, ...args) { (listeners[event] || []).forEach(fn => fn(...args)); }

export function onSettingsChange(fn) { on('settings', fn); }
export function settingsChanged() { emit('settings'); }
