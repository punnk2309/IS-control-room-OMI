# AVEVA OMI Compatibility Verification

Verification of three requirements for running this platform as a deployed
industrial control-room dashboard on AVEVA OMI hosted on a Windows server.
Date: 2026-06-12.

## 1. Edit-mode permission system compatible with AVEVA OMI

**Status: implemented (was a gap).** Before this change anyone could toggle
edit mode (pencil button or `?edit=1`).

How it works now:

- The widget exposes a `canEdit` boolean property in `manifest.json`
  (**default false** — secure by default when hosted).
- AVEVA OMI owns authentication and roles (ArchestrA security model). The OMI
  engineer grants edit capability per role using either:
  - **Role-scoped layouts** — OMI ViewApps can show different layouts/panes per
    role; place a widget instance with `canEdit=true` only on the
    engineering/administration layout, and `canEdit=false` (default) elsewhere; or
  - **OMI scripting** — set the widget's `canEdit` property from a script that
    checks the logged-in user's role/galaxy security group.
- Enforcement inside the widget at every entry point: the pencil button is
  hidden, `?edit=1` is ignored when hosted without permission, the dashboard
  layout editor and factory-map twin editor refuse to activate, and the
  config-override save path refuses to write. If permission is revoked live
  (`omi:propertyChanged`), an active edit session is force-exited.
- Standalone/dev mode (no OMI host) keeps edit available so engineering
  workflows are unaffected.

**Caveat (by design):** this is UI-level enforcement inside the widget. The
authoritative access control is OMI's security model — which is exactly how
OMI expects embedded web content to behave. The widget cannot see Windows/AD
credentials directly; the property bridge is the supported pattern.

## 2. Saving changes from edit mode on a Windows-server OMI host

**Status: compatible, with a scoping caveat you must be aware of.**

- Edit-mode saves go through `SFP.config.override()` → browser `localStorage`
  (key `sfp.configOverrides`). OMI hosts custom widgets in a WebView2
  (Chromium) container on Windows Server; localStorage works there and
  persists per **Windows user profile per machine**.
- That means a saved layout is durable on that operator station, but is NOT
  automatically replicated to other control-room stations or other users.
- The supported path for **fleet-wide, permanent** changes is built in:
  **Export** downloads the edited `*.config.js` / `*.dashboard.js` file →
  commit it into the widget source → repackage (`scripts/package-cwp.ps1`) →
  re-import the CWP. This is a deliberate, controlled deployment step — which
  is appropriate change management for an industrial control room.
- If live multi-station sync is ever required, the planned ModuleHub store
  service (see docs/plans/module-maker-plan.md §5) provides the natural home:
  a small Windows service exposing a REST key-value store; `config-overrides`
  could read/write it instead of localStorage. Not built yet.

## 3. All operations supported on OMI / Windows Server as a deployed control-room dashboard

**Status: verified by design review.** Point by point:

| Operation | Mechanism | OMI/WebView2 compatible |
|---|---|---|
| Data in | `omi:subscribe` / `omi:tagValue` postMessage protocol | Yes — no direct network/file access needed |
| Data out | `omi:writeTag` postMessage | Yes |
| Rendering | DOM + Canvas 2D (dashboards, twin, gantt) + Chart.js (bundled) | Yes — no WebGL, no external CDN |
| No-data overlays, mode switching | in-widget logic, `omi:propertyChanged` (`dataMode`) | Yes |
| Edit mode + undo/save | DOM events + localStorage | Yes (see §2 scoping) |
| Custom map images/SVG | `FileReader` → data-URI stored in config; images travel inside exported config and the packaged CWP | Yes — file picker works in WebView2; no filesystem writes attempted |
| New dashboards at runtime | config overrides applied before bootstrap on reload | Yes (per-station; export to make permanent) |
| Asset model / Gantt | pure in-widget JS | Yes |
| Deployment | `package-cwp.ps1` → `.cwp` zip → OMI widget library (`%ProgramData%\AVEVA\OMI\CustomWidgets`) | Yes — existing pipeline |
| Dependencies | none external at runtime (no CDN, no build, works offline on OT networks) | Yes |

Constraints respected throughout: no Node/npm at runtime, no external network
calls, fail-soft widgets (a broken widget renders an error card, never takes
down the control-room display), simulation data always visibly badged.

**Residual risks to plan for:**
- localStorage quota (~5–10 MB per profile): large map images as data URIs can
  approach it — the editor warns above 500 KB per image; prefer committing
  large floorplans into the package as files referenced by relative URL.
- WebView2 runtime evergreen updates on the server are managed by IT policy;
  the platform uses only long-stable web APIs (ES5, Canvas 2D, postMessage,
  localStorage) precisely to be insensitive to this.
- String-valued tags do not seed Gantt history on first load (numeric tags
  do); rows fill from live data. Platform `HistoryBuffer` change would be
  needed to lift this.
