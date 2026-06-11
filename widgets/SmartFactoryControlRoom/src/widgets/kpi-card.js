/* ============================================================================
 * Widget: kpi-card — single headline value with trend and quality indication
 * ----------------------------------------------------------------------------
 * bind:    { value: 'production.rate' }
 * options: {
 *   label: 'Production Rate',      // defaults to the datapoint label
 *   unit: 'units/hr',              // defaults to the datapoint unit
 *   decimals: 0,                   // defaults to the datapoint decimals
 *   icon: 'activity', accent: 'accent' | any color token,
 *   trend: {                       // optional trend chip vs recent history
 *     window: '24h',               // comparison window (default '24h')
 *     improves: 'up' | 'down',     // which direction is good (default 'up')
 *   },
 *   valueColor: 'state-running',   // optional fixed value color token
 * }
 * ========================================================================== */
(function (SFP) {
  'use strict';

  SFP.widgets.register('kpi-card', {
    create: function (ctx) {
      var dom = ctx.dom, format = ctx.format, theme = ctx.theme;
      var dpId = ctx.bind.value;
      var def = ctx.hub.def(dpId) || {};
      var o = ctx.options;

      var decimals = (o.decimals !== undefined) ? o.decimals : (def.decimals !== undefined ? def.decimals : 1);
      var unit = (o.unit !== undefined) ? o.unit : (def.unit || '');
      var label = o.label || def.label || dpId;

      var valueEl = dom.el('span', { class: 'kpi-value', text: '—' });
      if (o.valueColor) { valueEl.style.color = theme.color(o.valueColor); }
      var trendEl = dom.el('div', { class: 'kpi-trend' });
      var qualityEl = dom.el('span', { class: 'kpi-quality', title: '' });

      var iconWrap = dom.el('div', {
        class: 'kpi-icon',
        html: SFP.icons.svg(o.icon || 'activity', 18),
      });
      var accent = theme.color(o.accent || 'accent');
      iconWrap.style.color = accent;
      iconWrap.style.background = theme.alpha(o.accent || 'accent', 0.12);

      ctx.root.appendChild(dom.el('div', { class: 'card kpi-card' }, [
        dom.el('div', { class: 'kpi-top' }, [iconWrap, trendEl]),
        dom.el('div', { class: 'kpi-label' }, [label, qualityEl]),
        dom.el('div', { class: 'kpi-value-row' }, [
          valueEl,
          unit ? dom.el('span', { class: 'kpi-unit', text: unit }) : null,
        ]),
      ]));

      function updateTrend(current) {
        if (!o.trend) { return; }
        var windowMs = format.duration(o.trend.window || '24h');
        var history = ctx.hub.history(dpId, windowMs);
        if (history.length < 8) { trendEl.innerHTML = ''; return; }

        /* Compare now vs the average of the first quarter of the window. */
        var baseSlice = history.slice(0, Math.max(2, Math.floor(history.length / 4)));
        var base = baseSlice.reduce(function (a, p) { return a + p.v; }, 0) / baseSlice.length;
        if (!base) { trendEl.innerHTML = ''; return; }

        var change = (current - base) / Math.abs(base) * 100;
        var rising = change >= 0;
        var good = (o.trend.improves === 'down') ? !rising : rising;

        trendEl.className = 'kpi-trend ' + (good ? 'trend-good' : 'trend-bad');
        trendEl.innerHTML = SFP.icons.svg(rising ? 'trending-up' : 'trending-down', 12);
        trendEl.appendChild(document.createTextNode(' ' + format.signedPercent(change, 1)));
      }

      function updateQuality(quality) {
        var show = quality && quality !== 'Good';
        qualityEl.className = 'kpi-quality' + (show ? ' visible q-' + quality.toLowerCase() : '');
        qualityEl.textContent = show ? quality.toUpperCase() : '';
        qualityEl.title = show ? 'Data quality: ' + quality : '';
      }

      ctx.subscribe(dpId, function (sample) {
        if (typeof sample.value === 'number' && isFinite(sample.value)) {
          valueEl.textContent = format.number(sample.value, decimals);
          updateTrend(sample.value);
        } else {
          valueEl.textContent = '—';
        }
        updateQuality(sample.quality);
      });

      return {};
    },
  });
}(window.SFP));
