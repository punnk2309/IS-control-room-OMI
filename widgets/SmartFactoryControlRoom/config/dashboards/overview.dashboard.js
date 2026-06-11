/* ============================================================================
 * Dashboard: Overview — plant-wide situational awareness
 * ----------------------------------------------------------------------------
 * 12-column grid. See docs/creating-dashboards.md for the full widget and
 * layout reference.
 * ========================================================================== */
SFP.config.define('dashboard.overview', {
  grid: { columns: 12, gap: 12 },
  widgets: [

    { type: 'kpi-card', layout: { span: 3 },
      bind: { value: 'production.rate' },
      options: { icon: 'activity', accent: 'chart-1',
                 trend: { window: '24h', improves: 'up' } } },

    { type: 'kpi-card', layout: { span: 3 },
      bind: { value: 'production.efficiency' },
      options: { icon: 'gauge', accent: 'good',
                 trend: { window: '24h', improves: 'up' } } },

    { type: 'kpi-card', layout: { span: 3 },
      bind: { value: 'production.downtime' },
      options: { icon: 'clock', accent: 'alarm',
                 trend: { window: '24h', improves: 'down' } } },

    { type: 'kpi-card', layout: { span: 3 },
      bind: { value: 'energy.totalUsage' },
      options: { icon: 'zap', accent: 'warn',
                 trend: { window: '24h', improves: 'down' } } },

    { type: 'time-series', layout: { span: 8, minH: 320 },
      options: {
        title: 'Production Over Time', subtitle: 'units/hr',
        series: [{ datapoint: 'production.rate', label: 'Production', color: 'chart-1' }],
        ranges: ['8h', '24h', '7d'], defaultRange: '24h',
        height: 250, yLabel: 'units/hr',
      } },

    { type: 'donut-chart', layout: { span: 4, minH: 320 },
      options: {
        title: 'Machine Status',
        stateGroup: 'machine',
        datapointPattern: 'machines.count.{state}',
        totalDatapoint: 'machines.count.total',
        centerLabel: 'machines',
        height: 150,
      } },

    { type: 'alarm-list', layout: { span: 12 },
      options: { title: 'Recent Alerts', icon: 'alert-triangle',
                 limit: 6, showResolved: true, actions: false } },
  ],
});
