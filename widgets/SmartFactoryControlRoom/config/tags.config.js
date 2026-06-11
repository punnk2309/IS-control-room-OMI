/* ============================================================================
 * Datapoint definitions — config/tags.config.js
 * ----------------------------------------------------------------------------
 * The tag map of the platform. Widgets bind to the logical ids defined here;
 * where the value comes from is decided per datapoint:
 *
 *   source:  live binding. { type:'omi', address } binds to an OMI tag
 *            (full tag = <tagPrefix property> + address). { type:'rest', … }
 *            polls an HTTP/JSON endpoint (Historian/MES/SAP/SQL gateways) —
 *            see docs/data-sources.md.
 *   derived: computed from other datapoints (sum/avg/diff/ratio/scale).
 *   sim:     simulation profile used in demo mode and as the marked fallback
 *            for unbound datapoints in live mode.
 *   history: how much time-series the platform retains for charts/trends.
 *
 * Machine datapoints (machine.<id>.<metric>) are generated from
 * config/machines.config.js — they do not appear here.
 * ========================================================================== */
SFP.config.define('datapoints', {

  /* ── Production ────────────────────────────────────────────────────────── */

  'production.rate': {
    label: 'Production Rate', unit: 'units/hr', decimals: 0,
    source: { type: 'omi', address: 'Production.Rate' },
    sim: { type: 'wave', min: 2550, max: 3050, period: '24h', jitter: 35, phase: 4.2 },
    history: { window: '7d', interval: '10m' },
  },
  'production.efficiency': {
    label: 'Efficiency', unit: '%', decimals: 1,
    source: { type: 'omi', address: 'Production.Efficiency' },
    sim: { type: 'walk', min: 88, max: 97, step: 0.4 },
    history: { window: '7d', interval: '10m' },
  },
  'production.downtime': {
    label: 'Downtime', unit: 'hrs', decimals: 1,
    source: { type: 'omi', address: 'Production.Downtime' },
    sim: { type: 'walk', min: 0.4, max: 3.8, step: 0.15 },
    history: { window: '7d', interval: '10m' },
  },
  'production.energyEfficiency': {
    label: 'Energy Efficiency', unit: 'units/kWh', decimals: 2,
    derived: { op: 'ratio', numerator: 'production.rate', denominator: 'energy.totalUsage' },
  },

  /* ── Energy ────────────────────────────────────────────────────────────── */

  'energy.totalUsage': {
    label: 'Total Energy', unit: 'kWh', decimals: 1,
    source: { type: 'omi', address: 'Energy.TotalUsage' },
    sim: { type: 'wave', min: 530, max: 965, period: '24h', jitter: 22, phase: 4.0 },
    history: { window: '7d', interval: '10m' },
  },
  'energy.consumption': {
    label: 'Power Consumption', unit: 'kW', decimals: 0,
    source: { type: 'omi', address: 'Energy.TotalConsumption' },
    sim: { type: 'wave', min: 380, max: 820, period: '24h', jitter: 30, phase: 4.0 },
    history: { window: '24h', interval: '2m' },
  },
  'energy.peak': {
    label: 'Peak Usage', unit: 'kW', decimals: 0,
    source: { type: 'omi', address: 'Energy.PeakUsage' },
    sim: { type: 'walk', min: 780, max: 880, step: 6 },
  },
  'energy.cost24h': {
    label: 'Cost (24h)', unit: 'USD', decimals: 0,
    /* energy price: 1.47 USD/kWh-equivalent for the demo dataset */
    derived: { op: 'scale', input: 'energy.totalUsage', factor: 1.47 },
  },
  'energy.solar': {
    label: 'Solar Production', unit: 'kW', decimals: 0,
    source: { type: 'omi', address: 'Energy.SolarProduction' },
    sim: { type: 'wave', min: 8, max: 215, period: '24h', jitter: 6, phase: 4.4 },
    history: { window: '30d', interval: '1h' },
  },
  'energy.grid': {
    label: 'Grid Import', unit: 'kW', decimals: 0,
    source: { type: 'omi', address: 'Energy.GridUsage' },
    sim: { type: 'walk', min: 18, max: 78, step: 4 },
    history: { window: '30d', interval: '1h' },
  },
  'energy.batteryLevel': {
    label: 'Battery Storage', unit: '%', decimals: 0,
    source: { type: 'omi', address: 'Energy.BatteryLevel' },
    sim: { type: 'walk', min: 22, max: 95, step: 1.2 },
    history: { window: '24h', interval: '5m' },
  },
  'energy.batteryKwh': {
    label: 'Battery Charge', unit: 'kWh', decimals: 0,
    /* 500 kWh installed capacity × state-of-charge */
    derived: { op: 'scale', input: 'energy.batteryLevel', factor: 5 },
  },
  'energy.batteryOutput': {
    label: 'Battery Output', unit: 'kW', decimals: 0,
    source: { type: 'omi', address: 'Energy.BatteryOutput' },
    sim: { type: 'walk', min: 10, max: 90, step: 6 },
  },
  'energy.solarShare': {
    label: 'Solar Share', unit: '%', decimals: 0,
    derived: { op: 'ratio', numerator: 'energy.solar', denominator: 'energy.consumption',
               scale: 100, clamp: [0, 100] },
  },
  'energy.gridShare': {
    label: 'Grid Share', unit: '%', decimals: 0,
    derived: { op: 'ratio', numerator: 'energy.grid', denominator: 'energy.consumption',
               scale: 100, clamp: [0, 100] },
  },

  /* ── Zone energy (bound by factory-layout.config.js zones) ─────────────── */

  'zone.assembly-a.energy': {
    label: 'Assembly Line A Energy', unit: 'kWh', decimals: 0,
    source: { type: 'omi', address: 'Zones.AssemblyA.Energy' },
    sim: { type: 'walk', min: 240, max: 300, step: 6 },
  },
  'zone.assembly-b.energy': {
    label: 'Assembly Line B Energy', unit: 'kWh', decimals: 0,
    source: { type: 'omi', address: 'Zones.AssemblyB.Energy' },
    sim: { type: 'walk', min: 215, max: 265, step: 6 },
  },
  'zone.welding.energy': {
    label: 'Welding Station Energy', unit: 'kWh', decimals: 0,
    source: { type: 'omi', address: 'Zones.Welding.Energy' },
    sim: { type: 'walk', min: 170, max: 225, step: 6 },
  },
  'zone.paint.energy': {
    label: 'Paint Shop Energy', unit: 'kWh', decimals: 0,
    source: { type: 'omi', address: 'Zones.Paint.Energy' },
    sim: { type: 'walk', min: 130, max: 175, step: 5 },
  },
  'zone.quality.energy': {
    label: 'Quality Control Energy', unit: 'kWh', decimals: 0,
    source: { type: 'omi', address: 'Zones.Quality.Energy' },
    sim: { type: 'walk', min: 85, max: 120, step: 4 },
  },
  'zone.warehouse.energy': {
    label: 'Warehouse Energy', unit: 'kWh', decimals: 0,
    source: { type: 'omi', address: 'Zones.Warehouse.Energy' },
    sim: { type: 'walk', min: 55, max: 80, step: 3 },
  },
  'zone.maintenance-bay.energy': {
    label: 'Maintenance Bay Energy', unit: 'kWh', decimals: 0,
    source: { type: 'omi', address: 'Zones.MaintenanceBay.Energy' },
    sim: { type: 'walk', min: 65, max: 95, step: 3 },
  },
  'zone.shipping.energy': {
    label: 'Shipping Dock Energy', unit: 'kWh', decimals: 0,
    source: { type: 'omi', address: 'Zones.Shipping.Energy' },
    sim: { type: 'walk', min: 40, max: 65, step: 3 },
  },
  'zone.office.energy': {
    label: 'Office Area Energy', unit: 'kWh', decimals: 0,
    source: { type: 'omi', address: 'Zones.Office.Energy' },
    sim: { type: 'walk', min: 35, max: 55, step: 2 },
  },

  /* ── Datasets (tables / lists) ─────────────────────────────────────────--
   * In production these typically come from MES/CMMS via a REST gateway:
   * replace `sim` with e.g.
   *   source: { type: 'rest', url: 'https://cmms.local/api/workorders',
   *             intervalMs: 60000, path: 'items' }
   * ------------------------------------------------------------------------ */

  'maintenance.workorders': {
    label: 'Maintenance Schedule', kind: 'dataset',
    sim: {
      type: 'dataset',
      data: [
        { asset: 'Grinder E5',        zone: 'Assembly A',  type: 'Emergency Repair',     priority: 'High',   due: '2026-06-11 14:00', status: 'Open',      team: 'Team Alpha' },
        { asset: 'Press C3',          zone: 'Assembly B',  type: 'Hydraulic Service',    priority: 'High',   due: '2026-06-12 09:00', status: 'Scheduled', team: 'Team Beta' },
        { asset: 'CNC Mill A1',       zone: 'Assembly A',  type: 'Bearing Replacement',  priority: 'Medium', due: '2026-06-15 10:00', status: 'Scheduled', team: 'Team Alpha' },
        { asset: 'Zone C HVAC',       zone: 'Office',      type: 'Scheduled PM',         priority: 'Medium', due: '2026-06-12 14:00', status: 'Pending',   team: 'Facilities' },
        { asset: 'Welding Station 5', zone: 'Welding',     type: 'Energy Spike Review',  priority: 'Medium', due: '2026-06-12 16:00', status: 'Pending',   team: 'Team Gamma' },
        { asset: 'Paint Booth Filter',zone: 'Paint Shop',  type: 'Filter Replacement',   priority: 'Low',    due: '2026-06-13 08:00', status: 'Scheduled', team: 'Team Beta' },
        { asset: 'Conveyor Belt C4',  zone: 'Warehouse',   type: 'Lubrication',          priority: 'Low',    due: '2026-06-14 08:00', status: 'Scheduled', team: 'Team Gamma' },
        { asset: 'Lathe B2',          zone: 'Assembly B',  type: 'Routine Inspection',   priority: 'Low',    due: '2026-06-17 13:00', status: 'Planned',   team: 'Team Gamma' },
        { asset: 'Compressor Unit 2', zone: 'Utilities',   type: 'Annual Inspection',    priority: 'Low',    due: '2026-06-19 08:00', status: 'Planned',   team: 'Facilities' },
        { asset: 'Saw J10',           zone: 'Shipping',    type: 'Blade Replacement',    priority: 'Low',    due: '2026-06-20 08:00', status: 'Planned',   team: 'Team Beta' },
      ],
    },
  },

  'maintenance.predictions': {
    label: 'Failure Predictions', kind: 'dataset',
    sim: {
      type: 'dataset',
      data: [
        { asset: 'CNC Mill A1', component: 'Spindle Bearing', riskPct: 87, daysToFailure: 12, action: 'Schedule replacement' },
        { asset: 'Lathe L12',   component: 'Drive Belt',      riskPct: 73, daysToFailure: 18, action: 'Monitor tension' },
        { asset: 'Press K11',   component: 'Hydraulic Pump',  riskPct: 65, daysToFailure: 25, action: 'Inspect seals' },
        { asset: 'Welder D4',   component: 'Cooling System',  riskPct: 58, daysToFailure: 30, action: 'Clean radiator' },
        { asset: 'Router I9',   component: 'Spindle Motor',   riskPct: 41, daysToFailure: 45, action: 'Routine check' },
      ],
    },
  },

  'analytics.downtimeByZone': {
    label: 'Downtime by Zone', kind: 'dataset',
    sim: {
      type: 'dataset',
      data: [
        { zone: 'Assembly A', hours: 4.2, color: 'band-high' },
        { zone: 'Assembly B', hours: 3.1, color: 'band-high' },
        { zone: 'Welding',    hours: 1.8, color: 'band-medium' },
        { zone: 'Quality',    hours: 2.1, color: 'band-medium' },
        { zone: 'Paint Shop', hours: 0.9, color: 'band-normal' },
        { zone: 'Warehouse',  hours: 0.5, color: 'band-low' },
        { zone: 'Office',     hours: 0.3, color: 'band-low' },
      ],
    },
  },

  'analytics.comparison': {
    label: 'Performance vs Target', kind: 'dataset',
    sim: {
      type: 'dataset',
      /* Values normalized to % of target so metrics share one scale. */
      data: [
        { metric: 'Production', today: 98.2,  yesterday: 93.7,  target: 100 },
        { metric: 'Efficiency', today: 99.2,  yesterday: 96.6,  target: 100 },
        { metric: 'Energy',     today: 103.3, yesterday: 108.9, target: 100 },
        { metric: 'Downtime',   today: 120.0, yesterday: 160.0, target: 100 },
        { metric: 'Quality',    today: 99.5,  yesterday: 98.9,  target: 100 },
      ],
    },
  },
});
