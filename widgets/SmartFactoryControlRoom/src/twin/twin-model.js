/* ============================================================================
 * SFP.twin.model — spatial hierarchy model
 * ----------------------------------------------------------------------------
 * Turns the twin config files into a resolved, renderable model:
 *
 *   - absolute world rectangles for every zone / subzone / machine
 *     (config rects are relative to their parent — resolved here once)
 *   - auto-grid placement for machines that omit `rect`
 *   - floor gates: which (owner, floorId) pairs must be active for an
 *     element to be visible — covers zone floors AND subzone floors
 *   - normalized connections with endpoint element ids
 *   - registration of twin-only datapoints into the DataHub
 *   - a flat search index
 *
 * The model is pure data + lookups. It knows nothing about canvas, themes or
 * data values — renderers and panels consume it.
 *
 * Element ids:  zones keep their config id ('paint');  subzones are
 * '<zoneId>/<subzoneId>' ('paint/booths');  machines use their machine id
 * ('M-029', 'BLR-U1') which must be globally unique.
 * ========================================================================== */
(function (SFP) {
  'use strict';

  SFP.twin = SFP.twin || {};

  /** Auto-grid placement for machines without an explicit rect. */
  function autoPlace(machines, subzoneRect, auto) {
    var innerW = subzoneRect.w - auto.padding * 2;
    var cols = Math.max(1, Math.floor((innerW + auto.gap) / (auto.machineW + auto.gap)));
    var slot = 0;
    machines.forEach(function (m) {
      if (m.relRect) { return; }                  // explicitly placed in config
      var col = slot % cols, row = Math.floor(slot / cols);
      m.relRect = {
        x: auto.padding + col * (auto.machineW + auto.gap),
        y: auto.padding + auto.labelSpace + row * (auto.machineH + auto.gap),
        w: auto.machineW, h: auto.machineH,
      };
      slot += 1;
    });
  }

  function abs(parentRect, rel) {
    return { x: parentRect.x + rel.x, y: parentRect.y + rel.y, w: rel.w, h: rel.h };
  }

  function parseRef(ref) {
    var i = ref.indexOf(':');
    return { kind: ref.slice(0, i), id: ref.slice(i + 1) };
  }

  SFP.twin.model = {

    /** Build the resolved model from config. Call once per page mount. */
    build: function () {
      var layout = SFP.config.get('twin.layout');
      var connCfg = SFP.config.get('twin.connections');
      var twinCfg = SFP.config.get('twin');
      var auto = twinCfg.autoLayout;
      var registry = SFP.data.machines;

      var model = {
        world: layout.world,
        elements: {},          // id -> element record
        zones: [],             // zone records in config order
        connections: [],       // normalized connection records
        order: [],             // element ids in paint order (parents first)
      };

      function addElement(el) {
        if (model.elements[el.id]) {
          console.error('[SFP.twin] Duplicate element id "' + el.id + '"');
        }
        model.elements[el.id] = el;
        model.order.push(el.id);
        return el;
      }

      /* ── Machines ──────────────────────────────────────────────────────
       * `gates` = floor conditions inherited from every ancestor with
       * floors; a machine renders only while all its gates are active. */
      function buildMachine(cfg, subzone, gates) {
        var machineRef = cfg.ref || null;
        var fleet = machineRef ? registry.get(machineRef) : null;
        if (machineRef && !fleet) {
          console.error('[SFP.twin] Unknown machine ref "' + machineRef + '" in twin layout');
        }
        var id = cfg.id || machineRef;
        var bindings = cfg.bindings || {};
        if (fleet) {
          /* Fleet machines get state + load bindings from the registry. */
          bindings = {
            state: bindings.state || { datapoint: registry.dp(machineRef, 'state') },
            value: bindings.value || { datapoint: registry.dp(machineRef, 'load'), unit: '%' },
          };
        }
        return addElement({
          id: id, kind: 'machine',
          label: cfg.label || (fleet ? fleet.name : id),
          sublabel: cfg.kind || (fleet ? fleet.type : ''),
          shape: cfg.shape || 'rect',
          relRect: cfg.rect ? { x: cfg.rect.x, y: cfg.rect.y, w: cfg.rect.w, h: cfg.rect.h } : null,
          rect: null,                       // filled after autoPlace
          parentId: subzone.id, zoneId: subzone.zoneId,
          gates: gates, floors: null,
          machineRef: machineRef,
          bindings: bindings,
          style: cfg.style || null,
        });
      }

      /* ── Subzones (may carry their own floors) ─────────────────────── */
      function buildSubzone(cfg, zone, zoneRect, gates) {
        var id = zone.id + '/' + cfg.id;
        var rect = abs(zoneRect, cfg.rect);
        var subzone = addElement({
          id: id, kind: 'subzone',
          label: cfg.label, sublabel: '',
          rect: rect, parentId: zone.id, zoneId: zone.id,
          gates: gates,
          floors: cfg.floors
            ? cfg.floors.map(function (f) { return { id: f.id, label: f.label }; })
            : null,
          machineIds: [],
          style: cfg.style || null,
        });

        var floorDefs = cfg.floors || [{ id: 'main', machines: cfg.machines || [] }];
        floorDefs.forEach(function (floor) {
          var floorGates = cfg.floors
            ? gates.concat([{ owner: id, floor: floor.id }])
            : gates;
          var machines = (floor.machines || []).map(function (mc) {
            return buildMachine(mc, subzone, floorGates);
          });
          autoPlace(machines, rect, auto);
          machines.forEach(function (m) {
            m.rect = abs(rect, m.relRect);
            subzone.machineIds.push(m.id);
          });
        });
        return subzone;
      }

      /* ── Zones (may carry floors of subzones) ──────────────────────── */
      layout.zones.forEach(function (cfg) {
        var zone = addElement({
          id: cfg.id, kind: 'zone',
          label: cfg.label, sublabel: '',
          rect: { x: cfg.rect.x, y: cfg.rect.y, w: cfg.rect.w, h: cfg.rect.h },
          parentId: null, zoneId: cfg.id,
          gates: [],
          floors: cfg.floors
            ? cfg.floors.map(function (f) { return { id: f.id, label: f.label }; })
            : null,
          hint: cfg.hint || null,
          statusBinding: cfg.status ? cfg.status.datapoint : null,
          subzoneIds: [],
          style: cfg.style || null,
        });
        model.zones.push(zone);

        var floorDefs = cfg.floors || [{ id: 'main', subzones: cfg.subzones || [] }];
        floorDefs.forEach(function (floor) {
          var gates = cfg.floors ? [{ owner: zone.id, floor: floor.id }] : [];
          (floor.subzones || []).forEach(function (sc) {
            var subzone = buildSubzone(sc, zone, zone.rect, gates);
            zone.subzoneIds.push(subzone.id);
          });
        });
      });

      /* ── Connections ───────────────────────────────────────────────── */
      (connCfg.connections || []).forEach(function (cfg) {
        var from = parseRef(cfg.from.ref);
        var to = parseRef(cfg.to.ref);
        if (!model.elements[from.id] || !model.elements[to.id]) {
          console.error('[SFP.twin] Connection "' + cfg.id + '" references unknown element: ' +
            (model.elements[from.id] ? cfg.to.ref : cfg.from.ref));
          return;
        }
        model.connections.push({
          id: cfg.id,
          label: cfg.label || cfg.id,
          utility: cfg.utility,
          fromId: from.id, toId: to.id,
          fromAnchor: cfg.from.anchor || null,
          toAnchor: cfg.to.anchor || null,
          binding: cfg.binding || null,
          unit: cfg.unit || '',
          flowRange: cfg.flowRange || [0, 100],
          direction: cfg.direction || 'forward',
          rules: cfg.rules || [],
          badges: cfg.badges || [],
          route: cfg.route || null,
        });
      });

      /* Twin-only datapoints become first-class hub datapoints. */
      SFP.data.hub.defineAll(connCfg.datapoints || {});

      return model;
    },

    /* ── Lookups (work on a built model) ─────────────────────────────── */

    /** All connections that touch an element or anything inside it. */
    connectionsFor: function (model, elementId) {
      var contains = this.containsFn(model, elementId);
      return model.connections.filter(function (c) {
        return contains(c.fromId) || contains(c.toId);
      });
    },

    /** Returns fn(id) -> true if id is elementId or any descendant of it. */
    containsFn: function (model, elementId) {
      return function (id) {
        var el = model.elements[id];
        while (el) {
          if (el.id === elementId) { return true; }
          el = el.parentId ? model.elements[el.parentId] : null;
        }
        return false;
      };
    },

    /** Ancestor chain from the element up to its zone (self first). */
    pathOf: function (model, elementId) {
      var path = [];
      var el = model.elements[elementId];
      while (el) {
        path.push(el);
        el = el.parentId ? model.elements[el.parentId] : null;
      }
      return path;
    },

    /** Case-insensitive substring search over elements + connections. */
    search: function (model, query) {
      var q = String(query || '').trim().toLowerCase();
      if (!q) { return []; }
      var results = [];
      model.order.forEach(function (id) {
        var el = model.elements[id];
        var hay = (el.label + ' ' + el.id + ' ' + (el.sublabel || '')).toLowerCase();
        if (hay.indexOf(q) >= 0) {
          results.push({ kind: 'element', id: el.id, label: el.label, type: el.kind });
        }
      });
      model.connections.forEach(function (c) {
        if ((c.label + ' ' + c.id).toLowerCase().indexOf(q) >= 0) {
          results.push({ kind: 'connection', id: c.id, label: c.label, type: c.utility });
        }
      });
      return results.slice(0, 12);
    },
  };
}(window.SFP));
