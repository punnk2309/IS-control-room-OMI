# Factory Map Digital Twin

The Factory Map page is a configurable digital twin, not a hand-coded drawing.
The dashboard hosts one `factory-twin` widget; the widget assembles the
`src/twin/` engine and reads all site-specific content from `config/twin/*`.

## Config Files

| File | Purpose |
|---|---|
| `config/twin/twin.config.js` | Camera bounds, zoom/LOD thresholds, grid, utility layers, filters, minimap and auto-layout defaults |
| `config/twin/twin.layout.config.js` | World size, zones, floors, subzones, machine placement and twin-only equipment |
| `config/twin/twin.connections.config.js` | Utility/product flow connections plus twin-only datapoints used by those flows |

The page itself is composed in `config/dashboards/factory-map.dashboard.js`:

```js
SFP.config.define('dashboard.factory-map', {
  grid: { columns: 12, gap: 12 },
  widgets: [
    { type: 'factory-twin', layout: { span: 12, minH: 640 }, options: {} },
  ],
});
```

## Spatial Layout

The layout uses world coordinates. A zone owns a `rect`, may contain floors,
subzones and machines, and can bind its status/value to datapoints:

```js
{ id: 'welding', label: 'Welding Station',
  rect: { x: 340, y: 60, w: 220, h: 170 },
  statusBinding: 'zone.welding.energy',
  hint: 'Reduce energy by ~12% through load balancing...',
  subzones: [
    { id: 'cells', label: 'Robot Cells',
      rect: { x: 360, y: 96, w: 120, h: 92 },
      machines: ['M-017', 'M-018', 'M-019'] },
  ] }
```

To move a zone, subzone or machine, edit its `rect`. If a machine is listed
without a `rect`, the model auto-places it inside the subzone using the
settings in `twin.config.js`. Machine ids come from `config/machines.config.js`;
their `zone` field should match a zone id in the twin layout so the Machines
dashboard can share the same zone filters.

## Connections

Connections can link zones, subzones or machines:

```js
{ id: 'prod-welding-paint',
  label: 'Welding -> Paint',
  utility: 'product',
  from: { ref: 'zone:welding', anchor: { side: 'right' } },
  to: { ref: 'zone:paint', anchor: { side: 'left' } },
  binding: 'twin.flow.prod.wp',
  unit: 'units/h',
  flowRange: [0, 260] }
```

Endpoint refs use:

- `zone:<zoneId>`
- `subzone:<zoneId>/<subzoneId>`
- `machine:<machineId>`

Optional waypoints steer routes. At low zoom the renderer aggregates links to
their visible ancestors; at higher zoom it reveals subzones, machines, value
badges and connection annotations according to the LOD thresholds in
`twin.config.js`.

## Data And Wiring Status

Twin-only datapoints are declared under `datapoints` in
`twin.connections.config.js` and are merged into the DataHub during startup.
A datapoint with only `sim` data works in simulation mode and is marked as
unwired in live mode until a `source` binding is added.

The toolbar's mode and coverage chips expose this honestly:

- `SIMULATION` when the app is running simulated data.
- `LIVE` when OMI/live routing is active.
- Coverage/wiring details in the detail panel, including connection-level
  `SIM`, `LIVE`, `WAITING` and `UNWIRED` chips.

## Theme Tokens

The canvas, labels, zones and utility flows read theme tokens only. Add a new
utility layer by adding matching tokens in both theme files and one utility
entry in `twin.config.js`:

```js
{ id: 'hydraulic', label: 'Hydraulic', color: 'util-hydraulic' }
```

Then use `utility: 'hydraulic'` on connections. No renderer changes are needed.

## Interaction And Navigation

Users can pan, zoom, search, filter utility layers, toggle the minimap and
select elements. Selecting a zone opens the detail panel, emits
`map:zoneSelected`, and offers dashboard actions such as:

```js
navigate: { page: 'machines', params: { zone: 'welding' } }
```

Deep links also work: `#/factory-map?zone=welding` opens the factory map with
that zone selected and framed.

## Extending The Twin

- Add a zone or subzone in `twin.layout.config.js`.
- Add a machine in `machines.config.js`, then place or list it in the twin
  layout.
- Add utility/product flows in `twin.connections.config.js`.
- Tune zoom behavior, grid density, minimap size, auto-layout and filters in
  `twin.config.js`.
- Add live bindings by adding `source` definitions to the twin datapoints or
  by moving commonly reused points into `tags.config.js`.

## Editing Visually (no code)

The pencil button in the header (top right) opens **edit mode** on this page:
drag elements to move them, use the handles to resize, stamp preset shapes
from the left palette (zones, subzones, machines, tanks, conveyors, external
nodes), and draw non-rectangular zone outlines with the CAD-style polygon
tool (right-click a zone → "Edit shape"). Edits persist as config overrides
and can be exported as ready-to-commit `.config.js` files. Full design:
[visual-config-editor.md](visual-config-editor.md).
