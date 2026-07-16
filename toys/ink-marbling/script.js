/* Ink Marbling — a living paper-marbling surface (vanilla Canvas 2D, no libraries, no build).
 *
 * The marbling math is authentic. Ink is modelled as CLOSED COLORED CURVES (polylines). When a
 * new drop of radius r lands at center C, every existing vertex p is pushed radially outward:
 *
 *     p' = C + (p - C) * sqrt(1 + r^2 / |p-C|^2)          (equivalently |p'-C| = sqrt(|p-C|^2 + r^2))
 *
 * This is the exact area-preserving "marbling drop" map (Aubrey Jaffer / Xiao et al.). It produces
 * the characteristic nested concentric blooms that read as real floated ink. A drag "combs" the
 * surface: vertices near the stylus follow its motion with a smooth Gaussian falloff, stretching
 * the blooms into feathered veins. Curves are adaptively resampled so stretched edges stay silky,
 * and the oldest ink retires once a vertex budget is hit (bounds memory + keeps it fast on phones).
 *
 * Idle, it becomes a screensaver: a slow curl-like flow keeps the water breathing and fresh ink
 * auto-drops on a gentle cadence. Audio is a physically-grounded water-drop plink (rising cavity
 * bloop + low thud + splash transient, size/velocity scaled, pentatonic so the auto-drops chime
 * musically) over a soft filtered-water room bed, through a reverb + compressor + master-lowpass bus. */
(function () {
  "use strict";

  /* ============================ DOM ============================ */
  const canvas = document.getElementById("canvas");
  const ctx = canvas.getContext("2d", { alpha: false });
  const paletteBtn = document.getElementById("paletteBtn");
  const clearBtn = document.getElementById("clearBtn");
  const soundBtn = document.getElementById("soundBtn");
  const overlay = document.getElementById("overlay");
  const ovBtn = document.getElementById("ovBtn");
  const hint = document.getElementById("hint");

  const REDMO = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const isMobile = (window.matchMedia && window.matchMedia("(pointer: coarse)").matches) || window.innerWidth < 640;

  /* ============================ palettes ============================ */
  // Each palette is its own curated little world: a water gradient (inner -> outer) plus a set of
  // luminous inks. All on dark water so the color reads as floated ink and photographs richly.
  const PALETTES = [
    {
      name: "Jewel",
      water: ["#0e0a20", "#04030b"],
      edge: "rgba(4,2,10,0.32)",
      inks: ["#3454cf", "#0f9a6f", "#7538c9", "#c62f5d", "#d8912f", "#1690a0"]
    },
    {
      name: "Sumi",
      water: ["#14161c", "#050609"],
      edge: "rgba(0,0,0,0.28)",
      inks: ["#f3f0e8", "#c9cfd8", "#8f97a6", "#5f6b86", "#b7a98c", "#e7dcc6"]
    },
    {
      name: "Gilded",
      water: ["#161005", "#040301"],
      edge: "rgba(0,0,0,0.42)",
      inks: ["#f6d27a", "#e8b23c", "#c98a2a", "#f4e6b0", "#a86a1e", "#120d04"]
    },
    {
      name: "Sea Glass",
      water: ["#062028", "#020a0f"],
      edge: "rgba(2,10,14,0.30)",
      inks: ["#63d7c4", "#2fa9b4", "#7fe6a0", "#bdeee0", "#3f7fa6", "#e6d9a8"]
    }
  ];
  let paletteIdx = 0;
  function P() { return PALETTES[paletteIdx]; }

  function hexRGB(h) {
    h = h.replace("#", "");
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  // Precompute a lightly varied set of ink strings per palette for a touch of tonal life.
  function inkVariants(hex) {
    const [r, g, b] = hexRGB(hex);
    const out = [];
    for (let k = -1; k <= 1; k++) {
      const f = 1 + k * 0.10;
      out.push("rgb(" + clampByte(r * f) + "," + clampByte(g * f) + "," + clampByte(b * f) + ")");
    }
    return out;
  }
  function clampByte(v) { return Math.max(0, Math.min(255, Math.round(v))); }
  function inkVar(hex, k) { return inkVariants(hex)[Math.max(0, Math.min(2, 1 + k))]; }

  // How many "stone" drops it takes to cover the current field once (area-aware, so tall/portrait
  // screens fill as densely as wide ones). Each drop adds ~pi*r^2 of ink (the map conserves area).
  function coverCount(rFrac, factor) {
    const r = MIN * rFrac;
    const n = Math.round((W * H) / (Math.PI * r * r) * factor);
    return Math.max(isMobile ? 18 : 20, Math.min(MAX_DROPS - 4, n));
  }

  /* ============================ tunables ============================ */
  const MAX_DROPS = isMobile ? 46 : 50;
  const VERT_CAP = isMobile ? 6200 : 10000;   // total vertices across all curves
  const CURVE_MIN_PTS = 26;
  const MAXSEG = 6.5;                          // resample: split segments longer than this (css px)
  const MINSEG = 2.6;                          // resample: decimate points closer than this
  const IDLE_DELAY = REDMO ? 6.5 : 4.2;        // seconds still before the screensaver auto-drops begin
  const CYCLE = { t: 0 };
  const COMB_STR = 0.92;

  /* ============================ state ============================ */
  let curves = [];             // { pts:[x0,y0,x1,y1,...], color:string, edge:string }
  let W = 1, H = 1, dpr = 1, MIN = 1;
  let bgCanvas = null, sheenCanvas = null, grainPattern = null;
  let overlayUp = true;
  let interacting = false;
  let idleT = 0;
  let autoTimer = 2.0;
  let flowT = Math.random() * 1000;
  let needResample = false;
  let wipe = 0;                // clear-to-still-water veil, 0..1 (0 = off)
  let dirty = true;
  let inkCycle = 0;            // rotates which ink a tap uses, for variety
  let rafPending = false, lastT = 0;

  /* ============================ marbling math ============================ */
  // Drop of radius r at (cx,cy): push every existing vertex radially outward, then lay a fresh
  // ink circle. Order matters — displace the old ink first so the new drop sits crisp on top.
  function addDrop(cx, cy, r, color, edge, playSfx, vel) {
    const r2 = r * r;
    for (let c = 0; c < curves.length; c++) {
      const p = curves[c].pts;
      for (let i = 0; i < p.length; i += 2) {
        const dx = p[i] - cx, dy = p[i + 1] - cy;
        const d2 = dx * dx + dy * dy;
        if (d2 < 1e-8) { p[i] = cx + r; continue; }
        const s = Math.sqrt(1 + r2 / d2);      // |p'-C| = |p-C| * sqrt(1 + r^2/d^2)
        p[i] = cx + dx * s;
        p[i + 1] = cy + dy * s;
      }
    }
    const n = Math.max(40, Math.min(120, Math.round(r * 0.95)));
    const pts = new Array(n * 2);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      pts[i * 2] = cx + Math.cos(a) * r;
      pts[i * 2 + 1] = cy + Math.sin(a) * r;
    }
    curves.push({ pts: pts, color: color, edge: edge });
    trimBudget();
    needResample = true;
    dirty = true;
    if (playSfx) playDrop(cx, r, vel == null ? 1 : vel);
  }

  // Wave-comb (the classic marbler's rake): shear the whole field along one axis by a sine of the
  // other axis, turning concentric stone into interlocking feathered veins. A pair of these on
  // alternating axes gives the iconic "gel-git" marble. amp/freq scale with the viewport.
  function waveComb(axis, amp, freq, phase) {
    for (let c = 0; c < curves.length; c++) {
      const p = curves[c].pts;
      for (let i = 0; i < p.length; i += 2) {
        if (axis === 0) p[i] += amp * Math.sin(p[i + 1] * freq + phase);
        else p[i + 1] += amp * Math.sin(p[i] * freq + phase);
      }
    }
    needResample = true;
    dirty = true;
  }

  // Comb: drag from A->B pulls nearby ink along the motion vector with a smooth Gaussian falloff,
  // feathering concentric blooms into veins. Influence radius scales with the viewport.
  function comb(ax, ay, bx, by) {
    const mx = bx - ax, my = by - ay;
    const R = MIN * (isMobile ? 0.15 : 0.13);
    const R2 = R * R;
    const inv = 1 / (2 * (R * 0.55) * (R * 0.55));
    for (let c = 0; c < curves.length; c++) {
      const p = curves[c].pts;
      for (let i = 0; i < p.length; i += 2) {
        const dx = p[i] - bx, dy = p[i + 1] - by;
        const d2 = dx * dx + dy * dy;
        if (d2 > R2 * 4) continue;
        const w = Math.exp(-d2 * inv) * COMB_STR;
        if (w < 0.002) continue;
        p[i] += mx * w;
        p[i + 1] += my * w;
      }
    }
    needResample = true;
    dirty = true;
  }

  // Adaptive resample: subdivide stretched segments (keeps edges silky) and decimate clustered
  // points (keeps counts bounded). Runs only after discrete drop/comb events.
  function resampleCurve(pts) {
    const n = pts.length / 2;
    if (n < 3) return pts;
    const out = [];
    let kx = pts[0], ky = pts[1];        // last KEPT point
    out.push(kx, ky);
    for (let i = 1; i <= n; i++) {
      const j = (i % n) * 2;
      const qx = pts[j], qy = pts[j + 1];
      const dx = qx - kx, dy = qy - ky;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len > MAXSEG) {
        const k = Math.min(Math.ceil(len / MAXSEG), 4);
        for (let s = 1; s < k; s++) out.push(kx + dx * s / k, ky + dy * s / k);
        if (i < n) { out.push(qx, qy); kx = qx; ky = qy; }
      } else if (i < n) {
        if (len >= MINSEG || out.length / 2 < CURVE_MIN_PTS) { out.push(qx, qy); kx = qx; ky = qy; }
        // else: skip q (too close) but do NOT advance kx/ky, so we merge the cluster
      }
    }
    return out;
  }
  function resampleAll() {
    let total = 0;
    for (let c = 0; c < curves.length; c++) {
      curves[c].pts = resampleCurve(curves[c].pts);
      total += curves[c].pts.length / 2;
    }
    while (total > VERT_CAP && curves.length > 1) {
      total -= curves.shift().pts.length / 2;
    }
    needResample = false;
  }
  function trimBudget() {
    while (curves.length > MAX_DROPS) curves.shift();
  }
  function totalVerts() { let t = 0; for (let c = 0; c < curves.length; c++) t += curves[c].pts.length / 2; return t; }

  /* ============================ idle flow (screensaver current) ============================ */
  // A slow, curl-ish vector field gently advects all ink so the marble is never perfectly still.
  function flowStep(dt) {
    if (REDMO) return;
    flowT += dt;
    const t = flowT;
    const amp = MIN * 0.00042;                 // very gentle drift per frame-second
    const k1 = 2.6 / MIN, k2 = 4.1 / MIN;
    for (let c = 0; c < curves.length; c++) {
      const p = curves[c].pts;
      for (let i = 0; i < p.length; i += 2) {
        const x = p[i], y = p[i + 1];
        const vx = Math.sin(y * k1 + t * 0.20) + 0.5 * Math.sin(y * k2 - t * 0.13 + 1.7);
        const vy = Math.cos(x * k1 - t * 0.17) + 0.5 * Math.cos(x * k2 + t * 0.11);
        p[i] += vx * amp * dt * 60;
        p[i + 1] += vy * amp * dt * 60;
      }
    }
    dirty = true;
  }

  // Occasional gentle self-actions during the screensaver, for evolving veins.
  function autoEvent() {
    const roll = Math.random();
    if (roll < 0.6) {
      // fresh ink somewhere on the field (often landing on prior ink -> nested rings)
      const r = MIN * (0.05 + Math.random() * 0.055);
      const x = W * (0.12 + Math.random() * 0.76);
      const y = H * (0.12 + Math.random() * 0.76);
      const inks = P().inks;
      const base = inks[Math.floor(Math.random() * inks.length)];
      const vs = inkVariants(base);
      addDrop(x, y, r, vs[Math.floor(Math.random() * vs.length)], P().edge, true, 0.55 + Math.random() * 0.3);
    } else if (roll < 0.82) {
      // a broad wave-comb pass reshapes the whole marble into new veins
      const axis = Math.random() < 0.5 ? 0 : 1;
      waveComb(axis, MIN * (0.02 + Math.random() * 0.03), (1.4 + Math.random() * 2.2) / MIN * Math.PI * 2, Math.random() * Math.PI * 2);
    } else {
      // a slow arc comb across a region
      const cx = W * (0.3 + Math.random() * 0.4), cy = H * (0.3 + Math.random() * 0.4);
      const a = Math.random() * Math.PI * 2, len = MIN * 0.16;
      comb(cx, cy, cx + Math.cos(a) * len, cy + Math.sin(a) * len);
    }
    autoTimer = (REDMO ? 4.2 : 2.2) + Math.random() * (REDMO ? 3.0 : 2.4);
  }

  /* ============================ rendering ============================ */
  function buildGrain() {
    const s = 150;
    const g = document.createElement("canvas"); g.width = s; g.height = s;
    const gc = g.getContext("2d");
    const img = gc.createImageData(s, s);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const v = 128 + (Math.random() * 2 - 1) * 26;
      d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
    }
    gc.putImageData(img, 0, 0);
    grainPattern = ctx.createPattern(g, "repeat");
  }
  function buildBackground() {
    if (!grainPattern) buildGrain();
    const p = P();
    bgCanvas = document.createElement("canvas");
    bgCanvas.width = Math.round(W * dpr); bgCanvas.height = Math.round(H * dpr);
    const b = bgCanvas.getContext("2d");
    b.setTransform(dpr, 0, 0, dpr, 0, 0);
    const g = b.createRadialGradient(W * 0.5, H * 0.42, 0, W * 0.5, H * 0.5, Math.hypot(W, H) * 0.62);
    g.addColorStop(0, p.water[0]);
    g.addColorStop(1, p.water[1]);
    b.fillStyle = g; b.fillRect(0, 0, W, H);
    // subtle paper/water grain
    b.globalCompositeOperation = "overlay";
    b.globalAlpha = 0.05;
    b.fillStyle = grainPattern; b.fillRect(0, 0, W, H);
    b.globalAlpha = 1; b.globalCompositeOperation = "source-over";
    // vignette for depth
    const v = b.createRadialGradient(W * 0.5, H * 0.48, Math.min(W, H) * 0.2, W * 0.5, H * 0.5, Math.hypot(W, H) * 0.62);
    v.addColorStop(0, "rgba(0,0,0,0)");
    v.addColorStop(1, "rgba(0,0,0,0.42)");
    b.fillStyle = v; b.fillRect(0, 0, W, H);

    // soft top-left wet sheen (composited with 'screen' at draw time)
    sheenCanvas = document.createElement("canvas");
    sheenCanvas.width = Math.round(W * dpr); sheenCanvas.height = Math.round(H * dpr);
    const s = sheenCanvas.getContext("2d");
    s.setTransform(dpr, 0, 0, dpr, 0, 0);
    const sg = s.createRadialGradient(W * 0.30, H * 0.24, 0, W * 0.30, H * 0.24, Math.max(W, H) * 0.7);
    sg.addColorStop(0, "rgba(255,255,255,0.10)");
    sg.addColorStop(0.35, "rgba(255,255,255,0.03)");
    sg.addColorStop(1, "rgba(255,255,255,0)");
    s.fillStyle = sg; s.fillRect(0, 0, W, H);
  }

  // Draw a closed polyline as a silky quadratic curve through segment midpoints.
  function traceCurve(p) {
    const n = p.length / 2;
    if (n < 3) return;
    const lastX = p[(n - 1) * 2], lastY = p[(n - 1) * 2 + 1];
    let mx = (lastX + p[0]) / 2, my = (lastY + p[1]) / 2;
    ctx.moveTo(mx, my);
    for (let i = 0; i < n; i++) {
      const cxp = p[i * 2], cyp = p[i * 2 + 1];
      const nx = p[((i + 1) % n) * 2], ny = p[((i + 1) % n) * 2 + 1];
      ctx.quadraticCurveTo(cxp, cyp, (cxp + nx) / 2, (cyp + ny) / 2);
    }
    ctx.closePath();
  }

  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.drawImage(bgCanvas, 0, 0, W, H);

    // ink: oldest (outermost) first so newer drops layer crisply on top
    ctx.lineJoin = "round";
    for (let c = 0; c < curves.length; c++) {
      const cv = curves[c];
      ctx.beginPath();
      traceCurve(cv.pts);
      ctx.fillStyle = cv.color;
      ctx.fill();
      ctx.strokeStyle = cv.edge;
      ctx.lineWidth = 1.1;
      ctx.stroke();
    }

    // wet sheen on top
    ctx.globalCompositeOperation = "screen";
    ctx.globalAlpha = 1;
    ctx.drawImage(sheenCanvas, 0, 0, W, H);
    ctx.globalCompositeOperation = "source-over";

    // clear-to-still-water veil
    if (wipe > 0) {
      ctx.globalAlpha = Math.min(1, wipe);
      ctx.drawImage(bgCanvas, 0, 0, W, H);
      ctx.globalAlpha = 1;
    }
  }

  /* ============================ frame loop ============================ */
  function requestRender() { if (!rafPending) { rafPending = true; requestAnimationFrame(frame); } }
  function markActive() { idleT = 0; }
  function frame(ts) {
    rafPending = false;
    const dt = lastT ? Math.min(0.05, (ts - lastT) / 1000) : 0.016;
    lastT = ts;

    if (!overlayUp) {
      if (interacting) idleT = 0; else idleT += dt;
      const idle = !interacting && idleT > IDLE_DELAY;

      if (idle) {
        flowStep(dt);
        autoTimer -= dt;
        if (autoTimer <= 0) autoEvent();
      }
      if (wipe > 0) { wipe += dt / 0.55; if (wipe >= 1.3) { curves = []; wipe = 0; } dirty = true; }
      if (needResample) resampleAll();
      CYCLE.t += dt;
    }

    updateAudio(dt);
    if (dirty) { draw(); dirty = false; }

    // keep the loop alive so the screensaver flow + auto-drops run forever; idle to save battery
    // when hidden or when a reduced-motion still image has nothing left to animate.
    const animating = !overlayUp && (interacting || wipe > 0 || (!REDMO && idleT > IDLE_DELAY) || needResample);
    if (!document.hidden && (animating || !REDMO)) requestRender();
    else lastT = 0;
  }

  /* ============================ interaction ============================ */
  const pointers = new Map();  // id -> { x, y, lastX, lastY, moved, downT, combed }
  const TAP_MOVE = 9;          // px of travel below which a gesture counts as a tap (a drop)

  function canvasXY(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  function onDown(e) {
    if (overlayUp) return;
    canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
    const p = canvasXY(e);
    pointers.set(e.pointerId, { x: p.x, y: p.y, lastX: p.x, lastY: p.y, moved: 0, downT: performance.now(), combed: false });
    interacting = true;
    markActive();
    hideHint();
    requestRender();
  }
  function onMove(e) {
    const st = pointers.get(e.pointerId);
    if (!st) return;
    const p = canvasXY(e);
    const dx = p.x - st.lastX, dy = p.y - st.lastY;
    st.moved += Math.hypot(dx, dy);
    if (st.moved > TAP_MOVE) {
      if (!st.combed) { st.combed = true; canvas.classList.add("is-combing"); }
      comb(st.lastX, st.lastY, p.x, p.y);
      if (!combSfxT) startCombBed();
      combSfxLevel = Math.min(1, combSfxLevel + Math.hypot(dx, dy) * 0.02);
    }
    st.lastX = p.x; st.lastY = p.y;
    markActive();
    requestRender();
  }
  function onUp(e) {
    const st = pointers.get(e.pointerId);
    pointers.delete(e.pointerId);
    if (st && !st.combed && st.moved <= TAP_MOVE) {
      // a tap: drop ink, color rotating through the palette for variety
      const inks = P().inks;
      const base = inks[inkCycle % inks.length];
      inkCycle++;
      const vs = inkVariants(base);
      const r = MIN * (0.055 + Math.random() * 0.045);
      addDrop(st.x, st.y, r, vs[Math.floor(Math.random() * vs.length)], P().edge, true, 1);
    }
    if (pointers.size === 0) {
      interacting = false;
      canvas.classList.remove("is-combing");
      markActive();
    }
    requestRender();
  }
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);
  canvas.addEventListener("contextmenu", function (e) { e.preventDefault(); });

  /* ============================ controls ============================ */
  function setPalette(i) {
    paletteIdx = ((i % PALETTES.length) + PALETTES.length) % PALETTES.length;
    paletteBtn.textContent = P().name;
    buildBackground();
    // recolor existing ink into the new palette so the switch feels like a mood change, not a wipe
    const inks = P().inks;
    for (let c = 0; c < curves.length; c++) {
      const base = inks[c % inks.length];
      curves[c].color = inkVariants(base)[1];
      curves[c].edge = P().edge;
    }
    chime();
    dirty = true;
    requestRender();
  }
  function clearWater() {
    if (curves.length === 0) return;
    wipe = 0.0001;
    plink();
    dirty = true;
    requestRender();
  }
  paletteBtn.addEventListener("click", function () { setPalette(paletteIdx + 1); });
  clearBtn.addEventListener("click", clearWater);
  soundBtn.addEventListener("click", function () { setSound(!audioOn); });

  window.addEventListener("keydown", function (e) {
    if (overlayUp) return;
    if (e.key === "p" || e.key === "P") setPalette(paletteIdx + 1);
    else if (e.key === "c" || e.key === "C") clearWater();
    else if (e.key === "s" || e.key === "S") setSound(!audioOn);
  });

  /* ============================ hint ============================ */
  let hintTimer = null;
  function hideHint() { hint.classList.add("is-gone"); }
  function setHint(t) {
    hint.textContent = t;
    hint.classList.remove("is-gone");
    if (hintTimer) clearTimeout(hintTimer);
    hintTimer = setTimeout(hideHint, 4600);
  }

  /* ============================ audio ============================ */
  // Physically-grounded water-drop plink + a soft filtered-water room bed, through a
  // reverb + compressor + master-lowpass bus. Pentatonic so idle auto-drops chime musically.
  let AC = null, master = null, masterLP = null, dryBus = null, reverbIn = null, bedGain = null, bedLP = null;
  let audioOn = true, audioStarted = false;
  const MASTER_VOL = 0.55;
  let combSfxT = null, combSfxLevel = 0;
  const PENTA = [0, 2, 4, 7, 9];   // major pentatonic degrees

  function makeImpulse(dur, decay) {
    const rate = AC.sampleRate, len = Math.floor(rate * dur);
    const buf = AC.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let prev = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len;
        // low-passed noise (one-pole smoothing) so the tail is lush, not grainy
        const white = (Math.random() * 2 - 1);
        prev = prev * 0.6 + white * 0.4;
        d[i] = prev * Math.pow(1 - t, decay);
      }
    }
    return buf;
  }
  function makeNoiseBuffer(dur) {
    const rate = AC.sampleRate, len = Math.floor(rate * dur);
    const buf = AC.createBuffer(1, len, rate);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;             // brown-ish noise (integrated + leaky)
      b0 = 0.997 * b0 + w * 0.028;
      b1 = 0.985 * b1 + w * 0.05;
      b2 = 0.95 * b2 + w * 0.07;
      d[i] = (b0 + b1 + b2) * 0.6;
    }
    return buf;
  }

  function startAudio() {
    if (audioStarted) { if (AC && AC.state === "suspended") AC.resume(); return; }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    AC = new Ctx();
    audioStarted = true;
    // iOS unlock: 1-sample silent buffer inside the gesture
    try { const b = AC.createBuffer(1, 1, 22050); const s = AC.createBufferSource(); s.buffer = b; s.connect(AC.destination); s.start(0); } catch (e) {}

    master = AC.createGain(); master.gain.value = 0; master.connect(AC.destination);
    masterLP = AC.createBiquadFilter(); masterLP.type = "lowpass"; masterLP.frequency.value = 12500; masterLP.Q.value = 0.5;
    masterLP.connect(master);
    const comp = AC.createDynamicsCompressor();
    comp.threshold.value = -15; comp.ratio.value = 3; comp.attack.value = 0.012; comp.release.value = 0.28;
    comp.connect(masterLP);

    dryBus = AC.createGain(); dryBus.gain.value = 0.9; dryBus.connect(comp);
    // reverb: highpass in (keep lows clean) -> convolver -> highshelf shimmer -> wet
    reverbIn = AC.createGain(); reverbIn.gain.value = 1;
    const rhp = AC.createBiquadFilter(); rhp.type = "highpass"; rhp.frequency.value = 190;
    const conv = AC.createConvolver(); conv.buffer = makeImpulse(3.4, 2.4);
    const rhs = AC.createBiquadFilter(); rhs.type = "highshelf"; rhs.frequency.value = 4200; rhs.gain.value = 3.5;
    const wet = AC.createGain(); wet.gain.value = 0.9;
    reverbIn.connect(rhp); rhp.connect(conv); conv.connect(rhs); rhs.connect(wet); wet.connect(comp);

    // soft filtered-water room bed
    const bed = AC.createBufferSource(); bed.buffer = makeNoiseBuffer(4.5); bed.loop = true;
    bedLP = AC.createBiquadFilter(); bedLP.type = "lowpass"; bedLP.frequency.value = 520; bedLP.Q.value = 0.6;
    bedGain = AC.createGain(); bedGain.gain.value = 0.05;
    bed.connect(bedLP); bedLP.connect(bedGain); bedGain.connect(dryBus); bedGain.connect(reverbIn);
    bed.start();
    // slow filter sweep on the bed so the water feels alive
    const bedLfo = AC.createOscillator(); bedLfo.type = "sine"; bedLfo.frequency.value = 0.04;
    const bedLfoG = AC.createGain(); bedLfoG.gain.value = 180; bedLfo.connect(bedLfoG); bedLfoG.connect(bedLP.frequency); bedLfo.start();

    // a whisper-quiet low drone for warmth/space (open fifth)
    const droneG = AC.createGain(); droneG.gain.value = 0.016; droneG.connect(dryBus);
    const droneLP = AC.createBiquadFilter(); droneLP.type = "lowpass"; droneLP.frequency.value = 340; droneLP.connect(droneG);
    [98, 146.83].forEach(function (f, i) {
      const o = AC.createOscillator(); o.type = "sine"; o.frequency.value = f; o.detune.value = i ? 4 : -4;
      o.connect(droneLP); o.start();
    });
    const dlfo = AC.createOscillator(); dlfo.type = "sine"; dlfo.frequency.value = 0.06;
    const dlfoG = AC.createGain(); dlfoG.gain.value = 0.008; dlfo.connect(dlfoG); dlfoG.connect(droneG.gain); dlfo.start();

    master.gain.setValueAtTime(0.0001, AC.currentTime);
    master.gain.linearRampToValueAtTime(audioOn ? MASTER_VOL : 0.0001, AC.currentTime + 1.8);
  }

  // A water drop: low thud + rising cavity "bloop" + bandpassed splash transient.
  function playDrop(x, r, vel) {
    if (!AC || !audioOn) return;
    const now = AC.currentTime;
    const sizeN = Math.max(0, Math.min(1, (r - MIN * 0.05) / (MIN * 0.10)));
    const amp = (0.4 + 0.6 * sizeN) * (0.6 + 0.5 * vel);
    const pan = AC.createStereoPanner ? AC.createStereoPanner() : null;
    if (pan) pan.pan.value = Math.max(-1, Math.min(1, (x / W - 0.5) * 1.5));
    const out = AC.createGain(); out.gain.value = 1;
    (pan ? (out.connect(pan), pan) : out).connect(dryBus);
    (pan ? pan : out).connect(reverbIn);

    // pentatonic base pitch, lower for bigger drops -> screensaver auto-drops chime musically
    const root = 174.61;  // F3
    const deg = PENTA[Math.floor(Math.random() * PENTA.length)];
    const oct = sizeN > 0.6 ? -12 : (Math.random() < 0.4 ? 12 : 0);
    const f0 = root * Math.pow(2, (deg + oct) / 12);

    // rising cavity bloop (sine glides up ~ x1.9)
    const o = AC.createOscillator(); o.type = "sine";
    const og = AC.createGain(); og.gain.value = 0;
    o.connect(og); og.connect(out);
    o.frequency.setValueAtTime(f0, now);
    o.frequency.exponentialRampToValueAtTime(f0 * 1.9, now + 0.085);
    const dec = 0.22 + sizeN * 0.18;
    og.gain.setValueAtTime(0, now);
    og.gain.linearRampToValueAtTime(0.5 * amp, now + 0.006);
    og.gain.exponentialRampToValueAtTime(0.0006, now + dec);
    o.start(now); o.stop(now + dec + 0.05);

    // low thud body (weight, scales with size)
    const th = AC.createOscillator(); th.type = "sine";
    const tg = AC.createGain(); tg.gain.value = 0;
    th.connect(tg); tg.connect(out);
    th.frequency.setValueAtTime(150, now);
    th.frequency.exponentialRampToValueAtTime(66, now + 0.06);
    tg.gain.setValueAtTime(0, now);
    tg.gain.linearRampToValueAtTime(0.34 * amp * (0.5 + sizeN), now + 0.005);
    tg.gain.exponentialRampToValueAtTime(0.0005, now + 0.14);
    th.start(now); th.stop(now + 0.2);

    // splash transient (bandpassed noise burst, brighter for small drops)
    const ns = AC.createBufferSource(); ns.buffer = splashBuf || (splashBuf = makeShortNoise());
    const bp = AC.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 1500 - sizeN * 650; bp.Q.value = 1.1;
    const ng = AC.createGain(); ng.gain.value = 0;
    ns.connect(bp); bp.connect(ng); ng.connect(out);
    ng.gain.setValueAtTime(0.16 * amp, now);
    ng.gain.exponentialRampToValueAtTime(0.0004, now + 0.05);
    ns.start(now); ns.stop(now + 0.07);
  }
  let splashBuf = null;
  function makeShortNoise() {
    const rate = AC.sampleRate, len = Math.floor(rate * 0.08);
    const b = AC.createBuffer(1, len, rate);
    const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    return b;
  }

  // A soft two-note plink for palette change / clear.
  function chime() {
    if (!AC || !audioOn) return;
    const now = AC.currentTime;
    const root = 261.63;
    [0, 7].forEach(function (semi, i) {
      const o = AC.createOscillator(); o.type = "sine";
      const g = AC.createGain(); g.gain.value = 0;
      o.frequency.value = root * Math.pow(2, semi / 12);
      o.connect(g); g.connect(dryBus); g.connect(reverbIn);
      g.gain.setValueAtTime(0, now + i * 0.05);
      g.gain.linearRampToValueAtTime(0.12, now + i * 0.05 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0006, now + i * 0.05 + 1.0);
      o.start(now + i * 0.05); o.stop(now + i * 0.05 + 1.1);
    });
  }
  function plink() {
    if (!AC || !audioOn) return;
    const now = AC.currentTime;
    const o = AC.createOscillator(); o.type = "sine";
    const g = AC.createGain(); g.gain.value = 0;
    o.frequency.setValueAtTime(340, now); o.frequency.exponentialRampToValueAtTime(180, now + 0.12);
    o.connect(g); g.connect(dryBus); g.connect(reverbIn);
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(0.14, now + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0005, now + 0.3);
    o.start(now); o.stop(now + 0.35);
  }

  // A subtle watery "swish" bed while combing, that fades when the drag stops.
  let combSrc = null, combBp = null, combGain = null;
  function startCombBed() {
    if (!AC || !audioOn || combSfxT) return;
    combSfxT = true;
    combSrc = AC.createBufferSource(); combSrc.buffer = makeNoiseBuffer(2.0); combSrc.loop = true;
    combBp = AC.createBiquadFilter(); combBp.type = "bandpass"; combBp.frequency.value = 900; combBp.Q.value = 0.8;
    combGain = AC.createGain(); combGain.gain.value = 0;
    combSrc.connect(combBp); combBp.connect(combGain); combGain.connect(dryBus); combGain.connect(reverbIn);
    combSrc.start();
  }
  function updateAudio(dt) {
    if (!AC) return;
    combSfxLevel *= Math.exp(-dt * 3.4);
    if (combGain) {
      const target = interacting ? Math.min(0.07, combSfxLevel * 0.06) : 0;
      combGain.gain.setTargetAtTime(target, AC.currentTime, 0.08);
      if (combBp) combBp.frequency.setTargetAtTime(700 + combSfxLevel * 900, AC.currentTime, 0.1);
      if (!interacting && combSfxLevel < 0.01 && combSfxT) {
        try { combSrc.stop(); } catch (e) {}
        combSrc = combBp = combGain = null; combSfxT = null;
      }
    }
  }
  function setSound(on) {
    audioOn = on;
    soundBtn.setAttribute("aria-pressed", on ? "true" : "false");
    if (on) { startAudio(); if (AC) { AC.resume(); master.gain.setTargetAtTime(MASTER_VOL, AC.currentTime, 0.3); } }
    else if (AC) { master.gain.setTargetAtTime(0.0001, AC.currentTime, 0.2); }
  }

  /* ============================ resize ============================ */
  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    const oldW = W, oldH = H;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = w; H = h; MIN = Math.min(W, H);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    // rescale existing ink so the composition survives an orientation flip
    if (oldW > 1 && (oldW !== W || oldH !== H)) {
      const sx = W / oldW, sy = H / oldH;
      for (let c = 0; c < curves.length; c++) {
        const p = curves[c].pts;
        for (let i = 0; i < p.length; i += 2) { p[i] *= sx; p[i + 1] *= sy; }
      }
    }
    buildBackground();
    dirty = true;
    requestRender();
  }
  window.addEventListener("resize", resize);
  window.addEventListener("orientationchange", function () { setTimeout(resize, 120); });
  document.addEventListener("visibilitychange", function () { if (!document.hidden && !overlayUp) { lastT = 0; requestRender(); } });

  /* ============================ boot ============================ */
  function seed() {
    // Build a full-field interwoven marble so the surface reads as real marbled paper the moment
    // the intro lifts: lay overlapping "stone" (each drop pushes the rest outward until color
    // covers the water and nests into rings), then rake it into feathered veins with wave-combs.
    const inks = P().inks;
    const nStone = coverCount(0.11, 0.9);
    for (let i = 0; i < nStone; i++) {
      const x = W * (0.04 + Math.random() * 0.92);
      const y = H * (0.05 + Math.random() * 0.90);
      const r = MIN * (0.085 + Math.random() * 0.055);
      addDrop(x, y, r, inkVar(inks[i % inks.length], i % 2 ? 0 : (Math.random() < 0.5 ? -1 : 1)), P().edge, false);
    }
    // classic rake: alternating-axis wave combs feather the stone into veins
    waveComb(0, MIN * 0.05, 2.2 / MIN * Math.PI * 2, 0.6);
    waveComb(1, MIN * 0.045, 2.6 / MIN * Math.PI * 2, 1.7);
    waveComb(0, MIN * 0.03, 4.0 / MIN * Math.PI * 2, 3.1);
    // a final sprinkle of fresh stone fills any gaps the rake opened, with crisp rings on top
    for (let i = 0; i < (isMobile ? 8 : 7); i++) {
      const x = W * (0.1 + Math.random() * 0.8), y = H * (0.1 + Math.random() * 0.8);
      addDrop(x, y, MIN * (0.05 + Math.random() * 0.05), inkVar(inks[(i * 3 + 1) % inks.length], Math.random() < 0.5 ? 0 : 1), P().edge, false);
    }
    // a whisper wave settles the fresh sprinkle into the pattern (breaks perfect circles gently)
    waveComb(1, MIN * 0.012, 5.5 / MIN * Math.PI * 2, 2.3);
    // one broad hand-swirl for a focal flourish
    const cx = W * (0.38 + Math.random() * 0.24), cy = H * (0.38 + Math.random() * 0.24);
    const a = Math.random() * Math.PI * 2, len = MIN * 0.2;
    comb(cx, cy, cx + Math.cos(a) * len, cy + Math.sin(a) * len);
    resampleAll();
  }

  resize();
  paletteBtn.textContent = P().name;
  soundBtn.setAttribute("aria-pressed", "true");
  seed();
  dirty = true;
  requestRender();

  function dismissOverlay() {
    if (!overlayUp) return;
    overlayUp = false;
    overlay.classList.add("is-hidden");
    setTimeout(function () { overlay.hidden = true; }, 360);
    if (audioOn) startAudio();
    setHint("tap to drop ink · drag to comb · leave it to marble itself");
    markActive();
    lastT = 0;
    requestRender();
  }
  ovBtn.addEventListener("click", dismissOverlay);
})();
