/* Steady Hand — thread the loop along the wire without touching it.
 *
 * The ring sits AROUND the wire and follows your finger exactly, which is what
 * the real fairground toy is: you are keeping the wire off the rim, not
 * steering a dot down a corridor. That framing also kills corner-cutting —
 * there is no way to skip across a U-bend, because the wire has to stay inside
 * the ring the whole way.
 *
 * One touch ends the run. Clear a wire and the next one is tighter.
 */
(function () {
  "use strict";

  var cv = document.getElementById("canvas");
  var ctx = cv.getContext("2d");

  var W = 0, H = 0, DPR = 1;
  var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }

  // ---------------------------------------------------------------- course

  var WIRE_R = 5;                 // half-thickness of the filament
  var wire = null;                // { pts, cum, len, ringR, startPt, endPt }
  var level = 1;

  function catmull(p0, p1, p2, p3, t) {
    var t2 = t * t, t3 = t2 * t;
    return {
      x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
      y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3)
    };
  }

  /* Difficulty comes from three dials at once: more bends, deeper bends, and a
   * smaller ring. Moving only one of them makes the curve either flat for ages
   * or brutal the moment it bites. */
  function courseFor(lv) {
    var pad = Math.min(W, H) * 0.13 + 30;
    var vertical = H > W * 1.15;
    var along = vertical ? H - pad * 2 : W - pad * 2;
    var across = (vertical ? W : H) - pad * 2;

    var bends = 3 + Math.min(9, lv);
    var amp = Math.min(0.46, 0.24 + lv * 0.028) * across;
    var ringR = Math.max(13, 29 - lv * 1.45);

    var ctrl = [], i;
    var prevSide = Math.random() < 0.5 ? 1 : -1;
    for (i = 0; i <= bends; i++) {
      var f = i / bends;
      var offs;
      if (i === 0 || i === bends) offs = 0;
      else {
        // alternate sides so the wire actually snakes instead of drifting
        prevSide = -prevSide;
        offs = prevSide * amp * (0.45 + Math.random() * 0.55);
      }
      var a = pad + along * f;
      var b = (vertical ? W : H) / 2 + offs;
      ctrl.push(vertical ? { x: b, y: a } : { x: a, y: b });
    }

    // duplicate the ends so the spline reaches them
    var g = [ctrl[0]].concat(ctrl, [ctrl[ctrl.length - 1]]);
    var pts = [];
    for (i = 0; i < g.length - 3; i++) {
      var steps = 26;
      for (var s = 0; s < steps; s++) {
        pts.push(catmull(g[i], g[i + 1], g[i + 2], g[i + 3], s / steps));
      }
    }
    pts.push(ctrl[ctrl.length - 1]);

    // arc-length table, so progress along the wire is measured not guessed
    var cum = [0];
    for (i = 1; i < pts.length; i++) {
      cum[i] = cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    }

    return {
      pts: pts, cum: cum, len: cum[cum.length - 1],
      ringR: ringR,
      startPt: pts[0], endPt: pts[pts.length - 1],
      vertical: vertical
    };
  }

  /* Nearest point on the wire, searched only NEAR where you already are.
   * A global search would snap the ring across the gap wherever the wire
   * doubles back on itself, which both teleports your progress and reads as
   * the game cheating. */
  function nearest(x, y, fromIdx, window_) {
    var lo = 0, hi = wire.pts.length - 1;
    if (fromIdx >= 0 && window_ > 0) {
      var target = wire.cum[fromIdx];
      while (lo < wire.pts.length - 1 && wire.cum[lo] < target - window_) lo++;
      hi = lo;
      while (hi < wire.pts.length - 1 && wire.cum[hi] < target + window_) hi++;
    }
    var bd = Infinity, bi = lo, bx = 0, by = 0;
    for (var i = lo; i < hi; i++) {
      var ax = wire.pts[i].x, ay = wire.pts[i].y;
      var dx = wire.pts[i + 1].x - ax, dy = wire.pts[i + 1].y - ay;
      var l2 = dx * dx + dy * dy;
      var t = l2 ? clamp(((x - ax) * dx + (y - ay) * dy) / l2, 0, 1) : 0;
      var px = ax + dx * t, py = ay + dy * t;
      var d = Math.hypot(x - px, y - py);
      if (d < bd) { bd = d; bi = i; bx = px; by = py; }
    }
    return { d: bd, i: bi, x: bx, y: by, s: wire.cum[bi] };
  }

  // ---------------------------------------------------------------- state

  var G = {
    mode: "intro",        // intro | ready | live | dead | cleared | over
    cleared: 0,
    best: 0,
    t0: 0, elapsed: 0,
    progress: 0, idx: 0,
    closest: Infinity,
    shake: 0, flash: 0, clearGlow: 0,
    ringX: 0, ringY: 0, hasPointer: false,
    deadAt: null, deadMsg: ""
  };

  var trail = [];
  var sparks = [];

  try { G.best = parseInt(localStorage.getItem("steady_best") || "0", 10) || 0; } catch (e) {}

  function clearanceOf() { return wire.ringR - WIRE_R; }

  function newCourse(lv) {
    wire = courseFor(lv);
    G.progress = 0; G.idx = 0; G.closest = Infinity;
    trail.length = 0;
    G.mode = "ready";
    G.ringX = wire.startPt.x; G.ringY = wire.startPt.y;
    updateHud();
  }

  function startRun() {
    G.cleared = 0; level = 1;
    newCourse(1);
    if (window.gtag) window.gtag("event", "toy_start", { toy_slug: "steady-hand" });
  }

  function beginLive() {
    G.mode = "live";
    G.t0 = performance.now();
    Audio2.start();
  }

  function fail(msg, x, y) {
    if (G.mode !== "live") return;
    G.mode = "over";
    G.deadAt = { x: x, y: y };
    G.deadMsg = msg;
    G.shake = 1; G.flash = 1;
    Audio2.buzz();
    for (var i = 0; i < 26; i++) {
      var a = Math.random() * Math.PI * 2, sp = 60 + Math.random() * 320;
      sparks.push({ x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, t: 0, life: 0.3 + Math.random() * 0.4 });
    }
    if (G.cleared > G.best) {
      G.best = G.cleared;
      try { localStorage.setItem("steady_best", String(G.best)); } catch (e) {}
    }
    if (window.gtag) window.gtag("event", "toy_score", { toy_slug: "steady-hand", value: G.cleared });
    if (G.cleared > 0) {
      window.OPT_SHARE_TEXT = "I cleared " + G.cleared + " wire" + (G.cleared === 1 ? "" : "s") + " on Steady Hand without a buzz. Steady enough to beat it?";
      window.OPT_SHARE_LINE = G.cleared + " wire" + (G.cleared === 1 ? "" : "s") + " cleared";
      window.OPT_SHARE_IMAGE = function () { return cv; };
    } else { window.OPT_SHARE_TEXT = window.OPT_SHARE_LINE = window.OPT_SHARE_IMAGE = null; }
    showOver();
  }

  function clearCourse() {
    G.cleared++;
    level++;
    G.clearGlow = 1;
    Audio2.ding();
    say("WIRE " + G.cleared + " CLEAR", 1100);
    if (G.cleared > G.best) {
      G.best = G.cleared;
      try { localStorage.setItem("steady_best", String(G.best)); } catch (e) {}
    }
    G.mode = "cleared";
    setTimeout(function () {
      if (G.mode !== "cleared") return;
      newCourse(level);
    }, 850);
    updateHud();
  }

  // ---------------------------------------------------------------- input

  var pointerDown = false, ptrId = null, touchOffset = 0;

  function localPt(e) {
    var r = cv.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top - touchOffset };
  }

  cv.addEventListener("pointerdown", function (e) {
    e.preventDefault();
    Audio2.init();
    if (G.mode === "intro" || G.mode === "over") return;
    // on touch the finger covers the ring, so lift it clear of the fingertip
    touchOffset = e.pointerType === "touch" ? 46 : 0;
    var p = localPt(e);
    ptrId = e.pointerId; pointerDown = true;
    G.hasPointer = true;
    G.ringX = p.x; G.ringY = p.y;
    cv.setPointerCapture(e.pointerId);

    if (G.mode === "ready") {
      // must start with the loop actually on the wire, at the start post
      var n = nearest(p.x, p.y, 0, wire.ringR * 6);
      var atStart = Math.hypot(p.x - wire.startPt.x, p.y - wire.startPt.y) < wire.ringR * 2.4;
      if (atStart && n.d <= clearanceOf()) beginLive();
    }
  }, { passive: false });

  cv.addEventListener("pointermove", function (e) {
    if (!pointerDown || e.pointerId !== ptrId) return;
    var p = localPt(e);
    G.ringX = p.x; G.ringY = p.y;
  });

  function letGo(e) {
    if (e && e.pointerId !== ptrId) return;
    pointerDown = false; ptrId = null;
    if (G.mode === "live") fail("you let go", G.ringX, G.ringY);
  }
  cv.addEventListener("pointerup", letGo);
  cv.addEventListener("pointercancel", letGo);

  // ---------------------------------------------------------------- update

  function update(dt) {
    G.shake = Math.max(0, G.shake - dt * 2.6);
    G.flash = Math.max(0, G.flash - dt * 2.4);
    G.clearGlow = Math.max(0, G.clearGlow - dt * 1.4);

    for (var i = sparks.length - 1; i >= 0; i--) {
      var s = sparks[i];
      s.t += dt; s.x += s.vx * dt; s.y += s.vy * dt;
      s.vy += 420 * dt; s.vx *= 0.96;
      if (s.t >= s.life) sparks.splice(i, 1);
    }

    if (G.mode !== "live") { Audio2.proximity(0); return; }

    G.elapsed = (performance.now() - G.t0) / 1000;

    var n = nearest(G.ringX, G.ringY, G.idx, Math.max(90, wire.ringR * 9));
    var clr = clearanceOf();

    if (n.d > clr) { fail("buzz", n.x, n.y); return; }

    G.idx = n.i;
    if (n.s > G.progress) G.progress = n.s;
    if (n.d < G.closest) G.closest = n.d;

    // how close to the rim, 0 safe .. 1 touching
    var danger = clamp(n.d / clr, 0, 1);
    Audio2.proximity(danger);

    if (!reduced) {
      trail.push({ x: G.ringX, y: G.ringY, t: 0 });
      if (trail.length > 44) trail.shift();
    }
    for (i = trail.length - 1; i >= 0; i--) {
      trail[i].t += dt;
      if (trail[i].t > 0.9) trail.splice(i, 1);
    }

    if (Math.hypot(G.ringX - wire.endPt.x, G.ringY - wire.endPt.y) < wire.ringR * 1.6 &&
        G.progress > wire.len * 0.88) {
      clearCourse();
    }
  }

  // ---------------------------------------------------------------- render

  function resize() {
    DPR = Math.min(2, window.devicePixelRatio || 1);
    W = window.innerWidth; H = window.innerHeight;
    cv.width = Math.floor(W * DPR); cv.height = Math.floor(H * DPR);
    cv.style.width = W + "px"; cv.style.height = H + "px";
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    if (wire) {
      var keep = G.mode;
      newCourse(level);
      if (keep === "live" || keep === "over") { G.mode = "ready"; }
    }
  }

  function drawWire() {
    var i, p;
    var n = G.mode === "live" ? nearest(G.ringX, G.ringY, G.idx, Math.max(90, wire.ringR * 9)) : null;
    var clr = clearanceOf();
    ctx.lineCap = "round"; ctx.lineJoin = "round";

    function pathFrom(a, b) {
      ctx.beginPath();
      ctx.moveTo(wire.pts[a].x, wire.pts[a].y);
      for (var k = a + 1; k <= b; k++) ctx.lineTo(wire.pts[k].x, wire.pts[k].y);
      ctx.stroke();
    }

    // where along the polyline you have got to
    var cut = 0;
    while (cut < wire.pts.length - 1 && wire.cum[cut] < G.progress) cut++;

    // --- wire still AHEAD of you: cool and dim, so it reads as "to do"
    if (cut < wire.pts.length - 1) {
      ctx.strokeStyle = "rgba(60, 150, 220, 0.07)";
      ctx.lineWidth = WIRE_R * 6;
      pathFrom(cut, wire.pts.length - 1);
      ctx.strokeStyle = "#3f7fb4";
      ctx.lineWidth = WIRE_R * 2;
      pathFrom(cut, wire.pts.length - 1);
    }

    /* --- wire BEHIND you: bright green and noticeably fatter. Telling done
     * from to-do at a glance is the whole point once the wire starts doubling
     * back on itself and you cannot tell which strand you are on. */
    if (cut > 0) {
      ctx.strokeStyle = "rgba(70, 255, 180, 0.16)";
      ctx.lineWidth = WIRE_R * 7;
      pathFrom(0, cut);
      ctx.strokeStyle = "rgba(120, 255, 195, 0.95)";
      ctx.lineWidth = WIRE_R * 2.5;
      pathFrom(0, cut);
    }

    // --- the section under the loop, heated by how near the rim is
    if (n) {
      for (i = Math.max(0, n.i - 26); i < Math.min(wire.pts.length - 1, n.i + 26); i++) {
        p = wire.pts[i];
        var dAlong = Math.abs(wire.cum[i] - n.s);
        var near = 1 - clamp(dAlong / 130, 0, 1);
        var heat = near * (1 - clamp(n.d / clr, 0, 1));
        if (heat < 0.02) continue;
        ctx.strokeStyle = "rgba(" + Math.round(150 + heat * 105) + "," +
                          Math.round(240 - heat * 120) + "," +
                          Math.round(255 - heat * 190) + "," + (0.35 + heat * 0.65) + ")";
        ctx.lineWidth = WIRE_R * 2 * (1 + heat * 0.6);
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(wire.pts[i + 1].x, wire.pts[i + 1].y);
        ctx.stroke();
      }
    }

    /* --- the BEAD: exactly where you are ON the wire. The loop shows where
     * your finger is; this shows the point that is actually being measured,
     * which is what you need when the wire runs close to itself. */
    if (n) {
      var pulse = 0.5 + 0.5 * Math.sin(perf / 180);
      var gg = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, 15);
      gg.addColorStop(0, "rgba(255, 255, 255, 0.85)");
      gg.addColorStop(0.4, "rgba(140, 255, 210, " + (0.4 + pulse * 0.2) + ")");
      gg.addColorStop(1, "rgba(140, 255, 210, 0)");
      ctx.fillStyle = gg;
      ctx.beginPath(); ctx.arc(n.x, n.y, 15, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.beginPath(); ctx.arc(n.x, n.y, 3.1, 0, Math.PI * 2); ctx.fill();

      // and a chevron a little further on, pointing the way you are heading
      var ahead = Math.min(wire.pts.length - 2, n.i + 30);
      var a1 = wire.pts[ahead], a2 = wire.pts[ahead + 1];
      var ang = Math.atan2(a2.y - a1.y, a2.x - a1.x);
      ctx.save();
      ctx.translate(a1.x, a1.y);
      ctx.rotate(ang);
      ctx.strokeStyle = "rgba(180, 255, 220, 0.5)";
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(-5, -6); ctx.lineTo(5, 0); ctx.lineTo(-5, 6);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawPosts() {
    var s = wire.startPt, e = wire.endPt;
    // start
    ctx.fillStyle = "rgba(80, 255, 170, 0.14)";
    ctx.beginPath(); ctx.arc(s.x, s.y, wire.ringR * 2.2, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "rgba(120, 255, 190, 0.9)";
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(s.x, s.y, wire.ringR * 1.5, 0, Math.PI * 2); ctx.stroke();
    // finish
    var g = 0.5 + 0.5 * Math.sin(perf / 300);
    ctx.fillStyle = "rgba(255, 200, 90, " + (0.10 + g * 0.10) + ")";
    ctx.beginPath(); ctx.arc(e.x, e.y, wire.ringR * 2.4, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "rgba(255, 214, 120, " + (0.7 + g * 0.3) + ")";
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(e.x, e.y, wire.ringR * 1.5, 0, Math.PI * 2); ctx.stroke();
  }

  function drawRing() {
    if (!G.hasPointer && G.mode !== "ready") return;
    var x = G.ringX, y = G.ringY, r = wire.ringR;
    var danger = 0;
    if (G.mode === "live") {
      var n = nearest(x, y, G.idx, Math.max(90, wire.ringR * 9));
      danger = clamp(n.d / clearanceOf(), 0, 1);
    }
    var hot = danger * danger;
    // halo
    var gg = ctx.createRadialGradient(x, y, r * 0.4, x, y, r * 2.1);
    gg.addColorStop(0, "rgba(" + Math.round(140 + hot * 115) + ", " + Math.round(220 - hot * 130) + ", 255, " + (0.16 + hot * 0.24) + ")");
    gg.addColorStop(1, "rgba(120, 200, 255, 0)");
    ctx.fillStyle = gg;
    ctx.beginPath(); ctx.arc(x, y, r * 2.1, 0, Math.PI * 2); ctx.fill();
    // the loop itself: brushed metal with a hot rim as it closes in
    ctx.strokeStyle = "rgba(20, 30, 50, 0.9)";
    ctx.lineWidth = 7;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = "rgb(" + Math.round(200 + hot * 55) + "," + Math.round(235 - hot * 120) + "," + Math.round(255 - hot * 180) + ")";
    ctx.lineWidth = 3.4;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,0.65)";
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(x, y, r - 2.4, -1.1, 0.7); ctx.stroke();
    // the stem you are "holding"
    ctx.strokeStyle = "rgba(180, 205, 240, 0.35)";
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(x, y + r); ctx.lineTo(x, y + r + 26); ctx.stroke();
  }

  var perf = 0;

  function render() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // room
    var bg = ctx.createRadialGradient(W / 2, H * 0.44, 10, W / 2, H * 0.5, Math.max(W, H) * 0.78);
    bg.addColorStop(0, "#0b1020");
    bg.addColorStop(0.6, "#06080f");
    bg.addColorStop(1, "#030408");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    if (G.shake > 0 && !reduced) {
      var s = G.shake * 13;
      ctx.translate((Math.random() - 0.5) * s, (Math.random() - 0.5) * s);
    }

    if (wire) {
      drawWire();
      drawPosts();

      // trail
      for (var i = 0; i < trail.length; i++) {
        var q = trail[i], f = 1 - q.t / 0.9;
        if (f <= 0) continue;
        ctx.fillStyle = "rgba(160, 225, 255," + (f * 0.16) + ")";
        ctx.beginPath(); ctx.arc(q.x, q.y, 2.4 * f, 0, Math.PI * 2); ctx.fill();
      }

      drawRing();
    }

    for (i = 0; i < sparks.length; i++) {
      var sp = sparks[i], sf = 1 - sp.t / sp.life;
      if (sf <= 0) continue;
      ctx.fillStyle = "rgba(255," + Math.round(120 + sf * 120) + ",90," + (sf * 0.9) + ")";
      ctx.beginPath(); ctx.arc(sp.x, sp.y, 2.6 * sf, 0, Math.PI * 2); ctx.fill();
    }

    ctx.restore();

    if (G.flash > 0.001) {
      ctx.fillStyle = "rgba(255, 60, 50," + (G.flash * 0.26) + ")";
      ctx.fillRect(0, 0, W, H);
    }
    if (G.clearGlow > 0.001) {
      ctx.fillStyle = "rgba(120, 255, 190," + (G.clearGlow * 0.14) + ")";
      ctx.fillRect(0, 0, W, H);
    }
  }

  // ---------------------------------------------------------------- audio

  var Audio2 = (function () {
    var ctx = null, out = null, comp = null, ready = false, on = true;
    var humOsc = null, humGain = null, humFilt = null;

    function init() {
      if (ready) return;
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      var b = ctx.createBuffer(1, 1, 22050), s = ctx.createBufferSource();
      s.buffer = b; s.connect(ctx.destination); s.start(0);

      out = ctx.createGain(); out.gain.value = on ? 1 : 0;
      comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14; comp.ratio.value = 3.5;
      out.connect(comp); comp.connect(ctx.destination);

      /* The proximity hum is the tell that makes the toy playable: it rises as
       * the rim closes on the wire, so you hear the danger before you see it. */
      humOsc = ctx.createOscillator();
      humOsc.type = "sawtooth";
      humOsc.frequency.value = 70;
      humFilt = ctx.createBiquadFilter();
      humFilt.type = "bandpass"; humFilt.frequency.value = 300; humFilt.Q.value = 3.5;
      humGain = ctx.createGain(); humGain.gain.value = 0;
      humOsc.connect(humFilt); humFilt.connect(humGain); humGain.connect(out);
      humOsc.start();
      ready = true;
    }

    function noiseBuf(ms) {
      var len = Math.max(1, Math.floor(ctx.sampleRate * ms / 1000));
      var b = ctx.createBuffer(1, len, ctx.sampleRate), d = b.getChannelData(0), i;
      for (i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      return b;
    }

    return {
      init: init,
      isReady: function () { return ready; },
      setOn: function (v) { on = v; if (out) out.gain.setTargetAtTime(v ? 1 : 0, ctx.currentTime, 0.01); },
      start: function () { init(); },
      // danger 0 = safe, 1 = about to touch
      proximity: function (d) {
        if (!ready) return;
        var t = ctx.currentTime;
        var lvl = d < 0.45 ? 0 : Math.pow((d - 0.45) / 0.55, 2);
        humGain.gain.setTargetAtTime(lvl * 0.34, t, 0.04);
        humFilt.frequency.setTargetAtTime(240 + lvl * 900, t, 0.05);
        humOsc.frequency.setTargetAtTime(64 + lvl * 46, t, 0.06);
      },
      /* A buzzer is an electromagnet slamming a contact open and shut a few
       * hundred times a second: a harsh PULSE TRAIN, not a tone. Modelled as a
       * heavily-clipped low saw plus interrupt noise through a resonant band. */
      buzz: function () {
        init(); if (!ready) return;
        var t = ctx.currentTime, dur = 0.5;
        var mix = ctx.createGain();
        mix.gain.setValueAtTime(0.0001, t);
        mix.gain.linearRampToValueAtTime(0.36, t + 0.004);
        mix.gain.setValueAtTime(0.36, t + dur - 0.09);
        mix.gain.exponentialRampToValueAtTime(0.0005, t + dur);

        var shaper = ctx.createWaveShaper();
        var curve = new Float32Array(1024);
        for (var i = 0; i < 1024; i++) {
          var x = (i / 1023) * 2 - 1;
          curve[i] = Math.tanh(x * 7);          // hard clip: all the harmonics
        }
        shaper.curve = curve;

        var o1 = ctx.createOscillator(); o1.type = "sawtooth"; o1.frequency.value = 118;
        var o2 = ctx.createOscillator(); o2.type = "square"; o2.frequency.value = 118 * 1.005;
        var bp = ctx.createBiquadFilter();
        bp.type = "bandpass"; bp.frequency.value = 1500; bp.Q.value = 1.4;
        o1.connect(shaper); o2.connect(shaper);
        shaper.connect(bp); bp.connect(mix);
        o1.start(t); o2.start(t); o1.stop(t + dur); o2.stop(t + dur);

        // contact chatter
        var n = ctx.createBufferSource(); n.buffer = noiseBuf(dur * 1000); n.loop = false;
        var nf = ctx.createBiquadFilter();
        nf.type = "bandpass"; nf.frequency.value = 2600; nf.Q.value = 0.9;
        var ng = ctx.createGain(); ng.gain.value = 0.3;
        n.connect(nf); nf.connect(ng); ng.connect(mix);
        n.start(t); n.stop(t + dur);

        mix.connect(out);
      },
      // the bell at the end of the wire
      ding: function () {
        init(); if (!ready) return;
        var t = ctx.currentTime;
        var ratios = [1, 2.76, 5.4, 8.93];       // struck tube
        var mix = ctx.createGain(); mix.gain.value = 0.19;
        for (var i = 0; i < ratios.length; i++) {
          var o = ctx.createOscillator(); o.type = "sine";
          o.frequency.value = 660 * ratios[i];
          var g = ctx.createGain();
          var d = 1.5 / (1 + i * 1.1);
          g.gain.setValueAtTime(0, t);
          g.gain.linearRampToValueAtTime(1 / (1 + i * 1.5), t + 0.003);
          g.gain.exponentialRampToValueAtTime(0.0005, t + d);
          o.connect(g); g.connect(mix);
          o.start(t); o.stop(t + d + 0.05);
        }
        var s2 = ctx.createBufferSource(); s2.buffer = noiseBuf(7);
        var sf = ctx.createBiquadFilter(); sf.type = "bandpass"; sf.frequency.value = 3000;
        var sg = ctx.createGain(); sg.gain.value = 0.35;
        s2.connect(sf); sf.connect(sg); sg.connect(mix);
        s2.start(t); s2.stop(t + 0.04);
        mix.connect(out);
      }
    };
  })();

  // ---------------------------------------------------------------- hud

  var elCleared = document.getElementById("cleared");
  var elTime = document.getElementById("time");
  var elBest = document.getElementById("best");
  var elAlong = document.getElementById("along");
  var elFill = document.getElementById("progFill");
  var elHud = document.getElementById("hud");
  var elMsg = document.getElementById("callout");
  var overlay = document.getElementById("overlay");
  var ovEyebrow = document.getElementById("ovEyebrow");
  var ovTitle = document.getElementById("ovTitle");
  var ovText = document.getElementById("ovText");
  var ovBtn = document.getElementById("ovBtn");

  function updateHud() {
    var pct = wire && wire.len ? clamp(G.progress / wire.len, 0, 1) : 0;
    if (elAlong) elAlong.textContent = Math.round(pct * 100) + "%";
    if (elFill) elFill.style.width = (pct * 100).toFixed(1) + "%";
    if (elCleared) elCleared.textContent = G.cleared;
    if (elBest) elBest.textContent = G.best || "—";
    if (elTime) elTime.textContent = G.mode === "live" ? G.elapsed.toFixed(1) : G.elapsed ? G.elapsed.toFixed(1) : "0.0";
  }

  function say(t, ms) {
    if (!elMsg) return;
    elMsg.textContent = t;
    elMsg.hidden = false;
    clearTimeout(say._t);
    say._t = setTimeout(function () { elMsg.hidden = true; }, ms || 1400);
  }

  function showOver() {
    if (!overlay) return;
    overlay.hidden = false;
    overlay.classList.remove("is-out");
    var n = G.cleared;
    ovEyebrow.textContent = G.deadMsg === "you let go" ? "You let go" : "You touched the wire";
    ovTitle.textContent = n + (n === 1 ? " wire" : " wires");
    ovText.innerHTML = n === 0
      ? "Not one. The loop has to stay clear of the wire the whole way."
      : "Cleared <b>" + n + "</b> before the buzz. Best so far <b>" + G.best + "</b>.";
    ovBtn.textContent = "Try again";
  }

  function hideOverlay() {
    if (overlay) overlay.classList.add("is-out");
    if (elHud) elHud.hidden = false;
    setTimeout(function () { if (overlay) overlay.hidden = true; }, 240);
  }

  if (ovBtn) ovBtn.addEventListener("click", function () {
    Audio2.init();
    hideOverlay();
    startRun();
    // the hint has done its job once you are playing
    var hintEl = document.getElementById("hint");
    if (hintEl) setTimeout(function () { hintEl.classList.add("is-gone"); }, 6000);
  });

  window.addEventListener("keydown", function (e) {
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      if (G.mode === "intro" || G.mode === "over") { Audio2.init(); hideOverlay(); startRun(); }
    }
  });

  var soundBtn = document.getElementById("soundBtn");
  var soundOn = true;
  try { if (localStorage.getItem("steady_sound") === "off") soundOn = false; } catch (e) {}
  function syncSound() {
    Audio2.setOn(soundOn);
    if (soundBtn) {
      soundBtn.setAttribute("aria-pressed", soundOn ? "true" : "false");
      soundBtn.textContent = soundOn ? "♪" : "♪̸";
    }
  }
  if (soundBtn) soundBtn.addEventListener("click", function () {
    soundOn = !soundOn;
    try { localStorage.setItem("steady_sound", soundOn ? "on" : "off"); } catch (e) {}
    Audio2.init(); syncSound();
  });

  // ---------------------------------------------------------------- loop

  var lastT = 0;
  function frame(ms) {
    if (!lastT) lastT = ms;
    var dt = Math.min(0.05, (ms - lastT) / 1000);
    lastT = ms; perf = ms;
    update(dt);
    render();
    updateHud();
    requestAnimationFrame(frame);
  }

  window.addEventListener("resize", resize);
  window.addEventListener("orientationchange", function () { setTimeout(resize, 120); });

  resize();
  newCourse(1);
  G.mode = "intro";
  syncSound();
  updateHud();
  requestAnimationFrame(frame);

  // headless verification handle
  window.__steady = {
    G: G, get wire() { return wire; },
    startRun: startRun, newCourse: newCourse,
    courseFor: courseFor, nearest: nearest,
    clearance: clearanceOf,
    setRing: function (x, y) { G.ringX = x; G.ringY = y; G.hasPointer = true; },
    forceLive: function () { pointerDown = true; beginLive(); },
    step: function (dt) { update(dt || 1 / 60); },
    level: function () { return level; }
  };
})();
