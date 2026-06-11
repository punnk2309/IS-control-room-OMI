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

      /* ── Sizing ────────────────────────────────────────────────────── */
      function resize() {
        renderer.resize();
        /* First mount: fit the whole site; later mounts restore the saved
         * viewport (page navigation / theme switch round-trips). */
        if (!sized) {
          sized = true;
          var saved = store.get().camera;
          if (saved) {
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

      /* Deep-link support: #/factory-map?zone=welding zooms to the zone. */
      if (ctx.params.zone && model.elements[ctx.params.zone]) {
        camera.fitRect(model.elements[ctx.params.zone].rect, false);
        store.select('element', ctx.params.zone);
      }

      /* ── Store-driven chrome visibility ────────────────────────────── */
      var unsubStore = store.on(function (changed) {
        if (changed.indexOf('minimapVisible') >= 0) {
          minimapCanvas.style.display = store.get().minimapVisible ? 'block' : 'none';
        }
      });
      minimapCanvas.style.display = store.get().minimapVisible ? 'block' : 'none';

      /* ── Render loop ───────────────────────────────────────────────── */
      var rafId = null;
      var running = true;
      function frame(now) {
        if (!running) { return; }
        if (!document.hidden) {
          camera.update(now);
          renderer.draw(now);
          if (store.get().minimapVisible) { minimap.draw(); }
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
          /* Persist the viewport so the next visit resumes here. */
          store.set({ camera: { cx: camera.cx, cy: camera.cy, zoom: camera.zoom },
                      hover: null });
        },
      };
    },
  });
}(window.SFP));
