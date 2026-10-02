/**
 * Riyaz games (/games): a hub with two games.
 *
 *   swar-game.js  Swar Pehchaan — hear a swar against Sa, name it
 *   sam-game.js   Sam Pakdo     — the lehra plays, tap exactly on sam
 *   rules.js      levels, scoring and tap judging (unit-tested)
 *   store.js      best scores and stars, kept in this browser
 */
import { $ } from '../core/dom.js';
import { initSamGame, stopSamGame } from './sam-game.js';
import { initSwarGame, stopSwarGame } from './swar-game.js';
import { SAM_STAGES } from './rules.js';
import { loadProgress } from './store.js';

const PANELS = { hub: 'gamesHub', swar: 'swarGame', sam: 'samGame' };

function show(name) {
  for (const [key, id] of Object.entries(PANELS)) $(id).hidden = key !== name;
  $('view-games').classList.toggle('in-game', name !== 'hub');
  if (name === 'hub') renderHubStats();
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function renderHubStats() {
  const p = loadProgress();
  $('swarBestLabel').textContent = p.swarBest ? `Best score: ${p.swarBest}` : 'No score yet';
  const earned = SAM_STAGES.reduce((n, s) => n + (p.samStars[s.id] || 0), 0);
  $('samStarsLabel').textContent = `★ ${earned} / ${SAM_STAGES.length * 3} stars`;
}

export function initGames() {
  initSwarGame();
  initSamGame();
  document.querySelectorAll('[data-game]').forEach(card => {
    card.addEventListener('click', () => show(card.dataset.game));
  });
  document.querySelectorAll('[data-game-back]').forEach(b => {
    b.addEventListener('click', () => {
      stopSwarGame();
      stopSamGame();
      show('hub');
    });
  });
  document.addEventListener('games-progress', renderHubStats);
  renderHubStats();
}

/** Leaving the Games page: silence everything and go back to the hub. */
export function leaveGames() {
  stopSwarGame();
  stopSamGame();
  if (!$('gamesHub').hidden) return;
  show('hub');
}
