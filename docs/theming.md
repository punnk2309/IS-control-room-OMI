# Theming

Themes are token maps in `config/theme.<id>.config.js`. The theme engine
writes every token to a CSS variable (`'bg-card'` → `--c-bg-card`) on `<html>`
and re-renders the active page so charts pick up the palette too.

## Add a theme

1. Copy `config/theme.dark.config.js` → `config/theme.highcontrast.config.js`
   and change the id: `SFP.config.define('theme.highcontrast', { … })`.
2. Add its `<script>` tag in `index.html`.
3. Make it selectable: add the (capitalized) name to the `theme` property
   `values` in `manifest.json`, or set it as default in `config/app.config.js`.

During development: `index.html?theme=highcontrast`.

## Token groups

| Tokens | Used for |
|---|---|
| `bg-base/surface/card/raised`, `border`, `border-strong` | surfaces & chrome |
| `text-1/2/3` | primary / secondary / muted text |
| `accent`, `accent-strong` | brand, active tab, primary buttons |
| `good`, `warn`, `alarm`, `info` | semantic status (badges, alarms, trends) |
| `state-*` | machine states (referenced by `states.config.js`) |
| `band-*` | factory-map energy bands |
| `chart-*` | chart series palette (`chart-1…4`, `chart-solar/battery/grid`) |

Rules: stylesheets and widgets must reference tokens (via `var(--c-…)` /
`ctx.theme.color('…')`) — never literal colors. Config may use either a token
name or a literal hex (literals bypass theming; prefer tokens).
