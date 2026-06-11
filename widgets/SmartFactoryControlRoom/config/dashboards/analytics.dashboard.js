/* ============================================================================
 * Dashboard: Analytics — multi-day trends and comparative performance
 * ========================================================================== */
SFP.config.define('dashboard.analytics', {
  grid: { columns: 12, gap: 12 },
  widgets: [

    { type: 'time-series', layout: { span: 4, minH: 260 },
      options: {
        title: 'Production Trend', subtitle: '7-day rolling',
        series: [{ datapoint: 'production.rate', color: 'chart-1' }],
        ranges: ['24h', '7d'], defaultRange: '7d',
        height: 180, yLabel: 'units/hr',
      } },

    { type: 'time-series', layout: { span: 4, minH: 260 },
      options: {
        title: 'Energy Trend', subtitle: '7-day rolling',
        series: [{ datapoint: 'energy.totalUsage', color: 'chart-2' }],
        ranges: ['24h', '7d'], defaultRange: '7d',
        height: 180, yLabel: 'kWh',
      } },

    { type: 'time-series', layout: { span: 4, minH: 260 },
      options: {
        title: 'Efficiency Trend', subtitle: '7-day rolling',
        series: [{ datapoint: 'production.efficiency', color: 'chart-3' }],
        ranges: ['24h', '7d'], defaultRange: '7d',
        height: 180, yLabel: '%',
      } },

    { type: 'time-series', layout: { span: 6, minH: 300 },
      options: {
        title: 'Generation Mix', subtitle: 'solar vs grid, 30 days',
        series: [
          { datapoint: 'energy.solar', label: 'Solar', color: 'chart-solar' },
          { datapoint: 'energy.grid',  label: 'Grid',  color: 'chart-grid' },
        ],
        ranges: ['7d', '30d'], defaultRange: '30d',
        height: 220, yLabel: 'kW', legend: true,
      } },

    { type: 'bar-chart', layout: { span: 6, minH: 300 },
      bind: { dataset: 'analytics.downtimeByZone' },
      options: {
        title: 'Downtime by Zone', subtitle: 'this month',
        labelField: 'zone',
        series: [{ field: 'hours', label: 'Hours', colorField: 'color' }],
        horizontal: true, height: 220, yLabel: 'hours',
      } },

    { type: 'stat-list', layout: { span: 4, minH: 280 },
      options: {
        title: 'Key Performance Trends', icon: 'target',
        items: [
          { label: 'Production Rate', sublabel: 'vs start of week',
            datapoint: 'production.rate', trend: { window: '7d', improves: 'up' } },
          { label: 'Energy Efficiency', sublabel: 'output per kWh',
            datapoint: 'production.energyEfficiency' },
          { label: 'OEE Score', sublabel: 'vs start of week',
            datapoint: 'production.efficiency', trend: { window: '7d', improves: 'up' } },
          { label: 'Total Energy', sublabel: 'vs start of week',
            datapoint: 'energy.totalUsage', trend: { window: '7d', improves: 'down' } },
        ],
      } },

    { type: 'bar-chart', layout: { span: 8, minH: 280 },
      bind: { dataset: 'analytics.comparison' },
      options: {
        title: 'Performance vs Target', subtitle: 'normalized — 100% = on target',
        labelField: 'metric',
        series: [
          { field: 'today',     label: 'Today',     color: 'chart-1' },
          { field: 'yesterday', label: 'Yesterday', color: 'chart-2' },
          { field: 'target',    label: 'Target',    color: 'text-3' },
        ],
        height: 200, yLabel: '% of target', legend: true,
      } },
  ],
});
