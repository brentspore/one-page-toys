/* Cloth & Tear — a verlet-physics fabric.
 * A grid of point masses linked by distance constraints hangs from a pinned top
 * edge. Drag to pull it; yank or swipe fast to snap the links and tear holes.
 * Rendered as flat-shaded "shot-silk" quads so folds catch the light. Canvas 2D.
 */
(function () {
  "use strict";

  // ---- TUNABLES -----------------------------------------------------------
  var COLS = 38, ROWS = 26;    // grid resolution
  var GRAV = 0.34;             // gravity per step (px)
  var DAMP = 0.99;             // velocity retention
  var ITER = 4;                // constraint relaxation passes
  var TEAR_LEN = 3.4;          // link snaps if stretched past rest * this
  var TEAR_R = 26;             // cut radius in Tear mode / fast swipe
  var GRAB_R = 46;             // grab radius in Drag mode
  // shot-silk 3-stop ramp (fold shadow -> mid -> lit sheen)
  var C_SHADOW = [38, 12, 58], C_MID = [176, 40, 96], C_LIT = [250, 214, 138];
  // -------------------------------------------------------------------------

  var canvas = document.getElementById("canvas");
  var ctx = canvas.getContext("2d");
  var hintEl = document.querySelector(".hint");

  var W, H, DPR, spacing, ox, oy;
  var px = [], py = [], ppx = [], ppy = [], pin = [];   // point arrays (flat, j*COLS+i)
  var hEdge = [], vEdge = [];                            // alive-flags for links
  var windOn = false, tearMode = false, tPhase = 0;

  function idx(i, j) { return j * COLS + i; }

  function build() {
    spacing = Math.min(W * 0.6 / (COLS - 1), H * 0.5 / (ROWS - 1));
    ox = (W - spacing * (COLS - 1)) / 2;
    oy = Math.max(H * 0.14, 60);
    px = []; py = []; ppx = []; ppy = []; pin = [];
    for (var j = 0; j < ROWS; j++) for (var i = 0; i < COLS; i++) {
      var x = ox + i * spacing, y = oy + j * spacing;
      px.push(x); py.push(y); ppx.push(x); ppy.push(y);
      pin.push(j === 0 && (i % 3 === 0 || i === COLS - 1));   // pin every 3rd point of top edge
    }
    hEdge = []; vEdge = [];
    for (j = 0; j < ROWS; j++) { hEdge[j] = []; vEdge[j] = []; for (i = 0; i < COLS; i++) { hEdge[j][i] = i < COLS - 1; vEdge[j][i] = j < ROWS - 1; } }
  }

  // ---- simulation ---------------------------------------------------------
  function simulate() {
    tPhase += 0.02;
    for (var k = 0; k < px.length; k++) {
      if (pin[k]) continue;
      var vx = (px[k] - ppx[k]) * DAMP, vy = (py[k] - ppy[k]) * DAMP;
      ppx[k] = px[k]; ppy[k] = py[k];
      px[k] += vx; py[k] += vy + GRAV;
      if (windOn) {
        var w = (Math.sin(tPhase + py[k] * 0.01) + Math.sin(tPhase * 1.7 + px[k] * 0.008)) * 0.5;
        px[k] += w * 0.32; py[k] += Math.sin(tPhase * 2.3 + k) * 0.05;
      }
    }
    for (var it = 0; it < ITER; it++) {
      solveEdges();
      if (grab >= 0) { px[grab] = mx; py[grab] = my; ppx[grab] = mx; ppy[grab] = my; }
    }
    // natural tearing: snap overstretched links
    for (var j = 0; j < ROWS; j++) for (var i = 0; i < COLS; i++) {
      if (hEdge[j][i] && dist(idx(i, j), idx(i + 1, j)) > spacing * TEAR_LEN) hEdge[j][i] = false;
      if (vEdge[j][i] && dist(idx(i, j), idx(i, j + 1)) > spacing * TEAR_LEN) vEdge[j][i] = false;
    }
  }
  function solveEdges() {
    for (var j = 0; j < ROWS; j++) for (var i = 0; i < COLS; i++) {
      if (hEdge[j][i]) relax(idx(i, j), idx(i + 1, j));
      if (vEdge[j][i]) relax(idx(i, j), idx(i, j + 1));
    }
  }
  function relax(a, b) {
    var dx = px[b] - px[a], dy = py[b] - py[a];
    var d = Math.sqrt(dx * dx + dy * dy) || 0.0001;
    var diff = (d - spacing) / d * 0.5;
    var ox2 = dx * diff, oy2 = dy * diff;
    if (!pin[a]) { px[a] += ox2; py[a] += oy2; }
    if (!pin[b]) { px[b] -= ox2; py[b] -= oy2; }
  }
  function dist(a, b) { var dx = px[b] - px[a], dy = py[b] - py[a]; return Math.sqrt(dx * dx + dy * dy); }

  function cutAt(x, y, r) {
    var did = false;
    for (var j = 0; j < ROWS; j++) for (var i = 0; i < COLS; i++) {
      var k = idx(i, j);
      if (Math.abs(px[k] - x) > r + spacing || Math.abs(py[k] - y) > r + spacing) continue;
      if (hEdge[j][i] && near(x, y, k, idx(i + 1, j), r)) { hEdge[j][i] = false; did = true; }
      if (vEdge[j][i] && near(x, y, k, idx(i, j + 1), r)) { vEdge[j][i] = false; did = true; }
    }
    if (did) rip();
  }
  function near(x, y, a, b, r) {   // distance from point (x,y) to segment a-b < r
    var ax = px[a], ay = py[a], bx = px[b], by = py[b];
    var dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1;
    var t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2));
    var cx = ax + t * dx, cy = ay + t * dy;
    return Math.hypot(x - cx, y - cy) < r;
  }

  // ---- render -------------------------------------------------------------
  function lerp3(t) {
    var a, b, u;
    if (t < 0.5) { a = C_SHADOW; b = C_MID; u = t * 2; } else { a = C_MID; b = C_LIT; u = (t - 0.5) * 2; }
    return "rgb(" + (a[0] + (b[0] - a[0]) * u | 0) + "," + (a[1] + (b[1] - a[1]) * u | 0) + "," + (a[2] + (b[2] - a[2]) * u | 0) + ")";
  }
  function render() {
    var g = ctx.createRadialGradient(W / 2, H * 0.4, 0, W / 2, H * 0.5, Math.max(W, H) * 0.8);
    g.addColorStop(0, "#171422"); g.addColorStop(0.6, "#0e0b16"); g.addColorStop(1, "#08060e");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    for (var j = 0; j < ROWS - 1; j++) for (var i = 0; i < COLS - 1; i++) {
      // a cell is intact only if its four bounding links survive
      if (!(hEdge[j][i] && hEdge[j + 1][i] && vEdge[j][i] && vEdge[j][i + 1])) continue;
      var a = idx(i, j), b = idx(i + 1, j), c = idx(i + 1, j + 1), d = idx(i, j + 1);
      // fold shading: compressed cell = crease (dark), stretched = catches light
      var wid = Math.hypot(px[b] - px[a], py[b] - py[a]);
      var hei = Math.hypot(px[d] - px[a], py[d] - py[a]);
      var ratio = (wid + hei) / (2 * spacing);
      var t = Math.max(0, Math.min(1, (ratio - 0.72) / 0.9));
      ctx.fillStyle = lerp3(t);
      ctx.beginPath();
      ctx.moveTo(px[a], py[a]); ctx.lineTo(px[b], py[b]); ctx.lineTo(px[c], py[c]); ctx.lineTo(px[d], py[d]);
      ctx.closePath(); ctx.fill();
    }
    // pins as little studs
    ctx.fillStyle = "#c9cede";
    for (var k = 0; k < px.length; k++) if (pin[k]) { ctx.beginPath(); ctx.arc(px[k], py[k], 3.2, 0, 6.283); ctx.fill(); }
  }

  // ---- loop ---------------------------------------------------------------
  var lastTs = null;
  function frame(ts) {
    lastTs = ts;
    simulate();
    render();
    requestAnimationFrame(frame);
  }

  // ---- input --------------------------------------------------------------
  var grab = -1, mx = 0, my = 0, pmx = 0, pmy = 0, down = false;
  function nearest(x, y) {
    var best = -1, bd = GRAB_R * GRAB_R;
    for (var k = 0; k < px.length; k++) {
      if (pin[k]) continue;
      var dx = px[k] - x, dy = py[k] - y, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = k; }
    }
    return best;
  }
  function pdown(x, y) { unlock(); down = true; mx = pmx = x; my = pmy = y; if (hintEl) hintEl.classList.add("is-hidden"); if (tearMode) cutAt(x, y, TEAR_R); else grab = nearest(x, y); }
  function pmove(x, y) {
    pmx = mx; pmy = my; mx = x; my = y;
    if (!down) return;
    var spd = Math.hypot(mx - pmx, my - pmy);
    if (tearMode) cutAt(x, y, TEAR_R);
    else if (spd > 34) cutAt(x, y, TEAR_R * 0.7);   // a fast swipe rips even in Drag mode
  }
  function pup() { down = false; grab = -1; }
  canvas.addEventListener("mousedown", function (e) { pdown(e.clientX, e.clientY); });
  window.addEventListener("mousemove", function (e) { pmove(e.clientX, e.clientY); });
  window.addEventListener("mouseup", pup);
  canvas.addEventListener("touchstart", function (e) { e.preventDefault(); var t = e.touches[0]; pdown(t.clientX, t.clientY); }, { passive: false });
  canvas.addEventListener("touchmove", function (e) { e.preventDefault(); var t = e.touches[0]; pmove(t.clientX, t.clientY); }, { passive: false });
  canvas.addEventListener("touchend", function (e) { e.preventDefault(); pup(); }, { passive: false });

  document.getElementById("resetBtn").addEventListener("click", function () { build(); });
  var modeBtn = document.getElementById("modeBtn");
  modeBtn.addEventListener("click", function () {
    tearMode = !tearMode;
    modeBtn.textContent = tearMode ? "Mode: tear" : "Mode: drag";
    modeBtn.setAttribute("aria-pressed", tearMode ? "true" : "false");
    canvas.classList.toggle("is-tear", tearMode);
  });
  var windBtn = document.getElementById("windBtn");
  windBtn.addEventListener("click", function () {
    windOn = !windOn;
    windBtn.textContent = windOn ? "Wind: on" : "Wind: off";
    windBtn.setAttribute("aria-pressed", windOn ? "true" : "false");
  });

  // ---- audio (soft rip on tear) -------------------------------------------
  var actx = null, master = null, outGain = null, muted = false, noiseBuf = null, lastRip = 0;
  function unlock() {
    if (actx) { if (actx.state === "suspended") actx.resume(); return; }
    try {
      actx = new (window.AudioContext || window.webkitAudioContext)();
      var b = actx.createBuffer(1, 1, 22050), s = actx.createBufferSource(); s.buffer = b; s.connect(actx.destination); s.start(0);
      outGain = actx.createGain(); outGain.gain.value = muted ? 0 : 1; outGain.connect(actx.destination);
      master = actx.createGain(); master.gain.value = 0.7; master.connect(outGain);
      noiseBuf = actx.createBuffer(1, actx.sampleRate, actx.sampleRate);
      var nd = noiseBuf.getChannelData(0); for (var i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    } catch (e) { actx = null; }
  }
  function rip() {
    if (!actx) return; var t = actx.currentTime; if (t - lastRip < 0.03) return; lastRip = t;
    var ns = actx.createBufferSource(); ns.buffer = noiseBuf; ns.loop = true;
    var bp = actx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 1400 + Math.random() * 800; bp.Q.value = 0.7;
    var hp = actx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 700;
    var g = actx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0004, t + 0.11);
    ns.connect(bp); bp.connect(hp); hp.connect(g); g.connect(master); ns.start(t); ns.stop(t + 0.13);
  }

  // no dedicated sound button on this toy — muted stays false; kept for iOS unlock parity
  function noop() {}
  noop();

  // ---- boot ---------------------------------------------------------------
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = W * DPR; canvas.height = H * DPR;
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    build();
  }
  resize(); window.addEventListener("resize", resize);
  requestAnimationFrame(frame);
})();
