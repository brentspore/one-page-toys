/* Fireworks — tap the night sky to launch shells that arc up and burst.
 * Glowing sparks with fading light-trails (additive trail buffer), layered
 * boom + crackle synthesis, drifting smoke, and a soft reflection on the water.
 */
(function () {
  "use strict";

  var canvas = document.getElementById("canvas");
  var ctx = canvas.getContext("2d");
  var hintEl = document.querySelector(".hint");

  // additive trail buffer — sparks/rockets accumulate here and fade each frame,
  // giving silky light-trails over a crisp starry sky
  var tcv = document.createElement("canvas");
  var tctx = tcv.getContext("2d");

  var W, H, DPR, WATER;

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = W * DPR; canvas.height = H * DPR;
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    tcv.width = W * DPR; tcv.height = H * DPR;
    tctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    WATER = H * 0.84;
    seedStars();
  }

  // ---- stars + city silhouette -------------------------------------------
  var stars = [];
  function seedStars() {
    stars.length = 0;
    var n = Math.round(W * H / 7000);
    for (var i = 0; i < n; i++) {
      var y = Math.random() * WATER * 0.96;
      stars.push({ x: Math.random() * W, y: y, r: Math.random() * 1.1 + 0.3, tw: Math.random() * 6.28, sp: 0.6 + Math.random() * 1.8 });
    }
  }

  // ---- particles ----------------------------------------------------------
  var rockets = [], sparks = [], smoke = [];
  var HUES = [0, 18, 45, 120, 175, 205, 280, 320];

  function rand(a, b) { return a + Math.random() * (b - a); }

  function launch(tx, ty) {
    unlock();
    tx = Math.max(W * 0.08, Math.min(W * 0.92, tx));
    ty = Math.max(H * 0.08, Math.min(WATER * 0.62, ty == null ? rand(H * 0.16, H * 0.4) : ty));
    var hue = HUES[(Math.random() * HUES.length) | 0];
    rockets.push({
      x: tx, y: WATER - 4, ty: ty,
      vx: rand(-22, 22), vy: -(WATER - ty) / 0.72,   // px/s — reaches target in ~0.7s
      hue: hue, life: 0, trailT: 0,
      type: ["peony", "peony", "ring", "willow", "chrys", "crackle", "palm"][(Math.random() * 7) | 0]
    });
    whistle();
  }

  function burst(x, y, hue, type) {
    boom();
    var n, i, ang, sp, B = Math.min(W, H) * 0.52;   // reference burst speed, px/s
    if (type === "ring") {
      n = 48;
      for (i = 0; i < n; i++) {
        ang = (i / n) * 6.283; sp = B * 0.52;
        addSpark(x, y, Math.cos(ang) * sp, Math.sin(ang) * sp, hue, 1.15, 0.95);
      }
    } else if (type === "willow") {
      n = 84;
      for (i = 0; i < n; i++) {
        ang = rand(0, 6.283); sp = B * rand(0.16, 0.44);
        addSpark(x, y, Math.cos(ang) * sp, Math.sin(ang) * sp - B * 0.1, 44, 2.5, 0.5, true, 0.5);
      }
    } else if (type === "palm") {
      n = 12; // few thick rising fronds that droop
      for (i = 0; i < n; i++) {
        ang = -1.57 + rand(-1.0, 1.0); sp = B * rand(0.44, 0.64);
        addSpark(x, y, Math.cos(ang) * sp, Math.sin(ang) * sp, hue, 1.9, 0.75, true, 1.5);
      }
    } else if (type === "crackle") {
      n = 64;
      for (i = 0; i < n; i++) {
        ang = rand(0, 6.283); sp = B * rand(0.1, 0.46);
        addSpark(x, y, Math.cos(ang) * sp, Math.sin(ang) * sp, hue, rand(0.7, 1.3), 0.85, false, 1, true);
      }
      crackle(0.9);
    } else { // peony / chrysanthemum — full sphere
      n = type === "chrys" ? 124 : 96;
      for (i = 0; i < n; i++) {
        ang = rand(0, 6.283); sp = B * rand(0.12, 0.6) * (Math.random() < 0.5 ? 1 : rand(0.5, 1));
        addSpark(x, y, Math.cos(ang) * sp, Math.sin(ang) * sp, hue, type === "chrys" ? 1.8 : 1.25, 0.9, type === "chrys");
      }
    }
    // a couple of smoke puffs at the burst
    for (i = 0; i < 4; i++) smoke.push({ x: x + rand(-12, 12), y: y + rand(-12, 12), r: rand(8, 16), vy: rand(-8, -3), life: rand(2.2, 3.4), max: 3.4 });
  }

  function addSpark(x, y, vx, vy, hue, life, bright, trail, gmul, crk) {
    sparks.push({
      x: x, y: y, vx: vx, vy: vy, hue: hue,
      life: life, max: life, bright: bright,
      trail: !!trail, g: (gmul == null ? 1 : gmul) * 130, drag: 0.4, crk: !!crk,
      flick: Math.random() * 6.28
    });
  }

  function update(dt) {
    var i, r, s, dpow = Math.pow(0.4, dt);
    // rockets
    for (i = rockets.length - 1; i >= 0; i--) {
      r = rockets[i];
      r.vy += 220 * dt;                      // gravity px/s² so it decelerates near apex
      r.x += r.vx * dt; r.y += r.vy * dt;
      r.life += dt;
      // emit a sparky trail
      r.trailT -= dt;
      if (r.trailT <= 0) {
        r.trailT = 0.014;
        addSpark(r.x + rand(-1.5, 1.5), r.y + rand(2, 6), rand(-26, 26), rand(50, 120), 38, 0.32, 0.6);
      }
      if (r.vy >= -20 || r.y <= r.ty) { burst(r.x, r.y, r.hue, r.type); rockets.splice(i, 1); }
    }
    // sparks
    for (i = sparks.length - 1; i >= 0; i--) {
      s = sparks[i];
      s.vy += s.g * dt;
      s.vx *= dpow; s.vy *= dpow;            // air drag — fast expand, gentle slow
      s.x += s.vx * dt; s.y += s.vy * dt;
      s.life -= dt;
      if (s.life <= 0) sparks.splice(i, 1);
    }
    // smoke
    for (i = smoke.length - 1; i >= 0; i--) {
      var sm = smoke[i];
      sm.y += sm.vy * dt; sm.vy *= 0.99; sm.r += 8 * dt; sm.life -= dt;
      if (sm.life <= 0) smoke.splice(i, 1);
    }
  }

  // ---- rendering ----------------------------------------------------------
  function drawSky() {
    var g = ctx.createLinearGradient(0, 0, 0, WATER);
    g.addColorStop(0, "#070512");
    g.addColorStop(0.55, "#0a0a20");
    g.addColorStop(1, "#11162e");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, WATER);
    // stars
    for (var i = 0; i < stars.length; i++) {
      var st = stars[i], a = 0.25 + Math.abs(Math.sin(nowish * st.sp + st.tw)) * 0.55;
      ctx.globalAlpha = a; ctx.fillStyle = "#cfd8ff";
      ctx.beginPath(); ctx.arc(st.x, st.y, st.r, 0, 6.28); ctx.fill();
    }
    ctx.globalAlpha = 1;
    // water
    var wg = ctx.createLinearGradient(0, WATER, 0, H);
    wg.addColorStop(0, "#0a1024");
    wg.addColorStop(1, "#05060f");
    ctx.fillStyle = wg; ctx.fillRect(0, WATER, W, H - WATER);
  }

  function drawSmoke() {
    for (var i = 0; i < smoke.length; i++) {
      var sm = smoke[i], a = (sm.life / sm.max) * 0.10;
      var g = ctx.createRadialGradient(sm.x, sm.y, 0, sm.x, sm.y, sm.r);
      g.addColorStop(0, "rgba(120,120,140," + a.toFixed(3) + ")");
      g.addColorStop(1, "rgba(120,120,140,0)");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sm.x, sm.y, sm.r, 0, 6.28); ctx.fill();
    }
  }

  function paintSparks(c) {
    // draws all sparks/rockets onto the (additive) target context c
    var i, s;
    for (i = 0; i < sparks.length; i++) {
      s = sparks[i];
      var k = s.life / s.max;
      var lum = 46 + 20 * k;                 // keep saturated colour, not blown white
      var a = Math.min(1, k * 1.5) * s.bright;
      var size = (s.trail ? 1.7 : 2.2) * (0.45 + k * 0.85);
      // crackle sparks flicker white near the end
      var col;
      if (s.crk && Math.random() < 0.5) col = "rgba(255,255,255," + a.toFixed(3) + ")";
      else col = "hsla(" + s.hue + ",100%," + lum + "%," + a.toFixed(3) + ")";
      var g = c.createRadialGradient(s.x, s.y, 0, s.x, s.y, size * 3.2);
      g.addColorStop(0, col);
      g.addColorStop(0.4, "hsla(" + s.hue + ",100%," + lum + "%," + (a * 0.5).toFixed(3) + ")");
      g.addColorStop(1, "hsla(" + s.hue + ",100%,50%,0)");
      c.fillStyle = g;
      c.beginPath(); c.arc(s.x, s.y, size * 3.2, 0, 6.28); c.fill();
      // hot core
      c.fillStyle = "rgba(255,255,255," + (a * 0.7).toFixed(3) + ")";
      c.beginPath(); c.arc(s.x, s.y, size * 0.8, 0, 6.28); c.fill();
    }
    for (i = 0; i < rockets.length; i++) {
      var r = rockets[i];
      var g2 = c.createRadialGradient(r.x, r.y, 0, r.x, r.y, 7);
      g2.addColorStop(0, "rgba(255,240,200,0.95)");
      g2.addColorStop(1, "rgba(255,180,90,0)");
      c.fillStyle = g2; c.beginPath(); c.arc(r.x, r.y, 7, 0, 6.28); c.fill();
    }
  }

  // ---- audio: synthesized whistle / boom / crackle -----------------------
  var actx = null, master = null, rainGain;
  function unlock() {
    if (actx) { if (actx.state === "suspended") actx.resume(); return; }
    try {
      actx = new (window.AudioContext || window.webkitAudioContext)();
      var b = actx.createBuffer(1, 1, 22050); var s = actx.createBufferSource(); s.buffer = b; s.connect(actx.destination); s.start(0);
      master = actx.createGain(); master.gain.value = 0.9; master.connect(actx.destination);
    } catch (e) { actx = null; }
  }
  function noiseBurst(dur) {
    var len = Math.floor(actx.sampleRate * dur), buf = actx.createBuffer(1, len, actx.sampleRate), d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    var src = actx.createBufferSource(); src.buffer = buf; return src;
  }
  function whistle() {
    if (!actx) return;
    var t = actx.currentTime;
    var src = noiseBurst(1.0);
    var bp = actx.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = 14;
    bp.frequency.setValueAtTime(900, t); bp.frequency.exponentialRampToValueAtTime(2100, t + 0.9);
    var g = actx.createGain(); g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05, t + 0.08); g.gain.exponentialRampToValueAtTime(0.012, t + 0.9);
    src.connect(bp); bp.connect(g); g.connect(master); src.start(t); src.stop(t + 1.0);
  }
  function boom() {
    if (!actx) return;
    var t = actx.currentTime;
    // low body thump
    var o = actx.createOscillator(); o.type = "sine";
    o.frequency.setValueAtTime(rand(80, 120), t); o.frequency.exponentialRampToValueAtTime(40, t + 0.4);
    var og = actx.createGain(); og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.6, t + 0.012); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
    o.connect(og); og.connect(master); o.start(t); o.stop(t + 0.6);
    // bright crack transient
    var src = noiseBurst(0.3);
    var hp = actx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 1200;
    var g = actx.createGain(); g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    src.connect(hp); hp.connect(g); g.connect(master); src.start(t); src.stop(t + 0.3);
  }
  function crackle(dur) {
    if (!actx) return;
    var t0 = actx.currentTime, n = 26;
    for (var i = 0; i < n; i++) {
      var t = t0 + Math.random() * dur;
      var src = noiseBurst(0.04);
      var bp = actx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 2500 + Math.random() * 3500; bp.Q.value = 6;
      var g = actx.createGain(); g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.05 + Math.random() * 0.06, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
      src.connect(bp); bp.connect(g); g.connect(master); src.start(t); src.stop(t + 0.06);
    }
  }

  // ---- interaction --------------------------------------------------------
  function pointer(px, py) { launch(px, py); if (hintEl) hintEl.classList.add("is-hidden"); }
  canvas.addEventListener("mousedown", function (e) { pointer(e.clientX, e.clientY); });
  canvas.addEventListener("touchstart", function (e) {
    e.preventDefault();
    for (var i = 0; i < e.touches.length; i++) pointer(e.touches[i].clientX, e.touches[i].clientY);
  }, { passive: false });

  // gentle self-running show so the sky is alive on arrival
  var autoT = 1.2;
  function auto(dt) {
    autoT -= dt;
    if (autoT <= 0) { launch(rand(W * 0.15, W * 0.85), rand(H * 0.16, H * 0.4)); autoT = rand(1.6, 3.2); }
  }

  // ---- loop ---------------------------------------------------------------
  var lastTs = null, nowish = 0;
  function frame(ts) {
    var dt = lastTs !== null ? Math.min((ts - lastTs) / 1000, 0.05) : 0.016;
    lastTs = ts; nowish += dt;
    auto(dt);
    update(dt);

    // fade the additive trail buffer a little each frame
    tctx.globalCompositeOperation = "destination-out";
    tctx.fillStyle = "rgba(0,0,0,0.18)";
    tctx.fillRect(0, 0, W, H);
    // accumulate fresh sparks (additive)
    tctx.globalCompositeOperation = "lighter";
    paintSparks(tctx);

    // compose
    drawSky();
    drawSmoke();
    // reflection on the water (flipped, dim)
    ctx.save();
    ctx.beginPath(); ctx.rect(0, WATER, W, H - WATER); ctx.clip();
    ctx.globalAlpha = 0.32;
    ctx.translate(0, WATER * 2);
    ctx.scale(1, -1);
    ctx.drawImage(tcv, 0, 0, W, H);
    ctx.restore();
    // main trails
    ctx.globalAlpha = 1;
    ctx.drawImage(tcv, 0, 0, W, H);

    requestAnimationFrame(frame);
  }

  resize();
  window.addEventListener("resize", resize);
  requestAnimationFrame(frame);
  setTimeout(function () { if (hintEl) hintEl.classList.add("is-hidden"); }, 8000);
})();
