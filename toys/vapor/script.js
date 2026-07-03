/* Vapor — an interactive fluid-smoke simulation (Jos Stam "stable fluids":
 * Navier-Stokes on a grid, with 3 dye channels, buoyancy and vorticity for
 * curls). Drag to stir colored smoke, tap for a puff; ambient plumes keep it
 * alive. Vanilla Canvas 2D + Web Audio. */
(function () {
  "use strict";

  var canvas = document.getElementById("canvas");
  var ctx = canvas.getContext("2d");
  var soundBtn = document.getElementById("soundBtn");
  var paletteBtn = document.getElementById("paletteBtn");
  var clearBtn = document.getElementById("clearBtn");
  var speedBtn = document.getElementById("speedBtn");
  var hintEl = document.getElementById("hint");

  var W = 0, H = 0, DPR = 1;

  // ---- fluid grid (square, stretched to fill; resolution-independent) ----
  var N = 120, ITER = 10;
  var NN = N + 2, size = NN * NN;
  function IX(i, j) { return i + NN * j; }
  function arr() { return new Float32Array(size); }
  var S = { u: arr(), v: arr(), u0: arr(), v0: arr(), r: arr(), g: arr(), b: arr(), r0: arr(), g0: arr(), b0: arr(), p: arr(), div: arr(), curl: arr() };
  function swap(a, c) { var t = S[a]; S[a] = S[c]; S[c] = t; }

  // tunables
  var VISC = 0.00001, DECAY = 0.992, VORT = 0.14;
  var IFORCE = 5.2, DYE = 72, BR = 4;
  var BASE_DT = 0.0115, BASE_BUOY = 5;              // motion baseline
  var SPEEDS = [                                    // visible Calm/Flow/Lively control
    { name: "Calm",   dt: 0.70, buoy: 0.8 },
    { name: "Flow",   dt: 0.88, buoy: 0.9 },        // default — a touch slower than baseline
    { name: "Lively", dt: 1.24, buoy: 1.25 }
  ];
  var speed = 1, curDT = BASE_DT * SPEEDS[1].dt, curBUOY = BASE_BUOY * SPEEDS[1].buoy;
  function applySpeed() { var s = SPEEDS[speed]; curDT = BASE_DT * s.dt; curBUOY = BASE_BUOY * s.buoy; }
  // generative ambient tune (Flowful-style): a soft, semi-random melody in the
  // palette's key that plays itself over the pad drone.
  var MEL_INT = 1.45, MEL_JITTER = 0.55, MEL_REST = 0.2;
  var mel = { next: 2.4, idx: 5 };

  var sim = document.createElement("canvas"); sim.width = N; sim.height = N;
  var simCtx = sim.getContext("2d");
  var imgData = simCtx.createImageData(N, N);

  var mouse = { x: 0, y: 0, px: 0, py: 0, down: false, moved: false, downT: 0 };
  var MODES = [
    { name: "Spectrum", hues: null },
    { name: "Fire", hues: [0, 45] },
    { name: "Ocean", hues: [175, 235] },
    { name: "Aurora", hues: [110, 290] },
    { name: "Mono", hues: "mono" }
  ];
  var mode = 0, soundOn = true, t = 0, ambT = 0, activity = 0;

  // Palette = musical key/mood: a pad chord + a scale root for puff bells.
  function mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  var KEYS = [
    { pad: [48, 55, 60, 67], root: 60, minor: false }, // Spectrum — C major
    { pad: [45, 52, 57, 64], root: 57, minor: true  }, // Fire — A minor (warm)
    { pad: [50, 57, 62, 69], root: 62, minor: false }, // Ocean — D major (airy)
    { pad: [45, 57, 64, 69], root: 69, minor: false }, // Aurora — high A (shimmer)
    { pad: [43, 50, 55, 62], root: 55, minor: false }  // Mono — G major (soft)
  ];

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.floor(W * DPR); canvas.height = Math.floor(H * DPR);
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  window.addEventListener("resize", resize);

  // ---------------- solver ----------------
  function addSource(x, s, dt) { for (var i = 0; i < size; i++) x[i] += dt * s[i]; }
  function setBnd(bnd, x) {
    for (var i = 1; i <= N; i++) {
      x[IX(0, i)] = bnd === 1 ? -x[IX(1, i)] : x[IX(1, i)];
      x[IX(N + 1, i)] = bnd === 1 ? -x[IX(N, i)] : x[IX(N, i)];
      x[IX(i, 0)] = bnd === 2 ? -x[IX(i, 1)] : x[IX(i, 1)];
      x[IX(i, N + 1)] = bnd === 2 ? -x[IX(i, N)] : x[IX(i, N)];
    }
    x[IX(0, 0)] = 0.5 * (x[IX(1, 0)] + x[IX(0, 1)]);
    x[IX(0, N + 1)] = 0.5 * (x[IX(1, N + 1)] + x[IX(0, N)]);
    x[IX(N + 1, 0)] = 0.5 * (x[IX(N, 0)] + x[IX(N + 1, 1)]);
    x[IX(N + 1, N + 1)] = 0.5 * (x[IX(N, N + 1)] + x[IX(N + 1, N)]);
  }
  function linSolve(bnd, x, x0, a, c) {
    var cr = 1 / c;
    for (var k = 0; k < ITER; k++) {
      for (var j = 1; j <= N; j++) for (var i = 1; i <= N; i++) {
        x[IX(i, j)] = (x0[IX(i, j)] + a * (x[IX(i - 1, j)] + x[IX(i + 1, j)] + x[IX(i, j - 1)] + x[IX(i, j + 1)])) * cr;
      }
      setBnd(bnd, x);
    }
  }
  function diffuse(bnd, x, x0, diff, dt) { var a = dt * diff * N * N; linSolve(bnd, x, x0, a, 1 + 4 * a); }
  function advect(bnd, d, d0, u, v, dt) {
    var dt0 = dt * N;
    for (var j = 1; j <= N; j++) for (var i = 1; i <= N; i++) {
      var x = i - dt0 * u[IX(i, j)], y = j - dt0 * v[IX(i, j)];
      if (x < 0.5) x = 0.5; if (x > N + 0.5) x = N + 0.5; var i0 = x | 0, i1 = i0 + 1;
      if (y < 0.5) y = 0.5; if (y > N + 0.5) y = N + 0.5; var j0 = y | 0, j1 = j0 + 1;
      var s1 = x - i0, s0 = 1 - s1, t1 = y - j0, t0 = 1 - t1;
      d[IX(i, j)] = s0 * (t0 * d0[IX(i0, j0)] + t1 * d0[IX(i0, j1)]) + s1 * (t0 * d0[IX(i1, j0)] + t1 * d0[IX(i1, j1)]);
    }
    setBnd(bnd, d);
  }
  function project(u, v, pp, div) {
    for (var j = 1; j <= N; j++) for (var i = 1; i <= N; i++) {
      div[IX(i, j)] = -0.5 * (u[IX(i + 1, j)] - u[IX(i - 1, j)] + v[IX(i, j + 1)] - v[IX(i, j - 1)]) / N;
      pp[IX(i, j)] = 0;
    }
    setBnd(0, div); setBnd(0, pp); linSolve(0, pp, div, 1, 4);
    for (var j2 = 1; j2 <= N; j2++) for (var i2 = 1; i2 <= N; i2++) {
      u[IX(i2, j2)] -= 0.5 * N * (pp[IX(i2 + 1, j2)] - pp[IX(i2 - 1, j2)]);
      v[IX(i2, j2)] -= 0.5 * N * (pp[IX(i2, j2 + 1)] - pp[IX(i2, j2 - 1)]);
    }
    setBnd(1, u); setBnd(2, v);
  }
  function vorticityBuoy(dt) {
    var c = S.curl, u = S.u, v = S.v;
    for (var j = 1; j <= N; j++) for (var i = 1; i <= N; i++) c[IX(i, j)] = 0.5 * (v[IX(i + 1, j)] - v[IX(i - 1, j)] - (u[IX(i, j + 1)] - u[IX(i, j - 1)]));
    for (var j2 = 1; j2 <= N; j2++) for (var i2 = 1; i2 <= N; i2++) {
      var dwdx = 0.5 * (Math.abs(c[IX(i2 + 1, j2)]) - Math.abs(c[IX(i2 - 1, j2)]));
      var dwdy = 0.5 * (Math.abs(c[IX(i2, j2 + 1)]) - Math.abs(c[IX(i2, j2 - 1)]));
      var len = Math.sqrt(dwdx * dwdx + dwdy * dwdy) + 1e-6;
      var vc = c[IX(i2, j2)];
      S.u0[IX(i2, j2)] += VORT * (dwdy / len) * vc * N;
      S.v0[IX(i2, j2)] += VORT * (-dwdx / len) * vc * N;
      var dens = S.r[IX(i2, j2)] + S.g[IX(i2, j2)] + S.b[IX(i2, j2)];
      S.v0[IX(i2, j2)] -= curBUOY * dens;       // buoyancy: smoke rises
    }
  }

  function step(dt) {
    vorticityBuoy(dt);
    addSource(S.u, S.u0, dt); addSource(S.v, S.v0, dt);
    swap("u0", "u"); diffuse(1, S.u, S.u0, VISC, dt);
    swap("v0", "v"); diffuse(2, S.v, S.v0, VISC, dt);
    project(S.u, S.v, S.u0, S.v0);
    swap("u0", "u"); swap("v0", "v");
    advect(1, S.u, S.u0, S.u0, S.v0, dt); advect(2, S.v, S.v0, S.u0, S.v0, dt);
    project(S.u, S.v, S.u0, S.v0);
    // dye
    dens("r", "r0", dt); dens("g", "g0", dt); dens("b", "b0", dt);
    for (var i = 0; i < size; i++) { S.r[i] *= DECAY; S.g[i] *= DECAY; S.b[i] *= DECAY; S.u0[i] = 0; S.v0[i] = 0; S.r0[i] = 0; S.g0[i] = 0; S.b0[i] = 0; }
  }
  function dens(xk, x0k, dt) { addSource(S[xk], S[x0k], dt); swap(x0k, xk); advect(0, S[xk], S[x0k], S.u, S.v, dt); }

  // ---------------- injection ----------------
  function hslRGB(h, s, l) {
    h /= 360; var a = s * Math.min(l, 1 - l);
    function f(n) { var k = (n + h * 12) % 12; return l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1))); }
    return [f(0), f(8), f(4)];
  }
  function injColor() {
    var m = MODES[mode];
    if (m.hues === "mono") return [1, 1, 1];
    var h;
    if (!m.hues) h = (t * 60) % 360;                               // spectrum: cycles over time
    else h = m.hues[0] + ((t * 40 + Math.sin(t * 0.7) * 30) % 1 + 1) % 1 * (m.hues[1] - m.hues[0]);
    return hslRGB(h, 0.9, 0.58);
  }
  function inject(gx, gy, radius, col, amt, fx, fy) {
    var r2 = radius * radius;
    var lo = Math.max(1, Math.floor(gx - radius)), hi = Math.min(N, Math.ceil(gx + radius));
    var lo2 = Math.max(1, Math.floor(gy - radius)), hi2 = Math.min(N, Math.ceil(gy + radius));
    for (var j = lo2; j <= hi2; j++) for (var i = lo; i <= hi; i++) {
      var dx = i - gx, dy = j - gy, d2 = dx * dx + dy * dy; if (d2 > r2) continue;
      var w = Math.exp(-d2 / (r2 * 0.5)), k = IX(i, j);
      S.r0[k] += col[0] * amt * w; S.g0[k] += col[1] * amt * w; S.b0[k] += col[2] * amt * w;
      if (fx || fy) { S.u0[k] += fx * w; S.v0[k] += fy * w; }
    }
  }
  function toGrid(mx, my) { return { x: mx / W * N, y: my / H * N }; }

  function ambient(dt) {
    ambT -= dt;
    if (ambT > 0) return;
    // When the tune is playing, its notes feed the smoke — so keep this base
    // drift sparse and gentle; when muted/pre-unlock, it keeps the scene alive.
    var tuneOn = soundOn && actx && padOscs.length;
    ambT = (tuneOn ? 1.7 : 0.7) + Math.random() * (tuneOn ? 1.8 : 1.1);
    var gx = N * (0.15 + Math.random() * 0.7), gy = N * (0.55 + Math.random() * 0.4);
    var ang = -Math.PI / 2 + (Math.random() * 2 - 1) * 0.6;
    inject(gx, gy, BR + 2, injColor(), DYE * (tuneOn ? 0.9 : 1.4), Math.cos(ang) * 22, Math.sin(ang) * 30);
  }

  // ---------------- render ----------------
  function render() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    var d = imgData.data;
    for (var j = 1; j <= N; j++) for (var i = 1; i <= N; i++) {
      var k = IX(i, j), pi = ((j - 1) * N + (i - 1)) * 4;
      d[pi] = 255 * (1 - Math.exp(-S.r[k] * 3.2));
      d[pi + 1] = 255 * (1 - Math.exp(-S.g[k] * 3.2));
      d[pi + 2] = 255 * (1 - Math.exp(-S.b[k] * 3.2));
      d[pi + 3] = 255;
    }
    simCtx.putImageData(imgData, 0, 0);
    ctx.fillStyle = "#05060b"; ctx.fillRect(0, 0, W, H);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(sim, 0, 0, W, H);
    // bloom
    ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.globalAlpha = 0.5;
    ctx.filter = "blur(" + Math.max(4, Math.min(W, H) * 0.012) + "px)";
    ctx.drawImage(sim, 0, 0, W, H);
    ctx.filter = "none"; ctx.restore();
  }

  var last = 0;
  function frame(ts) {
    var dt = last ? Math.min((ts - last) / 1000, 0.033) : 0.016; last = ts;
    t += dt;
    ambient(dt);
    if (mouse.down && mouse.moved) {
      var g = toGrid(mouse.x, mouse.y);
      var fx = (mouse.x - mouse.px) * IFORCE, fy = (mouse.y - mouse.py) * IFORCE;
      inject(g.x, g.y, BR, injColor(), DYE, fx, fy);
      mouse.px = mouse.x; mouse.py = mouse.y; mouse.moved = false;
    }
    step(curDT);
    render();
    // audio activity
    if (soundOn && actx) { var a = 0; for (var s = 0; s < size; s += 37) a += Math.abs(S.u[s]) + Math.abs(S.v[s]); activity = a / (size / 37); ambientTick(); melodyTick(dt); }
    requestAnimationFrame(frame);
  }

  // ---------------- input ----------------
  function puff(mx, my) {
    var g = toGrid(mx, my), col = injColor();
    var r2 = (BR + 3) * (BR + 3);
    var lo = Math.max(1, Math.floor(g.x - BR - 3)), hi = Math.min(N, Math.ceil(g.x + BR + 3));
    var lo2 = Math.max(1, Math.floor(g.y - BR - 3)), hi2 = Math.min(N, Math.ceil(g.y + BR + 3));
    for (var j = lo2; j <= hi2; j++) for (var i = lo; i <= hi; i++) {
      var dx = i - g.x, dy = j - g.y, dd = Math.sqrt(dx * dx + dy * dy); if (dd * dd > r2) continue;
      var w = Math.exp(-(dd * dd) / (r2 * 0.5)), k = IX(i, j), inv = dd > 0.01 ? 1 / dd : 0;
      S.r0[k] += col[0] * DYE * 2.2 * w; S.g0[k] += col[1] * DYE * 2.2 * w; S.b0[k] += col[2] * DYE * 2.2 * w;
      S.u0[k] += dx * inv * 34 * w; S.v0[k] += dy * inv * 34 * w;
    }
    sndPuff(); sndBell(mx, my);
  }
  canvas.addEventListener("pointerdown", function (e) { e.preventDefault(); unlock(); mouse.x = e.clientX; mouse.y = e.clientY; mouse.px = e.clientX; mouse.py = e.clientY; mouse.down = true; mouse.moved = false; mouse.downT = perfNow(); fade(); });
  canvas.addEventListener("pointermove", function (e) { mouse.x = e.clientX; mouse.y = e.clientY; if (mouse.down) mouse.moved = true; });
  window.addEventListener("pointerup", function (e) { if (mouse.down && !mouse.moved && perfNow() - mouse.downT < 300) puff(e.clientX, e.clientY); mouse.down = false; });
  canvas.addEventListener("pointercancel", function () { mouse.down = false; });

  paletteBtn.addEventListener("click", function () { mode = (mode + 1) % MODES.length; paletteBtn.textContent = MODES[mode].name; setKey(); unlock(); });
  speedBtn.addEventListener("click", function () { speed = (speed + 1) % SPEEDS.length; speedBtn.textContent = SPEEDS[speed].name; applySpeed(); unlock(); });
  clearBtn.addEventListener("click", function () { for (var i = 0; i < size; i++) { S.r[i] = S.g[i] = S.b[i] = S.u[i] = S.v[i] = 0; } unlock(); });
  soundBtn.addEventListener("click", function () { soundOn = !soundOn; soundBtn.setAttribute("aria-pressed", soundOn ? "true" : "false"); if (outGain) outGain.gain.value = soundOn ? 1 : 0; unlock(); });
  var faded = false;
  function fade() { if (!faded) { faded = true; setTimeout(function () { hintEl.classList.add("is-gone"); }, 500); } }
  setTimeout(function () { hintEl.classList.add("is-gone"); }, 6000);

  // ============================ AUDIO ============================
  var actx = null, master = null, outGain = null, wind = null, windGain = null, windLP = null, convo = null, wet = null;
  var padMix = null, padLP = null, padLevel = null, padLFO = null, padLFOg = null, padOscs = [];
  function perfNow() { return (window.performance && performance.now) ? performance.now() : Date.now(); }
  function initAudio() {
    if (actx) return;
    try {
      actx = new (window.AudioContext || window.webkitAudioContext)();
      outGain = actx.createGain(); outGain.gain.value = soundOn ? 1 : 0;
      master = actx.createGain(); master.gain.value = 0.85;
      convo = actx.createConvolver(); convo.buffer = makeImpulse(2.4, 3);
      wet = actx.createGain(); wet.gain.value = 0.25;
      master.connect(outGain); wet.connect(convo); convo.connect(outGain); outGain.connect(actx.destination);
      wind = pink(); windLP = actx.createBiquadFilter(); windLP.type = "lowpass"; windLP.frequency.value = 500;
      windGain = actx.createGain(); windGain.gain.value = 0;
      wind.connect(windLP); windLP.connect(windGain); windGain.connect(master); windGain.connect(wet); wind.start(0);
      buildPad();
    } catch (e) { actx = null; }
  }
  // A soft evolving pad chord (the current palette's key) that swells + brightens
  // as the smoke moves — reactive ambient music you play by stirring.
  function buildPad() {
    padMix = actx.createGain(); padMix.gain.value = 1;
    padLP = actx.createBiquadFilter(); padLP.type = "lowpass"; padLP.frequency.value = 420; padLP.Q.value = 0.4;
    padLevel = actx.createGain(); padLevel.gain.value = 0;
    padMix.connect(padLP); padLP.connect(padLevel); padLevel.connect(master); padLevel.connect(wet);
    var k = KEYS[mode];
    for (var i = 0; i < k.pad.length; i++) {
      var o = actx.createOscillator(); o.type = i === 0 ? "triangle" : "sine";
      o.frequency.value = mtof(k.pad[i]); o.detune.value = (i - 1.5) * 5;
      var g = actx.createGain(); g.gain.value = i === 0 ? 0.5 : 0.26 / i;
      o.connect(g); g.connect(padMix); o.start(0);
      padOscs.push(o);
    }
    padLFO = actx.createOscillator(); padLFO.frequency.value = 0.05;   // slow shimmer on the filter
    padLFOg = actx.createGain(); padLFOg.gain.value = 130;
    padLFO.connect(padLFOg); padLFOg.connect(padLP.frequency); padLFO.start(0);
  }
  function setKey() {
    if (!actx || !padOscs.length) return;
    var k = KEYS[mode], now = actx.currentTime;
    for (var i = 0; i < padOscs.length; i++) padOscs[i].frequency.setTargetAtTime(mtof(k.pad[i]), now, 0.35);
  }
  function makeImpulse(dur, decay) { var n = Math.floor(actx.sampleRate * dur), b = actx.createBuffer(2, n, actx.sampleRate); for (var ch = 0; ch < 2; ch++) { var d = b.getChannelData(ch); for (var i = 0; i < n; i++) { var x = i / n; d[i] = (Math.random() * 2 - 1) * Math.pow(1 - x, decay); } } return b; }
  function pink() { var n = actx.sampleRate * 2, b = actx.createBuffer(1, n, actx.sampleRate), d = b.getChannelData(0), b0 = 0, b1 = 0, b2 = 0; for (var i = 0; i < n; i++) { var w = Math.random() * 2 - 1; b0 = 0.997 * b0 + 0.029 * w; b1 = 0.985 * b1 + 0.032 * w; b2 = 0.95 * b2 + 0.048 * w; d[i] = (b0 + b1 + b2 + w * 0.1) * 0.18; } var s = actx.createBufferSource(); s.buffer = b; s.loop = true; return s; }
  function unlock() { initAudio(); if (actx && actx.state === "suspended") actx.resume(); if (actx) { var b = actx.createBuffer(1, 1, 22050), s = actx.createBufferSource(); s.buffer = b; s.connect(actx.destination); s.start(0); } }
  function ambientTick() {
    if (!windGain) return; var now = actx.currentTime;
    // wind is now a thin air layer under the pad
    windGain.gain.setTargetAtTime(Math.min(0.12, 0.02 + activity * 0.045), now, 0.2);
    windLP.frequency.setTargetAtTime(420 + Math.min(1000, activity * 800), now, 0.25);
    if (padLevel) {
      padLevel.gain.setTargetAtTime(Math.min(0.17, 0.03 + activity * 0.05), now, 0.4);  // soft floor so it breathes at rest
      padLP.frequency.setTargetAtTime(360 + Math.min(1500, activity * 1200), now, 0.3); // opens up as you stir
    }
  }
  // one soft, warm, breathy voice — shared by the generative tune and by taps.
  // No metallic bell: a slow "bloom" attack, warm harmonic partials + a gently
  // detuned triangle, and a filter that opens then mellows (like the smoke).
  function voiceNote(midi, vel, pan) {
    if (!actx) return;
    var now = actx.currentTime, f = mtof(midi);
    vel = Math.max(0.05, Math.min(1, vel));
    var g = actx.createGain(); g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.095 * vel, now + 0.05);          // soft bloom, not a ding
    g.gain.exponentialRampToValueAtTime(0.0004, now + 2.4 + vel * 1.1);    // long gentle tail
    var lp = actx.createBiquadFilter(); lp.type = "lowpass"; lp.Q.value = 0.5;
    lp.frequency.setValueAtTime(480, now);
    lp.frequency.linearRampToValueAtTime(1050 + vel * 1500, now + 0.11);   // opens...
    lp.frequency.setTargetAtTime(660, now + 0.34, 0.7);                    // ...then mellows
    if (actx.createStereoPanner) { var p = actx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan || 0)); g.connect(lp); lp.connect(p); p.connect(master); p.connect(wet); }
    else { g.connect(lp); lp.connect(master); lp.connect(wet); }
    var parts = [[1, 0.6, "sine"], [1.004, 0.42, "triangle"], [2, 0.12, "sine"], [3, 0.04, "sine"]];
    for (var i = 0; i < parts.length; i++) {
      var o = actx.createOscillator(); o.type = parts[i][2]; o.frequency.value = f * parts[i][0];
      var og = actx.createGain(); og.gain.value = parts[i][1];
      o.connect(og); og.connect(g); o.start(now); o.stop(now + 3.8);
    }
  }
  // The visual half of a tone: bloom colored smoke where the note sits, so you
  // SEE every note — both the tune's and your taps'. (xFrac/yFrac in 0..1.)
  function noteBloom(xFrac, yFrac, vel) {
    var gx = Math.max(2, Math.min(N - 2, xFrac * N));
    var gy = Math.max(2, Math.min(N - 2, yFrac * N));
    inject(gx, gy, BR + 1, injColor(), DYE * (1.05 + vel * 1.25), (Math.random() - 0.5) * 7, -9 - vel * 10);
  }
  function ladderFor(k) { var pent = k.minor ? [0, 3, 5, 7, 10] : [0, 2, 4, 7, 9]; return pent.concat(pent.map(function (d) { return d + 12; })).concat([24]); }
  // taps = a deliberate accent: the tap's HEIGHT picks the note (top = high),
  // x = pan; always in the palette's key so it sits over the tune.
  function sndBell(mx, my) {
    if (!actx || !soundOn) return;
    if (mx == null) { mx = W / 2; my = H / 2; }
    var k = KEYS[mode], ladder = ladderFor(k);
    var frac = Math.max(0, Math.min(1, 1 - my / H));
    voiceNote(k.root + ladder[Math.round(frac * (ladder.length - 1))], 0.9, (mx / W - 0.5) * 1.1);
  }
  // The generative ambient tune — a soft, semi-random melody in the pad's key
  // that plays itself: it breathes (rests), drifts along a slow contour, walks
  // mostly by step with the odd leap, and gets a touch denser/brighter as the
  // smoke gets more active. Always consonant with the drone. (Flowful-style.)
  function melodyTick(dt) {
    if (!actx || !soundOn || !padOscs.length) return;
    mel.next -= dt;
    if (mel.next > 0) return;
    var dens = Math.min(1, activity * 12);
    mel.next = MEL_INT * (1 - dens * 0.3) + (Math.random() - 0.3) * MEL_JITTER;
    if (Math.random() < MEL_REST) return;                                              // breathe
    var k = KEYS[mode], ladder = ladderFor(k);
    var center = Math.round((0.5 + 0.32 * Math.sin(t * 0.05)) * (ladder.length - 1));  // slow drifting contour
    var stepPool = [-2, -1, -1, 0, 1, 1, 2];
    mel.idx += stepPool[Math.floor(Math.random() * stepPool.length)];
    if (mel.idx < center && Math.random() < 0.4) mel.idx += 1;                          // gently pulled toward the contour
    else if (mel.idx > center && Math.random() < 0.4) mel.idx -= 1;
    if (Math.random() < 0.08) mel.idx += Math.random() < 0.5 ? -3 : 3;                  // occasional leap
    mel.idx = Math.max(0, Math.min(ladder.length - 1, mel.idx));
    var pan = Math.sin(t * 0.7) * 0.45 + (Math.random() - 0.5) * 0.3;
    var vel = 0.38 + dens * 0.35 + Math.random() * 0.15;
    voiceNote(k.root + ladder[mel.idx], vel, pan);
    noteBloom(0.5 + pan * 0.4, 0.16 + 0.66 * (1 - mel.idx / (ladder.length - 1)), vel); // smoke blooms where the note sits
    if (Math.random() < 0.22) voiceNote(k.root + ladder[Math.max(0, mel.idx - 2)], vel * 0.5, -pan * 0.6); // soft harmony a step below
  }
  function sndPuff() {
    if (!actx || !soundOn) return; var t0 = actx.currentTime, s = pink();
    var bp = actx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.setValueAtTime(260, t0); bp.frequency.exponentialRampToValueAtTime(1300, t0 + 0.22); bp.Q.value = 0.7;
    var g = actx.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.12, t0 + 0.04); g.gain.exponentialRampToValueAtTime(0.0008, t0 + 0.5);
    s.connect(bp); bp.connect(g); g.connect(master); g.connect(wet); s.start(t0); s.stop(t0 + 0.52);
  }

  // ---------------- boot ----------------
  resize();
  requestAnimationFrame(frame);
})();
