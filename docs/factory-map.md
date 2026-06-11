# Factory map

The map is a configurable operational view, not a drawing. Rendering code
(`src/widgets/factory-map.js`) never changes for layout work — everything
below is config.

## Zones — `config/factory-layout.config.js`

```js
SFP.config.define('factoryLayout', {
  canvas: { width: 100, height: 62 },     // abstract coordinate space
  zones: [
    { id: 'welding',
      label: 'Welding Station',
      rect: { x: 35, y: 2, w: 20, h: 17 },          // canvas units
      energy: 'zone.welding.energy',                 // drives the color band
      hint: 'Reduce energy ~12% through load balancing…' },
    …
  ],
});
```

- **Move/resize** a zone: edit `rect`. **Add** a zone: add an entry (and its
  energy datapoint in `config/tags.config.js`). **Remove**: delete the entry.
- The SVG scales to its container; long labels are clipped to the zone bounds.
- `zone` ids link machines (`machines.config.js`) and navigation params — keep
  them stable once deployed.

## Zone coloring

Zone fill/border comes from the **`zone-energy` state group**
(`config/states.config.js`): the zone's `energy` datapoint value runs through
the band rules (`high`/`medium`/`normal`/`low`). Changing band thresholds or
colors there updates the map, its legend, and the energy bar chart together.

Zones with machines in `error` state additionally show a red ⚠ count badge,
independent of the energy band.

## Selection & drill-down

Clicking a zone emits `map:zoneSelected` on the bus. The separate
**zone-details** widget listens and shows live energy, the zone's machine
fleet breakdown, the optimization `hint`, and configurable quick actions:

```js
{ type: 'zone-details', layout: { span: 4 },
  options: { actions: [
    { label: 'View Machines', icon: 'cog', primary: true,
      navigate: { page: 'machines', params: { zone: '{zone}' } } },
  ] } }
```

`{zone}` resolves to the selected zone id; the machines page opens with that
zone pre-filtered. Any widget can join this pattern by listening to
`map:zoneSelected` via `ctx.onBus`.

## Extending the map

The widget is intentionally small and SVG-based. Natural extensions, in
roughly increasing effort:

- **More overlays** — add SVG elements per zone bound to other datapoints
  (production counts, headcount, downtime), toggled via widget options.
- **Polygon zones** — add a `points` field to zone config and render
  `<polygon>` when present (rects stay the default).
- **Multiple maps** — define additional layouts
  (`SFP.config.define('factoryLayout.site2', …)`) and add a `layout` option to
  the widget to choose one per dashboard; multi-site = one dashboard page per
  site.
- **Flow visualization** — draw `<path>` connectors between zone ids with the
  same animated-dash technique as the energy-flow widget.
