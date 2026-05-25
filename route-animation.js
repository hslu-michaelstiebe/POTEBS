(function () {
  const root = document.getElementById('route-animation');
  if (!root) return;

  const DATA_URL = 'data/trips_animation_w35.json';
  const MAPLIBRE_CSS = 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css';
  const MAPLIBRE_JS = 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js';
  const DECK_JS = 'https://unpkg.com/deck.gl@9.0.27/dist.min.js';
  const WEEK_S = 7 * 24 * 3600;
  const DAY_S = 24 * 3600;
  const DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

  const mapEl = document.getElementById('route-map');
  const startBtn = document.getElementById('route-start');
  const startOverlay = document.getElementById('route-start-overlay');
  const statusEl = document.getElementById('route-status');
  const playBtn = document.getElementById('route-play');
  const speedInput = document.getElementById('route-speed');
  const speedReadout = document.getElementById('route-speed-readout');
  const clockEl = document.getElementById('route-clock');
  const modeBtns = Array.from(document.querySelectorAll('.route-mode-btn'));
  const providerBtns = Array.from(document.querySelectorAll('.route-provider-btn'));
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let map = null;
  let deckOverlay = null;
  let trips = [];
  let currentTime = 0;
  let lastTs = performance.now();
  let speed = Number(speedInput ? speedInput.value : 2000);
  let mode = 'week';
  let activeProvider = 'all';
  let playing = false;
  let initialized = false;
  let frameId = null;

  function loadCss(href) {
    if (document.querySelector(`link[href="${href}"]`)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      link.onload = resolve;
      link.onerror = reject;
      document.head.appendChild(link);
    });
  }

  function loadScript(src, isReady) {
    if (isReady()) return Promise.resolve();
    if (document.querySelector(`script[src="${src}"]`)) {
      return new Promise((resolve, reject) => {
        const check = () => isReady() ? resolve() : setTimeout(check, 40);
        setTimeout(check, 40);
        setTimeout(() => isReady() ? resolve() : reject(new Error(`Timed out loading ${src}`)), 12000);
      });
    }
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  function setStatus(text) {
    if (statusEl) statusEl.textContent = text;
  }

  function setPlayState(nextPlaying) {
    playing = nextPlaying;
    if (playBtn) playBtn.textContent = playing ? 'Pause' : 'Play';
  }

  function formatClock(sec) {
    if (mode === 'week') {
      sec = ((sec % WEEK_S) + WEEK_S) % WEEK_S;
      const day = Math.floor(sec / DAY_S);
      const rest = sec - day * DAY_S;
      const hh = String(Math.floor(rest / 3600)).padStart(2, '0');
      const mm = String(Math.floor((rest % 3600) / 60)).padStart(2, '0');
      return `${DAYS[day]} ${hh}:${mm}`;
    }
    sec = ((sec % DAY_S) + DAY_S) % DAY_S;
    const hh = String(Math.floor(sec / 3600)).padStart(2, '0');
    const mm = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
    return `Day ${hh}:${mm}`;
  }

  function providerColor(trip) {
    const base = trip.provider === 'pb' ? [40, 100, 180] : [229, 55, 43];
    const timestamps = mode === 'week' ? trip.t : trip.td;
    const h = ((timestamps && timestamps[0] ? timestamps[0] : 0) % DAY_S) / 3600;
    const light = Math.max(0.55, 0.78 + 0.22 * Math.cos(((h - 14) / 24) * 2 * Math.PI));
    return base.map(v => Math.round(v * light));
  }

  function buildLayers() {
    if (!window.deck || !trips.length) return [];
    const visibleTrips = activeProvider === 'all'
      ? trips
      : trips.filter(trip => trip.provider === activeProvider);
    return [
      new deck.TripsLayer({
        id: 'pote-route-trips',
        data: visibleTrips,
        getPath: d => d.p,
        getTimestamps: d => mode === 'week' ? d.t : d.td,
        getColor: providerColor,
        opacity: 0.9,
        widthMinPixels: window.innerWidth < 700 ? 1.8 : 2.4,
        jointRounded: true,
        capRounded: true,
        trailLength: mode === 'week' ? 1500 : 1200,
        currentTime,
        shadowEnabled: false,
        updateTriggers: {
          getTimestamps: [mode],
          getColor: [mode, activeProvider]
        }
      })
    ];
  }

  function renderLayers() {
    if (deckOverlay) deckOverlay.setProps({ layers: buildLayers() });
    if (clockEl) clockEl.textContent = formatClock(currentTime);
  }

  function tick(now) {
    const dt = (now - lastTs) / 1000;
    lastTs = now;
    if (playing) {
      const period = mode === 'week' ? WEEK_S : DAY_S;
      currentTime = (currentTime + dt * speed) % period;
    }
    renderLayers();
    frameId = requestAnimationFrame(tick);
  }

  async function ensureLibraries() {
    await loadCss(MAPLIBRE_CSS);
    await loadScript(MAPLIBRE_JS, () => Boolean(window.maplibregl));
    await loadScript(DECK_JS, () => Boolean(window.deck && window.deck.TripsLayer));
  }

  async function init() {
    if (initialized) return;
    initialized = true;
    if (startBtn) startBtn.disabled = true;
    setStatus('Loading route animation...');

    try {
      const [_, response] = await Promise.all([
        ensureLibraries(),
        fetch(DATA_URL)
      ]);
      if (!response.ok) throw new Error(`Route data failed: ${response.status}`);
      trips = await response.json();

      map = new maplibregl.Map({
        container: mapEl,
        style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
        center: [7.589, 47.555],
        zoom: window.innerWidth < 700 ? 11.1 : 12.45,
        pitch: window.innerWidth < 700 ? 25 : 44,
        bearing: -7,
        antialias: true,
        attributionControl: true
      });

      deckOverlay = new deck.MapboxOverlay({ layers: [], interleaved: false });
      map.addControl(deckOverlay);
      map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
      window.__poteRouteMap = map;

      map.on('load', () => {
        if (startOverlay) startOverlay.classList.add('is-hidden');
        if (playBtn) playBtn.disabled = false;
        if (speedInput) speedInput.disabled = false;
        setStatus(`${trips.length.toLocaleString('en-US')} routed trips loaded`);
        setPlayState(!prefersReduced);
        lastTs = performance.now();
        renderLayers();
        frameId = requestAnimationFrame(tick);
      });
    } catch (err) {
      console.error(err);
      initialized = false;
      if (startBtn) startBtn.disabled = false;
      setStatus('Route animation could not be loaded.');
    }
  }

  if (startBtn) startBtn.addEventListener('click', init);
  if (playBtn) playBtn.addEventListener('click', () => setPlayState(!playing));
  if (speedInput) {
    speedInput.addEventListener('input', () => {
      speed = Number(speedInput.value);
      if (speedReadout) speedReadout.textContent = `${Math.round(speed / 60)} min/s`;
    });
  }
  modeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      mode = btn.dataset.mode || 'week';
      currentTime = 0;
      modeBtns.forEach(b => b.classList.toggle('active', b === btn));
      renderLayers();
    });
  });
  providerBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      activeProvider = btn.dataset.provider || 'all';
      providerBtns.forEach(b => b.classList.toggle('active', b === btn));
      renderLayers();
    });
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) setPlayState(false);
  });

  const observer = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
    const entry = entries[0];
    if (!entry || !initialized) return;
    if (!entry.isIntersecting) setPlayState(false);
    if (map) map.resize();
  }, { threshold: 0.05 }) : null;
  if (observer) observer.observe(root);

  window.addEventListener('resize', () => {
    if (map) map.resize();
    renderLayers();
  });

  window.addEventListener('beforeunload', () => {
    if (frameId) cancelAnimationFrame(frameId);
  });
})();
