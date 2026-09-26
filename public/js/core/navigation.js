/**
 * Client-side routing between the site's views. The server sends index.html
 * for each of these paths (see StaticController).
 */

const VIEW_PATHS = {
  'view-home': '/',
  'view-carnatic': '/carnatic',
  'view-hindustani': '/hindustani',
  'view-lehra': '/lehra',
  'view-notation': '/notation',
};

const PATH_VIEWS = {
  carnatic: ['view-carnatic', 'carnatic'],
  hindustani: ['view-hindustani', 'hindustani'],
  lehra: ['view-lehra', 'hindustani'],
  notation: ['view-notation', 'hindustani'],
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
    v.classList.remove('active-view');
  });
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));

  // The Scale / pitch controls in the header belong to the Lehra player
  const pitchWrap = document.querySelector('.pitch-wrap');
  if (pitchWrap) pitchWrap.style.display = target === 'view-lehra' ? 'flex' : 'none';

  const view = document.getElementById(target);
  if (view) {
    view.style.display = '';
    view.classList.add('active-view');
  }

  // If no domain provided, try to infer it from the target view
  if (!domain && view) domain = view.getAttribute('data-domain');
  if (domain) {
    const navBtn = document.querySelector(`.nav-btn[data-domain="${domain}"]`);
    if (navBtn) navBtn.classList.add('active');
  }
}

function go(target, domain) {
  navigateTo(target, domain);
  window.history.pushState({ target, domain }, '', VIEW_PATHS[target] || '/');
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
    navigateTo(...PATH_VIEWS[path]);
  }

  // Dashboard cards dispatch 'nav-internal' (see index.html)
  document.addEventListener('nav-internal', e => {
    if (e.detail && e.detail.target) go(e.detail.target, e.detail.domain);
  });

  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      const target = e.currentTarget.getAttribute('data-target');
      if (!target) return;
      e.preventDefault();
      go(target, e.currentTarget.getAttribute('data-domain'));
    });
  });

  // Browser Back/Forward
  window.addEventListener('popstate', e => {
    if (e.state && e.state.target) navigateTo(e.state.target, e.state.domain);
    else navigateTo('view-home', null);
  });
}
