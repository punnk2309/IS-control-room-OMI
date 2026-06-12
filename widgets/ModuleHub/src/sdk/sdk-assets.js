/* ============================================================================
 * ModuleHub SDK Assets — widgets/ModuleHub/src/sdk/sdk-assets.js
 * ----------------------------------------------------------------------------
 * MODULE-SIDE. Attaches builder MH._build.assets(bridge, rawTree) → sdk.assets
 * per §6. Raw asset tree is passed in mh:init as d.assets (may be null).
 *
 * Implements the same semantics as
 *   widgets/SmartFactoryControlRoom/src/data/asset-model.js (lines ~165-272)
 * without any SFP/config coupling.
 *
 * Public API:
 *   root()               → enriched root node or null
 *   node(pathCode)       → node by dash-joined path (case-insensitive) or null
 *   children(pathCode)   → direct children array or []
 *   tagsUnder(pathCode)  → flat deduplicated tag array (recursive)
 *
 * When rawTree is null/undefined all fns return null / [].
 *
 * Contract: modulehub-contracts.md §6
 * ========================================================================== */
(function () {
  'use strict';

  if (!window.MH || !window.MH._build) {
    throw new Error('[MH] sdk-assets.js loaded before sdk-bootstrap.js');
  }

  MH._build.assets = function buildAssets(_bridge, rawTree) {

    var _root  = null;
    var _index = {};   /* UPPER pathCode → enriched node */

    /* ── Enrich tree ────────────────────────────────────────────────────── */

    function enrich(node, depth, parentPath) {
      var code = String(node.code).toUpperCase();
      var path = parentPath ? parentPath + '-' + code : code;

      var enriched = {
        code:       code,
        name:       node.name || code,
        _depth:     depth,
        _path:      path,
        machineRef: node.machineRef || null,
        tags:       Array.isArray(node.tags) ? node.tags.slice() : [],
        children:   [],
      };

      _index[path] = enriched;

      if (Array.isArray(node.children)) {
        node.children.forEach(function (child) {
          enriched.children.push(enrich(child, depth + 1, path));
        });
      }

      return enriched;
    }

    if (rawTree && rawTree.code) {
      _root = enrich(rawTree, 0, '');
    }

    /* ── collectTags helper ─────────────────────────────────────────────── */

    function collectTags(node, seen) {
      node.tags.forEach(function (dpId) { seen[dpId] = true; });
      node.children.forEach(function (child) { collectTags(child, seen); });
      return seen;
    }

    /* ── Public API ─────────────────────────────────────────────────────── */

    function root() {
      return _root;
    }

    function node(pathCode) {
      if (!pathCode) { return null; }
      return _index[String(pathCode).toUpperCase()] || null;
    }

    function children(pathCode) {
      var n = node(pathCode);
      return n ? n.children.slice() : [];
    }

    function tagsUnder(pathCode) {
      var n = node(pathCode);
      if (!n) { return []; }
      return Object.keys(collectTags(n, {}));
    }

    return {
      root:      root,
      node:      node,
      children:  children,
      tagsUnder: tagsUnder,
    };
  };

}());
