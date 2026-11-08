/**
 * The sync editor: the tabla and the lehra as two tracks on one timeline, to
 * line up a lehra recorded on its own, the job a video editor did before.
 *
 *   drag the lehra          move it against the tabla (zoom in for the last ms)
 *   double-click a track    put that track's sam there (it snaps to the stroke)
 *   Line up sams            the lehra's sam moves onto the tabla's
 *   ← / →  (Shift: ×10)     nudge the lehra 1 ms (10 ms)
 *   Space                   play / pause, both tracks together
 *   T / L                   the tabla's / the lehra's sam at the playhead
 *
 * With the taal cycle known (a Swaralaya lehra, or a Lehra Player download's
 * file name), every sam is drawn across both tracks, so a drift shows up
 * anywhere in the recording, not only where you lined it up.
 *
 * "Use this sync" hands the offset to the mastering (offset_seconds), and
 * "Download the synced mix" renders the two tracks to a WAV here in the
 * browser, nothing processed, just lined up and levelled.
 */
import { getAudioContext } from '../core/audio-context.js';
import { getMasterOutput, outputLatency } from '../core/audio-output.js';
import { CATALOGUE } from '../lehra/catalogue.js';
import { toPcm16, wavHeader } from '../lehra/export-format.js';
import { formatClock, formatNumber } from './format.js';
import {
  formatShift, lehraFromName, lehraTime, offsetForSams, peakOf, rangePeak, samGap, samTimes, snapToOnset, wrapOffset,
} from './sync.js';

const RULER_H = 22;
const MIN_VIEW = 0.25;         // seconds across the lanes at the closest zoom
const DRAG_PX = 4;             // a press that moves less than this is a click

/** Every taal in the catalogue, once: what a file name can be matched against. */
function catalogueTaals() {
  const seen = new Map();
  for (const inst of Object.values(CATALOGUE)) {
    for (const [name, t] of Object.entries(inst.taals || {})) {
      if (!seen.has(name)) seen.set(name, { name, beatsPerCycle: t.beats / (t.cycles || 1) });
    }
  }
  return [...seen.values()];
}

const $ = (root, sel) => root.querySelector(sel);

export function createSyncEditor({ overlay, onApply = () => {} }) {
  const lanes = $(overlay, '[data-sync="lanes"]');
  const canvas = $(overlay, '[data-sync="canvas"]');
  const ui = name => $(overlay, `[data-sync="${name}"]`);

  let tabla = null, lehra = null;             // AudioBuffers
  let tablaName = 'tabla', lehraName = 'lehra';
  let tablaRms = -20, lehraRms = -20;
  let offset = 0;                             // where the lehra's 0 s falls on the tabla's timeline
  let tablaSam = null, lehraSam = null;       // tabla time; lehra time
  let cycle = null;                           // seconds per taal cycle, when known
  let lehraDb = -7, tablaGainDb = 0;
  let muteTabla = false, muteLehra = false;
  let view = { from: 0, span: 10 };           // the visible stretch of the tabla's timeline
  let playing = false, startedAt = 0, from = 0, nodes = null, raf = 0;
  let press = null;

  const ctx = () => getAudioContext();
  const dur = () => (tabla ? tabla.duration : 0);
  const period = () => (lehra ? lehra.duration : 1);

  function rmsDb(buf) {
    const ch = buf.getChannelData(0);
    let s = 0, n = 0;
    for (let i = 0; i < ch.length; i += 8) { s += ch[i] * ch[i]; n++; }
    return 10 * Math.log10(s / Math.max(1, n) + 1e-12);
  }

  const lehraGain = () => (muteLehra ? 0 : 10 ** ((tablaRms + lehraDb - lehraRms) / 20));
  const tablaGain = () => (muteTabla ? 0 : 10 ** (tablaGainDb / 20));

  // ── sound ──────────────────────────────────────────────────────────────────
  function position() {
    if (!playing) return from;
    return Math.min(dur(), from + (ctx().currentTime - startedAt));
  }

  function stopNodes() {
    if (!nodes) return;
    for (const n of nodes.sources) { try { n.stop(); } catch { /* already stopped */ } }
    nodes = null;
  }

  function startAt(at) {
    const c = ctx();
    stopNodes();
    const out = getMasterOutput();
    const when = c.currentTime + 0.03;
    const t = c.createBufferSource();
    t.buffer = tabla;
    const tg = c.createGain();
    tg.gain.value = tablaGain();
    t.connect(tg); tg.connect(out);
    t.start(when, at);
    const l = c.createBufferSource();
    l.buffer = lehra;
    l.loop = true;
    const lg = c.createGain();
    lg.gain.value = lehraGain();
    l.connect(lg); lg.connect(out);
    l.start(when, lehraTime(at, offset, period()));
    const mine = { sources: [t, l], tg, lg };
    t.onended = () => {
      if (nodes !== mine) return;
      playing = false; from = 0; nodes = null; cancelAnimationFrame(raf); draw(); status();
    };
    nodes = mine;
    startedAt = when;
    from = at;
    playing = true;
  }

  function restart() { if (playing) startAt(position()); }

  function levels() {
    if (!nodes) return;
    nodes.tg.gain.value = tablaGain();
    nodes.lg.gain.value = lehraGain();
  }

  function play() {
    if (!tabla || !lehra) return;
    if (ctx().state === 'suspended') ctx().resume();
    startAt(from >= dur() - 0.05 ? 0 : from);
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(frame);
    status();
  }

  function stop() {
    if (playing) from = position();
    playing = false;
    stopNodes();
    cancelAnimationFrame(raf);
    draw(); status();
  }

  function frame() {
    if (!playing) return;
    const p = position();
    if (ui('follow').checked && (p < view.from || p > view.from + view.span * 0.9)) {
      view.from = Math.max(0, Math.min(dur() - view.span, p - view.span * 0.1));
    }
    draw();
    ui('time').textContent = `${formatClock(p)} / ${formatClock(dur())}`;
    raf = requestAnimationFrame(frame);
  }

  // ── drawing ────────────────────────────────────────────────────────────────
  function colour(name, fallback) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  }

  function geometry() {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    const ruler = RULER_H * dpr;
    const lane = (h - ruler) / 2;
    return { dpr, w, h, ruler, lane, tablaTop: ruler, lehraTop: ruler + lane };
  }

  const xOf = (t, w) => ((t - view.from) / view.span) * w;
  const tOf = (x, w) => view.from + (x / w) * view.span;

  function draw() {
    if (!canvas.isConnected) return;
    const { dpr, w, h, ruler, lane, tablaTop, lehraTop } = geometry();
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    const g = canvas.getContext('2d');
    g.clearRect(0, 0, w, h);
    if (!tabla || !lehra) return;
    const gold = colour('--gold', '#f5a623'), light = colour('--gold-light', '#ffd166');
    const muted = colour('--text-muted', '#6b5d4b'), sub = colour('--text-sub', '#86775f');
    const font = `${11 * dpr}px Outfit, sans-serif`;

    // ruler
    g.fillStyle = 'rgba(255,255,255,0.03)';
    g.fillRect(0, 0, w, ruler);
    const steps = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60];
    const step = steps.find(s => (s / view.span) * w >= 70 * dpr) || 60;
    g.font = font;
    g.fillStyle = sub;
    g.textBaseline = 'middle';
    for (let t = Math.ceil(view.from / step) * step; t <= view.from + view.span; t += step) {
      const x = xOf(t, w);
      g.fillRect(x, ruler - 6 * dpr, dpr, 6 * dpr);
      const label = step < 1 ? `${formatClock(Math.floor(t))}.${String(Math.round((t % 1) * 1000)).padStart(3, '0')}` : formatClock(t);
      g.fillText(label, x + 3 * dpr, ruler / 2 - 2 * dpr);
    }

    // lanes
    g.fillStyle = 'rgba(255,255,255,0.025)';
    g.fillRect(0, lehraTop, w, lane);
    g.fillStyle = 'rgba(255,255,255,0.08)';
    g.fillRect(0, lehraTop, w, dpr);
    const tData = tabla.getChannelData(0), lData = lehra.getChannelData(0);
    const cols = Math.min(w, 1600);
    const colW = w / cols;
    const tMid = tablaTop + lane / 2, lMid = lehraTop + lane / 2, amp = lane * 0.44;
    for (let i = 0; i < cols; i++) {
      const t0 = tOf(i * colW, w), t1 = tOf((i + 1) * colW, w);
      if (t1 > 0 && t0 < dur()) {
        const [lo, hi] = rangePeak(tData, Math.max(0, t0) * tabla.sampleRate, Math.min(dur(), t1) * tabla.sampleRate);
        g.fillStyle = muteTabla ? muted : gold;
        g.globalAlpha = muteTabla ? 0.4 : 0.9;
        g.fillRect(i * colW, tMid - hi * amp, Math.max(1, colW - 0.4), Math.max(dpr, (hi - lo) * amp));
      }
      // the lehra loops under the whole tabla: its first pass bright, the repeats dimmer
      const u0 = lehraTime(t0, offset, period());
      const u1 = u0 + (t1 - t0);
      const sr = lehra.sampleRate;
      let [lo, hi] = rangePeak(lData, u0 * sr, Math.min(period(), u1) * sr);
      if (u1 > period()) {
        const [lo2, hi2] = rangePeak(lData, 0, (u1 - period()) * sr);
        lo = Math.min(lo, lo2); hi = Math.max(hi, hi2);
      }
      const firstPass = t0 >= offset && t0 < offset + period();
      g.fillStyle = muteLehra ? muted : light;
      g.globalAlpha = muteLehra ? 0.35 : firstPass ? 0.85 : 0.4;
      g.fillRect(i * colW, lMid - hi * amp, Math.max(1, colW - 0.4), Math.max(dpr, (hi - lo) * amp));
    }
    g.globalAlpha = 1;

    // where the lehra loops round
    g.fillStyle = 'rgba(237,224,204,0.35)';
    g.font = font;
    for (let k = Math.floor((view.from - offset) / period()); ; k++) {
      const t = offset + k * period();
      if (t > view.from + view.span) break;
      if (t < view.from) continue;
      const x = xOf(t, w);
      g.fillRect(x, lehraTop, dpr, lane);
      g.fillText(k === 0 ? 'lehra starts' : 'loops', x + 4 * dpr, lehraTop + 10 * dpr);
    }

    // every sam, from the lehra's, across both tracks
    if (cycle && lehraSam !== null) {
      g.fillStyle = 'rgba(255,209,102,0.28)';
      for (const t of samTimes(offset, lehraSam, cycle, view.from, view.from + view.span)) g.fillRect(xOf(t, w) - dpr / 2, ruler, dpr, h - ruler);
    }

    // the two sam markers
    const marker = (x, top, label, fill) => {
      g.fillStyle = fill;
      g.fillRect(x - dpr, top, 2 * dpr, lane);
      g.beginPath();
      g.moveTo(x, top + 2 * dpr); g.lineTo(x + 7 * dpr, top + 9 * dpr); g.lineTo(x, top + 16 * dpr); g.lineTo(x - 7 * dpr, top + 9 * dpr);
      g.closePath(); g.fill();
      g.fillText(label, x + 10 * dpr, top + 10 * dpr);
    };
    if (tablaSam !== null) marker(xOf(tablaSam, w), tablaTop, 'tabla sam', '#e8572a');
    if (lehraSam !== null) {
      for (let k = Math.floor((view.from - offset - lehraSam) / period()); ; k++) {
        const t = offset + lehraSam + k * period();
        if (t > view.from + view.span + 1) break;
        if (t >= view.from - 1) marker(xOf(t, w), lehraTop, 'lehra sam', '#e8572a');
      }
    }

    // playhead
    g.fillStyle = colour('--text-primary', '#ede0cc');
    g.fillRect(xOf(position(), w) - dpr / 2, 0, dpr, h);
  }

  // ── what the controls show ─────────────────────────────────────────────────
  function status() {
    ui('playIcon').style.display = playing ? 'none' : '';
    ui('stopIcon').style.display = playing ? '' : 'none';
    ui('time').textContent = `${formatClock(position())} / ${formatClock(dur())}`;
    ui('offset').value = offset.toFixed(3);
    ui('tablaSam').textContent = tablaSam === null ? 'not marked' : `${formatClock(Math.floor(tablaSam))}.${String(Math.round((tablaSam % 1) * 1000)).padStart(3, '0')}`;
    ui('lehraSam').textContent = lehraSam === null ? 'not marked' : `${formatNumber(lehraSam, 3)} s into the lehra`;
    ui('lineUp').disabled = tablaSam === null || lehraSam === null;
    const gap = ui('gap');
    if (tablaSam !== null && lehraSam !== null) {
      const d = samGap(tablaSam, lehraSam, offset, cycle);
      const ms = Math.abs(d) * 1000;
      gap.textContent = ms < 0.5 ? 'The sams line up.' : `The lehra’s sam is ${formatShift(Math.abs(d)).slice(1)} ${d > 0 ? 'late' : 'early'}.`;
      gap.classList.toggle('alab-sync-ok', ms < 5);
    } else {
      gap.textContent = 'Double-click on each track where its sam is, or press T and L at the playhead.';
      gap.classList.remove('alab-sync-ok');
    }
    ui('cycleLabel').textContent = cycle ? `one cycle = ${formatNumber(cycle, 3)} s` : 'cycle unknown: sams are not drawn';
    ui('lehraDbVal').textContent = `${formatNumber(lehraDb, 0)} dB`;
    ui('tablaDbVal').textContent = `${formatNumber(tablaGainDb, 0)} dB`;
    ui('muteTabla').setAttribute('aria-pressed', String(muteTabla));
    ui('muteLehra').setAttribute('aria-pressed', String(muteLehra));
  }

  function changed() { restart(); draw(); status(); }

  function setOffset(o) {
    offset = wrapOffset(o, period());
    changed();
  }

  // ── zoom and scroll ────────────────────────────────────────────────────────
  function clampView() {
    view.span = Math.max(MIN_VIEW, Math.min(Math.max(dur(), MIN_VIEW), view.span));
    view.from = Math.max(0, Math.min(Math.max(0, dur() - view.span), view.from));
    ui('zoom').value = String(Math.round(100 * Math.log(Math.max(dur(), MIN_VIEW) / view.span) / Math.log(Math.max(dur(), MIN_VIEW) / MIN_VIEW)));
  }

  function zoomAround(t, factor) {
    const k = (t - view.from) / view.span;
    view.span *= factor;
    clampView();
    view.from = t - k * view.span;
    clampView();
    draw();
  }

  function zoomTo(percent) {
    const full = Math.max(dur(), MIN_VIEW);
    const centre = playing ? position() : view.from + view.span / 2;
    view.span = full * (MIN_VIEW / full) ** (percent / 100);
    view.from = centre - view.span / 2;
    clampView();
    draw();
  }

  /** Shows `t` near the middle at a close zoom: for checking one sam. */
  function focus(t, span = 1.5) {
    view.span = span;
    view.from = t - span / 2;
    clampView();
    draw();
  }

  // ── pointer ────────────────────────────────────────────────────────────────
  function laneAt(e) {
    const r = canvas.getBoundingClientRect();
    const y = e.clientY - r.top;
    if (y < RULER_H) return 'ruler';
    return y < RULER_H + (r.height - RULER_H) / 2 ? 'tabla' : 'lehra';
  }
  const timeAt = e => { const r = canvas.getBoundingClientRect(); return tOf(e.clientX - r.left, r.width); };

  function seek(t) {
    t = Math.max(0, Math.min(dur(), t));
    if (playing) startAt(t); else from = t;
    draw(); status();
  }

  canvas.addEventListener('pointerdown', e => {
    if (!tabla || !lehra) return;
    canvas.setPointerCapture(e.pointerId);
    press = { lane: laneAt(e), x: e.clientX, t: timeAt(e), offset, from: view.from, moved: false };
    canvas.focus({ preventScroll: true });
  });
  canvas.addEventListener('pointermove', e => {
    if (!press) return;
    const r = canvas.getBoundingClientRect();
    const dx = e.clientX - press.x;
    if (!press.moved && Math.abs(dx) < DRAG_PX) return;
    press.moved = true;
    const ds = (dx / r.width) * view.span;
    if (press.lane === 'lehra') {
      offset = press.offset + ds;           // wrapped when the drag ends, so the lehra doesn't jump under the pointer
      draw(); status();
    } else if (press.lane === 'tabla') {
      view.from = press.from - ds;
      clampView(); draw();
    } else {
      seek(timeAt(e));
    }
  });
  const release = e => {
    if (!press) return;
    const p = press;
    press = null;
    if (p.moved) {
      if (p.lane === 'lehra') setOffset(offset);
      return;
    }
    if (e.type === 'pointerup') seek(p.t);
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('dblclick', e => {
    const lane = laneAt(e), t = timeAt(e);
    if (lane === 'tabla') markTabla(t);
    else if (lane === 'lehra') markLehra(lehraTime(t, offset, period()));
  });
  canvas.addEventListener('wheel', e => {
    if (!tabla) return;
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      zoomAround(timeAt(e), Math.exp(e.deltaY * 0.0025));
    } else {
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      view.from += (d / canvas.getBoundingClientRect().width) * view.span;
      clampView(); draw();
    }
  }, { passive: false });
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => draw()).observe(lanes);

  // ── marking and lining up ──────────────────────────────────────────────────
  function markTabla(t) {
    tablaSam = snapToOnset(tabla.getChannelData(0), tabla.sampleRate, Math.max(0, Math.min(dur(), t)));
    draw(); status();
  }
  function markLehra(u) {
    lehraSam = snapToOnset(lehra.getChannelData(0), lehra.sampleRate, u);
    draw(); status();
  }
  function lineUp() {
    if (tablaSam === null || lehraSam === null) return;
    setOffset(offsetForSams(tablaSam, lehraSam, period()));
    focus(tablaSam);
    seek(Math.max(0, tablaSam - 2));
  }
  const atPlayhead = () => position() - (playing ? outputLatency() : 0);

  // ── the synced mix, rendered here ──────────────────────────────────────────
  async function downloadMix() {
    const button = ui('download');
    button.disabled = true;
    const was = button.textContent;
    button.textContent = 'Rendering…';
    try {
      const sr = tabla.sampleRate;
      const frames = Math.ceil(dur() * sr);
      const off = new OfflineAudioContext(2, frames, sr);
      const t = off.createBufferSource();
      t.buffer = tabla;
      const tg = off.createGain(); tg.gain.value = tablaGain();
      t.connect(tg); tg.connect(off.destination);
      t.start(0);
      const l = off.createBufferSource();
      l.buffer = lehra; l.loop = true;
      const lg = off.createGain(); lg.gain.value = lehraGain();
      l.connect(lg); lg.connect(off.destination);
      l.start(0, lehraTime(0, offset, period()));
      const out = await off.startRendering();
      const chans = [out.getChannelData(0), out.getChannelData(1)];
      const peak = peakOf(chans);
      const limit = 10 ** (-1 / 20);                 // keep a mix that would clip at −1 dBFS
      if (peak > limit) for (const ch of chans) for (let i = 0; i < ch.length; i++) ch[i] *= limit / peak;
      const blob = new Blob([wavHeader(frames, 2, sr), toPcm16(chans)], { type: 'audio/wav' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${tablaName.replace(/\.[^.]+$/, '')}-with-lehra-synced.wav`;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    } catch (err) {
      ui('gap').textContent = `The mix could not be made here: ${err.message}`;
    } finally {
      button.disabled = false;
      button.textContent = was;
    }
  }

  // ── controls ───────────────────────────────────────────────────────────────
  ui('play').addEventListener('click', () => (playing ? stop() : play()));
  ui('zoom').addEventListener('input', e => zoomTo(+e.target.value));
  ui('fit').addEventListener('click', () => { view = { from: 0, span: Math.max(dur(), MIN_VIEW) }; clampView(); draw(); });
  ui('markTabla').addEventListener('click', () => markTabla(atPlayhead()));
  ui('markLehra').addEventListener('click', () => markLehra(lehraTime(atPlayhead(), offset, period())));
  ui('showTabla').addEventListener('click', () => { if (tablaSam !== null) focus(tablaSam); });
  ui('lineUp').addEventListener('click', lineUp);
  ui('offset').addEventListener('change', e => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) setOffset(v); else status(); });
  for (const b of overlay.querySelectorAll('[data-nudge]')) b.addEventListener('click', () => setOffset(offset + (+b.dataset.nudge) / 1000));
  ui('beats').addEventListener('input', readCycle);
  ui('bpm').addEventListener('input', readCycle);
  ui('lehraDb').addEventListener('input', e => { lehraDb = +e.target.value; levels(); status(); });
  ui('tablaDb').addEventListener('input', e => { tablaGainDb = +e.target.value; levels(); status(); });
  ui('muteTabla').addEventListener('click', () => { muteTabla = !muteTabla; levels(); draw(); status(); });
  ui('muteLehra').addEventListener('click', () => { muteLehra = !muteLehra; levels(); draw(); status(); });
  ui('download').addEventListener('click', downloadMix);
  ui('apply').addEventListener('click', () => {
    onApply({ offset, lehraDb });
    close();
  });

  function readCycle() {
    const beats = parseFloat(ui('beats').value), bpm = parseFloat(ui('bpm').value);
    cycle = beats > 0 && bpm > 0 ? beats * 60 / bpm : null;
    draw(); status();
  }

  overlay.addEventListener('keydown', e => {
    if (!overlay.classList.contains('active') || !tabla) return;
    if (e.target.closest('input, select, textarea') && e.key !== 'Escape') return;
    const k = e.key;
    if (k === ' ') { e.preventDefault(); (playing ? stop : play)(); }
    else if (k === 'ArrowLeft' || k === 'ArrowRight') { e.preventDefault(); setOffset(offset + (k === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 10 : 1) / 1000); }
    else if (k === 't' || k === 'T') markTabla(atPlayhead());
    else if (k === 'l' || k === 'L') markLehra(lehraTime(atPlayhead(), offset, period()));
    else if (k === 'a' || k === 'A') lineUp();
    else if (k === '+' || k === '=') zoomAround(playing ? position() : view.from + view.span / 2, 0.6);
    else if (k === '-' || k === '_') zoomAround(playing ? position() : view.from + view.span / 2, 1 / 0.6);
  });

  // closing (Escape, backdrop, ×) stops the sound
  new MutationObserver(() => { if (!overlay.classList.contains('active')) stop(); })
    .observe(overlay, { attributes: true, attributeFilter: ['class'] });

  function close() { overlay.classList.remove('active'); }

  return {
    /**
     * Opens the editor on two decoded recordings. `start.offset` is the
     * current offset (null = none chosen yet), `start.cycle` the taal cycle
     * when the page knows it (a Swaralaya lehra, which starts on sam).
     */
    open({ tablaBuffer, lehraBuffer, names = {}, start = {} }) {
      stop();
      tabla = tablaBuffer; lehra = lehraBuffer;
      tablaName = names.tabla || 'tabla'; lehraName = names.lehra || 'lehra';
      tablaRms = rmsDb(tabla); lehraRms = rmsDb(lehra);
      lehraDb = Number.isFinite(start.lehraDb) ? start.lehraDb : -7;
      ui('lehraDb').value = String(lehraDb);
      offset = Number.isFinite(start.offset) ? wrapOffset(start.offset, period()) : 0;
      from = 0;
      // the taal cycle: a Swaralaya lehra's own, else what a Lehra Player download's name says
      const named = lehraFromName(lehraName, catalogueTaals()) || {};
      const beats = start.beats || named.beats || null, bpm = start.bpm || named.bpm || null;
      ui('beats').value = beats ? String(beats) : '';
      ui('bpm').value = bpm ? String(bpm) : '';
      cycle = beats && bpm ? beats * 60 / bpm : null;
      // both start on sam: the lehra's sam is its first stroke
      lehraSam = cycle ? snapToOnset(lehra.getChannelData(0), lehra.sampleRate, 0.02, 0.06) : null;
      tablaSam = null;
      ui('tablaName').textContent = tablaName;
      ui('lehraName').textContent = lehraName;
      overlay.classList.add('active');
      view = { from: 0, span: Math.min(Math.max(dur(), MIN_VIEW), 12) };
      clampView();
      requestAnimationFrame(() => { draw(); status(); canvas.focus({ preventScroll: true }); });
      status();
    },
    close,
    state: () => ({ offset, tablaSam, lehraSam, cycle, view: { ...view }, playing }),
  };
}
