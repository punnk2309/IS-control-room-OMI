/* ============================================================================
 * SFP.ui.editSession — unified edit-mode top bar + adapter contract
 * ----------------------------------------------------------------------------
 * Owns the ONE edit top bar that appears for all pages while SFP.runtime.editMode
 * is true.  Individual editors (layout-editor, twin-editor) register an adapter
 * object conforming to the contract below.  editSession picks the right adapter
 * based on the current page and rebuilds the bar buttons accordingly.
 *
 * Adapter contract (all methods synchronous):
 *   {
 *     id:          string,           // human label shown in bar ("Layout edit - overview")
 *     canUndo:     function()→bool,
 *     canRedo:     function()→bool,
 *     undo:        function(),
 *     redo:        function(),
 *     dirty:       function()→bool,
 *     save:        function()→bool,  // true = persisted ok; false = error
 *     export:      function(),       // download config JS
 *     onExit:      function(discard:bool), // called when edit mode is torn down
 *     addWidget:   function()|undefined,   // optional — "Add widget" button shown iff present
 *   }
 *
 * Bar layout (left→right):
 *   [page label] [dirty dot] [Undo] [Redo] [Add widget — only if adapter.addWidget]
 *   [Save] [Export]
 *
 * There is NO Exit button in the bar.  The pencil button in the shell header
 * is the sole enter/exit control.  On exit-while-dirty: Save / Discard / Cancel
 * dialog is shown.
 *
 * Registration:
 *   SFP.ui.editSession.registerAdapter(pageTest, adapterFactory)
 *     pageTest(pageId) -> bool     — returns true when this adapter handles the page
 *     adapterFactory(pageId) -> adapter  — called on activation; may return null to skip
 *
 * Lifecycle:
 *   editSession listens to edit:modeChanged and nav:changed.
 *   On edit:modeChanged { on:true }  → activate(currentPage)
 *   On edit:modeChanged { on:false } → requestExit()
 *   On nav:changed while editing    → swapAdapter(newPage) (keeps edit mode on)
 * ========================================================================== */
(function (SFP) {
  'use strict';

  var el = SFP.dom.el;

  /* ── module state ─────────────────────────────────────────────────────── */

  var _active   = false;
  var _adapter  = null;   /* current adapter object */
  var _barEl    = null;   /* top-bar DOM element */
  var _pageId   = null;

  /* Registry: array of { test:fn, factory:fn } */
  var _registry = [];

  /* ── helpers ──────────────────────────────────────────────────────────── */

  function _pickAdapter(pageId) {
    for (var i = 0; i < _registry.length; i++) {
      var entry = _registry[i];
      if (entry.test(pageId)) {
        var adapter = entry.factory(pageId);
        if (adapter) { return adapter; }
      }
    }
    return null;
  }

  /* ── bar construction ─────────────────────────────────────────────────── */

  function _buildBar(adapter) {
    var dirtyEl = el('span', { class: 'le-dirty-indicator' });

    var undoBtn = el('button', { class: 'twin-banner-btn', text: 'Undo',
      title: 'Undo (Ctrl+Z)', disabled: true,
      onclick: function () { if (_adapter) { _adapter.undo(); _refreshBar(); } } });

    var redoBtn = el('button', { class: 'twin-banner-btn', text: 'Redo',
      title: 'Redo (Ctrl+Y)', disabled: true,
      onclick: function () { if (_adapter) { _adapter.redo(); _refreshBar(); } } });

    var saveBtn = el('button', { class: 'twin-banner-btn primary', text: 'Save',
      title: 'Persist changes to localStorage', disabled: true,
      onclick: function () { _doSave(); } });

    var exportBtn = el('button', { class: 'twin-banner-btn', text: 'Export',
      title: 'Download config .js file',
      onclick: function () { if (_adapter) { _adapter.export(); } } });

    var children = [
      el('span', { class: 'le-bar-label', text: adapter.id }),
      dirtyEl,
      undoBtn,
      redoBtn,
    ];

    var addBtn = null;
    if (adapter.addWidget) {
      addBtn = el('button', { class: 'twin-banner-btn', text: '+ Add widget',
        onclick: function () { if (_adapter && _adapter.addWidget) { _adapter.addWidget(); } } });
      children.push(addBtn);
    }

    children.push(saveBtn);
    children.push(exportBtn);

    var bar = el('div', { class: 'le-top-bar' }, children);
    bar._refs = { dirty: dirtyEl, undo: undoBtn, redo: redoBtn, save: saveBtn };
    return bar;
  }

  function _refreshBar() {
    if (!_barEl || !_barEl._refs || !_adapter) { return; }
    var refs = _barEl._refs;
    var dirty = _adapter.dirty();
    refs.dirty.textContent = dirty ? '● unsaved' : '';
    refs.dirty.className = 'le-dirty-indicator' + (dirty ? ' dirty' : '');
    refs.undo.disabled = !_adapter.canUndo();
    refs.redo.disabled = !_adapter.canRedo();
    refs.save.disabled = !dirty;
  }

  /* ── save helper ─────────────────────────────────────────────────────── */

  function _doSave() {
    if (!_adapter) { return false; }
    var ok = _adapter.save();
    if (ok === false) {
      if (_barEl && _barEl._refs) {
        var refs = _barEl._refs;
        refs.dirty.textContent = 'Save failed — storage refused or full';
        refs.dirty.className = 'le-dirty-indicator dirty';
      }
      return false;
    }
    _refreshBar();
    return true;
  }

  /* ── exit confirm dialog ─────────────────────────────────────────────── */

  function _showExitDialog(onSave, onDiscard, onCancel) {
    var backdrop = el('div', { class: 'le-confirm-backdrop' });
    var panel = el('div', { class: 'le-confirm-panel' }, [
      el('div', { class: 'le-confirm-title', text: 'Exit edit mode?' }),
      el('div', { class: 'le-confirm-body', text: 'You have unsaved changes. Save before exiting, discard them, or stay in edit mode.' }),
      el('div', { class: 'le-confirm-actions' }, [
        el('button', { class: 'ded-btn primary', text: 'Save & exit',
          onclick: function () {
            if (backdrop.parentNode) { backdrop.parentNode.removeChild(backdrop); }
            onSave();
          } }),
        el('button', { class: 'ded-btn', text: 'Discard & exit',
          onclick: function () {
            if (backdrop.parentNode) { backdrop.parentNode.removeChild(backdrop); }
            onDiscard();
          } }),
        el('button', { class: 'ded-btn', text: 'Cancel',
          onclick: function () {
            if (backdrop.parentNode) { backdrop.parentNode.removeChild(backdrop); }
            onCancel();
          } }),
      ]),
    ]);
    backdrop.appendChild(panel);
    document.body.appendChild(backdrop);
  }

  /* ── activate / deactivate / swap ─────────────────────────────────────── */

  function _insertBar(adapter) {
    _barEl = _buildBar(adapter);
    var mainEl = document.querySelector('.main-content');
    if (mainEl && mainEl.parentNode) {
      mainEl.parentNode.insertBefore(_barEl, mainEl);
    } else {
      document.getElementById('app').appendChild(_barEl);
    }
    if (mainEl) { mainEl.classList.add('le-active'); }
  }

  function _removeBar() {
    if (_barEl && _barEl.parentNode) {
      _barEl.parentNode.removeChild(_barEl);
    }
    _barEl = null;
    var mainEl = document.querySelector('.main-content');
    if (mainEl) { mainEl.classList.remove('le-active'); }
  }

  function _activate(pageId) {
    if (_active) { return; }
    var adapter = _pickAdapter(pageId);
    if (!adapter) { return; }

    _active  = true;
    _pageId  = pageId;
    _adapter = adapter;

    _insertBar(adapter);
    _refreshBar();
  }

  function _swapAdapter(pageId) {
    if (!_active) { return; }
    var newAdapter = _pickAdapter(pageId);
    if (!newAdapter) {
      /* No adapter for this page — remove bar but stay in edit mode so
       * returning to an editable page re-installs it. */
      _removeBar();
      if (_adapter && _adapter.onExit) { _adapter.onExit(false); }
      _adapter = null;
      _pageId  = pageId;
      return;
    }

    /* Suspend the old adapter (non-discard: keep current in-memory state). */
    if (_adapter && _adapter.onExit) {
      _adapter.onExit(false);
    }

    _removeBar();
    _pageId  = pageId;
    _adapter = newAdapter;
    _insertBar(newAdapter);
    _refreshBar();
  }

  /**
   * requestExit — called by the pencil when toggling off edit mode.
   * If adapter is dirty: show Save/Discard/Cancel dialog.
   * Otherwise: exit immediately.
   * onConfirmed(discard) is called when the exit proceeds.
   */
  function _requestExit() {
    if (!_active) { return; }
    if (_adapter && _adapter.dirty()) {
      /* Re-enable pencil visually only when user makes a choice. */
      _showExitDialog(
        /* onSave */ function () {
          var ok = _doSave();
          if (ok === false) {
            /* Save failed — stay in edit mode, restore pencil active state. */
            SFP.runtime.editMode = true;
            if (SFP.ui.shell && SFP.ui.shell.els && SFP.ui.shell.els.editBtn) {
              SFP.ui.shell.els.editBtn.classList.add('active');
            }
            return;
          }
          _doExit(false);
        },
        /* onDiscard */ function () { _doExit(true); },
        /* onCancel */ function () {
          /* Re-enable edit mode since user cancelled. */
          SFP.runtime.editMode = true;
          if (SFP.ui.shell && SFP.ui.shell.els && SFP.ui.shell.els.editBtn) {
            SFP.ui.shell.els.editBtn.classList.add('active');
          }
        }
      );
    } else {
      _doExit(false);
    }
  }

  function _doExit(discard) {
    if (!_active) { return; }
    _active = false;

    if (_adapter && _adapter.onExit) { _adapter.onExit(discard); }
    _adapter = null;

    _removeBar();
    _pageId = null;

    /* Make sure editMode is off. */
    SFP.runtime.editMode = false;
    SFP.bus.emit('edit:modeChanged', { on: false, _fromSession: true });
  }

  /* ── keyboard shortcuts ──────────────────────────────────────────────── */

  document.addEventListener('keydown', function (e) {
    if (!_active || !_adapter) { return; }
    var tag = document.activeElement ? document.activeElement.tagName : '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') { return; }
    if (e.key === 'z' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      _adapter.undo();
      _refreshBar();
    } else if (e.key === 'y' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      _adapter.redo();
      _refreshBar();
    }
  });

  /* ── bus wiring ──────────────────────────────────────────────────────── */

  SFP.bus.on('edit:modeChanged', function (e) {
    /* Ignore events fired by _doExit itself to avoid re-entry. */
    if (e._fromSession) { return; }
    if (e.on) {
      var cur = SFP.ui.nav.current();
      if (cur && cur.page) { _activate(cur.page); }
    } else {
      _requestExit();
    }
  });

  SFP.bus.on('nav:changed', function (e) {
    if (!_active) { return; }
    if (e.page === _pageId) { return; }
    _swapAdapter(e.page);
  });

  /* ── public API ──────────────────────────────────────────────────────── */

  SFP.ui.editSession = {
    /**
     * registerAdapter(test, factory)
     * test(pageId)→bool — returns true when this adapter handles the page
     * factory(pageId)→adapter  — creates and returns the adapter, or null to skip
     */
    registerAdapter: function (test, factory) {
      _registry.push({ test: test, factory: factory });
    },

    /** Notify the session that the current adapter's state changed
     * (e.g. after an undo/redo from within the adapter). */
    refresh: function () { _refreshBar(); },

    isActive: function () { return _active; },
    currentAdapter: function () { return _adapter; },

    /**
     * _requestExit() — exposed so the shell pencil button can delegate the
     * exit flow to editSession when an adapter is active.  editSession then
     * shows the Save/Discard/Cancel dialog if dirty and only flips
     * SFP.runtime.editMode after the user confirms (or there is nothing dirty).
     */
    _requestExit: function () { _requestExit(); },

    /**
     * adapterReady(adapter) — called by a page widget after it has created its
     * editor and set _currentEditor, when SFP.runtime.editMode is already true.
     * This installs the bar that _swapAdapter may have removed because the
     * widget was not yet alive when nav:changed fired.
     */
    adapterReady: function (adapter) {
      if (!_active || _adapter) { return; }
      /* Session is active but had no adapter for this page (widget loaded late). */
      _adapter = adapter;
      _insertBar(adapter);
      _refreshBar();
    },
  };

}(window.SFP));
