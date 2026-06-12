# Module Developer Guide

A ModuleHub module is a folder containing a `module.json` manifest and a plain
JavaScript entry file. The entry file registers a lifecycle object with
`MH.register()`. The SDK — injected by the host into a sandboxed iframe — is
the only interface a module needs; it handles all communication with OMI, the
store service, and the shell.

---

## module.json Schema

Every module folder must contain a `module.json` at its root.

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

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | yes | Folder name under `modules/`. Pattern: `[a-z0-9-]+`. |
| `name` | string | yes | Human-readable display name shown in the shell header. |
| `version` | string | yes | Semver string; bump when publishing updates. |
| `minSdk` | string | yes | Minimum SDK version required. Current SDK is `"1.0"`. |
| `entry` | string | yes | Entry file name relative to the module folder (typically `"main.js"`). |
| `permissions.tags` | string[] | yes | Tag-name globs the module may subscribe to or write. `*` is a wildcard segment. Empty array = no tag access. |
| `permissions.store` | string[] | yes | Store namespaces the module may read and write. Empty array = no store access. |
| `config` | object | no | Default configuration block; passed to `create()` as `sdk.config`. |

Tag glob matching converts each pattern to a `^…$` regex (only `*` is a wildcard
segment). Example: `"dryer.*"` allows `dryer.inlet.t`, `dryer.outlet.rh`, etc.

---

## Module Lifecycle

The entry file must call `MH.register()` exactly once at the top level:

```js
MH.register({
  create: function (sdk, root) {
    // Build UI under root. root fills the iframe body.
    var h2 = sdk.ui.el('h2', {}, 'Hello ModuleHub');
    root.appendChild(h2);
  },
  destroy: function () {
    // Optional. Clean up timers, subscriptions, canvas contexts, etc.
  }
});
```

- `create(sdk, root)` is called once after the host sends `mh:init`. `root` is
  a `<div>` with `position:absolute; inset:0; overflow:hidden` filling the
  iframe body.
- `destroy()` is optional. Called when the host sends `mh:destroy` (module
  unloaded or shell navigated away). Use it to cancel `setInterval`/`requestAnimationFrame`.
- The module file runs inside `sandbox="allow-scripts"` with no
  `allow-same-origin`. It cannot access `window.parent` properties, cookies,
  localStorage, or any DOM outside the iframe. Every outside operation goes
  through `sdk`.

---

## Full SDK Reference

`create(sdk, root)` receives the `sdk` object with the following members.

### `sdk.env`

Read-only context object.

| Member | Type | Description |
|---|---|---|
| `env.moduleId` | string | The module's `id` from `module.json`. |
| `env.version` | string | The module's `version` from `module.json`. |
| `env.simulation` | boolean | `true` when the shell is running in simulation mode (no live OMI host). |
| `env.sdkVersion` | string | Host SDK version (e.g. `"1.0"`). |

### `sdk.config`

The `config` block from `module.json`, deep-merged with any host-side overrides.
Use this for tunable parameters (slot counts, thresholds, tag mappings, chart bounds).

### `sdk.data`

Tag subscription and write access. The host enforces `permissions.tags`.

```js
// Subscribe to a tag
var unsub = sdk.data.subscribe('dryer.outlet.t', function (sample) {
  // sample: { value, quality, ts }  (ts = epoch ms)
  console.log(sample.value, sample.quality);
});

// Unsubscribe
unsub();

// Write a tag value
sdk.data.write('dryer.lumpingWarn', 1).then(function () {
  // resolved when the write request is acknowledged by the host
});
```

| Member | Signature | Returns | Notes |
|---|---|---|---|
| `data.subscribe(tag, cb)` | `(string, fn)` | unsubscribe function | `cb` called on each new value. Permission-denied yields an error result on the bridge; no callback is ever fired. |
| `data.write(tag, value)` | `(string, any)` | `Promise<void>` | Rejects on permission denial or OMI error. |

In simulation mode `data.subscribe` receives random-walk values (0–100 range,
1 s cadence, quality `'Simulated'`). `data.write` resolves silently without
reaching OMI.

### `sdk.store`

Persistent storage. Two surfaces: `tx` (append-only transaction log) and `kv`
(key-value store). The host enforces `permissions.store` on every call.
The implementation transparently routes to the service REST API, the IndexedDB
buffer, or local IndexedDB depending on connectivity — the module sees only
Promises.

```js
// Append a transaction record
sdk.store.tx.add({
  ns: 'bagfilter',
  action: 'install',
  partType: 'bag',
  partId: 'BAG-0042',
  toSlot: 'F-012',
  user: 'operator1',
  note: 'Routine replacement'
}).then(function (result) {
  console.log('stored with id', result.id);
});

// Query transactions
sdk.store.tx.query({
  ns: 'bagfilter',
  partId: 'BAG-0042',
  limit: 50
}).then(function (rows) {
  rows.forEach(function (r) { console.log(r.ts, r.action); });
});

// KV read/write
sdk.store.kv.put('bagfilter', 'lastSync', Date.now());
sdk.store.kv.get('bagfilter', 'lastSync').then(function (v) {
  console.log(v);  // value or null
});

// Current store mode
var mode = sdk.store.status();  // 'service' | 'buffered' | 'local'
```

#### `sdk.store.tx.add(tx)` — `tx` fields

| Field | Required | Description |
|---|---|---|
| `ns` | yes | Namespace string (must be in `permissions.store`). |
| `action` | yes | Action label string (e.g. `'install'`, `'remove'`). |
| `ts` | no | Epoch ms timestamp. Defaults to server now. |
| `user` | no | Username string. |
| `partType` | no | Part category string. |
| `partId` | no | Part serial or identifier. |
| `fromSlot` | no | Source slot identifier. |
| `toSlot` | no | Destination slot identifier. |
| `note` | no | Free-text note. |
| `data` | no | Arbitrary JSON value; stored as text. |

#### `sdk.store.tx.query(filter)` — filter fields

| Field | Notes |
|---|---|
| `ns` | Required. |
| `from`, `to` | Epoch ms range. |
| `partId` | Filter by part id. |
| `slot` | Matches `fromSlot` OR `toSlot`. |
| `action` | Exact action match. |
| `limit` | Row limit; default 500, max 5000. Results ordered `ts DESC`. |

#### `sdk.store.status()`

Returns a string indicating the current store connection state:

| Value | Meaning |
|---|---|
| `'service'` | Connected to the REST service; data is server-durable. |
| `'buffered'` | Service unreachable; writes are buffered to IndexedDB and will replay on reconnect. |
| `'local'` | No `storeUrl` configured; all data lives in browser IndexedDB only. |

Status is polled asynchronously in the background; the call is synchronous.

### `sdk.ui`

DOM helpers and UX utilities.

```js
// Build a DOM element
var card = sdk.ui.el('div',
  { className: 'card', style: { background: 'var(--c-bg-card)' } },
  [
    sdk.ui.el('span', {}, 'Value:'),
    sdk.ui.el('strong', { id: 'val' }, '—'),
  ]
);

// Color token lookup
var accent = sdk.ui.color('accent');          // → CSS color string
var miss   = sdk.ui.color('nonexistent');     // → '#888888'

// Drag helper
sdk.ui.makeDraggable(card, {
  handle: card.querySelector('.drag-handle'),  // optional; default = whole element
  onStart: function () { card.style.opacity = '0.7'; },
  onMove:  function (dx, dy, ev) {
    card.style.left = (parseFloat(card.style.left) + dx) + 'px';
    card.style.top  = (parseFloat(card.style.top)  + dy) + 'px';
  },
  onDrop:  function (ev) { card.style.opacity = '1'; }
});

// Toast notification
sdk.ui.toast('Replacement due in 50 h', 'warn');  // 'info'|'good'|'warn'|'alarm'
```

| Member | Signature | Description |
|---|---|---|
| `ui.color(token)` | `(string) → string` | Returns the CSS color for a theme token. Passes through `#rrggbb` / `rgb(…)` strings unchanged; reads `--c-<token>` from the iframe root; returns `'#888888'` on miss. |
| `ui.el(tag, attrs, children)` | `(string, object, string\|Node\|Array) → HTMLElement` | Minimal DOM builder. `attrs.style` may be a plain object. `children` may be a string, a single Node, or an array of either. |
| `ui.makeDraggable(el, opts)` | `(HTMLElement, object) → void` | Installs pointer-event drag on `el`. `opts.handle` (optional HTMLElement), `opts.onStart()`, `opts.onMove(dx,dy,ev)`, `opts.onDrop(ev)`. |
| `ui.toast(msg, kind)` | `(string, string) → void` | Displays a transient toast in the shell chrome. `kind`: `'info'` / `'good'` / `'warn'` / `'alarm'`. |

### `sdk.assets`

Slim DS650 asset-model access. Data comes from an embedded snapshot
(`sdk-assets-data.js`); no network call is made.

```js
var root     = sdk.assets.root();                    // root plant node
var unit     = sdk.assets.node('0017-NIF-LIN01');    // node by dash-joined path
var children = sdk.assets.children('0017-NIF');      // direct children array
var tagList  = sdk.assets.tagsUnder('0017-NIF-LIN01'); // all tags at or below path
```

| Member | Signature | Description |
|---|---|---|
| `assets.root()` | `() → node` | Returns the root plant node of the embedded asset tree. |
| `assets.node(pathCode)` | `(string) → node\|null` | Finds a node by its dash-joined DS650 path. |
| `assets.children(pathCode)` | `(string) → node[]` | Returns direct children of the node at `pathCode`, or `[]`. |
| `assets.tagsUnder(pathCode)` | `(string) → string[]` | Returns all tag names at or below `pathCode`. |

### `sdk.log(...args)`

Relays `console.log`-style messages to the host browser console, prefixed
`[MH:<moduleId>]`. Use instead of `console.log` for visibility in the host
DevTools.

```js
sdk.log('loaded', sdk.env.moduleId, 'simulation=', sdk.env.simulation);
```

---

## Permissions Model

Permissions are declared in `module.json` and enforced by the host at the
bridge layer. A module cannot bypass them because it runs in `allow-scripts`
sandbox without `allow-same-origin`, so it has no access to the parent frame.

- **Tag access**: every `mh:subscribe` and `mh:writeTag` message is checked
  against `permissions.tags`. If the tag does not match any glob pattern the
  host returns `mh:result { ok: false, error: 'permission-denied: <detail>' }`.
- **Store access**: every `mh:store` message includes a namespace. The host
  checks `payload.ns` against `permissions.store`. Denied operations resolve
  with a rejection error on the Promise.
- **No cross-module access**: each module's permissions are independent; a
  module cannot name another module's namespace even if the host has it loaded.

---

## Simulation Mode

When `sdk.env.simulation` is `true` (no live OMI host detected):

- `sdk.data.subscribe` delivers random-walk values, starting at 50, stepping ±5
  per second, clamped to the range 0–100. Quality is always `'Simulated'`.
  The Mollier demo overrides per-tag ranges via its `config.simRanges` block.
- `sdk.data.write` resolves immediately without side effects.
- `sdk.store` functions normally (IndexedDB local mode unless `storeUrl` is set
  and reachable, in which case the service is used even in simulation).

This makes demos fully runnable from a static file server without any plant
connection.

---

## Theming

Use CSS custom properties for all colors; never hard-code hex values. The host
applies the selected theme's token map to the iframe root before calling
`create()`, and re-applies it whenever the shell theme changes (`mh:theme`).

Token names follow the pattern `--c-<name>`. Available tokens (defined in
§2 of `docs/plans/modulehub-contracts.md`):

| Token | Purpose |
|---|---|
| `--c-bg-base` | Page/widget background |
| `--c-bg-surface` | Panel surface |
| `--c-bg-card` | Card background |
| `--c-bg-raised` | Elevated element background |
| `--c-border` | Default border |
| `--c-border-strong` | Prominent border |
| `--c-text-1` | Primary text |
| `--c-text-2` | Secondary text |
| `--c-text-3` | Muted/tertiary text |
| `--c-accent` | Brand accent |
| `--c-accent-strong` | Strong/hover accent |
| `--c-good` | Success / in-range |
| `--c-warn` | Warning |
| `--c-alarm` | Alarm / critical |
| `--c-info` | Informational |
| `--c-chart-1` … `--c-chart-4` | Chart series colors |

```css
/* Example: use tokens in module CSS */
.card {
  background: var(--c-bg-card);
  border: 1px solid var(--c-border);
  color: var(--c-text-1);
}
.status-good  { color: var(--c-good); }
.status-alarm { color: var(--c-alarm); }
```

You can also resolve a token to a color string at runtime via `sdk.ui.color('accent')`,
which is useful for Canvas 2D drawing.

---

## Studio Workflow

The Studio is accessible from the shell header when the `canEdit` OMI property
is `true`.

1. **Create from template** — Studio generates a starter `module.json` and
   `main.js` with `MH.register()` scaffolding. Fill in the id, name, permissions,
   and config block in the manifest form.
2. **Edit** — A code editor (textarea with basic lint) lets you modify `main.js`.
   A live preview pane re-runs the module against simulation data on each save.
3. **Lint** — Studio warns on common issues (missing `MH.register`, syntax
   errors, use of disallowed globals).
4. **Preview** — The preview iframe runs the current editor code with
   `sdk.env.simulation = true`; all SDK calls behave normally.
5. **Version bump** — Increment patch/minor/major in the manifest form before
   publishing.
6. **Export `.mhmod`** — Downloads a zip archive of the module folder, named
   `<id>-v<version>.mhmod`. This file can be shared or imported on another
   ModuleHub instance.
7. **Import `.mhmod`** — Studio accepts a `.mhmod` drop or file picker; it
   extracts the archive into `modules/` and refreshes the module list.

---

## Manual Deployment (without Studio)

Use this method to deploy a module by hand or via CI.

1. Create a folder `widgets/ModuleHub/modules/<id>/` containing `module.json`
   and `main.js` (plus any other files your module needs — CSS, images, etc.).
2. Open `widgets/ModuleHub/modules/index.json` and add the module id to the
   array:
   ```json
   ["_smoke", "bag-filter-tracker", "mollier-monitor", "your-module-id"]
   ```
3. Repackage the CWP:
   ```powershell
   .\scripts\package-cwp.ps1 -WidgetName ModuleHub
   ```
4. Reimport the new `.cwp` into OMI (or deploy to the static server for demo
   mode). The registry reads `index.json` at runtime and the new module is
   available in the shell's module switcher.
