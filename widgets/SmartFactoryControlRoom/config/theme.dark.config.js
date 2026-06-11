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
  },
});
