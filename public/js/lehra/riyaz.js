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
    bars.push({ date: d.toLocaleDateString('en-US', { weekday: 'short' }), secs, isToday: i === 0 });
    if (i === 0) totalToday = secs;
  }

  const maxSecs = Math.max(...bars.map(b => b.secs), goalSecs, 60);
  bars.forEach(b => {
    const heightPct = (b.secs / maxSecs) * 100;
    chart.innerHTML += `
      <div class="stat-bar-container">
        <div class="stat-bar${b.secs >= goalSecs ? ' met' : ''}" style="height: ${Math.max(2, heightPct)}%; opacity: ${b.isToday ? '1' : '0.7'};"></div>
        <div class="stat-label">${b.date}</div>
      </div>
    `;
  });
  // Goal line across the chart
  chart.insertAdjacentHTML('beforeend',
    `<div class="stat-goal-line" style="bottom: ${(goalSecs / maxSecs * 100).toFixed(1)}%"></div>`);

  const minToday = Math.round(totalToday / 60);
  $('statsTotalToday').textContent = minToday + (minToday === 1 ? ' min' : ' mins');
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
