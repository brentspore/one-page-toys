/* Perfect Timing — No. 092
 * A needle sweeps a premium dial; tap / click / space to stop it on the
 * glowing target. Score = how many degrees off. Nail hits to ramp the speed
 * and shrink the target; a wide miss — or letting the needle lap the target
 * PASS_LIMIT (3) times without a stop — ends the run.
 * Vanilla Canvas 2D + Web Audio. Self-contained.
 * localStorage best key: "timing_best" (higher = better round score). */
(function () {
  "use strict";

  var TAU = Math.PI * 2;
  var DEG = 180 / Math.PI;
  var RAD = Math.PI / 180;

  // ---------------------------------------------------------------- elements
  var canvas = document.getElementById("canvas");
  var ctx = canvas.getContext("2d");
  var hud = document.getElementById("hud");
  var scoreEl = document.getElementById("score");
  var bestEl = document.getElementById("best");
  var streakEl = document.getElementById("streak");
  var streakCell = document.getElementById("streakCell");
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

  // ------------------------------------------------------------------ tuning
  var TOL_START = 15;     // target half-width, degrees
  var TOL_MIN = 3.6;
  var TOL_STEP = 0.9;     // shrink per hit
  var SPD_START = 150;    // needle sweep, deg/sec
  var SPD_MAX = 430;
  var SPD_STEP = 15;      // faster per hit
  var PERFECT_DEG = 0.7;  // within this = PERFECT
  var RESOLVE_MS = 620;   // freeze on a hit before the next sweep
  var FAIL_MS = 780;      // freeze on a miss before game over
  var PASS_LIMIT = 3;     // laps past the target window before the run ends

  // ------------------------------------------------------------------- state
  var state = "menu";     // menu | sweep | resolve | fail | over
  var dir = 1;            // sweep direction (flips for variety)
  var needle = -90;       // current needle angle (deg, 0 = right, -90 = top)
  var speed = SPD_START;
  var tol = TOL_START;
  var target = -90;       // target center angle (deg)
  var score = 0;
  var streak = 0;
  var best = 0;
  var lastErr = 0;        // last stop error in degrees (for display)
  var lastPerfect = false;
  var lastTimedOut = false; // did the last miss come from lapping out?
  var passCount = 0;      // times the needle has lapped the target this sweep
  var prevDiff = null;    // previous needle-to-target signed delta (crossing detect)
  var resolveT = 0;       // countdown ms during resolve/fail
  var snapFrom = 0, snapTo = 0, snapT = 0; // needle snap animation
  var shake = 0;
  var flashCol = null, flashT = 0;

  var displayScore = 0;   // eased score for the readout
  var scorePop = 0;       // score pop scale timer

  var particles = [];
  var rings = [];         // expanding shockwave rings
  var floaters = [];      // "-2.3°" / "PERFECT" text pops

  var dpr = 1, W = 0, H = 0, cx = 0, cy = 0, R = 0;
  var last = 0, tickAcc = 0, revTracker = 0;

  // ------------------------------------------------------------ persistence
  var soundOn = true;
  try { best = parseInt(localStorage.getItem("timing_best") || "0", 10) || 0; } catch (e) {}
  try { var sv = localStorage.getItem("timing_sound"); if (sv === "0") soundOn = false; } catch (e) {}
  bestEl.textContent = best;
  soundBtn.setAttribute("aria-pressed", soundOn ? "true" : "false");

  // -------------------------------------------------------------------- util
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function norm180(d) { d = ((d + 180) % 360 + 360) % 360 - 180; return d; }
  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }

  // ================================================================== AUDIO
  var AC = null, master = null, outGain = null, comp = null, lp = null, verbGain = null;
  var pentat = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21]; // major pentatonic degrees

  function initAudio() {
    if (AC) return;
    try {
      AC = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) { AC = null; return; }

    outGain = AC.createGain();
    outGain.gain.value = soundOn ? 1 : 0;

    lp = AC.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 12000;
    lp.Q.value = 0.6;

    comp = AC.createDynamicsCompressor();
    comp.threshold.value = -15;
    comp.knee.value = 26;
    comp.ratio.value = 3;
    comp.attack.value = 0.004;
    comp.release.value = 0.22;

    master = AC.createGain();
    master.gain.value = 0.9;

    // convolver reverb (smooth impulse)
    var verb = AC.createConvolver();
    verb.buffer = makeImpulse(2.1, 2.6);
    verbGain = AC.createGain();
    verbGain.gain.value = 0.5;

    // dry: outGain -> lp -> comp -> master -> dest
    outGain.connect(lp);
    lp.connect(comp);
    // wet send: outGain -> verb -> verbGain -> comp
    outGain.connect(verb);
    verb.connect(verbGain);
    verbGain.connect(comp);
    comp.connect(master);
    master.connect(AC.destination);
  }

  function makeImpulse(dur, decay) {
    var rate = AC.sampleRate;
    var len = Math.max(1, Math.floor(rate * dur));
    var buf = AC.createBuffer(2, len, rate);
    for (var ch = 0; ch < 2; ch++) {
      var d = buf.getChannelData(ch);
      var prev = 0;
      for (var i = 0; i < len; i++) {
        var t = i / len;
        var env = Math.pow(1 - t, decay);
        // low-passed noise so the tail is smooth, not grainy
        var n = (Math.random() * 2 - 1);
        prev = prev + 0.28 * (n - prev);
        d[i] = prev * env;
      }
    }
    return buf;
  }

  function unlockAudio() {
    initAudio();
    if (!AC) return;
    if (AC.state === "suspended") AC.resume();
    // 1-sample silent buffer to satisfy iOS
    try {
      var b = AC.createBuffer(1, 1, 22050);
      var s = AC.createBufferSource();
      s.buffer = b;
      s.connect(AC.destination);
      s.start(0);
    } catch (e) {}
  }

  function now() { return AC ? AC.currentTime : 0; }

  // a single tone voice with envelope + optional pan
  function voice(opts) {
    if (!AC) return;
    var t = now();
    var o = AC.createOscillator();
    o.type = opts.type || "sine";
    o.frequency.setValueAtTime(opts.f, t);
    if (opts.f2) o.frequency.exponentialRampToValueAtTime(Math.max(1, opts.f2), t + (opts.dur || 0.3));
    if (opts.detune) o.detune.value = opts.detune;

    var g = AC.createGain();
    var a = opts.a != null ? opts.a : 0.006;
    var d = opts.dur || 0.3;
    var peak = opts.g != null ? opts.g : 0.3;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);

    var node = o;
    if (opts.filt) {
      var f = AC.createBiquadFilter();
      f.type = opts.filt;
      f.frequency.value = opts.filtF || 2000;
      if (opts.filtQ) f.Q.value = opts.filtQ;
      node.connect(f); node = f;
    }
    node.connect(g);
    if (opts.pan != null && AC.createStereoPanner) {
      var p = AC.createStereoPanner();
      p.pan.value = clamp(opts.pan, -1, 1);
      g.connect(p); p.connect(outGain);
    } else {
      g.connect(outGain);
    }
    o.start(t);
    o.stop(t + a + d + 0.05);
  }

  function noiseHit(opts) {
    if (!AC) return;
    var t = now();
    var dur = opts.dur || 0.12;
    var len = Math.max(1, Math.floor(AC.sampleRate * dur));
    var buf = AC.createBuffer(1, len, AC.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1);
    var s = AC.createBufferSource();
    s.buffer = buf;
    var f = AC.createBiquadFilter();
    f.type = opts.filt || "bandpass";
    f.frequency.value = opts.f || 1600;
    if (opts.Q) f.Q.value = opts.Q;
    var g = AC.createGain();
    var peak = opts.g != null ? opts.g : 0.2;
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(outGain);
    s.start(t); s.stop(t + dur + 0.02);
  }

  // subtle metronome tick as the needle sweeps
  function sndTick() {
    if (!AC || !soundOn) return;
    voice({ type: "sine", f: 1250, f2: 720, dur: 0.05, a: 0.002, g: 0.05, pan: rnd(-0.15, 0.15) });
  }

  // stop chime: brightness + pitch scale with accuracy (acc 0..1, 1 = perfect)
  function sndStop(acc, perfect) {
    if (!AC || !soundOn) return;
    // choose a pentatonic note that climbs with accuracy
    var idx = clamp(Math.round(acc * 6), 0, 6) + (perfect ? 3 : 0);
    var semi = pentat[clamp(idx, 0, pentat.length - 1)];
    var base = 330 * Math.pow(2, semi / 12);
    var pan = clamp(Math.cos((target) * RAD) * 0.55, -0.7, 0.7);
    // bright transient
    noiseHit({ f: 2600 + acc * 3600, Q: 1.2, dur: 0.05, g: 0.05 + acc * 0.08, filt: "bandpass" });
    // harmonic body (brighter/longer the closer you land)
    voice({ type: "triangle", f: base, dur: 0.35 + acc * 0.45, a: 0.004, g: 0.16 + acc * 0.12, pan: pan, filt: "lowpass", filtF: 1400 + acc * 5200 });
    voice({ type: "sine", f: base * 2, dur: 0.3 + acc * 0.4, a: 0.004, g: 0.08 + acc * 0.08, pan: pan });
    if (perfect) {
      // shimmer octave sparkle on a bull's-eye
      voice({ type: "sine", f: base * 3, dur: 0.6, a: 0.004, g: 0.09, pan: pan });
      voice({ type: "sine", f: base * 4, dur: 0.5, a: 0.006, g: 0.05, pan: -pan });
    }
  }

  // rising pentatonic ladder as the streak climbs
  function sndStreak(n) {
    if (!AC || !soundOn) return;
    var idx = Math.min(n, 12);
    var semi = pentat[Math.min(idx, pentat.length - 1)] + (idx >= pentat.length ? 12 : 0);
    var base = 392 * Math.pow(2, semi / 12);
    voice({ type: "triangle", f: base, dur: 0.34, a: 0.005, g: 0.12, filt: "lowpass", filtF: 5200 });
    voice({ type: "sine", f: base * 2, dur: 0.28, a: 0.005, g: 0.06 });
  }

  // airy "whiff" each time the needle laps the target without a stop
  function sndWhiff(n) {
    if (!AC || !soundOn) return;
    noiseHit({ f: 900 + n * 520, Q: 0.9, dur: 0.14, g: 0.05, filt: "bandpass" });
    voice({ type: "sine", f: 320 + n * 90, f2: 190 + n * 60, dur: 0.16, a: 0.003, g: 0.06 });
  }

  // gentle buzz/thud on a miss (not harsh)
  function sndMiss() {
    if (!AC || !soundOn) return;
    voice({ type: "sine", f: 150, f2: 60, dur: 0.4, a: 0.005, g: 0.26 });
    voice({ type: "sawtooth", f: 128, f2: 74, dur: 0.28, a: 0.006, g: 0.05, filt: "lowpass", filtF: 460 });
    noiseHit({ f: 240, Q: 0.7, dur: 0.22, g: 0.06, filt: "lowpass" });
  }

  function sndFanfare() {
    if (!AC || !soundOn) return;
    var notes = [0, 4, 7, 12, 16];
    for (var i = 0; i < notes.length; i++) {
      (function (semi, k) {
        setTimeout(function () {
          var base = 440 * Math.pow(2, semi / 12);
          voice({ type: "triangle", f: base, dur: 0.5, a: 0.005, g: 0.13, filt: "lowpass", filtF: 6000, pan: (k - 2) * 0.22 });
          voice({ type: "sine", f: base * 2, dur: 0.42, a: 0.005, g: 0.06, pan: (k - 2) * 0.22 });
        }, k * 82);
      })(notes[i], i);
    }
  }

  function setSound(on) {
    soundOn = on;
    soundBtn.setAttribute("aria-pressed", on ? "true" : "false");
    if (outGain && AC) {
      try { outGain.gain.setTargetAtTime(on ? 1 : 0, now(), 0.02); } catch (e) { outGain.gain.value = on ? 1 : 0; }
    }
    try { localStorage.setItem("timing_sound", on ? "1" : "0"); } catch (e) {}
  }

  // ================================================================= SIZING
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cx = W / 2;
    cy = H / 2;
    R = Math.min(W, H) * 0.5 - Math.min(W, H) * 0.12;
    R = clamp(R, 78, 340);
  }

  // =============================================================== GAME FLOW
  function startGame() {
    unlockAudio();
    score = 0; displayScore = 0; streak = 0;
    speed = SPD_START; tol = TOL_START; dir = 1;
    needle = -90 - 40 * dir;
    newTarget();
    lastErr = 0; lastPerfect = false; lastTimedOut = false;
    scoreEl.textContent = "0";
    streakEl.textContent = "0";
    streakCell.hidden = true;
    particles.length = 0; rings.length = 0; floaters.length = 0;
    shake = 0; flashCol = null;
    state = "sweep";
    overlay.hidden = true;
    hud.hidden = false;
    document.body.classList.add("is-playing");
    hint.classList.remove("is-gone");
  }

  function newTarget() {
    // place target away from the current needle so there's travel to time
    var away = rnd(70, 290) * dir;
    target = norm180(needle + away);
    passCount = 0;
    prevDiff = null;   // re-seed crossing detection for the new target
  }

  function stopNeedle() {
    if (state !== "sweep") return;
    hint.classList.add("is-gone");
    var err = Math.abs(norm180(needle - target));
    lastErr = err;
    var perfect = err <= PERFECT_DEG;
    lastPerfect = perfect;
    lastTimedOut = false;

    // snap the needle visually to a crisp rest
    snapFrom = needle;
    snapTo = needle;
    snapT = 1;

    if (err <= tol) {
      // ---- HIT
      var acc = clamp(1 - err / tol, 0, 1);   // 0 at the edge, 1 at dead centre
      streak++;
      var mult = 1 + (streak - 1) * 0.18;      // streak multiplier
      var pts = Math.round((28 + 72 * acc) * mult);
      if (perfect) pts += 150;
      score += pts;

      scorePop = 1;
      streakCell.hidden = false;
      streakEl.textContent = streak;

      sndStop(acc, perfect);
      if (streak >= 2) sndStreak(streak);

      // FX at the stop point
      var sx = cx + Math.cos(needle * RAD) * R;
      var sy = cy + Math.sin(needle * RAD) * R;
      burst(sx, sy, perfect);
      rings.push({ x: cx, y: cy, r: R * 0.62, max: R * 1.15, life: 1, gold: perfect || acc > 0.75 });
      floaters.push({
        x: sx, y: sy, life: 1,
        txt: perfect ? "PERFECT" : (err.toFixed(1) + "°"),
        col: perfect ? "255,207,107" : (acc > 0.6 ? "111,227,255" : "224,230,255"),
        big: perfect, up: perfect ? 46 : 34
      });
      floaters.push({ x: sx, y: sy - 20, life: 1, txt: "+" + pts, col: "111,227,255", big: false, up: 26, delay: perfect ? 0.12 : 0 });

      shake = perfect ? 9 : 4 + acc * 3;
      if (perfect) { flashCol = "255,207,107"; flashT = 1; }

      // ramp difficulty for the next stop
      speed = Math.min(SPD_MAX, speed + SPD_STEP);
      tol = Math.max(TOL_MIN, tol - TOL_STEP);
      if (Math.random() < 0.5) dir *= -1; // occasionally flip direction

      resolveT = RESOLVE_MS;
      state = "resolve";
    } else {
      // ---- MISS -> end run
      sndMiss();
      shake = 12;
      flashCol = "255,122,168"; flashT = 1;
      var mx = cx + Math.cos(needle * RAD) * R;
      var my = cy + Math.sin(needle * RAD) * R;
      floaters.push({ x: mx, y: my, life: 1, txt: err.toFixed(1) + "°", col: "255,122,168", big: true, up: 30 });
      streak = 0;
      resolveT = FAIL_MS;
      state = "fail";
    }
  }

  // run out of laps: the needle passed the target too many times
  function timeoutMiss() {
    hint.classList.add("is-gone");
    lastErr = Math.abs(norm180(needle - target));
    lastPerfect = false;
    lastTimedOut = true;
    sndMiss();
    shake = 12;
    flashCol = "255,122,168"; flashT = 1;
    var mx = cx + Math.cos(needle * RAD) * R;
    var my = cy + Math.sin(needle * RAD) * R;
    floaters.push({ x: mx, y: my, life: 1, txt: "TOO SLOW", col: "255,122,168", big: true, up: 30 });
    rings.push({ x: cx, y: cy, r: R * 0.62, max: R * 1.2, life: 1, col: "255,122,168" });
    streak = 0;
    resolveT = FAIL_MS;
    state = "fail";
  }

  function nextSweep() {
    newTarget();
    state = "sweep";
  }

  function endRun() {
    state = "over";
    var isBest = score > best;
    if (isBest) {
      best = score;
      try { localStorage.setItem("timing_best", String(best)); } catch (e) {}
      bestEl.textContent = best;
      sndFanfare();
      confettiBurst();
    }
    // build the game-over panel
    ovEyebrow.textContent = isBest ? "New best!" : "Run over";
    ovTitle.textContent = isBest ? String(score) : String(score);
    var line;
    if (lastTimedOut) {
      line = "You stacked " + score + " point" + (score === 1 ? "" : "s") +
        ", then let the needle lap the target " + PASS_LIMIT + " times without a stop.";
    } else {
      line = "You stacked " + score + " point" + (score === 1 ? "" : "s") +
        ". Last stop was " + lastErr.toFixed(1) + "° off" +
        (lastPerfect ? " — a PERFECT to finish." : ".");
    }
    ovText.innerHTML = line + "<br><br>Stop the needle on the target within <b>" + PASS_LIMIT + "</b> passes. Go again?";
    ovKeys.textContent = "tap / click / space to stop";
    ovBtn.textContent = "Play again";
    overlay.hidden = false;
    hud.hidden = false;
    document.body.classList.remove("is-playing");

    window.OPT_SHARE_TEXT = "I scored " + score + " at Perfect Timing on One Page Toys" +
      (isBest ? " — new personal best!" : "!") + " Can you land a PERFECT?";
  }

  // ------------------------------------------------------------------- FX
  function burst(x, y, big) {
    if (REDMO) { return; }
    var n = big ? 34 : 18;
    for (var i = 0; i < n; i++) {
      var a = rnd(0, TAU);
      var sp = rnd(1.2, big ? 6 : 4);
      particles.push({
        x: x, y: y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: 1, decay: rnd(0.012, 0.03),
        r: rnd(1.4, big ? 4 : 3),
        col: big ? "255,207,107" : (Math.random() < 0.5 ? "111,227,255" : "224,230,255")
      });
    }
  }

  var confetti = [];
  function confettiBurst() {
    if (REDMO) return;
    for (var i = 0; i < 120; i++) {
      confetti.push({
        x: rnd(0, W), y: rnd(-H * 0.3, 0),
        vx: rnd(-1.2, 1.2), vy: rnd(2, 5),
        r: rnd(3, 7), rot: rnd(0, TAU), vr: rnd(-0.2, 0.2),
        col: ["255,207,107", "111,227,255", "255,122,168", "238,242,255"][i % 4],
        life: 1
      });
    }
  }

  // ================================================================= RENDER
  function drawDial() {
    ctx.save();
    if (shake > 0.4 && !REDMO) {
      ctx.translate(rnd(-shake, shake) * 0.4, rnd(-shake, shake) * 0.4);
    }

    // vignette / ambient glow behind the dial
    var vg = ctx.createRadialGradient(cx, cy, R * 0.2, cx, cy, R * 2.1);
    vg.addColorStop(0, "rgba(30,44,86,0.55)");
    vg.addColorStop(0.5, "rgba(14,20,40,0.25)");
    vg.addColorStop(1, "rgba(6,9,18,0)");
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);

    // outer bezel
    ctx.lineWidth = Math.max(2, R * 0.02);
    ctx.strokeStyle = "rgba(150,180,240,0.14)";
    ctx.beginPath(); ctx.arc(cx, cy, R * 1.09, 0, TAU); ctx.stroke();

    // dial face
    var face = ctx.createRadialGradient(cx, cy - R * 0.25, R * 0.1, cx, cy, R * 1.05);
    face.addColorStop(0, "rgba(24,34,64,0.92)");
    face.addColorStop(1, "rgba(11,16,32,0.96)");
    ctx.fillStyle = face;
    ctx.beginPath(); ctx.arc(cx, cy, R * 1.02, 0, TAU); ctx.fill();

    // inner track ring
    ctx.lineWidth = Math.max(6, R * 0.11);
    ctx.strokeStyle = "rgba(120,150,210,0.10)";
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.stroke();

    // tick marks
    for (var d = 0; d < 360; d += 6) {
      var major = (d % 30) === 0;
      var a = d * RAD;
      var r0 = R * (major ? 0.86 : 0.9);
      var r1 = R * (major ? 1.02 : 0.99);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      ctx.lineWidth = major ? Math.max(1.5, R * 0.014) : Math.max(0.75, R * 0.006);
      ctx.strokeStyle = major ? "rgba(180,205,255,0.4)" : "rgba(150,175,225,0.18)";
      ctx.stroke();
    }

    // ---- target wedge (glowing)
    if (state === "sweep" || state === "resolve" || state === "fail") {
      var t0 = (target - tol) * RAD;
      var t1 = (target + tol) * RAD;
      var pulse = state === "sweep" ? 0.5 + 0.5 * Math.sin(performance.now() / 340) : 1;
      var gcol = state === "fail" ? [255, 122, 168] : [255, 207, 107];
      // glow band
      ctx.save();
      ctx.lineCap = "round";
      ctx.strokeStyle = "rgba(" + gcol[0] + "," + gcol[1] + "," + gcol[2] + "," + (0.28 + pulse * 0.22) + ")";
      ctx.lineWidth = R * 0.17;
      ctx.shadowColor = "rgba(" + gcol[0] + "," + gcol[1] + "," + gcol[2] + "," + (0.6) + ")";
      ctx.shadowBlur = REDMO ? 0 : 18 + pulse * 14;
      ctx.beginPath(); ctx.arc(cx, cy, R, t0, t1); ctx.stroke();
      ctx.restore();
      // crisp core wedge
      ctx.strokeStyle = "rgba(" + gcol[0] + "," + gcol[1] + "," + gcol[2] + ",0.95)";
      ctx.lineWidth = R * 0.09;
      ctx.lineCap = "butt";
      ctx.beginPath(); ctx.arc(cx, cy, R, t0, t1); ctx.stroke();
      // centre bull notch
      var tc = target * RAD;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(tc) * R * 0.83, cy + Math.sin(tc) * R * 0.83);
      ctx.lineTo(cx + Math.cos(tc) * R * 1.06, cy + Math.sin(tc) * R * 1.06);
      ctx.lineWidth = Math.max(1.6, R * 0.018);
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.stroke();
    }

    // expanding rings
    for (var ri = 0; ri < rings.length; ri++) {
      var rg = rings[ri];
      var rr = rg.r + (rg.max - rg.r) * (1 - rg.life);
      ctx.beginPath();
      ctx.arc(cx, cy, rr, 0, TAU);
      ctx.lineWidth = Math.max(1, R * 0.02 * rg.life);
      var rc = rg.col ? rg.col : (rg.gold ? "255,207,107" : "111,227,255");
      ctx.strokeStyle = "rgba(" + rc + "," + (rg.life * 0.5) + ")";
      ctx.stroke();
    }

    // ---- needle
    var na = needle * RAD;
    ctx.save();
    // needle glow
    if (!REDMO) {
      ctx.shadowColor = "rgba(111,227,255,0.85)";
      ctx.shadowBlur = 14;
    }
    ctx.strokeStyle = "rgba(160,240,255,0.98)";
    ctx.lineWidth = Math.max(2.4, R * 0.026);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(cx - Math.cos(na) * R * 0.16, cy - Math.sin(na) * R * 0.16);
    ctx.lineTo(cx + Math.cos(na) * R * 1.0, cy + Math.sin(na) * R * 1.0);
    ctx.stroke();
    // needle tip dot
    ctx.shadowBlur = REDMO ? 0 : 10;
    ctx.fillStyle = "#eaffff";
    ctx.beginPath();
    ctx.arc(cx + Math.cos(na) * R, cy + Math.sin(na) * R, Math.max(2.4, R * 0.028), 0, TAU);
    ctx.fill();
    ctx.restore();

    // pivot hub
    var hubG = ctx.createRadialGradient(cx - R * 0.03, cy - R * 0.03, 1, cx, cy, R * 0.14);
    hubG.addColorStop(0, "rgba(180,210,255,0.95)");
    hubG.addColorStop(0.5, "rgba(70,96,150,0.95)");
    hubG.addColorStop(1, "rgba(20,28,52,0.98)");
    ctx.fillStyle = hubG;
    ctx.beginPath(); ctx.arc(cx, cy, R * 0.11, 0, TAU); ctx.fill();
    ctx.lineWidth = Math.max(1, R * 0.01);
    ctx.strokeStyle = "rgba(160,200,255,0.4)";
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.beginPath(); ctx.arc(cx, cy, R * 0.032, 0, TAU); ctx.fill();

    // ---- centre readout (live error / accuracy)
    if (state === "sweep" || state === "resolve" || state === "fail") {
      ctx.textAlign = "center";
      if (state === "sweep") {
        ctx.fillStyle = "rgba(224,230,255,0.34)";
        ctx.font = "600 " + Math.max(9, R * 0.088) + "px 'Geist Mono', ui-monospace, monospace";
        ctx.fillText("STOP THE NEEDLE", cx, cy + R * 0.42);
        ctx.fillStyle = "rgba(255,207,107,0.5)";
        ctx.font = "700 " + Math.max(8, R * 0.07) + "px 'Geist Mono', ui-monospace, monospace";
        ctx.fillText("±" + tol.toFixed(1) + "° TO SCORE", cx, cy + R * 0.56);
        // remaining-lap pips: spent laps go dim/pink, the run ends on the last
        var pr = Math.max(2.2, R * 0.026);
        var gap = pr * 3.6;
        var totalW = (PASS_LIMIT - 1) * gap;
        var py = cy + R * 0.72;
        for (var pp = 0; pp < PASS_LIMIT; pp++) {
          var px = cx - totalW / 2 + pp * gap;
          var spent = pp < passCount;
          ctx.beginPath();
          ctx.arc(px, py, pr, 0, TAU);
          ctx.fillStyle = spent ? "rgba(255,122,168,0.3)" : "rgba(255,207,107,0.85)";
          ctx.fill();
        }
      } else {
        var big = lastPerfect;
        var timedOut = state === "fail" && lastTimedOut;
        var col = state === "fail" ? "255,122,168" : (big ? "255,207,107" : "111,227,255");
        ctx.fillStyle = "rgba(" + col + ",0.95)";
        if (timedOut) {
          ctx.font = "800 " + Math.max(14, R * 0.17) + "px 'Geist', system-ui, sans-serif";
          ctx.fillText("TOO SLOW", cx, cy + R * 0.5);
        } else {
          ctx.font = "800 " + Math.max(18, R * 0.26) + "px 'Geist', system-ui, sans-serif";
          ctx.fillText(big ? "PERFECT" : (lastErr.toFixed(1) + "°"), cx, cy + R * 0.5);
        }
        ctx.fillStyle = "rgba(224,230,255,0.42)";
        ctx.font = "600 " + Math.max(8, R * 0.072) + "px 'Geist Mono', ui-monospace, monospace";
        ctx.fillText(state === "fail" ? (timedOut ? "LAPPED " + PASS_LIMIT + "×" : "MISSED") : (big ? "DEAD ON" : "OFF TARGET"), cx, cy + R * 0.66);
      }
    }

    // floaters
    ctx.textAlign = "center";
    for (var fi = 0; fi < floaters.length; fi++) {
      var fl = floaters[fi];
      if (fl.delay && fl.delay > 0) continue;
      var e = easeOut(1 - fl.life);
      var fy = fl.y - fl.up * e;
      ctx.globalAlpha = clamp(fl.life * 1.4, 0, 1);
      ctx.fillStyle = "rgba(" + fl.col + ",1)";
      ctx.font = "800 " + (fl.big ? Math.max(16, R * 0.15) : Math.max(12, R * 0.1)) + "px 'Geist', system-ui, sans-serif";
      if (!REDMO) { ctx.shadowColor = "rgba(" + fl.col + ",0.7)"; ctx.shadowBlur = 12; }
      ctx.fillText(fl.txt, fl.x, fy);
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    }

    // particles
    for (var pi = 0; pi < particles.length; pi++) {
      var p = particles[pi];
      ctx.globalAlpha = clamp(p.life, 0, 1);
      ctx.fillStyle = "rgba(" + p.col + ",1)";
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * p.life, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    ctx.restore();

    // full-screen flash
    if (flashCol && flashT > 0) {
      ctx.fillStyle = "rgba(" + flashCol + "," + (flashT * 0.18) + ")";
      ctx.fillRect(0, 0, W, H);
    }

    // confetti (screen space, above shake)
    for (var ci = 0; ci < confetti.length; ci++) {
      var c = confetti[ci];
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate(c.rot);
      ctx.globalAlpha = clamp(c.life, 0, 1);
      ctx.fillStyle = "rgba(" + c.col + ",1)";
      ctx.fillRect(-c.r / 2, -c.r / 2, c.r, c.r * 0.6);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  // ================================================================== LOOP
  function frame(ts) {
    if (!last) last = ts;
    var dt = Math.min(0.05, (ts - last) / 1000);
    last = ts;

    // sweep the needle
    if (state === "sweep") {
      needle += speed * dir * dt;
      needle = norm180(needle);

      // A "pass" counts only once the needle has traveled through the WHOLE
      // safe window and out its far edge — so on every lap (the fatal 3rd
      // included) you still get the full width of the target to stop on.
      // farEdge is the exit side of the window in the sweep direction.
      var d = norm180(needle - target);
      var farEdge = tol * (dir > 0 ? 1 : -1);
      var crossedFar = dir > 0
        ? (prevDiff <= farEdge && d > farEdge)
        : (prevDiff >= farEdge && d < farEdge);
      if (prevDiff !== null &&
          Math.abs(d) < 90 && Math.abs(prevDiff) < 90 && crossedFar) {
        passCount++;
        if (passCount >= PASS_LIMIT) {
          timeoutMiss();
        } else {
          sndWhiff(passCount);
          shake = Math.max(shake, 3);
          rings.push({ x: cx, y: cy, r: R * 0.72, max: R * 1.08, life: 1, col: "255,122,168" });
        }
      }
      prevDiff = d;

      // subtle metronome tick every ~0.5s
      if (state === "sweep") {
        tickAcc += dt;
        if (tickAcc >= 0.5) { tickAcc -= 0.5; sndTick(); }
      }
    }

    // resolve/fail timers
    if (state === "resolve") {
      resolveT -= dt * 1000;
      if (resolveT <= 0) nextSweep();
    } else if (state === "fail") {
      resolveT -= dt * 1000;
      if (resolveT <= 0) endRun();
    }

    // eased HUD score
    if (Math.abs(displayScore - score) > 0.5) {
      displayScore += (score - displayScore) * Math.min(1, dt * 12);
      scoreEl.textContent = Math.round(displayScore);
    } else if (displayScore !== score) {
      displayScore = score;
      scoreEl.textContent = score;
    }
    if (scorePop > 0) scorePop = Math.max(0, scorePop - dt * 3);

    // decay FX
    if (shake > 0) shake = Math.max(0, shake - dt * 40);
    if (flashT > 0) flashT = Math.max(0, flashT - dt * 2.6);

    for (var i = particles.length - 1; i >= 0; i--) {
      var p = particles[i];
      p.x += p.vx; p.y += p.vy;
      p.vx *= 0.94; p.vy *= 0.94; p.vy += 0.05;
      p.life -= p.decay;
      if (p.life <= 0) particles.splice(i, 1);
    }
    for (var r = rings.length - 1; r >= 0; r--) {
      rings[r].life -= dt * 1.6;
      if (rings[r].life <= 0) rings.splice(r, 1);
    }
    for (var f = floaters.length - 1; f >= 0; f--) {
      var fl = floaters[f];
      if (fl.delay && fl.delay > 0) { fl.delay -= dt; continue; }
      fl.life -= dt * 0.9;
      if (fl.life <= 0) floaters.splice(f, 1);
    }
    for (var c = confetti.length - 1; c >= 0; c--) {
      var cf = confetti[c];
      cf.x += cf.vx; cf.y += cf.vy; cf.vy += 0.12; cf.rot += cf.vr;
      cf.life -= dt * 0.32;
      if (cf.life <= 0 || cf.y > H + 40) confetti.splice(c, 1);
    }

    ctx.clearRect(0, 0, W, H);
    drawDial();

    requestAnimationFrame(frame);
  }

  // ================================================================ INPUT
  function onPress(e) {
    // ignore presses on chrome buttons / links
    if (e && e.target && e.target.closest &&
        e.target.closest(".sound-btn, .frame__corner--bl a, .opt-tipjar, .opt-fs, .opt-share, .overlay")) {
      return;
    }
    if (state === "sweep") {
      if (e && e.cancelable) e.preventDefault();
      stopNeedle();
    }
  }

  canvas.addEventListener("pointerdown", onPress, { passive: false });

  window.addEventListener("keydown", function (e) {
    if (e.code === "Space" || e.key === " " || e.code === "Enter") {
      if (state === "menu" || state === "over") {
        e.preventDefault();
        startGame();
        return;
      }
      if (state === "sweep") {
        e.preventDefault();
        stopNeedle();
      }
    }
  });

  ovBtn.addEventListener("click", function () { startGame(); });

  soundBtn.addEventListener("click", function () {
    unlockAudio();
    setSound(!soundOn);
  });

  window.addEventListener("resize", resize);
  window.addEventListener("orientationchange", function () { setTimeout(resize, 120); });

  // ================================================================ BOOT
  resize();
  requestAnimationFrame(frame);
})();
