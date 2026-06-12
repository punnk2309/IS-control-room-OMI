/* ============================================================================
 * Widget: gantt-chart — horizontal-bar timeline showing tag values over time,
 *         one row per tag, grouped under the DS650 asset hierarchy.
 * ----------------------------------------------------------------------------
 * options: {
 *   title:      string                     widget card title (default 'Gantt')
 *   subtitle:   string                     optional subtitle
 *   icon:       string                     icon token (default 'layout')
 *
 *   asset:      string                     DS650 path code (e.g. '0017-NIF-LIN01').
 *                                          Rows are auto-populated from
 *                                          SFP.data.assets.tagsUnder(asset,
 *                                          {recursive:true}), grouped in the
 *                                          asset node hierarchy. Tags that have
 *                                          no asset are placed under an
 *                                          'Ungrouped' header.
 *   rows:       Array<string|{datapoint,label}>
 *                                          Explicit row list. Accepts plain tag-id
 *                                          strings (e.g. ['tagA','tagB']) or objects
 *                                          {datapoint, label?}. Used when asset is
 *                                          not set. Will also be grouped under asset
 *                                          structure if assetOfTag returns paths,
 *                                          otherwise flat.
 *
 *   window:     number (seconds)           Visible time window (default 3600).
 *
 *   colorMap:   Object                     Maps values to colors. Supports:
 *                 - exact string  { 'running': '#22c55e' }
 *                 - numeric range { '0-50': '#f59e0b' }
 *                 - fallback      { '*': '#94a3b8' }
 *               When omitted and stateGroup is not set, values are hashed to
 *               the theme's chart palette.
 *   stateGroup: string                     Name of a states.config group
 *               (e.g. 'machine').  Derives value→color automatically from that
 *               group's state colors.
 *
 *   rowHeight:  number (px)               Height of each data row (default 22).
 *   maxRows:    number                    Maximum rows shown; excess shown as
 *                                         '+N more' note (default 30).
 *
 *   collapsible: boolean                  Enable collapse/expand on group headers
 *                                         (default true).
 *   collapsedGroups: Array<string>        Keys (label or asset path) of groups
 *                                         that start collapsed.
 * }
 *
 * bind: (not used — rows come from options.asset or options.rows)
 *
 * History: per-row ring buffers seeded from ctx.hub.history() at startup.
 *          Each sample's string/number value is stored. Consecutive samples
 *          with the same discretised value are merged into one colored bar.
 *          Samples with quality 'Bad' render as hatched dim-gray.
 *
 * Live: subscribes to every row datapoint; redraws at most ~1 fps via a
 *       coalesce timer.
 *
 * Resize/destroy: re-measures canvas (devicePixelRatio aware) on resize();
 *                 clears all timers and subscriptions on destroy().
 * ========================================================================== */
(function (SFP) {
  'use strict';

  /* ── Constants ────────────────────────────────────────────────────────── */

  var GUTTER_W      = 160;   // label column width px
  var AXIS_H        = 22;    // time-axis area height px
  var LEGEND_H      = 28;    // legend strip height px
  var HEADER_ROW_H  = 18;    // group-header row height px
  var MIN_TICK_PX   = 60;    // minimum pixels between time-axis ticks
  var CHEVRON_W     = 14;    // space reserved for chevron in header label

  /* Minimum canvas-wrap height when all groups are collapsed */
  var COLLAPSED_FLOOR_PX = 60;

  /* ── Palette for value hashing ─────────────────────────────────────────── */

  var FALLBACK_PALETTE = [
    '#3b82f6', '#22c55e', '#f59e0b', '#ef4444',
    '#a78bfa', '#06b6d4', '#f97316', '#84cc16',
  ];

  /* ── Value colour resolver factory ─────────────────────────────────────── */

  function makeColorResolver(options, theme) {
    /* 1. stateGroup: pull from states.config */
    if (options.stateGroup) {
      var statesCfg = SFP.config.get('states');
      var group = statesCfg && statesCfg[options.stateGroup];
      if (group && group.states) {
        var stateColorMap = {};
        group.states.forEach(function (s) {
          stateColorMap[s.id] = theme.color(s.color);
        });
        /* Also support valueMap integer codes */
        var valueMap = group.valueMap || {};
        return function (val) {
          var key = String(val);
          if (stateColorMap[key]) { return stateColorMap[key]; }
          var mapped = valueMap[key] || valueMap[val];
          if (mapped && stateColorMap[mapped]) { return stateColorMap[mapped]; }
          return stateColorMap[group['default']] || '#888888';
        };
      }
    }

    /* 2. explicit colorMap */
    if (options.colorMap) {
      var cm = options.colorMap;
      var rangeEntries = [];
      Object.keys(cm).forEach(function (key) {
        if (key === '*') { return; }
        var parts = key.split('-');
        if (parts.length === 2 && !isNaN(parseFloat(parts[0])) && !isNaN(parseFloat(parts[1]))) {
          rangeEntries.push({ lo: parseFloat(parts[0]), hi: parseFloat(parts[1]), color: cm[key] });
        }
      });
      var fallback = cm['*'] || '#888888';
      return function (val) {
        var key = String(val);
        if (cm[key] !== undefined) { return cm[key]; }
        var num = parseFloat(val);
        if (!isNaN(num)) {
          for (var i = 0; i < rangeEntries.length; i++) {
            if (num >= rangeEntries[i].lo && num <= rangeEntries[i].hi) {
              return rangeEntries[i].color;
            }
          }
        }
        return fallback;
      };
    }

    /* 3. Hash value to palette */
    var hashCache = {};
    var paletteIdx = 0;
    return function (val) {
      var key = String(val);
      if (hashCache[key] === undefined) {
        hashCache[key] = FALLBACK_PALETTE[paletteIdx % FALLBACK_PALETTE.length];
        paletteIdx++;
      }
      return hashCache[key];
    };
  }

  /* ── Collect legend entries (value → color, deduplicated) ──────────────── */

  function buildLegend(options, theme) {
    var legend = [];
    var seen = {};

    function add(label, color) {
      if (seen[label]) { return; }
      seen[label] = true;
      legend.push({ label: label, color: color });
    }

    if (options.stateGroup) {
      var statesCfg = SFP.config.get('states');
      var group = statesCfg && statesCfg[options.stateGroup];
      if (group && group.states) {
        group.states.forEach(function (s) {
          add(s.label || s.id, theme.color(s.color));
        });
      }
      return legend;
    }

    if (options.colorMap) {
      var cm = options.colorMap;
      Object.keys(cm).forEach(function (key) {
        if (key !== '*') { add(key, cm[key]); }
      });
      return legend;
    }

    return legend; /* dynamic — populated during draw */
  }

  /* ── Build row list from asset tree ───────────────────────────────────── */

  /* A "display row" is either:
   *   { isHeader: true, label, depth, key }
   *   { isHeader: false, datapoint, label, depth }
   *
   * key on header rows is a stable identifier used as the collapse-state key.
   */
  function buildRowsFromAsset(assetPath, maxRows) {
    var assets = SFP.data.assets;
    var tags = assets.tagsUnder(assetPath, { recursive: true });
    if (!tags.length) { return []; }

    /* Map each tag to its owning asset node path */
    var tagsByNode = {};   /* nodePath -> [dpId] */
    var ungrouped = [];

    tags.forEach(function (dpId) {
      var nodePath = assets.assetOfTag(dpId);
      if (!nodePath) {
        ungrouped.push(dpId);
        return;
      }
      if (!tagsByNode[nodePath]) { tagsByNode[nodePath] = []; }
      tagsByNode[nodePath].push(dpId);
    });

    /* Walk asset sub-tree depth-first, emitting headers + tag rows */
    var rows = [];
    var total = 0;

    function walk(node, depth) {
      var path = node._path;
      /* Emit header only when this node has tags or has children that do */
      var nodeTags = tagsByNode[path] || [];
      var hasDescendantTags = false;
      (function checkDesc(n) {
        if (tagsByNode[n._path] && tagsByNode[n._path].length) { hasDescendantTags = true; }
        (n.children || []).forEach(function (c) { if (!hasDescendantTags) { checkDesc(c); } });
      }(node));

      if (nodeTags.length || hasDescendantTags) {
        rows.push({
          isHeader: true,
          label: node.name + ' (' + node.code + ')',
          depth: depth,
          key: path,
        });
        nodeTags.forEach(function (dpId) {
          if (total >= maxRows) { return; }
          rows.push({ isHeader: false, datapoint: dpId, label: dpId, depth: depth + 1 });
          total++;
        });
      }

      (node.children || []).forEach(function (child) {
        if (total < maxRows) { walk(child, depth + 1); }
      });
    }

    var rootNode = assets.node(assetPath);
    if (rootNode) { walk(rootNode, 0); }

    if (ungrouped.length) {
      rows.push({ isHeader: true, label: 'Ungrouped', depth: 0, key: '__ungrouped__' });
      ungrouped.forEach(function (dpId) {
        if (total < maxRows) {
          rows.push({ isHeader: false, datapoint: dpId, label: dpId, depth: 1 });
          total++;
        }
      });
    }

    return rows;
  }

  /* Build flat rows from explicit options.rows list, with optional grouping.
   * Accepts Array<string | {datapoint, label?}>. Plain strings are treated as
   * tag ids with label equal to the id. */
  function buildRowsFromExplicit(optRows, maxRows) {
    var assets = SFP.data.assets;
    var rows = [];
    var total = 0;

    /* Normalise entries: strings become {datapoint, label} objects */
    var normalised = optRows.map(function (r) {
      if (typeof r === 'string') { return { datapoint: r, label: r }; }
      return r;
    });

    /* Try grouping under asset structure */
    var grouped = false;
    var tagsByNode = {};
    var ungrouped = [];

    normalised.forEach(function (r) {
      var nodePath = assets ? assets.assetOfTag(r.datapoint) : null;
      if (nodePath) {
        grouped = true;
        if (!tagsByNode[nodePath]) { tagsByNode[nodePath] = []; }
        tagsByNode[nodePath].push(r);
      } else {
        ungrouped.push(r);
      }
    });

    if (grouped && Object.keys(tagsByNode).length) {
      Object.keys(tagsByNode).forEach(function (nodePath) {
        var node = assets.node(nodePath);
        var label = node ? node.name + ' (' + node.code + ')' : nodePath;
        rows.push({ isHeader: true, label: label, depth: 0, key: nodePath });
        tagsByNode[nodePath].forEach(function (r) {
          if (total < maxRows) {
            rows.push({ isHeader: false, datapoint: r.datapoint, label: r.label || r.datapoint, depth: 1 });
            total++;
          }
        });
      });
      if (ungrouped.length) {
        rows.push({ isHeader: true, label: 'Ungrouped', depth: 0, key: '__ungrouped__' });
        ungrouped.forEach(function (r) {
          if (total < maxRows) {
            rows.push({ isHeader: false, datapoint: r.datapoint, label: r.label || r.datapoint, depth: 1 });
            total++;
          }
        });
      }
    } else {
      normalised.forEach(function (r) {
        if (total < maxRows) {
          rows.push({ isHeader: false, datapoint: r.datapoint, label: r.label || r.datapoint, depth: 0 });
          total++;
        }
      });
    }

    return rows;
  }

  /* ── Time-axis tick calculation ──────────────────────────────────────── */

  /* Nice time intervals in ms */
  var TICK_INTERVALS = [
    1000, 2000, 5000, 10000, 15000, 30000,
    60000, 120000, 300000, 600000, 1800000,
    3600000, 7200000, 21600000, 43200000, 86400000,
  ];

  function chooseTick(windowMs, availPx) {
    var maxTicks = Math.floor(availPx / MIN_TICK_PX);
    for (var i = 0; i < TICK_INTERVALS.length; i++) {
      if (windowMs / TICK_INTERVALS[i] <= maxTicks) { return TICK_INTERVALS[i]; }
    }
    return TICK_INTERVALS[TICK_INTERVALS.length - 1];
  }

  function formatTick(ms, windowMs) {
    var d = new Date(ms);
    if (windowMs <= 60000) {
      /* sub-minute window: show seconds */
      var s = d.getSeconds();
      return (s < 10 ? '0' : '') + s + 's';
    }
    if (windowMs <= 7200000) {
      /* up to 2h: show HH:MM */
      var h = d.getHours(), m = d.getMinutes();
      return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
    }
    /* > 2h: show date + HH:MM */
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' +
      (d.getHours() < 10 ? '0' : '') + d.getHours() + ':' +
      (d.getMinutes() < 10 ? '0' : '') + d.getMinutes();
  }

  /* ── Text truncation helper ────────────────────────────────────────────── */

  function truncate(ctx2d, text, maxPx) {
    if (ctx2d.measureText(text).width <= maxPx) { return text; }
    var ellipsis = '…';
    while (text.length > 1) {
      text = text.slice(0, -1);
      if (ctx2d.measureText(text + ellipsis).width <= maxPx) { return text + ellipsis; }
    }
    return ellipsis;
  }

  /* ── Hatch pattern for bad-quality segments ─────────────────────────── */

  function makeHatchPattern(canvas2d, color) {
    var sz = 8;
    var pat = document.createElement('canvas');
    pat.width = sz;
    pat.height = sz;
    var pc = pat.getContext('2d');
    pc.fillStyle = color;
    pc.fillRect(0, 0, sz, sz);
    pc.strokeStyle = 'rgba(0,0,0,0.35)';
    pc.lineWidth = 1.5;
    pc.beginPath();
    pc.moveTo(0, sz); pc.lineTo(sz, 0);
    pc.moveTo(-sz / 2, sz / 2); pc.lineTo(sz / 2, -sz / 2);
    pc.moveTo(sz / 2, sz * 1.5); pc.lineTo(sz * 1.5, sz / 2);
    pc.stroke();
    return canvas2d.createPattern(pat, 'repeat');
  }

  /* ── Widget registration ────────────────────────────────────────────── */

  SFP.widgets.register('gantt-chart', {
    create: function (ctx) {
      var dom = ctx.dom, theme = ctx.theme, format = ctx.format;
      var o = ctx.options || {};
      var windowMs = (o.window || 3600) * 1000;
      var rowH      = o.rowHeight || 22;
      var maxRows   = o.maxRows  || 30;

      /* collapsible feature flag (default true) */
      var collapsible = (o.collapsible !== false);

      /* Collapsed-state map: groupKey -> boolean */
      var collapsedState = {};
      if (collapsible && o.collapsedGroups && Array.isArray(o.collapsedGroups)) {
        o.collapsedGroups.forEach(function (k) { collapsedState[k] = true; });
      }

      /* ── Build display row list ─────────────────────────────────────── */

      var displayRows;   /* Array of {isHeader,label,depth[,key]} or {isHeader:false,datapoint,label,depth} */
      var truncatedCount = 0;

      if (o.asset) {
        displayRows = buildRowsFromAsset(o.asset, maxRows);
      } else if (o.rows && o.rows.length) {
        displayRows = buildRowsFromExplicit(o.rows, maxRows);
      } else {
        displayRows = [];
      }

      /* Count actual data rows and detect truncation */
      var dataRows = displayRows.filter(function (r) { return !r.isHeader; });
      var totalTagCount = o.asset
        ? SFP.data.assets.tagsUnder(o.asset, { recursive: true }).length
        : (o.rows ? o.rows.length : 0);
      truncatedCount = Math.max(0, totalTagCount - dataRows.length);

      /* ── Per-row ring buffers ──────────────────────────────────────── */
      /*
       * Each row keeps a circular array of { t, v, quality } samples.
       * We seed from ctx.hub.history() if the hub has history for that dp.
       * Samples from hub.history() carry numeric values; state tags are
       * stored as-is (strings) — we discretise during rendering.
       */

      var ROW_BUF_MAX = 2000;

      var rowData = {};   /* datapoint -> { samples: [{t,v,quality}], last } */

      dataRows.forEach(function (row) {
        var dp = row.datapoint;
        if (rowData[dp]) { return; }   /* dedup in case the same dp appears twice */

        /* Seed from history buffer */
        var hist = ctx.hub.history(dp, windowMs * 4);   /* grab wider window for context */
        var samples = hist.map(function (p) {
          return { t: p.t, v: p.v, quality: 'Good' };
        });

        rowData[dp] = { samples: samples, last: null };
      });

      /* ── Color resolver & static legend ─────────────────────────────── */

      var resolveColor = makeColorResolver(o, theme);
      var staticLegend = buildLegend(o, theme);
      var dynamicLegend = {};   /* value→color, populated during draw when no static */

      /* ── DOM / canvas setup ─────────────────────────────────────────── */

      var card = dom.card({
        title: o.title || 'Gantt',
        subtitle: o.subtitle || null,
        icon: o.icon || 'layout',
      });
      ctx.root.appendChild(card.root);

      var canvasWrap = dom.el('div', { class: 'gantt-canvas-wrap' });
      card.body.appendChild(canvasWrap);

      var canvas = dom.el('canvas');
      canvasWrap.appendChild(canvas);

      var tooltip = dom.el('div', { class: 'gantt-tooltip' });
      canvasWrap.appendChild(tooltip);

      /* ── DPR-aware resize ───────────────────────────────────────────── */

      var dpr = 1;
      var cssW = 0, cssH = 0;

      function sizeCanvas() {
        dpr = window.devicePixelRatio || 1;
        cssW = canvasWrap.clientWidth  || 400;
        cssH = canvasWrap.clientHeight || 200;
        canvas.width  = Math.round(cssW * dpr);
        canvas.height = Math.round(cssH * dpr);
        canvas.style.width  = cssW + 'px';
        canvas.style.height = cssH + 'px';
      }

      /* ── Visible row list (respects collapse state) ─────────────────── */

      /*
       * Returns a filtered copy of displayRows where rows belonging to a
       * collapsed header (and any deeper headers that might themselves be
       * collapsed) are omitted.
       *
       * Algorithm: walk displayRows linearly. When we encounter a header
       * that is collapsed, remember its depth as the "skip depth". Skip
       * all subsequent rows until we see a header with depth <= skip depth.
       * When we see such a header, stop skipping and process it normally
       * (it may itself be collapsed too).
       */
      function buildVisibleRows() {
        var visible = [];
        var skipDepth = -1;   /* -1 means not skipping */

        for (var i = 0; i < displayRows.length; i++) {
          var row = displayRows[i];

          if (skipDepth >= 0) {
            /* Currently skipping — only stop if this is a header at same/shallower depth */
            if (row.isHeader && row.depth <= skipDepth) {
              skipDepth = -1;   /* stop skipping, fall through to normal processing */
            } else {
              continue;   /* skip this row */
            }
          }

          visible.push(row);

          if (row.isHeader && collapsible && collapsedState[row.key]) {
            /* Start skipping content under this header */
            skipDepth = row.depth;
          }
        }

        return visible;
      }

      /* ── Content-height calculation ─────────────────────────────────── */

      /*
       * Returns the pixel height needed to display all visible rows plus
       * legend and axis areas. Used to drive the vertical-shrink feature.
       */
      function computeContentHeight(visibleRows) {
        var h = LEGEND_H + AXIS_H;
        for (var i = 0; i < visibleRows.length; i++) {
          h += visibleRows[i].isHeader ? HEADER_ROW_H : rowH;
        }
        return h;
      }

      /* ── Update wrap height (vertical shrink) ───────────────────────── */

      /*
       * When any group is collapsed we set an explicit pixel height on the
       * wrap so the widget actually shrinks. When everything is expanded we
       * remove the explicit height so the widget fills the grid cell as
       * before (preserving existing dashboard behaviour).
       */
      function updateWrapHeight(visibleRows) {
        var anyCollapsed = Object.keys(collapsedState).some(function (k) {
          return collapsedState[k];
        });

        if (!anyCollapsed) {
          /* Fully expanded: let CSS / grid drive the height */
          canvasWrap.style.height = '';
          canvasWrap.classList.remove('gantt-canvas-wrap--collapsed');
          return;
        }

        var contentPx = computeContentHeight(visibleRows);
        var targetPx  = Math.max(COLLAPSED_FLOOR_PX, contentPx);
        canvasWrap.style.height = targetPx + 'px';
        canvasWrap.classList.add('gantt-canvas-wrap--collapsed');
      }

      /* ── Tooltip state ──────────────────────────────────────────────── */

      var hoverInfo = null;    /* { dp, value, quality, t0, t1, x, y } | null */

      /* ── Drawing ──────────────────────────────────────────────────────
       *
       * Layout (top to bottom):
       *   [LEGEND_H]  legend chips
       *   [rows...]   each visible display row (header or data)
       *   [AXIS_H]    time axis
       *
       * Layout (left to right):
       *   [GUTTER_W]  label column
       *   [rest]      timeline
       */

      function draw() {
        var visibleRows = buildVisibleRows();

        var c = canvas.getContext('2d');
        c.setTransform(dpr, 0, 0, dpr, 0, 0);

        var W = cssW, H = cssH;

        /* Background */
        c.clearRect(0, 0, W, H);
        c.fillStyle = theme.color('bg-surface');
        c.fillRect(0, 0, W, H);

        var now = Date.now();
        var tStart = now - windowMs;
        var tlX = GUTTER_W;
        var tlW = Math.max(0, W - GUTTER_W);

        /* ── Legend ─────────────────────────────────────────────────── */

        var legendEntries = staticLegend.length ? staticLegend : (function () {
          return Object.keys(dynamicLegend).map(function (k) {
            return { label: k, color: dynamicLegend[k] };
          });
        }());

        var lx = tlX + 4;
        var ly = 6;
        var chipH = 10;
        c.font = '600 10px "Segoe UI", system-ui, sans-serif';
        legendEntries.forEach(function (entry) {
          c.fillStyle = entry.color;
          c.fillRect(lx, ly + (LEGEND_H - chipH) / 2 - 1, 14, chipH);
          c.fillStyle = theme.color('text-2');
          var label = entry.label;
          c.fillText(label, lx + 18, ly + LEGEND_H / 2 + 3);
          lx += 18 + c.measureText(label).width + 14;
        });

        /* Gutter separator */
        c.strokeStyle = theme.color('border-strong');
        c.lineWidth = 1;
        c.beginPath();
        c.moveTo(GUTTER_W, 0);
        c.lineTo(GUTTER_W, H);
        c.stroke();

        /* ── Time axis ──────────────────────────────────────────────── */

        var axisY = H - AXIS_H;

        c.strokeStyle = theme.color('border');
        c.lineWidth = 1;
        c.beginPath();
        c.moveTo(tlX, axisY);
        c.lineTo(W, axisY);
        c.stroke();

        var tickInterval = chooseTick(windowMs, tlW);
        var firstTick = Math.ceil(tStart / tickInterval) * tickInterval;
        c.font = '600 9px "Segoe UI", system-ui, sans-serif';
        c.fillStyle = theme.color('text-3');
        c.textAlign = 'center';

        for (var tk = firstTick; tk <= now; tk += tickInterval) {
          var tx = tlX + (tk - tStart) / windowMs * tlW;
          c.strokeStyle = theme.color('border');
          c.lineWidth = 1;
          c.beginPath();
          c.moveTo(tx, axisY);
          c.lineTo(tx, axisY + 4);
          c.stroke();
          c.fillText(formatTick(tk, windowMs), tx, H - 4);

          /* Faint vertical grid line through the rows */
          c.strokeStyle = theme.color('border');
          c.globalAlpha = 0.35;
          c.beginPath();
          c.moveTo(tx, LEGEND_H);
          c.lineTo(tx, axisY);
          c.stroke();
          c.globalAlpha = 1;
        }

        /* ── Row rendering ──────────────────────────────────────────── */

        var rowsAreaH = axisY - LEGEND_H;
        var rowY = LEGEND_H;

        /* Clip to row area */
        c.save();
        c.rect(0, LEGEND_H, W, rowsAreaH);
        c.clip();

        c.textAlign = 'left';

        visibleRows.forEach(function (row) {
          if (rowY >= axisY) { return; }

          if (row.isHeader) {
            /* Group header */
            var hH = HEADER_ROW_H;
            c.fillStyle = theme.color('bg-raised');
            c.fillRect(0, rowY, W, hH);

            var indent = 6 + row.depth * 8;
            var isCollapsed = collapsible && collapsedState[row.key];

            /* Draw chevron */
            if (collapsible && row.key !== undefined) {
              c.font = '700 9px "Segoe UI", system-ui, sans-serif';
              c.fillStyle = theme.color('text-3');
              c.fillText(
                isCollapsed ? '▶' : '▼',
                indent, rowY + hH / 2 + 3
              );
              indent += CHEVRON_W;
            }

            c.font = '700 10px "Segoe UI", system-ui, sans-serif';
            c.fillStyle = theme.color('text-3');
            c.fillText(
              truncate(c, row.label, GUTTER_W - indent - 8),
              indent, rowY + hH / 2 + 3
            );

            rowY += hH;
            return;
          }

          /* Data row */
          var dp = row.datapoint;
          var rd = rowData[dp];

          /* Label */
          c.font = '600 10px "Segoe UI", system-ui, sans-serif';
          c.fillStyle = theme.color('text-2');
          var labelIndent = 6 + row.depth * 8;
          var shortLabel = dp.split('.').slice(-2).join('.');
          c.fillText(
            truncate(c, shortLabel, GUTTER_W - labelIndent - 8),
            labelIndent, rowY + rowH / 2 + 3
          );

          /* Row separator */
          c.strokeStyle = theme.color('border');
          c.lineWidth = 0.5;
          c.beginPath();
          c.moveTo(0, rowY + rowH);
          c.lineTo(W, rowY + rowH);
          c.stroke();

          /* Timeline bars */
          if (rd && rd.samples.length) {
            /* Build segment list: merge consecutive same-value samples */
            var segments = [];
            var samples = rd.samples;
            var seg = null;

            for (var si = 0; si < samples.length; si++) {
              var samp = samples[si];
              var sampT = samp.t;
              if (sampT < tStart - 5000) { continue; }   /* well outside window */

              var val = samp.v;
              var qual = samp.quality || 'Good';
              var isBad = qual === 'Bad';

              if (!seg || String(seg.v) !== String(val) || seg.bad !== isBad) {
                if (seg) { seg.t1 = sampT; segments.push(seg); }
                seg = { v: val, bad: isBad, t0: sampT, t1: sampT };
              } else {
                seg.t1 = sampT;
              }
            }
            if (seg) {
              seg.t1 = now;   /* extend last segment to now */
              segments.push(seg);
            }

            segments.forEach(function (sg) {
              var x0 = tlX + Math.max(0, (sg.t0 - tStart) / windowMs * tlW);
              var x1 = tlX + Math.min(tlW, (sg.t1 - tStart) / windowMs * tlW);
              if (x1 <= tlX || x0 >= tlX + tlW) { return; }

              var barColor;
              if (sg.bad) {
                barColor = theme.color('text-3');
              } else {
                barColor = resolveColor(sg.v);
                /* Update dynamic legend */
                var vk = String(sg.v);
                if (!dynamicLegend[vk]) { dynamicLegend[vk] = barColor; }
              }

              var pad = 2;
              var bY = rowY + pad;
              var bH = rowH - pad * 2;

              if (sg.bad) {
                /* hatched dim-gray pattern */
                var patt = makeHatchPattern(c, barColor);
                c.fillStyle = patt;
                c.globalAlpha = 0.6;
              } else {
                c.fillStyle = barColor;
                c.globalAlpha = 1;
              }
              c.fillRect(x0, bY, Math.max(1, x1 - x0), bH);
              c.globalAlpha = 1;
            });
          }

          /* Hover highlight */
          if (hoverInfo && hoverInfo.dp === dp) {
            var hx0 = tlX + Math.max(0, (hoverInfo.t0 - tStart) / windowMs * tlW);
            var hx1 = tlX + Math.min(tlW, (hoverInfo.t1 - tStart) / windowMs * tlW);
            c.strokeStyle = theme.color('accent');
            c.lineWidth = 1.5;
            c.strokeRect(hx0 + 0.5, rowY + 2.5, Math.max(1, hx1 - hx0) - 1, rowH - 5);
          }

          rowY += rowH;
        });

        c.restore();

        /* Truncation note */
        if (truncatedCount > 0 && rowY < axisY) {
          c.font = '600 10px "Segoe UI", system-ui, sans-serif';
          c.fillStyle = theme.color('text-3');
          c.textAlign = 'left';
          c.fillText('+' + truncatedCount + ' more (increase maxRows to show)', 8, rowY + 12);
        }
      }

      /* ── Redraw coalescing ────────────────────────────────────────────── */

      var redrawQueued = false;
      var lastDraw = 0;
      var DRAW_INTERVAL = 1000;   /* max 1fps */

      function paint() {
        lastDraw = Date.now();
        redrawQueued = false;
        draw();
      }

      function scheduleRedraw() {
        if (redrawQueued) { return; }
        var wait = Math.max(0, DRAW_INTERVAL - (Date.now() - lastDraw));
        if (wait === 0) { paint(); return; }
        redrawQueued = true;
        setTimeout(paint, wait);
      }

      /* ── Subscriptions ────────────────────────────────────────────────── */

      dataRows.forEach(function (row) {
        var dp = row.datapoint;
        ctx.subscribe(dp, function (sample) {
          var rd = rowData[dp];
          if (!rd) { return; }
          rd.last = sample;
          var v = (sample.value !== null && sample.value !== undefined) ? sample.value : '';
          rd.samples.push({ t: sample.ts || Date.now(), v: v, quality: sample.quality || 'Good' });
          if (rd.samples.length > ROW_BUF_MAX) {
            rd.samples.splice(0, rd.samples.length - ROW_BUF_MAX);
          }
          scheduleRedraw();
        });
      });

      /* Sliding-window redraw so bars scroll even when no new data arrives */
      var slideTimer = setInterval(scheduleRedraw, DRAW_INTERVAL);

      /* ── Shared layout-walk helper ─────────────────────────────────────
       *
       * Walks the visible row list and calls cb(row, rectY) for each row.
       * Returns early (with the cb's return value) if cb returns a non-null/
       * non-undefined value — similar to Array.find semantics.
       *
       * Both findSegmentAt (mousemove) and the click handler use this so the
       * layout arithmetic stays in one place.
       */
      function walkVisibleRows(visibleRows, cb) {
        var rectY = LEGEND_H;
        for (var ri = 0; ri < visibleRows.length; ri++) {
          var row = visibleRows[ri];
          var rh  = row.isHeader ? HEADER_ROW_H : rowH;
          var result = cb(row, rectY, rh);
          if (result !== null && result !== undefined) { return result; }
          rectY += rh;
        }
        return null;
      }

      /* ── Hover / tooltip ──────────────────────────────────────────────── */

      function findSegmentAt(canvasX, canvasY) {
        var visibleRows = buildVisibleRows();
        return walkVisibleRows(visibleRows, function (row, rectY, rh) {
          if (canvasY < rectY || canvasY >= rectY + rh) { return undefined; }
          if (row.isHeader) { return null; }   /* hit a header — no tooltip */

          /* Determine time */
          var tOffset = (canvasX - GUTTER_W) / (cssW - GUTTER_W) * windowMs;
          var tHit = Date.now() - windowMs + tOffset;
          /* Find matching segment */
          var rd = rowData[row.datapoint];
          if (!rd || !rd.samples.length) { return null; }
          var samples = rd.samples;
          var tStart2 = Date.now() - windowMs;
          var seg = null, segT0, segT1;
          var prevT = tStart2;
          var prevV = null, prevQ = null;
          for (var si = 0; si < samples.length; si++) {
            var s = samples[si];
            if (s.t < tStart2) { prevT = s.t; prevV = s.v; prevQ = s.quality; continue; }
            var segEnd = si + 1 < samples.length ? samples[si + 1].t : Date.now();
            if (tHit >= s.t && tHit <= segEnd) {
              seg = { v: s.v, quality: s.quality };
              segT0 = s.t;
              segT1 = segEnd;
              break;
            }
            prevT = s.t; prevV = s.v; prevQ = s.quality;
          }
          if (!seg && prevV !== null) {
            seg = { v: prevV, quality: prevQ };
            segT0 = prevT;
            segT1 = Date.now();
          }
          if (seg) {
            return {
              dp: row.datapoint, value: seg.v, quality: seg.quality,
              t0: segT0, t1: segT1, rowY: rectY, rowH: rh,
            };
          }
          return null;
        });
      }

      canvas.addEventListener('mousemove', function (e) {
        var rect = canvas.getBoundingClientRect();
        var mx = e.clientX - rect.left;
        var my = e.clientY - rect.top;
        var info = findSegmentAt(mx, my);
        if (info) {
          hoverInfo = info;
          tooltip.style.display = 'block';
          /* Position tooltip above row */
          tooltip.style.left = Math.min(mx + 10, cssW - 160) + 'px';
          tooltip.style.top  = Math.max(0, info.rowY - 46) + 'px';
          tooltip.innerHTML =
            '<div class="gantt-tt-dp">'    + info.dp    + '</div>' +
            '<div class="gantt-tt-val">'   + String(info.value) + '</div>' +
            (info.quality !== 'Good' ? '<div class="gantt-tt-qual">' + info.quality + '</div>' : '') +
            '<div class="gantt-tt-time">'  + new Date(info.t0).toLocaleTimeString() + '</div>';
          scheduleRedraw();
        } else {
          if (hoverInfo) { hoverInfo = null; tooltip.style.display = 'none'; scheduleRedraw(); }
        }
      });

      canvas.addEventListener('mouseleave', function () {
        if (hoverInfo) { hoverInfo = null; tooltip.style.display = 'none'; scheduleRedraw(); }
      });

      /* ── Click handler for collapsible headers ────────────────────────── */

      if (collapsible) {
        canvas.addEventListener('click', function (e) {
          var rect = canvas.getBoundingClientRect();
          var mx = e.clientX - rect.left;
          var my = e.clientY - rect.top;

          var visibleRows = buildVisibleRows();
          var hit = walkVisibleRows(visibleRows, function (row, rectY, rh) {
            if (!row.isHeader) { return undefined; }
            if (my >= rectY && my < rectY + rh) { return row; }
            return undefined;
          });

          if (hit && hit.key !== undefined) {
            /* Toggle collapsed state */
            collapsedState[hit.key] = !collapsedState[hit.key];
            if (!collapsedState[hit.key]) { delete collapsedState[hit.key]; }

            /* Clear hover since row positions changed */
            hoverInfo = null;
            tooltip.style.display = 'none';

            /* Update wrap height, re-size canvas, redraw */
            var newVisible = buildVisibleRows();
            updateWrapHeight(newVisible);
            sizeCanvas();
            paint();
          }
        });
      }

      /* ── Initial size + draw ───────────────────────────────────────────── */

      /* Apply initial collapsed groups height before first paint */
      var initialVisible = buildVisibleRows();
      updateWrapHeight(initialVisible);
      sizeCanvas();
      paint();

      /* ── Public API ────────────────────────────────────────────────────── */

      return {
        resize: function () {
          var vis = buildVisibleRows();
          updateWrapHeight(vis);
          sizeCanvas();
          paint();
        },
        destroy: function () {
          clearInterval(slideTimer);
        },
      };
    },
  });
}(window.SFP));
