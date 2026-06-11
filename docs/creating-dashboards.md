# Creating dashboards

A dashboard is one config file in `config/dashboards/`. No framework code is
involved in adding, changing or removing dashboards.

## Add a new page in three steps

1. **Create the dashboard definition** — `config/dashboards/quality.dashboard.js`:

```js
SFP.config.define('dashboard.quality', {
  grid: { columns: 12, gap: 12 },
  widgets: [
    { type: 'kpi-card', layout: { span: 4 },
      bind: { value: 'production.efficiency' },
      options: { icon: 'check-circle', accent: 'good' } },
    // …
  ],
});
```

2. **Load it** — add a `<script>` tag in `index.html` next to the other
   dashboards.

3. **Add it to navigation** — in `config/app.config.js`:

```js
pages: [
  // …
  { id: 'quality', label: 'Quality', icon: 'check-circle', dashboard: 'quality' },
]
```

## Layout

Dashboards are a 12-column CSS grid (configurable via `grid.columns`). Each
widget instance takes a `layout`:

| Field | Meaning |
|---|---|
| `span` | columns to span (1–12) |
| `col`  | optional start column — use to pin side panels (e.g. `col: 9`) |
| `rows` | optional grid-row span for tall widgets next to stacked ones |
| `minH` | minimum height in px |

Below 1100 px width every widget collapses to full width automatically.

## Widget reference

Every widget instance is `{ type, layout, bind, options }`. `bind` holds
datapoint ids; `options` holds presentation. Common conventions:

- Labels/units/decimals default to the bound datapoint's definition; override
  per instance via options.
- All colors are theme tokens (`'accent'`, `'chart-1'`, `'state-running'`, …)
  or literal hex.
- `trend: { window: '24h', improves: 'up' | 'down' }` renders a % change chip
  computed from the datapoint's history (requires `history` on the datapoint).

### kpi-card
```js
{ type: 'kpi-card', layout: { span: 3 },
  bind: { value: 'production.rate' },
  options: { icon: 'activity', accent: 'chart-1', label: '…', unit: '…',
             decimals: 0, valueColor: 'state-running',
             trend: { window: '24h', improves: 'up' } } }
```
Shows a quality chip (SIMULATED/BAD/…) automatically when quality ≠ Good.

### time-series
```js
{ type: 'time-series', layout: { span: 8 },
  options: { title: '…', subtitle: '…',
    series: [{ datapoint: 'energy.consumption', label: 'kW', color: 'chart-2',
               fill: true, dashed: false }],
    ranges: ['1h', '8h', '24h'], defaultRange: '8h',
    height: 240, yLabel: 'kW', beginAtZero: false, legend: false, live: true } }
```
Depth comes from the datapoint's `history` config; ranges only filter it.

### donut-chart
Two styles — explicit `options.segments: [{ datapoint, label, color }]`, or a
state group (segments/colors from `states.config.js`):
```js
options: { stateGroup: 'machine', datapointPattern: 'machines.count.{state}',
           totalDatapoint: 'machines.count.total', centerLabel: 'machines' }
```

### bar-chart
Style 1 — one bar per configured item (optional `target` second series,
optional `colorByState` to band-color bars):
```js
options: { items: [{ label: 'Welding', datapoint: 'zone.welding.energy', target: 200 }],
           colorByState: 'zone-energy', yLabel: 'kWh', legend: true }
```
Style 2 — rows from a dataset datapoint:
```js
bind: { dataset: 'analytics.comparison' },
options: { labelField: 'metric',
           series: [{ field: 'today', label: 'Today', color: 'chart-1' },
                    { field: 'hours', colorField: 'color' }],   // per-row colors
           horizontal: true }
```

### stat-list
```js
options: { items: [{ label: 'OEE', sublabel: 'vs last week',
                     datapoint: 'production.efficiency',
                     trend: { window: '7d', improves: 'up' } }] }
```

### progress-list
Items style: `items: [{ label, datapoint, color }]` (0–100 values, `max`
configurable). Dataset style (e.g. predictive maintenance):
```js
bind: { dataset: 'maintenance.predictions' },
options: { dataset: { label: '{asset} — {component}',
                      sublabel: 'Est. {daysToFailure} days to failure',
                      value: 'riskPct', tail: '{action}', colorRules: 'risk' } }
```

### alarm-list
```js
options: { title: 'Active Alerts', category: 'energy',   // omit for all
           limit: 8, showResolved: true, actions: true, compact: false }
```
`actions: true` adds Ack/Resolve buttons (operator actions, local to the
session).

### data-table
```js
bind: { dataset: 'maintenance.workorders' },
options: { columns: [
             { field: 'asset', label: 'Asset' },
             { field: 'priority', label: 'Priority',
               chip: { High: 'sev-high', Medium: 'sev-medium', Low: 'sev-low' } },
             { field: 'due', label: 'Due', color: { Overdue: 'alarm' } } ],
           sort: { field: 'due', dir: 'asc' }, limit: 50 }
```
Headers are click-to-sort.

### machine-grid
```js
options: { mode: 'detailed' | 'compact', pageSize: 9,
           metrics: ['temperature', 'load', 'runtime'], showFilters: true }
```
Reads navigation params (`#/machines?zone=welding&state=error`). Only the
machines on the visible page hold datapoint subscriptions — safe for large
fleets.

### factory-map / zone-details
See [factory-map.md](factory-map.md).

### energy-flow
```js
options: { sources: [{ id, label, icon, color, datapoint, unit,
                       secondary: { datapoint, unit } }],
           sink: { label, icon, color, datapoint, unit } }
```
Add a source (e.g. wind) by adding an entry — connectors and shares adapt.

## Cross-dashboard navigation

Widgets can navigate with parameters (used by zone-details quick actions):

```js
navigate: { page: 'machines', params: { zone: '{zone}' } }
```

Anything in `params` arrives as `ctx.params` in the target page's widgets.
