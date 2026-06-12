/* ============================================================================
 * Widget: factory-twin — interactive factory digital twin canvas
 * ----------------------------------------------------------------------------
 * The Factory Map page. Assembles the twin subsystem (src/twin/*):
 *
 *   model        config -> resolved world geometry (twin-model.js)
 *   camera       pan / zoom / fly-to / LOD       (twin-camera.js)
 *   data         binding layer over the DataHub   (twin-data.js)
 *   renderer     canvas pipeline + hit testing    (twin-renderer.js + conns)
 *   minimap      overview panel                   (twin-minimap.js)
 *   interactions gestures, tooltip, context menu  (twin-interactions.js)
 *   toolbar      zoom/search/filters/mode/theme   (twin-toolbar.js)
 *   panel        detail side panel                (twin-panels.js)
 *
 * Layout, flows and behaviour are 100% config (config/twin/*) — this file
 * never changes when zones, floors, machines or connections change.
 *
 * The render loop runs on requestAnimationFrame while the page is visible
 * (flow-dash animation is continuous); the viewport is persisted in
 * SFP.twin.store so navigation and theme switches return you to the same
 * place.
 *
 * options: {}   (everything lives in config/twin/*)
 * ========================================================================== */
(function (SFP) {
  'use strict';

  /* Shared reference to the most-recently-created editor instance.
   * editSession's adapter factory uses this to delegate to whichever editor
   * is currently live (avoids stale closures from prior widget instances). */
  var _currentEditor = null;

  /* Register the factory-map adapter once at module load.
   * DOMContentLoaded deferred so SFP.ui.editSession is available. */
  document.addEventListener('DOMContentLoaded', function () {
    if (!SFP.ui.editSession) { return; }
    SFP.ui.editSession.registerAdapter(
      /* test   */ function (pageId) { return pageId === 'factory-map'; },
      /* factory */ function () {
        if (!SFP.runtime.canEdit) { return null; }
        if (!_currentEditor) { return null; }
        /* Guard against a stale editor whose root has been detached from the
         * DOM (the old widget was destroyed but factory-twin hasn't rendered
         * the new one yet — nav:changed fires editSession._swapAdapter before
         * the shell renders the new page).  Return null here; the new widget
         * will call editSession.adapterReady() once it activates.
         * We check isConnected (standard in Edge/Chrome/Firefox) so we only
         * hand out an adapter when the twin canvas is actually in the page. */
        if (!_currentEditor.root.isConnected) { return null; }
        _currentEditor.setActive(true);
        return _currentEditor.getAdapter();
      }
    );
  });

  SFP.widgets.register('factory-twin', {
    create: function (ctx) {
      var dom = ctx.dom;
      var store = SFP.twin.store;

      /* ── DOM scaffold ──────────────────────────────────────────────── */
      var canvas = dom.el('canvas', { class: 'twin-canvas' });
      var tooltip = dom.el('div', { class: 'twin-tooltip' });
      var menu = dom.el('div', { class: 'twin-menu' });
      var minimapCanvas = dom.el('canvas', { class: 'twin-minimap' });
      var root = dom.el('div', { class: 'twin-root' }, [canvas, minimapCanvas, tooltip, menu]);
      ctx.root.appendChild(root);

      /* ── Subsystems ────────────────────────────────────────────────── */
      var model = SFP.twin.model.build();
      var twinCfg = SFP.config.get('twin');
      var camera = new SFP.twin.Camera(model.world, twinCfg.camera);
      var data = new SFP.twin.TwinData(ctx, model);

      var renderer = new SFP.twin.TwinRenderer({
        canvas: canvas, model: model, camera: camera, data: data,
        store: store, states: ctx.states, machines: ctx.machines, theme: ctx.theme,
      });
      var minimap = new SFP.twin.Minimap(minimapCanvas, renderer);
      var interactions = new SFP.twin.Interactions({
        canvas: canvas, renderer: renderer, camera: camera, model: model,
        store: store, data: data, tooltipEl: tooltip, menuEl: menu, nav: ctx.nav,
      });
      var toolbar = new SFP.twin.Toolbar({
        root: root, model: model, camera: camera, store: store, data: data,
        onBus: ctx.onBus,
      });
      var panel = new SFP.twin.DetailPanel({
        root: root, model: model, camera: camera, store: store, data: data,
        states: ctx.states, machines: ctx.machines, nav: ctx.nav, onBus: ctx.onBus,
      });

      /* Visual layout editor (header pencil toggle). Edits write config
       * overrides; this rebuild swaps the fresh model into every module. */
      function rebuildModel() {
        model = SFP.twin.model.build();
        renderer.model = model;
        interactions.model = model;
        toolbar.model = model;
        panel.model = model;
        editor.model = model;
        data._trackModel(model);       // subscribe any newly added bindings
        renderer._topoKey = null;      // force connection re-route
      }
      var editor = new SFP.twin.Editor({
        root: root, canvas: canvas, renderer: renderer, camera: camera,
        model: model, store: store, menuEl: menu, rebuild: rebuildModel,
      });
      interactions.editor = editor;

      /* Expose this editor to the module-level adapter registration. */
      _currentEditor = editor;

      /* Legacy bus wiring — fallback when editSession is not present, and
       * also handles graceful deactivation on edit:modeChanged { on:false }.
       * NOTE: _fromSession events are emitted by editSession._doExit() after
       * the user confirmed exit; the adapter's onExit already calls
       * setActive(false), so the legacy path must NOT double-fire for those. */
      ctx.onBus('edit:modeChanged', function (e) {
        if (!e.on && !e._fromSession) { editor.setActive(false); }
      });

      if (SFP.runtime.editMode) {
        editor.setActive(true);
        /* If editSession is active but had no adapter (the widget loaded after
         * nav:changed and _swapAdapter found _currentEditor === null), give it
         * the adapter now so the bar appears. */
        if (SFP.ui.editSession && SFP.ui.editSession.isActive() &&
            !SFP.ui.editSession.currentAdapter()) {
          SFP.ui.editSession.adapterReady(editor.getAdapter());
        }
      }

      /* ── Sizing ────────────────────────────────────────────────────── */
      var lastHeight = 0;
      function resize() {
        /* Fill the viewport down to the bottom edge (minus the page
         * padding) so the map hugs the bottom of the screen regardless of
         * header/tab-bar height. Guarded so the ResizeObserver this change
         * re-triggers settles instead of looping. */
        var top = root.getBoundingClientRect().top;
        var height = Math.max(420, Math.round(window.innerHeight - top - 18));
        if (height !== lastHeight) {
          lastHeight = height;
          root.style.height = height + 'px';
        }
        renderer.resize();
        /* First mount: fit the whole site; later mounts restore the saved
         * viewport (page navigation / theme switch round-trips). Skipped
         * while the widget is still detached (the dashboard renderer
         * attaches the grid after creating widgets) — the ResizeObserver
         * re-runs this once the canvas has a real size. */
        if (!sized && camera.viewW > 10) {
          sized = true;
          var saved = store.get().camera;
          if (ctx.params.zone && model.elements[ctx.params.zone]) {
            /* Deep link (#/factory-map?zone=welding): zoom to the zone. */
            camera.fitRect(model.elements[ctx.params.zone].rect, false);
          } else if (saved) {
            camera.cx = saved.cx; camera.cy = saved.cy; camera.zoom = saved.zoom;
          } else {
            camera.fitWorld(false);
          }
        }
      }
      var sized = false;
      var observer = null;
      if (typeof ResizeObserver !== 'undefined') {
        observer = new ResizeObserver(resize);
        observer.observe(root);
      }
      ctx.onBus('app:resize', resize);
      window.addEventListener('resize', resize);
      resize();

      /* Deep-link selection (the zoom itself happens on first sizing). */
      if (ctx.params.zone && model.elements[ctx.params.zone]) {
        store.select('element', ctx.params.zone);
      }

      /* ── Store-driven chrome visibility ────────────────────────────── */
      function minimapShown() {
        /* Hidden in edit mode — the palette occupies its corner. */
        return store.get().minimapVisible && !SFP.runtime.editMode;
      }
      function refreshMinimap() {
        minimapCanvas.style.display = minimapShown() ? 'block' : 'none';
      }
      var unsubStore = store.on(function (changed) {
        if (changed.indexOf('minimapVisible') >= 0) { refreshMinimap(); }
      });
      ctx.onBus('edit:modeChanged', refreshMinimap);
      refreshMinimap();

      /* ── Render loop ───────────────────────────────────────────────── */
      var rafId = null;
      var running = true;
      function frame(now) {
        if (!running) { return; }
        if (!document.hidden) {
          camera.update(now);
          renderer.draw(now);
          if (minimapShown()) { minimap.draw(); }
        }
        rafId = requestAnimationFrame(frame);
      }
      rafId = requestAnimationFrame(frame);

      return {
        resize: resize,
        destroy: function () {
          running = false;
          if (rafId) { cancelAnimationFrame(rafId); }
          if (observer) { observer.disconnect(); }
          window.removeEventListener('resize', resize);
          unsubStore();
          interactions.destroy();
          toolbar.destroy();
          panel.destroy();
          editor.destroy();
          /* Clear the module-level editor reference on destroy. */
          if (_currentEditor === editor) { _currentEditor = null; }
          /* Persist the viewport so the next visit resumes here. */
          store.set({ camera: { cx: camera.cx, cy: camera.cy, zoom: camera.zoom },
                      hover: null });
        },
      };
    },
  });
}(window.SFP));
