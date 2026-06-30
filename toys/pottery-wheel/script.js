/* Pottery Wheel — a calming digital pottery wheel.
 * A lump of clay spins on the wheel; drag up and down its side to pull the walls out
 * and in, shaping a vase / bowl / pot. The clay is a surface of revolution rendered
 * with cylindrical shading + a hollow rim, so it reads as soft 3D in plain Canvas 2D.
 */
(function () {
  "use strict";

  // ---- TUNABLES -----------------------------------------------------------
  var ROWS = 150;               // vertical resolution of the clay profile
  var ELLIPSE_K = 0.26;         // how flat the cross-section rings look (viewing tilt)
  var SHAPE_RATE = 0.45;        // how strongly a drag pulls the wall
  var BRUSH = 12;               // how many rows a drag affects (finger width)
  var SPIN_SPEED = 3.4;         // wheel rotation while throwing (rad/s)
  var HEAT_UP = 2.0, SOAK = 0.9, COOL = 2.8;   // kiln firing phases (seconds)
  // wet clay material: hue-preserving terracotta ramp (matte, never white)
  var CLAY_MAT = { name: "Clay", shadow: [78, 42, 28], base: [196, 120, 80], lit: [233, 181, 134], gloss: 0 };
  // fired glazes — each reveal picks one at random (glossy ceramic finishes)
  var GLAZES = [
    { name: "Celadon",     shadow: [42, 70, 56],    base: [138, 174, 146], lit: [186, 214, 184], gloss: 0.78 },
    { name: "Cobalt",      shadow: [16, 24, 62],    base: [52, 80, 152],   lit: [120, 150, 214], gloss: 0.82 },
    { name: "Oxblood",     shadow: [38, 10, 10],    base: [126, 32, 28],   lit: [196, 86, 66],   gloss: 0.82 },
    { name: "Honey",       shadow: [60, 38, 14],    base: [172, 116, 50],  lit: [224, 180, 112], gloss: 0.76 },
    { name: "Matte White", shadow: [118, 110, 98],  base: [210, 204, 192], lit: [238, 234, 224], gloss: 0.20 },
    { name: "Sage Ash",    shadow: [68, 76, 62],    base: [148, 156, 132], lit: [198, 204, 184], gloss: 0.40, speckle: true }
  ];
  // -------------------------------------------------------------------------

  var canvas = document.getElementById("canvas");
  var ctx = canvas.getContext("2d");
  var hintEl = document.querySelector(".hint");
  var palette = document.getElementById("palette");
  var HINT_THROW = "drag up & down the clay to shape it — then fire it to finish";
  var HINT_PAINT = "pick a colour and drag to paint your pot";

  var W, H, DPR, cx, baseY, rimY, potH, R0, MINR, MAXR, WHEEL_R;
  var rad = new Float32Array(ROWS);     // current radius of each row (px)
  var tgt = new Float32Array(ROWS);     // target radius
  var spin = 0, spinSpeed = SPIN_SPEED;
  var shade = [];                       // precomputed horizontal shading stops

  // ---- firing + painting state --------------------------------------------
  var mode = "throwing";        // "throwing" | "firing" | "painting"
  var curMat = CLAY_MAT;        // material currently shading the vessel
  var glaze = null;             // chosen glaze once fired
  var fireT = 0;                // seconds into the firing
  var heat = 0;                 // 0..1 incandescent glow during firing
  var matMix = 0;              // 0 = clay, 1 = glaze (locks in as it cools)
  var speckles = [];            // seeded fixed speckle positions for speckled glazes
  var captionT = 0, captionText = "";

  // decorating: a paint palette + wrap-around marks (angle a, row r, colour c)
  var PAINTS = [
    ["Ink", [40, 38, 44]], ["White", [238, 236, 230]], ["Cobalt", [44, 72, 152]],
    ["Gold", [208, 160, 66]], ["Coral", [198, 80, 62]], ["Sage", [120, 150, 116]], ["Plum", [122, 66, 122]]
  ];
  var MAX_MARKS = 1500;
  var marks = [];               // {a, r, c, rad, al}
  var markIdx = 0;
  var paintCol = PAINTS[0][1];
  var paintRad = 7;             // brush radius (px), set in resize()

  function lerp3(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
  function lerpMat(a, b, t) {
    return { shadow: lerp3(a.shadow, b.shadow, t), base: lerp3(a.base, b.base, t), lit: lerp3(a.lit, b.lit, t), gloss: a.gloss + (b.gloss - a.gloss) * t };
  }
  // incandescent colour of clay at firing temperature h (0..1): dull red -> orange -> yellow-white
  function incand(h) {
    if (h < 0.45) return lerp3([54, 8, 2], [184, 44, 8], h / 0.45);
    if (h < 0.78) return lerp3([184, 44, 8], [255, 124, 24], (h - 0.45) / 0.33);
    return lerp3([255, 124, 24], [255, 226, 182], (h - 0.78) / 0.22);
  }

  // build the horizontal shading ramp for a material (shadow -> base -> lit).
  // matte clay rides the colour ramp (never toward white); glossy glazes add a
  // tighter, whiter specular so fired pieces read as glazed ceramic.
  function buildShade(mat) {
    shade = [];
    var gloss = mat.gloss || 0;
    var specP = 3 + gloss * 11;           // a crisp narrow glint when glossier
    var specAmt = 0.10 + gloss * 0.30;    // restrained so the glaze colour still reads
    var tR = 210 + 45 * gloss, tG = 180 + 75 * gloss, tB = 150 + 105 * gloss;  // warm -> white
    var Lx = -0.55, Lz = 0.84;            // light from upper-left, toward viewer
    for (var k = 0; k <= 14; k++) {
      var u = -1 + 2 * k / 14;            // horizontal position across a ring [-1..1]
      var nz = Math.sqrt(Math.max(0, 1 - u * u));
      var diff = Math.max(0, u * Lx + nz * Lz);   // lambert term, 0..~1
      var R, G, B, m;
      if (diff < 0.5) { m = diff / 0.5;
        R = mat.shadow[0] + (mat.base[0] - mat.shadow[0]) * m;
        G = mat.shadow[1] + (mat.base[1] - mat.shadow[1]) * m;
        B = mat.shadow[2] + (mat.base[2] - mat.shadow[2]) * m;
      } else { m = (diff - 0.5) / 0.5;
        R = mat.base[0] + (mat.lit[0] - mat.base[0]) * m;
        G = mat.base[1] + (mat.lit[1] - mat.base[1]) * m;
        B = mat.base[2] + (mat.lit[2] - mat.base[2]) * m;
      }
      var spec = Math.pow(diff, specP) * specAmt;
      R = Math.min(255, R + spec * tR);
      G = Math.min(255, G + spec * tG);
      B = Math.min(255, B + spec * tB);
      shade.push([(u + 1) / 2, "rgb(" + (R | 0) + "," + (G | 0) + "," + (B | 0) + ")"]);
    }
  }

  function initClay() {
    for (var i = 0; i < ROWS; i++) {
      var t = i / (ROWS - 1);
      // a fresh column of clay with a gently rounded belly
      rad[i] = tgt[i] = R0 * (0.86 + 0.16 * Math.sin(Math.PI * t));
    }
    // back to wet clay on the wheel
    mode = "throwing"; curMat = CLAY_MAT; glaze = null; heat = 0; matMix = 0; fireT = 0;
    speckles = []; captionT = 0; marks = []; markIdx = 0;
    if (fireBtn) fireBtn.disabled = false;
    if (canvas) canvas.classList.remove("is-done", "is-paint");
    if (palette) palette.hidden = true;
    if (hintEl) { hintEl.textContent = HINT_THROW; hintEl.classList.remove("is-hidden"); }
  }

  // ---- painting -----------------------------------------------------------
  // place a paint mark under the cursor: map screen x -> angle on the (spinning)
  // surface of revolution, so the dab is anchored to the clay and wraps around.
  function paintAt(x, y) {
    var i = Math.round((baseY - y) / potH * (ROWS - 1));
    if (i < 0 || i > ROWS - 1) return;
    var R = rad[i]; if (R < 2) return;
    var xf = (x - cx) / R;
    if (xf < -0.97 || xf > 0.97) return;        // too near the silhouette to place
    var relA = Math.asin(Math.max(-1, Math.min(1, xf)));
    var m = marks[markIdx % MAX_MARKS] || (marks[markIdx % MAX_MARKS] = {});
    m.a = relA + spin; m.r = i; m.c = paintCol; m.rad = paintRad; m.al = 0.9;
    markIdx++;
  }

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = W * DPR; canvas.height = H * DPR;
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    var minD = Math.min(W, H);
    cx = W / 2;
    potH = minD * 0.44;
    baseY = H * 0.66;
    rimY = baseY - potH;
    R0 = minD * 0.115;
    MINR = R0 * 0.16;
    MAXR = minD * 0.26;
    WHEEL_R = R0 * 2.5;
    paintRad = Math.max(5, minD * 0.013);
    if (!rad[0]) initClay();
    buildShade(curMat);
  }

  function rowY(i) { return baseY - (i / (ROWS - 1)) * potH; }

  // ---- shaping ------------------------------------------------------------
  var down = false, lastSpeed = 0;
  function shapeAt(x, y) {
    var i = Math.round((baseY - y) / potH * (ROWS - 1));
    if (i < 0) i = 0; else if (i > ROWS - 1) i = ROWS - 1;
    var want = Math.abs(x - cx);
    if (want < MINR) want = MINR; else if (want > MAXR) want = MAXR;
    for (var j = i - BRUSH; j <= i + BRUSH; j++) {
      if (j < 0 || j > ROWS - 1) continue;
      var d = (j - i) / BRUSH;
      var w = Math.exp(-d * d * 2.2) * SHAPE_RATE;   // soft finger falloff
      tgt[j] += (want - tgt[j]) * w;
    }
  }

  var lastPaint = null;
  function pointerDown(x, y) {
    unlock();
    if (mode === "throwing") { down = true; shapeAt(x, y); if (hintEl) hintEl.classList.add("is-hidden"); }
    else if (mode === "painting") { down = true; lastPaint = [x, y]; paintAt(x, y); if (hintEl) hintEl.classList.add("is-hidden"); }
  }
  function pointerMove(x, y) {
    if (!down) return;
    if (mode === "throwing") shapeAt(x, y);
    else if (mode === "painting") {
      if (lastPaint) {   // interpolate along the drag so fast strokes stay solid
        var dx = x - lastPaint[0], dy = y - lastPaint[1], dist = Math.sqrt(dx * dx + dy * dy);
        var steps = Math.max(1, Math.floor(dist / (paintRad * 0.6)));
        for (var s = 1; s <= steps; s++) paintAt(lastPaint[0] + dx * s / steps, lastPaint[1] + dy * s / steps);
      } else paintAt(x, y);
      lastPaint = [x, y];
    }
  }
  function pointerUp() { down = false; lastPaint = null; }
  canvas.addEventListener("mousedown", function (e) { pointerDown(e.clientX, e.clientY); });
  window.addEventListener("mousemove", function (e) { pointerMove(e.clientX, e.clientY); });
  window.addEventListener("mouseup", pointerUp);
  canvas.addEventListener("touchstart", function (e) { e.preventDefault(); var t = e.touches[0]; pointerDown(t.clientX, t.clientY); }, { passive: false });
  canvas.addEventListener("touchmove", function (e) { e.preventDefault(); var t = e.touches[0]; pointerMove(t.clientX, t.clientY); }, { passive: false });
  canvas.addEventListener("touchend", function (e) { e.preventDefault(); pointerUp(); }, { passive: false });

  var newBtn = document.getElementById("newBtn");
  if (newBtn) newBtn.addEventListener("click", function () { initClay(); });

  // ---- fire it: kiln the clay, then reveal a finished glazed piece ---------
  var fireBtn = document.getElementById("fireBtn");
  function startFiring() {
    if (mode !== "throwing") return;
    unlock();
    mode = "firing"; fireT = 0; heat = 0; matMix = 0; down = false;
    // pick a glaze for the reveal (index varies even without Math.random feel)
    glaze = GLAZES[(Math.random() * GLAZES.length) | 0];
    speckles = [];
    if (glaze.speckle) {
      for (var n = 0; n < 70; n++) speckles.push([Math.random(), Math.random() * 2 - 1, 0.5 + Math.random() * 0.5]);
    }
    if (fireBtn) fireBtn.disabled = true;
    if (canvas) canvas.classList.add("is-done");
    if (hintEl) hintEl.classList.add("is-hidden");
    kilnRoar(HEAT_UP + SOAK + COOL);
  }
  if (fireBtn) fireBtn.addEventListener("click", startFiring);

  // build the paint palette swatches (hidden until the piece is fired)
  if (palette) {
    PAINTS.forEach(function (p, idx) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "swatch" + (idx === 0 ? " is-active" : "");
      btn.style.background = "rgb(" + p[1][0] + "," + p[1][1] + "," + p[1][2] + ")";
      btn.title = p[0]; btn.setAttribute("aria-label", "Paint colour: " + p[0]);
      btn.addEventListener("click", function () {
        paintCol = p[1]; unlock();
        var all = palette.querySelectorAll(".swatch");
        for (var s = 0; s < all.length; s++) all[s].classList.remove("is-active");
        btn.classList.add("is-active");
      });
      palette.appendChild(btn);
    });
  }
  function enterPainting() {
    mode = "painting";
    if (canvas) { canvas.classList.remove("is-done"); canvas.classList.add("is-paint"); }
    if (palette) palette.hidden = false;
    if (hintEl) { hintEl.textContent = HINT_PAINT; hintEl.classList.remove("is-hidden"); }
    if (hintEl) setTimeout(function () { if (mode === "painting") hintEl.classList.add("is-hidden"); }, 7000);
  }

  // ---- audio: soft wheel hum + clay-shaping swish (synth) -----------------
  var actx = null, master = null, outGain = null, muted = false, hum = null, shapeGain = null, noiseBuffer = null;
  function unlock() {
    if (actx) { if (actx.state === "suspended") actx.resume(); return; }
    try {
      actx = new (window.AudioContext || window.webkitAudioContext)();
      var b = actx.createBuffer(1, 1, 22050); var s = actx.createBufferSource(); s.buffer = b; s.connect(actx.destination); s.start(0);
      outGain = actx.createGain(); outGain.gain.value = muted ? 0 : 1; outGain.connect(actx.destination);
      master = actx.createGain(); master.gain.value = 0.9; master.connect(outGain);
      // low motor hum
      var o = actx.createOscillator(); o.type = "triangle"; o.frequency.value = 68;
      var o2 = actx.createOscillator(); o2.type = "sine"; o2.frequency.value = 136;
      var hg = actx.createGain(); hg.gain.value = 0.05;
      var hlp = actx.createBiquadFilter(); hlp.type = "lowpass"; hlp.frequency.value = 280;
      var lfo = actx.createOscillator(); lfo.type = "sine"; lfo.frequency.value = 5.2;
      var lg = actx.createGain(); lg.gain.value = 0.012;
      o.connect(hlp); o2.connect(hg); hg.connect(hlp); hlp.connect(master);
      lfo.connect(lg); lg.connect(master.gain);
      o.start(); o2.start(); lfo.start();
      hum = hg;
      // clay-shaping swish bed (wet friction), gated by shaping speed
      var noise = actx.createBuffer(1, actx.sampleRate, actx.sampleRate), nd = noise.getChannelData(0);
      for (var i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
      noiseBuffer = noise;
      var ns = actx.createBufferSource(); ns.buffer = noise; ns.loop = true;
      var nbp = actx.createBiquadFilter(); nbp.type = "bandpass"; nbp.frequency.value = 900; nbp.Q.value = 0.7;
      shapeGain = actx.createGain(); shapeGain.gain.value = 0;
      ns.connect(nbp); nbp.connect(shapeGain); shapeGain.connect(master); ns.start();
    } catch (e) { actx = null; }
  }
  var soundBtn = document.getElementById("soundBtn");
  if (soundBtn) soundBtn.addEventListener("click", function () {
    muted = !muted; unlock();
    if (outGain) outGain.gain.setTargetAtTime(muted ? 0 : 1, actx.currentTime, 0.02);
    soundBtn.textContent = muted ? "Sound: off" : "Sound: on";
    soundBtn.setAttribute("aria-pressed", muted ? "true" : "false");
  });

  // kiln roar — a swelling band of filtered noise that builds then settles
  function kilnRoar(dur) {
    if (!actx || !noiseBuffer || !master) return;
    var t0 = actx.currentTime;
    var ns = actx.createBufferSource(); ns.buffer = noiseBuffer; ns.loop = true;
    var lp = actx.createBiquadFilter(); lp.type = "lowpass";
    lp.frequency.setValueAtTime(180, t0);
    lp.frequency.linearRampToValueAtTime(950, t0 + dur * 0.45);
    lp.frequency.linearRampToValueAtTime(260, t0 + dur);
    var g = actx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(0.16, t0 + dur * 0.42);
    g.gain.setValueAtTime(0.16, t0 + dur * 0.62);
    g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
    // slow breathing of the roar
    var lfo = actx.createOscillator(); lfo.type = "sine"; lfo.frequency.value = 0.7;
    var lg = actx.createGain(); lg.gain.value = 0.04;
    lfo.connect(lg); lg.connect(g.gain);
    ns.connect(lp); lp.connect(g); g.connect(master);
    ns.start(t0); ns.stop(t0 + dur + 0.1); lfo.start(t0); lfo.stop(t0 + dur + 0.1);
  }

  // soft two-tone bell when the fired piece is revealed
  function chime() {
    if (!actx || !master) return;
    var t0 = actx.currentTime;
    [784, 1176].forEach(function (f, i) {
      var o = actx.createOscillator(); o.type = "sine"; o.frequency.value = f;
      var g = actx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(i ? 0.05 : 0.09, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0006, t0 + 1.7);
      o.connect(g); g.connect(master); o.start(t0); o.stop(t0 + 1.8);
    });
  }

  // ---- render -------------------------------------------------------------
  function drawBackground() {
    var g = ctx.createRadialGradient(cx, baseY - potH * 0.4, 0, cx, baseY, Math.max(W, H) * 0.85);
    g.addColorStop(0, "#3a2820");
    g.addColorStop(0.5, "#2a1c14");
    g.addColorStop(1, "#180f0a");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // warm key light from the upper left
    var kl = ctx.createRadialGradient(cx - potH * 0.5, rimY - potH * 0.2, 0, cx - potH * 0.5, rimY, potH * 1.6);
    kl.addColorStop(0, "rgba(255,210,150,0.10)");
    kl.addColorStop(1, "rgba(255,210,150,0)");
    ctx.fillStyle = kl; ctx.fillRect(0, 0, W, H);
  }

  function drawWheel() {
    // contact shadow of the clay on the wheel
    ctx.fillStyle = "rgba(0,0,0,0.34)";
    ctx.beginPath(); ctx.ellipse(cx, baseY + 4, rad[0] * 1.16, rad[0] * 1.16 * ELLIPSE_K, 0, 0, 6.283); ctx.fill();
    // the wheel head
    var wy = baseY + R0 * 0.12;
    var wg = ctx.createLinearGradient(cx - WHEEL_R, 0, cx + WHEEL_R, 0);
    wg.addColorStop(0, "#1c130d"); wg.addColorStop(0.5, "#3b271b"); wg.addColorStop(1, "#160e08");
    ctx.fillStyle = wg;
    ctx.beginPath(); ctx.ellipse(cx, wy, WHEEL_R, WHEEL_R * ELLIPSE_K, 0, 0, 6.283); ctx.fill();
    // spinning radial ticks so you can see it turn
    ctx.strokeStyle = "rgba(220,180,140,0.18)"; ctx.lineWidth = 1.4;
    for (var k = 0; k < 16; k++) {
      var a = spin + k * 0.3927;
      var c = Math.cos(a), s = Math.sin(a);
      if (s < -0.1) continue;            // only ticks on the near half
      ctx.globalAlpha = 0.25 + 0.4 * Math.max(0, s);
      ctx.beginPath();
      ctx.moveTo(cx + c * WHEEL_R * 0.62, wy + s * WHEEL_R * 0.62 * ELLIPSE_K);
      ctx.lineTo(cx + c * WHEEL_R * 0.96, wy + s * WHEEL_R * 0.96 * ELLIPSE_K);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // rim of the wheel head
    ctx.strokeStyle = "rgba(120,84,56,0.5)"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(cx, wy, WHEEL_R, WHEEL_R * ELLIPSE_K, 0, 0, 6.283); ctx.stroke();
  }

  // render paint marks: each is anchored at an absolute angle on the pot, so as
  // the wheel turns they sweep to the front, round to the back, and return.
  function drawPaint() {
    var Lx = -0.55, Lz = 0.84;
    for (var k = 0; k < marks.length; k++) {
      var m = marks[k]; if (!m) continue;
      var relA = m.a - spin;
      relA = Math.atan2(Math.sin(relA), Math.cos(relA));   // normalize to -PI..PI
      var cf = Math.cos(relA); if (cf <= 0.05) continue;   // on the back, hidden
      var R = rad[m.r], u = Math.sin(relA);
      var nz = Math.sqrt(Math.max(0, 1 - u * u));
      var bf = 0.42 + 0.58 * Math.min(1, Math.max(0, u * Lx + nz * Lz));  // lit by the same key light
      var al = m.al * Math.min(1, cf * 1.5);               // fade toward the silhouette
      ctx.fillStyle = "rgba(" + ((m.c[0] * bf) | 0) + "," + ((m.c[1] * bf) | 0) + "," + ((m.c[2] * bf) | 0) + "," + al.toFixed(3) + ")";
      ctx.beginPath();
      ctx.ellipse(cx + u * R * 0.985, rowY(m.r), m.rad * (0.3 + 0.7 * cf), m.rad, 0, 0, 6.283);
      ctx.fill();
    }
  }

  function drawClay() {
    var bh = potH / (ROWS - 1) + 1.4;
    // a rounded foot where the clay meets the wheel (so the base isn't a flat cut)
    var R0r = rad[0];
    var fg = ctx.createRadialGradient(cx, baseY - R0r * ELLIPSE_K * 0.6, R0r * 0.1, cx, baseY, R0r);
    fg.addColorStop(0, "rgba(120,66,42,0)");
    fg.addColorStop(0.7, "rgba(70,36,22,0.0)");
    fg.addColorStop(1, "rgba(30,15,9,0.55)");
    ctx.fillStyle = fg;
    ctx.beginPath(); ctx.ellipse(cx, baseY, R0r * 1.02, R0r * ELLIPSE_K * 1.05, 0, 0, 6.283); ctx.fill();
    // clip to the smooth vessel silhouette so the band edges don't stair-step
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cx - rad[0], rowY(0));
    for (var li = 1; li < ROWS; li++) ctx.lineTo(cx - rad[li], rowY(li));
    ctx.lineTo(cx + rad[ROWS - 1], rowY(ROWS - 1));
    for (var ri = ROWS - 2; ri >= 0; ri--) ctx.lineTo(cx + rad[ri], rowY(ri));
    ctx.closePath();
    ctx.clip();
    // body: stack shaded horizontal bands from base to just below the rim
    for (var i = 0; i < ROWS - 1; i++) {
      var R = rad[i]; if (R < 0.5) continue;
      var yy = rowY(i);
      var vf = 0.62 + 0.4 * (i / (ROWS - 1));     // a little darker toward the base (occlusion)
      var grad = ctx.createLinearGradient(cx - R, 0, cx + R, 0);
      for (var s = 0; s < shade.length; s++) grad.addColorStop(shade[s][0], shade[s][1]);
      ctx.save();
      ctx.globalAlpha = 1;
      ctx.fillStyle = grad;
      ctx.fillRect(cx - R, yy - bh, R * 2, bh + 1.5);
      // occlusion veil toward the base
      if (vf < 0.99) { ctx.fillStyle = "rgba(20,10,6," + (0.5 * (1 - vf)).toFixed(3) + ")"; ctx.fillRect(cx - R, yy - bh, R * 2, bh + 1.5); }
      ctx.restore();
    }
    // a soft rotating throwing-mark so the spin is visible on the wet clay
    if (mode === "throwing") {
      var u = Math.sin(spin);
      if (Math.cos(spin) > 0) {
        ctx.strokeStyle = "rgba(60,32,18,0.18)"; ctx.lineWidth = 2.2;
        ctx.beginPath();
        for (var j = 0; j < ROWS; j += 2) { var rx = cx + u * rad[j] * 0.92, ry2 = rowY(j); j === 0 ? ctx.moveTo(rx, ry2) : ctx.lineTo(rx, ry2); }
        ctx.stroke();
      }
    }
    // speckled glaze flecks (seeded so they don't flicker)
    if (mode === "painting" && glaze && glaze.speckle) {
      for (var si = 0; si < speckles.length; si++) {
        var sp = speckles[si], rr = Math.round(sp[0] * (ROWS - 1));
        ctx.fillStyle = "rgba(46,50,38," + (0.10 + 0.12 * sp[2]).toFixed(3) + ")";
        ctx.beginPath(); ctx.arc(cx + sp[1] * rad[rr] * 0.92, rowY(rr), 1.0 + sp[2] * 1.2, 0, 6.283); ctx.fill();
      }
    }
    // hand-painted decoration — marks anchored to the spinning surface (wrap-around)
    if (mode === "painting" && marks.length) drawPaint();
    // incandescent glow while firing (additive, clipped to the vessel)
    if (heat > 0.001) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      var ec = incand(heat), ecs = (ec[0] | 0) + "," + (ec[1] | 0) + "," + (ec[2] | 0);
      var eg = ctx.createLinearGradient(0, rimY, 0, baseY);
      eg.addColorStop(0, "rgba(" + ecs + "," + (0.5 * heat).toFixed(3) + ")");
      eg.addColorStop(0.5, "rgba(" + ecs + "," + (0.92 * heat).toFixed(3) + ")");
      eg.addColorStop(1, "rgba(" + ecs + "," + (0.66 * heat).toFixed(3) + ")");
      ctx.fillStyle = eg;
      ctx.fillRect(cx - MAXR * 1.3, rimY - 6, MAXR * 2.6, potH + 12);
      ctx.restore();
    }
    ctx.restore();   // end vessel-silhouette clip
    // the rim opening (hollow vessel) at the top — interior tinted by the material
    var Rt = rad[ROWS - 1], ry = Rt * ELLIPSE_K;
    var sd = curMat.shadow, bs = curMat.base;
    function rgbS(c, f) { return "rgb(" + ((c[0] * f) | 0) + "," + ((c[1] * f) | 0) + "," + ((c[2] * f) | 0) + ")"; }
    var ig = ctx.createRadialGradient(cx, rimY - ry * 0.3, ry * 0.15, cx, rimY, Rt);
    ig.addColorStop(0, rgbS(sd, 0.45)); ig.addColorStop(0.55, rgbS(sd, 0.95));
    ig.addColorStop(1, "rgb(" + (((sd[0] + bs[0]) / 2) | 0) + "," + (((sd[1] + bs[1]) / 2) | 0) + "," + (((sd[2] + bs[2]) / 2) | 0) + ")");
    ctx.fillStyle = ig;
    ctx.beginPath(); ctx.ellipse(cx, rimY, Rt, ry, 0, 0, 6.283); ctx.fill();
    if (heat > 0.001) {  // the opening glows when hot
      ctx.save(); ctx.globalCompositeOperation = "lighter";
      var rc = incand(heat);
      ctx.fillStyle = "rgba(" + (rc[0] | 0) + "," + (rc[1] | 0) + "," + (rc[2] | 0) + "," + (0.7 * heat).toFixed(3) + ")";
      ctx.beginPath(); ctx.ellipse(cx, rimY, Rt, ry, 0, 0, 6.283); ctx.fill(); ctx.restore();
    }
    // lit lip on the upper-left of the opening (whiter as the glaze gets glossier)
    var gl = curMat.gloss || 0;
    ctx.strokeStyle = "rgba(" + ((255) | 0) + "," + ((214 + 41 * gl) | 0) + "," + ((168 + 87 * gl) | 0) + ",0.5)"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(cx, rimY, Rt, ry, 0, Math.PI * 0.9, Math.PI * 1.85); ctx.stroke();
    ctx.strokeStyle = "rgba(40,20,10,0.4)"; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.ellipse(cx, rimY, Rt, ry, 0, Math.PI * 1.9, Math.PI * 0.85); ctx.stroke();
  }

  // soft kiln light bleeding into the scene while firing
  function drawKilnGlow() {
    if (heat <= 0.001) return;
    ctx.save(); ctx.globalCompositeOperation = "lighter";
    var gy = (rimY + baseY) / 2, ec = incand(heat), ecs = (ec[0] | 0) + "," + (ec[1] | 0) + "," + (ec[2] | 0);
    var rg = ctx.createRadialGradient(cx, gy, 0, cx, gy, MAXR * 3.4);
    rg.addColorStop(0, "rgba(" + ecs + "," + (0.42 * heat).toFixed(3) + ")");
    rg.addColorStop(1, "rgba(" + ecs + ",0)");
    ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H); ctx.restore();
  }

  // the glaze name, revealed beneath the finished piece
  function drawCaption() {
    if (captionT <= 0) return;
    ctx.save();
    ctx.globalAlpha = Math.min(1, captionT / 0.6);
    ctx.fillStyle = "rgba(244,228,212,0.94)";
    ctx.font = "600 " + Math.round(Math.min(W, H) * 0.03) + "px Geist, system-ui, sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.shadowColor = "rgba(0,0,0,0.6)"; ctx.shadowBlur = 12;
    ctx.fillText(captionText, cx, baseY + Math.min(W, H) * 0.12);
    ctx.restore();
  }

  // ---- loop ---------------------------------------------------------------
  var lastTs = null;
  function frame(ts) {
    var dt = lastTs !== null ? Math.min((ts - lastTs) / 1000, 0.05) : 0.016;
    lastTs = ts;

    // firing state machine: heat up -> soak -> cool, glaze locks in as it cools
    if (mode === "firing") {
      fireT += dt;
      if (fireT < HEAT_UP) { heat = fireT / HEAT_UP; matMix = 0; }
      else if (fireT < HEAT_UP + SOAK) { heat = 1; matMix = 0.12 * ((fireT - HEAT_UP) / SOAK); }
      else if (fireT < HEAT_UP + SOAK + COOL) { var c = (fireT - HEAT_UP - SOAK) / COOL; heat = 1 - c; matMix = 0.12 + 0.88 * c; }
      else { heat = 0; matMix = 1; captionText = "— " + glaze.name + " —"; captionT = 2.8; chime(); enterPainting(); }
    }
    if (captionT > 0) captionT = Math.max(0, captionT - dt);

    // wheel slows once you stop throwing; turns gently while painting (for banding)
    var spTarget = (mode === "throwing") ? SPIN_SPEED : (mode === "painting" ? SPIN_SPEED * 0.34 : SPIN_SPEED * 0.16);
    spinSpeed += (spTarget - spinSpeed) * Math.min(1, dt * 1.6);
    spin += dt * spinSpeed;

    // current material (wet clay, or clay->glaze crossfade while cooling)
    curMat = (mode === "throwing") ? CLAY_MAT : lerpMat(CLAY_MAT, glaze, matMix);
    buildShade(curMat);

    // ease the clay toward its target + a light smoothing so walls stay graceful
    var moved = 0;
    for (var i = 0; i < ROWS; i++) {
      var nr = rad[i] + (tgt[i] - rad[i]) * Math.min(1, dt * 12);
      moved += Math.abs(nr - rad[i]);
      rad[i] = nr;
    }
    for (var p = 0; p < 2; p++) {
      for (var j = 1; j < ROWS - 1; j++) rad[j] = rad[j] * 0.86 + (rad[j - 1] + rad[j + 1]) * 0.07;
    }

    // shaping sound follows how fast the wall is moving (only while throwing)
    if (shapeGain) shapeGain.gain.setTargetAtTime((down && mode === "throwing") ? Math.min(0.09, moved * 0.02) : 0, actx.currentTime, 0.08);

    drawBackground();
    drawWheel();
    drawKilnGlow();
    drawClay();
    drawCaption();
    requestAnimationFrame(frame);
  }

  resize();
  window.addEventListener("resize", resize);
  requestAnimationFrame(frame);
  setTimeout(function () { if (hintEl) hintEl.classList.add("is-hidden"); }, 9000);
})();
