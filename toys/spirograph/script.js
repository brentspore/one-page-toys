(function () {
  "use strict";

  var canvas = document.getElementById("canvas");
  var ctx = canvas.getContext("2d");
  var hintEl = document.getElementById("hint");

  var W, H, CX, CY, SCALE;

  function resize() {
    W = canvas.width = window.innerWidth;
    H = canvas.height = window.innerHeight;
    CX = W / 2;
    CY = H / 2;
    SCALE = Math.min(W, H) * 0.44;
  }
  resize();
  window.addEventListener("resize", function () { resize(); nextPattern(true); });

  /* Hypotrochoid: inner circle (radius r) rolls inside outer circle (radius R).
   * Pen offset d from center of inner circle.
   * x(t) = (R-r)*cos(t) + d*cos((R-r)*t/r)
   * y(t) = (R-r)*sin(t) - d*sin((R-r)*t/r)
   * Full period: 2π * r/gcd(R,r) — with integer R, r, gcd=1 → period = 2π*r
   */

  /* Curated list: [R, r, d_fraction_of_R] */
  var PATTERNS = [
    [8,  3, 0.92],
    [7,  4, 0.80],
    [11, 4, 0.72],
    [13, 5, 0.68],
    [7,  2, 0.90],
    [9,  4, 0.78],
    [5,  3, 0.88],
    [11, 7, 0.60],
    [10, 3, 0.82],
    [12, 5, 0.74],
    [7,  3, 0.85],
    [9,  2, 0.88],
    [6,  5, 0.55],
    [13, 8, 0.65],
  ];

  var STEPS_PER_FRAME = 50;  /* segments drawn per rAF — ~2 sec per pattern at 60fps */
  var TOTAL_STEPS = 6000;    /* total steps per pattern */
  var PAUSE_FRAMES = 70;     /* frames (~1.2 sec) to fade between patterns */

  var patIdx = 0;
  var hueBase = 0;
  var t = 0;
  var stepsDone = 0;
  var pauseCount = 0;
  var pausing = false;
  var prevX = null, prevY = null;

  function gcd(a, b) { return b === 0 ? a : gcd(b, a % b); }

  function point(R, r, d, angle) {
    var k = (R - r) / r;
    var x = (R - r) * Math.cos(angle) + d * Math.cos(k * angle);
    var y = (R - r) * Math.sin(angle) - d * Math.sin(k * angle);
    /* Normalize: max extent = (R-r) + d */
    var maxR = (R - r) + d;
    return { x: CX + (x / maxR) * SCALE, y: CY + (y / maxR) * SCALE };
  }

  function startPattern(idx, keepCanvas) {
    var p = PATTERNS[idx % PATTERNS.length];
    var R = p[0], r = p[1];
    var period = 2 * Math.PI * (r / gcd(R, r));
    /* dt step so we complete the pattern in TOTAL_STEPS */
    canvas._R = R; canvas._r = r; canvas._d = p[2] * R;
    canvas._period = period;
    canvas._dt = period / TOTAL_STEPS;
    t = 0; stepsDone = 0; prevX = null; prevY = null;
    if (!keepCanvas) ctx.clearRect(0, 0, W, H);
  }

  function nextPattern(keepCanvas) {
    patIdx = (patIdx + 1) % PATTERNS.length;
    hueBase = (hueBase + 47) % 360;
    pausing = false;
    startPattern(patIdx, keepCanvas || false);
  }

  function drawSteps() {
    var R = canvas._R, r = canvas._r, d = canvas._d, dt = canvas._dt;

    ctx.save();
    ctx.globalCompositeOperation = "lighter";

    for (var i = 0; i < STEPS_PER_FRAME && stepsDone < TOTAL_STEPS; i++) {
      var p = point(R, r, d, t);

      if (prevX !== null) {
        /* Hue progresses through the pattern's period */
        var progress = stepsDone / TOTAL_STEPS;
        var hue = (hueBase + progress * 300) % 360;
        var alpha = 0.55 + 0.35 * Math.sin(progress * Math.PI);

        ctx.shadowBlur = 6;
        ctx.shadowColor = "hsla(" + hue + ",90%,65%,0.4)";
        ctx.strokeStyle = "hsla(" + hue + ",85%,66%," + alpha + ")";
        ctx.lineWidth = 1.4;
        ctx.lineCap = "round";

        ctx.beginPath();
        ctx.moveTo(prevX, prevY);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
      }

      prevX = p.x; prevY = p.y;
      t += dt;
      stepsDone++;
    }

    ctx.restore();
  }

  function frame() {
    if (pausing) {
      pauseCount++;
      /* gradual fade — at 0.065 per frame, 70 frames ≈ 99% gone */
      ctx.fillStyle = "rgba(6,6,15,0.065)";
      ctx.fillRect(0, 0, W, H);
      if (pauseCount >= PAUSE_FRAMES) {
        nextPattern(false);
      }
    } else {
      drawSteps();
      if (stepsDone >= TOTAL_STEPS) {
        pausing = true;
        pauseCount = 0;
        if (hintEl) hintEl.classList.add("is-hidden");
      }
    }
    requestAnimationFrame(frame);
  }

  /* click/tap skips to next */
  canvas.addEventListener("pointerdown", function (e) {
    e.preventDefault();
    nextPattern(false);
  });

  /* kick off */
  hueBase = Math.random() * 360 | 0;
  startPattern(patIdx, false);
  requestAnimationFrame(frame);
})();
