/* ============================================================================
 * Dashboard: Modules — embedded ModuleHub modules via module-host widget
 * ----------------------------------------------------------------------------
 * 12-column grid. These entries load from the self-contained module-bundles/
 * (synced from ModuleHub by scripts/sync-module-bundles.ps1) so the visuals
 * work offline — NO modulehub-store service required.
 *
 *   staticBase : where module resources (module.json, SDK, code) load from.
 *                'module-bundles' is same-origin, served with the widget.
 *   storeUrl   : OPTIONAL — add it (e.g. 'http://localhost:8743') to persist
 *                module state/transactions to the shared service. Omitted here,
 *                so store ops are in-session in-memory (visual still works).
 *
 * To make the picker / dynamically-deployed modules selectable instead, omit
 * moduleId and set storeUrl to a running service. See §12 for the contract.
 * ========================================================================== */
SFP.config.define('dashboard.modules', {
  grid: { columns: 12, gap: 12 },
  widgets: [

    /* Full-page module switcher. No moduleId → module-host shows a dropdown of
       every available module (read from module-bundles/index.json, offline) and
       swaps the running module when you pick one. */
    { type: 'module-host', layout: { span: 12, minH: 680 },
      options: {
        staticBase: 'module-bundles',
      } },

    /* To PIN specific modules side-by-side instead of one switcher, replace the
       entry above with fixed panels, e.g.:
         { type:'module-host', layout:{ span:6, minH:560 },
           options:{ moduleId:'bag-filter-tracker', staticBase:'module-bundles' } },
         { type:'module-host', layout:{ span:6, minH:560 },
           options:{ moduleId:'mollier-monitor',   staticBase:'module-bundles' } },
       Add `storeUrl:'http://localhost:8743'` to any entry to persist state and
       list service-published modules instead of the offline bundle. */

  ],
});
