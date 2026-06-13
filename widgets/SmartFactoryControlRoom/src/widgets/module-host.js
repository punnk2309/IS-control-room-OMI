/* ============================================================================
 * Widget: module-host — embeds a ModuleHub module served from modulehub-store
 * ----------------------------------------------------------------------------
 * options: {
 *   moduleId?:   string — pin one module full-area. If omitted, a switcher bar
 *                         lets the user pick/swap among available modules.
 *   staticBase?: string — base for module RESOURCES (module.json, SDK, code),
 *                         offline/same-origin, e.g. 'module-bundles'. Switcher
 *                         lists from `${staticBase}/index.json`.
 *   storeUrl?:   string — modulehub-store base, e.g. 'http://localhost:8743'.
 *                         Used for persistence and to list service-published
 *                         modules. At least one of staticBase/storeUrl required.
 *   storeKey?:   string — value for X-Api-Key header.
 *   tagMap?:     object — map of module tag names → control-room datapoint ids.
 * }
 * Without storeUrl, store ops are in-session in-memory no-ops (visual still works).
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

  /* ── Render module picker (no moduleId; storeUrl IS set) ─────────────────── */

  function showPicker(root, base, storeKey, onLoad) {
    var theme = SFP.ui.theme;
    var dom = SFP.dom;
    dom.clear(root);

    /* Outer wrapper — fills the widget cell */
    var wrap = dom.el('div', {
      class: 'card module-host-picker',
      style: {
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        padding: '18px',
        background: theme.color('bg-card'),
        border: '1px solid ' + theme.color('border'),
        borderRadius: '8px',
        color: theme.color('text-1'),
        fontFamily: "'Segoe UI', system-ui, sans-serif",
        fontSize: '13px',
        minHeight: '80px',
      },
    });

    /* Heading row */
    var headingRow = dom.el('div', {
      style: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '8px',
      },
    });

    var heading = dom.el('div', {
      style: {
        fontWeight: '600',
        fontSize: '14px',
        color: theme.color('text-1'),
      },
    });
    heading.textContent = 'Select a module';

    /* Refresh button */
    var refreshBtn = dom.el('button', {
      title: 'Refresh module list',
      style: {
        background: 'none',
        border: '1px solid ' + theme.color('border'),
        borderRadius: '4px',
        color: theme.color('text-2'),
        cursor: 'pointer',
        fontSize: '12px',
        padding: '2px 7px',
        lineHeight: '1.5',
      },
    });
    refreshBtn.textContent = '↻ Refresh';

    headingRow.appendChild(heading);
    headingRow.appendChild(refreshBtn);

    /* Select element */
    var select = dom.el('select', {
      style: {
        background: theme.color('bg-surface'),
        border: '1px solid ' + theme.color('border-strong'),
        borderRadius: '4px',
        color: theme.color('text-1'),
        fontSize: '13px',
        padding: '4px 8px',
        width: '100%',
        cursor: 'pointer',
      },
    });

    /* Error line */
    var errorLine = dom.el('div', {
      style: {
        fontSize: '12px',
        color: theme.color('alarm'),
        minHeight: '16px',
      },
    });

    /* Load button */
    var loadBtn = dom.el('button', {
      style: {
        background: theme.color('accent'),
        border: 'none',
        borderRadius: '4px',
        color: '#ffffff',
        cursor: 'pointer',
        fontSize: '13px',
        fontWeight: '600',
        padding: '6px 16px',
        alignSelf: 'flex-start',
      },
    });
    loadBtn.textContent = 'Load';

    wrap.appendChild(headingRow);
    wrap.appendChild(select);
    wrap.appendChild(errorLine);
    wrap.appendChild(loadBtn);
    root.appendChild(wrap);

    /* ── Populate select from GET /modules ───────────────────────────────── */
    function populate() {
      select.innerHTML = '';
      errorLine.textContent = '';
      loadBtn.disabled = true;

      var placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = 'Loading…';
      placeholder.disabled = true;
      placeholder.selected = true;
      select.appendChild(placeholder);

      fetchJsonWithKey(base + '/modules', storeKey).then(function (list) {
        select.innerHTML = '';
        if (!Array.isArray(list) || list.length === 0) {
          errorLine.textContent = 'No modules published to ' + base;
          var none = document.createElement('option');
          none.value = '';
          none.disabled = true;
          none.selected = true;
          none.textContent = '(none)';
          select.appendChild(none);
          return;
        }
        /* Blank prompt option */
        var prompt = document.createElement('option');
        prompt.value = '';
        prompt.disabled = true;
        prompt.selected = true;
        prompt.textContent = '— choose a module —';
        select.appendChild(prompt);

        list.forEach(function (entry) {
          var opt = document.createElement('option');
          opt.value = entry.id;
          opt.textContent = entry.name + ' (' + entry.id + ') v' + entry.version;
          select.appendChild(opt);
        });

        loadBtn.disabled = false;
      }).catch(function (err) {
        select.innerHTML = '';
        var none = document.createElement('option');
        none.value = '';
        none.disabled = true;
        none.selected = true;
        none.textContent = '(error)';
        select.appendChild(none);
        errorLine.textContent = 'Failed to load module list: ' + (err && err.message ? err.message : String(err));
      });
    }

    populate();

    refreshBtn.addEventListener('click', function () { populate(); });

    loadBtn.addEventListener('click', function () {
      var chosen = select.value;
      if (!chosen) {
        errorLine.textContent = 'Please select a module first.';
        return;
      }
      onLoad(chosen);
    });
  }

  /* ══════════════════════════════════════════════════════════════════════════
   * Widget registration
   * ══════════════════════════════════════════════════════════════════════════ */

  SFP.widgets.register('module-host', {
    create: function (ctx) {
      var o = ctx.options;
      var moduleId   = o.moduleId;
      var storeUrl   = o.storeUrl   ? o.storeUrl.replace(/\/$/, '')   : '';
      var staticBase = o.staticBase ? o.staticBase.replace(/\/$/, '') : '';
      var storeKey   = o.storeKey || '';
      var tagMap     = o.tagMap || {};

      /*
       * Two independent concerns:
       *   resBase  — where module RESOURCES (module.json, SDK, code) load from.
       *              Prefer staticBase (works offline / same-origin, no service);
       *              fall back to the service.
       *   storeUrl — where PERSISTENCE (tx/kv) goes. Optional: when absent, store
       *              ops are in-session in-memory no-ops so a bundled module still
       *              renders and works without any backend.
       */
      var resBase = staticBase || storeUrl;

      /* ── Validate options ──────────────────────────────────────────────── */
      if (moduleId && !resBase) {
        showError(ctx.root, 'No module source',
          'Set options.staticBase (offline) or options.storeUrl (service) to load "' + moduleId + '"');
        return { destroy: function () {} };
      }
      if (!moduleId && !resBase) {
        showError(ctx.root, 'No module source',
          'Provide options.staticBase (offline switcher) or options.storeUrl (library) to pick a module');
        return { destroy: function () {} };
      }

      var base = storeUrl;   /* store ops + picker target */
      var iframe = null;
      var _disposed = false;
      var _messageListener = null;

      /* Per-tag unsub callbacks from ctx.subscribe — keyed by dp id */
      var _tagUnsubs = {};
      /* Map module tag → dp id (resolved at subscription time) */
      var _tagToDp = {};

      /*
       * Store dispatch. With a storeUrl → real REST (§7). Without one → an
       * in-session in-memory store so a bundled module renders and works
       * (state is not persisted across reloads — that needs the service).
       */
      var _memKv = {};
      var _memTxId = 0;
      function runStoreOp(op, payload) {
        if (storeUrl) { return storeOp(op, payload, storeUrl, storeKey); }
        var k;
        switch (op) {
          case 'status':   return Promise.resolve('local');
          case 'kv.get':   k = payload.ns + '::' + payload.key;
                           return Promise.resolve(_memKv[k] !== undefined ? _memKv[k] : null);
          case 'kv.put':   _memKv[payload.ns + '::' + payload.key] = payload.value;
                           return Promise.resolve({ ok: true });
          case 'tx.add':   _memTxId += 1; return Promise.resolve({ id: _memTxId });
          case 'tx.query': return Promise.resolve([]);
          default:         return Promise.reject(new Error('unknown store op: ' + op));
        }
      }

      /*
       * Where the active module iframe mounts. In switcher mode this is the
       * content area below the switcher bar; in pinned mode it is ctx.root.
       */
      var _contentEl = ctx.root;
      var _busWired  = false;   /* theme/mode bus handlers wired once, not per-switch */

      /* Tear down the currently-running module (used on switch + destroy). */
      function teardownCurrent() {
        if (iframe && iframe.contentWindow) {
          try { iframe.contentWindow.postMessage({ mh: 1, type: 'mh:destroy' }, '*'); } catch (e) { /* ignore */ }
        }
        if (_messageListener) {
          window.removeEventListener('message', _messageListener);
          _messageListener = null;
        }
        Object.keys(_tagUnsubs).forEach(function (dp) {
          try { _tagUnsubs[dp](); } catch (e) { /* ignore */ }
        });
        _tagUnsubs = {};
        _tagToDp = {};
        if (iframe && iframe.parentNode) { iframe.parentNode.removeChild(iframe); }
        iframe = null;
      }

      /* ── Internal: boot a module by id — wraps the §11.1 fetch + §4/§5 iframe setup ── */
      function bootModule(id) {
        teardownCurrent();   /* dispose any previously-running module (switch) */
        var sdkBase     = resBase + '/sdk/';
        var manifestUrl = resBase + '/modules/' + id + '/module.json';

        /* Resource source: inlined bundle (no fetch — file:// safe) when present
           and not using a service; otherwise fetch from staticBase/storeUrl. */
        var B = (!storeUrl && typeof window !== 'undefined') ? window.SFP_MODULE_BUNDLES : null;
        var inlineMod = (B && B.modules) ? B.modules[id] : null;
        function getManifest() {
          return inlineMod ? Promise.resolve(inlineMod.manifest) : fetchJsonWithKey(manifestUrl, storeKey);
        }
        function getSdk(name) {
          return (B && B.sdk && B.sdk[name] != null) ? Promise.resolve(B.sdk[name]) : fetchTextWithKey(sdkBase + name, storeKey);
        }
        function getEntry(manifest) {
          return inlineMod ? Promise.resolve(inlineMod.files[manifest.entry])
                           : fetchTextWithKey(resBase + '/modules/' + manifest.id + '/' + manifest.entry, storeKey);
        }

        Promise.all([
          getManifest(),
          getSdk('sdk-bootstrap.js'),
          getSdk('sdk-data.js'),
          getSdk('sdk-ui.js'),
          getSdk('sdk-assets.js'),
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
            showError(_contentEl, 'Invalid manifest', 'module.json missing required fields (id, entry)');
            return;
          }

          /* Module entry code — inlined bundle or §11.1 GET /modules/:id/:file */
          var entryUrl = resBase + '/modules/' + manifest.id + '/' + manifest.entry;
          return getEntry(manifest).then(function (moduleCode) {
            if (_disposed) { return; }

            if (!moduleCode) {
              showError(_contentEl, 'Empty module entry', 'Entry file returned empty content: ' + entryUrl);
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
                console.warn('[module-host:' + id + '] postMessage failed:', e);
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
                      moduleId:   id,
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
                      resultMsg(reqId, true, storeUrl ? 'service' : 'local');
                      return;
                    }

                    /* Namespace permission check */
                    var ns = payload && payload.ns;
                    if (ns && allowedNs.indexOf(ns) === -1) {
                      resultMsg(reqId, false, 'permission-denied: store ns ' + ns);
                      return;
                    }

                    /* REST when storeUrl set; in-memory no-op otherwise */
                    runStoreOp(op, payload)
                      .then(function (data) { resultMsg(reqId, true, data); })
                      .catch(function (err) { resultMsg(reqId, false, String(err && err.message || err)); });
                  }(d.reqId, d.op, d.payload));
                  break;

                /* ── mh:log ──────────────────────────────────────────────────── */
                case 'mh:log':
                  var prefix = '[MH:' + id + ']';
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

            /* ── Bus handlers — wired once, post to whichever iframe is current ── */
            if (!_busWired) {
              _busWired = true;
              ctx.onBus('theme:changed', function () {
                postToModule({ type: 'mh:theme', tokens: harvestTokens() });
              });
              ctx.onBus('data:modeChanged', function (ev) {
                console.info('[module-host] data mode changed to', (ev && ev.mode) || '?', '— live rebind not supported in v1');
              });
            }

            /* ── Attach iframe to the content area ───────────────────────────── */
            SFP.dom.clear(_contentEl);
            _contentEl.style.position = 'relative';
            _contentEl.style.overflow = 'hidden';
            _contentEl.appendChild(iframe);
          });

        }).catch(function (err) {
          if (_disposed) { return; }
          /* Determine which URL caused the failure for the error card */
          var msg = err && err.message ? err.message : String(err);
          showError(_contentEl, 'Load failed', msg);
        });
      }

      /* ── List available modules for the switcher ──────────────────────────────
       * Service mode → GET /modules. Offline (staticBase) → read index.json and
       * best-effort each module.json for a friendly name. Returns [{id,name,version}].
       */
      function listModules() {
        /* Inlined bundle (no fetch — works from file://) takes priority offline. */
        var B = (!storeUrl && typeof window !== 'undefined') ? window.SFP_MODULE_BUNDLES : null;
        if (B && Array.isArray(B.index)) {
          return Promise.resolve(B.index.map(function (mid) {
            var m = B.modules[mid] && B.modules[mid].manifest;
            return { id: mid, name: (m && m.name) || mid, version: (m && m.version) || '' };
          }));
        }
        if (storeUrl) {
          return fetchJsonWithKey(base + '/modules', storeKey);
        }
        return fetchJsonWithKey(resBase + '/index.json', storeKey).then(function (ids) {
          if (!Array.isArray(ids)) { return []; }
          return Promise.all(ids.map(function (mid) {
            return fetchJsonWithKey(resBase + '/modules/' + mid + '/module.json', storeKey).then(
              function (m) { return { id: mid, name: (m && m.name) || mid, version: (m && m.version) || '' }; },
              function () { return { id: mid, name: mid, version: '' }; }
            );
          }));
        });
      }

      /* ── Switcher: a persistent bar to pick/switch the running module ─────────
       * Full-page: the selected module fills the area below the bar; changing the
       * dropdown swaps it. Works offline from index.json — no service required.
       * (To run several modules at once, place several module-host panels.)
       */
      function buildSwitcher() {
        var theme = SFP.ui.theme;
        var memKey = 'mhb-modhost:' + (storeUrl || resBase);

        SFP.dom.clear(ctx.root);
        ctx.root.style.display = 'flex';
        ctx.root.style.flexDirection = 'column';
        ctx.root.style.position = 'relative';
        ctx.root.style.overflow = 'hidden';

        var bar = SFP.dom.el('div', {
          style: {
            display: 'flex', alignItems: 'center', gap: '10px',
            padding: '8px 12px', flexShrink: '0',
            background: theme.color('bg-surface'),
            borderBottom: '1px solid ' + theme.color('border'),
          },
        });
        var label = SFP.dom.el('span', {
          style: { fontSize: '12px', fontWeight: '600', color: theme.color('text-2'),
                   textTransform: 'uppercase', letterSpacing: '0.05em' },
        });
        label.textContent = 'Module';

        var select = SFP.dom.el('select', {
          style: {
            flex: '1 1 auto', maxWidth: '420px', height: '30px', padding: '0 8px',
            background: theme.color('bg-card'), color: theme.color('text-1'),
            border: '1px solid ' + theme.color('border'), borderRadius: '4px',
            fontSize: '13px', outline: 'none', cursor: 'pointer',
          },
        });
        var status = SFP.dom.el('span', {
          style: { fontSize: '11px', color: theme.color('text-3'), marginLeft: 'auto' },
        });

        bar.appendChild(label);
        bar.appendChild(select);
        bar.appendChild(status);

        _contentEl = SFP.dom.el('div', { style: { flex: '1 1 auto', position: 'relative', minHeight: '0' } });

        ctx.root.appendChild(bar);
        ctx.root.appendChild(_contentEl);

        function go(id) {
          if (!id) { return; }
          try { window.localStorage.setItem(memKey, id); } catch (e) { /* ignore */ }
          select.value = id;
          bootModule(id);
        }

        select.addEventListener('change', function () { go(select.value); });

        status.textContent = 'loading…';
        listModules().then(function (list) {
          select.innerHTML = '';
          if (!Array.isArray(list) || list.length === 0) {
            status.textContent = '';
            showError(_contentEl, 'No modules available',
              storeUrl ? 'Nothing published to ' + base : 'No ' + resBase + '/index.json — run scripts/sync-module-bundles.ps1');
            return;
          }
          list.forEach(function (entry) {
            var opt = document.createElement('option');
            opt.value = entry.id;
            opt.textContent = entry.name + (entry.version ? ' v' + entry.version : '') + ' (' + entry.id + ')';
            select.appendChild(opt);
          });
          status.textContent = list.length + ' available' + (storeUrl ? '' : ' · offline');

          /* Auto-load remembered selection if still present, else the first */
          var remembered = '';
          try { remembered = window.localStorage.getItem(memKey) || ''; } catch (e) { /* ignore */ }
          var ids = list.map(function (e) { return e.id; });
          var initial = (remembered && ids.indexOf(remembered) !== -1) ? remembered : list[0].id;
          go(initial);
        }).catch(function (err) {
          status.textContent = '';
          showError(_contentEl, 'Failed to list modules', err && err.message ? err.message : String(err));
        });
      }

      /* ── Route: pinned module vs switcher ─────────────────────────────────── */
      if (moduleId) {
        /* Pinned: boot one fixed module full-area (for preset dashboard panels). */
        _contentEl = ctx.root;
        bootModule(moduleId);
      } else {
        /* Switcher: pick/switch among available modules (offline or library). */
        buildSwitcher();
      }

      /* ── destroy ─────────────────────────────────────────────────────────── */
      return {
        destroy: function () {
          if (_disposed) { return; }
          _disposed = true;
          teardownCurrent();
        },
      };
    },
  });

}(window.SFP));
