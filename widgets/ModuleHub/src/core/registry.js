/* ============================================================================
 * ModuleHub — module registry (MHB.registry)
 * ----------------------------------------------------------------------------
 * Reads modules/index.json (array of module id strings) and provides:
 *   MHB.registry.load()           — fetch index.json, returns Promise<void>
 *   MHB.registry.list()           — returns array of id strings
 *   MHB.registry.manifest(id)     — fetch+cache+validate module.json;
 *                                   returns Promise<manifest|null>
 *
 * Validation per contract §3:
 *   - required: id (string), name (string), version (string), entry (string)
 *   - permissions.tags must be an array
 *   - permissions.store must be an array
 *   - id must match folder name (validated when loader passes id)
 *
 * Contract: modulehub-contracts.md §3, §10
 * ========================================================================== */
(function (MHB) {
  'use strict';

  var _ids = [];
  var _manifestCache = {};   // id -> manifest object (null = known-invalid/404)
  var _sources = {};         // id -> 'local' | 'library'
  var _libraryWarnFired = false;  // log library failure once only

  /** Validate a raw module.json object. Returns null + console.warn on failure. */
  function validate(id, raw) {
    if (!raw || typeof raw !== 'object') {
      console.warn('[MHB.registry] module.json for "' + id + '" is not an object');
      return null;
    }
    if (typeof raw.id !== 'string' || !/^[_a-z0-9][a-z0-9_-]*$/.test(raw.id)) {
      console.warn('[MHB.registry] module "' + id + '" has invalid id field: ' + raw.id);
      return null;
    }
    if (raw.id !== id) {
      console.warn('[MHB.registry] module.json id "' + raw.id + '" does not match folder name "' + id + '"');
      return null;
    }
    if (typeof raw.name !== 'string' || !raw.name) {
      console.warn('[MHB.registry] module "' + id + '" missing name');
      return null;
    }
    if (typeof raw.version !== 'string' || !raw.version) {
      console.warn('[MHB.registry] module "' + id + '" missing version');
      return null;
    }
    if (typeof raw.entry !== 'string' || !raw.entry) {
      console.warn('[MHB.registry] module "' + id + '" missing entry');
      return null;
    }
    if (!raw.permissions || !Array.isArray(raw.permissions.tags)) {
      console.warn('[MHB.registry] module "' + id + '" missing permissions.tags array');
      return null;
    }
    if (!Array.isArray(raw.permissions.store)) {
      console.warn('[MHB.registry] module "' + id + '" missing permissions.store array');
      return null;
    }
    return raw;
  }

  MHB.registry = {
    /** Fetch modules/index.json and populate the id list.
     *  Also merges library ids from mod.list when storeClient is in service mode.
     *  Safe to call multiple times (re-fetches each call).
     *  Returns Promise<void>; resolves once local ids are ready.
     *  Library merge is attempted async and notifies via bus event 'registry:updated'. */
    load: function () {
      return fetch('modules/index.json')
        .then(function (res) {
          if (!res.ok) { throw new Error('HTTP ' + res.status + ' fetching modules/index.json'); }
          return res.json();
        })
        .then(function (data) {
          if (!Array.isArray(data)) {
            throw new Error('modules/index.json must be an array');
          }
          var localIds = data.filter(function (v) { return typeof v === 'string'; });
          _ids = localIds.slice();
          /* Mark all local ids as 'local' source */
          _sources = {};
          localIds.forEach(function (id) { _sources[id] = 'local'; });
        })
        .catch(function (err) {
          console.warn('[MHB.registry] failed to load index.json:', err);
          _ids = [];
          _sources = {};
        })
        .then(function () {
          /* Async library merge — does not block the caller */
          var client = window.MHB && window.MHB.storeClient;
          if (!client || typeof client.op !== 'function') { return; }
          if (client.status() !== 'service') { return; }
          client.op('mod.list', {}).then(function (entries) {
            if (!Array.isArray(entries)) { return; }
            var changed = false;
            entries.forEach(function (entry) {
              var lid = entry && entry.id;
              if (!lid || typeof lid !== 'string') { return; }
              if (_sources[lid] === 'local') { return; } /* local wins */
              if (_sources[lid] !== 'library') {
                _ids.push(lid);
                changed = true;
              }
              _sources[lid] = 'library';
            });
            if (changed) {
              MHB.bus.emit('registry:updated', { ids: _ids.slice() });
            }
          }).catch(function (err) {
            if (!_libraryWarnFired) {
              _libraryWarnFired = true;
              console.info('[MHB.registry] library merge skipped (service unavailable):', err.message || err);
            }
          });
        });
    },

    /** Returns the list of module ids (populated after load()). */
    list: function () {
      return _ids.slice();
    },

    /** Returns the source for a given id: 'local' | 'library' | undefined. */
    source: function (id) {
      return _sources[id];
    },

    /** Fetch, cache, and validate module.json for id.
     *  For library modules, fetches via mod.fetch when local fetch fails.
     *  Returns Promise<manifest|null>. null = 404 or invalid. */
    manifest: function (id) {
      if (_manifestCache.hasOwnProperty(id)) {
        return Promise.resolve(_manifestCache[id]);
      }

      /* Try local first */
      return fetch('modules/' + id + '/module.json')
        .then(function (res) {
          if (!res.ok) { return null; }
          return res.json();
        })
        .then(function (raw) {
          if (raw !== null) {
            var valid = validate(id, raw);
            _manifestCache[id] = valid;
            return valid;
          }
          /* Local not found — try library if source is 'library' */
          if (_sources[id] !== 'library') {
            console.warn('[MHB.registry] module.json for "' + id + '" not found locally');
            _manifestCache[id] = null;
            return null;
          }
          var client = window.MHB && window.MHB.storeClient;
          if (!client || typeof client.op !== 'function') {
            _manifestCache[id] = null;
            return null;
          }
          return client.op('mod.fetch', { id: id, file: 'module.json' })
            .then(function (text) {
              var rawLib;
              try { rawLib = JSON.parse(text); } catch (e) {
                console.warn('[MHB.registry] mod.fetch module.json parse error for "' + id + '":', e);
                _manifestCache[id] = null;
                return null;
              }
              var validLib = validate(id, rawLib);
              _manifestCache[id] = validLib;
              return validLib;
            })
            .catch(function (err) {
              console.warn('[MHB.registry] mod.fetch module.json failed for "' + id + '":', err);
              _manifestCache[id] = null;
              return null;
            });
        })
        .catch(function (err) {
          console.warn('[MHB.registry] error loading manifest for "' + id + '":', err);
          _manifestCache[id] = null;
          return null;
        });
    },

    /** Clear the manifest cache (useful for dev reload). */
    clearCache: function () {
      _manifestCache = {};
    },
  };
}(window.MHB));
