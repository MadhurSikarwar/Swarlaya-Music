/**
 * Shared modal behaviour. Each feature opens its own `.modal-overlay` by
 * adding the `active` class; this closes any of them on Escape, a click on
 * the backdrop or on a [data-close-modal] button, stops the page behind from
 * scrolling while one is open, keeps Tab inside it, and puts the focus back
 * where it was.
 */
const isOpen = overlay => overlay.classList.contains('active');

export function initModals() {
  const overlays = [...document.querySelectorAll('.modal-overlay')];
  const returnFocus = new Map();

  const update = overlay => {
    if (isOpen(overlay)) {
      if (!returnFocus.has(overlay)) {
        returnFocus.set(overlay, document.activeElement);
        overlay.querySelector('.modal-content')?.focus({ preventScroll: true });
      }
    } else if (returnFocus.has(overlay)) {
      const el = returnFocus.get(overlay);
      returnFocus.delete(overlay);
      if (el && el.isConnected && typeof el.focus === 'function') el.focus({ preventScroll: true });
    }
    document.body.classList.toggle('modal-open', overlays.some(isOpen));
  };

  for (const overlay of overlays) {
    overlay.querySelector('.modal-content')?.setAttribute('tabindex', '-1');
    overlay.addEventListener('click', e => {
      if (e.target === overlay || e.target.closest('[data-close-modal]')) overlay.classList.remove('active');
    });
    new MutationObserver(() => update(overlay)).observe(overlay, { attributes: true, attributeFilter: ['class'] });
  }

  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape' && e.key !== 'Tab') return;
    const top = overlays.filter(isOpen).pop();
    if (!top) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      top.classList.remove('active');
    } else {
      trapFocus(top, e);
    }
  });
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), ' +
  'select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

/** Tab and Shift+Tab stay inside the open dialog, wrapping at its ends. */
function trapFocus(overlay, e) {
  const items = [...overlay.querySelectorAll(FOCUSABLE)].filter(el => el.offsetParent !== null);
  if (!items.length) { e.preventDefault(); return; }
  const first = items[0], last = items[items.length - 1];
  const active = document.activeElement;
  const inside = items.includes(active);
  if (e.shiftKey ? (!inside || active === first) : (!inside || active === last)) {
    e.preventDefault();
    (e.shiftKey ? last : first).focus();
  }
}
