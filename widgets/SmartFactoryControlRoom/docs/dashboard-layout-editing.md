# Dashboard Layout Editing

Free-layout drag-and-drop editor for non-factory-map dashboard pages, plus a "+" tab for creating new dashboard pages at runtime.

## Activating Edit Mode

Click the pencil icon (top-right header). The pencil is the **only** enter/exit control; there is no "Exit edit" button in the bar.

- The pencil toggles `SFP.runtime.editMode` and emits `edit:modeChanged` on the event bus.
- **Exiting with unsaved changes** shows a three-button dialog: **Save & exit** (saves then exits), **Discard & exit** (restores pre-session config), **Cancel** (stays in edit mode with pencil active).
- On the **Factory Map** page the twin's shape editor activates (unchanged behaviour).
- On every other dashboard page the free **layout editor** (`SFP.ui.layoutEditor`) activates.

## Unified Edit Bar (`SFP.ui.editSession`)

A single top bar is owned by `src/ui/edit-session.js`. It adapts its buttons to the current page via registered adapters:

| Button | Available on | Action |
|--------|-------------|--------|
| **Undo** (Ctrl+Z) | all pages | Revert last change |
| **Redo** (Ctrl+Y) | all pages | Re-apply undone change |
| **+ Add widget** | dashboard pages only | Opens type picker; inserts widget and opens properties panel |
| **Save** | all pages | Persists via `SFP.config.override()`; shows error if storage is full/refused and keeps dirty=true |
| **Export** | all pages | Downloads ready-to-commit `.js` config file(s) |

### Honest Saves

`SFP.config.override()` now returns `true` on success and `false` when:
- `canEdit` is false (refused), or
- `localStorage.setItem` threw (storage full/sandboxed).

Both `layout-editor._save()` and `twin-editor._save()` check this return value. On failure the bar shows "Save failed — storage refused or full" and `dirty` stays `true`.

## Saving and Making Edits Permanent

Edits are stored in **two tiers**. Understanding the difference matters in production: **Save is per-browser; only Export makes a change permanent and fleet-wide.**

### Tier 1 — Save (runtime, this browser only)

Clicking **Save** calls `SFP.config.override(id, obj)` ([src/core/config-overrides.js](../src/core/config-overrides.js)), which:

1. applies the change live in memory (`SFP.config.define`) — instant, no page refresh, and
2. writes it into `localStorage` under the key **`sfp.configOverrides`** as a `{ configId: configObj }` map.

On every page load, `applyPersistedOverrides()` re-applies every stored override, so your edit survives reloads **on that machine and browser profile**.

What Save does **not** do:

- It does **not** write to the OMI server or to any backend — there is no server-side save path.
- It is **not** shared with other operator stations (localStorage is per-origin, per-browser-profile).
- It is **lost** if the browser cache/profile is cleared.
- It is refused on operator stations where the `canEdit` property is `false`.

> Treat Save as a convenient working draft on one machine — not as deployment.

### Tier 2 — Export (permanent, version-controlled, all stations)

To make an edit permanent for everyone, export it to source and repackage the widget. Clicking **Export** calls `SFP.config.downloadConfigJs(id, filename)` and downloads a ready-to-commit `.js` file containing a single `SFP.config.define('<id>', { … })` built from the current (overridden) config.

**Step-by-step:**

1. In edit mode, make your changes and click **Export**. One `.js` file downloads per edited config.
2. Replace the matching source file in `config/` with the downloaded file (see the map below), and commit it to version control.
3. Repackage and re-import the widget:
   ```powershell
   # from the repo root
   .\scripts\package-cwp.ps1 -WidgetName SmartFactoryControlRoom
   # → dist\SmartFactoryControlRoom-v<version>.cwp   → import in OMI / CWP
   ```
4. In each browser that had a Tier-1 override, click **Reset overrides** (or run `SFP.config.clearOverride('<id>')` in the console) and reload, so the committed file config takes over and the now-redundant localStorage entry is dropped.

After step 4 the change is baked into the deployed package — identical on every station, surviving cache clears.

**Which file each export maps to:**

| Edited page / config | Config `id`            | Commit the export as                                  |
|----------------------|------------------------|-------------------------------------------------------|
| A dashboard page     | `dashboard.<pageId>`   | `config/dashboards/<pageId>.dashboard.js`             |
| Factory Map (twin)   | `twin.layout`          | `config/twin/twin.layout.config.js`                   |
| Theme                | `theme.<id>`           | `config/theme.<id>.config.js`                         |

> **Production note:** because there is no backend write-back, the durable workflow is always **Export → commit → repackage → re-import → Reset overrides**. If an edit only exists as a Tier-1 override, it lives on exactly one machine and will not appear on any other station.

## Layout Editor (Feature A)

### Per-Cell Controls

While edit mode is active every widget cell shows:

- **Dashed outline** indicating edit state; accent-coloured on hover.
- **Top-centre pill handle** (appears on hover): drag to reorder.
- **Hover toolbar** (top-right corner): gear opens the **docked widget properties panel** (see below), duplicate, remove.
- **Corner resize handle** (SE, diagonal grip `nwse-resize`): drag to change both `layout.span` and `layout.minH`.
- **Right-edge handle** (ew-resize): drag to change `layout.span` only.
- **Bottom-edge handle** (ns-resize): drag to change `layout.minH` only (snaps 20 px).

### Docked Widget Properties Panel

The gear button opens a 280 px docked right-side panel:

- **Type** dropdown (all registered widget types).
- **Span** (1–12), **Rows**, **Min height (px)** numeric inputs.
- **options** JSON textarea — turns red (`invalid` class) on parse error.
- **bind** JSON textarea — shown only when the widget has a `bind` key.
- **Apply** button — commits type/layout changes as one undo step; JSON is applied on Apply only (not live-typed).

`SFP.ui.dashEditor.open(pageId)` is reduced to a back-compat stub that is a no-op when the layout editor is active.

### Undo / Redo Model

- Each mutation pushes a deep-clone of the full dashboard config onto the undo stack before applying.
- Stack depth capped at 50. Redo stack cleared on new mutation.
- Dirty flag set on first mutation, cleared on successful Save.
- **Discard** restores the _baseline_ snapshot taken at session start (or the last saved state if Save was called during the session).

### Session Baseline

At `_activate(pageId)` a `_baseline` deep-clone is taken. `_save()` advances `_baseline` to the just-saved config. `_deactivate(discard=true)` calls `SFP.config.define('dashboard.<id>', _baseline)` to restore the in-memory registry.

### Factory-Map Guard

`isFactoryMap(dashboardId)` returns true when `dashboardId === 'factory-map'` or the dashboard config contains a `factory-twin` widget. The layout editor adapter is not registered for those pages.

## Twin Editor (Factory Map)

The twin editor (`SFP.twin.Editor`) now registers a twin adapter with `editSession`. Changes:

- **Redo stack** added — `_commitLayout`/`_commitConnections` clear redo on commit; `_undo()` pushes to redo; new `_redo()` method mirrors the layout-editor pattern.
- **Ctrl+Y** redo shortcut added to `_onKey`.
- **Banner chrome** reduced to the tool-hint message only; Save/Undo/Redo/dirty indicator are removed from the twin banner (they live in the unified editSession bar).
- `_refreshSessionUI()` now calls `SFP.ui.editSession.refresh()` to tell the bar to re-query button states.
- `editor.getAdapter()` returns the adapter object; `factory-twin.js` registers it with `editSession.registerAdapter` for the `factory-map` page.

## Add-Dashboard "+" Tab (Feature B)

Unchanged from previous implementation. See git history for details.

## Files Changed / Added

| File | Change |
|------|--------|
| `src/ui/edit-session.js` | **New** — unified edit bar + adapter contract |
| `src/ui/layout-editor.js` | Removed own top bar + exit button; registered layout adapter; added docked prop panel; added right-edge + bottom-edge resize handles; added session baseline for honest discard |
| `src/ui/app-shell.js` | `_renderPage` guard updated to check `editSession.isActive()` |
| `src/ui/dashboard-editor.js` | `open()` is now a back-compat stub (no-op when layout editor active) |
| `src/twin/twin-editor.js` | Removed Save/Undo from banner; added redo stack + `_redo()`; `_refreshSessionUI` delegates to editSession; `getAdapter()` exposed |
| `src/widgets/factory-twin.js` | Registers twin adapter with `editSession` |
| `src/core/config-overrides.js` | `writeMap()` returns bool; `override()` returns bool |
| `styles/base.css` | New: `le-resize-corner/right/bottom`, `le-prop-panel`, `le-prop-*` classes |
| `index.html` | Added `edit-session.js` script after `layout-editor.js` |
| `docs/dashboard-layout-editing.md` | This file |

## Deviations from Spec

- **`DOMContentLoaded` adapter registration** — `layout-editor.js` registers its adapter in a `DOMContentLoaded` listener instead of immediately, because `edit-session.js` loads after it. This is safe since the app bootstrap also defers to `DOMContentLoaded`.
- **No col-pinning (`layout.col`)** — reorder is by array position (CSS grid auto-flow). Explicit column pinning can be set via the JSON options in the properties panel.
- **`_fromSession` flag on `edit:modeChanged`** — `editSession._doExit()` emits `{on:false, _fromSession:true}` so the session's own listener does not re-enter. All other listeners (shell `_rebuildTabs`, factory-twin minimap) fire normally.
- **Twin adapter `onExit` simplification** — when `discard=true`, we call `editor.setActive(false)` which already restores the baseline in its `if (this.session && this.session.dirty)` block. When `discard=false` (save+exit), baseline was updated by `_save()` so `setActive(false)` does not restore — the saved state remains live.
