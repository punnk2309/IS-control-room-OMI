/* ============================================================================
 * SFP.state.engine — declarative state logic
 * ----------------------------------------------------------------------------
 * State *groups* are defined in config/states.config.js. A group lists the
 * states that exist (with display label and theme color token) plus how raw
 * values map onto them:
 *
 *   valueMap — for discrete inputs (PLC integer codes, state strings)
 *   rules    — ordered [{ when: <condition>, state: 'id' }] evaluated with
 *              SFP.expr for continuous inputs (e.g. energy bands)
 *
 * Widgets ask the engine for states; they never hard-code state names,
 * colors, or thresholds.
 * ========================================================================== */
(function (SFP) {
  'use strict';

  var engine = {
    _group: function (groupId) {
      var groups = SFP.config.get('states');
      var group = groups[groupId];
      if (!group) { throw new Error('[SFP.state] Unknown state group "' + groupId + '"'); }
      return group;
    },

    /** All states of a group (for legends, filters, donut segments). */
    states: function (groupId) {
      return this._group(groupId).states;
    },

    /** Definition of one state: { id, label, color, … }. */
    stateDef: function (groupId, stateId) {
      var found = this._group(groupId).states.filter(function (s) {
        return s.id === stateId;
      })[0];
      return found || { id: stateId, label: stateId, color: 'text-2' };
    },

    /** Normalize a raw input (string, PLC code…) to a state id. */
    normalize: function (groupId, raw) {
      var group = this._group(groupId);
      if (raw === null || raw === undefined) { return group.default || group.states[0].id; }
      var isKnown = group.states.some(function (s) { return s.id === raw; });
      if (isKnown) { return raw; }
      if (group.valueMap && raw in group.valueMap) { return group.valueMap[raw]; }
      return group.default || group.states[0].id;
    },

    /** Resolve a state from the group's rules for a continuous input. */
    evaluateRules: function (groupId, input, ctx) {
      var group = this._group(groupId);
      var match = SFP.expr.firstMatch(group.rules, input, ctx);
      return match ? match.state : (group.default || group.states[0].id);
    },
  };

  SFP.state.engine = engine;
}(window.SFP));
