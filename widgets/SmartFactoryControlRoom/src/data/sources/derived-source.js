/* ============================================================================
 * Derived source — computed datapoints (work in every data mode)
 * ----------------------------------------------------------------------------
 * Lets config express calculated values without code. Definition examples:
 *
 *   derived: { op: 'sum',   inputs: ['a', 'b', 'c'] }
 *   derived: { op: 'avg',   inputs: [...] }
 *   derived: { op: 'diff',  inputs: ['total', 'part'] }      // a - b - c…
 *   derived: { op: 'ratio', numerator: 'a', denominator: 'b',
 *              scale: 100, clamp: [0, 100] }
 *   derived: { op: 'scale', input: 'a', factor: 1.47, offset: 0 }
 *
 * The derived datapoint subscribes to its inputs through the hub, so inputs
 * resolve through whatever source is active for them — derived values keep
 * working identically in live and simulation modes. Quality propagates as the
 * worst input quality.
 * ========================================================================== */
(function (SFP) {
  'use strict';

  var QUALITY_RANK = { Good: 0, Simulated: 1, Uncertain: 2, Bad: 3, Disconnected: 4 };

  function worstQuality(samples) {
    var worst = 'Good';
    samples.forEach(function (s) {
      if (!s) { worst = 'Bad'; return; }
      if ((QUALITY_RANK[s.quality] || 0) > (QUALITY_RANK[worst] || 0)) { worst = s.quality; }
    });
    return worst;
  }

  function inputIds(derived) {
    if (derived.inputs) { return derived.inputs.slice(); }
    if (derived.op === 'ratio') { return [derived.numerator, derived.denominator]; }
    if (derived.op === 'scale') { return [derived.input]; }
    return [];
  }

  function compute(derived, values) {
    var nums = values.map(function (s) {
      return (s && typeof s.value === 'number' && isFinite(s.value)) ? s.value : null;
    });
    if (nums.some(function (n) { return n === null; })) { return null; }

    switch (derived.op) {
      case 'sum': return nums.reduce(function (a, b) { return a + b; }, 0);
      case 'avg': return nums.reduce(function (a, b) { return a + b; }, 0) / nums.length;
      case 'min': return Math.min.apply(null, nums);
      case 'max': return Math.max.apply(null, nums);
      case 'diff': return nums.slice(1).reduce(function (a, b) { return a - b; }, nums[0]);
      case 'ratio': {
        if (nums[1] === 0) { return null; }
        var v = nums[0] / nums[1] * (derived.scale !== undefined ? derived.scale : 1);
        if (derived.clamp) { v = Math.min(derived.clamp[1], Math.max(derived.clamp[0], v)); }
        return v;
      }
      case 'scale':
        return nums[0] * (derived.factor !== undefined ? derived.factor : 1)
          + (derived.offset || 0);
      default:
        console.error('[SFP.derived] Unknown op "' + derived.op + '"');
        return null;
    }
  }

  function DerivedSource(hub) {
    this.hub = hub;
    this.active = {};   // id -> [unsubscribe fns]
  }

  DerivedSource.prototype.activate = function (id, def, publish) {
    var hub = this.hub;
    var derived = def.derived;
    var ids = inputIds(derived);
    var latest = ids.map(function () { return null; });

    var recompute = function () {
      var value = compute(derived, latest);
      publish(value, value === null ? 'Uncertain' : worstQuality(latest));
    };

    this.active[id] = ids.map(function (inputId, index) {
      return hub.subscribe(inputId, function (sample) {
        latest[index] = sample;
        recompute();
      });
    });
  };

  DerivedSource.prototype.deactivate = function (id) {
    (this.active[id] || []).forEach(function (unsub) { unsub(); });
    delete this.active[id];
  };

  SFP.data.DerivedSource = DerivedSource;
}(window.SFP));
