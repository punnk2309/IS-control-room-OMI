/* ============================================================================
 * Dashboard: Maintenance — live alerts, predictions and the work schedule
 * ----------------------------------------------------------------------------
 * Work orders / predictions are dataset datapoints (config/tags.config.js);
 * point them at a CMMS or MES REST endpoint to go live.
 * ========================================================================== */
SFP.config.define('dashboard.maintenance', {
  grid: { columns: 12, gap: 12 },
  widgets: [

    { type: 'alarm-list', layout: { span: 7, minH: 380 },
      options: { title: 'Active Alerts', icon: 'alert-triangle',
                 limit: 8, showResolved: true, actions: true } },

    { type: 'progress-list', layout: { span: 5, minH: 380 },
      bind: { dataset: 'maintenance.predictions' },
      options: {
        title: 'Predictive Maintenance', subtitle: 'failure-risk predictions',
        icon: 'wrench', unit: '%',
        dataset: {
          label: '{asset} — {component}',
          sublabel: 'Est. {daysToFailure} days to failure',
          value: 'riskPct',
          tail: '{action}',
          colorRules: 'risk',
        },
      } },

    { type: 'data-table', layout: { span: 12 },
      bind: { dataset: 'maintenance.workorders' },
      options: {
        title: 'Maintenance Schedule', subtitle: 'upcoming maintenance activities',
        icon: 'calendar',
        columns: [
          { field: 'asset',    label: 'Asset' },
          { field: 'zone',     label: 'Zone' },
          { field: 'type',     label: 'Type' },
          { field: 'priority', label: 'Priority',
            chip: { High: 'sev-high', Medium: 'sev-medium', Low: 'sev-low' } },
          { field: 'due',      label: 'Due' },
          { field: 'status',   label: 'Status',
            chip: { Open: 'sev-high', Pending: 'sev-medium',
                    Scheduled: 'sev-low', Planned: 'neutral' } },
          { field: 'team',     label: 'Assigned To' },
        ],
        sort: { field: 'due', dir: 'asc' },
      } },
  ],
});
