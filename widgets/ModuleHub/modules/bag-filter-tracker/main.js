/* ============================================================================
 * Bag Filter Tracker — widgets/ModuleHub/modules/bag-filter-tracker/main.js
 * ----------------------------------------------------------------------------
 * Interactive 240-slot bag-filter maintenance tracker.
 * Three independently-tracked parts per slot: upper frame, lower frame, bag.
 * Circular array-map layout • Slot / Tray / Worklist / History tabs
 * All I/O via sdk (§6); plain JS, no build, no deps.
 *
 * Sections:
 *   §A  Pure logic (ring layout, wear calc, state mutations)
 *   §B  CSS injection
 *   §C  DOM scaffolding
 *   §D  Array-map renderer
 *   §E  Slot detail panel
 *   §F  Tray panel
 *   §G  Worklist panel
 *   §H  History panel
 *   §I  Tick loop & ResizeObserver
 *   §J  Bootstrap: load state, first-run, register
 * ============================================================================ */

/* Module-level handles shared between create() and destroy() */
var _bft_tickInterval = null;
var _bft_resizeObs    = null;

MH.register({

  /* ── create ──────────────────────────────────────────────────────────────── */
  create: function (sdk, root) {
    'use strict';

    var cfg       = sdk.config;          // module.json config block
    var SLOTS     = cfg.slots    || 240;
    var WARN_PCT  = cfg.warnAtPct || 75;
    var PART_TYPES = cfg.partTypes || {
      upper: { label: 'Upper frame', maxHours: 2000 },
      lower: { label: 'Lower frame', maxHours: 2000 },
      bag:   { label: 'Bag',         maxHours: 1000 }
    };
    var PART_KEYS = ['upper', 'lower', 'bag'];

    /* ── references owned across closures ───────────────────────────────── */
    var _state        = null;   // { slots: {...}, tray: [...] }
    var _selectedSlot = null;   // string slot key e.g. "1".."240"
    var _activeTab    = 'slot'; // 'slot' | 'tray' | 'worklist' | 'history'
    /* use module-level _bft_tickInterval, _bft_resizeObs for destroy() access */
    var _slotNodes    = {};     // slotKey → DOM element
    var _ghostEl      = null;   // drag ghost
    var _mapContainer = null;   // the circular map div (absolute-positioned children)
    var _mapWrapper   = null;   // wrapper that constrains the circle
    var _panelRoot    = null;   // right-side panel root

    /* ======================================================================
     * §A  PURE LOGIC
     * ====================================================================== */

    /* ── §A1  Ring layout calculator ──────────────────────────────────────
     *
     * Distributes `total` nodes into concentric rings inside a circle of
     * diameter D.  A centre dot occupies ring 0 with capacity 1 (not used
     * for slots).  Outer rings increase radius from innerR stepping by
     * `ringStep` (px); each ring gets a capacity proportional to its
     * circumference so that node spacing is approximately even.
     *
     * Returns an array of { x, y } objects (absolute px inside a DxD box),
     * indexed 0..(total-1).
     *
     * Parameters:
     *   total    — number of nodes (e.g. 240)
     *   D        — container side length in px
     *   nodeSize — approximate diameter of each node (px); used for spacing
     *
     * Exported pure: ringLayout(total, D, nodeSize)  → [{x,y}, ...]
     * ---------------------------------------------------------------------- */
    function ringLayout(total, D, nodeSize) {
      var cx = D / 2;
      var cy = D / 2;
      var maxR = D / 2 - nodeSize;   // keep nodes inside boundary
      var minR = nodeSize * 1.5;     // smallest ring radius

      // Step between rings — roughly one node diameter plus a small gap
      var ringStep = nodeSize * 1.6;

      // How many rings fit?
      var rings = [];
      var r = minR;
      while (r <= maxR) {
        rings.push(r);
        r += ringStep;
      }
      // If we got 0 rings, force at least one
      if (rings.length === 0) { rings.push(minR); }

      // Distribute `total` slots across rings proportionally to circumference
      var totalCirc = rings.reduce(function (s, rr) { return s + rr; }, 0);
      var capacities = rings.map(function (rr) {
        return Math.max(1, Math.round(total * rr / totalCirc));
      });

      // Adjust last ring so capacities sum exactly to total
      var capSum = capacities.reduce(function (s, c) { return s + c; }, 0);
      var diff   = total - capSum;
      capacities[capacities.length - 1] += diff;
      // If diff was negative (over-allocated), trim from last ring and carry back
      for (var i = capacities.length - 1; i >= 0; i--) {
        if (capacities[i] < 1) {
          var borrow = 1 - capacities[i];
          capacities[i] = 1;
          if (i > 0) { capacities[i - 1] -= borrow; }
        }
      }

      // Generate positions
      var positions = [];
      for (var ri = 0; ri < rings.length; ri++) {
        var cap  = capacities[ri];
        var rRing = rings[ri];
        for (var ni = 0; ni < cap; ni++) {
          var angle = (2 * Math.PI * ni / cap) - Math.PI / 2; // start at top
          positions.push({
            x: cx + rRing * Math.cos(angle),
            y: cy + rRing * Math.sin(angle)
          });
        }
      }

      // Truncate / extend to exactly `total` (safety)
      while (positions.length < total) {
        positions.push({ x: cx, y: cy });
      }
      return positions.slice(0, total);
    }

    /* ── §A2  Wear calculation ─────────────────────────────────────────────
     *
     * inUseHours(part, now)  → number
     * wearPct(part, partTypeKey)  → number (0-based %)
     * colorBucket(pct)  → 'good' | 'warn' | 'alarm'
     * slotColorBucket(slotData, now)  → 'good' | 'warn' | 'alarm' | 'empty'
     * ---------------------------------------------------------------------- */

    function inUseMs(part, now) {
      if (!part) { return 0; }
      var acc = part.accumMs || 0;
      if (part.installedAt != null) {
        acc += (now - part.installedAt);
      }
      return acc;
    }

    function inUseHours(part, now) {
      return inUseMs(part, now) / 3600000;
    }

    function wearPct(part, typeKey, now) {
      if (!part) { return 0; }
      var maxH = (PART_TYPES[typeKey] && PART_TYPES[typeKey].maxHours) || 1000;
      return (inUseHours(part, now) / maxH) * 100;
    }

    function colorBucket(pct) {
      if (pct >= 100)        { return 'alarm'; }
      if (pct >= WARN_PCT)   { return 'warn'; }
      return 'good';
    }

    function slotColorBucket(slotData, now) {
      if (!slotData) { return 'empty'; }
      var hasPart = false;
      var maxPct  = 0;
      PART_KEYS.forEach(function (k) {
        if (slotData[k]) {
          hasPart = true;
          var pct = wearPct(slotData[k], k, now);
          if (pct > maxPct) { maxPct = pct; }
        }
      });
      if (!hasPart) { return 'empty'; }
      return colorBucket(maxPct);
    }

    /* ── §A3  State mutation helpers ──────────────────────────────────────
     *
     * All mutators return a tx object (for sdk.store.tx.add) and modify
     * _state in place.  Caller must persist state + write tx.
     *
     * freezePart(part)  — fold elapsed time into accumMs, clear installedAt
     * thawPart(part)    — set installedAt = now (clock resumes)
     * ---------------------------------------------------------------------- */

    function freezePart(part) {
      if (!part) { return; }
      if (part.installedAt != null) {
        part.accumMs = (part.accumMs || 0) + (Date.now() - part.installedAt);
        part.installedAt = null;
      }
    }

    function thawPart(part) {
      if (!part) { return; }
      part.installedAt = Date.now();
    }

    function ensureSlot(slotKey) {
      if (!_state.slots[slotKey]) {
        _state.slots[slotKey] = { upper: null, lower: null, bag: null };
      }
    }

    /* install a part from tray into a slot */
    function installPart(trayIndex, slotKey, partTypeKey) {
      var item = _state.tray[trayIndex];
      if (!item) { return null; }
      ensureSlot(slotKey);
      if (_state.slots[slotKey][partTypeKey]) { return null; } // occupied
      var part = item.part;
      thawPart(part);
      _state.slots[slotKey][partTypeKey] = part;
      _state.tray.splice(trayIndex, 1);
      return { ns: 'bagfilter', action: 'install', partType: partTypeKey,
               partId: part.id, fromSlot: 'tray', toSlot: slotKey, user: 'operator' };
    }

    /* remove a part from a slot to tray */
    function removePart(slotKey, partTypeKey) {
      if (!_state.slots[slotKey]) { return null; }
      var part = _state.slots[slotKey][partTypeKey];
      if (!part) { return null; }
      freezePart(part);
      _state.slots[slotKey][partTypeKey] = null;
      _state.tray.push({ partType: partTypeKey, part: part });
      return { ns: 'bagfilter', action: 'remove', partType: partTypeKey,
               partId: part.id, fromSlot: slotKey, toSlot: 'tray', user: 'operator' };
    }

    /* replace a part in slot with a new serial (old part goes to tray) */
    function replacePart(slotKey, partTypeKey, newSerial) {
      ensureSlot(slotKey);
      var oldPart = _state.slots[slotKey][partTypeKey];
      if (oldPart) { freezePart(oldPart); _state.tray.push({ partType: partTypeKey, part: oldPart }); }
      var newPart = { id: newSerial, installedAt: Date.now(), accumMs: 0 };
      _state.slots[slotKey][partTypeKey] = newPart;
      return { ns: 'bagfilter', action: 'replace', partType: partTypeKey,
               partId: newSerial, fromSlot: oldPart ? 'tray' : null, toSlot: slotKey,
               note: oldPart ? ('replaced ' + oldPart.id) : 'new install',
               user: 'operator' };
    }

    /* detach upper/lower — removes from slot to tray with specific action */
    function detachSection(slotKey, partTypeKey) {
      if (!_state.slots[slotKey]) { return null; }
      var part = _state.slots[slotKey][partTypeKey];
      if (!part) { return null; }
      freezePart(part);
      _state.slots[slotKey][partTypeKey] = null;
      _state.tray.push({ partType: partTypeKey, part: part });
      var action = partTypeKey === 'upper' ? 'detach-upper' : 'detach-lower';
      return { ns: 'bagfilter', action: action, partType: partTypeKey,
               partId: part.id, fromSlot: slotKey, toSlot: 'tray', user: 'operator' };
    }

    /* attach upper/lower — installs from tray by tray index */
    function attachSection(trayIndex, slotKey, partTypeKey) {
      var item = _state.tray[trayIndex];
      if (!item || item.partType !== partTypeKey) { return null; }
      ensureSlot(slotKey);
      if (_state.slots[slotKey][partTypeKey]) { return null; }
      var part = item.part;
      thawPart(part);
      _state.slots[slotKey][partTypeKey] = part;
      _state.tray.splice(trayIndex, 1);
      var action = partTypeKey === 'upper' ? 'attach-upper' : 'attach-lower';
      return { ns: 'bagfilter', action: action, partType: partTypeKey,
               partId: part.id, fromSlot: 'tray', toSlot: slotKey, user: 'operator' };
    }

    /* bag-on: install bag */
    function bagOn(trayIndex, slotKey) {
      var item = _state.tray[trayIndex];
      if (!item || item.partType !== 'bag') { return null; }
      ensureSlot(slotKey);
      if (_state.slots[slotKey].bag) { return null; }
      var part = item.part;
      thawPart(part);
      _state.slots[slotKey].bag = part;
      _state.tray.splice(trayIndex, 1);
      return { ns: 'bagfilter', action: 'bag-on', partType: 'bag',
               partId: part.id, fromSlot: 'tray', toSlot: slotKey, user: 'operator' };
    }

    /* bag-off: remove bag */
    function bagOff(slotKey) {
      if (!_state.slots[slotKey]) { return null; }
      var part = _state.slots[slotKey].bag;
      if (!part) { return null; }
      freezePart(part);
      _state.slots[slotKey].bag = null;
      _state.tray.push({ partType: 'bag', part: part });
      return { ns: 'bagfilter', action: 'bag-off', partType: 'bag',
               partId: part.id, fromSlot: slotKey, toSlot: 'tray', user: 'operator' };
    }

    /* add a repair note */
    function addRepairNote(slotKey, partTypeKey, note) {
      var part = _state.slots[slotKey] && _state.slots[slotKey][partTypeKey];
      if (!part) { return null; }
      return { ns: 'bagfilter', action: 'repair-note', partType: partTypeKey,
               partId: part.id, fromSlot: slotKey, toSlot: null,
               note: note, user: 'operator' };
    }

    /* ── §A4  Demo-data seed ──────────────────────────────────────────────── */

    function buildSeedState() {
      var slots = {};
      var now   = Date.now();
      for (var i = 1; i <= SLOTS; i++) {
        var key = String(i);
        var ufAccum = Math.random() * PART_TYPES.upper.maxHours * 1.2 * 3600000;
        var lfAccum = Math.random() * PART_TYPES.lower.maxHours * 1.2 * 3600000;
        var bagAccum = Math.random() * PART_TYPES.bag.maxHours * 1.2 * 3600000;
        // installed some time ago (0-90 days)
        var instOffset = Math.floor(Math.random() * 90 * 24 * 3600000);
        slots[key] = {
          upper: { id: 'UF-' + String(i).padStart(4, '0'), installedAt: now - instOffset, accumMs: ufAccum },
          lower: { id: 'LF-' + String(i).padStart(4, '0'), installedAt: now - instOffset, accumMs: lfAccum },
          bag:   { id: 'BG-' + String(i).padStart(4, '0'), installedAt: now - instOffset, accumMs: bagAccum }
        };
      }
      return { slots: slots, tray: [] };
    }

    /* ======================================================================
     * §B  CSS INJECTION
     * ====================================================================== */

    function injectStyles() {
      var style = document.createElement('style');
      style.textContent = [
        /* Root layout */
        '.bft-root{',
        '  position:absolute;inset:0;display:flex;',
        '  background:var(--c-bg-base,#070b15);',
        '  color:var(--c-text-1,#e8ecf8);',
        '  font-family:"Segoe UI",system-ui,sans-serif;font-size:13px;',
        '  overflow:hidden;',
        '}',

        /* Map side */
        '.bft-map-side{',
        '  flex:0 0 60%;display:flex;flex-direction:column;',
        '  border-right:1px solid var(--c-border,#1e2a3a);',
        '  min-width:0;',
        '}',
        '.bft-map-header{',
        '  padding:8px 12px;border-bottom:1px solid var(--c-border,#1e2a3a);',
        '  display:flex;align-items:center;gap:10px;flex-shrink:0;',
        '}',
        '.bft-map-header h2{margin:0;font-size:15px;font-weight:600;color:var(--c-accent,#38bdf8);}',
        '.bft-map-header .bft-legend{display:flex;gap:8px;margin-left:auto;align-items:center;font-size:11px;}',
        '.bft-legend-dot{width:10px;height:10px;border-radius:50%;display:inline-block;}',

        /* Map wrapper: constrains the circular vessel outline */
        '.bft-map-wrapper{',
        '  flex:1 1 0;display:flex;align-items:center;justify-content:center;',
        '  overflow:hidden;padding:12px;min-height:0;',
        '}',
        '.bft-map-container{',
        '  position:relative;border-radius:50%;flex-shrink:0;',
        '  border:2px solid var(--c-border-strong,#2e3f54);',
        '}',

        /* Slot nodes */
        '.bft-slot{',
        '  position:absolute;border-radius:50%;cursor:pointer;',
        '  transition:transform 0.12s, box-shadow 0.12s;',
        '  box-sizing:border-box;',
        '  border:1.5px solid transparent;',
        '}',
        '.bft-slot:hover{transform:scale(1.35);z-index:10;}',
        '.bft-slot.selected{',
        '  box-shadow:0 0 0 2.5px var(--c-accent,#38bdf8);',
        '  z-index:20;transform:scale(1.3);',
        '}',
        /* Color fills via bucket classes */
        '.bft-slot.c-good  {background:var(--c-good,#34d399);}',
        '.bft-slot.c-warn  {background:var(--c-warn,#fbbf24);}',
        '.bft-slot.c-alarm {background:var(--c-alarm,#f87171);}',
        '.bft-slot.c-empty {background:transparent;border-color:var(--c-border,#1e2a3a);}',

        /* Panel side */
        '.bft-panel-side{',
        '  flex:1 1 40%;display:flex;flex-direction:column;min-width:0;overflow:hidden;',
        '}',

        /* Tab bar */
        '.bft-tabs{',
        '  display:flex;border-bottom:1px solid var(--c-border,#1e2a3a);flex-shrink:0;',
        '}',
        '.bft-tab{',
        '  padding:8px 14px;cursor:pointer;font-size:12px;font-weight:500;',
        '  border-bottom:2px solid transparent;color:var(--c-text-2,#8899aa);',
        '  background:none;border-top:none;border-left:none;border-right:none;',
        '  transition:color 0.15s,border-color 0.15s;',
        '}',
        '.bft-tab:hover{color:var(--c-text-1,#e8ecf8);}',
        '.bft-tab.active{color:var(--c-accent,#38bdf8);border-bottom-color:var(--c-accent,#38bdf8);}',

        /* Tab content */
        '.bft-tab-content{flex:1 1 0;overflow-y:auto;padding:12px;min-height:0;}',

        /* Slot panel */
        '.bft-slot-info{margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid var(--c-border,#1e2a3a);}',
        '.bft-slot-info h3{margin:0 0 4px;font-size:14px;color:var(--c-accent,#38bdf8);}',
        '.bft-part-row{',
        '  padding:8px 0;border-bottom:1px solid var(--c-border,#1e2a3a);',
        '}',
        '.bft-part-row:last-child{border-bottom:none;}',
        '.bft-part-label{font-weight:600;font-size:12px;color:var(--c-text-2,#8899aa);margin-bottom:4px;display:flex;justify-content:space-between;}',
        '.bft-part-serial{font-size:13px;color:var(--c-text-1,#e8ecf8);margin-bottom:3px;}',
        '.bft-part-hours{font-size:12px;color:var(--c-text-2,#8899aa);margin-bottom:5px;}',

        /* Wear bar */
        '.bft-bar-bg{height:5px;border-radius:3px;background:var(--c-bg-raised,#1a2332);overflow:hidden;margin-bottom:6px;}',
        '.bft-bar-fill{height:100%;border-radius:3px;transition:width 0.3s;}',

        /* Action buttons */
        '.bft-actions{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px;}',
        '.bft-btn{',
        '  padding:3px 8px;border-radius:4px;font-size:11px;font-weight:500;cursor:pointer;',
        '  border:1px solid var(--c-border,#1e2a3a);',
        '  background:var(--c-bg-raised,#1a2332);color:var(--c-text-1,#e8ecf8);',
        '  transition:background 0.12s,border-color 0.12s;',
        '}',
        '.bft-btn:hover{background:var(--c-bg-card,#121c2b);border-color:var(--c-accent,#38bdf8);}',
        '.bft-btn.danger{border-color:var(--c-alarm,#f87171);color:var(--c-alarm,#f87171);}',
        '.bft-btn.danger:hover{background:rgba(248,113,113,0.12);}',
        '.bft-btn:disabled{opacity:0.4;cursor:not-allowed;}',

        /* Inline form */
        '.bft-inline-form{',
        '  margin-top:8px;padding:8px;border-radius:6px;',
        '  background:var(--c-bg-card,#121c2b);border:1px solid var(--c-border,#1e2a3a);',
        '}',
        '.bft-inline-form label{display:block;font-size:11px;color:var(--c-text-2,#8899aa);margin-bottom:4px;}',
        '.bft-inline-form input,.bft-inline-form textarea{',
        '  width:100%;box-sizing:border-box;padding:5px 8px;border-radius:4px;font-size:12px;',
        '  background:var(--c-bg-raised,#1a2332);color:var(--c-text-1,#e8ecf8);',
        '  border:1px solid var(--c-border,#1e2a3a);outline:none;',
        '}',
        '.bft-inline-form input:focus,.bft-inline-form textarea:focus{border-color:var(--c-accent,#38bdf8);}',
        '.bft-inline-form .bft-form-row{display:flex;gap:6px;margin-top:6px;}',

        /* Tray */
        '.bft-tray-item{',
        '  display:flex;align-items:center;gap:8px;padding:7px 8px;',
        '  border-radius:5px;margin-bottom:4px;cursor:grab;',
        '  background:var(--c-bg-card,#121c2b);border:1px solid var(--c-border,#1e2a3a);',
        '  transition:border-color 0.12s;user-select:none;',
        '}',
        '.bft-tray-item:hover{border-color:var(--c-accent,#38bdf8);}',
        '.bft-tray-item .bft-type-badge{',
        '  width:28px;height:28px;border-radius:4px;font-size:10px;font-weight:700;',
        '  display:flex;align-items:center;justify-content:center;flex-shrink:0;',
        '  background:var(--c-bg-raised,#1a2332);color:var(--c-accent,#38bdf8);',
        '}',
        '.bft-tray-item .bft-tray-meta{flex:1;min-width:0;}',
        '.bft-tray-item .bft-tray-serial{font-size:12px;font-weight:600;}',
        '.bft-tray-item .bft-tray-hours{font-size:11px;color:var(--c-text-2,#8899aa);}',
        '.bft-tray-item .bft-tray-install{margin-left:auto;flex-shrink:0;}',

        /* Drag ghost */
        '.bft-ghost{',
        '  position:fixed;pointer-events:none;z-index:99999;',
        '  padding:4px 8px;border-radius:4px;font-size:11px;',
        '  background:var(--c-accent,#38bdf8);color:#000;',
        '  box-shadow:0 4px 12px rgba(0,0,0,0.5);',
        '  transform:translate(-50%,-50%);white-space:nowrap;',
        '}',
        '.bft-slot.drop-target{box-shadow:0 0 0 2.5px var(--c-good,#34d399);z-index:25;}',

        /* Worklist */
        '.bft-wl-row{',
        '  display:flex;align-items:center;gap:6px;padding:6px 8px;',
        '  border-radius:4px;margin-bottom:3px;cursor:pointer;',
        '  background:var(--c-bg-card,#121c2b);border:1px solid var(--c-border,#1e2a3a);',
        '  font-size:12px;transition:border-color 0.12s;',
        '}',
        '.bft-wl-row:hover{border-color:var(--c-accent,#38bdf8);}',
        '.bft-wl-row .bft-wl-slot{font-weight:700;width:30px;flex-shrink:0;color:var(--c-text-2,#8899aa);}',
        '.bft-wl-row .bft-wl-type{width:36px;flex-shrink:0;font-size:10px;font-weight:600;color:var(--c-accent,#38bdf8);}',
        '.bft-wl-row .bft-wl-serial{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
        '.bft-wl-row .bft-wl-hours{width:48px;text-align:right;flex-shrink:0;}',
        '.bft-wl-row .bft-wl-pct{width:38px;text-align:right;flex-shrink:0;font-weight:600;}',
        '.bft-wl-row .bft-wl-bar{width:50px;flex-shrink:0;}',

        /* History */
        '.bft-hist-filter{display:flex;gap:6px;margin-bottom:8px;}',
        '.bft-hist-filter input{',
        '  flex:1;padding:4px 8px;border-radius:4px;font-size:12px;',
        '  background:var(--c-bg-raised,#1a2332);color:var(--c-text-1,#e8ecf8);',
        '  border:1px solid var(--c-border,#1e2a3a);outline:none;',
        '}',
        '.bft-hist-filter input:focus{border-color:var(--c-accent,#38bdf8);}',
        '.bft-hist-row{',
        '  padding:5px 8px;border-radius:4px;margin-bottom:2px;',
        '  background:var(--c-bg-card,#121c2b);border-left:3px solid var(--c-border,#1e2a3a);',
        '  font-size:11px;color:var(--c-text-2,#8899aa);',
        '}',
        '.bft-hist-row .bft-hist-action{font-weight:600;color:var(--c-text-1,#e8ecf8);text-transform:uppercase;font-size:10px;}',
        '.bft-hist-row .bft-hist-ts{color:var(--c-text-3,#4a5568);}',
        '.bft-hist-row .bft-hist-note{color:var(--c-warn,#fbbf24);margin-top:2px;}',

        /* Empty state */
        '.bft-empty{',
        '  display:flex;flex-direction:column;align-items:center;justify-content:center;',
        '  height:100%;gap:12px;color:var(--c-text-2,#8899aa);text-align:center;',
        '}',
        '.bft-empty p{margin:0;font-size:13px;}',
        '.bft-seed-btn{',
        '  padding:8px 18px;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;',
        '  background:var(--c-accent,#38bdf8);color:#000;border:none;',
        '  transition:opacity 0.15s;',
        '}',
        '.bft-seed-btn:hover{opacity:0.85;}',

        /* First-run overlay */
        '.bft-firstrun{',
        '  position:absolute;inset:0;display:flex;align-items:center;justify-content:center;',
        '  background:rgba(7,11,21,0.85);z-index:50;',
        '}',
        '.bft-firstrun-card{',
        '  background:var(--c-bg-card,#121c2b);border:1px solid var(--c-border-strong,#2e3f54);',
        '  border-radius:10px;padding:28px 32px;text-align:center;max-width:320px;',
        '}',
        '.bft-firstrun-card h3{margin:0 0 10px;font-size:17px;color:var(--c-accent,#38bdf8);}',
        '.bft-firstrun-card p{margin:0 0 18px;color:var(--c-text-2,#8899aa);font-size:13px;line-height:1.5;}',

        /* Scrollbar */
        '.bft-tab-content::-webkit-scrollbar{width:5px;}',
        '.bft-tab-content::-webkit-scrollbar-track{background:transparent;}',
        '.bft-tab-content::-webkit-scrollbar-thumb{background:var(--c-border,#1e2a3a);border-radius:3px;}',
      ].join('\n');
      document.head.appendChild(style);
    }

    /* ======================================================================
     * §C  DOM SCAFFOLDING
     * ====================================================================== */

    function buildScaffold() {
      var el = sdk.ui.el;

      root.style.position = 'relative';
      root.style.overflow = 'hidden';

      // Root flex container
      var rootDiv = el('div', { className: 'bft-root' }, []);
      root.appendChild(rootDiv);

      // ── Map side ──
      var mapSide = el('div', { className: 'bft-map-side' }, []);

      var legend = el('div', { className: 'bft-legend' }, [
        el('span', { className: 'bft-legend-dot', style: { background: 'var(--c-good,#34d399)' } }, []),
        el('span', {}, [' OK']),
        el('span', { className: 'bft-legend-dot', style: { background: 'var(--c-warn,#fbbf24)', marginLeft:'6px' } }, []),
        el('span', {}, [' Warn']),
        el('span', { className: 'bft-legend-dot', style: { background: 'var(--c-alarm,#f87171)', marginLeft:'6px' } }, []),
        el('span', {}, [' Overdue']),
      ]);

      var mapHeader = el('div', { className: 'bft-map-header' }, [
        el('h2', {}, ['Bag Filter Array']),
        legend
      ]);
      mapSide.appendChild(mapHeader);

      _mapWrapper = el('div', { className: 'bft-map-wrapper' }, []);
      _mapContainer = el('div', { className: 'bft-map-container' }, []);
      _mapWrapper.appendChild(_mapContainer);
      mapSide.appendChild(_mapWrapper);

      // ── Panel side ──
      _panelRoot = el('div', { className: 'bft-panel-side' }, []);

      // Tab bar
      var tabBar = el('div', { className: 'bft-tabs' }, []);
      var tabs = [
        { id: 'slot',      label: 'Slot' },
        { id: 'tray',      label: 'Tray' },
        { id: 'worklist',  label: 'Worklist' },
        { id: 'history',   label: 'History' },
      ];
      var _tabEls = {};
      tabs.forEach(function (t) {
        var tabEl = el('button', {
          className: 'bft-tab' + (t.id === _activeTab ? ' active' : ''),
          onClick: function () { switchTab(t.id); }
        }, [t.label]);
        _tabEls[t.id] = tabEl;
        tabBar.appendChild(tabEl);
      });
      _panelRoot.appendChild(tabBar);

      var tabContent = el('div', { className: 'bft-tab-content' }, []);
      tabContent.id = 'bft-tab-content';
      _panelRoot.appendChild(tabContent);

      rootDiv.appendChild(mapSide);
      rootDiv.appendChild(_panelRoot);

      // Store switchTab in closure for use by panel renderers
      _switchTab = function (id) {
        _activeTab = id;
        Object.keys(_tabEls).forEach(function (k) {
          _tabEls[k].classList.toggle('active', k === id);
        });
        renderActiveTab();
      };

      function switchTab(id) { _switchTab(id); }

      return {
        rootDiv:    rootDiv,
        tabContent: tabContent,
      };
    }

    var _switchTab = null; // assigned in buildScaffold

    /* ======================================================================
     * §D  ARRAY MAP RENDERER
     * ====================================================================== */

    var _mapSize   = 0;
    var _nodeSize  = 0;
    var _positions = []; // [{x,y}] for slots 1..240

    function computeMapSize() {
      var rect = _mapWrapper.getBoundingClientRect();
      var avail = Math.min(rect.width, rect.height) - 24; // padding
      if (avail < 60) { avail = 60; }
      return avail;
    }

    function buildSlotNodes() {
      // Clear existing
      while (_mapContainer.firstChild) {
        _mapContainer.removeChild(_mapContainer.firstChild);
      }
      _slotNodes = {};

      var D    = _mapSize;
      var ns   = _nodeSize;

      _mapContainer.style.width  = D + 'px';
      _mapContainer.style.height = D + 'px';

      _positions = ringLayout(SLOTS, D, ns);

      for (var i = 0; i < SLOTS; i++) {
        var slotKey = String(i + 1);
        var pos = _positions[i];
        var slotEl = sdk.ui.el('div', {
          className: 'bft-slot c-empty',
          style: {
            width:       ns + 'px',
            height:      ns + 'px',
            left:        (pos.x - ns / 2) + 'px',
            top:         (pos.y - ns / 2) + 'px',
          },
          title: 'Slot ' + slotKey,
        }, []);

        // selection click
        (function (sk) {
          slotEl.addEventListener('click', function () {
            selectSlot(sk);
          });
        }(slotKey));

        _slotNodes[slotKey] = slotEl;
        _mapContainer.appendChild(slotEl);
      }
    }

    function updateMapColors() {
      if (!_state) { return; }
      var now = Date.now();
      for (var i = 1; i <= SLOTS; i++) {
        var sk  = String(i);
        var el  = _slotNodes[sk];
        if (!el) { continue; }
        var slotData = _state.slots[sk];
        var bucket   = slotColorBucket(slotData, now);
        el.className = 'bft-slot c-' + bucket +
          (_selectedSlot === sk ? ' selected' : '');
      }
    }

    function selectSlot(slotKey) {
      _selectedSlot = slotKey;
      updateMapColors();
      _switchTab('slot');
      renderActiveTab();
    }

    function initMap() {
      _mapSize  = computeMapSize();
      _nodeSize = Math.max(10, Math.round(_mapSize / 28));
      buildSlotNodes();
      updateMapColors();
    }

    /* ======================================================================
     * §E  SLOT DETAIL PANEL
     * ====================================================================== */

    function renderSlotTab() {
      var content = document.getElementById('bft-tab-content');
      while (content.firstChild) { content.removeChild(content.firstChild); }

      if (!_selectedSlot) {
        content.appendChild(sdk.ui.el('div', { className: 'bft-empty' }, [
          sdk.ui.el('p', {}, ['Click a slot on the map to inspect it.'])
        ]));
        return;
      }

      var slotData = (_state && _state.slots[_selectedSlot]) || { upper: null, lower: null, bag: null };
      var now = Date.now();

      var info = sdk.ui.el('div', { className: 'bft-slot-info' }, [
        sdk.ui.el('h3', {}, ['Slot ' + _selectedSlot]),
      ]);
      content.appendChild(info);

      PART_KEYS.forEach(function (typeKey) {
        var part    = slotData[typeKey];
        var ptCfg   = PART_TYPES[typeKey];
        var hours   = inUseHours(part, now);
        var pct     = wearPct(part, typeKey, now);
        var bucket  = part ? colorBucket(pct) : 'empty';
        var barColor = bucket === 'good'  ? 'var(--c-good,#34d399)' :
                       bucket === 'warn'  ? 'var(--c-warn,#fbbf24)' :
                       bucket === 'alarm' ? 'var(--c-alarm,#f87171)' :
                                            'var(--c-border,#1e2a3a)';

        var barFill = sdk.ui.el('div', { className: 'bft-bar-fill', style: {
          width:      Math.min(100, pct).toFixed(1) + '%',
          background: barColor,
        }}, []);
        var bar = sdk.ui.el('div', { className: 'bft-bar-bg' }, [barFill]);

        var labelRow = sdk.ui.el('div', { className: 'bft-part-label' }, [
          ptCfg.label,
          sdk.ui.el('span', { style: { color: barColor, fontWeight: '700' } },
            [part ? pct.toFixed(1) + '%' : '—'])
        ]);

        var serialEl = sdk.ui.el('div', { className: 'bft-part-serial' }, [
          part ? part.id : sdk.ui.el('em', { style: { color: 'var(--c-text-3,#4a5568)' } }, ['(empty)'])
        ]);

        var hoursEl = sdk.ui.el('div', { className: 'bft-part-hours' }, [
          part ? (hours.toFixed(1) + ' h / ' + ptCfg.maxHours + ' h max') : ''
        ]);

        // ── Action buttons ──
        var actionsEl = buildPartActions(typeKey, part, slotData);

        var row = sdk.ui.el('div', { className: 'bft-part-row' }, [
          labelRow, serialEl, hoursEl, bar, actionsEl
        ]);
        content.appendChild(row);
      });
    }

    /* Build action button area for one part in the slot panel */
    function buildPartActions(typeKey, part, slotData) {
      var el = sdk.ui.el;
      var actionsEl = el('div', { className: 'bft-actions' }, []);

      // Tray items of this type
      var trayItems = (_state.tray || []).filter(function (t) { return t.partType === typeKey; });

      if (!part) {
        // ── Empty: install-from-tray picker ──
        if (trayItems.length > 0) {
          var picker = buildInstallPicker(typeKey, trayItems);
          actionsEl.appendChild(picker);
        }
        // Replace (install new)
        actionsEl.appendChild(buildReplaceBtn(typeKey, null));
      } else {
        // ── Occupied: remove, detach, bag ops, replace, repair note ──
        // Remove to tray
        actionsEl.appendChild(el('button', {
          className: 'bft-btn danger',
          title: 'Remove to tray',
          onClick: function () {
            var tx = removePart(_selectedSlot, typeKey);
            if (tx) { persistAndTx(tx); }
          }
        }, ['Remove']));

        // Detach upper / attach upper
        if (typeKey === 'upper' || typeKey === 'lower') {
          var detachLabel = typeKey === 'upper' ? 'Detach upper' : 'Detach lower';
          actionsEl.appendChild(el('button', {
            className: 'bft-btn',
            onClick: function () {
              var tx = detachSection(_selectedSlot, typeKey);
              if (tx) { persistAndTx(tx); }
            }
          }, [detachLabel]));
          // Attach from tray if tray has matching items
          if (trayItems.length > 0) {
            var attachLabel = typeKey === 'upper' ? 'Attach upper' : 'Attach lower';
            actionsEl.appendChild(el('button', {
              className: 'bft-btn',
              onClick: function () {
                var idx = findTrayIndex(typeKey, null);
                if (idx < 0) { sdk.ui.toast('No ' + typeKey + ' frame in tray', 'warn'); return; }
                var tx = attachSection(idx, _selectedSlot, typeKey);
                if (tx) { persistAndTx(tx); }
              }
            }, [attachLabel]));
          }
        }

        // Bag on / bag off
        if (typeKey === 'bag') {
          actionsEl.appendChild(el('button', {
            className: 'bft-btn danger',
            onClick: function () {
              var tx = bagOff(_selectedSlot);
              if (tx) { persistAndTx(tx); }
            }
          }, ['Bag off']));
          if (trayItems.length > 0) {
            actionsEl.appendChild(el('button', {
              className: 'bft-btn',
              onClick: function () {
                var idx = findTrayIndex('bag', null);
                if (idx < 0) { sdk.ui.toast('No bag in tray', 'warn'); return; }
                var tx = bagOn(idx, _selectedSlot);
                if (tx) { persistAndTx(tx); }
              }
            }, ['Bag on']));
          }
        }

        // Replace
        actionsEl.appendChild(buildReplaceBtn(typeKey, part));

        // Repair note
        actionsEl.appendChild(buildRepairNoteBtn(typeKey, part));
      }

      return actionsEl;
    }

    /* Install-from-tray picker (a <select> + button) */
    function buildInstallPicker(typeKey, trayItems) {
      var el = sdk.ui.el;
      var sel = el('select', {
        style: {
          padding: '3px 6px', borderRadius: '4px', fontSize: '11px',
          background: 'var(--c-bg-raised,#1a2332)', color: 'var(--c-text-1,#e8ecf8)',
          border: '1px solid var(--c-border,#1e2a3a)'
        }
      }, trayItems.map(function (t, idx) {
        return el('option', { value: String(idx) }, [t.part.id]);
      }));
      var btn = el('button', {
        className: 'bft-btn',
        onClick: function () {
          var trayIdx = findTrayIndex(typeKey, sel.value);
          if (trayIdx < 0) { sdk.ui.toast('Part not found in tray', 'warn'); return; }
          var tx = installPart(trayIdx, _selectedSlot, typeKey);
          if (tx) { persistAndTx(tx); }
        }
      }, ['Install']);
      return el('div', { style: { display: 'flex', gap: '4px', alignItems: 'center' } }, [sel, btn]);
    }

    /* Find first tray index for a given type, optionally matching serial */
    function findTrayIndex(typeKey, serialHint) {
      for (var i = 0; i < _state.tray.length; i++) {
        var t = _state.tray[i];
        if (t.partType !== typeKey) { continue; }
        if (serialHint != null && t.part.id !== serialHint) { continue; }
        return i;
      }
      return -1;
    }

    /* Inline replace form */
    function buildReplaceBtn(typeKey, existingPart) {
      var el = sdk.ui.el;
      var container = el('div', {}, []);
      var btn = el('button', { className: 'bft-btn' }, [existingPart ? 'Replace' : 'Install new']);
      var formVisible = false;
      var formEl = null;

      btn.addEventListener('click', function () {
        formVisible = !formVisible;
        if (formVisible) {
          formEl = buildReplaceForm(typeKey, existingPart, function () {
            formVisible = false;
            if (formEl && formEl.parentNode) { formEl.parentNode.removeChild(formEl); }
            formEl = null;
          });
          container.appendChild(formEl);
        } else {
          if (formEl && formEl.parentNode) { formEl.parentNode.removeChild(formEl); }
          formEl = null;
        }
      });
      container.appendChild(btn);
      return container;
    }

    function buildReplaceForm(typeKey, existingPart, onClose) {
      var el = sdk.ui.el;
      var input = el('input', { placeholder: 'New serial…', style: { flex: '1' } }, []);
      var confirmBtn = el('button', { className: 'bft-btn' }, ['Confirm']);
      var cancelBtn  = el('button', { className: 'bft-btn' }, ['Cancel']);

      confirmBtn.addEventListener('click', function () {
        var serial = input.value.trim();
        if (!serial) { sdk.ui.toast('Enter a serial number', 'warn'); return; }
        var tx = replacePart(_selectedSlot, typeKey, serial);
        if (tx) { persistAndTx(tx); }
        onClose();
      });
      cancelBtn.addEventListener('click', onClose);

      return el('div', { className: 'bft-inline-form' }, [
        el('label', {}, ['New serial for ' + (PART_TYPES[typeKey] && PART_TYPES[typeKey].label || typeKey)]),
        input,
        el('div', { className: 'bft-form-row' }, [confirmBtn, cancelBtn])
      ]);
    }

    /* Inline repair note form */
    function buildRepairNoteBtn(typeKey, part) {
      var el = sdk.ui.el;
      var container = el('div', {}, []);
      var btn = el('button', { className: 'bft-btn' }, ['Add note']);
      var formVisible = false;
      var formEl = null;

      btn.addEventListener('click', function () {
        formVisible = !formVisible;
        if (formVisible) {
          var ta = el('textarea', { placeholder: 'Repair note…', rows: '2', style: { width: '100%', resize: 'vertical' } }, []);
          var saveBtn   = el('button', { className: 'bft-btn' }, ['Save']);
          var cancelBtn = el('button', { className: 'bft-btn' }, ['Cancel']);

          saveBtn.addEventListener('click', function () {
            var note = ta.value.trim();
            if (!note) { sdk.ui.toast('Note is empty', 'warn'); return; }
            var tx = addRepairNote(_selectedSlot, typeKey, note);
            if (tx) {
              sdk.store.tx.add(tx).catch(function (e) {
                sdk.ui.toast('Store error: ' + e.message, 'alarm');
              });
            }
            formVisible = false;
            if (formEl && formEl.parentNode) { formEl.parentNode.removeChild(formEl); }
            sdk.ui.toast('Note saved', 'good');
          });
          cancelBtn.addEventListener('click', function () {
            formVisible = false;
            if (formEl && formEl.parentNode) { formEl.parentNode.removeChild(formEl); }
          });

          formEl = el('div', { className: 'bft-inline-form' }, [
            el('label', {}, ['Repair note for ' + part.id]),
            ta,
            el('div', { className: 'bft-form-row' }, [saveBtn, cancelBtn])
          ]);
          container.appendChild(formEl);
        } else {
          if (formEl && formEl.parentNode) { formEl.parentNode.removeChild(formEl); }
          formEl = null;
        }
      });

      container.appendChild(btn);
      return container;
    }

    /* ======================================================================
     * §F  TRAY PANEL
     * ====================================================================== */

    function renderTrayTab() {
      var el = sdk.ui.el;
      var content = document.getElementById('bft-tab-content');
      while (content.firstChild) { content.removeChild(content.firstChild); }

      var tray = (_state && _state.tray) || [];
      if (tray.length === 0) {
        content.appendChild(el('div', { className: 'bft-empty' }, [
          el('p', {}, ['Tray is empty.']),
          el('p', { style: { fontSize: '11px', color: 'var(--c-text-3,#4a5568)' } },
            ['Remove parts from slots to store them here.'])
        ]));
        return;
      }

      var header = el('div', { style: { fontSize: '11px', color: 'var(--c-text-2,#8899aa)', marginBottom: '8px' } },
        [tray.length + ' item(s) in tray. Drag onto a slot or use Install.']);
      content.appendChild(header);

      tray.forEach(function (item, idx) {
        var now    = Date.now();
        var hours  = inUseHours(item.part, now);
        var pct    = wearPct(item.part, item.partType, now);
        var bucket = colorBucket(pct);
        var badgeColor = bucket === 'good'  ? 'var(--c-good,#34d399)' :
                         bucket === 'warn'  ? 'var(--c-warn,#fbbf24)' :
                                              'var(--c-alarm,#f87171)';

        var abbr  = item.partType === 'upper' ? 'UF' :
                    item.partType === 'lower' ? 'LF' : 'BG';

        var installBtn = el('button', {
          className: 'bft-btn',
          title: _selectedSlot ? ('Install to slot ' + _selectedSlot) : 'Select a slot first',
          onClick: function () {
            if (!_selectedSlot) { sdk.ui.toast('Select a slot first', 'warn'); return; }
            var slotData = _state.slots[_selectedSlot] || {};
            if (slotData[item.partType]) { sdk.ui.toast('Slot ' + _selectedSlot + ' already has a ' + item.partType, 'warn'); return; }
            var trayIdx = idx; // capture at render time; may be stale if tray mutated
            // Find fresh index by serial
            trayIdx = _state.tray.findIndex(function (t) { return t.partType === item.partType && t.part.id === item.part.id; });
            if (trayIdx < 0) { sdk.ui.toast('Part no longer in tray', 'warn'); return; }
            var tx;
            if (item.partType === 'bag') {
              tx = bagOn(trayIdx, _selectedSlot);
            } else if (item.partType === 'upper') {
              tx = attachSection(trayIdx, _selectedSlot, 'upper');
            } else if (item.partType === 'lower') {
              tx = attachSection(trayIdx, _selectedSlot, 'lower');
            } else {
              tx = installPart(trayIdx, _selectedSlot, item.partType);
            }
            if (tx) { persistAndTx(tx); }
          }
        }, ['Install']);

        var trayRow = el('div', { className: 'bft-tray-item' }, [
          el('div', { className: 'bft-type-badge', style: { color: badgeColor } }, [abbr]),
          el('div', { className: 'bft-tray-meta' }, [
            el('div', { className: 'bft-tray-serial' }, [item.part.id]),
            el('div', { className: 'bft-tray-hours' }, [hours.toFixed(1) + ' h / ' + (PART_TYPES[item.partType] && PART_TYPES[item.partType].maxHours || '?') + ' h']),
          ]),
          el('div', { className: 'bft-tray-install' }, [installBtn])
        ]);

        // ── Drag from tray onto map slot ────────────────────────────────────
        sdk.ui.makeDraggable(trayRow, {
          onStart: function () {
            _ghostEl = el('div', { className: 'bft-ghost' }, [abbr + ' ' + item.part.id]);
            document.body.appendChild(_ghostEl);
          },
          onMove: function (dx, dy, ev) {
            if (!_ghostEl) { return; }
            _ghostEl.style.left = ev.clientX + 'px';
            _ghostEl.style.top  = ev.clientY + 'px';
            // Highlight drop target
            var overEl = document.elementFromPoint(ev.clientX, ev.clientY);
            // Remove previous highlight
            document.querySelectorAll('.bft-slot.drop-target').forEach(function (n) {
              n.classList.remove('drop-target');
            });
            if (overEl && overEl.classList.contains('bft-slot')) {
              overEl.classList.add('drop-target');
            }
          },
          onDrop: function (ev) {
            if (_ghostEl && _ghostEl.parentNode) { _ghostEl.parentNode.removeChild(_ghostEl); }
            _ghostEl = null;
            document.querySelectorAll('.bft-slot.drop-target').forEach(function (n) {
              n.classList.remove('drop-target');
            });
            // Hit-test: find slot node under pointer
            var overEl = document.elementFromPoint(ev.clientX, ev.clientY);
            var dropSlot = null;
            if (overEl && overEl.classList.contains('bft-slot')) {
              // Find the slotKey from _slotNodes
              Object.keys(_slotNodes).forEach(function (sk) {
                if (_slotNodes[sk] === overEl) { dropSlot = sk; }
              });
            }
            if (!dropSlot) { return; }
            var slotData = _state.slots[dropSlot] || {};
            if (slotData[item.partType]) {
              sdk.ui.toast('Slot ' + dropSlot + ' already has a ' + item.partType, 'warn');
              return;
            }
            var trayIdx = _state.tray.findIndex(function (t) {
              return t.partType === item.partType && t.part.id === item.part.id;
            });
            if (trayIdx < 0) { sdk.ui.toast('Part no longer in tray', 'warn'); return; }
            var tx;
            if (item.partType === 'bag') {
              tx = bagOn(trayIdx, dropSlot);
            } else if (item.partType === 'upper') {
              tx = attachSection(trayIdx, dropSlot, 'upper');
            } else if (item.partType === 'lower') {
              tx = attachSection(trayIdx, dropSlot, 'lower');
            } else {
              tx = installPart(trayIdx, dropSlot, item.partType);
            }
            if (tx) {
              _selectedSlot = dropSlot;
              persistAndTx(tx);
            }
          }
        });

        content.appendChild(trayRow);
      });
    }

    /* ======================================================================
     * §G  WORKLIST PANEL
     * ====================================================================== */

    function renderWorklistTab() {
      var el = sdk.ui.el;
      var content = document.getElementById('bft-tab-content');
      while (content.firstChild) { content.removeChild(content.firstChild); }

      var now = Date.now();
      var rows = [];

      for (var i = 1; i <= SLOTS; i++) {
        var sk = String(i);
        var slotData = _state && _state.slots[sk];
        if (!slotData) { continue; }
        PART_KEYS.forEach(function (typeKey) {
          var part = slotData[typeKey];
          if (!part) { return; }
          var pct = wearPct(part, typeKey, now);
          if (pct >= WARN_PCT) {
            rows.push({ slotKey: sk, typeKey: typeKey, part: part, pct: pct, hours: inUseHours(part, now) });
          }
        });
      }

      rows.sort(function (a, b) { return b.pct - a.pct; });

      if (rows.length === 0) {
        content.appendChild(el('div', { className: 'bft-empty' }, [
          el('p', {}, ['All parts below ' + WARN_PCT + '% — no action needed.'])
        ]));
        return;
      }

      var hdr = el('div', { style: { fontSize: '11px', color: 'var(--c-text-2,#8899aa)', marginBottom: '8px' } },
        [rows.length + ' part(s) at or above ' + WARN_PCT + '%']);
      content.appendChild(hdr);

      rows.forEach(function (row) {
        var bucket = colorBucket(row.pct);
        var barColor = bucket === 'good'  ? 'var(--c-good,#34d399)' :
                       bucket === 'warn'  ? 'var(--c-warn,#fbbf24)' :
                                            'var(--c-alarm,#f87171)';
        var typeAbbr = row.typeKey === 'upper' ? 'UF' :
                       row.typeKey === 'lower' ? 'LF' : 'BG';
        var maxH  = (PART_TYPES[row.typeKey] && PART_TYPES[row.typeKey].maxHours) || 1000;

        var barFill = el('div', { style: { height: '4px', borderRadius: '2px',
          width: Math.min(100, row.pct).toFixed(1) + '%', background: barColor } }, []);
        var bar = el('div', { className: 'bft-wl-bar', style: {
          height: '4px', borderRadius: '2px', background: 'var(--c-bg-raised,#1a2332)', overflow: 'hidden' } }, [barFill]);

        var wlRow = el('div', { className: 'bft-wl-row',
          onClick: function () {
            _selectedSlot = row.slotKey;
            updateMapColors();
            _switchTab('slot');
          }
        }, [
          el('div', { className: 'bft-wl-slot' }, ['#' + row.slotKey]),
          el('div', { className: 'bft-wl-type' }, [typeAbbr]),
          el('div', { className: 'bft-wl-serial' }, [row.part.id]),
          el('div', { className: 'bft-wl-hours' }, [row.hours.toFixed(0) + 'h']),
          el('div', { className: 'bft-wl-pct', style: { color: barColor } },
            [row.pct.toFixed(1) + '%']),
          bar,
        ]);
        content.appendChild(wlRow);
      });
    }

    /* ======================================================================
     * §H  HISTORY PANEL
     * ====================================================================== */

    var _histFilter = '';   // current filter string (slot number or serial)

    function renderHistoryTab() {
      var el = sdk.ui.el;
      var content = document.getElementById('bft-tab-content');
      while (content.firstChild) { content.removeChild(content.firstChild); }

      var filterInput = el('input', {
        placeholder: 'Filter by slot # or serial…',
        value: _histFilter,
      }, []);
      filterInput.addEventListener('input', function () {
        _histFilter = filterInput.value.trim();
      });

      var loadBtn = el('button', { className: 'bft-btn' }, ['Load']);
      loadBtn.addEventListener('click', function () {
        _histFilter = filterInput.value.trim();
        loadHistory(content, filterInput);
      });

      var filterRow = el('div', { className: 'bft-hist-filter' }, [filterInput, loadBtn]);
      content.appendChild(filterRow);

      // Auto-load for selected slot on first render
      if (_selectedSlot && !_histFilter) {
        _histFilter = _selectedSlot;
        filterInput.value = _histFilter;
      }

      loadHistory(content, filterInput);
    }

    function loadHistory(container, filterInputEl) {
      // Remove old rows (keep filter row)
      var children = Array.prototype.slice.call(container.childNodes);
      for (var ci = 1; ci < children.length; ci++) {
        container.removeChild(children[ci]);
      }

      var filter = _histFilter;
      var query = { ns: 'bagfilter', limit: 200 };
      if (filter) {
        // Numeric → slot, else → partId
        if (/^\d+$/.test(filter)) {
          query.slot = filter;
        } else {
          query.partId = filter;
        }
      }

      sdk.store.tx.query(query).then(function (rows) {
        if (!rows || rows.length === 0) {
          container.appendChild(sdk.ui.el('div', { style: {
            color: 'var(--c-text-2,#8899aa)', fontSize: '12px', padding: '8px 0'
          }}, ['No history found.']));
          return;
        }
        rows.forEach(function (row) {
          var ts    = row.ts ? new Date(row.ts).toLocaleString() : '—';
          var from  = row.fromSlot || '—';
          var to    = row.toSlot   || '—';
          var bdrColor = row.action === 'alarm' ? 'var(--c-alarm,#f87171)' :
                         row.action === 'repair-note' ? 'var(--c-warn,#fbbf24)' :
                         'var(--c-accent,#38bdf8)';
          var histRow = sdk.ui.el('div', { className: 'bft-hist-row', style: { borderLeftColor: bdrColor } }, [
            sdk.ui.el('div', {}, [
              sdk.ui.el('span', { className: 'bft-hist-action' }, [row.action || '?']),
              '  ',
              sdk.ui.el('span', {}, [(row.partType || '') + ' ' + (row.partId || '')]),
              '  ',
              sdk.ui.el('span', { style: { color: 'var(--c-text-3,#4a5568)' } }, [from + ' → ' + to]),
            ]),
            sdk.ui.el('div', { className: 'bft-hist-ts' }, [ts + (row.user ? '  by ' + row.user : '')]),
            row.note ? sdk.ui.el('div', { className: 'bft-hist-note' }, [row.note]) : null,
          ]);
          container.appendChild(histRow);
        });
      }).catch(function (e) {
        sdk.ui.toast('History load error: ' + e.message, 'alarm');
      });
    }

    /* ======================================================================
     * §I  TICK LOOP & RESIZE OBSERVER
     * ====================================================================== */

    function tick() {
      if (!_state) { return; }
      updateMapColors();
      // Re-render active tab if it shows live counters
      if (_activeTab === 'slot') { renderSlotTab(); }
      if (_activeTab === 'worklist') { renderWorklistTab(); }
    }

    function startTick() {
      if (_bft_tickInterval) { clearInterval(_bft_tickInterval); }
      _bft_tickInterval = setInterval(tick, 30000);
    }

    function startResizeObserver() {
      if (typeof ResizeObserver === 'undefined') { return; }
      _bft_resizeObs = new ResizeObserver(function () {
        var newSize = computeMapSize();
        if (Math.abs(newSize - _mapSize) > 4) {
          _mapSize  = newSize;
          _nodeSize = Math.max(10, Math.round(_mapSize / 28));
          buildSlotNodes();
          updateMapColors();
        }
      });
      _bft_resizeObs.observe(root);
    }

    /* ======================================================================
     * §J-helper  Persist state + write a transaction
     * ====================================================================== */

    function persistAndTx(tx) {
      sdk.store.kv.put('bagfilter', 'state', _state).catch(function (e) {
        sdk.ui.toast('State save error: ' + e.message, 'alarm');
      });
      sdk.store.tx.add(tx).catch(function (e) {
        sdk.ui.toast('Tx write error: ' + e.message, 'alarm');
      });
      updateMapColors();
      renderActiveTab();
    }

    function renderActiveTab() {
      if (_activeTab === 'slot')     { renderSlotTab(); }
      if (_activeTab === 'tray')     { renderTrayTab(); }
      if (_activeTab === 'worklist') { renderWorklistTab(); }
      if (_activeTab === 'history')  { renderHistoryTab(); }
    }

    /* ======================================================================
     * §J  BOOTSTRAP
     * ====================================================================== */

    // 1. Inject styles
    injectStyles();

    // 2. Build scaffold (sets _mapWrapper, _mapContainer, _panelRoot, _switchTab)
    buildScaffold();

    // 3. Load state from kv store
    sdk.store.kv.get('bagfilter', 'state').then(function (saved) {

      if (saved) {
        _state = saved;
        // Init map now that we have data
        initMap();
        startTick();
        startResizeObserver();
        renderActiveTab();
        sdk.ui.toast('Bag Filter Tracker loaded', 'good');
      } else {
        // First run — show seed overlay
        showFirstRunOverlay();
      }

    }).catch(function (e) {
      sdk.ui.toast('Failed to load state: ' + e.message, 'alarm');
      sdk.log('State load error:', e);
      // Render empty map so module is not blank
      _state = { slots: {}, tray: [] };
      initMap();
      startResizeObserver();
      renderActiveTab();
    });

    function showFirstRunOverlay() {
      var el = sdk.ui.el;
      var overlay = el('div', { className: 'bft-firstrun' }, [
        el('div', { className: 'bft-firstrun-card' }, [
          el('h3', {}, ['No data yet']),
          el('p', {}, [
            'This is the first run. Seed demo data to populate all 240 slots with ' +
            'randomised part serials and wear hours, or start adding parts manually.'
          ]),
          el('button', {
            className: 'bft-seed-btn',
            onClick: function () {
              seedDemoData(overlay);
            }
          }, ['Seed demo data']),
        ])
      ]);
      root.appendChild(overlay);

      // Still init the empty map behind the overlay
      _state = { slots: {}, tray: [] };
      initMap();
      startResizeObserver();
      renderActiveTab();
    }

    function seedDemoData(overlay) {
      _state = buildSeedState();
      // Write seed transaction
      var seedTx = {
        ns: 'bagfilter', action: 'seed', user: 'operator',
        note: 'Demo data seeded — ' + SLOTS + ' slots'
      };
      sdk.store.tx.add(seedTx).catch(function (e) {
        sdk.ui.toast('Seed tx error: ' + e.message, 'alarm');
      });
      sdk.store.kv.put('bagfilter', 'state', _state).then(function () {
        sdk.ui.toast('Demo data seeded (' + SLOTS + ' slots)', 'good');
        if (overlay && overlay.parentNode) { overlay.parentNode.removeChild(overlay); }
        updateMapColors();
        startTick();
        renderActiveTab();
      }).catch(function (e) {
        sdk.ui.toast('Seed save error: ' + e.message, 'alarm');
      });
    }

  }, // end create()

  /* ── destroy ─────────────────────────────────────────────────────────────── */
  destroy: function () {
    'use strict';
    if (_bft_tickInterval) {
      clearInterval(_bft_tickInterval);
      _bft_tickInterval = null;
    }
    if (_bft_resizeObs) {
      _bft_resizeObs.disconnect();
      _bft_resizeObs = null;
    }
  },

});
