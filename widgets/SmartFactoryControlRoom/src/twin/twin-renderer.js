/* ============================================================================
 * SFP.twin.TwinRenderer — canvas render pipeline for the factory twin
 * ----------------------------------------------------------------------------
 * One HTML canvas, one world transform, immediate-mode drawing each frame:
 *
 *   frame:  camera.update -> clear -> grid -> zones -> subzones -> machines
 *           -> connection overlay (twin-render-connections.js)
 *           -> selection / hover outlines
 *
 * Why Canvas 2D (not SVG / WebGL): hundreds of boxes + dozens of animated
 * dashed paths redraw comfortably within a 60fps budget on Canvas 2D, with
 * no per-element DOM cost and trivial world-transform pan/zoom. Hit testing
 * is done in world coordinates against the model (rect tests + polyline
 * distance), so we never need DOM events per element. WebGL would only pay
 * off beyond ~10k animated elements.
 *
 * Theme: every color is resolved from theme tokens into `this.colors` once
 * per theme change (resolveTheme()) — render code reads the cache, never
 * literal colors, so light/dark switching is a cache refresh.
 *
 * LOD: element opacity comes from camera.lodAlpha(tier threshold); elements
 * fade in/out smoothly as the user zooms. Whatever is outside the viewport
 * is culled before any drawing work.
 *
 * The renderer also produces per-frame hit lists (hitElements, hitChips and
 * the routed `links`) that twin-interactions.js uses for picking.
 * ========================================================================== */
(function (SFP) {
  'use strict';

  SFP.twin = SFP.twin || {};

  /* Theme tokens the renderer needs, resolved once per theme change. */
  var TOKENS = [
    'twin-canvas', 'twin-grid', 'twin-grid-major',
    'twin-zone-fill', 'twin-zone-border', 'twin-zone-label',
    'twin-subzone-fill', 'twin-subzone-border',
    'twin-machine-fill', 'twin-machine-border',
    'twin-label', 'twin-label-dim', 'twin-select', 'twin-hover', 'twin-nodata',
    'good', 'warn', 'alarm', 'info', 'accent',
    'state-running', 'state-idle', 'state-maintenance', 'state-error',
    'band-high', 'band-medium', 'band-normal', 'band-low',
  ];

  function TwinRenderer(deps) {
    this.canvas = deps.canvas;
    this.ctx2d = this.canvas.getContext('2d');
    this.model = deps.model;
    this.camera = deps.camera;
    this.data = deps.data;
    this.store = deps.store;
    this.states = deps.states;          // state engine (zone tint, machine state)
    this.machines = deps.machines;      // machine registry (error counts)
    this.theme = deps.theme;
    this.cfg = SFP.config.get('twin');
    /* requestRender is set by the widget after construction (twin-frame loop). */
    this.requestRender = deps.requestRender || function () {};

    this.colors = {};
    this.dpr = window.devicePixelRatio || 1;
    this.links = [];                    // routed links (rebuilt on topology change)
    this._topoKey = null;
    this.hitElements = [];              // [{ el, alpha }] in pick priority order
    this.hitChips = [];                 // floor selector chips drawn on canvas
    this.resolveTheme();
  }

  /** Re-resolve every theme token (call on 'theme:changed'). */
  TwinRenderer.prototype.resolveTheme = function () {
    var self = this;
    TOKENS.forEach(function (token) { self.colors[token] = self.theme.color(token); });
    this.cfg.utilities.forEach(function (u) { self.colors[u.color] = self.theme.color(u.color); });
  };

  /** Resize canvas backing store to its CSS box (call on container resize). */
  TwinRenderer.prototype.resize = function () {
    var box = this.canvas.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.round(box.width * this.dpr));
    this.canvas.height = Math.max(1, Math.round(box.height * this.dpr));
    this.camera.setViewport(box.width, box.height);
  };

  /** rgba() from a cached hex color. */
  TwinRenderer.prototype.alpha = function (token, a) {
    var hex = this.colors[token] || token;
    var m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
    if (!m) { return hex; }
    return 'rgba(' + parseInt(m[1], 16) + ',' + parseInt(m[2], 16) + ',' +
      parseInt(m[3], 16) + ',' + a + ')';
  };

  /* ── Image helper ──────────────────────────────────────────────────────── */

  /**
   * _drawElementImage(ctx, el, r)
   * If el has an `image` config object ({ src, fit }), draw it clipped to r.
   * Returns true when an image was drawn (so the caller can skip the plain fill
   * but must still draw the border, status tint, and labels on top).
   * Returns false when there is no image, image is still loading, or broken.
   *
   * A broken-image warning glyph is drawn at the top-right corner of r so the
   * operator can see that an image was configured but failed to load.
   */
  TwinRenderer.prototype._drawElementImage = function (ctx, el, r) {
    var img = el.image;
    if (!img || !img.src) { return false; }
    var self = this;
    var drawn = SFP.twin.imageCache.drawImage(
      ctx, img.src, r, img.fit || 'stretch',
      function () { self.requestRender(); }
    );
    if (drawn) { return true; }

    /* false means broken — draw a small warning glyph. */
    if (SFP.twin.imageCache.get(img.src, null) === false) {
      var z = this.camera.zoom;
      ctx.save();
      ctx.fillStyle = this.colors['twin-nodata'] || '#f59e0b';
      ctx.font = '600 ' + (10 / z) + 'px "Segoe UI", system-ui, sans-serif';
      ctx.textBaseline = 'top';
      ctx.textAlign = 'right';
      ctx.fillText('⚠ img', r.x + r.w - 4 / z, r.y + 4 / z);
      ctx.textAlign = 'left';
      ctx.restore();
    }
    /* null = still loading — nothing extra to draw; re-render will fire. */
    return false;
  };

  /* ── Frame ─────────────────────────────────────────────────────────────── */

  TwinRenderer.prototype.draw = function (now) {
    var ctx = this.ctx2d, cam = this.camera, dpr = this.dpr;

    /* Re-route connections only when zoom tier / floors change. */
    var topoKey = SFP.twin.router.topologyKey(this.model, this.store, cam);
    if (topoKey !== this._topoKey) {
      this._topoKey = topoKey;
      this.links = SFP.twin.router.buildLinks(this.model, this.store, cam);
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = this.colors['twin-canvas'];
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    /* World transform: world units in, screen pixels out. Screen-constant
     * sizes (line widths, fonts) divide by cam.zoom from here on. */
    var tx = this.camera.viewW / 2 - cam.cx * cam.zoom;
    var ty = this.camera.viewH / 2 - cam.cy * cam.zoom;
    ctx.setTransform(cam.zoom * dpr, 0, 0, cam.zoom * dpr, tx * dpr, ty * dpr);

    var view = cam.visibleWorldRect();
    this.hitElements = [];
    this.hitChips = [];

    this._drawGrid(ctx, view);
    this._drawZones(ctx, view);
    this._drawSubzones(ctx, view);
    this._drawMachines(ctx, view);
    if (this.store.get().connectionsVisible) {
      SFP.twin.connRenderer.draw(ctx, this, now);
      this._drawExternalNodes(ctx, view);
    }
    this._drawSelection(ctx);

    /* Editor overlay hook (resize handles, polygon preview, stamp ghost) —
     * still inside the world transform. */
    if (this.overlayDraw) { this.overlayDraw(ctx, now); }
  };

  function intersects(r, view) {
    return r.x < view.x + view.w && r.x + r.w > view.x &&
           r.y < view.y + view.h && r.y + r.h > view.y;
  }

  /* ── Background grid ───────────────────────────────────────────────────── */

  TwinRenderer.prototype._drawGrid = function (ctx, view) {
    var g = this.cfg.grid;
    if (!g.show || this.camera.zoom < g.minZoom) { return; }
    var z = this.camera.zoom;
    var x0 = Math.floor(view.x / g.minor) * g.minor;
    var y0 = Math.floor(view.y / g.minor) * g.minor;
    ctx.lineWidth = 1 / z;
    for (var x = x0; x <= view.x + view.w; x += g.minor) {
      ctx.strokeStyle = (x % g.major === 0) ? this.colors['twin-grid-major'] : this.colors['twin-grid'];
      ctx.beginPath(); ctx.moveTo(x, view.y); ctx.lineTo(x, view.y + view.h); ctx.stroke();
    }
    for (var y = y0; y <= view.y + view.h; y += g.minor) {
      ctx.strokeStyle = (y % g.major === 0) ? this.colors['twin-grid-major'] : this.colors['twin-grid'];
      ctx.beginPath(); ctx.moveTo(view.x, y); ctx.lineTo(view.x + view.w, y); ctx.stroke();
    }
  };

  /* ── Zones ─────────────────────────────────────────────────────────────── */

  TwinRenderer.prototype._drawZones = function (ctx, view) {
    var self = this, z = this.camera.zoom, format = SFP.format;
    var statusCfg = this.cfg.zoneStatus;

    this.model.zones.forEach(function (zone) {
      if (!intersects(zone.rect, view)) { return; }
      var r = zone.rect;

      /* Status tint from the zone's bound datapoint via the state group. */
      var tint = null, statusColor = null, statusValue = null;
      if (zone.statusBinding) {
        statusValue = self.data.num(zone.statusBinding);
        if (statusValue !== null) {
          var stateId = self.states.evaluateRules(statusCfg.stateGroup, statusValue);
          statusColor = self.states.stateDef(statusCfg.stateGroup, stateId).color;
          tint = self.alpha(statusColor, statusCfg.fillAlpha);
        }
      }

      /* Polygon zones trace their outline; rect zones use rounded rects. */
      var shapePath = zone.poly
        ? function () { self._tracePoly(ctx, zone.poly); }
        : function () { self._roundRect(ctx, r, 6); };

      /* 1. Base fill (always — gives a background when image is transparent). */
      ctx.fillStyle = self.colors['twin-zone-fill'];
      shapePath();
      ctx.fill();

      /* 2. Image (if configured) — drawn after base fill, before tint/border.
       *    Element-level image first; if the active floor also has an image it
       *    composites on top (floor images are per-floor floorplan overlays).
       *    For polygon zones we use rect-clip (polygon clip is deferred). */
      self._drawElementImage(ctx, zone, r);
      if (zone.floors) {
        var activeFloorId = self.store.activeFloor(zone);
        var activeFloor = null;
        zone.floors.forEach(function (f) { if (f.id === activeFloorId) { activeFloor = f; } });
        if (activeFloor && activeFloor.image) {
          self._drawElementImage(ctx, activeFloor, r);
        }
      }

      /* 3. Status tint as translucent overlay so state colors read through. */
      if (tint) { ctx.fillStyle = tint; shapePath(); ctx.fill(); }

      /* 4. Border. */
      ctx.strokeStyle = statusColor ? self.alpha(statusColor, 0.7) : self.colors['twin-zone-border'];
      ctx.lineWidth = 1.5 / z;
      shapePath();
      ctx.stroke();

      /* Label (always) + aggregate value (only while zoomed out). */
      ctx.fillStyle = self.colors['twin-zone-label'];
      ctx.font = '600 ' + (13 / z) + 'px "Segoe UI", system-ui, sans-serif';
      ctx.textBaseline = 'top';
      ctx.fillText(zone.label, r.x + 10 / z, r.y + 8 / z);

      var valueAlpha = 1 - self.camera.lodAlpha(self.cfg.lod.machine);
      if (statusValue !== null && valueAlpha > 0.05) {
        var def = self.data.hub.def(zone.statusBinding) || {};
        ctx.globalAlpha = valueAlpha;
        ctx.fillStyle = self.colors['twin-label-dim'];
        ctx.font = (11 / z) + 'px "Segoe UI", system-ui, sans-serif';
        ctx.fillText(format.number(statusValue, 0) + ' ' + (def.unit || ''),
          r.x + 10 / z, r.y + 26 / z);
        ctx.globalAlpha = 1;
      } else if (zone.statusBinding && self.data.noData(zone.statusBinding) && valueAlpha > 0.05) {
        ctx.globalAlpha = valueAlpha;
        ctx.fillStyle = self.colors['twin-nodata'];
        ctx.font = (11 / z) + 'px "Segoe UI", system-ui, sans-serif';
        ctx.fillText('no data', r.x + 10 / z, r.y + 26 / z);
        ctx.globalAlpha = 1;
      }

      /* Machine-error badge (independent of the energy band). */
      var counts = self.machines.counts(zone.id);
      if (counts.error) {
        ctx.fillStyle = self.colors.alarm;
        ctx.font = '700 ' + (12 / z) + 'px "Segoe UI", system-ui, sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText('⚠ ' + counts.error, r.x + r.w - 10 / z, r.y + 8 / z);
        ctx.textAlign = 'left';
      }

      /* Floor chip for multi-floor zones (click target -> cycle floor). */
      if (zone.floors) { self._drawFloorChip(ctx, zone, r); }

      self.hitElements.push({ el: zone, alpha: 1 });
    });
  };

  /* ── Subzones ──────────────────────────────────────────────────────────── */

  TwinRenderer.prototype._drawSubzones = function (ctx, view) {
    var self = this, z = this.camera.zoom;
    var lod = this.cfg.lod;
    var alpha = this.camera.lodAlpha(lod.subzone);
    if (alpha <= 0.02) { return; }
    var labelOn = z >= lod.subzoneLabelMin;

    this.model.order.forEach(function (id) {
      var el = self.model.elements[id];
      if (el.kind !== 'subzone' || !intersects(el.rect, view)) { return; }
      if (!SFP.twin.router.gatesActive(self.model, self.store, el)) { return; }
      var r = el.rect;

      ctx.globalAlpha = alpha;

      /* Polygon subzones trace their outline; rect subzones use rounded rects. */
      var subShapePath = el.poly
        ? function () { self._tracePoly(ctx, el.poly); }
        : function () { self._roundRect(ctx, r, 4); };

      /* 1. Base fill. */
      ctx.fillStyle = self.colors['twin-subzone-fill'];
      subShapePath();
      ctx.fill();

      /* 2. Image (if configured) — element-level then active-floor overlay. */
      self._drawElementImage(ctx, el, r);
      if (el.floors) {
        var activeSubFloorId = self.store.activeFloor(el);
        var activeSubFloor = null;
        el.floors.forEach(function (f) { if (f.id === activeSubFloorId) { activeSubFloor = f; } });
        if (activeSubFloor && activeSubFloor.image) {
          self._drawElementImage(ctx, activeSubFloor, r);
        }
      }

      /* 3. Border. */
      ctx.strokeStyle = self.colors['twin-subzone-border'];
      ctx.lineWidth = 1 / z;
      subShapePath();
      ctx.stroke();

      if (labelOn) {
        ctx.fillStyle = self.colors['twin-label-dim'];
        ctx.font = '600 ' + (10.5 / z) + 'px "Segoe UI", system-ui, sans-serif';
        ctx.textBaseline = 'top';
        ctx.fillText(el.label, r.x + 8 / z, r.y + 6 / z);
      }
      if (el.floors) { self._drawFloorChip(ctx, el, r); }
      ctx.globalAlpha = 1;

      if (alpha > 0.4) { self.hitElements.push({ el: el, alpha: alpha }); }
    });
  };

  /* ── Machines ──────────────────────────────────────────────────────────── */

  TwinRenderer.prototype._drawMachines = function (ctx, view) {
    var self = this, z = this.camera.zoom;
    var lod = this.cfg.lod;
    var alpha = this.camera.lodAlpha(lod.machine);
    if (alpha <= 0.02) { return; }
    var labelOn = z >= lod.machineLabelMin;
    var badgeAlpha = this.camera.lodAlpha(lod.detail);
    var live = SFP.runtime.mode === 'live';

    this.model.order.forEach(function (id) {
      var el = self.model.elements[id];
      if (el.kind !== 'machine' || !intersects(el.rect, view)) { return; }
      if (!SFP.twin.router.gatesActive(self.model, self.store, el)) { return; }
      var r = el.rect;

      /* State color from the machine state group; no-data grey in live.
       * visual:true elements are decorative — skip data-state logic entirely. */
      if (el.visual) {
        ctx.globalAlpha = alpha;
        ctx.fillStyle = self.colors['twin-machine-fill'];
        ctx.strokeStyle = self.colors['twin-machine-border'];
        ctx.lineWidth = 1.5 / z;
        var vr = el.rect;
        if (el.shape === 'circle') {
          var vcx = vr.x + vr.w / 2, vcy = vr.y + vr.h / 2, vrad = Math.min(vr.w, vr.h) / 2;
          ctx.beginPath(); ctx.arc(vcx, vcy, vrad, 0, Math.PI * 2); ctx.fill();
          ctx.beginPath(); ctx.arc(vcx, vcy, vrad, 0, Math.PI * 2); ctx.stroke();
        } else {
          self._roundRect(ctx, vr, el.shape === 'round' ? vr.h / 2 : 3); ctx.fill();
          self._roundRect(ctx, vr, el.shape === 'round' ? vr.h / 2 : 3); ctx.stroke();
        }
        self._drawElementImage(ctx, el, vr);
        if (labelOn) {
          ctx.fillStyle = self.colors['twin-label'];
          ctx.font = '600 ' + (9.5 / z) + 'px "Segoe UI", system-ui, sans-serif';
          ctx.textAlign = 'center'; ctx.textBaseline = 'top';
          ctx.fillText(el.label, vr.x + vr.w / 2, vr.y + vr.h + 4 / z);
          ctx.textAlign = 'left';
        }
        ctx.globalAlpha = 1;
        if (alpha > 0.4) { self.hitElements.push({ el: el, alpha: alpha }); }
        return;
      }
      var stateBinding = el.bindings.state && el.bindings.state.datapoint;
      var noData = stateBinding ? self.data.noData(stateBinding)
        : (el.bindings.value ? self.data.noData(el.bindings.value.datapoint) : live);
      var borderColor = self.colors['twin-machine-border'];
      if (stateBinding && !noData) {
        var raw = self.data.value(stateBinding);
        if (raw !== null) {
          var stateId = self.states.normalize('machine', raw);
          borderColor = self.colors[self.states.stateDef('machine', stateId).color] || borderColor;
        }
      }
      if (noData) { borderColor = self.colors['twin-nodata']; }

      ctx.globalAlpha = alpha;
      ctx.fillStyle = self.colors['twin-machine-fill'];
      ctx.strokeStyle = borderColor;
      ctx.lineWidth = 1.5 / z;
      if (noData) { ctx.setLineDash([4 / z, 3 / z]); }

      /* 1. Base shape fill. */
      if (el.shape === 'circle') {
        var cx = r.x + r.w / 2, cy = r.y + r.h / 2, rad = Math.min(r.w, r.h) / 2;
        ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2);
        ctx.fill();
      } else {
        self._roundRect(ctx, r, el.shape === 'round' ? r.h / 2 : 3);
        ctx.fill();
      }

      /* 2. Image (if configured) — always rect-clipped for simplicity. */
      self._drawElementImage(ctx, el, r);

      /* 3. Border (drawn on top of image). */
      if (el.shape === 'circle') {
        ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        self._roundRect(ctx, r, el.shape === 'round' ? r.h / 2 : 3);
        ctx.stroke();
      }
      ctx.setLineDash([]);

      if (labelOn) {
        ctx.fillStyle = noData ? self.colors['twin-nodata'] : self.colors['twin-label'];
        ctx.font = '600 ' + (9.5 / z) + 'px "Segoe UI", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(el.label, r.x + r.w / 2, r.y + r.h + 4 / z);
        ctx.textAlign = 'left';
      }

      /* Value badge inside the box at full detail. */
      if (badgeAlpha > 0.05 && el.bindings.value) {
        var vb = el.bindings.value;
        var v = self.data.num(vb.datapoint);
        ctx.globalAlpha = alpha * badgeAlpha;
        ctx.fillStyle = (v === null) ? self.colors['twin-nodata'] : self.colors['twin-label'];
        ctx.font = '700 ' + (10 / z) + 'px "Segoe UI", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(v === null ? '—' : SFP.format.number(v, 0) + ' ' + (vb.unit || ''),
          r.x + r.w / 2, r.y + r.h / 2);
        ctx.textAlign = 'left';
      }
      ctx.globalAlpha = 1;

      if (alpha > 0.4) { self.hitElements.push({ el: el, alpha: alpha }); }
    });
  };

  /** Off-site endpoints (grid, dispatch, …) drawn as ring nodes so flows
   *  entering/leaving the factory terminate visibly. */
  TwinRenderer.prototype._drawExternalNodes = function (ctx, view) {
    var self = this, z = this.camera.zoom;
    (this.model.externalNodes || []).forEach(function (el) {
      if (!intersects(el.rect, view)) { return; }
      var r = el.rect;
      var cx = r.x + r.w / 2, cy = r.y + r.h / 2;
      var radius = Math.min(r.w, r.h) / 2;

      /* Soft halo behind the ring. */
      ctx.fillStyle = self.alpha('accent', 0.12);
      ctx.beginPath();
      ctx.arc(cx, cy, radius + 7 / z, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = self.colors['twin-zone-fill'];
      ctx.strokeStyle = self.colors.accent;
      ctx.lineWidth = 2 / z;
      ctx.setLineDash([6 / z, 4 / z]);       // dashed ring = system boundary
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = self.colors.accent;
      ctx.font = '700 ' + (10 / z) + 'px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(el.label, cx, r.y - 6 / z);
      ctx.textBaseline = 'middle';
      ctx.font = '600 ' + (9 / z) + 'px "Segoe UI", system-ui, sans-serif';
      ctx.fillText('⇄', cx, cy);
      ctx.textAlign = 'left';

      self.hitElements.push({ el: el, alpha: 1 });
    });
  };

  /* ── Floor selector chip (canvas hit target) ───────────────────────────── */

  TwinRenderer.prototype._drawFloorChip = function (ctx, el, r) {
    var z = this.camera.zoom;
    var floorId = this.store.activeFloor(el);
    var floor = null;
    el.floors.forEach(function (f) { if (f.id === floorId) { floor = f; } });
    var text = (floor ? floor.label.split('—')[0].trim() : floorId) +
      '  ' + (el.floors.indexOf(floor) + 1) + '/' + el.floors.length + ' ⇅';
    ctx.font = '600 ' + (10 / z) + 'px "Segoe UI", system-ui, sans-serif';
    var w = ctx.measureText(text).width + 16 / z;
    var h = 18 / z;
    var chip = { x: r.x + r.w - w - 8 / z, y: r.y + r.h - h - 8 / z, w: w, h: h };

    ctx.fillStyle = this.alpha('accent', 0.16);
    this._roundRect(ctx, chip, h / 2);
    ctx.fill();
    ctx.strokeStyle = this.alpha('accent', 0.6);
    ctx.lineWidth = 1 / z;
    this._roundRect(ctx, chip, h / 2);
    ctx.stroke();
    ctx.fillStyle = this.colors.accent;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, chip.x + 8 / z, chip.y + h / 2);

    this.hitChips.push({ ownerId: el.id, rect: chip });
  };

  /* ── Selection / hover outlines ────────────────────────────────────────── */

  TwinRenderer.prototype._drawSelection = function (ctx) {
    var state = this.store.get();
    var z = this.camera.zoom;
    var self = this;

    function outline(id, token) {
      var el = self.model.elements[id];
      if (!el || !SFP.twin.router.isRendered(self.model, self.store, self.camera, el)) { return; }
      ctx.strokeStyle = self.colors[token];
      ctx.lineWidth = 2.5 / z;
      ctx.setLineDash([]);
      var pad = 3 / z;
      var r = el.rect;

      /* Trace the same geometry the element was drawn with, just padded —
       * a generic rectangle around a circle/pill machine looks misaligned. */
      if (el.poly) {
        self._tracePoly(ctx, el.poly);
        ctx.stroke();
        return;
      }
      if (el.kind === 'machine' && el.shape === 'circle') {
        var rad = Math.min(r.w, r.h) / 2 + pad;
        ctx.beginPath();
        ctx.arc(r.x + r.w / 2, r.y + r.h / 2, rad, 0, Math.PI * 2);
        ctx.stroke();
        return;
      }
      var radius = el.kind === 'zone' ? 6
        : el.kind === 'subzone' ? 4
        : el.shape === 'round' ? (r.h + pad * 2) / 2 : 3;
      self._roundRect(ctx, { x: r.x - pad, y: r.y - pad,
        w: r.w + pad * 2, h: r.h + pad * 2 }, radius + pad);
      ctx.stroke();
    }

    if (state.hover && state.hover.kind === 'element' &&
        (!state.selection || state.selection.id !== state.hover.id)) {
      outline(state.hover.id, 'twin-hover');
    }
    if (state.selection && state.selection.kind === 'element') {
      outline(state.selection.id, 'twin-select');
    }
  };

  TwinRenderer.prototype._tracePoly = function (ctx, pts) {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (var i = 1; i < pts.length; i++) { ctx.lineTo(pts[i].x, pts[i].y); }
    ctx.closePath();
  };

  TwinRenderer.prototype._roundRect = function (ctx, r, radius) {
    var rad = Math.min(radius, r.w / 2, r.h / 2);
    ctx.beginPath();
    ctx.moveTo(r.x + rad, r.y);
    ctx.arcTo(r.x + r.w, r.y, r.x + r.w, r.y + r.h, rad);
    ctx.arcTo(r.x + r.w, r.y + r.h, r.x, r.y + r.h, rad);
    ctx.arcTo(r.x, r.y + r.h, r.x, r.y, rad);
    ctx.arcTo(r.x, r.y, r.x + r.w, r.y, rad);
    ctx.closePath();
  };

  /* ── Hit testing (world coordinates) ───────────────────────────────────── */

  /** Pick the topmost interactive thing at a world point.
   *  Priority: floor chips > machines > connections > subzones > zones —
   *  flow lines crossing a zone stay clickable, but never steal clicks
   *  from a machine box. */
  TwinRenderer.prototype.hitTest = function (worldPt) {
    var i, item;

    for (i = this.hitChips.length - 1; i >= 0; i--) {
      item = this.hitChips[i];
      if (inRect(worldPt, item.rect)) { return { kind: 'floorChip', id: item.ownerId }; }
    }

    var machineHit = this._hitKind(worldPt, 'machine') || this._hitKind(worldPt, 'external');
    if (machineHit) { return machineHit; }

    if (this.store.get().connectionsVisible) {
      var tol = this.cfg.connections.hitTolerancePx / this.camera.zoom;
      var best = null, bestDist = tol;
      this.links.forEach(function (link) {
        var d = SFP.twin.router.distToPolyline(worldPt, link.points);
        if (d <= bestDist) { best = link; bestDist = d; }
      });
      if (best) { return { kind: 'link', link: best, id: best.connections[0].id }; }
    }

    return this._hitKind(worldPt, 'subzone') || this._hitKind(worldPt, 'zone');
  };

  TwinRenderer.prototype._hitKind = function (worldPt, kind) {
    for (var i = this.hitElements.length - 1; i >= 0; i--) {
      var item = this.hitElements[i];
      if (item.el.kind === kind && hitsElement(worldPt, item.el)) {
        return { kind: 'element', id: item.el.id };
      }
    }
    return null;
  };

  function inRect(p, r) {
    return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
  }

  /** Hit test against the element's drawn geometry (circles aren't rects). */
  function hitsElement(p, el) {
    if (el.shape === 'circle' && (el.kind === 'machine' || el.kind === 'external')) {
      var r = el.rect;
      var rad = Math.min(r.w, r.h) / 2;
      var dx = p.x - (r.x + r.w / 2), dy = p.y - (r.y + r.h / 2);
      return dx * dx + dy * dy <= rad * rad;
    }
    if (el.poly) { return pointInPoly(p, el.poly); }
    return inRect(p, el.rect);
  }

  /** Ray-casting point-in-polygon. */
  function pointInPoly(p, pts) {
    var inside = false;
    for (var i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      var xi = pts[i].x, yi = pts[i].y, xj = pts[j].x, yj = pts[j].y;
      if ((yi > p.y) !== (yj > p.y) &&
          p.x < (xj - xi) * (p.y - yi) / (yj - yi) + xi) { inside = !inside; }
    }
    return inside;
  }

  SFP.twin.TwinRenderer = TwinRenderer;
}(window.SFP));
