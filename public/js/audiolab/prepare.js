/**
 * The "Prepare" step: your recording's waveform (the analysis preview), where you
 *
 *   trim     drag the two handles — what is outside is left out
 *   noise    switch to "Mark noise" and drag over a stretch with no playing —
 *            the noise reduction learns from exactly that
 *   align    play it with the lehra looping under it and tap on each sam —
 *            the lehra's sam is moved onto your taps (nudge ±10 ms after)
 *
 * The live preview is only for setting these up (no processing is applied);
 * the times it produces are on the upload's own timeline, which is what the
 * server expects.
 */
import { getAudioContext } from '../core/audio-context.js';
import { getMasterOutput, outputLatency } from '../core/audio-output.js';
import { computePeaks, formatClock, offsetFromTaps } from './format.js';

const HANDLE_PX = 14;
const MIN_TRIM = 1.0;

export function createPreparer({ canvas, onChange = () => {} }) {
  let tabla = null;          // AudioBuffer of the preview
  let lehra = null;          // AudioBuffer of the lehra (or null)
  let cycle = null;          // seconds per taal cycle when known (catalogue lehra)
  let lehraDb = -7;
  let tablaRms = -20, lehraRms = -20;
  let offset = 0;            // where the lehra loop starts, on the upload's timeline
  let auto = true;
  let withLehra = true;
  let trim = null;           // { start, end } or null = everything
  let noise = null;          // { start, end } or null
  let mode = 'trim';
  let taps = [];
  let peaks = null;
  let playing = false, startedAt = 0, from = 0;
  let nodes = null;
  let raf = 0;
  let drag = null;

  const ctx = () => getAudioContext();
  const dur = () => (tabla ? tabla.duration : 0);

  function rmsDb(buf) {
    const ch = buf.getChannelData(0);
    let s = 0, n = 0;
    for (let i = 0; i < ch.length; i += 8) { s += ch[i] * ch[i]; n++; }
    return 10 * Math.log10(s / Math.max(1, n) + 1e-12);
  }

  function emit() {
    onChange({ trim, noise, offset: auto ? null : offset, taps: taps.length, playing, position: position(), duration: dur() });
  }

  function position() {
    if (!playing) return from;
    return Math.min(dur(), from + (ctx().currentTime - startedAt));
  }

  // ── sound ──────────────────────────────────────────────────────────────────
  function stopNodes() {
    if (!nodes) return;
    for (const n of nodes) { try { n.stop(); } catch { /* already stopped */ } }
    nodes = null;
  }

  function startAt(at) {
    const c = ctx();
    stopNodes();
    const out = getMasterOutput();
    const t = c.createBufferSource();
    t.buffer = tabla;
    t.connect(out);
    const list = [t];
    const when = c.currentTime + 0.03;
    t.start(when, at);
    if (lehra && withLehra) {
      const l = c.createBufferSource();
      l.buffer = lehra;
      l.loop = true;
      const g = c.createGain();
      g.gain.value = 10 ** ((tablaRms + lehraDb - lehraRms) / 20);
      l.connect(g); g.connect(out);
      const period = lehra.duration;
      const into = (((at - (auto ? 0 : offset)) % period) + period) % period;
      l.start(when, into);
      list.push(l);
    }
    t.onended = () => { if (nodes === list) { playing = false; from = 0; nodes = null; emit(); draw(); } };
    nodes = list;
    startedAt = when;
    from = at;
    playing = true;
  }

  function frame() {
    draw();
    if (playing) { emit(); raf = requestAnimationFrame(frame); }
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
    if (!tabla) return;
    const cols = Math.min(w, 1400);
    if (!peaks || peaks.cols !== cols) peaks = { cols, ...computePeaks(tabla.getChannelData(0), cols) };
    const x = s => (s / dur()) * w;
    const mid = h / 2;
    const gold = colour('--gold', '#f5a623'), dim = colour('--text-muted', '#6b5d4b');
    const a = trim ? trim.start : 0, b = trim ? trim.end : dur();
    const colW = w / cols;
    for (let i = 0; i < cols; i++) {
      const t = (i / cols) * dur();
      const inside = t >= a && t <= b;
      g.fillStyle = inside ? gold : dim;
      g.globalAlpha = inside ? 0.9 : 0.35;
      const y1 = mid - peaks.maxs[i] * mid * 0.92, y2 = mid - peaks.mins[i] * mid * 0.92;
      g.fillRect(i * colW, y1, Math.max(1, colW - 0.5), Math.max(dpr, y2 - y1));
    }
    g.globalAlpha = 1;
    // what is trimmed away
    g.fillStyle = 'rgba(9,8,6,0.55)';
    if (a > 0) g.fillRect(0, 0, x(a), h);
    if (b < dur()) g.fillRect(x(b), 0, w - x(b), h);
    // the noise sample
    if (noise) {
      g.fillStyle = 'rgba(232,87,42,0.22)';
      g.fillRect(x(noise.start), 0, x(noise.end) - x(noise.start), h);
      g.fillStyle = '#e8572a';
      g.font = `${11 * dpr}px Outfit, sans-serif`;
      g.fillText('noise', x(noise.start) + 4 * dpr, 13 * dpr);
    }
    // the lehra's sams
    if (lehra && !auto) {
      const step = cycle || lehra.duration;
      g.fillStyle = 'rgba(255,209,102,0.75)';
      let k = Math.ceil((0 - offset) / step);
      for (let s = offset + k * step; s < dur(); k++, s = offset + k * step) {
        g.fillRect(x(s) - dpr / 2, 0, dpr, 7 * dpr);
        g.fillRect(x(s) - dpr / 2, h - 7 * dpr, dpr, 7 * dpr);
      }
    }
    // trim handles
    g.fillStyle = '#ffd166';
    for (const s of [a, b]) {
      g.fillRect(x(s) - dpr, 0, 2 * dpr, h);
      g.fillRect(x(s) - 4 * dpr, mid - 12 * dpr, 8 * dpr, 24 * dpr);
    }
    // playhead
    g.fillStyle = '#ede0cc';
    g.fillRect(x(position()) - dpr / 2, 0, dpr, h);
  }

  // ── pointer ────────────────────────────────────────────────────────────────
  const timeAt = e => {
    const r = canvas.getBoundingClientRect();
    return Math.max(0, Math.min(dur(), ((e.clientX - r.left) / r.width) * dur()));
  };
  const pxOf = s => (s / dur()) * canvas.getBoundingClientRect().width;

  canvas.addEventListener('pointerdown', e => {
    if (!tabla) return;
    canvas.setPointerCapture(e.pointerId);
    const t = timeAt(e);
    const r = canvas.getBoundingClientRect();
    const px = e.clientX - r.left;
    if (mode === 'noise') {
      drag = { kind: 'noise', from: t };
      noise = { start: t, end: t };
    } else {
      const a = trim ? trim.start : 0, b = trim ? trim.end : dur();
      if (Math.abs(px - pxOf(a)) <= HANDLE_PX) drag = { kind: 'start' };
      else if (Math.abs(px - pxOf(b)) <= HANDLE_PX) drag = { kind: 'end' };
      else { drag = null; seek(t); }
    }
    draw();
  });
  canvas.addEventListener('pointermove', e => {
    if (!drag) return;
    const t = timeAt(e);
    if (drag.kind === 'noise') {
      noise = { start: Math.min(drag.from, t), end: Math.max(drag.from, t) };
    } else {
      const a = trim ? trim.start : 0, b = trim ? trim.end : dur();
      trim = drag.kind === 'start'
        ? { start: Math.min(t, b - MIN_TRIM), end: b }
        : { start: a, end: Math.max(t, a + MIN_TRIM) };
      trim.start = Math.max(0, trim.start);
      trim.end = Math.min(dur(), trim.end);
      if (trim.start <= 0.01 && trim.end >= dur() - 0.01) trim = null;
    }
    draw();
    emit();
  });
  const endDrag = () => {
    if (drag && drag.kind === 'noise' && noise && noise.end - noise.start < 0.2) noise = null;
    drag = null;
    draw();
    emit();
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => draw()).observe(canvas);

  function seek(t) {
    if (playing) startAt(t); else from = t;
    draw();
    emit();
  }

  return {
    async loadTabla(url) {
      this.stop();
      const res = await fetch(url);
      if (!res.ok) throw new Error('Could not load the preview.');
      tabla = await ctx().decodeAudioData(await res.arrayBuffer());
      tablaRms = rmsDb(tabla);
      peaks = null; trim = null; noise = null; taps = []; from = 0;
      draw(); emit();
    },
    async setLehra(blobOrNull, knownCycle = null) {
      const was = playing;
      if (was) this.stop();
      lehra = blobOrNull ? await ctx().decodeAudioData(await blobOrNull.arrayBuffer()) : null;
      cycle = knownCycle;
      lehraRms = lehra ? rmsDb(lehra) : -20;
      taps = [];
      draw(); emit();
    },
    hasLehra: () => !!lehra,
    setLehraLevel(db) { lehraDb = db; if (playing) startAt(position()); },
    setWithLehra(on) { withLehra = on; if (playing) startAt(position()); },
    setMode(m) { mode = m; },
    clearNoise() { noise = null; draw(); emit(); },
    resetTrim() { trim = null; draw(); emit(); },
    setTrim(range) { trim = range; draw(); emit(); },
    setNoise(range) { noise = range; draw(); emit(); },
    setAuto(on) { auto = on; if (on) taps = []; if (playing) startAt(position()); draw(); emit(); },
    setOffset(s) { offset = s; auto = false; if (playing) startAt(position()); draw(); emit(); },
    nudge(ms) { offset += ms / 1000; auto = false; if (playing) startAt(position()); draw(); emit(); },
    /** A tap on the sam you hear: the lehra's sam moves there (catalogue lehra: the average of your taps). */
    tapSam() {
      if (!playing || !lehra) return null;
      const t = position() - outputLatency();
      taps.push(t);
      offset = cycle ? offsetFromTaps(taps.slice(-8), cycle) : t;
      auto = false;
      startAt(position());
      draw(); emit();
      return offset;
    },
    play() {
      if (!tabla) return;
      const c = ctx();
      if (c.state === 'suspended') c.resume();
      const a = trim ? trim.start : 0;
      startAt(from >= dur() - 0.05 || from < a ? a : from);
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(frame);
      emit();
    },
    stop() {
      if (playing) from = position();
      playing = false;
      stopNodes();
      cancelAnimationFrame(raf);
      draw(); emit();
    },
    toggle() { if (playing) this.stop(); else this.play(); },
    isPlaying: () => playing,
    state: () => ({ trim, noise, offset: auto ? null : offset, auto, taps: taps.length, duration: dur() }),
    /** The decoded recordings, for the sync editor (sync-editor.js). */
    buffers: () => ({ tabla, lehra, cycle, lehraDb, offset: auto ? null : offset }),
    label: () => `${formatClock(position())} / ${formatClock(dur())}`,
    redraw: draw,
  };
}
