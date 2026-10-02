/**
 * Mini player: the Lehra's play / stop and what is playing, in a small bar at
 * the bottom of the screen whenever the main transport has scrolled out of
 * view — on a phone it sits several screens below the raag lists. It shows
 * only on the Lehra page, once a raag is chosen, and follows the same state
 * and events as the main controls.
 */
import { $ } from '../core/dom.js';
import { stopPlayback, togglePlay } from './player.js';
import { on, onSettingsChange, state } from './state.js';

// The transport counts as "in view" only clear of the sticky header and of
// the strip this bar itself covers.
const VIEW_MARGIN = '-72px 0px -84px 0px';

let transportInView = true;

function render() {
  const bar = $('miniPlayer');
  if (!bar) return;
  const show = !!state.raag && !transportInView && !!$('view-lehra')?.classList.contains('active-view');
  bar.hidden = !show;
  document.body.classList.toggle('has-mini-player', show);
  if (!show) return;
  $('miniTitle').textContent = state.raag;
  $('miniSub').textContent = [state.instrument, (state.taal || '').replace(/\s*\(.*\)$/, ''), `${state.bpm} BPM`]
    .filter(Boolean).join(' · ');
  bar.classList.toggle('playing', state.isPlaying);
  $('miniPlayIcon').style.display = state.isPlaying ? 'none' : '';
  $('miniPauseIcon').style.display = state.isPlaying ? '' : 'none';
  $('miniPlay').setAttribute('aria-label', state.isPlaying ? 'Pause' : 'Play');
}

function showMatra(matra, total) {
  const playing = matra > 0 && total > 0;
  $('miniMatra').textContent = playing ? `${matra} / ${total}` : '';
  $('miniProgress').style.width = playing ? `${(matra / total * 100).toFixed(1)}%` : '0%';
}

export function initMiniPlayer() {
  const transport = $('playBtn')?.closest('.transport');
  if (!$('miniPlayer') || !transport || typeof IntersectionObserver !== 'function') return;

  $('miniPlay').addEventListener('click', togglePlay);
  $('miniStop').addEventListener('click', stopPlayback);
  $('miniInfo').addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));

  // Also fires when the Lehra page is shown or hidden (a hidden transport intersects nothing)
  new IntersectionObserver(entries => {
    transportInView = entries[entries.length - 1].intersectionRatio >= 0.5;
    render();
  }, { rootMargin: VIEW_MARGIN, threshold: [0, 0.5, 1] }).observe(transport);

  onSettingsChange(render);
  on('playback', render);
  on('matra', showMatra);
  render();
}
