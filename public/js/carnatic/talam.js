/**
 * Talam metronome: its own lookahead scheduler (a worker timer, so it keeps
 * time in a background tab) on the shared AudioContext, with a distinct
 * synthesised sound per kriya — clap, wave, finger count — optional nadai
 * (gati) subdivisions, and the angas drawn with the current beat lit.
 */
import { $ } from '../core/dom.js';
import { getAudioContext } from '../core/audio-context.js';
import { outputLatency } from '../core/audio-output.js';
import { kriyaLabel, talaStructure } from './talas.js';

const AHEAD_SEC = 0.12;
const TICK_MS = 25;

let out = null;
let timer = null;
let running = false;
let structure = null;
let bpm = 80;
let nadai = 1;
let nextTime = 0;
let beat = 0;
let sub = 0;
let cycle = 0;
let queue = [];     // { time, beat, cycle } for the display
let raf = 0;
let cells = [];

export function setTalamOutput(node) {
  out = node;
}

// ── Sounds ─────────────────────────────────────────────────────────
let noiseBuf = null;
function noise(ctx) {
  if (!noiseBuf || noiseBuf.sampleRate !== ctx.sampleRate) {
    noiseBuf = ctx.createBuffer(1, Math.round(ctx.sampleRate * 0.2), ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    let s = 99;
    for (let i = 0; i < d.length; i++) { s = (s * 1103515245 + 12345) >>> 0; d[i] = s / 2147483648 - 1; }
  }
  return noiseBuf;
}

function burst(ctx, t, { type, freq, q = 1, level, attack = 0.001, len }) {
  const src = ctx.createBufferSource();
  src.buffer = noise(ctx);
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(level, t + attack);
  g.gain.exponentialRampToValueAtTime(0.001, t + len);
  src.connect(f);
  f.connect(g);
  g.connect(out);
  src.start(t);
  src.stop(t + len + 0.02);
}

function tone(ctx, t, freq, level, len) {
  const o = ctx.createOscillator();
  o.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(level, t + 0.001);
  g.gain.exponentialRampToValueAtTime(0.001, t + len);
  o.connect(g);
  g.connect(out);
  o.start(t);
  o.stop(t + len + 0.02);
}

/** The sound of one kriya at time t (sam louder). */
export function playKriya(ctx, b, t, sam) {
  switch (b.kind) {
    case 'clap':
      burst(ctx, t, { type: 'bandpass', freq: 1400, q: 0.9, level: sam ? 1 : 0.75, len: 0.07 });
      tone(ctx, t, sam ? 180 : 220, sam ? 0.5 : 0.3, 0.03);
      break;
    case 'wave':
      burst(ctx, t, { type: 'lowpass', freq: 650, q: 0.7, level: 0.45, attack: 0.015, len: 0.13 });
      break;
    case 'finger':
      tone(ctx, t, 1800, 0.28, 0.03);
      break;
    case 'count':
      tone(ctx, t, 1200, 0.14, 0.02);
      break;
    default: // hold: silent
      break;
  }
}

// ── Scheduler ──────────────────────────────────────────────────────
function tick() {
  if (!running) return;
  const ctx = getAudioContext();
  const horizon = ctx.currentTime + AHEAD_SEC;
  if (nextTime < ctx.currentTime - 0.1) nextTime = ctx.currentTime + 0.02; // tab was frozen: don't burst
  while (nextTime < horizon) {
    if (sub === 0) {
      playKriya(ctx, structure.beats[beat], nextTime, beat === 0);
      queue.push({ time: nextTime, beat, cycle });
      if (queue.length > 64) queue.shift();
    } else {
      tone(ctx, nextTime, 2600, 0.07, 0.012); // nadai subdivision
    }
    nextTime += 60 / bpm / nadai;
    if (++sub >= nadai) {
      sub = 0;
      if (++beat >= structure.beats.length) { beat = 0; cycle++; }
    }
  }
}

function worker() {
  if (!timer) {
    const code = `let id=null;onmessage=e=>{if(e.data==='start'){clearInterval(id);id=setInterval(()=>postMessage('t'),${TICK_MS});}else{clearInterval(id);id=null;}};`;
    timer = new Worker(URL.createObjectURL(new Blob([code], { type: 'application/javascript' })));
    timer.onmessage = tick;
  }
  return timer;
}

export function startTalam() {
  if (running || !structure) return;
  const ctx = getAudioContext();
  running = true;
  beat = 0; sub = 0; cycle = 0; queue = [];
  nextTime = ctx.currentTime + 0.06;
  worker().postMessage('start');
  tick();
  raf = requestAnimationFrame(draw);
}

export function stopTalam() {
  if (!running) return;
  running = false;
  if (timer) timer.postMessage('stop');
  cancelAnimationFrame(raf);
  queue = [];
  light(-1);
  $('talamNow').textContent = '—';
  $('talamCount').textContent = '';
}

export function talamRunning() {
  return running;
}

export function setTalamTempo(v) {
  bpm = v;
}

export function setNadai(n) {
  nadai = n;
  sub = 0;
}

/** Show (and, if running, switch to at the next beat, from sam) a tala. */
export function setTala(def, kalai) {
  structure = talaStructure(def, kalai);
  beat = 0; sub = 0; cycle = 0; queue = [];
  renderTala();
}

// ── Display ────────────────────────────────────────────────────────
function renderTala() {
  $('talamName').textContent = structure.name;
  $('talamNotation').textContent = `${structure.notation} · ${structure.beats.length} aksharas`;
  const wrap = $('talamAngas');
  wrap.innerHTML = '';
  cells = [];
  structure.angas.forEach(anga => {
    const box = document.createElement('div');
    box.className = 'anga';
    const sym = document.createElement('div');
    sym.className = 'anga-symbol';
    sym.textContent = anga.symbol;
    const row = document.createElement('div');
    row.className = 'anga-beats';
    for (let i = anga.start; i < anga.start + anga.length; i++) {
      const b = structure.beats[i];
      const cell = document.createElement('div');
      cell.className = `kriya kriya-${b.kind}${i === 0 ? ' sam' : ''}`;
      cell.title = kriyaLabel(b);
      const n = document.createElement('span');
      n.className = 'kriya-num';
      n.textContent = i + 1;
      const label = document.createElement('span');
      label.className = 'kriya-label';
      label.textContent = b.kind === 'finger' ? b.finger : b.kind === 'count' ? '·' : b.kind === 'hold' ? '–' : kriyaLabel(b).toLowerCase();
      cell.append(n, label);
      row.appendChild(cell);
      cells.push(cell);
    }
    box.append(sym, row);
    wrap.appendChild(box);
  });
}

function light(i) {
  cells.forEach((c, k) => c.classList.toggle('active', k === i));
}

function draw() {
  if (!running) return;
  const now = getAudioContext().currentTime - outputLatency();
  let current = null;
  while (queue.length && queue[0].time <= now) current = queue.shift();
  if (current) {
    light(current.beat);
    const b = structure.beats[current.beat];
    $('talamNow').textContent = kriyaLabel(b);
    $('talamNow').className = `talam-now kriya-${b.kind}${current.beat === 0 ? ' sam' : ''}`;
    $('talamCount').textContent = `Beat ${current.beat + 1} / ${structure.beats.length} · Avartanam ${current.cycle + 1}`;
  }
  raf = requestAnimationFrame(draw);
}
