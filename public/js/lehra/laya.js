/**
 * Laya trainer: ramps the tempo from a start to a target BPM by `step`
 * every N taal cycles. Cycles are counted on the engine's own musical clock
 * (cycle = floor(beat / beats)), so each change lands on sam. It stops at
 * the target, and is cancelled by a manual tempo change or by pausing /
 * stopping playback.
 */
import { $ } from '../core/dom.js';
import { togglePlay } from './player.js';
import { onClockTick } from './scheduler.js';
import { changeTempo } from './selection.js';
import { persistControl } from './settings.js';
import { on, state } from './state.js';

/** Tempo after `cyclesDone` whole cycles of the ramp { start, target, step, every }. */
export function layaTempo({ start, target, step, every }, cyclesDone) {
  const dir = Math.sign(target - start);
  const bpm = start + dir * Math.floor(Math.max(0, cyclesDone) / every) * step;
  return dir > 0 ? Math.min(bpm, target) : Math.max(bpm, target);
}

let run = null; // { start, target, step, every, expected, base, taal }

function readInt(id, fallback) {
  const v = parseInt($(id).value, 10);
  return Number.isFinite(v) ? v : fallback;
}

function render(text) {
  $('ltBtn').textContent = run ? 'Stop' : 'Start';
  $('ltBtn').classList.toggle('active', !!run);
  const bar = $('ltBar');
  if (run) {
    const span = Math.abs(run.target - run.start);
    bar.style.width = (span ? Math.abs(run.expected - run.start) / span * 100 : 100).toFixed(1) + '%';
  }
  if (text !== undefined) $('ltStatus').textContent = text;
}

function cancel(reason) {
  if (!run) return;
  run = null;
  render(reason);
}

function begin() {
  if (!state.taalData || !state.raag) {
    render('Select instrument → taal → raag first.');
    return;
  }
  const { minTempo, maxTempo } = state.taalData;
  const clamp = v => Math.max(minTempo, Math.min(maxTempo, v));
  const plan = {
    start: clamp(readInt('ltStart', state.bpm)),
    target: clamp(readInt('ltTarget', state.bpm)),
    step: Math.max(1, Math.abs(readInt('ltStep', 5))),
    every: Math.max(1, readInt('ltEvery', 2)),
  };
  $('ltStart').value = plan.start;
  $('ltTarget').value = plan.target;
  $('ltStep').value = plan.step;
  $('ltEvery').value = plan.every;
  if (plan.start === plan.target) {
    render(`Start and target are the same (this taal plays ${minTempo}–${maxTempo} BPM).`);
    return;
  }
  changeTempo(plan.start);
  run = { ...plan, expected: state.bpm, base: null, taal: null };
  render(`Starting at ${plan.start} BPM…`);
  if (!state.isPlaying) togglePlay();
}

function onTick(beat) {
  if (!run || !state.playingTaal) return;
  if (state.bpm !== run.expected) {
    cancel(`Trainer stopped: tempo changed by hand (${state.bpm} BPM).`);
    return;
  }
  if (beat < 0) return; // count-in
  const beats = state.playingTaal.beats;
  const cycle = Math.floor(beat / beats + 1e-9);
  if (run.base === null || run.taal !== state.playingTaal) {
    // Count whole cycles from the next sam (or this one, if it just passed);
    // after a taal change, keep the steps already made.
    const made = Math.round(Math.abs(run.expected - run.start) / run.step);
    run.base = Math.ceil(beat / beats - 0.05) - made * run.every;
    run.taal = state.playingTaal;
  }
  const done = cycle - run.base;
  const bpm = layaTempo(run, done);
  if (bpm !== run.expected) {
    changeTempo(bpm);
    run.expected = state.bpm;
  }
  if (run.expected === run.target) {
    run = null;
    render(`Target ${state.bpm} BPM reached — keep going!`);
    $('ltBar').style.width = '100%';
    return;
  }
  const steps = Math.floor(Math.max(0, done) / run.every);
  const left = (steps + 1) * run.every - done;
  render(`${run.expected} BPM → ${run.target} · next ${run.target > run.start ? '+' : '−'}${run.step} in ${left} cycle${left === 1 ? '' : 's'}`);
}

export function initLayaTrainer() {
  ['ltStart', 'ltTarget', 'ltStep', 'ltEvery'].forEach(id => persistControl(id));
  $('ltBtn').addEventListener('click', () => (run ? cancel('Trainer stopped.') : begin()));
  onClockTick(onTick);
  on('playback', s => { if (s !== 'playing') cancel('Trainer stopped with playback.'); });
  render('');
}
