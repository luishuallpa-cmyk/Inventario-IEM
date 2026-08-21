/* IEM Inventario — núcleo compartido (versión + catálogo offline) */
(function (w) {
  'use strict';
  var VERSION = '4.8.1';
  var DB_NAME = 'iem_inventario_db';
  var DB_VER = 1;
  var STORE = 'catalogo';

  function openDb() {
    return new Promise(function (resolve, reject) {
      if (!w.indexedDB) {
        reject(new Error('IndexedDB no disponible'));
        return;
      }
      var req = w.indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE);
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function idbPut(key, value) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(value, key);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  function idbGet(key) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, 'readonly');
        var req = tx.objectStore(STORE).get(key);
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  /** Guarda catálogo para uso offline (IDB + localStorage de respaldo). */
  function guardarCatalogoOffline(data) {
    if (!data || !data.length) return Promise.resolve(false);
    var payload = { data: data, fechaISO: new Date().toISOString(), version: VERSION };
    var tasks = [];
    tasks.push(
      idbPut('productos', payload).catch(function (e) {
        console.warn('[IEM offline] IDB put', e);
      })
    );
    try {
      w.localStorage.setItem('buscador_respaldo_datos', JSON.stringify(payload));
    } catch (e) {
      console.warn('[IEM offline] localStorage lleno', e);
    }
    return Promise.all(tasks).then(function () { return true; });
  }

  /** Lee catálogo offline: primero IndexedDB, luego localStorage. */
  function leerCatalogoOffline() {
    return idbGet('productos')
      .then(function (payload) {
        if (payload && payload.data && payload.data.length) return payload;
        return null;
      })
      .catch(function () { return null; })
      .then(function (payload) {
        if (payload) return payload;
        try {
          var raw = w.localStorage.getItem('buscador_respaldo_datos');
          if (!raw) return null;
          var parsed = JSON.parse(raw);
          if (parsed && parsed.data && parsed.data.length) return parsed;
        } catch (e) {}
        return null;
      });
  }

  function setOfflineBadge(on, fechaTexto) {
    var el = document.getElementById('offlineBadge');
    if (!el) return;
    if (on) {
      el.hidden = false;
      el.textContent = fechaTexto
        ? ('📴 Offline · catálogo ' + fechaTexto)
        : '📴 Modo offline';
      el.classList.add('offline-badge-on');
    } else {
      el.hidden = true;
      el.classList.remove('offline-badge-on');
    }
  }

  w.IEM = w.IEM || {};
  w.IEM.VERSION = VERSION;
  w.IEM.guardarCatalogoOffline = guardarCatalogoOffline;
  w.IEM.leerCatalogoOffline = leerCatalogoOffline;
  w.IEM.setOfflineBadge = setOfflineBadge;
})(window);
