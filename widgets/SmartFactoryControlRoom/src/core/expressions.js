/* ============================================================================
 * SFP.expr — declarative condition evaluator
 * ----------------------------------------------------------------------------
 * Conditions appear in state logic and alarm rules as plain data — never as
 * executable code (no eval). Grammar:
 *
 *   { op: '>',  value: 90 }                      — compare the input value
 *   { op: 'between', value: [150, 250] }
 *   { op: 'in', value: ['error', 'maint'] }
 *   { all: [cond, cond] } / { any: [cond, cond] }
 *   { field: 'temperature', op: '>', value: 90 } — compare ctx.temperature
 *
 * evaluate(cond, input, ctx):
 *   input — the primary value being tested (used when no `field` given)
 *   ctx   — optional object for `field` lookups
 * ========================================================================== */
(function (SFP) {
  'use strict';

  var OPS = {
    '>':  function (a, b) { return a > b; },
    '>=': function (a, b) { return a >= b; },
    '<':  function (a, b) { return a < b; },
    '<=': function (a, b) { return a <= b; },
    '==': function (a, b) { return a === b; },
    '!=': function (a, b) { return a !== b; },
    'between': function (a, b) { return a >= b[0] && a <= b[1]; },
    'in': function (a, b) { return Array.isArray(b) && b.indexOf(a) >= 0; },
  };

  SFP.expr = {
    evaluate: function (cond, input, ctx) {
      if (!cond) { return false; }
      if (cond.all) {
        return cond.all.every(function (c) { return SFP.expr.evaluate(c, input, ctx); });
      }
      if (cond.any) {
        return cond.any.some(function (c) { return SFP.expr.evaluate(c, input, ctx); });
      }
      var op = OPS[cond.op];
      if (!op) {
        console.error('[SFP.expr] Unknown operator: "' + cond.op + '"');
        return false;
      }
      var subject = (cond.field !== undefined) ? (ctx ? ctx[cond.field] : undefined) : input;
      if (subject === null || subject === undefined) { return false; }
      return op(subject, cond.value);
    },

    /** Evaluate an ordered rule list [{ when, state }] and return the first
     *  matching rule's `state` (or any other payload key), else fallback. */
    firstMatch: function (rules, input, ctx, fallback) {
      for (var i = 0; i < (rules || []).length; i++) {
        if (SFP.expr.evaluate(rules[i].when, input, ctx)) { return rules[i]; }
      }
      return fallback !== undefined ? fallback : null;
    },
  };
}(window.SFP));
