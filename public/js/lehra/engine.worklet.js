/**
 * Lehra Studio — real-time Lehra/Tanpura engine (AudioWorklet)
 * ─────────────────────────────────────────────────────────────
 * Web port of the Android app's native LehraAudioEngine behaviour
 * (LehraApp.startEngine / LehraAudioEngineWrapper.ProcessAudio): every raag
 * file is held fully decoded in memory, split into its per-tempo recordings,
 * and rendered block-by-block with tempo and pitch read live on every block.
 * Nothing is re-rendered on a server, so tempo/pitch changes are instant and
 * playback never restarts from sam.
 *
 * DSP, per rendered grain:
 *   pitch  – band-limited (Kaiser-windowed sinc) resampling at ratio `r`.
 *   tempo  – WSOLA: grains are placed on a musical clock that advances at
 *            bpm / segmentBpm, and each grain's exact source position is
 *            chosen (within ±SEEK) to best continue the previous grain.
 *   segment choice – the recorded tempo T minimising |log(r·T / bpm)|, so the
 *            residual stretch stays within ~±15% even after pitch shifting.
 *            Changing segment crossfades (equal-power) at the same position
 *            in the taal cycle.
 *
 * The main-thread controller (engine.js) prepares padded circular
 * segment buffers and transfers them here, so no heavy work ever happens on
 * the audio thread.
 */
// ── Tunables ──────────────────────────────────────────────────────────────
const SINC_ZERO_CROSSINGS = 8;   // interpolator half-width (input samples, at r <= 1)
const SINC_RESOLUTION = 512;     // table points per zero crossing
const SINC_BETA = 8.6;           // Kaiser window shape
const DEC = 4;                   // decimation factor for the coarse WSOLA search
const R_MAX = 2.0;               // max resample ratio the padding supports
const SWITCH_HYSTERESIS = 0.03;  // log-ratio margin before changing segment
const XFADE_SEC = 0.08;          // segment / raag switch crossfade
const START_FADE_SEC = 0.004;
const STOP_FADE_SEC = 0.04;
const TANPURA_FADE_SEC = 0.25;
const TANPURA_SWAP_SEC = 0.8;    // crossfade when the drone is replaced while playing
const REPORT_EVERY_BLOCKS = 8;
const MAX_BLOCK = 512;

function grainSizeFor(sr) {
  // ~45 ms grain (>= 3 periods of the lowest lehra fundamentals), power of two.
  return Math.pow(2, Math.round(Math.log2(0.045 * sr)));
}

function seekFor(sr) {
  // ±10 ms: more than half the longest pitch period we expect (~75 Hz).
  return Math.round(0.010 * sr);
}

// Padding (each side) around a circular segment buffer so every grain read
// and similarity search stays in-bounds without per-sample wrapping.
function segmentPadFor(sr) {
  const N = grainSizeFor(sr);
  const pad = Math.ceil(N * R_MAX) + 2 * N + seekFor(sr) + 4 * SINC_ZERO_CROSSINGS * R_MAX + 64;
  return Math.ceil(pad / DEC) * DEC;
}

function besselI0(x) {
  let sum = 1, term = 1;
  for (let k = 1; k < 50; k++) {
    term *= (x / (2 * k)) * (x / (2 * k));
    sum += term;
    if (term < 1e-12 * sum) break;
  }
  return sum;
}

let SINC_TABLE = null;
function sincTable() {
  if (SINC_TABLE) return SINC_TABLE;
  const n = SINC_ZERO_CROSSINGS * SINC_RESOLUTION + 2;
  const t = new Float32Array(n);
  const i0b = besselI0(SINC_BETA);
  for (let i = 0; i < n; i++) {
    const x = i / SINC_RESOLUTION;
    const s = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
    const u = x / SINC_ZERO_CROSSINGS;
    t[i] = u < 1 ? s * besselI0(SINC_BETA * Math.sqrt(1 - u * u)) / i0b : 0;
  }
  SINC_TABLE = t;
  return t;
}

/** Band-limited fractional-position reader; cut-off follows the read ratio. */
class SincReader {
  constructor() {
    this.table = sincTable();
    this.limit = SINC_ZERO_CROSSINGS * SINC_RESOLUTION;
    this.ratio = 0;
    this.setRatio(1);
  }
  setRatio(r) {
    if (r === this.ratio) return;
    this.ratio = r;
    // Reading faster than 1:1 decimates, so lower the cut-off to avoid aliasing.
    this.fc = r > 1 ? 0.97 / r : 1;
    this.halfTaps = Math.ceil(SINC_ZERO_CROSSINGS / this.fc);
    this.step = this.fc * SINC_RESOLUTION;
  }
  /** `buf` must hold halfTaps valid samples on either side of `pos`. */
  read(buf, pos) {
    const ip = Math.floor(pos);
    const frac = pos - ip;
    const tab = this.table, limit = this.limit, step = this.step, ht = this.halfTaps;
    let acc = 0;
    // Table coordinate is |k - frac| · fc · RESOLUTION.
    let x = (ht - 1 + frac) * step;           // k = -ht+1
    for (let k = -ht + 1; k <= 0; k++, x -= step) {
      if (x >= limit) continue;
      const xi = x | 0;
      acc += buf[ip + k] * (tab[xi] + (tab[xi + 1] - tab[xi]) * (x - xi));
    }
    x = (1 - frac) * step;                     // k = 1
    for (let k = 1; k <= ht; k++, x += step) {
      if (x >= limit) break;
      const xi = x | 0;
      acc += buf[ip + k] * (tab[xi] + (tab[xi + 1] - tab[xi]) * (x - xi));
    }
    return acc * this.fc;
  }
}

/** Fixed-capacity FIFO of finalized output samples. */
class SampleQueue {
  constructor(capacity) {
    this.buf = new Float32Array(capacity);
    this.head = 0;
    this.count = 0;
  }
  push(v) {
    const cap = this.buf.length;
    this.buf[(this.head + this.count) % cap] = v;
    this.count++;
  }
  shift() {
    const v = this.buf[this.head];
    this.head = (this.head + 1) % this.buf.length;
    this.count--;
    return v;
  }
}

/**
 * One WSOLA stream reading one recorded-tempo segment of one raag, with its
 * own position in the taal cycle. Several voices exist only while
 * crossfading between segments or raags.
 */
class Voice {
  constructor(dsp, raag, segIndex, phase) {
    this.dsp = dsp;
    this.raag = raag;
    this.segIndex = segIndex;
    this.seg = raag.segs[segIndex];
    this.phase = phase;
    this.ola = new Float32Array(dsp.N);
    this.queue = new SampleQueue(dsp.N * 4 + 2 * MAX_BLOCK);
    this.hasPrev = false;
    this.prevPos = 0;
    this.prevR = 1;
    // Crossfade state: t in [0,1], gain = sin(t·π/2)
    this.t = 1;
    this.dir = 0;
    this.delay = 0; // samples to hold before the fade starts moving
  }

  dPhase() {
    return this.dsp.bpm / (this.raag.beats * 60 * this.dsp.sr);
  }

  wrap(q) {
    const len = this.seg.len;
    return q - len * Math.floor(q / len);
  }

  /** Render the grain for the current phase; returns nothing, fills the queue. */
  generate(r, discard) {
    const dsp = this.dsp, seg = this.seg, len = seg.len;
    const N = dsp.N, Hs = dsp.Hs;
    const M = this.phase * len;
    let p = M;
    if (this.hasPrev) {
      const nat = this.prevPos + Hs * this.prevR; // natural continuation of the last grain
      let d = M - nat;
      d -= len * Math.round(d / len);             // nearest circular representative of M
      if (Math.abs(d) <= dsp.searchGuard) p = this.search(nat, nat + d, r);
    }
    p = this.wrap(p);

    const reader = dsp.reader;
    reader.setRatio(r);
    const buf = seg.buf, base = seg.pre + p, win = dsp.win, ola = this.ola;
    for (let j = 0; j < N; j++) ola[j] += reader.read(buf, base + j * r) * win[j];
    if (!discard) for (let j = 0; j < Hs; j++) this.queue.push(ola[j]);
    ola.copyWithin(0, Hs);
    ola.fill(0, N - Hs);
    this.prevPos = p;
    this.prevR = r;
  }

  advancePhase() {
    this.phase += this.dsp.Hs * this.dPhase();
    this.phase -= Math.floor(this.phase);
    this.hasPrev = true;
  }

  /**
   * WSOLA similarity search. `nat` is the natural-continuation position and
   * `center` the nominal (musical clock) position, in the same unwrapped
   * frame. Returns the chosen position in that frame, carrying nat's
   * fractional part so a unity-ratio run reconstructs the input exactly.
   */
  search(nat, center, r) {
    const dsp = this.dsp, seg = this.seg;
    const pre = seg.pre, buf = seg.buf, dec = seg.dec;
    const shift = this.wrap(center) - center;    // make `center` canonical
    const natS = nat + shift, cenS = center + shift;
    const L = Math.max(16, Math.round(dsp.Hs * r)); // overlap length, source samples
    const seek = dsp.seek;

    // Coarse pass on the decimated signal (sliding candidate energy).
    const Ld = Math.max(4, Math.round(L / DEC));
    const natD = Math.round((pre + natS) / DEC);
    const c0 = Math.round((pre + cenS - seek) / DEC);
    const c1 = Math.round((pre + cenS + seek) / DEC);
    let energy = 0;
    for (let i = 0; i < Ld; i++) { const v = dec[c0 + i]; energy += v * v; }
    let bestD = c0, bestScore = -Infinity;
    for (let c = c0; c <= c1; c++) {
      if (c > c0) {
        const o = dec[c - 1], n = dec[c + Ld - 1];
        energy += n * n - o * o;
      }
      let corr = 0;
      for (let i = 0; i < Ld; i++) corr += dec[natD + i] * dec[c + i];
      const score = corr / Math.sqrt(energy > 1e-12 ? energy : 1e-12);
      if (score > bestScore) { bestScore = score; bestD = c; }
    }

    // Fine pass at full rate around the coarse winner.
    const natI = Math.round(pre + natS);
    const fracN = (pre + natS) - natI;
    const lo = Math.max(bestD * DEC - DEC, Math.round(pre + cenS - seek));
    const hi = Math.min(bestD * DEC + DEC, Math.round(pre + cenS + seek));
    let bestI = lo, bestF = -Infinity;
    for (let c = lo; c <= hi; c++) {
      let corr = 0, e = 0;
      for (let i = 0; i < L; i++) {
        const b = buf[c + i];
        corr += buf[natI + i] * b;
        e += b * b;
      }
      const score = corr / Math.sqrt(e > 1e-12 ? e : 1e-12);
      if (score > bestF) { bestF = score; bestI = c; }
    }
    return (bestI + fracN) - pre - shift;
  }

  gain() {
    return Math.sin(this.t * Math.PI * 0.5);
  }

  advanceFade(step) {
    if (this.dir === 0) return;
    if (this.delay > 0) { this.delay--; return; }
    this.t += this.dir * step;
    if (this.t >= 1) { this.t = 1; this.dir = 0; }
    else if (this.t <= 0) { this.t = 0; }
  }

  get finished() {
    return this.dir < 0 && this.t <= 0;
  }
}

/**
 * Looping, resampled tanpura drone (plain varispeed is right for a drone).
 * `scale` converts the shared tanpura ratio to this loop's own Sa.
 */
class Tanpura {
  constructor(buf, loopLen, pre, scale = 1) {
    this.buf = buf;
    this.loopLen = loopLen;
    this.pre = pre;
    this.scale = scale;
    this.pos = 0;
    this.reader = new SincReader();
  }
  /** Adds into out[from..to) with per-sample gain gains[i]. */
  render(out, from, to, ratio, gains) {
    const reader = this.reader, buf = this.buf, len = this.loopLen, pre = this.pre;
    reader.setRatio(ratio);
    for (let i = from; i < to; i++) {
      const g = gains[i];
      if (g > 0) out[i] += reader.read(buf, pre + this.pos) * g;
      this.pos += ratio;
      if (this.pos >= len) this.pos -= len;
    }
  }
}

/**
 * The engine proper — independent of AudioWorkletProcessor so it can be
 * driven offline (tests) through exactly the same code path.
 */
class LehraDSP {
  constructor(sampleRate, post) {
    this.sr = sampleRate;
    this.post = post || (() => {});
    this.N = grainSizeFor(sampleRate);
    this.Hs = this.N / 2;
    this.seek = seekFor(sampleRate);
    this.searchGuard = 2 * this.N;
    this.win = new Float32Array(this.N);
    // Periodic Hann: overlap-adds to exactly 1 at 50% overlap.
    for (let j = 0; j < this.N; j++) this.win[j] = 0.5 - 0.5 * Math.cos(2 * Math.PI * j / this.N);
    this.reader = new SincReader();
    this.master = new Float32Array(MAX_BLOCK);
    this.tanGain = new Float32Array(MAX_BLOCK);
    this.swapIn = new Float32Array(MAX_BLOCK);
    this.swapOut = new Float32Array(MAX_BLOCK);

    this.raags = new Map();      // id → { id, beats, segs:[{bpm,len,pre,buf,dec}], dropped }
    this.current = null;         // raag whose clock drives the beat counter
    this.voices = [];
    this.tanpura = null;
    this.tanpuraOld = null;      // drone being crossfaded out after a swap
    this.swapT = 1;

    this.bpm = 90;
    this.pitch = 1;              // selected Sa / 146.83 Hz (the app's 1/pitchCoeff)
    this.tanpuraRatio = 1;
    this.loop = true;

    this.playing = false;
    this.started = false;
    this.startFrame = -1;        // context frame at which playback begins
    this.stopFade = -1;          // remaining samples of the stop fade (-1 = none)
    this.startFade = 0;
    this.startFadeLen = 1;
    this.tanpuraLevel = 0;       // 0..1 fade-in level of the drone

    this.phase = 0;              // current raag's cycle phase at the next grain boundary
    this.beatBase = 0;           // cumulative beat count at the current cycle's sam
    this.genFrame = 0;           // context frame of the next grain boundary
    this.anchor = null;
    this.blocks = 0;
    this.pendingReport = false;
    this.session = 0;
    this.seq = 0;                // last clock-changing message applied (echoed in reports)
  }

  static clampRatio(r) {
    return Math.min(R_MAX, Math.max(1 / R_MAX, r));
  }

  // ── Messages from the main thread ───────────────────────────────────────
  handle(msg) {
    switch (msg.type) {
      case 'raag':
        this.raags.set(msg.id, { id: msg.id, beats: msg.beats, tuning: msg.tuning || 1, segs: msg.segs, dropped: false });
        break;
      case 'drop': {
        const r = this.raags.get(msg.id);
        if (r) { r.dropped = true; this.collectRaags(); }
        break;
      }
      case 'tanpura': {
        const next = new Tanpura(msg.buf, msg.loopLen, msg.pre, msg.scale || 1);
        if (this.tanpura && this.playing && this.started) {
          this.tanpuraOld = this.tanpura; // crossfade instead of cutting
          this.swapT = 0;
        }
        this.tanpura = next;
        break;
      }
      case 'params': {
        const bpmChanged = msg.bpm !== undefined && msg.bpm !== this.bpm;
        this.applyParams(msg);
        if (msg.seq !== undefined) this.seq = msg.seq;
        // Grains up to genFrame were made at the old tempo; re-anchor there
        // so the reported clock is exact straight away.
        if (bpmChanged) this.reanchor();
        this.pendingReport = true;
        break;
      }
      case 'play':
        this.startPlayback(msg);
        break;
      case 'switch':
        if (msg.seq !== undefined) this.seq = msg.seq;
        this.switchRaag(msg.id, !!msg.resetPhase);
        break;
      case 'stop':
        if (this.playing && !this.started) this.playing = false; // nothing sounded yet (count-in)
        else if (this.playing && this.stopFade < 0) this.stopFade = Math.round(STOP_FADE_SEC * this.sr);
        break;
    }
  }

  applyParams(msg) {
    if (msg.bpm !== undefined) this.bpm = msg.bpm;
    if (msg.pitch !== undefined) this.pitch = msg.pitch;
    if (msg.tanpuraRatio !== undefined) this.tanpuraRatio = msg.tanpuraRatio; // clamped with each loop's scale
    if (msg.loop !== undefined) this.loop = msg.loop;
  }

  collectRaags() {
    for (const [id, r] of this.raags) {
      if (r.dropped && this.current !== r && !this.voices.some(v => v.raag === r)) this.raags.delete(id);
    }
  }

  startPlayback(msg) {
    const raag = this.raags.get(msg.id);
    if (!raag) { this.post({ type: 'error', message: 'raag not loaded' }); return; }
    this.applyParams(msg);
    this.session = msg.session;
    if (msg.seq !== undefined) this.seq = msg.seq;
    this.current = raag;
    this.voices = [];
    this.playing = true;
    this.started = false;
    this.stopFade = -1;
    this.startFrame = msg.startFrame;
    this.phase = 0;
    this.beatBase = 0;
    this.anchor = null;
    this.tanpuraLevel = 0;
    if (this.tanpura) this.tanpura.pos = 0;
    this.tanpuraOld = null;
  }

  /** Resample ratio for a raag: its recordings are pitched at 146.83 × tuning Hz. */
  ratioFor(raag) {
    return LehraDSP.clampRatio(this.pitch / raag.tuning);
  }

  bestSegment(raag) {
    const r = this.ratioFor(raag);
    let best = 0, bestScore = Infinity;
    for (let i = 0; i < raag.segs.length; i++) {
      const s = Math.abs(Math.log(r * raag.segs[i].bpm / this.bpm));
      if (s < bestScore) { bestScore = s; best = i; }
    }
    return { index: best, score: bestScore };
  }

  /** Latest voice that isn't fading out. */
  primary() {
    for (let i = this.voices.length - 1; i >= 0; i--) {
      if (this.voices[i].dir >= 0) return this.voices[i];
    }
    return null;
  }

  /** Create a voice aligned to the shared grain timeline. */
  spawnVoice(raag, segIndex, phase, fadeIn) {
    const v = new Voice(this, raag, segIndex, phase);
    // Prime with the grain one hop earlier (discarded) so the first real
    // output isn't a half-window ramp.
    const back = phase - this.Hs * v.dPhase();
    v.phase = back - Math.floor(back);
    v.generate(this.ratioFor(raag), true);
    v.phase = phase;
    v.hasPrev = true;
    // Line up with samples the other voices have already finalized.
    const ref = this.voices.length ? this.voices[0].queue.count : 0;
    for (let i = 0; i < ref; i++) v.queue.push(0);
    if (fadeIn) {
      v.t = 0; v.dir = 1; v.delay = ref;
      for (const o of this.voices) if (o.t > 0) o.dir = -1;
    }
    this.voices.push(v);
    return v;
  }

  switchRaag(id, resetPhase) {
    const raag = this.raags.get(id);
    if (!raag) return;
    if (!this.playing || !this.started) { this.current = raag; return; }
    if (resetPhase || raag.beats !== this.current.beats) {
      // Different taal: bring the new raag in on its pickup so it lands on sam
      // exactly as its crossfade completes. The cumulative beat count stays
      // monotonic, with the new sam on a whole number of new cycles.
      const cum = this.beatBase + this.phase * this.current.beats;
      const leadBeats = Math.min(XFADE_SEC * this.bpm / 60, raag.beats / 2);
      const sam = Math.ceil((cum + leadBeats) / raag.beats) * raag.beats;
      this.beatBase = sam - raag.beats;
      this.phase = 1 - leadBeats / raag.beats;
    }
    this.current = raag;
    this.spawnVoice(raag, this.bestSegment(raag).index, this.phase, true);
    this.reanchor();
    this.pendingReport = true;
  }

  /** Musical clock at the next grain boundary, with the current tempo. */
  reanchor() {
    if (!this.started || !this.current) return;
    this.anchor = {
      frame: this.genFrame,
      beat: this.beatBase + this.phase * this.current.beats,
      bpf: this.bpm / 60 / this.sr
    };
  }

  /** Advance the shared grain timeline by one hop. */
  step() {
    const raag = this.current;

    // Follow tempo/pitch to the best recording, with hysteresis, and never
    // start a new switch while one is still crossfading.
    const prim = this.primary();
    if (prim && prim.raag === raag && !this.voices.some(v => v.dir !== 0)) {
      const cur = Math.abs(Math.log(this.ratioFor(raag) * raag.segs[prim.segIndex].bpm / this.bpm));
      const best = this.bestSegment(raag);
      if (best.index !== prim.segIndex && best.score < cur - SWITCH_HYSTERESIS) {
        this.spawnVoice(raag, best.index, this.phase, true);
      }
    }

    for (const v of this.voices) {
      v.generate(this.ratioFor(v.raag), false);
      v.advancePhase();
    }

    // Musical clock of the current raag.
    const dp = this.bpm / (raag.beats * 60 * this.sr);
    this.anchor = { frame: this.genFrame, beat: this.beatBase + this.phase * raag.beats, bpf: dp * raag.beats };
    this.phase += this.Hs * dp;
    if (this.phase >= 1) {
      this.phase -= 1;
      this.beatBase += raag.beats;
    }
    this.genFrame += this.Hs;
  }

  /** The drone(s) into outT[from..n), crossfading from a replaced one. */
  renderTanpura(outT, from, n, tanGain) {
    const ratio = t => LehraDSP.clampRatio(this.tanpuraRatio * t.scale);
    const old = this.tanpuraOld;
    if (!old) {
      this.tanpura.render(outT, from, n, ratio(this.tanpura), tanGain);
      return;
    }
    const step = 1 / (TANPURA_SWAP_SEC * this.sr);
    for (let i = from; i < n; i++) {
      const a = Math.min(1, this.swapT) * Math.PI * 0.5;
      this.swapIn[i] = tanGain[i] * Math.sin(a);
      this.swapOut[i] = tanGain[i] * Math.cos(a);
      this.swapT += step;
    }
    old.render(outT, from, n, ratio(old), this.swapOut);
    this.tanpura.render(outT, from, n, ratio(this.tanpura), this.swapIn);
    if (this.swapT >= 1) this.tanpuraOld = null;
  }

  /** Render one block into the lehra (outL) and tanpura (outT) outputs. */
  render(outL, outT, n, blockFrame) {
    if (outL) outL.fill(0);
    if (outT) outT.fill(0);
    if (!this.playing || !this.current) return;

    let offset = 0;
    if (!this.started) {
      if (blockFrame + n <= this.startFrame) return;
      // Begin inside this block (or right away if the message arrived late).
      offset = Math.max(0, this.startFrame - blockFrame);
      this.started = true;
      this.startFrame = blockFrame + offset;
      this.genFrame = this.startFrame;
      this.voices = [];
      this.spawnVoice(this.current, this.bestSegment(this.current).index, 0, false);
      this.startFadeLen = this.startFade = Math.max(1, Math.round(START_FADE_SEC * this.sr));
      this.pendingReport = true;
    }

    const need = n - offset;
    while (this.voices.length && this.voices[0].queue.count < need) this.step();

    const xStep = 1 / (XFADE_SEC * this.sr);
    const tStep = 1 / (TANPURA_FADE_SEC * this.sr);
    const stopLen = Math.round(STOP_FADE_SEC * this.sr);
    const master = this.master, tanGain = this.tanGain;
    let ended = false;

    // Loop off: fade out so playback finishes exactly at the end of the cycle.
    let loopFadeAt = -1;
    if (!this.loop && this.stopFade < 0 && this.anchor) {
      const a = this.anchor;
      const beatNow = a.beat + (blockFrame + offset - a.frame) * a.bpf;
      const cycleEnd = (Math.floor(beatNow / this.current.beats + 1e-9) + 1) * this.current.beats;
      const framesLeft = (cycleEnd - beatNow) / a.bpf;
      if (framesLeft - stopLen < need) loopFadeAt = offset + Math.max(0, Math.floor(framesLeft - stopLen));
    }

    for (let i = 0; i < n; i++) {
      if (i < offset) { master[i] = 0; tanGain[i] = 0; continue; }
      if (i === loopFadeAt) this.stopFade = stopLen;
      let g = 1;
      if (this.startFade > 0) { g *= 1 - this.startFade / this.startFadeLen; this.startFade--; }
      if (this.stopFade >= 0) {
        g *= this.stopFade / stopLen;
        if (this.stopFade === 0) ended = true;
        else this.stopFade--;
      }
      if (ended) g = 0;
      master[i] = g;
      if (this.tanpuraLevel < 1) this.tanpuraLevel = Math.min(1, this.tanpuraLevel + tStep);
      tanGain[i] = g * Math.sin(this.tanpuraLevel * Math.PI * 0.5);

      let s = 0;
      for (let k = 0; k < this.voices.length; k++) {
        const v = this.voices[k];
        s += v.queue.shift() * v.gain();
        v.advanceFade(xStep);
      }
      if (outL) outL[i] = s * g;
    }

    if (this.tanpura && outT) this.renderTanpura(outT, offset, n, tanGain);

    if (this.voices.some(v => v.finished)) {
      this.voices = this.voices.filter(v => !v.finished);
      this.collectRaags();
    }

    if (++this.blocks % REPORT_EVERY_BLOCKS === 0 || this.pendingReport) {
      this.pendingReport = false;
      if (this.anchor) {
        const a = this.anchor;
        this.post({ type: 'pos', session: this.session, seq: this.seq, frame: a.frame, beat: a.beat, bpf: a.bpf, bpm: this.bpm, startFrame: this.startFrame });
      }
    }

    if (ended) {
      this.playing = false;
      this.started = false;
      this.voices = [];
      this.collectRaags();
      this.post({ type: 'ended', session: this.session });
    }
  }
}

// ── AudioWorklet registration (browser only) ─────────────────────────────
if (typeof registerProcessor === 'function') {
  class LehraEngineProcessor extends AudioWorkletProcessor {
    constructor() {
      super();
      this.dsp = new LehraDSP(sampleRate, m => this.port.postMessage(m));
      this.port.onmessage = e => this.dsp.handle(e.data);
      // Buffer geometry the main thread must use when preparing segments.
      this.port.postMessage({ type: 'config', pad: segmentPadFor(sampleRate), dec: DEC, grain: this.dsp.N });
    }
    process(inputs, outputs) {
      const l = outputs[0] && outputs[0][0];
      const t = outputs[1] && outputs[1][0];
      const n = (l || t) ? (l || t).length : 128;
      this.dsp.render(l, t, n, currentFrame);
      return true;
    }
  }
  registerProcessor('lehra-engine', LehraEngineProcessor);
}

export { LehraDSP, SincReader, grainSizeFor, seekFor, segmentPadFor, DEC };
