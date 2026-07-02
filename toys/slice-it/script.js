/* Slice It — a juicy fruit-slicer arcade toy.
 * Swipe a glowing blade through flying fruit; sliced fruit splits into tumbling
 * halves + a juice burst. Chain slices for combos. Dodge the bombs. Drop three
 * fruit and it's over. Vanilla Canvas 2D + Web Audio, self-contained. */
(function () {
  "use strict";

  var canvas = document.getElementById("canvas");
  var ctx = canvas.getContext("2d");
  var overlay = document.getElementById("overlay");
  var ovTitle = document.getElementById("ovTitle");
  var ovText = document.getElementById("ovText");
  var ovBtn = document.getElementById("ovBtn");
  var ovBest = document.getElementById("ovBest");
  var bestChip = document.getElementById("bestChip");
  var soundBtn = document.getElementById("soundBtn");
  var hintEl = document.getElementById("hint");

  var W = 0, H = 0, DPR = 1, MIND = 0;
  var splat, sctx;                        // persistent juice-splatter layer

  // ---- tunables ----
  var GRAV = 1150;                        // px/s²  (down) — lower = more hang time, easier to slice
  var MISS_MAX = 3;
  var SPARK = "#ffb14e";

  function rand(a, b) { return a + Math.random() * (b - a); }
  function chance(p) { return Math.random() < p; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight; MIND = Math.min(W, H);
    canvas.width = Math.floor(W * DPR); canvas.height = Math.floor(H * DPR);
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    splat = document.createElement("canvas");
    splat.width = canvas.width; splat.height = canvas.height;
    sctx = splat.getContext("2d");
    sctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  window.addEventListener("resize", resize);
  resize();

  // ============================ AUDIO ============================
  var actx = null, master = null, outGain = null, convo = null, wet = null, soundOn = true;
  function initAudio() {
    if (actx) return;
    try {
      actx = new (window.AudioContext || window.webkitAudioContext)();
      outGain = actx.createGain(); outGain.gain.value = 1;
      master = actx.createGain(); master.gain.value = 0.9;
      var comp = actx.createDynamicsCompressor();
      comp.threshold.value = -14; comp.knee.value = 26; comp.ratio.value = 3.2; comp.attack.value = 0.003; comp.release.value = 0.25;
      convo = actx.createConvolver(); convo.buffer = makeImpulse(1.6, 2.6);
      wet = actx.createGain(); wet.gain.value = 0.22;
      master.connect(comp); comp.connect(outGain);
      wet.connect(convo); convo.connect(outGain);
      outGain.connect(actx.destination);
    } catch (e) { actx = null; }
  }
  function makeImpulse(dur, decay) {
    var rate = actx.sampleRate, len = Math.floor(rate * dur), buf = actx.createBuffer(2, len, rate);
    for (var ch = 0; ch < 2; ch++) {
      var d = buf.getChannelData(ch);
      for (var i = 0; i < len; i++) { var t = i / len; d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay); }
    }
    return buf;
  }
  function unlock() {
    initAudio();
    if (actx && actx.state === "suspended") actx.resume();
    if (actx) { var b = actx.createBuffer(1, 1, 22050), s = actx.createBufferSource(); s.buffer = b; s.connect(actx.destination); s.start(0); }
  }
  function bus(g) { g.connect(master); g.connect(wet); }
  function noise(dur) {
    var n = Math.floor(actx.sampleRate * dur), buf = actx.createBuffer(1, n, actx.sampleRate), d = buf.getChannelData(0);
    for (var i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    var s = actx.createBufferSource(); s.buffer = buf; return s;
  }
  function sndSlice(pitch) {
    if (!actx || !soundOn) return;
    var t = actx.currentTime;
    // juicy noise chiff
    var s = noise(0.16), bp = actx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 1400 + pitch * 900; bp.Q.value = 0.8;
    var g = actx.createGain(); g.gain.setValueAtTime(0.0, t); g.gain.linearRampToValueAtTime(0.5, t + 0.006); g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    s.connect(bp); bp.connect(g); bus(g); s.start(t); s.stop(t + 0.17);
    // soft pitched body ("thunk")
    var o = actx.createOscillator(); o.type = "triangle"; var f0 = 220 + pitch * 260;
    o.frequency.setValueAtTime(f0 * 1.5, t); o.frequency.exponentialRampToValueAtTime(f0, t + 0.09);
    var og = actx.createGain(); og.gain.setValueAtTime(0.18, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    o.connect(og); bus(og); o.start(t); o.stop(t + 0.17);
  }
  var lastWhoosh = 0;
  function sndWhoosh(spd) {
    if (!actx || !soundOn) return;
    var t = actx.currentTime; if (t - lastWhoosh < 0.09) return; lastWhoosh = t;
    var s = noise(0.2), bp = actx.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = 1.1;
    var f = 700 + clamp(spd / 6, 0, 900);
    bp.frequency.setValueAtTime(f, t); bp.frequency.linearRampToValueAtTime(f + 500, t + 0.14);
    var g = actx.createGain(); var amp = clamp(spd / 9000, 0.02, 0.14);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(amp, t + 0.03); g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    s.connect(bp); bp.connect(g); bus(g); s.start(t); s.stop(t + 0.21);
  }
  var PENTA = [0, 3, 5, 7, 10, 12];
  function sndCombo(n) {
    if (!actx || !soundOn) return;
    var t = actx.currentTime, k = clamp(n - 1, 1, 6);
    for (var i = 0; i < k; i++) {
      var o = actx.createOscillator(); o.type = "triangle";
      var midi = 72 + PENTA[i % PENTA.length] + (i >= PENTA.length ? 12 : 0);
      o.frequency.value = 440 * Math.pow(2, (midi - 69) / 12);
      var g = actx.createGain(); var tt = t + i * 0.06;
      g.gain.setValueAtTime(0, tt); g.gain.linearRampToValueAtTime(0.16, tt + 0.01); g.gain.exponentialRampToValueAtTime(0.001, tt + 0.4);
      o.connect(g); bus(g); o.start(tt); o.stop(tt + 0.42);
    }
  }
  function sndBomb() {
    if (!actx || !soundOn) return;
    var t = actx.currentTime;
    var o = actx.createOscillator(); o.type = "sine"; o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(32, t + 0.5);
    var og = actx.createGain(); og.gain.setValueAtTime(0.6, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
    var sh = actx.createWaveShaper(); var cv = new Float32Array(256); for (var i = 0; i < 256; i++) { var x = i / 128 - 1; cv[i] = Math.tanh(x * 3); } sh.curve = cv;
    o.connect(sh); sh.connect(og); bus(og); o.start(t); o.stop(t + 0.72);
    var s = noise(0.6), lp = actx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.setValueAtTime(2200, t); lp.frequency.exponentialRampToValueAtTime(120, t + 0.5);
    var g = actx.createGain(); g.gain.setValueAtTime(0.7, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
    s.connect(lp); lp.connect(g); bus(g); s.start(t); s.stop(t + 0.62);
  }
  function sndMiss() {
    if (!actx || !soundOn) return;
    var t = actx.currentTime, o = actx.createOscillator(); o.type = "sine";
    o.frequency.setValueAtTime(180, t); o.frequency.exponentialRampToValueAtTime(70, t + 0.22);
    var g = actx.createGain(); g.gain.setValueAtTime(0.22, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
    o.connect(g); bus(g); o.start(t); o.stop(t + 0.3);
  }
  function sndOver() {
    if (!actx || !soundOn) return;
    var t = actx.currentTime, seq = [0, -2, -4, -7];
    seq.forEach(function (st, i) {
      var o = actx.createOscillator(); o.type = "sine"; o.frequency.value = 330 * Math.pow(2, st / 12);
      var g = actx.createGain(); var tt = t + i * 0.12;
      g.gain.setValueAtTime(0, tt); g.gain.linearRampToValueAtTime(0.2, tt + 0.02); g.gain.exponentialRampToValueAtTime(0.001, tt + 0.5);
      o.connect(g); bus(g); o.start(tt); o.stop(tt + 0.52);
    });
  }

  soundBtn.addEventListener("click", function () {
    soundOn = !soundOn;
    soundBtn.textContent = "Sound: " + (soundOn ? "on" : "off");
    soundBtn.setAttribute("aria-pressed", soundOn ? "true" : "false");
    if (outGain) outGain.gain.value = soundOn ? 1 : 0;
    unlock();
  });

  // ============================ FRUIT TYPES ============================
  var TYPES = [
    { skin: ["#5fce5a", "#2e8b38", "#154a1e"], flesh: "#ff5b7a", core: "#ffd0da", seeds: "#20140c", note: 0.2 },   // watermelon
    { skin: ["#ffc061", "#ff8c1a", "#c85e08"], flesh: "#ffbf6e", core: "#fff0d0", seeds: null, note: 0.5 },         // orange
    { skin: ["#c6f05a", "#7cc72c", "#3f7d16"], flesh: "#e2f2a4", core: "#f5ffd6", seeds: null, note: 0.75 },        // lime
    { skin: ["#ffe863", "#ffcf1f", "#d8a000"], flesh: "#fff2a8", core: "#fffbe0", seeds: null, note: 0.9 },         // lemon
    { skin: ["#ff7580", "#e63950", "#9c1c30"], flesh: "#ff9fb0", core: "#ffe0e6", seeds: "#ffe08a", note: 0.35 },   // strawberry
    { skin: ["#b47ce0", "#6f3ba8", "#3c1f66"], flesh: "#e6c6ff", core: "#f6e8ff", seeds: null, note: 0.6 }          // plum
  ];

  // ============================ STATE ============================
  var objs = [];        // whole flying fruit + bombs
  var halves = [];      // sliced fruit pieces
  var juices = [];      // juice particles
  var floats = [];      // floating score / combo text
  var confetti = [];
  var trail = [];       // blade points {x,y,t}
  var state = "ready";  // ready | playing | over
  var score = 0, misses = 0, best = 0;
  var spawnTimer = 0, elapsed = 0;
  var comboCount = 0, comboTimer = 0;
  var shake = 0, flash = 0;
  var last = 0;

  try { best = parseInt(localStorage.getItem("slice_best") || "0", 10) || 0; } catch (e) {}
  function setBestChip() { bestChip.textContent = "BEST " + best; }
  setBestChip();

  function reset() {
    objs.length = halves.length = juices.length = floats.length = confetti.length = trail.length = 0;
    score = 0; misses = 0; spawnTimer = 0.4; elapsed = 0; comboCount = 0; comboTimer = 0; shake = 0; flash = 0;
    if (sctx) sctx.clearRect(0, 0, W, H);
  }

  function startGame() {
    unlock();
    reset();
    state = "playing";
    overlay.classList.add("is-hidden");
    hintEl.classList.remove("is-gone");
    setTimeout(function () { hintEl.classList.add("is-gone"); }, 3200);
  }
  ovBtn.addEventListener("click", startGame);

  function gameOver() {
    state = "over";
    var nb = score > best;
    if (nb) { best = score; try { localStorage.setItem("slice_best", String(best)); } catch (e) {} setBestChip(); burstConfetti(); }
    sndOver();
    ovTitle.textContent = "Sliced " + score + "!";
    ovText.innerHTML = nb ? "&#11088; New personal best! Nicely done." : "Nice run. Think you can beat it?";
    ovBest.textContent = "Best " + best;
    ovBtn.textContent = "Play again";
    overlay.classList.remove("is-hidden");
  }

  // ---- spawning ----
  function difficulty() { return clamp(elapsed / 75, 0, 1); }       // 0→1 over ~75s
  function spawnWave() {
    var d = difficulty();
    var n = 1 + (chance(0.45 + d * 0.2) ? 1 : 0) + (chance(0.12 + d * 0.25) ? 1 : 0);
    for (var i = 0; i < n; i++) {
      var isBomb = chance(0.06 + d * 0.13) && state === "playing" && elapsed > 4;
      launch(isBomb);
    }
  }
  function launch(isBomb) {
    var r = (isBomb ? 0.052 : 0.058) * MIND;
    var x = rand(W * 0.16, W * 0.84);
    var apex = rand(0.16, 0.34) * H;                 // how high it flies (from top)
    var rise = H - apex;                              // vertical distance to climb
    var vy = -Math.sqrt(2 * GRAV * rise);
    var vx = rand(-W * 0.12, W * 0.12) + (W / 2 - x) * 0.35;
    objs.push({
      bomb: !!isBomb, x: x, y: H + r, vx: vx, vy: vy, r: r,
      rot: rand(0, 6.28), vrot: rand(-2.2, 2.2),
      type: isBomb ? null : TYPES[(Math.random() * TYPES.length) | 0],
      fuse: 0
    });
  }

  // ---- slicing ----
  function sliceObj(o, ang) {
    if (o.bomb) { bombExplode(o); return; }
    // two tumbling halves — offset + split along the blade's perpendicular so
    // they immediately part into two clear half-moons (not a pac-man wedge)
    var perp = ang + Math.PI / 2, ps = rand(150, 240), cp = Math.cos(perp), sp = Math.sin(perp);
    for (var s = -1; s <= 1; s += 2) {
      halves.push({
        type: o.type, x: o.x + cp * o.r * 0.2 * s, y: o.y + sp * o.r * 0.2 * s, r: o.r,
        vx: o.vx + cp * ps * s,
        vy: o.vy * 0.6 + sp * ps * s - rand(20, 80),
        rot: ang + (s > 0 ? 0 : Math.PI), vrot: rand(2, 5) * s,
        life: 1
      });
    }
    // juice burst + persistent splatter
    var fl = o.type.flesh;
    for (var i = 0; i < 16; i++) {
      var a = rand(0, 6.28), sp = rand(60, 340);
      juices.push({ x: o.x, y: o.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60, r: rand(2, 6), life: 1, col: fl });
    }
    stampSplat(o.x, o.y, fl, o.r);
    // score + combo
    score += 1;
    comboCount += 1; comboTimer = 0.28;
    floats.push({ x: o.x, y: o.y, txt: "+1", col: "#fff", life: 1, vy: -60, sz: 22 });
    sndSlice(o.type.note);
  }
  function registerCombo() {
    if (comboCount >= 2) {
      var bonus = comboCount;
      score += bonus;
      floats.push({ x: W / 2, y: H * 0.32, txt: comboCount + "&#215; COMBO  +" + bonus, col: "#ffd76a", life: 1.4, vy: -30, sz: 40 });
      sndCombo(comboCount);
    }
    comboCount = 0;
  }
  function bombExplode(o) {
    for (var i = 0; i < 30; i++) {
      var a = rand(0, 6.28), sp = rand(120, 520);
      juices.push({ x: o.x, y: o.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: rand(2, 7), life: 1, col: i % 3 ? "#ff8a3c" : "#ffd76a" });
    }
    shake = 26; flash = 1; sndBomb();
    var idx = objs.indexOf(o); if (idx > -1) objs.splice(idx, 1);
    gameOver();
  }

  function stampSplat(x, y, col, r) {
    if (!sctx) return;
    sctx.save(); sctx.globalCompositeOperation = "source-over";
    for (var i = 0; i < 6; i++) {
      var a = rand(0, 6.28), d = rand(0, r * 1.2), rr = rand(r * 0.12, r * 0.42);
      var px = x + Math.cos(a) * d, py = y + Math.sin(a) * d;
      var g = sctx.createRadialGradient(px, py, 0, px, py, rr);
      g.addColorStop(0, hexA(col, 0.5)); g.addColorStop(1, hexA(col, 0));
      sctx.fillStyle = g; sctx.beginPath(); sctx.arc(px, py, rr, 0, 6.283); sctx.fill();
    }
    sctx.restore();
  }
  function hexA(hex, a) {
    var n = parseInt(hex.slice(1), 16);
    return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a + ")";
  }

  // ---- confetti (new best) ----
  function burstConfetti() {
    var cols = ["#ffd76a", "#ff5470", "#5fce5a", "#5aa9ff", "#b47ce0", "#ff8c1a"];
    for (var i = 0; i < 130; i++) confetti.push({
      x: W / 2 + rand(-60, 60), y: H * 0.4, vx: rand(-360, 360), vy: rand(-620, -180),
      r: rand(3, 7), rot: rand(0, 6.28), vrot: rand(-8, 8), col: cols[(Math.random() * cols.length) | 0], life: 1
    });
  }

  // ============================ POINTER ============================
  var pt = { x: 0, y: 0, px: 0, py: 0, down: false, has: false, mouse: false };
  function toXY(e) { return { x: e.clientX, y: e.clientY }; }
  function onDown(e) {
    unlock(); pt.mouse = e.pointerType === "mouse";
    var p = toXY(e); pt.x = pt.px = p.x; pt.y = pt.py = p.y; pt.down = true; pt.has = true;
    trail.length = 0;
  }
  function onMove(e) {
    var p = toXY(e); pt.px = pt.has ? pt.x : p.x; pt.py = pt.has ? pt.y : p.y;
    pt.x = p.x; pt.y = p.y; pt.has = true;
    var isMouse = e.pointerType === "mouse" || e.pointerType === "" || e.pointerType == null;
    var cutting = isMouse || pt.down;      // mouse slices on move; touch needs finger down
    var dx = pt.x - pt.px, dy = pt.y - pt.py, seg = Math.hypot(dx, dy);
    trail.push({ x: pt.x, y: pt.y, t: performance.now() });
    if (trail.length > 22) trail.shift();
    if (state !== "playing" || !cutting) return;
    if (seg > MIND * 0.5) return;                    // teleport guard
    var spd = seg / 0.016;
    if (seg > 3) sndWhoosh(spd);
    var ang = Math.atan2(dy, dx);
    for (var i = objs.length - 1; i >= 0; i--) {
      var o = objs[i];
      if (segCircle(pt.px, pt.py, pt.x, pt.y, o.x, o.y, o.r * 1.02)) {
        var wasBomb = o.bomb;
        if (!wasBomb) objs.splice(i, 1);
        sliceObj(o, ang);
        if (wasBomb) return;                         // bomb ends the run
      }
    }
  }
  function onUp() { pt.down = false; }
  canvas.addEventListener("pointerdown", onDown);
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);

  function segCircle(x1, y1, x2, y2, cx, cy, r) {
    var dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
    var t = l2 ? ((cx - x1) * dx + (cy - y1) * dy) / l2 : 0; t = clamp(t, 0, 1);
    var qx = x1 + t * dx, qy = y1 + t * dy;
    return Math.hypot(cx - qx, cy - qy) <= r;
  }

  // ============================ DRAWING ============================
  function drawFruit(type, r) {
    var g = ctx.createRadialGradient(-r * 0.32, -r * 0.34, r * 0.1, 0, 0, r);
    g.addColorStop(0, type.skin[0]); g.addColorStop(0.55, type.skin[1]); g.addColorStop(1, type.skin[2]);
    ctx.beginPath(); ctx.arc(0, 0, r, 0, 6.283); ctx.fillStyle = g; ctx.fill();
    // rim shadow
    ctx.lineWidth = r * 0.08; ctx.strokeStyle = "rgba(0,0,0,0.18)"; ctx.stroke();
    // specular
    var sg = ctx.createRadialGradient(-r * 0.36, -r * 0.4, 0, -r * 0.36, -r * 0.4, r * 0.7);
    sg.addColorStop(0, "rgba(255,255,255,0.5)"); sg.addColorStop(1, "rgba(255,255,255,0)");
    ctx.beginPath(); ctx.arc(-r * 0.3, -r * 0.34, r * 0.5, 0, 6.283); ctx.fillStyle = sg; ctx.fill();
  }
  function drawHalfFace(type, r) {
    // flat cross-section along local x-axis, flesh in y>=0 (clipped by caller)
    ctx.beginPath(); ctx.ellipse(0, 0, r * 0.94, r * 0.94, 0, 0, 6.283);
    var fg = ctx.createRadialGradient(0, r * 0.1, r * 0.1, 0, 0, r);
    fg.addColorStop(0, type.core); fg.addColorStop(0.7, type.flesh); fg.addColorStop(1, type.skin[1]);
    ctx.fillStyle = fg; ctx.fill();
    // rind ring
    ctx.lineWidth = r * 0.12; ctx.strokeStyle = type.skin[2]; ctx.stroke();
    // seeds
    if (type.seeds) {
      ctx.fillStyle = type.seeds;
      for (var i = 0; i < 7; i++) {
        var a = (i / 7) * Math.PI - Math.PI, rr = r * 0.55;
        var sx = Math.cos(a) * rr * 0.8, sy = Math.abs(Math.sin(a)) * rr * 0.55 + r * 0.12;
        ctx.beginPath(); ctx.ellipse(sx, sy, r * 0.06, r * 0.1, a, 0, 6.283); ctx.fill();
      }
    }
  }
  function drawBomb(o) {
    var r = o.r;
    // pulsing red danger halo so the bomb never blends into the dark background
    var pulse = 0.5 + 0.5 * Math.sin(performance.now() / 140);
    ctx.save(); ctx.globalCompositeOperation = "lighter";
    var hr = r * (2.0 + pulse * 0.35);
    var hg = ctx.createRadialGradient(0, 0, r * 0.7, 0, 0, hr);
    hg.addColorStop(0, "rgba(255,60,60," + (0.34 + pulse * 0.22) + ")");
    hg.addColorStop(0.5, "rgba(255,40,40," + (0.12 + pulse * 0.1) + ")");
    hg.addColorStop(1, "rgba(255,40,40,0)");
    ctx.beginPath(); ctx.arc(0, 0, hr, 0, 6.283); ctx.fillStyle = hg; ctx.fill();
    ctx.restore();
    // body — lifted off pure black so the sphere reads on the dark felt
    var g = ctx.createRadialGradient(-r * 0.34, -r * 0.36, r * 0.1, 0, 0, r);
    g.addColorStop(0, "#6b7280"); g.addColorStop(0.5, "#2a2f37"); g.addColorStop(1, "#0d0f13");
    ctx.beginPath(); ctx.arc(0, 0, r, 0, 6.283); ctx.fillStyle = g; ctx.fill();
    // warning rim
    ctx.lineWidth = r * 0.09; ctx.strokeStyle = "rgba(255,70,64," + (0.5 + pulse * 0.35) + ")"; ctx.stroke();
    var sg = ctx.createRadialGradient(-r * 0.4, -r * 0.42, 0, -r * 0.4, -r * 0.42, r * 0.6);
    sg.addColorStop(0, "rgba(255,255,255,0.55)"); sg.addColorStop(1, "rgba(255,255,255,0)");
    ctx.beginPath(); ctx.arc(-r * 0.34, -r * 0.36, r * 0.42, 0, 6.283); ctx.fillStyle = sg; ctx.fill();
    // fuse cap + spark
    ctx.strokeStyle = "#caa46a"; ctx.lineWidth = r * 0.12; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(r * 0.12, -r * 0.86); ctx.quadraticCurveTo(r * 0.5, -r * 1.15, r * 0.34, -r * 1.4); ctx.stroke();
    var fx = r * 0.34, fy = -r * 1.4, fr = r * (0.16 + Math.random() * 0.12);
    var fg2 = ctx.createRadialGradient(fx, fy, 0, fx, fy, fr);
    fg2.addColorStop(0, "#fff"); fg2.addColorStop(0.4, SPARK); fg2.addColorStop(1, "rgba(255,120,20,0)");
    ctx.beginPath(); ctx.arc(fx, fy, fr, 0, 6.283); ctx.fillStyle = fg2; ctx.fill();
  }

  function drawBlade() {
    if (trail.length < 2) return;
    var now = performance.now();
    ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.lineCap = "round"; ctx.lineJoin = "round";
    for (var pass = 0; pass < 2; pass++) {
      for (var i = 1; i < trail.length; i++) {
        var a = trail[i - 1], b = trail[i];
        var age = (now - b.t) / 150; if (age > 1) continue;
        var alpha = (1 - age) * (i / trail.length);
        var w = (pass === 0 ? 15 : 5) * (i / trail.length);
        ctx.strokeStyle = pass === 0 ? "rgba(120,225,255," + (alpha * 0.28) + ")" : "rgba(255,255,255," + alpha + ")";
        ctx.lineWidth = w;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawHUD() {
    ctx.save();
    ctx.font = "900 " + Math.round(clamp(MIND * 0.075, 30, 62)) + "px Archivo, system-ui, sans-serif";
    ctx.textBaseline = "top"; ctx.textAlign = "left";
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.shadowColor = "rgba(0,0,0,0.5)"; ctx.shadowBlur = 12;
    ctx.fillText(String(score), 22, 54);
    ctx.shadowBlur = 0;
    // lives (fruit dots top-right)
    var r = clamp(MIND * 0.016, 8, 14);
    for (var i = 0; i < MISS_MAX; i++) {
      var x = W - 26 - i * (r * 2.6), y = 64;
      var lost = i >= (MISS_MAX - misses);
      ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283);
      if (lost) { ctx.strokeStyle = "rgba(255,120,140,0.5)"; ctx.lineWidth = 2.5; ctx.stroke(); }
      else {
        var g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, 0, x, y, r);
        g.addColorStop(0, "#ff8a9e"); g.addColorStop(1, "#e63950"); ctx.fillStyle = g; ctx.fill();
      }
    }
    ctx.restore();
  }

  // ============================ UPDATE + RENDER ============================
  function frame(ts) {
    var dt = last ? Math.min((ts - last) / 1000, 0.05) : 0; last = ts;
    elapsed += (state === "playing" ? dt : 0);

    // spawn
    if (state === "playing") {
      spawnTimer -= dt;
      if (spawnTimer <= 0) { spawnWave(); spawnTimer = rand(0.75, 1.25) - difficulty() * 0.45; }
    }
    // combo window
    if (comboTimer > 0) { comboTimer -= dt; if (comboTimer <= 0) registerCombo(); }

    // physics: whole objects
    for (var i = objs.length - 1; i >= 0; i--) {
      var o = objs[i];
      o.vy += GRAV * dt; o.x += o.vx * dt; o.y += o.vy * dt; o.rot += o.vrot * dt;
      if (o.y - o.r > H + 4) {
        objs.splice(i, 1);
        if (!o.bomb && state === "playing") {         // dropped a fruit
          misses += 1; sndMiss();
          floats.push({ x: clamp(o.x, 40, W - 40), y: H - 90, txt: "MISS", col: "#ff6f8a", life: 1, vy: -50, sz: 26 });
          if (misses >= MISS_MAX) gameOver();
        }
      }
    }
    // halves
    for (var j = halves.length - 1; j >= 0; j--) {
      var h = halves[j]; h.vy += GRAV * dt; h.x += h.vx * dt; h.y += h.vy * dt; h.rot += h.vrot * dt;
      h.life -= dt * 0.6; if (h.life <= 0 || h.y - h.r > H + 20) halves.splice(j, 1);
    }
    // juice
    for (var k = juices.length - 1; k >= 0; k--) {
      var p = juices[k]; p.vy += GRAV * 0.7 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt * 1.5;
      if (p.life <= 0) juices.splice(k, 1);
    }
    // floats
    for (var f = floats.length - 1; f >= 0; f--) {
      var ft = floats[f]; ft.y += ft.vy * dt; ft.life -= dt * (ft.life > 1 ? 0.7 : 1.1);
      if (ft.life <= 0) floats.splice(f, 1);
    }
    // confetti
    for (var c = confetti.length - 1; c >= 0; c--) {
      var cf = confetti[c]; cf.vy += GRAV * 0.5 * dt; cf.x += cf.vx * dt; cf.y += cf.vy * dt; cf.rot += cf.vrot * dt; cf.life -= dt * 0.4;
      if (cf.life <= 0 || cf.y > H + 30) confetti.splice(c, 1);
    }
    if (shake > 0) shake = Math.max(0, shake - dt * 60);
    if (flash > 0) flash = Math.max(0, flash - dt * 2.4);

    render();
    requestAnimationFrame(frame);
  }

  function render() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    // world background
    var bg = ctx.createRadialGradient(W * 0.5, H * 0.82, MIND * 0.1, W * 0.5, H * 0.4, Math.max(W, H) * 0.9);
    bg.addColorStop(0, "#241436"); bg.addColorStop(0.5, "#140b22"); bg.addColorStop(1, "#08050f");
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    // vignette
    var vg = ctx.createRadialGradient(W * 0.5, H * 0.5, MIND * 0.35, W * 0.5, H * 0.5, MIND * 0.85);
    vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,0.5)");
    ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);

    if (shake > 0) { ctx.save(); ctx.translate(rand(-shake, shake), rand(-shake, shake)); }

    // persistent juice splatter
    ctx.drawImage(splat, 0, 0, W, H);

    // juice particles
    for (var k = 0; k < juices.length; k++) {
      var p = juices[k]; ctx.globalAlpha = clamp(p.life, 0, 1); ctx.fillStyle = p.col;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (0.5 + p.life * 0.5), 0, 6.283); ctx.fill();
    }
    ctx.globalAlpha = 1;

    // halves
    for (var j = 0; j < halves.length; j++) {
      var h = halves[j]; ctx.save(); ctx.globalAlpha = clamp(h.life, 0, 1);
      ctx.translate(h.x, h.y); ctx.rotate(h.rot);
      ctx.beginPath(); ctx.rect(-h.r - 4, 0, h.r * 2 + 8, h.r + 6); ctx.clip();
      drawFruit(h.type, h.r);
      drawHalfFace(h.type, h.r);
      ctx.restore();
    }

    // whole objects
    for (var i = 0; i < objs.length; i++) {
      var o = objs[i]; ctx.save(); ctx.translate(o.x, o.y); ctx.rotate(o.rot);
      if (o.bomb) drawBomb(o); else drawFruit(o.type, o.r);
      ctx.restore();
    }

    drawBlade();

    // floating texts
    for (var f = 0; f < floats.length; f++) {
      var ft = floats[f]; ctx.save(); ctx.globalAlpha = clamp(ft.life, 0, 1);
      ctx.font = "900 " + ft.sz + "px Archivo, system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillStyle = ft.col; ctx.shadowColor = "rgba(0,0,0,0.55)"; ctx.shadowBlur = 10;
      // support the &#215; entity by decoding
      var txt = ft.txt.replace("&#215;", "×").replace("&#11088;", "⭐");
      ctx.fillText(txt, ft.x, ft.y); ctx.restore();
    }

    // confetti
    for (var c = 0; c < confetti.length; c++) {
      var cf = confetti[c]; ctx.save(); ctx.globalAlpha = clamp(cf.life * 1.4, 0, 1);
      ctx.translate(cf.x, cf.y); ctx.rotate(cf.rot); ctx.fillStyle = cf.col;
      ctx.fillRect(-cf.r, -cf.r * 0.5, cf.r * 2, cf.r); ctx.restore();
    }

    if (state === "playing" || state === "over") drawHUD();

    if (shake > 0) ctx.restore();

    // bomb flash
    if (flash > 0) { ctx.fillStyle = "rgba(255,240,220," + (flash * 0.6) + ")"; ctx.fillRect(0, 0, W, H); }
  }

  requestAnimationFrame(frame);
})();
