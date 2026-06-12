/* ============================================================================
 * ModuleHub — global namespace (window.MHB)
 * ----------------------------------------------------------------------------
 * Plain-JS IIFE, no build step. All ModuleHub host-side files attach to MHB.
 * Load order is defined by the <script> tags in index.html.
 *
 * Contract: modulehub-contracts.md §10
 * ========================================================================== */
(function () {
  'use strict';

  window.MHB = window.MHB || {
    version: '0.1.0',

    /* Sub-namespaces — populated by files that follow */
    core: {},     // bus, registry, theme
    ui: {},       // shell helpers

    /* Loader/sandbox attach here; runtime context filled by src/app.js */
    runtime: {
      mode: 'simulation',   // 'simulation' | 'live'
      omiHosted: false,
      properties: {},
    },

    /* Host-side store client — set by src/sdk/sdk-store.js */
    storeClient: null,

    /* Asset data blob — set by src/sdk/sdk-assets-data.js */
    assetData: null,

    /* Studio hook — set by studio if loaded */
    studio: null,
  };
}());
