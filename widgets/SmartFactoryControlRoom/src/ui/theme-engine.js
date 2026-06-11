/* ============================================================================
 * SFP.ui.theme — theme engine
 * ----------------------------------------------------------------------------
 * Themes are token maps in config (config/theme.*.config.js). Applying a
 * theme writes every token as a CSS custom property --c-<token> on <html>;
 * the stylesheets reference only those variables, so a complete restyle is a
 * config change. Charts resolve their colors through theme.color() so they
 * follow the active theme too.
 * ========================================================================== */
(function (SFP) {
  'use strict';

  var current = null;

  SFP.ui.theme = {
    /** Theme ids available in config, e.g. ['dark', 'light']. */
    list: function () {
      return SFP.config.ids('theme.').map(function (id) { return id.slice(6); });
    },

    currentId: function () { return current; },

    apply: function (themeId) {
      var cfg = SFP.config.get('theme.' + themeId, true) ||
                SFP.config.get('theme.dark');
      var rootStyle = document.documentElement.style;
      Object.keys(cfg.tokens).forEach(function (token) {
        rootStyle.setProperty('--c-' + token, cfg.tokens[token]);
      });
      document.documentElement.setAttribute('data-theme', themeId);
      current = themeId;
      this._applyChartDefaults();
      SFP.bus.emit('theme:changed', { themeId: themeId });
    },

    /** Resolve a color token ('accent', 'state-running') to its value.
     *  Literal colors (#hex / rgb(...)) pass through unchanged, so config may
     *  use either tokens or raw colors. */
    color: function (token) {
      if (!token) { return '#888888'; }
      if (token[0] === '#' || token.indexOf('rgb') === 0) { return token; }
      var value = getComputedStyle(document.documentElement)
        .getPropertyValue('--c-' + token).trim();
      return value || '#888888';
    },

    /** Hex -> rgba string for chart fills. */
    alpha: function (token, a) {
      var hex = this.color(token);
      var m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
      if (!m) { return hex; }
      return 'rgba(' + parseInt(m[1], 16) + ',' + parseInt(m[2], 16) + ',' +
        parseInt(m[3], 16) + ',' + a + ')';
    },

    _applyChartDefaults: function () {
      if (typeof Chart === 'undefined') { return; }
      Chart.defaults.color = this.color('text-3');
      Chart.defaults.borderColor = this.color('border');
      Chart.defaults.font.family = "'Segoe UI', system-ui, sans-serif";
      Chart.defaults.font.size = 10;
    },

    /** Shared Chart.js plugin/scale options so every chart matches. */
    chartBase: function (opts) {
      var o = opts || {};
      var base = {
        animation: false,
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: this.color('bg-raised'),
            borderColor: this.color('border'),
            borderWidth: 1,
            titleColor: this.color('text-1'),
            bodyColor: this.color('text-2'),
            padding: 8,
          },
        },
      };
      if (!o.noScales) {
        base.scales = {
          x: {
            grid: { color: this.alpha('border', 0.5) },
            ticks: { color: this.color('text-3'), maxTicksLimit: o.maxXTicks || 10 },
            border: { display: false },
          },
          y: {
            grid: { color: this.alpha('border', 0.5) },
            ticks: { color: this.color('text-3') },
            border: { display: false },
            beginAtZero: !!o.beginAtZero,
            title: o.yLabel
              ? { display: true, text: o.yLabel, color: this.color('text-3'), font: { size: 10 } }
              : undefined,
          },
        };
      }
      return base;
    },
  };
}(window.SFP));
