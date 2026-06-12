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

    /** Rebuild the tab bar (called after pages are added / removed). */
    _rebuildTabs: function () {
      var self = this;
      dom.clear(this.els.tabs);
      this.appCfg.pages.forEach(function (page) {
        var btn = self._makeTabBtn(page);
        self.els.tabs.appendChild(btn);
      });
      if (SFP.runtime.editMode) {
        self.els.tabs.appendChild(self._makeAddTabBtn());
      }
      /* Re-highlight active tab. */
      var cur = SFP.ui.nav.current();
      if (cur && cur.page) {
        Array.prototype.forEach.call(
          self.els.tabs.querySelectorAll('.tab-btn'),
          function (btn) {
            btn.classList.toggle('active', btn.getAttribute('data-page') === cur.page);
          }
        );
      }
    },

    /** Build a single tab button (with optional edit-mode decorations). */
    _makeTabBtn: function (page) {
      var self = this;
      var btn = dom.el('button', {
        class: 'tab-btn',
        'data-page': page.id,
        onclick: function () { SFP.ui.nav.navigate(page.id); },
      }, [SFP.icons.el(page.icon || 'layout-dashboard', 13),
          dom.el('span', { text: page.label })]);

      /* In edit mode: show × button and right-click to rename for user pages. */
      if (SFP.runtime.editMode) {
        var isUserPage = SFP.config.hasOverride('app') &&
          !self._isBuiltinPage(page.id);

        /* Small × remove button on all non-factory-map tabs in edit mode,
         * but only for user-added pages (those tracked in the app override). */
        if (isUserPage) {
          var removeBtn = dom.el('span', {
            class: 'tab-edit-remove',
            title: 'Delete this page',
            onclick: function (e) {
              e.stopPropagation();
              self._confirmDeletePage(page.id);
            },
          }, [dom.el('span', { text: '×' })]);
          btn.appendChild(removeBtn);

          /* Right-click to rename. */
          btn.addEventListener('contextmenu', function (e) {
            e.preventDefault();
            self._showRenameDialog(page.id);
          });
        }
      }
      return btn;
    },

    /** Returns the "+" add tab button used in edit mode. */
    _makeAddTabBtn: function () {
      var self = this;
      return dom.el('button', {
        class: 'tab-btn tab-add-btn',
        title: 'Add a new dashboard page',
        onclick: function () { self._showAddPageDialog(); },
      }, [SFP.icons.el('plus', 13), dom.el('span', { text: 'New page' })]);
    },

    /** Check whether a page id was NOT added by the user at runtime.
     *  User-added pages are tracked in localStorage under 'sfp.userPageIds'
     *  so the distinction survives reload. */
    _isBuiltinPage: function (pageId) {
      return !this._getUserPageIds()[pageId];
    },

    /** Read the set of user-added page ids from localStorage. */
    _getUserPageIds: function () {
      try {
        var raw = localStorage.getItem('sfp.userPageIds');
        if (raw) { return JSON.parse(raw); }
      } catch (e) { /* ignore */ }
      return {};
    },

    /** Persist a page id as user-added. */
    _markUserPage: function (pageId) {
      var ids = this._getUserPageIds();
      ids[pageId] = true;
      try { localStorage.setItem('sfp.userPageIds', JSON.stringify(ids)); } catch (e) { /* ignore */ }
    },

    /** Remove a page id from the user-added set. */
    _unmarkUserPage: function (pageId) {
      var ids = this._getUserPageIds();
      delete ids[pageId];
      try { localStorage.setItem('sfp.userPageIds', JSON.stringify(ids)); } catch (e) { /* ignore */ }
    },

    /** Prompt user for a new page name (inline dialog, not window.prompt). */
    _showAddPageDialog: function () {
      var self = this;
      var backdrop = dom.el('div', { class: 'le-confirm-backdrop' });
      var input = dom.el('input', {
        class: 'le-name-input',
        type: 'text',
        placeholder: 'Page name (e.g. Quality)',
        style: { width: '100%', marginBottom: '10px' },
      });
      input.setAttribute('maxlength', '40');

      var doAdd = function () {
        var name = input.value.trim();
        if (!name) { return; }
        if (backdrop.parentNode) { backdrop.parentNode.removeChild(backdrop); }
        self._addPage(name);
      };

      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { doAdd(); }
        if (e.key === 'Escape') {
          if (backdrop.parentNode) { backdrop.parentNode.removeChild(backdrop); }
        }
      });

      var panel = dom.el('div', { class: 'le-confirm-panel' }, [
        dom.el('div', { class: 'le-confirm-title', text: 'Add new dashboard page' }),
        input,
        dom.el('div', { class: 'le-confirm-actions' }, [
          dom.el('button', {
            class: 'ded-btn primary',
            text: 'Create page',
            onclick: doAdd,
          }),
          dom.el('button', {
            class: 'ded-btn',
            text: 'Cancel',
            onclick: function () {
              if (backdrop.parentNode) { backdrop.parentNode.removeChild(backdrop); }
            },
          }),
        ]),
      ]);
      backdrop.appendChild(panel);
      backdrop.addEventListener('click', function (e) {
        if (e.target === backdrop) {
          if (backdrop.parentNode) { backdrop.parentNode.removeChild(backdrop); }
        }
      });
      document.body.appendChild(backdrop);
      setTimeout(function () { input.focus(); }, 30);
    },

    /** Rename dialog for a user-added page tab. */
    _showRenameDialog: function (pageId) {
      var self = this;
      var page = null;
      this.appCfg.pages.forEach(function (p) { if (p.id === pageId) { page = p; } });
      if (!page) { return; }

      var backdrop = dom.el('div', { class: 'le-confirm-backdrop' });
      var input = dom.el('input', {
        class: 'le-name-input',
        type: 'text',
        value: page.label,
        style: { width: '100%', marginBottom: '10px' },
      });
      input.setAttribute('maxlength', '40');

      var doRename = function () {
        var name = input.value.trim();
        if (!name) { return; }
        if (backdrop.parentNode) { backdrop.parentNode.removeChild(backdrop); }
        self._renamePage(pageId, name);
      };

      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { doRename(); }
        if (e.key === 'Escape') {
          if (backdrop.parentNode) { backdrop.parentNode.removeChild(backdrop); }
        }
      });

      var panel = dom.el('div', { class: 'le-confirm-panel' }, [
        dom.el('div', { class: 'le-confirm-title', text: 'Rename page' }),
        input,
        dom.el('div', { class: 'le-confirm-actions' }, [
          dom.el('button', {
            class: 'ded-btn primary',
            text: 'Rename',
            onclick: doRename,
          }),
          dom.el('button', {
            class: 'ded-btn',
            text: 'Cancel',
            onclick: function () {
              if (backdrop.parentNode) { backdrop.parentNode.removeChild(backdrop); }
            },
          }),
        ]),
      ]);
      backdrop.appendChild(panel);
      document.body.appendChild(backdrop);
      setTimeout(function () { input.focus(); input.select(); }, 30);
    },

    /** Confirm-then-delete dialog for a user-added page. */
    _confirmDeletePage: function (pageId) {
      var self = this;
      var page = null;
      this.appCfg.pages.forEach(function (p) { if (p.id === pageId) { page = p; } });
      if (!page) { return; }

      var backdrop = dom.el('div', { class: 'le-confirm-backdrop' });
      var panel = dom.el('div', { class: 'le-confirm-panel' }, [
        dom.el('div', { class: 'le-confirm-title', text: 'Delete page "' + page.label + '"?' }),
        dom.el('div', { class: 'le-confirm-body', text: 'This will remove the page and its dashboard config.' }),
        dom.el('div', { class: 'le-confirm-actions' }, [
          dom.el('button', {
            class: 'ded-btn primary',
            text: 'Delete page',
            onclick: function () {
              if (backdrop.parentNode) { backdrop.parentNode.removeChild(backdrop); }
              self._deletePage(pageId);
            },
          }),
          dom.el('button', {
            class: 'ded-btn',
            text: 'Cancel',
            onclick: function () {
              if (backdrop.parentNode) { backdrop.parentNode.removeChild(backdrop); }
            },
          }),
        ]),
      ]);
      backdrop.appendChild(panel);
      document.body.appendChild(backdrop);
    },

    /** Convert a label to a url-safe kebab-case id. */
    _labelToId: function (label) {
      return label.toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'page-' + Date.now();
    },

    /** Create a new user page, persist both app config and empty dashboard. */
    _addPage: function (label) {
      var id = this._labelToId(label);
      /* Ensure uniqueness. */
      var existingIds = {};
      this.appCfg.pages.forEach(function (p) { existingIds[p.id] = true; });
      var base = id;
      var suffix = 2;
      while (existingIds[id]) { id = base + '-' + suffix; suffix++; }

      var newPage = { id: id, label: label, icon: 'layout-dashboard', dashboard: id };
      var newDash = { grid: { columns: 12, gap: 12 }, widgets: [] };

      /* Register the new empty dashboard config in memory. */
      SFP.config.define('dashboard.' + id, newDash);

      /* Add to pages and persist app config. */
      this.appCfg.pages.push(newPage);
      SFP.config.override('app', this.appCfg);

      /* Persist the empty dashboard too. */
      SFP.config.override('dashboard.' + id, newDash);

      /* Track this page as user-added so it gets the × delete button. */
      this._markUserPage(id);

      /* Rebuild tabs and navigate. */
      this._rebuildTabs();
      SFP.ui.nav.navigate(id);
    },

    /** Rename an existing user page. */
    _renamePage: function (pageId, newLabel) {
      this.appCfg.pages.forEach(function (p) {
        if (p.id === pageId) { p.label = newLabel; }
      });
      SFP.config.override('app', this.appCfg);
      this._rebuildTabs();
    },

    /** Delete a user-added page and its dashboard override. */
    _deletePage: function (pageId) {
      /* Remove from pages array. */
      this.appCfg.pages = this.appCfg.pages.filter(function (p) {
        return p.id !== pageId;
      });
      SFP.config.override('app', this.appCfg);

      /* Clear the dashboard override. */
      SFP.config.clearOverride('dashboard.' + pageId);

      /* Remove from user-page tracking. */
      this._unmarkUserPage(pageId);

      /* Rebuild tabs. Navigate away if we were on the deleted page. */
      this._rebuildTabs();
      var cur = SFP.ui.nav.current();
      if (cur && cur.page === pageId) {
        var fallback = this.appCfg.pages[0];
        if (fallback) { SFP.ui.nav.navigate(fallback.id); }
      }
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
       * toggles the twin's layout editor; on every other page it activates
       * the free layout editor (SFP.ui.layoutEditor). */
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
        self.els.tabs.appendChild(self._makeTabBtn(page));
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

      /* Rebuild tab bar when edit mode toggles (add/remove "+" tab and
       * per-tab edit decorations).  Also keep the pencil button in sync so
       * that exits driven by editSession (Save/Discard after dialog) correctly
       * clear the active highlight. */
      SFP.bus.on('edit:modeChanged', function (e) {
        self._rebuildTabs();
        if (self.els.editBtn) {
          self.els.editBtn.classList.toggle('active', !!SFP.runtime.editMode);
        }
      });

      /* Show/hide the pencil edit button whenever the canEdit permission changes. */
      SFP.bus.on('runtime:canEditChanged', function () {
        self._updateEditBtn();
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
      this._updateEditBtn();
    },

    /** Hide the pencil button when the user does not have edit permission. */
    _updateEditBtn: function () {
      if (!this.els.editBtn) { return; }
      this.els.editBtn.style.display = SFP.runtime.canEdit ? '' : 'none';
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

      /* When the layout editor is active for this page it owns the render
       * cycle — let it handle the page render via its own _rerender().
       * We still destroy the previous pageHandle to avoid leaks.
       * Check both the legacy layoutEditor flag and the new editSession. */
      var editorActive = (SFP.ui.layoutEditor && SFP.ui.layoutEditor.isActive()) ||
        (SFP.ui.editSession && SFP.ui.editSession.isActive() &&
         SFP.ui.editSession.currentAdapter() &&
         SFP.ui.editSession.currentAdapter().id &&
         SFP.ui.editSession.currentAdapter().id.indexOf('Layout edit') === 0);
      if (editorActive) {
        if (this.pageHandle) {
          try { this.pageHandle.destroy(); } catch (e) { /* ignore */ }
          this.pageHandle = null;
        }
        this.els.main.className = 'main-content page-' + pageId + ' le-active';
        return;
      }

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
      /* Belt-and-braces: block entry if permission was revoked between the
       * button hide and a potential race or programmatic call. */
      if (!SFP.runtime.canEdit) {
        console.warn('[SFP.shell] Edit mode blocked — canEdit is false.');
        return;
      }
      var current = SFP.ui.nav.current();
      var page = this.appCfg.pages.filter(function (p) { return p.id === current.page; })[0];
      if (!page) { return; }

      if (!SFP.runtime.editMode) {
        /* Entering edit mode — flip flag, update button, notify. */
        SFP.runtime.editMode = true;
        this.els.editBtn.classList.add('active');
        SFP.bus.emit('edit:modeChanged', { on: true });
      } else {
        /* Exiting edit mode.
         * When an editSession adapter is active let editSession drive the
         * exit (it shows the Save/Discard/Cancel dialog if dirty, and only
         * flips editMode + fires the event after the user confirms).
         * Only perform the direct flip when NO editSession adapter is live
         * (e.g. a page that has no registered adapter). */
        if (SFP.ui.editSession && SFP.ui.editSession.isActive()) {
          /* editSession.requestExit() is internal; trigger it via the
           * event bus with the same payload the session already listens for,
           * but mark it NOT _fromSession so it IS processed. */
          SFP.ui.editSession._requestExit();
        } else {
          /* No active editSession — do the direct flip as before. */
          SFP.runtime.editMode = false;
          this.els.editBtn.classList.remove('active');
          SFP.bus.emit('edit:modeChanged', { on: false });
        }
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
