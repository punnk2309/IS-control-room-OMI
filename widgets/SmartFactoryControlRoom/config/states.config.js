/* ============================================================================
 * State logic — config/states.config.js
 * ----------------------------------------------------------------------------
 * Defines every state group used by widgets, alarms and the factory map.
 * Changing a threshold, color or label here changes it everywhere.
 *
 *  - `states`   the states that exist (color = theme token)
 *  - `valueMap` maps discrete raw values (PLC codes, strings) to states
 *  - `rules`    ordered conditions for continuous inputs (first match wins,
 *               see src/core/expressions.js for the condition grammar)
 *  - `default`  state used when nothing matches
 * ========================================================================== */
SFP.config.define('states', {

  /* Machine fleet states. Live tags may deliver integer codes (see valueMap)
   * or the state name itself — both normalize to the same state ids. */
  machine: {
    default: 'idle',
    states: [
      { id: 'running',     label: 'Running',     color: 'state-running' },
      { id: 'idle',        label: 'Idle',        color: 'state-idle' },
      { id: 'maintenance', label: 'Maintenance', color: 'state-maintenance' },
      { id: 'error',       label: 'Error',       color: 'state-error' },
    ],
    valueMap: { 0: 'idle', 1: 'running', 2: 'maintenance', 3: 'error' },
  },

  /* Energy bands for factory-map zones and the energy-by-zone chart.
   * Values are kWh consumption per zone. */
  'zone-energy': {
    default: 'low',
    states: [
      { id: 'high',   label: 'High (>250 kWh)',     color: 'band-high' },
      { id: 'medium', label: 'Medium (150–250)',     color: 'band-medium' },
      { id: 'normal', label: 'Normal (80–150)',      color: 'band-normal' },
      { id: 'low',    label: 'Low (<80)',            color: 'band-low' },
    ],
    rules: [
      { when: { op: '>', value: 250 }, state: 'high' },
      { when: { op: '>', value: 150 }, state: 'medium' },
      { when: { op: '>', value: 80 },  state: 'normal' },
    ],
  },

  /* Failure-risk bands for predictive maintenance (input: risk %). */
  risk: {
    default: 'low',
    states: [
      { id: 'high',   label: 'High risk',   color: 'alarm' },
      { id: 'medium', label: 'Medium risk', color: 'warn' },
      { id: 'low',    label: 'Low risk',    color: 'good' },
    ],
    rules: [
      { when: { op: '>=', value: 75 }, state: 'high' },
      { when: { op: '>=', value: 60 }, state: 'medium' },
    ],
  },
});
