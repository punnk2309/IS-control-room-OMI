# Store and Persistence

ModuleHub modules write and read persistent data through the SDK's `sdk.store`
interface. The host handles where data actually lives; the module code is
identical in all three modes.

---

## Three Storage Modes

The current mode is returned by `sdk.store.status()` and is reflected by a
status indicator in the shell header.

### `'service'` — REST store (green dot)

The `storeUrl` OMI property is set and the service is reachable. All `tx.add`
and `kv.put` calls go to the REST API over HTTP. Data is stored in a
server-side SQLite database (`services/modulehub-store`). This is the
recommended mode for production: data is shared across clients and survives
browser clears.

### `'buffered'` — Offline buffer (amber dot)

`storeUrl` is set but the service is temporarily unreachable (network error or
timeout after 3 s). The host writes new `tx.add` records to a browser IndexedDB
object store named `txbuf` (ring buffer, 50 000 rows maximum — oldest evicted
when full), marking them `buffered: true`. A reconnect loop runs every 30 s:
when the service is reachable again, buffered rows are replayed oldest-first
with `buffered: true` in the POST body, and deleted from IndexedDB on 2xx.
`kv.put` and `kv.get` are served from a local IndexedDB `kv` store during
buffering.

### `'local'` — IndexedDB only (grey dot)

`storeUrl` is empty. All data lives in browser IndexedDB (`mhb-store` database),
with object stores `tx` and `kv`. Queries are executed in JavaScript with the
same filter semantics as the REST API. Data is browser-local, per-origin, and
does not survive a profile wipe. Suitable for standalone demos and development.

---

## REST API Summary

Base URL: `storeUrl` property (default port **8743**). Optional auth via
`X-Api-Key` header (see `storeKey` property; empty key disables auth).

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/health` | optional | Server health: `{ ok, rows, dbMB, version }` |
| `POST` | `/tx` | optional | Append transaction → `201 { id }` |
| `GET` | `/tx` | optional | Query transactions → `200 [rows]` |
| `GET` | `/kv/:ns/:key` | optional | Read KV value → `200 { value }` or `404 { error }` |
| `PUT` | `/kv/:ns/:key` | optional | Upsert KV value (body `{ value }`) → `200 { ok: true }` |
| `OPTIONS` | any | — | CORS preflight |

### POST /tx — body fields

| Field | Required | Notes |
|---|---|---|
| `ns` | yes | Namespace string |
| `action` | yes | Action label |
| `ts` | no | Epoch ms; defaults to server now |
| `user` | no | Username |
| `partType` | no | Part category |
| `partId` | no | Part identifier |
| `fromSlot` | no | Source slot |
| `toSlot` | no | Destination slot |
| `note` | no | Free-text note |
| `data` | no | Arbitrary JSON (stored as text) |
| `buffered` | no | `true` when replayed from offline buffer |

`ns` and `action` are required; missing either returns `400 { error }`.

### GET /tx — query parameters

| Parameter | Notes |
|---|---|
| `ns` | Required |
| `from`, `to` | Epoch ms range |
| `partId` | Filter by part id |
| `slot` | Matches `fromSlot` OR `toSlot` |
| `action` | Exact action match |
| `limit` | Default 500, max 5000; results ordered `ts DESC` |

### SQLite Schema (informational)

```sql
CREATE TABLE tx (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  ns       TEXT    NOT NULL,
  ts       INTEGER NOT NULL,
  user     TEXT,
  partType TEXT,
  partId   TEXT,
  fromSlot TEXT,
  toSlot   TEXT,
  action   TEXT    NOT NULL,
  note     TEXT,
  data     TEXT,
  buffered INTEGER DEFAULT 0
);
-- Indexes: (ns, ts), (partId)

CREATE TABLE kv (
  ns      TEXT,
  key     TEXT,
  value   TEXT,
  updated INTEGER,
  PRIMARY KEY (ns, key)
);
```

WAL mode is enabled on database open.

---

## Retention and Self-Management

The service manages its own disk footprint without manual intervention.

**Row/size cap** — After every 1 000 inserts (and at startup), if the `tx` row
count exceeds `maxRows` (default 500 000) or the SQLite file exceeds `maxDbMB`
(default 512 MB), the service deletes the oldest `tx` rows in 5 000-row batches
until the store is 10% under the cap. A backup is **always** made immediately
before a prune cycle runs.

**Nightly backup** — Every 24 hours the database is copied hot (using
better-sqlite3's `.backup()` API) to `backupDir/modulehub-YYYYMMDD.db`. Only
the `backupKeep` newest files (default 7) are retained.

**Weekly VACUUM** — If more than 7 days have elapsed since the last VACUUM
(tracked in the `kv` table under `ns=_meta, key=lastVacuum`), a `VACUUM`
statement runs to reclaim freed pages.

Configuration is in `services/modulehub-store/config.json`:

| Key | Default | Description |
|---|---|---|
| `port` | `8743` | TCP listen port |
| `bind` | `"0.0.0.0"` | Bind address |
| `dbPath` | `"./data/modulehub.db"` | SQLite file (relative to service dir) |
| `apiKey` | `""` | API key; empty = auth disabled |
| `maxRows` | `500000` | Max tx rows before pruning |
| `maxDbMB` | `512` | Max db file size (MB) before pruning |
| `backupDir` | `"./backups"` | Backup output directory |
| `backupKeep` | `7` | Daily backups to retain |

---

## IndexedDB Fallback and Replay Semantics

When the service is unreachable, the host-side store client writes to IndexedDB
database `mhb-store`. The `txbuf` object store acts as a ring buffer capped at
50 000 rows: when the buffer is full, the oldest entries are evicted before new
ones are inserted. This matches the service's own ring-buffer eviction policy
so no special handling is needed when replaying.

On reconnect, buffered rows are replayed oldest-first via `POST /tx` with
`buffered: true`. A 2xx response triggers deletion from `txbuf`. A failure
leaves the row in the buffer for the next retry cycle (every 30 s).

In pure local mode (`storeUrl` empty) there is no `txbuf`. The `tx` object store
holds all records and the `kv` object store handles KV operations. Queries
against `tx` apply the same filter fields (ns, from, to, partId, slot, action,
limit) in JavaScript, so module code behaves identically regardless of mode.

---

## Demo Module Namespaces

The two built-in demo modules use the following reserved namespaces. Custom
modules must not use these names.

| Namespace | Module | Contents |
|---|---|---|
| `bagfilter` | bag-filter-tracker | Part movement transactions (install, remove, detach, bag on/off) and in-use history per slot/serial |
| `mollier` | mollier-monitor | (reserved for future persistent alarm/annotation records) |
| `_studio` | Studio (internal) | Module source snapshots and publish history; managed by the host shell |

`_meta` is used internally by the store service retention system
(`ns=_meta, key=lastVacuum`) and must not be written by modules.
