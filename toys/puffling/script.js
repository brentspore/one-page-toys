/* Puffling — a one-touch momentum hill glider (Tiny-Wings lineage, original).
 * Hold to fold up and DIVE: diving into a downslope slingshots your speed, and
 * releasing at a crest launches you. Land smoothly down the far side for a
 * PERFECT slide; three in a row = FEVER. Procedural candy-striped islands, a
 * sun that arcs across the sky as your clock, and generative cheerful audio.
 * Vanilla Canvas 2D + Web Audio. No libraries, no build. */
(function () {
  "use strict";

  var canvas = document.getElementById("canvas");
  var ctx = canvas.getContext("2d");
  var scoreEl = document.getElementById("score");
  var bestEl = document.getElementById("best");
  var soundBtn = document.getElementById("soundBtn");
  var overlay = document.getElementById("overlay");
  var ovTitle = document.getElementById("ovTitle");
  var ovText = document.getElementById("ovText");
  var ovBtn = document.getElementById("ovBtn");
  var hintEl = document.getElementById("hint");
  var flashEl = document.getElementById("flash");

  var W = 0, H = 0, DPR = 1;

  // ---- tunables ----
  var G = 1900;              // gravity px/s^2 (ground pump / dive)
  var GLIDE = 0.8;           // airborne gravity factor when NOT holding (floaty glide)
  var DIVE = 3.3;            // hold multiplier for the GROUND pump (build speed on downslopes)
  var AIR_DIVE = 2.2;        // hold multiplier for the AIR dive (gentler so it doesn't kill launches)
  var VX_MIN = 205;          // never stall
  var VY_MAX = 3200;         // terminal dive
  var SEG_W = 12;            // terrain cell width
  var CREST_EPS = 0.35;      // ballistic crest-ejection: leave ground when the terrain curves away faster than a fall
  var LAUNCH_POP = 0.2;      // small upward assist on RELEASE at a crest (× ground speed, capped) — mostly natural
  var HOLD_POP = 0.12;       // tiny assist while holding (launch is mostly the bird's real tangential velocity)
  var BOOST_T = 0.09;        // brief low-gravity hysteresis after launch so it commits to the air
  var MIN_AIR = 0.12;        // airborne time before a landing counts for scoring
  var PERFECT_DEG = 22, BOUNCE_DEG = 38;
  var SUN_TIMER = 95;        // seconds of daylight
  var SUN_BONUS = 0.4;       // seconds a collected sun pushes the sunset back
  var R = 15;                // bird radius

  // terrain shape (set on resize). HV = the world's vertical scale — keyed to the device's LONG
  // dimension (capped) so it's rotation-invariant: hills are exactly as steep in landscape as in
  // portrait (H-keyed terrain made landscape hills half as steep over the same dx = way easier).
  var BASE = 0, AMP = 0, WATER_Y = 0, HV = 0;

  // ---- state ----
  var started = false, running = false, dead = false, soundOn = true, holding = false;
  var bird = { x: 0, y: 0, vx: 0, vy: 0, s: 0, grounded: true, rot: 0, sq: 1 };
  var camX = 0, camY = 0, zoom = 1, shakeX = 0, shakeY = 0, shake = 0, hitStop = 0;
  var sunT = SUN_TIMER, dayPhase = 0, visGrade = 0, tNow = 0;
  var chain = 0, fever = false, feverGlow = 0, score = 0, bonus = 0, best = 0;
  var canScore = false, wasWater = false;
  // intro: the bird starts in a NEST — a 3-2-1 countdown, then it hops out and the run begins
  var intro = null, nestX = 80;
  // dive-slide (Tiny Wings perfect): dive & hug any downslope; the flatten/upswing cashes it in as a perfect
  var slideT = 0, slideHoldT = 0, slidePeakY = 0, slideMaxY = 0;
  // little expressions: effort grunts/sweat on slow climbs, antics in the air (occasional, not every time)
  var expr = { kind: "", t: 0, dur: 0, emitT: 0 }, exprCool = 0, wingT = 0, spinP = 0;
  var trail = [], parts = [], pops = [], suns = [];

  // ---- daily seed (same hills for everyone each day) ----
  var daySeed = Math.floor(Date.now() / 86400000);
  function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  var rng = mulberry32(daySeed * 2654435761 >>> 0);
  function rr(a, b) { return a + (b - a) * rng(); }

  function bestKey() { return "puffling_best_" + daySeed; }
  try { best = parseInt(localStorage.getItem(bestKey()), 10) || 0; } catch (e) { best = 0; }
  bestEl.textContent = best > 0 ? "Best " + best : "Best –";

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  // ---- island palettes (advance hue per island; cream is the glue) ----
  var PALS = [
    { h: 96, s: 58, l: 52 },   // spring meadow
    { h: 340, s: 66, l: 60 },  // raspberry
    { h: 178, s: 52, l: 50 },  // coral & teal
    { h: 32, s: 70, l: 55 },   // golden autumn
    { h: 268, s: 44, l: 60 },  // lavender
    { h: 150, s: 50, l: 50 }   // mint
  ];
  function hsl(h, s, l, a) { return "hsla(" + h + "," + s + "%," + l + "%," + (a == null ? 1 : a) + ")"; }

  // ---- paper grain, baked INTO the hill fills (world-anchored, clipped to the hill → scrolls with terrain,
  // never a screen-fixed film over the viewport) ----
  var grainPat = null;
  function buildGrain() {
    var c = document.createElement("canvas"); c.width = c.height = 192;
    var t = c.getContext("2d"), gr = mulberry32(7);
    for (var i = 0; i < 340; i++) {
      var a = gr();
      t.fillStyle = a < 0.5 ? "rgba(255,250,236," + (0.03 + gr() * 0.05) + ")" : "rgba(30,20,10," + (0.02 + gr() * 0.04) + ")";
      t.beginPath(); t.arc(gr() * 192, gr() * 192, 0.6 + gr() * 1.3, 0, 6.28); t.fill();
    }
    grainPat = ctx.createPattern(c, "repeat");
  }

  // deterministic per-cell hash for ground decorations (same flowers in the same spots all day)
  function h2(n) { n = Math.imul(n ^ (n >>> 15), 2246822519); n = Math.imul(n ^ (n >>> 13), 3266489917); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; }

  // ---- seamless candy stripes (world-anchored diagonal bands, drawn continuously → no tiling seam) ----
  // Work in a rotated basis: n = (-sa, ca) is the stripe normal (offset axis), d = (ca, sa) is along the
  // stripe. Bound BOTH axes to the visible hill box so the bands always cover exactly the on-screen hill,
  // wherever it is in world space. world(nc,dc) = nc*n + dc*d.
  function drawStripes(isl, x0, x1) {
    var ang = isl.sang, per = isl.sper, ca = Math.cos(ang), sa = Math.sin(ang);
    var yTop = HV * 0.02, yBot = WATER_Y + H * 2;
    var xs = [x0, x1], ys = [yTop, yBot];
    var minN = 1e9, maxN = -1e9, minD = 1e9, maxD = -1e9;
    for (var i = 0; i < 2; i++) for (var j = 0; j < 2; j++) {
      var nc = xs[i] * -sa + ys[j] * ca, dc = xs[i] * ca + ys[j] * sa;
      if (nc < minN) minN = nc; if (nc > maxN) maxN = nc;
      if (dc < minD) minD = dc; if (dc > maxD) maxD = dc;
    }
    minD -= 40; maxD += 40;
    function band(a, b, style) {
      ctx.fillStyle = style;
      ctx.beginPath();
      ctx.moveTo(a * -sa + minD * ca, a * ca + minD * sa);
      ctx.lineTo(a * -sa + maxD * ca, a * ca + maxD * sa);
      ctx.lineTo(b * -sa + maxD * ca, b * ca + maxD * sa);
      ctx.lineTo(b * -sa + minD * ca, b * ca + minD * sa);
      ctx.closePath(); ctx.fill();
    }
    for (var o = Math.floor(minN / per) * per; o < maxN; o += per) {
      band(o, o + per * 0.46, "rgba(255,250,236,0.15)");         // light candy stripe
      band(o + per * 0.5, o + per * 0.9, "rgba(0,0,0,0.045)");   // subtle shadow stripe
    }
  }

  // ---- terrain generation ----
  var gY = [], gW = [], islands = [], keys = [];
  var gen = null;
  function initTerrain() {
    gY = []; gW = []; islands = []; keys = []; suns = [];
    gen = { mode: "beach0", island: 0, islandDist: 0, islandLen: 7600, sign: -1, curX0: 0 };
    // seed a starting slope so the bird has ground under it
    var y0 = BASE + AMP * 0.35;
    keys.push({ x: -400, y: y0 });
    fillSeg(-400, y0, 0, y0, false);
    gen.curX0 = 0;
    islands.push({ x0: -400, x1: 1e9, pal: PALS[0], sang: -0.46, sper: 34 }); // provisional first island
    while (lastGenX() < 2600) nextSeg();
  }
  function lastGenX() { return keys.length ? keys[keys.length - 1].x : 0; }
  function fillSeg(ax, ay, bx, by, water) {
    var c0 = Math.ceil(ax / SEG_W), c1 = Math.floor(bx / SEG_W);
    for (var c = c0; c <= c1; c++) {
      var x = c * SEG_W, t = (bx - ax) ? (x - ax) / (bx - ax) : 0;
      var f = 0.5 - 0.5 * Math.cos(Math.PI * t);
      gY[c] = ay + (by - ay) * f; gW[c] = water ? 1 : 0;
    }
  }
  function nextSeg() {
    var prev = keys[keys.length - 1];
    var g = gen;
    if (g.mode === "beach0") { g.mode = "hill"; g.sign = -1; return; }
    if (g.mode === "hill") {
      var amp = AMP * (0.9 + 0.45 * Math.min(g.island * 0.12, 1)) * (0.9 + rr(0, 0.35));
      var dx = rr(400, 640) * (1 + 0.08 * Math.min(g.island, 8));
      var y;
      if (g.sign < 0) y = clamp(BASE - amp, HV * 0.11, BASE - 40);      // peak
      else y = clamp(BASE + amp * 0.6, BASE + 30, WATER_Y - 46);         // valley
      var nx = prev.x + dx;
      fillSeg(prev.x, prev.y, nx, y, false);
      keys.push({ x: nx, y: y });
      if (g.sign > 0 && g.islandDist > 200 && rng() < 0.6) spawnSunRun(prev.x, nx);   // run of suns down this slope
      g.sign = -g.sign; g.islandDist += dx;
      if (g.islandDist >= g.islandLen && g.sign < 0) g.mode = "crest";
      return;
    }
    if (g.mode === "crest") {  // the island's final launch peak (the last hill IS the run-up)
      var dxc = rr(380, 480);
      var yc = clamp(BASE - AMP * 0.7, HV * 0.14, BASE - 40);
      var nxc = prev.x + dxc;
      fillSeg(prev.x, prev.y, nxc, yc, false);
      keys.push({ x: nxc, y: yc });
      g.mode = "shore"; return;
    }
    if (g.mode === "shore") {  // short descent to the water's edge right after the launch crest
      var dxs = rr(170, 230);
      var nxs = prev.x + dxs;
      fillSeg(prev.x, prev.y, nxs, WATER_Y, false);
      keys.push({ x: nxs, y: WATER_Y });
      islands[islands.length - 1].x1 = nxs;
      g.mode = "gap"; return;
    }
    if (g.mode === "gap") {    // narrow flat water gap
      var gap = 200 + 25 * gen.island;
      var nx3 = prev.x + gap;
      fillSeg(prev.x, WATER_Y, nx3, WATER_Y, true);
      keys.push({ x: nx3, y: WATER_Y });
      g.island++; g.islandDist = 0; g.islandLen = 7600 + 1400 * g.island;
      islands.push({ x0: nx3, x1: 1e9, pal: PALS[g.island % PALS.length], sang: (rng() < 0.5 ? -1 : 1) * (0.34 + rng() * 0.4), sper: 30 + rng() * 12 });
      g.mode = "beach"; return;
    }
    if (g.mode === "beach") {  // rise from the water onto the new island
      var dx4 = rr(230, 320);
      var y4 = clamp(BASE + AMP * 0.5, BASE + 30, WATER_Y - 46);
      var nx4 = prev.x + dx4;
      fillSeg(prev.x, WATER_Y, nx4, y4, false);
      keys.push({ x: nx4, y: y4 });
      g.sign = -1; g.mode = "hill"; return;
    }
  }
  function ensureGen() { var need = camX + W / zoom + 400; while (lastGenX() < need) nextSeg(); }
  // suns hug the terrain surface (groundY is filled for [xa,xb]) so they're always just above ground & reachable;
  // a small handful per slope (2-4) — an accent to chase, not a slope filled wall-to-wall
  function spawnSunRun(xa, xb) {
    var span = xb - xa, step = 112;
    var n = Math.max(2, Math.min(4, Math.round(span / 300)));
    var startX = xa + (span - (n - 1) * step) / 2;   // center the little run within the slope
    for (var i = 0; i < n; i++) {
      var x = startX + i * step;
      var t = n > 1 ? i / (n - 1) : 0.5;
      var lift = 40 + 14 * Math.sin(Math.PI * t);    // gentle arc riding the slope, always within reach
      suns.push({ x: x, y: groundY(x) - lift, taken: false, bob: rng() * 6.28 });
    }
  }

  function groundY(x) {
    var c = Math.floor(x / SEG_W), f = x / SEG_W - c;
    var a = gY[c], b = gY[c + 1];
    if (a == null) a = WATER_Y; if (b == null) b = a;
    return a + (b - a) * f;
  }
  function slopeAt(x) { var e = SEG_W; return Math.atan2(groundY(x + e) - groundY(x - e), 2 * e); }
  function waterAt(x) { return gW[Math.floor(x / SEG_W)] === 1; }
  function islandAt(x) { for (var i = islands.length - 1; i >= 0; i--) if (x >= islands[i].x0 && x <= islands[i].x1) return islands[i]; return islands[0]; }

  // ---- layout ----
  function resize() {
    // phones render at 1.75× (they're DPR-3 screens already downsampling our 2×) — ~23% less
    // raster work per frame for imperceptible softness on this soft-shapes art; desktop stays 2×
    DPR = Math.min(window.devicePixelRatio || 1, navigator.maxTouchPoints > 0 ? 1.75 : 2);
    var oldHV = HV;
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.floor(W * DPR); canvas.height = Math.floor(H * DPR);
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    fsTried = false;   // fresh orientation/viewport = one fresh fullscreen attempt on the next touch
    HV = Math.min(Math.max(W, H), 840);   // rotation-invariant world scale (same hills either way up)
    BASE = HV * 0.36; AMP = HV * 0.19; WATER_Y = HV * 0.58;
    if (!keys.length) { resetRun(); return; }
    // world-scale change mid-run (desktop window resize; phone rotation leaves HV unchanged):
    // every vertical terrain value is proportional to HV, so rescaling the stored world by
    // newHV/oldHV reproduces exactly what generation would have produced (x spacing untouched)
    if (oldHV && HV !== oldHV) {
      var r = HV / oldHV;
      for (var k in gY) gY[k] *= r;
      for (var i = 0; i < keys.length; i++) keys[i].y *= r;
      for (var j = 0; j < suns.length; j++) suns[j].y *= r;
      bird.y *= r; camY *= r; slidePeakY *= r; slideMaxY *= r;
    }
  }

  // ---- physics ----
  function update(dt) {
    tNow += dt;
    feverGlow += ((fever ? 1 : 0) - feverGlow) * Math.min(1, dt * 6);
    if (shake > 0) shake = Math.max(0, shake - dt * 40);
    shakeX = shake > 0 ? (Math.random() * 2 - 1) * shake : 0;
    shakeY = shake > 0 ? (Math.random() * 2 - 1) * shake : 0;

    if (running && hitStop > 0) { hitStop -= dt; dt = Math.max(0, dt - hitStop > 0 ? 0 : dt); if (hitStop > 0) dt = 0; }

    // nest countdown: 3… 2… 1… WHEE! — then the bird hops out and the run begins
    if (intro) {
      intro.t += dt;
      var steps = [[0.25, "3"], [0.95, "2"], [1.65, "1"]];
      for (var si = 0; si < steps.length; si++) {
        if (intro.t >= steps[si][0] && !intro[si]) { intro[si] = true; countPop(steps[si][1]); sndTick(3 - si); }
      }
      if (intro.t >= 2.35) {
        intro = null; running = true;
        bird.grounded = false; bird.vx = 300; bird.vy = -330; bird.airT = 0; canScore = false; bird.boostT = 0.12;
        countPop("WHEE!"); sndWhee(); featherPuff();
        expr.kind = "whee"; expr.t = 0; expr.dur = 0.9; exprCool = 1.5;
      }
    }

    if (running) {
      sunT -= dt;
      dayPhase = clamp(1 - sunT / SUN_TIMER, 0, 1);
      if (sunT <= 0) { endRun(); }
    }
    // ease the dusk veil toward its target so sunT jumps never snap it
    var gradeTarget = dayPhase < 0.35 ? 0 : (dayPhase - 0.35) / 0.65;
    visGrade += (gradeTarget - visGrade) * Math.min(1, dt * 1.6);

    if (running) stepBird(dt);

    ensureGen();
    if (running) updateSuns();
    updateCamera(dt);

    // trail
    if (running && (tNow * 60 | 0) % 2 === 0) { trail.push({ x: bird.x, y: bird.y, t: 0 }); if (trail.length > 26) trail.shift(); }
    for (var i = trail.length - 1; i >= 0; i--) { trail[i].t += dt; if (trail[i].t > 0.5) trail.splice(i, 1); }
    // particles
    for (i = parts.length - 1; i >= 0; i--) { var p = parts[i]; p.t += dt; p.vy += (p.g || 0) * dt; p.x += p.vx * dt; p.y += p.vy * dt; if (p.t >= p.max) parts.splice(i, 1); }
    for (i = pops.length - 1; i >= 0; i--) { pops[i].t += dt; pops[i].sy -= 30 * dt; if (pops[i].t > pops[i].max) pops.splice(i, 1); }
    updateExpr(dt);

    if (running) { score = Math.floor(bird.x / 60) + bonus; scoreEl.textContent = score; }
  }

  function stepBird(dt) {
    var g_eff = G * (holding ? DIVE : 1);
    if (bird.grounded) {
      var th = slopeAt(bird.x), cs = Math.cos(th), sn = Math.sin(th);
      var fr = holding ? 0.02 : 0.26;
      // holding pumps DOWNHILL (build speed) but doesn't extra-brake UPHILL — so you keep momentum to the crest
      bird.s += G * (holding && sn > 0 ? DIVE : 1) * sn * dt;
      bird.s *= Math.exp(-fr * dt);
      var floor = fever ? 240 : 90;
      if (bird.s < floor) bird.s = floor;
      var nx = bird.x + bird.s * cs * dt;
      var vyT = bird.s * sn;
      // NORMAL gravity in the takeoff test: you fly off crests by SPEED, whether holding or not
      var yProj = bird.y + vyT * dt + 0.5 * G * dt * dt;
      var ySurf = groundY(nx) - R;
      if (ySurf - yProj > CREST_EPS) {   // ballistic crest ejection — speed & crest sharpness decide it
        bird.grounded = false; bird.vx = bird.s * cs; bird.vy = bird.s * sn;
        bird.x = nx; bird.y = groundY(bird.x) - R; canScore = true; bird.airT = 0;
        bird.boostT = BOOST_T;                                  // brief hysteresis so it commits to the air
        bird.vy -= Math.min(bird.s * (holding ? HOLD_POP : LAUNCH_POP), 190);   // small assist, mostly natural
        finishSlide();                                          // flying off cashes in the dive so far
        onLaunch();
      } else if (waterAt(bird.x)) {
        bird.x = nx; bird.y = groundY(bird.x) - R; bird.rot = th; waterSkim();
      } else {
        bird.x = nx; bird.y = groundY(bird.x) - R; bird.rot = th;
        if (wasWater) exitSpray();
        wasWater = false;
        spraySlide(th);
        // --- dive-slide: while grounded on a downslope, accrue dive credit; the flatten/upswing grades it ---
        if (sn > 0.05) {
          if (slideT === 0) { slidePeakY = bird.y; slideMaxY = bird.y; }
          slideT += dt; if (bird.y > slideMaxY) slideMaxY = bird.y;
          if (holding) slideHoldT += dt;
        } else if (slideT > 0 && sn <= 0) {   // slope flattened / turned uphill → grade the completed dive
          finishSlide();
        }
      }
    } else {
      bird.airT = (bird.airT || 0) + dt;
      bird.boostT = Math.max(0, (bird.boostT || 0) - dt);
      var ag;
      if (bird.boostT > 0) ag = G * 0.5;                        // brief launch hysteresis
      else if (holding) ag = bird.vy < 0 ? G * 0.9 : G * AIR_DIVE; // dive only while descending, gently
      else ag = G * GLIDE;                                      // glide floats
      bird.vy += ag * dt;
      if (holding && bird.vy > 0) bird.vx += 0.14 * G * dt;
      bird.vx *= Math.exp(-0.12 * dt);
      if (bird.vx < VX_MIN) bird.vx = VX_MIN;
      if (bird.vy > VY_MAX) bird.vy = VY_MAX;
      bird.x += bird.vx * dt; bird.y += bird.vy * dt;
      bird.rot = Math.atan2(bird.vy, bird.vx);
      var gy = groundY(bird.x) - R;
      if (bird.y >= gy) land(gy);
    }
    // squash toward grounded/flat
    var tsq = bird.grounded ? 1.06 : (holding ? 0.86 : 1);
    bird.sq += (tsq - bird.sq) * Math.min(1, dt * 12);
  }

  function land(gy) {
    var th = slopeAt(bird.x), cs = Math.cos(th), sn = Math.sin(th);
    var vt = bird.vx * cs + bird.vy * sn;
    var vn = -bird.vx * sn + bird.vy * cs;
    var sp = Math.hypot(bird.vx, bird.vy) || 1;
    var phi = Math.atan2(Math.abs(vn), Math.abs(vt)) * 180 / Math.PI;
    var down = sn > 0.05;
    bird.grounded = true; bird.y = gy; bird.rot = th;
    bird.s = Math.max(vt, 80);
    slideT = 0; slideHoldT = 0;      // airborne → any new dive starts fresh from where you land
    if (!isEffortKind(expr.kind)) { expr.kind = ""; spinP = 0; }   // touchdown ends any air antic
    if (waterAt(bird.x)) { waterSkim(); return; }
    if (canScore && (bird.airT || 0) > MIN_AIR) {
      canScore = false;
      if (phi > BOUNCE_DEG || !down) {                  // steep slam or landing on an upslope = blown flow
        if (chain > 0 || fever) breakStreak();
        bird.s *= 0.62; shake = Math.max(shake, 5); dust(10); sndThud();
      } else {                                          // clean touchdown onto a downslope — flows into the dive
        bird.s *= (1 - 0.35 * (vn / sp) * (vn / sp)); dust(5);
      }
    } else { dust(3); }
  }

  function awardPerfect() {
    chain++; bird.s *= 1.05; bonus += 10 * (fever ? 2 : 1);
    addPop(chain > 1 ? "PERFECT ×" + chain : "PERFECT!");
    sndPerfect(chain); sparkle(10, "#fff4c8");
    if (chain === 3 && !fever) startFever();
    if (fever) { sunT = Math.min(SUN_TIMER, sunT + 3.6); sparkle(8, "#8fd0ff"); }
  }
  // grade a completed downhill dive: dove (held) most of it, real vertical drop, carried speed → PERFECT slide
  function finishSlide() {
    if (slideT > 0.16 && slideHoldT > slideT * 0.5 && (slideMaxY - slidePeakY) > 50 && bird.s > 240) awardPerfect();
    slideT = 0; slideHoldT = 0;
  }

  function onLaunch() { if (!holding) { sndWhee(); } sndSlide(false); maybeAirAntic(); }

  // ---- little expressions ----
  function pick(arr) { return arr[(Math.random() * arr.length) | 0]; }
  function isEffortKind(k) { return k === "sweat" || k === "puff" || k === "grit"; }
  function updateExpr(dt) {
    exprCool -= dt;
    // tiny wing flaps: lazy bob on the ground, quick flutter in the air, tucked while diving, paddling in water
    wingT += dt * (bird.grounded ? (waterAt(bird.x) ? 15 : 5 + bird.s * 0.004) : (holding ? 4 : 11) + (expr.kind === "flutter" ? 16 : 0));
    if (expr.kind) { expr.t += dt; if (expr.t >= expr.dur) expr.kind = ""; }
    if (expr.kind === "spin") spinP = Math.min(1, expr.t / expr.dur);
    if (!running || dead) return;
    var sn = Math.sin(slopeAt(bird.x));
    var struggling = bird.grounded && sn < -0.12 && bird.s < 340;   // crawling up a hill
    if (struggling && !expr.kind && exprCool <= 0) {                // sometimes — not every climb
      if (Math.random() < 0.6) { expr.kind = pick(["sweat", "puff", "grit"]); expr.t = 0; expr.dur = 1.5 + Math.random(); expr.emitT = 0; exprCool = 2.6 + Math.random() * 2.6; }
      else exprCool = 1.4;
    }
    if (isEffortKind(expr.kind)) {
      if (!struggling) { expr.kind = ""; return; }                  // over the top — relief
      expr.emitT -= dt;
      if (expr.emitT <= 0) {
        if (expr.kind === "sweat") { sweatDrop(); expr.emitT = 0.26; }
        else if (expr.kind === "puff") { steamPuff(); sndGrunt(); expr.emitT = 0.55; }
        else { if (Math.random() < 0.5) sndGrunt(); expr.emitT = 0.6; }
      }
    }
  }
  function maybeAirAntic() {                                        // on launch, sometimes — not every flight
    if (!running || dead || exprCool > 0) return;
    if (Math.random() < 0.42) {
      expr.kind = pick(["whee", "spin", "flutter", "gaze"]);
      expr.t = 0; expr.dur = expr.kind === "spin" ? 0.62 : 0.9; spinP = 0;
      exprCool = 1.6 + Math.random() * 2;
      if (expr.kind === "flutter") featherPuff();
    }
  }
  function sweatDrop() { for (var i = 0; i < 2; i++) parts.push({ x: bird.x - R * 0.1, y: bird.y - R * 0.85, vx: -bird.s * 0.25 - 30 - Math.random() * 50, vy: -110 - Math.random() * 70, t: 0, max: 0.55, g: 340, size: 2 + Math.random() * 1.4, color: "rgba(150,216,255,0.95)" }); }
  function steamPuff() { for (var i = 0; i < 3; i++) parts.push({ x: bird.x + R * 1.05, y: bird.y + R * 0.05, vx: 20 + Math.random() * 30, vy: -30 - Math.random() * 25, t: 0, max: 0.6 + Math.random() * 0.3, g: -60, size: 2.5 + Math.random() * 2.5, color: "rgba(255,255,255,0.55)" }); }
  function featherPuff() { for (var i = 0; i < 4; i++) parts.push({ x: bird.x - R * 0.4, y: bird.y, vx: -60 - Math.random() * 80, vy: -40 + Math.random() * 80, t: 0, max: 0.7, g: 120, size: 2 + Math.random() * 2, color: i % 2 ? "#7adfd4" : "#ff9d7e" }); }
  function startFever() { fever = true; sparkle(24, "#ffd36b"); addPop("FEVER!", true); sndFever(); flash(); }
  function breakStreak() { chain = 0; if (fever) { fever = false; } }
  var lastWake = 0;
  function waterSkim() {
    if (!wasWater) { wasWater = true; slideT = 0; slideHoldT = 0; bird.s *= 0.35; breakStreak(); splash(); shake = Math.max(shake, 6); hitStop = 0.06; sndSplash(); }
    bird.s *= Math.exp(-2.6 * (1 / 60)); if (bird.s < 60) bird.s = 60;
    // paddling wake: little kicks of spray behind, drips off the crest, expanding ripples
    if (tNow - lastWake > 0.16) {
      lastWake = tNow;
      for (var i = 0; i < 2; i++) parts.push({ x: bird.x - R * (0.8 + Math.random() * 0.6), y: WATER_Y - 2, vx: -50 - Math.random() * 70 - bird.s * 0.3, vy: -60 - Math.random() * 90, t: 0, max: 0.45 + Math.random() * 0.25, g: 520, size: 1.6 + Math.random() * 2, color: "rgba(200,235,255,0.9)" });
      parts.push({ x: bird.x - R * 1.2, y: WATER_Y, vx: -30 - bird.s * 0.2, vy: 0, t: 0, max: 0.8, g: 0, size: 2.5, color: "rgba(255,255,255,0.5)" });
      if (Math.random() < 0.6) sndPaddle();
    }
  }
  // clambering out: a happy shake-off spray
  function exitSpray() {
    for (var i = 0; i < 14; i++) { var a = -Math.PI / 2 + (Math.random() - 0.5) * 1.6; var sp = 90 + Math.random() * 170; parts.push({ x: bird.x, y: bird.y, vx: Math.cos(a) * sp + bird.s * 0.25, vy: Math.sin(a) * sp, t: 0, max: 0.5 + Math.random() * 0.3, g: 560, size: 1.6 + Math.random() * 2.2, color: "rgba(200,235,255,0.9)" }); }
  }

  // ---- particles ----
  function spraySlide(th) { if (bird.s > 260 && Math.random() < 0.5) parts.push({ x: bird.x - Math.cos(th) * R, y: bird.y + R * 0.7, vx: -Math.cos(th) * bird.s * 0.2 + (Math.random() * 2 - 1) * 30, vy: -Math.random() * 60 - 10, t: 0, max: 0.4 + Math.random() * 0.3, g: 240, size: 1.5 + Math.random() * 2, color: "rgba(255,255,255,0.8)" }); }
  function dust(n) { for (var i = 0; i < n; i++) parts.push({ x: bird.x + (Math.random() * 2 - 1) * R, y: bird.y + R * 0.7, vx: (Math.random() * 2 - 1) * 80, vy: -Math.random() * 80 - 20, t: 0, max: 0.4 + Math.random() * 0.4, g: 260, size: 2 + Math.random() * 2.5, color: "rgba(240,230,210,0.85)" }); }
  function sparkle(n, col) { for (var i = 0; i < n; i++) { var a = Math.random() * 6.28, sp = 40 + Math.random() * 160; parts.push({ x: bird.x, y: bird.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40, t: 0, max: 0.5 + Math.random() * 0.5, g: 60, size: 1.5 + Math.random() * 2.5, color: col, add: true }); } }
  function splash() {
    // droplet burst + a crown of bigger drops + a low foam skirt spreading along the surface
    for (var i = 0; i < 34; i++) { var a = -Math.PI / 2 + (Math.random() - 0.5) * 2.0, sp = 120 + Math.random() * 260; parts.push({ x: bird.x, y: WATER_Y, vx: Math.cos(a) * sp * 0.6, vy: Math.sin(a) * sp, t: 0, max: 0.5 + Math.random() * 0.5, g: 620, size: 2 + Math.random() * 3, color: "rgba(190,230,255,0.9)" }); }
    for (var c = 0; c < 8; c++) { var ca = -Math.PI / 2 + (c / 7 - 0.5) * 1.3; var cs = 220 + Math.random() * 160; parts.push({ x: bird.x, y: WATER_Y, vx: Math.cos(ca) * cs * 0.7, vy: Math.sin(ca) * cs, t: 0, max: 0.65 + Math.random() * 0.3, g: 620, size: 3.5 + Math.random() * 2.5, color: "rgba(225,245,255,0.95)" }); }
    for (var f = 0; f < 10; f++) { var fd = (f / 9 - 0.5) * 2; parts.push({ x: bird.x + fd * R * 1.4, y: WATER_Y - 1, vx: fd * (120 + Math.random() * 80), vy: -14 - Math.random() * 22, t: 0, max: 0.55, g: 240, size: 2.4 + Math.random() * 2, color: "rgba(255,255,255,0.75)" }); }
  }
  function addPop(txt, big) { pops.push({ sx: ANCH_X, sy: w2sy(bird.y) - R * 2.4, t: 0, max: 1.5, txt: txt, big: !!big }); }
  function countPop(txt) { pops.push({ sx: W / 2, sy: H * 0.34, t: 0, max: 0.66, txt: txt, big: true }); }
  function flash() { flashEl.classList.add("is-on"); setTimeout(function () { flashEl.classList.remove("is-on"); }, 130); }
  function updateSuns() {
    var cullX = camX - W / zoom - 140;
    for (var i = suns.length - 1; i >= 0; i--) {
      var sn = suns[i];
      if (sn.x < cullX) { suns.splice(i, 1); continue; }
      if (sn.taken) continue;
      var dx = sn.x - bird.x, dy = sn.y - bird.y;
      if (dx * dx + dy * dy < 44 * 44) {          // collect: push the sunset back + a little score
        sn.taken = true; sunT = Math.min(SUN_TIMER, sunT + SUN_BONUS); bonus += 5;
        for (var k = 0; k < 10; k++) { var a = Math.random() * 6.28, s = 40 + Math.random() * 150; parts.push({ x: sn.x, y: sn.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 30, t: 0, max: 0.5 + Math.random() * 0.4, g: 70, size: 1.5 + Math.random() * 2.5, color: "#ffe49a", add: true }); }
        sndSun();
      }
    }
  }

  // ---- camera ----
  function updateCamera(dt) {
    camX = bird.x;
    var gt = groundY(bird.x);
    var tgt = bird.y * 0.6 + gt * 0.4;
    if (!bird.grounded && bird.vy < 0) tgt = bird.y * 0.78 + gt * 0.22;
    camY += (tgt - camY) * (1 - Math.exp(-9 * dt));
    var speed = bird.grounded ? bird.s : Math.hypot(bird.vx, bird.vy);
    var alt = Math.max(0, groundY(bird.x) - bird.y);
    // short viewports (landscape phones) pull the camera out a touch so the full-size hills frame well
    var tz = clamp((1.15 - speed / 4200 - alt / 2400) * clamp(H / 620, 0.78, 1), 0.5, 1.08);
    zoom += (tz - zoom) * (1 - Math.exp(-3.5 * dt));
  }
  var ANCH_X = 0, ANCH_Y = 0;
  function w2sx(x) { return ANCH_X + (x - camX) * zoom + shakeX; }
  function w2sy(y) { return ANCH_Y + (y - camY) * zoom + shakeY; }

  // ---- render ----
  function render() {
    ANCH_X = W * 0.30; ANCH_Y = H * 0.5;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    drawSky();
    drawSun();
    drawFarHills();
    drawClouds();

    // world block
    ctx.save();
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.translate(ANCH_X + shakeX, ANCH_Y + shakeY);
    ctx.scale(zoom, zoom);
    ctx.translate(-camX, -camY);
    drawWater();
    drawHills();
    drawSuns();
    drawNest(false);
    drawParticles();
    drawBird();
    drawNest(true);
    ctx.restore();

    drawGrade();
    drawPops();
  }

  // sky gradient shifts morning -> golden -> dusk with dayPhase
  var SKY = [
    [[126, 200, 227], [201, 238, 247], [255, 246, 218]],   // morning
    [[120, 190, 224], [232, 224, 200], [255, 231, 178]],   // midday-warm
    [[78, 90, 158], [200, 111, 168], [255, 158, 94]],       // golden
    [[62, 74, 120], [123, 95, 168], [201, 111, 130]]        // dusk
  ];
  function lerp3(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
  function skyStop(i) {
    var f = dayPhase * 3, k = Math.min(2, Math.floor(f)), t = f - k;
    return lerp3(SKY[k][i], SKY[k + 1][i], t);
  }
  function rgb(c) { return "rgb(" + (c[0] | 0) + "," + (c[1] | 0) + "," + (c[2] | 0) + ")"; }
  function drawSky() {
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, rgb(skyStop(0))); g.addColorStop(0.55, rgb(skyStop(1))); g.addColorStop(1, rgb(skyStop(2)));
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  function drawSun() {
    var sx = W * (0.14 + dayPhase * 0.74);
    var sy = H * (0.16 + Math.sin(dayPhase * Math.PI) * -0.04 + dayPhase * 0.30);
    var rad = Math.min(W, H) * 0.075;
    var warm = clamp(dayPhase * 1.3, 0, 1);
    ctx.save(); ctx.globalCompositeOperation = "lighter";
    var glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, rad * 4.5);
    glow.addColorStop(0, "rgba(255," + (238 - warm * 60) + "," + (200 - warm * 130) + ",0.55)");
    glow.addColorStop(1, "rgba(255,200,120,0)");
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(sx, sy, rad * 4.5, 0, 6.28); ctx.fill();
    // long horizontal haze once the sun rides low (sunset drama)
    if (dayPhase > 0.5) {
      var low = (dayPhase - 0.5) * 2;
      var hz = ctx.createRadialGradient(sx, sy, 0, sx, sy, rad * 5);
      hz.addColorStop(0, "rgba(255,170,110," + 0.22 * low + ")"); hz.addColorStop(1, "rgba(255,150,90,0)");
      ctx.save(); ctx.translate(sx, sy); ctx.scale(2.6, 0.55); ctx.translate(-sx, -sy);
      ctx.fillStyle = hz; ctx.beginPath(); ctx.arc(sx, sy, rad * 5, 0, 6.28); ctx.fill();
      ctx.restore();
    }
    ctx.restore();
    ctx.fillStyle = "rgba(255," + (246 - warm * 40) + "," + (222 - warm * 110) + ",0.98)";
    ctx.beginPath(); ctx.arc(sx, sy, rad, 0, 6.28); ctx.fill();
    // hot core keeps the disc luminous instead of flat
    ctx.fillStyle = "rgba(255,252,238," + (0.85 - warm * 0.35) + ")";
    ctx.beginPath(); ctx.arc(sx - rad * 0.12, sy - rad * 0.14, rad * 0.62, 0, 6.28); ctx.fill();
    sunScreen = { x: sx, y: sy };
  }
  var sunScreen = { x: 0, y: 0 };

  function drawFarHills() {
    // three parallax silhouette layers, tinted toward the sky (farthest is barely-there atmosphere)
    var layers = [{ p: 0.09, a: 0.34, yb: 0.55, amp: 0.038, w: 430 }, { p: 0.18, a: 0.55, yb: 0.60, amp: 0.05, w: 340 }, { p: 0.34, a: 0.72, yb: 0.66, amp: 0.075, w: 260 }];
    var base = skyStop(2);
    for (var L = 0; L < layers.length; L++) {
      var ly = layers[L];
      var col = lerp3(base, [90, 120, 110], ly.a);
      ctx.fillStyle = rgb(col);
      ctx.beginPath(); ctx.moveTo(0, H);
      for (var sx = 0; sx <= W + 20; sx += 18) {
        var wx = (camX * ly.p + sx);
        var y = H * ly.yb + Math.sin(wx / ly.w) * H * ly.amp + Math.sin(wx / (ly.w * 0.4) + L) * H * ly.amp * 0.4;
        ctx.lineTo(sx, y);
      }
      ctx.lineTo(W, H); ctx.closePath(); ctx.fill();
    }
  }
  var clouds = null;
  function drawClouds() {
    if (!clouds) { clouds = []; var cr = mulberry32(99); for (var i = 0; i < 14; i++) clouds.push({ x: cr() * 4000, y: cr() * H * 0.42 + H * 0.03, s: 0.6 + cr() * 0.9, p: 0.10 + cr() * 0.28 }); }
    for (var i = 0; i < clouds.length; i++) {
      var c = clouds[i];
      var sx = ((c.x - camX * c.p) % 4000 + 4000) % 4000 / 4000 * (W + 400) - 200;
      var ca = 0.72 - dayPhase * 0.25;
      puff(sx, c.y, 46 * c.s, "rgba(255,255,255," + ca + ")", "rgba(198,214,232," + ca * 0.88 + ")");
    }
  }
  function puff(x, y, r, col, shade) {
    // one path (union of lobes + a flat base) so a single fill keeps a uniform alpha;
    // a vertical gradient (lit top → cool flat bottom) gives the puffs dimension at the same draw cost
    if (shade) {
      var g = ctx.createLinearGradient(0, y - r * 1.05, 0, y + r * 0.9);
      g.addColorStop(0, col); g.addColorStop(1, shade);
      ctx.fillStyle = g;
    } else ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, 6.28);
    ctx.arc(x + r * 0.9, y + r * 0.16, r * 0.72, 0, 6.28);
    ctx.arc(x - r * 0.9, y + r * 0.18, r * 0.66, 0, 6.28);
    ctx.arc(x + r * 0.35, y - r * 0.42, r * 0.6, 0, 6.28);
    ctx.arc(x - r * 0.4, y - r * 0.34, r * 0.5, 0, 6.28);
    ctx.moveTo(x - r * 1.55, y + r * 0.9);
    ctx.arcTo(x - r * 1.62, y - r * 0.1, x - r * 0.9, y - r * 0.1, r * 0.5);
    ctx.lineTo(x + r * 1.5, y - r * 0.1);
    ctx.arcTo(x + r * 1.62, y - r * 0.1, x + r * 1.55, y + r * 0.9, r * 0.5);
    ctx.closePath();
    ctx.fill();
  }

  function drawWater() {
    var vl = camX - W / zoom, vr = camX + W / zoom;
    // water only exists in the narrow gaps — skip the big fill + shimmer when none is in view
    var c0 = Math.floor(vl / SEG_W), c1 = Math.ceil(vr / SEG_W), seen = false;
    for (var c = c0; c <= c1; c += 4) { if (gW[c] === 1) { seen = true; break; } }
    if (!seen) return;
    var g = ctx.createLinearGradient(0, WATER_Y, 0, WATER_Y + H);
    var wc = lerp3([90, 175, 214], [70, 90, 150], dayPhase);
    g.addColorStop(0, rgb(lerp3(wc, [255, 255, 255], 0.28))); g.addColorStop(1, rgb(wc));
    ctx.fillStyle = g; ctx.fillRect(vl, WATER_Y, vr - vl, H * 2);
    // sun reflection bars + shimmer
    ctx.save(); ctx.globalCompositeOperation = "lighter";
    var refX = camX + (sunScreen.x - ANCH_X) / zoom;
    for (var i = 0; i < 8; i++) {
      var yy = WATER_Y + 8 + i * 12; var ww = (60 - i * 5) / zoom;
      ctx.fillStyle = "rgba(255,240,200," + (0.12 - i * 0.012) + ")";
      ctx.fillRect(refX - ww + Math.sin(tNow * 2 + i) * 8, yy, ww * 2, 3 / zoom);
    }
    ctx.restore();
  }

  function drawHills() {
    var vl = camX - W / zoom - 40, vr = camX + W / zoom + 40;
    for (var i = 0; i < islands.length; i++) {
      var isl = islands[i];
      var x0 = Math.max(isl.x0, vl), x1 = Math.min(isl.x1, vr);
      if (x1 <= x0) continue;
      // path — island edges taper outward underwater (a sloping bank, not a sheer cliff at the waterline)
      var path = new Path2D(); path.moveTo(x0, groundY(x0));
      for (var x = x0; x <= x1; x += SEG_W) path.lineTo(x, groundY(x));
      path.lineTo(x1, groundY(x1));
      path.lineTo(x1 + 30, Math.min(groundY(x1) + 170, WATER_Y + H));
      path.lineTo(x1 + 30, WATER_Y + H);
      path.lineTo(x0 - 30, WATER_Y + H);
      path.lineTo(x0 - 30, Math.min(groundY(x0) + 170, WATER_Y + H));
      path.closePath();
      // base + shading + stripes + grain (all clipped to the hill body — nothing floats over the viewport)
      ctx.save(); ctx.clip(path);
      var pal = isl.pal;
      var bg = ctx.createLinearGradient(0, BASE - AMP, 0, WATER_Y);
      bg.addColorStop(0, hsl(pal.h, pal.s, Math.min(70, pal.l + 12)));
      bg.addColorStop(1, hsl(pal.h, pal.s, Math.max(24, pal.l - 16)));
      // paint from far above the tallest possible peak down past the path bottom (WATER_Y + H):
      // a fill top that grazes the peak clamp left tall crests with a see-through band under the lip
      var fillTop = HV * 0.02, fillH = WATER_Y + H * 2 - fillTop;
      ctx.fillStyle = bg; ctx.fillRect(x0 - 34, fillTop, (x1 - x0) + 68, fillH);   // covers the underwater taper
      drawStripes(isl, x0 - 34, x1 + 34);
      if (grainPat) { ctx.fillStyle = grainPat; ctx.fillRect(x0 - 34, fillTop, (x1 - x0) + 68, fillH); }
      // soft inner shadow just under the crest line (depth under the lip)
      ctx.lineJoin = "round"; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(x0, groundY(x0) + 10);
      for (var xs = x0; xs <= x1; xs += SEG_W) ctx.lineTo(xs, groundY(xs) + 10);
      ctx.strokeStyle = "rgba(30,18,10,0.10)"; ctx.lineWidth = 10; ctx.stroke();
      ctx.restore();
      // cream rim-light top lip — BUTT caps + a small end inset so the stroke ends flush with the
      // island body instead of its round cap overhanging the water at the island's edges
      var lx0 = x0 + 1.5, lx1 = x1 - 1.5;
      ctx.lineJoin = "round"; ctx.lineCap = "butt";
      ctx.beginPath(); ctx.moveTo(lx0, groundY(lx0) + 3.5);
      for (var xx = lx0; xx <= lx1; xx += SEG_W) ctx.lineTo(xx, groundY(xx) + 3.5);
      ctx.lineTo(lx1, groundY(lx1) + 3.5);
      ctx.strokeStyle = "rgba(60,40,30,0.18)"; ctx.lineWidth = 4; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(lx0, groundY(lx0));
      for (xx = lx0; xx <= lx1; xx += SEG_W) ctx.lineTo(xx, groundY(xx));
      ctx.lineTo(lx1, groundY(lx1));
      ctx.strokeStyle = "rgba(255,250,236,0.95)"; ctx.lineWidth = 4.5; ctx.stroke();
      ctx.lineCap = "round";
      drawDecor(isl, x0, x1);
    }
  }

  // tiny deterministic flowers + grass tufts along the surface (seeded per world cell, drawn only in view)
  var PETALS = ["#fff3df", "#ffc3cf", "#ffd36b"];
  function drawDecor(isl, x0, x1) {
    var c0 = Math.ceil(x0 / 128), c1 = Math.floor(x1 / 128);
    for (var c = c0; c <= c1; c++) {
      var r = h2(c);
      if (r > 0.30) continue;                                  // sparse — most cells stay bare
      var x = c * 128 + (h2(c + 7919) - 0.5) * 72;
      if (x < x0 + 6 || x > x1 - 6) continue;
      var gy = groundY(x);
      if (gy > WATER_Y - 34) continue;                         // keep off the beaches
      var th = slopeAt(x), s = 0.75 + h2(c + 31) * 0.6;
      ctx.save(); ctx.translate(x, gy); ctx.rotate(th);
      if (r < 0.13) {                                          // little daisy
        var pc = PETALS[(h2(c + 131) * PETALS.length) | 0];
        ctx.strokeStyle = hsl(isl.pal.h, isl.pal.s * 0.7, Math.max(20, isl.pal.l - 20));
        ctx.lineWidth = 1.6 * s; ctx.beginPath(); ctx.moveTo(0, 2); ctx.lineTo(0, -7 * s); ctx.stroke();
        ctx.fillStyle = pc;
        for (var p = 0; p < 5; p++) { var a = p / 5 * 6.283; ctx.beginPath(); ctx.arc(Math.cos(a) * 3.1 * s, -7 * s + Math.sin(a) * 3.1 * s, 1.9 * s, 0, 6.28); ctx.fill(); }
        ctx.fillStyle = "#f5a238"; ctx.beginPath(); ctx.arc(0, -7 * s, 1.7 * s, 0, 6.28); ctx.fill();
      } else {                                                 // grass tuft
        ctx.strokeStyle = hsl(isl.pal.h, isl.pal.s * 0.75, Math.max(22, isl.pal.l - 16));
        ctx.lineWidth = 1.7 * s; ctx.lineCap = "round";
        for (var b = -1; b <= 1; b++) { ctx.beginPath(); ctx.moveTo(b * 2.4 * s, 2); ctx.quadraticCurveTo(b * 3.4 * s, -3 * s, b * 5 * s, -7.5 * s); ctx.stroke(); }
      }
      ctx.restore();
    }
  }

  // the home nest — back bowl drawn behind the bird, front lip drawn over it so the bird sits IN the nest;
  // it stays on the first hill and scrolls away once the run begins
  function drawNest(front) {
    if (nestX < camX - W / zoom - 90 || nestX > camX + W / zoom + 90) return;
    var y = groundY(nestX), th = slopeAt(nestX);
    ctx.save(); ctx.translate(nestX, y); ctx.rotate(th);
    if (!front) {
      var g = ctx.createLinearGradient(0, -16, 0, 14);
      g.addColorStop(0, "#a97b4b"); g.addColorStop(1, "#6b4626");
      ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(0, -7, 27, 14, 0, 0, 6.283); ctx.fill();
      ctx.fillStyle = "#4c3118"; ctx.beginPath(); ctx.ellipse(0, -9, 21, 9, 0, 0, 6.283); ctx.fill();
    } else {
      var g2 = ctx.createLinearGradient(0, -12, 0, 12);
      g2.addColorStop(0, "#b98a56"); g2.addColorStop(1, "#74502c");
      ctx.fillStyle = g2;
      ctx.beginPath(); ctx.moveTo(-27, -8);
      ctx.quadraticCurveTo(0, 5, 27, -8);
      ctx.quadraticCurveTo(28, 8, 0, 13);
      ctx.quadraticCurveTo(-28, 8, -27, -8);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "rgba(56,35,16,0.5)"; ctx.lineWidth = 1.6; ctx.lineCap = "round";
      for (var i = 0; i < 6; i++) { ctx.beginPath(); ctx.moveTo(-23 + i * 8, -3 + (i % 2) * 4); ctx.lineTo(-15 + i * 8, 2 + (i % 3) * 2); ctx.stroke(); }
      ctx.beginPath(); ctx.moveTo(-27, -8); ctx.lineTo(-35, -13); ctx.moveTo(27, -8); ctx.lineTo(34, -14); ctx.stroke();
    }
    ctx.restore();
  }

  function drawSuns() {
    for (var i = 0; i < suns.length; i++) {
      var sn = suns[i]; if (sn.taken) continue;
      var yy = sn.y + Math.sin(tNow * 3 + sn.bob) * 4;
      ctx.save(); ctx.globalCompositeOperation = "lighter";
      var g = ctx.createRadialGradient(sn.x, yy, 0, sn.x, yy, 28);
      g.addColorStop(0, "rgba(255,222,120,0.55)"); g.addColorStop(1, "rgba(255,200,90,0)");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sn.x, yy, 28, 0, 6.28); ctx.fill();
      ctx.restore();
      ctx.strokeStyle = "rgba(255,206,84,0.9)"; ctx.lineWidth = 2.4; ctx.lineCap = "round";
      for (var r = 0; r < 8; r++) { var a = r / 8 * 6.28 + tNow * 0.7; ctx.beginPath(); ctx.moveTo(sn.x + Math.cos(a) * 13, yy + Math.sin(a) * 13); ctx.lineTo(sn.x + Math.cos(a) * 18.5, yy + Math.sin(a) * 18.5); ctx.stroke(); }
      ctx.fillStyle = "#ffd24a"; ctx.beginPath(); ctx.arc(sn.x, yy, 10, 0, 6.28); ctx.fill();
      ctx.fillStyle = "#fff2c0"; ctx.beginPath(); ctx.arc(sn.x - 2, yy - 2, 5, 0, 6.28); ctx.fill();
    }
  }

  function drawParticles() {
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i], a = clamp(1 - p.t / p.max, 0, 1);
      if (p.add) ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = a; ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, 6.28); ctx.fill();
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
    }
  }

  function drawBird() {
    // fever + speed trail
    ctx.save(); ctx.globalCompositeOperation = "lighter";
    for (var i = 0; i < trail.length; i++) {
      var tp = trail[i], a = (1 - tp.t / 0.5) * 0.3 * (i / trail.length);
      ctx.fillStyle = feverGlow > 0.4 ? "rgba(255,190,90," + a + ")" : "rgba(255,255,255," + a * 0.7 + ")";
      ctx.beginPath(); ctx.arc(tp.x, tp.y, R * 0.5 * (i / trail.length + 0.3), 0, 6.28); ctx.fill();
    }
    if (feverGlow > 0.05) { var gl = ctx.createRadialGradient(bird.x, bird.y, 0, bird.x, bird.y, R * 4 * feverGlow); gl.addColorStop(0, "rgba(255,200,90," + (0.5 * feverGlow) + ")"); gl.addColorStop(1, "rgba(255,150,60,0)"); ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(bird.x, bird.y, R * 4 * feverGlow, 0, 6.28); ctx.fill(); }
    ctx.restore();

    var swim = bird.grounded && !dead && waterAt(bird.x);           // paddling across a water gap
    ctx.save(); ctx.translate(bird.x, bird.y);
    if (swim) { ctx.translate(0, R * 0.55 + Math.sin(tNow * 5) * 1.6); ctx.rotate(Math.sin(tNow * 4.2) * 0.07); }   // settle in, bob & rock
    ctx.rotate((swim ? 0 : bird.rot * 0.5) + (expr.kind === "spin" ? -spinP * 6.283 : 0));   // occasional backflip
    var sq = bird.sq, w = R * (2 - sq), h = R * sq;
    var effort = isEffortKind(expr.kind);
    var happy = expr.kind === "whee" || dead;                       // dead = the sunset nap → sweet closed eyes
    var diving = holding && !bird.grounded;
    if (effort) ctx.rotate(0.09 + Math.sin(tNow * 26) * 0.02);      // straining lean + tremble
    var outline = "rgba(12,72,68,0.35)", ow = Math.max(1.2, R * 0.09);
    // tail feathers (echo the crest)
    var tcols = ["#1d9c91", "#ff8a63", "#25b0a6"];
    for (var q = 0; q < 3; q++) {
      ctx.save(); ctx.translate(-w * 0.86, -h * 0.06); ctx.rotate(-0.5 + q * 0.32 + Math.sin(wingT * 0.5 + q) * 0.05);
      ctx.fillStyle = tcols[q]; ctx.beginPath(); ctx.ellipse(-w * 0.2, 0, w * 0.24, h * 0.11, 0, 0, 6.28); ctx.fill();
      ctx.restore();
    }
    // body (soft top-lit gradient + storybook outline)
    var bgr = ctx.createLinearGradient(0, -h, 0, h);
    bgr.addColorStop(0, "#3cc9bd"); bgr.addColorStop(0.6, "#25b0a6"); bgr.addColorStop(1, "#1a9187");
    ctx.fillStyle = bgr; ctx.beginPath(); ctx.ellipse(0, 0, w, h, 0, 0, 6.28); ctx.fill();
    ctx.strokeStyle = outline; ctx.lineWidth = ow; ctx.stroke();
    // belly
    ctx.fillStyle = "#fff3df"; ctx.beginPath(); ctx.ellipse(w * 0.16, h * 0.34, w * 0.56, h * 0.46, -0.08, 0, 6.28); ctx.fill();
    // crest feathers
    ctx.fillStyle = "#ff7a59";
    for (var k = -1; k <= 1; k++) { ctx.save(); ctx.translate(-w * 0.2 + k * w * 0.16, -h * 0.9); ctx.rotate(-0.5 + k * 0.4); ctx.beginPath(); ctx.ellipse(0, -h * 0.25, w * 0.1, h * 0.4, 0, 0, 6.28); ctx.fill(); ctx.restore(); }
    // tiny wing (the joke of the species) — lazy bob grounded, flutters in the air, tucks on a dive, paddles in water
    var flap = swim ? Math.sin(wingT) * 0.75 + 0.15 : Math.sin(wingT) * (bird.grounded ? 0.2 : 0.55) - (diving ? 0.6 : 0.1);
    ctx.save(); ctx.translate(-w * 0.14, -h * 0.02); ctx.rotate(-flap);
    var wgr = ctx.createLinearGradient(0, 0, -w * 0.6, 0); wgr.addColorStop(0, "#1d9c91"); wgr.addColorStop(1, "#14837a");
    ctx.fillStyle = wgr; ctx.beginPath(); ctx.ellipse(-w * 0.26, h * 0.04, w * 0.32, h * 0.2, 0.22, 0, 6.28); ctx.fill();
    ctx.strokeStyle = "rgba(12,72,68,0.3)"; ctx.lineWidth = Math.max(1, R * 0.07); ctx.stroke();
    ctx.restore();
    // two-tone beak — opens for a "whee", a steam-puff grunt, or gritted strain
    var open = expr.kind === "whee" ? 0.3 : (expr.kind === "puff" || expr.kind === "grit") ? 0.16 : 0;
    ctx.save(); ctx.translate(w * 0.7, h * 0.02);
    ctx.fillStyle = "#ffb03a"; ctx.save(); ctx.rotate(-open);
    ctx.beginPath(); ctx.moveTo(0, -h * 0.13); ctx.lineTo(w * 0.56, -h * 0.02); ctx.lineTo(0, h * 0.03); ctx.closePath(); ctx.fill(); ctx.restore();
    ctx.fillStyle = "#ef9426"; ctx.save(); ctx.rotate(open * 1.5);
    ctx.beginPath(); ctx.moveTo(0, -h * 0.01); ctx.lineTo(w * 0.48, h * 0.07); ctx.lineTo(0, h * 0.17); ctx.closePath(); ctx.fill(); ctx.restore();
    ctx.restore();
    // face
    var ex = w * 0.36, ey = -h * 0.24;
    ctx.lineCap = "round";
    if (happy) {                                   // ^ closed happy / sleeping eye
      ctx.strokeStyle = "#1e1d19"; ctx.lineWidth = h * 0.1;
      ctx.beginPath(); ctx.arc(ex, ey + h * 0.12, h * 0.24, Math.PI * 1.12, Math.PI * 1.88); ctx.stroke();
    } else if (effort) {                           // > scrunched-shut strain + furrowed brow
      ctx.strokeStyle = "#1e1d19"; ctx.lineWidth = h * 0.09;
      ctx.beginPath(); ctx.moveTo(ex - h * 0.2, ey - h * 0.12); ctx.lineTo(ex + h * 0.14, ey + h * 0.02);
      ctx.moveTo(ex - h * 0.2, ey + h * 0.16); ctx.lineTo(ex + h * 0.14, ey + h * 0.02); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(ex - h * 0.32, ey - h * 0.34); ctx.lineTo(ex + h * 0.14, ey - h * 0.22); ctx.stroke();
    } else {                                       // big sparkly eye (pupil leads where it's looking)
      ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(ex, ey, h * 0.38, 0, 6.28); ctx.fill();
      ctx.strokeStyle = "rgba(12,72,68,0.25)"; ctx.lineWidth = Math.max(1, R * 0.05); ctx.stroke();
      var px = ex + h * 0.1, py = ey, pr = diving ? h * 0.17 : h * 0.21;
      if (expr.kind === "gaze") { px += h * 0.04; py += h * 0.13; }                 // peering down at the world
      else if (!bird.grounded && bird.vy < -60) py -= h * 0.07;                     // looking up on the rise
      ctx.fillStyle = "#25241f"; ctx.beginPath(); ctx.arc(px, py, pr, 0, 6.28); ctx.fill();
      ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(px + pr * 0.35, py - pr * 0.42, pr * 0.36, 0, 6.28); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.8)"; ctx.beginPath(); ctx.arc(px - pr * 0.32, py + pr * 0.35, pr * 0.16, 0, 6.28); ctx.fill();
      if (diving || swim) { ctx.strokeStyle = "#1e1d19"; ctx.lineWidth = h * 0.08; ctx.beginPath(); ctx.moveTo(ex - h * 0.3, ey - h * 0.4); ctx.lineTo(ex + h * 0.18, ey - h * 0.32); ctx.stroke(); }   // determined brow
    }
    // rosy cheek (flushes deeper under strain)
    ctx.fillStyle = effort ? "rgba(255,105,85,0.65)" : "rgba(255,140,120,0.45)";
    ctx.beginPath(); ctx.ellipse(w * 0.3, h * 0.2, h * 0.18, h * 0.13, 0, 0, 6.28); ctx.fill();
    ctx.restore();
    // half-submerged: a local water strip over the bird's lower body (edge-faded so it blends seamlessly),
    // CLAMPED to the actual water span so it never paints over the neighboring island's slopes
    if (swim) {
      var ci = Math.floor(bird.x / SEG_W), cl = ci, cr = ci, lim = 80;
      while (gW[cl - 1] === 1 && lim-- > 0) cl--;
      lim = 80; while (gW[cr + 1] === 1 && lim-- > 0) cr++;
      var wx0 = Math.max(bird.x - R * 2.6, cl * SEG_W + 1);
      var wx1 = Math.min(bird.x + R * 2.6, (cr + 1) * SEG_W - 1);
      if (wx1 > wx0 + 4) {
        var wl = WATER_Y + Math.sin(tNow * 5) * 1.4;
        var wc2 = lerp3(lerp3([90, 175, 214], [70, 90, 150], dayPhase), [255, 255, 255], 0.26);
        var wg = ctx.createLinearGradient(wx0, 0, wx1, 0);
        var wcs = (wc2[0] | 0) + "," + (wc2[1] | 0) + "," + (wc2[2] | 0);
        wg.addColorStop(0, "rgba(" + wcs + ",0)"); wg.addColorStop(0.28, "rgba(" + wcs + ",0.9)");
        wg.addColorStop(0.72, "rgba(" + wcs + ",0.9)"); wg.addColorStop(1, "rgba(" + wcs + ",0)");
        ctx.fillStyle = wg; ctx.fillRect(wx0, wl, wx1 - wx0, R * 1.5);
        // bobbing foam collar at the waterline (clipped to the same span)
        ctx.save(); ctx.beginPath(); ctx.rect(wx0, wl - 6, wx1 - wx0, R * 1.8); ctx.clip();
        ctx.fillStyle = "rgba(255,255,255,0.55)";
        ctx.beginPath(); ctx.ellipse(bird.x - R * 0.1, wl + 1.5, R * 1.55, 3.4, 0, 0, 6.28); ctx.fill();
        ctx.restore();
      }
    }
  }

  // dusk grade: eased via visGrade so sunset pushbacks (fever perfects / sun pips) GLIDE the veil
  // instead of snapping it — a snapping full-screen tint read as a "scrim toggling off" on perfects.
  // Warmer + gentler so it feels like evening light, not a modal overlay.
  function drawGrade() {
    if (visGrade < 0.01) return;
    var t = visGrade;
    ctx.save(); ctx.globalCompositeOperation = "multiply";
    ctx.fillStyle = "rgba(" + ((132 - t * 48) | 0) + "," + ((98 - t * 44) | 0) + "," + ((132 - t * 38) | 0) + "," + (t * 0.24).toFixed(3) + ")";
    ctx.fillRect(0, 0, W, H); ctx.restore();
  }
  // popup text is pre-rendered ONCE per (text, size) to an offscreen sprite — Safari rasterizes
  // shadowBlur'd strokeText on the CPU every frame, which visibly dropped mobile frame rate
  var popCache = {}, popCacheN = 0;
  function popSprite(txt, big) {
    var key = (big ? "B:" : "s:") + txt;
    var spr = popCache[key];
    if (spr) return spr;
    if (popCacheN > 40) { popCache = {}; popCacheN = 0; }   // safety cap (chain counts are open-ended)
    var base = big ? 48 : 33, pad = 20;
    var c = document.createElement("canvas");
    var FONT = "800 " + base + "px 'Baloo 2', Archivo, system-ui, -apple-system, 'Segoe UI', sans-serif";
    var t = c.getContext("2d");
    t.font = FONT;
    var wpx = Math.ceil(t.measureText(txt).width) + pad * 2, hpx = base + pad * 2;
    c.width = wpx * 2; c.height = hpx * 2;                  // 2× for crispness on high-DPI
    t = c.getContext("2d"); t.scale(2, 2);
    t.textAlign = "center"; t.textBaseline = "middle"; t.font = FONT;
    t.lineJoin = "round"; t.lineWidth = Math.max(2.5, base * 0.10);
    t.strokeStyle = "rgba(94,52,22,0.45)";
    t.shadowColor = "rgba(60,30,10,0.28)"; t.shadowBlur = 8; t.shadowOffsetY = 2;
    t.fillStyle = big ? "#ffd45a" : "#fff3c8";
    t.strokeText(txt, wpx / 2, hpx / 2);
    t.shadowColor = "transparent";
    t.fillText(txt, wpx / 2, hpx / 2);
    spr = { cv: c, w: wpx, h: hpx };
    popCache[key] = spr; popCacheN++;
    return spr;
  }
  function drawPops() {
    for (var i = 0; i < pops.length; i++) {
      var p = pops[i], f = p.t / p.max;
      var a = f < 0.14 ? f / 0.14 : clamp(1 - (f - 0.14) / 0.86, 0, 1);   // quick fade-in, slow fade-out
      var pop = f < 0.2 ? 0.55 + 0.45 * (f / 0.2) : 1;                    // little scale-in bounce
      var spr = popSprite(p.txt, p.big);
      ctx.globalAlpha = a;
      ctx.drawImage(spr.cv, p.sx - spr.w * pop / 2, p.sy - spr.h * pop / 2, spr.w * pop, spr.h * pop);
    }
    ctx.globalAlpha = 1;
  }

  // ---- flow ----
  function resetRun() {
    initTerrain();
    bird.x = 80; bird.grounded = true; bird.s = 260; bird.vx = 260; bird.vy = 0;
    bird.y = groundY(bird.x) - R; bird.rot = 0; bird.sq = 1;
    camX = bird.x; camY = bird.y; zoom = 0.9;
    sunT = SUN_TIMER; dayPhase = 0; visGrade = 0; chain = 0; fever = false; feverGlow = 0; bonus = 0; score = 0;
    canScore = false; wasWater = false; slideT = 0; slideHoldT = 0; expr.kind = ""; exprCool = 0; spinP = 0; trail = []; parts = []; pops = []; shake = 0; hitStop = 0; dead = false;
    intro = null; nestX = bird.x;
    scoreEl.textContent = "0";
  }
  // ---- fullscreen on landscape phones: lose the browser chrome (iOS 16.4+ supports the API) ----
  // One polite attempt per orientation stint — if the player exits fullscreen, don't nag until they rotate.
  var fsTried = false;
  function maybeFullscreen() {
    if (fsTried || W <= H || !(navigator.maxTouchPoints > 0)) return;
    if (document.fullscreenElement || document.webkitFullscreenElement) return;
    var d = document.documentElement;
    var fn = d.requestFullscreen || d.webkitRequestFullscreen;
    if (!fn) return;
    fsTried = true;
    try { var r = fn.call(d, { navigationUI: "hide" }); if (r && r.catch) r.catch(function () {}); } catch (e) {}
  }

  function startGame() {
    overlay.classList.add("is-hidden"); setTimeout(function () { overlay.hidden = true; }, 240);
    started = true; dead = false;
    running = false; intro = { t: 0 };   // nest countdown: 3-2-1 → hop out → run begins
    hintEl.classList.remove("is-gone"); setTimeout(function () { hintEl.classList.add("is-gone"); }, 6500);
    unlock(); startMusic(); maybeFullscreen();
  }
  function endRun() {
    if (dead) return; dead = true; running = false; holding = false; stopMusic();
    var isBest = score > best;
    if (isBest) { best = score; try { localStorage.setItem(bestKey(), String(best)); } catch (e) {} bestEl.textContent = "Best " + best; burstConfetti(); }
    window.OPT_SHARE_TEXT = "I glided " + score + " on today's hills in Puffling before the sun set. Can you beat it? 🐦";
    sndLull();
    var finalScore = score;   // freeze NOW — a quick restart resets the global before the timeout fires
    setTimeout(function () {
      if (!dead) return;      // player already flew again — don't pop a stale overlay over the new run
      ovTitle.textContent = isBest ? "New best!" : "The sun set.";
      ovText.innerHTML = "You glided <span class='stat'>" + finalScore + "</span>" + (isBest ? ", a new best for today!" : ".") + " The puffling is having a nap." + (best > 0 ? " <span class='stat'>Best " + best + "</span>." : "");
      ovBtn.textContent = "Fly again";
      overlay.hidden = false; overlay.classList.remove("is-hidden");
    }, 900);
  }
  function advance() { if (dead) { resetRun(); startGame(); return; } if (!started) { resetRun(); startGame(); return; } }
  ovBtn.addEventListener("click", advance);

  function burstConfetti() {
    var cs = ["#ffcf5a", "#ff8a3c", "#8ff0ff", "#7dffb0", "#ff6f91", "#b48bff"];
    for (var i = 0; i < 90; i++) parts.push({ x: bird.x + (Math.random() * 2 - 1) * W * 0.2 / zoom, y: bird.y - H * 0.4 / zoom, vx: (Math.random() * 2 - 1) * 220, vy: 80 + Math.random() * 240, t: 0, max: 1.6, g: 260, size: 3 + Math.random() * 3, color: cs[(Math.random() * cs.length) | 0] });
  }

  // ---- input ----
  function down() {
    maybeFullscreen();   // rotating to landscape mid-game: the next touch is the gesture that hides the chrome
    if (!started) { advance(); return; }
    if (dead) { if (!overlay.hidden) advance(); return; }   // let the nap beat land; restart once the card is up
    holding = true;
  }
  function up() { holding = false; }
  canvas.addEventListener("pointerdown", function (e) { e.preventDefault(); unlock(); down(); });
  window.addEventListener("pointerup", function () { up(); });
  window.addEventListener("pointercancel", function () { up(); });
  window.addEventListener("keydown", function (e) { if (e.code === "Space" || e.code === "ArrowDown") { e.preventDefault(); unlock(); if (!started || dead) { if (!started || !overlay.hidden) advance(); } else holding = true; } });
  window.addEventListener("keyup", function (e) { if (e.code === "Space" || e.code === "ArrowDown") holding = false; });
  soundBtn.addEventListener("click", function () { soundOn = !soundOn; soundBtn.setAttribute("aria-pressed", soundOn ? "true" : "false"); if (masterG) masterG.gain.value = soundOn ? 0.9 : 0; unlock(); });

  // ============================ AUDIO ============================
  var actx = null, masterG = null, wet = null, musicG = null, sfxG = null, windG = null, windF = null;
  var musicOn = false, schedT = 0, beat = 0, chordI = 0, melI = 4;
  var ROOT = 55; // G2
  var CHORDS = [[0, 4, 7], [7, 11, 14], [9, 12, 16], [5, 9, 12]]; // I – V – vi – IV (consonant)
  var PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19];                     // G major pentatonic
  function initAudio() {
    if (actx) return;
    try {
      actx = new (window.AudioContext || window.webkitAudioContext)();
      masterG = actx.createGain(); masterG.gain.value = soundOn ? 0.9 : 0;
      var comp = actx.createDynamicsCompressor(); comp.threshold.value = -12; comp.ratio.value = 4;
      masterG.connect(comp); comp.connect(actx.destination);
      wet = actx.createGain(); wet.gain.value = 0.3; var cv = actx.createConvolver(); cv.buffer = makeImpulse(2.4, 3); wet.connect(cv); cv.connect(masterG);
      musicG = actx.createGain(); musicG.gain.value = 0.58; musicG.connect(masterG); musicG.connect(wet);
      sfxG = actx.createGain(); sfxG.gain.value = 0.9; sfxG.connect(masterG); sfxG.connect(wet);
      // flight rush bed — BROWN noise (deep soft rush, no hiss) through a gently-resonant lowpass, LFO-swept
      var ns = actx.createBufferSource(); ns.buffer = brownBuf(3); ns.loop = true;
      windF = actx.createBiquadFilter(); windF.type = "lowpass"; windF.frequency.value = 300; windF.Q.value = 2.4;
      var wlfo = actx.createOscillator(); wlfo.type = "sine"; wlfo.frequency.value = 0.5;
      var wlfoG = actx.createGain(); wlfoG.gain.value = 110; wlfo.connect(wlfoG); wlfoG.connect(windF.frequency); wlfo.start();
      windG = actx.createGain(); windG.gain.value = 0;
      ns.connect(windF); windF.connect(windG); windG.connect(masterG); windG.connect(wet); ns.start();
    } catch (e) { actx = null; }
  }
  function makeImpulse(d, dec) { var n = actx.sampleRate * d | 0, b = actx.createBuffer(2, n, actx.sampleRate); for (var c = 0; c < 2; c++) { var ch = b.getChannelData(c); for (var i = 0; i < n; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, dec); } return b; }
  function noiseBuf(d) { var n = actx.sampleRate * d | 0, b = actx.createBuffer(1, n, actx.sampleRate), ch = b.getChannelData(0); for (var i = 0; i < n; i++)ch[i] = Math.random() * 2 - 1; return b; }
  function brownBuf(d) { var n = actx.sampleRate * d | 0, b = actx.createBuffer(1, n, actx.sampleRate), ch = b.getChannelData(0), last = 0; for (var i = 0; i < n; i++) { var w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; ch[i] = last * 3.6; } return b; }   // soft low rush, no hiss
  function unlock() { initAudio(); if (actx && actx.state === "suspended") actx.resume(); if (actx) { var b = actx.createBuffer(1, 1, 22050), s = actx.createBufferSource(); s.buffer = b; s.connect(actx.destination); s.start(0); } }
  function startMusic() { musicOn = true; schedT = actx ? actx.currentTime + 0.1 : 0; beat = 0; }
  function stopMusic() { musicOn = false; }
  function midi(m) { return 440 * Math.pow(2, (m - 69) / 12); }

  function audioTick() {
    if (!actx || !musicOn) return;
    if (windG) {
      var air = bird.grounded ? bird.s : Math.hypot(bird.vx, bird.vy);
      var spn = clamp(air / 1100, 0, 1);
      // the slide/carve is the PRESENT sound on the ground; it drops away in the air (flight = serene lift)
      windG.gain.setTargetAtTime(bird.grounded ? (0.05 + 0.14 * spn) : 0.018 * spn, actx.currentTime, 0.08);
      windF.frequency.setTargetAtTime(210 + spn * 560, actx.currentTime, 0.1);
    }
    var spb = 60 / 100;                          // 100 bpm, quarter-note beats (4/4)
    while (schedT < actx.currentTime + 0.24) {
      var b = beat % 4;
      var chord = CHORDS[chordI % CHORDS.length];
      if (b === 0) { pluckChord(chord, schedT, 1); bass(ROOT + chord[0], schedT); }
      else if (b === 2) { pluckChord(chord, schedT, 0.6); }
      // sparse, tuneful melody: gentle stepwise walk drifting along a slow contour
      var pr = b === 0 ? 0.78 : b === 2 ? 0.55 : 0.2;
      if (Math.random() < pr * (fever ? 1.2 : 1)) {
        var contour = 4 + Math.round(2.4 * Math.sin(tNow * 0.1 + 1));
        var step = contour > melI ? 1 : contour < melI ? -1 : 0;
        if (Math.random() < 0.4) step += (Math.random() < 0.5 ? -1 : 1);
        melI = Math.max(1, Math.min(PENTA.length - 2, melI + step));
        bell(ROOT + 12 + PENTA[melI], schedT, 0.5 + (fever ? 0.25 : 0));
      }
      schedT += spb; beat++;
      if (beat % 4 === 0) chordI++;
    }
  }
  function pluckChord(chord, t, v) { for (var i = 0; i < chord.length; i++) pluck(ROOT + chord[i], t + i * 0.018, (0.5 - i * 0.08) * v); }
  function pluck(m, t, v) { if (!actx) return; var o = actx.createOscillator(); o.type = "triangle"; o.frequency.value = midi(m); var o2 = actx.createOscillator(); o2.type = "triangle"; o2.frequency.value = midi(m) * 1.003; var g = actx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.06 * v, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0004, t + 0.6); var lp = actx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.setValueAtTime(2600, t); lp.frequency.exponentialRampToValueAtTime(800, t + 0.5); o.connect(lp); o2.connect(lp); lp.connect(g); g.connect(musicG); o.start(t); o2.start(t); o.stop(t + 0.65); o2.stop(t + 0.65); }
  function bass(m, t) { if (!actx) return; var o = actx.createOscillator(); o.type = "sine"; o.frequency.value = midi(m - 24); var g = actx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.09, t + 0.03); g.gain.exponentialRampToValueAtTime(0.0004, t + 0.7); var lp = actx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 380; o.connect(lp); lp.connect(g); g.connect(musicG); o.start(t); o.stop(t + 0.75); }
  function bell(m, t, v) { if (!actx) return; var parts2 = [[1, 1], [2, 0.3], [3.01, 0.1]]; for (var i = 0; i < parts2.length; i++) { var o = actx.createOscillator(); o.type = "sine"; o.frequency.value = midi(m) * parts2[i][0]; var g = actx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.04 * v * parts2[i][1], t + 0.008); g.gain.exponentialRampToValueAtTime(0.0003, t + 0.75); var lp = actx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 3800; o.connect(lp); lp.connect(g); g.connect(musicG); g.connect(wet); o.start(t); o.stop(t + 0.8); } }
  function glock(m, t, v) { if (!actx) return; var parts2 = [[1, 1], [2, 0.34], [4, 0.1]]; for (var i = 0; i < parts2.length; i++) { var o = actx.createOscillator(); o.type = "sine"; o.frequency.value = midi(m) * parts2[i][0]; var g = actx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05 * v * parts2[i][1], t + 0.005); g.gain.exponentialRampToValueAtTime(0.0003, t + 0.8); o.connect(g); g.connect(sfxG); g.connect(wet); o.start(t); o.stop(t + 0.85); } }

  var slideBed = null, slideG = null;
  function sndSlide() { }
  function sndWhee() { if (!actx || !soundOn) return; var t = actx.currentTime; var o = actx.createOscillator(); o.type = "sine"; o.frequency.setValueAtTime(500, t); o.frequency.exponentialRampToValueAtTime(1200, t + 0.22); var g = actx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.08, t + 0.03); g.gain.exponentialRampToValueAtTime(0.0004, t + 0.3); o.connect(g); g.connect(sfxG); o.start(t); o.stop(t + 0.32); }
  function sndPerfect(n) { if (!actx || !soundOn) return; var deg = PENTA[Math.min(PENTA.length - 1, n + 1)]; glock(ROOT + 24 + deg, actx.currentTime, 0.9); }
  function sndSun() { if (!actx || !soundOn) return; var t = actx.currentTime; glock(ROOT + 24, t, 0.26); glock(ROOT + 28, t + 0.06, 0.2); }
  function sndGrunt() { if (!actx || !soundOn) return; var t = actx.currentTime; var f0 = 150 * (0.9 + Math.random() * 0.25); var o = actx.createOscillator(); o.type = "triangle"; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f0 * 0.58, t + 0.09); var fl = actx.createBiquadFilter(); fl.type = "lowpass"; fl.frequency.value = 480; var g = actx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.055, t + 0.015); g.gain.exponentialRampToValueAtTime(0.0003, t + 0.14); o.connect(fl); fl.connect(g); g.connect(sfxG); o.start(t); o.stop(t + 0.16); }
  function sndTick(n) { if (!actx || !soundOn) return; glock(ROOT + 12 + (3 - n) * 2, actx.currentTime, 0.28); }
  function sndPaddle() { if (!actx || !soundOn) return; var t = actx.currentTime; var s = actx.createBufferSource(); s.buffer = noiseBuf(0.08); var bp = actx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 850 + Math.random() * 500; bp.Q.value = 1.3; var g = actx.createGain(); g.gain.setValueAtTime(0.001, t); g.gain.exponentialRampToValueAtTime(0.032, t + 0.015); g.gain.exponentialRampToValueAtTime(0.0003, t + 0.09); s.connect(bp); bp.connect(g); g.connect(sfxG); s.start(t); s.stop(t + 0.1); }
  function sndFever() { if (!actx || !soundOn) return; var t = actx.currentTime;[0, 4, 7, 12].forEach(function (d, i) { glock(ROOT + 12 + d, t + i * 0.06, 0.8); }); }
  function sndThud() { if (!actx || !soundOn) return; var t = actx.currentTime; var o = actx.createOscillator(); o.type = "sine"; o.frequency.setValueAtTime(160, t); o.frequency.exponentialRampToValueAtTime(60, t + 0.18); var g = actx.createGain(); g.gain.setValueAtTime(0.001, t); g.gain.exponentialRampToValueAtTime(0.12, t + 0.01); g.gain.exponentialRampToValueAtTime(0.001, t + 0.24); o.connect(g); g.connect(sfxG); o.start(t); o.stop(t + 0.26); }
  function sndSplash() { if (!actx || !soundOn) return; var t = actx.currentTime; var s = actx.createBufferSource(); s.buffer = noiseBuf(0.3); var bp = actx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.setValueAtTime(1600, t); bp.frequency.exponentialRampToValueAtTime(500, t + 0.25); var g = actx.createGain(); g.gain.setValueAtTime(0.14, t); g.gain.exponentialRampToValueAtTime(0.0004, t + 0.3); s.connect(bp); bp.connect(g); g.connect(sfxG); g.connect(wet); s.start(t); s.stop(t + 0.32); }
  function sndLull() { if (!actx || !soundOn) return; var t = actx.currentTime;[0, 4, 7, 12, 7, 4].forEach(function (d, i) { glock(ROOT + 12 + d, t + i * 0.22, 0.7); }); }

  // ---- loop ----
  var last = 0;
  function frame(ts) {
    var dt = last ? Math.min((ts - last) / 1000, 0.05) : 0; last = ts;
    if (dt > 0) { update(dt); audioTick(); }
    render();
    requestAnimationFrame(frame);
  }

  window.addEventListener("resize", resize);
  buildGrain();
  resize();
  overlay.hidden = false;
  requestAnimationFrame(frame);
})();
