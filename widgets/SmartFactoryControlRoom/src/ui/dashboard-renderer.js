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

  /* ── NO-DATA overlay helpers ──────────────────────────────────────────── */

  /** Build the label text for the overlay's secondary line. Shows up to 3
   *  ids then summarises the remainder as "+N more". */
  function unboundLabel(ids) {
    if (ids.length === 0) { return ''; }
    var shown = ids.slice(0, 3);
    var rest  = ids.length - shown.length;
    var label = shown.join(', ');
    if (rest > 0) { label += ' +' + rest + ' more'; }
    return label;
  }

  /** Inject (or refresh) the NO-DATA overlay inside `cell` for `unboundIds`.
   *  A single overlay element keyed by class is reused on refresh. */
  function setOverlay(cell, unboundIds) {
    var existing = cell.querySelector('.sfp-nodata-overlay');
    if (!unboundIds || unboundIds.length === 0) {
      if (existing) { existing.parentNode.removeChild(existing); }
      return;
    }
    if (!existing) {
      existing = dom.el('div', { class: 'sfp-nodata-overlay' }, [
        dom.el('div', { class: 'sfp-nodata-content' }, [
          dom.el('div', { class: 'sfp-nodata-title', text: 'NO DATA' }),
          dom.el('div', { class: 'sfp-nodata-ids' }),
        ]),
      ]);
      cell.appendChild(existing);
    }
    var idsEl = existing.querySelector('.sfp-nodata-ids');
    if (idsEl) { idsEl.textContent = 'Unbound: ' + unboundLabel(unboundIds); }
  }

  /** Compute which of the tracked dpIds are currently unbound, then
   *  add/remove/refresh the overlay for this cell. */
  function refreshOverlay(cell, trackedIds) {
    var hub = SFP.data.hub;
    if (hub.mode !== 'live') {
      setOverlay(cell, null);
      return;
    }
    var unbound = trackedIds.filter(function (id) { return hub.isUnbound(id); });
    setOverlay(cell, unbound.length > 0 ? unbound : null);
  }

  /* ── Widget context builder ───────────────────────────────────────────── */

  function buildContext(cell, widgetCfg, params, cleanups, trackedIds) {
    return {
      root: cell,
      options: widgetCfg.options || {},
      bind: widgetCfg.bind || {},
      params: params || {},

      subscribe: function (dpId, cb) {
        /* Record this datapoint so the overlay logic knows what to check. */
        if (trackedIds.indexOf(dpId) < 0) { trackedIds.push(dpId); }
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

      /* Attach the grid BEFORE creating widgets: data-hub subscriptions can
       * fire synchronously with cached values during create(), and Chart.js
       * responsive sizing throws on a detached canvas (parentNode null). */
      dom.clear(container);
      container.appendChild(grid);

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

        /* trackedIds collects every dpId this widget subscribes to, so the
         * overlay refresh knows what to check.  Populated during widget
         * creation via the ctx.subscribe() wrapper above. */
        var trackedIds = [];
        var cleanups = [];
        var instance = null;
        try {
          instance = SFP.widgets.create(
            widgetCfg.type,
            buildContext(cell, widgetCfg, params, cleanups, trackedIds)
          );
        } catch (err) {
          errorCard(cell, widgetCfg.type, err);
        }

        /* Initial overlay check (widget may already be in live mode). */
        refreshOverlay(cell, trackedIds);

        /* Re-evaluate on every mode switch for the lifetime of this cell. */
        var unsubMode = SFP.bus.on('data:modeChanged', function () {
          refreshOverlay(cell, trackedIds);
        });
        cleanups.push(unsubMode);

        instances.push({ instance: instance, cleanups: cleanups, cell: cell });
      });

      return {
        resize: function () {
          instances.forEach(function (entry) {
            if (entry.instance && entry.instance.resize) {
              try { entry.instance.resize(); } catch (err) { console.error(err); }
            }
          });
        },
        destroy: function () {
          /* Detach the grid from the DOM first so that any pending
           * ResizeObserver callbacks (e.g. from Chart.js 4.x) that fire
           * during widget teardown see a detached canvas and do not attempt
           * to access ownerDocument on an already-nulled reference. */
          dom.clear(container);
          instances.forEach(function (entry) {
            if (entry.instance && entry.instance.destroy) {
              try { entry.instance.destroy(); } catch (err) { console.error(err); }
            }
            entry.cleanups.forEach(function (unsub) {
              try { unsub(); } catch (err) { console.error(err); }
            });
          });
        },
      };
    },
  };
}(window.SFP));
