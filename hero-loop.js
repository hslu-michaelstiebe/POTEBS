/* Hero loop: one typical day of routed rentals in Basel, drawn on a canvas
   over a static base map. Data: data/hero-trips.json (normalised web-mercator
   coordinates for the base map frame, times in seconds of a typical day). */
(function () {
  const root = document.getElementById('hero-loop');
  if (!root) return;

  const canvas = root.querySelector('canvas');
  const clockEl = document.getElementById('hero-clock');
  if (!canvas) return;

  const DAY = 86400;
  const LOOP_MS = 32000;          // one day per 32 seconds
  const TRAIL = 5400;             // seconds of simulated time a trail stays visible
  const COLORS = ['255,106,74', '96,172,255'];  // Pick-e-Bike, PubliBike Velospot, on the dark base map
  const GHOST = ['150,52,35', '34,78,138'];     // the same two systems, dimmed, for the full-day network
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const ctx = canvas.getContext('2d');
  let trips = null, w = 0, h = 0, dpr = 1, raf = null, t0 = 0, visible = false;
  let ghost = null;

  function size() {
    const r = root.getBoundingClientRect();
    if (!r.width) return false;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = r.width; h = r.height;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ghost = null;
    return true;
  }

  // All trips of the day at low opacity: the network stays visible between
  // the moving trails and shows where each system is used.
  function buildGhost() {
    const c = document.createElement('canvas');
    c.width = canvas.width; c.height = canvas.height;
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.lineCap = 'round'; g.lineJoin = 'round';
    g.lineWidth = Math.max(0.7, Math.min(1.3, w / 700));
    for (const tr of trips) {
      g.strokeStyle = 'rgba(' + tr.g + ',0.17)';
      g.beginPath();
      g.moveTo(tr.xs[0] * w, tr.ys[0] * h);
      for (let i = 1; i < tr.xs.length; i++) g.lineTo(tr.xs[i] * w, tr.ys[i] * h);
      g.stroke();
    }
    ghost = c;
  }

  function prepare(raw) {
    return raw.trips.map(t => {
      const n = t.x.length;
      const xs = new Float32Array(n), ys = new Float32Array(n), ts = new Float32Array(n);
      let cx = 0, cy = 0;
      for (let i = 0; i < n; i++) {
        cx += t.x[i]; cy += t.y[i];
        xs[i] = cx / 10000; ys[i] = cy / 10000;
        ts[i] = t.s + t.t[i];
      }
      return { c: COLORS[t.p], g: GHOST[t.p], xs: xs, ys: ys, ts: ts, s: ts[0], e: ts[n - 1] };
    });
  }

  function drawStatic() {
    ctx.clearRect(0, 0, w, h);
    ctx.lineWidth = Math.max(0.9, Math.min(1.6, w / 560));
    for (const tr of trips) {
      ctx.strokeStyle = 'rgba(' + tr.c + ',0.30)';
      ctx.beginPath();
      ctx.moveTo(tr.xs[0] * w, tr.ys[0] * h);
      for (let i = 1; i < tr.xs.length; i++) ctx.lineTo(tr.xs[i] * w, tr.ys[i] * h);
      ctx.stroke();
    }
    if (clockEl) clockEl.textContent = 'A typical day';
  }

  function frame(now) {
    raf = null;
    if (!visible) return;
    const T = ((now - t0) % LOOP_MS) / LOOP_MS * DAY;
    const cut = T - TRAIL;
    ctx.clearRect(0, 0, w, h);
    if (!ghost) buildGhost();
    ctx.drawImage(ghost, 0, 0, w, h);
    ctx.lineWidth = Math.max(1.5, Math.min(2.6, w / 380));
    for (const tr of trips) {
      if (tr.s > T || tr.e < cut) continue;
      const xs = tr.xs, ys = tr.ys, ts = tr.ts, n = xs.length;
      for (let i = 1; i < n; i++) {
        if (ts[i] > T || ts[i] < cut) continue;
        const a = 1 - (T - ts[i]) / TRAIL;
        ctx.strokeStyle = 'rgba(' + tr.c + ',' + (a * a * 0.6 + a * 0.3).toFixed(3) + ')';
        ctx.beginPath();
        ctx.moveTo(xs[i - 1] * w, ys[i - 1] * h);
        ctx.lineTo(xs[i] * w, ys[i] * h);
        ctx.stroke();
      }
      if (tr.s <= T && tr.e >= T) {
        let i = 1;
        while (i < n && ts[i] < T) i++;
        const p = (T - ts[i - 1]) / Math.max(1, ts[i] - ts[i - 1]);
        const px = (xs[i - 1] + (xs[i] - xs[i - 1]) * p) * w;
        const py = (ys[i - 1] + (ys[i] - ys[i - 1]) * p) * h;
        ctx.fillStyle = 'rgba(' + tr.c + ',0.95)';
        ctx.beginPath();
        ctx.arc(px, py, ctx.lineWidth * 1.15, 0, 6.2832);
        ctx.fill();
      }
    }
    if (clockEl) {
      const hh = Math.floor(T / 3600), mm = Math.floor((T % 3600) / 60);
      clockEl.textContent = (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm;
    }
    raf = requestAnimationFrame(frame);
  }

  function start() {
    if (!trips || raf) return;
    if (reduced) { drawStatic(); return; }
    t0 = performance.now();
    raf = requestAnimationFrame(frame);
  }

  function stop() {
    if (raf) { cancelAnimationFrame(raf); raf = null; }
  }

  let resizeTimer = null;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      if (size() && trips && reduced) drawStatic();
    }, 180);
  });

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) stop();
    else if (visible) start();
  });

  const io = new IntersectionObserver(function (entries) {
    visible = entries[0].isIntersecting;
    if (visible && !document.hidden) start(); else stop();
  }, { rootMargin: '120px' });

  if (!size()) return;
  fetch('data/hero-trips.json')
    .then(r => r.json())
    .then(raw => {
      trips = prepare(raw);
      root.classList.add('is-ready');
      io.observe(root);
      if (reduced) drawStatic();
    })
    .catch(function (err) { console.error(err); });
})();
