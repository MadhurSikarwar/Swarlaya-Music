/**
 * Lining up a lehra recorded on its own with the tabla: the arithmetic behind
 * the sync editor (sync-editor.js). No browser APIs, so it is unit-tested
 * (tests/audiolab.test.js).
 *
 * Every time is in seconds on the tabla's timeline, the upload's own, which is
 * what the server works on. `offset` is where the lehra's 0 s falls on that
 * timeline. The server loops the lehra under the whole tabla, so an offset
 * only matters modulo the lehra's length (its `period`).
 */

/** x modulo m, always in [0, m). */
export function mod(x, m) {
  return ((x % m) + m) % m;
}

/** The lehra time heard at tabla time `t`. */
export function lehraTime(t, offset, period) {
  return mod(t - offset, period);
}

/** The same offset, moved by whole loops into (−period/2, period/2]. */
export function wrapOffset(offset, period) {
  if (!(period > 0) || !Number.isFinite(offset)) return offset;
  let o = mod(offset, period);
  if (o > period / 2) o -= period;
  return o;
}

/** The offset that puts the lehra's sam (lehra time) on the tabla's sam (tabla time). */
export function offsetForSams(tablaSam, lehraSam, period) {
  return wrapOffset(tablaSam - lehraSam, period);
}

/**
 * How far the nearest lehra sam is from the tabla's sam, in seconds (+ = the
 * lehra is late). The sams repeat every `cycle` (or every loop, if unknown).
 */
export function samGap(tablaSam, lehraSam, offset, cycle) {
  const d = offset + lehraSam - tablaSam;
  return cycle > 0 ? wrapOffset(d, cycle) : d;
}

/** Tabla times of every sam in [from, to): the lehra's sam, then every `cycle`. */
export function samTimes(offset, lehraSam, cycle, from, to) {
  if (!(cycle > 0) || !(to > from)) return [];
  const first = offset + lehraSam;
  const out = [];
  for (let k = Math.ceil((from - first) / cycle - 1e-9); ; k++) {
    const t = first + k * cycle;
    if (t >= to) break;
    if (out.length > 5000) break;
    out.push(t);
  }
  return out;
}

/**
 * The tempo and taal in a lehra's file name, as the Lehra Player names its
 * downloads ("lehra-Bhimpalasi-Sitar-Teentaal-180bpm-Sa-Csharp-1m32s.mp3").
 * `taals` is [{ name: 'Teentaal (16 beats)', beatsPerCycle: 16 }, …]. Those
 * exports start on sam. Null when the name says nothing usable.
 */
export function lehraFromName(fileName, taals) {
  const name = String(fileName || '');
  const tempo = /(\d+(?:\.\d+)?)\s*-?bpm/i.exec(name);
  if (!tempo) return null;
  const bpm = parseFloat(tempo[1]);
  if (!(bpm > 0)) return null;
  const clean = s => s.replace(/#/g, 'sharp').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
  const flat = `-${clean(name)}-`;
  let found = null;
  for (const t of [...taals].sort((a, b) => b.name.length - a.name.length)) {
    const base = clean(t.name.replace(/\s*\(.*\)\s*$/, ''));
    if (base && (flat.includes(`-${clean(t.name)}-`) || flat.includes(`-${base}-`))) { found = t; break; }
  }
  if (!found) {
    const beats = /(\d+)[- ]?beats?/i.exec(name);
    if (!beats) return { bpm, beats: null, cycle: null, taal: null };
    found = { name: null, beatsPerCycle: parseInt(beats[1], 10) };
  }
  const beats = found.beatsPerCycle;
  return { bpm, beats, cycle: beats * 60 / bpm, taal: found.name };
}

/**
 * Where the stroke near `t` starts: the sharpest rise in energy within
 * ±`radius` s (1 ms frames), then the first sample in it reaching a third of
 * the stroke's peak. A click a little off a stroke lands on it. Returns `t`
 * when nothing stands out (silence, or a steady sound).
 */
export function snapToOnset(data, sr, t, radius = 0.06) {
  const hop = Math.max(1, Math.round(sr / 1000));
  const win = 3 * hop;
  const lo = Math.max(0, Math.round((t - radius) * sr) - 4 * hop);
  const hi = Math.min(data.length - win, Math.round((t + radius) * sr));
  if (hi <= lo + 4 * hop) return t;
  const n = Math.floor((hi - lo) / hop);
  const energy = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    let s = 0;
    for (let i = lo + k * hop, end = i + win; i < end; i++) s += data[i] * data[i];
    energy[k] = s / win;
  }
  let best = -1, bestRise = 0, floor = Infinity;
  for (let k = 0; k < n; k++) floor = Math.min(floor, energy[k]);
  for (let k = 4; k < n; k++) {
    const before = Math.max(energy[k - 1], energy[k - 2], energy[k - 3], energy[k - 4]);
    const rise = energy[k] - before;
    const at = (lo + k * hop) / sr;
    if (Math.abs(at - t) > radius) continue;
    if (rise > bestRise) { bestRise = rise; best = k; }
  }
  if (best < 0 || bestRise < 4 * (floor + 1e-10)) return t;
  // the stroke's peak just after the rise, then its first sample above a third of it
  const a = lo + (best - 4) * hop;
  const b = Math.min(data.length, lo + best * hop + 10 * hop);
  let peak = 0;
  for (let i = a; i < b; i++) peak = Math.max(peak, Math.abs(data[i]));
  for (let i = a; i < b; i++) if (Math.abs(data[i]) >= peak / 3) return i / sr;
  return (lo + best * hop) / sr;
}

/** [min, max] of data[i0, i1), looking at no more than ~64 samples (enough for a waveform column). */
export function rangePeak(data, i0, i1) {
  const a = Math.max(0, Math.floor(i0)), b = Math.min(data.length, Math.max(a + 1, Math.floor(i1)));
  if (a >= data.length) return [0, 0];
  const stride = Math.max(1, Math.floor((b - a) / 64));
  let lo = 1, hi = -1;
  for (let i = a; i < b; i += stride) {
    const v = data[i];
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return lo > hi ? [0, 0] : [lo, hi];
}

/** 0.0456 → "+45.6 ms", −1.2 → "−1.200 s" */
export function formatShift(s) {
  if (!Number.isFinite(s)) return '';
  const sign = s < 0 ? '−' : '+';
  const a = Math.abs(s);
  return a < 1 ? `${sign}${(a * 1000).toFixed(1)} ms` : `${sign}${a.toFixed(3)} s`;
}

/** The loudest sample of a mix, for keeping a rendered mix from clipping. */
export function peakOf(channels) {
  let p = 0;
  for (const ch of channels) for (let i = 0; i < ch.length; i++) { const v = Math.abs(ch[i]); if (v > p) p = v; }
  return p;
}
