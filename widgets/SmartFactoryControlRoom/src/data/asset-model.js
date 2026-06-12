/* ============================================================================
 * SFP.data.assets — DS650 asset hierarchy registry
 * ----------------------------------------------------------------------------
 * Builds a queryable tree from config/asset-model.config.js at startup.
 * Hierarchy levels (depth-implied):
 *   0 → plant, 1 → area, 2 → line, 3 → unit, 4 → machine,
 *   5 → equipment, 6 → component
 *
 * Validation: codes that violate DS650 format rules generate a console.warn
 * but the node still loads (fail-soft, matching platform philosophy).
 *
 * Public API (SFP.data.assets.*):
 *   root()                     → root plant node (enriched with _path etc.)
 *   node(pathCode)             → node by dash-joined path, or null
 *   children(pathCode)         → direct child array, or []
 *   level(node)                → 'plant'|'area'|'line'|'unit'|'machine'|
 *                                'equipment'|'component'
 *   pathOf(node)               → dash-joined full code string
 *   tagsUnder(pathCode, opts)  → flat deduplicated array of datapoint ids
 *                                opts.recursive (default true)
 *   assetOfTag(dpId)           → pathCode that owns the datapoint, or null
 *   tree()                     → whole enriched tree (for UI consumption)
 *   validate(code, level)      → { valid:bool, reason:string|null }
 * ========================================================================== */
(function (SFP) {
  'use strict';

  /* ── DS650 validation regexes ─────────────────────────────────────────── */
  var LEVEL_NAMES = ['plant', 'area', 'line', 'unit', 'machine', 'equipment', 'component'];

  var VALIDATORS = {
    plant:     /^[A-Z0-9]{4}$/,
    area:      /^[A-Z0-9]{3}$/,
    line:      /^[A-Z]{3}[0-9]{2}$/,
    unit:      /^[A-Z]{3}[A-Z0-9]{2}$/,
    machine:   /^[A-Z]{3}[A-Z0-9]{2}$/,
    equipment: /^[A-Z]{3}[A-Z0-9]{4}$/,
    component: /^[0-9]{10}$/,
  };

  /* ── Internal state ────────────────────────────────────────────────────── */
  var _root = null;          // enriched root node
  var _index = {};           // pathCode -> enriched node
  var _tagToPath = {};       // dpId -> pathCode (from node.tags[] declarations)
  var _dpAsset = {};         // dpId -> pathCode (from tags.config.js asset: field)

  /* ── Helpers ──────────────────────────────────────────────────────────── */

  function validate(code, levelName) {
    var re = VALIDATORS[levelName];
    if (!re) { return { valid: false, reason: 'Unknown level: ' + levelName }; }
    var upper = String(code).toUpperCase();
    if (!re.test(upper)) {
      return {
        valid: false,
        reason: 'Code "' + code + '" does not match DS650 pattern for ' + levelName +
                ' (expected ' + re.toString() + ')',
      };
    }
    return { valid: true, reason: null };
  }

  function levelName(depth) {
    return LEVEL_NAMES[depth] || ('depth-' + depth);
  }

  /* Recursively enrich nodes: attach _depth, _path, _level, normalise code to
   * uppercase, validate, index into _index, register node.tags in _tagToPath. */
  function enrich(node, depth, parentPath) {
    var code = String(node.code).toUpperCase();
    var path = parentPath ? parentPath + '-' + code : code;
    var lvl = levelName(depth);

    /* DS650 validation — warn but never throw */
    var vResult = validate(code, lvl);
    if (!vResult.valid) {
      console.warn('[SFP.assets] DS650 validation failed at path "' + path + '": ' + vResult.reason);
    }

    var enriched = {
      code:       code,
      name:       node.name || code,
      _depth:     depth,
      _path:      path,
      _level:     lvl,
      machineRef: node.machineRef || null,
      tags:       node.tags ? node.tags.slice() : [],
      children:   [],
    };

    /* Register tags pointing to this node */
    enriched.tags.forEach(function (dpId) {
      _tagToPath[dpId] = path;
    });

    _index[path] = enriched;

    /* Recurse */
    if (Array.isArray(node.children)) {
      node.children.forEach(function (child) {
        enriched.children.push(enrich(child, depth + 1, path));
      });
    }

    return enriched;
  }

  /* Build _dpAsset from the tags config's asset: back-references. */
  function indexTagsConfigAssets() {
    var dpConfig;
    try {
      dpConfig = SFP.config.get('datapoints');
    } catch (e) {
      return; /* tags config not loaded yet — silently skip */
    }
    Object.keys(dpConfig).forEach(function (dpId) {
      var def = dpConfig[dpId];
      if (def && def.asset) {
        var pathCode = String(def.asset).toUpperCase();
        _dpAsset[dpId] = pathCode;
        /* Also register in _tagToPath if not already claimed by node.tags */
        if (!_tagToPath[dpId]) {
          _tagToPath[dpId] = pathCode;
        }
      }
    });
  }

  /* Collect all datapoint ids under a node (and optionally its descendants).
   * Sources merged (deduped):
   *   1. node.tags[]
   *   2. _dpAsset entries whose path starts with the node's path
   *   3. machine.<machineRef>.* datapoints for every node with a machineRef */
  function collectTags(node, recursive, seen) {
    seen = seen || {};

    /* 1. node.tags */
    node.tags.forEach(function (dpId) {
      seen[dpId] = true;
    });

    /* 3. machineRef expansion */
    if (node.machineRef) {
      var prefix = 'machine.' + node.machineRef + '.';
      /* Walk the machines datapoints that were defined by machine-registry */
      var machinesCfg = SFP.config.has('machines') ? SFP.config.get('machines') : null;
      if (machinesCfg && machinesCfg.metrics) {
        Object.keys(machinesCfg.metrics).forEach(function (metric) {
          seen[prefix + metric] = true;
        });
      }
    }

    if (recursive && node.children) {
      node.children.forEach(function (child) {
        collectTags(child, true, seen);
      });
    }

    return seen;
  }

  /* ── Registry object ──────────────────────────────────────────────────── */

  var registry = {

    /** Initialise from config. Called by src/app.js after hub.defineAll(). */
    init: function () {
      _root = null;
      _index = {};
      _tagToPath = {};
      _dpAsset = {};

      var cfg;
      try {
        cfg = SFP.config.get('asset-model');
      } catch (e) {
        console.warn('[SFP.assets] asset-model config not found — asset registry disabled.');
        return;
      }

      _root = enrich(cfg, 0, '');
      /* Strip the leading '-' added by enrich when parentPath is empty */
      /* Actually enrich guards: parentPath ? parentPath+'-'+code : code
         so root path = just the code. All good. */

      indexTagsConfigAssets();
    },

    /* ── Public API ─────────────────────────────────────────────────────── */

    /** Returns the root plant node. */
    root: function () { return _root; },

    /** Returns an enriched node by its dash-joined path code, or null. */
    node: function (pathCode) {
      return _index[String(pathCode).toUpperCase()] || null;
    },

    /** Returns the direct children of a node identified by pathCode. */
    children: function (pathCode) {
      var n = this.node(pathCode);
      return n ? n.children.slice() : [];
    },

    /** Returns the level name of a node object. */
    level: function (node) {
      return node ? node._level : null;
    },

    /** Returns the full dash-joined path code for a node object. */
    pathOf: function (node) {
      return node ? node._path : null;
    },

    /**
     * Returns a flat, deduplicated array of datapoint ids whose physical home
     * is at or beneath pathCode.
     *
     * opts.recursive (default true) — include descendants.
     */
    tagsUnder: function (pathCode, opts) {
      var node = this.node(pathCode);
      if (!node) { return []; }
      var recursive = !opts || opts.recursive !== false;

      /* Start with node.tags + machineRef expansion (from collectTags) */
      var seen = collectTags(node, recursive, {});

      /* Also sweep _dpAsset for back-references (tags.config.js asset: field).
       * When recursive=true: include any tag whose asset path is this node or
       *   a descendant (path starts with node._path + '-').
       * When recursive=false: only include tags whose asset path is exactly
       *   this node (not deeper). */
      var prefix = node._path + '-';
      Object.keys(_dpAsset).forEach(function (dpId) {
        var ap = _dpAsset[dpId];
        if (ap === node._path) {
          seen[dpId] = true;
        } else if (recursive && ap.indexOf(prefix) === 0) {
          seen[dpId] = true;
        }
      });

      return Object.keys(seen);
    },

    /**
     * Returns the pathCode that owns a datapoint, or null if unregistered.
     * When a datapoint is declared both in a node's tags[] and via a
     * tags.config.js asset: field, the deeper (more specific) path wins.
     */
    assetOfTag: function (dpId) {
      var a = _tagToPath[dpId];
      var b = _dpAsset[dpId];
      if (a && b && a !== b) {
        return b.split('-').length > a.split('-').length ? b : a;
      }
      return a || b || null;
    },

    /** Returns the full enriched tree root (for UI tree rendering). */
    tree: function () { return _root; },

    /** DS650 format validation helper (usable by widgets/tools). */
    validate: validate,

    /** All registered path codes (diagnostic helper). */
    _pathCodes: function () { return Object.keys(_index); },
  };

  SFP.data.assets = registry;
}(window.SFP));
