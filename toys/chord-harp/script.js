/* Chord Harp — a field of strings that only ever lets the right ones ring.
 *
 * This is the chord-zither idea: hold a chord, sweep the whole field, and the
 * bars damp every string outside that chord so a careless strum is still in
 * key. You cannot play a wrong note, which is the entire point — it is the
 * instrument for people who play nothing.
 *
 * The strings are Karplus-Strong, rendered offline into AudioBuffers and
 * cached. A noise burst circulating through a delay line one period long, with
 * a little lowpass loss on each trip, IS a plucked string: the loss is why the
 * bright attack decays into a pure tone, and why high notes die faster than low
 * ones. Three variants per note plus a few cents of playback-rate drift keep a
 * fast strum from sounding like one sample retriggered.
 *
 * Vanilla Canvas 2D + Web Audio. Nothing sampled.
 */
(function () {
  "use strict";

  var canvas = document.getElementById("canvas");
  var ctx = canvas.getContext("2d");

  var W = 0, H = 0, DPR = 1;
  var ENV_STEPS = 16;   // segments used for the string and its vibration envelope
  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function midiToFreq(m) { return 440 * Math.pow(2, (m - 69) / 12); }

  // ---------------------------------------------------------------- chords

  /* A working set in C: the three primaries, their relative minors and two
   * dominants. Enough to play most folk songs and small enough to read on a
   * phone without a scroll. */
  var CHORDS = [
    { name: "C",  pcs: [0, 4, 7],       root: 48 },
    { name: "Am", pcs: [9, 0, 4],       root: 45 },
    { name: "F",  pcs: [5, 9, 0],       root: 41 },
    { name: "Dm", pcs: [2, 5, 9],       root: 50 },
    { name: "G7", pcs: [7, 11, 2, 5],   root: 43 },
    { name: "E7", pcs: [4, 8, 11, 2],   root: 40 }
  ];
  var chordIdx = 0;

  var LOW = 48, HIGH = 72;          // C3 to C5, chromatic
  var strings = [];

  function buildStrings() {
    strings = [];
    var lo = LOW, hi = W < 620 ? 67 : HIGH;
    for (var m = lo; m <= hi; m++) {
      strings.push({
        midi: m,
        freq: midiToFreq(m),
        pc: ((m % 12) + 12) % 12,
        amp: 0,          // visual vibration amplitude
        phase: 0,
        lit: 0
      });
    }
  }

  function inChord(s) {
    return CHORDS[chordIdx].pcs.indexOf(s.pc) >= 0;
  }

  // ---------------------------------------------------------------- layout

  var lay = { x0: 0, gap: 0, top: 0, bot: 0 };

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.floor(W * DPR); canvas.height = Math.floor(H * DPR);
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

    var before = strings.length;
    buildStrings();
    if (strings.length !== before) { /* count changed with the breakpoint */ }

    var margin = Math.max(22, W * 0.06);
    lay.gap = (W - margin * 2) / (strings.length - 1);
    lay.x0 = margin;
    lay.top = Math.max(96, H * 0.16);
    lay.bot = H - Math.max(150, H * 0.22);
  }

  function stringX(i) { return lay.x0 + i * lay.gap; }

  // ----------------------------------------------------------------- audio

  var actx = null, master = null, comp = null, verbSend = null, muted = false;
  try { muted = localStorage.getItem("chordharp_sound") === "off"; } catch (e) {}

  function initAudio() {
    if (actx) return;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    actx = new AC();
    var sb = actx.createBuffer(1, 1, 22050);
    var ss = actx.createBufferSource(); ss.buffer = sb; ss.connect(actx.destination); ss.start(0);

    master = actx.createGain(); master.gain.value = muted ? 0 : 0.85;
    var lp = actx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 12500;
    comp = actx.createDynamicsCompressor();
    /* A full strum is 8-12 strings inside 200ms. Without the bus compressor
     * they sum straight past full scale and the whole chord crunches. */
    comp.threshold.value = -15; comp.ratio.value = 3; comp.attack.value = 0.004; comp.release.value = 0.25;
    comp.connect(lp); lp.connect(master); master.connect(actx.destination);

    // a warm room with air on top: a harp wants space, not a hall
    var secs = 2.4, len = Math.floor(actx.sampleRate * secs);
    var ir = actx.createBuffer(2, len, actx.sampleRate);
    for (var ch = 0; ch < 2; ch++) {
      var d = ir.getChannelData(ch), lastv = 0;
      for (var i = 0; i < len; i++) {
        var t = i / len;
        var n = (Math.random() * 2 - 1) * Math.pow(1 - t, 3.0);
        lastv = lastv * 0.55 + n * 0.45;
        d[i] = lastv;
      }
    }
    var verb = actx.createConvolver(); verb.buffer = ir;
    var hs = actx.createBiquadFilter(); hs.type = "highshelf"; hs.frequency.value = 3600; hs.gain.value = 3.5;
    var hp = actx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 160;
    verbSend = actx.createGain(); verbSend.gain.value = 0.34;
    verbSend.connect(hp); hp.connect(verb); verb.connect(hs); hs.connect(comp);
  }

  /* Karplus-Strong, rendered offline.
   *
   * The delay line starts full of lowpassed noise (a real pluck is not white)
   * and each trip round loses a little top end, which is what turns the bright
   * attack into a settling tone. `damp` is scaled by frequency so the top
   * octave dies away faster than the bottom, exactly as on a real instrument —
   * a flat damping factor makes high strings ring like a synth. */
  /* Cache key is note + variant ONLY. Baking pluck brightness into the buffer
   * as well multiplied the cache five-fold — a couple of hundred megabytes of
   * rendered strings for one instrument. Velocity brightness belongs on a
   * per-voice filter anyway: a harder pluck opens the tone up, it does not
   * change what the string is. */
  var bufCache = {};
  function pluckBuffer(midi, variant) {
    var key = midi + ":" + variant;
    if (bufCache[key]) return bufCache[key];
    var sr = actx.sampleRate;
    var freq = midiToFreq(midi);
    var Nd = Math.max(2, Math.round(sr / freq));
    var secs = clamp(2.6 - (midi - 48) * 0.05, 0.9, 2.6);
    var len = Math.floor(sr * secs);
    var buf = actx.createBuffer(1, len, sr);
    var out = buf.getChannelData(0);

    // excitation: noise through a one-pole lowpass, brighter for a harder pluck
    var line = new Float32Array(Nd);
    var a = 0.55;
    var lastv = 0;
    for (var i = 0; i < Nd; i++) {
      var n = Math.random() * 2 - 1;
      lastv = lastv + a * (n - lastv);
      line[i] = lastv;
    }
    // remove DC so the string does not thump
    var mean = 0;
    for (var m2 = 0; m2 < Nd; m2++) mean += line[m2];
    mean /= Nd;
    for (var m3 = 0; m3 < Nd; m3++) line[m3] -= mean;

    /* Pick position. Plucking a string a fraction p along its length notches
     * out the harmonics with a node there; without it every note has the same
     * uniform spectrum and the instrument sounds synthetic. */
    var p = Math.floor(Nd * (0.13 + variant * 0.04));
    for (var q = Nd - 1; q >= p; q--) line[q] -= line[q - p] * 0.62;

    var damp = clamp(0.9965 - (freq / 40000), 0.986, 0.9975);
    var idx = 0, prev = 0;
    for (var k = 0; k < len; k++) {
      var cur = line[idx];
      out[k] = cur;
      // one-zero lowpass in the loop: the average of this sample and the last
      var filtered = (cur + prev) * 0.5 * damp;
      prev = cur;
      line[idx] = filtered;
      idx = (idx + 1) % Nd;
    }

    // fade the very end so stopping the buffer never clicks
    var fade = Math.min(2000, Math.floor(len * 0.1));
    for (var f = 0; f < fade; f++) out[len - 1 - f] *= f / fade;

    bufCache[key] = buf;
    return buf;
  }

  function pluck(s, vel) {
    initAudio();
    if (!actx || muted) return;
    var t = actx.currentTime;
    var variant = Math.floor(Math.random() * 2);
    var buf = pluckBuffer(s.midi, variant);

    var src = actx.createBufferSource();
    src.buffer = buf;
    // a few cents of drift so repeated strums are never identical
    src.playbackRate.value = 1 + (Math.random() - 0.5) * 0.006;

    // velocity opens the tone, the way a harder pluck actually does
    var tone = actx.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = clamp(1100 + vel * 7200, 700, 12000);
    tone.Q.value = 0.5;

    var g = actx.createGain();
    var amp = 0.13 * (0.35 + 0.65 * vel);
    g.gain.setValueAtTime(amp, t);

    var node = g;
    if (actx.createStereoPanner) {
      var pan = actx.createStereoPanner();
      // spread the field across the image the way it sits on screen
      pan.pan.value = (strings.indexOf(s) / Math.max(1, strings.length - 1)) * 1.4 - 0.7;
      g.connect(pan); node = pan;
    }
    src.connect(tone); tone.connect(g);
    node.connect(comp);
    node.connect(verbSend);
    src.start(t);

    s.amp = Math.min(1, s.amp + 0.55 + vel * 0.45);
    s.phase = 0;
    s.lit = 1;
  }

  // ----------------------------------------------------------------- input

  var pointers = {};
  var hintEl = document.getElementById("hint");
  var hintGone = false;

  function nearestString(x) {
    var i = Math.round((x - lay.x0) / lay.gap);
    return (i < 0 || i >= strings.length) ? -1 : i;
  }

  /* A strum crosses strings between the last pointer sample and this one, so
   * walk that span rather than testing only where the finger landed. At speed a
   * pointermove can jump 200px and skip half the field otherwise. */
  function strumSpan(x0, x1, y, speed) {
    var i0 = nearestString(Math.min(x0, x1));
    var i1 = nearestString(Math.max(x0, x1));
    if (i0 < 0) i0 = 0;
    if (i1 < 0) i1 = strings.length - 1;
    var lo = Math.min(i0, i1), hi = Math.max(i0, i1);
    var vel = clamp(speed / 1400, 0.16, 1);
    for (var i = lo; i <= hi; i++) {
      var sx = stringX(i);
      var within = (sx >= Math.min(x0, x1) - lay.gap * 0.5) && (sx <= Math.max(x0, x1) + lay.gap * 0.5);
      if (!within) continue;
      var s = strings[i];
      if (!inChord(s)) { s.lit = Math.max(s.lit, 0.22); continue; }   // damped by the bar
      if (s.cooldown && performance.now() - s.cooldown < 55) continue;
      s.cooldown = performance.now();
      pluck(s, vel);
    }
  }

  function inField(y) { return y > lay.top - 30 && y < lay.bot + 30; }

  canvas.addEventListener("pointerdown", function (e) {
    initAudio();
    if (actx && actx.state === "suspended") actx.resume();
    if (canvas.setPointerCapture) { try { canvas.setPointerCapture(e.pointerId); } catch (er) {} }
    pointers[e.pointerId] = { x: e.clientX, y: e.clientY, t: performance.now() };
    if (inField(e.clientY)) strumSpan(e.clientX, e.clientX, e.clientY, 500);
    dismissHint();
  });
  canvas.addEventListener("pointermove", function (e) {
    var p = pointers[e.pointerId];
    if (!p) return;
    var now = performance.now();
    var dt = Math.max(1, now - p.t) / 1000;
    var dx = e.clientX - p.x, dy = e.clientY - p.y;
    var speed = Math.sqrt(dx * dx + dy * dy) / dt;
    if (inField(e.clientY)) strumSpan(p.x, e.clientX, e.clientY, speed);
    p.x = e.clientX; p.y = e.clientY; p.t = now;
  });
  function up(e) { delete pointers[e.pointerId]; }
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", up);

  function dismissHint() {
    if (hintGone || !hintEl) return;
    hintGone = true;
    hintEl.classList.add("is-gone");
  }

  // ---------------------------------------------------------------- chords

  var barsEl = document.getElementById("bars");
  var barBtns = [];
  function buildBars() {
    barsEl.innerHTML = "";
    barBtns = [];
    CHORDS.forEach(function (c, i) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "bar" + (i === chordIdx ? " is-on" : "");
      b.textContent = c.name;
      b.setAttribute("aria-pressed", String(i === chordIdx));
      b.addEventListener("click", function () {
        initAudio();
        if (actx && actx.state === "suspended") actx.resume();
        setChord(i);
        dismissHint();
      });
      barsEl.appendChild(b);
      barBtns.push(b);
    });
  }
  function setChord(i) {
    chordIdx = i;
    barBtns.forEach(function (b, k) {
      b.classList.toggle("is-on", k === i);
      b.setAttribute("aria-pressed", String(k === i));
    });
    if (typeof gtag === "function") gtag("event", "chordharp_chord", { chord: CHORDS[i].name });
  }

  window.addEventListener("keydown", function (e) {
    var n = parseInt(e.key, 10);
    if (n >= 1 && n <= CHORDS.length) {
      initAudio();
      if (actx && actx.state === "suspended") actx.resume();
      setChord(n - 1); dismissHint(); e.preventDefault(); return;
    }
    if (e.key === " " && !e.repeat) {
      initAudio();
      if (actx && actx.state === "suspended") actx.resume();
      e.preventDefault();
      autoStrum(1);
      dismissHint();
    }
  });

  /* A scripted strum for the keyboard, and for the idle demo. Staggering the
   * strings in time is what makes it a strum instead of a chord stab. */
  var autoQueue = [];
  function autoStrum(dir) {
    var order = [];
    for (var i = 0; i < strings.length; i++) if (inChord(strings[i])) order.push(i);
    if (dir < 0) order.reverse();
    var now = performance.now();
    for (var k = 0; k < order.length; k++) {
      autoQueue.push({ i: order[k], at: now + k * 26, vel: 0.55 + Math.random() * 0.25 });
    }
  }
  function runAutoQueue() {
    var now = performance.now();
    while (autoQueue.length && autoQueue[0].at <= now) {
      var job = autoQueue.shift();
      var s = strings[job.i];
      if (s) pluck(s, job.vel);
    }
  }

  var soundBtn = document.getElementById("soundBtn");
  soundBtn.addEventListener("click", function () {
    muted = !muted;
    if (master) master.gain.value = muted ? 0 : 0.85;
    soundBtn.setAttribute("aria-pressed", String(!muted));
    soundBtn.textContent = muted ? "♪̸" : "♪";
    try { localStorage.setItem("chordharp_sound", muted ? "off" : "on"); } catch (e) {}
  });
  soundBtn.setAttribute("aria-pressed", String(!muted));
  soundBtn.textContent = muted ? "♪̸" : "♪";

  // ---------------------------------------------------------------- render

  var motes = [];
  function spawnMotes(x, y) {
    if (reduceMotion) return;
    for (var i = 0; i < 3; i++) {
      motes.push({ x: x + (Math.random() - 0.5) * 8, y: y, vy: -18 - Math.random() * 26,
                   life: 1, r: 0.8 + Math.random() * 1.6 });
    }
  }

  function render(t, dt) {
    var g0 = ctx.createLinearGradient(0, 0, 0, H);
    g0.addColorStop(0, "#0a0913");
    g0.addColorStop(0.5, "#12101f");
    g0.addColorStop(1, "#08070f");
    ctx.fillStyle = g0;
    ctx.fillRect(0, 0, W, H);

    // a soft wash behind the field that brightens as the harp is played
    var energy = 0;
    for (var e0 = 0; e0 < strings.length; e0++) energy += strings[e0].amp;
    energy = clamp(energy / 6, 0, 1);
    var glow = ctx.createRadialGradient(W / 2, (lay.top + lay.bot) / 2, 0, W / 2, (lay.top + lay.bot) / 2, Math.max(W, H) * 0.6);
    glow.addColorStop(0, "rgba(140, 122, 220, " + (0.08 + energy * 0.16) + ")");
    glow.addColorStop(1, "rgba(140, 122, 220, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    /* A soundboard behind the strings. Without a body the toy is just lines on
     * a gradient — the panel, the rose and the two rails are what make it read
     * as an instrument you could pick up. */
    var bx = Math.max(8, lay.x0 - lay.gap * 0.7);
    var bw = W - bx * 2;
    var by = lay.top - 34, bh = (lay.bot + 34) - by;
    var bodyG = ctx.createLinearGradient(0, by, 0, by + bh);
    bodyG.addColorStop(0, "rgba(46, 40, 74, 0.55)");
    bodyG.addColorStop(0.5, "rgba(28, 24, 48, 0.62)");
    bodyG.addColorStop(1, "rgba(18, 15, 32, 0.66)");
    ctx.fillStyle = bodyG;
    var rr = 22;
    ctx.beginPath();
    ctx.moveTo(bx + rr, by);
    ctx.lineTo(bx + bw - rr, by);
    ctx.quadraticCurveTo(bx + bw, by, bx + bw, by + rr);
    ctx.lineTo(bx + bw, by + bh - rr);
    ctx.quadraticCurveTo(bx + bw, by + bh, bx + bw - rr, by + bh);
    ctx.lineTo(bx + rr, by + bh);
    ctx.quadraticCurveTo(bx, by + bh, bx, by + bh - rr);
    ctx.lineTo(bx, by + rr);
    ctx.quadraticCurveTo(bx, by, bx + rr, by);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(196, 186, 255, 0.16)";
    ctx.lineWidth = 1;
    ctx.stroke();

    // the rose: a ring of light where a sound hole would be
    var roseR = Math.min(bw * 0.11, bh * 0.20);
    var roseX = bx + bw * 0.5, roseY = by + bh * 0.5;
    var rg = ctx.createRadialGradient(roseX, roseY, roseR * 0.55, roseX, roseY, roseR);
    rg.addColorStop(0, "rgba(10, 8, 20, 0.85)");
    rg.addColorStop(0.82, "rgba(10, 8, 20, 0.55)");
    rg.addColorStop(1, "rgba(168, 150, 255, " + (0.10 + energy * 0.30) + ")");
    ctx.fillStyle = rg;
    ctx.beginPath(); ctx.arc(roseX, roseY, roseR, 0, 6.283); ctx.fill();
    ctx.strokeStyle = "rgba(168, 150, 255, " + (0.22 + energy * 0.4) + ")";
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(roseX, roseY, roseR, 0, 6.283); ctx.stroke();

    /* The chord name, printed on the soundboard. Drawn here rather than last so
       the strings pass over it, which is what puts it behind the glass. */
    ctx.save();
    ctx.globalAlpha = 0.055;
    ctx.fillStyle = "#e6e0ff";
    ctx.font = "800 " + Math.round(Math.min(W * 0.30, (lay.bot - lay.top) * 0.78)) + "px Geist, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(CHORDS[chordIdx].name, W / 2, (lay.top + lay.bot) / 2);
    ctx.restore();

    // the two rails the strings are strung between
    var railG = ctx.createLinearGradient(0, lay.top - 14, 0, lay.top - 2);
    railG.addColorStop(0, "rgba(224, 216, 255, 0.30)");
    railG.addColorStop(1, "rgba(120, 110, 168, 0.16)");
    ctx.fillStyle = railG;
    ctx.fillRect(bx, lay.top - 14, bw, 12);
    ctx.fillRect(bx, lay.bot + 2, bw, 12);

    for (var i = 0; i < strings.length; i++) {
      var s = strings[i];
      var x = stringX(i);
      var live = inChord(s);
      var a = s.amp;

      /* Draw the vibrating string as a standing wave: the displacement is a
       * half-sine along its length so the ends stay pinned, which is what a
       * plucked string actually does. */
      /* 9px of swing on a 700px string is invisible — the field looked static
       * even immediately after a full strum. A real plucked string blurs
       * across a good fraction of its neighbour spacing. */
      var swing = a * Math.min(22, lay.gap * 0.5);
      /* The vibration ENVELOPE, drawn as a soft lens around the string.
       *
       * A single displaced line is what the string is doing at one instant, and
       * an instant is almost never the peak — captured mid-oscillation the
       * whole field looked motionless a frame after a full strum. What the eye
       * (and a camera) actually sees on a plucked string is the blur between
       * the two extremes, so draw that and let the sharp line ride inside it. */
      if (a > 0.05) {
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.fillStyle = "rgba(186, 168, 255, " + (0.30 * a) + ")";
        ctx.beginPath();
        for (var e1 = 0; e1 <= ENV_STEPS; e1++) {
          var u1 = e1 / ENV_STEPS;
          var y1 = lerp(lay.top, lay.bot, u1);
          if (e1 === 0) ctx.moveTo(x + Math.sin(u1 * Math.PI) * swing, y1);
          else ctx.lineTo(x + Math.sin(u1 * Math.PI) * swing, y1);
        }
        for (var e2 = ENV_STEPS; e2 >= 0; e2--) {
          var u2 = e2 / ENV_STEPS;
          ctx.lineTo(x - Math.sin(u2 * Math.PI) * swing, lerp(lay.top, lay.bot, u2));
        }
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }

      ctx.beginPath();
      var steps = 16;
      for (var k = 0; k <= steps; k++) {
        var u = k / steps;
        var y = lerp(lay.top, lay.bot, u);
        var off = Math.sin(u * Math.PI) * Math.sin(s.phase) * swing;
        if (k === 0) ctx.moveTo(x + off, y); else ctx.lineTo(x + off, y);
      }
      /* Live and damped strings have to be obvious at a glance — that contrast
       * IS the instrument's one rule. The first pass used 0.42 against 0.13 and
       * the field read as a barcode: you could not tell what would sound. */
      var baseA = live ? 0.86 : 0.10;
      ctx.strokeStyle = live
        ? "rgba(226, 219, 255, " + Math.min(1, baseA + s.lit * 0.14) + ")"
        : "rgba(150, 146, 178, " + baseA + ")";
      ctx.lineWidth = live ? 2.1 : 1;
      ctx.stroke();

      // a live string carries a standing halo, brighter still while ringing
      if (live) {
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.strokeStyle = "rgba(168, 150, 255," + (0.10 + 0.45 * s.lit) + ")";
        ctx.lineWidth = 3 + 4 * s.lit;
        ctx.stroke();
        ctx.restore();
      }

      // tuning beads at each end, so the field reads as strung rather than drawn
      ctx.fillStyle = live ? "rgba(240, 236, 255, 0.85)" : "rgba(150, 146, 178, 0.22)";
      ctx.beginPath(); ctx.arc(x, lay.top - 8, live ? 2.8 : 1.8, 0, 6.283); ctx.fill();
      ctx.beginPath(); ctx.arc(x, lay.bot + 8, live ? 2.8 : 1.8, 0, 6.283); ctx.fill();
    }

    // motes rising off plucked strings
    if (motes.length) {
      ctx.save(); ctx.globalCompositeOperation = "lighter";
      for (var m = motes.length - 1; m >= 0; m--) {
        var mo = motes[m];
        mo.y += mo.vy * dt;
        mo.life -= dt * 0.7;
        if (mo.life <= 0) { motes.splice(m, 1); continue; }
        ctx.fillStyle = "rgba(190, 170, 255," + (mo.life * 0.5) + ")";
        ctx.beginPath(); ctx.arc(mo.x, mo.y, mo.r, 0, 6.283); ctx.fill();
      }
      ctx.restore();
    }

  }

  // ------------------------------------------------------------------ loop

  var last = 0;
  function frame(ts) {
    var t = ts / 1000;
    var dt = last ? Math.min(0.05, t - last) : 0.016;
    last = t;

    runAutoQueue();

    for (var i = 0; i < strings.length; i++) {
      var s = strings[i];
      if (s.amp > 0.0005) {
        // visual decay tracks pitch, like the real damping does
        s.phase += dt * Math.min(70, s.freq * 0.22);
        s.amp *= Math.exp(-dt * (2.6 + (s.midi - 48) * 0.06));
        if (s.amp < 0.0005) s.amp = 0;
        if (!reduceMotion && s.amp > 0.35 && Math.random() < dt * 6) {
          spawnMotes(stringX(i), lerp(lay.top, lay.bot, 0.3 + Math.random() * 0.4));
        }
      }
      s.lit *= Math.exp(-dt * 3.2);
    }

    render(t, dt);
    requestAnimationFrame(frame);
  }

  window.addEventListener("resize", resize);
  buildBars();
  resize();
  requestAnimationFrame(frame);
})();
