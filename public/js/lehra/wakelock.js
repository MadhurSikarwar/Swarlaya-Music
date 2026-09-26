/** Keep the screen awake while the lehra plays (if the option is on). */
import { state } from './state.js';

let wakeLock = null;

export async function requestWakeLock() {
  if (!state.wakeLockEnabled || !('wakeLock' in navigator)) return;
  if (wakeLock && !wakeLock.released) return;
  // Only a visible page may hold one; retried when the page becomes visible.
  if (document.visibilityState !== 'visible') return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
  } catch (err) {
    console.warn('Wake Lock error:', err);
  }
}

export function releaseWakeLock() {
  if (wakeLock !== null) {
    wakeLock.release().catch(() => {});
    wakeLock = null;
  }
}
