/* ============================================================================
 * Machine registry — config/machines.config.js
 * ----------------------------------------------------------------------------
 * Adding a machine = adding one line to `machines`. The platform generates a
 * datapoint per machine per metric (machine.<id>.<metric>) using the metric
 * templates below; {id} in the OMI address is replaced with the machine id.
 *
 * `zone` must match a zone id in config/twin/twin.layout.config.js — that
 * link powers twin drill-downs on the factory map and zone filters in the grid.
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

  machines: [
    /* Assembly Line A */
    { id: 'M-001', name: 'CNC Mill A1',   zone: 'assembly-a', type: 'CNC Mill' },
    { id: 'M-002', name: 'Lathe B2',      zone: 'assembly-a', type: 'Lathe' },
    { id: 'M-003', name: 'Press C3',      zone: 'assembly-a', type: 'Press' },
    { id: 'M-004', name: 'Welder D4',     zone: 'assembly-a', type: 'Welder' },
    { id: 'M-005', name: 'Grinder E5',    zone: 'assembly-a', type: 'Grinder' },
    { id: 'M-006', name: 'Drill F6',      zone: 'assembly-a', type: 'Drill' },
    { id: 'M-007', name: 'Mill G7',       zone: 'assembly-a', type: 'CNC Mill' },
    { id: 'M-008', name: 'Cutter H8',     zone: 'assembly-a', type: 'Cutter' },

    /* Assembly Line B */
    { id: 'M-009', name: 'Router I9',     zone: 'assembly-b', type: 'Router' },
    { id: 'M-010', name: 'Saw J10',       zone: 'assembly-b', type: 'Saw' },
    { id: 'M-011', name: 'Press K11',     zone: 'assembly-b', type: 'Press' },
    { id: 'M-012', name: 'Lathe L12',     zone: 'assembly-b', type: 'Lathe' },
    { id: 'M-013', name: 'CNC Mill B1',   zone: 'assembly-b', type: 'CNC Mill' },
    { id: 'M-014', name: 'Bender B2',     zone: 'assembly-b', type: 'Bender' },
    { id: 'M-015', name: 'Punch B3',      zone: 'assembly-b', type: 'Punch' },
    { id: 'M-016', name: 'Shear B4',      zone: 'assembly-b', type: 'Shear' },

    /* Welding Station */
    { id: 'M-017', name: 'Weld Cell 1',   zone: 'welding', type: 'Robot Welder' },
    { id: 'M-018', name: 'Weld Cell 2',   zone: 'welding', type: 'Robot Welder' },
    { id: 'M-019', name: 'Weld Cell 3',   zone: 'welding', type: 'Robot Welder' },
    { id: 'M-020', name: 'Weld Cell 4',   zone: 'welding', type: 'Robot Welder' },
    { id: 'M-021', name: 'Spot Welder 5', zone: 'welding', type: 'Spot Welder' },
    { id: 'M-022', name: 'Spot Welder 6', zone: 'welding', type: 'Spot Welder' },
    { id: 'M-023', name: 'Seam Welder 7', zone: 'welding', type: 'Seam Welder' },
    { id: 'M-024', name: 'Laser Welder 8',zone: 'welding', type: 'Laser Welder' },

    /* Paint Shop */
    { id: 'M-025', name: 'Paint Booth 1', zone: 'paint', type: 'Paint Booth' },
    { id: 'M-026', name: 'Paint Booth 2', zone: 'paint', type: 'Paint Booth' },
    { id: 'M-027', name: 'Paint Robot 3', zone: 'paint', type: 'Paint Robot' },
    { id: 'M-028', name: 'Paint Robot 4', zone: 'paint', type: 'Paint Robot' },
    { id: 'M-029', name: 'Curing Oven 5', zone: 'paint', type: 'Curing Oven' },
    { id: 'M-030', name: 'Dryer Unit 6',  zone: 'paint', type: 'Dryer' },

    /* Quality Control */
    { id: 'M-031', name: 'CMM Station 1', zone: 'quality', type: 'CMM' },
    { id: 'M-032', name: 'CMM Station 2', zone: 'quality', type: 'CMM' },
    { id: 'M-033', name: 'Vision Sys 3',  zone: 'quality', type: 'Vision System' },
    { id: 'M-034', name: 'Test Bench 4',  zone: 'quality', type: 'Test Bench' },
    { id: 'M-035', name: 'X-Ray Unit 5',  zone: 'quality', type: 'X-Ray' },

    /* Warehouse */
    { id: 'M-036', name: 'AGV 1',         zone: 'warehouse', type: 'AGV' },
    { id: 'M-037', name: 'AGV 2',         zone: 'warehouse', type: 'AGV' },
    { id: 'M-038', name: 'Conveyor C1',   zone: 'warehouse', type: 'Conveyor' },
    { id: 'M-039', name: 'Conveyor C2',   zone: 'warehouse', type: 'Conveyor' },
    { id: 'M-040', name: 'Stacker S1',    zone: 'warehouse', type: 'Stacker Crane' },
    { id: 'M-041', name: 'Wrapper W1',    zone: 'warehouse', type: 'Wrapper' },

    /* Maintenance Bay */
    { id: 'M-042', name: 'Test Rig 1',    zone: 'maintenance-bay', type: 'Test Rig' },
    { id: 'M-043', name: 'Test Rig 2',    zone: 'maintenance-bay', type: 'Test Rig' },
    { id: 'M-044', name: 'Crane MB1',     zone: 'maintenance-bay', type: 'Overhead Crane' },
    { id: 'M-045', name: 'Balancer MB2',  zone: 'maintenance-bay', type: 'Balancer' },

    /* Shipping Dock */
    { id: 'M-046', name: 'Dock Lift 1',   zone: 'shipping', type: 'Dock Lift' },
    { id: 'M-047', name: 'Dock Lift 2',   zone: 'shipping', type: 'Dock Lift' },
    { id: 'M-048', name: 'Palletizer 3',  zone: 'shipping', type: 'Palletizer' },
    { id: 'M-049', name: 'Conveyor C4',   zone: 'shipping', type: 'Conveyor' },
    { id: 'M-050', name: 'Label Sys 5',   zone: 'shipping', type: 'Labeller' },

    /* Office / Utilities */
    { id: 'M-051', name: 'HVAC System A', zone: 'office', type: 'HVAC' },
    { id: 'M-052', name: 'HVAC System B', zone: 'office', type: 'HVAC' },
    { id: 'M-053', name: 'Compressor 1',  zone: 'office', type: 'Compressor' },
    { id: 'M-054', name: 'Compressor 2',  zone: 'office', type: 'Compressor' },
    { id: 'M-055', name: 'Chiller Unit',  zone: 'office', type: 'Chiller' },
  ],
});
