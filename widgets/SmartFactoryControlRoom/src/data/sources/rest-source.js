/* ============================================================================
 * REST source — generic polling adapter for HTTP/JSON endpoints
 * ----------------------------------------------------------------------------
 * Covers Historian REST APIs, MES, SAP gateways, SQL-backed services — any
 * system that can expose JSON over HTTP. Datapoint binding:
 *
 *   source: {
 *     type: 'rest',
 *     url: 'https://mes.example.com/api/workorders?line=A',
 *     intervalMs: 30000,            // poll period (default 30s)
 *     path: 'data.items',           // optional dot-path into the response
 *     headers: { 'X-Api-Key': '…' } // optional static headers
 *   }
 *
 * The extracted value is published as-is: a number for scalar datapoints, an
 * array of row objects for dataset datapoints. Failures publish quality 'Bad'
 * and keep polling — transient outages self-heal.
 * ========================================================================== */
(function (SFP) {
  'use strict';

  function pluck(obj, path) {
    if (!path) { return obj; }
    return path.split('.').reduce(function (acc, key) {
      return (acc === null || acc === undefined) ? acc : acc[key];
    }, obj);
  }

  function RestSource() {
    this.timers = {};   // datapoint id -> interval handle
  }

  RestSource.prototype.activate = function (id, def, publish) {
    var src = def.source;
    var poll = function () {
      fetch(src.url, { headers: src.headers || {} })
        .then(function (res) {
          if (!res.ok) { throw new Error('HTTP ' + res.status); }
          return res.json();
        })
        .then(function (json) {
          publish(pluck(json, src.path), 'Good');
        })
        .catch(function (err) {
          console.error('[SFP.rest] poll failed for "' + id + '":', err.message);
          publish(null, 'Bad');
        });
    };
    poll();
    this.timers[id] = setInterval(poll, src.intervalMs || 30000);
  };

  RestSource.prototype.deactivate = function (id) {
    if (this.timers[id]) {
      clearInterval(this.timers[id]);
      delete this.timers[id];
    }
  };

  SFP.data.RestSource = RestSource;
}(window.SFP));
