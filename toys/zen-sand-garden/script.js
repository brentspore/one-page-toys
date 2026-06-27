/* Zen Sand Garden — a miniature karesansui.
 * Drag to rake parallel furrows into the sand (lit from the top-left so the
 * combed ridges catch light); tap to set a smooth stone with concentric rings
 * raked around it. The sand layer persists on its own offscreen canvas.
 */
(function () {
  "use strict";

  var canvas = document.getElementById("canvas");
  var ctx = canvas.getContext("2d");
  var smoothBtn = document.getElementById("smoothBtn");
  var clearBtn = document.getElementById("clearBtn");
  var hintEl = document.querySelector(".hint");

  // persistent sand layer (raked furrows live here; never auto-cleared)
  var sand = document.createElement("canvas");
  var sctx = sand.getContext("2d");

  var W, H, DPR;
  var LIGHT = (function () { var lx = -0.62, ly = -0.78, m = Math.hypot(lx, ly); return { x: lx / m, y: ly / m }; })();

  // ---- sand base ----------------------------------------------------------
  function paintBase() {
    // warm sand gradient
    var g = sctx.createLinearGradient(0, 0, W * 0.3, H);
    g.addColorStop(0, "#e4d2ab");
    g.addColorStop(0.5, "#d9c499");
    g.addColorStop(1, "#cdb585");
    sctx.fillStyle = g;
    sctx.fillRect(0, 0, W, H);

    // fine grain so flat sand isn't dead-flat
    var grains = Math.round((W * H) / 1400);
    for (var i = 0; i < grains; i++) {
      var x = Math.random() * W, y = Math.random() * H;
      var light = Math.random() < 0.5;
      sctx.fillStyle = light ? "rgba(255,250,235,0.05)" : "rgba(120,96,58,0.05)";
      var r = Math.random() * 1.3 + 0.3;
      sctx.fillRect(x, y, r, r);
    }
    // soft corner shading for a gentle bowl/vignette feel
    var v = sctx.createRadialGradient(W * 0.5, H * 0.46, Math.min(W, H) * 0.2, W * 0.5, H * 0.5, Math.max(W, H) * 0.72);
    v.addColorStop(0, "rgba(0,0,0,0)");
    v.addColorStop(1, "rgba(70,52,28,0.22)");
    sctx.fillStyle = v;
    sctx.fillRect(0, 0, W, H);
  }

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = W * DPR; canvas.height = H * DPR;
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    sand.width = W * DPR; sand.height = H * DPR;
    sctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    paintBase();
    stones.length = 0;          // a resize re-beds the garden
  }

  // ---- raking -------------------------------------------------------------
  // A rake = several tines. We carve a groove per tine: a soft shadow line in
  // the valley plus a highlight on whichever wall faces the light.
  var TINES = 7, GAP = 7;

  function clearOf(px, py) {
    // don't rake on top of a stone (sand is displaced by it)
    for (var i = 0; i < stones.length; i++) {
      var s = stones[i];
      if (Math.hypot(px - s.x, py - s.y) < s.r + 3) return false;
    }
    return true;
  }

  function rakeSeg(x0, y0, x1, y1) {
    var dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy);
    if (len < 0.001) return;
    var px = -dy / len, py = dx / len;                 // unit perpendicular
    var litSign = (px * LIGHT.x + py * LIGHT.y) >= 0 ? 1 : -1;
    var half = (TINES - 1) / 2;
    sctx.lineCap = "round";
    for (var t = 0; t < TINES; t++) {
      var o = (t - half) * GAP;
      var ax0 = x0 + px * o, ay0 = y0 + py * o;
      var ax1 = x1 + px * o, ay1 = y1 + py * o;
      // valley shadow
      sctx.strokeStyle = "rgba(120,94,55,0.32)";
      sctx.lineWidth = 3.0;
      sctx.beginPath(); sctx.moveTo(ax0, ay0); sctx.lineTo(ax1, ay1); sctx.stroke();
      // lit ridge edge (offset toward the light)
      var ho = o + litSign * 2.4;
      sctx.strokeStyle = "rgba(255,250,232,0.30)";
      sctx.lineWidth = 1.5;
      sctx.beginPath();
      sctx.moveTo(x0 + px * ho, y0 + py * ho);
      sctx.lineTo(x1 + px * ho, y1 + py * ho);
      sctx.stroke();
    }
  }

  // concentric rings raked around a freshly placed stone
  function rakeRings(s) {
    var rings = 4 + (Math.random() * 2 | 0);
    var lit = LIGHT;
    for (var k = 1; k <= rings; k++) {
      var rr = s.r + 9 + k * GAP;
      sctx.beginPath(); sctx.arc(s.x, s.y, rr, 0, Math.PI * 2);
      sctx.strokeStyle = "rgba(120,94,55,0.26)"; sctx.lineWidth = 3.0; sctx.stroke();
      // highlight arc on the light-facing side
      var a0 = Math.atan2(lit.y, lit.x) - 1.1, a1 = Math.atan2(lit.y, lit.x) + 1.1;
      sctx.beginPath(); sctx.arc(s.x, s.y, rr - 2.2, a0, a1);
      sctx.strokeStyle = "rgba(255,250,232,0.28)"; sctx.lineWidth = 1.5; sctx.stroke();
    }
  }

  function smoothSand() { paintBase(); for (var i = 0; i < stones.length; i++) rakeRings(stones[i]); }

  // ---- stones -------------------------------------------------------------
  var stones = [];
  var STONE_TINTS = [
    [126, 128, 132], [104, 110, 120], [138, 126, 110], [92, 96, 102], [150, 140, 122]
  ];
  function placeStone(x, y) {
    var r = 26 + Math.random() * 24;
    var tint = STONE_TINTS[(Math.random() * STONE_TINTS.length) | 0];
    var s = {
      x: x, y: y, r: r, tint: tint,
      sx: 0.86 + Math.random() * 0.24, sy: 0.78 + Math.random() * 0.2,
      rot: Math.random() * Math.PI,
      wob: 0.06 + Math.random() * 0.06, ph: Math.random() * 6
    };
    stones.push(s);
    rakeRings(s);
    tock();
  }

  function drawStone(s) {
    var c = s.tint;
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(s.rot);
    ctx.scale(s.sx, s.sy);

    // contact shadow on the sand (offset away from the light)
    ctx.save();
    ctx.scale(1 / s.sx, 1 / s.sy);
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = "#3a2c18";
    ctx.beginPath();
    ctx.ellipse(-LIGHT.x * s.r * 0.5, -LIGHT.y * s.r * 0.5 + s.r * 0.18, s.r * 1.04, s.r * 0.62, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.globalAlpha = 1;

    // pebble body, lit from the top-left
    var lx = LIGHT.x * s.r * 0.5, ly = LIGHT.y * s.r * 0.5;
    var g = ctx.createRadialGradient(lx, ly, s.r * 0.15, 0, 0, s.r * 1.08);
    g.addColorStop(0, rgb(c, 1.5));
    g.addColorStop(0.45, rgb(c, 1.05));
    g.addColorStop(1, rgb(c, 0.52));
    ctx.fillStyle = g;
    blob(s);
    ctx.fill();

    // crisp top highlight
    ctx.globalAlpha = 0.5;
    var hg = ctx.createRadialGradient(lx, ly, 0, lx, ly, s.r * 0.6);
    hg.addColorStop(0, "rgba(255,255,255,0.7)");
    hg.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = hg;
    blob(s); ctx.fill();
    ctx.globalAlpha = 1;

    // rim shade
    ctx.lineWidth = 1.4; ctx.strokeStyle = rgb(c, 0.4);
    ctx.globalAlpha = 0.4; blob(s); ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.restore();
  }
  function blob(s) {
    // slightly irregular ellipse for an organic pebble outline
    ctx.beginPath();
    var N = 26;
    for (var i = 0; i <= N; i++) {
      var a = (i / N) * Math.PI * 2;
      var rr = s.r * (1 + Math.sin(a * 3 + s.ph) * s.wob + Math.cos(a * 2 - s.ph) * s.wob * 0.6);
      var x = Math.cos(a) * rr, y = Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }
  function rgb(c, f) {
    return "rgb(" + Math.min(255, c[0] * f | 0) + "," + Math.min(255, c[1] * f | 0) + "," + Math.min(255, c[2] * f | 0) + ")";
  }

  // ---- audio --------------------------------------------------------------
  var actx = null, rakeGain = null, rakeBP = null, master = null;
  function unlock() {
    if (actx) { if (actx.state === "suspended") actx.resume(); return; }
    try {
      actx = new (window.AudioContext || window.webkitAudioContext)();
      var b = actx.createBuffer(1, 1, 22050); var s = actx.createBufferSource(); s.buffer = b; s.connect(actx.destination); s.start(0);
      master = actx.createGain(); master.gain.value = 0.9; master.connect(actx.destination);
      // continuous grainy raking bed, gain driven by rake speed
      var len = Math.floor(actx.sampleRate * 2), buf = actx.createBuffer(1, len, actx.sampleRate), d = buf.getChannelData(0), last = 0;
      for (var i = 0; i < len; i++) { var wn = Math.random() * 2 - 1; last = (last + 0.04 * wn) / 1.04; d[i] = (wn * 0.5 + last * 2.2); }
      var src = actx.createBufferSource(); src.buffer = buf; src.loop = true;
      rakeBP = actx.createBiquadFilter(); rakeBP.type = "bandpass"; rakeBP.frequency.value = 2600; rakeBP.Q.value = 0.6;
      rakeGain = actx.createGain(); rakeGain.gain.value = 0.0001;
      src.connect(rakeBP); rakeBP.connect(rakeGain); rakeGain.connect(master);
      src.start();
    } catch (e) { actx = null; }
  }
  function rakeSound(speed) {
    if (!actx) return;
    var g = Math.min(0.16, speed * 0.0009);
    rakeGain.gain.setTargetAtTime(g, actx.currentTime, 0.05);
    rakeBP.frequency.setTargetAtTime(1800 + Math.min(2600, speed * 5), actx.currentTime, 0.08);
  }
  function rakeSilence() { if (actx) rakeGain.gain.setTargetAtTime(0.0001, actx.currentTime, 0.12); }
  // a low wooden "tock" when a stone is set
  function tock() {
    if (!actx) return;
    var t = actx.currentTime;
    var o = actx.createOscillator(); o.type = "sine";
    o.frequency.setValueAtTime(220, t); o.frequency.exponentialRampToValueAtTime(96, t + 0.09);
    var g = actx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.3, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);
    var lp = actx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 900;
    o.connect(lp); lp.connect(g); g.connect(master);
    o.start(t); o.stop(t + 0.3);
    // contact click
    var n = Math.floor(actx.sampleRate * 0.03), bb = actx.createBuffer(1, n, actx.sampleRate), dd = bb.getChannelData(0);
    for (var i = 0; i < n; i++) dd[i] = (Math.random() * 2 - 1) * (1 - i / n);
    var ns = actx.createBufferSource(); ns.buffer = bb;
    var nb = actx.createBiquadFilter(); nb.type = "bandpass"; nb.frequency.value = 1500; nb.Q.value = 0.7;
    var ng = actx.createGain(); ng.gain.setValueAtTime(0.16, t); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    ns.connect(nb); nb.connect(ng); ng.connect(master); ns.start(t); ns.stop(t + 0.05);
  }

  // ---- interaction --------------------------------------------------------
  var down = false, moved = 0, lx = 0, ly = 0, downX = 0, downY = 0, downT = 0, lastMoveT = 0;
  function now() { return (window.performance && performance.now ? performance.now() : Date.now()); }

  function start(x, y) {
    unlock();
    down = true; moved = 0; lx = downX = x; ly = downY = y; downT = now(); lastMoveT = downT;
    if (hintEl) hintEl.classList.add("is-hidden");
  }
  function move(x, y) {
    if (!down) return;
    var d = Math.hypot(x - lx, y - ly);
    if (d < 2) return;
    moved += d;
    var tn = now(), dtm = Math.max(8, tn - lastMoveT); lastMoveT = tn;
    var speed = d / (dtm / 1000);                     // px/s
    if (clearOf(x, y) && clearOf(lx, ly)) {
      rakeSeg(lx, ly, x, y);
      rakeSound(speed);
    }
    lx = x; ly = y;
  }
  function end(x, y) {
    if (!down) return;
    down = false;
    rakeSilence();
    // a quick, near-stationary press sets a stone
    if (moved < 8 && (now() - downT) < 360 && clearOf(downX, downY)) placeStone(downX, downY);
  }

  canvas.addEventListener("mousedown", function (e) { start(e.clientX, e.clientY); });
  window.addEventListener("mousemove", function (e) { if (e.buttons & 1) move(e.clientX, e.clientY); });
  window.addEventListener("mouseup", function (e) { end(e.clientX, e.clientY); });
  canvas.addEventListener("touchstart", function (e) { e.preventDefault(); var t = e.touches[0]; start(t.clientX, t.clientY); }, { passive: false });
  canvas.addEventListener("touchmove", function (e) { e.preventDefault(); var t = e.touches[0]; move(t.clientX, t.clientY); }, { passive: false });
  canvas.addEventListener("touchend", function (e) { e.preventDefault(); var t = e.changedTouches[0]; end(t.clientX, t.clientY); }, { passive: false });

  smoothBtn.addEventListener("click", function () { unlock(); smoothSand(); track("zen_smooth", {}); });
  clearBtn.addEventListener("click", function () { stones.length = 0; smoothSand(); track("zen_clear", {}); });

  // ---- loop ---------------------------------------------------------------
  function frame() {
    ctx.drawImage(sand, 0, 0, W, H);
    for (var i = 0; i < stones.length; i++) drawStone(stones[i]);
    requestAnimationFrame(frame);
  }

  function track(name, params) { try { if (typeof window.gtag === "function") window.gtag("event", name, params || {}); } catch (e) {} }

  resize();
  window.addEventListener("resize", resize);
  // a couple of stones to start, so the garden reads instantly
  placeStoneSilent(W * 0.34, H * 0.6);
  placeStoneSilent(W * 0.66, H * 0.4);
  function placeStoneSilent(x, y) { var n = actx; actx = null; placeStone(x, y); actx = n; }
  requestAnimationFrame(frame);
  setTimeout(function () { if (hintEl) hintEl.classList.add("is-hidden"); }, 9000);
})();
