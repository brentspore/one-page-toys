/* Perfect Circle — draw a ring freehand in one stroke; get scored on how round it is.
 * One gesture, a precise %, a best to beat, and an instant "one more try" loop.
 * Per-segment deviation heat-map shows exactly where you wandered. All sound synthesized.
 */
(function () {
  "use strict";

  var canvas = document.getElementById("canvas");
  var ctx = canvas.getContext("2d");
  var hintEl = document.querySelector(".hint");
  var bestChip = document.getElementById("bestChip");
  var ctaEl = document.getElementById("pcCta");

  // Reveal the on-canvas share + more-games strip once the first score lands,
  // then leave it pinned to the bottom (no per-stroke flicker).
  function revealCta(score) {
    if (typeof score === "number") {
      window.OPT_SHARE_TEXT = "I scored " + score.toFixed(1) +
        "% on Perfect Circle. Can you draw a rounder circle?";
    }
    if (ctaEl) ctaEl.classList.add("is-shown");
  }

  var W, H, DPR, CX, CY;
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = W * DPR; canvas.height = H * DPR;
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    CX = W / 2; CY = H / 2;
  }

  // ---- state --------------------------------------------------------------
  var pts = [];                 // the live drawn path
  var drawing = false;
  var result = null;            // { cx, cy, R, score, label, isBest, radii, angs }
  var shown = 0;                // animated displayed score
  var confetti = [];
  var flashT = 0;               // "new best" flash timer
  var best = null;
  try { var b = localStorage.getItem("pc_best"); if (b != null) best = parseFloat(b); } catch (e) {}
  updateBestChip();

  function updateBestChip() {
    if (bestChip) bestChip.textContent = "BEST " + (best == null ? "–" : best.toFixed(1) + "%");
  }

  function rand(a, b) { return a + Math.random() * (b - a); }

  // ---- scoring ------------------------------------------------------------
  // round-ness = how tightly every point hugs the mean radius, with penalties
  // for an incomplete sweep (short arc) and an open gap (start ≠ end).
  function scorePath(p) {
    if (p.length < 14) return null;
    var i, cx = 0, cy = 0;
    for (i = 0; i < p.length; i++) { cx += p[i].x; cy += p[i].y; }
    cx /= p.length; cy /= p.length;

    var radii = [], angs = [], sumR = 0, prevA = null, sweep = 0;
    for (i = 0; i < p.length; i++) {
      var dx = p[i].x - cx, dy = p[i].y - cy;
      var r = Math.hypot(dx, dy); radii.push(r); sumR += r;
      var a = Math.atan2(dy, dx); angs.push(a);
      if (prevA !== null) {
        var da = a - prevA;
        while (da > Math.PI) da -= 6.283185;
        while (da < -Math.PI) da += 6.283185;
        sweep += da;
      }
      prevA = a;
    }
    var R = sumR / p.length;
    if (R < 24) return null;                       // too small to be a real attempt

    var v = 0;
    for (i = 0; i < radii.length; i++) { var d = radii[i] - R; v += d * d; }
    var cv = Math.sqrt(v / radii.length) / R;      // coefficient of variation

    var closure = Math.min(1, Math.abs(sweep) / 6.283185);
    var s = 100 * (1 - 2.0 * cv);                  // base roundness
    if (closure < 0.92) s *= Math.max(0, (closure - 0.45) / 0.47);   // open arc → low
    var gap = Math.hypot(p[0].x - p[p.length - 1].x, p[0].y - p[p.length - 1].y) / R;
    s -= Math.min(12, gap * 14);                   // open circle penalty
    s = Math.max(0, Math.min(100, s));

    return { cx: cx, cy: cy, R: R, score: s, radii: radii, angs: angs };
  }

  function labelFor(s) {
    if (s >= 99) return "Perfect!";
    if (s >= 96) return "Flawless";
    if (s >= 92) return "Amazing";
    if (s >= 85) return "Great";
    if (s >= 75) return "Good";
    if (s >= 58) return "Not bad";
    return "Keep trying";
  }

  function finish() {
    var r = scorePath(pts);
    drawing = false;
    if (!r) { result = null; pts = []; return; }
    r.label = labelFor(r.score);
    r.isBest = (best == null || r.score > best + 0.05);
    result = r; shown = 0;
    revealCta(r.score);
    if (r.isBest) {
      best = r.score;
      try { localStorage.setItem("pc_best", String(best)); } catch (e) {}
      updateBestChip();
      flashT = 1.4;
      burstConfetti(r.cx, r.cy);
      bestSparkle(r.score);
    }
    scoreChime(r.score);
  }

  function burstConfetti(x, y) {
    var hues = [48, 168, 200, 280, 330];
    for (var i = 0; i < 90; i++) {
      var a = rand(0, 6.283), sp = rand(80, 460);
      confetti.push({
        x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - rand(40, 160),
        life: rand(0.9, 1.8), max: 1.8, size: rand(2.5, 6),
        hue: hues[(Math.random() * hues.length) | 0], rot: rand(0, 6.28), vr: rand(-8, 8)
      });
    }
  }

  // ---- input --------------------------------------------------------------
  function addPt(x, y) {
    var n = pts.length;
    if (n === 0 || Math.hypot(x - pts[n - 1].x, y - pts[n - 1].y) > 2.2) {
      pts.push({ x: x, y: y });
      if (n > 0) penTick();
    }
  }
  function start(x, y) {
    unlock();
    drawing = true; result = null; confetti.length = 0; flashT = 0;
    pts = [{ x: x, y: y }];
    if (hintEl) hintEl.classList.add("is-hidden");
  }
  function move(x, y) { if (drawing) addPt(x, y); }
  function end() { if (drawing) finish(); }

  canvas.addEventListener("mousedown", function (e) { start(e.clientX, e.clientY); });
  window.addEventListener("mousemove", function (e) { if (e.buttons & 1) move(e.clientX, e.clientY); });
  window.addEventListener("mouseup", end);
  canvas.addEventListener("touchstart", function (e) { e.preventDefault(); var t = e.touches[0]; start(t.clientX, t.clientY); }, { passive: false });
  canvas.addEventListener("touchmove", function (e) { e.preventDefault(); var t = e.touches[0]; move(t.clientX, t.clientY); }, { passive: false });
  canvas.addEventListener("touchend", function (e) { e.preventDefault(); end(); }, { passive: false });

  // ---- audio (all synthesized) -------------------------------------------
  var actx = null, master = null, outGain = null, muted = false, lastTick = 0;
  function unlock() {
    if (actx) { if (actx.state === "suspended") actx.resume(); return; }
    try {
      actx = new (window.AudioContext || window.webkitAudioContext)();
      var b = actx.createBuffer(1, 1, 22050); var s = actx.createBufferSource(); s.buffer = b; s.connect(actx.destination); s.start(0);
      outGain = actx.createGain(); outGain.gain.value = muted ? 0 : 1; outGain.connect(actx.destination);
      master = actx.createGain(); master.gain.value = 0.9; master.connect(outGain);
    } catch (e) { actx = null; }
  }
  function noise(dur) {
    var len = Math.floor(actx.sampleRate * dur), buf = actx.createBuffer(1, len, actx.sampleRate), d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    var s = actx.createBufferSource(); s.buffer = buf; return s;
  }
  // a soft graphite-on-paper tick as the line is drawn (throttled, very quiet)
  function penTick() {
    if (!actx || muted) return;
    var t = actx.currentTime;
    if (t - lastTick < 0.022) return; lastTick = t;
    var s = noise(0.03);
    var bp = actx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 1800 + Math.random() * 1400; bp.Q.value = 0.8;
    var g = actx.createGain(); g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.012, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
    s.connect(bp); bp.connect(g); g.connect(master); s.start(t); s.stop(t + 0.035);
  }
  // a rising chime whose brightness + harmony climb with the score
  function scoreChime(score) {
    if (!actx) return;
    var t = actx.currentTime, k = score / 100;
    // a major-pentatonic-ish run; more notes + higher the better the score
    var root = 220 * Math.pow(2, k * 1.2);         // ~220–500 Hz
    var ratios = [1, 1.25, 1.5, 1.875, 2];          // maj-ish steps
    var notes = 2 + Math.round(k * 3);              // 2..5 notes
    for (var i = 0; i < notes; i++) {
      var ti = t + i * 0.085;
      var f = root * ratios[i % ratios.length] * (i >= 5 ? 2 : 1);
      var o = actx.createOscillator(); o.type = "triangle"; o.frequency.value = f;
      var o2 = actx.createOscillator(); o2.type = "sine"; o2.frequency.value = f * 2;
      var o2g = actx.createGain(); o2g.gain.value = 0.18 + 0.3 * k;
      var lp = actx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 1200 + 4200 * k;
      var g = actx.createGain(); g.gain.setValueAtTime(0.0001, ti);
      g.gain.exponentialRampToValueAtTime(0.16, ti + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ti + 0.5);
      o.connect(lp); o2.connect(o2g); o2g.connect(lp); lp.connect(g); g.connect(master);
      o.start(ti); o.stop(ti + 0.55); o2.start(ti); o2.stop(ti + 0.55);
    }
  }
  // a bright shimmering bell for a new personal best
  function bestSparkle(score) {
    if (!actx) return;
    var t = actx.currentTime;
    for (var i = 0; i < 7; i++) {
      var ti = t + i * 0.05 + Math.random() * 0.02;
      var f = 1200 + Math.random() * 2600;
      var o = actx.createOscillator(); o.type = "sine"; o.frequency.value = f;
      var g = actx.createGain(); g.gain.setValueAtTime(0.0001, ti);
      g.gain.exponentialRampToValueAtTime(0.05, ti + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, ti + 0.4);
      o.connect(g); g.connect(master); o.start(ti); o.stop(ti + 0.42);
    }
  }

  var soundBtn = document.getElementById("soundBtn");
  if (soundBtn) {
    soundBtn.addEventListener("click", function () {
      muted = !muted; unlock();
      if (outGain) outGain.gain.setTargetAtTime(muted ? 0 : 1, actx.currentTime, 0.02);
      soundBtn.textContent = muted ? "Sound: off" : "Sound: on";
      soundBtn.setAttribute("aria-pressed", muted ? "true" : "false");
    });
  }

  // ---- rendering ----------------------------------------------------------
  function drawBackground() {
    var g = ctx.createRadialGradient(CX, CY * 0.92, 0, CX, CY, Math.max(W, H) * 0.72);
    g.addColorStop(0, "#121634");
    g.addColorStop(0.55, "#0b0e22");
    g.addColorStop(1, "#060815");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // a soft central glow + faint guide rings invite a circle, only before/while drawing
    if (!result) {
      var guide = Math.min(W, H) * 0.3;
      ctx.lineWidth = 1;
      for (var i = 1; i <= 3; i++) {
        ctx.strokeStyle = "rgba(150,180,240," + (0.05 - i * 0.011).toFixed(3) + ")";
        ctx.beginPath(); ctx.arc(CX, CY, guide * (i / 2.2), 0, 6.283); ctx.stroke();
      }
      ctx.fillStyle = "rgba(170,200,250,0.16)";
      ctx.beginPath(); ctx.arc(CX, CY, 2.2, 0, 6.283); ctx.fill();
    }
  }

  function drawLiveTrail() {
    if (pts.length < 2) return;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineJoin = "round"; ctx.lineCap = "round";
    // glow underlay
    ctx.strokeStyle = "rgba(120,200,255,0.16)"; ctx.lineWidth = 14;
    tracePath();
    // bright core
    ctx.strokeStyle = "rgba(210,240,255,0.95)"; ctx.lineWidth = 3.2;
    tracePath();
    ctx.restore();
    // leading dot
    var p = pts[pts.length - 1];
    ctx.save(); ctx.globalCompositeOperation = "lighter";
    var rg = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 16);
    rg.addColorStop(0, "rgba(230,248,255,0.9)"); rg.addColorStop(1, "rgba(120,200,255,0)");
    ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(p.x, p.y, 16, 0, 6.283); ctx.fill();
    ctx.restore();
  }
  function tracePath() {
    ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
    for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
  }

  // deviation → hue (green when on the ideal radius, red where it wandered)
  function devHue(dev) {
    var k = Math.min(1, dev / 0.16);
    return 145 * (1 - k);   // 145=green → 0=red
  }

  function drawResult(dt) {
    var r = result;
    // ideal ring (the circle you were aiming for)
    ctx.save();
    ctx.setLineDash([5, 9]); ctx.lineWidth = 1.4;
    ctx.strokeStyle = "rgba(180,205,250,0.35)";
    ctx.beginPath(); ctx.arc(r.cx, r.cy, r.R, 0, 6.283); ctx.stroke();
    ctx.restore();

    // your path, colored by how far each point sat from the ideal radius
    ctx.save();
    ctx.lineJoin = "round"; ctx.lineCap = "round";
    ctx.globalCompositeOperation = "lighter";
    for (var i = 1; i < pts.length; i++) {
      var dev = Math.abs(r.radii[i] - r.R) / r.R;
      var hue = devHue(dev);
      // glow
      ctx.strokeStyle = "hsla(" + hue + ",90%,55%,0.20)"; ctx.lineWidth = 11;
      ctx.beginPath(); ctx.moveTo(pts[i - 1].x, pts[i - 1].y); ctx.lineTo(pts[i].x, pts[i].y); ctx.stroke();
      // core
      ctx.strokeStyle = "hsla(" + hue + ",95%,70%,0.95)"; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(pts[i - 1].x, pts[i - 1].y); ctx.lineTo(pts[i].x, pts[i].y); ctx.stroke();
    }
    ctx.restore();

    // animate the displayed number up toward the score
    shown += (r.score - shown) * Math.min(1, dt * 6);
    if (r.score - shown < 0.05) shown = r.score;

    // big % in the middle of the drawn circle
    var fs = Math.max(34, Math.min(r.R * 0.62, 110));
    ctx.save();
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(244,250,255,0.97)";
    ctx.font = "700 " + fs + "px " + "Geist, sans-serif";
    ctx.shadowColor = "rgba(120,180,255,0.5)"; ctx.shadowBlur = 22;
    ctx.fillText(shown.toFixed(1) + "%", r.cx, r.cy - fs * 0.06);
    ctx.shadowBlur = 0;
    ctx.font = "600 " + (fs * 0.26) + "px Geist, sans-serif";
    ctx.fillStyle = r.isBest ? "rgba(150,240,200,0.95)" : "rgba(190,205,235,0.8)";
    ctx.fillText(r.isBest ? "★ NEW BEST" : r.label.toUpperCase(),
      r.cx, r.cy + fs * 0.46);
    ctx.font = "500 " + (fs * 0.2) + "px Geist, sans-serif";
    ctx.fillStyle = "rgba(170,186,220,0.6)";
    ctx.fillText("tap to try again", r.cx, r.cy + fs * 0.78);
    ctx.restore();
  }

  function drawConfetti(dt) {
    ctx.save(); ctx.globalCompositeOperation = "lighter";
    for (var i = confetti.length - 1; i >= 0; i--) {
      var c = confetti[i];
      c.vy += 520 * dt; c.vx *= Math.pow(0.5, dt);
      c.x += c.vx * dt; c.y += c.vy * dt; c.rot += c.vr * dt; c.life -= dt;
      if (c.life <= 0) { confetti.splice(i, 1); continue; }
      var a = Math.max(0, c.life / c.max);
      ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(c.rot);
      ctx.fillStyle = "hsla(" + c.hue + ",90%,62%," + (0.9 * a).toFixed(3) + ")";
      ctx.fillRect(-c.size * 0.5, -c.size * 0.5, c.size, c.size * 1.6);
      ctx.restore();
    }
    ctx.restore();
  }

  // ---- loop ---------------------------------------------------------------
  var lastTs = null;
  function frame(ts) {
    var dt = lastTs !== null ? Math.min((ts - lastTs) / 1000, 0.05) : 0.016;
    lastTs = ts;

    drawBackground();
    if (result) drawResult(dt);
    if (drawing) drawLiveTrail();
    if (flashT > 0) {
      flashT -= dt;
      ctx.save();
      ctx.fillStyle = "rgba(150,240,200," + (Math.max(0, flashT / 1.4) * 0.12).toFixed(3) + ")";
      ctx.fillRect(0, 0, W, H); ctx.restore();
    }
    if (confetti.length) drawConfetti(dt);

    requestAnimationFrame(frame);
  }

  resize();
  window.addEventListener("resize", resize);
  requestAnimationFrame(frame);
  setTimeout(function () { if (hintEl) hintEl.classList.add("is-hidden"); }, 9000);
})();
