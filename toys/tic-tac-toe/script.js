/* Tic-Tac-Toe — you are X, the CPU is O. Chill makes mistakes; Ruthless is minimax. */
(function () {
  "use strict";

  var cells = Array.prototype.slice.call(document.querySelectorAll(".cell"));
  var statusEl = document.getElementById("status");
  var newBtn = document.getElementById("newBtn");
  var winline = document.getElementById("winline");
  var winseg = document.getElementById("winseg");
  var scoreYou = document.getElementById("scoreYou");
  var scoreDraw = document.getElementById("scoreDraw");
  var scoreCpu = document.getElementById("scoreCpu");
  if (!cells.length) return;

  var WINS = [
    [0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]
  ];
  // SVG endpoints per winning combo (viewBox 0..100)
  var SEG = {
    "0,1,2": [8,16.7,92,16.7], "3,4,5": [8,50,92,50], "6,7,8": [8,83.3,92,83.3],
    "0,3,6": [16.7,8,16.7,92], "1,4,7": [50,8,50,92], "2,5,8": [83.3,8,83.3,92],
    "0,4,8": [10,10,90,90], "2,4,6": [90,10,10,90]
  };

  var board = Array(9).fill("");
  var active = true;
  var diff = "chill";
  var score = { you: 0, draw: 0, cpu: 0 };

  function winnerOf(b) {
    for (var i = 0; i < WINS.length; i++) {
      var w = WINS[i];
      if (b[w[0]] && b[w[0]] === b[w[1]] && b[w[1]] === b[w[2]]) return { who: b[w[0]], line: w };
    }
    return b.indexOf("") === -1 ? { who: "draw", line: null } : null;
  }

  function minimax(b, player) {
    var res = winnerOf(b);
    if (res) {
      if (res.who === "o") return { score: 10 };
      if (res.who === "x") return { score: -10 };
      return { score: 0 };
    }
    var best = player === "o" ? { score: -Infinity } : { score: Infinity };
    for (var i = 0; i < 9; i++) {
      if (b[i]) continue;
      b[i] = player;
      var s = minimax(b, player === "o" ? "x" : "o").score;
      b[i] = "";
      if (player === "o" ? s > best.score : s < best.score) best = { score: s, move: i };
    }
    return best;
  }

  function emptyCells(b) {
    var a = []; for (var i = 0; i < 9; i++) if (!b[i]) a.push(i); return a;
  }

  function cpuMove() {
    var empties = emptyCells(board);
    if (!empties.length) return -1;
    // Chill: usually random, sometimes smart. Ruthless: always optimal.
    var smart = diff === "ruthless" || Math.random() < 0.35;
    if (smart) return minimax(board.slice(), "o").move;
    return empties[Math.floor(Math.random() * empties.length)];
  }

  function svgMark(who, ghost) {
    var cls = "mark" + (ghost ? " mark--ghost" : "");
    if (who === "o") {
      return '<svg class="' + cls + '" viewBox="0 0 100 100"><circle class="mk" cx="50" cy="50" r="30"/></svg>';
    }
    return '<svg class="' + cls + '" viewBox="0 0 100 100">' +
      '<line class="mk" x1="28" y1="28" x2="72" y2="72"/>' +
      '<line class="mk mk--2" x1="72" y1="28" x2="28" y2="72"/></svg>';
  }

  function paint(i, who) {
    board[i] = who;
    var c = cells[i];
    c.innerHTML = svgMark(who, false);
    c.classList.remove("ghost");
    c.classList.add(who);
    c.disabled = true;
  }

  function confetti(x, y) {
    var cols = ["#f0398b", "#22d3ee", "#ffffff", "#a78bfa"];
    for (var i = 0; i < 30; i++) {
      var d = document.createElement("div");
      d.className = "confetti";
      d.style.left = x + "px"; d.style.top = y + "px";
      d.style.background = cols[i % cols.length];
      var a = Math.random() * Math.PI * 2, sp = 90 + Math.random() * 150;
      d.style.setProperty("--dx", (Math.cos(a) * sp).toFixed(0) + "px");
      d.style.setProperty("--dy", (Math.sin(a) * sp - 60).toFixed(0) + "px");
      document.body.appendChild(d);
      d.addEventListener("animationend", function () { this.remove(); });
    }
  }

  function showWin(line) {
    var s = SEG[line.join(",")];
    winseg.setAttribute("x1", s[0]); winseg.setAttribute("y1", s[1]);
    winseg.setAttribute("x2", s[2]); winseg.setAttribute("y2", s[3]);
    winline.classList.add("show");
    cells.forEach(function (c, i) { if (line.indexOf(i) === -1) c.classList.add("dim"); });
  }

  function endGame(res) {
    active = false;
    cells.forEach(function (c) { c.disabled = true; });
    if (res.who === "draw") {
      score.draw++; statusEl.innerHTML = "Draw. Run it back?";
    } else if (res.who === "x") {
      score.you++; showWin(res.line); statusEl.innerHTML = "You win! 🎉";
      var b = document.querySelector(".board").getBoundingClientRect();
      confetti(b.left + b.width / 2, b.top + b.height / 2);
    } else {
      score.cpu++; showWin(res.line); statusEl.innerHTML = "CPU takes it.";
    }
    scoreYou.textContent = score.you; scoreDraw.textContent = score.draw; scoreCpu.textContent = score.cpu;
  }

  function afterMove() {
    var res = winnerOf(board);
    if (res) { endGame(res); return true; }
    return false;
  }

  function playerMove(i) {
    if (!active || board[i]) return;
    paint(i, "x");
    if (afterMove()) return;
    statusEl.innerHTML = "CPU thinking…";
    active = false;
    setTimeout(function () {
      var m = cpuMove();
      if (m >= 0) paint(m, "o");
      if (!afterMove()) { active = true; statusEl.innerHTML = "Your move. You're <span class='x'>X</span>"; }
    }, 420);
  }

  cells.forEach(function (c) {
    c.addEventListener("click", function () { playerMove(+c.dataset.i); });
    c.addEventListener("pointerenter", function () {
      if (active && !board[+c.dataset.i]) c.innerHTML = svgMark("x", true);
    });
    c.addEventListener("pointerleave", function () {
      if (!board[+c.dataset.i]) c.innerHTML = "";
    });
  });

  newBtn.addEventListener("click", function () {
    board = Array(9).fill(""); active = true;
    winline.classList.remove("show");
    cells.forEach(function (c) { c.innerHTML = ""; c.className = "cell"; c.disabled = false; });
    statusEl.innerHTML = "Your move. You're <span class='x'>X</span>";
  });

  document.querySelectorAll(".seg__btn").forEach(function (b) {
    b.addEventListener("click", function () {
      diff = b.dataset.diff;
      document.querySelectorAll(".seg__btn").forEach(function (x) { x.classList.toggle("is-on", x === b); });
    });
  });
})();
