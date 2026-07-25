/* Singing Bowl — No. 098
 * Circle the rim and friction feeds the bowl's modes until it blooms; tap the
 * side for a struck gong.
 *
 * The synthesis is a standing resonator, not a sample trigger. Four bell-shell
 * modes are held open the whole time and their energies are driven by what you
 * do; each mode is a PAIR of oscillators a fraction of a hertz apart, because
 * a real bowl is never perfectly round and that slow warble is the whole
 * signature of the instrument. Partial ratios come from the thin circular
 * shell modes m(m^2-1)/sqrt(m^2+1), normalised to m=2 → 1 : 2.83 : 5.42 : 8.77.
 *
 * Vanilla Canvas 2D + Web Audio. Self-contained.
 * localStorage: "bowl_size", "bowl_sound". */
(function () {
  "use strict";

  var TAU = Math.PI * 2;

  var canvas = document.getElementById("canvas");
  var ctx = canvas.getContext("2d");
  var sizesWrap = document.getElementById("sizes");
  var soundBtn = document.getElementById("soundBtn");
  var hint = document.getElementById("hint");

  var REDMO = false;
  try { REDMO = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) {}

  // ------------------------------------------------------------------ bowls
  // a real bowl's fundamental sits between roughly 140 and 320 Hz
  var BOWLS = [
    { n: "S", f: 261.63, name: "Small" },
    { n: "M", f: 196.00, name: "Medium" },
    { n: "L", f: 146.83, name: "Large" }
  ];
  var sizeIdx = 1;

  // Thin circular shell modes m(m^2-1)/sqrt(m^2+1) for m = 2..7, normalised to
  // m=2. Four modes sounded like a synth pad; the metallic shimmer of real
  // bronze lives in the modes ABOVE that, and they have to be genuine
  // inharmonic partials — stacking harmonics on a sine just muddies it.
  var PARTIALS = [1, 2.828, 5.423, 8.771, 12.866, 17.709];
  // each mode is a PAIR split by this much; the beat quickens up the series
  var BEATS = [0.8, 1.3, 2.1, 3.0, 4.2, 5.5];             // Hz
  var DECAY = [0.14, 0.26, 0.50, 0.85, 1.30, 1.90];       // energy loss / sec
  var LEVEL = [0.32, 0.21, 0.115, 0.062, 0.036, 0.021];

  // ------------------------------------------------------------------- state
  var energy = [0, 0, 0, 0, 0, 0];
  var rubbing = false, rubSpeed = 0, rubAng = 0, rubShown = 0;
  var pressed = false, pressT = 0, pressMove = 0, pressX = 0, pressY = 0;
  var lastAng = null;
  var amp = 0;              // smoothed loudness for the visuals
  var strikeT = 0;
  var rings = [];
  var drops = [];
  var motes = [];
  var t0 = 0;

  var dpr = 1, W = 0, H = 0;
  var cx = 0, cy = 0, R = 0, RY = 0;   // bowl centre, rim radii (ellipse)
  var bowlCv = null, bowlPad = 0;
  var last = 0;

  // ------------------------------------------------------------ persistence
  var soundOn = true;
  try { var sv = parseInt(localStorage.getItem("bowl_size"), 10); if (sv >= 0 && sv < BOWLS.length) sizeIdx = sv; } catch (e) {}
  try { if (localStorage.getItem("bowl_sound") === "0") soundOn = false; } catch (e) {}
  soundBtn.setAttribute("aria-pressed", soundOn ? "true" : "false");

  function rnd(a, b) { return a + Math.random() * (b - a); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  // ================================================================== AUDIO
  var AC = null, outGain = null, bowlBus = null, verbGain = null;
  var voices = [];          // {oscA, oscB, gain}
  var rubSrc = null, rubFilt = null, rubGain = null, noiseBuf = null;

  function initAudio() {
    if (AC) return;
    try { AC = new (window.AudioContext || window.webkitAudioContext)(); }
    catch (e) { AC = null; return; }

    outGain = AC.createGain();
    outGain.gain.value = soundOn ? 1 : 0;

    // master chain: silk lowpass -> gentle glue -> out
    var lp = AC.createBiquadFilter();
    lp.type = "lowpass"; lp.frequency.value = 11000; lp.Q.value = 0.5;

    var comp = AC.createDynamicsCompressor();
    comp.threshold.value = -15; comp.knee.value = 28; comp.ratio.value = 3;
    comp.attack.value = 0.01; comp.release.value = 0.4;

    var master = AC.createGain(); master.gain.value = 0.95;

    // A long, smooth hall. The first version also ran a 0.62s feedback delay,
    // which on a sustained drone reads as a delay pedal rather than a room —
    // a bowl does not echo, it blooms. Removed; the reverb carries the space.
    var verb = AC.createConvolver();
    verb.buffer = makeImpulse(6, 1.7);
    verbGain = AC.createGain(); verbGain.gain.value = 0.85;

    var shimmer = AC.createBiquadFilter();
    shimmer.type = "highshelf"; shimmer.frequency.value = 3000; shimmer.gain.value = 5;

    var verbCut = AC.createBiquadFilter();
    verbCut.type = "highpass"; verbCut.frequency.value = 150;

    // a short pre-delay keeps the strike transient in front of the tail
    var pre = AC.createDelay(0.2);
    pre.delayTime.value = 0.028;

    bowlBus = AC.createGain();
    bowlBus.gain.value = 1;

    bowlBus.connect(lp);
    bowlBus.connect(verbCut);
    verbCut.connect(pre); pre.connect(verb);
    verb.connect(shimmer); shimmer.connect(verbGain); verbGain.connect(lp);

    lp.connect(comp); comp.connect(master); master.connect(outGain);
    outGain.connect(AC.destination);

    var len = Math.floor(AC.sampleRate * 2);
    noiseBuf = AC.createBuffer(1, len, AC.sampleRate);
    var d = noiseBuf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    buildVoices();
    buildRub();
  }

  function makeImpulse(dur, decay) {
    var rate = AC.sampleRate, len = Math.max(1, Math.floor(rate * dur));
    var buf = AC.createBuffer(2, len, rate);
    for (var ch = 0; ch < 2; ch++) {
      var d = buf.getChannelData(ch), prev = 0;
      for (var i = 0; i < len; i++) {
        var t = i / len, env = Math.pow(1 - t, decay);
        // low-passed noise keeps the tail smooth instead of grainy
        prev = prev + 0.13 * ((Math.random() * 2 - 1) - prev);
        d[i] = prev * env;
      }
    }
    return buf;
  }

  function buildVoices() {
    for (var i = 0; i < PARTIALS.length; i++) {
      var g = AC.createGain();
      g.gain.value = 0.0001;
      // spread the modes across the field so the bowl has width
      var pan = null;
      if (AC.createStereoPanner) {
        pan = AC.createStereoPanner();
        pan.pan.value = (i % 2 ? 1 : -1) * (0.1 + i * 0.07);
        g.connect(pan); pan.connect(bowlBus);
      } else g.connect(bowlBus);

      var a = AC.createOscillator(), b = AC.createOscillator();
      a.type = "sine"; b.type = "sine";
      var ga = AC.createGain(), gb = AC.createGain();
      ga.gain.value = 0.5; gb.gain.value = 0.5;
      a.connect(ga); ga.connect(g);
      b.connect(gb); gb.connect(g);
      a.start(); b.start();
      voices.push({ a: a, b: b, g: g });
    }
    tuneVoices(0);
  }

  function tuneVoices(glide) {
    if (!AC || !voices.length) return;
    var f0 = BOWLS[sizeIdx].f;
    for (var i = 0; i < voices.length; i++) {
      var f = f0 * PARTIALS[i];
      var half = BEATS[i] / 2;
      try {
        if (glide > 0) {
          voices[i].a.frequency.setTargetAtTime(f - half, AC.currentTime, glide);
          voices[i].b.frequency.setTargetAtTime(f + half, AC.currentTime, glide);
        } else {
          voices[i].a.frequency.setValueAtTime(f - half, AC.currentTime);
          voices[i].b.frequency.setValueAtTime(f + half, AC.currentTime);
        }
      } catch (e) {}
    }
  }

  // the friction layer: what your finger actually sounds like on bronze
  function buildRub() {
    rubSrc = AC.createBufferSource();
    rubSrc.buffer = noiseBuf;
    rubSrc.loop = true;
    rubFilt = AC.createBiquadFilter();
    rubFilt.type = "bandpass";
    rubFilt.frequency.value = 900;
    rubFilt.Q.value = 4.5;
    rubGain = AC.createGain();
    rubGain.gain.value = 0.0001;
    rubSrc.connect(rubFilt); rubFilt.connect(rubGain); rubGain.connect(bowlBus);
    rubSrc.start(0);
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

  // the mallet's first contact — wood on bronze, before the bowl answers
  function mallet(vel) {
    if (!AC || !soundOn || !noiseBuf) return;
    var t = AC.currentTime;
    var s = AC.createBufferSource();
    s.buffer = noiseBuf;
    var f = AC.createBiquadFilter();
    f.type = "bandpass"; f.frequency.setValueAtTime(2600, t);
    f.frequency.exponentialRampToValueAtTime(700, t + 0.09);
    f.Q.value = 1.1;
    var g = AC.createGain();
    g.gain.setValueAtTime(0.16 * vel, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
    s.connect(f); f.connect(g); g.connect(bowlBus);
    s.start(t, rnd(0, 1)); s.stop(t + 0.14);

    var o = AC.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(240, t);
    o.frequency.exponentialRampToValueAtTime(120, t + 0.07);
    var og = AC.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.1 * vel, t + 0.003);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    o.connect(og); og.connect(bowlBus);
    o.start(t); o.stop(t + 0.14);
  }

  function plip(pan) {
    if (!AC || !soundOn) return;
    var t = AC.currentTime;
    var o = AC.createOscillator();
    o.type = "sine";
    var f = rnd(900, 1700);
    o.frequency.setValueAtTime(f * 0.55, t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.045);
    var g = AC.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    o.connect(g);
    if (AC.createStereoPanner) {
      var p = AC.createStereoPanner(); p.pan.value = clamp(pan, -1, 1);
      g.connect(p); p.connect(bowlBus);
    } else g.connect(bowlBus);
    o.start(t); o.stop(t + 0.14);
  }

  function strike(vel) {
    unlockAudio();
    if (!AC) return;
    mallet(vel);
    // A strike excites every mode at once, highs loudest but shortest — that
    // bright bronze bite is the whole difference between a struck bowl and a
    // swelling pad.
    for (var i = 0; i < energy.length; i++) {
      energy[i] = Math.min(1.3, energy[i] + vel * Math.pow(0.74, i));
      // Jump the gain there NOW. Letting the per-frame follower (a 40ms time
      // constant) ramp it up turned every strike into a slow swell.
      if (voices[i]) {
        try {
          var g = voices[i].g.gain, t = AC.currentTime;
          g.cancelScheduledValues(t);
          g.setValueAtTime(Math.max(0.00001, g.value), t);
          g.linearRampToValueAtTime(Math.max(0.00001, energy[i] * LEVEL[i]), t + 0.006);
        } catch (e) {}
      }
    }
    strikeT = 1;
    rings.push({ r: 0, a: 1, w: 3 });
  }

  soundBtn.addEventListener("click", function () {
    soundOn = !soundOn;
    soundBtn.setAttribute("aria-pressed", soundOn ? "true" : "false");
    try { localStorage.setItem("bowl_sound", soundOn ? "1" : "0"); } catch (e) {}
    if (outGain && AC) {
      try { outGain.gain.setTargetAtTime(soundOn ? 1 : 0, AC.currentTime, 0.03); }
      catch (e) { outGain.gain.value = soundOn ? 1 : 0; }
    }
    unlockAudio();
  });

  // ================================================================== SIZES
  BOWLS.forEach(function (b, i) {
    var el = document.createElement("button");
    el.type = "button";
    el.className = "size";
    el.textContent = b.n;
    el.setAttribute("role", "radio");
    el.setAttribute("aria-label", b.name + " bowl");
    el.setAttribute("aria-checked", i === sizeIdx ? "true" : "false");
    el.addEventListener("click", function () {
      sizeIdx = i;
      try { localStorage.setItem("bowl_size", String(i)); } catch (e) {}
      for (var k = 0; k < sizesWrap.children.length; k++) {
        sizesWrap.children[k].setAttribute("aria-checked", k === i ? "true" : "false");
      }
      unlockAudio();
      tuneVoices(0.06);
      resize();
    });
    sizesWrap.appendChild(el);
  });

  // ================================================================= SIZING
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // bigger bowls really are bigger
    var scale = [0.82, 1, 1.16][sizeIdx];
    R = Math.min(W * 0.33, H * 0.29) * scale;
    RY = R * 0.34;
    cx = W / 2;
    cy = H * 0.46;

    buildBowl();
    motes = [];
    for (var i = 0; i < 26; i++) {
      motes.push({ x: rnd(0, W), y: rnd(0, H), r: rnd(0.6, 2), s: rnd(4, 16), p: rnd(0, TAU) });
    }
  }
  window.addEventListener("resize", resize);
  window.addEventListener("orientationchange", function () {
    resize(); setTimeout(resize, 180); setTimeout(resize, 520);
  });

  // ============================================================ BOWL SPRITE
  function buildBowl() {
    var depth = R * 1.02;
    var pad = Math.ceil(R * 1.35);
    var padY = Math.ceil(depth + RY * 2.6);
    var cv = document.createElement("canvas");
    cv.width = pad * 2; cv.height = padY * 2;
    var c = cv.getContext("2d");
    c.translate(pad, padY);

    // ---- cushion under the bowl
    var cuY = depth * 0.92;
    var cuR = R * 1.1;
    // contact shadow first so the bowl sits IN the cushion
    var csh = c.createRadialGradient(0, cuY, R * 0.1, 0, cuY, cuR * 1.3);
    csh.addColorStop(0, "rgba(0,0,0,0.8)");
    csh.addColorStop(1, "rgba(0,0,0,0)");
    c.fillStyle = csh;
    c.beginPath(); c.ellipse(0, cuY, cuR * 1.3, RY * 2, 0, 0, TAU); c.fill();

    // outer roll
    var cug = c.createLinearGradient(-cuR * 0.6, cuY - RY, cuR * 0.7, cuY + RY * 1.5);
    cug.addColorStop(0, "#8d3348");
    cug.addColorStop(0.34, "#5d1e2e");
    cug.addColorStop(0.72, "#33101a");
    cug.addColorStop(1, "#15060a");
    c.fillStyle = cug;
    c.beginPath(); c.ellipse(0, cuY, cuR, RY * 1.2, 0, 0, TAU); c.fill();
    c.save();
    c.beginPath(); c.ellipse(0, cuY, cuR, RY * 1.2, 0, 0, TAU); c.clip();
    // gathered pleats, tighter toward the middle where the bowl presses down
    for (var fi = 0; fi < 26; fi++) {
      var fa = (fi / 26) * TAU;
      c.strokeStyle = fi % 2 ? "rgba(0,0,0,0.34)" : "rgba(236,168,186,0.12)";
      c.lineWidth = R * 0.015;
      c.beginPath();
      c.moveTo(Math.cos(fa) * cuR * 0.36, cuY + Math.sin(fa) * RY * 0.42);
      c.quadraticCurveTo(Math.cos(fa) * cuR * 0.8, cuY + Math.sin(fa) * RY * 0.86,
                         Math.cos(fa) * cuR * 1.06, cuY + Math.sin(fa) * RY * 1.3);
      c.stroke();
    }
    // dark inner well
    var well = c.createRadialGradient(0, cuY - RY * 0.5, R * 0.05, 0, cuY - RY * 0.3, R * 0.9);
    well.addColorStop(0, "rgba(0,0,0,0.82)");
    well.addColorStop(1, "rgba(0,0,0,0)");
    c.fillStyle = well;
    c.fillRect(-cuR, cuY - RY * 2, cuR * 2, RY * 4);
    c.restore();

    // ---- bowl body: a rounded U from rim to rim
    c.beginPath();
    c.moveTo(-R, 0);
    c.bezierCurveTo(-R * 0.99, depth * 0.72, -R * 0.55, depth, 0, depth);
    c.bezierCurveTo(R * 0.55, depth, R * 0.99, depth * 0.72, R, 0);
    c.closePath();

    // Metal is all about value banding ACROSS the form: dark edge, reflected
    // light, a hot specular band, then a fast fall to near-black and a thin
    // rim-light on the shadow side. A soft diagonal wash reads as pottery.
    var bg = c.createLinearGradient(-R, 0, R, 0);
    bg.addColorStop(0.00, "#1f1305");
    bg.addColorStop(0.07, "#6d4a1c");
    bg.addColorStop(0.18, "#dcb166");
    bg.addColorStop(0.28, "#fff3d2");
    bg.addColorStop(0.38, "#c99542");
    bg.addColorStop(0.56, "#8d6124");
    bg.addColorStop(0.74, "#4e3312");
    bg.addColorStop(0.88, "#1e1206");
    bg.addColorStop(0.97, "#6a481d");
    bg.addColorStop(1.00, "#2a1a08");
    c.fillStyle = bg;
    c.fill();
    // then the vertical falloff into the bottom of the belly
    var vg2 = c.createLinearGradient(0, -RY, 0, depth);
    vg2.addColorStop(0, "rgba(255,244,214,0.16)");
    vg2.addColorStop(0.42, "rgba(0,0,0,0.05)");
    vg2.addColorStop(1, "rgba(0,0,0,0.68)");
    c.fillStyle = vg2;
    c.fill();

    // hammered dimples
    c.save();
    c.clip();
    for (var i = 0; i < 150; i++) {
      var a = rnd(0, Math.PI);
      var rr = Math.sqrt(Math.random());
      var x = Math.cos(a + Math.PI) * R * rr * (Math.random() < 0.5 ? 1 : -1) * 0.98;
      var y = rnd(-RY * 0.3, depth * 0.98);
      var sz = rnd(R * 0.012, R * 0.026);
      // a dent is a dark upper lip with a lit lower lip, not a bright dot
      c.fillStyle = "rgba(22,12,0,0.16)";
      c.beginPath(); c.ellipse(x, y - sz * 0.22, sz, sz * 0.44, 0, 0, TAU); c.fill();
      c.fillStyle = "rgba(255,240,205,0.13)";
      c.beginPath(); c.ellipse(x, y + sz * 0.26, sz * 0.82, sz * 0.34, 0, 0, TAU); c.fill();
    }
    // lathe rings around the outside
    c.globalAlpha = 0.16;
    c.strokeStyle = "#2a1704";
    for (var lr = 0; lr < 9; lr++) {
      var ly = depth * (0.12 + lr * 0.095);
      var lw = R * Math.sqrt(Math.max(0, 1 - Math.pow(ly / depth, 1.7)));
      c.lineWidth = Math.max(0.8, R * 0.008);
      c.beginPath();
      c.ellipse(0, ly, lw, RY * (0.35 + lr * 0.03), 0, 0, Math.PI);
      c.stroke();
    }
    c.globalAlpha = 1;
    // vertical falloff at the sides
    var side = c.createLinearGradient(-R, 0, R, 0);
    side.addColorStop(0, "rgba(0,0,0,0.45)");
    side.addColorStop(0.28, "rgba(0,0,0,0)");
    side.addColorStop(0.72, "rgba(0,0,0,0)");
    side.addColorStop(1, "rgba(0,0,0,0.5)");
    c.fillStyle = side;
    c.fillRect(-R, -RY, R * 2, depth + RY);
    c.restore();

    // ---- rim: the bright band you actually rub
    c.lineWidth = Math.max(2, R * 0.045);
    var rg = c.createLinearGradient(-R, 0, R, 0);
    rg.addColorStop(0, "#8a5c1d");
    rg.addColorStop(0.3, "#ffe6b0");
    rg.addColorStop(0.55, "#d6a45c");
    rg.addColorStop(0.8, "#ffe0a2");
    rg.addColorStop(1, "#7d5015");
    c.strokeStyle = rg;
    c.beginPath(); c.ellipse(0, 0, R, RY, 0, 0, TAU); c.stroke();

    // ---- interior
    c.save();
    c.beginPath(); c.ellipse(0, 0, R - c.lineWidth * 0.5, RY - c.lineWidth * 0.3, 0, 0, TAU);
    c.clip();
    var ig = c.createRadialGradient(-R * 0.2, -RY * 0.4, R * 0.05, 0, RY * 0.2, R);
    ig.addColorStop(0, "#6b4718");
    ig.addColorStop(0.55, "#452c0c");
    ig.addColorStop(1, "#1e1205");
    c.fillStyle = ig;
    c.fillRect(-R, -RY * 2, R * 2, RY * 4);
    c.restore();

    bowlCv = cv;
    bowlPad = pad;
    bowlCv._padY = padY;
    bowlCv._depth = depth;
  }

  // ================================================================== INPUT
  function pointAt(e) {
    var r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  canvas.addEventListener("pointerdown", function (e) {
    unlockAudio();
    try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
    var p = pointAt(e);
    pressed = true; pressT = 0; pressMove = 0;
    pressX = p.x; pressY = p.y;
    lastAng = Math.atan2((p.y - cy) / Math.max(0.001, RY / R), p.x - cx);
    rubbing = false;
    hint.classList.add("is-gone");
  });

  canvas.addEventListener("pointermove", function (e) {
    if (!pressed) return;
    var p = pointAt(e);
    pressMove += Math.hypot(p.x - pressX, p.y - pressY);
    pressX = p.x; pressY = p.y;
    // work in a circle-normalised space so the ellipse doesn't skew the speed
    var a = Math.atan2((p.y - cy) / Math.max(0.001, RY / R), p.x - cx);
    if (lastAng !== null) {
      var d = a - lastAng;
      while (d > Math.PI) d -= TAU;
      while (d < -Math.PI) d += TAU;
      // rad/frame → normalised 0..1 rub speed, smoothed
      rubSpeed = clamp(Math.abs(d) * 26, 0, 1.35);
      rubAng = a;
      if (pressMove > 10) rubbing = true;
    }
    lastAng = a;
  });

  function endPress() {
    if (!pressed) return;
    pressed = false;
    // a quick contact with almost no travel is a strike, not a rub
    if (!rubbing && pressT < 0.32 && pressMove < 14) {
      strike(clamp(0.55 + Math.random() * 0.2, 0.4, 0.95));
    }
    rubbing = false;
    rubSpeed = 0;
    lastAng = null;
  }
  canvas.addEventListener("pointerup", endPress);
  canvas.addEventListener("pointercancel", endPress);

  window.addEventListener("keydown", function (e) {
    if (e.code === "Space" || e.key === " ") { e.preventDefault(); strike(0.75); hint.classList.add("is-gone"); }
  });

  document.addEventListener("visibilitychange", function () {
    if (document.hidden) { pressed = false; rubbing = false; rubSpeed = 0; }
  });

  // ================================================================= UPDATE
  function update(dt) {
    t0 += dt;
    if (pressed) pressT += dt;

    // friction feeds the modes: the fundamental takes almost anything, the
    // upper modes only wake up once you're moving properly
    if (rubbing && rubSpeed > 0.05) {
      var sp = clamp(rubSpeed, 0, 1.2);
      // Mode 2 is what you actually hear as "the" note of a rubbed bowl, so it
      // has to arrive early — the first curve kept it buried until you were
      // whipping the rim, which left a slow rub sounding like a bare sine.
      var feed = [
        1,
        0.85 * Math.pow(sp, 0.6),
        0.4 * Math.pow(sp, 1.4),
        0.16 * sp * sp,
        0.06 * Math.pow(sp, 2.6),
        0.02 * Math.pow(sp, 3)
      ];
      for (var i = 0; i < energy.length; i++) {
        energy[i] = Math.min(1.2, energy[i] + feed[i] * sp * dt * 1.6);
      }
    }
    rubShown += ((rubbing ? rubSpeed : 0) - rubShown) * Math.min(1, dt * 9);

    for (var k = 0; k < energy.length; k++) {
      energy[k] *= Math.exp(-DECAY[k] * dt);
      if (energy[k] < 0.0002) energy[k] = 0;
    }

    // push the envelope into the graph
    if (AC && voices.length) {
      // The hand going round is audible as a slow wah — a real bowl is never
      // perfectly even under a moving finger.
      var wob = rubbing ? 1 + Math.sin(rubAng * 2) * 0.14 * rubShown : 1;
      for (var v = 0; v < voices.length; v++) {
        var target = Math.max(0.00001, energy[v] * LEVEL[v] * wob);
        try { voices[v].g.gain.setTargetAtTime(target, AC.currentTime, 0.04); } catch (e) {}
      }
      if (rubGain) {
        // stick-slip: friction grabs and releases rather than hissing evenly
        var slip = 1 + Math.sin(t0 * 34 + rubAng * 6) * 0.35;
        var rv = rubbing ? (0.008 + rubShown * 0.02) * slip : 0.00001;
        try {
          rubGain.gain.setTargetAtTime(soundOn ? rv : 0.00001, AC.currentTime, 0.05);
          // keep the rasp pitched around the singing mode, not a wide hiss
          var f0 = BOWLS[sizeIdx].f;
          rubFilt.frequency.setTargetAtTime(f0 * 2.83 * (1 + rubShown * 0.5), AC.currentTime, 0.12);
        } catch (e) {}
      }
    }

    amp += (energy[0] * 0.72 + energy[1] * 0.28 - amp) * Math.min(1, dt * 5);
    if (strikeT > 0) strikeT = Math.max(0, strikeT - dt * 1.6);

    // rings pulse out of the rim in time with the bowl
    if (amp > 0.06 && Math.random() < dt * (2 + amp * 7)) {
      rings.push({ r: 0, a: clamp(amp, 0, 1) * 0.8, w: 1.6 });
    }
    for (var r2 = rings.length - 1; r2 >= 0; r2--) {
      var rg = rings[r2];
      rg.r += dt * (0.5 + rg.a) * R * 1.15;
      rg.a -= dt * 0.5;
      if (rg.a <= 0) rings.splice(r2, 1);
    }

    // water leaps once it's genuinely loud
    if (amp > 0.44 && Math.random() < dt * (amp - 0.4) * 42) {
      var da = rnd(0, TAU), dr = Math.sqrt(Math.random()) * R * 0.72;
      drops.push({
        x: cx + Math.cos(da) * dr, y: cy + Math.sin(da) * dr * (RY / R),
        vy: -rnd(40, 40 + amp * 150), t: 0, life: rnd(0.35, 0.75), r: rnd(1.4, 3.2)
      });
      if (Math.random() < 0.4) plip(clamp(Math.cos(da) * 0.6, -1, 1));
    }
    for (var d2 = drops.length - 1; d2 >= 0; d2--) {
      var dp = drops[d2];
      dp.t += dt; dp.y += dp.vy * dt; dp.vy += 420 * dt;
      if (dp.t > dp.life) drops.splice(d2, 1);
    }
  }

  // =================================================================== DRAW
  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // room
    var g = ctx.createRadialGradient(cx, cy - R * 0.4, R * 0.2, cx, cy, Math.max(W, H) * 0.85);
    g.addColorStop(0, "#1c1410");
    g.addColorStop(0.5, "#120d0a");
    g.addColorStop(1, "#070505");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // the bowl's own light, rising with the ring
    if (amp > 0.005) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      var bloom = ctx.createRadialGradient(cx, cy, R * 0.1, cx, cy, R * (2.2 + amp));
      bloom.addColorStop(0, "rgba(255,190,110," + (0.16 * amp + strikeT * 0.1).toFixed(3) + ")");
      bloom.addColorStop(0.4, "rgba(255,160,80," + (0.07 * amp).toFixed(3) + ")");
      bloom.addColorStop(1, "rgba(255,140,60,0)");
      ctx.fillStyle = bloom;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }

    drawMotes();
    drawRings();

    // bowl sprite
    if (bowlCv) ctx.drawImage(bowlCv, cx - bowlPad, cy - bowlCv._padY);

    drawWater();
    drawDrops();
    if (rubbing || amp > 0.02) drawMallet();

    // a breath of vignette to keep the eye in the middle
    var v = ctx.createRadialGradient(cx, cy, R * 1.1, cx, cy, Math.max(W, H) * 0.8);
    v.addColorStop(0, "rgba(0,0,0,0)");
    v.addColorStop(1, "rgba(0,0,0,0.55)");
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, W, H);
  }

  function drawMotes() {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (var i = 0; i < motes.length; i++) {
      var m = motes[i];
      var y = m.y - ((t0 * m.s) % (H + 40));
      if (y < -20) y += H + 40;
      var x = m.x + Math.sin(t0 * 0.3 + m.p) * 14;
      ctx.globalAlpha = 0.1 + amp * 0.22;
      ctx.fillStyle = "#ffd39a";
      ctx.beginPath(); ctx.arc(x, y, m.r, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  function drawRings() {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (var i = 0; i < rings.length; i++) {
      var r = rings[i];
      ctx.globalAlpha = clamp(r.a, 0, 1) * 0.26;
      ctx.strokeStyle = "#ffcb84";
      ctx.lineWidth = r.w;
      ctx.beginPath();
      ctx.ellipse(cx, cy, R + r.r, RY + r.r * (RY / R), 0, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
  }

  // the water surface: concentric contours that ripple harder as it rings
  function drawWater() {
    var wr = R * 0.82, wry = RY * 0.82;
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(cx, cy + RY * 0.1, wr, wry, 0, 0, TAU);
    ctx.clip();

    var wg = ctx.createLinearGradient(cx, cy - wry, cx, cy + wry);
    wg.addColorStop(0, "rgba(58,72,74,0.85)");
    wg.addColorStop(0.5, "rgba(30,40,42,0.9)");
    wg.addColorStop(1, "rgba(18,24,26,0.92)");
    ctx.fillStyle = wg;
    ctx.fillRect(cx - wr, cy - wry * 2, wr * 2, wry * 4);

    // standing radial wave — the pattern a rung bowl actually throws
    var lobes = 2 + Math.min(3, Math.floor(amp * 5));
    var wob = amp * RY * 0.5;
    ctx.globalCompositeOperation = "lighter";
    for (var k = 1; k <= 6; k++) {
      var f = k / 6;
      ctx.beginPath();
      for (var s = 0; s <= 64; s++) {
        var a = (s / 64) * TAU;
        var mod = 1 + Math.sin(a * lobes + t0 * 5.5) * 0.05 * amp * k;
        var x = cx + Math.cos(a) * wr * f * mod;
        var y = cy + RY * 0.1 + Math.sin(a) * wry * f * mod + Math.sin(a * lobes + t0 * 5.5) * wob * f * 0.4;
        if (s === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.strokeStyle = "rgba(180,220,235," + (0.05 + amp * 0.2) + ")";
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // reflected rim light on the water
    var sh = ctx.createRadialGradient(cx - wr * 0.3, cy - wry * 0.5, 1, cx - wr * 0.3, cy - wry * 0.4, wr * 0.9);
    sh.addColorStop(0, "rgba(255,214,150," + (0.14 + amp * 0.24) + ")");
    sh.addColorStop(1, "rgba(255,190,120,0)");
    ctx.fillStyle = sh;
    ctx.fillRect(cx - wr, cy - wry * 2, wr * 2, wry * 4);
    ctx.restore();
  }

  function drawDrops() {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (var i = 0; i < drops.length; i++) {
      var d = drops[i];
      var a = 1 - d.t / d.life;
      ctx.globalAlpha = clamp(a, 0, 1) * 0.9;
      ctx.fillStyle = "#cfeaf5";
      ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  // the puja stick riding the rim where your finger is
  function drawMallet() {
    var a = rubbing ? rubAng : -Math.PI / 2;
    var x = cx + Math.cos(a) * R;
    var y = cy + Math.sin(a) * RY;
    var len = R * 0.62, w = R * 0.05;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-0.5 + Math.cos(a) * 0.35);
    ctx.globalAlpha = rubbing ? 1 : 0.35;

    // suede-wrapped head
    var hg = ctx.createLinearGradient(0, -w, 0, w * 1.4);
    hg.addColorStop(0, "#e6d4b6");
    hg.addColorStop(1, "#8d7047");
    ctx.fillStyle = hg;
    ctx.beginPath(); ctx.ellipse(0, 0, w * 2.1, w * 1.7, 0, 0, TAU); ctx.fill();

    // wooden shaft leaning away from the bowl
    var sg = ctx.createLinearGradient(-w, -len * 0.5, w, -len * 0.5);
    sg.addColorStop(0, "#3a2610");
    sg.addColorStop(0.35, "#b78a4e");
    sg.addColorStop(0.6, "#8a6432");
    sg.addColorStop(1, "#2d1d0b");
    ctx.strokeStyle = sg;
    ctx.lineWidth = w * 2.1;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-len * 0.34, -len);
    ctx.stroke();
    ctx.strokeStyle = "rgba(18,10,2,0.55)";
    ctx.lineWidth = w * 0.3;
    ctx.beginPath();
    ctx.moveTo(w * 0.75, -w * 0.2);
    ctx.lineTo(-len * 0.34 + w * 0.7, -len);
    ctx.stroke();
    ctx.restore();

    // contact glow
    if (rubbing) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      var cg = ctx.createRadialGradient(x, y, 1, x, y, R * 0.3);
      cg.addColorStop(0, "rgba(255,220,150," + (0.25 + rubShown * 0.4) + ")");
      cg.addColorStop(1, "rgba(255,200,120,0)");
      ctx.fillStyle = cg;
      ctx.beginPath(); ctx.arc(x, y, R * 0.3, 0, TAU); ctx.fill();
      ctx.restore();
    }
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

  resize();
  requestAnimationFrame(frame);
})();
