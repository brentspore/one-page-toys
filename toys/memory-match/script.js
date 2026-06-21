/* Memory Match — flip two cards, find every pair. Moves + timer, three sizes. */
(function () {
  "use strict";

  var EMOJI = ["🍀","🌶️","🍓","🎲","🚀","🐙","🌈","⚡","🎈","🔮","🦊","🍑","🌵","🐳","🎯","🍕","🪐","🦋","👾","🧊","🌻","🎸","🍩","🪁"];

  var SIZES = { s: 6, m: 8, l: 12 }; // pairs

  var grid = document.getElementById("grid");
  var statusEl = document.getElementById("status");
  var pairsEl = document.getElementById("pairs");
  var movesEl = document.getElementById("moves");
  var timeEl = document.getElementById("time");
  var newBtn = document.getElementById("newBtn");
  if (!grid) return;

  var size = "m", pairs = 8, found = 0, moves = 0;
  var first = null, busy = false;
  var startTs = 0, timerId = null;

  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j;
      try { var b = new Uint32Array(1); crypto.getRandomValues(b); j = b[0] % (i + 1); }
      catch (e) { j = Math.floor(Math.random() * (i + 1)); }
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function fmt(ms) {
    var s = Math.floor(ms / 1000);
    return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  }
  function startTimer() {
    if (timerId) return;
    startTs = Date.now();
    timerId = setInterval(function () { timeEl.textContent = fmt(Date.now() - startTs); }, 250);
  }
  function stopTimer() { if (timerId) { clearInterval(timerId); timerId = null; } }

  function build() {
    pairs = SIZES[size];
    found = 0; moves = 0; first = null; busy = false;
    stopTimer(); startTs = 0; timeEl.textContent = "0:00";
    movesEl.textContent = "0";
    pairsEl.textContent = "0/" + pairs;
    statusEl.className = "status"; statusEl.textContent = "Find every pair.";
    grid.dataset.size = size;
    grid.innerHTML = "";

    var deck = shuffle(EMOJI.slice(0, pairs).concat(EMOJI.slice(0, pairs)));
    deck.forEach(function (sym) {
      var card = document.createElement("button");
      card.className = "card";
      card.type = "button";
      card.setAttribute("aria-label", "card");
      card.dataset.sym = sym;
      var inner = document.createElement("span");
      inner.className = "card__inner";
      var back = document.createElement("span");
      back.className = "card__face card__back";
      var front = document.createElement("span");
      front.className = "card__face card__front";
      front.textContent = sym;
      inner.appendChild(back); inner.appendChild(front);
      card.appendChild(inner);
      card.addEventListener("click", function () { flip(card); });
      grid.appendChild(card);
    });
  }

  function flip(card) {
    if (busy || card.classList.contains("flipped") || card.classList.contains("matched")) return;
    startTimer();
    card.classList.add("flipped");
    if (!first) { first = card; return; }

    moves++; movesEl.textContent = moves;
    if (first.dataset.sym === card.dataset.sym) {
      first.classList.add("matched"); card.classList.add("matched");
      first = null; found++;
      pairsEl.textContent = found + "/" + pairs;
      if (found === pairs) win();
    } else {
      busy = true;
      var a = first, b = card; first = null;
      setTimeout(function () {
        a.classList.remove("flipped"); b.classList.remove("flipped"); busy = false;
      }, 760);
    }
  }

  function win() {
    stopTimer();
    statusEl.className = "status win";
    statusEl.textContent = "Cleared in " + moves + " moves · " + fmt(Date.now() - startTs) + " 🎉";
    var r = grid.getBoundingClientRect();
    confetti(r.left + r.width / 2, r.top + r.height / 3);
  }

  function confetti(x, y) {
    var cols = ["#2dd4bf", "#34d399", "#a7f3d0", "#5eead4"];
    for (var i = 0; i < 36; i++) {
      var d = document.createElement("div");
      d.className = "confetti";
      d.style.left = x + "px"; d.style.top = y + "px";
      d.style.background = cols[i % cols.length];
      var a = Math.random() * Math.PI * 2, sp = 110 + Math.random() * 180;
      d.style.setProperty("--dx", (Math.cos(a) * sp).toFixed(0) + "px");
      d.style.setProperty("--dy", (Math.sin(a) * sp - 70).toFixed(0) + "px");
      document.body.appendChild(d);
      d.addEventListener("animationend", function () { this.remove(); });
    }
  }

  document.querySelectorAll(".seg__btn").forEach(function (b) {
    b.addEventListener("click", function () {
      size = b.dataset.size;
      document.querySelectorAll(".seg__btn").forEach(function (x) { x.classList.toggle("is-on", x === b); });
      build();
    });
  });
  newBtn.addEventListener("click", build);

  build();
})();
