/* Murmuration — a starling flock at dusk. Reynolds boids (separation /
 * alignment / cohesion) over a spatial grid, with your cursor as a predator
 * to flee (or a roost to gather toward) and a tap that scatters the flock.
 * Vanilla Canvas 2D + Web Audio. */
(function () {
  "use strict";

  var canvas = document.getElementById("canvas");
  var ctx = canvas.getContext("2d");
  var soundBtn = document.getElementById("soundBtn");
  var modeBtn = document.getElementById("modeBtn");
  var hintEl = document.getElementById("hint");

  var W = 0, H = 0, DPR = 1;

  // tunables
  var PERC = 66, SEP = 17, FEAR = 140;      // radii (px): neighbor / separation / cursor influence
  var MAXSPD = 205, MINSPD = 95, MAXF = 300;// px/s and px/s^2
  var W_SEP = 1.5, W_ALI = 1.35, W_COH = 1.5, W_CURSOR = 3.8, W_EDGE = 2.6;
  var EDGE = 90;                             // steer inward within this margin

  var boids = [];
  var grid = {}, CELL = PERC;
  var mouse = { x: -9999, y: -9999, on: false };
  var mode = "flee";                        // "flee" or "gather"
  var pulses = [];                          // tap scatters: {x,y,t,max}
  var soundOn = true, agitation = 0;

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.floor(W * DPR); canvas.height = Math.floor(H * DPR);
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    var want = Math.round(Math.min(560, Math.max(220, (W * H) / 3400)));
    if (!boids.length) seed(want);
    else if (want > boids.length) for (var i = boids.length; i < want; i++) boids.push(makeBoid());
    else if (want < boids.length) boids.length = want;
  }
  window.addEventListener("resize", resize);

  function makeBoid() {
    var a = Math.random() * Math.PI * 2, sp = MINSPD + Math.random() * (MAXSPD - MINSPD);
    return { x: Math.random() * W, y: Math.random() * H * 0.7, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, z: 0.45 + Math.random() * 0.55 };
  }
  function seed(n) { boids = []; for (var i = 0; i < n; i++) boids.push(makeBoid()); }

  // ---------------- spatial grid ----------------
  function rebuildGrid() {
    grid = {};
    for (var i = 0; i < boids.length; i++) {
      var b = boids[i], k = ((b.x / CELL) | 0) + "," + ((b.y / CELL) | 0);
      (grid[k] || (grid[k] = [])).push(i);
    }
  }

  function limit(vx, vy, max) {
    var m = Math.hypot(vx, vy);
    if (m > max && m > 0) { var s = max / m; return [vx * s, vy * s]; }
    return [vx, vy];
  }

  function update(dt) {
    rebuildGrid();
    var perc2 = PERC * PERC, sep2 = SEP * SEP, fear2 = FEAR * FEAR, turn = 0;

    for (var i = 0; i < boids.length; i++) {
      var b = boids[i];
      var sx = 0, sy = 0, ax = 0, ay = 0, cxs = 0, cys = 0, n = 0, ns = 0;
      var gx = (b.x / CELL) | 0, gy = (b.y / CELL) | 0;
      for (var oy = -1; oy <= 1; oy++) for (var ox = -1; ox <= 1; ox++) {
        var bucket = grid[(gx + ox) + "," + (gy + oy)];
        if (!bucket) continue;
        for (var j = 0; j < bucket.length; j++) {
          var o = boids[bucket[j]]; if (o === b) continue;
          var dx = b.x - o.x, dy = b.y - o.y, d2 = dx * dx + dy * dy;
          if (d2 > perc2 || d2 === 0) continue;
          ax += o.vx; ay += o.vy; cxs += o.x; cys += o.y; n++;
          if (d2 < sep2) { var inv = 1 / Math.sqrt(d2); sx += dx * inv; sy += dy * inv; ns++; }
        }
      }

      var fx = 0, fy = 0;
      if (n > 0) {
        // alignment
        var al = limit(ax / n, ay / n, MAXSPD); fx += (al[0] - b.vx) * W_ALI; fy += (al[1] - b.vy) * W_ALI;
        // cohesion
        var cvx = cxs / n - b.x, cvy = cys / n - b.y, cl = limit(cvx, cvy, MAXSPD);
        fx += (cl[0] - b.vx) * W_COH; fy += (cl[1] - b.vy) * W_COH;
      }
      if (ns > 0) { var sl = limit(sx, sy, MAXSPD); fx += (sl[0] - b.vx) * W_SEP; fy += (sl[1] - b.vy) * W_SEP; }

      // cursor: flee (predator) or gather (roost)
      if (mouse.on) {
        var mdx = b.x - mouse.x, mdy = b.y - mouse.y, md2 = mdx * mdx + mdy * mdy;
        if (mode === "flee") {
          if (md2 < fear2 && md2 > 0) { var f = (1 - Math.sqrt(md2) / FEAR), im = 1 / Math.sqrt(md2); fx += mdx * im * MAXSPD * f * W_CURSOR; fy += mdy * im * MAXSPD * f * W_CURSOR; turn += f; }
        } else {
          if (md2 > 900) { var gl = limit(-mdx, -mdy, MAXSPD); fx += (gl[0] - b.vx) * 1.4; fy += (gl[1] - b.vy) * 1.4; }
        }
      }

      // tap scatters
      for (var p = 0; p < pulses.length; p++) {
        var pu = pulses[p], pdx = b.x - pu.x, pdy = b.y - pu.y, pd = Math.hypot(pdx, pdy);
        if (pd < pu.r && pd > 0.001) { var pf = (1 - pd / pu.r) * (1 - pu.t / pu.max); fx += pdx / pd * MAXSPD * pf * 5; fy += pdy / pd * MAXSPD * pf * 5; turn += pf; }
      }

      // steer back from edges
      if (b.x < EDGE) fx += (1 - b.x / EDGE) * MAXSPD * W_EDGE;
      if (b.x > W - EDGE) fx -= (1 - (W - b.x) / EDGE) * MAXSPD * W_EDGE;
      if (b.y < EDGE) fy += (1 - b.y / EDGE) * MAXSPD * W_EDGE;
      if (b.y > H - EDGE) fy -= (1 - (H - b.y) / EDGE) * MAXSPD * W_EDGE;

      var lf = limit(fx, fy, MAXF);
      b.vx += lf[0] * dt; b.vy += lf[1] * dt;
      var sp = Math.hypot(b.vx, b.vy);
      if (sp > MAXSPD) { b.vx *= MAXSPD / sp; b.vy *= MAXSPD / sp; }
      else if (sp < MINSPD && sp > 0) { b.vx *= MINSPD / sp; b.vy *= MINSPD / sp; }
      b.x += b.vx * dt; b.y += b.vy * dt;
      // wrap safety
      if (b.x < -20) b.x = W + 20; else if (b.x > W + 20) b.x = -20;
      if (b.y < -20) b.y = H + 20; else if (b.y > H + 20) b.y = -20;
    }

    for (var q = pulses.length - 1; q >= 0; q--) { pulses[q].t += dt; pulses[q].r = pulses[q].max * pulses[q].t * 4; if (pulses[q].t > 0.5) pulses.splice(q, 1); }
    agitation += ((turn / Math.max(1, boids.length) * 8) - agitation) * Math.min(1, dt * 3);
    if (soundOn) ambientTick(dt);
  }

  // ---------------- render ----------------
  var hills = null;
  function buildScene() {
    // seed distant hill silhouettes once (relative coords)
    hills = [];
    var seed = 20;
    function rnd() { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; }
    // [0],[1] = distant ridges (behind the flock); [2] = tall foreground ridge (in front)
    var defs = [{ n: 7, baseY: 0.88, amp: 0.05 }, { n: 9, baseY: 0.93, amp: 0.06 }, { n: 5, baseY: 0.985, amp: 0.16 }];
    for (var l = 0; l < defs.length; l++) {
      var d = defs[l], pts = [];
      for (var i = 0; i <= d.n; i++) pts.push({ x: i / d.n, y: d.baseY - rnd() * d.amp });
      hills.push(pts);
    }
  }
  function fillHill(pts, color) {
    ctx.beginPath(); ctx.moveTo(0, H);
    for (var i = 0; i < pts.length; i++) ctx.lineTo(pts[i].x * W, pts[i].y * H);
    ctx.lineTo(W, H); ctx.closePath(); ctx.fillStyle = color; ctx.fill();
  }

  function render() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    // dusk sky
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#0c0f2a"); g.addColorStop(0.42, "#2a2350");
    g.addColorStop(0.7, "#6b4160"); g.addColorStop(0.86, "#c26a56"); g.addColorStop(1, "#eda06a");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // low sun glow
    var sun = ctx.createRadialGradient(W * 0.5, H * 0.95, 0, W * 0.5, H * 0.95, H * 0.55);
    sun.addColorStop(0, "rgba(255,190,120,0.5)"); sun.addColorStop(0.5, "rgba(255,150,90,0.12)"); sun.addColorStop(1, "rgba(255,150,90,0)");
    ctx.fillStyle = sun; ctx.fillRect(0, 0, W, H);

    // distant ridges (behind the flock)
    if (!hills) buildScene();
    fillHill(hills[0], "rgba(40,26,52,0.5)");
    fillHill(hills[1], "rgba(22,15,30,0.82)");

    // flock
    for (var b = 0; b < boids.length; b++) {
      var bd = boids[b], sp = Math.hypot(bd.vx, bd.vy);
      if (sp < 0.001) continue;
      var c = bd.vx / sp, s = bd.vy / sp;
      var scl = 2.5 + bd.z * 3.2;
      ctx.globalAlpha = 0.34 + bd.z * 0.56;
      ctx.fillStyle = "#171020";
      bird(bd.x, bd.y, c, s, scl);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // foreground ridge — drawn IN FRONT of the flock so low birds pass behind it (depth)
    var fp = hills[2];
    fillHill(fp, "#080610");
    ctx.beginPath();
    for (var k = 0; k < fp.length; k++) { var X = fp[k].x * W, Y = fp[k].y * H; if (k === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y); }
    ctx.strokeStyle = "rgba(255,150,95,0.22)"; ctx.lineWidth = 2; ctx.lineJoin = "round"; ctx.stroke();
  }

  // a small swept chevron (distant-bird silhouette), oriented to (c,s)
  var BP = [[0.95, 0], [-0.55, -0.92], [-0.18, 0], [-0.55, 0.92]];
  function bird(x, y, c, s, scl) {
    ctx.beginPath();
    for (var i = 0; i < 4; i++) {
      var px = BP[i][0] * scl, py = BP[i][1] * scl;
      var X = x + px * c - py * s, Y = y + px * s + py * c;
      if (i === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y);
    }
    ctx.closePath();
  }

  var last = 0;
  function frame(ts) {
    var dt = last ? Math.min((ts - last) / 1000, 0.05) : 0.016; last = ts;
    update(dt); render();
    requestAnimationFrame(frame);
  }

  // ---------------- input ----------------
  var downX = 0, downY = 0, downT = 0, moved = false;
  canvas.addEventListener("pointerdown", function (e) { e.preventDefault(); unlock(); mouse.x = e.clientX; mouse.y = e.clientY; mouse.on = true; downX = e.clientX; downY = e.clientY; downT = perfNow(); moved = false; fade(); });
  canvas.addEventListener("pointermove", function (e) { mouse.x = e.clientX; mouse.y = e.clientY; mouse.on = true; if (Math.hypot(e.clientX - downX, e.clientY - downY) > 8) moved = true; });
  canvas.addEventListener("pointerup", function (e) {
    if (!moved && perfNow() - downT < 400) { pulses.push({ x: e.clientX, y: e.clientY, t: 0, r: 0, max: 0.4 }); sndWhoosh(0.9); }
    if (e.pointerType === "touch") mouse.on = false;
  });
  canvas.addEventListener("pointerleave", function () { mouse.on = false; });

  modeBtn.addEventListener("click", function () {
    mode = mode === "flee" ? "gather" : "flee";
    modeBtn.textContent = mode === "flee" ? "Flee" : "Gather";
    modeBtn.setAttribute("aria-pressed", mode === "gather" ? "true" : "false");
    unlock();
  });
  soundBtn.addEventListener("click", function () {
    soundOn = !soundOn; soundBtn.setAttribute("aria-pressed", soundOn ? "true" : "false");
    if (outGain) outGain.gain.value = soundOn ? 1 : 0; unlock();
  });
  var faded = false;
  function fade() { if (!faded) { faded = true; setTimeout(function () { hintEl.classList.add("is-gone"); }, 400); } }
  setTimeout(function () { hintEl.classList.add("is-gone"); }, 6000);

  // ============================ AUDIO ============================
  var actx = null, master = null, outGain = null, wind = null, windGain = null, windLP = null, convo = null, wet = null;
  function perfNow() { return (window.performance && performance.now) ? performance.now() : Date.now(); }
  function initAudio() {
    if (actx) return;
    try {
      actx = new (window.AudioContext || window.webkitAudioContext)();
      outGain = actx.createGain(); outGain.gain.value = soundOn ? 1 : 0;
      master = actx.createGain(); master.gain.value = 0.9;
      convo = actx.createConvolver(); convo.buffer = makeImpulse(2.2, 3);
      wet = actx.createGain(); wet.gain.value = 0.22;
      master.connect(outGain); wet.connect(convo); convo.connect(outGain); outGain.connect(actx.destination);
      // gentle wind bed
      wind = pinkNoise(); windLP = actx.createBiquadFilter(); windLP.type = "lowpass"; windLP.frequency.value = 620;
      windGain = actx.createGain(); windGain.gain.value = 0.0;
      wind.connect(windLP); windLP.connect(windGain); windGain.connect(master); windGain.connect(wet);
      wind.start(0);
    } catch (e) { actx = null; }
  }
  function makeImpulse(dur, decay) {
    var n = Math.floor(actx.sampleRate * dur), buf = actx.createBuffer(2, n, actx.sampleRate);
    for (var ch = 0; ch < 2; ch++) { var d = buf.getChannelData(ch); for (var i = 0; i < n; i++) { var t = i / n; d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay); } }
    return buf;
  }
  function pinkNoise() {
    var n = actx.sampleRate * 2, buf = actx.createBuffer(1, n, actx.sampleRate), d = buf.getChannelData(0);
    var b0 = 0, b1 = 0, b2 = 0;
    for (var i = 0; i < n; i++) { var w = Math.random() * 2 - 1; b0 = 0.997 * b0 + 0.029 * w; b1 = 0.985 * b1 + 0.032 * w; b2 = 0.95 * b2 + 0.048 * w; d[i] = (b0 + b1 + b2 + w * 0.1) * 0.2; }
    var s = actx.createBufferSource(); s.buffer = buf; s.loop = true; return s;
  }
  function unlock() { initAudio(); if (actx && actx.state === "suspended") actx.resume(); if (actx) { var b = actx.createBuffer(1, 1, 22050), s = actx.createBufferSource(); s.buffer = b; s.connect(actx.destination); s.start(0); } }
  function ambientTick() {
    if (!actx || !windGain) return;
    var target = 0.05 + Math.min(0.22, agitation * 0.5);
    windGain.gain.setTargetAtTime(target, actx.currentTime, 0.25);
    windLP.frequency.setTargetAtTime(500 + Math.min(900, agitation * 1600), actx.currentTime, 0.3);
  }
  function sndWhoosh(vel) {
    if (!actx || !soundOn) return;
    var t = actx.currentTime, s = pinkNoise();
    var bp = actx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.setValueAtTime(320, t); bp.frequency.exponentialRampToValueAtTime(1400, t + 0.18); bp.Q.value = 0.8;
    var g = actx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.16 * vel, t + 0.05); g.gain.exponentialRampToValueAtTime(0.0008, t + 0.45);
    s.connect(bp); bp.connect(g); g.connect(master); g.connect(wet); s.start(t); s.stop(t + 0.5);
  }

  // ---------------- boot ----------------
  resize();
  requestAnimationFrame(frame);
})();
