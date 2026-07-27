/* 5 Second Game — No. 100
 * A practice edition of the daily at 5secondgame.com. Start the clock, count
 * it out with the readout blanked, and stop as close as you can to the target.
 *
 * ⚠ THE ONE HARD RULE: nothing on screen may encode elapsed time. The whole
 * game is your own sense of five seconds, so the backdrop drifts on
 * incommensurate periods (13.7s / 21.3s / per-mote random velocities) and
 * never pulses — a breathing ring would be a metronome and would hand the
 * player the answer.
 *
 * Ratings and the 3–8s random range are ported from the real game so practice
 * here is practice for there. The daily target, streaks and the leaderboard
 * stay on the site; this only ever sends you at them.
 *
 * Vanilla Canvas 2D + Web Audio. Self-contained.
 * localStorage: "fsg_best" (closest miss in ms, LOWER is better),
 * "fsg_rounds", "fsg_seen", "fsg_mode", "fsg_sound". */
(function () {
  "use strict";

  var TAU = Math.PI * 2;
  var SITE = "https://5secondgame.com";

  // ---------------------------------------------------------------- elements
  var canvas = document.getElementById("canvas");
  var ctx = canvas.getContext("2d");
  var targetEl = document.getElementById("target");
  var readout = document.getElementById("readout");
  var verdict = document.getElementById("verdict");
  var meterEl = document.getElementById("meter");
  var goBtn = document.getElementById("goBtn");
  var modesWrap = document.getElementById("modes");
  var bestEl = document.getElementById("best");
  var streakEl = document.getElementById("streak");
  var roundsEl = document.getElementById("rounds");
  var dailyEl = document.getElementById("daily");
  var dailyTime = document.getElementById("dailyTime");
  var cta = document.getElementById("cta");
  var ctaLine = document.getElementById("ctaLine");
  var ctaBtn = document.getElementById("ctaBtn");
  var shareBtn = document.getElementById("shareBtn");
  var intro = document.getElementById("intro");
  var introBtn = document.getElementById("introBtn");
  var helpBtn = document.getElementById("helpBtn");
  var soundBtn = document.getElementById("soundBtn");

  var REDMO = false;
  try { REDMO = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) {}

  // ---------------------------------------------------------------- ratings
  // ported verbatim from the real game's src/lib/ratings.ts
  function ratingFor(diff) {
    if (diff <= 10) return { label: "Perfect", emoji: "⚡", col: "#17cf80", q: 0 };
    if (diff <= 50) return { label: "Amazing", emoji: "🔥", col: "#8b4dff", q: 1 };
    if (diff <= 200) return { label: "Great", emoji: "✨", col: "#f6a723", q: 2 };
    if (diff <= 500) return { label: "Good", emoji: "👍", col: "#7a8299", q: 3 };
    return { label: "Try again", emoji: "😅", col: "#7a8299", q: 4 };
  }

  // ------------------------------------------------------------------- state
  var state = "ready";        // ready | running | result
  var mode = "classic";
  var target = 5000;
  var startedAt = 0;
  var elapsed = 0, diff = 0, last = null;
  var best = null, streak = 0, rounds = 0;
  var motes = [], confetti = [];
  var t0 = 0, frame0 = 0;
  var dpr = 1, W = 0, H = 0;

  // ------------------------------------------------------------ persistence
  var soundOn = true;
  try {
    var b = localStorage.getItem("fsg_best");
    if (b !== null && b !== "") { var n = parseInt(b, 10); if (isFinite(n)) best = n; }
    rounds = parseInt(localStorage.getItem("fsg_rounds") || "0", 10) || 0;
    var m = localStorage.getItem("fsg_mode");
    if (m === "random" || m === "classic") mode = m;
    if (localStorage.getItem("fsg_sound") === "0") soundOn = false;
  } catch (e) {}
  soundBtn.setAttribute("aria-pressed", soundOn ? "true" : "false");

  function save(k, v) { try { localStorage.setItem(k, String(v)); } catch (e) {} }

  function rnd(a, b) { return a + Math.random() * (b - a); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function fmt(ms) { return (ms / 1000).toFixed(3); }

  // ================================================================== AUDIO
  var AC = null, outGain = null, noiseBuf = null;

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

    var verb = AC.createConvolver();
    verb.buffer = makeImpulse(2.2, 2.6);
    var vg = AC.createGain(); vg.gain.value = 0.34;

    var master = AC.createGain(); master.gain.value = 0.9;

    outGain.connect(lp); lp.connect(comp);
    outGain.connect(verb); verb.connect(vg); vg.connect(comp);
    comp.connect(master); master.connect(AC.destination);

    var len = Math.floor(AC.sampleRate);
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
        prev = prev + 0.24 * ((Math.random() * 2 - 1) - prev);
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
      var b2 = AC.createBuffer(1, 1, 22050), s = AC.createBufferSource();
      s.buffer = b2; s.connect(AC.destination); s.start(0);
    } catch (e) {}
  }

  function tone(o) {
    if (!AC || !soundOn) return;
    var t = AC.currentTime + (o.at || 0);
    var osc = AC.createOscillator();
    osc.type = o.type || "sine";
    osc.frequency.setValueAtTime(o.f, t);
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f2), t + (o.dur || 0.2));
    var g = AC.createGain();
    var a = o.a != null ? o.a : 0.004, d = o.dur || 0.2;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.g != null ? o.g : 0.14, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
    osc.connect(g);
    if (o.pan != null && AC.createStereoPanner) {
      var p = AC.createStereoPanner(); p.pan.value = clamp(o.pan, -1, 1);
      g.connect(p); p.connect(outGain);
    } else g.connect(outGain);
    osc.start(t); osc.stop(t + a + d + 0.05);
  }

  function noise(o) {
    if (!AC || !soundOn || !noiseBuf) return;
    var t = AC.currentTime + (o.at || 0), dur = o.dur || 0.05;
    var s = AC.createBufferSource();
    s.buffer = noiseBuf;
    var f = AC.createBiquadFilter();
    f.type = o.filt || "bandpass";
    f.frequency.setValueAtTime(o.f || 2400, t);
    if (o.f2) f.frequency.exponentialRampToValueAtTime(Math.max(60, o.f2), t + dur);
    if (o.Q) f.Q.value = o.Q;
    var g = AC.createGain();
    g.gain.setValueAtTime(o.g != null ? o.g : 0.12, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(outGain);
    s.start(t, rnd(0, 0.5)); s.stop(t + dur + 0.04);
  }

  // ⚠ The start and stop sounds are deliberately SHORT and un-rhythmic. A tail
  // long enough to hear out, or any repeat, would be a timing reference.
  function sndStart() {
    noise({ filt: "highpass", f: 2600, dur: 0.03, g: 0.09 });
    tone({ type: "triangle", f: 520, f2: 780, dur: 0.07, a: 0.002, g: 0.1 });
  }
  function sndStop() {
    noise({ filt: "bandpass", f: 1800, Q: 1.4, dur: 0.035, g: 0.16 });
    tone({ type: "sine", f: 300, f2: 150, dur: 0.05, a: 0.001, g: 0.16 });
  }
  function sndRating(q) {
    var ladders = [
      [0, 7, 12, 16, 19, 24],   // Perfect
      [0, 4, 7, 12, 16],        // Amazing
      [0, 4, 7, 12],            // Great
      [0, 5, 7],                // Good
      [0, -2]                   // Try again
    ];
    var steps = ladders[q] || ladders[4];
    var base = q === 4 ? 196 : 329.63;
    for (var i = 0; i < steps.length; i++) {
      var f = base * Math.pow(2, steps[i] / 12);
      tone({ type: "triangle", f: f, dur: q === 4 ? 0.3 : 0.7, a: 0.006, g: q === 4 ? 0.09 : 0.1,
             at: i * 0.075, pan: (i / steps.length - 0.5) * 0.6 });
      if (q < 3) tone({ type: "sine", f: f * 2, dur: 0.35, a: 0.004, g: 0.028, at: i * 0.075 });
    }
  }
  function sndUi() { tone({ type: "triangle", f: 660, f2: 880, dur: 0.06, a: 0.002, g: 0.06 }); }

  soundBtn.addEventListener("click", function () {
    soundOn = !soundOn;
    soundBtn.setAttribute("aria-pressed", soundOn ? "true" : "false");
    save("fsg_sound", soundOn ? "1" : "0");
    if (outGain && AC) {
      try { outGain.gain.setTargetAtTime(soundOn ? 1 : 0, AC.currentTime, 0.02); }
      catch (e) { outGain.gain.value = soundOn ? 1 : 0; }
    }
    unlockAudio();
  });

  // ================================================================= FUNNEL
  function track(name, params) {
    try { if (typeof window.gtag === "function") window.gtag("event", name, params || {}); } catch (e) {}
  }

  [dailyEl, ctaBtn].forEach(function (el) {
    el.addEventListener("click", function () {
      track("outbound_click", { destination: "5secondgame.com", link_id: el.id });
    });
  });

  // The real game's daily rolls on a UTC date key (src/lib/daily-challenge.ts),
  // so the countdown has to be to UTC midnight, not the player's local one.
  function tickCountdown() {
    var now = new Date();
    var next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0);
    var left = Math.max(0, next - now.getTime());
    var h = Math.floor(left / 3600000);
    var m = Math.floor(left / 60000) % 60;
    var s = Math.floor(left / 1000) % 60;
    dailyTime.textContent = h + "h " + (m < 10 ? "0" : "") + m + "m " + (s < 10 ? "0" : "") + s + "s";
    dailyEl.title = "A new daily target drops in " + h + "h " + m + "m at 5secondgame.com";
  }
  tickCountdown();
  setInterval(tickCountdown, 1000);

  function refreshCta() {
    if (rounds >= 8) {
      dailyEl.classList.add("is-hot");
      ctaLine.innerHTML = "You have played <b>" + rounds + " rounds</b> in here. " +
        "Everyone is chasing the <b>same target</b> today on the real thing — with streaks and a global leaderboard.";
      ctaBtn.textContent = "Take it to the daily →";
    } else if (rounds >= 3) {
      ctaLine.innerHTML = "Warmed up? The <b>daily challenge</b> gives everyone one shared target — and it only counts once.";
      ctaBtn.textContent = "Play today's daily →";
    } else {
      ctaLine.innerHTML = "The daily challenge, streaks and the leaderboard are all on the real thing.";
      ctaBtn.textContent = "Play today's daily →";
    }
  }

  shareBtn.addEventListener("click", function () {
    unlockAudio();
    sndUi();
    if (last === null) return;
    var r = ratingFor(last.diff);
    var line = r.emoji + " " + fmt(last.elapsed) + "s — " + last.diff + "ms off " + fmt(last.target) + "s" +
      (best !== null ? "\nBest miss: " + best + "ms" : "") +
      "\n\nPlay today's daily against everyone → " + SITE + "/?utm_source=onepagetoys&utm_medium=share";
    track("share", { method: "5sg_feeder", value: last.diff });
    if (navigator.share) {
      navigator.share({ title: "5 Second Game", text: line }).catch(function () {});
      return;
    }
    var done = function () {
      shareBtn.textContent = "Copied";
      setTimeout(function () { shareBtn.textContent = "Share your round"; }, 1600);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(line).then(done, done);
    } else done();
  });

  // ================================================================== INTRO
  var seen = false;
  try { seen = localStorage.getItem("fsg_seen") === "1"; } catch (e) {}
  if (!seen) intro.hidden = false;
  introBtn.addEventListener("click", function () {
    intro.hidden = true;
    save("fsg_seen", "1");
    unlockAudio();
    sndUi();
  });
  helpBtn.addEventListener("click", function () {
    intro.hidden = false;
    unlockAudio();
    sndUi();
  });

  // =================================================================== MODES
  function setMode(next) {
    mode = next;
    save("fsg_mode", mode);
    var kids = modesWrap.children;
    for (var i = 0; i < kids.length; i++) {
      var on = kids[i].getAttribute("data-mode") === mode;
      kids[i].classList.toggle("is-on", on);
      kids[i].setAttribute("aria-checked", on ? "true" : "false");
    }
    if (state !== "running") reset();
  }
  Array.prototype.forEach.call(modesWrap.children, function (btn) {
    btn.addEventListener("click", function () {
      if (state === "running") return;
      unlockAudio();
      sndUi();
      setMode(btn.getAttribute("data-mode"));
    });
  });

  function pickTarget() {
    // same 3000–8000ms in 100ms steps the real game's daily draws from
    return mode === "classic" ? 5000 : 3000 + Math.floor(Math.random() * 51) * 100;
  }

  // ================================================================= ROUNDS
  function reset() {
    state = "ready";
    target = pickTarget();
    document.body.classList.remove("is-running", "is-result");
    targetEl.innerHTML = "Stop at <b>" + fmt(target) + "</b>";
    readout.textContent = fmt(target);
    readout.style.color = "";
    verdict.textContent = rounds ? "Ready when you are" : "Tap start, count it out, tap stop";
    verdict.classList.remove("is-pop");
    goBtn.textContent = "Start";
  }

  function start() {
    unlockAudio();
    state = "running";
    startedAt = performance.now();
    document.body.classList.remove("is-result");
    document.body.classList.add("is-running");
    // the readout is blanked on purpose — this is the whole game
    readout.textContent = "–.–––";
    readout.style.color = "";
    verdict.textContent = "Counting…";
    verdict.classList.remove("is-pop");
    goBtn.textContent = "Stop";
    cta.hidden = true;
    sndStart();
  }

  function stop() {
    state = "result";
    elapsed = Math.round(performance.now() - startedAt);
    diff = Math.abs(elapsed - target);
    var r = ratingFor(diff);
    last = { elapsed: elapsed, target: target, diff: diff };

    rounds++;
    save("fsg_rounds", rounds);
    if (best === null || diff < best) { best = diff; save("fsg_best", best); }
    streak = diff <= 200 ? streak + 1 : 0;

    document.body.classList.remove("is-running");
    document.body.classList.add("is-result");
    readout.textContent = fmt(elapsed);
    readout.style.color = r.col;
    var early = elapsed < target;
    verdict.innerHTML = r.emoji + " <b style=\"color:" + r.col + "\">" + r.label + "</b> · " +
      (diff === 0 ? "dead on" : diff + "ms " + (early ? "early" : "late"));
    verdict.classList.remove("is-pop");
    void verdict.offsetWidth;
    if (!REDMO) verdict.classList.add("is-pop");
    goBtn.textContent = "Go again";

    sndStop();
    setTimeout(function () { sndRating(r.q); }, 260);
    if (r.q <= 2) burst(r.q, r.col);

    refreshCta();
    cta.hidden = false;
    updateHud();
  }

  function updateHud() {
    bestEl.textContent = best === null ? "—" : best + "ms";
    streakEl.textContent = streak;
    roundsEl.textContent = rounds;
  }

  goBtn.addEventListener("click", function () {
    if (!intro.hidden) return;
    if (state === "running") stop();
    else if (state === "ready") start();
    else { reset(); start(); }
  });

  // tapping the backdrop works too — but never the chrome sitting on top of it
  document.addEventListener("pointerdown", function (e) {
    if (!intro.hidden) return;
    var t = e.target;
    if (t.closest && t.closest("a, button, .cta, .modes, .topright, .daily, .hud")) return;
    if (state === "running") stop();
    else if (state === "ready") start();
    else { reset(); start(); }
  });

  window.addEventListener("keydown", function (e) {
    if (e.code === "Space" || e.key === " " || e.key === "Enter") {
      e.preventDefault();
      if (!intro.hidden) { introBtn.click(); return; }
      goBtn.click();
    } else if (e.key === "?" || (e.key === "/" && e.shiftKey)) {
      e.preventDefault();
      helpBtn.click();
    }
  });

  // ===================================================================== FX
  function burst(q, col) {
    if (REDMO) return;
    var n = q === 0 ? 120 : q === 1 ? 70 : 34;
    for (var i = 0; i < n; i++) {
      var a = rnd(0, TAU), sp = rnd(90, 430);
      confetti.push({
        x: W / 2, y: H * 0.42,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 90,
        w: rnd(3, 8), h: rnd(5, 12), rot: rnd(0, TAU), vr: rnd(-9, 9),
        t: 0, life: rnd(0.9, 1.8),
        col: i % 4 === 0 ? "#ffffff" : i % 4 === 1 ? col : i % 4 === 2 ? "#8b4dff" : "#f6a723"
      });
    }
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    motes = [];
    var n = Math.round(clamp((W * H) / 16000, 34, 110));
    for (var i = 0; i < n; i++) {
      motes.push({
        x: Math.random() * W, y: Math.random() * H,
        r: rnd(0.6, 2.1),
        // per-mote random velocity: no shared rhythm to count against
        vx: rnd(-9, 9), vy: rnd(-14, -3),
        a: rnd(0.12, 0.5), tw: rnd(0.4, 1.5), p: rnd(0, TAU)
      });
    }
  }
  window.addEventListener("resize", resize);
  window.addEventListener("orientationchange", function () {
    resize(); setTimeout(resize, 200);
  });

  function draw(dt) {
    t0 += dt;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#131829");
    g.addColorStop(0.55, "#0e1119");
    g.addColorStop(1, "#080a11");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // Two slow violet blooms on incommensurate periods (13.7s and 21.3s) so
    // the field never repeats on a beat a player could count against.
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    var running = state === "running";
    for (var k = 0; k < 2; k++) {
      var per = k ? 21.3 : 13.7;
      var ph = t0 / per * TAU + k * 2.1;
      var bx = W * (0.5 + Math.sin(ph) * 0.22 + Math.sin(ph * 0.37 + 1.2) * 0.09);
      var by = H * (0.44 + Math.cos(ph * 0.81) * 0.18);
      var rad = Math.min(W, H) * (k ? 0.62 : 0.48);
      var bl = ctx.createRadialGradient(bx, by, 1, bx, by, rad);
      var amt = (k ? 0.05 : 0.075) + (running ? 0.02 : 0);
      bl.addColorStop(0, "rgba(139,77,255," + amt.toFixed(3) + ")");
      bl.addColorStop(1, "rgba(139,77,255,0)");
      ctx.fillStyle = bl;
      ctx.beginPath(); ctx.arc(bx, by, rad, 0, TAU); ctx.fill();
    }

    // drifting motes
    for (var i = 0; i < motes.length; i++) {
      var mo = motes[i];
      mo.x += mo.vx * dt; mo.y += mo.vy * dt;
      if (mo.y < -6) { mo.y = H + 6; mo.x = Math.random() * W; }
      if (mo.x < -6) mo.x = W + 6; else if (mo.x > W + 6) mo.x = -6;
      var tw = 0.68 + Math.sin(t0 * mo.tw + mo.p) * 0.32;
      ctx.globalAlpha = mo.a * tw * (running ? 1.3 : 1);
      ctx.fillStyle = i % 7 === 0 ? "#a97cff" : "#cfd6ea";
      ctx.beginPath(); ctx.arc(mo.x, mo.y, mo.r, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    if (state === "result" && last) drawMeter();

    for (var c = confetti.length - 1; c >= 0; c--) {
      var p = confetti[c];
      p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 620 * dt;
      p.vx *= 0.99; p.rot += p.vr * dt;
      if (p.t > p.life) { confetti.splice(c, 1); continue; }
      ctx.save();
      ctx.globalAlpha = clamp(1 - p.t / p.life, 0, 1);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.col;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.rot * 1.3)));
      ctx.restore();
    }

    // a soft vignette to hold the eye on the readout
    var v = ctx.createRadialGradient(W / 2, H * 0.44, Math.min(W, H) * 0.25, W / 2, H * 0.5, Math.max(W, H) * 0.8);
    v.addColorStop(0, "rgba(0,0,0,0)");
    v.addColorStop(1, "rgba(0,0,0,0.55)");
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, W, H);
  }

  // How close you landed, on the game's own tolerance bands. Positioned off the
  // live DOM rect so it tracks the stage at any viewport.
  function drawMeter() {
    var r = meterEl.getBoundingClientRect();
    var bw = Math.min(300, W - 56);
    var bx = W / 2 - bw / 2;
    var by = r.top + 4;
    if (by + 26 > H) return;
    var h = 9;
    var SPAN = 600;   // ms either side of the target the bar covers

    var bands = [
      [500, "rgba(122,130,153,0.30)"],
      [200, "rgba(246,167,35,0.34)"],
      [50, "rgba(139,77,255,0.45)"],
      [10, "rgba(23,207,128,0.75)"]
    ];
    ctx.save();
    for (var i = 0; i < bands.length; i++) {
      var half = Math.min(1, bands[i][0] / SPAN) * (bw / 2);
      ctx.fillStyle = bands[i][1];
      roundRect(ctx, W / 2 - half, by, half * 2, h, h / 2);
      ctx.fill();
    }
    // target line
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fillRect(W / 2 - 1, by - 4, 2, h + 8);

    // where you actually stopped
    var off = clamp((last.elapsed - last.target) / SPAN, -1, 1) * (bw / 2);
    var rr = ratingFor(last.diff);
    ctx.fillStyle = rr.col;
    ctx.beginPath();
    ctx.arc(W / 2 + off, by + h / 2, 6, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = "rgba(10,12,20,0.85)";
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.font = "500 9px 'JetBrains Mono', ui-monospace, monospace";
    ctx.fillStyle = "rgba(227,231,242,0.42)";
    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    ctx.fillText("EARLY", bx, by + h + 7);
    ctx.textAlign = "right";
    ctx.fillText("LATE", bx + bw, by + h + 7);
    ctx.restore();
  }

  function roundRect(c, x, y, w, h, rad) {
    rad = Math.min(rad, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + rad, y);
    c.arcTo(x + w, y, x + w, y + h, rad);
    c.arcTo(x + w, y + h, x, y + h, rad);
    c.arcTo(x, y + h, x, y, rad);
    c.arcTo(x, y, x + w, y, rad);
    c.closePath();
  }

  // ==================================================================== LOOP
  function loop(ts) {
    if (!frame0) frame0 = ts;
    var dt = Math.min(0.05, (ts - frame0) / 1000);
    frame0 = ts;
    draw(dt);
    requestAnimationFrame(loop);
  }

  setMode(mode);
  reset();
  updateHud();
  refreshCta();
  resize();
  requestAnimationFrame(loop);
})();
