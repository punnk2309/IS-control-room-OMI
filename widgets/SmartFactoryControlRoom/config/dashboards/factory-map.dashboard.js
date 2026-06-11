/* ============================================================================
 * Dashboard: Factory Map — interactive digital twin canvas
 * ----------------------------------------------------------------------------
 * The whole page is one factory-twin widget: a pannable, zoomable top-down
 * map of the site with floors, subzones, machines and a live flow overlay.
 *
 * Everything on it is config:
 *   config/twin/twin.layout.config.js       zones / floors / subzones / machines
 *   config/twin/twin.connections.config.js  flows + their datapoints
 *   config/twin/twin.config.js              LOD, camera, utilities, behaviour
 *
 * Cross-dashboard links live in the twin's detail panel (View Machines opens
 * the Machines page pre-filtered to the zone) and zone selection still emits
 * 'map:zoneSelected' on the bus for any widget that wants to react.
 * Deep link: #/factory-map?zone=welding opens zoomed to a zone.
 * ========================================================================== */
SFP.config.define('dashboard.factory-map', {
  grid: { columns: 12, gap: 12 },
  widgets: [
    { type: 'factory-twin', layout: { span: 12, minH: 480 }, options: {} },
  ],
});
