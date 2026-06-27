/* Aurora Drift — paint the northern lights.
 * Drag across the sky to summon shimmering vertical curtains; each "ray" sways
 * on a travelling wave and slowly fades. A faint aurora drifts on its own so
 * the sky is alive on arrival. Snowy peaks + starfield ground the scene.
 */
(function () {
  "use strict";

  var canvas = document.getElementById("canvas");
  var ctx = canvas.getContext("2d");
  var hintEl = document.querySelector(".hint");

  var W, H, DPR, GROUND;

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = W * DPR; canvas.height = H * DPR;
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    GROUND = H * 0.82;
    seedStars(); seedPeaks();
  }

  // ---- stars --------------------------------------------------------------
  var stars = [];
  function seedStars() {
    stars.length = 0;
    var n = Math.round(W * H / 6500);
    for (var i = 0; i < n; i++) {
      stars.push({ x: Math.random() * W, y: Math.random() * GROUND * 0.95, r: Math.random() * 1.2 + 0.3, tw: Math.random() * 6.28, sp: 0.5 + Math.random() * 1.6 });
    }
  }

  // ---- snowy peaks --------------------------------------------------------
  var peaks = [];
  function seedPeaks() {
    peaks.length = 0;
    // back range (slightly lifted) then a taller, darker front range, for depth
    var specs = [
      { base: GROUND - H * 0.02, amp: H * 0.2, n: 7, fill: "#0a1020", rim: "rgba(120,200,205,0.16)" },
      { base: GROUND + H * 0.1, amp: H * 0.34, n: 9, fill: "#02040a", rim: "rgba(110,185,195,0.12)" }
    ];
    for (var s = 0; s < specs.length; s++) {
      var sp = specs[s], pts = [];
      for (var i = 0; i <= sp.n; i++) {
        var jag = Math.abs(Math.sin(i * (2.0 + s) + s * 3.7)) * (0.45 + Math.random() * 0.55);
        pts.push({ x: (i / sp.n) * W, y: sp.base - jag * sp.amp });
      }
      peaks.push({ pts: pts, fill: sp.fill, rim: sp.rim });
    }
  }

  // ---- aurora rays --------------------------------------------------------
  var rays = [];
  var MAX_RAYS = 150;
  // hue picker: mostly green→teal, occasional violet curtain
  function pickHue() {
    var r = Math.random();
    if (r < 0.74) return 145 + Math.random() * 28;       // green → teal
    if (r < 0.92) return 173 + Math.random() * 16;       // teal → cyan
    return 278 + Math.random() * 22;                     // violet/magenta
  }
  function addRay(x, baseY, inten, h) {
    if (rays.length >= MAX_RAYS) rays.shift();
    rays.push({
      x: x, baseY: baseY,
      h: h || (H * (0.22 + Math.random() * 0.26)),
      w: 9 + Math.random() * 16,
      hue: pickHue(),
      inten: 0, maxInten: inten, peaked: false,
      grow: inten / (1.8 + Math.random() * 1.8),          // ease in over ~1.8–3.6s (proportional → no pop)
      fade: inten / (5 + Math.random() * 4),              // ease out over ~5–9s
      phase: Math.random() * 6.28, amp: 9 + Math.random() * 16, freq: 0.005 + Math.random() * 0.006,
      wob: 0.5 + Math.random() * 0.6
    });
  }

  function updateRays(dt) {
    var wind = Math.sin(nowish * 0.07) * 7 + 4;
    for (var i = rays.length - 1; i >= 0; i--) {
      var r = rays[i];
      if (!r.peaked) {
        r.inten += r.grow * dt;                            // ease in (never culled mid-fade-in)
        if (r.inten >= r.maxInten) { r.inten = r.maxInten; r.peaked = true; }
      } else {
        r.inten -= r.fade * dt;                            // ease out
        if (r.inten <= 0.01) { rays.splice(i, 1); continue; }
      }
      r.x += wind * dt * r.wob;
      if (r.x < -80) r.x += W + 160; else if (r.x > W + 80) r.x -= W + 160;
    }
  }

  function drawRay(r) {
    var t = nowish, topY = r.baseY - r.h, steps = 8;
    var sat = 78, alpha = r.inten;
    // curtain centre line follows a travelling wave
    function cx(y) { return r.x + Math.sin(t * 0.5 * r.wob + r.phase + y * r.freq) * r.amp; }
    ctx.beginPath();
    var i, y;
    for (i = 0; i <= steps; i++) { y = topY + (r.baseY - topY) * (i / steps); var c = cx(y); ctx.lineTo(c - r.w * (0.4 + 0.6 * i / steps), y); }
    for (i = steps; i >= 0; i--) { y = topY + (r.baseY - topY) * (i / steps); var c2 = cx(y); ctx.lineTo(c2 + r.w * (0.4 + 0.6 * i / steps), y); }
    ctx.closePath();
    // soft, draped curtain: faint at the top, brightest in the lower-mid, diffuse foot
    var g = ctx.createLinearGradient(0, topY, 0, r.baseY);
    g.addColorStop(0, "hsla(" + (r.hue + 40) + "," + sat + "%,58%,0)");
    g.addColorStop(0.45, "hsla(" + (r.hue + 22) + "," + sat + "%,54%," + (alpha * 0.2).toFixed(3) + ")");
    g.addColorStop(0.82, "hsla(" + r.hue + "," + sat + "%,52%," + (alpha * 0.42).toFixed(3) + ")");
    g.addColorStop(1, "hsla(" + (r.hue - 6) + "," + sat + "%,55%," + (alpha * 0.12).toFixed(3) + ")");
    ctx.fillStyle = g;
    ctx.fill();
  }

  // ---- scene --------------------------------------------------------------
  function drawScene() {
    var sky = ctx.createLinearGradient(0, 0, 0, GROUND);
    sky.addColorStop(0, "#05060f");
    sky.addColorStop(0.55, "#070c1e");
    sky.addColorStop(1, "#0a1326");
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);

    for (var i = 0; i < stars.length; i++) {
      var s = stars[i], a = 0.3 + Math.abs(Math.sin(nowish * s.sp + s.tw)) * 0.6;
      ctx.globalAlpha = a; ctx.fillStyle = "#dfe8ff";
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 6.28); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawPeaks() {
    for (var p = 0; p < peaks.length; p++) {           // back-to-front
      var pk = peaks[p];
      ctx.fillStyle = pk.fill;
      ctx.beginPath(); ctx.moveTo(0, H);
      ctx.lineTo(0, pk.pts[0].y);
      for (var i = 0; i < pk.pts.length; i++) ctx.lineTo(pk.pts[i].x, pk.pts[i].y);
      ctx.lineTo(W, H); ctx.closePath(); ctx.fill();
      // faint rim light catching the aurora glow along the ridgeline
      ctx.strokeStyle = pk.rim; ctx.lineWidth = 1.4;
      ctx.beginPath();
      for (i = 0; i < pk.pts.length; i++) { var pt = pk.pts[i]; if (i === 0) ctx.moveTo(pt.x, pt.y); else ctx.lineTo(pt.x, pt.y); }
      ctx.stroke();
    }
  }

  // ---- audio: soft ambient + sparse shimmer chimes while painting --------
  var actx = null, master = null, noiseBuf = null, padGain = null;
  function unlock() {
    if (actx) { if (actx.state === "suspended") actx.resume(); return; }
    try {
      actx = new (window.AudioContext || window.webkitAudioContext)();
      var b = actx.createBuffer(1, 1, 22050); var s = actx.createBufferSource(); s.buffer = b; s.connect(actx.destination); s.start(0);
      master = actx.createGain(); master.gain.value = 0.0001; master.connect(actx.destination);
      makeNoise(); startPad();
      master.gain.exponentialRampToValueAtTime(0.85, actx.currentTime + 4);
    } catch (e) { actx = null; }
  }
  function makeNoise() {
    var len = Math.floor(actx.sampleRate * 2.5);
    noiseBuf = actx.createBuffer(1, len, actx.sampleRate);
    var d = noiseBuf.getChannelData(0), last = 0;
    for (var i = 0; i < len; i++) { var wn = Math.random() * 2 - 1; last = (last + 0.02 * wn) / 1.02; d[i] = last * 3.2; }
  }
  function startPad() {
    // a very soft, slowly evolving consonant pad (low, calm — not a harsh drone)
    padGain = actx.createGain(); padGain.gain.value = 0.06; padGain.connect(master);
    var lp = actx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 600; lp.Q.value = 0.4; lp.connect(padGain);
    var freqs = [110, 164.81, 220, 246.94];               // A2 / E3 / A3 / B3 — open + airy
    for (var i = 0; i < freqs.length; i++) {
      var o = actx.createOscillator(); o.type = "sine"; o.frequency.value = freqs[i]; o.detune.value = (Math.random() - 0.5) * 8;
      var g = actx.createGain(); g.gain.value = 0.25;
      o.connect(g); g.connect(lp); o.start();
      var lfo = actx.createOscillator(); lfo.frequency.value = 0.03 + Math.random() * 0.05;
      var lg = actx.createGain(); lg.gain.value = 0.18;
      lfo.connect(lg); lg.connect(g.gain); lfo.start();
    }
    // breathy high air that opens up while painting
    var ns = actx.createBufferSource(); ns.buffer = noiseBuf; ns.loop = true;
    airBP = actx.createBiquadFilter(); airBP.type = "bandpass"; airBP.frequency.value = 2200; airBP.Q.value = 0.8;
    airGain = actx.createGain(); airGain.gain.value = 0.0001;
    ns.connect(airBP); airBP.connect(airGain); airGain.connect(master); ns.start();
  }
  var airGain = null, airBP = null;
  function paintAir(speed) {
    if (!actx) return;
    airGain.gain.setTargetAtTime(Math.min(0.05, speed * 0.0004), actx.currentTime, 0.12);
    airBP.frequency.setTargetAtTime(1600 + Math.min(2400, speed * 4), actx.currentTime, 0.15);
  }
  function airSilence() { if (actx) airGain.gain.setTargetAtTime(0.0001, actx.currentTime, 0.3); }
  // sparse high shimmer bell as colour appears
  var PENT = [659.25, 783.99, 880, 1046.5, 1318.5, 1567.98];
  var lastChime = -99;
  function shimmer() {
    if (!actx || nowish - lastChime < 0.5) return;
    lastChime = nowish;
    var t = actx.currentTime, f = PENT[(Math.random() * PENT.length) | 0];
    var o = actx.createOscillator(); o.type = "sine"; o.frequency.value = f;
    var g = actx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05, t + 0.05); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
    var lp = actx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 2400;
    o.connect(lp); lp.connect(g); g.connect(master); o.start(t); o.stop(t + 2.3);
  }

  // ---- interaction --------------------------------------------------------
  var down = false, lx = 0, ly = 0, lastT = 0;
  function paintAt(x, y, dense) {
    var n = dense ? 2 : 1;
    for (var k = 0; k < n; k++) addRay(x + (Math.random() - 0.5) * 40, y + (Math.random() - 0.5) * 26, 0.32 + Math.random() * 0.26);
  }
  function start(x, y) { unlock(); down = true; lx = x; ly = y; lastT = nowish; paintAt(x, y, true); shimmer(); if (hintEl) hintEl.classList.add("is-hidden"); }
  function move(x, y) {
    if (!down) return;
    var d = Math.hypot(x - lx, y - ly);
    if (d < 8) return;
    var dtm = Math.max(0.008, nowish - lastT); lastT = nowish;
    var speed = d / dtm;
    paintAt(x, y, d > 26);
    paintAir(speed);
    if (Math.random() < 0.3) shimmer();
    lx = x; ly = y;
  }
  function end() { down = false; airSilence(); }

  canvas.addEventListener("mousedown", function (e) { start(e.clientX, e.clientY); });
  window.addEventListener("mousemove", function (e) { if (e.buttons & 1) move(e.clientX, e.clientY); });
  window.addEventListener("mouseup", end);
  canvas.addEventListener("touchstart", function (e) { e.preventDefault(); var t = e.touches[0]; start(t.clientX, t.clientY); }, { passive: false });
  canvas.addEventListener("touchmove", function (e) { e.preventDefault(); var t = e.touches[0]; move(t.clientX, t.clientY); }, { passive: false });
  canvas.addEventListener("touchend", function (e) { e.preventDefault(); end(); }, { passive: false });

  // gentle self-running aurora so the sky is never empty
  var ambTimer = 0;
  function ambient(dt) {
    ambTimer -= dt;
    if (ambTimer <= 0) {
      var x = Math.random() * W, y = GROUND * (0.42 + Math.random() * 0.26);
      addRay(x, y, 0.08 + Math.random() * 0.12);
      ambTimer = 0.6 + Math.random() * 0.7;
    }
  }

  // ---- loop ---------------------------------------------------------------
  var lastTs = null, nowish = 0;
  function frame(ts) {
    var dt = lastTs !== null ? Math.min((ts - lastTs) / 1000, 0.05) : 0.016;
    lastTs = ts; nowish += dt;
    ambient(dt);
    drawScene();
    ctx.globalCompositeOperation = "lighter";
    for (var i = 0; i < rays.length; i++) drawRay(rays[i]);
    ctx.globalCompositeOperation = "source-over";
    updateRays(dt);
    drawPeaks();
    requestAnimationFrame(frame);
  }

  resize();
  window.addEventListener("resize", resize);
  // seed a gentle opening curtain across the sky
  for (var i = 0; i < 30; i++) { var fx = (i / 30) * W; addRay(fx, GROUND * 0.48 + Math.sin(i * 0.4) * H * 0.05, 0.16 + Math.random() * 0.18); }
  requestAnimationFrame(frame);
  setTimeout(function () { if (hintEl) hintEl.classList.add("is-hidden"); }, 9000);
})();
