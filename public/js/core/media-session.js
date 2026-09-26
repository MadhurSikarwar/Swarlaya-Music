/**
 * Lock-screen / notification / headphone-button controls (Media Session
 * API). Whichever player is active (Lehra, Carnatic suite, song practice)
 * shows its metadata and handlers here; only one at a time.
 */
import { onExternalPause } from './audio-output.js';

const ms = typeof navigator !== 'undefined' && 'mediaSession' in navigator ? navigator.mediaSession : null;
const ACTIONS = ['play', 'pause', 'stop'];
const ARTWORK = [
  { src: '/public/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
  { src: '/public/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
];

let handlers = null;

// The media element was paused by the system (e.g. headphones unplugged):
// pause the player too, as a music app would.
onExternalPause(() => { if (handlers && handlers.pause) handlers.pause(); });

/**
 * Show `info` ({ title, artist, album }) with `actions` ({ play, pause, stop })
 * and mark the session as playing.
 */
export function showMediaSession(info, actions) {
  handlers = actions;
  if (!ms) return;
  try {
    ms.metadata = new MediaMetadata({ ...info, artwork: ARTWORK });
  } catch { /* MediaMetadata unsupported */ }
  for (const action of ACTIONS) {
    try {
      ms.setActionHandler(action, actions[action] ? () => actions[action]() : null);
    } catch { /* action not supported by this browser */ }
  }
  ms.playbackState = 'playing';
}

/** 'playing' | 'paused' (keeps the controls so play can resume). */
export function setMediaPlaybackState(playbackState) {
  if (ms && handlers) ms.playbackState = playbackState;
}

/** Remove the controls (only if `actions` still owns the session, when given). */
export function clearMediaSession(actions) {
  if (actions && actions !== handlers) return;
  handlers = null;
  if (!ms) return;
  ms.metadata = null;
  for (const action of ACTIONS) {
    try { ms.setActionHandler(action, null); } catch { /* unsupported */ }
  }
  ms.playbackState = 'none';
}
