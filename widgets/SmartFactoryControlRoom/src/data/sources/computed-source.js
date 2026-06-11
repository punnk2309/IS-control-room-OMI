/* ============================================================================
 * Computed source — datapoints published by platform modules
 * ----------------------------------------------------------------------------
 * Some values are produced inside the platform itself (e.g. machine state
 * counts maintained by the machine registry) rather than by an external
 * system. Such datapoints are marked `computed: true` in their definition and
 * are routed here in every data mode.
 *
 * Producers push values with  SFP.data.computedSource.set(id, value)  at any
 * time; the latest value is replayed to widgets that subscribe later.
 * ========================================================================== */
(function (SFP) {
  'use strict';

  function ComputedSource() {
    this.bound = {};    // id -> hub publish fn (while datapoint is active)
    this.values = {};   // id -> last value set by the producer
  }

  /** Producer-side API. */
  ComputedSource.prototype.set = function (id, value, quality) {
    var v = { value: value, quality: quality || 'Good', ts: Date.now() };
    this.values[id] = v;
    if (this.bound[id]) { this.bound[id](v.value, v.quality, v.ts); }
  };

  ComputedSource.prototype.activate = function (id, def, publish) {
    this.bound[id] = publish;
    var v = this.values[id];
    if (v) { publish(v.value, v.quality, v.ts); }
  };

  ComputedSource.prototype.deactivate = function (id) {
    delete this.bound[id];
  };

  SFP.data.ComputedSource = ComputedSource;
}(window.SFP));
