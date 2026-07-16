/* Stained Glass — a living leaded-glass window (raw WebGL, no libraries, no build).
 *
 * The whole window is a single fragment-shader pass over a full-screen quad. Per pixel it loops
 * over the seed points and finds the nearest (d1) and second-nearest (d2) distance. The nearest
 * seed's jewel colour fills the pane; the thin band where (d2 - d1) is small becomes the dark
 * "leading" (the came) between panes. A slowly-moving light (the sun behind the glass) makes the
 * panes it passes glow brighter, so the window is always quietly transmitting light.
 *
 * Seeds carry an additive weight so a freshly-tapped pane can GROW in (a small bubble that swells
 * to its full cell — a soft pop). Seeds drift slowly and bounce off the edges so the composition
 * never sits perfectly still; a drag herds nearby seeds like stirring the glass; Settle runs a few
 * Lloyd relaxation steps toward each cell's centroid for even, elegant panes.
 *
 * Audio: a crystalline glass chime on every new pane (inharmonic bell partials tuned to a
 * pentatonic scale, panned by position, sent to a convolver reverb) over a soft evolving shimmer
 * bed. Fully synthesised — no samples. */
(function () {
  "use strict";

  /* ============================ DOM ============================ */
  const canvas = document.getElementById("canvas");
  const paletteBtn = document.getElementById("paletteBtn");
  const settleBtn = document.getElementById("settleBtn");
  const resetBtn = document.getElementById("resetBtn");
  const soundBtn = document.getElementById("soundBtn");
  const overlay = document.getElementById("overlay");
  const ovBtn = document.getElementById("ovBtn");
  const paneVal = document.getElementById("paneVal");
  const hint = document.getElementById("hint");

  const gl = canvas.getContext("webgl", { antialias: false, alpha: false, depth: false, powerPreference: "high-performance" })
        || canvas.getContext("experimental-webgl", { antialias: false, alpha: false, depth: false });
  if (!gl) {
    const f = document.createElement("p");
    f.className = "gl-fallback";
    f.textContent = "This stained-glass window needs WebGL. Try a different browser or device.";
    document.body.appendChild(f);
    return;
  }

  const REDMO = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const MOBILE = Math.min(window.innerWidth, window.innerHeight) < 620 ||
                 (("ontouchstart" in window) && Math.min(window.innerWidth, window.innerHeight) < 760);
  const MAXDPR = MOBILE ? 1.5 : 2;

  /* ---- seed array size is capped by the device's fragment-uniform budget ---- */
  const maxUV = gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS) || 256;
  // each seed costs 2 vec3 slots (position+weight, colour); keep a comfortable margin for scalars
  const SLOT_CAP = Math.max(24, Math.floor((maxUV - 24) / 2));
  const MAXSEEDS = Math.min(MOBILE ? 56 : 74, SLOT_CAP);
  const INIT_SEEDS = Math.min(MOBILE ? 40 : 54, MAXSEEDS);

  /* ============================ tunables ============================ */
  const LEAD_HALF = 2.6;        // came half-thickness, css px (edge measures ~2x perp dist)
  const GROW_R = 210;           // starting negative weight (px) for a pane growing in
  const GROW_TAU = 0.42;        // grow-in ease time constant (s)
  const COL_TAU = 0.5;          // palette recolour ease time constant (s)
  const DRIFT_MIN = MOBILE ? 3 : 4, DRIFT_MAX = MOBILE ? 9 : 12;  // px/s
  const HERD_R = 150;           // herd influence radius, css px
  const HERD_STR = 0.9;         // how strongly a drag drags nearby seeds

  /* ============================ palettes (jewel tones, linear-ish RGB 0..1) ============ */
  // Each palette is a spread of rich cathedral-glass colours; the backlight brightens them.
  const PALETTES = [
    { name: "Cathedral", cols: [
      [0.66,0.07,0.15],[0.78,0.13,0.10],[0.09,0.20,0.55],[0.06,0.30,0.62],
      [0.06,0.46,0.30],[0.10,0.55,0.42],[0.80,0.55,0.08],[0.88,0.68,0.14],
      [0.36,0.14,0.52],[0.55,0.10,0.34] ] },
    { name: "Sunset", cols: [
      [0.72,0.10,0.12],[0.84,0.24,0.09],[0.90,0.42,0.10],[0.92,0.58,0.14],
      [0.88,0.72,0.22],[0.80,0.30,0.34],[0.68,0.16,0.36],[0.46,0.12,0.34],
      [0.90,0.50,0.42],[0.60,0.20,0.22] ] },
    { name: "Sea Glass", cols: [
      [0.05,0.34,0.42],[0.07,0.46,0.52],[0.10,0.58,0.60],[0.16,0.68,0.62],
      [0.30,0.74,0.60],[0.46,0.80,0.66],[0.10,0.30,0.52],[0.16,0.44,0.66],
      [0.60,0.82,0.74],[0.08,0.24,0.40] ] },
    { name: "Amethyst", cols: [
      [0.30,0.12,0.50],[0.42,0.16,0.60],[0.54,0.22,0.68],[0.66,0.30,0.72],
      [0.78,0.44,0.78],[0.84,0.62,0.20],[0.90,0.72,0.30],[0.50,0.14,0.40],
      [0.70,0.24,0.52],[0.22,0.10,0.40] ] }
  ];
  let palette = 0;

  /* ============================ shader ============================ */
  const VERT = "attribute vec2 aPos; void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }";

  const FRAG =
    "precision highp float;\n" +
    "const int MAXS = " + MAXSEEDS + ";\n" +
    "uniform vec2 uRes;\n" +
    "uniform int uCount;\n" +
    "uniform vec3 uSeed[MAXS];\n" +   // xy = position (device px), z = additive weight
    "uniform vec3 uCol[MAXS];\n" +    // jewel colour per seed
    "uniform vec2 uLight;\n" +        // sun position (device px)
    "uniform float uLead;\n" +        // came thickness (device px)
    "uniform float uAA;\n" +          // leading anti-alias width (device px)
    "float hash(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }\n" +
    "float vnoise(vec2 p){\n" +
    "  vec2 i = floor(p), f = fract(p);\n" +
    "  float a=hash(i), b=hash(i+vec2(1.0,0.0)), c=hash(i+vec2(0.0,1.0)), d=hash(i+vec2(1.0,1.0));\n" +
    "  vec2 u = f*f*(3.0-2.0*f);\n" +
    "  return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);\n" +
    "}\n" +
    "void main(){\n" +
    "  vec2 p = gl_FragCoord.xy;\n" +
    "  float d1 = 1.0e20, d2 = 1.0e20;\n" +
    "  vec2 s1 = vec2(0.0);\n" +
    "  vec3 c1 = vec3(0.0);\n" +
    "  for(int i=0;i<MAXS;i++){\n" +
    "    if(i>=uCount) break;\n" +
    "    vec3 s = uSeed[i];\n" +
    "    float d = distance(p, s.xy) - s.z;\n" +
    "    if(d < d1){ d2=d1; d1=d; s1=s.xy; c1=uCol[i]; }\n" +
    "    else if(d < d2){ d2=d; }\n" +
    "  }\n" +
    "  float edge = d2 - d1;\n" +                     // ~0 on the came centre-line, grows into panes
    "  float mn = min(uRes.x, uRes.y);\n" +
    // ---- glass body: base jewel colour + streaky internal variation (per-cell) ----
    "  vec3 glass = c1;\n" +
    "  vec2 gp = p - s1;\n" +
    "  float streak = vnoise(gp*0.011 + s1*0.05)*0.62 + vnoise(gp*0.034 + 11.0)*0.38;\n" +
    "  glass *= 0.80 + 0.34*streak;\n" +
    // ---- backlight: the sun behind the window ----
    "  float ld = distance(p, uLight) / mn;\n" +
    "  float core = exp(-ld*ld*7.0);\n" +            // hot sun core
    "  float grad = 1.0 - smoothstep(0.0, 1.35, ld);\n" +
    "  float lit = 0.40 + grad*0.90 + core*0.95;\n" +
    "  glass *= lit;\n" +
    // warm the strongly-lit glass toward a molten glow
    "  vec3 warm = vec3(1.0, 0.86, 0.60);\n" +
    "  float hot = clamp((lit-1.02)*0.85 + core*0.6, 0.0, 1.0);\n" +
    "  glass = mix(glass, glass*0.55 + warm*1.05, hot*0.5);\n" +
    "  glass += warm * core * 0.22;\n" +
    // ---- bevel highlight just inside the came (light catching the glass edge) ----
    "  float glassMask = smoothstep(uLead, uLead+uAA, edge);\n" +   // 0 in came, 1 in glass
    "  float rim = glassMask * (1.0 - smoothstep(uLead, uLead + mn*0.013, edge));\n" +
    "  glass += rim * (0.30 + core*0.55) * vec3(1.0,0.96,0.86);\n" +
    // ---- came (dark leading) with a faint metallic sheen toward the light ----
    "  vec3 came = vec3(0.028,0.026,0.030);\n" +
    "  came += vec3(0.11,0.10,0.08) * core;\n" +
    "  came += 0.045 * vnoise(p*0.05);\n" +
    "  vec3 col = mix(came, glass, glassMask);\n" +
    // ---- vignette + gamma ----
    "  vec2 q = p / uRes;\n" +
    "  float vig = smoothstep(1.28, 0.32, length(q-0.5));\n" +
    "  col *= mix(0.70, 1.0, vig);\n" +
    "  col = pow(clamp(col,0.0,1.0), vec3(0.90));\n" +
    "  gl_FragColor = vec4(col, 1.0);\n" +
    "}\n";

  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(s));
    return s;
  }
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) console.error(gl.getProgramInfoLog(prog));
  const U = {};
  ["uRes", "uCount", "uSeed[0]", "uCol[0]", "uLight", "uLead", "uAA"].forEach(function (n) {
    U[n.replace("[0]", "")] = gl.getUniformLocation(prog, n);
  });
  U.aPos = gl.getAttribLocation(prog, "aPos");

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.BLEND);

  const seedBuf = new Float32Array(MAXSEEDS * 3);
  const colBuf = new Float32Array(MAXSEEDS * 3);

  /* ============================ state ============================ */
  let cssW = window.innerWidth, cssH = window.innerHeight;
  let tSec = 0, lastT = 0, rafPending = false;
  let overlayUp = true;
  let interacting = false;
  const seeds = [];           // { x,y, vx,vy, w, delay, ci, cr,cg,cb, tr,tg,tb }
  let lightAngle = Math.random() * Math.PI * 2;

  // Lloyd settle animation
  let settleLeft = 0, settleTimer = 0;

  function rand(a, b) { return a + Math.random() * (b - a); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  function paletteColor(ci) {
    const cols = PALETTES[palette].cols;
    return cols[ci % cols.length];
  }

  function makeSeed(x, y, growing) {
    const ci = Math.floor(Math.random() * 997);
    const c = PALETTES[palette].cols[ci % PALETTES[palette].cols.length];
    const ang = Math.random() * Math.PI * 2, sp = rand(DRIFT_MIN, DRIFT_MAX);
    return {
      x: x, y: y,
      vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
      w: growing ? -GROW_R : 0, delay: 0, ci: ci,
      cr: c[0], cg: c[1], cb: c[2], tr: c[0], tg: c[1], tb: c[2]
    };
  }

  /* ---- generate a fresh, intentional window (jittered grid + a couple of Lloyd passes) ---- */
  function generate(count) {
    seeds.length = 0;
    const aspect = cssW / cssH;
    let cols = Math.max(2, Math.round(Math.sqrt(count * aspect)));
    let rows = Math.max(2, Math.round(count / cols));
    const cw = cssW / cols, ch = cssH / rows;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (seeds.length >= count) break;
        const x = clamp((c + 0.5) * cw + rand(-cw * 0.42, cw * 0.42), 6, cssW - 6);
        const y = clamp((r + 0.5) * ch + rand(-ch * 0.42, ch * 0.42), 6, cssH - 6);
        seeds.push(makeSeed(x, y, false));
      }
    }
    // even things out, then reveal them as a bloom
    lloydStep(0.9); lloydStep(0.9);
    const cx = cssW / 2, cy = cssH / 2, maxD = Math.hypot(cx, cy) || 1;
    for (let i = 0; i < seeds.length; i++) {
      const s = seeds[i];
      s.w = -GROW_R;
      s.delay = REDMO ? 0 : (Math.hypot(s.x - cx, s.y - cy) / maxD) * 0.55 + rand(0, 0.12);
    }
    updateCount();
  }

  /* ---- one Lloyd relaxation step: move each seed toward its cell centroid ---- */
  function lloydStep(strength) {
    const n = seeds.length;
    if (!n) return;
    const gx = Math.max(20, Math.round(cssW / 24));
    const gy = Math.max(16, Math.round(cssH / 24));
    const sumX = new Float32Array(n), sumY = new Float32Array(n), cnt = new Float32Array(n);
    for (let iy = 0; iy < gy; iy++) {
      const py = (iy + 0.5) / gy * cssH;
      for (let ix = 0; ix < gx; ix++) {
        const px = (ix + 0.5) / gx * cssW;
        let best = 0, bd = 1e20;
        for (let k = 0; k < n; k++) {
          const dx = px - seeds[k].x, dy = py - seeds[k].y;
          const d = dx * dx + dy * dy;
          if (d < bd) { bd = d; best = k; }
        }
        sumX[best] += px; sumY[best] += py; cnt[best]++;
      }
    }
    for (let k = 0; k < n; k++) {
      if (cnt[k] > 0) {
        const tx = sumX[k] / cnt[k], ty = sumY[k] / cnt[k];
        seeds[k].x += (tx - seeds[k].x) * strength;
        seeds[k].y += (ty - seeds[k].y) * strength;
      }
    }
  }

  function updateCount() { paneVal.textContent = seeds.length; }

  /* ============================ per-frame update ============================ */
  function step(dt) {
    // light (the sun) sweeps a slow arc, mostly across the upper window
    const lspeed = REDMO ? 0.012 : 0.05;
    lightAngle += dt * lspeed;

    const growingIdle = !overlayUp && !interacting;
    for (let i = 0; i < seeds.length; i++) {
      const s = seeds[i];
      // grow-in
      if (s.w < -0.5) {
        if (s.delay > 0) s.delay -= dt;
        else s.w += (0 - s.w) * (1 - Math.exp(-dt / GROW_TAU));
      } else if (s.w !== 0) s.w = 0;
      // colour ease toward target (palette transitions)
      const ck = 1 - Math.exp(-dt / COL_TAU);
      s.cr += (s.tr - s.cr) * ck; s.cg += (s.tg - s.cg) * ck; s.cb += (s.tb - s.cb) * ck;
      // drift + bounce (frozen under reduced motion)
      if (!REDMO && growingIdle && settleLeft <= 0) {
        s.x += s.vx * dt; s.y += s.vy * dt;
        if (s.x < 4) { s.x = 4; s.vx = Math.abs(s.vx); }
        else if (s.x > cssW - 4) { s.x = cssW - 4; s.vx = -Math.abs(s.vx); }
        if (s.y < 4) { s.y = 4; s.vy = Math.abs(s.vy); }
        else if (s.y > cssH - 4) { s.y = cssH - 4; s.vy = -Math.abs(s.vy); }
      }
    }

    // animated Settle: recompute centroids and nudge every ~0.11s
    if (settleLeft > 0) {
      settleTimer -= dt;
      if (settleTimer <= 0) {
        lloydStep(0.5);
        settleLeft--;
        settleTimer = 0.11;
        if (settleLeft <= 0) { settleBtn.classList.remove("is-busy"); }
      }
    }
  }

  function lightXY() {
    const a = lightAngle;
    return {
      x: cssW * (0.5 + 0.62 * Math.sin(a)),
      y: cssH * (0.26 + 0.20 * Math.cos(a * 0.7) + 0.06 * Math.sin(a * 1.7))
    };
  }

  function anySeedGrowing() {
    for (let i = 0; i < seeds.length; i++) if (seeds[i].w < -0.5) return true;
    return false;
  }
  function anyColorEasing() {
    for (let i = 0; i < seeds.length; i++) {
      const s = seeds[i];
      if (Math.abs(s.cr - s.tr) > 0.003 || Math.abs(s.cg - s.tg) > 0.003 || Math.abs(s.cb - s.tb) > 0.003) return true;
    }
    return false;
  }

  /* ============================ draw ============================ */
  function draw() {
    const dpr = Math.min(window.devicePixelRatio || 1, MAXDPR);
    const bw = Math.max(1, Math.round(cssW * dpr));
    const bh = Math.max(1, Math.round(cssH * dpr));
    if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh; }
    gl.viewport(0, 0, bw, bh);
    const ps = bw / cssW;

    for (let i = 0; i < seeds.length; i++) {
      const s = seeds[i];
      seedBuf[i * 3] = s.x * ps;
      seedBuf[i * 3 + 1] = (cssH - s.y) * ps;   // gl_FragCoord origin is bottom-left
      seedBuf[i * 3 + 2] = s.w * ps;
      colBuf[i * 3] = s.cr; colBuf[i * 3 + 1] = s.cg; colBuf[i * 3 + 2] = s.cb;
    }

    const L = lightXY();
    gl.useProgram(prog);
    gl.uniform2f(U.uRes, bw, bh);
    gl.uniform1i(U.uCount, seeds.length);
    gl.uniform3fv(U.uSeed, seedBuf);
    gl.uniform3fv(U.uCol, colBuf);
    gl.uniform2f(U.uLight, L.x * ps, (cssH - L.y) * ps);
    gl.uniform1f(U.uLead, LEAD_HALF * 2 * ps);
    gl.uniform1f(U.uAA, Math.max(1.5, 1.4 * ps));

    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.enableVertexAttribArray(U.aPos);
    gl.vertexAttribPointer(U.aPos, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  /* ============================ frame loop ============================ */
  function requestRender() { if (!rafPending) { rafPending = true; requestAnimationFrame(frame); } }
  function frame(ts) {
    rafPending = false;
    const dt = lastT ? Math.min(0.05, (ts - lastT) / 1000) : 0.016;
    lastT = ts;
    tSec += dt;

    if (!overlayUp) step(dt);
    updateAudio(dt);
    draw();

    // Keep the loop alive so the sun keeps sweeping + panes keep drifting (a living screensaver).
    // Under reduced motion, only keep looping while something is actively animating.
    const busy = interacting || settleLeft > 0 || anySeedGrowing() || anyColorEasing();
    const keep = !overlayUp && !document.hidden && (!REDMO || busy);
    if (keep) requestRender(); else lastT = 0;
  }

  /* ============================ interaction ============================ */
  const pointers = new Map();
  let downInfo = null;   // { id, x, y, t, moved }

  function canvasXY(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function addPane(x, y) {
    if (seeds.length >= MAXSEEDS) {
      seeds.shift();   // retire the oldest pane to stay lively at the cap
    }
    seeds.push(makeSeed(clamp(x, 6, cssW - 6), clamp(y, 6, cssH - 6), true));
    updateCount();
    chimeGlass(clamp(x / cssW, 0, 1));
    if (window.gtag) try { gtag("event", "stained_glass_pane"); } catch (e) {}
    requestRender();
  }

  // a drag pushes nearby seeds along the motion (stir the glass)
  function herd(px, py, dx, dy) {
    for (let i = 0; i < seeds.length; i++) {
      const s = seeds[i];
      const d = Math.hypot(s.x - px, s.y - py);
      if (d < HERD_R) {
        const f = (1 - d / HERD_R);
        s.x = clamp(s.x + dx * f * HERD_STR + (s.x - px) * 0.02 * f, 4, cssW - 4);
        s.y = clamp(s.y + dy * f * HERD_STR + (s.y - py) * 0.02 * f, 4, cssH - 4);
      }
    }
  }

  function onDown(e) {
    if (overlayUp) return;
    canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
    const p = canvasXY(e);
    pointers.set(e.pointerId, p);
    if (!downInfo) downInfo = { id: e.pointerId, x: p.x, y: p.y, t: performance.now(), moved: false };
    interacting = true;
    hideHint();
    requestRender();
  }
  function onMove(e) {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    const p = canvasXY(e);
    const dx = p.x - prev.x, dy = p.y - prev.y;
    pointers.set(e.pointerId, p);
    if (downInfo && e.pointerId === downInfo.id) {
      if (Math.hypot(p.x - downInfo.x, p.y - downInfo.y) > 7) {
        if (!downInfo.moved) { downInfo.moved = true; canvas.classList.add("is-grabbing"); }
      }
    }
    if (downInfo && downInfo.moved) herd(p.x, p.y, dx, dy);
    requestRender();
  }
  function onUp(e) {
    const wasDown = downInfo && e.pointerId === downInfo.id;
    pointers.delete(e.pointerId);
    if (wasDown) {
      const dur = performance.now() - downInfo.t;
      if (!downInfo.moved && dur < 600) addPane(downInfo.x, downInfo.y);   // a real tap → add a pane
      downInfo = null;
      canvas.classList.remove("is-grabbing");
    }
    if (pointers.size === 0) interacting = false;
    requestRender();
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
    for (let k = 0; k < seeds.length; k++) {
      const c = paletteColor(seeds[k].ci);
      seeds[k].tr = c[0]; seeds[k].tg = c[1]; seeds[k].tb = c[2];
    }
    chimeGlass(0.5);
    requestRender();
  }
  function runSettle() {
    if (!seeds.length) return;
    settleLeft = 5; settleTimer = 0;
    settleBtn.classList.add("is-busy");
    chimeGlass(0.35); chimeGlass(0.65);
    requestRender();
  }
  function newWindow() {
    generate(INIT_SEEDS);
    // a soft rising chord as the window reforms
    const notes = [0.28, 0.45, 0.6, 0.78];
    notes.forEach(function (x, i) { setTimeout(function () { chimeGlass(x); }, i * 120); });
    requestRender();
  }

  paletteBtn.addEventListener("click", function () { setPalette(palette + 1); });
  settleBtn.addEventListener("click", runSettle);
  resetBtn.addEventListener("click", newWindow);
  soundBtn.addEventListener("click", function () { setSound(!audioOn); });

  window.addEventListener("keydown", function (e) {
    if (overlayUp) return;
    if (e.key === "p" || e.key === "P") setPalette(palette + 1);
    else if (e.key === "s" || e.key === "S") runSettle();
    else if (e.key === "n" || e.key === "N") newWindow();
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

  /* ============================ audio (glass chimes + shimmer bed) ============================ */
  let AC = null, master = null, chimeBus = null, bedGain = null, bedLP = null;
  let audioOn = true, audioStarted = false;
  const MASTER_VOL = 0.42;
  // C major pentatonic across a few octaves — any chime lands consonant
  const SCALE = [];
  (function () {
    const base = [523.25, 587.33, 659.25, 783.99, 880.00];   // C5 D5 E5 G5 A5
    for (let o = -1; o <= 1; o++) for (let k = 0; k < base.length; k++) SCALE.push(base[k] * Math.pow(2, o));
  })();

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
    const lp = AC.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 7200; lp.Q.value = 0.6; lp.connect(master);
    const comp = AC.createDynamicsCompressor();
    comp.threshold.value = -15; comp.ratio.value = 3; comp.attack.value = 0.004; comp.release.value = 0.28;
    comp.connect(lp);

    const conv = AC.createConvolver(); conv.buffer = makeImpulse(3.6, 2.4);
    const wet = AC.createGain(); wet.gain.value = 0.6; conv.connect(wet); wet.connect(comp);
    const dry = AC.createGain(); dry.gain.value = 0.85; dry.connect(comp);

    chimeBus = AC.createGain(); chimeBus.gain.value = 0.9; chimeBus.connect(dry); chimeBus.connect(conv);

    // soft evolving shimmer bed — a high, airy pentatonic cluster, mostly through the reverb
    bedLP = AC.createBiquadFilter(); bedLP.type = "lowpass"; bedLP.frequency.value = 2400; bedLP.Q.value = 0.5;
    bedGain = AC.createGain(); bedGain.gain.value = 0.16; bedGain.connect(dry); bedGain.gain.value = 0.10;
    const bedWet = AC.createGain(); bedWet.gain.value = 0.5; bedLP.connect(bedGain); bedLP.connect(bedWet); bedWet.connect(conv);
    const bedNotes = [523.25, 659.25, 783.99, 987.77];   // Cmaj add9 shimmer
    bedNotes.forEach(function (f, i) {
      const pan = AC.createStereoPanner ? AC.createStereoPanner() : null;
      let dest = bedLP;
      if (pan) { pan.pan.value = (i / (bedNotes.length - 1) - 0.5) * 0.8; pan.connect(bedLP); dest = pan; }
      [0, 5].forEach(function (cents, k) {
        const o = AC.createOscillator(); o.type = "sine"; o.frequency.value = f;
        o.detune.value = cents + (i - 1.5) * 2;
        const g = AC.createGain(); g.gain.value = (k ? 0.010 : 0.020);
        o.connect(g); g.connect(dest); o.start();
      });
    });
    // slow breathing of the bed + its filter (keeps it alive without ever pulsing obviously)
    const alfo = AC.createOscillator(); alfo.type = "sine"; alfo.frequency.value = 0.055;
    const alfoG = AC.createGain(); alfoG.gain.value = 0.05; alfo.connect(alfoG); alfoG.connect(bedGain.gain); alfo.start();
    const flfo = AC.createOscillator(); flfo.type = "sine"; flfo.frequency.value = 0.03;
    const flfoG = AC.createGain(); flfoG.gain.value = 700; flfo.connect(flfoG); flfoG.connect(bedLP.frequency); flfo.start();

    master.gain.setValueAtTime(0.0001, AC.currentTime);
    master.gain.linearRampToValueAtTime(audioOn ? MASTER_VOL : 0.0001, AC.currentTime + 1.8);
  }
  function updateAudio() { /* bed evolves via its own LFOs; no per-frame work needed */ }

  // crystalline glass chime: a bright, slightly inharmonic bell tuned to the pentatonic scale
  function chimeGlass(x01) {
    if (!AC || !audioOn || !chimeBus) return;
    const now = AC.currentTime;
    const base = SCALE[Math.floor(Math.random() * SCALE.length)];
    const pan = AC.createStereoPanner ? AC.createStereoPanner() : null;
    let head = chimeBus;
    if (pan) { pan.pan.value = clamp((x01 - 0.5) * 1.5, -1, 1); pan.connect(chimeBus); head = pan; }
    // glass-bell partials (mildly inharmonic, brighter than a tube), highs decay fast
    const partials = [
      { m: 1.00, g: 0.22, d: 2.2 },
      { m: 2.01, g: 0.13, d: 1.5 },
      { m: 3.42, g: 0.08, d: 0.9 },
      { m: 5.06, g: 0.05, d: 0.6 },
      { m: 6.81, g: 0.03, d: 0.4 }
    ];
    const det = rand(-4, 4);
    for (let i = 0; i < partials.length; i++) {
      const pt = partials[i];
      const o = AC.createOscillator(); o.type = "sine";
      o.frequency.value = base * pt.m; o.detune.value = det;
      const g = AC.createGain(); g.gain.value = 0;
      o.connect(g); g.connect(head);
      const amp = pt.g * rand(0.85, 1.0);
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(amp, now + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0006, now + pt.d);
      o.start(now); o.stop(now + pt.d + 0.05);
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
    const sx = w / cssW, sy = h / cssH;
    for (let i = 0; i < seeds.length; i++) {
      seeds[i].x *= sx; seeds[i].y *= sy;
    }
    cssW = w; cssH = h;
    requestRender();
  }
  window.addEventListener("resize", resize);
  window.addEventListener("orientationchange", function () { setTimeout(resize, 120); });
  document.addEventListener("visibilitychange", function () { if (!document.hidden && !overlayUp) { lastT = 0; requestRender(); } });

  /* ============================ boot ============================ */
  cssW = window.innerWidth; cssH = window.innerHeight;
  generate(INIT_SEEDS);
  paletteBtn.textContent = PALETTES[palette].name;
  soundBtn.setAttribute("aria-pressed", "true");
  requestRender();   // draw the window behind the intro overlay

  function dismissOverlay() {
    if (!overlayUp) return;
    overlayUp = false;
    overlay.classList.add("is-hidden");
    setTimeout(function () { overlay.hidden = true; }, 360);
    if (audioOn) startAudio();
    setHint("tap to add a pane · drag to herd the glass · Settle to even them out");
    lastT = 0;
    requestRender();
  }
  ovBtn.addEventListener("click", dismissOverlay);
})();
