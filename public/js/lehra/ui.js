/** Transport icon, status line and header badge. */
import { $ } from '../core/dom.js';

export function showPlay() { $('playIcon').style.display = ''; $('pauseIcon').style.display = 'none'; }
export function showPause() { $('playIcon').style.display = 'none'; $('pauseIcon').style.display = ''; }

export function setStatus(msg, type) {
  $('statusText').textContent = msg;
  $('infoDot').className = 'info-dot' + (type ? ' ' + type : '');
}

export function setBadge(text, loading) {
  const b = $('loadingBadge');
  b.textContent = text;
  b.classList.toggle('loading', loading);
}
