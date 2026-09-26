/**
 * The page's master output. Everything audible connects to
 * getMasterOutput() rather than to ctx.destination.
 *
 * While something plays, the master is routed through a
 * MediaStreamAudioDestinationNode into a hidden <audio> element: Chrome and
 * Android only offer lock-screen / headphone media controls (Media Session)
 * for a playing media element, and a playing element keeps mobile browsers
 * from treating the page as silent in the background.
 *
 * Exactly one path is connected at any time — never both, so nothing is
 * heard twice. The switch to the element happens only once it is actually
 * playing; if it can't play (autoplay refused, no MediaStream support) the
 * master simply stays on ctx.destination. The element path adds a small
 * output buffer, so it can be switched off (setMediaOutputEnabled).
 */
import { getAudioContext } from './audio-context.js';

let master = null;
let streamDest = null;
let el = null;
let routedToElement = false;
let activating = null;
let enabled = true;
let ignorePause = false;
let externalPauseHandler = null;

export function getMasterOutput() {
  if (!master) {
    const ctx = getAudioContext();
    master = ctx.createGain();
    master.connect(ctx.destination);
  }
  return master;
}

function supported() {
  return typeof MediaStream !== 'undefined' &&
    typeof getAudioContext().createMediaStreamDestination === 'function';
}

export function isMediaOutputActive() {
  return routedToElement;
}

/** Called when the system pauses the element (headphones unplugged, audio focus lost). */
export function onExternalPause(fn) {
  externalPauseHandler = fn;
}

function createElement(ctx) {
  streamDest = ctx.createMediaStreamDestination();
  el = document.createElement('audio');
  el.id = 'mediaOutput';
  el.hidden = true;
  el.setAttribute('playsinline', '');
  el.srcObject = streamDest.stream;
  el.addEventListener('pause', () => {
    if (ignorePause || !routedToElement) return;
    // Not our doing: keep the page's state in step with what is audible.
    if (externalPauseHandler) externalPauseHandler();
  });
  document.body.appendChild(el);
}

/**
 * Route the master through the media element. Call it from the user
 * gesture that starts playback (browsers only let a gesture start media);
 * resolves to true once the element carries the output.
 */
export function startMediaOutput() {
  if (!enabled || !supported()) return Promise.resolve(false);
  if (routedToElement) {
    if (el.paused) el.play().catch(() => {});
    return Promise.resolve(true);
  }
  if (activating) return activating;
  const ctx = getAudioContext();
  getMasterOutput();
  if (!el) createElement(ctx);
  activating = el.play().then(() => {
    if (!enabled) { ignorePause = true; el.pause(); ignorePause = false; return false; }
    // Switch in one task: the element path replaces the direct one.
    master.connect(streamDest);
    master.disconnect(ctx.destination);
    routedToElement = true;
    return true;
  }).catch(err => {
    console.warn('Media output unavailable, playing directly:', err);
    return false;
  }).finally(() => { activating = null; });
  return activating;
}

/** Back to the direct output (on stop, or when the option is turned off). */
export function stopMediaOutput() {
  if (!routedToElement) return;
  const ctx = getAudioContext();
  master.connect(ctx.destination);
  master.disconnect(streamDest);
  routedToElement = false;
  ignorePause = true;
  el.pause();
  ignorePause = false;
}

export function setMediaOutputEnabled(on) {
  enabled = on;
  if (!on) stopMediaOutput();
}

/**
 * Seconds between a context time being rendered and it being heard (what
 * the browser reports; the media element's own buffer isn't exposed).
 */
export function outputLatency() {
  const ctx = getAudioContext();
  return (ctx.baseLatency || 0) + (ctx.outputLatency || 0);
}
