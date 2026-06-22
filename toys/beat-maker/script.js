/* Beat Maker — a 16-step sequencer.
 * Pentatonic melody rows (every pattern stays consonant) + kick / snare / hat.
 * Web Audio with iOS unlock; pattern + tempo saved locally.
 */
(function () {
  "use strict";

  var seqEl = document.getElementById("seq");
  var playBtn = document.getElementById("playBtn");
  var randBtn = document.getElementById("randBtn");
  var clearBtn = document.getElementById("clearBtn");
  var tempoEl = document.getElementById("tempo");
  var bpmEl = document.getElementById("bpm");
  var hintEl = document.getElementById("hint");

  var STEPS = 16;
  // melodic rows, displayed high → low; C major pentatonic over two octaves
  var MEL = [659.25, 587.33, 523.25, 440.0, 392.0, 329.63, 293.66, 261.63]; // E5..C4
  // rows model (top → bottom)
  var rows = [];
  MEL.forEach(function (f, k) {
    var hue = 280 - k * 26; // violet → cyan/green gradient down the melody
    rows.push({ type: "mel", freq: f, hue: hue });
  });
  rows.push({ type: "drum", drum: "hat", hue: 188, divider: true });
  rows.push({ type: "drum", drum: "snare", hue: 330 });
  rows.push({ type: "drum", drum: "kick", hue: 28 });

  var R = rows.length;
  var KEY = "opt-beatmaker-v1";

  // pattern[r][s]
  var pattern = [];
  for (var r = 0; r < R; r++) { pattern.push(new Array(STEPS).fill(false)); }
  var bpm = 110;

  // ---- restore ----
  (function load() {
    try {
      var raw = localStorage.getItem(KEY); if (!raw) return seedDemo();
      var s = JSON.parse(raw);
      if (s && Array.isArray(s.pattern) && s.pattern.length === R) {
        for (var i = 0; i < R; i++) for (var j = 0; j < STEPS; j++) pattern[i][j] = !!(s.pattern[i] && s.pattern[i][j]);
      }
      bpm = Math.min(170, Math.max(70, +s.bpm || 110));
    } catch (e) { seedDemo(); }
  })();
  function seedDemo() {
    // a gentle starting groove so it's instantly satisfying
    setCell(R - 1, 0, true); setCell(R - 1, 8, true);          // kick on 1 & 3
    setCell(R - 2, 4, true); setCell(R - 2, 12, true);         // snare on 2 & 4
    for (var s = 0; s < STEPS; s += 2) setCell(R - 3, s, true); // hats on 8ths
    setCell(5, 0, true); setCell(3, 6, true); setCell(7, 10, true); // a few notes
  }
  function setCell(rr, ss, v) { if (pattern[rr]) pattern[rr][ss] = v; }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify({ pattern: pattern, bpm: bpm })); } catch (e) {}
  }

  // ---- build grid ----
  var cellEls = [];
  for (r = 0; r < R; r++) {
    var rowEl = document.createElement("div");
    rowEl.className = "seq__row" + (rows[r].divider ? " is-divider" : "");
    var rowCells = [];
    for (var s2 = 0; s2 < STEPS; s2++) {
      var c = document.createElement("button");
      c.type = "button";
      c.className = "cell" + (s2 % 4 === 0 ? " beat4" : "");
      c.dataset.r = r; c.dataset.s = s2;
      rowEl.appendChild(c);
      rowCells.push(c);
    }
    seqEl.appendChild(rowEl);
    cellEls.push(rowCells);
  }
  function cellColor(rr) { return "hsl(" + rows[rr].hue + ",85%,60%)"; }
  function paintCell(rr, ss) {
    var el = cellEls[rr][ss], on = pattern[rr][ss];
    if (on) {
      el.classList.add("on");
      el.style.background = cellColor(rr);
      el.style.boxShadow = "inset 0 0 0 1px rgba(255,255,255,0.4), 0 0 12px " + cellColor(rr);
    } else {
      el.classList.remove("on");
      el.style.background = "";
      el.style.boxShadow = "";
    }
  }
  function paintAll() { for (var i = 0; i < R; i++) for (var j = 0; j < STEPS; j++) paintCell(i, j); }
  paintAll();

  // ---- audio ----
  var actx = null, master = null, wet = null;
  function ensureAudio() {
    if (actx) { if (actx.state === "suspended") actx.resume(); return; }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    actx = new AC();
    master = actx.createGain(); master.gain.value = 0.9; master.connect(actx.destination);
    // a touch of echo for space (melody send)
    var dl = actx.createDelay(1.0); dl.delayTime.value = 60 / bpm / 2; // dotted-ish
    var fb = actx.createGain(); fb.gain.value = 0.22;
    wet = actx.createGain(); wet.gain.value = 0.28;
    dl.connect(fb); fb.connect(dl); dl.connect(wet); wet.connect(master);
    actx._delay = dl;
    if (actx.state === "suspended") actx.resume();
    try { var b = actx.createBuffer(1, 1, 22050); var sNode = actx.createBufferSource(); sNode.buffer = b; sNode.connect(actx.destination); sNode.start(0); } catch (e) {}
  }

  function note(freq, t) {
    var o = actx.createOscillator(), o2 = actx.createOscillator(), g = actx.createGain(), lp = actx.createBiquadFilter();
    o.type = "triangle"; o2.type = "sine"; o.frequency.value = freq; o2.frequency.value = freq; o2.detune.value = 6;
    lp.type = "lowpass"; lp.frequency.value = Math.min(3200, freq * 5); lp.Q.value = 0.5;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.32, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
    o.connect(g); o2.connect(g); g.connect(lp); lp.connect(master); if (wet) lp.connect(actx._delay);
    o.start(t); o2.start(t); o.stop(t + 0.45); o2.stop(t + 0.45);
  }
  function kick(t) {
    var o = actx.createOscillator(), g = actx.createGain();
    o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(48, t + 0.12);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.9, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.32);
  }
  function noiseBurst(t, dur) {
    var n = Math.floor(actx.sampleRate * dur), buf = actx.createBuffer(1, n, actx.sampleRate), d = buf.getChannelData(0);
    for (var i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    var src = actx.createBufferSource(); src.buffer = buf; return src;
  }
  function snare(t) {
    var src = noiseBurst(t, 0.2), bp = actx.createBiquadFilter(), g = actx.createGain();
    bp.type = "bandpass"; bp.frequency.value = 1800; bp.Q.value = 0.7;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    src.connect(bp); bp.connect(g); g.connect(master); src.start(t); src.stop(t + 0.2);
  }
  function hat(t) {
    var src = noiseBurst(t, 0.06), hp = actx.createBiquadFilter(), g = actx.createGain();
    hp.type = "highpass"; hp.frequency.value = 7000;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.22, t + 0.003); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    src.connect(hp); hp.connect(g); g.connect(master); src.start(t); src.stop(t + 0.06);
  }
  function trigger(rr, t) {
    var row = rows[rr];
    if (row.type === "mel") note(row.freq, t);
    else if (row.drum === "kick") kick(t);
    else if (row.drum === "snare") snare(t);
    else hat(t);
  }

  // ---- transport ----
  var playing = false, step = 0, timer = null;
  function stepDur() { return 60 / bpm / 4; } // 16th notes

  function tick() {
    var t = actx ? actx.currentTime + 0.02 : 0;
    // clear previous playhead (step starts at -1 before the first advance)
    if (step >= 0) {
      for (var i = 0; i < R; i++) {
        cellEls[i][step].classList.remove("play");
        cellEls[i][step].classList.remove("flash");
      }
    }
    step = (step + 1) % STEPS;
    // light + sound current
    for (i = 0; i < R; i++) {
      cellEls[i][step].classList.add("play");
      if (pattern[i][step]) { trigger(i, t); cellEls[i][step].classList.add("flash"); }
    }
    timer = setTimeout(tick, stepDur() * 1000);
  }
  function play() {
    ensureAudio();
    playing = true; step = -1;
    playBtn.classList.add("is-playing");
    playBtn.querySelector(".lbl").textContent = "Pause";
    hideHint();
    tick();
    track("beat_play", {});
  }
  function stop() {
    playing = false;
    if (timer) clearTimeout(timer);
    playBtn.classList.remove("is-playing");
    playBtn.querySelector(".lbl").textContent = "Play";
    for (var i = 0; i < R; i++) for (var j = 0; j < STEPS; j++) { cellEls[i][j].classList.remove("play"); cellEls[i][j].classList.remove("flash"); }
  }

  // ---- input ----
  seqEl.addEventListener("pointerdown", function (e) {
    var c = e.target.closest(".cell"); if (!c) return;
    e.preventDefault();
    var rr = +c.dataset.r, ss = +c.dataset.s;
    pattern[rr][ss] = !pattern[rr][ss];
    paintCell(rr, ss);
    if (pattern[rr][ss]) { ensureAudio(); if (actx) trigger(rr, actx.currentTime + 0.01); }
    hideHint(); save();
  });

  playBtn.addEventListener("click", function () { if (playing) stop(); else play(); });
  tempoEl.addEventListener("input", function () {
    bpm = +tempoEl.value; bpmEl.textContent = bpm;
    if (actx && actx._delay) actx._delay.delayTime.value = 60 / bpm / 2;
    save();
  });
  clearBtn.addEventListener("click", function () {
    for (var i = 0; i < R; i++) for (var j = 0; j < STEPS; j++) pattern[i][j] = false;
    paintAll(); save();
  });
  randBtn.addEventListener("click", function () {
    ensureAudio();
    for (var i = 0; i < R; i++) {
      var row = rows[i];
      var density = row.type === "drum" ? (row.drum === "hat" ? 0.5 : row.drum === "kick" ? 0.28 : 0.2) : 0.16;
      for (var j = 0; j < STEPS; j++) pattern[i][j] = Math.random() < density;
    }
    paintAll(); save();
    track("beat_random", {});
  });

  tempoEl.value = bpm; bpmEl.textContent = bpm;

  function hideHint() { if (hintEl) hintEl.classList.add("is-hidden"); }
  function track(name, params) { try { if (typeof window.gtag === "function") window.gtag("event", name, params || {}); } catch (e) {} }

  setTimeout(hideHint, 8000);
})();
