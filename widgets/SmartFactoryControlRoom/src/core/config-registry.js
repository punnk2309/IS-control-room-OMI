/* ============================================================================
 * SFP.config — configuration registry
 * ----------------------------------------------------------------------------
 * All platform behaviour is driven by declarative config objects that live in
 * the /config folder. Config files are plain .js files that call:
 *
 *     SFP.config.define('dashboard.overview', { ... });
 *
 * They contain *data only* — no logic. The .js wrapper (instead of .json) is
 * deliberate: it loads via <script> tags, which works from file:// and inside
 * the OMI host without fetch/CORS issues, and supports comments.
 * ========================================================================== */
(function (SFP) {
  'use strict';

  var store = {};

  SFP.config = {
    /** Register a config object under an id. Later defines replace earlier
     *  ones, which allows site-specific override files to be appended in
     *  index.html after the defaults. */
    define: function (id, value) {
      store[id] = value;
    },

    /** Get a config object. Throws when required config is missing so that
     *  misconfiguration fails loudly at startup, not silently at runtime. */
    get: function (id, optional) {
      if (!(id in store)) {
        if (optional) { return null; }
        throw new Error('[SFP.config] Missing required config: "' + id + '"');
      }
      return store[id];
    },

    has: function (id) { return id in store; },

    /** List ids, optionally filtered by prefix (e.g. 'dashboard.'). */
    ids: function (prefix) {
      return Object.keys(store).filter(function (id) {
        return !prefix || id.indexOf(prefix) === 0;
      });
    },
  };
}(window.SFP));
