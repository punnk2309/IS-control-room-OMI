/* ============================================================================
 * Dashboard: Modules — embedded ModuleHub modules via module-host widget
 * ----------------------------------------------------------------------------
 * 12-column grid. Each entry embeds one published module from the
 * modulehub-store service running at localhost:8743.
 * See docs/plans/modulehub-contracts.md §12 for the widget contract.
 * ========================================================================== */
SFP.config.define('dashboard.modules', {
  grid: { columns: 12, gap: 12 },
  widgets: [

    { type: 'module-host', layout: { span: 12, minH: 620 },
      options: {
        moduleId: 'bag-filter-tracker',
        storeUrl: 'http://localhost:8743',
      } },

    { type: 'module-host', layout: { span: 12, minH: 540 },
      options: {
        moduleId: 'mollier-monitor',
        storeUrl: 'http://localhost:8743',
      } },

  ],
});
