/* ============================================================================
 * SFP.config — override / persistence layer
 * ----------------------------------------------------------------------------
 * Extends the base SFP.config registry (must load after config-registry.js)
 * with a localStorage-backed override mechanism.
 *
 * Usage:
 *   SFP.config.override('dashboard.overview', { ...newCfg });
 *     → calls SFP.config.define so the change is live immediately, AND
 *       persists it to localStorage key 'sfp.configOverrides'.
 *
 *   SFP.config.clearOverride('dashboard.overview');
 *     → removes the entry from storage. NOTE: the in-memory define() is NOT
 *       reverted — a page reload is required to restore file-declared state.
 *
 *   SFP.config.exportConfigJs('dashboard.overview');
 *     → returns a ready-to-commit .config.js source string.
 *
 *   SFP.config.downloadConfigJs('dashboard.overview', 'overview.dashboard.js');
 *     → triggers a browser download of the exported source.
 *
 * Bootstrap: at the bottom of this IIFE every persisted override is re-applied
 * via SFP.config.define() so that overrides survive reloads automatically.
 * This file must therefore be loaded AFTER all baseline config files but
 * BEFORE the app bootstrap that reads those configs.
 * ========================================================================== */
(function (SFP) {
  'use strict';

  var STORAGE_KEY = 'sfp.configOverrides';

  /* ── internal storage helpers ─────────────────────────────────────────── */

  function readMap() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) { return JSON.parse(raw); }
    } catch (e) { /* storage unavailable or corrupted — treat as empty */ }
    return {};
  }

  function writeMap(map) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
      return true;
    } catch (e) {
      /* storage may be full or sandboxed */
      console.warn('[SFP.config] writeMap failed:', e);
      return false;
    }
  }

  /* ── public API — mixed onto the existing SFP.config object ──────────── */

  /**
   * override(id, obj)
   * Registers obj as the live config for id (via SFP.config.define) and
   * persists it into localStorage so the override survives a page reload.
   *
   * Permission gate: when SFP.runtime exists and canEdit === false the call is
   * refused (no write, console.warn). This is belt-and-braces protection; the
   * primary UI entry points are already gated. The startup applyPersistedOverrides
   * path is unaffected because it calls SFP.config.define() directly, not this
   * function. Non-edit callers (e.g. export helpers) also call define() directly.
   */
  SFP.config.override = function (id, obj) {
    if (window.SFP && window.SFP.runtime && window.SFP.runtime.canEdit === false) {
      console.warn('[SFP.config] override("' + id + '") refused — canEdit is false.');
      return false;
    }
    SFP.config.define(id, obj);
    var map = readMap();
    map[id] = obj;
    return writeMap(map);
  };

  /**
   * overrides()
   * Returns the complete persisted override map ({ configId: configObj, ... }).
   * Returns {} when no overrides are stored.
   */
  SFP.config.overrides = function () {
    return readMap();
  };

  /**
   * hasOverride(id)
   * Returns true when a persisted override exists for id.
   */
  SFP.config.hasOverride = function (id) {
    return id in readMap();
  };

  /**
   * clearOverride(id)
   * Removes the persisted override for id from localStorage.
   * IMPORTANT: the in-memory config (from the last define/override call) is
   * NOT reverted. Reload the page to restore the file-declared config value.
   */
  SFP.config.clearOverride = function (id) {
    var map = readMap();
    delete map[id];
    writeMap(map);
  };

  /**
   * clearAllOverrides()
   * Removes the entire override storage key. All overrides remain live in
   * memory until the page is reloaded.
   */
  SFP.config.clearAllOverrides = function () {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) { /* storage unavailable — ignore */ }
  };

  /**
   * exportConfigJs(id)
   * Returns a string containing a complete, ready-to-commit .config.js file
   * for the given id. The config object is taken from the live in-memory
   * registry (SFP.config.get), so it reflects the most recent override.
   *
   * @param  {string} id  Config registry id (e.g. 'dashboard.overview')
   * @returns {string}    JavaScript source suitable for saving as a .config.js
   */
  SFP.config.exportConfigJs = function (id) {
    var obj = SFP.config.get(id);
    var now = new Date().toISOString();
    return (
      '/* Exported by the SFP visual editor — ' + now + '\n' +
      ' * Source config id: ' + id + '\n' +
      ' * Commit this file to make the override permanent, then remove the\n' +
      ' * localStorage entry via SFP.config.clearOverride(\'' + id + '\').\n' +
      ' */\n' +
      'SFP.config.define(\'' + id + '\', ' + JSON.stringify(obj, null, 2) + ');\n'
    );
  };

  /**
   * downloadConfigJs(id, filename)
   * Triggers a browser file-download of the exported .config.js source.
   *
   * @param {string} id        Config registry id
   * @param {string} filename  Suggested download filename (e.g. 'overview.dashboard.js')
   */
  SFP.config.downloadConfigJs = function (id, filename) {
    var source = SFP.config.exportConfigJs(id);
    var blob = new Blob([source], { type: 'text/javascript' });
    var url = URL.createObjectURL(blob);
    var anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename || (id + '.config.js');
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  };

  /* ── Bootstrap: re-apply all persisted overrides on load ─────────────── */

  (function applyPersistedOverrides() {
    var map = readMap();
    var ids = Object.keys(map);
    if (ids.length === 0) { return; }
    ids.forEach(function (id) {
      SFP.config.define(id, map[id]);
    });
    console.info('[SFP.config] Persisted overrides active: ' + ids.join(', '));
  }());

}(window.SFP));
