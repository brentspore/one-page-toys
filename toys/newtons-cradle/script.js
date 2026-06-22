(function () {
  "use strict";

  var canvas = document.getElementById("canvas");
  var ctx = canvas.getContext("2d");
  var hintEl = document.getElementById("hint");
  var buttons = [].slice.call(document.querySelectorAll(".btn"));

  var N = 5;           /* number of balls */
  var G = 9.81;        /* gravity m/s² */
  var L_METERS = 0.32; /* string length in meters */
  var LAUNCH_ANGLE = Math.PI * 0.40; /* ~72° pull */
  var DAMP = 0.00055;  /* per-second energy fraction lost */

  /* layout (set in resize) */
  var W, H, L_px, R, spacing, pivotY, firstPivotX;

  /* physics state — "group" model for perfect Newton's Cradle behaviour */
  var leftCount = 0,  rightCount = 0;
  var leftTheta = 0,  leftOmega = 0;
  var rightTheta = 0, rightOmega = 0;
  var lastTs = null;

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
  function clack() {
    if (!actx) return;
    var now = actx.currentTime;
    var o = actx.createOscillator();
    var g = actx.createGain();
    o.type = "triangle";
    o.frequency.setValueAtTime(1100, now);
    o.frequency.exponentialRampToValueAtTime(600, now + 0.045);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(0.38, now + 0.003);
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

  /* launch */
  function launch(n) {
    ensureAudio();
    leftCount = n; leftTheta = -LAUNCH_ANGLE; leftOmega = 0;
    rightCount = 0; rightTheta = 0; rightOmega = 0;
    if (hintEl) hintEl.classList.add("is-hidden");
    buttons.forEach(function (b) {
      b.classList.toggle("is-active", +b.dataset.n === n);
    });
  }

  /* physics step */
  function step(dt) {
    dt = Math.min(dt, 0.05); /* clamp to avoid explosions on tab-switch */
    var GL = G / L_METERS;

    if (leftCount > 0) {
      leftOmega += -GL * Math.sin(leftTheta) * dt;
      leftOmega *= Math.pow(1 - DAMP, dt);
      leftTheta += leftOmega * dt;

      /* collision: left group crosses bottom moving right */
      if (leftTheta >= -0.001 && leftOmega > 0) {
        rightCount = leftCount; rightTheta = 0.001; rightOmega = leftOmega;
        leftCount = 0; leftTheta = 0; leftOmega = 0;
        clack();
      }
    }

    if (rightCount > 0) {
      rightOmega += -GL * Math.sin(rightTheta) * dt;
      rightOmega *= Math.pow(1 - DAMP, dt);
      rightTheta += rightOmega * dt;

      /* collision: right group crosses bottom moving left */
      if (rightTheta <= 0.001 && rightOmega < 0) {
        leftCount = rightCount; leftTheta = -0.001; leftOmega = rightOmega;
        rightCount = 0; rightTheta = 0; rightOmega = 0;
        clack();
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
  function drawFrame() {
    var frameW = (N - 1) * spacing + R * 3.0;
    var frameX = W / 2 - frameW / 2;
    var barThick = 5;
    var postThick = 4;
    var topBarY = H * 0.08;
    var postH = pivotY - topBarY - barThick;

    /* horizontal top bar */
    var barGrad = ctx.createLinearGradient(frameX, 0, frameX + frameW, 0);
    barGrad.addColorStop(0, "#3a4252");
    barGrad.addColorStop(0.25, "#7a8ca8");
    barGrad.addColorStop(0.5, "#9aaabb");
    barGrad.addColorStop(0.75, "#7a8ca8");
    barGrad.addColorStop(1, "#3a4252");
    ctx.fillStyle = barGrad;
    ctx.fillRect(frameX - barThick, topBarY, frameW + barThick * 2, barThick);

    /* two slim vertical posts — no bottom bar */
    var postGrad = ctx.createLinearGradient(0, topBarY, 0, topBarY + postH);
    postGrad.addColorStop(0, "#7a8ca8");
    postGrad.addColorStop(0.5, "#5a6878");
    postGrad.addColorStop(1, "#3a4858");
    ctx.fillStyle = postGrad;
    ctx.fillRect(frameX - barThick, topBarY, postThick, postH);
    ctx.fillRect(frameX + frameW + barThick - postThick, topBarY, postThick, postH);

    /* small angled feet */
    var footLen = Math.min(R * 2.5, 30);
    ctx.strokeStyle = "#4a5868";
    ctx.lineWidth = postThick - 1;
    ctx.lineCap = "round";
    var leftPost = frameX - barThick + postThick / 2;
    var rightPost = frameX + frameW + barThick - postThick / 2;
    var footY = topBarY + postH;
    ctx.beginPath();
    ctx.moveTo(leftPost, footY - 4);
    ctx.lineTo(leftPost - footLen, footY + footLen * 0.5);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(leftPost, footY - 4);
    ctx.lineTo(leftPost + footLen * 0.6, footY + footLen * 0.5);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(rightPost, footY - 4);
    ctx.lineTo(rightPost + footLen, footY + footLen * 0.5);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(rightPost, footY - 4);
    ctx.lineTo(rightPost - footLen * 0.6, footY + footLen * 0.5);
    ctx.stroke();
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

      /* ball body */
      var ballGrad = ctx.createRadialGradient(p.x - R * 0.3, p.y - R * 0.3, R * 0.05, p.x, p.y, R);
      ballGrad.addColorStop(0, "#ccd6e8");
      ballGrad.addColorStop(0.35, "#8a9eb8");
      ballGrad.addColorStop(0.75, "#445870");
      ballGrad.addColorStop(1, "#1a2535");
      ctx.fillStyle = ballGrad;
      ctx.beginPath();
      ctx.arc(p.x, p.y, R, 0, Math.PI * 2);
      ctx.fill();

      /* specular highlight */
      var shine = ctx.createRadialGradient(p.x - R * 0.28, p.y - R * 0.32, 0, p.x - R * 0.28, p.y - R * 0.32, R * 0.42);
      shine.addColorStop(0, "rgba(255,255,255,0.82)");
      shine.addColorStop(0.5, "rgba(255,255,255,0.25)");
      shine.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = shine;
      ctx.beginPath();
      ctx.arc(p.x, p.y, R, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /* render loop */
  function render(ts) {
    if (lastTs !== null) step((ts - lastTs) / 1000);
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

  /* controls */
  buttons.forEach(function (btn) {
    btn.addEventListener("click", function () { launch(+btn.dataset.n); });
  });

  /* auto-start with 1 ball */
  launch(1);
})();
