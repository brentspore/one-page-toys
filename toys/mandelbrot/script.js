/* Mandelbrot — a full-bleed infinite fractal explorer (raw WebGL, no libraries, no build).
 *
 * The whole image is one fragment-shader pass over a full-screen quad. Two programs are
 * compiled from ONE templated source: a fast single-precision path for shallow zoom, and an
 * emulated double-precision (df64 / double-single) path that kicks in once single-precision
 * runs out of digits (~3000x), buying a genuinely deep, smooth infinite-feeling zoom down to
 * ~1e-13. The center is kept in JS float64 and split into hi/lo floats only at upload time.
 *
 * Modes: deep-zoom explore (drag pan, scroll/pinch zoom-to-cursor, double-tap dive), a live
 * Julia morph (drag sweeps the seed c), a cinematic auto-journey through curated deep-zoom
 * waypoints (equal-rate exponential smoothing of center + log-scale = a clean straight dive),
 * and slow palette cycling. Five hand-tuned cyclic palettes. An evolving ambient drone that
 * deepens with zoom rounds out the presentation. */
(function () {
  "use strict";

  /* ============================ DOM ============================ */
  const canvas = document.getElementById("canvas");
  const elZoomVal = document.getElementById("zoomVal");
  const elSeedStat = document.getElementById("seedStat");
  const elSeedVal = document.getElementById("seedVal");
  const paletteBtn = document.getElementById("paletteBtn");
  const modeBtn = document.getElementById("modeBtn");
  const journeyBtn = document.getElementById("journeyBtn");
  const cycleBtn = document.getElementById("cycleBtn");
  const homeBtn = document.getElementById("homeBtn");
  const soundBtn = document.getElementById("soundBtn");
  const overlay = document.getElementById("overlay");
  const ovBtn = document.getElementById("ovBtn");
  const hint = document.getElementById("hint");

  const gl = canvas.getContext("webgl", { antialias: false, alpha: false, depth: false, preserveDrawingBuffer: true, powerPreference: "high-performance" })
        || canvas.getContext("experimental-webgl", { antialias: false, alpha: false, depth: false, preserveDrawingBuffer: true });
  if (!gl) {
    const f = document.createElement("p");
    f.className = "gl-fallback";
    f.textContent = "This fractal needs WebGL. Try a different browser or device.";
    document.body.appendChild(f);
    return;
  }

  /* ============================ tunables ============================ */
  // Switch to emulated double precision well BEFORE single-precision float starts to soften
  // (float has comfortable headroom down to ~scale 3e-7; we hand off at 1e-5 so the seam is
  // always crisp). MIN_SCALE caps the deepest zoom to where df64 stays clean on real GPUs.
  const DD_THRESHOLD = 1.0e-5;   // css-scale below which we switch to emulated double precision
  const MIN_SCALE = 1e-12;       // deepest zoom (~1-8 billion×; df64 stays sharp above this)
  const REF_SPAN = 3.2;          // complex width mapped across the viewport at magnification 1
  const COLOR_SCALE = 0.155;     // banding density (feeds the palette)
  const CYCLE_SPEED = 0.05;      // palette cycling rate (phase units / sec)
  const WHEEL_K = 0.0016;        // wheel zoom sensitivity
  const DBL_ZOOM = 2.6;          // double-tap / double-click zoom factor
  const JULIA_SENS = 1.5;        // c-morph units per full-width drag
  const PALETTE_NAMES = ["Ember", "Glacier", "Biolume", "Cosmic", "Spectrum"];

  const REDMO = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ============================ shaders ============================ */
  const VERT = "attribute vec2 aPos; void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }";

  // The fragment shader is built once with DD undefined (float path) and once with DD defined
  // (df64 path). All the fractal math is written in terms of NUM / N_* macros.
  function fragSource(useDouble) {
    return (useDouble ? "#define DD\n" : "") +
    "precision highp float;\n" +
    "uniform vec2 uResolution;\n" +
    "uniform float uScale;\n" +      // complex units per device pixel
    "uniform vec2 uCx;\n" +          // center real (hi, lo)
    "uniform vec2 uCy;\n" +          // center imag (hi, lo)
    "uniform vec2 uJC;\n" +          // julia seed (re, im)
    "uniform int uIter;\n" +
    "uniform int uJulia;\n" +
    "uniform int uPalette;\n" +
    "uniform int uAA;\n" +
    "uniform float uPhase;\n" +
    "uniform float uColorScale;\n" +
    "uniform float uPower;\n" +      // Multibrot exponent (2.0 = standard Mandelbrot; morphed on the journey)
    "const int MAXI = 1400;\n" +
    "const float ESC = 2.0e4;\n" +
    "#ifdef DD\n" +
    "  #define NUM vec2\n" +
    "  vec2 dsset(float a){ return vec2(a, 0.0); }\n" +
    "  vec2 dsadd(vec2 a, vec2 b){\n" +
    "    float t1 = a.x + b.x;\n" +
    "    float e = t1 - a.x;\n" +
    "    float t2 = ((b.x - e) + (a.x - (t1 - e))) + a.y + b.y;\n" +
    "    float hi = t1 + t2;\n" +
    "    return vec2(hi, t2 - (hi - t1));\n" +
    "  }\n" +
    "  vec2 dsmul(vec2 a, vec2 b){\n" +
    "    float split = 8193.0;\n" +
    "    float cona = a.x * split; float conb = b.x * split;\n" +
    "    float a1 = cona - (cona - a.x); float b1 = conb - (conb - b.x);\n" +
    "    float a2 = a.x - a1; float b2 = b.x - b1;\n" +
    "    float c11 = a.x * b.x;\n" +
    "    float c21 = a2 * b2 + (a2 * b1 + (a1 * b2 + (a1 * b1 - c11)));\n" +
    "    float c2 = a.x * b.y + a.y * b.x;\n" +
    "    float t1 = c11 + c2;\n" +
    "    float e = t1 - c11;\n" +
    "    float t2 = a.y * b.y + ((c2 - e) + (c11 - (t1 - e))) + c21;\n" +
    "    float hi = t1 + t2;\n" +
    "    return vec2(hi, t2 - (hi - t1));\n" +
    "  }\n" +
    "  #define N_SET(a) dsset(a)\n" +
    "  #define N_HI(a) ((a).x)\n" +
    "  #define N_ADD(a,b) dsadd(a,b)\n" +
    "  #define N_SUB(a,b) dsadd(a, vec2(-(b).x, -(b).y))\n" +
    "  #define N_MUL(a,b) dsmul(a,b)\n" +
    "  #define CENTERX uCx\n" +
    "  #define CENTERY uCy\n" +
    "#else\n" +
    "  #define NUM float\n" +
    "  #define N_SET(a) (a)\n" +
    "  #define N_HI(a) (a)\n" +
    "  #define N_ADD(a,b) ((a)+(b))\n" +
    "  #define N_SUB(a,b) ((a)-(b))\n" +
    "  #define N_MUL(a,b) ((a)*(b))\n" +
    "  #define CENTERX uCx.x\n" +
    "  #define CENTERY uCy.x\n" +
    "#endif\n" +
    // cyclic 6-stop gradient (last stop loops back to the first)
    "vec3 ramp6(vec3 c0,vec3 c1,vec3 c2,vec3 c3,vec3 c4,vec3 c5,float t){\n" +
    "  t = fract(t); float f = t*6.0; float i = floor(f); float u = f - i;\n" +
    "  u = u*u*(3.0-2.0*u);\n" +
    "  if(i<0.5) return mix(c0,c1,u);\n" +
    "  else if(i<1.5) return mix(c1,c2,u);\n" +
    "  else if(i<2.5) return mix(c2,c3,u);\n" +
    "  else if(i<3.5) return mix(c3,c4,u);\n" +
    "  else if(i<4.5) return mix(c4,c5,u);\n" +
    "  return mix(c5,c0,u);\n" +
    "}\n" +
    "vec3 paletteColor(float t){\n" +
    "  if(uPalette==0) return ramp6(vec3(0.02,0.01,0.05),vec3(0.30,0.03,0.09),vec3(0.78,0.12,0.05),vec3(0.99,0.52,0.10),vec3(1.00,0.92,0.62),vec3(0.42,0.10,0.28),t);\n" +
    "  else if(uPalette==1) return ramp6(vec3(0.01,0.03,0.07),vec3(0.03,0.20,0.36),vec3(0.05,0.55,0.62),vec3(0.45,0.92,0.78),vec3(0.85,0.98,0.92),vec3(0.16,0.30,0.66),t);\n" +
    "  else if(uPalette==2) return ramp6(vec3(0.02,0.01,0.06),vec3(0.42,0.03,0.55),vec3(0.95,0.15,0.62),vec3(0.10,0.85,0.92),vec3(0.62,1.00,0.42),vec3(0.06,0.22,0.42),t);\n" +
    "  else if(uPalette==3) return ramp6(vec3(0.03,0.02,0.09),vec3(0.18,0.10,0.36),vec3(0.52,0.24,0.55),vec3(0.95,0.62,0.24),vec3(1.00,0.94,0.78),vec3(0.30,0.12,0.30),t);\n" +
    "  return ramp6(vec3(0.60,0.10,0.30),vec3(0.90,0.45,0.10),vec3(0.85,0.85,0.15),vec3(0.15,0.75,0.35),vec3(0.15,0.55,0.85),vec3(0.45,0.20,0.75),t);\n" +
    "}\n" +
    "vec3 interiorColor(){\n" +
    "  if(uPalette==0) return vec3(0.016,0.008,0.030);\n" +
    "  else if(uPalette==1) return vec3(0.008,0.020,0.045);\n" +
    "  else if(uPalette==2) return vec3(0.012,0.008,0.045);\n" +
    "  else if(uPalette==3) return vec3(0.020,0.014,0.048);\n" +
    "  return vec3(0.020,0.020,0.030);\n" +
    "}\n" +
    "vec3 computeColor(vec2 off){\n" +
    "  NUM pr = N_ADD(CENTERX, N_SET(off.x * uScale));\n" +
    "  NUM pi = N_ADD(CENTERY, N_SET(off.y * uScale));\n" +
    "  NUM cr, ci, zr, zi;\n" +
    "  if(uJulia==1){ cr=N_SET(uJC.x); ci=N_SET(uJC.y); zr=pr; zi=pi; }\n" +
    "  else { cr=pr; ci=pi; zr=N_SET(0.0); zi=N_SET(0.0); }\n" +
    "  float it = 0.0; float m2 = 0.0;\n" +
    "  for(int i=0;i<MAXI;i++){\n" +
    "    if(i>=uIter) break;\n" +
    "    NUM zr2 = N_MUL(zr,zr);\n" +
    "    NUM zi2 = N_MUL(zi,zi);\n" +
    "    m2 = N_HI(N_ADD(zr2,zi2));\n" +
    "    if(m2>ESC) break;\n" +
    "#ifdef DD\n" +
    "    NUM zri = N_MUL(zr,zi);\n" +
    "    zi = N_ADD(N_ADD(zri,zri), ci);\n" +
    "    zr = N_ADD(N_SUB(zr2,zi2), cr);\n" +
    "#else\n" +
    "    if(uPower == 2.0){\n" +
    "      float zri = zr*zi;\n" +
    "      zi = zri + zri + ci;\n" +
    "      zr = (zr2 - zi2) + cr;\n" +
    "    } else {\n" +
    "      float rr = sqrt(m2);\n" +
    "      float th = atan(zi, zr);\n" +
    "      float rp = pow(rr, uPower);\n" +
    "      float a = uPower*th;\n" +
    "      zr = rp*cos(a) + cr;\n" +
    "      zi = rp*sin(a) + ci;\n" +
    "    }\n" +
    "#endif\n" +
    "    it += 1.0;\n" +
    "  }\n" +
    "  if(it>=float(uIter)) return interiorColor();\n" +
    "  float sm = it - log2(0.5*log2(m2));\n" +
    "  float t = sqrt(max(sm,0.0))*uColorScale + uPhase;\n" +
    "  return paletteColor(t);\n" +
    "}\n" +
    "void main(){\n" +
    "  vec2 off = gl_FragCoord.xy - 0.5*uResolution;\n" +
    "  vec3 col = computeColor(off);\n" +
    "  if(uAA>1){\n" +
    "    col += computeColor(off + vec2(0.33,0.12));\n" +
    "    col += computeColor(off + vec2(-0.12,0.33));\n" +
    "    col += computeColor(off + vec2(-0.33,-0.12));\n" +
    "    col *= 0.25;\n" +
    "  }\n" +
    "  vec2 q = gl_FragCoord.xy / uResolution;\n" +
    "  float vig = smoothstep(1.18, 0.35, length(q-0.5));\n" +
    "  col *= mix(0.80, 1.0, vig);\n" +
    "  col = pow(clamp(col,0.0,1.0), vec3(0.92));\n" +
    "  gl_FragColor = vec4(col, 1.0);\n" +
    "}\n";
  }

  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(s), src);
    return s;
  }
  function makeProgram(fragSrc) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fragSrc));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) console.error(gl.getProgramInfoLog(p));
    const U = {};
    ["uResolution", "uScale", "uCx", "uCy", "uJC", "uIter", "uJulia", "uPalette", "uAA", "uPhase", "uColorScale", "uPower"]
      .forEach(function (n) { U[n] = gl.getUniformLocation(p, n); });
    U.aPos = gl.getAttribLocation(p, "aPos");
    return { prog: p, U: U };
  }

  const progF = makeProgram(fragSource(false));
  const progD = makeProgram(fragSource(true));

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.BLEND);

  /* ============================ view state ============================ */
  // center kept in JS float64 for full pan/zoom precision; scale = complex units per CSS pixel.
  let cx = -0.7, cy = 0.0, scale = 0.004;
  let cssW = 1, cssH = 1;
  let palette = 0;
  let phase = 0;
  let power = 2.0;           // Multibrot exponent, morphed during the Mandelbrot journey
  let cycling = !REDMO;
  let julia = false;
  let jcx = -0.8, jcy = 0.156;
  let savedMandel = null;      // remembers the Mandelbrot view while in Julia mode
  let interacting = false;
  let zoomVel = 0;             // recent zoom energy (drives audio brightness)
  let overlayUp = true;

  function splitD(x) { const hi = Math.fround(x); return [hi, x - hi]; }

  function fitScale() { return Math.max(REF_SPAN / cssW, 2.6 / cssH); }

  function clampScale() {
    const maxCss = REF_SPAN / (cssW * 0.34);
    if (scale > maxCss) scale = maxCss;
    if (scale < MIN_SCALE) scale = MIN_SCALE;
  }

  function magnification() { return REF_SPAN / (scale * cssW); }

  function goHome() {
    stopJourney();
    markActive();
    cx = -0.7; cy = 0.0; scale = fitScale();
    requestRender();
  }

  /* ============================ magnification readout ============================ */
  function fmtMag(m) {
    if (m < 10) return "×" + m.toFixed(1);
    if (m < 1e3) return "×" + Math.round(m);
    const units = [["e12", "T"], ["e9", "B"], ["e6", "M"], ["e3", "K"]];
    for (let i = 0; i < units.length; i++) {
      const div = parseFloat("1" + units[i][0]);
      if (m >= div) { const v = m / div; return "×" + (v < 10 ? v.toFixed(1) : Math.round(v)) + units[i][1]; }
    }
    return "×" + Math.round(m);
  }
  function updateHUD() {
    elZoomVal.textContent = fmtMag(magnification());
    if (julia) {
      elSeedStat.hidden = false;
      elSeedVal.textContent = jcx.toFixed(3) + (jcy >= 0 ? "+" : "−") + Math.abs(jcy).toFixed(3) + "i";
    } else {
      elSeedStat.hidden = true;
    }
  }

  /* ============================ render decisions ============================ */
  function usingDD() { return scale < DD_THRESHOLD; }
  // iterations scale with zoom depth so deep valleys still resolve (they need many more
  // iterations to escape); throttled only during an active gesture or journey FLIGHT (not a
  // journey hold), where a brief loss of detail that resolves on settle is fine.
  function curIters() {
    const oct = Math.max(0, Math.log2(magnification()));
    let it = Math.round(180 + oct * 48);
    it = Math.min(usingDD() ? 1200 : 1800, it);
    if (interacting || (journeyActive && !jrSettled)) it = Math.round(it * 0.5);
    return Math.max(90, it);
  }
  function curAA() {
    if (interacting || (journeyActive && !jrSettled) || usingDD() || cycling) return 1;
    return 4;
  }
  // Full resolution whenever the image is meant to be looked at (idle, cycling, drifting, a
  // journey hold). Only drop resolution during an active gesture or a journey flight, where the
  // view is moving fast enough that the softness is invisible — anything else reads as pixelation.
  function curRS() {
    if (interacting) return 0.6;
    if (journeyActive && !jrSettled) return usingDD() ? 0.75 : 0.9;
    return 1.0;
  }

  /* ============================ draw ============================ */
  function draw() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rs = curRS();
    const bw = Math.max(1, Math.round(cssW * dpr * rs));
    const bh = Math.max(1, Math.round(cssH * dpr * rs));
    if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh; }
    gl.viewport(0, 0, bw, bh);

    const dd = usingDD();
    const { prog, U } = dd ? progD : progF;
    gl.useProgram(prog);

    const uScaleDev = scale * cssW / bw;   // complex units per device pixel
    const cxs = splitD(cx), cys = splitD(cy);
    gl.uniform2f(U.uResolution, bw, bh);
    gl.uniform1f(U.uScale, uScaleDev);
    gl.uniform2f(U.uCx, cxs[0], cxs[1]);
    gl.uniform2f(U.uCy, cys[0], cys[1]);
    gl.uniform2f(U.uJC, jcx, jcy);
    gl.uniform1i(U.uIter, curIters());
    gl.uniform1i(U.uJulia, julia ? 1 : 0);
    gl.uniform1i(U.uPalette, palette);
    gl.uniform1i(U.uAA, curAA());
    gl.uniform1f(U.uPhase, phase);
    gl.uniform1f(U.uColorScale, COLOR_SCALE);
    if (U.uPower) gl.uniform1f(U.uPower, power);

    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.enableVertexAttribArray(U.aPos);
    gl.vertexAttribPointer(U.aPos, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    updateHUD();
  }

  /* ============================ frame loop ============================ */
  const IDLE_DRIFT_DELAY = 10;    // seconds of stillness before the screensaver drift begins
  let rafPending = false;
  let lastT = 0;
  let idleT = 0;
  let driftAnchor = null;
  function requestRender() { if (!rafPending) { rafPending = true; requestAnimationFrame(frame); } }
  function markActive() { idleT = 0; driftAnchor = null; }
  function frame(ts) {
    rafPending = false;
    const dt = lastT ? Math.min(0.05, (ts - lastT) / 1000) : 0.016;
    lastT = ts;

    if (!overlayUp) {
      if (interacting || journeyActive) { idleT = 0; driftAnchor = null; }
      else idleT += dt;
      const drifting = !REDMO && !interacting && !journeyActive && idleT > IDLE_DRIFT_DELAY;
      if (cycling) phase += dt * CYCLE_SPEED;
      if (journeyActive) { if (julia) updateJuliaJourney(dt); else updateJourney(dt); }
      else if (drifting) updateDrift(dt);
      else if (!interacting) driftAnchor = null;
      // relax the Multibrot power back to 2 whenever we're not morphing it (clean exit + manual)
      if (!(journeyActive && !julia)) {
        power = Math.abs(power - 2) > 0.002 ? power + (2 - power) * (1 - Math.exp(-dt / 0.5)) : 2;
      }
    }
    updateAudio(dt);
    zoomVel *= Math.exp(-dt * 2.2);

    draw();

    // Keep the loop alive so palette cycling + idle drift run forever (a living screensaver that
    // never burns a fixed shape into the screen). Under reduced-motion or a hidden tab, fall idle
    // after this frame to save battery; interactions call requestRender() to wake it.
    if (!overlayUp && !REDMO && !document.hidden) requestRender();
    else lastT = 0;
  }
  // A slow ambient orbit + breathing that starts smoothly from wherever you left off, so the
  // composition never sits perfectly still. Any interaction cancels it and re-anchors.
  function updateDrift(dt) {
    if (!driftAnchor) driftAnchor = { cx: cx, cy: cy, scale: scale, t: 0 };
    driftAnchor.t += dt;
    const t = driftAnchor.t, R = driftAnchor.scale * cssW * 0.07;
    cx = driftAnchor.cx + Math.sin(t * 0.08) * R + Math.sin(t * 0.026) * R * 0.4;
    cy = driftAnchor.cy + (1 - Math.cos(t * 0.067)) * R * 0.6 + Math.sin(t * 0.038) * R * 0.4;
    scale = driftAnchor.scale * (1 + (Math.cos(t * 0.035) - 1) * 0.03);
    clampScale();
  }

  /* ============================ cinematic journey ============================ */
  // Curated deep-zoom waypoints. mag = target magnification; a HOME beat is inserted between
  // each so consecutive deep dives surface first (avoids whipping through the set sideways).
  // Magnifications kept in a range that stays lush throughout the flight (deep valleys need
  // huge iteration counts that a throttled flight can't afford — manual explore still goes to
  // billions). A HOME beat is inserted between each so consecutive dives surface first.
  const WAYPOINTS = [
    { cx: -0.743643887037151, cy: 0.131825904205330, mag: 2.6e5 },   // seahorse valley spiral
    { cx: -0.10109636384562, cy: 0.95628012049252, mag: 9.0e4 },     // northern bud filigree
    { cx: 0.27219020, cy: 0.00600630, mag: 5.0e4 },                  // elephant valley curls
    { cx: -1.25066000, cy: 0.02012000, mag: 8.0e4 },                 // needle minibrot approach
    { cx: -0.74542700, cy: 0.11300500, mag: 1.6e5 },                 // double-spiral
    { cx: -0.16070135, cy: 1.03766500, mag: 6.0e4 }                  // upper tendrils
  ];
  const HOME_WP = { cx: -0.4, cy: 0.0, mag: 0.66 };   // wide enough to frame the morphing Multibrot
  let jrSettled = false;
  let journeyActive = false;
  let jrSeq = [], jrIdx = 0, jrTarget = null, jrHold = 0;

  function startJourney() {
    journeyActive = true;
    if (julia) {
      startJuliaJourney();
    } else {
      jrSeq = [];
      for (let i = 0; i < WAYPOINTS.length; i++) { jrSeq.push(WAYPOINTS[i]); jrSeq.push(HOME_WP); }
      jrSetTarget(0);
    }
    journeyBtn.setAttribute("aria-pressed", "true");
    journeyBtn.textContent = "❚❚";
    // full-screen cinematic: push all chrome off so nothing can burn in during the fly-through
    document.body.classList.add("is-cinematic");
    setHint(julia ? "morphing through Julia seeds · tap anywhere to exit" : "tap anywhere to exit the journey");
    if (window.gtag) try { gtag("event", "mandelbrot_journey"); } catch (e) {}
    requestRender();
  }

  // Julia cinematic: glide the seed c along a loop of beautiful, connected Julia sets so the whole
  // shape continuously reshapes (a screensaver in its own right), with a gentle zoom breath. Runs
  // at full quality (it's a shallow whole-set view, so no iteration/resolution throttle needed).
  const JULIA_SEEDS = [
    { re: -0.80000, im: 0.15600 }, { re: -0.72690, im: 0.18890 }, { re: -0.12300, im: 0.74500 },
    { re: -0.39100, im: -0.58700 }, { re: -0.83500, im: -0.23210 }, { re: -0.70176, im: -0.38420 }
  ];
  let jjFrom = null, jjIdx = 0, jjT = 0, jjTotal = 0, jjBaseScale = 0.004;
  function startJuliaJourney() {
    cx = 0; cy = 0; jjBaseScale = Math.max(REF_SPAN / cssW, 2.9 / cssH); scale = jjBaseScale;
    jjFrom = { re: jcx, im: jcy }; jjIdx = 0; jjT = 0; jjTotal = 0; jrSettled = true;
  }
  function updateJuliaJourney(dt) {
    jjT += dt; jjTotal += dt;
    const DUR = 5.0, seg = Math.min(1, jjT / DUR), e = seg * seg * (3 - 2 * seg), to = JULIA_SEEDS[jjIdx];
    jcx = jjFrom.re + (to.re - jjFrom.re) * e;
    jcy = jjFrom.im + (to.im - jjFrom.im) * e;
    scale = jjBaseScale * (1 + 0.06 * Math.sin(jjTotal * 0.12));   // gentle zoom breath
    jrSettled = true;
    if (seg >= 1) { jjFrom = { re: to.re, im: to.im }; jjIdx = (jjIdx + 1) % JULIA_SEEDS.length; jjT = 0; }
  }
  function stopJourney() {
    if (!journeyActive) return;
    journeyActive = false; jrSettled = false;
    journeyBtn.setAttribute("aria-pressed", "false");
    journeyBtn.textContent = "▶";
    document.body.classList.remove("is-cinematic");
  }
  // Cinematic move: for a DIVE-IN, lock the center on the boundary target up front and animate
  // only the scale — so every frame stays centered on live detail (never transits the black
  // interior). For a zoom-OUT (surfacing to HOME) leave the center where it is; once we reach
  // the wide scale the whole set is in view and the small offset is invisible.
  function jrSetTarget(idx) {
    jrIdx = idx; jrTarget = jrSeq[idx]; jrHold = 0; jrSettled = false;
    const ts = REF_SPAN / (jrTarget.mag * cssW);
    if (ts < scale) { cx = jrTarget.cx; cy = jrTarget.cy; }
  }
  function updateJourney(dt) {
    if (!jrTarget) return;
    const targScale = REF_SPAN / (jrTarget.mag * cssW);
    const k = 1 - Math.exp(-dt / 1.15);
    const ls = Math.log(scale);
    scale = Math.exp(ls + (Math.log(targScale) - ls) * k);
    clampScale();
    const near = Math.abs(Math.log(scale / targScale)) < 0.06;
    jrSettled = near;
    const atHome = jrTarget === HOME_WP;
    if (near) {
      jrHold += dt;
      if (atHome) {
        // wide-view beat: ease the framing to center, then morph the Multibrot power 2 -> ~7 -> 2
        const ck = 1 - Math.exp(-dt / 0.8);
        cx += (HOME_WP.cx - cx) * ck; cy += (HOME_WP.cy - cy) * ck;
        power = 4.5 - 2.5 * Math.cos(jrHold * 0.52);   // one full morph cycle over the hold
      }
      if (jrHold > (atHome ? 12.6 : 2.8)) {
        jrHold = 0; jrSettled = false; power = 2; jrSetTarget((jrIdx + 1) % jrSeq.length);
      }
    } else jrHold = 0;
  }

  /* ============================ interaction ============================ */
  const pointers = new Map();
  let lastTapT = 0, lastTapX = 0, lastTapY = 0;

  function canvasXY(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  // zoom by factor f about the given css point (keeps that complex point fixed)
  function zoomAt(px, py, f) {
    const offX = px - cssW / 2, offY = cssH / 2 - py;
    const ux = cx + offX * scale, uy = cy + offY * scale;
    scale *= f; clampScale();
    cx = ux - offX * scale; cy = uy - offY * scale;
    zoomVel += Math.abs(Math.log(f));
  }
  function panBy(dx, dy) { cx -= dx * scale; cy += dy * scale; }

  function onDown(e) {
    if (overlayUp) return;
    canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, canvasXY(e));
    stopJourney();
    markActive();
    interacting = true;
    canvas.classList.add("is-grabbing");
    hideHint();
    // double-tap / double-click to dive
    const now = performance.now();
    const p = canvasXY(e);
    if (now - lastTapT < 320 && Math.hypot(p.x - lastTapX, p.y - lastTapY) < 34 && pointers.size === 1) {
      zoomAt(p.x, p.y, DBL_ZOOM);
    }
    lastTapT = now; lastTapX = p.x; lastTapY = p.y;
    requestRender();
  }
  function onMove(e) {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    const p = canvasXY(e);
    pointers.set(e.pointerId, p);

    if (pointers.size >= 2) {
      // pinch: zoom about midpoint + pan by midpoint drift
      const pts = Array.from(pointers.values());
      const a = pts[0], b = pts[1];
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchPrev) {
        if (pinchPrev.dist > 0 && dist > 0) zoomAt(mid.x, mid.y, pinchPrev.dist / dist);
        panBy(mid.x - pinchPrev.mid.x, mid.y - pinchPrev.mid.y);
      }
      pinchPrev = { dist: dist, mid: mid };
    } else {
      const dx = p.x - prev.x, dy = p.y - prev.y;
      if (julia) {
        // morph the seed instead of panning
        jcx += dx * (JULIA_SENS / cssW);
        jcy -= dy * (JULIA_SENS / cssW);
      } else {
        panBy(dx, dy);
      }
    }
    requestRender();
  }
  let pinchPrev = null;
  function onUp(e) {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchPrev = null;
    if (pointers.size === 0) {
      interacting = false;
      canvas.classList.remove("is-grabbing");
      requestRender();   // one crisp settled still
    }
  }
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);
  canvas.addEventListener("wheel", function (e) {
    if (overlayUp) return;
    e.preventDefault();
    stopJourney();
    markActive();
    const p = canvasXY(e);
    zoomAt(p.x, p.y, Math.exp(e.deltaY * WHEEL_K));
    hideHint();
    requestRender();
  }, { passive: false });
  canvas.addEventListener("dblclick", function (e) { e.preventDefault(); });   // handled in onDown
  canvas.addEventListener("contextmenu", function (e) { e.preventDefault(); });

  /* ============================ controls ============================ */
  function setPalette(i) {
    palette = ((i % PALETTE_NAMES.length) + PALETTE_NAMES.length) % PALETTE_NAMES.length;
    paletteBtn.textContent = PALETTE_NAMES[palette];
    chime();
    requestRender();
  }
  function setJulia(on) {
    if (on === julia) return;
    stopJourney();
    markActive();
    if (on) {
      savedMandel = { cx: cx, cy: cy, scale: scale };
      julia = true;
      cx = 0; cy = 0; scale = Math.max(REF_SPAN / cssW, 2.8 / cssH);
      modeBtn.textContent = "Julia";
      modeBtn.setAttribute("aria-pressed", "true");
      canvas.classList.add("is-julia");
      setHint("drag to morph the seed · scroll or pinch to zoom");
    } else {
      julia = false;
      if (savedMandel) { cx = savedMandel.cx; cy = savedMandel.cy; scale = savedMandel.scale; }
      modeBtn.textContent = "Mandelbrot";
      modeBtn.setAttribute("aria-pressed", "false");
      canvas.classList.remove("is-julia");
      setHint("drag to pan · scroll or pinch to zoom · double-tap to dive");
    }
    requestRender();
  }
  function setCycling(on) {
    cycling = on;
    cycleBtn.setAttribute("aria-pressed", on ? "true" : "false");
    if (on) requestRender();
  }

  paletteBtn.addEventListener("click", function () { setPalette(palette + 1); });
  modeBtn.addEventListener("click", function () { setJulia(!julia); });
  cycleBtn.addEventListener("click", function () { setCycling(!cycling); });
  homeBtn.addEventListener("click", function () { if (julia) setJulia(false); else goHome(); });
  journeyBtn.addEventListener("click", function () { if (journeyActive) stopJourney(); else startJourney(); });
  soundBtn.addEventListener("click", function () { setSound(!audioOn); });

  /* keyboard niceties */
  window.addEventListener("keydown", function (e) {
    if (overlayUp) return;
    if (e.key === "p" || e.key === "P") setPalette(palette + 1);
    else if (e.key === "j" || e.key === "J") setJulia(!julia);
    else if (e.key === "c" || e.key === "C") setCycling(!cycling);
    else if (e.key === "Home" || e.key === "h" || e.key === "H") goHome();
    else if (e.key === " ") { e.preventDefault(); if (journeyActive) stopJourney(); else startJourney(); }
    else if (e.key === "+" || e.key === "=") { markActive(); zoomAt(cssW / 2, cssH / 2, DBL_ZOOM); requestRender(); }
    else if (e.key === "-" || e.key === "_") { markActive(); zoomAt(cssW / 2, cssH / 2, 1 / DBL_ZOOM); requestRender(); }
  });

  /* ============================ hint ============================ */
  let hintTimer = null;
  function hideHint() { hint.classList.add("is-gone"); }
  function setHint(t) {
    hint.textContent = t;
    hint.classList.remove("is-gone");
    if (hintTimer) clearTimeout(hintTimer);
    hintTimer = setTimeout(hideHint, 4200);
  }

  /* ============================ audio (evolving ambient drone) ============================ */
  let AC = null, master = null, padLP = null, subGain = null, shimmerGain = null, chimeBus = null;
  let audioOn = true, audioStarted = false;
  const MASTER_VOL = 0.4;

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
    // iOS unlock: 1-sample silent buffer inside the gesture
    try { const b = AC.createBuffer(1, 1, 22050); const s = AC.createBufferSource(); s.buffer = b; s.connect(AC.destination); s.start(0); } catch (e) {}

    master = AC.createGain(); master.gain.value = 0; master.connect(AC.destination);
    const comp = AC.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 3; comp.attack.value = 0.02; comp.release.value = 0.3;
    comp.connect(master);

    const conv = AC.createConvolver(); conv.buffer = makeImpulse(3.2, 2.6);
    const wet = AC.createGain(); wet.gain.value = 0.55; conv.connect(wet); wet.connect(comp);
    const dry = AC.createGain(); dry.gain.value = 0.7; dry.connect(comp);

    // lowpass sits in the MID register (not sub-bass) so the pad is audible on laptop/phone
    // speakers; it darkens as you zoom deeper and opens with zoom motion.
    padLP = AC.createBiquadFilter(); padLP.type = "lowpass"; padLP.frequency.value = 1300; padLP.Q.value = 0.7;
    padLP.connect(dry); padLP.connect(conv);
    const padGain = AC.createGain(); padGain.gain.value = 0.9; padGain.connect(padLP);
    chimeBus = AC.createGain(); chimeBus.gain.value = 0.5; chimeBus.connect(dry); chimeBus.connect(conv);

    // cosmic open-fifths pad across C2-G4: the mid voices carry the audible tone, the low note
    // is routed through a depth-driven sub bus for weight as you dive.
    const NOTES = [
      { f: 65.41, sub: true }, { f: 130.81, g: 0.16 }, { f: 196.00, g: 0.14 },
      { f: 261.63, g: 0.12 }, { f: 392.00, g: 0.075 }
    ];
    subGain = AC.createGain(); subGain.gain.value = 0.5; subGain.connect(padLP);
    NOTES.forEach(function (n, i) {
      const pan = AC.createStereoPanner ? AC.createStereoPanner() : null;
      let dest = padGain;
      if (n.sub) { dest = subGain; }
      else if (pan) { pan.pan.value = (i / (NOTES.length - 1) - 0.5) * 0.7; pan.connect(padGain); dest = pan; }
      [0, 6.5].forEach(function (cents, k) {   // primary + a lightly detuned chorus partner
        const o = AC.createOscillator(); o.type = n.sub ? "sine" : "triangle";
        o.frequency.value = n.f; o.detune.value = cents + (i - 2) * 1.5;
        const g = AC.createGain(); g.gain.value = (n.sub ? 0.5 : n.g) * (k ? 0.5 : 1);
        o.connect(g); g.connect(dest); o.start();
      });
    });
    // a bright shimmer partial that swells with zoom motion
    shimmerGain = AC.createGain(); shimmerGain.gain.value = 0; shimmerGain.connect(padLP);
    const sh = AC.createOscillator(); sh.type = "sine"; sh.frequency.value = 784; sh.connect(shimmerGain); sh.start();
    // slow filter movement + slow amplitude breathing (keeps it alive as a screensaver)
    const lfo = AC.createOscillator(); lfo.type = "sine"; lfo.frequency.value = 0.045;
    const lfoG = AC.createGain(); lfoG.gain.value = 240; lfo.connect(lfoG); lfoG.connect(padLP.frequency); lfo.start();
    const alfo = AC.createOscillator(); alfo.type = "sine"; alfo.frequency.value = 0.07;
    const alfoG = AC.createGain(); alfoG.gain.value = 0.14; alfo.connect(alfoG); alfoG.connect(padGain.gain); alfo.start();

    master.gain.setValueAtTime(0.0001, AC.currentTime);
    master.gain.linearRampToValueAtTime(audioOn ? MASTER_VOL : 0.0001, AC.currentTime + 2.0);
  }
  function updateAudio() {
    if (!AC || !audioOn) return;
    const oct = Math.max(0, Math.log2(magnification()));
    const depthN = Math.min(1, oct / 28);
    const now = AC.currentTime;
    padLP.frequency.setTargetAtTime(1300 - depthN * 430 + Math.min(1, zoomVel) * 850, now, 0.15);
    subGain.gain.setTargetAtTime(0.42 + depthN * 0.5, now, 0.4);
    shimmerGain.gain.setTargetAtTime(Math.min(1, zoomVel) * 0.08, now, 0.2);
  }
  function chime() {
    if (!AC || !audioOn || !chimeBus) return;
    const now = AC.currentTime;
    const degs = [0, 3, 5, 7, 10];
    const base = 392 * Math.pow(2, (degs[Math.floor(Math.random() * degs.length)] + (Math.random() < 0.5 ? 0 : 12)) / 12);
    [1, 2.0, 3.01].forEach(function (mult, i) {
      const o = AC.createOscillator(); o.type = "sine"; o.frequency.value = base * mult;
      const g = AC.createGain(); g.gain.value = 0;
      o.connect(g); g.connect(chimeBus);
      const amp = 0.18 / (i + 1);
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(amp, now + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0008, now + 1.3 - i * 0.25);
      o.start(now); o.stop(now + 1.4);
    });
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
    const wasHome = Math.abs(scale - fitScale()) < fitScale() * 0.02 && Math.abs(cx + 0.7) < 0.02 && Math.abs(cy) < 0.02 && !julia;
    cssW = w; cssH = h;
    if (scale === 0.004 || wasHome) { if (!julia) { cx = -0.7; cy = 0; } scale = fitScale(); }
    clampScale();
    requestRender();
  }
  window.addEventListener("resize", resize);
  window.addEventListener("orientationchange", function () { setTimeout(resize, 120); });
  document.addEventListener("visibilitychange", function () { if (!document.hidden && !overlayUp) { lastT = 0; requestRender(); } });

  /* ============================ boot ============================ */
  cssW = window.innerWidth; cssH = window.innerHeight;
  scale = fitScale();
  cycleBtn.setAttribute("aria-pressed", cycling ? "true" : "false");
  soundBtn.setAttribute("aria-pressed", "true");
  updateHUD();
  requestRender();   // draw the fractal behind the intro overlay

  function dismissOverlay() {
    if (!overlayUp) return;
    overlayUp = false;
    overlay.classList.add("is-hidden");
    setTimeout(function () { overlay.hidden = true; }, 360);
    if (audioOn) startAudio();
    setHint(julia ? "drag to morph the seed · scroll or pinch to zoom"
                  : "drag to pan · scroll or pinch to zoom · double-tap to dive");
    requestRender();
  }
  ovBtn.addEventListener("click", dismissOverlay);
})();
