# Architecture

The platform is a single CWP widget that hosts a complete multi-page
application. It is deliberately **build-free**: plain JavaScript files loaded
by `<script>` tags in a fixed order, attached to one global namespace
(`window.SFP`). This runs identically from `file://`, a static web server, or
the OMI host iframe, and requires no toolchain on engineering or OT machines.

```
┌─────────────────────────────────────────────────────────────────┐
│  CONFIG (data only — /config)                                   │
│  app · tags · machines · twin layout/flows · states · alarms ·  │
│  themes · dashboards                                            │
└──────────────┬──────────────────────────────────────────────────┘
               │ SFP.config.define(id, object)
┌──────────────▼──────────────────────────────────────────────────┐
│  PLATFORM (/src)                                                │
│                                                                 │
│  core/    namespace · config registry · event bus ·             │
│           expressions (safe condition DSL) · format · dom ·     │
│           icons                                                 │
│                                                                 │
│  data/    DataHub ──► sources: omi | rest | derived |           │
│           computed | simulation       + HistoryBuffer           │
│           machine-registry (fleet → datapoints + counts)        │
│                                                                 │
│  state/   state engine (state groups) · alarm engine (rules)    │
│                                                                 │
│  ui/      theme engine (tokens → CSS vars) · navigation (hash)  │
│           dashboard renderer (12-col grid) · app shell          │
│                                                                 │
│  twin/    model · camera · data · router · renderer · minimap · │
│           interactions · toolbar · detail panel                 │
│                                                                 │
│  widgets/ kpi-card · time-series · donut-chart · bar-chart ·    │
│           stat-list · progress-list · alarm-list · data-table · │
│           machine-grid · factory-twin · energy-flow             │
└─────────────────────────────────────────────────────────────────┘
```

## Key concepts

### Datapoints — the data abstraction

A *datapoint* is a logical id (`production.rate`, `machine.M-001.state`,
`maintenance.workorders`). Widgets subscribe to datapoints through the
**DataHub** (`src/data/data-hub.js`) and never know where values come from.
Each datapoint's definition (in `config/tags.config.js`) declares:

- `source` — live binding (OMI tag, REST endpoint, …)
- `derived` — computed from other datapoints
- `sim` — simulation profile (demo mode / marked fallback)
- `history` — retained time-series window for charts and trends

Routing per datapoint: `computed` → computed source; `derived` → derived
source; live mode → `source.type`; otherwise simulation. In live mode a
datapoint with no live binding falls back to simulation with quality
**`Simulated`**, which the UI surfaces — operators always know what's real.

Subscriptions are reference-counted: a tag is only subscribed on the OMI host
(or polled over REST) while at least one widget on screen needs it. Page
switches release subscriptions automatically.

### Configuration as `.js` files

Config files contain pure data wrapped in one call:

```js
SFP.config.define('dashboard.overview', { ... });
```

The `.js` wrapper (instead of `.json`) is deliberate: it loads via `<script>`
(works from `file://` and inside OMI without fetch/CORS), supports comments,
and fails loudly on syntax errors at load time. A later `define` with the same
id replaces the earlier one, so site-specific override files can simply be
appended after the defaults in `index.html`.

### Factory digital twin

The Factory Map page is a single `factory-twin` widget backed by the
`src/twin/` subsystem. Site geometry lives in `config/twin/twin.layout.config.js`;
flow overlays and twin-only datapoints live in
`config/twin/twin.connections.config.js`; camera, LOD, filter and utility-layer
behavior lives in `config/twin/twin.config.js`.

The twin renders a pannable/zoomable canvas with zones, subzones, machines,
utility connections, a minimap, search, filters and a detail panel. Zone
selection still emits `map:zoneSelected` so other widgets can react, and
detail-panel actions navigate to related dashboards such as
`#/machines?zone=welding`.

### Event bus

Modules and widgets communicate through `SFP.bus` (`src/core/event-bus.js`).
Well-known events are listed in that file's header. This is what lets the
factory twin select a zone and other widgets react without either knowing
about the other.

### Widget contract

A widget type is registered once and instantiated from dashboard config any
number of times. It receives a context (`ctx`) with the container element, its
options/bindings, auto-released subscriptions, and accessors for the hub,
state engine, alarms, machines, theme, navigation and helpers. See
[creating-widgets.md](creating-widgets.md).

### Lifecycle

1. `index.html` loads vendor → core → data → state → ui → widgets → **config**
   → `src/app.js`.
2. `app.js` detects the runtime. Standalone → simulation immediately. Hosted →
   `omi:ready` is posted and the app waits up to 2.5 s for `omi:init`
   (properties); if it never arrives, it starts in badged simulation.
3. Sources are registered, datapoints defined, the machine registry expands
   the fleet into datapoints, the alarm engine binds its rules.
4. The theme is applied (tokens → CSS variables), the shell renders, and
   navigation activates the default page.
5. The dashboard renderer instantiates the page's widgets; each widget
   subscribes to its datapoints; data begins to flow.
6. On page change the old dashboard handle is destroyed — widgets and all
   their subscriptions are released.

### OMI host protocol

All host communication is `window.postMessage` (see `src/app.js` and
`src/data/sources/omi-source.js`):

| Direction | Message | Handled by |
|---|---|---|
| host → widget | `omi:init` (properties) | app.js bootstrap |
| host → widget | `omi:tagValue` | omi-source → DataHub |
| host → widget | `omi:propertyChanged` | app.js (theme, title, mode, prefix, page) |
| host → widget | `omi:resize` | app.js → `app:resize` bus → charts |
| host → widget | `omi:modeChanged` | ignored (design mode keeps rendering) |
| widget → host | `omi:ready`, `omi:subscribe`, `omi:unsubscribe` | bootstrap / omi-source |
| widget → host | `omi:alarm` | alarm engine (forwarded on raise) |
| widget → host | `omi:writeTag` | available via `SFP.data.omiSource.writeTag()` |

## Deliberate trade-offs

- **No bundler / framework** — long-horizon maintainability beats developer
  convenience here. Any engineer with a text editor can maintain this in 10
  years; there is no dependency rot. The cost (manual script order in
  `index.html`) is documented and small.
- **One widget = whole app** — matches how the original template and the OMI
  pane model are used on site. The architecture still allows packaging any
  subset of dashboards as a separate widget later (config is per-dashboard).
- **Chart.js as the only vendor dependency** — vendored locally, no CDN, works
  offline on OT networks.
- **`color-mix()` in CSS** — requires a Chromium ≥ 111 webview (OMI 2023+ /
  current WebView2). If you must target older webviews, replace `color-mix`
  usages in the two stylesheets with static rgba values.
