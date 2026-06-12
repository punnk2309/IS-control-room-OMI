# Widget: `gantt-chart`

A canvas-based horizontal-bar timeline showing the discrete value of one or
more datapoints over time — one row per tag — with rows grouped under the DS650
asset hierarchy.

---

## Options reference

| Option        | Type                          | Default          | Description |
|---------------|-------------------------------|------------------|-------------|
| `title`       | string                        | `'Gantt'`        | Card title. |
| `subtitle`    | string                        | —                | Optional subtitle. |
| `icon`        | string                        | `'layout'`       | Icon token. |
| `asset`       | string                        | —                | DS650 path code (e.g. `'0017-NIF-LIN01'`). Rows are auto-populated from `SFP.data.assets.tagsUnder(asset, {recursive:true})`. Group headers follow the asset node hierarchy. Tags with no registered asset are placed under an **Ungrouped** header. Mutually exclusive with `rows`. |
| `rows`        | `{datapoint, label}[]`        | —                | Explicit row list. Each entry is `{ datapoint: 'machine.M-001.state', label: 'CNC Mill A1' }`. The widget still groups rows under asset nodes when `assetOfTag` returns a path; otherwise rows are rendered flat. |
| `window`      | number (seconds)              | `3600`           | Visible time window. The canvas scrolls automatically — the right edge is always *now*. |
| `colorMap`    | object                        | hash palette     | Maps values to colors. Three supported entry forms:<br>• **exact** — `{ 'running': '#22c55e' }`<br>• **numeric range** — `{ '0-50': '#f59e0b' }`<br>• **fallback** — `{ '*': '#94a3b8' }`<br>Ranges are matched inclusively (`lo ≤ value ≤ hi`). |
| `stateGroup`  | string                        | —                | Name of a `states.config.js` group (e.g. `'machine'`). Automatically derives `value → color` from the group's state colors. Also respects `valueMap` integer codes. Takes precedence over `colorMap` when both are set. |
| `rowHeight`   | number (px)                   | `22`             | Height of each data row. Group-header rows use a fixed 18 px. |
| `maxRows`     | number                        | `30`             | Maximum number of **data rows** rendered. When the asset/rows list is larger, the excess is reported as a `+N more` note at the bottom. |

> **Note:** `bind` is not used by this widget — all data binding is driven by
> `options.asset` or `options.rows`.

---

## Rendering

### Layout

```
┌─────────────────────────────────────────────────────┐
│  ● running  ● idle  ● maintenance  ● error   legend  │
├──────────────┬──────────────────────────────────────┤
│ Group header │  (full-width background stripe)       │
│   tag label  │ ████████░░░░░██████░░░░░░░░░░████████ │
│   tag label  │ ░░░████░░░░░░░░░░░█████░░░░░░░░░░░░░░ │
│ Sub-header   │                                       │
│   tag label  │ ████░░░░░░░████████████░░░░░░░░░░░░░░ │
├──────────────┴──────────────────────────────────────┤
│              │ 09:00   09:15   09:30   09:45  10:00  │
└─────────────────────────────────────────────────────┘
```

- **Left gutter (160 px):** group/tag labels, truncated with `…` when needed.
- **Timeline area:** contiguous color bars, one per distinct value run.
- **Time axis (22 px):** ticks at sensible intervals (1 s → 1 day), auto-scaled
  to available width.
- **Legend (28 px):** color chip + value label for every color in use.

### Segments

Consecutive samples sharing the same discretised value are merged into one bar.
For example three consecutive `state = 'running'` samples become a single green
bar spanning from the first sample's timestamp to the last.

### Quality

Samples with `quality === 'Bad'` render as a hatched dim-gray bar regardless of
value, making data-quality problems immediately visible.

### Live update

The widget subscribes to every row's datapoint. Incoming samples are appended to
a per-row ring buffer (max 2000 entries). Redraws are coalesced to at most ~1 fps
to keep CPU usage low. An independent 1 s timer keeps the sliding window moving
even when no new data arrives.

### History seed

At startup the widget calls `ctx.hub.history(dp, windowMs * 4)` for each row
to seed the ring buffer from the hub's in-memory `HistoryBuffer`. This means
the chart is pre-populated on first render (no blank period while waiting for
live samples).

---

## Config examples

### Asset-driven (machine state timeline)

```js
{
  type: 'gantt-chart',
  layout: { span: 12, minH: 280 },
  options: {
    title: 'Assembly Line A — Machine States',
    subtitle: 'Live state timeline · 1 h window',
    icon: 'layout',
    asset: '0017-NIF-LIN01',
    window: 3600,
    stateGroup: 'machine',
    rowHeight: 24,
    maxRows: 30,
  },
}
```

Rows are auto-populated from every tag under `0017-NIF-LIN01` (recursive),
including all `machine.<id>.state` tags via the `machineRef` expansion in
`asset-model.js`. Colors come directly from `states.config.js`'s `machine`
group.

---

### Explicit rows with colorMap

```js
{
  type: 'gantt-chart',
  layout: { span: 8, minH: 220 },
  options: {
    title: 'Press Line — Load Bands',
    window: 1800,
    rows: [
      { datapoint: 'machine.M-003.load', label: 'Press C3 Load' },
      { datapoint: 'machine.M-005.load', label: 'Grinder E5 Load' },
      { datapoint: 'machine.M-004.load', label: 'Welder D4 Load' },
    ],
    colorMap: {
      '0-20':  '#94a3b8',
      '21-60': '#22c55e',
      '61-85': '#f59e0b',
      '86-100': '#ef4444',
      '*': '#64748b',
    },
    rowHeight: 28,
  },
}
```

Numeric load values are binned into four color bands. The fallback `'*'` catches
any value outside the defined ranges.
