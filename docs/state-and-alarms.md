# State logic & alarms

Both systems are fully declarative. No widget hard-codes a state name, color,
or threshold.

## Condition grammar (shared)

Used by state rules and alarm rules; evaluated by `src/core/expressions.js`
(no `eval`, data only):

```js
{ op: '>', value: 90 }                    // input > 90
{ op: 'between', value: [150, 250] }
{ op: 'in', value: ['error', 'maintenance'] }
{ field: 'temperature', op: '>', value: 90 }   // compare a context field
{ all: [cond, cond] }   /   { any: [cond, cond] }
```
Operators: `>` `>=` `<` `<=` `==` `!=` `between` `in`.

## State groups — `config/states.config.js`

A group lists its states (`id`, `label`, `color` token) plus how raw values
map to them:

- `valueMap` — discrete inputs. PLC code `3` or string `'error'` → state
  `error`. Live integer state tags work out of the box this way.
- `rules` — ordered conditions for continuous inputs (first match wins, else
  `default`). The `zone-energy` bands that color the factory map are rules.

Widgets consume groups generically: the machine donut takes its segments from
the `machine` group; the map legend renders from `zone-energy`; predictive
maintenance bars color via `risk`. **Adding a state** (e.g. `starved`) means
adding it to the group (and a color token) — donuts, legends, filters and
badges pick it up automatically.

## Alarm rules — `config/alarm-rules.config.js`

Evaluated continuously by `src/state/alarm-engine.js`. Severities follow the
OMI scale: `Low | Medium | High | Critical`. When hosted, raised alarms are
also forwarded to the OMI alarm bar (`omi:alarm`).

```js
/* Threshold on any datapoint — auto-clears when the condition releases */
{ id: 'energy-total-high', datapoint: 'energy.totalUsage',
  when: { op: '>', value: 950 }, severity: 'High', category: 'energy',
  message: 'Total energy usage {value} {unit} above 950 kWh limit' },

/* Fleet rule: one alarm per machine entering the state */
{ id: 'machine-error', type: 'machineState', state: 'error',
  severity: 'Critical', category: 'machines',
  message: '{name} ({id}) entered ERROR state' },

/* Per-machine metric threshold */
{ id: 'machine-overtemp', type: 'machineMetric', metric: 'temperature',
  when: { op: '>', value: 94 }, severity: 'High', category: 'machines',
  message: '{name} temperature {value}°C above limit' },
```

`category` is free-form and powers filtered alarm-list widgets (the Energy
page shows `category: 'energy'` only).

### Behaviour

- Alarms auto-clear when their condition releases; cleared alarms stay in the
  "recent" list (last 50) and render dimmed with a resolved timestamp.
- Operators can **Ack** (flags the alarm) and **Resolve** (clears it; a
  still-true condition will re-raise on the next value — intentional).
- The header status badge aggregates active alarms (worst severity wins).
- Note: `machineMetric` rules subscribe to that metric for every machine
  permanently. Fine for hundreds of machines; for thousands prefer
  aggregate/rollup tags (see [deployment.md](deployment.md)).
