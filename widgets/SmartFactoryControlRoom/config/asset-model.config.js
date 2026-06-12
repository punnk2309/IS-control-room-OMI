/* ============================================================================
 * Asset model — config/asset-model.config.js
 * ----------------------------------------------------------------------------
 * Declares the DS650 physical asset hierarchy for plant 0017.
 * Levels (implied by nesting depth):
 *   1 Plant  – 4 chars              e.g. 0017
 *   2 Area   – 3 chars              e.g. NIF
 *   3 Line   – 3 chars + 2-digit    e.g. LIN01
 *   4 Unit   – 3 chars + 2-digit    e.g. DRY01
 *   5 Machine– 3 chars + 2-digit    e.g. EGR01
 *   6 Equipment– 3 chars + 4-digit  e.g. FAN1015
 *   7 Component– 10-digit number    e.g. 2003445668
 *
 * Each node: { code, name, children?, tags?, machineRef? }
 *   tags      – datapoint ids whose physical home is this node
 *   machineRef– id from machines.config.js (machine-level+ nodes only)
 * ========================================================================== */
SFP.config.define('asset-model', {
  code: '0017',
  name: 'Demo Factory – Plant 0017',
  children: [

    /* ── Area: NIF – Nozzle & Integrated Fabrication ─────────────────────── */
    {
      code: 'NIF',
      name: 'Nozzle & Integrated Fabrication',
      tags: ['zone.assembly-a.energy', 'zone.assembly-b.energy'],
      children: [

        /* Line: Assembly Line A */
        {
          code: 'LIN01',
          name: 'Assembly Line A',
          tags: ['production.rate', 'production.efficiency'],
          children: [

            /* Unit: CNC Machining Cell */
            {
              code: 'CNC01',
              name: 'CNC Machining Cell',
              children: [
                {
                  code: 'EGR01',
                  name: 'CNC Mill A1',
                  machineRef: 'M-001',
                  tags: [],
                  children: [
                    {
                      code: 'SPN1001',
                      name: 'Spindle Assembly',
                      children: [
                        { code: '2003445668', name: 'Spindle Bearing – Main' },
                        { code: '2003445669', name: 'Spindle Bearing – Rear' },
                      ],
                    },
                    {
                      code: 'MOT1001',
                      name: 'Drive Motor',
                      children: [
                        { code: '2003445670', name: 'Motor Winding A' },
                      ],
                    },
                  ],
                },
                {
                  code: 'EGR02',
                  name: 'Lathe B2',
                  machineRef: 'M-002',
                  children: [
                    {
                      code: 'CHK1001',
                      name: 'Chuck Assembly',
                      children: [
                        { code: '2003445671', name: 'Chuck Jaw Set' },
                      ],
                    },
                  ],
                },
                {
                  code: 'EGR03',
                  name: 'Mill G7',
                  machineRef: 'M-007',
                  children: [],
                },
              ],
            },

            /* Unit: Press & Forming Cell */
            {
              code: 'PRS01',
              name: 'Press & Forming Cell',
              children: [
                {
                  code: 'EGR04',
                  name: 'Press C3',
                  machineRef: 'M-003',
                  children: [
                    {
                      code: 'HYD1001',
                      name: 'Hydraulic Power Unit',
                      children: [
                        { code: '2003445672', name: 'HPU Pump Element' },
                        { code: '2003445673', name: 'HPU Relief Valve' },
                      ],
                    },
                  ],
                },
                {
                  code: 'EGR05',
                  name: 'Grinder E5',
                  machineRef: 'M-005',
                  children: [
                    {
                      code: 'WHL1001',
                      name: 'Grinding Wheel Assembly',
                      children: [
                        { code: '2003445674', name: 'Wheel Arbor Bearing' },
                      ],
                    },
                  ],
                },
              ],
            },

            /* Unit: Welding & Joining Cell */
            {
              code: 'WLD01',
              name: 'Welding & Joining Cell A',
              children: [
                {
                  code: 'EGR06',
                  name: 'Welder D4',
                  machineRef: 'M-004',
                  children: [
                    {
                      code: 'COL1001',
                      name: 'Cooling System',
                      children: [
                        { code: '2003445675', name: 'Coolant Pump' },
                        { code: '2003445676', name: 'Heat Exchanger Core' },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },

        /* Line: Assembly Line B */
        {
          code: 'LIN02',
          name: 'Assembly Line B',
          tags: ['production.downtime'],
          children: [

            /* Unit: Sheet Metal Processing */
            {
              code: 'SMP01',
              name: 'Sheet Metal Processing',
              children: [
                {
                  code: 'EGR07',
                  name: 'Router I9',
                  machineRef: 'M-009',
                  children: [
                    {
                      code: 'SPN1002',
                      name: 'Router Spindle',
                      children: [
                        { code: '2003445677', name: 'Spindle Motor Bearing' },
                      ],
                    },
                  ],
                },
                {
                  code: 'EGR08',
                  name: 'Saw J10',
                  machineRef: 'M-010',
                  children: [],
                },
                {
                  code: 'EGR09',
                  name: 'Shear B4',
                  machineRef: 'M-016',
                  children: [],
                },
              ],
            },

            /* Unit: Press Line B */
            {
              code: 'PRS02',
              name: 'Press Line B',
              children: [
                {
                  code: 'EGR10',
                  name: 'Press K11',
                  machineRef: 'M-011',
                  children: [
                    {
                      code: 'HYD1002',
                      name: 'Hydraulic Power Unit B',
                      children: [
                        { code: '2003445678', name: 'HPU-B Pump Element' },
                      ],
                    },
                  ],
                },
                {
                  code: 'EGR11',
                  name: 'Bender B2',
                  machineRef: 'M-014',
                  children: [],
                },
              ],
            },

            /* Unit: CNC Machining Cell B */
            {
              code: 'CNC02',
              name: 'CNC Machining Cell B',
              children: [
                {
                  code: 'EGR12',
                  name: 'Lathe L12',
                  machineRef: 'M-012',
                  children: [
                    {
                      code: 'CHK1002',
                      name: 'Chuck Assembly B',
                      children: [
                        { code: '2003445679', name: 'Chuck Jaw Set B' },
                      ],
                    },
                  ],
                },
                {
                  code: 'EGR13',
                  name: 'CNC Mill B1',
                  machineRef: 'M-013',
                  children: [],
                },
              ],
            },
          ],
        },
      ],
    },

    /* ── Area: WLD – Welding & Surface Treatment ─────────────────────────── */
    {
      code: 'WLD',
      name: 'Welding & Surface Treatment',
      tags: ['zone.welding.energy', 'zone.paint.energy'],
      children: [

        /* Line: Robotic Welding Line */
        {
          code: 'WEL01',
          name: 'Robotic Welding Line',
          children: [

            /* Unit: Weld Cells 1-4 (robot welders) */
            {
              code: 'RWC01',
              name: 'Robot Weld Cell Block',
              children: [
                {
                  code: 'EGR14',
                  name: 'Weld Cell 1',
                  machineRef: 'M-017',
                  children: [
                    {
                      code: 'TCH1001',
                      name: 'Welding Torch Assembly',
                      children: [
                        { code: '2003445680', name: 'Contact Tip Holder' },
                        { code: '2003445681', name: 'Diffuser Nozzle' },
                      ],
                    },
                  ],
                },
                {
                  code: 'EGR15',
                  name: 'Weld Cell 2',
                  machineRef: 'M-018',
                  children: [],
                },
                {
                  code: 'EGR16',
                  name: 'Weld Cell 3',
                  machineRef: 'M-019',
                  children: [],
                },
                {
                  code: 'EGR17',
                  name: 'Weld Cell 4',
                  machineRef: 'M-020',
                  children: [],
                },
              ],
            },

            /* Unit: Spot & Seam Welding */
            {
              code: 'SPT01',
              name: 'Spot & Seam Welding Unit',
              children: [
                {
                  code: 'EGR18',
                  name: 'Spot Welder 5',
                  machineRef: 'M-021',
                  children: [],
                },
                {
                  code: 'EGR19',
                  name: 'Spot Welder 6',
                  machineRef: 'M-022',
                  children: [],
                },
                {
                  code: 'EGR20',
                  name: 'Seam Welder 7',
                  machineRef: 'M-023',
                  children: [],
                },
                {
                  code: 'EGR21',
                  name: 'Laser Welder 8',
                  machineRef: 'M-024',
                  children: [
                    {
                      code: 'LAS1001',
                      name: 'Laser Source Assembly',
                      children: [
                        { code: '2003445682', name: 'Laser Diode Module' },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },

        /* Line: Paint Shop Line */
        {
          code: 'PNT01',
          name: 'Paint Shop Line',
          tags: [],
          children: [

            /* Unit: Paint Application */
            {
              code: 'PAP01',
              name: 'Paint Application Unit',
              children: [
                {
                  code: 'EGR22',
                  name: 'Paint Booth 1',
                  machineRef: 'M-025',
                  children: [
                    {
                      code: 'FAN1015',
                      name: 'Exhaust Fan Assembly',
                      children: [
                        { code: '2003445683', name: 'Fan Bearing – Drive End' },
                        { code: '2003445684', name: 'Fan Bearing – Non-Drive End' },
                      ],
                    },
                    {
                      code: 'FLT1001',
                      name: 'Paint Filter Bank',
                      children: [
                        { code: '2003445685', name: 'Pre-Filter Element' },
                        { code: '2003445686', name: 'HEPA Filter Element' },
                      ],
                    },
                  ],
                },
                {
                  code: 'EGR23',
                  name: 'Paint Booth 2',
                  machineRef: 'M-026',
                  children: [],
                },
                {
                  code: 'EGR24',
                  name: 'Paint Robot 3',
                  machineRef: 'M-027',
                  children: [],
                },
                {
                  code: 'EGR25',
                  name: 'Paint Robot 4',
                  machineRef: 'M-028',
                  children: [],
                },
              ],
            },

            /* Unit: Curing & Drying */
            {
              code: 'CUR01',
              name: 'Curing & Drying Unit',
              children: [
                {
                  code: 'EGR26',
                  name: 'Curing Oven 5',
                  machineRef: 'M-029',
                  children: [
                    {
                      code: 'HET1001',
                      name: 'Heating Element Bank',
                      children: [
                        { code: '2003445687', name: 'Heating Rod – Zone A' },
                        { code: '2003445688', name: 'Heating Rod – Zone B' },
                      ],
                    },
                  ],
                },
                {
                  code: 'EGR27',
                  name: 'Dryer Unit 6',
                  machineRef: 'M-030',
                  children: [],
                },
              ],
            },
          ],
        },
      ],
    },

    /* ── Area: UTL – Utilities & Support ─────────────────────────────────── */
    {
      code: 'UTL',
      name: 'Utilities & Support',
      tags: [
        'energy.totalUsage',
        'energy.consumption',
        'energy.batteryLevel',
      ],
      children: [

        /* Line: Energy Infrastructure */
        {
          code: 'ENI01',
          name: 'Energy Infrastructure Line',
          children: [

            /* Unit: HVAC Systems */
            {
              code: 'HVC01',
              name: 'HVAC Systems Unit',
              children: [
                {
                  code: 'EGR28',
                  name: 'HVAC System A',
                  machineRef: 'M-051',
                  tags: ['zone.office.energy'],
                  children: [
                    {
                      code: 'CMP1001',
                      name: 'Compressor Module A',
                      children: [
                        { code: '2003445689', name: 'Compressor Scroll Element' },
                      ],
                    },
                  ],
                },
                {
                  code: 'EGR29',
                  name: 'HVAC System B',
                  machineRef: 'M-052',
                  children: [],
                },
              ],
            },

            /* Unit: Compressed Air & Utilities */
            {
              code: 'CAU01',
              name: 'Compressed Air Unit',
              children: [
                {
                  code: 'EGR30',
                  name: 'Compressor 1',
                  machineRef: 'M-053',
                  children: [
                    {
                      code: 'AIR1001',
                      name: 'Air End Assembly',
                      children: [
                        { code: '2003445690', name: 'Air End Rotor Bearing' },
                      ],
                    },
                  ],
                },
                {
                  code: 'EGR31',
                  name: 'Compressor 2',
                  machineRef: 'M-054',
                  children: [],
                },
                {
                  code: 'EGR32',
                  name: 'Chiller Unit',
                  machineRef: 'M-055',
                  children: [
                    {
                      code: 'CHI1001',
                      name: 'Chiller Evaporator',
                      children: [
                        { code: '2003445691', name: 'Evaporator Tube Bundle' },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },

        /* Line: Logistics & Shipping */
        {
          code: 'LOG01',
          name: 'Logistics & Shipping Line',
          tags: ['zone.warehouse.energy', 'zone.shipping.energy'],
          children: [

            /* Unit: Warehouse Automation */
            {
              code: 'WAR01',
              name: 'Warehouse Automation Unit',
              children: [
                {
                  code: 'EGR33',
                  name: 'AGV 1',
                  machineRef: 'M-036',
                  children: [],
                },
                {
                  code: 'EGR34',
                  name: 'AGV 2',
                  machineRef: 'M-037',
                  children: [],
                },
                {
                  code: 'EGR35',
                  name: 'Conveyor C1',
                  machineRef: 'M-038',
                  children: [
                    {
                      code: 'DRV1001',
                      name: 'Conveyor Drive Assembly',
                      children: [
                        { code: '2003445692', name: 'Drive Gearbox' },
                        { code: '2003445693', name: 'Head Pulley Bearing' },
                      ],
                    },
                  ],
                },
                {
                  code: 'EGR36',
                  name: 'Stacker S1',
                  machineRef: 'M-040',
                  children: [],
                },
              ],
            },

            /* Unit: Shipping Dock Equipment */
            {
              code: 'DKE01',
              name: 'Shipping Dock Equipment',
              children: [
                {
                  code: 'EGR37',
                  name: 'Dock Lift 1',
                  machineRef: 'M-046',
                  children: [],
                },
                {
                  code: 'EGR38',
                  name: 'Palletizer 3',
                  machineRef: 'M-048',
                  children: [],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
});
