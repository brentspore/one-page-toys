/* Chladni Plate — a digital cymatics sand-vibration simulator.
 * Thousands of grains jitter across a vibrating square plate and settle onto the
 * NODAL LINES (where the standing-wave amplitude |A(x,y)|≈0), drawing the figure.
 * PRESS / DRAG anywhere on the plate to pour sand there and watch it dance into the
 * pattern. Slower / Faster change the driving frequency (finer figures), Pause stops
 * the vibration (poured sand just sits until you Play), Clear empties the plate.
 */
(function () {
  "use strict";

  // ---- TUNABLES — adjust these to change the feel --------------------------
  var PARTICLE_COUNT = 8000;    // grains already on the plate when it loads
  var FILL_COUNT = 14000;       // how much sand the "Fill" button drops across the whole board
  var MAX_PARTICLES = 36000;    // capacity — only once this full do new pours recycle the oldest grains
  var POUR_FLOW = 110;          // grains poured per frame while you hold down (gentler stream)
  var POUR_RADIUS = 26;         // spread (px) of the poured stream
  var JITTER = 26;              // throw distance (px) at the loudest antinodes — bigger = looser sand
  var M_MAX = 6;                // highest mode number used (the frequency ladder is built from pairs up to this)
  var DOT_SIZE = 1.3;           // grain size (px)
  var RESHAKE = 0.6;            // seconds the plate re-shakes after the frequency changes
  var VIBE = 0.8;               // constant shimmer (px) so the running plate looks alive (0 = dead still)
  // --------------------------------------------------------------------------

  // frequency ladder: unique (m,n) pairs (m<n) sorted low→high frequency (m²+n²)
  var MODES = [];
  for (var a = 1; a <= M_MAX; a++) for (var bb = a + 1; bb <= M_MAX; bb++) MODES.push([a, bb]);
  MODES.sort(function (p, q) { return (p[0] * p[0] + p[1] * p[1]) - (q[0] * q[0] + q[1] * q[1]); });

  var canvas = document.getElementById("canvas");
  var ctx = canvas.getContext("2d");
  var W, H, DPR, S, ox, oy;
  var PI = Math.PI;

  var nx = new Float32Array(MAX_PARTICLES);
  var ny = new Float32Array(MAX_PARTICLES);
  var count = PARTICLE_COUNT;        // grains currently on the plate
  var recycle = 0;                   // ring pointer used once we hit MAX_PARTICLES

  var freq = Math.floor(MODES.length * 0.4);
  var m = MODES[freq][0], n = MODES[freq][1];
  var excite = 1;
  var running = true;

  function scatter() { for (var i = 0; i < count; i++) { nx[i] = Math.random(); ny[i] = Math.random(); } }

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = W * DPR; canvas.height = H * DPR;
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    S = Math.min(W, H) * 0.9;
    ox = (W - S) / 2; oy = (H - S) / 2;
  }

  function amplitude(x, y) {
    return Math.sin(PI * m * x) * Math.sin(PI * n * y) -
           Math.sin(PI * n * x) * Math.sin(PI * m * y);
  }

  // pour a stream of grains around screen point (px,py): new grains until the plate is
  // full, then recycle the oldest so you can keep pouring forever
  function pourAt(px, py, amount) {
    var cx = (px - ox) / S, cy = (py - oy) / S;          // normalized plate coords
    var rad = POUR_RADIUS / S;
    for (var k = 0; k < amount; k++) {
      var idx;
      if (count < MAX_PARTICLES) idx = count++;
      else { idx = recycle; recycle = (recycle + 1) % MAX_PARTICLES; }
      var ang = Math.random() * 6.283, r = Math.sqrt(Math.random()) * rad;
      var gx = cx + Math.cos(ang) * r, gy = cy + Math.sin(ang) * r;
      nx[idx] = gx < 0 ? 0 : gx > 1 ? 1 : gx;
      ny[idx] = gy < 0 ? 0 : gy > 1 ? 1 : gy;
    }
  }

  // ---- controls -----------------------------------------------------------
  var playBtn = document.getElementById("playBtn");
  function setRunning(r) {
    running = r;
    if (playBtn) { playBtn.textContent = running ? "Pause" : "Play"; playBtn.setAttribute("aria-pressed", running ? "false" : "true"); }
  }
  function setFreq(f) {
    f = f < 0 ? 0 : (f >= MODES.length ? MODES.length - 1 : f);
    if (f === freq) return;
    freq = f; m = MODES[f][0]; n = MODES[f][1]; excite = 1;
  }
  if (playBtn) playBtn.addEventListener("click", function () { setRunning(!running); });
  var sb = document.getElementById("slowerBtn");
  if (sb) sb.addEventListener("click", function () { setRunning(true); setFreq(freq - 1); });
  var fb = document.getElementById("fasterBtn");
  if (fb) fb.addEventListener("click", function () { setRunning(true); setFreq(freq + 1); });
  var fbtn = document.getElementById("fillBtn");
  // Fill: drop a full board of sand everywhere (respects pause — if the plate is paused
  // the sand just sits scattered until you hit Play, then it re-forms the pattern)
  if (fbtn) fbtn.addEventListener("click", function () {
    if (count < FILL_COUNT) count = FILL_COUNT;
    scatter();              // re-scatter every grain across the whole plate
    excite = 1;
  });
  var cb = document.getElementById("clearBtn");
  if (cb) cb.addEventListener("click", function () { count = 0; recycle = 0; });

  // pour sand wherever you press / drag on the plate (works while paused too)
  var pouring = false, pourX = 0, pourY = 0;
  function pourDown(x, y) { pouring = true; pourX = x; pourY = y; }
  function pourMove(x, y) { if (pouring) { pourX = x; pourY = y; } }
  function pourUp() { pouring = false; }
  canvas.addEventListener("mousedown", function (e) { pourDown(e.clientX, e.clientY); });
  window.addEventListener("mousemove", function (e) { pourMove(e.clientX, e.clientY); });
  window.addEventListener("mouseup", pourUp);
  canvas.addEventListener("touchstart", function (e) { e.preventDefault(); var t = e.touches[0]; pourDown(t.clientX, t.clientY); }, { passive: false });
  canvas.addEventListener("touchmove", function (e) { e.preventDefault(); var t = e.touches[0]; pourMove(t.clientX, t.clientY); }, { passive: false });
  canvas.addEventListener("touchend", function (e) { e.preventDefault(); pourUp(); }, { passive: false });

  // ---- loop ---------------------------------------------------------------
  var lastTs = null;
  function frame(ts) {
    var dt = lastTs !== null ? Math.min((ts - lastTs) / 1000, 0.05) : 0.016;
    lastTs = ts;

    if (pouring) pourAt(pourX, pourY, POUR_FLOW);   // hold to pour, drag to spread

    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "rgba(255,255,255,0.9)";

    if (running) {
      excite = Math.max(0, excite - dt / RESHAKE);
      var baseStep = JITTER / S;
      for (var i = 0; i < count; i++) {
        var x = nx[i], y = ny[i];
        var av = amplitude(x, y); if (av < 0) av = -av;
        var an = av * 0.5;
        var s = baseStep * an * Math.sqrt(an);
        if (excite > 0.001) {
          s += baseStep * excite;
          x += (Math.random() * 2 - 1) * s;
          y += (Math.random() * 2 - 1) * s;
        } else {
          s += baseStep * 0.05;
          var tx = x + (Math.random() * 2 - 1) * s;
          var ty = y + (Math.random() * 2 - 1) * s;
          if (tx < 0) tx = 0; else if (tx > 1) tx = 1;
          if (ty < 0) ty = 0; else if (ty > 1) ty = 1;
          var ta = amplitude(tx, ty); if (ta < 0) ta = -ta;
          if (ta < av) { x = tx; y = ty; }
        }
        if (x < 0) x = 0; else if (x > 1) x = 1;
        if (y < 0) y = 0; else if (y > 1) y = 1;
        nx[i] = x; ny[i] = y;
        ctx.fillRect(ox + x * S + (Math.random() * 2 - 1) * VIBE,
                     oy + y * S + (Math.random() * 2 - 1) * VIBE, DOT_SIZE, DOT_SIZE);
      }
    } else {
      // paused: the vibration is off — sand (including what you just poured) sits still
      for (var j = 0; j < count; j++) ctx.fillRect(ox + nx[j] * S, oy + ny[j] * S, DOT_SIZE, DOT_SIZE);
    }

    requestAnimationFrame(frame);
  }

  scatter();
  resize();
  window.addEventListener("resize", resize);
  requestAnimationFrame(frame);
})();
