/* ============================================================================
 * SFP.twin.store — UI state for the factory twin page
 * ----------------------------------------------------------------------------
 * Holds everything about HOW the user is looking at the twin (camera,
 * selection, active floors, filters…) — never the data values themselves
 * (those live in the DataHub).
 *
 * The state object lives at module level, so it survives page navigation and
 * theme switches (the app shell rebuilds the page on both): coming back to
 * the Factory Map restores your exact viewport, selection and filters.
 * The data-source mode is NOT stored here — it is global app state
 * (SFP.runtime.mode + DataHub) shared with every dashboard.
 *
 * Usage:
 *   var unsub = SFP.twin.store.on(function (changedKeys) { ... });
 *   SFP.twin.store.set({ selection: { kind: 'element', id: 'M-029' } });
 *   SFP.twin.store.get().selection
 * ========================================================================== */
(function (SFP) {
  'use strict';

  SFP.twin = SFP.twin || {};

  var state = {
    camera: null,           // { cx, cy, zoom } — null until first fit-to-view
    selection: null,        // { kind: 'element'|'connection', id }
    hover: null,            // same shape as selection, transient
    activeFloors: {},       // elementId (zone or subzone) -> active floorId
    filters: {},            // utilityId -> false to filter out (absent = on)
    filterMode: null,       // 'dim' | 'hide' (null = twin.config default)
    panelOpen: false,       // detail side panel visible
    minimapVisible: true,
    legendVisible: true,
    filterPanelOpen: false,
    searchQuery: '',
  };

  var listeners = [];

  SFP.twin.store = {
    /** The live state object (read-only by convention — mutate via set()). */
    get: function () { return state; },

    /** Shallow-merge a patch and notify listeners with the changed keys. */
    set: function (patch) {
      var changed = [];
      Object.keys(patch).forEach(function (key) {
        if (state[key] !== patch[key]) {
          state[key] = patch[key];
          changed.push(key);
        }
      });
      if (!changed.length) { return; }
      listeners.slice().forEach(function (fn) {
        try { fn(changed); } catch (err) { console.error('[SFP.twin.store]', err); }
      });
    },

    /** Subscribe to changes. Returns an unsubscribe function. */
    on: function (fn) {
      listeners.push(fn);
      return function () {
        var i = listeners.indexOf(fn);
        if (i >= 0) { listeners.splice(i, 1); }
      };
    },

    /* ── Convenience helpers used across twin modules ──────────────────── */

    /** Active floor for a zone/subzone, falling back to its first floor. */
    activeFloor: function (element) {
      if (!element.floors) { return null; }
      return state.activeFloors[element.id] || element.floors[0].id;
    },

    setActiveFloor: function (elementId, floorId) {
      /* activeFloors is replaced (not mutated) so set() sees the change. */
      var next = {};
      Object.keys(state.activeFloors).forEach(function (k) { next[k] = state.activeFloors[k]; });
      next[elementId] = floorId;
      this.set({ activeFloors: next });
    },

    /** Is a utility layer currently enabled? (absent = enabled) */
    utilityOn: function (utilityId) {
      return state.filters[utilityId] !== false;
    },

    toggleUtility: function (utilityId) {
      var next = {};
      Object.keys(state.filters).forEach(function (k) { next[k] = state.filters[k]; });
      next[utilityId] = !this.utilityOn(utilityId);
      this.set({ filters: next });
    },

    select: function (kind, id) {
      this.set({ selection: id ? { kind: kind, id: id } : null,
                 panelOpen: !!id });
    },
  };
}(window.SFP));
