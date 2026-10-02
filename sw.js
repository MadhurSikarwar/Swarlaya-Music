// ── Caching strategy ─────────────────────────────────────────────────────────
// Pages, scripts and styles are NETWORK-FIRST: a deploy reaches visitors on
// their next load, and the cache only serves them when offline.
// Media under /assets/ (lehra .aac files, tanpura, metronome) is CACHE-FIRST:
// those files are large and never change in place.
//
// The cache name is a hash of the precache list + CONTENT_VERSION. Bump
// CONTENT_VERSION only if a file under /assets/ is replaced in place;
// everything else updates on its own.
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './favicon.ico',
  './public/css/style.css',
  './public/js/main.js',
  './public/js/carnatic/index.js',
  './public/js/carnatic/shruti.js',
  './public/js/carnatic/talam.js',
  './public/js/carnatic/talas.js',
  './public/js/core/audio-context.js',
  './public/js/core/audio-output.js',
  './public/js/core/dom.js',
  './public/js/core/mic.js',
  './public/js/core/modals.js',
  './public/js/core/media-session.js',
  './public/js/core/navigation.js',
  './public/js/core/pwa.js',
  './public/js/core/routes.js',
  './public/js/core/share.js',
  './public/js/core/toast.js',
  './public/js/games/index.js',
  './public/js/games/rules.js',
  './public/js/games/sam-game.js',
  './public/js/games/store.js',
  './public/js/games/swar-game.js',
  './public/js/lehra/audio.js',
  './public/js/lehra/catalogue.js',
  './public/js/lehra/controls.js',
  './public/js/lehra/engine.js',
  './public/js/lehra/engine.worklet.js',
  './public/js/lehra/export.js',
  './public/js/lehra/export-format.js',
  './public/js/lehra/export-render.js',
  './public/js/lehra/export.worker.js',
  './public/js/lehra/finder.js',
  './public/js/lehra/index.js',
  './public/js/lehra/intonation.js',
  './public/js/lehra/laya.js',
  './public/js/lehra/metronome.js',
  './public/js/lehra/mini-player.js',
  './public/js/lehra/mixer.js',
  './public/js/lehra/mp3.worker.js',
  './public/js/lehra/player.js',
  './public/js/lehra/practice.js',
  './public/js/lehra/recorder.js',
  './public/js/lehra/resume.js',
  './public/js/lehra/riyaz.js',
  './public/js/lehra/scheduler.js',
  './public/js/lehra/selection.js',
  './public/js/lehra/settings.js',
  './public/js/lehra/state.js',
  './public/js/lehra/taal-circle.js',
  './public/js/lehra/tanpura.js',
  './public/js/lehra/theka.js',
  './public/js/lehra/ui.js',
  './public/js/lehra/visuals.js',
  './public/js/lehra/wakelock.js',
  './public/js/notation/library.js',
  './public/js/notation/notation.js',
  './public/js/notation/synth.js',
  './public/js/practice/index.js',
  './public/js/practice/song.js',
  './public/js/tuner/analysis.js',
  './public/js/tuner/pitch.worklet.js',
  './public/js/tuner/swar.js',
  './public/js/tuner/tuner.js',
  './public/icons/icon.svg',
  './public/icons/icon-192.png',
  './assets/Metronome.aac',
  './assets/MetronomeUp.aac',
  './assets/tanpura_06_01.wav'
];

const CONTENT_VERSION = 4;

// Simple deterministic hash of the asset list + content version (djb2 variant).
const _hashSource = [...ASSETS, `v${CONTENT_VERSION}`];
const _assetHash = _hashSource.reduce((hash, asset) => {
  let h = hash;
  for (let i = 0; i < asset.length; i++) {
    h = ((h << 5) - h) + asset.charCodeAt(i);
    h |= 0;
  }
  return h >>> 0; // unsigned 32-bit
}, 5381).toString(16);

const CACHE_NAME = `lehra-studio-${_assetHash}`;

self.addEventListener('install', event => {
  // Activate this new worker immediately instead of waiting for every open
  // tab to close.
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
});

// Only keep complete, successful responses: caching an error (or a 206
// partial) would pin it for every later visit.
function remember(request, response) {
  if (response.status === 200) {
    const copy = response.clone();
    caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
  }
  return response;
}

async function cacheFirst(request) {
  const hit = await caches.match(request);
  return hit || remember(request, await fetch(request));
}

async function networkFirst(request) {
  try {
    return remember(request, await fetch(request));
  } catch (err) {
    // Offline: the precached copies are stored without their ?v= query.
    const hit = await caches.match(request, { ignoreSearch: true })
      || (request.mode === 'navigate' ? await caches.match('./index.html') : undefined);
    if (hit) return hit;
    throw err;
  }
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  // Other origins (Google Fonts, the PDF library's CDN) use the browser cache;
  // the API and the separator app are never cached here.
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') ||
      url.pathname.startsWith('/separator') ||
      url.pathname.startsWith('/_next')) {
    return;
  }

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(request));
  } else {
    event.respondWith(networkFirst(request));
  }
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});
