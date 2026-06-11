/* ============================================================================
 * Widget: data-table — sortable table over a dataset datapoint
 * ----------------------------------------------------------------------------
 * bind:    { dataset: 'maintenance.workorders' }
 * options: {
 *   title, subtitle, icon,
 *   columns: [
 *     { field: 'asset', label: 'Asset' },
 *     { field: 'priority', label: 'Priority',
 *       chip: { High: 'sev-high', Medium: 'sev-medium', Low: 'sev-low' } },
 *     { field: 'due', label: 'Due', color: { Overdue: 'alarm' } },
 *   ],
 *   sort: { field: 'due', dir: 'asc' },   // initial sort (click headers to change)
 *   limit: 50,
 * }
 * ========================================================================== */
(function (SFP) {
  'use strict';

  SFP.widgets.register('data-table', {
    create: function (ctx) {
      var dom = ctx.dom, theme = ctx.theme;
      var o = ctx.options;
      var columns = o.columns || [];
      var sort = o.sort ? { field: o.sort.field, dir: o.sort.dir || 'asc' } : null;
      var rows = [];

      var card = dom.card({ title: o.title, subtitle: o.subtitle, icon: o.icon });
      ctx.root.appendChild(card.root);

      var thead = dom.el('thead', {}, [dom.el('tr', {}, columns.map(function (col) {
        return dom.el('th', {
          text: col.label || col.field,
          class: 'sortable',
          onclick: function () {
            if (sort && sort.field === col.field) {
              sort.dir = sort.dir === 'asc' ? 'desc' : 'asc';
            } else {
              sort = { field: col.field, dir: 'asc' };
            }
            render();
          },
        });
      }))]);
      var tbody = dom.el('tbody');
      var scroller = dom.el('div', { class: 'table-scroll' }, [
        dom.el('table', { class: 'data-table' }, [thead, tbody]),
      ]);
      card.body.appendChild(scroller);

      function cellContent(col, row) {
        var raw = row[col.field];
        if (raw === null || raw === undefined) { return dom.el('span', { text: '—' }); }
        if (col.chip) {
          var chipClass = col.chip[raw] || 'neutral';
          return dom.el('span', { class: 'badge ' + chipClass, text: String(raw) });
        }
        var span = dom.el('span', { text: String(raw) });
        if (col.color && col.color[raw]) { span.style.color = theme.color(col.color[raw]); }
        return span;
      }

      function render() {
        var data = rows.slice(0, o.limit || 200);
        if (sort) {
          var dir = sort.dir === 'desc' ? -1 : 1;
          data.sort(function (a, b) {
            var av = a[sort.field], bv = b[sort.field];
            if (av === bv) { return 0; }
            return (av < bv ? -1 : 1) * dir;
          });
        }
        Array.prototype.forEach.call(thead.querySelectorAll('th'), function (th, i) {
          var col = columns[i];
          th.textContent = (col.label || col.field) +
            (sort && sort.field === col.field ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : '');
        });

        dom.clear(tbody);
        if (!data.length) {
          tbody.appendChild(dom.el('tr', {}, [
            dom.el('td', { colspan: String(columns.length), class: 'empty-state', text: 'No records' }),
          ]));
          return;
        }
        data.forEach(function (row) {
          tbody.appendChild(dom.el('tr', {}, columns.map(function (col) {
            return dom.el('td', {}, [cellContent(col, row)]);
          })));
        });
      }

      ctx.subscribe(ctx.bind.dataset, function (sample) {
        rows = Array.isArray(sample.value) ? sample.value.slice() : [];
        render();
        card.setSubtitle(o.subtitle !== undefined ? o.subtitle : rows.length + ' records');
      });

      return {};
    },
  });
}(window.SFP));
