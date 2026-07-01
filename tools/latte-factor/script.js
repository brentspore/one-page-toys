/* The Latte Factor — what a small daily habit really costs.
 * A daily amount, totalled over the years — flip to "invested at 7%" to see the
 * future value if you'd put it in the market instead (ordinary annuity).
 * Vanilla, self-contained, theme-aware. */
(function () {
  "use strict";

  var RATE = 0.07;            // assumed annual return for the "invested" view
  var DAYS_YR = 365;

  var $ = function (id) { return document.getElementById(id); };
  var odo = $("odo"), sub = $("sub"), eyebrow = $("eyebrow"), status = $("status"), heat = $("heat");
  var dailyEl = $("daily");
  var y1 = $("y1"), y5 = $("y5"), y30 = $("y30");
  var tabSpent = $("tabSpent"), tabInvest = $("tabInvest");

  var mode = "spent";        // "spent" | "invest"
  var habitName = "habit";

  function daily() { var v = parseFloat(dailyEl.value); return isFinite(v) && v > 0 ? v : 0; }
  function money(n) { return "$" + Math.round(n).toLocaleString("en-US"); }

  // total over N years — simple sum, or future value of yearly contributions at RATE
  function over(years) {
    var yearly = daily() * DAYS_YR;
    if (mode === "spent") return yearly * years;
    return yearly * (Math.pow(1 + RATE, years) - 1) / RATE;   // ordinary annuity FV
  }

  function setHeat(v) { document.documentElement.style.setProperty("--heat", Math.max(0, Math.min(1, v)).toFixed(3)); }

  function render() {
    var invest = mode === "invest";
    eyebrow.textContent = invest ? "Invested instead, in 10 years" : "Over 10 years, that's";
    var ten = over(10);
    odo.textContent = money(ten);
    odo.setAttribute("aria-label", money(ten));
    y1.textContent = money(over(1));
    y5.textContent = money(over(5));
    y30.textContent = money(over(30));

    var yearly = daily() * DAYS_YR;
    if (daily() <= 0) {
      sub.innerHTML = "Pick a daily habit and watch it add up.";
    } else if (invest) {
      sub.innerHTML = "That daily " + habitName + ", invested, could grow to <strong>" + money(over(30)) + "</strong> in 30 years.";
    } else {
      sub.innerHTML = "Your daily " + habitName + " runs <strong>" + money(yearly) + "</strong> a year — " + money(yearly / 12) + " a month.";
    }
    setHeat(Math.min(1, ten / 200000));
  }

  function setMode(next) {
    mode = next;
    tabSpent.setAttribute("aria-selected", next === "spent" ? "true" : "false");
    tabInvest.setAttribute("aria-selected", next === "invest" ? "true" : "false");
    status.textContent = next === "invest" ? "Compounded at 7% a year." : "Small sips, big totals.";
    render();
  }
  tabSpent.addEventListener("click", function () { if (mode !== "spent") setMode("spent"); });
  tabInvest.addEventListener("click", function () { if (mode !== "invest") setMode("invest"); });

  document.querySelectorAll(".step").forEach(function (b) {
    b.addEventListener("click", function () {
      var dir = +b.getAttribute("data-dir");
      var v = Math.max(0, (parseFloat(dailyEl.value) || 0) + dir * 0.5);
      dailyEl.value = v.toFixed(2);
      markHabit();
      render();
    });
  });

  var habits = document.querySelectorAll("#habits .preset");
  function markHabit() {
    var d = daily(), matched = false;
    habits.forEach(function (h) {
      var on = Math.abs(+h.getAttribute("data-cost") - d) < 0.001;
      h.setAttribute("aria-pressed", on ? "true" : "false");
      if (on) { habitName = h.getAttribute("data-name"); matched = true; }
    });
    if (!matched) habitName = "habit";
  }
  habits.forEach(function (h) {
    h.addEventListener("click", function () {
      dailyEl.value = (+h.getAttribute("data-cost")).toFixed(2);
      habitName = h.getAttribute("data-name");
      markHabit();
      status.textContent = "Counting your daily " + habitName + ".";
      render();
    });
  });
  dailyEl.addEventListener("input", function () { markHabit(); render(); });

  markHabit();
  render();
})();
