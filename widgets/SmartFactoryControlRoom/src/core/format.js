/* ============================================================================
 * SFP.format — number, time and duration formatting helpers
 * ========================================================================== */
(function (SFP) {
  'use strict';

  var DURATION_UNITS = { ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000 };

  SFP.format = {
    /** 2847.3 -> "2,847" (decimals 0) / "2,847.3" (decimals 1) */
    number: function (value, decimals) {
      if (value === null || value === undefined || isNaN(value)) { return '—'; }
      var d = (decimals === undefined) ? 1 : decimals;
      return Number(value).toLocaleString('en-US', {
        minimumFractionDigits: d,
        maximumFractionDigits: d,
      });
    },

    /** Signed percentage for trend chips: 3.21 -> "+3.2%" */
    signedPercent: function (value, decimals) {
      if (value === null || value === undefined || isNaN(value)) { return '—'; }
      var d = (decimals === undefined) ? 1 : decimals;
      var sign = value > 0 ? '+' : '';
      return sign + value.toFixed(d) + '%';
    },

    /** Parse "24h", "10m", "1500ms", "7d" -> milliseconds. Numbers pass through. */
    duration: function (text) {
      if (typeof text === 'number') { return text; }
      var m = /^(\d+(?:\.\d+)?)(ms|s|m|h|d)$/.exec(String(text).trim());
      if (!m) { throw new Error('[SFP.format] Bad duration: "' + text + '"'); }
      return parseFloat(m[1]) * DURATION_UNITS[m[2]];
    },

    /** Human label for a duration in ms: 3600000 -> "1h" */
    durationLabel: function (ms) {
      if (ms >= DURATION_UNITS.d) { return Math.round(ms / DURATION_UNITS.d) + 'd'; }
      if (ms >= DURATION_UNITS.h) { return Math.round(ms / DURATION_UNITS.h) + 'h'; }
      if (ms >= DURATION_UNITS.m) { return Math.round(ms / DURATION_UNITS.m) + 'm'; }
      return Math.round(ms / 1000) + 's';
    },

    /** "2 min ago" style relative time. */
    timeAgo: function (ts) {
      var diff = Date.now() - ts;
      if (diff < 60000) { return 'just now'; }
      if (diff < 3600000) { return Math.floor(diff / 60000) + ' min ago'; }
      if (diff < 86400000) { return Math.floor(diff / 3600000) + ' hr ago'; }
      return Math.floor(diff / 86400000) + ' d ago';
    },

    /** Axis label for a timestamp, scaled to the visible range. */
    timeAxis: function (ts, rangeMs) {
      var d = new Date(ts);
      if (rangeMs > DURATION_UNITS.d * 2) {
        return (d.getMonth() + 1) + '/' + d.getDate();
      }
      return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
    },

    clock: function (now) {
      return now.toLocaleTimeString('en-US', { hour12: false });
    },

    clockDate: function (now) {
      return now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    },

    /** "{name} is {value}" template substitution from a context object. */
    template: function (text, ctx) {
      return String(text).replace(/\{(\w+)\}/g, function (_, key) {
        return (ctx && key in ctx && ctx[key] !== null && ctx[key] !== undefined)
          ? ctx[key] : '{' + key + '}';
      });
    },
  };
}(window.SFP));
