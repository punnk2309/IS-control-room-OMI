# Deployment & operations

## Local development

No toolchain required. Either open
`widgets/SmartFactoryControlRoom/index.html` directly in a browser, or run:

```powershell
.\scripts\dev-server.ps1                  # serves the repo at http://localhost:8080
```

Standalone runs in **SIMULATION** mode (amber badge) with realistic demo data,
backfilled history, and intermittent alarms. Dev URL switches:

- `#/energy`, `#/machines?zone=welding&state=error` — deep links
- `?theme=light` — theme override
- `?mode=live` — force live routing (unbound points show as Simulated)

## Packaging (CWP)

```powershell
.\scripts\package-cwp.ps1 -WidgetName SmartFactoryControlRoom
```

Produces `dist/SmartFactoryControlRoom-v<version>.cwp` (a zip of the widget
folder; version read from `manifest.json` — bump it there for each release).

```powershell
.\scripts\deploy-all.ps1 [-OmiWidgetDir "C:\path\to\CustomWidgets"]
```

packages every widget under `widgets/` and copies the `.cwp` files to the OMI
custom-widget library (default `%ProgramData%\AVEVA\OMI\CustomWidgets`).

## OMI configuration

Import the CWP, place the widget on a pane (designed for 1920×1080, scales
responsively), then set Properties:

| Property | Effect |
|---|---|
| Widget Title | header title override |
| Theme | Dark / Light (see [theming.md](theming.md)) |
| Default Page | dashboard shown at load |
| Data Mode | Auto (live when hosted) / Live / Simulation |
| **Tag Prefix** | prepended to every OMI address in `config/tags.config.js` — point the same package at `PlantB.` without touching config |

All properties apply live via `omi:propertyChanged` — no reload needed.

Tags the shipped config expects (with default prefix `Factory.`) are listed in
`config/tags.config.js` and the machine templates in
`config/machines.config.js` (e.g. `Factory.Machines.M-001.State`). Machine
state tags may deliver integer codes (0 idle, 1 running, 2 maintenance,
3 error — remappable in `states.config.js`).

## Upgrades

1. Bump `version` in `manifest.json`.
2. Package and re-import the CWP; OMI replaces the widget in place.
3. Config is part of the package — site-specific config should live in
   override files appended at the end of the config section in `index.html`
   (a later `SFP.config.define` with the same id wins), so upgrades don't
   overwrite site changes.

## Scaling guidance (10k+ tags, 500+ machines)

The architecture is subscription-driven; what's not on screen costs nothing:

- **Tags**: only datapoints used by widgets on the *current page* hold OMI
  subscriptions; page switches release them. 10k defined datapoints are just
  config entries until used.
- **Machines**: the machine grid subscribes only to the visible page of
  machines. Two permanent per-machine costs exist — state tracking for fleet
  counts, and any `machineMetric` alarm rules. Both are fine to ~1,000
  machines. Beyond that, bind fleet counts to aggregate tags computed in
  System Platform and replace `machineMetric` rules with rollup-tag rules.
- **History**: buffers are bounded (window ÷ interval samples, throttled
  appends). The shipped config retains ≈ 5k samples total. For deep history
  (months), query a Historian REST endpoint on demand instead of widening
  buffers.
- **Multi-site**: one CWP per site via Tag Prefix, or per-site dashboards in
  one package (`dashboard.site-a-overview`, ...) with separate `config/twin/*`
  layout and connection config.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Amber SIMULATION badge in OMI | host never sent `omi:init` (check widget import) or Data Mode = Simulation |
| KPI shows SIM chip in live mode | datapoint has no `source` binding — add one in `config/tags.config.js` |
| KPI shows `—` / BAD | tag missing on host, or `simulateUnboundInLive: false` with no binding |
| Widget replaced by red error card | that widget instance failed — message names the type; check its config against the docs; other widgets keep running |
| Startup error about missing config | a config file was removed from `index.html` or defines the wrong id — the config registry fails loudly by design |
