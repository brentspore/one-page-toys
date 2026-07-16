/* Slime Mold — a living Physarum polycephalum simulation (Canvas 2D, no libraries, no build).
 *
 * Tens of thousands of agents { x, y, dir } crawl a toroidal trail field. Each frame every
 * agent samples the trail at three sensors (left / centre / right), steers toward the strongest,
 * steps forward and deposits a little trail behind it. The trail field is then blurred (a cheap
 * separable 3-tap) and decayed — so reinforced paths brighten into veins while unused ones fade,
 * and the whole network endlessly self-organizes and rewires. The field is tone-mapped through a
 * curated glow palette into an ImageData, upscaled with bilinear smoothing + an additive bloom
 * pass for that luminous, alive look.
 *
 * Interactive: tap / drag drops a bright attractant "food" blob that the colony swarms toward and
 * rewires around; the first touch also bursts a cloud of agents outward from the point. When left
 * alone it keeps feeding itself gently — a screensaver that never sits still.
 *
 * The whole agent update is trig-free (sensor + turn rotations use precomputed cos/sin of fixed
 * angles applied to a stored direction vector), which is what keeps ~42k agents cheap in JS. */
(function () {
  "use strict";

  /* ============================ DOM ============================ */
  const canvas = document.getElementById("canvas");
  const ctx = canvas.getContext("2d");
  const paletteBtn = document.getElementById("paletteBtn");
  const newBtn = document.getElementById("newBtn");
  const soundBtn = document.getElementById("soundBtn");
  const overlay = document.getElementById("overlay");
  const ovBtn = document.getElementById("ovBtn");
  const hint = document.getElementById("hint");

  const REDMO = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const isMobile = (window.matchMedia && window.matchMedia("(max-width: 820px)").matches) ||
    ((navigator.maxTouchPoints || 0) > 1 && Math.min(window.innerWidth, window.innerHeight) < 820);

  /* ============================ tunables ============================ */
  const AGENTS = isMobile ? 11000 : 42000;   // colony size
  const SIM_SCALE = isMobile ? 0.55 : 0.72;  // trail grid resolution relative to CSS pixels
  const MAX_GW = isMobile ? 560 : 900;       // cap grid width on huge displays
  const DPR = Math.min(window.devicePixelRatio || 1, isMobile ? 1.5 : 2);
  const BURST = isMobile ? 500 : 1500;       // agents flung out from a fresh touch

  // agent behaviour (in grid cells / radians)
  const SENSOR_DIST = 9.0;                    // how far ahead the sensors look
  const SENSOR_ANGLE = 0.52;                  // spread between the three sensors
  const TURN_ANGLE = 0.58;                    // how sharply an agent rotates per step
  const SPEED = (REDMO ? 0.55 : 1.0);         // grid cells travelled per step
  const DEPOSIT = 0.20;                       // trail laid per step
  const DECAY = 0.905;                        // trail multiplier after each diffuse
  const REINHARD_K = 3.1;                     // tone-map midpoint (lower = brighter veins)

  /* ============================ display + grid state ============================ */
  let cssW = 1, cssH = 1, bw = 1, bh = 1;
  let GW = 1, GH = 1;
  let trail = null, trailTmp = null;          // Float32 trail fields
  let X = null, Y = null, DX = null, DY = null; // agent state (grid space)
  let gridCanvas = null, gctx = null, imgData = null, buf32 = null;

  // capability: ctx.filter (for the bloom pass) — supported everywhere modern, fall back cleanly.
  let hasFilter = false;
  try { ctx.filter = "blur(1px)"; hasFilter = (ctx.filter === "blur(1px)"); ctx.filter = "none"; } catch (e) { hasFilter = false; }
  const BLOOM_PX = isMobile ? 6 : 9;
  const BLOOM_A = 0.55;

  /* ============================ palettes ============================ */
  // Each palette is a set of stops [pos, r, g, b] from near-black background up to a hot core.
  // Built into a 256-entry packed-ABGR LUT so colorize is a single array lookup per cell.
  const PALETTES = [
    { name: "Biolume", bg: "#03050c", stops: [
      [0.00, 2, 4, 12], [0.26, 6, 28, 66], [0.50, 16, 150, 190], [0.66, 60, 230, 225],
      [0.82, 200, 92, 224], [0.93, 255, 178, 240], [1.00, 255, 255, 255] ] },
    { name: "Molten", bg: "#0a0602", stops: [
      [0.00, 6, 3, 1], [0.30, 40, 16, 4], [0.54, 140, 60, 10], [0.72, 224, 132, 22],
      [0.86, 255, 200, 82], [0.95, 255, 240, 180], [1.00, 255, 255, 242] ] },
    { name: "Ember", bg: "#0a0304", stops: [
      [0.00, 7, 2, 3], [0.28, 48, 6, 10], [0.50, 132, 18, 16], [0.68, 224, 52, 20],
      [0.82, 255, 122, 30], [0.92, 255, 202, 92], [1.00, 255, 246, 214] ] },
    { name: "Aurora", bg: "#03080a", stops: [
      [0.00, 2, 8, 10], [0.30, 6, 42, 44], [0.52, 20, 150, 122], [0.70, 92, 240, 172],
      [0.84, 172, 255, 222], [0.92, 150, 182, 255], [1.00, 245, 250, 255] ] }
  ];
  let palette = 0;
  let paletteLUT = new Uint32Array(256);

  function buildLUT(idx) {
    const stops = PALETTES[idx].stops;
    for (let i = 0; i < 256; i++) {
      const t = i / 255;
      let a = stops[0], b = stops[stops.length - 1];
      for (let s = 0; s < stops.length - 1; s++) {
        if (t >= stops[s][0] && t <= stops[s + 1][0]) { a = stops[s]; b = stops[s + 1]; break; }
      }
      let u = (b[0] - a[0]) > 1e-6 ? (t - a[0]) / (b[0] - a[0]) : 0;
      u = u * u * (3 - 2 * u); // smoothstep
      const r = (a[1] + (b[1] - a[1]) * u) | 0;
      const g = (a[2] + (b[2] - a[2]) * u) | 0;
      const bl = (a[3] + (b[3] - a[3]) * u) | 0;
      paletteLUT[i] = (255 << 24) | (bl << 16) | (g << 8) | r; // little-endian ABGR
    }
    document.body.style.background = PALETTES[idx].bg;
  }

  /* ============================ grid (re)build ============================ */
  function buildGrid() {
    cssW = window.innerWidth; cssH = window.innerHeight;
    bw = Math.max(1, Math.round(cssW * DPR));
    bh = Math.max(1, Math.round(cssH * DPR));
    if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh; }

    GW = Math.max(64, Math.min(MAX_GW, Math.round(cssW * SIM_SCALE)));
    GH = Math.max(48, Math.round(GW * cssH / cssW));

    trail = new Float32Array(GW * GH);
    trailTmp = new Float32Array(GW * GH);

    gridCanvas = document.createElement("canvas");
    gridCanvas.width = GW; gridCanvas.height = GH;
    gctx = gridCanvas.getContext("2d");
    imgData = gctx.createImageData(GW, GH);
    buf32 = new Uint32Array(imgData.data.buffer);

    if (!X) { X = new Float32Array(AGENTS); Y = new Float32Array(AGENTS); DX = new Float32Array(AGENTS); DY = new Float32Array(AGENTS); }
    reseed();
  }

  // Scatter the colony uniformly with random headings and clear the field — it blooms into a
  // network within a couple of seconds.
  function reseed() {
    trail.fill(0);
    for (let i = 0; i < AGENTS; i++) {
      X[i] = Math.random() * GW;
      Y[i] = Math.random() * GH;
      const a = Math.random() * Math.PI * 2;
      DX[i] = Math.cos(a); DY[i] = Math.sin(a);
    }
    foods.length = 0; heldFood = null;
  }

  /* ============================ food (attractant blobs) ============================ */
  // A food blob stamps a bright gaussian into the trail every frame while it lives; agents sniff
  // it and swarm in, rewiring the network toward it. Held foods track the pointer; auto-fed and
  // released foods drift and fade.
  const foods = [];
  const MAX_FOODS = 26;
  let heldFood = null;

  function addFood(gx, gy, r, str, life, held) {
    if (foods.length >= MAX_FOODS) foods.shift();
    const f = { gx: gx, gy: gy, r: r, str: str, life: life, max: life,
      vx: (Math.random() - 0.5) * 6, vy: (Math.random() - 0.5) * 6, held: !!held };
    foods.push(f);
    return f;
  }

  function stampFoods(dt) {
    let energy = 0;
    for (let k = foods.length - 1; k >= 0; k--) {
      const f = foods[k];
      if (f.held) { f.life = f.max; }
      else {
        f.life -= dt;
        if (f.life <= 0) { foods.splice(k, 1); continue; }
        f.gx += f.vx * dt; f.gy += f.vy * dt;
        if (f.gx < 0) f.gx += GW; else if (f.gx >= GW) f.gx -= GW;
        if (f.gy < 0) f.gy += GH; else if (f.gy >= GH) f.gy -= GH;
      }
      const frac = f.held ? 1 : (f.life / f.max);
      const amt = f.str * frac;
      energy += amt;
      const r = f.r, r2 = r * r, inv = 1 / (2 * (r * 0.44) * (r * 0.44));
      const cx = f.gx | 0, cy = f.gy | 0;
      const x0 = cx - r, x1 = cx + r, y0 = cy - r, y1 = cy + r;
      for (let y = y0; y <= y1; y++) {
        let gy = y; if (gy < 0) gy += GH; else if (gy >= GH) gy -= GH;
        const row = gy * GW, dyv = y - cy, dy2 = dyv * dyv;
        for (let x = x0; x <= x1; x++) {
          const dxv = x - cx, d2 = dxv * dxv + dy2;
          if (d2 > r2) continue;
          let gx = x; if (gx < 0) gx += GW; else if (gx >= GW) gx -= GW;
          trail[row + gx] += amt * Math.exp(-d2 * inv);
        }
      }
    }
    return energy;
  }

  // Fling a chunk of agents outward from a point (a visible "spore burst" of new filaments).
  let burstPtr = 0;
  function burstAgents(gx, gy, n) {
    for (let j = 0; j < n; j++) {
      const i = burstPtr; burstPtr = (burstPtr + 1) % AGENTS;
      const a = Math.random() * Math.PI * 2, rr = Math.random() * 3;
      X[i] = gx + Math.cos(a) * rr; Y[i] = gy + Math.sin(a) * rr;
      DX[i] = Math.cos(a); DY[i] = Math.sin(a);
    }
  }

  /* ============================ simulation ============================ */
  function stepSim() {
    const gw = GW, gh = GH, t = trail, so = SENSOR_DIST, dep = DEPOSIT, spd = SPEED;
    const cSA = Math.cos(SENSOR_ANGLE), sSA = Math.sin(SENSOR_ANGLE);
    const cRA = Math.cos(TURN_ANGLE), sRA = Math.sin(TURN_ANGLE);
    for (let i = 0; i < AGENTS; i++) {
      const x = X[i], y = Y[i], dx = DX[i], dy = DY[i];
      // centre sensor
      let sx = x + dx * so, sy = y + dy * so;
      let ix = sx | 0, iy = sy | 0;
      if (ix < 0) ix += gw; else if (ix >= gw) ix -= gw;
      if (iy < 0) iy += gh; else if (iy >= gh) iy -= gh;
      const C = t[iy * gw + ix];
      // left sensor: direction rotated by +SENSOR_ANGLE
      const lx = dx * cSA - dy * sSA, ly = dx * sSA + dy * cSA;
      sx = x + lx * so; sy = y + ly * so; ix = sx | 0; iy = sy | 0;
      if (ix < 0) ix += gw; else if (ix >= gw) ix -= gw;
      if (iy < 0) iy += gh; else if (iy >= gh) iy -= gh;
      const L = t[iy * gw + ix];
      // right sensor: direction rotated by -SENSOR_ANGLE
      const rx = dx * cSA + dy * sSA, ry = -dx * sSA + dy * cSA;
      sx = x + rx * so; sy = y + ry * so; ix = sx | 0; iy = sy | 0;
      if (ix < 0) ix += gw; else if (ix >= gw) ix -= gw;
      if (iy < 0) iy += gh; else if (iy >= gh) iy -= gh;
      const R = t[iy * gw + ix];

      let ndx = dx, ndy = dy;
      if (C > L && C > R) { /* keep straight */ }
      else if (C < L && C < R) {                 // valley: random turn
        if (Math.random() < 0.5) { ndx = dx * cRA - dy * sRA; ndy = dx * sRA + dy * cRA; }
        else { ndx = dx * cRA + dy * sRA; ndy = -dx * sRA + dy * cRA; }
      } else if (R > L) { ndx = dx * cRA + dy * sRA; ndy = -dx * sRA + dy * cRA; } // turn right
      else { ndx = dx * cRA - dy * sRA; ndy = dx * sRA + dy * cRA; }               // turn left
      DX[i] = ndx; DY[i] = ndy;

      let nx = x + ndx * spd, ny = y + ndy * spd;
      if (nx < 0) nx += gw; else if (nx >= gw) nx -= gw;
      if (ny < 0) ny += gh; else if (ny >= gh) ny -= gh;
      X[i] = nx; Y[i] = ny;
      t[((ny | 0) * gw) + (nx | 0)] += dep;
    }
  }

  // Separable 3-tap blur (1-2-1) + decay. Borders just decay (hidden under the vignette).
  function diffuse() {
    const gw = GW, gh = GH, t = trail, tmp = trailTmp;
    for (let y = 0; y < gh; y++) {
      const row = y * gw;
      tmp[row] = t[row]; tmp[row + gw - 1] = t[row + gw - 1];
      for (let x = 1; x < gw - 1; x++) { const i = row + x; tmp[i] = (t[i - 1] + t[i] * 2 + t[i + 1]) * 0.25; }
    }
    const d = DECAY;
    for (let x = 0; x < gw; x++) { t[x] = tmp[x] * d; t[(gh - 1) * gw + x] = tmp[(gh - 1) * gw + x] * d; }
    for (let y = 1; y < gh - 1; y++) {
      const row = y * gw;
      for (let x = 0; x < gw; x++) { const i = row + x; t[i] = (tmp[i - gw] + tmp[i] * 2 + tmp[i + gw]) * 0.25 * d; }
    }
  }

  /* ============================ render ============================ */
  function colorize() {
    const t = trail, out = buf32, lut = paletteLUT, n = GW * GH, k = REINHARD_K;
    for (let i = 0; i < n; i++) {
      const v = t[i];
      let idx = (v / (v + k) * 255) | 0;   // reinhard tone map -> [0,255)
      if (idx > 255) idx = 255;
      out[i] = lut[idx];
    }
    gctx.putImageData(imgData, 0, 0);
  }

  function render() {
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.filter = "none";
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(gridCanvas, 0, 0, bw, bh);          // base soft-upscaled field
    if (hasFilter) {                                   // additive bloom for the luminous glow
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = BLOOM_A;
      ctx.filter = "blur(" + BLOOM_PX + "px)";
      ctx.drawImage(gridCanvas, 0, 0, bw, bh);
      ctx.filter = "none";
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    }
  }

  /* ============================ frame loop ============================ */
  const IDLE_FEED_DELAY = 7.5;      // seconds of stillness before the colony feeds itself
  let rafId = 0, lastT = 0, stepToggle = false;
  let timeSinceInteract = 999, nextAutoFeed = 0, needsGridRebuild = false;

  function frame(ts) {
    rafId = 0;
    const dt = lastT ? Math.min(0.05, (ts - lastT) / 1000) : 0.016;
    lastT = ts;

    if (needsGridRebuild) { needsGridRebuild = false; buildGrid(); }

    if (!overlayUp) timeSinceInteract += dt;

    // idle auto-feeding keeps the screensaver evolving on its own
    if (!overlayUp && timeSinceInteract > IDLE_FEED_DELAY) {
      nextAutoFeed -= dt;
      if (nextAutoFeed <= 0) {
        const gx = Math.random() * GW, gy = Math.random() * GH;
        addFood(gx, gy, Math.max(16, GW * 0.05), 3.2, REDMO ? 8 : 5.5, false);
        burstAgents(gx, gy, Math.floor(BURST * 0.28));
        nextAutoFeed = (REDMO ? 6.5 : 4) + Math.random() * 3.5;
      }
    }

    const foodEnergy = stampFoods(dt);

    // under reduced motion, advance the sim on alternate frames (calmer, slower evolution)
    let didStep = true;
    if (REDMO) { stepToggle = !stepToggle; didStep = stepToggle; }
    if (didStep) { stepSim(); diffuse(); }

    colorize();
    render();
    updateAudio(dt, foodEnergy);

    if (!document.hidden) rafId = requestAnimationFrame(frame);
    else lastT = 0;
  }
  function wake() { if (!rafId && !document.hidden) { lastT = 0; rafId = requestAnimationFrame(frame); } }

  /* ============================ interaction ============================ */
  let overlayUp = true;

  function toGrid(e) {
    const r = canvas.getBoundingClientRect();
    return { gx: ((e.clientX - r.left) / r.width) * GW, gy: ((e.clientY - r.top) / r.height) * GH };
  }
  function markInteract() { timeSinceInteract = 0; }

  const pointers = new Set();
  function onDown(e) {
    if (overlayUp) return;
    canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
    pointers.add(e.pointerId);
    markInteract();
    hideHint();
    const p = toGrid(e);
    heldFood = addFood(p.gx, p.gy, Math.max(18, GW * 0.055), 5.5, 1, true);
    burstAgents(p.gx, p.gy, BURST);
    feedTone(0.6);
    wake();
  }
  function onMove(e) {
    if (overlayUp || !heldFood || !pointers.has(e.pointerId)) return;
    const p = toGrid(e);
    heldFood.gx = p.gx; heldFood.gy = p.gy;
    markInteract();
  }
  function onUp(e) {
    pointers.delete(e.pointerId);
    if (heldFood && pointers.size === 0) {
      heldFood.held = false; heldFood.life = 2.4; heldFood.max = 2.4;   // let the last blob fade
      heldFood.vx = (Math.random() - 0.5) * 6; heldFood.vy = (Math.random() - 0.5) * 6;
      heldFood = null;
    }
  }
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);
  canvas.addEventListener("contextmenu", function (e) { e.preventDefault(); });

  /* ============================ controls ============================ */
  function setPalette(i) {
    palette = ((i % PALETTES.length) + PALETTES.length) % PALETTES.length;
    paletteBtn.textContent = PALETTES[palette].name;
    buildLUT(palette);
    chime();
    wake();
  }
  paletteBtn.addEventListener("click", function () { setPalette(palette + 1); });
  newBtn.addEventListener("click", function () { reseed(); markInteract(); chime(); wake(); });
  soundBtn.addEventListener("click", function () { setSound(!audioOn); });

  window.addEventListener("keydown", function (e) {
    if (overlayUp) return;
    if (e.key === "p" || e.key === "P") setPalette(palette + 1);
    else if (e.key === "n" || e.key === "N" || e.key === "r" || e.key === "R") { reseed(); chime(); wake(); }
  });

  /* ============================ hint ============================ */
  let hintTimer = null;
  function hideHint() { hint.classList.add("is-gone"); }
  function setHint(t) {
    hint.textContent = t; hint.classList.remove("is-gone");
    if (hintTimer) clearTimeout(hintTimer);
    hintTimer = setTimeout(hideHint, 4600);
  }

  /* ============================ audio ============================
   * A slow, consonant ambient pad (open fifths + add9) sits under a granular shimmer whose
   * density follows the colony's activity — the network "breathing" as it feeds and rewires.
   * Built on the house bus: convolver reverb + compressor + master lowpass + an outGain toggle,
   * with the iOS 1-sample unlock on the first gesture. (Audio can't be judged headless — it is
   * built from first principles and wants the owner's ears.) */
  let AC = null, out = null, master = null, comp = null, revBus = null, dryBus = null;
  let padLP = null, padGain = null, grainBus = null;
  let audioOn = true, audioStarted = false;
  const MASTER_VOL = 0.42;
  let audioAct = 0.12, grainAcc = 0;

  function makeImpulse(dur, decay) {
    const rate = AC.sampleRate, len = Math.floor(rate * dur);
    const buf = AC.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let last = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len;
        // low-passed noise so the reverb tail is smooth, not grainy
        const white = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
        last = last + 0.35 * (white - last);
        d[i] = last;
      }
    }
    return buf;
  }

  function startAudio() {
    if (audioStarted) { if (AC && AC.state === "suspended") AC.resume(); return; }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    AC = new Ctx();
    audioStarted = true;
    try { const b = AC.createBuffer(1, 1, 22050); const s = AC.createBufferSource(); s.buffer = b; s.connect(AC.destination); s.start(0); } catch (e) {}

    out = AC.createGain(); out.gain.value = audioOn ? 1 : 0.0001; out.connect(AC.destination);
    master = AC.createBiquadFilter(); master.type = "lowpass"; master.frequency.value = 6200; master.Q.value = 0.5; master.connect(out);
    comp = AC.createDynamicsCompressor();
    comp.threshold.value = -15; comp.ratio.value = 3; comp.attack.value = 0.02; comp.release.value = 0.32; comp.connect(master);

    const conv = AC.createConvolver(); conv.buffer = makeImpulse(3.6, 2.4);
    const revHi = AC.createBiquadFilter(); revHi.type = "highpass"; revHi.frequency.value = 180;
    revBus = AC.createGain(); revBus.gain.value = 0.62;
    revBus.connect(conv); conv.connect(revHi); revHi.connect(comp);   // keeps the tail out of the mud
    dryBus = AC.createGain(); dryBus.gain.value = 0.85; dryBus.connect(comp);

    // ---- ambient pad ----
    padLP = AC.createBiquadFilter(); padLP.type = "lowpass"; padLP.frequency.value = 700; padLP.Q.value = 0.6;
    padLP.connect(dryBus); padLP.connect(revBus);
    padGain = AC.createGain(); padGain.gain.value = 0.9; padGain.connect(padLP);
    // open-fifth + add9 voicing (C, G, D, G, C) — airy and calm
    const NOTES = [
      { f: 65.41, g: 0.5 }, { f: 98.00, g: 0.20 }, { f: 146.83, g: 0.15 },
      { f: 196.00, g: 0.14 }, { f: 261.63, g: 0.085 }
    ];
    NOTES.forEach(function (n, i) {
      const pan = AC.createStereoPanner ? AC.createStereoPanner() : null;
      let dest = padGain;
      if (pan) { pan.pan.value = (i / (NOTES.length - 1) - 0.5) * 0.7; pan.connect(padGain); dest = pan; }
      [0, 6.0].forEach(function (cents, k) {
        const o = AC.createOscillator(); o.type = i === 0 ? "sine" : "triangle";
        o.frequency.value = n.f; o.detune.value = cents + (i - 2) * 1.5;
        const g = AC.createGain(); g.gain.value = n.g * (k ? 0.5 : 1);
        o.connect(g); g.connect(dest); o.start();
      });
    });
    // slow filter + amplitude breathing keeps the bed alive as a screensaver
    const lfo = AC.createOscillator(); lfo.type = "sine"; lfo.frequency.value = 0.04;
    const lfoG = AC.createGain(); lfoG.gain.value = 140; lfo.connect(lfoG); lfoG.connect(padLP.frequency); lfo.start();
    const alfo = AC.createOscillator(); alfo.type = "sine"; alfo.frequency.value = 0.06;
    const alfoG = AC.createGain(); alfoG.gain.value = 0.12; alfo.connect(alfoG); alfoG.connect(padGain.gain); alfo.start();

    grainBus = AC.createGain(); grainBus.gain.value = 0.9; grainBus.connect(dryBus); grainBus.connect(revBus);

    // gentle fade-in
    out.gain.setValueAtTime(0.0001, AC.currentTime);
    out.gain.linearRampToValueAtTime(audioOn ? 1 : 0.0001, AC.currentTime + 2.0);
  }

  // C major-pentatonic shimmer grains (Hz) — any density stays consonant
  const GRAIN_HZ = [523.25, 587.33, 659.25, 783.99, 880.00, 1046.50, 1174.66];
  function triggerGrain() {
    if (!AC || !grainBus) return;
    const now = AC.currentTime;
    const f = GRAIN_HZ[(Math.random() * GRAIN_HZ.length) | 0] * (Math.random() < 0.15 ? 2 : 1);
    const o = AC.createOscillator(); o.type = "triangle"; o.frequency.value = f;
    const g = AC.createGain(); g.gain.value = 0;
    const pan = AC.createStereoPanner ? AC.createStereoPanner() : null;
    const amp = 0.05 + Math.random() * 0.04;
    const dur = 0.5 + Math.random() * 0.6;
    o.connect(g);
    if (pan) { pan.pan.value = (Math.random() * 2 - 1) * 0.8; g.connect(pan); pan.connect(grainBus); } else { g.connect(grainBus); }
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(amp, now + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0006, now + dur);
    o.start(now); o.stop(now + dur + 0.05);
  }

  function updateAudio(dt, foodEnergy) {
    if (!AC || !audioOn) return;
    // activity metric: baseline hum + feeding energy, smoothed → the "breathing"
    const target = Math.min(1, 0.1 + Math.min(1, foodEnergy / 22) * 0.9);
    audioAct += (target - audioAct) * Math.min(1, dt * 1.6);
    const now = AC.currentTime;
    if (padLP) padLP.frequency.setTargetAtTime(650 + audioAct * 1500, now, 0.4);
    // grain density follows activity
    const rate = 0.5 + audioAct * (REDMO ? 3 : 7);
    grainAcc += dt * rate;
    let guard = 0;
    while (grainAcc >= 1 && guard < 6) { grainAcc -= 1; triggerGrain(); guard++; }
  }

  function feedTone(vel) {
    if (!AC || !audioOn) return;
    const now = AC.currentTime;
    const base = 174.61 * Math.pow(2, ([0, 3, 5, 7, 10][(Math.random() * 5) | 0]) / 12);
    [1, 1.5, 2.0].forEach(function (m, i) {
      const o = AC.createOscillator(); o.type = "sine"; o.frequency.value = base * m;
      const g = AC.createGain(); g.gain.value = 0; o.connect(g); g.connect(grainBus || dryBus);
      const amp = (0.12 * vel) / (i + 1);
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(amp, now + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0006, now + 1.1 - i * 0.2);
      o.start(now); o.stop(now + 1.2);
    });
  }
  function chime() {
    if (!AC || !audioOn || !grainBus) return;
    const now = AC.currentTime;
    const base = 392 * Math.pow(2, ([0, 5, 7, 12][(Math.random() * 4) | 0]) / 12);
    [1, 2.0, 3.01].forEach(function (m, i) {
      const o = AC.createOscillator(); o.type = "sine"; o.frequency.value = base * m;
      const g = AC.createGain(); g.gain.value = 0; o.connect(g); g.connect(grainBus);
      const amp = 0.14 / (i + 1);
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(amp, now + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0007, now + 1.2 - i * 0.22);
      o.start(now); o.stop(now + 1.3);
    });
  }
  function setSound(on) {
    audioOn = on;
    soundBtn.setAttribute("aria-pressed", on ? "true" : "false");
    if (on) { startAudio(); if (AC) { AC.resume(); out.gain.setTargetAtTime(1, AC.currentTime, 0.3); } }
    else if (AC) { out.gain.setTargetAtTime(0.0001, AC.currentTime, 0.2); }
  }

  /* ============================ resize / lifecycle ============================ */
  let resizeTimer = null;
  window.addEventListener("resize", function () {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { needsGridRebuild = true; wake(); }, 160);
  });
  window.addEventListener("orientationchange", function () { setTimeout(function () { needsGridRebuild = true; wake(); }, 200); });
  document.addEventListener("visibilitychange", function () { if (!document.hidden) wake(); else lastT = 0; });

  /* ============================ boot ============================ */
  buildLUT(palette);
  buildGrid();
  soundBtn.setAttribute("aria-pressed", "true");
  wake();   // the colony grows live behind the intro overlay

  function dismissOverlay() {
    if (!overlayUp) return;
    overlayUp = false;
    overlay.classList.add("is-hidden");
    setTimeout(function () { overlay.hidden = true; }, 360);
    if (audioOn) startAudio();
    setHint("tap or drag to feed the colony · ↻ to reseed");
    markInteract();
    wake();
  }
  ovBtn.addEventListener("click", dismissOverlay);
})();
