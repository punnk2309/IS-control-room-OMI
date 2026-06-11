/* ============================================================================
 * Digital twin — spatial hierarchy (config/twin/twin.layout.config.js)
 * ----------------------------------------------------------------------------
 * The physical model of the site:  Factory -> Zones -> Floors -> Subzones
 * (optionally with their own floors) -> Machines.  Pure data; the renderer
 * (src/twin/*) never changes for layout work.
 *
 * Coordinates are hierarchical: every rect {x,y,w,h} is in world units
 * RELATIVE TO ITS PARENT, so moving a zone moves everything inside it.
 *
 * Zone shape:
 *   { id, label, rect, hint?,                       // hint shows in panel
 *     status: { datapoint },                        // drives the zone tint
 *                                                   //   via the 'zone-energy'
 *                                                   //   state group
 *     floors: [ { id, label, subzones: [...] } ]    // multi-floor zone
 *     subzones: [...] }                             // OR single implicit floor
 *
 * Subzone shape:
 *   { id, label, rect,
 *     floors: [ { id, label, machines: [...] } ]    // subzone w/ own floors
 *     machines: [...] }                             // OR flat
 *
 * Machine shape (machines never have floors — always flat leaf nodes):
 *   { ref: 'M-001' }                // fleet machine: label/state/load come
 *                                   //   from config/machines.config.js
 *   { id, label, kind?, shape?,     // twin-only equipment; shape:
 *     rect?,                        //   'rect' (default) | 'round' | 'circle'
 *     bindings: { value: { datapoint, unit },       // badge value
 *                 state: { datapoint } } }          // optional state color
 *
 * `rect` on machines is optional — omitted machines auto-flow into a grid
 * inside their subzone (see autoLayout in twin.config.js). Provide a rect
 * only when exact placement matters.
 *
 * Zone ids are shared with config/machines.config.js and navigation params
 * (e.g. #/machines?zone=welding) — keep them stable once deployed.
 * ========================================================================== */
SFP.config.define('twin.layout', {

  /* Slightly wider/taller than the zone footprint so off-site external
   * nodes (city grid, dispatch — see twin.connections.config.js) sit
   * inside the zoom-to-fit bounds. */
  world: { width: 2240, height: 1340 },

  zones: [

    /* ── Assembly Line A — two floors ─────────────────────────────────── */
    { id: 'assembly-a', label: 'Assembly Line A',
      rect: { x: 40, y: 40, w: 600, h: 340 },
      status: { datapoint: 'zone.assembly-a.energy' },
      hint: 'Highest consumer on site. Stagger conveyor start-ups to cut the morning peak by ~8%.',
      floors: [
        { id: 'f1', label: 'Floor 1 — Production',
          subzones: [
            { id: 'line-1', label: 'Line 1', rect: { x: 16, y: 44, w: 276, h: 280 },
              machines: [{ ref: 'M-001' }, { ref: 'M-002' }, { ref: 'M-003' }, { ref: 'M-004' }] },
            { id: 'line-2', label: 'Line 2', rect: { x: 308, y: 44, w: 276, h: 280 },
              machines: [{ ref: 'M-005' }, { ref: 'M-006' }, { ref: 'M-007' }, { ref: 'M-008' }] },
          ] },
        { id: 'f2', label: 'Floor 2 — Mezzanine',
          subzones: [
            { id: 'mezzanine', label: 'Services Mezzanine', rect: { x: 16, y: 44, w: 568, h: 280 },
              machines: [
                { id: 'AHU-A1', label: 'Air Handler A1', kind: 'AHU', shape: 'round',
                  bindings: { value: { datapoint: 'twin.eq.ahu-a1.flow', unit: 'm³/h' } } },
                { id: 'DB-A1', label: 'Dist. Board A1', kind: 'Switchboard',
                  bindings: { value: { datapoint: 'twin.eq.db-a1.load', unit: '%' } } },
              ] },
          ] },
      ] },

    /* ── Welding Station ──────────────────────────────────────────────── */
    { id: 'welding', label: 'Welding Station',
      rect: { x: 700, y: 40, w: 400, h: 340 },
      status: { datapoint: 'zone.welding.energy' },
      hint: 'Reduce energy by ~12% through load balancing and weld scheduling optimization.',
      subzones: [
        { id: 'weld-cells', label: 'Robot Weld Cells', rect: { x: 16, y: 44, w: 368, h: 130 },
          machines: [{ ref: 'M-017' }, { ref: 'M-018' }, { ref: 'M-019' }, { ref: 'M-020' }] },
        { id: 'finishing', label: 'Spot / Seam / Laser', rect: { x: 16, y: 190, w: 368, h: 130 },
          machines: [{ ref: 'M-021' }, { ref: 'M-022' }, { ref: 'M-023' }, { ref: 'M-024' }] },
      ] },

    /* ── Paint Shop — two floors; the Curing Tower subzone has its own
     *    three levels (independent of the zone's floors) ─────────────── */
    { id: 'paint', label: 'Paint Shop',
      rect: { x: 1160, y: 40, w: 380, h: 340 },
      status: { datapoint: 'zone.paint.energy' },
      hint: 'Curing ovens dominate. Batch parts to keep ovens at capacity instead of reheating.',
      floors: [
        { id: 'f1', label: 'Floor 1 — Booths',
          subzones: [
            { id: 'booths', label: 'Paint Booths', rect: { x: 16, y: 44, w: 200, h: 280 },
              machines: [{ ref: 'M-025' }, { ref: 'M-026' }, { ref: 'M-027' }, { ref: 'M-028' }] },
            { id: 'curing-tower', label: 'Curing Tower', rect: { x: 232, y: 44, w: 132, h: 280 },
              floors: [
                { id: 'l1', label: 'Level 1 — Infeed',  machines: [{ ref: 'M-029' }] },
                { id: 'l2', label: 'Level 2 — Dryer',   machines: [{ ref: 'M-030' }] },
                { id: 'l3', label: 'Level 3 — Exhaust', machines: [
                  { id: 'EF-P1', label: 'Exhaust Fan P1', kind: 'Fan', shape: 'circle',
                    bindings: { value: { datapoint: 'twin.eq.ef-p1.flow', unit: 'm³/min' } } },
                ] },
              ] },
          ] },
        { id: 'f2', label: 'Floor 2 — Air Handling',
          subzones: [
            { id: 'air-handling', label: 'Air Handling Plant', rect: { x: 16, y: 44, w: 348, h: 280 },
              machines: [
                { id: 'AHU-P1', label: 'Air Handler P1', kind: 'AHU', shape: 'round',
                  bindings: { value: { datapoint: 'twin.eq.ahu-p1.flow', unit: 'm³/h' } } },
                { id: 'SCRUB-P1', label: 'Scrubber P1', kind: 'Scrubber',
                  bindings: { value: { datapoint: 'twin.eq.scrub-p1.dp', unit: 'Pa' } } },
              ] },
          ] },
      ] },

    /* ── Solar Array + grid intake (roof) ─────────────────────────────── */
    { id: 'utilities-roof', label: 'Solar Array (Roof)',
      rect: { x: 1600, y: 40, w: 360, h: 340 },
      status: { datapoint: 'energy.solar' },
      hint: 'Roof-mounted PV. Clean panels quarterly; soiling losses average 4–7%.',
      subzones: [
        { id: 'pv-field', label: 'PV Field', rect: { x: 16, y: 44, w: 328, h: 130 },
          machines: [
            { id: 'INV-1', label: 'Inverter 1', kind: 'Inverter',
              bindings: { value: { datapoint: 'twin.eq.inv1.kw', unit: 'kW' } } },
            { id: 'INV-2', label: 'Inverter 2', kind: 'Inverter',
              bindings: { value: { datapoint: 'twin.eq.inv2.kw', unit: 'kW' } } },
          ] },
        { id: 'grid-intake', label: 'Grid Intake', rect: { x: 16, y: 190, w: 328, h: 134 },
          machines: [
            { id: 'TX-1', label: 'Transformer TX-1', kind: 'Transformer',
              rect: { x: 16, y: 42, w: 130, h: 64 },
              bindings: { value: { datapoint: 'energy.consumption', unit: 'kW' } } },
            { id: 'BESS-1', label: 'Battery BESS-1', kind: 'Battery',
              rect: { x: 170, y: 42, w: 130, h: 64 },
              bindings: { value: { datapoint: 'energy.batteryLevel', unit: '%' } } },
          ] },
      ] },

    /* ── Assembly Line B ──────────────────────────────────────────────── */
    { id: 'assembly-b', label: 'Assembly Line B',
      rect: { x: 40, y: 440, w: 600, h: 300 },
      status: { datapoint: 'zone.assembly-b.energy' },
      hint: 'Press hydraulics idle at high pressure. Enable standby mode between cycles.',
      subzones: [
        { id: 'line-3', label: 'Line 3', rect: { x: 16, y: 44, w: 276, h: 240 },
          machines: [{ ref: 'M-009' }, { ref: 'M-010' }, { ref: 'M-011' }, { ref: 'M-012' }] },
        { id: 'line-4', label: 'Line 4', rect: { x: 308, y: 44, w: 276, h: 240 },
          machines: [{ ref: 'M-013' }, { ref: 'M-014' }, { ref: 'M-015' }, { ref: 'M-016' }] },
      ] },

    /* ── Quality Control ──────────────────────────────────────────────── */
    { id: 'quality', label: 'Quality Control',
      rect: { x: 700, y: 440, w: 400, h: 300 },
      status: { datapoint: 'zone.quality.energy' },
      hint: 'Climate-controlled metrology room. Verify door interlocks to avoid HVAC waste.',
      subzones: [
        { id: 'metrology', label: 'Metrology', rect: { x: 16, y: 44, w: 368, h: 116 },
          machines: [{ ref: 'M-031' }, { ref: 'M-032' }, { ref: 'M-035' }] },
        { id: 'test-lab', label: 'Test Lab', rect: { x: 16, y: 174, w: 368, h: 110 },
          machines: [{ ref: 'M-033' }, { ref: 'M-034' }] },
      ] },

    /* ── Warehouse — two floors with a vertical conveyor link ─────────── */
    { id: 'warehouse', label: 'Warehouse',
      rect: { x: 1160, y: 440, w: 800, h: 300 },
      status: { datapoint: 'zone.warehouse.energy' },
      hint: 'LED retrofit complete. Next: motion-zoned lighting in low-traffic aisles.',
      floors: [
        { id: 'f1', label: 'Floor 1 — Receiving',
          subzones: [
            { id: 'receiving', label: 'Receiving', rect: { x: 16, y: 44, w: 300, h: 240 },
              machines: [{ ref: 'M-036' }, { ref: 'M-037' }, { ref: 'M-038' }] },
            { id: 'racking', label: 'Racking & Wrap', rect: { x: 340, y: 44, w: 444, h: 240 },
              machines: [{ ref: 'M-040' }, { ref: 'M-041' }] },
          ] },
        { id: 'f2', label: 'Floor 2 — Mezzanine',
          subzones: [
            { id: 'mezz-conveyor', label: 'Mezzanine Conveyor', rect: { x: 16, y: 44, w: 768, h: 240 },
              machines: [
                { ref: 'M-039' },
                { id: 'LIFT-W1', label: 'Vertical Lift W1', kind: 'Lift', shape: 'round',
                  bindings: { value: { datapoint: 'twin.eq.lift-w1.cycles', unit: 'cyc/h' } } },
              ] },
          ] },
      ] },

    /* ── Maintenance Bay ──────────────────────────────────────────────── */
    { id: 'maintenance-bay', label: 'Maintenance Bay',
      rect: { x: 40, y: 840, w: 440, h: 320 },
      status: { datapoint: 'zone.maintenance-bay.energy' },
      hint: 'Compressed-air leak survey due — last audit found 9% line loss.',
      subzones: [
        { id: 'workshop', label: 'Workshop', rect: { x: 16, y: 44, w: 408, h: 126 },
          machines: [{ ref: 'M-042' }, { ref: 'M-043' }] },
        { id: 'crane-bay', label: 'Crane Bay', rect: { x: 16, y: 184, w: 408, h: 120 },
          machines: [{ ref: 'M-044' }, { ref: 'M-045' }] },
      ] },

    /* ── Shipping Dock ────────────────────────────────────────────────── */
    { id: 'shipping', label: 'Shipping Dock',
      rect: { x: 540, y: 840, w: 560, h: 320 },
      status: { datapoint: 'zone.shipping.energy' },
      hint: 'Dock door seals degraded on doors 3–4; heat loss during winter shifts.',
      subzones: [
        { id: 'docks', label: 'Dock Doors', rect: { x: 16, y: 44, w: 260, h: 260 },
          machines: [{ ref: 'M-046' }, { ref: 'M-047' }] },
        { id: 'pack-line', label: 'Pack Line', rect: { x: 300, y: 44, w: 244, h: 260 },
          machines: [{ ref: 'M-048' }, { ref: 'M-049' }, { ref: 'M-050' }] },
      ] },

    /* ── Office & Utilities ───────────────────────────────────────────── */
    { id: 'office', label: 'Office & Utilities',
      rect: { x: 1160, y: 840, w: 800, h: 320 },
      status: { datapoint: 'zone.office.energy' },
      hint: 'Schedule HVAC setback 19:00–05:00; weekend occupancy is near zero.',
      subzones: [
        { id: 'utility-room', label: 'Utility Room', rect: { x: 16, y: 44, w: 320, h: 260 },
          machines: [
            { ref: 'M-053' }, { ref: 'M-054' }, { ref: 'M-055' },
            { id: 'BLR-U1', label: 'Boiler BLR-U1', kind: 'Boiler',
              bindings: { value: { datapoint: 'twin.eq.blr-u1.steam', unit: 't/h' } } },
          ] },
        { id: 'hvac-plant', label: 'HVAC Plant', rect: { x: 360, y: 44, w: 220, h: 260 },
          machines: [{ ref: 'M-051' }, { ref: 'M-052' }] },
        { id: 'open-office', label: 'Open Office', rect: { x: 604, y: 44, w: 180, h: 260 },
          machines: [] },
      ] },
  ],
});
