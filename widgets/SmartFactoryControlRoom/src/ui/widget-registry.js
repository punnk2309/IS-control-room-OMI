/* ============================================================================
 * SFP.widgets — widget type registry
 * ----------------------------------------------------------------------------
 * A widget type is registered once and instantiated by the dashboard renderer
 * any number of times from dashboard config. Contract:
 *
 *   SFP.widgets.register('my-widget', {
 *     create: function (ctx) {
 *       // build DOM inside ctx.root, subscribe via ctx.subscribe(...)
 *       return {
 *         destroy: function () {},   // optional — free non-data resources
 *         resize: function () {},    // optional — container size changed
 *       };
 *     }
 *   });
 *
 * ctx provides:
 *   root           HTMLElement to render into (already placed in the grid)
 *   options        widget instance options from dashboard config
 *   bind           datapoint bindings from dashboard config
 *   params         navigation parameters of the current page
 *   subscribe(id, cb)  hub subscription that is auto-released on destroy
 *   onBus(event, cb)   bus subscription that is auto-released on destroy
 *   hub, theme, states, alarms, machines, nav, format, dom, icons
 * ========================================================================== */
(function (SFP) {
  'use strict';

  var types = {};

  SFP.widgets = {
    register: function (type, def) {
      if (types[type]) { console.warn('[SFP.widgets] Re-registering "' + type + '"'); }
      types[type] = def;
    },

    has: function (type) { return type in types; },

    types: function () { return Object.keys(types); },

    create: function (type, ctx) {
      var def = types[type];
      if (!def) { throw new Error('Unknown widget type "' + type + '"'); }
      return def.create(ctx) || {};
    },
  };
}(window.SFP));
