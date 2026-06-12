# Unified Edit System — Design

Goal: one cohesive edit experience across every dashboard, including the
factory map. One way in, one way out, one top bar, one session contract.

## Problems being solved

1. Two disjoint editors: the twin editor (map) and the layout editor
   (other dashboards) each own their own top bar, save, undo, and exit.
2. Exit confusion: the layout editor's "Exit" button does not sync with the
   top-right pencil; two exits, two states.
3. Widget settings are only reachable via "Add widget" flow; no direct
   "edit this widget" affordance.
4. Resize handle: poor visual, and vertical scaling is unreliable.

## Architecture

### The pencil is the only mode toggle

`SFP.runtime.editMode` is owned by the app shell's pencil button alone.
No editor renders its own Exit/Close control. Exiting with unsaved changes
prompts: **Save / Discard / Cancel** (cancel keeps editing).

### Editor adapters + one shared top bar

New `src/ui/edit-session.js` (`SFP.ui.editSession`) renders the single edit
top bar and binds it to whichever **editor adapter** is active for the
current page:

```
EditorAdapter contract:
  id            'twin' | 'layout'
  canUndo()/canRedo()/undo()/redo()
  dirty()
  save()   → boolean (honest: false when persistence failed)
  export()
  onExit(discard)   // restore baseline if discard
  bus events: 'edit:dirtyChanged' so the bar repaints
```

- Factory-map page → twin adapter (wraps the existing twin editor; its
  banner bar is removed, palette + properties panel stay).
- Any other dashboard → layout adapter (wraps the layout editor).
- Page navigation while editing switches adapters; each page keeps its own
  session (baseline, undo stack) for the lifetime of edit mode.

Top bar contents (identical on every page): page name • dirty dot •
Undo • Redo • Add widget (layout pages only) • Save • Export.
No Exit button.

### Per-widget editing, seamless

Every cell in edit mode gets a hover toolbar: **gear • duplicate • remove**,
plus the drag pill. The gear opens a **widget properties panel** docked to
the right (same visual pattern as the twin editor's props panel — shared CSS):

- Type (dropdown of registered widgets)
- Layout: span (1-12), rows, minH — numeric steppers
- Options / Bind: validated JSON textareas (reuse dashboard-editor's
  validation), Apply applies live through the adapter's mutate path
  (one undo step per Apply).

The old full-page dashboard-editor modal is retired; its JSON validation and
export logic move into the panel. `SFP.ui.dashEditor.open()` remains as a
thin alias opening the panel for the first widget (back-compat).

### Resize handles

Replace the corner div with a proper diagonal-grip glyph (CSS triangle
hatching, cursor `nwse-resize`) plus an **edge handle on the bottom border**
(cursor `ns-resize`) and one on the right border (`ew-resize`):

- Right edge: span only.
- Bottom edge: vertical only — minH (snap 20px) and, when crossing row
  boundaries, `rows`.
- Corner: both axes simultaneously.
Live preview during drag; one undo step on release.

## Out of scope

ModuleHub (separate plan), multi-station sync of saved layouts.
