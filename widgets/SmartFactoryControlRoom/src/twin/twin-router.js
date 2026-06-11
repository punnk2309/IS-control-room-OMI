/* ============================================================================
 * SFP.twin.router — connection routing engine
 * ----------------------------------------------------------------------------
 * Resolves the configured connections into drawable links for the CURRENT
 * view (zoom tier + active floors), then routes each link as an orthogonal
 * elbow path in world coordinates.
 *
 * Endpoint resolution ("progressive disclosure" for connections):
 *   - an endpoint hidden because of ZOOM collapses upward to its nearest
 *     visible ancestor — many machine links between two zones become one
 *     aggregated zone↔zone link with a summed value
 *   - an endpoint hidden because of FLOOR selection does NOT collapse:
 *     the link is drawn to the floor-owner's edge and tagged with a riser
 *     chip ("⇡ Level 3") so cross-floor flows stay discoverable
 *   - links whose two endpoints collapse into the SAME element are internal
 *     at this zoom and are dropped
 *
 * Anchoring:
 *   - explicit anchors ({side, t}) from config are honoured when the
 *     endpoint renders as itself
 *   - otherwise the router picks facing sides and spreads multiple links
 *     sharing one face into evenly spaced slots, so parallel flows stay
 *     individually readable
 *
 * Re-routing happens only when the topology inputs change (zoom tier,
 * floors, filters) — never per frame. See topologyKey().
 * ========================================================================== */
(function (SFP) {
  'use strict';

  SFP.twin = SFP.twin || {};

  var SIDES = { left: { nx: -1, ny: 0 }, right: { nx: 1, ny: 0 }, top: { nx: 0, ny: -1 }, bottom: { nx: 0, ny: 1 } };

  function center(r) { return { x: r.x + r.w / 2, y: r.y + r.h / 2 }; }

  function rectContains(outer, inner) {
    return inner.x >= outer.x && inner.y >= outer.y &&
           inner.x + inner.w <= outer.x + outer.w &&
           inner.y + inner.h <= outer.y + outer.h;
  }

  /* Axis-aligned direction sign of a segment: {-1,0,1} per axis. */
  function segDir(p, q) {
    return { x: Math.sign(Math.round((q.x - p.x) * 100)),
             y: Math.sign(Math.round((q.y - p.y) * 100)) };
  }

  /** Remove zero-length segments and merge collinear runs (corners only). */
  function cleanPath(pts) {
    var out = [pts[0]];
    for (var i = 1; i < pts.length; i++) {
      var prev = out[out.length - 1];
      if (Math.abs(pts[i].x - prev.x) < 0.01 && Math.abs(pts[i].y - prev.y) < 0.01) { continue; }
      if (out.length >= 2) {
        var d1 = segDir(out[out.length - 2], prev);
        var d2 = segDir(prev, pts[i]);
        if (d1.x === d2.x && d1.y === d2.y) { out.pop(); }   // collinear continuation
      }
      out.push(pts[i]);
    }
    return out;
  }

  /** True when two consecutive segments reverse direction (180° turn). */
  function hasFoldback(pts) {
    for (var i = 2; i < pts.length; i++) {
      var d1 = segDir(pts[i - 2], pts[i - 1]);
      var d2 = segDir(pts[i - 1], pts[i]);
      if (d1.x * d2.x + d1.y * d2.y < 0) { return true; }
    }
    return false;
  }

  function pathLength(pts) {
    var total = 0;
    for (var i = 1; i < pts.length; i++) {
      total += Math.abs(pts[i].x - pts[i - 1].x) + Math.abs(pts[i].y - pts[i - 1].y);
    }
    return total;
  }

  function bendCount(pts) { return Math.max(0, pts.length - 2); }

  function anchorPoint(rect, side, t) {
    var n = SIDES[side];
    return {
      x: side === 'left' ? rect.x : side === 'right' ? rect.x + rect.w : rect.x + rect.w * t,
      y: side === 'top' ? rect.y : side === 'bottom' ? rect.y + rect.h : rect.y + rect.h * t,
      nx: n.nx, ny: n.ny, side: side,
    };
  }

  /** Pick the side of `rect` that faces `towards` (world point). */
  function autoSide(rect, towards) {
    var c = center(rect);
    var dx = towards.x - c.x, dy = towards.y - c.y;
    /* Normalize by the rect's aspect so wide zones still use top/bottom. */
    if (Math.abs(dx) / rect.w > Math.abs(dy) / rect.h) {
      return dx > 0 ? 'right' : 'left';
    }
    return dy > 0 ? 'bottom' : 'top';
  }

  SFP.twin.router = {

    /** Cheap fingerprint of everything that changes routing. */
    topologyKey: function (model, store, camera) {
      var state = store.get();
      var floors = Object.keys(state.activeFloors).sort().map(function (k) {
        return k + '=' + state.activeFloors[k];
      }).join(',');
      return camera.lodLevel() + '|' + floors;
    },

    /* ── Visibility helpers (shared with the world renderer) ───────────── */

    gatesActive: function (model, store, el) {
      for (var i = 0; i < el.gates.length; i++) {
        var g = el.gates[i];
        if (store.activeFloor(model.elements[g.owner]) !== g.floor) { return false; }
      }
      return true;
    },

    lodVisible: function (camera, el) {
      var lod = SFP.config.get('twin').lod;
      if (el.kind === 'zone' || el.kind === 'external') { return true; }
      var threshold = el.kind === 'subzone' ? lod.subzone : lod.machine;
      return camera.lodAlpha(threshold) > 0.05;
    },

    /** True when the element renders right now (floor + zoom). */
    isRendered: function (model, store, camera, el) {
      return this.gatesActive(model, store, el) && this.lodVisible(camera, el);
    },

    /* ── Endpoint resolution ───────────────────────────────────────────── */

    /**
     * Resolve a connection endpoint to its visible representative.
     * Returns { el, offFloor } where offFloor is null or
     * { floorLabel } when the true endpoint sits on an inactive floor.
     */
    resolveEndpoint: function (model, store, camera, elementId) {
      var el = model.elements[elementId];
      var offFloor = null;

      if (!this.gatesActive(model, store, el)) {
        /* Find the first gate that fails — that owner hosts the riser chip. */
        for (var i = 0; i < el.gates.length; i++) {
          var g = el.gates[i];
          var owner = model.elements[g.owner];
          if (store.activeFloor(owner) !== g.floor) {
            var floor = null;
            (owner.floors || []).forEach(function (f) { if (f.id === g.floor) { floor = f; } });
            offFloor = { floorLabel: floor ? floor.label : g.floor };
            el = owner;
            break;
          }
        }
      }
      /* Collapse upward through zoom-hidden levels (zones always visible). */
      while (el.parentId && !this.isRendered(model, store, camera, el)) {
        el = model.elements[el.parentId];
      }
      return { el: el, offFloor: offFloor };
    },

    /* ── Main entry: configured connections -> drawable links ─────────── */

    buildLinks: function (model, store, camera) {
      var self = this;
      var cfg = SFP.config.get('twin').connections;
      var groups = {};   // groupKey -> link

      model.connections.forEach(function (conn) {
        var from = self.resolveEndpoint(model, store, camera, conn.fromId);
        var to = self.resolveEndpoint(model, store, camera, conn.toId);
        if (from.el.id === to.el.id) { return; }       // internal at this zoom

        var key = from.el.id + '>' + to.el.id + '|' + conn.utility;
        var link = groups[key];
        if (!link) {
          link = groups[key] = {
            key: key,
            utility: conn.utility,
            fromEl: from.el, toEl: to.el,
            offFloorFrom: from.offFloor, offFloorTo: to.offFloor,
            connections: [],
          };
        }
        link.connections.push(conn);
        if (from.offFloor) { link.offFloorFrom = from.offFloor; }
        if (to.offFloor) { link.offFloorTo = to.offFloor; }
      });

      var links = Object.keys(groups).map(function (k) { return groups[k]; });
      links.forEach(function (link) {
        link.aggregated = link.connections.length > 1;
        /* A lone link keeps its configured anchors when the endpoint renders
         * as itself (not as a collapsed ancestor). */
        var c = link.connections[0];
        link.fromAnchorCfg = (!link.aggregated && link.fromEl.id === c.fromId) ? c.fromAnchor : null;
        link.toAnchorCfg = (!link.aggregated && link.toEl.id === c.toId) ? c.toAnchor : null;
        link.route = (!link.aggregated) ? c.route : null;
        /* Parent-child links (one endpoint contains the other) get a direct
         * edge-to-edge route — face anchoring would loop them outside. */
        link.internal = rectContains(link.fromEl.rect, link.toEl.rect) ||
                        rectContains(link.toEl.rect, link.fromEl.rect);
      });

      this._assignAnchors(links.filter(function (l) { return !l.internal; }), cfg);
      links.forEach(function (link) {
        link.points = link.internal
          ? self._routeInternal(link)
          : self._routeElbow(link, cfg);
      });
      return links;
    },

    /* ── Anchor slot assignment ────────────────────────────────────────── */

    _assignAnchors: function (links, cfg) {
      var faces = {};   // elementId|side -> [ { link, end } ]

      function claim(link, end) {
        var el = end === 'from' ? link.fromEl : link.toEl;
        var other = end === 'from' ? link.toEl : link.fromEl;
        var anchorCfg = end === 'from' ? link.fromAnchorCfg : link.toAnchorCfg;
        var side = (anchorCfg && anchorCfg.side) || autoSide(el.rect, center(other.rect));
        var faceKey = el.id + '|' + side;
        (faces[faceKey] = faces[faceKey] || []).push({ link: link, end: end, el: el, side: side, anchorCfg: anchorCfg });
      }
      links.forEach(function (link) { claim(link, 'from'); claim(link, 'to'); });

      Object.keys(faces).forEach(function (faceKey) {
        var list = faces[faceKey];
        /* Order along the face by the direction of the far endpoint so
         * neighbouring links exit in a fan instead of crossing. */
        list.sort(function (a, b) {
          var ca = center(a.end === 'from' ? a.link.toEl.rect : a.link.fromEl.rect);
          var cb = center(b.end === 'from' ? b.link.toEl.rect : b.link.fromEl.rect);
          var horizontal = a.side === 'top' || a.side === 'bottom';
          return horizontal ? ca.x - cb.x : ca.y - cb.y;
        });
        var n = list.length;
        list.forEach(function (item, i) {
          var t = (item.anchorCfg && item.anchorCfg.t !== undefined)
            ? item.anchorCfg.t
            : 0.5 + ((i + 1) / (n + 1) - 0.5) * cfg.slotSpread;
          var pt = anchorPoint(item.el.rect, item.side, t);
          pt.slot = i - (n - 1) / 2;          // centred slot index for stagger
          if (item.end === 'from') { item.link.fromPt = pt; }
          else { item.link.toPt = pt; }
        });
      });
    },

    /* ── Direct edge-to-edge route for parent-child (containment) links ──
     * e.g. an AHU on a zone's Floor 2 feeding a subzone on Floor 1: the
     * collapsed link joins the zone to a subzone INSIDE it. We connect the
     * child's edge straight to the nearest parent edge. */
    _routeInternal: function (link) {
      var fromIsOuter = rectContains(link.fromEl.rect, link.toEl.rect);
      var outer = fromIsOuter ? link.fromEl.rect : link.toEl.rect;
      var inner = fromIsOuter ? link.toEl.rect : link.fromEl.rect;
      var c = center(inner);

      /* Nearest outer side from the inner box, then a straight connector. */
      var gaps = [
        { side: 'left', gap: inner.x - outer.x },
        { side: 'right', gap: (outer.x + outer.w) - (inner.x + inner.w) },
        { side: 'top', gap: inner.y - outer.y },
        { side: 'bottom', gap: (outer.y + outer.h) - (inner.y + inner.h) },
      ].sort(function (g1, g2) { return g1.gap - g2.gap; });
      var side = gaps[0].side;

      var pInner, pOuter;
      if (side === 'left') {
        pInner = { x: inner.x, y: c.y }; pOuter = { x: outer.x, y: c.y };
      } else if (side === 'right') {
        pInner = { x: inner.x + inner.w, y: c.y }; pOuter = { x: outer.x + outer.w, y: c.y };
      } else if (side === 'top') {
        pInner = { x: c.x, y: inner.y }; pOuter = { x: c.x, y: outer.y };
      } else {
        pInner = { x: c.x, y: inner.y + inner.h }; pOuter = { x: c.x, y: outer.y + outer.h };
      }
      /* Preserve flow direction: points run from -> to. */
      link.fromPt = fromIsOuter ? pOuter : pInner;
      link.toPt = fromIsOuter ? pInner : pOuter;
      return [link.fromPt, link.toPt];
    },

    /* ── Orthogonal elbow routing ──────────────────────────────────────────
     * Candidate-based: build L / Z / U route options, REJECT any candidate
     * containing a 180° fold-back (two consecutive segments reversing
     * direction — those render as broken loops, and rounded corners on them
     * produce tangent points at near-infinity), then pick the shortest valid
     * one (few bends preferred). A perimeter detour around both endpoint
     * boxes is always available as a fallback. */
    _routeElbow: function (link, cfg) {
      var a = link.fromPt, b = link.toPt;
      var stub = cfg.stubWorld;
      var stagger = ((a.slot || 0) + (b.slot || 0)) * cfg.staggerWorld * 0.5;

      var p1 = { x: a.x + a.nx * stub, y: a.y + a.ny * stub };
      var p2 = { x: b.x + b.nx * stub, y: b.y + b.ny * stub };
      var head = [{ x: a.x, y: a.y }, p1];
      var tail = [p2, { x: b.x, y: b.y }];

      /* Explicit waypoints (config hints or editor-dragged elbows) thread
       * the middle of the route; the cleanup pass below removes any
       * degenerate corners they may introduce. */
      if (link.route && link.route.waypoints && link.route.waypoints.length) {
        var pts = head.slice();
        link.route.waypoints.forEach(function (wp) {
          var prev = pts[pts.length - 1];
          pts.push({ x: wp[0], y: prev.y });
          pts.push({ x: wp[0], y: wp[1] });
        });
        pts.push({ x: p2.x, y: pts[pts.length - 1].y });
        return cleanPath(pts.concat(tail));
      }

      var rA = link.fromEl.rect, rB = link.toEl.rect;
      var clear = 24;
      var middles = [
        /* L corners (one bend) */
        [{ x: p2.x, y: p1.y }],
        [{ x: p1.x, y: p2.y }],
        /* Z shapes (two bends, staggered to separate parallel runs) */
        (function () {
          var midX = (p1.x + p2.x) / 2 + stagger;
          return [{ x: midX, y: p1.y }, { x: midX, y: p2.y }];
        }()),
        (function () {
          var midY = (p1.y + p2.y) / 2 + stagger;
          return [{ x: p1.x, y: midY }, { x: p2.x, y: midY }];
        }()),
        /* U detours around the endpoint boxes (always at least one valid) */
        (function () {
          var yD = Math.min(rA.y, rB.y) - clear;
          return [{ x: p1.x, y: yD }, { x: p2.x, y: yD }];
        }()),
        (function () {
          var yD = Math.max(rA.y + rA.h, rB.y + rB.h) + clear;
          return [{ x: p1.x, y: yD }, { x: p2.x, y: yD }];
        }()),
        (function () {
          var xD = Math.min(rA.x, rB.x) - clear;
          return [{ x: xD, y: p1.y }, { x: xD, y: p2.y }];
        }()),
        (function () {
          var xD = Math.max(rA.x + rA.w, rB.x + rB.w) + clear;
          return [{ x: xD, y: p1.y }, { x: xD, y: p2.y }];
        }()),
      ];

      var best = null, bestScore = Infinity;
      middles.forEach(function (middle) {
        var candidate = cleanPath(head.concat(middle, tail));
        if (hasFoldback(candidate)) { return; }
        var score = pathLength(candidate) + bendCount(candidate) * 30;
        if (score < bestScore) { best = candidate; bestScore = score; }
      });
      /* Defensive fallback (cleanPath of a U detour is always drawable). */
      return best || cleanPath(head.concat(middles[5], tail));
    },

    /* ── Geometry helpers for hit-testing (used by interactions) ───────── */

    /** Squared distance from point P to segment AB (world units). */
    distToSegmentSq: function (p, a, b) {
      var dx = b.x - a.x, dy = b.y - a.y;
      var lenSq = dx * dx + dy * dy;
      var t = lenSq ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq)) : 0;
      var px = a.x + t * dx - p.x, py = a.y + t * dy - p.y;
      return px * px + py * py;
    },

    /** Min distance from a world point to a polyline. */
    distToPolyline: function (p, pts) {
      var best = Infinity;
      for (var i = 0; i < pts.length - 1; i++) {
        best = Math.min(best, this.distToSegmentSq(p, pts[i], pts[i + 1]));
      }
      return Math.sqrt(best);
    },

    /** Point at fraction t (0..1) along a polyline + segment direction. */
    pointAlong: function (pts, t) {
      var total = 0, lens = [];
      for (var i = 0; i < pts.length - 1; i++) {
        var dx = pts[i + 1].x - pts[i].x, dy = pts[i + 1].y - pts[i].y;
        var len = Math.sqrt(dx * dx + dy * dy);
        lens.push(len); total += len;
      }
      var target = total * t, acc = 0;
      for (var j = 0; j < lens.length; j++) {
        if (acc + lens[j] >= target || j === lens.length - 1) {
          var k = lens[j] ? (target - acc) / lens[j] : 0;
          return {
            x: pts[j].x + (pts[j + 1].x - pts[j].x) * k,
            y: pts[j].y + (pts[j + 1].y - pts[j].y) * k,
            dx: pts[j + 1].x - pts[j].x, dy: pts[j + 1].y - pts[j].y,
            length: total,
          };
        }
        acc += lens[j];
      }
      return { x: pts[0].x, y: pts[0].y, dx: 1, dy: 0, length: total };
    },
  };
}(window.SFP));
