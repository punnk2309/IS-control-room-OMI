# modulehub-store

Lightweight Windows-deployable persistence service for the ModuleHub widget system.  
Node.js + [better-sqlite3](https://github.com/WiseLibs/better-sqlite3), no framework.  
Implements the §7 REST API and §8 retention policy from `docs/plans/modulehub-contracts.md`.

---

## API

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET`  | `/health` | optional | Server health, row count, db size, version |
| `POST` | `/tx` | optional | Append a transaction record → `201 { id }` |
| `GET`  | `/tx` | optional | Query transactions (filters below) → `200 [rows]` |
| `GET`  | `/kv/:ns/:key` | optional | Read a KV entry → `200 { value }` or `404` |
| `PUT`  | `/kv/:ns/:key` | optional | Upsert a KV entry (body `{ value }`) → `200 { ok:true }` |
| `GET`  | `/modules` | optional | List published modules → `200 [{ id, name, version, publishedAt }]` |
| `POST` | `/modules` | optional | Publish a module → `201 { id, version }` (see §11.1 below) |
| `GET`  | `/modules/:id/:file` | optional | Fetch a module file → `200` with content-type |
| `DELETE` | `/modules/:id` | optional | Remove a published module → `200 { ok:true }` or `404` |
| `GET`  | `/sdk/:file` | optional | Serve an SDK file (whitelist of 4 names) → `200` |
| `OPTIONS` | any | — | CORS preflight |

### POST /tx — body fields

| Field | Required | Notes |
|-------|----------|-------|
| `ns` | yes | Namespace string |
| `action` | yes | Action string |
| `ts` | no | Epoch ms (defaults to server now) |
| `user` | no | |
| `partType` | no | |
| `partId` | no | |
| `fromSlot` | no | |
| `toSlot` | no | |
| `note` | no | |
| `data` | no | Arbitrary JSON, stored as text |
| `buffered` | no | `true` if written via offline buffer |

### GET /tx — query params

`ns` (required), `from`, `to` (epoch ms), `partId`, `slot` (matches fromSlot OR toSlot),  
`action`, `limit` (default 500, max 5000). Results ordered `ts DESC`.

### Auth

Set `apiKey` in `config.json`. When non-empty every request must include header `X-Api-Key: <key>`.  
When `apiKey` is `""` (default) auth is disabled — suitable for localhost demos.

---

## Configuration (`config.json`)

| Key | Default | Description |
|-----|---------|-------------|
| `port` | `8743` | TCP port to listen on |
| `bind` | `"0.0.0.0"` | Bind address |
| `dbPath` | `"./data/modulehub.db"` | SQLite file path (relative to service dir) |
| `apiKey` | `""` | API key header value; empty = disabled |
| `maxRows` | `500000` | Maximum tx rows before pruning |
| `maxDbMB` | `512` | Maximum db file size (MB) before pruning |
| `backupDir` | `"./backups"` | Directory for backup files |
| `backupKeep` | `7` | Number of daily backups to retain |
| `libraryDir` | `"./library"` | Module library root (relative to service dir). Created on startup if missing. |
| `sdkDir` | `"../../widgets/ModuleHub/src/sdk"` | SDK source directory served at `/sdk/:file` (relative to service dir). |

Port can also be overridden with the `MHS_PORT` environment variable (useful for testing).

---

## Module Library (§11.1)

Published modules are stored as directories under `libraryDir` (`./library` by default).
Each module directory contains `module.json` plus the module's source files.

### POST /modules — body

```json
{
  "manifest": { "id": "my-module", "name": "My Module", "version": "1.0.0",
                "entry": "main.js", "permissions": {}, "config": {} },
  "files": {
    "main.js": "/* module code */",
    "styles.css": "/* optional css */"
  }
}
```

Add `?force=1` to overwrite an existing module at the same version.

**Validation** (all failures → `400 { error }`):

| Rule | Detail |
|------|--------|
| `manifest.id` | Must match `^[a-z][a-z0-9-]*$` (no leading `_`) |
| `manifest.entry` | Must be a key of `files` |
| File names | Each name must match `^[A-Za-z0-9._-]+\.(js\|json\|css)$` — flat, no `/` or `\` |
| Payload size | Total JSON body ≤ 2 MB → `400` (or `413` if the limit is hit mid-stream) |
| Version conflict | Same `id` + same `version` already exists → `409` unless `?force=1` |

Overwrite is atomic: files are written to `<id>.tmp/` first, then the directory is swapped in.

### GET /sdk/:file — whitelist

Only these four names are served; all others return `404`:

- `sdk-bootstrap.js`
- `sdk-data.js`
- `sdk-ui.js`
- `sdk-assets.js`

---

## Installation

### Recommended — nssm (Windows service)

1. Download [nssm](https://nssm.cc/download) and place `nssm.exe` on your PATH.
2. Open PowerShell **as Administrator** in this directory:
   ```powershell
   .\install-service.ps1
   ```
3. The script will:
   - Verify `node` is on PATH
   - Run `npm install --omit=dev`
   - Install and start a Windows service named `ModuleHubStore` (auto-start on boot)

To uninstall:
```powershell
.\install-service.ps1 -Uninstall
```

### Fallback — no nssm / Task Scheduler

If `nssm` is not found, the script generates `start-modulehub-store.cmd` and prints  
Task Scheduler setup instructions. Schedule that CMD file to run at startup.

### Manual

```powershell
cd services\modulehub-store
npm install
node server.js
```

---

## Backup & Retention (§8)

- **Row/size cap**: after every 1000 inserts (and at startup), if `tx` row count > `maxRows` or  
  db file > `maxDbMB` MB, the oldest rows are deleted in 5000-row batches until 10% under cap.  
  A backup is **always** made immediately before any prune cycle runs.
- **Nightly backup**: every 24 h the db is copied to `backupDir/modulehub-YYYYMMDD.db` via  
  better-sqlite3's `.backup()` API (hot, consistent). Only `backupKeep` newest files are kept.
- **Weekly VACUUM**: runs if the last vacuum was > 7 days ago; timestamp persisted in the `kv`  
  table under `ns=_meta, key=lastVacuum`.

---

## SQLite file locations

| Path | Contents |
|------|----------|
| `data/modulehub.db` | Live database (WAL mode) |
| `data/modulehub.db-wal` | WAL file (auto-managed) |
| `data/modulehub.db-shm` | Shared memory file (auto-managed) |
| `backups/modulehub-YYYYMMDD.db` | Daily backup snapshots |
