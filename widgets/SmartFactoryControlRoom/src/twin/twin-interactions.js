/* ============================================================================
 * SFP.twin.Interactions — pointer/keyboard handling for the twin canvas
 * ----------------------------------------------------------------------------
 * Owns every gesture on the canvas:
 *
 *   drag                pan (with pointer capture; 4px threshold separates
 *                       click from pan)
 *   wheel               zoom centred on the cursor
 *   two-finger pinch    zoom centred on the pinch midpoint + pan
 *   hover               hit test -> store.hover + DOM tooltip (links and
 *                       machines), pointer cursor on interactive things
 *   click               select element / connection, cycle a floor chip,
 *                       click empty space to clear
 *   double-click        zoom-to-element
 *   right-click         context menu (go to source/destination, isolate
 *                       utility, zoom, reset filters)
 *   Escape              clear selection / close menu
 *
 * Selecting a zone also emits 'map:zoneSelected' on the app bus, so any
 * other widget/page can keep reacting exactly like with the old map.
 * ========================================================================== */
(function (SFP) {
  'use strict';

  SFP.twin = SFP.twin || {};

  function Interactions(deps) {
    this.canvas = deps.canvas;
    this.renderer = deps.renderer;
    this.camera = deps.camera;
    this.model = deps.model;
    this.store = deps.store;
    this.data = deps.data;
    this.tooltip = deps.tooltipEl;      // absolutely positioned DOM node
    this.menu = deps.menuEl;            // context menu DOM node
    this.nav = deps.nav;
    this.cleanups = [];

    this.pointers = {};                 // active pointers (pinch support)
    this.drag = null;                   // { x, y, moved }
    this.pinch = null;                  // { dist, mid }

    this._wire();
  }

  Interactions.prototype.destroy = function () {
    this.cleanups.forEach(function (fn) { fn(); });
  };

  Interactions.prototype._on = function (target, event, fn, opts) {
    target.addEventListener(event, fn, opts);
    this.cleanups.push(function () { target.removeEventListener(event, fn, opts); });
  };

  Interactions.prototype._canvasPoint = function (e) {
    var box = this.canvas.getBoundingClientRect();
    return { x: e.clientX - box.left, y: e.clientY - box.top };
  };

  /* ── Wiring ────────────────────────────────────────────────────────────── */

  Interactions.prototype._wire = function () {
    var self = this;

    this._on(this.canvas, 'pointerdown', function (e) {
      self._closeMenu();
      self.pointers[e.pointerId] = self._canvasPoint(e);
      var ids = Object.keys(self.pointers);
      if (ids.length === 2) {
        var a = self.pointers[ids[0]], b = self.pointers[ids[1]];
        self.pinch = { dist: Math.hypot(b.x - a.x, b.y - a.y) };
        self.drag = null;
      } else if (e.button === 0) {
        self.drag = { x: e.clientX, y: e.clientY, moved: false };
      }
      self.canvas.setPointerCapture(e.pointerId);
    });

    this._on(this.canvas, 'pointermove', function (e) {
      var pt = self._canvasPoint(e);

      if (self.pointers[e.pointerId]) { self.pointers[e.pointerId] = pt; }

      var ids = Object.keys(self.pointers);
      if (self.pinch && ids.length === 2) {
        var a = self.pointers[ids[0]], b = self.pointers[ids[1]];
        var dist = Math.hypot(b.x - a.x, b.y - a.y);
        var mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        if (self.pinch.dist > 0) {
          self.camera.zoomAt(mid, dist / self.pinch.dist);
        }
        self.pinch.dist = dist;
        return;
      }

      if (self.drag) {
        var dx = e.clientX - self.drag.x, dy = e.clientY - self.drag.y;
        if (self.drag.moved || Math.abs(dx) + Math.abs(dy) > 4) {
          self.drag.moved = true;
          self.camera.panByScreen(dx, dy);
          self.drag.x = e.clientX; self.drag.y = e.clientY;
          self.canvas.style.cursor = 'grabbing';
          self._hideTooltip();
        }
        return;
      }

      self._hover(pt, e);
    });

    function endPointer(e) {
      delete self.pointers[e.pointerId];
      if (Object.keys(self.pointers).length < 2) { self.pinch = null; }
      if (self.drag && !self.drag.moved && e.button === 0) {
        self._click(self._canvasPoint(e));
      }
      self.drag = null;
      self.canvas.style.cursor = '';
    }
    this._on(this.canvas, 'pointerup', endPointer);
    this._on(this.canvas, 'pointercancel', endPointer);

    this._on(this.canvas, 'wheel', function (e) {
      e.preventDefault();
      var step = SFP.config.get('twin').camera.zoomStep;
      self.camera.zoomAt(self._canvasPoint(e), e.deltaY < 0 ? step : 1 / step);
    }, { passive: false });

    this._on(this.canvas, 'dblclick', function (e) {
      var hit = self.renderer.hitTest(self.camera.screenToWorld(self._canvasPoint(e)));
      if (hit && hit.kind === 'element') {
        self.camera.fitRect(self.model.elements[hit.id].rect, true);
      }
    });

    this._on(this.canvas, 'contextmenu', function (e) {
      e.preventDefault();
      self._contextMenu(self._canvasPoint(e), e);
    });

    this._on(document, 'keydown', function (e) {
      if (e.key === 'Escape') {
        self._closeMenu();
        self.store.select(null, null);
      }
    });

    this._on(document, 'pointerdown', function (e) {
      if (self.menu && !self.menu.contains(e.target)) { self._closeMenu(); }
    });
  };

  /* ── Hover + tooltip ───────────────────────────────────────────────────── */

  Interactions.prototype._hover = function (pt, e) {
    var hit = this.renderer.hitTest(this.camera.screenToWorld(pt));
    var store = this.store;

    if (!hit) {
      if (store.get().hover) { store.set({ hover: null }); }
      this.canvas.style.cursor = '';
      this._hideTooltip();
      return;
    }

    this.canvas.style.cursor = 'pointer';

    if (hit.kind === 'link') {
      store.set({ hover: { kind: 'link', key: hit.link.key, id: hit.id } });
      this._showLinkTooltip(hit.link, e);
    } else if (hit.kind === 'element') {
      var el = this.model.elements[hit.id];
      store.set({ hover: { kind: 'element', id: hit.id } });
      if (el.kind === 'machine') { this._showMachineTooltip(el, e); }
      else { this._hideTooltip(); }
    } else {
      store.set({ hover: null });
      this._hideTooltip();
    }
  };

  Interactions.prototype._showLinkTooltip = function (link, e) {
    var data = this.data;
    var rows = link.connections.map(function (c) {
      var v = data.num(c.binding);
      var status = data.status(c.binding);
      var valueText = (status === 'unwired') ? 'no source'
        : (status === 'waiting') ? 'waiting for data'
        : (v === null) ? '—' : SFP.format.number(v, 1) + ' ' + c.unit;
      return '<div class="twin-tip-row"><span>' + c.label + '</span><b>' + valueText + '</b></div>';
    }).join('');
    this._showTooltip(
      '<div class="twin-tip-title">' + link.fromEl.label + ' → ' + link.toEl.label + '</div>' + rows, e);
  };

  Interactions.prototype._showMachineTooltip = function (el, e) {
    var html = '<div class="twin-tip-title">' + el.label +
      (el.sublabel ? ' <span class="twin-tip-dim">' + el.sublabel + '</span>' : '') + '</div>';
    if (el.bindings.value) {
      var v = this.data.num(el.bindings.value.datapoint);
      html += '<div class="twin-tip-row"><span>Value</span><b>' +
        (v === null ? '—' : SFP.format.number(v, 0) + ' ' + (el.bindings.value.unit || '')) + '</b></div>';
    }
    this._showTooltip(html, e);
  };

  Interactions.prototype._showTooltip = function (html, e) {
    var tip = this.tooltip;
    tip.innerHTML = html;
    tip.style.display = 'block';
    var host = this.canvas.parentElement.getBoundingClientRect();
    var x = e.clientX - host.left + 14, y = e.clientY - host.top + 14;
    /* Keep the tooltip inside the canvas container. */
    if (x + tip.offsetWidth > host.width - 8) { x = e.clientX - host.left - tip.offsetWidth - 10; }
    if (y + tip.offsetHeight > host.height - 8) { y = e.clientY - host.top - tip.offsetHeight - 10; }
    tip.style.left = x + 'px';
    tip.style.top = y + 'px';
  };

  Interactions.prototype._hideTooltip = function () {
    this.tooltip.style.display = 'none';
  };

  /* ── Click / selection ─────────────────────────────────────────────────── */

  Interactions.prototype._click = function (pt) {
    var hit = this.renderer.hitTest(this.camera.screenToWorld(pt));
    var store = this.store;

    if (!hit) { store.select(null, null); return; }

    if (hit.kind === 'floorChip') {
      this._cycleFloor(hit.id);
      return;
    }
    if (hit.kind === 'link') {
      store.select('connection', hit.id);
      return;
    }
    store.select('element', hit.id);
    var el = this.model.elements[hit.id];
    if (el.kind === 'zone') {
      /* Compatibility event — same contract as the previous factory map. */
      SFP.bus.emit('map:zoneSelected', { zoneId: el.id });
    }
  };

  Interactions.prototype._cycleFloor = function (ownerId) {
    var el = this.model.elements[ownerId];
    var current = this.store.activeFloor(el);
    var idx = 0;
    el.floors.forEach(function (f, i) { if (f.id === current) { idx = i; } });
    this.store.setActiveFloor(ownerId, el.floors[(idx + 1) % el.floors.length].id);
  };

  /* ── Context menu ──────────────────────────────────────────────────────── */

  Interactions.prototype._contextMenu = function (pt, e) {
    var self = this;
    var hit = this.renderer.hitTest(this.camera.screenToWorld(pt));
    var items = [];

    if (hit && hit.kind === 'link') {
      var link = hit.link;
      items.push({ label: 'Go to source: ' + link.fromEl.label, action: function () {
        self.camera.fitRect(link.fromEl.rect, true);
        self.store.select('element', link.fromEl.id);
      } });
      items.push({ label: 'Go to destination: ' + link.toEl.label, action: function () {
        self.camera.fitRect(link.toEl.rect, true);
        self.store.select('element', link.toEl.id);
      } });
      items.push({ label: 'Show only this utility', action: function () {
        var filters = {};
        SFP.config.get('twin').utilities.forEach(function (u) {
          filters[u.id] = (u.id === link.utility);
        });
        self.store.set({ filters: filters, filterMode: 'hide' });
      } });
      items.push({ label: 'Connection details', action: function () {
        self.store.select('connection', hit.id);
      } });
    } else if (hit && hit.kind === 'element') {
      var el = this.model.elements[hit.id];
      items.push({ label: 'Zoom to ' + el.label, action: function () {
        self.camera.fitRect(el.rect, true);
      } });
      items.push({ label: 'Details', action: function () {
        self.store.select('element', el.id);
      } });
      if (el.zoneId) {
        items.push({ label: 'View machines in zone', action: function () {
          self.nav.navigate('machines', { zone: el.zoneId });
        } });
      }
    } else {
      items.push({ label: 'Zoom to fit', action: function () { self.camera.fitWorld(true); } });
      items.push({ label: 'Show all utilities', action: function () {
        self.store.set({ filters: {}, filterMode: null });
      } });
    }

    var menu = this.menu;
    menu.innerHTML = '';
    items.forEach(function (item) {
      menu.appendChild(SFP.dom.el('button', {
        class: 'twin-menu-item',
        onclick: function () { self._closeMenu(); item.action(); },
        text: item.label,
      }));
    });
    var host = this.canvas.parentElement.getBoundingClientRect();
    menu.style.display = 'block';
    var x = e.clientX - host.left, y = e.clientY - host.top;
    if (x + 230 > host.width) { x = host.width - 235; }
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
  };

  Interactions.prototype._closeMenu = function () {
    if (this.menu) { this.menu.style.display = 'none'; }
  };

  SFP.twin.Interactions = Interactions;
}(window.SFP));
