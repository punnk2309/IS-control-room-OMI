/* ============================================================================
 * ModuleHub SDK Data — widgets/ModuleHub/src/sdk/sdk-data.js
 * ----------------------------------------------------------------------------
 * MODULE-SIDE. Attaches builder MH._build.data(bridge) → { api, onTagValue }.
 * Implements sdk.data per contract §6:
 *   subscribe(tag, cb)  → unsubscribe fn; sends mh:subscribe; routes mh:tagValue
 *   write(tag, value)   → Promise; sends mh:writeTag
 *
 * Multiple subscribers per tag are supported. mh:unsubscribe is only sent when
 * the last callback for a given tag is removed.
 *
 * Contract: modulehub-contracts.md §5, §6
 * ========================================================================== */
(function () {
  'use strict';

  if (!window.MH || !window.MH._build) {
    throw new Error('[MH] sdk-data.js loaded before sdk-bootstrap.js');
  }

  MH._build.data = function buildData(bridge) {

    /* tagListeners: tag → Array<cb> */
    var tagListeners = {};

    /* ── subscribe ────────────────────────────────────────────────────────── */

    /**
     * Subscribe to a tag.
     * @param {string} tag
     * @param {function} cb  — called with { value, quality, ts }
     * @returns {function}   — call to unsubscribe
     */
    function subscribe(tag, cb) {
      if (typeof tag !== 'string' || !tag) {
        throw new Error('[MH.data] subscribe: tag must be a non-empty string');
      }
      if (typeof cb !== 'function') {
        throw new Error('[MH.data] subscribe: cb must be a function');
      }

      if (!tagListeners[tag]) {
        tagListeners[tag] = [];
        /* First subscriber — tell host to start delivering values */
        bridge.request({ type: 'mh:subscribe', tag: tag })
          .catch(function (err) {
            /* Permission denied or other error — silently log */
            bridge.send({ type: 'mh:log', level: 'warn',
              args: ['[MH.data] subscribe failed for tag ' + tag + ': ' + err.message] });
          });
      }

      tagListeners[tag].push(cb);

      /* Return unsubscribe fn */
      return function unsubscribe() {
        var list = tagListeners[tag];
        if (!list) { return; }
        var idx = list.indexOf(cb);
        if (idx !== -1) { list.splice(idx, 1); }
        if (list.length === 0) {
          delete tagListeners[tag];
          /* Last subscriber removed — fire-and-forget unsubscribe */
          bridge.send({ type: 'mh:unsubscribe', mh: 1, tag: tag });
        }
      };
    }

    /* ── write ────────────────────────────────────────────────────────────── */

    /**
     * Write a value to a tag.
     * @param {string} tag
     * @param {*} value
     * @returns {Promise<void>}
     */
    function write(tag, value) {
      return bridge.request({ type: 'mh:writeTag', tag: tag, value: value })
        .then(function () { /* resolve void */ });
    }

    /* ── incoming tag value router ────────────────────────────────────────── */

    /**
     * Called by sdk-bootstrap when a mh:tagValue message arrives.
     * @param {object} d  — { tag, value, quality, ts }
     */
    function onTagValue(d) {
      var list = tagListeners[d.tag];
      if (!list || list.length === 0) { return; }
      var payload = { value: d.value, quality: d.quality, ts: d.ts };
      /* Snapshot the list before iterating in case a cb calls unsubscribe */
      list.slice().forEach(function (cb) {
        try { cb(payload); } catch (e) { /* isolate module errors */ }
      });
    }

    return {
      api: {
        subscribe: subscribe,
        write:     write,
      },
      onTagValue: onTagValue,
    };
  };

}());
