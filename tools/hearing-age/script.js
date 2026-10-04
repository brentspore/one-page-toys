/* Hearing Age: a gentle beep climbs until you can't hear it, then we guess
 * the age of your ears. One Page Toys tool family.
 *
 * ⚠ The test path is a pure sine, nothing else: buffer -> its own fade gain ->
 *   one fixed output gain -> speakers. No compressor, no reverb, no filter.
 *   A click at a tone's start or end is broadband and audible at any pitch,
 *   so every edge is a raised-cosine ramp (60ms in the buffer, 60ms when you
 *   answer mid-beep). See logic.js for the signal and the step logic.
 * ⚠ Silent catch trials must LOOK exactly like real ones. The scope and the
 *   ladder draw the requested step, never whether sound is actually playing.
 */
(function () {
  "use strict";

  var L = window.HearingLogic;
  if (!L) return;

  var $ = function (id) { return document.getElementById(id); };
  var el = {
    rig: $("rig"), canvas: $("rigCanvas"),
    toneOut: $("toneOut"), levelOut: $("levelOut"), passOut: $("passOut"), led: $("led"),
    paneIntro: $("paneIntro"), paneCheck: $("paneCheck"), paneTest: $("paneTest"), paneResult: $("paneResult"),
    friendNote: $("friendNote"), friendHz: $("friendHz"), bestNote: $("bestNote"),
    startBtn: $("startBtn"), checkOk: $("checkOk"), checkBack: $("checkBack"),
    testK: $("testK"), testPrompt: $("testPrompt"), testMsg: $("testMsg"),
    yesBtn: $("yesBtn"), noBtn: $("noBtn"), stopBtn: $("stopBtn"),
    resHead: $("resHead"), resHz: $("resHz"), resAge: $("resAge"), resVs: $("resVs"),
    resMosq: $("resMosq"), resNote: $("resNote"), challengeBtn: $("challengeBtn"), againBtn: $("againBtn"),
    announce: $("announce")
  };

  var PAGE_URL = "https://onepagetoys.com/tools/hearing-age/";
  var MOSQUITO = 17400;
  var reduce = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : { matches: false };
  var coarse = window.matchMedia ? window.matchMedia("(pointer: coarse)").matches : false;

  function kHz(hz, digits) { return (hz / 1000).toFixed(digits === undefined ? 1 : digits); }
  function gtagSafe(name, params) {
    try { if (typeof window.gtag === "function") window.gtag("event", name, params || {}); } catch (e) {}
  }
  function store(k, v) { try { localStorage.setItem(k, String(v)); } catch (e) {} }
  function load(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }

  /* ------------------------------------------------------------ state */

  var S = {
    stage: "intro",          // intro | check | test | result
    test: null,
    result: null,
    acceptAt: 0,
    busy: false,
    timer: 0,
    best: null,
    friend: null,            // Hz from a challenge link
    lastPhase: null
  };

  var b = parseInt(load("hearingage_best"), 10);
  if (b >= 3000 && b <= 22000) S.best = b;

  (function readChallenge() {
    var m = /beat=(\d{4,5})/.exec(location.hash || "");
    if (!m) return;
    var hz = +m[1];
    if (hz < 3000 || hz > 22000) return;
    S.friend = Math.round(hz / 100) * 100;
    gtagSafe("challenge_open", { tool: "hearing-age", value: S.friend });
  })();

  /* ------------------------------------------------------------ audio */

  var AU = (function () {
    var ctx = null, out = null, cur = null, unlocked = false;
    var cache = [];   // [{ key, buf }], newest last, small
    var FALL = new Float32Array(96);
    for (var i = 0; i < FALL.length; i++) FALL[i] = 0.5 + 0.5 * Math.cos(Math.PI * i / (FALL.length - 1));
    var LEAD = 0.06;

    function ensure() {
      if (!ctx) {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        try { ctx = new AC(); } catch (e) { return null; }
        out = ctx.createGain();
        out.gain.value = 1;            // fixed. The level lives in the samples.
        out.connect(ctx.destination);
      }
      // Some phones mute web audio on silent; ask to play like a media player.
      try { if (navigator.audioSession && navigator.audioSession.type !== "playback") navigator.audioSession.type = "playback"; } catch (e) {}
      if (ctx.state !== "running" && ctx.resume) { try { ctx.resume().catch(function () {}); } catch (e) {} }
      if (!unlocked) {
        unlocked = true;
        try {
          var s = ctx.createBufferSource();
          s.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
          s.connect(ctx.destination);
          s.start(0);
        } catch (e) {}
      }
      return ctx;
    }

    function buffer(freq, amp) {
      var key = freq + ":" + amp;
      for (var i = 0; i < cache.length; i++) if (cache[i].key === key) return cache[i].buf;
      var sr = ctx.sampleRate;
      var buf = ctx.createBuffer(1, Math.round(L.CYCLE * sr), sr);
      var data = L.renderPulse(freq, sr, amp);
      if (buf.copyToChannel) buf.copyToChannel(data, 0); else buf.getChannelData(0).set(data);
      cache.push({ key: key, buf: buf });
      if (cache.length > 8) cache.shift();
      return buf;
    }

    // Seconds from now until the first beep is heard (for the visuals).
    function delay() {
      var lat = 0;
      if (ctx) lat = (ctx.outputLatency || 0) || (ctx.baseLatency || 0);
      return LEAD + Math.min(0.25, lat);
    }

    function play(freq, amp) {
      if (!ensure()) return delay();
      stop();
      var src = ctx.createBufferSource();
      src.buffer = buffer(freq, amp);
      src.loop = true;
      var g = ctx.createGain();
      g.gain.value = 1;
      src.connect(g);
      g.connect(out);
      src.start(ctx.currentTime + LEAD);
      cur = { src: src, g: g };
      return delay();
    }

    // A silent trial: nothing plays, the timing is identical.
    function silent() { ensure(); stop(); return delay(); }

    // Fade out over 60ms with a raised cosine, even mid-beep: no click.
    function stop() {
      if (!cur || !ctx) { cur = null; return; }
      var c = cur; cur = null;
      var now = ctx.currentTime;
      try {
        c.g.gain.cancelScheduledValues(now);
        c.g.gain.setValueCurveAtTime(FALL, now, 0.06);
      } catch (e) {
        try { c.g.gain.setValueAtTime(c.g.gain.value, now); c.g.gain.linearRampToValueAtTime(0, now + 0.06); } catch (e2) {}
      }
      try { c.src.stop(now + 0.09); } catch (e) {}
      setTimeout(function () { try { c.src.disconnect(); c.g.disconnect(); } catch (e) {} }, 400);
    }

    return {
      ensure: ensure, play: play, silent: silent, stop: stop, delay: delay,
      sampleRate: function () { return ctx ? ctx.sampleRate : 0; },
      ok: function () { return !!(window.AudioContext || window.webkitAudioContext); }
    };
  })();

  /* ------------------------------------------------------------ the rig */

  var AGE_MARKS = [
    [20000, "teen"], [19000, "18"], [18000, "22"], [17000, "26"], [16000, "31"],
    [15000, "40"], [14000, "45"], [13000, "50"], [12000, "55"], [10000, "65"], [8000, "75"]
  ];
  var MONO = '"JetBrains Mono", ui-monospace, Menlo, monospace';
  var DISP = '"Space Grotesk", system-ui, sans-serif';

  var R = {
    ctx: el.canvas.getContext("2d"),
    dpr: 1, w: 0, h: 0, g: null,
    under: null, over: null, phos: null, pctx: null,
    signal: null,            // { f, start (perf ms) }
    shown: null,             // eased ladder position (Hz)
    echoes: [],
    lastPulse: -1,
    rot: 0,
    resultHz: null, resultAt: 0,
    history: [],
    raf: 0, lastT: 0, dirty: true
  };

  function ringK(hz) { return Math.round(3 + 1.5 * hz / 1000); }

  function layout() {
    var w = Math.round(el.canvas.clientWidth || el.rig.clientWidth || 320);
    var h = Math.round(Math.max(280, Math.min(430, w * 0.8)));
    el.canvas.style.height = h + "px";
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    R.dpr = dpr; R.w = w; R.h = h;
    el.canvas.width = Math.round(w * dpr);
    el.canvas.height = Math.round(h * dpr);

    var pad = 10;
    var LW = Math.max(118, Math.min(200, w * 0.34));
    var areaW = w - LW - 6 - pad;
    var rad = Math.min(areaW, h - 2 * pad - 14) / 2 - 6;
    var g = {
      pad: pad,
      cx: pad + areaW / 2, cy: h / 2 - 2, R: rad,
      lx0: w - LW, lx1: w - pad,
      yTop: pad + 28, yBot: h - pad - 24
    };
    g.rail = g.lx0 + Math.round(LW * 0.36);
    g.small = w < 420;
    R.g = g;

    R.under = makeLayer(w, h, dpr);
    R.over = makeLayer(w, h, dpr);
    R.phos = makeLayer(w, h, dpr);
    paintUnder(R.under.getContext("2d"));
    paintOver(R.over.getContext("2d"));
    R.dirty = true;
    kick();
  }

  function makeLayer(w, h, dpr) {
    var c = document.createElement("canvas");
    c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
    c.getContext("2d").setTransform(dpr, 0, 0, dpr, 0, 0);
    return c;
  }

  function yFor(hz) {
    var g = R.g;
    if (hz < 8000) return g.yBot + 12;
    var u = (Math.min(20000, hz) - 8000) / 12000;
    return g.yBot - u * (g.yBot - g.yTop);
  }

  // The CRT: bezel, glass and graticule. Shared by the page and the share card.
  function drawScreen(x, cx, cy, rad, scale) {
    scale = scale || 1;
    var bez = x.createLinearGradient(cx - rad, cy - rad, cx + rad, cy + rad);
    bez.addColorStop(0, "#36443f"); bez.addColorStop(0.5, "#151d1a"); bez.addColorStop(1, "#0b100e");
    x.beginPath(); x.arc(cx, cy, rad + 9 * scale, 0, 6.2832); x.fillStyle = bez; x.fill();
    x.beginPath(); x.arc(cx, cy, rad + 2.5 * scale, 0, 6.2832); x.fillStyle = "#020504"; x.fill();
    var glass = x.createRadialGradient(cx, cy - rad * 0.1, rad * 0.05, cx, cy, rad);
    glass.addColorStop(0, "#0f2a22"); glass.addColorStop(0.7, "#06130f"); glass.addColorStop(1, "#020705");
    x.beginPath(); x.arc(cx, cy, rad, 0, 6.2832); x.fillStyle = glass; x.fill();

    x.save();
    x.beginPath(); x.arc(cx, cy, rad, 0, 6.2832); x.clip();
    x.lineWidth = 1 * scale;
    x.strokeStyle = "rgba(111,245,200,0.075)";
    [0.25, 0.5, 0.75].forEach(function (f) { x.beginPath(); x.arc(cx, cy, rad * f, 0, 6.2832); x.stroke(); });
    x.strokeStyle = "rgba(111,245,200,0.1)";
    x.beginPath();
    x.moveTo(cx - rad, cy); x.lineTo(cx + rad, cy);
    x.moveTo(cx, cy - rad); x.lineTo(cx, cy + rad);
    x.stroke();
    x.strokeStyle = "rgba(111,245,200,0.14)";
    x.beginPath();
    for (var i = -9; i <= 9; i++) {
      if (!i) continue;
      var d = rad * i / 10, t = (i % 5 === 0 ? 4 : 2.2) * scale;
      x.moveTo(cx + d, cy - t); x.lineTo(cx + d, cy + t);
      x.moveTo(cx - t, cy + d); x.lineTo(cx + t, cy + d);
    }
    x.stroke();
    // degree ticks round the rim
    x.strokeStyle = "rgba(111,245,200,0.16)";
    x.beginPath();
    for (var a = 0; a < 72; a++) {
      var th = a * Math.PI / 36, r0 = rad * (a % 6 === 0 ? 0.92 : 0.955);
      x.moveTo(cx + Math.cos(th) * r0, cy + Math.sin(th) * r0);
      x.lineTo(cx + Math.cos(th) * rad * 0.985, cy + Math.sin(th) * rad * 0.985);
    }
    x.stroke();
    x.restore();
  }

  function drawSheen(x, cx, cy, rad) {
    x.save();
    x.beginPath(); x.arc(cx, cy, rad, 0, 6.2832); x.clip();
    var s = x.createLinearGradient(cx - rad, cy - rad, cx + rad * 0.2, cy + rad * 0.2);
    s.addColorStop(0, "rgba(255,255,255,0.075)"); s.addColorStop(0.45, "rgba(255,255,255,0.02)"); s.addColorStop(0.46, "rgba(255,255,255,0)");
    x.fillStyle = s;
    x.beginPath(); x.ellipse(cx - rad * 0.18, cy - rad * 0.32, rad * 0.95, rad * 0.62, -0.5, 0, 6.2832); x.fill();
    var v = x.createRadialGradient(cx, cy, rad * 0.65, cx, cy, rad);
    v.addColorStop(0, "rgba(0,0,0,0)"); v.addColorStop(1, "rgba(0,0,0,0.45)");
    x.fillStyle = v; x.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
    x.restore();
  }

  function paintUnder(x) {
    var g = R.g;
    x.clearRect(0, 0, R.w, R.h);
    drawScreen(x, g.cx, g.cy, g.R, 1);

    // The ladder: rail, ticks, kHz on the left, ages on the right.
    x.fillStyle = "rgba(0,0,0,0.5)";
    roundRect(x, g.rail - 4, g.yTop - 4, 8, g.yBot - g.yTop + 8, 4); x.fill();
    x.strokeStyle = "rgba(111,245,200,0.12)"; x.lineWidth = 1;
    roundRect(x, g.rail - 4.5, g.yTop - 4.5, 9, g.yBot - g.yTop + 9, 4.5); x.stroke();

    x.textBaseline = "middle";
    var fs = g.small ? 10 : 11;
    for (var k = 8; k <= 20; k++) {
      var y = yFor(k * 1000), major = k % 2 === 0;
      x.strokeStyle = major ? "rgba(111,245,200,0.4)" : "rgba(111,245,200,0.2)";
      x.beginPath(); x.moveTo(g.rail + 7, y); x.lineTo(g.rail + 7 + (major ? 8 : 4), y); x.stroke();
      if (major) {
        x.font = "600 " + fs + "px " + MONO;
        x.textAlign = "right";
        x.fillStyle = "rgba(200,245,228,0.6)";
        x.fillText(String(k), g.rail - 14, y);
      }
    }
    // ages
    x.font = "600 " + (fs - 0.5) + "px " + MONO;
    x.textAlign = "left";
    AGE_MARKS.forEach(function (m) {
      var y = yFor(m[0]);
      x.fillStyle = "rgba(255,214,150,0.55)";
      x.fillText(m[1], g.rail + 21, y);
    });
    // headers
    x.font = "700 " + (fs - 1) + "px " + MONO;
    x.fillStyle = "rgba(200,245,228,0.38)";
    x.textAlign = "right"; x.fillText("kHz", g.rail - 14, g.yTop - 18);
    x.textAlign = "left"; x.fillStyle = "rgba(255,214,150,0.42)"; x.fillText("AGE", g.rail + 21, g.yTop - 18);

    // the mosquito tone, 17.4 kHz
    var my = yFor(MOSQUITO);
    x.save();
    x.setLineDash([2, 3]);
    x.strokeStyle = "rgba(255,140,170,0.45)";
    x.beginPath(); x.moveTo(g.rail - 26, my); x.lineTo(g.rail + 15, my); x.stroke();
    x.restore();
    drawMosquito(x, g.rail - 33, my, g.small ? 0.85 : 1);
  }

  function drawMosquito(x, mx, my, s) {
    x.save();
    x.translate(mx, my); x.scale(s, s);
    x.strokeStyle = "rgba(255,150,178,0.8)"; x.fillStyle = "rgba(255,150,178,0.85)";
    x.lineWidth = 1; x.lineCap = "round";
    x.beginPath(); x.ellipse(0, 0, 4.2, 1.3, 0, 0, 6.2832); x.fill();          // body
    x.beginPath(); x.arc(-5, 0, 1.3, 0, 6.2832); x.fill();                      // head
    x.beginPath(); x.moveTo(-6, 0); x.lineTo(-9.5, 0.6); x.stroke();          // proboscis
    x.globalAlpha = 0.6;
    x.beginPath(); x.ellipse(-0.5, -3.2, 3.2, 1.4, -0.5, 0, 6.2832); x.stroke(); // wings
    x.beginPath(); x.ellipse(1.5, -2.8, 3, 1.3, -0.2, 0, 6.2832); x.stroke();
    x.globalAlpha = 1;
    x.beginPath();
    x.moveTo(-2, 1); x.lineTo(-4, 4); x.moveTo(0, 1); x.lineTo(0.5, 4.5); x.moveTo(2, 1); x.lineTo(4, 4); // legs
    x.stroke();
    x.restore();
  }

  function paintOver(x) {
    var g = R.g;
    x.clearRect(0, 0, R.w, R.h);
    drawSheen(x, g.cx, g.cy, g.R);
  }

  function roundRect(x, X, Y, W, H, r) {
    x.beginPath();
    x.moveTo(X + r, Y); x.lineTo(X + W - r, Y); x.quadraticCurveTo(X + W, Y, X + W, Y + r);
    x.lineTo(X + W, Y + H - r); x.quadraticCurveTo(X + W, Y + H, X + W - r, Y + H);
    x.lineTo(X + r, Y + H); x.quadraticCurveTo(X, Y + H, X, Y + H - r);
    x.lineTo(X, Y + r); x.quadraticCurveTo(X, Y, X + r, Y);
    x.closePath();
  }

  // The trace: a sine wrapped round the screen. More cycles as the pitch climbs.
  function traceRing(x, cx, cy, rb, amp, k, rot, passes) {
    var N = Math.max(240, k * 26);
    x.beginPath();
    for (var i = 0; i <= N; i++) {
      var th = (i / N) * 6.2832;
      var r = rb + amp * Math.sin(k * th + rot);
      var px = cx + Math.cos(th) * r, py = cy + Math.sin(th) * r;
      if (i) x.lineTo(px, py); else x.moveTo(px, py);
    }
    x.closePath();
    for (var p = 0; p < passes.length; p++) {
      x.strokeStyle = passes[p][0]; x.lineWidth = passes[p][1];
      x.stroke();
    }
  }

  function envNow(now) {
    if (!R.signal) return { env: 0, idx: -1 };
    var t = (now - R.signal.start) / 1000;
    return { env: L.pulseEnv(t), idx: L.pulseIndex(t), t: t };
  }

  function frame(now) {
    R.raf = 0;
    if (!R.g) return;
    // Idle (nothing playing, nothing settling): breathe at ~30fps, not 60.
    var idle = !R.signal && !R.echoes.length && S.stage !== "result" && R.shown === null;
    if (idle && R.lastT && now - R.lastT < 30 && !reduce.matches) { R.raf = requestAnimationFrame(frame); return; }
    var dt = R.lastT ? Math.min(0.1, (now - R.lastT) / 1000) : 0.016;
    R.lastT = now;
    var still = reduce.matches;
    var g = R.g, x = R.ctx, P = R.phos.getContext("2d");
    var e = envNow(now);

    // pulse onsets spawn an echo ring
    if (e.idx !== -1 && e.idx !== R.lastPulse && !still) R.echoes.push({ t: now, f: R.signal.f });
    R.lastPulse = e.idx;

    // phosphor: fade the last frames, then draw this one on top
    if (still) {
      P.clearRect(0, 0, R.w, R.h);
    } else {
      P.globalCompositeOperation = "destination-out";
      P.fillStyle = "rgba(0,0,0," + (1 - Math.pow(0.0015, dt)).toFixed(3) + ")";
      P.fillRect(0, 0, R.w, R.h);
      R.rot += dt * 0.35;
    }
    P.globalCompositeOperation = "lighter";
    var f = R.signal ? R.signal.f : (S.stage === "result" && R.resultHz ? R.resultHz : null);
    var rb = g.R * 0.56, amp, k, bright;
    if (f) {
      k = ringK(f);
      var en = R.signal ? e.env : 1;
      if (still) { amp = g.R * 0.085; bright = R.signal ? 0.45 + 0.55 * en : 0.9; }
      else { amp = g.R * (0.02 + 0.07 * en); bright = 0.55 + 0.45 * en; rb *= 1 + 0.03 * en; }
    } else {
      k = 0; amp = 0;
      bright = 0.5;
      if (!still) rb *= 1 + 0.012 * Math.sin(now / 900);
    }
    // the phosphor layer only keeps a faint afterglow; the live trace is drawn on top
    if (!still) traceRing(P, g.cx, g.cy, rb, amp, k || 1, R.rot, [["rgba(90,245,200," + (0.16 * bright).toFixed(3) + ")", 2]]);

    // compose
    x.setTransform(R.dpr, 0, 0, R.dpr, 0, 0);
    x.clearRect(0, 0, R.w, R.h);
    x.drawImage(R.under, 0, 0, R.w, R.h);
    x.save();
    x.beginPath(); x.arc(g.cx, g.cy, g.R, 0, 6.2832); x.clip();
    x.globalCompositeOperation = "lighter";
    x.drawImage(R.phos, 0, 0, R.w, R.h);
    traceRing(x, g.cx, g.cy, rb, amp, k || 1, still ? 0 : R.rot, [
      ["rgba(80,240,190," + (0.06 * bright).toFixed(3) + ")", 10],
      ["rgba(90,245,200," + (0.17 * bright).toFixed(3) + ")", 4],
      ["rgba(214,255,240," + (0.92 * bright).toFixed(3) + ")", 1.3]
    ]);
    // echo rings, carrying the waveform outward
    for (var i = R.echoes.length - 1; i >= 0; i--) {
      var ec = R.echoes[i], a = (now - ec.t) / 1100;
      if (a >= 1) { R.echoes.splice(i, 1); continue; }
      var ease = 1 - Math.pow(1 - a, 3);
      var rr = g.R * 0.58 + (g.R * 0.99 - g.R * 0.58) * ease;
      traceRing(x, g.cx, g.cy, rr, g.R * 0.04 * (1 - a), ringK(ec.f), R.rot, [
        ["rgba(111,245,200," + (0.4 * (1 - a) * (1 - a)).toFixed(3) + ")", 1.2]
      ]);
    }
    x.restore();
    x.globalCompositeOperation = "source-over";
    x.drawImage(R.over, 0, 0, R.w, R.h);

    drawLadderLive(x, now, dt, e, still);
    drawHud(x);

    var anim = !!R.signal || R.echoes.length || (R.shown !== null && Math.abs(R.shown - ladderTarget()) > 5) ||
      (!still) || (S.stage === "result" && now - R.resultAt < 1600);
    if (anim && !document.hidden) R.raf = requestAnimationFrame(frame);
  }

  function ladderTarget() {
    if (R.signal) return R.signal.f;
    if (S.stage === "result" && R.resultHz) return R.resultHz;
    if (S.stage === "test" && S.test) return S.test.f;
    return null;
  }

  function drawLadderLive(x, now, dt, e, still) {
    var g = R.g;
    var target = ladderTarget();
    if (target === null) { R.shown = null; }
    else if (R.shown === null || still) R.shown = target;
    else R.shown += (target - R.shown) * (1 - Math.pow(0.0008, dt));

    // fill
    if (R.shown !== null && R.shown >= 8000) {
      var yv = yFor(R.shown);
      var grad = x.createLinearGradient(0, g.yBot, 0, yv);
      grad.addColorStop(0, "rgba(111,245,200,0.35)"); grad.addColorStop(1, "rgba(150,255,220,0.95)");
      x.fillStyle = "rgba(111,245,200,0.12)";
      roundRect(x, g.rail - 7, yv - 3, 14, g.yBot - yv + 6, 6); x.fill();
      x.fillStyle = grad;
      roundRect(x, g.rail - 2.5, yv, 5, g.yBot - yv, 2.5); x.fill();
    }

    // where you've been: dots for heard, rings for gone
    R.history.forEach(function (h) {
      if (h.isCatch) return;
      var y = yFor(h.f), fine = h.phase === "confirm" || h.phase === "confirmDown";
      if (h.heard) {
        x.fillStyle = "#06100d";
        x.beginPath(); x.arc(g.rail, y, fine ? 2.4 : 3.1, 0, 6.2832); x.fill();
        x.fillStyle = "rgba(225,255,244,0.95)";
        x.beginPath(); x.arc(g.rail, y, fine ? 1.4 : 2, 0, 6.2832); x.fill();
      } else {
        x.strokeStyle = "rgba(255,191,90,0.95)"; x.lineWidth = 1.5;
        x.beginPath(); x.arc(g.rail, y, fine ? 3.2 : 4, 0, 6.2832); x.stroke();
      }
    });

    // a friend's mark from a challenge link, and your best
    if (S.friend) flagMark(x, S.friend, "rgba(201,162,255,0.95)", g.small ? "" : "friend", now);
    if (S.best && S.stage !== "result") flagMark(x, S.best, "rgba(200,245,228,0.45)", g.small ? "" : "best", now);

    // the current step: a needle that glows with each beep
    if (R.signal || (S.stage === "test" && S.test)) {
      var f = R.signal ? R.signal.f : S.test.f;
      var y = yFor(R.shown !== null && !still ? R.shown : f);
      var glow = R.signal ? e.env : 0;
      x.fillStyle = "rgba(111,245,200," + (0.16 + 0.34 * glow).toFixed(3) + ")";
      x.beginPath(); x.arc(g.rail, y, 6 + 3 * glow, 0, 6.2832); x.fill();
      x.fillStyle = "#e9fff6";
      x.beginPath(); x.arc(g.rail, y, 3, 0, 6.2832); x.fill();
      x.strokeStyle = "rgba(233,255,246,0.9)"; x.lineWidth = 1.5;
      x.beginPath(); x.moveTo(g.rail + 4, y); x.lineTo(g.rail + 17, y); x.stroke();
      if (f < 8000) {
        x.font = "600 10px " + MONO; x.textAlign = "right"; x.fillStyle = "rgba(233,255,246,0.8)";
        x.fillText(kHz(f), g.rail - 12, y);
      }
    }

    // the result: an amber flag where you stopped
    if (S.stage === "result" && R.resultHz) {
      var ry = yFor(R.shown !== null ? R.shown : R.resultHz);
      var t = Math.min(1, (now - R.resultAt) / 900);
      if (still) t = 1;
      x.globalAlpha = t;
      x.strokeStyle = "rgba(255,191,90,0.95)"; x.lineWidth = 2;
      x.beginPath(); x.moveTo(g.rail - 8, ry); x.lineTo(g.rail + 19, ry); x.stroke();
      x.font = "700 11px " + MONO;
      x.textBaseline = "middle"; x.textAlign = "center";
      // kHz on the left of the rail, the age on the right, both in amber
      var label = kHz(R.resultHz), words = L.ageWords(R.resultHz);
      var tw = x.measureText(label).width + 10;
      x.fillStyle = "#ffbf5a";
      roundRect(x, g.rail - 8 - tw, ry - 9, tw, 18, 9); x.fill();
      x.fillStyle = "#1a1203";
      x.fillText(label, g.rail - 8 - tw / 2, ry + 0.5);
      var age = words ? (words.age >= 70 && R.resultHz < 9000 ? "70+" : words.short) : "";
      var aw = x.measureText(age).width + 12;
      x.fillStyle = "#ffbf5a";
      roundRect(x, g.rail + 17, ry - 9, aw, 18, 9); x.fill();
      x.fillStyle = "#1a1203";
      x.fillText(age, g.rail + 17 + aw / 2, ry + 0.5);
      x.globalAlpha = 1;
    }
  }

  function flagMark(x, hz, color, text, now) {
    var g = R.g, y = yFor(hz);
    x.fillStyle = color;
    x.beginPath(); x.moveTo(g.lx1, y - 4.5); x.lineTo(g.lx1 - 7, y); x.lineTo(g.lx1, y + 4.5); x.closePath(); x.fill();
    // a short mark through the tick zone, so it never strikes through an age
    x.strokeStyle = color; x.lineWidth = 2;
    x.beginPath(); x.moveTo(g.rail + 5, y); x.lineTo(g.rail + 17, y); x.stroke();
    if (text) {
      x.font = "600 9px " + MONO; x.textAlign = "right"; x.textBaseline = "bottom"; x.fillStyle = color;
      x.fillText(text, g.lx1 - 2, y - 5);
      x.textBaseline = "middle";
    }
  }

  function drawHud(x) {
    var g = R.g;
    x.font = "600 9px " + MONO;
    x.textBaseline = "middle"; x.textAlign = "left";
    x.fillStyle = "rgba(190,235,218,0.4)";
    x.fillText("CH1 · SINE · PULSED", g.pad + 6, g.pad + 6);
    var sr = AU.sampleRate();
    x.fillText(sr ? "SR " + kHz(sr) + "k" : "SR --", g.pad + 6, R.h - g.pad - 4);
  }

  function kick() {
    if (!R.raf && R.g) { R.lastT = 0; R.raf = requestAnimationFrame(frame); }
  }

  function setSignal(f, delaySec) {
    R.signal = { f: f, start: performance.now() + delaySec * 1000 };
    R.lastPulse = -1;
    kick();
  }
  function clearSignal() { R.signal = null; kick(); }

  /* ------------------------------------------------------------ flow */

  function show(pane) {
    [el.paneIntro, el.paneCheck, el.paneTest, el.paneResult].forEach(function (p) { p.hidden = p !== pane; });
  }

  function deck(tone, level, pass) {
    if (tone !== undefined) el.toneOut.textContent = tone;
    if (level !== undefined) el.levelOut.textContent = level;
    if (pass !== undefined) el.passOut.textContent = pass;
  }

  function renderIntro() {
    if (S.friend) {
      el.friendHz.textContent = kHz(S.friend) + " kHz";
      el.friendNote.hidden = false;
    }
    if (S.best) {
      var w = L.ageWords(S.best);
      el.bestNote.innerHTML = "Your best so far: <b>" + kHz(S.best) + " kHz</b>" + (w ? " · " + w.text.toLowerCase() : "");
      el.bestNote.hidden = false;
    } else el.bestNote.hidden = true;
  }

  function goIntro() {
    clearTimeout(S.timer);
    AU.stop(); clearSignal();
    S.stage = "intro"; S.test = null; S.busy = false;
    document.body.classList.remove("is-testing");
    el.led.classList.remove("is-on");
    deck("Standby", "−20 dBFS", "Ready");
    R.history = [];
    renderIntro();
    show(el.paneIntro);
    kick();
  }

  function goCheck() {
    clearTimeout(S.timer);
    S.stage = "check";
    if (!AU.ok()) {
      show(el.paneCheck);
      el.paneCheck.querySelector(".pane__big").textContent = "This browser can't play the test tones.";
      el.checkOk.disabled = true;
      return;
    }
    var d = AU.play(1000, L.CHECK_AMP);
    setSignal(1000, d);
    el.led.classList.add("is-on");
    deck("1.0 kHz", "−30 dBFS", "Check");
    R.history = [];
    show(el.paneCheck);
    try { el.checkOk.focus({ preventScroll: true }); } catch (e) {}
    gtagSafe("hearing_check", { tool: "hearing-age" });
  }

  function startTest() {
    clearTimeout(S.timer);
    AU.stop(); clearSignal();
    S.test = new L.Test({ cap: L.capFor(AU.sampleRate() || 48000) });
    S.stage = "test"; S.result = null; S.busy = true; S.lastPhase = "coarse";
    window.OPT_SHARE_IMAGE = null; window.OPT_SHARE_LINE = null; window.OPT_SHARE_TEXT = null;
    document.body.classList.add("is-testing");
    deck(kHz(S.test.f) + " kHz", "−20 dBFS", "Climb");
    el.testK.textContent = "Step 2 of 2 · The climb";
    el.testPrompt.textContent = "Can you hear the beeps?";
    setMsg("Answer when you're sure. There's no clock.", "");
    R.history = [];
    show(el.paneTest);
    setAnswers(false);
    try { el.yesBtn.focus({ preventScroll: true }); } catch (e) {}
    keepInView();
    gtagSafe("hearing_start", { tool: "hearing-age", sample_rate: AU.sampleRate() });
    S.timer = setTimeout(present, 500);
  }

  // On a phone the answer buttons must be on screen without scrolling.
  function keepInView() {
    var r = el.paneTest.getBoundingClientRect();
    if (r.bottom > window.innerHeight - 8) {
      try { el.paneTest.scrollIntoView({ block: "end", behavior: reduce.matches ? "auto" : "smooth" }); } catch (e) {}
    }
  }

  function passLabel(phase) {
    if (phase === "coarse") return "Climb";
    if (phase === "down") return "Lower";
    return "Confirm";
  }

  function present() {
    if (S.stage !== "test" || !S.test) return;
    var c = S.test.current();
    if (c.done) { finish(); return; }
    var d = c.isCatch ? AU.silent() : AU.play(c.f, L.TEST_AMP);
    setSignal(c.f, d);
    deck(kHz(c.f) + " kHz", undefined, passLabel(c.phase));
    S.acceptAt = performance.now() + 280;
    S.busy = false;
    setAnswers(true);
  }

  // aria-disabled, not disabled: a disabled button drops keyboard focus, and
  // Space/Enter would stop working between steps.
  function setAnswers(on) {
    [el.yesBtn, el.noBtn].forEach(function (b) {
      b.setAttribute("aria-disabled", on ? "false" : "true");
      b.classList.toggle("is-off", !on);
    });
  }

  function setMsg(text, kind) {
    el.testMsg.textContent = text;
    el.testMsg.className = "pane__msg" + (kind ? " is-" + kind : "");
  }

  var FA_LINES = [
    "Gotcha! That one was silence. Here's the real beep.",
    "Sneaky check: nothing was playing that time. Let's run that step again.",
    "Ha, that was a silent one. Ears love to fill in gaps. Again, for real."
  ];
  var CR_LINES = [
    "Good ears: that one was silent on purpose. Here's the real one.",
    "Right, nothing was playing. Just checking. Here's the real beep."
  ];
  var faN = 0, crN = 0;

  function hit(btn) {
    btn.classList.remove("is-hit");
    void btn.offsetWidth;
    btn.classList.add("is-hit");
    try { if (navigator.vibrate && coarse) navigator.vibrate(8); } catch (e) {}
  }

  function answer(heard) {
    if (S.stage !== "test" || S.busy || !S.test) return;
    if (performance.now() < S.acceptAt) return;
    S.busy = true;
    setAnswers(false);
    hit(heard ? el.yesBtn : el.noBtn);
    AU.stop(); clearSignal();
    var before = S.test.phase;
    var r = S.test.answer(heard);
    R.history = S.test.history.slice();
    kick();
    var wait = 520;
    if (r.type === "false-alarm") { setMsg(FA_LINES[faN++ % FA_LINES.length], "catch"); wait = 1300; }
    else if (r.type === "correct-reject") { setMsg(CR_LINES[crN++ % CR_LINES.length], "good"); wait = 1300; }
    else if (r.type === "done") { S.timer = setTimeout(finish, 420); return; }
    else {
      var now = S.test.phase;
      if (now !== before && (now === "confirm" || now === "down" || now === "confirmDown")) {
        if (now === "confirm") {
          setMsg("Found the edge. Now a finer pass, starting a little lower.", "good");
          el.testK.textContent = "Step 2 of 2 · Fine check";
        } else if (now === "down") {
          setMsg("No beeps at 8 kHz? Let's try lower.", "");
        } else {
          setMsg("Lost it already? Stepping down to find it again.", "");
        }
        wait = 1100;
      } else if (el.testMsg.textContent && el.testMsg.className.indexOf("is-") !== -1) {
        setMsg("", "");
      }
    }
    S.timer = setTimeout(present, wait);
  }

  function finish() {
    if (!S.test) return;
    clearTimeout(S.timer);
    AU.stop(); clearSignal();
    var res = S.test.result || { hz: null };
    S.result = res;
    S.stage = "result";
    document.body.classList.remove("is-testing");
    el.led.classList.remove("is-on");
    R.history = S.test.history.slice();

    if (res.hz === null) {
      deck("None heard", "−20 dBFS", "Done");
      el.resHz.textContent = "";
      el.resHead.firstChild.textContent = "We couldn't find a beep you heard.";
      el.resAge.textContent = "";
      el.resAge.hidden = true;
      el.resVs.hidden = true;
      el.resMosq.textContent = "Check that your sound is on and turned up a little, then try again. On a phone, make sure it isn't on silent.";
      el.resNote.textContent = "If everyday sounds seem muffled too, an audiologist can check your hearing properly.";
      el.challengeBtn.hidden = true;
      R.resultHz = null;
      window.OPT_SHARE_IMAGE = null; window.OPT_SHARE_LINE = null; window.OPT_SHARE_TEXT = null;
      show(el.paneResult);
      announce("No result. We couldn't find a beep you heard.");
      gtagSafe("hearing_result", { tool: "hearing-age", value: 0 });
      return;
    }

    var hz = res.hz, words = L.ageWords(hz);
    var newBest = !S.best || hz > S.best;
    if (newBest) { S.best = hz; store("hearingage_best", hz); }

    deck(kHz(hz) + " kHz", "−20 dBFS", "Done");
    el.resHead.firstChild.textContent = res.atCap ? "You heard all the way up to " : "You can hear up to ";
    el.resAge.hidden = false;
    el.resAge.textContent = words.text;
    el.resAge.classList.remove("is-in"); void el.resAge.offsetWidth;
    el.challengeBtn.hidden = false;

    // the mosquito line
    el.resMosq.textContent = hz >= MOSQUITO
      ? "You can still hear the mosquito tone at 17.4 kHz, the buzz some shops play to shoo teenagers away. Sorry about that."
      : "The mosquito tone at 17.4 kHz, the buzz some shops play to shoo teenagers away, is past your top. Enjoy the quiet.";

    // honest framing, plus what might be going on
    var note = "That's the typical top for ears that age. Headphones, speakers and volume all nudge it, so treat it as a party trick, not a checkup.";
    if (res.atCap) note = "That's as high as this test goes, and as high as most speakers can play. " + note;
    else if (hz < 8000) note = "That's below where this test usually starts. Try a touch more volume or another pair of headphones. If everyday sounds seem muffled too, an audiologist can check properly.";
    else if (hz >= 14500 && hz <= 16600) note += " Stopped near 16 kHz? Lots of earbuds and laptop speakers do too. Try wired headphones before you blame your ears.";
    if (res.falseAlarms >= 2) note += " You also heard a couple of beeps that weren't there, so take this one with a pinch of salt.";
    else if (res.falseAlarms === 1) note += " One silent beep fooled you. It happens to everyone.";
    if (!newBest && S.best > hz) note += " Your best is still " + kHz(S.best) + " kHz.";
    el.resNote.textContent = note;

    // the challenge outcome
    if (S.friend) {
      var diff = hz - S.friend;
      el.resVs.hidden = false;
      el.resVs.classList.toggle("is-win", diff > 0);
      if (diff > 0) {
        el.resVs.textContent = "You beat your friend by " + kHz(diff) + " kHz. Send it back to them.";
        gtagSafe("challenge_beaten", { tool: "hearing-age", value: hz });
      } else if (diff === 0) {
        el.resVs.textContent = "Dead even with your friend at " + kHz(hz) + " kHz.";
      } else {
        el.resVs.textContent = "Your friend wins by " + kHz(-diff) + " kHz. Younger ears, or better headphones?";
      }
    } else el.resVs.hidden = true;

    // sharing
    var head = res.atCap ? "I can hear all the way to " + kHz(hz) + " kHz." : "I can hear up to " + kHz(hz) + " kHz.";
    window.OPT_SHARE_TEXT = head + " " + words.text + ". How high can you go? " + challengeUrl();
    window.OPT_SHARE_LINE = "Can you hear higher than " + kHz(hz) + " kHz?";
    window.OPT_SHARE_IMAGE = shareCard;

    show(el.paneResult);
    R.resultHz = hz; R.resultAt = performance.now();
    countUp(hz);
    try { el.resHead.focus({ preventScroll: true }); } catch (e) {}
    announce("Result: you can hear up to " + kHz(hz) + " kilohertz. " + words.text + ".");
    gtagSafe("hearing_result", { tool: "hearing-age", value: hz, age: words.age, false_alarms: res.falseAlarms });
    kick();
  }

  // The number rolls up the ladder with the fill, then the age lands.
  function countUp(hz) {
    var from = Math.min(hz, 8000), t0 = performance.now(), dur = 900;
    if (reduce.matches) { el.resHz.textContent = kHz(hz) + " kHz"; el.resAge.classList.add("is-in"); return; }
    el.resAge.style.opacity = "0";
    (function tick() {
      var u = Math.min(1, (performance.now() - t0) / dur);
      var e = 1 - Math.pow(1 - u, 3);
      el.resHz.textContent = kHz(from + (hz - from) * e) + " kHz";
      if (u < 1) requestAnimationFrame(tick);
      else { el.resHz.textContent = kHz(hz) + " kHz"; el.resAge.style.opacity = ""; el.resAge.classList.add("is-in"); }
    })();
    // headless and background tabs throttle rAF: make sure it lands
    setTimeout(function () { el.resHz.textContent = kHz(hz) + " kHz"; el.resAge.style.opacity = ""; el.resAge.classList.add("is-in"); }, dur + 400);
  }

  function announce(text) { el.announce.textContent = ""; setTimeout(function () { el.announce.textContent = text; }, 60); }

  function challengeUrl() { return PAGE_URL + "#beat=" + (S.result && S.result.hz ? S.result.hz : 0); }

  /* ------------------------------------------------------------ share card */

  function shareCard() {
    var res = S.result;
    if (!res || !res.hz) return null;
    var hz = res.hz, words = L.ageWords(hz);
    var W = 1400, H = 788;
    var c = document.createElement("canvas");
    c.width = W; c.height = H;
    var x = c.getContext("2d");

    var bg = x.createLinearGradient(0, 0, W * 0.4, H);
    bg.addColorStop(0, "#17211e"); bg.addColorStop(1, "#060a09");
    x.fillStyle = bg; x.fillRect(0, 0, W, H);
    var glow = x.createRadialGradient(370, 330, 40, 370, 330, 520);
    glow.addColorStop(0, "rgba(111,245,200,0.14)"); glow.addColorStop(1, "rgba(111,245,200,0)");
    x.fillStyle = glow; x.fillRect(0, 0, W, H);

    // the scope, frozen mid-beep
    var cx = 360, cy = 330, rad = 236, k = ringK(hz);
    drawScreen(x, cx, cy, rad, 2);
    x.save();
    x.beginPath(); x.arc(cx, cy, rad, 0, 6.2832); x.clip();
    x.globalCompositeOperation = "lighter";
    [0.99, 0.86].forEach(function (rr, i) {
      traceRing(x, cx, cy, rad * rr, rad * 0.03, k, 0.6, [["rgba(111,245,200," + (0.18 - i * 0.06) + ")", 2]]);
    });
    traceRing(x, cx, cy, rad * 0.58, rad * 0.11, k, 0.6, [
      ["rgba(80,240,190,0.09)", 22], ["rgba(90,245,200,0.28)", 8], ["rgba(205,255,236,0.95)", 2.6]
    ]);
    x.restore();
    drawSheen(x, cx, cy, rad);

    // the words
    var tx = 690;
    x.textBaseline = "alphabetic"; x.textAlign = "left";
    x.font = "700 24px " + MONO;
    x.fillStyle = "rgba(190,235,218,0.6)";
    try { x.letterSpacing = "4px"; } catch (e) {}
    x.fillText("HOW HIGH CAN YOU HEAR?", tx, 150);
    try { x.letterSpacing = "0px"; } catch (e) {}
    x.font = "700 132px " + MONO;
    x.fillStyle = "#8affd6";
    x.shadowColor = "rgba(111,245,200,0.55)"; x.shadowBlur = 36;
    var num = kHz(hz);
    x.fillText(num, tx - 6, 300);
    var nw = x.measureText(num).width;
    x.shadowBlur = 0;
    x.font = "700 52px " + MONO;
    x.fillStyle = "rgba(138,255,214,0.75)";
    x.fillText("kHz", tx + nw + 6, 300);
    var fsz = 60;
    x.font = "700 " + fsz + "px " + DISP;
    while (fsz > 36 && x.measureText(words.text).width > 1220 - tx) { fsz -= 2; x.font = "700 " + fsz + "px " + DISP; }
    x.fillStyle = "#ffffff";
    x.fillText(words.text, tx, 390);
    x.font = "500 26px " + MONO;
    x.fillStyle = "rgba(255,214,150,0.75)";
    x.fillText(hz >= MOSQUITO ? "Still hears the mosquito tone" : "Safe from the mosquito tone", tx, 446);

    // the ladder
    var lx = 1300, y0 = 560, y1 = 96;
    var yF = function (f) { return y0 - (Math.max(8000, Math.min(20000, f)) - 8000) / 12000 * (y0 - y1); };
    x.fillStyle = "rgba(0,0,0,0.5)"; roundRect(x, lx - 7, y1 - 6, 14, y0 - y1 + 12, 7); x.fill();
    var fy = yF(hz);
    var gr = x.createLinearGradient(0, y0, 0, fy);
    gr.addColorStop(0, "rgba(111,245,200,0.4)"); gr.addColorStop(1, "rgba(160,255,224,1)");
    x.fillStyle = gr; roundRect(x, lx - 4, fy, 8, y0 - fy, 4); x.fill();
    x.font = "600 18px " + MONO; x.textAlign = "right"; x.textBaseline = "middle";
    for (var kk = 8; kk <= 20; kk += 2) {
      var yy = yF(kk * 1000);
      x.strokeStyle = "rgba(111,245,200,0.4)"; x.lineWidth = 2;
      x.beginPath(); x.moveTo(lx + 12, yy); x.lineTo(lx + 24, yy); x.stroke();
      x.fillStyle = "rgba(200,245,228,0.55)";
      x.fillText(String(kk), lx - 18, yy);
    }
    x.strokeStyle = "#ffbf5a"; x.lineWidth = 3;
    x.beginPath(); x.moveTo(lx - 12, fy); x.lineTo(lx + 40, fy); x.stroke();
    x.fillStyle = "#ffbf5a";
    x.beginPath(); x.moveTo(lx + 40, fy - 10); x.lineTo(lx + 56, fy); x.lineTo(lx + 40, fy + 10); x.closePath(); x.fill();
    return c;
  }

  /* ------------------------------------------------------------ challenge link */

  el.challengeBtn.addEventListener("click", function () {
    if (!S.result || !S.result.hz) return;
    var url = challengeUrl();
    var text = "I can hear up to " + kHz(S.result.hz) + " kHz. Can you hear higher?";
    gtagSafe("share", { method: "challenge_link", content_type: "tool", item_id: "/tools/hearing-age/" });
    if (navigator.share && coarse) {
      navigator.share({ title: "Hearing Age Test", text: text, url: url }).catch(function () {});
      return;
    }
    var done = function () {
      el.challengeBtn.textContent = "Challenge link copied";
      setTimeout(function () { el.challengeBtn.textContent = "Challenge a friend"; }, 1800);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text + " " + url).then(done, function () { window.prompt("Copy this link:", url); });
    } else window.prompt("Copy this link:", url);
  });

  /* ------------------------------------------------------------ wiring */

  el.startBtn.addEventListener("click", goCheck);
  el.checkBack.addEventListener("click", goIntro);
  el.checkOk.addEventListener("click", startTest);
  el.yesBtn.addEventListener("click", function () { answer(true); });
  el.noBtn.addEventListener("click", function () { answer(false); });
  el.stopBtn.addEventListener("click", goIntro);
  el.againBtn.addEventListener("click", function () { goCheck(); });

  window.addEventListener("keydown", function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (S.stage !== "test") return;
    var k = e.key;
    if (k === "h" || k === "H" || k === "y" || k === "Y" || k === "ArrowUp") { e.preventDefault(); answer(true); }
    else if (k === "g" || k === "G" || k === "n" || k === "N" || k === "ArrowDown") { e.preventDefault(); answer(false); }
    else if (k === "Escape") { e.preventDefault(); goIntro(); }
  });

  // A hidden tab stops the beeps; coming back replays the same step.
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
      if (S.stage === "check" || S.stage === "test") { clearTimeout(S.timer); AU.stop(); clearSignal(); setAnswers(false); }
    } else {
      if (S.stage === "check") { var d = AU.play(1000, L.CHECK_AMP); setSignal(1000, d); }
      else if (S.stage === "test") { S.timer = setTimeout(present, 400); }
      kick();
    }
  });

  var ro = window.ResizeObserver ? new ResizeObserver(function () {
    var w = Math.round(el.canvas.clientWidth);
    if (w && w !== R.w) layout();
  }) : null;
  if (ro) ro.observe(el.canvas); else window.addEventListener("resize", layout);
  if (reduce.addEventListener) reduce.addEventListener("change", kick);

  layout();
  renderIntro();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { layout(); });

  // Automation only: read-only state for headless tests. Real visitors never get this.
  if (navigator.webdriver) {
    window.__hearingAge = {
      state: function () {
        var c = S.test ? S.test.current() : null;
        return {
          stage: S.stage, f: c && c.f, isCatch: c && c.isCatch, phase: c && c.phase,
          accepting: !S.busy && performance.now() >= S.acceptAt,
          result: S.result, best: S.best, friend: S.friend, sampleRate: AU.sampleRate(),
          history: S.test ? S.test.history.slice() : []
        };
      }
    };
  }
})();
