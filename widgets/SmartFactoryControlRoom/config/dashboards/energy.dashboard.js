/* ============================================================================
 * Dashboard: Energy — consumption, generation mix and energy events
 * ========================================================================== */
SFP.config.define('dashboard.energy', {
  grid: { columns: 12, gap: 12 },
  widgets: [

    { type: 'kpi-card', layout: { span: 4 },
      bind: { value: 'energy.totalUsage' },
      options: { icon: 'zap', accent: 'chart-1',
                 trend: { window: '24h', improves: 'down' } } },

    { type: 'kpi-card', layout: { span: 4 },
      bind: { value: 'energy.peak' },
      options: { icon: 'trending-up', accent: 'warn',
                 trend: { window: '24h', improves: 'down' } } },

    { type: 'kpi-card', layout: { span: 4 },
      bind: { value: 'energy.cost24h' },
      options: { icon: 'dollar', accent: 'good', decimals: 0 } },

    { type: 'time-series', layout: { span: 8, minH: 330 },
      options: {
        title: 'Real-time Energy Consumption', subtitle: 'site power draw',
        series: [{ datapoint: 'energy.consumption', label: 'Consumption', color: 'chart-2' }],
        ranges: ['1h', '8h', '24h'], defaultRange: '8h',
        height: 260, yLabel: 'kW', live: true,
      } },

    { type: 'alarm-list', layout: { span: 4, minH: 330 },
      options: { title: 'Abnormal Events', icon: 'alert-triangle',
                 category: 'energy', limit: 5, compact: true,
                 showResolved: true, actions: false } },

    { type: 'energy-flow', layout: { span: 8, minH: 290 },
      options: {
        title: 'Energy Management', subtitle: 'real-time energy flow',
        sources: [
          { id: 'solar', label: 'Solar', icon: 'sun', color: 'chart-solar',
            datapoint: 'energy.solar', unit: 'kW' },
          { id: 'battery', label: 'Battery', icon: 'battery', color: 'chart-battery',
            datapoint: 'energy.batteryOutput', unit: 'kW',
            secondary: { datapoint: 'energy.batteryKwh', unit: 'kWh stored' } },
          { id: 'grid', label: 'Grid', icon: 'plug', color: 'chart-grid',
            datapoint: 'energy.grid', unit: 'kW' },
        ],
        sink: { label: 'Consumption', icon: 'trending-up', color: 'accent',
                datapoint: 'energy.consumption', unit: 'kW' },
      } },

    { type: 'progress-list', layout: { span: 4, minH: 290 },
      options: {
        title: 'Source Shares', icon: 'gauge',
        items: [
          { label: 'Solar Share',    datapoint: 'energy.solarShare',   color: 'chart-solar' },
          { label: 'Battery Charge', datapoint: 'energy.batteryLevel', color: 'chart-battery' },
          { label: 'Grid Share',     datapoint: 'energy.gridShare',    color: 'chart-grid' },
        ],
      } },

    { type: 'bar-chart', layout: { span: 12, minH: 300 },
      options: {
        title: 'Energy by Zone', subtitle: 'colored by consumption band',
        items: [
          { label: 'Assembly A', datapoint: 'zone.assembly-a.energy', target: 250 },
          { label: 'Assembly B', datapoint: 'zone.assembly-b.energy', target: 235 },
          { label: 'Welding',    datapoint: 'zone.welding.energy',    target: 200 },
          { label: 'Paint Shop', datapoint: 'zone.paint.energy',      target: 150 },
          { label: 'Quality',    datapoint: 'zone.quality.energy',    target: 100 },
          { label: 'Maintenance',datapoint: 'zone.maintenance-bay.energy', target: 90 },
          { label: 'Warehouse',  datapoint: 'zone.warehouse.energy',  target: 80 },
          { label: 'Shipping',   datapoint: 'zone.shipping.energy',   target: 60 },
          { label: 'Office',     datapoint: 'zone.office.energy',     target: 45 },
        ],
        colorByState: 'zone-energy',
        height: 230, yLabel: 'kWh', legend: true,
      } },
  ],
});
