/**
 * "Continue your riyaz" on the home page: the lehra setup you last used (it
 * is restored into the player on load, so the link opens straight onto it)
 * and today's practice against the daily goal, with the streak. Hidden for a
 * first-time visitor, who has neither.
 */
import { $ } from '../core/dom.js';
import { formatPractice, riyazSummary } from './riyaz.js';
import { state } from './state.js';

export function renderResumeCard() {
  const card = $('resumeCard');
  if (!card) return;
  const riyaz = riyazSummary();
  card.hidden = !state.raag && riyaz.total === 0;
  if (card.hidden) return;

  const taal = (state.taal || '').replace(/\s*\(.*\)$/, '');
  $('resumeTitle').textContent = state.raag || 'Lehra Player';
  $('resumeSub').textContent = state.raag
    ? [state.instrument, taal, `${state.bpm} BPM`].filter(Boolean).join(' · ')
    : 'Choose an instrument, taal and raag to begin.';

  const pct = Math.min(100, Math.round(riyaz.today / riyaz.goalSecs * 100));
  const goalMin = Math.round(riyaz.goalSecs / 60);
  $('resumeToday').textContent = riyaz.today >= riyaz.goalSecs
    ? `Today's goal met: ${formatPractice(riyaz.today)}`
    : `${formatPractice(riyaz.today)} of ${goalMin} min today`;
  $('resumeStreak').textContent = riyaz.streak ? `${riyaz.streak}-day streak` : '';
  $('resumeGoalBar').style.width = `${pct}%`;
  $('resumeGoal').setAttribute('aria-valuenow', String(pct));
}
