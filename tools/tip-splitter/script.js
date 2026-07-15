/* Tip Splitter — drag the dial to tip, tap to add people, split live. */
(function () {
  "use strict";

  var TIP_MAX = 40;                      // dial spans 0..40%
  var SNAPS = [0, 15, 18, 20, 25, 40];   // soft detents (common tips)
  var PEOPLE_MIN = 1, PEOPLE_MAX = 16;

  var state = { bill: 84, tip: 20, people: 4, roundUp: false };
  try {
    var saved = JSON.parse(localStorage.getItem("tip_state") || "null");
    if (saved) state = Object.assign(state, saved);
  } catch (e) {}

  var $ = function (id) { return document.getElementById(id); };
  var perEl = $("perPerson"), tipPctEl = $("tipPct"), tipAmtEl = $("tipAmt");
  var tipTotalEl = $("tipTotal"), grandEl = $("grandTotal");
  var billInput = $("bill"), peopleEl = $("people"), peopleCountEl = $("peopleCount");
  var dial = $("dial"), fill = $("dialFill"), handle = $("dialHandle"), pips = $("dialPips");
  var roundBtn = $("roundup");
  var peopleUp = $("peopleUp"), peopleDown = $("peopleDown");

  var C = 2 * Math.PI * 104;             // ring circumference

  function money(n) {
    return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function moneyWhole(n) { return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

  function save() {
    try { localStorage.setItem("tip_state", JSON.stringify(state)); } catch (e) {}
  }

  // ---- person glyph ----
  var PERSON = '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="7" r="4" fill="currentColor"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8" fill="currentColor"/></svg>';
  function renderPeople() {
    peopleEl.innerHTML = "";
    for (var i = 0; i < state.people; i++) {
      var s = document.createElement("span");
      s.className = "people__i";
      s.style.animationDelay = Math.min(i * 22, 260) + "ms";
      s.innerHTML = PERSON;
      peopleEl.appendChild(s);
    }
    peopleCountEl.textContent = state.people;
    peopleDown.disabled = state.people <= PEOPLE_MIN;
    peopleUp.disabled = state.people >= PEOPLE_MAX;
  }

  // ---- pips (soft guide dots for common tips) ----
  function renderPips() {
    var svgns = "http://www.w3.org/2000/svg", html = "";
    [15, 18, 20, 25].forEach(function (p) {
      var deg = (p / TIP_MAX) * 360 - 90;    // 0% at top, clockwise
      var rad = deg * Math.PI / 180;
      var x = 120 + 104 * Math.cos(rad), y = 120 + 104 * Math.sin(rad);
      html += '<circle class="dial__pip" data-p="' + p + '" cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="3" />';
    });
    pips.innerHTML = html;
  }
  function markPips() {
    var nodes = pips.querySelectorAll(".dial__pip");
    for (var i = 0; i < nodes.length; i++) {
      var on = Math.abs(parseFloat(nodes[i].getAttribute("data-p")) - state.tip) < 0.5;
      nodes[i].classList.toggle("dial__pip--on", on);
    }
  }

  // ---- compute + render ----
  function compute() {
    var bill = isFinite(state.bill) && state.bill > 0 ? state.bill : 0;
    var baseTip = bill * state.tip / 100;
    var baseTotal = bill + baseTip;
    var per = state.people > 0 ? baseTotal / state.people : 0;
    var total = baseTotal, tipAmt = baseTip;
    if (state.roundUp && per > 0) {
      per = Math.ceil(per - 1e-9);         // clean whole-dollar each
      total = per * state.people;
      tipAmt = total - bill;
    }
    return { per: per, total: total, tipAmt: tipAmt };
  }

  function render() {
    var r = compute();
    perEl.textContent = money(r.per);
    perEl.setAttribute("aria-label", money(r.per) + " each");
    tipPctEl.innerHTML = Math.round(state.tip) + "<i>%</i>";
    tipAmtEl.textContent = money(r.tipAmt);
    tipTotalEl.textContent = money(r.tipAmt);
    grandEl.textContent = money(r.total);

    var frac = state.tip / TIP_MAX;
    fill.style.strokeDashoffset = (C * (1 - frac)).toFixed(2);
    var hAng = (frac * 360 - 90) * Math.PI / 180;      // from top, clockwise
    handle.setAttribute("cx", (120 + 104 * Math.cos(hAng)).toFixed(2));
    handle.setAttribute("cy", (120 + 104 * Math.sin(hAng)).toFixed(2));
    dial.setAttribute("aria-valuenow", Math.round(state.tip));
    dial.setAttribute("aria-valuetext", Math.round(state.tip) + " percent tip");
    markPips();
  }

  function setTip(t, snap) {
    t = Math.max(0, Math.min(TIP_MAX, t));
    if (snap) {
      for (var i = 0; i < SNAPS.length; i++) {
        if (Math.abs(t - SNAPS[i]) <= 1.2) { t = SNAPS[i]; break; }
      }
    }
    state.tip = t;
    render(); save();
  }

  // ---- dial drag ----
  var dragging = false;
  function angleFromEvent(e) {
    var rect = dial.getBoundingClientRect();
    var cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    var a = Math.atan2(e.clientY - cy, e.clientX - cx);   // 0 = east, clockwise (y down)
    var fromTop = a * 180 / Math.PI + 90;                 // top = 0
    fromTop = (fromTop % 360 + 360) % 360;
    return fromTop / 360 * TIP_MAX;
  }
  dial.addEventListener("pointerdown", function (e) {
    dragging = true; dial.setPointerCapture(e.pointerId);
    setTip(angleFromEvent(e), true); e.preventDefault();
  });
  dial.addEventListener("pointermove", function (e) {
    if (!dragging) return;
    setTip(angleFromEvent(e), true);
  });
  function endDrag() { dragging = false; }
  dial.addEventListener("pointerup", endDrag);
  dial.addEventListener("pointercancel", endDrag);
  dial.addEventListener("keydown", function (e) {
    var step = e.shiftKey ? 5 : 1;
    if (e.key === "ArrowUp" || e.key === "ArrowRight") { setTip(state.tip + step, false); e.preventDefault(); }
    else if (e.key === "ArrowDown" || e.key === "ArrowLeft") { setTip(state.tip - step, false); e.preventDefault(); }
    else if (e.key === "Home") { setTip(0, false); e.preventDefault(); }
    else if (e.key === "End") { setTip(TIP_MAX, false); e.preventDefault(); }
  });

  // ---- bill ----
  function commitBill() {
    var v = parseFloat(billInput.value.replace(/[^0-9.]/g, ""));
    state.bill = isFinite(v) && v >= 0 ? v : 0;
    render(); save();
  }
  billInput.addEventListener("input", commitBill);
  billInput.addEventListener("blur", function () {
    billInput.value = (isFinite(state.bill) ? state.bill : 0).toFixed(2);
  });
  billInput.addEventListener("focus", function () { billInput.select(); });
  document.querySelectorAll("[data-bill]").forEach(function (b) {
    b.addEventListener("click", function () {
      var d = parseFloat(b.getAttribute("data-bill"));
      state.bill = Math.max(0, Math.round((state.bill + d) * 100) / 100);
      billInput.value = state.bill.toFixed(2);
      render(); save();
    });
  });

  // ---- people ----
  peopleUp.addEventListener("click", function () {
    if (state.people < PEOPLE_MAX) { state.people++; renderPeople(); render(); save(); }
  });
  peopleDown.addEventListener("click", function () {
    if (state.people > PEOPLE_MIN) { state.people--; renderPeople(); render(); save(); }
  });

  // ---- round up ----
  roundBtn.addEventListener("click", function () {
    state.roundUp = !state.roundUp;
    roundBtn.setAttribute("aria-pressed", state.roundUp ? "true" : "false");
    render(); save();
  });

  // ---- boot ----
  billInput.value = (isFinite(state.bill) ? state.bill : 0).toFixed(2);
  roundBtn.setAttribute("aria-pressed", state.roundUp ? "true" : "false");
  renderPips();
  renderPeople();
  render();
})();
