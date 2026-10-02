/**
 * Offline pitch analysis of a whole recording — the tuner's YIN
 * (pitch.worklet.js) run frame by frame — for:
 *   intonationReport  how in tune your riyaz recording is against Sa
 *                     (lehra/recorder.js)
 *   estimateSa        a song's Sa from its separated vocals (practice/)
 *
 * Decode recordings at ANALYSIS_SR first (an OfflineAudioContext resamples
 * with a proper filter): plenty for a voice's pitch, and ~16× less work
 * than 44.1 kHz.
 */
import { yin } from './pitch.worklet.js';
import { nearestSwar } from './swar.js';

export const ANALYSIS_SR = 11025;

const HOP_SEC = 0.02;
const WINDOW_SEC = 0.045;
const MIN_HZ = 70;
const MAX_HZ = 900;
const SILENCE_RMS = 0.01;
const MIN_CLARITY = 0.8;

/** Frames of `x` (at `sr`) as [start, end) pairs, one per hop. */
function frames(length, sr) {
  const size = Math.round(WINDOW_SEC * sr) + Math.ceil(sr / MIN_HZ) + 1;
  const step = Math.round(HOP_SEC * sr);
  const out = [];
  for (let s = 0; s + size <= length; s += step) out.push(s);
  return { starts: out, size };
}

function analyseFrame(x, start, size, sr, scratch) {
  const f = x.subarray(start, start + size);
  let sum = 0;
  for (let i = 0; i < size; i++) sum += f[i] * f[i];
  const r = Math.sqrt(sum / size) < SILENCE_RMS ? null : yin(f, sr, { minHz: MIN_HZ, maxHz: MAX_HZ, scratch });
  return { t: (start + size / 2) / sr, hz: r ? r.hz : 0, clarity: r ? r.clarity : 0 };
}

/** The pitch every 20 ms: [{ t, hz, clarity }], hz 0 where there's no clear pitch. */
export function pitchTrack(x, sr) {
  const { starts, size } = frames(x.length, sr);
  const scratch = new Float32Array(2 * (Math.ceil(sr / MIN_HZ) + 2));
  return starts.map(s => analyseFrame(x, s, size, sr, scratch));
}

/** The same, a slice at a time, so the page stays responsive; `progress(0–1)`. */
export async function pitchTrackAsync(x, sr, progress = () => {}) {
  const { starts, size } = frames(x.length, sr);
  const scratch = new Float32Array(2 * (Math.ceil(sr / MIN_HZ) + 2));
  const out = [];
  for (let i = 0; i < starts.length; i++) {
    out.push(analyseFrame(x, starts[i], size, sr, scratch));
    if (i % 400 === 399) {
      progress(i / starts.length);
      await new Promise(r => setTimeout(r));
    }
  }
  return out;
}

const cents = (hz, ref) => 1200 * Math.log2(hz / ref);

/**
 * Held frames: voiced, clear, and within `steady` cents of both neighbours —
 * a note being sustained, not a glide between notes (meend and gamak are
 * meant to move, so they aren't judged).
 */
function heldFrames(track, steady) {
  const ok = p => p && p.hz > 0 && p.clarity >= MIN_CLARITY;
  return track.map((p, i) => ok(p) && ok(track[i - 1]) && ok(track[i + 1]) &&
    Math.abs(cents(p.hz, track[i - 1].hz)) <= steady && Math.abs(cents(p.hz, track[i + 1].hz)) <= steady);
}

/**
 * How in tune a recording is against Sa (`sa` Hz), in just intonation:
 * {
 *   voicedSec, heldSec,
 *   inTune        share of held time within ±tolerance cents of a swar (0–1),
 *   meanAbsCents  average distance of held notes from their swar,
 *   swaras        [{ index, name, qualifier, sec, meanCents }] most sung first,
 *   points        [{ t, cents, held, inTune }] — cents above Sa, for a graph
 * }
 */
export function intonationReport(track, sa, { tolerance = 20, steady = 20 } = {}) {
  const hop = track.length > 1 ? track[1].t - track[0].t : HOP_SEC;
  const held = heldFrames(track, steady);
  const bySwar = new Map();
  const points = [];
  let voiced = 0, heldCount = 0, inTune = 0, absSum = 0;
  track.forEach((p, i) => {
    if (!(p.hz > 0 && p.clarity >= MIN_CLARITY)) return;
    voiced++;
    const point = { t: p.t, cents: cents(p.hz, sa), held: held[i], inTune: false };
    if (held[i]) {
      const s = nearestSwar(p.hz, sa, { intonation: 'just' });
      heldCount++;
      absSum += Math.abs(s.cents);
      point.inTune = Math.abs(s.cents) <= tolerance;
      if (point.inTune) inTune++;
      const e = bySwar.get(s.index) || { index: s.index, name: s.name, qualifier: s.qualifier, n: 0, sum: 0 };
      e.n++;
      e.sum += s.cents;
      bySwar.set(s.index, e);
    }
    points.push(point);
  });
  const swaras = [...bySwar.values()]
    .sort((a, b) => b.n - a.n)
    .map(e => ({ index: e.index, name: e.name, qualifier: e.qualifier, sec: e.n * hop, meanCents: e.sum / e.n }));
  return {
    voicedSec: voiced * hop,
    heldSec: heldCount * hop,
    inTune: heldCount ? inTune / heldCount : 0,
    meanAbsCents: heldCount ? absSum / heldCount : 0,
    swaras,
    points,
  };
}

/**
 * A song's Sa from its vocals: the note of `notes` ([[name, hz], …] — twelve
 * semitones) whose Sa and Pa are held most, after allowing for the song's
 * overall tuning. Returns { index, tuningCents, confidence (0–1) } or null
 * if too little was sung.
 */
export function estimateSa(track, notes, { steady = 25, minHeldSec = 3 } = {}) {
  const ref = notes[0][1];
  const held = heldFrames(track, steady);
  const pcs = [];
  track.forEach((p, i) => { if (held[i]) pcs.push(((cents(p.hz, ref) % 1200) + 1200) % 1200); });
  const hop = track.length > 1 ? track[1].t - track[0].t : HOP_SEC;
  if (pcs.length * hop < minHeldSec) return null;

  // Overall tuning: the circular mean of every held note's offset from the nearest semitone
  let sx = 0, sy = 0;
  for (const c of pcs) {
    const a = (c % 100) / 100 * 2 * Math.PI;
    sx += Math.cos(a);
    sy += Math.sin(a);
  }
  let tuning = Math.atan2(sy, sx) / (2 * Math.PI) * 100;
  if (tuning > 50) tuning -= 100;

  // Time held on each semitone (±50 cents around it, after the tuning)
  const h = new Array(12).fill(0);
  for (const c of pcs) h[((Math.round((c - tuning) / 100) % 12) + 12) % 12]++;
  const scores = h.map((_, n) => h[n] + 0.5 * h[(n + 7) % 12]);
  const order = scores.map((s, n) => [s, n]).sort((a, b) => b[0] - a[0]);
  const [best, second] = order;
  return {
    index: best[1],
    tuningCents: tuning,
    confidence: best[0] > 0 ? Math.max(0, Math.min(1, (best[0] - second[0]) / best[0] * 2)) : 0,
  };
}
