/**
 * Tanpura sounds for the Lehra engine's drone output.
 *
 *   classic  the recorded drone tanpura_06_01.wav (Pa–Sa–Sa–Sa, Sa = F3)
 *   male / female / auto
 *            a plucked tanpura built here, string by string, from single-
 *            pluck recordings, with the first string on Pa, Ma or Ni and a
 *            choice of pace.
 *
 * The string recordings (assets/tn{1,2}str{10,20,40}.wav, 44.1 kHz mono,
 * one pluck each, 10–22 s of ring) were measured by fitting the low
 * harmonics of each pluck:
 *   tn1 (male)    str20 Sa 138.55 Hz (C#3), str10 mandra Pa 104.03 Hz,
 *                 str40 kharaj Sa 69.47 Hz
 *   tn2 (female)  str20 Sa 207.88 Hz (G#3), str10 mandra Pa 154.85 Hz
 *                 (12 cents flat of a pure fifth), str40 kharaj Sa 103.89 Hz
 * There is no Ma or Ni recording: the first string is always resampled
 * from the Pa pluck to an exact just interval below Sa (Pa 3/4, Ma 2/3,
 * Ni 15/16), which also corrects the female set's flat Pa. The Sa and
 * kharaj strings are used as recorded.
 *
 * The loop is the steady state of the tanpura: every pluck's ring is summed
 * circularly into a loop of two cycles, so it repeats seamlessly with no
 * crossfade, and each pluck varies slightly in strength and timing.
 */
import { SincReader } from './engine.worklet.js';
import { buildTanpuraLoop, padLoop } from './engine.js';
import { audio } from './audio.js';
import { TANPURA_BASE_HZ, TANPURA_URL, on, state } from './state.js';

export const TANPURA_SETS = {
  male: {
    sa: 138.55,
    first: { url: '/assets/tn1str10.wav', hz: 104.03 },
    jodi: { url: '/assets/tn1str20.wav' },
    kharaj: { url: '/assets/tn1str40.wav' },
  },
  female: {
    sa: 207.88,
    first: { url: '/assets/tn2str10.wav', hz: 154.85 },
    jodi: { url: '/assets/tn2str20.wav' },
    kharaj: { url: '/assets/tn2str40.wav' },
  },
};

// First string, as a ratio of (middle) Sa
export const FIRST_STRING = { pa: 3 / 4, ma: 2 / 3, ni: 15 / 16 };

// Seconds between plucks. A cycle is first–Sa–Sa–kharaj, then a two-pluck
// rest while the kharaj rings: 5 units.
export const PACE_UNIT = { slow: 1.25, medium: 1.0, fast: 0.75 };
const PATTERN = [
  { string: 'first', at: 0, gain: 0.9 },
  { string: 'jodi', at: 1, gain: 0.8 },
  { string: 'jodi', at: 2, gain: 0.75 },
  { string: 'kharaj', at: 3, gain: 1.0 },
];
const UNITS_PER_CYCLE = 5;
const CYCLES_PER_LOOP = 2;
const MAX_RING_SEC = 16;       // longest part of a pluck used
const RING_FADE_SEC = 0.5;     // fade at the end of the used part
const TARGET_RMS = 0.085;      // about the loudness of the classic recording
const JITTER_SEC = 0.012;

/** Resample `pcm` by `ratio` (> 1 raises the pitch) with the engine's band-limited reader. */
export function resample(pcm, ratio) {
  if (Math.abs(ratio - 1) < 1e-6) return pcm;
  const reader = new SincReader();
  reader.setRatio(ratio);
  const pad = reader.halfTaps + 2;
  const src = new Float32Array(pcm.length + 2 * pad);
  src.set(pcm, pad);
  const out = new Float32Array(Math.floor((pcm.length - 1) / ratio));
  for (let i = 0; i < out.length; i++) out[i] = reader.read(src, pad + i * ratio);
  return out;
}

// Deterministic pseudo-random (mulberry32), so a given style always sounds the same.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The seamless loop of a plucked tanpura. `strings` = { first, jodi, kharaj }
 * (Float32Array plucks at `sr`, already in tune); `unit` = seconds between
 * plucks. Returns the loop's samples (two cycles).
 */
export function buildPluckedLoop(strings, sr, unit, seed = 1) {
  const cycle = Math.round(UNITS_PER_CYCLE * unit * sr);
  const len = cycle * CYCLES_PER_LOOP;
  const core = new Float32Array(len);
  const random = rng(seed);
  const maxRing = Math.round(MAX_RING_SEC * sr), fade = Math.round(RING_FADE_SEC * sr);
  for (let c = 0; c < CYCLES_PER_LOOP; c++) {
    for (const p of PATTERN) {
      const pluck = strings[p.string];
      const n = Math.min(pluck.length, maxRing);
      const gain = p.gain * (0.9 + 0.1 * random());
      const jitter = c === 0 && p.at === 0 ? 0 : Math.round((random() * 2 - 1) * JITTER_SEC * sr);
      const start = c * cycle + Math.round(p.at * unit * sr) + jitter;
      for (let i = 0; i < n; i++) {
        const tail = n - i < fade ? (n - i) / fade : 1;
        const k = ((start + i) % len + len) % len; // rings on across the loop point
        core[k] += pluck[i] * gain * tail;
      }
    }
  }
  let sum = 0, peak = 0;
  for (let i = 0; i < len; i++) { sum += core[i] * core[i]; peak = Math.max(peak, Math.abs(core[i])); }
  const g = Math.min(TARGET_RMS / Math.sqrt(sum / len || 1), 0.9 / (peak || 1));
  for (let i = 0; i < len; i++) core[i] *= g;
  return core;
}

/**
 * A plucked tanpura's loop, built from the string recordings:
 * { core, sr, sa } (core = seamless loop samples, sa = its Sa in Hz).
 * `decode(url)` resolves to an AudioBuffer (callers bring their own fetch
 * and cache: the Lehra engine, the Carnatic shruti box).
 */
export async function pluckedTanpura(decode, setName, first, pace) {
  const set = TANPURA_SETS[setName];
  const [f, j, k] = await Promise.all([decode(set.first.url), decode(set.jodi.url), decode(set.kharaj.url)]);
  const ch = a => a.getChannelData(0);
  const strings = {
    first: resample(ch(f), FIRST_STRING[first] * set.sa / set.first.hz),
    jodi: ch(j),
    kharaj: ch(k),
  };
  return { core: buildPluckedLoop(strings, j.sampleRate, PACE_UNIT[pace]), sr: j.sampleRate, sa: set.sa };
}

/** Which plucked set suits Sa `hz` (least resampling): 'male' below ~170 Hz. */
export function autoSet(hz) {
  const { male, female } = TANPURA_SETS;
  return Math.abs(Math.log(hz / male.sa)) <= Math.abs(Math.log(hz / female.sa)) ? 'male' : 'female';
}

// ── Style management ─────────────────────────────────────────────────
const cache = new Map(); // key → Promise<{ loop, sa }>
let applied = null;      // key of the drone the engine has
let request = 0;

function styleKey() {
  const style = $sel('tanpuraStyleSelect', 'classic');
  if (style === 'classic') return 'classic';
  const set = style === 'auto' ? autoSet(state.pitchHz) : style;
  return `${set}|${$sel('tanpuraFirstSelect', 'pa')}|${$sel('tanpuraPaceSelect', 'medium')}`;
}

function $sel(id, fallback) {
  const el = typeof document !== 'undefined' && document.getElementById(id);
  return (el && el.value) || fallback;
}

function build(key) {
  const engine = audio.engine;
  if (key === 'classic') {
    return engine.decode(TANPURA_URL).then(a => ({
      loop: buildTanpuraLoop(a.getChannelData(0), a.sampleRate, 64), sa: TANPURA_BASE_HZ,
    }));
  }
  const [setName, first, pace] = key.split('|');
  return pluckedTanpura(url => engine.decode(url), setName, first, pace)
    .then(({ core, sa }) => ({ loop: padLoop(core, 64), sa }));
}

/** Give the engine the selected tanpura (crossfades if it's playing). */
export function applyTanpura() {
  if (!audio.engine) return Promise.resolve();
  const key = styleKey();
  if (key === applied) return Promise.resolve();
  const id = ++request;
  if (!cache.has(key)) {
    const p = build(key);
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return cache.get(key).then(({ loop, sa }) => {
    if (id !== request) return; // superseded by a newer choice
    audio.engine.setTanpura(loop, TANPURA_BASE_HZ / sa);
    applied = key;
  }).catch(err => console.error('Tanpura load error:', err));
}

export function initTanpuraOptions() {
  const sync = () => {
    const custom = $sel('tanpuraStyleSelect', 'classic') !== 'classic';
    document.getElementById('tanpuraFirstSelect').disabled = !custom;
    document.getElementById('tanpuraPaceSelect').disabled = !custom;
    applyTanpura();
  };
  ['tanpuraStyleSelect', 'tanpuraFirstSelect', 'tanpuraPaceSelect'].forEach(id =>
    document.getElementById(id).addEventListener('change', sync));
  // 'auto' follows the Sa to the better-matching set
  on('settings', () => { if ($sel('tanpuraStyleSelect', 'classic') === 'auto') applyTanpura(); });
  sync();
}
