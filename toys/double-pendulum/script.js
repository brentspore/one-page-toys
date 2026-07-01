/* Double Pendulum — a chaotic-motion sandbox.
 * Two arms hinged in series swing under gravity; the exact equations of motion
 * are integrated with RK4 so the chaos is faithful. Drag either bob to place +
 * fling it, let go, and watch it paint glowing trails. Vanilla Canvas 2D.
 */
(function () {
  "use strict";

  // ---- TUNABLES -----------------------------------------------------------
  var G = 1.4;              // gravity strength (tuned for feel, not real units)
  var M1 = 1.05, M2 = 1.0; // bob masses
  var DAMP = 0.99997;       // per-substep angular damping (near-frictionless; stays lively)
  var SUBSTEPS = 8;         // physics sub-steps per frame (stability)
  var TRAIL_FADE = 0.028;   // how fast the trail dims each frame
  // -------------------------------------------------------------------------

  var canvas = document.getElementById("canvas");
  var ctx = canvas.getContext("2d");
  var hintEl = document.querySelector(".hint");

  // trail buffer (glowing tip path)
  var tcv = document.createElement("canvas"), tctx = tcv.getContext("2d");

  var W, H, DPR, cx, cy, L1, L2, scale;
  // state: angles from vertical (down = 0), angular velocities
  var a1 = 2.2, a2 = 2.6, w1 = 0, w2 = 0;
  var trailsOn = true, hue = 0, moved = false;

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = W * DPR; canvas.height = H * DPR;
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    tcv.width = W * DPR; tcv.height = H * DPR;
    tctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    scale = Math.min(W, H);
    cx = W / 2; cy = H * 0.40;
    L1 = scale * 0.20; L2 = scale * 0.20;
    clearTrail();
  }
  function clearTrail() { tctx.clearRect(0, 0, W, H); }

  // ---- physics: derivatives of [a1,a2,w1,w2] ------------------------------
  function deriv(s) {
    var A1 = s[0], A2 = s[1], W1 = s[2], W2 = s[3];
    var d = A1 - A2, cd = Math.cos(d), sd = Math.sin(d);
    var den = (2 * M1 + M2 - M2 * Math.cos(2 * d));
    var dw1 = (-G * (2 * M1 + M2) * Math.sin(A1)
      - M2 * G * Math.sin(A1 - 2 * A2)
      - 2 * sd * M2 * (W2 * W2 * L2 + W1 * W1 * L1 * cd)) / (L1 * den);
    var dw2 = (2 * sd * (W1 * W1 * L1 * (M1 + M2)
      + G * (M1 + M2) * Math.cos(A1)
      + W2 * W2 * L2 * M2 * cd)) / (L2 * den);
    return [W1, W2, dw1, dw2];
  }
  function step(dt) {
    var s = [a1, a2, w1, w2];
    var k1 = deriv(s);
    var k2 = deriv(add(s, k1, dt / 2));
    var k3 = deriv(add(s, k2, dt / 2));
    var k4 = deriv(add(s, k3, dt));
    a1 += dt / 6 * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]);
    a2 += dt / 6 * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);
    w1 += dt / 6 * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2]);
    w2 += dt / 6 * (k1[3] + 2 * k2[3] + 2 * k3[3] + k4[3]);
    w1 *= DAMP; w2 *= DAMP;
  }
  function add(s, k, h) { return [s[0] + k[0] * h, s[1] + k[1] * h, s[2] + k[2] * h, s[3] + k[3] * h]; }

  function positions() {
    var x1 = cx + L1 * Math.sin(a1), y1 = cy + L1 * Math.cos(a1);
    var x2 = x1 + L2 * Math.sin(a2), y2 = y1 + L2 * Math.cos(a2);
    return [x1, y1, x2, y2];
  }

  // ---- render -------------------------------------------------------------
  function drawBackground() {
    var g = ctx.createRadialGradient(cx, cy + scale * 0.1, 0, cx, cy, Math.max(W, H) * 0.85);
    g.addColorStop(0, "#0c1024"); g.addColorStop(0.5, "#080a16"); g.addColorStop(1, "#04050b");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  function bob(x, y, r, base) {
    var g = ctx.createRadialGradient(x - r * 0.36, y - r * 0.4, r * 0.1, x, y, r);
    g.addColorStop(0, base[0]); g.addColorStop(0.5, base[1]); g.addColorStop(1, base[2]);
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283); ctx.fill();
    // specular
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.beginPath(); ctx.ellipse(x - r * 0.34, y - r * 0.4, r * 0.24, r * 0.16, -0.6, 0, 6.283); ctx.fill();
  }
  function rod(x0, y0, x1, y1, wdt) {
    var g = ctx.createLinearGradient(x0, y0 - wdt, x0, y0 + wdt);
    g.addColorStop(0, "#8b93a8"); g.addColorStop(0.5, "#d9dde8"); g.addColorStop(1, "#6b7284");
    ctx.strokeStyle = "rgba(20,24,36,0.6)"; ctx.lineWidth = wdt + 3; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    ctx.strokeStyle = g; ctx.lineWidth = wdt;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  }

  var lastTip = null;
  function render() {
    drawBackground();
    // fade + composite trail buffer
    if (trailsOn) {
      tctx.globalCompositeOperation = "destination-out";
      tctx.fillStyle = "rgba(0,0,0," + TRAIL_FADE + ")";
      tctx.fillRect(0, 0, W, H);
      tctx.globalCompositeOperation = "source-over";
    }
    var p = positions();
    if (trailsOn && lastTip) {
      var speed = Math.hypot(p[2] - lastTip[0], p[3] - lastTip[1]);
      hue = (hue + 1.4 + speed * 0.05) % 360;
      tctx.globalCompositeOperation = "lighter";
      tctx.lineCap = "round";
      tctx.strokeStyle = "hsla(" + hue + ",95%,60%,0.28)";     // soft wide glow
      tctx.lineWidth = 7;
      tctx.beginPath(); tctx.moveTo(lastTip[0], lastTip[1]); tctx.lineTo(p[2], p[3]); tctx.stroke();
      tctx.strokeStyle = "hsla(" + hue + ",95%,68%,1)";         // bright core
      tctx.lineWidth = 2.6;
      tctx.beginPath(); tctx.moveTo(lastTip[0], lastTip[1]); tctx.lineTo(p[2], p[3]); tctx.stroke();
      tctx.globalCompositeOperation = "source-over";
    }
    lastTip = [p[2], p[3]];
    // draw trail buffer under the arms
    ctx.save(); ctx.globalCompositeOperation = "lighter";
    ctx.drawImage(tcv, 0, 0, W, H); ctx.restore();

    // pivot mount
    ctx.fillStyle = "#1a2036";
    ctx.beginPath(); ctx.arc(cx, cy, scale * 0.018, 0, 6.283); ctx.fill();
    ctx.strokeStyle = "rgba(150,165,200,0.5)"; ctx.lineWidth = 2; ctx.stroke();

    // arms + bobs
    var r1 = scale * 0.026 * Math.cbrt(M1), r2 = scale * 0.026 * Math.cbrt(M2);
    rod(cx, cy, p[0], p[1], scale * 0.012);
    rod(p[0], p[1], p[2], p[3], scale * 0.011);
    bob(p[0], p[1], r1, ["#eaf0ff", "#9fb0d8", "#4a5678"]);   // chrome
    bob(p[2], p[3], r2, ["#ffe9b0", "#f0b43c", "#8a5a12"]); // brass
  }

  // ---- loop ---------------------------------------------------------------
  var lastTs = null;
  function frame(ts) {
    var dt = lastTs !== null ? Math.min((ts - lastTs) / 1000, 0.033) : 0.016;
    lastTs = ts;
    if (!dragging) {
      var h = (dt * 60) / SUBSTEPS * 0.5;
      for (var i = 0; i < SUBSTEPS; i++) step(h);
      swishAudio();
    }
    render();
    requestAnimationFrame(frame);
  }

  // ---- input --------------------------------------------------------------
  var dragging = 0;   // 0 none, 1 inner bob, 2 outer bob
  function pick(x, y) {
    var p = positions();
    var d1 = Math.hypot(x - p[0], y - p[1]), d2 = Math.hypot(x - p[2], y - p[3]);
    var thr = scale * 0.06;
    if (d2 < thr && d2 <= d1) return 2;
    if (d1 < thr) return 1;
    // clicking anywhere else grabs the nearest arm tip (outer by default)
    return d2 < d1 ? 2 : 1;
  }
  var dragA = 0, dragT = 0, flingW = 0;
  var FLING = 0.9;    // drag angular speed (rad/s) -> launch angular velocity
  function now() { return (window.performance && performance.now) ? performance.now() : Date.now(); }
  function curAngle() { return dragging === 1 ? a1 : a2; }
  function angDiff(a, b) { var d = a - b; while (d > Math.PI) d -= 6.28318; while (d < -Math.PI) d += 6.28318; return d; }
  function pdown(x, y) { unlock(); dragging = pick(x, y); w1 = w2 = 0; setFromPointer(x, y); dragA = curAngle(); dragT = now(); flingW = 0; if (hintEl) hintEl.classList.add("is-hidden"); }
  function pmove(x, y) {
    if (!dragging) return;
    setFromPointer(x, y); moved = true;
    var t = now(), na = curAngle(), dtm = Math.max(8, t - dragT) / 1000;
    flingW = flingW * 0.4 + (angDiff(na, dragA) / dtm) * 0.6;   // smoothed drag angular speed
    dragA = na; dragT = t;
  }
  function pup() {
    if (dragging) {
      var w = Math.max(-1.2, Math.min(1.2, flingW * FLING / 30));   // scale rad/s -> internal omega
      if (dragging === 1) { w1 = w; w2 = w * 0.4; } else { w2 = w; }
    }
    dragging = 0;
  }
  function setFromPointer(x, y) {
    if (dragging === 1) {
      a1 = Math.atan2(x - cx, y - cy);
    } else {
      var p = positions();       // keep inner arm, aim outer at cursor
      a2 = Math.atan2(x - p[0], y - p[1]);
    }
  }
  canvas.addEventListener("mousedown", function (e) { pdown(e.clientX, e.clientY); });
  window.addEventListener("mousemove", function (e) { pmove(e.clientX, e.clientY); });
  window.addEventListener("mouseup", pup);
  canvas.addEventListener("touchstart", function (e) { e.preventDefault(); var t = e.touches[0]; pdown(t.clientX, t.clientY); }, { passive: false });
  canvas.addEventListener("touchmove", function (e) { e.preventDefault(); var t = e.touches[0]; pmove(t.clientX, t.clientY); }, { passive: false });
  canvas.addEventListener("touchend", function (e) { e.preventDefault(); pup(); }, { passive: false });

  document.getElementById("dropBtn").addEventListener("click", function () {
    a1 = 1.2 + Math.random() * 1.6; a2 = 1.0 + Math.random() * 2.2; w1 = w2 = 0;
    clearTrail(); lastTip = null;
  });
  var trailBtn = document.getElementById("trailBtn");
  trailBtn.addEventListener("click", function () {
    trailsOn = !trailsOn; if (!trailsOn) clearTrail();
    trailBtn.textContent = trailsOn ? "Trails: on" : "Trails: off";
    trailBtn.setAttribute("aria-pressed", trailsOn ? "false" : "true");
  });

  // ---- audio (subtle synth swish tied to tip speed) -----------------------
  var actx = null, master = null, outGain = null, muted = false, swishNode = null, swishGain = null, swishFilt = null, noiseBuf = null;
  function unlock() {
    if (actx) { if (actx.state === "suspended") actx.resume(); return; }
    try {
      actx = new (window.AudioContext || window.webkitAudioContext)();
      var b = actx.createBuffer(1, 1, 22050), s = actx.createBufferSource(); s.buffer = b; s.connect(actx.destination); s.start(0);
      outGain = actx.createGain(); outGain.gain.value = muted ? 0 : 1; outGain.connect(actx.destination);
      master = actx.createGain(); master.gain.value = 0.5; master.connect(outGain);
      noiseBuf = actx.createBuffer(1, actx.sampleRate, actx.sampleRate);
      var nd = noiseBuf.getChannelData(0); for (var i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
      swishNode = actx.createBufferSource(); swishNode.buffer = noiseBuf; swishNode.loop = true;
      swishFilt = actx.createBiquadFilter(); swishFilt.type = "bandpass"; swishFilt.frequency.value = 600; swishFilt.Q.value = 0.8;
      swishGain = actx.createGain(); swishGain.gain.value = 0;
      swishNode.connect(swishFilt); swishFilt.connect(swishGain); swishGain.connect(master); swishNode.start(0);
    } catch (e) { actx = null; }
  }
  function swishAudio() {
    if (!actx || !swishGain) return;
    var v = Math.min(1, (Math.abs(w1) + Math.abs(w2)) * 0.09);
    swishGain.gain.setTargetAtTime(v * 0.09, actx.currentTime, 0.08);
    swishFilt.frequency.setTargetAtTime(300 + v * 1400, actx.currentTime, 0.08);
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
  requestAnimationFrame(frame);
})();
