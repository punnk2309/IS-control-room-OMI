/* ============================================================================
 * SFP.twin.Toolbar — fixed UI chrome over the twin canvas
 * ----------------------------------------------------------------------------
 * Builds the toolbar (top-left), the dynamic legend (bottom-left) and the
 * filter panel. Contents:
 *
 *   zoom in / out / fit-to-view
 *   search box with results dropdown (zones, subzones, machines, connections)
 *   filter panel toggle  — per-utility visibility + dim/hide mode
 *   legend + minimap toggles
 *   SIMULATION / LIVE badge — single-click data-source mode switch
 *   wiring coverage chip  — live mode only: how many bindings have real
 *                           sources ("the implementation checklist counter")
 *   theme toggle (sun/moon) — instant light/dark switch, persisted
 *
 * All chrome is plain DOM styled by styles/twin.css through theme CSS
 * variables — nothing here hardcodes a color.
 * ========================================================================== */
(function (SFP) {
  'use strict';

  SFP.twin = SFP.twin || {};

  function Toolbar(deps) {
    this.root = deps.root;             // twin container element
    this.model = deps.model;
    this.camera = deps.camera;
    this.store = deps.store;
    this.data = deps.data;
    this.onBus = deps.onBus;           // auto-released bus subscribe (ctx.onBus)
    this.dom = SFP.dom;
    this.els = {};
    this._build();
    this._wire();
  }

  /** Reveal an element: activate every floor on its ancestor path. */
  Toolbar.prototype._reveal = function (el) {
    var self = this;
    el.gates.forEach(function (g) { self.store.setActiveFloor(g.owner, g.floor); });
  };

  /* ── DOM ───────────────────────────────────────────────────────────────── */

  Toolbar.prototype._build = function () {
    var dom = this.dom, self = this;

    function iconBtn(icon, title, onclick) {
      return dom.el('button', { class: 'twin-btn', title: title, onclick: onclick },
        [SFP.icons.el(icon, 14)]);
    }

    /* Search */
    this.els.searchInput = dom.el('input', {
      class: 'twin-search-input', type: 'text', placeholder: 'Search zones, machines, flows…',
      value: this.store.get().searchQuery,
      oninput: function (e) { self._search(e.target.value); },
      onkeydown: function (e) {
        if (e.key === 'Enter') { self._pickFirstResult(); }
        if (e.key === 'Escape') { self._search(''); e.target.value = ''; }
      },
    });
    this.els.searchResults = dom.el('div', { class: 'twin-search-results' });
    var search = dom.el('div', { class: 'twin-search' }, [
      SFP.icons.el('search', 13), this.els.searchInput, this.els.searchResults,
    ]);

    /* Mode badge + coverage chip */
    this.els.modeBadge = dom.el('button', { class: 'twin-mode-badge', onclick: function () {
      var next = SFP.runtime.mode === 'live' ? 'simulation' : 'live';
      SFP.runtime.mode = next;
      SFP.data.hub.setMode(next);          // emits data:modeChanged
    } });
    this.els.coverage = dom.el('span', { class: 'twin-coverage', style: { display: 'none' } });

    /* Theme toggle */
    this.els.themeBtn = dom.el('button', { class: 'twin-btn', onclick: function () {
      SFP.ui.theme.toggle();               // shell rebuilds the page
    } });

    this.els.toolbar = dom.el('div', { class: 'twin-toolbar' }, [
      iconBtn('plus', 'Zoom in', function () {
        self.camera.zoomAt({ x: self.camera.viewW / 2, y: self.camera.viewH / 2 },
          SFP.config.get('twin').camera.zoomStep);
      }),
      iconBtn('minus', 'Zoom out', function () {
        self.camera.zoomAt({ x: self.camera.viewW / 2, y: self.camera.viewH / 2 },
          1 / SFP.config.get('twin').camera.zoomStep);
      }),
      iconBtn('maximize', 'Zoom to fit', function () { self.camera.fitWorld(true); }),
      dom.el('span', { class: 'twin-sep' }),
      search,
      dom.el('span', { class: 'twin-sep' }),
      iconBtn('filter', 'Utility filters', function () {
        self.store.set({ filterPanelOpen: !self.store.get().filterPanelOpen });
      }),
      iconBtn('list', 'Toggle legend', function () {
        self.store.set({ legendVisible: !self.store.get().legendVisible });
      }),
      iconBtn('map', 'Toggle minimap', function () {
        self.store.set({ minimapVisible: !self.store.get().minimapVisible });
      }),
      dom.el('span', { class: 'twin-sep' }),
      this.els.modeBadge,
      this.els.coverage,
      this.els.themeBtn,
    ]);

    this.els.filterPanel = dom.el('div', { class: 'twin-filter-panel' });
    this.els.legend = dom.el('div', { class: 'twin-legend' });

    this.root.appendChild(this.els.toolbar);
    this.root.appendChild(this.els.filterPanel);
    this.root.appendChild(this.els.legend);

    this._renderModeBadge();
    this._renderThemeBtn();
    this._renderFilterPanel();
    this._renderLegend();
  };

  /* ── Behaviour ─────────────────────────────────────────────────────────── */

  Toolbar.prototype._wire = function () {
    var self = this;
    this.onBus('data:modeChanged', function () { self._renderModeBadge(); });
    this.unsubStore = this.store.on(function (changed) {
      if (changed.indexOf('filters') >= 0 || changed.indexOf('filterMode') >= 0 ||
          changed.indexOf('filterPanelOpen') >= 0) {
        self._renderFilterPanel();
        self._renderLegend();
      }
      if (changed.indexOf('legendVisible') >= 0) { self._renderLegend(); }
    });
  };

  Toolbar.prototype.destroy = function () {
    if (this.unsubStore) { this.unsubStore(); }
  };

  Toolbar.prototype._renderModeBadge = function () {
    var live = SFP.runtime.mode === 'live';
    var badge = this.els.modeBadge;
    badge.classList.toggle('live', live);
    badge.innerHTML = '<span class="twin-mode-dot"></span>' + (live ? 'LIVE' : 'SIMULATION');
    badge.title = live
      ? 'Live data sources. Anything blank still needs a real source wired — click to switch back to simulation.'
      : 'Simulated demonstration data — click to preview Live mode (unwired bindings go blank).';

    var cov = this.els.coverage;
    if (live) {
      var c = this.data.coverage();
      cov.style.display = '';
      cov.textContent = c.wired + '/' + c.total + ' wired';
      cov.title = c.wired + ' of ' + c.total + ' data bindings on this page have a real source configured. ' +
        'The rest render as "no data" — that is the remaining integration work.';
    } else {
      cov.style.display = 'none';
    }
  };

  Toolbar.prototype._renderThemeBtn = function () {
    var dark = SFP.ui.theme.currentId() !== 'light';
    this.els.themeBtn.innerHTML = SFP.icons.svg(dark ? 'sun' : 'moon', 14);
    this.els.themeBtn.title = dark ? 'Switch to light mode' : 'Switch to dark mode';
  };

  /* ── Search ────────────────────────────────────────────────────────────── */

  Toolbar.prototype._search = function (query) {
    var self = this, dom = this.dom;
    this.store.set({ searchQuery: query });
    var box = this.els.searchResults;
    dom.clear(box);
    this._results = SFP.twin.model.search(this.model, query);
    box.style.display = this._results.length ? 'block' : 'none';
    this._results.forEach(function (res) {
      box.appendChild(dom.el('button', {
        class: 'twin-search-item',
        onclick: function () { self._goTo(res); },
      }, [
        dom.el('span', { class: 'twin-search-kind', text: res.type }),
        res.label,
      ]));
    });
  };

  Toolbar.prototype._pickFirstResult = function () {
    if (this._results && this._results.length) { this._goTo(this._results[0]); }
  };

  Toolbar.prototype._goTo = function (res) {
    this.els.searchResults.style.display = 'none';
    this.els.searchInput.value = '';
    this.store.set({ searchQuery: '' });

    if (res.kind === 'element') {
      var el = this.model.elements[res.id];
      this._reveal(el);
      var pad = Math.max(el.rect.w, el.rect.h);
      this.camera.fitRect({ x: el.rect.x - pad / 2, y: el.rect.y - pad / 2,
        w: el.rect.w + pad, h: el.rect.h + pad }, true);
      this.store.select('element', el.id);
    } else {
      var conn = null;
      this.model.connections.forEach(function (c) { if (c.id === res.id) { conn = c; } });
      if (!conn) { return; }
      var a = this.model.elements[conn.fromId].rect, b = this.model.elements[conn.toId].rect;
      this._reveal(this.model.elements[conn.fromId]);
      this._reveal(this.model.elements[conn.toId]);
      var x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y);
      this.camera.fitRect({ x: x0, y: y0,
        w: Math.max(a.x + a.w, b.x + b.w) - x0, h: Math.max(a.y + a.h, b.y + b.h) - y0 }, true);
      this.store.select('connection', conn.id);
    }
  };

  /* ── Filter panel + legend ─────────────────────────────────────────────── */

  Toolbar.prototype._renderFilterPanel = function () {
    var dom = this.dom, self = this;
    var panel = this.els.filterPanel;
    var state = this.store.get();
    panel.style.display = state.filterPanelOpen ? 'block' : 'none';
    if (!state.filterPanelOpen) { return; }

    dom.clear(panel);
    panel.appendChild(dom.el('div', { class: 'twin-panel-title', text: 'Utility layers' }));

    SFP.config.get('twin').utilities.forEach(function (u) {
      var on = self.store.utilityOn(u.id);
      panel.appendChild(dom.el('label', { class: 'twin-filter-row' + (on ? '' : ' off') }, [
        dom.el('input', { type: 'checkbox', onchange: function () { self.store.toggleUtility(u.id); } },
          []),
        dom.el('span', { class: 'twin-swatch', style: { background: 'var(--c-' + u.color + ')' } }),
        u.label,
      ]));
      panel.lastChild.querySelector('input').checked = on;
    });

    var mode = state.filterMode || SFP.config.get('twin').filters.defaultMode;
    panel.appendChild(dom.el('div', { class: 'twin-filter-mode' }, [
      dom.el('span', { text: 'Filtered-out lines:' }),
      ['dim', 'hide'].map(function (m) {
        return dom.el('button', {
          class: 'twin-chip' + (mode === m ? ' active' : ''),
          text: m === 'dim' ? 'Dim' : 'Hide',
          onclick: function () { self.store.set({ filterMode: m }); },
        });
      }),
    ]));

    panel.appendChild(dom.el('button', {
      class: 'twin-chip', text: 'Show all',
      onclick: function () { self.store.set({ filters: {}, filterMode: null }); },
    }));
  };

  /** Legend reflects only utilities that are currently enabled. */
  Toolbar.prototype._renderLegend = function () {
    var dom = this.dom, self = this;
    var legend = this.els.legend;
    var state = this.store.get();
    legend.style.display = state.legendVisible ? 'flex' : 'none';
    if (!state.legendVisible) { return; }

    dom.clear(legend);
    SFP.config.get('twin').utilities.forEach(function (u) {
      if (!self.store.utilityOn(u.id)) { return; }
      legend.appendChild(dom.el('span', { class: 'twin-legend-item' }, [
        dom.el('span', { class: 'twin-swatch', style: { background: 'var(--c-' + u.color + ')' } }),
        u.label,
      ]));
    });
  };

  SFP.twin.Toolbar = Toolbar;
}(window.SFP));
