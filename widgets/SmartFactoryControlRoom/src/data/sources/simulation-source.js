/* ============================================================================
 * Simulation source — generates realistic demo data
 * ----------------------------------------------------------------------------
 * Used when the widget runs outside an OMI host (development, demos) and as a
 * clearly-marked fallback for datapoints with no live binding. Generator type
 * is chosen per datapoint via `sim` in the definition:
 *
 *   { type: 'wave',  min, max, period: '6h', jitter }   smooth daily cycles
 *   { type: 'walk',  min, max, step }                    bounded random walk
 *   { type: 'static', value }                            constant
 *   { type: 'dataset', data: [...] }                     tables / work orders
 *   { type: 'machine', machine, metric }                 handled by the
 *                                machine registry's coherent per-machine sim
 * ========================================================================== */
(function (SFP) {
  'use strict';

  var format = SFP.format;

  /* ── Scalar generators. Each returns fn(t) -> value (stateful allowed). ── */

  function makeGenerator(sim) {
    switch (sim.type) {
      case 'wave': {
        var period = format.duration(sim.period || '24h');
        var mid = (sim.min + sim.max) / 2;
        var amp = (sim.max - sim.min) / 2;
        var phase = (sim.phase !== undefined) ? sim.phase : Math.random() * Math.PI * 2;
        var jitter = sim.jitter || 0;
        return function (t) {
          var v = mid + amp * Math.sin((t / period) * Math.PI * 2 + phase)
            + (Math.random() - 0.5) * 2 * jitter;
          return Math.min(sim.max + jitter, Math.max(sim.min - jitter, v));
        };
      }
      case 'walk': {
        var value = sim.start !== undefined ? sim.start
          : sim.min + Math.random() * (sim.max - sim.min);
        var step = sim.step !== undefined ? sim.step : (sim.max - sim.min) / 20;
        return function () {
          value += (Math.random() - 0.5) * 2 * step;
          value = Math.min(sim.max, Math.max(sim.min, value));
          return value;
        };
      }
      case 'static':
        return function () { return sim.value; };
      default:
        console.error('[SFP.sim] Unknown sim type "' + sim.type + '"');
        return function () { return 0; };
    }
  }

  /* ── Source implementation ─────────────────────────────────────────────── */

  function SimulationSource(hub) {
    this.hub = hub;
    this.active = {};      // id -> { publish, gen } for scalar generators
    this.timer = null;
  }

  SimulationSource.prototype._tickInterval = function () {
    var app = SFP.config.get('app', true);
    return (app && app.data && app.data.simulationIntervalMs) || 2000;
  };

  SimulationSource.prototype.activate = function (id, def, publish) {
    var sim = def.sim;

    if (!sim) {
      /* Nothing configured to simulate — deliver an honest empty value. */
      publish(def.kind === 'dataset' ? [] : null, 'Uncertain');
      return;
    }

    if (sim.type === 'dataset') {
      publish(sim.data || [], 'Good');
      return;
    }

    if (sim.type === 'machine') {
      /* Coherent per-machine simulation lives in the machine registry so a
       * machine's state, load, temperature and efficiency stay consistent. */
      SFP.data.machineSim.activate(id, sim, publish);
      return;
    }

    var gen = makeGenerator(sim);

    /* Backfill history so charts are meaningful immediately after load. */
    var buffer = this.hub.buffer(id);
    if (buffer) { buffer.backfill(gen); }

    this.active[id] = { publish: publish, gen: gen };
    publish(gen(Date.now()), 'Good');
    this._ensureTicker();
  };

  SimulationSource.prototype.deactivate = function (id, def) {
    if (def && def.sim && def.sim.type === 'machine') {
      SFP.data.machineSim.deactivate(id);
      return;
    }
    delete this.active[id];
  };

  SimulationSource.prototype._ensureTicker = function () {
    if (this.timer) { return; }
    var self = this;
    this.timer = setInterval(function () {
      var now = Date.now();
      Object.keys(self.active).forEach(function (id) {
        var a = self.active[id];
        a.publish(a.gen(now), 'Good', now);
      });
    }, this._tickInterval());
  };

  SFP.data.SimulationSource = SimulationSource;
}(window.SFP));
