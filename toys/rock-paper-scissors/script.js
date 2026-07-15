/* Rock Paper Scissors — throw a hand, the CPU throws fair, clash + score. */
(function () {
  "use strict";

  var EMOJI = { rock: "✊", paper: "✋", scissors: "✌️" };
  var BEATS = { rock: "scissors", paper: "rock", scissors: "paper" };
  var MOVES = ["rock", "paper", "scissors"];

  var result = document.getElementById("result");
  var youHand = document.getElementById("youHand");
  var cpuHand = document.getElementById("cpuHand");
  var arena = document.querySelector(".arena");
  var picks = Array.prototype.slice.call(document.querySelectorAll(".pick"));
  var hint = document.getElementById("hint");
  var sWin = document.getElementById("sWin");
  var sTie = document.getElementById("sTie");
  var sLoss = document.getElementById("sLoss");
  var sStreak = document.getElementById("sStreak");
  if (!result) return;

  var reduceMotion =
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var busy = false;
  var s = { win: 0, tie: 0, loss: 0, streak: 0 };

  function fair(n) {
    try { var a = new Uint8Array(1); crypto.getRandomValues(a); return a[0] % n; }
    catch (e) { return Math.floor(Math.random() * n); }
  }

  function play(move) {
    if (busy) return;
    busy = true;
    if (hint && !hint.classList.contains("is-hidden")) hint.classList.add("is-hidden");
    picks.forEach(function (p) { p.disabled = true; });

    var youEl = document.querySelector(".hand--you");
    var cpuEl = document.querySelector(".hand--cpu");
    result.className = "result";
    result.textContent = "Rock… paper… scissors…";
    youHand.textContent = "✊"; cpuHand.textContent = "✊";
    youEl.classList.remove("win", "lose"); cpuEl.classList.remove("win", "lose");
    if (!reduceMotion) { arena.classList.remove("shaking"); void arena.offsetWidth; arena.classList.add("shaking"); }

    var cpu = MOVES[fair(3)];
    var wait = reduceMotion ? 200 : 620;
    setTimeout(function () {
      arena.classList.remove("shaking");
      youHand.textContent = EMOJI[move];
      cpuHand.textContent = EMOJI[cpu];
      result.classList.add("pop");

      if (move === cpu) {
        s.tie++; result.textContent = "Tie: " + cap(move) + " vs " + cap(cpu) + ".";
      } else if (BEATS[move] === cpu) {
        s.win++; s.streak++; result.classList.add("win");
        youEl.classList.add("win"); cpuEl.classList.add("lose");
        result.textContent = cap(move) + " beats " + cpu + ". You win!";
      } else {
        s.loss++; s.streak = 0; result.classList.add("loss");
        cpuEl.classList.add("win"); youEl.classList.add("lose");
        result.textContent = cap(cpu) + " beats " + move + ". CPU wins.";
      }
      sWin.textContent = s.win; sTie.textContent = s.tie; sLoss.textContent = s.loss;
      sStreak.textContent = s.streak >= 3 ? s.streak + " 🔥" : s.streak;
      picks.forEach(function (p) { p.disabled = false; });
      busy = false;
    }, wait);
  }
  function cap(w) { return w.charAt(0).toUpperCase() + w.slice(1); }

  picks.forEach(function (p) {
    p.addEventListener("click", function () { play(p.dataset.move); });
  });
  window.addEventListener("keydown", function (e) {
    var k = e.key.toLowerCase();
    if (k === "r") play("rock");
    else if (k === "p") play("paper");
    else if (k === "s") play("scissors");
  });
})();
