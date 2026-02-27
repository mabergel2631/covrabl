// Covrabl Service Worker - PWA Support
// Bump this version on every deploy to invalidate old caches.
// Vercel injects unique build IDs into JS/CSS filenames, but the SW file
// itself must change for the browser to detect an update.
const CACHE_VERSION = '2026-02-26a';
const CACHE_NAME = `covrabl-${CACHE_VERSION}`;

// Only pre-cache true static assets (images, icons). Never HTML pages.
const STATIC_ASSETS = [
  '/manifest.json',
  '/icon-192.svg',
  '/icon-512.svg',
];

// Install - cache static assets and take over immediately
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch(() => {});
    })
  );
  self.skipWaiting();
});

// Activate - delete ALL old caches so stale content is never served
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// Fetch strategy:
// - Navigation requests (HTML pages): network-only, no caching
// - API requests: network-only, no caching
// - Static assets (JS, CSS, images): network-first with cache fallback
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  // Never cache API calls
  if (event.request.url.includes('/api/')) return;

  // Navigation requests (HTML pages) — always network, never cache
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => {
        return caches.match('/').then((cached) => {
          return cached || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
        });
      })
    );
    return;
  }

  // Static assets — network first, cache fallback for offline
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, clone);
          });
        }
        return response;
      })
      .catch(() => {
        return caches.match(event.request).then((cached) => {
          return cached || new Response('Offline', { status: 503 });
        });
      })
  );
});
