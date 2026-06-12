'use strict';

/**
 * server.js — ModuleHub Store service
 * §7 REST API + §8 retention, built-in http module + better-sqlite3 only.
 */

const http      = require('http');
const fs        = require('fs');
const path      = require('path');
const retention = require('./retention');

const VERSION = '0.1.0';

// ─── config ─────────────────────────────────────────────────────────────────

const CFG_PATH = path.join(__dirname, process.env.MHS_CONFIG || 'config.json');
let cfg = {
  port:       8743,
  bind:       '0.0.0.0',
  dbPath:     './data/modulehub.db',
  apiKey:     '',
  maxRows:    500_000,
  maxDbMB:    512,
  backupDir:  './backups',
  backupKeep: 7,
};

try {
  const raw = fs.readFileSync(CFG_PATH, 'utf8');
  Object.assign(cfg, JSON.parse(raw));
} catch (e) {
  console.warn(`[server] config.json not found or invalid, using defaults: ${e.message}`);
}

// Allow port override via env (handy for tests without touching config.json)
if (process.env.MHS_PORT) cfg.port = parseInt(process.env.MHS_PORT, 10);

// ─── library / SDK dirs ──────────────────────────────────────────────────────

const LIBRARY_DIR = path.isAbsolute(cfg.libraryDir || './library')
  ? cfg.libraryDir
  : path.resolve(__dirname, cfg.libraryDir || './library');

const SDK_DIR = path.isAbsolute(cfg.sdkDir || '../../widgets/ModuleHub/src/sdk')
  ? cfg.sdkDir
  : path.resolve(__dirname, cfg.sdkDir || '../../widgets/ModuleHub/src/sdk');

// Ensure library dir exists
fs.mkdirSync(LIBRARY_DIR, { recursive: true });

// ─── DB setup ────────────────────────────────────────────────────────────────

const DB_PATH = path.isAbsolute(cfg.dbPath)
  ? cfg.dbPath
  : path.resolve(__dirname, cfg.dbPath);

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const Database = require('better-sqlite3');
const db = new Database(DB_PATH);

// WAL mode
db.pragma('journal_mode = WAL');

// Schema
db.exec(`
  CREATE TABLE IF NOT EXISTS tx (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    ns        TEXT    NOT NULL,
    ts        INTEGER NOT NULL,
    user      TEXT,
    partType  TEXT,
    partId    TEXT,
    fromSlot  TEXT,
    toSlot    TEXT,
    action    TEXT    NOT NULL,
    note      TEXT,
    data      TEXT,
    buffered  INTEGER DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_tx_ns_ts   ON tx(ns, ts);
  CREATE INDEX IF NOT EXISTS idx_tx_partId  ON tx(partId);

  CREATE TABLE IF NOT EXISTS kv (
    ns      TEXT    NOT NULL,
    key     TEXT    NOT NULL,
    value   TEXT,
    updated INTEGER,
    PRIMARY KEY (ns, key)
  );
`);

// ─── helpers ─────────────────────────────────────────────────────────────────

const BODY_LIMIT = 1 * 1024 * 1024;  // 1 MB

function readBody(req) {
  return new Promise((resolve, reject) => {
    let buf = '';
    let len = 0;
    req.on('data', chunk => {
      len += chunk.length;
      if (len > BODY_LIMIT) {
        reject(Object.assign(new Error('Payload Too Large'), { status: 413 }));
        req.destroy();
        return;
      }
      buf += chunk;
    });
    req.on('end', () => {
      try {
        resolve(buf.length ? JSON.parse(buf) : {});
      } catch {
        reject(Object.assign(new Error('Invalid JSON'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function send(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type':  'application/json',
    'Content-Length': Buffer.byteLength(payload),
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-Api-Key',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  });
  res.end(payload);
}

function getDbMB() {
  try {
    const { page_count } = db.prepare('PRAGMA page_count').get();
    const { page_size }  = db.prepare('PRAGMA page_size').get();
    return parseFloat(((page_count * page_size) / (1024 * 1024)).toFixed(3));
  } catch { return 0; }
}

// URL parser helper: strip query string
function parsePath(url) {
  const idx = url.indexOf('?');
  return idx === -1 ? url : url.slice(0, idx);
}

function parseQuery(url) {
  const idx = url.indexOf('?');
  if (idx === -1) return {};
  const qs = url.slice(idx + 1);
  const out = {};
  for (const part of qs.split('&')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const k = decodeURIComponent(part.slice(0, eq));
    const v = decodeURIComponent(part.slice(eq + 1));
    out[k] = v;
  }
  return out;
}

const LIBRARY_BODY_LIMIT = 2 * 1024 * 1024;  // 2 MB (§11.1)

const SDK_WHITELIST = new Set(['sdk-bootstrap.js', 'sdk-data.js', 'sdk-ui.js', 'sdk-assets.js']);

const FILE_NAME_RE = /^[A-Za-z0-9._-]+\.(js|json|css)$/;
const MODULE_ID_RE = /^[a-z][a-z0-9-]*$/;

const EXT_CONTENT_TYPES = { js: 'application/javascript', json: 'application/json', css: 'text/css' };

function sendFile(res, filePath, contentType) {
  let data;
  try { data = fs.readFileSync(filePath); }
  catch { return false; }
  res.writeHead(200, {
    'Content-Type':  contentType,
    'Content-Length': data.length,
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-Api-Key',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  });
  res.end(data);
  return true;
}

function readBodyLib(req) {
  return new Promise((resolve, reject) => {
    let buf = '';
    let len = 0;
    req.on('data', chunk => {
      len += chunk.length;
      if (len > LIBRARY_BODY_LIMIT) {
        reject(Object.assign(new Error('Payload Too Large'), { status: 413 }));
        req.destroy();
        return;
      }
      buf += chunk;
    });
    req.on('end', () => {
      try { resolve(buf.length ? JSON.parse(buf) : {}); }
      catch { reject(Object.assign(new Error('Invalid JSON'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

// ─── route handlers ──────────────────────────────────────────────────────────

// ── §11.1  GET /modules ───────────────────────────────────────────────────────
function handleGetModules(req, res) {
  let entries;
  try { entries = fs.readdirSync(LIBRARY_DIR, { withFileTypes: true }); }
  catch { return send(res, 200, []); }

  const out = [];
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const id = ent.name;
    if (!MODULE_ID_RE.test(id)) continue;
    const manifestPath = path.join(LIBRARY_DIR, id, 'module.json');
    try {
      const raw      = fs.readFileSync(manifestPath, 'utf8');
      const manifest = JSON.parse(raw);
      const stat     = fs.statSync(manifestPath);
      out.push({
        id:          manifest.id || id,
        name:        manifest.name || id,
        version:     manifest.version || '0.0.0',
        publishedAt: Math.floor(stat.mtimeMs),
      });
    } catch { /* skip corrupt entries */ }
  }
  send(res, 200, out);
}

// ── §11.1  POST /modules ─────────────────────────────────────────────────────
async function handlePostModules(req, res) {
  let body;
  try { body = await readBodyLib(req); }
  catch (e) { return send(res, e.status || 400, { error: e.message }); }

  const { manifest, files } = body;
  if (!manifest || typeof manifest !== 'object') {
    return send(res, 400, { error: 'manifest object required' });
  }
  if (!files || typeof files !== 'object') {
    return send(res, 400, { error: 'files object required' });
  }

  // Validate manifest.id
  if (!manifest.id || !MODULE_ID_RE.test(manifest.id)) {
    return send(res, 400, { error: 'manifest.id must match ^[a-z][a-z0-9-]*$' });
  }

  // Validate manifest.entry is a key of files
  if (!manifest.entry || !Object.prototype.hasOwnProperty.call(files, manifest.entry)) {
    return send(res, 400, { error: 'manifest.entry must be a key of files' });
  }

  // Validate each file name
  for (const name of Object.keys(files)) {
    if (!FILE_NAME_RE.test(name)) {
      return send(res, 400, { error: `file name "${name}" must match ^[A-Za-z0-9._-]+\\.(js|json|css)$ (no path separators)` });
    }
  }

  const id         = manifest.id;
  const moduleDir  = path.join(LIBRARY_DIR, id);
  const tmpDir     = path.join(LIBRARY_DIR, id + '.tmp');

  // Version-conflict check
  const query  = parseQuery(req.url);
  const force  = query.force === '1';
  const existingManifest = path.join(moduleDir, 'module.json');
  if (!force && fs.existsSync(existingManifest)) {
    try {
      const existing = JSON.parse(fs.readFileSync(existingManifest, 'utf8'));
      if (existing.version === manifest.version) {
        return send(res, 409, { error: `version ${manifest.version} already published; use ?force=1 to overwrite` });
      }
    } catch { /* treat as non-existent */ }
  }

  // Atomic write: write to tmp, then rename
  try {
    // Clean up any leftover tmp
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });

    // Write module.json from manifest (ignoring any files['module.json'])
    fs.writeFileSync(path.join(tmpDir, 'module.json'), JSON.stringify(manifest, null, 2), 'utf8');

    // Write each file (skip module.json — already written from manifest)
    for (const [name, content] of Object.entries(files)) {
      if (name === 'module.json') continue;
      fs.writeFileSync(path.join(tmpDir, name), content, 'utf8');
    }

    // Atomic swap: remove existing dir, rename tmp
    if (fs.existsSync(moduleDir)) fs.rmSync(moduleDir, { recursive: true, force: true });
    fs.renameSync(tmpDir, moduleDir);
  } catch (e) {
    // Clean up on failure
    try { if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    console.error('[library] write error:', e);
    return send(res, 500, { error: 'failed to write module files' });
  }

  send(res, 201, { id, version: manifest.version });
}

// ── §11.1  GET /modules/:id/:file ────────────────────────────────────────────
function handleGetModuleFile(req, res, id, file) {
  // Defend against traversal in both id and file
  if (!MODULE_ID_RE.test(id))       return send(res, 404, { error: 'not found' });
  if (!FILE_NAME_RE.test(file))     return send(res, 404, { error: 'not found' });

  // Resolve and verify the resolved path stays inside the module's dir
  const moduleDir  = path.join(LIBRARY_DIR, id);
  const resolved   = path.resolve(moduleDir, file);
  if (!resolved.startsWith(moduleDir + path.sep) && resolved !== moduleDir) {
    return send(res, 404, { error: 'not found' });
  }

  // Only serve flat names (no subdirectory)
  if (path.dirname(resolved) !== moduleDir) return send(res, 404, { error: 'not found' });

  const ext         = path.extname(file).slice(1);
  const contentType = EXT_CONTENT_TYPES[ext] || 'text/plain';

  if (!sendFile(res, resolved, contentType)) {
    send(res, 404, { error: 'not found' });
  }
}

// ── §11.1  DELETE /modules/:id ────────────────────────────────────────────────
function handleDeleteModule(req, res, id) {
  if (!MODULE_ID_RE.test(id)) return send(res, 404, { error: 'not found' });
  const moduleDir = path.join(LIBRARY_DIR, id);
  if (!fs.existsSync(moduleDir)) return send(res, 404, { error: 'not found' });
  try {
    fs.rmSync(moduleDir, { recursive: true, force: true });
    send(res, 200, { ok: true });
  } catch (e) {
    console.error('[library] delete error:', e);
    send(res, 500, { error: 'failed to delete module' });
  }
}

// ── §11.1  GET /sdk/:file ─────────────────────────────────────────────────────
function handleGetSdk(req, res, file) {
  if (!SDK_WHITELIST.has(file)) return send(res, 404, { error: 'not found' });
  const resolved = path.resolve(SDK_DIR, file);
  // Verify resolved path stays within SDK_DIR
  if (!resolved.startsWith(SDK_DIR + path.sep) && resolved !== path.join(SDK_DIR, file)) {
    return send(res, 404, { error: 'not found' });
  }
  const ext         = path.extname(file).slice(1);
  const contentType = EXT_CONTENT_TYPES[ext] || 'text/plain';
  if (!sendFile(res, resolved, contentType)) {
    send(res, 404, { error: 'not found' });
  }
}

function handleHealth(req, res) {
  const rows = db.prepare('SELECT COUNT(*) AS n FROM tx').get().n;
  send(res, 200, { ok: true, rows, dbMB: getDbMB(), version: VERSION });
}

async function handlePostTx(req, res) {
  let body;
  try { body = await readBody(req); }
  catch (e) { return send(res, e.status || 400, { error: e.message }); }

  if (!body.ns || typeof body.ns !== 'string') {
    return send(res, 400, { error: 'ns is required' });
  }
  if (!body.action || typeof body.action !== 'string') {
    return send(res, 400, { error: 'action is required' });
  }

  const ts = (typeof body.ts === 'number') ? body.ts : Date.now();
  const dataStr = (body.data !== undefined && body.data !== null)
    ? JSON.stringify(body.data)
    : null;

  const stmt = db.prepare(`
    INSERT INTO tx(ns, ts, user, partType, partId, fromSlot, toSlot, action, note, data, buffered)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    body.ns,
    ts,
    body.user    ?? null,
    body.partType ?? null,
    body.partId  ?? null,
    body.fromSlot ?? null,
    body.toSlot  ?? null,
    body.action,
    body.note    ?? null,
    dataStr,
    body.buffered ? 1 : 0,
  );

  // retention hook (fire-and-forget, don't hold the response)
  retention.afterInsert().catch(e => console.error('[retention] afterInsert error:', e));

  send(res, 201, { id: result.lastInsertRowid });
}

function handleGetTx(req, res) {
  const q = parseQuery(req.url);

  if (!q.ns) return send(res, 400, { error: 'ns query param required' });

  let limit = q.limit ? parseInt(q.limit, 10) : 500;
  if (isNaN(limit) || limit < 1) limit = 500;
  if (limit > 5000) limit = 5000;

  const conditions = ['ns = ?'];
  const params     = [q.ns];

  if (q.from) {
    conditions.push('ts >= ?');
    params.push(parseInt(q.from, 10));
  }
  if (q.to) {
    conditions.push('ts <= ?');
    params.push(parseInt(q.to, 10));
  }
  if (q.partId) {
    conditions.push('partId = ?');
    params.push(q.partId);
  }
  if (q.slot) {
    conditions.push('(fromSlot = ? OR toSlot = ?)');
    params.push(q.slot, q.slot);
  }
  if (q.action) {
    conditions.push('action = ?');
    params.push(q.action);
  }

  const sql  = `SELECT * FROM tx WHERE ${conditions.join(' AND ')} ORDER BY ts DESC LIMIT ?`;
  params.push(limit);

  const rows = db.prepare(sql).all(...params);

  // Parse data JSON for each row
  const out = rows.map(r => {
    if (r.data !== null && r.data !== undefined) {
      try { r.data = JSON.parse(r.data); } catch { /* leave as string */ }
    }
    return r;
  });

  send(res, 200, out);
}

function handleGetKv(req, res, ns, key) {
  const row = db.prepare('SELECT value FROM kv WHERE ns=? AND key=?').get(ns, key);
  if (!row) return send(res, 404, { error: 'not found' });
  let value;
  try { value = JSON.parse(row.value); } catch { value = row.value; }
  send(res, 200, { value });
}

async function handlePutKv(req, res, ns, key) {
  let body;
  try { body = await readBody(req); }
  catch (e) { return send(res, e.status || 400, { error: e.message }); }

  if (!('value' in body)) return send(res, 400, { error: 'value field required' });

  const valueStr = JSON.stringify(body.value);
  db.prepare(
    'INSERT INTO kv(ns,key,value,updated) VALUES(?,?,?,?) ON CONFLICT(ns,key) DO UPDATE SET value=excluded.value, updated=excluded.updated'
  ).run(ns, key, valueStr, Date.now());

  send(res, 200, { ok: true });
}

// ─── main request handler ────────────────────────────────────────────────────

async function onRequest(req, res) {
  const start    = Date.now();
  const pathname = parsePath(req.url);
  const method   = req.method.toUpperCase();

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Headers': 'Content-Type, X-Api-Key',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Max-Age':       '86400',
    });
    res.end();
    const ms = Date.now() - start;
    console.log(`OPTIONS ${pathname} 204 ${ms}ms`);
    return;
  }

  // Auth check
  if (cfg.apiKey) {
    const provided = req.headers['x-api-key'];
    if (provided !== cfg.apiKey) {
      send(res, 401, { error: 'unauthorized' });
      const ms = Date.now() - start;
      console.log(`${method} ${pathname} 401 ${ms}ms`);
      return;
    }
  }

  try {
    // GET /health
    if (method === 'GET' && pathname === '/health') {
      handleHealth(req, res);
    }
    // POST /tx
    else if (method === 'POST' && pathname === '/tx') {
      await handlePostTx(req, res);
    }
    // GET /tx
    else if (method === 'GET' && pathname === '/tx') {
      handleGetTx(req, res);
    }
    // GET /kv/:ns/:key
    else if (method === 'GET' && pathname.startsWith('/kv/')) {
      const parts = pathname.split('/').filter(Boolean);  // ['kv', ns, key]
      if (parts.length !== 3) return send(res, 400, { error: 'expected /kv/:ns/:key' });
      handleGetKv(req, res, decodeURIComponent(parts[1]), decodeURIComponent(parts[2]));
    }
    // PUT /kv/:ns/:key
    else if (method === 'PUT' && pathname.startsWith('/kv/')) {
      const parts = pathname.split('/').filter(Boolean);
      if (parts.length !== 3) return send(res, 400, { error: 'expected /kv/:ns/:key' });
      await handlePutKv(req, res, decodeURIComponent(parts[1]), decodeURIComponent(parts[2]));
    }
    // ── §11.1 Module Library ──────────────────────────────────────────────────
    // GET /modules
    else if (method === 'GET' && pathname === '/modules') {
      handleGetModules(req, res);
    }
    // POST /modules
    else if (method === 'POST' && pathname === '/modules') {
      await handlePostModules(req, res);
    }
    // GET /modules/:id/:file
    else if (method === 'GET' && pathname.startsWith('/modules/')) {
      const parts = pathname.split('/').filter(Boolean); // ['modules', id, file]
      if (parts.length !== 3) return send(res, 404, { error: 'not found' });
      handleGetModuleFile(req, res, parts[1], parts[2]);
    }
    // DELETE /modules/:id
    else if (method === 'DELETE' && pathname.startsWith('/modules/')) {
      const parts = pathname.split('/').filter(Boolean); // ['modules', id]
      if (parts.length !== 2) return send(res, 404, { error: 'not found' });
      handleDeleteModule(req, res, parts[1]);
    }
    // GET /sdk/:file
    else if (method === 'GET' && pathname.startsWith('/sdk/')) {
      const parts = pathname.split('/').filter(Boolean); // ['sdk', file]
      if (parts.length !== 2) return send(res, 404, { error: 'not found' });
      handleGetSdk(req, res, parts[1]);
    }
    else {
      send(res, 404, { error: 'not found' });
    }
  } catch (e) {
    console.error('[server] unhandled error:', e);
    send(res, 500, { error: 'internal server error' });
  }

  const ms = Date.now() - start;
  console.log(`${method} ${pathname} ${res.statusCode} ${ms}ms`);
}

// ─── startup ─────────────────────────────────────────────────────────────────

async function main() {
  // Start retention (runs startup prune + vacuum, arms timers)
  await retention.start(db, cfg);

  const server = http.createServer(onRequest);

  server.listen(cfg.port, cfg.bind, () => {
    console.log(`[ModuleHub Store v${VERSION}] listening on ${cfg.bind}:${cfg.port}  db=${DB_PATH}`);
  });

  // ─── graceful shutdown ────────────────────────────────────────────────────
  function shutdown(signal) {
    console.log(`\n[server] ${signal} received — shutting down…`);
    retention.stop();
    server.close(() => {
      db.close();
      console.log('[server] clean exit');
      process.exit(0);
    });
    // Force-quit if still hanging after 5 s
    setTimeout(() => {
      console.error('[server] force exit after timeout');
      process.exit(1);
    }, 5000).unref();
  }

  process.on('SIGINT',  () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch(e => {
  console.error('[server] fatal startup error:', e);
  process.exit(1);
});
