/**
 * Practice timer: stop after N minutes or N taal cycles, always finishing
 * exactly at sam. It uses the engine's loop-off mechanism — once loop is
 * off, the worklet fades out so the audio ends precisely at the end of the
 * current cycle — switched off during the cycle that should be the last.
 */
import { $ } from '../core/dom.js';
import { audio } from './audio.js';
import { onClockTick } from './scheduler.js';
import { persistControl } from './settings.js';
import { on, state } from './state.js';

// Loop-off must reach the engine before its 40 ms end fade begins; closer
// to sam than this, wait for the next cycle.
export const MIN_LEAD_SEC = 0.15;

/**
 * Whether to switch loop off now so playback ends on the right sam.
 * plan = { unit: 'min' | 'cycles', amount }; clock = { beat, beats, bpm,
 * elapsed } with `elapsed` seconds since the first sam.
 */
export function shouldEndNow(plan, { beat, beats, bpm, elapsed }) {
  if (beat < 0) return false; // count-in
  const cycle = Math.floor(beat / beats + 1e-9);
  const toNextSam = ((cycle + 1) * beats - beat) * 60 / bpm;
  if (toNextSam < MIN_LEAD_SEC) return false;
  if (plan.unit === 'cycles') return cycle >= plan.amount - 1;
  if (plan.unit === 'min') return elapsed >= plan.amount * 60;
  return false;
}

let session = null; // { plan, samTime, ending }
let samTime = 0;    // context time of the current play's first sam

function plan() {
  const unit = $('ptUnit').value;
  const amount = Math.max(1, parseInt($('ptAmount').value, 10) || 1);
  return unit === 'off' ? null : { unit, amount };
}

function fmt(sec) {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function show(fraction, text) {
  $('ptBar').style.width = (Math.max(0, Math.min(1, fraction)) * 100).toFixed(1) + '%';
  $('ptStatus').textContent = text;
}

function describe(p) {
  return p.unit === 'min' ? `${p.amount} min` : `${p.amount} cycle${p.amount === 1 ? '' : 's'}`;
}

function startSession() {
  const p = plan();
  session = p ? { plan: p, samTime, ending: false } : null;
  if (session) show(0, `Stops at sam after ${describe(p)}.`);
}

function onTick(beat, now) {
  if (!session || !state.playingTaal) return;
  const { plan: p } = session;
  const beats = state.playingTaal.beats;
  const elapsed = now - session.samTime;
  if (!session.ending && shouldEndNow(p, { beat, beats, bpm: state.bpm, elapsed })) {
    session.ending = true;
    audio.engine.setParams({ loop: false }); // state.isLooping is untouched: the next play loops again
  }
  if (beat < 0) return;
  if (p.unit === 'min') {
    show(elapsed / (p.amount * 60), session.ending ? 'Time is up — finishing on sam…' : `${fmt(p.amount * 60 - elapsed)} left`);
  } else {
    const cycle = Math.min(p.amount, Math.floor(beat / beats + 1e-9) + 1);
    show(beat / (p.amount * beats), `Cycle ${cycle} of ${p.amount}${session.ending ? ' — last one' : ''}`);
  }
}

function onPlayback(s) {
  if (s === 'playing') {
    samTime = audio.engine.timeOfBeat(0); // just started: the clock is exact
    startSession();
    return;
  }
  if (s === 'ended' && session?.ending) {
    show(1, `Done: ${describe(session.plan)} of riyaz, ended on sam.`);
  } else if (session) {
    show(0, '');
  }
  session = null;
}

export function initPracticeTimer() {
  persistControl('ptUnit');
  persistControl('ptAmount');
  onClockTick(onTick);
  on('playback', onPlayback);
  // Changing the plan mid-play applies to the current session.
  const replan = () => {
    if (!state.isPlaying || session?.ending) return;
    const p = plan();
    if (!p) { session = null; show(0, ''); return; }
    session = { plan: p, samTime, ending: false };
  };
  $('ptUnit').addEventListener('change', replan);
  $('ptAmount').addEventListener('change', replan);
}
