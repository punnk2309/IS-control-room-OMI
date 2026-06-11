/* ============================================================================
 * SFP.ui.dashboards — dashboard renderer
 * ----------------------------------------------------------------------------
 * Renders a dashboard definition (config/dashboards/*.dashboard.js) into a
 * container. A dashboard is a 12-column grid of widget instances:
 *
 *   {
 *     grid: { columns: 12, gap: 12 },        // optional, these are defaults
 *     widgets: [
 *       { type: 'kpi-card',
 *         layout: { span: 3, minH: 110 },    // grid placement
 *         bind: { value: 'production.rate' },// datapoint bindings
 *         options: { label: 'Production Rate', icon: 'activity' } },
 *       …
 *     ]
 *   }
 *
 * Widget failures are isolated: a broken widget renders an error card and
 * never takes the dashboard down.
 * ========================================================================== */
(function (SFP) {
  'use strict';

  var dom = SFP.dom;

  function buildContext(cell, widgetCfg, params, cleanups) {
    return {
      root: cell,
      options: widgetCfg.options || {},
      bind: widgetCfg.bind || {},
      params: params || {},

      subscribe: function (dpId, cb) {
        var unsub = SFP.data.hub.subscribe(dpId, cb);
        cleanups.push(unsub);
        return unsub;
      },
      onBus: function (event, cb) {
        var unsub = SFP.bus.on(event, cb);
        cleanups.push(unsub);
        return unsub;
      },

      hub: SFP.data.hub,
      machines: SFP.data.machines,
      states: SFP.state.engine,
      alarms: SFP.state.alarms,
      theme: SFP.ui.theme,
      nav: SFP.ui.nav,
      format: SFP.format,
      dom: SFP.dom,
      icons: SFP.icons,
    };
  }

  function errorCard(cell, type, err) {
    console.error('[SFP.dashboards] Widget "' + type + '" failed:', err);
    dom.clear(cell);
    cell.appendChild(dom.el('div', { class: 'card widget-error' }, [
      dom.el('div', { class: 'widget-error-title' }, [
        SFP.icons.el('alert-triangle', 14), 'Widget failed: ' + type,
      ]),
      dom.el('div', { class: 'widget-error-msg', text: String(err && err.message || err) }),
    ]));
  }

  SFP.ui.dashboards = {
    /** Render dashboard `id` into `container`. Returns a disposable handle. */
    render: function (container, id, params) {
      var cfg = SFP.config.get('dashboard.' + id);
      var gridCfg = cfg.grid || {};
      var columns = gridCfg.columns || 12;

      var grid = dom.el('div', {
        class: 'dash-grid',
        style: {
          gridTemplateColumns: 'repeat(' + columns + ', minmax(0, 1fr))',
          gap: (gridCfg.gap || 12) + 'px',
        },
      });

      var instances = [];

      (cfg.widgets || []).forEach(function (widgetCfg) {
        var layout = widgetCfg.layout || {};
        var span = Math.min(layout.span || columns, columns);
        var cell = dom.el('div', {
          class: 'dash-cell',
          style: {
            /* `col` pins the start column; `rows` lets a widget span grid
             * rows so side panels can stack next to a tall neighbour. */
            gridColumn: (layout.col ? layout.col + ' / ' : '') + 'span ' + span,
            gridRow: layout.rows ? 'span ' + layout.rows : null,
            minHeight: layout.minH ? layout.minH + 'px' : null,
          },
        });
        grid.appendChild(cell);

        var cleanups = [];
        var instance = null;
        try {
          instance = SFP.widgets.create(widgetCfg.type, buildContext(cell, widgetCfg, params, cleanups));
        } catch (err) {
          errorCard(cell, widgetCfg.type, err);
        }
        instances.push({ instance: instance, cleanups: cleanups });
      });

      dom.clear(container);
      container.appendChild(grid);

      return {
        resize: function () {
          instances.forEach(function (entry) {
            if (entry.instance && entry.instance.resize) {
              try { entry.instance.resize(); } catch (err) { console.error(err); }
            }
          });
        },
        destroy: function () {
          instances.forEach(function (entry) {
            if (entry.instance && entry.instance.destroy) {
              try { entry.instance.destroy(); } catch (err) { console.error(err); }
            }
            entry.cleanups.forEach(function (unsub) {
              try { unsub(); } catch (err) { console.error(err); }
            });
          });
          dom.clear(container);
        },
      };
    },
  };
}(window.SFP));
