/* ============================================================================
 * Smart Factory Platform (SFP) — global namespace
 * ----------------------------------------------------------------------------
 * The platform is built as plain script files (no bundler, no ES modules) so
 * it can run from file://, from the OMI widget host, or any static server
 * without a build toolchain. Every module attaches itself to window.SFP.
 *
 * Load order is defined by the <script> tags in index.html.
 * ========================================================================== */
(function () {
  'use strict';

  window.SFP = window.SFP || {
    version: '2.0.0',

    /* Populated by the modules that follow */
    config: null,    // core/config-registry.js
    bus: null,       // core/event-bus.js
    format: null,    // core/format.js
    dom: null,       // core/dom.js
    expr: null,      // core/expressions.js
    icons: null,     // core/icons.js

    data: {},        // data layer (hub, sources, machines)
    state: {},       // state + alarm engines
    ui: {},          // theme, navigation, dashboard renderer, app shell
    widgets: null,   // ui/widget-registry.js

    /* Runtime context, filled in by src/app.js at bootstrap */
    runtime: {
      mode: 'simulation',        // 'simulation' | 'live'
      editMode: false,           // visual config editor active (header toggle)
      omiHosted: false,          // true when running inside an OMI host frame
      properties: {},            // properties received from omi:init
    },
  };
}());
