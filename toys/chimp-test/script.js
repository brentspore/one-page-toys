/* Chimp Test — numeric working memory.
 * Numbers appear on a grid; click 1 and the rest hide under blank tiles; click
 * the rest in ascending order from memory. One more number each round, three lives.
 */
(function () {
  "use strict";

  var board = document.getElementById("board");
  var overlay = document.getElementById("overlay");
  var startBtn = document.getElementById("startBtn");
  var cardTitle = document.getElementById("cardTitle");
  var cardBody = document.getElementById("cardBody");
  var numCount = document.getElementById("numCount");
  var bestEl = document.getElementById("best");
  var livesEl = document.getElementById("lives");
  var hintEl = document.getElementById("hint");

  var KEY = "opt-chimp-best";
  var best = +(localStorage.getItem(KEY) || 0);
  bestEl.textContent = best;

  var START_LEVEL = 4, MAX_LIVES = 3;
  var level = START_LEVEL, lives = MAX_LIVES;
  var state = "idle";          // idle | show | recall | wait | over
  var expected = 1;
  var tiles = [];              // current tile elements
  var COLS = 8, ROWS = 5;

  function grid() {
    var narrow = window.innerWidth < 600;
    COLS = narrow ? 5 : 8;
    ROWS = narrow ? 7 : 5;
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

  function newRound() {
    grid();
    var cells = COLS * ROWS;
    var n = Math.min(level, cells);
    // pick n distinct cell indices
    var idxs = []; for (var i = 0; i < cells; i++) idxs.push(i);
    shuffle(idxs);
    var chosen = idxs.slice(0, n);             // chosen[k] gets value k+1
    var valueAt = {};
    chosen.forEach(function (cell, k) { valueAt[cell] = k + 1; });

    board.innerHTML = "";
    tiles = [];
    for (i = 0; i < cells; i++) {
      var t = document.createElement("button");
      t.type = "button";
      t.className = "tile";
      if (valueAt[i]) { t.textContent = valueAt[i]; t.dataset.n = valueAt[i]; }
      else { t.classList.add("is-empty"); }
      board.appendChild(t);
      tiles.push(t);
    }
    expected = 1;
    state = "show";
    numCount.textContent = level;
  }

  function activeTiles() { return tiles.filter(function (t) { return t.dataset.n; }); }

  function levelCleared() {
    if (level > best) { best = level; localStorage.setItem(KEY, String(best)); bestEl.textContent = best; }
    level++;
    state = "wait";
    setTimeout(newRound, 480);
  }

  function strike(tile) {
    lives--; renderLives();
    state = "wait";
    if (tile) tile.classList.add("is-wrong");
    // reveal what was there
    activeTiles().forEach(function (t) { t.classList.remove("is-hidden"); });
    if (lives <= 0) {
      setTimeout(gameOver, 800);
    } else {
      setTimeout(function () { newRound(); }, 1000);
    }
  }

  function gameOver() {
    state = "over";
    var reached = best; // highest fully-cleared count
    cardTitle.textContent = "Game over";
    cardBody.innerHTML = "You reached <b>" + reached + " numbers</b>. " +
      (reached >= 9 ? "Sharper than most humans." : "The average chimp gets to about 9 — keep training.");
    startBtn.textContent = "Play again";
    overlay.classList.remove("is-hidden");
    track("chimp_over", { reached: reached });
  }

  function clickTile(tile) {
    if (state !== "show" && state !== "recall") return;
    if (!tile.dataset.n || tile.classList.contains("is-done")) return;
    var n = +tile.dataset.n;
    if (n === expected) {
      if (expected === 1 && state === "show") {
        // hide the remaining numbers, switch to recall
        activeTiles().forEach(function (t) { if (t !== tile) t.classList.add("is-hidden"); });
        state = "recall";
      }
      tile.classList.add("is-done");
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

  function startGame() {
    level = START_LEVEL; lives = MAX_LIVES;
    renderLives();
    overlay.classList.add("is-hidden");
    if (hintEl) hintEl.classList.add("is-hidden");
    newRound();
    track("chimp_start", {});
  }
  startBtn.addEventListener("click", startGame);

  function track(name, params) {
    try { if (typeof window.gtag === "function") window.gtag("event", name, params || {}); } catch (e) {}
  }

  // boot
  grid();
  renderLives();
  setTimeout(function () { if (hintEl) hintEl.classList.add("is-hidden"); }, 8000);
})();
