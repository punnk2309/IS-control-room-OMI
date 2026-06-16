/* Exported by the SFP visual editor — 2026-06-16T09:12:25.130Z
 * Source config id: twin.connections
 * Commit this file to make the override permanent, then remove the
 * localStorage entry via SFP.config.clearOverride('twin.connections').
 */
SFP.config.define('twin.connections', {
  "externals": [
    {
      "id": "city-grid",
      "label": "City Grid",
      "x": 2120,
      "y": 300
    },
    {
      "id": "dispatch",
      "label": "Dispatch",
      "x": 820,
      "y": 1270
    }
  ],
  "datapoints": {
    "twin.flow.prod.aw": {
      "label": "Assembly A → Welding",
      "unit": "units/h",
      "decimals": 0,
      "sim": {
        "type": "wave",
        "min": 80,
        "max": 145,
        "period": "4h",
        "jitter": 6
      }
    },
    "twin.flow.prod.bw": {
      "label": "Assembly B → Welding",
      "unit": "units/h",
      "decimals": 0,
      "sim": {
        "type": "wave",
        "min": 60,
        "max": 120,
        "period": "5h",
        "jitter": 6
      }
    },
    "twin.flow.prod.wp": {
      "label": "Welding → Paint",
      "unit": "units/h",
      "decimals": 0,
      "sim": {
        "type": "wave",
        "min": 120,
        "max": 240,
        "period": "4h",
        "jitter": 8
      }
    },
    "twin.flow.prod.pq": {
      "label": "Paint → Quality",
      "unit": "units/h",
      "decimals": 0,
      "sim": {
        "type": "wave",
        "min": 110,
        "max": 230,
        "period": "4h",
        "jitter": 8
      }
    },
    "twin.flow.prod.qw": {
      "label": "Quality → Warehouse",
      "unit": "units/h",
      "decimals": 0,
      "sim": {
        "type": "wave",
        "min": 100,
        "max": 220,
        "period": "4h",
        "jitter": 8
      }
    },
    "twin.flow.prod.ws": {
      "label": "Warehouse → Shipping",
      "unit": "pal/h",
      "decimals": 0,
      "sim": {
        "type": "walk",
        "min": 8,
        "max": 36,
        "step": 2
      }
    },
    "twin.flow.prod.cutter": {
      "label": "Cutter H8 → Weld Cells",
      "unit": "units/h",
      "decimals": 0,
      "sim": {
        "type": "wave",
        "min": 20,
        "max": 60,
        "period": "2h",
        "jitter": 4
      }
    },
    "twin.flow.prod.booth2": {
      "label": "Booth 2 → Curing Oven",
      "unit": "units/h",
      "decimals": 0,
      "sim": {
        "type": "walk",
        "min": 10,
        "max": 45,
        "step": 3
      }
    },
    "twin.flow.prod.lift": {
      "label": "Conveyor C1 → C2 lift",
      "unit": "pal/h",
      "decimals": 0,
      "sim": {
        "type": "walk",
        "min": 0,
        "max": 40,
        "step": 5
      }
    },
    "twin.flow.steam.paint": {
      "label": "Steam Main → Paint",
      "unit": "t/h",
      "decimals": 1,
      "source": {
        "type": "omi",
        "address": "Flows.SteamPaintMain"
      },
      "sim": {
        "type": "wave",
        "min": 1.8,
        "max": 4.2,
        "period": "6h",
        "jitter": 0.2
      }
    },
    "twin.flow.cond.paint": {
      "label": "Paint condensate return",
      "unit": "t/h",
      "decimals": 1,
      "sim": {
        "type": "wave",
        "min": 1.2,
        "max": 3,
        "period": "6h",
        "jitter": 0.2
      }
    },
    "twin.flow.heat.riser": {
      "label": "Curing tower exhaust riser",
      "unit": "m³/min",
      "decimals": 0,
      "sim": {
        "type": "wave",
        "min": 90,
        "max": 220,
        "period": "3h",
        "jitter": 10
      }
    },
    "twin.flow.air.welding": {
      "label": "Air → Welding header",
      "unit": "Nm³/h",
      "decimals": 0,
      "source": {
        "type": "omi",
        "address": "Flows.AirWelding"
      },
      "sim": {
        "type": "wave",
        "min": 320,
        "max": 640,
        "period": "4h",
        "jitter": 25
      }
    },
    "twin.flow.air.assembly": {
      "label": "Air → Assembly A",
      "unit": "Nm³/h",
      "decimals": 0,
      "sim": {
        "type": "walk",
        "min": 200,
        "max": 480,
        "step": 25
      }
    },
    "twin.flow.air.maint": {
      "label": "Air → Maintenance Bay",
      "unit": "Nm³/h",
      "decimals": 0,
      "sim": {
        "type": "walk",
        "min": 60,
        "max": 160,
        "step": 12
      }
    },
    "twin.flow.air.booths": {
      "label": "AHU P1 → Booths supply",
      "unit": "m³/h",
      "decimals": 0,
      "sim": {
        "type": "wave",
        "min": 4500,
        "max": 8800,
        "period": "8h",
        "jitter": 200
      }
    },
    "twin.flow.coolant.welding": {
      "label": "Chiller ↔ Welding coolant",
      "unit": "L/s",
      "decimals": 1,
      "sim": {
        "type": "wave",
        "min": 8,
        "max": 14,
        "period": "2h",
        "jitter": 0.5
      }
    },
    "twin.eq.inv1.kw": {
      "label": "Inverter 1 output",
      "unit": "kW",
      "decimals": 0,
      "derived": {
        "op": "scale",
        "input": "energy.solar",
        "factor": 0.55
      }
    },
    "twin.eq.inv2.kw": {
      "label": "Inverter 2 output",
      "unit": "kW",
      "decimals": 0,
      "derived": {
        "op": "scale",
        "input": "energy.solar",
        "factor": 0.45
      }
    },
    "twin.eq.blr-u1.steam": {
      "label": "Boiler steam output",
      "unit": "t/h",
      "decimals": 1,
      "sim": {
        "type": "wave",
        "min": 2,
        "max": 4.5,
        "period": "6h",
        "jitter": 0.2
      }
    },
    "twin.eq.ahu-p1.flow": {
      "label": "AHU P1 airflow",
      "unit": "m³/h",
      "decimals": 0,
      "sim": {
        "type": "walk",
        "min": 5000,
        "max": 9000,
        "step": 300
      }
    },
    "twin.eq.ahu-a1.flow": {
      "label": "AHU A1 airflow",
      "unit": "m³/h",
      "decimals": 0,
      "sim": {
        "type": "walk",
        "min": 3000,
        "max": 6000,
        "step": 250
      }
    },
    "twin.eq.ef-p1.flow": {
      "label": "Exhaust fan flow",
      "unit": "m³/min",
      "decimals": 0,
      "sim": {
        "type": "walk",
        "min": 100,
        "max": 220,
        "step": 12
      }
    },
    "twin.eq.scrub-p1.dp": {
      "label": "Scrubber ΔP",
      "unit": "Pa",
      "decimals": 0,
      "sim": {
        "type": "walk",
        "min": 250,
        "max": 600,
        "step": 25
      }
    },
    "twin.eq.db-a1.load": {
      "label": "Board A1 load",
      "unit": "%",
      "decimals": 0,
      "sim": {
        "type": "walk",
        "min": 35,
        "max": 80,
        "step": 4
      }
    },
    "twin.eq.lift-w1.cycles": {
      "label": "Lift W1 cycles",
      "unit": "cyc/h",
      "decimals": 0,
      "sim": {
        "type": "walk",
        "min": 0,
        "max": 40,
        "step": 6
      }
    }
  },
  "connections": [
    {
      "id": "el-grid-tx",
      "label": "Grid import",
      "utility": "electrical",
      "from": {
        "ref": "external:city-grid"
      },
      "to": {
        "ref": "machine:TX-1",
        "anchor": {
          "side": "right",
          "t": 0.3
        }
      },
      "binding": "energy.grid",
      "unit": "kW",
      "flowRange": [
        0,
        100
      ]
    },
    {
      "id": "pr-ship-out",
      "label": "Outbound dispatch",
      "utility": "product",
      "from": {
        "ref": "zone:shipping",
        "anchor": {
          "side": "bottom",
          "t": 0.5
        }
      },
      "to": {
        "ref": "external:dispatch"
      },
      "binding": "twin.flow.prod.ws",
      "unit": "pal/h",
      "flowRange": [
        0,
        40
      ]
    },
    {
      "id": "el-pv-tx",
      "label": "PV → TX-1",
      "utility": "electrical",
      "from": {
        "ref": "machine:INV-1",
        "anchor": {
          "side": "bottom"
        }
      },
      "to": {
        "ref": "machine:TX-1",
        "anchor": {
          "side": "top"
        }
      },
      "binding": "energy.solar",
      "unit": "kW",
      "flowRange": [
        0,
        220
      ],
      "direction": "forward",
      "rules": [
        {
          "op": "<",
          "value": 10,
          "style": "inactive"
        }
      ]
    },
    {
      "id": "el-bess-tx",
      "label": "BESS → TX-1",
      "utility": "electrical",
      "from": {
        "ref": "machine:BESS-1",
        "anchor": {
          "side": "left"
        }
      },
      "to": {
        "ref": "machine:TX-1",
        "anchor": {
          "side": "right"
        }
      },
      "binding": "energy.batteryOutput",
      "unit": "kW",
      "flowRange": [
        0,
        100
      ],
      "direction": "both"
    },
    {
      "id": "el-tx-assembly-a",
      "label": "Feeder A",
      "utility": "electrical",
      "from": {
        "ref": "machine:TX-1",
        "anchor": {
          "side": "left"
        }
      },
      "to": {
        "ref": "zone:assembly-a",
        "anchor": {
          "side": "top",
          "t": 0.7
        }
      },
      "binding": "zone.assembly-a.energy",
      "unit": "kWh",
      "flowRange": [
        0,
        320
      ]
    },
    {
      "id": "el-tx-assembly-b",
      "label": "Feeder B",
      "utility": "electrical",
      "from": {
        "ref": "machine:TX-1",
        "anchor": {
          "side": "left"
        }
      },
      "to": {
        "ref": "zone:assembly-b",
        "anchor": {
          "side": "right",
          "t": 0.25
        }
      },
      "binding": "zone.assembly-b.energy",
      "unit": "kWh",
      "flowRange": [
        0,
        290
      ]
    },
    {
      "id": "el-tx-welding",
      "label": "Feeder W",
      "utility": "electrical",
      "from": {
        "ref": "machine:TX-1",
        "anchor": {
          "side": "left"
        }
      },
      "to": {
        "ref": "zone:welding",
        "anchor": {
          "side": "top",
          "t": 0.8
        }
      },
      "binding": "zone.welding.energy",
      "unit": "kWh",
      "flowRange": [
        0,
        240
      ]
    },
    {
      "id": "el-tx-paint",
      "label": "Feeder P",
      "utility": "electrical",
      "from": {
        "ref": "machine:TX-1",
        "anchor": {
          "side": "left"
        }
      },
      "to": {
        "ref": "zone:paint",
        "anchor": {
          "side": "right",
          "t": 0.3
        }
      },
      "binding": "zone.paint.energy",
      "unit": "kWh",
      "flowRange": [
        0,
        200
      ]
    },
    {
      "id": "el-tx-office",
      "label": "Feeder U",
      "utility": "electrical",
      "from": {
        "ref": "machine:TX-1",
        "anchor": {
          "side": "bottom"
        }
      },
      "to": {
        "ref": "zone:office",
        "anchor": {
          "side": "right",
          "t": 0.3
        }
      },
      "binding": "zone.office.energy",
      "unit": "kWh",
      "flowRange": [
        0,
        80
      ]
    },
    {
      "id": "pr-aa-weld",
      "label": "Assembly A → Welding",
      "utility": "product",
      "from": {
        "ref": "zone:assembly-a",
        "anchor": {
          "side": "right",
          "t": 0.35
        }
      },
      "to": {
        "ref": "zone:welding",
        "anchor": {
          "side": "left",
          "t": 0.35
        }
      },
      "binding": "twin.flow.prod.aw",
      "unit": "units/h",
      "flowRange": [
        0,
        160
      ]
    },
    {
      "id": "pr-ab-weld",
      "label": "Assembly B → Welding",
      "utility": "product",
      "from": {
        "ref": "zone:assembly-b",
        "anchor": {
          "side": "right",
          "t": 0.5
        }
      },
      "to": {
        "ref": "zone:welding",
        "anchor": {
          "side": "bottom",
          "t": 0.3
        }
      },
      "binding": "twin.flow.prod.bw",
      "unit": "units/h",
      "flowRange": [
        0,
        140
      ]
    },
    {
      "id": "pr-cutter-cells",
      "label": "Cutter H8 → Weld Cells",
      "utility": "product",
      "from": {
        "ref": "machine:M-008"
      },
      "to": {
        "ref": "subzone:welding/weld-cells",
        "anchor": {
          "side": "left",
          "t": 0.5
        }
      },
      "binding": "twin.flow.prod.cutter",
      "unit": "units/h",
      "flowRange": [
        0,
        70
      ]
    },
    {
      "id": "pr-weld-paint",
      "label": "Welding → Paint",
      "utility": "product",
      "from": {
        "ref": "zone:welding",
        "anchor": {
          "side": "right",
          "t": 0.35
        }
      },
      "to": {
        "ref": "zone:paint",
        "anchor": {
          "side": "left",
          "t": 0.35
        }
      },
      "binding": "twin.flow.prod.wp",
      "unit": "units/h",
      "flowRange": [
        0,
        260
      ]
    },
    {
      "id": "pr-booth-oven",
      "label": "Booth 2 → Curing Oven",
      "utility": "product",
      "from": {
        "ref": "machine:M-026"
      },
      "to": {
        "ref": "machine:M-029"
      },
      "binding": "twin.flow.prod.booth2",
      "unit": "units/h",
      "flowRange": [
        0,
        50
      ],
      "rules": [
        {
          "op": "<",
          "value": 4,
          "style": "inactive"
        }
      ]
    },
    {
      "id": "pr-paint-quality",
      "label": "Paint → Quality",
      "utility": "product",
      "from": {
        "ref": "zone:paint",
        "anchor": {
          "side": "bottom",
          "t": 0.3
        }
      },
      "to": {
        "ref": "zone:quality",
        "anchor": {
          "side": "top",
          "t": 0.7
        }
      },
      "binding": "twin.flow.prod.pq",
      "unit": "units/h",
      "flowRange": [
        0,
        260
      ]
    },
    {
      "id": "pr-quality-wh",
      "label": "Quality → Warehouse",
      "utility": "product",
      "from": {
        "ref": "zone:quality",
        "anchor": {
          "side": "right",
          "t": 0.5
        }
      },
      "to": {
        "ref": "zone:warehouse",
        "anchor": {
          "side": "left",
          "t": 0.5
        }
      },
      "binding": "twin.flow.prod.qw",
      "unit": "units/h",
      "flowRange": [
        0,
        260
      ]
    },
    {
      "id": "pr-wh-lift",
      "label": "C1 → C2 vertical lift",
      "utility": "product",
      "from": {
        "ref": "machine:M-038"
      },
      "to": {
        "ref": "machine:M-039"
      },
      "binding": "twin.flow.prod.lift",
      "unit": "pal/h",
      "flowRange": [
        0,
        50
      ],
      "rules": [
        {
          "op": "<",
          "value": 2,
          "style": "inactive"
        }
      ]
    },
    {
      "id": "pr-wh-ship",
      "label": "Warehouse → Shipping",
      "utility": "product",
      "from": {
        "ref": "zone:warehouse",
        "anchor": {
          "side": "bottom",
          "t": 0.2
        }
      },
      "to": {
        "ref": "zone:shipping",
        "anchor": {
          "side": "right",
          "t": 0.4
        }
      },
      "binding": "twin.flow.prod.ws",
      "unit": "pal/h",
      "flowRange": [
        0,
        40
      ]
    },
    {
      "id": "st-blr-paint",
      "label": "Steam main",
      "utility": "steam",
      "from": {
        "ref": "machine:BLR-U1"
      },
      "to": {
        "ref": "zone:paint",
        "anchor": {
          "side": "bottom",
          "t": 0.75
        }
      },
      "binding": "twin.flow.steam.paint",
      "unit": "t/h",
      "flowRange": [
        0,
        5
      ],
      "rules": [
        {
          "op": ">",
          "value": 4,
          "color": "warn",
          "badge": "Near capacity"
        }
      ]
    },
    {
      "id": "st-tower-riser",
      "label": "Tower exhaust riser",
      "utility": "steam",
      "from": {
        "ref": "machine:M-029"
      },
      "to": {
        "ref": "machine:EF-P1"
      },
      "binding": "twin.flow.heat.riser",
      "unit": "m³/min",
      "flowRange": [
        0,
        240
      ]
    },
    {
      "id": "cd-paint-blr",
      "label": "Condensate return",
      "utility": "condensate",
      "from": {
        "ref": "zone:paint",
        "anchor": {
          "side": "bottom",
          "t": 0.9
        }
      },
      "to": {
        "ref": "machine:BLR-U1"
      },
      "binding": "twin.flow.cond.paint",
      "unit": "t/h",
      "flowRange": [
        0,
        5
      ],
      "rules": [
        {
          "op": "<",
          "value": 1.6,
          "color": "warn",
          "badge": "Low return — check traps"
        }
      ]
    },
    {
      "id": "air-welding",
      "label": "Air header — Welding",
      "utility": "air",
      "from": {
        "ref": "machine:M-053"
      },
      "to": {
        "ref": "zone:welding",
        "anchor": {
          "side": "bottom",
          "t": 0.7
        }
      },
      "binding": "twin.flow.air.welding",
      "unit": "Nm³/h",
      "flowRange": [
        0,
        700
      ]
    },
    {
      "id": "air-assembly",
      "label": "Air header — Assembly A",
      "utility": "air",
      "from": {
        "ref": "machine:M-054"
      },
      "to": {
        "ref": "zone:assembly-a",
        "anchor": {
          "side": "bottom",
          "t": 0.5
        }
      },
      "binding": "twin.flow.air.assembly",
      "unit": "Nm³/h",
      "flowRange": [
        0,
        500
      ]
    },
    {
      "id": "air-maint",
      "label": "Air — Maintenance Bay",
      "utility": "air",
      "from": {
        "ref": "machine:M-053"
      },
      "to": {
        "ref": "zone:maintenance-bay",
        "anchor": {
          "side": "bottom",
          "t": 0.5
        }
      },
      "binding": "twin.flow.air.maint",
      "unit": "Nm³/h",
      "flowRange": [
        0,
        200
      ],
      "route": {
        "waypoints": [
          [
            820,
            1230
          ]
        ]
      },
      "rules": [
        {
          "op": ">",
          "value": 130,
          "color": "warn",
          "badge": "Leak survey due"
        }
      ]
    },
    {
      "id": "air-booths",
      "label": "Booth supply air",
      "utility": "air",
      "from": {
        "ref": "machine:AHU-P1"
      },
      "to": {
        "ref": "subzone:paint/booths",
        "anchor": {
          "side": "top",
          "t": 0.5
        }
      },
      "binding": "twin.flow.air.booths",
      "unit": "m³/h",
      "flowRange": [
        0,
        9000
      ]
    },
    {
      "id": "wa-chiller-weld",
      "label": "Coolant loop",
      "utility": "water",
      "from": {
        "ref": "machine:M-055"
      },
      "to": {
        "ref": "zone:welding",
        "anchor": {
          "side": "bottom",
          "t": 0.9
        }
      },
      "binding": "twin.flow.coolant.welding",
      "unit": "L/s",
      "flowRange": [
        0,
        16
      ],
      "direction": "both"
    },
    {
      "id": "conn-7544",
      "label": "Mill G7 → Weld Cell 1",
      "utility": "electrical",
      "from": {
        "ref": "machine:M-007"
      },
      "to": {
        "ref": "machine:M-017"
      },
      "binding": "twin.flow.prod.cutter",
      "unit": "",
      "flowRange": [
        0,
        100
      ],
      "direction": "forward"
    }
  ]
});
