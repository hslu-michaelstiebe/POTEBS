// -------------------------------------------------------------------------
    // Deferred vendor loading
    // -------------------------------------------------------------------------
    const VENDOR = {
      leafletCss: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css',
      leafletJs: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js',
      leafletHeatJs: 'https://unpkg.com/leaflet.heat@0.2.0/dist/leaflet-heat.js',
      echartsJs: 'https://cdnjs.cloudflare.com/ajax/libs/echarts/5.5.0/echarts.min.js'
    };

    const deferredLoads = new Map();

    function loadCssOnce(href) {
      if (document.querySelector(`link[href="${href}"]`)) return Promise.resolve();
      if (deferredLoads.has(href)) return deferredLoads.get(href);
      const promise = new Promise((resolve, reject) => {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = href;
        link.onload = resolve;
        link.onerror = reject;
        document.head.appendChild(link);
      });
      deferredLoads.set(href, promise);
      return promise;
    }

    function loadScriptOnce(src, isReady) {
      if (isReady()) return Promise.resolve();
      if (deferredLoads.has(src)) return deferredLoads.get(src);
      const existing = document.querySelector(`script[src="${src}"]`);
      if (existing) {
        const promise = new Promise((resolve, reject) => {
          const started = performance.now();
          const check = () => {
            if (isReady()) resolve();
            else if (performance.now() - started > 12000) reject(new Error(`Timed out loading ${src}`));
            else window.setTimeout(check, 40);
          };
          check();
        });
        deferredLoads.set(src, promise);
        return promise;
      }
      const promise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.async = true;
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
      });
      deferredLoads.set(src, promise.then(() => {
        if (!isReady()) throw new Error(`Vendor did not initialize: ${src}`);
      }));
      return deferredLoads.get(src);
    }

    function ensureEcharts() {
      return loadScriptOnce(VENDOR.echartsJs, () => Boolean(window.echarts));
    }

    async function ensureLeaflet() {
      await Promise.all([
        loadCssOnce(VENDOR.leafletCss),
        loadScriptOnce(VENDOR.leafletJs, () => Boolean(window.L))
      ]);
    }

    async function ensureLeafletHeat() {
      await ensureLeaflet();
      await loadScriptOnce(VENDOR.leafletHeatJs, () => Boolean(window.L && window.L.heatLayer));
    }

    function runWhenVisible(target, init, options = {}) {
      if (!target) return;
      let started = false;
      const run = () => {
        if (started) return;
        started = true;
        Promise.resolve(init()).catch(err => console.error(err));
      };
      if (!('IntersectionObserver' in window)) {
        window.setTimeout(run, options.fallbackDelay || 800);
        return;
      }
      const observer = new IntersectionObserver(entries => {
        if (entries.some(entry => entry.isIntersecting)) {
          observer.disconnect();
          run();
        }
      }, {
        rootMargin: options.rootMargin || '220px 0px',
        threshold: options.threshold || 0.01
      });
      observer.observe(target);
    }

    // -------------------------------------------------------------------------
    // Lorenz Charts (ECharts) — loaded from data/lorenz.json
    // -------------------------------------------------------------------------
    const PANEL_MAP = [
      { id: 'lc-all-trips',       key: 'all_users_rentals'    },
      { id: 'lc-all-duration',    key: 'all_users_minutes'    },
      { id: 'lc-survey-trips',    key: 'survey_users_rentals' },
      { id: 'lc-survey-duration', key: 'survey_users_minutes' }
    ];

    const PROVIDER_CFG = {
      Combined: { label: 'Combined',            color: '#0a0a0a', width: 2.5 },
      FFEBSS:   { label: 'Pick-e-Bike',         color: '#c5402b', width: 2   },
      DBEBSS:   { label: 'PubliBike Velospot',  color: '#2864b4', width: 2   }
    };

    function zip(xs, ys) { return xs.map((x, i) => [x, ys[i]]); }

    function makeLorenzOption(panel) {
      const providers = panel.providers;
      const yLabel = panel.y_axis_label || 'Cumulative %';
      const giniText = Object.entries(PROVIDER_CFG)
        .map(([k, cfg]) => `${cfg.label}: ${(providers[k]?.gini ?? 0).toFixed(3)}`)
        .join('   ');

      const axisFont = { fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: '#5a564e' };
      const axisLine = { lineStyle: { color: '#0a0a0a' } };
      const splitLine = { lineStyle: { color: '#d8d3c6' } };

      const series = [
        { name: 'Perfect equality', type: 'line', data: [[0, 0], [100, 100]], symbol: 'none',
          lineStyle: { color: '#999', width: 1, type: 'dashed' }, emphasis: { disabled: true } },
        ...Object.entries(PROVIDER_CFG).map(([providerKey, cfg]) => {
          const d = providers[providerKey];
          return {
            name: cfg.label, type: 'line',
            data: d ? zip(d.x, d.y) : [],
            symbol: 'none',
            lineStyle: { color: cfg.color, width: cfg.width },
            emphasis: { disabled: true }
          };
        })
      ];

      return {
        backgroundColor: 'transparent',
        grid: { top: 32, right: 16, bottom: 48, left: 52, containLabel: false },
        xAxis: {
          type: 'value', min: 0, max: 100,
          name: 'Cumulative % of users', nameLocation: 'middle', nameGap: 30,
          nameTextStyle: axisFont,
          axisLabel: { ...axisFont, formatter: v => v + '%' },
          axisLine, splitLine
        },
        yAxis: {
          type: 'value', min: 0, max: 100,
          name: yLabel, nameLocation: 'middle', nameGap: 42,
          nameTextStyle: axisFont,
          axisLabel: { ...axisFont, formatter: v => v + '%' },
          axisLine, splitLine
        },
        tooltip: {
          trigger: 'axis',
          axisPointer: { type: 'cross', label: { show: false } },
          backgroundColor: '#ffffff',
          borderColor: '#0a0a0a', borderWidth: 1,
          textStyle: { color: '#0a0a0a', fontSize: 12, fontFamily: 'Space Grotesk, sans-serif' },
          formatter(params) {
            const pop = params[0]?.data[0];
            let html = `<div style="font-weight:700;margin-bottom:4px;font-family:JetBrains Mono,monospace;font-size:10px;text-transform:uppercase;letter-spacing:.08em">Bottom ${pop?.toFixed(1)}% of users</div>`;
            params.forEach(p => {
              if (p.seriesName === 'Perfect equality') return;
              const cfg = Object.values(PROVIDER_CFG).find(c => c.label === p.seriesName);
              html += `<div style="display:flex;align-items:center;gap:6px;margin:2px 0">
                <span style="display:inline-block;width:10px;height:3px;background:${cfg?.color}"></span>
                <span>${p.seriesName}: <b>${p.data[1]?.toFixed(1)}%</b></span>
              </div>`;
            });
            html += `<div style="margin-top:6px;padding-top:5px;border-top:1px solid #d8d3c6;font-size:10.5px;color:#5a564e;font-family:JetBrains Mono,monospace">Gini — ${giniText}</div>`;
            return html;
          }
        },
        legend: {
          data: ['Combined', 'Pick-e-Bike', 'PubliBike Velospot', 'Perfect equality'],
          top: 4, right: 0,
          itemWidth: 18, itemHeight: 3,
          textStyle: { color: '#5a564e', fontSize: 10, fontFamily: 'JetBrains Mono, monospace' }
        },
        series
      };
    }

    runWhenVisible(document.getElementById('lorenzGrid'), async function initLorenzCharts() {
      try {
        await ensureEcharts();
        const lorenz = await fetch('data/lorenz.json').then(r => r.json());
        // NOTE: the static HTML values for #stat-trips, #stat-gini and #stat-linked
        // are the canonical figures from the TR-D manuscript (1.4M trips / 1,743
        // linked cases / Gini 0.77). The lorenz.json snapshot uses a different
        // cutoff and would otherwise drift the displayed numbers, so we no longer
        // overwrite those DOM elements here. The Lorenz panels themselves still
        // render below from the same data file.
        PANEL_MAP.forEach(({ id, key }) => {
          const el = document.getElementById(id);
          if (!el) return;
          const panel = lorenz.panels[key];
          if (!panel) return;
          const chart = echarts.init(el, null, { renderer: 'svg' });
          chart.setOption(makeLorenzOption(panel));
          window.addEventListener('resize', () => chart.resize());
        });
      } catch (err) {
        console.error(err);
        PANEL_MAP.forEach(({ id }) => {
          const el = document.getElementById(id);
          if (el) el.innerHTML = `
            <div class="lorenz-placeholder">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 3v18h18"/><path d="M7 16l4-4 4 4 4-8"/></svg>
              <span>Lorenz data not yet available.<br>Upload <code>data/lorenz.json</code> to the repository.</span>
            </div>`;
        });
      }
    });

    // -------------------------------------------------------------------------
    // SANKEY — Mode substitution (Finding V)
    // Source: Table 3 of the TR-D manuscript. Flow widths are user counts:
    // share who substitute the mode at least sometimes × provider user base.
    // Car flows are computed against full provider sample; the * footnote in
    // Table 3 (subsample with car access) is acknowledged in the caption.
    // -------------------------------------------------------------------------
    runWhenVisible(document.getElementById('sankey-substitution'), async function initSankey() {
      const el = document.getElementById('sankey-substitution');
      if (!el) return;
      await ensureEcharts();

      // From Table 3 of the manuscript
      const PEB = { name: 'Pick-e-Bike (FFEBSS)', n: 1309, pt: 0.763, walk: 0.490, car: 0.364 };
      const PB  = { name: 'PubliBike (DBEBSS)',   n: 434,  pt: 0.726, walk: 0.571, car: 0.220 };
      const v = (p, u) => Math.round(p.n * p[u]);

      const chart = echarts.init(el, null, { renderer: 'svg' });

      const COL = {
        peb:  '#c5402b',
        pb:   '#2864b4',
        pt:   '#2864b4',
        walk: '#7a756c',
        car:  '#c5402b'
      };

      chart.setOption({
        backgroundColor: 'transparent',
        tooltip: {
          trigger: 'item',
          backgroundColor: '#0a0a0a',
          borderColor: '#0a0a0a',
          textStyle: { color: '#f4f2ec', fontFamily: 'JetBrains Mono, monospace', fontSize: 11 },
          formatter: function (p) {
            if (p.dataType === 'edge') {
              return `${p.data.source} → ${p.data.target}<br/><b>${p.data.value.toLocaleString()} users</b>`;
            }
            return `<b>${p.name}</b>`;
          }
        },
        series: [{
          type: 'sankey',
          left: 4, right: 140, top: 8, bottom: 8,
          nodeGap: 16,
          nodeWidth: 12,
          layoutIterations: 32,
          emphasis: { focus: 'adjacency' },
          lineStyle: { color: 'gradient', curveness: 0.5, opacity: 0.6 },
          label: {
            fontFamily: 'Space Grotesk, Inter, sans-serif',
            fontSize: 11,
            fontWeight: 600,
            color: '#0a0a0a',
            overflow: 'none'
          },
          data: [
            { name: PEB.name,             itemStyle: { color: COL.peb,  borderColor: '#0a0a0a' } },
            { name: PB.name,              itemStyle: { color: COL.pb,   borderColor: '#0a0a0a' } },
            { name: 'Substitutes PT',     itemStyle: { color: COL.pt,   borderColor: '#0a0a0a' } },
            { name: 'Substitutes Walking',itemStyle: { color: COL.walk, borderColor: '#0a0a0a' } },
            { name: 'Substitutes Car*',   itemStyle: { color: COL.car,  borderColor: '#0a0a0a' } }
          ],
          links: [
            { source: PEB.name, target: 'Substitutes PT',      value: v(PEB, 'pt')   },
            { source: PEB.name, target: 'Substitutes Walking', value: v(PEB, 'walk') },
            { source: PEB.name, target: 'Substitutes Car*',    value: v(PEB, 'car')  },
            { source: PB.name,  target: 'Substitutes PT',      value: v(PB,  'pt')   },
            { source: PB.name,  target: 'Substitutes Walking', value: v(PB,  'walk') },
            { source: PB.name,  target: 'Substitutes Car*',    value: v(PB,  'car')  }
          ]
        }]
      });
      window.addEventListener('resize', () => chart.resize());
    });

    // -------------------------------------------------------------------------
    // FOREST PLOT — MNL effect sizes (high-intensity vs low-intensity)
    // Point estimates and 95% CIs from the manuscript narrative; CIs computed
    // exp(β ± 1.96·SE) where SEs are reported. Predictors without published SE
    // appear as point estimates only.
    // -------------------------------------------------------------------------
    runWhenVisible(document.getElementById('forest-plot'), async function initForestPlot() {
      const el = document.getElementById('forest-plot');
      if (!el) return;
      await ensureEcharts();

      const COL = {
        behavioral:  '#0a0a0a',
        attitudinal: '#e5372b',
        mobility:    '#2864b4',
        demographic: '#7a756c'
      };

      // Each row: { name, group, rrr, ci_lo, ci_hi (null if no SE), p, sig }
      const rows = [
        { name: 'Multimodal complementarity (revealed)',  group: 'behavioral',  rrr: 1.64, ci_lo: 1.35, ci_hi: 1.99, sig: '***' },
        { name: 'Temperature variance (revealed)',         group: 'behavioral',  rrr: 1.40, ci_lo: 1.17, ci_hi: 1.68, sig: '***' },
        { name: 'Functional superiority over PT (DBEBSS)', group: 'attitudinal', rrr: 1.74, ci_lo: null, ci_hi: null, sig: '*'   },
        { name: 'Education (standardized)',                group: 'demographic', rrr: 1.23, ci_lo: null, ci_hi: null, sig: '*'   },
        { name: 'Hedonic motivation',                      group: 'attitudinal', rrr: 1.16, ci_lo: 0.92, ci_hi: 1.45, sig: 'n.s.' },
        { name: 'Reliability concerns (inhibits)',         group: 'attitudinal', rrr: 0.69, ci_lo: 0.59, ci_hi: 0.81, sig: '***' },
        { name: 'Environmental self-identity',             group: 'attitudinal', rrr: 0.68, ci_lo: 0.56, ci_hi: 0.83, sig: '***' },
        { name: 'Urban residence (distance to Basel)',     group: 'demographic', rrr: 0.76, ci_lo: null, ci_hi: null, sig: '**'  },
        { name: 'Private e-bike ownership',                group: 'mobility',    rrr: 0.76, ci_lo: 0.63, ci_hi: 0.92, sig: '**'  },
        { name: 'Age (standardized)',                      group: 'demographic', rrr: 0.59, ci_lo: null, ci_hi: null, sig: '***' }
      ];

      // Order: stronger effects (further from 1) first within each group;
      // here we manually sort to put positive-then-negative for visual symmetry
      rows.sort((a, b) => Math.log(b.rrr) - Math.log(a.rrr));

      const yLabels = rows.map(r => r.name);
      const xMin = 0.4, xMax = 3.2;

      const pointSeries = {
        name: 'Point estimate',
        type: 'custom',
        coordinateSystem: 'cartesian2d',
        renderItem: function (params, api) {
          const i = api.value(2);
          const r = rows[i];
          const x = api.coord([api.value(0), api.value(1)])[0];
          const y = api.coord([api.value(0), api.value(1)])[1];
          const color = COL[r.group];
          const xLo = r.ci_lo ? api.coord([r.ci_lo, api.value(1)])[0] : null;
          const xHi = r.ci_hi ? api.coord([r.ci_hi, api.value(1)])[0] : null;

          const children = [];
          // CI bar
          if (xLo !== null && xHi !== null) {
            children.push({
              type: 'line',
              shape: { x1: xLo, y1: y, x2: xHi, y2: y },
              style: { stroke: color, lineWidth: 2 }
            });
            children.push({
              type: 'line',
              shape: { x1: xLo, y1: y - 4, x2: xLo, y2: y + 4 },
              style: { stroke: color, lineWidth: 2 }
            });
            children.push({
              type: 'line',
              shape: { x1: xHi, y1: y - 4, x2: xHi, y2: y + 4 },
              style: { stroke: color, lineWidth: 2 }
            });
          }
          // Dot
          children.push({
            type: 'circle',
            shape: { cx: x, cy: y, r: r.sig === 'n.s.' ? 4 : 6 },
            style: {
              fill: r.sig === 'n.s.' ? '#fff' : color,
              stroke: color,
              lineWidth: 2
            }
          });
          // RRR label to the right of the CI (or dot if no CI)
          const labelX = (xHi !== null ? xHi : x) + 10;
          children.push({
            type: 'text',
            style: {
              x: labelX,
              y: y + 4,
              text: 'RRR ' + r.rrr.toFixed(2) + (r.sig !== 'n.s.' ? ' ' + r.sig : ' n.s.'),
              fill: r.sig === 'n.s.' ? '#7a756c' : '#0a0a0a',
              font: '10px JetBrains Mono, monospace'
            }
          });
          return { type: 'group', children: children };
        },
        encode: { x: 0, y: 1 },
        data: rows.map((r, i) => [r.rrr, yLabels[i], i])
      };

      const chart = echarts.init(el, null, { renderer: 'svg' });
      chart.setOption({
        backgroundColor: 'transparent',
        animation: true,
        grid: { left: 260, right: 110, top: 24, bottom: 70 },
        xAxis: {
          type: 'log',
          logBase: 2,
          min: xMin, max: xMax,
          name: 'Relative risk ratio (log scale)',
          nameLocation: 'middle',
          nameGap: 38,
          nameTextStyle: { fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: '#5a564e', fontWeight: 700 },
          axisLine: { lineStyle: { color: '#0a0a0a' } },
          axisTick: { lineStyle: { color: '#0a0a0a' } },
          axisLabel: {
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: 10,
            color: '#5a564e',
            formatter: v => v >= 1 ? v.toFixed(v === 1 ? 0 : 1) : v.toFixed(2)
          },
          splitLine: { show: true, lineStyle: { color: '#e3ddd0', type: 'dashed' } }
        },
        yAxis: {
          type: 'category',
          data: yLabels,
          inverse: true,
          axisLine: { lineStyle: { color: '#0a0a0a' } },
          axisTick: { show: false },
          axisLabel: {
            fontFamily: 'Space Grotesk, Inter, sans-serif',
            fontSize: 11.5,
            formatter: function (val) {
              const r = rows.find(rr => rr.name === val);
              if (!r) return val;
              const trimmed = val.length > 44 ? val.slice(0, 42) + '…' : val;
              // tag with rich-text key matching the group, so axisLabel.rich applies the color
              return '{' + r.group + '|' + trimmed + '}';
            },
            rich: {
              behavioral:  { fontFamily: 'Space Grotesk, Inter, sans-serif', fontSize: 11.5, color: '#0a0a0a', fontWeight: 600 },
              attitudinal: { fontFamily: 'Space Grotesk, Inter, sans-serif', fontSize: 11.5, color: '#e5372b', fontWeight: 600 },
              mobility:    { fontFamily: 'Space Grotesk, Inter, sans-serif', fontSize: 11.5, color: '#2864b4', fontWeight: 600 },
              demographic: { fontFamily: 'Space Grotesk, Inter, sans-serif', fontSize: 11.5, color: '#7a756c', fontWeight: 500 }
            }
          }
        },
        // Reference line at RRR = 1
        series: [
          {
            type: 'line',
            data: [],
            markLine: {
              symbol: 'none',
              silent: true,
              lineStyle: { color: '#0a0a0a', width: 1.5, type: 'solid' },
              label: {
                formatter: 'No effect (RRR = 1)',
                fontFamily: 'JetBrains Mono, monospace',
                fontSize: 9,
                color: '#5a564e',
                position: 'start'
              },
              data: [{ xAxis: 1 }]
            }
          },
          pointSeries
        ]
      });
      window.addEventListener('resize', () => chart.resize());
    });

    // -------------------------------------------------------------------------
    // Service-area map — CARTO Voyager tiles (neutral, fits the aesthetic)
    // -------------------------------------------------------------------------
    runWhenVisible(document.getElementById('map'), async function initServiceMap() {
      await ensureLeaflet();

      const map = L.map('map', { scrollWheelZoom: false, zoomControl: true }).setView([47.555, 7.61], 10.9);
    window.addEventListener('resize', () => map.invalidateSize());
    window.__poteMap = map; // exposed for the section-fold resize hook
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
      maxZoom: 20
    }).addTo(map);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}{r}.png', {
      maxZoom: 20, pane: 'shadowPane'
    }).addTo(map);

    map.createPane('pebPane');
    map.createPane('pbPane');
    map.createPane('stationsPane');
    map.getPane('pebPane').style.zIndex = 410;
    map.getPane('pbPane').style.zIndex = 420;
    map.getPane('stationsPane').style.zIndex = 430;

    const pebStyle     = { pane: 'pebPane', color: '#b23a26', weight: 1.5, opacity: 0.98, fillColor: '#c5402b', fillOpacity: 0.32 };
    const pebPlannedStyle = { pane: 'pebPane', color: '#c49418', weight: 2,   opacity: 0.95, fillColor: '#c49418', fillOpacity: 0.22, dashArray: '6,4' };
    const pbStyle      = { pane: 'pbPane',  color: '#22579d', weight: 1.8, opacity: 1,    fillColor: '#2864b4', fillOpacity: 0.42 };

    function popupHtml(p) {
      let systems = [];
      if (p.PickeBike) systems.push('Pick-e-Bike');
      if (p.PubliBike) systems.push('PubliBike Velospot');
      let planned = '';
      if (p.PickeBike_Planned) {
        planned = `<br><span style="color:#c49418;font-weight:700">⚠ Pick-e-Bike pilot from ${p.PickeBike_Planned_From || '2026-06-01'}</span>`;
        if (p.PickeBike_Planned_Note) planned += `<br><small>${p.PickeBike_Planned_Note}</small>`;
      }
      const systemsLine = systems.length ? systems.join(' &amp; ') : (p.PickeBike_Planned ? '<em>not yet active</em>' : '—');
      return `<strong>${p.GDENAME || 'Municipality'}</strong><br>${systemsLine}${planned}<br>ZIP: ${p.PLZ_Liste || 'n/a'}`;
    }

    function makeLayer(features, style) {
      return L.geoJSON({ type: 'FeatureCollection', features }, {
        pane: style.pane, style,
        onEachFeature: (feature, layer) => { layer.bindPopup(popupHtml(feature.properties || {})); }
      });
    }

    Promise.all([
      fetch('data/ebss_communes.geojson').then(r => r.json()),
      fetch('data/publibike_stations.geojson').then(r => r.json()).catch(() => null)
    ]).then(([communes, pbStations]) => {
      const features = communes.features || [];
      const pebFeatures        = features.filter(f => (f.properties || {}).PickeBike === 1);
      const pebPlannedFeatures = features.filter(f => (f.properties || {}).PickeBike_Planned === 1);
      const pbFeatures         = features.filter(f => (f.properties || {}).PubliBike === 1);

      const pebLayer        = makeLayer(pebFeatures,        pebStyle);
      const pebPlannedLayer = makeLayer(pebPlannedFeatures, pebPlannedStyle);
      const pbLayer         = makeLayer(pbFeatures,         pbStyle);
      pebLayer.addTo(map);
      pebPlannedLayer.addTo(map);
      pbLayer.addTo(map);

      let pbStationLayer = null;
      if (pbStations) {
        pbStationLayer = L.geoJSON(pbStations, {
          pane: 'stationsPane',
          pointToLayer: (feature, latlng) => L.circleMarker(latlng, {
            radius: 3, color: '#22579d', weight: 0.8, fillColor: '#2864b4', fillOpacity: 0.80
          }),
          onEachFeature: (feature, layer) => {
            const p = feature.properties || {};
            layer.bindPopup(`<strong>${p['Station: Name'] || 'Station'}</strong><br>${p['Adresse'] || ''}<br>${p['PLZ'] || ''} ${p['Ort'] || ''}`);
          }
        });
      }

      const overlays = {
        'Pick-e-Bike Service Area': pebLayer,
        'Pick-e-Bike Planned (06/2026 pilot)': pebPlannedLayer,
        'PubliBike Velospot Service Area': pbLayer
      };
      if (pbStationLayer) overlays['PubliBike Velospot Stations'] = pbStationLayer;
      L.control.layers(null, overlays, { collapsed: false }).addTo(map);

      const legend = L.control({ position: 'bottomright' });
      legend.onAdd = function() {
        const div = L.DomUtil.create('div', 'legend leaflet-control');
        div.innerHTML = `
          <div style="font-weight:700;margin-bottom:6px;font-size:10px;letter-spacing:.1em;text-transform:uppercase">Service Area</div>
          <div class="legend-row"><span class="legend-swatch" style="background:#c5402b"></span>Pick-e-Bike</div>
          <div class="legend-row"><span class="legend-swatch" style="background:#c49418;border:1px dashed #8a6810"></span>Pick-e-Bike pilot · 06/2026</div>
          <div class="legend-row"><span class="legend-swatch" style="background:#2864b4"></span>PubliBike</div>`;
        return div;
      };
      legend.addTo(map);

      const boundsLayer = L.geoJSON({ type: 'FeatureCollection', features });
      if (boundsLayer.getBounds && boundsLayer.getBounds().isValid()) {
        map.fitBounds(boundsLayer.getBounds().pad(0.10), { padding: [24, 24] });
      }
    }).catch(err => {
      console.error(err);
      document.getElementById('map').innerHTML = '<div style="padding:1rem;color:#5a564e;font-family:JetBrains Mono,monospace;font-size:12px">Map data could not be loaded.</div>';
    });
    });

    // -------------------------------------------------------------------------
    // Heatmap — trip origins / destinations with hour-of-day filter
    // -------------------------------------------------------------------------
    runWhenVisible(document.getElementById('heatmap-map'), async function initHeatmap() {
      await ensureLeafletHeat();

      const HOUR_GROUPS = {
        all:     null,
        morning: [7, 8, 9],
        evening: [16, 17, 18, 19],
        midday:  [10, 11, 12, 13, 14, 15],
        night:   [20, 21, 22, 23, 0, 1, 2, 3, 4, 5, 6]
      };

      const heatMap = L.map('heatmap-map', { scrollWheelZoom: false, zoomControl: true, minZoom: 9, zoomSnap: 0.5 })
        .setView([47.548, 7.600], 10.5);
      window.__poteHeatMap = heatMap; // exposed for the section-fold resize hook

      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap contributors &copy; CARTO', maxZoom: 20
      }).addTo(heatMap);

      const HEAT_OPTS = {
        radius: 14, blur: 7, maxZoom: 18, minOpacity: 0.25,
        gradient: {
          0.00: 'rgba(0,0,0,0)',
          0.15: 'rgba(80,10,90,0.72)',
          0.35: '#7b1c1c',
          0.55: '#c5402b',
          0.72: '#e8840a',
          0.87: '#f5d060',
          1.00: '#fffde7'
        }
      };

      let datasets = { start: null, end: null };
      let currentLayer = null;
      let activeDs       = 'start';
      let activeHours    = 'all';
      let activeProvider = 'combined';

      function buildPoints(features, hourKey, provider) {
        const hours = HOUR_GROUPS[hourKey];
        const raw = [];
        for (const f of features) {
          const [lng, lat] = f.geometry.coordinates;
          const p = f.properties;
          let w;
          if (hours) {
            w = hours.reduce((s, h) => {
              const hs = String(h);
              const fromPeb = (provider !== 'pb')  ? (p.peb ? (p.peb.h[hs] || 0) : 0) : 0;
              const fromPb  = (provider !== 'peb') ? (p.pb  ? (p.pb.h[hs]  || 0) : 0) : 0;
              return s + fromPeb + fromPb;
            }, 0);
          } else {
            const fromPeb = (provider !== 'pb')  ? (p.peb ? p.peb.t : 0) : 0;
            const fromPb  = (provider !== 'peb') ? (p.pb  ? p.pb.t  : 0) : 0;
            w = fromPeb + fromPb;
          }
          if (w > 0) raw.push([lat, lng, w]);
        }
        const sorted = raw.map(r => r[2]).sort((a, b) => a - b);
        const p99val = sorted[Math.floor(sorted.length * 0.99)] || sorted[sorted.length - 1];
        const logRef = Math.log(p99val + 1);
        return raw.map(([lat, lng, w]) => [lat, lng, Math.min(1.0, Math.log(w + 1) / logRef)]);
      }

      function render() {
        if (currentLayer) heatMap.removeLayer(currentLayer);
        const features = datasets[activeDs];
        if (!features) return;
        currentLayer = L.heatLayer(buildPoints(features, activeHours, activeProvider), HEAT_OPTS);
        currentLayer.addTo(heatMap);
      }

      const loadingEl = document.getElementById('heatmap-loading');
      Promise.all([
        fetch('data/heatmap_start.geojson').then(r => r.json()),
        fetch('data/heatmap_end.geojson').then(r => r.json())
      ]).then(([s, e]) => {
        datasets.start = s.features;
        datasets.end   = e.features;
        if (loadingEl) loadingEl.style.display = 'none';
        render();
        window.addEventListener('resize', () => heatMap.invalidateSize());
      }).catch(() => {
        if (loadingEl) loadingEl.textContent = 'Heatmap data could not be loaded.';
      });

      document.querySelectorAll('.heat-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('.heat-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          activeDs = btn.dataset.ds;
          render();
        });
      });

      document.querySelectorAll('.hour-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('.hour-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          activeHours = btn.dataset.hours;
          render();
        });
      });

      document.querySelectorAll('.provider-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('.provider-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          activeProvider = btn.dataset.provider;
          render();
        });
      });
    });

    // -------------------------------------------------------------------------
    // SCROLL-SPY — highlight the active nav link as the user scrolls
    // -------------------------------------------------------------------------
    (function () {
      const links = Array.from(document.querySelectorAll('nav .links a[href^="#"]'));
      if (!links.length) return;
      const linkMap = new Map();
      const sections = [];
      links.forEach(a => {
        const id = a.getAttribute('href').slice(1);
        const sec = document.getElementById(id);
        if (sec) { linkMap.set(id, a); sections.push(sec); }
      });
      if (!sections.length) return;

      const setActive = id => {
        links.forEach(l => l.classList.remove('active'));
        const a = linkMap.get(id);
        if (a) a.classList.add('active');
      };

      const io = new IntersectionObserver((entries) => {
        // Pick the entry closest to the top of the viewport that is currently intersecting
        const visible = entries
          .filter(e => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible.length) setActive(visible[0].target.id);
      }, { rootMargin: '-40% 0px -55% 0px', threshold: 0 });

      sections.forEach(s => io.observe(s));
    })();

    // -------------------------------------------------------------------------
    // BIBTEX COPY BUTTONS — clipboard API, with visual confirmation
    // -------------------------------------------------------------------------
    (function () {
      const BIB = {
        'stiebe2026pragmatism':
`@article{stiebe2026pragmatism,
  author  = {Stiebe, Michael and Krysiak, Frank C. and von Arx, Widar and Weggelaar, Bram},
  title   = {Pragmatism, Not Ideology: Drivers of E-Bike Sharing Usage Intensity},
  journal = {Transportation Research Part D: Transport and Environment},
  year    = {2026},
  note    = {Submitted March 2026, under review}
}`,
        'stiebe2026srl':
`@misc{stiebe2026srl,
  author       = {Stiebe, Michael and Weggelaar, Bram},
  title        = {Drivers of E-Bike Sharing Usage Intensity: Evidence from Free-Floating and Dock-Based Systems in Basel},
  howpublished = {Presentation, Sustainable Future Research Lunch, University of Basel},
  year         = {2026},
  month        = mar,
  day          = {20}
}`,
        'stiebe2025wwz':
`@misc{stiebe2025wwz,
  author       = {Stiebe, Michael},
  title        = {Pragmatists, Not Idealists: What Drives E-Bike Sharing Usage Intensity and Why Car Substitution Remains Elusive},
  howpublished = {Presentation, Economics Lunch Seminar, WWZ, University of Basel},
  year         = {2025},
  month        = dec,
  day          = {17}
}`,
        'stiebe2025mobiltum':
`@inproceedings{stiebe2025mobiltum,
  author    = {Stiebe, Michael and von Arx, Widar},
  title     = {Understanding User Behavior in Dock-based and Free-floating E-bike Sharing Systems: A Multi-method Study From the Basel Metropolitan Area},
  booktitle = {mobil.TUM 2025 — 14th International Scientific Conference on Mobility and Transport},
  address   = {Nanyang Technological University, Singapore},
  year      = {2025},
  month     = nov
}`,
        'stiebe2024etc':
`@inproceedings{stiebe2024etc,
  author    = {Stiebe, Michael and von Arx, Widar},
  title     = {Comparative Analysis of User Characteristics and Use Patterns in Free-Floating and Station-Based E-Bike Sharing Systems — Empirical Insights from the Basel Metropolitan Area},
  booktitle = {European Transport Conference (ETC) 2024},
  address   = {Antwerp},
  year      = {2024},
  month     = sep,
  url       = {https://aetransport.org/past-etc-papers/conference-papers-2024?abstractId=8446}
}`,
        'stiebe2024strc':
`@inproceedings{stiebe2024strc,
  author    = {Stiebe, Michael and von Arx, Widar},
  title     = {Comparative Analysis of User Characteristics and Use Patterns in Free-Floating and Station-Based E-Bike Sharing Systems — Insights from the Basel Metropolitan Area},
  booktitle = {Swiss Transport Research Conference (STRC) 2024},
  address   = {Ascona},
  year      = {2024},
  month     = may,
  url       = {https://www.strc.ch/2024/Stiebe_vonArx.pdf}
}`,
        'vonarx2024strc':
`@inproceedings{vonarx2024strc,
  author    = {von Arx, Widar and Stiebe, Michael},
  title     = {Obstacles to Economic Sustainability of Free-Floating E-Bike Sharing Systems: A Basel-Based Case Study},
  booktitle = {Swiss Transport Research Conference (STRC) 2024},
  address   = {Ascona},
  year      = {2024},
  month     = may
}`,
        'hslu2024newsletter':
`@misc{hslu2024newsletter,
  title        = {E-Bike-Sharing boomt in der Schweiz!},
  howpublished = {Newsletter, Lucerne University of Applied Sciences and Arts},
  year         = {2024},
  month        = nov,
  day          = {13},
  url          = {https://www.hslu.ch/de-ch/wirtschaft/ueber-uns/news/2024/11/13/ebike-sharing/}
}`
      };

      function copyText(text) {
        if (navigator.clipboard && window.isSecureContext) {
          return navigator.clipboard.writeText(text);
        }
        // Fallback for non-secure contexts
        return new Promise((resolve, reject) => {
          try {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.left = '-9999px';
            document.body.appendChild(ta);
            ta.select();
            const ok = document.execCommand('copy');
            document.body.removeChild(ta);
            ok ? resolve() : reject();
          } catch (e) { reject(e); }
        });
      }

      document.querySelectorAll('.cite-btn[data-bib-id]').forEach(btn => {
        btn.addEventListener('click', () => {
          const id = btn.dataset.bibId;
          const bib = BIB[id];
          if (!bib) return;
          copyText(bib).then(() => {
            const original = btn.textContent;
            btn.textContent = 'Copied ✓';
            btn.classList.add('copied');
            setTimeout(() => {
              btn.textContent = original;
              btn.classList.remove('copied');
            }, 1800);
          }).catch(() => {
            btn.textContent = 'Copy failed';
            setTimeout(() => { btn.textContent = 'Copy BibTeX'; }, 1800);
          });
        });
      });
    })();

    // -------------------------------------------------------------------------
    // FOLDABLE SECTIONS — wrap each section body, make .sec-head a toggle.
    // Smart defaults: headline content stays open; technical / reference
    // sections start collapsed. Resize handler re-fires on open so any maps
    // and ECharts inside redraw at the right size.
    // -------------------------------------------------------------------------
    (function () {
      const OPEN_BY_DEFAULT = new Set([
        'methods-link',    // §03 Methods linkout (always show — it IS the link)
        'findings',        // §04 Key findings
        'effect-sizes',    // §04.1 Effect sizes
        'recommendations', // §05 Recommendations
        'mapsec',          // §06 Study area
        'routes',          // §07 Route dynamics
        'partners',        // §09 Partners
        'team',            // §10 Team
        'publications'     // §12 Publications
      ]);

      const sections = document.querySelectorAll('section[id]');
      const folders = [];

      sections.forEach(section => {
        const sh = section.querySelector(':scope > .sec-head');
        if (!sh) return;

        // Collect everything after .sec-head as the foldable body
        const bodyNodes = [];
        let n = sh.nextElementSibling;
        while (n) { bodyNodes.push(n); n = n.nextElementSibling; }
        if (!bodyNodes.length) return;

        const wrap = document.createElement('div');
        wrap.className = 'sec-fold-content';
        bodyNodes.forEach(el => wrap.appendChild(el));
        section.appendChild(wrap);

        const isOpen = OPEN_BY_DEFAULT.has(section.id);
        if (!isOpen) wrap.style.display = 'none';
        section.classList.add('sec-foldable');
        if (!isOpen) section.classList.add('sec-closed');

        const btn = document.createElement('button');
        btn.className = 'sec-toggle';
        btn.type = 'button';
        btn.setAttribute('aria-expanded', String(isOpen));
        btn.setAttribute('aria-controls', section.id + '-content');
        btn.setAttribute('aria-label', 'Toggle section');
        btn.textContent = isOpen ? '−' : '+';
        wrap.id = section.id + '-content';
        sh.appendChild(btn);

        const setOpen = (open) => {
          if (open) {
            wrap.style.display = '';
            section.classList.remove('sec-closed');
            // Replay the animation by removing+adding the class
            wrap.classList.remove('sec-fold-content');
            void wrap.offsetWidth;
            wrap.classList.add('sec-fold-content');
            // Trigger chart/map resize next frame
            setTimeout(() => {
              window.dispatchEvent(new Event('resize'));
              if (window.__poteMap) window.__poteMap.invalidateSize();
              if (window.__poteHeatMap) window.__poteHeatMap.invalidateSize();
              if (window.__poteRouteMap) window.__poteRouteMap.resize();
            }, 60);
          } else {
            wrap.style.display = 'none';
            section.classList.add('sec-closed');
          }
          btn.textContent = open ? '−' : '+';
          btn.setAttribute('aria-expanded', String(open));
        };

        const toggle = () => setOpen(wrap.style.display === 'none');

        sh.addEventListener('click', (e) => {
          // Don't toggle when clicking links or other buttons inside the heading
          if (e.target.closest('a')) return;
          if (e.target === btn || btn.contains(e.target)) {
            e.preventDefault(); e.stopPropagation();
          }
          toggle();
        });

        // Allow keyboard activation on the heading
        sh.tabIndex = 0;
        sh.setAttribute('role', 'button');
        sh.setAttribute('aria-expanded', String(isOpen));
        sh.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggle();
            sh.setAttribute('aria-expanded', String(wrap.style.display !== 'none'));
          }
        });

        folders.push({ section, wrap, setOpen });
      });

      // Expand-all / Collapse-all link in the nav
      const navLinks = document.querySelector('nav .links');
      if (navLinks && folders.length) {
        const allBtn = document.createElement('a');
        allBtn.href = '#';
        allBtn.className = 'fold-all';
        allBtn.dataset.state = 'mixed';
        allBtn.textContent = 'EXPAND ALL';
        allBtn.addEventListener('click', (e) => {
          e.preventDefault();
          const anyClosed = folders.some(f => f.wrap.style.display === 'none');
          folders.forEach(f => f.setOpen(anyClosed));
          allBtn.textContent = anyClosed ? 'COLLAPSE ALL' : 'EXPAND ALL';
        });
        navLinks.appendChild(allBtn);
      }

      // If the URL points at a section anchor, force-open it and scroll
      const openHash = () => {
        const id = window.location.hash.slice(1);
        if (!id) return;
        const f = folders.find(x => x.section.id === id);
        if (f && f.wrap.style.display === 'none') f.setOpen(true);
      };
      window.addEventListener('hashchange', openHash);
      openHash();

      // When a nav link to a hidden section is clicked, open the section first
      document.querySelectorAll('nav a[href^="#"]').forEach(a => {
        a.addEventListener('click', () => {
          const id = a.getAttribute('href').slice(1);
          const f = folders.find(x => x.section.id === id);
          if (f && f.wrap.style.display === 'none') f.setOpen(true);
        });
      });
    })();
