/* Chimp Test — numeric working memory, with attitude.
 * Click 1, the rest hide, tap them in ascending order from memory. +1 each round.
 * Modes: Classic (hide on first click) · Flash (all hide after a beat) · Lightning (blink & gone).
 * A chimp watches and judges you. Beat Ayumu (~9 at a fifth of a second).
 */
(function () {
  "use strict";

  var board = document.getElementById("board");
  var overlay = document.getElementById("overlay");
  var startBtn = document.getElementById("startBtn");
  var cardTitle = document.getElementById("cardTitle");
  var cardBody = document.getElementById("cardBody");
  var cardEyebrow = document.getElementById("cardEyebrow");
  var numCount = document.getElementById("numCount");
  var bestEl = document.getElementById("best");
  var livesEl = document.getElementById("lives");
  var hintEl = document.getElementById("hint");
  var fx = document.getElementById("fx");
  var chimpFace = document.getElementById("chimpFace");
  var chimpBubble = document.getElementById("chimpBubble");
  var modeWrap = document.getElementById("modes");

  var START_LEVEL = 4, MAX_LIVES = 3;
  var CHIMP_BENCH = 9;                  // Ayumu's famous feat
  var level = START_LEVEL, lives = MAX_LIVES;
  var state = "idle";                   // idle | show | recall | wait | over
  var expected = 1, roundStart = 0;
  var tiles = [];
  var COLS = 8, ROWS = 5;
  var flashTimer = null, bubbleTimer = null;

  var mode = localStorage.getItem("opt-chimp-mode") || "classic";
  function bestKey() { return "opt-chimp-best-" + mode; }
  function getBest() { return +(localStorage.getItem(bestKey()) || 0); }
  function showBest() { bestEl.textContent = getBest(); }

  // ---- audio --------------------------------------------------------------
  var actx = null;
  function audioOn() {
    if (actx) { if (actx.state === "suspended") actx.resume(); return; }
    try {
      actx = new (window.AudioContext || window.webkitAudioContext)();
      var b = actx.createBuffer(1, 1, 22050); var s = actx.createBufferSource(); s.buffer = b; s.connect(actx.destination); s.start(0);
    } catch (e) { actx = null; }
  }
  var SCALE = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.5, 1567.98, 1760, 2093, 2349];
  function blip(step) {
    if (!actx) return;
    var t = actx.currentTime;
    var f = step < SCALE.length ? SCALE[step] : SCALE[SCALE.length - 1] * Math.pow(1.0595, step - SCALE.length + 1);
    var o = actx.createOscillator(), g = actx.createGain(), lp = actx.createBiquadFilter();
    lp.type = "lowpass"; lp.frequency.value = 3400; o.type = "triangle"; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.17, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    o.connect(lp); lp.connect(g); g.connect(actx.destination); o.start(t); o.stop(t + 0.24);
  }
  function buzz() {
    if (!actx) return;
    var t = actx.currentTime, o = actx.createOscillator(), g = actx.createGain(), lp = actx.createBiquadFilter();
    lp.type = "lowpass"; lp.frequency.value = 700; o.type = "sawtooth";
    o.frequency.setValueAtTime(200, t); o.frequency.exponentialRampToValueAtTime(68, t + 0.3);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.18, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.36);
    o.connect(lp); lp.connect(g); g.connect(actx.destination); o.start(t); o.stop(t + 0.37);
  }
  function fanfare() {
    if (!actx) return;
    var seq = [0, 2, 4, 7];
    for (var i = 0; i < seq.length; i++) (function (s, i) { setTimeout(function () { blip(s + 4); }, i * 70); })(seq[i], i);
  }

  // ---- chimp mascot -------------------------------------------------------
  function chimp(face, text, ms) {
    chimpFace.textContent = face;
    chimpFace.classList.remove("react"); void chimpFace.offsetWidth; chimpFace.classList.add("react");
    if (text) {
      chimpBubble.textContent = text;
      chimpBubble.classList.add("show");
      clearTimeout(bubbleTimer);
      bubbleTimer = setTimeout(function () { chimpBubble.classList.remove("show"); chimpFace.textContent = "🐵"; }, ms || 1500);
    }
  }

  // ---- fx -----------------------------------------------------------------
  function burst(tile) {
    var r = tile.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    for (var i = 0; i < 8; i++) {
      var p = document.createElement("span"); p.className = "spark";
      var a = Math.random() * Math.PI * 2, d = 22 + Math.random() * 36;
      p.style.left = cx + "px"; p.style.top = cy + "px";
      p.style.setProperty("--dx", (Math.cos(a) * d).toFixed(1) + "px");
      p.style.setProperty("--dy", (Math.sin(a) * d).toFixed(1) + "px");
      fx.appendChild(p);
      (function (el) { setTimeout(function () { el.remove(); }, 540); })(p);
    }
  }
  function bananas() {
    for (var i = 0; i < 26; i++) {
      var b = document.createElement("span"); b.className = "nana"; b.textContent = "🍌";
      b.style.left = (Math.random() * 100) + "vw";
      b.style.animationDelay = (Math.random() * 0.5).toFixed(2) + "s";
      b.style.fontSize = (16 + Math.random() * 20).toFixed(0) + "px";
      fx.appendChild(b);
      (function (el) { setTimeout(function () { el.remove(); }, 2600); })(b);
    }
  }
  function shake() {
    var st = document.querySelector(".stage");
    st.classList.remove("shake"); void st.offsetWidth; st.classList.add("shake");
  }

  // ---- grid / lives -------------------------------------------------------
  function grid() {
    var narrow = window.innerWidth < 600;
    COLS = narrow ? 5 : 8; ROWS = narrow ? 7 : 5;
    board.style.gridTemplateColumns = "repeat(" + COLS + ", 1fr)";
  }
  window.addEventListener("resize", function () { grid(); });

  function renderLives() {
    livesEl.innerHTML = "";
    for (var i = 0; i < MAX_LIVES; i++) {
      var h = document.createElement("span");
      h.className = "heart" + (i >= lives ? " is-lost" : "");
      livesEl.appendChild(h);
    }
  }

  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) { var j = (Math.random() * (i + 1)) | 0; var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }

  function flashMs() {
    var step = level - START_LEVEL;
    if (mode === "lightning") return Math.max(170, 650 - step * 45);
    return Math.max(420, 1500 - step * 110);     // flash
  }

  function newRound() {
    grid();
    var cells = COLS * ROWS;
    var n = Math.min(level, cells);
    var idxs = []; for (var i = 0; i < cells; i++) idxs.push(i);
    shuffle(idxs);
    var chosen = idxs.slice(0, n);
    var valueAt = {};
    chosen.forEach(function (cell, k) { valueAt[cell] = k + 1; });

    board.innerHTML = "";
    tiles = [];
    for (i = 0; i < cells; i++) {
      var t = document.createElement("button");
      t.type = "button"; t.className = "tile";
      if (valueAt[i]) { t.textContent = valueAt[i]; t.dataset.n = valueAt[i]; }
      else { t.classList.add("is-empty"); }
      board.appendChild(t); tiles.push(t);
    }
    expected = 1;
    numCount.textContent = level;

    if (mode === "classic") {
      state = "show";
    } else {
      state = "show";
      clearTimeout(flashTimer);
      flashTimer = setTimeout(function () {
        activeTiles().forEach(function (t) { t.classList.add("is-hidden"); });
        state = "recall"; roundStart = performance.now();
      }, flashMs());
    }
    if (mode === "classic") roundStart = performance.now();
  }

  function activeTiles() { return tiles.filter(function (t) { return t.dataset.n; }); }
  function canClick() { return state === "recall" || (mode === "classic" && state === "show"); }

  function levelCleared() {
    var b = getBest();
    var isBest = level > b;
    if (isBest) { localStorage.setItem(bestKey(), String(level)); showBest(); }
    fanfare();
    if (isBest) { bananas(); chimp("🙌", "New best!", 1400); }
    else if (level >= CHIMP_BENCH) chimp("🙊", "You beat me!", 1400);
    else chimp(["🐵", "🙉", "😯"][level % 3], ["Nice.", "Ooh!", "Go on…", "Sharp."][level % 4], 1200);
    level++;
    state = "wait";
    setTimeout(newRound, 520);
  }

  function strike(tile) {
    lives--; renderLives();
    state = "wait";
    buzz(); shake();
    if (tile) tile.classList.add("is-wrong");
    activeTiles().forEach(function (t) { t.classList.remove("is-hidden"); });
    if (lives <= 0) {
      chimp("🙈", "", 600);
      setTimeout(gameOver, 850);
    } else {
      chimp("🙈", "Oops!", 900);
      setTimeout(newRound, 1050);
    }
  }

  function rankFor(n) {
    if (n >= 12) return ["👑", "Ayumu themself"];
    if (n >= CHIMP_BENCH) return ["🐵", "Chimp-tier"];
    if (n >= 7) return ["🧠", "Sharp human"];
    if (n >= 5) return ["🧑", "Solidly human"];
    return ["🐟", "Goldfish"];
  }

  function gameOver() {
    state = "over";
    var reached = getBest();
    var rk = rankFor(reached);
    cardEyebrow.textContent = "Rank: " + rk[1] + " " + rk[0];
    cardTitle.textContent = "Game over";
    cardBody.innerHTML = "You reached <b>" + reached + " numbers</b> in " + mode + ". " +
      (reached >= 12 ? "Frankly superhuman." :
       reached >= CHIMP_BENCH ? "You matched a chimp — Ayumu would be impressed." :
       "Ayumu the chimp gets to about <b>" + CHIMP_BENCH + "</b> — keep training.");
    chimp(reached >= CHIMP_BENCH ? "🙊" : "🐵", "", 600);
    startBtn.textContent = "Play again";
    overlay.classList.remove("is-hidden");
    track("chimp_over", { reached: reached, mode: mode });
  }

  function clickTile(tile) {
    if (!canClick()) return;
    if (!tile.dataset.n || tile.classList.contains("is-done")) return;
    var n = +tile.dataset.n;
    if (n === expected) {
      if (mode === "classic" && expected === 1 && state === "show") {
        activeTiles().forEach(function (t) { if (t !== tile) t.classList.add("is-hidden"); });
        state = "recall";
      }
      tile.classList.add("is-done");
      burst(tile); blip(expected - 1);
      expected++;
      if (expected > level) levelCleared();
    } else {
      strike(tile);
    }
  }

  board.addEventListener("pointerdown", function (e) {
    var t = e.target.closest(".tile");
    if (t) { e.preventDefault(); clickTile(t); }
  });

  // ---- mode selector ------------------------------------------------------
  function selectMode(m) {
    mode = m;
    localStorage.setItem("opt-chimp-mode", m);
    var btns = modeWrap.querySelectorAll(".mode");
    for (var i = 0; i < btns.length; i++) btns[i].setAttribute("aria-pressed", btns[i].dataset.mode === m ? "true" : "false");
    showBest();
  }
  modeWrap.addEventListener("click", function (e) {
    var b = e.target.closest(".mode"); if (b) selectMode(b.dataset.mode);
  });

  function startGame() {
    audioOn();
    level = START_LEVEL; lives = MAX_LIVES;
    renderLives();
    overlay.classList.add("is-hidden");
    if (hintEl) hintEl.classList.add("is-hidden");
    chimp("🐵", "", 400);
    newRound();
    track("chimp_start", { mode: mode });
  }
  startBtn.addEventListener("click", startGame);

  function track(name, params) {
    try { if (typeof window.gtag === "function") window.gtag("event", name, params || {}); } catch (e) {}
  }

  // boot
  grid(); renderLives(); selectMode(mode);
  setTimeout(function () { if (hintEl) hintEl.classList.add("is-hidden"); }, 8000);
})();
