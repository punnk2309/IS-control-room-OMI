/* ============================================================================
 * Theme: light — for bright control rooms / printed displays
 * ----------------------------------------------------------------------------
 * Same token set as theme.dark.config.js. Select via the widget's "Theme"
 * property in OMI, or `theme` in config/app.config.js.
 * ========================================================================== */
SFP.config.define('theme.light', {
  name: 'Light (Day Shift)',
  tokens: {
    'bg-base':    '#eef1f7',
    'bg-surface': '#ffffff',
    'bg-card':    '#ffffff',
    'bg-raised':  '#f1f4fa',
    'border':     '#d7deeb',
    'border-strong': '#b6c2d9',

    'text-1': '#16203a',
    'text-2': '#3d4a68',
    'text-3': '#76829e',

    'accent':        '#0284c7',
    'accent-strong': '#1d6ff2',
    'good':  '#059669',
    'warn':  '#d97706',
    'alarm': '#dc2626',
    'info':  '#2563eb',

    'state-running':     '#059669',
    'state-idle':        '#d97706',
    'state-maintenance': '#2563eb',
    'state-error':       '#dc2626',

    'band-high':   '#dc2626',
    'band-medium': '#d97706',
    'band-normal': '#059669',
    'band-low':    '#2563eb',

    'chart-1': '#0284c7',
    'chart-2': '#6366f1',
    'chart-3': '#d97706',
    'chart-4': '#059669',
    'chart-solar':   '#ea580c',
    'chart-battery': '#059669',
    'chart-grid':    '#2563eb',

    /* ── Digital twin canvas (factory map page) ──────────────────────────
     * Designed light palette (not an inversion): paper-like canvas,
     * darker saturated utility lines for print/projector readability. */
    'twin-canvas':         '#e7ebf4',
    'twin-grid':           '#d9dfec',
    'twin-grid-major':     '#cdd5e6',
    'twin-zone-fill':      '#f7f9fd',
    'twin-zone-border':    '#9fb0cc',
    'twin-zone-label':     '#26334f',
    'twin-subzone-fill':   '#eef2f9',
    'twin-subzone-border': '#b3c0d8',
    'twin-machine-fill':   '#ffffff',
    'twin-machine-border': '#8d9fc0',
    'twin-label':          '#16203a',
    'twin-label-dim':      '#5d6a88',
    'twin-select':         '#0284c7',
    'twin-hover':          '#0369a1',
    'twin-nodata':         '#a4aec4',

    /* Utility systems — darker than the dark theme's so they hold contrast
     * against the light canvas. */
    'util-electrical': '#b45309',
    'util-product':    '#0369a1',
    'util-steam':      '#dc2626',
    'util-air':        '#0d9488',
    'util-water':      '#2563eb',
    'util-condensate': '#9333ea',
    'util-gas':        '#ea580c',
  },
});
