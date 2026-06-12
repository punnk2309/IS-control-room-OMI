/* ============================================================================
 * ModuleHub — application bootstrap (loaded last)
 * ----------------------------------------------------------------------------
 * Responsibilities:
 *   1. OMI host protocol (omi:ready, omi:init, omi:propertyChanged, omi:resize)
 *      — same shapes as SmartFactoryControlRoom (contract §1).
 *   2. Shell UI: header bar, module dropdown, Studio button, store-status dot.
 *   3. Load defaultModule on start (fallback: first id in registry).
 *   4. Simulation mode: 2500 ms timeout after omi:ready.
 *
 * Contract: modulehub-contracts.md §1, §2
 * ========================================================================== */
(function (MHB) {
  'use strict';

  var started = false;
  var initFallbackTimer = null;

  /* ── Store-status dot ───────────────────────────────────────────────────── */

  var _statusDot    = null;
  var _statusTimer  = null;

  var STATUS_COLORS = {
    service:  'var(--c-good,  #34d399)',
    buffered: 'var(--c-warn,  #fbbf24)',
    local:    'var(--c-text-3, #6e7a99)',
  };

  function refreshStatus() {
    if (!_statusDot) { return; }
    var status = (MHB.storeClient && typeof MHB.storeClient.status === 'function')
      ? MHB.storeClient.status()
      : 'local';
    _statusDot.style.background = STATUS_COLORS[status] || STATUS_COLORS.local;
    _statusDot.title = 'Store: ' + status;
  }

  /* ── Toast ──────────────────────────────────────────────────────────────── */

  function showToast(msg, kind) {
    var el = document.createElement('div');
    el.className = 'mhb-toast mhb-toast--' + (kind || 'info');
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(function () {
      if (el.parentNode) { el.parentNode.removeChild(el); }
    }, 3000);
  }

  /* ── Module error card ──────────────────────────────────────────────────── */

  function showErrorCard(id, err) {
    var container = document.getElementById('mhb-module-container');
    if (!container) { return; }
    container.innerHTML = '';
    var card = document.createElement('div');
    card.className = 'mhb-error-card';
    card.innerHTML =
      '<h2>Module failed to load</h2>' +
      '<p><strong>ID:</strong> ' + escapeHtml(String(id)) + '</p>' +
      '<p><strong>Error:</strong> ' + escapeHtml(String(err && err.message || err)) + '</p>';
    container.appendChild(card);
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ── Module dropdown ────────────────────────────────────────────────────── */

  function populateDropdown(select) {
    var ids = MHB.registry.list();
    var prev = select.value;
    select.innerHTML = '';
    ids.forEach(function (id) {
      var opt = document.createElement('option');
      opt.value = id;
      var src = MHB.registry.source && MHB.registry.source(id);
      opt.textContent = (src === 'library') ? id + ' (library)' : id;
      select.appendChild(opt);
    });
    /* Restore selection if still present */
    if (prev && select.querySelector('option[value="' + prev + '"]')) {
      select.value = prev;
    }
  }

  function loadModule(id) {
    MHB.runtime.load(id).catch(function (err) {
      console.error('[MHB] load failed for "' + id + '":', err);
      showErrorCard(id, err);
    });
  }

  /* ── Shell build ────────────────────────────────────────────────────────── */

  function buildShell(mountEl) {
    /* Header */
    var header = document.createElement('header');
    header.className = 'mhb-header';

    var title = document.createElement('span');
    title.className = 'mhb-title';
    title.textContent = 'ModuleHub';

    var select = document.createElement('select');
    select.className = 'mhb-module-select';
    select.setAttribute('aria-label', 'Select module');

    var studioBtn = document.createElement('button');
    studioBtn.className = 'mhb-btn';
    studioBtn.textContent = 'Studio';
    studioBtn.addEventListener('click', function () {
      if (MHB.studio && typeof MHB.studio.open === 'function') {
        MHB.studio.open();
      } else {
        showToast('Studio not loaded', 'warn');
      }
    });

    _statusDot = document.createElement('span');
    _statusDot.className = 'mhb-status-dot';
    _statusDot.title = 'Store: local';

    header.appendChild(title);
    header.appendChild(select);
    header.appendChild(studioBtn);
    header.appendChild(_statusDot);

    /* Module container */
    var container = document.createElement('div');
    container.id = 'mhb-module-container';
    container.className = 'mhb-module-container';

    mountEl.appendChild(header);
    mountEl.appendChild(container);

    return { select: select };
  }

  /* ── Start ──────────────────────────────────────────────────────────────── */

  function start(properties, initReceived) {
    MHB.runtime.properties = properties || {};

    /* Mode */
    var mode = (MHB.runtime.omiHosted && initReceived) ? 'live' : 'simulation';
    MHB.runtime.mode = mode;

    /* Theme */
    var themeId = String(properties.theme || 'dark').toLowerCase();
    MHB.theme.apply(themeId);

    /* Build shell */
    var mountEl = document.getElementById('app');
    if (!mountEl) { mountEl = document.body; }
    var shell = buildShell(mountEl);

    /* Load registry then populate dropdown and load default module */
    MHB.registry.load().then(function () {
      populateDropdown(shell.select);
      var ids = MHB.registry.list();
      if (!ids.length) { return; }

      var defaultId = String(properties.defaultModule || 'bag-filter-tracker');
      /* Fallback to first resolvable id */
      var targetId = (ids.indexOf(defaultId) !== -1) ? defaultId : ids[0];

      shell.select.value = targetId;
      loadModule(targetId);

      shell.select.addEventListener('change', function () {
        loadModule(shell.select.value);
      });
    });

    /* When library ids arrive asynchronously, re-render the dropdown */
    MHB.bus.on('registry:updated', function () {
      populateDropdown(shell.select);
    });

    /* When Studio publishes, reload registry (picks up newly published module) */
    MHB.bus.on('registry:refresh', function () {
      MHB.registry.clearCache();
      MHB.registry.load().then(function () {
        populateDropdown(shell.select);
      });
    });

    /* Store-status refresh loop */
    refreshStatus();
    _statusTimer = setInterval(refreshStatus, 5000);

    /* Initialise store client with storeUrl/storeKey from host properties (§9) */
    if (MHB.storeClient && typeof MHB.storeClient.init === 'function') {
      MHB.storeClient.init({
        storeUrl: properties.storeUrl || '',
        storeKey: properties.storeKey || '',
      });
    }

    /* Announce mode */
    MHB.bus.emit('runtime:started', { mode: mode, simulation: mode === 'simulation' });
  }

  /* ── omi:propertyChanged handler ─────────────────────────────────────────── */

  function onPropertyChanged(name, value) {
    switch (name) {
      case 'theme':
        MHB.theme.apply(String(value).toLowerCase());
        break;
      case 'defaultModule':
        loadModule(String(value));
        break;
      case 'canEdit':
        MHB.runtime.canEdit = (value === true || value === 'true' || value === 1 || value === '1');
        break;
      default:
        break;
    }
  }

  /* ── OMI message listener ───────────────────────────────────────────────── */

  window.addEventListener('message', function (event) {
    var msg = event.data;
    if (!msg || !msg.type) { return; }
    switch (msg.type) {
      case 'omi:init':
        if (!started) {
          started = true;
          clearTimeout(initFallbackTimer);
          start(msg.properties || {}, true);
        }
        break;
      case 'omi:propertyChanged':
        if (started) { onPropertyChanged(msg.name, msg.value); }
        break;
      case 'omi:resize':
        MHB.bus.emit('app:resize', { width: msg.width, height: msg.height });
        break;
      default:
        break;
    }
  });

  /* ── DOMContentLoaded bootstrap ─────────────────────────────────────────── */

  document.addEventListener('DOMContentLoaded', function () {
    try {
      MHB.runtime.omiHosted = window.parent !== window;
    } catch (e) {
      MHB.runtime.omiHosted = true;   // cross-origin parent — assume hosted
    }

    window.parent.postMessage({ type: 'omi:ready' }, '*');

    if (MHB.runtime.omiHosted) {
      /* Give the host 2500 ms to send omi:init; fall back to simulation. */
      initFallbackTimer = setTimeout(function () {
        if (!started) { started = true; start({}, false); }
      }, 2500);
    } else {
      /* Standalone: start immediately in simulation */
      started = true;
      start({}, false);
    }
  });

}(window.MHB));
