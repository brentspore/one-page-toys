/* Brick Smasher — No. 101
 * Breakout in a well of neon glass. Vanilla Canvas 2D + Web Audio, no deps.
 *
 * The parts that matter for feel:
 *  - the paddle steers by contact point (Arkanoid-style), not fixed angles, and
 *    a moving paddle adds a little english on top;
 *  - the ball is swept in substeps sized to the brick grid, so it can never
 *    tunnel through a brick or the paddle no matter how fast it gets;
 *  - |vy| has a floor after every bounce, which is what stops the classic
 *    death spiral of a ball skimming sideways between the rails forever;
 *  - the brick field is cached to an offscreen canvas and only redrawn when a
 *    brick changes, which buys the per-brick glow.
 * localStorage: "bricksmash_best" (score), "bricksmash_sound", "bricksmash_runs".
 *
 * This is the FEEDER edition: unlimited practice, with the daily wall, streaks
 * and stats living at bricksmasher.com. No email capture here — that stays on
 * the game's own domain. */
(function () {
  "use strict";

  var TAU = Math.PI * 2;

  // ---------------------------------------------------------------- elements
  var canvas = document.getElementById("canvas");
  var ctx = canvas.getContext("2d");
  var hud = document.getElementById("hud");
  var scoreEl = document.getElementById("score");
  var livesEl = document.getElementById("lives");
  var levelEl = document.getElementById("level");
  var bestEl = document.getElementById("best");
  var overlay = document.getElementById("overlay");
  var ovEyebrow = document.getElementById("ovEyebrow");
  var ovTitle = document.getElementById("ovTitle");
  var ovText = document.getElementById("ovText");
  var ovBtn = document.getElementById("ovBtn");
  var ovKeys = document.getElementById("ovKeys");
  var hint = document.getElementById("hint");
  var soundBtn = document.getElementById("soundBtn");
  var dailyEl = document.getElementById("daily");
  var dailyTime = document.getElementById("dailyTime");
  var cta = document.getElementById("cta");
  var ctaLine = document.getElementById("ctaLine");
  var ctaBtn = document.getElementById("ctaBtn");

  var REDMO = false;
  try { REDMO = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) {}

  // ------------------------------------------------------------------ tuning
  var COLS = 11;
  var START_LIVES = 3;
  var BASE_SPEED = 0.66;     // well-heights per second at level 1
  var MAX_ANGLE = 1.06;      // paddle steering half-range, radians (~61°)
  var MIN_RISE = 0.34;       // radians off horizontal the ball must keep
  var MIN_SIDE = 0.14;       // ...and off vertical, so it never pistons a column
  var DROP_CHANCE = 0.16;    // capsules per brick destroyed
  var MAX_CAPS = 3;
  var LASER_COOL = 0.19;     // seconds between bolts
  var LASER_AMMO = 16;
  var SERVE_WAIT = 1.8;      // auto-launch after this long on the paddle

  // ------------------------------------------------------------------- state
  var state = "menu";        // menu | serve | play | clear | dead | over
  var score = 0, best = 0, level = 1, lives = START_LIVES;
  var combo = 0, comboBestRun = 0, padHits = 0, bricksSmashed = 0;
  var serveT = 0, clearT = 0, deadT = 0;
  var shake = 0, flash = 0, flashCol = "#6ee7ff", pulse = 0, drift = 0;
  var banner = null;
  var bestBumped = false;

  var bricks = [], aliveCount = 0, rows = 0;
  var balls = [], caps = [], bolts = [], shards = [], sparks = [], floaters = [];
  var pw = { wide: 0, laser: 0, slow: 0 };
  var laserAmmo = 0, laserCool = 0;

  var pad = { x: 0, y: 0, w: 0, wTarget: 0, h: 0, vx: 0, px: 0 };

  var dpr = 1, W = 0, H = 0;
  var bx = 0, by = 0, bw = 0, bh = 0;          // the well's interior box
  var cellW = 0, cellH = 0, fieldTop = 0, gut = 0, ballR = 0;
  var fieldCv = null, fctx = null, fieldPad = 0, fieldDirty = true;
  var gridCv = null;
  var last = 0;

  var keyL = false, keyR = false, firing = false;
  var dragId = null, dragX = 0, dragPadX = 0, dragMoved = 0;

  // ------------------------------------------------------------ persistence
  var soundOn = true;
  try { best = parseInt(localStorage.getItem("bricksmash_best") || "0", 10) || 0; } catch (e) {}
  try { if (localStorage.getItem("bricksmash_sound") === "0") soundOn = false; } catch (e) {}
  var runs = 0;
  try { runs = parseInt(localStorage.getItem("bricksmash_runs") || "0", 10) || 0; } catch (e) {}
  bestEl.textContent = best;

  // -------------------------------------------------------------------- util
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function hyp(x, y) { return Math.sqrt(x * x + y * y); }
  function hsl(h, s, l, a) {
    return "hsla(" + h + "," + s + "%," + l + "%," + (a == null ? 1 : a) + ")";
  }

  // ================================================================== LEVELS
  // 11 wide. 1-5 = glass tiers (one hit, worth more the higher the tier),
  // A = armoured (two hits), S = steel (never breaks, and never blocks a clear).
  var LEVELS = [
    [ // 1 — Rungs: the classic wall, nothing in the way
      "55555555555",
      "44444444444",
      "33333333333",
      "22222222222",
      "11111111111"
    ],
    [ // 2 — Pyramid: the shoulders are easy, the cap needs an angle
      ".....5.....",
      "....555....",
      "...44444...",
      "..3333333..",
      ".222222222.",
      "11111111111"
    ],
    [ // 3 — Vault: armour on the shell, a hollow you can get trapped inside
      "AA5555555AA",
      "A555555555A",
      "A4.......4A",
      "A4.33333.4A",
      "A44.....44A",
      "AA22222222A"
    ],
    [ // 4 — Weave: sparse, so the ball threads through instead of chewing rows
      "5.5.5.5.5.5",
      ".4.4.4.4.4.",
      "3.3.3.3.3.3",
      ".2.2.2.2.2.",
      "1.1.1.1.1.1"
    ],
    [ // 5 — Wings: two towers with a corridor straight up the middle
      "555.....555",
      "4444...4444",
      "33333.33333",
      "A222222222A",
      ".111111111."
    ],
    [ // 6 — Citadel: steel pillars you have to shoot around
      "S.........S",
      ".AAAAAAAAA.",
      "S.5555555.S",
      ".A4444444A.",
      "S.3333333.S",
      ".222222222."
    ]
  ];

  // tier -> hue/saturation/value. Cool at the bottom, hot at the top.
  var TIERS = {
    "1": { h: 193, s: 100, v: 10 },
    "2": { h: 163, s: 84, v: 20 },
    "3": { h: 42, s: 100, v: 30 },
    "4": { h: 22, s: 100, v: 40 },
    "5": { h: 337, s: 100, v: 50 },
    "A": { h: 258, s: 72, v: 70, hp: 2 },
    "S": { h: 215, s: 12, v: 0, steel: true }
  };

  // ================================================================== AUDIO
  var AC = null, outGain = null, noiseBuf = null, verbSend = null, dlySend = null;
  var roomSrc = null;

  function initAudio() {
    if (AC) return;
    try { AC = new (window.AudioContext || window.webkitAudioContext)(); }
    catch (e) { AC = null; return; }

    outGain = AC.createGain();
    outGain.gain.value = soundOn ? 1 : 0;

    var lp = AC.createBiquadFilter();
    lp.type = "lowpass"; lp.frequency.value = 14200; lp.Q.value = 0.5;

    var comp = AC.createDynamicsCompressor();
    comp.threshold.value = -15; comp.knee.value = 26; comp.ratio.value = 3;
    comp.attack.value = 0.003; comp.release.value = 0.22;

    // the hall the whole cabinet sits in
    var verb = AC.createConvolver();
    verb.buffer = makeImpulse(2.1, 3.1);
    var vg = AC.createGain(); vg.gain.value = 0.9;
    verbSend = AC.createGain(); verbSend.gain.value = 0.3;
    var hp = AC.createBiquadFilter();
    hp.type = "highpass"; hp.frequency.value = 240;   // keep the lows out of the tail
    var shelf = AC.createBiquadFilter();
    shelf.type = "highshelf"; shelf.frequency.value = 5200; shelf.gain.value = 4;

    // a short repeat that also feeds the hall, so glass hits bloom outward
    var dly = AC.createDelay(1.0);
    dly.delayTime.value = 0.263;
    var fb = AC.createGain(); fb.gain.value = 0.27;
    var dlyLp = AC.createBiquadFilter();
    dlyLp.type = "lowpass"; dlyLp.frequency.value = 3400;
    dlySend = AC.createGain(); dlySend.gain.value = 0.2;

    var master = AC.createGain(); master.gain.value = 0.92;

    outGain.connect(lp); lp.connect(comp);

    outGain.connect(verbSend); verbSend.connect(hp); hp.connect(verb);
    verb.connect(shelf); shelf.connect(vg); vg.connect(comp);

    outGain.connect(dlySend); dlySend.connect(dly);
    dly.connect(dlyLp); dlyLp.connect(fb); fb.connect(dly);
    dlyLp.connect(comp);
    dlyLp.connect(verbSend);

    comp.connect(master); master.connect(AC.destination);

    var len = Math.floor(AC.sampleRate * 2);
    noiseBuf = AC.createBuffer(1, len, AC.sampleRate);
    var d = noiseBuf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  function makeImpulse(dur, decay) {
    var rate = AC.sampleRate, len = Math.max(1, Math.floor(rate * dur));
    var buf = AC.createBuffer(2, len, rate);
    for (var ch = 0; ch < 2; ch++) {
      var d = buf.getChannelData(ch), prev = 0;
      for (var i = 0; i < len; i++) {
        var t = i / len, env = Math.pow(1 - t, decay);
        // low-passed noise: a raw-noise tail sounds gritty, not like a room
        prev = prev + 0.28 * ((Math.random() * 2 - 1) - prev);
        d[i] = prev * env;
      }
    }
    return buf;
  }

  // the cabinet's own hum — barely there, but the room sounds switched on
  function startRoom() {
    if (!AC || roomSrc || !noiseBuf) return;
    roomSrc = AC.createBufferSource();
    roomSrc.buffer = noiseBuf;
    roomSrc.loop = true;
    var f = AC.createBiquadFilter();
    f.type = "lowpass"; f.frequency.value = 340; f.Q.value = 0.6;
    var g = AC.createGain(); g.gain.value = 0.0001;
    roomSrc.connect(f); f.connect(g); g.connect(outGain);
    roomSrc.start(0);
    g.gain.setTargetAtTime(0.03, AC.currentTime, 0.9);

    [82.4, 82.9].forEach(function (fq) {
      var o = AC.createOscillator();
      o.type = "sine"; o.frequency.value = fq;
      var og = AC.createGain(); og.gain.value = 0.0001;
      o.connect(og); og.connect(outGain);
      o.start(0);
      og.gain.setTargetAtTime(0.012, AC.currentTime, 1.4);
    });
  }

  function unlockAudio() {
    initAudio();
    if (!AC) return;
    if (AC.state === "suspended") AC.resume();
    try {
      var b = AC.createBuffer(1, 1, 22050), s = AC.createBufferSource();
      s.buffer = b; s.connect(AC.destination); s.start(0);
    } catch (e) {}
    startRoom();
  }
  function now() { return AC ? AC.currentTime : 0; }
  function panOf(x) { return clamp((x - (bx + bw / 2)) / (bw * 0.62), -0.85, 0.85); }

  function tone(o) {
    if (!AC) return;
    var t = now() + (o.at || 0);
    var osc = AC.createOscillator();
    osc.type = o.type || "sine";
    osc.frequency.setValueAtTime(o.f, t);
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f2), t + (o.dur || 0.3));
    if (o.detune) osc.detune.value = o.detune;
    var g = AC.createGain();
    var a = o.a != null ? o.a : 0.004, d = o.dur || 0.3, peak = o.g != null ? o.g : 0.2;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
    var node = osc;
    if (o.filt) {
      var f = AC.createBiquadFilter();
      f.type = o.filt; f.frequency.setValueAtTime(o.filtF || 2000, t);
      if (o.filtF2) f.frequency.exponentialRampToValueAtTime(o.filtF2, t + a + d);
      if (o.filtQ) f.Q.value = o.filtQ;
      node.connect(f); node = f;
    }
    node.connect(g);
    if (o.pan != null && AC.createStereoPanner) {
      var p = AC.createStereoPanner(); p.pan.value = clamp(o.pan, -1, 1);
      g.connect(p); p.connect(outGain);
    } else g.connect(outGain);
    osc.start(t); osc.stop(t + a + d + 0.06);
  }

  function noise(o) {
    if (!AC || !noiseBuf) return;
    var t = now() + (o.at || 0), dur = o.dur || 0.1;
    var s = AC.createBufferSource();
    s.buffer = noiseBuf;
    var f = AC.createBiquadFilter();
    f.type = o.filt || "bandpass";
    f.frequency.setValueAtTime(o.f || 1800, t);
    if (o.f2) f.frequency.exponentialRampToValueAtTime(Math.max(40, o.f2), t + dur);
    if (o.Q) f.Q.value = o.Q;
    var g = AC.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.g != null ? o.g : 0.16), t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g);
    if (o.pan != null && AC.createStereoPanner) {
      var p = AC.createStereoPanner(); p.pan.value = clamp(o.pan, -1, 1);
      g.connect(p); p.connect(outGain);
    } else g.connect(outGain);
    s.start(t, rnd(0, 1)); s.stop(t + dur + 0.05);
  }

  // A-minor pentatonic climbing two octaves: the combo walks up it, so a long
  // chain is literally a rising melodic run. That's the addictive part.
  var SCALE = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22, 24, 27];

  function sndBrick(idx, pan) {
    if (!soundOn) return;
    var f0 = 246.9 * Math.pow(2, SCALE[clamp(idx, 0, SCALE.length - 1)] / 12);
    // struck glass: a bright tick, then a short inharmonic ring
    noise({ filt: "bandpass", f: 6200, Q: 1.6, dur: 0.014, g: 0.15, pan: pan });
    var parts = [1, 2.68, 5.42, 8.1];
    var gains = [0.2, 0.1, 0.055, 0.03];
    for (var i = 0; i < parts.length; i++) {
      tone({
        type: "sine", f: f0 * parts[i], dur: 0.34 / (1 + i * 0.75),
        a: 0.002, g: gains[i], pan: pan, detune: i ? rnd(-6, 6) : 0
      });
    }
  }

  function sndArmor(pan) {
    if (!soundOn) return;
    noise({ filt: "bandpass", f: 1400, f2: 700, Q: 1.1, dur: 0.07, g: 0.13, pan: pan });
    tone({ type: "triangle", f: 168, f2: 132, dur: 0.11, a: 0.002, g: 0.16, pan: pan });
    tone({ type: "sine", f: 168 * 1.83, dur: 0.07, a: 0.002, g: 0.06, pan: pan });
  }

  function sndSteel(pan) {
    if (!soundOn) return;
    noise({ filt: "bandpass", f: 3100, Q: 2.4, dur: 0.05, g: 0.1, pan: pan });
    tone({ type: "square", f: 320, f2: 250, dur: 0.06, a: 0.001, g: 0.05, filt: "bandpass", filtF: 2400, filtQ: 4, pan: pan });
  }

  // the pane actually letting go — a spray of shard grains over the ring
  function sndShatter(pan) {
    if (!soundOn) return;
    for (var i = 0; i < 6; i++) {
      noise({
        filt: "bandpass", f: rnd(2400, 7600), Q: rnd(2, 5),
        dur: rnd(0.018, 0.045), g: rnd(0.03, 0.07), at: i * rnd(0.004, 0.016), pan: pan + rnd(-0.12, 0.12)
      });
    }
  }

  function sndPaddle(v, pan) {
    if (!soundOn) return;
    v = clamp(v, 0.3, 1);
    noise({ filt: "lowpass", f: 900, dur: 0.028, g: 0.1 * v, pan: pan });
    tone({ type: "sine", f: 194, f2: 118, dur: 0.075, a: 0.001, g: 0.2 * v, pan: pan });
    tone({ type: "triangle", f: 388, dur: 0.035, a: 0.001, g: 0.05 * v, pan: pan });
  }

  function sndWall(pan) {
    if (!soundOn) return;
    noise({ filt: "bandpass", f: 3300, Q: 2.2, dur: 0.012, g: 0.07, pan: pan });
    tone({ type: "sine", f: 640, f2: 480, dur: 0.035, a: 0.001, g: 0.05, pan: pan });
  }

  function sndPower(pan) {
    if (!soundOn) return;
    var steps = [0, 4, 7, 11];
    for (var i = 0; i < steps.length; i++) {
      var f = 523.25 * Math.pow(2, steps[i] / 12);
      tone({ type: "triangle", f: f, dur: 0.3, a: 0.004, g: 0.075, at: i * 0.055, pan: pan });
      tone({ type: "sine", f: f * 2, dur: 0.18, a: 0.003, g: 0.028, at: i * 0.055, pan: pan });
    }
    noise({ filt: "highpass", f: 5200, dur: 0.22, g: 0.03, pan: pan });
  }

  function sndLaser(pan) {
    if (!soundOn) return;
    tone({ type: "sawtooth", f: 1500, f2: 240, dur: 0.09, a: 0.001, g: 0.09,
           filt: "lowpass", filtF: 4200, filtF2: 700, filtQ: 6, pan: pan });
    noise({ filt: "bandpass", f: 4200, f2: 1200, Q: 1.4, dur: 0.07, g: 0.045, pan: pan });
  }

  function sndLoss() {
    if (!soundOn) return;
    for (var i = 0; i < 2; i++) {
      tone({ type: "sawtooth", f: 196, f2: 62, dur: 0.9, a: 0.01, g: 0.085, detune: i ? 11 : -11,
             filt: "lowpass", filtF: 900, filtF2: 220, filtQ: 3 });
    }
    tone({ type: "sine", f: 88, f2: 44, dur: 0.7, a: 0.008, g: 0.15 });
    noise({ filt: "lowpass", f: 1200, f2: 200, dur: 0.4, g: 0.05 });
  }

  function sndClear() {
    if (!soundOn) return;
    var steps = [0, 3, 5, 7, 10, 12, 15, 19];
    for (var i = 0; i < steps.length; i++) {
      var f = 329.6 * Math.pow(2, steps[i] / 12);
      tone({ type: "triangle", f: f, dur: 0.85, a: 0.006, g: 0.085, at: i * 0.075, pan: (i / steps.length - 0.5) * 0.7 });
      tone({ type: "sine", f: f * 2, dur: 0.5, a: 0.004, g: 0.03, at: i * 0.075 });
    }
    noise({ filt: "highpass", f: 6000, dur: 0.9, g: 0.03, at: 0.05 });
  }

  function sndOver() {
    if (!soundOn) return;
    var steps = [12, 8, 5, 0, -4];
    for (var i = 0; i < steps.length; i++) {
      var f = 220 * Math.pow(2, steps[i] / 12);
      tone({ type: "triangle", f: f, dur: 1.1, a: 0.012, g: 0.075, at: i * 0.16 });
      tone({ type: "sine", f: f / 2, dur: 0.9, a: 0.01, g: 0.05, at: i * 0.16 });
    }
  }

  soundBtn.addEventListener("click", function () {
    soundOn = !soundOn;
    soundBtn.setAttribute("aria-pressed", soundOn ? "true" : "false");
    try { localStorage.setItem("bricksmash_sound", soundOn ? "1" : "0"); } catch (e) {}
    if (outGain && AC) {
      try { outGain.gain.setTargetAtTime(soundOn ? 1 : 0, now(), 0.02); }
      catch (e) { outGain.gain.value = soundOn ? 1 : 0; }
    }
    unlockAudio();
  });
  soundBtn.setAttribute("aria-pressed", soundOn ? "true" : "false");

  // ================================================================= SIZING
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // The well wants to be tall. On a phone it takes the width it can get; on a
    // wide desktop it stays a portrait box in the middle rather than stretching
    // the paddle's run to something unplayable.
    // The 1.72 cap is not arbitrary: any taller and the well's bottom corners
    // run into the docked tip-jar / fullscreen badges on a phone.
    var maxW = W * 0.95, maxH = H * 0.82;
    var ratio = clamp(maxH / maxW, 1.12, 1.72);
    bw = Math.min(maxW, maxH / ratio);
    bh = bw * ratio;
    bx = (W - bw) / 2;
    by = (H - bh) / 2 + Math.min(6, H * 0.008);

    cellW = bw / COLS;
    // Height comes off the WELL, not the brick width: on a tall phone the well
    // is nearly twice as long as it is wide, and a width-derived brick left the
    // wall as a thin ribbon floating at the top of a lot of nothing.
    cellH = clamp(bh * 0.036, cellW * 0.42, cellW * 0.72);
    gut = cellW * 0.075;
    fieldTop = by + bh * 0.085;
    ballR = Math.max(4.2, bw * 0.0135);

    pad.h = Math.max(8, bw * 0.026);
    pad.y = by + bh - bh * 0.055;
    pad.wTarget = bw * 0.16 * (pw.wide > 0 ? 1.55 : 1);
    if (!pad.w) pad.w = pad.wTarget;
    pad.x = clamp(pad.x || bx + bw / 2, bx + pad.w / 2, bx + bw - pad.w / 2);

    layoutBricks();
    buildGrid();
    buildField();

    // keep everything inside the well after a rotation
    for (var i = 0; i < balls.length; i++) {
      var b = balls[i];
      b.r = ballR;
      b.x = clamp(b.x, bx + ballR, bx + bw - ballR);
      b.y = clamp(b.y, by + ballR, by + bh - ballR);
    }
  }
  window.addEventListener("resize", resize);
  window.addEventListener("orientationchange", function () {
    resize(); setTimeout(resize, 180); setTimeout(resize, 520);
  });

  // bricks keep grid coordinates, so a resize just re-derives their boxes
  function layoutBricks() {
    for (var i = 0; i < bricks.length; i++) {
      var b = bricks[i];
      b.x = bx + b.col * cellW + gut / 2;
      b.y = fieldTop + b.row * cellH + gut / 2;
      b.w = cellW - gut;
      b.h = cellH - gut;
    }
  }

  // a slow-drifting dot lattice behind everything, for depth
  function buildGrid() {
    var step = Math.max(22, bw * 0.062);
    var cv = document.createElement("canvas");
    cv.width = Math.round(step * dpr); cv.height = Math.round(step * dpr);
    var c = cv.getContext("2d");
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = "rgba(150,180,255,0.13)";
    c.beginPath(); c.arc(step / 2, step / 2, Math.max(0.7, step * 0.022), 0, TAU); c.fill();
    gridCv = { cv: cv, step: step };
  }

  // ============================================================ BRICK FIELD
  function buildLevel(n) {
    var layout = LEVELS[(n - 1) % LEVELS.length];
    rows = layout.length;
    bricks = [];
    aliveCount = 0;
    // every third cycle through the layouts, another row hardens into armour
    var extra = Math.floor((n - 1) / LEVELS.length);
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < COLS; c++) {
        var ch = layout[r].charAt(c);
        if (ch === "." || !TIERS[ch]) continue;
        var t = TIERS[ch];
        if (extra > 0 && !t.steel && r < extra && ch !== "A") { ch = "A"; t = TIERS.A; }
        var hp = t.steel ? Infinity : (t.hp || 1);
        bricks.push({
          col: c, row: r, x: 0, y: 0, w: 0, h: 0,
          h0: t.h, s0: t.s, value: t.v, hp: hp, maxhp: hp,
          steel: !!t.steel, alive: true, seed: (r * 31 + c * 17) % 97
        });
        if (!t.steel) aliveCount++;
      }
    }
    layoutBricks();
    fieldDirty = true;
  }

  function buildField() {
    fieldPad = Math.max(10, cellH * 1.3);
    var fw = Math.ceil(bw + fieldPad * 2);
    var fh = Math.ceil(rows * cellH + fieldPad * 2);
    if (fh <= 0 || fw <= 0) return;
    if (!fieldCv) { fieldCv = document.createElement("canvas"); fctx = fieldCv.getContext("2d"); }
    fieldCv.width = Math.round(fw * dpr);
    fieldCv.height = Math.round(fh * dpr);
    fieldDirty = true;
  }

  function drawField() {
    if (!fieldCv) return;
    fctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    fctx.clearRect(0, 0, fieldCv.width / dpr, fieldCv.height / dpr);
    for (var i = 0; i < bricks.length; i++) {
      var b = bricks[i];
      if (!b.alive) continue;
      drawBrick(fctx, b, b.x - bx + fieldPad, b.y - fieldTop + fieldPad);
    }
    fieldDirty = false;
  }

  function drawBrick(c, b, x, y) {
    var w = b.w, h = b.h, r = Math.min(h * 0.3, 6);
    var hurt = b.maxhp > 1 && b.hp < b.maxhp && !b.steel;
    var lTop = b.steel ? 44 : hurt ? 46 : 64;
    var lBot = b.steel ? 20 : hurt ? 20 : 28;

    // the glow the brick throws onto the black behind it
    c.save();
    c.shadowColor = hsl(b.h0, b.s0, b.steel ? 40 : 60, b.steel ? 0.3 : 0.62);
    c.shadowBlur = h * (b.steel ? 0.5 : 1.05);
    c.fillStyle = hsl(b.h0, b.s0, lBot, 0.95);
    roundRect(c, x, y, w, h, r);
    c.fill();
    c.restore();

    // glass body
    var g = c.createLinearGradient(x, y, x, y + h);
    g.addColorStop(0, hsl(b.h0, b.s0, lTop, 0.97));
    g.addColorStop(0.42, hsl(b.h0, b.s0, lTop - 18, 0.95));
    g.addColorStop(1, hsl(b.h0, b.s0, lBot, 0.97));
    c.fillStyle = g;
    roundRect(c, x, y, w, h, r);
    c.fill();

    // top-face specular + a bright inner edge, so it reads as a slab not a card
    c.save();
    roundRect(c, x, y, w, h, r);
    c.clip();
    var sg = c.createLinearGradient(x, y, x, y + h * 0.5);
    sg.addColorStop(0, "rgba(255,255,255," + (b.steel ? 0.3 : 0.42) + ")");
    sg.addColorStop(1, "rgba(255,255,255,0)");
    c.fillStyle = sg;
    c.fillRect(x, y, w, h * 0.5);
    if (b.steel) {
      // machined ribs
      c.strokeStyle = "rgba(255,255,255,0.09)";
      c.lineWidth = Math.max(1, h * 0.06);
      for (var k = 0; k < 4; k++) {
        c.beginPath();
        c.moveTo(x + w * (0.2 + k * 0.2), y);
        c.lineTo(x + w * (0.1 + k * 0.2), y + h);
        c.stroke();
      }
    } else if (b.maxhp > 1) {
      // armour rivets
      c.fillStyle = "rgba(255,255,255,0.22)";
      for (var q = 0; q < 2; q++) {
        c.beginPath();
        c.arc(x + w * (0.16 + q * 0.68), y + h * 0.5, Math.max(1, h * 0.09), 0, TAU);
        c.fill();
      }
    }
    c.restore();

    c.strokeStyle = hsl(b.h0, b.s0, b.steel ? 62 : 82, 0.62);
    c.lineWidth = Math.max(1, h * 0.055);
    roundRect(c, x + 0.5, y + 0.5, w - 1, h - 1, r);
    c.stroke();

    if (hurt) drawCracks(c, b, x, y, w, h);
  }

  // deterministic per brick, so a cracked brick doesn't shimmer between frames
  function drawCracks(c, b, x, y, w, h) {
    var s = b.seed;
    c.save();
    roundRect(c, x, y, w, h, Math.min(h * 0.3, 6));
    c.clip();
    c.strokeStyle = "rgba(255,255,255,0.7)";
    c.lineWidth = Math.max(0.8, h * 0.055);
    c.lineCap = "round";
    for (var i = 0; i < 3; i++) {
      var a = ((s * 37 + i * 53) % 360) * Math.PI / 180;
      var cx = x + w * (0.34 + ((s + i * 13) % 30) / 100);
      var cy = y + h * 0.5;
      c.beginPath();
      c.moveTo(cx, cy);
      var px = cx, py = cy;
      for (var j = 0; j < 3; j++) {
        a += (((s + i * 7 + j * 11) % 100) / 100 - 0.5) * 1.5;
        px += Math.cos(a) * w * 0.19;
        py += Math.sin(a) * h * 0.34;
        c.lineTo(px, py);
      }
      c.stroke();
    }
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

  // ================================================================== INPUT
  function pointAt(e) {
    var r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  function movePad(x) {
    pad.x = clamp(x, bx + pad.w / 2, bx + bw - pad.w / 2);
  }

  canvas.addEventListener("pointerdown", function (e) {
    unlockAudio();
    if (state === "menu" || state === "over") return;
    try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
    dragId = e.pointerId;
    dragX = pointAt(e).x;
    dragPadX = pad.x;
    dragMoved = 0;
    hint.classList.add("is-gone");
    // A mouse steers absolutely — the cursor IS the paddle. A finger steers
    // relatively, otherwise your thumb has to sit on the paddle and cover the
    // one part of the well you need to watch.
    if (e.pointerType === "mouse") movePad(dragX);
    if (pw.laser > 0 && laserAmmo > 0) { firing = true; fireLaser(); }
  });

  canvas.addEventListener("pointermove", function (e) {
    if (state === "menu" || state === "over") return;
    var p = pointAt(e);
    if (e.pointerType === "mouse") { movePad(p.x); return; }
    if (dragId === null || e.pointerId !== dragId) return;
    dragMoved += Math.abs(p.x - dragX);
    movePad(dragPadX + (p.x - dragX) * 1.32);
  });

  function endDrag(e) {
    if (dragId !== null && e.pointerId === dragId) {
      // a tap (rather than a drag) launches a waiting ball
      if (state === "serve" && dragMoved < 14) launch();
      dragId = null;
    }
    firing = false;
  }
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);

  window.addEventListener("keydown", function (e) {
    if (e.code === "ArrowLeft" || e.key === "a" || e.key === "A") { keyL = true; e.preventDefault(); }
    if (e.code === "ArrowRight" || e.key === "d" || e.key === "D") { keyR = true; e.preventDefault(); }
    if (e.code === "Space" || e.key === " ") {
      e.preventDefault();
      unlockAudio();
      if (state === "menu" || state === "over") { ovBtn.click(); return; }
      if (state === "serve") launch();
      else if (pw.laser > 0 && laserAmmo > 0) { firing = true; fireLaser(); }
      hint.classList.add("is-gone");
    }
  });
  window.addEventListener("keyup", function (e) {
    if (e.code === "ArrowLeft" || e.key === "a" || e.key === "A") keyL = false;
    if (e.code === "ArrowRight" || e.key === "d" || e.key === "D") keyR = false;
    if (e.code === "Space" || e.key === " ") firing = false;
  });
  window.addEventListener("blur", function () { keyL = keyR = false; firing = false; dragId = null; });

  // ================================================================== SPEED
  function curSpeed() {
    var lvl = Math.min(1 + (level - 1) * 0.075, 1.5);
    var hit = Math.min(1 + Math.floor(padHits / 9) * 0.06, 1.28);
    return bh * BASE_SPEED * lvl * hit * (pw.slow > 0 ? 0.72 : 1);
  }

  function newBall(x, y, ang, stuck) {
    var sp = curSpeed();
    return {
      x: x, y: y, r: ballR, stuck: !!stuck,
      vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
      hue: 193, trail: []
    };
  }

  function launch() {
    var launched = false;
    for (var i = 0; i < balls.length; i++) {
      if (!balls[i].stuck) continue;
      balls[i].stuck = false;
      var ang = -Math.PI / 2 + rnd(-0.34, 0.34) + clamp(pad.vx / (bw * 3), -0.2, 0.2);
      var sp = curSpeed();
      balls[i].vx = Math.cos(ang) * sp;
      balls[i].vy = Math.sin(ang) * sp;
      launched = true;
    }
    if (launched) {
      state = "play";
      serveT = 0;
      sndPaddle(0.6, panOf(pad.x));
      hint.classList.add("is-gone");
    }
  }

  // ================================================================ PHYSICS
  function stepBalls(dt) {
    var maxSp = 0;
    for (var i = 0; i < balls.length; i++) {
      if (balls[i].stuck) continue;
      maxSp = Math.max(maxSp, hyp(balls[i].vx, balls[i].vy));
    }
    // never let a ball travel more than a fraction of a brick per substep —
    // that's what makes tunnelling structurally impossible rather than unlikely
    var sub = clamp(Math.ceil((maxSp * dt) / (Math.min(cellH, pad.h) * 0.42)), 1, 32);
    var h = dt / sub;
    for (var s = 0; s < sub; s++) {
      for (var b = balls.length - 1; b >= 0; b--) {
        var ball = balls[b];
        if (ball.stuck) continue;
        moveBall(ball, h);
        if (ball.dead) balls.splice(b, 1);
      }
    }
  }

  function moveBall(b, h) {
    var py = b.y;
    b.x += b.vx * h;
    b.y += b.vy * h;

    // side rails
    if (b.x - b.r < bx) { b.x = bx + b.r; b.vx = Math.abs(b.vx); wallHit(b); }
    else if (b.x + b.r > bx + bw) { b.x = bx + bw - b.r; b.vx = -Math.abs(b.vx); wallHit(b); }
    // ceiling
    if (b.y - b.r < by) { b.y = by + b.r; b.vy = Math.abs(b.vy); wallHit(b); }

    hitBricks(b);
    hitPaddle(b, py);

    // out of the bottom
    if (b.y - b.r > by + bh) b.dead = true;
  }

  function wallHit(b) {
    enforceRise(b);
    sndWall(panOf(b.x));
    burst(b.x, b.y, 3, hsl(b.hue, 90, 70), 0.4);
  }

  // Both degenerate paths are dead ends, so both get a floor:
  //  - too flat and the ball rattles between the rails forever;
  //  - dead vertical and it pistons up and down the same column, which a
  //    centred paddle will happily sustain until the player gives up.
  // A few degrees is enough to guarantee drift and is invisible in play.
  function enforceRise(b) {
    var sp = hyp(b.vx, b.vy);
    if (sp < 0.0001) return;
    var sy = b.vy / sp, sx = b.vx / sp;
    var minS = Math.sin(MIN_RISE), minC = Math.sin(MIN_SIDE);
    if (Math.abs(sy) < minS) {
      b.vy = (sy < 0 ? -1 : 1) * minS * sp;
      b.vx = (sx < 0 ? -1 : 1) * Math.cos(MIN_RISE) * sp;
    } else if (Math.abs(sx) < minC) {
      b.vx = (sx < 0 ? -1 : 1) * minC * sp;
      b.vy = (sy < 0 ? -1 : 1) * Math.cos(MIN_SIDE) * sp;
    }
  }

  function hitBricks(b) {
    if (!bricks.length) return;
    // only the cells the ball's box can reach
    var c0 = Math.floor((b.x - b.r - bx) / cellW) - 1;
    var c1 = Math.floor((b.x + b.r - bx) / cellW) + 1;
    var r0 = Math.floor((b.y - b.r - fieldTop) / cellH) - 1;
    var r1 = Math.floor((b.y + b.r - fieldTop) / cellH) + 1;
    if (r1 < 0 || r0 > rows) return;

    for (var i = 0; i < bricks.length; i++) {
      var k = bricks[i];
      if (!k.alive || k.col < c0 || k.col > c1 || k.row < r0 || k.row > r1) continue;

      var nx = clamp(b.x, k.x, k.x + k.w);
      var ny = clamp(b.y, k.y, k.y + k.h);
      var dx = b.x - nx, dy = b.y - ny;
      var d2 = dx * dx + dy * dy;
      if (d2 > b.r * b.r) continue;

      var ux, uy, push;
      if (d2 > 0.000001) {
        var d = Math.sqrt(d2);
        ux = dx / d; uy = dy / d; push = b.r - d;
      } else {
        // centre inside the brick: back out along the shallowest face
        var l = b.x - k.x, rr = k.x + k.w - b.x, t = b.y - k.y, bo = k.y + k.h - b.y;
        var m = Math.min(l, rr, t, bo);
        if (m === l) { ux = -1; uy = 0; push = l + b.r; }
        else if (m === rr) { ux = 1; uy = 0; push = rr + b.r; }
        else if (m === t) { ux = 0; uy = -1; push = t + b.r; }
        else { ux = 0; uy = 1; push = bo + b.r; }
      }
      b.x += ux * push;
      b.y += uy * push;
      var vn = b.vx * ux + b.vy * uy;
      if (vn < 0) { b.vx -= 2 * vn * ux; b.vy -= 2 * vn * uy; }
      enforceRise(b);
      b.hue = k.h0;
      damageBrick(k, 1, b.x, b.y);
      return;   // one brick per substep keeps the response clean
    }
  }

  function hitPaddle(b, prevY) {
    if (b.vy <= 0) return;
    var top = pad.y - pad.h / 2;
    // swept test: did the ball's underside cross the paddle's face this step?
    if (prevY + b.r > top + pad.h * 0.9 || b.y + b.r < top) return;
    var halfSpan = pad.w / 2 + b.r * 0.85;
    if (Math.abs(b.x - pad.x) > halfSpan) return;

    b.y = top - b.r - 0.01;
    var off = clamp((b.x - pad.x) / (pad.w / 2 + b.r), -1, 1);
    var ang = -Math.PI / 2 + off * MAX_ANGLE + clamp(pad.vx / (bw * 2.4), -0.3, 0.3);
    ang = clamp(ang, -Math.PI + MIN_RISE, -MIN_RISE);
    // A dead-centre hit returns the ball exactly vertical, and a paddle sitting
    // under it will do that forever. Lean it off the vertical, toward whichever
    // way the player was already going.
    if (Math.abs(ang + Math.PI / 2) < MIN_SIDE) {
      var lean = off !== 0 ? (off > 0 ? 1 : -1)
        : pad.vx !== 0 ? (pad.vx > 0 ? 1 : -1)
        : (Math.random() < 0.5 ? -1 : 1);
      ang = -Math.PI / 2 + lean * MIN_SIDE;
    }

    padHits++;
    var sp = curSpeed();
    b.vx = Math.cos(ang) * sp;
    b.vy = Math.sin(ang) * sp;
    enforceRise(b);

    combo = 0;
    sndPaddle(0.5 + Math.abs(off) * 0.5, panOf(b.x));
    burst(b.x, top, 5, "#8ef0ff", 0.5);
    shake = Math.min(5, shake + 1.6);
  }

  function damageBrick(k, dmg, hx, hy) {
    var pan = panOf(k.x + k.w / 2);
    if (k.steel) {
      sndSteel(pan);
      burst(hx, hy, 5, "#c8d4e6", 0.5);
      shake = Math.min(8, shake + 1.4);
      return;
    }
    k.hp -= dmg;
    fieldDirty = true;
    if (k.hp > 0) {
      sndArmor(pan);
      burst(hx, hy, 6, hsl(k.h0, k.s0, 78), 0.6);
      shake = Math.min(8, shake + 1.8);
      pulse = Math.min(1, pulse + 0.16);
      return;
    }

    k.alive = false;
    aliveCount--;
    bricksSmashed++;
    combo++;
    if (combo > comboBestRun) comboBestRun = combo;
    var mult = Math.min(combo, 6);
    var pts = k.value * mult;
    addScore(pts);

    sndBrick(Math.min(k.value / 10 - 1, 4) + Math.min(combo - 1, 7), pan);
    sndShatter(pan);
    shatter(k);
    pulse = Math.min(1, pulse + 0.3);
    shake = Math.min(11, shake + 2.4);
    if (mult > 1) {
      floaters.push({
        x: k.x + k.w / 2, y: k.y + k.h / 2, t: 0,
        txt: "+" + pts, sub: mult + "×", col: hsl(k.h0, k.s0, 76)
      });
    }
    if (Math.random() < DROP_CHANCE && caps.length < MAX_CAPS) dropCapsule(k);
    if (aliveCount <= 0) levelClear();
  }

  function addScore(n) {
    score += n;
    scoreEl.textContent = score;
    scoreEl.classList.remove("is-bump");
    void scoreEl.offsetWidth;
    scoreEl.classList.add("is-bump");
    if (score > best) {
      best = score;
      bestEl.textContent = best;
      bestBumped = true;
    }
  }

  // ============================================================== POWER-UPS
  var CAPS = [
    { id: "wide", ch: "W", h: 193, s: 100, w: 26, label: "Wide paddle" },
    { id: "multi", ch: "M", h: 42, s: 100, w: 22, label: "Multiball" },
    { id: "laser", ch: "L", h: 337, s: 100, w: 20, label: "Laser" },
    { id: "slow", ch: "S", h: 163, s: 84, w: 20, label: "Slow ball" },
    { id: "life", ch: "+", h: 258, s: 82, w: 12, label: "Extra ball" }
  ];

  function dropCapsule(k) {
    var total = 0, i;
    for (i = 0; i < CAPS.length; i++) total += CAPS[i].w;
    var pick = Math.random() * total, def = CAPS[0];
    for (i = 0; i < CAPS.length; i++) {
      pick -= CAPS[i].w;
      if (pick <= 0) { def = CAPS[i]; break; }
    }
    caps.push({ def: def, x: k.x + k.w / 2, y: k.y + k.h / 2, t: 0, vy: bh * 0.3 });
  }

  function collect(cap) {
    var id = cap.def.id;
    sndPower(panOf(cap.x));
    burst(cap.x, cap.y, 16, hsl(cap.def.h, cap.def.s, 72), 1);
    flash = 0.34; flashCol = hsl(cap.def.h, cap.def.s, 60);
    banner = { txt: cap.def.label.toUpperCase(), t: 0, col: hsl(cap.def.h, cap.def.s, 76), small: true };

    if (id === "wide") pw.wide = 22;
    else if (id === "slow") pw.slow = 12;
    else if (id === "laser") { pw.laser = 20; laserAmmo = LASER_AMMO; }
    else if (id === "life") { lives++; drawLives(); }
    else if (id === "multi") multiball();
  }

  function multiball() {
    var add = [];
    for (var i = 0; i < balls.length && balls.length + add.length < 5; i++) {
      var b = balls[i];
      if (b.stuck) continue;
      var sp = hyp(b.vx, b.vy) || curSpeed();
      var a0 = Math.atan2(b.vy, b.vx);
      for (var k = -1; k <= 1; k += 2) {
        if (balls.length + add.length >= 5) break;
        var a = a0 + k * 0.52;
        var nb = newBall(b.x, b.y, a, false);
        nb.hue = b.hue;
        nb.vx = Math.cos(a) * sp; nb.vy = Math.sin(a) * sp;
        enforceRise(nb);
        add.push(nb);
      }
    }
    for (var j = 0; j < add.length; j++) balls.push(add[j]);
  }

  function fireLaser() {
    if (laserCool > 0 || laserAmmo <= 0 || pw.laser <= 0) return;
    if (state !== "play" && state !== "serve") return;
    laserCool = LASER_COOL;
    laserAmmo--;
    var off = pad.w * 0.42;
    bolts.push({ x: pad.x - off, y: pad.y - pad.h });
    bolts.push({ x: pad.x + off, y: pad.y - pad.h });
    sndLaser(panOf(pad.x));
    if (laserAmmo <= 0) pw.laser = 0;
  }

  function stepBolts(dt) {
    var sp = bh * 1.75;
    for (var i = bolts.length - 1; i >= 0; i--) {
      var o = bolts[i];
      var steps = 3, hit = false;
      for (var s = 0; s < steps && !hit; s++) {
        o.y -= (sp * dt) / steps;
        for (var j = 0; j < bricks.length; j++) {
          var k = bricks[j];
          if (!k.alive) continue;
          if (o.x < k.x || o.x > k.x + k.w || o.y < k.y || o.y > k.y + k.h) continue;
          damageBrick(k, 1, o.x, o.y);
          hit = true;
          break;
        }
      }
      if (hit || o.y < by - 10) bolts.splice(i, 1);
    }
  }

  // ============================================================ PARTICLES
  function burst(x, y, n, col, v) {
    if (REDMO) n = Math.ceil(n * 0.4);
    for (var i = 0; i < n; i++) {
      var a = rnd(0, TAU), s = rnd(24, 90) * (0.5 + v);
      sparks.push({
        x: x, y: y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        t: 0, life: rnd(0.2, 0.5), col: col
      });
    }
  }

  function shatter(k) {
    var n = REDMO ? 5 : 13;
    for (var i = 0; i < n; i++) {
      var px = k.x + rnd(0, k.w), py = k.y + rnd(0, k.h);
      var a = rnd(0, TAU), s = rnd(40, 170);
      shards.push({
        x: px, y: py, vx: Math.cos(a) * s, vy: Math.sin(a) * s - rnd(10, 70),
        rot: rnd(0, TAU), vr: rnd(-7, 7), size: rnd(k.h * 0.16, k.h * 0.44),
        h: k.h0, s: k.s0, t: 0, life: rnd(0.5, 1.05)
      });
    }
  }

  // ============================================================== GAME FLOW
  function drawLives() {
    var s = "";
    for (var i = 0; i < Math.min(lives, 6); i++) s += "●";
    if (lives > 6) s += "+";
    livesEl.textContent = s || "—";
  }

  function serveBall() {
    balls = [newBall(pad.x, pad.y - pad.h / 2 - ballR - 1, -Math.PI / 2, true)];
    bolts.length = 0;
    serveT = SERVE_WAIT;
    state = "serve";
  }

  function startLevel(n) {
    level = n;
    levelEl.textContent = n;
    buildLevel(n);
    buildField();
    caps.length = 0; bolts.length = 0;
    pw.wide = 0; pw.laser = 0; pw.slow = 0; laserAmmo = 0;
    pad.wTarget = bw * 0.16;
    padHits = 0;
    combo = 0;
    serveBall();
    if (n > 1) banner = { txt: "LEVEL " + n, t: 0, col: "#bfe9ff" };
  }

  function levelClear() {
    if (state === "clear") return;
    state = "clear";
    clearT = 2.1;
    var bonus = 300 * level + 80 * lives;
    addScore(bonus);
    banner = { txt: "WALL DOWN", t: 0, col: "#9ff5d8", sub: "+" + bonus };
    sndClear();
    flash = 0.6; flashCol = "#7ef7d2";
    shake = REDMO ? 0 : 9;
    // sweep the steel away so the next wall arrives on a clean field
    for (var i = 0; i < bricks.length; i++) {
      if (bricks[i].alive) { bricks[i].alive = false; shatter(bricks[i]); }
    }
    fieldDirty = true;
    caps.length = 0;
  }

  function loseBall() {
    lives--;
    drawLives();
    combo = 0;
    sndLoss();
    shake = REDMO ? 0 : 13;
    flash = 0.42; flashCol = "#ff4d8d";
    caps.length = 0;
    pw.wide = 0; pw.laser = 0; pw.slow = 0; laserAmmo = 0;
    pad.wTarget = bw * 0.16;
    if (lives <= 0) { gameOver(); return; }
    state = "dead";
    deadT = 0.9;
  }

  function startGame() {
    score = 0; lives = START_LIVES; combo = 0; comboBestRun = 0; bricksSmashed = 0;
    bestBumped = false;
    scoreEl.textContent = "0";
    bestEl.textContent = best;
    drawLives();
    sparks.length = 0; shards.length = 0; floaters.length = 0;
    banner = null; shake = 0; flash = 0; pulse = 0;
    pad.w = bw * 0.16; pad.wTarget = pad.w;
    pad.x = bx + bw / 2;
    hud.hidden = false;
    overlay.hidden = true;
    cta.hidden = true;
    document.body.classList.add("is-playing");
    hint.classList.remove("is-gone");
    startLevel(1);
  }

  function gameOver() {
    state = "over";
    sndOver();
    runs++;
    try { localStorage.setItem("bricksmash_runs", String(runs)); } catch (e) {}
    refreshCta();
    cta.hidden = false;
    if (bestBumped) {
      try { localStorage.setItem("bricksmash_best", String(best)); } catch (e) {}
    }
    var wall = level > 1 ? "wall " + level : "the first wall";
    ovEyebrow.textContent = bestBumped ? "New best" : "Level " + level + " · " + bricksSmashed + " bricks";
    ovTitle.textContent = String(score);
    ovText.innerHTML = bestBumped
      ? "That is your best yet — <b>" + score + "</b>, out on " + wall + ", with a longest chain of " + comboBestRun + ". Anything above it now is pure profit."
      : "Out on " + wall + " with <b>" + score + "</b>. Longest chain: " + comboBestRun + " bricks without the paddle. Best run so far is " + best + ".";
    ovBtn.textContent = "Again";
    ovKeys.textContent = "drag to move · ← → also works · space to launch";
    overlay.hidden = false;
    document.body.classList.remove("is-playing");
    hud.hidden = true;

    // Feeder share convention: the result, then ONE link — the daily, tagged.
    // No practice-page link; the daily is the destination worth having.
    window.OPT_SHARE_TEXT =
      "Brick Smasher (practice): " + score + ", longest chain " + comboBestRun + "." +
      "\nPlay today's wall against everyone \u2192 https://bricksmasher.com/?utm_source=onepagetoys&utm_medium=share";
    if (window.OPT_SHARE && window.OPT_SHARE.refresh) window.OPT_SHARE.refresh();
  }

  ovBtn.addEventListener("click", function () {
    unlockAudio();
    startGame();
  });

  // ================================================================= UPDATE
  function update(dt) {
    drift += dt;
    if (state === "menu") return;

    // paddle
    pad.px = pad.x;
    if (keyL || keyR) {
      var kv = bw * 1.35 * dt;
      movePad(pad.x + (keyR ? kv : 0) - (keyL ? kv : 0));
    }
    pad.wTarget = bw * 0.16 * (pw.wide > 0 ? 1.55 : 1);
    pad.w += (pad.wTarget - pad.w) * Math.min(1, dt * 9);
    movePad(pad.x);
    pad.vx = (pad.x - pad.px) / Math.max(dt, 0.0001);

    // power-up clocks
    if (pw.wide > 0) pw.wide = Math.max(0, pw.wide - dt);
    if (pw.slow > 0) pw.slow = Math.max(0, pw.slow - dt);
    if (pw.laser > 0) pw.laser = Math.max(0, pw.laser - dt);
    if (pw.laser <= 0) laserAmmo = 0;
    if (laserCool > 0) laserCool -= dt;
    if (firing && pw.laser > 0) fireLaser();

    if (state === "serve") {
      var b = balls[0];
      if (b && b.stuck) {
        b.x = pad.x;
        b.y = pad.y - pad.h / 2 - b.r - 1;
      }
      serveT -= dt;
      if (serveT <= 0) launch();
    } else if (state === "dead") {
      deadT -= dt;
      if (deadT <= 0) serveBall();
    } else if (state === "clear") {
      clearT -= dt;
      if (clearT <= 0) startLevel(level + 1);
    }

    if (state === "play") {
      stepBalls(dt);
      for (var i = 0; i < balls.length; i++) {
        var bb = balls[i];
        if (REDMO) continue;
        bb.trail.push({ x: bb.x, y: bb.y });
        if (bb.trail.length > 12) bb.trail.shift();
      }
      if (!balls.length) loseBall();
    }

    if (state === "play" || state === "serve") stepBolts(dt);

    // capsules
    for (var c = caps.length - 1; c >= 0; c--) {
      var cap = caps[c];
      cap.t += dt;
      cap.y += cap.vy * dt;
      var padTop = pad.y - pad.h / 2;
      if (cap.y + cellH * 0.28 > padTop && cap.y - cellH * 0.28 < padTop + pad.h * 1.4 &&
          Math.abs(cap.x - pad.x) < pad.w / 2 + cellW * 0.22) {
        collect(cap);
        caps.splice(c, 1);
        continue;
      }
      if (cap.y > by + bh + cellH) caps.splice(c, 1);
    }

    // particles
    for (var s = sparks.length - 1; s >= 0; s--) {
      var p = sparks[s];
      p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= 0.93; p.vy *= 0.93;
      if (p.t > p.life) sparks.splice(s, 1);
    }
    for (var d = shards.length - 1; d >= 0; d--) {
      var g = shards[d];
      g.t += dt;
      g.vy += bh * 1.5 * dt;
      g.x += g.vx * dt; g.y += g.vy * dt;
      g.rot += g.vr * dt;
      if (g.t > g.life) shards.splice(d, 1);
    }
    for (var f = floaters.length - 1; f >= 0; f--) {
      floaters[f].t += dt;
      if (floaters[f].t > 0.9) floaters.splice(f, 1);
    }

    if (banner) { banner.t += dt; if (banner.t > (banner.small ? 0.95 : 1.5)) banner = null; }
    if (shake > 0) shake = Math.max(0, shake - dt * 34);
    if (flash > 0) flash = Math.max(0, flash - dt * 1.5);
    if (pulse > 0) pulse = Math.max(0, pulse - dt * 2.4);
  }

  // =================================================================== DRAW
  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    drawRoom();

    var sx = 0, sy = 0;
    if (shake > 0 && !REDMO) { sx = rnd(-shake, shake); sy = rnd(-shake, shake); }
    ctx.save();
    ctx.translate(sx, sy);

    drawWell();

    // everything in play is clipped to the well, so shards and glow never spill
    // out past the rails and float loose in the room
    ctx.save();
    roundRect(ctx, bx, by, bw, bh, bw * 0.028 * 0.7);
    ctx.clip();
    if (fieldDirty) drawField();
    if (fieldCv) ctx.drawImage(fieldCv, bx - fieldPad, fieldTop - fieldPad,
                               fieldCv.width / dpr, fieldCv.height / dpr);
    drawShards();
    drawCaps();
    drawBolts();
    drawTrails();
    drawBalls();
    drawPaddle();
    drawSparks();
    drawFloaters();
    ctx.restore();

    drawChips();
    ctx.restore();

    if (state === "serve") drawServeCue();
    if (banner) drawBanner();
    if (flash > 0) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = flash * 0.22;
      ctx.fillStyle = flashCol;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
  }

  function drawRoom() {
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#0b0b1c");
    g.addColorStop(0.55, "#06070f");
    g.addColorStop(1, "#04040a");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    if (gridCv && !REDMO) {
      var st = gridCv.step;
      var off = (drift * 7) % st;
      ctx.save();
      ctx.globalAlpha = 0.5;
      var pat = ctx.createPattern(gridCv.cv, "repeat");
      ctx.translate(0, off);
      ctx.fillStyle = pat;
      ctx.fillRect(0, -st, W, H + st * 2);
      ctx.restore();
    }

    // the wall's own light spilling into the room, brightened by every smash
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    var b = ctx.createRadialGradient(bx + bw / 2, fieldTop + rows * cellH * 0.4, bw * 0.12,
                                     bx + bw / 2, fieldTop + rows * cellH * 0.4, bw * 1.25);
    b.addColorStop(0, "rgba(120,90,220," + (0.1 + pulse * 0.16).toFixed(3) + ")");
    b.addColorStop(1, "rgba(80,60,180,0)");
    ctx.fillStyle = b;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  function drawWell() {
    var r = bw * 0.028;
    var lip = bw * 0.016;

    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.85)";
    ctx.shadowBlur = bw * 0.1;
    ctx.shadowOffsetY = bw * 0.02;
    ctx.fillStyle = "#0a0b18";
    roundRect(ctx, bx - lip, by - lip, bw + lip * 2, bh + lip * 2, r);
    ctx.fill();
    ctx.restore();

    // just shy of opaque, so the room's drifting lattice reads faintly through
    // the empty middle of the well instead of it being a flat void
    var sg = ctx.createLinearGradient(0, by, 0, by + bh);
    sg.addColorStop(0, "rgba(13,13,34,0.93)");
    sg.addColorStop(0.6, "rgba(7,7,20,0.93)");
    sg.addColorStop(1, "rgba(5,5,14,0.93)");
    ctx.fillStyle = sg;
    roundRect(ctx, bx, by, bw, bh, r * 0.7);
    ctx.fill();

    // rails: bright on three sides, and nothing at all across the bottom
    ctx.save();
    ctx.strokeStyle = "rgba(110,231,255,0.5)";
    ctx.lineWidth = Math.max(1.4, bw * 0.005);
    ctx.shadowColor = "rgba(110,231,255,0.7)";
    ctx.shadowBlur = bw * 0.035;
    ctx.beginPath();
    ctx.moveTo(bx, by + bh);
    ctx.lineTo(bx, by + r * 0.7);
    ctx.quadraticCurveTo(bx, by, bx + r * 0.7, by);
    ctx.lineTo(bx + bw - r * 0.7, by);
    ctx.quadraticCurveTo(bx + bw, by, bx + bw, by + r * 0.7);
    ctx.lineTo(bx + bw, by + bh);
    ctx.stroke();
    ctx.restore();

    // the floor you must not let the ball reach
    var lowest = by;
    for (var i = 0; i < balls.length; i++) lowest = Math.max(lowest, balls[i].y);
    var near = clamp((lowest - (by + bh * 0.72)) / (bh * 0.28), 0, 1);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    var fg = ctx.createLinearGradient(0, by + bh - bh * 0.06, 0, by + bh);
    fg.addColorStop(0, "rgba(255,77,141,0)");
    fg.addColorStop(1, "rgba(255,77,141," + (0.08 + near * 0.3).toFixed(3) + ")");
    ctx.fillStyle = fg;
    ctx.fillRect(bx, by + bh - bh * 0.06, bw, bh * 0.06);
    ctx.strokeStyle = "rgba(255,77,141," + (0.32 + near * 0.5).toFixed(3) + ")";
    ctx.lineWidth = Math.max(1, bw * 0.0035);
    ctx.setLineDash([bw * 0.02, bw * 0.022]);
    ctx.beginPath();
    ctx.moveTo(bx, by + bh - 0.5);
    ctx.lineTo(bx + bw, by + bh - 0.5);
    ctx.stroke();
    ctx.restore();
  }

  function drawPaddle() {
    var x = pad.x - pad.w / 2, y = pad.y - pad.h / 2;
    var r = pad.h / 2;

    // pool of light around it — squashed into an ellipse by scaling the space,
    // so the gradient stays circular and never shows the edge of a fill rect
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.translate(pad.x, pad.y);
    ctx.scale(1, 0.34);
    var ug = ctx.createRadialGradient(0, 0, 0, 0, 0, pad.w * 0.8);
    ug.addColorStop(0, "rgba(110,231,255,0.26)");
    ug.addColorStop(0.55, "rgba(110,231,255,0.07)");
    ug.addColorStop(1, "rgba(110,231,255,0)");
    ctx.fillStyle = ug;
    ctx.beginPath(); ctx.arc(0, 0, pad.w * 0.8, 0, TAU); ctx.fill();
    ctx.restore();

    var g = ctx.createLinearGradient(0, y, 0, y + pad.h);
    g.addColorStop(0, "#d9fbff");
    g.addColorStop(0.28, "#6ee7ff");
    g.addColorStop(0.62, "#1b7fa8");
    g.addColorStop(1, "#08243a");
    ctx.save();
    ctx.shadowColor = "rgba(110,231,255,0.72)";
    ctx.shadowBlur = pad.h * 1.5;
    ctx.fillStyle = g;
    roundRect(ctx, x, y, pad.w, pad.h, r);
    ctx.fill();
    ctx.restore();

    // bright emissive strip along the face
    ctx.fillStyle = "rgba(255,255,255,0.72)";
    roundRect(ctx, x + r * 0.5, y + pad.h * 0.13, pad.w - r, pad.h * 0.2, pad.h * 0.1);
    ctx.fill();

    if (pw.laser > 0) {
      var t = drift * 9;
      var cw = pad.h * 0.62, chh = pad.h * 0.72;
      for (var k = -1; k <= 1; k += 2) {
        var cx = pad.x + k * pad.w * 0.42;
        ctx.save();
        // seated ON the paddle face, not floating above it
        var cg = ctx.createLinearGradient(0, y - chh, 0, y + pad.h * 0.4);
        cg.addColorStop(0, "#ffd6e6");
        cg.addColorStop(0.4, "#ff4d8d");
        cg.addColorStop(1, "#5c0f2c");
        ctx.fillStyle = cg;
        ctx.shadowColor = "rgba(255,77,141," + (0.5 + Math.sin(t) * 0.28).toFixed(2) + ")";
        ctx.shadowBlur = pad.h * 1.1;
        roundRect(ctx, cx - cw / 2, y - chh, cw, chh + pad.h * 0.5, cw * 0.34);
        ctx.fill();
        ctx.restore();
        // muzzle
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.fillStyle = "rgba(255,220,235," + (0.55 + Math.sin(t) * 0.35).toFixed(2) + ")";
        ctx.beginPath();
        ctx.arc(cx, y - chh + cw * 0.3, cw * 0.28, 0, TAU);
        ctx.fill();
        ctx.restore();
      }
    }
  }

  // A tapered stroke rather than a row of dots — at speed the dots read as a
  // string of beads, a stroke reads as a streak.
  function drawTrails() {
    if (REDMO) return;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (var i = 0; i < balls.length; i++) {
      var b = balls[i];
      var n = b.trail.length;
      if (n < 2) continue;
      for (var j = 1; j < n; j++) {
        var p0 = b.trail[j - 1], p1 = b.trail[j];
        // a rail bounce puts a long chord in the buffer; skip those segments
        if (hyp(p1.x - p0.x, p1.y - p0.y) > b.r * 14) continue;
        var a = j / n;
        ctx.globalAlpha = a * a * 0.38;
        ctx.strokeStyle = hsl(b.hue, 95, 72);
        ctx.lineWidth = b.r * (0.35 + a * 1.35);
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawBalls() {
    for (var i = 0; i < balls.length; i++) {
      var b = balls[i];
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      var g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r * 4);
      g.addColorStop(0, hsl(b.hue, 100, 78, 0.9));
      g.addColorStop(0.35, hsl(b.hue, 100, 60, 0.28));
      g.addColorStop(1, hsl(b.hue, 100, 50, 0));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r * 4, 0, TAU); ctx.fill();
      ctx.restore();

      var cg = ctx.createRadialGradient(b.x - b.r * 0.35, b.y - b.r * 0.4, b.r * 0.1, b.x, b.y, b.r);
      cg.addColorStop(0, "#ffffff");
      cg.addColorStop(0.55, "#eaf9ff");
      cg.addColorStop(1, hsl(b.hue, 90, 72));
      ctx.fillStyle = cg;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU); ctx.fill();
    }
  }

  function drawCaps() {
    for (var i = 0; i < caps.length; i++) {
      var c = caps[i];
      var w = cellW * 0.62, h = cellH * 0.66;
      var tilt = Math.sin(c.t * 4) * 0.22;
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate(tilt);
      ctx.shadowColor = hsl(c.def.h, c.def.s, 62, 0.9);
      ctx.shadowBlur = h * 1.3;
      var g = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
      g.addColorStop(0, hsl(c.def.h, c.def.s, 74));
      g.addColorStop(0.5, hsl(c.def.h, c.def.s, 54));
      g.addColorStop(1, hsl(c.def.h, c.def.s, 32));
      ctx.fillStyle = g;
      roundRect(ctx, -w / 2, -h / 2, w, h, h / 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = "rgba(255,255,255,0.5)";
      ctx.lineWidth = Math.max(1, h * 0.07);
      roundRect(ctx, -w / 2, -h / 2, w, h, h / 2);
      ctx.stroke();
      ctx.fillStyle = "rgba(8,10,22,0.9)";
      ctx.font = "800 " + Math.round(h * 0.74) + "px 'Geist Mono', ui-monospace, monospace";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(c.def.ch, 0, h * 0.04);
      ctx.restore();
    }
  }

  function drawBolts() {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (var i = 0; i < bolts.length; i++) {
      var o = bolts[i];
      var len = cellH * 1.2;
      var g = ctx.createLinearGradient(0, o.y - len, 0, o.y);
      g.addColorStop(0, "rgba(255,77,141,0)");
      g.addColorStop(0.6, "rgba(255,120,170,0.85)");
      g.addColorStop(1, "rgba(255,255,255,0.95)");
      ctx.fillStyle = g;
      ctx.fillRect(o.x - Math.max(1.4, cellW * 0.035), o.y - len, Math.max(2.8, cellW * 0.07), len);
    }
    ctx.restore();
  }

  function drawShards() {
    ctx.save();
    for (var i = 0; i < shards.length; i++) {
      var s = shards[i];
      var a = 1 - s.t / s.life;
      ctx.globalAlpha = clamp(a, 0, 1) * 0.95;
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(s.rot);
      ctx.fillStyle = hsl(s.h, s.s, 40 + a * 34);
      ctx.beginPath();
      ctx.moveTo(-s.size * 0.5, -s.size * 0.34);
      ctx.lineTo(s.size * 0.56, -s.size * 0.14);
      ctx.lineTo(s.size * 0.2, s.size * 0.5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  function drawSparks() {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (var i = 0; i < sparks.length; i++) {
      var p = sparks[i];
      var a = 1 - p.t / p.life;
      ctx.globalAlpha = clamp(a, 0, 1) * 0.85;
      ctx.fillStyle = p.col;
      ctx.beginPath(); ctx.arc(p.x, p.y, 1.1 + a * 2.4, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  function drawFloaters() {
    ctx.save();
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    for (var i = 0; i < floaters.length; i++) {
      var f = floaters[i];
      var t = f.t / 0.9;
      ctx.globalAlpha = clamp(1 - t * t, 0, 1);
      var y = f.y - t * cellH * 2.1;
      ctx.font = "800 " + Math.round(cellH * 0.62) + "px 'Geist', system-ui, sans-serif";
      ctx.fillStyle = f.col;
      ctx.fillText(f.txt, f.x, y);
      ctx.font = "700 " + Math.round(cellH * 0.4) + "px 'Geist Mono', ui-monospace, monospace";
      ctx.globalAlpha *= 0.8;
      ctx.fillText(f.sub, f.x, y - cellH * 0.62);
    }
    ctx.restore();
  }

  // Active power-ups, in the clear band between the well's top rail and the
  // first brick row. Under the well they were both cramped and colliding with
  // the docked badges; up here there is real estate and nothing to hit.
  function drawChips() {
    var items = [];
    if (pw.wide > 0) items.push({ ch: "W", t: pw.wide / 22, h: 193, s: 100 });
    if (pw.slow > 0) items.push({ ch: "S", t: pw.slow / 12, h: 163, s: 84 });
    if (pw.laser > 0) items.push({ ch: "L", t: laserAmmo / LASER_AMMO, h: 337, s: 100 });
    if (!items.length) return;
    var band = fieldTop - by;
    var ch = clamp(band * 0.42, 11, 22), cw = ch * 2.3;
    var x0 = bx + bw * 0.022, y0 = by + (band - ch) / 2;
    ctx.save();
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    for (var i = 0; i < items.length; i++) {
      var it = items[i], x = x0 + i * (cw + ch * 0.34);
      ctx.fillStyle = hsl(it.h, it.s, 52, 0.18);
      roundRect(ctx, x, y0, cw, ch, ch * 0.34);
      ctx.fill();
      ctx.strokeStyle = hsl(it.h, it.s, 62, 0.42);
      ctx.lineWidth = Math.max(1, ch * 0.055);
      roundRect(ctx, x, y0, cw, ch, ch * 0.34);
      ctx.stroke();
      // the remaining-time bar runs along the bottom edge of the chip
      ctx.fillStyle = hsl(it.h, it.s, 66, 0.75);
      roundRect(ctx, x + ch * 0.16, y0 + ch * 0.74,
                (cw - ch * 0.32) * clamp(it.t, 0, 1), ch * 0.13, ch * 0.065);
      ctx.fill();
      ctx.fillStyle = hsl(it.h, it.s, 82);
      ctx.font = "800 " + Math.round(ch * 0.5) + "px 'Geist Mono', ui-monospace, monospace";
      ctx.fillText(it.ch, x + cw / 2, y0 + ch * 0.38);
    }
    ctx.restore();
  }

  function drawServeCue() {
    var b = balls[0];
    if (!b) return;
    var t = 1 - clamp(serveT / SERVE_WAIT, 0, 1);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = "rgba(180,235,255,0.75)";
    ctx.lineWidth = Math.max(1.6, b.r * 0.4);
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r * 2.6, -Math.PI / 2, -Math.PI / 2 + TAU * t);
    ctx.stroke();
    ctx.restore();

    if (!REDMO) {
      ctx.save();
      ctx.globalAlpha = 0.4 + Math.sin(drift * 5) * 0.16;
      ctx.strokeStyle = "rgba(180,235,255,0.8)";
      ctx.lineWidth = Math.max(1.2, b.r * 0.3);
      ctx.setLineDash([b.r * 1.4, b.r * 1.4]);
      ctx.beginPath();
      ctx.moveTo(b.x, b.y - b.r * 3.4);
      ctx.lineTo(b.x, b.y - b.r * 8);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawBanner() {
    var dur = banner.small ? 0.95 : 1.5;
    var t = banner.t / dur;
    var a = t < 0.12 ? t / 0.12 : 1 - Math.pow((t - 0.12) / 0.88, 2);
    var pop = banner.t < 0.18 ? 1 + (0.18 - banner.t) * (banner.small ? 1.2 : 2) : 1;
    ctx.save();
    ctx.globalAlpha = clamp(a, 0, 1);
    ctx.translate(bx + bw / 2, by + bh * (banner.small ? 0.74 : 0.44));
    ctx.scale(pop, pop);
    var fs = bw * (banner.small ? 0.075 : 0.13);
    ctx.font = "800 " + Math.round(fs) + "px 'Geist', system-ui, sans-serif";
    var need = ctx.measureText(banner.txt).width;
    if (need > bw * 0.9) {
      fs *= (bw * 0.9) / need;
      ctx.font = "800 " + Math.round(fs) + "px 'Geist', system-ui, sans-serif";
    }
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.shadowColor = banner.col;
    ctx.shadowBlur = 26;
    ctx.fillStyle = banner.col;
    ctx.fillText(banner.txt, 0, 0);
    if (banner.sub) {
      ctx.font = "800 " + Math.round(fs * 0.44) + "px 'Geist Mono', ui-monospace, monospace";
      ctx.fillText(banner.sub, 0, fs * 0.82);
    }
    ctx.restore();
  }

  // ================================================================= FEEDER
  // bricksmasher.com keys its daily on a LOCAL date (ROLLOVER = "local" in the
  // game's src/game/daily.ts), so this counts down to local midnight. If that
  // constant ever flips to UTC, this has to flip with it or the banner lies.
  function tickCountdown() {
    var now = new Date();
    var next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0).getTime();
    var left = Math.max(0, next - now.getTime());
    var h = Math.floor(left / 3600000);
    var m = Math.floor(left / 60000) % 60;
    var sec = Math.floor(left / 1000) % 60;
    dailyTime.textContent = h + "h " + (m < 10 ? "0" : "") + m + "m " + (sec < 10 ? "0" : "") + sec + "s";
    dailyEl.title = "A new wall drops in " + h + "h " + m + "m at bricksmasher.com";
  }
  tickCountdown();
  setInterval(tickCountdown, 1000);

  // The nudge: once someone has played a few runs in here, stop describing the
  // daily and start describing what they are missing by not being on it.
  function refreshCta() {
    if (runs >= 3) {
      dailyEl.classList.add("is-hot");
      ctaLine.innerHTML = "That is <b>" + runs + " runs</b> in the practice edition. " +
        "The daily gives everyone the <b>same wall</b> and three balls — and a streak for coming back.";
      ctaBtn.textContent = "Start a streak \u2192";
    } else {
      ctaLine.innerHTML = "Everyone gets the <b>same wall</b> on the daily — three balls, one score, " +
        "and a streak for turning up.";
      ctaBtn.textContent = "Play today's wall \u2192";
    }
  }
  refreshCta();

  function track(name, params) {
    if (window.gtag) { try { gtag("event", name, params); } catch (e) {} }
  }
  // share.js injects its own button into the overlay panel after this script
  // runs, so the listener is delegated rather than bound directly.
  document.addEventListener("click", function (e) {
    var t = e.target && e.target.closest ? e.target.closest(".opt-share") : null;
    if (t) track("share", { method: "bricksmasher_feeder", value: score });
  });

  [[dailyEl, "banner"], [ctaBtn, "post_round"]].forEach(function (pair) {
    pair[0].addEventListener("click", function () {
      track("outbound_click", { destination: "bricksmasher.com", link_id: pair[1] });
    });
  });

  // ==================================================================== LOOP
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) last = 0;
  });

  function frame(ts) {
    if (!last) last = ts;
    var dt = Math.min(0.04, (ts - last) / 1000);
    last = ts;
    update(dt);
    draw();
    requestAnimationFrame(frame);
  }

  resize();
  buildLevel(1);
  buildField();
  pad.x = bx + bw / 2;
  balls = [newBall(bx + bw / 2, pad.y - pad.h, -Math.PI / 2, true)];
  drawLives();
  requestAnimationFrame(frame);
})();
