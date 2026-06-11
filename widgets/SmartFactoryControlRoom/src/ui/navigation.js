/* ============================================================================
 * SFP.ui.nav — hash-based navigation
 * ----------------------------------------------------------------------------
 * Pages come from config/app.config.js. The current page lives in the URL
 * hash ('#/machines?zone=welding'), which gives deep-linking during
 * development and survives reloads; inside the OMI host the hash is private
 * to the widget iframe.
 *
 * Cross-widget navigation (e.g. factory map "View machines in zone") uses
 * nav.navigate(page, params); widgets read ctx.params when they render.
 * ========================================================================== */
(function (SFP) {
  'use strict';

  var state = { page: null, params: {} };

  function parseHash() {
    var hash = window.location.hash.replace(/^#\/?/, '');
    if (!hash) { return null; }
    var parts = hash.split('?');
    var params = {};
    (parts[1] || '').split('&').forEach(function (pair) {
      if (!pair) { return; }
      var kv = pair.split('=');
      params[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || '');
    });
    return { page: parts[0], params: params };
  }

  function buildHash(page, params) {
    var query = Object.keys(params || {}).map(function (key) {
      return encodeURIComponent(key) + '=' + encodeURIComponent(params[key]);
    }).join('&');
    return '#/' + page + (query ? '?' + query : '');
  }

  SFP.ui.nav = {
    init: function (defaultPage) {
      var self = this;
      var fromHash = parseHash();
      var pages = SFP.config.get('app').pages;
      var valid = fromHash && pages.some(function (p) { return p.id === fromHash.page; });

      window.addEventListener('hashchange', function () {
        var parsed = parseHash();
        if (!parsed || parsed.page === state.page &&
            JSON.stringify(parsed.params) === JSON.stringify(state.params)) { return; }
        self._apply(parsed.page, parsed.params);
      });

      this._apply(valid ? fromHash.page : defaultPage, valid ? fromHash.params : {});
    },

    current: function () { return { page: state.page, params: state.params }; },

    navigate: function (page, params) {
      var hash = buildHash(page, params);
      if (window.location.hash === hash) {
        this._apply(page, params || {});   // re-render same page (param reset)
      } else {
        window.location.hash = hash;       // hashchange handler applies it
        this._apply(page, params || {});
      }
    },

    _apply: function (page, params) {
      state.page = page;
      state.params = params || {};
      SFP.bus.emit('nav:changed', { page: state.page, params: state.params });
    },
  };
}(window.SFP));
