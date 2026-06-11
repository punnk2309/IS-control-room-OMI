/* ============================================================================
 * Widget: factory-map — configurable factory floor map (SVG)
 * ----------------------------------------------------------------------------
 * Zones, geometry and bindings come entirely from config/factory-layout
 * .config.js — adding/moving/resizing zones is a config change, never a code
 * change. Zone coloring is resolved through a state group (default
 * 'zone-energy'), so band thresholds and colors are also config.
 *
 * options: {
 *   title, subtitle, icon,
 *   stateGroup: 'zone-energy',
 *   legend: true,
 *   selectable: true,          // click zones -> 'map:zoneSelected' bus event
 *   autoSelect: true,          // select the first zone on load
 * }
 *
 * Pairs with the 'zone-details' widget, which listens for selections.
 * ========================================================================== */
(function (SFP) {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';

  function svgEl(tag, attrs) {
    var node = document.createElementNS(SVG_NS, tag);
    Object.keys(attrs || {}).forEach(function (key) { node.setAttribute(key, attrs[key]); });
    return node;
  }

  SFP.widgets.register('factory-map', {
    create: function (ctx) {
      var dom = ctx.dom, theme = ctx.theme, format = ctx.format;
      var o = ctx.options;
      var layout = SFP.config.get('factoryLayout');
      var stateGroup = o.stateGroup || 'zone-energy';
      var canvas = layout.canvas || { width: 100, height: 62 };
      var selectedZone = null;

      var card = dom.card({ title: o.title || 'Factory Floor Map', subtitle: o.subtitle, icon: o.icon });
      ctx.root.appendChild(card.root);

      /* Legend from the state group — never hard-coded. */
      if (o.legend !== false && card.actions) {
        var legend = dom.el('div', { class: 'map-legend' });
        ctx.states.states(stateGroup).forEach(function (s) {
          legend.appendChild(dom.el('span', { class: 'map-legend-item' }, [
            dom.el('span', { class: 'legend-swatch', style: { background: theme.color(s.color) } }),
            s.label,
          ]));
        });
        card.actions.appendChild(legend);
      }

      var svg = svgEl('svg', {
        viewBox: '0 0 ' + canvas.width + ' ' + canvas.height,
        class: 'factory-map-svg',
        preserveAspectRatio: 'xMidYMid meet',
      });
      card.body.appendChild(dom.el('div', { class: 'factory-map-wrap' }, []));
      card.body.lastChild.appendChild(svg);

      /* Subtle blueprint grid */
      var defs = svgEl('defs');
      var pattern = svgEl('pattern', { id: 'sfp-map-grid', width: 4, height: 4, patternUnits: 'userSpaceOnUse' });
      pattern.appendChild(svgEl('path', {
        d: 'M 4 0 L 0 0 0 4',
        fill: 'none',
        stroke: theme.alpha('border', 0.35),
        'stroke-width': 0.15,
      }));
      defs.appendChild(pattern);
      svg.appendChild(defs);
      svg.appendChild(svgEl('rect', {
        x: 0, y: 0, width: canvas.width, height: canvas.height,
        fill: 'url(#sfp-map-grid)',
      }));

      /* ── Zones ─────────────────────────────────────────────────────────── */

      var zoneEls = {};

      layout.zones.forEach(function (zone) {
        var r = zone.rect;
        var group = svgEl('g', { class: 'map-zone', 'data-zone': zone.id });

        /* Clip the zone's texts to its rect so long labels never spill
         * into neighbouring zones. */
        var clipId = 'sfp-zone-clip-' + zone.id;
        var clip = svgEl('clipPath', { id: clipId });
        clip.appendChild(svgEl('rect', { x: r.x, y: r.y, width: r.w, height: r.h, rx: 0.8 }));
        defs.appendChild(clip);

        var rect = svgEl('rect', {
          x: r.x, y: r.y, width: r.w, height: r.h, rx: 0.8,
          'stroke-width': 0.35,
        });
        var label = svgEl('text', {
          x: r.x + 1.6, y: r.y + 3, class: 'map-zone-label',
          'clip-path': 'url(#' + clipId + ')',
        });
        label.textContent = zone.label;
        var stateDot = svgEl('circle', { cx: r.x + r.w - 2, cy: r.y + 2.4, r: 0.7 });
        var valueText = svgEl('text', { x: r.x + 1.6, y: r.y + r.h - 2, class: 'map-zone-value' });
        valueText.textContent = '—';
        var errorBadge = svgEl('text', {
          x: r.x + r.w - 2, y: r.y + r.h - 2, class: 'map-zone-error', 'text-anchor': 'end',
        });

        group.appendChild(rect);
        group.appendChild(label);
        group.appendChild(stateDot);
        group.appendChild(valueText);
        group.appendChild(errorBadge);
        svg.appendChild(group);

        if (o.selectable !== false) {
          group.addEventListener('click', function () {
            SFP.bus.emit('map:zoneSelected', { zoneId: zone.id });
          });
          group.classList.add('clickable');
        }

        zoneEls[zone.id] = { group: group, rect: rect, dot: stateDot, value: valueText, error: errorBadge, zone: zone };

        /* Color from the zone's bound energy datapoint via state rules. */
        if (zone.energy) {
          var def = ctx.hub.def(zone.energy) || {};
          ctx.subscribe(zone.energy, function (sample) {
            if (typeof sample.value !== 'number') { return; }
            var stateId = ctx.states.evaluateRules(stateGroup, sample.value);
            var color = theme.color(ctx.states.stateDef(stateGroup, stateId).color);
            rect.setAttribute('fill', theme.alpha(ctx.states.stateDef(stateGroup, stateId).color, 0.13));
            rect.setAttribute('stroke', color);
            stateDot.setAttribute('fill', color);
            valueText.textContent = format.number(sample.value, 0) + ' ' + (def.unit || 'kWh');
          });
        }
      });

      /* Machine-error markers on zones (independent of energy bands). */
      function refreshErrorBadges() {
        layout.zones.forEach(function (zone) {
          var counts = ctx.machines.counts(zone.id);
          var el = zoneEls[zone.id].error;
          el.textContent = counts.error ? '⚠ ' + counts.error : '';
          el.setAttribute('fill', theme.color('alarm'));
        });
      }
      ctx.onBus('machines:counts', refreshErrorBadges);
      refreshErrorBadges();

      function highlightSelection() {
        Object.keys(zoneEls).forEach(function (zoneId) {
          zoneEls[zoneId].group.classList.toggle('selected', zoneId === selectedZone);
        });
      }
      ctx.onBus('map:zoneSelected', function (e) {
        selectedZone = e.zoneId;
        highlightSelection();
      });

      if (o.autoSelect !== false && o.selectable !== false && layout.zones.length) {
        /* Defer so sibling widgets (zone-details) are mounted and listening. */
        setTimeout(function () {
          if (!selectedZone) {
            SFP.bus.emit('map:zoneSelected', { zoneId: layout.zones[0].id });
          }
        }, 0);
      }

      return {};
    },
  });
}(window.SFP));
