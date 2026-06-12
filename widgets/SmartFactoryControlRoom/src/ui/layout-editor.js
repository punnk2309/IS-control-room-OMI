/* ============================================================================
 * SFP.ui.layoutEditor — free-layout editor for non-factory-map dashboards
 * ----------------------------------------------------------------------------
 * Activated when SFP.runtime.editMode is true and the current page is NOT the
 * factory-map (detected by checking whether the dashboard config contains a
 * 'factory-twin' widget).
 *
 * Feature set
 *   - Top bar (same visual pattern / classes as the twin editor's banner):
 *     Undo, Redo, Add widget, Save, Export, Exit edit.
 *   - Every widget cell gets a per-cell hover toolbar: gear (opens the
 *     existing SFP.ui.dashEditor modal scoped to that page), duplicate, remove.
 *   - Drag to reorder: mousedown on the drag-handle pill → ghost preview →
 *     drop reorders widget array position.
 *   - Resize via bottom-right handle: horizontal = span (1..columns), vertical
 *     = minH (snaps every SNAP_H px).
 *   - Add widget → picker dialog → inserts default widget and opens settings.
 *   - Undo / Redo stack: deep-clone snapshot before each mutation, 50 deep.
 *     Ctrl+Z / Ctrl+Y while editing.
 *   - Dirty flag. Save → SFP.config.override. Export → downloadConfigJs.
 *     Exit prompts if dirty.
 *   - Re-renders via SFP.ui.dashboards.render after each mutation.
 *
 * Note on mousemove/mouseup:
 *   Global drag and resize handlers live on `document` and are registered ONCE
 *   at module load, not per-cell. Cell-specific context is captured in module
 *   variables (_drag, _resize) so re-rendering never duplicates listeners.
 * ========================================================================== */
(function (SFP) {
  'use strict';

  var el = SFP.dom.el;

  var UNDO_CAP    = 50;
  var SNAP_H      = 20;   /* px snap for vertical resize (minH) */
  var DEFAULT_SPAN = 3;
  var DEFAULT_MINH = 110;

  /* ── module-level state ─────────────────────────────────────────────────── */

  var _active  = false;
  var _pageId  = null;   /* current dashboard id (no 'dashboard.' prefix) */
  var _cfg     = null;   /* deep-clone working copy */
  var _columns = 12;
  var _session = null;   /* { undo:[], redo:[], dirty:false } */
  var _handle  = null;   /* SFP.ui.dashboards render handle */
  var _barEl   = null;   /* top-bar DOM element */
  var _onKey   = null;

  /* ── drag state (module-level so mousemove/mouseup are registered once) ── */
  var _drag = null;
  /*  { srcIdx: int, ghost: el, startX, startY, cell: el } */

  /* ── resize state ─────────────────────────────────────────────────────── */
  var _resize = null;
  /*  { widgetIdx: int, startX, startY, origSpan, origMinH } */

  /* ── helpers ────────────────────────────────────────────────────────────── */

  function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function isFactoryMap(dashboardId) {
    if (dashboardId === 'factory-map') { return true; }
    try {
      var cfg = SFP.config.get('dashboard.' + dashboardId);
      var widgets = cfg.widgets || [];
      for (var i = 0; i < widgets.length; i++) {
        if (widgets[i].type === 'factory-twin') { return true; }
      }
    } catch (e) { /* ignore */ }
    return false;
  }

  /* ── undo / redo ────────────────────────────────────────────────────────── */

  function pushUndo() {
    if (!_session) { return; }
    _session.undo.push(deepClone(_cfg));
    if (_session.undo.length > UNDO_CAP) { _session.undo.shift(); }
    _session.redo = [];
    _session.dirty = true;
    _refreshBar();
  }

  function doUndo() {
    if (!_session || !_session.undo.length) { return; }
    _session.redo.push(deepClone(_cfg));
    if (_session.redo.length > UNDO_CAP) { _session.redo.shift(); }
    _cfg = _session.undo.pop();
    _session.dirty = _session.undo.length > 0;
    _rerender();
    _refreshBar();
  }

  function doRedo() {
    if (!_session || !_session.redo.length) { return; }
    _session.undo.push(deepClone(_cfg));
    if (_session.undo.length > UNDO_CAP) { _session.undo.shift(); }
    _cfg = _session.redo.pop();
    _session.dirty = true;
    _rerender();
    _refreshBar();
  }

  /* ── mutation helper ─────────────────────────────────────────────────────── */

  function mutate(fn) {
    pushUndo();
    fn();
    _rerender();
  }

  /* ── render ─────────────────────────────────────────────────────────────── */

  function _rerender() {
    if (!_active || !_pageId) { return; }
    var container = document.querySelector('.main-content');
    if (!container) { return; }

    if (_handle) {
      try { _handle.destroy(); } catch (e) { /* ignore */ }
      _handle = null;
    }

    /* Apply working copy to in-memory registry. */
    SFP.config.define('dashboard.' + _pageId, _cfg);

    _handle = SFP.ui.dashboards.render(
      container, _pageId, SFP.ui.nav.current().params);
    _columns = (_cfg.grid && _cfg.grid.columns) || 12;

    _overlayEditChrome(container);
  }

  /* ── edit chrome overlay ─────────────────────────────────────────────────
   * Inject per-cell toolbar, drag handle, and resize handle into every
   * .dash-cell in the rendered grid.  Must be called after _rerender.
   */

  function _overlayEditChrome(container) {
    var grid = container.querySelector('.dash-grid');
    if (!grid) { return; }
    grid.classList.add('le-grid-edit');

    var cells = grid.querySelectorAll('.dash-cell');
    var cellArr = Array.prototype.slice.call(cells);

    cellArr.forEach(function (cell, idx) {
      cell.classList.add('le-cell-edit');
      cell.setAttribute('data-le-idx', String(idx));

      /* per-cell toolbar */
      var toolbar = el('div', { class: 'le-cell-toolbar' }, [
        _makeCellBtn('settings', 'Widget settings', function () {
          _openWidgetSettings();
        }),
        _makeCellBtn('copy', 'Duplicate widget', function () {
          mutate(function () {
            var clone = deepClone(_cfg.widgets[idx]);
            _cfg.widgets.splice(idx + 1, 0, clone);
          });
        }),
        _makeCellBtn('trash-2', 'Remove widget', function () {
          mutate(function () {
            _cfg.widgets.splice(idx, 1);
          });
        }),
      ]);

      /* drag handle */
      var dragHandle = el('div', { class: 'le-drag-handle', title: 'Drag to reorder' });
      _wireDrag(dragHandle, cell, idx);

      /* resize handle */
      var resizeHandle = el('div', { class: 'le-resize-handle', title: 'Drag to resize' });
      _wireResize(resizeHandle, idx);

      cell.appendChild(toolbar);
      cell.appendChild(dragHandle);
      cell.appendChild(resizeHandle);
    });
  }

  function _makeCellBtn(icon, title, onclick) {
    var btn = el('button', { class: 'le-cell-btn', title: title, onclick: onclick });
    btn.innerHTML = SFP.icons.svg(icon, 12);
    return btn;
  }

  /* ── Open widget settings via dashEditor ────────────────────────────────── */

  function _openWidgetSettings() {
    if (!SFP.ui.dashEditor) { return; }
    /* Apply the current working copy so the editor sees it. */
    SFP.config.define('dashboard.' + _pageId, _cfg);
    SFP.ui.dashEditor.open(_pageId);
    /* dashEditor.Apply calls SFP.config.override and then nav.navigate which
     * will re-fire nav:changed → layout-editor re-activates and picks up the
     * new config from the registry. */
  }

  /* ── Drag to reorder ─────────────────────────────────────────────────────── */

  function _wireDrag(handle, cell, srcIdx) {
    handle.addEventListener('mousedown', function (e) {
      e.preventDefault();
      var rect = cell.getBoundingClientRect();
      var ghost = el('div', { class: 'le-drag-ghost' });
      ghost.style.width = rect.width + 'px';
      ghost.style.height = rect.height + 'px';
      ghost.style.left = rect.left + 'px';
      ghost.style.top = rect.top + 'px';
      document.body.appendChild(ghost);

      cell.classList.add('le-dragging');
      _drag = { srcIdx: srcIdx, ghost: ghost, startX: e.clientX, startY: e.clientY, cell: cell };
    });
  }

  /* ── Resize ──────────────────────────────────────────────────────────────── */

  function _wireResize(handle, widgetIdx) {
    handle.addEventListener('mousedown', function (e) {
      e.preventDefault();
      e.stopPropagation();
      var layout = _cfg.widgets[widgetIdx].layout || {};
      _resize = {
        widgetIdx: widgetIdx,
        startX: e.clientX,
        startY: e.clientY,
        origSpan: layout.span || _columns,
        origMinH: layout.minH || 0,
      };
    });
  }

  /* ── Global mousemove / mouseup (registered once) ────────────────────────── */

  document.addEventListener('mousemove', function (e) {
    if (_drag) {
      var d = _drag;
      var origRect = d.cell.getBoundingClientRect();
      d.ghost.style.left = (origRect.left + (e.clientX - d.startX)) + 'px';
      d.ghost.style.top  = (origRect.top  + (e.clientY - d.startY)) + 'px';
    }

    if (_resize) {
      var r = _resize;
      var container = document.querySelector('.dash-grid');
      if (!container) { return; }
      var gridWidth = container.getBoundingClientRect().width;
      var gap = (_cfg && _cfg.grid && _cfg.grid.gap !== undefined) ? _cfg.grid.gap : 12;
      var colWidth = (gridWidth - gap * (_columns - 1)) / _columns;
      var dx = e.clientX - r.startX;
      var dy = e.clientY - r.startY;
      var newSpan = Math.max(1, Math.min(_columns,
        Math.round(r.origSpan + dx / (colWidth + gap))));
      var newMinH = Math.max(0, r.origMinH + Math.round(dy / SNAP_H) * SNAP_H);
      /* Live preview directly on the cell. */
      var cell = document.querySelector('.dash-cell[data-le-idx="' + r.widgetIdx + '"]');
      if (cell) {
        cell.style.gridColumn = 'span ' + newSpan;
        cell.style.minHeight = newMinH ? newMinH + 'px' : '';
      }
    }
  });

  document.addEventListener('mouseup', function (e) {
    if (_drag) {
      var d = _drag;
      if (d.ghost && d.ghost.parentNode) { d.ghost.parentNode.removeChild(d.ghost); }
      d.cell.classList.remove('le-dragging');
      _drag = null;

      /* Find drop target. */
      var target = document.elementFromPoint(e.clientX, e.clientY);
      if (target) {
        var targetCell = target.closest
          ? target.closest('.dash-cell[data-le-idx]')
          : _closestCell(target);
        if (targetCell) {
          var dstIdx = parseInt(targetCell.getAttribute('data-le-idx'), 10);
          if (!isNaN(dstIdx) && dstIdx !== d.srcIdx) {
            mutate(function () {
              var moved = _cfg.widgets.splice(d.srcIdx, 1)[0];
              _cfg.widgets.splice(dstIdx, 0, moved);
            });
          }
        }
      }
    }

    if (_resize) {
      var r = _resize;
      var container = document.querySelector('.dash-grid');
      if (container) {
        var gridWidth = container.getBoundingClientRect().width;
        var gap = (_cfg && _cfg.grid && _cfg.grid.gap !== undefined) ? _cfg.grid.gap : 12;
        var colWidth = (gridWidth - gap * (_columns - 1)) / _columns;
        var dx = e.clientX - r.startX;
        var dy = e.clientY - r.startY;
        var newSpan = Math.max(1, Math.min(_columns,
          Math.round(r.origSpan + dx / (colWidth + gap))));
        var newMinH = Math.max(0, r.origMinH + Math.round(dy / SNAP_H) * SNAP_H);
        var idx = r.widgetIdx;
        mutate(function () {
          if (!_cfg.widgets[idx].layout) { _cfg.widgets[idx].layout = {}; }
          _cfg.widgets[idx].layout.span = newSpan;
          _cfg.widgets[idx].layout.minH = newMinH || null;
        });
      }
      _resize = null;
    }
  });

  function _closestCell(node) {
    while (node) {
      if (node.classList && node.classList.contains('dash-cell') &&
          node.hasAttribute('data-le-idx')) { return node; }
      node = node.parentElement;
    }
    return null;
  }

  /* ── Widget type picker ─────────────────────────────────────────────────── */

  function _showAddWidgetPicker() {
    var types = SFP.widgets.types();
    var backdrop = el('div', { class: 'le-picker-backdrop' });

    var listItems = types.map(function (typeName) {
      return el('button', {
        class: 'le-picker-item',
        text: typeName,
        onclick: function () {
          if (backdrop.parentNode) { backdrop.parentNode.removeChild(backdrop); }
          mutate(function () {
            _cfg.widgets.push({
              type: typeName,
              layout: { span: DEFAULT_SPAN, minH: DEFAULT_MINH },
              options: {},
            });
          });
          /* Open settings for the newly added widget. */
          _openWidgetSettings();
        },
      });
    });

    var panel = el('div', { class: 'le-picker-panel' }, [
      el('div', { class: 'le-picker-header' }, [
        el('span', { text: 'Add widget — choose type' }),
        el('button', {
          class: 'ded-btn',
          text: '×',
          style: { fontSize: '16px', lineHeight: '1' },
          onclick: function () {
            if (backdrop.parentNode) { backdrop.parentNode.removeChild(backdrop); }
          },
        }),
      ]),
      el('div', { class: 'le-picker-list' }, listItems),
    ]);

    backdrop.appendChild(panel);
    backdrop.addEventListener('click', function (e) {
      if (e.target === backdrop) {
        if (backdrop.parentNode) { backdrop.parentNode.removeChild(backdrop); }
      }
    });
    document.body.appendChild(backdrop);
  }

  /* ── Top bar ─────────────────────────────────────────────────────────────── */

  function _buildBar() {
    var dirtyEl = el('span', { class: 'le-dirty-indicator', text: '' });
    var undoBtn = el('button', { class: 'twin-banner-btn', text: 'Undo',
      title: 'Undo (Ctrl+Z)', disabled: true,
      onclick: function () { doUndo(); } });
    var redoBtn = el('button', { class: 'twin-banner-btn', text: 'Redo',
      title: 'Redo (Ctrl+Y)', disabled: true,
      onclick: function () { doRedo(); } });
    var addBtn = el('button', { class: 'twin-banner-btn', text: '+ Add widget',
      onclick: function () { _showAddWidgetPicker(); } });
    var saveBtn = el('button', { class: 'twin-banner-btn primary', text: 'Save',
      title: 'Persist changes to localStorage', disabled: true,
      onclick: function () { _save(); } });
    var exportBtn = el('button', { class: 'twin-banner-btn', text: 'Export',
      title: 'Download .dashboard.js',
      onclick: function () {
        SFP.config.define('dashboard.' + _pageId, _cfg);
        SFP.config.downloadConfigJs(
          'dashboard.' + _pageId,
          _pageId + '.dashboard.js'
        );
      },
    });
    var exitBtn = el('button', { class: 'twin-banner-btn', text: 'Exit edit',
      onclick: function () { _requestExit(); } });

    var bar = el('div', { class: 'le-top-bar' }, [
      el('span', { class: 'le-bar-label', text: 'Layout edit — ' + _pageId }),
      dirtyEl,
      undoBtn,
      redoBtn,
      addBtn,
      saveBtn,
      exportBtn,
      exitBtn,
    ]);
    bar._refs = { dirty: dirtyEl, undo: undoBtn, redo: redoBtn, save: saveBtn };
    return bar;
  }

  function _refreshBar() {
    if (!_barEl || !_barEl._refs) { return; }
    var refs = _barEl._refs;
    var dirty = _session && _session.dirty;
    refs.dirty.textContent = dirty ? '● unsaved' : '';
    refs.dirty.className = 'le-dirty-indicator' + (dirty ? ' dirty' : '');
    refs.undo.disabled = !(_session && _session.undo.length > 0);
    refs.redo.disabled = !(_session && _session.redo.length > 0);
    refs.save.disabled = !dirty;
  }

  /* ── Save / Exit ─────────────────────────────────────────────────────────── */

  function _save() {
    SFP.config.override('dashboard.' + _pageId, _cfg);
    if (_session) {
      _session.dirty = false;
      _session.undo = [];
      _session.redo = [];
    }
    _refreshBar();
  }

  function _requestExit() {
    if (_session && _session.dirty) {
      _showConfirmDialog(
        'Exit without saving?',
        'Unsaved changes will be lost.',
        function () { _deactivate(false); }
      );
    } else {
      _deactivate(false);
    }
  }

  /* ── Inline confirm dialog ──────────────────────────────────────────────── */

  function _showConfirmDialog(title, body, onConfirm) {
    var backdrop = el('div', { class: 'le-confirm-backdrop' });
    var panel = el('div', { class: 'le-confirm-panel' }, [
      el('div', { class: 'le-confirm-title', text: title }),
      el('div', { class: 'le-confirm-body', text: body }),
      el('div', { class: 'le-confirm-actions' }, [
        el('button', {
          class: 'ded-btn primary',
          text: 'Discard & exit',
          onclick: function () {
            if (backdrop.parentNode) { backdrop.parentNode.removeChild(backdrop); }
            onConfirm();
          },
        }),
        el('button', {
          class: 'ded-btn',
          text: 'Keep editing',
          onclick: function () {
            if (backdrop.parentNode) { backdrop.parentNode.removeChild(backdrop); }
          },
        }),
      ]),
    ]);
    backdrop.appendChild(panel);
    document.body.appendChild(backdrop);
  }

  /* ── Activation / Deactivation ──────────────────────────────────────────── */

  function _activate(pageId) {
    /* Permission gate — belt-and-braces check at every activation entry point. */
    if (!SFP.runtime.canEdit) {
      console.warn('[SFP.layoutEditor] Activation blocked — canEdit is false.');
      return;
    }
    if (_active && _pageId === pageId) { return; }
    if (_active) { _deactivate(true); }

    _pageId  = pageId;
    _cfg     = deepClone(SFP.config.get('dashboard.' + pageId));
    _columns = (_cfg.grid && _cfg.grid.columns) || 12;
    _session = { undo: [], redo: [], dirty: false };
    _active  = true;

    /* Destroy the shell's pageHandle if it rendered before us so we don't
     * double-instantiate widgets. */
    if (SFP.ui.shell && SFP.ui.shell.pageHandle) {
      try { SFP.ui.shell.pageHandle.destroy(); } catch (e) { /* ignore */ }
      SFP.ui.shell.pageHandle = null;
    }

    /* Build top bar and insert it between the header and .main-content. */
    _barEl = _buildBar();
    var mainEl = document.querySelector('.main-content');
    if (mainEl && mainEl.parentNode) {
      mainEl.parentNode.insertBefore(_barEl, mainEl);
    } else {
      document.getElementById('app').appendChild(_barEl);
    }
    if (mainEl) { mainEl.classList.add('le-active'); }

    _rerender();
    _refreshBar();

    _onKey = function (e) {
      var tag = document.activeElement ? document.activeElement.tagName : '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') { return; }
      if (e.key === 'z' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault(); doUndo();
      } else if (e.key === 'y' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault(); doRedo();
      }
    };
    document.addEventListener('keydown', _onKey);
  }

  function _deactivate(silentNav) {
    if (!_active) { return; }
    _active = false;

    /* Restore the persisted (saved) config in memory if edits were discarded. */
    if (_session && !_session.dirty) {
      /* Nothing was saved in this session — re-apply whatever is persisted. */
      var overrides = SFP.config.overrides();
      if (overrides['dashboard.' + _pageId]) {
        SFP.config.define('dashboard.' + _pageId, overrides['dashboard.' + _pageId]);
      }
    }

    /* Remove top bar. */
    if (_barEl && _barEl.parentNode) {
      _barEl.parentNode.removeChild(_barEl);
    }
    _barEl = null;

    /* Remove edit-mode class from main. */
    var mainEl = document.querySelector('.main-content');
    if (mainEl) { mainEl.classList.remove('le-active'); }

    /* Destroy render handle. */
    if (_handle) {
      try { _handle.destroy(); } catch (e) { /* ignore */ }
      _handle = null;
    }

    /* Re-render clean. */
    if (mainEl && _pageId) {
      var freshHandle = SFP.ui.dashboards.render(
        mainEl, _pageId, SFP.ui.nav.current().params);
      if (SFP.ui.shell) { SFP.ui.shell.pageHandle = freshHandle; }
    }

    if (_onKey) {
      document.removeEventListener('keydown', _onKey);
      _onKey = null;
    }

    /* Cancel any in-flight drag / resize. */
    if (_drag) {
      if (_drag.ghost && _drag.ghost.parentNode) {
        _drag.ghost.parentNode.removeChild(_drag.ghost);
      }
      _drag = null;
    }
    _resize = null;

    /* If the user clicked "Exit edit", also turn off the global editMode flag
     * and update the pencil button state.  silentNav=true means we were
     * deactivated by navigation, not by the user pressing Exit — in that case
     * we leave editMode on so it auto-activates on the next non-map page. */
    if (!silentNav) {
      SFP.runtime.editMode = false;
      SFP.bus.emit('edit:modeChanged', { on: false });
    }

    _pageId  = null;
    _cfg     = null;
    _session = null;
  }

  /* ── Bus wiring ─────────────────────────────────────────────────────────── */

  SFP.bus.on('edit:modeChanged', function (e) {
    var current = SFP.ui.nav.current();
    if (!current || !current.page) { return; }

    var appCfg = SFP.config.get('app');
    var page = null;
    (appCfg.pages || []).forEach(function (p) {
      if (p.id === current.page) { page = p; }
    });
    if (!page) { return; }

    if (isFactoryMap(page.dashboard)) { return; }

    if (e.on) {
      _activate(current.page);
    } else {
      if (_active) { _deactivate(true); }
    }
  });

  SFP.bus.on('nav:changed', function (e) {
    var appCfg = SFP.config.get('app');
    var page = null;
    (appCfg.pages || []).forEach(function (p) {
      if (p.id === e.page) { page = p; }
    });

    if (_active && _pageId === e.page) {
      /* Same page navigated again (e.g. dashEditor.Apply called nav.navigate).
       * Re-sync _cfg from the live registry and re-render. */
      _cfg = deepClone(SFP.config.get('dashboard.' + _pageId));
      _session.undo = [];
      _session.redo = [];
      _session.dirty = false;
      _rerender();
      _refreshBar();
      return;
    }

    if (_active && _pageId !== e.page) {
      /* Navigated away — deactivate silently (keep editMode on). */
      _deactivate(true);
    }

    if (!page) { return; }
    if (!_active && SFP.runtime.editMode && !isFactoryMap(page.dashboard)) {
      _activate(e.page);
    }
  });

  /* ── Public API ─────────────────────────────────────────────────────────── */

  SFP.ui.layoutEditor = {
    isActive: function () { return _active; },
    deactivate: function () { _deactivate(false); },
  };

}(window.SFP));
