/* Color Match — No. 099
 * A target colour fills the page and your swatch sits on it with no border, so
 * the only feedback is the edge itself. Drag H/S/L until it disappears.
 *
 * Scoring is real perceptual distance, not RGB distance: sRGB is de-gamma'd to
 * linear, converted to XYZ (D65) then CIELAB, and the two colours compared with
 * dE76. That is why two colours with similar hex codes can still score badly —
 * the eye is far more sensitive to some directions than others.
 *
 * Vanilla DOM + Canvas 2D + Web Audio. Self-contained.
 * localStorage best key: "colormatch_best" (best three-round average, 0-100). */
(function () {
  "use strict";

  var TAU = Math.PI * 2;
  var ROUNDS = 3;

  var field = document.getElementById("field");
  var swatch = document.getElementById("swatch");
  var swatchVerdict = document.getElementById("swatchVerdict");
  var fx = document.getElementById("fx");
  var fxc = fx.getContext("2d");
  var dock = document.getElementById("dock");
  var pipsWrap = document.getElementById("pips");
  var roundLbl = document.getElementById("roundLbl");
  var lockBtn = document.getElementById("lockBtn");
  var overlay = document.getElementById("overlay");
  var ovEyebrow = document.getElementById("ovEyebrow");
  var ovTitle = document.getElementById("ovTitle");
  var ovText = document.getElementById("ovText");
  var ovBtn = document.getElementById("ovBtn");
  var ovKeys = document.getElementById("ovKeys");
  var pairsWrap = document.getElementById("pairs");
  var soundBtn = document.getElementById("soundBtn");

  var sH = document.getElementById("sH"), sS = document.getElementById("sS"), sL = document.getElementById("sL");
  var oH = document.getElementById("oH"), oS = document.getElementById("oS"), oL = document.getElementById("oL");

  var REDMO = false;
  try { REDMO = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) {}

  // ------------------------------------------------------------------- state
  var state = "menu";       // menu | play | reveal | over
  var round = 0;
  var target = { h: 0, s: 0, l: 0 };
  var results = [];
  var best = 0;
  var sparks = [];
  var dpr = 1, W = 0, H = 0;
  var last = 0;

  var soundOn = true;
  try { best = parseInt(localStorage.getItem("colormatch_best") || "0", 10) || 0; } catch (e) {}
  try { if (localStorage.getItem("cm_sound") === "0") soundOn = false; } catch (e) {}
  soundBtn.setAttribute("aria-pressed", soundOn ? "true" : "false");

  function rnd(a, b) { return a + Math.random() * (b - a); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  // ============================================================ COLOUR MATHS
  function hsl2rgb(h, s, l) {
    h = ((h % 360) + 360) % 360 / 360; s /= 100; l /= 100;
    if (s === 0) { var v = l * 255; return [v, v, v]; }
    var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    var p = 2 * l - q;
    function hue(t) {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    }
    return [hue(h + 1 / 3) * 255, hue(h) * 255, hue(h - 1 / 3) * 255];
  }

  function css(c) {
    var r = hsl2rgb(c.h, c.s, c.l);
    return "rgb(" + Math.round(r[0]) + "," + Math.round(r[1]) + "," + Math.round(r[2]) + ")";
  }

  function hex(c) {
    var r = hsl2rgb(c.h, c.s, c.l);
    return "#" + r.map(function (v) {
      var s = Math.round(clamp(v, 0, 255)).toString(16);
      return s.length < 2 ? "0" + s : s;
    }).join("");
  }

  // sRGB -> linear -> XYZ (D65) -> CIELAB
  function lab(c) {
    var rgb = hsl2rgb(c.h, c.s, c.l).map(function (v) {
      v /= 255;
      return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    var x = (rgb[0] * 0.4124564 + rgb[1] * 0.3575761 + rgb[2] * 0.1804375) / 0.95047;
    var y = (rgb[0] * 0.2126729 + rgb[1] * 0.7151522 + rgb[2] * 0.0721750);
    var z = (rgb[0] * 0.0193339 + rgb[1] * 0.1191920 + rgb[2] * 0.9503041) / 1.08883;
    function f(t) { return t > 0.008856 ? Math.cbrt(t) : (7.787 * t) + 16 / 116; }
    var fx2 = f(x), fy = f(y), fz = f(z);
    return [116 * fy - 16, 500 * (fx2 - fy), 200 * (fy - fz)];
  }

  function deltaE(a, b) {
    var A = lab(a), B = lab(b);
    var dL = A[0] - B[0], da = A[1] - B[1], db = A[2] - B[2];
    return Math.sqrt(dL * dL + da * da + db * db);
  }

  // dE 0 -> 100%, dE >= 60 -> 0%. A just-noticeable difference (~2.3) still
  // scores in the low 90s, which is the right feel: close is not correct.
  function pctFor(dE) {
    var t = clamp(1 - dE / 60, 0, 1);
    return Math.round(1000 * Math.pow(t, 1.6)) / 10;
  }

  function relLum(c) {
    var rgb = hsl2rgb(c.h, c.s, c.l).map(function (v) {
      v /= 255;
      return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  }

  // ================================================================== AUDIO
  var AC = null, outGain = null;

  function initAudio() {
    if (AC) return;
    try { AC = new (window.AudioContext || window.webkitAudioContext)(); }
    catch (e) { AC = null; return; }
    outGain = AC.createGain();
    outGain.gain.value = soundOn ? 1 : 0;

    var comp = AC.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 26; comp.ratio.value = 3;
    comp.attack.value = 0.004; comp.release.value = 0.22;

    var verb = AC.createConvolver();
    verb.buffer = makeImpulse(2.4, 2.4);
    var vg = AC.createGain(); vg.gain.value = 0.4;

    var master = AC.createGain(); master.gain.value = 0.9;

    outGain.connect(comp);
    outGain.connect(verb); verb.connect(vg); vg.connect(comp);
    comp.connect(master); master.connect(AC.destination);
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
      var b = AC.createBuffer(1, 1, 22050), s = AC.createBufferSource();
      s.buffer = b; s.connect(AC.destination); s.start(0);
    } catch (e) {}
  }

  function tone(o) {
    if (!AC || !soundOn) return;
    var t = AC.currentTime + (o.at || 0);
    var osc = AC.createOscillator();
    osc.type = o.type || "sine";
    osc.frequency.setValueAtTime(o.f, t);
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f2), t + (o.dur || 0.3));
    var g = AC.createGain();
    var a = o.a != null ? o.a : 0.005, d = o.dur || 0.3;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.g != null ? o.g : 0.12, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
    osc.connect(g);
    if (o.pan != null && AC.createStereoPanner) {
      var p = AC.createStereoPanner(); p.pan.value = clamp(o.pan, -1, 1);
      g.connect(p); p.connect(outGain);
    } else g.connect(outGain);
    osc.start(t); osc.stop(t + a + d + 0.05);
  }

  // a soft glassy tick while dragging; pitch rides the slider position so the
  // three controls each have their own register
  var lastTick = 0;
  function sndSlide(k, v) {
    if (!soundOn) return;
    var nowMs = performance.now();
    if (nowMs - lastTick < 34) return;
    lastTick = nowMs;
    var base = k === "h" ? 520 : k === "s" ? 660 : 820;
    tone({ type: "sine", f: base * (0.82 + v * 0.5), dur: 0.05, a: 0.002, g: 0.028 });
  }

  // the reveal: a rising chord whose top note climbs with the score
  function sndScore(pct) {
    if (!soundOn) return;
    var steps = pct >= 97 ? [0, 4, 7, 12, 16, 19] : pct >= 90 ? [0, 4, 7, 12] : pct >= 75 ? [0, 4, 7] : [0, 3];
    for (var i = 0; i < steps.length; i++) {
      var f = 329.63 * Math.pow(2, steps[i] / 12);
      tone({ type: "triangle", f: f, dur: 0.75, a: 0.007, g: 0.09, at: i * 0.07, pan: (i / steps.length - 0.5) * 0.6 });
      tone({ type: "sine", f: f * 2, dur: 0.4, a: 0.004, g: 0.028, at: i * 0.07 });
    }
    if (pct < 60) tone({ type: "sine", f: 146, f2: 110, dur: 0.3, a: 0.006, g: 0.08 });
  }

  function sndFinal(avg) {
    if (!soundOn) return;
    var steps = avg >= 90 ? [0, 7, 12, 16, 19, 24] : [0, 5, 9, 12];
    for (var i = 0; i < steps.length; i++) {
      var f = 261.63 * Math.pow(2, steps[i] / 12);
      tone({ type: "triangle", f: f, dur: 1.1, a: 0.01, g: 0.1, at: i * 0.1, pan: (i / steps.length - 0.5) * 0.7 });
    }
  }

  soundBtn.addEventListener("click", function () {
    soundOn = !soundOn;
    soundBtn.setAttribute("aria-pressed", soundOn ? "true" : "false");
    try { localStorage.setItem("cm_sound", soundOn ? "1" : "0"); } catch (e) {}
    if (outGain && AC) {
      try { outGain.gain.setTargetAtTime(soundOn ? 1 : 0, AC.currentTime, 0.02); }
      catch (e) { outGain.gain.value = soundOn ? 1 : 0; }
    }
    unlockAudio();
  });

  // ================================================================== CHROME
  // every bit of UI reads --chrome*, which flips with the target's luminance
  function applyChrome() {
    var dark = relLum(target) < 0.42;
    var r = document.documentElement.style;
    if (dark) {
      r.setProperty("--chrome", "rgba(255,255,255,0.6)");
      r.setProperty("--chrome-strong", "rgba(255,255,255,0.96)");
      r.setProperty("--chrome-bg", "rgba(12,12,16,0.7)");
      r.setProperty("--chrome-line", "rgba(255,255,255,0.2)");
      r.setProperty("--chrome-ink", "#ffffff");
      r.setProperty("--chrome-inv", "#12121a");
    } else {
      r.setProperty("--chrome", "rgba(14,14,20,0.6)");
      r.setProperty("--chrome-strong", "rgba(10,10,14,0.95)");
      r.setProperty("--chrome-bg", "rgba(255,255,255,0.78)");
      r.setProperty("--chrome-line", "rgba(0,0,0,0.16)");
      r.setProperty("--chrome-ink", "#12121a");
      r.setProperty("--chrome-inv", "#ffffff");
    }
  }

  // ================================================================= SLIDERS
  function mine() {
    return { h: +sH.value, s: +sS.value, l: +sL.value };
  }

  function paintTracks() {
    var m = mine();
    var hueStops = [];
    for (var i = 0; i <= 12; i++) hueStops.push("hsl(" + (i * 30) + " " + m.s + "% " + m.l + "%)");
    sH.style.setProperty("--track", "linear-gradient(90deg," + hueStops.join(",") + ")");
    sS.style.setProperty("--track",
      "linear-gradient(90deg, hsl(" + m.h + " 0% " + m.l + "%), hsl(" + m.h + " 100% " + m.l + "%))");
    sL.style.setProperty("--track",
      "linear-gradient(90deg, #000, hsl(" + m.h + " " + m.s + "% 50%), #fff)");
  }

  function syncMine() {
    var m = mine();
    document.documentElement.style.setProperty("--mine", css(m));
    oH.textContent = m.h + "°";
    oS.textContent = m.s + "%";
    oL.textContent = m.l + "%";
    paintTracks();
  }

  [[sH, "h", 360], [sS, "s", 100], [sL, "l", 100]].forEach(function (def) {
    def[0].addEventListener("input", function () {
      if (state !== "play") return;
      syncMine();
      unlockAudio();
      sndSlide(def[1], def[0].value / def[2]);
    });
  });

  // ================================================================== ROUNDS
  function makeTarget(r) {
    // early rounds are vivid and forgiving; late rounds go muted and extreme,
    // where the eye is much worse at judging small differences
    var t = r / (ROUNDS - 1);
    var sat = rnd(58, 92) * (1 - t) + rnd(10, 38) * t;
    var lit = rnd(42, 62) * (1 - t) + (Math.random() < 0.5 ? rnd(18, 32) : rnd(72, 88)) * t;
    return { h: Math.round(rnd(0, 360)), s: Math.round(clamp(sat, 4, 96)), l: Math.round(clamp(lit, 10, 92)) };
  }

  function startRound() {
    target = makeTarget(round);
    document.documentElement.style.setProperty("--target", css(target));
    applyChrome();

    // start somewhere genuinely wrong so nobody starts halfway home
    sH.value = Math.round((target.h + rnd(80, 280)) % 360);
    sS.value = Math.round(clamp(target.s + (Math.random() < 0.5 ? -1 : 1) * rnd(25, 50), 5, 95));
    sL.value = Math.round(clamp(target.l + (Math.random() < 0.5 ? -1 : 1) * rnd(18, 34), 10, 90));
    syncMine();

    swatchVerdict.hidden = true;
    swatch.classList.remove("is-locked");
    lockBtn.textContent = "Lock it in";
    roundLbl.textContent = "Round " + (round + 1) + " of " + ROUNDS;
    renderPips();
    state = "play";
  }

  function renderPips() {
    pipsWrap.textContent = "";
    for (var i = 0; i < ROUNDS; i++) {
      var p = document.createElement("span");
      p.className = "pip" + (i < round ? " is-on" : "");
      pipsWrap.appendChild(p);
    }
  }

  function lockIn() {
    if (state !== "play") return;
    state = "reveal";
    var m = mine();
    var dE = deltaE(target, m);
    var pct = pctFor(dE);
    results.push({ target: hex(target), mine: hex(m), pct: pct, dE: dE });

    swatch.classList.add("is-locked");
    swatchVerdict.hidden = false;
    swatchVerdict.innerHTML = "<b>" + pct.toFixed(1) + "%</b><span>" +
      (dE < 0.9 ? "perfect · &Delta;E " : "&Delta;E ") + dE.toFixed(1) + "</span>";
    lockBtn.textContent = round + 1 >= ROUNDS ? "See the verdict" : "Next round";
    sndScore(pct);
    if (pct >= 90) burst(pct);
  }

  lockBtn.addEventListener("click", function () {
    unlockAudio();
    if (state === "play") { lockIn(); return; }
    if (state === "reveal") {
      round++;
      if (round >= ROUNDS) finish();
      else startRound();
    }
  });

  window.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      e.preventDefault();
      if (state === "menu" || state === "over") ovBtn.click();
      else lockBtn.click();
    }
  });

  function finish() {
    state = "over";
    var sum = 0;
    for (var i = 0; i < results.length; i++) sum += results[i].pct;
    var avg = Math.round(sum / results.length * 10) / 10;
    var isBest = avg > best;
    if (isBest) {
      best = Math.round(avg);
      try { localStorage.setItem("colormatch_best", String(best)); } catch (e) {}
    }

    pairsWrap.textContent = "";
    results.forEach(function (r, i) {
      var d = document.createElement("div");
      d.className = "pair";
      var a = document.createElement("div"); a.className = "pair__sw"; a.style.background = r.target;
      var b = document.createElement("div"); b.className = "pair__sw"; b.style.background = r.mine;
      var n = document.createElement("p"); n.className = "pair__n"; n.textContent = r.pct.toFixed(0) + "%";
      d.appendChild(a); d.appendChild(b); d.appendChild(n);
      pairsWrap.appendChild(d);
    });
    pairsWrap.hidden = false;

    var grade = avg >= 95 ? "Calibrated" : avg >= 88 ? "A very good eye" :
      avg >= 78 ? "Solid" : avg >= 65 ? "Getting there" : "Room to grow";
    ovEyebrow.textContent = isBest ? "New personal best" : grade;
    ovTitle.textContent = avg.toFixed(1) + "%";
    ovText.innerHTML = "Average match across three rounds. Top row is the target, bottom is what you mixed." +
      (isBest ? " <b>Your best yet.</b>" : " Your best is <b>" + best + "%</b>.");
    ovBtn.textContent = "Go again";
    ovKeys.textContent = "drag the sliders · arrow keys for fine control";
    overlay.hidden = false;
    dock.hidden = true;
    sndFinal(avg);

    window.OPT_SHARE_TEXT = "My eye scored " + avg.toFixed(1) + "% on Color Match at One Page Toys.";
    if (window.OPT_SHARE && window.OPT_SHARE.refresh) window.OPT_SHARE.refresh();
  }

  ovBtn.addEventListener("click", function () {
    unlockAudio();
    round = 0;
    results = [];
    overlay.hidden = true;
    pairsWrap.hidden = true;
    dock.hidden = false;
    startRound();
  });

  // ===================================================================== FX
  function burst(pct) {
    if (REDMO) return;
    var r = swatch.getBoundingClientRect();
    var n = pct >= 97 ? 60 : 30;
    for (var i = 0; i < n; i++) {
      var a = rnd(0, TAU), sp = rnd(70, 340);
      sparks.push({
        x: r.left + r.width / 2, y: r.top + r.height / 2,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60,
        t: 0, life: rnd(0.5, 1.1), r: rnd(1.6, 3.6),
        col: i % 3 === 0 ? "#ffffff" : (i % 3 === 1 ? css(target) : css(mine()))
      });
    }
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    fx.width = Math.round(W * dpr);
    fx.height = Math.round(H * dpr);
    fx.style.width = W + "px";
    fx.style.height = H + "px";
    fxc.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener("resize", resize);
  window.addEventListener("orientationchange", function () { resize(); setTimeout(resize, 200); });

  function frame(ts) {
    if (!last) last = ts;
    var dt = Math.min(0.05, (ts - last) / 1000);
    last = ts;

    fxc.setTransform(dpr, 0, 0, dpr, 0, 0);
    fxc.clearRect(0, 0, W, H);
    for (var i = sparks.length - 1; i >= 0; i--) {
      var p = sparks[i];
      p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 520 * dt;
      p.vx *= 0.985;
      if (p.t > p.life) { sparks.splice(i, 1); continue; }
      var a = 1 - p.t / p.life;
      fxc.globalAlpha = clamp(a, 0, 1);
      fxc.fillStyle = p.col;
      fxc.beginPath(); fxc.arc(p.x, p.y, p.r * (0.5 + a * 0.8), 0, TAU); fxc.fill();
    }
    fxc.globalAlpha = 1;
    requestAnimationFrame(frame);
  }

  // a calm neutral behind the opening panel, not a random shout of colour
  target = { h: 214, s: 12, l: 26 };
  document.documentElement.style.setProperty("--target", css(target));
  document.documentElement.style.setProperty("--mine", css({ h: 214, s: 14, l: 36 }));
  applyChrome();
  syncMine();
  renderPips();
  resize();
  requestAnimationFrame(frame);
})();
