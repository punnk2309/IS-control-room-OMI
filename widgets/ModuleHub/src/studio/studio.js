/* ============================================================================
 * ModuleHub Studio — in-browser module editor (MHB.studio)
 * ----------------------------------------------------------------------------
 * Plain-JS IIFE, no build step, no ES modules (contracts §10).
 * Depends on (must be loaded before this file):
 *   src/core/namespace.js, src/core/bus.js, src/core/theme.js
 *   src/runtime/sandbox.js, src/runtime/loader.js   (preview reuses preview())
 *   src/studio/studio-zip.js
 *
 * Public API (attached to MHB.studio):
 *   .open()   — show the full-screen Studio overlay
 *   .close()  — hide it
 *
 * Draft persistence:
 *   MHB.storeClient.op('kv.put', { ns:'_studio', key:'draft:<id>', value:{manifest,code} })
 *   Keys are enumerated via kv.get on a sentinel list key '_studio_ids'.
 *
 * Preview:
 *   Uses MHB.runtime.preview(manifest, codeText, containerEl) added to loader.js.
 *   Wired into simulation mode (same random-walk timers as the normal loader).
 *
 * Feature flags / v1 scope:
 *   - "Publish to server library" button is rendered disabled (v2).
 *   - ZIP import supports stored + deflate; zip64/encryption → toast error.
 *   - Falls back to JSON-bundle (.mhmod.json) if zip write verification fails
 *     (the verification step runs synchronously after build; it's expected to pass).
 * ============================================================================ */
(function (MHB) {
  'use strict';

  /* ── Constants ─────────────────────────────────────────────────────────── */

  var DRAFT_LIST_KEY = '_studio_ids';
  var DRAFT_NS       = '_studio';
  var SDK_BASE       = 'src/sdk/';

  /* ── State ──────────────────────────────────────────────────────────────── */

  var _overlay        = null;   // root overlay element
  var _draftList      = null;   // sidebar list element
  var _currentDraftId = null;   // id of the draft open in the editor
  var _drafts         = {};     // { id: { manifest, code } } — in-memory mirror
  var _saveTimer      = null;   // debounce handle
  var _previewState   = null;   // { bridge, iframe, simTimers } or null
  var _previewConsole = null;   // DOM element for preview log strip
  var _lintResult     = null;   // DOM element for lint status

  /* ── Counter for "New from template" unique ids ─────────────────────────── */
  var _newModuleCounter = 1;

  /* ── Smoke template seed ─────────────────────────────────────────────────── */

  var TEMPLATE_MANIFEST = {
    id:      'my-module-1',
    name:    'My Module',
    version: '1.0.0',
    minSdk:  '1.0',
    entry:   'main.js',
    permissions: { tags: [], store: [] },
    config:  {},
  };

  var TEMPLATE_CODE = [
    '/* My Module — built with ModuleHub Studio */',
    'MH.register({',
    '  create: function (sdk, root) {',
    '    sdk.log(\'create called\');',
    '    var el = sdk.ui.el;',
    '    root.appendChild(',
    '      el(\'div\', {',
    '        style: {',
    '          display: \'flex\', alignItems: \'center\', justifyContent: \'center\',',
    '          height: \'100%\',',
    '          color: \'var(--c-accent,#38bdf8)\',',
    '          fontFamily: "\'Segoe UI\', system-ui, sans-serif",',
    '          fontSize: \'20px\',',
    '        }',
    '      }, [\'Hello from My Module!\'])',
    '    );',
    '  },',
    '  destroy: function () {},',
    '});',
  ].join('\n');

  /* ── Utility helpers ─────────────────────────────────────────────────────── */

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'style' && typeof attrs[k] === 'object') {
          Object.assign(node.style, attrs[k]);
        } else if (k === 'class') {
          node.className = attrs[k];
        } else if (k.indexOf('on') === 0 && typeof attrs[k] === 'function') {
          node.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
        } else {
          node.setAttribute(k, attrs[k]);
        }
      });
    }
    if (children) {
      (Array.isArray(children) ? children : [children]).forEach(function (c) {
        if (c == null) { return; }
        node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
      });
    }
    return node;
  }

  function showToast(msg, kind) {
    var toast = el('div', { class: 'mhb-toast mhb-toast--' + (kind || 'info') });
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(function () { if (toast.parentNode) { toast.parentNode.removeChild(toast); } }, 3500);
  }

  /* ── Deep-clone a plain object ───────────────────────────────────────────── */

  function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  /* ── Semver patch-bump "1.2.3" → "1.2.4" ───────────────────────────────── */

  function bumpPatch(version) {
    var parts = String(version || '1.0.0').split('.');
    while (parts.length < 3) { parts.push('0'); }
    parts[2] = String((parseInt(parts[2], 10) || 0) + 1);
    return parts.join('.');
  }

  /* ── Draft ID list persistence ───────────────────────────────────────────── */

  function saveDraftIdList(ids) {
    if (!MHB.storeClient || typeof MHB.storeClient.op !== 'function') { return; }
    MHB.storeClient.op('kv.put', { ns: DRAFT_NS, key: DRAFT_LIST_KEY, value: ids })
      .catch(function (e) { console.warn('[MHB.studio] saveDraftIdList error:', e); });
  }

  function loadDraftIdList() {
    if (!MHB.storeClient || typeof MHB.storeClient.op !== 'function') {
      return Promise.resolve([]);
    }
    return MHB.storeClient.op('kv.get', { ns: DRAFT_NS, key: DRAFT_LIST_KEY })
      .then(function (val) { return Array.isArray(val) ? val : []; })
      .catch(function () { return []; });
  }

  /* ── Single-draft persistence ─────────────────────────────────────────────── */

  function saveDraft(id, manifest, code) {
    if (!MHB.storeClient || typeof MHB.storeClient.op !== 'function') { return; }
    MHB.storeClient.op('kv.put', {
      ns:    DRAFT_NS,
      key:   'draft:' + id,
      value: { manifest: manifest, code: code },
    }).catch(function (e) { console.warn('[MHB.studio] saveDraft error:', e); });
  }

  function loadDraft(id) {
    if (!MHB.storeClient || typeof MHB.storeClient.op !== 'function') {
      return Promise.resolve(null);
    }
    return MHB.storeClient.op('kv.get', { ns: DRAFT_NS, key: 'draft:' + id })
      .then(function (val) { return (val && val.manifest && val.code != null) ? val : null; })
      .catch(function () { return null; });
  }

  function deleteDraftStore(id) {
    if (!MHB.storeClient || typeof MHB.storeClient.op !== 'function') { return; }
    /* kv.put with null effectively marks it deleted; a real delete op isn't in the v1 schema */
    MHB.storeClient.op('kv.put', { ns: DRAFT_NS, key: 'draft:' + id, value: null })
      .catch(function (e) { console.warn('[MHB.studio] deleteDraftStore error:', e); });
  }

  /* ── Debounced auto-save ─────────────────────────────────────────────────── */

  function scheduleAutoSave(id, manifest, code) {
    if (_saveTimer) { clearTimeout(_saveTimer); }
    _saveTimer = setTimeout(function () {
      _saveTimer = null;
      if (_drafts[id]) {
        saveDraft(id, manifest, code);
      }
    }, 1000);
  }

  /* ── Load all drafts from store on studio open ───────────────────────────── */

  function loadAllDrafts() {
    return loadDraftIdList().then(function (ids) {
      if (!ids.length) {
        /* First time — seed with a welcome draft */
        return seedDefaultDraft().then(function () { return Object.keys(_drafts); });
      }
      var promises = ids.map(function (id) {
        return loadDraft(id).then(function (d) {
          if (d) { _drafts[id] = d; }
        });
      });
      return Promise.all(promises).then(function () {
        var loaded = ids.filter(function (id) { return !!_drafts[id]; });
        return loaded;
      });
    });
  }

  function seedDefaultDraft() {
    var manifest = deepClone(TEMPLATE_MANIFEST);
    manifest.id   = 'my-module-1';
    manifest.name = 'My Module';
    _drafts['my-module-1'] = { manifest: manifest, code: TEMPLATE_CODE };
    saveDraft('my-module-1', manifest, TEMPLATE_CODE);
    saveDraftIdList(['my-module-1']);
    return Promise.resolve();
  }

  /* ── Collect IDs currently in _drafts ───────────────────────────────────── */

  function draftIds() {
    return Object.keys(_drafts).filter(function (id) { return !!_drafts[id]; });
  }

  /* ── Build the Studio overlay DOM ────────────────────────────────────────── */

  function buildOverlay() {
    var overlay = el('div', { id: 'mhb-studio-overlay', class: 'mhb-studio-overlay' });

    /* ── Header ─────────────────────────────────────────────────────────── */
    var header = el('div', { class: 'mhb-studio-header' }, [
      el('span', { class: 'mhb-studio-title' }, ['Studio']),
      el('button', { class: 'mhb-btn mhb-studio-close-btn', onclick: function () { MHB.studio.close(); } }, ['Close']),
    ]);

    /* ── Sidebar ────────────────────────────────────────────────────────── */
    var sidebarHeader = el('div', { class: 'mhb-studio-sidebar-header' }, [
      el('span', { class: 'mhb-studio-sidebar-title' }, ['Drafts']),
    ]);

    var sidebarBtns = el('div', { class: 'mhb-studio-sidebar-actions' }, [
      el('button', { class: 'mhb-btn mhb-studio-btn-new', onclick: onNewFromTemplate }, ['+ New from template']),
      el('button', { class: 'mhb-btn mhb-studio-btn-import', onclick: onImportClick }, ['Import .mhmod']),
    ]);

    /* Hidden file input for import */
    var fileInput = el('input', { type: 'file', accept: '.mhmod,.mhmod.json,.zip', style: { display: 'none' } });
    fileInput.addEventListener('change', onFileImport);

    _draftList = el('ul', { class: 'mhb-studio-draft-list' });

    var sidebar = el('div', { class: 'mhb-studio-sidebar' }, [
      sidebarHeader, sidebarBtns, fileInput, _draftList,
    ]);
    sidebar._fileInput = fileInput;   /* stash for the import button handler */

    /* ── Main editing area ──────────────────────────────────────────────── */
    var main = buildMainArea();

    /* ── Body ───────────────────────────────────────────────────────────── */
    var body = el('div', { class: 'mhb-studio-body' }, [sidebar, main]);

    overlay.appendChild(header);
    overlay.appendChild(body);

    /* stash ref for import button */
    overlay._fileInput = fileInput;

    return overlay;
  }

  /* ── Main area ────────────────────────────────────────────────────────────── */

  var _manifestForm  = null;   // { id, name, version, tags, store, config, configErr }
  var _codeArea      = null;   // <textarea>
  var _lineColEl     = null;   // line/col indicator
  var _previewPane   = null;   // container div for preview iframe

  function buildMainArea() {
    /* ── Zone A: Manifest form ─────────────────────────────────────────── */
    var fldId      = el('input', { class: 'mhb-studio-input', placeholder: 'my-module', id: 'mhbs-fld-id' });
    var fldName    = el('input', { class: 'mhb-studio-input', placeholder: 'My Module', id: 'mhbs-fld-name' });
    var fldVersion = el('input', { class: 'mhb-studio-input', placeholder: '1.0.0',    id: 'mhbs-fld-version' });
    var fldEntry   = el('input', { class: 'mhb-studio-input mhb-studio-input--readonly', value: 'main.js',   id: 'mhbs-fld-entry',  readonly: 'true' });
    var fldMinSdk  = el('input', { class: 'mhb-studio-input mhb-studio-input--readonly', value: '1.0',       id: 'mhbs-fld-minsdk', readonly: 'true' });
    var fldTags    = el('input', { class: 'mhb-studio-input', placeholder: 'smoke.*, dryer.*', id: 'mhbs-fld-tags' });
    var fldStore   = el('input', { class: 'mhb-studio-input', placeholder: 'smoke, my-ns',    id: 'mhbs-fld-store' });
    var fldConfig  = el('textarea', { class: 'mhb-studio-textarea mhb-studio-config', placeholder: '{}', rows: '4', id: 'mhbs-fld-config' });
    var configErr  = el('div', { class: 'mhb-studio-field-error', style: { display: 'none' } });

    fldConfig.addEventListener('blur', function () {
      var raw = fldConfig.value.trim() || '{}';
      try {
        JSON.parse(raw);
        configErr.style.display = 'none';
      } catch (e) {
        configErr.textContent = 'Invalid JSON: ' + e.message;
        configErr.style.display = 'block';
      }
      triggerAutoSave();
    });

    [fldId, fldName, fldVersion, fldTags, fldStore].forEach(function (f) {
      f.addEventListener('input', triggerAutoSave);
    });

    _manifestForm = { id: fldId, name: fldName, version: fldVersion, entry: fldEntry,
                      minSdk: fldMinSdk, tags: fldTags, store: fldStore,
                      config: fldConfig, configErr: configErr };

    var manifestZone = el('div', { class: 'mhb-studio-zone mhb-studio-manifest' }, [
      el('div', { class: 'mhb-studio-zone-title' }, ['Manifest']),
      el('div', { class: 'mhb-studio-form-grid' }, [
        fieldRow('ID',           fldId),
        fieldRow('Name',         fldName),
        fieldRow('Version',      fldVersion),
        fieldRow('Entry',        fldEntry),
        fieldRow('Min SDK',      fldMinSdk),
        fieldRow('Tags (perms)', fldTags),
        fieldRow('Store (perms)',fldStore),
        el('div', { class: 'mhb-studio-field-row mhb-studio-field-row--full' }, [
          el('label', { class: 'mhb-studio-label' }, ['Config (JSON)']),
          fldConfig,
          configErr,
        ]),
      ]),
    ]);

    /* ── Zone B: Code editor ────────────────────────────────────────────── */
    _codeArea = el('textarea', {
      class: 'mhb-studio-textarea mhb-studio-code',
      spellcheck: 'false',
      placeholder: '/* module code */',
    });
    _codeArea.setAttribute('autocomplete', 'off');
    _codeArea.setAttribute('autocorrect', 'off');
    _codeArea.setAttribute('autocapitalize', 'off');

    /* Tab → 2 spaces */
    _codeArea.addEventListener('keydown', function (e) {
      if (e.key === 'Tab') {
        e.preventDefault();
        var s = _codeArea.selectionStart;
        var v = _codeArea.value;
        _codeArea.value = v.substring(0, s) + '  ' + v.substring(_codeArea.selectionEnd);
        _codeArea.selectionStart = _codeArea.selectionEnd = s + 2;
      }
    });

    /* Line/col indicator */
    _lineColEl = el('span', { class: 'mhb-studio-linecol' }, ['Ln 1, Col 1']);
    _codeArea.addEventListener('click',   updateLineCol);
    _codeArea.addEventListener('keyup',   updateLineCol);
    _codeArea.addEventListener('input', function () { updateLineCol(); triggerAutoSave(); });

    _lintResult = el('div', { class: 'mhb-studio-lint-result', style: { display: 'none' } });

    var lintBtn = el('button', { class: 'mhb-btn', onclick: runLint }, ['Lint']);

    var codeZone = el('div', { class: 'mhb-studio-zone mhb-studio-codezone' }, [
      el('div', { class: 'mhb-studio-zone-title' }, [
        el('span', {}, ['Code']),
        el('div', { class: 'mhb-studio-code-toolbar' }, [_lineColEl, lintBtn]),
      ]),
      _codeArea,
      _lintResult,
    ]);

    /* ── Zone C: Live preview ───────────────────────────────────────────── */
    _previewPane    = el('div', { class: 'mhb-studio-preview-frame' });
    _previewConsole = el('div', { class: 'mhb-studio-preview-console', style: { display: 'none' } });

    var runBtn  = el('button', { class: 'mhb-btn mhb-btn--accent', onclick: runPreview }, ['Run preview']);
    var stopBtn = el('button', { class: 'mhb-btn', onclick: stopPreview }, ['Stop']);
    var pubBtn  = el('button', { class: 'mhb-btn', onclick: onPublish, title: 'Publish to server module library' }, ['Publish to server library']);

    var previewZone = el('div', { class: 'mhb-studio-zone mhb-studio-previewzone' }, [
      el('div', { class: 'mhb-studio-zone-title' }, [
        el('span', {}, ['Live Preview']),
        el('div', { class: 'mhb-studio-preview-toolbar' }, [runBtn, stopBtn, pubBtn]),
      ]),
      _previewPane,
      _previewConsole,
    ]);

    return el('div', { class: 'mhb-studio-main' }, [manifestZone, codeZone, previewZone]);
  }

  function fieldRow(label, input) {
    return el('div', { class: 'mhb-studio-field-row' }, [
      el('label', { class: 'mhb-studio-label' }, [label]),
      input,
    ]);
  }

  /* ── Line/col update ─────────────────────────────────────────────────────── */

  function updateLineCol() {
    if (!_codeArea || !_lineColEl) { return; }
    var text  = _codeArea.value.substring(0, _codeArea.selectionStart);
    var lines = text.split('\n');
    var ln    = lines.length;
    var col   = lines[lines.length - 1].length + 1;
    _lineColEl.textContent = 'Ln ' + ln + ', Col ' + col;
  }

  /* ── Read form → manifest object ─────────────────────────────────────────── */

  function readManifestFromForm() {
    var id      = (_manifestForm.id.value    || '').trim();
    var name    = (_manifestForm.name.value  || '').trim() || id;
    var version = (_manifestForm.version.value || '1.0.0').trim();
    var tagsRaw = (_manifestForm.tags.value  || '').trim();
    var storeRaw= (_manifestForm.store.value || '').trim();
    var tags    = tagsRaw  ? tagsRaw.split(',').map(function (s) { return s.trim(); }).filter(Boolean)  : [];
    var store   = storeRaw ? storeRaw.split(',').map(function (s) { return s.trim(); }).filter(Boolean) : [];
    var configStr = (_manifestForm.config.value || '').trim() || '{}';
    var config = {};
    try { config = JSON.parse(configStr); } catch (e) { /* keep {} */ }
    return {
      id:      id,
      name:    name,
      version: version,
      minSdk:  '1.0',
      entry:   'main.js',
      permissions: { tags: tags, store: store },
      config:  config,
    };
  }

  /* ── Populate form from manifest ─────────────────────────────────────────── */

  function setFormFromManifest(manifest) {
    _manifestForm.id.value      = manifest.id      || '';
    _manifestForm.name.value    = manifest.name    || '';
    _manifestForm.version.value = manifest.version || '1.0.0';
    var p = manifest.permissions || {};
    _manifestForm.tags.value    = (p.tags  || []).join(', ');
    _manifestForm.store.value   = (p.store || []).join(', ');
    _manifestForm.config.value  = JSON.stringify(manifest.config || {}, null, 2);
    _manifestForm.configErr.style.display = 'none';
  }

  /* ── Auto-save trigger (reads form and schedules debounced save) ─────────── */

  function triggerAutoSave() {
    if (!_currentDraftId) { return; }
    var manifest = readManifestFromForm();
    var code     = _codeArea ? _codeArea.value : '';
    /* Update in-memory mirror immediately */
    if (_drafts[_currentDraftId]) {
      _drafts[_currentDraftId].manifest = manifest;
      _drafts[_currentDraftId].code     = code;
    }
    scheduleAutoSave(_currentDraftId, manifest, code);
  }

  /* ── Lint ─────────────────────────────────────────────────────────────────── */

  function runLint() {
    if (!_codeArea || !_lintResult) { return; }
    var code = _codeArea.value;
    var errors = [];

    /* Syntax check */
    try {
      new Function(code);   /* eslint-disable-line no-new-func */
    } catch (e) {
      errors.push('Syntax error: ' + e.message);
    }

    /* Must contain MH.register */
    if (code.indexOf('MH.register') === -1) {
      errors.push('Missing MH.register(…) call');
    }

    /* Balanced braces (rudimentary) */
    var open = 0, close = 0;
    for (var i = 0; i < code.length; i++) {
      if (code[i] === '{') { open++; }
      if (code[i] === '}') { close++; }
    }
    if (open !== close) {
      errors.push('Unbalanced braces: ' + open + ' opening vs ' + close + ' closing');
    }

    _lintResult.style.display = 'block';
    if (errors.length === 0) {
      _lintResult.className = 'mhb-studio-lint-result mhb-studio-lint--ok';
      _lintResult.textContent = 'Lint OK — no issues found.';
    } else {
      _lintResult.className = 'mhb-studio-lint-result mhb-studio-lint--error';
      _lintResult.textContent = errors.join(' | ');
    }
  }

  /* ── Rebuild draft list sidebar ───────────────────────────────────────────── */

  function refreshDraftList() {
    if (!_draftList) { return; }
    _draftList.innerHTML = '';
    var ids = draftIds();
    if (ids.length === 0) {
      _draftList.appendChild(el('li', { class: 'mhb-studio-draft-empty' }, ['No drafts yet.']));
      return;
    }
    ids.forEach(function (id) {
      var d = _drafts[id];
      var displayName = (d && d.manifest && d.manifest.name) ? d.manifest.name : id;
      var isActive = (id === _currentDraftId);

      var openBtn = el('button', { class: 'mhb-studio-draft-open' + (isActive ? ' mhb-studio-draft-open--active' : ''),
        onclick: function () { openDraft(id); } }, [displayName]);

      var exportBtn = el('button', { class: 'mhb-studio-draft-action', title: 'Export .mhmod',
        onclick: function () { exportDraft(id); } }, ['⬇']);

      var bumpBtn = el('button', { class: 'mhb-studio-draft-action', title: 'Bump patch version',
        onclick: function () { bumpVersion(id); } }, ['⬆']);

      var delBtn = el('button', { class: 'mhb-studio-draft-action mhb-studio-draft-del', title: 'Delete draft',
        onclick: function () { deleteDraft(id); } }, ['✕']);

      _draftList.appendChild(el('li', { class: 'mhb-studio-draft-item' + (isActive ? ' mhb-studio-draft-item--active' : '') },
        [openBtn, exportBtn, bumpBtn, delBtn]));
    });
  }

  /* ── Open a draft into the editor ─────────────────────────────────────────── */

  function openDraft(id) {
    var d = _drafts[id];
    if (!d) { return; }
    _currentDraftId = id;
    setFormFromManifest(d.manifest);
    if (_codeArea) { _codeArea.value = d.code || ''; }
    if (_lintResult) { _lintResult.style.display = 'none'; }
    stopPreview();
    refreshDraftList();
  }

  /* ── Create new draft from template ─────────────────────────────────────── */

  function onNewFromTemplate() {
    /* Find a unique id */
    var base;
    do {
      base = 'my-module-' + _newModuleCounter++;
    } while (_drafts[base]);

    var manifest = deepClone(TEMPLATE_MANIFEST);
    manifest.id   = base;
    manifest.name = 'My Module ' + (_newModuleCounter - 1);

    var code = TEMPLATE_CODE.replace(/my-module-1/g, base);

    _drafts[base] = { manifest: deepClone(manifest), code: code };
    saveDraft(base, manifest, code);
    saveDraftIdList(draftIds());

    refreshDraftList();
    openDraft(base);
    showToast('New draft created: ' + base, 'good');
  }

  /* ── Delete draft ────────────────────────────────────────────────────────── */

  function deleteDraft(id) {
    if (!_drafts[id]) { return; }
    delete _drafts[id];
    deleteDraftStore(id);
    saveDraftIdList(draftIds());
    if (_currentDraftId === id) {
      _currentDraftId = null;
      stopPreview();
      if (_manifestForm) {
        _manifestForm.id.value = _manifestForm.name.value = _manifestForm.version.value = '';
        _manifestForm.tags.value = _manifestForm.store.value = _manifestForm.config.value = '';
      }
      if (_codeArea) { _codeArea.value = ''; }
    }
    refreshDraftList();
    showToast('Draft deleted: ' + id, 'warn');
  }

  /* ── Bump version (patch +1) ────────────────────────────────────────────── */

  function bumpVersion(id) {
    var d = _drafts[id];
    if (!d) { return; }
    d.manifest.version = bumpPatch(d.manifest.version);
    saveDraft(id, d.manifest, d.code);
    if (_currentDraftId === id && _manifestForm) {
      _manifestForm.version.value = d.manifest.version;
    }
    refreshDraftList();
    showToast('Version bumped to ' + d.manifest.version, 'info');
  }

  /* ── Export .mhmod ───────────────────────────────────────────────────────── */

  function exportDraft(id) {
    var d = _drafts[id];
    if (!id || !d) { return; }
    /* Read latest form if it's the active draft */
    var manifest = (id === _currentDraftId) ? readManifestFromForm() : deepClone(d.manifest);
    var code     = (id === _currentDraftId && _codeArea) ? _codeArea.value : (d.code || '');

    var manifestJson = JSON.stringify(manifest, null, 2);
    var filename     = manifest.id + '-v' + manifest.version + '.mhmod';

    /* Attempt ZIP build + verify */
    var zipBytes = null;
    var zipOk    = false;
    try {
      zipBytes = MHB.studio.zip.build([
        { name: 'module.json', data: manifestJson },
        { name: 'main.js',     data: code         },
      ]);
      /* Quick verify: parse back and check both files present */
      var vResult = MHB.studio.zip.parseSyncPartial(zipBytes);
      zipOk = !vResult.error &&
              vResult.files['module.json'] !== undefined &&
              vResult.files['main.js']     !== undefined;
    } catch (e) {
      console.warn('[MHB.studio] ZIP build failed:', e);
      zipOk = false;
    }

    if (zipOk) {
      triggerDownload(zipBytes, filename, 'application/zip');
    } else {
      /* Fallback: JSON bundle */
      var fallbackFilename = filename + '.json';
      var bundle = JSON.stringify({ mhmod: 1, manifest: manifest, files: { 'main.js': code } });
      var textBytes = new TextEncoder().encode(bundle);
      triggerDownload(textBytes, fallbackFilename, 'application/json');
      showToast('ZIP fallback: exported as ' + fallbackFilename + ' (JSON bundle)', 'warn');
      console.warn('[MHB.studio] ZIP verification failed — exported as JSON bundle: ' + fallbackFilename);
    }
  }

  function triggerDownload(bytes, filename, mimeType) {
    var blob = new Blob([bytes], { type: mimeType });
    var url  = URL.createObjectURL(blob);
    var a    = el('a', { href: url, download: filename, style: { display: 'none' } });
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(url);
      if (a.parentNode) { a.parentNode.removeChild(a); }
    }, 1000);
  }

  /* ── Import .mhmod ───────────────────────────────────────────────────────── */

  function onImportClick() {
    if (_overlay && _overlay._fileInput) {
      _overlay._fileInput.value = '';
      _overlay._fileInput.click();
    }
  }

  function onFileImport(event) {
    var file = event.target.files && event.target.files[0];
    if (!file) { return; }

    var reader = new FileReader();
    reader.onload = function (e) {
      var bytes = new Uint8Array(e.target.result);

      /* Detect JSON bundle by checking first byte ('{' = 0x7B) */
      if (bytes[0] === 0x7B) {
        importFromJsonBundle(bytes);
        return;
      }

      /* Try ZIP */
      MHB.studio.zip.parseAsync(bytes).then(function (result) {
        if (result.error) {
          showToast('Import failed: ' + result.error, 'alarm');
          return;
        }
        var manifestBytes = result.files['module.json'];
        if (!manifestBytes) {
          showToast('Import failed: module.json not found in archive', 'alarm');
          return;
        }
        var manifestStr = MHB.studio.zip._decodeUtf8(manifestBytes);
        var manifest, code;
        try { manifest = JSON.parse(manifestStr); } catch (pe) {
          showToast('Import failed: module.json parse error — ' + pe.message, 'alarm');
          return;
        }
        var entryName = manifest.entry || 'main.js';
        var codeBytes = result.files[entryName];
        if (!codeBytes) {
          showToast('Import failed: entry file "' + entryName + '" not in archive', 'alarm');
          return;
        }
        code = MHB.studio.zip._decodeUtf8(codeBytes);
        importDraftObject(manifest, code, file.name);
      }).catch(function (err) {
        showToast('Import error: ' + String(err && err.message || err), 'alarm');
      });
    };
    reader.readAsArrayBuffer(file);
  }

  function importFromJsonBundle(bytes) {
    var str;
    try { str = MHB.studio.zip._decodeUtf8(bytes); } catch (e) {
      showToast('Import failed: cannot decode file', 'alarm'); return;
    }
    var bundle;
    try { bundle = JSON.parse(str); } catch (pe) {
      showToast('Import failed: JSON parse error — ' + pe.message, 'alarm'); return;
    }
    if (!bundle || bundle.mhmod !== 1 || !bundle.manifest || !bundle.files) {
      showToast('Import failed: not a valid .mhmod.json bundle', 'alarm'); return;
    }
    var code = bundle.files[bundle.manifest.entry || 'main.js'] || '';
    importDraftObject(bundle.manifest, code, 'bundle');
  }

  function importDraftObject(manifest, code, sourceName) {
    if (!manifest.id) {
      showToast('Import failed: manifest missing "id"', 'alarm'); return;
    }
    /* Avoid overwriting existing draft with same id — suffix if clash */
    var id = manifest.id;
    if (_drafts[id]) {
      id = id + '-imported-' + Date.now();
      manifest = deepClone(manifest);
      manifest.id = id;
    }
    _drafts[id] = { manifest: deepClone(manifest), code: code };
    saveDraft(id, manifest, code);
    saveDraftIdList(draftIds());
    refreshDraftList();
    openDraft(id);
    showToast('Imported "' + manifest.name + '" from ' + sourceName, 'good');
  }

  /* ── Publish to server library ──────────────────────────────────────────── */

  function onPublish() {
    if (!_currentDraftId) { showToast('Open a draft first', 'warn'); return; }

    var client = MHB.storeClient;
    if (!client || typeof client.op !== 'function' || client.status() !== 'service') {
      showToast('Publish requires a storeUrl / service connection', 'warn'); return;
    }

    var manifest = readManifestFromForm();
    var code     = _codeArea ? _codeArea.value : '';

    if (!manifest.id) { showToast('Module ID is required to publish', 'warn'); return; }

    doPublish(manifest, code, false);
  }

  function doPublish(manifest, code, force) {
    var client = MHB.storeClient;
    client.op('mod.publish', { manifest: manifest, files: { 'main.js': code }, force: force })
      .then(function (result) {
        showToast('published ' + result.id + ' v' + result.version, 'good');
        /* Refresh shell dropdown so the new library module appears */
        MHB.bus.emit('registry:refresh', {});
      })
      .catch(function (err) {
        var msg = err && err.message ? err.message : String(err);
        if (msg.indexOf('version-conflict') === 0) {
          /* Offer force re-publish inline */
          var confirmed = window.confirm(
            'Version already exists in the library.\nForce re-publish (overwrite)?'
          );
          if (confirmed) {
            doPublish(manifest, code, true);
          }
          return;
        }
        showToast('Publish failed: ' + msg, 'alarm');
      });
  }

  /* ── Live preview ─────────────────────────────────────────────────────────── */

  function runPreview() {
    if (!_currentDraftId) { showToast('Open a draft first', 'warn'); return; }
    stopPreview();

    var manifest = readManifestFromForm();
    var code     = _codeArea ? _codeArea.value : '';

    if (!manifest.id) { showToast('Module ID is required', 'warn'); return; }

    if (_previewConsole) {
      _previewConsole.innerHTML = '';
      _previewConsole.style.display = 'none';
    }

    /* Delegate to MHB.runtime.preview (added to loader.js) */
    if (!MHB.runtime || typeof MHB.runtime.preview !== 'function') {
      showToast('Preview runtime not available', 'alarm'); return;
    }

    MHB.runtime.preview(manifest, code, _previewPane, function (state) {
      /* state = { bridge, iframe, simTimers } returned by runtime.preview */
      _previewState = state;
    }, function (logEntry) {
      /* log callback: { level, args } */
      appendPreviewLog(logEntry.level, logEntry.args);
    });
  }

  function stopPreview() {
    if (!_previewState) { return; }
    var s = _previewState;
    _previewState = null;

    if (s.simTimers) {
      Object.keys(s.simTimers).forEach(function (t) { clearInterval(s.simTimers[t]); });
    }
    if (s.bridge) {
      try { s.bridge.sendDestroy(); } catch (e) { /* ignore */ }
      setTimeout(function () {
        if (s.bridge) { s.bridge.dispose(); }
        if (s.iframe && s.iframe.parentNode) { s.iframe.parentNode.removeChild(s.iframe); }
      }, 100);
    } else if (s.iframe && s.iframe.parentNode) {
      s.iframe.parentNode.removeChild(s.iframe);
    }
  }

  function appendPreviewLog(level, args) {
    if (!_previewConsole) { return; }
    _previewConsole.style.display = 'block';
    var text = (Array.isArray(args) ? args : [args]).map(function (a) {
      return (typeof a === 'object') ? JSON.stringify(a) : String(a);
    }).join(' ');
    var line = el('div', { class: 'mhb-studio-console-line mhb-studio-console-' + (level || 'log') },
      ['[' + (level || 'log') + '] ' + text]);
    _previewConsole.appendChild(line);
    _previewConsole.scrollTop = _previewConsole.scrollHeight;
  }

  /* ── Public API ───────────────────────────────────────────────────────────── */

  MHB.studio = MHB.studio || {};

  MHB.studio.open = function () {
    if (_overlay) {
      _overlay.style.display = 'flex';
      return;
    }

    _overlay = buildOverlay();
    document.body.appendChild(_overlay);

    /* Load drafts from store */
    loadAllDrafts().then(function (ids) {
      ids.forEach(function (id) {
        if (_drafts[id] && !_drafts[id].manifest) {
          delete _drafts[id];
        }
      });
      refreshDraftList();
      /* Auto-open first draft */
      var available = draftIds();
      if (available.length > 0 && !_currentDraftId) {
        openDraft(available[0]);
      }
    }).catch(function (err) {
      console.warn('[MHB.studio] loadAllDrafts error:', err);
      refreshDraftList();
    });
  };

  MHB.studio.close = function () {
    stopPreview();
    if (_overlay) { _overlay.style.display = 'none'; }
  };

  /* Expose for testing */
  MHB.studio._bumpPatch  = bumpPatch;
  MHB.studio._crc32test  = function (s) {
    return MHB.studio.zip && MHB.studio.zip._crc32(MHB.studio.zip._encodeUtf8(s));
  };

}(window.MHB));
