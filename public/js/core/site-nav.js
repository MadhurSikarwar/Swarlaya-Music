/**
 * The site's navigation: the header (with its AI Studio menu), the tab bar at
 * the bottom on phones, and the "All tools" sheet it opens.
 *
 * Shared by every page — the main site imports it (main.js) and the Stem
 * Separator, a separate Next.js app, loads it on its own — so it depends on
 * nothing else and sets itself up when loaded.
 *
 * Which item is current comes from the page's section (data-nav on the view:
 * lehra, carnatic, notation, games, studio, progress, home …). The static build
 * marks the same items in each route's HTML (tools/seo.mjs, markNav).
 */

/** Mark the navigation for `section`, and the menu entries that link to `path`. */
export function setActiveNav(section, path = window.location.pathname) {
  let tab = false;
  document.querySelectorAll('.nav-btn[data-nav], .tab-btn[data-nav]').forEach(el => {
    const on = el.dataset.nav === section;
    el.classList.toggle('active', on);
    if (el.tagName === 'A') {
      if (on) el.setAttribute('aria-current', 'page');
      else el.removeAttribute('aria-current');
    }
    if (on && el.classList.contains('tab-btn')) tab = true;
  });
  // Sections without a tab of their own (Notation, the AI tools …) live under "All tools"
  if (!tab && section) document.querySelector('.tab-btn[data-nav="more"]')?.classList.add('active');

  const here = path.replace(/\/+$/, '') || '/';
  document.querySelectorAll('.nav-dropdown-item, .sheet-item[href]').forEach(el => {
    const on = (el.getAttribute('href') || '').replace(/\/+$/, '') === here;
    el.classList.toggle('current', on);
    if (on) el.setAttribute('aria-current', 'page');
    else el.removeAttribute('aria-current');
  });
}

// ── The AI Studio menu in the header ─────────────────────────────────────────
function initDropdown(btn) {
  const menu = document.getElementById(btn.getAttribute('aria-controls'));
  if (!menu) return;
  const items = () => [...menu.querySelectorAll('a, button')];
  const open = () => {
    menu.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', outside, true);
  };
  const close = (refocus = false) => {
    if (menu.hidden) return;
    menu.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', outside, true);
    if (refocus) btn.focus();
  };
  const outside = e => {
    if (!menu.contains(e.target) && !btn.contains(e.target)) close();
  };
  btn.addEventListener('click', () => (menu.hidden ? open() : close()));
  btn.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      open();
      items()[0]?.focus();
    }
  });
  menu.addEventListener('keydown', e => {
    const list = items();
    const i = list.indexOf(document.activeElement);
    if (e.key === 'Escape') close(true);
    else if (e.key === 'ArrowDown') { e.preventDefault(); list[(i + 1) % list.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); list[(i - 1 + list.length) % list.length]?.focus(); }
  });
  menu.addEventListener('click', e => { if (e.target.closest('a')) close(); });
  menu.addEventListener('focusout', e => {
    if (e.relatedTarget && !menu.contains(e.relatedTarget) && e.relatedTarget !== btn) close();
  });
  // Hovering opens it on devices with a mouse, as a menu bar would
  const wrap = btn.parentElement;
  let timer = null;
  wrap.addEventListener('pointerenter', e => {
    if (e.pointerType !== 'mouse') return;
    clearTimeout(timer);
    open();
  });
  wrap.addEventListener('pointerleave', e => {
    if (e.pointerType !== 'mouse') return;
    timer = setTimeout(() => close(), 220);
  });
}

// ── The "All tools" sheet (phones) ───────────────────────────────────────────
function initSheet(btn) {
  const sheet = document.getElementById(btn.getAttribute('aria-controls'));
  if (!sheet) return;
  let lastFocus = null;
  const focusables = () => [...sheet.querySelectorAll('a[href], button:not([hidden])')].filter(el => el.offsetParent !== null);

  const open = () => {
    lastFocus = document.activeElement;
    sheet.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    document.body.classList.add('sheet-open');
    requestAnimationFrame(() => sheet.classList.add('open'));
    (sheet.querySelector('.sheet-item.current') || focusables()[0])?.focus({ preventScroll: true });
  };
  const close = (refocus = true) => {
    if (sheet.hidden) return;
    sheet.classList.remove('open');
    btn.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('sheet-open');
    sheet.hidden = true;
    if (refocus) lastFocus?.focus?.({ preventScroll: true });
  };
  btn.addEventListener('click', () => (sheet.hidden ? open() : close()));
  sheet.querySelector('.modal-close')?.addEventListener('click', () => close());
  sheet.addEventListener('click', e => {
    if (e.target === sheet) close();                       // the dimmed backdrop
    else if (e.target.closest('a[href]')) close(false);    // a page was chosen
  });
  sheet.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    } else if (e.key === 'Tab') {                           // keep the focus inside while it is open
      const list = focusables();
      if (!list.length) return;
      const first = list[0], last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
  // The tuner is a panel on every page of the main site, not a page of its own
  const tuner = document.getElementById('tunerBtn');
  sheet.querySelectorAll('[data-open-tuner]').forEach(el => {
    if (!tuner) {
      el.hidden = true;
      return;
    }
    el.addEventListener('click', () => {
      close(false);
      tuner.click();
    });
  });
}

let ready = false;
export function initSiteNav() {
  if (ready) return;
  ready = true;
  document.querySelectorAll('.nav-menu-btn[aria-controls]').forEach(initDropdown);
  document.querySelectorAll('#toolsSheetBtn').forEach(initSheet);
  // "Tune up" on the home page and the like: the tuner panel (the sheet's own entry is set up above)
  const tuner = document.getElementById('tunerBtn');
  document.querySelectorAll('[data-open-tuner]').forEach(el => {
    if (el.closest('.tools-sheet')) return;
    if (!tuner) el.hidden = true;
    else el.addEventListener('click', () => tuner.click());
  });
  // A page that isn't one of the main site's views (the Stem Separator) says where it belongs itself
  const own = document.body.dataset.nav;
  if (own) setActiveNav(own);
}

// (no document when Node imports the modules for the tests)
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initSiteNav, { once: true });
  else initSiteNav();
}
