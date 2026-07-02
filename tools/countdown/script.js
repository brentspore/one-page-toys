/* Countdown to Anything — name a moment, watch it tick down live.
 * Days/hours/minutes/seconds update in real time; dynamic presets for common
 * events; share the countdown via a link that encodes the name + target time.
 * Vanilla, self-contained, theme-aware. */
(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };
  var odo = $("odo"), sub = $("sub"), eyebrow = $("eyebrow"), status = $("status"),
      titleEl = $("title"), targetEl = $("target"), heat = $("heat");
  var hh = $("hh"), mm = $("mm"), ss = $("ss");

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function toLocalInput(d) {
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }
  function fmtDate(d) {
    return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" }) +
      ", " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }
  function targetDate() { var v = targetEl.value; if (!v) return null; var d = new Date(v); return isNaN(d.getTime()) ? null : d; }
  function setHeat(v) { document.documentElement.style.setProperty("--heat", Math.max(0, Math.min(1, v)).toFixed(3)); }

  // ---- dynamic preset dates ----
  function nextAnnual(month, day, h) {
    var now = new Date(), y = now.getFullYear();
    var d = new Date(y, month, day, h || 0, 0, 0);
    if (d.getTime() <= now.getTime()) d = new Date(y + 1, month, day, h || 0, 0, 0);
    return d;
  }
  function nextWeekday(dow, h, m) {
    var now = new Date(), add = (dow - now.getDay() + 7) % 7;
    var d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + add, h, m || 0, 0);
    if (d.getTime() <= now.getTime()) d = new Date(d.getTime() + 7 * 86400000);
    return d;
  }
  var PRESETS = {
    newyear: { name: "New Year's Day", when: function () { return nextAnnual(0, 1, 0); } },
    christmas: { name: "Christmas", when: function () { return nextAnnual(11, 25, 0); } },
    weekend: { name: "The weekend", when: function () { return nextWeekday(6, 0, 0); } },   // next Saturday 00:00
    friday: { name: "Friday 5pm", when: function () { return nextWeekday(5, 17, 0); } }
  };

  function applyPreset(key) {
    var p = PRESETS[key]; if (!p) return;
    titleEl.value = p.name;
    targetEl.value = toLocalInput(p.when());
    markPreset();
  }
  var presetBtns = document.querySelectorAll("#presets .preset");
  function markPreset() {
    var v = targetEl.value;
    presetBtns.forEach(function (b) {
      var p = PRESETS[b.getAttribute("data-preset")];
      var on = p && toLocalInput(p.when()) === v && titleEl.value === p.name;
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }
  presetBtns.forEach(function (b) {
    b.addEventListener("click", function () { applyPreset(b.getAttribute("data-preset")); status.textContent = "Counting down to " + titleEl.value + "."; render(); });
  });

  // ---- render ----
  function render() {
    var d = targetDate();
    var name = (titleEl.value || "the big moment").trim();
    if (!d) { odo.textContent = "—"; hh.textContent = mm.textContent = ss.textContent = "00"; sub.innerHTML = "Pick a target date &amp; time to start the countdown."; setHeat(0); return; }

    var diff = d.getTime() - Date.now(), past = diff < 0, a = Math.abs(diff);
    var days = Math.floor(a / 86400000), hrs = Math.floor(a / 3600000) % 24,
        mins = Math.floor(a / 60000) % 60, secs = Math.floor(a / 1000) % 60;

    odo.textContent = days.toLocaleString("en-US");
    odo.setAttribute("aria-label", days + (past ? " days since" : " days until"));
    hh.textContent = pad(hrs); mm.textContent = pad(mins); ss.textContent = pad(secs);
    eyebrow.textContent = past ? "Days since" : "Days to go";

    if (!past && diff < 60000) {
      sub.innerHTML = "🎉 <strong>" + name + "</strong> is basically here!";
      setHeat(1);
    } else if (past && a < 86400000) {
      sub.innerHTML = "🎉 <strong>" + name + "</strong> is happening — it began " + fmtDate(d) + ".";
      setHeat(0.9);
    } else if (past) {
      sub.innerHTML = "<strong>" + name + "</strong> was " + fmtDate(d) + " — " + days.toLocaleString("en-US") + " days ago.";
      setHeat(0.15);
    } else {
      sub.innerHTML = "Until <strong>" + name + "</strong> — " + fmtDate(d) + ".";
      setHeat(Math.max(0.2, Math.min(0.85, 1 - days / 120)));   // warmer as it approaches
    }
  }

  titleEl.addEventListener("input", function () { markPreset(); render(); });
  targetEl.addEventListener("input", function () { markPreset(); render(); });

  // ---- share link (encodes name + target in the URL hash) ----
  function writeHash() {
    var h = "#e=" + encodeURIComponent(titleEl.value || "") + "&t=" + encodeURIComponent(targetEl.value || "");
    try { history.replaceState(null, "", location.pathname + location.search + h); } catch (e) { location.hash = h; }
  }
  function readHash() {
    var h = location.hash.replace(/^#/, ""); if (!h) return false;
    var params = {}; h.split("&").forEach(function (kv) { var i = kv.indexOf("="); if (i > -1) params[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1)); });
    if (params.t) { targetEl.value = params.t; if (params.e) titleEl.value = params.e; return true; }
    return false;
  }
  $("copyBtn").addEventListener("click", function () {
    writeHash();
    var url = location.href;
    var done = function () { status.textContent = "Link copied — share your countdown!"; };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, done);
    else { try { var t = document.createElement("textarea"); t.value = url; document.body.appendChild(t); t.select(); document.execCommand("copy"); t.remove(); done(); } catch (e) { status.textContent = "Copy the address bar to share."; } }
  });

  // ---- boot ----
  if (!readHash()) applyPreset("newyear");
  markPreset();
  render();
  setInterval(render, 1000);
})();
