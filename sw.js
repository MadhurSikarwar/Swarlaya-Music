// ── Cache version ────────────────────────────────────────────────────────────
// FIX: The cache version is now derived from a hash of the asset list rather
// than a manually bumped integer. When you add or remove assets, the list hash
// changes automatically, forcing clients to pick up the new cache without
// requiring a manual version string update in a CI/CD pipeline.
//
// HOW TO INVALIDATE: Add, remove, or rename any entry in ASSETS below.
// The CACHE_VERSION string will then be different and old caches get purged.
const ASSETS = [
  './',
  './index.html',
  './public/css/style.css',
  './public/js/notation.js',
  './public/js/app.js',
  './public/js/catalogue.js',
  './assets/Metronome.aac',
  './assets/MetronomeUp.aac',
  './assets/tanpura_06_01.wav'
];

// Simple deterministic hash of the asset list (djb2 variant).
// Changing any entry above changes this value and busts the old cache.
const _assetHash = ASSETS.reduce((hash, asset) => {
  let h = hash;
  for (let i = 0; i < asset.length; i++) {
    h = ((h << 5) - h) + asset.charCodeAt(i);
    h |= 0;
  }
  return h >>> 0; // unsigned 32-bit
}, 5381).toString(16);

const CACHE_NAME = `lehra-studio-${_assetHash}`;

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(ASSETS);
    })
  );
});

self.addEventListener('fetch', event => {
  // Only cache GET requests, and don't cache API calls in the Service Worker
  // (We'll use IndexedDB for the heavy audio API calls)
  if (
    event.request.method !== 'GET' ||
    event.request.url.includes('/api/') ||
    event.request.url.includes('/separator') ||
    event.request.url.includes('/_next')
  ) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then(response => {
      return response || fetch(event.request).then(fetchRes => {
        return caches.open(CACHE_NAME).then(cache => {
          cache.put(event.request, fetchRes.clone());
          return fetchRes;
        });
      });
    })
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      );
    })
  );
});
