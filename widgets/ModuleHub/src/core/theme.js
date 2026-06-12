/* ============================================================================
 * ModuleHub — theme engine (MHB.theme)
 * ----------------------------------------------------------------------------
 * Dark + light token maps using the same token names as SmartFactoryControlRoom
 * (config/theme.dark.config.js / theme.light.config.js).
 *
 * Public API:
 *   MHB.theme.apply(id)           — apply 'dark' or 'light'; writes --c-* CSS vars
 *   MHB.theme.currentId()         — returns current theme id
 *   MHB.theme.color(token)        — token → CSS color string (#hex / rgb)
 *   MHB.theme.tokens()            — returns the active token map object (plain obj)
 *
 * Contract: modulehub-contracts.md §2
 * ========================================================================== */
(function (MHB) {
  'use strict';

  var DARK_TOKENS = {
    /* Surfaces */
    'bg-base':    '#070b15',
    'bg-surface': '#0b101d',
    'bg-card':    '#0e1424',
    'bg-raised':  '#1a2236',
    'border':        '#1f2a44',
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

    /* Machine states */
    'state-running':     '#34d399',
    'state-idle':        '#fbbf24',
    'state-maintenance': '#60a5fa',
    'state-error':       '#f87171',

    /* Zone energy bands */
    'band-high':   '#f87171',
    'band-medium': '#fbbf24',
    'band-normal': '#34d399',
    'band-low':    '#60a5fa',

    /* Chart series palette */
    'chart-1': '#38bdf8',
    'chart-2': '#818cf8',
    'chart-3': '#fbbf24',
    'chart-4': '#34d399',
  };

  var LIGHT_TOKENS = {
    /* Surfaces */
    'bg-base':    '#eef1f7',
    'bg-surface': '#ffffff',
    'bg-card':    '#ffffff',
    'bg-raised':  '#f1f4fa',
    'border':        '#d7deeb',
    'border-strong': '#b6c2d9',

    /* Text */
    'text-1': '#16203a',
    'text-2': '#3d4a68',
    'text-3': '#76829e',

    /* Brand + semantics */
    'accent':        '#0284c7',
    'accent-strong': '#1d6ff2',
    'good':  '#059669',
    'warn':  '#d97706',
    'alarm': '#dc2626',
    'info':  '#2563eb',

    /* Machine states */
    'state-running':     '#059669',
    'state-idle':        '#d97706',
    'state-maintenance': '#2563eb',
    'state-error':       '#dc2626',

    /* Zone energy bands */
    'band-high':   '#dc2626',
    'band-medium': '#d97706',
    'band-normal': '#059669',
    'band-low':    '#2563eb',

    /* Chart series palette */
    'chart-1': '#0284c7',
    'chart-2': '#6366f1',
    'chart-3': '#d97706',
    'chart-4': '#059669',
  };

  var THEME_MAPS = {
    dark:  DARK_TOKENS,
    light: LIGHT_TOKENS,
  };

  var _currentId = null;
  var _currentTokens = null;

  MHB.theme = {
    /** Apply a theme by id ('dark' or 'light'). Writes --c-* on <html>.
     *  Falls back to 'dark' if id is unknown. */
    apply: function (id) {
      var tokens = THEME_MAPS[id] || THEME_MAPS['dark'];
      var safeId = THEME_MAPS[id] ? id : 'dark';
      var rootStyle = document.documentElement.style;
      Object.keys(tokens).forEach(function (token) {
        rootStyle.setProperty('--c-' + token, tokens[token]);
      });
      document.documentElement.setAttribute('data-theme', safeId);
      _currentId = safeId;
      _currentTokens = tokens;
      MHB.bus.emit('theme:changed', { themeId: safeId, tokens: tokens });
    },

    /** Returns the current theme id string, or null before first apply(). */
    currentId: function () {
      return _currentId;
    },

    /** Returns the active token map object (a plain { 'token-name': '#hex', ... }). */
    tokens: function () {
      return _currentTokens || DARK_TOKENS;
    },

    /** Resolve a color token to its value.
     *  Literal #hex or rgb(...) pass through; else reads the CSS var;
     *  returns '#888888' on miss. Mirrors SFP.ui.theme.color(). */
    color: function (token) {
      if (!token) { return '#888888'; }
      if (token[0] === '#' || token.indexOf('rgb') === 0) { return token; }
      var value = getComputedStyle(document.documentElement)
        .getPropertyValue('--c-' + token).trim();
      return value || '#888888';
    },
  };
}(window.MHB));
