# Dashboard Layout Editing

Free-layout drag-and-drop editor for non-factory-map dashboard pages, plus a "+" tab for creating new dashboard pages at runtime.

## Activating Edit Mode

Click the pencil icon (top-right header) on any page, or open the app with `?edit=1` in the URL. The pencil toggles `SFP.runtime.editMode` and emits `edit:modeChanged` on the event bus.

- On the **Factory Map** page the twin's shape editor activates (unchanged behaviour).
- On every other dashboard page the free **layout editor** (`SFP.ui.layoutEditor`) activates.

## Layout Editor (Feature A)

### Top Bar

A bar appears between the header and the page content:

| Button | Action |
|--------|--------|
| **Undo** (Ctrl+Z) | Revert last change; disabled until there is something to undo |
| **Redo** (Ctrl+Y) | Re-apply undone change |
| **+ Add widget** | Opens a type picker dialog; chosen type is inserted with default span 3 / minH 110 and the widget-settings modal opens |
| **Save** | Persists the current layout via `SFP.config.override('dashboard.<id>', cfg)` into localStorage; survives page reload |
| **Export** | Downloads a ready-to-commit `.dashboard.js` file via `SFP.config.downloadConfigJs` |
| **Exit edit** | Deactivates the editor; prompts with an inline dialog if there are unsaved changes |

### Per-Cell Controls

While edit mode is active every widget cell shows:

- **Dashed outline** indicating edit state; accent-coloured on hover.
- **Top-centre pill handle** (appears on hover): drag to reorder the widget in the array. A ghost element follows the cursor; on drop the widget is spliced to the position of the hovered target cell (array swap, re-render).
- **Hover toolbar** (top-right corner of cell): three icon buttons — gear (opens the existing `SFP.ui.dashEditor` modal for the whole page), duplicate, remove.
- **Bottom-right resize handle** (appears on hover): drag horizontally to change `layout.span` (1–12 column grid, snapped per column width); drag vertically to change `layout.minH` (snapped every 20 px).

### Undo / Redo Model

- Each mutation (reorder, resize, add, duplicate, remove) pushes a deep-clone of the full dashboard config onto the undo stack before applying the change.
- Stack depth capped at 50 entries; oldest entries are discarded.
- Redo stack is cleared on every new mutation.
- Dirty flag is set on first mutation and cleared on Save.
- **Exit without saving** restores the originally loaded (persisted) config in memory via `SFP.config.overrides()`.

### Factory-Map Guard

The layout editor checks `isFactoryMap(dashboardId)` which returns true when:
1. `dashboardId === 'factory-map'`, or
2. The dashboard config contains any widget of type `'factory-twin'`.

Neither detection path modifies `dashboard-renderer.js`.

## Add-Dashboard "+" Tab (Feature B)

When edit mode is active the tab bar gains a dashed **"New page"** tab at the rightmost position.

### Creating a Page

1. Click the "+" tab.
2. An inline dialog asks for a page name (no `window.prompt`).
3. On confirm: a kebab-case id is generated (e.g. `quality`); uniqueness is enforced with a numeric suffix.
4. An empty dashboard config `{ grid: {columns:12, gap:12}, widgets: [] }` is created.
5. Both the app config (`SFP.config.override('app', ...)`) and the empty dashboard (`SFP.config.override('dashboard.<id>', ...)`) are persisted to localStorage.
6. The new page id is recorded in `sfp.userPageIds` localStorage key so it is identified as user-added across reloads.
7. The tab bar is rebuilt and the app navigates to the new page (which shows an empty grid).

### Reload Persistence

`config-overrides.js` runs its `applyPersistedOverrides()` IIFE before `app.js` reads the app config. This means the overridden `app` config (with user-added pages) and the overridden dashboard configs are all in memory before the shell or nav initialise. User-added pages therefore survive reload exactly like built-in ones.

### Renaming a Page

Right-click a user-added tab to open the rename dialog. Confirms via Enter or the "Rename" button. Persists updated `app` config via `SFP.config.override('app', ...)`.

### Deleting a Page

Click the small `×` badge that appears on user-added tabs in edit mode. A confirmation dialog is shown. On confirm:

- The page is removed from `appCfg.pages` and the app override is re-saved.
- `SFP.config.clearOverride('dashboard.<id>')` removes the dashboard from localStorage.
- The page id is removed from `sfp.userPageIds`.
- If the current page was the deleted one, navigation falls back to the first page.

Built-in pages (those present in `app.config.js`) do not get a `×` button.

## Files Changed

| File | Change |
|------|--------|
| `src/ui/layout-editor.js` | **New** — `SFP.ui.layoutEditor` module |
| `src/ui/app-shell.js` | "+" tab, per-tab edit decorations, `_rebuildTabs`, add/rename/delete page logic, `_onEditClick` reworked, `_renderPage` layout-editor guard |
| `styles/base.css` | New CSS classes: `le-*`, `tab-add-btn`, `tab-edit-remove` |
| `index.html` | Added `<script src="src/ui/layout-editor.js">` after `dashboard-editor.js` |
| `docs/dashboard-layout-editing.md` | This file |

## Deviations from Spec

- **Widget gear button opens the full-page dashEditor** (not a scoped single-widget editor). The existing `SFP.ui.dashEditor` works at dashboard granularity (all widgets, reorder/type/span/minH/JSON). Scoping it to a single widget would require rewriting or wrapping it. The existing editor is fully functional and reached via the gear button on each cell; this is a simpler and more powerful UX. Spec said "reuse its JSON options/bind editing" — we do exactly that.
- **"+" tab label** is "New page" rather than bare "+", to be more discoverable (spec only specified the icon/position, not the exact label).
- **No col-pinning** (`layout.col`) is written back by the resize handle. Reorder is by array position (CSS grid `auto-flow`). Explicit column pinning can be set via the JSON options in the dashEditor; the layout editor intentionally does not add that complexity for the drag model.
