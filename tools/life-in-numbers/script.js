/* Life in Numbers — your whole life, counting up live.
 * Pick a birthday; seconds / heartbeats / breaths tick in real time, plus days,
 * trips around the Sun, full moons seen, and a countdown to your next birthday.
 * Vanilla, self-contained, theme-aware. */
(function () {
  "use strict";

  var BPM = 72, BREATHS_MIN = 15, LUNAR_DAYS = 29.530588;   // gentle averages
  var DAY_MS = 86400000, YEAR_MS = 365.2425 * DAY_MS;

  var $ = function (id) { return document.getElementById(id); };
  var odo = $("odo"), sub = $("sub"), status = $("status"), heat = $("heat");
  var birthday = $("birthday");
  var elDays = $("days"), elBeats = $("beats"), elBreaths = $("breaths"),
      elSun = $("sun"), elMoons = $("moons"), elNext = $("next");
  var DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  var birthMs = null;

  function fmt(n, dp) { return n.toLocaleString("en-US", { minimumFractionDigits: dp || 0, maximumFractionDigits: dp || 0 }); }
  function abbrev(n) {   // compact for the supporting stats that reach the millions/billions
    if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
    if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e8 ? 0 : 1) + "M";
    return fmt(Math.floor(n));
  }
  function setHeat(v) { document.documentElement.style.setProperty("--heat", Math.max(0, Math.min(1, v)).toFixed(3)); }

  function parseBirth() {
    var v = birthday.value;
    if (!v) { birthMs = null; return; }
    var p = v.split("-");
    // local noon avoids timezone/DST edge cases flipping the day
    var d = new Date(+p[0], +p[1] - 1, +p[2], 12, 0, 0);
    birthMs = isNaN(d.getTime()) ? null : d.getTime();
  }

  function nextBirthday(now) {
    var b = new Date(birthMs), n = new Date(now);
    var y = n.getFullYear();
    var next = new Date(y, b.getMonth(), b.getDate(), 0, 0, 0);
    if (next.getTime() <= now) next = new Date(y + 1, b.getMonth(), b.getDate(), 0, 0, 0);
    return next.getTime();
  }

  function render() {
    var now = Date.now();
    if (birthMs == null) {
      odo.textContent = "—";
      elDays.textContent = elBeats.textContent = elBreaths.textContent = "—";
      elSun.textContent = elMoons.textContent = elNext.textContent = "—";
      sub.innerHTML = "Pick your birthday to bring your life to life.";
      setHeat(0);
      return;
    }
    if (birthMs > now) {
      odo.textContent = "0";
      sub.innerHTML = "That's in the future — pick the day you were <em>born</em>.";
      elDays.textContent = elBeats.textContent = elBreaths.textContent = "0";
      elSun.textContent = "0"; elMoons.textContent = "0"; elNext.textContent = "—";
      setHeat(0);
      return;
    }
    var ms = now - birthMs, secs = ms / 1000, mins = secs / 60, days = ms / DAY_MS;
    odo.textContent = fmt(Math.floor(secs));
    odo.setAttribute("aria-label", fmt(Math.floor(secs)) + " seconds");
    elDays.textContent = fmt(Math.floor(days));
    elBeats.textContent = abbrev(mins * BPM);
    elBreaths.textContent = abbrev(mins * BREATHS_MIN);
    elSun.textContent = fmt(ms / YEAR_MS, 2);
    elMoons.textContent = fmt(Math.floor(days / LUNAR_DAYS));

    var nb = nextBirthday(now), left = nb - now;
    var dLeft = Math.floor(left / DAY_MS), hLeft = Math.floor((left % DAY_MS) / 3600000);
    if (dLeft === 0 && hLeft < 24 && new Date(now).getDate() === new Date(birthMs).getDate() && new Date(now).getMonth() === new Date(birthMs).getMonth()) {
      elNext.textContent = "Today! 🎉";
    } else {
      elNext.textContent = dLeft + "d " + hLeft + "h";
    }

    var age = Math.floor(ms / YEAR_MS);
    var born = DAYS[new Date(birthMs).getDay()];
    sub.innerHTML = "You were born on a <strong>" + born + "</strong> — about <strong>" + age + "</strong> years, or " + fmt(Math.floor(days)) + " days, ago.";
    setHeat(Math.min(1, age / 90));   // a long life glows warmer
  }

  birthday.addEventListener("input", function () { parseBirth(); status.textContent = birthMs ? "Counting from " + birthday.value + "." : "Every second counts."; render(); });

  function frame() { render(); requestAnimationFrame(frame); }
  parseBirth();
  render();
  requestAnimationFrame(frame);
})();
