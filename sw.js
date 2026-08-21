/* IEM Inventario — SW v4.5.14: network-first shell, limpia cachés viejos */
const CACHE = 'iem-inventario-v4.5.14';
const PRECACHE = [
  './',
  './index.html',
  './app.js',
  './iem-core.js',
  './style.css',
  './admin.css',
  './config.js',
  './manifest.webmanifest',
  './logo-iem.png',
  './icon-192.png',
  './icon-512.png',
  './favicon-32.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(PRECACHE).catch(function () {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname.indexOf('supabase') !== -1) return;
  if (url.hostname.indexOf('cdn') !== -1 || url.hostname.indexOf('unpkg') !== -1) return;

  const isShell =
    url.origin === self.location.origin &&
    (/\.(js|css)(\?|$)/.test(url.pathname) ||
      /index\.html$/.test(url.pathname) ||
      url.pathname.endsWith('/') ||
      /sw\.js$/.test(url.pathname));

  if (isShell) {
    event.respondWith(
      fetch(req, { cache: 'no-store' }).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(function () {});
        }
        return res;
      }).catch(() => caches.match(req))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      const net = fetch(req).then((res) => {
        if (res && res.ok && url.origin === self.location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(function () {});
        }
        return res;
      }).catch(() => cached);
      return cached || net;
    })
  );
});
