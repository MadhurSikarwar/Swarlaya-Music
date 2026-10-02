/**
 * Swar Pehchaan — name the swar. A drone holds Sa (the Lehra player's Sa);
 * the game sings a swar and you find it on a harmonium-style keyboard.
 * Three lives; every 5 right answers adds swaras (rules.js SWAR_LEVELS).
 */
import { $ } from '../core/dom.js';
import { getAudioContext } from '../core/audio-context.js';
import { getMasterOutput } from '../core/audio-output.js';
import { playSwar } from '../notation/synth.js';
import { state as lehraState } from '../lehra/state.js';
import {
  LIVES, SWAR_LEVELS, multiplier, nextQuestion, swarById, swarHz, swarLabel, swarLevel,
  swarPoints, trickiest,
} from './rules.js';
import { loadProgress, saveProgress } from './store.js';

const NOTE_SEC = 1.3;
const INTRO = 'A drone plays Sa; then listen for the mystery swar and find it on the keyboard.';
const WHITE = ['S', 'R', 'G', 'M', 'P', 'D', 'N'];
// Black keys sit on the boundary after this many white keys (like a harmonium)
const BLACK = { r: 1, g: 2, m: 4, d: 5, n: 6 };
const KEYS = { s: 'S', r: 'R', g: 'G', m: 'M', p: 'P', d: 'D', n: 'N' };
const SHIFT_KEYS = { r: 'r', g: 'g', m: 'm', d: 'd', n: 'n' };

let out = null;     // the game's output gain
let drone = null;   // { gain, stop(t) }
let game = null;    // the round in progress
let timers = [];

const sa = () => lehraState.pitchHz;

function output() {
  const ctx = getAudioContext();
  if (!out) {
    out = ctx.createGain();
    out.gain.value = 0.9;
    out.connect(getMasterOutput());
  }
  return out;
}

/** A soft shruti-box drone: mandra Sa, mandra Pa and Sa, each a pair of detuned reeds. */
function startDrone() {
  const ctx = getAudioContext();
  const t = ctx.currentTime;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(1, t + 0.8);
  const tone = ctx.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.value = 1400;
  tone.connect(gain);
  gain.connect(output());
  const oscs = [];
  for (const [ratio, level] of [[0.5, 0.07], [0.75, 0.05], [1, 0.06]]) {
    for (const cents of [-5, 5]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = sa() * ratio;
      o.detune.value = cents;
      const g = ctx.createGain();
      g.gain.value = level;
      o.connect(g);
      g.connect(tone);
      o.start(t);
      oscs.push(o);
    }
  }
  drone = {
    gain,
    stop(at) {
      gain.gain.cancelScheduledValues(at);
      gain.gain.setValueAtTime(gain.gain.value, at);
      gain.gain.linearRampToValueAtTime(0, at + 0.5);
      oscs.forEach(o => o.stop(at + 0.6));
    },
  };
}

function stopDrone() {
  if (drone) drone.stop(getAudioContext().currentTime);
  drone = null;
}

function sing(hz, delay = 0, dur = NOTE_SEC) {
  const ctx = getAudioContext();
  playSwar(ctx, output(), hz, ctx.currentTime + 0.05 + delay, dur);
}

function later(fn, ms) {
  timers.push(setTimeout(fn, ms));
}

function clearTimers() {
  timers.forEach(clearTimeout);
  timers = [];
}

// ── Keyboard ─────────────────────────────────────────────────────────
function buildKeys() {
  const wrap = $('swKeys');
  wrap.innerHTML = '';
  const make = (s, cls) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `swar-key ${cls}`;
    b.dataset.swar = s.id;
    b.setAttribute('aria-label', swarLabel(s));
    b.innerHTML = `<span class="swar-key-name">${s.name}</span>${s.q ? `<span class="swar-key-q">${s.q}</span>` : ''}`;
    b.addEventListener('click', () => answer(s.id));
    return b;
  };
  for (const id of WHITE) wrap.appendChild(make(swarById(id), 'white'));
  for (const [id, at] of Object.entries(BLACK)) {
    const k = make(swarById(id), 'black');
    k.style.setProperty('--at', at);
    wrap.appendChild(k);
  }
}

function showPool(level) {
  const pool = new Set(SWAR_LEVELS[level].pool);
  document.querySelectorAll('#swKeys .swar-key').forEach(k => {
    const on = pool.has(k.dataset.swar);
    k.disabled = !on;
    k.classList.remove('right', 'wrong');
  });
}

function flashKey(id, cls) {
  const k = document.querySelector(`#swKeys .swar-key[data-swar="${id}"]`);
  if (k) k.classList.add(cls);
}

// ── Game ─────────────────────────────────────────────────────────────
function hud() {
  $('swScore').textContent = game.score;
  $('swLevel').textContent = `${game.level + 1} · ${SWAR_LEVELS[game.level].name}`;
  $('swStreak').textContent = `×${multiplier(game.streak)}`;
  $('swLives').textContent = '♥'.repeat(game.lives) + '♡'.repeat(LIVES - game.lives);
  $('swLives').setAttribute('aria-label', `${game.lives} of ${LIVES} lives`);
}

function prompt(text) {
  $('swPrompt').textContent = text;
}

function ask() {
  if (!game) return;
  game.question = nextQuestion(game.level, game.question?.id);
  game.locked = false;
  showPool(game.level);
  $('swOrb').classList.remove('right', 'wrong');
  $('swOrb').textContent = '?';
  prompt('Which swar is this?');
  replay();
}

function replay() {
  if (!game || !game.question) return;
  game.askedAt ??= performance.now();
  if (game.locked) return;
  $('swOrb').classList.remove('pulse');
  void $('swOrb').offsetWidth;
  $('swOrb').classList.add('pulse');
  sing(swarHz(sa(), game.question));
}

function answer(id) {
  if (!game || game.locked || !game.question) return;
  game.locked = true;
  const q = game.question;
  const secs = (performance.now() - (game.askedAt ?? performance.now())) / 1000;
  game.askedAt = null;
  const right = id === q.id;
  const s = swarById(q.id);
  $('swOrb').textContent = s.name;

  if (right) {
    const pts = swarPoints(secs, game.streak);
    game.score += pts;
    game.streak++;
    game.correct++;
    flashKey(id, 'right');
    $('swOrb').classList.add('right');
    const levelBefore = game.level;
    game.level = swarLevel(game.correct);
    const up = game.level > levelBefore;
    prompt(up ? `+${pts} · Level up! ${SWAR_LEVELS[game.level].name}` : `${swarLabel(s)} — +${pts}`);
    hud();
    later(ask, up ? 1600 : 900);
  } else {
    game.streak = 0;
    game.lives--;
    game.mistakes.push({ asked: q.id, answered: id });
    flashKey(id, 'wrong');
    flashKey(q.id, 'right');
    $('swOrb').classList.add('wrong');
    prompt(`It was ${swarLabel(s)} — you chose ${swarLabel(swarById(id))}. Listen to both…`);
    hud();
    // The right swar, then the one chosen (same octave), to compare
    sing(swarHz(sa(), q), 0.1, 0.9);
    sing(swarHz(sa(), { id, octave: q.octave }), 1.1, 0.9);
    later(game.lives > 0 ? ask : finish, 2600);
  }
}

function finish() {
  if (!game) return;
  const g = game;
  game = null;
  clearTimers();
  stopDrone();
  $('swStart').textContent = 'Start';
  const progress = loadProgress();
  const best = g.score > (progress.swarBest || 0);
  if (best) {
    progress.swarBest = g.score;
    saveProgress(progress);
  }
  $('swPlay').hidden = true;
  $('swResults').hidden = false;
  $('swResultScore').textContent = g.score;
  $('swResultBest').textContent = best ? 'New best score!' : `Best: ${progress.swarBest || 0}`;
  $('swResultBest').classList.toggle('new-best', best);
  $('swResultStats').textContent = `${g.correct} right · reached level ${g.level + 1} (${SWAR_LEVELS[g.level].name})`;
  const tricky = trickiest(g.mistakes);
  const list = $('swResultTricky');
  list.innerHTML = '';
  for (const t of tricky) {
    const li = document.createElement('li');
    li.textContent = `${swarLabel(swarById(t.asked))} — you heard ${swarLabel(swarById(t.answered))}${t.times > 1 ? ` (${t.times}×)` : ''}`;
    list.appendChild(li);
  }
  $('swResultTrickyWrap').hidden = !tricky.length;
  document.dispatchEvent(new CustomEvent('games-progress'));
}

/** The panel as it is before a game: intro, fresh HUD, Start. */
function resetView() {
  $('swPlay').hidden = false;
  $('swResults').hidden = true;
  $('swOrb').textContent = '?';
  $('swOrb').classList.remove('right', 'wrong', 'pulse');
  $('swStart').textContent = 'Start';
  showPool(0);
  prompt(INTRO);
  $('swScore').textContent = '0';
  $('swLevel').textContent = `1 · ${SWAR_LEVELS[0].name}`;
  $('swStreak').textContent = '×1';
  $('swLives').textContent = '♥'.repeat(LIVES);
}

export function startSwarGame() {
  stopSwarGame();
  const ctx = getAudioContext();
  if (ctx.state === 'suspended') ctx.resume();
  game = { score: 0, streak: 0, lives: LIVES, correct: 0, level: 0, question: null, askedAt: null, locked: true, mistakes: [] };
  $('swResults').hidden = true;
  $('swPlay').hidden = false;
  $('swStart').textContent = 'Restart';
  showPool(0);
  hud();
  prompt('The drone is Sa. Listen for the mystery swar…');
  startDrone();
  later(ask, 1400);
}

export function stopSwarGame() {
  clearTimers();
  stopDrone();
  if (game) resetView();
  game = null;
}

export function swarGameRunning() {
  return !!game;
}

export function initSwarGame() {
  buildKeys();
  showPool(0);
  $('swStart').addEventListener('click', startSwarGame);
  $('swAgain').addEventListener('click', startSwarGame);
  $('swOrb').addEventListener('click', replay);
  $('swHearSa').addEventListener('click', () => sing(sa(), 0, 1));
  document.addEventListener('keydown', e => {
    if (!game || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    if (!$('swarGame') || $('swarGame').hidden) return;
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (e.code === 'Space') {
      e.preventDefault();
      replay();
      return;
    }
    const key = e.key.toLowerCase();
    const id = e.shiftKey ? SHIFT_KEYS[key] : KEYS[key];
    if (!id) return;
    const k = document.querySelector(`#swKeys .swar-key[data-swar="${id}"]`);
    if (k && !k.disabled) {
      e.preventDefault();
      answer(id);
    }
  });
}
