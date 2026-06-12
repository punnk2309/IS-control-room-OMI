/* ============================================================================
 * ModuleHub — sandbox host-side bridge (MHB.runtime.sandbox)
 * ----------------------------------------------------------------------------
 * Owns the host side of the §5 iframe bridge protocol.
 *
 * Public API (called by loader.js):
 *   MHB.runtime.sandbox.create(opts) → sandbox instance
 *     opts: { moduleId, manifest, config, iframe, simulation, onTagSubscribe,
 *             onTagUnsubscribe, onWriteTag }
 *
 * Each instance exposes:
 *   .sendInit(themeTokens)     — send mh:init after iframe loads
 *   .sendTagValue(tag, v, q, ts)
 *   .sendTheme(tokens)
 *   .sendDestroy()
 *   .dispose()                 — remove message listener
 *
 * Contract: modulehub-contracts.md §5
 * ========================================================================== */
(function (MHB) {
  'use strict';

  var SDK_VERSION = '1.0';

  /* ── Glob permission helper ─────────────────────────────────────────────── */

  /** Translate a glob pattern (only * wildcard) to a regex string.
   *  "dryer.*" → "^dryer\\..*$", "smoke.*" → "^smoke\\..*$" */
  function globToRegex(glob) {
    var escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    var pattern = escaped.replace(/\*/g, '.*');
    return new RegExp('^' + pattern + '$');
  }

  /** Build the permission checker for tags. */
  function buildTagChecker(globs) {
    var regexes = (globs || []).map(globToRegex);
    return function (tag) {
      for (var i = 0; i < regexes.length; i++) {
        if (regexes[i].test(tag)) { return true; }
      }
      return false;
    };
  }

  /* ── Sandbox factory ────────────────────────────────────────────────────── */

  MHB.runtime.sandbox = {
    /** Create a sandbox instance bound to one iframe. */
    create: function (opts) {
      var moduleId       = opts.moduleId;
      var manifest       = opts.manifest;
      var config         = opts.config || (manifest && manifest.config) || {};
      var iframe         = opts.iframe;
      var simulation     = !!opts.simulation;
      var onTagSubscribe = opts.onTagSubscribe   || function () {};
      var onTagUnsubscribe = opts.onTagUnsubscribe || function () {};
      var onWriteTag     = opts.onWriteTag       || function () {};

      var permissions    = (manifest && manifest.permissions) || { tags: [], store: [] };
      var allowTag       = buildTagChecker(permissions.tags);
      var allowedNs      = permissions.store || [];

      var _disposed = false;

      /* ── Outbound helpers ─────────────────────────────────────────────── */

      function postToModule(msg) {
        if (_disposed) { return; }
        var win = iframe && iframe.contentWindow;
        if (!win) { return; }
        try {
          win.postMessage(Object.assign({ mh: 1 }, msg), '*');
        } catch (e) {
          console.warn('[MHB.sandbox] postMessage failed:', e);
        }
      }

      function result(reqId, ok, dataOrError) {
        var msg = { type: 'mh:result', reqId: reqId };
        if (ok) {
          msg.ok   = true;
          msg.data = dataOrError;
        } else {
          msg.ok    = false;
          msg.error = dataOrError;
        }
        postToModule(msg);
      }

      /* ── Inbound message handler ──────────────────────────────────────── */

      function onMessage(event) {
        if (_disposed) { return; }
        /* §5: validate source is this iframe */
        if (!iframe || event.source !== iframe.contentWindow) { return; }
        var d = event.data;
        if (!d || d.mh !== 1) { return; }

        switch (d.type) {

          case 'mh:hello':
            /* Reply is deferred to sendInit() — caller decides when ready */
            onTagSubscribe('__hello__');   // sentinel so loader knows iframe is live
            break;

          case 'mh:subscribe':
            if (!allowTag(d.tag)) {
              result(d.reqId, false, 'permission-denied: tag ' + d.tag);
              return;
            }
            onTagSubscribe(d.tag);
            result(d.reqId, true, null);
            break;

          case 'mh:unsubscribe':
            onTagUnsubscribe(d.tag);
            break;

          case 'mh:writeTag':
            if (!allowTag(d.tag)) {
              result(d.reqId, false, 'permission-denied: tag ' + d.tag);
              return;
            }
            onWriteTag(d.tag, d.value);
            result(d.reqId, true, null);
            break;

          case 'mh:store':
            handleStore(d);
            break;

          case 'mh:log':
            var prefix = '[MH:' + moduleId + ']';
            var level = d.level || 'log';
            var args = Array.isArray(d.args) ? d.args : [d.args];
            if (typeof console[level] === 'function') {
              console[level].apply(console, [prefix].concat(args));
            } else {
              console.log.apply(console, [prefix].concat(args));
            }
            break;

          case 'mh:resize':
            /* Optional height hint — ignore or relay to bus */
            MHB.bus.emit('module:resize', { moduleId: moduleId, height: d.height });
            break;

          default:
            break;
        }
      }

      /* ── Store routing ────────────────────────────────────────────────── */

      function handleStore(d) {
        var reqId   = d.reqId;
        var op      = d.op;
        var payload = d.payload || {};

        /* Whitelist allowed ops — modules must never reach mod.* */
        var ALLOWED_OPS = ['tx.add', 'tx.query', 'kv.get', 'kv.put', 'status'];
        if (ALLOWED_OPS.indexOf(op) === -1) {
          result(reqId, false, 'permission-denied: op ' + op);
          return;
        }

        /* Check namespace permission */
        var ns = payload.ns;
        if (ns && allowedNs.indexOf(ns) === -1) {
          result(reqId, false, 'permission-denied: store ns ' + ns);
          return;
        }

        /* Route to MHB.storeClient if available */
        var client = window.MHB && window.MHB.storeClient;
        if (!client || typeof client.op !== 'function') {
          result(reqId, false, 'store-unavailable');
          return;
        }

        client.op(op, payload)
          .then(function (data) { result(reqId, true, data); })
          .catch(function (err) { result(reqId, false, String(err && err.message || err)); });
      }

      /* ── Install listener ─────────────────────────────────────────────── */

      window.addEventListener('message', onMessage);

      /* ── Public instance API ──────────────────────────────────────────── */

      return {
        /** Send mh:init to the module (reply to mh:hello). */
        sendInit: function (themeTokens) {
          postToModule({
            type:       'mh:init',
            moduleId:   moduleId,
            manifest:   manifest,
            config:     config,
            theme:      { tokens: themeTokens || MHB.theme.tokens() },
            simulation: simulation,
            sdkVersion: SDK_VERSION,
            assets:     (window.MHB && window.MHB.assetData) || null,
          });
        },

        sendTagValue: function (tag, value, quality, ts) {
          postToModule({
            type:    'mh:tagValue',
            tag:     tag,
            value:   value,
            quality: quality,
            ts:      ts,
          });
        },

        sendTheme: function (tokens) {
          postToModule({ type: 'mh:theme', tokens: tokens });
        },

        sendDestroy: function () {
          postToModule({ type: 'mh:destroy' });
        },

        /** Remove the message listener. */
        dispose: function () {
          _disposed = true;
          window.removeEventListener('message', onMessage);
        },
      };
    },
  };
}(window.MHB));
