/* ============================================================================
 * SFP.twin.Editor — visual layout editor for the factory twin
 * ----------------------------------------------------------------------------
 * Activated by the header pencil toggle (SFP.runtime.editMode) on the
 * Factory Map page. Lets anyone reshape the twin without touching code:
 *
 *   move        click an element and drag (8-unit grid snap); moving a zone
 *               or subzone carries everything inside it
 *   resize      8 handles on the selected element (children stay put)
 *   palette     preset stamps (zone, subzone, machine shapes, tank,
 *               conveyor, boiler, external node) — click a preset, then
 *               click the canvas to place it
 *   polygon     CAD-style zone outlines: click to place vertices, click the
 *               first vertex / double-click / Enter to close; right-click an
 *               existing zone -> "Edit shape" to redraw it; selected polygon
 *               zones expose draggable vertex handles
 *   properties  mini-panel for label / position / size / shape / delete
 *               + connection properties (utility, direction, from/to, binding,
 *                 unit, flow range) with add/remove elbow waypoint controls
 *   connect     "Add connection from here" tool: click source element in its
 *               props panel, then click a target element on the canvas
 *
 * Session / undo / save model:
 *   On setActive(true) a session snapshot is taken of both twin.layout and
 *   twin.connections. Every commit (move, resize, property change, etc.) uses
 *   SFP.config.define (in-memory only) and pushes a snapshot onto an undo
 *   stack (capped at 50). Ctrl+Z pops the stack and re-applies the snapshot.
 *   Nothing is persisted until the user clicks "Save", which calls
 *   SFP.config.override for both configs (writes localStorage). Closing the
 *   editor while dirty restores the session baseline so unsaved edits are
 *   always discarded on deactivate.
 *   The banner displays a "● unsaved changes" indicator while dirty and a
 *   "✔ saved" notice after a successful save.
 *
 * Waypoint (elbow) editing for connections:
 *   Selecting a connection (click on a link) shows draggable square handles at
 *   each waypoint in conn.route.waypoints. "Add elbow" appends a waypoint at
 *   the midpoint of the rendered path; "Remove elbows" clears all waypoints.
 *   Dragging a waypoint handle commits via _commitConnections on pointer-up.
 *
 * Wiring: twin-interactions.js delegates pointer gestures here while
 * `active`; twin-renderer.js calls our draw() via its overlayDraw hook.
 * ========================================================================== */
(function (SFP) {
  'use strict';

  SFP.twin = SFP.twin || {};

  var SNAP = 8;                  // world-unit grid for move/resize/vertices
  var HANDLE_PX = 8;             // resize/vertex handle size (screen px)
  var UNDO_CAP = 50;             // maximum undo entries

  /* Preset stamps offered in the palette. kind decides where a stamp may be
   * dropped (machine -> subzone, subzone -> zone, zone/external -> canvas). */
  var PRESETS = [
    { id: 'zone',     label: 'Zone',          kind: 'zone',    w: 360, h: 240, swatch: '' },
    { id: 'polyzone', label: 'Polygon zone',  kind: 'polygon', swatch: 'poly' },
    { id: 'subzone',  label: 'Subzone',       kind: 'subzone', w: 180, h: 120, swatch: '' },
    { id: 'machine',  label: 'Machine',       kind: 'machine', w: 64, h: 40, shape: 'rect', swatch: '' },
    { id: 'round',    label: 'Round unit',    kind: 'machine', w: 64, h: 40, shape: 'round', swatch: 'circle' },
    { id: 'tank',     label: 'Tank / Silo',   kind: 'machine', w: 56, h: 56, shape: 'circle', swatch: 'circle' },
    { id: 'pump',     label: 'Pump',          kind: 'machine', w: 36, h: 36, shape: 'circle', swatch: 'circle' },
    { id: 'conveyor', label: 'Conveyor',      kind: 'machine', w: 140, h: 24, shape: 'rect', swatch: 'wide' },
    { id: 'boiler',   label: 'Boiler / Oven', kind: 'machine', w: 90, h: 60, shape: 'rect', swatch: '' },
    { id: 'ahu',      label: 'AHU / Fan',     kind: 'machine', w: 64, h: 40, shape: 'round', swatch: 'circle' },
    { id: 'external', label: 'External node', kind: 'external', w: 52, h: 52, swatch: 'circle' },
  ];

  function snap(v) { return Math.round(v / SNAP) * SNAP; }
  function clone(obj) { return JSON.parse(JSON.stringify(obj)); }

  function Editor(deps) {
    this.root = deps.root;
    this.canvas = deps.canvas;
    this.renderer = deps.renderer;
    this.camera = deps.camera;
    this.model = deps.model;          // re-assigned by the widget on rebuild
    this.store = deps.store;
    this.menuEl = deps.menuEl;
    this.rebuild = deps.rebuild;      // fn(): rebuild model from config

    this.active = false;
    this.tool = null;                 // {type:'stamp',preset} | {type:'polygon',points,zoneTarget} | {type:'connect',fromEl}
    this.dragState = null;
    this.hoverWorld = null;
    this.els = {};
    this.session = null;              // { baseline, undo:[], dirty }
    this._onKey = this._onKey.bind(this);
  }

  /* ── Session helpers ────────────────────────────────────────────────────── */

  /** Snapshot both live configs into a plain object. */
  Editor.prototype._snap = function () {
    return {
      layout: clone(SFP.config.get('twin.layout')),
      connections: clone(SFP.config.get('twin.connections')),
    };
  };

  /** Refresh the banner dirty indicator and save/undo button states. */
  Editor.prototype._refreshSessionUI = function () {
    if (!this.els.saveBtn) { return; }
    var dirty = this.session && this.session.dirty;
    var dirtyText = dirty ? '● unsaved changes' : '✔ saved';
    if (this.els.dirtyIndicator) {
      this.els.dirtyIndicator.textContent = dirtyText;
      this.els.dirtyIndicator.className = 'twin-dirty-indicator' + (dirty ? ' dirty' : '');
    }
    if (this.els.saveBtn) {
      this.els.saveBtn.disabled = !dirty;
    }
    if (this.els.undoBtn) {
      this.els.undoBtn.disabled = !(this.session && this.session.undo.length > 0);
    }
  };

  /* ── Activation ────────────────────────────────────────────────────────── */

  Editor.prototype.setActive = function (on) {
    if (on === this.active) { return; }
    this.active = on;
    if (on) {
      this.session = { baseline: this._snap(), undo: [], dirty: false };
      this._buildChrome();
      this.renderer.overlayDraw = this.draw.bind(this);
      document.addEventListener('keydown', this._onKey);
    } else {
      // Discard unsaved edits by restoring baseline
      if (this.session && this.session.dirty) {
        SFP.config.define('twin.layout', this.session.baseline.layout);
        SFP.config.define('twin.connections', this.session.baseline.connections);
        this.rebuild();
      }
      this.session = null;
      this.renderer.overlayDraw = null;
      document.removeEventListener('keydown', this._onKey);
      this.tool = null;
      this.dragState = null;
      this._removeChrome();
    }
  };

  Editor.prototype.destroy = function () { this.setActive(false); };

  Editor.prototype._onKey = function (e) {
    // Ignore keyboard shortcuts when focus is in a form field
    var tag = document.activeElement ? document.activeElement.tagName : '';
    var inInput = (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT');

    if (e.key === 'Escape') {
      this.tool = null;
      this._highlightPalette();
    } else if (e.key === 'Enter' && this.tool && this.tool.type === 'polygon') {
      this._closePolygon();
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && !inInput) {
      this._deleteSelected();
    } else if (e.key === 'z' && (e.ctrlKey || e.metaKey) && !inInput) {
      e.preventDefault();
      this._undo();
    }
  };

  /* ── Undo ───────────────────────────────────────────────────────────────── */

  Editor.prototype._undo = function () {
    if (!this.session || !this.session.undo.length) { return; }
    var snap = this.session.undo.pop();
    SFP.config.define('twin.layout', snap.layout);
    SFP.config.define('twin.connections', snap.connections);
    this.session.dirty = this.session.undo.length > 0;
    this.rebuild();
    this._renderProps();
    this._refreshSessionUI();
    this._toast('Undid last edit (' + this.session.undo.length + ' left)');
  };

  /* ── Config access ─────────────────────────────────────────────────────
   * Every commit: clone config -> mutate -> SFP.config.define -> rebuild.
   * findLayoutNode locates the config entry behind a model element. */

  Editor.prototype._commitLayout = function (cfg) {
    if (this.session) {
      this.session.undo.push(this._snap());
      if (this.session.undo.length > UNDO_CAP) { this.session.undo.shift(); }
    }
    SFP.config.define('twin.layout', cfg);
    if (this.session) { this.session.dirty = true; }
    this.rebuild();
    this._renderProps();
    this._refreshSessionUI();
  };

  Editor.prototype._commitConnections = function (cfg) {
    if (this.session) {
      this.session.undo.push(this._snap());
      if (this.session.undo.length > UNDO_CAP) { this.session.undo.shift(); }
    }
    SFP.config.define('twin.connections', cfg);
    if (this.session) { this.session.dirty = true; }
    this.rebuild();
    this._renderProps();
    this._refreshSessionUI();
  };

  /** Locate the config node for an element inside a cloned layout config.
   *  Returns { node, list } (list = the array containing it) or null. */
  Editor.prototype._findLayoutNode = function (cfg, el) {
    var result = null;
    function subzonesOf(zone) {
      var lists = [];
      (zone.floors || [{ subzones: zone.subzones || [] }]).forEach(function (f) {
        if (f.subzones) { lists.push(f.subzones); }
      });
      return lists;
    }
    cfg.zones.forEach(function (zone) {
      if (el.kind === 'zone' && zone.id === el.id) {
        result = { node: zone, list: cfg.zones };
        return;
      }
      subzonesOf(zone).forEach(function (subs) {
        subs.forEach(function (sub) {
          if (el.kind === 'subzone' && zone.id + '/' + sub.id === el.id) {
            result = { node: sub, list: subs };
            return;
          }
          if (el.kind !== 'machine') { return; }
          (sub.floors || [{ machines: sub.machines || [] }]).forEach(function (f) {
            (f.machines || []).forEach(function (m) {
              if ((m.id || m.ref) === el.id) { result = { node: m, list: f.machines }; }
            });
          });
        });
      });
    });
    return result;
  };

  /* ── Geometry helpers ──────────────────────────────────────────────────── */

  /** Descendants (model elements) of an element, self excluded. */
  Editor.prototype._descendants = function (el) {
    var out = [];
    var model = this.model;
    Object.keys(model.elements).forEach(function (id) {
      var other = model.elements[id];
      var p = other.parentId;
      while (p) {
        if (p === el.id) { out.push(other); return; }
        p = model.elements[p] ? model.elements[p].parentId : null;
      }
    });
    return out;
  };

  /** The 8 resize handles of a rect (world coords). */
  Editor.prototype._handles = function (r) {
    return [
      { id: 'nw', x: r.x, y: r.y, cursor: 'nwse-resize' },
      { id: 'n', x: r.x + r.w / 2, y: r.y, cursor: 'ns-resize' },
      { id: 'ne', x: r.x + r.w, y: r.y, cursor: 'nesw-resize' },
      { id: 'e', x: r.x + r.w, y: r.y + r.h / 2, cursor: 'ew-resize' },
      { id: 'se', x: r.x + r.w, y: r.y + r.h, cursor: 'nwse-resize' },
      { id: 's', x: r.x + r.w / 2, y: r.y + r.h, cursor: 'ns-resize' },
      { id: 'sw', x: r.x, y: r.y + r.h, cursor: 'nesw-resize' },
      { id: 'w', x: r.x, y: r.y + r.h / 2, cursor: 'ew-resize' },
    ];
  };

  Editor.prototype._selectedElement = function () {
    var sel = this.store.get().selection;
    if (!sel || sel.kind !== 'element') { return null; }
    return this.model.elements[sel.id] || null;
  };

  Editor.prototype._selectedConnection = function () {
    var sel = this.store.get().selection;
    if (!sel || sel.kind !== 'connection') { return null; }
    for (var i = 0; i < this.model.connections.length; i++) {
      if (this.model.connections[i].id === sel.id) { return this.model.connections[i]; }
    }
    return null;
  };

  Editor.prototype._hitHandle = function (world) {
    var el = this._selectedElement();
    if (!el) { return null; }
    var rad = HANDLE_PX / this.camera.zoom;
    if (el.poly) {
      for (var v = 0; v < el.poly.length; v++) {
        if (Math.abs(world.x - el.poly[v].x) <= rad &&
            Math.abs(world.y - el.poly[v].y) <= rad) {
          return { vertex: v, el: el };
        }
      }
      return null;                 // polygon zones resize via vertices only
    }
    var handles = this._handles(el.rect);
    for (var i = 0; i < handles.length; i++) {
      if (Math.abs(world.x - handles[i].x) <= rad &&
          Math.abs(world.y - handles[i].y) <= rad) {
        return { handle: handles[i], el: el };
      }
    }
    return null;
  };

  /** Hit test waypoint handles for the selected connection.
   *  Returns { conn, index } or null. */
  Editor.prototype._hitWaypointHandle = function (world) {
    var conn = this._selectedConnection();
    if (!conn || !conn.route || !conn.route.waypoints) { return null; }
    var rad = HANDLE_PX / this.camera.zoom;
    var wpts = conn.route.waypoints;
    for (var i = 0; i < wpts.length; i++) {
      var wx = wpts[i][0], wy = wpts[i][1];
      if (Math.abs(world.x - wx) <= rad && Math.abs(world.y - wy) <= rad) {
        return { conn: conn, index: i };
      }
    }
    return null;
  };

  /* ── Pointer protocol (called by twin-interactions) ────────────────────── */

  /** Returns true when the editor claims the press (no pan, no view click). */
  Editor.prototype.onPointerDown = function (world) {
    if (this.tool && this.tool.type === 'polygon') {
      this._addPolygonVertex(world);
      return true;
    }
    if (this.tool && this.tool.type === 'stamp') {
      this._placeStamp(world);
      return true;
    }
    if (this.tool && this.tool.type === 'connect') {
      return this._handleConnectClick(world);
    }

    // Waypoint handle drag for selected connection
    var wpHit = this._hitWaypointHandle(world);
    if (wpHit) {
      this.dragState = { mode: 'waypoint', conn: wpHit.conn, index: wpHit.index };
      return true;
    }

    var grab = this._hitHandle(world);
    if (grab && grab.vertex !== undefined) {
      this.dragState = { mode: 'vertex', el: grab.el, vertex: grab.vertex };
      return true;
    }
    if (grab) {
      this.dragState = { mode: 'resize', el: grab.el, handle: grab.handle.id,
        orig: clone(grab.el.rect) };
      return true;
    }

    var hit = this.renderer.hitTest(world);
    if (hit && hit.kind === 'link') {
      // Select the connection
      this.store.set({ selection: { kind: 'connection', id: hit.id }, panelOpen: false });
      this._renderProps();
      return true;
    }
    if (hit && hit.kind === 'element') {
      var el = this.model.elements[hit.id];
      this.store.set({ selection: { kind: 'element', id: el.id }, panelOpen: false });
      var descendants = this._descendants(el).map(function (d) {
        return { el: d, orig: clone(d.rect), origPoly: d.poly ? clone(d.poly) : null };
      });
      this.dragState = { mode: 'move', el: el, start: world,
        orig: clone(el.rect), origPoly: el.poly ? clone(el.poly) : null,
        descendants: descendants, moved: false };
      this._renderProps();
      return true;
    }
    return false;                  // empty space: let the camera pan
  };

  Editor.prototype.onPointerMove = function (world) {
    var d = this.dragState;
    if (!d) { return; }

    if (d.mode === 'move') {
      var dx = snap(world.x - d.start.x), dy = snap(world.y - d.start.y);
      if (dx || dy) { d.moved = true; }
      d.el.rect.x = d.orig.x + dx; d.el.rect.y = d.orig.y + dy;
      if (d.el.poly && d.origPoly) {
        d.el.poly.forEach(function (p, i) {
          p.x = d.origPoly[i].x + dx; p.y = d.origPoly[i].y + dy;
        });
      }
      d.descendants.forEach(function (entry) {
        entry.el.rect.x = entry.orig.x + dx;
        entry.el.rect.y = entry.orig.y + dy;
        if (entry.el.poly && entry.origPoly) {
          entry.el.poly.forEach(function (p, i) {
            p.x = entry.origPoly[i].x + dx; p.y = entry.origPoly[i].y + dy;
          });
        }
      });
    } else if (d.mode === 'resize') {
      var r = d.el.rect, o = d.orig, h = d.handle;
      var wx = snap(world.x), wy = snap(world.y);
      if (h.indexOf('w') >= 0) { r.w = Math.max(24, o.x + o.w - wx); r.x = o.x + o.w - r.w; }
      if (h.indexOf('e') >= 0) { r.w = Math.max(24, wx - o.x); }
      if (h.indexOf('n') >= 0) { r.h = Math.max(16, o.y + o.h - wy); r.y = o.y + o.h - r.h; }
      if (h.indexOf('s') >= 0) { r.h = Math.max(16, wy - o.y); }
    } else if (d.mode === 'vertex') {
      d.el.poly[d.vertex].x = snap(world.x);
      d.el.poly[d.vertex].y = snap(world.y);
    } else if (d.mode === 'waypoint') {
      // Live-update the waypoint in model for visual feedback
      if (d.conn.route && d.conn.route.waypoints) {
        d.conn.route.waypoints[d.index] = [snap(world.x), snap(world.y)];
      }
    }
    this.renderer._topoKey = null;   // re-route connections live
  };

  Editor.prototype.onPointerUp = function () {
    var d = this.dragState;
    this.dragState = null;
    if (!d) { return; }
    if (d.mode === 'move' && !d.moved) { return; }    // plain select
    if (d.mode === 'waypoint') {
      this._commitWaypointDrag(d.conn, d.index);
      return;
    }
    this._writeBack(d.el);
  };

  /** Persist a waypoint drag to config. */
  Editor.prototype._commitWaypointDrag = function (conn, index) {
    var self = this;
    var cfg = clone(SFP.config.get('twin.connections'));
    var entry = null;
    for (var i = 0; i < (cfg.connections || []).length; i++) {
      if (cfg.connections[i].id === conn.id) { entry = cfg.connections[i]; break; }
    }
    if (!entry) { return; }
    entry.route = entry.route || {};
    entry.route.waypoints = entry.route.waypoints || [];
    if (conn.route && conn.route.waypoints) {
      entry.route.waypoints[index] = conn.route.waypoints[index].slice();
    }
    self._commitConnections(cfg);
  };

  Editor.prototype.onHover = function (world) {
    this.hoverWorld = world;
    if (this.tool) { return 'crosshair'; }
    // Waypoint handle cursor
    var wpHit = this._hitWaypointHandle(world);
    if (wpHit) { return 'move'; }
    var grab = this._hitHandle(world);
    if (grab && grab.vertex !== undefined) { return 'move'; }
    if (grab) { return grab.handle.cursor; }
    var hit = this.renderer.hitTest(world);
    if (hit && hit.kind === 'link') { return 'pointer'; }
    return (hit && hit.kind === 'element') ? 'move' : null;
  };

  Editor.prototype.onEmptyClick = function () {
    if (this.tool && this.tool.type === 'connect') {
      this.tool = null;
      this._highlightPalette();
      this._toast('Connection cancelled');
      return;
    }
    if (this.tool) { return; }
    this.store.set({ selection: null });
    this._renderProps();
  };

  Editor.prototype.onDblClick = function () {
    if (this.tool && this.tool.type === 'polygon') { this._closePolygon(); }
  };

  Editor.prototype.onContextMenu = function (world, e) {
    var self = this;
    var hit = this.renderer.hitTest(world);
    var items = [];
    if (hit && hit.kind === 'element') {
      var el = this.model.elements[hit.id];
      this.store.set({ selection: { kind: 'element', id: el.id } });
      this._renderProps();
      items.push({ label: 'Delete ' + el.label, action: function () { self._deleteSelected(); } });
      if (el.kind === 'zone') {
        items.push({ label: 'Edit shape (draw polygon)', action: function () {
          self.tool = { type: 'polygon', points: [], zoneTarget: el.id };
          self._highlightPalette();
        } });
        if (el.poly) {
          items.push({ label: 'Reset to rectangle', action: function () {
            var cfg = clone(SFP.config.get('twin.layout'));
            var found = self._findLayoutNode(cfg, el);
            if (found) { delete found.node.points; self._commitLayout(cfg); }
          } });
        }
      }
    } else {
      items.push({ label: 'Cancel tool', action: function () { self.tool = null; self._highlightPalette(); } });
    }

    var menu = this.menuEl;
    menu.innerHTML = '';
    items.forEach(function (item) {
      menu.appendChild(SFP.dom.el('button', { class: 'twin-menu-item', text: item.label,
        onclick: function () { menu.style.display = 'none'; item.action(); } }));
    });
    var host = this.canvas.parentElement.getBoundingClientRect();
    menu.style.display = 'block';
    menu.style.left = (e.clientX - host.left) + 'px';
    menu.style.top = (e.clientY - host.top) + 'px';
  };

  /* ── Connect tool ──────────────────────────────────────────────────────── */

  /** Handle a pointer-down while the connect tool is active. */
  Editor.prototype._handleConnectClick = function (world) {
    var fromEl = this.tool.fromEl;
    var hit = this.renderer.hitTest(world);
    if (!hit || hit.kind !== 'element') {
      this.tool = null;
      this._highlightPalette();
      this._toast('Connection cancelled');
      return true;
    }
    var target = this.model.elements[hit.id];
    if (!target || target.id === fromEl.id) {
      this._toast('Pick a different target element');
      return true;
    }

    this.tool = null;
    this._highlightPalette();

    var utilities = (SFP.config.get('twin') || {}).utilities || [];
    var firstUtility = utilities.length ? utilities[0].id : 'electrical';

    var newConn = {
      id: 'conn-' + Math.floor(Date.now() % 100000),
      label: fromEl.label + ' → ' + target.label,
      utility: firstUtility,
      from: { ref: fromEl.kind + ':' + fromEl.id },
      to: { ref: target.kind + ':' + target.id },
      binding: null,
      unit: '',
      flowRange: [0, 100],
      direction: 'forward',
    };

    var cfg = clone(SFP.config.get('twin.connections'));
    cfg.connections = cfg.connections || [];
    cfg.connections.push(newConn);
    this._commitConnections(cfg);
    this.store.set({ selection: { kind: 'connection', id: newConn.id }, panelOpen: false });
    this._renderProps();
    return true;
  };

  /* ── Write-back: model element -> config (parent-relative) ─────────────── */

  Editor.prototype._writeBack = function (el) {
    if (el.kind === 'external') {
      var conns = clone(SFP.config.get('twin.connections'));
      var ext = (conns.externals || []).filter(function (x) { return x.id === el.id; })[0];
      if (ext) {
        ext.x = Math.round(el.rect.x + el.rect.w / 2);
        ext.y = Math.round(el.rect.y + el.rect.h / 2);
        this._commitConnections(conns);
      }
      return;
    }

    var cfg = clone(SFP.config.get('twin.layout'));
    var found = this._findLayoutNode(cfg, el);
    if (!found) { console.error('[SFP.twin.editor] No config node for', el.id); return; }

    var parentOrigin = { x: 0, y: 0 };
    if (el.parentId) {
      var parent = this.model.elements[el.parentId];
      parentOrigin = { x: parent.rect.x, y: parent.rect.y };
    }
    found.node.rect = {
      x: Math.round(el.rect.x - parentOrigin.x),
      y: Math.round(el.rect.y - parentOrigin.y),
      w: Math.round(el.rect.w),
      h: Math.round(el.rect.h),
    };
    if (el.poly) {
      /* Re-derive the bounding box; points are stored rect-relative. */
      var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      el.poly.forEach(function (p) {
        x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y);
        x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
      });
      found.node.rect = { x: Math.round(x0), y: Math.round(y0),
        w: Math.round(x1 - x0), h: Math.round(y1 - y0) };
      found.node.points = el.poly.map(function (p) {
        return [Math.round(p.x - x0), Math.round(p.y - y0)];
      });
    }
    this._commitLayout(cfg);
  };

  /* ── Stamps (palette placement) ────────────────────────────────────────── */

  Editor.prototype._placeStamp = function (world) {
    var preset = this.tool.preset;
    this.tool = null;
    this._highlightPalette();
    var id = preset.id + '-' + Math.floor(Date.now() % 100000);
    var x = snap(world.x - preset.w / 2), y = snap(world.y - preset.h / 2);

    if (preset.kind === 'external') {
      var conns = clone(SFP.config.get('twin.connections'));
      conns.externals = conns.externals || [];
      conns.externals.push({ id: id, label: 'External', x: snap(world.x), y: snap(world.y) });
      this._commitConnections(conns);
      return;
    }

    var cfg = clone(SFP.config.get('twin.layout'));

    if (preset.kind === 'zone') {
      cfg.zones.push({ id: id, label: 'New zone', rect: { x: x, y: y, w: preset.w, h: preset.h },
        subzones: [] });
      this._commitLayout(cfg);
      return;
    }

    if (preset.kind === 'subzone') {
      var zoneHit = this._hitKindAt(world, 'zone');
      if (!zoneHit) { this._toast('Drop subzones inside a zone'); return; }
      var zoneNode = this._findLayoutNode(cfg, zoneHit).node;
      var zoneFloors = zoneNode.floors;
      var subList;
      if (zoneFloors) {
        /* Insert into the currently active floor of that zone. */
        var activeId = this.store.activeFloor(zoneHit);
        var floor = zoneFloors.filter(function (f) { return f.id === activeId; })[0] || zoneFloors[0];
        floor.subzones = floor.subzones || [];
        subList = floor.subzones;
      } else {
        zoneNode.subzones = zoneNode.subzones || [];
        subList = zoneNode.subzones;
      }
      subList.push({ id: id, label: 'New subzone',
        rect: { x: x - zoneHit.rect.x, y: y - zoneHit.rect.y, w: preset.w, h: preset.h },
        machines: [] });
      this._commitLayout(cfg);
      return;
    }

    /* machine */
    var subHit = this._hitKindAt(world, 'subzone');
    if (!subHit) { this._toast('Drop machines inside a subzone'); return; }
    var subNode = this._findLayoutNode(cfg, subHit).node;
    var machineList;
    if (subNode.floors) {
      var activeFloorId = this.store.activeFloor(subHit);
      var subFloor = subNode.floors.filter(function (f) { return f.id === activeFloorId; })[0] || subNode.floors[0];
      subFloor.machines = subFloor.machines || [];
      machineList = subFloor.machines;
    } else {
      subNode.machines = subNode.machines || [];
      machineList = subNode.machines;
    }
    machineList.push({ id: id, label: preset.label, kind: preset.label, shape: preset.shape || 'rect',
      rect: { x: x - subHit.rect.x, y: y - subHit.rect.y, w: preset.w, h: preset.h } });
    this._commitLayout(cfg);
  };

  Editor.prototype._hitKindAt = function (world, kind) {
    var hit = this.renderer._hitKind(world, kind);
    return hit ? this.model.elements[hit.id] : null;
  };

  /* ── Polygon tool ──────────────────────────────────────────────────────── */

  Editor.prototype._addPolygonVertex = function (world) {
    var t = this.tool;
    var pt = { x: snap(world.x), y: snap(world.y) };
    /* Clicking near the first vertex closes the shape. */
    if (t.points.length >= 3) {
      var first = t.points[0];
      var closeRad = 12 / this.camera.zoom;
      if (Math.abs(pt.x - first.x) <= closeRad && Math.abs(pt.y - first.y) <= closeRad) {
        this._closePolygon();
        return;
      }
    }
    t.points.push(pt);
  };

  Editor.prototype._closePolygon = function () {
    var t = this.tool;
    this.tool = null;
    this._highlightPalette();
    if (!t || t.points.length < 3) { return; }

    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    t.points.forEach(function (p) {
      x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
    });
    var rect = { x: x0, y: y0, w: Math.max(24, x1 - x0), h: Math.max(16, y1 - y0) };
    var points = t.points.map(function (p) { return [p.x - x0, p.y - y0]; });

    var cfg = clone(SFP.config.get('twin.layout'));
    if (t.zoneTarget) {
      var el = this.model.elements[t.zoneTarget];
      var found = this._findLayoutNode(cfg, el);
      if (found) { found.node.rect = rect; found.node.points = points; }
    } else {
      cfg.zones.push({ id: 'zone-' + Math.floor(Date.now() % 100000), label: 'New zone',
        rect: rect, points: points, subzones: [] });
    }
    this._commitLayout(cfg);
  };

  /* ── Delete ────────────────────────────────────────────────────────────── */

  Editor.prototype._deleteSelected = function () {
    var sel = this.store.get().selection;
    if (!sel) { return; }

    if (sel.kind === 'connection') {
      var connId = sel.id;
      var cfg = clone(SFP.config.get('twin.connections'));
      cfg.connections = (cfg.connections || []).filter(function (c) { return c.id !== connId; });
      this.store.set({ selection: null });
      this._commitConnections(cfg);
      return;
    }

    var el = this._selectedElement();
    if (!el) { return; }
    if (el.kind === 'external') {
      var conns = clone(SFP.config.get('twin.connections'));
      conns.externals = (conns.externals || []).filter(function (x) { return x.id !== el.id; });
      conns.connections = (conns.connections || []).filter(function (c) {
        return c.from.ref !== 'external:' + el.id && c.to.ref !== 'external:' + el.id;
      });
      this.store.set({ selection: null });
      this._commitConnections(conns);
      return;
    }
    var layoutCfg = clone(SFP.config.get('twin.layout'));
    var found = this._findLayoutNode(layoutCfg, el);
    if (!found) { return; }
    found.list.splice(found.list.indexOf(found.node), 1);
    this.store.set({ selection: null });
    this._commitLayout(layoutCfg);
  };

  /* ── Overlay drawing (called from the renderer inside world transform) ── */

  Editor.prototype.draw = function (ctx) {
    var z = this.camera.zoom;
    var accent = this.renderer.colors['twin-select'];
    var size = HANDLE_PX / z;

    var el = this._selectedElement();
    if (el && !this.tool) {
      ctx.fillStyle = this.renderer.colors['twin-canvas'];
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1.5 / z;
      var pts = el.poly
        ? el.poly
        : this._handles(el.rect);
      pts.forEach(function (p) {
        ctx.beginPath();
        ctx.rect(p.x - size / 2, p.y - size / 2, size, size);
        ctx.fill(); ctx.stroke();
      });
    }

    // Draw waypoint handles + context points for selected connection
    var conn = this._selectedConnection();
    if (conn && !this.tool) {
      // Find the rendered link to get interior corner points for context
      var link = null;
      var links = this.renderer.links;
      if (links) {
        for (var li = 0; li < links.length; li++) {
          var lk = links[li];
          if (lk.connections) {
            for (var ci = 0; ci < lk.connections.length; ci++) {
              if (lk.connections[ci].id === conn.id) { link = lk; break; }
            }
          }
          if (link) { break; }
        }
      }

      // Draw small context circles at interior path points (alpha 0.5)
      if (link && link.points && link.points.length > 2) {
        ctx.save();
        ctx.globalAlpha = 0.5;
        ctx.strokeStyle = accent;
        ctx.lineWidth = 1 / z;
        for (var pi = 1; pi < link.points.length - 1; pi++) {
          ctx.beginPath();
          ctx.arc(link.points[pi].x, link.points[pi].y, 3 / z, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.restore();
      }

      // Draw draggable waypoint handles (squares)
      if (conn.route && conn.route.waypoints) {
        ctx.fillStyle = this.renderer.colors['twin-canvas'];
        ctx.strokeStyle = accent;
        ctx.lineWidth = 1.5 / z;
        var wpts = conn.route.waypoints;
        for (var wi = 0; wi < wpts.length; wi++) {
          var wpx = wpts[wi][0], wpy = wpts[wi][1];
          ctx.beginPath();
          ctx.rect(wpx - size / 2, wpy - size / 2, size, size);
          ctx.fill(); ctx.stroke();
        }
      }
    }

    /* Polygon-in-progress preview. */
    if (this.tool && this.tool.type === 'polygon' && this.tool.points.length) {
      var t = this.tool;
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2 / z;
      ctx.setLineDash([6 / z, 4 / z]);
      ctx.beginPath();
      ctx.moveTo(t.points[0].x, t.points[0].y);
      for (var i = 1; i < t.points.length; i++) { ctx.lineTo(t.points[i].x, t.points[i].y); }
      if (this.hoverWorld) { ctx.lineTo(snap(this.hoverWorld.x), snap(this.hoverWorld.y)); }
      ctx.stroke();
      ctx.setLineDash([]);
      /* First vertex marked — clicking it closes the shape. */
      ctx.beginPath();
      ctx.arc(t.points[0].x, t.points[0].y, 6 / z, 0, Math.PI * 2);
      ctx.stroke();
    }

    /* Stamp ghost under the cursor. */
    if (this.tool && this.tool.type === 'stamp' && this.hoverWorld) {
      var p = this.tool.preset;
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1.5 / z;
      ctx.setLineDash([5 / z, 4 / z]);
      var gx = snap(this.hoverWorld.x - p.w / 2), gy = snap(this.hoverWorld.y - p.h / 2);
      if (p.shape === 'circle' || p.kind === 'external') {
        ctx.beginPath();
        ctx.arc(gx + p.w / 2, gy + p.h / 2, Math.min(p.w, p.h) / 2, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.strokeRect(gx, gy, p.w, p.h);
      }
      ctx.setLineDash([]);
    }
  };

  /* ── Chrome: palette, properties panel, banner ─────────────────────────── */

  Editor.prototype._buildChrome = function () {
    var dom = SFP.dom, self = this;

    // Banner row: message + dirty indicator + undo + save buttons
    var bannerMsg = dom.el('span', { class: 'twin-edit-banner-msg',
      text: 'Edit mode — drag to move, handles to resize, right-click for shape tools' });
    this.els.bannerMsg = bannerMsg;

    this.els.dirtyIndicator = dom.el('span', { class: 'twin-dirty-indicator',
      text: '✔ saved' });

    this.els.undoBtn = dom.el('button', { class: 'twin-banner-btn', text: 'Undo',
      title: 'Undo last edit (Ctrl+Z)',
      disabled: true,
      onclick: function () { self._undo(); } });

    this.els.saveBtn = dom.el('button', { class: 'twin-banner-btn primary', text: 'Save',
      title: 'Persist all edits (until saved, leaving edit mode discards them)',
      disabled: true,
      onclick: function () { self._save(); } });

    this.els.banner = dom.el('div', { class: 'twin-edit-banner' }, [
      bannerMsg,
      this.els.dirtyIndicator,
      this.els.undoBtn,
      this.els.saveBtn,
    ]);

    this.els.palette = dom.el('div', { class: 'twin-palette' },
      [dom.el('div', { class: 'twin-palette-title', text: 'Palette' })]);
    PRESETS.forEach(function (preset) {
      var item = dom.el('button', { class: 'twin-palette-item', 'data-preset': preset.id,
        onclick: function () {
          if (preset.kind === 'polygon') {
            self.tool = { type: 'polygon', points: [], zoneTarget: null };
          } else {
            self.tool = { type: 'stamp', preset: preset };
          }
          self._highlightPalette();
        } }, [
        dom.el('span', { class: 'twin-palette-swatch ' + (preset.swatch || '') }),
        preset.label,
      ]);
      self.els.palette.appendChild(item);
    });

    this.els.props = dom.el('div', { class: 'twin-props' });

    this.root.appendChild(this.els.banner);
    this.root.appendChild(this.els.palette);
    this.root.appendChild(this.els.props);
    this._renderProps();
    this._refreshSessionUI();
  };

  /** Persist both configs to localStorage. */
  Editor.prototype._save = function () {
    SFP.config.override('twin.layout', SFP.config.get('twin.layout'));
    SFP.config.override('twin.connections', SFP.config.get('twin.connections'));
    if (this.session) {
      this.session.baseline = this._snap();
      this.session.undo = [];
      this.session.dirty = false;
    }
    this._refreshSessionUI();
    this._toast('Saved to localStorage');
  };

  Editor.prototype._removeChrome = function () {
    var self = this;
    ['banner', 'palette', 'props'].forEach(function (key) {
      if (self.els[key] && self.els[key].parentElement) {
        self.els[key].parentElement.removeChild(self.els[key]);
      }
    });
    this.els = {};
  };

  Editor.prototype._highlightPalette = function () {
    var self = this;
    if (!this.els.palette) { return; }
    Array.prototype.forEach.call(this.els.palette.querySelectorAll('.twin-palette-item'),
      function (item) {
        var presetId = item.getAttribute('data-preset');
        var on = self.tool && (
          (self.tool.type === 'stamp' && self.tool.preset.id === presetId) ||
          (self.tool.type === 'polygon' && presetId === 'polyzone'));
        item.classList.toggle('active', !!on);
      });
  };

  Editor.prototype._toast = function (text) {
    if (this.els.bannerMsg) {
      this.els.bannerMsg.textContent = text;
      var self = this;
      clearTimeout(this._toastTimer);
      this._toastTimer = setTimeout(function () {
        if (self.els.bannerMsg) {
          var dirty = self.session && self.session.dirty;
          self.els.bannerMsg.textContent = dirty
            ? 'Edit mode — unsaved changes will be discarded on close'
            : 'Edit mode — drag to move, handles to resize, right-click for shape tools';
        }
      }, 2500);
    }
  };

  /* ── Connection properties helpers ─────────────────────────────────────── */

  /** Build a ref string from a model element. */
  function elRef(el) { return el.kind + ':' + el.id; }

  /** Build a sorted list of all element ref strings. */
  Editor.prototype._allElementRefs = function () {
    var refs = [];
    var els = this.model.elements;
    Object.keys(els).forEach(function (id) { refs.push(elRef(els[id])); });
    refs.sort();
    return refs;
  };

  /** Find a config connection entry by id in a cloned connections config. */
  function findConnEntry(cfg, id) {
    var conns = cfg.connections || [];
    for (var i = 0; i < conns.length; i++) {
      if (conns[i].id === id) { return conns[i]; }
    }
    return null;
  }

  /** Render the connection properties form for the selected connection. */
  Editor.prototype._renderConnectionProps = function (box, conn) {
    var dom = SFP.dom, self = this;

    box.appendChild(dom.el('div', { class: 'twin-palette-title', text: 'connection properties' }));

    function row(label, input) {
      return dom.el('label', { class: 'twin-prop-row' }, [label, input]);
    }

    function commitConnProp(key, value) {
      var cfg = clone(SFP.config.get('twin.connections'));
      var entry = findConnEntry(cfg, conn.id);
      if (!entry) { return; }
      if (key === 'from') { entry.from = { ref: value }; }
      else if (key === 'to') { entry.to = { ref: value }; }
      else { entry[key] = value; }
      self._commitConnections(cfg);
    }

    // Label
    box.appendChild(row('Label', dom.el('input', { value: conn.label || '',
      onchange: function (e) { commitConnProp('label', e.target.value); } })));

    // Utility
    var utilities = (SFP.config.get('twin') || {}).utilities || [];
    var utilSel = dom.el('select', { onchange: function (e) {
      commitConnProp('utility', e.target.value);
    } }, utilities.map(function (u) {
      var opt = dom.el('option', { value: u.id, text: u.label });
      if (conn.utility === u.id) { opt.selected = true; }
      return opt;
    }));
    box.appendChild(row('Utility', utilSel));

    // Direction
    var dirSel = dom.el('select', { onchange: function (e) {
      commitConnProp('direction', e.target.value);
    } }, ['forward', 'reverse', 'both', 'none'].map(function (d) {
      var opt = dom.el('option', { value: d, text: d });
      if (conn.direction === d) { opt.selected = true; }
      return opt;
    }));
    box.appendChild(row('Direction', dirSel));

    // From / To selects
    var allRefs = this._allElementRefs();
    var fromRef = conn.fromId ? (function () {
      var el = self.model.elements[conn.fromId];
      return el ? elRef(el) : conn.fromId;
    }()) : '';
    var toRef = conn.toId ? (function () {
      var el = self.model.elements[conn.toId];
      return el ? elRef(el) : conn.toId;
    }()) : '';

    var fromSel = dom.el('select', { onchange: function (e) {
      commitConnProp('from', e.target.value);
    } }, allRefs.map(function (r) {
      var opt = dom.el('option', { value: r, text: r });
      if (r === fromRef) { opt.selected = true; }
      return opt;
    }));
    box.appendChild(row('From', fromSel));

    var toSel = dom.el('select', { onchange: function (e) {
      commitConnProp('to', e.target.value);
    } }, allRefs.map(function (r) {
      var opt = dom.el('option', { value: r, text: r });
      if (r === toRef) { opt.selected = true; }
      return opt;
    }));
    box.appendChild(row('To', toSel));

    // Binding (datapoint id)
    box.appendChild(row('Binding', dom.el('input', { value: conn.binding || '',
      onchange: function (e) { commitConnProp('binding', e.target.value || null); } })));

    // Unit
    box.appendChild(row('Unit', dom.el('input', { value: conn.unit || '',
      onchange: function (e) { commitConnProp('unit', e.target.value); } })));

    // Flow range
    var flowRange = conn.flowRange || [0, 100];
    box.appendChild(row('Flow min', dom.el('input', { type: 'number', value: flowRange[0],
      onchange: function (e) {
        var cfg2 = clone(SFP.config.get('twin.connections'));
        var entry2 = findConnEntry(cfg2, conn.id);
        if (entry2) { entry2.flowRange = [parseFloat(e.target.value) || 0, (entry2.flowRange || [0, 100])[1]]; }
        self._commitConnections(cfg2);
      } })));
    box.appendChild(row('Flow max', dom.el('input', { type: 'number', value: flowRange[1],
      onchange: function (e) {
        var cfg2 = clone(SFP.config.get('twin.connections'));
        var entry2 = findConnEntry(cfg2, conn.id);
        if (entry2) { entry2.flowRange = [(entry2.flowRange || [0, 100])[0], parseFloat(e.target.value) || 100]; }
        self._commitConnections(cfg2);
      } })));

    // Waypoint (elbow) controls
    box.appendChild(dom.el('div', { class: 'twin-palette-title', text: 'Routing' }));

    box.appendChild(dom.el('button', { class: 'twin-chip',
      onclick: function () { self._addElbow(conn); } },
      [SFP.icons.el('plus', 12), 'Add elbow']));

    box.appendChild(dom.el('button', { class: 'twin-chip',
      onclick: function () { self._removeElbows(conn); } },
      [SFP.icons.el('minus', 12), 'Remove elbows']));

    // Delete connection
    box.appendChild(dom.el('div', { class: 'danger' }, [
      dom.el('button', { class: 'twin-chip', text: 'Delete connection',
        onclick: function () { self._deleteSelected(); } }),
    ]));
  };

  /** Add a waypoint at the midpoint of the rendered link path. */
  Editor.prototype._addElbow = function (conn) {
    var link = null;
    var links = this.renderer.links;
    if (links) {
      for (var li = 0; li < links.length; li++) {
        var lk = links[li];
        if (lk.connections) {
          for (var ci = 0; ci < lk.connections.length; ci++) {
            if (lk.connections[ci].id === conn.id) { link = lk; break; }
          }
        }
        if (link) { break; }
      }
    }
    var midPt = null;
    if (link && link.points && link.points.length >= 2) {
      var mid = link.points[Math.floor(link.points.length / 2)];
      midPt = [snap(mid.x), snap(mid.y)];
    } else {
      // Fallback: midpoint between endpoints in model
      var fromEl = this.model.elements[conn.fromId];
      var toEl = this.model.elements[conn.toId];
      if (fromEl && toEl) {
        midPt = [
          snap((fromEl.rect.x + fromEl.rect.w / 2 + toEl.rect.x + toEl.rect.w / 2) / 2),
          snap((fromEl.rect.y + fromEl.rect.h / 2 + toEl.rect.y + toEl.rect.h / 2) / 2),
        ];
      }
    }
    if (!midPt) { this._toast('Cannot determine path midpoint'); return; }

    var cfg = clone(SFP.config.get('twin.connections'));
    var entry = findConnEntry(cfg, conn.id);
    if (!entry) { return; }
    entry.route = entry.route || {};
    entry.route.waypoints = entry.route.waypoints ? entry.route.waypoints.slice() : [];
    entry.route.waypoints.push(midPt);
    this._commitConnections(cfg);
  };

  /** Remove all waypoints from the connection route. */
  Editor.prototype._removeElbows = function (conn) {
    var cfg = clone(SFP.config.get('twin.connections'));
    var entry = findConnEntry(cfg, conn.id);
    if (!entry) { return; }
    if (entry.route) { entry.route.waypoints = []; }
    this._commitConnections(cfg);
  };

  /** Properties mini-panel for the current selection + export buttons. */
  Editor.prototype._renderProps = function () {
    var dom = SFP.dom, self = this;
    var box = this.els.props;
    if (!box) { return; }
    dom.clear(box);

    var sel = this.store.get().selection;

    // ── Connection selection ───────────────────────────────────────────────
    if (sel && sel.kind === 'connection') {
      var conn = null;
      for (var ci = 0; ci < this.model.connections.length; ci++) {
        if (this.model.connections[ci].id === sel.id) { conn = this.model.connections[ci]; break; }
      }
      if (conn) {
        this._renderConnectionProps(box, conn);
      } else {
        box.appendChild(dom.el('div', { class: 'twin-palette-title', text: 'Connection not found' }));
      }
      this._appendConfigSection(box);
      return;
    }

    // ── Element selection ──────────────────────────────────────────────────
    var el = this._selectedElement();
    box.appendChild(dom.el('div', { class: 'twin-palette-title',
      text: el ? (el.kind + ' properties') : 'Nothing selected' }));

    if (el) {
      var parentOrigin = { x: 0, y: 0 };
      if (el.parentId && this.model.elements[el.parentId]) {
        var parent = this.model.elements[el.parentId].rect;
        parentOrigin = { x: parent.x, y: parent.y };
      }

      function row(label, input) {
        return dom.el('label', { class: 'twin-prop-row' }, [label, input]);
      }
      function numInput(value, onCommit) {
        return dom.el('input', { type: 'number', value: Math.round(value),
          onchange: function (e) { onCommit(parseFloat(e.target.value) || 0); } });
      }

      box.appendChild(row('Id', dom.el('input', { value: el.id, disabled: 'disabled' })));
      box.appendChild(row('Label', dom.el('input', { value: el.label,
        onchange: function (e) { self._setProp(el, 'label', e.target.value); } })));
      box.appendChild(row('X', numInput(el.rect.x - parentOrigin.x, function (v) {
        el.rect.x = parentOrigin.x + v; self._writeBack(el);
      })));
      box.appendChild(row('Y', numInput(el.rect.y - parentOrigin.y, function (v) {
        el.rect.y = parentOrigin.y + v; self._writeBack(el);
      })));
      if (!el.poly) {
        box.appendChild(row('Width', numInput(el.rect.w, function (v) {
          el.rect.w = Math.max(24, v); self._writeBack(el);
        })));
        box.appendChild(row('Height', numInput(el.rect.h, function (v) {
          el.rect.h = Math.max(16, v); self._writeBack(el);
        })));
      }
      if (el.kind === 'machine') {
        var shapeSel = dom.el('select', { onchange: function (e) {
          self._setProp(el, 'shape', e.target.value);
        } }, ['rect', 'round', 'circle'].map(function (s) {
          var opt = dom.el('option', { value: s, text: s });
          if (el.shape === s) { opt.selected = true; }
          return opt;
        }));
        box.appendChild(row('Shape', shapeSel));
      }
      box.appendChild(dom.el('div', { class: 'danger' }, [
        dom.el('button', { class: 'twin-chip', text: 'Delete element',
          onclick: function () { self._deleteSelected(); } }),
      ]));

      // ── Connections section for this element ──────────────────────────
      var elConns = SFP.twin.model.connectionsFor(this.model, el.id);
      if (elConns.length > 0) {
        box.appendChild(dom.el('div', { class: 'twin-palette-title', text: 'Connections' }));
        elConns.forEach(function (c) {
          var util = (SFP.config.get('twin') || {}).utilities || [];
          var utilEntry = null;
          for (var ui = 0; ui < util.length; ui++) {
            if (util[ui].id === c.utility) { utilEntry = util[ui]; break; }
          }
          var btnText = (c.label || c.id) + (utilEntry ? ' (' + utilEntry.label + ')' : '');
          box.appendChild(dom.el('button', { class: 'twin-chip',
            onclick: function () {
              self.store.set({ selection: { kind: 'connection', id: c.id }, panelOpen: false });
              self._renderProps();
            } }, [SFP.icons.el('route', 12), btnText]));
        });
      }

      // "Add connection from here" button
      box.appendChild(dom.el('button', { class: 'twin-chip',
        onclick: function () {
          self.tool = { type: 'connect', fromEl: el };
          self._highlightPalette();
          self._toast('Click a target element to connect');
        } }, [SFP.icons.el('plus', 12), 'Add connection from here']));
    }

    this._appendConfigSection(box);
  };

  /** Append the Config / export section (shared between element and connection props). */
  Editor.prototype._appendConfigSection = function (box) {
    var dom = SFP.dom, self = this;
    box.appendChild(dom.el('div', { class: 'twin-palette-title', text: 'Config' }));
    box.appendChild(dom.el('button', { class: 'btn-action',
      onclick: function () { SFP.config.downloadConfigJs('twin.layout', 'twin.layout.config.js'); } },
      [SFP.icons.el('download', 13), 'Export layout']));
    box.appendChild(dom.el('button', { class: 'btn-action',
      onclick: function () { SFP.config.downloadConfigJs('twin.connections', 'twin.connections.config.js'); } },
      [SFP.icons.el('download', 13), 'Export connections']));
    box.appendChild(dom.el('button', { class: 'btn-action',
      onclick: function () {
        SFP.config.clearAllOverrides();
        // Reset session baseline so the editor doesn't try to restore stale config
        if (self.session) {
          self.session.baseline = self._snap();
          self.session.undo = [];
          self.session.dirty = false;
          self._refreshSessionUI();
        }
        self._toast('Overrides cleared — reload to restore file configs');
      } },
      [SFP.icons.el('trash', 13), 'Reset overrides']));
  };

  /** Update a simple config property (label, shape) and commit. */
  Editor.prototype._setProp = function (el, key, value) {
    if (el.kind === 'external') {
      var conns = clone(SFP.config.get('twin.connections'));
      var ext = (conns.externals || []).filter(function (x) { return x.id === el.id; })[0];
      if (ext && key === 'label') { ext.label = value; this._commitConnections(conns); }
      return;
    }
    var cfg = clone(SFP.config.get('twin.layout'));
    var found = this._findLayoutNode(cfg, el);
    if (!found) { return; }
    found.node[key] = value;
    /* Machines defined by ref get an explicit id once edited, so the label
     * override survives (ref machines take label from the registry). */
    if (key === 'label' && found.node.ref && !found.node.id) { found.node.id = found.node.ref; }
    this._commitLayout(cfg);
  };

  SFP.twin.Editor = Editor;
}(window.SFP));
