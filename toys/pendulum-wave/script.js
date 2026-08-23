/* Pendulum Wave — fifteen pendulums tuned to fall out of step, then back in.
 *
 * The whole toy is one equation. Pendulum i is tuned to complete exactly
 * (N + i) swings in the cycle time T, so its frequency is (N + i) / T and its
 * angle is a closed form:
 *
 *     theta_i(t) = A * cos(2*pi*f_i*t)
 *
 * There is no integration, no collision, no solver and no timestep — which
 * means it cannot drift, blow up or need tuning. The lengths are not chosen for
 * looks either: L = g / (2*pi*f)^2 falls straight out of the frequency, so what
 * you see is the real relationship between a pendulum's length and its period.
 *
 * The patterns are not animated. They are what happens when 15 sine waves of
 * neighbouring frequency drift apart: a travelling wave, then counter-rotating
 * helices at T/2, then apparent chaos, then perfect alignment again at T.
 */
(function () {
  "use strict";

  var GRAV = 9.81;
  var COUNT = 15;          // pendulums
  var CYCLE = 30;          // seconds for every pendulum to realign
  var BASE = 30;           // swings the longest pendulum makes per cycle
  var AMP = 0.42;          // radians, about 24 degrees — small-angle stays honest

  var cv = document.getElementById("canvas");
  var ctx = cv.getContext("2d");
  var W = 0, H = 0, DPR = 1;
  var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  // ---------------------------------------------------------------- state

  var pend = [];
  var G = {
    mode: "intro",        // intro | drawn | running
    t: 0,                 // seconds since release
    amp: AMP,
    drawback: 0,          // 0..1 while dragging them back
    cycle: CYCLE,
    count: COUNT,
    hint: ""
  };

  function build() {
    pend = [];
    for (var i = 0; i < G.count; i++) {
      var swings = BASE + i;
      var f = swings / G.cycle;
      var L = GRAV / Math.pow(2 * Math.PI * f, 2);
      pend.push({
        i: i, swings: swings, f: f, L: L,
        th: 0, lastSign: 0, flash: 0,
        hue: 190 + (i / Math.max(1, G.count - 1)) * 150   // cyan -> magenta down the bar
      });
    }
  }
  build();

  function angleAt(p, t) {
    return G.amp * Math.cos(2 * Math.PI * p.f * t);
  }

  // ---------------------------------------------------------------- layout

  var bar = { x0: 0, x1: 0, y: 0, scale: 1 };

  function resize() {
    DPR = Math.min(2, window.devicePixelRatio || 1);
    W = window.innerWidth; H = window.innerHeight;
    cv.width = Math.floor(W * DPR); cv.height = Math.floor(H * DPR);
    cv.style.width = W + "px"; cv.style.height = H + "px";
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

    var portrait = H > W * 1.1;
    var margin = Math.min(W, H) * (portrait ? 0.12 : 0.16);
    bar.x0 = margin;
    bar.x1 = W - margin;
    /* Hang them from a SLANTED support so every bob rests at the same height.
     * With a level bar the 2.15:1 length ratio drops the left half to the floor
     * and leaves the top right empty, and the descending line drowns out the
     * wave. Levelling the bobs costs nothing physically — the pivots simply sit
     * at different heights — and the swing becomes the only thing moving. */
    /* Sit the row of bobs a little above centre and keep the strings compact.
     * Hanging the longest from 15% of the height left a steep support line
     * dominating the frame and a dead band under the bobs. */
    bar.restY = H * (portrait ? 0.58 : 0.62);
    var longest = pend[0].L;
    bar.scale = (bar.restY - H * (portrait ? 0.22 : 0.26)) / longest;
    bar.y = bar.restY - longest * bar.scale;      // topmost pivot
  }

  function pivotY(p) { return bar.restY - p.L * bar.scale; }

  function pivotX(i) {
    if (G.count === 1) return (bar.x0 + bar.x1) / 2;
    return bar.x0 + (bar.x1 - bar.x0) * (i / (G.count - 1));
  }

  /* The bobs swing PERPENDICULAR to the bar — towards and away from you — which
   * is what makes the wave read as a travelling snake rather than a row of
   * things wobbling side to side. Project that depth with a shear and a slight
   * vertical drop so nearer bobs sit lower and larger. */
  function bobAt(p, th) {
    var L = p.L * bar.scale;
    var z = Math.sin(th) * L;          // towards the viewer
    var drop = Math.cos(th) * L;
    return {
      x: pivotX(p.i) + z * 0.46,
      y: pivotY(p) + drop - z * 0.17,
      depth: z / Math.max(1, L)
    };
  }

  // ---------------------------------------------------------------- render

  var perf = 0;

  function render() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

    // room
    var bg = ctx.createRadialGradient(W / 2, H * 0.34, 10, W / 2, H * 0.5, Math.max(W, H) * 0.8);
    bg.addColorStop(0, "#10131f");
    bg.addColorStop(0.55, "#080a12");
    bg.addColorStop(1, "#04050a");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    var i, p, b;

    // the slanted support the pivots hang from
    var pw2 = Math.max(2, Math.min(W, H) * 0.006);
    ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(140, 165, 210, 0.16)";
    ctx.lineWidth = pw2 * 0.7;
    ctx.beginPath();
    ctx.moveTo(pivotX(0) - 16, pivotY(pend[0]));
    ctx.lineTo(pivotX(pend.length - 1) + 16, pivotY(pend[pend.length - 1]));
    ctx.stroke();
    ctx.strokeStyle = "rgba(210, 230, 255, 0.26)";
    ctx.lineWidth = Math.max(1, pw2 * 0.22);
    ctx.beginPath();
    ctx.moveTo(pivotX(0) - 16, pivotY(pend[0]) - 1);
    ctx.lineTo(pivotX(pend.length - 1) + 16, pivotY(pend[pend.length - 1]) - 1);
    ctx.stroke();

    // draw far bobs first so nearer ones overlap correctly
    var order = pend.slice().sort(function (a, c) {
      return bobAt(a, a.th).depth - bobAt(c, c.th).depth;
    });

    var bobR = Math.max(5, Math.min(W, H) * 0.017);

    for (i = 0; i < order.length; i++) {
      p = order[i];
      b = bobAt(p, p.th);
      var px = pivotX(p.i), py = pivotY(p);
      var scale = 1 + b.depth * 0.16;

      // string
      ctx.strokeStyle = "rgba(180, 205, 245, " + (0.12 + b.depth * 0.09) + ")";
      ctx.lineWidth = Math.max(0.7, bobR * 0.09);
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();

      // pivot
      ctx.fillStyle = "rgba(200, 220, 255, 0.33)";
      ctx.beginPath(); ctx.arc(px, py, Math.max(1.4, bobR * 0.16), 0, Math.PI * 2); ctx.fill();

      var r = bobR * scale;
      var lit = p.flash;
      var hue = p.hue;

      // glow, brighter as it passes through the centre
      var gg = ctx.createRadialGradient(b.x, b.y, r * 0.2, b.x, b.y, r * (2.4 + lit * 1.6));
      gg.addColorStop(0, "hsla(" + hue + ", 90%, 70%, " + (0.20 + lit * 0.45) + ")");
      gg.addColorStop(1, "hsla(" + hue + ", 90%, 60%, 0)");
      ctx.fillStyle = gg;
      ctx.beginPath(); ctx.arc(b.x, b.y, r * (2.4 + lit * 1.6), 0, Math.PI * 2); ctx.fill();

      // the bob: a small polished sphere
      var sg = ctx.createRadialGradient(b.x - r * 0.36, b.y - r * 0.4, r * 0.1, b.x, b.y, r);
      sg.addColorStop(0, "hsl(" + hue + ", 100%, " + (86 + lit * 12) + "%)");
      sg.addColorStop(0.45, "hsl(" + hue + ", 85%, " + (62 + lit * 16) + "%)");
      sg.addColorStop(1, "hsl(" + (hue + 12) + ", 70%, " + (22 + lit * 10) + "%)");
      ctx.fillStyle = sg;
      ctx.beginPath(); ctx.arc(b.x, b.y, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.beginPath();
      ctx.ellipse(b.x - r * 0.34, b.y - r * 0.38, r * 0.2, r * 0.14, -0.6, 0, Math.PI * 2);
      ctx.fill();
    }

    // while drawing them back, show where they will be released from
    if (G.mode === "drawn" && G.drawback > 0.02) {
      ctx.strokeStyle = "rgba(255, 220, 150, 0.28)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (i = 0; i < pend.length; i++) {
        var bb = bobAt(pend[i], G.amp * G.drawback);
        if (i === 0) ctx.moveTo(bb.x, bb.y); else ctx.lineTo(bb.x, bb.y);
      }
      ctx.stroke();
    }
  }

  // ---------------------------------------------------------------- loop

  var lastT = 0;

  function frame(ms) {
    if (!lastT) lastT = ms;
    var dt = Math.min(0.05, (ms - lastT) / 1000);
    lastT = ms; perf = ms;

    var i, p;
    if (G.mode === "running") {
      G.t += dt;
      for (i = 0; i < pend.length; i++) {
        p = pend[i];
        var prev = p.th;
        p.th = angleAt(p, G.t);
        // a chime as it swings through the lowest point, one direction only,
        // so the rhythm emerges from the tuning instead of doubling up
        var sign = p.th >= 0 ? 1 : -1;
        if (p.lastSign === 1 && sign === -1) {
          p.flash = 1;
          Audio2.chime(p.i, pend.length, Math.abs(p.th - prev) / Math.max(1e-6, dt));
        }
        p.lastSign = sign;
        p.flash = Math.max(0, p.flash - dt * 3.4);
      }
      updateHud();
    } else if (G.mode === "drawn") {
      for (i = 0; i < pend.length; i++) {
        pend[i].th = G.amp * G.drawback;
        pend[i].flash = Math.max(0, pend[i].flash - dt * 3.4);
      }
    } else {
      for (i = 0; i < pend.length; i++) {
        pend[i].th = 0;
        pend[i].flash = Math.max(0, pend[i].flash - dt * 3.4);
      }
    }

    render();
    requestAnimationFrame(frame);
  }

  // ---------------------------------------------------------------- audio

  var Audio2 = (function () {
    var ctx2 = null, out = null, comp = null, verb = null, wet = null, ready = false, on = true;
    var last = 0;

    function impulse(sec, decay) {
      var rate = ctx2.sampleRate, len = Math.floor(rate * sec);
      var buf = ctx2.createBuffer(2, len, rate), c, i, l = [0, 0];
      for (c = 0; c < 2; c++) {
        var d = buf.getChannelData(c);
        for (i = 0; i < len; i++) {
          var n = Math.random() * 2 - 1;
          l[c] = l[c] * 0.72 + n * 0.28;
          d[i] = l[c] * Math.pow(1 - i / len, decay);
        }
      }
      return buf;
    }

    function init() {
      if (ready) return;
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx2 = new AC();
      var b = ctx2.createBuffer(1, 1, 22050), s = ctx2.createBufferSource();
      s.buffer = b; s.connect(ctx2.destination); s.start(0);

      out = ctx2.createGain(); out.gain.value = on ? 1 : 0;
      comp = ctx2.createDynamicsCompressor();
      comp.threshold.value = -18; comp.ratio.value = 4;
      comp.attack.value = 0.003; comp.release.value = 0.18;

      /* Fifteen bobs crossing centre can land almost together, so the tails
       * have to be short and the bus has to be glued, or the realignment moment
       * turns to mush exactly when it should be the payoff. */
      verb = ctx2.createConvolver(); verb.buffer = impulse(1.9, 2.6);
      wet = ctx2.createGain(); wet.gain.value = 0.26;
      var hp = ctx2.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 400;

      out.connect(comp); comp.connect(ctx2.destination);
      comp.connect(hp); hp.connect(verb); verb.connect(wet); wet.connect(ctx2.destination);
      ready = true;
    }

    // a pentatonic run down the bar, so any combination is consonant
    var SCALE = [0, 2, 4, 7, 9];
    function noteFor(i, n) {
      var deg = Math.round(i / Math.max(1, n - 1) * 14);
      var oct = Math.floor(deg / 5), st = SCALE[deg % 5];
      return 261.63 * Math.pow(2, (st + oct * 12) / 12);
    }

    return {
      init: init,
      isReady: function () { return ready; },
      setOn: function (v) { on = v; if (out) out.gain.setTargetAtTime(v ? 1 : 0, ctx2.currentTime, 0.01); },
      chime: function (i, n, speed) {
        init();
        if (!ready) return;
        var t = ctx2.currentTime;
        if (t - last < 0.006) return;      // keep a dense moment from clipping
        last = t;
        var f = noteFor(i, n);
        var vel = clamp(0.35 + speed * 0.22, 0.3, 1);
        var mix = ctx2.createGain(); mix.gain.value = 0.10 * vel;

        // struck metal: a few inharmonic partials over a soft mallet transient
        var ratios = [1, 2.01, 3.03, 4.36];
        for (var k = 0; k < ratios.length; k++) {
          var o = ctx2.createOscillator();
          o.type = "sine";
          o.frequency.value = f * ratios[k] * (1 + (Math.random() - 0.5) * 0.004);
          var g = ctx2.createGain();
          var dur = 1.5 / (1 + k * 1.4);
          g.gain.setValueAtTime(0, t);
          g.gain.linearRampToValueAtTime(1 / (1 + k * 1.7), t + 0.004);
          g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
          o.connect(g); g.connect(mix);
          o.start(t); o.stop(t + dur + 0.05);
        }
        var len = Math.max(1, Math.floor(ctx2.sampleRate * 0.006));
        var nb = ctx2.createBuffer(1, len, ctx2.sampleRate), nd = nb.getChannelData(0);
        for (var q = 0; q < len; q++) nd[q] = Math.random() * 2 - 1;
        var ns = ctx2.createBufferSource(); ns.buffer = nb;
        var nf = ctx2.createBiquadFilter();
        nf.type = "bandpass"; nf.frequency.value = f * 3.5; nf.Q.value = 1.1;
        var ng = ctx2.createGain(); ng.gain.value = 0.32;
        ns.connect(nf); nf.connect(ng); ng.connect(mix);
        ns.start(t); ns.stop(t + 0.03);

        var pan;
        if (ctx2.createStereoPanner) {
          pan = ctx2.createStereoPanner();
          pan.pan.value = (i / Math.max(1, n - 1)) * 1.5 - 0.75;
        } else pan = ctx2.createGain();
        mix.connect(pan); pan.connect(out);
      },
      release: function () {
        init(); if (!ready) return;
        var t = ctx2.currentTime;
        var o = ctx2.createOscillator(); o.type = "sine";
        o.frequency.setValueAtTime(150, t);
        o.frequency.exponentialRampToValueAtTime(70, t + 0.28);
        var g = ctx2.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.16, t + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0005, t + 0.32);
        o.connect(g); g.connect(out);
        o.start(t); o.stop(t + 0.35);
      }
    };
  })();

  // ---------------------------------------------------------------- input

  var dragging = false, ptrId = null, dragY0 = 0;

  function localY(e) {
    var r = cv.getBoundingClientRect();
    return e.clientY - r.top;
  }

  cv.addEventListener("pointerdown", function (e) {
    e.preventDefault();
    Audio2.init();
    if (G.mode === "intro") return;
    dragging = true; ptrId = e.pointerId;
    dragY0 = localY(e);
    G.mode = "drawn";
    G.drawback = 0;
    cv.setPointerCapture(e.pointerId);
  }, { passive: false });

  cv.addEventListener("pointermove", function (e) {
    if (!dragging || e.pointerId !== ptrId) return;
    var dy = localY(e) - dragY0;
    G.drawback = clamp(dy / (H * 0.28), 0, 1);
  });

  function release(e) {
    if (!dragging || (e && e.pointerId !== ptrId)) return;
    dragging = false; ptrId = null;
    if (G.drawback > 0.06) {
      G.amp = AMP * (0.35 + G.drawback * 0.65);
      G.t = 0;
      for (var i = 0; i < pend.length; i++) { pend[i].th = G.amp; pend[i].lastSign = 1; }
      G.mode = "running";
      Audio2.release();
      say("released together — watch them drift apart", 2600);
    } else {
      G.mode = "running";
    }
    G.drawback = 0;
  }
  cv.addEventListener("pointerup", release);
  cv.addEventListener("pointercancel", release);

  window.addEventListener("keydown", function (e) {
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      if (G.mode === "intro") { begin(); return; }
      restart();
    }
  });

  function restart() {
    G.t = 0; G.amp = AMP;
    for (var i = 0; i < pend.length; i++) { pend[i].th = G.amp; pend[i].lastSign = 1; }
    G.mode = "running";
    Audio2.release();
  }

  // ---------------------------------------------------------------- hud

  var elPhase = document.getElementById("phase");
  var elCycle = document.getElementById("cycle");
  var elHud = document.getElementById("hud");
  var elMsg = document.getElementById("callout");
  var overlay = document.getElementById("overlay");
  var ovBtn = document.getElementById("ovBtn");

  function updateHud() {
    if (elPhase) {
      var into = G.t % G.cycle;
      elPhase.textContent = into.toFixed(1) + "s";
    }
    if (elCycle) elCycle.textContent = G.cycle + "s";
  }
  function say(t, ms) {
    if (!elMsg) return;
    elMsg.textContent = t;
    elMsg.hidden = false;
    clearTimeout(say._t);
    say._t = setTimeout(function () { elMsg.hidden = true; }, ms || 2000);
  }

  function begin() {
    if (overlay) {
      overlay.classList.add("is-out");
      setTimeout(function () { overlay.hidden = true; }, 260);
    }
    if (elHud) elHud.hidden = false;
    var barEl = document.getElementById("bar");
    if (barEl) barEl.hidden = false;
    var hintEl = document.getElementById("hint");
    if (hintEl) setTimeout(function () { hintEl.classList.add("is-gone"); }, 8000);
    Audio2.init();
    restart();
    if (window.gtag) window.gtag("event", "toy_start", { toy_slug: "pendulum-wave" });
  }
  if (ovBtn) ovBtn.addEventListener("click", begin);

  var presets = document.querySelectorAll("[data-cycle]");
  for (var pi = 0; pi < presets.length; pi++) {
    (function (b) {
      b.addEventListener("click", function () {
        Audio2.init();
        G.cycle = parseInt(b.getAttribute("data-cycle"), 10);
        build(); resize(); restart();
        for (var k = 0; k < presets.length; k++) presets[k].classList.toggle("is-on", presets[k] === b);
        say(G.cycle + " seconds to realign", 1800);
      });
    })(presets[pi]);
  }
  var counts = document.querySelectorAll("[data-count]");
  for (var ci = 0; ci < counts.length; ci++) {
    (function (b) {
      b.addEventListener("click", function () {
        Audio2.init();
        G.count = parseInt(b.getAttribute("data-count"), 10);
        build(); resize(); restart();
        for (var k = 0; k < counts.length; k++) counts[k].classList.toggle("is-on", counts[k] === b);
      });
    })(counts[ci]);
  }

  var soundBtn = document.getElementById("soundBtn");
  var soundOn = true;
  try { if (localStorage.getItem("pendwave_sound") === "off") soundOn = false; } catch (e) {}
  function syncSound() {
    Audio2.setOn(soundOn);
    if (soundBtn) {
      soundBtn.setAttribute("aria-pressed", soundOn ? "true" : "false");
      soundBtn.textContent = soundOn ? "♪" : "♪̸";
    }
  }
  if (soundBtn) soundBtn.addEventListener("click", function () {
    soundOn = !soundOn;
    try { localStorage.setItem("pendwave_sound", soundOn ? "on" : "off"); } catch (e) {}
    Audio2.init(); syncSound();
  });

  window.addEventListener("resize", resize);
  window.addEventListener("orientationchange", function () { setTimeout(resize, 120); });

  resize();
  syncSound();
  updateHud();
  requestAnimationFrame(frame);

  window.__pw = {
    G: G, get pend() { return pend; },
    begin: begin, restart: restart, build: build, resize: resize,
    angleAt: angleAt, bobAt: bobAt,
    setCycle: function (c) { G.cycle = c; build(); resize(); restart(); },
    setCount: function (n) { G.count = n; build(); resize(); restart(); },
    advance: function (sec) {
      G.t += sec;
      for (var i = 0; i < pend.length; i++) pend[i].th = angleAt(pend[i], G.t);
    },
    consts: { GRAV: GRAV, BASE: BASE, AMP: AMP }
  };
})();
