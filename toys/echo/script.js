/* Echo — Simon-style sequence memory.
 * Watch a growing pattern of light + tone, then repeat it back. One mistake ends
 * the run; your longest sequence is saved locally.
 */
(function () {
  "use strict";

  var simon = document.getElementById("simon");
  var pads = [].slice.call(document.querySelectorAll(".pad"));
  var hub = document.getElementById("hub");
  var hubNum = document.getElementById("hubNum");
  var hubLabel = document.getElementById("hubLabel");
  var hubBest = document.getElementById("hubBest");
  var statusEl = document.getElementById("status");
  var hintEl = document.getElementById("hint");

  var FREQS = [196.0, 261.63, 329.63, 392.0]; // G3 C4 E4 G4 — warm, calm pentatonic
  var KEY = "opt-echo-best";
  var best = +(localStorage.getItem(KEY) || 0);
  hubBest.textContent = "Best " + best;

  var seq = [], pos = 0, state = "idle"; // idle | show | input | over
  var timers = [];

  // ---- audio ----
  var actx = null, master = null;
  function ensureAudio() {
    if (actx) { if (actx.state === "suspended") actx.resume(); return; }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    actx = new AC();
    master = actx.createGain(); master.gain.value = 0.4; master.connect(actx.destination);
    if (actx.state === "suspended") actx.resume();
    try { var b = actx.createBuffer(1, 1, 22050); var s = actx.createBufferSource(); s.buffer = b; s.connect(actx.destination); s.start(0); } catch (e) {}
  }
  function tone(i, dur) {
    if (!actx) return;
    var now = actx.currentTime, f = FREQS[i];
    var o1 = actx.createOscillator(), o2 = actx.createOscillator();
    var g = actx.createGain(), g2 = actx.createGain(), lp = actx.createBiquadFilter();
    o1.type = "sine"; o2.type = "sine";
    o1.frequency.value = f; o2.frequency.value = f * 2; o2.detune.value = -3; // soft octave shimmer
    g2.gain.value = 0.22;                                  // overtone kept quiet
    lp.type = "lowpass"; lp.frequency.value = Math.min(2200, f * 5); lp.Q.value = 0.3; // round off edges
    var d = Math.max(0.55, dur / 1000);                   // gentle minimum length
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(0.3, now + 0.05);      // soft attack
    g.gain.exponentialRampToValueAtTime(0.0001, now + d + 0.22); // long, mellow release
    o1.connect(g); o2.connect(g2); g2.connect(g); g.connect(lp); lp.connect(master);
    var stop = now + d + 0.3;
    o1.start(now); o2.start(now); o1.stop(stop); o2.stop(stop);
  }
  function buzz() {
    if (!actx) return;
    var now = actx.currentTime, o = actx.createOscillator(), g = actx.createGain();
    o.type = "triangle"; o.frequency.setValueAtTime(180, now); o.frequency.exponentialRampToValueAtTime(70, now + 0.6);
    g.gain.setValueAtTime(0.0001, now); g.gain.linearRampToValueAtTime(0.22, now + 0.05); g.gain.exponentialRampToValueAtTime(0.0001, now + 0.7);
    o.connect(g); g.connect(master); o.start(now); o.stop(now + 0.6);
  }

  // ---- helpers ----
  function clearTimers() { timers.forEach(clearTimeout); timers = []; }
  function later(fn, ms) { var t = setTimeout(fn, ms); timers.push(t); return t; }
  function flash(i, dur) {
    var pad = pads[i]; pad.classList.add("is-lit"); tone(i, dur);
    later(function () { pad.classList.remove("is-lit"); }, dur);
  }
  function setStatus(text, cls) {
    statusEl.textContent = text;
    statusEl.className = "status" + (cls ? " is-" + cls : "");
  }
  function hideHint() { if (hintEl) hintEl.classList.add("is-hidden"); }

  // ---- flow ----
  function start() {
    ensureAudio(); hideHint();
    clearTimers();
    seq = []; state = "show";
    simon.classList.remove("is-over");
    nextRound();
  }
  function nextRound() {
    pos = 0; state = "show";
    seq.push((Math.random() * 4) | 0);
    hubNum.textContent = seq.length;
    hubLabel.textContent = "Watch";
    hub.classList.remove("is-pulse");
    setStatus("Watch closely…");
    simon.classList.add("is-locked");

    var speed = Math.max(230, 560 - (seq.length - 1) * 22); // light duration
    var gap = Math.max(90, speed * 0.4);
    var t = 520; // initial pause before playback
    seq.forEach(function (idx) {
      later(function () { flash(idx, speed); }, t);
      t += speed + gap;
    });
    later(function () { beginInput(); }, t + 60);
  }
  function beginInput() {
    state = "input"; pos = 0;
    simon.classList.remove("is-locked");
    hubLabel.textContent = "Your turn";
    hub.classList.add("is-pulse");
    setStatus("Your turn — repeat the pattern", "good");
  }
  function gameOver() {
    state = "over"; clearTimers();
    simon.classList.add("is-over", "is-locked");
    hub.classList.remove("is-pulse");
    buzz();
    var reached = seq.length - 1;          // completed rounds
    if (reached > best) { best = reached; localStorage.setItem(KEY, String(best)); }
    hubBest.textContent = "Best " + best;
    hubNum.textContent = "✕";
    hubLabel.textContent = "Retry";
    setStatus("Game over — you reached " + reached + ". Tap the center to try again.", "bad");
    track("echo_over", { reached: reached, best: best });
  }
  function handlePad(i) {
    if (state !== "input") return;
    flash(i, 220);
    if (seq[pos] === i) {
      pos++;
      if (pos === seq.length) {
        // round cleared
        state = "show";
        simon.classList.add("is-locked");
        hub.classList.remove("is-pulse");
        setStatus("Nice — next round", "good");
        later(nextRound, 760);
      }
    } else {
      gameOver();
    }
  }

  function track(name, params) {
    try { if (typeof window.gtag === "function") window.gtag("event", name, params || {}); } catch (e) {}
  }

  // ---- input wiring ----
  pads.forEach(function (pad) {
    pad.addEventListener("pointerdown", function (e) {
      e.preventDefault();
      handlePad(+pad.dataset.i);
    });
  });
  hub.addEventListener("pointerdown", function (e) {
    e.preventDefault();
    if (state === "idle" || state === "over") start();
  });
  // keyboard: 1-4 / arrows
  var keyMap = { "1": 0, "2": 1, "3": 2, "4": 3, q: 0, w: 1, a: 2, s: 3 };
  window.addEventListener("keydown", function (e) {
    if (e.key === " " || e.key === "Enter") { if (state === "idle" || state === "over") { e.preventDefault(); start(); } return; }
    var k = e.key.toLowerCase();
    if (k in keyMap) handlePad(keyMap[k]);
  });

  // idle pulse invites a tap
  hub.classList.add("is-pulse");
  setTimeout(hideHint, 7000);
})();
