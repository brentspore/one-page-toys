(function () {
  "use strict";

  var canvas = document.getElementById("canvas");
  var ctx = canvas.getContext("2d");
  var hintEl = document.getElementById("hint");

  var W, H, CX, CY, SCALE, DPR;

  function resize() {
    DPR = Math.min(2, window.devicePixelRatio || 1);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = W * DPR; canvas.height = H * DPR;
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    CX = W / 2; CY = H / 2;
    SCALE = Math.min(W, H) * 0.40;
  }
  resize();
  window.addEventListener("resize", function () { resize(); ctx.clearRect(0, 0, W, H); startPattern(patIdx, false); });

  /* Hypotrochoid: inner circle (r) rolls inside outer (R), pen offset d.
   * Coprime R,r with R large → many petals. We draw several pen-offsets (holes)
   * per pattern, sharing one scale so they nest into a layered rosette. */
  var PATTERNS = [
    [11, 4], [13, 5], [9, 4], [13, 6], [11, 3], [12, 5],
    [13, 4], [11, 5], [14, 5], [16, 5], [9, 2], [15, 4], [13, 7], [17, 6]
  ];
  var LAYERS = [0.95, 0.72, 0.5, 0.3];     /* pen holes, fraction of r (must be ≤ r) */

  var STEPS_PER_FRAME = 52;
  var TOTAL_STEPS = 4600;
  var HOLD_FRAMES = 130;     /* admire the finished rosette before it fades */
  var FADE_FRAMES = 70;

  var patIdx = 0, hueBase = 0, t = 0, stepsDone = 0;
  var phase = "draw", waitCount = 0, prev = [];

  function gcd(a, b) { return b === 0 ? a : gcd(b, a % b); }

  function point(R, r, d, angle, maxR) {
    var k = (R - r) / r;
    var x = (R - r) * Math.cos(angle) + d * Math.cos(k * angle);
    var y = (R - r) * Math.sin(angle) - d * Math.sin(k * angle);
    return { x: CX + (x / maxR) * SCALE, y: CY + (y / maxR) * SCALE };
  }

  function startPattern(idx, keepCanvas) {
    var p = PATTERNS[idx % PATTERNS.length];
    var R = p[0], r = p[1];
    var dmax = 0.95 * r;
    canvas._R = R; canvas._r = r;
    canvas._ds = LAYERS.map(function (f) { return f * r; });
    canvas._maxR = (R - r) + dmax;
    canvas._period = 2 * Math.PI * (r / gcd(R, r));
    canvas._dt = canvas._period / TOTAL_STEPS;
    t = 0; stepsDone = 0; prev = [];
    if (!keepCanvas) ctx.clearRect(0, 0, W, H);
  }

  function nextPattern() {
    patIdx = (patIdx + 1) % PATTERNS.length;
    hueBase = (hueBase + 67) % 360;
    phase = "draw";
    startPattern(patIdx, false);
    if (hintEl) hintEl.classList.add("is-hidden");
  }

  function drawSteps() {
    var R = canvas._R, r = canvas._r, ds = canvas._ds, maxR = canvas._maxR, dt = canvas._dt;
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    for (var i = 0; i < STEPS_PER_FRAME && stepsDone < TOTAL_STEPS; i++) {
      var progress = stepsDone / TOTAL_STEPS;
      for (var j = 0; j < ds.length; j++) {
        var p = point(R, r, ds[j], t, maxR);
        var pr = prev[j];
        if (pr) {
          var hue = (hueBase + j * 42 + progress * 220) % 360;
          ctx.shadowBlur = 8;
          ctx.shadowColor = "hsla(" + hue + ",95%,62%,0.5)";
          ctx.strokeStyle = "hsla(" + hue + ",90%,64%,0.7)";
          ctx.lineWidth = 1.7 - j * 0.18;
          ctx.beginPath();
          ctx.moveTo(pr.x, pr.y);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
        }
        prev[j] = p;
      }
      t += dt; stepsDone++;
    }
    ctx.shadowBlur = 0;
  }

  function frame() {
    if (phase === "draw") {
      drawSteps();
      if (stepsDone >= TOTAL_STEPS) { phase = "hold"; waitCount = 0; }
    } else if (phase === "hold") {
      if (++waitCount >= HOLD_FRAMES) { phase = "fade"; waitCount = 0; }
    } else { // fade
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "rgba(6,6,15,0.06)";
      ctx.fillRect(0, 0, W, H);
      if (++waitCount >= FADE_FRAMES) nextPattern();
    }
    requestAnimationFrame(frame);
  }

  canvas.addEventListener("pointerdown", function (e) { e.preventDefault(); nextPattern(); });

  hueBase = Math.random() * 360 | 0;
  startPattern(patIdx, false);
  requestAnimationFrame(frame);
})();
