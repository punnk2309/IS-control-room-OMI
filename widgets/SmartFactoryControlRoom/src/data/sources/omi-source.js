/* ============================================================================
 * OMI source — binds datapoints to AVEVA OMI tags via the host postMessage API
 * ----------------------------------------------------------------------------
 * Datapoint binding:  source: { type: 'omi', address: 'Production.Rate' }
 *
 * The full tag name sent to the host is  tagPrefix + address  where tagPrefix
 * comes from the widget's OMI properties panel (default 'Factory.'). This
 * lets one CWP be dropped onto different plants/areas without editing config.
 *
 * Host protocol (see docs/data-sources.md):
 *   -> { type:'omi:subscribe',   tagName }
 *   -> { type:'omi:unsubscribe', tagName }
 *   <- { type:'omi:tagValue', tagName, value, quality, timestamp }
 * ========================================================================== */
(function (SFP) {
  'use strict';

  function OmiSource() {
    this.tagPrefix = 'Factory.';
    this.byTag = {};      // full tag name -> { publish }
    this.byId = {};       // datapoint id  -> full tag name
    this._listen();
  }

  OmiSource.prototype.setTagPrefix = function (prefix) {
    this.tagPrefix = prefix || '';
  };

  OmiSource.prototype._fullTag = function (def) {
    return this.tagPrefix + def.source.address;
  };

  OmiSource.prototype.activate = function (id, def, publish) {
    var tagName = this._fullTag(def);
    this.byTag[tagName] = { publish: publish };
    this.byId[id] = tagName;
    window.parent.postMessage({ type: 'omi:subscribe', tagName: tagName }, '*');
  };

  OmiSource.prototype.deactivate = function (id) {
    var tagName = this.byId[id];
    if (!tagName) { return; }
    delete this.byTag[tagName];
    delete this.byId[id];
    window.parent.postMessage({ type: 'omi:unsubscribe', tagName: tagName }, '*');
  };

  OmiSource.prototype._listen = function () {
    var self = this;
    window.addEventListener('message', function (event) {
      var msg = event.data;
      if (!msg || msg.type !== 'omi:tagValue') { return; }
      var bound = self.byTag[msg.tagName];
      if (!bound) { return; }
      var value = (typeof msg.value === 'number') ? msg.value : parseFloat(msg.value);
      if (isNaN(value)) { value = msg.value; }   // pass strings through (state tags)
      var ts = msg.timestamp ? Date.parse(msg.timestamp) : Date.now();
      bound.publish(value, msg.quality || 'Good', ts);
    });
  };

  /** Write a value back to a tag (e.g. setpoints). Fire-and-forget per the
   *  OMI protocol — there is no write confirmation event. */
  OmiSource.prototype.writeTag = function (address, value) {
    window.parent.postMessage({
      type: 'omi:writeTag',
      tagName: this.tagPrefix + address,
      value: value,
    }, '*');
  };

  SFP.data.OmiSource = OmiSource;
}(window.SFP));
