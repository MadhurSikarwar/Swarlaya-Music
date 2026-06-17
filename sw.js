const CACHE_NAME = 'lehra-studio-v1';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './catalogue.js',
  './assets/Metronome.aac',
  './assets/MetronomeUp.aac',
  './assets/tanpura_06_01.wav'
];

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
  if (event.request.method !== 'GET' || event.request.url.includes('/api/')) {
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
