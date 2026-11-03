'use strict';

// Cache Storage is shared by every app on this origin. Only touch our scope.
const PREFIX = `cast-distance:${self.registration.scope}:`;
const CACHE = `${PREFIX}v2`;
const FILES = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png'];
const asset = path => new URL(path, self.registration.scope).href;

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE)
    .then(cache => cache.addAll(FILES.map(asset)))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(key => key.startsWith(PREFIX) && key !== CACHE)
      .map(key => caches.delete(key))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  const scope = new URL(self.registration.scope);
  if (event.request.method !== 'GET' || url.origin !== scope.origin ||
      !url.pathname.startsWith(scope.pathname)) return;

  event.respondWith(caches.open(CACHE).then(async cache => {
    // Both directory and index.html URLs (including launch query strings)
    // must start offline. Unknown URLs still use normal network behavior.
    const isHome = event.request.mode === 'navigate' &&
      (url.pathname === scope.pathname || url.pathname === new URL('index.html', scope).pathname);
    const cached = await cache.match(isHome ? asset('./index.html') : event.request);
    return cached || fetch(event.request);
  }));
});
