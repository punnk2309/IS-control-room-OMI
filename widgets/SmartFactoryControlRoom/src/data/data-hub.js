/* ============================================================================
 * SFP.data.hub — the data abstraction layer
 * ----------------------------------------------------------------------------
 * Widgets never talk to Historian/MES/SAP/SQL/REST/OMI directly. They bind to
 * *datapoints* — logical ids like 'production.rate' — and the hub routes each
 * datapoint to a data source based on its definition (config/tags.config.js)
 * and the active data mode.
 *
 * Datapoint definition shape (all fields optional except via usage):
 *   {
 *     label:    'Production Rate',
 *     unit:     'units/hr',
 *     decimals: 0,
 *     kind:     'scalar' | 'dataset',          // default 'scalar'
 *     source:   { type: 'omi', address: 'Production.Rate' },   // live binding
 *     derived:  { op: 'sum', inputs: [...] },                  // computed
 *     sim:      { type: 'wave', min: .., max: .., period: '6h' },
 *     history:  { window: '24h', interval: '2m' },
 *   }
 *
 * Source routing per datapoint:
 *   - `derived` definitions always use the derived source (any mode).
 *   - live mode  -> def.source.type (e.g. 'omi', 'rest');
 *                   if no live binding exists, falls back to simulation and
 *                   stamps quality 'Simulated' so the UI can disclose it.
 *   - simulation -> the simulation source.
 *
 * Samples delivered to subscribers: { value, quality, ts }
 *   quality: 'Good' | 'Uncertain' | 'Bad' | 'Disconnected' | 'Simulated'
 * ========================================================================== */
(function (SFP) {
  'use strict';

  var format = SFP.format;

  function DataHub() {
    this.defs = {};          // id -> normalized definition
    this.entries = {};       // id -> { last, listeners[], history, binding }
    this.sources = {};       // type -> source implementation
    this.mode = 'simulation';
    this.simulateUnbound = true;   // live mode: simulate datapoints w/o source
  }

  /* ── Definition management ─────────────────────────────────────────────── */

  DataHub.prototype.define = function (id, def) {
    this.defs[id] = def || {};
  };

  DataHub.prototype.defineAll = function (defsById) {
    Object.keys(defsById || {}).forEach(function (id) {
      this.define(id, defsById[id]);
    }, this);
  };

  DataHub.prototype.def = function (id) { return this.defs[id] || null; };

  /* ── Source registration ───────────────────────────────────────────────── */

  /** A source implements: activate(id, def, publish), deactivate(id, def).
   *  `publish(value, quality, ts)` pushes a sample for that datapoint. */
  DataHub.prototype.registerSource = function (type, source) {
    this.sources[type] = source;
  };

  /* ── Mode switching ────────────────────────────────────────────────────── */

  DataHub.prototype.setMode = function (mode) {
    if (mode === this.mode) { return; }
    var hub = this;
    /* Re-route every active datapoint through the source for the new mode. */
    var activeIds = Object.keys(this.entries).filter(function (id) {
      return hub.entries[id].binding;
    });
    activeIds.forEach(function (id) { hub._deactivate(id); });
    this.mode = mode;
    activeIds.forEach(function (id) { hub._activate(id); });
    SFP.bus.emit('data:modeChanged', { mode: mode });
  };

  /** Re-route every active datapoint (e.g. after a tagPrefix change). */
  DataHub.prototype.rebindAll = function () {
    var hub = this;
    Object.keys(this.entries).forEach(function (id) {
      if (hub.entries[id].binding) {
        hub._deactivate(id);
        hub._activate(id);
      }
    });
  };

  /* ── Subscription API (what widgets use) ───────────────────────────────── */

  /** Subscribe to a datapoint. cb(sample) fires immediately when a value is
   *  already known, then on every update. Returns an unsubscribe function. */
  DataHub.prototype.subscribe = function (id, cb) {
    var entry = this._entry(id);
    entry.listeners.push(cb);
    if (entry.listeners.length === 1) { this._activate(id); }
    if (entry.last) {
      try { cb(entry.last); } catch (err) { console.error('[SFP.data] subscriber error', err); }
    }
    var hub = this;
    return function () {
      var i = entry.listeners.indexOf(cb);
      if (i >= 0) { entry.listeners.splice(i, 1); }
      if (entry.listeners.length === 0) { hub._deactivate(id); }
    };
  };

  /** Returns true when mode is 'live' AND the datapoint has no real live
   *  source binding (i.e. it would route to null or simulation fallback).
   *  Computed and derived datapoints are never considered unbound. */
  DataHub.prototype.isUnbound = function (id) {
    if (this.mode !== 'live') { return false; }
    var def = this.defs[id];
    if (!def) { return false; }
    if (def.computed || def.derived) { return false; }
    return !(def.source && this.sources[def.source.type]);
  };

  /** Last known sample, or null. Does not activate the datapoint. */
  DataHub.prototype.get = function (id) {
    var entry = this.entries[id];
    return entry ? entry.last : null;
  };

  /** History samples [{t, v}] for a datapoint (requires `history` in def). */
  DataHub.prototype.history = function (id, rangeMs) {
    var entry = this.entries[id];
    return (entry && entry.history) ? entry.history.range(rangeMs) : [];
  };

  DataHub.prototype.historyWindowMs = function (id) {
    var entry = this.entries[id];
    return (entry && entry.history) ? entry.history.windowMs : 0;
  };

  /* ── Publishing (what sources and computed publishers use) ─────────────── */

  DataHub.prototype.publish = function (id, value, quality, ts) {
    var entry = this._entry(id);
    var sample = {
      value: value,
      quality: (entry.qualityOverride || quality || 'Good'),
      ts: ts || Date.now(),
    };
    entry.last = sample;
    if (entry.history && typeof value === 'number' && isFinite(value)) {
      entry.history.push(sample.ts, value);
    }
    entry.listeners.slice().forEach(function (cb) {
      try { cb(sample); } catch (err) { console.error('[SFP.data] subscriber error', err); }
    });
  };

  /** Direct access to a datapoint's HistoryBuffer (sources backfill via this). */
  DataHub.prototype.buffer = function (id) {
    return this._entry(id).history;
  };

  /* ── Internals ─────────────────────────────────────────────────────────── */

  DataHub.prototype._entry = function (id) {
    var entry = this.entries[id];
    if (!entry) {
      var def = this.defs[id];
      var history = null;
      if (def && def.history) {
        history = new SFP.data.HistoryBuffer(
          format.duration(def.history.window),
          format.duration(def.history.interval || '1m')
        );
      }
      entry = this.entries[id] = {
        last: null, listeners: [], history: history,
        binding: null, qualityOverride: null,
      };
    }
    return entry;
  };

  DataHub.prototype._route = function (id, def) {
    if (def.computed) { return { type: 'computed', qualityOverride: null }; }
    if (def.derived) { return { type: 'derived', qualityOverride: null }; }
    if (this.mode === 'live') {
      if (def.source && this.sources[def.source.type]) {
        return { type: def.source.type, qualityOverride: null };
      }
      if (this.simulateUnbound) {
        /* Honest fallback: data flows, but is visibly marked as simulated. */
        return { type: 'simulation', qualityOverride: 'Simulated' };
      }
      return null;
    }
    return { type: 'simulation', qualityOverride: null };
  };

  DataHub.prototype._activate = function (id) {
    var def = this.defs[id];
    var entry = this._entry(id);
    if (!def) {
      console.error('[SFP.data] Subscribe to unknown datapoint: "' + id + '"');
      this.publish(id, null, 'Bad');
      return;
    }
    var route = this._route(id, def);
    if (!route) {
      this.publish(id, null, 'Bad');
      return;
    }
    var source = this.sources[route.type];
    if (!source) {
      console.error('[SFP.data] No source registered for type "' + route.type + '" (datapoint "' + id + '")');
      this.publish(id, null, 'Bad');
      return;
    }
    entry.qualityOverride = route.qualityOverride;
    entry.binding = route.type;
    var hub = this;
    source.activate(id, def, function (value, quality, ts) {
      hub.publish(id, value, quality, ts);
    });
  };

  DataHub.prototype._deactivate = function (id) {
    var entry = this.entries[id];
    if (!entry || !entry.binding) { return; }
    var source = this.sources[entry.binding];
    if (source && source.deactivate) { source.deactivate(id, this.defs[id]); }
    entry.binding = null;
    entry.qualityOverride = null;
  };

  SFP.data.DataHub = DataHub;
  SFP.data.hub = new DataHub();
}(window.SFP));
