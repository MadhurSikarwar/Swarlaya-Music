/**
 * Riyaz (practice) tracker: seconds played per local day, kept in
 * localStorage, with a daily goal and the streak of days that met it.
 */
import { $ } from '../core/dom.js';
import { state } from './state.js';

const GOAL_KEY = 'lehra_riyaz_goal_min';
export const DEFAULT_GOAL_MIN = 15;

// Practice is logged against the local calendar day (toISOString() would use
// UTC, which files 00:00–05:30 IST practice under the previous day).
export function localDateKey(d) {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function savedSeconds(d) {
  return parseInt(localStorage.getItem(`lehra_riyaz_${localDateKey(d)}`) || '0', 10) || 0;
}

/** Seconds practised on day `d`, including the session still running today. */
function secondsOn(d) {
  let secs = savedSeconds(d);
  if (state.isPlaying && state.riyazStart > 0 && localDateKey(d) === localDateKey(new Date())) {
    secs += Math.max(0, Math.round((Date.now() - state.riyazStart) / 1000));
  }
  return secs;
}

export function goalMinutes() {
  const v = parseInt(localStorage.getItem(GOAL_KEY), 10);
  return v > 0 ? v : DEFAULT_GOAL_MIN;
}

/**
 * Consecutive days, ending today, whose practice met the goal. Today only
 * counts once met — until then the streak runs to yesterday.
 * `secondsFor(date)` gives a day's practice.
 */
export function riyazStreak(secondsFor, goalSecs, today = new Date()) {
  const goal = Math.max(1, goalSecs);
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12);
  if (secondsFor(d) < goal) d.setDate(d.getDate() - 1);
  let streak = 0;
  while (streak < 3660 && secondsFor(d) >= goal) {
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

function saveRiyazTime(seconds) {
  if (seconds <= 0) return;
  const key = `lehra_riyaz_${localDateKey(new Date())}`;
  const current = parseInt(localStorage.getItem(key) || '0', 10);
  localStorage.setItem(key, current + seconds);
}

/** End the current session and log it. */
export function processRiyazSession() {
  if (state.riyazStart > 0) {
    saveRiyazTime(Math.round((Date.now() - state.riyazStart) / 1000));
    state.riyazStart = 0;
  }
}

/** Save the practice so far without ending the session. */
export function checkpointRiyaz() {
  if (state.isPlaying && state.riyazStart > 0) {
    const now = Date.now();
    saveRiyazTime(Math.round((now - state.riyazStart) / 1000));
    state.riyazStart = now;
  }
}

/** 45 → "45 s", 150 → "3 min", 4500 → "1 h 15 min". */
export function formatPractice(secs) {
  if (secs < 60) return `${Math.max(0, Math.round(secs))} s`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} min`;
  return mins % 60 ? `${Math.floor(mins / 60)} h ${mins % 60} min` : `${Math.floor(mins / 60)} h`;
}

/**
 * All-time practice from the per-day log: { total, days } in seconds and
 * days practised. `entries` = [[storage key, value], …].
 */
export function riyazTotals(entries) {
  let total = 0, days = 0;
  for (const [key, value] of entries) {
    if (!/^lehra_riyaz_\d{4}-\d{2}-\d{2}$/.test(key)) continue;
    const secs = parseInt(value, 10) || 0;
    if (secs > 0) { total += secs; days++; }
  }
  return { total, days };
}

/** Practice so far — today, the last 7 days and all time — with the goal and streak. */
export function riyazSummary(now = new Date()) {
  const goalSecs = goalMinutes() * 60;
  const today = secondsOn(now);
  let week = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    week += secondsOn(d);
  }
  let stored = [];
  try {
    stored = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i))
      .map(key => [key, localStorage.getItem(key)]);
  } catch { /* storage unavailable */ }
  let { total, days } = riyazTotals(stored);
  // …plus the session still running, which isn't in the log yet
  const running = today - savedSeconds(now);
  if (running > 0) {
    total += running;
    if (savedSeconds(now) === 0) days++;
  }
  return { today, week, total, days, goalSecs, streak: riyazStreak(secondsOn, goalSecs, now) };
}

/** Last-7-days chart, today's goal progress and the streak (Riyaz Tracker modal). */
export function renderStats() {
  const chart = $('statsChart');
  if (!chart) return;
  chart.innerHTML = '';
  const goalSecs = goalMinutes() * 60;
  let totalToday = 0;

  const bars = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const secs = secondsOn(d);
    bars.push({
      date: d.toLocaleDateString('en-US', { weekday: 'short' }),
      day: d.toLocaleDateString('en-US', { weekday: 'long' }),
      secs, isToday: i === 0,
    });
    if (i === 0) totalToday = secs;
  }

  const maxSecs = Math.max(...bars.map(b => b.secs), goalSecs, 60);
  bars.forEach(b => {
    const heightPct = (b.secs / maxSecs) * 100;
    const label = `${b.isToday ? 'Today' : b.day}: ${formatPractice(b.secs)}${b.secs >= goalSecs ? ' (goal met)' : ''}`;
    chart.innerHTML += `
      <div class="stat-bar-container" title="${label}">
        <div class="stat-bar${b.secs >= goalSecs ? ' met' : ''}" style="height: ${Math.max(2, heightPct)}%; opacity: ${b.isToday ? '1' : '0.7'};"></div>
        <div class="stat-label">${b.date}</div>
      </div>
    `;
  });
  // The chart read out as one sentence instead of seven unlabelled bars
  chart.setAttribute('role', 'img');
  chart.setAttribute('aria-label', 'Practice over the last 7 days. ' +
    bars.map(b => `${b.isToday ? 'Today' : b.day} ${formatPractice(b.secs)}`).join(', ') + '.');

  const summary = riyazSummary();
  if ($('statsWeek')) {
    $('statsWeek').textContent = formatPractice(summary.week);
    $('statsAllTime').textContent = formatPractice(summary.total);
    $('statsDays').textContent = summary.days;
    $('statsEmpty').hidden = summary.total > 0;
  }
  // Goal line across the chart
  chart.insertAdjacentHTML('beforeend',
    `<div class="stat-goal-line" style="bottom: ${(goalSecs / maxSecs * 100).toFixed(1)}%"></div>`);

  const minToday = Math.round(totalToday / 60);
  $('statsTotalToday').textContent = formatPractice(totalToday); // under a minute shows as seconds, not "0 mins"
  $('statsGoalBar').style.width = Math.min(100, totalToday / goalSecs * 100).toFixed(1) + '%';
  $('statsGoalText').textContent = totalToday >= goalSecs
    ? `Goal met: ${minToday} / ${goalMinutes()} min`
    : `${minToday} / ${goalMinutes()} min today`;
  const streak = riyazStreak(secondsOn, goalSecs);
  $('statsStreak').textContent = streak ? `${streak} day${streak === 1 ? '' : 's'}` : '—';
}

export function initRiyazGoal() {
  const input = $('statsGoalInput');
  if (!input) return;
  input.value = goalMinutes();
  input.addEventListener('change', () => {
    const v = Math.max(1, Math.min(600, parseInt(input.value, 10) || DEFAULT_GOAL_MIN));
    input.value = v;
    try { localStorage.setItem(GOAL_KEY, String(v)); } catch { /* storage unavailable */ }
    renderStats();
  });
}
