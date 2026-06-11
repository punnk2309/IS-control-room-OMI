/* ============================================================================
 * Widget: alarm-list — live alarms from the alarm engine
 * ----------------------------------------------------------------------------
 * options: {
 *   title, subtitle, icon,
 *   category: 'energy',        // only alarms of this category (optional)
 *   limit: 8,                  // max rows
 *   showResolved: true,        // include recently-resolved alarms
 *   actions: true,             // show Ack / Resolve buttons
 *   compact: false,            // smaller rows (side panels)
 * }
 * ========================================================================== */
(function (SFP) {
  'use strict';

  var SEVERITY_ICON = {
    Critical: 'x-circle', High: 'alert-triangle', Medium: 'alert-triangle', Low: 'info',
  };

  SFP.widgets.register('alarm-list', {
    create: function (ctx) {
      var dom = ctx.dom, format = ctx.format;
      var o = ctx.options;
      var limit = o.limit || 8;

      var card = dom.card({ title: o.title || 'Active Alerts', subtitle: o.subtitle, icon: o.icon });
      ctx.root.appendChild(card.root);

      var countChips = dom.el('div', { class: 'alarm-count-chips' });
      if (card.actions) { card.actions.appendChild(countChips); }

      var list = dom.el('div', { class: 'alarm-list' + (o.compact ? ' compact' : '') });
      card.body.appendChild(list);

      function renderChips() {
        /* Count within this widget's category filter, not globally. */
        var counts = { Critical: 0, High: 0, Medium: 0, Low: 0 };
        ctx.alarms.active(o.category).forEach(function (a) { counts[a.severity] += 1; });
        dom.clear(countChips);
        ['Critical', 'High', 'Medium'].forEach(function (sev) {
          if (counts[sev]) {
            countChips.appendChild(dom.el('span', {
              class: 'badge sev-' + sev.toLowerCase(),
              text: sev + ' (' + counts[sev] + ')',
            }));
          }
        });
      }

      function renderRow(alarm) {
        var resolved = alarm.state === 'resolved';
        return dom.el('div', { class: 'alarm-item sev-' + alarm.severity.toLowerCase() + (resolved ? ' resolved' : '') }, [
          dom.el('div', {
            class: 'alarm-icon',
            html: SFP.icons.svg(resolved ? 'check-circle' : (SEVERITY_ICON[alarm.severity] || 'info'), 15),
          }),
          dom.el('div', { class: 'alarm-body' }, [
            dom.el('div', { class: 'alarm-msg', text: alarm.message }),
            dom.el('div', { class: 'alarm-meta' }, [
              dom.el('span', { class: 'badge sev-' + alarm.severity.toLowerCase(), text: alarm.severity }),
              alarm.source ? dom.el('span', { class: 'alarm-source', text: alarm.source }) : null,
              dom.el('span', { class: 'alarm-time', text: resolved
                ? 'resolved ' + format.timeAgo(alarm.resolvedAt)
                : format.timeAgo(alarm.raisedAt) }),
              alarm.acked && !resolved ? dom.el('span', { class: 'badge acked', text: 'ACK' }) : null,
            ]),
          ]),
          (o.actions && !resolved) ? dom.el('div', { class: 'alarm-actions' }, [
            !alarm.acked ? dom.el('button', {
              class: 'btn-small', text: 'Ack',
              onclick: function () { ctx.alarms.acknowledge(alarm.key); },
            }) : null,
            dom.el('button', {
              class: 'btn-small primary', text: 'Resolve',
              onclick: function () { ctx.alarms.resolve(alarm.key); },
            }),
          ]) : null,
        ]);
      }

      function render() {
        var rows = ctx.alarms.active(o.category);
        if (o.showResolved && rows.length < limit) {
          rows = rows.concat(ctx.alarms.recent(o.category).slice(0, limit - rows.length));
        }
        rows = rows.slice(0, limit);

        dom.clear(list);
        if (!rows.length) {
          list.appendChild(dom.el('div', { class: 'empty-state' }, [
            SFP.icons.el('check-circle', 18),
            dom.el('div', { text: 'No active alerts' }),
          ]));
        } else {
          rows.forEach(function (alarm) { list.appendChild(renderRow(alarm)); });
        }
        renderChips();
        card.setSubtitle((o.subtitle !== undefined) ? o.subtitle
          : ctx.alarms.active(o.category).length + ' alert(s) requiring attention');
      }

      ctx.onBus('alarm:raised', render);
      ctx.onBus('alarm:cleared', render);
      ctx.onBus('alarm:changed', render);
      render();

      /* Keep the "x min ago" labels fresh. */
      var timer = setInterval(render, 30000);

      return {
        destroy: function () { clearInterval(timer); },
      };
    },
  });
}(window.SFP));
