/* ============================================================================
 * SFP.dom — small DOM construction helpers used by all widgets
 * ========================================================================== */
(function (SFP) {
  'use strict';

  SFP.dom = {
    /**
     * el('div', { class: 'card', text: 'hi', onclick: fn }, [children...])
     * Children may be elements, strings, arrays or null (skipped).
     */
    el: function (tag, attrs, children) {
      var node = document.createElement(tag);
      Object.keys(attrs || {}).forEach(function (key) {
        var val = attrs[key];
        if (val === null || val === undefined) { return; }
        if (key === 'text') { node.textContent = val; }
        else if (key === 'html') { node.innerHTML = val; }
        else if (key === 'style' && typeof val === 'object') {
          Object.assign(node.style, val);
        }
        else if (key.indexOf('on') === 0 && typeof val === 'function') {
          node.addEventListener(key.slice(2), val);
        }
        else { node.setAttribute(key, val); }
      });
      SFP.dom.append(node, children);
      return node;
    },

    append: function (node, children) {
      (Array.isArray(children) ? children : [children]).forEach(function (child) {
        if (child === null || child === undefined || child === false) { return; }
        if (Array.isArray(child)) { SFP.dom.append(node, child); }
        else if (typeof child === 'string') { node.appendChild(document.createTextNode(child)); }
        else { node.appendChild(child); }
      });
      return node;
    },

    clear: function (node) {
      while (node.firstChild) { node.removeChild(node.firstChild); }
      return node;
    },

    /** Standard card chrome used by most dashboard widgets. Returns
     *  { root, body } — callers fill body. Header is optional. */
    card: function (opts) {
      var o = opts || {};
      var header = null;
      if (o.title) {
        header = SFP.dom.el('div', { class: 'card-header' }, [
          SFP.dom.el('div', {}, [
            SFP.dom.el('div', { class: 'card-title' }, [
              o.icon ? SFP.icons.el(o.icon, 14) : null,
              o.title,
            ]),
            o.subtitle ? SFP.dom.el('div', { class: 'card-subtitle', text: o.subtitle }) : null,
          ]),
          SFP.dom.el('div', { class: 'card-actions' }),
        ]);
      }
      var body = SFP.dom.el('div', { class: 'card-body' });
      var root = SFP.dom.el('div', { class: 'card' }, [header, body]);
      return {
        root: root,
        body: body,
        actions: header ? header.querySelector('.card-actions') : null,
        setSubtitle: function (text) {
          var sub = root.querySelector('.card-subtitle');
          if (sub) { sub.textContent = text; }
        },
      };
    },
  };
}(window.SFP));
