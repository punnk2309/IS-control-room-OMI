/* ============================================================================
 * Widget: zone-details — side panel for the factory map
 * ----------------------------------------------------------------------------
 * Listens for 'map:zoneSelected' bus events and shows the zone's live energy,
 * machine fleet breakdown, optimization hint and configurable quick actions.
 *
 * options: {
 *   title: 'Zone Details',
 *   actions: [
 *     { label: 'View Machines', icon: 'cog', primary: true,
 *       navigate: { page: 'machines', params: { zone: '{zone}' } } },
 *   ]
 * }
 * Action params support the '{zone}' placeholder (selected zone id).
 * ========================================================================== */
(function (SFP) {
  'use strict';

  SFP.widgets.register('zone-details', {
    create: function (ctx) {
      var dom = ctx.dom, format = ctx.format, theme = ctx.theme;
      var o = ctx.options;
      var layout = SFP.config.get('factoryLayout');

      var card = dom.card({ title: o.title || 'Zone Details', icon: o.icon });
      ctx.root.appendChild(card.root);
      var body = dom.el('div', { class: 'zone-details' });
      card.body.appendChild(body);

      var energyUnsub = null;
      var currentZone = null;

      function findZone(zoneId) {
        return layout.zones.filter(function (z) { return z.id === zoneId; })[0] || null;
      }

      function render(zone) {
        dom.clear(body);
        if (!zone) {
          body.appendChild(dom.el('div', { class: 'empty-state' }, [
            SFP.icons.el('map', 18),
            dom.el('div', { text: 'Select a zone on the map' }),
          ]));
          return;
        }

        var energyVal = dom.el('div', { class: 'zone-stat-value', text: '—' });
        var machinesVal = dom.el('div', { class: 'zone-stat-value', text: '—' });
        var stateList = dom.el('div', { class: 'zone-state-list' });

        body.appendChild(dom.el('div', { class: 'zone-name-block' }, [
          dom.el('div', { class: 'zone-kicker', text: 'Selected zone' }),
          dom.el('div', { class: 'zone-name', text: zone.label }),
        ]));

        body.appendChild(dom.el('div', { class: 'zone-stats' }, [
          dom.el('div', { class: 'zone-stat' }, [
            dom.el('div', { class: 'zone-stat-label' }, [SFP.icons.el('zap', 12), 'Energy']),
            energyVal,
          ]),
          dom.el('div', { class: 'zone-stat' }, [
            dom.el('div', { class: 'zone-stat-label' }, [SFP.icons.el('cog', 12), 'Machines']),
            machinesVal,
          ]),
        ]));
        body.appendChild(stateList);

        if (zone.hint) {
          body.appendChild(dom.el('div', { class: 'zone-hint' }, [
            dom.el('div', { class: 'zone-hint-title' }, [SFP.icons.el('info', 12), 'Optimization']),
            dom.el('div', { class: 'zone-hint-text', text: zone.hint }),
          ]));
        }

        if (o.actions && o.actions.length) {
          body.appendChild(dom.el('div', { class: 'zone-kicker', style: { marginTop: '14px' }, text: 'Quick actions' }));
          o.actions.forEach(function (action) {
            body.appendChild(dom.el('button', {
              class: 'btn-action' + (action.primary ? ' primary' : ''),
              onclick: function () {
                if (!action.navigate) { return; }
                var params = {};
                Object.keys(action.navigate.params || {}).forEach(function (key) {
                  params[key] = format.template(action.navigate.params[key], { zone: zone.id });
                });
                ctx.nav.navigate(action.navigate.page, params);
              },
            }, [action.icon ? SFP.icons.el(action.icon, 13) : null, action.label]));
          });
        }

        /* Live values */
        if (energyUnsub) { energyUnsub(); energyUnsub = null; }
        if (zone.energy) {
          var def = ctx.hub.def(zone.energy) || {};
          energyUnsub = ctx.hub.subscribe(zone.energy, function (sample) {
            if (typeof sample.value === 'number') {
              energyVal.textContent = format.number(sample.value, 0) + ' ' + (def.unit || 'kWh');
            }
          });
        }

        function refreshMachineBlock() {
          var counts = ctx.machines.counts(zone.id);
          machinesVal.textContent = counts.total + ' units';
          dom.clear(stateList);
          ctx.states.states('machine').forEach(function (s) {
            if (!counts[s.id]) { return; }
            var chip = dom.el('span', { class: 'zone-state-chip' }, [
              dom.el('span', { class: 'legend-swatch', style: { background: theme.color(s.color) } }),
              s.label + ': ' + counts[s.id],
            ]);
            stateList.appendChild(chip);
          });
        }
        refreshMachineBlock();
        render._machineRefresh = refreshMachineBlock;
      }

      ctx.onBus('map:zoneSelected', function (e) {
        currentZone = findZone(e.zoneId);
        render(currentZone);
      });
      ctx.onBus('machines:counts', function () {
        if (currentZone && render._machineRefresh) { render._machineRefresh(); }
      });

      render(null);

      return {
        destroy: function () { if (energyUnsub) { energyUnsub(); } },
      };
    },
  });
}(window.SFP));
