/* Floating Lanterns — release glowing paper lanterns onto a night lake.
 * Tap the water (or anywhere) and a sky lantern rises from the waterline,
 * swaying and flickering as it drifts up into the stars, mirrored on the lake.
 */
(function () {
  "use strict";

  var canvas = document.getElementById("canvas");
  var ctx = canvas.getContext("2d");
  var hintEl = document.querySelector(".hint");

  var W, H, DPR, HY;                       // HY = horizon / waterline
  var moon;

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = W * DPR; canvas.height = H * DPR;
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    HY = H * 0.72;
    moon = { x: W * 0.76, y: H * 0.2, r: Math.max(34, Math.min(W, H) * 0.05) };
    seedStars(); seedHills();
  }

  // ---- stars --------------------------------------------------------------
  var stars = [];
  function seedStars() {
    stars.length = 0;
    var n = Math.round(W * HY / 5200);
    for (var i = 0; i < n; i++) {
      stars.push({
        x: Math.random() * W, y: Math.random() * HY * 0.98,
        r: Math.random() * 1.3 + 0.3,
        tw: Math.random() * Math.PI * 2, sp: 0.5 + Math.random() * 1.5,
        warm: Math.random() < 0.25
      });
    }
  }

  // ---- distant hills ------------------------------------------------------
  var hills = [];
  function seedHills() {
    hills.length = 0;
    // two layered silhouettes for depth
    for (var layer = 0; layer < 2; layer++) {
      var pts = [], n = 7 + layer * 3;
      var base = HY - (layer === 0 ? H * 0.04 : H * 0.085);
      var amp = (layer === 0 ? H * 0.05 : H * 0.09);
      for (var i = 0; i <= n; i++) {
        pts.push({ x: (i / n) * W, y: base - Math.abs(Math.sin(i * 1.7 + layer * 2.3)) * amp * (0.5 + Math.random() * 0.5) });
      }
      hills.push({ pts: pts, color: layer === 0 ? "#0a0f24" : "#0d1430" });
    }
  }

  // ---- lanterns -----------------------------------------------------------
  var lanterns = [];
  var WARM = [
    [255, 196, 92], [255, 168, 70], [255, 150, 96], [255, 210, 120], [255, 138, 80]
  ];
  function release(x, fromY, big) {
    if (lanterns.length > 46) lanterns.shift();
    var size = (big ? 26 : 18) + Math.random() * 12;
    lanterns.push({
      x: x, y: fromY != null ? fromY : HY - 4,
      vy: -(10 + Math.random() * 10),
      size: size,
      hue: WARM[(Math.random() * WARM.length) | 0],
      sway: Math.random() * Math.PI * 2, swaySp: 0.5 + Math.random() * 0.5, swayAmp: 10 + Math.random() * 16,
      flick: Math.random() * Math.PI * 2,
      born: nowish, drift: (Math.random() - 0.5) * 6
    });
  }

  function updateLanterns(dt) {
    var wind = Math.sin(nowish * 0.12) * 5;
    for (var i = lanterns.length - 1; i >= 0; i--) {
      var L = lanterns[i];
      L.sway += dt * L.swaySp;
      L.flick += dt * (6 + Math.random() * 4);
      // ease into a gentle rise, then keep drifting up and shrinking
      L.vy += (-16 - L.vy) * 0.4 * dt;
      L.y += L.vy * dt;
      L.x += (Math.cos(L.sway) * 0.4 + (wind + L.drift) * 0.06) * dt * 18;
      L.size *= (1 - 0.012 * dt);            // perspective shrink as it climbs
      if (L.y < -60 || L.size < 4) lanterns.splice(i, 1);
    }
  }

  function lanternBrightness(L) {
    return 0.82 + Math.sin(L.flick) * 0.07 + Math.sin(L.flick * 2.3) * 0.04;
  }

  // draw a sky lantern centered at (x,y); sx/sy let the reflection squash/flip
  function drawLantern(x, y, L, alpha, sy) {
    var s = L.size, c = L.hue, b = lanternBrightness(L) * alpha;
    var swayX = Math.sin(L.sway) * 0.12;     // subtle tilt
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1, sy || 1);
    ctx.transform(1, 0, swayX, 1, 0, 0);

    // warm halo
    ctx.globalCompositeOperation = "lighter";
    var halo = ctx.createRadialGradient(0, 0, s * 0.2, 0, 0, s * 2.6);
    halo.addColorStop(0, "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + (0.5 * b).toFixed(3) + ")");
    halo.addColorStop(0.4, "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + (0.16 * b).toFixed(3) + ")");
    halo.addColorStop(1, "rgba(" + c[0] + "," + c[1] + "," + c[2] + ",0)");
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(0, 0, s * 2.6, 0, Math.PI * 2); ctx.fill();

    // body (rounded paper capsule), lit from within
    ctx.globalCompositeOperation = "source-over";
    var w = s * 0.92, h = s * 1.22;
    var bg = ctx.createLinearGradient(0, -h, 0, h);
    bg.addColorStop(0, "rgba(" + lit(c, 1.25) + "," + (0.92 * b).toFixed(3) + ")");
    bg.addColorStop(0.5, "rgba(" + lit(c, 1.05) + "," + (0.96 * b).toFixed(3) + ")");
    bg.addColorStop(1, "rgba(" + lit(c, 0.7) + "," + (0.9 * b).toFixed(3) + ")");
    ctx.fillStyle = bg;
    capsule(0, 0, w, h);
    ctx.fill();

    // top cap + bottom ring (paper frame)
    ctx.globalAlpha = 0.5 * alpha;
    ctx.fillStyle = "rgba(90,40,20,0.9)";
    ctx.beginPath(); ctx.ellipse(0, -h * 0.92, w * 0.42, h * 0.1, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(0, h * 0.92, w * 0.5, h * 0.1, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;

    // bright flame core
    ctx.globalCompositeOperation = "lighter";
    var fl = ctx.createRadialGradient(0, h * 0.35, 0, 0, h * 0.35, s * 0.7);
    fl.addColorStop(0, "rgba(255,248,220," + (0.9 * b).toFixed(3) + ")");
    fl.addColorStop(1, "rgba(255,180,90,0)");
    ctx.fillStyle = fl;
    ctx.beginPath(); ctx.arc(0, h * 0.35, s * 0.7, 0, Math.PI * 2); ctx.fill();

    ctx.restore();
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
  }
  function capsule(cx, cy, w, h) {
    ctx.beginPath();
    ctx.moveTo(cx - w, cy - h * 0.55);
    ctx.quadraticCurveTo(cx - w, cy - h, cx, cy - h);          // top dome
    ctx.quadraticCurveTo(cx + w, cy - h, cx + w, cy - h * 0.55);
    ctx.quadraticCurveTo(cx + w * 1.04, cy, cx + w * 0.78, cy + h * 0.7);
    ctx.quadraticCurveTo(cx + w * 0.5, cy + h, cx, cy + h);     // tapered bottom
    ctx.quadraticCurveTo(cx - w * 0.5, cy + h, cx - w * 0.78, cy + h * 0.7);
    ctx.quadraticCurveTo(cx - w * 1.04, cy, cx - w, cy - h * 0.55);
    ctx.closePath();
  }
  function lit(c, f) {
    return [Math.min(255, c[0] * f | 0), Math.min(255, c[1] * f | 0), Math.min(255, c[2] * f | 0)].join(",");
  }

  // ---- scene --------------------------------------------------------------
  function drawScene() {
    // sky
    var sky = ctx.createLinearGradient(0, 0, 0, HY);
    sky.addColorStop(0, "#070a1e");
    sky.addColorStop(0.55, "#111738");
    sky.addColorStop(1, "#2a2350");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, HY + 2);
    // warm horizon glow
    var hg = ctx.createRadialGradient(W * 0.5, HY, 0, W * 0.5, HY, W * 0.7);
    hg.addColorStop(0, "rgba(120,70,90,0.34)");
    hg.addColorStop(1, "rgba(120,70,90,0)");
    ctx.fillStyle = hg; ctx.fillRect(0, HY - H * 0.3, W, H * 0.3);

    // stars
    for (var i = 0; i < stars.length; i++) {
      var st = stars[i];
      var a = 0.35 + Math.abs(Math.sin(nowish * st.sp + st.tw)) * 0.6;
      ctx.globalAlpha = a;
      ctx.fillStyle = st.warm ? "#ffe7c0" : "#dfe6ff";
      ctx.beginPath(); ctx.arc(st.x, st.y, st.r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;

    // moon + glow
    ctx.globalCompositeOperation = "lighter";
    var mg = ctx.createRadialGradient(moon.x, moon.y, 0, moon.x, moon.y, moon.r * 4.5);
    mg.addColorStop(0, "rgba(225,228,255,0.5)");
    mg.addColorStop(1, "rgba(225,228,255,0)");
    ctx.fillStyle = mg; ctx.beginPath(); ctx.arc(moon.x, moon.y, moon.r * 4.5, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = "source-over";
    var md = ctx.createRadialGradient(moon.x - moon.r * 0.3, moon.y - moon.r * 0.3, moon.r * 0.2, moon.x, moon.y, moon.r);
    md.addColorStop(0, "#fdfdff"); md.addColorStop(1, "#cdd2ec");
    ctx.fillStyle = md; ctx.beginPath(); ctx.arc(moon.x, moon.y, moon.r, 0, Math.PI * 2); ctx.fill();

    // hills
    for (var hI = hills.length - 1; hI >= 0; hI--) {
      var hl = hills[hI];
      ctx.fillStyle = hl.color;
      ctx.beginPath(); ctx.moveTo(0, HY);
      for (var p = 0; p < hl.pts.length; p++) ctx.lineTo(hl.pts[p].x, hl.pts[p].y);
      ctx.lineTo(W, HY); ctx.closePath(); ctx.fill();
    }

    // water
    var wat = ctx.createLinearGradient(0, HY, 0, H);
    wat.addColorStop(0, "#141a38");
    wat.addColorStop(0.5, "#0c1124");
    wat.addColorStop(1, "#070a16");
    ctx.fillStyle = wat; ctx.fillRect(0, HY, W, H - HY);

    // moon reflection: a soft shimmering path of overlapping ripple dashes
    ctx.globalCompositeOperation = "lighter";
    var seg = 34, span = H - HY;
    for (var r = 0; r < seg; r++) {
      var f = r / seg;
      var ry = HY + f * span;
      var wob = Math.sin(nowish * 1.6 + r * 0.6) * (3 + r * 0.9);
      var aw = (1 - f) * (1 - f) * 0.2 * (0.7 + Math.abs(Math.sin(nowish * 2 + r)) * 0.5);
      var ww = moon.r * (0.9 + f * 1.4);                 // widens with distance
      var grd = ctx.createLinearGradient(moon.x - ww / 2, 0, moon.x + ww / 2, 0);
      grd.addColorStop(0, "rgba(214,220,255,0)");
      grd.addColorStop(0.5, "rgba(220,224,255," + aw.toFixed(3) + ")");
      grd.addColorStop(1, "rgba(214,220,255,0)");
      ctx.fillStyle = grd;
      ctx.fillRect(moon.x - ww / 2 + wob, ry, ww, span / seg + 2.2);
    }
    ctx.globalCompositeOperation = "source-over";
  }

  function drawReflections() {
    ctx.save();
    ctx.beginPath(); ctx.rect(0, HY, W, H - HY); ctx.clip();   // keep reflections in the lake
    for (var i = 0; i < lanterns.length; i++) {
      var L = lanterns[i];
      var ry = HY + (HY - L.y);                                 // mirror across the waterline
      var depth = (L.y) / HY;                                   // higher lantern → fainter reflection
      var alpha = Math.max(0, 0.5 - depth * 0.42);
      if (alpha < 0.02) continue;
      var wob = Math.sin(nowish * 1.4 + i) * 3;
      drawLantern(L.x + wob, ry, L, alpha, -1.25);
    }
    ctx.restore();
  }

  // ---- audio --------------------------------------------------------------
  var actx = null, master = null, noiseBuf = null;
  function unlock() {
    if (actx) { if (actx.state === "suspended") actx.resume(); return; }
    try {
      actx = new (window.AudioContext || window.webkitAudioContext)();
      var b = actx.createBuffer(1, 1, 22050); var s = actx.createBufferSource(); s.buffer = b; s.connect(actx.destination); s.start(0);
      master = actx.createGain(); master.gain.value = 0.0001; master.connect(actx.destination);
      makeNoise(); startAmbient();
      master.gain.exponentialRampToValueAtTime(0.9, actx.currentTime + 3);
    } catch (e) { actx = null; }
  }
  function makeNoise() {
    var len = Math.floor(actx.sampleRate * 2.5);
    noiseBuf = actx.createBuffer(1, len, actx.sampleRate);
    var d = noiseBuf.getChannelData(0), last = 0;
    for (var i = 0; i < len; i++) { var wn = Math.random() * 2 - 1; last = (last + 0.02 * wn) / 1.02; d[i] = last * 3.2; }
  }
  function startAmbient() {
    // soft night wind: low brown noise with a slow swell
    var src = actx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    var lp = actx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 380; lp.Q.value = 0.4;
    var g = actx.createGain(); g.gain.value = 0.05;
    src.connect(lp); lp.connect(g); g.connect(master);
    var lfo = actx.createOscillator(); lfo.frequency.value = 0.06;
    var lg = actx.createGain(); lg.gain.value = 0.03;
    lfo.connect(lg); lg.connect(g.gain); lfo.start();
    src.start();
    // faint lake lapping: a second, lower, slower band
    var s2 = actx.createBufferSource(); s2.buffer = noiseBuf; s2.loop = true; s2.playbackRate.value = 0.6;
    var lp2 = actx.createBiquadFilter(); lp2.type = "lowpass"; lp2.frequency.value = 180;
    var g2 = actx.createGain(); g2.gain.value = 0.05;
    s2.connect(lp2); lp2.connect(g2); g2.connect(master);
    var lfo2 = actx.createOscillator(); lfo2.frequency.value = 0.09;
    var lg2 = actx.createGain(); lg2.gain.value = 0.03;
    lfo2.connect(lg2); lg2.connect(g2.gain); lfo2.start();
    s2.start();
  }
  // a soft airy whoosh + a warm pentatonic shimmer when a lantern lifts off
  var PENT = [392.0, 440.0, 523.25, 587.33, 659.25, 783.99];
  function chime() {
    if (!actx) return;
    var t = actx.currentTime;
    // airy paper "fwoom"
    if (noiseBuf) {
      var ns = actx.createBufferSource(); ns.buffer = noiseBuf; ns.playbackRate.value = 1.6;
      var bp = actx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.setValueAtTime(500, t); bp.frequency.exponentialRampToValueAtTime(1400, t + 0.4); bp.Q.value = 0.7;
      var ng = actx.createGain(); ng.gain.setValueAtTime(0.0001, t); ng.gain.exponentialRampToValueAtTime(0.06, t + 0.12); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
      ns.connect(bp); bp.connect(ng); ng.connect(master); ns.start(t); ns.stop(t + 0.72);
    }
    // warm soft tone (two pentatonic notes, sine + lowpass)
    var f = PENT[(Math.random() * PENT.length) | 0];
    [f, f * 1.5].forEach(function (freq, k) {
      var o = actx.createOscillator(); o.type = "sine"; o.frequency.value = freq;
      var g = actx.createGain();
      var peak = k ? 0.05 : 0.1;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + 0.06); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
      var lp = actx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 1600;
      o.connect(lp); lp.connect(g); g.connect(master); o.start(t); o.stop(t + 1.7);
    });
  }

  // ---- interaction --------------------------------------------------------
  function launch(x, y) {
    unlock();
    // always rises from the waterline at the tapped x (the lantern is "set on the lake")
    release(x, HY - 4, true);
    chime();
    if (hintEl) hintEl.classList.add("is-hidden");
  }
  canvas.addEventListener("mousedown", function (e) { launch(e.clientX, e.clientY); });
  canvas.addEventListener("touchstart", function (e) { e.preventDefault(); var t = e.touches[0]; launch(t.clientX, t.clientY); }, { passive: false });

  // ---- loop ---------------------------------------------------------------
  var lastTs = null, nowish = 0;
  function frame(ts) {
    var dt = lastTs !== null ? Math.min((ts - lastTs) / 1000, 0.05) : 0.016;
    lastTs = ts; nowish += dt;
    drawScene();
    drawReflections();
    for (var i = 0; i < lanterns.length; i++) { var L = lanterns[i]; drawLantern(L.x, L.y, L, 1, 1); }
    updateLanterns(dt);
    requestAnimationFrame(frame);
  }

  resize();
  window.addEventListener("resize", resize);
  // a few lanterns already adrift so the scene reads on arrival
  for (var i = 0; i < 5; i++) release(W * (0.2 + Math.random() * 0.6), HY - Math.random() * H * 0.5, false);
  requestAnimationFrame(frame);
  setTimeout(function () { if (hintEl) hintEl.classList.add("is-hidden"); }, 9000);
})();
