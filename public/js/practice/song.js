/** Helpers for practising along with a separated song. */

/** Add mono track `b` into `a` (either may be longer); returns the sum, reusing the longer array. */
export function addInto(a, b) {
  if (!a) return b;
  if (b.length > a.length) [a, b] = [b, a];
  for (let i = 0; i < b.length; i++) a[i] += b[i];
  return a;
}

/** An AudioBuffer as mono samples (channels averaged). */
export function toMono(buffer) {
  const n = buffer.numberOfChannels;
  if (n === 1) return buffer.getChannelData(0).slice();
  const out = new Float32Array(buffer.length);
  for (let c = 0; c < n; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < d.length; i++) out[i] += d[i] / n;
  }
  return out;
}

/** Semitones (−6…+5, the nearer way round) that move a song whose Sa is `songSa` Hz onto `mySa` Hz. */
export function shiftToSa(songSa, mySa) {
  const st = Math.round(12 * Math.log2(mySa / songSa));
  return ((st % 12) + 12 + 6) % 12 - 6;
}

/**
 * A–B loop: where to jump when the song is at `pos` (0–1) — back to A once
 * it reaches B — or null to keep playing. `ab` = { a, b }; b null = not set.
 */
export function abJump(pos, ab) {
  if (!ab || ab.b === null || ab.b === undefined) return null;
  return pos >= ab.b ? ab.a : null;
}

/** Set loop point A or B at `pos`; B must come at least `minGap` after A. Returns the new { a, b } or null if B is too early. */
export function setLoopPoint(ab, which, pos, minGap) {
  if (which === 'a') return { a: pos, b: ab && ab.b !== null && ab.b > pos + minGap ? ab.b : null };
  const a = ab ? ab.a : 0;
  return pos > a + minGap ? { a, b: pos } : null;
}

/** e.g. 61.6 → "1:01" */
export function formatTime(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
