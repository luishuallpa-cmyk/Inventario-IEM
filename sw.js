/* IEM Inventario — Service Worker v4.7.3
 * - Precache del shell (HTML/CSS/JS/iconos)
 * - Network-first en HTML/JS/CSS → actualizaciones rápidas
 * - Cache-first en imágenes/iconos
 * - Offline: responde con index.html / assets en caché
 * - No intercepta Supabase ni CDNs
 */
const SW_VERSION = '4.7.3';
const CACHE = 'iem-inventario-v' + SW_VERSION;

const PRECACHE = [
  './',
  './index.html',
  './iem-core.js',
  './app.js',
  './style.css',
  './admin.css',
  './config.js',
  './sw.js',
  './manifest.webmanifest',
  './logo-iem.png',
  './icon-192.png',
  './icon-512.png',
  './icon-512-maskable.png',
  './apple-touch-icon.png',
  './favicon-32.png',
  './favicon-64.png'
];

function sameOrigin(url) {
  try {
    return url.origin === self.location.origin;
  } catch (e) {
    return false;
  }
}

function isBypass(url) {
  var h = url.hostname || '';
  if (h.indexOf('supabase') !== -1) return true;
  if (h.indexOf('cdnjs') !== -1 || h.indexOf('cdn.jsdelivr') !== -1) return true;
  if (h.indexOf('unpkg') !== -1 || h.indexOf('googleapis') !== -1) return true;
  if (h.indexOf('gstatic') !== -1) return true;
  return false;
}

function isShell(url) {
  if (!sameOrigin(url)) return false;
  var p = url.pathname || '';
  if (/\.(js|css)(\?|$)/i.test(p)) return true;
  if (/index\.html$/i.test(p)) return true;
  if (/sw\.js$/i.test(p)) return true;
  if (/manifest\.webmanifest$/i.test(p)) return true;
  if (p.endsWith('/') || p === '' || p === self.registration.scope.replace(self.location.origin, '')) return true;
  return false;
}

function isAsset(url) {
  if (!sameOrigin(url)) return false;
  return /\.(png|jpg|jpeg|gif|webp|svg|ico|woff2?)(\?|$)/i.test(url.pathname || '');
}

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      // addAll falla si un recurso falla; precache uno a uno
      return Promise.all(
        PRECACHE.map(function (url) {
          return cache.add(url).catch(function (err) {
            console.warn('[SW] precache skip', url, err);
          });
        })
      );
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.map(function (k) {
          if (k !== CACHE) return caches.delete(k);
        })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener('message', function (event) {
  var data = event.data || {};
  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (data.type === 'GET_VERSION' && event.ports && event.ports[0]) {
    event.ports[0].postMessage({ version: SW_VERSION, cache: CACHE });
  }
  if (data.type === 'CLEAR_CACHE') {
    event.waitUntil(
      caches.keys().then(function (keys) {
        return Promise.all(keys.map(function (k) { return caches.delete(k); }));
      }).then(function () {
        if (event.ports && event.ports[0]) {
          event.ports[0].postMessage({ ok: true });
        }
      })
    );
  }
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;

  var url;
  try {
    url = new URL(req.url);
  } catch (e) {
    return;
  }

  if (isBypass(url)) return;

  // Navegación (abrir la app / F5): network-first → offline index.html
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req, { cache: 'no-store' })
        .then(function (res) {
          if (res && res.ok) {
            var copy = res.clone();
            caches.open(CACHE).then(function (c) {
              c.put('./index.html', copy);
            }).catch(function () {});
          }
          return res;
        })
        .catch(function () {
          return caches.match('./index.html').then(function (cached) {
            return cached || caches.match('./');
          });
        })
    );
    return;
  }

  // Shell JS/CSS/HTML: network-first (actualizaciones), fallback caché
  if (isShell(url)) {
    event.respondWith(
      fetch(req, { cache: 'no-store' })
        .then(function (res) {
          if (res && res.ok) {
            var copy = res.clone();
            caches.open(CACHE).then(function (c) {
              // Guardar sin query string para match más fiable
              try {
                var clean = url.pathname;
                c.put(req, copy);
                if (clean.indexOf('app.js') !== -1) c.put('./app.js', res.clone()).catch(function () {});
                if (clean.indexOf('style.css') !== -1) c.put('./style.css', res.clone()).catch(function () {});
                if (clean.indexOf('iem-core.js') !== -1) c.put('./iem-core.js', res.clone()).catch(function () {});
              } catch (e) {}
            }).catch(function () {});
          }
          return res;
        })
        .catch(function () {
          return caches.match(req).then(function (cached) {
            if (cached) return cached;
            // fallback sin query
            var path = url.pathname.split('/').pop() || 'index.html';
            return caches.match('./' + path);
          });
        })
    );
    return;
  }

  // Imágenes / iconos: cache-first
  if (isAsset(url)) {
    event.respondWith(
      caches.match(req).then(function (cached) {
        if (cached) return cached;
        return fetch(req).then(function (res) {
          if (res && res.ok) {
            var copy = res.clone();
            caches.open(CACHE).then(function (c) { c.put(req, copy); }).catch(function () {});
          }
          return res;
        }).catch(function () {
          return caches.match('./logo-iem.png');
        });
      })
    );
    return;
  }

  // Resto mismo origen: stale-while-revalidate
  if (sameOrigin(url)) {
    event.respondWith(
      caches.match(req).then(function (cached) {
        var net = fetch(req).then(function (res) {
          if (res && res.ok) {
            var copy = res.clone();
            caches.open(CACHE).then(function (c) { c.put(req, copy); }).catch(function () {});
          }
          return res;
        }).catch(function () { return cached; });
        return cached || net;
      })
    );
  }
});
