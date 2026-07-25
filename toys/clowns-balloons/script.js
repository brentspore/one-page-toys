/* Clowns & Balloons — No. 091
 * A big-top arcade cousin of Breakout. Slide the seesaw to bounce the clown
 * skyward; where it lands on the plank (plus the plank's tilt) steers the
 * launch angle — constant launch speed, position sets aim. Pop every balloon
 * across the top to raise the tent for the next act. Three lives.
 * Vanilla Canvas 2D, no libs, no build. */
(function () {
  "use strict";

  var canvas = document.getElementById("canvas");
  var ctx = canvas.getContext("2d");
  var hud = document.getElementById("hud");
  var scoreEl = document.getElementById("score");
  var bestEl = document.getElementById("best");
  var levelEl = document.getElementById("level");
  var livesEl = document.getElementById("lives");
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

  /* ---------------------------------------------------------------- palette */

  var BAL_COLORS = [
    { hi: "#ff8a8f", mid: "#e6394a", lo: "#a11e2c" },  // red
    { hi: "#ffe08a", mid: "#f5b731", lo: "#b9820f" },  // gold
    { hi: "#8fe6ef", mid: "#3fb8c4", lo: "#1d7b85" },  // teal
    { hi: "#ffb488", mid: "#ff7a3d", lo: "#c14f1c" },  // orange
    { hi: "#d8aef0", mid: "#b06fd6", lo: "#7a419c" },  // purple
    { hi: "#a3e6b6", mid: "#5bc27a", lo: "#348050" }   // green
  ];
  var TENT_RED = "#c9313f";
  var TENT_CREAM = "#f4e6c8";

  /* ---------------------------------------------------------------- tuning */

  var GRAV_K = 1.05;      // gravity in field-heights / s^2 (lowered for more hang time / reaction)
  var LAUNCH_K = 1.3;     // seesaw launch speed — scaled down with gravity so it still reaches the top row
  var MAX_ANG = 1.02;     // max launch angle from vertical (rad) at plank edge
  var TILT_GAIN = 0.9;    // how much plank tilt adds to launch angle
  var TILT_MAX = 0.30;    // max plank tilt (rad)
  var PADDLE_RESP = 20;   // pointer-follow snappiness
  var SPEED_STEP = 1.05;  // per-level speed multiplier (gentler ramp)
  var SPEED_CAP = 1.4;
  var HOLD_T = 0.8;       // serve hover time
  var RESPAWN_INVULN = 0.9;

  /* ------------------------------------------------------------------ state */

  var phase = "menu";     // menu | play | clear | over
  var running = false;
  var soundOn = true;
  var score = 0, best = 0, level = 1, lives = 3;
  var speedMul = 1;

  var clown = { x: 0, y: 0, vx: 0, vy: 0, r: 20, face: 0, spin: 0, spins: 0, tada: 0, limb: 0, dir: 1 };
  var clownTrail = [];
  var held = false, holdT = 0;
  var invulnT = 0, clearT = 0, overT = 0;

  var paddleX = 0, paddleTargetX = 0, paddleHalf = 90, paddleVel = 0, tilt = 0;
  var basePaddleHalf = 90;
  var keyL = false, keyR = false;

  var balloons = [];
  var parts = [];         // shreds, confetti, dust
  var pops = [];          // floating score text
  var motes = [];         // ambient sparkle
  var shake = 0, flashT = 0, flashCol = "255,120,80";
  var bounceT = 99, squashMag = 0;   // clown squash animation
  var served = 0;         // balloons popped this level (for clear check assist)

  var bg = null, bgW = 0, bgH = 0;

  try { best = parseInt(localStorage.getItem("clowns_best") || "0", 10) || 0; } catch (e) {}
  try { if (localStorage.getItem("clowns_sound") === "0") soundOn = false; } catch (e) {}

  /* ---------------------------------------------------------------- geometry */

  function F() {
    var fw = Math.min(W, 860);
    var fx = (W - fw) / 2;
    return {
      x: fx, w: fw, cx: fx + fw / 2,
      left: fx + fw * 0.03, right: fx + fw * 0.97,
      topPad: H * 0.115,               // ceiling (under the valance)
      balloonTop: H * 0.165,
      seesawY: H * 0.855,
      loseY: H * 1.02,
      h: H
    };
  }

  /* ------------------------------------------------------------------ audio */

  var AC = null, master = null, comp = null, convo = null, noiseBuf = null;
  function initAudio() {
    if (AC) return;
    try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
    master = AC.createGain(); master.gain.value = soundOn ? 0.9 : 0;
    var lp = AC.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 13000;
    comp = AC.createDynamicsCompressor();
    comp.threshold.value = -15; comp.ratio.value = 3; comp.attack.value = 0.004; comp.release.value = 0.2;
    convo = AC.createConvolver(); convo.buffer = makeIR(1.3, 2.4);
    var wet = AC.createGain(); wet.gain.value = 0.15;
    comp.connect(lp); lp.connect(master);
    comp.connect(convo); convo.connect(wet); wet.connect(master);
    master.connect(AC.destination);
    var n = Math.floor(AC.sampleRate * 1.1); noiseBuf = AC.createBuffer(1, n, AC.sampleRate);
    var d = noiseBuf.getChannelData(0);
    for (var i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  }
  function makeIR(dur, decay) {
    var n = Math.floor(44100 * dur), buf = AC.createBuffer(2, n, AC.sampleRate);
    for (var c = 0; c < 2; c++) {
      var ch = buf.getChannelData(c), last = 0;
      for (var i = 0; i < n; i++) {
        var white = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay);
        last = (last + 0.032 * white) / 1.032; ch[i] = last * 2.6;
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
  function now() { return AC ? AC.currentTime : 0; }

  // balloon pop: a short airy transient + a quick resonant "body", pitch by row
  function sndPop(freq, vel) {
    if (!AC || !soundOn) return;
    var t = now();
    // transient burst
    var n = noiseSrc(), nf = AC.createBiquadFilter(), ng = AC.createGain();
    nf.type = "bandpass"; nf.frequency.value = 1400 + freq * 1.4; nf.Q.value = 0.9;
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.exponentialRampToValueAtTime(0.5 * vel, t + 0.004);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.075);
    n.connect(nf); nf.connect(ng); ng.connect(comp); n.start(t); n.stop(t + 0.09);
    // resonant body
    var o = AC.createOscillator(), og = AC.createGain();
    o.type = "triangle";
    o.frequency.setValueAtTime(freq * 1.5, t);
    o.frequency.exponentialRampToValueAtTime(freq * 0.72, t + 0.11);
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.34 * vel, t + 0.006);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    o.connect(og); og.connect(comp); o.start(t); o.stop(t + 0.18);
  }
  // seesaw bounce: a springy woody thock
  function sndBounce(vel) {
    if (!AC || !soundOn) return;
    var t = now();
    var v = Math.min(1, 0.4 + vel);
    var o = AC.createOscillator(), og = AC.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(300, t);
    o.frequency.exponentialRampToValueAtTime(112, t + 0.09);
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.4 * v, t + 0.006);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.19);
    o.connect(og); og.connect(comp); o.start(t); o.stop(t + 0.22);
    // woody click
    var n = noiseSrc(), nf = AC.createBiquadFilter(), ng = AC.createGain();
    nf.type = "bandpass"; nf.frequency.value = 760; nf.Q.value = 1.1;
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.exponentialRampToValueAtTime(0.22 * v, t + 0.003);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    n.connect(nf); nf.connect(ng); ng.connect(comp); n.start(t); n.stop(t + 0.06);
  }
  function sndWall() {
    if (!AC || !soundOn) return;
    var t = now();
    var n = noiseSrc(), nf = AC.createBiquadFilter(), ng = AC.createGain();
    nf.type = "bandpass"; nf.frequency.value = 1200; nf.Q.value = 1.4;
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.exponentialRampToValueAtTime(0.12, t + 0.003);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
    n.connect(nf); nf.connect(ng); ng.connect(comp); n.start(t); n.stop(t + 0.05);
  }
  // circus-organ pentatonic flourish on clearing a level
  function sndFlourish() {
    if (!AC || !soundOn) return;
    var t = now();
    var notes = [523.25, 587.33, 659.25, 783.99, 880, 1046.5];
    for (var i = 0; i < notes.length; i++) {
      var tt = t + i * 0.075;
      var o = AC.createOscillator(), o2 = AC.createOscillator(), g = AC.createGain();
      o.type = "sawtooth"; o2.type = "sine";
      o.frequency.value = notes[i]; o2.frequency.value = notes[i] * 2.01;
      var f = AC.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 2600;
      g.gain.setValueAtTime(0.0001, tt);
      g.gain.exponentialRampToValueAtTime(0.18, tt + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, tt + 0.5);
      o.connect(f); o2.connect(f); f.connect(g); g.connect(comp);
      o.start(tt); o.stop(tt + 0.55); o2.start(tt); o2.stop(tt + 0.55);
    }
  }
  // soft thud + descending slide-whistle on losing the clown
  function sndLose() {
    if (!AC || !soundOn) return;
    var t = now();
    var o = AC.createOscillator(), og = AC.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(70, t);
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.5, t + 0.01);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    o.connect(og); og.connect(comp); o.start(t); o.stop(t + 0.32);
    var w = AC.createOscillator(), wg = AC.createGain();
    w.type = "triangle";
    w.frequency.setValueAtTime(620, t + 0.02);
    w.frequency.exponentialRampToValueAtTime(150, t + 0.55);
    wg.gain.setValueAtTime(0.0001, t + 0.02);
    wg.gain.exponentialRampToValueAtTime(0.16, t + 0.06);
    wg.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    w.connect(wg); wg.connect(comp); w.start(t + 0.02); w.stop(t + 0.62);
  }
  function setSound(on) {
    soundOn = on;
    soundBtn.setAttribute("aria-pressed", on ? "true" : "false");
    soundBtn.textContent = on ? "♪" : "✕";
    if (master) master.gain.setTargetAtTime(on ? 0.9 : 0, now(), 0.02);
    try { localStorage.setItem("clowns_sound", on ? "1" : "0"); } catch (e) {}
  }

  /* --------------------------------------------------------------- level build */

  function buildLevel() {
    var f = F();
    balloons.length = 0;
    var rows = Math.min(6, level + 2);
    var usable = f.w * 0.86;
    var cols = Math.max(5, Math.min(11, Math.floor(f.w / 82)));
    var sx = usable / cols;
    var br = Math.min(sx * 0.4, H * 0.05);
    var rowGap = br * 2.55;
    var startX = f.cx - usable / 2 + sx / 2;
    for (var row = 0; row < rows; row++) {
      var col = BAL_COLORS[row % BAL_COLORS.length];
      var pts = (rows - row) * 10;
      var y = f.balloonTop + row * rowGap;
      for (var c = 0; c < cols; c++) {
        balloons.push({
          x: startX + c * sx,
          y: y,
          r: br,
          alive: true,
          col: col,
          pts: pts,
          row: row, rows: rows,
          bob: Math.random() * Math.PI * 2,
          pop: 0
        });
      }
    }
  }

  function aliveCount() {
    var n = 0;
    for (var i = 0; i < balloons.length; i++) if (balloons[i].alive) n++;
    return n;
  }

  /* ------------------------------------------------------------------ flow */

  function start() {
    initAudio(); iosUnlock();
    score = 0; lives = 3; level = 1; speedMul = 1;
    phase = "play"; clearT = 0; overT = 0; invulnT = 0;
    parts.length = 0; pops.length = 0;
    var f = F();
    basePaddleHalf = Math.min(f.w * 0.13, 120);
    paddleHalf = basePaddleHalf;
    paddleX = paddleTargetX = f.cx;
    tilt = 0;
    clown.r = Math.max(15, Math.min(H * 0.035, 34));
    buildLevel();
    serve();
    running = true;
    overlay.hidden = true;
    hud.hidden = false;
    document.body.classList.add("is-playing");
    hideHint();
    syncHud();
  }

  function serve() {
    var f = F();
    held = true; holdT = HOLD_T;
    clown.x = f.cx; clown.y = f.seesawY - H * 0.34;
    clown.vx = 0; clown.vy = 0;
    clown.face = (Math.random() * 3) | 0;
    invulnT = RESPAWN_INVULN;
    bounceT = 99; squashMag = 0;
  }

  function nextLevel() {
    level++;
    speedMul = Math.min(SPEED_CAP, speedMul * SPEED_STEP);
    paddleHalf = Math.max(basePaddleHalf * 0.6, paddleHalf * 0.93);
    phase = "clear"; clearT = 1.35;
    sndFlourish();
    burstConfetti();
    syncHud();
  }

  function loseLife() {
    lives--;
    shake = Math.max(shake, 14);
    flashT = 0.4; flashCol = "255,90,70";
    sndLose();
    thudDust();
    syncHud();
    if (lives <= 0) { gameOver(); return; }
    serve();
  }

  function gameOver() {
    phase = "over";
    var isBest = score > best;
    if (isBest) { best = score; try { localStorage.setItem("clowns_best", String(best)); } catch (e) {} }
    window.OPT_SHARE_TEXT = "I popped my way to " + score + " under the big top in Clowns & Balloons on One Page Toys" + (isBest ? " — new personal best!" : "!");
    if (window.OPT_TICKETS && typeof window.OPT_TICKETS.award === "function") {
      var tix = Math.min(45, 3 * level + Math.floor(score / 220));
      if (tix > 0) { try { window.OPT_TICKETS.award(tix, "Clowns & Balloons payout"); } catch (e) {} }
    }
    ovEyebrow.textContent = isBest ? "New high score!" : "Show's over";
    ovTitle.textContent = "Scored " + score;
    ovText.textContent = "You reached level " + level + " and popped your way to " + score + " points" +
      (isBest ? ". A brand-new personal best under the big top!" : ". Best so far: " + best + ".") +
      " Slide, launch, and pop for an even bigger run.";
    ovBtn.textContent = "Play again";
    overlay.hidden = false;
    syncHud();
  }

  function syncHud() {
    scoreEl.textContent = score;
    bestEl.textContent = best;
    levelEl.textContent = level;
    var s = "";
    for (var i = 0; i < 3; i++) s += i < lives ? "●" : "○";
    livesEl.textContent = s;
  }

  /* --------------------------------------------------------------- particles */

  function popBalloon(bl, cx, cy) {
    bl.alive = false; bl.pop = 1;
    var pitch = 340 * Math.pow(1.085, (bl.rows - 1 - bl.row));
    sndPop(pitch, 0.9);
    // rubber shreds
    var nsh = REDMO ? 4 : 9;
    for (var i = 0; i < nsh; i++) {
      var a = (i / nsh) * Math.PI * 2 + Math.random() * 0.6;
      var sp = (0.6 + Math.random() * 1.6) * H * 0.12;
      parts.push({
        x: bl.x, y: bl.y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - H * 0.05,
        g: H * 2.4, life: 0.5 + Math.random() * 0.4, t: 0,
        r: bl.r * (0.16 + Math.random() * 0.22),
        col: bl.col.mid, shred: true, rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 20
      });
    }
    // burst flash spark
    for (var j = 0; j < (REDMO ? 3 : 6); j++) {
      var a2 = Math.random() * Math.PI * 2, sp2 = (0.4 + Math.random()) * H * 0.14;
      parts.push({
        x: bl.x, y: bl.y, vx: Math.cos(a2) * sp2, vy: Math.sin(a2) * sp2,
        g: H * 0.5, life: 0.22 + Math.random() * 0.15, t: 0, r: bl.r * 0.14,
        col: bl.col.hi, spark: true
      });
    }
    pops.push({ x: bl.x, y: bl.y, txt: "+" + bl.pts, t: 0, life: 0.85, col: bl.col.hi });
    flashT = Math.max(flashT, 0.1); flashCol = "255,220,150";
  }

  function burstConfetti() {
    if (REDMO) return;
    var f = F();
    var cols = ["#e6394a", "#f5b731", "#3fb8c4", "#ff7a3d", "#b06fd6", "#5bc27a", "#ffffff"];
    for (var i = 0; i < 90; i++) {
      parts.push({
        x: f.cx + (Math.random() - 0.5) * f.w * 0.7,
        y: -20 - Math.random() * H * 0.2,
        vx: (Math.random() - 0.5) * H * 0.3,
        vy: H * (0.2 + Math.random() * 0.4),
        g: H * 0.4, life: 1.8 + Math.random() * 1.2, t: 0,
        r: 3 + Math.random() * 4, col: cols[(Math.random() * cols.length) | 0],
        confetti: true, rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 14,
        wob: Math.random() * 6.28
      });
    }
  }

  function thudDust() {
    var f = F();
    for (var i = 0; i < (REDMO ? 4 : 12); i++) {
      var a = -Math.PI * 0.5 + (Math.random() - 0.5) * 1.6;
      var sp = (0.4 + Math.random()) * H * 0.18;
      parts.push({
        x: clown.x, y: f.loseY - H * 0.02 > f.seesawY ? f.seesawY : clown.y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        g: H * 1.8, life: 0.4 + Math.random() * 0.3, t: 0,
        r: 2 + Math.random() * 3, col: "#d9c39a", dust: true
      });
    }
  }

  /* ------------------------------------------------------------------ update */

  function update(dt) {
    var f = F();
    for (var i = 0; i < motes.length; i++) {
      var m = motes[i];
      m.y += m.vy * dt; m.x += Math.sin(m.ph + performance.now() * 0.0004) * 6 * dt;
      m.ph += dt;
      if (m.y < f.topPad) { m.y = H * 0.9; m.x = Math.random() * W; }
    }

    if (shake > 0) shake = Math.max(0, shake - dt * 42);
    if (flashT > 0) flashT = Math.max(0, flashT - dt);
    if (invulnT > 0) invulnT = Math.max(0, invulnT - dt);
    bounceT += dt;

    updateParts(dt);
    for (var p = pops.length - 1; p >= 0; p--) {
      pops[p].t += dt; pops[p].y -= dt * H * 0.06;
      if (pops[p].t >= pops[p].life) pops.splice(p, 1);
    }
    for (var b = 0; b < balloons.length; b++) {
      if (balloons[b].alive) balloons[b].bob += dt * 1.6;
      else if (balloons[b].pop > 0) balloons[b].pop = Math.max(0, balloons[b].pop - dt * 4);
    }

    if (phase === "clear") {
      clearT -= dt;
      updatePaddle(dt, f);
      if (clearT <= 0) { buildLevel(); serve(); phase = "play"; }
      return;
    }
    if (phase !== "play") return;

    updatePaddle(dt, f);

    if (held) {
      holdT -= dt;
      clown.x = f.cx;
      clown.y = (f.seesawY - H * 0.34) + Math.sin(holdT * 6) * H * 0.006;
      clown.spin *= Math.max(0, 1 - dt * 8);   // settle upright, ready to serve
      clown.limb += dt * 3; clown.spins = 0; clown.tada = 0;
      if (clownTrail.length) clownTrail.length = 0;
      if (holdT <= 0) { held = false; clown.vy = H * 0.16; clown.vx = 0; clown.dir = 1; }
      return;
    }

    // clown physics, substepped to avoid tunneling
    var GRAV = GRAV_K * H * speedMul;
    var spd = Math.hypot(clown.vx, clown.vy);
    var maxSpd = H * 3.2 * speedMul;
    if (spd > maxSpd) { var k = maxSpd / spd; clown.vx *= k; clown.vy *= k; spd = maxSpd; }
    var steps = Math.max(1, Math.min(9, Math.ceil((spd * dt) / (clown.r * 0.4))));
    var hstep = dt / steps;
    for (var st = 0; st < steps; st++) {
      clown.vy += GRAV * hstep;
      clown.x += clown.vx * hstep;
      clown.y += clown.vy * hstep;
      if (collide(f)) break;    // seesaw hit ends the substep loop
    }
    // acrobat somersault + flailing limbs + a motion trail while airborne
    var arate = clown.dir * Math.min(13, 6 + Math.abs(clown.vx) / H * 4);
    clown.spin += arate * dt;
    clown.spins += Math.abs(arate * dt) / (Math.PI * 2);
    clown.limb += dt * 13;
    if (clown.tada > 0) clown.tada -= dt;
    if (!REDMO) {
      clownTrail.push({ x: clown.x, y: clown.y, spin: clown.spin, r: clown.r });
      if (clownTrail.length > 6) clownTrail.shift();
    }
    if (clown.y - clown.r > f.loseY) loseLife();
  }

  function updatePaddle(dt, f) {
    if (keyL) paddleTargetX -= f.w * 1.5 * dt;
    if (keyR) paddleTargetX += f.w * 1.5 * dt;
    var lo = f.left + paddleHalf, hi = f.right - paddleHalf;
    if (paddleTargetX < lo) paddleTargetX = lo;
    if (paddleTargetX > hi) paddleTargetX = hi;
    var prev = paddleX;
    paddleX += (paddleTargetX - paddleX) * Math.min(1, dt * PADDLE_RESP);
    if (paddleX < lo) paddleX = lo; if (paddleX > hi) paddleX = hi;
    paddleVel = dt > 0 ? (paddleX - prev) / dt : 0;
    var tt = Math.max(-TILT_MAX, Math.min(TILT_MAX, (paddleVel / H) * 0.9));
    tilt += (tt - tilt) * Math.min(1, dt * 12);
  }

  // returns true if a seesaw bounce happened (stops the substep loop)
  function collide(f) {
    var r = clown.r;
    // side walls
    if (clown.x - r < f.left) { clown.x = f.left + r; clown.vx = Math.abs(clown.vx); sndWall(); wallSquash(); }
    else if (clown.x + r > f.right) { clown.x = f.right - r; clown.vx = -Math.abs(clown.vx); sndWall(); wallSquash(); }
    // ceiling
    if (clown.y - r < f.topPad) { clown.y = f.topPad + r; clown.vy = Math.abs(clown.vy); sndWall(); wallSquash(); }

    // balloons
    for (var i = 0; i < balloons.length; i++) {
      var bl = balloons[i];
      if (!bl.alive) continue;
      var dx = clown.x - bl.x, dy = clown.y - bl.y;
      var rr = r + bl.r;
      if (dx * dx + dy * dy < rr * rr) {
        var d = Math.sqrt(dx * dx + dy * dy) || 0.001;
        var nx = dx / d, ny = dy / d;
        // reflect velocity about the contact normal, keep speed
        var vdot = clown.vx * nx + clown.vy * ny;
        clown.vx -= 2 * vdot * nx;
        clown.vy -= 2 * vdot * ny;
        // push out of overlap
        clown.x = bl.x + nx * rr;
        clown.y = bl.y + ny * rr;
        popBalloon(bl);
        score += bl.pts;
        syncHud();
        squash(0.22);
        clown.tada = 0.18;   // little startled cheer on a pop
        if (aliveCount() === 0) { nextLevel(); return true; }
        return false;
      }
    }

    // seesaw plank
    if (clown.vy > 0) {
      var t = Math.tan(tilt);
      var withinL = paddleX - paddleHalf - r * 0.55;
      var withinR = paddleX + paddleHalf + r * 0.55;
      if (clown.x >= withinL && clown.x <= withinR) {
        var surf = f.seesawY + t * (clown.x - paddleX);   // plank top surface at clown x
        if (clown.y + r >= surf && clown.y <= surf + r * 1.4) {
          clown.y = surf - r;
          // constant launch speed; angle from hit position + plank tilt
          var off = (clown.x - paddleX) / paddleHalf;
          if (off > 1) off = 1; if (off < -1) off = -1;
          var ang = off * MAX_ANG + tilt * TILT_GAIN;
          if (ang > 1.28) ang = 1.28; if (ang < -1.28) ang = -1.28;
          var LAUNCH = LAUNCH_K * H * speedMul;
          clown.vx = LAUNCH * Math.sin(ang) + paddleVel * 0.18;
          clown.vy = -LAUNCH * Math.cos(ang);
          if (Math.abs(clown.vx) > H * 0.04) clown.dir = clown.vx > 0 ? 1 : -1;
          clown.spins = 0; clown.tada = 0.26;   // "here I go!" pose off the plank
          sndBounce(Math.min(1, LAUNCH / (H * 2)));
          squash(0.36);
          return true;
        }
      }
    }
    return false;
  }

  function squash(mag) { squashMag = mag; bounceT = 0; }
  function wallSquash() { if (bounceT > 0.12) squash(0.16); }

  function updateParts(dt) {
    for (var i = parts.length - 1; i >= 0; i--) {
      var p = parts[i];
      p.t += dt;
      if (p.t >= p.life) { parts.splice(i, 1); continue; }
      p.vy += (p.g || 0) * dt;
      if (p.confetti) { p.wob += dt * 8; p.x += Math.sin(p.wob) * 18 * dt; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.rot !== undefined) p.rot += (p.vr || 0) * dt;
    }
  }

  /* ------------------------------------------------------------------ render */

  function buildBg() {
    bg = document.createElement("canvas");
    bg.width = Math.floor(W * DPR); bg.height = Math.floor(H * DPR);
    bgW = W; bgH = H;
    var g = bg.getContext("2d");
    g.setTransform(DPR, 0, 0, DPR, 0, 0);
    var f = F();

    // interior wash
    var sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, "#2a1140");
    sky.addColorStop(0.5, "#3a1140");
    sky.addColorStop(1, "#1c0a2a");
    g.fillStyle = sky; g.fillRect(0, 0, W, H);

    // side curtains (letterbox) — vertical striped drapes
    if (f.x > 1) {
      drawCurtain(g, 0, f.x);
      drawCurtain(g, f.x + f.w, W - (f.x + f.w), true);
    }

    // big-top ceiling: stripes fanning from a peak above center down to the valance
    var peakX = W / 2, peakY = -H * 0.14, valanceY = H * 0.11;
    var spread = f.w * 0.62;
    var n = 14;
    for (var i = 0; i < n; i++) {
      var x0 = peakX + (i / n - 0.5) * spread * 2;
      var x1 = peakX + ((i + 1) / n - 0.5) * spread * 2;
      // widen at the valance line
      var bx0 = W / 2 + (x0 - W / 2) * 2.6;
      var bx1 = W / 2 + (x1 - W / 2) * 2.6;
      g.beginPath();
      g.moveTo(peakX, peakY);
      g.lineTo(bx0, valanceY);
      g.lineTo(bx1, valanceY);
      g.closePath();
      g.fillStyle = i % 2 ? TENT_RED : TENT_CREAM;
      g.globalAlpha = 0.92;
      g.fill();
    }
    g.globalAlpha = 1;
    // shade the ceiling toward the edges
    var vsh = g.createLinearGradient(0, peakY, 0, valanceY);
    vsh.addColorStop(0, "rgba(0,0,0,0.45)");
    vsh.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = vsh; g.fillRect(0, 0, W, valanceY);

    // scalloped valance hanging under the ceiling
    var scW = Math.max(40, W / 16), sy = valanceY;
    g.fillStyle = "#a6202c";
    g.fillRect(0, sy - 6, W, 12);
    var sc = 0;
    for (var x = -scW / 2; x < W + scW; x += scW) {
      g.beginPath();
      g.arc(x + scW / 2, sy + 6, scW / 2, 0, Math.PI);
      g.closePath();
      g.fillStyle = sc % 2 ? "#c9313f" : "#e0b24a";
      g.fill();
      // tassel dot
      g.beginPath();
      g.arc(x + scW / 2, sy + 6 + scW / 2, 3.2, 0, Math.PI * 2);
      g.fillStyle = "#f4e6c8"; g.fill();
      sc++;
    }

    // sawdust ring / floor glow at the bottom
    var fl = g.createRadialGradient(W / 2, H * 1.02, H * 0.1, W / 2, H * 1.02, H * 0.62);
    fl.addColorStop(0, "rgba(255,190,120,0.30)");
    fl.addColorStop(1, "rgba(255,190,120,0)");
    g.fillStyle = fl; g.fillRect(0, H * 0.5, W, H * 0.5);

    // faint tent-fabric folds down the back wall so the interior isn't a flat void
    for (var fx = 0; fx < 8; fx++) {
      var cxf = f.x + (fx + 0.5) / 8 * f.w, fw = f.w * 0.11;
      var fg = g.createLinearGradient(cxf - fw, 0, cxf + fw, 0);
      fg.addColorStop(0, "rgba(20,6,30,0)");
      fg.addColorStop(0.5, "rgba(150,70,160," + (0.05 + (fx % 2) * 0.035) + ")");
      fg.addColorStop(1, "rgba(20,6,30,0)");
      g.fillStyle = fg; g.fillRect(cxf - fw, valanceY, fw * 2, H);
    }
    // a soft spotlight down-beam from the top centre onto the stage
    g.save();
    g.beginPath();
    g.moveTo(W / 2 - f.w * 0.06, valanceY);
    g.lineTo(W / 2 + f.w * 0.06, valanceY);
    g.lineTo(W / 2 + f.w * 0.34, f.seesawY + H * 0.04);
    g.lineTo(W / 2 - f.w * 0.34, f.seesawY + H * 0.04);
    g.closePath();
    var beam = g.createLinearGradient(0, valanceY, 0, f.seesawY);
    beam.addColorStop(0, "rgba(255,244,214,0.12)");
    beam.addColorStop(1, "rgba(255,244,214,0)");
    g.fillStyle = beam; g.fill();
    g.restore();
    // warm stage light pool where the seesaw sits
    var stg = g.createRadialGradient(W / 2, f.seesawY + H * 0.02, 0, W / 2, f.seesawY + H * 0.02, f.w * 0.6);
    stg.addColorStop(0, "rgba(255,236,196,0.22)");
    stg.addColorStop(0.5, "rgba(255,214,160,0.07)");
    stg.addColorStop(1, "rgba(255,214,160,0)");
    g.fillStyle = stg; g.fillRect(0, H * 0.45, W, H * 0.55);
    // edge vignette for depth
    var vg = g.createRadialGradient(W / 2, H * 0.52, Math.min(W, H) * 0.32, W / 2, H * 0.52, Math.max(W, H) * 0.74);
    vg.addColorStop(0, "rgba(8,2,14,0)");
    vg.addColorStop(1, "rgba(8,2,14,0.55)");
    g.fillStyle = vg; g.fillRect(0, 0, W, H);
  }

  function drawCurtain(g, x, w, right) {
    if (w <= 0) return;
    var pleats = Math.max(3, Math.round(w / 26));
    var pw = w / pleats;
    for (var i = 0; i < pleats; i++) {
      var px = x + i * pw;
      var lg = g.createLinearGradient(px, 0, px + pw, 0);
      lg.addColorStop(0, "#5a121f");
      lg.addColorStop(0.5, "#8a2231");
      lg.addColorStop(1, "#4a0f1a");
      g.fillStyle = lg;
      g.fillRect(px, 0, pw + 1, H);
    }
    // gold tie edge
    g.fillStyle = "rgba(245,196,81,0.55)";
    g.fillRect(right ? x : x + w - 3, 0, 3, H);
  }

  function render() {
    if (!bg || bgW !== W || bgH !== H) buildBg();
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W, H);

    var sx = 0, sy = 0;
    if (shake > 0) { sx = (Math.random() - 0.5) * shake; sy = (Math.random() - 0.5) * shake; }
    ctx.save();
    ctx.translate(sx, sy);

    // background
    ctx.drawImage(bg, 0, 0, W, H);

    var f = F();

    // twinkling bulb-string garland strung across the big top
    drawGarland(ctx);

    // ambient motes
    for (var i = 0; i < motes.length; i++) {
      var m = motes[i];
      ctx.globalAlpha = m.a;
      ctx.fillStyle = "#ffe6a8";
      ctx.beginPath(); ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;

    drawBalloons(ctx);

    if (phase !== "menu") {
      drawSeesaw(ctx, f);
      if (!(phase === "over")) drawClown(ctx);
    }

    drawParts(ctx);
    drawPops(ctx);

    ctx.restore();

    // level banner
    if (phase === "clear" && clearT > 0.2) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, clearT * 2);
      ctx.textAlign = "center";
      ctx.fillStyle = "#ffe08a";
      ctx.font = "800 " + Math.round(Math.min(W, H) * 0.09) + "px Geist, system-ui, sans-serif";
      ctx.shadowColor = "rgba(216,56,74,0.6)"; ctx.shadowBlur = 24;
      ctx.fillText("LEVEL " + level, W / 2, H * 0.42);
      ctx.restore();
    }

    // flash
    if (flashT > 0) {
      ctx.fillStyle = "rgba(" + flashCol + "," + (flashT * 0.5) + ")";
      ctx.fillRect(0, 0, W, H);
    }
  }

  function drawGarland(c) {
    // shallow catenary swags strung over the ceiling, above the valance, with twinkling bulbs
    var yTop = H * 0.05, segW = Math.max(88, W / 8), sag = Math.min(H * 0.05, segW * 0.42);
    var t = REDMO ? 0 : performance.now() * 0.0016;
    c.save();
    // wire
    c.strokeStyle = "rgba(18,6,12,0.5)"; c.lineWidth = Math.max(1.2, W * 0.0016);
    c.beginPath();
    for (var x = 0; x <= W; x += 6) {
      var ph = (x % segW) / segW;
      var y = yTop + Math.sin(ph * Math.PI) * sag;
      if (x === 0) c.moveTo(x, y); else c.lineTo(x, y);
    }
    c.stroke();
    // bulbs
    var cols = ["255,208,120", "255,120,120", "120,220,235", "255,240,175"];
    var br = Math.max(3, W * 0.004), bi = 0;
    for (var bx = segW * 0.5; bx < W; bx += segW * 0.5) {
      var ph2 = (bx % segW) / segW;
      var by = yTop + Math.sin(ph2 * Math.PI) * sag + br * 1.4;
      var tw = 0.55 + 0.45 * Math.sin(t * 3 + bi * 1.7);
      var col = cols[bi % cols.length];
      c.save(); c.globalCompositeOperation = "lighter";
      var gr = c.createRadialGradient(bx, by, 0, bx, by, br * 4.5);
      gr.addColorStop(0, "rgba(" + col + "," + (0.5 * tw) + ")");
      gr.addColorStop(1, "rgba(" + col + ",0)");
      c.fillStyle = gr; c.beginPath(); c.arc(bx, by, br * 4.5, 0, Math.PI * 2); c.fill();
      c.restore();
      c.fillStyle = "rgba(" + col + "," + (0.8 + 0.2 * tw) + ")";
      c.beginPath(); c.arc(bx, by, br, 0, Math.PI * 2); c.fill();
      c.fillStyle = "rgba(255,255,255,0.75)";
      c.beginPath(); c.arc(bx - br * 0.3, by - br * 0.3, br * 0.34, 0, Math.PI * 2); c.fill();
      bi++;
    }
    c.restore();
  }

  function drawBalloons(c) {
    for (var i = 0; i < balloons.length; i++) {
      var bl = balloons[i];
      if (!bl.alive) continue;
      var bob = Math.sin(bl.bob) * bl.r * 0.12;
      var sway = Math.sin(bl.bob * 0.6 + bl.x * 0.03) * bl.r * 0.16;   // gentle group sway
      var x = bl.x + sway, y = bl.y + bob, r = bl.r;
      // string
      c.strokeStyle = "rgba(255,255,255,0.22)";
      c.lineWidth = Math.max(1, r * 0.06);
      c.beginPath();
      c.moveTo(x, y + r * 1.02);
      c.quadraticCurveTo(x + Math.sin(bl.bob) * r * 0.5, y + r * 1.7, x + Math.sin(bl.bob * 0.7) * r * 0.3, y + r * 2.4);
      c.stroke();
      // knot
      c.fillStyle = bl.col.lo;
      c.beginPath();
      c.moveTo(x - r * 0.14, y + r * 0.96);
      c.lineTo(x + r * 0.14, y + r * 0.96);
      c.lineTo(x, y + r * 1.16);
      c.closePath(); c.fill();
      // body (slightly egg-shaped)
      c.save();
      c.translate(x, y);
      c.scale(1, 1.08);
      var grad = c.createRadialGradient(-r * 0.32, -r * 0.4, r * 0.1, 0, 0, r * 1.15);
      grad.addColorStop(0, bl.col.hi);
      grad.addColorStop(0.5, bl.col.mid);
      grad.addColorStop(1, bl.col.lo);
      c.fillStyle = grad;
      c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.fill();
      c.restore();
      // specular highlight
      c.fillStyle = "rgba(255,255,255,0.55)";
      c.beginPath();
      c.ellipse(x - r * 0.32, y - r * 0.38, r * 0.16, r * 0.26, -0.5, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = "rgba(255,255,255,0.25)";
      c.beginPath();
      c.ellipse(x + r * 0.24, y + r * 0.18, r * 0.1, r * 0.16, -0.4, 0, Math.PI * 2);
      c.fill();
    }
  }

  function clownScale() {
    if (REDMO || bounceT > 0.5) return { sx: 1, sy: 1 };
    var q = squashMag * Math.exp(-bounceT * 12) * Math.cos(bounceT * 22);
    return { sx: 1 + q, sy: 1 - q };
  }

  function drawClown(c) {
    var r = clown.r;
    // motion trail — ghost blobs behind a fast tumble
    if (!REDMO && clownTrail.length > 1) {
      for (var ti = 0; ti < clownTrail.length - 1; ti++) {
        var tp = clownTrail[ti];
        c.save();
        c.globalAlpha = (ti / clownTrail.length) * 0.22;
        c.fillStyle = "#3f86e6";
        c.beginPath(); c.arc(tp.x, tp.y + r * 0.28, r * 0.8, 0, Math.PI * 2); c.fill();
        c.restore();
      }
    }
    var sc = clownScale();
    var blink = invulnT > 0 && Math.floor(invulnT * 12) % 2 === 0;
    var airborne = !held && phase === "play";
    var rot = airborne ? clown.spin : Math.max(-0.4, Math.min(0.4, clown.vx / (H * 1.4)));
    c.save();
    c.translate(clown.x, clown.y);
    c.globalAlpha = blink ? 0.4 : 1;
    c.rotate(rot);
    c.scale(sc.sx, sc.sy);
    clownFigure(c, r, airborne);
    c.restore();
  }

  // the animated clown figure at the origin: kicking legs, flailing/celebrating arms, reactive face
  function clownFigure(c, r, airborne) {
    var lw = clown.limb;
    var raise = clown.tada > 0 || clown.vy < -H * 0.35;   // arms up on launch / while rising
    var wheee = airborne && clown.vy < -H * 0.32;         // open-mouthed on the way up
    var dizzy = airborne && !wheee && clown.spins > 2.4;  // after several somersaults

    // shadow puff (only when roughly upright / on serve)
    if (!airborne) { c.fillStyle = "rgba(0,0,0,0.18)"; c.beginPath(); c.ellipse(0, r * 1.05, r * 0.8, r * 0.28, 0, 0, Math.PI * 2); c.fill(); }

    // --- legs (kick while airborne, dangle on serve) ---
    var legK = airborne ? 0.55 : 0.14;
    var legL = Math.sin(lw) * legK - 0.12, legR = Math.sin(lw + Math.PI) * legK + 0.12;
    c.strokeStyle = "#2f6fd6"; c.lineWidth = r * 0.2; c.lineCap = "round";
    limbSeg(c, -r * 0.26, r * 1.0, r * 0.55, Math.PI * 0.5 + legL, "#ffe08a");   // shoe = yellow
    limbSeg(c, r * 0.26, r * 1.0, r * 0.55, Math.PI * 0.5 + legR, "#ffe08a");

    // --- body (round polka suit) ---
    var bg = c.createRadialGradient(-r * 0.3, -r * 0.2, r * 0.15, 0, 0, r * 1.05);
    bg.addColorStop(0, "#5fa8ff"); bg.addColorStop(1, "#2f6fd6");
    c.fillStyle = bg;
    c.beginPath(); c.arc(0, r * 0.28, r * 0.86, 0, Math.PI * 2); c.fill();
    c.fillStyle = "rgba(255,255,255,0.85)";
    dot(c, -r * 0.36, r * 0.34, r * 0.1); dot(c, r * 0.28, r * 0.5, r * 0.09); dot(c, 0, r * 0.72, r * 0.08);

    // --- arms (raise for tada/wheee, else flail) ---
    var armL = raise ? -Math.PI * 0.78 + Math.sin(lw) * 0.12 : Math.PI * 0.16 + Math.sin(lw) * 0.7;
    var armR = raise ? -Math.PI * 0.22 - Math.sin(lw) * 0.12 : Math.PI * 0.84 - Math.sin(lw + 0.6) * 0.7;
    c.strokeStyle = "#2f6fd6"; c.lineWidth = r * 0.22;
    limbSeg(c, -r * 0.58, r * 0.28, r * 0.5, armL, "#fff");   // white gloves
    limbSeg(c, r * 0.58, r * 0.28, r * 0.5, armR, "#fff");

    // --- ruffle collar ---
    c.fillStyle = "#ffd84a";
    c.beginPath();
    for (var i = 0; i <= 9; i++) { var a = Math.PI + (i / 9) * Math.PI, rr = r * (0.62 + (i % 2 ? 0.16 : 0)); var px = Math.cos(a) * rr, py = -r * 0.12 + Math.sin(a) * rr * 0.5; if (i === 0) c.moveTo(px, py); else c.lineTo(px, py); }
    c.closePath(); c.fill();

    // --- head ---
    c.fillStyle = "#ffe6cf"; c.beginPath(); c.arc(0, -r * 0.5, r * 0.56, 0, Math.PI * 2); c.fill();
    c.fillStyle = "rgba(255,120,120,0.55)"; dot(c, -r * 0.3, -r * 0.42, r * 0.13); dot(c, r * 0.3, -r * 0.42, r * 0.13);

    // --- eyes (expression) ---
    if (dizzy) {                                  // spiral daze
      c.strokeStyle = "#26202b"; c.lineWidth = r * 0.045; c.lineCap = "round";
      for (var s = -1; s <= 1; s += 2) {
        c.beginPath();
        for (var k = 0; k < 22; k++) { var ang = k * 0.5, rad = r * 0.02 + k * r * 0.006; var ex = s * r * 0.18 + Math.cos(ang) * rad, ey = -r * 0.55 + Math.sin(ang) * rad; if (k === 0) c.moveTo(ex, ey); else c.lineTo(ex, ey); }
        c.stroke();
      }
    } else if (wheee) {                           // wide excited eyes
      c.fillStyle = "#fff"; dot(c, -r * 0.18, -r * 0.56, r * 0.12); dot(c, r * 0.18, -r * 0.56, r * 0.12);
      c.fillStyle = "#26202b"; dot(c, -r * 0.18, -r * 0.59, r * 0.06); dot(c, r * 0.18, -r * 0.59, r * 0.06);
    } else {                                      // happy curved eyes
      c.strokeStyle = "#26202b"; c.lineWidth = r * 0.06; c.lineCap = "round";
      c.beginPath(); c.arc(-r * 0.18, -r * 0.53, r * 0.1, Math.PI * 1.15, Math.PI * 1.85); c.stroke();
      c.beginPath(); c.arc(r * 0.18, -r * 0.53, r * 0.1, Math.PI * 1.15, Math.PI * 1.85); c.stroke();
    }

    // --- nose ---
    c.fillStyle = "#ff3b3b"; c.beginPath(); c.arc(0, -r * 0.42, r * 0.13, 0, Math.PI * 2); c.fill();
    c.fillStyle = "rgba(255,255,255,0.6)"; dot(c, -r * 0.03, -r * 0.46, r * 0.04);

    // --- mouth (expression) ---
    if (wheee) {                                  // open "wheee"
      c.fillStyle = "#8a2233"; c.beginPath(); c.ellipse(0, -r * 0.28, r * 0.12, r * 0.16, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = "#ff6f7a"; c.beginPath(); c.ellipse(0, -r * 0.22, r * 0.07, r * 0.06, 0, 0, Math.PI * 2); c.fill();
    } else if (dizzy) {                           // woozy wave
      c.strokeStyle = "#c0392b"; c.lineWidth = r * 0.06; c.lineCap = "round";
      c.beginPath(); c.moveTo(-r * 0.2, -r * 0.3); c.quadraticCurveTo(-r * 0.07, -r * 0.24, 0, -r * 0.3); c.quadraticCurveTo(r * 0.07, -r * 0.36, r * 0.2, -r * 0.3); c.stroke();
    } else {                                      // grin
      c.strokeStyle = "#c0392b"; c.lineWidth = r * 0.07; c.lineCap = "round";
      c.beginPath(); c.arc(0, -r * 0.34, r * 0.22, 0.12 * Math.PI, 0.88 * Math.PI); c.stroke();
    }

    // --- hat + pompom (pom jiggles) ---
    c.fillStyle = "#e6394a";
    c.beginPath(); c.moveTo(-r * 0.4, -r * 0.86); c.lineTo(r * 0.4, -r * 0.86); c.lineTo(0, -r * 1.5); c.closePath(); c.fill();
    c.fillStyle = "rgba(255,255,255,0.5)";
    c.beginPath(); c.moveTo(-r * 0.08, -r * 0.86); c.lineTo(0.02 * r, -r * 0.86); c.lineTo(0, -r * 1.5); c.closePath(); c.fill();
    var pj = Math.sin(lw * 0.9) * r * 0.06;
    c.fillStyle = "#fff"; c.beginPath(); c.arc(pj, -r * 1.52, r * 0.14, 0, Math.PI * 2); c.fill();
  }

  // a limb from a shoulder/hip at (sx,sy), length len, at angle ang, with a round cap "hand/foot" of color capCol
  function limbSeg(c, sx, sy, len, ang, capCol) {
    var ex = sx + Math.cos(ang) * len, ey = sy + Math.sin(ang) * len;
    c.beginPath(); c.moveTo(sx, sy); c.lineTo(ex, ey); c.stroke();
    c.fillStyle = capCol; c.beginPath(); c.arc(ex, ey, c.lineWidth * 0.62, 0, Math.PI * 2); c.fill();
  }

  function dot(c, x, y, r) { c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill(); }

  function drawSeesaw(c, f) {
    var half = paddleHalf;
    var y = f.seesawY;
    var thick = Math.max(9, clown.r * 0.5);
    c.save();
    c.translate(paddleX, y);
    c.rotate(tilt);
    // plank
    var pg = c.createLinearGradient(0, -thick, 0, thick);
    pg.addColorStop(0, "#e0a55a");
    pg.addColorStop(0.5, "#c9863a");
    pg.addColorStop(1, "#9a5f24");
    c.fillStyle = pg;
    roundRect(c, -half, -thick, half * 2, thick * 2, thick * 0.8);
    c.fill();
    // wood grain
    c.strokeStyle = "rgba(120,70,25,0.35)"; c.lineWidth = 1;
    for (var i = -1; i <= 1; i++) {
      c.beginPath(); c.moveTo(-half + 6, i * thick * 0.5); c.lineTo(half - 6, i * thick * 0.5); c.stroke();
    }
    // bright top edge
    c.strokeStyle = "rgba(255,235,190,0.6)"; c.lineWidth = 2;
    c.beginPath(); c.moveTo(-half + 6, -thick + 1.5); c.lineTo(half - 6, -thick + 1.5); c.stroke();
    // stripe caps (circus red tips)
    c.fillStyle = "#d8384a";
    roundRect(c, -half, -thick, half * 0.16, thick * 2, thick * 0.7); c.fill();
    roundRect(c, half - half * 0.16, -thick, half * 0.16, thick * 2, thick * 0.7); c.fill();
    // little clowns riding each end
    tinyClown(c, -half + half * 0.08, -thick - clown.r * 0.5, clown.r * 0.44, "#ffd84a");
    tinyClown(c, half - half * 0.08, -thick - clown.r * 0.5, clown.r * 0.44, "#3fb8c4");
    c.restore();

    // fulcrum triangle
    var fh2 = f.h * 0.075;
    c.save();
    c.translate(paddleX, y + thick + 2);
    var tg = c.createLinearGradient(0, 0, 0, fh2);
    tg.addColorStop(0, "#b23142");
    tg.addColorStop(1, "#6f1c28");
    c.fillStyle = tg;
    c.beginPath();
    c.moveTo(0, -2);
    c.lineTo(fh2 * 0.62, fh2);
    c.lineTo(-fh2 * 0.62, fh2);
    c.closePath(); c.fill();
    c.strokeStyle = "rgba(255,220,160,0.4)"; c.lineWidth = 1.5; c.stroke();
    // gold stud
    c.fillStyle = "#f5c451";
    c.beginPath(); c.arc(0, fh2 * 0.42, fh2 * 0.1, 0, Math.PI * 2); c.fill();
    c.restore();
  }

  function tinyClown(c, x, y, r, hat) {
    c.save();
    c.translate(x, y);
    // body
    c.fillStyle = "#e8e2d0";
    c.beginPath(); c.arc(0, r * 0.5, r * 0.6, 0, Math.PI * 2); c.fill();
    // head
    c.fillStyle = "#ffe6cf";
    c.beginPath(); c.arc(0, -r * 0.3, r * 0.5, 0, Math.PI * 2); c.fill();
    // nose
    c.fillStyle = "#ff3b3b";
    c.beginPath(); c.arc(0, -r * 0.22, r * 0.14, 0, Math.PI * 2); c.fill();
    // hat
    c.fillStyle = hat;
    c.beginPath();
    c.moveTo(-r * 0.42, -r * 0.62);
    c.lineTo(r * 0.42, -r * 0.62);
    c.lineTo(0, -r * 1.2);
    c.closePath(); c.fill();
    c.restore();
  }

  function roundRect(c, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  function drawParts(c) {
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      var a = Math.max(0, 1 - p.t / p.life);
      c.globalAlpha = p.spark ? a : (p.confetti ? Math.min(1, a * 1.6) : a);
      if (p.shred) {
        c.save();
        c.translate(p.x, p.y); c.rotate(p.rot || 0);
        c.fillStyle = p.col;
        c.beginPath();
        c.moveTo(-p.r, 0); c.quadraticCurveTo(0, -p.r * 1.4, p.r, 0);
        c.quadraticCurveTo(0, p.r * 0.6, -p.r, 0); c.fill();
        c.restore();
      } else if (p.confetti) {
        c.save();
        c.translate(p.x, p.y); c.rotate(p.rot || 0);
        c.fillStyle = p.col;
        c.fillRect(-p.r, -p.r * 0.5, p.r * 2, p.r);
        c.restore();
      } else {
        c.fillStyle = p.col;
        c.beginPath(); c.arc(p.x, p.y, p.r, 0, Math.PI * 2); c.fill();
      }
    }
    c.globalAlpha = 1;
  }

  function drawPops(c) {
    c.textAlign = "center";
    for (var i = 0; i < pops.length; i++) {
      var p = pops[i];
      var a = Math.max(0, 1 - p.t / p.life);
      c.globalAlpha = a;
      c.fillStyle = p.col;
      c.font = "800 " + Math.round(clown.r * 0.95) + "px Geist, system-ui, sans-serif";
      c.shadowColor = "rgba(0,0,0,0.4)"; c.shadowBlur = 4;
      c.fillText(p.txt, p.x, p.y);
      c.shadowBlur = 0;
    }
    c.globalAlpha = 1;
  }

  /* -------------------------------------------------------------------- loop */

  var last = 0;
  function frame(t) {
    var dt = Math.min(0.05, (t - last) / 1000); last = t;
    if (running || phase === "over") update(dt);
    render();
    requestAnimationFrame(frame);
  }

  /* ------------------------------------------------------------------- input */

  function fieldPointerX(e) {
    var rect = canvas.getBoundingClientRect();
    return (e.clientX - rect.left);
  }
  function onDown(e) {
    initAudio(); iosUnlock();
    if (phase === "play" || phase === "clear") {
      paddleTargetX = fieldPointerX(e);
      canvas.setPointerCapture && tryCapture(e);
    }
    hideHint();
  }
  function tryCapture(e) { try { canvas.setPointerCapture(e.pointerId); } catch (err) {} }
  function onMove(e) {
    if (phase === "play" || phase === "clear") {
      // move on any pointer move over the canvas (drag on touch, hover on mouse)
      if (COARSE) { if (e.buttons || e.pressure > 0 || e.pointerType === "touch") paddleTargetX = fieldPointerX(e); }
      else paddleTargetX = fieldPointerX(e);
    }
  }
  function onUp() {}

  function onKey(e, down) {
    var k = e.key;
    if (k === "ArrowLeft" || k === "a" || k === "A") { keyL = down; e.preventDefault(); }
    else if (k === "ArrowRight" || k === "d" || k === "D") { keyR = down; e.preventDefault(); }
    else if (down && (k === " " || k === "Enter")) {
      if (phase === "menu" || phase === "over") { start(); e.preventDefault(); }
    }
    else if (down && (k === "m" || k === "M")) { initAudio(); setSound(!soundOn); }
  }

  function hideHint() { if (hintEl) hintEl.classList.add("is-gone"); }

  function setOvKeys() {
    if (phase === "over") { ovKeys.textContent = ""; return; }
    ovKeys.textContent = COARSE ? "Drag anywhere to slide the seesaw" : "← →  or  A D to slide  ·  M mutes";
  }

  /* -------------------------------------------------------------------- boot */

  function resize() {
    DPR = Math.min(2, window.devicePixelRatio || 1);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.floor(W * DPR); canvas.height = Math.floor(H * DPR);
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    bg = null;
    var f = F();
    // keep paddle constraints valid on rotate
    var lo = f.left + paddleHalf, hi = f.right - paddleHalf;
    paddleX = Math.max(lo, Math.min(hi, paddleX || f.cx));
    paddleTargetX = Math.max(lo, Math.min(hi, paddleTargetX || f.cx));
    if (!motes.length) {
      for (var i = 0; i < 26; i++) motes.push({
        x: Math.random() * W, y: f.topPad + Math.random() * H * 0.75,
        vy: -(4 + Math.random() * 9), r: 0.7 + Math.random() * 1.6,
        a: 0.06 + Math.random() * 0.22, ph: Math.random() * 6.28
      });
    }
  }

  window.addEventListener("resize", resize);
  window.addEventListener("orientationchange", function () { setTimeout(resize, 120); setTimeout(resize, 400); });

  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);

  soundBtn.addEventListener("click", function () { initAudio(); iosUnlock(); setSound(!soundOn); });
  ovBtn.addEventListener("click", start);
  window.addEventListener("keydown", function (e) { onKey(e, true); });
  window.addEventListener("keyup", function (e) { onKey(e, false); });
  document.addEventListener("visibilitychange", function () { last = performance.now(); });

  setOvKeys();
  setSound(soundOn);
  syncHud();
  resize();
  requestAnimationFrame(frame);
})();
