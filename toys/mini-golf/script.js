/* Mini Golf — top-down one-hole putt. Vanilla Canvas 2D.
 * Drag back from the ball to aim + set power, release to putt. The ball
 * rolls with friction, banks off the walls and bumpers, and drops when it
 * reaches the cup slowly enough. Sink it to advance to the next hole. */
(function () {
  "use strict";

  var canvas = document.getElementById("canvas");
  var ctx = canvas.getContext("2d");
  var holePill = document.getElementById("holePill");
  var strokePill = document.getElementById("strokePill");
  var parPill = document.getElementById("parPill");
  var soundBtn = document.getElementById("soundBtn");
  var toast = document.getElementById("toast");
  var hintEl = document.getElementById("hint");

  var W = 0, H = 0, DPR = 1;

  // tunables
  var FRICTION = 1.7;         // exp damping per second
  var REST = 0.74;            // wall/bumper restitution
  var STOP = 10;             // speed below which the ball rests
  var SINK_SPEED = 320;      // must be slower than this over the cup to drop
  var MAXPULL, POWER_SCALE, BR, CUPR;

  var field = null;          // {x,y,w,h}
  var ball = null, cup = null, bumpers = [];
  var hole = 1, strokes = 0, par = 3;
  var aiming = false, aimX = 0, aimY = 0;
  var sinking = 0;           // sink animation progress 0..1
  var settled = true;        // ball at rest
  var soundOn = true;
  var pointerId = null;

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.floor(W * DPR); canvas.height = Math.floor(H * DPR);
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    var inset = Math.max(26, Math.min(W, H) * 0.06);
    var topPad = Math.max(64, H * 0.09);
    field = { x: inset, y: topPad, w: W - inset * 2, h: H - topPad - inset };
    BR = Math.max(9, Math.min(W, H) * 0.014);
    CUPR = BR * 1.55;
    MAXPULL = Math.min(W, H) * 0.30;
    POWER_SCALE = 1700 / MAXPULL;
    if (ball) clampIntoField();
  }
  window.addEventListener("resize", resize);

  function rnd(a, b) { return a + Math.random() * (b - a); }
  function dist(ax, ay, bx, by) { return Math.hypot(ax - bx, ay - by); }

  function clampIntoField() {
    if (!field || !ball) return;
    ball.x = Math.max(field.x + BR, Math.min(field.x + field.w - BR, ball.x));
    ball.y = Math.max(field.y + BR, Math.min(field.y + field.h - BR, ball.y));
  }

  function newHole() {
    resize();
    // ball on one side, cup on the other, alternating each hole for variety
    var leftFirst = hole % 2 === 1;
    var bx = leftFirst ? field.x + field.w * rnd(0.1, 0.24) : field.x + field.w * rnd(0.76, 0.9);
    var cx = leftFirst ? field.x + field.w * rnd(0.72, 0.9) : field.x + field.w * rnd(0.1, 0.28);
    ball = { x: bx, y: field.y + field.h * rnd(0.3, 0.7), vx: 0, vy: 0 };
    cup = { x: cx, y: field.y + field.h * rnd(0.2, 0.8) };
    // bumpers: 1-3 rectangles in the middle band, clear of ball & cup
    bumpers = [];
    var n = 1 + Math.floor(Math.random() * 3);
    var tries = 0;
    while (bumpers.length < n && tries < 60) {
      tries++;
      var bw = rnd(field.w * 0.06, field.w * 0.16), bh = rnd(field.h * 0.08, field.h * 0.3);
      var rx = rnd(field.x + field.w * 0.3, field.x + field.w * 0.7 - bw);
      var ry = rnd(field.y + field.h * 0.12, field.y + field.h * 0.88 - bh);
      var r = { x: rx, y: ry, w: bw, h: bh };
      if (rectNear(r, ball.x, ball.y, BR * 4) || rectNear(r, cup.x, cup.y, CUPR * 4)) continue;
      var overlap = false;
      for (var i = 0; i < bumpers.length; i++) if (rectsOverlap(r, bumpers[i], 24)) overlap = true;
      if (!overlap) bumpers.push(r);
    }
    strokes = 0; sinking = 0; settled = true; aiming = false;
    par = 3;
    updateHud();
  }
  function rectNear(r, px, py, pad) { return px > r.x - pad && px < r.x + r.w + pad && py > r.y - pad && py < r.y + r.h + pad; }
  function rectsOverlap(a, b, pad) { return a.x < b.x + b.w + pad && a.x + a.w + pad > b.x && a.y < b.y + b.h + pad && a.y + a.h + pad > b.y; }

  function updateHud() {
    holePill.textContent = "Hole " + hole;
    strokePill.textContent = "Strokes " + strokes;
    parPill.textContent = "Par " + par;
  }

  function showToast(msg, ms) {
    toast.textContent = msg; toast.hidden = false;
    requestAnimationFrame(function () { toast.classList.add("show"); });
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () { toast.classList.remove("show"); setTimeout(function () { toast.hidden = true; }, 240); }, ms || 1500);
  }

  // ---------- input ----------
  function evt(e) { var r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  function onDown(e) {
    unlock();
    if (!settled || sinking) return;
    var p = evt(e); pointerId = e.pointerId;
    aiming = true; aimX = p.x; aimY = p.y;
  }
  function onMove(e) { if (!aiming) return; var p = evt(e); aimX = p.x; aimY = p.y; }
  function onUp(e) {
    if (!aiming) return; aiming = false;
    var dx = ball.x - aimX, dy = ball.y - aimY;   // shot goes from pointer toward the ball (drag back)
    var pull = Math.min(Math.hypot(dx, dy), MAXPULL);
    if (pull < BR * 0.6) return;                    // too small — ignore
    var a = Math.atan2(dy, dx);
    ball.vx = Math.cos(a) * pull * POWER_SCALE;
    ball.vy = Math.sin(a) * pull * POWER_SCALE;
    strokes++; settled = false; updateHud();
    sndPutt(pull / MAXPULL);
  }
  canvas.addEventListener("pointerdown", onDown);
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", function () { aiming = false; });
  soundBtn.addEventListener("click", function () {
    soundOn = !soundOn; soundBtn.setAttribute("aria-pressed", soundOn ? "true" : "false");
    if (outGain) outGain.gain.value = soundOn ? 1 : 0; unlock();
  });

  // ---------- physics ----------
  function step(dt) {
    if (sinking > 0) { if (sinking < 1) { sinking = Math.min(1, sinking + dt * 3.2); if (sinking >= 1) advance(); } return; }
    if (settled) return;
    // integrate
    ball.x += ball.vx * dt; ball.y += ball.vy * dt;
    var damp = Math.exp(-FRICTION * dt);
    ball.vx *= damp; ball.vy *= damp;

    // walls
    if (ball.x - BR < field.x) { ball.x = field.x + BR; ball.vx = Math.abs(ball.vx) * REST; sndWall(); }
    if (ball.x + BR > field.x + field.w) { ball.x = field.x + field.w - BR; ball.vx = -Math.abs(ball.vx) * REST; sndWall(); }
    if (ball.y - BR < field.y) { ball.y = field.y + BR; ball.vy = Math.abs(ball.vy) * REST; sndWall(); }
    if (ball.y + BR > field.y + field.h) { ball.y = field.y + field.h - BR; ball.vy = -Math.abs(ball.vy) * REST; sndWall(); }

    // bumpers
    for (var i = 0; i < bumpers.length; i++) collideRect(bumpers[i]);

    // cup
    var d = dist(ball.x, ball.y, cup.x, cup.y);
    var spd = Math.hypot(ball.vx, ball.vy);
    if (d < CUPR) {
      if (spd < SINK_SPEED) { beginSink(); return; }
      else {                                   // lip-out: nudge around the rim + bleed speed
        var nx = (ball.x - cup.x) / (d || 1), ny = (ball.y - cup.y) / (d || 1);
        ball.vx = ball.vx * 0.86 + nx * 40; ball.vy = ball.vy * 0.86 + ny * 40;
      }
    }

    if (spd < STOP) { ball.vx = 0; ball.vy = 0; settled = true; }
  }
  function collideRect(r) {
    var nx = Math.max(r.x, Math.min(ball.x, r.x + r.w));
    var ny = Math.max(r.y, Math.min(ball.y, r.y + r.h));
    var dx = ball.x - nx, dy = ball.y - ny, d2 = dx * dx + dy * dy;
    if (d2 >= BR * BR) return;
    var d = Math.sqrt(d2) || 0.0001;
    var ux = dx / d, uy = dy / d;
    // if centre is inside the rect (d≈0), push out along the smaller penetration axis
    if (d < 0.5) {
      var left = ball.x - r.x, right = r.x + r.w - ball.x, top = ball.y - r.y, bot = r.y + r.h - ball.y;
      var m = Math.min(left, right, top, bot);
      if (m === left) { ux = -1; uy = 0; } else if (m === right) { ux = 1; uy = 0; } else if (m === top) { ux = 0; uy = -1; } else { ux = 0; uy = 1; }
    }
    ball.x = nx + ux * BR; ball.y = ny + uy * BR;
    var vdot = ball.vx * ux + ball.vy * uy;
    ball.vx = (ball.vx - 2 * vdot * ux) * REST; ball.vy = (ball.vy - 2 * vdot * uy) * REST;
    sndWall();
  }
  function beginSink() { sinking = 0.001; ball.vx = ball.vy = 0; settled = false; sndSink(); }
  function advance() {
    var ace = strokes === 1;
    showToast(ace ? "Hole-in-one! 🏌️" : "Hole " + hole + " in " + strokes + (strokes <= par ? " — nice!" : ""), 1600);
    if (ace) { try { var a = (parseInt(localStorage.getItem("golf_aces"), 10) || 0) + 1; localStorage.setItem("golf_aces", String(a)); } catch (e) {} sndAce(); }
    hole++;
    setTimeout(newHole, 900);
  }

  // ---------- render ----------
  function render() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    // rough (background)
    var bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#125b34"); bg.addColorStop(1, "#0d3f24");
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    if (!field) return;

    // green
    ctx.save();
    roundRect(field.x, field.y, field.w, field.h, 18); ctx.clip();
    var gg = ctx.createRadialGradient(field.x + field.w * 0.4, field.y + field.h * 0.35, 40, field.x + field.w * 0.5, field.y + field.h * 0.5, Math.max(field.w, field.h) * 0.75);
    gg.addColorStop(0, "#2fae63"); gg.addColorStop(1, "#1f8f4e");
    ctx.fillStyle = gg; ctx.fillRect(field.x, field.y, field.w, field.h);
    // mow stripes
    ctx.globalAlpha = 0.06; ctx.fillStyle = "#ffffff";
    for (var sx = field.x; sx < field.x + field.w; sx += 48) ctx.fillRect(sx, field.y, 24, field.h);
    ctx.globalAlpha = 1;
    ctx.restore();

    // green border wall
    ctx.strokeStyle = "#0c3a21"; ctx.lineWidth = 8; roundRect(field.x, field.y, field.w, field.h, 18); ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,0.12)"; ctx.lineWidth = 2; roundRect(field.x + 4, field.y + 4, field.w - 8, field.h - 8, 15); ctx.stroke();

    // bumpers
    for (var i = 0; i < bumpers.length; i++) {
      var r = bumpers[i];
      roundRect(r.x, r.y, r.w, r.h, 8);
      var bgr = ctx.createLinearGradient(r.x, r.y, r.x, r.y + r.h);
      bgr.addColorStop(0, "#c48a53"); bgr.addColorStop(1, "#8a5a2f");
      ctx.fillStyle = bgr; ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.28)"; ctx.lineWidth = 2; roundRect(r.x, r.y, r.w, r.h, 8); ctx.stroke();
      ctx.strokeStyle = "rgba(255,255,255,0.18)"; ctx.lineWidth = 1.5; roundRect(r.x + 3, r.y + 3, r.w - 6, r.h - 6, 6); ctx.stroke();
    }

    // cup
    ctx.beginPath(); ctx.arc(cup.x, cup.y, CUPR, 0, Math.PI * 2);
    ctx.fillStyle = "#08240f"; ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.5)"; ctx.lineWidth = 2; ctx.stroke();
    ctx.beginPath(); ctx.arc(cup.x, cup.y, CUPR * 0.66, 0, Math.PI * 2); ctx.fillStyle = "#04160a"; ctx.fill();
    // flag
    var poleH = Math.max(46, CUPR * 4.2);
    ctx.strokeStyle = "#e9edf2"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(cup.x, cup.y); ctx.lineTo(cup.x, cup.y - poleH); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cup.x, cup.y - poleH); ctx.lineTo(cup.x + 30, cup.y - poleH + 9); ctx.lineTo(cup.x, cup.y - poleH + 18); ctx.closePath();
    ctx.fillStyle = "#e5484d"; ctx.fill();

    // aim preview
    if (aiming && settled) drawAim();

    // ball
    if (sinking <= 0 || sinking < 1) {
      var br = BR * (sinking > 0 ? (1 - sinking * 0.85) : 1);
      var bxp = sinking > 0 ? ball.x + (cup.x - ball.x) * sinking : ball.x;
      var byp = sinking > 0 ? ball.y + (cup.y - ball.y) * sinking : ball.y;
      ctx.save();
      ctx.beginPath(); ctx.ellipse(bxp + br * 0.3, byp + br * 0.5, br, br * 0.7, 0, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(0,0,0,0.22)"; ctx.fill();
      var bg2 = ctx.createRadialGradient(bxp - br * 0.35, byp - br * 0.4, br * 0.15, bxp, byp, br);
      bg2.addColorStop(0, "#ffffff"); bg2.addColorStop(1, "#cdd3da");
      ctx.beginPath(); ctx.arc(bxp, byp, br, 0, Math.PI * 2); ctx.fillStyle = bg2; ctx.fill();
      ctx.restore();
    }
  }

  function drawAim() {
    var dx = ball.x - aimX, dy = ball.y - aimY;
    var pull = Math.min(Math.hypot(dx, dy), MAXPULL);
    if (pull < 2) return;
    var a = Math.atan2(dy, dx), frac = pull / MAXPULL;
    // Short aim guide only — direction plus a hint of power via its length.
    // (No full trajectory / wall-bounce prediction — that let you line the dots
    // straight into the cup, which felt like a cheat.)
    var len = BR + 16 + frac * Math.min(W, H) * 0.13;
    var ex = ball.x + Math.cos(a) * len, ey = ball.y + Math.sin(a) * len;
    ctx.save();
    ctx.setLineDash([4, 8]); ctx.lineWidth = 3; ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(255,255,255,0.7)";
    ctx.beginPath(); ctx.moveTo(ball.x, ball.y); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.setLineDash([]);
    // arrowhead at the tip
    var ah = 8;
    ctx.beginPath();
    ctx.moveTo(ex, ey); ctx.lineTo(ex - Math.cos(a - 0.42) * ah, ey - Math.sin(a - 0.42) * ah);
    ctx.moveTo(ex, ey); ctx.lineTo(ex - Math.cos(a + 0.42) * ah, ey - Math.sin(a + 0.42) * ah);
    ctx.strokeStyle = "rgba(255,255,255,0.85)"; ctx.lineWidth = 3; ctx.stroke();
    // power ring on the ball (green → red as power rises)
    var col = "hsl(" + (120 - frac * 120) + ",85%,55%)";
    ctx.beginPath(); ctx.arc(ball.x, ball.y, BR + 5, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2); ctx.strokeStyle = col; ctx.lineWidth = 4; ctx.stroke();
    ctx.restore();
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  var last = 0;
  function frame(ts) {
    var dt = last ? Math.min((ts - last) / 1000, 0.04) : 0; last = ts;
    step(dt); render();
    requestAnimationFrame(frame);
  }

  // ============================ AUDIO ============================
  var actx = null, master = null, outGain = null, convo = null, wet = null;
  function initAudio() {
    if (actx) return;
    try {
      actx = new (window.AudioContext || window.webkitAudioContext)();
      outGain = actx.createGain(); outGain.gain.value = soundOn ? 1 : 0;
      master = actx.createGain(); master.gain.value = 0.9;
      convo = actx.createConvolver(); convo.buffer = makeImpulse(1.0, 3);
      wet = actx.createGain(); wet.gain.value = 0.12;
      master.connect(outGain); wet.connect(convo); convo.connect(outGain); outGain.connect(actx.destination);
    } catch (e) { actx = null; }
  }
  function makeImpulse(dur, decay) {
    var n = Math.floor(actx.sampleRate * dur), buf = actx.createBuffer(2, n, actx.sampleRate);
    for (var ch = 0; ch < 2; ch++) { var d = buf.getChannelData(ch); for (var i = 0; i < n; i++) { var t = i / n; d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay); } }
    return buf;
  }
  function unlock() { initAudio(); if (actx && actx.state === "suspended") actx.resume(); if (actx) { var b = actx.createBuffer(1, 1, 22050), s = actx.createBufferSource(); s.buffer = b; s.connect(actx.destination); s.start(0); } }
  function bus(g) { g.connect(master); g.connect(wet); }
  function noise(dur) { var n = Math.floor(actx.sampleRate * dur), b = actx.createBuffer(1, n, actx.sampleRate), d = b.getChannelData(0); for (var i = 0; i < n; i++)d[i] = Math.random() * 2 - 1; var s = actx.createBufferSource(); s.buffer = b; return s; }
  function sndPutt(f) {
    if (!actx || !soundOn) return;
    var t = actx.currentTime;
    var o = actx.createOscillator(); o.type = "sine"; o.frequency.setValueAtTime(240 + f * 120, t); o.frequency.exponentialRampToValueAtTime(120, t + 0.09);
    var g = actx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12 + f * 0.12, t + 0.006); g.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
    o.connect(g); bus(g); o.start(t); o.stop(t + 0.15);
    var s = noise(0.03), bp = actx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 1800;
    var g2 = actx.createGain(); g2.gain.setValueAtTime(0.08 + f * 0.06, t); g2.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
    s.connect(bp); bp.connect(g2); bus(g2); s.start(t); s.stop(t + 0.04);
  }
  var lastWall = 0;
  function sndWall() {
    if (!actx || !soundOn) return; var now = actx.currentTime; if (now - lastWall < 0.04) return; lastWall = now;
    var spd = Math.min(1, Math.hypot(ball.vx, ball.vy) / 900);
    if (spd < 0.05) return;
    var s = noise(0.04), bp = actx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 380; bp.Q.value = 2;
    var g = actx.createGain(); g.gain.setValueAtTime(0.12 * spd, now); g.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
    s.connect(bp); bp.connect(g); bus(g); s.start(now); s.stop(now + 0.06);
  }
  function sndSink() {
    if (!actx || !soundOn) return;
    var t = actx.currentTime;
    var o = actx.createOscillator(); o.type = "sine"; o.frequency.setValueAtTime(520, t); o.frequency.exponentialRampToValueAtTime(180, t + 0.18);
    var g = actx.createGain(); g.gain.setValueAtTime(0.18, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    o.connect(g); bus(g); o.start(t); o.stop(t + 0.24);
    var s = noise(0.05), bp = actx.createBiquadFilter(); bp.type = "lowpass"; bp.frequency.value = 500;
    var g2 = actx.createGain(); g2.gain.setValueAtTime(0.1, t + 0.02); g2.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    s.connect(bp); bp.connect(g2); bus(g2); s.start(t + 0.02); s.stop(t + 0.12);
  }
  function sndAce() {
    if (!actx || !soundOn) return;
    var t = actx.currentTime, notes = [0, 4, 7, 12, 16];
    notes.forEach(function (st, i) { var o = actx.createOscillator(); o.type = "triangle"; o.frequency.value = 523.25 * Math.pow(2, st / 12); var g = actx.createGain(); var tt = t + 0.14 + i * 0.08; g.gain.setValueAtTime(0, tt); g.gain.linearRampToValueAtTime(0.16, tt + 0.01); g.gain.exponentialRampToValueAtTime(0.001, tt + 0.45); o.connect(g); bus(g); o.start(tt); o.stop(tt + 0.47); });
  }

  // ---------- boot ----------
  newHole();
  setTimeout(function () { hintEl.classList.add("is-gone"); }, 6500);
  requestAnimationFrame(frame);
})();
