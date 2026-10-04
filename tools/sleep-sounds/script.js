/* Sleep Sounds: the page. Mixer, presets, play with an 8 s fade-in, a sleep
 * timer that fades out slowly, phone care (wake lock, lock-screen controls,
 * background playback), and the night window that answers the mix.
 * The sound itself is made in engine.js (an AudioWorklet). */
(function () {
  "use strict";

  var SL = window.SleepLogic;
  var LAYERS = SL.LAYERS;
  function $(id) { return document.getElementById(id); }
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------- storage ----------
  function load(k, d) { try { var v = localStorage.getItem("sleepsounds_" + k); return v === null ? d : v; } catch (e) { return d; } }
  function store(k, v) { try { localStorage.setItem("sleepsounds_" + k, String(v)); } catch (e) {} }
  function ga(name, params) { try { if (typeof gtag === "function") gtag("event", name, params || {}); } catch (e) {} }

  // ---------- state ----------
  var shared = SL.decodeMix(location.hash);
  var mix = shared || SL.decodeMix("#mix=" + load("mix", SL.encodeMix(SL.DEFAULT_MIX))) || SL.normalize(SL.DEFAULT_MIX);
  if (!shared && load("mix", null) === "") mix = SL.blank();       // they turned everything off last time
  var volume = SL.clamp(parseInt(load("vol", SL.DEFAULT_VOLUME), 10) || 0, 0, 100);
  var timerId = load("timer", "off");
  if (!SL.TIMERS.some(function (t) { return t.id === timerId; })) timerId = "off";
  var morning = load("morning", "07:00");
  var keepAwake = load("awake", "1") !== "0";
  var playing = false, dim = false, sharedLabel = !!shared;
  if (shared) { try { history.replaceState(null, "", location.pathname + location.search); } catch (e) {} }

  // ---------- build the controls ----------
  var ICONS = {
    brown: '<path d="M2 13c3-7 7-7 10 0s7 7 10 0"/>',
    pink: '<path d="M2 12c1.7-4.5 3.3-4.5 5 0s3.3 4.5 5 0 3.3-4.5 5 0 3.3 4.5 5 0"/>',
    white: '<path d="M2 12l2-4 2 7 2-9 2 11 2-8 2 6 2-5 2 7 2-4"/>',
    rain: '<path d="M7 14.5a4 4 0 0 1 .4-8 5 5 0 0 1 9.6 1.4 3.3 3.3 0 0 1 0 6.6"/><path d="M8.5 17.5l-1 2.5M12.5 16.5l-1.2 3.5M16.5 17.5l-1 2.5"/>',
    fan: '<circle cx="12" cy="12" r="9"/><path d="M12 12c-.4-2.8.8-4.8 3.2-5.4M12 12c2.6 1 3.6 3.2 2.6 5.4M12 12c-2.2 1.8-4.6 1.7-6.2.1"/><circle cx="12" cy="12" r="1.2"/>',
    waves: '<path d="M2 16c2.4 0 3-2.6 5.5-2.6S10.6 16 13 16s3-2.6 5.5-2.6S21 16 22 16"/><path d="M4 11.5c1.2-3.7 4.6-5.3 7.6-3.7-2.4.3-3.3 2.2-2.4 3.8"/><path d="M2 20.2c2.4 0 3-1.7 5.5-1.7s3 1.7 5.5 1.7 3-1.7 5.5-1.7S21 20.2 22 20.2"/>',
    fire: '<path d="M12 21c-3.8 0-6-2.6-6-5.7 0-3.3 2.5-4.9 3.3-8 .7 1.7 1.5 2.4 2.5 2.8.3-3.1 1.6-5.4 3.8-7.1-.3 3.5 3.2 5.5 3.2 10.6 0 4.6-2.8 7.4-6.8 7.4z"/><path d="M12 21c-1.6 0-2.6-1.1-2.6-2.6 0-1.8 1.5-2.6 2-4.2 1.2 1.1 3.2 2.3 3.2 4.3 0 1.4-1.1 2.5-2.6 2.5z"/>',
    thunder: '<path d="M7 13.5a4 4 0 0 1 .4-8 5 5 0 0 1 9.6 1.4 3.3 3.3 0 0 1 .4 6.6"/><path d="M12.6 11.5l-2.6 4.2h3.2l-2.2 4.8"/>'
  };
  var SUBS = { brown: "deep rumble", pink: "soft and even", white: "bright hiss", fan: "whir and hum", waves: "slow swells", fire: "crackles and pops", thunder: "now and then" };
  function rainWord(v) { return v <= 0 ? "light to heavy" : v <= 20 ? "drizzle" : v <= 40 ? "light" : v <= 65 ? "steady" : v <= 85 ? "heavy" : "downpour"; }

  var rows = {};
  (function buildMixer() {
    var host = $("mixer"), group = null;
    LAYERS.forEach(function (L) {
      if (L.group !== group) {
        group = L.group;
        var h = document.createElement("p"); h.className = "mixer__group";
        h.textContent = group === "noise" ? "Noise colors" : "Places and weather";
        host.appendChild(h);
      }
      var row = document.createElement("div");
      row.className = "layer"; row.style.setProperty("--c", "var(--c-" + L.id + ")");
      var id = "lv-" + L.id;
      row.innerHTML =
        '<span class="layer__icon" aria-hidden="true"><svg viewBox="0 0 24 24">' + ICONS[L.id] + "</svg></span>" +
        '<label class="layer__name" for="' + id + '"><b>' + L.name + "</b><small></small></label>" +
        '<input type="range" id="' + id + '" min="0" max="100" step="1" value="0" />' +
        '<span class="layer__val" aria-hidden="true">0</span>';
      host.appendChild(row);
      var input = row.querySelector("input");
      input.style.setProperty("--c", "var(--c-" + L.id + ")");
      rows[L.id] = { row: row, input: input, sub: row.querySelector("small"), val: row.querySelector(".layer__val") };
      input.addEventListener("input", function () {
        stopTween();
        var was = mix[L.id];
        mix[L.id] = SL.clamp(parseInt(input.value, 10) || 0, 0, 100);
        sharedLabel = false;
        if ((was === 0) !== (mix[L.id] === 0)) bump(L.id);
        mixChanged();
      });
    });
  })();
  function bump(id) {
    var r = rows[id].row; r.classList.remove("is-bump"); void r.offsetWidth; r.classList.add("is-bump");
    setTimeout(function () { r.classList.remove("is-bump"); }, 320);
  }

  (function buildPresets() {
    var host = $("presets");
    SL.PRESETS.forEach(function (p) {
      var b = document.createElement("button");
      b.type = "button"; b.className = "chip"; b.dataset.preset = p.id; b.setAttribute("aria-pressed", "false");
      var dots = "";
      LAYERS.filter(function (L) { return p.mix[L.id] > 0; })
        .sort(function (a, c) { return p.mix[c.id] - p.mix[a.id]; }).slice(0, 3)
        .forEach(function (L) { dots += '<i style="background:var(--c-' + L.id + ')"></i>'; });
      b.innerHTML = '<span class="chip__dots" aria-hidden="true">' + dots + "</span>" + p.name;
      b.addEventListener("click", function () {
        sharedLabel = false;
        tweenTo(p.mix);
        ga("sleep_preset", { preset_name: p.id });
      });
      host.appendChild(b);
    });
  })();

  (function buildTimer() {
    var sel = $("timerSel");
    SL.TIMERS.forEach(function (t) {
      var o = document.createElement("option"); o.value = t.id;
      o.textContent = t.id === "off" ? "No timer" : t.label;
      sel.appendChild(o);
    });
    sel.value = timerId;
    $("morningIn").value = morning;
  })();

  // ---------- mix changes ----------
  function levelsArr() { return LAYERS.map(function (L) { return mix[L.id] / 100; }); }
  var saveT = null;
  function mixChanged(skipSave) {
    LAYERS.forEach(function (L) {
      var r = rows[L.id], v = mix[L.id];
      if (+r.input.value !== v) r.input.value = v;
      r.input.style.setProperty("--p", v + "%");
      r.val.textContent = v;
      r.row.classList.toggle("is-on", v > 0);
      r.sub.textContent = L.id === "rain" ? rainWord(v) : SUBS[L.id];
    });
    if (node) node.port.postMessage({ levels: levelsArr() });
    else if (spNode && spEngine) spEngine.setLevels(levelsArr());
    names();
    scene.setMix(mix);
    $("scene").setAttribute("aria-label", sceneWords());
    if (!skipSave) { clearTimeout(saveT); saveT = setTimeout(function () { store("mix", SL.encodeMix(mix)); }, 300); }
    shareSync();
  }
  // what the window shows, for screen readers
  function sceneWords() {
    var w = [];
    if (mix.rain > 0) w.push(mix.rain > 72 ? "heavy rain streaming down the glass" : "rain on the glass");
    w.push(mix.waves > 0 ? "waves breaking under the moon" : "a calm sea under the moon");
    if (mix.thunder > 0) w.push("storm clouds that light up before each roll of thunder");
    if (mix.fire > 0) w.push("firelight flickering in the room");
    if (mix.fan > 0) w.push("a box fan spinning");
    return "A window at night: " + w.join(", ") + ".";
  }
  function currentName() {
    var p = SL.matchPreset(mix);
    if (SL.isSilent(mix)) return "Silence";
    if (p) return p.name;
    return sharedLabel ? "A shared mix" : "Your own mix";
  }
  var lastName = "";
  function names() {
    var n = currentName(), h = $("mixName");
    if (n !== lastName) {
      lastName = n;
      if (reduce) h.textContent = n;
      else { h.style.opacity = "0"; setTimeout(function () { h.textContent = n; h.style.opacity = "1"; }, 160); }
    }
    $("mixWords").textContent = SL.isSilent(mix) ? "Raise a slider to start a mix" : SL.describe(mix);
    var p = SL.matchPreset(mix);
    var chips = document.querySelectorAll(".chip");
    for (var i = 0; i < chips.length; i++) chips[i].setAttribute("aria-pressed", p && chips[i].dataset.preset === p.id ? "true" : "false");
    if (playing) media("playing");
  }

  // presets glide the sliders instead of jumping
  var tween = null;
  function stopTween() { if (tween) { cancelAnimationFrame(tween.raf); tween = null; } }
  function tweenTo(target) {
    stopTween();
    var from = {}; LAYERS.forEach(function (L) { from[L.id] = mix[L.id]; });
    if (reduce) { LAYERS.forEach(function (L) { mix[L.id] = target[L.id]; }); mixChanged(); return; }
    var t0 = performance.now(), dur = 650;
    tween = { raf: 0 };
    (function step() {
      var u = Math.min(1, (performance.now() - t0) / dur), e = 1 - Math.pow(1 - u, 3);
      LAYERS.forEach(function (L) { mix[L.id] = Math.round(from[L.id] + (target[L.id] - from[L.id]) * e); });
      mixChanged(u < 1);
      if (u < 1) tween.raf = requestAnimationFrame(step);
      else { tween = null; store("mix", SL.encodeMix(mix)); }
    })();
  }

  $("clearBtn").addEventListener("click", function () { sharedLabel = false; tweenTo(SL.blank()); });
  $("linkBtn").addEventListener("click", function () {
    var btn = this;
    if (SL.isSilent(mix)) { flashBtn(btn, "Turn a sound on first"); return; }
    var url = "https://onepagetoys.com/tools/sleep-sounds/#mix=" + SL.encodeMix(mix);
    function done() { flashBtn(btn, "Link copied"); }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, function () { window.prompt("Copy this link:", url); });
    else window.prompt("Copy this link:", url);
  });
  function flashBtn(btn, msg) {
    var old = btn.dataset.label || btn.textContent; btn.dataset.label = old;
    btn.textContent = msg; clearTimeout(btn._t);
    btn._t = setTimeout(function () { btn.textContent = old; }, 1800);
  }

  // ---------- volume ----------
  var volIn = $("volume");
  volIn.value = volume; volIn.style.setProperty("--p", volume + "%");
  volIn.addEventListener("input", function () {
    volume = SL.clamp(parseInt(volIn.value, 10) || 0, 0, 100);
    volIn.style.setProperty("--p", volume + "%");
    if (volG) volG.gain.setTargetAtTime(SL.volumeGain(volume), ctx.currentTime, 0.08);
    store("vol", volume);
  });

  // =====================================================================
  // Audio
  // =====================================================================
  var ctx = null, node = null, volG = null, fadeG = null, timerG = null, ready = null;
  var spNode = null, spEngine = null;

  // Smooth room/sky impulse: lowpassed noise so the tail is not grainy, the
  // highs dying faster than the lows (air and soft surfaces eat treble first),
  // a few early reflections, and the sub removed so it never muddies.
  function makeIR(ac, secs) {
    var sr = ac.sampleRate, len = Math.floor(sr * secs), buf = ac.createBuffer(2, len, sr);
    for (var ch = 0; ch < 2; ch++) {
      var d = buf.getChannelData(ch), lp = 0, dc = 0, seed = ch ? 0x2f6b : 0x91c3;
      for (var i = 0; i < len; i++) {
        var t = i / sr;
        var a = 0.5 * Math.exp(-t / 0.55) + 0.05;               // the lowpass closes as it decays
        lp += a * (Math.random() * 2 - 1 - lp);
        dc += (lp - dc) * 0.004;
        var env = Math.exp(-t / (secs / 6.9)) * (t < 0.012 ? t / 0.012 : 1);
        d[i] = (lp - dc) * env;
      }
      var taps = [0.017, 0.029, 0.041, 0.058, 0.077];
      for (var k = 0; k < taps.length; k++) { var j = Math.floor((taps[k] + ch * 0.0031 * k) * sr); if (j < len) d[j] += (0.55 - k * 0.08) * (k % 2 ? -1 : 1); }
      var e = 0; for (i = 0; i < len; i++) { if (!isFinite(d[i])) d[i] = 0; e += d[i] * d[i]; }
      var norm = 1 / Math.sqrt(e + 1e-9);                         // unit energy: the wet path is as loud as what is sent
      for (i = 0; i < len; i++) d[i] *= norm;
    }
    return buf;
  }

  // A short near-silent WAV for the keep-alive element (see startKeepAlive).
  function silentWav(secs) {
    var sr = 8000, n = sr * secs, b = new ArrayBuffer(44 + n * 2), v = new DataView(b);
    function s(o, str) { for (var i = 0; i < str.length; i++) v.setUint8(o + i, str.charCodeAt(i)); }
    s(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); s(8, "WAVE"); s(12, "fmt ");
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    s(36, "data"); v.setUint32(40, n * 2, true);
    for (var i = 0; i < n; i++) v.setInt16(44 + i * 2, (Math.random() * 3 | 0) - 1, true);   // +-1 LSB, about -90 dB
    return new Blob([b], { type: "audio/wav" });
  }

  // iPhone Safari only keeps a page's audio alive with the screen locked when
  // the page holds a "playback" audio session AND has a media element actually
  // playing. Routing Web Audio into an <audio> element through a MediaStream
  // does not help (WebKit still suspends the Web Audio side), so instead a tiny
  // near-silent WAV loops in a hidden <audio> element, started inside the tap.
  // It also gives the lock screen and Android's notification real controls.
  var keep = null, keepURL = null;
  function startKeepAlive() {
    try {
      if (!keep) {
        keep = document.createElement("audio");
        keep.setAttribute("playsinline", ""); keep.playsInline = true; keep.loop = true; keep.preload = "auto";
        keepURL = URL.createObjectURL(silentWav(6));
        keep.src = keepURL; keep.hidden = true; keep.setAttribute("aria-hidden", "true");
        document.body.appendChild(keep);
      }
      var p = keep.play(); if (p && p.catch) p.catch(function () {});
    } catch (e) {}
  }
  function stopKeepAlive() { try { if (keep) keep.pause(); } catch (e) {} }

  function ensureAudio() {
    if (ctx) return ready;
    try { if (navigator.audioSession) navigator.audioSession.type = "playback"; } catch (e) {}
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { say("This browser can't play generated sound. Try a current Chrome, Safari or Firefox."); return null; }
    try { ctx = new AC({ latencyHint: "playback" }); } catch (e) { ctx = new AC(); }
    try { var b = ctx.createBuffer(1, 1, 22050), s0 = ctx.createBufferSource(); s0.buffer = b; s0.connect(ctx.destination); s0.start(0); } catch (e) {}

    volG = ctx.createGain(); volG.gain.value = SL.volumeGain(volume);
    var glue = ctx.createDynamicsCompressor();
    glue.threshold.value = -12; glue.knee.value = 10; glue.ratio.value = 2.5; glue.attack.value = 0.02; glue.release.value = 0.4;
    var wall = ctx.createDynamicsCompressor();
    wall.threshold.value = -1.5; wall.knee.value = 0; wall.ratio.value = 20; wall.attack.value = 0.002; wall.release.value = 0.12;
    fadeG = ctx.createGain(); fadeG.gain.value = 0.0001;
    timerG = ctx.createGain(); timerG.gain.value = 1;
    // last line of defense: a compressor's attack lets a transient overshoot,
    // so a soft clipper (exactly linear below 0.6) keeps everything under 0 dBFS
    var safe = ctx.createWaveShaper(), cn = 2049, curve = new Float32Array(cn);
    for (var ci = 0; ci < cn; ci++) { var xv = ci / (cn - 1) * 2 - 1, ax = Math.abs(xv); curve[ci] = ax <= 0.6 ? xv : (xv < 0 ? -1 : 1) * (0.6 + 0.38 * Math.tanh((ax - 0.6) / 0.38)); }
    safe.curve = curve; safe.oversample = "2x";
    volG.connect(glue); glue.connect(wall); wall.connect(safe); safe.connect(fadeG); fadeG.connect(timerG); timerG.connect(ctx.destination);

    var conv = ctx.createConvolver(); conv.normalize = false; conv.buffer = makeIR(ctx, 3.6);
    var hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 45;
    var wet = ctx.createGain(); wet.gain.value = 0.8;
    conv.connect(hp); hp.connect(wet); wet.connect(volG);

    ctx.onstatechange = function () {
      if (ctx.state === "running" && playing) applyTimer();
      else if (playing && ctx.state !== "running" && !document.hidden) ctx.resume().catch(function () {});
    };

    if (ctx.audioWorklet && window.AudioWorkletNode) {
      ready = ctx.audioWorklet.addModule("engine.js?v=1").then(function () {
        node = new AudioWorkletNode(ctx, "sleep-sounds", {
          numberOfInputs: 0, numberOfOutputs: 2, outputChannelCount: [2, 2],
          processorOptions: { seed: (Math.random() * 4294967295) >>> 0, levels: levelsArr() }
        });
        node.connect(volG, 0); node.connect(conv, 1);
        node.port.onmessage = function (ev) { onEngine(ev.data); };
        node.port.postMessage({ vis: !document.hidden });
      });
    } else {
      // Older browsers: the same engine on the main thread. No reverb send and
      // it pauses with the tab, but it plays.
      ready = new Promise(function (res, rej) {
        var sc = document.createElement("script"); sc.src = "engine.js?v=1";
        sc.onload = function () {
          if (!window.SleepEngine) return rej(new Error("no engine"));
          spEngine = new window.SleepEngine(ctx.sampleRate, (Math.random() * 4294967295) >>> 0);
          spEngine.setNow(levelsArr());
          spNode = ctx.createScriptProcessor(2048, 1, 2);
          var sl = new Float32Array(128), sr2 = new Float32Array(128);
          spNode.onaudioprocess = function (ev) {
            var L = ev.outputBuffer.getChannelData(0), R = ev.outputBuffer.getChannelData(1);
            for (var o = 0; o < L.length; o += 128) {
              var a = L.subarray(o, o + 128), b2 = R.subarray(o, o + 128);
              a.fill(0); b2.fill(0); sl.fill(0); sr2.fill(0);
              spEngine.process(a, b2, sl, sr2);
              for (var i = 0; i < 128; i++) { a[i] += sl[i] * 0.35; b2[i] += sr2[i] * 0.35; }
            }
            var ms = spEngine.msgs; for (var k = 0; k < ms.length; k++) onEngine(ms[k]); ms.length = 0;
          };
          spNode.connect(volG);
          res();
        };
        sc.onerror = rej;
        document.head.appendChild(sc);
      });
    }
    ready = ready.catch(function (e) {
      say("The sound engine could not start in this browser.");
      throw e;
    });
    return ready;
  }

  function onEngine(m) {
    if (!m) return;
    if (m.t === "s") scene.feed(m);
    else if (m.t === "flash") scene.flash(m);
  }

  // ---- play / pause ----
  var suspendT = null, fadeStart = 0, runStart = 0;
  function play() {
    if (playing) return;
    if (SL.isSilent(mix)) tweenTo(SL.DEFAULT_MIX);                      // play on silence: give them the default
    startKeepAlive();                                                  // must happen inside the tap, before any wait
    var r = ensureAudio(); if (!r) return;
    clearTimeout(suspendT);
    if (ctx.state !== "running") ctx.resume().catch(function () {});
    playing = true; runStart = Date.now();
    playUI();
    r.then(function () {
      if (!playing) return;
      if (node) node.port.postMessage({ levels: levelsArr() });
      var now = ctx.currentTime, g = fadeG.gain, cur = Math.max(0.0001, g.value);
      g.cancelScheduledValues(now);
      if (cur < 0.02) { g.setValueAtTime(0.0001, now); g.setValueCurveAtTime(SL.fadeInCurve(256), now + 0.01, 8); fadeStart = Date.now(); }
      else { g.setValueAtTime(cur, now); g.linearRampToValueAtTime(1, now + 8 * (1 - Math.sqrt(cur))); fadeStart = Date.now() - 8000 * Math.sqrt(cur); }
      startTimer();
      wake(); media("playing");
      if (!playedOnce) { playedOnce = true; ga("sleep_play", { mix_name: (SL.matchPreset(mix) || { id: "custom" }).id }); }
    }, function () { playing = false; playUI(); });
  }
  var playedOnce = false;

  function pause(why) {
    if (!playing) return;
    playing = false;
    endMs = null; clearTimeout(doneT);
    if (ctx && fadeG) {
      var now = ctx.currentTime, g = fadeG.gain, cur = Math.max(0.0001, g.value);
      g.cancelScheduledValues(now); g.setValueAtTime(cur, now); g.exponentialRampToValueAtTime(0.0001, now + 1.2);
      clearTimeout(suspendT);
      suspendT = setTimeout(function () {
        if (playing) return;
        try { timerG.gain.cancelScheduledValues(ctx.currentTime); timerG.gain.setValueAtTime(1, ctx.currentTime); } catch (e) {}
        if (node) node.port.postMessage({ stopAt: null });
        ctx.suspend().catch(function () {});
        stopKeepAlive();
      }, 1400);
    }
    unwake(); media("paused");
    playUI(why);
  }

  function playUI(why) {
    var b = $("playBtn");
    b.classList.toggle("is-on", playing);
    b.setAttribute("aria-pressed", playing ? "true" : "false");
    b.setAttribute("aria-label", playing ? "Pause" : "Play");
    if (why) say(why); else say(playing ? "Playing " + currentName() + "." : "Paused.");
    tick();
  }
  $("playBtn").addEventListener("click", function () { if (playing) pause(); else play(); });
  document.addEventListener("keydown", function (e) {
    if (e.key === " " && (e.target === document.body || e.target === document.documentElement)) { e.preventDefault(); if (playing) pause(); else play(); }
  });

  // ---- sleep timer ----
  var endMs = null, fadeSec = 0, doneT = null;
  function startTimer() {
    clearTimeout(doneT);
    if (timerId === "off" || !playing) {
      endMs = null;
      if (ctx && timerG) { var n = ctx.currentTime; timerG.gain.cancelScheduledValues(n); timerG.gain.setValueAtTime(timerG.gain.value, n); timerG.gain.linearRampToValueAtTime(1, n + 1.5); }
      if (node) node.port.postMessage({ stopAt: null });
      tick(); return;
    }
    var now = Date.now();
    endMs = SL.timerEnd(timerId, now, morning);
    var total = (endMs - now) / 1000;
    fadeSec = Math.min(SL.fadeLength(total), Math.max(30, total * 0.9));
    applyTimer();
    tick();
  }
  // Schedule the fade on the audio clock from the WALL clock, so it is right
  // even after the context was suspended or the page slept. AudioParam
  // automation runs on the audio thread: it fades on time with the screen
  // locked, when page timers may not run at all.
  function applyTimer() {
    if (!ctx || !timerG || !endMs || !playing) return;
    var now = ctx.currentTime, nowMs = Date.now(), left = (endMs - nowMs) / 1000, g = timerG.gain;
    clearTimeout(doneT);
    if (left <= 0) { timerDone(); return; }
    g.cancelScheduledValues(now);
    var g0 = SL.timerGainAt(nowMs, endMs, fadeSec);
    g.setValueAtTime(g0, now);
    if (left > fadeSec) {
      g.setValueAtTime(1, now + (left - fadeSec));
      g.setValueCurveAtTime(SL.timerCurve(600), now + (left - fadeSec) + 0.001, fadeSec);
    } else {
      var x0 = 1 - left / fadeSec, n = 400, c = new Float32Array(n);
      for (var i = 0; i < n; i++) c[i] = SL.timerGain(x0 + (1 - x0) * i / (n - 1));
      g.setValueCurveAtTime(c, now + 0.02, Math.max(0.05, left - 0.02));
    }
    if (node) node.port.postMessage({ stopAt: now + left + 1 });
    doneT = setTimeout(timerDone, left * 1000 + 1200);
  }
  function timerDone() {
    if (!playing) return;
    var t = new Date();
    pause("The timer ended at " + clockText(t) + ". Sleep well.");
    $("dimLine").textContent = "Faded out at " + clockText(t);
    $("nightState").textContent = "Faded out at " + clockText(t);
  }
  $("timerSel").addEventListener("change", function () {
    timerId = this.value; store("timer", timerId);
    $("morningRow").hidden = timerId !== "morning";
    if (playing) startTimer(); else tick();
    if (timerId !== "off") ga("sleep_timer", { timer_choice: timerId });
  });
  $("morningIn").addEventListener("change", function () {
    if (/^\d{1,2}:\d{2}$/.test(this.value)) { morning = this.value; store("morning", morning); if (playing && timerId === "morning") startTimer(); else tick(); }
  });
  $("morningRow").hidden = timerId !== "morning";

  // ---- the once-a-second line under the play button, the clock, the ring ----
  function clockText(d) { return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); }
  var RING = 289.03;
  function tick() {
    var now = Date.now(), d = new Date(now), ct = clockText(d);
    $("clock").textContent = ct; $("dimClock").textContent = ct;
    var line, state, ring = 0;
    if (playing && endMs) {
      var left = (endMs - now) / 1000;
      if (left <= 0) { timerDone(); return; }
      var at = clockText(new Date(endMs));
      line = left <= fadeSec ? "Fading out now. Silent at " + at + "." : "Fades out slowly, silent at " + at + ".";
      state = SL.fmtLeft(left) + " left";
      var total = Math.max(1, (endMs - runStart) / 1000);
      ring = Math.max(0, Math.min(1, left / total));
    } else if (playing) {
      line = "Timer off. Plays until you stop it.";
      state = "Playing";
      ring = 1;
    } else {
      if (timerId === "off") line = "Timer off. Plays until you stop it.";
      else if (timerId === "morning") line = "Will fade out by " + clockText(SL.nextMorning(d, morning)) + " once you press play.";
      else line = "The " + SL.TIMERS.filter(function (t) { return t.id === timerId; })[0].label + " timer starts when you press play.";
      state = $("nightState").textContent.indexOf("Faded out") === 0 ? $("nightState").textContent : "Paused";
    }
    if (playing) {
      var fu = Math.min(1, (now - fadeStart) / 8000);
      if (fu < 1) { ring = fu * fu; state = "Fading in"; }
    }
    $("timerLine").textContent = line;
    $("nightState").textContent = state;
    if (playing) $("dimLine").textContent = endMs ? state + ", silent at " + clockText(new Date(endMs)) : "Tap to brighten";
    $("playRing").style.strokeDashoffset = String(RING * (1 - ring));
  }
  setInterval(tick, 1000);

  // ---- wake lock ----
  var lock = null;
  function wake() {
    if (!keepAwake || !playing || lock || document.hidden || !navigator.wakeLock) return;
    navigator.wakeLock.request("screen").then(function (l) {
      lock = l; l.addEventListener("release", function () { lock = null; });
      if (!playing) unwake();
    }).catch(function () {});
  }
  function unwake() { if (lock) { try { lock.release(); } catch (e) {} lock = null; } }
  var awakeIn = $("awake");
  awakeIn.checked = keepAwake;
  awakeIn.addEventListener("change", function () { keepAwake = awakeIn.checked; store("awake", keepAwake ? "1" : "0"); if (keepAwake) wake(); else unwake(); });

  // ---- lock screen / notification controls ----
  var artURL = null;
  function media(state) {
    if (!("mediaSession" in navigator)) return;
    try {
      var art = [{ src: new URL("../../assets/apple-touch-icon.png?v=2", location.href).href, sizes: "180x180", type: "image/png" }];
      if (artURL) art.unshift({ src: artURL, sizes: "512x512", type: "image/png" });
      navigator.mediaSession.metadata = new MediaMetadata({ title: currentName(), artist: SL.isSilent(mix) ? "Sleep Sounds" : SL.describe(mix), album: "Sleep Sounds, One Page Toys", artwork: art });
      navigator.mediaSession.playbackState = state;
    } catch (e) {}
  }
  function makeArt() {
    try {
      var c = document.createElement("canvas"); c.width = c.height = 512;
      var src = scene.canvas, s = Math.min(src.width, src.height);
      c.getContext("2d").drawImage(src, (src.width - s) / 2, (src.height - s) / 2, s, s, 0, 0, 512, 512);
      c.toBlob(function (b) { if (!b) return; if (artURL) URL.revokeObjectURL(artURL); artURL = URL.createObjectURL(b); if (playing) media("playing"); }, "image/png");
    } catch (e) {}
  }
  if ("mediaSession" in navigator) {
    try {
      navigator.mediaSession.setActionHandler("play", function () { play(); });
      navigator.mediaSession.setActionHandler("pause", function () { pause(); });
      navigator.mediaSession.setActionHandler("stop", function () { pause(); });
    } catch (e) {}
  }

  // ---- background / foreground ----
  document.addEventListener("visibilitychange", function () {
    var vis = !document.hidden;
    if (node) node.port.postMessage({ vis: vis });
    if (vis) {
      if (playing && ctx && ctx.state !== "running") ctx.resume().catch(function () {});
      if (playing) { applyTimer(); wake(); }
      tick();
      scene.wake();
    }
  });

  function say(msg) { var l = $("live"); l.textContent = ""; setTimeout(function () { l.textContent = msg; }, 30); }

  // ---------- dim ----------
  var themeMeta = document.querySelector('meta[name="theme-color"]');
  function syncThemeColor() {
    if (!themeMeta) return;
    themeMeta.setAttribute("content", dim ? "#000000" : getComputedStyle(document.body).backgroundColor || "#e9ebf1");
  }
  new MutationObserver(syncThemeColor).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  function setDim(on) {
    dim = on;
    var d = $("dimmer");
    // nothing behind the dark screen can take focus while it is up
    [document.querySelector("main"), document.querySelector(".topbar")].forEach(function (el) { if (el) el.inert = on; });
    if (on) {
      d.hidden = false; void d.offsetWidth; d.classList.add("is-on");
      document.body.classList.add("is-dim");
      setTimeout(function () { if (dim) $("dimWake").focus({ preventScroll: true }); }, 50);
      ga("sleep_dim");
    } else {
      d.classList.remove("is-on"); document.body.classList.remove("is-dim");
      setTimeout(function () { if (!dim) d.hidden = true; }, reduce ? 0 : 500);
      $("dimBtn").focus({ preventScroll: true });
      scene.wake();
    }
    syncThemeColor();
    tick();
  }
  $("dimBtn").addEventListener("click", function () { setDim(true); });
  $("dimWake").addEventListener("click", function () { setDim(false); });
  document.addEventListener("keydown", function (e) { if (dim && (e.key === "Escape" || e.key === "Enter")) { e.preventDefault(); setDim(false); } });

  // ---------- share ----------
  function shareSync() {
    if (SL.isSilent(mix)) { window.OPT_SHARE_TEXT = null; window.OPT_SHARE_LINE = null; window.OPT_SHARE_IMAGE = null; return; }
    var words = SL.describe(mix).toLowerCase(), p = SL.matchPreset(mix);
    var url = "https://onepagetoys.com/tools/sleep-sounds/#mix=" + SL.encodeMix(mix);
    window.OPT_SHARE_TEXT = "Falling asleep to " + words + (p ? " (" + p.name + ")" : "") + ". Here is my mix: " + url;
    window.OPT_SHARE_LINE = (p ? p.name + ": " : "") + SL.describe(mix);
    if (!window.OPT_SHARE_IMAGE) window.OPT_SHARE_IMAGE = function () { scene.drawNow(); return scene.canvas; };
  }

  // =====================================================================
  // The night window
  // =====================================================================
  var scene = (function () {
    var cv = $("scene"), cx = cv.getContext("2d");
    var W = 0, H = 0, DPR = 1, geo = null, room = null, fanFront = null, fanBack = null, vign = null, beadImg = null, clouds = null, land = null;
    var lv = SL.blank(), tg = SL.blank();               // eased visual levels 0..1, and their targets
    var stars = [], glitter = [], streaks = [], beads = [], runners = [];
    var flashes = [], engineWaves = null, engineAt = -9, fireGlow = 1, fireFlash = 0, gust = 1;
    var localWaves = [], nextLocal = 1.5, fanAng = 0.4, fanSpin = 0, t = 0, last = 0, running = false, fdt = 0, first = true;
    var grains = [], grainOff = [0, 0, 0], grainT = 0;
    function R(a, b) { return a + Math.random() * (b - a); }

    function layout() {
      var rect = cv.getBoundingClientRect();
      var nW = Math.max(200, rect.width), nH = Math.max(200, rect.height), nD = Math.min(window.devicePixelRatio || 1, 2);
      if (geo && Math.abs(nW - W) < 1 && Math.abs(nH - H) < 1 && nD === DPR) return false;
      var oldW = W, oldH = H;
      W = nW; H = nH; DPR = nD;
      cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
      cx.setTransform(DPR, 0, 0, DPR, 0, 0);
      var t0 = Math.max(9, W * 0.032);
      var gx = W * 0.17, gw = W * 0.66, gy = H * 0.095, gh = H * 0.585;
      var mw = Math.max(3, W * 0.011);
      var panes = [];
      for (var r = 0; r < 3; r++) for (var c = 0; c < 2; c++) {
        panes.push({ x: gx + c * (gw + mw) / 2, y: gy + r * (gh + mw) / 3, w: (gw - mw) / 2, h: (gh - 2 * mw) / 3 });
      }
      geo = {
        gx: gx, gy: gy, gw: gw, gh: gh, t: t0, mw: mw, panes: panes,
        hy: gy + gh * 0.5, breakY: gy + gh * 0.8, shoreY: gy + gh * 1.0,
        sillY: gy + gh + t0, sillH: Math.max(10, H * 0.034), sillX: gx - t0 - W * 0.045, sillW: gw + 2 * t0 + W * 0.09,
        mx: gx + gw * 0.72, my: gy + gh * 0.19, mr: Math.max(7, W * 0.03),
        lx: gx + gw * 0.235, fx: W * 0.84, fy: H * 0.9, fs: Math.min(W, H) * 0.38
      };
      // the drops on the glass survive a resize: move them with the glass
      if (oldW && beads.length) {
        var kx = W / oldW, ky = H / oldH;
        beads.forEach(function (b) { b.x *= kx; b.y *= ky; b.p = paneAt(b.x, b.y) || panes[0]; });
        runners = [];
      }
      seed();
      buildRoom(); buildFan(); buildVignette(); buildBead(); buildGrain(); buildClouds(); buildLand();
      return true;
    }
    function seed() {
      var g = geo, i;
      stars = []; for (i = 0; i < 52; i++) stars.push({ x: g.gx + Math.random() * g.gw, y: g.gy + Math.pow(Math.random(), 1.3) * (g.hy - g.gy) * 0.92, r: R(0.5, 1.3), p: R(0, 6.28), s: R(0.3, 1.2) });
      glitter = []; for (i = 0; i < 90; i++) { var u = Math.pow(Math.random(), 0.75), sp = (0.015 + u * 0.15) * g.gw; glitter.push({ x: g.mx + (Math.random() - 0.5) * 2 * sp * Math.random(), y: g.hy + 2 + u * (g.shoreY - g.hy - 4), w: R(2, 8) * (0.5 + u), p: R(0, 6.28), s: R(0.6, 2) }); }
      streaks = []; for (i = 0; i < 130; i++) streaks.push({ x: Math.random(), y: Math.random(), l: R(0.5, 1), v: R(0.8, 1.2), a: R(0.5, 1) });
    }

    // the room: wall, casing, muntins, sill. The panes are cut out so the
    // night outside and the drops on the glass show through.
    function buildRoom() {
      var g = geo, c = document.createElement("canvas"); c.width = cv.width; c.height = cv.height;
      var x = c.getContext("2d"), i, p; x.setTransform(DPR, 0, 0, DPR, 0, 0);
      var wall = x.createLinearGradient(0, 0, 0, H);
      wall.addColorStop(0, "#0d1018"); wall.addColorStop(1, "#07080d");
      x.fillStyle = wall; x.fillRect(0, 0, W, H);
      for (i = 0; i < W * H / 50; i++) { x.fillStyle = "rgba(255,255,255," + (Math.random() * 0.016).toFixed(3) + ")"; x.fillRect(Math.random() * W, Math.random() * H, 1, 1); }
      // moonlight falling on the wall and sill from the window
      var ml = x.createRadialGradient(g.gx + g.gw / 2, g.gy + g.gh * 0.55, g.gw * 0.25, g.gx + g.gw / 2, g.gy + g.gh * 0.55, g.gw * 1.0);
      ml.addColorStop(0, "rgba(110,130,185,0.12)"); ml.addColorStop(1, "rgba(110,130,185,0)");
      x.fillStyle = ml; x.fillRect(0, 0, W, H);
      var t0 = g.t;
      x.fillStyle = "#121722"; x.fillRect(g.gx - t0, g.gy - t0, g.gw + 2 * t0, g.gh + 2 * t0);
      // the casing's inner edge catches the moonlight
      x.strokeStyle = "rgba(150,170,225,0.16)"; x.lineWidth = 1.2; x.strokeRect(g.gx - 1.5, g.gy - 1.5, g.gw + 3, g.gh + 3);
      x.strokeStyle = "rgba(0,0,0,0.6)"; x.lineWidth = 1; x.strokeRect(g.gx - t0 + 0.5, g.gy - t0 + 0.5, g.gw + 2 * t0 - 1, g.gh + 2 * t0 - 1);
      // sill: top face lit by the window, front in shadow
      x.fillStyle = "#151b28"; x.fillRect(g.sillX, g.sillY - 2, g.sillW, g.sillH);
      var st = x.createLinearGradient(0, g.sillY - 2, 0, g.sillY + g.sillH * 0.5);
      st.addColorStop(0, "rgba(160,180,235,0.24)"); st.addColorStop(1, "rgba(160,180,235,0)");
      x.fillStyle = st; x.fillRect(g.gx - t0, g.sillY - 2, g.gw + 2 * t0, g.sillH * 0.5);
      x.fillStyle = "#0c1018"; x.fillRect(g.sillX + W * 0.02, g.sillY + g.sillH - 2, g.sillW - W * 0.04, g.sillH * 0.7);
      x.globalCompositeOperation = "destination-out";
      for (i = 0; i < g.panes.length; i++) { p = g.panes[i]; x.fillRect(p.x, p.y, p.w, p.h); }
      x.globalCompositeOperation = "source-over";
      x.fillStyle = "rgba(150,170,225,0.10)";
      for (i = 0; i < g.panes.length; i++) { p = g.panes[i]; x.fillRect(p.x, p.y + p.h, p.w, 1); x.fillRect(p.x + p.w, p.y, 1, p.h); }
      room = c;
    }

    // a deck of soft cloud, drawn once twice over (dark, and lit from inside
    // for lightning), tiling sideways so it can drift forever
    function buildClouds() {
      var g = geo, w = Math.ceil(g.gw * 2), h = Math.ceil(g.hy - g.gy + 4), k = DPR * 0.5;
      var dark = document.createElement("canvas"), lit = document.createElement("canvas");
      dark.width = lit.width = Math.ceil(w * k); dark.height = lit.height = Math.ceil(h * k);
      var a = dark.getContext("2d"), b = lit.getContext("2d"); a.scale(k, k); b.scale(k, k);
      for (var i = 0; i < 170; i++) {
        var py = Math.pow(Math.random(), 0.7) * h, px = Math.random() * w, r = R(0.05, 0.15) * g.gw * (0.6 + 0.7 * py / h), lum = R(0.7, 1.15);
        for (var o = -1; o <= 1; o++) {
          var qx = px + o * w; if (qx + r < 0 || qx - r > w) continue;
          var ga = a.createRadialGradient(qx, py, 0, qx, py, r);
          ga.addColorStop(0, "rgba(" + (34 * lum | 0) + "," + (42 * lum | 0) + "," + (60 * lum | 0) + ",0.55)"); ga.addColorStop(1, "rgba(30,38,54,0)");
          a.fillStyle = ga; a.fillRect(qx - r, py - r, 2 * r, 2 * r);
          var gb = b.createRadialGradient(qx, py, 0, qx, py, r);
          gb.addColorStop(0, "rgba(190,200,255," + (0.3 * lum).toFixed(3) + ")"); gb.addColorStop(1, "rgba(190,200,255,0)");
          b.fillStyle = gb; b.fillRect(qx - r, py - r, 2 * r, 2 * r);
        }
      }
      clouds = { dark: dark, lit: lit, w: w, h: h, off: Math.random() * w };
    }
    // a low headland on the far left of the horizon, with a lighthouse
    function buildLand() {
      var g = geo, pts = [], n = 40, x0 = g.gx - 2, x1 = g.gx + g.gw * 0.36;
      for (var i = 0; i <= n; i++) {
        var u = i / n, xx = x0 + (x1 - x0) * u;
        var hh = g.gh * (0.05 * Math.pow(1 - u, 0.6) * (1 - Math.pow(u, 3)) + 0.006 * Math.sin(u * 23) + 0.004 * Math.sin(u * 51));
        pts.push([xx, g.hy - Math.max(0, hh)]);
      }
      land = pts;
    }

    function buildFan() {
      var g = geo, s = g.fs, n = Math.ceil(s * DPR);
      var b = document.createElement("canvas"); b.width = b.height = n;
      var x = b.getContext("2d"); x.setTransform(DPR, 0, 0, DPR, 0, 0);
      rr(x, 0, 0, s, s, s * 0.08); x.fillStyle = "#11151e"; x.fill();
      x.beginPath(); x.arc(s / 2, s / 2, s * 0.43, 0, 6.283); x.fillStyle = "#05070b"; x.fill();
      fanBack = b;
      var f = document.createElement("canvas"); f.width = f.height = n;
      x = f.getContext("2d"); x.setTransform(DPR, 0, 0, DPR, 0, 0);
      x.strokeStyle = "rgba(140,155,195,0.2)"; x.lineWidth = Math.max(0.8, s * 0.006);
      for (var r = 0.1; r <= 0.43; r += 0.055) { x.beginPath(); x.arc(s / 2, s / 2, s * r, 0, 6.283); x.stroke(); }
      for (var a = 0; a < 16; a++) { var an = a / 16 * 6.283; x.beginPath(); x.moveTo(s / 2 + Math.cos(an) * s * 0.1, s / 2 + Math.sin(an) * s * 0.1); x.lineTo(s / 2 + Math.cos(an) * s * 0.43, s / 2 + Math.sin(an) * s * 0.43); x.stroke(); }
      x.beginPath(); x.arc(s / 2, s / 2, s * 0.07, 0, 6.283); x.fillStyle = "#181e2a"; x.fill();
      x.strokeStyle = "rgba(160,180,235,0.16)"; x.lineWidth = 1.5; rr(x, 1, 1, s - 2, s - 2, s * 0.08); x.stroke();
      x.beginPath(); x.arc(s * 0.88, s * 0.12, s * 0.035, 0, 6.283); x.fillStyle = "#1d2433"; x.fill();
      fanFront = f;
    }
    function rr(x, a, b, w, h, r) { x.beginPath(); x.moveTo(a + r, b); x.arcTo(a + w, b, a + w, b + h, r); x.arcTo(a + w, b + h, a, b + h, r); x.arcTo(a, b + h, a, b, r); x.arcTo(a, b, a + w, b, r); x.closePath(); }

    function buildVignette() {
      var c = document.createElement("canvas"); c.width = cv.width; c.height = cv.height;
      var x = c.getContext("2d"); x.setTransform(DPR, 0, 0, DPR, 0, 0);
      var v = x.createRadialGradient(W / 2, H * 0.42, Math.min(W, H) * 0.38, W / 2, H * 0.5, Math.max(W, H) * 0.8);
      v.addColorStop(0, "rgba(0,0,0,0)"); v.addColorStop(1, "rgba(0,0,0,0.5)");
      x.fillStyle = v; x.fillRect(0, 0, W, H);
      vign = c;
    }
    // a drop on glass: a dark rim, a lens of brighter refracted sky, a glint
    function buildBead() {
      var n = 48, c = document.createElement("canvas"); c.width = c.height = n;
      var x = c.getContext("2d"), r = n / 2 - 2;
      var body = x.createRadialGradient(n / 2, n / 2 + r * 0.3, r * 0.1, n / 2, n / 2, r);
      body.addColorStop(0, "rgba(200,214,248,0.42)"); body.addColorStop(0.65, "rgba(130,150,200,0.22)"); body.addColorStop(0.92, "rgba(8,12,22,0.55)"); body.addColorStop(1, "rgba(8,12,22,0)");
      x.fillStyle = body; x.beginPath(); x.arc(n / 2, n / 2, r, 0, 6.283); x.fill();
      x.fillStyle = "rgba(240,246,255,0.95)"; x.beginPath(); x.arc(n / 2 - r * 0.32, n / 2 - r * 0.38, r * 0.2, 0, 6.283); x.fill();
      x.fillStyle = "rgba(205,220,255,0.38)"; x.beginPath(); x.ellipse(n / 2 + r * 0.08, n / 2 + r * 0.52, r * 0.52, r * 0.2, 0, 0, 6.283); x.fill();
      beadImg = c;
    }
    // the noise colors as a soft grain, each its own tint and coarseness
    function buildGrain() {
      grains = [["brown", 2.2, [196, 136, 80]], ["pink", 1.5, [222, 148, 172]], ["white", 1, [214, 222, 240]]].map(function (gd) {
        var n = 96, c = document.createElement("canvas"); c.width = c.height = n;
        var x = c.getContext("2d"), img = x.createImageData(n, n);
        for (var i = 0; i < n * n; i++) { var v = Math.random(); img.data[i * 4] = gd[2][0]; img.data[i * 4 + 1] = gd[2][1]; img.data[i * 4 + 2] = gd[2][2]; img.data[i * 4 + 3] = v > 0.55 ? (v - 0.55) / 0.45 * 255 : 0; }
        x.putImageData(img, 0, 0);
        return { id: gd[0], scale: gd[1], pat: cx.createPattern(c, "repeat") };
      });
    }

    // ---- inputs ----
    function setMix(m) {
      LAYERS.forEach(function (L) { tg[L.id] = m[L.id] / 100; });
      if (first) { first = false; snap(); }                 // the glass is already wet when the page opens
      if (reduce) { snap(); drawNow(); } else wake();
    }
    function snap() { LAYERS.forEach(function (L) { lv[L.id] = tg[L.id]; }); fanSpin = tg.fan > 0 ? 1 : 0; settleBeads(); }
    function feed(m) {
      if (m.w) { engineWaves = m.w; engineAt = t; }
      if (m.f !== undefined) fireGlow = 0.65 + 0.55 * m.f;
      if (m.fl) fireFlash = Math.max(fireFlash, m.fl);
      if (m.gu) gust = m.gu;
    }
    function flash(m) {
      if (reduce || document.hidden || dim) return;
      var k = (m.size || 0.7) * (1 - 0.45 * (m.d || 0.5));
      flashes.push({ at: t, k: k, near: (m.d || 0.5) < 0.55, x: R(0.3, 0.9), seed: Math.random() });
    }

    // ---- simulation ----
    function update(dt) {
      t += dt;
      LAYERS.forEach(function (L) { lv[L.id] += (tg[L.id] - lv[L.id]) * Math.min(1, dt * 1.6); });
      fanSpin += ((tg.fan > 0 ? 1 : 0) - fanSpin) * Math.min(1, dt * (tg.fan > 0 ? 0.9 : 0.35));
      var w = fanSpin > 0.4 ? 0.45 + fanSpin * 0.25 : fanSpin * 16;        // past a point the eye sees a slow alias
      fanAng += w * dt;
      if (!(playing && engineWaves && t - engineAt < 0.6)) {                 // paused: the picture keeps its own sea
        nextLocal -= dt;
        if (nextLocal <= 0 && lv.waves > 0.02) { localWaves.push({ ph: 0, A: R(2.2, 3.6), D: R(4.5, 8), s: R(0.45, 1.05), pan: R(-0.6, 0.6) }); nextLocal = R(6.5, 12); }
        for (var i = localWaves.length - 1; i >= 0; i--) {
          var q = localWaves[i];
          q.ph += dt / (q.ph < 1 ? q.A : 0.28 + q.D * 1.4);
          if (q.ph > 2) localWaves.splice(i, 1);
        }
      }
      fireFlash *= Math.exp(-dt / 0.15);
      if (clouds) clouds.off = (clouds.off + dt * (3 + 2 * gust)) % clouds.w;
      updateDrops(dt);
      for (i = flashes.length - 1; i >= 0; i--) if (t - flashes[i].at > 1.4) flashes.splice(i, 1);
      grainT += dt;
      if (grainT > 0.085) { grainT = 0; grainOff = [Math.random() * 96, Math.random() * 96, Math.random() * 96]; }
    }

    function paneAt(x, y) { var P = geo.panes; for (var i = 0; i < P.length; i++) { var p = P[i]; if (x >= p.x && x < p.x + p.w && y >= p.y && y < p.y + p.h) return p; } return null; }
    function targetBeads() { return Math.round(Math.pow(lv.rain, 1.1) * geo.gw * geo.gh * 0.0042); }
    function addBead(p, r) {
      p = p || geo.panes[(Math.random() * geo.panes.length) | 0];
      beads.push({ x: p.x + Math.random() * p.w, y: p.y + Math.random() * p.h, r: r || R(0.7, 2.1) * Math.max(1, W / 420), a: 0, p: p });
    }
    function settleBeads() { var n = targetBeads(); while (beads.length < n) { addBead(); beads[beads.length - 1].a = 1; } if (beads.length > n) beads.length = n; }
    function updateDrops(dt) {
      var target = targetBeads(), sc = Math.max(1, W / 420), i;
      // new drops land; old ones dry off when the rain eases
      var landN = lv.rain * 70 * dt * (0.8 + 0.4 * gust);
      while (landN > 0) { if (Math.random() < landN) { if (beads.length < target * 1.1) addBead(); else if (beads.length) { var bb0 = beads[(Math.random() * beads.length) | 0]; bb0.r = Math.min(3.2 * sc, bb0.r * 1.05); } } landN -= 1; }
      if (beads.length > target) { var dry = Math.max(1, (beads.length - target) * dt * 0.4); for (var k = 0; k < dry && beads.length; k++) beads.splice((Math.random() * beads.length) | 0, 1); }
      for (i = 0; i < beads.length; i++) if (beads[i].a < 1) beads[i].a = Math.min(1, beads[i].a + dt * 4);
      // runners: a heavy drop lets go and runs, stick-slip, eating the beads in its path
      if (Math.random() < lv.rain * lv.rain * dt * 1.6 * (geo.gw * geo.gh / 60000) && runners.length < 10 && beads.length) {
        var b = beads[(Math.random() * beads.length) | 0];
        if (b.y < b.p.y + b.p.h * 0.6) runners.push({ x: b.x, y: b.y, r: Math.max(b.r * 1.4, 2.2 * sc), v: 0, p: b.p, go: R(0.1, 0.5), trail: 0 });
      }
      for (i = runners.length - 1; i >= 0; i--) {
        var q = runners[i];
        q.go -= dt;
        if (q.go <= 0) { q.v = q.v > 10 ? 0 : R(30, 110) * sc; q.go = q.v ? R(0.15, 0.6) : R(0.05, 0.3); }
        var dy = q.v * dt;
        q.y += dy; q.x += Math.sin(q.y * 0.09 + q.r) * dy * 0.12;
        q.trail += dy;
        if (q.trail > 5 * sc && Math.random() < 0.6) { q.trail = 0; beads.push({ x: q.x + R(-1, 1), y: q.y - q.r * 1.2, r: R(0.5, 1.1) * sc, a: 1, p: q.p }); }
        for (var j = beads.length - 1; j >= 0; j--) { var bb = beads[j]; if (bb.p === q.p && Math.abs(bb.x - q.x) < q.r && bb.y > q.y && bb.y - q.y < q.r + bb.r) { q.r = Math.min(5 * sc, Math.sqrt(q.r * q.r + bb.r * bb.r * 0.3)); beads.splice(j, 1); } }
        if (q.y > q.p.y + q.p.h - q.r * 0.6) { beads.push({ x: q.x, y: q.p.y + q.p.h - q.r * 0.7, r: q.r * 0.9, a: 1, p: q.p }); runners.splice(i, 1); }
      }
    }

    // ---- drawing ----
    function cover() { return Math.min(1, lv.rain * 1.15 + lv.thunder * 0.75); }
    function lightning() {
      var I = 0;
      for (var i = 0; i < flashes.length; i++) {
        var f = flashes[i], u = t - f.at;
        // one soft flash and a smaller echo a third of a second later: a glow
        // through cloud, never a strobe (two pulses, well under three a second)
        var p = Math.exp(-Math.pow((u - 0.07) / 0.07, 2)) + 0.45 * Math.exp(-Math.pow((u - 0.42) / 0.13, 2));
        I = Math.max(I, p * f.k);
      }
      return Math.min(1, I);
    }
    function mixc(a, b, u) { return "rgb(" + Math.round(a[0] + (b[0] - a[0]) * u) + "," + Math.round(a[1] + (b[1] - a[1]) * u) + "," + Math.round(a[2] + (b[2] - a[2]) * u) + ")"; }

    function draw() {
      var g = geo, x = cx, cv0 = cover(), I = lightning(), i;
      x.save();
      x.beginPath(); x.rect(g.gx, g.gy, g.gw, g.gh); x.clip();
      // sky: the window is the brightest thing in the room, brightest at the horizon
      var sky = x.createLinearGradient(0, g.gy, 0, g.hy);
      sky.addColorStop(0, mixc([12, 22, 46], [14, 18, 27], cv0));
      sky.addColorStop(0.65, mixc([28, 44, 80], [26, 32, 46], cv0));
      sky.addColorStop(1, mixc([52, 72, 112], [44, 52, 68], cv0));
      x.fillStyle = sky; x.fillRect(g.gx, g.gy, g.gw, g.hy - g.gy + 1);
      var sa = (1 - cv0) * 0.95;
      if (sa > 0.02) for (i = 0; i < stars.length; i++) { var s = stars[i]; x.globalAlpha = sa * (0.4 + 0.35 * Math.sin(t * s.s + s.p)); x.fillStyle = "#e4eaff"; x.fillRect(s.x, s.y, s.r, s.r); }
      x.globalAlpha = 1;
      // moon and halo
      var moonA = 1 - 0.82 * cv0;
      var halo = x.createRadialGradient(g.mx, g.my, g.mr * 0.6, g.mx, g.my, g.mr * (6 + 4 * cv0));
      halo.addColorStop(0, "rgba(205,216,255," + (0.34 * moonA + 0.1 * cv0).toFixed(3) + ")"); halo.addColorStop(1, "rgba(205,216,255,0)");
      x.fillStyle = halo; x.fillRect(g.gx, g.gy, g.gw, g.hy - g.gy);
      x.globalAlpha = moonA; x.fillStyle = "#eef1fa"; x.beginPath(); x.arc(g.mx, g.my, g.mr, 0, 6.283); x.fill();
      x.fillStyle = "rgba(175,185,210,0.4)"; x.beginPath(); x.arc(g.mx - g.mr * 0.3, g.my - g.mr * 0.15, g.mr * 0.28, 0, 6.283); x.arc(g.mx + g.mr * 0.25, g.my + g.mr * 0.3, g.mr * 0.18, 0, 6.283); x.fill();
      x.globalAlpha = 1;
      // the cloud deck, and lightning lighting it from inside
      if (cv0 > 0.02 && clouds) {
        var cy0 = g.gy - 2, ox = g.gx - clouds.off;
        x.globalAlpha = Math.min(1, cv0 * 1.05);
        x.drawImage(clouds.dark, ox, cy0, clouds.w, clouds.h); x.drawImage(clouds.dark, ox + clouds.w, cy0, clouds.w, clouds.h);
        if (I > 0.01) {
          x.globalCompositeOperation = "lighter"; x.globalAlpha = Math.min(1, I * 1.2);
          x.drawImage(clouds.lit, ox, cy0, clouds.w, clouds.h); x.drawImage(clouds.lit, ox + clouds.w, cy0, clouds.w, clouds.h);
          x.globalCompositeOperation = "source-over";
        }
        x.globalAlpha = 1;
      }
      if (I > 0.01) {
        x.fillStyle = "rgba(170,186,255," + (I * 0.3).toFixed(3) + ")"; x.fillRect(g.gx, g.gy, g.gw, g.hy - g.gy);
        for (i = 0; i < flashes.length; i++) {
          var f = flashes[i];
          if (!f.near || t - f.at > 0.26) continue;
          var bx = g.gx + g.gw * f.x, by = g.gy + (g.hy - g.gy) * 0.3, rs = f.seed;
          x.strokeStyle = "rgba(230,236,255," + (I * 0.85).toFixed(3) + ")"; x.lineWidth = 1.2; x.beginPath(); x.moveTo(bx, by);
          var yy = by; while (yy < g.hy - 2) { rs = (rs * 9301 + 0.4929) % 1; yy += (g.hy - by) / 7; bx += (rs - 0.5) * g.gw * 0.06; x.lineTo(bx, Math.min(yy, g.hy - 2)); }
          x.stroke();
        }
      }
      // sea
      var sea = x.createLinearGradient(0, g.hy, 0, g.gy + g.gh);
      sea.addColorStop(0, mixc([30, 44, 74], [24, 30, 42], cv0)); sea.addColorStop(0.5, mixc([14, 21, 38], [12, 16, 24], cv0)); sea.addColorStop(1, "#05070c");
      x.fillStyle = sea; x.fillRect(g.gx, g.hy, g.gw, g.gy + g.gh - g.hy);
      if (I > 0.01) { x.fillStyle = "rgba(150,170,240," + (I * 0.16).toFixed(3) + ")"; x.fillRect(g.gx, g.hy, g.gw, g.gy + g.gh - g.hy); }
      x.fillStyle = "rgba(185,200,245," + (0.22 * (1 - 0.5 * cv0)).toFixed(3) + ")"; x.fillRect(g.gx, g.hy - 0.5, g.gw, 1);
      // moonlight on the water
      var ga2 = (1 - 0.78 * cv0) * (0.55 + 0.45 * Math.min(1, lv.waves * 1.5 + 0.3));
      for (i = 0; i < glitter.length; i++) { var gl = glitter[i]; x.globalAlpha = ga2 * Math.max(0, Math.sin(t * gl.s + gl.p)) * 0.6; x.fillStyle = "#d6def7"; x.fillRect(gl.x - gl.w / 2, gl.y, gl.w, 1); }
      x.globalAlpha = 1;
      // the headland and its lighthouse, sweeping every ten seconds
      if (land) {
        x.fillStyle = mixc([8, 11, 19], [10, 12, 18], cv0); x.beginPath(); x.moveTo(land[0][0], g.hy + 1);
        for (i = 0; i < land.length; i++) x.lineTo(land[i][0], land[i][1]);
        x.lineTo(land[land.length - 1][0], g.hy + 1); x.closePath(); x.fill();
        var lyi = Math.round((g.lx - land[0][0]) / (land[land.length - 1][0] - land[0][0]) * (land.length - 1));
        var ly = land[Math.max(0, Math.min(land.length - 1, lyi))][1], th = g.gh * 0.035, tw = Math.max(1.6, W * 0.005);
        x.fillStyle = "#0a0d15"; x.fillRect(g.lx - tw / 2, ly - th, tw, th + 1);
        var ph = (t / 10) % 1, beam = reduce ? 0 : Math.exp(-Math.pow((ph - 0.5) / 0.045, 2));
        var lr2 = (2.2 + 6.5 * beam) * (1 + 0.5 * cv0) * Math.max(1, W / 500);
        var lg = x.createRadialGradient(g.lx, ly - th, 0, g.lx, ly - th, lr2 * 2.2);
        lg.addColorStop(0, "rgba(255,236,190," + (0.55 + 0.4 * beam).toFixed(3) + ")"); lg.addColorStop(0.3, "rgba(255,220,160," + (0.1 + 0.2 * beam).toFixed(3) + ")"); lg.addColorStop(1, "rgba(255,220,160,0)");
        x.fillStyle = lg; x.beginPath(); x.arc(g.lx, ly - th, lr2 * 2.2, 0, 6.283); x.fill();
        if (beam > 0.02) {
          var bl = x.createLinearGradient(g.lx - g.gw * 0.4, 0, g.lx + g.gw * 0.4, 0);
          bl.addColorStop(0, "rgba(255,226,170,0)"); bl.addColorStop(0.5, "rgba(255,226,170," + (beam * 0.16 * (1 + cv0)).toFixed(3) + ")"); bl.addColorStop(1, "rgba(255,226,170,0)");
          x.fillStyle = bl; x.fillRect(g.lx - g.gw * 0.4, ly - th - 1.5, g.gw * 0.8, 3);
        }
      }
      // swell lines rolling in
      var wv = lv.waves;
      for (i = 0; i < 10; i++) {
        var u = ((i / 10) + t * 0.012 * (0.4 + wv)) % 1, yy2 = g.hy + Math.pow(u, 1.7) * (g.breakY - g.hy);
        var sa2 = (0.02 + 0.08 * wv) * Math.sin(u * Math.PI);
        for (var sg = 0; sg < 4; sg++) {                      // short soft lengths of swell, never a full stripe
          var c0 = g.gx + g.gw * (((i * 0.618 + sg * 0.29 + (sg % 2) * 0.07 + Math.sin(t * 0.05 + i) * 0.03) % 1)), hw = g.gw * (0.04 + 0.07 * u);
          var sgr = x.createLinearGradient(c0 - hw, 0, c0 + hw, 0);
          sgr.addColorStop(0, "rgba(165,190,240,0)"); sgr.addColorStop(0.5, "rgba(165,190,240," + sa2.toFixed(3) + ")"); sgr.addColorStop(1, "rgba(165,190,240,0)");
          x.fillStyle = sgr; x.fillRect(c0 - hw, yy2, hw * 2, 1 + u * 1.4);
        }
      }
      // breaking waves (from the engine while playing, so the picture keeps time with the sound)
      var list = (playing && engineWaves && t - engineAt < 0.6) ? engineWaves.map(function (e) { return { ph: e[0], s: e[1], pan: e[2] }; }) : localWaves;
      if (reduce) list = [{ ph: 0.72, s: 0.85, pan: -0.3 }, { ph: 1.3, s: 1.1, pan: 0.12 }];   // a still scene still shows the surf
      if (wv > 0.01) for (i = 0; i < list.length; i++) drawWave(list[i], wv);
      // rain falling outside
      var ra = lv.rain;
      if (ra > 0.01) {
        var n = Math.round(ra * streaks.length), sp = 1.7 * (0.85 + 0.3 * gust);
        x.strokeStyle = "rgb(175,192,228)"; x.lineWidth = 1;
        for (i = 0; i < n; i++) {
          var st = streaks[i];
          st.y += sp * st.v * fdt; if (st.y > 1) { st.y -= 1; st.x = Math.random(); }
          var sx = g.gx + st.x * g.gw, sy = g.gy + st.y * g.gh, len = (8 + 16 * ra) * st.l * Math.max(1, H / 500);
          x.globalAlpha = (0.07 + 0.17 * ra) * st.a; x.beginPath(); x.moveTo(sx, sy); x.lineTo(sx - len * 0.22, sy + len); x.stroke();
        }
        x.globalAlpha = 1;
        x.fillStyle = "rgba(70,80,100," + (ra * 0.14).toFixed(3) + ")"; x.fillRect(g.gx, g.gy, g.gw, g.gh);   // haze
      }
      // on the glass: a faint warm reflection of the fire, then the drops
      if (lv.fire > 0.01) {
        var rf = x.createRadialGradient(g.gx, g.gy + g.gh, 0, g.gx, g.gy + g.gh, g.gw * 0.9);
        rf.addColorStop(0, "rgba(255,150,80," + (0.13 * lv.fire * fireGlow).toFixed(3) + ")"); rf.addColorStop(1, "rgba(255,150,80,0)");
        x.fillStyle = rf; x.fillRect(g.gx, g.gy, g.gw, g.gh);
      }
      for (i = 0; i < beads.length; i++) { var b = beads[i]; x.globalAlpha = b.a; x.drawImage(beadImg, b.x - b.r, b.y - b.r, b.r * 2, b.r * 2.1); }
      for (i = 0; i < runners.length; i++) { var q = runners[i]; x.globalAlpha = 1; x.drawImage(beadImg, q.x - q.r, q.y - q.r * 1.3, q.r * 2, q.r * 2.6); }
      x.globalAlpha = 1;
      // the glass itself: a faint sheen catching the room
      var sh = x.createLinearGradient(g.gx, g.gy, g.gx + g.gw * 0.7, g.gy + g.gh);
      sh.addColorStop(0, "rgba(200,215,255,0.035)"); sh.addColorStop(0.45, "rgba(200,215,255,0)"); sh.addColorStop(0.55, "rgba(200,215,255,0.025)"); sh.addColorStop(0.62, "rgba(200,215,255,0)");
      x.fillStyle = sh; x.fillRect(g.gx, g.gy, g.gw, g.gh);
      x.restore();

      // ---- the room ----
      x.drawImage(room, 0, 0, W, H);
      if (I > 0.01) {
        var lr = x.createRadialGradient(g.gx + g.gw / 2, g.gy + g.gh * 0.6, g.gw * 0.2, g.gx + g.gw / 2, g.gy + g.gh * 0.6, Math.max(W, H));
        lr.addColorStop(0, "rgba(160,176,240," + (I * 0.16).toFixed(3) + ")"); lr.addColorStop(1, "rgba(160,176,240,0)");
        x.fillStyle = lr; x.fillRect(0, 0, W, H);
      }
      drawFan();
      // firelight from the hearth off to the lower left
      if (lv.fire > 0.01) {
        var fl = reduce ? 1 : 0.86 + 0.08 * Math.sin(t * 9.1) + 0.05 * Math.sin(t * 14.3 + 1.3) + 0.04 * Math.sin(t * 23.7 + 2.1);
        var a = lv.fire * fl * fireGlow * (1 + 0.45 * fireFlash);
        x.globalCompositeOperation = "screen";
        var fg = x.createRadialGradient(-W * 0.02, H * 1.0, 0, -W * 0.02, H * 1.0, Math.max(W, H) * 1.05);
        fg.addColorStop(0, "rgba(255,146,62," + Math.min(0.85, 0.85 * a).toFixed(3) + ")");
        fg.addColorStop(0.3, "rgba(236,108,42," + Math.min(0.5, 0.4 * a).toFixed(3) + ")");
        fg.addColorStop(0.7, "rgba(170,64,22," + Math.min(0.16, 0.12 * a).toFixed(3) + ")");
        fg.addColorStop(1, "rgba(120,40,10,0)");
        x.fillStyle = fg; x.fillRect(0, 0, W, H);
        x.globalCompositeOperation = "source-over";
      }
      for (i = 0; i < grains.length; i++) {
        var gr = grains[i], level = lv[gr.id];
        if (level < 0.01) continue;
        x.save(); x.globalAlpha = Math.min(0.22, level * (gr.id === "white" ? 0.1 : 0.14)); x.globalCompositeOperation = "screen";
        x.scale(gr.scale, gr.scale); x.translate(-grainOff[i], -grainOff[(i + 1) % 3]);
        x.fillStyle = gr.pat; x.fillRect(0, 0, W / gr.scale + 100, H / gr.scale + 100);
        x.restore();
      }
      x.drawImage(vign, 0, 0, W, H);
    }
    function drawWave(w, wv) {
      var g = geo, x = cx, cxw = g.gx + g.gw * (0.5 + 0.35 * w.pan), i;
      if (w.ph < 1) {
        // the swell coming in: a lit crest with its trough in shadow under it
        var y = g.hy + Math.pow(w.ph, 1.7) * (g.breakY - g.hy), a = w.s * Math.pow(w.ph, 1.4) * 0.32 * wv, hw = g.gw * (0.18 + 0.3 * w.ph);
        var lg = x.createLinearGradient(cxw - hw, 0, cxw + hw, 0);
        lg.addColorStop(0, "rgba(205,220,252,0)"); lg.addColorStop(0.5, "rgba(205,220,252," + a.toFixed(3) + ")"); lg.addColorStop(1, "rgba(205,220,252,0)");
        x.fillStyle = lg; x.fillRect(cxw - hw, y - 1, hw * 2, 1.2 + w.ph * 2);
        x.fillStyle = "rgba(0,2,8," + (a * 0.5).toFixed(3) + ")"; x.fillRect(cxw - hw * 0.8, y + 1 + w.ph * 2, hw * 1.6, 2 + w.ph * 5);
      } else {
        var q = Math.min(1, w.ph - 1), peel = Math.min(1, q * 3.2), half = g.gw * (0.1 + 0.6 * peel);
        var cy0 = g.breakY - 1 + q * (g.shoreY - g.breakY) * 0.12;
        var bandH = (g.shoreY - g.breakY) * (0.25 + 0.75 * Math.min(1, q * 1.6));
        var ca = w.s * wv * (q < 0.25 ? 1 : Math.pow((1 - q) / 0.75, 1.5));
        var fa = w.s * wv * 0.7 * Math.pow(1 - q, 1.1);
        // foam running up the sand: soft strips, fading at both ends and toward the shore
        var fg = x.createLinearGradient(0, cy0, 0, cy0 + bandH);
        fg.addColorStop(0, "rgba(210,222,250," + (fa * 0.5).toFixed(3) + ")"); fg.addColorStop(0.45, "rgba(185,200,240," + (fa * 0.16).toFixed(3) + ")"); fg.addColorStop(1, "rgba(170,190,235,0)");
        x.fillStyle = fg;
        var NS = 28, sw = 2 * half / NS;
        for (i = 0; i < NS; i++) {
          var u2 = (i + 0.5) / NS, tp = Math.pow(Math.sin(Math.PI * u2), 0.8);
          var hh = bandH * (0.7 + 0.3 * Math.sin(u2 * 9 + w.pan * 7));
          x.globalAlpha = tp; x.fillRect(cxw - half + i * sw, cy0, sw + 0.6, hh);
        }
        x.globalAlpha = 1;
        // mottled foam
        var sd = Math.abs(w.pan * 1000) + 7;
        x.fillStyle = "rgba(230,238,255,1)";
        for (i = 0; i < 46; i++) {
          sd = (sd * 16807) % 2147483647; var r1 = sd / 2147483647; sd = (sd * 16807) % 2147483647; var r2 = sd / 2147483647;
          var fx = cxw + (r1 - 0.5) * 2 * half, fy = cy0 + r2 * r2 * bandH * 0.8 * Math.sin(Math.PI * r1);
          x.globalAlpha = fa * (1 - r2) * 0.8; x.fillRect(fx, fy, 3 + r1 * 10, 1);
        }
        x.globalAlpha = 1;
        // the breaking crest itself
        var cg = x.createLinearGradient(cxw - half, 0, cxw + half, 0);
        cg.addColorStop(0, "rgba(240,245,255,0)"); cg.addColorStop(0.2, "rgba(240,245,255," + Math.min(1, ca).toFixed(3) + ")");
        cg.addColorStop(0.8, "rgba(240,245,255," + Math.min(1, ca).toFixed(3) + ")"); cg.addColorStop(1, "rgba(240,245,255,0)");
        x.fillStyle = cg; x.fillRect(cxw - half, cy0 - 1.5, half * 2, 2.2);
      }
    }
    function drawFan() {
      var g = geo, x = cx, s = g.fs, ox = g.fx - s / 2, oy = g.fy - s / 2;
      x.drawImage(fanBack, ox, oy, s, s);
      // blades: crisp when still, a soft slowly turning blur when running
      var blur = Math.min(1, fanSpin * 1.3), copies = blur > 0.05 ? 7 : 1;
      x.save(); x.translate(g.fx, g.fy);
      for (var c = 0; c < copies; c++) {
        x.save();
        x.rotate(fanAng + (copies > 1 ? (c / copies) * 1.2566 * blur : 0));
        x.globalAlpha = copies > 1 ? 0.13 : 0.62;
        x.fillStyle = copies > 1 ? "#55627f" : "#1f2635";
        for (var b = 0; b < 5; b++) {
          x.rotate(1.2566);
          x.beginPath(); x.moveTo(0, -s * 0.04);
          x.bezierCurveTo(s * 0.12, -s * 0.12, s * 0.36, -s * 0.13, s * 0.39, -s * 0.02);
          x.bezierCurveTo(s * 0.3, s * 0.07, s * 0.14, s * 0.06, 0, s * 0.04);
          x.fill();
        }
        x.restore();
      }
      if (blur > 0.05) {
        var bd = x.createRadialGradient(0, 0, s * 0.06, 0, 0, s * 0.41);
        bd.addColorStop(0, "rgba(70,84,112,0)"); bd.addColorStop(0.35, "rgba(70,84,112," + (0.32 * blur).toFixed(3) + ")");
        bd.addColorStop(0.85, "rgba(62,74,100," + (0.26 * blur).toFixed(3) + ")"); bd.addColorStop(1, "rgba(62,74,100,0)");
        x.globalAlpha = 1; x.fillStyle = bd; x.beginPath(); x.arc(0, 0, s * 0.41, 0, 6.283); x.fill();
      }
      x.restore(); x.globalAlpha = 1;
      x.drawImage(fanFront, ox, oy, s, s);
    }

    function frame(ts) {
      running = false;
      if (document.hidden || dim) return;
      if (ts - last < 31) { running = true; requestAnimationFrame(frame); return; }
      var dt = last ? Math.min(0.1, (ts - last) / 1000) : 0.033; last = ts;
      update(dt); fdt = dt; draw(); fdt = 0;
      running = true; requestAnimationFrame(frame);
    }
    function wake() {
      if (reduce) { drawNow(); return; }
      if (!running && !document.hidden && !dim) { running = true; last = 0; requestAnimationFrame(frame); }
    }
    function drawNow() { if (reduce) snap(); draw(); }

    var resizeT = null;
    function relayout() { clearTimeout(resizeT); resizeT = setTimeout(function () { if (layout()) drawNow(); }, 120); }
    window.addEventListener("resize", relayout);
    // the panel can change size without the window resizing (fonts, the wide
    // layout's sticky column); a stale buffer would stretch the moon into an egg
    if (window.ResizeObserver) new ResizeObserver(relayout).observe(cv);
    layout();

    return { canvas: cv, setMix: setMix, feed: feed, flash: flash, wake: wake, drawNow: drawNow,
      stats: function () {
        var src = (playing && engineWaves && t - engineAt < 0.6) ? engineWaves.map(function (e) { return e[0]; }) : localWaves.map(function (w) { return +w.ph.toFixed(3); });
        return { beads: beads.length, runners: runners.length, flashes: flashes.length, waves: src.length, wavePhases: src, lv: JSON.parse(JSON.stringify(lv)) };
      } };
  })();

  // share.js words its image button generically ("Share your run" on games,
  // "Share your result" on tools); what this page shares is the mix
  (function fixShareLabel() {
    var row = document.querySelector(".share-row");
    if (!row || !window.MutationObserver) return;
    function fix() { var sp = row.querySelector(".opt-share span"); if (sp && /^Share your (run|result)$/.test(sp.textContent)) sp.textContent = "Share this mix"; }
    new MutationObserver(fix).observe(row, { childList: true, subtree: true, characterData: true });
    fix();
  })();

  // ---------- start ----------
  mixChanged(true);
  shareSync();
  tick();
  syncThemeColor();
  if (shared) say("Loaded a shared mix: " + SL.describe(mix) + ". Press play when you're ready.");
  // a mix link opened in a tab that already has the page
  window.addEventListener("hashchange", function () {
    var m = SL.decodeMix(location.hash);
    if (!m) return;
    try { history.replaceState(null, "", location.pathname + location.search); } catch (e) {}
    tweenTo(m); sharedLabel = true; names();
    say("Loaded a shared mix: " + SL.describe(m) + ".");
  });
  if (!reduce) scene.wake(); else scene.drawNow();
  window.addEventListener("pagehide", function () { unwake(); });
  // the media art is the window itself, made on first play
  $("playBtn").addEventListener("click", function () { if (playing) setTimeout(makeArt, 400); });

  if (navigator.webdriver) {
    window.__sleepSounds = {
      state: function () { return { playing: playing, mix: JSON.parse(JSON.stringify(mix)), volume: volume, timerId: timerId, endMs: endMs, fadeSec: fadeSec, dim: dim, ctx: ctx ? ctx.state : null, worklet: !!node, name: currentName() }; },
      scene: function () { return scene.stats(); },
      gains: function () { return ctx ? { fade: fadeG.gain.value, timer: timerG.gain.value, vol: volG.gain.value, t: ctx.currentTime } : null; }
    };
  }
})();
