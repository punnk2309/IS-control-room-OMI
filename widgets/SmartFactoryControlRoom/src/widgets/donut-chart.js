/* ============================================================================
 * Widget: donut-chart — categorical breakdown with legend
 * ----------------------------------------------------------------------------
 * Two binding styles:
 *
 * 1) Explicit segments:
 *    options.segments: [{ datapoint, label, color }, …]
 *
 * 2) A state group (segments, labels and colors come from states config):
 *    options.stateGroup: 'machine'
 *    options.datapointPattern: 'machines.count.{state}'
 *    options.totalDatapoint: 'machines.count.total'   // center figure
 *
 * options: { title, subtitle, height, centerLabel }
 * ========================================================================== */
(function (SFP) {
  'use strict';

  SFP.widgets.register('donut-chart', {
    create: function (ctx) {
      var dom = ctx.dom, theme = ctx.theme, format = ctx.format;
      var o = ctx.options;

      /* Resolve segment list from either binding style. */
      var segments;
      if (o.stateGroup) {
        segments = ctx.states.states(o.stateGroup).map(function (s) {
          return {
            datapoint: format.template(o.datapointPattern, { state: s.id }),
            label: s.label,
            color: s.color,
          };
        });
      } else {
        segments = o.segments || [];
      }

      var card = dom.card({ title: o.title, subtitle: o.subtitle, icon: o.icon });
      ctx.root.appendChild(card.root);

      var wrap = dom.el('div', {
        class: 'chart-wrap donut-wrap',
        style: { height: (o.height || 170) + 'px' },
      });
      var canvas = dom.el('canvas');
      var centerValue = dom.el('div', { class: 'donut-center-value', text: '—' });
      var centerLabel = dom.el('div', { class: 'donut-center-label', text: o.centerLabel || '' });
      wrap.appendChild(canvas);
      wrap.appendChild(dom.el('div', { class: 'donut-center' }, [centerValue, centerLabel]));
      card.body.appendChild(wrap);

      var legend = dom.el('div', { class: 'donut-legend' });
      var legendValueEls = segments.map(function (s) {
        var valueEl = dom.el('span', { class: 'donut-legend-value', text: '–' });
        legend.appendChild(dom.el('div', { class: 'legend-item' }, [
          dom.el('span', { class: 'legend-swatch', style: { background: theme.color(s.color) } }),
          dom.el('span', { class: 'legend-label', text: s.label }),
          valueEl,
        ]));
        return valueEl;
      });
      card.body.appendChild(legend);

      var chart = new Chart(canvas, {
        type: 'doughnut',
        data: {
          labels: segments.map(function (s) { return s.label; }),
          datasets: [{
            data: segments.map(function () { return 0; }),
            backgroundColor: segments.map(function (s) { return theme.color(s.color); }),
            borderWidth: 0,
            hoverOffset: 4,
          }],
        },
        options: Object.assign(theme.chartBase({ noScales: true }), { cutout: '70%' }),
      });

      var values = segments.map(function () { return 0; });

      function refresh() {
        chart.data.datasets[0].data = values.slice();
        chart.update('none');
        values.forEach(function (v, i) { legendValueEls[i].textContent = format.number(v, 0); });
        if (!o.totalDatapoint) {
          var total = values.reduce(function (a, b) { return a + b; }, 0);
          centerValue.textContent = format.number(total, 0);
        }
      }

      segments.forEach(function (s, i) {
        ctx.subscribe(s.datapoint, function (sample) {
          values[i] = (typeof sample.value === 'number') ? sample.value : 0;
          refresh();
        });
      });

      if (o.totalDatapoint) {
        ctx.subscribe(o.totalDatapoint, function (sample) {
          centerValue.textContent = format.number(sample.value, 0);
        });
      }

      return {
        resize: function () { chart.resize(); },
        destroy: function () { chart.destroy(); },
      };
    },
  });
}(window.SFP));
