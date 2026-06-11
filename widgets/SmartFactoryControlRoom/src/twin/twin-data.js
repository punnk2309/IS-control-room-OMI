/* ============================================================================
 * SFP.twin.TwinData — binding layer between the twin and the DataHub
 * ----------------------------------------------------------------------------
 * The twin never subscribes to the hub directly from render code. This layer:
 *
 *   - subscribes once per datapoint used by the model (machines, connections,
 *     badges) through ctx.subscribe, so everything is auto-released when the
 *     page is destroyed
 *   - keeps the latest sample per datapoint in a plain map the render loop
 *     reads each frame (no re-render plumbing per sample)
 *   - classifies every binding for the current data-source mode:
 *
 *       'sim'      simulation mode — generated data, full dashboard alive
 *       'live'     live mode, real source delivering good data
 *       'waiting'  live mode, real source configured but no good data yet
 *       'unwired'  live mode, NO real source configured (simulation-only
 *                  binding) -> rendered as a no-data state. This is the
 *                  "visual implementation checklist": anything unwired is
 *                  work remaining.
 *
 *   - computes wiring coverage (X of Y bindings have real sources) for the
 *     toolbar's Live-mode progress chip
 *
 * Mode switching needs nothing from this module: the DataHub re-routes all
 * active subscriptions on setMode(), and status() reads SFP.runtime.mode
 * fresh on every call.
 * ========================================================================== */
(function (SFP) {
  'use strict';

  SFP.twin = SFP.twin || {};

  function TwinData(ctx, model) {
    this.ctx = ctx;
    this.hub = ctx.hub;
    this.values = {};        // datapoint id -> latest sample { value, quality, ts }
    this.tracked = [];       // datapoint ids in use by this page
    this._trackModel(model);
  }

  TwinData.prototype._trackModel = function (model) {
    var self = this;
    function track(dpId) {
      if (!dpId || self.values.hasOwnProperty(dpId)) { return; }
      self.values[dpId] = null;
      self.tracked.push(dpId);
      self.ctx.subscribe(dpId, function (sample) { self.values[dpId] = sample; });
    }

    Object.keys(model.elements).forEach(function (id) {
      var el = model.elements[id];
      if (el.statusBinding) { track(el.statusBinding); }
      if (el.bindings) {
        if (el.bindings.state) { track(el.bindings.state.datapoint); }
        if (el.bindings.value) { track(el.bindings.value.datapoint); }
      }
    });
    model.connections.forEach(function (c) {
      track(c.binding);
      c.badges.forEach(function (b) { track(b.datapoint); });
    });
  };

  /** Latest sample for a datapoint (or null). */
  TwinData.prototype.sample = function (dpId) {
    return dpId ? this.values[dpId] || null : null;
  };

  /** Numeric value, or null when absent / non-numeric / no-data in live. */
  TwinData.prototype.num = function (dpId) {
    if (this.status(dpId) === 'unwired') { return null; }
    var s = this.sample(dpId);
    return (s && typeof s.value === 'number' && isFinite(s.value)) ? s.value : null;
  };

  /** Raw value honouring no-data semantics (strings allowed, e.g. states). */
  TwinData.prototype.value = function (dpId) {
    if (this.status(dpId) === 'unwired') { return null; }
    var s = this.sample(dpId);
    return s ? s.value : null;
  };

  /** Binding status for the CURRENT mode — see header for the four states. */
  TwinData.prototype.status = function (dpId) {
    if (!dpId) { return 'unwired'; }
    if (SFP.runtime.mode !== 'live') { return 'sim'; }
    var def = this.hub.def(dpId) || {};
    /* derived/computed datapoints count as wired — they are real plumbing. */
    if (!def.source && !def.derived && !def.computed) { return 'unwired'; }
    var s = this.sample(dpId);
    if (!s || s.value === null || s.value === undefined) { return 'waiting'; }
    /* 'Simulated' quality = the hub's marked fallback, i.e. not real data. */
    if (s.quality === 'Bad' || s.quality === 'Disconnected' ||
        s.quality === 'Simulated') { return 'waiting'; }
    return 'live';
  };

  /** True when the binding should render as a no-data state. */
  TwinData.prototype.noData = function (dpId) {
    var st = this.status(dpId);
    return st === 'unwired' || st === 'waiting';
  };

  /** Wiring coverage across all bindings this page uses (live-mode chip). */
  TwinData.prototype.coverage = function () {
    var hub = this.hub;
    var wired = 0, items = [];
    this.tracked.forEach(function (dpId) {
      var def = hub.def(dpId) || {};
      var hasSource = !!(def.source || def.derived || def.computed);
      if (hasSource) { wired += 1; }
      items.push({ datapoint: dpId, label: def.label || dpId, wired: hasSource });
    });
    return { wired: wired, total: this.tracked.length, items: items };
  };

  SFP.twin.TwinData = TwinData;
}(window.SFP));
