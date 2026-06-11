/* ============================================================================
 * Dashboard: Factory Map — interactive floor plan with zone drill-down
 * ----------------------------------------------------------------------------
 * Geometry and bindings live in config/factory-layout.config.js; this file
 * only composes the page. Clicking a zone updates the details panel; quick
 * actions navigate to other dashboards with the zone preselected.
 * ========================================================================== */
SFP.config.define('dashboard.factory-map', {
  grid: { columns: 12, gap: 12 },
  widgets: [

    { type: 'factory-map', layout: { span: 8, minH: 520 },
      options: {
        title: 'Factory Floor Layout',
        subtitle: 'real-time energy consumption by zone',
        icon: 'map',
        stateGroup: 'zone-energy',
        legend: true,
        selectable: true,
        autoSelect: true,
      } },

    { type: 'zone-details', layout: { span: 4, minH: 520 },
      options: {
        title: 'Zone Details', icon: 'info',
        actions: [
          { label: 'View Machines', icon: 'cog', primary: true,
            navigate: { page: 'machines', params: { zone: '{zone}' } } },
          { label: 'Energy Report', icon: 'zap',
            navigate: { page: 'energy', params: {} } },
          { label: 'Maintenance Log', icon: 'wrench',
            navigate: { page: 'maintenance', params: {} } },
        ],
      } },
  ],
});
