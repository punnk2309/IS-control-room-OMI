# IS-control-room-OMI

A configuration-driven **smart factory control room platform** for AVEVA OMI,
packaged and deployed as a CWP custom widget.

The platform ships with a complete first application — *Factory Operations
Management* (Overview, Energy, Machines, Factory Map, Maintenance, Analytics) —
but the dashboards are **data, not code**: pages, widgets, tag mappings,
machines, factory twin layout, state logic, alarm rules and themes all live in
human-readable config files. Future dashboards and sites are built by editing
config, not the framework.

## Repository map

```
widgets/SmartFactoryControlRoom/    The platform + the shipped application
│
├── config/                         ← EVERYTHING SITE ENGINEERS EDIT
│   ├── app.config.js               App title, navigation pages, data behaviour
│   ├── tags.config.js              Datapoint definitions + source bindings (the tag map)
│   ├── machines.config.js          Machine fleet + per-machine metric templates
│   ├── twin/                       Factory map geometry, flows and twin behavior
│   ├── states.config.js            State groups: machine states, energy bands, risk bands
│   ├── alarm-rules.config.js       Declarative alarm rules
│   ├── theme.dark.config.js        Theme tokens (dark)
│   ├── theme.light.config.js       Theme tokens (light)
│   └── dashboards/*.dashboard.js   One file per dashboard page
│
├── src/                            Platform framework (rarely changes)
│   ├── core/                       Namespace, config registry, bus, expressions, icons…
│   ├── data/                       DataHub + sources (OMI, REST, derived, computed, simulation)
│   ├── state/                      State engine + alarm engine
│   ├── ui/                         Theme engine, navigation, dashboard renderer, app shell
│   ├── widgets/                    Widget library (12 reusable widget types)
│   └── app.js                      Bootstrap + OMI host protocol
│
├── styles/                         base.css (shell) + widgets.css (widget styles)
├── vendor/chart.umd.min.js         Chart.js (only external dependency)
├── manifest.json                   OMI widget manifest (properties panel)
└── index.html                      Script loading order — add new files here

scripts/
├── package-cwp.ps1                 Package one widget into dist/*.cwp
├── deploy-all.ps1                  Package all widgets + copy to the OMI widget library
└── dev-server.ps1                  Local static server for development

docs/                               Platform documentation (start at architecture.md)
FableContext/                       Design references (Figma screenshots)
```

## Quick start

**Run locally (no tooling needed):** open
`widgets/SmartFactoryControlRoom/index.html` in a browser — the platform
detects there is no OMI host and runs in clearly-badged **SIMULATION** mode
with realistic demo data. Optional dev server:

```powershell
.\scripts\dev-server.ps1            # http://localhost:8080
```

URL overrides for development: `?theme=light`, `?mode=live`, and deep links
like `#/machines?zone=welding`.

**Package + deploy:**

```powershell
.\scripts\package-cwp.ps1 -WidgetName SmartFactoryControlRoom   # -> dist/*.cwp
.\scripts\deploy-all.ps1                                        # -> OMI widget library
```

Import the `.cwp` into OMI, drop the widget on a 1920×1080 pane, and configure
it from the Properties panel (title, theme, default page, data mode, tag
prefix). See [docs/deployment.md](docs/deployment.md).

## Common tasks → where to go

| I want to… | Edit / read |
|---|---|
| Add or change a dashboard page | `config/dashboards/`, `config/app.config.js` — [docs/creating-dashboards.md](docs/creating-dashboards.md) |
| Map widgets to different OMI tags | `config/tags.config.js` — [docs/data-sources.md](docs/data-sources.md) |
| Add a machine | one line in `config/machines.config.js` |
| Move/resize/add factory map zones | `config/twin/twin.layout.config.js` — [docs/factory-map.md](docs/factory-map.md) |
| Change alarm thresholds | `config/alarm-rules.config.js` — [docs/state-and-alarms.md](docs/state-and-alarms.md) |
| Change state colors / energy bands | `config/states.config.js` + theme files |
| Add a data source (MES, SAP, SQL, Historian) | [docs/data-sources.md](docs/data-sources.md) |
| Build a new widget type | `src/widgets/` — [docs/creating-widgets.md](docs/creating-widgets.md) |
| Restyle / add a theme | `config/theme.*.config.js` — [docs/theming.md](docs/theming.md) |
| Understand the architecture | [docs/architecture.md](docs/architecture.md) |
| Deploy / scale to 10k+ tags | [docs/deployment.md](docs/deployment.md) |

## Design principles

- **Configuration over code**: behaviour changes are config edits; framework
  code changes are rare and reviewed.
- **No build toolchain**: plain script files run from `file://`, a static
  server, or the OMI host. Nothing to install on an OT network; the packaging
  step is a zip.
- **Widgets never know where data comes from**: they bind to logical
  datapoint ids; the data hub routes to OMI tags, REST endpoints, derived
  calculations or simulation per datapoint.
- **Honest data**: simulation and fallback data are always visibly badged;
  data quality (`Good/Uncertain/Bad/Simulated`) is surfaced in the UI.
- **Fail soft**: a broken widget renders an error card; it never takes down
  the dashboard.
