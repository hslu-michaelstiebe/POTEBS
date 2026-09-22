// -------------------------------------------------------------------------
    // Deferred vendor loading
    // -------------------------------------------------------------------------
    // All libraries are served from this repository (vendor/), so the page does not
    // depend on third-party CDNs. The only external requests are the map tiles.
    const VENDOR = {
      leafletCss: 'vendor/leaflet/leaflet.min.css',
      leafletJs: 'vendor/leaflet/leaflet.min.js',
      leafletHeatJs: 'vendor/leaflet/leaflet-heat.js',
      echartsJs: 'vendor/echarts.min.js',
      maplibreCss: 'vendor/maplibre/maplibre-gl.css',
      maplibreJs: 'vendor/maplibre/maplibre-gl.js',
      maplibreLeafletJs: 'vendor/maplibre/leaflet-maplibre-gl.js'
    };

    // Basemaps: OpenFreeMap (OpenStreetMap data, OpenMapTiles schema). Free, no API key,
    // no registration, no request limits. Positron and Dark are the same cartographic
    // styles the site previously used via CARTO, which now requires a key.
    const BASEMAP = {
      light: 'https://tiles.openfreemap.org/styles/positron',
      dark: 'https://tiles.openfreemap.org/styles/dark',
      attribution: '&copy; <a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> &copy; <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors'
    };

    const deferredLoads = new Map();

    // Chart text scales with the same breakpoints as the page type (styles.css),
    // so labels stay legible on large, high-resolution monitors.
    const CHART_SCALE = window.innerWidth >= 3000 ? 1.5 : window.innerWidth >= 2200 ? 1.25 : window.innerWidth >= 1680 ? 1.0625 : 1;
    const fs = n => Math.round(n * CHART_SCALE * 10) / 10;

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

    // MapLibre renders the vector basemap inside Leaflet (maplibre-gl-leaflet)
    async function ensureMaplibreLeaflet() {
      await ensureLeaflet();
      await Promise.all([
        loadCssOnce(VENDOR.maplibreCss),
        loadScriptOnce(VENDOR.maplibreJs, () => Boolean(window.maplibregl))
      ]);
      await loadScriptOnce(VENDOR.maplibreLeafletJs, () => Boolean(window.L && window.L.maplibreGL));
    }

    const styleCache = new Map();
    function fetchStyle(url) {
      if (!styleCache.has(url)) {
        styleCache.set(url, fetch(url).then(r => {
          if (!r.ok) throw new Error(`Basemap style failed: ${r.status}`);
          return r.json();
        }));
      }
      return styleCache.get(url);
    }
    // Split one style into a base part and a labels-only part, so place names
    // can sit above the service-area polygons (as the old raster labels did).
    function styleSubset(style, keep) {
      return Object.assign({}, style, { layers: style.layers.filter(keep) });
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
      Combined: { label: 'Combined',            color: '#1c1c1c', width: 2.5 },
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

      const axisFont = { fontFamily: '"Source Sans 3", "Helvetica Neue", Arial, sans-serif', fontSize: fs(12), color: '#5e6166' };
      const axisLine = { lineStyle: { color: '#1c1c1c' } };
      const splitLine = { lineStyle: { color: '#e4e4e4' } };

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
          borderColor: '#1c1c1c', borderWidth: 1,
          textStyle: { color: '#1c1c1c', fontSize: fs(13.5), fontFamily: '"Source Sans 3", "Helvetica Neue", Arial, sans-serif' },
          formatter(params) {
            const pop = params[0]?.data[0];
            let html = `<div style="font-weight:600;margin-bottom:4px">Bottom ${pop?.toFixed(1)}% of users</div>`;
            params.forEach(p => {
              if (p.seriesName === 'Perfect equality') return;
              const cfg = Object.values(PROVIDER_CFG).find(c => c.label === p.seriesName);
              html += `<div style="display:flex;align-items:center;gap:6px;margin:2px 0">
                <span style="display:inline-block;width:10px;height:3px;background:${cfg?.color}"></span>
                <span>${p.seriesName}: <b>${p.data[1]?.toFixed(1)}%</b></span>
              </div>`;
            });
            html += `<div style="margin-top:6px;padding-top:5px;border-top:1px solid #e4e4e4;font-size:12px;color:#5e6166;">Gini: ${giniText}</div>`;
            return html;
          }
        },
        legend: {
          data: ['Combined', 'Pick-e-Bike', 'PubliBike Velospot', 'Perfect equality'],
          top: 4, right: 0,
          itemWidth: 18, itemHeight: 3,
          textStyle: { color: '#5e6166', fontSize: fs(12), fontFamily: '"Source Sans 3", "Helvetica Neue", Arial, sans-serif' }
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
      const PEB = { name: 'Pick-e-Bike', n: 1382, pt: 0.763, walk: 0.490, car: 0.364 };
      const PB  = { name: 'PubliBike Velospot',   n: 462,  pt: 0.726, walk: 0.571, car: 0.220 };
      const v = (p, u) => Math.round(p.n * p[u]);

      const chart = echarts.init(el, null, { renderer: 'svg' });

      const COL = {
        peb:  '#c5402b',
        pb:   '#2864b4',
        pt:   '#4a4d52',
        walk: '#8a8d91',
        car:  '#b9bcc0'
      };

      chart.setOption({
        backgroundColor: 'transparent',
        tooltip: {
          trigger: 'item',
          backgroundColor: '#ffffff',
          borderColor: '#cfcfcf',
          textStyle: { color: '#1c1c1c', fontFamily: '"Source Sans 3", "Helvetica Neue", Arial, sans-serif', fontSize: fs(13) },
          formatter: function (p) {
            if (p.dataType === 'edge') {
              return `${p.data.source} to ${p.data.target}<br/><b>${p.data.value.toLocaleString()} users</b>`;
            }
            return `<b>${p.name}</b>`;
          }
        },
        series: [{
          type: 'sankey',
          left: 4, right: Math.round(118 * CHART_SCALE), top: 8, bottom: 8,
          nodeGap: 16,
          nodeWidth: 12,
          layoutIterations: 32,
          emphasis: { focus: 'adjacency' },
          lineStyle: { color: 'source', curveness: 0.5, opacity: 0.35 },
          label: {
            fontFamily: '"Source Sans 3", "Helvetica Neue", Arial, sans-serif',
            fontSize: fs(13),
            fontWeight: 400,
            color: '#1c1c1c',
            overflow: 'none'
          },
          data: [
            { name: PEB.name,             itemStyle: { color: COL.peb,  borderColor: 'transparent' } },
            { name: PB.name,              itemStyle: { color: COL.pb,   borderColor: 'transparent' } },
            { name: 'Public transport',     itemStyle: { color: COL.pt,   borderColor: 'transparent' } },
            { name: 'Walking',itemStyle: { color: COL.walk, borderColor: 'transparent' } },
            { name: 'Car*',   itemStyle: { color: COL.car,  borderColor: 'transparent' } }
          ],
          links: [
            { source: PEB.name, target: 'Public transport',      value: v(PEB, 'pt')   },
            { source: PEB.name, target: 'Walking', value: v(PEB, 'walk') },
            { source: PEB.name, target: 'Car*',    value: v(PEB, 'car')  },
            { source: PB.name,  target: 'Public transport',      value: v(PB,  'pt')   },
            { source: PB.name,  target: 'Walking', value: v(PB,  'walk') },
            { source: PB.name,  target: 'Car*',    value: v(PB,  'car')  }
          ]
        }]
      });
      window.addEventListener('resize', () => chart.resize());
    });

    // -------------------------------------------------------------------------
    // FOREST PLOT — ordered-logit odds ratios (published Table 8)
    // Point estimates and 95% CIs from the manuscript narrative; CIs computed
    // exp(β ± 1.96·SE) where SEs are reported. Predictors without published SE
    // appear as point estimates only.
    // -------------------------------------------------------------------------
    runWhenVisible(document.getElementById('forest-plot'), async function initForestPlot() {
      const el = document.getElementById('forest-plot');
      if (!el) return;
      await ensureEcharts();

      const COL = {
        attitudinal: '#1c1c1c',
        mobility:    '#3d6a99',
        demographic: '#8a8d91',
        geography:   '#9a6b22'
      };

      // Proportional-odds ordered logit, N = 1,743, McFadden pseudo-R2 = 0.104.
      // Odds ratios and 95% CIs exactly as published in Table 8 of
      // Stiebe et al. (2026), Transportation Research Part D 161, 105621.
      const rows = [
        { name: 'Multimodal complementarity (F5)', short: 'Combining modes (F5)',        group: 'attitudinal', rrr: 1.53, ci_lo: 1.33, ci_hi: 1.78, sig: '***'  },
        { name: 'Urban residence',                        group: 'geography',   rrr: 1.49, ci_lo: 1.06, ci_hi: 2.11, sig: '*'    },
        { name: 'Half-fare travelcard',                   group: 'mobility',    rrr: 1.41, ci_lo: 1.15, ci_hi: 1.72, sig: '***'  },
        { name: 'Hedonic motivation & social support (F3)', short: 'Enjoyment, support (F3)', group: 'attitudinal', rrr: 1.24, ci_lo: 1.07, ci_hi: 1.43, sig: '**' },
        { name: 'Public-sector intervention attitudes (F2)', short: 'Policy support (F2)', group: 'attitudinal', rrr: 1.21, ci_lo: 1.04, ci_hi: 1.41, sig: '*' },
        { name: 'Education level (std.)', short: 'Education',                 group: 'demographic', rrr: 1.14, ci_lo: 1.03, ci_hi: 1.26, sig: '**'   },
        { name: 'Income (std.)', short: 'Income',                          group: 'demographic', rrr: 1.13, ci_lo: 1.02, ci_hi: 1.26, sig: '*'    },
        { name: 'Major-center residence', short: 'Major centre',                 group: 'geography',   rrr: 0.93, ci_lo: 0.72, ci_hi: 1.19, sig: 'n.s.' },
        { name: 'Environmental self-identity (F7)', short: 'Green identity (F7)',       group: 'attitudinal', rrr: 0.82, ci_lo: 0.71, ci_hi: 0.95, sig: '**'   },
        { name: 'Car ownership',                          group: 'mobility',    rrr: 0.79, ci_lo: 0.63, ci_hi: 0.98, sig: '*'    },
        { name: 'Private e-bike ownership', short: 'Own e-bike',               group: 'mobility',    rrr: 0.73, ci_lo: 0.59, ci_hi: 0.91, sig: '**'   },
        { name: 'Distance to Basel SBB (std.)', short: 'Distance to SBB',           group: 'geography',   rrr: 0.72, ci_lo: 0.62, ci_hi: 0.83, sig: '***'  },
        { name: 'Age (std.)', short: 'Age',                             group: 'demographic', rrr: 0.71, ci_lo: 0.63, ci_hi: 0.79, sig: '***'  },
        { name: 'Lives \u2265 5 km from Basel', short: '\u2265 5 km from Basel',            group: 'geography',   rrr: 0.63, ci_lo: 0.48, ci_hi: 0.82, sig: '***' },
        { name: 'Service reliability & cost concerns (F6)', short: 'Reliability, cost (F6)', group: 'attitudinal', rrr: 0.61, ci_lo: 0.52, ci_hi: 0.71, sig: '***' }
      ];

      // Order: stronger effects (further from 1) first within each group;
      // here we manually sort to put positive-then-negative for visual symmetry
      rows.sort((a, b) => Math.log(b.rrr) - Math.log(a.rrr));

      const narrow = el.clientWidth < 620;
      const gridLeft = narrow ? 132 : Math.round(300 * CHART_SCALE);
      const gridRight = narrow ? 60 : Math.round(104 * CHART_SCALE);
      const yLabels = rows.map(r => r.name);
      const xMin = 0.45, xMax = 2.6;

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
          // OR label to the right of the CI (or dot if no CI)
          const labelX = api.getWidth() - gridRight + 8;
          children.push({
            type: 'text',
            style: {
              x: labelX,
              y: y,
              verticalAlign: 'middle',
              text: r.rrr.toFixed(2) + (r.sig !== 'n.s.' ? ' ' + r.sig : ' n.s.'),
              fill: r.sig === 'n.s.' ? '#8a8d91' : '#1c1c1c',
              font: (narrow ? 12 : fs(13)) + 'px "Source Sans 3", "Helvetica Neue", Arial, sans-serif'
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
        grid: { left: gridLeft, right: gridRight, top: 20, bottom: Math.round(66 * CHART_SCALE) },
        xAxis: {
          type: 'log',
          logBase: 2,
          min: xMin, max: xMax,
          name: 'Odds ratio (log scale, 95% CI)',
          nameLocation: 'middle',
          nameGap: 38,
          nameTextStyle: { fontFamily: '"Source Sans 3", "Helvetica Neue", Arial, sans-serif', fontSize: fs(12.5), color: '#5e6166', fontWeight: 400 },
          axisLine: { lineStyle: { color: '#1c1c1c' } },
          axisTick: { lineStyle: { color: '#1c1c1c' } },
          axisLabel: {
            fontFamily: '"Source Sans 3", "Helvetica Neue", Arial, sans-serif',
            fontSize: fs(13.5),
            color: '#5e6166',
            formatter: v => v >= 1 ? v.toFixed(v === 1 ? 0 : 1) : v.toFixed(2)
          },
          splitLine: { show: true, lineStyle: { color: '#e8e8e8', type: 'dashed' } }
        },
        yAxis: {
          type: 'category',
          data: yLabels,
          inverse: true,
          axisLine: { lineStyle: { color: '#1c1c1c' } },
          axisTick: { show: false },
          axisLabel: {
            fontFamily: '"Source Sans 3", "Helvetica Neue", Arial, sans-serif',
            fontSize: fs(13),
            formatter: function (val) {
              const r = rows.find(rr => rr.name === val);
              if (!r) return val;
              const trimmed = narrow && r.short ? r.short : val;
              // tag with rich-text key matching the group, so axisLabel.rich applies the color
              return '{' + r.group + '|' + trimmed + '}';
            },
            rich: {
              attitudinal: { fontFamily: '"Source Sans 3", "Helvetica Neue", Arial, sans-serif', fontSize: fs(13), color: '#2b2b2b', fontWeight: 400 },
              mobility:    { fontFamily: '"Source Sans 3", "Helvetica Neue", Arial, sans-serif', fontSize: fs(13), color: '#2b2b2b', fontWeight: 400 },
              demographic: { fontFamily: '"Source Sans 3", "Helvetica Neue", Arial, sans-serif', fontSize: fs(13), color: '#2b2b2b', fontWeight: 400 },
              geography:   { fontFamily: '"Source Sans 3", "Helvetica Neue", Arial, sans-serif', fontSize: fs(13), color: '#2b2b2b', fontWeight: 400 }
            }
          }
        },
        // Reference line at OR = 1
        series: [
          {
            type: 'line',
            data: [],
            markLine: {
              symbol: 'none',
              silent: true,
              lineStyle: { color: '#1c1c1c', width: 1.5, type: 'solid' },
              label: {
                formatter: 'No effect (OR = 1)',
                fontFamily: '"Source Sans 3", "Helvetica Neue", Arial, sans-serif',
                fontSize: fs(11.5),
                color: '#5e6166',
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
    // Service-area map — OpenFreeMap Positron (neutral, fits the aesthetic)
    // -------------------------------------------------------------------------
    runWhenVisible(document.getElementById('map'), async function initServiceMap() {
      await ensureMaplibreLeaflet();

      const map = L.map('map', { scrollWheelZoom: false, zoomControl: true, trackResize: false, zoomSnap: 0.25 }).setView([47.555, 7.61], 10.9);
    window.addEventListener('resize', () => { if (map.getContainer().offsetWidth) map.invalidateSize(); });
    window.__poteMap = map; // exposed for the explore-tab resize hook

    map.createPane('labelsPane');
    map.getPane('labelsPane').style.zIndex = 500;
    map.getPane('labelsPane').style.pointerEvents = 'none';
    fetchStyle(BASEMAP.light).then(style => {
      L.maplibreGL({ style: styleSubset(style, l => l.type !== 'symbol'), attribution: BASEMAP.attribution }).addTo(map);
      L.maplibreGL({ style: styleSubset(style, l => l.type === 'symbol'), pane: 'labelsPane' }).addTo(map);
    }).catch(err => console.error(err));

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
        planned = `<br><span style="color:#8a6810;font-weight:600">Pick-e-Bike pilot, June to November 2026</span>`;
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
        'Pick-e-Bike service area': pebLayer,
        'Pick-e-Bike pilot, Jun to Nov 2026': pebPlannedLayer,
        'PubliBike Velospot service area': pbLayer
      };
      if (pbStationLayer) overlays['PubliBike Velospot stations'] = pbStationLayer;
      L.control.layers(null, overlays, { collapsed: false }).addTo(map);

      const legend = L.control({ position: 'bottomright' });
      legend.onAdd = function() {
        const div = L.DomUtil.create('div', 'legend leaflet-control');
        div.innerHTML = `
          <div class="legend-title">Service area</div>
          <div class="legend-row"><span class="legend-swatch" style="background:#c5402b"></span>Pick-e-Bike</div>
          <div class="legend-row"><span class="legend-swatch" style="background:#c49418;border:1px dashed #8a6810"></span>Pick-e-Bike pilot 2026</div>
          <div class="legend-row"><span class="legend-swatch" style="background:#2864b4"></span>PubliBike Velospot</div>`;
        return div;
      };
      legend.addTo(map);

      const boundsLayer = L.geoJSON({ type: 'FeatureCollection', features });
      if (boundsLayer.getBounds && boundsLayer.getBounds().isValid()) {
        // If the data arrives while another explore tab is open, the map has no
        // size yet and fitBounds would compute NaN. Fit once the tab is shown.
        const bounds = boundsLayer.getBounds().pad(0.04);
        const fitIfVisible = () => {
          if (!map.getContainer().offsetWidth) return false;
          map.invalidateSize();
          map.fitBounds(bounds, { padding: [24, 24] });
          return true;
        };
        if (!fitIfVisible()) {
          const retry = () => { if (fitIfVisible()) window.removeEventListener('resize', retry); };
          window.addEventListener('resize', retry);
        }
      }
    }).catch(err => {
      console.error(err);
      document.getElementById('map').innerHTML = '<div style="padding:1rem;color:#5e6166;font-size:12px">Map data could not be loaded.</div>';
    });
    });

    // -------------------------------------------------------------------------
    // Heatmap — trip origins / destinations with hour-of-day filter
    // -------------------------------------------------------------------------
    runWhenVisible(document.getElementById('heatmap-map'), async function initHeatmap() {
      await ensureLeafletHeat();
      await ensureMaplibreLeaflet();

      const HOUR_GROUPS = {
        all:     null,
        morning: [7, 8, 9],
        evening: [16, 17, 18, 19],
        midday:  [10, 11, 12, 13, 14, 15],
        night:   [20, 21, 22, 23, 0, 1, 2, 3, 4, 5, 6]
      };

      const heatMap = L.map('heatmap-map', { scrollWheelZoom: false, zoomControl: true, minZoom: 9, zoomSnap: 0.5, trackResize: false })
        .setView([47.548, 7.600], 10.5);
      window.addEventListener('resize', () => {
        // Skip while the panel is hidden: a zero-width heat canvas throws on redraw
        if (heatMap.getContainer().offsetWidth) heatMap.invalidateSize();
      });
      window.__poteHeatMap = heatMap; // exposed for the explore-tab resize hook

      L.maplibreGL({ style: BASEMAP.dark, attribution: BASEMAP.attribution }).addTo(heatMap);

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
        // Guarded: a zero-width heat canvas (hidden tab) throws on redraw
        window.addEventListener('resize', () => {
          if (heatMap.getContainer().offsetWidth) heatMap.invalidateSize();
        });
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
      const byId = new Map(links.map(a => [a.getAttribute('href').slice(1), a]));
      // Every section is tracked. One without its own nav entry (e.g. timeline,
      // partners, team) lights up the nearest nav entry above it in the page.
      const linkMap = new Map();
      const sections = [];
      let current = null;
      document.querySelectorAll('section[id], .group-band[id]').forEach(sec => {
        if (byId.has(sec.id)) current = byId.get(sec.id);
        linkMap.set(sec.id, current); // null above the first entry: nothing lit
        sections.push(sec);
      });
      if (!sections.length) return;

      links.forEach(l => l.classList.remove('active'));
      let lit = null;
      const setActive = id => {
        const a = id ? linkMap.get(id) : null;
        if (a === lit) return;
        if (lit) lit.classList.remove('active');
        if (a) a.classList.add('active');
        lit = a;
      };

      // The active section is the last one whose top has passed a probe line
      // at 40% of the viewport height. Computed from layout on every scroll
      // frame, so it stays correct after anchor jumps and smooth scrolling.
      let ticking = false;
      const update = () => {
        ticking = false;
        const probe = window.innerHeight * 0.4;
        let hit = null;
        for (const sec of sections) {
          if (sec.getBoundingClientRect().top <= probe) hit = sec; else break;
        }
        const doc = document.documentElement;
        if (hit && window.scrollY + window.innerHeight >= doc.scrollHeight - 2) {
          hit = sections[sections.length - 1];
        }
        setActive(hit ? hit.id : null);
      };
      const schedule = () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } };
      window.addEventListener('scroll', schedule, { passive: true });
      window.addEventListener('resize', schedule);
      window.addEventListener('load', schedule);
      update();
    })();

    // -------------------------------------------------------------------------
    // BIBTEX COPY BUTTONS — clipboard API, with visual confirmation
    // -------------------------------------------------------------------------
    (function () {
      const BIB = {
        'stiebe2026pragmatism':
`@article{stiebe2026pragmatism,
  author  = {Stiebe, Michael and Krysiak, Frank Christian and von Arx, Widar and Weggelaar, Benjamin},
  title   = {Pragmatism, not ideology: Drivers of e-bike sharing usage intensity},
  journal = {Transportation Research Part D: Transport and Environment},
  volume  = {161},
  pages   = {105621},
  year    = {2026},
  issn    = {1361-9209},
  doi     = {10.1016/j.trd.2026.105621},
  url     = {https://doi.org/10.1016/j.trd.2026.105621},
  note    = {Open access, CC BY 4.0}
}`,
        'stiebe2026jum':
`@article{stiebe2026jum,
  author  = {Stiebe, Michael and von Arx, Widar and Sager-M\\"{u}ller, Sibylle},
  title   = {Contrasting usage and spatial profiles of free-floating {S}-pedelec and dock-based pedelec sharing in {B}asel: A longitudinal system-level comparison},
  journal = {Journal of Urban Mobility},
  volume  = {10},
  pages   = {100288},
  year    = {2026},
  doi     = {10.1016/j.urbmob.2026.100288},
  url     = {https://doi.org/10.1016/j.urbmob.2026.100288},
  note    = {Open access}
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
            btn.textContent = 'Copied';
            btn.classList.add('copied');
            setTimeout(() => {
              btn.textContent = original;
              btn.classList.remove('copied');
            }, 1800);
          }).catch(() => {
            btn.textContent = 'Copy failed';
            setTimeout(() => { btn.textContent = original; }, 1800);
          });
        });
      });
    })();

    // Section folding was removed in the 2026 refresh: the page reads straight
    // through now, and hidden sections cost more attention than they saved.

    // -------------------------------------------------------------------------
    // EXPLORE TABS — four data views share one viewport slot. Panels stay in the
    // DOM but are hidden, so each map/chart initialises only when its tab is
    // first opened, and gets a resize nudge afterwards so it lays out correctly.
    // -------------------------------------------------------------------------
    (function () {
      const bar = document.querySelector('.explore-tabbar');
      if (!bar) return;
      const tabs = Array.from(bar.querySelectorAll('.explore-tab'));
      const panels = Array.from(document.querySelectorAll('.explore-panel'));
      if (!tabs.length || !panels.length) return;

      // Only ever re-measure the map that is actually on screen: telling a hidden
      // Leaflet/heat layer to redraw at zero width throws inside the canvas.
      const MAPS = {
        mapsec:  () => window.__poteMap,
        heatmap: () => window.__poteHeatMap,
        routes:  () => window.__poteRouteMap
      };
      const nudge = (id) => {
        const run = () => {
          window.dispatchEvent(new Event('resize'));
          const get = MAPS[id];
          const m = get && get();
          if (!m) return;
          const box = m.getContainer ? m.getContainer() : null;
          if (box && !box.offsetWidth) return;
          if (m.invalidateSize) m.invalidateSize();
          else if (m.resize) m.resize();
        };
        requestAnimationFrame(run);
        setTimeout(run, 140);
      };

      const show = (id, focus) => {
        panels.forEach(p => { p.hidden = (p.id !== id); });
        tabs.forEach(t => {
          const on = t.dataset.panel === id;
          t.classList.toggle('active', on);
          t.setAttribute('aria-selected', String(on));
          if (on && focus) t.focus();
        });
        nudge(id);
      };

      tabs.forEach((t, i) => {
        t.addEventListener('click', () => show(t.dataset.panel, false));
        t.addEventListener('keydown', e => {
          if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
          e.preventDefault();
          const next = (i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length;
          show(tabs[next].dataset.panel, true);
        });
      });

      // Deep links such as #routes or #heatmap open the matching tab
      const openFromHash = () => {
        const id = window.location.hash.slice(1);
        if (!id) return;
        if (panels.some(p => p.id === id)) {
          show(id, false);
          const sec = document.getElementById('explore');
          if (sec) sec.scrollIntoView();
        }
      };
      window.addEventListener('hashchange', openFromHash);
      openFromHash();
    })();

