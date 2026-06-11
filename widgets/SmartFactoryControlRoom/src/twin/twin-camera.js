/* ============================================================================
 * SFP.twin.Camera — pan/zoom viewport for the twin canvas
 * ----------------------------------------------------------------------------
 * The camera is { cx, cy, zoom }: world point at the screen centre and
 * screen-pixels-per-world-unit. All world<->screen math lives here so the
 * renderers and interaction code never duplicate transform logic.
 *
 *   camera.worldToScreen({x,y})   camera.screenToWorld({x,y})
 *   camera.zoomAt(screenPt, factor)        wheel / pinch zoom at a point
 *   camera.panByScreen(dxPx, dyPx)         drag pan
 *   camera.fitRect(worldRect, animate)     zoom-to-fit / zoom-to-zone
 *   camera.update(now)                     advance fly animation (render loop)
 *
 * LOD: lodAlpha(threshold) returns 0..1 opacity for a detail tier that fades
 * in over the configured fadeBand around its zoom threshold.
 * ========================================================================== */
(function (SFP) {
  'use strict';

  SFP.twin = SFP.twin || {};

  function easeInOut(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }

  function Camera(world, cfg) {
    this.world = world;                     // { width, height }
    this.cfg = cfg;                         // twin.config camera section
    this.viewW = 1; this.viewH = 1;         // set via setViewport()
    this.cx = world.width / 2;
    this.cy = world.height / 2;
    this.zoom = 1;
    this.anim = null;                       // { from:{}, to:{}, start, dur }
    this.lodCfg = SFP.config.get('twin').lod;
  }

  Camera.prototype.setViewport = function (wPx, hPx) {
    this.viewW = Math.max(1, wPx);
    this.viewH = Math.max(1, hPx);
  };

  /* ── Transforms ────────────────────────────────────────────────────────── */

  Camera.prototype.worldToScreen = function (p) {
    return { x: (p.x - this.cx) * this.zoom + this.viewW / 2,
             y: (p.y - this.cy) * this.zoom + this.viewH / 2 };
  };

  Camera.prototype.screenToWorld = function (p) {
    return { x: (p.x - this.viewW / 2) / this.zoom + this.cx,
             y: (p.y - this.viewH / 2) / this.zoom + this.cy };
  };

  /** World-space rectangle currently visible (for culling). */
  Camera.prototype.visibleWorldRect = function () {
    var w = this.viewW / this.zoom, h = this.viewH / this.zoom;
    return { x: this.cx - w / 2, y: this.cy - h / 2, w: w, h: h };
  };

  /* ── Movement ──────────────────────────────────────────────────────────── */

  Camera.prototype.panByScreen = function (dxPx, dyPx) {
    this.anim = null;
    this.cx -= dxPx / this.zoom;
    this.cy -= dyPx / this.zoom;
    this._clamp();
  };

  /** Zoom by `factor`, keeping the world point under `screenPt` stationary. */
  Camera.prototype.zoomAt = function (screenPt, factor) {
    this.anim = null;
    var before = this.screenToWorld(screenPt);
    this.zoom = Math.min(this.cfg.maxZoom, Math.max(this.cfg.minZoom, this.zoom * factor));
    var after = this.screenToWorld(screenPt);
    this.cx += before.x - after.x;
    this.cy += before.y - after.y;
    this._clamp();
  };

  /** Animate to fit a world rect into the viewport (or jump if animate=false). */
  Camera.prototype.fitRect = function (rect, animate) {
    var pad = this.cfg.fitPadding;
    var zoom = Math.min((this.viewW - pad * 2) / rect.w, (this.viewH - pad * 2) / rect.h);
    zoom = Math.min(this.cfg.maxZoom, Math.max(this.cfg.minZoom, zoom));
    var target = { cx: rect.x + rect.w / 2, cy: rect.y + rect.h / 2, zoom: zoom };
    if (!animate) {
      this.cx = target.cx; this.cy = target.cy; this.zoom = target.zoom;
      this._clamp();
      return;
    }
    this.anim = {
      from: { cx: this.cx, cy: this.cy, zoom: this.zoom },
      to: target, start: performance.now(), dur: this.cfg.flyMs,
    };
  };

  Camera.prototype.fitWorld = function (animate) {
    this.fitRect({ x: 0, y: 0, w: this.world.width, h: this.world.height }, animate);
  };

  /** Advance fly animation. Returns true while animating (keeps loop hot). */
  Camera.prototype.update = function (now) {
    if (!this.anim) { return false; }
    var a = this.anim;
    var t = Math.min(1, (now - a.start) / a.dur);
    var k = easeInOut(t);
    /* Interpolate zoom logarithmically so the fly feels uniform. */
    this.zoom = Math.exp(Math.log(a.from.zoom) + (Math.log(a.to.zoom) - Math.log(a.from.zoom)) * k);
    this.cx = a.from.cx + (a.to.cx - a.from.cx) * k;
    this.cy = a.from.cy + (a.to.cy - a.from.cy) * k;
    if (t >= 1) { this.anim = null; }
    return !!this.anim;
  };

  Camera.prototype._clamp = function () {
    if (!this.cfg.bounded) { return; }
    var slack = this.cfg.boundsSlack;
    this.cx = Math.min(this.world.width + slack, Math.max(-slack, this.cx));
    this.cy = Math.min(this.world.height + slack, Math.max(-slack, this.cy));
  };

  /* ── Level of detail ───────────────────────────────────────────────────── */

  /** 0..1 visibility for a tier that starts at `thresholdZoom`. */
  Camera.prototype.lodAlpha = function (thresholdZoom) {
    var band = this.lodCfg.fadeBand;
    return Math.min(1, Math.max(0, (this.zoom - thresholdZoom) / band + 1));
    /* zoom == threshold -> alpha 1; fades down to 0 across `band` below it */
  };

  /** Discrete LOD level 0-3 (used for behaviour switches, not opacity). */
  Camera.prototype.lodLevel = function () {
    if (this.zoom >= this.lodCfg.detail) { return 3; }
    if (this.zoom >= this.lodCfg.machine) { return 2; }
    if (this.zoom >= this.lodCfg.subzone) { return 1; }
    return 0;
  };

  SFP.twin.Camera = Camera;
}(window.SFP));
