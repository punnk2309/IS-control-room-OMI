/* ============================================================================
 * SFP.ui.dashEditor — v1 visual menu editor for non-map dashboard pages
 * ----------------------------------------------------------------------------
 * Opens a full-screen modal overlay that lets operators rearrange widgets,
 * tweak layout dimensions, and edit widget options / bind objects as validated
 * JSON — all without touching source files.
 *
 * Typical workflow:
 *   1. Call SFP.ui.dashEditor.open('overview') from a toolbar button.
 *   2. Reorder widgets with ↑ / ↓, change type via <select>, adjust span/minH.
 *   3. Expand the JSON <details> panel for a widget to edit options/bind.
 *      The textarea turns red if the JSON is invalid; Apply is disabled until
 *      all JSON is valid.
 *   4. Click "Apply" to persist via SFP.config.override() and hot-reload the
 *      current page immediately (no browser refresh).
 *   5. Click "Export .dashboard.js" to download a ready-to-commit source file.
 *      Commit the file, then click "Reset overrides" and reload so the file
 *      config takes over — the localStorage entry is no longer needed.
 *
 * Notes:
 *   - Only one editor instance is open at a time (singleton).
 *   - Escape closes the overlay; the keydown listener is cleaned up on close.
 *   - This editor targets dashboard pages (grid + widgets array). For the
 *     factory-map twin page use the dedicated twin editor chrome instead.
 * ========================================================================== */
(function (SFP) {
  'use strict';

  var el = SFP.dom.el;

  /* ── internal state ────────────────────────────────────────────────────── */

  var _backdrop = null;    // current overlay root element
  var _keyHandler = null;  // Escape listener reference for cleanup
  var _cfg = null;         // working deep-clone of the dashboard config
  var _pageId = null;      // id string without the 'dashboard.' prefix

  /* ── helpers ────────────────────────────────────────────────────────────── */

  function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function removeBackdrop() {
    if (_backdrop && _backdrop.parentNode) {
      _backdrop.parentNode.removeChild(_backdrop);
    }
    _backdrop = null;
  }

  function hasInvalidTextareas(panel) {
    var tas = panel.querySelectorAll('textarea.invalid');
    return tas.length > 0;
  }

  /* ── widget row builder ──────────────────────────────────────────────────── */

  function buildWidgetList(listContainer, applyBtn) {
    SFP.dom.clear(listContainer);

    var registeredTypes = SFP.widgets.types();

    _cfg.widgets.forEach(function (widget, index) {
      /* ---- type selector ------------------------------------------------- */
      var typeSelect = el('select', { class: 'ded-input' });
      registeredTypes.forEach(function (typeName) {
        var opt = el('option', { value: typeName, text: typeName });
        if (typeName === widget.type) { opt.selected = true; }
        typeSelect.appendChild(opt);
      });
      typeSelect.addEventListener('change', function () {
        _cfg.widgets[index].type = typeSelect.value;
      });

      /* ---- span input ---------------------------------------------------- */
      var spanInput = el('input', {
        type: 'number',
        min: '1',
        max: '12',
        value: String((widget.layout && widget.layout.span) || 6),
        class: 'ded-input',
        style: { width: '56px' },
      });
      spanInput.addEventListener('input', function () {
        var v = parseInt(spanInput.value, 10);
        if (v >= 1 && v <= 12) {
          if (!_cfg.widgets[index].layout) { _cfg.widgets[index].layout = {}; }
          _cfg.widgets[index].layout.span = v;
        }
      });

      /* ---- minH input ---------------------------------------------------- */
      var minHInput = el('input', {
        type: 'number',
        min: '0',
        value: String((widget.layout && widget.layout.minH) || 0),
        class: 'ded-input',
        style: { width: '72px' },
      });
      minHInput.addEventListener('input', function () {
        var v = parseInt(minHInput.value, 10);
        if (!isNaN(v) && v >= 0) {
          if (!_cfg.widgets[index].layout) { _cfg.widgets[index].layout = {}; }
          _cfg.widgets[index].layout.minH = v;
        }
      });

      /* ---- up / down / remove -------------------------------------------- */
      var upBtn = el('button', {
        class: 'ded-btn',
        text: '↑',
        title: 'Move up',
        disabled: index === 0 ? '' : null,
        onclick: function () {
          if (index === 0) { return; }
          var tmp = _cfg.widgets[index - 1];
          _cfg.widgets[index - 1] = _cfg.widgets[index];
          _cfg.widgets[index] = tmp;
          buildWidgetList(listContainer, applyBtn);
        },
      });

      var downBtn = el('button', {
        class: 'ded-btn',
        text: '↓',
        title: 'Move down',
        disabled: index === _cfg.widgets.length - 1 ? '' : null,
        onclick: function () {
          if (index === _cfg.widgets.length - 1) { return; }
          var tmp = _cfg.widgets[index + 1];
          _cfg.widgets[index + 1] = _cfg.widgets[index];
          _cfg.widgets[index] = tmp;
          buildWidgetList(listContainer, applyBtn);
        },
      });

      var removeBtn = el('button', {
        class: 'ded-btn',
        text: '✕',
        title: 'Remove widget',
        onclick: function () {
          _cfg.widgets.splice(index, 1);
          buildWidgetList(listContainer, applyBtn);
        },
      });

      /* ---- controls row -------------------------------------------------- */
      var controls = el('div', { class: 'ded-row-controls' }, [
        el('span', { class: 'ded-note', text: String(index + 1) }),
        el('label', { class: 'ded-note', text: ' type ' }),
        typeSelect,
        el('label', { class: 'ded-note', text: ' span ' }),
        spanInput,
        el('label', { class: 'ded-note', text: ' minH ' }),
        minHInput,
        upBtn,
        downBtn,
        removeBtn,
      ]);

      /* ---- options textarea ---------------------------------------------- */
      var optionsNote = el('span', { class: 'ded-note' });
      var optionsTa = el('textarea', {
        class: 'ded-json',
        rows: '6',
        spellcheck: 'false',
        text: JSON.stringify(widget.options || {}, null, 2),
      });
      (function (idx, ta, note) {
        ta.addEventListener('input', function () {
          try {
            var parsed = JSON.parse(ta.value);
            ta.classList.remove('invalid');
            _cfg.widgets[idx].options = parsed;
            note.textContent = '';
            applyBtn.disabled = hasInvalidTextareas(_backdrop) ? 'disabled' : null;
          } catch (e) {
            ta.classList.add('invalid');
            note.textContent = 'JSON error: ' + e.message;
            applyBtn.disabled = 'disabled';
          }
        });
      }(index, optionsTa, optionsNote));

      /* ---- bind textarea (only when present) ----------------------------- */
      var bindSection = null;
      if (widget.bind !== undefined) {
        var bindNote = el('span', { class: 'ded-note' });
        var bindTa = el('textarea', {
          class: 'ded-json',
          rows: '6',
          spellcheck: 'false',
          text: JSON.stringify(widget.bind || {}, null, 2),
        });
        (function (idx, ta, note) {
          ta.addEventListener('input', function () {
            try {
              var parsed = JSON.parse(ta.value);
              ta.classList.remove('invalid');
              _cfg.widgets[idx].bind = parsed;
              note.textContent = '';
              applyBtn.disabled = hasInvalidTextareas(_backdrop) ? 'disabled' : null;
            } catch (e) {
              ta.classList.add('invalid');
              note.textContent = 'JSON error: ' + e.message;
              applyBtn.disabled = 'disabled';
            }
          });
        }(index, bindTa, bindNote));
        bindSection = [
          el('div', { class: 'ded-note', style: { marginTop: '6px' }, text: 'bind' }),
          bindTa,
          bindNote,
        ];
      }

      /* ---- details wrapper ----------------------------------------------- */
      var detailsContent = [
        el('div', { class: 'ded-note', style: { marginBottom: '2px' }, text: 'options' }),
        optionsTa,
        optionsNote,
      ].concat(bindSection || []);

      var details = el('details', {}, [
        el('summary', { class: 'ded-note', style: { cursor: 'pointer', userSelect: 'none' },
            text: 'JSON options / bind' }),
      ]);
      detailsContent.forEach(function (child) { details.appendChild(child); });

      /* ---- full row ------------------------------------------------------- */
      var row = el('div', { class: 'ded-row' }, [controls, details]);
      listContainer.appendChild(row);
    });

    /* keep Apply enabled state consistent after a rebuild */
    applyBtn.disabled = hasInvalidTextareas(listContainer) ? 'disabled' : null;
  }

  /* ── public singleton ───────────────────────────────────────────────────── */

  SFP.ui.dashEditor = {

    /**
     * open(pageId)
     * Back-compat entry point.  When the layout editor is active it delegates
     * to the new docked widget properties panel via SFP.ui.layoutEditor._openWidgetPanel.
     * Falls back to the original full-screen modal when called outside edit mode
     * (e.g. from external tooling).
     */
    open: function (pageId) {
      /* If the layout editor is active and owns this page, use the new panel. */
      if (SFP.ui.layoutEditor && SFP.ui.layoutEditor.isActive()) {
        /* The modal is retired as a launch point; layout editor handles it. */
        return;
      }
      /* Original full-screen modal (retained for external / programmatic use). */
      var self = this;
      _pageId = pageId;

      /* deep-clone so we never mutate the live registry copy while editing */
      _cfg = deepClone(SFP.config.get('dashboard.' + pageId));

      /* ---- note element for "Reset overrides" feedback ------------------- */
      var resetNote = el('span', { class: 'ded-note', style: { flex: '1' } });

      /* ---- Apply button (forward-declared so buildWidgetList can ref it) - */
      var applyBtn = el('button', {
        class: 'ded-btn primary',
        text: 'Apply',
        onclick: function () {
          SFP.config.override('dashboard.' + _pageId, _cfg);
          var cur = SFP.ui.nav.current();
          SFP.ui.nav.navigate(cur.page, cur.params);
          self.close();
        },
      });

      /* ---- widget list container ----------------------------------------- */
      var listContainer = el('div', { class: 'ded-list' });

      /* ---- "Add widget" button ------------------------------------------- */
      var registeredTypes = SFP.widgets.types();
      var addBtn = el('button', {
        class: 'ded-btn',
        text: '+ Add widget',
        onclick: function () {
          _cfg.widgets.push({
            type: registeredTypes[0] || '',
            layout: { span: 6, minH: 200 },
            options: {},
          });
          buildWidgetList(listContainer, applyBtn);
        },
      });

      /* initial render */
      buildWidgetList(listContainer, applyBtn);

      /* ---- header --------------------------------------------------------- */
      var header = el('div', { class: 'ded-header' }, [
        el('span', { style: { fontWeight: '700' }, text: 'Edit page: ' + pageId }),
        el('button', {
          class: 'ded-btn',
          text: '×',
          title: 'Close',
          style: { fontSize: '18px', lineHeight: '1' },
          onclick: function () { self.close(); },
        }),
      ]);

      /* ---- footer --------------------------------------------------------- */
      var footer = el('div', { class: 'ded-footer' }, [
        resetNote,
        el('button', {
          class: 'ded-btn',
          text: 'Reset overrides',
          title: 'Remove persisted override from localStorage',
          onclick: function () {
            SFP.config.clearOverride('dashboard.' + _pageId);
            resetNote.textContent = 'Reload to restore file config';
          },
        }),
        el('button', {
          class: 'ded-btn',
          text: 'Export .dashboard.js',
          onclick: function () {
            SFP.config.downloadConfigJs(
              'dashboard.' + _pageId,
              _pageId + '.dashboard.js'
            );
          },
        }),
        applyBtn,
        el('button', {
          class: 'ded-btn',
          text: 'Cancel',
          onclick: function () { self.close(); },
        }),
      ]);

      /* ---- panel ---------------------------------------------------------- */
      var panel = el('div', { class: 'ded-panel' }, [
        header,
        listContainer,
        addBtn,
        footer,
      ]);

      /* ---- backdrop (clicking outside the panel closes the editor) -------- */
      _backdrop = el('div', {
        class: 'ded-backdrop',
        onclick: function (evt) {
          if (evt.target === _backdrop) { self.close(); }
        },
      }, [panel]);

      /* remove any pre-existing editor */
      var existing = document.getElementById('sfp-ded-overlay');
      if (existing && existing.parentNode) { existing.parentNode.removeChild(existing); }
      _backdrop.id = 'sfp-ded-overlay';

      document.body.appendChild(_backdrop);

      /* ---- Escape key handler -------------------------------------------- */
      _keyHandler = function (evt) {
        if (evt.key === 'Escape') { self.close(); }
      };
      document.addEventListener('keydown', _keyHandler);
    },

    /**
     * close()
     * Removes the overlay and cleans up the Escape key listener.
     */
    close: function () {
      removeBackdrop();
      if (_keyHandler) {
        document.removeEventListener('keydown', _keyHandler);
        _keyHandler = null;
      }
      _cfg = null;
      _pageId = null;
    },
  };

}(window.SFP));
