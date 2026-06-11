/* ============================================================================
 * src/app.js — application bootstrap (loaded last)
 * ----------------------------------------------------------------------------
 * Responsibilities:
 *   1. Detect the runtime: inside an AVEVA OMI host frame vs standalone
 *      (development / demo in a plain browser).
 *   2. Handle the OMI host protocol at the application level
 *      (omi:init / omi:propertyChanged / omi:resize / omi:modeChanged —
 *      tag traffic is handled by src/data/sources/omi-source.js).
 *   3. Wire sources into the data hub, start the engines, apply the theme,
 *      and render the shell.
 *
 * Data mode resolution ('Auto' property default):
 *   - hosted + omi:init received  -> live
 *   - anything else               -> simulation (visibly badged)
 * ========================================================================== */
(function (SFP) {
  'use strict';

  var started = false;
  var initFallbackTimer = null;

  function resolveMode(properties, initReceived) {
    var requested = String(properties.dataMode || 'Auto').toLowerCase();
    if (requested === 'live') { return 'live'; }
    if (requested === 'simulation') { return 'simulation'; }
    return (SFP.runtime.omiHosted && initReceived) ? 'live' : 'simulation';
  }

  function start(properties, initReceived) {
    SFP.runtime.properties = properties || {};
    var appCfg = SFP.config.get('app');
    var hub = SFP.data.hub;

    /* Data sources */
    SFP.data.simulationSource = new SFP.data.SimulationSource(hub);
    SFP.data.omiSource = new SFP.data.OmiSource();
    SFP.data.restSource = new SFP.data.RestSource();
    SFP.data.derivedSource = new SFP.data.DerivedSource(hub);
    SFP.data.computedSource = new SFP.data.ComputedSource();

    hub.registerSource('simulation', SFP.data.simulationSource);
    hub.registerSource('omi', SFP.data.omiSource);
    hub.registerSource('rest', SFP.data.restSource);
    hub.registerSource('derived', SFP.data.derivedSource);
    hub.registerSource('computed', SFP.data.computedSource);

    SFP.data.omiSource.setTagPrefix(
      properties.tagPrefix !== undefined ? properties.tagPrefix : 'Factory.'
    );

    hub.simulateUnbound = appCfg.data.simulateUnboundInLive !== false;
    hub.defineAll(SFP.config.get('datapoints'));

    /* Development aid: ?theme=light&mode=live URL overrides (standalone). */
    var urlParams = new URLSearchParams(window.location.search);

    /* No subscriptions exist yet, so the mode can be set directly. */
    SFP.runtime.mode = urlParams.get('mode') || resolveMode(properties, initReceived);
    hub.mode = SFP.runtime.mode;

    /* Theme before any widget renders (CSS variables + chart defaults).
     * Priority: URL override > user's persisted toggle choice > OMI property
     * > app config default. */
    SFP.ui.theme.apply(
      urlParams.get('theme') ||
      SFP.ui.theme.savedId() ||
      (properties.theme ? String(properties.theme).toLowerCase() : appCfg.theme)
    );

    /* Engines */
    SFP.data.machines.init(hub);
    SFP.state.alarms.init(hub);

    /* Shell + first page */
    SFP.ui.shell.init(document.getElementById('app'));
    if (properties.widgetTitle) { SFP.ui.shell.setTitle(properties.widgetTitle); }
    SFP.ui.nav.init(properties.defaultPage || appCfg.defaultPage);

    SFP.bus.emit('data:modeChanged', { mode: SFP.runtime.mode });

    /* Development aid: ?edit=1 opens the visual editor immediately. */
    if (urlParams.get('edit') === '1') {
      SFP.runtime.editMode = true;
      SFP.bus.emit('edit:modeChanged', { on: true });
    }
  }

  function onPropertyChanged(name, value) {
    var hub = SFP.data.hub;
    switch (name) {
      case 'widgetTitle':
        SFP.ui.shell.setTitle(value);
        break;
      case 'theme':
        SFP.ui.theme.apply(String(value).toLowerCase());
        break;
      case 'defaultPage':
        SFP.ui.nav.navigate(value);
        break;
      case 'tagPrefix':
        SFP.data.omiSource.setTagPrefix(value);
        hub.rebindAll();
        break;
      case 'dataMode':
        SFP.runtime.mode = resolveMode({ dataMode: value }, true);
        hub.setMode(SFP.runtime.mode);
        break;
      default:
        break;
    }
  }

  window.addEventListener('message', function (event) {
    var msg = event.data;
    if (!msg || !msg.type) { return; }
    switch (msg.type) {
      case 'omi:init':
        if (!started) {
          started = true;
          clearTimeout(initFallbackTimer);
          start(msg.properties || {}, true);
        }
        break;
      case 'omi:propertyChanged':
        if (started) { onPropertyChanged(msg.name, msg.value); }
        break;
      case 'omi:resize':
        SFP.bus.emit('app:resize', { width: msg.width, height: msg.height });
        break;
      case 'omi:modeChanged':
        /* Design mode: keep rendering; simulated data continues to flow. */
        break;
      default:
        break;
    }
  });

  document.addEventListener('DOMContentLoaded', function () {
    try {
      SFP.runtime.omiHosted = window.parent !== window;
    } catch (err) {
      SFP.runtime.omiHosted = true;   // cross-origin parent — assume hosted
    }

    window.parent.postMessage({ type: 'omi:ready' }, '*');

    if (SFP.runtime.omiHosted) {
      /* Give the host a moment to send omi:init; fall back to a clearly
       * badged simulation if it never arrives. */
      initFallbackTimer = setTimeout(function () {
        if (!started) { started = true; start({}, false); }
      }, 2500);
    } else {
      started = true;
      start({}, false);
    }
  });
}(window.SFP));
