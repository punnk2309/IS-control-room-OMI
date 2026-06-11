/* ============================================================================
 * SFP.ui.shell — application shell
 * ----------------------------------------------------------------------------
 * Renders the chrome around dashboards: brand header, system status badge
 * (driven by the alarm engine), data-mode badge (LIVE vs SIMULATION — the
 * operator must always know which one they are looking at), clock, and the
 * page tab bar from config. Owns the lifecycle of the active dashboard.
 * ========================================================================== */
(function (SFP) {
  'use strict';

  var dom = SFP.dom;

  var shell = {
    appCfg: null,
    pageHandle: null,
    els: {},

    init: function (rootEl) {
      this.appCfg = SFP.config.get('app');
      this.root = rootEl;
      this._build();
      this._wire();
    },

    setTitle: function (title) {
      if (this.els.title) { this.els.title.textContent = title; }
    },

    /* ── DOM construction ──────────────────────────────────────────────── */

    _build: function () {
      var cfg = this.appCfg;
      var self = this;

      this.els.title = dom.el('div', { class: 'header-title', text: cfg.title });
      this.els.statusBadge = dom.el('div', { class: 'status-badge ok' }, [
        dom.el('span', { class: 'status-dot' }),
        dom.el('span', { class: 'status-text', text: 'All Systems Operational' }),
      ]);
      this.els.modeBadge = dom.el('button', { class: 'mode-badge', onclick: function () {
        var next = SFP.runtime.mode === 'live' ? 'simulation' : 'live';
        SFP.runtime.mode = next;
        SFP.data.hub.setMode(next);
      } });
      this.els.themeBtn = dom.el('button', { class: 'shell-icon-btn', onclick: function () {
        SFP.ui.theme.toggle();
      } });
      /* Edit mode (visual config editor): on the Factory Map page this
       * toggles the twin's layout editor; on every other page it opens the
       * dashboard editor overlay for that page. */
      this.els.editBtn = dom.el('button', {
        class: 'shell-icon-btn',
        title: 'Edit page configuration',
        html: SFP.icons.svg('edit', 14),
        onclick: function () { self._onEditClick(); },
      });
      this.els.clockTime = dom.el('div', { class: 'clock-time' });
      this.els.clockDate = dom.el('div', { class: 'clock-date' });
      this.els.tabs = dom.el('nav', { class: 'tab-nav' });
      this.els.main = dom.el('main', { class: 'main-content' });

      cfg.pages.forEach(function (page) {
        var btn = dom.el('button', {
          class: 'tab-btn',
          'data-page': page.id,
          onclick: function () { SFP.ui.nav.navigate(page.id); },
        }, [SFP.icons.el(page.icon, 13), page.label]);
        self.els.tabs.appendChild(btn);
      });

      var header = dom.el('header', { class: 'header' }, [
        dom.el('div', { class: 'header-top' }, [
          dom.el('div', { class: 'header-brand' }, [
            dom.el('div', { class: 'header-logo', html: SFP.icons.svg(cfg.icon || 'factory', 20) }),
            dom.el('div', {}, [
              this.els.title,
              dom.el('div', { class: 'header-subtitle', text: cfg.subtitle || '' }),
            ]),
          ]),
          dom.el('div', { class: 'header-right' }, [
            this.els.statusBadge,
            dom.el('div', { class: 'shell-controls' }, [
              this.els.modeBadge,
              this.els.themeBtn,
              this.els.editBtn,
            ]),
            dom.el('div', { class: 'clock-block' }, [this.els.clockDate, this.els.clockTime]),
          ]),
        ]),
        this.els.tabs,
      ]);

      dom.clear(this.root);
      this.root.appendChild(header);
      this.root.appendChild(this.els.main);
    },

    /* ── Behaviour ─────────────────────────────────────────────────────── */

    _wire: function () {
      var self = this;

      SFP.bus.on('nav:changed', function (e) { self._renderPage(e.page, e.params); });

      SFP.bus.on('alarm:summary', function (summary) { self._updateStatus(summary); });

      SFP.bus.on('data:modeChanged', function (e) { self._updateModeBadge(e.mode); });

      SFP.bus.on('theme:changed', function () {
        self._updateThemeBtn();
        /* Charts capture colors at creation; rebuild the page on theme switch. */
        var current = SFP.ui.nav.current();
        if (current.page) { self._renderPage(current.page, current.params); }
      });

      SFP.bus.on('app:resize', function () {
        if (self.pageHandle) { self.pageHandle.resize(); }
      });

      window.addEventListener('resize', function () {
        if (self.pageHandle) { self.pageHandle.resize(); }
      });

      var tick = function () {
        var now = new Date();
        self.els.clockTime.textContent = SFP.format.clock(now);
        self.els.clockDate.textContent = SFP.format.clockDate(now);
      };
      tick();
      setInterval(tick, 1000);

      this._updateModeBadge(SFP.runtime.mode);
      this._updateThemeBtn();
    },

    _renderPage: function (pageId, params) {
      var page = null;
      this.appCfg.pages.forEach(function (p) { if (p.id === pageId) { page = p; } });
      if (!page) {
        console.error('[SFP.shell] Unknown page "' + pageId + '"');
        return;
      }

      Array.prototype.forEach.call(
        this.els.tabs.querySelectorAll('.tab-btn'),
        function (btn) {
          btn.classList.toggle('active', btn.getAttribute('data-page') === pageId);
        }
      );

      if (this.pageHandle) { this.pageHandle.destroy(); }
      this.pageHandle = SFP.ui.dashboards.render(this.els.main, page.dashboard, params);
      this.els.main.className = 'main-content page-' + pageId;
    },

    _updateStatus: function (summary) {
      var badge = this.els.statusBadge;
      var text = badge.querySelector('.status-text');
      badge.classList.remove('ok', 'warn', 'alarm');
      if (!summary.active) {
        badge.classList.add('ok');
        text.textContent = 'All Systems Operational';
      } else if (summary.counts.Critical || summary.counts.High) {
        badge.classList.add('alarm');
        text.textContent = summary.active + ' Active Alarm' + (summary.active > 1 ? 's' : '');
      } else {
        badge.classList.add('warn');
        text.textContent = summary.active + ' Active Warning' + (summary.active > 1 ? 's' : '');
      }
    },

    _onEditClick: function () {
      var current = SFP.ui.nav.current();
      var page = this.appCfg.pages.filter(function (p) { return p.id === current.page; })[0];
      if (!page) { return; }
      if (page.dashboard === 'factory-map') {
        SFP.runtime.editMode = !SFP.runtime.editMode;
        SFP.bus.emit('edit:modeChanged', { on: SFP.runtime.editMode });
        this.els.editBtn.classList.toggle('active', SFP.runtime.editMode);
      } else if (SFP.ui.dashEditor) {
        SFP.ui.dashEditor.open(page.dashboard);
      }
    },

    _updateModeBadge: function (mode) {
      var badge = this.els.modeBadge;
      badge.classList.toggle('live', mode === 'live');
      badge.classList.toggle('sim', mode !== 'live');
      badge.textContent = mode === 'live' ? 'LIVE' : 'SIMULATION';
      badge.title = mode === 'live'
        ? 'Receiving live data from the OMI host - click to switch to simulation'
        : 'Showing simulated demonstration data - click to switch to live';
    },

    _updateThemeBtn: function () {
      var dark = SFP.ui.theme.currentId() !== 'light';
      this.els.themeBtn.innerHTML = SFP.icons.svg(dark ? 'sun' : 'moon', 14);
      this.els.themeBtn.title = dark ? 'Switch to light mode' : 'Switch to dark mode';
    },
  };

  SFP.ui.shell = shell;
}(window.SFP));
