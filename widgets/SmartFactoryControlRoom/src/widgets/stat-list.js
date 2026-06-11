/* ============================================================================
 * Widget: stat-list — compact rows of labelled values with trend chips
 * ----------------------------------------------------------------------------
 * options: {
 *   title, subtitle, icon,
 *   items: [
 *     { label: 'Production Rate', sublabel: 'vs last 24h',
 *       datapoint: 'production.rate', unit: 'units/hr', decimals: 0,
 *       trend: { window: '24h', improves: 'up' } }
 *   ]
 * }
 * ========================================================================== */
(function (SFP) {
  'use strict';

  SFP.widgets.register('stat-list', {
    create: function (ctx) {
      var dom = ctx.dom, format = ctx.format;
      var o = ctx.options;

      var card = dom.card({ title: o.title, subtitle: o.subtitle, icon: o.icon });
      ctx.root.appendChild(card.root);

      var list = dom.el('div', { class: 'stat-list' });
      card.body.appendChild(list);

      (o.items || []).forEach(function (item) {
        var def = ctx.hub.def(item.datapoint) || {};
        var decimals = (item.decimals !== undefined) ? item.decimals
          : (def.decimals !== undefined ? def.decimals : 1);
        var unit = (item.unit !== undefined) ? item.unit : (def.unit || '');

        var valueEl = dom.el('div', { class: 'stat-value', text: '—' });
        var trendEl = dom.el('div', { class: 'stat-trend' });

        list.appendChild(dom.el('div', { class: 'stat-row' }, [
          dom.el('div', { class: 'stat-info' }, [
            dom.el('div', { class: 'stat-label', text: item.label || def.label || item.datapoint }),
            item.sublabel ? dom.el('div', { class: 'stat-sublabel', text: item.sublabel }) : null,
          ]),
          dom.el('div', { class: 'stat-right' }, [valueEl, trendEl]),
        ]));

        ctx.subscribe(item.datapoint, function (sample) {
          if (typeof sample.value !== 'number' || !isFinite(sample.value)) {
            valueEl.textContent = '—';
            return;
          }
          valueEl.textContent = format.number(sample.value, decimals) + (unit ? ' ' + unit : '');

          if (item.trend) {
            var history = ctx.hub.history(item.datapoint, format.duration(item.trend.window || '24h'));
            if (history.length >= 8) {
              var baseSlice = history.slice(0, Math.max(2, Math.floor(history.length / 4)));
              var base = baseSlice.reduce(function (a, p) { return a + p.v; }, 0) / baseSlice.length;
              if (base) {
                var change = (sample.value - base) / Math.abs(base) * 100;
                var rising = change >= 0;
                var good = (item.trend.improves === 'down') ? !rising : rising;
                trendEl.className = 'stat-trend ' + (good ? 'trend-good' : 'trend-bad');
                trendEl.innerHTML = SFP.icons.svg(rising ? 'trending-up' : 'trending-down', 11);
                trendEl.appendChild(document.createTextNode(' ' + format.signedPercent(change, 1)));
              }
            }
          }
        });
      });

      return {};
    },
  });
}(window.SFP));
