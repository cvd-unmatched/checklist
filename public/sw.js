'use strict';
const CACHE = 'checklist-shell-v1';
const SHELL = ['/app.js', '/manifest.json', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', function (event) {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then(function (cache) { return cache.addAll(SHELL); }));
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

// Network-first for navigations/API, cache-first for the static shell assets.
self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.pathname.startsWith('/api/')) return;

  if (SHELL.includes(url.pathname)) {
    event.respondWith(
      caches.match(req).then(function (cached) {
        return cached || fetch(req).then(function (res) {
          var copy = res.clone();
          caches.open(CACHE).then(function (cache) { cache.put(req, copy); });
          return res;
        });
      })
    );
  }
});
