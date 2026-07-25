/* Darts — No. 093
 * Nine darts at a full-size board. Move to aim; press and HOLD and your hand
 * steadies (the reticle ring shrinks); release at the calm moment to throw.
 * Overhold and your arm shakes again. Authentic board scoring.
 * Vanilla Canvas 2D + Web Audio. Self-contained.
 * localStorage best key: "darts_best" (higher = better nine-dart total). */
(function () {
  "use strict";

  var TAU = Math.PI * 2;

  // ---------------------------------------------------------------- elements
  var canvas = document.getElementById("canvas");
  var ctx = canvas.getContext("2d");
  var hud = document.getElementById("hud");
  var scoreEl = document.getElementById("score");
  var dartsEl = document.getElementById("darts");
  var bestEl = document.getElementById("best");
  var overlay = document.getElementById("overlay");
  var ovEyebrow = document.getElementById("ovEyebrow");
  var ovTitle = document.getElementById("ovTitle");
  var ovText = document.getElementById("ovText");
  var ovBtn = document.getElementById("ovBtn");
  var ovKeys = document.getElementById("ovKeys");
  var hint = document.getElementById("hint");
  var soundBtn = document.getElementById("soundBtn");

  var REDMO = false;
  try { REDMO = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) {}
  var COARSE = false;
  try { COARSE = window.matchMedia && window.matchMedia("(pointer: coarse)").matches; } catch (e) {}

  // ------------------------------------------------------------------ board
  // Radii normalised so 1.0 = outside edge of the double ring.
  var R_BULL_IN = 0.0374, R_BULL_OUT = 0.0935;
  var R_TRB_IN = 0.5824, R_TRB_OUT = 0.6294;
  var R_DBL_IN = 0.9529;
  var R_RING = 1.30;               // outer number ring
  var SECTORS = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];
  var SECT = TAU / 20;

  var COL_BLACK = "#141110", COL_CREAM = "#e6d9ba";
  var COL_RED = "#c4332b", COL_GREEN = "#2d8a5c";

  // ------------------------------------------------------------------ tuning
  var DARTS_PER_ROUND = 9;
  var AMP_BASE = 0.150;   // sway amplitude, fraction of board radius
  var AMP_MIN = 0.020;
  var AMP_OVER = 0.270;
  var STEADY_MS = 850;    // time to settle to the calm window
  var CALM_MS = 560;      // how long the calm window lasts
  var SHAKE_MS = 1100;    // ramp back up to AMP_OVER after the calm window
  var FLIGHT_MS = 400;

  // ------------------------------------------------------------------- state
  var state = "menu";     // menu | aim | fly | land | over
  var score = 0, best = 0, thrown = 0;
  var stuck = [];         // darts in the board
  var floaters = [];   // {txt: points, sub: bed name}
  var dust = [];
  var fly = null;
  var landT = 0;
  var trebles = 0, doubles = 0, bulls = 0, misses = 0;
  var lastLabel = "";

  var aimX = 0, aimY = 0, haveAim = false;
  var holding = false, holdT = 0, amp = AMP_BASE, ph1 = 0, ph2 = 0;
  var swayX = 0, swayY = 0;
  var shake = 0, flashT = 0;
  var tension = 0;        // 0..1, drives the overhold warning tone

  var dpr = 1, W = 0, H = 0;
  var cx = 0, cy = 0, R = 0;      // board centre + radius (double-outer)
  var boardCv = null, boardR = 0; // cached board sprite
  var last = 0;

  // ------------------------------------------------------------ persistence
  var soundOn = true;
  try { best = parseInt(localStorage.getItem("darts_best") || "0", 10) || 0; } catch (e) {}
  try { if (localStorage.getItem("darts_sound") === "0") soundOn = false; } catch (e) {}
  bestEl.textContent = best;
  soundBtn.setAttribute("aria-pressed", soundOn ? "true" : "false");

  // -------------------------------------------------------------------- util
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }
  function lerp(a, b, t) { return a + (b - a) * t; }

  // ================================================================== AUDIO
  var AC = null, outGain = null, verbGain = null, master = null, noiseBuf = null;
  var tensionOsc = null, tensionGain = null;

  function initAudio() {
    if (AC) return;
    try { AC = new (window.AudioContext || window.webkitAudioContext)(); }
    catch (e) { AC = null; return; }

    outGain = AC.createGain();
    outGain.gain.value = soundOn ? 1 : 0;

    var lp = AC.createBiquadFilter();
    lp.type = "lowpass"; lp.frequency.value = 13000; lp.Q.value = 0.6;

    var comp = AC.createDynamicsCompressor();
    comp.threshold.value = -15; comp.knee.value = 26; comp.ratio.value = 3;
    comp.attack.value = 0.004; comp.release.value = 0.22;

    master = AC.createGain();
    master.gain.value = 0.92;

    // A pub room, not a hall: short, dry-ish tail.
    var verb = AC.createConvolver();
    verb.buffer = makeImpulse(1.25, 3.4);
    verbGain = AC.createGain();
    verbGain.gain.value = 0.3;

    outGain.connect(lp); lp.connect(comp);
    outGain.connect(verb); verb.connect(verbGain); verbGain.connect(comp);
    comp.connect(master); master.connect(AC.destination);

    // one shared noise buffer — per-throw allocation churns the heap
    var len = Math.floor(AC.sampleRate * 1.2);
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
        prev = prev + 0.3 * ((Math.random() * 2 - 1) - prev);
        d[i] = prev * env;
      }
    }
    return buf;
  }

  function unlockAudio() {
    initAudio();
    if (!AC) return;
    if (AC.state === "suspended") AC.resume();
    try {
      var b = AC.createBuffer(1, 1, 22050), s = AC.createBufferSource();
      s.buffer = b; s.connect(AC.destination); s.start(0);
    } catch (e) {}
  }
  function now() { return AC ? AC.currentTime : 0; }

  function tone(o) {
    if (!AC) return;
    var t = now() + (o.at || 0);
    var osc = AC.createOscillator();
    osc.type = o.type || "sine";
    osc.frequency.setValueAtTime(o.f, t);
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f2), t + (o.dur || 0.3));
    if (o.detune) osc.detune.value = o.detune;
    var g = AC.createGain();
    var a = o.a != null ? o.a : 0.005, d = o.dur || 0.3, peak = o.g != null ? o.g : 0.24;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
    var node = osc;
    if (o.filt) {
      var f = AC.createBiquadFilter();
      f.type = o.filt; f.frequency.value = o.filtF || 2000;
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
    var t = now() + (o.at || 0), dur = o.dur || 0.12;
    var s = AC.createBufferSource();
    s.buffer = noiseBuf;
    s.playbackRate.value = o.rate || 1;
    var f = AC.createBiquadFilter();
    f.type = o.filt || "bandpass";
    f.frequency.setValueAtTime(o.f || 1600, t);
    if (o.f2) f.frequency.exponentialRampToValueAtTime(Math.max(40, o.f2), t + dur);
    if (o.Q) f.Q.value = o.Q;
    var g = AC.createGain();
    var peak = o.g != null ? o.g : 0.2;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + (o.a != null ? o.a : 0.004));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g);
    if (o.pan != null && AC.createStereoPanner) {
      var p = AC.createStereoPanner(); p.pan.value = clamp(o.pan, -1, 1);
      g.connect(p); p.connect(outGain);
    } else g.connect(outGain);
    s.start(t, rnd(0, 0.4)); s.stop(t + dur + 0.05);
  }

  // dart leaving the hand: a short air rush, nothing pitched
  function sndThrow() {
    if (!soundOn) return;
    noise({ filt: "bandpass", f: 700, f2: 2600, Q: 1.1, dur: 0.16, g: 0.09 });
  }

  // THE sound: tungsten point into tightly-packed sisal.
  // fibre punch (mid noise burst) + a very short woody body + a tiny tip tick.
  function sndThunk(pan, hard) {
    if (!soundOn) return;
    var v = hard ? 1 : 0.82;
    noise({ filt: "bandpass", f: 1500, f2: 420, Q: 1.5, dur: 0.075, g: 0.3 * v, pan: pan });
    tone({ type: "sine", f: 168, f2: 96, dur: 0.055, a: 0.001, g: 0.3 * v, pan: pan });
    noise({ filt: "highpass", f: 5200, dur: 0.022, g: 0.1 * v, pan: pan });
  }

  // clipping a wire on the way in
  function sndWire(pan) {
    if (!soundOn) return;
    var p = [1, 2.71, 5.12];
    for (var i = 0; i < p.length; i++) {
      tone({ type: "sine", f: 2100 * p[i], dur: 0.16 - i * 0.04, a: 0.001, g: 0.045 / (i + 1), pan: pan });
    }
  }

  // bright confirmation when the dart finds a scoring bed
  function sndReward(kind) {
    if (!soundOn) return;
    var base = kind === "bull" ? 660 : kind === "treble" ? 588 : 494;
    var steps = kind === "bull" ? [0, 7, 12, 19] : kind === "treble" ? [0, 4, 7] : [0, 5];
    for (var i = 0; i < steps.length; i++) {
      var f = base * Math.pow(2, steps[i] / 12);
      tone({ type: "triangle", f: f, dur: 0.5, a: 0.006, g: 0.1, at: i * 0.055, pan: rnd(-0.2, 0.2) });
      tone({ type: "sine", f: f * 2, dur: 0.3, a: 0.004, g: 0.035, at: i * 0.055 });
    }
  }

  function sndMiss() {
    if (!soundOn) return;
    noise({ filt: "lowpass", f: 620, f2: 200, dur: 0.2, g: 0.16 });
    tone({ type: "sine", f: 96, f2: 62, dur: 0.16, a: 0.002, g: 0.16 });
  }

  function sndRoundEnd(good) {
    if (!soundOn) return;
    var steps = good ? [0, 4, 7, 12, 16, 19] : [0, 3, 7];
    for (var i = 0; i < steps.length; i++) {
      var f = 392 * Math.pow(2, steps[i] / 12);
      tone({ type: "triangle", f: f, dur: 0.85, a: 0.008, g: 0.11, at: i * 0.085, pan: (i / steps.length - 0.5) * 0.7 });
      tone({ type: "sine", f: f * 2, dur: 0.5, a: 0.005, g: 0.038, at: i * 0.085 });
    }
  }

  // a low breath-hold tone that creeps up as the arm starts to shake
  function startTension() {
    if (!AC || tensionOsc) return;
    tensionOsc = AC.createOscillator();
    tensionOsc.type = "sine";
    tensionOsc.frequency.value = 78;
    tensionGain = AC.createGain();
    tensionGain.gain.value = 0.0001;
    tensionOsc.connect(tensionGain);
    tensionGain.connect(outGain);
    tensionOsc.start();
  }
  function stopTension() {
    if (!tensionOsc) return;
    try {
      tensionGain.gain.setTargetAtTime(0.0001, now(), 0.05);
      tensionOsc.stop(now() + 0.4);
    } catch (e) {}
    tensionOsc = null; tensionGain = null;
  }
  function setTension(v) {
    if (!tensionGain || !AC) return;
    try {
      tensionGain.gain.setTargetAtTime(soundOn ? 0.055 * v : 0.0001, now(), 0.06);
      tensionOsc.frequency.setTargetAtTime(78 + 46 * v, now(), 0.08);
    } catch (e) {}
  }

  soundBtn.addEventListener("click", function () {
    soundOn = !soundOn;
    soundBtn.setAttribute("aria-pressed", soundOn ? "true" : "false");
    try { localStorage.setItem("darts_sound", soundOn ? "1" : "0"); } catch (e) {}
    if (outGain && AC) {
      try { outGain.gain.setTargetAtTime(soundOn ? 1 : 0, now(), 0.02); }
      catch (e) { outGain.gain.value = soundOn ? 1 : 0; }
    }
    unlockAudio();
  });

  // ================================================================ SCORING
  // (dx, dy) are board-space offsets in units of R (1.0 = double outer edge).
  function scoreAt(dx, dy) {
    var r = Math.sqrt(dx * dx + dy * dy);
    if (r <= R_BULL_IN) return { pts: 50, label: "Bull", kind: "bull" };
    if (r <= R_BULL_OUT) return { pts: 25, label: "Outer bull", kind: "outer" };
    if (r > 1) return { pts: 0, label: "Off the board", kind: "miss" };
    var a = Math.atan2(dy, dx) + Math.PI / 2;         // 0 at top, clockwise
    var idx = Math.floor(((a + SECT / 2) % TAU + TAU) % TAU / SECT) % 20;
    var base = SECTORS[idx];
    if (r >= R_DBL_IN) return { pts: base * 2, label: "Double " + base, kind: "double" };
    if (r >= R_TRB_IN && r <= R_TRB_OUT) return { pts: base * 3, label: "Treble " + base, kind: "treble" };
    return { pts: base, label: "Single " + base, kind: "single" };
  }

  // did the dart clip a wire? (used for flavour audio only)
  function nearWire(dx, dy) {
    var r = Math.sqrt(dx * dx + dy * dy);
    if (r > 1.02 || r < R_BULL_IN) return false;
    var rings = [R_BULL_OUT, R_TRB_IN, R_TRB_OUT, R_DBL_IN, 1];
    for (var i = 0; i < rings.length; i++) if (Math.abs(r - rings[i]) < 0.011) return true;
    if (r <= R_BULL_OUT) return false;
    var a = Math.atan2(dy, dx) + Math.PI / 2;
    var off = ((a + SECT / 2) % SECT + SECT) % SECT;   // distance into the sector
    return off < 0.014 || off > SECT - 0.014;
  }

  // ============================================================ BOARD SPRITE
  function buildBoard(radius) {
    var pad = Math.ceil(radius * R_RING) + 8;
    var size = pad * 2;
    var cv = document.createElement("canvas");
    cv.width = size; cv.height = size;
    var c = cv.getContext("2d");
    c.translate(pad, pad);

    var rr = radius;

    // --- outer surround (the black number ring) with a brushed sheen
    var sur = c.createRadialGradient(-rr * 0.3, -rr * 0.4, rr * 0.4, 0, 0, rr * R_RING);
    sur.addColorStop(0, "#2a2320");
    sur.addColorStop(0.7, "#161211");
    sur.addColorStop(1, "#0b0908");
    c.fillStyle = sur;
    c.beginPath(); c.arc(0, 0, rr * R_RING, 0, TAU); c.fill();

    // --- beds
    for (var i = 0; i < 20; i++) {
      var a0 = -Math.PI / 2 + (i - 0.5) * SECT;
      var a1 = a0 + SECT;
      var even = i % 2 === 0;
      var single = even ? COL_BLACK : COL_CREAM;
      var ring = even ? COL_RED : COL_GREEN;
      wedge(c, rr * R_BULL_OUT, rr * R_TRB_IN, a0, a1, single);
      wedge(c, rr * R_TRB_IN, rr * R_TRB_OUT, a0, a1, ring);
      wedge(c, rr * R_TRB_OUT, rr * R_DBL_IN, a0, a1, single);
      wedge(c, rr * R_DBL_IN, rr, a0, a1, ring);
    }

    // --- sisal grain: fine radial strands, denser on the light beds
    c.save();
    c.globalAlpha = 0.11;
    c.lineWidth = Math.max(0.6, rr * 0.0035);
    for (var s = 0; s < 620; s++) {
      var ang = Math.random() * TAU;
      var r0 = R_BULL_OUT + Math.random() * (1 - R_BULL_OUT);
      var len = rnd(0.02, 0.07);
      var r1 = Math.min(1, r0 + len);
      c.strokeStyle = Math.random() < 0.5 ? "#000" : "#fff";
      c.beginPath();
      c.moveTo(Math.cos(ang) * rr * r0, Math.sin(ang) * rr * r0);
      c.lineTo(Math.cos(ang) * rr * r1, Math.sin(ang) * rr * r1);
      c.stroke();
    }
    c.restore();

    // --- bull
    c.fillStyle = COL_GREEN;
    c.beginPath(); c.arc(0, 0, rr * R_BULL_OUT, 0, TAU); c.fill();
    c.fillStyle = COL_RED;
    c.beginPath(); c.arc(0, 0, rr * R_BULL_IN, 0, TAU); c.fill();
    // a little dome on the bull
    var bg = c.createRadialGradient(-rr * 0.012, -rr * 0.014, 0, 0, 0, rr * R_BULL_IN);
    bg.addColorStop(0, "rgba(255,255,255,0.34)");
    bg.addColorStop(1, "rgba(255,255,255,0)");
    c.fillStyle = bg;
    c.beginPath(); c.arc(0, 0, rr * R_BULL_IN, 0, TAU); c.fill();

    // --- wire spider (thin steel with a lit top edge)
    var wireW = Math.max(1, rr * 0.0085);
    function wireRing(rad) {
      c.lineWidth = wireW;
      c.strokeStyle = "rgba(150,152,158,0.92)";
      c.beginPath(); c.arc(0, 0, rr * rad, 0, TAU); c.stroke();
      c.lineWidth = wireW * 0.44;
      c.strokeStyle = "rgba(238,242,250,0.5)";
      c.beginPath(); c.arc(0, 0, rr * rad - wireW * 0.28, Math.PI * 1.06, Math.PI * 1.94); c.stroke();
    }
    [R_BULL_IN, R_BULL_OUT, R_TRB_IN, R_TRB_OUT, R_DBL_IN, 1].forEach(wireRing);
    c.lineWidth = wireW;
    c.strokeStyle = "rgba(150,152,158,0.92)";
    for (var k = 0; k < 20; k++) {
      var aa = -Math.PI / 2 + (k - 0.5) * SECT;
      c.beginPath();
      c.moveTo(Math.cos(aa) * rr * R_BULL_OUT, Math.sin(aa) * rr * R_BULL_OUT);
      c.lineTo(Math.cos(aa) * rr, Math.sin(aa) * rr);
      c.stroke();
    }

    // --- numbers around the ring
    c.fillStyle = "#efe6d2";
    c.font = "700 " + Math.round(rr * 0.135) + "px 'Geist', system-ui, sans-serif";
    c.textAlign = "center";
    c.textBaseline = "middle";
    for (var n = 0; n < 20; n++) {
      var na = -Math.PI / 2 + n * SECT;
      var nr = rr * 1.152;
      c.save();
      c.translate(Math.cos(na) * nr, Math.sin(na) * nr);
      c.rotate(na + Math.PI / 2);
      c.fillText(String(SECTORS[n]), 0, 0);
      c.restore();
    }

    // --- lighting: raking key from the upper-left, shadow lower-right
    c.globalCompositeOperation = "overlay";
    var lg = c.createLinearGradient(-rr, -rr, rr, rr);
    lg.addColorStop(0, "rgba(255,236,200,0.34)");
    lg.addColorStop(0.5, "rgba(255,255,255,0)");
    lg.addColorStop(1, "rgba(0,0,0,0.38)");
    c.fillStyle = lg;
    c.beginPath(); c.arc(0, 0, rr * R_RING, 0, TAU); c.fill();
    c.globalCompositeOperation = "source-over";

    // rim shadow so the board sits off the wall
    var vg = c.createRadialGradient(0, 0, rr * 0.94, 0, 0, rr * R_RING);
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(0,0,0,0.5)");
    c.fillStyle = vg;
    c.beginPath(); c.arc(0, 0, rr * R_RING, 0, TAU); c.fill();

    boardCv = cv; boardR = radius;
    boardCv._pad = pad;
  }

  function wedge(c, r0, r1, a0, a1, fill) {
    c.fillStyle = fill;
    c.beginPath();
    c.arc(0, 0, r1, a0, a1);
    c.arc(0, 0, r0, a1, a0, true);
    c.closePath();
    c.fill();
  }

  // ================================================================ SIZING
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // keep the whole board (plus the number ring) comfortably in frame and
    // leave room below for the throwing hand
    var fitH = (H * 0.68) / (2 * R_RING);
    var fitW = (W * 0.86) / (2 * R_RING);
    R = Math.max(60, Math.min(fitH, fitW));
    cx = W / 2;
    cy = Math.max(R * R_RING + 34, H * 0.44);
    if (cy + R * R_RING > H - 20) cy = H - 20 - R * R_RING;

    buildBoard(R);
    if (!haveAim) { aimX = cx; aimY = cy; }
  }
  window.addEventListener("resize", resize);
  window.addEventListener("orientationchange", function () {
    resize(); setTimeout(resize, 180); setTimeout(resize, 520);
  });

  // ================================================================== INPUT
  function pointAt(e) {
    var r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function setAim(p, touch) {
    // on a finger, float the aim above the contact point so the hand doesn't
    // cover the very thing you're aiming at
    aimY = p.y - (touch ? 62 : 0);
    aimX = p.x;
    haveAim = true;
  }

  canvas.addEventListener("pointermove", function (e) {
    if (state !== "aim") return;
    setAim(pointAt(e), e.pointerType === "touch" && holding);
  });

  canvas.addEventListener("pointerdown", function (e) {
    unlockAudio();
    if (state !== "aim") return;
    try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
    setAim(pointAt(e), e.pointerType === "touch");
    beginHold();
  });

  function endPointer(e) {
    if (state !== "aim" || !holding) return;
    if (e && e.pointerType === "touch") setAim(pointAt(e), true);
    release();
  }
  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", function () { if (holding) release(); });

  window.addEventListener("keydown", function (e) {
    if (e.code === "Space" || e.key === " ") {
      e.preventDefault();
      unlockAudio();
      if (state === "menu" || state === "over") { ovBtn.click(); return; }
      if (state === "aim" && !holding) beginHold();
    }
  });
  window.addEventListener("keyup", function (e) {
    if ((e.code === "Space" || e.key === " ") && holding) { e.preventDefault(); release(); }
  });

  function beginHold() {
    holding = true; holdT = 0;
    startTension();
    hint.classList.add("is-gone");
    noise({ filt: "lowpass", f: 900, dur: 0.22, g: soundOn ? 0.05 : 0 });
  }

  function release() {
    holding = false;
    stopTension();
    throwDart();
  }

  // ================================================================ THROWING
  function throwDart() {
    if (state !== "aim") return;
    state = "fly";

    // release error grows with how shaky the hand is at the moment of letting go
    var err = amp * R * 0.32;
    var tx = aimX + swayX + rnd(-err, err);
    var ty = aimY + swayY + rnd(-err, err);

    fly = {
      t: 0,
      x0: W / 2 + rnd(-14, 14), y0: H + 40,
      x1: tx, y1: ty,
      spin: rnd(-0.5, 0.5),
      tilt: rnd(-0.34, 0.34)
    };
    sndThrow();
  }

  function landDart() {
    var dx = (fly.x1 - cx) / R, dy = (fly.y1 - cy) / R;
    var res = scoreAt(dx, dy);
    var pan = clamp((fly.x1 - cx) / (R * 1.6), -0.8, 0.8);

    if (res.kind !== "miss") {
      stuck.push({
        x: fly.x1, y: fly.y1,
        tilt: fly.tilt,
        quiver: 1,
        age: 0,
        hue: stuck.length % 3
      });
      sndThunk(pan, res.pts >= 40);
      if (nearWire(dx, dy)) sndWire(pan);
      if (res.kind === "bull") { bulls++; sndReward("bull"); }
      else if (res.kind === "treble") { trebles++; sndReward("treble"); }
      else if (res.kind === "double") { doubles++; sndReward("double"); }
      for (var i = 0; i < 12; i++) {
        var a = rnd(0, TAU), sp = rnd(12, 90);
        dust.push({ x: fly.x1, y: fly.y1, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 20, life: rnd(0.25, 0.6), t: 0 });
      }
      shake = Math.min(9, 3 + res.pts * 0.07);
    } else {
      misses++;
      sndMiss();
      shake = 2;
    }

    score += res.pts;
    lastLabel = res.label;
    thrown++;
    floaters.push({
      x: fly.x1, y: fly.y1 - 16, t: 0,
      txt: res.kind === "miss" ? "MISS" : String(res.pts),
      sub: res.kind === "miss" ? "" : res.label.toUpperCase(),
      big: res.pts >= 40,
      col: res.kind === "miss" ? "#c96b62" : res.pts >= 50 ? "#ffe9a8" : res.pts >= 40 ? "#ffd27a" : "#f2ead9"
    });
    if (res.pts >= 40) flashT = 0.34;

    scoreEl.textContent = score;
    dartsEl.textContent = Math.min(thrown + 1, DARTS_PER_ROUND) + "/" + DARTS_PER_ROUND;

    fly = null;
    state = "land";
    landT = thrown >= DARTS_PER_ROUND ? 1.15 : 0.42;
  }

  // ============================================================== GAME FLOW
  function startRound() {
    score = 0; thrown = 0; stuck = []; floaters = []; dust = [];
    trebles = 0; doubles = 0; bulls = 0; misses = 0; lastLabel = "";
    amp = AMP_BASE; holding = false; holdT = 0; shake = 0; flashT = 0;
    scoreEl.textContent = "0";
    dartsEl.textContent = "1/" + DARTS_PER_ROUND;
    bestEl.textContent = best;
    hud.hidden = false;
    overlay.hidden = true;
    document.body.classList.add("is-playing");
    hint.classList.remove("is-gone");
    if (!haveAim) { aimX = cx; aimY = cy; }
    state = "aim";
  }

  function endRound() {
    state = "over";
    stopTension();
    var isBest = score > best;
    if (isBest) {
      best = score;
      try { localStorage.setItem("darts_best", String(best)); } catch (e) {}
    }
    bestEl.textContent = best;
    sndRoundEnd(score >= 200);

    var bits = [];
    if (bulls) bits.push(bulls + (bulls > 1 ? " bulls" : " bull"));
    if (trebles) bits.push(trebles + (trebles > 1 ? " trebles" : " treble"));
    if (doubles) bits.push(doubles + (doubles > 1 ? " doubles" : " double"));
    if (misses) bits.push(misses + (misses > 1 ? " off the board" : " off the board"));
    var line = bits.length ? bits.join(" · ") : "nine singles";
    var avg = (score / 3).toFixed(1);

    ovEyebrow.textContent = isBest ? "New personal best" : "Nine darts thrown";
    ovTitle.textContent = score;
    ovText.innerHTML = "<b>" + line + "</b><br>That's a " + avg + " three-dart average" +
      (isBest ? " — your best yet." : ". Your best is " + best + ".");
    ovBtn.textContent = "Throw again";
    ovKeys.textContent = "hold to steady · release to throw";
    overlay.hidden = false;
    document.body.classList.remove("is-playing");

    window.OPT_SHARE_TEXT = "I scored " + score + " with nine darts on One Page Toys.";
    if (window.OPT_SHARE && window.OPT_SHARE.refresh) window.OPT_SHARE.refresh();
  }

  ovBtn.addEventListener("click", function () {
    unlockAudio();
    startRound();
  });

  // ================================================================= UPDATE
  function update(dt) {
    // ---- sway
    if (state === "aim") {
      if (holding) {
        holdT += dt * 1000;
        if (holdT < STEADY_MS) {
          amp = lerp(AMP_BASE, AMP_MIN, easeOut(holdT / STEADY_MS));
          tension = 0;
        } else if (holdT < STEADY_MS + CALM_MS) {
          amp = AMP_MIN;
          tension = 0.12;
        } else {
          var o = clamp((holdT - STEADY_MS - CALM_MS) / SHAKE_MS, 0, 1);
          amp = lerp(AMP_MIN, AMP_OVER, o * o);
          tension = 0.2 + o * 0.8;
        }
        setTension(tension);
      } else {
        amp += (AMP_BASE - amp) * Math.min(1, dt * 4);
        tension = 0;
      }
    }
    var rate = 1 + tension * 2.2;
    ph1 += dt * 1.55 * rate;
    ph2 += dt * 2.37 * rate;
    var a = amp * R;
    swayX = a * (0.62 * Math.sin(ph1) + 0.38 * Math.sin(ph2 * 1.7 + 1.3));
    swayY = a * (0.62 * Math.cos(ph1 * 0.93 + 0.7) + 0.38 * Math.sin(ph2 * 1.31));

    // ---- flight
    if (state === "fly" && fly) {
      fly.t += dt * 1000 / FLIGHT_MS;
      if (fly.t >= 1) { fly.t = 1; landDart(); }
    }

    // ---- land pause
    if (state === "land") {
      landT -= dt;
      if (landT <= 0) {
        if (thrown >= DARTS_PER_ROUND) endRound();
        else state = "aim";
      }
    }

    // ---- effects
    for (var i = stuck.length - 1; i >= 0; i--) {
      stuck[i].age += dt;
      stuck[i].quiver *= Math.pow(0.02, dt);
    }
    for (var j = floaters.length - 1; j >= 0; j--) {
      floaters[j].t += dt;
      if (floaters[j].t > 1.25) floaters.splice(j, 1);
    }
    for (var k = dust.length - 1; k >= 0; k--) {
      var d = dust[k];
      d.t += dt; d.x += d.vx * dt; d.y += d.vy * dt; d.vy += 260 * dt;
      if (d.t > d.life) dust.splice(k, 1);
    }
    if (shake > 0) shake = Math.max(0, shake - dt * 34);
    if (flashT > 0) flashT = Math.max(0, flashT - dt);
  }

  // =================================================================== DRAW
  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var sx = 0, sy = 0;
    if (shake > 0 && !REDMO) { sx = rnd(-shake, shake); sy = rnd(-shake, shake); }
    ctx.clearRect(0, 0, W, H);

    drawRoom();

    ctx.save();
    ctx.translate(sx, sy);

    // board
    if (boardCv) {
      var pad = boardCv._pad;
      ctx.drawImage(boardCv, cx - pad, cy - pad);
    }

    drawStuck();
    if (state === "fly" && fly) drawFlying();
    drawDust();
    if (state === "aim") drawReticle();
    drawFloaters();

    ctx.restore();

    drawHand();

    if (flashT > 0) {
      ctx.fillStyle = "rgba(255, 226, 160," + (flashT * 0.16) + ")";
      ctx.fillRect(0, 0, W, H);
    }
  }

  function drawRoom() {
    // Wall: cool petrol so the warm spotlight and the cream board read as the
    // hero. The first pass was brown-on-brown and the board sank into it.
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#16232b");
    g.addColorStop(0.5, "#0e171d");
    g.addColorStop(1, "#070c10");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // spotlight cone from above
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    var top = cy - R * 2.6;
    var cone = ctx.createLinearGradient(0, top, 0, cy + R * 1.4);
    cone.addColorStop(0, "rgba(255,206,132,0.09)");
    cone.addColorStop(0.55, "rgba(255,190,110,0.04)");
    cone.addColorStop(1, "rgba(255,180,100,0)");
    ctx.fillStyle = cone;
    ctx.beginPath();
    ctx.moveTo(cx - R * 0.3, top);
    ctx.lineTo(cx + R * 0.3, top);
    ctx.lineTo(cx + R * 3.1, cy + R * 1.9);
    ctx.lineTo(cx - R * 3.1, cy + R * 1.9);
    ctx.closePath();
    ctx.fill();

    // warm pool on the wall behind the board
    var pool = ctx.createRadialGradient(cx, cy - R * 0.2, R * 0.3, cx, cy, R * 2.15);
    pool.addColorStop(0, "rgba(255,198,124,0.24)");
    pool.addColorStop(0.5, "rgba(255,170,96,0.07)");
    pool.addColorStop(1, "rgba(255,150,80,0)");
    ctx.fillStyle = pool;
    ctx.beginPath(); ctx.arc(cx, cy, R * 2.15, 0, TAU); ctx.fill();
    ctx.restore();

    // board's drop shadow on the wall
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.ellipse(cx + R * 0.06, cy + R * 0.09, R * R_RING * 1.01, R * R_RING * 1.01, 0, 0, TAU);
    ctx.filter = "blur(1px)";
    ctx.fill();
    ctx.filter = "none";
    ctx.restore();

    // vignette
    var v = ctx.createRadialGradient(cx, cy, R * 1.2, cx, cy, Math.max(W, H) * 0.82);
    v.addColorStop(0, "rgba(0,0,0,0)");
    v.addColorStop(1, "rgba(0,0,0,0.62)");
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, W, H);
  }

  // a dart seen almost head-on: foreshortened barrel + the flight facing us
  // A dart stuck in the board is seen almost end-on from the throwing line:
  // heavily foreshortened, the flight sitting just above and slightly to the
  // side of the point, drooping toward you. Laying the shaft out at 35 degrees
  // across the board (the first version) read as a dart lying sideways on it.
  var DART_DX = -0.30, DART_DY = -0.95;   // point -> tail, in units of len

  function dartShape(g, len, tilt, scale, glow) {
    g.save();
    g.rotate(tilt);
    var w = 5.6 * scale;
    var tx = len * DART_DX, ty = len * DART_DY;
    var ax = Math.atan2(ty, tx);           // axis, point -> tail

    // steel barrel
    var sg = g.createLinearGradient(0, 0, tx, ty);
    sg.addColorStop(0, "#eef1f6");
    sg.addColorStop(0.35, "#aeb4be");
    sg.addColorStop(1, "#636973");
    g.strokeStyle = sg;
    g.lineWidth = w;
    g.lineCap = "round";
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(tx * 0.78, ty * 0.78);
    g.stroke();

    // knurling
    g.strokeStyle = "rgba(46,50,58,0.85)";
    g.lineWidth = w * 1.35;
    g.beginPath();
    g.moveTo(tx * 0.26, ty * 0.26);
    g.lineTo(tx * 0.5, ty * 0.5);
    g.stroke();

    // thin stem into the flight
    g.strokeStyle = "#8d939d";
    g.lineWidth = w * 0.55;
    g.beginPath();
    g.moveTo(tx * 0.74, ty * 0.74);
    g.lineTo(tx, ty);
    g.stroke();

    // flight: two vanes spread about the axis, seen from behind
    var fl = len * 0.42;
    var cols = glow ? ["#ffd98a", "#e0932f"] : ["#e8503f", "#f3a03a"];
    for (var i = 0; i < 2; i++) {
      var sign = i ? 1 : -1;
      var a1 = ax + sign * 0.42;
      g.fillStyle = cols[i];
      g.globalAlpha = i ? 0.86 : 1;
      g.beginPath();
      g.moveTo(tx, ty);
      g.lineTo(tx + Math.cos(a1) * fl, ty + Math.sin(a1) * fl);
      g.lineTo(tx + Math.cos(ax) * fl * 0.72, ty + Math.sin(ax) * fl * 0.72);
      g.closePath();
      g.fill();
    }
    g.globalAlpha = 1;

    // the point biting the sisal
    g.fillStyle = "rgba(255,255,255,0.85)";
    g.beginPath(); g.arc(0, 0, w * 0.4, 0, TAU); g.fill();
    g.restore();
  }

  function drawStuck() {
    for (var i = 0; i < stuck.length; i++) {
      var d = stuck[i];
      var q = REDMO ? 0 : d.quiver * Math.sin(d.age * 42) * 0.17;
      var len = R * 0.205;

      // shadow on the board face
      ctx.save();
      ctx.globalAlpha = 0.26;
      ctx.translate(d.x + R * 0.022, d.y + R * 0.024);
      ctx.fillStyle = "#000";
      ctx.beginPath();
      ctx.ellipse(len * DART_DX * 0.5, len * DART_DY * 0.5, len * 0.42, len * 0.13,
                  Math.atan2(DART_DY, DART_DX) + d.tilt, 0, TAU);
      ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.translate(d.x, d.y);
      dartShape(ctx, len, d.tilt + q, R / 260, false);
      ctx.restore();
    }
  }

  function drawFlying() {
    var t = fly.t;
    var e = t * t * (3 - 2 * t);
    // slight arc: lift the mid-point
    var mx = (fly.x0 + fly.x1) / 2;
    var my = (fly.y0 + fly.y1) / 2 - H * 0.06;
    var u = 1 - e;
    var x = u * u * fly.x0 + 2 * u * e * mx + e * e * fly.x1;
    var y = u * u * fly.y0 + 2 * u * e * my + e * e * fly.y1;
    var sc = lerp(2.9, 1, e);

    // motion streak
    ctx.save();
    ctx.globalAlpha = 0.22 * (1 - e);
    ctx.strokeStyle = "#ffd8a0";
    ctx.lineWidth = 3 * sc;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(lerp(x, fly.x0, 0.12), lerp(y, fly.y0, 0.12));
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.translate(x, y);
    dartShape(ctx, R * 0.205 * sc, fly.tilt + fly.spin * (1 - e), (R / 260) * sc, false);
    ctx.restore();
  }

  function drawDust() {
    for (var i = 0; i < dust.length; i++) {
      var d = dust[i];
      var a = 1 - d.t / d.life;
      ctx.fillStyle = "rgba(226,208,176," + (a * 0.5) + ")";
      ctx.beginPath();
      ctx.arc(d.x, d.y, 1.4 + a * 1.4, 0, TAU);
      ctx.fill();
    }
  }

  function drawReticle() {
    var x = aimX + swayX, y = aimY + swayY;
    var ringR = Math.max(7, amp * R * 1.05);
    // colour reads the steadiness: amber settling, green calm, red shaking
    var col = tension > 0.35
      ? "rgba(240,110,92," + (0.55 + tension * 0.35) + ")"
      : holding && amp < AMP_MIN * 1.9
        ? "rgba(112,224,158,0.92)"
        : "rgba(240,179,84,0.78)";

    ctx.save();
    ctx.strokeStyle = col;
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(x, y, ringR, 0, TAU); ctx.stroke();

    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.moveTo(x - ringR - 8, y); ctx.lineTo(x - ringR - 2, y);
    ctx.moveTo(x + ringR + 2, y); ctx.lineTo(x + ringR + 8, y);
    ctx.moveTo(x, y - ringR - 8); ctx.lineTo(x, y - ringR - 2);
    ctx.moveTo(x, y + ringR + 2); ctx.lineTo(x, y + ringR + 8);
    ctx.stroke();

    ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(x, y, 1.9, 0, TAU); ctx.fill();
    ctx.restore();
  }

  function drawFloaters() {
    for (var i = 0; i < floaters.length; i++) {
      var f = floaters[i];
      var t = f.t / 1.25;
      var a = t < 0.12 ? t / 0.12 : 1 - Math.pow((t - 0.12) / 0.88, 2);
      var pop = f.t < 0.16 ? 1 + (0.16 - f.t) * 2.4 : 1;
      var k = R / 260;
      ctx.save();
      ctx.globalAlpha = clamp(a, 0, 1);
      ctx.translate(f.x, f.y - t * 46);
      ctx.scale(pop, pop);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.shadowColor = "rgba(0,0,0,0.8)";
      ctx.shadowBlur = 12;
      ctx.fillStyle = f.col;
      // the points are what you are actually chasing, so they lead
      ctx.font = "800 " + Math.round((f.big ? 34 : 26) * k) + "px 'Geist', system-ui, sans-serif";
      ctx.fillText(f.txt, 0, 0);
      if (f.sub) {
        ctx.font = "700 " + Math.round(10.5 * k) + "px 'Geist Mono', ui-monospace, monospace";
        ctx.globalAlpha = clamp(a, 0, 1) * 0.78;
        ctx.fillText(f.sub, 0, Math.round((f.big ? 26 : 21) * k));
      }
      ctx.restore();
    }
  }

  // the darts still in hand, racked along the bottom
  function drawHand() {
    if (state === "menu") return;
    // `thrown` only increments on landing, so a dart in flight is still counted
    var left = DARTS_PER_ROUND - thrown - (state === "fly" ? 1 : 0);
    if (left <= 0) return;
    var s = Math.min(1, R / 260);
    var gap = 20 * s;
    var y = H - 26;
    var startX = W / 2 - (left - 1) * gap / 2;
    ctx.save();
    ctx.globalAlpha = 0.62;
    for (var i = 0; i < left; i++) {
      ctx.save();
      ctx.translate(startX + i * gap, y);
      ctx.rotate(-0.5);
      dartShape(ctx, 30 * s, 0, s * 0.85, false);
      ctx.restore();
    }
    ctx.restore();
  }

  // ==================================================================== LOOP
  function frame(ts) {
    if (!last) last = ts;
    var dt = Math.min(0.05, (ts - last) / 1000);
    last = ts;
    update(dt);
    draw();
    requestAnimationFrame(frame);
  }

  document.addEventListener("visibilitychange", function () {
    if (document.hidden && holding) release();
  });

  resize();
  requestAnimationFrame(frame);
})();
