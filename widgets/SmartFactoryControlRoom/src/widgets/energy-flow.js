/* ============================================================================
 * Widget: energy-flow — sources → consumption flow visualization
 * ----------------------------------------------------------------------------
 * options: {
 *   title, subtitle, icon,
 *   sources: [
 *     { id: 'solar', label: 'Solar', icon: 'sun', color: 'chart-solar',
 *       datapoint: 'energy.solar', unit: 'kW' },
 *     { id: 'battery', label: 'Battery', icon: 'battery', color: 'chart-battery',
 *       datapoint: 'energy.batteryLevel', unit: '%',
 *       secondary: { datapoint: 'energy.batteryKwh', unit: 'kWh' } },
 *     …
 *   ],
 *   sink: { label: 'Consumption', icon: 'trending-up', color: 'accent',
 *           datapoint: 'energy.consumption', unit: 'kW' }
 * }
 *
 * Sources render as node cards with animated flow connectors whose intensity
 * follows each source's share of the total. Pure config — add a source
 * (e.g. wind) by adding an entry.
 * ========================================================================== */
(function (SFP) {
  'use strict';

  SFP.widgets.register('energy-flow', {
    create: function (ctx) {
      var dom = ctx.dom, theme = ctx.theme, format = ctx.format;
      var o = ctx.options;
      var sources = o.sources || [];

      var card = dom.card({ title: o.title || 'Energy Flow', subtitle: o.subtitle, icon: o.icon });
      ctx.root.appendChild(card.root);

      var values = {};   // source id -> latest numeric value (for shares)

      function nodeCard(node, isSink) {
        var valueEl = dom.el('div', { class: 'flow-value', text: '—' });
        var secondaryEl = node.secondary ? dom.el('div', { class: 'flow-secondary', text: '' }) : null;
        var iconEl = dom.el('div', { class: 'flow-icon', html: SFP.icons.svg(node.icon || 'zap', 18) });
        iconEl.style.color = theme.color(node.color || 'accent');
        iconEl.style.background = theme.alpha(node.color || 'accent', 0.12);

        var el = dom.el('div', { class: 'flow-node' + (isSink ? ' sink' : '') }, [
          iconEl,
          dom.el('div', { class: 'flow-label', text: node.label }),
          valueEl,
          secondaryEl,
        ]);
        el.style.borderColor = theme.alpha(node.color || 'accent', 0.35);
        return { el: el, value: valueEl, secondary: secondaryEl };
      }

      var grid = dom.el('div', { class: 'flow-grid' });
      var sourceCol = dom.el('div', { class: 'flow-sources' });
      var sinkCol = dom.el('div', { class: 'flow-sink-col' });
      grid.appendChild(sourceCol);
      grid.appendChild(sinkCol);
      card.body.appendChild(grid);

      var connectors = {};

      sources.forEach(function (src) {
        var node = nodeCard(src, false);
        var connector = dom.el('div', { class: 'flow-connector' }, [
          dom.el('div', { class: 'flow-dash' }),
        ]);
        connector.firstChild.style.background =
          'repeating-linear-gradient(90deg, ' + theme.color(src.color || 'accent') +
          ' 0 8px, transparent 8px 16px)';
        connectors[src.id] = connector.firstChild;

        sourceCol.appendChild(dom.el('div', { class: 'flow-row' }, [node.el, connector]));

        var def = ctx.hub.def(src.datapoint) || {};
        ctx.subscribe(src.datapoint, function (sample) {
          if (typeof sample.value !== 'number') { return; }
          node.value.textContent = format.number(sample.value, def.decimals || 0) +
            ' ' + (src.unit || def.unit || '');
          values[src.id] = sample.value;
          updateShares();
        });

        if (src.secondary) {
          var sdef = ctx.hub.def(src.secondary.datapoint) || {};
          ctx.subscribe(src.secondary.datapoint, function (sample) {
            if (typeof sample.value === 'number' && node.secondary) {
              node.secondary.textContent = format.number(sample.value, sdef.decimals || 0) +
                ' ' + (src.secondary.unit || sdef.unit || '');
            }
          });
        }
      });

      if (o.sink) {
        var sinkNode = nodeCard(o.sink, true);
        sinkCol.appendChild(sinkNode.el);
        var sinkDef = ctx.hub.def(o.sink.datapoint) || {};
        ctx.subscribe(o.sink.datapoint, function (sample) {
          if (typeof sample.value === 'number') {
            sinkNode.value.textContent = format.number(sample.value, sinkDef.decimals || 0) +
              ' ' + (o.sink.unit || sinkDef.unit || '');
          }
        });
      }

      /** Flow connector opacity/speed follows each source's share. */
      function updateShares() {
        var total = 0;
        sources.forEach(function (src) {
          if (!src.secondary) { total += values[src.id] || 0; }
        });
        sources.forEach(function (src) {
          var dash = connectors[src.id];
          if (!dash) { return; }
          var share = total > 0 ? (values[src.id] || 0) / total : 0;
          dash.style.opacity = String(0.25 + share * 0.75);
          dash.style.animationDuration = (2.5 - share * 1.6).toFixed(2) + 's';
        });
      }

      return {};
    },
  });
}(window.SFP));
