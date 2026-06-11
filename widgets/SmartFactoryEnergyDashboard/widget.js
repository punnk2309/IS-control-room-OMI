// AVEVA OMI Custom Widget — SmartFactoryEnergyDashboard v1.0.0
// Skills used: cwp-scaffolder, figma-to-cwp, cwp-manifest-builder, cwp-dev-workflow

(function () {
  'use strict';

  // ── Chart.js default overrides for OMI dark theme ────────────────────────
  Chart.defaults.color = '#8892b0';
  Chart.defaults.borderColor = '#3a4260';
  Chart.defaults.font.family = "'Segoe UI', system-ui, sans-serif";
  Chart.defaults.font.size = 10;

  // ── State: tag name bindings (default values = manifest defaults) ─────────
  const state = {
    tags: {
      productionRateTag:    'Factory.Production.Rate',
      efficiencyTag:        'Factory.Production.Efficiency',
      downtimeTag:          'Factory.Production.Downtime',
      energyUsageTag:       'Factory.Energy.TotalUsage',
      solarProductionTag:   'Factory.Energy.SolarProduction',
      batteryStorageTag:    'Factory.Energy.BatteryLevel',
      gridUsageTag:         'Factory.Energy.GridUsage',
      totalConsumptionTag:  'Factory.Energy.TotalConsumption',
      machineRunningTag:    'Factory.Machines.Running',
      machineIdleTag:       'Factory.Machines.Idle',
      machineMaintTag:      'Factory.Machines.Maintenance',
      machineErrorTag:      'Factory.Machines.Error',
    },
    values: {
      productionRate: 2847,
      efficiency: 94.2,
      downtime: 1.8,
      energyUsage: 847.2,
      solar: 156,
      battery: 78,
      grid: 45,
      consumption: 187,
      running: 42,
      idle: 8,
      maint: 3,
      error: 2,
    }
  };

  // ── Chart instances ───────────────────────────────────────────────────────
  const charts = {};

  // ── Static demo data ──────────────────────────────────────────────────────
  const productionHistory = [240, 180, 320, 380, 420, 360, 290, 310, 350, 400, 380, 340];
  const energyHistory     = [420, 380, 350, 520, 680, 750, 820, 790, 720, 650, 580, 480];
  const timeLabels12h     = ['00:00','02:00','04:00','06:00','08:00','10:00','12:00','14:00','16:00','18:00','20:00','22:00'];

  // ── Chart.js dark theme helper ────────────────────────────────────────────
  function darkTooltip() {
    return {
      plugins: {
        tooltip: {
          backgroundColor: '#242a3d',
          borderColor: '#3a4260',
          borderWidth: 1,
          titleColor: '#e8eaf6',
          bodyColor: '#a9b1d6',
          padding: 8,
        },
        legend: { display: false }
      }
    };
  }

  function darkScales(yLabel) {
    return {
      scales: {
        x: {
          grid: { color: '#2d3452' },
          ticks: { color: '#8892b0' },
          border: { display: false }
        },
        y: {
          grid: { color: '#2d3452' },
          ticks: { color: '#8892b0' },
          border: { display: false },
          title: yLabel ? { display: true, text: yLabel, color: '#8892b0', font: { size: 10 } } : undefined
        }
      }
    };
  }

  // ── Initialise all Chart.js instances ────────────────────────────────────
  function initCharts() {
    // 1. Production line chart (Overview)
    const ctxProd = document.getElementById('chart-production');
    if (ctxProd) {
      charts.production = new Chart(ctxProd, {
        type: 'line',
        data: {
          labels: timeLabels12h,
          datasets: [{
            data: productionHistory,
            borderColor: '#64ffda',
            backgroundColor: 'rgba(100,255,218,0.07)',
            borderWidth: 2,
            pointRadius: 3,
            pointBackgroundColor: '#64ffda',
            tension: 0.4,
            fill: true
          }]
        },
        options: {
          animation: false,
          responsive: true,
          maintainAspectRatio: false,
          ...darkTooltip(),
          ...darkScales('units/hr')
        }
      });
    }

    // 2. Machine status donut (Overview)
    const ctxDonut = document.getElementById('chart-machine-donut');
    if (ctxDonut) {
      charts.donut = new Chart(ctxDonut, {
        type: 'doughnut',
        data: {
          labels: ['Running', 'Idle', 'Maintenance', 'Error'],
          datasets: [{
            data: [42, 8, 3, 2],
            backgroundColor: ['#64ffda','#ffcb6b','#82aaff','#ff5370'],
            borderWidth: 0,
            hoverOffset: 4
          }]
        },
        options: {
          animation: false,
          responsive: true,
          maintainAspectRatio: false,
          cutout: '65%',
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: '#242a3d',
              borderColor: '#3a4260',
              borderWidth: 1,
              titleColor: '#e8eaf6',
              bodyColor: '#a9b1d6'
            }
          }
        }
      });
    }

    // 3. Real-time energy area chart (Energy screen)
    const ctxEnergy = document.getElementById('chart-energy-area');
    if (ctxEnergy) {
      charts.energyArea = new Chart(ctxEnergy, {
        type: 'line',
        data: {
          labels: timeLabels12h,
          datasets: [{
            data: energyHistory,
            borderColor: '#82aaff',
            backgroundColor: 'rgba(130,170,255,0.10)',
            borderWidth: 2,
            pointRadius: 0,
            tension: 0.4,
            fill: true
          }]
        },
        options: {
          animation: false,
          responsive: true,
          maintainAspectRatio: false,
          ...darkTooltip(),
          ...darkScales('kW')
        }
      });
    }

    // 4. Zone bar chart (Energy screen)
    const ctxZone = document.getElementById('chart-zone-bar');
    if (ctxZone) {
      charts.zoneBar = new Chart(ctxZone, {
        type: 'bar',
        data: {
          labels: ['Assembly','Welding','Painting','Quality','Warehouse','Admin'],
          datasets: [
            {
              label: 'Actual',
              data: [285, 195, 152, 98, 67, 50],
              backgroundColor: '#64ffda',
              borderRadius: 4,
              borderWidth: 0
            },
            {
              label: 'Target',
              data: [250, 200, 150, 100, 80, 45],
              backgroundColor: 'rgba(58,66,96,0.6)',
              borderRadius: 4,
              borderWidth: 0
            }
          ]
        },
        options: {
          animation: false,
          responsive: true,
          maintainAspectRatio: false,
          ...darkTooltip(),
          ...darkScales('kWh'),
          plugins: {
            ...darkTooltip().plugins,
            legend: { display: false }
          }
        }
      });
    }

    // 5. Analytics — production trend
    const ctxAP = document.getElementById('chart-analytics-production');
    if (ctxAP) {
      charts.analProd = new Chart(ctxAP, {
        type: 'line',
        data: {
          labels: ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'],
          datasets: [{
            data: [2600, 2780, 2850, 2700, 2847, 2920, 2800],
            borderColor: '#64ffda',
            backgroundColor: 'rgba(100,255,218,0.07)',
            borderWidth: 2,
            pointRadius: 3,
            pointBackgroundColor: '#64ffda',
            tension: 0.4,
            fill: true
          }]
        },
        options: { animation: false, responsive: true, maintainAspectRatio: false, ...darkTooltip(), ...darkScales('units/hr') }
      });
    }

    // 6. Analytics — energy trend
    const ctxAE = document.getElementById('chart-analytics-energy');
    if (ctxAE) {
      charts.analEnergy = new Chart(ctxAE, {
        type: 'line',
        data: {
          labels: ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'],
          datasets: [{
            data: [910, 880, 855, 870, 847, 820, 840],
            borderColor: '#82aaff',
            backgroundColor: 'rgba(130,170,255,0.08)',
            borderWidth: 2,
            pointRadius: 3,
            pointBackgroundColor: '#82aaff',
            tension: 0.4,
            fill: true
          }]
        },
        options: { animation: false, responsive: true, maintainAspectRatio: false, ...darkTooltip(), ...darkScales('kWh') }
      });
    }

    // 7. Analytics — efficiency trend
    const ctxAEf = document.getElementById('chart-analytics-efficiency');
    if (ctxAEf) {
      charts.analEff = new Chart(ctxAEf, {
        type: 'line',
        data: {
          labels: ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'],
          datasets: [{
            data: [91, 92.5, 93, 91.8, 94.2, 95, 93.5],
            borderColor: '#ffcb6b',
            backgroundColor: 'rgba(255,203,107,0.07)',
            borderWidth: 2,
            pointRadius: 3,
            pointBackgroundColor: '#ffcb6b',
            tension: 0.4,
            fill: true
          }]
        },
        options: { animation: false, responsive: true, maintainAspectRatio: false, ...darkTooltip(), ...darkScales('%') }
      });
    }

    // 8. Analytics — energy mix (stacked area)
    const ctxAM = document.getElementById('chart-analytics-mix');
    if (ctxAM) {
      charts.analMix = new Chart(ctxAM, {
        type: 'line',
        data: {
          labels: Array.from({length:30},(_,i)=>`Day ${i+1}`),
          datasets: [
            { label: 'Solar',   data: Array.from({length:30},()=>120+Math.random()*60), borderColor: '#ff9100', backgroundColor: 'rgba(255,145,0,0.2)',   borderWidth:1.5, pointRadius:0, fill:true, tension:0.4 },
            { label: 'Battery', data: Array.from({length:30},()=>40+Math.random()*40),  borderColor: '#64ffda', backgroundColor: 'rgba(100,255,218,0.15)', borderWidth:1.5, pointRadius:0, fill:true, tension:0.4 },
            { label: 'Grid',    data: Array.from({length:30},()=>20+Math.random()*30),  borderColor: '#82aaff', backgroundColor: 'rgba(130,170,255,0.12)', borderWidth:1.5, pointRadius:0, fill:true, tension:0.4 }
          ]
        },
        options: {
          animation: false, responsive: true, maintainAspectRatio: false,
          ...darkScales('kW'),
          plugins: {
            ...darkTooltip().plugins,
            legend: { display: true, position: 'bottom', labels: { color: '#8892b0', boxWidth: 10, font: { size: 10 } } }
          }
        }
      });
    }

    // 9. Analytics — downtime by zone (horizontal bar)
    const ctxAD = document.getElementById('chart-analytics-downtime');
    if (ctxAD) {
      charts.analDown = new Chart(ctxAD, {
        type: 'bar',
        data: {
          labels: ['Assembly','Welding','Paint','Quality','Warehouse','Admin'],
          datasets: [{
            data: [4.2, 1.8, 0.9, 2.1, 0.5, 0.3],
            backgroundColor: ['#ff5370','#ff5370','#ffcb6b','#ffcb6b','#82aaff','#64ffda'],
            borderRadius: 4,
            borderWidth: 0
          }]
        },
        options: {
          indexAxis: 'y',
          animation: false, responsive: true, maintainAspectRatio: false,
          ...darkTooltip(),
          ...darkScales('hours'),
          plugins: { ...darkTooltip().plugins, legend: { display: false } }
        }
      });
    }
  }

  // ── Build machine grid ────────────────────────────────────────────────────
  function buildMachineGrid() {
    const grid = document.getElementById('machine-grid');
    if (!grid) return;

    const machines = [
      ...Array.from({length:42}, (_,i) => ({ id:`M${String(i+1).padStart(2,'0')}`, zone: ['Assembly','Welding','Paint','Quality'][i%4], state:'running' })),
      ...Array.from({length:8},  (_,i) => ({ id:`M${String(43+i).padStart(2,'0')}`, zone: ['Assembly','Warehouse','Admin'][i%3], state:'idle' })),
      ...Array.from({length:3},  (_,i) => ({ id:`M${String(51+i).padStart(2,'0')}`, zone:'Maintenance', state:'maint' })),
      ...Array.from({length:2},  (_,i) => ({ id:`M${String(54+i).padStart(2,'0')}`, zone:'Assembly', state:'error' }))
    ];

    grid.innerHTML = machines.map(m => `
      <div class="machine-card ${m.state}">
        <div class="machine-name">${m.id}</div>
        <div class="machine-state ${m.state}">${m.state.toUpperCase()}</div>
        <div style="font-size:10px;color:var(--text-disabled);margin-top:2px">${m.zone}</div>
      </div>
    `).join('');
  }

  // ── Update DOM from state.values ──────────────────────────────────────────
  function updateUI() {
    const v = state.values;

    // Overview KPIs
    setText('kpi-production', v.productionRate.toLocaleString());
    setText('kpi-efficiency', v.efficiency.toFixed(1));
    setText('kpi-downtime', v.downtime.toFixed(1));
    setText('kpi-energy', v.energyUsage.toFixed(1));

    // Energy screen KPIs
    setText('kpi-energy-total', v.energyUsage.toFixed(1));

    // Energy flow
    setText('flow-solar', v.solar);
    setText('flow-battery', v.battery + '%');
    setText('flow-battery-kwh', Math.round(500 * v.battery / 100) + ' kWh');
    setText('flow-grid', v.grid);
    setText('flow-consume', v.consumption);
    setText('battery-pct-label', v.battery + '%');
    setStyle('battery-bar', 'width', v.battery + '%');

    // Machines screen
    setText('m-running', v.running);
    setText('m-idle', v.idle);
    setText('m-maint', v.maint);
    setText('m-error', v.error);

    const total = v.running + v.idle + v.maint + v.error;
    setText('machine-total', total + ' Total Machines');
    setText('legend-running', 'Running: ' + v.running);
    setText('legend-idle',    'Idle: '    + v.idle);
    setText('legend-maint',   'Maint: '   + v.maint);
    setText('legend-error',   'Error: '   + v.error);

    // Update donut chart data
    if (charts.donut) {
      charts.donut.data.datasets[0].data = [v.running, v.idle, v.maint, v.error];
      charts.donut.update('none');
    }

    // Append latest energy value to real-time chart
    if (charts.energyArea && charts.energyArea.data.labels.length >= 60) {
      charts.energyArea.data.labels.shift();
      charts.energyArea.data.datasets[0].data.shift();
    }
  }

  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  function setStyle(id, prop, value) {
    const el = document.getElementById(id);
    if (el) el.style[prop] = value;
  }

  // ── Tab navigation ────────────────────────────────────────────────────────
  function initTabs() {
    document.querySelectorAll('.tab-btn[data-screen]').forEach(btn => {
      btn.addEventListener('click', () => {
        const target = btn.dataset.screen;
        document.querySelectorAll('.tab-btn[data-screen]').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        btn.classList.add('active');
        const screen = document.getElementById('screen-' + target);
        if (screen) screen.classList.add('active');

        // Trigger chart resize after screen becomes visible
        setTimeout(() => {
          Object.values(charts).forEach(c => c.resize && c.resize());
        }, 50);
      });
    });
  }

  // ── Live clock ────────────────────────────────────────────────────────────
  function startClock() {
    function tick() {
      const now = new Date();
      setText('clock-date', now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }));
      setText('clock-time', now.toLocaleTimeString('en-US', { hour12: false }));
    }
    tick();
    setInterval(tick, 1000);
  }

  // ── OMI postMessage Integration ───────────────────────────────────────────
  // Tag name → state.values key mapping
  const tagToKey = {};

  function buildTagMap(properties) {
    const map = {
      productionRateTag:   'productionRate',
      efficiencyTag:       'efficiency',
      downtimeTag:         'downtime',
      energyUsageTag:      'energyUsage',
      solarProductionTag:  'solar',
      batteryStorageTag:   'battery',
      gridUsageTag:        'grid',
      totalConsumptionTag: 'consumption',
      machineRunningTag:   'running',
      machineIdleTag:      'idle',
      machineMaintTag:     'maint',
      machineErrorTag:     'error',
    };

    Object.entries(map).forEach(([propKey, valueKey]) => {
      const tagName = properties[propKey] || state.tags[propKey];
      state.tags[propKey] = tagName;
      tagToKey[tagName] = valueKey;
    });

    if (properties.widgetTitle) {
      setText('widget-title', properties.widgetTitle);
    }
  }

  function subscribeAllTags() {
    Object.values(state.tags).forEach(tagName => {
      window.parent.postMessage({ type: 'omi:subscribe', tagName }, '*');
    });
  }

  function handleInit(properties) {
    buildTagMap(properties);
    subscribeAllTags();
    updateUI();
  }

  function handleTagValue(tagName, value, quality) {
    const key = tagToKey[tagName];
    if (!key) return;

    const parsed = parseFloat(value);
    if (!isNaN(parsed)) state.values[key] = parsed;

    updateUI();

    // Push real-time energy value to area chart
    if (key === 'energyUsage' && charts.energyArea) {
      const now = new Date().toLocaleTimeString('en-US', { hour12: false, hour:'2-digit', minute:'2-digit' });
      charts.energyArea.data.labels.push(now);
      charts.energyArea.data.datasets[0].data.push(parsed);
      if (charts.energyArea.data.labels.length > 60) {
        charts.energyArea.data.labels.shift();
        charts.energyArea.data.datasets[0].data.shift();
      }
      charts.energyArea.update('none');

      setText('energy-current', parsed.toFixed(0));
      const data = charts.energyArea.data.datasets[0].data;
      const avg = (data.reduce((a,b)=>a+b,0)/data.length).toFixed(0);
      setText('energy-avg', avg);
    }
  }

  function handlePropertyChange(name, value) {
    if (name === 'widgetTitle') {
      setText('widget-title', value);
      return;
    }
    // Re-map tag and subscribe to new tag
    const map = {
      productionRateTag:'productionRate', efficiencyTag:'efficiency', downtimeTag:'downtime',
      energyUsageTag:'energyUsage', solarProductionTag:'solar', batteryStorageTag:'battery',
      gridUsageTag:'grid', totalConsumptionTag:'consumption', machineRunningTag:'running',
      machineIdleTag:'idle', machineMaintTag:'maint', machineErrorTag:'error'
    };
    if (map[name]) {
      const oldTag = state.tags[name];
      window.parent.postMessage({ type: 'omi:unsubscribe', tagName: oldTag }, '*');
      state.tags[name] = value;
      tagToKey[value] = map[name];
      window.parent.postMessage({ type: 'omi:subscribe', tagName: value }, '*');
    }
  }

  function handleResize(width, height) {
    setTimeout(() => Object.values(charts).forEach(c => c.resize && c.resize()), 50);
  }

  // ── Full OMI event listener ───────────────────────────────────────────────
  window.addEventListener('message', function (event) {
    if (!event.data || !event.data.type) return;

    switch (event.data.type) {
      case 'omi:init':
        handleInit(event.data.properties || {});
        break;
      case 'omi:tagValue':
        handleTagValue(event.data.tagName, event.data.value, event.data.quality);
        break;
      case 'omi:propertyChanged':
        handlePropertyChange(event.data.name, event.data.value);
        break;
      case 'omi:resize':
        handleResize(event.data.width, event.data.height);
        break;
      case 'omi:modeChanged':
        // In design mode, keep charts visible with demo data
        break;
    }
  });

  // ── Dev-mode mock (from cwp-dev-workflow.skill) ───────────────────────────
  // Detects no OMI host — fires synthetic events with rolling demo data
  if (!window.parent || window.parent === window) {
    setTimeout(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: {
          type: 'omi:init',
          properties: {
            widgetTitle:         'Smart Factory Energy Dashboard',
            productionRateTag:   'Factory.Production.Rate',
            efficiencyTag:       'Factory.Production.Efficiency',
            downtimeTag:         'Factory.Production.Downtime',
            energyUsageTag:      'Factory.Energy.TotalUsage',
            solarProductionTag:  'Factory.Energy.SolarProduction',
            batteryStorageTag:   'Factory.Energy.BatteryLevel',
            gridUsageTag:        'Factory.Energy.GridUsage',
            totalConsumptionTag: 'Factory.Energy.TotalConsumption',
            machineRunningTag:   'Factory.Machines.Running',
            machineIdleTag:      'Factory.Machines.Idle',
            machineMaintTag:     'Factory.Machines.Maintenance',
            machineErrorTag:     'Factory.Machines.Error',
          }
        }
      }));
    }, 300);

    // Simulate live tag updates every 2 seconds
    setInterval(() => {
      const mockUpdates = [
        { tagName: 'Factory.Production.Rate',    value: 2700 + Math.random() * 300, quality: 'Good' },
        { tagName: 'Factory.Production.Efficiency', value: 90 + Math.random() * 8,   quality: 'Good' },
        { tagName: 'Factory.Production.Downtime',   value: 1 + Math.random() * 2,    quality: 'Good' },
        { tagName: 'Factory.Energy.TotalUsage',     value: 800 + Math.random() * 100, quality: 'Good' },
        { tagName: 'Factory.Energy.SolarProduction',value: 130 + Math.random() * 50,  quality: 'Good' },
        { tagName: 'Factory.Energy.BatteryLevel',   value: 65 + Math.random() * 20,   quality: 'Good' },
        { tagName: 'Factory.Energy.GridUsage',      value: 30 + Math.random() * 30,   quality: 'Good' },
        { tagName: 'Factory.Energy.TotalConsumption',value: 160 + Math.random() * 40, quality: 'Good' },
        { tagName: 'Factory.Machines.Running',      value: 40 + Math.floor(Math.random() * 4), quality: 'Good' },
        { tagName: 'Factory.Machines.Idle',         value: 6 + Math.floor(Math.random() * 4),  quality: 'Good' },
        { tagName: 'Factory.Machines.Maintenance',  value: 2 + Math.floor(Math.random() * 2),  quality: 'Good' },
        { tagName: 'Factory.Machines.Error',        value: Math.floor(Math.random() * 3),       quality: 'Good' },
      ];

      mockUpdates.forEach(upd => {
        window.dispatchEvent(new MessageEvent('message', {
          data: { type: 'omi:tagValue', ...upd }
        }));
      });
    }, 2000);
  }

  // ── Bootstrap ─────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', function () {
    startClock();
    initTabs();
    initCharts();
    buildMachineGrid();

    // Build initial tagToKey map from defaults
    buildTagMap({});
    updateUI();

    // Signal ready to OMI host
    window.parent.postMessage({ type: 'omi:ready' }, '*');
  });

}());
