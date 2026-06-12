/* ============================================================================
 * ModuleHub SDK UI — widgets/ModuleHub/src/sdk/sdk-ui.js
 * ----------------------------------------------------------------------------
 * MODULE-SIDE. Attaches builder MH._build.ui(bridge) → sdk.ui per §6.
 *
 * Exports:
 *   color(token)                   — theme token → CSS color string
 *   el(tag, attrs, children)       — tiny DOM helper
 *   makeDraggable(el, opts)        — pointer-event drag helper
 *   toast(msg, kind)               — fixed bottom toast (auto-dismiss 3 s)
 *
 * Toast CSS is injected once into the iframe <head>; no external stylesheets.
 *
 * Contract: modulehub-contracts.md §6
 * ========================================================================== */
(function () {
  'use strict';

  if (!window.MH || !window.MH._build) {
    throw new Error('[MH] sdk-ui.js loaded before sdk-bootstrap.js');
  }

  MH._build.ui = function buildUi(/* bridge */) {

    /* ── Toast CSS injection (once) ─────────────────────────────────────── */
    var _toastCssInjected = false;
    function ensureToastCss() {
      if (_toastCssInjected) { return; }
      _toastCssInjected = true;
      var style = document.createElement('style');
      style.textContent = [
        '.__mh-toast-wrap{',
        '  position:fixed;bottom:16px;left:50%;transform:translateX(-50%);',
        '  z-index:99999;display:flex;flex-direction:column;gap:6px;',
        '  align-items:center;pointer-events:none;',
        '}',
        '.__mh-toast{',
        '  padding:8px 18px;border-radius:6px;font-size:13px;font-family:inherit;',
        '  color:#fff;opacity:1;transition:opacity 0.4s;white-space:nowrap;',
        '  pointer-events:none;box-shadow:0 2px 8px rgba(0,0,0,0.35);',
        '}',
        '.__mh-toast.fade{opacity:0;}',
      ].join('');
      document.head.appendChild(style);
    }

    var _toastWrap = null;
    function getToastWrap() {
      if (_toastWrap && _toastWrap.parentNode) { return _toastWrap; }
      ensureToastCss();
      _toastWrap = document.createElement('div');
      _toastWrap.className = '__mh-toast-wrap';
      document.body.appendChild(_toastWrap);
      return _toastWrap;
    }

    /* ── color(token) ───────────────────────────────────────────────────── */

    /**
     * Resolve a theme token to a CSS color string.
     * Passthrough for strings starting with '#' or 'rgb'.
     * Reads --c-<token> from documentElement; returns '#888888' on miss.
     */
    function color(token) {
      if (typeof token === 'string' &&
          (token.charAt(0) === '#' || token.indexOf('rgb') === 0)) {
        return token;
      }
      var val = getComputedStyle(document.documentElement)
                  .getPropertyValue('--c-' + token).trim();
      return val || '#888888';
    }

    /* ── el(tag, attrs, children) ───────────────────────────────────────── */

    /**
     * Create a DOM element.
     *
     * attrs keys:
     *   className  → el.className
     *   style      → object merged into el.style
     *   onXxx      → addEventListener('xxx', fn)
     *   anything else → setAttribute
     *
     * children: string | Node | Array<string|Node|null> — null entries skipped.
     */
    function el(tag, attrs, children) {
      var node = document.createElement(tag);

      if (attrs) {
        Object.keys(attrs).forEach(function (k) {
          var v = attrs[k];
          if (v === null || v === undefined) { return; }
          if (k === 'className') {
            node.className = v;
          } else if (k === 'style' && typeof v === 'object') {
            Object.keys(v).forEach(function (prop) {
              node.style[prop] = v[prop];
            });
          } else if (k.length > 2 && k.slice(0, 2) === 'on' &&
                     k.charAt(2) === k.charAt(2).toUpperCase()) {
            var evtName = k.charAt(2).toLowerCase() + k.slice(3);
            node.addEventListener(evtName, v);
          } else {
            node.setAttribute(k, v);
          }
        });
      }

      if (children !== null && children !== undefined) {
        appendChildren(node, children);
      }

      return node;
    }

    function appendChildren(parent, children) {
      if (Array.isArray(children)) {
        children.forEach(function (c) { appendChildren(parent, c); });
      } else if (children === null || children === undefined) {
        /* skip */
      } else if (typeof children === 'string' || typeof children === 'number') {
        parent.appendChild(document.createTextNode(String(children)));
      } else if (children instanceof Node) {
        parent.appendChild(children);
      }
    }

    /* ── makeDraggable(el, opts) ────────────────────────────────────────── */

    /**
     * Attach pointer-event drag behaviour to an element.
     *
     * opts:
     *   handle    {Element}  optional — only drag when pointer-down on handle
     *   onStart   {fn()}     called on drag start
     *   onMove    {fn(dx, dy, ev)}  called each pointer-move
     *   onDrop    {fn(ev)}   called on pointer-up
     */
    function makeDraggable(element, opts) {
      opts = opts || {};
      var startX = 0, startY = 0;
      var dragging = false;

      var handle = opts.handle || element;

      handle.addEventListener('pointerdown', function (e) {
        dragging = true;
        startX = e.clientX;
        startY = e.clientY;
        handle.setPointerCapture(e.pointerId);
        if (typeof opts.onStart === 'function') {
          try { opts.onStart(); } catch (_) {}
        }
        e.preventDefault();
      });

      handle.addEventListener('pointermove', function (e) {
        if (!dragging) { return; }
        var dx = e.clientX - startX;
        var dy = e.clientY - startY;
        startX = e.clientX;
        startY = e.clientY;
        if (typeof opts.onMove === 'function') {
          try { opts.onMove(dx, dy, e); } catch (_) {}
        }
      });

      function endDrag(e) {
        if (!dragging) { return; }
        dragging = false;
        if (typeof opts.onDrop === 'function') {
          try { opts.onDrop(e); } catch (_) {}
        }
      }

      handle.addEventListener('pointerup',     endDrag);
      handle.addEventListener('pointercancel', endDrag);
    }

    /* ── toast(msg, kind) ───────────────────────────────────────────────── */

    /** Kind → CSS background color (reads from theme if possible). */
    var KIND_TOKENS = {
      info:  'info',
      good:  'good',
      warn:  'warn',
      alarm: 'alarm',
    };
    var KIND_FALLBACKS = {
      info:  '#2196f3',
      good:  '#43a047',
      warn:  '#fb8c00',
      alarm: '#e53935',
    };

    /**
     * Show a fixed-position toast at the bottom of the iframe.
     * Auto-dismisses after 3 s.
     *
     * @param {string} msg
     * @param {'info'|'good'|'warn'|'alarm'} kind
     */
    function toast(msg, kind) {
      kind = KIND_TOKENS[kind] ? kind : 'info';
      var wrap = getToastWrap();

      var bg = color(KIND_TOKENS[kind]) || KIND_FALLBACKS[kind];

      var div = document.createElement('div');
      div.className = '__mh-toast';
      div.style.background = bg;
      div.textContent = String(msg);
      wrap.appendChild(div);

      /* Auto-dismiss */
      setTimeout(function () {
        div.classList.add('fade');
        setTimeout(function () {
          if (div.parentNode) { div.parentNode.removeChild(div); }
        }, 450);
      }, 3000);
    }

    return {
      color:        color,
      el:           el,
      makeDraggable: makeDraggable,
      toast:        toast,
    };
  };

}());
