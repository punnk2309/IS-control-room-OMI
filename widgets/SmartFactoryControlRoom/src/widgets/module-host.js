/* ============================================================================
 * Widget: module-host — embeds a ModuleHub module served from modulehub-store
 * ----------------------------------------------------------------------------
 * options: {
 *   moduleId:  string  (required) — module id in the library
 *   storeUrl:  string  (required) — base URL of modulehub-store, e.g. 'http://localhost:8743'
 *   storeKey?: string  (optional) — value for X-Api-Key header
 *   tagMap?:   object  (optional) — map of module tag names → control-room datapoint ids
 * }
 *
 * Contract: docs/plans/modulehub-contracts.md §12 (binding), §4, §5, §7, §11.1
 * ========================================================================== */
(function (SFP) {
  'use strict';

  var SDK_VERSION = '1.0';

  /* §2 token names (the full list from contracts §2 + dark theme) */
  var TOKEN_NAMES = [
    'bg-base', 'bg-surface', 'bg-card', 'bg-raised',
    'border', 'border-strong',
    'text-1', 'text-2', 'text-3',
    'accent', 'accent-strong',
    'good', 'warn', 'alarm', 'info',
    'chart-1', 'chart-2', 'chart-3', 'chart-4',
  ];

  /* Op whitelist per §11.2 / §5 */
  var ALLOWED_OPS = { 'tx.add': true, 'tx.query': true, 'kv.get': true, 'kv.put': true, 'status': true };

  /* ── Glob→Regex helper (same as sandbox.js) ─────────────────────────────── */

  function globToRegex(glob) {
    var escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    var pattern = escaped.replace(/\*/g, '.*');
    return new RegExp('^' + pattern + '$');
  }

  function buildTagChecker(globs) {
    var regexes = (globs || []).map(globToRegex);
    return function (tag) {
      for (var i = 0; i < regexes.length; i++) {
        if (regexes[i].test(tag)) { return true; }
      }
      return false;
    };
  }

  /* ── Harvest theme tokens from live CSS vars ─────────────────────────────── */

  function harvestTokens() {
    var style = getComputedStyle(document.documentElement);
    var tokens = {};
    TOKEN_NAMES.forEach(function (name) {
      tokens[name] = style.getPropertyValue('--c-' + name).trim() || '#888888';
    });
    return tokens;
  }

  /* ── Escape </script in srcdoc-embedded code (§4) ───────────────────────── */

  function escScript(code) {
    return code.replace(/<\/script/gi, '<\\/script');
  }

  /* ── Build srcdoc HTML (§4 — bootstrap, data, ui, assets, module code) ──── */

  function buildSrcdoc(sdkTexts, moduleCode) {
    var parts = [
      '<!DOCTYPE html><html><head>',
      '<meta charset="UTF-8">',
      '<style>html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;background:transparent;}</style>',
      '</head><body>',
    ];
    var order = ['bootstrap', 'data', 'ui', 'assets'];
    order.forEach(function (key) {
      if (sdkTexts[key]) {
        parts.push('<script>' + escScript(sdkTexts[key]) + '<\/script>');
      }
    });
    parts.push('<script>' + escScript(moduleCode) + '<\/script>');
    parts.push('</body></html>');
    return parts.join('\n');
  }

  /* ── Fetch with 5 s timeout and X-Api-Key header ────────────────────────── */

  function fetchWithKey(url, storeKey) {
    var headers = {};
    if (storeKey) { headers['X-Api-Key'] = storeKey; }
    var controller;
    var timeoutId;
    var p;
    if (typeof AbortController !== 'undefined') {
      controller = new AbortController();
      timeoutId = setTimeout(function () { controller.abort(); }, 5000);
      p = fetch(url, { headers: headers, signal: controller.signal });
    } else {
      p = fetch(url, { headers: headers });
      timeoutId = setTimeout(function () {}, 5000);
    }
    return p.then(function (res) {
      clearTimeout(timeoutId);
      return res;
    }, function (err) {
      clearTimeout(timeoutId);
      throw err;
    });
  }

  function fetchTextWithKey(url, storeKey) {
    return fetchWithKey(url, storeKey).then(function (res) {
      if (!res.ok) {
        throw new Error('HTTP ' + res.status + ' fetching ' + url);
      }
      return res.text();
    });
  }

  function fetchJsonWithKey(url, storeKey) {
    return fetchWithKey(url, storeKey).then(function (res) {
      if (!res.ok) {
        throw new Error('HTTP ' + res.status + ' fetching ' + url);
      }
      return res.json();
    });
  }

  /* ── Default sim def shape (copied from tags.config.js patterns) ─────────── */

  function defaultSimDef(tag) {
    /* Random-walk between 0–100, step 2 — generic for unknown module tags */
    return { type: 'walk', min: 0, max: 100, step: 2 };
  }

  /* ── Store REST operations (§7) ─────────────────────────────────────────── */

  function storeOp(op, payload, storeUrl, storeKey) {
    var base = storeUrl.replace(/\/$/, '');

    if (op === 'status') {
      /* §12: status always returns 'service' in this widget */
      return Promise.resolve('service');
    }

    if (op === 'tx.add') {
      /* POST /tx → 201 { id } */
      var postHeaders = { 'Content-Type': 'application/json' };
      if (storeKey) { postHeaders['X-Api-Key'] = storeKey; }
      return fetch(base + '/tx', {
        method: 'POST',
        headers: postHeaders,
        body: JSON.stringify(payload),
      }).then(function (res) {
        if (!res.ok) {
          return res.text().then(function (t) {
            throw new Error('tx.add failed: HTTP ' + res.status + ' — ' + t);
          });
        }
        return res.json();
      });
    }

    if (op === 'tx.query') {
      /* GET /tx?ns=&from=&to=&... */
      var qs = Object.keys(payload || {}).map(function (k) {
        return encodeURIComponent(k) + '=' + encodeURIComponent(payload[k]);
      }).join('&');
      return fetchJsonWithKey(base + '/tx' + (qs ? '?' + qs : ''), storeKey);
    }

    if (op === 'kv.get') {
      /* GET /kv/:ns/:key → { value } or 404 */
      return fetchWithKey(
        base + '/kv/' + encodeURIComponent(payload.ns) + '/' + encodeURIComponent(payload.key),
        storeKey
      ).then(function (res) {
        if (res.status === 404) { return null; }
        if (!res.ok) { throw new Error('kv.get failed: HTTP ' + res.status); }
        return res.json().then(function (j) {
          return j.value !== undefined ? j.value : null;
        });
      });
    }

    if (op === 'kv.put') {
      /* PUT /kv/:ns/:key body { value } → { ok: true } */
      var kvHeaders = { 'Content-Type': 'application/json' };
      if (storeKey) { kvHeaders['X-Api-Key'] = storeKey; }
      return fetch(
        base + '/kv/' + encodeURIComponent(payload.ns) + '/' + encodeURIComponent(payload.key),
        {
          method: 'PUT',
          headers: kvHeaders,
          body: JSON.stringify({ value: payload.value }),
        }
      ).then(function (res) {
        if (!res.ok) {
          return res.text().then(function (t) {
            throw new Error('kv.put failed: HTTP ' + res.status + ' — ' + t);
          });
        }
        return res.json();
      });
    }

    return Promise.reject(new Error('unknown store op: ' + op));
  }

  /* ── Render themed error card inside ctx.root ────────────────────────────── */

  function showError(root, title, detail) {
    var theme = SFP.ui.theme;
    var dom = SFP.dom;
    dom.clear(root);

    var card = dom.el('div', {
      class: 'card widget-error',
      style: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: '8px',
        padding: '18px',
        minHeight: '80px',
        background: theme.color('bg-card'),
        border: '1px solid ' + theme.color('alarm'),
        borderRadius: '8px',
        color: theme.color('text-1'),
        fontFamily: "'Segoe UI', system-ui, sans-serif",
      },
    });

    var titleEl = dom.el('div', {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        fontWeight: '600',
        color: theme.color('alarm'),
        fontSize: '13px',
      },
    });
    titleEl.innerHTML = SFP.icons.svg('alert-triangle', 14) + ' module-host: ' + title;

    var detailEl = dom.el('div', {
      style: {
        fontSize: '12px',
        color: theme.color('text-2'),
        wordBreak: 'break-all',
      },
    });
    detailEl.textContent = detail || '';

    card.appendChild(titleEl);
    card.appendChild(detailEl);
    root.appendChild(card);
  }

  /* ══════════════════════════════════════════════════════════════════════════
   * Widget registration
   * ══════════════════════════════════════════════════════════════════════════ */

  SFP.widgets.register('module-host', {
    create: function (ctx) {
      var o = ctx.options;
      var moduleId = o.moduleId;
      var storeUrl = o.storeUrl;
      var storeKey = o.storeKey || '';
      var tagMap   = o.tagMap || {};

      /* ── Validate required options ─────────────────────────────────────── */
      if (!storeUrl) {
        showError(ctx.root, 'Missing storeUrl', 'options.storeUrl is required');
        return { destroy: function () {} };
      }
      if (!moduleId) {
        showError(ctx.root, 'Missing moduleId', 'options.moduleId is required');
        return { destroy: function () {} };
      }

      var base = storeUrl.replace(/\/$/, '');
      var iframe = null;
      var _disposed = false;
      var _messageListener = null;

      /* Per-tag unsub callbacks from ctx.subscribe — keyed by dp id */
      var _tagUnsubs = {};
      /* Map module tag → dp id (resolved at subscription time) */
      var _tagToDp = {};

      /* ── §11.1 parallel fetches with 5s timeouts ───────────────────────── */
      var manifestUrl = base + '/modules/' + moduleId + '/module.json';
      var sdkBase     = base + '/sdk/';

      Promise.all([
        fetchJsonWithKey(manifestUrl, storeKey),
        fetchTextWithKey(sdkBase + 'sdk-bootstrap.js', storeKey),
        fetchTextWithKey(sdkBase + 'sdk-data.js', storeKey),
        fetchTextWithKey(sdkBase + 'sdk-ui.js', storeKey),
        fetchTextWithKey(sdkBase + 'sdk-assets.js', storeKey),
      ]).then(function (results) {
        if (_disposed) { return; }

        var manifest   = results[0];
        var sdkTexts   = {
          bootstrap: results[1],
          data:      results[2],
          ui:        results[3],
          assets:    results[4],
        };

        /* Validate manifest */
        if (!manifest || !manifest.id || !manifest.entry) {
          showError(ctx.root, 'Invalid manifest', 'module.json missing required fields (id, entry)');
          return;
        }

        /* Fetch module entry file (§11.1: GET /modules/:id/:file) */
        var entryUrl = base + '/modules/' + manifest.id + '/' + manifest.entry;
        return fetchTextWithKey(entryUrl, storeKey).then(function (moduleCode) {
          if (_disposed) { return; }

          if (!moduleCode) {
            showError(ctx.root, 'Empty module entry', 'Entry file returned empty content: ' + entryUrl);
            return;
          }

          /* ── Build permissions ──────────────────────────────────────────── */
          var permissions = (manifest && manifest.permissions) || { tags: [], store: [] };
          var allowTag    = buildTagChecker(permissions.tags || []);
          var allowedNs   = permissions.store || [];

          /* ── Build + attach iframe (§4) ─────────────────────────────────── */
          iframe = document.createElement('iframe');
          iframe.setAttribute('sandbox', 'allow-scripts');
          iframe.style.cssText = 'width:100%;height:100%;border:none;display:block;background:transparent;min-height:100%;';

          /* Build srcdoc: bootstrap, data, ui, assets, module code */
          iframe.srcdoc = buildSrcdoc(sdkTexts, moduleCode);

          /* ── Host bridge (§5) ───────────────────────────────────────────── */
          var _helloReceived = false;

          function postToModule(msg) {
            if (_disposed) { return; }
            var win = iframe && iframe.contentWindow;
            if (!win) { return; }
            try {
              win.postMessage(Object.assign({ mh: 1 }, msg), '*');
            } catch (e) {
              console.warn('[module-host:' + moduleId + '] postMessage failed:', e);
            }
          }

          function resultMsg(reqId, ok, dataOrError) {
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

          _messageListener = function (event) {
            if (_disposed) { return; }
            /* §5: validate source is this iframe */
            if (!iframe || event.source !== iframe.contentWindow) { return; }
            var d = event.data;
            if (!d || d.mh !== 1) { return; }

            switch (d.type) {

              /* ── mh:hello → mh:init ─────────────────────────────────────── */
              case 'mh:hello':
                if (!_helloReceived) {
                  _helloReceived = true;

                  /* Build asset tree: SFP.data.assets.tree() or null */
                  var assetTree = null;
                  try {
                    if (SFP.data.assets && typeof SFP.data.assets.tree === 'function') {
                      assetTree = SFP.data.assets.tree();
                    }
                  } catch (e) { /* best-effort */ }

                  /* §12 mh:init payload */
                  postToModule({
                    type:       'mh:init',
                    moduleId:   moduleId,
                    manifest:   manifest,
                    config:     manifest.config || {},
                    theme:      { tokens: harvestTokens() },
                    simulation: (SFP.data.hub.mode === 'simulation'),
                    sdkVersion: SDK_VERSION,
                    assets:     assetTree,
                  });
                }
                break;

              /* ── mh:subscribe ────────────────────────────────────────────── */
              case 'mh:subscribe':
                if (!allowTag(d.tag)) {
                  resultMsg(d.reqId, false, 'permission-denied: tag ' + d.tag);
                  return;
                }
                (function (moduleTag, reqId) {
                  /* tagMap remap → dp id */
                  var dp = (tagMap && tagMap[moduleTag]) ? tagMap[moduleTag] : moduleTag;
                  _tagToDp[moduleTag] = dp;

                  /* Define dp in hub if not already defined */
                  if (!SFP.data.hub.def(dp)) {
                    SFP.data.hub.define(dp, {
                      label:  moduleTag,
                      source: { type: 'omi', address: moduleTag },
                      sim:    defaultSimDef(moduleTag),
                    });
                  }

                  /* Subscribe via ctx.subscribe (auto-released on widget destroy) */
                  var unsub = ctx.subscribe(dp, function (sample) {
                    postToModule({
                      type:    'mh:tagValue',
                      tag:     moduleTag,
                      value:   sample.value,
                      quality: sample.quality,
                      ts:      sample.ts || Date.now(),
                    });
                  });
                  _tagUnsubs[dp] = unsub;

                  resultMsg(reqId, true, null);
                }(d.tag, d.reqId));
                break;

              /* ── mh:unsubscribe ──────────────────────────────────────────── */
              case 'mh:unsubscribe':
                (function (moduleTag) {
                  var dp = _tagToDp[moduleTag] || moduleTag;
                  if (_tagUnsubs[dp]) {
                    try { _tagUnsubs[dp](); } catch (e) { /* ignore */ }
                    delete _tagUnsubs[dp];
                  }
                  delete _tagToDp[moduleTag];
                }(d.tag));
                break;

              /* ── mh:writeTag ─────────────────────────────────────────────── */
              case 'mh:writeTag':
                if (!allowTag(d.tag)) {
                  resultMsg(d.reqId, false, 'permission-denied: tag ' + d.tag);
                  return;
                }
                try {
                  SFP.data.omiSource.writeTag(d.tag, d.value);
                  resultMsg(d.reqId, true, null);
                } catch (e) {
                  resultMsg(d.reqId, false, String(e && e.message || e));
                }
                break;

              /* ── mh:store ────────────────────────────────────────────────── */
              case 'mh:store':
                (function (reqId, op, payload) {
                  /* Op whitelist (§11.2 — modules can't use mod.*) */
                  if (!ALLOWED_OPS[op]) {
                    resultMsg(reqId, false, 'permission-denied: op ' + op);
                    return;
                  }

                  /* status op — no ns check needed */
                  if (op === 'status') {
                    resultMsg(reqId, true, 'service');
                    return;
                  }

                  /* Namespace permission check */
                  var ns = payload && payload.ns;
                  if (ns && allowedNs.indexOf(ns) === -1) {
                    resultMsg(reqId, false, 'permission-denied: store ns ' + ns);
                    return;
                  }

                  /* Direct REST (§12: no IndexedDB fallback — reject on failure) */
                  var opPromise = storeOp(op, payload, storeUrl, storeKey);

                  opPromise
                    .then(function (data) { resultMsg(reqId, true, data); })
                    .catch(function (err) { resultMsg(reqId, false, String(err && err.message || err)); });
                }(d.reqId, d.op, d.payload));
                break;

              /* ── mh:log ──────────────────────────────────────────────────── */
              case 'mh:log':
                var prefix = '[MH:' + moduleId + ']';
                var level  = d.level || 'log';
                var args   = Array.isArray(d.args) ? d.args : [d.args];
                if (typeof console[level] === 'function') {
                  console[level].apply(console, [prefix].concat(args));
                } else {
                  console.log.apply(console, [prefix].concat(args));
                }
                break;

              /* ── mh:resize ───────────────────────────────────────────────── */
              case 'mh:resize':
                /* §12: ignore or apply min-height hint */
                if (iframe && d.height && typeof d.height === 'number') {
                  iframe.style.minHeight = d.height + 'px';
                }
                break;

              default:
                break;
            }
          };

          window.addEventListener('message', _messageListener);

          /* ── Theme change → mh:theme ─────────────────────────────────────── */
          ctx.onBus('theme:changed', function () {
            postToModule({ type: 'mh:theme', tokens: harvestTokens() });
          });

          /* ── Data mode change — log only (§12: out of v1 scope) ─────────── */
          ctx.onBus('data:modeChanged', function (ev) {
            console.info('[module-host:' + moduleId + '] data mode changed to', (ev && ev.mode) || '?', '— live rebind not supported in v1');
          });

          /* ── Attach iframe to root ────────────────────────────────────────── */
          SFP.dom.clear(ctx.root);
          ctx.root.style.position = 'relative';
          ctx.root.style.overflow = 'hidden';
          ctx.root.appendChild(iframe);
        });

      }).catch(function (err) {
        if (_disposed) { return; }
        /* Determine which URL caused the failure for the error card */
        var msg = err && err.message ? err.message : String(err);
        showError(ctx.root, 'Load failed', msg);
      });

      /* ── destroy ─────────────────────────────────────────────────────────── */
      return {
        destroy: function () {
          if (_disposed) { return; }
          _disposed = true;

          /* Send mh:destroy to the module */
          if (iframe && iframe.contentWindow) {
            try {
              iframe.contentWindow.postMessage({ mh: 1, type: 'mh:destroy' }, '*');
            } catch (e) { /* ignore */ }
          }

          /* Remove message listener */
          if (_messageListener) {
            window.removeEventListener('message', _messageListener);
            _messageListener = null;
          }

          /* Manual unsub for any tags (ctx.subscribe cleanups run via renderer) */
          Object.keys(_tagUnsubs).forEach(function (dp) {
            try { _tagUnsubs[dp](); } catch (e) { /* ignore */ }
          });
          _tagUnsubs = {};
          _tagToDp = {};

          /* Remove iframe from DOM */
          if (iframe && iframe.parentNode) {
            iframe.parentNode.removeChild(iframe);
          }
          iframe = null;
        },
      };
    },
  });

}(window.SFP));
