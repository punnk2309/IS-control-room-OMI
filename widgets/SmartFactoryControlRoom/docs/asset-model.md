# Asset Model — DS650 Physical Hierarchy

The asset model gives every tag and datapoint a physical home inside the plant's
equipment hierarchy, following the **DS650** naming convention.

It is also the **single source of machine identity**: every node carrying a
`machineRef` *is* a fleet machine and supplies its id, `name`, and `machineType`.
`config/machines.config.js` no longer lists individual machines — it keeps only
machine-**class** config (metric templates + the demo state distribution). A
machine's physical **zone** is a separate concern, derived from its placement in
the twin layout (`config/twin/twin.layout.config.js`), because asset structure
and physical location are intentionally decoupled. See
[Machines: single source of identity](#machines-single-source-of-identity).

---

## DS650 Hierarchy Levels

| Level | Node      | Usage    | Code structure                          | Example    |
|-------|-----------|----------|-----------------------------------------|------------|
| 1     | Plant     | Mandatory | 4 characters (alphanumeric, uppercase) | `0017`     |
| 2     | Area      | Mandatory | 3 characters                           | `NIF`      |
| 3     | Line      | Mandatory | 3 alpha chars + 2-digit line ID        | `LIN01`    |
| 4     | Unit      | Mandatory | 3 alpha chars + 2-digit or alphanumeric unit ID | `DRY01` |
| 5     | Machine   | Mandatory | 3 alpha chars + 2-digit or alphanumeric machine ID | `EGR01` |
| 6     | Equipment | Optional  | 3 alpha chars + 4-digit or alphanumeric equipment ID | `FAN1015` |
| 7     | Component | Optional  | Exactly 10 decimal digits              | `2003445668` |

Full path notation: levels joined by dashes.
`0017-NIF-LIN01-CNC01-EGR01-SPN1001-2003445668`

---

## Validation Regexes (DS650)

```
plant:      /^[A-Z0-9]{4}$/
area:       /^[A-Z0-9]{3}$/
line:       /^[A-Z]{3}[0-9]{2}$/
unit:       /^[A-Z]{3}[A-Z0-9]{2}$/
machine:    /^[A-Z]{3}[A-Z0-9]{2}$/
equipment:  /^[A-Z]{3}[A-Z0-9]{4}$/
component:  /^[0-9]{10}$/
```

Validation is **fail-soft**: invalid codes produce a `console.warn` with the full
path but the node still loads and is queryable. This matches the platform's
general philosophy (never crash on bad config data).

---

## Config: Declaring the Tree (`config/asset-model.config.js`)

```js
SFP.config.define('asset-model', {
  code: '0017', name: 'Demo Factory – Plant 0017',
  children: [
    {
      code: 'NIF', name: 'Nozzle & Integrated Fabrication',
      tags: ['zone.assembly-a.energy'],     // datapoints whose home is this area
      children: [
        {
          code: 'LIN01', name: 'Assembly Line A',
          tags: ['production.rate', 'production.efficiency'],
          children: [
            {
              code: 'CNC01', name: 'CNC Machining Cell',
              children: [
                {
                  code: 'EGR01', name: 'CNC Mill A1',
                  machineRef: 'M-001',         // machine identity (fleet id)
                  machineType: 'CNC Mill',     // machine class/type
                  children: [
                    {
                      code: 'SPN1001', name: 'Spindle Assembly',
                      children: [
                        { code: '2003445668', name: 'Spindle Bearing – Main' },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
});
```

### Node properties

| Property     | Required | Description |
|--------------|----------|-------------|
| `code`       | Yes      | DS650 code for this level (validated against level regex) |
| `name`       | No       | Human-readable label |
| `children`   | No       | Array of child nodes (omit or `[]` for leaves) |
| `tags`       | No       | Array of datapoint ids physically located here |
| `machineRef` | No       | Fleet machine id (e.g. `M-001`). Declaring it here is what *defines* the machine as a fleet member; also enables `tagsUnder` to auto-expand all `machine.<id>.*` datapoints |
| `machineType`| No       | Machine class/type string (e.g. `CNC Mill`). Surfaced as the machine's `type` via `SFP.data.machines`; used for the twin element sublabel |

---

## Machines: single source of identity

Machines are declared **once**, here in the asset model. Any node with a
`machineRef` is a fleet machine; its `name` and `machineType` come from the same
node. `src/data/machine-registry.js` builds `SFP.data.machines` by walking this
tree for `machineRef` nodes, so the asset model is the authoritative machine
inventory.

**Identity vs. location are separate sources:**

| Concern              | Source of truth                              |
|----------------------|----------------------------------------------|
| `id`, `name`, `type` | asset model node (`machineRef`/`name`/`machineType`) |
| physical `zone`      | twin layout (`config/twin/twin.layout.config.js`) — the top-level zone whose tree contains `{ ref: '<id>' }` |
| metrics + sim class  | `config/machines.config.js` (`metrics`, `simulation.initialStates`) |

The registry returns the same object shape as before —
`{ id, name, zone, type }` — so every consumer of `SFP.data.machines`
(`list` / `get` / `byZone` / `stateOf` / `counts` / `dp`) is unchanged.

Because asset structure need not mirror physical location, a machine can sit
under one asset area while being physically placed in a different twin zone. Two
areas exist purely to home machines that have no production-line parent:
**`QUA` (Quality Control)** and **`MNT` (Maintenance)**.

> **Adding a machine:** add a node with a unique DS650 machine code, a
> `machineRef`, a `name`, and a `machineType` under the appropriate unit, then
> place `{ ref: '<id>' }` in the desired twin zone so it gets a physical `zone`.
> No edit to `machines.config.js` is needed.

---

## Config: Back-References from Datapoints (`config/tags.config.js`)

Any datapoint definition can carry an `asset:` field with the full dash-joined
path code of its physical location:

```js
SFP.config.define('datapoints', {
  'production.rate': {
    label: 'Production Rate', unit: 'units/hr', decimals: 0,
    asset: '0017-NIF-LIN01',              // ← back-reference
    source: { type: 'omi', address: 'Production.Rate' },
    sim: { type: 'wave', min: 2550, max: 3050, period: '24h', jitter: 35, phase: 4.2 },
    history: { window: '7d', interval: '10m' },
  },
  'energy.solar': {
    label: 'Solar Production', unit: 'kW', decimals: 0,
    asset: '0017-UTL-ENI01',              // ← back-reference
    source: { type: 'omi', address: 'Energy.SolarProduction' },
    sim: { type: 'wave', min: 8, max: 215, period: '24h', jitter: 6, phase: 4.4 },
    history: { window: '30d', interval: '1h' },
  },
});
```

Both directions are merged transparently by `SFP.data.assets`.

---

## API Reference (`SFP.data.assets`)

### `assets.root()`
Returns the enriched root plant node.

### `assets.node(pathCode)`
Returns the enriched node for the given dash-joined path code (case-insensitive),
or `null` if not found.

```js
var millNode = SFP.data.assets.node('0017-NIF-LIN01-CNC01-EGR01');
```

### `assets.children(pathCode)`
Returns a shallow copy of the direct child array for the node at `pathCode`,
or `[]` if not found.

### `assets.level(node)`
Returns the level name string for an enriched node object.

```js
SFP.data.assets.level(millNode);  // → 'machine'
```

### `assets.pathOf(node)`
Returns the dash-joined full path code for an enriched node object.

```js
SFP.data.assets.pathOf(millNode);  // → '0017-NIF-LIN01-CNC01-EGR01'
```

### `assets.tagsUnder(pathCode, opts)`
Returns a flat, deduplicated array of datapoint ids whose physical home is at or
beneath `pathCode`.

Sources merged (in priority order):
1. `node.tags[]` declarations in the config tree
2. `asset:` back-references in `tags.config.js`
3. `machine.<machineRef>.*` datapoints for every node carrying a `machineRef`
   (all metrics defined in `machines.config.js` metrics templates)

`opts.recursive` (default `true`): set to `false` to return only the node's own
tags without descending into children.

```js
// All datapoints in Assembly Line A, including machine metrics:
var dpIds = SFP.data.assets.tagsUnder('0017-NIF-LIN01');

// Only the datapoints directly on the area node:
var areaDps = SFP.data.assets.tagsUnder('0017-NIF', { recursive: false });
```

### `assets.assetOfTag(dpId)`
Returns the pathCode that owns a datapoint (from either direction of
declaration), or `null` if unregistered.

```js
SFP.data.assets.assetOfTag('production.rate');  // → '0017-NIF-LIN01'
```

### `assets.tree()`
Returns the complete enriched tree root node for UI consumption (e.g. rendering
a tree view widget, breadcrumb drill-downs, asset context panels).

### `assets.validate(code, level)`
Validates a single code against the DS650 regex for a given level name.

```js
SFP.data.assets.validate('FAN1015', 'equipment');  // → { valid: true, reason: null }
SFP.data.assets.validate('toolong!', 'area');      // → { valid: false, reason: '...' }
```

---

## How Widgets Use the Asset Model

### Filtering datapoints by physical location

```js
// Collect all tags under the welding area and subscribe to each:
var weldingTags = SFP.data.assets.tagsUnder('0017-WLD');
weldingTags.forEach(function (dpId) {
  SFP.data.hub.subscribe(dpId, function (sample) { /* … */ });
});
```

### Breadcrumb / drill-down navigation

```js
// Build breadcrumb from a leaf path:
var parts = '0017-NIF-LIN01-CNC01-EGR01'.split('-');
var path = '';
parts.forEach(function (code) {
  path = path ? path + '-' + code : code;
  var node = SFP.data.assets.node(path);
  console.log(node._level + ': ' + node.name);
});
```

### Grouping machine KPIs by unit

```js
// Get direct child units of Line 01:
var units = SFP.data.assets.children('0017-NIF-LIN01');
units.forEach(function (unit) {
  var tags = SFP.data.assets.tagsUnder(unit._path);
  // render a group card per unit…
});
```

---

## Load Order

The asset model adds two files to `index.html`:

- `config/asset-model.config.js` — in the **Configuration** section. Since the
  machine registry now derives its fleet from this config, it must be defined
  before `SFP.data.machines.init()` runs (all `config/*` files load before the
  data layer, so this holds automatically).
- `src/data/asset-model.js` — in the **Data layer** section, after
  `src/data/machine-registry.js`.

Initialisation is called in `src/app.js`:

```js
SFP.data.machines.init(hub);  // reads asset-model + twin.layout CONFIG directly
SFP.data.assets.init();       // ← DS650 tree built here
SFP.state.alarms.init(hub);
```

`machines.init()` runs **before** `assets.init()`, so the registry reads the
**raw config** (`SFP.config.get('asset-model')` and `'twin.layout'`) rather than
`SFP.data.assets` — making it immune to data-layer init ordering.
