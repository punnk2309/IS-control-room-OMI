/* ============================================================================
 * Widget: time-series — line/area chart over datapoint history
 * ----------------------------------------------------------------------------
 * options: {
 *   title, subtitle, icon,
 *   series: [
 *     { datapoint: 'production.rate', label: 'Production',
 *       color: 'accent', fill: true, dashed: false }
 *   ],
 *   ranges: ['1h', '8h', '24h'],     // range selector buttons (optional)
 *   defaultRange: '24h',
 *   height: 240,
 *   yLabel: 'kW', beginAtZero: false, stacked: false,
 *   live: true,                      // show pulsing LIVE chip
 *   legend: false,                   // bottom legend for multi-series
 * }
 *
 * History depth comes from each datapoint's `history` config; the widget just
 * visualizes whatever window the data layer retains.
 * ========================================================================== */
(function (SFP) {
  'use strict';

  SFP.widgets.register('time-series', {
    create: function (ctx) {
      var dom = ctx.dom, theme = ctx.theme, format = ctx.format;
      var o = ctx.options;
      var series = o.series || [];

      var card = dom.card({ title: o.title, subtitle: o.subtitle, icon: o.icon });
      ctx.root.appendChild(card.root);

      var rangeMs = format.duration(o.defaultRange || (o.ranges && o.ranges[0]) || '24h');

      /* Range selector buttons */
      if (o.ranges && o.ranges.length && card.actions) {
        var rangeWrap = dom.el('div', { class: 'range-group' });
        o.ranges.forEach(function (r) {
          var btn = dom.el('button', {
            class: 'range-btn' + (format.duration(r) === rangeMs ? ' active' : ''),
            text: r.toUpperCase(),
            onclick: function () {
              rangeMs = format.duration(r);
              Array.prototype.forEach.call(rangeWrap.children, function (b) {
                b.classList.toggle('active', b === btn);
              });
              redraw();
            },
          });
          rangeWrap.appendChild(btn);
        });
        card.actions.appendChild(rangeWrap);
      }

      if (o.live && card.actions) {
        card.actions.appendChild(dom.el('div', { class: 'live-chip' }, [
          dom.el('span', { class: 'live-dot' }), 'Live',
        ]));
      }

      var wrap = dom.el('div', {
        class: 'chart-wrap',
        style: { height: (o.height || 240) + 'px' },
      });
      var canvas = dom.el('canvas');
      wrap.appendChild(canvas);
      card.body.appendChild(wrap);

      var chart = new Chart(canvas, {
        type: 'line',
        data: {
          datasets: series.map(function (s) {
            return {
              label: s.label || s.datapoint,
              data: [],
              borderColor: theme.color(s.color || 'accent'),
              backgroundColor: theme.alpha(s.color || 'accent', s.fill === false ? 0 : 0.12),
              borderWidth: 2,
              borderDash: s.dashed ? [5, 4] : undefined,
              pointRadius: 0,
              tension: 0.35,
              fill: s.fill !== false,
            };
          }),
        },
        options: (function () {
          var base = theme.chartBase({
            yLabel: o.yLabel,
            beginAtZero: o.beginAtZero,
            maxXTicks: 8,
          });
          base.scales.x.type = 'linear';
          base.scales.x.ticks.callback = function (value) {
            return format.timeAxis(value, rangeMs);
          };
          if (o.stacked) { base.scales.y.stacked = true; }
          if (o.legend) {
            base.plugins.legend = {
              display: true, position: 'bottom',
              labels: { color: theme.color('text-3'), boxWidth: 10, font: { size: 10 } },
            };
          }
          base.plugins.tooltip.callbacks = {
            title: function (items) {
              return items.length ? new Date(items[0].parsed.x).toLocaleString() : '';
            },
          };
          return base;
        }()),
      });

      var redrawQueued = false;
      var lastDraw = 0;
      function paint() {
        lastDraw = Date.now();
        series.forEach(function (s, i) {
          chart.data.datasets[i].data = ctx.hub.history(s.datapoint, rangeMs)
            .map(function (p) { return { x: p.t, y: p.v }; });
        });
        chart.update('none');
      }
      function redraw() {
        if (redrawQueued) { return; }
        /* Coalesce bursts of datapoint updates into ~1 paint per second. */
        var wait = Math.max(0, 1000 - (Date.now() - lastDraw));
        if (wait === 0) { paint(); return; }
        redrawQueued = true;
        setTimeout(function () { redrawQueued = false; paint(); }, wait);
      }

      series.forEach(function (s) {
        ctx.subscribe(s.datapoint, function () { redraw(); });
      });
      redraw();

      return {
        resize: function () { chart.resize(); },
        destroy: function () { chart.destroy(); },
      };
    },
  });
}(window.SFP));
