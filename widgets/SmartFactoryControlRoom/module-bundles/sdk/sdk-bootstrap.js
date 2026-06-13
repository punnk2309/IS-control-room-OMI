/* ============================================================================
 * ModuleHub SDK Bootstrap — widgets/ModuleHub/src/sdk/sdk-bootstrap.js
 * ----------------------------------------------------------------------------
 * MODULE-SIDE. Embedded as the FIRST script inside every sandboxed iframe.
 * Defines window.MH plus the extension registry MH._build = {}.
 * Other sdk-*.js files attach builders to MH._build.
 * Handles the §5 bridge protocol, sdk composition, and lifecycle.
 *
 * Contract: modulehub-contracts.md §4, §5, §6
 * ========================================================================== */
(function () {
  'use strict';

  var SDK_VERSION = '1.0';

  /* ── MH global ─────────────────────────────────────────────────────────── */
  var _reg = null;          // { create, destroy } from MH.register()
  var _sdk = null;          // composed sdk object passed to create()
  var _pending = {};        // reqId → { resolve, reject, timer }
  var _reqCounter = 0;

  var MH = {
    /** Called by module code: MH.register({ create, destroy }) */
    register: function (descriptor) {
      if (!descriptor || typeof descriptor.create !== 'function') {
        throw new Error('[MH] register() requires { create: fn }');
      }
      _reg = {
        create:  descriptor.create,
        destroy: typeof descriptor.destroy === 'function' ? descriptor.destroy : null,
      };
    },

    /** Extension builder registry — other SDK files populate this. */
    _build: {},
  };

  window.MH = MH;

  /* ── Bridge helpers ─────────────────────────────────────────────────────── */

  function genReqId() {
    _reqCounter += 1;
    return 'r' + _reqCounter + '_' + Math.random().toString(36).slice(2, 7);
  }

  /** Send a message to the host. Always includes mh:1 guard. */
  function send(msg) {
    window.parent.postMessage(Object.assign({ mh: 1 }, msg), '*');
  }

  /**
   * Send a request message and return a Promise that resolves/rejects when
   * the host replies with mh:result carrying the same reqId (10 s timeout).
   */
  function request(msg) {
    var id = genReqId();
    msg.reqId = id;
    var p = new Promise(function (resolve, reject) {
      var timer = setTimeout(function () {
        delete _pending[id];
        reject(new Error('[MH] request timeout: ' + msg.type));
      }, 10000);
      _pending[id] = { resolve: resolve, reject: reject, timer: timer };
    });
    send(msg);
    return p;
  }

  /* ── Message listener (installed immediately before mh:hello) ───────────── */

  function onMessage(event) {
    /* §5: validate source */
    if (event.source !== window.parent) { return; }
    var d = event.data;
    if (!d || d.mh !== 1) { return; }

    switch (d.type) {

      case 'mh:init':
        handleInit(d);
        break;

      case 'mh:result':
        handleResult(d);
        break;

      case 'mh:tagValue':
        /* Route to sdk.data handler if built */
        if (_sdk && _sdk._onTagValue) { _sdk._onTagValue(d); }
        break;

      case 'mh:theme':
        if (d.tokens) { applyTheme(d.tokens); }
        break;

      case 'mh:destroy':
        handleDestroy();
        break;
    }
  }

  window.addEventListener('message', onMessage);

  /* ── Handshake ──────────────────────────────────────────────────────────── */

  function sendHello() {
    send({ type: 'mh:hello', sdkVersion: SDK_VERSION });
  }

  /* ── Init handler — composes sdk and calls module create() ─────────────── */

  function handleInit(d) {
    /* Apply theme tokens from host */
    if (d.theme && d.theme.tokens) { applyTheme(d.theme.tokens); }

    /* Build root div filling body */
    var root = document.createElement('div');
    root.style.cssText = 'position:absolute;inset:0;overflow:hidden;';
    document.body.style.margin = '0';
    document.body.style.overflow = 'hidden';
    document.body.appendChild(root);

    /* Compose sdk from builders */
    var env = {
      moduleId:   d.moduleId,
      version:    (d.manifest && d.manifest.version) || '0.0.0',
      simulation: !!d.simulation,
      sdkVersion: d.sdkVersion || SDK_VERSION,
    };
    var config = d.config || {};

    var bridge = {
      send:    send,
      request: request,
    };

    var sdk = {
      env:    env,
      config: config,
      log: function () {
        var args = Array.prototype.slice.call(arguments);
        send({ type: 'mh:log', level: 'log', args: args });
      },
    };

    /* Built-in store surface (§6) — thin wrapper over mh:store requests.
       Status is async over the bridge, so cache it and refresh in the
       background; status() stays synchronous per contract. */
    var _storeStatus = 'local';
    function storeOp(op, payload) {
      return request({ type: 'mh:store', op: op, payload: payload || {} });
    }
    function refreshStoreStatus() {
      storeOp('status').then(function (s) {
        if (s) { _storeStatus = s; }
      }, function () { /* keep last known */ });
    }
    sdk.store = {
      tx: {
        add:   function (tx)     { return storeOp('tx.add', tx); },
        query: function (filter) { return storeOp('tx.query', filter); },
      },
      kv: {
        get: function (ns, key)        { return storeOp('kv.get', { ns: ns, key: key }); },
        put: function (ns, key, value) { return storeOp('kv.put', { ns: ns, key: key, value: value }); },
      },
      status: function () { refreshStoreStatus(); return _storeStatus; },
    };
    refreshStoreStatus();
    setInterval(refreshStoreStatus, 10000);

    /* Attach builder outputs */
    if (typeof MH._build.data === 'function') {
      var dataPkg = MH._build.data(bridge);
      sdk.data = dataPkg.api;
      sdk._onTagValue = dataPkg.onTagValue;
    }
    if (typeof MH._build.ui === 'function') {
      sdk.ui = MH._build.ui(bridge);
    }
    if (typeof MH._build.assets === 'function') {
      sdk.assets = MH._build.assets(bridge, d.assets || null);
    }
    if (typeof MH._build.store === 'function') {
      sdk.store = MH._build.store(bridge);
    }

    _sdk = sdk;

    /* Call module create() */
    if (_reg && typeof _reg.create === 'function') {
      try {
        _reg.create(sdk, root);
      } catch (e) {
        send({ type: 'mh:log', level: 'error', args: ['[MH] create() threw: ' + e.message] });
      }
    }
  }

  /* ── Result handler ─────────────────────────────────────────────────────── */

  function handleResult(d) {
    var entry = _pending[d.reqId];
    if (!entry) { return; }
    clearTimeout(entry.timer);
    delete _pending[d.reqId];
    if (d.ok) {
      entry.resolve(d.data);
    } else {
      entry.reject(new Error(d.error || 'mh:result error'));
    }
  }

  /* ── Destroy handler ────────────────────────────────────────────────────── */

  function handleDestroy() {
    if (_reg && typeof _reg.destroy === 'function') {
      try { _reg.destroy(); } catch (e) { /* ignore */ }
    }
  }

  /* ── Theme application ──────────────────────────────────────────────────── */

  function applyTheme(tokens) {
    var root = document.documentElement;
    Object.keys(tokens).forEach(function (name) {
      root.style.setProperty('--c-' + name, tokens[name]);
    });
  }

  /* ── DOM-ready send hello ───────────────────────────────────────────────── */

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', sendHello);
  } else {
    sendHello();
  }

}());
