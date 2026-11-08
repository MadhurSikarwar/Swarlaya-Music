/**
 * The A/B player: the original and each version decoded once, one waveform,
 * and a switch that carries on from the same moment in the new version (a
 * 20 ms crossfade, no gap).  Two listening aids:
 *
 *   Match loudness       the original is brought up to the versions' loudness
 *                        (the server did it), because the louder of two
 *                        recordings always sounds better; switch it off to
 *                        hear the original at its own level.
 *   Phone speaker        a rough model of a phone's speaker — nothing below
 *                        ~300 Hz, a bump around 1.8 kHz, a roll-off above
 *                        9 kHz, summed to mono.  An approximation for
 *                        comparing, not a measurement of any real phone.
 *
 * Output goes through the page's master (core/audio-output.js), like the other
 * players, so lock-screen controls and background playback behave the same.
 */
import { getAudioContext } from '../core/audio-context.js';
import { getMasterOutput, startMediaOutput, stopMediaOutput } from '../core/audio-output.js';
import { clearMediaSession, setMediaPlaybackState, showMediaSession } from '../core/media-session.js';
import { computePeaks, naturalLevelGain } from './format.js';

const CROSSFADE = 0.02;
const BUDGET_SAMPLES = 48000 * 2 * 60 * 6;   // ~6 minutes of stereo kept decoded; older ones are dropped and re-fetched

export function createPlayer({ canvas, onChange = () => {} }) {
  const sources = new Map();     // name → { url, label }
  const buffers = new Map();     // name → AudioBuffer (insertion order = least recently used first)
  const peaks = new Map();       // name → { mins, maxs, columns }
  const loading = new Map();     // name → Promise<AudioBuffer>
  let graph = null;
  let current = null;
  let node = null;               // { src, gain } of what is sounding
  let startedAt = 0;             // context time at which `offset` was position 0 of the playing buffer
  let offset = 0;                // seconds into the recording
  let playing = false;
  let matchLoudness = true;
  let phoneSpeaker = false;
  let levels = { original: null, target: null };
  let raf = 0;
  let sessionOwner = null;

  const ctx = () => getAudioContext();

  function buildGraph() {
    if (graph) return graph;
    const c = ctx();
    const bus = c.createGain();
    const direct = c.createGain();
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 300; hp.Q.value = 0.8;
    const bump = c.createBiquadFilter(); bump.type = 'peaking'; bump.frequency.value = 1800; bump.Q.value = 1; bump.gain.value = 3;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 9000; lp.Q.value = 0.7;
    const mono = c.createGain(); mono.channelCount = 1; mono.channelCountMode = 'explicit'; mono.channelInterpretation = 'speakers';
    bus.connect(direct);
    hp.connect(bump); bump.connect(lp); lp.connect(mono);
    graph = { bus, direct, hp, mono };
    route();
    return graph;
  }

  function route() {
    if (!graph) return;
    const master = getMasterOutput();
    graph.direct.disconnect(); graph.mono.disconnect(); graph.bus.disconnect();
    if (phoneSpeaker) {
      graph.bus.connect(graph.hp);
      graph.mono.connect(master);
    } else {
      graph.bus.connect(graph.direct);
      graph.direct.connect(master);
    }
  }

  function levelFor(name) {
    if (name === 'original' && !matchLoudness) return naturalLevelGain(levels.original, levels.target);
    return 1;
  }

  async function decode(name) {
    const entry = sources.get(name);
    if (!entry) throw new Error(`Unknown version ${name}`);
    const res = await fetch(entry.url);
    if (!res.ok) throw new Error(`Could not load ${entry.label}`);
    const data = await res.arrayBuffer();
    return ctx().decodeAudioData(data);
  }

  function remember(name, buffer) {
    buffers.delete(name);
    buffers.set(name, buffer);
    let total = 0;
    for (const b of buffers.values()) total += b.length * b.numberOfChannels;
    for (const key of buffers.keys()) {   // drop the least recently used, never the one in use
      if (total <= BUDGET_SAMPLES || buffers.size <= 2) break;
      if (key === current || key === name) continue;
      const b = buffers.get(key);
      total -= b.length * b.numberOfChannels;
      buffers.delete(key);
    }
  }

  function ensure(name) {
    if (buffers.has(name)) {
      remember(name, buffers.get(name));
      return Promise.resolve(buffers.get(name));
    }
    if (!loading.has(name)) {
      loading.set(name, decode(name).then(buf => { remember(name, buf); return buf; }).finally(() => loading.delete(name)));
    }
    return loading.get(name);
  }

  function peaksFor(name, columns) {
    const hit = peaks.get(name);
    if (hit && hit.columns === columns) return hit;
    const buf = buffers.get(name);
    if (!buf) return null;
    const left = buf.getChannelData(0);
    const right = buf.numberOfChannels > 1 ? buf.getChannelData(1) : left;
    const a = computePeaks(left, columns), b = computePeaks(right, columns);
    const out = { columns, mins: a.mins.map((v, i) => Math.min(v, b.mins[i])), maxs: a.maxs.map((v, i) => Math.max(v, b.maxs[i])) };
    peaks.set(name, out);
    return out;
  }

  function duration() {
    const b = buffers.get(current) || [...buffers.values()][0];
    return b ? b.duration : 0;
  }

  function position() {
    if (!playing) return offset;
    return Math.min(duration(), offset + (ctx().currentTime - startedAt));
  }

  // ── drawing ────────────────────────────────────────────────────────────────
  function colour(name, fallback) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  }

  function draw() {
    if (!canvas.isConnected) return;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr)), h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    const g = canvas.getContext('2d');
    g.clearRect(0, 0, w, h);
    const pk = peaksFor(current, Math.min(w, 1400));
    const mid = h / 2;
    const dur = duration();
    const head = dur ? position() / dur : 0;
    const gold = colour('--gold', '#f5a623'), dim = colour('--text-muted', '#6b5d4b');
    g.fillStyle = 'rgba(255,255,255,0.05)';
    g.fillRect(0, mid - 0.5 * dpr, w, dpr);
    if (pk) {
      const colW = w / pk.columns;
      for (let i = 0; i < pk.columns; i++) {
        const x = i * colW;
        const y1 = mid - pk.maxs[i] * mid * 0.95, y2 = mid - pk.mins[i] * mid * 0.95;
        g.fillStyle = x / w <= head ? gold : dim;
        g.fillRect(x, y1, Math.max(1, colW - 0.5), Math.max(dpr, y2 - y1));
      }
    }
    g.fillStyle = '#ffd166';
    g.fillRect(Math.round(head * w) - dpr, 0, 2 * dpr, h);
  }

  function frame() {
    draw();
    onChange({ type: 'time', position: position(), duration: duration() });
    if (playing) raf = requestAnimationFrame(frame);
  }

  function tick() {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(frame);
  }

  // ── transport ──────────────────────────────────────────────────────────────
  function startNode(name, at) {
    const c = ctx();
    const g = buildGraph();
    const src = c.createBufferSource();
    src.buffer = buffers.get(name);
    const gain = c.createGain();
    const level = levelFor(name);
    gain.gain.setValueAtTime(0, c.currentTime);
    gain.gain.linearRampToValueAtTime(level, c.currentTime + CROSSFADE);
    src.connect(gain); gain.connect(g.bus);
    const mine = { src, gain, name };
    src.onended = () => {
      if (node !== mine) return;
      playing = false;
      offset = 0;
      node = null;
      stopMediaOutput();
      setMediaPlaybackState('paused');
      onChange({ type: 'ended' });
      tick();
    };
    src.start(0, Math.min(at, Math.max(0, src.buffer.duration - 0.01)));
    startedAt = c.currentTime;
    offset = at;
    return mine;
  }

  function retire(old) {
    const c = ctx();
    old.src.onended = null;
    old.gain.gain.cancelScheduledValues(c.currentTime);
    old.gain.gain.setValueAtTime(old.gain.gain.value, c.currentTime);
    old.gain.gain.linearRampToValueAtTime(0, c.currentTime + CROSSFADE);
    try { old.src.stop(c.currentTime + CROSSFADE + 0.01); } catch { /* already stopped */ }
  }

  const actions = { play: () => play(), pause: () => pause(), stop: () => stop() };

  async function play() {
    if (!current) return;
    await ensure(current);
    const c = ctx();
    if (c.state === 'suspended') await c.resume();
    startMediaOutput();
    if (offset >= duration() - 0.05) offset = 0;
    if (node) retire(node);
    node = startNode(current, offset);
    playing = true;
    sessionOwner = actions;
    showMediaSession({ title: `Audio Lab — ${sources.get(current).label}`, artist: 'Swaralaya' }, actions);
    onChange({ type: 'play' });
    tick();
  }

  function pause() {
    if (!playing) return;
    offset = position();
    playing = false;
    if (node) { retire(node); node = null; }
    stopMediaOutput();
    setMediaPlaybackState('paused');
    onChange({ type: 'pause' });
    tick();
  }

  function stop() {
    pause();
    offset = 0;
    if (sessionOwner) clearMediaSession(sessionOwner);
    tick();
  }

  async function select(name) {
    if (!sources.has(name) || name === current) return;
    const wasPlaying = playing;
    const at = position();
    onChange({ type: 'loading', name });
    await ensure(name);
    current = name;
    if (wasPlaying) {
      const old = node;
      node = startNode(name, at);
      if (old) retire(old);
      showMediaSession({ title: `Audio Lab — ${sources.get(name).label}`, artist: 'Swaralaya' }, actions);
    } else {
      offset = at;
    }
    onChange({ type: 'select', name });
    tick();
  }

  async function seek(fraction) {
    const at = Math.max(0, Math.min(1, fraction)) * duration();
    if (playing) {
      const old = node;
      node = startNode(current, at);
      if (old) retire(old);
    } else {
      offset = at;
    }
    tick();
  }

  canvas.addEventListener('pointerdown', e => {
    if (!duration()) return;
    canvas.setPointerCapture(e.pointerId);
    const at = ev => { const r = canvas.getBoundingClientRect(); seek((ev.clientX - r.left) / r.width); };
    at(e);
    const move = ev => at(ev);
    const up = () => { canvas.removeEventListener('pointermove', move); canvas.removeEventListener('pointerup', up); };
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
  });
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => draw()).observe(canvas);

  return {
    /** sourcesByName = { original: {url, label}, balanced: {…}, … }; loads `first`, others on demand or in the background. */
    async load(sourcesByName, first, levelInfo) {
      stop();
      buffers.clear(); peaks.clear(); loading.clear();
      sources.clear();
      for (const [k, v] of Object.entries(sourcesByName)) sources.set(k, v);
      levels = levelInfo || { original: null, target: null };
      current = first;
      offset = 0;
      await ensure(first);
      onChange({ type: 'ready', duration: duration() });
      tick();
      for (const name of sources.keys()) {   // the rest, one after another, so switching is instant
        if (name !== first) await ensure(name).catch(() => {});
      }
      onChange({ type: 'loaded' });
    },
    select, play, pause, stop, seek,
    toggle: () => (playing ? pause() : play()),
    isPlaying: () => playing,
    current: () => current,
    duration, position,
    isLoaded: name => buffers.has(name),
    setMatchLoudness(on) {
      matchLoudness = on;
      if (node && node.name === 'original') node.gain.gain.setTargetAtTime(levelFor('original'), ctx().currentTime, 0.02);
    },
    setPhoneSpeaker(on) { phoneSpeaker = on; route(); },
    redraw: draw,
    dispose() { stop(); buffers.clear(); peaks.clear(); sources.clear(); },
  };
}
