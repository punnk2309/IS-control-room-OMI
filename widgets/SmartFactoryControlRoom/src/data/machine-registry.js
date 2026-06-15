/* ============================================================================
 * SFP.data.machines — machine registry
 * ----------------------------------------------------------------------------
 * Turns config/machines.config.js into live datapoints. For every machine and
 * every metric template it defines a datapoint:
 *
 *     machine.<machineId>.<metric>     e.g.  machine.M-001.state
 *
 * Live bindings come from the metric's OMI address template with {id}
 * substituted, so adding a machine to config is all that's needed to wire a
 * real machine in. The registry also:
 *
 *   - keeps a coherent per-machine simulator (state drives load/temp/eff)
 *   - maintains machine-state counts (overall and per zone) and publishes
 *     them as computed datapoints:  machines.count.<state>, machines.count.total
 *   - emits 'machine:stateChanged' and 'machines:counts' bus events
 *     (the alarm engine and factory map build on these)
 * ========================================================================== */
(function (SFP) {
  'use strict';

  /* ── Machine identity + physical zone derivation ────────────────────────
   * Machines are declared once, in the asset model (config/asset-model.config
   * .js): every node carrying a `machineRef` IS a fleet machine, and supplies
   * its id (machineRef), display name, and machineType. The physical `zone`
   * is a separate concern — sourced from the twin layout (config/twin/
   * twin.layout.config.js), where each machine is placed as `{ ref: 'M-xxx' }`
   * inside exactly one top-level zone. Asset structure and physical location
   * are intentionally decoupled (a machine's asset parent need not match its
   * twin zone), so the two are read from their own configs.
   *
   * Both walkers read raw config (not SFP.data.assets), so they are immune to
   * init ordering — the registry initialises before the asset registry. */

  /** Walk the asset-model tree; emit one {id,name,type,zone} per machineRef. */
  function buildMachinesFromAssets() {
    var out = [];
    var cfg;
    try { cfg = SFP.config.get('asset-model'); }
    catch (e) { return out; }
    (function walk(node) {
      if (!node) { return; }
      if (node.machineRef) {
        out.push({
          id: node.machineRef,
          name: node.name || node.machineRef,
          type: node.machineType || '',
          zone: null,
        });
      }
      if (Array.isArray(node.children)) { node.children.forEach(walk); }
    }(cfg));
    return out;
  }

  /** Recursively collect every `{ ref }` machine under a twin layout node. */
  function collectTwinRefs(node, emit) {
    if (!node) { return; }
    if (node.ref) { emit(node.ref); }
    ['floors', 'subzones', 'machines'].forEach(function (key) {
      if (Array.isArray(node[key])) {
        node[key].forEach(function (child) { collectTwinRefs(child, emit); });
      }
    });
  }

  /** Build machineId → physical top-level zone id from the twin layout. */
  function buildZoneMapFromTwin() {
    var map = {};
    var layout;
    try { layout = SFP.config.get('twin.layout'); }
    catch (e) { return map; }
    (layout.zones || []).forEach(function (zone) {
      collectTwinRefs(zone, function (ref) { map[ref] = zone.id; });
    });
    return map;
  }

  /* ── Coherent per-machine simulation ───────────────────────────────────── */

  var TRANSITIONS = {
    /* probability per ~2s tick; tuned so the fleet stays mostly stable    */
    running:     [{ to: 'idle', p: 0.004 }, { to: 'error', p: 0.0012 }],
    idle:        [{ to: 'running', p: 0.020 }, { to: 'maintenance', p: 0.001 }],
    maintenance: [{ to: 'running', p: 0.010 }],
    error:       [{ to: 'maintenance', p: 0.015 }],
  };

  function MachineSimulator(machine, initialState) {
    this.machine = machine;
    this.state = initialState || 'running';
    this.load = this.state === 'running' ? 70 + Math.random() * 25 : 0;
    this.temperature = this.state === 'running' ? 60 + Math.random() * 20 : 40;
    this.efficiency = this.state === 'running' ? 86 + Math.random() * 12 : 0;
    this.runtime = Math.random() * 13 + 0.5;
  }

  MachineSimulator.prototype.tick = function (tickMs) {
    var changed = null;
    var roll = Math.random();
    var acc = 0;
    var options = TRANSITIONS[this.state] || [];
    for (var i = 0; i < options.length; i++) {
      acc += options[i].p;
      if (roll < acc) {
        changed = { from: this.state, to: options[i].to };
        this.state = options[i].to;
        if (changed.from === 'maintenance') { this.runtime = 0; }
        break;
      }
    }

    var drift = function (current, target, rate, jitter) {
      return current + (target - current) * rate + (Math.random() - 0.5) * jitter;
    };

    switch (this.state) {
      case 'running':
        this.load = Math.min(98, Math.max(55, drift(this.load, 82, 0.05, 6)));
        this.temperature = Math.min(88, Math.max(50, drift(this.temperature, 55 + this.load * 0.3, 0.08, 3)));
        this.efficiency = Math.min(99, Math.max(80, drift(this.efficiency, 93, 0.05, 3)));
        this.runtime += tickMs / 3600000;
        break;
      case 'idle':
        this.load = Math.max(0, drift(this.load, 10, 0.2, 3));
        this.temperature = Math.max(30, drift(this.temperature, 40, 0.1, 2));
        this.efficiency = Math.max(0, drift(this.efficiency, 45, 0.2, 4));
        break;
      case 'maintenance':
        this.load = 0;
        this.temperature = Math.max(25, drift(this.temperature, 30, 0.15, 1));
        this.efficiency = 0;
        break;
      case 'error':
        this.load = 0;
        this.temperature = Math.min(105, drift(this.temperature, 96, 0.2, 3));
        this.efficiency = 0;
        break;
    }
    return changed;
  };

  MachineSimulator.prototype.metric = function (name) {
    switch (name) {
      case 'state': return this.state;
      case 'load': return Math.round(this.load);
      case 'temperature': return Math.round(this.temperature);
      case 'efficiency': return Math.round(this.efficiency);
      case 'runtime': return Math.round(this.runtime * 10) / 10;
      default: return null;
    }
  };

  /* ── machineSim: bridge used by the simulation source ──────────────────── */

  var machineSim = {
    simulators: {},     // machineId -> MachineSimulator
    publishers: {},     // datapoint id -> { sim, metric, publish }
    timer: null,
    tickMs: 2000,

    simulator: function (machineId) { return this.simulators[machineId] || null; },

    activate: function (dpId, simCfg, publish) {
      var sim = this.simulators[simCfg.machine];
      if (!sim) {
        publish(null, 'Bad');
        return;
      }
      this.publishers[dpId] = { sim: sim, metric: simCfg.metric, publish: publish };
      publish(sim.metric(simCfg.metric), 'Good');
    },

    deactivate: function (dpId) {
      delete this.publishers[dpId];
    },

    start: function (registry) {
      if (this.timer) { return; }
      var self = this;
      this.timer = setInterval(function () {
        Object.keys(self.simulators).forEach(function (machineId) {
          var sim = self.simulators[machineId];
          var changed = sim.tick(self.tickMs);
          if (changed) {
            registry._onSimStateChange(machineId, changed.from, changed.to);
          }
        });
        var now = Date.now();
        Object.keys(self.publishers).forEach(function (dpId) {
          var p = self.publishers[dpId];
          p.publish(p.sim.metric(p.metric), 'Good', now);
        });
      }, this.tickMs);
    },
  };

  /* ── Registry ──────────────────────────────────────────────────────────── */

  var registry = {
    _machines: [],
    _byId: {},
    _states: {},        // machineId -> current normalized state id
    _unsubs: [],

    init: function (hub) {
      var cfg = SFP.config.get('machines');  // machine-CLASS config: metrics + simulation
      var self = this;
      this.hub = hub;

      /* Identity from the asset model; physical zone from the twin layout.
       * Returned object shape stays {id, name, zone, type} so the ~14
       * consumers of SFP.data.machines are untouched. */
      this._machines = buildMachinesFromAssets();
      var zoneByRef = buildZoneMapFromTwin();
      this._machines.forEach(function (m) {
        m.zone = zoneByRef[m.id] || null;
        self._byId[m.id] = m;
      });

      /* Define a datapoint per machine x metric from the config templates. */
      this._machines.forEach(function (m) {
        Object.keys(cfg.metrics).forEach(function (metric) {
          var tpl = cfg.metrics[metric];
          var def = {
            label: m.name + ' ' + (tpl.label || metric),
            unit: tpl.unit,
            decimals: tpl.decimals,
            sim: { type: 'machine', machine: m.id, metric: metric },
          };
          if (tpl.address) {
            def.source = {
              type: tpl.sourceType || 'omi',
              address: SFP.format.template(tpl.address, { id: m.id }),
            };
          }
          hub.define(self.dp(m.id, metric), def);
        });
      });

      /* Computed fleet counts (drive KPI cards, donuts and the status bar). */
      var stateIds = this._stateIds();
      stateIds.concat(['total']).forEach(function (state) {
        hub.define('machines.count.' + state, {
          label: 'Machines ' + state, unit: 'machines', decimals: 0, computed: true,
        });
      });

      /* Seed simulators with the configured initial fleet distribution,
       * interleaved so every zone gets a realistic mix. */
      var pool = [];
      stateIds.forEach(function (state) {
        var n = (cfg.simulation && cfg.simulation.initialStates &&
                 cfg.simulation.initialStates[state]) || 0;
        for (var i = 0; i < n; i++) { pool.push(state); }
      });
      this._machines.forEach(function (m, i) {
        var state = pool.length ? pool[(i * 7) % pool.length] : 'running';
        pool.splice((i * 7) % pool.length, 1);
        machineSim.simulators[m.id] = new MachineSimulator(m, state);
      });

      /* Track every machine's state permanently so counts stay correct even
       * when no machine widget is on screen. (At very large fleet sizes,
       * prefer aggregate count tags — see docs/deployment.md, Scaling.) */
      this._machines.forEach(function (m) {
        var unsub = hub.subscribe(self.dp(m.id, 'state'), function (sample) {
          self._onStateSample(m.id, sample);
        });
        self._unsubs.push(unsub);
      });

      machineSim.start(this);
      this._publishCounts();
    },

    /** Datapoint id for a machine metric. */
    dp: function (machineId, metric) {
      return 'machine.' + machineId + '.' + metric;
    },

    list: function () { return this._machines.slice(); },
    get: function (id) { return this._byId[id] || null; },
    byZone: function (zoneId) {
      return this._machines.filter(function (m) { return m.zone === zoneId; });
    },
    stateOf: function (machineId) { return this._states[machineId] || null; },

    counts: function (zoneId) {
      var counts = { total: 0 };
      this._stateIds().forEach(function (s) { counts[s] = 0; });
      var self = this;
      this._machines.forEach(function (m) {
        if (zoneId && m.zone !== zoneId) { return; }
        counts.total += 1;
        var state = self._states[m.id];
        if (state !== null && state !== undefined && state in counts) { counts[state] += 1; }
      });
      return counts;
    },

    _stateIds: function () {
      var states = SFP.config.get('states');
      return states.machine.states.map(function (s) { return s.id; });
    },

    _onStateSample: function (machineId, sample) {
      /* No data (live mode, unbound/disconnected) -> state unknown, not
       * "idle": unknown machines drop out of the state counts so nothing
       * synthetic-looking is shown. */
      var noData = sample.value === null || sample.value === undefined ||
        sample.quality === 'Bad' || sample.quality === 'Disconnected';
      var normalized = noData ? null : SFP.state.engine.normalize('machine', sample.value);
      var prev = this._states[machineId];
      if (normalized === prev) { return; }
      this._states[machineId] = normalized;
      SFP.bus.emit('machine:stateChanged', {
        machine: this._byId[machineId], from: prev || null, state: normalized,
      });
      this._publishCounts();
    },

    _onSimStateChange: function (machineId, from, to) {
      /* The simulator changed state between metric publishes; push the state
       * datapoint immediately so alarms and counts react without tick lag. */
      var dpId = this.dp(machineId, 'state');
      var p = machineSim.publishers[dpId];
      if (p) { p.publish(to, 'Good', Date.now()); }
    },

    _publishCounts: function () {
      var counts = this.counts();
      Object.keys(counts).forEach(function (key) {
        SFP.data.computedSource.set('machines.count.' + key, counts[key]);
      });
      SFP.bus.emit('machines:counts', { counts: counts });
    },
  };

  SFP.data.machineSim = machineSim;
  SFP.data.machines = registry;
}(window.SFP));
