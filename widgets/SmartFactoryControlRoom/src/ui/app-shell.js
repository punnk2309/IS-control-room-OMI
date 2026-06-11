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
      this.els.modeBadge = dom.el('div', { class: 'mode-badge' });
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
            this.els.modeBadge,
            this.els.statusBadge,
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

    _updateModeBadge: function (mode) {
      var badge = this.els.modeBadge;
      badge.classList.toggle('live', mode === 'live');
      badge.classList.toggle('sim', mode !== 'live');
      badge.textContent = mode === 'live' ? 'LIVE' : 'SIMULATION';
      badge.title = mode === 'live'
        ? 'Receiving live data from the OMI host'
        : 'Showing simulated demonstration data';
    },
  };

  SFP.ui.shell = shell;
}(window.SFP));
