# ModuleHub Contracts (v1) — binding spec for all build agents

This file is the single source of truth for every interface shared between
ModuleHub components. If your task conflicts with this spec, STOP and report;
do not improvise a different shape.

Namespace: `window.MHB` (host shell). Inside module iframes the only global the
SDK exposes is `window.MH`. Plain JS, no build step, no ES modules — same
conventions as `widgets/SmartFactoryControlRoom` (script tags in index.html,
one IIFE per file).

## 1. OMI host protocol (ModuleHub widget ⇄ OMI host)

Identical to SmartFactoryControlRoom (`widgets/SmartFactoryControlRoom/src/app.js`,
`src/data/sources/omi-source.js`). Reuse the same message shapes:

- Out: `{ type:'omi:ready' }`, `{ type:'omi:subscribe', tagName }`,
  `{ type:'omi:unsubscribe', tagName }`, `{ type:'omi:writeTag', tagName, value }`
- In: `{ type:'omi:init', properties:{...} }`, `{ type:'omi:propertyChanged', name, value }`,
  `{ type:'omi:resize', width, height }`,
  `{ type:'omi:tagValue', tagName, value, quality, timestamp }`
- Simulation fallback: send `omi:ready` on load; if no `omi:init` within
  2500 ms, run in simulation mode (random-walk generator per subscribed tag,
  1 s cadence, quality `'Simulated'`).

ModuleHub `manifest.json` OMI properties (same declaration format as the
control room manifest): `defaultModule` (String, default `"bag-filter-tracker"`),
`theme` (Enum `["dark","light"]`, default `"dark"`), `storeUrl` (String, default
`""` = IndexedDB-only), `storeKey` (String, default `""`), `canEdit`
(Boolean, default `true` — shows Studio).

## 2. Theme tokens

Host defines dark + light token maps using THE SAME token names as the control
room (`config/theme.dark.config.js`) — at minimum: `bg-base, bg-surface,
bg-card, bg-raised, border, border-strong, text-1, text-2, text-3, accent,
accent-strong, good, warn, alarm, info, chart-1..chart-4`. Tokens are applied
as `--c-<name>` CSS custom properties on `document.documentElement` (host) and
are passed to each module iframe in `mh:init` / `mh:theme`; the SDK applies
them as `--c-<name>` on the iframe's own root element.

`MHB.theme.color(token)` behaves like the control room's
`theme.color` (passthrough for `#`/`rgb` strings, else read the CSS var,
`#888888` on miss).

## 3. module.json schema

```json
{
  "id": "bag-filter-tracker",
  "name": "Bag Filter Tracker",
  "version": "1.0.0",
  "minSdk": "1.0",
  "entry": "main.js",
  "permissions": {
    "tags": ["dryer.*"],
    "store": ["bagfilter"]
  },
  "config": { }
}
```

- `id`: folder name under `modules/`, kebab-case, `[a-z0-9-]+`.
- `permissions.tags`: array of tag-name globs (`*` wildcard segments only;
  match with a simple `^glob$` regex translation). Empty array = no tag access.
- `permissions.store`: list of store namespaces the module may read/write.
- `config`: arbitrary JSON default config block; host may deep-merge overrides
  later (v1: passed through as-is).

## 4. Module code contract

`modules/<id>/main.js` is plain JS executed inside a sandboxed iframe. It must
call:

```js
MH.register({
  create: function (sdk, root) { /* build UI under root */ },
  destroy: function () { /* optional cleanup */ }
});
```

`root` is a DOM element filling the iframe body. `create` may return nothing.
Loader flow (host side): fetch `modules/<id>/module.json` and the entry file as
TEXT, then build an iframe with `sandbox="allow-scripts"` (NOT
`allow-same-origin`) and `srcdoc` = minimal HTML + inline `<script>` SDK
bootstrap `</script>` + inline `<script>` module code `</script>`. Escape
`</script` sequences in embedded code (`<\/script`). All module I/O goes over
postMessage; the module cannot touch the parent DOM, OMI, or the DB directly.

## 5. Iframe bridge protocol (host runtime ⇄ SDK)

Every message is `{ mh: 1, type, ... }`. Host validates `event.source` is the
module's iframe contentWindow; SDK validates `event.source === window.parent`.
Request/response messages carry a `reqId` (string, SDK-generated, unique per
request); the host answers with `mh:result` echoing the same `reqId`.

Module → host:

| type | payload | notes |
|---|---|---|
| `mh:hello` | `{ sdkVersion }` | sent by SDK bootstrap once listeners ready |
| `mh:subscribe` | `{ reqId, tag }` | host checks `permissions.tags` first |
| `mh:unsubscribe` | `{ tag }` | fire-and-forget |
| `mh:writeTag` | `{ reqId, tag, value }` | permission-checked |
| `mh:store` | `{ reqId, op, payload }` | `op` ∈ `tx.add\|tx.query\|kv.get\|kv.put`; host checks `payload.ns` against `permissions.store` |
| `mh:log` | `{ level, args }` | host relays to console prefixed `[MH:<id>]` |
| `mh:resize` | `{ height }` | optional content-height hint |

Host → module:

| type | payload |
|---|---|
| `mh:init` | `{ moduleId, manifest, config, theme: { tokens }, simulation, sdkVersion }` — reply to `mh:hello`; SDK calls module `create` only after this |
| `mh:tagValue` | `{ tag, value, quality, ts }` (ts = epoch ms) |
| `mh:result` | `{ reqId, ok: true, data }` or `{ reqId, ok: false, error: <string> }` |
| `mh:theme` | `{ tokens }` |
| `mh:destroy` | `{}` — SDK calls module `destroy`, then host removes iframe |

Permission denial = `mh:result { ok:false, error:'permission-denied: <detail>' }`.

## 6. SDK surface (what `create(sdk, root)` receives)

```js
sdk = {
  env: { moduleId, version, simulation, sdkVersion },
  config: { ... },                       // module.json config block
  data: {
    subscribe(tag, cb),                  // → unsubscribe(); cb({ value, quality, ts })
    write(tag, value),                   // → Promise<void>
  },
  store: {
    tx: {
      add(tx),                           // → Promise<{id}>; tx: { ns, ts?, user?, partType?, partId?, fromSlot?, toSlot?, action, note?, data? }
      query(filter),                     // → Promise<rows[]>; filter: { ns, from?, to?, partId?, slot?, action?, limit? (default 500) }
    },
    kv: {
      get(ns, key),                      // → Promise<value|null>
      put(ns, key, value),               // → Promise<void>
    },
    status(),                            // → 'service' | 'buffered' | 'local'
  },
  ui: {
    color(token),                        // theme token → CSS color string
    el(tag, attrs, children),            // tiny DOM helper; attrs.style obj ok; children: string|Node|array
    makeDraggable(el, opts),             // pointer-event drag helper: opts { onStart, onMove(dx,dy,ev), onDrop(ev), handle? }
    toast(msg, kind),                    // kind: 'info'|'good'|'warn'|'alarm'
  },
  assets: {                              // slim DS650 subset, data from embedded copy of asset-model.config.js
    node(pathCode), children(pathCode), tagsUnder(pathCode), root(),
  },
  log(...args),
}
```

Where the store lives is the SDK's concern, not the module's: `mh:store` goes
to the host, and the HOST decides service vs fallback (see §7/§8). `tx.add`
resolves once durably stored anywhere (service or buffer).

## 7. Store service REST API (`services/modulehub-store`)

Node.js + better-sqlite3, default port **8743**, bind `0.0.0.0`, API key via
header `X-Api-Key` (key configured in `config.json` next to server.js; empty
key = auth disabled for localhost demos). CORS: `Access-Control-Allow-Origin: *`,
allow headers `Content-Type, X-Api-Key`, handle OPTIONS preflight.

- `GET /health` → `{ ok: true, rows, dbMB, version }`
- `POST /tx` body `{ ns, ts?, user?, partType?, partId?, fromSlot?, toSlot?, action, note?, data?, buffered? }`
  → `201 { id }`. `ts` defaults to server now (epoch ms). `data` is stored as
  JSON text. `ns` and `action` required → else `400 { error }`.
- `GET /tx?ns=&from=&to=&partId=&slot=&action=&limit=` → `200 [rows]`,
  rows ordered ts DESC, `limit` default 500 max 5000. `slot` matches
  `fromSlot` OR `toSlot`.
- `GET /kv/:ns/:key` → `200 { value }` (JSON-parsed) or `404 { error }`
- `PUT /kv/:ns/:key` body `{ value }` → `200 { ok: true }` (upsert)

Schema: `tx(id INTEGER PK AUTOINCREMENT, ns TEXT NOT NULL, ts INTEGER NOT NULL,
user TEXT, partType TEXT, partId TEXT, fromSlot TEXT, toSlot TEXT,
action TEXT NOT NULL, note TEXT, data TEXT, buffered INTEGER DEFAULT 0)` with
indexes on `(ns, ts)`, `(partId)`; `kv(ns TEXT, key TEXT, value TEXT, updated
INTEGER, PRIMARY KEY(ns, key))`. WAL mode on open.

## 8. Retention / self-management (`retention.js`)

Config (config.json): `maxRows` default 500000, `maxDbMB` default 512,
`backupDir` default `./backups`, `backupKeep` 7. After every N=1000 inserts
(and on startup): if over either cap, delete oldest tx rows in 5000-row batches
until 10% under cap. Weekly `VACUUM` (setInterval, run if `db.sqlite` last
vacuum > 7 days, persisted in kv ns `_meta`). Nightly backup: copy db file to
`backupDir/modulehub-YYYYMMDD.db` (use better-sqlite3 `.backup()`), prune to
`backupKeep` newest, ALWAYS backup before a prune cycle runs.

## 9. SDK store fallback (sdk-store host side)

Host-side store client (lives in host, used by the bridge): if `storeUrl`
property set → REST with 3 s timeout; on network failure, write tx to
IndexedDB DB `mhb-store` object store `txbuf` (ring buffer, 50k newest kept)
and resolve as buffered. A reconnect loop (every 30 s) replays buffered rows
oldest-first with `buffered: true`, deleting on 2xx. If `storeUrl` empty →
pure IndexedDB mode: tx in `tx` object store, kv in `kv` object store, queries
served locally (filter in JS, same semantics as §7). `status()` reflects the
current mode.

## 10. File/dir layout (binding)

Exactly as drawn in `docs/plans/module-maker-plan.md` §1, plus:
`src/core/namespace.js` (defines `window.MHB`), `src/core/bus.js`,
`src/core/registry.js` (installed-module list; v1 reads a static
`modules/index.json` array of module ids), `src/runtime/loader.js`,
`src/runtime/sandbox.js` (iframe + host side of bridge),
`src/sdk/sdk-bootstrap.js` (the script embedded into every iframe; it defines
`MH`, wires the bridge, builds the `sdk` object from §6 and calls `create`).
`styles/modulehub.css`. Demo modules live in `modules/<id>/{module.json,main.js}`.

## 11. Module Library (service-hosted module distribution) — v1.1

Purpose: one-click publish from Studio; published modules are selectable in
the ModuleHub shell AND embeddable in SmartFactoryControlRoom via the
`module-host` widget (§12). The store service is the single distribution
point.

### 11.1 Service endpoints (additions to §7; same CORS + X-Api-Key rules)

- `GET /modules` → `200 [ { id, name, version, publishedAt } ]` (read from
  each `library/<id>/module.json`; `publishedAt` = file mtime epoch ms).
- `POST /modules` body `{ manifest: <module.json object>, files: { "<name>": "<text>", ... } }`
  → `201 { id, version }`. Validation (reject `400 { error }`):
  `manifest.id` matches `^[a-z][a-z0-9-]*$` (no leading `_`); `manifest.entry`
  is a key of `files`; every file name matches `^[A-Za-z0-9._-]+\.(js|json|css)$`
  (flat, no path separators); total payload ≤ 2 MB. Writes
  `library/<id>/module.json` (serialized from `manifest`; any
  `files['module.json']` is ignored) plus each file. Re-publish of an existing
  id: allowed only if `manifest.version` ≠ existing version OR query `?force=1`
  — else `409 { error }`. Overwrite replaces the folder content atomically
  (write to `library/<id>.tmp`, swap).
- `GET /modules/:id/:file` → file text with content-type (js/json/css); only
  flat names inside `library/<id>/`; anything else `404`.
- `DELETE /modules/:id` → `200 { ok: true }` (or 404).
- `GET /sdk/:file` → serves ONLY the whitelist `sdk-bootstrap.js, sdk-data.js,
  sdk-ui.js, sdk-assets.js` from config `sdkDir`. New config.json keys:
  `libraryDir` (default `"./library"`), `sdkDir` (default
  `"../../widgets/ModuleHub/src/sdk"`, resolved relative to the service dir —
  on the OMI server both trees live on the same disk; point it at the deployed
  widget's sdk folder).

### 11.2 ModuleHub host additions

- `MHB.storeClient` new ops (service mode only; reject with a clear error in
  local/buffered): `mod.list` → GET /modules; `mod.publish { manifest, files, force? }`
  → POST /modules; `mod.fetch { id, file }` → GET /modules/:id/:file (text).
- SECURITY: `sandbox.js` must whitelist ops arriving via `mh:store` to
  `tx.add | tx.query | kv.get | kv.put | status`. Modules can NEVER publish;
  `mod.*` is host-only (Studio). Other ops → `permission-denied: op <op>`.
- `registry.js`: `list()` = local `modules/index.json` ∪ library ids
  (`mod.list`, when service mode); on id collision the LOCAL (packaged) module
  wins. `manifest(id)` and the loader resolve library modules via `mod.fetch`.
  Library availability must degrade silently (no service → local list only).
- Studio: the Publish button becomes active (one click): publishes the open
  draft `{ manifest, files: { 'main.js': code } }`, then refreshes the shell
  dropdown. Version-conflict (409) → offer force re-publish.
- `scripts/publish-module.ps1 -ModuleId <id> [-StoreUrl http://localhost:8743] [-ApiKey k] [-Force]`:
  publishes `widgets/ModuleHub/modules/<id>/` from disk (CI/admin path), and
  also writes `dist/<id>-v<version>.mhmod` (zip of the folder).

## 12. Control-room `module-host` widget (ModuleHub modules inside SmartFactoryControlRoom)

File `widgets/SmartFactoryControlRoom/src/widgets/module-host.js`, registered
as type `module-host` via `SFP.widgets.register` (which automatically makes it
selectable in the dashboard editor catalog). NO changes to ModuleHub files are
needed by this widget — it speaks the same §4/§5 contract from its own code.

- `options`: `{ moduleId, staticBase?, storeUrl?, storeKey?, tagMap? }`. `bind`: unused.
  `tagMap` optionally maps module tag names → control-room datapoint ids.
- RESOURCE vs PERSISTENCE split (so a bundled visual works with no service):
  `resBase = staticBase || storeUrl` is where module.json + SDK + code load
  from; `storeUrl` is where tx/kv persist. `staticBase` points at a static tree
  mirroring the service layout (`/sdk/<file>`, `/modules/<id>/<file>`) — e.g.
  the same-origin `module-bundles/` produced by `scripts/sync-module-bundles.ps1`.
  When `storeUrl` is absent, store ops are in-session in-memory no-ops
  (`status` → `'local'`, `kv.get` → null/last-put, `tx.add` → incrementing id,
  `tx.query` → []) so the module renders and works without a backend; real
  persistence and the library picker require `storeUrl`.
- Validation: `moduleId` set needs a `resBase` (staticBase or storeUrl); no
  `moduleId` needs `storeUrl` (picker lists the service library).
- Boot: fetch `module.json`, entry file, and the four SDK files from the
  service (`storeUrl` + §11 endpoints, X-Api-Key header); build the sandboxed
  iframe exactly per §4 (allow-scripts only, srcdoc, `</script` escaping);
  drive the §5 bridge host-side:
  - `mh:subscribe` → manifest tag-glob check → dp = `tagMap[tag] || tag`; if
    `SFP.data.hub` has no def for dp, `hub.define(dp, { label: tag, source: { type:'omi', address: tag }, sim: <default generator> })`
    (mirror the sim-def shape used in `config/tags.config.js`), then
    `ctx.subscribe(dp, cb)` → forward as `mh:tagValue { tag, value, quality, ts }`.
  - `mh:writeTag` → glob check → `SFP.data.omiSource.writeTag(tag, value)`.
  - `mh:store` → ns check against manifest `permissions.store` + op whitelist
    (`tx.*`, `kv.*`, `status`) → direct REST per §7 against `storeUrl` (no
    IndexedDB fallback here; failures reject and the module surfaces them).
    `status` returns `'service'`.
  - `mh:init`: theme tokens harvested from the live CSS vars (`--c-<name>` for
    the §2 token list) so control-room theming flows through; `simulation` =
    `SFP.data.hub.mode === 'simulation'`; `assets` = the control room's own
    asset-model config tree when available, else null.
  - `ctx.onBus('theme:changed')` → re-harvest tokens → `mh:theme`.
  - Return `{ destroy }`: send `mh:destroy`, dispose listeners, remove iframe.
- Error card (themed, inside `ctx.root`) when `storeUrl` missing, service
  unreachable, module not in library, or permission file invalid.
- Demo surfacing: new `config/dashboards/modules.dashboard.js` with one
  `module-host` entry per demo, page entry in `config/app.config.js` pages
  array (`{ id:'modules', label:'Modules', dashboard:'modules' }` + an
  existing icon), and the two `<script>` tags in `index.html` (widget +
  dashboard config) in the marked sections.
