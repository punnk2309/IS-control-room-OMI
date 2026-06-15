# ModuleHub — Platform Overview

ModuleHub is a CWP widget that acts as a host shell and sandboxed module runtime,
letting developers deploy arbitrary interactive industrial applications ("modules")
inside OMI without modifying the control-room configuration. It ships as a single
packaged CWP widget (`ModuleHub-v<version>.cwp`) alongside an optional Windows
persistence service (`services/modulehub-store`). A built-in Studio UI lets
operators create, edit, preview, and publish modules directly in the browser.

**Documentation set:**

| Document | Read it when you… |
|---|---|
| [operations.md](operations.md) | run, deploy, or troubleshoot ModuleHub end to end (start here) |
| this file | want the architecture, layout, and manifest property reference |
| [module-dev-guide.md](module-dev-guide.md) | build a module (SDK reference, schema, theming, Studio) |
| [store-and-persistence.md](store-and-persistence.md) | need persistence internals (REST API, retention, fallback) |

---

## Architecture

```
OMI / CWP host
└── ModuleHub widget  (index.html, manifest.json)
    ├── Shell + theme engine         src/core/
    │     namespace.js  bus.js  registry.js  theme.js
    ├── Module runtime               src/runtime/
    │     loader.js     sandbox.js
    ├── SDK (embedded into iframes)  src/sdk/
    │     sdk-bootstrap.js  sdk-data.js  sdk-store.js
    │     sdk-ui.js         sdk-assets.js  sdk-assets-data.js
    ├── Studio (in-browser editor)   src/studio/
    │     studio.js  studio-zip.js
    ├── App bootstrap                src/app.js
    ├── Installed modules            modules/<id>/
    │     index.json                 (ordered list of module ids)
    │     bag-filter-tracker/        Demo 1
    │     mollier-monitor/           Demo 2
    │     _smoke/                    SDK smoke-test module
    └── Styles                       styles/
          modulehub.css  studio.css
```

Each module runs in its own `<iframe sandbox="allow-scripts">` — isolated from
the parent shell and from other modules. All data access (OMI tags, persistent
store, asset model) is proxied over `postMessage` by the host; a module can
never reach OMI or the database directly.

---

## Directory Layout

```
widgets/ModuleHub/
├── index.html              Entry point loaded by CWP
├── manifest.json           OMI property declarations
├── src/
│   ├── app.js              OMI postMessage bootstrap, simulation fallback
│   ├── core/
│   │   ├── namespace.js    Defines window.MHB
│   │   ├── bus.js          Internal event bus
│   │   ├── registry.js     Installed-module list (reads modules/index.json)
│   │   └── theme.js        Dark/light CSS token map + MHB.theme.color()
│   ├── runtime/
│   │   ├── loader.js       Fetches module.json + main.js, builds iframe
│   │   └── sandbox.js      Host side of the mh:* postMessage bridge
│   ├── sdk/
│   │   ├── sdk-bootstrap.js  Injected into every iframe; defines window.MH
│   │   ├── sdk-data.js       Tag subscribe/write
│   │   ├── sdk-store.js      Host-side store client (REST → IndexedDB fallback)
│   │   ├── sdk-ui.js         DOM helpers, drag, toast, color
│   │   ├── sdk-assets.js     DS650 asset-model query (module side)
│   │   └── sdk-assets-data.js  Embedded asset-model data blob
│   └── studio/
│       ├── studio.js         Module editor, preview, publish flow
│       └── studio-zip.js     .mhmod archive read/write (JSZip wrapper)
├── modules/
│   ├── index.json            ["_smoke","bag-filter-tracker","mollier-monitor"]
│   ├── bag-filter-tracker/   Demo 1 — bag filter part tracking
│   ├── mollier-monitor/      Demo 2 — live psychrometric chart
│   └── _smoke/               SDK smoke-test (internal)
└── styles/
    ├── modulehub.css         Shell chrome
    └── studio.css            Studio editor chrome
```

---

## OMI Manifest Properties

Declared in `manifest.json`; configurable in the CWP property editor.

| Property | Display Name | Type | Default | Description |
|---|---|---|---|---|
| `defaultModule` | Default Module | String | `"bag-filter-tracker"` | ID of the module to load on startup. Must match a folder name under `modules/`. |
| `theme` | Theme | Enum (`dark`/`light`) | `"dark"` | Visual theme applied to the shell and passed to all loaded modules. |
| `storeUrl` | Store URL | String | `""` | REST base URL for the ModuleHub store service. Empty = IndexedDB-only local mode. |
| `storeKey` | Store API Key | String | `""` | `X-Api-Key` header value for the store service. Empty = auth disabled. |
| `canEdit` | Can Edit (Studio) | Boolean | `true` | Shows the Studio button. Bind to an OMI role expression to gate access per user. |

---

## Deployment

### 1. Package the widget

From the repository root:

```powershell
.\scripts\package-cwp.ps1 -WidgetName ModuleHub
```

This produces `dist/ModuleHub-v<version>.cwp` (a zip archive renamed `.cwp`).
No build step; the script zips the widget directory contents as-is.

### 2. Import into OMI / CWP

1. In the OMI administration portal, navigate to **Custom Widgets**.
2. Click **Import** and select `dist/ModuleHub-v<version>.cwp`.
3. Add the widget to a CWP page at the desired size (default 1920 × 1080).
4. Set OMI properties in the widget's property panel (see table above).

### 3. Optional — install the store service

The persistent store service provides shared, server-side SQLite persistence for
all modules. Without it, the SDK falls back to IndexedDB (browser-local, per
client).

See `services/modulehub-store/README.md` for full installation steps.
Short form (PowerShell as Administrator, with nssm on PATH):

```powershell
cd services\modulehub-store
.\install-service.ps1
```

After starting, set the `storeUrl` property to `http://<server>:8743` and
`storeKey` to the configured API key.

### 4. Standalone / demo mode

Open `index.html` from any static **HTTP** server — e.g. `npx serve widgets/ModuleHub`,
or `scripts\dev-server.ps1` then http://localhost:8080/widgets/ModuleHub/index.html.
**Do not open it via `file://`** — previews and module loading need `fetch()`,
which browsers block on local files (see
[operations.md §0](operations.md#0-running--hosting-modulehub)).
If no `omi:init` message arrives within 2 500 ms the shell enters **simulation
mode** automatically: subscribed tags receive random-walk values at 1 s cadence
with quality `'Simulated'`. No OMI host or store service is required to run the
demos.

---

## Cross-references

The originating design and decision record for ModuleHub is
`docs/plans/module-maker-plan.md`. Every interface implemented in this widget —
the OMI protocol, iframe bridge, SDK surface, store REST API, and retention
policy — is specified in `docs/plans/modulehub-contracts.md` (§1–§10), which is
the binding source of truth if any discrepancy is found between this documentation
and the code.
