/* ============================================================================
 * Theme: dark (control room default)
 * ----------------------------------------------------------------------------
 * Every token becomes the CSS variable --c-<token>. Stylesheets and widgets
 * reference tokens only, so restyling the platform = editing this file.
 * Add a new theme by copying this file as theme.<id>.config.js and adding a
 * <script> tag for it in index.html.
 * ========================================================================== */
SFP.config.define('theme.dark', {
  name: 'Dark (Control Room)',
  tokens: {
    /* Surfaces */
    'bg-base':    '#070b15',
    'bg-surface': '#0b101d',
    'bg-card':    '#0e1424',
    'bg-raised':  '#1a2236',
    'border':     '#1f2a44',
    'border-strong': '#33425f',

    /* Text */
    'text-1': '#e8ecf8',
    'text-2': '#a9b4d0',
    'text-3': '#6e7a99',

    /* Brand + semantics */
    'accent':        '#38bdf8',
    'accent-strong': '#1d6ff2',
    'good':  '#34d399',
    'warn':  '#fbbf24',
    'alarm': '#f87171',
    'info':  '#60a5fa',

    /* Machine states (referenced by states.config.js) */
    'state-running':     '#34d399',
    'state-idle':        '#fbbf24',
    'state-maintenance': '#60a5fa',
    'state-error':       '#f87171',

    /* Zone energy bands (factory map) */
    'band-high':   '#f87171',
    'band-medium': '#fbbf24',
    'band-normal': '#34d399',
    'band-low':    '#60a5fa',

    /* Chart series palette */
    'chart-1': '#38bdf8',
    'chart-2': '#818cf8',
    'chart-3': '#fbbf24',
    'chart-4': '#34d399',
    'chart-solar':   '#fb923c',
    'chart-battery': '#34d399',
    'chart-grid':    '#60a5fa',

    /* ── Digital twin canvas (factory map page) ──────────────────────────
     * The twin renderer reads ONLY these tokens — never literal colors —
     * so light/dark both restyle the whole canvas from here. */
    'twin-canvas':         '#060a12',
    'twin-grid':           '#101829',
    'twin-grid-major':     '#16203a',
    'twin-zone-fill':      '#0d1526',
    'twin-zone-border':    '#2c3a58',
    'twin-zone-label':     '#cdd6ee',
    'twin-subzone-fill':   '#121c31',
    'twin-subzone-border': '#33425f',
    'twin-machine-fill':   '#1a2540',
    'twin-machine-border': '#46587e',
    'twin-label':          '#e8ecf8',
    'twin-label-dim':      '#8d99b8',
    'twin-select':         '#38bdf8',
    'twin-hover':          '#7dd3fc',
    'twin-nodata':         '#4b5670',

    /* Utility systems (connection colors + filter legend). Adding a new
     * utility = a token here (and in theme.light) + an entry in
     * config/twin/twin.config.js — no render code changes. */
    'util-electrical': '#fbbf24',
    'util-product':    '#38bdf8',
    'util-steam':      '#f87171',
    'util-air':        '#5eead4',
    'util-water':      '#60a5fa',
    'util-condensate': '#c084fc',
    'util-gas':        '#fb923c',
  },
});
