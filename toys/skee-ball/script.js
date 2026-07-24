/* Skee Ball — No. 090
 * A browser arcade alley. Swipe up the lane to roll: the flick's release velocity
 * sets power (how far up the board it vaults), its direction sets lateral aim.
 * Land it in the rings — 10..50 up the board, plus the corner 100s. Nine balls.
 * Vanilla Canvas 2D pseudo-3D (fixed viewpoint; power == depth up the board). */
(function () {
  "use strict";

  var canvas = document.getElementById("canvas");
  var ctx = canvas.getContext("2d");
  var hud = document.getElementById("hud");
  var ballNumEl = document.getElementById("ballNum");
  var scoreEl = document.getElementById("score");
  var bestEl = document.getElementById("best");
  var streakEl = document.getElementById("streak");
  var streakCell = document.getElementById("streakCell");
  var soundBtn = document.getElementById("soundBtn");
  var overlay = document.getElementById("overlay");
  var ovBtn = document.getElementById("ovBtn");
  var ovEyebrow = document.getElementById("ovEyebrow");
  var ovTitle = document.getElementById("ovTitle");
  var ovText = document.getElementById("ovText");
  var ovKeys = document.getElementById("ovKeys");
  var hintEl = document.getElementById("hint");

  var COARSE = (window.matchMedia && window.matchMedia("(pointer: coarse)").matches) || ("ontouchstart" in window) || navigator.maxTouchPoints > 0;
  var REDMO = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var W = 0, H = 0, DPR = 1;

  /* ------------------------------------------------------------- tuning */

  var BALLS = 9;
  var VMIN = 1.15;      // swipe speed (screen-heights/sec) that maps to power 0
  var VMAX = 6.6;       // ...that maps to power 1
  var AIM_MAX = 0.46;   // swipe angle (rad from straight-up) that maps to full lateral aim
  var ROLL_T = 0.40;    // seconds rolling up the lane
  var VAULT_T = 0.60;   // seconds airborne over the board

  // scoring geometry, in board-depth units s (0 = near end, 1 = back rim)
  var S_RAMP = 0.50;    // lane meets the ramp lip here
  var S_FRONT = 0.55;   // front edge of the scoring board
  // Target reference: raised side 100 cups, a center stack of 30/40/50 cups,
  // and a broad raised 10 rail with a 20 scoring pocket in front of the stack.
  var RINGS = [
    { s: 0.615, rxFrac: 0.72, sHalf: 0.165, pts: 10 }
  ];
  var TEN_POCKET = { s: 0.530, u: 0.0, rx: 0.135, sy: 0.038, pts: 10 };
  var POCKETS = [
    { s: 0.588, u: 0.0, rx: 0.320, sy: 0.088, pts: 20 }
  ];
  var CUPS = [
    { s: 0.672, u: 0.0, R: 0.235, pts: 30 },
    { s: 0.742, u: 0.0, R: 0.218, pts: 40 },
    { s: 0.900, u: 0.0, R: 0.198, pts: 50 },
    { s: 0.832, u: -0.60, R: 0.174, pts: 100, corner: true },
    { s: 0.832, u: 0.60, R: 0.174, pts: 100, corner: true }
  ];

  /* ------------------------------------------------------------- state */

  var state = "menu";   // menu | aim | roll | vault | land | result | over
  var ball = 0;         // balls used this game
  var score = 0;
  var best = 0;
  var streak = 0;       // consecutive 40+ scores → multiplier flair
  var running = false;
  var soundOn = true;
  var roomSeed = Math.random() * 10000;
  var gamePalette = null;
  var room = null;

  var shot = null;      // active shot: { P, A, sLand, uLand, pts, hole, t }
  var b = { s: 0, u: 0, z: 0, r: 1, spin: 0, alpha: 1 }; // ball render state
  var pops = [];        // floating score text
  var sparks = [];      // little particle bursts
  var tix = [];         // cosmetic ticket glyphs
  var motes = [];       // dust in the light
  var camShake = 0;
  var flashT = 0, flashCol = "255,207,106";
  var resultT = 0;

  try { best = parseInt(localStorage.getItem("skeeball_target_pass_best") || "0", 10) || 0; } catch (e) {}
  try { var sv = localStorage.getItem("skeeball_target_pass_sound"); if (sv === "0") soundOn = false; } catch (e) {}

  /* ---------------------------------------------------------- geometry */

  function G() {
    // Two planes: a long, nearly horizontal runway and a separate target bed
    // kicked up around 45 degrees. They meet at a hard ramp lip/crease.
    return {
      nearY: H * 0.935,                      // near end of the runway
      creaseY: H * 0.675,                    // ramp crest = raised target bottom
      topY: H * 0.105,                       // back edge of the steep target face
      cx: W * 0.5,
      nearHalf: Math.min(W * 0.285, 250),
      creaseHalf: Math.min(W * 0.220, 172),
      boardTopHalf: Math.min(W * 0.128, 112)
    };
  }
  // project depth s (0..1) + lateral u (-1..1) to screen. s <= S_RAMP is the runway; s > S_RAMP is the board.
  function proj(s, u) {
    var g = G();
    if (s <= S_RAMP) {
      var t = s / S_RAMP;                    // 0 near -> 1 crease
      var y = g.nearY + (g.creaseY - g.nearY) * easeDepth(t);
      var half = g.nearHalf + (g.creaseHalf - g.nearHalf) * t;
      var sc = 1 + (0.60 - 1) * t;
      return { x: g.cx + u * half, y: y, half: half, sc: sc, board: false };
    }
    var bp = (s - S_RAMP) / (1 - S_RAMP);    // 0 crease -> 1 top of board
    if (bp > 1) bp = 1 + (bp - 1) * 0.5;     // allow a little overshoot past the top
    var face = Math.pow(Math.min(1.12, bp), 0.78);
    var by = g.creaseY + (g.topY - g.creaseY) * face;
    var bhalf = g.creaseHalf + (g.boardTopHalf - g.creaseHalf) * Math.min(1, bp);
    var bsc = 0.60 + 0.10 * Math.min(1, bp);
    return { x: g.cx + u * bhalf, y: by, half: bhalf, sc: bsc, board: true };
  }
  function easeDepth(t) { return t * (1.10 - 0.10 * t); } // flatter runway deck

  /* ------------------------------------------------------------- audio */

  var AC = null, master = null, comp = null, convo = null, noiseBuf = null, ambienceGain = null;
  function initAudio() {
    if (AC) return;
    try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
    master = AC.createGain(); master.gain.value = soundOn ? 0.9 : 0;
    ambienceGain = AC.createGain(); ambienceGain.gain.value = soundOn ? 0.34 : 0;
    var lp = AC.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 12000;
    comp = AC.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 3; comp.attack.value = 0.004; comp.release.value = 0.2;
    convo = AC.createConvolver(); convo.buffer = makeIR(1.1, 2.6);
    var wet = AC.createGain(); wet.gain.value = 0.16;
    comp.connect(lp); lp.connect(master);
    comp.connect(convo); convo.connect(wet); wet.connect(master);
    ambienceGain.connect(master);
    master.connect(AC.destination);
    // shared noise
    var n = AC.sampleRate * 1.2; noiseBuf = AC.createBuffer(1, n, AC.sampleRate);
    var d = noiseBuf.getChannelData(0);
    for (var i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    startAmbience();
  }
  function makeIR(dur, decay) {
    var n = Math.floor(AC.sampleRate * dur), buf = AC.createBuffer(2, n, AC.sampleRate);
    for (var c = 0; c < 2; c++) {
      var ch = buf.getChannelData(c), last = 0;
      for (var i = 0; i < n; i++) {
        var white = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay);
        last = (last + 0.03 * white) / 1.03; ch[i] = last * 2.4;
      }
    }
    return buf;
  }
  function iosUnlock() {
    if (!AC) return;
    if (AC.state === "suspended") AC.resume();
    var b0 = AC.createBuffer(1, 1, AC.sampleRate), s = AC.createBufferSource();
    s.buffer = b0; s.connect(AC.destination); s.start(0);
  }
  function noiseSrc() { var s = AC.createBufferSource(); s.buffer = noiseBuf; s.loop = true; return s; }
  function env(g, t0, a, peak, d) { g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(peak, t0 + a); g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d); }

  var ambNodes = [], ambChirpTimer = null;
  function startAmbience() {
    if (!AC || !ambienceGain || ambNodes.length) return;
    var hum = AC.createOscillator(), humGain = AC.createGain(), humFilter = AC.createBiquadFilter();
    hum.type = "sine"; hum.frequency.value = 59.8;
    humGain.gain.value = 0.018;
    humFilter.type = "lowpass"; humFilter.frequency.value = 180;
    hum.connect(humFilter); humFilter.connect(humGain); humGain.connect(ambienceGain);
    hum.start();
    var shimmer = AC.createOscillator(), shimmerGain = AC.createGain(), shimmerFilter = AC.createBiquadFilter();
    shimmer.type = "triangle"; shimmer.frequency.value = 247;
    shimmerGain.gain.value = 0.004;
    shimmerFilter.type = "lowpass"; shimmerFilter.frequency.value = 900;
    shimmer.connect(shimmerFilter); shimmerFilter.connect(shimmerGain); shimmerGain.connect(ambienceGain);
    shimmer.start();
    var drone = AC.createOscillator(), droneGain = AC.createGain();
    drone.type = "triangle"; drone.frequency.value = 118;
    droneGain.gain.value = 0.006;
    drone.connect(droneGain); droneGain.connect(ambienceGain);
    drone.start();
    ambNodes = [hum, shimmer, drone];
    scheduleAmbChirp();
  }
  function scheduleAmbChirp() {
    if (!AC || ambChirpTimer) return;
    ambChirpTimer = setTimeout(function () {
      ambChirpTimer = null;
      if (AC && soundOn) sndAmbientChirp();
      scheduleAmbChirp();
    }, 2600 + Math.random() * 5200);
  }
  function sndAmbientChirp() {
    if (!AC || !ambienceGain) return; var t = AC.currentTime;
    var f = [392, 523, 659, 784][Math.floor(Math.random() * 4)];
    var o = AC.createOscillator(), g = AC.createGain(), pan = AC.createStereoPanner ? AC.createStereoPanner() : null;
    o.type = "triangle"; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.020, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    o.connect(g);
    if (pan) { pan.pan.value = Math.random() * 1.2 - 0.6; g.connect(pan); pan.connect(ambienceGain); }
    else g.connect(ambienceGain);
    o.start(t); o.stop(t + 0.22);
  }
  function setAmbienceActive(active, fade) {
    if (!AC || !ambienceGain) return;
    ambienceGain.gain.setTargetAtTime(soundOn && active ? 0.34 : 0, AC.currentTime, fade || 0.12);
  }

  // wooden roll rumble — a live source tied to ball speed
  var rollNode = null, rollGain = null, rollFilt = null, rollNode2 = null, rollGain2 = null, rollFilt2 = null, rollTickDue = 0;
  function startRoll() {
    if (!AC) return;
    stopRoll();
    rollNode = noiseSrc(); rollFilt = AC.createBiquadFilter(); rollFilt.type = "lowpass"; rollFilt.frequency.value = 320;
    rollGain = AC.createGain(); rollGain.gain.value = 0.0001;
    rollNode.connect(rollFilt); rollFilt.connect(rollGain); rollGain.connect(comp);
    rollNode2 = noiseSrc(); rollFilt2 = AC.createBiquadFilter(); rollFilt2.type = "bandpass"; rollFilt2.frequency.value = 1250; rollFilt2.Q.value = 1.4;
    rollGain2 = AC.createGain(); rollGain2.gain.value = 0.0001;
    rollNode2.connect(rollFilt2); rollFilt2.connect(rollGain2); rollGain2.connect(comp);
    rollNode.start();
    rollNode2.start();
    rollTickDue = AC.currentTime + 0.05;
  }
  function setRoll(speed) { // speed 0..1
    if (!rollGain) return;
    var t = AC.currentTime;
    rollGain.gain.setTargetAtTime(0.0001 + speed * 0.065, t, 0.035);
    rollFilt.frequency.setTargetAtTime(160 + speed * 520, t, 0.035);
    if (rollGain2) {
      rollGain2.gain.setTargetAtTime(0.0001 + speed * 0.020, t, 0.025);
      rollFilt2.frequency.setTargetAtTime(620 + speed * 1550, t, 0.03);
    }
    if (soundOn && t > rollTickDue && speed > 0.14) {
      sndRollClick(speed);
      rollTickDue = t + 0.035 + Math.random() * (0.075 - speed * 0.035);
    }
  }
  function stopRoll() {
    if (!rollNode) return;
    var t = AC.currentTime;
    try {
      rollGain.gain.setTargetAtTime(0.0001, t, 0.05);
      if (rollGain2) rollGain2.gain.setTargetAtTime(0.0001, t, 0.04);
      rollNode.stop(t + 0.2);
      if (rollNode2) rollNode2.stop(t + 0.2);
    } catch (e) {}
    rollNode = rollGain = rollFilt = rollNode2 = rollGain2 = rollFilt2 = null;
  }

  function hitNoise(t, freq, q, gain, dur, type) {
    var ns = AC.createBufferSource(); ns.buffer = noiseBuf;
    var nf = AC.createBiquadFilter(); nf.type = type || "bandpass"; nf.frequency.value = freq; nf.Q.value = q || 1;
    var ng = AC.createGain(); env(ng, t, 0.0015, gain, dur);
    ns.connect(nf); nf.connect(ng); ng.connect(comp); ns.start(t); ns.stop(t + dur + 0.05);
  }
  function bodyTone(t, freq, gain, dur, shape) {
    var o = AC.createOscillator(), g = AC.createGain();
    o.type = shape || "sine"; o.frequency.setValueAtTime(freq, t); o.frequency.exponentialRampToValueAtTime(Math.max(40, freq * 0.55), t + dur);
    env(g, t, 0.003, gain, dur); o.connect(g); g.connect(comp); o.start(t); o.stop(t + dur + 0.06);
  }
  function sndRollClick(speed) {
    if (!AC || !soundOn) return; var t = AC.currentTime;
    hitNoise(t, 900 + Math.random() * 1500, 2.4, 0.010 + speed * 0.018, 0.018 + Math.random() * 0.018, "bandpass");
    if (Math.random() < 0.24 + speed * 0.20) bodyTone(t, 120 + Math.random() * 70, 0.010, 0.035, "triangle");
  }

  function sndRamp() { // clack off the ramp lip
    if (!AC || !soundOn) return; var t = AC.currentTime;
    bodyTone(t, 185, 0.18, 0.13, "triangle");
    bodyTone(t + 0.012, 92, 0.11, 0.20, "sine");
    hitNoise(t, 1850, 1.2, 0.18, 0.045, "bandpass");
    hitNoise(t + 0.018, 520, 0.7, 0.11, 0.090, "lowpass");
  }
  function sndBoard() { // soft contact as the ball lands on the board and starts to roll
    if (!AC || !soundOn) return; var t = AC.currentTime;
    hitNoise(t, 480, 0.8, 0.075, 0.080, "lowpass");
    bodyTone(t, 145, 0.070, 0.070, "sine");
    if (Math.random() < 0.6) hitNoise(t + 0.032, 1150, 2, 0.028, 0.022, "bandpass");
  }
  function sndThock(pts) { // ball drops through a ring — hollow wooden knock, pitched by value
    if (!AC || !soundOn) return; var t = AC.currentTime;
    var base = 118 + (pts / 100) * 80;
    hitNoise(t, 680 + pts * 6, 1.2, 0.18, 0.045, "bandpass");
    bodyTone(t + 0.004, base, 0.24, 0.20, "sine");
    bodyTone(t + 0.020, base * 1.83, 0.065, 0.090, "triangle");
    hitNoise(t + 0.055, 360, 0.7, 0.075, 0.115, "lowpass");
    sndReturn(t + 0.22, pts);
  }
  function sndHundred() { // corner 100 — bright brass fanfare
    if (!AC || !soundOn) return; var t = AC.currentTime;
    sndThock(100);
    var notes = [523, 659, 784, 1046];
    notes.forEach(function (f, i) {
      var o = AC.createOscillator(), g = AC.createGain(); o.type = "triangle"; o.frequency.value = f;
      env(g, t + 0.12 + i * 0.05, 0.004, 0.09, 0.28); o.connect(g); g.connect(comp); o.start(t + 0.12 + i * 0.05); o.stop(t + 0.12 + i * 0.05 + 0.38);
    });
  }
  function sndReturn(t, pts) {
    if (!AC || !soundOn) return;
    bodyTone(t, 84 + pts * 0.15, 0.090, 0.16, "sine");
    hitNoise(t, 260, 0.8, 0.075, 0.12, "lowpass");
    hitNoise(t + 0.075, 900, 1.8, 0.028, 0.030, "bandpass");
  }
  function sndMiss() { // miss: the ball glances off wood/plastic and rattles away
    if (!AC || !soundOn) return; var t = AC.currentTime;
    hitNoise(t, 420, 0.7, 0.095, 0.13, "lowpass");
    hitNoise(t + 0.012, 1550, 1.9, 0.050, 0.035, "bandpass");
    bodyTone(t + 0.006, 86, 0.070, 0.18, "sine");
    hitNoise(t + 0.075, 760, 2.4, 0.032, 0.030, "bandpass");
    hitNoise(t + 0.145, 540, 1.8, 0.020, 0.028, "bandpass");
  }
  function sndChime(step) { // rising ladder on a streak
    if (!AC || !soundOn) return; var t = AC.currentTime;
    var scale = [523, 587, 659, 784, 880, 1046, 1175];
    var f = scale[Math.min(step, scale.length - 1)];
    var o = AC.createOscillator(), g = AC.createGain(); o.type = "triangle"; o.frequency.value = f;
    env(g, t, 0.005, 0.16, 0.5); o.connect(g); g.connect(comp); o.start(t); o.stop(t + 0.6);
  }
  function sndTick() { // ticket ratchet
    if (!AC || !soundOn) return; var t = AC.currentTime;
    var ns = AC.createBufferSource(); ns.buffer = noiseBuf; var nf = AC.createBiquadFilter(); nf.type = "highpass"; nf.frequency.value = 2600; var ng = AC.createGain();
    env(ng, t, 0.001, 0.06, 0.02); ns.connect(nf); nf.connect(ng); ng.connect(comp); ns.start(t); ns.stop(t + 0.04);
  }
  function sndFanfare() {
    if (!AC || !soundOn) return; var t = AC.currentTime;
    [523, 659, 784, 1046, 1318].forEach(function (f, i) {
      var o = AC.createOscillator(), g = AC.createGain(); o.type = "triangle"; o.frequency.value = f;
      env(g, t + i * 0.09, 0.006, 0.16, 0.5); o.connect(g); g.connect(comp); o.start(t + i * 0.09); o.stop(t + i * 0.09 + 0.6);
    });
  }
  function setSound(on) {
    soundOn = on; soundBtn.setAttribute("aria-pressed", on ? "true" : "false"); soundBtn.textContent = on ? "♪" : "♪̸";
    try { localStorage.setItem("skeeball_target_pass_sound", on ? "1" : "0"); } catch (e) {}
    if (master) master.gain.setTargetAtTime(on ? 0.9 : 0, AC.currentTime, 0.02);
    setAmbienceActive(running && state !== "over", 0.08);
    if (!on) stopRoll();
  }

  /* --------------------------------------------------------- swipe input */

  var samples = [];   // {x,y,t} recent pointer positions
  var dragging = false, dragStart = null, live = null;

  function pt(e) {
    var r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left), y: (e.clientY - r.top), t: (e.timeStamp || performance.now()) };
  }
  function onDown(e) {
    if (!running || state !== "aim") return;
    dragging = true; samples = []; var p = pt(e); dragStart = p; samples.push(p); live = null;
    try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
  }
  function onMove(e) {
    if (!dragging) return;
    var p = pt(e); samples.push(p);
    if (samples.length > 24) samples.shift();
    live = livePreview();
  }
  function onUp(e) {
    if (!dragging) return; dragging = false;
    var p = pt(e); samples.push(p);
    var v = releaseVel();
    live = null;
    if (!v) return; // dead-zone: not a real swipe
    fire(v.P, v.A);
  }
  // velocity from the last ~90ms of the swipe (the flick, not the wind-up)
  function releaseVel() {
    if (samples.length < 2) return null;
    var end = samples[samples.length - 1];
    var i = samples.length - 1;
    while (i > 0 && end.t - samples[i].t < 90) i--;
    var a = samples[i];
    var dt = (end.t - a.t) / 1000;
    if (dt <= 0) return null;
    var vx = (end.x - a.x) / dt, vy = (end.y - a.y) / dt; // px/s; vy<0 is up-screen
    var speed = Math.hypot(vx, vy);
    var totalDist = Math.hypot(end.x - dragStart.x, end.y - dragStart.y);
    if (totalDist < 22 || vy > -H * 0.6) return null;     // must be a real upward flick
    return velToShot(vx, vy, speed);
  }
  function livePreview() {
    if (samples.length < 2) return null;
    var end = samples[samples.length - 1], i = samples.length - 1;
    while (i > 0 && end.t - samples[i].t < 70) i--;
    var a = samples[i], dt = (end.t - a.t) / 1000; if (dt <= 0) return null;
    var vx = (end.x - a.x) / dt, vy = (end.y - a.y) / dt;
    if (vy > -H * 0.3) return null;
    var s = velToShot(vx, vy, Math.hypot(vx, vy));
    var r = resolve(s.P, s.A);
    return { sLand: r.sLand, uLand: r.uLand, pts: r.pts };
  }
  function velToShot(vx, vy, speed) {
    var vNorm = speed / H;
    var P = clamp((vNorm - VMIN) / (VMAX - VMIN), 0, 1);
    var ang = Math.atan2(vx, -vy); // 0 = straight up
    var A = clamp(ang / AIM_MAX, -1, 1);
    return { P: P, A: A };
  }

  /* --------------------------------------------------------- shot resolve */

  function resolve(P, A) {
    var sLand = S_FRONT + Math.pow(P, 0.92) * 0.50;      // 0.55 .. ~1.05 up the board
    var uLand = A * (0.78 + P * 0.12);
    var rimBias = Math.sin((A * 2.1 + P * 3.4) * Math.PI) * 0.012;
    sLand += rimBias;
    // too weak to crest the ramp — never reaches the board
    if (P < 0.08) return { pts: 0, sLand: 0.44, uLand: uLand, hole: "short", cupS: 0.44, cupU: uLand, refund: true };

    var cup = bestCupHit(sLand, uLand);
    if (cup) {
      return { pts: cup.pts, sLand: sLand, uLand: uLand, hole: "cup", cupS: cup.s, cupU: cup.u, rimDist: cupDist(cup, sLand, uLand) };
    }

    var pocket = bestPocketHit(sLand, uLand);
    if (pocket) {
      return { pts: pocket.pts, sLand: sLand, uLand: uLand, hole: "pocket", cupS: pocket.s, cupU: pocket.u };
    }

    if (insideRing(RINGS[0], sLand, uLand)) {
      return { pts: 10, sLand: sLand, uLand: uLand, hole: "pocket", cupS: TEN_POCKET.s, cupU: TEN_POCKET.u };
    }

    var glance = nearestCupGlance(sLand, uLand);
    if (glance) {
      return { pts: 0, sLand: sLand, uLand: uLand, hole: "miss", cupS: sLand, cupU: uLand, bounce: glance };
    }

    var railGlance = ringGlance(RINGS[0], sLand, uLand);
    if (railGlance) {
      return { pts: 0, sLand: sLand, uLand: uLand, hole: "miss", cupS: sLand, cupU: uLand, bounce: railGlance };
    }

    if (Math.abs(uLand) > 0.92 && sLand < 1.0) {
      var side = uLand < 0 ? -1 : 1;
      return { pts: 0, sLand: sLand, uLand: clamp(uLand, -0.98, 0.98), hole: "miss", cupS: sLand, cupU: clamp(uLand, -0.98, 0.98), bounce: { kind: "side", du: -side * (0.28 + P * 0.18), ds: -0.045, lift: 0.014 } };
    }

    if (sLand > 1.0 || Math.abs(uLand) > 0.96) {
      return { pts: 0, sLand: Math.min(sLand, 1.05), uLand: clamp(uLand, -1.05, 1.05), hole: "over", cupS: Math.min(sLand, 1.05), cupU: clamp(uLand, -1.05, 1.05) };
    }

    return { pts: 0, sLand: sLand, uLand: uLand, hole: "miss", cupS: sLand, cupU: uLand };
  }

  function bestCupHit(s, u) {
    var hit = null, bestD = Infinity;
    for (var i = 0; i < CUPS.length; i++) {
      var cup = CUPS[i];
      var d = cupDist(cup, s, u);
      var capture = cup.corner ? 0.90 : 0.82;
      if (d < capture && d < bestD) { hit = cup; bestD = d; }
    }
    return hit;
  }
  function cupDist(cup, s, u) {
    var sy = cup.corner ? 1.48 : 1.28;
    return Math.hypot((u - cup.u) / cup.R, ((s - cup.s) * sy) / cup.R);
  }
  function nearestCupGlance(s, u) {
    var best = null, bestD = Infinity;
    for (var i = 0; i < CUPS.length; i++) {
      var cup = CUPS[i];
      var d = cupDist(cup, s, u);
      if (d > 0.82 && d < 1.34 && d < bestD) { best = cup; bestD = d; }
    }
    if (!best) return null;
    var side = u >= best.u ? 1 : -1;
    var away = clamp((1.34 - bestD) / 0.52, 0, 1);
    return {
      kind: "cup",
      du: side * (0.10 + away * 0.18),
      ds: (s >= best.s ? 1 : -1) * (0.020 + away * 0.030),
      lift: 0.020 + away * 0.016
    };
  }
  function ringGlance(ring, s, u) {
    var d = Math.hypot(u / ring.rxFrac, (s - ring.s) / ring.sHalf);
    if (d < 1.02 || d > 1.18 || s > 0.84) return null;
    var side = u === 0 ? (Math.random() < 0.5 ? -1 : 1) : (u < 0 ? -1 : 1);
    var near = clamp((1.18 - d) / 0.16, 0, 1);
    return {
      kind: "rail",
      du: side * (0.12 + near * 0.14),
      ds: -0.035 - near * 0.018,
      lift: 0.012 + near * 0.012
    };
  }
  function bestPocketHit(s, u) {
    for (var i = 0; i < POCKETS.length; i++) {
      var p = POCKETS[i];
      var d = Math.hypot((u - p.u) / p.rx, (s - p.s) / p.sy);
      if (d < 1) return p;
    }
    return null;
  }
  function insideRing(ring, s, u) {
    var d = Math.hypot(u / ring.rxFrac, (s - ring.s) / ring.sHalf);
    return d < 1.0 && s < 0.82;
  }
  function lowerCatchFor(s, u) {
    var pocket = bestPocketHit(s, u);
    if (pocket) return { pts: pocket.pts, s: pocket.s, u: pocket.u };
    if (insideRing(RINGS[0], s, u)) return { pts: 10, s: TEN_POCKET.s, u: TEN_POCKET.u };
    return null;
  }

  function fire(P, A) {
    var r = resolve(P, A);
    shot = { P: P, A: A, sLand: r.sLand, uLand: r.uLand, pts: r.pts, hole: r.hole, cupS: r.cupS, cupU: r.cupU, rimDist: r.rimDist || 0, bounce: r.bounce || null, refund: !!r.refund, t: 0, scored: false };
    b.s = 0; b.u = 0; b.z = 0; b.r = 1; b.alpha = 1; b.spin = 0;
    state = "roll"; ball++;
    updateHud();
    hideHint();
    if (AC) { startRoll(); }
  }

  /* --------------------------------------------------------- game flow */

  function start() {
    initAudio(); iosUnlock();
    running = true; state = "aim"; ball = 0; score = 0; streak = 0; shot = null;
    b = { s: 0, u: 0, z: 0, r: 1, spin: 0, alpha: 1 };
    pops = []; sparks = []; tix = [];
    overlay.hidden = true;
    document.body.classList.add("is-playing");
    hud.hidden = false;
    streakCell.hidden = true;
    if (hintEl) hintEl.classList.remove("is-gone");
    setAmbienceActive(true, 0.10);
    updateHud();
  }

  function nextBall() {
    if (ball >= BALLS) { endGame(); return; }
    state = "aim"; shot = null;
    b = { s: 0, u: 0, z: 0, r: 1, spin: 0, alpha: 1 };
  }

  function endGame() {
    state = "over"; running = false;
    stopRoll();
    setAmbienceActive(false, 0.12);
    var isBest = score > best;
    if (isBest) { best = score; try { localStorage.setItem("skeeball_target_pass_best", String(best)); } catch (e) {} sndFanfare(); burstConfetti(); flash("255,207,106"); }
    // Skee Ball is a ticket machine: every game spits tickets, ~proportional to score.
    var tix = 0;
    if (window.OPT_TICKETS && typeof window.OPT_TICKETS.award === "function") {
      tix = Math.max(6, Math.round(score / 6));
      try { window.OPT_TICKETS.award(tix, "Skee Ball payout"); } catch (e) {}
    }
    window.OPT_SHARE_TEXT = "I scored " + score + " at Skee Ball on One Page Toys" + (isBest ? " — new personal best!" : "!");
    ovEyebrow.textContent = isBest ? "New personal best" : "Game over";
    ovTitle.textContent = score + (score === 1 ? " point" : " points");
    ovText.innerHTML = "You rolled " + BALLS + " balls for <b>" + score + "</b>" + (tix ? " and won <b>" + tix + " 🎟️</b>" : "") + "." + (isBest ? " That's your best yet." : " Best: " + best + ".") + " Line up another game.";
    ovBtn.textContent = "Roll again";
    setOvKeys();
    overlay.hidden = false;
    document.body.classList.remove("is-playing");
    updateHud();
  }

  function scoreShot() {
    if (shot.scored) return; shot.scored = true;
    var pts = shot.pts;
    if (shot.refund && !shot.refunded) {
      shot.refunded = true;
      ball = Math.max(0, ball - 1);
    }
    score += pts;
    // streak on 40+
    if (pts >= 40) { streak++; if (streak >= 2) { streakCell.hidden = false; sndChime(streak - 2); } }
    else streak = 0;
    updateHud();
    // fx pop at the cup it drops into (or the impact point on a miss)
    var pr = pts > 0 ? proj(shot.cupS, shot.cupU) : proj(shot.sLand, shot.uLand);
    shot.popX = pr.x; shot.popY = pr.y;
    if (pts === 100) { sndHundred(); flash("255,138,61"); camShake = 10; spawnPop(pr.x, pr.y - 26, "100", "255,138,61", 1.5); burstSparks(pr.x, pr.y, "255,180,90", 26); spitTickets(24); }
    else if (pts === 0 && shot.refund) { sndBoard(); camShake = 2; spawnPop(pr.x, pr.y - 18, "TRY AGAIN", "246,214,160", 0.86); }
    else if (pts === 0) { sndMiss(); camShake = 4; spawnPop(pr.x, pr.y - 18, "MISS", "180,150,120", 0.9); }
    else { sndThock(pts); spawnPop(pr.x, pr.y - 22, "+" + pts, pts >= 40 ? "255,207,106" : "246,234,214", pts >= 40 ? 1.25 : 1.0); if (pts >= 30) burstSparks(pr.x, pr.y, "232,180,90", 8 + pts / 5); spitTickets(Math.round(pts / 5)); }
  }

  function catchLowerRollbackScore() {
    var catchZone = lowerCatchFor(b.s, b.u);
    if (!catchZone) return false;
    shot.pts = catchZone.pts;
    shot.hole = "pocket";
    shot.cupS = catchZone.s;
    shot.cupU = catchZone.u;
    shot.sLand = b.s;
    shot.uLand = b.u;
    shot.bounce = null;
    shot.refund = false;
    shot.t = 0;
    b.r = 1;
    b.alpha = 1;
    sndBoard();
    return true;
  }

  /* ------------------------------------------------------------ update */

  function update(dt) {
    if (camShake > 0) camShake = Math.max(0, camShake - dt * 40);
    if (flashT > 0) flashT = Math.max(0, flashT - dt * 2.2);

    if (state === "roll") {
      shot.t += dt;
      var k = clamp(shot.t / ROLL_T, 0, 1);
      var ke = easeOut(k);
      b.s = S_RAMP * ke;
      b.u = shot.uLand * 0.42 * ke;
      b.spin += dt * (8 + shot.P * 22);
      setRoll(0.35 + shot.P * 0.65 * (1 - k * 0.4));
      if (k >= 1) { b.s = S_RAMP; state = "vault"; shot.t = 0; sndRamp(); setRoll(0); }
    } else if (state === "vault") {
      shot.t += dt;
      var vt = clamp(shot.t / VAULT_T, 0, 1);
      b.s = S_RAMP + (shot.sLand - S_RAMP) * vt;
      b.u = shot.uLand * (0.42 + 0.58 * vt);
      var peak = 0.10 + shot.P * 0.14;
      b.z = Math.sin(vt * Math.PI) * peak;   // parabolic arc
      b.spin += dt * (6 + shot.P * 14);
      stopRollFade();
      if (vt >= 1) { b.z = 0; b.s = shot.sLand; b.u = shot.uLand; state = "land"; shot.t = 0; sndBoard(); }
    } else if (state === "land") {
      shot.t += dt;
      if (shot.hole === "cup" || shot.hole === "pocket") {
        // roll toward the cup, orbit the rim, then drop through the hole
        var lt = clamp(shot.t / 0.66, 0, 1);
        var settle = clamp(lt / 0.62, 0, 1);
        var drop = clamp((lt - 0.62) / 0.38, 0, 1);
        var entrySide = shot.uLand >= shot.cupU ? 1 : -1;
        var rimEnergy = shot.hole === "cup" ? clamp((shot.rimDist - 0.45) / 0.36, 0, 1) : 0;
        var ang = settle * Math.PI * (0.9 + rimEnergy * 1.9) * entrySide;
        var orbit = (1 - settle) * rimEnergy * 0.052;
        var rimWobble = Math.sin(settle * Math.PI * 4.4) * (1 - settle) * rimEnergy * 0.012;
        b.s = shot.cupS + (shot.sLand - shot.cupS) * (1 - settle) + Math.sin(ang) * orbit * 0.48 + rimWobble * 0.25;
        b.u = shot.cupU + (shot.uLand - shot.cupU) * (1 - settle) + Math.cos(ang) * orbit + rimWobble * entrySide;
        b.z = Math.sin(settle * Math.PI) * (0.008 + rimEnergy * 0.010) - drop * 0.03;
        b.r = 1 - settle * 0.16 - drop * 0.56;
        b.alpha = 1 - clamp((drop - 0.35) / 0.65, 0, 1) * 0.95;
        b.cupSettle = settle;
        b.cupDrop = drop;
        b.cupCatch = shot.hole;
        b.spin += dt * (14 + (1 - settle) * 22);
        if (!shot.scored && drop > 0.02) scoreShot();
        if (lt >= 1) { if (!shot.scored) scoreShot(); state = "result"; resultT = 0; }
      } else if (shot.hole === "rail") {
        // 10 rail: the ball catches the big lower ring, rattles, then drops to the return.
        var rl = clamp(shot.t / 0.84, 0, 1);
        var settleRail = clamp(rl / 0.70, 0, 1);
        var dropRail = clamp((rl - 0.70) / 0.30, 0, 1);
        var wob = Math.sin(settleRail * Math.PI * 4.6) * (1 - settleRail) * 0.04;
        b.s = shot.sLand + (shot.cupS - shot.sLand) * settleRail + wob * 0.35;
        b.u = shot.uLand + (shot.cupU - shot.uLand) * settleRail + wob;
        b.z = Math.sin(settleRail * Math.PI) * 0.012 - dropRail * 0.02;
        b.r = 1 - dropRail * 0.55;
        b.cupDrop = 0;
        b.cupSettle = 0;
        b.cupCatch = null;
        b.spin += dt * (16 + (1 - settleRail) * 26);
        b.alpha = 1 - clamp((dropRail - 0.35) / 0.65, 0, 1) * 0.88;
        if (!shot.scored && dropRail > 0.02) scoreShot();
        if (rl >= 1) { if (!shot.scored) scoreShot(); state = "result"; resultT = 0; }
      } else {
        // Misses roll back down the incline or sail off the back without awarding a catch-all score.
        var ml = clamp(shot.t / 1.0, 0, 1);        // takes a moment to roll all the way back
        var rb = ml * ml;                          // accelerate as it comes down (gravity)
        var caughtLower = false;
        if (shot.hole === "over") {
          var wallHit = clamp(ml / 0.24, 0, 1);
          var fall = clamp((ml - 0.16) / 0.72, 0, 1);
          var slideDown = easeOut(fall);
          var topS = clamp(shot.sLand, 0.98, 1.05);
          var dropS = S_RAMP + 0.030 + Math.abs(shot.uLand) * 0.010;
          var recoil = Math.sin(wallHit * Math.PI) * 0.030;
          var lipHitOver = clamp((fall - 0.76) / 0.24, 0, 1);
          var lipBumpOver = Math.sin(lipHitOver * Math.PI) * (1 - clamp((fall - 0.88) / 0.12, 0, 1));
          b.s = topS + (dropS - topS) * slideDown - recoil + lipBumpOver * 0.010;
          b.u = clamp(shot.uLand * (1 - slideDown * 0.30), -0.92, 0.92);
          b.z = Math.sin(wallHit * Math.PI) * 0.040 * (1 - fall * 0.45) + Math.sin(lipHitOver * Math.PI) * 0.012;
          b.alpha = 1;
          if (!shot.bumped && ml > 0.035) {
            shot.bumped = true;
            sndBoard();
            camShake = Math.max(camShake, 3);
          }
          if (!shot.lipBumped && fall > 0.78) {
            shot.lipBumped = true;
            sndBoard();
          }
        } else if (shot.bounce && shot.sLand >= S_FRONT) {
          var hit = clamp(ml / 0.26, 0, 1);
          var roll = clamp((ml - 0.12) / 0.76, 0, 1);
          var rollBack = easeOut(roll);
          var kick = Math.sin(hit * Math.PI);
          var reboundS = clamp(shot.sLand + shot.bounce.ds * kick, 0.08, 1.02);
          var reboundU = clamp(shot.uLand + shot.bounce.du * kick, -0.96, 0.96);
          var lipS = S_RAMP + 0.020 + Math.abs(reboundU) * 0.010;
          var lipHit = clamp((roll - 0.72) / 0.28, 0, 1);
          var settleBump = Math.sin(lipHit * Math.PI) * (1 - clamp((roll - 0.84) / 0.16, 0, 1));
          b.s = reboundS + (lipS - reboundS) * rollBack + settleBump * 0.010;
          b.u = reboundU * (1 - rollBack * 0.36);
          b.z = Math.sin(hit * Math.PI) * shot.bounce.lift * (1 - roll * 0.70) + settleBump * 0.012;
          if (!shot.bumped && ml > 0.045) {
            shot.bumped = true;
            sndBoard();
            camShake = Math.max(camShake, shot.bounce.kind === "side" ? 4 : 2);
          }
          if (!shot.lipBumped && roll > 0.74) {
            shot.lipBumped = true;
            sndBoard();
          }
          b.alpha = 1 - clamp((ml - 0.88) / 0.12, 0, 1);
        } else if (shot.sLand >= S_FRONT) {
          var slide = clamp(ml / 0.82, 0, 1);
          var lipStop = S_RAMP + 0.024 + Math.abs(shot.uLand) * 0.012;
          var easedSlide = easeOut(slide);
          var lipKnock = clamp((slide - 0.70) / 0.30, 0, 1);
          var lipWobble = Math.sin(lipKnock * Math.PI * 2.2) * (1 - lipKnock) * 0.010;
          b.s = shot.sLand + (lipStop - shot.sLand) * easedSlide + lipWobble;
          b.u = shot.uLand * (1 - easedSlide * 0.34);
          b.z = Math.sin(lipKnock * Math.PI) * 0.014;
          if (!shot.lipBumped && slide > 0.70) {
            shot.lipBumped = true;
            sndBoard();
            camShake = Math.max(camShake, 2);
          }
          b.alpha = 1 - clamp((ml - 0.90) / 0.10, 0, 1);
        } else {
          b.s = shot.sLand - (shot.sLand + 0.08) * rb;   // roll from the board back past the near end
          b.u = shot.uLand * (1 - rb * 0.9);
          b.alpha = 1 - clamp((ml - 0.86) / 0.14, 0, 1);
          b.z = 0;
        }
        b.r = 1;
        b.cupDrop = 0;
        b.cupSettle = 0;
        b.cupCatch = null;
        b.spin -= dt * (18 + rb * 34);             // spinning backwards as it descends
        if (!shot.scored && (shot.hole === "miss" || shot.hole === "over") && shot.sLand >= S_FRONT) caughtLower = catchLowerRollbackScore();
        var scoreAt = shot.refund ? 0.06 : (shot.sLand >= S_FRONT ? 0.92 : 0.06);
        if (!caughtLower && !shot.scored && ml > scoreAt) scoreShot();
        if (ml >= 1) { state = "result"; resultT = 0; }
      }
    } else if (state === "result") {
      resultT += dt;
      if (resultT > (REDMO ? 0.35 : 0.62)) nextBall();
    }

    // fx tick
    for (var i = pops.length - 1; i >= 0; i--) { var p = pops[i]; p.t += dt; p.y -= dt * 42; if (p.t > 1.1) pops.splice(i, 1); }
    for (var j = sparks.length - 1; j >= 0; j--) { var s = sparks[j]; s.t += dt; s.x += s.vx * dt; s.y += s.vy * dt; s.vy += dt * 260; if (s.t > s.life) sparks.splice(j, 1); }
    for (var m = tix.length - 1; m >= 0; m--) { var tk = tix[m]; tk.t += dt; tk.x += tk.vx * dt; tk.y += tk.vy * dt; tk.vy += dt * 220; tk.rot += tk.vr * dt; if (tk.t > tk.life) tix.splice(m, 1); }
    for (var d = 0; d < motes.length; d++) { var mo = motes[d]; mo.y += mo.vy * dt; mo.x += mo.vx * dt; mo.ph += dt; if (mo.y < H * 0.05) { mo.y = H * 0.55; mo.x = Math.random() * W; } }
  }
  function stopRollFade() { if (rollGain) setRoll(0.05); }

  /* ------------------------------------------------------------ render */

  var woodTex = null, woodW = 0, woodH = 0;
  function buildWood() {
    woodTex = document.createElement("canvas"); woodTex.width = 256; woodTex.height = 512;
    var c = woodTex.getContext("2d");
    // warm varnished base
    var grd = c.createLinearGradient(0, 0, 256, 0);
    grd.addColorStop(0, "#b57d3b"); grd.addColorStop(0.5, "#d59c58"); grd.addColorStop(1, "#b07736");
    c.fillStyle = grd; c.fillRect(0, 0, 256, 512);
    // long straight-ish grain running the length of the plank, low contrast
    c.lineCap = "round";
    for (var i = 0; i < 46; i++) {
      var x0 = (i / 46) * 256 + (Math.random() - 0.5) * 5;
      var drift = (Math.random() - 0.5) * 10, amp = 1.5 + Math.random() * 4;
      var dark = Math.random() < 0.5;
      c.strokeStyle = dark ? "rgba(96,58,24," + (0.05 + Math.random() * 0.09) + ")" : "rgba(255,222,168," + (0.04 + Math.random() * 0.07) + ")";
      c.lineWidth = 0.7 + Math.random() * 1.4;
      c.beginPath(); c.moveTo(x0, -4);
      for (var y = 0; y <= 516; y += 40) c.lineTo(x0 + drift * (y / 512) + Math.sin(y * 0.012 + i) * amp, y);
      c.stroke();
    }
    // a few darker cathedral streaks for character
    for (var k = 0; k < 5; k++) {
      c.strokeStyle = "rgba(84,50,20,0.10)"; c.lineWidth = 2.2 + Math.random() * 2;
      var bx = 30 + Math.random() * 196;
      c.beginPath(); c.moveTo(bx, -4);
      for (var yy = 0; yy <= 516; yy += 30) c.lineTo(bx + Math.sin(yy * 0.02 + k * 2) * (8 + Math.random() * 6), yy);
      c.stroke();
    }
    // plank seams
    c.strokeStyle = "rgba(70,42,16,0.28)"; c.lineWidth = 1.4;
    [64, 128, 192].forEach(function (px) { c.beginPath(); c.moveTo(px, 0); c.lineTo(px, 512); c.stroke(); });
    woodW = 256; woodH = 512;
  }

  function render() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    var sx = 0, sy = 0;
    if (camShake > 0) { sx = (Math.random() - 0.5) * camShake; sy = (Math.random() - 0.5) * camShake; }
    ctx.save(); ctx.translate(sx, sy);
    ctx.clearRect(-20, -20, W + 40, H + 40);

    drawCabinet();
    drawBoard();
    drawLane();
    drawRamp();
    drawLaneHardware();
    drawRails();
    drawAim();
    drawBall();
    drawActiveCupOcclusion();
    drawTickets();
    drawPops();
    drawSparks();
    drawAmbientReflections();
    drawMachineVignette();

    ctx.restore();

    if (flashT > 0) { ctx.fillStyle = "rgba(" + flashCol + "," + (flashT * 0.28) + ")"; ctx.fillRect(0, 0, W, H); }
  }

  function drawCabinet() {
    // Arcade room + red cabinet body.
    var pal = P();
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#21143a"); g.addColorStop(0.55, "#251747"); g.addColorStop(1, "#19151e");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    drawRoomContext();
    var leftNear = proj(0, -1.06), leftRamp = proj(S_RAMP, -1.08), rightNear = proj(0, 1.06), rightRamp = proj(S_RAMP, 1.08);
    var sideGrad = ctx.createLinearGradient(0, leftRamp.y, 0, leftNear.y + 35);
    sideGrad.addColorStop(0, pal.cabinet[0]); sideGrad.addColorStop(0.52, pal.cabinet[1]); sideGrad.addColorStop(1, pal.cabinet[2]);
    ctx.fillStyle = sideGrad;
    ctx.beginPath(); ctx.moveTo(leftNear.x, leftNear.y); ctx.lineTo(leftRamp.x, leftRamp.y); ctx.lineTo(leftRamp.x - 34, leftRamp.y + 32); ctx.lineTo(leftNear.x - 50, leftNear.y + 30); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(rightNear.x, rightNear.y); ctx.lineTo(rightRamp.x, rightRamp.y); ctx.lineTo(rightRamp.x + 34, rightRamp.y + 32); ctx.lineTo(rightNear.x + 50, rightNear.y + 30); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = pal.accent; ctx.globalAlpha = 0.55; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(leftNear.x, leftNear.y); ctx.lineTo(leftRamp.x, leftRamp.y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(rightNear.x, rightNear.y); ctx.lineTo(rightRamp.x, rightRamp.y); ctx.stroke();
    ctx.globalAlpha = 1;
    drawCabinetLegs(leftNear, rightNear);
    // faint dust in the light
    for (var i = 0; i < motes.length; i++) {
      var m = motes[i];
      ctx.globalAlpha = m.a * 0.6 * (0.5 + 0.5 * Math.sin(m.ph));
      ctx.fillStyle = "#e6ddd2"; ctx.beginPath(); ctx.arc(m.x, m.y, m.r, 0, 6.28); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawRoomContext() {
    var pal = P();
    var floorY = H * 0.72;
    var wall = ctx.createLinearGradient(0, 0, 0, floorY);
    wall.addColorStop(0, "rgba(24,12,44,0.36)");
    wall.addColorStop(0.48, "rgba(45,24,82,0.30)");
    wall.addColorStop(1, "rgba(17,13,25,0.54)");
    ctx.fillStyle = wall;
    ctx.fillRect(0, 0, W, floorY);
    var bay = ctx.createRadialGradient(W * 0.50, H * 0.22, 0, W * 0.50, H * 0.32, Math.max(W, H) * 0.55);
    bay.addColorStop(0, "rgba(255,210,94,0.075)");
    bay.addColorStop(0.45, "rgba(109,68,160,0.08)");
    bay.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = bay;
    ctx.fillRect(0, 0, W, floorY);
    ctx.strokeStyle = "rgba(255,255,255,0.045)";
    ctx.lineWidth = 1;
    for (var y = H * 0.10; y < floorY; y += Math.max(32, H * 0.055)) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
    for (var x = W * 0.06; x < W; x += Math.max(52, W * 0.085)) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + W * 0.035, floorY); ctx.stroke();
    }
    var l = proj(0, -1.1), r = proj(0, 1.1), c = proj(S_RAMP, 0);
    if (!room) buildRoom();
    drawCeilingLightBars(floorY);
    drawArcadeWallFun(floorY, l, r);
    drawSideArcadeCabinets(floorY, l, r);
    var fg = ctx.createLinearGradient(0, floorY, 0, H);
    fg.addColorStop(0, "rgba(24,24,30,0.88)");
    fg.addColorStop(0.38, "rgba(43,42,48,0.76)");
    fg.addColorStop(1, "rgba(14,13,17,0.98)");
    ctx.fillStyle = fg;
    ctx.fillRect(0, floorY, W, H - floorY);
    var tileH = Math.max(24, H * 0.035);
    var tileW = Math.max(42, W * 0.070);
    for (var ty = floorY; ty < H + tileH; ty += tileH) {
      var row = Math.floor((ty - floorY) / tileH);
      var alpha = 0.05 + row * 0.010;
      ctx.fillStyle = row % 2 ? "rgba(255,255,255," + alpha + ")" : "rgba(0,0,0," + (0.10 + row * 0.012) + ")";
      for (var tx = -tileW; tx < W + tileW; tx += tileW) {
        if (((Math.floor(tx / tileW) + row) & 1) === 0) ctx.fillRect(tx + row * 6, ty, tileW, tileH);
      }
    }
    ctx.strokeStyle = "rgba(255,255,255,0.045)";
    for (var fy = floorY; fy < H; fy += tileH) {
      ctx.beginPath(); ctx.moveTo(0, fy); ctx.lineTo(W, fy); ctx.stroke();
    }
    var centerGlow = ctx.createRadialGradient(c.x, c.y + 80, 0, c.x, c.y + 110, Math.max(180, W * 0.36));
    centerGlow.addColorStop(0, "rgba(" + pal.glow + ",0.16)");
    centerGlow.addColorStop(0.46, "rgba(161,42,48,0.08)");
    centerGlow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = centerGlow; ctx.fillRect(0, floorY, W, H - floorY);
    drawFloorFun(floorY, l, r);
    ctx.fillStyle = "rgba(0,0,0,0.36)";
    ctx.beginPath();
    ctx.ellipse((l.x + r.x) / 2, Math.min(H - 12, l.y + 44), Math.max(90, (r.x - l.x) * 0.76), Math.max(22, H * 0.060), 0, 0, 6.28);
    ctx.fill();
    ctx.fillStyle = "rgba(0,0,0,0.22)";
    ctx.beginPath();
    ctx.ellipse(c.x, c.y + 28, Math.max(70, c.half * 1.15), Math.max(18, H * 0.035), 0, 0, 6.28);
    ctx.fill();
  }

  function drawArcadeWallFun(floorY, laneL, laneR) {
    if (!room) buildRoom();
    var tm = performance.now() * 0.001;
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    drawWallPostersAndDoodles(floorY, laneL, laneR);
    var leftX = Math.max(46, laneL.x - W * 0.30);
    var rightX = Math.min(W - 46, laneR.x + W * 0.30);
    var signs = [
      { x: leftX, y: H * 0.145, w: Math.max(78, W * 0.14), h: Math.max(26, H * 0.046), label: room.signs[0].label, col: room.signs[0].col, phase: room.signs[0].phase, style: room.signs[0].style },
      { x: rightX, y: H * 0.170, w: Math.max(72, W * 0.13), h: Math.max(25, H * 0.043), label: room.signs[1].label, col: room.signs[1].col, phase: room.signs[1].phase, style: room.signs[1].style }
    ];
    signs.forEach(function (s) {
      var glow = 0.55 + Math.sin(tm * 2.2 + s.phase) * 0.14 + Math.sin(tm * 7.0 + s.phase) * 0.04;
      ctx.fillStyle = "rgba(0,0,0,0.28)";
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(s.x - s.w / 2 - 6, s.y - s.h / 2 + 5, s.w + 12, s.h + 8, 4) : ctx.rect(s.x - s.w / 2 - 6, s.y - s.h / 2 + 5, s.w + 12, s.h + 8);
      ctx.fill();
      drawNeonTubeText(s.label, s.x, s.y, s.w, s.h, s.col, glow, s.style);
    });
    // A little string of prize bulbs across the back wall.
    var startX = Math.max(20, laneL.x - W * 0.18), endX = Math.min(W - 20, laneR.x + W * 0.18);
    var bulbY = H * 0.255;
    ctx.strokeStyle = "rgba(255,214,120,0.14)";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(startX, bulbY); ctx.quadraticCurveTo(W * 0.5, bulbY + H * 0.018, endX, bulbY); ctx.stroke();
    var count = room.bulbCount;
    for (var i = 0; i < count; i++) {
      var t = i / Math.max(1, count - 1);
      var x = startX + (endX - startX) * t;
      var y = bulbY + Math.sin(t * Math.PI) * H * 0.018;
      var on = 0.45 + Math.sin(tm * 3.5 + i * 0.9) * 0.25;
      ctx.fillStyle = i % 2 ? "rgba(255,78,150," + on + ")" : "rgba(255,214,84," + on + ")";
      ctx.beginPath(); ctx.arc(x, y, Math.max(1.4, H * 0.0032), 0, 6.28); ctx.fill();
    }
    ctx.restore();
  }

  function drawCeilingLightBars(floorY) {
    var tm = performance.now() * 0.001;
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    for (var i = 0; i < room.lightCount; i++) {
      var n = noise01(roomSeed + i * 8.81);
      var x = W * (0.18 + n * 0.64);
      var y = H * (0.045 + noise01(roomSeed + i * 5.23) * 0.12);
      var len = Math.max(40, W * (0.08 + noise01(roomSeed + i * 13.7) * 0.08));
      var tilt = (noise01(roomSeed + i * 4.2) - 0.5) * 0.7;
      var col = i % 2 ? room.leftHue : room.rightHue;
      var pulse = 0.42 + Math.sin(tm * 1.8 + i) * 0.08;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(tilt);
      ctx.shadowColor = "rgba(" + col + ",0.75)";
      ctx.shadowBlur = Math.max(12, H * 0.018);
      ctx.strokeStyle = "rgba(" + col + "," + pulse + ")";
      ctx.lineWidth = Math.max(3, H * 0.006);
      ctx.beginPath(); ctx.moveTo(-len / 2, 0); ctx.lineTo(len / 2, 0); ctx.stroke();
      ctx.strokeStyle = "rgba(255,255,255,0.55)";
      ctx.lineWidth = Math.max(1, H * 0.002);
      ctx.beginPath(); ctx.moveTo(-len / 2, 0); ctx.lineTo(len / 2, 0); ctx.stroke();
      ctx.restore();
    }
    ctx.globalCompositeOperation = "source-over";
    ctx.restore();
  }

  function drawWallPostersAndDoodles(floorY, laneL, laneR) {
    var tm = performance.now() * 0.001;
    ctx.save();
    var leftBand = { x0: 12, x1: Math.max(38, laneL.x - W * 0.10) };
    var rightBand = { x0: Math.min(W - 38, laneR.x + W * 0.10), x1: W - 12 };
    var bands = [leftBand, rightBand];
    for (var i = 0; i < room.posterCount; i++) {
      var band = bands[i % 2];
      var bw = Math.max(18, band.x1 - band.x0);
      var pw = Math.min(Math.max(28, W * (0.045 + noise01(roomSeed + i * 2.7) * 0.030)), bw * 0.72);
      var ph = pw * (1.10 + noise01(roomSeed + i * 3.1) * 0.45);
      var px = band.x0 + bw * (0.18 + noise01(roomSeed + i * 4.3) * 0.64);
      var py = H * (0.12 + noise01(roomSeed + i * 5.1) * 0.30);
      var hue = [room.leftHue, room.rightHue, room.accentHue][i % 3];
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate((noise01(roomSeed + i * 6.4) - 0.5) * 0.12);
      ctx.fillStyle = "rgba(0,0,0,0.28)";
      ctx.fillRect(-pw / 2 + 3, -ph / 2 + 4, pw, ph);
      ctx.fillStyle = "rgba(18,16,28,0.74)";
      ctx.fillRect(-pw / 2, -ph / 2, pw, ph);
      ctx.strokeStyle = "rgba(" + hue + ",0.42)";
      ctx.lineWidth = Math.max(1, pw * 0.035);
      ctx.strokeRect(-pw / 2, -ph / 2, pw, ph);
      ctx.fillStyle = "rgba(" + hue + ",0.18)";
      ctx.fillRect(-pw * 0.38, -ph * 0.30, pw * 0.76, ph * 0.38);
      ctx.strokeStyle = "rgba(255,246,210,0.32)";
      ctx.lineWidth = Math.max(1, pw * 0.025);
      ctx.beginPath();
      ctx.arc(-pw * 0.12, -ph * 0.11, pw * 0.12, 0, 6.28);
      ctx.moveTo(pw * 0.08, -ph * 0.20); ctx.lineTo(pw * 0.28, -ph * 0.02);
      ctx.moveTo(-pw * 0.30, ph * 0.22); ctx.lineTo(pw * 0.30, ph * 0.22);
      ctx.stroke();
      ctx.restore();
    }
    ctx.strokeStyle = "rgba(238,231,255,0.15)";
    ctx.lineWidth = Math.max(1, H * 0.002);
    for (var j = 0; j < room.doodleCount; j++) {
      var bnd = bands[j % 2];
      var x = bnd.x0 + (bnd.x1 - bnd.x0) * noise01(roomSeed + j * 6.9);
      var y = H * (0.09 + noise01(roomSeed + j * 3.8) * 0.45);
      var s = Math.max(7, H * (0.010 + noise01(roomSeed + j * 4.6) * 0.014));
      drawWallDoodle(x, y, s, j, tm);
    }
    drawPennants(floorY, laneL, laneR, tm);
    ctx.restore();
  }

  function drawWallDoodle(x, y, s, i, tm) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate((noise01(roomSeed + i * 2.2) - 0.5) * 0.7);
    ctx.globalAlpha = 0.42 + Math.sin(tm * 0.8 + i) * 0.04;
    ctx.strokeStyle = i % 3 === 0 ? "rgba(255,255,255,0.18)" : "rgba(189,168,255,0.16)";
    ctx.lineWidth = Math.max(1, s * 0.13);
    var type = i % 4;
    ctx.beginPath();
    if (type === 0) {
      ctx.roundRect ? ctx.roundRect(-s, -s * 0.55, s * 2, s * 1.1, s * 0.25) : ctx.rect(-s, -s * 0.55, s * 2, s * 1.1);
      ctx.moveTo(-s * 0.35, 0); ctx.lineTo(-s * 0.70, 0); ctx.moveTo(-s * 0.52, -s * 0.18); ctx.lineTo(-s * 0.52, s * 0.18);
      ctx.moveTo(s * 0.34, -s * 0.14); ctx.arc(s * 0.34, -s * 0.14, s * 0.08, 0, 6.28);
      ctx.moveTo(s * 0.62, s * 0.14); ctx.arc(s * 0.62, s * 0.14, s * 0.08, 0, 6.28);
    } else if (type === 1) {
      ctx.moveTo(-s, 0); ctx.lineTo(-s * 0.25, 0); ctx.arc(0, 0, s * 0.28, Math.PI, 0); ctx.lineTo(s, 0);
      ctx.moveTo(-s * 0.50, -s * 0.42); ctx.lineTo(-s * 0.15, -s * 0.15); ctx.moveTo(s * 0.30, -s * 0.40); ctx.lineTo(s * 0.05, -s * 0.12);
    } else if (type === 2) {
      ctx.moveTo(0, -s); ctx.lineTo(s * 0.18, -s * 0.18); ctx.lineTo(s, 0); ctx.lineTo(s * 0.18, s * 0.18); ctx.lineTo(0, s); ctx.lineTo(-s * 0.18, s * 0.18); ctx.lineTo(-s, 0); ctx.lineTo(-s * 0.18, -s * 0.18); ctx.closePath();
    } else {
      ctx.arc(0, 0, s * 0.72, 0, 6.28);
      ctx.moveTo(-s * 0.36, -s * 0.12); ctx.lineTo(s * 0.36, -s * 0.12);
      ctx.moveTo(-s * 0.20, s * 0.24); ctx.lineTo(s * 0.20, s * 0.24);
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawPennants(floorY, laneL, laneR, tm) {
    var startX = Math.max(18, laneL.x - W * 0.28), endX = Math.min(W - 18, laneR.x + W * 0.28);
    var y = H * 0.075 + noise01(roomSeed + 42) * H * 0.045;
    ctx.strokeStyle = "rgba(255,238,190,0.20)";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(startX, y); ctx.quadraticCurveTo(W * 0.5, y + H * 0.040, endX, y); ctx.stroke();
    var cols = [room.leftHue, room.rightHue, room.accentHue, "255,214,84"];
    for (var i = 0; i < room.pennantCount; i++) {
      var t = i / Math.max(1, room.pennantCount - 1);
      var x = startX + (endX - startX) * t;
      var py = y + Math.sin(t * Math.PI) * H * 0.040;
      var size = Math.max(7, H * 0.014);
      ctx.fillStyle = "rgba(" + cols[i % cols.length] + ",0.62)";
      ctx.beginPath();
      ctx.moveTo(x - size * 0.52, py + 1);
      ctx.lineTo(x + size * 0.52, py + 1);
      ctx.lineTo(x + Math.sin(tm * 1.6 + i) * 1.2, py + size * (0.95 + noise01(roomSeed + i) * 0.45));
      ctx.closePath();
      ctx.fill();
    }
  }

  function drawNeonTubeText(label, x, y, w, h, col, glow, style) {
    ctx.save();
    ctx.font = (style === "script" ? "800 " : "900 ") + Math.max(12, h * 0.55) + "px 'Geist Mono', monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    var tubeW = Math.max(2, h * 0.12);
    ctx.shadowColor = "rgba(" + col + "," + (0.72 * glow) + ")";
    ctx.shadowBlur = Math.max(8, h * 0.45);
    ctx.strokeStyle = "rgba(" + col + "," + (0.70 + glow * 0.24) + ")";
    ctx.lineWidth = tubeW * 2.6;
    ctx.strokeText(label, x, y + 1);
    ctx.shadowBlur = Math.max(4, h * 0.22);
    ctx.strokeStyle = "rgba(255,250,226," + (0.62 + glow * 0.28) + ")";
    ctx.lineWidth = tubeW;
    ctx.strokeText(label, x, y + 1);
    // Little transformer leads sell it as a sign, not a label.
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "rgba(190,160,120,0.28)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x - w * 0.38, y - h * 0.48); ctx.lineTo(x - w * 0.38, y - h * 0.72);
    ctx.moveTo(x + w * 0.38, y - h * 0.48); ctx.lineTo(x + w * 0.38, y - h * 0.72);
    ctx.stroke();
    ctx.restore();
  }

  function drawFloorFun(floorY, laneL, laneR) {
    var tm = performance.now() * 0.001;
    var pal = P();
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    // Neon reflections from side cabinets, stretched across the polished floor.
    [
      { x: Math.max(0, laneL.x - W * 0.25), col: room ? room.leftHue : "60,205,255", drift: -1 },
      { x: Math.min(W, laneR.x + W * 0.25), col: room ? room.rightHue : "255,72,150", drift: 1 }
    ].forEach(function (rfl) {
      var g = ctx.createRadialGradient(rfl.x, floorY + H * 0.12, 0, rfl.x + rfl.drift * W * 0.03, floorY + H * 0.16, Math.max(70, W * 0.18));
      g.addColorStop(0, "rgba(" + rfl.col + ",0.095)");
      g.addColorStop(1, "rgba(" + rfl.col + ",0)");
      ctx.fillStyle = g; ctx.fillRect(0, floorY, W, H - floorY);
    });
    ctx.globalCompositeOperation = "source-over";
    // A few stray tickets near the front corners.
    var ticketCount = room ? room.ticketCount : 7;
    for (var i = 0; i < ticketCount; i++) {
      var side = i % 2 ? 1 : -1;
      var x = W * (side < 0 ? 0.10 : 0.90) + (noise01(i * 9.1) - 0.5) * W * 0.11;
      var y = floorY + H * (0.12 + noise01(i * 4.7) * 0.18);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate((noise01(i * 6.3) - 0.5) * 0.9 + Math.sin(tm + i) * 0.03);
      ctx.fillStyle = pal.deck[1];
      ctx.globalAlpha = 0.22;
      ctx.fillRect(-8, -3, 16, 6);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = "rgba(80,40,20,0.18)";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(-4, -3); ctx.lineTo(-4, 3); ctx.moveTo(4, -3); ctx.lineTo(4, 3); ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }

  function drawSideArcadeCabinets(floorY, laneL, laneR) {
    if (!room) buildRoom();
    var tm = performance.now() * 0.001;
    [
      { side: -1, x: Math.max(0, laneL.x - W * 0.26), hue: room.leftHue },
      { side: 1, x: Math.min(W, laneR.x + W * 0.26), hue: room.rightHue }
    ].forEach(function (m) {
      var w = Math.max(42, W * 0.105);
      var h = Math.max(140, H * 0.36);
      var y = floorY - h * 0.90;
      ctx.save();
      ctx.globalAlpha = 0.58;
      var sg = ctx.createLinearGradient(0, y, 0, floorY + h * 0.14);
      sg.addColorStop(0, "rgba(17,14,22,0.94)");
      sg.addColorStop(0.58, "rgba(42,31,44,0.78)");
      sg.addColorStop(1, "rgba(8,7,10,0.96)");
      ctx.fillStyle = sg;
      ctx.beginPath();
      ctx.moveTo(m.x - w * 0.48, y + h * 0.12);
      ctx.lineTo(m.x + w * 0.42, y);
      ctx.lineTo(m.x + w * 0.55, floorY + h * 0.12);
      ctx.lineTo(m.x - w * 0.55, floorY + h * 0.18);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "rgba(" + m.hue + "," + (0.18 + Math.sin(tm * 1.7 + m.side) * 0.04) + ")";
      ctx.beginPath();
      ctx.moveTo(m.x - w * 0.30, y + h * 0.20);
      ctx.lineTo(m.x + w * 0.28, y + h * 0.14);
      ctx.lineTo(m.x + w * 0.36, y + h * 0.48);
      ctx.lineTo(m.x - w * 0.36, y + h * 0.52);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "rgba(255,214,82,0.38)";
      ctx.fillRect(m.x - w * 0.32, y + h * 0.08, w * 0.62, Math.max(3, h * 0.018));
      ctx.restore();
    });
  }

  function drawCabinetLegs(leftNear, rightNear) {
    ctx.save();
    ctx.fillStyle = "#0b0b0c";
    [
      { x: leftNear.x - 18, y: leftNear.y + 12 },
      { x: rightNear.x + 18, y: rightNear.y + 12 }
    ].forEach(function (p) {
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(p.x - 15, p.y, 30, 58, 5) : ctx.rect(p.x - 15, p.y, 30, 58);
      ctx.fill();
    });
    ctx.restore();
  }

  function quad(s0, s1, uL, uR) {
    var a = proj(s0, uL), bb = proj(s0, uR), c = proj(s1, uR), d = proj(s1, uL);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(bb.x, bb.y); ctx.lineTo(c.x, c.y); ctx.lineTo(d.x, d.y); ctx.closePath();
  }

  function drawBoard() {
    var g = G();
    var pal = P();
    // the tilted backboard panel (a cream dish), from the crease up to the top
    ctx.save();
    quad(S_RAMP, 1.04, -1.06, 1.06); ctx.clip();
    var bTop = proj(1.0, 0).y, bBot = proj(S_RAMP + 0.001, 0).y;
    var bg = ctx.createLinearGradient(0, bTop, 0, bBot);
    bg.addColorStop(0, pal.target[0]); bg.addColorStop(0.48, pal.target[1]); bg.addColorStop(1, pal.target[2]);
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    var sp = ctx.createRadialGradient(g.cx, (bTop + bBot) / 2, 0, g.cx, (bTop + bBot) / 2, (bBot - bTop) * 0.95);
    sp.addColorStop(0, "rgba(255,210,174,0.24)"); sp.addColorStop(1, "rgba(255,210,174,0)");
    ctx.fillStyle = sp; ctx.fillRect(0, 0, W, H);
    drawSurfaceWear(S_RAMP + 0.015, 0.99, 0.96, "rgba(255,220,188,0.055)", "rgba(82,19,18,0.12)");
    // Worn ball lanes, like the scuffed paths in the reference target.
    ctx.strokeStyle = "rgba(80,23,20,0.18)";
    ctx.lineWidth = Math.max(10, W * 0.012);
    [-0.34, 0.34].forEach(function (u) {
      var a = proj(0.55, u), z = proj(0.86, u * 0.34);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo(g.cx + u * 30, (a.y + z.y) * 0.5, z.x, z.y); ctx.stroke();
    });
    var eg = ctx.createLinearGradient(proj(0.7, -1).x, 0, proj(0.7, 1).x, 0);
    eg.addColorStop(0, "rgba(68,12,16,0.42)"); eg.addColorStop(0.5, "rgba(68,12,16,0)"); eg.addColorStop(1, "rgba(68,12,16,0.42)");
    ctx.fillStyle = eg; ctx.fillRect(0, 0, W, H);
    ctx.restore();
    drawBoardSideDepth();
    // top edge of the backboard
    quad(1.0, 1.04, -1.06, 1.06); ctx.fillStyle = "#1b1c20"; ctx.fill();
    drawScoreboard();
    drawSideShields();
    drawBackNet();
    drawCornerPins();
    // the raised lower rail and pockets sit on the board under the cups
    for (var r = 0; r < RINGS.length; r++) drawRing(RINGS[r]);
    drawTenPocket();
    for (var p = 0; p < POCKETS.length; p++) drawPocket(POCKETS[p]);
    // then the raised cups, back-to-front
    var order = CUPS.slice().sort(function (a, c) { return c.s - a.s; });
    for (var i = 0; i < order.length; i++) drawCup(order[i]);
    // crease shadow at the fold, where the flat runway meets the tilted board
    var cl = proj(S_RAMP, -1.0), cr = proj(S_RAMP, 1.0), cm = proj(S_RAMP, 0);
    ctx.beginPath(); ctx.moveTo(cl.x, cl.y); ctx.quadraticCurveTo(cm.x, cm.y + (cl.y - cm.y) * 0.1, cr.x, cr.y);
    ctx.lineWidth = 7; ctx.strokeStyle = "rgba(20,16,12,0.48)"; ctx.stroke();
  }

  function drawBoardSideDepth() {
    ctx.save();
    [-1, 1].forEach(function (side) {
      var a = proj(S_RAMP + 0.004, side * 1.045);
      var b = proj(1.0, side * 1.045);
      var c = proj(1.0, side * 0.925);
      var d = proj(S_RAMP + 0.004, side * 0.925);
      var gg = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
      gg.addColorStop(0, "rgba(34,7,10,0.42)");
      gg.addColorStop(0.58, "rgba(80,18,18,0.20)");
      gg.addColorStop(1, "rgba(0,0,0,0.16)");
      ctx.fillStyle = gg;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.lineTo(d.x, d.y); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = side < 0 ? "rgba(255,210,170,0.10)" : "rgba(0,0,0,0.20)";
      ctx.lineWidth = Math.max(1, 2 * a.sc);
      ctx.beginPath(); ctx.moveTo(d.x, d.y); ctx.lineTo(c.x, c.y); ctx.stroke();
    });
    ctx.restore();
  }

  function drawSurfaceWear(s0, s1, width, hi, lo) {
    ctx.save();
    quad(s0, s1, -width, width);
    ctx.clip();
    for (var i = 0; i < 18; i++) {
      var n1 = noise01(i * 17.13 + s0 * 9.7);
      var n2 = noise01(i * 31.77 + s1 * 5.3);
      var n3 = noise01(i * 11.91 + width * 4.4);
      var u = -width + n1 * width * 2;
      var a = proj(s0 + n2 * 0.12, u);
      var b = proj(s1 - n3 * 0.12, u * (0.45 + noise01(i * 7.21) * 0.35));
      ctx.strokeStyle = i % 3 === 0 ? lo : hi;
      ctx.lineWidth = 0.7 + noise01(i * 3.41) * 1.8;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.quadraticCurveTo((a.x + b.x) / 2 + (noise01(i * 13.9) - 0.5) * 18, (a.y + b.y) / 2, b.x, b.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  function noise01(n) {
    var x = Math.sin(n * 12.9898) * 43758.5453;
    return x - Math.floor(x);
  }

  function buildRoom() {
    var words = ["PLAY", "WIN", "BONUS", "ROLL", "JACKPOT", "FUN"];
    var colors = ["60,205,255", "255,72,150", "255,214,84", "119,255,177", "178,116,255"];
    var picks = [];
    for (var i = 0; i < 2; i++) {
      picks.push({
        label: words[Math.floor(noise01(roomSeed + i * 11.3) * words.length)],
        col: colors[Math.floor(noise01(roomSeed + i * 17.7 + 3) * colors.length)],
        phase: noise01(roomSeed + i * 29.1) * 6.28,
        style: noise01(roomSeed + i * 7.4) > 0.46 ? "script" : "block"
      });
    }
    if (picks[0].label === picks[1].label) picks[1].label = "ARCADE";
    room = {
      signs: picks,
      bulbCount: 9 + Math.floor(noise01(roomSeed + 5) * 6),
      ticketCount: 5 + Math.floor(noise01(roomSeed + 9) * 7),
      posterCount: 3 + Math.floor(noise01(roomSeed + 13) * 5),
      doodleCount: 8 + Math.floor(noise01(roomSeed + 15) * 9),
      pennantCount: 10 + Math.floor(noise01(roomSeed + 21) * 8),
      lightCount: 2 + Math.floor(noise01(roomSeed + 31) * 3),
      leftHue: colors[Math.floor(noise01(roomSeed + 19) * colors.length)],
      rightHue: colors[Math.floor(noise01(roomSeed + 23) * colors.length)],
      accentHue: colors[Math.floor(noise01(roomSeed + 37) * colors.length)]
    };
  }

  function P() {
    if (!gamePalette) buildGamePalette();
    return gamePalette;
  }

  function buildGamePalette() {
    var palettes = [
      {
        cabinet: ["#9b3030", "#7d2326", "#52191d"],
        lane: ["#8b2427", "#cf5148", "#a73432"],
        center: ["#9d2b2d", "#d65a51", "#b13a37"],
        target: ["#b93432", "#d75b4c", "#b83d38"],
        ramp: ["#b41f2c", "#8a1521", "#3c0b13"],
        deck: ["#d3a833", "#f1dc65", "#c89228"],
        marquee: ["#24121a", "#5d2928", "#b77e2c"],
        accent: "#e3c44e",
        title: "#f4ce58",
        neon: "255,36,139",
        glow: "255,196,88"
      },
      {
        cabinet: ["#1c6a73", "#14505a", "#0c2d36"],
        lane: ["#12636f", "#23a6a9", "#15717c"],
        center: ["#2b6c73", "#31bbb7", "#1b7d86"],
        target: ["#216f80", "#32a7b5", "#1b6475"],
        ramp: ["#1d7d86", "#135c68", "#092c34"],
        deck: ["#bb3f86", "#ff79b8", "#9f2f72"],
        marquee: ["#111a2b", "#263d68", "#8e2f8a"],
        accent: "#64e8ff",
        title: "#ff8cc7",
        neon: "100,232,255",
        glow: "255,92,174"
      },
      {
        cabinet: ["#283c86", "#1c2c66", "#10183b"],
        lane: ["#293d8f", "#526de0", "#2d448f"],
        center: ["#75345f", "#b85b8c", "#7e3b70"],
        target: ["#334e9d", "#6178d4", "#30458a"],
        ramp: ["#253c92", "#1a2b65", "#0d1737"],
        deck: ["#d76c43", "#ffaf69", "#b84f32"],
        marquee: ["#15152b", "#303060", "#9c4b45"],
        accent: "#ffb06b",
        title: "#ffe08d",
        neon: "255,118,91",
        glow: "99,132,255"
      },
      {
        cabinet: ["#60378a", "#482665", "#241735"],
        lane: ["#5a2d75", "#8c55b0", "#633681"],
        center: ["#35724f", "#4fbf75", "#367f59"],
        target: ["#68409a", "#9268c4", "#5b3489"],
        ramp: ["#5a3186", "#3c235d", "#1d1231"],
        deck: ["#a8c83b", "#d9f06a", "#799d2d"],
        marquee: ["#20142f", "#4e2e6d", "#6d8332"],
        accent: "#d8ff6e",
        title: "#e6ffd0",
        neon: "189,255,93",
        glow: "182,112,255"
      }
    ];
    gamePalette = palettes[Math.floor(noise01(roomSeed + 101) * palettes.length)];
  }

  // a large flat oval ring lying on the board (the 10 and 20 rails that encircle the cups)
  function drawRing(ring) {
    var p = proj(ring.s, 0);
    var rx = ring.rxFrac * p.half;
    var ry = (proj(ring.s - ring.sHalf, 0).y - proj(ring.s + ring.sHalf, 0).y) / 2;
    var lw = Math.max(8, rx * 0.125);
    var hgt = Math.max(5, lw * 0.55);
    ctx.save();
    // soft recessed shadow around the raised rail
    ctx.beginPath(); ctx.ellipse(p.x, p.y, rx + lw * 0.4, ry + lw * 0.4, 0, 0, 6.28);
    ctx.lineWidth = lw * 1.5; ctx.strokeStyle = "rgba(50,28,24,0.24)"; ctx.stroke();
    // front wall of the raised 10 rail
    ctx.beginPath();
    ctx.ellipse(p.x, p.y - hgt, rx, ry, 0, Math.PI, Math.PI * 2, false);
    ctx.ellipse(p.x, p.y, rx, ry, 0, Math.PI * 2, Math.PI, true);
    ctx.closePath();
    var wall = ctx.createLinearGradient(0, p.y - hgt - ry, 0, p.y + ry);
    wall.addColorStop(0, "#fbf6e8"); wall.addColorStop(0.5, "#ded7c9"); wall.addColorStop(1, "#9f9689");
    ctx.fillStyle = wall; ctx.fill();
    // top white rail
    ctx.beginPath(); ctx.ellipse(p.x, p.y - hgt, rx, ry, 0, 0, 6.28);
    var rg = ctx.createLinearGradient(0, p.y - ry, 0, p.y + ry);
    rg.addColorStop(0, "#fffaf0"); rg.addColorStop(0.5, "#ddd5c6"); rg.addColorStop(1, "#a89d8e");
    ctx.lineWidth = lw; ctx.strokeStyle = rg; ctx.stroke();
    // top highlight on the rail
    ctx.lineWidth = Math.max(1, lw * 0.26); ctx.strokeStyle = "rgba(255,255,255,0.58)";
    ctx.beginPath(); ctx.ellipse(p.x, p.y - hgt - ry * 0.04, rx, ry, 0, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke();
    // number on the near (front) side of the rail, on the red felt
    var fs = Math.max(18, 36 * p.sc);
    ctx.font = "900 " + fs + "px 'Geist', sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillStyle = "#151518"; ctx.fillText(ring.pts, p.x, p.y + ry * 0.70);
    drawFastenersOnEllipse(p.x, p.y, rx, ry, 5, p.sc);
    ctx.restore();
  }

  function drawFastenersOnEllipse(cx, cy, rx, ry, count, sc) {
    ctx.save();
    ctx.fillStyle = "rgba(40,30,25,0.45)";
    for (var i = 0; i < count; i++) {
      var a = Math.PI * (0.16 + i * 0.68 / Math.max(1, count - 1));
      var x = cx + Math.cos(a) * rx * 0.92;
      var y = cy + Math.sin(a) * ry * 0.92;
      ctx.beginPath(); ctx.arc(x, y, Math.max(1.2, 2.5 * sc), 0, 6.28); ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.22)"; ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.moveTo(x - 2 * sc, y); ctx.lineTo(x + 2 * sc, y); ctx.stroke();
    }
    ctx.restore();
  }

  function drawPocket(pocket) {
    var p = proj(pocket.s, pocket.u);
    var rx = pocket.rx * p.half, ry = (proj(pocket.s - pocket.sy, 0).y - proj(pocket.s + pocket.sy, 0).y) / 2;
    ctx.save();
    ctx.beginPath(); ctx.ellipse(p.x, p.y, rx, ry, 0, 0, 6.28);
    var g = ctx.createRadialGradient(p.x, p.y - ry * 0.4, 2, p.x, p.y, rx);
    g.addColorStop(0, "rgba(83,37,34,0.12)");
    g.addColorStop(1, "rgba(56,26,26,0.34)");
    ctx.fillStyle = g; ctx.fill();
    ctx.lineWidth = Math.max(2, rx * 0.05);
    ctx.strokeStyle = "rgba(255,238,225,0.32)";
    ctx.stroke();
    var fs = Math.max(16, 32 * p.sc);
    ctx.font = "900 " + fs + "px 'Geist', sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillStyle = "#161519"; ctx.fillText(pocket.pts, p.x, p.y + ry * 0.34);
    drawDarkLip(p.x, p.y, rx, ry, p.sc);
    ctx.restore();
  }

  function drawTenPocket() {
    var p = proj(TEN_POCKET.s, TEN_POCKET.u);
    var rx = TEN_POCKET.rx * p.half;
    var ry = (proj(TEN_POCKET.s - TEN_POCKET.sy, 0).y - proj(TEN_POCKET.s + TEN_POCKET.sy, 0).y) / 2;
    ctx.save();
    ctx.beginPath(); ctx.ellipse(p.x, p.y, rx, ry, 0, 0, 6.28);
    var g = ctx.createRadialGradient(p.x, p.y - ry * 0.25, 1, p.x, p.y, rx);
    g.addColorStop(0, "#303030"); g.addColorStop(0.42, "#111"); g.addColorStop(1, "#020202");
    ctx.fillStyle = g; ctx.fill();
    ctx.lineWidth = Math.max(2, rx * 0.12);
    ctx.strokeStyle = "rgba(255,255,255,0.62)";
    ctx.stroke();
    drawDarkLip(p.x, p.y, rx, ry, p.sc);
    ctx.restore();
  }

  function drawDarkLip(x, y, rx, ry, sc) {
    ctx.save();
    ctx.strokeStyle = "rgba(0,0,0,0.38)";
    ctx.lineWidth = Math.max(1, 3 * sc);
    ctx.beginPath(); ctx.ellipse(x, y + ry * 0.06, rx * 0.94, ry * 0.86, 0, 0, 6.28); ctx.stroke();
    ctx.restore();
  }

  function drawBackNet() {
    var top = proj(0.955, 0), bot = proj(0.905, 0);
    ctx.save();
    ctx.lineWidth = Math.max(1, 1.6 * top.sc);
    for (var i = 0; i < 4; i++) {
      var y = top.y + i * (bot.y - top.y) / 4;
      ctx.beginPath(); ctx.moveTo(proj(0.96, -1.02).x, y); ctx.lineTo(proj(0.96, 1.02).x, y);
      ctx.strokeStyle = i % 2 ? "rgba(242,198,107,0.28)" : "rgba(22,14,16,0.42)";
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawScoreboard() {
    var g = G();
    var pal = P();
    var pTop = proj(1.0, 0), pLow = proj(0.900, 0);
    var wTop = pTop.half * 3.15;
    var wLow = pLow.half * 2.78;
    var y0 = Math.max(10, pTop.y - 48);
    var y1 = pLow.y + 6;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(g.cx - wTop / 2, y0);
    ctx.lineTo(g.cx + wTop / 2, y0);
    ctx.lineTo(g.cx + wLow / 2, y1);
    ctx.lineTo(g.cx - wLow / 2, y1);
    ctx.closePath();
    var h = ctx.createLinearGradient(0, y0, 0, y1);
    h.addColorStop(0, pal.marquee[0]); h.addColorStop(0.48, pal.marquee[1]); h.addColorStop(1, pal.marquee[2]);
    ctx.fillStyle = h; ctx.fill();
    ctx.strokeStyle = pal.accent; ctx.lineWidth = Math.max(2, 4 * pTop.sc); ctx.stroke();
    ctx.strokeStyle = "rgba(255,230,120,0.32)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(g.cx - wTop * 0.43, y0 + 5); ctx.lineTo(g.cx + wTop * 0.43, y0 + 5); ctx.stroke();
    var signY = y0 + (y1 - y0) * 0.58;
    ctx.fillStyle = pal.title;
    ctx.font = "900 " + Math.max(14, 28 * pTop.sc) + "px 'Geist', sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("SKEE-BALL", g.cx, signY);
    var screenW = Math.max(30, wTop * 0.17), screenH = Math.max(10, 14 * pTop.sc);
    ctx.fillStyle = "#17070f";
    ctx.fillRect(g.cx - screenW / 2, y0 + 10, screenW, screenH);
    var pulse = 0.72 + Math.sin(performance.now() * 0.010) * 0.12 + Math.sin(performance.now() * 0.023) * 0.04;
    ctx.fillStyle = "rgba(" + pal.neon + "," + pulse + ")";
    ctx.font = "900 " + Math.max(6, 8 * pTop.sc) + "px 'Geist Mono', monospace";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("READY", g.cx, y0 + 10 + screenH / 2);
    ctx.fillStyle = pal.accent;
    ctx.globalAlpha = 0.72;
    for (var bi = 0; bi < 6; bi++) {
      var bx = g.cx - wTop * 0.40 + (wTop * 0.80) * (bi / 5);
      ctx.beginPath(); ctx.arc(bx, y0 + 5, Math.max(0.8, 1.4 * pTop.sc), 0, 6.28); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function drawSideShields() {
    [-1, 1].forEach(function (side) {
      var lowIn = proj(0.51, side * 0.94);
      var lowOut = proj(0.46, side * 1.24);
      var highIn = proj(0.98, side * 0.98);
      var highOut = proj(1.03, side * 1.32);
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(lowIn.x, lowIn.y);
      ctx.quadraticCurveTo(proj(0.72, side * 1.05).x, proj(0.72, side * 1.05).y, highIn.x, highIn.y);
      ctx.lineTo(highOut.x, highOut.y);
      ctx.quadraticCurveTo(proj(0.72, side * 1.34).x, proj(0.72, side * 1.34).y, lowOut.x, lowOut.y);
      ctx.closePath();
      ctx.fillStyle = "rgba(255,242,214,0.08)";
      ctx.fill();
      ctx.clip();
      var ribs = 8;
      var shimmer = Math.sin(performance.now() * 0.0017 + side * 1.8) * 1.2;
      ctx.lineWidth = Math.max(0.8, 1.6 * proj(0.72, 0).sc);
      ctx.strokeStyle = "rgba(255,238,210,0.38)";
      for (var i = 0; i <= ribs; i++) {
        var t = i / ribs;
        var a = lerpPt(lowOut, lowIn, t), b = lerpPt(highOut, highIn, t);
        ctx.beginPath(); ctx.moveTo(a.x + shimmer * (0.2 + t), a.y); ctx.lineTo(b.x + shimmer * (1 - t), b.y); ctx.stroke();
      }
      for (var j = 0; j <= ribs; j++) {
        var q = j / ribs;
        var c = lerpPt(lowOut, highOut, q), d = lerpPt(lowIn, highIn, q);
        ctx.beginPath(); ctx.moveTo(c.x + shimmer * 0.35, c.y); ctx.lineTo(d.x + shimmer * 0.65, d.y); ctx.stroke();
      }
      ctx.restore();
      ctx.save();
      ctx.lineCap = "round";
      ctx.lineWidth = Math.max(4, 7.5 * proj(0.70, 0).sc);
      ctx.strokeStyle = "rgba(12,12,14,0.92)";
      ctx.beginPath(); ctx.moveTo(lowIn.x, lowIn.y); ctx.lineTo(highIn.x, highIn.y); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(lowOut.x, lowOut.y); ctx.lineTo(highOut.x, highOut.y); ctx.stroke();
      ctx.lineWidth = Math.max(2, 4 * proj(0.70, 0).sc);
      ctx.strokeStyle = "rgba(45,45,48,0.86)";
      ctx.beginPath(); ctx.moveTo(highIn.x, highIn.y); ctx.lineTo(highOut.x, highOut.y); ctx.stroke();
      ctx.restore();
    });
  }

  function lerpPt(a, b, t) {
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  }

  function drawCornerPins() {
    [-0.95, 0.95].forEach(function (u) {
      var p = proj(0.78, u);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(u * 0.18);
      ctx.fillStyle = "rgba(246,238,218,0.58)";
      ctx.beginPath(); ctx.ellipse(0, 0, Math.max(2.5, 5 * p.sc), Math.max(3, 7 * p.sc), 0, 0, 6.28); ctx.fill();
      ctx.fillStyle = "rgba(28,18,18,0.55)";
      ctx.beginPath(); ctx.arc(0, -1.5 * p.sc, Math.max(0.8, 1.4 * p.sc), 0, 6.28); ctx.fill();
      ctx.restore();
    });
  }

  // a raised white ring-cup standing proud of the board (short cylinder + dark hole)
  function drawCup(cup) {
    var p = proj(cup.s, cup.u);
    var rx = cup.R * p.half, ry = rx * (p.board ? 0.60 : 0.44);   // rounder on the face-on board
    var hgt = Math.max(5, rx * 0.30);      // how tall the tube stands, in px
    var topY = p.y - hgt;                  // raised top-rim center
    ctx.save();
    // socket and contact shadow: these make the cup read as mounted into the board.
    ctx.beginPath(); ctx.ellipse(p.x, p.y + ry * 0.22, rx * 1.06, ry * 0.86, 0, 0, 6.28);
    ctx.fillStyle = "rgba(55,22,18,0.38)"; ctx.fill();
    ctx.beginPath(); ctx.ellipse(p.x + rx * 0.26, p.y + ry * 0.60, rx * 1.08, ry * 0.48, 0, 0, 6.28);
    ctx.fillStyle = "rgba(30,12,10,0.34)"; ctx.fill();
    ctx.beginPath(); ctx.ellipse(p.x, p.y + ry * 0.16, rx * 0.98, ry * 0.60, 0, 0, 6.28);
    ctx.fillStyle = "rgba(244,232,212,0.34)"; ctx.fill();
    ctx.beginPath(); ctx.ellipse(p.x, p.y + ry * 0.22, rx * 0.90, ry * 0.48, 0, 0, 6.28);
    ctx.fillStyle = "rgba(84,35,27,0.22)"; ctx.fill();
    // cylinder front wall: lower rim arc down into a base ellipse on the board
    ctx.beginPath();
    ctx.ellipse(p.x, topY, rx, ry, 0, 0, Math.PI, false);
    ctx.ellipse(p.x, p.y + ry * 0.08, rx * 0.94, ry * 0.54, 0, Math.PI, 0, true);
    ctx.closePath();
    var wg = ctx.createLinearGradient(0, topY, 0, p.y + ry);
    wg.addColorStop(0, "#f8f3e7"); wg.addColorStop(0.5, "#dad2c4"); wg.addColorStop(1, "#9e9688");
    ctx.fillStyle = wg; ctx.fill();
    // curved side-shading on the wall so it reads as round
    var sg = ctx.createLinearGradient(p.x - rx, 0, p.x + rx, 0);
    sg.addColorStop(0, "rgba(60,54,44,0.34)"); sg.addColorStop(0.5, "rgba(255,255,255,0.12)"); sg.addColorStop(1, "rgba(60,54,44,0.34)");
    ctx.fillStyle = sg; ctx.fill();
    ctx.strokeStyle = "rgba(82,58,45,0.34)";
    ctx.lineWidth = Math.max(1, 2.4 * p.sc);
    ctx.beginPath(); ctx.ellipse(p.x, p.y + ry * 0.08, rx * 0.94, ry * 0.54, 0, 0, Math.PI); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(p.x - rx * 0.98, topY + ry * 0.10); ctx.lineTo(p.x - rx * 0.94, p.y + ry * 0.08); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(p.x + rx * 0.98, topY + ry * 0.10); ctx.lineTo(p.x + rx * 0.94, p.y + ry * 0.08); ctx.stroke();
    // green-felt interior in the top (the classic Skee-Ball cup floor)
    var hg = ctx.createRadialGradient(p.x, topY - ry * 0.2, ry * 0.1, p.x, topY + ry * 0.12, rx * 0.85);
    hg.addColorStop(0, "#3a7a58"); hg.addColorStop(0.68, "#1f5038"); hg.addColorStop(1, "#123020");
    ctx.beginPath(); ctx.ellipse(p.x, topY, rx * 0.7, ry * 0.7, 0, 0, 6.28); ctx.fillStyle = hg; ctx.fill();
    // white top rim (torus)
    ctx.lineWidth = Math.max(3, rx * 0.24); ctx.strokeStyle = "#eee8dc";
    ctx.beginPath(); ctx.ellipse(p.x, topY, rx * 0.84, ry * 0.84, 0, 0, 6.28); ctx.stroke();
    // rim highlight on the lit top-back edge
    ctx.lineWidth = Math.max(1, rx * 0.07); ctx.strokeStyle = "rgba(255,255,255,0.66)";
    ctx.beginPath(); ctx.ellipse(p.x, topY - ry * 0.06, rx * 0.84, ry * 0.84, 0, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke();
    // black number on the white front wall, matching the reference photo.
    var fs = Math.max(14, (cup.pts === 100 ? 26 : 30) * p.sc);
    ctx.font = "900 " + fs + "px 'Geist', sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillStyle = "#151518";
    ctx.fillText(cup.pts, p.x, p.y + ry * 0.52);
    drawFastenersOnCup(p.x, p.y, rx, ry, p.sc, cup.pts >= 50 ? 4 : 3);
    // rivet holes in the high-value cups
    if (cup.pts >= 50) {
      ctx.fillStyle = "rgba(20,18,18,0.48)";
      [-0.26, 0.26].forEach(function (dx) {
        ctx.beginPath(); ctx.arc(p.x + dx * rx, topY - ry * 0.14, Math.max(1, rx * 0.055), 0, 6.28); ctx.fill();
        ctx.beginPath(); ctx.arc(p.x + dx * rx, topY + ry * 0.18, Math.max(1, rx * 0.055), 0, 6.28); ctx.fill();
      });
    }
    ctx.restore();
  }

  function drawFastenersOnCup(cx, cy, rx, ry, sc, count) {
    ctx.save();
    ctx.fillStyle = "rgba(35,28,24,0.42)";
    for (var i = 0; i < count; i++) {
      var x = cx + (i - (count - 1) / 2) * rx * 0.34;
      var y = cy + ry * 0.84;
      ctx.beginPath(); ctx.arc(x, y, Math.max(1, 2.2 * sc), 0, 6.28); ctx.fill();
    }
    ctx.restore();
  }

  // the shaded hump at the fold where the flat runway rises into the tilted board
  function drawRamp() {
    var pal = P();
    var s0 = S_RAMP - 0.06, s1 = S_RAMP + 0.008;
    // cast shadow onto the lane just below the ramp base
    ctx.save();
    quad(s0 - 0.06, s0 + 0.01, -1.02, 1.02); ctx.clip();
    var shTop = proj(s0 + 0.01, 0).y, shBot = proj(s0 - 0.06, 0).y;
    var shg = ctx.createLinearGradient(0, shTop, 0, shBot);
    shg.addColorStop(0, "rgba(0,0,0,0.4)"); shg.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = shg; ctx.fillRect(0, 0, W, H);
    ctx.restore();
    // ramp face: bright at the crest (back/top), dark at the base (front/bottom)
    ctx.save();
    quad(s0, s1, -1.02, 1.02); ctx.clip();
    var yTop = proj(s1, 0).y, yBot = proj(s0, 0).y;
    var rg = ctx.createLinearGradient(0, yTop, 0, yBot);
    rg.addColorStop(0, pal.ramp[0]); rg.addColorStop(0.4, pal.ramp[1]); rg.addColorStop(1, pal.ramp[2]);
    ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H);
    // side falloff so the hump reads as curved
    var eg = ctx.createLinearGradient(proj(s0, -1).x, 0, proj(s0, 1).x, 0);
    eg.addColorStop(0, "rgba(16,4,7,0.55)"); eg.addColorStop(0.5, "rgba(16,4,7,0)"); eg.addColorStop(1, "rgba(16,4,7,0.55)");
    ctx.fillStyle = eg; ctx.fillRect(0, 0, W, H);
    ctx.restore();
    // dark crease at the fold + a thin specular just above it
    var cl0 = proj(S_RAMP, -1.02), cr0 = proj(S_RAMP, 1.02), cm0 = proj(S_RAMP, 0);
    ctx.beginPath(); ctx.moveTo(cl0.x, cl0.y); ctx.quadraticCurveTo(cm0.x, cm0.y + (cl0.y - cm0.y) * 0.12, cr0.x, cr0.y);
    ctx.lineWidth = 3.5; ctx.strokeStyle = "rgba(12,2,5,0.55)"; ctx.stroke();
    var l = proj(S_RAMP + 0.006, -1.0), r = proj(S_RAMP + 0.006, 1.0), m = proj(S_RAMP + 0.006, 0);
    ctx.beginPath(); ctx.moveTo(l.x, l.y); ctx.quadraticCurveTo(m.x, m.y + (l.y - m.y) * 0.14, r.x, r.y);
    ctx.lineWidth = 1.6; ctx.strokeStyle = "rgba(255,220,205,0.3)"; ctx.stroke();
  }

  function drawLane() {
    // Long red runway with yellow side decks and black guide rods, matching the gameplay screenshot.
    var pal = P();
    ctx.save();
    quad(0, S_RAMP, -1.0, 1.0); ctx.clip();
    var nY = proj(0, 0).y, rY = proj(S_RAMP, 0).y;
    var g = G();
    var lg = ctx.createLinearGradient(0, rY, 0, nY);
    lg.addColorStop(0, pal.lane[0]); lg.addColorStop(0.58, pal.lane[1]); lg.addColorStop(1, pal.lane[2]);
    ctx.fillStyle = lg; ctx.fillRect(0, 0, W, H);
    drawSurfaceWear(0.02, S_RAMP - 0.02, 0.92, "rgba(255,235,180,0.045)", "rgba(80,20,18,0.10)");
    quad(0.015, S_RAMP - 0.018, -0.78, -0.42);
    var yellow = ctx.createLinearGradient(0, rY, 0, nY);
    yellow.addColorStop(0, pal.deck[0]); yellow.addColorStop(0.5, pal.deck[1]); yellow.addColorStop(1, pal.deck[2]);
    ctx.fillStyle = yellow; ctx.fill();
    quad(0.015, S_RAMP - 0.018, 0.42, 0.78); ctx.fillStyle = yellow; ctx.fill();
    quad(0.015, S_RAMP - 0.018, -0.40, 0.40);
    var strip = ctx.createLinearGradient(0, rY, 0, nY);
    strip.addColorStop(0, pal.center[0]); strip.addColorStop(0.48, pal.center[1]); strip.addColorStop(1, pal.center[2]);
    ctx.fillStyle = strip; ctx.fill();
    laneRod(-0.34); laneRod(0.34);
    // soft overhead spotlight pooling down the lane
    var sp = ctx.createRadialGradient(g.cx, H * 0.55, 0, g.cx, H * 0.55, H * 0.5);
    sp.addColorStop(0, "rgba(255,210,190,0.14)"); sp.addColorStop(0.6, "rgba(255,190,170,0.04)"); sp.addColorStop(1, "rgba(255,190,170,0)");
    ctx.fillStyle = sp; ctx.fillRect(0, 0, W, H);
    // edge falloff
    var eg = ctx.createLinearGradient(g.cx - g.nearHalf, 0, g.cx + g.nearHalf, 0);
    eg.addColorStop(0, "rgba(0,0,0,0.54)"); eg.addColorStop(0.5, "rgba(0,0,0,0)"); eg.addColorStop(1, "rgba(0,0,0,0.54)");
    ctx.fillStyle = eg; ctx.fillRect(0, 0, W, H);
    ctx.restore();
    [-0.82, 0.82].forEach(function (u) { laneLine(u, "rgba(30,22,18,0.68)", 2.6); });
  }

  function drawLaneHardware() {
    var nearL = proj(0.006, -1.02), nearR = proj(0.006, 1.02);
    var lipL = proj(0.040, -0.94), lipR = proj(0.040, 0.94);
    var mid = proj(0.050, 0);
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.38)";
    ctx.beginPath();
    ctx.ellipse((nearL.x + nearR.x) / 2, nearL.y + 26, (nearR.x - nearL.x) * 0.56, Math.max(12, H * 0.020), 0, 0, 6.28);
    ctx.fill();
    var metal = ctx.createLinearGradient(nearL.x, nearL.y, nearR.x, nearR.y);
    metal.addColorStop(0, "#242424"); metal.addColorStop(0.16, "#77736a"); metal.addColorStop(0.34, "#d5ccba"); metal.addColorStop(0.52, "#8f897e"); metal.addColorStop(0.72, "#c8c0ae"); metal.addColorStop(1, "#1c1c1d");
    ctx.beginPath();
    ctx.moveTo(lipL.x - 12, lipL.y - 2);
    ctx.lineTo(lipR.x + 12, lipR.y - 2);
    ctx.lineTo(nearR.x + 18, nearR.y + 24);
    ctx.lineTo(nearL.x - 18, nearL.y + 24);
    ctx.closePath();
    ctx.fillStyle = metal;
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.32)";
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(lipL.x - 8, lipL.y); ctx.lineTo(lipR.x + 8, lipR.y); ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,0.14)";
    ctx.lineWidth = 0.8;
    for (var i = 0; i < 7; i++) {
      var t = i / 6;
      var x0 = lipL.x + (lipR.x - lipL.x) * t - 8;
      var x1 = nearL.x + (nearR.x - nearL.x) * t + 8;
      ctx.beginPath(); ctx.moveTo(x0, lipL.y + 4); ctx.lineTo(x1, nearL.y + 19); ctx.stroke();
    }
    ctx.strokeStyle = "rgba(0,0,0,0.50)";
    ctx.beginPath(); ctx.moveTo(nearL.x - 14, nearL.y + 23); ctx.lineTo(nearR.x + 14, nearR.y + 23); ctx.stroke();
    var troughW = Math.max(70, W * 0.13), troughH = Math.max(13, H * 0.024);
    var troughY = Math.min(H - 20, mid.y + 11);
    var tg = ctx.createRadialGradient(mid.x, troughY - troughH * 0.3, 2, mid.x, troughY, troughW * 0.55);
    tg.addColorStop(0, "rgba(52,42,36,0.62)"); tg.addColorStop(0.55, "rgba(12,10,10,0.82)"); tg.addColorStop(1, "rgba(0,0,0,0.24)");
    ctx.fillStyle = tg;
    ctx.beginPath(); ctx.ellipse(mid.x, troughY, troughW * 0.50, troughH, 0, 0, 6.28); ctx.fill();
    ctx.strokeStyle = "rgba(210,196,170,0.34)";
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(mid.x, troughY, troughW * 0.50, troughH, 0, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke();
    [-0.62, 0.62].forEach(function (u) {
      var p = proj(0.08, u);
      ctx.fillStyle = "rgba(0,0,0,0.72)";
      ctx.beginPath(); ctx.ellipse(p.x, p.y, Math.max(9, 18 * p.sc), Math.max(4, 7 * p.sc), 0, 0, 6.28); ctx.fill();
    });
    [nearL, nearR].forEach(function (p) {
      ctx.fillStyle = "rgba(20,18,17,0.88)";
      ctx.beginPath(); ctx.arc(p.x + (p.x < mid.x ? 18 : -18), p.y + 12, Math.max(3, 5 * mid.sc), 0, 6.28); ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.18)";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(p.x + (p.x < mid.x ? 15 : -21), p.y + 12); ctx.lineTo(p.x + (p.x < mid.x ? 21 : -15), p.y + 12); ctx.stroke();
    });
    ctx.restore();
  }
  function laneRod(u) {
    var a = proj(0.03, u), b = proj(S_RAMP - 0.018, u);
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineWidth = Math.max(3, 7 * ((a.sc + b.sc) / 2));
    ctx.strokeStyle = "rgba(20,18,16,0.88)";
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.lineWidth = Math.max(1, 2 * ((a.sc + b.sc) / 2));
    ctx.strokeStyle = "rgba(255,220,130,0.28)";
    ctx.beginPath(); ctx.moveTo(a.x - 1, a.y); ctx.lineTo(b.x - 1, b.y); ctx.stroke();
    ctx.restore();
  }
  function laneLine(u, col, w) {
    var a = proj(0.015, u), b = proj(S_RAMP - 0.006, u);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
    ctx.lineWidth = Math.max(0.8, w * ((a.sc + b.sc) / 2)); ctx.strokeStyle = col; ctx.stroke();
  }
  function laneChevron(s) {
    var tip = proj(s + 0.05, 0), lw = proj(s, -0.16), rw = proj(s, 0.16);
    ctx.beginPath(); ctx.moveTo(lw.x, lw.y); ctx.lineTo(tip.x, tip.y); ctx.lineTo(rw.x, rw.y);
    ctx.lineWidth = Math.max(1, 2 * tip.sc); ctx.strokeStyle = "rgba(238,232,222,0.4)"; ctx.lineJoin = "round"; ctx.stroke();
  }

  function drawRails() {
    // netted side rails running the length of the lane + board
    for (var side = -1; side <= 1; side += 2) {
      ctx.beginPath();
      var steps = 16;
      for (var i = 0; i <= steps; i++) {
        var s = (i / steps) * 1.04;
        var p = proj(s, side * 1.04);
        if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
      }
      ctx.lineWidth = 4; ctx.strokeStyle = "rgba(14,12,15,0.92)"; ctx.stroke();
      // rail top highlight
      ctx.lineWidth = 1.2; ctx.strokeStyle = "rgba(205,205,212,0.3)"; ctx.stroke();
    }
  }

  function drawAim() {
    if (state !== "aim" || !dragging) return;
    // trail of the swipe
    if (samples.length > 1) {
      ctx.beginPath();
      for (var i = 0; i < samples.length; i++) { var s = samples[i]; if (i === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y); }
      ctx.lineWidth = 4; ctx.strokeStyle = "rgba(255,207,106,0.5)"; ctx.lineCap = "round"; ctx.stroke();
    }
    // live landing marker
    if (live) {
      var p = proj(live.sLand, live.uLand);
      var col = live.pts === 100 ? "255,138,61" : live.pts === 0 ? "180,150,120" : "255,207,106";
      ctx.beginPath(); ctx.ellipse(p.x, p.y, Math.max(9, 22 * p.sc), Math.max(5, 12 * p.sc), 0, 0, 6.28);
      ctx.lineWidth = 2.4; ctx.strokeStyle = "rgba(" + col + ",0.9)"; ctx.stroke();
      ctx.fillStyle = "rgba(" + col + ",0.16)"; ctx.fill();
    }
  }

  function drawBall() {
    if (state === "menu" || state === "over") { drawRestBall(); return; }
    if (state === "aim") { drawRestBall(); return; }
    var p = proj(b.s, b.u);
    var lift = b.z * H * p.sc;
    var rr = Math.max(6, H * 0.045 * p.sc * b.r);
    var cupLift = activeCupBallLift();
    // shadow on the surface
    ctx.save();
    ctx.globalAlpha = clamp(0.4 - b.z * 1.2, 0.05, 0.4) * b.alpha;
    ctx.fillStyle = "#000";
    ctx.beginPath(); ctx.ellipse(p.x, p.y - cupLift * 0.46, rr * (1 + b.z * 3), rr * 0.4 * (1 + b.z * 2.4), 0, 0, 6.28); ctx.fill();
    ctx.restore();
    // ball
    ctx.save(); ctx.globalAlpha = b.alpha;
    var by = p.y - lift - cupLift;
    var grd = ctx.createRadialGradient(p.x - rr * 0.35, by - rr * 0.4, rr * 0.1, p.x, by, rr);
    grd.addColorStop(0, "#fff1c4"); grd.addColorStop(0.42, "#f0b93f"); grd.addColorStop(1, "#9a6412");
    ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(p.x, by, rr, 0, 6.28); ctx.fill();
    // scuff/spin highlight
    ctx.globalAlpha = b.alpha * 0.7;
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.beginPath(); ctx.arc(p.x - rr * 0.34 + Math.cos(b.spin) * rr * 0.15, by - rr * 0.4, rr * 0.2, 0, 6.28); ctx.fill();
    ctx.restore();
  }

  function activeCupBallLift() {
    if (state !== "land" || !shot || shot.hole !== "cup") return 0;
    var cup = findCupAt(shot.cupS, shot.cupU);
    if (!cup) return 0;
    var p = proj(cup.s, cup.u);
    var rx = cup.R * p.half;
    var hgt = Math.max(5, rx * 0.30);
    var ry = rx * 0.60;
    var settle = b.cupSettle || 0;
    var drop = b.cupDrop || 0;
    var mouthLift = hgt + ry * 0.10;
    return mouthLift * clamp((settle - 0.28) / 0.72, 0, 1) + hgt * 0.18 * drop;
  }

  function drawActiveCupOcclusion() {
    if (state !== "land" || !shot || shot.hole !== "cup") return;
    var cup = findCupAt(shot.cupS, shot.cupU);
    if (!cup) return;
    var p = proj(cup.s, cup.u);
    var rx = cup.R * p.half, ry = rx * 0.60;
    var hgt = Math.max(5, rx * 0.30);
    var topY = p.y - hgt;
    var settle = b.cupSettle || 0;
    var drop = b.cupDrop || 0;
    ctx.save();
    ctx.globalAlpha = clamp((settle - 0.45) / 0.40, 0, 1) * clamp(0.55 + drop * 0.45, 0, 1);
    ctx.lineCap = "round";
    ctx.lineWidth = Math.max(3, rx * 0.24);
    ctx.strokeStyle = "#eee8dc";
    ctx.beginPath(); ctx.ellipse(p.x, topY, rx * 0.84, ry * 0.84, 0, 0.02, Math.PI - 0.02); ctx.stroke();
    var wall = ctx.createLinearGradient(0, topY, 0, p.y + ry * 0.36);
    wall.addColorStop(0, "rgba(248,243,231,0.88)");
    wall.addColorStop(1, "rgba(158,150,136,0.74)");
    ctx.fillStyle = wall;
    ctx.beginPath();
    ctx.ellipse(p.x, topY, rx * 0.84, ry * 0.84, 0, 0.02, Math.PI - 0.02);
    ctx.ellipse(p.x, p.y + ry * 0.08, rx * 0.78, ry * 0.46, 0, Math.PI - 0.02, 0.02, true);
    ctx.closePath();
    ctx.fill();
    ctx.lineWidth = Math.max(1, rx * 0.07);
    ctx.strokeStyle = "rgba(82,58,45,0.40)";
    ctx.beginPath(); ctx.ellipse(p.x, topY + ry * 0.07, rx * 0.73, ry * 0.66, 0, 0.04, Math.PI - 0.04); ctx.stroke();
    ctx.restore();
  }

  function findCupAt(s, u) {
    for (var i = 0; i < CUPS.length; i++) {
      if (Math.abs(CUPS[i].s - s) < 0.0001 && Math.abs(CUPS[i].u - u) < 0.0001) return CUPS[i];
    }
    return null;
  }
  function drawRestBall() {
    // ball waiting at the near end
    var p = proj(0.038, 0);
    var rr = H * 0.037;
    ctx.save();
    ctx.globalAlpha = 0.52; ctx.fillStyle = "#000";
    ctx.beginPath(); ctx.ellipse(p.x, p.y + rr * 0.50, rr * 1.05, rr * 0.34, 0, 0, 6.28); ctx.fill();
    ctx.globalAlpha = 0.18; ctx.fillStyle = "#fff0bd";
    ctx.beginPath(); ctx.ellipse(p.x, p.y + rr * 0.58, rr * 0.74, rr * 0.16, 0, 0, 6.28); ctx.fill();
    ctx.globalAlpha = 1;
    var grd = ctx.createRadialGradient(p.x - rr * 0.35, p.y - rr * 0.4, rr * 0.1, p.x, p.y, rr);
    grd.addColorStop(0, "#fff1c4"); grd.addColorStop(0.42, "#f0b93f"); grd.addColorStop(1, "#9a6412");
    ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(p.x, p.y, rr, 0, 6.28); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.72)"; ctx.beginPath(); ctx.arc(p.x - rr * 0.34, p.y - rr * 0.4, rr * 0.22, 0, 6.28); ctx.fill();
    ctx.restore();
  }

  function drawMachineVignette() {
    var g = ctx.createRadialGradient(W * 0.48, H * 0.46, Math.min(W, H) * 0.10, W * 0.50, H * 0.54, Math.max(W, H) * 0.62);
    g.addColorStop(0, "rgba(255,216,166,0.035)");
    g.addColorStop(0.54, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(0,0,0,0.26)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  function drawAmbientReflections() {
    var tm = performance.now() * 0.001;
    var g = G();
    var pal = P();
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    // A slow fluorescent sweep across the polished runway.
    ctx.save();
    quad(0.01, S_RAMP - 0.018, -0.42, 0.42); ctx.clip();
    var yA = proj(0.02, 0).y, yB = proj(S_RAMP - 0.02, 0).y;
    var sweep = ((tm * 0.10) % 1);
    var cy = yA + (yB - yA) * sweep;
    var lg = ctx.createLinearGradient(g.cx - g.nearHalf * 0.42, cy - 90, g.cx + g.nearHalf * 0.42, cy + 90);
    lg.addColorStop(0, "rgba(255,255,255,0)");
    lg.addColorStop(0.46, "rgba(255,232,190,0.055)");
    lg.addColorStop(0.54, "rgba(255,255,255,0.095)");
    lg.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = lg; ctx.fillRect(0, 0, W, H);
    ctx.restore();
    // Small glassy glints on raised white plastic.
    ctx.globalAlpha = 0.24 + Math.sin(tm * 1.7) * 0.05;
    CUPS.forEach(function (cup, i) {
      var p = proj(cup.s, cup.u);
      var rx = cup.R * p.half, ry = rx * 0.60;
      var hgt = Math.max(5, rx * 0.30);
      ctx.strokeStyle = "rgba(255,255,240,0.52)";
      ctx.lineWidth = Math.max(0.8, 1.4 * p.sc);
      ctx.beginPath();
      ctx.ellipse(p.x - rx * 0.05 + Math.sin(tm + i) * p.sc, p.y - hgt - ry * 0.10, rx * 0.58, ry * 0.46, 0, Math.PI * 1.10, Math.PI * 1.72);
      ctx.stroke();
    });
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    // Warm bulbs make the target box feel lit from inside the machine.
    var top = proj(0.98, 0), low = proj(0.90, 0);
    var glow = ctx.createRadialGradient(g.cx, top.y + (low.y - top.y) * 0.7, 0, g.cx, top.y + (low.y - top.y) * 0.7, Math.max(70, top.half * 1.6));
    glow.addColorStop(0, "rgba(" + pal.glow + ",0.075)");
    glow.addColorStop(1, "rgba(255,203,94,0)");
    ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  function drawTickets() {
    for (var i = 0; i < tix.length; i++) {
      var t = tix[i]; var a = clamp(1 - t.t / t.life, 0, 1);
      ctx.save(); ctx.globalAlpha = a; ctx.translate(t.x, t.y); ctx.rotate(t.rot);
      ctx.font = t.size + "px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("🎟️", 0, 0); ctx.restore();
    }
  }

  function drawPops() {
    for (var i = 0; i < pops.length; i++) {
      var p = pops[i]; var a = clamp(1 - p.t / 1.1, 0, 1);
      ctx.save(); ctx.globalAlpha = a;
      ctx.font = "800 " + p.size + "px 'Geist', sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(0,0,0,0.4)"; ctx.fillText(p.txt, p.x + 1, p.y + 2);
      ctx.fillStyle = "rgb(" + p.col + ")"; ctx.fillText(p.txt, p.x, p.y);
      ctx.restore();
    }
  }
  function drawSparks() {
    for (var i = 0; i < sparks.length; i++) {
      var s = sparks[i]; var a = clamp(1 - s.t / s.life, 0, 1);
      ctx.globalAlpha = a; ctx.fillStyle = "rgb(" + s.col + ")";
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 6.28); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /* ------------------------------------------------------------- fx spawn */

  function spawnPop(x, y, txt, col, scale) { pops.push({ x: x, y: y, txt: txt, col: col, size: Math.round(26 * (scale || 1)), t: 0 }); }
  function burstSparks(x, y, col, n) { for (var i = 0; i < n; i++) { var a = Math.random() * 6.28, sp = 60 + Math.random() * 200; sparks.push({ x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60, r: 1.5 + Math.random() * 2.5, col: col, t: 0, life: 0.5 + Math.random() * 0.5 }); } }
  function spitTickets(n) {
    if (REDMO) return;
    var sx = W * 0.5, sy = H * 0.9;
    for (var i = 0; i < Math.min(n, 10); i++) {
      tix.push({ x: sx + (Math.random() - 0.5) * 40, y: sy, vx: (Math.random() - 0.5) * 120, vy: -180 - Math.random() * 120, rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 8, size: 16 + Math.random() * 8, t: 0, life: 1.0 + Math.random() * 0.6 });
    }
    sndTick();
  }
  function burstConfetti() { if (REDMO) return; for (var i = 0; i < 60; i++) { var a = Math.random() * 6.28, sp = 100 + Math.random() * 320; sparks.push({ x: W * 0.5, y: H * 0.4, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 160, r: 2 + Math.random() * 3, col: ["255,207,106", "255,138,61", "246,234,214", "232,180,90"][i % 4], t: 0, life: 1.0 + Math.random() * 0.9 }); } }
  function flash(col) { flashCol = col; flashT = 1; }

  /* ------------------------------------------------------------- hud/util */

  function updateHud() {
    ballNumEl.textContent = Math.min(ball + (state === "aim" ? 1 : 0), BALLS) + "/" + BALLS;
    if (state === "aim") ballNumEl.textContent = (ball + 1) + "/" + BALLS;
    else ballNumEl.textContent = Math.max(1, ball) + "/" + BALLS;
    scoreEl.textContent = score;
    bestEl.textContent = best;
    streakEl.textContent = "×" + (streak >= 2 ? streak : 1);
  }
  function clamp(v, a, c) { return v < a ? a : v > c ? c : v; }
  function easeOut(t) { return 1 - (1 - t) * (1 - t); }

  function setOvKeys() {
    ovKeys.innerHTML = COARSE
      ? "Swipe up the lane · flick harder for the back rows · angle for the corners"
      : "Drag &amp; flick up the lane · flick harder for the back rows · angle for the corner 100s";
  }

  function hideHint() { if (hintEl && !hintEl.classList.contains("is-gone")) hintEl.classList.add("is-gone"); }

  /* -------------------------------------------------------------- loop */

  var last = performance.now();
  function frame(now) {
    var dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (running) update(dt);
    render();
    requestAnimationFrame(frame);
  }

  /* -------------------------------------------------------------- boot */

  function resize() {
    DPR = Math.min(2, window.devicePixelRatio || 1);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.floor(W * DPR); canvas.height = Math.floor(H * DPR);
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    woodTex = null;
    if (!motes.length) for (var i = 0; i < 30; i++) motes.push({ x: Math.random() * W, y: H * 0.1 + Math.random() * H * 0.45, vy: -4 - Math.random() * 8, vx: (Math.random() - 0.5) * 6, r: 0.6 + Math.random() * 1.6, a: 0.1 + Math.random() * 0.3, ph: Math.random() * 6.28 });
  }

  window.addEventListener("resize", resize);
  window.addEventListener("orientationchange", function () { setTimeout(resize, 120); setTimeout(resize, 400); });

  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", function () { dragging = false; live = null; });

  soundBtn.addEventListener("click", function () { initAudio(); iosUnlock(); setSound(!soundOn); });
  ovBtn.addEventListener("click", start);
  document.addEventListener("visibilitychange", function () { last = performance.now(); if (document.hidden) stopRoll(); });

  setOvKeys();
  setSound(soundOn);
  resize();
  requestAnimationFrame(frame);
})();
