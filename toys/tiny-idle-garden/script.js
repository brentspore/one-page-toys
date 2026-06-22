/* Tiny Idle Garden
 * A full-viewport living scene: real-time day/night sky, drifting clouds,
 * parallax hills, swaying procedural grass + flowers that grow and bloom over
 * real time, fireflies, and gentle rain. An idle "dew" economy that keeps
 * accruing (and keeps your plants growing) while the tab is closed.
 */
(function () {
  "use strict";

  var cv = document.getElementById("garden");
  var ctx = cv.getContext("2d");
  var DPR = 1, W = 0, H = 0, groundY = 0;

  // ---- tunables --------------------------------------------------------
  var CYCLE = 210;                 // seconds for a full day/night loop
  var GROWTH_BASE = 1 / 78;        // progress per second to fully bloom (base)
  var WATER_MULT = 2.6, WATER_SECS = 8;
  var DEW_BASE = 0.5, DEW_PER_BLOOM = 0.85;
  var PLOT_COUNT = 9;
  var RAIN_COOLDOWN = 24;          // seconds
  var OFFLINE_CAP = 8 * 3600;      // seconds of offline progress we honor
  var KEY = "opt-tiny-garden-v1";

  function plantCost(n) { return Math.ceil(8 * Math.pow(1.28, n)); }
  function soilCost(lvl) { return Math.ceil(40 * Math.pow(1.85, lvl)); }
  function growthRate(S) { return GROWTH_BASE * (1 + 0.55 * S.soil); }

  // ---- helpers ---------------------------------------------------------
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smooth(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function mix(c1, c2, t) {
    return [Math.round(lerp(c1[0], c2[0], t)), Math.round(lerp(c1[1], c2[1], t)), Math.round(lerp(c1[2], c2[2], t))];
  }
  function rgb(c, a) { return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + (a == null ? 1 : a) + ")"; }

  // ---- day / night -----------------------------------------------------
  // phase 0=dawn, .25=noon, .5=dusk, .75=midnight (loops). Real-clock based.
  function phaseNow() { return ((Date.now() / 1000) % CYCLE) / CYCLE; }

  var SKY = [
    { p: 0.00, top: [255, 168, 120], bot: [255, 214, 170] }, // dawn
    { p: 0.16, top: [108, 176, 224], bot: [201, 233, 246] }, // morning
    { p: 0.30, top: [96, 166, 222], bot: [196, 230, 245] },  // day
    { p: 0.46, top: [240, 146, 96], bot: [248, 196, 150] },  // golden
    { p: 0.53, top: [193, 96, 120], bot: [120, 78, 132] },   // dusk
    { p: 0.64, top: [40, 46, 96], bot: [70, 60, 116] },      // twilight
    { p: 0.78, top: [12, 18, 50], bot: [26, 30, 70] },       // night
    { p: 0.92, top: [20, 26, 64], bot: [44, 44, 96] }        // pre-dawn
  ];
  function skyAt(p) {
    var n = SKY.length, i;
    for (i = 0; i < n; i++) {
      var a = SKY[i], b = SKY[(i + 1) % n];
      var pa = a.p, pb = b.p; if (pb <= pa) pb += 1;
      var pp = p < pa ? p + 1 : p;
      if (pp >= pa && pp <= pb) {
        var t = smooth((pp - pa) / (pb - pa));
        return { top: mix(a.top, b.top, t), bot: mix(a.bot, b.bot, t) };
      }
    }
    return { top: SKY[0].top, bot: SKY[0].bot };
  }
  function lightAt(p) { return 0.5 + 0.5 * Math.cos((p - 0.25) * 2 * Math.PI); } // 1 noon, 0 midnight

  // ---- state / persistence --------------------------------------------
  function freshPlots() {
    var arr = [], i;
    for (i = 0; i < PLOT_COUNT; i++) {
      var t = PLOT_COUNT === 1 ? 0.5 : i / (PLOT_COUNT - 1);
      arr.push({
        fx: lerp(0.1, 0.9, t) + rnd(-0.03, 0.03),
        depth: Math.random(),       // 0 far .. 1 near
        planted: false, progress: 0, wateredUntil: 0,
        hue: 0, petals: 5, maxH: 0, lean: 0, swayPhase: 0, swaySpeed: 1, kind: 0, pop: 0
      });
    }
    arr.sort(function (a, b) { return a.depth - b.depth; });
    return arr;
  }
  function fresh() {
    return { dew: 15, soil: 0, plots: freshPlots(), lastSeen: Date.now(), rainAt: 0 };
  }
  function load() {
    try {
      var raw = localStorage.getItem(KEY); if (!raw) return null;
      var s = JSON.parse(raw);
      if (!s || !Array.isArray(s.plots)) return null;
      // tolerate older/short plot arrays
      if (s.plots.length !== PLOT_COUNT) { var f = fresh(); s.plots = f.plots; }
      s.dew = +s.dew || 0; s.soil = +s.soil || 0; s.rainAt = +s.rainAt || 0;
      return s;
    } catch (e) { return null; }
  }
  function save() {
    try { S.lastSeen = Date.now(); localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {}
  }

  var S = load() || fresh();

  // assign visual props to plants restored from storage (kept compact in save)
  function ensureVisuals(pl) {
    if (pl.planted && !pl.maxH) randomizeSpecies(pl);
  }
  function randomizeSpecies(pl) {
    var palette = [350, 14, 32, 48, 285, 320, 210, 265, 8];
    pl.hue = palette[(Math.random() * palette.length) | 0] + rnd(-8, 8);
    pl.petals = 5 + ((Math.random() * 4) | 0);        // 5..8
    pl.maxH = rnd(0.62, 1.0);                           // fraction of stem unit
    pl.lean = rnd(-0.10, 0.10);
    pl.swayPhase = rnd(0, Math.PI * 2);
    pl.swaySpeed = rnd(0.7, 1.35);
    pl.kind = (Math.random() * 3) | 0;                 // flower shape variant
  }

  // ---- offline catch-up ------------------------------------------------
  var offline = null;
  (function catchUp() {
    S.plots.forEach(ensureVisuals);
    var away = clamp((Date.now() - (S.lastSeen || Date.now())) / 1000, 0, OFFLINE_CAP);
    if (away < 5) return;
    var bloomBefore = bloomCount();
    var gr = growthRate(S);
    S.plots.forEach(function (pl) { if (pl.planted) pl.progress = clamp(pl.progress + gr * away, 0, 1); });
    var rate = DEW_BASE + DEW_PER_BLOOM * bloomCount();
    var gained = rate * away;
    S.dew += gained;
    var newBlooms = bloomCount() - bloomBefore;
    if (away > 45 && (gained > 1 || newBlooms > 0)) offline = { secs: away, dew: gained, blooms: newBlooms };
  })();

  function bloomCount() {
    var c = 0; S.plots.forEach(function (p) { if (p.planted && p.progress >= 0.9) c++; }); return c;
  }
  function plantedCount() {
    var c = 0; S.plots.forEach(function (p) { if (p.planted) c++; }); return c;
  }

  // ---- scene props (clouds, stars, grass, particles) -------------------
  var clouds = [], stars = [], blades = [], motes = [], splashes = [], pops = [], flutter = [];
  function buildScene() {
    clouds = [];
    var nc = Math.max(3, Math.round(W / 420));
    for (var i = 0; i < nc; i++) {
      clouds.push({ x: Math.random() * W, y: rnd(H * 0.08, H * 0.42), s: rnd(0.7, 1.7), v: rnd(4, 11), puffs: 3 + ((Math.random() * 3) | 0) });
    }
    stars = [];
    for (i = 0; i < 150; i++) {
      stars.push({ x: Math.random() * W, y: Math.random() * groundY * 0.92, r: rnd(0.5, 1.7), tw: rnd(0, Math.PI * 2), ts: rnd(0.7, 2.2) });
    }
    blades = [];
    var step = Math.max(5, W / 240), x = -10;
    while (x < W + 10) {
      var d = Math.random();
      blades.push({ x: x + rnd(-2, 2), h: rnd(10, 26) * (0.7 + d * 0.7), d: d, ph: rnd(0, Math.PI * 2), hue: rnd(-12, 12) });
      x += step * rnd(0.6, 1.2);
    }
    blades.sort(function (a, b) { return a.d - b.d; });
    motes = [];
    for (i = 0; i < 34; i++) {
      motes.push({ x: Math.random() * W, y: rnd(H * 0.2, groundY), vx: rnd(-7, 7), vy: rnd(-10, -2), r: rnd(1, 2.6), ph: rnd(0, Math.PI * 2), sp: rnd(1.2, 3) });
    }
  }

  // ---- sizing ----------------------------------------------------------
  function resize() {
    DPR = Math.min(2, window.devicePixelRatio || 1);
    W = window.innerWidth; H = window.innerHeight;
    groundY = Math.round(H * 0.70);
    cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
    cv.style.width = W + "px"; cv.style.height = H + "px";
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    buildScene();
  }
  window.addEventListener("resize", resize);

  // ---- geometry: a plant's base on screen ------------------------------
  function plotBase(pl) {
    var x = pl.fx * W;
    var y = groundY + pl.depth * (H * 0.17);
    var scale = (0.78 + pl.depth * 0.5) * (Math.min(W, H) / 760);
    return { x: x, y: y, scale: scale };
  }

  // ====================================================================
  //  DRAW
  // ====================================================================
  var wind = 0;
  function draw(now) {
    var p = phaseNow();
    var sky = skyAt(p);
    var light = lightAt(p);
    var dark = 1 - light;

    // --- sky gradient ---
    var g = ctx.createLinearGradient(0, 0, 0, groundY + 40);
    g.addColorStop(0, rgb(sky.top));
    g.addColorStop(1, rgb(sky.bot));
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, groundY + 60);

    // --- stars ---
    if (dark > 0.05) {
      for (var i = 0; i < stars.length; i++) {
        var st = stars[i];
        var tw = 0.55 + 0.45 * Math.sin(now * 0.001 * st.ts + st.tw);
        ctx.globalAlpha = dark * tw * 0.95;
        ctx.fillStyle = "#eaf2ff";
        ctx.beginPath(); ctx.arc(st.x, st.y, st.r, 0, 6.2832); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // --- sun / moon ---
    drawCelestial(p, light);

    // --- clouds ---
    drawClouds(now, light, sky);

    // --- hills (parallax) ---
    var farHill = mix([120, 150, 120], [26, 40, 70], dark);
    var nearHill = mix([86, 138, 86], [18, 46, 40], dark);
    drawHill(groundY - H * 0.10, H * 0.05, 0.9, farHill, 0.6);
    drawHill(groundY - H * 0.02, H * 0.07, 1.5, nearHill, 2.3);

    // --- ground ---
    var gg = ctx.createLinearGradient(0, groundY - 10, 0, H);
    gg.addColorStop(0, rgb(mix([120, 178, 96], [22, 54, 40], dark)));
    gg.addColorStop(1, rgb(mix([70, 124, 58], [12, 34, 26], dark)));
    ctx.fillStyle = gg; ctx.fillRect(0, groundY - 6, W, H - groundY + 6);

    // --- wind (slow global) ---
    wind = 0.45 + 0.55 * Math.sin(now * 0.00035) + 0.25 * Math.sin(now * 0.0011 + 1.7);

    // --- empty-plot soil markers + plants (far to near) ---
    for (i = 0; i < S.plots.length; i++) {
      var pl = S.plots[i], b = plotBase(pl);
      if (!pl.planted) drawSoil(b, dark);
      else drawPlant(pl, b, now, wind, dark);
    }

    // --- grass blades (in front of plant bases) ---
    drawGrass(now, wind, dark);

    // --- water splashes ---
    for (i = splashes.length - 1; i >= 0; i--) {
      var sp = splashes[i], age = (now - sp.t) / 700;
      if (age >= 1) { splashes.splice(i, 1); continue; }
      drawSplash(sp.x, sp.y, age);
    }
    // --- plant pops ---
    for (i = pops.length - 1; i >= 0; i--) {
      var po = pops[i], pa = (now - po.t) / 600;
      if (pa >= 1) { pops.splice(i, 1); continue; }
      drawPop(po.x, po.y, pa);
    }

    // --- airborne particles: pollen (day) / fireflies (night) ---
    drawMotes(now, light, dark);

    // --- butterflies near blooms (day only) ---
    drawFlutter(now, light);

    // --- rain ---
    var raining = (Date.now() / 1000) < (S.rainAt + 7);
    if (raining) drawRain(now, dark);

    // --- subtle vignette at night for mood ---
    if (dark > 0.2) {
      var vg = ctx.createRadialGradient(W / 2, H * 0.5, Math.min(W, H) * 0.2, W / 2, H * 0.5, Math.max(W, H) * 0.7);
      vg.addColorStop(0, "rgba(0,0,0,0)");
      vg.addColorStop(1, "rgba(4,8,20," + (dark * 0.38).toFixed(3) + ")");
      ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
    }
  }

  function drawCelestial(p, light) {
    var up, x, alt, isSun;
    if (p < 0.5) { isSun = true; up = p / 0.5; } else { isSun = false; up = (p - 0.5) / 0.5; }
    alt = Math.sin(up * Math.PI);                 // 0 at horizon, 1 at top
    x = lerp(0.08, 0.92, up) * W;
    var y = (groundY - 30) - alt * (groundY * 0.74);
    var r = Math.min(W, H) * (isSun ? 0.052 : 0.04);
    ctx.save();
    if (isSun) {
      var halo = ctx.createRadialGradient(x, y, 0, x, y, r * 6);
      halo.addColorStop(0, "rgba(255,238,190,0.5)");
      halo.addColorStop(0.5, "rgba(255,214,150,0.12)");
      halo.addColorStop(1, "rgba(255,214,150,0)");
      ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(x, y, r * 6, 0, 6.2832); ctx.fill();
      var sg = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, 0, x, y, r);
      sg.addColorStop(0, "#fff7df"); sg.addColorStop(0.6, "#ffe49a"); sg.addColorStop(1, "#ffca5e");
      ctx.fillStyle = sg;
    } else {
      var dark2 = 1 - light;
      ctx.globalAlpha = clamp(dark2 * 1.4, 0, 1);
      var mh = ctx.createRadialGradient(x, y, 0, x, y, r * 5);
      mh.addColorStop(0, "rgba(220,232,255,0.32)"); mh.addColorStop(1, "rgba(220,232,255,0)");
      ctx.fillStyle = mh; ctx.beginPath(); ctx.arc(x, y, r * 5, 0, 6.2832); ctx.fill();
      var mg = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, 0, x, y, r);
      mg.addColorStop(0, "#fdfdff"); mg.addColorStop(1, "#c7d2ea");
      ctx.fillStyle = mg;
    }
    ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill();
    if (!isSun) {
      ctx.fillStyle = "rgba(170,184,214,0.5)";
      ctx.beginPath(); ctx.arc(x + r * 0.3, y - r * 0.2, r * 0.18, 0, 6.2832); ctx.fill();
      ctx.beginPath(); ctx.arc(x - r * 0.25, y + r * 0.28, r * 0.13, 0, 6.2832); ctx.fill();
    }
    ctx.restore();
  }

  function drawClouds(now, light, sky) {
    var col = mix([255, 255, 255], sky.bot, 0.16);
    var a = 0.26 + 0.5 * light;
    for (var i = 0; i < clouds.length; i++) {
      var c = clouds[i];
      c.x += c.v * 0.016; if (c.x - 220 * c.s > W) c.x = -220 * c.s;
      ctx.save(); ctx.globalAlpha = a;
      var bw = 52 * c.s;
      // soft fluffy puffs via feathered radial gradients that overlap
      for (var k = 0; k < c.puffs; k++) {
        var px = c.x + k * bw * 0.66, py = c.y + Math.sin(k * 1.5 + c.s) * 7 * c.s;
        var rad = bw * (0.95 - k * 0.05);
        var grd = ctx.createRadialGradient(px, py - rad * 0.15, 0, px, py, rad);
        grd.addColorStop(0, rgb(col, 0.95));
        grd.addColorStop(0.55, rgb(col, 0.6));
        grd.addColorStop(1, rgb(col, 0));
        ctx.fillStyle = grd;
        ctx.beginPath(); ctx.arc(px, py, rad, 0, 6.2832); ctx.fill();
      }
      ctx.restore();
    }
  }

  function drawHill(baseY, amp, freq, col, off) {
    ctx.fillStyle = rgb(col);
    ctx.beginPath(); ctx.moveTo(0, H);
    for (var x = 0; x <= W; x += 14) {
      var y = baseY + Math.sin((x / W) * Math.PI * 2 * freq + off) * amp + Math.sin(x * 0.01) * amp * 0.3;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(W, H); ctx.closePath(); ctx.fill();
  }

  function drawSoil(b, dark) {
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = rgb(mix([92, 64, 42], [40, 30, 24], dark));
    ctx.beginPath(); ctx.ellipse(b.x, b.y, 11 * b.scale, 4.5 * b.scale, 0, 0, 6.2832); ctx.fill();
    ctx.globalAlpha = 0.4; ctx.strokeStyle = "rgba(255,255,255,0.5)";
    ctx.lineWidth = 1.2; var s = 4 * b.scale;
    ctx.beginPath(); ctx.moveTo(b.x - s, b.y - 1); ctx.lineTo(b.x + s, b.y - 1);
    ctx.moveTo(b.x, b.y - 1 - s * 0.8); ctx.lineTo(b.x, b.y - 1 + s * 0.8); ctx.stroke();
    ctx.restore();
  }

  function drawPlant(pl, b, now, wind, dark) {
    var p = pl.progress;
    var watered = Date.now() < pl.wateredUntil;
    var unit = 150 * b.scale;
    var h = smooth(Math.min(p / 0.92, 1)) * pl.maxH * unit;
    var sway = Math.sin(now * 0.0011 * pl.swaySpeed + pl.swayPhase) * wind * (4 + h * 0.10) * (0.4 + 0.6 * p);
    var bx = b.x, by = b.y;
    var tx = bx + sway + pl.lean * h, ty = by - h;

    var stemCol = mix([74, 150, 70], [26, 70, 48], dark);
    if (p < 0.14) { // sprout
      var s = (p / 0.14);
      drawLeaf(bx - 3 * b.scale, by - 2, -1.0, 7 * b.scale * s, stemCol, dark);
      drawLeaf(bx + 3 * b.scale, by - 2, 1.0, 7 * b.scale * s, stemCol, dark);
      return;
    }

    // stem (quadratic)
    var cpx = bx + sway * 0.45, cpy = by - h * 0.5;
    ctx.lineCap = "round";
    ctx.strokeStyle = rgb(stemCol);
    ctx.lineWidth = Math.max(1.4, 3.4 * b.scale * (0.5 + 0.5 * p));
    ctx.beginPath(); ctx.moveTo(bx, by); ctx.quadraticCurveTo(cpx, cpy, tx, ty); ctx.stroke();

    // leaves along stem
    if (h > 26 * b.scale) {
      var lp1 = bezPt(bx, by, cpx, cpy, tx, ty, 0.42);
      var lp2 = bezPt(bx, by, cpx, cpy, tx, ty, 0.66);
      drawLeaf(lp1.x, lp1.y, -1, (10 + 8 * p) * b.scale, stemCol, dark);
      if (h > 52 * b.scale) drawLeaf(lp2.x, lp2.y, 1, (9 + 7 * p) * b.scale, stemCol, dark);
    }

    if (p >= 0.7 && p < 0.9) { // bud
      var bs = smooth((p - 0.7) / 0.2);
      ctx.fillStyle = rgb(mix([110, 170, 96], [60, 96, 70], dark));
      ctx.beginPath(); ctx.ellipse(tx, ty, 4.5 * b.scale * (0.6 + bs), 7 * b.scale * (0.6 + bs), sway * 0.02, 0, 6.2832); ctx.fill();
      var hint = hsl(pl.hue, 70, 60);
      ctx.fillStyle = hint; ctx.globalAlpha = bs * 0.8;
      ctx.beginPath(); ctx.ellipse(tx, ty - 3 * b.scale, 3 * b.scale * bs, 4 * b.scale * bs, 0, 0, 6.2832); ctx.fill();
      ctx.globalAlpha = 1;
    }

    if (p >= 0.9) { // bloom
      var bloom = smooth((p - 0.9) / 0.1);
      drawFlower(tx, ty, pl, b.scale * bloom, now, dark, watered);
    }

    if (watered) {
      // a little sparkle ring while boosted
      ctx.globalAlpha = 0.25 * (0.5 + 0.5 * Math.sin(now * 0.01));
      ctx.strokeStyle = "rgba(150,220,255,0.9)"; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(bx, by - 2, 9 * b.scale, 0, 6.2832); ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  function drawLeaf(x, y, dir, len, col, dark) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(dir * 0.7);
    ctx.fillStyle = rgb(col);
    ctx.beginPath(); ctx.ellipse(dir * len * 0.5, 0, len * 0.6, len * 0.26, 0, 0, 6.2832); ctx.fill();
    ctx.restore();
  }

  function drawFlower(x, y, pl, scale, now, dark, watered) {
    if (scale <= 0.01) return;
    var pr = (12 + pl.maxH * 8) * scale;
    var bob = Math.sin(now * 0.002 + pl.swayPhase) * 1.5 * scale;
    y += bob;
    var rot = now * 0.00012 + pl.swayPhase;
    ctx.save();
    if (dark > 0.25) { ctx.shadowColor = hsl(pl.hue, 85, 62); ctx.shadowBlur = 14 * dark; }
    for (var i = 0; i < pl.petals; i++) {
      var ang = rot + (i / pl.petals) * Math.PI * 2;
      var ox = x + Math.cos(ang) * pr * 0.62, oy = y + Math.sin(ang) * pr * 0.62;
      var grd = ctx.createRadialGradient(ox, oy, 0, ox, oy, pr * 0.7);
      grd.addColorStop(0, hsl(pl.hue, 85, 72 - dark * 14));
      grd.addColorStop(1, hsl(pl.hue, 78, 56 - dark * 16));
      ctx.fillStyle = grd;
      ctx.save(); ctx.translate(ox, oy); ctx.rotate(ang);
      var pw = pl.kind === 0 ? pr * 0.5 : pr * 0.42;
      var ph = pl.kind === 2 ? pr * 0.78 : pr * 0.62;
      ctx.beginPath(); ctx.ellipse(0, 0, ph, pw, 0, 0, 6.2832); ctx.fill();
      ctx.restore();
    }
    ctx.shadowBlur = 0;
    // center
    var cg = ctx.createRadialGradient(x - pr * 0.1, y - pr * 0.1, 0, x, y, pr * 0.5);
    cg.addColorStop(0, "#fff1b8"); cg.addColorStop(1, hsl((pl.hue + 30) % 360, 80, 46));
    ctx.fillStyle = cg;
    ctx.beginPath(); ctx.arc(x, y, pr * 0.34, 0, 6.2832); ctx.fill();
    ctx.restore();
  }

  function drawGrass(now, wind, dark) {
    var lit = 1 - dark;
    for (var i = 0; i < blades.length; i++) {
      var bl = blades[i];
      var by = groundY + bl.d * (H * 0.17) + 6;
      var h = bl.h * (0.8 + bl.d * 0.5);
      var sway = Math.sin(now * 0.0013 * (0.8 + bl.d) + bl.ph) * wind * (2 + bl.d * 6);
      var col = mix([88 + bl.hue, 150 + bl.hue * 0.4, 70], [18, 50, 34], dark);
      ctx.strokeStyle = rgb(col, 0.9);
      ctx.lineWidth = 1 + bl.d * 1.4; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(bl.x, by);
      ctx.quadraticCurveTo(bl.x + sway * 0.5, by - h * 0.6, bl.x + sway, by - h);
      ctx.stroke();
    }
  }

  function drawMotes(now, light, dark) {
    for (var i = 0; i < motes.length; i++) {
      var m = motes[i];
      m.x += m.vx * 0.016 + Math.sin(now * 0.0006 + m.ph) * 0.2;
      m.y += m.vy * 0.016;
      if (m.y < H * 0.12) { m.y = groundY - 4; m.x = Math.random() * W; }
      if (m.x < -10) m.x = W + 10; if (m.x > W + 10) m.x = -10;
      var blink = 0.5 + 0.5 * Math.sin(now * 0.004 * m.sp + m.ph);
      if (light > 0.4) { // pollen
        ctx.globalAlpha = (0.10 + 0.18 * blink) * light;
        ctx.fillStyle = "#fff6cf";
        ctx.beginPath(); ctx.arc(m.x, m.y, m.r, 0, 6.2832); ctx.fill();
      } else { // firefly
        var a = dark * blink;
        ctx.globalAlpha = a * 0.9;
        ctx.shadowColor = "#d8ff88"; ctx.shadowBlur = 10 * dark;
        ctx.fillStyle = "#eaffa0";
        ctx.beginPath(); ctx.arc(m.x, m.y, m.r * 1.1, 0, 6.2832); ctx.fill();
        ctx.shadowBlur = 0;
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawSplash(x, y, age) {
    var r = age * 22;
    ctx.globalAlpha = (1 - age) * 0.7;
    ctx.strokeStyle = "rgba(150,220,255,0.9)"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.stroke();
    for (var i = 0; i < 5; i++) {
      var a = (i / 5) * 6.2832, d = age * 16;
      ctx.fillStyle = "rgba(180,230,255,0.9)";
      ctx.beginPath(); ctx.arc(x + Math.cos(a) * d, y + Math.sin(a) * d - age * 10, 2 * (1 - age), 0, 6.2832); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawPop(x, y, age) {
    ctx.globalAlpha = (1 - age) * 0.8;
    for (var i = 0; i < 6; i++) {
      var a = (i / 6) * 6.2832, d = age * 20;
      ctx.fillStyle = i % 2 ? "rgba(150,240,170,0.9)" : "rgba(120,200,120,0.9)";
      ctx.beginPath(); ctx.arc(x + Math.cos(a) * d, y + Math.sin(a) * d - age * 8, 2.4 * (1 - age), 0, 6.2832); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  function drawFlutter(now, light) {
    if (light < 0.45) return;
    var blooms = [];
    for (var i = 0; i < S.plots.length; i++) {
      var pl = S.plots[i]; if (pl.planted && pl.progress >= 0.92) blooms.push(pl);
    }
    var n = Math.min(blooms.length, 2);
    while (flutter.length < n) flutter.push({ t: rnd(0, 1000), hue: rnd(20, 60), wing: 0 });
    while (flutter.length > n) flutter.pop();
    for (i = 0; i < flutter.length; i++) {
      var f = flutter[i];
      var target = blooms[i % blooms.length]; if (!target) continue;
      var b = plotBase(target);
      var ph = now * 0.001 + i * 2.1;
      var x = b.x + Math.sin(ph * 0.8) * 60 + Math.cos(ph * 1.7) * 22;
      var y = (b.y - 120 * b.scale) + Math.sin(ph * 1.3) * 26;
      var flap = Math.abs(Math.sin(now * 0.02 + i));
      ctx.save(); ctx.translate(x, y);
      ctx.fillStyle = hsl(f.hue, 80, 66);
      ctx.beginPath(); ctx.ellipse(-3 - flap * 2, 0, 4 + flap * 3, 6, 0.5, 0, 6.2832); ctx.fill();
      ctx.beginPath(); ctx.ellipse(3 + flap * 2, 0, 4 + flap * 3, 6, -0.5, 0, 6.2832); ctx.fill();
      ctx.fillStyle = "rgba(40,30,20,0.8)";
      ctx.beginPath(); ctx.ellipse(0, 0, 1.4, 5, 0, 0, 6.2832); ctx.fill();
      ctx.restore();
    }
  }

  function drawRain(now, dark) {
    ctx.strokeStyle = "rgba(180,210,255,0.5)"; ctx.lineWidth = 1.4;
    var n = Math.round(W / 9);
    for (var i = 0; i < n; i++) {
      var seed = i * 73.13;
      var x = (seed * 137 + now * 0.5) % W;
      var y = ((seed * 311 + now * 1.4) % (groundY + 40));
      ctx.globalAlpha = 0.5;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 2, y + 12); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // small math helpers
  function bezPt(x0, y0, cx, cy, x1, y1, t) {
    var u = 1 - t;
    return { x: u * u * x0 + 2 * u * t * cx + t * t * x1, y: u * u * y0 + 2 * u * t * cy + t * t * y1 };
  }
  function hsl(h, s, l) { return "hsl(" + ((h % 360 + 360) % 360).toFixed(0) + "," + s + "%," + l + "%)"; }

  // ====================================================================
  //  GAME LOOP
  // ====================================================================
  var last = performance.now(), hudT = 0;
  function frame(now) {
    var dt = Math.min(0.05, (now - last) / 1000); last = now;

    // grow plants
    var gr = growthRate(S);
    for (var i = 0; i < S.plots.length; i++) {
      var pl = S.plots[i];
      if (pl.planted && pl.progress < 1) {
        var rate = gr * (Date.now() < pl.wateredUntil ? WATER_MULT : 1);
        pl.progress = clamp(pl.progress + rate * dt, 0, 1);
      }
    }
    // accrue dew
    var dewRate = DEW_BASE + DEW_PER_BLOOM * bloomCount();
    S.dew += dewRate * dt;

    draw(now);

    // HUD throttle
    hudT += dt;
    if (hudT > 0.2) { hudT = 0; updateHUD(dewRate); }

    requestAnimationFrame(frame);
  }

  // ====================================================================
  //  HUD + INTERACTION
  // ====================================================================
  var dewAmt = document.getElementById("dewAmt");
  var dewRateEl = document.getElementById("dewRate");
  var plantBtn = document.getElementById("plantBtn");
  var soilBtn = document.getElementById("soilBtn");
  var rainBtn = document.getElementById("rainBtn");
  var plantCostEl = document.getElementById("plantCost");
  var soilCostEl = document.getElementById("soilCost");
  var plantLabel = document.getElementById("plantLabel");
  var rainLabel = document.getElementById("rainLabel");
  var hintEl = document.getElementById("hint");
  var toastEl = document.getElementById("toast");

  function updateHUD(dewRate) {
    dewAmt.textContent = Math.floor(S.dew).toLocaleString();
    dewRateEl.textContent = "+" + (dewRate * 60).toFixed(0) + "/min";
    var full = plantedCount() >= PLOT_COUNT;
    var pc = plantCost(plantedCount());
    plantCostEl.textContent = pc;
    plantCostEl.style.display = full ? "none" : "";
    plantBtn.disabled = full || S.dew < pc;
    plantLabel.textContent = full ? "Garden full" : "Plant";
    var sc = soilCost(S.soil);
    soilCostEl.textContent = sc;
    soilBtn.disabled = S.dew < sc;
    var cd = (S.rainAt + RAIN_COOLDOWN) - Date.now() / 1000;
    rainBtn.disabled = cd > 0;
    rainLabel.textContent = cd > 0 ? Math.ceil(cd) + "s" : "Rain";
  }

  function hideHint() { if (hintEl) hintEl.classList.add("is-hidden"); }
  var toastTO = null;
  function toast(html, ms) {
    toastEl.innerHTML = html; toastEl.classList.add("is-show");
    if (toastTO) clearTimeout(toastTO);
    toastTO = setTimeout(function () { toastEl.classList.remove("is-show"); }, ms || 4200);
  }

  function track(name, params) {
    try { if (typeof window.gtag === "function") window.gtag("event", name, params || {}); } catch (e) {}
  }

  function nextEmptyPlot() {
    for (var i = 0; i < S.plots.length; i++) if (!S.plots[i].planted) return S.plots[i];
    return null;
  }
  function plant(pl) {
    if (!pl) pl = nextEmptyPlot();
    if (!pl || pl.planted) return false;
    var cost = plantCost(plantedCount());
    if (S.dew < cost) { flashBtn(plantBtn); return false; }
    S.dew -= cost;
    pl.planted = true; pl.progress = 0; pl.wateredUntil = 0;
    randomizeSpecies(pl);
    var b = plotBase(pl); pops.push({ x: b.x, y: b.y - 4, t: performance.now() });
    hideHint(); save();
    track("garden_action", { action: "plant", planted: plantedCount() });
    return true;
  }
  function water(pl) {
    if (!pl || !pl.planted) return false;
    pl.wateredUntil = Date.now() + WATER_SECS * 1000;
    var b = plotBase(pl); splashes.push({ x: b.x, y: b.y - 2, t: performance.now() });
    if (pl.progress >= 0.9) { S.dew += 3; } // a little nectar reward
    hideHint();
    return true;
  }

  function flashBtn(btn) {
    btn.animate([{ transform: "translateX(0)" }, { transform: "translateX(-4px)" }, { transform: "translateX(4px)" }, { transform: "translateX(0)" }], { duration: 240 });
  }

  // pointer → nearest plot
  function hit(x, y) {
    var best = null, bd = 1e9;
    for (var i = 0; i < S.plots.length; i++) {
      var pl = S.plots[i], b = plotBase(pl);
      // generous target: base, plus up the stem if grown
      var tx = b.x, ty = b.y;
      var top = b.y - smooth(Math.min(pl.progress / 0.92, 1)) * pl.maxH * 150 * b.scale;
      var cy = pl.planted ? (b.y + top) / 2 : b.y;
      var d = Math.hypot(x - tx, y - cy);
      var reach = (pl.planted ? 46 : 30) * b.scale;
      if (d < reach && d < bd) { bd = d; best = pl; }
    }
    return best;
  }

  cv.addEventListener("pointerdown", function (e) {
    var pl = hit(e.clientX, e.clientY);
    if (pl) { if (pl.planted) water(pl); else plant(pl); }
    else {
      // tapped bare ground → plant nearest empty plot to the tap, if affordable
      var empty = nextEmptyPlot();
      if (empty) plant(empty);
    }
  });

  plantBtn.addEventListener("click", function () { plant(null); });
  soilBtn.addEventListener("click", function () {
    var cost = soilCost(S.soil);
    if (S.dew < cost) { flashBtn(soilBtn); return; }
    S.dew -= cost; S.soil++; save();
    toast("Soil enriched — <b>plants grow faster</b> (level " + S.soil + ").");
    track("garden_action", { action: "soil", level: S.soil });
  });
  rainBtn.addEventListener("click", function () {
    var nowS = Date.now() / 1000;
    if (nowS < S.rainAt + RAIN_COOLDOWN) return;
    S.rainAt = nowS;
    var until = Date.now() + 7000;
    S.plots.forEach(function (pl) { if (pl.planted) pl.wateredUntil = until; });
    hideHint(); save();
    track("garden_action", { action: "rain" });
  });

  // persistence lifecycle
  setInterval(save, 4000);
  document.addEventListener("visibilitychange", function () { if (document.hidden) save(); });
  window.addEventListener("pagehide", save);

  // ---- boot ------------------------------------------------------------
  resize();
  updateHUD(DEW_BASE + DEW_PER_BLOOM * bloomCount());
  if (offline) {
    var mins = Math.round(offline.secs / 60);
    var t = mins >= 60 ? (Math.floor(mins / 60) + "h " + (mins % 60) + "m") : (mins + " min");
    var msg = "While you were away (" + t + ") your garden made <b>+" + Math.floor(offline.dew) + " dew</b>";
    if (offline.blooms > 0) msg += " and <b>" + offline.blooms + "</b> flower" + (offline.blooms > 1 ? "s" : "") + " bloomed";
    toast(msg + ".", 6000);
  }
  setTimeout(hideHint, 7000);
  requestAnimationFrame(frame);
})();
