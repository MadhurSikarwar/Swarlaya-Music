/**
 * Client-side routing between the site's views. The server sends index.html
 * for each of these paths (see StaticController).
 *
 * Links with a data-target (the header, the dashboard cards) are real links
 * to these paths, so they also work in a new tab; a plain click switches the
 * view here instead of reloading the page.
 */

const VIEW_PATHS = {
  'view-home': '/',
  'view-carnatic': '/carnatic',
  'view-hindustani': '/hindustani',
  'view-lehra': '/lehra',
  'view-notation': '/notation',
  'view-practice': '/practice',
};

const PATH_VIEWS = {
  carnatic: ['view-carnatic', 'carnatic'],
  hindustani: ['view-hindustani', 'hindustani'],
  lehra: ['view-lehra', 'hindustani'],
  notation: ['view-notation', 'hindustani'],
  practice: ['view-practice', 'stem'],
};

const leaveHooks = [];

/** Run `fn` whenever the user switches view (e.g. to stop playback). */
export function onLeaveView(fn) {
  leaveHooks.push(fn);
}

export function navigateTo(target, domain) {
  leaveHooks.forEach(fn => fn());

  // Hide all views
  document.querySelectorAll('.app-view').forEach(v => {
    v.style.display = 'none';
    v.classList.remove('active-view', 'entering');
  });
  document.querySelectorAll('.nav-btn').forEach(b => {
    b.classList.remove('active');
    b.removeAttribute('aria-current');
  });

  const view = document.getElementById(target);
  if (view) {
    view.style.display = '';
    view.classList.add('active-view');
    void view.offsetWidth; // restart the entrance animation
    view.classList.add('entering');
  }

  // If no domain provided, try to infer it from the target view
  if (!domain && view) domain = view.getAttribute('data-domain');
  if (domain) {
    const navBtn = document.querySelector(`.nav-btn[data-domain="${domain}"]`);
    if (navBtn) {
      navBtn.classList.add('active');
      navBtn.setAttribute('aria-current', 'page');
    }
  }
}

function go(target, domain) {
  navigateTo(target, domain);
  window.history.pushState({ target, domain }, '', VIEW_PATHS[target] || '/');
  window.scrollTo({ top: 0, behavior: 'instant' });
}

export function initNavigation() {
  // Initial view: legacy ?domain= links, then path-based routes
  const domainParam = new URLSearchParams(window.location.search).get('domain');
  const path = window.location.pathname.replace(/^\/|\/$/g, '');
  if (domainParam === 'carnatic' || domainParam === 'hindustani') {
    const [target, domain] = PATH_VIEWS[domainParam];
    navigateTo(target, domain);
    window.history.replaceState({ target, domain }, '', VIEW_PATHS[target]);
  } else if (PATH_VIEWS[path]) {
    const [target, domain] = PATH_VIEWS[path];
    navigateTo(target, domain);
    // So Back returns to this page (query included, e.g. /practice?job=…)
    window.history.replaceState({ target, domain }, '', window.location.href);
  }

  // Composition links dispatch 'nav-internal' (see notation.js)
  document.addEventListener('nav-internal', e => {
    if (e.detail && e.detail.target) go(e.detail.target, e.detail.domain);
  });

  // Header links, the logo and the dashboard cards. Modified clicks (new tab,
  // new window) are left to the browser.
  document.addEventListener('click', e => {
    const link = e.target.closest('[data-target]');
    if (!link || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const target = link.getAttribute('data-target');
    if (!document.getElementById(target)) return;
    e.preventDefault();
    go(target, link.getAttribute('data-domain'));
  });

  // Browser Back/Forward
  window.addEventListener('popstate', e => {
    if (e.state && e.state.target) navigateTo(e.state.target, e.state.domain);
    else navigateTo('view-home', null);
  });
}
