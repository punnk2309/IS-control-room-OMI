'use strict';

/**
 * retention.js — §8 self-management for modulehub-store
 *
 * Exports: { start(db, cfg), afterInsert(), stop() }
 *
 * Responsibilities:
 *  - Row/size cap enforcement: check every 1000 inserts + at startup
 *    Prune oldest-first in 5000-row batches until 10% under cap
 *    ALWAYS backup before a prune cycle
 *  - Weekly VACUUM, last-vacuum timestamp persisted in kv ns _meta key lastVacuum
 *  - Nightly backup via better-sqlite3 .backup() → backupDir/modulehub-YYYYMMDD.db
 *    Keep backupKeep newest, prune older ones
 */

const fs   = require('fs');
const path = require('path');

const PRUNE_INTERVAL   = 1000;           // check after every N inserts
const PRUNE_BATCH      = 5000;           // rows deleted per DELETE batch
const UNDER_CAP_FACTOR = 0.90;          // prune down to 90% of cap (i.e. 10% under)
const MS_PER_DAY       = 86_400_000;
const MS_PER_WEEK      = 7 * MS_PER_DAY;

let _db  = null;
let _cfg = null;
let _insertCount   = 0;
let _vacuumTimer   = null;
let _backupTimer   = null;

// ─── helpers ────────────────────────────────────────────────────────────────

function log(msg) {
  console.log(`[retention] ${msg}`);
}

function pad2(n) { return String(n).padStart(2, '0'); }

function dateTag(d) {
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;
}

function resolveDir(dir) {
  if (path.isAbsolute(dir)) return dir;
  // relative → resolve from the service directory (where server.js lives)
  return path.resolve(__dirname, dir);
}

// ─── KV helpers (synchronous, used internally) ──────────────────────────────

function kvGet(ns, key) {
  const row = _db.prepare('SELECT value FROM kv WHERE ns=? AND key=?').get(ns, key);
  if (!row) return null;
  try { return JSON.parse(row.value); } catch { return row.value; }
}

function kvSet(ns, key, value) {
  _db.prepare(
    'INSERT INTO kv(ns,key,value,updated) VALUES(?,?,?,?) ON CONFLICT(ns,key) DO UPDATE SET value=excluded.value, updated=excluded.updated'
  ).run(ns, key, JSON.stringify(value), Date.now());
}

// ─── backup ─────────────────────────────────────────────────────────────────

async function doBackup() {
  const dir = resolveDir(_cfg.backupDir);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    log(`backup: cannot create backupDir ${dir}: ${e.message}`);
    return;
  }

  const tag  = dateTag(new Date());
  const dest = path.join(dir, `modulehub-${tag}.db`);

  try {
    await _db.backup(dest);
    log(`backup: wrote ${dest}`);
  } catch (e) {
    log(`backup: failed to write ${dest}: ${e.message}`);
    return;
  }

  // prune to keep only backupKeep newest
  try {
    const files = fs.readdirSync(dir)
      .filter(f => /^modulehub-\d{8}\.db$/.test(f))
      .sort()           // lexicographic = chronological for YYYYMMDD
      .reverse();       // newest first

    const toDelete = files.slice(_cfg.backupKeep);
    for (const f of toDelete) {
      const fp = path.join(dir, f);
      try { fs.unlinkSync(fp); log(`backup: pruned old backup ${f}`); }
      catch (e) { log(`backup: could not prune ${f}: ${e.message}`); }
    }
  } catch (e) {
    log(`backup: error pruning old backups: ${e.message}`);
  }
}

// ─── vacuum ─────────────────────────────────────────────────────────────────

function maybeVacuum() {
  const last = kvGet('_meta', 'lastVacuum');
  const now  = Date.now();
  if (last && (now - last) < MS_PER_WEEK) return;

  log('running VACUUM…');
  try {
    _db.exec('VACUUM');
    kvSet('_meta', 'lastVacuum', now);
    log('VACUUM complete');
  } catch (e) {
    log(`VACUUM failed: ${e.message}`);
  }
}

// ─── prune cycle ────────────────────────────────────────────────────────────

function getDbMB() {
  try {
    // page_count * page_size gives actual file usage in bytes
    const { page_count } = _db.prepare('PRAGMA page_count').get();
    const { page_size }  = _db.prepare('PRAGMA page_size').get();
    return (page_count * page_size) / (1024 * 1024);
  } catch { return 0; }
}

function getTxCount() {
  try {
    return _db.prepare('SELECT COUNT(*) AS n FROM tx').get().n;
  } catch { return 0; }
}

async function pruneCycle() {
  const maxRows = _cfg.maxRows;
  const maxMB   = _cfg.maxDbMB;

  const count = getTxCount();
  const mb    = getDbMB();

  const overRows = count > maxRows;
  const overMB   = mb    > maxMB;

  if (!overRows && !overMB) return;   // within limits

  log(`prune triggered: rows=${count}/${maxRows} mb=${mb.toFixed(1)}/${maxMB}`);

  // ALWAYS backup before pruning
  await doBackup();

  // Compute target
  const targetRows = Math.floor(maxRows * UNDER_CAP_FACTOR);

  let pruned = 0;
  while (true) {
    const currentCount = getTxCount();
    const currentMB    = getDbMB();

    if (currentCount <= targetRows && currentMB <= maxMB * UNDER_CAP_FACTOR) break;

    const result = _db.prepare(
      'DELETE FROM tx WHERE id IN (SELECT id FROM tx ORDER BY ts ASC, id ASC LIMIT ?)'
    ).run(PRUNE_BATCH);

    pruned += result.changes;
    if (result.changes === 0) break;   // nothing left to delete
  }

  log(`prune complete: removed ${pruned} rows`);
}

// ─── public API ─────────────────────────────────────────────────────────────

async function start(db, cfg) {
  _db  = db;
  _cfg = cfg;

  // Run prune + maybe-vacuum at startup
  await pruneCycle();
  maybeVacuum();

  // Nightly backup timer (every 24 h)
  _backupTimer = setInterval(doBackup, MS_PER_DAY);
  _backupTimer.unref();

  // Weekly vacuum timer (every 7 days)
  _vacuumTimer = setInterval(maybeVacuum, MS_PER_WEEK);
  _vacuumTimer.unref();

  log('retention started');
}

async function afterInsert() {
  _insertCount++;
  if (_insertCount % PRUNE_INTERVAL === 0) {
    await pruneCycle();
  }
}

function stop() {
  if (_backupTimer) { clearInterval(_backupTimer); _backupTimer = null; }
  if (_vacuumTimer) { clearInterval(_vacuumTimer); _vacuumTimer = null; }
  log('retention stopped');
}

module.exports = { start, afterInsert, stop };
