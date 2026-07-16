/* Flow Field — a full-bleed generative visual (vanilla Canvas 2D, no libraries, no build).
 *
 * A hidden vector field is sampled from layered Perlin (gradient) noise that slowly drifts on a
 * third "z / time" axis. Thousands of particles read the field ANGLE at their position, advance
 * along it, and paint short additive segments onto a canvas that is faintly faded toward the
 * palette background every frame — so the trails accumulate into silky, glowing, ever-fading
 * ribbons. Particles recycle when they leave the screen or age out.
 *
 * Interaction: drag to STIR the current (impulses carry the drag direction + a swirl, decaying
 * over ~1s); tap to RESEED (a fresh noise pattern that cross-fades in smoothly). Controls cycle
 * four curated palettes, three trail-persistence levels, a reseed button, and a Sound toggle.
 * Audio is an airy wind-like pad whose brightness/movement follows the average particle speed. */
(function () {
  "use strict";

  /* ============================ DOM ============================ */
  const canvas = document.getElementById("canvas");
  const ctx = canvas.getContext("2d", { alpha: false });
  const paletteBtn = document.getElementById("paletteBtn");
  const trailsBtn = document.getElementById("trailsBtn");
  const reseedBtn = document.getElementById("reseedBtn");
  const soundBtn = document.getElementById("soundBtn");
  const overlay = document.getElementById("overlay");
  const ovBtn = document.getElementById("ovBtn");
  const hint = document.getElementById("hint");

  const REDMO = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const COARSE = (window.matchMedia && window.matchMedia("(pointer: coarse)").matches) ||
                 (navigator.maxTouchPoints || 0) > 1 || window.innerWidth < 760;

  /* ============================ tunables ============================ */
  const FIELD_SCALE = 0.00185;   // spatial frequency of the angle field (noise units per px)
  const FIELD_CURL  = 2.15;      // how much the noise value bends the flow angle (radians span)
  const OCTAVES     = 2;         // fbm octaves for the angle field
  const COLOR_SCALE = 0.0011;    // spatial frequency of the color field (big, coherent regions)
  const Z_SPEED     = REDMO ? 0.014 : 0.036;  // how fast the field drifts over time (noise/sec)
  const COLOR_DRIFT = REDMO ? 0.004 : 0.010;  // slow global palette rotation (turns/sec)
  const SPEED       = REDMO ? 0.62 : 1.18;    // base particle step (css px / 60fps frame)
  const LW          = 1.15;      // ribbon stroke width (css px)
  const BUCKETS     = 30;        // color quantization (one stroke path per bucket per frame)
  const SEG_ALPHA   = 0.5;       // additive alpha per ribbon segment

  // disturbance
  const IMP_MAX = 16, IMP_R = 132, IMP_LIFE = 0.95, IMP_PUSH = 0.019, IMP_SWIRL = 0.42;
  const MORPH_DUR = REDMO ? 2.2 : 1.5;  // seconds to cross-fade a reseed

  const PALETTES = [
    { name: "Aurora",     bg: [4, 7, 12],
      stops: [[18, 64, 82], [30, 150, 138], [78, 214, 150], [168, 244, 186], [86, 150, 232], [150, 104, 220]] },
    { name: "Ember",      bg: [9, 4, 3],
      stops: [[92, 20, 10], [186, 48, 18], [242, 112, 30], [252, 194, 96], [220, 66, 62], [128, 26, 32]] },
    { name: "Mono Ink",   bg: [4, 5, 7],
      stops: [[58, 64, 76], [116, 124, 140], [180, 188, 202], [236, 240, 248], [150, 172, 214], [92, 100, 116]] },
    { name: "Deep Ocean", bg: [2, 5, 12],
      stops: [[12, 34, 84], [22, 84, 154], [42, 152, 204], [64, 214, 204], [122, 232, 220], [74, 62, 172]] }
  ];
  const TRAILS = [
    { name: "Silky",   fade: 0.026 },
    { name: "Flowing", fade: 0.055 },
    { name: "Crisp",   fade: 0.11 }
  ];

  /* ============================ Perlin (gradient) noise, reseedable ============================ */
  // Classic improved-Perlin 3D. The permutation table is rebuilt on reseed so a fresh table gives
  // a genuinely new pattern; sampling coordinates are offset per-seed too.
  let perm = new Uint8Array(512);
  function makePerm(seed) {
    let s = (seed >>> 0) || 1;
    const rnd = function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) { const j = (rnd() * (i + 1)) | 0; const t = p[i]; p[i] = p[j]; p[j] = t; }
    const out = new Uint8Array(512);
    for (let i = 0; i < 512; i++) out[i] = p[i & 255];
    return out;
  }
  function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
  function grad(h, x, y, z) {
    h &= 15;
    const u = h < 8 ? x : y;
    const v = h < 4 ? y : (h === 12 || h === 14 ? x : z);
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
  }
  function perlin(x, y, z) {
    let X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255;
    x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);
    const u = fade(x), v = fade(y), w = fade(z);
    const A = perm[X] + Y, AA = perm[A] + Z, AB = perm[A + 1] + Z;
    const B = perm[X + 1] + Y, BA = perm[B] + Z, BB = perm[B + 1] + Z;
    const l = function (a, b, t) { return a + (b - a) * t; };
    return l(
      l(l(grad(perm[AA], x, y, z),         grad(perm[BA], x - 1, y, z), u),
        l(grad(perm[AB], x, y - 1, z),     grad(perm[BB], x - 1, y - 1, z), u), v),
      l(l(grad(perm[AA + 1], x, y, z - 1), grad(perm[BA + 1], x - 1, y, z - 1), u),
        l(grad(perm[AB + 1], x, y - 1, z - 1), grad(perm[BB + 1], x - 1, y - 1, z - 1), u), v),
      w);
  }
  // fbm angle field at a screen point, given a seed offset. Returns radians.
  function fieldAngle(px, py, ox, oy, z) {
    const bx = px * FIELD_SCALE + ox, by = py * FIELD_SCALE + oy;
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let o = 0; o < OCTAVES; o++) {
      sum += amp * perlin(bx * freq, by * freq, z * freq);
      norm += amp; amp *= 0.5; freq *= 2.0;
    }
    return (sum / norm) * Math.PI * FIELD_CURL;
  }

  /* ============================ state ============================ */
  let cssW = 1, cssH = 1, dpr = 1;
  let paletteIdx = 0, trailIdx = 1;
  let bucketColors = [];
  let fadeStyle = "rgba(4,7,12,0.055)";
  let overlayUp = true;

  let zTime = Math.random() * 100;   // field drift axis
  let colorPhase = Math.random();    // global palette rotation
  // reseed cross-fade: sample old + new field offsets and blend the flow VECTORS (handles wrap).
  let offCur = { x: Math.random() * 1000, y: Math.random() * 1000, c: Math.random() * 1000 };
  let offPrev = { x: offCur.x, y: offCur.y, c: offCur.c };
  let morphT = 1;                    // 1 = settled on offCur

  let particles = [];
  let impulses = [];
  let avgSpeed = SPEED, avgSpeedSm = SPEED;
  let stirring = false;

  /* ============================ palette ============================ */
  function paletteColor(pal, t) {
    t = t - Math.floor(t);
    const n = pal.stops.length, f = t * n;
    let i = Math.floor(f) % n; if (i < 0) i += n;
    let u = f - Math.floor(f); u = u * u * (3 - 2 * u);
    const a = pal.stops[i], b = pal.stops[(i + 1) % n];
    return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
  }
  function rebuildPalette() {
    const pal = PALETTES[paletteIdx];
    bucketColors = [];
    for (let k = 0; k < BUCKETS; k++) {
      const c = paletteColor(pal, k / BUCKETS);
      bucketColors.push("rgba(" + (c[0] | 0) + "," + (c[1] | 0) + "," + (c[2] | 0) + "," + SEG_ALPHA + ")");
    }
    rebuildFade();
  }
  function rebuildFade() {
    const bg = PALETTES[paletteIdx].bg;
    fadeStyle = "rgba(" + bg[0] + "," + bg[1] + "," + bg[2] + "," + TRAILS[trailIdx].fade + ")";
  }
  function bgSolid() { const bg = PALETTES[paletteIdx].bg; return "rgb(" + bg[0] + "," + bg[1] + "," + bg[2] + ")"; }

  /* ============================ particles ============================ */
  function particleCount() {
    const area = cssW * cssH;
    if (COARSE) return Math.min(1500, Math.max(500, Math.round(area / 900)));
    return Math.min(5000, Math.max(1400, Math.round(area / 520)));
  }
  function spawn(p, anywhere) {
    p.x = Math.random() * cssW;
    p.y = Math.random() * cssH;
    p.age = 0;
    p.maxAge = 1.6 + Math.random() * 2.6;
    // color drawn once at spawn from a low-frequency field → coherent color regions; the global
    // colorPhase then rotates the whole palette slowly over time.
    const cn = perlin(p.x * COLOR_SCALE + offCur.c, p.y * COLOR_SCALE - offCur.c, zTime * 0.4);
    p.ct = cn * 0.5 + 0.5;
    if (anywhere) p.age = Math.random() * p.maxAge; // stagger initial ages so nothing pulses in unison
  }
  function initParticles() {
    const n = particleCount();
    particles = new Array(n);
    for (let i = 0; i < n; i++) { const p = {}; spawn(p, true); particles[i] = p; }
  }

  /* ============================ disturbance ============================ */
  function addImpulse(x, y, dx, dy) {
    // clamp the carried drag vector so a fast flick doesn't blow particles across the screen
    let m = Math.hypot(dx, dy);
    if (m > 42) { dx = dx / m * 42; dy = dy / m * 42; m = 42; }
    impulses.push({ x: x, y: y, dx: dx, dy: dy, life: 1 });
    if (impulses.length > IMP_MAX) impulses.shift();
  }

  /* ============================ frame loop ============================ */
  let rafPending = false, lastT = 0;
  const segBuf = [];
  for (let k = 0; k < BUCKETS; k++) segBuf.push([]);

  function requestRender() { if (!rafPending) { rafPending = true; requestAnimationFrame(frame); } }

  function frame(ts) {
    rafPending = false;
    const dt = lastT ? Math.min(0.05, (ts - lastT) / 1000) : 0.016;
    lastT = ts;
    const dtScale = Math.min(2.2, dt * 60);

    zTime += dt * Z_SPEED;
    colorPhase += dt * COLOR_DRIFT;
    if (morphT < 1) morphT = Math.min(1, morphT + dt / MORPH_DUR);

    // decay impulses
    for (let i = impulses.length - 1; i >= 0; i--) {
      impulses[i].life -= dt / IMP_LIFE;
      if (impulses[i].life <= 0) impulses.splice(i, 1);
    }

    step(dtScale);
    updateAudio(dt);

    if (!document.hidden) requestRender();
    else lastT = 0;
  }

  function step(dtScale) {
    // 1) fade the whole field a touch toward the palette background (this is what makes trails)
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.fillStyle = fadeStyle;
    ctx.fillRect(0, 0, cssW, cssH);

    // 2) advance every particle, collecting segments into per-color buckets
    for (let k = 0; k < BUCKETS; k++) segBuf[k].length = 0;

    const morphing = morphT < 1;
    const spd = SPEED * dtScale;
    const nImp = impulses.length;
    let speedSum = 0;

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      let ang = fieldAngle(p.x, p.y, offCur.x, offCur.y, zTime);
      let vx = Math.cos(ang), vy = Math.sin(ang);

      if (morphing) {
        const a0 = fieldAngle(p.x, p.y, offPrev.x, offPrev.y, zTime);
        // blend the two flow directions as vectors so the cross-fade never spins the long way round
        const bx = Math.cos(a0) + (vx - Math.cos(a0)) * morphT;
        const by = Math.sin(a0) + (vy - Math.sin(a0)) * morphT;
        const bl = Math.hypot(bx, by) || 1;
        vx = bx / bl; vy = by / bl;
      }

      // disturbance from drag impulses
      let ax = 0, ay = 0;
      for (let j = 0; j < nImp; j++) {
        const im = impulses[j];
        const ddx = p.x - im.x, ddy = p.y - im.y;
        const d2 = ddx * ddx + ddy * ddy;
        if (d2 < IMP_R * IMP_R) {
          const d = Math.sqrt(d2) + 0.001;
          const fall = (1 - d / IMP_R) * im.life;
          ax += im.dx * fall * IMP_PUSH;            // shove along the drag
          ay += im.dy * fall * IMP_PUSH;
          ax += (-ddy / d) * fall * IMP_SWIRL;      // + a gentle swirl around the touch point
          ay += (ddx / d) * fall * IMP_SWIRL;
        }
      }

      const stepX = vx * spd + ax;
      const stepY = vy * spd + ay;
      const nx = p.x + stepX, ny = p.y + stepY;

      // bucket by color (palette rotates via colorPhase)
      let bi = ((p.ct + colorPhase) % 1); if (bi < 0) bi += 1;
      bi = (bi * BUCKETS) | 0; if (bi >= BUCKETS) bi = BUCKETS - 1;
      const buf = segBuf[bi];
      buf.push(p.x, p.y, nx, ny);

      speedSum += Math.abs(stepX) + Math.abs(stepY);

      p.x = nx; p.y = ny; p.age += 0.0166 * dtScale;
      if (p.age > p.maxAge || nx < -20 || nx > cssW + 20 || ny < -20 || ny > cssH + 20) spawn(p, false);
    }
    avgSpeed = speedSum / (particles.length * 2);

    // 3) stroke each color bucket once (additive → glowing ribbon cores)
    ctx.globalCompositeOperation = "lighter";
    ctx.lineWidth = LW;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (let k = 0; k < BUCKETS; k++) {
      const buf = segBuf[k];
      if (buf.length === 0) continue;
      ctx.strokeStyle = bucketColors[k];
      ctx.beginPath();
      for (let m = 0; m < buf.length; m += 4) {
        ctx.moveTo(buf[m], buf[m + 1]);
        ctx.lineTo(buf[m + 2], buf[m + 3]);
      }
      ctx.stroke();
    }
    ctx.globalCompositeOperation = "source-over";
  }

  /* ============================ reseed ============================ */
  function reseed() {
    offPrev = { x: offCur.x, y: offCur.y, c: offCur.c };
    offCur = { x: Math.random() * 1000, y: Math.random() * 1000, c: Math.random() * 1000 };
    perm = makePerm((Math.random() * 0xffffffff) >>> 0);
    morphT = 0;
    whoosh();
    requestRender();
    if (window.gtag) { try { gtag("event", "flow_reseed"); } catch (e) {} }
  }

  /* ============================ controls ============================ */
  function setPalette(i) {
    paletteIdx = ((i % PALETTES.length) + PALETTES.length) % PALETTES.length;
    paletteBtn.textContent = PALETTES[paletteIdx].name;
    rebuildPalette();
    chime();
    requestRender();
  }
  function setTrails(i) {
    trailIdx = ((i % TRAILS.length) + TRAILS.length) % TRAILS.length;
    trailsBtn.textContent = "Trails · " + TRAILS[trailIdx].name;
    rebuildFade();
    requestRender();
  }

  paletteBtn.addEventListener("click", function () { setPalette(paletteIdx + 1); });
  trailsBtn.addEventListener("click", function () { setTrails(trailIdx + 1); });
  reseedBtn.addEventListener("click", function () { reseed(); });
  soundBtn.addEventListener("click", function () { setSound(!audioOn); });

  window.addEventListener("keydown", function (e) {
    if (overlayUp) return;
    const k = e.key.toLowerCase();
    if (k === "p") setPalette(paletteIdx + 1);
    else if (k === "t") setTrails(trailIdx + 1);
    else if (k === "r" || k === " ") { e.preventDefault(); reseed(); }
    else if (k === "s") setSound(!audioOn);
  });

  /* ============================ pointer interaction ============================ */
  const active = new Map();
  let downX = 0, downY = 0, downT = 0, moved = 0;

  function xy(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  function onDown(e) {
    if (overlayUp) return;
    canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
    const p = xy(e);
    active.set(e.pointerId, p);
    downX = p.x; downY = p.y; downT = performance.now(); moved = 0;
    stirring = true;
    canvas.classList.add("is-stirring");
    hideHint();
    startAudio();
    requestRender();
  }
  function onMove(e) {
    const prev = active.get(e.pointerId);
    if (!prev) return;
    const p = xy(e);
    const dx = p.x - prev.x, dy = p.y - prev.y;
    moved += Math.hypot(dx, dy);
    if (Math.abs(dx) + Math.abs(dy) > 0.5) addImpulse(p.x, p.y, dx, dy);
    active.set(e.pointerId, p);
    requestRender();
  }
  function onUp(e) {
    if (!active.has(e.pointerId)) return;
    active.delete(e.pointerId);
    if (active.size === 0) {
      stirring = false;
      canvas.classList.remove("is-stirring");
      // a quick, near-stationary press = tap → reseed
      const dt = performance.now() - downT;
      if (moved < 10 && dt < 340) reseed();
    }
    requestRender();
  }
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);
  canvas.addEventListener("contextmenu", function (e) { e.preventDefault(); });

  /* ============================ hint ============================ */
  let hintTimer = null;
  function hideHint() { hint.classList.add("is-gone"); }
  function setHint(t) {
    hint.textContent = t;
    hint.classList.remove("is-gone");
    if (hintTimer) clearTimeout(hintTimer);
    hintTimer = setTimeout(hideHint, 4600);
  }

  /* ============================ audio (airy evolving wind pad) ============================ */
  let AC = null, outGain = null, master = null, windLP = null, windBP = null, shimmerGain = null, fxBus = null;
  let audioOn = true, audioStarted = false;
  const MASTER_VOL = 0.34;

  function noiseBuffer(dur) {
    const rate = AC.sampleRate, len = Math.floor(rate * dur);
    const buf = AC.createBuffer(1, len, rate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;   // brown-ish noise (soft, airy)
      d[i] = last * 3.2;
    }
    return buf;
  }
  function impulseBuffer(dur, decay) {
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
    // iOS unlock: 1-sample silent buffer inside the gesture
    try { const b = AC.createBuffer(1, 1, 22050); const s = AC.createBufferSource(); s.buffer = b; s.connect(AC.destination); s.start(0); } catch (e) {}

    outGain = AC.createGain(); outGain.gain.value = audioOn ? MASTER_VOL : 0.0001; outGain.connect(AC.destination);
    master = AC.createGain(); master.gain.value = 0.0001; // fade-in ramp
    const masterLP = AC.createBiquadFilter(); masterLP.type = "lowpass"; masterLP.frequency.value = 5200; masterLP.Q.value = 0.5;
    master.connect(masterLP); masterLP.connect(outGain);

    const comp = AC.createDynamicsCompressor();
    comp.threshold.value = -15; comp.ratio.value = 3; comp.attack.value = 0.03; comp.release.value = 0.35;
    comp.connect(master);

    // convolver reverb for space (smooth impulse so the tail isn't grainy)
    const conv = AC.createConvolver(); conv.buffer = impulseBuffer(3.4, 2.4);
    const wet = AC.createGain(); wet.gain.value = 0.6; conv.connect(wet); wet.connect(comp);
    const dry = AC.createGain(); dry.gain.value = 0.85; dry.connect(comp);
    fxBus = AC.createGain(); fxBus.gain.value = 1; fxBus.connect(dry); fxBus.connect(conv);

    // --- airy wind: brown noise → moving bandpass → lowpass ---
    const wind = AC.createBufferSource(); wind.buffer = noiseBuffer(6); wind.loop = true;
    windBP = AC.createBiquadFilter(); windBP.type = "bandpass"; windBP.frequency.value = 520; windBP.Q.value = 0.9;
    windLP = AC.createBiquadFilter(); windLP.type = "lowpass"; windLP.frequency.value = 1400; windLP.Q.value = 0.4;
    const windGain = AC.createGain(); windGain.gain.value = 0.5;
    wind.connect(windBP); windBP.connect(windLP); windLP.connect(windGain); windGain.connect(fxBus);
    wind.start();
    // slow LFO drifting the bandpass so the wind breathes
    const wlfo = AC.createOscillator(); wlfo.type = "sine"; wlfo.frequency.value = 0.06;
    const wlfoG = AC.createGain(); wlfoG.gain.value = 220; wlfo.connect(wlfoG); wlfoG.connect(windBP.frequency); wlfo.start();

    // --- warm drone pad: soft open fifths, gently panned, slow amplitude breath ---
    const padGain = AC.createGain(); padGain.gain.value = 0.15; padGain.connect(fxBus);
    const NOTES = [98.0, 146.83, 196.0, 293.66];  // G2 D3 G3 D4
    NOTES.forEach(function (f, i) {
      const pan = AC.createStereoPanner ? AC.createStereoPanner() : null;
      let dest = padGain;
      if (pan) { pan.pan.value = (i / (NOTES.length - 1) - 0.5) * 0.7; pan.connect(padGain); dest = pan; }
      [0, 6].forEach(function (cents, k) {
        const o = AC.createOscillator(); o.type = "triangle";
        o.frequency.value = f; o.detune.value = cents + (i - 1.5) * 1.5;
        const g = AC.createGain(); g.gain.value = (0.5 / (i + 1)) * (k ? 0.5 : 1);
        o.connect(g); g.connect(dest); o.start();
      });
    });
    const alfo = AC.createOscillator(); alfo.type = "sine"; alfo.frequency.value = 0.05;
    const alfoG = AC.createGain(); alfoG.gain.value = 0.05; alfo.connect(alfoG); alfoG.connect(padGain.gain); alfo.start();

    // --- shimmer partial that swells with flow speed ---
    shimmerGain = AC.createGain(); shimmerGain.gain.value = 0; shimmerGain.connect(fxBus);
    const sh = AC.createOscillator(); sh.type = "sine"; sh.frequency.value = 587.33; sh.connect(shimmerGain); sh.start();
    const sh2 = AC.createOscillator(); sh2.type = "sine"; sh2.frequency.value = 880; const sh2g = AC.createGain(); sh2g.gain.value = 0.5; sh2.connect(sh2g); sh2g.connect(shimmerGain); sh2.start();

    master.gain.setValueAtTime(0.0001, AC.currentTime);
    master.gain.linearRampToValueAtTime(1, AC.currentTime + 2.4);
  }
  function updateAudio() {
    if (!AC || !audioOn) return;
    avgSpeedSm += (avgSpeed - avgSpeedSm) * 0.06;
    const flow = Math.min(1, Math.max(0, (avgSpeedSm - 0.5) / 2.4));  // 0..1 movement energy
    const now = AC.currentTime;
    windLP.frequency.setTargetAtTime(1100 + flow * 2600, now, 0.25);
    shimmerGain.gain.setTargetAtTime(0.006 + flow * 0.05, now, 0.3);
  }
  function chime() {
    if (!AC || !audioOn || !fxBus) return;
    const now = AC.currentTime;
    const degs = [0, 3, 5, 7, 10];
    const base = 392 * Math.pow(2, (degs[(Math.random() * degs.length) | 0] + (Math.random() < 0.5 ? 0 : 12)) / 12);
    [1, 2.0].forEach(function (mult, i) {
      const o = AC.createOscillator(); o.type = "sine"; o.frequency.value = base * mult;
      const g = AC.createGain(); g.gain.value = 0;
      o.connect(g); g.connect(fxBus);
      const amp = 0.11 / (i + 1);
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(amp, now + 0.014);
      g.gain.exponentialRampToValueAtTime(0.0008, now + 1.1 - i * 0.2);
      o.start(now); o.stop(now + 1.2);
    });
  }
  function whoosh() {
    if (!AC || !audioOn || !fxBus) return;
    const now = AC.currentTime;
    const src = AC.createBufferSource(); src.buffer = impulseBuffer(0.9, 1.4);
    const bp = AC.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = 0.8;
    bp.frequency.setValueAtTime(300, now);
    bp.frequency.exponentialRampToValueAtTime(2400, now + 0.5);
    const g = AC.createGain(); g.gain.value = 0;
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(0.14, now + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0006, now + 0.85);
    src.connect(bp); bp.connect(g); g.connect(fxBus);
    src.start(now); src.stop(now + 0.95);
  }
  function setSound(on) {
    audioOn = on;
    soundBtn.setAttribute("aria-pressed", on ? "true" : "false");
    if (on) { startAudio(); if (AC && outGain) { AC.resume(); outGain.gain.setTargetAtTime(MASTER_VOL, AC.currentTime, 0.3); } }
    else if (AC && outGain) { outGain.gain.setTargetAtTime(0.0001, AC.currentTime, 0.2); }
  }

  /* ============================ resize (no abrupt wipe) ============================ */
  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const nw = Math.max(1, Math.round(w * dpr)), nh = Math.max(1, Math.round(h * dpr));
    if (canvas.width === nw && canvas.height === nh) { cssW = w; cssH = h; return; }

    // preserve the current picture: copy it, resize, and paint it back scaled so the ribbons
    // never blink to black on a rotate / window drag.
    let tmp = null;
    if (canvas.width > 0 && canvas.height > 0) {
      tmp = document.createElement("canvas"); tmp.width = canvas.width; tmp.height = canvas.height;
      tmp.getContext("2d").drawImage(canvas, 0, 0);
    }
    canvas.width = nw; canvas.height = nh;
    canvas.style.width = w + "px"; canvas.style.height = h + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);   // draw everything in css pixels
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = bgSolid(); ctx.fillRect(0, 0, w, h);
    if (tmp) ctx.drawImage(tmp, 0, 0, w, h);
    cssW = w; cssH = h;

    // keep density sane across big size changes
    const target = particleCount();
    if (particles.length) {
      if (target > particles.length) { for (let i = particles.length; i < target; i++) { const p = {}; spawn(p, true); particles.push(p); } }
      else if (target < particles.length) particles.length = target;
    }
    requestRender();
  }
  window.addEventListener("resize", resize);
  window.addEventListener("orientationchange", function () { setTimeout(resize, 140); });
  document.addEventListener("visibilitychange", function () { if (!document.hidden) { lastT = 0; requestRender(); } });

  /* ============================ boot ============================ */
  cssW = window.innerWidth; cssH = window.innerHeight;
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr);
  canvas.style.width = cssW + "px"; canvas.style.height = cssH + "px";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  perm = makePerm((Math.random() * 0xffffffff) >>> 0);
  ctx.fillStyle = bgSolid(); ctx.fillRect(0, 0, cssW, cssH);
  rebuildPalette();
  initParticles();
  soundBtn.setAttribute("aria-pressed", "true");
  requestRender();   // field starts flowing behind the intro overlay

  function dismissOverlay() {
    if (!overlayUp) return;
    overlayUp = false;
    overlay.classList.add("is-hidden");
    setTimeout(function () { overlay.hidden = true; }, 360);
    if (audioOn) startAudio();
    setHint("drag to stir the flow · tap for a new pattern");
    lastT = 0;
    requestRender();
  }
  ovBtn.addEventListener("click", dismissOverlay);
})();
