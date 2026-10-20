/* TinTito offline shell. Never touches /ws. */
const VERSION = 'tintito-v6';
const SHELL = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/terminal.js',
  '/manifest.webmanifest',
  '/privacy.html',
  '/tintito-logo.svg',
  '/icons/icon-180.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/fonts/JetBrainsMono-Regular.woff2',
  '/fonts/JetBrainsMono-Bold.woff2',
  '/fonts/JetBrainsMono-Italic.woff2',
  '/fonts/JetBrainsMono-BoldItalic.woff2',
  '/fonts/IBMPlexMono-Regular.ttf',
  '/fonts/IBMPlexMono-Bold.ttf',
  '/fonts/IBMPlexMono-Italic.ttf',
  '/fonts/IBMPlexMono-BoldItalic.ttf',
  '/fonts/SpaceGrotesk-latin.woff2',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      .then((cache) => cache.addAll(SHELL))
      .catch(() => {})
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname === '/ws' || url.pathname === '/healthz') return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((cache) => cache.put('/index.html', copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match('/index.html').then((r) => r || caches.match('/')))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((cache) => cache.put(req, copy)).catch(() => {});
        }
        return res;
      });
    })
  );
});
