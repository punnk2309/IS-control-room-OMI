/* ============================================================================
 * Application config — config/app.config.js
 * ----------------------------------------------------------------------------
 * Top-level identity, navigation and data behaviour. Pages map 1:1 to
 * dashboard definitions (config/dashboards/*.dashboard.js); to add a page,
 * create a dashboard file, include it in index.html, and list it here.
 *
 * Several values can be overridden per widget instance from the OMI
 * Properties panel (see manifest.json): widgetTitle, theme, defaultPage,
 * dataMode, tagPrefix.
 * ========================================================================== */
SFP.config.define('app', {
  title: 'Factory Operations Management',
  subtitle: 'Industrial IoT Control Center',
  icon: 'factory',

  theme: 'dark',
  defaultPage: 'overview',

  pages: [
    { id: 'overview',    label: 'Overview',    icon: 'layout-dashboard', dashboard: 'overview' },
    { id: 'energy',      label: 'Energy',      icon: 'zap',              dashboard: 'energy' },
    { id: 'machines',    label: 'Machines',    icon: 'cog',              dashboard: 'machines' },
    { id: 'factory-map', label: 'Factory Map', icon: 'map',              dashboard: 'factory-map' },
    { id: 'maintenance', label: 'Maintenance', icon: 'wrench',           dashboard: 'maintenance' },
    { id: 'analytics',   label: 'Analytics',   icon: 'trending-up',      dashboard: 'analytics' },
  ],

  data: {
    /* Simulation tick period (demo mode and unbound-datapoint fallback). */
    simulationIntervalMs: 2000,
    /* In live mode, datapoints without a live source binding fall back to
     * simulation and are visibly marked 'Simulated'. Set false to show them
     * as unavailable instead. */
    simulateUnboundInLive: true,
  },
});
