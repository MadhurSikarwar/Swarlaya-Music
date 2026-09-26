/**
 * Lehra Studio — main-thread controller for the real-time Lehra engine.
 *
 * Owns loading/decoding of the raag and tanpura assets, prepares the padded
 * circular per-tempo segment buffers the AudioWorklet (engine.worklet.js)
 * renders from, and exposes the engine's musical clock so the metronome and
 * beat display follow what is actually being played.
 *
 * FILE LAYOUT (matches the Android app's data.plist): each raag .aac holds one
 * recorded taal cycle per preset tempo, back to back, in `taal.tempos` order;
 * the cycle at tempo T lasts beats × 60 / T seconds.
 */

// The lehra .aac files were encoded with 1640 samples (@44.1 kHz) of AAC
// encoder delay ("priming") before the first recorded cycle. Chrome's and
// ffmpeg's decoders both keep those samples, so every segment boundary must
// be offset by them — measured from the recordings' loop seams and beat
// onsets across all 55 files (median 1640, spread ±50).
export const AAC_PRIMING_44K = 1640;
const AAC_FRAME = 1024;

const SEAM_XFADE_SEC = 0.025;
const TANPURA_LOOP_XFADE_SEC = 0.3;
const MAX_LOADED_RAAGS = 3;

/** Count ADTS frames so we know how many samples a priming-preserving decoder yields. */
export function countAdtsFrames(bytes) {
  const b = new Uint8Array(bytes);
  let i = 0, frames = 0;
  // Skip an ID3v2 tag if present.
  if (b.length > 10 && b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) {
    i = 10 + ((b[6] & 0x7f) << 21 | (b[7] & 0x7f) << 14 | (b[8] & 0x7f) << 7 | (b[9] & 0x7f));
  }
  while (i + 7 <= b.length) {
    if (b[i] !== 0xff || (b[i + 1] & 0xf6) !== 0xf0) return 0; // not plain ADTS
    const len = ((b[i + 3] & 0x03) << 11) | (b[i + 4] << 3) | (b[i + 5] >> 5);
    if (len < 7) return 0;
    frames += (b[i + 6] & 0x03) + 1;
    i += len;
  }
  return frames;
}

/**
 * Where the first recorded cycle starts in the decoded buffer, in samples at
 * the buffer's rate. Decoders that strip (some of) the priming shorten the
 * buffer by exactly that much, so compare against the full frame count.
 */
export function primingOffset(decodedLength, sampleRate, adtsFrames) {
  let trimmed = 0;
  if (adtsFrames > 0) {
    const decoded44 = decodedLength * 44100 / sampleRate;
    trimmed = adtsFrames * AAC_FRAME - decoded44;
    if (trimmed < 0 || trimmed > 3 * AAC_FRAME) trimmed = 0; // unexpected: assume untouched
  }
  return (AAC_PRIMING_44K - trimmed) * sampleRate / 44100;
}

/**
 * Make a recorded cycle loop seamlessly. The file is continuous across its
 * segment joins, but a cycle's own end rarely matches its own sam at the
 * waveform level (a tick on every return to sam). So crossfade the cycle's
 * last X samples into the audio that really precedes this sam in the file;
 * the loop's final sample then flows straight into its first.
 *
 * `have` is how many samples of the cycle the file actually holds: the last
 * cycle can stop a few ms short, and anything past `have` is taken from that
 * same preceding audio. The first cycle has only encoder priming before it,
 * so it instead blends the audio that follows its end into its head.
 */
function bakeLoopSeam(core, pcm, start, len, have, X, isFirst) {
  if (X <= 0 || have < 2 * X) return;
  // core[j] fades towards pcm[start - len + j]: that sample precedes sam by
  // exactly (len - j), so core[len - 1] becomes pcm[start - 1].
  if (!isFirst && start - len + have - X >= 0) {
    const x0 = have - X;
    for (let j = x0; j < have; j++) {
      const a = (j - x0 + 0.5) / X * Math.PI * 0.5;
      core[j] = core[j] * Math.cos(a) + pcm[start - len + j] * Math.sin(a);
    }
    for (let j = have; j < len; j++) core[j] = pcm[start - len + j];
  } else if (have === len && start + len + X <= pcm.length) {
    for (let i = 0; i < X; i++) {
      const a = (i + 0.5) / X * Math.PI * 0.5;
      core[i] = pcm[start + len + i] * Math.cos(a) + core[i] * Math.sin(a);
    }
  }
}

/**
 * Split decoded PCM into padded circular per-tempo loop buffers (plus a
 * decimated copy for the engine's coarse similarity search).
 */
export function buildSegments(pcm, sr, taal, offset, pad, dec) {
  const segs = [];
  let t = offset;
  for (const bpm of taal.tempos) {
    const exact = taal.beats * 60 / bpm * sr;
    // A decoder that stripped more than the priming would put the first
    // cycle's sam before sample 0; start that one cycle at 0 instead.
    const start = Math.max(0, Math.round(t));
    const len = Math.round(exact);
    t += exact;

    const buf = new Float32Array(pad + len + pad);
    const core = buf.subarray(pad, pad + len);
    const to = Math.min(pcm.length, start + len);
    if (to > start) core.set(pcm.subarray(start, to));
    bakeLoopSeam(core, pcm, start, len, Math.max(0, to - start), Math.round(SEAM_XFADE_SEC * sr), segs.length === 0);
    // Circular padding on both sides.
    for (let i = 0; i < pad; i++) {
      buf[i] = core[((i - pad) % len + len) % len];
      buf[pad + len + i] = core[i % len];
    }
    const d = new Float32Array(Math.floor(buf.length / dec));
    for (let i = 0; i < d.length; i++) {
      let s = 0;
      for (let j = 0; j < dec; j++) s += buf[i * dec + j];
      d[i] = s / dec;
    }
    segs.push({ bpm, len, pre: pad, buf, dec: d });
  }
  return segs;
}

/** A seamless loop `core` with `pad` samples of circular padding each side (the worklet's drone format). */
export function padLoop(core, pad) {
  const loopLen = core.length;
  const buf = new Float32Array(pad + loopLen + pad);
  buf.set(core, pad);
  for (let i = 0; i < pad; i++) {
    buf[i] = core[((i - pad) % loopLen + loopLen) % loopLen];
    buf[pad + loopLen + i] = core[i % loopLen];
  }
  return { buf, loopLen, pre: pad };
}

/** Seamless drone loop: bake an equal-power crossfade of the tail into the head. */
export function buildTanpuraLoop(pcm, sr, pad) {
  const X = Math.min(Math.round(TANPURA_LOOP_XFADE_SEC * sr), Math.floor(pcm.length / 3));
  const loopLen = pcm.length - X;
  const core = pcm.slice(0, loopLen);
  for (let j = 0; j < X; j++) {
    const a = (j / X) * Math.PI * 0.5;
    core[j] = pcm[j] * Math.sin(a) + pcm[loopLen + j] * Math.cos(a);
  }
  return padLoop(core, pad);
}

export class LehraEngine {
  constructor(ctx) {
    this.ctx = ctx;
    this.node = null;
    this.config = null;
    this.anchor = null;         // { frame, beat, bpf } — engine's musical clock
    this.playing = false;
    this.session = 0;
    this.seq = 0;               // bumped on every clock change; reports must echo it
    this.onEnded = null;
    this.onClock = null;        // called when the clock resumes after a cycle restart
    this.bytesCache = new Map(); // url → Promise<ArrayBuffer> (compressed)
    this.raagLoads = new Map();  // raag id → Promise<id>
    this.loadedRaags = [];       // ids resident in the worklet (LRU order)
  }

  async init(lehraDest, tanpuraDest) {
    if (this.node) return;
    if (!this.ctx.audioWorklet) throw new Error('This browser does not support AudioWorklet');
    await this.ctx.audioWorklet.addModule(new URL('./engine.worklet.js', import.meta.url));
    const configReady = new Promise(resolve => { this._resolveConfig = resolve; });
    this.node = new AudioWorkletNode(this.ctx, 'lehra-engine', {
      numberOfInputs: 0,
      numberOfOutputs: 2,
      outputChannelCount: [1, 1]
    });
    this.node.port.onmessage = e => this._onMessage(e.data);
    this.node.connect(lehraDest, 0);
    this.node.connect(tanpuraDest, 1);
    this.config = await configReady;
  }

  _onMessage(m) {
    switch (m.type) {
      case 'config':
        if (this._resolveConfig) this._resolveConfig(m);
        break;
      case 'pos':
        // Ignore reports sent before the audio thread saw our latest change.
        if (this.playing && m.session === this.session && m.seq === this.seq) {
          const resumed = !this.anchor;
          this.anchor = { frame: m.frame, beat: m.beat, bpf: m.bpf };
          if (resumed && this.onClock) this.onClock();
        }
        break;
      case 'ended':
        if (m.session === this.session && this.playing) {
          this.playing = false;
          this.anchor = null;
          if (this.onEnded) this.onEnded();
        }
        break;
      case 'error':
        console.error('Lehra engine:', m.message);
        break;
    }
  }

  _fetchBytes(url) {
    if (!this.bytesCache.has(url)) {
      const p = fetch(url).then(res => {
        if (!res.ok) throw new Error(`${res.status} ${res.statusText} (${url})`);
        return res.arrayBuffer();
      });
      p.catch(() => this.bytesCache.delete(url));
      this.bytesCache.set(url, p);
    }
    return this.bytesCache.get(url);
  }

  static raagId(file, taal) {
    return `${file}|${taal.beats}|${taal.tempos.join(',')}`;
  }

  isRaagLoaded(file, taal) {
    return this.loadedRaags.includes(LehraEngine.raagId(file, taal));
  }

  /**
   * Fetch, decode and hand a raag to the worklet. `tuning` is the
   * instrument's TuningCoeff (its recordings are at 146.83 × tuning Hz).
   * Resolves to the raag's id.
   */
  loadRaag(file, taal, tuning = 1) {
    const id = LehraEngine.raagId(file, taal);
    if (this.loadedRaags.includes(id)) {
      this._touch(id);
      return Promise.resolve(id);
    }
    if (this.raagLoads.has(id)) return this.raagLoads.get(id);

    const p = (async () => {
      const bytes = await this._fetchBytes(`/assets/${encodeURIComponent(file)}.aac`);
      const frames = countAdtsFrames(bytes);
      const audio = await this.ctx.decodeAudioData(bytes.slice(0));
      const sr = audio.sampleRate;
      const pcm = audio.getChannelData(0);
      const offset = primingOffset(audio.length, sr, frames);
      const segs = buildSegments(pcm, sr, taal, offset, this.config.pad, this.config.dec);
      const transfer = [];
      for (const s of segs) transfer.push(s.buf.buffer, s.dec.buffer);
      this.node.port.postMessage({ type: 'raag', id, beats: taal.beats, tuning, segs }, transfer);
      this.loadedRaags.push(id);
      this._evict();
      return id;
    })();
    this.raagLoads.set(id, p);
    p.then(() => this.raagLoads.delete(id), () => this.raagLoads.delete(id));
    return p;
  }

  _touch(id) {
    const i = this.loadedRaags.indexOf(id);
    if (i >= 0) { this.loadedRaags.splice(i, 1); this.loadedRaags.push(id); }
  }

  _evict() {
    // The worklet keeps a dropped raag until its voices have faded out.
    while (this.loadedRaags.length > MAX_LOADED_RAAGS) {
      const id = this.loadedRaags.shift();
      this.node.port.postMessage({ type: 'drop', id });
    }
  }

  /** Fetch and decode an asset (compressed bytes are cached). */
  async decode(url) {
    const bytes = await this._fetchBytes(url);
    return this.ctx.decodeAudioData(bytes.slice(0));
  }

  /**
   * Hand the worklet a drone loop ({ buf, loopLen, pre }, see padLoop); it
   * crossfades from the current one while playing. The drone is played at
   * tanpuraRatio × `scale` (scale = reference Sa / this loop's Sa).
   */
  setTanpura(loop, scale = 1) {
    const buf = loop.buf.slice(); // the caller keeps its copy
    this.node.port.postMessage({ type: 'tanpura', buf, loopLen: loop.loopLen, pre: loop.pre, scale }, [buf.buffer]);
  }

  /**
   * Start at sam, `delay` seconds from now (e.g. after a count-in: the
   * clock runs from then, with negative beats until sam). Returns the
   * context time at which sam sounds.
   */
  play(id, { bpm, pitch, tanpuraRatio, loop, delay = 0 }) {
    const sr = this.ctx.sampleRate;
    // A little lead time so the message reaches the audio thread first.
    const when = this.ctx.currentTime + 0.04 + Math.max(0, delay);
    const startFrame = Math.round(when * sr);
    this.session++;
    this.seq++;
    this.playing = true;
    this.anchor = { frame: startFrame, beat: 0, bpf: bpm / 60 / sr };
    this._touch(id);
    this.node.port.postMessage({
      type: 'play', id, session: this.session, seq: this.seq, startFrame,
      bpm, pitch, tanpuraRatio, loop
    });
    return when;
  }

  setParams(params) {
    if (!this.node) return;
    if (params.bpm !== undefined) {
      this.seq++;
      if (this.anchor) {
        // Re-anchor locally so beat predictions switch tempo right away; the
        // worklet's next report replaces this with the exact figure.
        const sr = this.ctx.sampleRate;
        const frame = this.ctx.currentTime * sr;
        const bpf = params.bpm / 60 / sr;
        if (frame < this.anchor.frame) {
          // Still before sam (count-in): sam keeps its time, the count-in
          // beats before it follow the new tempo.
          this.anchor = { ...this.anchor, bpf };
        } else {
          const beat = this.anchor.beat + (frame - this.anchor.frame) * this.anchor.bpf;
          this.anchor = { frame, beat, bpf };
        }
      }
    }
    this.node.port.postMessage({ type: 'params', seq: this.seq, ...params });
  }

  /** Crossfade to another raag; keeps the cycle position unless resetPhase. */
  switchRaag(id, resetPhase) {
    this._touch(id);
    this.seq++;
    // A new cycle starts: no beat predictions until the engine reports it.
    if (resetPhase) this.anchor = null;
    this.node.port.postMessage({ type: 'switch', id, resetPhase, seq: this.seq });
  }

  stop() {
    if (!this.node) return;
    this.playing = false;
    this.anchor = null;
    this.node.port.postMessage({ type: 'stop' });
  }

  /** Cumulative beat (sam of the first cycle = 0) sounding at context time t. */
  beatAt(t) {
    const a = this.anchor;
    if (!a) return null;
    return a.beat + (t * this.ctx.sampleRate - a.frame) * a.bpf;
  }

  /** Context time at which cumulative beat `b` sounds. */
  timeOfBeat(b) {
    const a = this.anchor;
    if (!a || !(a.bpf > 0)) return null;
    return (a.frame + (b - a.beat) / a.bpf) / this.ctx.sampleRate;
  }
}
