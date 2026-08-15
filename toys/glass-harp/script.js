/* Glass Harp — a rank of tuned wine glasses you play with a wet fingertip.
 *
 * Two gestures on one object. Drag ACROSS the rims and the glasses sing;
 * drag a glass's WATER LINE and it retunes. That is not a UI convenience, it
 * is how the instrument actually works — a glass harp is tuned by pouring, and
 * the water you are adjusting is the same water that ripples while the note
 * sounds.
 *
 * The voice is a rubbed glass, not a synth pad. A wet finger on a rim is a
 * stick-slip oscillator: it grabs, drags the rim along, releases, and repeats
 * at the glass's own resonant frequency, so the tone only exists while you are
 * moving and it takes a moment to bloom. Rub speed drives amplitude and
 * brightness; stopping lets it ring down over a second or so rather than
 * cutting off. The partials are close to harmonic with a slight stretch, plus
 * the slow beat you hear from the travelling wave going around the rim.
 *
 * Vanilla Canvas 2D + Web Audio. Nothing sampled.
 */
(function () {
  "use strict";

  var canvas = document.getElementById("canvas");
  var ctx = canvas.getContext("2d");

  var W = 0, H = 0, DPR = 1;
  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ------------------------------------------------------------- constants

  var NOTE_NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
  var SCALE = [0, 2, 4, 5, 7, 9, 11];            // C major, so any tuning stays consonant
  var BASE = [60, 62, 64, 65, 67, 69, 71, 72];   // C4 up to C5

  function midiToFreq(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }

  /* Snap a continuous pitch onto the nearest scale degree. Free tuning sounds
   * like a detuned instrument within about four glasses; snapping keeps every
   * pour musical while still letting the water do real work. */
  function snapToScale(midi) {
    var best = null, bestD = 1e9;
    for (var oct = 3; oct <= 7; oct++) {
      for (var i = 0; i < SCALE.length; i++) {
        var n = oct * 12 + SCALE[i];
        var d = Math.abs(n - midi);
        if (d < bestD) { bestD = d; best = n; }
      }
    }
    return best;
  }

  // ----------------------------------------------------------------- state

  var glasses = [];
  var N = 8;

  function defaultLevel() { return 0.5; }

  function buildGlasses() {
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem("glassharp_levels") || "null"); } catch (e) {}
    glasses = [];
    for (var i = 0; i < N; i++) {
      var lvl = (saved && typeof saved[i] === "number") ? clamp(saved[i], 0, 1) : defaultLevel();
      glasses.push({
        i: i,
        level: lvl,
        drive: 0,          // smoothed rub energy, 0..1
        target: 0,
        ring: 0,           // visual ripple phase
        lit: 0,
        voice: null
      });
      retune(glasses[i]);
    }
  }

  /* More water lowers the pitch. Level 0.5 is the glass's nominal note, empty
   * runs it up a few semitones, full drops it further. */
  function retune(g) {
    var raw = BASE[g.i] + (0.5 - g.level) * 9;
    g.midi = snapToScale(raw);
    g.freq = midiToFreq(g.midi);
    g.name = NOTE_NAMES[((g.midi % 12) + 12) % 12] + (Math.floor(g.midi / 12) - 1);
    if (g.voice) setVoiceFreq(g);
  }

  function saveLevels() {
    try {
      localStorage.setItem("glassharp_levels", JSON.stringify(glasses.map(function (g) { return +g.level.toFixed(3); })));
    } catch (e) {}
  }

  // ---------------------------------------------------------------- layout

  var lay = { x0: 0, span: 0, baseY: 0, gw: 0, bowlH: 0, stemH: 0 };

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.floor(W * DPR); canvas.height = Math.floor(H * DPR);
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

    var narrow = W < 620;
    var want = narrow ? 6 : 8;
    if (want !== N) { N = want; buildGlasses(); }

    var margin = Math.max(18, W * 0.05);
    lay.span = W - margin * 2;
    lay.gw = lay.span / N;
    lay.x0 = margin + lay.gw / 2;
    /* The rank sits low so the rims are reachable and the room shows above.
     * The bowl height scales with BOTH the column width and the viewport — a
     * flat 210px cap made the glasses shrink into the middle of a large display
     * instead of filling it. */
    lay.baseY = Math.min(H * 0.80, H - 92);
    lay.bowlH = clamp(Math.min(lay.gw * 1.55, H * 0.34), 84, 340);
    lay.stemH = lay.bowlH * 0.52;
  }

  function glassX(i) { return lay.x0 + i * lay.gw; }
  function bowlTop(g) { return lay.baseY - lay.stemH - lay.bowlH; }
  function bowlBottom() { return lay.baseY - lay.stemH; }
  // bowl half-width at a given height fraction (0 = rim, 1 = base of bowl)
  function bowlHalfW(t) {
    var maxW = Math.min(lay.gw * 0.42, lay.bowlH * 0.36);
    // a tulip profile: widest just under the rim, tapering to the stem
    return maxW * (0.90 + 0.22 * Math.sin(t * Math.PI * 0.85) - 0.72 * Math.pow(t, 2.4));
  }
  function waterY(g) {
    var top = bowlTop(g), bot = bowlBottom();
    return lerp(bot, top + lay.bowlH * 0.10, g.level);
  }

  /* The pour handle.
   *
   * The first pass decided "near the water line means pour, anything else on
   * the glass means rub", and that fails on contact: the water line sits in
   * the middle of the bowl, which is exactly where a hand sweeps to play the
   * rank. A horizontal rub across the middle silently retuned four glasses.
   *
   * So pouring gets its own small visible grip hanging off the right of each
   * glass. Unambiguous to hit, and it also tells you the water moves at all —
   * nothing else on screen did. */
  function tabRect(g) {
    var top = bowlTop(g), h = bowlBottom() - top;
    var wy = waterY(g);
    var t = clamp((wy - top) / h, 0, 1);
    var hw = bowlHalfW(t);
    var w = Math.min(20, lay.gw * 0.22), hh = 11;
    return { x: glassX(g.i) + hw - 2, y: wy - hh / 2, w: w, h: hh };
  }
  function hitTab(g, x, y) {
    var r = tabRect(g);
    var padX = 12, padY = 11;
    return x > r.x - padX && x < r.x + r.w + padX && y > r.y - padY && y < r.y + r.h + padY;
  }

  // ----------------------------------------------------------------- audio

  var actx = null, master = null, comp = null, verbSend = null, muted = false;
  try { muted = localStorage.getItem("glassharp_sound") === "off"; } catch (e) {}

  function initAudio() {
    if (actx) return;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    actx = new AC();
    var sb = actx.createBuffer(1, 1, 22050);
    var ss = actx.createBufferSource(); ss.buffer = sb; ss.connect(actx.destination); ss.start(0);

    master = actx.createGain(); master.gain.value = muted ? 0 : 0.9;
    var lp = actx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 11000;
    comp = actx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 3; comp.attack.value = 0.008; comp.release.value = 0.3;
    comp.connect(lp); lp.connect(master); master.connect(actx.destination);

    /* A long, smooth hall. Glass harps are hall instruments and the tail is
     * most of the sound; a dry rubbed glass is thin and unpleasant. The noise
     * is lowpassed as it is generated so the tail is silky rather than gritty,
     * with a highshelf for air and a highpass to keep the lows out of the mud. */
    var secs = 3.4, len = Math.floor(actx.sampleRate * secs);
    var ir = actx.createBuffer(2, len, actx.sampleRate);
    for (var ch = 0; ch < 2; ch++) {
      var d = ir.getChannelData(ch), lastv = 0;
      for (var i = 0; i < len; i++) {
        var t = i / len;
        var n = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.6);
        lastv = lastv * 0.62 + n * 0.38;
        d[i] = lastv * (0.5 + 0.5 * Math.sin(i * 0.0004 + ch));
      }
    }
    var verb = actx.createConvolver(); verb.buffer = ir;
    var hs = actx.createBiquadFilter(); hs.type = "highshelf"; hs.frequency.value = 3200; hs.gain.value = 4;
    var hp = actx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 180;
    verbSend = actx.createGain(); verbSend.gain.value = 0.52;
    verbSend.connect(hp); hp.connect(verb); verb.connect(hs); hs.connect(comp);
  }

  /* One glass = one continuously running voice, gated by a gain. Starting and
   * stopping oscillators per touch clicks and loses the ring-down; leaving them
   * running and riding the gain is both cheaper and closer to the physics. */
  var PARTIALS = [
    { r: 1.000, g: 1.00 },
    { r: 2.006, g: 0.34 },   // a rubbed glass is nearly harmonic, very slightly
    { r: 3.018, g: 0.16 },   // stretched — the small offsets are the shimmer
    { r: 4.035, g: 0.06 }
  ];

  function makeVoice(g) {
    if (!actx) return null;
    var v = { oscs: [], gains: [], out: actx.createGain(), pan: null, filt: null };
    v.out.gain.value = 0;
    v.filt = actx.createBiquadFilter();
    v.filt.type = "lowpass"; v.filt.frequency.value = 1200; v.filt.Q.value = 0.6;

    // stereo place each glass where it sits on screen
    if (actx.createStereoPanner) {
      v.pan = actx.createStereoPanner();
      v.pan.pan.value = (g.i / Math.max(1, N - 1)) * 1.5 - 0.75;
      v.out.connect(v.filt); v.filt.connect(v.pan);
      v.pan.connect(comp); v.pan.connect(verbSend);
    } else {
      v.out.connect(v.filt); v.filt.connect(comp); v.filt.connect(verbSend);
    }

    for (var i = 0; i < PARTIALS.length; i++) {
      var o = actx.createOscillator();
      o.type = "sine";
      o.frequency.value = g.freq * PARTIALS[i].r;
      // a couple of cents of detune per partial keeps it from sounding digital
      o.detune.value = (i === 0 ? 0 : (Math.random() * 6 - 3));
      var gn = actx.createGain();
      gn.gain.value = PARTIALS[i].g;
      o.connect(gn); gn.connect(v.out);
      o.start();
      v.oscs.push(o); v.gains.push(gn);
    }

    /* The slow beat of the wave travelling around the rim. Two very slightly
     * detuned copies of the fundamental do it more convincingly than an LFO,
     * because the beat then lives in the sound rather than on top of it. */
    var beat = actx.createOscillator();
    beat.type = "sine";
    beat.frequency.value = g.freq * 1.0;
    beat.detune.value = 7;
    var bg = actx.createGain(); bg.gain.value = 0.42;
    beat.connect(bg); bg.connect(v.out);
    beat.start();
    v.oscs.push(beat); v.gains.push(bg);

    // friction hiss: the finger itself, barely there but it sells the contact
    v.noise = actx.createBufferSource();
    var nlen = Math.floor(actx.sampleRate * 1.5);
    var nb = actx.createBuffer(1, nlen, actx.sampleRate);
    var nd = nb.getChannelData(0);
    for (var k = 0; k < nlen; k++) nd[k] = Math.random() * 2 - 1;
    v.noise.buffer = nb; v.noise.loop = true;
    var nf = actx.createBiquadFilter();
    nf.type = "bandpass"; nf.frequency.value = g.freq * 3.4; nf.Q.value = 1.4;
    v.noiseGain = actx.createGain(); v.noiseGain.gain.value = 0;
    v.noise.connect(nf); nf.connect(v.noiseGain); v.noiseGain.connect(v.out);
    v.noise.start();
    v.noiseFilt = nf;
    return v;
  }

  function setVoiceFreq(g) {
    var v = g.voice;
    if (!v || !actx) return;
    var t = actx.currentTime;
    for (var i = 0; i < PARTIALS.length; i++) {
      v.oscs[i].frequency.setTargetAtTime(g.freq * PARTIALS[i].r, t, 0.04);
    }
    v.oscs[PARTIALS.length].frequency.setTargetAtTime(g.freq, t, 0.04);
    v.noiseFilt.frequency.setTargetAtTime(g.freq * 3.4, t, 0.05);
  }

  function ensureVoice(g) {
    if (!actx) return;
    if (!g.voice) g.voice = makeVoice(g);
  }

  function updateVoice(g) {
    if (!actx || !g.voice) return;
    var t = actx.currentTime;
    var d = g.drive;
    /* Bloom in slowly, ring down slower still. A rubbed glass takes a good
     * fraction of a second to speak and keeps sounding after you stop. */
    var tc = d > 0.02 ? 0.16 : 0.42;
    g.voice.out.gain.setTargetAtTime(0.20 * Math.pow(d, 0.85), t, tc);
    g.voice.filt.frequency.setTargetAtTime(700 + d * 4200, t, 0.14);
    g.voice.noiseGain.gain.setTargetAtTime(0.010 * d, t, 0.10);
  }

  // ----------------------------------------------------------------- input

  var pointers = {};      // id -> { mode, glass, lastX, lastY }
  var hintEl = document.getElementById("hint");
  var readout = document.getElementById("readout");
  var hintGone = false;

  function glassAt(x) {
    var i = Math.round((x - lay.x0) / lay.gw);
    if (i < 0 || i >= N) return null;
    var g = glasses[i];
    if (Math.abs(x - glassX(i)) > lay.gw * 0.5) return null;
    return g;
  }

  function onDown(e) {
    initAudio();
    if (actx && actx.state === "suspended") actx.resume();
    if (canvas.setPointerCapture) { try { canvas.setPointerCapture(e.pointerId); } catch (er) {} }
    var g = glassAt(e.clientX);
    var mode = "rub";
    // the pour grip is checked on this glass AND its neighbours, since the tab
    // hangs past the glass's own column
    if (!g || !hitTab(g, e.clientX, e.clientY)) {
      for (var i = 0; i < N; i++) {
        if (hitTab(glasses[i], e.clientX, e.clientY)) { g = glasses[i]; mode = "pour"; break; }
      }
    } else { mode = "pour"; }
    pointers[e.pointerId] = { mode: mode, glass: g, x: e.clientX, y: e.clientY, t: performance.now() };
    if (mode === "pour" && g) { g.pouring = true; showReadout(g); }
    if (mode === "rub" && g) rub(g, 0.55);
    dismissHint();
  }

  function onMove(e) {
    var p = pointers[e.pointerId];
    if (!p) return;
    var dx = e.clientX - p.x, dy = e.clientY - p.y;
    var now = performance.now();
    var dt = Math.max(1, now - p.t) / 1000;

    if (p.mode === "pour" && p.glass) {
      var top = bowlTop(p.glass), bot = bowlBottom();
      var lvl = clamp((bot - e.clientY) / (bot - (top + lay.bowlH * 0.10)), 0, 1);
      p.glass.level = lvl;
      retune(p.glass);
      showReadout(p.glass);
    } else {
      /* Rubbing: speed along the rim is what drives the tone, exactly as with a
       * real finger. Standing still on a rim makes no sound at all. */
      var speed = Math.sqrt(dx * dx + dy * dy) / dt;    // px/sec
      var g = glassAt(e.clientX);
      if (g) {
        var top2 = bowlTop(g);
        // within the bowl's vertical band counts as touching the glass
        if (e.clientY > top2 - 26 && e.clientY < bowlBottom() + 10) {
          rub(g, clamp(speed / 900, 0, 1));
          if (g !== p.glass && p.glass) p.glass.target *= 0.7;
          p.glass = g;
        }
      }
    }
    p.x = e.clientX; p.y = e.clientY; p.t = now;
  }

  function onUp(e) {
    var p = pointers[e.pointerId];
    if (p && p.glass) p.glass.pouring = false;
    if (p && p.mode === "pour") saveLevels();
    delete pointers[e.pointerId];
    hideReadoutSoon();
  }

  function rub(g, amount) {
    ensureVoice(g);
    g.target = Math.max(g.target, clamp(amount, 0, 1));
    g.lit = 1;
  }

  var readoutTimer = 0;
  function showReadout(g) {
    readout.textContent = g.name;
    readout.style.left = Math.round(glassX(g.i)) + "px";
    readout.style.top = Math.round(bowlTop(g) - 26) + "px";
    readout.hidden = false;
    clearTimeout(readoutTimer);
  }
  function hideReadoutSoon() {
    clearTimeout(readoutTimer);
    readoutTimer = setTimeout(function () { readout.hidden = true; }, 900);
  }

  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);

  function dismissHint() {
    if (hintGone || !hintEl) return;
    hintGone = true;
    hintEl.classList.add("is-gone");
  }

  // keyboard: play the rank left to right
  var KEYS = ["a", "s", "d", "f", "g", "h", "j", "k"];
  window.addEventListener("keydown", function (e) {
    if (e.repeat) return;
    var i = KEYS.indexOf(e.key.toLowerCase());
    if (i < 0 || i >= N) return;
    initAudio();
    if (actx && actx.state === "suspended") actx.resume();
    e.preventDefault();
    var g = glasses[i];
    g.keyHeld = true;
    rub(g, 0.85);
    dismissHint();
  });
  window.addEventListener("keyup", function (e) {
    var i = KEYS.indexOf(e.key.toLowerCase());
    if (i >= 0 && i < N) glasses[i].keyHeld = false;
  });

  var soundBtn = document.getElementById("soundBtn");
  soundBtn.addEventListener("click", function () {
    muted = !muted;
    if (master) master.gain.value = muted ? 0 : 0.9;
    soundBtn.setAttribute("aria-pressed", String(!muted));
    soundBtn.textContent = muted ? "♪̸" : "♪";
    try { localStorage.setItem("glassharp_sound", muted ? "off" : "on"); } catch (e) {}
  });
  soundBtn.setAttribute("aria-pressed", String(!muted));
  soundBtn.textContent = muted ? "♪̸" : "♪";

  var resetBtn = document.getElementById("resetBtn");
  resetBtn.addEventListener("click", function () {
    for (var i = 0; i < N; i++) { glasses[i].level = defaultLevel(); retune(glasses[i]); }
    saveLevels();
  });

  // ---------------------------------------------------------------- render

  var motes = [];
  function seedMotes() {
    motes = [];
    var n = reduceMotion ? 0 : Math.round(W * H / 26000);
    for (var i = 0; i < n; i++) {
      motes.push({ x: Math.random() * W, y: Math.random() * H, r: 0.5 + Math.random() * 1.7,
                   sp: 5 + Math.random() * 14, ph: Math.random() * 6.28 });
    }
  }

  function drawGlass(g, t) {
    var x = glassX(g.i);
    var top = bowlTop(g), bot = bowlBottom();
    var h = bot - top;
    var wy = waterY(g);
    var lit = g.lit;

    // halo behind a singing glass
    if (lit > 0.01) {
      var hr = lay.bowlH * (0.9 + lit * 0.7);
      var hg = ctx.createRadialGradient(x, top + h * 0.5, 0, x, top + h * 0.5, hr);
      hg.addColorStop(0, "rgba(150, 226, 255," + (0.16 * lit) + ")");
      hg.addColorStop(1, "rgba(150, 226, 255,0)");
      ctx.save(); ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = hg;
      ctx.beginPath(); ctx.arc(x, top + h * 0.5, hr, 0, 6.283); ctx.fill();
      ctx.restore();
    }

    // ---- bowl outline as two mirrored curves, sampled from the profile
    var STEPS = 26;
    function sideX(k, sign) { return x + sign * bowlHalfW(k / STEPS); }
    function sideY(k) { return top + (k / STEPS) * h; }

    // water first, clipped to the bowl
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(sideX(0, -1), sideY(0));
    for (var k = 0; k <= STEPS; k++) ctx.lineTo(sideX(k, -1), sideY(k));
    for (var k2 = STEPS; k2 >= 0; k2--) ctx.lineTo(sideX(k2, 1), sideY(k2));
    ctx.closePath();
    ctx.clip();

    var wobble = reduceMotion ? 0 : Math.sin(t * 9 + g.i) * 1.6 * g.drive + Math.sin(t * 14.3 + g.i * 2) * 1.1 * g.drive;
    var wg = ctx.createLinearGradient(0, wy, 0, bot);
    wg.addColorStop(0, "rgba(126, 214, 240, 0.60)");
    wg.addColorStop(0.5, "rgba(74, 168, 214, 0.52)");
    wg.addColorStop(1, "rgba(38, 104, 158, 0.62)");
    ctx.fillStyle = wg;
    ctx.beginPath();
    ctx.moveTo(x - lay.gw, wy + wobble);
    // a rippling surface while the glass sings
    for (var sx = -1; sx <= 1.001; sx += 0.08) {
      var rip = reduceMotion ? 0 : Math.sin(sx * 7 + t * 11 + g.i) * 2.2 * g.drive;
      ctx.lineTo(x + sx * lay.gw, wy + wobble + rip);
    }
    ctx.lineTo(x + lay.gw, bot + 4);
    ctx.lineTo(x - lay.gw, bot + 4);
    ctx.closePath();
    ctx.fill();

    // a bright meniscus line where the water meets the glass
    ctx.strokeStyle = "rgba(198, 240, 255, " + (0.55 + 0.35 * g.drive) + ")";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (var sx2 = -1; sx2 <= 1.001; sx2 += 0.08) {
      var rip2 = reduceMotion ? 0 : Math.sin(sx2 * 7 + t * 11 + g.i) * 2.2 * g.drive;
      var px = x + sx2 * lay.gw, py = wy + wobble + rip2;
      if (sx2 <= -1) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.restore();

    // ---- the glass itself
    ctx.beginPath();
    ctx.moveTo(sideX(0, -1), sideY(0));
    for (var k3 = 0; k3 <= STEPS; k3++) ctx.lineTo(sideX(k3, -1), sideY(k3));
    for (var k4 = STEPS; k4 >= 0; k4--) ctx.lineTo(sideX(k4, 1), sideY(k4));
    ctx.closePath();
    var bg = ctx.createLinearGradient(x - lay.gw * 0.4, 0, x + lay.gw * 0.4, 0);
    bg.addColorStop(0, "rgba(226, 244, 255, 0.15)");
    bg.addColorStop(0.35, "rgba(226, 244, 255, 0.04)");
    bg.addColorStop(0.62, "rgba(226, 244, 255, 0.05)");
    bg.addColorStop(1, "rgba(226, 244, 255, 0.16)");
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.strokeStyle = "rgba(206, 236, 255, " + (0.30 + 0.5 * lit) + ")";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // rim: the part you actually touch, so it gets the strongest light
    var rw = bowlHalfW(0);
    ctx.strokeStyle = "rgba(232, 250, 255, " + (0.55 + 0.45 * lit) + ")";
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.ellipse(x, top, rw, Math.max(3, rw * 0.20), 0, 0, 6.283);
    ctx.stroke();
    if (lit > 0.01) {
      ctx.save(); ctx.globalCompositeOperation = "lighter";
      ctx.strokeStyle = "rgba(170, 232, 255," + (0.6 * lit) + ")";
      ctx.lineWidth = 4.5;
      ctx.beginPath();
      ctx.ellipse(x, top, rw, Math.max(3, rw * 0.20), 0, 0, 6.283);
      ctx.stroke();
      ctx.restore();
    }

    // vertical specular streak
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    var sg = ctx.createLinearGradient(x - rw * 0.55, 0, x - rw * 0.2, 0);
    sg.addColorStop(0, "rgba(255,255,255,0)");
    sg.addColorStop(0.5, "rgba(255,255,255,0.20)");
    sg.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = sg;
    ctx.fillRect(x - rw * 0.6, top + 4, rw * 0.45, h - 8);
    ctx.restore();

    // stem + foot
    ctx.strokeStyle = "rgba(214, 240, 255, " + (0.26 + 0.3 * lit) + ")";
    ctx.lineWidth = Math.max(2, lay.gw * 0.035);
    ctx.beginPath();
    ctx.moveTo(x, bot - 2);
    ctx.lineTo(x, lay.baseY - 3);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(x, lay.baseY, Math.min(lay.gw * 0.30, lay.bowlH * 0.24), Math.max(3, lay.bowlH * 0.05), 0, 0, 6.283);
    ctx.stroke();

    // the pour grip, brighter while it is being used
    var r = tabRect(g);
    var on = g.pouring ? 1 : 0;
    ctx.fillStyle = "rgba(143, 212, 240, " + (0.20 + 0.55 * on) + ")";
    ctx.strokeStyle = "rgba(198, 240, 255, " + (0.40 + 0.5 * on) + ")";
    ctx.lineWidth = 1;
    var rr = r.h / 2;
    ctx.beginPath();
    ctx.moveTo(r.x + rr, r.y);
    ctx.lineTo(r.x + r.w - rr, r.y);
    ctx.quadraticCurveTo(r.x + r.w, r.y, r.x + r.w, r.y + rr);
    ctx.quadraticCurveTo(r.x + r.w, r.y + r.h, r.x + r.w - rr, r.y + r.h);
    ctx.lineTo(r.x + rr, r.y + r.h);
    ctx.quadraticCurveTo(r.x, r.y + r.h, r.x, r.y + rr);
    ctx.quadraticCurveTo(r.x, r.y, r.x + rr, r.y);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    // two grip lines, so it reads as a handle rather than a dot
    ctx.strokeStyle = "rgba(8, 19, 36, " + (0.5 + 0.3 * on) + ")";
    ctx.lineWidth = 1.2;
    for (var gi = -1; gi <= 1; gi += 2) {
      ctx.beginPath();
      ctx.moveTo(r.x + r.w / 2 + gi * 2.6, r.y + 3);
      ctx.lineTo(r.x + r.w / 2 + gi * 2.6, r.y + r.h - 3);
      ctx.stroke();
    }
  }

  function render(t) {
    // room: a deep cool wash with a pool of light on the table
    var sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, "#05070f");
    sky.addColorStop(0.55, "#081324");
    sky.addColorStop(1, "#0c1c30");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    var pool = ctx.createRadialGradient(W / 2, lay.baseY - lay.bowlH * 0.4, 0, W / 2, lay.baseY - lay.bowlH * 0.4, Math.max(W, H) * 0.62);
    pool.addColorStop(0, "rgba(96, 168, 216, 0.13)");
    pool.addColorStop(1, "rgba(96, 168, 216, 0)");
    ctx.fillStyle = pool;
    ctx.fillRect(0, 0, W, H);

    // drifting motes
    if (motes.length) {
      ctx.save(); ctx.globalCompositeOperation = "lighter";
      for (var i = 0; i < motes.length; i++) {
        var m = motes[i];
        var my = m.y - (t * m.sp) % (H + 40);
        if (my < -20) my += H + 40;
        var a = 0.10 + 0.10 * Math.sin(t * 0.8 + m.ph);
        ctx.fillStyle = "rgba(180, 226, 255," + a + ")";
        ctx.beginPath(); ctx.arc(m.x, my, m.r, 0, 6.283); ctx.fill();
      }
      ctx.restore();
    }

    // the table line
    ctx.strokeStyle = "rgba(150, 200, 236, 0.16)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, lay.baseY + 1); ctx.lineTo(W, lay.baseY + 1); ctx.stroke();

    // reflections under the glasses, then the glasses
    ctx.save();
    ctx.globalAlpha = 0.20;
    ctx.scale(1, -1);
    ctx.translate(0, -lay.baseY * 2);
    for (var r = 0; r < N; r++) drawGlass(glasses[r], t);
    ctx.restore();

    for (var k = 0; k < N; k++) drawGlass(glasses[k], t);
  }

  // ------------------------------------------------------------------ loop

  var last = 0;
  function frame(ts) {
    var t = ts / 1000;
    var dt = last ? Math.min(0.05, t - last) : 0.016;
    last = t;

    for (var i = 0; i < N; i++) {
      var g = glasses[i];
      if (g.keyHeld) g.target = Math.max(g.target, 0.85);
      /* Drive chases the target, then the target decays. Letting the target
       * fall on its own is what makes the glass keep singing for a moment
       * after the finger lifts instead of stopping dead. */
      g.drive += (g.target - g.drive) * Math.min(1, dt * (g.target > g.drive ? 5.5 : 2.2));
      g.target *= Math.exp(-dt * 3.4);
      if (g.drive < 0.001) g.drive = 0;
      g.lit += ((g.drive > 0.02 ? 1 : 0) - g.lit) * Math.min(1, dt * 5);
      updateVoice(g);
    }

    render(t);
    requestAnimationFrame(frame);
  }

  window.addEventListener("resize", function () { resize(); seedMotes(); });
  buildGlasses();
  resize();
  seedMotes();
  requestAnimationFrame(frame);
})();
