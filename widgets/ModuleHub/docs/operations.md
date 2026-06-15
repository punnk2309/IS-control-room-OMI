# ModuleHub Operations Manual

End-to-end guide to running ModuleHub: how the platform works at runtime, how
to operate it day to day, how a module travels from idea to production, and
what to do when something misbehaves.

Companion references (this manual links to them rather than repeating their
tables):

| Document | Contents |
|---|---|
| [README.md](README.md) | Platform overview, directory layout, manifest properties |
| [module-dev-guide.md](module-dev-guide.md) | module.json schema, full SDK reference, theming |
| [store-and-persistence.md](store-and-persistence.md) | Storage modes, REST API, retention internals |
| [services/modulehub-store/README.md](../../../services/modulehub-store/README.md) | Store service install + config |
| [docs/plans/modulehub-contracts.md](../../../docs/plans/modulehub-contracts.md) | Binding interface spec (protocol-level truth) |

Audience roles used below: **Operator** (uses modules on the dashboard),
**Module developer** (builds modules in Studio), **Administrator** (deploys
the widget and runs the store service).

---

## 0. Running / hosting ModuleHub

> **The one rule: serve ModuleHub over HTTP. Never open `index.html` from disk
> (`file://`).** Under `file://`, the shell cannot assemble a module: it builds
> each sandboxed iframe by `fetch()`-ing the SDK files (`src/sdk/*.js`) and the
> module code, and browsers **block `fetch()` of local files**. The visible
> symptom is exactly what it looks like — **"Run preview" does nothing** and
> modules fail to load. (Importing a `.mhmod` still works because that uses a
> file picker, not `fetch` — which is why import can appear to work while
> preview is dead. Don't be fooled.)

### A. Local development / demo

```powershell
# from the repo root — zero-dependency static server
.\scripts\dev-server.ps1            # serves the repo on http://localhost:8080
```

Then open **http://localhost:8080/widgets/ModuleHub/index.html**.

- Previews and module loading work immediately, in **simulation** mode
  (every subscribed tag random-walks 0–100 at 1 Hz — see §2).
- With no `storeUrl`, the status dot is **grey** (local IndexedDB persistence)
  and **"Deploy to Dashboard" is disabled** — that button needs a live store
  service (see B) *and* a `storeUrl`, which standalone ModuleHub only receives
  from an OMI host (see C). For local-only work, that's expected; develop and
  preview here, and publish from a hosted instance.

### B. Optional: the store service (shared persistence + Deploy)

Needed only for durable, multi-station persistence and for the
**Deploy to Dashboard** (publish-to-library) flow.

```powershell
cd services\modulehub-store
npm install
npm start                           # node server.js → listens on :8743
# verify from the client machine:
irm http://localhost:8743/health    # → { ok: true, rows: <n>, dbMB: <n>, ... }
```

For a Windows service install (nssm) and config (`config.json`: port, bind,
`apiKey`, retention), see [§5.2](#52-store-service) and the
[service README](../../../services/modulehub-store/README.md).

### C. Production hosting (OMI / CWP)

In production ModuleHub runs **inside OMI/CWP as a packaged `.cwp` widget**,
which is where it receives its `storeUrl`/`storeKey`/`canEdit` properties.
Package it, import it, and set the properties as described in the deployment
runbook ([§5.1](#51-widget)):

```powershell
.\scripts\package-cwp.ps1 -WidgetName ModuleHub
# → dist\ModuleHub-v<version>.cwp   → import in OMI / CWP, then set properties
```

`storeUrl = http://<server>:8743` is what turns the dot green and enables
**Deploy to Dashboard**; `canEdit = true` is what makes Studio useful on that
station.

### Quick symptom → fix

| Symptom | Cause | Fix |
|---|---|---|
| "Run preview" does nothing; modules won't load | Opened via `file://` | Serve over HTTP (A) and open the `http://localhost:8080/...` URL |
| Import works but everything else is dead | Same — import uses a file picker, not `fetch` | Same as above |
| Status dot grey; "Deploy to Dashboard" disabled | No `storeUrl` (standalone) | Run the service (B) **and** host in OMI with `storeUrl` set (C) |
| Dot amber, never green | Service down/unreachable or `storeKey` mismatch | Check `GET /health`; compare `storeKey` ↔ service `apiKey` (§8) |

---

## 1. The system at a glance

ModuleHub is one CWP widget plus one optional Windows service:

```
┌─ OMI / CWP host ──────────────────────────────────────────────────────┐
│   omi:init / omi:tagValue / omi:writeTag  (postMessage)               │
│  ┌─ ModuleHub widget (index.html) ─────────────────────────────────┐  │
│  │  Shell: header bar · module switcher · Studio · status dot      │  │
│  │  Runtime: loader + sandbox (host side of the mh:* bridge)       │  │
│  │  Store client: REST ⇄ IndexedDB fallback                        │  │
│  │   ┌─ sandboxed iframe per module (allow-scripts only) ───────┐  │  │
│  │   │  SDK (injected)  +  module main.js                       │  │  │
│  │   │  ALL I/O via mh:* postMessage — no direct DOM/network/DB │  │  │
│  │   └───────────────────────────────────────────────────────────┘  │  │
│  └──────────────────────────────┬──────────────────────────────────┘  │
└─────────────────────────────────┼─────────────────────────────────────┘
                                  │ REST (HTTP :8743, X-Api-Key)
                   ┌──────────────▼───────────────┐
                   │  modulehub-store service     │
                   │  Node + SQLite (WAL)         │
                   │  retention · backups · VACUUM│
                   └──────────────────────────────┘
```

A typical data round trip: a module calls `sdk.data.subscribe('dryer.outlet.t', cb)`
→ SDK sends `mh:subscribe` to the shell → the shell checks the module's
manifest permissions → forwards as `omi:subscribe` to the OMI host (live) or
starts a generator (simulation) → every new value flows back
`omi:tagValue` → `mh:tagValue` → the module's callback. Writes
(`sdk.data.write`) and store operations (`sdk.store.*`) take the same
permission-checked path in the other direction.

The five things an operator can see on the header bar:

| Element | Meaning |
|---|---|
| Module dropdown | Installed modules from `modules/index.json`; switching unloads the current module (its `destroy()` runs) and loads the next |
| **Studio** button | Opens the module editor (only useful when `canEdit` is true) |
| Status dot — green | Store mode `service`: transactions go to the REST service |
| Status dot — amber | Store mode `buffered`: service unreachable; writes buffered locally, auto-replayed when it returns (≤ 30 s after recovery) |
| Status dot — grey | Store mode `local`: no `storeUrl` configured; everything stays in this browser's IndexedDB |

---

## 2. Operating modes

ModuleHub decides between **live** and **simulation** data exactly like the
SmartFactoryControlRoom widget:

1. On load it posts `omi:ready` to its parent.
2. If an `omi:init` arrives (the widget is hosted in OMI/CWP), the `dataMode`
   property decides: `Live` → live, `Simulation` → simulation, `Auto`
   (default) → live.
3. If no `omi:init` arrives within 2.5 s (e.g. the widget is opened directly
   from a static server), it falls back to **simulation**: every subscribed
   tag gets a random-walk value (0–100, quality `Simulated`) at 1 Hz.

Consequences worth knowing:

- **Any static file server can demo the full platform** — both demo modules,
  Studio, and (if `storeUrl` is reachable) the real store service.
- Modules that need realistic physics (e.g. the Mollier monitor) scale the
  0–100 simulation walk into their configured engineering ranges themselves;
  in live mode values pass through untouched.
- Theme (`dark`/`light`) comes from the OMI property and can change at
  runtime; the shell re-applies tokens and fans `mh:theme` out to every
  running module — no reload.

---

## 3. Day-to-day operation (Operator)

**Switching modules.** Use the dropdown. State is safe: module UI state that
matters is persisted through `sdk.store` (e.g. the bag-filter plant state),
so unload/reload restores it.

**Reading the demo modules.**

- *Bag Filter Tracker*: 240-slot circular map; slot color = the most-worn of
  the three parts at that position (green < 75 % of its replacement-hours,
  amber 75–100 %, red over). Tabs: Slot (part details + actions), Tray
  (uninstalled parts; drag onto a slot to install), Worklist (worst-first
  replacement queue), History (audit trail per slot or serial). Every
  physical action you record writes an immutable transaction — the History
  tab and the store service are the traceability record.
- *Mollier Monitor*: live psychrometric chart; the labelled **OUT** point is
  the monitored outlet state. Shaded region = sticky/lumping risk. Banner
  states: OK / WARN (trajectory projected to enter the sticky region within
  the configured minutes, ETA shown) / ALARM (already inside). WARN/ALARM
  also write `dryer.lumpingWarn` (0/1/2) back to the host for plant alarming.

**Toasts and errors.** Module-level failures (store rejection, permission
denial) surface as toasts inside the module and as console lines prefixed
`[MH:<module-id>]`. The shell never crashes with a module — a faulty module
shows an error card in its container while the shell and other machinery keep
running (that is the point of the iframe sandbox).

---

## 4. Module lifecycle (Module developer)

The full path from idea to production:

```
Studio draft → lint → live preview (simulation) → version bump → export .mhmod
     └────────────────────────────────────────────────┐
production install: unzip into modules/<id>/ ── add id to modules/index.json
     └── repackage .cwp ── re-import widget in OMI
```

**1. Develop in Studio.** Studio button → *New from template* seeds a working
module (a copy of the `_smoke` example). Edit the manifest form (id, name,
permissions, config JSON) and the code. *Lint* runs a syntax check plus
sanity checks (`MH.register` present). Drafts auto-save (1 s debounce) to the
store under the reserved `_studio` namespace — they survive reloads, and with
a green dot they live on the server, not just in your browser.

**2. Preview.** *Run preview* executes your current code in a real sandboxed
iframe wired to simulation data — identical runtime to production, including
permission enforcement. Module `console`/`sdk.log` output appears in the
console strip under the preview pane.

**3. Version + export.** *Bump version* increments the patch number. *Export
.mhmod* downloads `<id>-v<version>.mhmod` — a plain ZIP containing
`module.json` + `main.js`. (It opens with any zip tool; the extension is just
a convention.)

**4. Install to production.** A `.mhmod` import in Studio creates a *draft*
(for review/editing). A production install is a file-system operation:

1. Unzip the `.mhmod` into `widgets/ModuleHub/modules/<id>/`.
2. Add `"<id>"` to `widgets/ModuleHub/modules/index.json`.
3. Repackage and re-import the widget (§5 below).

This is deliberate: what runs in production is exactly what is in the
packaged widget, version-controlled and reviewable — no runtime
code-injection path exists outside Studio previews.

**5. Upgrade a module.** Same as install: replace the folder contents with
the new version's files and repackage. The module's persisted state and
transaction history live in the store (keyed by namespace), so an upgraded
module sees its old data. Treat your store namespace's record shapes as an
API: migrate defensively when you change them.

Permissions gotcha: a module can only touch the tags matching its
`permissions.tags` globs and the store namespaces in `permissions.store`.
Denials are not fatal — the SDK promise rejects and the host logs
`permission-denied` — but design your manifest before you code.

---

## 5. Deployment runbook (Administrator)

### 5.1 Widget

```powershell
# from the repo root
.\scripts\package-cwp.ps1 -WidgetName ModuleHub
# → dist\ModuleHub-v<version>.cwp
```

Import the `.cwp` in OMI / CWP as usual, then set the widget properties:

| Property | Set it to | Notes |
|---|---|---|
| `defaultModule` | the module operators should see first | falls back to the first loadable module |
| `theme` | `dark` / `light` | can be changed at runtime |
| `dataMode` | `Auto` | only force `Simulation` for training instances |
| `storeUrl` | `http://<omi-server>:8743` | empty = browser-local persistence only |
| `storeKey` | the API key from the service `config.json` | empty if auth disabled |
| `canEdit` | `false` for operator stations | hides nothing but makes Studio pointless; set `true` only where module development happens |

Post-deploy smoke check (2 minutes): open the widget → header renders → load
`_smoke` from the dropdown → it must show **SDK OK**, a moving value, and a
kv-roundtrip success line → status dot green (if a `storeUrl` is set).
`_smoke` exists precisely for this; remove it from `modules/index.json` if
you don't want it selectable on production stations.

### 5.2 Store service

Required only for **shared, durable** persistence (multi-station, audit
trail). Without it everything still works per-browser.

```powershell
cd services\modulehub-store
.\install-service.ps1     # npm install + nssm service "ModuleHubStore"
# verify:
irm http://localhost:8743/health   # → { ok: true, rows: <n>, dbMB: <n>, ... }
```

No nssm? The script generates `start-modulehub-store.cmd` for Task
Scheduler/manual use. Configuration (`config.json`): port, bind address, API
key, retention caps — see the [service README](../../../services/modulehub-store/README.md).
Set a non-empty `apiKey` for anything beyond localhost, and mirror it in the
widget's `storeKey` property.

### 5.3 Upgrades

- **Widget**: bump `version` in `widgets/ModuleHub/manifest.json`, repackage,
  re-import. Nothing server-side changes; browser-local (IndexedDB) data is
  keyed by origin and survives.
- **Service**: stop service → replace files (keep `config.json`, `data/`,
  `backups/`) → start. The SQLite schema is v1; the db file carries over.

---

## 6. Persistence operations

(Internals in [store-and-persistence.md](store-and-persistence.md); this is
the operational view.)

**What lives where:**

| Data | `service` mode | `local` mode |
|---|---|---|
| Transactions (`tx`) — audit trail, movements | SQLite on the server | browser IndexedDB |
| Key-value (`kv`) — module state, settings, Studio drafts | SQLite on the server | browser IndexedDB |
| Buffered tx during outage | browser `txbuf` ring (50 k), replayed | n/a |

**Outage behavior** (no operator action needed): service down → dot turns
amber, *recording actions keeps working* (buffered), reads of server history
fail with a clear error until it returns. Service back → buffered rows replay
automatically within 30 s, flagged `buffered=1` so after-the-fact entries are
distinguishable in the audit trail.

**Self-management** (no scheduled DBA work): the service prunes the oldest
transactions when caps are exceeded (defaults 500 k rows / 512 MB — a ring
buffer, reliability over completeness), VACUUMs weekly, and writes a nightly
hot backup to `backups/modulehub-YYYYMMDD.db`, keeping the 7 newest. A backup
is always taken immediately before any prune.

**Restore from backup:**

```powershell
nssm stop ModuleHubStore        # or stop your scheduled task
Copy-Item backups\modulehub-<date>.db data\modulehub.db -Force
nssm start ModuleHubStore
irm http://localhost:8743/health
```

**Ad-hoc queries** (audit/reporting): the REST API is plain HTTP —
`GET /tx?ns=bagfilter&partId=UF-0042&limit=100` — or open
`data/modulehub.db` read-only with any SQLite tool (WAL mode tolerates
concurrent readers).

---

## 7. Security and isolation model

- **Module isolation**: every module runs in `sandbox="allow-scripts"`
  *without* `allow-same-origin` — an opaque origin with no access to the
  shell DOM, cookies, IndexedDB, or network fetch. The only door is
  postMessage, and the shell checks every request against the module's
  declared manifest permissions (tag globs, store namespaces). A malicious or
  broken module can at worst spam its own iframe.
- **Code provenance**: production module code ships inside the `.cwp`
  package. Studio previews execute draft code, but only in the same sandbox
  and only for the user editing it.
- **Store service**: protect with `apiKey` + bind appropriately
  (`127.0.0.1` if only the OMI server's own browser sessions need it). The
  API is plaintext HTTP on the LAN — keep it inside the OT network segment;
  put a reverse proxy with TLS in front if it must cross zones.
- **Known accepted gap** (inherited from the control-room pattern): the
  OMI ⇄ widget postMessage layer does not verify `event.origin`. Acceptable
  while widgets are hosted on a trusted OMI server; revisit if that changes.

---

## 8. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Error card "module not found / failed" in container | id missing folder, bad `module.json`, fetch 404 | check `modules/<id>/` exists in the *packaged* widget and the id is in `modules/index.json`; browser console has the exact fetch error |
| Module loads but is inert / no data | tag names don't match `permissions.tags` globs → silent `permission-denied` rejections | console: look for `permission-denied: tag …`; widen the manifest globs and repackage |
| Status dot stuck grey with service running | `storeUrl` property empty or wrong | set it on the widget instance in OMI; verify `GET /health` from the *client* machine (firewall, port 8743) |
| Dot amber, never green | service down/unreachable, or `storeKey` mismatch (401s) | `irm http://<server>:8743/health`; `nssm status ModuleHubStore`; compare `storeKey` ↔ `config.json apiKey` |
| Actions recorded during outage "missing" after recovery | replay loop runs every 30 s | wait ≤ 40 s; rows appear flagged `buffered=1` |
| `request timeout: mh:store` toasts in a module | shell store client unreachable AND IndexedDB unavailable, or 10 s bridge timeout under extreme load | check dot + console `[MHB.storeClient]` mode lines |
| Studio drafts vanished on another machine | drafts were saved while dot was grey (browser-local) | drafts live where the store mode put them; use `service` mode for shared drafts |
| Preview works, production module blank | code relied on something Studio drafts have but the export lacks (e.g. unsaved manifest changes) | re-export after saving; diff exported `module.json` vs draft |
| Whole widget blank in OMI | script load order broken by manual edits to `index.html` | restore order: core → sdk host files → registry → runtime → studio → `app.js` last |
| Simulation values where live expected | no `omi:init` received (widget not actually OMI-hosted) or `dataMode=Simulation` | check property; console logs the resolved mode at startup |

**Log locations**: browser console (shell + relayed `[MH:<id>]` module logs +
`[MHB.storeClient]` mode transitions); service stdout — one line per request
— visible in a manual console run, or configure nssm `AppStdout` to capture
to file when running as a service.

---

*Built 2026-06-12 (v0.1.0). Protocol-level details in
[modulehub-contracts.md](../../../docs/plans/modulehub-contracts.md) are
binding; if this manual and the contract disagree, the contract wins.*
