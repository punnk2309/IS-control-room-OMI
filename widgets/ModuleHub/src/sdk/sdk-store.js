/* ============================================================================
 * ModuleHub SDK Store Client — widgets/ModuleHub/src/sdk/sdk-store.js
 * ----------------------------------------------------------------------------
 * HOST-SIDE. Defines MHB.storeClient per contract §9 + §7.
 *
 * Public API:
 *   MHB.storeClient.init({ storeUrl, storeKey })  — idempotent
 *   MHB.storeClient.op(op, payload)               → Promise
 *     op ∈ 'tx.add' | 'tx.query' | 'kv.get' | 'kv.put'
 *   MHB.storeClient.status()                      → 'service'|'buffered'|'local'
 *
 * Modes (§9):
 *   storeUrl empty  → pure IndexedDB ('local'):
 *     tx store (autoIncrement, ns+ts index), kv store (key=[ns,key])
 *     tx.query filtered in JS with §7 semantics (limit default 500, ts DESC)
 *
 *   storeUrl set but unreachable → 'buffered':
 *     tx.add → write to 'txbuf' ring-buffer (50k newest); resolve {buffered:true}
 *     kv.*  / tx.query → try service, reject with error on failure
 *     30s reconnect loop replays txbuf oldest-first with buffered:true flag
 *
 *   storeUrl set and reachable → 'service'
 *
 * Contract: modulehub-contracts.md §7, §9
 * ========================================================================== */
(function () {
  'use strict';

  window.MHB = window.MHB || {};

  /* ── Internal state ───────────────────────────────────────────────────── */
  var _url    = '';      /* storeUrl (trailing slash stripped) */
  var _key    = '';      /* X-Api-Key value */
  var _status = 'local'; /* 'service' | 'buffered' | 'local' */
  var _db     = null;    /* IDBDatabase, opened lazily */
  var _dbReady = null;   /* Promise<IDBDatabase> */
  var _reconnectTimer = null;

  var TXBUF_MAX  = 50000;
  var RECONNECT_MS = 30000;
  var REQUEST_TIMEOUT_MS = 3000;
  var PUBLISH_TIMEOUT_MS = 10000;

  /* ── Status helpers ───────────────────────────────────────────────────── */
  function setStatus(s) {
    if (_status !== s) {
      _status = s;
      console.info('[MHB.storeClient] mode →', s);
    }
  }

  /* ── IndexedDB open ───────────────────────────────────────────────────── */
  function openDb() {
    if (_dbReady) { return _dbReady; }
    _dbReady = new Promise(function (resolve, reject) {
      var req = indexedDB.open('mhb-store', 1);
      req.onupgradeneeded = function (ev) {
        var db = ev.target.result;
        /* tx store */
        if (!db.objectStoreNames.contains('tx')) {
          var txStore = db.createObjectStore('tx', { autoIncrement: true, keyPath: 'id' });
          txStore.createIndex('ns_ts', ['ns', 'ts'], { unique: false });
          txStore.createIndex('ns',    'ns',          { unique: false });
        }
        /* kv store */
        if (!db.objectStoreNames.contains('kv')) {
          db.createObjectStore('kv', { keyPath: ['ns', 'key'] });
        }
        /* txbuf store (ring-buffer for offline buffering) */
        if (!db.objectStoreNames.contains('txbuf')) {
          db.createObjectStore('txbuf', { autoIncrement: true, keyPath: '_bufId' });
        }
      };
      req.onsuccess = function (ev) {
        _db = ev.target.result;
        resolve(_db);
      };
      req.onerror = function (ev) {
        reject(new Error('IndexedDB open failed: ' + ev.target.error));
      };
    });
    return _dbReady;
  }

  /* ── IDB helpers ──────────────────────────────────────────────────────── */
  function idbTx(storeName, mode) {
    return openDb().then(function (db) {
      return db.transaction(storeName, mode);
    });
  }

  function idbReq(request) {
    return new Promise(function (resolve, reject) {
      request.onsuccess = function () { resolve(request.result); };
      request.onerror   = function () { reject(request.error); };
    });
  }

  /* ── REST helpers ─────────────────────────────────────────────────────── */

  /**
   * Fetch with AbortController timeout (3 s).
   * Rejects with a typed error if network fails / times out.
   */
  function fetchWithTimeout(url, opts) {
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, REQUEST_TIMEOUT_MS);
    opts = Object.assign({}, opts, { signal: ctrl.signal });

    if (_key) {
      var headers = Object.assign({ 'X-Api-Key': _key }, opts.headers || {});
      opts.headers = headers;
    }

    return fetch(url, opts).then(function (r) {
      clearTimeout(timer);
      return r;
    }, function (err) {
      clearTimeout(timer);
      throw err;
    });
  }

  /* ── tx.add (local IDB) ───────────────────────────────────────────────── */
  function localTxAdd(payload) {
    var row = Object.assign({}, payload);
    if (!row.ts) { row.ts = Date.now(); }
    return idbTx('tx', 'readwrite').then(function (tx) {
      var store = tx.objectStore('tx');
      return idbReq(store.add(row)).then(function (id) {
        return { id: id };
      });
    });
  }

  /* ── tx.query (local IDB) ─────────────────────────────────────────────── */
  function localTxQuery(filter) {
    var limit = filter.limit !== undefined ? Number(filter.limit) : 500;
    return idbTx('tx', 'readonly').then(function (tx) {
      var store = tx.objectStore('tx');
      /* Collect all rows then filter in JS (§7 semantics) */
      return idbReq(store.getAll()).then(function (rows) {
        var ns = filter.ns;
        var results = rows.filter(function (r) {
          if (ns && r.ns !== ns)             { return false; }
          if (filter.from && r.ts < filter.from)   { return false; }
          if (filter.to   && r.ts > filter.to)     { return false; }
          if (filter.partId && r.partId !== filter.partId) { return false; }
          if (filter.action && r.action !== filter.action) { return false; }
          if (filter.slot &&
              r.fromSlot !== filter.slot &&
              r.toSlot   !== filter.slot) { return false; }
          return true;
        });
        /* ts DESC */
        results.sort(function (a, b) { return b.ts - a.ts; });
        if (limit > 0) { results = results.slice(0, limit); }
        return results;
      });
    });
  }

  /* ── kv.get (local IDB) ───────────────────────────────────────────────── */
  function localKvGet(ns, key) {
    return idbTx('kv', 'readonly').then(function (tx) {
      var store = tx.objectStore('kv');
      return idbReq(store.get([ns, key])).then(function (row) {
        return row ? row.value : null;
      });
    });
  }

  /* ── kv.put (local IDB) ───────────────────────────────────────────────── */
  function localKvPut(ns, key, value) {
    return idbTx('kv', 'readwrite').then(function (tx) {
      var store = tx.objectStore('kv');
      return idbReq(store.put({ ns: ns, key: key, value: value,
                                updated: Date.now() }));
    }).then(function () { return; });
  }

  /* ── txbuf helpers ────────────────────────────────────────────────────── */
  function txbufAdd(payload) {
    var row = Object.assign({}, payload);
    if (!row.ts) { row.ts = Date.now(); }
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var txn = db.transaction('txbuf', 'readwrite');
        var store = txn.objectStore('txbuf');

        /* Count first to enforce ring-buffer limit */
        var countReq = store.count();
        countReq.onsuccess = function () {
          var count = countReq.result;
          var addFn = function () {
            var addReq = store.add(row);
            addReq.onsuccess = function () { resolve({ buffered: true }); };
            addReq.onerror   = function () { reject(addReq.error); };
          };

          if (count >= TXBUF_MAX) {
            /* Delete oldest (lowest auto-key) to maintain ring */
            var cursorReq = store.openCursor();
            cursorReq.onsuccess = function () {
              var cursor = cursorReq.result;
              if (cursor) {
                cursor.delete();
                addFn();
              } else {
                addFn();
              }
            };
            cursorReq.onerror = function () { addFn(); };
          } else {
            addFn();
          }
        };
        countReq.onerror = function () { reject(countReq.error); };
      });
    });
  }

  /* ── Service REST ops ─────────────────────────────────────────────────── */

  function serviceOp(op, payload) {
    var base = _url;
    if (op === 'tx.add') {
      return fetchWithTimeout(base + '/tx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).then(function (r) {
        if (!r.ok) {
          return r.json().then(function (e) {
            throw new Error('tx.add service error ' + r.status + ': ' + (e.error || r.statusText));
          });
        }
        return r.json();
      });
    }

    if (op === 'tx.query') {
      var qs = buildQuery(payload);
      return fetchWithTimeout(base + '/tx' + qs, { method: 'GET' })
        .then(function (r) {
          if (!r.ok) { throw new Error('tx.query service error ' + r.status); }
          return r.json();
        });
    }

    if (op === 'kv.get') {
      return fetchWithTimeout(base + '/kv/' +
          encodeURIComponent(payload.ns) + '/' +
          encodeURIComponent(payload.key), { method: 'GET' })
        .then(function (r) {
          if (r.status === 404) { return null; }
          if (!r.ok) { throw new Error('kv.get service error ' + r.status); }
          return r.json().then(function (j) { return j.value; });
        });
    }

    if (op === 'kv.put') {
      return fetchWithTimeout(base + '/kv/' +
          encodeURIComponent(payload.ns) + '/' +
          encodeURIComponent(payload.key), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: payload.value }),
      }).then(function (r) {
        if (!r.ok) { throw new Error('kv.put service error ' + r.status); }
        return;
      });
    }

    /* ── Module library ops (service mode only) ─────────────────────────── */

    if (op === 'mod.list') {
      return fetchWithTimeout(base + '/modules', { method: 'GET' })
        .then(function (r) {
          if (!r.ok) { throw new Error('mod.list service error ' + r.status); }
          return r.json();
        });
    }

    if (op === 'mod.publish') {
      /* payload: { manifest, files, force? } */
      var pubUrl = base + '/modules' + (payload.force ? '?force=1' : '');
      var pubCtrl = new AbortController();
      var pubTimer = setTimeout(function () { pubCtrl.abort(); }, PUBLISH_TIMEOUT_MS);
      var pubOpts = {
        method: 'POST',
        headers: Object.assign(
          { 'Content-Type': 'application/json' },
          _key ? { 'X-Api-Key': _key } : {}
        ),
        body: JSON.stringify({ manifest: payload.manifest, files: payload.files }),
        signal: pubCtrl.signal,
      };
      return fetch(pubUrl, pubOpts).then(function (r) {
        clearTimeout(pubTimer);
        if (r.status === 409) {
          return r.json().then(function (e) {
            throw new Error('version-conflict: ' + (e.error || 'version already exists'));
          });
        }
        if (!r.ok) {
          return r.json().then(function (e) {
            throw new Error('mod.publish service error ' + r.status + ': ' + (e.error || r.statusText));
          });
        }
        return r.json();
      }, function (err) {
        clearTimeout(pubTimer);
        throw err;
      });
    }

    if (op === 'mod.fetch') {
      /* payload: { id, file } — resolves TEXT */
      return fetchWithTimeout(
        base + '/modules/' + encodeURIComponent(payload.id) + '/' + encodeURIComponent(payload.file),
        { method: 'GET' }
      ).then(function (r) {
        if (!r.ok) { throw new Error('mod.fetch service error ' + r.status + ' for ' + payload.id + '/' + payload.file); }
        return r.text();
      });
    }

    return Promise.reject(new Error('Unknown op: ' + op));
  }

  /* Build query-string from tx.query filter object. */
  function buildQuery(filter) {
    var parts = [];
    ['ns', 'from', 'to', 'partId', 'slot', 'action', 'limit'].forEach(function (k) {
      if (filter[k] !== undefined && filter[k] !== null) {
        parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(filter[k]));
      }
    });
    return parts.length ? '?' + parts.join('&') : '';
  }

  /* ── Reconnect / replay loop ──────────────────────────────────────────── */
  function startReconnectLoop() {
    if (_reconnectTimer) { return; }
    _reconnectTimer = setInterval(replayTxbuf, RECONNECT_MS);
  }

  function stopReconnectLoop() {
    if (_reconnectTimer) {
      clearInterval(_reconnectTimer);
      _reconnectTimer = null;
    }
  }

  function replayTxbuf() {
    if (!_url) { return; }
    openDb().then(function (db) {
      /* Probe health */
      return fetchWithTimeout(_url + '/health', { method: 'GET' })
        .then(function (r) {
          if (!r.ok) { throw new Error('health check failed'); }
          setStatus('service');
          stopReconnectLoop();
          return replayAll(db);
        })
        .catch(function () {
          setStatus('buffered');
        });
    });
  }

  function replayAll(db) {
    /* Read all txbuf rows first (completes the read transaction synchronously),
     * then replay each one via fetch and delete by key in a separate transaction.
     * This avoids IDB TransactionInactiveError from async fetch inside cursor loop. */
    return idbTx('txbuf', 'readonly').then(function (readTxn) {
      return idbReq(readTxn.objectStore('txbuf').getAll());
    }).then(function (rows) {
      /* Replay oldest-first (getAll returns in insertion order for autoIncrement) */
      return rows.reduce(function (chain, row) {
        return chain.then(function (ok) {
          if (!ok) { return false; } /* previous network error — stop */
          var entry = Object.assign({}, row, { buffered: true });
          var bufId = entry._bufId;
          delete entry._bufId;
          return fetchWithTimeout(_url + '/tx', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify(entry),
          }).then(function (r) {
            if (r.ok || (r.status >= 400 && r.status < 500)) {
              /* Remove from txbuf in its own transaction */
              return idbTx('txbuf', 'readwrite').then(function (delTxn) {
                return idbReq(delTxn.objectStore('txbuf').delete(bufId));
              }).then(function () { return true; });
            }
            return true;
          }).catch(function () { return false; }); /* network error — stop */
        });
      }, Promise.resolve(true));
    }).catch(function () { /* IDB read error — no-op */ });
  }

  /* ── Main op dispatcher ───────────────────────────────────────────────── */
  function op(opName, payload) {
    /* Mode query — answered in any mode (used by sdk.store.status()) */
    if (opName === 'status') { return Promise.resolve(_status); }

    /* Module library ops require service mode */
    if (opName === 'mod.list' || opName === 'mod.publish' || opName === 'mod.fetch') {
      if (_status !== 'service') {
        return Promise.reject(new Error('module library requires service mode'));
      }
      return serviceOp(opName, payload);
    }

    /* Local-only mode (no storeUrl) */
    if (!_url) {
      if (opName === 'tx.add')   { return localTxAdd(payload); }
      if (opName === 'tx.query') { return localTxQuery(payload); }
      if (opName === 'kv.get')   { return localKvGet(payload.ns, payload.key); }
      if (opName === 'kv.put')   { return localKvPut(payload.ns, payload.key, payload.value); }
      return Promise.reject(new Error('Unknown op: ' + opName));
    }

    /* Service or buffered mode */
    if (_status === 'service') {
      return serviceOp(opName, payload).catch(function (err) {
        /* Network failure — transition to buffered */
        setStatus('buffered');
        startReconnectLoop();
        if (opName === 'tx.add') {
          return txbufAdd(payload);
        }
        return Promise.reject(err);
      });
    }

    /* Buffered mode */
    if (opName === 'tx.add') {
      return txbufAdd(payload);
    }
    /* kv and tx.query: try service; reject clearly on failure */
    return serviceOp(opName, payload).catch(function (err) {
      return Promise.reject(new Error('[MHB.storeClient] buffered mode — service unreachable for ' +
          opName + ': ' + err.message));
    });
  }

  /* ── Public API ───────────────────────────────────────────────────────── */

  var storeClient = {

    /**
     * Initialise the store client. Idempotent (re-calling with same args is no-op).
     * @param {{ storeUrl: string, storeKey: string }} opts
     */
    init: function (opts) {
      var newUrl = opts && opts.storeUrl ? opts.storeUrl.replace(/\/+$/, '') : '';
      var newKey = opts && opts.storeKey ? opts.storeKey : '';

      if (newUrl === _url && newKey === _key) { return; }
      _url = newUrl;
      _key = newKey;

      stopReconnectLoop();

      if (!_url) {
        setStatus('local');
        /* Pre-open IDB so first ops are fast */
        openDb().catch(function (e) {
          console.warn('[MHB.storeClient] IndexedDB open warning:', e.message);
        });
      } else {
        /* Probe the service to determine initial mode */
        fetchWithTimeout(_url + '/health', { method: 'GET' })
          .then(function (r) {
            if (r.ok) {
              setStatus('service');
            } else {
              setStatus('buffered');
              startReconnectLoop();
            }
          })
          .catch(function () {
            setStatus('buffered');
            startReconnectLoop();
          });
      }
    },

    /**
     * Execute a store operation.
     * @param {'tx.add'|'tx.query'|'kv.get'|'kv.put'} opName
     * @param {object} payload
     * @returns {Promise}
     */
    op: op,

    /**
     * Returns current mode.
     * @returns {'service'|'buffered'|'local'}
     */
    status: function () { return _status; },
  };

  MHB.storeClient = storeClient;

}());
