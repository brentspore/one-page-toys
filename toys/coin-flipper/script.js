/* Coin Flip — a tactile 3D gold coin that tosses, tumbles, and lands fair.
 * Heads = rotateX ≡ 0°, Tails = 180°. Cryptographically fair bit, stats + history.
 */
(function () {
  "use strict";

  var coin = document.getElementById("coin");
  var stage = document.getElementById("coinStage");
  var shadow = document.getElementById("shadow");
  var resultEl = document.getElementById("result");
  var flipBtn = document.getElementById("flipBtn");
  var resetBtn = document.getElementById("resetBtn");
  var soundBtn = document.getElementById("soundBtn");
  var hint = document.getElementById("hint");
  var historyEl = document.getElementById("history");
  var ratioFill = document.getElementById("ratioFill");
  var sHeads = document.getElementById("sHeads");
  var sTails = document.getElementById("sTails");
  var sStreak = document.getElementById("sStreak");
  var sTotal = document.getElementById("sTotal");
  if (!coin) return;

  var reduceMotion =
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---- build the coin (thickness discs + two faces) --------------------
  var t = 9;
  var N = 14;
  for (var i = 0; i < N; i++) {
    var z = -t + (2 * t * i) / (N - 1);
    var disc = document.createElement("div");
    disc.className = "coin__disc";
    disc.style.transform = "translateZ(" + z.toFixed(2) + "px)";
    coin.appendChild(disc);
  }
  function face(cls, emblem) {
    var f = document.createElement("div");
    f.className = "coin__face " + cls;
    var e = document.createElement("span");
    e.className = "coin__emblem";
    e.textContent = emblem;
    f.appendChild(e);
    coin.appendChild(f);
  }
  face("coin__face--h", "H");
  face("coin__face--t", "T");

  // ---- state ------------------------------------------------------------
  var rot = 0, busy = false;
  var heads = 0, tails = 0, streak = 0, total = 0, lastSide = null;
  var history = [];
  var soundOn = true;

  function fairBit() {
    try {
      var a = new Uint8Array(1);
      crypto.getRandomValues(a);
      return a[0] & 1;
    } catch (e) {
      return Math.random() < 0.5 ? 0 : 1;
    }
  }
  function easeOutCubic(p) { return 1 - Math.pow(1 - p, 3); }

  function render() {
    sHeads.textContent = heads;
    sTails.textContent = tails;
    sStreak.textContent = streak;
    sTotal.textContent = total;
    ratioFill.style.width = (total ? (heads / total) * 100 : 50).toFixed(1) + "%";
    historyEl.innerHTML = "";
    for (var i = 0; i < history.length; i++) {
      var li = document.createElement("li");
      li.className = history[i];
      historyEl.appendChild(li);
    }
  }

  // ---- toss -------------------------------------------------------------
  function arcOf(p) {
    // main hop, then a small settle bounce
    if (p < 0.82) return Math.sin(Math.PI * (p / 0.82));
    return 0.12 * Math.sin(Math.PI * ((p - 0.82) / 0.18));
  }

  function flip() {
    if (busy) return;
    busy = true;
    if (hint && !hint.classList.contains("is-hidden")) hint.classList.add("is-hidden");

    var isHeads = fairBit() === 0;
    var startRot = rot;
    var spins = reduceMotion ? 1 : 4 + Math.floor(Math.random() * 3);
    var curMod = ((startRot % 360) + 360) % 360;
    var targetMod = isHeads ? 0 : 180;
    var delta = targetMod - curMod;
    if (delta < 0) delta += 360;
    var endRot = startRot + spins * 360 + delta;

    var dur = reduceMotion ? 320 : 1200;
    var arcH = reduceMotion ? 16 : Math.min(280, window.innerHeight * 0.3);
    var t0 = 0;
    if (soundOn) tone("launch");

    function loop(ts) {
      if (!t0) t0 = ts;
      var p = Math.min(1, (ts - t0) / dur);
      var cur = startRot + (endRot - startRot) * easeOutCubic(p);
      var a = arcOf(p);
      coin.style.transform = "translateY(" + (-arcH * a).toFixed(1) + "px) rotateX(" + cur.toFixed(1) + "deg)";
      shadow.style.setProperty("--sh", (1 - 0.45 * a).toFixed(3));
      shadow.style.setProperty("--sho", (0.45 * (1 - 0.55 * a)).toFixed(3));
      if (p < 1) { requestAnimationFrame(loop); return; }
      rot = endRot;
      land(isHeads);
    }
    requestAnimationFrame(loop);
  }

  function land(isHeads) {
    if (isHeads) {
      heads++;
      streak = lastSide === "h" ? streak + 1 : 1;
      lastSide = "h";
    } else {
      tails++;
      streak = lastSide === "t" ? streak + 1 : 1;
      lastSide = "t";
    }
    total++;
    history.unshift(isHeads ? "h" : "t");
    if (history.length > 16) history.pop();
    resultEl.textContent = isHeads ? "Heads" : "Tails";
    resultEl.classList.remove("result--pop");
    void resultEl.offsetWidth; // restart animation
    resultEl.classList.add("result--pop");
    render();
    if (soundOn) tone("land");
    busy = false;
  }

  // ---- sound (metallic ting) -------------------------------------------
  var actx = null;
  function ensureAudio() {
    if (!actx) {
      try { actx = new (window.AudioContext || window.webkitAudioContext)(); }
      catch (e) { actx = null; }
    }
    if (actx && actx.state === "suspended") actx.resume();
  }
  function ping(freq, when, dur, vol, type) {
    var o = actx.createOscillator();
    var g = actx.createGain();
    o.type = type || "sine";
    o.frequency.setValueAtTime(freq, when);
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(vol, when + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    o.connect(g).connect(actx.destination);
    o.start(when);
    o.stop(when + dur + 0.02);
  }
  function tone(kind) {
    if (!actx) return;
    var now = actx.currentTime;
    if (kind === "launch") {
      ping(520, now, 0.09, 0.12, "triangle");
    } else {
      // bright metallic ting: two inharmonic partials + soft body
      ping(1180, now, 0.5, 0.22, "sine");
      ping(1760, now, 0.42, 0.13, "sine");
      ping(620, now, 0.32, 0.14, "triangle");
    }
  }

  // ---- wires ------------------------------------------------------------
  function doFlip() { ensureAudio(); flip(); }
  stage.addEventListener("click", doFlip);
  flipBtn.addEventListener("click", doFlip);

  resetBtn.addEventListener("click", function () {
    heads = tails = streak = total = 0;
    lastSide = null;
    history = [];
    rot = rot % 360;
    coin.style.transform = "translateY(0) rotateX(" + rot + "deg)";
    resultEl.textContent = "Flip to start";
    render();
  });

  soundBtn.addEventListener("click", function () {
    soundOn = !soundOn;
    if (soundOn) ensureAudio();
    soundBtn.textContent = soundOn ? "Sound on" : "Sound off";
    soundBtn.setAttribute("aria-pressed", soundOn ? "true" : "false");
  });

  window.addEventListener("keydown", function (e) {
    if (e.code === "Space" || e.code === "Enter") {
      if (document.activeElement && /^(BUTTON|A)$/.test(document.activeElement.tagName) && document.activeElement !== stage) return;
      e.preventDefault();
      doFlip();
    }
  });

  // ---- init -------------------------------------------------------------
  coin.style.transform = "translateY(0) rotateX(0deg)";
  render();
})();
