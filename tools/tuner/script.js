/* Tuner — One Page Toys
 *
 * Three layers, kept apart so each can be trusted on its own:
 *   pitch.js  detect() + the tracker: pure, unit-tested in node from B0 to E6.
 *   voice.js  reference tones rendered to arrays: pure, and run through the
 *             same detector in the tests, so every peg plays exactly its note.
 *   this file the instrument: microphone, the backlit needle (a damped spring,
 *             so it swings and settles like a real meter movement), the strobe
 *             band, the headstock of pegs, and the moment every string is in.
 *
 * Nothing leaves the device. The microphone feeds an AnalyserNode and nothing
 * else: no recording, no upload, not even a connection to the speakers.
 */
(function () {
  "use strict";

  var P = window.TunerPitch, V = window.TunerVoice;
  var $ = function (id) { return document.getElementById(id); };
  var reduceMotion = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  function load(k, d) { try { var v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } }
  function save(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function ga(name, params) { try { if (typeof window.gtag === "function") window.gtag("event", name, params || {}); } catch (e) {} }
  function now() { return performance.now(); }

  /* ------------------------------------------------------------ catalog */

  // MIDI note numbers, listed in the order players name them (low string first).
  // win is the analysis window in seconds: five periods of the lowest note is
  // what keeps a low B steady to a cent in a noisy room (tested down to B0).
  var KINDS = [
    { id: "guitar", label: "Guitar", title: "Guitar tuner", voice: "pluck", body: "guitar", win: 0.04, minF: 60, maxF: 1400,
      tunings: [
        { id: "standard", label: "Standard", sub: "E A D G B E", notes: [40, 45, 50, 55, 59, 64] },
        { id: "dropd", label: "Drop D", sub: "D A D G B E", notes: [38, 45, 50, 55, 59, 64] },
        { id: "dadgad", label: "DADGAD", sub: "D A D G A D", notes: [38, 45, 50, 55, 57, 62] },
        { id: "openg", label: "Open G", sub: "D G D G B D", notes: [38, 43, 50, 55, 59, 62] },
        { id: "halfdown", label: "Half step down", sub: "E♭ A♭ D♭ G♭ B♭ E♭", notes: [39, 44, 49, 54, 58, 63], flats: true }
      ] },
    { id: "bass", label: "Bass", title: "Bass tuner", voice: "pluck", body: "bass", win: 0.17, minF: 26, maxF: 700,
      tunings: [
        { id: "4", label: "4-string", sub: "E A D G", notes: [28, 33, 38, 43] },
        { id: "5", label: "5-string", sub: "B E A D G", notes: [23, 28, 33, 38, 43] }
      ] },
    { id: "ukulele", label: "Ukulele", title: "Ukulele tuner", voice: "pluck", body: "uke", win: 0.04, minF: 180, maxF: 2000,
      tunings: [{ id: "gcea", label: "Standard", sub: "G C E A", notes: [67, 60, 64, 69] }] },
    { id: "violin", label: "Violin", title: "Violin tuner", voice: "bow", body: "violin", win: 0.04, minF: 150, maxF: 3200,
      tunings: [{ id: "gdae", label: "Standard", sub: "G D A E", notes: [55, 62, 69, 76] }] },
    { id: "viola", label: "Viola", title: "Viola tuner", voice: "bow", body: "viola", win: 0.04, minF: 100, maxF: 2400,
      tunings: [{ id: "cgda", label: "Standard", sub: "C G D A", notes: [48, 55, 62, 69] }] },
    { id: "cello", label: "Cello", title: "Cello tuner", voice: "bow", body: "cello", win: 0.085, minF: 50, maxF: 1400,
      tunings: [{ id: "cgda", label: "Standard", sub: "C G D A", notes: [36, 43, 50, 57] }] },
    { id: "chromatic", label: "Chromatic", title: "Chromatic tuner", voice: "bow", body: "neutral", win: 0.17, minF: 26, maxF: 4400,
      tunings: [] }
  ];
  var WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight"];
  function kindById(id) { for (var i = 0; i < KINDS.length; i++) if (KINDS[i].id === id) return KINDS[i]; return KINDS[0]; }

  var S = {
    kind: kindById(load("tuner_kind", "guitar")),
    tuningIds: { guitar: load("tuner_tuning_guitar", "standard"), bass: load("tuner_tuning_bass", "4") },
    a4: clamp(parseFloat(load("tuner_ref", "440")) || 440, 415, 466),
    pipeOct: clamp(parseInt(load("tuner_pipe_oct", "4"), 10) || 4, 1, 6)
  };
  function tuning() {
    var k = S.kind;
    if (!k.tunings.length) return null;
    var id = S.tuningIds[k.id];
    for (var i = 0; i < k.tunings.length; i++) if (k.tunings[i].id === id) return k.tunings[i];
    return k.tunings[0];
  }
  function notes() { var t = tuning(); return t ? t.notes : []; }
  function freqOf(m) { return P.midiFreq(m, S.a4); }

  var SHARP_GLYPH = { "#": "♯", "b": "♭" };
  function splitName(midi, flats) {
    var n = P.noteName(midi, flats);
    return { letter: n.name.charAt(0), acc: n.name.length > 1 ? SHARP_GLYPH[n.name.charAt(1)] : "", octave: n.octave };
  }

  /* -------------------------------------------------------------- audio */

  var A = null, master = null, send = null, quietUntil = 0, refUntil = 0;
  var BODY = {
    guitar: [[102, 2.2, 5], [205, 2, 3], [420, 1.4, 2], ["hs", 5200, -5]],
    bass: [[62, 1.6, 3.5], [140, 1.3, 2.5], [380, 1, 1.2], ["lp", 3600]],
    uke: [[265, 2, 4], [520, 1.6, 2.5], [1050, 1.2, 1.5], ["hs", 6500, -3]],
    violin: [[285, 3, 4], [465, 2.4, 3], [1100, 1.4, 2], [2600, 1, 4.5], ["lp", 8500]],
    viola: [[230, 3, 4], [380, 2.4, 3], [900, 1.4, 2], [2200, 1, 4], ["lp", 7600]],
    cello: [[110, 2.6, 4], [205, 2.2, 3.2], [520, 1.4, 2], [1400, 1, 3], ["lp", 6200]],
    neutral: [[300, 1, 1.5], [1200, 1, 1.5], ["lp", 7000]]
  };
  // Measured offline (see the report): these land a single reference tone
  // around 0.2 peak through the whole chain.
  var AMP = { guitar: 0.112, bass: 0.12, uke: 0.11, violin: 0.1, viola: 0.105, cello: 0.12, neutral: 0.1 };

  function buildAudio() {
    if (A) return;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try { A = new AC({ latencyHint: "interactive" }); } catch (e) { A = new AC(); }
    master = A.createGain(); master.gain.value = 1;
    var glue = A.createDynamicsCompressor();
    glue.threshold.value = -15; glue.ratio.value = 3; glue.knee.value = 6; glue.attack.value = 0.004; glue.release.value = 0.2;
    var silk = A.createBiquadFilter(); silk.type = "lowpass"; silk.frequency.value = 11500; silk.Q.value = 0.5;
    var wall = A.createDynamicsCompressor();
    wall.threshold.value = -1.5; wall.ratio.value = 20; wall.knee.value = 0; wall.attack.value = 0.002; wall.release.value = 0.1;
    master.connect(glue); glue.connect(silk); silk.connect(wall); wall.connect(A.destination);

    // A room, not a hall: a few early reflections and a smooth 1.5 s tail.
    var sr = A.sampleRate, len = Math.floor(sr * 2.2), ir = A.createBuffer(2, len, sr);
    var r = V.rng(2024);
    for (var c = 0; c < 2; c++) {
      var d = ir.getChannelData(c), lp = 0;
      for (var i = 0; i < len; i++) {
        lp += 0.32 * ((r() * 2 - 1) - lp);
        d[i] = lp * Math.exp(-i / (sr * 0.32)) * (i < sr * 0.004 ? i / (sr * 0.004) : 1);
      }
      [0.011, 0.017, 0.026, 0.037].forEach(function (t, k) {
        var at = Math.floor(sr * (t + c * 0.0023));
        if (at < len) d[at] += (0.5 - k * 0.09) * (k % 2 ? -1 : 1);
      });
      for (var j = 0; j < len; j++) if (!isFinite(d[j])) d[j] = 0;
    }
    var conv = A.createConvolver(); conv.buffer = ir;
    var hp = A.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 170;
    var shelf = A.createBiquadFilter(); shelf.type = "highshelf"; shelf.frequency.value = 4200; shelf.gain.value = 2;
    send = A.createGain(); send.gain.value = 0.5;
    send.connect(hp); hp.connect(conv); conv.connect(shelf); shelf.connect(master);
  }
  // iOS: the context only wakes inside a gesture, and a 1-sample silent buffer
  // played in that gesture is what unlocks output for good.
  function unlock() {
    buildAudio();
    if (!A) return;
    try {
      var b = A.createBufferSource(); b.buffer = A.createBuffer(1, 1, A.sampleRate);
      b.connect(A.destination); b.start(0);
    } catch (e) {}
    if (A.state === "suspended" && A.resume) { try { A.resume(); } catch (e) {} }
  }

  var cache = {};
  function renderTone(midi, voice, family, soft) {
    var f = freqOf(midi), sr = A.sampleRate;
    var key = voice + ":" + family + ":" + midi + ":" + S.a4 + (soft ? ":s" : "");
    if (cache[key]) return cache[key];
    var data;
    if (voice === "bow") {
      data = V.renderBow(f, sr, { seconds: 2.5, attack: 0.2, release: 0.55, bright: family === "cello" ? 0.45 : 0.6, random: Math.random });
    } else {
      var low = clamp((midi - 23) / 46, 0, 1);              // 0 at B0 .. 1 at A4
      var o = family === "bass" ? { seconds: 3.6, t60: 5.5 - 2 * low, bright: 0.34, pick: 0.21 }
            : family === "uke" ? { seconds: 2.2, t60: 2.4, bright: 0.62, pick: 0.27 }
            : { seconds: 3.4 - low * 0.8, t60: 4.6 - 2.2 * low, bright: soft ? 0.38 : 0.52, pick: 0.16 };
      o.random = Math.random;
      data = V.renderPluck(f, sr, o);
    }
    var b = A.createBuffer(1, data.length, sr);
    b.getChannelData(0).set(data);
    cache[key] = b;
    return b;
  }

  function voiceOut(family, pan, amp, t) {
    var chain = BODY[family] || BODY.neutral, head = null, tail = null;
    chain.forEach(function (sp) {
      var f = A.createBiquadFilter();
      if (sp[0] === "hs") { f.type = "highshelf"; f.frequency.value = sp[1]; f.gain.value = sp[2]; }
      else if (sp[0] === "lp") { f.type = "lowpass"; f.frequency.value = sp[1]; f.Q.value = 0.6; }
      else { f.type = "peaking"; f.frequency.value = sp[0]; f.Q.value = sp[1]; f.gain.value = sp[2]; }
      if (tail) tail.connect(f); else head = f;
      tail = f;
    });
    var g = A.createGain(); g.gain.setValueAtTime(amp, t);
    tail.connect(g);
    var out = g;
    if (A.createStereoPanner) { var p = A.createStereoPanner(); p.pan.value = pan; g.connect(p); out = p; }
    out.connect(master); out.connect(send);
    return { input: head, gain: g, nodes: [head, g, out] };
  }

  // One string's reference. Returns the tone's length in ms.
  function playNote(midi, pan, opts) {
    opts = opts || {};
    unlock();
    if (!A) return 0;
    var k = S.kind, voice = opts.voice || k.voice, family = opts.family || (voice === "bow" && k.id === "chromatic" ? bowFamily(midi) : k.body);
    if (voice === "pluck" && family === "neutral") family = "guitar";
    var buf = renderTone(midi, voice, family, opts.soft);
    var t = Math.max(A.currentTime, 0) + (opts.delay || 0) + 0.01;
    var src = A.createBufferSource(); src.buffer = buf;
    var v = voiceOut(family, pan || 0, (AMP[family] || 0.3) * (opts.gain || 1), t);
    src.connect(v.input);
    src.start(t);
    var ms = buf.duration * 1000;
    src.onended = function () { try { v.nodes.forEach(function (n) { n.disconnect(); }); } catch (e) {} };
    return ms;
  }
  function bowFamily(midi) { return midi < 50 ? "cello" : midi < 62 ? "viola" : "violin"; }

  /* ------------------------------------------------------------- the mic */

  var mic = { stream: null, src: null, an: null, hp: null, lp: null, buf: null, on: false, paused: false, sr: 48000 };
  var tracker = P.createTracker({ holdMs: 1100, followMs: 70, medianN: 5 });

  function windowSize(sr) {
    var n = 1024;
    while (n < sr * S.kind.win) n <<= 1;
    return clamp(n, 1024, 32768);
  }
  function configureAnalyser() {
    if (!mic.an || !A) return;
    var n = windowSize(A.sampleRate);
    mic.an.fftSize = n;
    mic.buf = new Float32Array(n);
    mic.hp.frequency.value = Math.max(18, S.kind.minF * 0.55);
    mic.lp.frequency.value = Math.min(A.sampleRate * 0.45, Math.max(1500, S.kind.maxF * 2.2));
  }
  function detectOpts() {
    var k = S.kind, o = { minFreq: k.minF, maxFreq: k.maxF };
    var ns = notes();
    if (ns.length) o.targets = ns.map(freqOf);
    return o;
  }

  var MIC_ERR = {
    denied: "Microphone access is off for this page. To turn it on, tap the lock or the page settings next to the address, allow the microphone, then tap Try again. The pegs below still play every note.",
    none: "No microphone found. Plug one in and tap Try again, or tune by ear with the pegs below.",
    busy: "Another app is using the microphone. Close it and tap Try again. The pegs below still play every note.",
    unsupported: "This browser can't open the microphone on this page. You can still tune by ear: tap a peg and match your string to it."
  };

  function setStartState(state, msg) {
    var btn = $("startBtn"), lab = $("startLabel"), note = $("startNote");
    btn.disabled = state === "waiting";
    if (state === "waiting") { lab.textContent = "Waiting for the microphone…"; return; }
    if (state === "error") { lab.textContent = "Try again"; note.innerHTML = "<b>" + msg.split(". ")[0] + ".</b> " + msg.split(". ").slice(1).join(". "); return; }
    if (state === "resume") { lab.textContent = "Resume tuning"; note.textContent = "Paused while the page was away. The sound stays on this device: nothing is recorded or sent."; return; }
    lab.textContent = "Start tuning";
  }

  function startMic(fromGesture) {
    if (mic.on) return Promise.resolve(true);
    if (fromGesture) unlock(); else buildAudio();
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setStartState("error", MIC_ERR.unsupported);
      ga("tuner_mic_error", { reason: "unsupported" });
      return Promise.resolve(false);
    }
    setStartState("waiting");
    var want = { audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } };
    return navigator.mediaDevices.getUserMedia(want).catch(function (e) {
      if (e && (e.name === "OverconstrainedError" || e.name === "TypeError")) return navigator.mediaDevices.getUserMedia({ audio: true });
      throw e;
    }).then(function (stream) {
      buildAudio();
      if (A.state === "suspended" && A.resume) A.resume().catch(function () {});
      mic.stream = stream;
      mic.src = A.createMediaStreamSource(stream);
      mic.hp = A.createBiquadFilter(); mic.hp.type = "highpass"; mic.hp.Q.value = 0.6;
      mic.lp = A.createBiquadFilter(); mic.lp.type = "lowpass"; mic.lp.Q.value = 0.6;
      mic.an = A.createAnalyser(); mic.an.smoothingTimeConstant = 0;
      mic.src.connect(mic.hp); mic.hp.connect(mic.lp); mic.lp.connect(mic.an);   // never to the speakers
      configureAnalyser();
      mic.on = true; mic.paused = false; mic.zeroSince = now();
      tracker.reset();
      el.unit.classList.add("is-live");
      el.start.classList.add("is-gone");
      setTimeout(function () { if (mic.on) el.start.hidden = true; }, 340);
      el.live.hidden = false; el.live.classList.remove("is-paused");
      el.live.setAttribute("aria-label", "Stop listening");
      el.live.querySelector(".tn-live__txt").textContent = "Listening";
      say(S.kind.id === "chromatic" ? "Play or sing a note." : "Pluck a string and let it ring.");
      ga("tuner_start", { instrument: S.kind.id });
      kick();
      return true;
    }).catch(function (e) {
      var name = e && e.name;
      var why = name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError" ? "denied"
        : name === "NotFoundError" || name === "DevicesNotFoundError" ? "none"
        : name === "NotReadableError" || name === "AbortError" ? "busy" : "denied";
      el.start.hidden = false; el.start.classList.remove("is-gone");
      // coming back to the tab without a tap: some browsers want a gesture first,
      // which is not the same as the microphone being blocked
      if (!fromGesture && mic.paused) { setStartState("resume"); return false; }
      setStartState("error", MIC_ERR[why]);
      ga("tuner_mic_error", { reason: why });
      return false;
    });
  }

  function stopMic(paused) {
    if (!mic.on) return;
    try { mic.stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
    try { mic.src.disconnect(); mic.hp.disconnect(); mic.lp.disconnect(); } catch (e) {}
    mic.on = false; mic.paused = !!paused; mic.stream = null;
    tracker.reset();
    el.unit.classList.remove("is-live");
    el.live.hidden = true;
    el.start.hidden = false;
    requestAnimationFrame(function () { el.start.classList.remove("is-gone"); });
    setStartState(paused ? "resume" : "idle");
    if (!paused) $("startNote").textContent = "Listens through your microphone. The sound stays on this device: nothing is recorded or sent.";
    say(paused ? "Paused." : "Stopped listening. Tap Start to tune again.");
    renderVU(0);
    kick();
  }

  document.addEventListener("visibilitychange", function () {
    if (document.hidden) { if (mic.on) stopMic(true); }
    else if (mic.paused) startMic(false);
  });

  /* ------------------------------------------------------ the judgement
   * Instrument mode picks the nearest string (with a little hysteresis so a
   * pitch halfway between two strings doesn't flicker), and marks a string
   * tuned once it has held within 3 cents for 0.8 s. A tuned string that
   * later reads more than 8 cents out loses its mark: honest beats flattering. */

  var J = { target: -1, cents: 0, inTune: false, lockT: 0, driftT: 0, tuned: [], startedAt: 0, celebrated: false, lastNoteMidi: null };
  var LOCK_MS = 800, IN_C = 3, OUT_C = 4.2;

  function resetJudge(keepTuned) {
    J.target = -1; J.cents = 0; J.inTune = false; J.lockT = 0; J.driftT = 0;
    if (!keepTuned) { J.tuned = notes().map(function () { return false; }); J.startedAt = 0; J.celebrated = false; }
  }

  function judge(st, dt, tMs) {
    var ns = notes();
    if (!st.active) { J.inTune = false; J.lockT = 0; J.driftT = 0; return; }
    var f = st.freq;
    if (ns.length) {
      var near = P.nearestString(f, ns, S.a4);
      if (J.target < 0) J.target = near.index;
      else if (near.index !== J.target) {
        var cur = P.centsBetween(f, freqOf(ns[J.target]));
        if (Math.abs(near.cents) + 25 < Math.abs(cur)) { J.target = near.index; J.lockT = 0; }
      }
      J.cents = P.centsBetween(f, freqOf(ns[J.target]));
      J.lastNoteMidi = ns[J.target];
    } else {
      var nt = P.noteOf(f, S.a4);
      J.cents = nt.cents; J.lastNoteMidi = nt.midi;
    }
    var a = Math.abs(J.cents);
    J.inTune = J.inTune ? a <= OUT_C : a <= IN_C;
    if (st.holding) return;
    if (!J.startedAt) J.startedAt = tMs;
    if (!ns.length) return;
    var canLock = tMs >= refUntil;
    if (J.inTune && canLock) {
      J.lockT += dt;
      if (J.lockT >= LOCK_MS && !J.tuned[J.target]) markTuned(J.target, true);
    } else if (a > OUT_C) J.lockT = 0;
    if (J.tuned[J.target] && a > 8 && canLock) {
      J.driftT += dt;
      if (J.driftT > 600) markTuned(J.target, false);
    } else J.driftT = 0;
  }

  function markTuned(i, on) {
    J.tuned[i] = on;
    J.driftT = 0;
    var col = el.pegs.children[i];
    if (col) {
      col.classList.toggle("is-tuned", on);
      if (on) { col.classList.remove("is-pop"); void col.offsetWidth; col.classList.add("is-pop"); }
    }
    var nm = splitName(notes()[i], (tuning() || {}).flats);
    announce(on ? stringLabel(i) + ", " + nm.letter + (nm.acc ? (nm.acc === "♭" ? " flat" : " sharp") : "") + nm.octave + ", in tune." : stringLabel(i) + " has drifted.");
    if (on) {
      try { if (navigator.vibrate) navigator.vibrate(14); } catch (e) {}
      flashT = 1;
      var all = J.tuned.length && J.tuned.every(Boolean);
      if (all && !J.celebrated) setTimeout(celebrate, 420);
      else say("<b>" + stringLabel(i) + "</b> is in tune. " + (all ? "" : remainingText()));
    } else {
      say(stringLabel(i) + " drifted. Bring it back up.");
    }
  }
  function remainingText() {
    var left = J.tuned.filter(function (x) { return !x; }).length;
    return left ? WORDS[left].charAt(0).toUpperCase() + WORDS[left].slice(1) + " to go." : "";
  }
  function stringNumber(i) {
    // players number strings from the highest pitch down
    var ns = notes(), order = ns.map(function (m, j) { return [m, j]; }).sort(function (a, b) { return b[0] - a[0]; });
    for (var k = 0; k < order.length; k++) if (order[k][1] === i) return k + 1;
    return i + 1;
  }
  function stringLabel(i) {
    var nm = splitName(notes()[i], (tuning() || {}).flats);
    return nm.letter + nm.acc + " string";
  }

  /* --------------------------------------------------------- the payoff */

  var shareCanvas = null, doneInfo = null;
  function fmtTime(ms) {
    var s = Math.max(1, Math.round(ms / 1000));
    return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  }
  function celebrate() {
    if (J.celebrated) return;
    J.celebrated = true;
    var n = notes().length, t = tuning();
    var took = J.startedAt ? now() - J.startedAt : 0;
    doneInfo = { n: n, took: took, kind: S.kind, tuning: t, a4: S.a4 };
    $("doneTitle").textContent = "All " + WORDS[n] + " strings";
    $("doneSub").textContent = (took > 1500 ? "Tuned in " + fmtTime(took) + " · " : "") + (t && S.kind.tunings.length > 1 ? t.label + " · " : "") + "A4 = " + fmtA4() + " Hz";
    el.done.hidden = false;
    el.done.classList.remove("is-gone");
    el.unit.classList.add("is-done");
    flashT = 1; kick();
    say("<b>Every string is in tune.</b> Go play something.");
    announce("All " + WORDS[n] + " strings are in tune.");
    // a chase along the headstock, then the open strings strummed once
    Array.prototype.forEach.call(el.pegs.children, function (col, i) {
      setTimeout(function () { col.classList.remove("is-pop"); void col.offsetWidth; col.classList.add("is-pop"); }, reduceMotion ? 0 : i * 70);
    });
    var order = notes().map(function (m, i) { return [m, i]; }).sort(function (a, b) { return a[0] - b[0]; });
    var longest = 0;
    order.forEach(function (o, k) {
      var ms = playNote(o[0], panFor(o[1]), { voice: "pluck", soft: true, gain: 0.5, delay: 0.25 + k * 0.055 });
      longest = Math.max(longest, ms + 250 + k * 55);
    });
    quietUntil = now() + longest + 150; refUntil = quietUntil;
    // share: a real result, never an empty one
    var label = S.kind.label.toLowerCase();
    window.OPT_SHARE_LINE = "All " + n + " strings in tune";
    window.OPT_SHARE_TEXT = "Tuned all " + n + " strings of my " + label + (t && S.kind.tunings.length > 1 ? " to " + t.label.toLowerCase() : "") +
      (took > 1500 ? " in " + fmtTime(took) : "") + " (A4 = " + fmtA4() + " Hz).";
    window.OPT_SHARE_IMAGE = function () { return drawShare(); };
    $("shareRow").hidden = false;
    ga("tuner_all_tuned", { instrument: S.kind.id, tuning: t ? t.id : "", seconds: Math.round(took / 1000) });
  }
  function clearDone() {
    J.celebrated = false; doneInfo = null;
    el.unit.classList.remove("is-done");
    el.done.classList.add("is-gone");
    setTimeout(function () { if (!J.celebrated) el.done.hidden = true; }, 340);
    window.OPT_SHARE_LINE = ""; window.OPT_SHARE_TEXT = ""; window.OPT_SHARE_IMAGE = null;
    $("shareRow").hidden = true;
  }

  /* ---------------------------------------------------------------- DOM */

  var el = {
    unit: $("unit"), kinds: $("kinds"), tunings: $("tunings"), pegs: $("pegs"), pipe: $("pipe"), pipeKeys: $("pipeKeys"),
    start: $("startPanel"), done: $("donePanel"), live: $("liveBtn"), say: $("say"),
    name: $("noteName"), acc: $("noteAcc"), oct: $("noteOct"), cents: $("numCents"), hz: $("numHz"), str: $("numString"),
    flat: $("lampFlat"), sharp: $("lampSharp"), dial: $("dial"), strobe: $("strobe"), vu: document.querySelectorAll(".tn-vu i")
  };
  var lastSay = "";
  function say(html) { if (html !== lastSay) { el.say.innerHTML = html; lastSay = html; } }
  // while the start panel covers the readout, reference-tone news goes under the pegs
  var hintT = null;
  function tell(html) {
    if (mic.on) { say(html); return; }
    var h = $("neckHint");
    h.innerHTML = html; h.classList.add("is-news");
    clearTimeout(hintT);
    hintT = setTimeout(function () { h.classList.remove("is-news"); h.textContent = notes().length ? "Tap a peg to hear its note. Number keys play them too." : "Tap a note to hear it, held long enough to tune to."; }, 4200);
  }
  var annT = null;
  function announce(text) { clearTimeout(annT); $("announce").textContent = ""; annT = setTimeout(function () { $("announce").textContent = text; }, 60); }
  function fmtA4() { return String(Math.round(S.a4)); }
  function panFor(i) { var n = Math.max(1, notes().length - 1); return (i / n) * 0.8 - 0.4; }

  function chip(label, checked, onPick, extraClass) {
    var b = document.createElement("button");
    b.type = "button"; b.className = "tn-chip" + (extraClass ? " " + extraClass : "");
    b.setAttribute("role", "radio"); b.setAttribute("aria-checked", checked ? "true" : "false");
    b.tabIndex = checked ? 0 : -1;
    b.textContent = label;
    b.addEventListener("click", onPick);
    return b;
  }
  // arrow keys move within a radiogroup of chips
  function radioKeys(group) {
    group.addEventListener("keydown", function (e) {
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].indexOf(e.key) < 0) return;
      var items = Array.prototype.slice.call(group.querySelectorAll('[role="radio"]'));
      var i = items.indexOf(document.activeElement);
      if (i < 0) return;
      e.preventDefault();
      var j = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : (i + (e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 1) + items.length) % items.length;
      items[j].focus(); items[j].click();
    });
  }

  function buildKinds() {
    el.kinds.innerHTML = "";
    KINDS.forEach(function (k) {
      el.kinds.appendChild(chip(k.label, k === S.kind, function () { setKind(k.id); }));
    });
  }
  function buildTunings() {
    el.tunings.innerHTML = "";
    var k = S.kind, cur = tuning();
    if (k.tunings.length < 2) return;
    k.tunings.forEach(function (t) {
      var b = chip(t.label, t === cur, function () { setTuning(t.id); }, "tn-chip--sm");
      b.title = t.sub;
      el.tunings.appendChild(b);
    });
  }
  function buildPegs() {
    el.pegs.innerHTML = "";
    var ns = notes(), t = tuning();
    el.pegs.hidden = !ns.length;
    el.pipe.hidden = !!ns.length;
    el.pegs.style.setProperty("--n", ns.length || 1);
    ns.forEach(function (m, i) {
      var nm = splitName(m, t && t.flats);
      var col = document.createElement("div");
      col.className = "tn-col";
      col.style.setProperty("--gauge", clamp(0.9 + (66 - m) / 16, 0.9, 3.4).toFixed(2) + "px");
      var b = document.createElement("button");
      b.type = "button"; b.className = "tn-peg";
      b.setAttribute("aria-label", "Play " + nm.letter + (nm.acc === "♭" ? " flat " : nm.acc === "♯" ? " sharp " : " ") + nm.octave + ", string " + stringNumber(i));
      b.innerHTML = '<span class="tn-peg__n">' + nm.letter + (nm.acc || "") + "<small>" + nm.octave + "</small></span>";
      b.addEventListener("click", function () { refTap(i); });
      var led = document.createElement("span"); led.className = "tn-led"; led.setAttribute("aria-hidden", "true");
      var sn = document.createElement("span"); sn.className = "tn-sn"; sn.setAttribute("aria-hidden", "true"); sn.textContent = stringNumber(i);
      col.appendChild(b); col.appendChild(led); col.appendChild(sn);
      if (J.tuned[i]) col.classList.add("is-tuned");
      el.pegs.appendChild(col);
    });
    $("neckHint").textContent = ns.length ? "Tap a peg to hear its note. Number keys play them too." : "Tap a note to hear it, held long enough to tune to.";
  }
  function buildPipe() {
    el.pipeKeys.innerHTML = "";
    for (var pc = 0; pc < 12; pc++) {
      (function (pc) {
        var m = (S.pipeOct + 1) * 12 + pc, nm = splitName(m, false);
        var b = document.createElement("button");
        b.type = "button"; b.className = "tn-key" + (nm.acc ? " is-sharp" : "");
        b.dataset.pc = pc;
        b.innerHTML = nm.letter + (nm.acc || "") + "<small>" + nm.octave + "</small>";
        b.setAttribute("aria-label", "Play " + nm.letter + (nm.acc ? " sharp " : " ") + nm.octave);
        b.addEventListener("click", function () { pipeTap(m, pc); });
        el.pipeKeys.appendChild(b);
      })(pc);
    }
    $("octVal").textContent = "Octave " + S.pipeOct;
    $("octDown").disabled = S.pipeOct <= 1;
    $("octUp").disabled = S.pipeOct >= 6;
  }

  function refreshTitles() {
    var k = S.kind, t = tuning();
    $("tnTitle").textContent = k.title;
    $("tnEyebrow").textContent = t ? (k.tunings.length > 1 ? t.label + " · " : "") + t.sub : "Any note, any instrument";
    $("plate").textContent = "A4 · " + fmtA4() + " Hz";
    $("refVal").textContent = "A4 = " + fmtA4() + " Hz";
    $("refDown").disabled = S.a4 <= 415; $("refUp").disabled = S.a4 >= 466;
    Array.prototype.forEach.call(document.querySelectorAll("[data-ref]"), function (b) {
      b.setAttribute("aria-pressed", Math.round(S.a4) === +b.dataset.ref ? "true" : "false");
      b.classList.toggle("is-on", Math.round(S.a4) === +b.dataset.ref);
    });
    dialDirty = true;
  }

  // update a chip group in place, so keyboard focus survives the change
  function syncChips(group, isOn) {
    Array.prototype.forEach.call(group.querySelectorAll('[role="radio"]'), function (b, i) {
      var on = isOn(i);
      b.setAttribute("aria-checked", on ? "true" : "false");
      b.tabIndex = on ? 0 : -1;
    });
  }
  function setKind(id) {
    var k = kindById(id);
    if (k === S.kind) return;
    S.kind = k; save("tuner_kind", k.id);
    afterTargetsChange();
    syncChips(el.kinds, function (i) { return KINDS[i] === k; });
    ga("tuner_instrument", { instrument: k.id });
  }
  function setTuning(id) {
    if ((tuning() || {}).id === id) return;
    S.tuningIds[S.kind.id] = id; save("tuner_tuning_" + S.kind.id, id);
    afterTargetsChange(false, true);
    var ts = S.kind.tunings;
    syncChips(el.tunings, function (i) { return ts[i] && ts[i].id === id; });
  }
  function setA4(v) {
    v = clamp(Math.round(v), 415, 466);
    if (v === S.a4) return;
    S.a4 = v; save("tuner_ref", String(v));
    cache = {};
    afterTargetsChange(true);
  }
  function afterTargetsChange(refOnly, keepChips) {
    clearDone();
    resetJudge(false);
    tracker.reset();
    if (!refOnly && !keepChips) { buildTunings(); }
    buildPegs(); buildPipe();
    refreshTitles();
    configureAnalyser();
    if (mic.on) say(S.kind.id === "chromatic" ? "Play or sing a note." : "Pluck a string and let it ring.");
    kick();
  }

  function ringCol(col, ms) {
    if (!col) return;
    col.classList.add("is-ring");
    clearTimeout(col._ring);
    col._ring = setTimeout(function () { col.classList.remove("is-ring"); }, reduceMotion ? 0 : Math.min(ms, 1800));
  }
  var refShown = false;
  function refTap(i) {
    var m = notes()[i], ms = playNote(m, panFor(i));
    ringCol(el.pegs.children[i], ms * 0.6);
    var t = now();
    quietUntil = t + Math.min(1300, ms);      // the loud part: the tuner is deaf to itself
    refUntil = t + ms + 200;                  // the tail: no string can lock on it
    var nm = splitName(m, (tuning() || {}).flats);
    tell("Playing <b>" + nm.letter + nm.acc + nm.octave + "</b>. " + (mic.on ? "Pluck your string after it and watch the needle." : "Turn your string until the two notes stop wobbling against each other."));
    if (!refShown) { refShown = true; ga("tuner_reference", { instrument: S.kind.id }); }
  }
  function pipeTap(m, pc) {
    var ms = playNote(m, (pc / 11) * 0.8 - 0.4);
    var t = now(); quietUntil = t + Math.min(1300, ms); refUntil = t + ms + 200;
    var b = el.pipeKeys.children[pc];
    if (b) { b._flash = true; b.classList.add("is-target"); setTimeout(function () { b._flash = false; b.classList.remove("is-target"); }, 600); }
    var nm = splitName(m, false);
    tell("Playing <b>" + nm.letter + nm.acc + nm.octave + "</b>." + (mic.on ? "" : " Sing or play along until the two sounds stop wobbling."));
    if (!refShown) { refShown = true; ga("tuner_reference", { instrument: S.kind.id }); }
  }

  /* --------------------------------------------------------- the dial */

  var DPR = Math.min(2, window.devicePixelRatio || 1);
  var dctx = el.dial.getContext("2d"), sctx = el.strobe.getContext("2d");
  var DW = 0, DH = 0, SW = 0, SH = 0, dialStatic = null, dialDirty = true;
  var SWEEP = 46 * Math.PI / 180;

  function geom(w, h) {
    var cx = w / 2, cy = h * 1.13, R = h * 0.97;
    return { cx: cx, cy: cy, R: R, ang: function (c) { return clamp(c, -60, 60) / 50 * SWEEP; } };
  }
  function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
  }

  // Everything that does not move, drawn once per size into its own canvas.
  function paintDialStatic(c, w, h, a4) {
    var g = geom(w, h), s = h / 300;
    c.clearRect(0, 0, w, h);
    // bezel
    var bz = c.createLinearGradient(0, 0, 0, h);
    bz.addColorStop(0, "#2b241d"); bz.addColorStop(1, "#0c0a08");
    roundRect(c, 0, 0, w, h, 18 * s + 4); c.fillStyle = bz; c.fill();
    var inset = Math.max(4, 7 * s), wx = inset, wy = inset, ww = w - inset * 2, wh = h - inset * 2, wr = 14 * s + 2;
    c.save();
    roundRect(c, wx, wy, ww, wh, wr); c.clip();
    // the backlit face: warm at the center, browning toward the edges
    var face = c.createRadialGradient(g.cx, h * 0.82, h * 0.05, g.cx, h * 0.7, w * 0.72);
    face.addColorStop(0, "#fff6df"); face.addColorStop(0.42, "#f8e5ba"); face.addColorStop(0.78, "#e3c186"); face.addColorStop(1, "#a97a3f");
    c.fillStyle = face; c.fillRect(wx, wy, ww, wh);
    // paper: a faint, fixed grain
    var r = V.rng(77);
    c.fillStyle = "rgba(90, 60, 20, 0.05)";
    for (var i = 0; i < Math.round(w * h / 380); i++) c.fillRect(r() * w, r() * h, 1.2 * s + 0.4, 1.2 * s + 0.4);
    // zone band above the ticks: green for in tune, then amber, then a warm red
    function band(c0, c1, color, rad0, rad1) {
      c.beginPath();
      c.arc(g.cx, g.cy, rad1, -Math.PI / 2 + g.ang(c0), -Math.PI / 2 + g.ang(c1));
      c.arc(g.cx, g.cy, rad0, -Math.PI / 2 + g.ang(c1), -Math.PI / 2 + g.ang(c0), true);
      c.closePath(); c.fillStyle = color; c.fill();
    }
    var b0 = g.R + 4 * s, b1 = g.R + 11 * s;
    band(-50, -15, "rgba(176, 58, 30, 0.34)", b0, b1); band(15, 50, "rgba(176, 58, 30, 0.34)", b0, b1);
    band(-15, -3, "rgba(196, 128, 32, 0.38)", b0, b1); band(3, 15, "rgba(196, 128, 32, 0.38)", b0, b1);
    band(-3, 3, "rgba(38, 140, 78, 0.85)", b0 - 1 * s, b1 + 1 * s);
    // engraved ticks: a light edge under a dark cut
    c.lineCap = "round";
    for (var ct = -50; ct <= 50; ct++) {
      var major = ct % 10 === 0, mid = ct % 5 === 0;
      if (!major && !mid && Math.abs(ct) > 10 && ct % 2) continue;
      var len = (major ? 20 : mid ? 13 : 7) * s, a = -Math.PI / 2 + g.ang(ct);
      var x0 = g.cx + Math.cos(a) * g.R, y0 = g.cy + Math.sin(a) * g.R;
      var x1 = g.cx + Math.cos(a) * (g.R - len), y1 = g.cy + Math.sin(a) * (g.R - len);
      c.lineWidth = (major ? 2.4 : mid ? 1.6 : 1.1) * s + 0.2;
      c.strokeStyle = "rgba(255, 250, 235, 0.55)";
      c.beginPath(); c.moveTo(x0, y0 + 1.1 * s); c.lineTo(x1, y1 + 1.1 * s); c.stroke();
      c.strokeStyle = ct === 0 ? "rgba(20, 70, 40, 0.95)" : "rgba(52, 33, 14, 0.9)";
      c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
    }
    // labels
    c.textAlign = "center"; c.textBaseline = "middle";
    var fs = Math.round(15 * s + 3);
    c.font = "700 " + fs + "px Archivo, system-ui, sans-serif";
    for (var lc = -50; lc <= 50; lc += 10) {
      var la = -Math.PI / 2 + g.ang(lc), lr = g.R - 33 * s;
      var lx = g.cx + Math.cos(la) * lr, ly = g.cy + Math.sin(la) * lr;
      var txt = String(Math.abs(lc));
      c.fillStyle = "rgba(255, 250, 235, 0.6)"; c.fillText(txt, lx, ly + 1.1 * s);
      c.fillStyle = lc === 0 ? "rgba(20, 70, 40, 0.92)" : "rgba(58, 37, 16, 0.86)"; c.fillText(txt, lx, ly);
    }
    // flat and sharp marks at the ends
    c.font = "700 " + Math.round(26 * s + 4) + "px Archivo, \"Apple Symbols\", \"Segoe UI Symbol\", \"Noto Music\", system-ui, sans-serif";
    [[-1, "♭"], [1, "♯"]].forEach(function (p) {
      var a = -Math.PI / 2 + p[0] * (SWEEP + 0.07), rr = g.R - 60 * s;
      var x = g.cx + Math.cos(a) * rr, y = g.cy + Math.sin(a) * rr;
      c.fillStyle = "rgba(255, 250, 235, 0.55)"; c.fillText(p[1], x, y + 1.2 * s);
      c.fillStyle = "rgba(58, 37, 16, 0.8)"; c.fillText(p[1], x, y);
    });
    // the legend
    c.font = "800 " + Math.round(10.5 * s + 2) + "px Archivo, system-ui, sans-serif";
    try { c.letterSpacing = Math.round(3 * s + 1) + "px"; } catch (e) {}
    c.fillStyle = "rgba(58, 37, 16, 0.55)";
    c.fillText("CENTS", g.cx, h * 0.6);
    try { c.letterSpacing = Math.round(1 * s) + "px"; } catch (e) {}
    c.font = "600 " + Math.round(10 * s + 2) + "px Archivo, system-ui, sans-serif";
    c.fillStyle = "rgba(58, 37, 16, 0.42)";
    c.fillText("A4 = " + Math.round(a4) + " Hz", g.cx, h * 0.6 + 17 * s + 3);
    try { c.letterSpacing = "0px"; } catch (e) {}
    // edge shadow inside the window: the face sits under the bezel lip
    c.shadowColor = "rgba(0, 0, 0, 0.55)"; c.shadowBlur = 16 * s; c.shadowOffsetY = 5 * s;
    roundRect(c, wx - 30, wy - 30, ww + 60, wh + 60, wr + 30);
    c.lineWidth = 60; c.strokeStyle = "rgba(0,0,0,0.9)"; c.stroke();
    c.restore();
    c.lineWidth = 1; c.strokeStyle = "rgba(255, 225, 180, 0.14)";
    roundRect(c, wx - 0.5, wy - 0.5, ww + 1, wh + 1, wr); c.stroke();
  }

  // The moving part: backlight level, the needle with its shadow, the hood, the glass.
  function paintDial(c, w, h, stat, d) {
    var g = geom(w, h), s = h / 300;
    c.clearRect(0, 0, w, h);
    c.drawImage(stat, 0, 0, w, h);
    var inset = Math.max(4, 7 * s), wr = 14 * s + 2;
    c.save();
    roundRect(c, inset, inset, w - inset * 2, h - inset * 2, wr); c.clip();
    // backlight: dimmed when nothing is ringing
    var dim = (1 - d.light) * 0.55;
    if (dim > 0.002) { c.fillStyle = "rgba(24, 14, 4, " + dim.toFixed(3) + ")"; c.fillRect(0, 0, w, h); }
    // in tune: the green zone lights up and the face takes a breath of green
    if (d.glow > 0.01) {
      var gg = c.createRadialGradient(g.cx, g.cy - g.R, 2, g.cx, g.cy - g.R, g.R * 0.7);
      gg.addColorStop(0, "rgba(90, 255, 150, " + (0.32 * d.glow).toFixed(3) + ")"); gg.addColorStop(1, "rgba(90, 255, 150, 0)");
      c.fillStyle = gg; c.fillRect(0, 0, w, h);
      c.save();
      c.shadowColor = "rgba(70, 230, 130, 0.95)"; c.shadowBlur = 18 * s * d.glow;
      c.beginPath();
      c.arc(g.cx, g.cy, g.R + 7.5 * s, -Math.PI / 2 + g.ang(-3), -Math.PI / 2 + g.ang(3));
      c.lineWidth = 8 * s; c.strokeStyle = "rgba(120, 255, 170, " + (0.85 * d.glow).toFixed(3) + ")"; c.stroke();
      c.restore();
    }
    if (d.flash > 0.01) { c.fillStyle = "rgba(255, 255, 240, " + (0.22 * d.flash).toFixed(3) + ")"; c.fillRect(0, 0, w, h); }
    // the needle
    var a = -Math.PI / 2 + g.ang(d.cents);
    var r0 = h * 0.14, r1 = g.R + 9 * s;
    var ux = Math.cos(a), uy = Math.sin(a), px = -uy, py = ux;
    function needlePath(ox, oy) {
      var bw = 2.6 * s + 0.6, tw = 0.6 * s + 0.35;
      c.beginPath();
      c.moveTo(g.cx + ux * r0 + px * bw + ox, g.cy + uy * r0 + py * bw + oy);
      c.lineTo(g.cx + ux * r1 + px * tw + ox, g.cy + uy * r1 + py * tw + oy);
      c.lineTo(g.cx + ux * (r1 + 2 * s) + ox, g.cy + uy * (r1 + 2 * s) + oy);
      c.lineTo(g.cx + ux * r1 - px * tw + ox, g.cy + uy * r1 - py * tw + oy);
      c.lineTo(g.cx + ux * r0 - px * bw + ox, g.cy + uy * r0 - py * bw + oy);
      c.closePath();
    }
    var ng = c.createLinearGradient(g.cx + ux * r0, g.cy + uy * r0, g.cx + ux * r1, g.cy + uy * r1);
    ng.addColorStop(0, "rgba(22, 16, 10, " + d.needle.toFixed(3) + ")");
    ng.addColorStop(0.74, "rgba(28, 18, 10, " + d.needle.toFixed(3) + ")");
    ng.addColorStop(0.76, "rgba(186, 44, 20, " + d.needle.toFixed(3) + ")");
    ng.addColorStop(1, "rgba(214, 60, 28, " + d.needle.toFixed(3) + ")");
    // the needle floats a few millimeters above the face, so it casts a soft shadow
    c.save();
    c.shadowColor = "rgba(40, 20, 0, " + (0.3 * d.needle).toFixed(3) + ")";
    c.shadowBlur = 6 * s; c.shadowOffsetX = 5 * s; c.shadowOffsetY = 7 * s;
    needlePath(0, 0); c.fillStyle = ng; c.fill();
    c.restore();
    // hood over the pivot: the needle comes out from under it
    var hood = c.createLinearGradient(0, h * 0.84, 0, h);
    hood.addColorStop(0, "#3a3027"); hood.addColorStop(0.2, "#231c16"); hood.addColorStop(1, "#0d0b09");
    c.beginPath(); c.ellipse(g.cx, h * 1.035, w * 0.17, h * 0.2, 0, Math.PI, 2 * Math.PI); c.closePath();
    c.fillStyle = hood; c.fill();
    c.lineWidth = 1.2 * s + 0.3; c.strokeStyle = "rgba(255, 220, 170, 0.18)";
    c.beginPath(); c.ellipse(g.cx, h * 1.035, w * 0.17, h * 0.2, 0, Math.PI * 1.04, Math.PI * 1.96); c.stroke();
    // glass: one long, soft reflection
    var gl = c.createLinearGradient(0, 0, w * 0.55, h * 0.9);
    gl.addColorStop(0, "rgba(255, 255, 255, 0.2)"); gl.addColorStop(0.38, "rgba(255, 255, 255, 0.05)"); gl.addColorStop(0.39, "rgba(255, 255, 255, 0)");
    c.fillStyle = gl; c.fillRect(0, 0, w, h);
    c.restore();
  }

  /* ------------------------------------------------------- the strobe
   * Three bands, the way a strobe shows harmonics: the bottom band moves at
   * the fundamental's error, the ones above at two and four times it. Flat
   * drifts left, sharp drifts right, and in tune everything stands still. */
  var strobeOff = [0, 0, 0], STROBE_H = [1, 2, 4], STROBE_P = 18;
  var barSprites = {};
  function barSprite(color, h) {
    var key = color + h;
    if (barSprites[key]) return barSprites[key];
    var p = Math.round(STROBE_P * DPR), cv = document.createElement("canvas");
    cv.width = p; cv.height = Math.max(1, Math.round(h));
    var c = cv.getContext("2d"), gr = c.createLinearGradient(0, 0, p, 0);
    gr.addColorStop(0, "rgba(0,0,0,0)"); gr.addColorStop(0.16, color); gr.addColorStop(0.5, color); gr.addColorStop(0.84, "rgba(0,0,0,0)");
    c.fillStyle = gr; c.fillRect(0, 0, p, cv.height);
    var vg = c.createLinearGradient(0, 0, 0, cv.height);
    vg.addColorStop(0, "rgba(0,0,0,0.35)"); vg.addColorStop(0.5, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,0.35)");
    c.globalCompositeOperation = "destination-out"; c.fillStyle = vg; c.fillRect(0, 0, p, cv.height);
    barSprites[key] = cv;
    return cv;
  }
  function paintStrobe(dt, d) {
    var c = sctx, w = SW, h = SH;
    if (!w) return;
    c.clearRect(0, 0, w, h);
    var bg = c.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, "#080605"); bg.addColorStop(1, "#16110c");
    roundRect(c, 0, 0, w, h, 10 * DPR); c.fillStyle = bg; c.fill();
    var pad = 6 * DPR, gap = 4 * DPR, rh = (h - pad * 2 - gap * 2) / 3, P = STROBE_P * DPR;
    var fps = dt > 0 ? 1000 / dt : 60;
    var col = d.inTune ? "rgba(190, 255, 214, 0.95)" : "rgba(255, 179, 71, 0.95)";
    for (var r = 0; r < 3; r++) {
      var row = 2 - r;                              // the fastest band on top
      var v = d.active ? STROBE_H[row] * d.cents * 9 * DPR : 0;   // px per second
      var cap = (reduceMotion ? 0.1 : 0.42) * P * Math.min(fps, 75);
      v = clamp(v, -cap, cap);
      strobeOff[row] = (strobeOff[row] + v * dt / 1000) % P;
      var y = pad + r * (rh + gap);
      var per = Math.abs(v) * dt / 1000 / P;        // fraction of a period per frame
      var contrast = reduceMotion ? 1 : clamp(1 - Math.max(0, per - 0.16) * 2.4, 0.18, 1);
      c.globalAlpha = d.lit * contrast;
      var spr = barSprite(col, rh);
      for (var x = strobeOff[row] - P; x < w + P; x += P) c.drawImage(spr, x, y, P, rh);
      if (contrast < 1) { c.globalAlpha = d.lit * (1 - contrast) * 0.45; c.fillStyle = col; c.fillRect(0, y, w, rh); }
      c.globalAlpha = 1;
    }
    // the slot's lip
    var lip = c.createLinearGradient(0, 0, 0, h);
    lip.addColorStop(0, "rgba(0,0,0,0.6)"); lip.addColorStop(0.18, "rgba(0,0,0,0)"); lip.addColorStop(0.82, "rgba(0,0,0,0)"); lip.addColorStop(1, "rgba(0,0,0,0.5)");
    c.fillStyle = lip; c.fillRect(0, 0, w, h);
    var edge = c.createLinearGradient(0, 0, w, 0);
    edge.addColorStop(0, "rgba(8,6,5,0.95)"); edge.addColorStop(0.06, "rgba(8,6,5,0)"); edge.addColorStop(0.94, "rgba(8,6,5,0)"); edge.addColorStop(1, "rgba(8,6,5,0.95)");
    c.fillStyle = edge; c.fillRect(0, 0, w, h);
  }

  function resize() {
    var rd = el.dial.getBoundingClientRect(), rs = el.strobe.getBoundingClientRect();
    var w = Math.max(1, Math.round(rd.width * DPR)), h = Math.max(1, Math.round(rd.height * DPR));
    if (w !== DW || h !== DH) { DW = w; DH = h; el.dial.width = w; el.dial.height = h; dialDirty = true; }
    var sw = Math.max(1, Math.round(rs.width * DPR)), sh = Math.max(1, Math.round(rs.height * DPR));
    if (sw !== SW || sh !== SH) { SW = sw; SH = sh; el.strobe.width = sw; el.strobe.height = sh; barSprites = {}; }
    kick();
  }

  /* -------------------------------------------------------- the loop */

  // needle: a damped spring, slightly underdamped so it swings and settles
  var N = { x: 0, v: 0, light: 0.35, glow: 0, needle: 0.55, lit: 0.25 };
  var flashT = 0, running = false, lastT = 0, lastDom = 0, lastAria = 0, lastSt = null;
  var view = { active: false, holding: false, cents: 0, inTune: false, freq: 0, midi: null };

  function kick() { if (!running) { running = true; lastT = now(); requestAnimationFrame(frame); } }

  function processFrame(buf, sr, tMs) {
    var det = null, e = 0;
    if (tMs >= quietUntil) det = P.detect(buf, sr, detectOpts());
    if (det) e = det.rms;
    else { for (var i = 0; i < buf.length; i += 4) e += buf[i] * buf[i]; e = Math.sqrt(e / (buf.length / 4)); }
    renderVU(e);
    var st = tracker.push(det, tMs);
    var dt = lastSt === null ? 16 : clamp(tMs - lastSt, 1, 200);
    lastSt = tMs;
    judge(st, dt, tMs);
    view.active = st.active; view.holding = st.holding; view.freq = st.freq;
    view.cents = J.cents; view.inTune = st.active && J.inTune; view.midi = J.lastNoteMidi;
    return st;
  }

  var vuLast = -1;
  function renderVU(rms) {
    var db = rms > 0 ? 20 * Math.log(rms) / Math.LN10 : -120;
    var n = db > -14 ? 5 : db > -24 ? 4 : db > -34 ? 3 : db > -44 ? 2 : db > -54 ? 1 : 0;
    var key = n * 2 + (db > -6 ? 1 : 0);
    if (key === vuLast) return;
    vuLast = key;
    for (var i = 0; i < el.vu.length; i++) { el.vu[i].classList.toggle("on", i < n); el.vu[i].classList.toggle("hot", i === 4 && db > -6); }
  }

  function frame() {
    var t = now(), dt = clamp(t - lastT, 1, 100);
    lastT = t;
    if (mic.on && mic.an) {
      mic.an.getFloatTimeDomainData(mic.buf);
      processFrame(mic.buf, A.sampleRate, t);
      // an iPhone quirk: a context made before the mic can hand back silence.
      // If the input is perfectly flat for two seconds, rebuild the input once.
      var flat = mic.buf[0] === 0 && mic.buf[mic.buf.length >> 1] === 0 && mic.buf[mic.buf.length - 1] === 0;
      if (!flat) mic.zeroSince = t;
      else if (t - mic.zeroSince > 2000 && !mic.rebuilt) { mic.rebuilt = true; rebuildInput(); }
    } else if (!feeding) {
      view.active = false; view.holding = false;
    }
    step(dt, t);
    var settled = Math.abs(N.v) < 0.02 && Math.abs(N.x - targetCents()) < 0.05 && flashT <= 0 && !mic.on && !feeding &&
      Math.abs(N.light - lightTarget()) < 0.01 && (N.glow < 0.01 || J.celebrated) && Math.abs(N.lit - (J.celebrated ? 0.8 : 0.22)) < 0.01;
    if (settled && !dialDirty) { running = false; return; }
    requestAnimationFrame(frame);
  }
  function rebuildInput() {
    try {
      var stream = mic.stream;
      mic.src.disconnect();
      mic.src = A.createMediaStreamSource(stream);
      mic.src.connect(mic.hp);
    } catch (e) {}
  }

  function targetCents() { return view.active ? clamp(view.cents, -58, 58) : 0; }
  function lightTarget() { return view.active ? (view.holding ? 0.72 : 1) : J.celebrated ? 0.92 : (mic.on ? 0.55 : 0.4); }

  function step(dt, t) {
    var sec = dt / 1000;
    // spring: about 2.4 Hz, damping ratio 0.55 (a little overshoot, a quick settle)
    var w0 = 2 * Math.PI * (reduceMotion ? 4 : 2.4), z = reduceMotion ? 1 : 0.55;
    var target = targetCents(), sub = Math.max(1, Math.ceil(sec / 0.004)), h = sec / sub;
    for (var i = 0; i < sub; i++) {
      var acc = w0 * w0 * (target - N.x) - 2 * z * w0 * N.v;
      N.v += acc * h; N.x += N.v * h;
      // end stops at +/- 54 cents: the needle knocks against them and comes back
      if (N.x > 54) { N.x = 54; N.v = -Math.abs(N.v) * 0.3; }
      if (N.x < -54) { N.x = -54; N.v = Math.abs(N.v) * 0.3; }
    }
    var k = 1 - Math.exp(-sec / 0.18);
    N.light += (lightTarget() - N.light) * k;
    // in tune lights the green zone; once every string is in, it stays softly lit
    var glowTo = view.inTune && !view.holding ? 1 : (J.celebrated && !view.active ? 0.6 : 0);
    N.glow += (glowTo - N.glow) * (1 - Math.exp(-sec / 0.12));
    N.needle += ((view.active ? 1 : 0.55) - N.needle) * k;
    N.lit += ((view.active ? (view.holding ? 0.55 : 1) : J.celebrated ? 0.8 : 0.22) - N.lit) * k;
    if (flashT > 0) flashT = Math.max(0, flashT - sec * 2.2);

    if (dialDirty || !dialStatic || dialStatic.width !== DW || dialStatic.height !== DH) {
      dialStatic = dialStatic || document.createElement("canvas");
      dialStatic.width = DW; dialStatic.height = DH;
      paintDialStatic(dialStatic.getContext("2d"), DW, DH, S.a4);
      dialDirty = false;
    }
    paintDial(dctx, DW, DH, dialStatic, { cents: N.x, light: N.light, glow: N.glow, needle: N.needle, flash: flashT });
    paintStrobe(dt, { active: view.active && !view.holding, cents: view.cents, inTune: view.inTune || (J.celebrated && !view.active), lit: N.lit });
    if (t - lastDom > 70) { lastDom = t; renderDom(t); }
  }

  function renderDom(t) {
    var u = el.unit;
    u.classList.toggle("is-idle", !view.active);
    u.classList.toggle("is-hold", view.active && view.holding);
    u.classList.toggle("is-in", view.inTune && !view.holding);
    var flat = view.active && !view.inTune && view.cents < 0, sharp = view.active && !view.inTune && view.cents > 0;
    el.flat.classList.toggle("on", flat && !view.holding);
    el.sharp.classList.toggle("on", sharp && !view.holding);
    var ns = notes(), t0 = tuning();
    if (view.midi !== null && view.active) {
      var nm = splitName(view.midi, t0 ? t0.flats : false);
      el.name.textContent = nm.letter; el.acc.textContent = nm.acc; el.oct.textContent = nm.octave;
      var c = Math.round(view.cents);
      el.cents.textContent = (c === 0 ? "± 0" : (c > 0 ? "+" : "−") + Math.abs(c)) + " ¢";
      el.hz.textContent = view.freq.toFixed(view.freq < 1000 ? 2 : 1) + " Hz";
      el.str.textContent = ns.length && J.target >= 0 ? "String " + stringNumber(J.target) : "";
    } else if (!view.active) {
      el.name.textContent = "–"; el.acc.textContent = ""; el.oct.textContent = "";
      el.cents.textContent = "± 0 ¢"; el.hz.textContent = "– Hz"; el.str.textContent = "";
    }
    // the target peg (or pitch-pipe key) glows
    Array.prototype.forEach.call(el.pegs.children, function (col, i) { col.classList.toggle("is-target", view.active && i === J.target); });
    if (!ns.length) {
      var pc = view.active && view.midi !== null ? ((view.midi % 12) + 12) % 12 : -1;
      Array.prototype.forEach.call(el.pipeKeys.children, function (b, i) { if (!b._flash) b.classList.toggle("is-target", i === pc); });
    }
    if (mic.on && view.active && !view.holding && t >= refUntil && !J.celebrated) {
      var a = Math.abs(view.cents), low = view.cents < 0;
      if (ns.length) {
        var lab = stringLabel(J.target);
        if (J.inTune) say(J.tuned[J.target] ? "<b>" + lab + "</b> is in tune. " + remainingText() : "<b>In tune.</b> Hold it there…");
        else if (a > 50) say((low ? "Well below. <b>Tighten</b> the " : "Well above. <b>Loosen</b> the ") + lab + ".");
        else if (a > 15) say(low ? "Too low. <b>Tighten</b> slowly." : "Too high. <b>Loosen</b> slowly.");
        else say(low ? "A little low. Tighten a touch." : "A little high. Ease it down a touch.");
      } else {
        say(J.inTune ? "<b>In tune.</b>" : a > 15 ? (low ? "Flat." : "Sharp.") : (low ? "A little flat." : "A little sharp."));
      }
    }
    if (t - lastAria > 1200) {
      lastAria = t;
      var lbl;
      if (!view.active) lbl = mic.on ? "Tuning needle, listening, no note yet" : "Tuning needle, at rest";
      else {
        var n2 = splitName(view.midi, t0 ? t0.flats : false), cc = Math.round(view.cents);
        lbl = n2.letter + (n2.acc === "♭" ? " flat" : n2.acc === "♯" ? " sharp" : "") + " " + n2.octave + ", " +
          (view.inTune ? "in tune" : Math.abs(cc) + " cents " + (cc < 0 ? "flat" : "sharp"));
      }
      if (el.dial.getAttribute("aria-label") !== lbl) el.dial.setAttribute("aria-label", lbl);
    }
  }

  /* ------------------------------------------------------- share image */

  function drawShare() {
    if (!doneInfo) return null;
    var W = 1200, H = 1000, cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    var c = cv.getContext("2d");
    var bg = c.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#241d16"); bg.addColorStop(1, "#0f0c0a");
    c.fillStyle = bg; c.fillRect(0, 0, W, H);
    var dw = 1040, dh = Math.round(dw * 9.2 / 16), st = document.createElement("canvas");
    st.width = dw; st.height = dh;
    paintDialStatic(st.getContext("2d"), dw, dh, doneInfo.a4);
    var dyn = document.createElement("canvas"); dyn.width = dw; dyn.height = dh;
    paintDial(dyn.getContext("2d"), dw, dh, st, { cents: 0, light: 1, glow: 1, needle: 1, flash: 0 });
    c.drawImage(dyn, (W - dw) / 2, 92);
    // the strings, all green
    var ns = doneInfo.tuning ? doneInfo.tuning.notes : [], n = ns.length, gap = 128, x0 = W / 2 - (n - 1) * gap / 2, y = 92 + dh + 76;
    c.textAlign = "center"; c.textBaseline = "middle";
    ns.forEach(function (m, i) {
      var x = x0 + i * gap, nm = splitName(m, doneInfo.tuning.flats);
      c.save(); c.shadowColor = "rgba(69, 226, 132, 0.8)"; c.shadowBlur = 22;
      c.beginPath(); c.arc(x, y, 44, 0, Math.PI * 2); c.fillStyle = "#45e284"; c.fill(); c.restore();
      var pg = c.createRadialGradient(x - 14, y - 16, 4, x, y, 42);
      pg.addColorStop(0, "#ffffff"); pg.addColorStop(0.3, "#ddd6ca"); pg.addColorStop(1, "#7d766b");
      c.beginPath(); c.arc(x, y, 39, 0, Math.PI * 2); c.fillStyle = pg; c.fill();
      c.fillStyle = "#241a10"; c.font = "800 34px Archivo, system-ui, sans-serif";
      c.fillText(nm.letter + nm.acc, x, y + 2);
    });
    c.fillStyle = "rgba(246, 230, 196, 0.6)"; c.font = "700 26px Archivo, system-ui, sans-serif";
    var t = doneInfo.tuning, k = doneInfo.kind;
    c.fillText(k.label + (t && k.tunings.length > 1 ? " · " + t.label : "") + " · A4 = " + Math.round(doneInfo.a4) + " Hz" + (doneInfo.took > 1500 ? " · " + fmtTime(doneInfo.took) : ""), W / 2, 50);
    return cv;
  }

  /* -------------------------------------------------------------- wiring */

  $("startBtn").addEventListener("click", function () { startMic(true); });
  el.live.addEventListener("click", function () { stopMic(false); });
  $("againBtn").addEventListener("click", function () {
    clearDone(); resetJudge(false); buildPegs();
    say("Marks cleared. Pluck each string again.");
  });
  function holdRepeat(btn, delta) {
    var t1 = null, t2 = null;
    function stop() { clearTimeout(t1); clearInterval(t2); }
    btn.addEventListener("pointerdown", function (e) {
      if (e.button !== 0) return;
      stop();
      t1 = setTimeout(function () { t2 = setInterval(function () { setA4(S.a4 + delta); }, 90); }, 420);
    });
    ["pointerup", "pointerleave", "pointercancel"].forEach(function (ev) { btn.addEventListener(ev, stop); });
    btn.addEventListener("click", function () { setA4(S.a4 + delta); });
  }
  holdRepeat($("refDown"), -1);
  holdRepeat($("refUp"), 1);
  Array.prototype.forEach.call(document.querySelectorAll("[data-ref]"), function (b) {
    b.addEventListener("click", function () { setA4(+b.dataset.ref); });
  });
  $("octDown").addEventListener("click", function () { S.pipeOct = clamp(S.pipeOct - 1, 1, 6); save("tuner_pipe_oct", S.pipeOct); buildPipe(); });
  $("octUp").addEventListener("click", function () { S.pipeOct = clamp(S.pipeOct + 1, 1, 6); save("tuner_pipe_oct", S.pipeOct); buildPipe(); });
  radioKeys(el.kinds); radioKeys(el.tunings);

  // number keys play the strings, low string first, the way they are laid out
  document.addEventListener("keydown", function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var tag = (e.target && e.target.tagName) || "";
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    var n = parseInt(e.key, 10);
    if (n >= 1 && n <= notes().length) { refTap(n - 1); var col = el.pegs.children[n - 1]; if (col) { col.classList.remove("is-pop"); void col.offsetWidth; col.classList.add("is-pop"); } }
  });

  window.addEventListener("resize", resize);
  if (window.ResizeObserver) new ResizeObserver(resize).observe(el.dial);

  // first paint
  resetJudge(false);
  buildKinds(); buildTunings(); buildPegs(); buildPipe(); refreshTitles();
  resize();
  if (document.fonts && document.fonts.load) {
    Promise.all([document.fonts.load("700 16px Archivo"), document.fonts.load("800 16px Archivo")]).then(function () { dialDirty = true; kick(); }, function () {});
  }

  /* --------------------------------------------- automation hook only */
  var feeding = false;
  if (navigator.webdriver) {
    window.__tuner = {
      // push one analysis frame through exactly the path the live loop uses
      feed: function (samples, sr) {
        feeding = true;
        var st = processFrame(samples instanceof Float32Array ? samples : Float32Array.from(samples), sr || (A ? A.sampleRate : 48000), now());
        kick();
        return { active: st.active, holding: st.holding, freq: st.freq, cents: J.cents, target: J.target, inTune: J.inTune };
      },
      endFeed: function () { feeding = false; kick(); },
      state: function () {
        return { kind: S.kind.id, tuning: (tuning() || {}).id || null, a4: S.a4, tuned: J.tuned.slice(), target: J.target, cents: J.cents,
          inTune: J.inTune, celebrated: J.celebrated, mic: mic.on, active: view.active, needle: N.x, fft: mic.an ? mic.an.fftSize : 0,
          sr: A ? A.sampleRate : 0, quiet: Math.max(0, quietUntil - now()), note: el.name.textContent + el.acc.textContent + el.oct.textContent };
      },
      pegCenters: function () {
        return Array.prototype.map.call(el.pegs.querySelectorAll(".tn-peg"), function (b) { var r = b.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
      }
    };
  }
})();
