/* ============================================================================
 * Dashboard: Machines — fleet browser with filters and drill-down
 * ----------------------------------------------------------------------------
 * Reached from the factory map via "View Machines" (carries ?zone=… params).
 * ========================================================================== */
SFP.config.define('dashboard.machines', {
  grid: { columns: 12, gap: 12 },
  widgets: [

    { type: 'kpi-card', layout: { span: 3 },
      bind: { value: 'machines.count.running' },
      options: { label: 'Running', icon: 'cog', accent: 'state-running',
                 valueColor: 'state-running', decimals: 0, unit: 'machines' } },

    { type: 'kpi-card', layout: { span: 3 },
      bind: { value: 'machines.count.idle' },
      options: { label: 'Idle', icon: 'pause', accent: 'state-idle',
                 valueColor: 'state-idle', decimals: 0, unit: 'machines' } },

    { type: 'kpi-card', layout: { span: 3 },
      bind: { value: 'machines.count.maintenance' },
      options: { label: 'Maintenance', icon: 'wrench', accent: 'state-maintenance',
                 valueColor: 'state-maintenance', decimals: 0, unit: 'machines' } },

    { type: 'kpi-card', layout: { span: 3 },
      bind: { value: 'machines.count.error' },
      options: { label: 'Error', icon: 'x-circle', accent: 'state-error',
                 valueColor: 'state-error', decimals: 0, unit: 'machines' } },

    { type: 'machine-grid', layout: { span: 8, rows: 2 },
      options: { title: 'Machine Fleet', icon: 'cog',
                 mode: 'detailed', pageSize: 9,
                 metrics: ['temperature', 'load', 'runtime'] } },

    { type: 'donut-chart', layout: { span: 4, col: 9 },
      options: {
        title: 'Fleet Breakdown',
        stateGroup: 'machine',
        datapointPattern: 'machines.count.{state}',
        totalDatapoint: 'machines.count.total',
        centerLabel: 'machines',
        height: 140,
      } },

    { type: 'alarm-list', layout: { span: 4, col: 9 },
      options: { title: 'Machine Alerts', icon: 'alert-triangle',
                 category: 'machines', limit: 5, compact: true,
                 showResolved: true, actions: false } },
  ],
});
