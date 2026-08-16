/* IEM Inventario — Service Worker (PWA)
   Cachea la interfaz para abrir más rápido y tolerar cortes breves de red.
   Los datos (Supabase) siempre van por red. */
const CACHE = 'iem-inventario-v3.51';
const PRECACHE = [
  './',
  './index.html',
  './style.css',
  './admin.css',
  './app.js',
  './config.js',
  './manifest.webmanifest',
  './vendedores.html',
  './vendedores.js',
  './vendedores.css',
  './manifest-vendedores.webmanifest',
  './logo-iem.png',
  './icon-192.png',
  './icon-512.png',
  './icon-512-maskable.png',
  './apple-touch-icon.png',
  './favicon-32.png',
  './favicon-64.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
      .catch((err) => console.warn('[sw] precache', err))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // No interceptar APIs externas (Supabase, CDN, etc.)
  if (url.origin !== self.location.origin) return;

  // Navegación / HTML: red primero, fallback a cache
  if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Estáticos: cache primero, luego red
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
