/* ============================================================================
 * SFP.twin.DetailPanel — slide-in detail panel for the twin
 * ----------------------------------------------------------------------------
 * Shows whatever is selected on the canvas:
 *
 *   zone        breadcrumb, floor selector, status value, machine-state
 *               chips, optimization hint, its flows, quick actions that jump
 *               to the other dashboards (Machines pre-filtered to the zone,
 *               Energy, Maintenance) — the cross-dashboard glue
 *   subzone     breadcrumb, own floor selector when it has floors, machine
 *               list, its flows
 *   machine     state, live value, per-binding wiring status, its flows,
 *               quick actions
 *   connection  endpoints (clickable), live value, thresholds/rules, binding
 *               wiring status
 *   nothing     in Live mode: the wiring checklist (every binding on the
 *               page, wired vs simulation-only); in Simulation mode: a
 *               short how-to
 *
 * The panel re-renders on store changes and refreshes live numbers on a 1s
 * timer while open. All styling via twin.css + theme CSS variables.
 * ========================================================================== */
(function (SFP) {
  'use strict';

  SFP.twin = SFP.twin || {};

  function DetailPanel(deps) {
    this.root = deps.root;
    this.model = deps.model;
    this.camera = deps.camera;
    this.store = deps.store;
    this.data = deps.data;
    this.states = deps.states;
    this.machines = deps.machines;
    this.nav = deps.nav;
    this.onBus = deps.onBus;
    this.dom = SFP.dom;

    this.el = this.dom.el('div', { class: 'twin-detail' });
    this.root.appendChild(this.el);

    var self = this;
    this.unsubStore = this.store.on(function (changed) {
      if (changed.indexOf('selection') >= 0 || changed.indexOf('panelOpen') >= 0 ||
          changed.indexOf('activeFloors') >= 0) { self.render(); }
    });
    this.onBus('data:modeChanged', function () { self.render(); });
    this.onBus('edit:modeChanged', function () { self.render(); });
    this.timer = setInterval(function () {
      if (self.store.get().panelOpen || SFP.runtime.mode === 'live') { self.render(); }
    }, 1000);

    this.render();
  }

  DetailPanel.prototype.destroy = function () {
    clearInterval(this.timer);
    if (this.unsubStore) { this.unsubStore(); }
  };

  /* ── Small builders ────────────────────────────────────────────────────── */

  DetailPanel.prototype._statusChip = function (dpId) {
    var status = this.data.status(dpId);
    var text = { sim: 'simulated', live: 'live', waiting: 'waiting for data', unwired: 'no source' }[status];
    return this.dom.el('span', { class: 'twin-bind-chip ' + status, text: text });
  };

  DetailPanel.prototype._valueText = function (dpId, unit, decimals) {
    var v = this.data.num(dpId);
    return v === null ? '—' : SFP.format.number(v, decimals || 0) + ' ' + (unit || '');
  };

  DetailPanel.prototype._breadcrumb = function (el) {
    var self = this, dom = this.dom;
    var path = SFP.twin.model.pathOf(this.model, el.id).reverse();
    var crumb = dom.el('div', { class: 'twin-crumb' });
    crumb.appendChild(dom.el('button', { class: 'twin-crumb-link', text: 'Factory',
      onclick: function () { self.camera.fitWorld(true); self.store.select(null, null); } }));
    path.forEach(function (p) {
      crumb.appendChild(dom.el('span', { class: 'twin-crumb-sep', text: '›' }));
      crumb.appendChild(dom.el('button', { class: 'twin-crumb-link', text: p.label,
        onclick: function () {
          self.camera.fitRect(p.rect, true);
          self.store.select('element', p.id);
        } }));
    });
    return crumb;
  };

  /** Floor selector buttons for any element with floors (zone OR subzone). */
  DetailPanel.prototype._floorSelector = function (el) {
    var self = this, dom = this.dom;
    if (!el.floors) { return null; }
    var active = this.store.activeFloor(el);
    return dom.el('div', { class: 'twin-floors' }, el.floors.map(function (f) {
      return dom.el('button', {
        class: 'twin-chip' + (f.id === active ? ' active' : ''),
        text: f.label,
        onclick: function () { self.store.setActiveFloor(el.id, f.id); },
      });
    }));
  };

  DetailPanel.prototype._connectionList = function (elementId) {
    var self = this, dom = this.dom;
    var conns = SFP.twin.model.connectionsFor(this.model, elementId);
    if (!conns.length) { return null; }
    var list = dom.el('div', { class: 'twin-conn-list' },
      [dom.el('div', { class: 'twin-kicker', text: 'Flows (' + conns.length + ')' })]);
    conns.slice(0, 8).forEach(function (c) {
      list.appendChild(dom.el('button', { class: 'twin-conn-row',
        onclick: function () { self.store.select('connection', c.id); } }, [
        dom.el('span', { class: 'twin-swatch',
          style: { background: 'var(--c-' + self._utilToken(c.utility) + ')' } }),
        dom.el('span', { class: 'twin-conn-label', text: c.label }),
        dom.el('b', { text: self.data.noData(c.binding) ? '—' : self._valueText(c.binding, c.unit) }),
      ]));
    });
    return list;
  };

  DetailPanel.prototype._utilToken = function (utilityId) {
    var utils = SFP.config.get('twin').utilities;
    for (var i = 0; i < utils.length; i++) {
      if (utils[i].id === utilityId) { return utils[i].color; }
    }
    return 'accent';
  };

  DetailPanel.prototype._actions = function (zoneId) {
    var self = this, dom = this.dom;
    return dom.el('div', { class: 'twin-actions' }, [
      /* External nodes have no zone — skip the machines shortcut. */
      !zoneId ? null : dom.el('button', { class: 'btn-action primary',
        onclick: function () { self.nav.navigate('machines', { zone: zoneId }); } },
        [SFP.icons.el('cog', 13), 'View Machines']),
      dom.el('button', { class: 'btn-action',
        onclick: function () { self.nav.navigate('energy', {}); } },
        [SFP.icons.el('zap', 13), 'Energy Report']),
      dom.el('button', { class: 'btn-action',
        onclick: function () { self.nav.navigate('maintenance', {}); } },
        [SFP.icons.el('wrench', 13), 'Maintenance Log']),
    ]);
  };

  /* ── Render dispatch ───────────────────────────────────────────────────── */

  DetailPanel.prototype.render = function () {
    var dom = this.dom, self = this;
    var state = this.store.get();
    dom.clear(this.el);

    /* Edit mode owns selection (properties live in the editor panel) —
     * the viewing detail panel stays out of the way entirely. */
    if (SFP.runtime.editMode) {
      this.el.classList.remove('open');
      return;
    }

    var header = dom.el('div', { class: 'twin-detail-header' }, [
      dom.el('div', { class: 'twin-detail-title', text: 'Details' }),
      dom.el('button', { class: 'twin-btn', title: 'Close',
        onclick: function () { self.store.select(null, null); } }, [SFP.icons.el('x', 13)]),
    ]);

    if (!state.selection) {
      if (SFP.runtime.mode === 'live') {
        this.el.classList.add('open');
        this.el.appendChild(header);
        header.querySelector('.twin-detail-title').textContent = 'Wiring checklist';
        this._renderChecklist();
      } else {
        this.el.classList.remove('open');
      }
      return;
    }

    this.el.classList.add('open');
    this.el.appendChild(header);

    if (state.selection.kind === 'connection') {
      this._renderConnection(state.selection.id);
      return;
    }
    var el = this.model.elements[state.selection.id];
    if (!el) { this.el.classList.remove('open'); return; }
    if (el.kind === 'zone') { this._renderZone(el); }
    else if (el.kind === 'subzone') { this._renderSubzone(el); }
    else { this._renderMachine(el); }
  };

  /* ── Element renderers ─────────────────────────────────────────────────── */

  DetailPanel.prototype._renderZone = function (zone) {
    var dom = this.dom, self = this;
    this.el.appendChild(this._breadcrumb(zone));
    this.el.appendChild(dom.el('div', { class: 'twin-detail-name', text: zone.label }));
    var floors = this._floorSelector(zone);
    if (floors) { this.el.appendChild(floors); }

    if (zone.statusBinding) {
      var def = this.data.hub.def(zone.statusBinding) || {};
      this.el.appendChild(dom.el('div', { class: 'twin-stat' }, [
        dom.el('span', { class: 'twin-kicker', text: def.label || 'Status' }),
        dom.el('b', { text: this._valueText(zone.statusBinding, def.unit) }),
        this._statusChip(zone.statusBinding),
      ]));
    }

    /* Machine fleet breakdown for the zone. */
    var counts = this.machines.counts(zone.id);
    var chips = dom.el('div', { class: 'twin-state-chips' });
    this.states.states('machine').forEach(function (s) {
      if (!counts[s.id]) { return; }
      chips.appendChild(dom.el('span', { class: 'twin-chip' }, [
        dom.el('span', { class: 'twin-swatch', style: { background: 'var(--c-' + s.color + ')' } }),
        s.label + ': ' + counts[s.id],
      ]));
    });
    if (counts.total) {
      this.el.appendChild(dom.el('div', { class: 'twin-kicker', text: counts.total + ' machines' }));
      this.el.appendChild(chips);
    }

    if (zone.hint) {
      this.el.appendChild(dom.el('div', { class: 'twin-hint' }, [
        dom.el('div', { class: 'twin-kicker' }, [SFP.icons.el('info', 11), ' Optimization']),
        dom.el('div', { text: zone.hint }),
      ]));
    }

    var conns = this._connectionList(zone.id);
    if (conns) { this.el.appendChild(conns); }
    this.el.appendChild(this._actions(zone.id));
  };

  DetailPanel.prototype._renderSubzone = function (sub) {
    var dom = this.dom, self = this;
    this.el.appendChild(this._breadcrumb(sub));
    this.el.appendChild(dom.el('div', { class: 'twin-detail-name', text: sub.label }));
    var floors = this._floorSelector(sub);
    if (floors) {
      this.el.appendChild(dom.el('div', { class: 'twin-kicker', text: 'Levels (this subzone has its own floors)' }));
      this.el.appendChild(floors);
    }

    if (sub.machineIds.length) {
      this.el.appendChild(dom.el('div', { class: 'twin-kicker', text: 'Equipment' }));
      sub.machineIds.forEach(function (mid) {
        var m = self.model.elements[mid];
        self.el.appendChild(dom.el('button', { class: 'twin-conn-row',
          onclick: function () { self.store.select('element', mid); } }, [
          dom.el('span', { class: 'twin-conn-label', text: m.label }),
          dom.el('b', { text: m.bindings.value
            ? (self.data.noData(m.bindings.value.datapoint) ? '—'
               : self._valueText(m.bindings.value.datapoint, m.bindings.value.unit)) : '' }),
        ]));
      });
    }

    var conns = this._connectionList(sub.id);
    if (conns) { this.el.appendChild(conns); }
    this.el.appendChild(this._actions(sub.zoneId));
  };

  DetailPanel.prototype._renderMachine = function (m) {
    var dom = this.dom, self = this;
    this.el.appendChild(this._breadcrumb(m));
    this.el.appendChild(dom.el('div', { class: 'twin-detail-name', text: m.label }));
    if (m.sublabel) { this.el.appendChild(dom.el('div', { class: 'twin-kicker', text: m.sublabel })); }

    if (m.bindings.state) {
      var raw = this.data.value(m.bindings.state.datapoint);
      var stateId = raw !== null ? this.states.normalize('machine', raw) : null;
      var stateDef = stateId ? this.states.stateDef('machine', stateId) : null;
      this.el.appendChild(dom.el('div', { class: 'twin-stat' }, [
        dom.el('span', { class: 'twin-kicker', text: 'State' }),
        stateDef
          ? dom.el('span', { class: 'twin-chip' }, [
              dom.el('span', { class: 'twin-swatch', style: { background: 'var(--c-' + stateDef.color + ')' } }),
              stateDef.label])
          : dom.el('b', { text: '—' }),
        this._statusChip(m.bindings.state.datapoint),
      ]));
    }
    if (m.bindings.value) {
      var def = this.data.hub.def(m.bindings.value.datapoint) || {};
      this.el.appendChild(dom.el('div', { class: 'twin-stat' }, [
        dom.el('span', { class: 'twin-kicker', text: def.label || 'Value' }),
        dom.el('b', { text: this._valueText(m.bindings.value.datapoint, m.bindings.value.unit, def.decimals) }),
        this._statusChip(m.bindings.value.datapoint),
      ]));
    }

    var conns = this._connectionList(m.id);
    if (conns) { this.el.appendChild(conns); }
    this.el.appendChild(this._actions(m.zoneId));
  };

  DetailPanel.prototype._renderConnection = function (connId) {
    var dom = this.dom, self = this;
    var conn = null;
    this.model.connections.forEach(function (c) { if (c.id === connId) { conn = c; } });
    if (!conn) { return; }
    var from = this.model.elements[conn.fromId], to = this.model.elements[conn.toId];

    this.el.appendChild(dom.el('div', { class: 'twin-detail-name', text: conn.label }));
    this.el.appendChild(dom.el('div', { class: 'twin-chip' }, [
      dom.el('span', { class: 'twin-swatch',
        style: { background: 'var(--c-' + this._utilToken(conn.utility) + ')' } }),
      conn.utility,
    ]));

    var endpoint = function (label, el) {
      return dom.el('button', { class: 'twin-conn-row',
        onclick: function () {
          self.camera.fitRect(el.rect, true);
          self.store.select('element', el.id);
        } }, [
        dom.el('span', { class: 'twin-kicker', text: label }),
        dom.el('span', { class: 'twin-conn-label', text: el.label }),
      ]);
    };
    this.el.appendChild(endpoint('From', from));
    this.el.appendChild(endpoint('To', to));

    var def = this.data.hub.def(conn.binding) || {};
    this.el.appendChild(dom.el('div', { class: 'twin-stat' }, [
      dom.el('span', { class: 'twin-kicker', text: 'Flow' }),
      dom.el('b', { text: this.data.noData(conn.binding) ? '—'
        : this._valueText(conn.binding, conn.unit, def.decimals) }),
      this._statusChip(conn.binding),
    ]));
    this.el.appendChild(dom.el('div', { class: 'twin-kicker',
      text: 'Range ' + conn.flowRange[0] + '–' + conn.flowRange[1] + ' ' + conn.unit +
        ' · direction: ' + conn.direction }));

    if (conn.rules.length) {
      this.el.appendChild(dom.el('div', { class: 'twin-kicker', text: 'Rules' }));
      conn.rules.forEach(function (rule) {
        self.el.appendChild(dom.el('div', { class: 'twin-rule',
          text: rule.op + ' ' + rule.value + ' → ' +
            (rule.style || '') + (rule.color ? ' ' + rule.color : '') +
            (rule.badge ? ' "' + rule.badge + '"' : '') }));
      });
    }
  };

  /* ── Live-mode wiring checklist (nothing selected) ─────────────────────── */

  DetailPanel.prototype._renderChecklist = function () {
    var dom = this.dom, self = this;
    var c = this.data.coverage();
    this.el.appendChild(dom.el('div', { class: 'twin-kicker',
      text: c.wired + ' of ' + c.total + ' bindings have a real source. ' +
        'Unwired bindings render blank on the canvas — wire them by adding a ' +
        '`source` to the datapoint in config.' }));
    c.items
      .sort(function (a, b) { return (a.wired === b.wired) ? 0 : a.wired ? 1 : -1; })
      .forEach(function (item) {
        self.el.appendChild(dom.el('div', { class: 'twin-conn-row static' }, [
          dom.el('span', { class: 'twin-bind-chip ' + (item.wired ? 'live' : 'unwired'),
            text: item.wired ? 'wired' : 'todo' }),
          dom.el('span', { class: 'twin-conn-label', text: item.datapoint }),
        ]));
      });
  };

  SFP.twin.DetailPanel = DetailPanel;
}(window.SFP));
