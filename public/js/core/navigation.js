/**
 * Client-side routing between the site's views. The server sends index.html
 * for each of these paths (see StaticController).
 *
 * Links with a data-target (the header, the dashboard cards) are real links
 * to these paths, so they also work in a new tab; a plain click switches the
 * view here instead of reloading the page.
 */
import { routeForView } from './routes.js';

const VIEW_PATHS = {
  'view-home': '/',
  'view-carnatic': '/carnatic',
  'view-hindustani': '/hindustani',
  'view-lehra': '/lehra',
  'view-notation': '/notation',
  'view-practice': '/practice',
  'view-games': '/games',
};

const PATH_VIEWS = {
  carnatic: ['view-carnatic', 'carnatic'],
  hindustani: ['view-hindustani', 'hindustani'],
  lehra: ['view-lehra', 'hindustani'],
  notation: ['view-notation', 'hindustani'],
  practice: ['view-practice', 'stem'],
  games: ['view-games', 'games'],
};

const leaveHooks = [];
const enterHooks = [];

/** Run `fn` whenever the user switches view (e.g. to stop playback). */
export function onLeaveView(fn) {
  leaveHooks.push(fn);
}

/** Run `fn(viewId)` once a view is showing (e.g. to refresh what it displays). */
export function onEnterView(fn) {
  enterHooks.push(fn);
}

/** The view showing now, e.g. 'view-lehra'. */
export function currentView() {
  return document.querySelector('.app-view.active-view')?.id || null;
}

/**
 * The page's title, description, canonical URL and social tags follow the
 * view — the same values the static build bakes into each route's page
 * (core/routes.js), so a shared or bookmarked page names what is on it.
 */
function updateHead(target) {
  const route = routeForView(target);
  if (!route) return;
  document.title = route.title;
  const set = (selector, value) => document.querySelector(selector)?.setAttribute('content', value);
  set('meta[name="description"]', route.description);
  set('meta[property="og:title"]', route.title);
  set('meta[property="og:description"]', route.description);
  set('meta[name="twitter:title"]', route.title);
  set('meta[name="twitter:description"]', route.description);
  set('meta[name="robots"]', route.index === false ? 'noindex, follow' : 'index, follow');

  const url = siteOrigin() + route.path;
  set('meta[property="og:url"]', url);
  // Pages kept out of search results have no canonical URL
  let canonical = document.querySelector('link[rel="canonical"]');
  if (route.index === false) {
    canonical?.remove();
  } else {
    if (!canonical) {
      canonical = document.createElement('link');
      canonical.rel = 'canonical';
      document.head.appendChild(canonical);
    }
    canonical.href = url;
  }
}

let origin = null;
/**
 * The site's address for canonical URLs: the one the static build baked into
 * the page (the production domain — also on a preview deployment), else the
 * address this page was loaded from.
 */
function siteOrigin() {
  if (origin === null) {
    const baked = document.querySelector('meta[property="og:url"]')?.getAttribute('content') || '';
    try {
      origin = /^https?:\/\//.test(baked) ? new URL(baked).origin : window.location.origin;
    } catch {
      origin = window.location.origin;
    }
  }
  return origin;
}

/** After a click or Back/Forward, start reading (and tabbing) from the new page's heading. */
function focusView(target) {
  const view = document.getElementById(target);
  // (a page baked by the static build marks the other views' headings with role="heading")
  const el = view?.querySelector('h1, [role="heading"][aria-level="1"]') || view;
  if (!el) return;
  if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
  el.setAttribute('data-route-focus', '');
  el.focus({ preventScroll: true });
}

export function navigateTo(target, domain) {
  leaveHooks.forEach(fn => fn());
  updateHead(target);

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
  if (view) enterHooks.forEach(fn => fn(target));
}

function go(target, domain) {
  navigateTo(target, domain);
  window.history.pushState({ target, domain }, '', VIEW_PATHS[target] || '/');
  window.scrollTo({ top: 0, behavior: 'instant' });
  focusView(target);
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
  } else {
    updateHead('view-home');
  }

  // "Skip to content": move the focus without touching the URL's #hash
  // (a hash change would count as a navigation and stop what is playing).
  document.querySelector('.skip-link')?.addEventListener('click', e => {
    e.preventDefault();
    document.getElementById('main')?.focus();
  });

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

  // Browser Back/Forward. An entry without our state (e.g. a link that only
  // changed the #hash) shows the page its path names.
  window.addEventListener('popstate', e => {
    const [target, domain] = e.state && e.state.target
      ? [e.state.target, e.state.domain]
      : PATH_VIEWS[window.location.pathname.replace(/^\/|\/$/g, '')] || ['view-home', null];
    navigateTo(target, domain);
    focusView(target);
  });
}
