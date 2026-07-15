/* Pomodoro Timer — focused sprints, breaks, a draining ring, gentle chimes. */
(function () {
  "use strict";

  var C = 2 * Math.PI * 132;            // ring circumference
  var TITLE = "Pomodoro Timer — One Page Toys";
  var $ = function (id) { return document.getElementById(id); };
  var body = document.body;
  var timeEl = $("time"), phaseEl = $("phase"), dotsEl = $("dots");
  var ringProg = $("ringProg"), startBtn = $("startBtn"), resetBtn = $("resetBtn");
  var soundBtn = $("soundBtn"), lengths = $("lengths");

  var settings = { workMin: 25, sound: true };
  try {
    var s = JSON.parse(localStorage.getItem("pomo_settings") || "null");
    if (s) settings = Object.assign(settings, s);
  } catch (e) {}

  var phase = "focus";       // focus | short | long
  var cycle = 0;             // completed focus sessions toward the long break (0..4)
  var running = false;
  var total = settings.workMin * 60;   // seconds in the current phase
  var remaining = total;               // seconds left (when paused)
  var endAt = 0;                       // ms timestamp when running
  var tickTimer = null;

  function phaseLen(p) {
    var w = settings.workMin;
    if (p === "focus") return w * 60;
    if (p === "short") return Math.max(5, Math.round(w * 0.2)) * 60;
    return Math.max(15, Math.round(w * 0.6)) * 60;   // long
  }
  function phaseName(p) { return p === "focus" ? "Focus" : p === "short" ? "Short break" : "Long break"; }

  function fmt(secs) {
    secs = Math.max(0, Math.ceil(secs));
    var m = Math.floor(secs / 60), s = secs % 60;
    return m + ":" + (s < 10 ? "0" : "") + s;
  }

  function renderDots() {
    dotsEl.innerHTML = "";
    for (var i = 0; i < 4; i++) {
      var d = document.createElement("span");
      d.className = "dot" + (i < cycle ? " is-done" : "");
      dotsEl.appendChild(d);
    }
  }
  function popDot(i) {
    var d = dotsEl.children[i];
    if (d) { d.classList.add("is-done", "is-pop"); }
  }

  function draw(exactRemainingMs) {
    var remMs = exactRemainingMs != null ? exactRemainingMs : remaining * 1000;
    var frac = total > 0 ? Math.max(0, Math.min(1, remMs / (total * 1000))) : 0;
    ringProg.style.strokeDashoffset = (C * (1 - frac)).toFixed(2);
    timeEl.textContent = fmt(remMs / 1000);
  }

  function renderPhase() {
    body.setAttribute("data-phase", phase);
    phaseEl.textContent = phaseName(phase);
  }

  function updateTitle() {
    document.title = running ? fmt(remaining) + " · " + phaseName(phase) : TITLE;
  }

  // ---- transport ----
  function start() {
    if (running) return;
    unlockAudio();
    running = true;
    endAt = Date.now() + remaining * 1000;
    startBtn.textContent = "Pause";
    lockLengths(true);
    tick();
    tickTimer = setInterval(tick, 200);
  }
  function pause() {
    if (!running) return;
    running = false;
    remaining = Math.max(0, (endAt - Date.now()) / 1000);
    clearInterval(tickTimer); tickTimer = null;
    startBtn.textContent = "Start";
    remaining = Math.ceil(remaining);
    draw(); updateTitle(); lockLengths(false);
  }
  function reset() {
    running = false;
    clearInterval(tickTimer); tickTimer = null;
    total = phaseLen(phase);
    remaining = total;
    startBtn.textContent = "Start";
    draw(); updateTitle(); lockLengths(false);
  }
  function tick() {
    var remMs = endAt - Date.now();
    if (remMs <= 0) { complete(); return; }
    remaining = Math.ceil(remMs / 1000);
    draw(remMs); updateTitle();
  }

  function complete() {
    var wasFocus = phase === "focus";
    if (wasFocus) {
      chime("break");
      cycle = Math.min(4, cycle + 1);
      popDot(cycle - 1);
      phase = cycle >= 4 ? "long" : "short";
    } else {
      chime("focus");
      if (phase === "long") { cycle = 0; renderDots(); }
      phase = "focus";
    }
    total = phaseLen(phase);
    remaining = total;
    renderPhase();
    // auto-start the next phase
    endAt = Date.now() + total * 1000;
    running = true;
    startBtn.textContent = "Pause";
    draw(); updateTitle();
    if (!tickTimer) tickTimer = setInterval(tick, 200);
  }

  function lockLengths(lock) {
    var b = lengths.querySelectorAll(".len");
    for (var i = 0; i < b.length; i++) b[i].disabled = lock;
  }

  startBtn.addEventListener("click", function () { running ? pause() : start(); });
  resetBtn.addEventListener("click", reset);

  lengths.addEventListener("click", function (e) {
    var b = e.target.closest(".len");
    if (!b || b.disabled) return;
    settings.workMin = parseInt(b.getAttribute("data-min"), 10) || 25;
    saveSettings();
    var on = lengths.querySelectorAll(".len");
    for (var i = 0; i < on.length; i++) on[i].classList.toggle("is-on", on[i] === b);
    if (phase === "focus") reset();   // apply the new length to the focus timer
  });

  function saveSettings() { try { localStorage.setItem("pomo_settings", JSON.stringify(settings)); } catch (e) {} }

  // keyboard: space toggles start/pause
  window.addEventListener("keydown", function (e) {
    if (e.code === "Space" && e.target === document.body) { e.preventDefault(); running ? pause() : start(); }
  });

  // pause the ticking when the tab is hidden is unnecessary (endAt is wall-clock),
  // but refresh on return so the display is exact
  document.addEventListener("visibilitychange", function () { if (!document.hidden && running) tick(); });

  // ============================ AUDIO ============================
  var actx = null, master = null, convo = null, wet = null;
  function unlockAudio() {
    if (actx) { if (actx.state === "suspended") actx.resume(); return; }
    try {
      actx = new (window.AudioContext || window.webkitAudioContext)();
      master = actx.createGain(); master.gain.value = settings.sound ? 0.9 : 0;
      master.connect(actx.destination);
      convo = actx.createConvolver(); convo.buffer = impulse(2.4, 3);
      wet = actx.createGain(); wet.gain.value = 0.5; wet.connect(master); convo.connect(wet);
      var b = actx.createBuffer(1, 1, 22050), src = actx.createBufferSource();
      src.buffer = b; src.connect(actx.destination); src.start(0);
    } catch (e) { actx = null; }
  }
  function impulse(dur, decay) {
    var n = Math.floor(actx.sampleRate * dur), buf = actx.createBuffer(2, n, actx.sampleRate);
    for (var ch = 0; ch < 2; ch++) {
      var d = buf.getChannelData(ch), lp = 0;
      for (var i = 0; i < n; i++) { var t = i / n, raw = (Math.random() * 2 - 1) * Math.pow(1 - t, decay); lp += (raw - lp) * 0.18; d[i] = lp; }
    }
    return buf;
  }
  function bell(t, f, vol, dur) {
    // soft glassy bell: fundamental + a couple of decaying partials
    [[1, vol], [2.01, vol * 0.4], [3.02, vol * 0.16]].forEach(function (p) {
      var o = actx.createOscillator(); o.type = "sine"; o.frequency.value = f * p[0];
      var g = actx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(p[1], t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0006, t + dur);
      o.connect(g); g.connect(master); g.connect(convo);
      o.start(t); o.stop(t + dur + 0.05);
    });
  }
  function chime(kind) {
    if (!actx || !settings.sound) return;
    var t = actx.currentTime;
    // break = gentle descending; focus = brighter rising "ready"
    var notes = kind === "focus" ? [523.25, 659.25, 783.99] : [783.99, 587.33, 523.25];
    notes.forEach(function (f, i) { bell(t + i * 0.16, f, 0.24, 1.6); });
  }
  soundBtn.addEventListener("click", function () {
    settings.sound = !settings.sound; saveSettings();
    soundBtn.setAttribute("aria-pressed", settings.sound ? "true" : "false");
    soundBtn.setAttribute("aria-label", settings.sound ? "Sound on" : "Sound off");
    soundBtn.title = settings.sound ? "Sound on" : "Sound off";
    unlockAudio();
    if (master) master.gain.value = settings.sound ? 0.9 : 0;
  });

  // ---- boot ----
  var onchip = lengths.querySelectorAll(".len");
  for (var i = 0; i < onchip.length; i++) onchip[i].classList.toggle("is-on", parseInt(onchip[i].getAttribute("data-min"), 10) === settings.workMin);
  soundBtn.setAttribute("aria-pressed", settings.sound ? "true" : "false");
  renderPhase();
  renderDots();
  reset();
})();
