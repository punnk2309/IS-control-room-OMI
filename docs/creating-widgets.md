# Creating widget types

Widget *types* are reusable building blocks; dashboards instantiate them from
config. Add a new type when no existing widget (see
[creating-dashboards.md](creating-dashboards.md)) fits.

## Minimal example

`src/widgets/gauge.js`:

```js
/* Widget: gauge — radial gauge for a 0–100 datapoint
 * bind:    { value: 'energy.batteryLevel' }
 * options: { title, color }
 */
(function (SFP) {
  'use strict';

  SFP.widgets.register('gauge', {
    create: function (ctx) {
      var dom = ctx.dom;

      var card = dom.card({ title: ctx.options.title });
      ctx.root.appendChild(card.root);

      var value = dom.el('div', { class: 'kpi-value', text: '—' });
      card.body.appendChild(value);

      /* Auto-released when the widget is destroyed (page change). */
      ctx.subscribe(ctx.bind.value, function (sample) {
        value.textContent = ctx.format.number(sample.value, 0) + '%';
      });

      return {
        resize:  function () { /* container resized (optional) */ },
        destroy: function () { /* free non-data resources (optional) */ },
      };
    },
  });
}(window.SFP));
```

Then add `<script src="src/widgets/gauge.js"></script>` to `index.html`
(before the config section) and use `{ type: 'gauge', … }` in any dashboard.

## The context (`ctx`)

| Member | Purpose |
|---|---|
| `root` | container element, already placed in the dashboard grid |
| `options`, `bind`, `params` | from dashboard config / navigation |
| `subscribe(dpId, cb)` | DataHub subscription, auto-released on destroy |
| `onBus(event, cb)` | bus subscription, auto-released on destroy |
| `hub` | `get(id)`, `history(id, rangeMs)`, `def(id)` for labels/units |
| `states` | state engine: `states(group)`, `stateDef(group, id)`, `normalize`, `evaluateRules` |
| `alarms` | alarm engine: `active(category)`, `recent()`, `acknowledge(key)`, `resolve(key)` |
| `machines` | machine registry: `list()`, `byZone(id)`, `counts(zone?)`, `dp(id, metric)` |
| `theme` | `color(token)`, `alpha(token, a)`, `chartBase(opts)` for Chart.js |
| `nav` | `navigate(page, params)`, `current()` |
| `format`, `dom`, `icons` | helpers (numbers, durations, DOM builder, SVG icons) |

## Rules of the road

- **Bind to datapoints, never to sources.** If you need a tag, define a
  datapoint in `config/tags.config.js` and bind to it.
- **No hard-coded states, thresholds or colors.** Resolve states through
  `ctx.states` and colors through `ctx.theme.color(token)` so config and
  themes keep working.
- **Subscribe via `ctx.subscribe`/`ctx.onBus`** so cleanup is automatic. Only
  use `ctx.hub.subscribe` directly when you manage release yourself (see
  machine-grid's per-page subscriptions).
- **Charts:** build options from `ctx.theme.chartBase(...)`, return
  `{ resize: chart.resize, destroy: chart.destroy }`, and throttle redraw on
  bursty datapoints (see time-series).
- **Degrade gracefully.** Render an empty state instead of throwing; a thrown
  error is caught and shown as an error card, isolating the failure.
- **Styles** go in `styles/widgets.css` under a new section, using `--c-*`
  variables only.
- **Document the config surface** in the file header comment (bind/options) —
  that header is the widget's API contract.

## Icons

Add SVG paths to `src/core/icons.js` (24×24 grid, stroke style) and reference
them by name anywhere in config.
