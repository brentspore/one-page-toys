/* Reaction Diffusion — a living Gray-Scott Turing-pattern field (vanilla Canvas 2D, no libs).
 *
 * Two chemicals A and B diffuse across a toroidal grid; a simple feed/kill reaction turns their
 * concentrations into endlessly morphing organic patterns (Alan Turing's morphogenesis, Pearson's
 * Gray-Scott regimes). Each frame runs a few solver STEPS (9-tap Laplacian + reaction, double
 * buffered), then the B field is coloured through a curated 256-entry gradient LUT with a live
 * emboss/relief pass (surface normals from the field gradient + a soft key light + specular
 * sparkle) so the pattern reads as a dimensional, wet, glowing membrane rather than flat pixels.
 * The small grid is drawn bilinear-upscaled to fill the screen.
 *
 * Interactive: drag anywhere to seed B (new growth spreads from your stroke); cycle five regimes
 * (coral / mitosis / worms / spots / maze), four palettes (emerald / magma / violet-gold / ice),
 * three flow speeds, and reseed. A slow evolving ambient drone shifts its tonal centre per regime
 * and brightens with the field's activity. It never fully freezes — a whisper of noise is injected
 * if it ever stalls — so it doubles as a screensaver. */
(function () {
  "use strict";

  /* ============================ DOM ============================ */
  const canvas = document.getElementById("canvas");
  const ctx = canvas.getContext("2d", { alpha: false });
  const regimeBtn = document.getElementById("regimeBtn");
  const paletteBtn = document.getElementById("paletteBtn");
  const speedBtn = document.getElementById("speedBtn");
  const resetBtn = document.getElementById("resetBtn");
  const soundBtn = document.getElementById("soundBtn");
  const overlay = document.getElementById("overlay");
  const ovBtn = document.getElementById("ovBtn");
  const hint = document.getElementById("hint");
  const fkVal = document.getElementById("fkVal");

  const REDMO = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ============================ regimes ============================ */
  // Classic Pearson / Karl-Sims feed(f) & kill(k) pairs — each a distinct morphology.
  const REGIMES = [
    { name: "Coral",   f: 0.0545, k: 0.0620 },
    { name: "Mitosis", f: 0.0367, k: 0.0649 },
    { name: "Worms",   f: 0.0780, k: 0.0610 },
    { name: "Spots",   f: 0.0300, k: 0.0620 },
    { name: "Maze",    f: 0.0290, k: 0.0570 }
  ];
  const DA = 1.0, DB = 0.5, DT = 1.0;    // diffusion rates + timestep (stable for the 9-tap kernel)

  // Flow speed = solver steps per frame. Calmer under reduced-motion.
  const SPEEDS = REDMO ? [1, 1, 2] : [2, 4, 7];
  const SPEED_NAMES = ["Calm", "Flow", "Rapid"];

  /* ============================ palettes ============================ */
  // Each palette = smooth gradient stops [pos, r,g,b] on a dark base; baked into a 256-entry LUT.
  const PALETTES = [
    { name: "Emerald", stops: [
      [0.00, 4, 10, 12], [0.30, 6, 42, 46], [0.55, 12, 120, 96],
      [0.78, 44, 205, 152], [0.92, 150, 246, 208], [1.00, 228, 255, 238] ] },
    { name: "Magma", stops: [
      [0.00, 4, 3, 9], [0.24, 44, 10, 54], [0.50, 134, 22, 72],
      [0.72, 228, 74, 42], [0.88, 250, 168, 58], [1.00, 255, 246, 202] ] },
    { name: "Violet", stops: [
      [0.00, 7, 4, 15], [0.28, 46, 22, 82], [0.52, 122, 46, 152],
      [0.72, 212, 72, 142], [0.88, 246, 182, 92], [1.00, 255, 240, 208] ] },
    { name: "Ice", stops: [
      [0.00, 3, 6, 16], [0.30, 14, 34, 66], [0.55, 32, 96, 156],
      [0.78, 84, 194, 228], [0.92, 182, 236, 250], [1.00, 242, 251, 255] ] }
  ];

  function buildLUT(stops) {
    const lut = new Uint8Array(256 * 3);
    for (let i = 0; i < 256; i++) {
      const t = i / 255;
      let a = stops[0], b = stops[stops.length - 1];
      for (let s = 0; s < stops.length - 1; s++) {
        if (t >= stops[s][0] && t <= stops[s + 1][0]) { a = stops[s]; b = stops[s + 1]; break; }
      }
      const span = b[0] - a[0] || 1;
      let u = (t - a[0]) / span;
      u = u * u * (3 - 2 * u);                 // smoothstep for silky ramps
      lut[i * 3]     = Math.round(a[1] + (b[1] - a[1]) * u);
      lut[i * 3 + 1] = Math.round(a[2] + (b[2] - a[2]) * u);
      lut[i * 3 + 2] = Math.round(a[3] + (b[3] - a[3]) * u);
    }
    return lut;
  }
  const LUTS = PALETTES.map(function (p) { return buildLUT(p.stops); });

  /* ============================ state ============================ */
  let cssW = 1, cssH = 1, dpr = 1;
  let gw = 1, gh = 1;                       // grid dimensions
  let A, B, A2, B2, disp;                   // fields + double buffers + display scratch
  let off, offCtx, imgData, imgU8;          // offscreen grid canvas
  let regime = 0, palette = 0, speedIdx = 1;
  let overlayUp = true;
  let paused = false;
  let activity = 0;                         // mean B (drives audio brightness)
  let stallT = 0;                           // seconds the field has been near-static

  // Display mapping: B in a Gray-Scott active zone runs ~0..0.4. Map into 0..1 for the LUT.
  const B_LO = 0.05, B_HI = 0.34;
  const RELIEF = 3.4;                       // emboss strength
  const SPEC = 2.6;                         // specular sparkle strength

  /* ============================ grid sizing ============================ */
  function isSmall() { return Math.min(cssW, cssH) < 640; }
  function computeGrid() {
    const aspect = cssW / cssH;
    const targetCells = isSmall() ? 20000 : 34000;
    let h = Math.round(Math.sqrt(targetCells / aspect));
    let w = Math.round(h * aspect);
    w = Math.max(48, Math.min(320, w));
    h = Math.max(48, Math.min(320, h));
    return { w: w, h: h };
  }

  function allocGrid(w, h) {
    gw = w; gh = h;
    const n = w * h;
    A = new Float32Array(n); B = new Float32Array(n);
    A2 = new Float32Array(n); B2 = new Float32Array(n);
    disp = new Float32Array(n);
    off = document.createElement("canvas");
    off.width = w; off.height = h;
    offCtx = off.getContext("2d");
    imgData = offCtx.createImageData(w, h);
    imgU8 = imgData.data;
    for (let i = 0; i < n; i++) { imgU8[i * 4 + 3] = 255; }   // opaque alpha, set once
  }

  /* ============================ seeding ============================ */
  function clearField() {
    A.fill(1.0); B.fill(0.0);
  }
  function seedBlob(cxg, cyg, r) {
    const r2 = r * r;
    const x0 = Math.max(0, Math.floor(cxg - r)), x1 = Math.min(gw - 1, Math.ceil(cxg + r));
    const y0 = Math.max(0, Math.floor(cyg - r)), y1 = Math.min(gh - 1, Math.ceil(cyg + r));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x - cxg, dy = y - cyg, d2 = dx * dx + dy * dy;
        if (d2 <= r2) {
          const fall = 1 - Math.sqrt(d2) / r;              // soft edge
          const i = y * gw + x;
          B[i] = Math.min(1, B[i] + 0.9 * fall);
          A[i] = Math.max(0, A[i] - 0.5 * fall);
        }
      }
    }
  }
  // Scatter a fresh living field: a central cluster + drifting satellites so structure appears
  // everywhere, then pre-run so it's already alive the moment the overlay lifts.
  function reseed(prerun) {
    clearField();
    const cx = gw / 2, cy = gh / 2;
    const rBase = Math.max(3, gw * 0.03);
    seedBlob(cx, cy, rBase * 1.6);
    const n = 48 + Math.floor(Math.random() * 20);
    for (let s = 0; s < n; s++) {
      seedBlob(Math.random() * gw, Math.random() * gh, rBase * (0.5 + Math.random() * 0.95));
    }
    stallT = 0;
    if (prerun) { for (let s = 0; s < 170; s++) step(); }
  }

  /* ============================ solver ============================ */
  function step() {
    const f = REGIMES[regime].f, k = REGIMES[regime].k;
    const kf = k + f;
    const _A = A, _B = B, oA = A2, oB = B2;
    for (let y = 0; y < gh; y++) {
      const yc = y * gw;
      const ym = (y === 0 ? gh - 1 : y - 1) * gw;
      const yp = (y === gh - 1 ? 0 : y + 1) * gw;
      for (let x = 0; x < gw; x++) {
        const xm = x === 0 ? gw - 1 : x - 1;
        const xp = x === gw - 1 ? 0 : x + 1;
        const i = yc + x;
        const a = _A[i], b = _B[i];
        // 9-tap Laplacian (edges 0.2, corners 0.05, centre -1 — weights sum to 0)
        const lapA = _A[yc + xm] * 0.2 + _A[yc + xp] * 0.2 + _A[ym + x] * 0.2 + _A[yp + x] * 0.2
          + _A[ym + xm] * 0.05 + _A[ym + xp] * 0.05 + _A[yp + xm] * 0.05 + _A[yp + xp] * 0.05 - a;
        const lapB = _B[yc + xm] * 0.2 + _B[yc + xp] * 0.2 + _B[ym + x] * 0.2 + _B[yp + x] * 0.2
          + _B[ym + xm] * 0.05 + _B[ym + xp] * 0.05 + _B[yp + xm] * 0.05 + _B[yp + xp] * 0.05 - b;
        const abb = a * b * b;
        let na = a + (DA * lapA - abb + f * (1 - a)) * DT;
        let nb = b + (DB * lapB + abb - kf * b) * DT;
        oA[i] = na < 0 ? 0 : na > 1 ? 1 : na;
        oB[i] = nb < 0 ? 0 : nb > 1 ? 1 : nb;
      }
    }
    A = oA; B = oB; A2 = _A; B2 = _B;      // swap buffers
  }

  /* ============================ render ============================ */
  const INV_SPAN = 1 / (B_HI - B_LO);
  function render() {
    // Pass 1: map B -> display value in 0..1, track mean activity.
    const n = gw * gh;
    let sum = 0;
    for (let i = 0; i < n; i++) {
      let t = (B[i] - B_LO) * INV_SPAN;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      disp[i] = t;
      sum += t;
    }
    activity = sum / n;

    // Pass 2: emboss + palette LUT -> pixels.
    const lut = LUTS[palette];
    const d = disp, px = imgU8;
    for (let y = 0; y < gh; y++) {
      const yc = y * gw;
      const ym = (y === 0 ? gh - 1 : y - 1) * gw;
      const yp = (y === gh - 1 ? 0 : y + 1) * gw;
      for (let x = 0; x < gw; x++) {
        const xm = x === 0 ? gw - 1 : x - 1;
        const xp = x === gw - 1 ? 0 : x + 1;
        const i = yc + x;
        const v = d[i];
        // field gradient -> surface slope; key light from the upper-left
        const gx = d[yc + xp] - d[yc + xm];
        const gy = d[yp + x] - d[ym + x];
        let lum = 1 + (-gx - gy) * RELIEF;
        if (lum < 0.55) lum = 0.55; else if (lum > 1.7) lum = 1.7;
        let spec = (-gx - gy) * SPEC - 0.35;         // sparkle only on the brightest facing ridges
        spec = spec > 0 ? (spec > 1 ? 1 : spec) * v * 90 : 0;
        const li = (v * 255) | 0;
        const o = i * 4, b3 = li * 3;
        let r = lut[b3] * lum + spec;
        let g = lut[b3 + 1] * lum + spec;
        let bl = lut[b3 + 2] * lum + spec;
        px[o]     = r > 255 ? 255 : r;
        px[o + 1] = g > 255 ? 255 : g;
        px[o + 2] = bl > 255 ? 255 : bl;
      }
    }
    offCtx.putImageData(imgData, 0, 0);

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(off, 0, 0, gw, gh, 0, 0, canvas.width, canvas.height);
    drawVignette();
  }

  // Cached radial vignette for premium framing.
  let vignette = null;
  function buildVignette() {
    const w = canvas.width, h = canvas.height;
    const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.28, w / 2, h / 2, Math.max(w, h) * 0.72);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(0,0,0,0.42)");
    vignette = g;
  }
  function drawVignette() {
    if (!vignette) buildVignette();
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  /* ============================ frame loop ============================ */
  let rafId = 0, lastT = 0;
  function loop(ts) {
    rafId = 0;
    const dt = lastT ? Math.min(0.05, (ts - lastT) / 1000) : 0.016;
    lastT = ts;

    const steps = SPEEDS[speedIdx];
    if (!paused) { for (let s = 0; s < steps; s++) step(); }
    render();

    // Anti-stall: if the field has gone nearly static (spots/maze settle), sprinkle a whisper of
    // seed so it keeps breathing forever — a true screensaver, never a frozen frame.
    if (!paused) {
      stallT = activity < 0.006 ? stallT + dt : 0;
      if (stallT > 2.4) { for (let s = 0; s < 6; s++) seedBlob(Math.random() * gw, Math.random() * gh, Math.max(2, gw * 0.02)); stallT = 0; }
    }

    updateAudio(dt);

    if (!document.hidden) { rafId = requestAnimationFrame(loop); }
    else lastT = 0;
  }
  function wake() { if (!rafId) { lastT = 0; rafId = requestAnimationFrame(loop); } }

  /* ============================ interaction (seeding) ============================ */
  const pointers = new Map();
  let painting = false;

  function gridXY(e) {
    const r = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) / r.width * gw,
      y: (e.clientY - r.top) / r.height * gh
    };
  }
  function paintAt(p) {
    seedBlob(p.x, p.y, Math.max(3, gw * 0.032));
    stallT = 0;
  }
  function onDown(e) {
    if (overlayUp) return;
    canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
    const p = gridXY(e);
    pointers.set(e.pointerId, p);
    painting = true;
    canvas.classList.add("is-painting");
    paintAt(p);
    hideHint();
    wake();
  }
  function onMove(e) {
    if (!pointers.has(e.pointerId)) return;
    const prev = pointers.get(e.pointerId);
    const p = gridXY(e);
    // interpolate along the stroke so fast drags leave a continuous trail
    const dx = p.x - prev.x, dy = p.y - prev.y;
    const dist = Math.hypot(dx, dy);
    const stepN = Math.max(1, Math.floor(dist / Math.max(1, gw * 0.02)));
    for (let s = 1; s <= stepN; s++) paintAt({ x: prev.x + dx * s / stepN, y: prev.y + dy * s / stepN });
    pointers.set(e.pointerId, p);
    wake();
  }
  function onUp(e) {
    pointers.delete(e.pointerId);
    if (pointers.size === 0) { painting = false; canvas.classList.remove("is-painting"); }
  }
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);
  canvas.addEventListener("contextmenu", function (e) { e.preventDefault(); });

  /* ============================ controls ============================ */
  function updateFK() {
    const r = REGIMES[regime];
    fkVal.textContent = "F " + r.f.toFixed(3) + " · k " + r.k.toFixed(3);
  }
  function setRegime(i, doReseed) {
    regime = ((i % REGIMES.length) + REGIMES.length) % REGIMES.length;
    regimeBtn.textContent = REGIMES[regime].name;
    updateFK();
    setPadMood(regime);
    // Each regime needs a fresh, dense field to bloom its signature look — the previous
    // pattern isn't stable under the new feed/kill and would just decay to black. Reseed +
    // pre-run under the NEW parameters so the new world is already alive on the click.
    if (doReseed) { reseed(true); wake(); }
    chime();
  }
  function setPalette(i) {
    palette = ((i % PALETTES.length) + PALETTES.length) % PALETTES.length;
    paletteBtn.textContent = PALETTES[palette].name;
    chime();
  }
  function setSpeed(i) {
    speedIdx = ((i % SPEEDS.length) + SPEEDS.length) % SPEEDS.length;
    speedBtn.textContent = SPEED_NAMES[speedIdx];
  }
  regimeBtn.addEventListener("click", function () { setRegime(regime + 1, true); });
  paletteBtn.addEventListener("click", function () { setPalette(palette + 1); });
  speedBtn.addEventListener("click", function () { setSpeed(speedIdx + 1); });
  resetBtn.addEventListener("click", function () { reseed(false); chime(); wake(); });
  soundBtn.addEventListener("click", function () { setSound(!audioOn); });

  window.addEventListener("keydown", function (e) {
    if (overlayUp) return;
    if (e.key === "r" || e.key === "R") setRegime(regime + 1, true);
    else if (e.key === "p" || e.key === "P") setPalette(palette + 1);
    else if (e.key === "s" || e.key === "S") setSpeed(speedIdx + 1);
    else if (e.key === " ") { e.preventDefault(); reseed(false); wake(); }
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

  /* ============================ audio (evolving ambient drone) ============================ */
  let AC = null, master = null, padLP = null, padGain = null, shimmerGain = null, chimeBus = null;
  let voiceOscs = [];
  let audioOn = true, audioStarted = false;
  const MASTER_VOL = 0.32;
  // Per-regime tonal centre (major-pentatonic offsets from a low root) — each regime its own mood.
  const PENTA = [0, 3, 7, 5, 10];
  const VOICE_RATIOS = [1, 1.5, 2, 3, 4];    // stacked fifths/octaves — spacious & consonant
  const ROOT = 55;                            // A1

  function makeImpulse(dur, decay) {
    const rate = AC.sampleRate, len = Math.floor(rate * dur);
    const buf = AC.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) { const t = i / len; d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay); }
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

    master = AC.createGain(); master.gain.value = 0; master.connect(AC.destination);
    const comp = AC.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 3; comp.attack.value = 0.02; comp.release.value = 0.3;
    comp.connect(master);

    const conv = AC.createConvolver(); conv.buffer = makeImpulse(3.6, 2.4);
    const wet = AC.createGain(); wet.gain.value = 0.6; conv.connect(wet); wet.connect(comp);
    const dry = AC.createGain(); dry.gain.value = 0.7; dry.connect(comp);

    padLP = AC.createBiquadFilter(); padLP.type = "lowpass"; padLP.frequency.value = 1100; padLP.Q.value = 0.7;
    padLP.connect(dry); padLP.connect(conv);
    padGain = AC.createGain(); padGain.gain.value = 0.9; padGain.connect(padLP);
    chimeBus = AC.createGain(); chimeBus.gain.value = 0.5; chimeBus.connect(dry); chimeBus.connect(conv);

    const semi = PENTA[regime % PENTA.length];
    const rootF = ROOT * Math.pow(2, semi / 12);
    voiceOscs = [];
    VOICE_RATIOS.forEach(function (ratio, vi) {
      const pan = AC.createStereoPanner ? AC.createStereoPanner() : null;
      let dest = padGain;
      if (pan) { pan.pan.value = (vi / (VOICE_RATIOS.length - 1) - 0.5) * 0.7; pan.connect(padGain); dest = pan; }
      const g = AC.createGain(); g.gain.value = (vi === 0 ? 0.34 : 0.16 / Math.sqrt(ratio)); g.connect(dest);
      [0, 6].forEach(function (cents, k) {                // primary + a lightly detuned chorus partner
        const o = AC.createOscillator();
        o.type = ratio <= 1 ? "sine" : "triangle";
        o.frequency.value = rootF * ratio;
        o.detune.value = cents + (vi - 2) * 1.5;
        const gg = AC.createGain(); gg.gain.value = k ? 0.5 : 1;
        o.connect(gg); gg.connect(g); o.start();
        voiceOscs.push({ osc: o, ratio: ratio });
      });
    });

    // bright shimmer that swells with pattern activity
    shimmerGain = AC.createGain(); shimmerGain.gain.value = 0; shimmerGain.connect(padLP);
    const sh = AC.createOscillator(); sh.type = "sine"; sh.frequency.value = rootF * 8; sh.connect(shimmerGain); sh.start();
    voiceOscs.push({ osc: sh, ratio: 8 });

    // slow filter + amplitude breathing keeps the bed alive as a screensaver
    const lfo = AC.createOscillator(); lfo.type = "sine"; lfo.frequency.value = 0.04;
    const lfoG = AC.createGain(); lfoG.gain.value = 220; lfo.connect(lfoG); lfoG.connect(padLP.frequency); lfo.start();
    const alfo = AC.createOscillator(); alfo.type = "sine"; alfo.frequency.value = 0.06;
    const alfoG = AC.createGain(); alfoG.gain.value = 0.13; alfo.connect(alfoG); alfoG.connect(padGain.gain); alfo.start();

    master.gain.setValueAtTime(0.0001, AC.currentTime);
    master.gain.linearRampToValueAtTime(audioOn ? MASTER_VOL : 0.0001, AC.currentTime + 2.2);
  }
  // Glide the pad to the new regime's tonal centre.
  function setPadMood(reg) {
    if (!AC || !voiceOscs.length) return;
    const semi = PENTA[reg % PENTA.length];
    const rootF = ROOT * Math.pow(2, semi / 12);
    const now = AC.currentTime;
    voiceOscs.forEach(function (v) { v.osc.frequency.setTargetAtTime(rootF * v.ratio, now, 0.6); });
  }
  function updateAudio() {
    if (!AC || !audioOn) return;
    const now = AC.currentTime;
    const act = Math.min(1, activity * 7);     // 0..1
    padLP.frequency.setTargetAtTime(950 + act * 900, now, 0.35);
    shimmerGain.gain.setTargetAtTime(act * 0.05, now, 0.4);
  }
  function chime() {
    if (!AC || !audioOn || !chimeBus) return;
    const now = AC.currentTime;
    const semi = PENTA[regime % PENTA.length];
    const degs = [0, 4, 7, 11, 12];
    const base = ROOT * 4 * Math.pow(2, (semi + degs[Math.floor(Math.random() * degs.length)]) / 12);
    [1, 2.0, 3.01].forEach(function (mult, i) {
      const o = AC.createOscillator(); o.type = "sine"; o.frequency.value = base * mult;
      const g = AC.createGain(); g.gain.value = 0;
      o.connect(g); g.connect(chimeBus);
      const amp = 0.16 / (i + 1);
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(amp, now + 0.014);
      g.gain.exponentialRampToValueAtTime(0.0008, now + 1.4 - i * 0.25);
      o.start(now); o.stop(now + 1.5);
    });
  }
  function setSound(on) {
    audioOn = on;
    soundBtn.setAttribute("aria-pressed", on ? "true" : "false");
    if (on) { startAudio(); if (AC) { AC.resume(); master.gain.setTargetAtTime(MASTER_VOL, AC.currentTime, 0.3); } }
    else if (AC) { master.gain.setTargetAtTime(0.0001, AC.currentTime, 0.2); }
  }

  /* ============================ resize ============================ */
  function fitCanvas() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const bw = Math.max(1, Math.round(cssW * dpr));
    const bh = Math.max(1, Math.round(cssH * dpr));
    if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh; vignette = null; }
  }
  // Resample the existing field onto a freshly-sized grid (nearest) so the pattern survives a
  // rotate/resize instead of resetting.
  function resampleTo(nw, nh) {
    const oldA = A, oldB = B, ow = gw, oh = gh;
    allocGrid(nw, nh);
    for (let y = 0; y < nh; y++) {
      const sy = Math.min(oh - 1, Math.floor(y / nh * oh));
      for (let x = 0; x < nw; x++) {
        const sx = Math.min(ow - 1, Math.floor(x / nw * ow));
        const si = sy * ow + sx, di = y * nw + x;
        A[di] = oldA[si]; B[di] = oldB[si];
      }
    }
  }
  let resizeTimer = null;
  function resize() {
    cssW = window.innerWidth; cssH = window.innerHeight;
    fitCanvas();
    const g = computeGrid();
    if (g.w !== gw || g.h !== gh) { resampleTo(g.w, g.h); }
    wake();
  }
  window.addEventListener("resize", function () {
    clearTimeout(resizeTimer); resizeTimer = setTimeout(resize, 140);
  });
  window.addEventListener("orientationchange", function () { setTimeout(resize, 220); });
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) wake(); else if (AC) { /* audio keeps its own state */ }
  });

  /* ============================ boot ============================ */
  cssW = window.innerWidth; cssH = window.innerHeight;
  fitCanvas();
  const g0 = computeGrid();
  allocGrid(g0.w, g0.h);
  setRegime(0);
  setPalette(0);
  setSpeed(1);
  soundBtn.setAttribute("aria-pressed", "true");
  reseed(true);           // seed + pre-run so it's alive behind the overlay
  wake();

  function dismissOverlay() {
    if (!overlayUp) return;
    overlayUp = false;
    overlay.classList.add("is-hidden");
    setTimeout(function () { overlay.hidden = true; }, 360);
    if (audioOn) startAudio();
    setHint("drag to seed new growth · switch regimes & palettes above");
    wake();
  }
  ovBtn.addEventListener("click", dismissOverlay);
})();
