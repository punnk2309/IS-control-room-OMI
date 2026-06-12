/* ============================================================================
 * mollier-monitor — Live Psychrometric / Mollier Chart for Creamer Spray Dryer
 * ----------------------------------------------------------------------------
 * ModuleHub module — plain JS, sandboxed iframe, ALL I/O via injected `sdk`.
 * No network, no external deps, no build step.
 *
 * Contract:  modulehub-contracts.md §3, §4, §6
 * Spec:      module-maker-plan.md §4
 * SDK calls: sdk.env.*, sdk.config, sdk.data.subscribe, sdk.data.write,
 *            sdk.store.kv.get, sdk.store.kv.put, sdk.ui.color, sdk.ui.el,
 *            sdk.ui.toast, sdk.log
 *
 * SECTIONS
 *   A  Psychrometrics  — pure functions (Magnus / ASHRAE)
 *   B  Sticky-point    — T_sticky(RH_pct, TS_pct) and margin helpers
 *   C  Ring buffer     — fixed-size circular ring buffer
 *   D  Simulation map  — scale 0-100 raw values to engineering ranges
 *   E  State           — module-level mutable state
 *   F  Canvas helpers  — coordinate transform, DPR-aware sizing
 *   G  Static layer    — axes, RH curves, isotherms, enthalpy lines, regions
 *   H  Live layer      — rAF comet trails
 *   I  Side panel      — tiles + sparklines for non-air params
 *   J  Early warning   — margin tracking, ETA extrapolation, banner, write
 *   K  Settings popover— sticky-param editor persisted via sdk.store.kv
 *   L  create / destroy— MH.register entry points
 * ============================================================================ */

/* Shared state hoisted outside create/destroy so both methods close over it */
var _mm = {
  rafHandle:          null,
  resizeObserver:     null,
  stickyThrottleTimer: null,
  unsubs:             []
};

MH.register({

  /* ==========================================================================
   * L-create  create(sdk, root)
   * ======================================================================== */
  create: function (sdk, root) {
    'use strict';

    /* ── A. PSYCHROMETRICS (Magnus / ASHRAE) ────────────────────────────── */

    /**
     * Saturation vapour pressure [kPa] — Magnus formula.
     * Accurate ±0.5% over −20…60 °C; ±2% to ~100 °C (adequate for chart).
     * @param  {number} T  dry-bulb [°C]
     * @returns {number}   pws [kPa]
     */
    function pws(T) {
      return 0.61094 * Math.exp(17.625 * T / (T + 243.04));
    }

    /**
     * Humidity ratio [g water / kg dry air].
     * @param  {number} T   dry-bulb [°C]
     * @param  {number} RH  relative humidity [%]
     * @param  {number} P   total pressure [kPa]
     * @returns {number} x [g/kg]
     */
    function humidityRatio(T, RH, P) {
      var pw = (RH / 100) * pws(T);
      if (pw >= P) { return 622 * 0.99; }   // saturated guard
      return 622 * (pw / (P - pw));
    }

    /**
     * Specific enthalpy of moist air [kJ / kg dry air].
     * @param  {number} T  dry-bulb [°C]
     * @param  {number} x  humidity ratio [g/kg]
     * @returns {number} h [kJ/kg]
     */
    function enthalpy(T, x) {
      return 1.006 * T + (x / 1000) * (2501 + 1.86 * T);
    }

    /**
     * Relative humidity from (T, x) — inversion of humidityRatio().
     * @param  {number} T  dry-bulb [°C]
     * @param  {number} x  humidity ratio [g/kg]
     * @param  {number} P  total pressure [kPa]
     * @returns {number} RH [%]
     */
    function rhFromTX(T, x, P) {
      var pw  = (x * P) / (622 + x);
      var sat = pws(T);
      if (sat <= 0) { return 0; }
      return Math.min(100, (pw / sat) * 100);
    }

    /* ── B. STICKY-POINT MODEL ──────────────────────────────────────────── */

    /**
     * Glass-transition / sticky-point temperature [°C].
     *
     *   T_sticky = T0 - slopeRH*(RH_pct - 50)/10 + tsShiftPerPct*(TS_pct - tsRef)
     *
     * Physics:
     *   Higher RH  → lower T_sticky   (product stickier when humid)
     *   Higher TS% → higher T_sticky  (more concentrated → higher glass-T)
     *
     * @param  {number} RH_pct  outlet relative humidity [%]
     * @param  {number} TS_pct  concentrate total solids [%]
     * @param  {object} sp      {T0, slopeRH, tsShiftPerPct, tsRef}
     * @returns {number} T_sticky [°C]
     */
    function tSticky(RH_pct, TS_pct, sp) {
      return sp.T0
        - sp.slopeRH * (RH_pct - 50) / 10
        + sp.tsShiftPerPct * (TS_pct - sp.tsRef);
    }

    /**
     * Safety margin = T_outlet − T_sticky.
     * Positive = safe; negative = inside sticky / lumping risk region.
     */
    function stickyMargin(T_outlet, RH_outlet, TS_pct, sp) {
      return T_outlet - tSticky(RH_outlet, TS_pct, sp);
    }

    /* ── C. RING BUFFER ─────────────────────────────────────────────────── */

    /**
     * Fixed-size circular ring buffer.
     * push(v) overwrites oldest entry when full.
     * toArray() returns items in insertion order (oldest → newest).
     */
    function RingBuffer(capacity) {
      var buf  = new Array(capacity);
      var head = 0;   // next write slot
      var size = 0;
      return {
        push: function (v) {
          buf[head] = v;
          head = (head + 1) % capacity;
          if (size < capacity) { size++; }
        },
        toArray: function () {
          if (size === 0) { return []; }
          var out   = new Array(size);
          var start = size < capacity ? 0 : head;
          for (var i = 0; i < size; i++) {
            out[i] = buf[(start + i) % capacity];
          }
          return out;
        },
        get size()  { return size; },
        clear: function () { head = 0; size = 0; }
      };
    }

    /* ── D. SIMULATION MAPPING ──────────────────────────────────────────── */

    /**
     * When sdk.env.simulation, host sends random-walk values 0-100.
     * Map each tag's raw value into its configured engineering span.
     * @param  {object} simRanges  config.simRanges
     * @returns {function(tagKey, rawValue): number}
     */
    function makeSimMapper(simRanges) {
      return function mapValue(tagKey, rawValue) {
        var r = simRanges[tagKey];
        if (!r) { return rawValue; }
        return r[0] + (rawValue / 100) * (r[1] - r[0]);
      };
    }

    /* ══════════════════════════════════════════════════════════════════════
     * E. MODULE STATE
     * ══════════════════════════════════════════════════════════════════════ */

    var cfg     = sdk.config;
    var P       = cfg.chart.pressureKPa;        // total pressure [kPa]
    var mapSim  = makeSimMapper(cfg.simRanges);
    var isSim   = sdk.env.simulation;
    var el      = sdk.ui.el;

    // Sticky parameters (loaded from store; start with config defaults)
    var stickyP = {
      T0:            cfg.sticky.T0,
      slopeRH:       cfg.sticky.slopeRH,
      tsShiftPerPct: cfg.sticky.tsShiftPerPct,
      tsRef:         cfg.sticky.tsRef
    };

    // Live engineering-unit values for every subscribed tag
    var liveValues = {
      inletT:        null,
      inletRH:       null,
      outletT:       null,
      outletRH:      null,
      fbedT:         null,
      exhaustT:      null,
      concentrateT:  null,
      totalSolids:   null,
      sprayAngle:    null,
      atomizerSpeed: null,
      chamberDP:     null
    };

    // Axis mode: 'psychrometric' → x = humidity ratio, y = T
    //            'mollier'       → x = T, y = humidity ratio  (DIN 90°-flip)
    var axisMode = 'psychrometric';

    // Chart streams: inlet(chart-1), outlet(chart-2), fbed(chart-3), exhaust(chart-4)
    var TRAIL_CAP = cfg.trailPoints;
    var streams = {
      inlet:   { color: 'chart-1', trail: RingBuffer(TRAIL_CAP), label: 'IN',   T: null, x_gkg: null },
      outlet:  { color: 'chart-2', trail: RingBuffer(TRAIL_CAP), label: 'OUT',  T: null, x_gkg: null },
      fbed:    { color: 'chart-3', trail: RingBuffer(TRAIL_CAP), label: 'FBED', T: null, x_gkg: null },
      exhaust: { color: 'chart-4', trail: RingBuffer(TRAIL_CAP), label: 'EXH',  T: null, x_gkg: null }
    };

    // Margin history for ETA extrapolation: { ts, margin }
    var MARGIN_HISTORY_CAP = 360;   // 6 min at 1 Hz — covers 5-min window
    var marginHistory = RingBuffer(MARGIN_HISTORY_CAP);

    // Warning state machine
    var warnState = 'OK';    // 'OK' | 'WARN' | 'ALARM'
    var warnETA   = null;    // projected ETA in minutes (WARN only)
    var _warnWritePending = false;

    // Side-panel sparkline data (60 samples per tile)
    var SPARK_CAP = 60;
    var sparkData = {
      concentrateT:  RingBuffer(SPARK_CAP),
      totalSolids:   RingBuffer(SPARK_CAP),
      sprayAngle:    RingBuffer(SPARK_CAP),
      atomizerSpeed: RingBuffer(SPARK_CAP),
      chamberDP:     RingBuffer(SPARK_CAP)
    };

    // DOM references (populated below)
    var canvasStatic     = null;
    var canvasLive       = null;
    var ctxStatic        = null;
    var ctxLive          = null;
    var bannerEl         = null;
    var axisBtn          = null;
    var gearBtn          = null;
    var settingsPopover  = null;
    var tileEls          = {};

    // Canvas dirty flags
    var staticDirty       = true;
    var rafDirty          = true;
    var stickyRegionDirty = true;
    var _REGION_CACHE     = null;

    // rAF timing
    var _lastRafTime     = 0;
    var RAF_MIN_INTERVAL = 100;  // ms → max ~10 fps on live layer

    /* ══════════════════════════════════════════════════════════════════════
     * F. CANVAS HELPERS
     * ══════════════════════════════════════════════════════════════════════ */

    var MARGIN_CHART = { top: 36, right: 16, bottom: 52, left: 58 };
    var SIDE_W = 240;   // CSS px — side panel width

    /**
     * Chart inner drawing rectangle (CSS px, chart-canvas-relative).
     * Excludes side panel width and axis margins.
     */
    function chartRect(canvas) {
      var w = canvas.clientWidth;
      var h = canvas.clientHeight;
      return {
        x:  MARGIN_CHART.left,
        y:  MARGIN_CHART.top,
        w:  Math.max(10, w - MARGIN_CHART.left - MARGIN_CHART.right),
        h:  Math.max(10, h - MARGIN_CHART.top  - MARGIN_CHART.bottom)
      };
    }

    /**
     * Resize a canvas to DPR-correct physical pixels.
     * @returns {boolean} true if canvas was actually resized.
     */
    function resizeCanvas(canvas) {
      var dpr  = window.devicePixelRatio || 1;
      var cssW = canvas.clientWidth;
      var cssH = canvas.clientHeight;
      var wantW = Math.round(cssW * dpr);
      var wantH = Math.round(cssH * dpr);
      if (canvas.width !== wantW || canvas.height !== wantH) {
        canvas.width  = wantW;
        canvas.height = wantH;
        return true;
      }
      return false;
    }

    /** Apply DPR scale transform so we draw in CSS-pixel space. */
    function applyDpr(ctx) {
      var dpr = window.devicePixelRatio || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    /**
     * Build coordinate-transform functions for the current axisMode.
     * All coordinates are in CSS-pixel space (pre-DPR).
     *
     * Psychrometric: x-axis = humidity ratio [g/kg],  y-axis = T [°C]
     * Mollier (DIN): x-axis = T [°C],                 y-axis = humidity ratio [g/kg]
     *
     * @param  {HTMLCanvasElement} canvas
     * @returns {{ toCanvas, fromCanvas, xLabel, yLabel }}
     */
    function makeTransform(canvas) {
      var r    = chartRect(canvas);
      var tMax = cfg.chart.tMax;
      var xMax = cfg.chart.xMax;

      if (axisMode === 'psychrometric') {
        return {
          toCanvas: function (T, x_gkg) {
            return {
              cx: r.x + (x_gkg / xMax) * r.w,
              cy: r.y + (1 - T / tMax) * r.h
            };
          },
          fromCanvas: function (cx, cy) {
            return {
              T:     (1 - (cy - r.y) / r.h) * tMax,
              x_gkg: ((cx - r.x)     / r.w) * xMax
            };
          },
          xLabel: 'Humidity ratio  x  [g/kg]',
          yLabel: 'Dry-bulb temperature  T  [°C]'
        };
      } else {
        // Mollier / DIN: T on x, humidity ratio on y
        return {
          toCanvas: function (T, x_gkg) {
            return {
              cx: r.x + (T / tMax)           * r.w,
              cy: r.y + (1 - x_gkg / xMax)   * r.h
            };
          },
          fromCanvas: function (cx, cy) {
            return {
              T:     ((cx - r.x)   / r.w) * tMax,
              x_gkg: (1 - (cy - r.y) / r.h) * xMax
            };
          },
          xLabel: 'Dry-bulb temperature  T  [°C]',
          yLabel: 'Humidity ratio  x  [g/kg]'
        };
      }
    }

    /* ══════════════════════════════════════════════════════════════════════
     * G. STATIC LAYER — axes, isolines, saturation curve, sticky regions
     * ══════════════════════════════════════════════════════════════════════ */

    /**
     * Compute the sticky-boundary curve as (T, x_gkg) point arrays.
     * Sweeps RH 1→100% and finds (T_sticky, x) for that RH.
     * Returns two arrays: boundary (warn edge) and alarmBoundary (5°C deeper).
     */
    function computeStickyBoundary(sp, TS_pct, P_kpa) {
      var boundary      = [];
      var alarmBoundary = [];
      for (var rh = 1; rh <= 100; rh++) {
        var ts_temp   = tSticky(rh, TS_pct, sp);
        var ts_alarm  = ts_temp - 5;
        var x1        = humidityRatio(ts_temp,  rh, P_kpa);
        var x2        = humidityRatio(ts_alarm, rh, P_kpa);
        if (x1 >= 0 && x1 <= cfg.chart.xMax * 1.05) {
          boundary.push({ T: ts_temp, x_gkg: x1 });
        }
        if (x2 >= 0 && x2 <= cfg.chart.xMax * 1.05) {
          alarmBoundary.push({ T: ts_alarm, x_gkg: x2 });
        }
      }
      return { boundary: boundary, alarmBoundary: alarmBoundary };
    }

    /** Shade a risk region polygon against the chart bottom-left edge. */
    function drawRegionFill(ctx, tr, r, boundaryPts, color, alpha) {
      if (!boundaryPts || boundaryPts.length < 2) { return; }
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle   = color;
      ctx.beginPath();
      ctx.moveTo(r.x, r.y + r.h);  // bottom-left corner
      var first = boundaryPts[0];
      var fp = tr.toCanvas(first.T, Math.max(0, first.x_gkg));
      ctx.lineTo(fp.cx, fp.cy);
      for (var bi = 1; bi < boundaryPts.length; bi++) {
        var bp = tr.toCanvas(boundaryPts[bi].T, Math.max(0, boundaryPts[bi].x_gkg));
        ctx.lineTo(bp.cx, bp.cy);
      }
      ctx.lineTo(r.x, r.y + r.h);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    /** Draw axes, labels, ticks onto ctx for the chart rect r. */
    function drawAxes(ctx, canvas, tr, r) {
      var tMax = cfg.chart.tMax;
      var xMax = cfg.chart.xMax;
      var H    = canvas.clientHeight;

      // Border lines
      ctx.strokeStyle = sdk.ui.color('border-strong');
      ctx.lineWidth   = 1;
      ctx.beginPath();
      ctx.moveTo(r.x,       r.y + r.h);
      ctx.lineTo(r.x + r.w, r.y + r.h);
      ctx.moveTo(r.x,       r.y);
      ctx.lineTo(r.x,       r.y + r.h);
      ctx.stroke();

      ctx.fillStyle    = sdk.ui.color('text-2');
      ctx.font         = '10px "Segoe UI",system-ui,sans-serif';

      if (axisMode === 'psychrometric') {
        // X ticks: humidity ratio 0..xMax every 5 g/kg
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'top';
        for (var xTick = 0; xTick <= xMax; xTick += 5) {
          var xp = tr.toCanvas(0, xTick);
          ctx.beginPath();
          ctx.moveTo(xp.cx, r.y + r.h);
          ctx.lineTo(xp.cx, r.y + r.h + 5);
          ctx.stroke();
          if (xTick % 10 === 0) {
            ctx.fillText(String(xTick), xp.cx, r.y + r.h + 7);
          }
        }
        // Y ticks: T every 20°C
        ctx.textAlign    = 'right';
        ctx.textBaseline = 'middle';
        for (var yTick = 0; yTick <= tMax; yTick += 20) {
          var yp = tr.toCanvas(yTick, 0);
          ctx.beginPath();
          ctx.moveTo(r.x,     yp.cy);
          ctx.lineTo(r.x - 5, yp.cy);
          ctx.stroke();
          ctx.fillText(String(yTick), r.x - 8, yp.cy);
        }
      } else {
        // Mollier: X ticks T every 20°C
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'top';
        for (var mxTick = 0; mxTick <= tMax; mxTick += 20) {
          var mxp = tr.toCanvas(mxTick, 0);
          ctx.beginPath();
          ctx.moveTo(mxp.cx, r.y + r.h);
          ctx.lineTo(mxp.cx, r.y + r.h + 5);
          ctx.stroke();
          ctx.fillText(String(mxTick), mxp.cx, r.y + r.h + 7);
        }
        // Y ticks: humidity ratio every 5 g/kg
        ctx.textAlign    = 'right';
        ctx.textBaseline = 'middle';
        for (var myTick = 0; myTick <= xMax; myTick += 5) {
          var myp = tr.toCanvas(0, myTick);
          ctx.beginPath();
          ctx.moveTo(r.x,     myp.cy);
          ctx.lineTo(r.x - 5, myp.cy);
          ctx.stroke();
          if (myTick % 10 === 0) {
            ctx.fillText(String(myTick), r.x - 8, myp.cy);
          }
        }
      }

      // Axis labels
      ctx.save();
      ctx.fillStyle    = sdk.ui.color('text-1');
      ctx.font         = '11px "Segoe UI",system-ui,sans-serif';
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'bottom';
      // X-axis label
      ctx.fillText(tr.xLabel, r.x + r.w / 2, H - 4);
      // Y-axis label (rotated)
      ctx.translate(13, r.y + r.h / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.textBaseline = 'top';
      ctx.fillText(tr.yLabel, 0, 0);
      ctx.restore();
    }

    /** Full redraw of the static canvas. */
    function drawStatic() {
      if (!canvasStatic || !ctxStatic) { return; }
      resizeCanvas(canvasStatic);
      applyDpr(ctxStatic);

      var ctx  = ctxStatic;
      var W    = canvasStatic.clientWidth;
      var H    = canvasStatic.clientHeight;
      var r    = chartRect(canvasStatic);
      var tr   = makeTransform(canvasStatic);
      var tMax = cfg.chart.tMax;
      var xMax = cfg.chart.xMax;

      // Background
      ctx.fillStyle = sdk.ui.color('bg-surface');
      ctx.fillRect(0, 0, W, H);

      // Clip to chart interior
      ctx.save();
      ctx.beginPath();
      ctx.rect(r.x, r.y, r.w, r.h);
      ctx.clip();

      // ── RH curves 10..100% in 10% steps ──────────────────────────────────
      for (var rh = 10; rh <= 100; rh += 10) {
        ctx.beginPath();
        ctx.lineWidth   = rh === 100 ? 1.25 : 0.6;
        ctx.strokeStyle = rh === 100
          ? sdk.ui.color('text-2')
          : sdk.ui.color('border');
        var rhFirst = true;
        for (var rhT = 0; rhT <= tMax; rhT += 2) {
          var rhX = humidityRatio(rhT, rh, P);
          if (rhX < 0 || rhX > xMax * 1.05) { rhFirst = true; continue; }
          var rhPt = tr.toCanvas(rhT, rhX);
          if (rhFirst) { ctx.moveTo(rhPt.cx, rhPt.cy); rhFirst = false; }
          else          { ctx.lineTo(rhPt.cx, rhPt.cy); }
        }
        ctx.stroke();

        // RH label near T = 130°C
        var lblT  = Math.min(130, tMax - 30);
        var lblX  = humidityRatio(lblT, rh, P);
        if (lblX >= 0 && lblX <= xMax) {
          var lp = tr.toCanvas(lblT, lblX);
          ctx.fillStyle    = sdk.ui.color('text-3');
          ctx.font         = '9px "Segoe UI",system-ui,sans-serif';
          ctx.textAlign    = 'left';
          ctx.textBaseline = 'bottom';
          ctx.fillText(rh + '%', lp.cx + 2, lp.cy - 1);
        }
      }

      // ── Isotherms every 10°C ──────────────────────────────────────────────
      ctx.setLineDash([3, 4]);
      ctx.lineWidth   = 0.5;
      ctx.strokeStyle = sdk.ui.color('border');
      for (var iT = 0; iT <= tMax; iT += 10) {
        ctx.beginPath();
        var ip0 = tr.toCanvas(iT, 0);
        var ip1 = tr.toCanvas(iT, xMax);
        ctx.moveTo(ip0.cx, ip0.cy);
        ctx.lineTo(ip1.cx, ip1.cy);
        ctx.stroke();
      }
      ctx.setLineDash([]);

      // ── Enthalpy isolines every 50 kJ/kg ──────────────────────────────────
      // From h = 1.006*T + (x/1000)*(2501+1.86*T), solve for x:
      //   x = (h - 1.006*T) * 1000 / (2501 + 1.86*T)
      ctx.setLineDash([6, 6]);
      ctx.lineWidth = 0.5;
      for (var hLine = 50; hLine <= 700; hLine += 50) {
        ctx.beginPath();
        ctx.strokeStyle = sdk.ui.color('info');
        var hFirst = true;
        for (var hT = 0; hT <= tMax; hT += 2) {
          var xH = (hLine - 1.006 * hT) * 1000 / (2501 + 1.86 * hT);
          if (xH < 0 || xH > xMax * 1.05) { hFirst = true; continue; }
          var hPt = tr.toCanvas(hT, xH);
          if (hFirst) { ctx.moveTo(hPt.cx, hPt.cy); hFirst = false; }
          else         { ctx.lineTo(hPt.cx, hPt.cy); }
        }
        ctx.stroke();
        // Label at T = 20°C
        var hLblX = (hLine - 1.006 * 20) * 1000 / (2501 + 1.86 * 20);
        if (hLblX >= 0 && hLblX <= xMax) {
          var hLP = tr.toCanvas(20, hLblX);
          ctx.fillStyle    = sdk.ui.color('info');
          ctx.font         = '8px "Segoe UI",system-ui,sans-serif';
          ctx.textAlign    = 'center';
          ctx.textBaseline = 'bottom';
          ctx.fillText(hLine + ' kJ', hLP.cx, hLP.cy - 1);
        }
      }
      ctx.setLineDash([]);

      // ── Saturation curve (φ = 100%) ───────────────────────────────────────
      ctx.beginPath();
      ctx.strokeStyle = sdk.ui.color('accent');
      ctx.lineWidth   = 1.5;
      var satFirst = true;
      for (var sT = 0; sT <= tMax; sT++) {
        var sX = humidityRatio(sT, 100, P);
        if (sX > xMax * 1.05) { satFirst = true; continue; }
        var sPt = tr.toCanvas(sT, Math.min(sX, xMax));
        if (satFirst) { ctx.moveTo(sPt.cx, sPt.cy); satFirst = false; }
        else           { ctx.lineTo(sPt.cx, sPt.cy); }
      }
      ctx.stroke();

      // ── Sticky / lumping risk regions ─────────────────────────────────────
      var ts_pct = liveValues.totalSolids !== null ? liveValues.totalSolids : stickyP.tsRef;
      if (!_REGION_CACHE || stickyRegionDirty) {
        _REGION_CACHE     = computeStickyBoundary(stickyP, ts_pct, P);
        stickyRegionDirty = false;
      }

      // WARN fill: T < T_sticky
      drawRegionFill(ctx, tr, r, _REGION_CACHE.boundary,
        sdk.ui.color('warn'),  0.10);
      // ALARM fill: T < T_sticky − 5
      drawRegionFill(ctx, tr, r, _REGION_CACHE.alarmBoundary,
        sdk.ui.color('alarm'), 0.15);

      // Sticky boundary dashed line
      if (_REGION_CACHE.boundary.length >= 2) {
        ctx.beginPath();
        ctx.strokeStyle = sdk.ui.color('warn');
        ctx.lineWidth   = 1.5;
        ctx.setLineDash([5, 3]);
        var sbFirst = true;
        for (var si = 0; si < _REGION_CACHE.boundary.length; si++) {
          var sbPt = tr.toCanvas(
            _REGION_CACHE.boundary[si].T,
            _REGION_CACHE.boundary[si].x_gkg
          );
          if (sbFirst) { ctx.moveTo(sbPt.cx, sbPt.cy); sbFirst = false; }
          else          { ctx.lineTo(sbPt.cx, sbPt.cy); }
        }
        ctx.stroke();
        ctx.setLineDash([]);
      }

      ctx.restore();  // end clip

      // ── Axes drawn outside clip ───────────────────────────────────────────
      drawAxes(ctx, canvasStatic, tr, r);

      staticDirty = false;
    }

    /* ══════════════════════════════════════════════════════════════════════
     * H. LIVE LAYER — rAF comet trails
     * ══════════════════════════════════════════════════════════════════════ */

    /** Draw a single stream's comet trail and current state point. */
    function drawStream(ctx, tr, stream, isOutlet) {
      var trail = stream.trail.toArray();
      if (trail.length === 0) { return; }

      var clr = sdk.ui.color(stream.color);

      // Trail segments with fading alpha (oldest faint → newest full)
      if (trail.length > 1) {
        for (var i = 0; i < trail.length - 1; i++) {
          var alpha  = 0.05 + 0.65 * (i / (trail.length - 1));
          var pt0    = tr.toCanvas(trail[i].T,     trail[i].x_gkg);
          var pt1    = tr.toCanvas(trail[i + 1].T, trail[i + 1].x_gkg);
          ctx.beginPath();
          ctx.strokeStyle  = clr;
          ctx.globalAlpha  = alpha;
          ctx.lineWidth    = isOutlet ? 2 : 1;
          ctx.moveTo(pt0.cx, pt0.cy);
          ctx.lineTo(pt1.cx, pt1.cy);
          ctx.stroke();
        }
      }

      // Current state point (latest sample)
      ctx.globalAlpha  = 1;
      var last = trail[trail.length - 1];
      var cp   = tr.toCanvas(last.T, last.x_gkg);
      var rad  = isOutlet ? 7 : 5;

      ctx.beginPath();
      ctx.arc(cp.cx, cp.cy, rad, 0, 2 * Math.PI);
      ctx.fillStyle   = clr;
      ctx.fill();
      ctx.strokeStyle = sdk.ui.color('bg-base');
      ctx.lineWidth   = 1.5;
      ctx.stroke();

      // Label
      ctx.fillStyle    = clr;
      ctx.font         = (isOutlet ? 'bold ' : '') + '10px "Segoe UI",system-ui,sans-serif';
      ctx.textAlign    = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(stream.label, cp.cx + rad + 2, cp.cy + 2);
    }

    /* ══════════════════════════════════════════════════════════════════════
     * I. SIDE PANEL — tiles + sparklines
     * ══════════════════════════════════════════════════════════════════════ */

    var PANEL_TILES = [
      { key: 'concentrateT',  label: 'Conc. Temp',      unit: '°C',  prec: 1 },
      { key: 'totalSolids',   label: 'Total Solids',    unit: '%',   prec: 1 },
      { key: 'sprayAngle',    label: 'Spray Angle',     unit: '°',   prec: 1 },
      { key: 'atomizerSpeed', label: 'Atomizer Speed',  unit: 'rpm', prec: 0 },
      { key: 'chamberDP',     label: 'Chamber ΔP',      unit: 'mbar',prec: 2 }
    ];

    /** Draw sparkline data into a small canvas. */
    function drawSparkline(sc, data) {
      var dpr = window.devicePixelRatio || 1;
      var W   = sc.clientWidth  || 200;
      var H   = sc.clientHeight || 32;
      sc.width  = Math.round(W * dpr);
      sc.height = Math.round(H * dpr);
      var ctx = sc.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      if (data.length < 2) { return; }
      var mn = data[0], mx = data[0];
      for (var i = 1; i < data.length; i++) {
        if (data[i] < mn) { mn = data[i]; }
        if (data[i] > mx) { mx = data[i]; }
      }
      var range = mx - mn || 1;
      ctx.beginPath();
      ctx.strokeStyle = sdk.ui.color('chart-1');
      ctx.lineWidth   = 1.5;
      for (var j = 0; j < data.length; j++) {
        var px = (j / (data.length - 1)) * W;
        var py = H - 2 - ((data[j] - mn) / range) * (H - 4);
        if (j === 0) { ctx.moveTo(px, py); } else { ctx.lineTo(px, py); }
      }
      ctx.stroke();
    }

    /** Refresh all tile values and sparklines. */
    function updateSidePanel() {
      PANEL_TILES.forEach(function (tile) {
        var info = tileEls[tile.key];
        if (!info) { return; }
        var v = liveValues[tile.key];
        info.valueEl.textContent = v !== null ? v.toFixed(tile.prec) : '—';
        var arr = sparkData[tile.key].toArray();
        if (arr.length > 1) { drawSparkline(info.sparkCanvas, arr); }
      });
    }

    /** Build side-panel DOM and append to rootWrap. */
    function buildSidePanel(rootWrap) {
      var panelEl = el('div', {
        style: {
          position:      'absolute',
          top:           '0',
          right:         '0',
          width:         SIDE_W + 'px',
          height:        '100%',
          background:    'var(--c-bg-card,#0f1629)',
          borderLeft:    '1px solid var(--c-border,#1e2d4a)',
          display:       'flex',
          flexDirection: 'column',
          padding:       '8px 6px',
          gap:           '6px',
          overflowY:     'auto',
          boxSizing:     'border-box',
          zIndex:        '5'
        }
      });

      panelEl.appendChild(el('div', {
        style: {
          fontSize:      '10px',
          fontWeight:    '600',
          color:         'var(--c-text-2,#8ea3c3)',
          letterSpacing: '0.06em',
          paddingBottom: '4px',
          borderBottom:  '1px solid var(--c-border,#1e2d4a)',
          textTransform: 'uppercase'
        }
      }, ['Process params']));

      PANEL_TILES.forEach(function (tile) {
        var valueEl = el('span', {
          style: {
            fontSize:   '20px',
            fontWeight: '700',
            color:      'var(--c-text-1,#e8ecf8)',
            lineHeight: '1'
          }
        }, ['—']);

        var unitEl = el('span', {
          style: {
            fontSize:   '11px',
            color:      'var(--c-text-3,#4f6282)',
            marginLeft: '3px'
          }
        }, [tile.unit]);

        var sparkCanvas = el('canvas', {
          style: { width: '100%', height: '32px', display: 'block', marginTop: '3px' }
        });

        panelEl.appendChild(el('div', {
          style: {
            background:   'var(--c-bg-raised,#131e35)',
            borderRadius: '6px',
            padding:      '7px 9px 5px'
          }
        }, [
          el('div', {
            style: {
              fontSize:      '10px',
              color:         'var(--c-text-3,#4f6282)',
              marginBottom:  '2px',
              textTransform: 'uppercase',
              letterSpacing: '0.04em'
            }
          }, [tile.label]),
          el('div', { style: { display: 'flex', alignItems: 'baseline' } }, [valueEl, unitEl]),
          sparkCanvas
        ]));

        tileEls[tile.key] = { valueEl: valueEl, sparkCanvas: sparkCanvas };
      });

      // Warning status card at the bottom of the panel
      var warnCard = el('div', {
        className: '__mh-mm-warn-card',
        style: {
          marginTop:    'auto',
          borderRadius: '6px',
          padding:      '8px 10px',
          background:   'var(--c-bg-raised,#131e35)',
          fontSize:     '12px',
          fontWeight:   '600',
          color:        'var(--c-good,#34d399)'
        }
      }, ['Status: OK']);

      panelEl.appendChild(warnCard);
      rootWrap.appendChild(panelEl);
    }

    /* ══════════════════════════════════════════════════════════════════════
     * J. EARLY WARNING — margin tracking, ETA, banner, toast, tag write
     * ══════════════════════════════════════════════════════════════════════ */

    /** Refresh the banner element and the side-panel warn card. */
    function updateBanner() {
      if (!bannerEl) { return; }
      var colorMap = {
        OK:    sdk.ui.color('good'),
        WARN:  sdk.ui.color('warn'),
        ALARM: sdk.ui.color('alarm')
      };
      var textMap = {
        OK:    'Sticky margin OK',
        WARN:  'WARN — Sticky zone in ~' + (warnETA !== null ? warnETA.toFixed(0) + ' min' : '?'),
        ALARM: 'ALARM — Outlet is inside sticky / lumping zone'
      };
      bannerEl.style.background = colorMap[warnState] || sdk.ui.color('info');
      bannerEl.textContent       = textMap[warnState]  || warnState;
      bannerEl.style.display     = warnState === 'OK' ? 'none' : 'block';

      var warnCard = document.querySelector('.__mh-mm-warn-card');
      if (warnCard) {
        warnCard.textContent    = textMap[warnState];
        warnCard.style.color    = colorMap[warnState];
      }
    }

    /**
     * Evaluate warning state from current margin history.
     * Called whenever outlet T, outlet RH, or total solids update.
     *
     * Algorithm:
     *  1. Compute current margin = T_outlet − T_sticky(RH_outlet, TS%)
     *  2. If margin < 0 → ALARM
     *  3. Else: linear regression over last-5-min margin history;
     *     if slope < 0 and projected crossing ≤ etaMinutes → WARN with ETA
     *  4. On state change: toast + tag write (non-spamming: one write per change)
     */
    function evaluateWarning() {
      var outletT  = liveValues.outletT;
      var outletRH = liveValues.outletRH;
      var ts_pct   = liveValues.totalSolids !== null
        ? liveValues.totalSolids
        : stickyP.tsRef;

      if (outletT === null || outletRH === null) { return; }

      var margin = stickyMargin(outletT, outletRH, ts_pct, stickyP);
      var now    = Date.now();
      marginHistory.push({ ts: now, margin: margin });

      var newState = 'OK';
      var newETA   = null;

      if (margin < 0) {
        newState = 'ALARM';
      } else {
        // Gather last 5 minutes
        var cutoff  = now - 5 * 60 * 1000;
        var history = marginHistory.toArray().filter(function (pt) {
          return pt.ts >= cutoff;
        });

        if (history.length >= 2) {
          // Linear regression: margin ~ slope*t_min + intercept
          var t0  = history[0].ts;
          var n   = history.length;
          var st  = 0, sm = 0, stt = 0, stm = 0;
          for (var i = 0; i < n; i++) {
            var ti  = (history[i].ts - t0) / 60000;
            var mi  = history[i].margin;
            st  += ti;
            sm  += mi;
            stt += ti * ti;
            stm += ti * mi;
          }
          var denom = n * stt - st * st;
          if (Math.abs(denom) > 1e-9) {
            var slope     = (n * stm - st * sm) / denom;
            var intercept = (sm - slope * st) / n;
            var tCurrent  = (now - t0) / 60000;
            var curFit    = intercept + slope * tCurrent;

            if (slope < 0 && curFit > 0) {
              var tCross  = -intercept / slope;
              var etaMins = tCross - tCurrent;
              if (etaMins > 0 && etaMins <= cfg.etaMinutes) {
                newState = 'WARN';
                newETA   = etaMins;
              }
            }
          }
        }
      }

      var stateChanged = (newState !== warnState);
      warnState = newState;
      warnETA   = newETA;
      updateBanner();

      if (stateChanged && !_warnWritePending) {
        _warnWritePending = true;
        var writeVal = warnState === 'ALARM' ? 2 : warnState === 'WARN' ? 1 : 0;

        sdk.data.write(cfg.warnTag, writeVal).then(function () {
          _warnWritePending = false;
          sdk.log('[mollier] warnTag written:', writeVal);
        }).catch(function (err) {
          _warnWritePending = false;
          // Non-fatal: toast once, don't spam
          sdk.ui.toast('Warning tag write failed: ' + String(err && err.message || err), 'warn');
          sdk.log('[mollier] warnTag write error:', err);
        });

        var toastKind = warnState === 'ALARM' ? 'alarm'
          : warnState === 'WARN'  ? 'warn'
          : 'good';
        var toastMsg = warnState === 'ALARM'
          ? 'ALARM: Outlet in sticky region'
          : warnState === 'WARN'
          ? 'WARN: Sticky zone ~' + (newETA ? newETA.toFixed(0) : '?') + ' min'
          : 'Recovered: Sticky margin OK';
        sdk.ui.toast(toastMsg, toastKind);
      }
    }

    /* ══════════════════════════════════════════════════════════════════════
     * K. SETTINGS POPOVER — sticky param editor
     * ══════════════════════════════════════════════════════════════════════ */

    function buildSettingsPopover() {
      var fields = [
        { key: 'T0',            label: 'T₀  (°C)',         step: '1',   min: '0',  max: '120' },
        { key: 'slopeRH',       label: 'Slope RH',         step: '0.1', min: '0',  max: '10'  },
        { key: 'tsShiftPerPct', label: 'TS shift / pct',   step: '0.1', min: '0',  max: '10'  },
        { key: 'tsRef',         label: 'TS reference (%)', step: '1',   min: '0',  max: '100' }
      ];
      var inputMap = {};

      var formRows = fields.map(function (f) {
        var inp = el('input', {
          type:  'number',
          step:  f.step,
          min:   f.min,
          max:   f.max,
          value: String(stickyP[f.key]),
          style: {
            width:        '70px',
            background:   'var(--c-bg-raised,#131e35)',
            color:        'var(--c-text-1,#e8ecf8)',
            border:       '1px solid var(--c-border,#1e2d4a)',
            borderRadius: '4px',
            padding:      '3px 5px',
            fontSize:     '12px'
          }
        });
        inputMap[f.key] = inp;

        return el('div', {
          style: {
            display:        'flex',
            justifyContent: 'space-between',
            alignItems:     'center',
            marginBottom:   '5px'
          }
        }, [
          el('label', {
            style: { fontSize: '11px', color: 'var(--c-text-2,#8ea3c3)', flex: '1' }
          }, [f.label]),
          inp
        ]);
      });

      var saveBtn = el('button', {
        style: {
          marginTop:    '8px',
          width:        '100%',
          padding:      '5px',
          background:   'var(--c-accent,#38bdf8)',
          color:        '#000',
          border:       'none',
          borderRadius: '4px',
          fontSize:     '12px',
          fontWeight:   '600',
          cursor:       'pointer'
        }
      }, ['Save & Apply']);

      var cancelBtn = el('button', {
        style: {
          width:        '100%',
          padding:      '4px',
          background:   'transparent',
          color:        'var(--c-text-2,#8ea3c3)',
          border:       '1px solid var(--c-border,#1e2d4a)',
          borderRadius: '4px',
          fontSize:     '11px',
          cursor:       'pointer',
          marginTop:    '3px'
        }
      }, ['Cancel']);

      var popover = el('div', {
        style: {
          display:      'none',
          position:     'absolute',
          top:          '40px',
          right:        (SIDE_W + 6) + 'px',
          zIndex:       '20',
          background:   'var(--c-bg-card,#0f1629)',
          border:       '1px solid var(--c-border-strong,#2a3f62)',
          borderRadius: '8px',
          padding:      '12px 14px',
          width:        '230px',
          boxShadow:    '0 4px 20px rgba(0,0,0,0.55)'
        }
      }, [
        el('div', {
          style: {
            fontSize:      '10px',
            fontWeight:    '600',
            color:         'var(--c-text-2,#8ea3c3)',
            marginBottom:  '8px',
            textTransform: 'uppercase',
            letterSpacing: '0.06em'
          }
        }, ['Sticky / Lumping Params']),
        el('div', {}, formRows),
        saveBtn,
        cancelBtn
      ]);

      saveBtn.addEventListener('click', function () {
        var newSp = {};
        fields.forEach(function (f) {
          var v = parseFloat(inputMap[f.key].value);
          newSp[f.key] = isNaN(v) ? stickyP[f.key] : v;
        });
        stickyP           = newSp;
        stickyRegionDirty = true;
        _REGION_CACHE     = null;
        staticDirty       = true;

        sdk.store.kv.put('mollier', 'sticky', newSp).then(function () {
          sdk.ui.toast('Sticky params saved', 'good');
          sdk.log('[mollier] sticky params saved:', newSp);
        }).catch(function (err) {
          sdk.ui.toast('Save failed: ' + String(err && err.message || err), 'warn');
        });

        popover.style.display = 'none';
      });

      cancelBtn.addEventListener('click', function () {
        popover.style.display = 'none';
      });

      return { popover: popover, inputMap: inputMap, fields: fields };
    }

    /* ══════════════════════════════════════════════════════════════════════
     * MAIN BUILD — inject CSS, construct DOM, subscribe tags, start rAF
     * ══════════════════════════════════════════════════════════════════════ */

    // ── Inject module CSS ─────────────────────────────────────────────────────
    var styleEl = document.createElement('style');
    styleEl.textContent = [
      '.__mh-mm-root{',
      '  position:absolute;inset:0;',
      '  background:var(--c-bg-base,#070b15);',
      '  color:var(--c-text-1,#e8ecf8);',
      '  font-family:"Segoe UI",system-ui,sans-serif;font-size:13px;',
      '  overflow:hidden;',
      '}',
      '.__mh-mm-toolbar{',
      '  position:absolute;top:0;left:0;',
      '  height:36px;display:flex;align-items:center;',
      '  gap:6px;padding:0 10px;z-index:10;',
      '}',
      '.__mh-mm-toolbar button{',
      '  padding:3px 10px;border-radius:5px;',
      '  border:1px solid var(--c-border,#1e2d4a);',
      '  background:var(--c-bg-raised,#131e35);',
      '  color:var(--c-text-1,#e8ecf8);',
      '  font-size:11px;cursor:pointer;',
      '}',
      '.__mh-mm-toolbar button:hover{background:var(--c-bg-card,#0f1629);}',
      '.__mh-mm-banner{',
      '  position:absolute;top:36px;left:0;',
      '  width:calc(100% - ' + SIDE_W + 'px);',
      '  padding:4px 12px;font-size:12px;font-weight:700;',
      '  text-align:center;z-index:8;color:#000;display:none;',
      '}',
      '.__mh-mm-canvas-wrap{',
      '  position:absolute;top:36px;left:0;',
      '  width:calc(100% - ' + SIDE_W + 'px);bottom:0;overflow:hidden;',
      '}',
      '.__mh-mm-canvas-wrap canvas{',
      '  position:absolute;inset:0;width:100%;height:100%;',
      '}'
    ].join('\n');
    document.head.appendChild(styleEl);

    // ── Build root wrapper ────────────────────────────────────────────────────
    var rootWrap = el('div', { className: '__mh-mm-root' });
    root.appendChild(rootWrap);

    // ── Toolbar ───────────────────────────────────────────────────────────────
    axisBtn = el('button', {}, ['Mollier']);
    axisBtn.addEventListener('click', function () {
      axisMode     = axisMode === 'psychrometric' ? 'mollier' : 'psychrometric';
      axisBtn.textContent = axisMode === 'psychrometric' ? 'Mollier' : 'Psychrometric';
      staticDirty  = true;
      rafDirty     = true;
    });

    gearBtn = el('button', {}, ['⚙ Sticky']);

    var titleEl = el('span', {
      style: {
        fontSize:    '13px',
        fontWeight:  '600',
        color:       'var(--c-text-2,#8ea3c3)',
        marginRight: '4px'
      }
    }, ['Mollier Monitor']);

    var modeLabel = el('span', {
      style: {
        fontSize:     '10px',
        padding:      '2px 7px',
        borderRadius: '4px',
        background:   isSim ? 'var(--c-warn,#fbbf24)' : 'var(--c-good,#34d399)',
        color:        '#000',
        fontWeight:   '700'
      }
    }, [isSim ? 'SIM' : 'LIVE']);

    var toolbar = el('div', { className: '__mh-mm-toolbar' }, [
      titleEl, modeLabel, axisBtn, gearBtn
    ]);
    rootWrap.appendChild(toolbar);

    // ── Banner ────────────────────────────────────────────────────────────────
    bannerEl = el('div', { className: '__mh-mm-banner' }, ['']);
    rootWrap.appendChild(bannerEl);

    // ── Canvas wrapper (chart only — side panel is separate) ──────────────────
    var canvasWrap = el('div', { className: '__mh-mm-canvas-wrap' });
    canvasStatic   = el('canvas', { style: { zIndex: '1' } });
    canvasLive     = el('canvas', { style: { zIndex: '2' } });
    canvasWrap.appendChild(canvasStatic);
    canvasWrap.appendChild(canvasLive);
    rootWrap.appendChild(canvasWrap);

    ctxStatic = canvasStatic.getContext('2d');
    ctxLive   = canvasLive.getContext('2d');

    // ── Side panel ────────────────────────────────────────────────────────────
    buildSidePanel(rootWrap);

    // ── Settings popover ──────────────────────────────────────────────────────
    var popoverInfo = buildSettingsPopover();
    settingsPopover = popoverInfo.popover;

    gearBtn.addEventListener('click', function () {
      // Sync inputs to current stickyP before showing
      popoverInfo.fields.forEach(function (f) {
        popoverInfo.inputMap[f.key].value = String(stickyP[f.key]);
      });
      settingsPopover.style.display =
        settingsPopover.style.display === 'none' ? 'block' : 'none';
    });
    rootWrap.appendChild(settingsPopover);

    // ── ResizeObserver ────────────────────────────────────────────────────────
    _mm.resizeObserver = new ResizeObserver(function () {
      staticDirty = true;
      rafDirty    = true;
    });
    _mm.resizeObserver.observe(rootWrap);

    // ── Load stored sticky params from kv ─────────────────────────────────────
    sdk.store.kv.get('mollier', 'sticky').then(function (stored) {
      if (stored && typeof stored === 'object') {
        stickyP           = stored;
        stickyRegionDirty = true;
        _REGION_CACHE     = null;
        staticDirty       = true;
        sdk.log('[mollier] restored sticky params:', stored);
      }
    }).catch(function (err) {
      sdk.log('[mollier] using default sticky params:', err);
    });

    // ── Tag update handler ────────────────────────────────────────────────────

    /**
     * Process one tag update: map through sim range if needed,
     * store in liveValues, update trail buffers, sparklines, warning.
     */
    function handleTagUpdate(tagKey, rawValue) {
      var v = isSim ? mapSim(tagKey, rawValue) : rawValue;
      liveValues[tagKey] = v;

      // Update psychrometric stream trails
      // A stream point requires BOTH T and RH; we push when either updates.
      // Compute x using the partner's most recent cached value.
      if (tagKey === 'inletT' || tagKey === 'inletRH') {
        var iT  = liveValues.inletT;
        var iRH = liveValues.inletRH;
        if (iT !== null && iRH !== null) {
          var ix = humidityRatio(iT, iRH, P);
          streams.inlet.T     = iT;
          streams.inlet.x_gkg = ix;
          streams.inlet.trail.push({ T: iT, x_gkg: ix });
        }
      }
      if (tagKey === 'outletT' || tagKey === 'outletRH') {
        var oT  = liveValues.outletT;
        var oRH = liveValues.outletRH;
        if (oT !== null && oRH !== null) {
          var ox = humidityRatio(oT, oRH, P);
          streams.outlet.T     = oT;
          streams.outlet.x_gkg = ox;
          streams.outlet.trail.push({ T: oT, x_gkg: ox });
        }
      }
      // Fluid bed and exhaust: we only have T from config, no paired RH tag.
      // Plot at a nominal RH of 5% (exhaust is nearly dry; fbed is low humidity).
      // This gives a sensible chart position for process monitoring.
      if (tagKey === 'fbedT') {
        var fT  = v;
        var fX  = humidityRatio(fT, 5, P);  // nominal ~5% RH for fluid bed
        streams.fbed.T     = fT;
        streams.fbed.x_gkg = fX;
        streams.fbed.trail.push({ T: fT, x_gkg: fX });
      }
      if (tagKey === 'exhaustT') {
        var eT  = v;
        var eX  = humidityRatio(eT, 8, P);  // nominal ~8% RH for exhaust
        streams.exhaust.T     = eT;
        streams.exhaust.x_gkg = eX;
        streams.exhaust.trail.push({ T: eT, x_gkg: eX });
      }

      // Side-panel sparklines
      if (sparkData[tagKey]) {
        sparkData[tagKey].push(v);
        updateSidePanel();
      }

      // Warning evaluation when outlet or TS updates
      if (tagKey === 'outletT' || tagKey === 'outletRH') {
        evaluateWarning();
      }
      if (tagKey === 'totalSolids') {
        // Throttle sticky region recalc to 5-second cadence
        if (!_mm.stickyThrottleTimer) {
          _mm.stickyThrottleTimer = setTimeout(function () {
            stickyRegionDirty      = true;
            _REGION_CACHE          = null;
            staticDirty            = true;
            _mm.stickyThrottleTimer = null;
          }, 5000);
        }
        evaluateWarning();
      }

      rafDirty = true;
    }

    // ── Subscribe all tags ────────────────────────────────────────────────────
    var tagMap = cfg.tags;
    Object.keys(tagMap).forEach(function (tagKey) {
      var tagName = tagMap[tagKey];
      var unsub   = sdk.data.subscribe(tagName, function (update) {
        handleTagUpdate(tagKey, update.value);
      });
      _mm.unsubs.push(unsub);
    });

    // ── rAF loop ──────────────────────────────────────────────────────────────
    _mm.rafHandle = requestAnimationFrame(function loop(now) {
      _mm.rafHandle = requestAnimationFrame(loop);

      // Static layer (redraw on resize / theme / mode / sticky change)
      if (staticDirty) {
        drawStatic();
      }

      // Live layer (throttled to RAF_MIN_INTERVAL)
      if (rafDirty) {
        var dt = now - _lastRafTime;
        if (dt < RAF_MIN_INTERVAL) { return; }
        _lastRafTime = now;
        rafDirty     = false;

        resizeCanvas(canvasLive);
        applyDpr(ctxLive);

        var r  = chartRect(canvasLive);
        var tr = makeTransform(canvasLive);

        ctxLive.clearRect(0, 0, canvasLive.clientWidth, canvasLive.clientHeight);

        ctxLive.save();
        ctxLive.beginPath();
        ctxLive.rect(r.x, r.y, r.w, r.h);
        ctxLive.clip();

        ctxLive.globalAlpha = 1;

        // Draw inlet, fbed, exhaust first, outlet on top
        var order = ['inlet', 'fbed', 'exhaust', 'outlet'];
        for (var oi = 0; oi < order.length; oi++) {
          drawStream(ctxLive, tr, streams[order[oi]], order[oi] === 'outlet');
        }

        ctxLive.restore();
      }
    });

    sdk.ui.toast('Mollier Monitor loaded', 'info');
    sdk.log('[mollier] create() complete — mode:', isSim ? 'simulation' : 'live');
  },

  /* ==========================================================================
   * L-destroy  destroy()
   * ======================================================================== */
  destroy: function () {
    'use strict';

    // Cancel animation frame
    if (_mm.rafHandle !== null) {
      cancelAnimationFrame(_mm.rafHandle);
      _mm.rafHandle = null;
    }

    // Unsubscribe all tag listeners
    var unsubs = _mm.unsubs;
    for (var i = 0; i < unsubs.length; i++) {
      if (typeof unsubs[i] === 'function') {
        try { unsubs[i](); } catch (_) {}
      }
    }
    _mm.unsubs = [];

    // Disconnect resize observer
    if (_mm.resizeObserver) {
      try { _mm.resizeObserver.disconnect(); } catch (_) {}
      _mm.resizeObserver = null;
    }

    // Clear sticky-throttle timer
    if (_mm.stickyThrottleTimer) {
      clearTimeout(_mm.stickyThrottleTimer);
      _mm.stickyThrottleTimer = null;
    }
  }
});
