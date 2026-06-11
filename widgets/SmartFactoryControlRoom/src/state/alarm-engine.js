/* ============================================================================
 * SFP.state.alarms — alarm engine
 * ----------------------------------------------------------------------------
 * Evaluates the declarative rules in config/alarm-rules.config.js and keeps
 * the application-wide alarm list. Three rule types:
 *
 *   datapoint     { id, datapoint, when, severity, category, message }
 *                 Raised while `when` holds for the datapoint value;
 *                 auto-clears when it no longer holds.
 *
 *   machineState  { id, type:'machineState', state, severity, message }
 *                 Raised when any machine enters `state` (one alarm per
 *                 machine); clears when it leaves the state.
 *
 *   machineMetric { id, type:'machineMetric', metric, when, severity, message }
 *                 Threshold over a per-machine metric (e.g. temperature).
 *
 * Severities (matching the OMI host protocol): Low | Medium | High | Critical.
 * Raised alarms are forwarded to the OMI alarm bar when running in a host.
 *
 * Bus events: 'alarm:raised', 'alarm:cleared', 'alarm:changed', 'alarm:summary'
 * ========================================================================== */
(function (SFP) {
  'use strict';

  var SEVERITY_RANK = { Low: 1, Medium: 2, High: 3, Critical: 4 };
  var RECENT_LIMIT = 50;

  var alarms = {
    _active: {},     // key -> alarm
    _recent: [],     // resolved alarms, newest first
    _unsubs: [],

    init: function (hub) {
      var rules = SFP.config.get('alarmRules', true) || [];
      var self = this;
      this.hub = hub;

      rules.forEach(function (rule) {
        if (rule.type === 'machineState') { self._bindMachineStateRule(rule); }
        else if (rule.type === 'machineMetric') { self._bindMachineMetricRule(rule); }
        else { self._bindDatapointRule(rule); }
      });
      this._emitSummary();
    },

    /* ── Queries ─────────────────────────────────────────────────────────── */

    active: function (category) {
      var list = Object.keys(this._active).map(function (k) { return this._active[k]; }, this);
      if (category) {
        list = list.filter(function (a) { return a.category === category; });
      }
      return list.sort(function (a, b) {
        return (SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]) ||
               (b.raisedAt - a.raisedAt);
      });
    },

    recent: function (category) {
      return this._recent.filter(function (a) {
        return !category || a.category === category;
      });
    },

    summary: function () {
      var counts = { Critical: 0, High: 0, Medium: 0, Low: 0 };
      var worst = null;
      Object.keys(this._active).forEach(function (key) {
        var a = this._active[key];
        counts[a.severity] += 1;
        if (!worst || SEVERITY_RANK[a.severity] > SEVERITY_RANK[worst]) { worst = a.severity; }
      }, this);
      return { active: Object.keys(this._active).length, worstSeverity: worst, counts: counts };
    },

    /* ── Operator actions ────────────────────────────────────────────────── */

    acknowledge: function (key) {
      var alarm = this._active[key];
      if (alarm) {
        alarm.acked = true;
        SFP.bus.emit('alarm:changed', { alarm: alarm });
      }
    },

    /** Manual resolve from the UI. Condition-based alarms may re-raise if the
     *  underlying condition is still true on the next value — intentional. */
    resolve: function (key) {
      this._clear(key);
    },

    /* ── Rule wiring ─────────────────────────────────────────────────────── */

    _bindDatapointRule: function (rule) {
      var self = this;
      var def = this.hub.def(rule.datapoint) || {};
      this._unsubs.push(this.hub.subscribe(rule.datapoint, function (sample) {
        if (typeof sample.value !== 'number') { return; }
        var key = rule.id;
        var firing = SFP.expr.evaluate(rule.when, sample.value);
        if (firing && !self._active[key]) {
          self._raise(key, rule, {
            value: SFP.format.number(sample.value, def.decimals),
            unit: def.unit || '', label: def.label || rule.datapoint,
          }, def.label || rule.datapoint);
        } else if (!firing && self._active[key]) {
          self._clear(key);
        }
      }));
    },

    _bindMachineStateRule: function (rule) {
      var self = this;
      SFP.bus.on('machine:stateChanged', function (e) {
        if (!e.machine) { return; }
        var key = rule.id + ':' + e.machine.id;
        if (e.state === rule.state && !self._active[key]) {
          self._raise(key, rule, { id: e.machine.id, name: e.machine.name, zone: e.machine.zone },
            e.machine.name);
        } else if (e.state !== rule.state && self._active[key]) {
          self._clear(key);
        }
      });
    },

    _bindMachineMetricRule: function (rule) {
      var self = this;
      var machines = SFP.data.machines.list();
      machines.forEach(function (m) {
        var dpId = SFP.data.machines.dp(m.id, rule.metric);
        self._unsubs.push(self.hub.subscribe(dpId, function (sample) {
          if (typeof sample.value !== 'number') { return; }
          var key = rule.id + ':' + m.id;
          var firing = SFP.expr.evaluate(rule.when, sample.value);
          if (firing && !self._active[key]) {
            self._raise(key, rule, {
              id: m.id, name: m.name, zone: m.zone,
              value: Math.round(sample.value),
            }, m.name);
          } else if (!firing && self._active[key]) {
            self._clear(key);
          }
        }));
      });
    },

    /* ── Lifecycle ───────────────────────────────────────────────────────── */

    _raise: function (key, rule, ctx, sourceLabel) {
      var alarm = {
        key: key,
        ruleId: rule.id,
        severity: rule.severity || 'Medium',
        category: rule.category || 'general',
        message: SFP.format.template(rule.message, ctx),
        source: sourceLabel,
        raisedAt: Date.now(),
        state: 'active',
        acked: false,
      };
      this._active[key] = alarm;
      SFP.bus.emit('alarm:raised', { alarm: alarm });
      this._emitSummary();

      if (SFP.runtime.omiHosted) {
        window.parent.postMessage({
          type: 'omi:alarm',
          severity: alarm.severity,
          message: alarm.message,
        }, '*');
      }
    },

    _clear: function (key) {
      var alarm = this._active[key];
      if (!alarm) { return; }
      delete this._active[key];
      alarm.state = 'resolved';
      alarm.resolvedAt = Date.now();
      this._recent.unshift(alarm);
      if (this._recent.length > RECENT_LIMIT) { this._recent.length = RECENT_LIMIT; }
      SFP.bus.emit('alarm:cleared', { alarm: alarm });
      this._emitSummary();
    },

    _emitSummary: function () {
      SFP.bus.emit('alarm:summary', this.summary());
    },
  };

  SFP.state.alarms = alarms;
}(window.SFP));
