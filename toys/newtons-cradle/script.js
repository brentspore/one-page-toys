(function () {
  "use strict";

  var canvas = document.getElementById("canvas");
  var ctx = canvas.getContext("2d");
  var hintEl = document.getElementById("hint");
  var loopBtn = document.getElementById("loopBtn");

  var N = 5;           /* number of balls */
  var G = 9.81;        /* gravity m/s² */
  var L_METERS = 0.32; /* string length in meters */
  var LAUNCH_ANGLE = Math.PI * 0.40; /* ~72° pull */
  var DAMP = 0.12;     /* energy lost per second — it rings, then settles (~30s) */
  var REST_OMEGA = 0.14; /* below this speed at a crossing, snap to full rest */

  /* layout (set in resize) */
  var W, H, L_px, R, spacing, pivotY, firstPivotX;

  /* physics state — "group" model for perfect Newton's Cradle behaviour */
  var leftCount = 0,  rightCount = 0;
  var leftTheta = 0,  leftOmega = 0;
  var rightTheta = 0, rightOmega = 0;
  var lastTs = null;
  var dragSide = null;   /* 'left' | 'right' while a ball is being pulled */
  var dragPivotX = 0;    /* pivot x of the grabbed ball */
  var loop = false;      /* endless auto-swing (damping off) */

  /* audio */
  var actx = null;
  function ensureAudio() {
    if (actx) { if (actx.state === "suspended") actx.resume(); return; }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    actx = new AC();
    try { var b = actx.createBuffer(1,1,22050); var s = actx.createBufferSource(); s.buffer=b; s.connect(actx.destination); s.start(0); } catch(e){}
    if (actx.state === "suspended") actx.resume();
  }
  function clack(speed) {
    if (!actx) return;
    var vol = Math.min(0.45, Math.abs(speed) * 0.11);  // quieter as the swing fades
    if (vol < 0.012) return;
    var now = actx.currentTime;
    var o = actx.createOscillator();
    var g = actx.createGain();
    o.type = "triangle";
    o.frequency.setValueAtTime(1100, now);
    o.frequency.exponentialRampToValueAtTime(600, now + 0.045);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(vol, now + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.055);
    o.connect(g); g.connect(actx.destination);
    o.start(now); o.stop(now + 0.06);
  }

  /* layout */
  function resize() {
    W = canvas.width = window.innerWidth;
    H = canvas.height = window.innerHeight;
    L_px = Math.min(H * 0.40, W * 0.30);
    R = Math.min(L_px * 0.115, W * 0.05, 30);
    spacing = R * 2 + 1;
    firstPivotX = W / 2 - (N - 1) * spacing / 2;
    pivotY = H * 0.26;
  }
  resize();
  window.addEventListener("resize", resize);

  function toRest() {
    leftCount = 0; rightCount = 0; leftTheta = 0; rightTheta = 0; leftOmega = 0; rightOmega = 0;
  }

  /* launch n balls from the left (used by the endless auto-swing) */
  function launch(n) {
    ensureAudio();
    leftCount = n; leftTheta = -LAUNCH_ANGLE; leftOmega = 0;
    rightCount = 0; rightTheta = 0; rightOmega = 0;
    if (hintEl) hintEl.classList.add("is-hidden");
  }

  /* physics step */
  function step(dt) {
    dt = Math.min(dt, 0.05); /* clamp to avoid explosions on tab-switch */
    var GL = G / L_METERS;
    var damp = loop ? 1 : Math.pow(1 - DAMP, dt);  // endless mode keeps all its energy

    if (leftCount > 0) {
      leftOmega += -GL * Math.sin(leftTheta) * dt;
      leftOmega *= damp;
      leftTheta += leftOmega * dt;

      /* collision: left group crosses bottom moving right */
      if (leftTheta >= -0.001 && leftOmega > 0) {
        if (!loop && leftOmega < REST_OMEGA) { toRest(); return; }
        rightCount = leftCount; rightTheta = 0.001; rightOmega = leftOmega;
        leftCount = 0; leftTheta = 0; leftOmega = 0;
        clack(rightOmega);
      }
    }

    if (rightCount > 0) {
      rightOmega += -GL * Math.sin(rightTheta) * dt;
      rightOmega *= damp;
      rightTheta += rightOmega * dt;

      /* collision: right group crosses bottom moving left */
      if (rightTheta <= 0.001 && rightOmega < 0) {
        if (!loop && -rightOmega < REST_OMEGA) { toRest(); return; }
        leftCount = rightCount; leftTheta = -0.001; leftOmega = rightOmega;
        rightCount = 0; rightTheta = 0; rightOmega = 0;
        clack(leftOmega);
      }
    }
  }

  /* ball position given index and group state */
  function ballPos(i) {
    var theta = 0;
    if (i < leftCount) {
      theta = leftTheta;
    } else if (i >= N - rightCount) {
      theta = rightTheta;
    }
    return {
      x: firstPivotX + i * spacing + L_px * Math.sin(theta),
      y: pivotY + L_px * Math.cos(theta),
      px: firstPivotX + i * spacing,
      py: pivotY,
    };
  }

  /* drawing */
  function rrect(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* a proper rectangular cradle: top bar (strings attach here), side posts down
     to a grounded base platform below the balls */
  function drawFrame() {
    var frameW = (N - 1) * spacing + R * 3.2;
    var frameX = W / 2 - frameW / 2;
    var bar = Math.max(7, R * 0.36);
    var post = Math.max(6, R * 0.28);
    var baseY = pivotY + L_px + R * 1.7;
    var topY = pivotY - bar;                  // bar underside sits at the string pivot

    // side posts (cylindrical metal)
    var postXs = [frameX + post / 2, frameX + frameW - post / 2];
    for (var s = 0; s < 2; s++) {
      var px = postXs[s];
      var pg = ctx.createLinearGradient(px - post / 2, 0, px + post / 2, 0);
      pg.addColorStop(0, "#39424f"); pg.addColorStop(0.5, "#8a98a8"); pg.addColorStop(1, "#39424f");
      ctx.fillStyle = pg;
      rrect(px - post / 2, topY, post, baseY - topY, post * 0.4); ctx.fill();
    }

    // base platform (sits on the floor) + floor shadow
    var baseThick = Math.max(12, R * 0.55);
    var baseW = frameW + R * 1.6;
    var baseX = W / 2 - baseW / 2;
    var fsh = ctx.createRadialGradient(W / 2, baseY + baseThick, 0, W / 2, baseY + baseThick, baseW * 0.62);
    fsh.addColorStop(0, "rgba(0,0,0,0.5)"); fsh.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = fsh;
    ctx.beginPath(); ctx.ellipse(W / 2, baseY + baseThick, baseW * 0.6, baseThick * 0.8, 0, 0, Math.PI * 2); ctx.fill();
    var bgrad = ctx.createLinearGradient(0, baseY, 0, baseY + baseThick);
    bgrad.addColorStop(0, "#aeb9c7"); bgrad.addColorStop(0.18, "#7c8a9a"); bgrad.addColorStop(1, "#2c343f");
    ctx.fillStyle = bgrad;
    rrect(baseX, baseY, baseW, baseThick, 5); ctx.fill();

    // top bar (cylindrical, light on top)
    var tg = ctx.createLinearGradient(0, topY, 0, topY + bar);
    tg.addColorStop(0, "#c2cdda"); tg.addColorStop(0.45, "#7d8b9c"); tg.addColorStop(1, "#3a4451");
    ctx.fillStyle = tg;
    rrect(frameX, topY, frameW, bar, bar * 0.45); ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.35)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(frameX + bar, topY + 1.5); ctx.lineTo(frameX + frameW - bar, topY + 1.5); ctx.stroke();
  }

  function drawBalls() {
    for (var i = 0; i < N; i++) {
      var p = ballPos(i);

      /* strings */
      ctx.strokeStyle = "rgba(180,195,220,0.45)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(p.px - R * 0.3, pivotY);
      ctx.lineTo(p.x - R * 0.3, p.y - R);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(p.px + R * 0.3, pivotY);
      ctx.lineTo(p.x + R * 0.3, p.y - R);
      ctx.stroke();

      /* shadow */
      var shadow = ctx.createRadialGradient(p.x, p.y + R * 0.7, 0, p.x, p.y + R * 0.7, R * 1.1);
      shadow.addColorStop(0, "rgba(0,0,0,0.45)");
      shadow.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = shadow;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y + R * 0.72, R * 1.1, R * 0.35, 0, 0, Math.PI * 2);
      ctx.fill();

      /* chrome ball body — neutral polished steel */
      var ballGrad = ctx.createRadialGradient(p.x - R * 0.34, p.y - R * 0.38, R * 0.05, p.x, p.y, R * 1.05);
      ballGrad.addColorStop(0, "#f4f7fb");
      ballGrad.addColorStop(0.26, "#cbd3de");
      ballGrad.addColorStop(0.58, "#737f8d");
      ballGrad.addColorStop(0.84, "#39414c");
      ballGrad.addColorStop(1, "#1d232b");
      ctx.fillStyle = ballGrad;
      ctx.beginPath();
      ctx.arc(p.x, p.y, R, 0, Math.PI * 2);
      ctx.fill();

      /* floor-bounce rim light near the bottom edge (sells the chrome) */
      var rim = ctx.createRadialGradient(p.x, p.y + R * 0.55, 0, p.x, p.y + R * 0.55, R * 0.7);
      rim.addColorStop(0, "rgba(150,170,200,0.5)");
      rim.addColorStop(1, "rgba(150,170,200,0)");
      ctx.fillStyle = rim;
      ctx.beginPath(); ctx.arc(p.x, p.y, R, 0, Math.PI * 2); ctx.fill();

      /* soft + sharp specular highlights */
      var shine = ctx.createRadialGradient(p.x - R * 0.3, p.y - R * 0.34, 0, p.x - R * 0.3, p.y - R * 0.34, R * 0.5);
      shine.addColorStop(0, "rgba(255,255,255,0.7)");
      shine.addColorStop(0.6, "rgba(255,255,255,0.12)");
      shine.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = shine;
      ctx.beginPath(); ctx.arc(p.x, p.y, R, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.beginPath(); ctx.arc(p.x - R * 0.32, p.y - R * 0.36, R * 0.12, 0, Math.PI * 2); ctx.fill();
    }
  }

  /* render loop */
  function render(ts) {
    if (lastTs !== null && !dragSide) step((ts - lastTs) / 1000);
    lastTs = ts;

    ctx.clearRect(0, 0, W, H);

    /* background */
    var bg = ctx.createRadialGradient(W / 2, H * 0.42, 0, W / 2, H * 0.42, Math.max(W, H) * 0.7);
    bg.addColorStop(0, "#161b26");
    bg.addColorStop(1, "#0b0c10");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    drawFrame();
    drawBalls();

    requestAnimationFrame(render);
  }
  requestAnimationFrame(render);

  /* drag a ball to pull it back, release to swing */
  function ptr(e) { var r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  function updateDrag(m) {
    var th = Math.atan2(m.x - dragPivotX, Math.max(8, m.y - pivotY));
    if (dragSide === "left") { leftTheta = Math.max(-1.45, Math.min(0, th)); leftOmega = 0; }
    else if (dragSide === "right") { rightTheta = Math.min(1.45, Math.max(0, th)); rightOmega = 0; }
  }
  canvas.addEventListener("pointerdown", function (e) {
    ensureAudio();
    var m = ptr(e);
    // grab the nearest ball; the group is that ball through its near end (pull as many as you reach)
    var best = -1, bd = R * 2.4;
    for (var i = 0; i < N; i++) {
      var p = ballPos(i), d = Math.hypot(m.x - p.x, m.y - p.y);
      if (d < bd) { bd = d; best = i; }
    }
    if (best < 0) return;
    toRest();
    if (best <= (N - 1) / 2) { dragSide = "left"; leftCount = best + 1; }
    else { dragSide = "right"; rightCount = N - best; }
    dragPivotX = firstPivotX + best * spacing;
    if (hintEl) hintEl.classList.add("is-hidden");
    try { canvas.setPointerCapture(e.pointerId); } catch (er) {}
    updateDrag(m); e.preventDefault();
  });
  canvas.addEventListener("pointermove", function (e) { if (dragSide) { updateDrag(ptr(e)); e.preventDefault(); } });
  window.addEventListener("pointerup", function () { dragSide = null; });
  window.addEventListener("pointercancel", function () { dragSide = null; });

  /* endless auto-swing toggle */
  loopBtn.addEventListener("click", function () {
    loop = !loop;
    loopBtn.classList.toggle("is-active", loop);
    loopBtn.setAttribute("aria-pressed", loop ? "true" : "false");
    loopBtn.textContent = loop ? "Stop" : "Auto-swing";
    if (loop) { ensureAudio(); if (leftCount === 0 && rightCount === 0) launch(2); }
  });
})();
