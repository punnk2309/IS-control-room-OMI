/* ============================================================================
 * SFP.twin.Minimap — overview panel showing the viewport within the factory
 * ----------------------------------------------------------------------------
 * A small always-up-to-date canvas in the corner of the twin: zone outlines
 * plus a rectangle for the current viewport. Click or drag anywhere on it to
 * move the camera there. Visibility is toggled from the toolbar
 * (store.minimapVisible); all colors come from theme tokens via the main
 * renderer's color cache.
 * ========================================================================== */
(function (SFP) {
  'use strict';

  SFP.twin = SFP.twin || {};

  function Minimap(canvasEl, renderer) {
    this.canvas = canvasEl;
    this.ctx2d = canvasEl.getContext('2d');
    this.r = renderer;                       // main TwinRenderer (colors, camera, model)
    var cfg = SFP.config.get('twin').minimap;
    this.w = cfg.width; this.h = cfg.height;

    var dpr = window.devicePixelRatio || 1;
    canvasEl.width = this.w * dpr;
    canvasEl.height = this.h * dpr;
    canvasEl.style.width = this.w + 'px';
    canvasEl.style.height = this.h + 'px';
    this.dpr = dpr;

    this._wirePointer();
  }

  /** world -> minimap scale (uniform, fits whole world with margin). */
  Minimap.prototype._scale = function () {
    var world = this.r.model.world;
    return Math.min((this.w - 12) / world.width, (this.h - 12) / world.height);
  };

  Minimap.prototype.draw = function () {
    var ctx = this.ctx2d, r = this.r, cam = r.camera;
    var k = this._scale();
    var world = r.model.world;
    var ox = (this.w - world.width * k) / 2;
    var oy = (this.h - world.height * k) / 2;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    ctx.fillStyle = r.alpha('twin-canvas', 0.92);
    ctx.fillRect(0, 0, this.w, this.h);

    /* Zones */
    r.model.zones.forEach(function (zone) {
      var z = zone.rect;
      ctx.fillStyle = r.alpha('twin-zone-border', 0.35);
      ctx.fillRect(ox + z.x * k, oy + z.y * k, z.w * k, z.h * k);
    });

    /* Viewport rectangle */
    var view = cam.visibleWorldRect();
    ctx.strokeStyle = r.colors['twin-select'];
    ctx.lineWidth = 1.5;
    ctx.strokeRect(ox + view.x * k, oy + view.y * k, view.w * k, view.h * k);

    this._ox = ox; this._oy = oy; this._k = k;
  };

  Minimap.prototype._wirePointer = function () {
    var self = this;
    var dragging = false;

    function moveCamera(e) {
      var box = self.canvas.getBoundingClientRect();
      var mx = e.clientX - box.left, my = e.clientY - box.top;
      var cam = self.r.camera;
      cam.anim = null;
      cam.cx = (mx - self._ox) / self._k;
      cam.cy = (my - self._oy) / self._k;
      cam._clamp();
    }

    this.canvas.addEventListener('pointerdown', function (e) {
      dragging = true;
      self.canvas.setPointerCapture(e.pointerId);
      moveCamera(e);
      e.stopPropagation();
    });
    this.canvas.addEventListener('pointermove', function (e) {
      if (dragging) { moveCamera(e); }
    });
    this.canvas.addEventListener('pointerup', function () { dragging = false; });
  };

  SFP.twin.Minimap = Minimap;
}(window.SFP));
