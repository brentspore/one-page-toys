/* Deep Hollow — No. 089
 * A faithful rope-climbing cave-descent platformer (the Downland lineage),
 * reskinned as a bioluminescent hollow. You descend single-screen chambers:
 * walk the ledges, climb glowing vines, grab every key to unlock the door, and
 * drop deeper — dodging falling drips and bouncing spore-balls before the
 * per-chamber timer runs out. No fall damage (you can drop safely); death comes
 * from hazards and the clock. Endless descent; best score + depth saved.
 *
 * Everything renders into a fixed 480×640 design space scaled to fit. */
(function () {
  "use strict";

  var canvas = document.getElementById("canvas");
  var ctx = canvas.getContext("2d", { alpha: false });

  var hud = document.getElementById("hud");
  var depthEl = document.getElementById("depth");
  var scoreEl = document.getElementById("score");
  var keysEl = document.getElementById("keys");
  var livesEl = document.getElementById("lives");
  var timerWrap = document.getElementById("timerWrap");
  var timerBar = document.getElementById("timerBar");
  var soundBtn = document.getElementById("soundBtn");
  var overlay = document.getElementById("overlay");
  var ovEyebrow = document.getElementById("ovEyebrow");
  var ovTitle = document.getElementById("ovTitle");
  var ovText = document.getElementById("ovText");
  var ovBtn = document.getElementById("ovBtn");
  var ovKeys = document.getElementById("ovKeys");
  var hintEl = document.getElementById("hint");
  var pad = document.getElementById("pad");

  var REDMO = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var COARSE = (window.matchMedia && window.matchMedia("(pointer: coarse)").matches) || ("ontouchstart" in window) || navigator.maxTouchPoints > 0;

  /* ------------------------------------------------------------- constants */

  var DW = 480, DH = 640;         // design space
  var WALL = 20;                  // rock wall thickness
  var TOP_Y = 96, BOT_Y = 560;    // platform band
  var PH = 12;                    // platform thickness
  var PW = { w: 22, h: 28 };      // player size

  var GRAV = 1500, MOVE = 190, ACCEL = 1500, FRICT = 1400, AIR = 700;
  var JUMP = 430, CLIMB = 165, DROP_MAX = 900;
  var FATAL_FALL_GAPS = 1.7;      // a plunge longer than this many ledge-gaps (from the apex) is lethal
  var GRAB_R = 15;

  var BEST_KEY = "deep_hollow_best";
  var DEPTH_KEY = "deep_hollow_depth";
  var SOUND_KEY = "deep_hollow_sound";

  var COL = {
    deep: "#04101a", cave: "#0a1e2c", glow: "#4fe0c8", glow2: "#63b8ff",
    vine: "#7de08a", amber: "#ffcf6a", danger: "#ff6a8a", paper: "#dff3ef"
  };

  /* ----------------------------------------------------------------- state */

  var W = 0, H = 0, DPR = 1, scale = 1, ox = 0, oy = 0;
  var running = false, over = false, started = false, dying = 0, transit = 0;
  var depth = 1, score = 0, lives = 3, best = 0, bestDepth = 0;
  var timeLeft = 0, timeMax = 0;
  var shake = 0, flash = 0, flashCol = "255,106,138";
  var bannerText = "", bannerT = 0, bannerCol = "#4fe0c8";
  function banner(text, col) { bannerText = text; bannerCol = col || COL.glow; bannerT = 2.3; }
  var soundOn = true;

  var chamber = null;     // { platforms, ropes, keys, door, drips, balls, spawn }
  var player = null;
  var motes = [], fx = [];

  try {
    best = parseInt(localStorage.getItem(BEST_KEY), 10) || 0;
    bestDepth = parseInt(localStorage.getItem(DEPTH_KEY), 10) || 0;
    if (localStorage.getItem(SOUND_KEY) === "0") soundOn = false;
  } catch (e) {}

  /* ------------------------------------------------------------ math utils */

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function rand(a, b) { return a + Math.random() * (b - a); }
  function ri(a, b) { return Math.floor(rand(a, b + 1)); }
  function pick(a) { return a[(Math.random() * a.length) | 0]; }
  function aabb(a, b) { return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y; }

  /* ---------------------------------------------------------------- resize */

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.floor(W * DPR); canvas.height = Math.floor(H * DPR);
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    scale = Math.min(W / DW, H / DH);
    ox = (W - DW * scale) / 2; oy = (H - DH * scale) / 2;
  }
  window.addEventListener("resize", resize);
  window.addEventListener("orientationchange", function () { setTimeout(resize, 60); });

  /* ------------------------------------------------------ chamber generator */

  // Stacked ledges connected by vines, with consecutive ledges overlapping so a
  // vine always bridges them — guarantees every ledge (and thus every key and
  // the door) is reachable. No unsolvable chambers.
  function buildChamber(d) {
    var rows = Math.min(4 + Math.floor((d - 1) / 2), 6);
    var band = BOT_Y - TOP_Y;
    var gap = band / (rows - 1);
    var plats = [];
    for (var i = 0; i < rows; i++) {
      var y = TOP_Y + i * gap;
      var pw, px;
      if (i === 0) { pw = DW * 0.62; px = WALL + 6; }              // entrance ledge, left
      else if (i === rows - 1) { pw = DW * 0.66; px = clampOverlap(plats[i - 1], pw); }
      else { pw = rand(DW * 0.42, DW * 0.7); px = clampOverlap(plats[i - 1], pw); }
      plats.push({ x: px, y: y, w: pw });
    }
    // vines between consecutive ledges, placed in their horizontal overlap
    var ropes = [];
    for (i = 0; i < rows - 1; i++) {
      var a = plats[i], b = plats[i + 1];
      var l = Math.max(a.x, b.x) + 14, r = Math.min(a.x + a.w, b.x + b.w) - 14;
      var rx = l < r ? rand(l, r) : (Math.max(a.x, b.x) + Math.min(a.x + a.w, b.x + b.w)) / 2;
      ropes.push({ x: Math.round(rx), y0: a.y, y1: b.y, sway: rand(0, 6.28) });
    }
    // keys on non-entrance ledges (2 once it gets deeper)
    var nKeys = d >= 3 ? 2 : 1;
    var rowChoices = [];
    for (i = 1; i < rows; i++) rowChoices.push(i);
    shuffle(rowChoices);
    var keys = [];
    for (i = 0; i < Math.min(nKeys, rowChoices.length); i++) {
      var p = plats[rowChoices[i]];
      keys.push({ x: p.x + rand(24, p.w - 24), y: p.y - 15, taken: false, bob: rand(0, 6.28) });
    }
    // door on the bottom ledge, away from its vine
    var bp = plats[rows - 1];
    var vineBottomX = ropes.length ? ropes[ropes.length - 1].x : bp.x + bp.w / 2;
    var doorLeft = vineBottomX > bp.x + bp.w / 2;
    var door = { x: doorLeft ? bp.x + 12 : bp.x + bp.w - 44, y: bp.y - 40, w: 32, h: 40, open: false };
    // drips fall from the underside of upper ledges onto walkable ledges below
    var nDrips = Math.min(1 + Math.floor(d / 2), 4);
    var drips = [];
    for (i = 0; i < nDrips; i++) {
      var ri2 = ri(1, rows - 1);
      var above = plats[ri2 - 1], below = plats[ri2];
      var dx = clamp(rand(below.x + 16, below.x + below.w - 16), above.x + 6, above.x + above.w - 6);
      if (dx < above.x + 6 || dx > above.x + above.w - 6) dx = above.x + above.w / 2;
      drips.push({ x: dx, y0: above.y + PH, floorY: below.y, drop: null, t: rand(0, 2), interval: rand(1.5, 2.6) - Math.min(0.8, d * 0.06) });
    }
    // bouncing spore-balls
    var nBalls = Math.min(Math.floor(d / 3), 3);
    var balls = [];
    for (i = 0; i < nBalls; i++) {
      var bpz = plats[ri(1, rows - 1)];
      balls.push({ x: bpz.x + bpz.w / 2, y: bpz.y - 20, vx: rand(60, 110) * (Math.random() < 0.5 ? -1 : 1), vy: -rand(150, 260), r: 9, pulse: rand(0, 6.28) });
    }
    // glowing crystals to collect — score + an all-clear time bonus, some on risky ledges
    var gems = [];
    var nGems = ri(2, 4);
    var gRows = [];
    for (i = 1; i < rows; i++) gRows.push(i);
    shuffle(gRows);
    for (i = 0; i < nGems; i++) {
      var gpl = plats[gRows[i % gRows.length]];
      var air = i > 0 && Math.random() < 0.35;    // a few float above the ledge (need a jump)
      gems.push({ x: gpl.x + rand(18, gpl.w - 18), y: gpl.y - (air ? 44 : 14), taken: false, bob: rand(0, 6.28), hue: pick([COL.glow, COL.glow2, "#c79bff"]) });
    }
    // cave bats — a moving threat that drifts across and occasionally swoops to your height
    var bats = [];
    var nBats = d >= 2 ? Math.min(1 + Math.floor((d - 2) / 3), 3) : 0;
    for (i = 0; i < nBats; i++) {
      var byy = rand(TOP_Y + 34, BOT_Y - 46);
      bats.push({ x: rand(WALL + 24, DW - WALL - 24), y: byy, baseY: byy, targetY: byy,
        vx: rand(46, 82) * (Math.random() < 0.5 ? -1 : 1), phase: rand(0, 6.28), flap: rand(0, 6.28),
        swoop: 0, swoopT: rand(2.5, 5.5) });
    }
    chamber = { plats: plats, ropes: ropes, keys: keys, door: door, drips: drips, balls: balls,
      gems: gems, gemsTotal: gems.length, gemBonus: false, bats: bats, rows: rows,
      spawn: { x: plats[0].x + 24, y: plats[0].y - PW.h } };
  }
  function clampOverlap(prev, pw) {
    var minPx = Math.max(WALL, prev.x - pw + 70);
    var maxPx = Math.min(DW - WALL - pw, prev.x + prev.w - 70);
    if (minPx > maxPx) return clamp(prev.x, WALL, DW - WALL - pw);
    return clamp(rand(minPx, maxPx), WALL, DW - WALL - pw);
  }
  function shuffle(a) { for (var i = a.length - 1; i > 0; i--) { var j = (Math.random() * (i + 1)) | 0; var t = a[i]; a[i] = a[j]; a[j] = t; } }

  function keysLeft() { var n = 0; for (var i = 0; i < chamber.keys.length; i++) if (!chamber.keys[i].taken) n++; return n; }

  /* ---------------------------------------------------------------- player */

  function resetPlayer() {
    player = { x: chamber.spawn.x, y: chamber.spawn.y, vx: 0, vy: 0, w: PW.w, h: PW.h,
      onGround: false, onRope: null, face: 1, squash: 1, walkT: 0, blink: 0, fallY: null };
  }

  function startChamber(regen) {
    if (regen) buildChamber(depth);
    resetPlayer();
    timeMax = Math.max(22, 46 - depth * 1.6);
    timeLeft = timeMax;
    motes.length = 0;
    var nM = REDMO ? 14 : 30;
    for (var i = 0; i < nM; i++) motes.push({ x: rand(0, DW), y: rand(0, DH), vy: rand(-10, -3), vx: rand(-6, 6), r: rand(0.6, 1.8), a: rand(0.2, 0.7), ph: rand(0, 6.28) });
    updateHud();
  }

  /* ----------------------------------------------------------------- audio */

  var AC = null, master = null, comp = null, lp = null, reverb = null, outGain = null, amb = null;

  function initAudio() {
    if (AC) return;
    var C = window.AudioContext || window.webkitAudioContext;
    if (!C) return;
    AC = new C();
    outGain = AC.createGain(); outGain.gain.value = soundOn ? 1 : 0;
    lp = AC.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 11000;
    comp = AC.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 3; comp.attack.value = 0.004; comp.release.value = 0.22;
    master = AC.createGain(); master.gain.value = 0.9;
    reverb = AC.createConvolver(); reverb.buffer = caveImpulse(2.6);
    var rg = AC.createGain(); rg.gain.value = 0.8;
    var rhp = AC.createBiquadFilter(); rhp.type = "highpass"; rhp.frequency.value = 200;
    reverb.connect(rhp); rhp.connect(rg); rg.connect(master);
    master.connect(comp); comp.connect(lp); lp.connect(outGain); outGain.connect(AC.destination);
    try { var b = AC.createBuffer(1, 1, 22050), s = AC.createBufferSource(); s.buffer = b; s.connect(AC.destination); s.start(0); } catch (e) {}
    if (AC.state === "suspended") AC.resume();
    startAmbience();
  }
  function caveImpulse(sec) {
    var len = Math.floor(AC.sampleRate * sec), buf = AC.createBuffer(2, len, AC.sampleRate);
    for (var ch = 0; ch < 2; ch++) { var d = buf.getChannelData(ch), lpv = 0; for (var i = 0; i < len; i++) { var t = i / len; lpv += (Math.random() * 2 - 1 - lpv) * 0.32; d[i] = lpv * Math.pow(1 - t, 2.6); } }
    return buf;
  }
  var NOISE = null;
  function noiseBuf() { if (!NOISE) { var l = Math.floor(AC.sampleRate * 1.2); NOISE = AC.createBuffer(1, l, AC.sampleRate); var d = NOISE.getChannelData(0); for (var i = 0; i < l; i++) d[i] = Math.random() * 2 - 1; } return NOISE; }
  function vox(pan, wet) {
    var g = AC.createGain(), p = AC.createStereoPanner ? AC.createStereoPanner() : null;
    if (p) { p.pan.value = clamp(pan || 0, -1, 1); g.connect(p); p.connect(master); } else g.connect(master);
    if (wet && reverb) { var s = AC.createGain(); s.gain.value = wet; g.connect(s); s.connect(reverb); }
    return g;
  }
  function panX(x) { return clamp((x / DW - 0.5) * 1.4, -1, 1); }

  function startAmbience() {
    if (!AC || amb) return;
    amb = AC.createGain(); amb.gain.value = 0.5; amb.connect(master);
    var o = AC.createOscillator(), o2 = AC.createOscillator(), g = AC.createGain();
    o.type = "sine"; o.frequency.value = 55; o2.type = "sine"; o2.frequency.value = 82.5;
    g.gain.value = 0.05; var flt = AC.createBiquadFilter(); flt.type = "lowpass"; flt.frequency.value = 320;
    o.connect(flt); o2.connect(flt); flt.connect(g); g.connect(amb); o.start(); o2.start();
    ambNodes.push(o, o2);
    scheduleDistantDrip();
  }
  var ambNodes = [];
  function scheduleDistantDrip() {
    setTimeout(function () {
      if (AC && soundOn && amb && running) sndDrip(rand(-0.7, 0.7), 0.7);
      scheduleDistantDrip();
    }, rand(2600, 6000));
  }

  function sndStep(pan) {
    if (!AC || !soundOn) return; var t = AC.currentTime, n = AC.createBufferSource(), g = vox(pan, 0.05);
    n.buffer = noiseBuf(); var f = AC.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = 320; f.Q.value = 1.2;
    g.gain.setValueAtTime(0.06, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    n.connect(f); f.connect(g); n.start(t); n.stop(t + 0.06);
  }
  function sndJump(pan) {
    if (!AC || !soundOn) return; var t = AC.currentTime, o = AC.createOscillator(), g = vox(pan, 0.12);
    o.type = "sine"; o.frequency.setValueAtTime(300, t); o.frequency.exponentialRampToValueAtTime(560, t + 0.12);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.14, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    o.connect(g); o.start(t); o.stop(t + 0.18);
  }
  function sndLand(pan) {
    if (!AC || !soundOn) return; var t = AC.currentTime, o = AC.createOscillator(), g = vox(pan, 0.1);
    o.type = "sine"; o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(70, t + 0.09);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.18, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    o.connect(g); o.start(t); o.stop(t + 0.14);
  }
  function sndGrab(pan) {
    if (!AC || !soundOn) return; var t = AC.currentTime, n = AC.createBufferSource(), g = vox(pan, 0.14);
    n.buffer = noiseBuf(); var f = AC.createBiquadFilter(); f.type = "bandpass"; f.frequency.setValueAtTime(600, t); f.frequency.exponentialRampToValueAtTime(240, t + 0.14); f.Q.value = 3;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.09, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    n.connect(f); f.connect(g); n.start(t); n.stop(t + 0.2);
  }
  function sndKey(pan) {
    if (!AC || !soundOn) return; var t = AC.currentTime;
    [880, 1320, 1760].forEach(function (fr, i) {
      var o = AC.createOscillator(), g = vox(pan, 0.5); o.type = "sine"; o.frequency.value = fr;
      var tt = t + i * 0.04, amp = 0.16 / (1 + i * 0.7), dur = 0.7 / (1 + i * 0.5);
      g.gain.setValueAtTime(0.0001, tt); g.gain.exponentialRampToValueAtTime(amp, tt + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, tt + dur);
      o.connect(g); o.start(tt); o.stop(tt + dur + 0.02);
    });
  }
  function sndGem(pan) {
    if (!AC || !soundOn) return; var t = AC.currentTime;
    [1318, 1976, 2637].forEach(function (fr, i) {
      var o = AC.createOscillator(), g = vox(pan * 0.6, 0.42); o.type = "triangle"; o.frequency.value = fr;
      var tt = t + i * 0.035, amp = 0.11 / (1 + i * 0.5), dur = 0.5 / (1 + i * 0.4);
      g.gain.setValueAtTime(0.0001, tt); g.gain.exponentialRampToValueAtTime(amp, tt + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, tt + dur);
      o.connect(g); o.start(tt); o.stop(tt + dur + 0.02);
    });
  }
  function sndDoor(pan) {
    if (!AC || !soundOn) return; var t = AC.currentTime;
    var base = 196; [1, 1.5, 2, 3].forEach(function (m, i) {
      var o = AC.createOscillator(), g = vox(pan, 0.6); o.type = "triangle"; o.frequency.value = base * m;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12 / (1 + i), t + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1 / (1 + i * 0.5));
      o.connect(g); o.start(t); o.stop(t + 1.3);
    });
  }
  function sndDescend() {
    if (!AC || !soundOn) return; var t = AC.currentTime, o = AC.createOscillator(), g = vox(0, 0.4);
    o.type = "sine"; o.frequency.setValueAtTime(520, t); o.frequency.exponentialRampToValueAtTime(120, t + 0.7);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.2, t + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.8);
    o.connect(g); o.start(t); o.stop(t + 0.85);
  }
  function sndDrip(pan, wet) {
    if (!AC || !soundOn) return; var t = AC.currentTime, o = AC.createOscillator(), g = vox(pan, wet || 0.4);
    o.type = "sine"; o.frequency.setValueAtTime(1400, t); o.frequency.exponentialRampToValueAtTime(700, t + 0.06);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.07, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    o.connect(g); o.start(t); o.stop(t + 0.14);
  }
  function sndDeath() {
    if (!AC || !soundOn) return; var t = AC.currentTime;
    var o = AC.createOscillator(), g = vox(0, 0.5); o.type = "sine";
    o.frequency.setValueAtTime(320, t); o.frequency.exponentialRampToValueAtTime(50, t + 0.7);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.4, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.8);
    o.connect(g); o.start(t); o.stop(t + 0.85);
    var n = AC.createBufferSource(), ng = vox(0, 0.3); n.buffer = noiseBuf(); var f = AC.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 400;
    ng.gain.setValueAtTime(0.3, t); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.3); n.connect(f); f.connect(ng); n.start(t); n.stop(t + 0.32);
    if (lp) { lp.frequency.cancelScheduledValues(t); lp.frequency.setValueAtTime(700, t); lp.frequency.exponentialRampToValueAtTime(11000, t + 1.2); }
  }
  function sndTick() {
    if (!AC || !soundOn) return; var t = AC.currentTime, o = AC.createOscillator(), g = vox(0, 0.1);
    o.type = "sine"; o.frequency.value = 660; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.08, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
    o.connect(g); o.start(t); o.stop(t + 0.16);
  }
  function sndWin() {
    if (!AC || !soundOn) return; var t0 = AC.currentTime, notes = [523, 659, 784, 1047, 1319];
    notes.forEach(function (fr, i) { var t = t0 + i * 0.09, o = AC.createOscillator(), o2 = AC.createOscillator(), g = vox((i - 2) * 0.16, 0.55);
      o.type = "triangle"; o2.type = "sine"; o.frequency.value = fr; o2.frequency.value = fr * 2;
      var g2 = AC.createGain(); g2.gain.value = 0.3; o2.connect(g2); g2.connect(g);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.2, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
      o.connect(g); o.start(t); o2.start(t); o.stop(t + 0.75); o2.stop(t + 0.75); });
  }

  function setSound(on) {
    soundOn = on; soundBtn.setAttribute("aria-pressed", on ? "true" : "false"); soundBtn.textContent = on ? "♪" : "♪̸";
    if (outGain && AC) { outGain.gain.cancelScheduledValues(AC.currentTime); outGain.gain.setTargetAtTime(on ? 1 : 0, AC.currentTime, 0.02); }
    try { localStorage.setItem(SOUND_KEY, on ? "1" : "0"); } catch (e) {}
  }

  /* ---------------------------------------------------------------- input */

  var keyState = { left: false, right: false, up: false, down: false, jump: false };
  var jumpEdge = false;

  window.addEventListener("keydown", function (e) {
    var k = e.key.toLowerCase();
    if (k === "arrowleft" || k === "a") keyState.left = true;
    else if (k === "arrowright" || k === "d") keyState.right = true;
    else if (k === "arrowup" || k === "w") { keyState.up = true; if (!e.repeat) jumpEdge = true; }
    else if (k === "arrowdown" || k === "s") keyState.down = true;
    else if (k === " ") { e.preventDefault(); keyState.jump = true; if (!e.repeat) jumpEdge = true; }
    else if (k === "enter" && !running) { ovBtn.click(); return; }
    else return;
    if ([ "arrowup", "arrowdown", "arrowleft", "arrowright" ].indexOf(k) >= 0) e.preventDefault();
    if (running) { initAudio(); hideHint(); }
  });
  window.addEventListener("keyup", function (e) {
    var k = e.key.toLowerCase();
    if (k === "arrowleft" || k === "a") keyState.left = false;
    else if (k === "arrowright" || k === "d") keyState.right = false;
    else if (k === "arrowup" || k === "w") keyState.up = false;
    else if (k === "arrowdown" || k === "s") keyState.down = false;
    else if (k === " ") keyState.jump = false;
  });

  // touch pad
  if (pad) {
    pad.querySelectorAll("[data-btn]").forEach(function (btn) {
      var name = btn.getAttribute("data-btn");
      function down(e) { e.preventDefault(); initAudio(); hideHint(); btn.classList.add("is-down");
        if (name === "jump") { keyState.jump = true; jumpEdge = true; } else { keyState[name] = true; if (name === "up") jumpEdge = true; } }
      function up(e) { if (e) e.preventDefault(); btn.classList.remove("is-down");
        if (name === "jump") keyState.jump = false; else keyState[name] = false; }
      btn.addEventListener("pointerdown", down);
      btn.addEventListener("pointerup", up);
      btn.addEventListener("pointercancel", up);
      btn.addEventListener("pointerleave", up);
    });
  }

  function hideHint() { if (hintEl && !hintEl.classList.contains("is-gone")) hintEl.classList.add("is-gone"); }

  /* ------------------------------------------------------------ game flow */

  function startGame() {
    initAudio();
    depth = 1; score = 0; lives = 3; dying = 0; transit = 0;
    running = true; over = false; started = true;
    overlay.hidden = true; hud.hidden = false;
    if (pad) pad.hidden = !COARSE;
    document.body.classList.add("is-playing");
    if (hintEl) hintEl.classList.remove("is-gone");
    startChamber(true);
    updateHud();
    try { if (window.gtag) window.gtag("event", "toy_start", { toy: "deep-hollow" }); } catch (e) {}
  }

  function nextChamber() {
    var bonus = Math.round(timeLeft * 6) + depth * 60;
    score += bonus;
    depth++;
    if (depth - 1 > bestDepth) { bestDepth = depth - 1; try { localStorage.setItem(DEPTH_KEY, String(bestDepth)); } catch (e) {} }
    // depth milestone every 5: a breather reward — extra life + bonus + fanfare
    if (depth % 5 === 0) {
      score += 500;
      var gainedLife = lives < 5;
      if (gainedLife) lives++;
      banner("Depth " + depth + (gainedLife ? " · +1 life" : " · +500"), COL.amber);
      flash = 0.5; flashCol = "255,207,106";
      sndWin();
    }
    transit = 1.0;
    sndDescend();
    // build the next chamber now; the transition animates over it
    startChamber(true);
  }

  function loseLife() {
    if (dying > 0 || over) return;
    lives--;
    dying = 1.1;
    shake = REDMO ? 4 : 16;
    flash = 0.8; flashCol = "255,106,138";
    sndDeath();
    updateHud();
  }

  function afterDeath() {
    if (lives <= 0) { endGame(); return; }
    startChamber(true); // reset the chamber, fresh timer
  }

  function endGame() {
    running = false; over = true;
    document.body.classList.remove("is-playing");
    if (pad) pad.hidden = true;
    if (score > best) { best = score; try { localStorage.setItem(BEST_KEY, String(best)); } catch (e) {} }
    ovEyebrow.textContent = score >= best && score > 0 ? "A new record" : "The hollow keeps you";
    ovTitle.textContent = "Depth " + depth;
    ovText.innerHTML = "You descended to <b>depth " + depth + "</b> and scored <b>" + score.toLocaleString() + "</b>." +
      (best > score ? " Best: " + best.toLocaleString() + "." : "");
    ovBtn.textContent = "Descend again";
    overlay.hidden = false; hud.hidden = true;
    window.OPT_SHARE_TEXT = "I reached depth " + depth + " and scored " + score.toLocaleString() + " in Deep Hollow";
    try { if (window.gtag) window.gtag("event", "toy_end", { toy: "deep-hollow", score: score, depth: depth }); } catch (e) {}
  }

  ovBtn.addEventListener("click", startGame);
  soundBtn.addEventListener("click", function (e) { e.stopPropagation(); initAudio(); setSound(!soundOn); });

  /* ---------------------------------------------------------------- update */

  var lastStep = 0;
  function update(dt) {
    if (flash > 0) flash = Math.max(0, flash - dt * 1.6);
    if (shake > 0) shake = Math.max(0, shake - dt * 40);
    for (var m = 0; m < motes.length; m++) {
      var mo = motes[m]; mo.ph += dt; mo.y += mo.vy * dt; mo.x += mo.vx * dt + Math.sin(mo.ph) * 4 * dt;
      if (mo.y < -6) { mo.y = DH + 6; mo.x = rand(0, DW); }
      if (mo.x < 0) mo.x = DW; if (mo.x > DW) mo.x = 0;
    }
    updateFx(dt);

    if (!running) return;
    if (bannerT > 0) bannerT = Math.max(0, bannerT - dt);

    // chamber animation continues, but freeze player control during death/transit
    if (transit > 0) { transit -= dt; }

    if (dying > 0) {
      dying -= dt;
      player.vy += GRAV * 0.4 * dt; player.y += player.vy * dt; // slump
      if (dying <= 0) afterDeath();
      updateHazards(dt, true);
      return;
    }

    // timer
    var wasLow = timeLeft <= timeMax * 0.28;
    timeLeft -= dt;
    if (timeLeft <= timeMax * 0.28 && !wasLow) {} // (bar recolors below)
    if (timeLeft <= 0) { timeLeft = 0; loseLife(); return; }
    // low-time ticks
    if (timeLeft < 6) { tickAccum += dt; if (tickAccum > 1) { tickAccum -= 1; sndTick(); } }

    updatePlayer(dt);
    updateHazards(dt, false);
    // fatal contact
    if (checkHazardHit()) { loseLife(); return; }

    // keys
    for (var i = 0; i < chamber.keys.length; i++) {
      var k = chamber.keys[i];
      if (!k.taken && Math.abs((player.x + player.w / 2) - k.x) < 20 && Math.abs((player.y + player.h / 2) - k.y) < 22) {
        k.taken = true; score += 150; sndKey(panX(k.x)); pop(k.x, k.y, COL.amber);
        if (keysLeft() === 0) { chamber.door.open = true; sndDoor(panX(chamber.door.x)); }
        updateHud();
      }
    }
    // gems (crystals)
    var gemsLeft = 0;
    for (i = 0; i < chamber.gems.length; i++) {
      var gm = chamber.gems[i];
      if (gm.taken) continue;
      if (Math.abs((player.x + player.w / 2) - gm.x) < 18 && Math.abs((player.y + player.h / 2) - gm.y) < 20) {
        gm.taken = true; score += 40; sndGem(panX(gm.x)); pop(gm.x, gm.y, gm.hue); updateHud();
      } else gemsLeft++;
    }
    if (gemsLeft === 0 && chamber.gemsTotal > 0 && !chamber.gemBonus) {
      chamber.gemBonus = true; score += 60; timeLeft = Math.min(timeMax, timeLeft + 4);
      sndGem(0); pop(player.x + player.w / 2, player.y, COL.glow); banner("All crystals! +4s", COL.glow);
    }

    // door
    var dr = chamber.door;
    if (dr.open && player.x + player.w > dr.x && player.x < dr.x + dr.w && player.y + player.h > dr.y && player.y < dr.y + dr.h) {
      sndWin(); pop(dr.x + dr.w / 2, dr.y + dr.h / 2, COL.glow);
      nextChamber(); return;
    }
    updateHud();
  }
  var tickAccum = 0;

  function updatePlayer(dt) {
    var p = player;
    // --- on a vine ---
    if (p.onRope) {
      p.fallY = null;               // grabbing a vine cancels any fall
      var rope = p.onRope;
      p.x = rope.x - p.w / 2;
      if (keyState.up) p.y -= CLIMB * dt;
      if (keyState.down) p.y += CLIMB * dt;
      // clamp so feet reach the ledge at each end (stand off cleanly), not below it
      p.y = clamp(p.y, rope.y0 - p.h, rope.y1 - p.h);
      // climb-step sound
      if ((keyState.up || keyState.down)) { lastStep += dt; if (lastStep > 0.16) { lastStep = 0; sndStep(panX(p.x)); } }
      // dismount: jump, or push sideways onto a ledge
      if (jumpEdge || keyState.jump) { p.onRope = null; p.vy = -JUMP * 0.7; p.vx = (keyState.left ? -1 : keyState.right ? 1 : 0) * MOVE; jumpEdge = false; sndJump(panX(p.x)); return; }
      if (keyState.left || keyState.right) {
        // step off toward a ledge if standing on/near one
        var lg = ledgeAt(p.x + (keyState.left ? -6 : p.w + 6), p.y + p.h);
        if (lg) { p.onRope = null; p.vx = (keyState.left ? -1 : 1) * MOVE; p.vy = 0; }
      }
      p.squash = lerp(p.squash, 1, 0.2);
      return;
    }

    // --- walking / air ---
    var accel = p.onGround ? ACCEL : AIR;
    if (keyState.left) { p.vx -= accel * dt; p.face = -1; }
    else if (keyState.right) { p.vx += accel * dt; p.face = 1; }
    else if (p.onGround) { var f = FRICT * dt; if (p.vx > 0) p.vx = Math.max(0, p.vx - f); else p.vx = Math.min(0, p.vx + f); }
    p.vx = clamp(p.vx, -MOVE, MOVE);

    // grab a vine (press up/down while overlapping one)
    if (keyState.up || keyState.down) {
      var g = ropeNear(p);
      if (g) { p.onRope = g; p.vx = 0; p.vy = 0; sndGrab(panX(g.x)); return; }
    }
    // jump
    if ((jumpEdge) && p.onGround) { p.vy = -JUMP; p.onGround = false; p.squash = 1.35; sndJump(panX(p.x)); }
    jumpEdge = false;

    p.vy = Math.min(p.vy + GRAV * dt, DROP_MAX);
    var prevFeet = p.y + p.h;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.x = clamp(p.x, WALL, DW - WALL - p.w);

    var feet = p.y + p.h;
    // track the apex of the current airborne arc (highest point = smallest feet-y)
    if (p.fallY === null || feet < p.fallY) p.fallY = feet;
    // fell off the bottom of the chamber -> death
    if (p.y > DH + 12) { p.onGround = false; loseLife(); return; }

    // one-way ledge landing
    var was = p.onGround; p.onGround = false;
    if (p.vy >= 0) {
      for (var i = 0; i < chamber.plats.length; i++) {
        var pl = chamber.plats[i];
        if (p.x + p.w > pl.x + 2 && p.x < pl.x + pl.w - 2 && prevFeet <= pl.y + 2 && feet >= pl.y) {
          // a plunge longer than ~1.7 ledge-gaps (measured from the apex) kills on impact
          var fatalDist = (BOT_Y - TOP_Y) / (chamber.rows - 1) * FATAL_FALL_GAPS;
          if (p.fallY !== null && (pl.y - p.fallY) > fatalDist) {
            p.y = pl.y - p.h; p.onGround = true; p.fallY = null; loseLife(); return;
          }
          p.y = pl.y - p.h; p.vy = 0; p.onGround = true; p.fallY = null;
          if (!was) { sndLand(panX(p.x)); p.squash = 0.7; }
          break;
        }
      }
    }
    // walk sound + animation
    if (p.onGround && Math.abs(p.vx) > 20) { p.walkT += dt * Math.abs(p.vx) * 0.02; lastStep += dt; if (lastStep > 0.26) { lastStep = 0; sndStep(panX(p.x)); } }
    p.squash = lerp(p.squash, 1, 0.18);
    if (p.blink > 0) p.blink -= dt; else if (Math.random() < 0.004) p.blink = 0.12;
  }

  function ropeNear(p) {
    var cx = p.x + p.w / 2, cy = p.y + p.h / 2;
    for (var i = 0; i < chamber.ropes.length; i++) {
      var r = chamber.ropes[i];
      if (Math.abs(cx - r.x) < GRAB_R && cy > r.y0 - p.h && cy < r.y1 + 6) return r;
    }
    return null;
  }
  function ledgeAt(x, y) {
    for (var i = 0; i < chamber.plats.length; i++) { var pl = chamber.plats[i]; if (x > pl.x && x < pl.x + pl.w && Math.abs(y - pl.y) < 10) return pl; }
    return null;
  }

  function updateHazards(dt, frozen) {
    // drips
    for (var i = 0; i < chamber.drips.length; i++) {
      var d = chamber.drips[i];
      if (!d.drop) { d.t += dt; if (d.t >= d.interval) { d.t = 0; d.drop = { y: d.y0, v: 40 }; } }
      else {
        d.drop.v += GRAV * 1.3 * dt; d.drop.y += d.drop.v * dt;
        if (d.drop.y >= d.floorY) { splash(d.x, d.floorY); sndDrip(panX(d.x), 0.3); d.drop = null; }
      }
    }
    // balls
    for (var b = 0; b < chamber.balls.length; b++) {
      var ba = chamber.balls[b]; ba.pulse += dt;
      ba.vy += GRAV * 0.9 * dt; ba.x += ba.vx * dt; ba.y += ba.vy * dt;
      if (ba.x < WALL + ba.r) { ba.x = WALL + ba.r; ba.vx = Math.abs(ba.vx); }
      if (ba.x > DW - WALL - ba.r) { ba.x = DW - WALL - ba.r; ba.vx = -Math.abs(ba.vx); }
      // bounce off ledge tops
      for (var j = 0; j < chamber.plats.length; j++) {
        var pl = chamber.plats[j];
        if (ba.x > pl.x && ba.x < pl.x + pl.w && ba.y + ba.r > pl.y && ba.y + ba.r < pl.y + 22 && ba.vy > 0) {
          ba.y = pl.y - ba.r; ba.vy = -rand(230, 320); break;
        }
      }
      if (ba.y > DH + 40) { ba.y = TOP_Y; ba.vy = 0; } // safety
    }
    // bats: drift across, bob, and occasionally swoop toward the player's height
    for (var bt = 0; bt < chamber.bats.length; bt++) {
      var bat = chamber.bats[bt];
      bat.flap += dt * 15;
      bat.phase += dt * 1.7;
      bat.x += bat.vx * dt;
      if (bat.x < WALL + 16) { bat.x = WALL + 16; bat.vx = Math.abs(bat.vx); }
      if (bat.x > DW - WALL - 16) { bat.x = DW - WALL - 16; bat.vx = -Math.abs(bat.vx); }
      if (!frozen) {
        bat.swoopT -= dt;
        if (bat.swoopT <= 0 && player) { bat.swoopT = rand(3.5, 6.5); bat.targetY = clamp(player.y + player.h / 2, TOP_Y + 24, BOT_Y - 24); }
        bat.baseY = lerp(bat.baseY, bat.targetY, dt * 1.1);
      }
      bat.y = bat.baseY + Math.sin(bat.phase) * 11;
    }
  }

  function checkHazardHit() {
    var p = player, pb = { x: p.x + 3, y: p.y + 3, w: p.w - 6, h: p.h - 4 };
    for (var i = 0; i < chamber.drips.length; i++) {
      var d = chamber.drips[i];
      if (d.drop && d.drop.y > pb.y && d.drop.y < pb.y + pb.h && Math.abs(d.x - (pb.x + pb.w / 2)) < pb.w / 2 + 2) return true;
    }
    for (var b = 0; b < chamber.balls.length; b++) {
      var ba = chamber.balls[b];
      var cx = clamp(ba.x, pb.x, pb.x + pb.w), cy = clamp(ba.y, pb.y, pb.y + pb.h);
      var dx = ba.x - cx, dy = ba.y - cy; if (dx * dx + dy * dy < (ba.r - 1) * (ba.r - 1)) return true;
    }
    for (var bt = 0; bt < chamber.bats.length; bt++) {
      var bat = chamber.bats[bt];
      var bx = clamp(bat.x, pb.x, pb.x + pb.w), by = clamp(bat.y, pb.y, pb.y + pb.h);
      var bdx = bat.x - bx, bdy = bat.y - by; if (bdx * bdx + bdy * bdy < 64) return true; // ~8px body
    }
    return false;
  }

  /* ------------------------------------------------------------------- FX */

  function splash(x, y) { var n = REDMO ? 3 : 7; for (var i = 0; i < n; i++) { var a = rand(-2.4, -0.7); fx.push({ kind: "d", x: x, y: y, vx: Math.cos(a) * rand(20, 70), vy: Math.sin(a) * rand(30, 90), t: 0, life: rand(0.3, 0.6), col: COL.glow2 }); } }
  function pop(x, y, col) { var n = REDMO ? 5 : 12; for (var i = 0; i < n; i++) { var a = rand(0, 6.28); fx.push({ kind: "p", x: x, y: y, vx: Math.cos(a) * rand(30, 130), vy: Math.sin(a) * rand(30, 130), t: 0, life: rand(0.4, 0.8), col: col }); } }
  function updateFx(dt) {
    for (var i = fx.length - 1; i >= 0; i--) { var f = fx[i]; f.t += dt; f.x += f.vx * dt; f.y += f.vy * dt; if (f.kind !== "p") f.vy += 400 * dt; if (f.t >= f.life) fx.splice(i, 1); }
  }

  /* ---------------------------------------------------------------- render */

  function render() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = COL.deep; ctx.fillRect(0, 0, W, H);
    var sx = shake > 0.3 ? rand(-shake, shake) * 0.5 : 0, sy = shake > 0.3 ? rand(-shake, shake) * 0.5 : 0;
    ctx.save();
    ctx.translate(ox + sx, oy + sy);
    ctx.scale(scale, scale);
    // clip to the chamber
    ctx.beginPath(); ctx.rect(0, 0, DW, DH); ctx.clip();

    drawCaveBg();
    if (chamber) {
      drawWalls();
      drawRopes();
      drawPlatforms();
      drawDoor();
      drawKeys();
      drawGems();
      drawDrips();
      drawBalls();
      drawBats();
      drawMotes();
      if (player && (running || transit > 0)) drawPlayer();
      drawHeadlamp();
    }
    // descent transition wipe
    if (transit > 0) drawTransit();
    ctx.restore();

    // flash + vignette in screen space
    if (flash > 0) { ctx.fillStyle = "rgba(" + flashCol + "," + flash * 0.4 + ")"; ctx.fillRect(0, 0, W, H); }
    var vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.34, W / 2, H / 2, Math.max(W, H) * 0.72);
    vg.addColorStop(0, "rgba(2,8,14,0)"); vg.addColorStop(1, "rgba(2,8,14,0.66)");
    ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);

    // milestone / bonus banner (screen space)
    if (bannerT > 0 && bannerText) {
      var a = Math.min(1, bannerT * 1.4) * Math.min(1, (2.3 - bannerT) * 3);
      ctx.save(); ctx.globalAlpha = a;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.font = "700 " + Math.round(clamp(W * 0.05, 18, 30)) + "px 'Geist', system-ui, sans-serif";
      var by = H * 0.26 - (2.3 - bannerT) * 12;
      ctx.fillStyle = "rgba(2,10,16,0.55)"; ctx.fillText(bannerText, W / 2 + 1, by + 1);
      ctx.fillStyle = bannerCol; ctx.shadowColor = bannerCol; ctx.shadowBlur = 16; ctx.fillText(bannerText, W / 2, by);
      ctx.restore();
    }
  }

  function drawCaveBg() {
    var g = ctx.createLinearGradient(0, 0, 0, DH);
    g.addColorStop(0, "#06161f"); g.addColorStop(0.5, "#081a26"); g.addColorStop(1, "#04101a");
    ctx.fillStyle = g; ctx.fillRect(0, 0, DW, DH);
    // faint rock strata
    ctx.save(); ctx.globalAlpha = 0.5;
    for (var i = 0; i < 7; i++) {
      var y = (i / 7) * DH + (depth * 13) % (DH / 7);
      ctx.strokeStyle = "rgba(30,70,90," + (0.05 + (i % 2) * 0.03) + ")"; ctx.lineWidth = 2;
      ctx.beginPath(); for (var x = 0; x <= DW; x += 24) ctx.lineTo(x, y + Math.sin(x * 0.02 + i) * 6); ctx.stroke();
    }
    ctx.restore();
  }

  function drawWalls() {
    var g1 = ctx.createLinearGradient(0, 0, WALL, 0);
    g1.addColorStop(0, "#0c2430"); g1.addColorStop(1, "rgba(12,36,48,0)");
    ctx.fillStyle = g1; ctx.fillRect(0, 0, WALL + 8, DH);
    var g2 = ctx.createLinearGradient(DW - WALL, 0, DW, 0);
    g2.addColorStop(0, "rgba(12,36,48,0)"); g2.addColorStop(1, "#0c2430");
    ctx.fillStyle = g2; ctx.fillRect(DW - WALL - 8, 0, WALL + 8, DH);
  }

  function drawPlatforms() {
    for (var i = 0; i < chamber.plats.length; i++) {
      var p = chamber.plats[i];
      // rock slab
      var g = ctx.createLinearGradient(0, p.y, 0, p.y + PH + 10);
      g.addColorStop(0, "#12303e"); g.addColorStop(1, "#081a24");
      ctx.fillStyle = g; roundRect(p.x, p.y, p.w, PH + 8, 4); ctx.fill();
      // glowing bio-moss top edge
      ctx.save(); ctx.globalCompositeOperation = "lighter";
      var mg = ctx.createLinearGradient(0, p.y - 3, 0, p.y + 4);
      mg.addColorStop(0, "rgba(79,224,200,0)"); mg.addColorStop(0.6, "rgba(79,224,200,0.55)"); mg.addColorStop(1, "rgba(79,224,200,0)");
      ctx.fillStyle = mg; ctx.fillRect(p.x, p.y - 3, p.w, 7);
      // little moss glints
      for (var m = 0; m < p.w; m += 26) { ctx.fillStyle = "rgba(125,224,138," + (0.3 + 0.3 * Math.sin(m + i)) + ")"; ctx.beginPath(); ctx.arc(p.x + 8 + m, p.y - 1, 1.4, 0, 6.28); ctx.fill(); }
      ctx.restore();
    }
  }

  function drawRopes() {
    for (var i = 0; i < chamber.ropes.length; i++) {
      var r = chamber.ropes[i]; r.sway += 0.02;
      ctx.save(); ctx.globalCompositeOperation = "lighter";
      // glow
      ctx.strokeStyle = "rgba(125,224,138,0.25)"; ctx.lineWidth = 7; ctx.lineCap = "round";
      vinePath(r); ctx.stroke();
      ctx.restore();
      // core vine
      ctx.strokeStyle = "#5fbf74"; ctx.lineWidth = 3; ctx.lineCap = "round";
      vinePath(r); ctx.stroke();
      // leaf nodes
      for (var y = r.y0 + 16; y < r.y1 - 8; y += 26) {
        var wob = Math.sin(y * 0.05 + r.sway) * 3;
        ctx.fillStyle = "rgba(125,224,138,0.9)";
        ctx.beginPath(); ctx.ellipse(r.x + wob + 5, y, 4, 2.2, -0.5, 0, 6.28); ctx.fill();
      }
    }
  }
  function vinePath(r) {
    ctx.beginPath();
    for (var y = r.y0; y <= r.y1; y += 8) { var wob = Math.sin(y * 0.05 + r.sway) * 3; if (y === r.y0) ctx.moveTo(r.x + wob, y); else ctx.lineTo(r.x + wob, y); }
  }

  function drawKeys() {
    for (var i = 0; i < chamber.keys.length; i++) {
      var k = chamber.keys[i]; if (k.taken) continue; k.bob += 0.05;
      var yy = k.y + Math.sin(k.bob) * 3;
      ctx.save(); ctx.globalCompositeOperation = "lighter";
      var gl = ctx.createRadialGradient(k.x, yy, 1, k.x, yy, 18);
      gl.addColorStop(0, "rgba(255,207,106,0.5)"); gl.addColorStop(1, "rgba(255,207,106,0)");
      ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(k.x, yy, 18, 0, 6.28); ctx.fill();
      ctx.restore();
      // key shape
      ctx.fillStyle = COL.amber; ctx.strokeStyle = "#b9852f"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(k.x, yy - 4, 4, 0, 6.28); ctx.fill();
      ctx.fillRect(k.x - 1.3, yy - 2, 2.6, 11);
      ctx.fillRect(k.x - 1.3, yy + 6, 5, 2.2);
      ctx.fillRect(k.x - 1.3, yy + 2.5, 4, 2);
    }
  }

  function hexToRgb(h) { h = h.replace("#", ""); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; }
  function drawGems() {
    for (var i = 0; i < chamber.gems.length; i++) {
      var g = chamber.gems[i]; if (g.taken) continue; g.bob += 0.045;
      var yy = g.y + Math.sin(g.bob) * 3, rgb = hexToRgb(g.hue), rs = rgb[0] + "," + rgb[1] + "," + rgb[2];
      ctx.save(); ctx.globalCompositeOperation = "lighter";
      var gl = ctx.createRadialGradient(g.x, yy, 1, g.x, yy, 16);
      gl.addColorStop(0, "rgba(" + rs + ",0.55)"); gl.addColorStop(1, "rgba(" + rs + ",0)");
      ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(g.x, yy, 16, 0, 6.28); ctx.fill();
      ctx.restore();
      // faceted crystal
      var s = 6.5 + Math.sin(g.bob * 2) * 0.4;
      ctx.beginPath();
      ctx.moveTo(g.x, yy - s); ctx.lineTo(g.x + s * 0.7, yy - s * 0.15); ctx.lineTo(g.x, yy + s); ctx.lineTo(g.x - s * 0.7, yy - s * 0.15); ctx.closePath();
      ctx.fillStyle = g.hue; ctx.fill();
      ctx.beginPath(); ctx.moveTo(g.x, yy - s); ctx.lineTo(g.x + s * 0.7, yy - s * 0.15); ctx.lineTo(g.x, yy + s); ctx.closePath();
      ctx.fillStyle = "rgba(255,255,255,0.35)"; ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.7)"; ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.moveTo(g.x, yy - s); ctx.lineTo(g.x, yy + s); ctx.moveTo(g.x - s * 0.7, yy - s * 0.15); ctx.lineTo(g.x + s * 0.7, yy - s * 0.15); ctx.stroke();
    }
  }

  function drawBats() {
    for (var i = 0; i < chamber.bats.length; i++) {
      var b = chamber.bats[i], flap = Math.sin(b.flap) * 0.7;
      ctx.save(); ctx.translate(b.x, b.y);
      // menacing under-glow so it's always readable in the dark
      ctx.save(); ctx.globalCompositeOperation = "lighter";
      var gl = ctx.createRadialGradient(0, 0, 1, 0, 0, 20);
      gl.addColorStop(0, "rgba(255,106,138,0.28)"); gl.addColorStop(1, "rgba(255,106,138,0)");
      ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(0, 0, 20, 0, 6.28); ctx.fill();
      ctx.restore();
      if (b.vx < 0) ctx.scale(-1, 1);
      // wings
      ctx.fillStyle = "#2b1830";
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(-8, -7 - flap * 7, -16, -1 + flap * 5);
      ctx.quadraticCurveTo(-10, 3, -3, 3);
      ctx.lineTo(3, 3);
      ctx.quadraticCurveTo(10, 3, 16, -1 + flap * 5);
      ctx.quadraticCurveTo(8, -7 - flap * 7, 0, 0);
      ctx.fill();
      // body
      ctx.fillStyle = "#3a2440"; ctx.beginPath(); ctx.ellipse(0, 1.5, 4, 5.5, 0, 0, 6.28); ctx.fill();
      // glowing eyes
      ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.fillStyle = COL.danger;
      ctx.beginPath(); ctx.arc(-1.6, -1, 1.1, 0, 6.28); ctx.arc(1.6, -1, 1.1, 0, 6.28); ctx.fill(); ctx.restore();
      ctx.restore();
    }
  }

  function drawDoor() {
    var d = chamber.door;
    // archway
    ctx.fillStyle = "#0a2230"; roundRect(d.x - 3, d.y - 2, d.w + 6, d.h + 2, 6); ctx.fill();
    if (d.open) {
      ctx.save(); ctx.globalCompositeOperation = "lighter";
      var g = ctx.createLinearGradient(0, d.y, 0, d.y + d.h);
      g.addColorStop(0, "rgba(79,224,200,0.7)"); g.addColorStop(1, "rgba(99,184,255,0.4)");
      ctx.fillStyle = g; roundRect(d.x, d.y, d.w, d.h, 5); ctx.fill();
      // downward shimmer
      for (var i = 0; i < 4; i++) { var yy = d.y + ((performance.now() * 0.06 + i * d.h / 4) % d.h); ctx.fillStyle = "rgba(223,243,239,0.5)"; ctx.fillRect(d.x + 4, yy, d.w - 8, 2); }
      ctx.restore();
      ctx.fillStyle = "rgba(223,243,239,0.9)"; ctx.font = "bold 10px 'Geist Mono', monospace"; ctx.textAlign = "center"; ctx.fillText("▼", d.x + d.w / 2, d.y + d.h + 12);
    } else {
      // locked
      ctx.fillStyle = "#04121a"; roundRect(d.x, d.y, d.w, d.h, 5); ctx.fill();
      ctx.fillStyle = "rgba(255,207,106,0.6)"; ctx.beginPath(); ctx.arc(d.x + d.w / 2, d.y + d.h * 0.42, 4, 0, 6.28); ctx.fill();
      ctx.fillRect(d.x + d.w / 2 - 1.5, d.y + d.h * 0.42, 3, 8);
    }
  }

  function drawDrips() {
    for (var i = 0; i < chamber.drips.length; i++) {
      var d = chamber.drips[i];
      // stalactite hint
      ctx.fillStyle = "rgba(79,224,200,0.25)"; ctx.beginPath(); ctx.moveTo(d.x - 3, d.y0); ctx.lineTo(d.x + 3, d.y0); ctx.lineTo(d.x, d.y0 + 6); ctx.closePath(); ctx.fill();
      if (d.drop) {
        ctx.save(); ctx.globalCompositeOperation = "lighter";
        var gl = ctx.createLinearGradient(0, d.drop.y - 12, 0, d.drop.y + 4);
        gl.addColorStop(0, "rgba(99,184,255,0)"); gl.addColorStop(1, "rgba(99,184,255,0.5)");
        ctx.strokeStyle = gl; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(d.x, d.drop.y - 12); ctx.lineTo(d.x, d.drop.y); ctx.stroke();
        ctx.fillStyle = "#9fd4ff"; ctx.beginPath(); ctx.ellipse(d.x, d.drop.y, 3, 4.5, 0, 0, 6.28); ctx.fill();
        ctx.restore();
      }
    }
  }

  function drawBalls() {
    for (var i = 0; i < chamber.balls.length; i++) {
      var b = chamber.balls[i];
      ctx.save(); ctx.globalCompositeOperation = "lighter";
      var r = b.r + Math.sin(b.pulse * 4) * 1.2;
      var gl = ctx.createRadialGradient(b.x, b.y, 1, b.x, b.y, r * 3);
      gl.addColorStop(0, "rgba(255,106,138,0.6)"); gl.addColorStop(0.5, "rgba(200,80,200,0.25)"); gl.addColorStop(1, "rgba(200,80,200,0)");
      ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(b.x, b.y, r * 3, 0, 6.28); ctx.fill();
      ctx.fillStyle = "#ff8fa8"; ctx.beginPath(); ctx.arc(b.x, b.y, r, 0, 6.28); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.6)"; ctx.beginPath(); ctx.arc(b.x - r * 0.3, b.y - r * 0.3, r * 0.35, 0, 6.28); ctx.fill();
      ctx.restore();
    }
  }

  function drawMotes() {
    ctx.save(); ctx.globalCompositeOperation = "lighter";
    for (var i = 0; i < motes.length; i++) { var m = motes[i]; ctx.fillStyle = "rgba(125,224,180," + (m.a * (0.5 + 0.5 * Math.sin(m.ph * 2))) + ")"; ctx.beginPath(); ctx.arc(m.x, m.y, m.r, 0, 6.28); ctx.fill(); }
    ctx.restore();
    // fx particles
    for (i = 0; i < fx.length; i++) { var f = fx[i]; var k = 1 - f.t / f.life; ctx.globalAlpha = k; ctx.fillStyle = f.col; ctx.beginPath(); ctx.arc(f.x, f.y, (f.kind === "p" ? 2.2 : 1.6) * k + 0.6, 0, 6.28); ctx.fill(); }
    ctx.globalAlpha = 1;
  }

  function drawPlayer() {
    var p = player, cx = p.x + p.w / 2, feet = p.y + p.h;
    var sq = p.squash, sw = p.w * (2 - sq), sh = p.h * sq;
    var bx = cx - sw / 2, by = feet - sh;
    // shadow
    ctx.fillStyle = "rgba(0,0,0,0.3)"; ctx.beginPath(); ctx.ellipse(cx, feet + 1, sw * 0.5, 3, 0, 0, 6.28); ctx.fill();
    // body silhouette
    ctx.fillStyle = dying > 0 ? "#3a2030" : "#0c2a34";
    roundRect(bx, by, sw, sh, 5); ctx.fill();
    // legs walk hint
    if (p.onGround && Math.abs(p.vx) > 20) { var lg = Math.sin(p.walkT) * 3; ctx.fillStyle = "#0c2a34"; ctx.fillRect(cx - 5, feet - 5, 3, 5 + lg); ctx.fillRect(cx + 2, feet - 5, 3, 5 - lg); }
    // pack + helmet
    ctx.fillStyle = "#123844"; ctx.fillRect(bx + (p.face > 0 ? -2 : sw - 1), by + sh * 0.4, 3, sh * 0.35);
    var hx = cx + p.face * 4, hy = by + 4;
    ctx.fillStyle = "#16414f"; ctx.beginPath(); ctx.arc(hx, hy, 5, Math.PI, 0); ctx.fill(); ctx.fillRect(hx - 5, hy, 10, 3);
    // headlamp bulb (glow drawn in drawHeadlamp)
    ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.fillStyle = "#fff4d0";
    ctx.beginPath(); ctx.arc(hx + p.face * 4, hy, 2.2, 0, 6.28); ctx.fill(); ctx.restore();
    p._lampX = hx + p.face * 4; p._lampY = hy;
  }

  function drawHeadlamp() {
    if (!player || !player._lampX || dying > 0) return;
    var p = player;
    ctx.save(); ctx.globalCompositeOperation = "lighter";
    // warm cone in facing direction
    var reach = 140, x = p._lampX, y = p._lampY, dir = p.face;
    var g = ctx.createRadialGradient(x, y, 4, x + dir * reach * 0.4, y + 10, reach);
    g.addColorStop(0, "rgba(255,236,180,0.34)"); g.addColorStop(0.5, "rgba(255,220,150,0.12)"); g.addColorStop(1, "rgba(255,220,150,0)");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(x, y);
    ctx.lineTo(x + dir * reach, y - reach * 0.5); ctx.lineTo(x + dir * reach * 1.05, y + reach * 0.6); ctx.closePath();
    ctx.fill();
    // soft near-glow
    var n = ctx.createRadialGradient(x, y, 2, x, y, 46);
    n.addColorStop(0, "rgba(255,236,180,0.22)"); n.addColorStop(1, "rgba(255,236,180,0)");
    ctx.fillStyle = n; ctx.beginPath(); ctx.arc(x, y, 46, 0, 6.28); ctx.fill();
    ctx.restore();
  }

  function drawTransit() {
    var k = 1 - transit; // 0..1
    ctx.fillStyle = "rgba(4,16,26," + (transit > 0.5 ? (transit - 0.5) * 2 : (0.5 - k) * 0) + ")";
    // simple downward wipe: darken then lift
    var a = transit > 0.5 ? (1 - transit) * 2 : transit * 2;
    ctx.fillStyle = "rgba(4,16,26," + (0.85 * (1 - Math.abs(transit - 0.5) * 2)) + ")";
    ctx.fillRect(0, 0, DW, DH);
    ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.fillStyle = "rgba(79,224,200," + (0.3 * (1 - Math.abs(transit - 0.5) * 2)) + ")";
    ctx.font = "bold 16px 'Geist Mono', monospace"; ctx.textAlign = "center";
    ctx.fillText("DEPTH " + depth, DW / 2, DH / 2);
    ctx.restore();
  }

  function roundRect(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  /* ------------------------------------------------------------------ HUD */

  function updateHud() {
    depthEl.textContent = depth;
    scoreEl.textContent = score.toLocaleString();
    keysEl.textContent = (chamber ? chamber.keys.length - keysLeft() : 0) + "/" + (chamber ? chamber.keys.length : 1);
    var pips = ""; for (var i = 0; i < Math.max(0, lives); i++) pips += "◆"; livesEl.textContent = pips || "—";
    var frac = timeMax > 0 ? clamp(timeLeft / timeMax, 0, 1) : 1;
    timerBar.style.transform = "scaleX(" + frac + ")";
    timerWrap.classList.toggle("is-low", frac < 0.28);
  }

  /* ----------------------------------------------------------------- loop */

  var last = performance.now();
  function frame(now) {
    var dt = Math.min((now - last) / 1000, 0.045); last = now;
    if (document.visibilityState === "visible") { update(dt); render(); }
    requestAnimationFrame(frame);
  }
  document.addEventListener("visibilitychange", function () { last = performance.now(); });

  /* ----------------------------------------------------------------- boot */

  resize();
  buildChamber(1); // a static chamber to render behind the menu
  player = { x: chamber.spawn.x, y: chamber.spawn.y, vx: 0, vy: 0, w: PW.w, h: PW.h, onGround: true, onRope: null, face: 1, squash: 1, walkT: 0, blink: 0 };
  for (var i = 0; i < 26; i++) motes.push({ x: rand(0, DW), y: rand(0, DH), vy: rand(-10, -3), vx: rand(-6, 6), r: rand(0.6, 1.8), a: rand(0.2, 0.6), ph: rand(0, 6.28) });
  setSound(soundOn);
  ovKeys.innerHTML = COARSE
    ? "◀ ▶ move &nbsp;·&nbsp; ▲ ▼ climb vines &nbsp;·&nbsp; JUMP to hop"
    : "← → move &nbsp;·&nbsp; ↑ ↓ climb vines &nbsp;·&nbsp; ↑ / space to jump" + (bestDepth ? "<br />Best depth " + bestDepth : "");
  updateHud(); hud.hidden = true;
  requestAnimationFrame(frame);

  // gentle idle drift on the menu
  (function idle() { if (!started) { for (var i = 0; i < motes.length; i++) { motes[i].y += motes[i].vy * 0.016; if (motes[i].y < -6) motes[i].y = DH + 6; } } setTimeout(idle, 16); })();
})();
