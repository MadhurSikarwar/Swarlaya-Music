/**
 * Sam Pakdo — catch the sam. The real lehra plays (the Lehra player's
 * engine, at the player's Sa); tap exactly on sam, cycle after cycle.
 *
 * Timing: a tap is compared with the moment sam is HEARD. The engine's
 * musical clock gives the context time each beat is rendered at
 * (timeOfBeat); getOutputTimestamp() says which context time is coming out
 * of the speakers at a given performance.now(), so a tap's event timestamp
 * maps straight onto the same timeline — output latency included.
 */
import { $ } from '../core/dom.js';
import { getAudioContext } from '../core/audio-context.js';
import { outputLatency } from '../core/audio-output.js';
import { audio, ensureAudio } from '../lehra/audio.js';
import { CATALOGUE } from '../lehra/catalogue.js';
import { BASE_HZ, TANPURA_BASE_HZ, state as lehraState } from '../lehra/state.js';
import { matraRole, vibhagMarkers } from '../lehra/theka.js';
import {
  GOOD_WINDOW, SAM_STAGES, comboPoints, describeOffset, judgeTap, stageUnlocked, stars,
} from './rules.js';
import { loadProgress, saveProgress } from './store.js';

const LEAD_SEC = 0.35;   // from pressing Start to the first sam
const TICK_MS = 20;

let round = null;
let tickTimer = null;
let frame = null;
let loading = 0;         // bumped to abandon a stage that is still loading

/** A lehra for the stage: the first instrument with that taal at that tempo, and one of its raags. */
export function lehraFor(stage, random = Math.random) {
  for (const [instrument, inst] of Object.entries(CATALOGUE)) {
    for (const [name, taal] of Object.entries(inst.taals)) {
      if (!name.startsWith(stage.taal) || (taal.cycles || 1) > 1) continue;
      if (stage.bpm < taal.minTempo || stage.bpm > taal.maxTempo) continue;
      const raags = Object.entries(taal.raags);
      const [raag, info] = raags[Math.floor(random() * raags.length)];
      return { instrument, taalName: name, taal, raag, file: info.file, tuning: inst.tuningCoeff ?? 1 };
    }
  }
  return null;
}

/** The context time being heard at performance time `perfMs`. */
function heardAt(perfMs = performance.now()) {
  const ctx = getAudioContext();
  if (typeof ctx.getOutputTimestamp === 'function') {
    const ts = ctx.getOutputTimestamp();
    if (ts.performanceTime > 0 && ts.contextTime > 0) return ts.contextTime + (perfMs - ts.performanceTime) / 1000;
  }
  return ctx.currentTime - outputLatency() + (perfMs - performance.now()) / 1000;
}

const samTime = k => audio.engine.timeOfBeat(k * round.cycleBeats);

// ── Stage list ───────────────────────────────────────────────────────
function renderStages() {
  const progress = loadProgress();
  const list = $('samStages');
  list.innerHTML = '';
  SAM_STAGES.forEach((stage, i) => {
    const open = stageUnlocked(i, progress.samStars);
    const earned = progress.samStars[stage.id] || 0;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'stage-card';
    b.disabled = !open;
    b.innerHTML = `
      <span class="stage-num">${open ? i + 1 : '🔒'}</span>
      <span class="stage-text"><span class="stage-title"></span><span class="stage-sub"></span></span>
      <span class="stage-stars" aria-label="${earned} of 3 stars">${'★'.repeat(earned)}${'☆'.repeat(3 - earned)}</span>`;
    b.querySelector('.stage-title').textContent = `${stage.title} · ${stage.bpm} BPM`;
    b.querySelector('.stage-sub').textContent = open ? stage.sub : 'Earn a star on the stage before to unlock';
    b.addEventListener('click', () => startStage(i));
    list.appendChild(b);
  });
}

function showScreen(name) {
  $('samStages').hidden = name !== 'stages';
  $('samIntro').hidden = name !== 'stages';
  $('samPlay').hidden = name !== 'play';
  $('samResults').hidden = name !== 'results';
}

// ── The wheel ────────────────────────────────────────────────────────
function drawWheel(taal, beats) {
  const markers = vibhagMarkers(taal);
  const R = 84;
  let dots = '', labels = '';
  for (let m = 1; m <= beats; m++) {
    const a = (m - 1) / beats * 2 * Math.PI - Math.PI / 2;
    const x = (R * Math.cos(a)).toFixed(1), y = (R * Math.sin(a)).toFixed(1);
    const role = matraRole(taal, m) || '';
    dots += `<circle class="wheel-dot ${role}" data-m="${m}" cx="${x}" cy="${y}" r="${m === 1 ? 7 : role ? 5.5 : 4}"/>`;
    if (markers.has(m)) {
      const lx = ((R + 16) * Math.cos(a)).toFixed(1), ly = ((R + 16) * Math.sin(a)).toFixed(1);
      labels += `<text class="wheel-label ${role}" x="${lx}" y="${ly}">${markers.get(m)}</text>`;
    }
  }
  $('samWheel').innerHTML = `
    <circle class="wheel-ring" r="${R}"/>
    ${dots}${labels}
    <line class="wheel-hand" id="samHand" x1="0" y1="0" x2="0" y2="${-R + 12}"/>
    <circle class="wheel-hub" r="5"/>`;
}

function drawLoop() {
  frame = null;
  if (!round || !round.playing) return;
  const beat = audio.engine.beatAt(heardAt());
  if (beat !== null) {
    const C = round.cycleBeats;
    const pos = ((beat % C) + C) % C;
    $('samHand')?.setAttribute('transform', `rotate(${(pos / C * 360).toFixed(2)})`);
    const m = Math.floor(pos + 1e-6) + 1;
    if (m !== round.shownMatra) {
      round.shownMatra = m;
      document.querySelectorAll('#samWheel .wheel-dot.now').forEach(d => d.classList.remove('now'));
      document.querySelector(`#samWheel .wheel-dot[data-m="${m}"]`)?.classList.add('now');
    }
    $('samWheel').classList.toggle('hand-hidden', !!round.stage.hide && beat >= C - 0.02);
  }
  frame = requestAnimationFrame(drawLoop);
}

// ── Feedback ─────────────────────────────────────────────────────────
function feedback(grade, detail = '') {
  const el = $('samFeedback');
  el.className = `sam-feedback grade-${grade.toLowerCase().replace(/[^a-z]/g, '')}`;
  el.innerHTML = '';
  const g = document.createElement('span');
  g.className = 'fb-grade';
  g.textContent = grade;
  const d = document.createElement('span');
  d.className = 'fb-detail';
  d.textContent = detail;
  el.append(g, d);
  void el.offsetWidth; // restart the pop animation
  el.classList.add('show');
}

function hud() {
  $('samScore').textContent = round.score;
  $('samCombo').textContent = round.combo > 1 ? `×${round.combo}` : '—';
  $('samCount').textContent = `${Math.min(round.next - 1, round.cycles)} / ${round.cycles}`;
}

function prompt(text) {
  if ($('samPrompt').textContent !== text) $('samPrompt').textContent = text;
}

// ── Play ─────────────────────────────────────────────────────────────
async function startStage(i) {
  stopSamGame();
  const stage = SAM_STAGES[i];
  const lehra = lehraFor(stage);
  if (!lehra) return;
  const id = ++loading;
  showScreen('play');
  $('samStageName').textContent = `${stage.title} · ${lehra.raag} on ${lehra.instrument}`;
  $('samFeedback').className = 'sam-feedback';
  $('samWheel').innerHTML = '';
  prompt('Tuning the lehra…');
  try {
    await ensureAudio();
    const raagId = await audio.engine.loadRaag(lehra.file, lehra.taal, lehra.tuning);
    if (id !== loading) return; // left or restarted meanwhile
    const cycleBeats = lehra.taal.beats;
    round = {
      stageIndex: i, stage, lehra, cycleBeats, cycles: stage.cycles, bpm: stage.bpm,
      next: 1, score: 0, combo: 0, maxCombo: 0, hits: [], speedAt: null, playing: true, shownMatra: 0,
    };
    drawWheel(lehra.taal, cycleBeats);
    hud();
    audio.engine.play(raagId, {
      bpm: stage.bpm, pitch: lehraState.pitchHz / BASE_HZ, tanpuraRatio: lehraState.pitchHz / TANPURA_BASE_HZ,
      loop: true, delay: LEAD_SEC,
    });
    tickTimer = setInterval(tick, TICK_MS);
    frame = requestAnimationFrame(drawLoop);
    $('samTap').focus({ preventScroll: true });
  } catch (err) {
    console.error('Sam Pakdo:', err);
    prompt(`Couldn't start the lehra: ${err.message}`);
  }
}

/** Score sam `k` (hit = { grade, points } or null for a miss). */
function record(k, hit, error) {
  if (hit) {
    round.combo++;
    const pts = comboPoints(hit.points, round.combo);
    round.score += pts;
    round.hits.push({ grade: hit.grade, error, base: hit.points });
    feedback(hit.grade, `+${pts} · ${describeOffset(error)}`);
    $('samWheel').classList.remove('hit');
    void $('samWheel').getBoundingClientRect();
    $('samWheel').classList.add('hit');
  } else {
    round.combo = 0;
    round.hits.push({ grade: 'Miss', error: null, base: 0 });
    feedback('Miss', 'sam went by');
  }
  round.maxCombo = Math.max(round.maxCombo, round.combo);
  // Speed up once this sam's window has closed (drut stage)
  if (round.stage.speedUp && k < round.cycles) round.speedAt = samTime(k) + GOOD_WINDOW;
  round.next = k + 1;
  hud();
}

function tick() {
  if (!round || !round.playing || !audio.engine) return;
  const now = heardAt();
  const beat = audio.engine.beatAt(now);
  if (beat === null) return;
  const C = round.cycleBeats;

  if (round.speedAt !== null && now >= round.speedAt) {
    round.speedAt = null;
    round.bpm = Math.min(round.lehra.taal.maxTempo, round.bpm * (1 + round.stage.speedUp));
    audio.engine.setParams({ bpm: round.bpm });
  }

  // A sam whose window passed without a tap is a miss
  while (round.next <= round.cycles) {
    const t = samTime(round.next);
    if (t === null || now <= t + GOOD_WINDOW) break;
    record(round.next, null);
  }

  if (round.next > round.cycles) {
    if (now > samTime(round.cycles) + GOOD_WINDOW + 0.4) finish();
    return;
  }

  // Coaching line
  if (beat < 0) prompt('Here it comes…');
  else if (beat < C) {
    const left = C - Math.floor(beat);
    prompt(left <= 3 ? `${left}…` : `Listen — this cycle has ${C} matras. Tap on the next sam!`);
  } else if (round.stage.hide) prompt('Count the matras — tap on sam!');
  else prompt('Tap on sam!');
}

function tap(perfMs) {
  if (!round || !round.playing) return;
  const now = heardAt(perfMs);
  const k = round.next;
  const t = k <= round.cycles ? samTime(k) : null;
  if (t === null) return;
  const error = now - t;
  const hit = judgeTap(error);
  if (hit) {
    record(k, hit, error);
    return;
  }
  if (now < samTime(1) - 0.4) {
    feedback('Wait', 'listen to one cycle first');
    return;
  }
  // Off the sam: report against the nearer sam, and the combo is broken
  const prev = k > 1 ? now - samTime(k - 1) : Infinity;
  const late = Math.abs(prev) < Math.abs(error);
  round.combo = 0;
  hud();
  feedback(late ? 'Late' : 'Early', late ? `${Math.round(prev * 1000)} ms after sam` : `${Math.round(-error * 1000)} ms before sam`);
}

function finish() {
  if (!round) return;
  const r = round;
  stopSamGame(false);
  const base = r.hits.reduce((s, h) => s + h.base, 0);
  const accuracy = base / (r.cycles * 100);
  const earned = stars(accuracy);
  const progress = loadProgress();
  const id = r.stage.id;
  const bestScore = r.score > (progress.samBest[id] || 0);
  progress.samStars[id] = Math.max(progress.samStars[id] || 0, earned);
  if (bestScore) progress.samBest[id] = r.score;
  saveProgress(progress);

  const count = g => r.hits.filter(h => h.grade === g).length;
  const errors = r.hits.filter(h => h.error !== null).map(h => h.error);
  const mean = errors.length ? errors.reduce((a, b) => a + b, 0) / errors.length : null;
  $('samResultStars').textContent = '★'.repeat(earned) + '☆'.repeat(3 - earned);
  $('samResultStars').setAttribute('aria-label', `${earned} of 3 stars`);
  $('samResultScore').textContent = r.score;
  $('samResultBest').textContent = bestScore ? 'New best for this stage!' : `Best: ${progress.samBest[id] || 0}`;
  $('samResultBest').classList.toggle('new-best', bestScore);
  $('samResultStats').textContent =
    `${Math.round(accuracy * 100)}% accuracy · Perfect ${count('Perfect')} · Great ${count('Great')} · Good ${count('Good')} · Miss ${count('Miss')} · best combo ${r.maxCombo}`;
  $('samResultTiming').textContent = mean === null ? 'Tip: sam is the heavy first beat — the X on the wheel.'
    : errors.length > 1 ? `On average you tapped ${describeOffset(mean)}.` : '';
  const nextIndex = r.stageIndex + 1;
  const nextOpen = nextIndex < SAM_STAGES.length && stageUnlocked(nextIndex, progress.samStars);
  $('samNext').hidden = !nextOpen;
  $('samNext').onclick = () => startStage(nextIndex);
  $('samRetry').onclick = () => startStage(r.stageIndex);
  renderStages();
  showScreen('results');
  document.dispatchEvent(new CustomEvent('games-progress'));
}

/** Stop the lehra and the round; `toStages` also returns to the stage list. */
export function stopSamGame(toStages = true) {
  loading++;
  if (round?.playing && audio.engine) audio.engine.stop();
  if (round) round.playing = false;
  round = null;
  clearInterval(tickTimer);
  tickTimer = null;
  if (frame) cancelAnimationFrame(frame);
  frame = null;
  if (toStages) {
    renderStages();
    showScreen('stages');
  }
}

export function initSamGame() {
  renderStages();
  showScreen('stages');
  const press = e => {
    if (e.button > 0) return;
    e.preventDefault();
    tap(e.timeStamp);
  };
  $('samTap').addEventListener('pointerdown', press);
  $('samWheel').addEventListener('pointerdown', press);
  $('samQuit').addEventListener('click', () => stopSamGame());
  $('samBackToStages').addEventListener('click', () => stopSamGame());
  document.addEventListener('keydown', e => {
    if (!round || !round.playing || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'Space' || e.code === 'Enter') {
      e.preventDefault();
      tap(e.timeStamp);
    }
  });
}
