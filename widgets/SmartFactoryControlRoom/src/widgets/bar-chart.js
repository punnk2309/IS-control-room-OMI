/* ============================================================================
 * Widget: bar-chart — categorical bars, vertical or horizontal
 * ----------------------------------------------------------------------------
 * Two binding styles:
 *
 * 1) items — one bar per configured item, each bound to a datapoint:
 *    options.items: [
 *      { label: 'Assembly A', datapoint: 'zone.assembly-a.energy', target: 250 }
 *    ]
 *    Optional per-item `target` renders a second muted "Target" series.
 *    Optional options.colorByState: 'zone-energy' colors each bar from the
 *    state group's rules evaluated against the bar value.
 *
 * 2) dataset — bars come from a dataset datapoint (array of row objects):
 *    bind.dataset: 'analytics.comparison'
 *    options.labelField: 'metric'
 *    options.series: [{ field: 'today', label: 'Today', color: 'chart-2' }, …]
 *
 * options: { title, subtitle, height, horizontal, yLabel, unit, legend }
 * ========================================================================== */
(function (SFP) {
  'use strict';

  SFP.widgets.register('bar-chart', {
    create: function (ctx) {
      var dom = ctx.dom, theme = ctx.theme;
      var o = ctx.options;

      var card = dom.card({ title: o.title, subtitle: o.subtitle, icon: o.icon });
      ctx.root.appendChild(card.root);

      var wrap = dom.el('div', {
        class: 'chart-wrap',
        style: { height: (o.height || 220) + 'px' },
      });
      var canvas = dom.el('canvas');
      wrap.appendChild(canvas);
      card.body.appendChild(wrap);

      var base = theme.chartBase({ yLabel: o.yLabel, beginAtZero: true, maxXTicks: 20 });
      if (o.horizontal) { base.indexAxis = 'y'; }
      if (o.legend) {
        base.plugins.legend = {
          display: true, position: 'bottom',
          labels: { color: theme.color('text-3'), boxWidth: 10, font: { size: 10 } },
        };
      }

      var chart = new Chart(canvas, { type: 'bar', data: { labels: [], datasets: [] }, options: base });

      /* ── Style 1: per-item datapoint bindings ──────────────────────────── */
      if (o.items) {
        var items = o.items;
        var values = items.map(function () { return null; });

        chart.data.labels = items.map(function (it) { return it.label; });
        chart.data.datasets = [{
          label: o.unit || 'Actual',
          data: values.slice(),
          backgroundColor: theme.color(o.color || 'accent'),
          borderRadius: 4,
          maxBarThickness: 46,
        }];
        if (items.some(function (it) { return it.target !== undefined; })) {
          chart.data.datasets.push({
            label: 'Target',
            data: items.map(function (it) { return it.target !== undefined ? it.target : null; }),
            backgroundColor: theme.alpha('text-3', 0.25),
            borderRadius: 4,
            maxBarThickness: 46,
          });
        }

        var refresh = function () {
          chart.data.datasets[0].data = values.slice();
          if (o.colorByState) {
            chart.data.datasets[0].backgroundColor = values.map(function (v) {
              if (v === null) { return theme.alpha('text-3', 0.2); }
              var state = ctx.states.evaluateRules(o.colorByState, v);
              return theme.color(ctx.states.stateDef(o.colorByState, state).color);
            });
          }
          chart.update('none');
        };

        items.forEach(function (it, i) {
          ctx.subscribe(it.datapoint, function (sample) {
            values[i] = (typeof sample.value === 'number') ? sample.value : null;
            refresh();
          });
        });
      }

      /* ── Style 2: dataset binding ──────────────────────────────────────── */
      if (ctx.bind.dataset) {
        ctx.subscribe(ctx.bind.dataset, function (sample) {
          var rows = Array.isArray(sample.value) ? sample.value : [];
          chart.data.labels = rows.map(function (r) { return r[o.labelField]; });
          chart.data.datasets = (o.series || []).map(function (s) {
            return {
              label: s.label || s.field,
              data: rows.map(function (r) { return r[s.field]; }),
              backgroundColor: s.colorField
                ? rows.map(function (r) { return theme.color(r[s.colorField]); })
                : theme.color(s.color || 'accent'),
              borderRadius: 4,
              maxBarThickness: 46,
            };
          });
          chart.update('none');
        });
      }

      return {
        resize: function () { chart.resize(); },
        destroy: function () { chart.destroy(); },
      };
    },
  });
}(window.SFP));
