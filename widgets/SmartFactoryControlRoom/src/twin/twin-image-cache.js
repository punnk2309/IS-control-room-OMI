/* ============================================================================
 * SFP.twin.imageCache — async image loader for factory-map element images
 * ----------------------------------------------------------------------------
 * Maintains a keyed cache of HTMLImageElement objects so that each unique
 * src (data URI or URL) is loaded only once.  The renderer calls
 * imageCache.get(src) every frame; the first call kicks off loading and
 * returns null until the image is ready.  On load the cache calls
 * requestRender() so the next frame picks up the finished image.
 *
 * Broken images are stored as the sentinel `false` so the renderer can fall
 * back to plain rect drawing without re-attempting the load each frame.
 *
 * Usage (inside the renderer):
 *   var img = SFP.twin.imageCache.get(src, renderer.requestRender.bind(renderer));
 *   if (img) { ctx.drawImage(img, ...); } else { /* draw rect fallback *\/ }
 *
 * No external dependencies; plain IIFE/namespace pattern.
 * ========================================================================== */
(function (SFP) {
  'use strict';

  SFP.twin = SFP.twin || {};

  /* Internal cache map: src string -> HTMLImageElement | false | 'loading' */
  var _cache = {};

  var imageCache = {

    /**
     * get(src, onReady)
     * Returns the cached HTMLImageElement if loaded, null if still loading or
     * not yet started, or false if the load failed (broken image).
     *
     * @param {string}   src      data URI or URL
     * @param {Function} onReady  called (with no args) when image load completes
     *                            (success or failure) — use to trigger a re-render
     * @returns {HTMLImageElement|null|false}
     */
    get: function (src, onReady) {
      if (!src) { return null; }
      var entry = _cache[src];

      if (entry === undefined) {
        /* First request — kick off load. */
        _cache[src] = 'loading';
        var img = new Image();
        img.onload = function () {
          _cache[src] = img;
          if (typeof onReady === 'function') { onReady(); }
        };
        img.onerror = function () {
          _cache[src] = false;
          console.warn('[SFP.twin.imageCache] Failed to load image (src truncated to 80 chars): ' +
            src.substring(0, 80));
          if (typeof onReady === 'function') { onReady(); }
        };
        img.src = src;
        return null;
      }

      if (entry === 'loading') { return null; }
      return entry;        /* HTMLImageElement or false */
    },

    /**
     * evict(src)
     * Remove a single entry from the cache (e.g. after image removal in the
     * editor).  Pass null/undefined to clear the entire cache.
     */
    evict: function (src) {
      if (src == null) {
        _cache = {};
      } else {
        delete _cache[src];
      }
    },

    /**
     * drawImage(ctx, src, r, fit, onReady)
     * Convenience: draw image into rect r using the requested fit mode, clipped
     * to r.  Returns true when the image was drawn, false when unavailable (the
     * caller should draw its fallback rect).
     *
     * fit: 'stretch' (default) | 'contain' | 'cover'
     *
     * @param {CanvasRenderingContext2D} ctx
     * @param {string}   src
     * @param {{x,y,w,h}} r
     * @param {string}   fit
     * @param {Function} onReady
     * @returns {boolean}
     */
    drawImage: function (ctx, src, r, fit, onReady) {
      var img = this.get(src, onReady);
      if (!img) { return false; }

      ctx.save();
      /* Clip to the element rect so the image never bleeds outside. */
      ctx.beginPath();
      ctx.rect(r.x, r.y, r.w, r.h);
      ctx.clip();

      var iw = img.naturalWidth  || img.width  || 1;
      var ih = img.naturalHeight || img.height || 1;
      var dx = r.x, dy = r.y, dw = r.w, dh = r.h;

      if (fit === 'contain' || fit === 'cover') {
        var scale;
        if (fit === 'contain') {
          scale = Math.min(r.w / iw, r.h / ih);
        } else {
          /* cover */
          scale = Math.max(r.w / iw, r.h / ih);
        }
        dw = iw * scale;
        dh = ih * scale;
        dx = r.x + (r.w - dw) / 2;
        dy = r.y + (r.h - dh) / 2;
      }
      /* 'stretch' just fills the whole rect — dx/dy/dw/dh already set. */

      ctx.drawImage(img, dx, dy, dw, dh);
      ctx.restore();
      return true;
    },
  };

  SFP.twin.imageCache = imageCache;

}(window.SFP));
