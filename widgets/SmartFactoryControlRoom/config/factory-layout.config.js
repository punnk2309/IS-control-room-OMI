/* ============================================================================
 * Factory layout — config/factory-layout.config.js
 * ----------------------------------------------------------------------------
 * Drives the factory-map widget. Zones are drawn in an abstract coordinate
 * space (`canvas`, default 100×62 — roughly a 16:10 floor plan); rects are
 * { x, y, w, h } in those units. To move/resize/add a zone, edit this file —
 * the renderer adapts automatically.
 *
 *   energy — datapoint that drives the zone's color band (state group
 *            'zone-energy' in states.config.js)
 *   hint   — optimization note shown in the zone-details panel
 *
 * Zone ids are referenced by machines.config.js (`zone`) and by navigation
 * params (e.g. #/machines?zone=welding).
 * ========================================================================== */
SFP.config.define('factoryLayout', {
  canvas: { width: 100, height: 62 },

  zones: [
    { id: 'assembly-a', label: 'Assembly Line A',
      rect: { x: 2, y: 2, w: 30, h: 17 },
      energy: 'zone.assembly-a.energy',
      hint: 'Highest consumer on site. Stagger conveyor start-ups to cut the morning peak by ~8%.' },

    { id: 'welding', label: 'Welding Station',
      rect: { x: 35, y: 2, w: 20, h: 17 },
      energy: 'zone.welding.energy',
      hint: 'Reduce energy by ~12% through load balancing and weld scheduling optimization.' },

    { id: 'paint', label: 'Paint Shop',
      rect: { x: 58, y: 2, w: 19, h: 17 },
      energy: 'zone.paint.energy',
      hint: 'Curing ovens dominate. Batch parts to keep ovens at capacity instead of reheating.' },

    { id: 'utilities-roof', label: 'Solar Array (Roof)',
      rect: { x: 80, y: 2, w: 18, h: 17 },
      energy: 'energy.solar',
      hint: 'Roof-mounted PV. Clean panels quarterly; soiling losses average 4–7%.' },

    { id: 'assembly-b', label: 'Assembly Line B',
      rect: { x: 2, y: 22, w: 30, h: 15 },
      energy: 'zone.assembly-b.energy',
      hint: 'Press hydraulics idle at high pressure. Enable standby mode between cycles.' },

    { id: 'quality', label: 'Quality Control',
      rect: { x: 35, y: 22, w: 20, h: 15 },
      energy: 'zone.quality.energy',
      hint: 'Climate-controlled metrology room. Verify door interlocks to avoid HVAC waste.' },

    { id: 'warehouse', label: 'Warehouse',
      rect: { x: 58, y: 22, w: 40, h: 15 },
      energy: 'zone.warehouse.energy',
      hint: 'LED retrofit complete. Next: motion-zoned lighting in low-traffic aisles.' },

    { id: 'maintenance-bay', label: 'Maintenance Bay',
      rect: { x: 2, y: 42, w: 22, h: 16 },
      energy: 'zone.maintenance-bay.energy',
      hint: 'Compressed-air leak survey due — last audit found 9% line loss.' },

    { id: 'shipping', label: 'Shipping Dock',
      rect: { x: 27, y: 42, w: 28, h: 16 },
      energy: 'zone.shipping.energy',
      hint: 'Dock door seals degraded on doors 3–4; heat loss during winter shifts.' },

    { id: 'office', label: 'Office Area',
      rect: { x: 58, y: 42, w: 40, h: 16 },
      energy: 'zone.office.energy',
      hint: 'Schedule HVAC setback 19:00–05:00; weekend occupancy is near zero.' },
  ],
});
