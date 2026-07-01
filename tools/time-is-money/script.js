/* Time Is Money — your hourly wage, made real.
 * "Earning" mode ticks up what you've made since the page opened (a personal
 * meeting-cost-meter). "Spending" mode turns any price into hours of your life.
 * Vanilla, self-contained, theme-aware. */
(function () {
  "use strict";

  var WORK_HRS_DAY = 8, WORK_DAYS_YR = 260;   // a working year for the "life cost" framing

  var $ = function (id) { return document.getElementById(id); };
  var odo = $("odo"), sub = $("sub"), eyebrow = $("eyebrow"), status = $("status");
  var wageEl = $("wage"), priceEl = $("price"), priceField = $("priceField");
  var earnActions = $("earnActions"), heat = $("heat");
  var s1 = $("s1"), s2 = $("s2"), s3 = $("s3"), s1l = $("s1label"), s2l = $("s2label"), s3l = $("s3label");
  var tabEarn = $("tabEarn"), tabSpend = $("tabSpend");

  var mode = "earn";                 // "earn" | "spend"
  var startTs = performance.now();   // when the earning clock started

  function wage() { var v = parseFloat(wageEl.value); return isFinite(v) && v > 0 ? v : 0; }
  function price() { var v = parseFloat(priceEl.value); return isFinite(v) && v > 0 ? v : 0; }

  function money(n, dp) {
    dp = dp == null ? 2 : dp;
    return "$" + n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
  }
  function hoursToText(h) {
    if (!isFinite(h) || h <= 0) return "no time at all";
    var whole = Math.floor(h), m = Math.round((h - whole) * 60);
    if (m === 60) { whole += 1; m = 0; }
    if (whole === 0) return m + " min";
    if (m === 0) return whole + (whole === 1 ? " hour" : " hours");
    return whole + "h " + m + "m";
  }

  function setHeat(v) { document.documentElement.style.setProperty("--heat", Math.max(0, Math.min(1, v)).toFixed(3)); }

  // ---- earning ----
  function renderEarn() {
    var w = wage(), perSec = w / 3600;
    var secs = (performance.now() - startTs) / 1000;
    var earned = perSec * secs;
    odo.textContent = money(earned);
    odo.setAttribute("aria-label", money(earned));
    s1l.textContent = "Per second"; s2l.textContent = "Per minute"; s3l.textContent = "Per 8-hr day";
    s1.textContent = money(perSec, 4);
    s2.textContent = money(w / 60);
    s3.textContent = money(w * WORK_HRS_DAY);
    // a gentle line that grows with what's ticked by
    if (w <= 0) { sub.innerHTML = "Pop in your hourly pay to start the meter."; }
    else if (secs < 8) { sub.innerHTML = "Just sitting here reading is worth <strong>" + money(earned) + "</strong> so far."; }
    else { sub.innerHTML = "You've earned <strong>" + money(earned) + "</strong> since you opened this — " + hoursToText(secs / 3600) + " of screen time."; }
    setHeat(Math.min(1, earned / (w * 0.5 + 1)));   // warms up as it climbs toward ~30 min of pay
  }

  // ---- spending ----
  function renderSpend() {
    var w = wage(), p = price();
    var hrs = w > 0 ? p / w : 0;
    odo.textContent = hoursToText(hrs);
    odo.setAttribute("aria-label", hoursToText(hrs) + " of work");
    var days = hrs / WORK_HRS_DAY, weeks = days / 5;
    s1l.textContent = "Work-days"; s2l.textContent = "Work-weeks"; s3l.textContent = "Its price";
    s1.textContent = days.toLocaleString("en-US", { maximumFractionDigits: 1 });
    s2.textContent = weeks.toLocaleString("en-US", { maximumFractionDigits: 2 });
    s3.textContent = money(p);
    if (w <= 0) sub.innerHTML = "Add your wage to see the true cost.";
    else sub.innerHTML = "That " + money(p) + " is <strong>" + hoursToText(hrs) + "</strong> of your working life.";
    setHeat(Math.min(1, hrs / 80));   // a big purchase glows hotter
  }

  function render() { if (mode === "earn") renderEarn(); else renderSpend(); }

  // ---- mode switching ----
  function setMode(next) {
    mode = next;
    var earning = mode === "earn";
    tabEarn.setAttribute("aria-selected", earning ? "true" : "false");
    tabSpend.setAttribute("aria-selected", earning ? "false" : "true");
    eyebrow.textContent = earning ? "Earned since you opened this page" : "That purchase costs you";
    priceField.hidden = earning;
    earnActions.hidden = !earning;
    status.textContent = earning ? "Tick, tick, tick…" : "Money in, life out.";
    if (earning) startTs = performance.now();   // restart the clock when returning to earn
    render();
  }
  tabEarn.addEventListener("click", function () { if (mode !== "earn") setMode("earn"); });
  tabSpend.addEventListener("click", function () { if (mode !== "spend") setMode("spend"); });

  // ---- steppers + presets ----
  document.querySelectorAll(".step").forEach(function (b) {
    b.addEventListener("click", function () {
      var which = b.getAttribute("data-step"), dir = +b.getAttribute("data-dir");
      var el = which === "wage" ? wageEl : priceEl;
      var step = which === "wage" ? 5 : 25;
      var v = Math.max(0, (parseFloat(el.value) || 0) + dir * step);
      el.value = which === "wage" ? v : Math.round(v);
      if (which === "wage") markPreset();
      render();
    });
  });
  var wagePresets = document.querySelectorAll("#wagePresets .preset");
  function markPreset() {
    var w = wage();
    wagePresets.forEach(function (p) { p.setAttribute("aria-pressed", (+p.getAttribute("data-wage") === w) ? "true" : "false"); });
  }
  wagePresets.forEach(function (p) {
    p.addEventListener("click", function () { wageEl.value = p.getAttribute("data-wage"); markPreset(); render(); });
  });
  wageEl.addEventListener("input", function () { markPreset(); render(); });
  priceEl.addEventListener("input", render);
  $("resetTimer").addEventListener("click", function () { startTs = performance.now(); status.textContent = "Clock reset — go again."; });

  // ---- loop ----
  function frame() { if (mode === "earn") renderEarn(); requestAnimationFrame(frame); }
  markPreset();
  render();
  requestAnimationFrame(frame);
})();
