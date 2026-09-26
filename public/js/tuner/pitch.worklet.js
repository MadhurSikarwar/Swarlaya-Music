/**
 * Microphone pitch detector (AudioWorklet): YIN (de Cheveigné & Kawahara,
 * 2002) on the input decimated 2× (the page low-passes it first), analysed
 * every ~21 ms over a ~43 ms window. Posts { hz, clarity, rms } — hz is 0
 * when there is no clear pitch. It has no outputs: the microphone is only
 * ever analysed, never played.
 */
const DECIMATE = 2;
const MIN_HZ = 60;
const MAX_HZ = 1100;
const WINDOW_SEC = 0.043;
const HOP_SEC = 0.021;
const SILENCE_RMS = 0.004;   // about −48 dBFS

/**
 * YIN pitch of `buf` (sample rate `sr`), searching minHz…maxHz. Uses the
 * last lag range that fits: window = buf.length − maxLag − 1. `scratch`
 * (optional, ≥ 2·(maxLag + 2) long) avoids allocating. Returns
 * { hz, clarity } or null.
 */
export function yin(buf, sr, { minHz = MIN_HZ, maxHz = MAX_HZ, threshold = 0.15, scratch } = {}) {
  const tauMin = Math.max(2, Math.floor(sr / maxHz));
  const tauMax = Math.min(Math.ceil(sr / minHz), Math.floor(buf.length / 2) - 1);
  const W = buf.length - tauMax - 1;
  if (tauMax <= tauMin + 2 || W < 16) return null;
  const n = tauMax + 2;
  const mem = scratch && scratch.length >= 2 * n ? scratch : new Float32Array(2 * n);
  const raw = mem.subarray(0, n);   // difference function d(τ)
  const d = mem.subarray(n, 2 * n); // cumulative-mean normalised d'(τ), d'(0) = 1

  d[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= tauMax + 1; tau++) {
    let s = 0;
    for (let j = 0; j < W; j++) {
      const v = buf[j] - buf[j + tau];
      s += v * v;
    }
    raw[tau] = s;
    running += s;
    d[tau] = running > 0 ? s * tau / running : 1;
  }

  // First dip below the threshold (then down to its minimum), else the best dip.
  let tau = -1;
  for (let t = tauMin; t <= tauMax; t++) {
    if (d[t] < threshold) {
      while (t + 1 <= tauMax && d[t + 1] < d[t]) t++;
      tau = t;
      break;
    }
  }
  if (tau < 0) {
    let best = tauMin;
    for (let t = tauMin + 1; t <= tauMax; t++) if (d[t] < d[best]) best = t;
    if (d[best] > 0.35) return null;
    tau = best;
  }

  // Parabolic interpolation of the dip, on the raw difference function
  const a = raw[tau - 1], b = raw[tau], c = raw[tau + 1];
  const den = a - 2 * b + c;
  const shift = den > 0 ? Math.max(-0.5, Math.min(0.5, 0.5 * (a - c) / den)) : 0;
  return { hz: sr / (tau + shift), clarity: Math.max(0, Math.min(1, 1 - d[tau])) };
}

if (typeof registerProcessor === 'function') {
  class PitchProcessor extends AudioWorkletProcessor {
    constructor() {
      super();
      this.sr = sampleRate / DECIMATE;
      const tauMax = Math.ceil(this.sr / MIN_HZ);
      this.size = Math.round(WINDOW_SEC * this.sr) + tauMax + 1;
      this.ring = new Float32Array(this.size);
      this.frame = new Float32Array(this.size);
      this.scratch = new Float32Array(2 * (tauMax + 2));
      this.write = 0;
      this.filled = 0;
      this.phase = 0;
      this.hop = Math.round(HOP_SEC * this.sr);
      this.sinceHop = 0;
    }
    process(inputs) {
      const x = inputs[0] && inputs[0][0];
      if (!x) return true;
      for (let i = this.phase; i < x.length; i += DECIMATE) {
        this.ring[this.write] = x[i];
        this.write = (this.write + 1) % this.size;
        if (this.filled < this.size) this.filled++;
        if (++this.sinceHop >= this.hop && this.filled === this.size) {
          this.sinceHop = 0;
          this.analyse();
        }
      }
      this.phase = (this.phase + x.length) % DECIMATE;
      return true;
    }
    analyse() {
      const f = this.frame, n = this.size;
      let sum = 0;
      for (let i = 0; i < n; i++) {
        const v = this.ring[(this.write + i) % n];
        f[i] = v;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / n);
      const r = rms < SILENCE_RMS ? null : yin(f, this.sr, { scratch: this.scratch });
      this.port.postMessage({ hz: r ? r.hz : 0, clarity: r ? r.clarity : 0, rms });
    }
  }
  registerProcessor('swar-pitch', PitchProcessor);
}
