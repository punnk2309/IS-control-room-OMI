# Restructure Plan — asset/machine merge, factory-map palette, bag-filter module

Date: 2026-06-14. Sequenced by risk: safe/independent first, architectural merge last.

## Decisions (defaults chosen; flagged where a fork exists)

### A. Bag-filter image-matching module (independent, low risk)
- Build a NEW module `bag-filter-grid` (do not replace `bag-filter-tracker`).
- Layout = square lattice clipped to a circle (cells whose center is inside the
  inscribed circle), each a NUMBERED square cell, matching the attached image.
- Status colors: green = in-use (`good`), blue = duplicate frame number
  (`accent`/`info`). Fouling overlay mode: levels 1–3 cream→brown (legend shown).
- Labels around the circle: "Outlet Duct of Chamber" (top-left), "Exhaust Fan"
  (right), "Ladder" (bottom). Two legends (status top-right, fouling bottom-right).
- Uses only the §6 SDK surface; auto-seeds simulated data; persists via in-memory
  store when no service. Add to `modules/index.json` + the sync script list, then
  `scripts/sync-module-bundles.ps1` so it shows in the control-room switcher.
- Verify Studio "Run preview" + "Export .mhmod" in a real browser (research says
  they work and read live form values; user's report is likely browser cache).

### B. Factory-map (twin) edit palette — `src/twin/twin-editor.js`
- PRESETS array (twin-editor.js:55-67) regrouped into two labeled groups:
  - VISUAL (location): Zone, Polygon zone, Subzone, Polygon subzone (NEW),
    Circle (NEW), Pill (NEW), External node.
  - ASSET (per asset structure): Area, Line, Machine, Unit/Equipment...
    placing an Asset item creates a node at the matching asset level.
- Remove redundant equipment presets (tank/pump/conveyor/boiler/ahu/round) —
  user can rename/reshape; replaced by generic Circle + Pill visual tools.
- Circle/Pill are visual shapes like polygon zone (free customizable), not tied
  to a machine. Polygon subzone = polygon draw that pushes into a zone's subzone
  list (new `kind:'poly-subzone'` branch in `_placeStamp`/`_closePolygon`).
- Renderer: `twin-renderer.js` subzone draw gains shape variants (rect/circle/pill/poly).

### C. Floors add/delete in edit mode — `src/twin/twin-editor.js` + `twin-panels.js`
- In the edit property panel, when a Zone or Subzone is selected, show
  "+ Add floor" and "× Delete floor" controls. Add pushes
  `{ id:'f'+ts, label:'New floor', subzones:[] }` (zone) or `{...,machines:[]}`
  (subzone) into `node.floors` (creating the array if absent). Delete splices the
  active floor. Persist via existing `_writeBack`/`_save` (override + export).

### D. Machine config → asset model merge (HIGHEST RISK — last) 
Principle (from user): zones/subzones/floors are PHYSICAL location (twin) and
have NO correlation with the asset structure. So machine `zone` is a physical
attribute sourced from the twin layout, NOT the asset model.

Approach (preserve the `SFP.data.machines` API so all ~14 consumers are untouched):
- Asset model becomes the single source of machine IDENTITY: each machine-level
  asset node carries `machineRef` (= id e.g. `M-001`), `name`, and a new
  `machineType` field. Ensure ALL machines that the twin/grid/alarms reference
  exist as asset nodes (add the ~18 currently-orphaned ones at sensible levels).
- `config/machines.config.js` slims to machine-CLASS config only: `metrics`
  templates + `simulation.initialStates`. It no longer lists individual machines.
- `src/data/machine-registry.js` `init()` rebuilds the machine list by walking the
  asset model for `machineRef` nodes (id/name/machineType), deriving `zone` by
  scanning `twin.layout` for `{ref:id}` placement (physical). Public API
  (`list/get/byZone/stateOf/counts/dp`) and returned object shape `{id,name,zone,type}`
  stay identical → consumers unchanged.
- `src/data/asset-model.js` `collectTags` continues to expand `machineRef` via the
  metrics templates (now still in slim machines.config).
- Validate in browser: machine-grid, factory-twin, machines dashboard, alarms all
  still populate.

## Wave order
- Wave A: C-module (bag-filter-grid) + Studio verify. [independent]
- Wave B: palette regroup + new shape tools + floor CRUD. [twin-editor]
- Wave C: machine↔asset merge. [architectural, review-heavy]
- Final: integrated browser verification.

## Decisions locked (2026-06-14)
- Asset-palette items (B): VISUAL TAG ONLY — placing an Asset item creates a
  twin element carrying an `assetLevel` string; NO write into the asset model
  yet. Linking comes with Wave C later.
- Wave C (machine↔asset merge): **DONE (2026-06-15)** — executed per the plan
  below, asset model as the SINGLE SOURCE. Asset model now homes all 55 machines
  (17 orphans added, incl. new `QUA`/`MNT` areas) each with `machineRef` +
  `machineType`; `machine-registry.init()` derives the fleet from the asset model
  and `zone` from the twin layout; `machines.config.js` slimmed to metrics +
  simulation. Public `SFP.data.machines` API + `{id,name,zone,type}` shape
  preserved; derived list verified == original 55 with identical zones.

## Wave C — deferred careful plan (execute later, asset model = single source)
Goal: machines defined once, inside the asset model; `SFP.data.machines` API
unchanged so the ~14 consumers don't break. Steps, in safe order:
1. Inventory: list all 55 machine ids and which are missing from the asset model
   (~18). Decide each orphan's parent area/line node (office/warehouse/shipping
   machines may need new area nodes). Capture as a mapping table FIRST.
2. Extend asset node shape with `machineType` (and keep `machineRef`=id). Add the
   18 orphan machines as machine-level nodes. Keep `metrics` templates +
   `simulation.initialStates` in a slimmed machines.config (machine-CLASS config).
3. Rewrite `machine-registry.init()` to build the list by walking the asset model
   for `machineRef` nodes → `{id, name, type}`; derive physical `zone` by scanning
   `twin.layout` for `{ref:id}` placement (zone stays physical, per principle).
   PRESERVE the public API + returned object shape `{id,name,zone,type}`.
4. Keep `asset-model.js collectTags` expanding `machineRef` via metrics templates.
5. Remove the per-machine list from machines.config + its index.html effect only
   after registry derivation is proven.
6. Verify in browser: machine-grid, factory-twin, machines dashboard, alarms all
   still populate identically. Diff machine list before/after (must match 55).
Risk: 6 core files; do behind the stable API; verify each consumer.
