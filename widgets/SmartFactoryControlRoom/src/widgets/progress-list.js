/* ============================================================================
 * Widget: progress-list — labelled progress bars
 * ----------------------------------------------------------------------------
 * Two binding styles:
 *
 * 1) items — each bar bound to a (typically 0–100) datapoint:
 *    options.items: [
 *      { label: 'Solar Share', datapoint: 'energy.solarShare', color: 'chart-solar' }
 *    ]
 *
 * 2) dataset — bars from an array datapoint (e.g. predictive maintenance):
 *    bind.dataset: 'maintenance.predictions'
 *    options.dataset: {
 *      label: '{asset} — {component}',     // templates over row fields
 *      sublabel: 'Est. {daysToFailure} days to failure',
 *      value: 'riskPct', tail: '{action}',
 *      colorRules: 'risk'                  // state group evaluated on value
 *    }
 *
 * options: { title, subtitle, icon, max (default 100), showValue }
 * ========================================================================== */
(function (SFP) {
  'use strict';

  SFP.widgets.register('progress-list', {
    create: function (ctx) {
      var dom = ctx.dom, format = ctx.format, theme = ctx.theme;
      var o = ctx.options;
      var max = o.max || 100;

      var card = dom.card({ title: o.title, subtitle: o.subtitle, icon: o.icon });
      ctx.root.appendChild(card.root);

      var list = dom.el('div', { class: 'progress-list' });
      card.body.appendChild(list);

      function row(label, sublabel, color, tail) {
        var valueEl = dom.el('span', { class: 'progress-val' });
        var fill = dom.el('div', { class: 'progress-fill' });
        fill.style.background = theme.color(color || 'accent');
        var rowEl = dom.el('div', { class: 'progress-item' }, [
          dom.el('div', { class: 'progress-row' }, [
            dom.el('div', {}, [
              dom.el('span', { class: 'progress-label', text: label }),
              sublabel ? dom.el('div', { class: 'progress-sublabel', text: sublabel }) : null,
            ]),
            valueEl,
          ]),
          dom.el('div', { class: 'progress-bar-bg' }, [fill]),
          tail ? dom.el('div', { class: 'progress-tail', text: tail }) : null,
        ]);
        list.appendChild(rowEl);
        return {
          set: function (value, colorOverride) {
            var pct = Math.min(100, Math.max(0, value / max * 100));
            fill.style.width = pct + '%';
            if (colorOverride) {
              fill.style.background = theme.color(colorOverride);
              valueEl.style.color = theme.color(colorOverride);
            }
            valueEl.textContent = format.number(value, 0) + (o.unit || '%');
          },
        };
      }

      /* Style 1: configured items bound to datapoints */
      (o.items || []).forEach(function (item) {
        var r = row(item.label, item.sublabel, item.color);
        ctx.subscribe(item.datapoint, function (sample) {
          if (typeof sample.value === 'number') { r.set(sample.value); }
        });
      });

      /* Style 2: dataset rows */
      if (ctx.bind.dataset && o.dataset) {
        var ds = o.dataset;
        ctx.subscribe(ctx.bind.dataset, function (sample) {
          var rows = Array.isArray(sample.value) ? sample.value : [];
          dom.clear(list);
          rows.forEach(function (data) {
            var color = null;
            var value = data[ds.value];
            if (ds.colorRules && typeof value === 'number') {
              var state = ctx.states.evaluateRules(ds.colorRules, value);
              color = ctx.states.stateDef(ds.colorRules, state).color;
            }
            var r = row(
              format.template(ds.label, data),
              ds.sublabel ? format.template(ds.sublabel, data) : null,
              color,
              ds.tail ? format.template(ds.tail, data) : null
            );
            r.set(typeof value === 'number' ? value : 0, color);
          });
        });
      }

      return {};
    },
  });
}(window.SFP));
