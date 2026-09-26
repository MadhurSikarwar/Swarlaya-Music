/**
 * Nearest swar to a frequency, relative to Sa, and the tuner needle's
 * smoothing. Intonation is either just (5-limit ratios, as a tanpura's
 * drone implies) or 12-tone equal temperament (harmonium).
 */

// Just ratios of the 12 swar positions (komal Ni as 16/9)
const JUST = [1, 16 / 15, 9 / 8, 6 / 5, 5 / 4, 4 / 3, 45 / 32, 3 / 2, 8 / 5, 5 / 3, 16 / 9, 15 / 8];
const CENTS = {
  just: JUST.map(r => 1200 * Math.log2(r)),
  et: JUST.map((_, i) => 100 * i),
};

export const SWAR_NAMES = {
  // [name, qualifier]
  hindustani: [['Sa', ''], ['Re', 'komal'], ['Re', ''], ['Ga', 'komal'], ['Ga', ''], ['Ma', ''],
    ['Ma', 'tivra'], ['Pa', ''], ['Dha', 'komal'], ['Dha', ''], ['Ni', 'komal'], ['Ni', '']],
  carnatic: [['S', ''], ['R1', ''], ['R2', ''], ['G2', ''], ['G3', ''], ['M1', ''],
    ['M2', ''], ['P', ''], ['D1', ''], ['D2', ''], ['N2', ''], ['N3', '']],
};

/**
 * { index, name, qualifier, octave, cents } for `hz` with Sa at `sa` Hz:
 * octave −1 = mandra, 0 = madhya, 1 = taar; cents = deviation from the swar.
 */
export function nearestSwar(hz, sa, { intonation = 'just', system = 'hindustani' } = {}) {
  const c = 1200 * Math.log2(hz / sa);
  let octave = Math.floor(c / 1200);
  let within = c - octave * 1200;
  const table = CENTS[intonation] || CENTS.just;
  let index = 0, best = Infinity;
  for (let i = 0; i <= 12; i++) {
    const ref = i === 12 ? 1200 : table[i];
    if (Math.abs(within - ref) < Math.abs(best)) { best = within - ref; index = i; }
  }
  if (index === 12) { index = 0; octave++; } // just below the next Sa
  const [name, qualifier] = SWAR_NAMES[system][index];
  return { index, name, qualifier, octave, cents: best };
}

/**
 * A steady needle: the median of the last few estimates, eased towards
 * with a time constant, and held briefly through unvoiced gaps.
 */
export class NeedleSmoother {
  constructor({ median = 5, tau = 0.12, hold = 0.4 } = {}) {
    this.size = median;
    this.tau = tau;
    this.hold = hold;
    this.recent = [];
    this.value = null;   // displayed cents
    this.target = null;
    this.pending = null; // a jump waiting for a second estimate to confirm it
    this.lastVoiced = -Infinity;
  }
  /** A new estimate (cents) at time t (seconds); null = no pitch. */
  push(cents, t) {
    if (cents === null) return;
    if (this.target !== null && Math.abs(cents - this.target) > 60) {
      // A jump: a lone one is a glitch (e.g. an octave error); two in a row
      // are a new note, which restarts the median rather than smearing into it.
      if (this.pending === null || Math.abs(cents - this.pending) > 60) {
        this.pending = cents;
        return;
      }
      this.recent = [this.pending];
    }
    this.pending = null;
    this.recent.push(cents);
    if (this.recent.length > this.size) this.recent.shift();
    const sorted = [...this.recent].sort((a, b) => a - b);
    this.target = sorted[sorted.length >> 1];
    this.lastVoiced = t;
    if (this.value === null) this.value = this.target;
  }
  /** Advance the display to time t by dt seconds; returns the cents to show, or null. */
  step(t, dt) {
    if (this.target === null || t - this.lastVoiced > this.hold) {
      this.value = null;
      this.target = null;
      this.pending = null;
      this.recent = [];
      return null;
    }
    this.value += (this.target - this.value) * (1 - Math.exp(-dt / this.tau));
    return this.value;
  }
}
