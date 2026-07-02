/* Sleep Cycle Calculator — wake up between cycles, not mid-cycle.
 * Sleep runs in ~90-min cycles; waking at the end of one feels refreshed, not
 * groggy. "Going to bed" → best alarm times; "Need to wake up" → best bedtimes.
 * Vanilla, self-contained, theme-aware. Custom on-brand time picker (the native
 * <input type=time> can't be themed — dark icon + ugly OS popup). */
(function () {
  "use strict";

  var CYCLE = 90, FALL_ASLEEP = 15;          // minutes
  var CYCLES = [6, 5, 4, 3];                 // options shown (most sleep first)
  var IDEAL = { 5: true, 6: true };          // 7.5–9 h = the sweet spot

  var $ = function (id) { return document.getElementById(id); };
  var odo = $("odo"), sub = $("sub"), eyebrow = $("eyebrow"), status = $("status"),
      timeLabel = $("timeLabel"), optionsEl = $("options");
  var tabWake = $("tabWake"), tabBed = $("tabBed");

  var mode = "wake";   // "wake" = going to bed → alarm times ; "bed" = wake at → bedtimes
  var curH = 23, curM = 0;   // selected time, 24-hour

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function fmt(mins) {   // minutes-since-midnight → "7:15 AM"
    mins = ((mins % 1440) + 1440) % 1440;
    var h = Math.floor(mins / 60), m = mins % 60;
    var ap = h < 12 ? "AM" : "PM", h12 = h % 12; if (h12 === 0) h12 = 12;
    return h12 + ":" + pad(m) + " " + ap;
  }
  function dur(cycles) {   // total time asleep for N cycles → "7h 30m"
    var t = cycles * CYCLE, h = Math.floor(t / 60), m = t % 60;
    return h + "h" + (m ? " " + m + "m" : "");
  }
  function inputMins() { return curH * 60 + curM; }
  function setHeat(v) { document.documentElement.style.setProperty("--heat", Math.max(0, Math.min(1, v)).toFixed(3)); }

  function render() {
    var base = inputMins();
    optionsEl.innerHTML = "";

    // wake: alarm = asleep + buffer + N cycles ; bed: bedtime = wake - buffer - N cycles
    var results = CYCLES.map(function (n) {
      var t = mode === "wake" ? base + FALL_ASLEEP + n * CYCLE : base - FALL_ASLEEP - n * CYCLE;
      return { n: n, t: t };
    });

    // hero = the fullest ideal option (6 cycles)
    var hero = results[0];
    odo.textContent = fmt(hero.t);
    odo.setAttribute("aria-label", fmt(hero.t));
    if (mode === "wake") {
      sub.innerHTML = "Sleep now-ish and wake at <strong>" + fmt(hero.t) + "</strong> for a full " + dur(hero.n) + " — " + hero.n + " complete cycles.";
    } else {
      sub.innerHTML = "To wake at " + fmt(base) + " rested, get to bed by <strong>" + fmt(hero.t) + "</strong> (" + dur(hero.n) + " of sleep).";
    }
    setHeat(0.5);

    results.forEach(function (r) {
      var el = document.createElement("div");
      el.className = "opt" + (IDEAL[r.n] ? " opt--best" : "");
      var time = document.createElement("div"); time.className = "opt__time"; time.textContent = fmt(r.t);
      var meta = document.createElement("div"); meta.className = "opt__meta"; meta.textContent = r.n + " cycles · " + dur(r.n);
      el.appendChild(time); el.appendChild(meta);
      optionsEl.appendChild(el);
    });
  }

  function setMode(next) {
    mode = next;
    var wake = mode === "wake";
    tabWake.setAttribute("aria-selected", wake ? "true" : "false");
    tabBed.setAttribute("aria-selected", wake ? "false" : "true");
    eyebrow.textContent = wake ? "Set your alarm for" : "Head to bed by";
    timeLabel.textContent = wake ? "Falling asleep at" : "I need to wake at";
    status.textContent = wake
      ? "Based on 90-minute cycles + ~15 min to drift off."
      : "Counting back full 90-minute cycles from your alarm.";
    render();
  }
  tabWake.addEventListener("click", function () { if (mode !== "wake") setMode("wake"); });
  tabBed.addEventListener("click", function () { if (mode !== "bed") setMode("bed"); });

  /* ---------------- Custom time picker ---------------- */
  var trigger = $("timeTrigger"), valueEl = $("timeValue"), pop = $("timePop"),
      colH = $("colH"), colM = $("colM"), colA = $("colA");
  var open = false;

  function syncTrigger() { valueEl.textContent = fmt(inputMins()); }

  function markSel(col, val) {
    var kids = col.children;
    for (var i = 0; i < kids.length; i++) {
      var on = +kids[i].getAttribute("data-val") === val;
      kids[i].setAttribute("aria-selected", on ? "true" : "false");
    }
  }
  function refreshSel() {
    var h12 = curH % 12; if (h12 === 0) h12 = 12;
    markSel(colH, h12);
    markSel(colM, curM);
    markSel(colA, curH < 12 ? 0 : 1);
  }
  function scrollSelInto() {
    [colH, colM, colA].forEach(function (col) {
      var sel = col.querySelector('[aria-selected="true"]');
      if (sel) col.scrollTop = sel.offsetTop - col.clientHeight / 2 + sel.clientHeight / 2;
    });
  }

  function buildCol(col, items, onPick) {
    items.forEach(function (it) {
      var b = document.createElement("button");
      b.type = "button"; b.className = "timeopt"; b.setAttribute("role", "option");
      b.setAttribute("data-val", it.val); b.textContent = it.label;
      b.addEventListener("click", function () { onPick(it.val); });
      col.appendChild(b);
    });
  }
  (function initCols() {
    var hrs = [], mins = [];
    for (var h = 1; h <= 12; h++) hrs.push({ val: h, label: String(h) });
    for (var m = 0; m < 60; m += 5) mins.push({ val: m, label: pad(m) });
    buildCol(colH, hrs, function (h12) {
      var pm = curH >= 12; var h24 = h12 % 12; if (pm) h24 += 12;
      curH = h24; afterPick();
    });
    buildCol(colM, mins, function (m) { curM = m; afterPick(); });
    buildCol(colA, [{ val: 0, label: "AM" }, { val: 1, label: "PM" }], function (ap) {
      var h12 = curH % 12; curH = ap === 1 ? h12 + 12 : h12; afterPick();
    });
  })();

  function afterPick() { refreshSel(); syncTrigger(); status.textContent = "Custom time set."; render(); }

  function openPop() {
    if (open) return;
    open = true; pop.hidden = false; trigger.setAttribute("aria-expanded", "true");
    refreshSel(); scrollSelInto();
    setTimeout(function () { document.addEventListener("pointerdown", onOutside, true); }, 0);
  }
  function closePop() {
    if (!open) return;
    open = false; pop.hidden = true; trigger.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", onOutside, true);
  }
  function onOutside(e) { if (!$("timepick").contains(e.target)) closePop(); }

  trigger.addEventListener("click", function () { open ? closePop() : openPop(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && open) { closePop(); trigger.focus(); } });

  function setNow() {
    var d = new Date();
    curH = d.getHours();
    curM = Math.round(d.getMinutes() / 5) * 5; if (curM === 60) { curM = 0; curH = (curH + 1) % 24; }
    syncTrigger(); refreshSel();
  }
  $("nowBtn").addEventListener("click", function () { setNow(); closePop(); status.textContent = "Using the time right now."; render(); });

  setNow();          // default: right now (nice for the common "going to bed now" case)
  render();
})();
