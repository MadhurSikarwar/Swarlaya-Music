/**
 * Toasts: brief messages at the bottom of the screen for things that happen
 * away from where you are looking — a preset applied behind a closed dialog,
 * the connection dropping, a play button pressed with nothing selected.
 * They are announced to screen readers and leave on their own (or on a tap).
 */
const MAX_VISIBLE = 3;

let region = null;

function ensureRegion() {
  if (!region) {
    region = document.createElement('div');
    region.className = 'toast-region';
    region.setAttribute('role', 'region');
    region.setAttribute('aria-label', 'Notifications');
    document.body.appendChild(region);
  }
  return region;
}

function dismiss(el) {
  if (!el.isConnected || el.classList.contains('leaving')) return;
  clearTimeout(el._timer);
  el.classList.add('leaving');
  // Removed after the fade — or at once where transitions are switched off
  const done = () => el.remove();
  el.addEventListener('transitionend', done, { once: true });
  setTimeout(done, 400);
}

/**
 * Show `message`. type: 'info' | 'success' | 'error' (errors stay longer and
 * interrupt a screen reader); duration in ms.
 */
export function toast(message, { type = 'info', duration = type === 'error' ? 6000 : 3500 } = {}) {
  const host = ensureRegion();
  // The same message again just restarts its timer
  const same = [...host.children].find(t => t.textContent === message && !t.classList.contains('leaving'));
  const el = same || document.createElement('div');
  if (!same) {
    el.className = `toast toast-${type}`;
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    el.textContent = message;
    el.addEventListener('click', () => dismiss(el));
    host.appendChild(el);
    while (host.children.length > MAX_VISIBLE) host.firstElementChild.remove();
    void el.offsetWidth; // let the entrance transition run
    el.classList.add('show');
  }
  clearTimeout(el._timer);
  el._timer = setTimeout(() => dismiss(el), duration);
  return el;
}
