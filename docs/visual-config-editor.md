# Visual config editor — design & plan

Goal: configure dashboards — and especially the factory map — through a
visual UI (drag & drop, shape palette, CAD-style polygon drawing) instead of
editing `.config.js` files by hand.

## Why an in-app editor (not a separate OMI app)

The platform is a build-free static widget; there is no backend that could
write files, and inside the AVEVA OMI host the widget cannot touch the
filesystem either. A separate "designer" app would still face the same wall:
something must persist the result. So the design is:

1. **Edit in place** — an *edit mode* inside the running app (works
   standalone and inside OMI, since it's all in the widget's iframe).
2. **Persist as config overrides** — every edit produces a complete config
   object that is (a) applied live via `SFP.config.define` and (b) saved to
   `localStorage` (`sfp.configOverrides`), so edits survive reload on that
   machine/webview.
3. **Export to file** — one click downloads the edited config as a ready
   `*.config.js` file. Committing that file to the repo (replacing the old
   one) makes the layout permanent for every deployment. The override is
   then redundant and can be cleared.

This keeps a single source of truth (the config files), uses overrides as a
working copy, and needs no server. If a config write-back service ever
exists (e.g. a small REST endpoint on the OMI box), only
`src/core/config-overrides.js` needs a second persistence target.

## Entry point: the edit toggle (top right)

A pencil button in the header (next to the theme toggle) flips
`SFP.runtime.editMode` and emits `edit:modeChanged`.

- On the **Factory Map** page → the twin's visual editor activates.
- On **any other page** → the dashboard editor overlay opens for that page.

## Part 1 — Twin visual editor (`src/twin/twin-editor.js`)

Active only in edit mode on the factory map. Normal viewing interactions
(wheel zoom, pan on empty space) keep working; element clicks switch to
editing semantics.

| Capability | Behaviour |
|---|---|
| Select & move | Click an element, drag it; 8 px grid snap. Moving a zone/subzone moves everything inside it. Position writes back to the element's parent-relative `rect`. |
| Resize | 8 handles on the selected element; children keep their relative positions. |
| Palette | Docked left; preset stamps common in factories: Zone, Subzone, Machine (rect), Round unit, Tank (circle), Conveyor (wide strip), Boiler, AHU, Pump, External node. Click a preset, then click the canvas to stamp it. Machines drop into the subzone under the cursor, subzones into the zone, zones/externals anywhere. |
| Polygon zones | "Polygon zone" tool: CAD-style click-to-place vertices (straight lines), click the first vertex / double-click / Enter to close. Existing zones get "Edit shape" in the right-click menu to redraw their outline. Selected polygon zones show draggable vertex handles. Stored as `points: [[x,y]…]` relative to the zone origin; the zone's `rect` stays its bounding box (children remain rect-relative). |
| Properties | Mini-panel (right): id, label, x/y/w/h, shape (machines), delete. |
| Persistence | Every commit → `SFP.config.override('twin.layout' | 'twin.connections', …)` + live model rebuild (no reload). |
| Export | Buttons for "Export layout" / "Export connections" (.config.js download) and "Reset overrides". |

Out of scope for v1 (planned next): drawing new *connections* visually
(click source anchor → click target anchor), binding picker fed from the
datapoint registry, multi-select, undo/redo (the override snapshot makes a
coarse undo possible already: reset to file state).

## Part 2 — Dashboard editor (`src/ui/dashboard-editor.js`)

A modal overlay for every other page, edits `dashboard.<id>` configs:

- list of the page's widgets: type, grid span, min height, move up/down,
  remove;
- per-widget **options/bind** editing via validated JSON editors (the honest
  v1 of "visual menu selector" — a generated form per widget type can come
  later, the data path is identical);
- add widget — dropdown of every registered widget type;
- Apply (live re-render), Export `.dashboard.js`, Reset overrides.

## Part 3 — Override infrastructure (`src/core/config-overrides.js`)

Extends `SFP.config` with: `override(id, obj)`, `overrides()`,
`clearOverride(id)`, `clearAllOverrides()`, `exportConfigJs(id)` (pretty
JS-file text), `downloadConfigJs(id, filename)`. Applies stored overrides at
script load (the file is included after all config files, before
`src/app.js`).

## OMI integration note

Everything above runs identically inside the OMI host: the toggle is in the
widget's own header, localStorage belongs to the widget's webview profile,
and export uses a download link (works in WebView2). For fleet-wide rollout
the exported file is committed and repackaged as `.cwp` — by design, so that
ad-hoc screen edits never silently diverge from the deployable artifact.
