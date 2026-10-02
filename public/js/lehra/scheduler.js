/**
 * Metronome ticks and the beat/matra display, scheduled against the engine's
 * own musical clock (beat ↔ audio time), so they stay locked to the lehra
 * through live tempo changes and switches between recordings.
 */
import { $ } from '../core/dom.js';
import { outputLatency } from '../core/audio-output.js';
import { audio } from './audio.js';
import { emit, state } from './state.js';
import { scheduleMetronome } from './metronome.js';
import { matraRole, thekaMatras } from './theka.js';

const SCHEDULE_AHEAD_SEC = 0.1;

let timerWorker = null;
const tickListeners = [];
let schedLastBeat = null;   // cumulative beat of the last scheduled (sub-)tick
let notesInQueue = [];
let drawBeatLoopFrame = null;
// Cached beat dot and theka bol elements (no DOM queries in the 60 fps loop)
let beatDotEls = [];
let thekaEls = [];

// A worker's setInterval keeps ticking when the tab is in the background.
function timer() {
  if (!timerWorker) {
    const workerCode = `
      let timerID = null;
      self.onmessage = function(e) {
        if (e.data === "start") {
          timerID = setInterval(function() { postMessage("tick"); }, 25);
        } else if (e.data === "stop") {
          clearInterval(timerID);
          timerID = null;
        }
      };
    `;
    const blob = new Blob([workerCode], { type: 'application/javascript' });
    timerWorker = new Worker(URL.createObjectURL(blob));
    timerWorker.onmessage = e => { if (e.data === 'tick') schedulerTick(); };
  }
  return timerWorker;
}

/**
 * fn(beat, now) on every scheduler tick (~25 ms) while the lehra plays:
 * `beat` is the engine's cumulative beat at context time `now`.
 */
export function onClockTick(fn) {
  tickListeners.push(fn);
}

export function schedulerTick() {
  const engine = audio.engine, ctx = audio.ctx;
  if (!state.isPlaying || !state.playingTaal || !engine || !ctx) return;
  const subDiv = state.metronomeSubdivision || 1;
  const now = ctx.currentTime;
  const horizon = now + SCHEDULE_AHEAD_SEC;
  const beatNow = engine.beatAt(now);
  if (beatNow !== null) tickListeners.forEach(fn => fn(beatNow, now));
  if (!state.isPlaying) return; // a listener may have stopped playback

  let k;
  if (schedLastBeat === null) {
    const b = engine.beatAt(now);
    if (b === null) return;
    // Nothing before sam, except the count-in's beats (negative).
    k = Math.max(-state.countInBeats * subDiv, Math.ceil(b * subDiv - 1e-6));
  } else {
    k = Math.floor(schedLastBeat * subDiv + 1e-6) + 1;
  }

  for (let guard = 0; guard < 64; guard++, k++) {
    const beat = k / subDiv;
    const t = engine.timeOfBeat(beat);
    if (t === null || t > horizon) break;
    if (t < now - 0.03) {
      // Fell behind (throttled tab, or the cycle restarted): skip ahead.
      const b = engine.beatAt(now);
      schedLastBeat = (Math.ceil(b * subDiv - 1e-6) - 1) / subDiv;
      k = Math.round(schedLastBeat * subDiv);
      continue;
    }
    schedLastBeat = beat;
    const n = state.playingTaal.beats;
    const beatInCycle = (Math.floor(beat + 1e-6) % n + n) % n;
    scheduleNote(beatInCycle, (k % subDiv + subDiv) % subDiv, Math.max(t, now), beat < -1e-6);
  }
}

function scheduleNote(beatNumber, subBeat, time, countIn) {
  if (subBeat === 0) {
    notesInQueue.push({ note: beatNumber, time: time });
    // A hidden tab pauses drawBeatLoop (rAF) while ticks keep being scheduled.
    if (notesInQueue.length > 64) notesInQueue.splice(0, notesInQueue.length - 64);
  }
  scheduleMetronome(time, beatNumber, subBeat, countIn);
}

export function startScheduler() {
  if (!audio.ctx) return;
  stopScheduler();
  notesInQueue = [];
  schedLastBeat = null;
  timer().postMessage('start');
  if (!drawBeatLoopFrame) drawBeatLoopFrame = requestAnimationFrame(drawBeatLoop);
}

export function stopScheduler() {
  if (timerWorker) timerWorker.postMessage('stop');
  if (drawBeatLoopFrame) { cancelAnimationFrame(drawBeatLoopFrame); drawBeatLoopFrame = null; }
  beatDotEls.forEach(d => d.classList.remove('active'));
  thekaEls.forEach(b => b.classList.remove('active'));
}

/** The cycle restarted (new taal): schedule from the engine's next report. */
export function resyncScheduler() {
  schedLastBeat = null;
}

function drawBeatLoop() {
  if (!state.isPlaying) {
    drawBeatLoopFrame = null;
    return;
  }

  let currentNote = -1;
  // Light each beat when it is heard, not when it is rendered.
  const currentTime = audio.ctx.currentTime - outputLatency();
  while (notesInQueue.length && notesInQueue[0].time <= currentTime) {
    currentNote = notesInQueue[0].note;
    notesInQueue.splice(0, 1);
  }

  if (currentNote !== -1) {
    state.beatIndex = currentNote;
    flashBeat();
    state.matraCount = currentNote + 1;
    updateMatraDisplay(state.matraCount, (state.playingTaal || state.taalData).beats);
  }

  drawBeatLoopFrame = requestAnimationFrame(drawBeatLoop);
}

function flashBeat() {
  beatDotEls.forEach(d => d.classList.remove('active'));
  if (beatDotEls[state.beatIndex]) beatDotEls[state.beatIndex].classList.add('active');
  thekaEls.forEach(b => b.classList.remove('active'));
  if (thekaEls[state.beatIndex]) thekaEls[state.beatIndex].classList.add('active');
}

export function renderBeatDots(beats) {
  const c = $('beatDots');
  c.innerHTML = '';
  state.beatIndex = 0;
  beatDotEls = [];
  for (let i = 0; i < beats; i++) {
    const d = document.createElement('div');
    const matra = i + 1;
    const role = state.taalData ? matraRole(state.taalData, matra) : (matra === 1 ? 'sam' : null);
    d.className = 'beat-dot' + (role ? ' ' + role : '');
    d.id = `bd-${i}`;
    c.appendChild(d);
    beatDotEls.push(d);
  }
  renderTheka(beats ? state.taalData : null);
}

/** The taal's theka under the beat dots, grouped in vibhags with their X/2/0/3 markers. */
function renderTheka(taal) {
  const row = $('thekaRow');
  thekaEls = [];
  if (!row) return;
  row.innerHTML = '';
  const matras = taal && thekaMatras(taal);
  row.hidden = !matras;
  if (!matras) return;
  let bols = null;
  for (const m of matras) {
    if (m.marker || !bols) {
      const vibhag = document.createElement('div');
      vibhag.className = 'theka-vibhag';
      const marker = document.createElement('span');
      marker.className = 'theka-marker';
      marker.textContent = m.marker;
      bols = document.createElement('div');
      bols.className = 'theka-bols';
      vibhag.append(marker, bols);
      row.appendChild(vibhag);
    }
    const b = document.createElement('span');
    b.className = 'theka-bol';
    b.textContent = m.bol;
    bols.appendChild(b);
    thekaEls.push(b);
  }
}

export function updateMatraDisplay(matra, total) {
  emit('matra', matra, total);
  const el = $('matraCounter');
  if (!el) return;
  el.textContent = matra > 0 ? matra : '—';
  el.classList.toggle('sam', matra === 1 && total > 0);
}

export function showMatraRow(show) {
  const row = $('matraRow');
  if (row) row.style.display = show ? '' : 'none';
}
