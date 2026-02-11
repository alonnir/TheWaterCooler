const CACHE_NAME = "thewatercooler-shell-v1";

self.addEventListener("install", (event) => {
  const scopePath = new URL(self.registration.scope).pathname;
  const APP_SHELL = [
    scopePath,
    `${scopePath}index.html`,
    `${scopePath}app.html`,
    `${scopePath}css/styles.css`,
    `${scopePath}js/firebase-config.js`,
    `${scopePath}js/auth.js`,
    `${scopePath}js/app.js`,
    `${scopePath}manifest.json`,
    `${scopePath}icons/icon-192.png`,
    `${scopePath}icons/icon-512.png`,
    `${scopePath}icons/apple-touch-icon.png`,
    `${scopePath}favicon.svg`
  ];

  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (!response || response.status !== 200) {
          return response;
        }
        const url = new URL(event.request.url);
        if (url.origin === self.location.origin) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      });
    })
  );
});
