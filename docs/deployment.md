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

## Permissions / edit mode

### How the gate works

The widget exposes a **`canEdit` property** (Boolean, default `false`). This
property is the single control surface that the OMI engineer uses to decide
which users or layouts may open the visual editor.

At startup `src/app.js` computes `SFP.runtime.canEdit`:

| Context | Value |
|---|---|
| Standalone (not inside an OMI host) | `true` — dev/simulation workflow unaffected |
| OMI-hosted, `canEdit` property not set or `false` | `false` — edit locked by default |
| OMI-hosted, `canEdit` property set to `true` | `true` — edit enabled for this user/layout |

When `canEdit` is `false`:

- The pencil edit button is **hidden** (not just disabled).
- `?edit=1` URL flag is silently ignored.
- Any programmatic call to `SFP.config.override()` is refused with a
  `console.warn` — belt-and-braces backstop in case a race or custom script
  tries to bypass the UI layer.
- Both `layout-editor._activate` and `twin-editor.setActive(true)` bail out
  immediately with `console.warn`.

If `canEdit` is revoked at **runtime** (via `omi:propertyChanged`) while an
edit session is open, the widget immediately forces edit mode off, emits
`edit:modeChanged`, and logs a console warning. Any unsaved changes in the
session are discarded (normal edit-mode exit behaviour).

### OMI-side setup options

**Option A — Role-scoped layout variants (recommended)**

1. Create two variants of the pane in your OMI/System Platform layout:
   one for *Operator* (leave `canEdit` at its default `false`), one for
   *Engineer* (set `canEdit = true`).
2. Assign each layout variant to the appropriate ArchestrA security role.
   OMI loads the correct variant based on the logged-in user's role —
   engineers see the editable layout, operators see the read-only one.
3. No scripting required.

**Option B — OMI graphic scripting**

In a graphic script that fires on login or role-change, set the widget
property programmatically:

```vbscript
' Example OMI/System Platform Galaxy script
Dim role As String
role = Galaxy.GetCurrentUser().PrimaryRole
If role = "Engineer" Or role = "Supervisor" Then
    WidgetRef.canEdit = True
Else
    WidgetRef.canEdit = False
End If
```

This fires `omi:propertyChanged` which the widget handles at runtime without
a reload.

### Security caveat

This is **UI-level enforcement inside the widget**. The authoritative security
boundary is OMI's own security model:

- OMI/System Platform enforces role-scoped layout visibility and property
  bindings at the host level, before the widget ever receives a message.
- Saved configuration overrides are written to **per-station localStorage**.
  They affect only the local browser session and are not propagated to other
  stations or to the package on disk.
- Making an edit change permanent requires **Export → commit the downloaded
  `.config.js` → repackage the CWP → redeploy**. That is a controlled
  deployment step outside the widget's own runtime entirely.

In short: `canEdit = false` prevents the widget's own editor from opening;
OMI role security prevents the wrong layout (with `canEdit = true`) from
being shown to unauthorized users.

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
