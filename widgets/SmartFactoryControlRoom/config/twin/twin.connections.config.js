/* ============================================================================
 * Digital twin — connection overlay (config/twin/twin.connections.config.js)
 * ----------------------------------------------------------------------------
 * The Sankey-like live flow layer drawn on top of the spatial hierarchy.
 * A connection can join ANY two elements: zone↔zone, subzone↔subzone,
 * machine↔machine, or any mix — including across floors.
 *
 * Endpoint refs:
 *   'zone:<zoneId>'                          e.g. 'zone:welding'
 *   'subzone:<zoneId>/<subzoneId>'           e.g. 'subzone:paint/booths'
 *   'machine:<machineId>'                    e.g. 'machine:M-029'
 *
 * Connection shape:
 *   { id, label, utility,                  // utility id from twin.config.js
 *     from: { ref, anchor?: { side: 'left|right|top|bottom', t?: 0..1 } },
 *     to:   { ref, anchor?: ... },
 *     binding: 'datapoint.id',             // live value (see datapoints below)
 *     unit, flowRange: [min, max],         // maps value -> line thickness
 *     direction: 'forward'|'reverse'|'both'|'none',
 *     rules: [ { op, value, style?: 'inactive', color?: '<theme token>',
 *                badge?: 'text' } ],       // first match wins (top to bottom)
 *     badges: [ { datapoint, label } ],    // extra diagnostics shown at LOD 3
 *     route: { waypoints: [[x,y], ...] },  // optional world-coord path hints
 *   }
 *
 * Behaviour at low zoom: when both endpoints collapse into the same pair of
 * visible ancestors (e.g. two machine links between the same two zones),
 * the renderer aggregates them into one line with a summed value — nothing
 * to configure here.
 *
 * Cross-floor connections need no special flag: if an endpoint sits on a
 * floor that is not currently active, the renderer shows a riser chip
 * ("⇡ Floor 2") at that end automatically.
 * ========================================================================== */
SFP.config.define('twin.connections', {

  /* ── External nodes — off-site endpoints drawn as dashed ring nodes.
   *    Flows that enter or leave the factory should start/end on one of
   *    these instead of stopping mid-air. Reference as 'external:<id>'.
   *    x/y are world coordinates (the world is sized to include them). ── */
  externals: [
    { id: 'city-grid', label: 'City Grid', x: 2120, y: 300 },
    { id: 'dispatch',  label: 'Dispatch',  x: 820,  y: 1270 },
  ],

  /* ── Datapoints used only by the twin (flows + twin-only equipment).
   *    Merged into the data hub alongside config/tags.config.js. Each entry
   *    follows the standard datapoint shape: `source` = real live binding,
   *    `sim` = generated data. A datapoint WITHOUT `source` is
   *    "simulation-only": in Live mode it renders as a no-data state and is
   *    counted as unwired by the implementation-coverage tracker. ─────────── */
  datapoints: {

    /* Product flow (units/h). Sim-only for now — wire each one by adding a
     * `source` line, exactly like twin.flow.steam.paint below. */
    'twin.flow.prod.aw':     { label: 'Assembly A → Welding',  unit: 'units/h', decimals: 0,
                               sim: { type: 'wave', min: 80, max: 145, period: '4h', jitter: 6 } },
    'twin.flow.prod.bw':     { label: 'Assembly B → Welding',  unit: 'units/h', decimals: 0,
                               sim: { type: 'wave', min: 60, max: 120, period: '5h', jitter: 6 } },
    'twin.flow.prod.wp':     { label: 'Welding → Paint',       unit: 'units/h', decimals: 0,
                               sim: { type: 'wave', min: 120, max: 240, period: '4h', jitter: 8 } },
    'twin.flow.prod.pq':     { label: 'Paint → Quality',       unit: 'units/h', decimals: 0,
                               sim: { type: 'wave', min: 110, max: 230, period: '4h', jitter: 8 } },
    'twin.flow.prod.qw':     { label: 'Quality → Warehouse',   unit: 'units/h', decimals: 0,
                               sim: { type: 'wave', min: 100, max: 220, period: '4h', jitter: 8 } },
    'twin.flow.prod.ws':     { label: 'Warehouse → Shipping',  unit: 'pal/h', decimals: 0,
                               sim: { type: 'walk', min: 8, max: 36, step: 2 } },
    'twin.flow.prod.cutter': { label: 'Cutter H8 → Weld Cells',unit: 'units/h', decimals: 0,
                               sim: { type: 'wave', min: 20, max: 60, period: '2h', jitter: 4 } },
    'twin.flow.prod.booth2': { label: 'Booth 2 → Curing Oven', unit: 'units/h', decimals: 0,
                               sim: { type: 'walk', min: 10, max: 45, step: 3 } },
    'twin.flow.prod.lift':   { label: 'Conveyor C1 → C2 lift', unit: 'pal/h', decimals: 0,
                               sim: { type: 'walk', min: 0, max: 40, step: 5 } },

    /* Steam / condensate (t/h). The steam main is WIRED to a real OMI tag —
     * in Live mode it binds to <tagPrefix>Flows.SteamPaintMain; condensate
     * return is simulation-only (deliberately lower than steam supply, so
     * the imbalance warning rule below has something to show). */
    'twin.flow.steam.paint': { label: 'Steam Main → Paint',    unit: 't/h', decimals: 1,
                               source: { type: 'omi', address: 'Flows.SteamPaintMain' },
                               sim: { type: 'wave', min: 1.8, max: 4.2, period: '6h', jitter: 0.2 } },
    'twin.flow.cond.paint':  { label: 'Paint condensate return', unit: 't/h', decimals: 1,
                               sim: { type: 'wave', min: 1.2, max: 3.0, period: '6h', jitter: 0.2 } },
    'twin.flow.heat.riser':  { label: 'Curing tower exhaust riser', unit: 'm³/min', decimals: 0,
                               sim: { type: 'wave', min: 90, max: 220, period: '3h', jitter: 10 } },

    /* Compressed air (Nm³/h). Welding header is wired; the others are not. */
    'twin.flow.air.welding': { label: 'Air → Welding header',  unit: 'Nm³/h', decimals: 0,
                               source: { type: 'omi', address: 'Flows.AirWelding' },
                               sim: { type: 'wave', min: 320, max: 640, period: '4h', jitter: 25 } },
    'twin.flow.air.assembly':{ label: 'Air → Assembly A',      unit: 'Nm³/h', decimals: 0,
                               sim: { type: 'walk', min: 200, max: 480, step: 25 } },
    'twin.flow.air.maint':   { label: 'Air → Maintenance Bay', unit: 'Nm³/h', decimals: 0,
                               sim: { type: 'walk', min: 60, max: 160, step: 12 } },
    'twin.flow.air.booths':  { label: 'AHU P1 → Booths supply',unit: 'm³/h', decimals: 0,
                               sim: { type: 'wave', min: 4500, max: 8800, period: '8h', jitter: 200 } },

    /* Water / coolant */
    'twin.flow.coolant.welding': { label: 'Chiller ↔ Welding coolant', unit: 'L/s', decimals: 1,
                               sim: { type: 'wave', min: 8, max: 14, period: '2h', jitter: 0.5 } },

    /* Twin-only equipment badges */
    'twin.eq.inv1.kw':     { label: 'Inverter 1 output', unit: 'kW', decimals: 0,
                             derived: { op: 'scale', input: 'energy.solar', factor: 0.55 } },
    'twin.eq.inv2.kw':     { label: 'Inverter 2 output', unit: 'kW', decimals: 0,
                             derived: { op: 'scale', input: 'energy.solar', factor: 0.45 } },
    'twin.eq.blr-u1.steam':{ label: 'Boiler steam output', unit: 't/h', decimals: 1,
                             sim: { type: 'wave', min: 2.0, max: 4.5, period: '6h', jitter: 0.2 } },
    'twin.eq.ahu-p1.flow': { label: 'AHU P1 airflow', unit: 'm³/h', decimals: 0,
                             sim: { type: 'walk', min: 5000, max: 9000, step: 300 } },
    'twin.eq.ahu-a1.flow': { label: 'AHU A1 airflow', unit: 'm³/h', decimals: 0,
                             sim: { type: 'walk', min: 3000, max: 6000, step: 250 } },
    'twin.eq.ef-p1.flow':  { label: 'Exhaust fan flow', unit: 'm³/min', decimals: 0,
                             sim: { type: 'walk', min: 100, max: 220, step: 12 } },
    'twin.eq.scrub-p1.dp': { label: 'Scrubber ΔP', unit: 'Pa', decimals: 0,
                             sim: { type: 'walk', min: 250, max: 600, step: 25 } },
    'twin.eq.db-a1.load':  { label: 'Board A1 load', unit: '%', decimals: 0,
                             sim: { type: 'walk', min: 35, max: 80, step: 4 } },
    'twin.eq.lift-w1.cycles': { label: 'Lift W1 cycles', unit: 'cyc/h', decimals: 0,
                             sim: { type: 'walk', min: 0, max: 40, step: 6 } },
  },

  connections: [

    /* ═══ Boundary flows (external ring nodes ↔ the factory) ═══════════ */
    { id: 'el-grid-tx', label: 'Grid import', utility: 'electrical',
      from: { ref: 'external:city-grid' },
      to:   { ref: 'machine:TX-1', anchor: { side: 'right', t: 0.3 } },
      binding: 'energy.grid', unit: 'kW', flowRange: [0, 100] },

    { id: 'pr-ship-out', label: 'Outbound dispatch', utility: 'product',
      from: { ref: 'zone:shipping', anchor: { side: 'bottom', t: 0.5 } },
      to:   { ref: 'external:dispatch' },
      binding: 'twin.flow.prod.ws', unit: 'pal/h', flowRange: [0, 40] },

    /* ═══ Electrical distribution (machine → zone feeders) ═════════════ */
    { id: 'el-pv-tx', label: 'PV → TX-1', utility: 'electrical',
      from: { ref: 'machine:INV-1', anchor: { side: 'bottom' } },
      to:   { ref: 'machine:TX-1',  anchor: { side: 'top' } },
      binding: 'energy.solar', unit: 'kW', flowRange: [0, 220],
      direction: 'forward',
      rules: [{ op: '<', value: 10, style: 'inactive' }] },

    { id: 'el-bess-tx', label: 'BESS → TX-1', utility: 'electrical',
      from: { ref: 'machine:BESS-1', anchor: { side: 'left' } },
      to:   { ref: 'machine:TX-1',   anchor: { side: 'right' } },
      binding: 'energy.batteryOutput', unit: 'kW', flowRange: [0, 100],
      direction: 'both' },

    { id: 'el-tx-assembly-a', label: 'Feeder A', utility: 'electrical',
      from: { ref: 'machine:TX-1', anchor: { side: 'left' } },
      to:   { ref: 'zone:assembly-a', anchor: { side: 'top', t: 0.7 } },
      binding: 'zone.assembly-a.energy', unit: 'kWh', flowRange: [0, 320] },

    { id: 'el-tx-assembly-b', label: 'Feeder B', utility: 'electrical',
      from: { ref: 'machine:TX-1', anchor: { side: 'left' } },
      to:   { ref: 'zone:assembly-b', anchor: { side: 'right', t: 0.25 } },
      binding: 'zone.assembly-b.energy', unit: 'kWh', flowRange: [0, 290] },

    { id: 'el-tx-welding', label: 'Feeder W', utility: 'electrical',
      from: { ref: 'machine:TX-1', anchor: { side: 'left' } },
      to:   { ref: 'zone:welding', anchor: { side: 'top', t: 0.8 } },
      binding: 'zone.welding.energy', unit: 'kWh', flowRange: [0, 240] },

    { id: 'el-tx-paint', label: 'Feeder P', utility: 'electrical',
      from: { ref: 'machine:TX-1', anchor: { side: 'left' } },
      to:   { ref: 'zone:paint', anchor: { side: 'right', t: 0.3 } },
      binding: 'zone.paint.energy', unit: 'kWh', flowRange: [0, 200] },

    { id: 'el-tx-office', label: 'Feeder U', utility: 'electrical',
      from: { ref: 'machine:TX-1', anchor: { side: 'bottom' } },
      to:   { ref: 'zone:office', anchor: { side: 'right', t: 0.3 } },
      binding: 'zone.office.energy', unit: 'kWh', flowRange: [0, 80] },

    /* ═══ Product flow (zone-level main line + machine-level detail) ═══ */
    { id: 'pr-aa-weld', label: 'Assembly A → Welding', utility: 'product',
      from: { ref: 'zone:assembly-a', anchor: { side: 'right', t: 0.35 } },
      to:   { ref: 'zone:welding',    anchor: { side: 'left',  t: 0.35 } },
      binding: 'twin.flow.prod.aw', unit: 'units/h', flowRange: [0, 160] },

    { id: 'pr-ab-weld', label: 'Assembly B → Welding', utility: 'product',
      from: { ref: 'zone:assembly-b', anchor: { side: 'right', t: 0.5 } },
      to:   { ref: 'zone:welding',    anchor: { side: 'bottom', t: 0.3 } },
      binding: 'twin.flow.prod.bw', unit: 'units/h', flowRange: [0, 140] },

    /* Machine → subzone (detail line under the zone-level main flow). */
    { id: 'pr-cutter-cells', label: 'Cutter H8 → Weld Cells', utility: 'product',
      from: { ref: 'machine:M-008' },
      to:   { ref: 'subzone:welding/weld-cells', anchor: { side: 'left', t: 0.5 } },
      binding: 'twin.flow.prod.cutter', unit: 'units/h', flowRange: [0, 70] },

    { id: 'pr-weld-paint', label: 'Welding → Paint', utility: 'product',
      from: { ref: 'zone:welding', anchor: { side: 'right', t: 0.35 } },
      to:   { ref: 'zone:paint',   anchor: { side: 'left',  t: 0.35 } },
      binding: 'twin.flow.prod.wp', unit: 'units/h', flowRange: [0, 260] },

    /* Machine → machine across subzones (Booth 2 feeds the curing oven
     * on the tower's Level 1). */
    { id: 'pr-booth-oven', label: 'Booth 2 → Curing Oven', utility: 'product',
      from: { ref: 'machine:M-026' },
      to:   { ref: 'machine:M-029' },
      binding: 'twin.flow.prod.booth2', unit: 'units/h', flowRange: [0, 50],
      rules: [{ op: '<', value: 4, style: 'inactive' }] },

    { id: 'pr-paint-quality', label: 'Paint → Quality', utility: 'product',
      from: { ref: 'zone:paint',   anchor: { side: 'bottom', t: 0.3 } },
      to:   { ref: 'zone:quality', anchor: { side: 'top', t: 0.7 } },
      binding: 'twin.flow.prod.pq', unit: 'units/h', flowRange: [0, 260] },

    { id: 'pr-quality-wh', label: 'Quality → Warehouse', utility: 'product',
      from: { ref: 'zone:quality',   anchor: { side: 'right', t: 0.5 } },
      to:   { ref: 'zone:warehouse', anchor: { side: 'left',  t: 0.5 } },
      binding: 'twin.flow.prod.qw', unit: 'units/h', flowRange: [0, 260] },

    /* Cross-floor, machine → machine: receiving conveyor (Floor 1) feeds
     * the mezzanine conveyor (Floor 2) through the vertical lift. */
    { id: 'pr-wh-lift', label: 'C1 → C2 vertical lift', utility: 'product',
      from: { ref: 'machine:M-038' },
      to:   { ref: 'machine:M-039' },
      binding: 'twin.flow.prod.lift', unit: 'pal/h', flowRange: [0, 50],
      rules: [{ op: '<', value: 2, style: 'inactive' }] },

    { id: 'pr-wh-ship', label: 'Warehouse → Shipping', utility: 'product',
      from: { ref: 'zone:warehouse', anchor: { side: 'bottom', t: 0.2 } },
      to:   { ref: 'zone:shipping',  anchor: { side: 'right',  t: 0.4 } },
      binding: 'twin.flow.prod.ws', unit: 'pal/h', flowRange: [0, 40] },

    /* ═══ Steam / heat ══════════════════════════════════════════════════ */
    /* Boiler → Paint steam main. WIRED binding (has a real OMI source) —
     * in Live mode this is the line that keeps showing data. */
    { id: 'st-blr-paint', label: 'Steam main', utility: 'steam',
      from: { ref: 'machine:BLR-U1' },
      to:   { ref: 'zone:paint', anchor: { side: 'bottom', t: 0.75 } },
      binding: 'twin.flow.steam.paint', unit: 't/h', flowRange: [0, 5],
      rules: [{ op: '>', value: 4.0, color: 'warn', badge: 'Near capacity' }] },

    /* Cross-floor inside a SUBZONE: curing oven (tower L1) → exhaust fan
     * (tower L3). Visible as a riser chip unless that level is active. */
    { id: 'st-tower-riser', label: 'Tower exhaust riser', utility: 'steam',
      from: { ref: 'machine:M-029' },
      to:   { ref: 'machine:EF-P1' },
      binding: 'twin.flow.heat.riser', unit: 'm³/min', flowRange: [0, 240] },

    /* ═══ Condensate (return leg — sim-only; imbalance vs steam shows as
     *     a warning rule when return drops below 60% of range) ═════════ */
    { id: 'cd-paint-blr', label: 'Condensate return', utility: 'condensate',
      from: { ref: 'zone:paint', anchor: { side: 'bottom', t: 0.9 } },
      to:   { ref: 'machine:BLR-U1' },
      binding: 'twin.flow.cond.paint', unit: 't/h', flowRange: [0, 5],
      rules: [{ op: '<', value: 1.6, color: 'warn', badge: 'Low return — check traps' }] },

    /* ═══ Compressed air ════════════════════════════════════════════════ */
    { id: 'air-welding', label: 'Air header — Welding', utility: 'air',
      from: { ref: 'machine:M-053' },
      to:   { ref: 'zone:welding', anchor: { side: 'bottom', t: 0.7 } },
      binding: 'twin.flow.air.welding', unit: 'Nm³/h', flowRange: [0, 700] },

    { id: 'air-assembly', label: 'Air header — Assembly A', utility: 'air',
      from: { ref: 'machine:M-054' },
      to:   { ref: 'zone:assembly-a', anchor: { side: 'bottom', t: 0.5 } },
      binding: 'twin.flow.air.assembly', unit: 'Nm³/h', flowRange: [0, 500] },

    /* Routed under the shipping dock with a waypoint hint. */
    { id: 'air-maint', label: 'Air — Maintenance Bay', utility: 'air',
      from: { ref: 'machine:M-053' },
      to:   { ref: 'zone:maintenance-bay', anchor: { side: 'bottom', t: 0.5 } },
      binding: 'twin.flow.air.maint', unit: 'Nm³/h', flowRange: [0, 200],
      route: { waypoints: [[820, 1230]] },
      rules: [{ op: '>', value: 130, color: 'warn', badge: 'Leak survey due' }] },

    /* Cross-floor zone-level air: AHU on Paint Floor 2 supplies the booths
     * on Floor 1. */
    { id: 'air-booths', label: 'Booth supply air', utility: 'air',
      from: { ref: 'machine:AHU-P1' },
      to:   { ref: 'subzone:paint/booths', anchor: { side: 'top', t: 0.5 } },
      binding: 'twin.flow.air.booths', unit: 'm³/h', flowRange: [0, 9000] },

    /* ═══ Water / coolant ═══════════════════════════════════════════════ */
    { id: 'wa-chiller-weld', label: 'Coolant loop', utility: 'water',
      from: { ref: 'machine:M-055' },
      to:   { ref: 'zone:welding', anchor: { side: 'bottom', t: 0.9 } },
      binding: 'twin.flow.coolant.welding', unit: 'L/s', flowRange: [0, 16],
      direction: 'both' },
  ],
});
