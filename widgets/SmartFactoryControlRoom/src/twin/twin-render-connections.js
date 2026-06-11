/* ============================================================================
 * SFP.twin.connRenderer — flow line overlay (drawn above the hierarchy)
 * ----------------------------------------------------------------------------
 * Draws the routed links produced by twin-router.js with all live styling:
 *
 *   thickness   maps |value| across flowRange to widthMinPx..widthMaxPx,
 *               with a gentle zoom boost so lines never go paper-thin
 *   direction   animated marching dashes + arrow heads ('both' = arrows
 *               at both ends, 'none' = plain line)
 *   inactive    |value| below `inactiveBelow` of range, or a rule with
 *               style:'inactive' -> faded static dash
 *   no data     live mode, binding unwired/waiting -> grey dashed + label
 *   rules       first matching rule may recolor the line and attach a
 *               warning badge (e.g. "Low return — check traps")
 *   filters     utilities toggled off are dimmed or hidden (filterMode)
 *   aggregation links carrying several config connections show 'Σn' and a
 *               summed value
 *   risers      endpoints on an inactive floor get a "⇅ floor" chip
 *
 * Label placement is greedy: a label is skipped if it would overlap one
 * already placed this frame (screen-space test).
 * ========================================================================== */
(function (SFP) {
  'use strict';

  SFP.twin = SFP.twin || {};

  var router = null;   // bound lazily (load order safety)

  SFP.twin.connRenderer = {

    /** Draw all links. `r` is the TwinRenderer (gives colors, camera, data). */
    draw: function (ctx, r, now) {
      router = SFP.twin.router;
      var cfg = r.cfg.connections;
      var z = r.camera.zoom;
      var state = r.store.get();
      var filterMode = state.filterMode || r.cfg.filters.defaultMode;
      var placedLabels = [];   // screen rects, for collision avoidance
      var self = this;

      /* Stable paint order; hovered/selected link drawn last (on top). */
      var hoverKey = state.hover && state.hover.kind === 'link' ? state.hover.key : null;
      var links = r.links.slice().sort(function (a, b) {
        return (a.key === hoverKey ? 1 : 0) - (b.key === hoverKey ? 1 : 0);
      });

      /* Whole overlay fades out below connections.minZoom, and each link
       * additionally fades with the LOD tier of its endpoints — a
       * machine-to-machine line appears/disappears with the machines,
       * exactly like the boxes do. Zone-level links carry the overview. */
      var overlayAlpha = Math.min(1, Math.max(0,
        (r.camera.zoom - cfg.minZoom) / r.cfg.lod.fadeBand + 1));
      if (overlayAlpha <= 0.02) { return; }

      function tierThreshold(el) {
        if (el.kind === 'machine') { return r.cfg.lod.machine; }
        if (el.kind === 'subzone') { return r.cfg.lod.subzone; }
        return 0;                          // zones + external nodes: always
      }

      /* Dash sizing: screen-constant while zoomed out, world-locked once
       * zoomed past dashZoomCap. Without the cap, a factory-length line at
       * high zoom is re-dashed into thousands of segments every frame —
       * that is a hard frame-rate killer. */
      var zd = Math.min(z, 1.5);
      var view = r.camera.visibleWorldRect();
      var cullPad = 80;          // world units; keeps lines entering the view

      links.forEach(function (link) {
        var filteredOut = !r.store.utilityOn(link.utility);
        if (filteredOut && filterMode === 'hide') { return; }

        /* Viewport culling: skip links whose bounding box is off-screen. */
        var bb = self._bbox(link);
        if (bb.x0 > view.x + view.w + cullPad || bb.x1 < view.x - cullPad ||
            bb.y0 > view.y + view.h + cullPad || bb.y1 < view.y - cullPad) { return; }

        var lodAlpha = overlayAlpha * r.camera.lodAlpha(
          Math.max(tierThreshold(link.fromEl), tierThreshold(link.toEl)));
        if (lodAlpha <= 0.02) { return; }

        var style = self._styleOf(link, r, cfg);
        var isHover = hoverKey === link.key;
        var isSelected = state.selection && state.selection.kind === 'connection' &&
          link.connections.some(function (c) { return c.id === state.selection.id; });

        var alpha = style.alpha * lodAlpha;
        if (filteredOut) { alpha = r.cfg.filters.dimAlpha * lodAlpha; }
        if (isHover || isSelected) { alpha = 1; }

        var width = style.widthPx + ((isHover || isSelected) ? 1.5 : 0);

        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = isSelected ? r.colors['twin-select'] : style.color;
        ctx.lineWidth = width / z;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        if (style.dash) {
          ctx.setLineDash([style.dash[0] / zd, style.dash[1] / zd]);
          ctx.lineDashOffset = style.dashOffset(now) / zd;
        }
        self._strokePolyline(ctx, link.points, cfg.cornerRadius);
        ctx.setLineDash([]);

        /* Arrow heads (direction). */
        if (style.flowing && !filteredOut) {
          var dir = link.connections[0].direction;
          if (dir === 'forward' || dir === 'both') {
            self._arrow(ctx, link.points, 0.55, width / z, false);
          }
          if (dir === 'reverse' || dir === 'both') {
            self._arrow(ctx, link.points, 0.45, width / z, true);
          }
        }

        /* Riser chips for cross-floor endpoints. */
        if (link.offFloorFrom) { self._riserChip(ctx, r, link.points, 0.04, link.offFloorFrom); }
        if (link.offFloorTo) { self._riserChip(ctx, r, link.points, 0.96, link.offFloorTo); }

        /* Value label + warning badge. */
        if (!filteredOut && (z >= cfg.labelMinZoom || isHover || isSelected)) {
          self._label(ctx, r, link, style, placedLabels, isHover || isSelected);
        }
        ctx.restore();
      });
    },

    /** Cached world-space bounding box of a link's route (for culling). */
    _bbox: function (link) {
      if (link._bbox) { return link._bbox; }
      var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      link.points.forEach(function (p) {
        if (p.x < x0) { x0 = p.x; } if (p.x > x1) { x1 = p.x; }
        if (p.y < y0) { y0 = p.y; } if (p.y > y1) { y1 = p.y; }
      });
      link._bbox = { x0: x0, y0: y0, x1: x1, y1: y1 };
      return link._bbox;
    },

    /* ── Per-link style resolution ─────────────────────────────────────── */

    _styleOf: function (link, r, cfg) {
      var data = r.data;
      var z = r.camera.zoom;

      /* Aggregate value + worst data status across member connections. */
      var sum = null, anyData = false, allNoData = true;
      link.connections.forEach(function (c) {
        if (!data.noData(c.binding)) { allNoData = false; }
        var v = data.num(c.binding);
        if (v !== null) { sum = (sum || 0) + v; anyData = true; }
      });

      var first = link.connections[0];
      var range = first.flowRange;
      var rel = anyData ? Math.min(1, Math.max(0, (sum - range[0]) / (range[1] - range[0] || 1))) : 0;

      /* No data (live mode): grey dashed, fixed thin width. */
      if (allNoData && SFP.runtime.mode === 'live') {
        return {
          color: r.colors['twin-nodata'], widthPx: 1.6, alpha: 0.8,
          dash: [5, 5], dashOffset: function () { return 0; },
          flowing: false, noData: true, value: null, rel: 0,
        };
      }

      /* Rules: first match wins (only meaningful for single links). */
      var ruleColor = null, ruleBadge = null, inactive = false;
      if (!link.aggregated && anyData) {
        for (var i = 0; i < first.rules.length; i++) {
          var rule = first.rules[i];
          if (SFP.expr.evaluate({ op: rule.op, value: rule.value }, sum)) {
            if (rule.style === 'inactive') { inactive = true; }
            if (rule.color) { ruleColor = r.colors[rule.color] || rule.color; }
            if (rule.badge) { ruleBadge = rule.badge; }
            break;
          }
        }
      }
      if (anyData && rel <= cfg.inactiveBelow) { inactive = true; }

      var utilColor = this._utilityColor(link.utility, r);

      if (inactive) {
        return {
          color: utilColor, widthPx: 1.6, alpha: 0.28,
          dash: [4, 6], dashOffset: function () { return 0; },
          flowing: false, noData: false, value: sum, rel: rel, badge: ruleBadge,
        };
      }

      /* Active flow: width from value, marching dash speed from rel flow. */
      var boost = cfg.zoomBoostBase + cfg.zoomBoostGain * Math.min(1, z);
      var widthPx = (cfg.widthMinPx + (cfg.widthMaxPx - cfg.widthMinPx) * rel) * boost;
      var speed = cfg.dashSpeed * (0.3 + 0.7 * rel);
      return {
        color: ruleColor || utilColor, widthPx: widthPx, alpha: 0.92,
        dash: [10, 7],
        dashOffset: function (now) { return -(now / 1000 * speed) % 17; },
        flowing: true, noData: false, value: sum, rel: rel, badge: ruleBadge,
      };
    },

    _utilityColor: function (utilityId, r) {
      var utils = r.cfg.utilities;
      for (var i = 0; i < utils.length; i++) {
        if (utils[i].id === utilityId) { return r.colors[utils[i].color]; }
      }
      return r.colors.accent;
    },

    /* ── Drawing primitives ────────────────────────────────────────────── */

    /** Polyline with rounded corners (radius in world units).
     *  Corners where the path folds back on itself (or continues straight)
     *  use lineTo: arcTo with near-collinear tangents computes tangent
     *  points at near-infinity — an "infinite line" and a frame-rate
     *  killer. The router avoids fold-backs, but editor-dragged waypoints
     *  can still produce them, so the guard lives here too. */
    _strokePolyline: function (ctx, pts, radius) {
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (var i = 1; i < pts.length - 1; i++) {
        var p = pts[i], next = pts[i + 1], prev = pts[i - 1];
        var v1x = p.x - prev.x, v1y = p.y - prev.y;
        var v2x = next.x - p.x, v2y = next.y - p.y;
        var cross = v1x * v2y - v1y * v2x;
        if (Math.abs(cross) < 0.01) {           // collinear or 180° fold-back
          ctx.lineTo(p.x, p.y);
          continue;
        }
        var r1 = Math.min(radius,
          Math.hypot(v1x, v1y) / 2,
          Math.hypot(v2x, v2y) / 2);
        ctx.arcTo(p.x, p.y, next.x, next.y, Math.max(0.1, r1));
      }
      ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
      ctx.stroke();
    },

    _arrow: function (ctx, pts, t, lineWidth, reversed) {
      var p = router.pointAlong(pts, t);
      var len = Math.hypot(p.dx, p.dy);
      if (!len) { return; }
      var ux = p.dx / len, uy = p.dy / len;
      if (reversed) { ux = -ux; uy = -uy; }
      var size = lineWidth * 2.4 + 6 / (ctx.getTransform().a || 1);
      ctx.beginPath();
      ctx.moveTo(p.x + ux * size, p.y + uy * size);
      ctx.lineTo(p.x - uy * size * 0.55, p.y + ux * size * 0.55);
      ctx.lineTo(p.x + uy * size * 0.55, p.y - ux * size * 0.55);
      ctx.closePath();
      ctx.fillStyle = ctx.strokeStyle;
      ctx.fill();
    },

    _riserChip: function (ctx, r, pts, t, offFloor) {
      var z = r.camera.zoom;
      var p = router.pointAlong(pts, t);
      var text = '⇅ ' + offFloor.floorLabel.split('—')[0].trim();
      ctx.font = '600 ' + (9.5 / z) + 'px "Segoe UI", system-ui, sans-serif';
      var w = ctx.measureText(text).width + 12 / z, h = 16 / z;
      var box = { x: p.x - w / 2, y: p.y - h - 6 / z, w: w, h: h };
      ctx.globalAlpha = 0.95;
      ctx.fillStyle = r.alpha('accent', 0.18);
      r._roundRect(ctx, box, h / 2); ctx.fill();
      ctx.strokeStyle = r.alpha('accent', 0.6);
      ctx.lineWidth = 1 / z;
      r._roundRect(ctx, box, h / 2); ctx.stroke();
      ctx.fillStyle = r.colors.accent;
      ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
      ctx.fillText(text, p.x, box.y + h / 2);
      ctx.textAlign = 'left';
    },

    _label: function (ctx, r, link, style, placedLabels, forced) {
      var cfg = r.cfg.connections;
      var z = r.camera.zoom;
      var mid = router.pointAlong(link.points, 0.5);
      if (!forced && mid.length * z < cfg.labelMinLengthPx) { return; }

      var text;
      if (style.noData) { text = 'no data'; }
      else if (style.value === null) { text = '—'; }
      else {
        var def = r.data.hub.def(link.connections[0].binding) || {};
        text = SFP.format.number(style.value, def.decimals || 0) + ' ' +
          (link.connections[0].unit || def.unit || '');
        if (link.aggregated) { text = 'Σ' + link.connections.length + ' · ' + text; }
      }

      ctx.font = '600 ' + (10 / z) + 'px "Segoe UI", system-ui, sans-serif';
      var w = ctx.measureText(text).width + 12 / z, h = 16 / z;
      var box = { x: mid.x - w / 2, y: mid.y - h / 2, w: w, h: h };

      /* Greedy collision: skip if overlapping an already-placed label. */
      var sx = box.x * z, sy = box.y * z, sw = w * z, sh = h * z;
      for (var i = 0; i < placedLabels.length; i++) {
        var o = placedLabels[i];
        if (sx < o.x + o.w && sx + sw > o.x && sy < o.y + o.h && sy + sh > o.y) {
          if (!forced) { return; }
        }
      }
      placedLabels.push({ x: sx, y: sy, w: sw, h: sh });

      ctx.globalAlpha = 1;
      ctx.fillStyle = r.alpha('twin-canvas', 0.85);
      r._roundRect(ctx, box, 4 / z); ctx.fill();
      ctx.strokeStyle = style.noData ? r.colors['twin-nodata'] : style.color;
      ctx.lineWidth = 1 / z;
      r._roundRect(ctx, box, 4 / z); ctx.stroke();
      ctx.fillStyle = style.noData ? r.colors['twin-nodata'] : r.colors['twin-label'];
      ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
      ctx.fillText(text, mid.x, mid.y + 0.5 / z);
      ctx.textAlign = 'left';

      /* Warning badge from a matched rule, below the value label. */
      if (style.badge && r.camera.lodAlpha(r.cfg.lod.detail) > 0.05) {
        var bw = ctx.measureText('⚠ ' + style.badge).width + 12 / z;
        var bb = { x: mid.x - bw / 2, y: box.y + h + 3 / z, w: bw, h: h };
        ctx.fillStyle = r.alpha('warn', 0.16);
        r._roundRect(ctx, bb, 4 / z); ctx.fill();
        ctx.fillStyle = r.colors.warn;
        ctx.textAlign = 'center';
        ctx.fillText('⚠ ' + style.badge, mid.x, bb.y + h / 2);
        ctx.textAlign = 'left';
      }
    },
  };
}(window.SFP));
