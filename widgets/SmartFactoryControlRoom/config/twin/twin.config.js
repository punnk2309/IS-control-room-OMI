/* ============================================================================
 * Digital twin — engine settings (config/twin/twin.config.js)
 * ----------------------------------------------------------------------------
 * Behaviour knobs for the factory twin canvas (Factory Map page). Geometry
 * lives in twin.layout.config.js; flows live in twin.connections.config.js.
 * Everything here is tunable without touching src/twin/*.
 *
 * Coordinate model: the world is an abstract top-down plan in "world units"
 * (think ~10 cm per unit). zoom = screen pixels per world unit, so zoom 2
 * means one world unit is two pixels wide on screen.
 * ========================================================================== */
SFP.config.define('twin', {

  camera: {
    minZoom: 0.25,            // furthest out (whole site, small)
    maxZoom: 12,              // closest in (single machine fills the view)
    zoomStep: 1.18,           // wheel/button zoom multiplier per notch
    fitPadding: 48,           // screen px margin used by zoom-to-fit
    flyMs: 420,               // animated navigation duration
    bounded: true,            // false = infinite canvas (no pan clamping)
    boundsSlack: 600,         // world units the camera may overscroll bounds
  },

  /* ── Progressive disclosure ────────────────────────────────────────────
   * Each entry is the zoom at which that level of detail starts fading in.
   * fadeBand is the zoom span over which elements ramp 0 -> 1 opacity, so
   * LOD transitions are smooth rather than popping.
   *
   *   LOD 0  zoom <  subzone   factory overview: zones + aggregated flows
   *   LOD 1  zoom >= subzone   subzone outlines, zone-level connections
   *   LOD 2  zoom >= machine   machines, machine-to-machine connections
   *   LOD 3  zoom >= detail    value badges, connection annotations
   * ──────────────────────────────────────────────────────────────────────── */
  lod: {
    subzone: 1.0,
    machine: 2.0,
    detail: 3.5,
    fadeBand: 0.35,
    /* Labels gate separately so text never clutters a zoomed-out view. */
    zoneLabelMax: 1e9,        // zone labels always visible
    subzoneLabelMin: 1.3,
    machineLabelMin: 2.4,
  },

  grid: {
    show: true,
    minor: 40,                // world units between minor grid lines
    major: 200,               // world units between major grid lines
    minZoom: 0.5,             // hide the grid entirely below this zoom
  },

  connections: {
    widthMinPx: 1.6,          // line width at flowRange minimum (screen px)
    widthMaxPx: 9,            // line width at flowRange maximum
    /* Width gets a gentle zoom boost so lines are never paper-thin when
     * zoomed out: width *= zoomBoostBase + zoomBoostGain * clamp(zoom,0..1) */
    zoomBoostBase: 0.8,
    zoomBoostGain: 0.5,
    stubWorld: 26,            // world units a route runs straight out of an anchor
    slotSpread: 0.6,          // fraction of a face shared anchors spread across
    staggerWorld: 14,         // parallel-run separation per slot index
    cornerRadius: 10,         // rounded elbow radius (world units)
    dashSpeed: 26,            // dash-march px/s at 100% relative flow
    inactiveBelow: 0.04,      // |value| under this fraction of range = inactive
    labelMinZoom: 1.1,        // connection value labels appear from this zoom
    labelMinLengthPx: 90,     // ...and only on runs at least this long on screen
    hitTolerancePx: 7,        // hover/click distance for connection picking
  },

  /* ── Utility systems (the filterable connection layers) ────────────────
   * `color` is a theme token — both themes define it, so filtering UI,
   * legend and lines stay readable in light and dark mode.
   * Add a system here + tokens in the two theme files; nothing else. */
  utilities: [
    { id: 'electrical', label: 'Electrical',     color: 'util-electrical' },
    { id: 'product',    label: 'Product Flow',   color: 'util-product' },
    { id: 'steam',      label: 'Steam / Heat',   color: 'util-steam' },
    { id: 'air',        label: 'Compressed Air', color: 'util-air' },
    { id: 'water',      label: 'Water / Coolant',color: 'util-water' },
    { id: 'condensate', label: 'Condensate',     color: 'util-condensate' },
    { id: 'gas',        label: 'Gas',            color: 'util-gas' },
  ],

  filters: {
    defaultMode: 'dim',       // filtered-out utilities: 'dim' (ghosted) | 'hide'
    dimAlpha: 0.12,
  },

  /* Machine auto-layout used when a machine omits `rect` in the layout
   * config: machines flow into a grid inside their subzone. */
  autoLayout: {
    machineW: 64, machineH: 40, gap: 14, padding: 16, labelSpace: 26,
  },

  minimap: { width: 200, height: 130 },

  /* Zone status tint: which state group colors a zone from its
   * statusBinding value (see config/states.config.js). */
  zoneStatus: { stateGroup: 'zone-energy', fillAlpha: 0.10 },
});
