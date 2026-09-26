/**
 * The one AudioContext shared by the Lehra player and the Notation Editor
 * (a page should only ever run a single context).
 */
let ctx = null;

export function getAudioContext() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    // Browsers start a context suspended until a user gesture.
    document.addEventListener('click', () => {
      if (ctx.state === 'suspended') ctx.resume();
    }, { capture: true });
  }
  return ctx;
}
