/* Dice Roller — faceted tumbling dice (d4–d20), solo or a pool.
 * Cryptographically fair, numbers cycle while tumbling, sum + history.
 */
(function () {
  "use strict";

  var arena = document.getElementById("arena");
  var totalEl = document.getElementById("total");
  var detailEl = document.getElementById("detail");
  var labelEl = document.getElementById("rollLabel");
  var historyEl = document.getElementById("history");
  var countValEl = document.getElementById("countVal");
  var rollBtn = document.getElementById("rollBtn");
  var clearBtn = document.getElementById("clearBtn");
  var countUp = document.getElementById("countUp");
  var countDown = document.getElementById("countDown");
  var hint = document.getElementById("hint");
  var chips = Array.prototype.slice.call(document.querySelectorAll(".die-chip"));
  if (!arena) return;

  var reduceMotion =
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var sides = 6;
  var count = 1;
  var busy = false;
  var history = [];

  function randInt(n) {
    var max = 256 - (256 % n);
    var buf = new Uint8Array(1);
    var x;
    do {
      try { crypto.getRandomValues(buf); } catch (e) { buf[0] = Math.floor(Math.random() * 256); }
      x = buf[0];
    } while (x >= max);
    return (x % n) + 1;
  }

  function makeDie() {
    var d = document.createElement("div");
    d.className = "die";
    d.dataset.sides = sides;
    var shape = document.createElement("div");
    shape.className = "die__shape";
    var num = document.createElement("span");
    num.className = "die__num";
    num.textContent = "?";
    d.appendChild(shape);
    d.appendChild(num);
    return { el: d, num: num };
  }

  function buildArena() {
    arena.innerHTML = "";
    dice = [];
    for (var i = 0; i < count; i++) {
      var d = makeDie();
      arena.appendChild(d.el);
      dice.push(d);
    }
  }
  var dice = [];

  function setSides(n) {
    sides = n;
    chips.forEach(function (c) { c.classList.toggle("is-on", +c.dataset.sides === n); });
    labelEl.textContent = count > 1 ? "Total" : "Roll";
    detailEl.textContent = count + "d" + sides + " · ready";
    buildArena();
    totalEl.textContent = "—";
  }

  function setCount(n) {
    count = Math.max(1, Math.min(8, n));
    countValEl.textContent = count;
    detailEl.textContent = count + "d" + sides + " · ready";
    labelEl.textContent = count > 1 ? "Total" : "Roll";
    buildArena();
    totalEl.textContent = "—";
  }

  function roll() {
    if (busy) return;
    busy = true;
    if (hint && !hint.classList.contains("is-hidden")) hint.classList.add("is-hidden");

    var results = [];
    var settleByes = [];
    dice.forEach(function (d, i) {
      var final = randInt(sides);
      results.push(final);
      var dur = (reduceMotion ? 0.25 : 0.8 + Math.random() * 0.5);
      var delay = reduceMotion ? 0 : i * 70;

      // randomize tumble axes per die
      d.el.style.setProperty("--rx", (360 * (2 + Math.floor(Math.random() * 3))) + "deg");
      d.el.style.setProperty("--ry", (360 * (1 + Math.floor(Math.random() * 3))) + "deg");
      d.el.style.setProperty("--rz", (Math.random() * 360 - 180).toFixed(0) + "deg");
      d.el.style.setProperty("--dur", dur + "s");

      d.el.classList.remove("rolling", "pop");
      void d.el.offsetWidth;

      // cycle visible numbers while tumbling
      var cycle = null;
      if (!reduceMotion) {
        cycle = setInterval(function () { d.num.textContent = randInt(sides); }, 70);
      }
      setTimeout(function () { d.el.classList.add("rolling"); }, delay);

      var total = delay + dur * 1000;
      settleByes.push(total);
      setTimeout(function () {
        if (cycle) clearInterval(cycle);
        d.num.textContent = final;
        d.el.classList.remove("rolling");
        d.el.classList.add("pop");
      }, delay + dur * 1000);
    });

    var maxT = Math.max.apply(null, settleByes);
    setTimeout(function () {
      var sum = results.reduce(function (a, b) { return a + b; }, 0);
      totalEl.textContent = sum;
      labelEl.textContent = count > 1 ? "Total" : "Roll";
      detailEl.textContent =
        count > 1 ? count + "d" + sides + " · " + results.join(" + ") + " = " + sum
                  : "d" + sides + " · you rolled " + sum;
      history.unshift({ n: count, s: sides, sum: sum });
      if (history.length > 12) history.pop();
      renderHistory();
      busy = false;
    }, maxT + 30);
  }

  function renderHistory() {
    historyEl.innerHTML = "";
    history.forEach(function (h) {
      var li = document.createElement("li");
      li.textContent = h.n + "d" + h.s + " · " + h.sum;
      historyEl.appendChild(li);
    });
  }

  // ---- wires ----
  chips.forEach(function (c) { c.addEventListener("click", function () { if (!busy) setSides(+c.dataset.sides); }); });
  countUp.addEventListener("click", function () { if (!busy) setCount(count + 1); });
  countDown.addEventListener("click", function () { if (!busy) setCount(count - 1); });
  rollBtn.addEventListener("click", roll);
  clearBtn.addEventListener("click", function () {
    history = []; renderHistory(); totalEl.textContent = "—";
    detailEl.textContent = count + "d" + sides + " · history cleared";
  });
  window.addEventListener("keydown", function (e) {
    if (e.key === "r" || e.key === "R") {
      if (/^(INPUT|TEXTAREA)$/.test((e.target || {}).tagName || "")) return;
      roll();
    }
  });

  // ---- init ----
  buildArena();
  setSides(6);
  setCount(1);
})();
