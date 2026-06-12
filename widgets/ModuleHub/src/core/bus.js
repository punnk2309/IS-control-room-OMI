/* ============================================================================
 * ModuleHub — event bus (MHB.bus)
 * ----------------------------------------------------------------------------
 * Tiny pub/sub. Mirrors the control-room's event-bus pattern.
 * Usage:
 *   MHB.bus.on('theme:changed', fn)   → returns off()
 *   MHB.bus.emit('theme:changed', {})
 *   MHB.bus.off('theme:changed', fn)
 *
 * Contract: modulehub-contracts.md §10
 * ========================================================================== */
(function (MHB) {
  'use strict';

  var _handlers = {};   // event -> [fn, ...]

  MHB.bus = {
    on: function (event, fn) {
      if (!_handlers[event]) { _handlers[event] = []; }
      _handlers[event].push(fn);
      var self = this;
      return function off() { self.off(event, fn); };
    },

    off: function (event, fn) {
      if (!_handlers[event]) { return; }
      _handlers[event] = _handlers[event].filter(function (h) { return h !== fn; });
    },

    emit: function (event, data) {
      var list = _handlers[event];
      if (!list) { return; }
      list.slice().forEach(function (fn) {
        try { fn(data); } catch (e) {
          console.error('[MHB.bus] handler error on "' + event + '":', e);
        }
      });
    },

    /** Remove all handlers for an event (or all events if omitted). */
    clear: function (event) {
      if (event) { delete _handlers[event]; }
      else { _handlers = {}; }
    },
  };
}(window.MHB));
