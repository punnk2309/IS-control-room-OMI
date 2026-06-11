/* ============================================================================
 * Alarm rules — config/alarm-rules.config.js
 * ----------------------------------------------------------------------------
 * Declarative alarm logic evaluated by src/state/alarm-engine.js. Severity
 * uses the OMI scale (Low | Medium | High | Critical); raised alarms are also
 * forwarded to the OMI alarm bar when hosted. `category` powers filtered
 * alarm lists ('energy' panel on the Energy page, 'machines' on Machines).
 *
 * Rule types and their message template fields:
 *   datapoint      {value} {unit} {label}
 *   machineState   {id} {name} {zone}
 *   machineMetric  {id} {name} {zone} {value}
 * ========================================================================== */
SFP.config.define('alarmRules', [

  /* ── Machines ──────────────────────────────────────────────────────────── */
  {
    id: 'machine-error',
    type: 'machineState',
    state: 'error',
    severity: 'Critical',
    category: 'machines',
    message: '{name} ({id}) entered ERROR state — immediate attention required',
  },
  {
    id: 'machine-overtemp',
    type: 'machineMetric',
    metric: 'temperature',
    when: { op: '>', value: 94 },
    severity: 'High',
    category: 'machines',
    message: '{name} temperature {value}°C above 94°C limit',
  },

  /* ── Energy ────────────────────────────────────────────────────────────── */
  {
    id: 'energy-total-high',
    datapoint: 'energy.totalUsage',
    when: { op: '>', value: 950 },
    severity: 'High',
    category: 'energy',
    message: 'Total energy usage {value} {unit} above 950 kWh limit',
  },
  {
    id: 'battery-low',
    datapoint: 'energy.batteryLevel',
    when: { op: '<', value: 25 },
    severity: 'Medium',
    category: 'energy',
    message: 'Battery storage at {value}% — below 25% reserve threshold',
  },
  {
    id: 'grid-import-high',
    datapoint: 'energy.grid',
    when: { op: '>', value: 70 },
    severity: 'Low',
    category: 'energy',
    message: 'Grid import {value} {unit} — consider shifting load to storage',
  },
  {
    id: 'assembly-a-energy-spike',
    datapoint: 'zone.assembly-a.energy',
    when: { op: '>', value: 288 },
    severity: 'Medium',
    category: 'energy',
    message: 'Assembly Line A energy spike: {value} {unit}',
  },
  {
    id: 'welding-energy-spike',
    datapoint: 'zone.welding.energy',
    when: { op: '>', value: 215 },
    severity: 'Medium',
    category: 'energy',
    message: 'Welding Station energy spike: {value} {unit}',
  },

  /* ── Production ────────────────────────────────────────────────────────── */
  {
    id: 'production-rate-low',
    datapoint: 'production.rate',
    when: { op: '<', value: 2600 },
    severity: 'Medium',
    category: 'production',
    message: 'Production rate {value} {unit} below 2,600 units/hr floor',
  },
  {
    id: 'downtime-high',
    datapoint: 'production.downtime',
    when: { op: '>', value: 3.2 },
    severity: 'High',
    category: 'production',
    message: 'Accumulated downtime {value} hrs exceeds 3.2 hr threshold',
  },
]);
