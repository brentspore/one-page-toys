/* Breathing Pacer — a calm visual breath guide.
 * An orb expands (inhale), holds, and contracts (exhale) through selectable
 * patterns; a ring traces each phase; the scene brightens as you breathe in.
 * Optional ambient tones. Not medical advice.
 */
(function () {
  "use strict";

  var orb = document.getElementById("orb");
  var ringFill = document.getElementById("ringFill");
  var phaseEl = document.getElementById("phase");
  var countEl = document.getElementById("count");
  var breathsEl = document.getElementById("breaths");
  var patHintEl = document.getElementById("patHint");
  var playPause = document.getElementById("playPause");
  var soundBtn = document.getElementById("soundBtn");
  var controls = document.getElementById("controls");
  var liveEl = document.getElementById("live");
  var canvas = document.getElementById("motes");
  if (!orb) return;

  var reduceMotion =
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var C = 295.31; // ring circumference (2πr, r = 47)

  var PATTERNS = {
    calm: { hint: "4 in · 6 out", phases: [["in", 4], ["out", 6]] },
    box: { hint: "4 · 4 · 4 · 4", phases: [["in", 4], ["hold", 4], ["out", 4], ["hold", 4]] },
    "478": { hint: "4 in · 7 hold · 8 out", phases: [["in", 4], ["hold", 7], ["out", 8]] }
  };
  var LABEL = { in: "Breathe in", out: "Breathe out", hold: "Hold" };
  var COLOR = { in: "#7fe3df", out: "#6f8bff", hold: "rgba(214,230,255,0.55)" };

  var patternKey = "calm";
  var phases = PATTERNS[patternKey].phases;
  var idx = 0;
  var phaseElapsed = 0; // ms in current phase
  var scaleFrom = 0.55;
  var scaleTo = 1;
  var curScale = 0.55;
  var running = true;
  var breaths = 0;
  var lastCount = -1;
  var lastTs = 0;

  function easeInOutSine(p) { return -(Math.cos(Math.PI * p) - 1) / 2; }

  function targetFor(type) {
    if (type === "in") return 1;
    if (type === "out") return 0.5;
    return curScale; // hold
  }

  function enterPhase(i) {
    idx = i;
    var ph = phases[i];
    scaleFrom = curScale;
    scaleTo = targetFor(ph[0]);
    phaseEl.textContent = LABEL[ph[0]];
    ringFill.style.stroke = COLOR[ph[0]];
    liveEl.textContent = LABEL[ph[0]] + ", " + ph[1] + " seconds";
    lastCount = -1;
    if (soundOn) audioPhase(ph[0], ph[1]);
  }

  function render() {
    var ph = phases[idx];
    var durMs = ph[1] * 1000;
    var p = Math.min(1, phaseElapsed / durMs);
    var eased = easeInOutSine(p);

    curScale = scaleFrom + (scaleTo - scaleFrom) * eased;
    orb.style.setProperty("--s", curScale.toFixed(4));

    var breath = Math.max(0, Math.min(1, (curScale - 0.5) / 0.5));
    document.body.style.setProperty("--breath", breath.toFixed(3));

    ringFill.style.strokeDashoffset = (C * (1 - p)).toFixed(2);

    var c = Math.max(1, Math.ceil(ph[1] - phaseElapsed / 1000));
    if (c !== lastCount) { countEl.textContent = c; lastCount = c; }
  }

  function loop(ts) {
    var dt = lastTs ? Math.min(60, ts - lastTs) : 16;
    lastTs = ts;

    if (running) {
      phaseElapsed += dt;
      var durMs = phases[idx][1] * 1000;
      if (phaseElapsed >= durMs) {
        phaseElapsed -= durMs;
        var next = (idx + 1) % phases.length;
        if (next === 0) { breaths++; breathsEl.textContent = breaths; }
        enterPhase(next);
      }
      render();
    }
    drawMotes(dt);
    requestAnimationFrame(loop);
  }

  // ---- patterns / controls ---------------------------------------------
  function setPattern(key) {
    if (!PATTERNS[key]) return;
    patternKey = key;
    phases = PATTERNS[key].phases;
    patHintEl.textContent = PATTERNS[key].hint;
    idx = 0; phaseElapsed = 0; breaths = 0; breathsEl.textContent = "0";
    document.querySelectorAll(".pat").forEach(function (b) {
      b.setAttribute("aria-pressed", b.dataset.pat === key ? "true" : "false");
    });
    enterPhase(0);
  }

  document.querySelectorAll(".pat").forEach(function (b) {
    b.addEventListener("click", function () { setPattern(b.dataset.pat); });
  });

  playPause.addEventListener("click", function () {
    running = !running;
    playPause.textContent = running ? "Pause" : "Play";
    playPause.setAttribute("aria-pressed", running ? "true" : "false");
  });

  // ---- ambient sound: a continuous breathing drone (optional) ----------
  var soundOn = false;
  var actx = null, osc = null, osc2 = null, oscSub = null, masterGain = null;

  // Low, warm drone register (A2-ish), gentle movement — see audioPhase.
  var BASE = 110.0; // A2

  function initAudio() {
    actx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = actx.createGain();
    masterGain.gain.value = 0.0001;
    masterGain.connect(actx.destination);
    // warm lowpass so it reads as a soft drone, not a tone
    var lp = actx.createBiquadFilter();
    lp.type = "lowpass"; lp.frequency.value = 480; lp.Q.value = 0.3;
    lp.connect(masterGain);
    osc = actx.createOscillator();
    osc2 = actx.createOscillator();
    oscSub = actx.createOscillator();
    osc.type = "sine"; osc2.type = "sine"; oscSub.type = "sine";
    osc.frequency.value = BASE;
    osc2.frequency.value = BASE * 1.005;  // gentle detune for warmth
    oscSub.frequency.value = BASE * 0.5;  // octave-down body
    var blend = actx.createGain(); blend.gain.value = 0.45;
    var subg = actx.createGain(); subg.gain.value = 0.4;
    osc.connect(lp);
    osc2.connect(blend).connect(lp);
    oscSub.connect(subg).connect(lp);
    osc.start();
    osc2.start();
    oscSub.start();
    // iOS unlock: resume + play a 1-sample silent buffer inside the gesture, or
    // a continuous Web Audio drone can stay silent on iOS Safari even when running.
    if (actx.state === "suspended") actx.resume();
    try {
      var ub = actx.createBuffer(1, 1, 22050);
      var us = actx.createBufferSource();
      us.buffer = ub; us.connect(actx.destination); us.start(0);
    } catch (e) { /* ignore */ }
  }

  // Glide pitch + swell volume across a phase (audible, breath-tracking).
  function audioPhase(type, durSec) {
    if (!soundOn || !actx) return;
    var now = actx.currentTime;
    var d = Math.max(0.4, durSec || 4);
    // gentle low movement (a small step, not a sweep): rise on inhale, settle on exhale
    var f = type === "in" ? 130.81 : type === "out" ? 98.0 : BASE; // C3 / G2 / A2
    var vol = type === "in" ? 0.2 : type === "out" ? 0.09 : 0.14;
    var attack = Math.min(2.2, d * 0.8);
    osc.frequency.cancelScheduledValues(now);
    osc.frequency.setValueAtTime(osc.frequency.value, now);
    osc.frequency.linearRampToValueAtTime(f, now + d);
    osc2.frequency.cancelScheduledValues(now);
    osc2.frequency.setValueAtTime(osc2.frequency.value, now);
    osc2.frequency.linearRampToValueAtTime(f * 1.005, now + d);
    oscSub.frequency.cancelScheduledValues(now);
    oscSub.frequency.setValueAtTime(oscSub.frequency.value, now);
    oscSub.frequency.linearRampToValueAtTime(f * 0.5, now + d);
    masterGain.gain.cancelScheduledValues(now);
    masterGain.gain.setValueAtTime(Math.max(0.0001, masterGain.gain.value), now);
    masterGain.gain.linearRampToValueAtTime(vol, now + attack);
  }

  soundBtn.addEventListener("click", function () {
    soundOn = !soundOn;
    if (soundOn) {
      try {
        if (!actx) initAudio();
        if (actx.state === "suspended") actx.resume();
        var rem = phases[idx][1] - phaseElapsed / 1000;
        audioPhase(phases[idx][0], rem);
      } catch (e) { soundOn = false; }
    } else if (masterGain) {
      var now = actx.currentTime;
      masterGain.gain.cancelScheduledValues(now);
      masterGain.gain.setValueAtTime(Math.max(0.0001, masterGain.gain.value), now);
      masterGain.gain.linearRampToValueAtTime(0.0001, now + 0.4);
    }
    soundBtn.textContent = soundOn ? "Sound on" : "Sound off";
    soundBtn.setAttribute("aria-pressed", soundOn ? "true" : "false");
  });

  // ---- idle fade of controls -------------------------------------------
  var idleTimer = null;
  function wake() {
    controls.style.opacity = "1";
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(function () { controls.style.opacity = "0.32"; }, 5000);
  }
  window.addEventListener("pointermove", wake, { passive: true });
  window.addEventListener("pointerdown", wake, { passive: true });
  wake();

  // ---- drifting motes (canvas) -----------------------------------------
  var ctx = canvas.getContext("2d");
  var DPR = Math.min(2, window.devicePixelRatio || 1);
  var VW = 0, VH = 0, motes = [];
  function resize() {
    VW = window.innerWidth; VH = window.innerHeight;
    canvas.width = VW * DPR; canvas.height = VH * DPR;
    canvas.style.width = VW + "px"; canvas.style.height = VH + "px";
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  resize();
  window.addEventListener("resize", resize);

  if (!reduceMotion) {
    for (var i = 0; i < 46; i++) {
      motes.push({
        x: Math.random() * VW, y: Math.random() * VH,
        r: 0.6 + Math.random() * 1.8,
        vy: -(0.05 + Math.random() * 0.22),
        vx: (Math.random() - 0.5) * 0.12,
        a: 0.06 + Math.random() * 0.22
      });
    }
  }
  function drawMotes() {
    if (reduceMotion || !motes.length) return;
    ctx.clearRect(0, 0, VW, VH);
    for (var i = 0; i < motes.length; i++) {
      var m = motes[i];
      m.x += m.vx; m.y += m.vy;
      if (m.y < -6) { m.y = VH + 6; m.x = Math.random() * VW; }
      if (m.x < -6) m.x = VW + 6; else if (m.x > VW + 6) m.x = -6;
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(190,235,255," + m.a + ")";
      ctx.fill();
    }
  }

  // ---- go ---------------------------------------------------------------
  setPattern("calm");
  requestAnimationFrame(loop);
})();
