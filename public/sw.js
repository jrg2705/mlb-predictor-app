// sw.js — Minimal service worker, required by Chrome to consider the app installable.
// This does not cache aggressively; it just needs to be registered and control fetch.

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  // Pass-through: always fetch from network, no offline caching for now.
  event.respondWith(fetch(event.request));
});
