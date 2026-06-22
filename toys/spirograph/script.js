(function () {
  "use strict";

  var canvas = document.getElementById("canvas");
  var ctx = canvas.getContext("2d");
  var hintEl = document.getElementById("hint");
  var outer = document.getElementById("outer");
  var inner = document.getElementById("inner");
  var pen = document.getElementById("pen");
  var randomBtn = document.getElementById("randomBtn");

  var W, H, CX, CY, SCALE, scale;
  function resize() {
    W = window.innerWidth; H = window.innerHeight;
    // cap the backing-store resolution so huge / 4K displays stay fast
    scale = Math.min(2, window.devicePixelRatio || 1);
    var MAXDIM = 2200;
    if (W * scale > MAXDIM) scale = MAXDIM / W;
    if (H * scale > MAXDIM) scale = Math.min(scale, MAXDIM / H);
    canvas.width = Math.round(W * scale); canvas.height = Math.round(H * scale);
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    CX = W / 2; CY = H * 0.46; SCALE = Math.min(W, H) * 0.40;
  }
  resize();
  window.addEventListener("resize", function () { resize(); build(); });

  /* Hypotrochoid: inner circle r rolls inside outer R, pen offset d (≤ r).
   * Four nested pen-holes share one scale → a layered rosette. */
  var LAYER_FRACS = [1, 0.76, 0.53, 0.32];
  var STEPS_PER_FRAME = 52, TOTAL_STEPS = 4600;

  var R, r, ds, maxR, period, dt, t, stepsDone, prev, hueBase;

  function gcd(a, b) { return b === 0 ? a : gcd(b, a % b); }

  function point(d, angle) {
    var k = (R - r) / r;
    var x = (R - r) * Math.cos(angle) + d * Math.cos(k * angle);
    var y = (R - r) * Math.sin(angle) - d * Math.sin(k * angle);
    return { x: CX + (x / maxR) * SCALE, y: CY + (y / maxR) * SCALE };
  }

  function build() {
    R = +outer.value;
    r = Math.min(+inner.value, R - 1);          // inner gear must be smaller than outer
    var penFrac = +pen.value / 100;             // pen offset as fraction of r
    var dmax = penFrac * r;
    ds = LAYER_FRACS.map(function (f) { return f * dmax; });
    maxR = (R - r) + dmax || 1;
    period = 2 * Math.PI * (r / gcd(R, r));
    dt = period / TOTAL_STEPS;
    t = 0; stepsDone = 0; prev = [];
    hueBase = (Math.random() * 360) | 0;
    ctx.clearRect(0, 0, W, H);
  }

  function drawSteps() {
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    for (var i = 0; i < STEPS_PER_FRAME && stepsDone < TOTAL_STEPS; i++) {
      var progress = stepsDone / TOTAL_STEPS;
      for (var j = 0; j < ds.length; j++) {
        var p = point(ds[j], t);
        var pr = prev[j];
        if (pr) {
          var hue = (hueBase + j * 42 + progress * 220) % 360;
          // cheap neon glow without shadowBlur: a wide faint halo + a bright core (additive)
          ctx.strokeStyle = "hsla(" + hue + ",95%,66%,0.14)";
          ctx.lineWidth = 5 - j * 0.7;
          ctx.beginPath(); ctx.moveTo(pr.x, pr.y); ctx.lineTo(p.x, p.y); ctx.stroke();
          ctx.strokeStyle = "hsla(" + hue + ",92%,66%,0.85)";
          ctx.lineWidth = 1.5 - j * 0.16;
          ctx.beginPath(); ctx.moveTo(pr.x, pr.y); ctx.lineTo(p.x, p.y); ctx.stroke();
        }
        prev[j] = p;
      }
      t += dt; stepsDone++;
    }
  }

  function frame() {
    if (stepsDone < TOTAL_STEPS) drawSteps();
    requestAnimationFrame(frame);
  }

  function onInput() {
    if (hintEl) hintEl.classList.add("is-hidden");
    build();
  }
  outer.addEventListener("input", onInput);
  inner.addEventListener("input", onInput);
  pen.addEventListener("input", onInput);
  randomBtn.addEventListener("click", function () {
    outer.value = 7 + ((Math.random() * 20) | 0);
    inner.value = 2 + ((Math.random() * Math.min(12, +outer.value - 2)) | 0);
    pen.value = 55 + ((Math.random() * 43) | 0);
    onInput();
  });

  build();
  requestAnimationFrame(frame);
})();
