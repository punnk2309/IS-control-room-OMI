/* ============================================================================
 * Widget: machine-grid — fleet browser with filters, search and pagination
 * ----------------------------------------------------------------------------
 * Machines come from the machine registry (config/machines.config.js); this
 * widget never hard-codes machine knowledge. Designed for large fleets: only
 * the machines on the current page subscribe to their metric datapoints.
 *
 * options: {
 *   title, icon,
 *   mode: 'detailed' | 'compact',   // metric cards vs small status tiles
 *   pageSize: 12,                    // per page (compact default 60)
 *   metrics: ['temperature','load','runtime'],  // rows on detailed cards
 *   showFilters: true,
 * }
 *
 * Honors navigation params: #/machines?zone=welding&state=error
 * ========================================================================== */
(function (SFP) {
  'use strict';

  var METRIC_ICON = { temperature: 'thermometer', load: 'gauge', runtime: 'timer' };

  SFP.widgets.register('machine-grid', {
    create: function (ctx) {
      var dom = ctx.dom, format = ctx.format, theme = ctx.theme;
      var o = ctx.options;
      var mode = o.mode || 'detailed';
      var pageSize = o.pageSize || (mode === 'compact' ? 60 : 12);
      var metrics = o.metrics || ['temperature', 'load', 'runtime'];

      var filter = {
        zone: ctx.params.zone || '',
        state: ctx.params.state || '',
        search: '',
        page: 0,
      };

      var card = dom.card({ title: o.title || 'Machines', icon: o.icon });
      ctx.root.appendChild(card.root);

      var pageSubs = [];   // hub unsubscribers for the visible page only

      /* ── Filter bar ────────────────────────────────────────────────────── */

      var filterBar = dom.el('div', { class: 'machine-filters' });
      if (o.showFilters !== false) {
        var searchInput = dom.el('input', {
          class: 'input', type: 'text', placeholder: 'Search machines…',
          value: filter.search,
          oninput: function (e) { filter.search = e.target.value; filter.page = 0; render(); },
        });

        var zones = {};
        ctx.machines.list().forEach(function (m) { zones[m.zone] = true; });
        var layout = SFP.config.get('twin.layout', true);
        var zoneLabel = function (zoneId) {
          var zone = layout && layout.zones.filter(function (z) { return z.id === zoneId; })[0];
          return zone ? zone.label : zoneId;
        };
        var zoneSelect = dom.el('select', {
          class: 'input select',
          onchange: function (e) { filter.zone = e.target.value; filter.page = 0; render(); },
        }, [dom.el('option', { value: '', text: 'All zones' })].concat(
          Object.keys(zones).sort().map(function (zoneId) {
            var opt = dom.el('option', { value: zoneId, text: zoneLabel(zoneId) });
            if (zoneId === filter.zone) { opt.selected = true; }
            return opt;
          })
        ));

        var stateChips = dom.el('div', { class: 'state-chips' },
          [{ id: '', label: 'All' }].concat(ctx.states.states('machine')).map(function (s) {
            var chip = dom.el('button', {
              class: 'state-chip' + (filter.state === s.id ? ' active' : ''),
              text: s.label,
              onclick: function () {
                filter.state = s.id; filter.page = 0;
                Array.prototype.forEach.call(stateChips.children, function (c) { c.classList.remove('active'); });
                chip.classList.add('active');
                render();
              },
            });
            if (s.color) { chip.style.setProperty('--chip-color', theme.color(s.color)); }
            return chip;
          })
        );

        filterBar.appendChild(searchInput);
        filterBar.appendChild(zoneSelect);
        filterBar.appendChild(stateChips);
        card.body.appendChild(filterBar);
      }

      var grid = dom.el('div', { class: 'machine-grid ' + mode });
      var pager = dom.el('div', { class: 'pager' });
      card.body.appendChild(grid);
      card.body.appendChild(pager);

      /* ── Card builders ─────────────────────────────────────────────────── */

      function stateBadge(stateId) {
        var def = ctx.states.stateDef('machine', stateId);
        var badge = dom.el('span', { class: 'machine-state-badge', text: def.label.toUpperCase() });
        badge.style.color = theme.color(def.color);
        badge.style.background = theme.alpha(def.color, 0.12);
        return badge;
      }

      function detailedCard(machine) {
        var stateWrap = dom.el('div', { class: 'machine-card-state' });
        var metricEls = {};
        var effBar = dom.el('div', { class: 'progress-fill' });
        var effVal = dom.el('span', { class: 'machine-eff-val', text: '—' });

        var el = dom.el('div', { class: 'machine-card' }, [
          dom.el('div', { class: 'machine-card-top' }, [
            dom.el('div', {}, [
              dom.el('div', { class: 'machine-id', text: machine.id }),
              dom.el('div', { class: 'machine-name', text: machine.name }),
            ]),
            stateWrap,
          ]),
          dom.el('div', { class: 'machine-metrics' }, metrics.map(function (metric) {
            var def = ctx.hub.def(ctx.machines.dp(machine.id, metric)) || {};
            metricEls[metric] = dom.el('span', { class: 'machine-metric-val', text: '—' });
            return dom.el('div', { class: 'machine-metric-row' }, [
              dom.el('span', { class: 'machine-metric-label' }, [
                SFP.icons.el(METRIC_ICON[metric] || 'info', 11),
                (def.label || metric).replace(machine.name + ' ', ''),
              ]),
              metricEls[metric],
            ]);
          })),
          dom.el('div', { class: 'machine-eff' }, [
            dom.el('div', { class: 'machine-eff-row' }, [
              dom.el('span', { text: 'Efficiency' }), effVal,
            ]),
            dom.el('div', { class: 'progress-bar-bg' }, [effBar]),
          ]),
        ]);

        pageSubs.push(ctx.hub.subscribe(ctx.machines.dp(machine.id, 'state'), function (sample) {
          if (sample.value === null || sample.value === undefined) {
            /* Live mode without a wired source: blank, never synthetic. */
            dom.clear(stateWrap).appendChild(
              dom.el('span', { class: 'machine-state-badge nodata', text: 'no data' }));
            el.removeAttribute('data-state');
            el.style.borderColor = '';
            return;
          }
          var stateId = ctx.states.normalize('machine', sample.value);
          dom.clear(stateWrap).appendChild(stateBadge(stateId));
          el.setAttribute('data-state', stateId);
          el.style.borderColor = theme.alpha(ctx.states.stateDef('machine', stateId).color, 0.45);
        }));

        metrics.forEach(function (metric) {
          var dpId = ctx.machines.dp(machine.id, metric);
          var def = ctx.hub.def(dpId) || {};
          pageSubs.push(ctx.hub.subscribe(dpId, function (sample) {
            metricEls[metric].textContent = (typeof sample.value === 'number')
              ? format.number(sample.value, def.decimals || 0) + (def.unit ? ' ' + def.unit : '')
              : '—';
          }));
        });

        pageSubs.push(ctx.hub.subscribe(ctx.machines.dp(machine.id, 'efficiency'), function (sample) {
          var v = (typeof sample.value === 'number') ? sample.value : 0;
          effBar.style.width = Math.min(100, v) + '%';
          effBar.style.background = theme.color('accent');
          effVal.textContent = format.number(v, 0) + '%';
        }));

        return el;
      }

      function compactCard(machine) {
        var stateWrap = dom.el('div', { class: 'machine-card-state' });
        var el = dom.el('div', { class: 'machine-tile' }, [
          dom.el('div', { class: 'machine-id', text: machine.id }),
          stateWrap,
          dom.el('div', { class: 'machine-tile-zone', text: machine.zone }),
        ]);
        pageSubs.push(ctx.hub.subscribe(ctx.machines.dp(machine.id, 'state'), function (sample) {
          if (sample.value === null || sample.value === undefined) {
            dom.clear(stateWrap).appendChild(
              dom.el('span', { class: 'machine-state-badge nodata', text: 'no data' }));
            el.style.borderColor = '';
            return;
          }
          var stateId = ctx.states.normalize('machine', sample.value);
          dom.clear(stateWrap).appendChild(stateBadge(stateId));
          el.style.borderColor = theme.alpha(ctx.states.stateDef('machine', stateId).color, 0.45);
        }));
        return el;
      }

      /* ── Rendering ─────────────────────────────────────────────────────── */

      function visibleMachines() {
        var needle = filter.search.trim().toLowerCase();
        return ctx.machines.list().filter(function (m) {
          if (filter.zone && m.zone !== filter.zone) { return false; }
          if (filter.state && ctx.machines.stateOf(m.id) !== filter.state) { return false; }
          if (needle && (m.id + ' ' + m.name).toLowerCase().indexOf(needle) < 0) { return false; }
          return true;
        });
      }

      function render() {
        /* Release datapoint subscriptions of the previous page. */
        pageSubs.forEach(function (unsub) { unsub(); });
        pageSubs = [];
        dom.clear(grid);
        dom.clear(pager);

        var all = visibleMachines();
        var pages = Math.max(1, Math.ceil(all.length / pageSize));
        filter.page = Math.min(filter.page, pages - 1);
        var slice = all.slice(filter.page * pageSize, (filter.page + 1) * pageSize);

        card.setSubtitle(all.length + ' of ' + ctx.machines.list().length + ' machines');

        if (!slice.length) {
          grid.appendChild(dom.el('div', { class: 'empty-state' }, [
            SFP.icons.el('search', 18), dom.el('div', { text: 'No machines match the current filters' }),
          ]));
        }
        slice.forEach(function (machine) {
          grid.appendChild(mode === 'compact' ? compactCard(machine) : detailedCard(machine));
        });

        if (pages > 1) {
          pager.appendChild(dom.el('button', {
            class: 'btn-small', text: '‹ Prev', disabled: filter.page === 0 ? '' : null,
            onclick: function () { if (filter.page > 0) { filter.page -= 1; render(); } },
          }));
          pager.appendChild(dom.el('span', {
            class: 'pager-info',
            text: 'Page ' + (filter.page + 1) + ' / ' + pages,
          }));
          pager.appendChild(dom.el('button', {
            class: 'btn-small', text: 'Next ›', disabled: filter.page >= pages - 1 ? '' : null,
            onclick: function () { if (filter.page < pages - 1) { filter.page += 1; render(); } },
          }));
        }
      }

      /* Re-render when fleet states change so state filters stay truthful
       * (throttled — state changes are infrequent). */
      var pendingRefresh = null;
      ctx.onBus('machines:counts', function () {
        if (!filter.state || pendingRefresh) { return; }
        pendingRefresh = setTimeout(function () { pendingRefresh = null; render(); }, 1500);
      });

      render();

      return {
        destroy: function () {
          pageSubs.forEach(function (unsub) { unsub(); });
          if (pendingRefresh) { clearTimeout(pendingRefresh); }
        },
      };
    },
  });
}(window.SFP));
