# ModuleHub — Custom Module Maker Platform (PLAN — awaiting go-ahead)

Status: **PLANNED, NOT STARTED.** This document is the execution blueprint.
Nothing in this plan has been built; do not assume any file below exists yet.

## 1. What it is

A separate platform — sibling to `SmartFactoryControlRoom` — for developing and
deploying custom interactive pipelines/apps that the config-driven dashboard
cannot express (analogy: MLHub for TrendMiner). It ships as its own CWP widget
plus an optional Windows service for shared persistence.

```
widgets/ModuleHub/                  Host shell (CWP widget)
├── src/
│   ├── core/                       Namespace MHB.*, bus, registry
│   ├── runtime/                    Module loader + sandboxed iframe runtime
│   ├── sdk/                        The Module SDK injected into modules
│   │   ├── sdk-data.js             Tag subscribe/write (bridged to OMI host)
│   │   ├── sdk-store.js            Persistent store client (REST → service, IndexedDB fallback)
│   │   ├── sdk-ui.js               Theming tokens, DOM helpers, drag/drop helpers
│   │   └── sdk-assets.js           DS650 asset model access (shared with control room)
│   ├── studio/                     In-browser module editor: manifest form,
│   │                               code editor (textarea + lint), live preview,
│   │                               version/publish flow
│   └── app.js                      OMI host protocol (same postMessage pattern)
├── modules/                        Installed modules, one folder each
│   ├── bag-filter-tracker/         DEMO 1 (see §3)
│   └── mollier-monitor/            DEMO 2 (see §4)
├── manifest.json                   OMI properties: defaultModule, storeUrl, theme, canEdit
└── index.html

services/modulehub-store/           OPTIONAL Windows service (shared persistence)
├── server.js                       Node.js + better-sqlite3, REST API, Windows service via nssm/node-windows
├── retention.js                    Self-management: ring-buffer pruning (§5)
└── install-service.ps1
```

### Module model

A "coding module" = folder with `module.json` (id, name, version, permissions:
which tags/store namespaces it may touch, entry file, min SDK version) +
`main.js` exporting `create(sdk, root)` / `destroy()`. Modules run in a
sandboxed iframe (`sandbox="allow-scripts"`); the SDK proxies all data/store
access over postMessage so a module can never reach OMI or the DB directly —
the host enforces the manifest's permission list. Deployment = zip the folder
("`.mhmod`"), import via Studio UI or drop into `modules/` and repackage CWP.

Studio supports: create-from-template, edit code with live preview against
simulation data, bump version, export `.mhmod`, publish to the module library
folder on the server.

## 2. Why a separate platform (decision record)

- Edit-mode in the control room is config-editing; arbitrary interactive apps
  need real code, lifecycle, and isolation (fail-soft per module → iframes).
- Keeps the control room's "configuration over code" promise intact.
- Same no-build, plain-JS, postMessage-to-OMI pattern already proven in
  SmartFactoryControlRoom → reuse `app.js` host protocol and theme tokens.

## 3. Demo 1 — Bag Filter Tracker (interactive app capability)

240 bag-filter frame slots laid out as a custom array map (reactor-rod style
grid, e.g. 16×15 with aisle gaps, configurable in the module's config block).

- Each frame: upper section + lower section (individually detachable) + bag
  (slides over the assembled frame). Three independently tracked parts per
  position, each with its own serial and in-use clock.
- Drag & drop: frame (or part) from grid slot → storage tray panel and back;
  bag on/off; upper/lower detach via context action. HTML5 drag or
  pointer-event drag on an absolutely-positioned grid (240 DOM nodes is fine).
- In-use time: accumulates while installed; color scale on the map
  (green→amber→red vs configurable replacement thresholds per part type) so
  worn frames/bags are visible at a glance; sortable worklist of items nearing
  replacement.
- Traceability: EVERY movement (install, remove, detach upper/lower, bag
  on/off, to/from storage, replace, repair note) writes a transaction:
  `{ ts, user, partType, partId, fromSlot, toSlot, action, note }` to the
  persistent store (§5). History view per slot and per part serial.

## 4. Demo 2 — Live Mollier Diagram (advanced graphics capability)

Canvas-2D psychrometric/Mollier chart (enthalpy–humidity, DIN-style axes) for
a closed-top creamer spray dryer:

- Static layer: isotherms, RH curves, enthalpy lines, saturation curve —
  computed from standard psychrometric formulas (Magnus/ASHRAE), drawn once
  per resize/theme.
- Live layer: subscribed tags plotted as moving state points with comet
  trails: drying air inlet/outlet (T, humidity), static fluid bed air, exhaust;
  side panel for non-air parameters: concentrate temperature, total solids %,
  spray angle, atomizer speed, chamber ΔP.
- Operational regions: configurable polygons in chart coordinates — "safe",
  "sticky/lumping risk", "alarm" — derived initially from a sticky-point curve
  (glass-transition approximation for creamer: T_outlet vs RH_outlet envelope,
  shifted by total solids). Region breach or trajectory heading into the
  sticky region within N minutes (linear extrapolation) raises the early
  warning banner + OMI tag write for alarming.
- Tag bindings declared in the module's config block; runs on simulation data
  out of the box, live when hosted (same pattern as the control room).

Rule-based early warning ships with the demo. The *predictive* model is the
MLOps track below — explicitly out of demo scope.

## 5. Persistent store + self-management

Primary: `modulehub-store` Windows service on the OMI server. Node.js +
better-sqlite3 (single file DB, zero admin), REST: `POST /tx`, `GET /tx?filter`,
`GET/PUT /kv/:ns/:key`. Installed as a Windows service; HTTP on localhost or
LAN with an API key from manifest property `storeUrl`/`storeKey`.

Self-management (reliability over completeness, per requirement):
- Configurable caps: `maxRows` (default 500k) and `maxDbMB` (default 512).
- On write, when over cap: delete oldest rows in batches (by ts) — ring
  buffer; `VACUUM` scheduled weekly off-shift; WAL mode; nightly copy-backup
  with 7-day rotation before pruning runs.
- Fallback when service unreachable: SDK buffers to IndexedDB (same ring-buffer
  policy, 50k rows) and replays to the service on reconnect, flagged
  `buffered:true`. Pure-IndexedDB mode supported for standalone demo use.

## 6. MLOps plan — lumping prediction model (orchestrator handoff)

Written as handoff packets for other models/agents to execute later. Each
packet is self-contained; run sequentially unless noted.

**Packet A — Data foundation** (data engineer agent)
Objective: historical extract from AVEVA Historian for the spray dryer:
concentrate temp, total solids, spray pressure/angle, atomizer speed, drying
air flow + inlet/outlet T/RH, static fluid bed air flow/T, chamber ΔP/ΔT,
ambient dew point. 1-minute resolution, ≥12 months. Label source: operator
logs / LIMS quality records of lumping events and rework batches; align to
timestamps ±1 batch. Deliver: parquet dataset + data dictionary + label
quality report (count, class balance). Stop if <30 labeled lumping events —
report and switch plan to anomaly-detection framing.

**Packet B — Baseline model** (ML agent)
Objective: predict lumping risk 15–60 min ahead. Features: rolling stats
(5/15/60 min) of Packet A signals + psychrometric derived features (outlet RH,
sticky-point margin = T_outlet − T_sticky(TS%), trajectory slopes). Model:
gradient boosting (LightGBM/XGBoost) binary risk + calibrated probability;
metric: PR-AUC and lead-time-at-80%-precision. Compare vs the rule-based
sticky-region baseline from §4 — must beat it to ship. Deliver: notebook,
model card, ONNX export.

**Packet C — Serving** (platform agent)
Objective: score live data on the Windows server. ONNX Runtime inside the
modulehub-store service (Node) at 1-min cadence reading live tags via a small
Historian/OMI bridge; write `dryer.lumpingRisk` + `dryer.lumpingEta` back as
tags (omi:writeTag path already exists). Mollier module subscribes and shades
its warning from the model when available, falling back to rules.

**Packet D — MLOps loop** (MLOps agent)
Retrain monthly or on drift trigger (PSI > 0.2 on key features, or precision
drop in rolling shadow eval). Pipeline: scheduled job (Windows Task Scheduler
or GitHub Actions self-hosted runner on the server) → re-extract → retrain →
eval gate (must beat champion on held-out recent window) → versioned ONNX
artifact → blue/green swap in the service → log to model registry (folder +
manifest is sufficient; MLflow optional). All predictions logged to the store
(§5) for traceability and later relabeling.

**Packet E — Validation & ops handoff**
Shadow-run ≥4 weeks vs operator-confirmed events; alarm philosophy review with
operations (alarm fatigue guard: max N warnings/shift, hysteresis); SOP doc.

## 7. Build order & estimate (when approved)

1. ModuleHub shell + SDK + runtime + studio skeleton (largest slice)
2. Store service + retention + SDK store client w/ IndexedDB fallback
3. Demo 1 bag-filter tracker
4. Demo 2 Mollier monitor (visual + rule-based warning)
5. Packaging/deploy scripts (reuse package-cwp.ps1 pattern) + docs

Rough effort: 4 waves of ≤3 subagents + Fable integration/review passes.
Comfortably executable within one 5-hour usage window starting fresh; check
`ccusage` between waves per stay-within-limits (95% stop rule).
Packets A–E in §6 are NOT part of the build — they run later, on plant data.
