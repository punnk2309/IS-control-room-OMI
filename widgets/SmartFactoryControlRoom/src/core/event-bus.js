/* ============================================================================
 * SFP.bus — application event bus
 * ----------------------------------------------------------------------------
 * Decouples modules and widgets from each other. Well-known events:
 *
 *   'nav:changed'        { page, params }
 *   'theme:changed'      { themeId }
 *   'data:modeChanged'   { mode }
 *   'alarm:raised'       { alarm }
 *   'alarm:cleared'      { alarm }
 *   'alarm:summary'      { active, worstSeverity, counts }
 *   'machines:counts'    { counts, byZone }
 *   'map:zoneSelected'   { zoneId }
 *   'app:resize'         { width, height }
 * ========================================================================== */
(function (SFP) {
  'use strict';

  var handlers = {};

  SFP.bus = {
    /** Subscribe. Returns an unsubscribe function. */
    on: function (event, fn) {
      (handlers[event] = handlers[event] || []).push(fn);
      return function () {
        var list = handlers[event] || [];
        var i = list.indexOf(fn);
        if (i >= 0) { list.splice(i, 1); }
      };
    },

    emit: function (event, payload) {
      var list = handlers[event];
      if (!list) { return; }
      /* Iterate over a copy so handlers may unsubscribe during dispatch. */
      list.slice().forEach(function (fn) {
        try { fn(payload); }
        catch (err) {
          /* One faulty listener must never break the others. */
          console.error('[SFP.bus] handler error for "' + event + '"', err);
        }
      });
    },
  };
}(window.SFP));
