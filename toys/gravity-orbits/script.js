/* Gravity Orbits — a little gravity sandbox.
 * A massive star sits at the center; fling planets and they fall into orbit,
 * tracing glowing elliptical trails, slingshotting off each other and merging.
 * Star-dominant + softened mutual gravity, semi-implicit Euler. Canvas 2D.
 */
(function () {
  "use strict";

  // ---- TUNABLES -----------------------------------------------------------
  var STAR_K = 1500;        // star gravitational parameter (px^3 / frame^2)
  var PL_K = 90;            // planet-planet gravity strength
  var SOFT = 20;            // softening (avoids singularities)
  var SUB = 2;              // physics sub-steps per frame
  var TSTEP = 0.6;          // global time step (lower = calmer, slower motion)
  var VSCALE = 0.05;        // drag length -> launch speed (lower = gentler fling)
  var MAX_PLANETS = 42;
  var TRAIL_FADE = 0.045;
  var STAR_R = 24;
  // -------------------------------------------------------------------------

  var canvas = document.getElementById("canvas");
  var ctx = canvas.getContext("2d");
  var hintEl = document.querySelector(".hint");
  var tcv = document.createElement("canvas"), tctx = tcv.getContext("2d");

  var W, H, DPR, cx, cy, scale;
  var planets = [], flares = [], stars = [];
  var trailsOn = true;

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = W * DPR; canvas.height = H * DPR;
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    tcv.width = W * DPR; tcv.height = H * DPR; tctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    scale = Math.min(W, H);
    cx = W / 2; cy = H / 2;
    tctx.clearRect(0, 0, W, H);
    seedStars();
  }
  function seedStars() {
    stars = [];
    var n = Math.round(W * H / 9000);
    for (var i = 0; i < n; i++) stars.push({ x: Math.random() * W, y: Math.random() * H, r: Math.random() * 1.3 + 0.3, a: Math.random() * 0.5 + 0.2 });
  }

  var HUES = [8, 32, 48, 140, 190, 210, 275, 320];
  function makePlanet(x, y, vx, vy, m) {
    return { x: x, y: y, vx: vx, vy: vy, m: m, r: Math.max(3, Math.cbrt(m) * 4), hue: HUES[(Math.random() * HUES.length) | 0] };
  }
  function orbit(r, m, ang) {
    var v = Math.sqrt(STAR_K / r);
    var x = cx + Math.cos(ang) * r, y = cy + Math.sin(ang) * r;
    var dir = Math.random() < 0.5 ? 1 : -1;
    return makePlanet(x, y, -Math.sin(ang) * v * dir, Math.cos(ang) * v * dir, m);
  }
  function reset() {
    planets = []; flares = []; tctx.clearRect(0, 0, W, H);
    var base = scale * 0.14;
    planets.push(orbit(base, 5, 0));
    planets.push(orbit(base * 1.7, 9, 2.1));
    planets.push(orbit(base * 2.5, 4, 4.0));
  }

  // ---- physics ------------------------------------------------------------
  function simulate() {
    for (var s = 0; s < SUB; s++) {
      for (var i = 0; i < planets.length; i++) {
        var p = planets[i], ax = 0, ay = 0;
        var dx = cx - p.x, dy = cy - p.y, d2 = dx * dx + dy * dy + SOFT * SOFT, d = Math.sqrt(d2);
        var a = STAR_K / d2; ax += a * dx / d; ay += a * dy / d;
        for (var j = 0; j < planets.length; j++) {
          if (j === i) continue; var q = planets[j];
          var ex = q.x - p.x, ey = q.y - p.y, e2 = ex * ex + ey * ey + SOFT * SOFT, e = Math.sqrt(e2);
          var b = PL_K * q.m / e2; ax += b * ex / e; ay += b * ey / e;
        }
        p.vx += ax * TSTEP; p.vy += ay * TSTEP;
      }
      for (i = 0; i < planets.length; i++) { planets[i].x += planets[i].vx * TSTEP; planets[i].y += planets[i].vy * TSTEP; }
      collide();
    }
    for (i = flares.length - 1; i >= 0; i--) { var f = flares[i]; f.x += f.vx; f.y += f.vy; f.vx *= 0.94; f.vy *= 0.94; f.life -= 0.03; if (f.life <= 0) flares.splice(i, 1); }
  }
  function collide() {
    // star swallows planets
    for (var i = planets.length - 1; i >= 0; i--) {
      var p = planets[i], dx = p.x - cx, dy = p.y - cy;
      if (Math.hypot(dx, dy) < STAR_R + p.r * 0.5) { burst(p.x, p.y, p.hue, p.r); planets.splice(i, 1); swallow(); }
    }
    // planet-planet merge
    for (i = 0; i < planets.length; i++) for (var j = i + 1; j < planets.length; j++) {
      var a = planets[i], b = planets[j];
      if (Math.hypot(a.x - b.x, a.y - b.y) < a.r + b.r) {
        var m = a.m + b.m;
        a.vx = (a.vx * a.m + b.vx * b.m) / m; a.vy = (a.vy * a.m + b.vy * b.m) / m;
        a.x = (a.x * a.m + b.x * b.m) / m; a.y = (a.y * a.m + b.y * b.m) / m;
        a.m = m; a.r = Math.max(3, Math.cbrt(m) * 4);
        burst((a.x + b.x) / 2, (a.y + b.y) / 2, b.hue, b.r); planets.splice(j, 1); clink(); j--;
      }
    }
  }
  function burst(x, y, hue, r) {
    var n = 8 + (r | 0);
    for (var i = 0; i < n; i++) { var a = Math.random() * 6.283, sp = 1 + Math.random() * 3; flares.push({ x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1, hue: hue }); }
  }

  // ---- render -------------------------------------------------------------
  function render() {
    ctx.fillStyle = "#03040a"; ctx.fillRect(0, 0, W, H);
    var bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, scale * 0.75);
    bg.addColorStop(0, "rgba(30,26,60,0.5)"); bg.addColorStop(1, "rgba(3,4,10,0)");
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    for (var i = 0; i < stars.length; i++) { var st = stars[i]; ctx.fillStyle = "rgba(210,220,255," + st.a + ")"; ctx.fillRect(st.x, st.y, st.r, st.r); }

    // trail buffer
    if (trailsOn) {
      tctx.globalCompositeOperation = "destination-out"; tctx.fillStyle = "rgba(0,0,0," + TRAIL_FADE + ")"; tctx.fillRect(0, 0, W, H);
      tctx.globalCompositeOperation = "lighter";
      for (i = 0; i < planets.length; i++) { var p = planets[i]; tctx.fillStyle = "hsla(" + p.hue + ",95%,64%,0.95)"; tctx.beginPath(); tctx.arc(p.x, p.y, Math.max(1.6, p.r * 0.6), 0, 6.283); tctx.fill(); }
      tctx.globalCompositeOperation = "source-over";
      ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.drawImage(tcv, 0, 0, W, H); ctx.restore();
    }

    // star
    var halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, STAR_R * 5);
    halo.addColorStop(0, "rgba(255,236,170,0.55)"); halo.addColorStop(0.4, "rgba(255,180,90,0.18)"); halo.addColorStop(1, "rgba(255,150,60,0)");
    ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(cx, cy, STAR_R * 5, 0, 6.283); ctx.fill(); ctx.restore();
    var sg = ctx.createRadialGradient(cx - STAR_R * 0.3, cy - STAR_R * 0.3, STAR_R * 0.1, cx, cy, STAR_R);
    sg.addColorStop(0, "#fffdf0"); sg.addColorStop(0.5, "#ffe08a"); sg.addColorStop(1, "#f0972e");
    ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(cx, cy, STAR_R, 0, 6.283); ctx.fill();

    // planets
    for (i = 0; i < planets.length; i++) {
      p = planets[i];
      var g = ctx.createRadialGradient(p.x - p.r * 0.35, p.y - p.r * 0.4, p.r * 0.1, p.x, p.y, p.r);
      g.addColorStop(0, "hsl(" + p.hue + ",85%,78%)"); g.addColorStop(0.6, "hsl(" + p.hue + ",78%,54%)"); g.addColorStop(1, "hsl(" + p.hue + ",70%,28%)");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.283); ctx.fill();
    }

    // flares
    ctx.save(); ctx.globalCompositeOperation = "lighter";
    for (i = 0; i < flares.length; i++) { var f = flares[i]; ctx.fillStyle = "hsla(" + f.hue + ",90%,66%," + f.life + ")"; ctx.beginPath(); ctx.arc(f.x, f.y, 2.4 * f.life + 0.5, 0, 6.283); ctx.fill(); }
    ctx.restore();

    // aim arrow
    if (aiming) {
      var vx = (mx - sx), vy = (my - sy);
      ctx.strokeStyle = "rgba(180,200,255,0.85)"; ctx.lineWidth = 2; ctx.setLineDash([6, 5]);
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(mx, my); ctx.stroke(); ctx.setLineDash([]);
      var ga = ctx.createRadialGradient(sx, sy, 0, sx, sy, 12); ga.addColorStop(0, "rgba(200,220,255,0.9)"); ga.addColorStop(1, "rgba(200,220,255,0)");
      ctx.fillStyle = ga; ctx.beginPath(); ctx.arc(sx, sy, 12, 0, 6.283); ctx.fill();
      var ang = Math.atan2(vy, vx), hl = 12;
      ctx.strokeStyle = "rgba(200,220,255,0.9)"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(mx, my); ctx.lineTo(mx - Math.cos(ang - 0.5) * hl, my - Math.sin(ang - 0.5) * hl);
      ctx.moveTo(mx, my); ctx.lineTo(mx - Math.cos(ang + 0.5) * hl, my - Math.sin(ang + 0.5) * hl); ctx.stroke();
    }
  }

  var lastTs = null;
  function frame(ts) { lastTs = ts; simulate(); render(); requestAnimationFrame(frame); }

  // ---- input --------------------------------------------------------------
  var aiming = false, sx = 0, sy = 0, mx = 0, my = 0;
  function pdown(x, y) { unlock(); aiming = true; sx = mx = x; sy = my = y; if (hintEl) hintEl.classList.add("is-hidden"); }
  function pmove(x, y) { if (aiming) { mx = x; my = y; } }
  function pup() {
    if (!aiming) return; aiming = false;
    var vx = (mx - sx) * VSCALE, vy = (my - sy) * VSCALE;
    if (planets.length >= MAX_PLANETS) planets.shift();
    planets.push(makePlanet(sx, sy, vx, vy, 5 + Math.random() * 6));
    whoosh(Math.hypot(mx - sx, my - sy));
  }
  canvas.addEventListener("mousedown", function (e) { pdown(e.clientX, e.clientY); });
  window.addEventListener("mousemove", function (e) { pmove(e.clientX, e.clientY); });
  window.addEventListener("mouseup", pup);
  canvas.addEventListener("touchstart", function (e) { e.preventDefault(); var t = e.touches[0]; pdown(t.clientX, t.clientY); }, { passive: false });
  canvas.addEventListener("touchmove", function (e) { e.preventDefault(); var t = e.touches[0]; pmove(t.clientX, t.clientY); }, { passive: false });
  canvas.addEventListener("touchend", function (e) { e.preventDefault(); pup(); }, { passive: false });

  document.getElementById("resetBtn").addEventListener("click", reset);
  var trailBtn = document.getElementById("trailBtn");
  trailBtn.addEventListener("click", function () {
    trailsOn = !trailsOn; if (!trailsOn) tctx.clearRect(0, 0, W, H);
    trailBtn.textContent = trailsOn ? "Trails: on" : "Trails: off";
    trailBtn.setAttribute("aria-pressed", trailsOn ? "false" : "true");
  });

  // ---- audio (synth) ------------------------------------------------------
  var actx = null, master = null, outGain = null, muted = false;
  function unlock() {
    if (actx) { if (actx.state === "suspended") actx.resume(); return; }
    try {
      actx = new (window.AudioContext || window.webkitAudioContext)();
      var b = actx.createBuffer(1, 1, 22050), s = actx.createBufferSource(); s.buffer = b; s.connect(actx.destination); s.start(0);
      outGain = actx.createGain(); outGain.gain.value = muted ? 0 : 1; outGain.connect(actx.destination);
      master = actx.createGain(); master.gain.value = 0.6; master.connect(outGain);
    } catch (e) { actx = null; }
  }
  function whoosh(len) {
    if (!actx) return; var t = actx.currentTime, f = 180 + Math.min(400, len);
    var o = actx.createOscillator(); o.type = "sine"; o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 1.7, t + 0.18);
    var g = actx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.06, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0004, t + 0.24);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.26);
  }
  function clink() {
    if (!actx) return; var t = actx.currentTime;
    var o = actx.createOscillator(); o.type = "triangle"; o.frequency.value = 320 + Math.random() * 220;
    var g = actx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0004, t + 0.16);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.18);
  }
  function swallow() {
    if (!actx) return; var t = actx.currentTime;
    var o = actx.createOscillator(); o.type = "sine"; o.frequency.setValueAtTime(220, t); o.frequency.exponentialRampToValueAtTime(50, t + 0.4);
    var g = actx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.09, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0004, t + 0.5);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.52);
  }
  var soundBtn = document.getElementById("soundBtn");
  soundBtn.addEventListener("click", function () {
    muted = !muted; unlock();
    if (outGain) outGain.gain.setTargetAtTime(muted ? 0 : 1, actx.currentTime, 0.02);
    soundBtn.textContent = muted ? "Sound: off" : "Sound: on";
    soundBtn.setAttribute("aria-pressed", muted ? "true" : "false");
  });

  // ---- boot ---------------------------------------------------------------
  resize(); window.addEventListener("resize", resize);
  reset();
  requestAnimationFrame(frame);
})();
