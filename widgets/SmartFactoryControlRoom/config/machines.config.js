/* ============================================================================
 * Machine-CLASS config — config/machines.config.js
 * ----------------------------------------------------------------------------
 * This file no longer lists individual machines. Machines are declared once,
 * in the asset model (config/asset-model.config.js): every node carrying a
 * `machineRef` IS a fleet machine and supplies its id, name and machineType.
 * Their physical `zone` is derived from the twin layout placement
 * (config/twin/twin.layout.config.js). See src/data/machine-registry.js.
 *
 * What remains here is machine-CLASS config shared by every machine:
 *   - `metrics`: the datapoint templates expanded per machine
 *     (machine.<id>.<metric>); {id} in the OMI address is the machine id.
 *   - `simulation.initialStates`: the demo-mode fleet state distribution.
 * ========================================================================== */
SFP.config.define('machines', {

  /* Metric templates: each machine gets one datapoint per entry. */
  metrics: {
    state:       { label: 'State',       address: 'Machines.{id}.State' },
    temperature: { label: 'Temperature', address: 'Machines.{id}.Temperature', unit: '°C', decimals: 0 },
    load:        { label: 'Load',        address: 'Machines.{id}.Load',        unit: '%',  decimals: 0 },
    runtime:     { label: 'Runtime',     address: 'Machines.{id}.Runtime',     unit: 'h',  decimals: 1 },
    efficiency:  { label: 'Efficiency',  address: 'Machines.{id}.Efficiency',  unit: '%',  decimals: 0 },
  },

  /* Demo-mode fleet distribution at startup. */
  simulation: {
    initialStates: { running: 42, idle: 8, maintenance: 3, error: 2 },
  },

});

/* The per-machine list (55 entries) was removed in the asset-merge: machine
 * identity now lives in config/asset-model.config.js (machineRef + name +
 * machineType) and physical zone in config/twin/twin.layout.config.js. */
