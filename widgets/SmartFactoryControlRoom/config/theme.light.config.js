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
  },
});
