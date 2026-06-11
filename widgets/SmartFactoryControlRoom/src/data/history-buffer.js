/* ============================================================================
 * SFP.data.HistoryBuffer — bounded time-series buffer for one datapoint
 * ----------------------------------------------------------------------------
 * Keeps { t, v } samples covering a rolling window. Appends are throttled to
 * a minimum interval so high-frequency live tags don't flood memory: the most
 * recent sample is always updated in place, but a new sample slot is only
 * created once `intervalMs` has elapsed since the previous slot.
 * ========================================================================== */
(function (SFP) {
  'use strict';

  function HistoryBuffer(windowMs, intervalMs) {
    this.windowMs = windowMs;
    this.intervalMs = Math.max(intervalMs || 1000, 250);
    /* +20% slack so trimming doesn't run on every append */
    this.maxSamples = Math.ceil(windowMs / this.intervalMs * 1.2) + 4;
    this.samples = [];
  }

  HistoryBuffer.prototype.push = function (t, v) {
    var s = this.samples;
    var last = s[s.length - 1];
    if (last && (t - last.t) < this.intervalMs) {
      last.v = v;            // refresh current slot instead of appending
      return;
    }
    s.push({ t: t, v: v });
    if (s.length > this.maxSamples) {
      s.splice(0, s.length - this.maxSamples);
    }
  };

  /** Samples within [now - rangeMs, now]; whole window when no range given. */
  HistoryBuffer.prototype.range = function (rangeMs) {
    var cutoff = Date.now() - (rangeMs || this.windowMs);
    return this.samples.filter(function (p) { return p.t >= cutoff; });
  };

  /** Backfill from a generator fn(t) -> value, oldest to newest. Used by the
   *  simulation source so charts have realistic history at startup. */
  HistoryBuffer.prototype.backfill = function (generator) {
    var now = Date.now();
    this.samples = [];
    for (var t = now - this.windowMs; t <= now; t += this.intervalMs) {
      this.samples.push({ t: t, v: generator(t) });
    }
  };

  SFP.data.HistoryBuffer = HistoryBuffer;
}(window.SFP));
