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

  var _active      = false;
  var _pageId      = null;   /* current dashboard id (no 'dashboard.' prefix) */
  var _cfg         = null;   /* deep-clone working copy */
  var _baseline    = null;   /* deep-clone of config at session start (for discard) */
  var _columns     = 12;
  var _session     = null;   /* { undo:[], redo:[], dirty:false } */
  var _handle      = null;   /* SFP.ui.dashboards render handle */
  var _barEl       = null;   /* (kept for compat, no longer set) */
  var _onKey       = null;
  var _propPanelEl = null;   /* docked right-side widget properties panel */
  var _propWidgetIdx = -1;   /* index of widget currently open in props panel */

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

  /** Run `fn` (which wipes and rebuilds .main-content) without losing the
   *  user's scroll position — emptying the scroll container resets its
   *  scrollTop to 0, which made resize-drop and edit-mode enter/exit snap
   *  the page back to the top. */
  function _preserveScroll(fn) {
    var mainEl = document.querySelector('.main-content');
    var top = mainEl ? mainEl.scrollTop : 0;
    fn();
    if (mainEl && top) { mainEl.scrollTop = top; }
  }

  function _rerender() {
    if (!_active || !_pageId) { return; }
    var container = document.querySelector('.main-content');
    if (!container) { return; }

    _preserveScroll(function () {
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
    });
    /* Refresh the docked properties panel if open (index may be out of range
     * if the widget was deleted — _renderPropPanel guards for this). */
    if (_propPanelEl && _propWidgetIdx >= 0) { _renderPropPanel(); }
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
      (function (cellIdx) {
        var toolbar = el('div', { class: 'le-cell-toolbar' }, [
          _makeCellBtn('settings', 'Widget settings', function () {
            _openWidgetSettings(cellIdx);
          }),
          _makeCellBtn('copy', 'Duplicate widget', function () {
            mutate(function () {
              var dupe = deepClone(_cfg.widgets[cellIdx]);
              _cfg.widgets.splice(cellIdx + 1, 0, dupe);
            });
          }),
          _makeCellBtn('trash-2', 'Remove widget', function () {
            if (_propWidgetIdx === cellIdx) { _closePropPanel(); }
            mutate(function () {
              _cfg.widgets.splice(cellIdx, 1);
            });
          }),
        ]);

        cell.appendChild(toolbar);

        /* drag handle */
        var dragHandle = el('div', { class: 'le-drag-handle', title: 'Drag to reorder' });
        _wireDrag(dragHandle, cell, cellIdx);
        cell.appendChild(dragHandle);

        /* resize handles — corner (both axes), right edge (span), bottom edge (minH) */
        var cornerHandle = el('div', { class: 'le-resize-handle le-resize-corner', title: 'Drag to resize' });
        _wireResize(cornerHandle, cellIdx, 'corner');
        cell.appendChild(cornerHandle);

        var rightHandle = el('div', { class: 'le-resize-handle le-resize-right', title: 'Drag to resize width' });
        _wireResize(rightHandle, cellIdx, 'right');
        cell.appendChild(rightHandle);

        var bottomHandle = el('div', { class: 'le-resize-handle le-resize-bottom', title: 'Drag to resize height' });
        _wireResize(bottomHandle, cellIdx, 'bottom');
        cell.appendChild(bottomHandle);
      }(idx));
    });
  }

  function _makeCellBtn(icon, title, onclick) {
    var btn = el('button', { class: 'le-cell-btn', title: title, onclick: onclick });
    btn.innerHTML = SFP.icons.svg(icon, 12);
    return btn;
  }

  /* ── Widget properties panel (docked right side) ────────────────────────── */

  /**
   * _openWidgetPanel(widgetIdx)
   * Opens (or refreshes) the docked right-side properties panel for the widget
   * at index widgetIdx in _cfg.widgets.
   */
  function _openWidgetPanel(widgetIdx) {
    _propWidgetIdx = widgetIdx;
    if (!_propPanelEl) {
      _propPanelEl = el('div', { class: 'le-prop-panel' });
      document.getElementById('app').appendChild(_propPanelEl);
      /* Shift main content to make room. */
      var mainEl = document.querySelector('.main-content');
      if (mainEl) { mainEl.classList.add('le-prop-open'); }
    }
    _renderPropPanel();
  }

  function _closePropPanel() {
    if (_propPanelEl && _propPanelEl.parentNode) {
      _propPanelEl.parentNode.removeChild(_propPanelEl);
    }
    _propPanelEl = null;
    _propWidgetIdx = -1;
    var mainEl = document.querySelector('.main-content');
    if (mainEl) { mainEl.classList.remove('le-prop-open'); }
  }

  function _renderPropPanel() {
    if (!_propPanelEl || _propWidgetIdx < 0 || !_cfg) { return; }
    if (_propWidgetIdx >= _cfg.widgets.length) { _closePropPanel(); return; }

    SFP.dom.clear(_propPanelEl);
    var widgetIdx = _propWidgetIdx;
    var widget = _cfg.widgets[widgetIdx];
    var registeredTypes = SFP.widgets.types();

    /* ── header ── */
    _propPanelEl.appendChild(el('div', { class: 'le-prop-header' }, [
      el('span', { class: 'le-prop-title', text: 'Widget ' + (widgetIdx + 1) }),
      el('button', { class: 'le-cell-btn', title: 'Close panel',
        html: SFP.icons.svg('x', 12),
        onclick: function () { _closePropPanel(); } }),
    ]));

    function row(labelText, input) {
      return el('label', { class: 'twin-prop-row' }, [labelText, input]);
    }

    /* ── type selector ── */
    var typeSel = el('select', { class: 'input' });
    registeredTypes.forEach(function (t) {
      var opt = el('option', { value: t, text: t });
      if (t === widget.type) { opt.selected = true; }
      typeSel.appendChild(opt);
    });
    typeSel.addEventListener('change', function () {
      mutate(function () { _cfg.widgets[widgetIdx].type = typeSel.value; });
      _renderPropPanel();
    });
    _propPanelEl.appendChild(row('Type', typeSel));

    /* ── span ── */
    var spanInput = el('input', { type: 'number', min: '1', max: '12', class: 'input',
      value: String((widget.layout && widget.layout.span) || _columns) });
    spanInput.addEventListener('change', function () {
      var v = parseInt(spanInput.value, 10);
      if (v >= 1 && v <= 12) {
        mutate(function () {
          if (!_cfg.widgets[widgetIdx].layout) { _cfg.widgets[widgetIdx].layout = {}; }
          _cfg.widgets[widgetIdx].layout.span = v;
        });
      }
    });
    _propPanelEl.appendChild(row('Span (cols)', spanInput));

    /* ── rows ── */
    var rowsInput = el('input', { type: 'number', min: '1', class: 'input',
      value: String((widget.layout && widget.layout.rows) || '') });
    rowsInput.placeholder = 'auto';
    rowsInput.addEventListener('change', function () {
      var v = parseInt(rowsInput.value, 10);
      mutate(function () {
        if (!_cfg.widgets[widgetIdx].layout) { _cfg.widgets[widgetIdx].layout = {}; }
        _cfg.widgets[widgetIdx].layout.rows = (v > 0) ? v : null;
      });
    });
    _propPanelEl.appendChild(row('Rows', rowsInput));

    /* ── minH ── */
    var minHInput = el('input', { type: 'number', min: '0', class: 'input',
      value: String((widget.layout && widget.layout.minH) || 0) });
    minHInput.addEventListener('change', function () {
      var v = parseInt(minHInput.value, 10);
      if (!isNaN(v) && v >= 0) {
        mutate(function () {
          if (!_cfg.widgets[widgetIdx].layout) { _cfg.widgets[widgetIdx].layout = {}; }
          _cfg.widgets[widgetIdx].layout.minH = v || null;
        });
      }
    });
    _propPanelEl.appendChild(row('Min height (px)', minHInput));

    /* ── options JSON ── */
    var optNote = el('span', { class: 'ded-note' });
    var optTa = el('textarea', { class: 'ded-json le-prop-ta',
      rows: '6', spellcheck: 'false',
      text: JSON.stringify(widget.options || {}, null, 2) });
    optTa.addEventListener('input', function () {
      try {
        var parsed = JSON.parse(optTa.value);
        optTa.classList.remove('invalid');
        optNote.textContent = '';
        /* Live-preview on next Apply only — don't mutate on every keystroke. */
        optTa._parsed = parsed;
        optTa._valid = true;
      } catch (e) {
        optTa.classList.add('invalid');
        optNote.textContent = 'JSON error: ' + e.message;
        optTa._valid = false;
      }
    });
    optTa._valid = true;
    optTa._parsed = widget.options || {};
    _propPanelEl.appendChild(el('div', { class: 'le-prop-section-title', text: 'options' }));
    _propPanelEl.appendChild(optTa);
    _propPanelEl.appendChild(optNote);

    /* ── bind JSON (only when present) ── */
    var bindTa = null;
    if (widget.bind !== undefined) {
      var bindNote = el('span', { class: 'ded-note' });
      bindTa = el('textarea', { class: 'ded-json le-prop-ta',
        rows: '4', spellcheck: 'false',
        text: JSON.stringify(widget.bind || {}, null, 2) });
      bindTa.addEventListener('input', function () {
        try {
          var parsed = JSON.parse(bindTa.value);
          bindTa.classList.remove('invalid');
          bindNote.textContent = '';
          bindTa._parsed = parsed;
          bindTa._valid = true;
        } catch (e) {
          bindTa.classList.add('invalid');
          bindNote.textContent = 'JSON error: ' + e.message;
          bindTa._valid = false;
        }
      });
      bindTa._valid = true;
      bindTa._parsed = widget.bind || {};
      _propPanelEl.appendChild(el('div', { class: 'le-prop-section-title', text: 'bind' }));
      _propPanelEl.appendChild(bindTa);
      _propPanelEl.appendChild(bindNote);
    }

    /* ── Apply button ── */
    _propPanelEl.appendChild(el('button', { class: 'btn-action primary', text: 'Apply',
      onclick: function () {
        if (!optTa._valid) { return; }
        if (bindTa && !bindTa._valid) { return; }
        mutate(function () {
          _cfg.widgets[widgetIdx].options = optTa._parsed;
          if (bindTa) { _cfg.widgets[widgetIdx].bind = bindTa._parsed; }
        });
        _renderPropPanel();
      } }));
  }

  /* ── (back-compat) thin alias that opens the new panel instead of modal ── */
  function _openWidgetSettings(widgetIdx) {
    if (widgetIdx !== undefined && widgetIdx >= 0) {
      _openWidgetPanel(widgetIdx);
    } else {
      /* fallback: open dashEditor modal for backwards compatibility */
      if (!SFP.ui.dashEditor) { return; }
      SFP.config.define('dashboard.' + _pageId, _cfg);
      SFP.ui.dashEditor.open(_pageId);
    }
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

  /**
   * _wireResize(handle, widgetIdx, axis)
   * axis: 'corner' = span+minH, 'right' = span only, 'bottom' = minH only
   */
  function _wireResize(handle, widgetIdx, axis) {
    handle.addEventListener('mousedown', function (e) {
      e.preventDefault();
      e.stopPropagation();
      var layout = _cfg.widgets[widgetIdx].layout || {};
      _resize = {
        widgetIdx: widgetIdx,
        axis: axis || 'corner',
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
      /* Live preview directly on the cell. */
      var cell = document.querySelector('.dash-cell[data-le-idx="' + r.widgetIdx + '"]');
      if (cell) {
        if (r.axis === 'corner' || r.axis === 'right') {
          var newSpan = Math.max(1, Math.min(_columns,
            Math.round(r.origSpan + dx / (colWidth + gap))));
          cell.style.gridColumn = 'span ' + newSpan;
        }
        if (r.axis === 'corner' || r.axis === 'bottom') {
          var newMinH = Math.max(0, r.origMinH + Math.round(dy / SNAP_H) * SNAP_H);
          cell.style.minHeight = newMinH ? newMinH + 'px' : '';
        }
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
        var idx = r.widgetIdx;
        mutate(function () {
          if (!_cfg.widgets[idx].layout) { _cfg.widgets[idx].layout = {}; }
          if (r.axis === 'corner' || r.axis === 'right') {
            var newSpan = Math.max(1, Math.min(_columns,
              Math.round(r.origSpan + dx / (colWidth + gap))));
            _cfg.widgets[idx].layout.span = newSpan;
          }
          if (r.axis === 'corner' || r.axis === 'bottom') {
            var newMinH = Math.max(0, r.origMinH + Math.round(dy / SNAP_H) * SNAP_H);
            _cfg.widgets[idx].layout.minH = newMinH || null;
          }
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
          /* Open the docked panel for the newly added widget. */
          _openWidgetPanel(_cfg.widgets.length - 1);
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

  /* ── Bar refresh (delegates to editSession which owns the bar) ────────────── */

  function _refreshBar() {
    if (SFP.ui.editSession) { SFP.ui.editSession.refresh(); }
  }

  /* ── Save / Exit ─────────────────────────────────────────────────────────── */

  function _save() {
    var ok = SFP.config.override('dashboard.' + _pageId, _cfg);
    if (ok === false) {
      /* dirty stays true; editSession will display the error in the bar */
      return false;
    }
    if (_session) {
      _session.dirty = false;
      _session.undo = [];
      _session.redo = [];
    }
    /* Advance baseline to the just-saved state so a subsequent Discard
     * restores to this saved snapshot, not the pre-session one. */
    _baseline = deepClone(_cfg);
    _refreshBar();
    return true;
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

    _pageId   = pageId;
    _cfg      = deepClone(SFP.config.get('dashboard.' + pageId));
    _baseline = deepClone(_cfg);
    _columns  = (_cfg.grid && _cfg.grid.columns) || 12;
    _session  = { undo: [], redo: [], dirty: false };
    _active   = true;

    _preserveScroll(function () {
      /* Destroy the shell's pageHandle if it rendered before us so we don't
       * double-instantiate widgets. */
      if (SFP.ui.shell && SFP.ui.shell.pageHandle) {
        try { SFP.ui.shell.pageHandle.destroy(); } catch (e) { /* ignore */ }
        SFP.ui.shell.pageHandle = null;
      }

      /* Mark main-content so padding adjusts (editSession inserts the bar). */
      var mainEl = document.querySelector('.main-content');
      if (mainEl) { mainEl.classList.add('le-active'); }

      _rerender();
    });
    /* editSession.refresh() called via _refreshBar() notifies the bar. */
    _refreshBar();
  }

  /**
   * _deactivate(discard)
   *   discard=true  — restore baseline config so unsaved edits vanish
   *   discard=false — keep current in-memory config (we just saved, or we are
   *                   only suspending for a nav swap)
   *
   * NOTE: the bar is owned by editSession; we do NOT touch it here.
   * NOTE: editMode flag / pencil state is managed by editSession; we do NOT
   *       emit edit:modeChanged here.
   */
  function _deactivate(discard) {
    if (!_active) { return; }
    _active = false;

    /* Close the widget properties panel if open. */
    _closePropPanel();

    /* Restore pre-session baseline when discarding unsaved edits. */
    if (discard && _baseline && _pageId) {
      SFP.config.define('dashboard.' + _pageId, _baseline);
    }

    /* Remove edit-mode class from main. */
    var mainEl = document.querySelector('.main-content');
    if (mainEl) { mainEl.classList.remove('le-active'); }

    _preserveScroll(function () {
      /* Destroy render handle. */
      if (_handle) {
        try { _handle.destroy(); } catch (e) { /* ignore */ }
        _handle = null;
      }

      /* Re-render clean with whatever config is now live. */
      if (mainEl && _pageId) {
        var freshHandle = SFP.ui.dashboards.render(
          mainEl, _pageId, SFP.ui.nav.current().params);
        if (SFP.ui.shell) { SFP.ui.shell.pageHandle = freshHandle; }
      }
    });

    /* Cancel any in-flight drag / resize. */
    if (_drag) {
      if (_drag.ghost && _drag.ghost.parentNode) {
        _drag.ghost.parentNode.removeChild(_drag.ghost);
      }
      _drag = null;
    }
    _resize = null;

    _pageId   = null;
    _cfg      = null;
    _baseline = null;
    _session  = null;
  }

  /* ── nav:changed bus wiring ──────────────────────────────────────────────── */

  SFP.bus.on('nav:changed', function (e) {
    if (_active && _pageId === e.page) {
      /* Same page navigated again (e.g. after dashEditor.Apply calls nav.navigate).
       * Re-sync _cfg from the live registry and re-render. */
      _cfg = deepClone(SFP.config.get('dashboard.' + _pageId));
      _session.undo = [];
      _session.redo = [];
      _session.dirty = false;
      _rerender();
      _refreshBar();
    }
  });

  /* ── editSession adapter registration ─────────────────────────────────────
   * Deferred until DOMContentLoaded so SFP.ui.editSession exists (it is
   * defined in edit-session.js which loads after layout-editor.js).         */
  document.addEventListener('DOMContentLoaded', function () {
    if (!SFP.ui.editSession) { return; }

    SFP.ui.editSession.registerAdapter(
      /* test */ function (pageId) {
        var appCfg = SFP.config.get('app');
        var page = null;
        (appCfg.pages || []).forEach(function (p) {
          if (p.id === pageId) { page = p; }
        });
        if (!page) { return false; }
        return !isFactoryMap(page.dashboard);
      },
      /* factory */ function (pageId) {
        if (!SFP.runtime.canEdit) { return null; }
        _activate(pageId);
        return {
          id: 'Layout edit — ' + pageId,
          canUndo: function () { return !!(_session && _session.undo.length > 0); },
          canRedo: function () { return !!(_session && _session.redo.length > 0); },
          undo:    function () { doUndo(); },
          redo:    function () { doRedo(); },
          dirty:   function () { return !!(_session && _session.dirty); },
          save:    function () { return _save(); },
          export:  function () {
            SFP.config.define('dashboard.' + _pageId, _cfg);
            SFP.config.downloadConfigJs('dashboard.' + _pageId, _pageId + '.dashboard.js');
          },
          addWidget: function () { _showAddWidgetPicker(); },
          onExit: function (discard) { _deactivate(discard); },
        };
      }
    );
  });

  /* ── Public API ─────────────────────────────────────────────────────────── */

  SFP.ui.layoutEditor = {
    isActive: function () { return _active; },
    deactivate: function () { _deactivate(true); },
  };

}(window.SFP));
