/* ============================================================================
 * ModuleHub — module loader (MHB.runtime.load / unload)
 * ----------------------------------------------------------------------------
 * Contract §4 + §5 host side.
 *
 * MHB.runtime.load(id)
 *   1. Resolves manifest via registry.
 *   2. Fetches the entry-point TEXT (and SDK file texts).
 *   3. Builds sandboxed iframe with srcdoc (SDK scripts + module code inline).
 *   4. Creates sandbox bridge instance.
 *   5. On mh:hello wires tag routing and calls sandbox.sendInit().
 *   Returns Promise<void>; rejects with Error on failure.
 *
 * MHB.runtime.unload()
 *   Sends mh:destroy, waits 100ms, removes iframe, unsubscribes all tags.
 *
 * SDK files fetched by path (from other agent, may not exist yet):
 *   src/sdk/sdk-bootstrap.js
 *   src/sdk/sdk-data.js
 *   src/sdk/sdk-ui.js
 *   src/sdk/sdk-assets.js
 *
 * Contract: modulehub-contracts.md §4, §5, §10
 * ========================================================================== */
(function (MHB) {
  'use strict';

  /* ── State ──────────────────────────────────────────────────────────────── */

  var _current = null;   // { id, iframe, bridge, subscribedTags: Set, simTimers: {} }

  /* ── Helpers ────────────────────────────────────────────────────────────── */

  /** Escape </script so embedded code does not break srcdoc. */
  function escScript(code) {
    return code.replace(/<\/script/gi, '<\\/script');
  }

  /** Fetch text, return '' + console.warn on failure (SDK files may be absent). */
  function fetchText(url) {
    return fetch(url)
      .then(function (res) {
        if (!res.ok) {
          console.warn('[MHB.loader] fetch ' + url + ' → HTTP ' + res.status + ' (skipped)');
          return '';
        }
        return res.text();
      })
      .catch(function (err) {
        console.warn('[MHB.loader] fetch ' + url + ' failed:', err, '(skipped)');
        return '';
      });
  }

  /* ── Simple tag-name hash for simulation seed ───────────────────────────── */
  function tagHash(str) {
    var h = 0;
    for (var i = 0; i < str.length; i++) {
      h = (h * 31 + str.charCodeAt(i)) | 0;
    }
    return Math.abs(h);
  }

  /* ── Simulation walk state ──────────────────────────────────────────────── */
  function startSim(tag, onValue) {
    var seed = tagHash(tag);
    var value = (seed % 100);
    var timerId = setInterval(function () {
      value += (Math.random() - 0.5) * 6;
      if (value < 0)   { value = 0; }
      if (value > 100) { value = 100; }
      onValue(tag, parseFloat(value.toFixed(2)), 'Simulated', Date.now());
    }, 1000);
    return timerId;
  }

  /* ── Build srcdoc HTML ──────────────────────────────────────────────────── */
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

  /* ── Unload (export first so load() can call it) ───────────────────────── */

  MHB.runtime.unload = function () {
    if (!_current) { return Promise.resolve(); }
    var c = _current;
    _current = null;

    /* Cancel simulation timers */
    Object.keys(c.simTimers || {}).forEach(function (tag) {
      clearInterval(c.simTimers[tag]);
    });

    /* Send destroy and remove iframe after brief pause */
    if (c.bridge) {
      try { c.bridge.sendDestroy(); } catch (e) { /* ignore */ }
    }

    return new Promise(function (resolve) {
      setTimeout(function () {
        if (c.bridge) { c.bridge.dispose(); }
        if (c.iframe && c.iframe.parentNode) {
          c.iframe.parentNode.removeChild(c.iframe);
        }
        /* Unsubscribe live tags */
        if (c.subscribedTags) {
          Object.keys(c.subscribedTags).forEach(function (tag) {
            window.parent.postMessage({ type: 'omi:unsubscribe', tagName: tag }, '*');
          });
        }
        MHB.bus.emit('module:unloaded', { id: c.id });
        resolve();
      }, 100);
    });
  };

  /* ── Load ───────────────────────────────────────────────────────────────── */

  MHB.runtime.load = function (id) {
    /* Unload any currently running module first */
    return MHB.runtime.unload().then(function () {
      return MHB.registry.manifest(id);
    }).then(function (manifest) {
      if (!manifest) {
        throw new Error('manifest not found or invalid for module: ' + id);
      }

      var sdkBase    = 'src/sdk/';
      var simulation = !!(MHB.runtime && MHB.runtime.mode === 'simulation');

      /* For library modules, fetch entry via mod.fetch; local modules use relative fetch */
      var isLibrary = MHB.registry.source(id) === 'library';
      var entryPromise;
      if (isLibrary) {
        var libClient = MHB.storeClient;
        if (libClient && typeof libClient.op === 'function') {
          entryPromise = libClient.op('mod.fetch', { id: id, file: manifest.entry })
            .catch(function (err) {
              console.warn('[MHB.loader] mod.fetch entry failed for "' + id + '":', err);
              return '';
            });
        } else {
          entryPromise = Promise.resolve('');
        }
      } else {
        entryPromise = fetchText('modules/' + id + '/' + manifest.entry);
      }

      /* Fetch SDK files and module entry in parallel */
      return Promise.all([
        fetchText(sdkBase + 'sdk-bootstrap.js'),
        fetchText(sdkBase + 'sdk-data.js'),
        fetchText(sdkBase + 'sdk-ui.js'),
        fetchText(sdkBase + 'sdk-assets.js'),
        entryPromise,
      ]).then(function (texts) {
        var sdkTexts = {
          bootstrap: texts[0],
          data:      texts[1],
          ui:        texts[2],
          assets:    texts[3],
        };
        var moduleCode = texts[4];
        if (!moduleCode) {
          throw new Error('module entry file empty or missing: ' + entryUrl);
        }

        /* Build iframe */
        var container = document.getElementById('mhb-module-container');
        if (!container) {
          throw new Error('module container element #mhb-module-container not found');
        }

        var iframe = document.createElement('iframe');
        iframe.setAttribute('sandbox', 'allow-scripts');
        iframe.style.cssText = 'width:100%;height:100%;border:none;display:block;background:transparent;';
        iframe.srcdoc = buildSrcdoc(sdkTexts, moduleCode);

        var subscribedTags = {};   // tag -> true (for Set-like tracking)
        var simTimers      = {};
        var helloReceived  = false;

        /* Create bridge BEFORE appending (so listener is ready) */
        var bridge = MHB.runtime.sandbox.create({
          moduleId: id,
          manifest: manifest,
          config:   manifest.config || {},
          iframe:   iframe,
          simulation: simulation,
          onTagSubscribe: function (tag) {
            if (tag === '__hello__') {
              /* iframe is live — send init */
              if (!helloReceived) {
                helloReceived = true;
                bridge.sendInit(MHB.theme.tokens());
              }
              return;
            }
            /* Track subscription */
            subscribedTags[tag] = true;
            if (simulation) {
              /* Start random-walk for this tag */
              if (!simTimers[tag]) {
                simTimers[tag] = startSim(tag, function (t, v, q, ts) {
                  if (_current && _current.bridge === bridge) {
                    bridge.sendTagValue(t, v, q, ts);
                  }
                });
              }
            } else {
              /* Live: subscribe via OMI */
              window.parent.postMessage({ type: 'omi:subscribe', tagName: tag }, '*');
            }
          },
          onTagUnsubscribe: function (tag) {
            delete subscribedTags[tag];
            if (simTimers[tag]) {
              clearInterval(simTimers[tag]);
              delete simTimers[tag];
            }
            if (!simulation) {
              window.parent.postMessage({ type: 'omi:unsubscribe', tagName: tag }, '*');
            }
          },
          onWriteTag: function (tag, value) {
            if (!simulation) {
              window.parent.postMessage({ type: 'omi:writeTag', tagName: tag, value: value }, '*');
            }
            /* In simulation: no-op (fire-and-forget) */
          },
        });

        _current = {
          id:             id,
          iframe:         iframe,
          bridge:         bridge,
          subscribedTags: subscribedTags,
          simTimers:      simTimers,
        };

        container.appendChild(iframe);
        MHB.bus.emit('module:loaded', { id: id });
      });
    });
  };

  /* ── Forward live omi:tagValue to current module ────────────────────────── */

  window.addEventListener('message', function (event) {
    var msg = event.data;
    if (!msg || msg.type !== 'omi:tagValue') { return; }
    if (!_current || !_current.bridge) { return; }
    if (!_current.subscribedTags[msg.tagName]) { return; }
    var value = (typeof msg.value === 'number') ? msg.value : parseFloat(msg.value);
    if (isNaN(value)) { value = msg.value; }
    var ts = msg.timestamp ? Date.parse(msg.timestamp) : Date.now();
    _current.bridge.sendTagValue(msg.tagName, value, msg.quality || 'Good', ts);
  });

  /* ── Forward theme changes to current module ────────────────────────────── */

  MHB.bus.on('theme:changed', function (ev) {
    if (_current && _current.bridge) {
      _current.bridge.sendTheme(ev.tokens);
    }
  });

  /* ── In-memory preview (used by Studio) ─────────────────────────────────── */
  /*
   * MHB.runtime.preview(manifest, codeText, containerEl, onReady, onLog)
   *
   * Builds a sandboxed iframe from in-memory manifest + code (no fetch needed).
   * Reuses buildSrcdoc, the sandbox bridge, and startSim — same paths as load().
   * Always runs in simulation mode (preview never touches OMI live tags).
   *
   * onReady(state)  — called once the bridge+iframe are created;
   *                   state = { bridge, iframe, simTimers }
   * onLog(entry)    — called for every mh:log message from the preview iframe;
   *                   entry = { level, args }
   *
   * The caller (Studio) is responsible for:
   *   - stopping/disposing the returned state when the user clicks "Stop".
   *   - removing the iframe from containerEl.
   */

  MHB.runtime.preview = function (manifest, codeText, containerEl, onReady, onLog) {
    if (!manifest || !codeText || !containerEl) { return; }

    onReady = (typeof onReady === 'function') ? onReady : function () {};
    onLog   = (typeof onLog   === 'function') ? onLog   : function () {};

    /* Always preview in simulation mode — never touch live OMI subscriptions */
    var simulation = true;
    var moduleId   = manifest.id || 'preview';
    var sdkBase    = 'src/sdk/';

    /* Fetch SDK texts (they may or may not exist) */
    Promise.all([
      fetchText(sdkBase + 'sdk-bootstrap.js'),
      fetchText(sdkBase + 'sdk-data.js'),
      fetchText(sdkBase + 'sdk-ui.js'),
      fetchText(sdkBase + 'sdk-assets.js'),
    ]).then(function (texts) {
      var sdkTexts = {
        bootstrap: texts[0],
        data:      texts[1],
        ui:        texts[2],
        assets:    texts[3],
      };

      /* Build iframe with inline code */
      var iframe = document.createElement('iframe');
      iframe.setAttribute('sandbox', 'allow-scripts');
      iframe.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:none;display:block;background:transparent;';
      iframe.srcdoc = buildSrcdoc(sdkTexts, codeText);

      var simTimers     = {};
      var subscribedTags = {};
      var helloReceived  = false;

      var bridge = MHB.runtime.sandbox.create({
        moduleId:   moduleId,
        manifest:   manifest,
        config:     manifest.config || {},
        iframe:     iframe,
        simulation: simulation,
        onTagSubscribe: function (tag) {
          if (tag === '__hello__') {
            if (!helloReceived) {
              helloReceived = true;
              bridge.sendInit(MHB.theme.tokens());
            }
            return;
          }
          subscribedTags[tag] = true;
          if (!simTimers[tag]) {
            simTimers[tag] = startSim(tag, function (t, v, q, ts) {
              /* Only send if bridge is still alive */
              try { bridge.sendTagValue(t, v, q, ts); } catch (e) { /* ignore */ }
            });
          }
        },
        onTagUnsubscribe: function (tag) {
          delete subscribedTags[tag];
          if (simTimers[tag]) { clearInterval(simTimers[tag]); delete simTimers[tag]; }
        },
        onWriteTag: function () { /* no-op in preview simulation */ },
      });

      /* Intercept mh:log for the preview console strip */
      var _origOnMessage = bridge._onMessage;   /* not available — use bus */
      /* We patch via an extra message listener on the preview iframe */
      var logListener = function (event) {
        if (!event.data || event.data.mh !== 1) { return; }
        if (event.source !== iframe.contentWindow) { return; }
        if (event.data.type === 'mh:log') {
          onLog({ level: event.data.level || 'log', args: event.data.args || [] });
        }
      };
      window.addEventListener('message', logListener);

      /* Augment bridge.dispose to also remove the log listener */
      var origDispose = bridge.dispose.bind(bridge);
      bridge.dispose = function () {
        window.removeEventListener('message', logListener);
        origDispose();
      };

      containerEl.appendChild(iframe);

      /* Deliver state to caller immediately */
      var state = { bridge: bridge, iframe: iframe, simTimers: simTimers };
      onReady(state);
    }).catch(function (err) {
      console.error('[MHB.runtime.preview] SDK fetch error:', err);
    });
  };

}(window.MHB));
