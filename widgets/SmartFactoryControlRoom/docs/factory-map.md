# Factory Map — Digital Twin Renderer

The Factory Map page renders a live 2-D digital twin of the site using a
Canvas-2D immediate-mode pipeline.  This document covers architecture, the
layout schema, the visual editor workflow, and the **Images** feature.

---

## Architecture overview

| Module | Role |
|---|---|
| `twin-model.js` | Builds an in-memory element tree from `twin.layout` + `twin.connections` config |
| `twin-renderer.js` | Immediate-mode draw loop: grid → zones → subzones → machines → connections |
| `twin-image-cache.js` | Async `Image` loader keyed by src; triggers re-render on load |
| `twin-camera.js` | Pan/zoom world transform; LOD thresholds |
| `twin-editor.js` | Visual editor: drag/resize, palette stamps, properties panel, undo stack |
| `twin-interactions.js` | Pointer/touch event routing to camera or editor |
| `twin-store.js` | Reactive UI state (selection, hover, active floor, connections visible) |
| `twin-router.js` | Connection path routing (Manhattan + waypoints) |

The canvas uses a world transform so all geometry is in **world units**.
Coordinates in the layout config are **parent-relative** (a subzone rect is
relative to its zone's top-left corner).

---

## Layout schema

```js
SFP.config.define('twin.layout', {
  world: { width, height },   // total canvas world size (px)
  zones: [ ZoneConfig ]
});
```

### Zone

```js
{
  id: 'assembly-a',           // stable; this IS a machine's physical zone
                              //   (machine-registry derives zone from placement here)
  label: 'Assembly Line A',
  rect: { x, y, w, h },       // absolute world coords
  points: [[dx,dy], ...],     // optional polygon vertices (rect-relative)
  status: { datapoint },      // drives zone tint via 'zone-energy' state group
  hint: 'Advisory text',
  image: ImageConfig,         // see Images section below
  floors: [ FloorConfig ],    // multi-floor zone (OR use subzones: [...])
  subzones: [ SubzoneConfig ] // single implicit floor
}
```

### Floor

```js
{
  id: 'f1',
  label: 'Floor 1 — Production',
  image: ImageConfig,          // per-floor floorplan overlay
  subzones: [ SubzoneConfig ]  // (machines: [...] for subzone-level floors)
}
```

### Subzone

```js
{
  id: 'line-1',
  label: 'Line 1',
  rect: { x, y, w, h },        // relative to parent zone rect
  image: ImageConfig,
  floors: [ FloorConfig ],      // subzone's own floors (optional)
  machines: [ MachineConfig ]   // (or floor.machines when using floors)
}
```

### Machine

```js
{ ref: 'M-001' }               // fleet machine: name/type from the asset model,
                               //   state/load from the registry. Placing it here
                               //   also defines this machine's physical zone.

{
  id: 'AHU-A1',
  label: 'Air Handler A1',
  kind: 'AHU',
  shape: 'rect' | 'round' | 'circle',
  rect: { x, y, w, h },        // relative to parent subzone rect; optional
  image: ImageConfig,
  bindings: {
    value: { datapoint, unit },
    state: { datapoint }
  }
}
```

---

## Images

Any zone, floor, subzone, or machine entry can carry an **`image`** property
that replaces the plain colour rectangle with a custom graphic.

### Schema

```js
image: {
  src: String,    // data URI (data:image/png;base64,...) or relative URL
  fit: String     // 'stretch' (default) | 'contain' | 'cover'
}
```

`src` accepts:

- `data:image/png;base64,...` — PNG embedded as a data URI
- `data:image/jpeg;base64,...` — JPEG embedded as a data URI
- `data:image/svg+xml,...` — SVG embedded as a percent-encoded or base64 data URI
- A relative URL path (e.g. `assets/floorplans/zone-a.svg`) resolved from the
  widget root — suitable for images committed to the repo rather than inlined

SVGs loaded as `Image` objects render at the element's drawn size; any internal
`viewBox` is respected by the browser.

### Fit modes

| Mode | Behaviour |
|---|---|
| `stretch` | Image is scaled to exactly fill the element rect (default) |
| `contain` | Image is scaled uniformly to fit inside the rect, centred, letterboxed |
| `cover` | Image is scaled uniformly to cover the rect, centred, cropped at edges |

### Draw order

For every element the renderer draws:

1. Base colour fill (theme token, always present — provides background for
   transparent images)
2. Image (clipped to the element rect)
3. Per-floor image overlay (zones and subzones with floors: composited on top
   of the element-level image when the active floor has an `image` key)
4. Status tint (translucent colour overlay — zone energy bands still visible)
5. Border / stroke
6. Labels, value badges, floor chips, error badges (always on top)
7. Selection / hover outline (editor overlay)

Status tints and labels are always rendered on top of the image so operational
state remains readable regardless of the background graphic.

### Async loading and the image cache

Images load asynchronously via `new Image()` inside `SFP.twin.imageCache`.
Each unique `src` is fetched once and cached for the session.  While loading,
the element renders as its plain fill (no flicker, no repeated network
requests).  When the load completes, `requestRender()` fires one extra frame
to paint the image.

If an image fails to load (broken URL or invalid data URI), a small
`⚠ img` glyph appears in the top-right corner of the element rect so the
issue is visible in the editor without breaking the surrounding map.

### Editor workflow

1. Open **Edit mode** (pencil icon in the header).
2. Click any element (zone, subzone, or machine) to select it.
3. In the **Properties** panel, scroll to the **Image** section.
4. Click **Set image…** — a file picker opens accepting PNG, JPEG, and SVG.
5. The file is read via `FileReader` as a data URI and stored on the element's
   `image.src`.  The map repaints immediately.
6. Use the **Fit** selector to choose `stretch`, `contain`, or `cover`.
7. Click **Remove image** to clear the image and revert to plain rect drawing.
8. All image changes go through the editor's undo stack — **Ctrl+Z** reverts
   each step.  Changes are in-memory only until you click **Save**.
9. Click **Save** to persist to `localStorage`, or **Export layout** to
   download a ready-to-commit `twin.layout.config.js` containing the data URI.

For floor-level images (floorplan overlays that change when the floor chip is
clicked), edit the layout config directly — set `image` on the floor entry
inside `zone.floors[n]` or `subzone.floors[n]`.  Floor image editing in the
visual editor UI is planned for a future release.

### Size guidance

Data URIs are stored in `localStorage` under the key `sfp.configOverrides`.
The browser's localStorage quota is typically **~5 MB total** across all keys.

| File type | Guidance |
|---|---|
| SVG | Under 10 KB — prefer minimal, hand-authored SVGs for floorplans |
| PNG/JPEG | Under 200 KB per image; compress before use |
| Soft warning | The editor warns in the console and in a toast when a single image exceeds **500 KB** |

For production deployments, prefer relative URL `src` values pointing to image
files committed alongside the widget (e.g. `assets/floorplans/zone-a.svg`).
This avoids the localStorage quota and keeps the config file readable.

### OMI note — data URIs in the exported config

When you click **Export layout**, the exported `twin.layout.config.js` file
contains the full data URI inline.  This means the image **travels with the
config file** and deploys automatically with the CWP (OMI Control Web
Platform) alongside the widget — no separate asset upload is needed.

To keep the exported config manageable:

- Use optimised SVG floorplans (< 10 KB) whenever possible.
- For larger PNG/JPEG backgrounds, switch to a relative URL `src` and commit
  the image file separately under `widgets/SmartFactoryControlRoom/assets/`.
- After committing a permanent config, call
  `SFP.config.clearOverride('twin.layout')` (or use **Reset overrides** in the
  editor) so the file-declared config is used on next reload.

---

## Undo / save model

The editor maintains an undo stack (cap 50) of full `twin.layout` + `twin.connections`
snapshots.  Every property change — including image set/remove/fit — pushes a
snapshot.  **Ctrl+Z** pops the last snapshot and re-applies it.  Nothing
reaches `localStorage` until **Save** is clicked (`SFP.config.override`).
Leaving edit mode while dirty silently discards all unsaved changes by
restoring the session baseline.

---

## LOD (Level of Detail)

| Zoom tier (config key) | What appears |
|---|---|
| `lod.subzone` | Subzones fade in (alpha 0→1 over the threshold range) |
| `lod.machine` | Machines fade in |
| `lod.detail` | Value badges inside machine boxes fade in |
| `lod.subzoneLabelMin` | Subzone labels appear (hard cutoff, no fade) |
| `lod.machineLabelMin` | Machine labels appear (hard cutoff) |

Images respect the same `globalAlpha` that each level applies for LOD fading,
so they fade in and out consistently with the rest of the element.
