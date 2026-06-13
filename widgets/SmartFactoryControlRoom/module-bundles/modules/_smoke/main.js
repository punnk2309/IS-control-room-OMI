/* ============================================================================
 * _smoke — SDK smoke-test module
 * ----------------------------------------------------------------------------
 * Validates the core SDK surface per contract §4 / §6:
 *   - registers via MH.register
 *   - renders with sdk.ui.el
 *   - subscribes tag "smoke.value" and shows live value
 *   - does a sdk.store.kv.put / kv.get roundtrip and shows result
 *   - logs via sdk.log
 *
 * Permissions: tags ["smoke.*"], store ["smoke"]
 * ========================================================================== */
MH.register({
  create: function (sdk, root) {
    sdk.log('_smoke create() called', 'env:', sdk.env);

    /* ── Layout ──────────────────────────────────────────────────────── */

    var el = sdk.ui.el;

    var tagDisplay = el('span', { style: { color: 'var(--c-accent,#38bdf8)', fontWeight: 'bold' } }, ['—']);
    var kvDisplay  = el('span', { style: { color: 'var(--c-good,#34d399)',   fontWeight: 'bold' } }, ['—']);
    var modeEl     = el('span', { style: { color: 'var(--c-warn,#fbbf24)' } },
      [sdk.env.simulation ? 'Simulation' : 'Live']);

    var card = el('div', {
      style: {
        position:   'absolute',
        inset:      '0',
        display:    'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding:    '24px',
        background: 'var(--c-bg-base,#070b15)',
        color:      'var(--c-text-1,#e8ecf8)',
        fontFamily: "'Segoe UI', system-ui, sans-serif",
        fontSize:   '14px',
        gap:        '10px',
      }
    }, [
      el('h1', { style: { margin: '0 0 8px', fontSize: '22px', color: 'var(--c-accent,#38bdf8)' } }, ['SDK OK']),
      el('p',  { style: { margin: '0' } }, ['Module: ', el('strong', {}, ['_smoke']), ' | Mode: ', modeEl]),
      el('p',  { style: { margin: '0' } }, ['Tag smoke.value: ', tagDisplay]),
      el('p',  { style: { margin: '0' } }, ['KV roundtrip (smoke / test): ', kvDisplay]),
    ]);

    root.appendChild(card);

    /* ── Tag subscription ────────────────────────────────────────────── */

    var unsub = sdk.data.subscribe('smoke.value', function (update) {
      sdk.log('smoke.value update:', update.value, update.quality);
      tagDisplay.textContent = String(update.value) + ' [' + update.quality + ']';
    });

    /* ── KV roundtrip ────────────────────────────────────────────────── */

    var ROUNDTRIP_VAL = { ts: Date.now(), ok: true };

    sdk.store.kv.put('smoke', 'test', ROUNDTRIP_VAL).then(function () {
      return sdk.store.kv.get('smoke', 'test');
    }).then(function (val) {
      var ok = val && val.ok === true;
      kvDisplay.textContent = ok ? 'PASS (roundtrip ok)' : 'FAIL (unexpected value: ' + JSON.stringify(val) + ')';
      if (!ok) { kvDisplay.style.color = 'var(--c-alarm,#f87171)'; }
      sdk.log('KV roundtrip result:', val);
    }).catch(function (err) {
      kvDisplay.textContent = 'FAIL (' + String(err && err.message || err) + ')';
      kvDisplay.style.color = 'var(--c-alarm,#f87171)';
      sdk.log('KV roundtrip error:', err);
    });

    /* ── Toast demo ──────────────────────────────────────────────────── */

    sdk.ui.toast('_smoke module loaded', 'good');
    sdk.log('_smoke initialised');
  },

  destroy: function () {
    /* nothing to tear down — subscriptions are managed by the SDK */
  },
});
