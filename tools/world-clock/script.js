/* World Clock Overlap — stacked day/night bars + the shared-awake window. */
(function () {
  "use strict";

  var WAKE_START = 8, WAKE_END = 22;    // "awake / available" hours, local
  var MAX_CITIES = 5;

  // curated cities across the offsets (name, IANA zone)
  var CITIES = [
    ["Honolulu", "Pacific/Honolulu"], ["Anchorage", "America/Anchorage"],
    ["Los Angeles", "America/Los_Angeles"], ["Denver", "America/Denver"],
    ["Chicago", "America/Chicago"], ["New York", "America/New_York"],
    ["Toronto", "America/Toronto"], ["Mexico City", "America/Mexico_City"],
    ["Bogota", "America/Bogota"], ["Sao Paulo", "America/Sao_Paulo"],
    ["Buenos Aires", "America/Argentina/Buenos_Aires"], ["Reykjavik", "Atlantic/Reykjavik"],
    ["London", "Europe/London"], ["Lisbon", "Europe/Lisbon"],
    ["Madrid", "Europe/Madrid"], ["Paris", "Europe/Paris"],
    ["Berlin", "Europe/Berlin"], ["Rome", "Europe/Rome"],
    ["Amsterdam", "Europe/Amsterdam"], ["Stockholm", "Europe/Stockholm"],
    ["Athens", "Europe/Athens"], ["Cairo", "Africa/Cairo"],
    ["Johannesburg", "Africa/Johannesburg"], ["Istanbul", "Europe/Istanbul"],
    ["Moscow", "Europe/Moscow"], ["Nairobi", "Africa/Nairobi"],
    ["Dubai", "Asia/Dubai"], ["Karachi", "Asia/Karachi"],
    ["Mumbai", "Asia/Kolkata"], ["Dhaka", "Asia/Dhaka"],
    ["Bangkok", "Asia/Bangkok"], ["Jakarta", "Asia/Jakarta"],
    ["Singapore", "Asia/Singapore"], ["Hong Kong", "Asia/Hong_Kong"],
    ["Shanghai", "Asia/Shanghai"], ["Tokyo", "Asia/Tokyo"],
    ["Seoul", "Asia/Seoul"], ["Perth", "Australia/Perth"],
    ["Sydney", "Australia/Sydney"], ["Melbourne", "Australia/Melbourne"],
    ["Auckland", "Pacific/Auckland"]
  ];

  var $ = function (id) { return document.getElementById(id); };
  var rowsEl = $("rows"), axisEl = $("axis"), overlay = $("overlay");
  var nowline = $("nowline"), nowLab = $("nowLab"), overlapText = $("overlapText");
  var addSel = $("addCity"), nowBtn = $("nowBtn");

  var localTz = (Intl.DateTimeFormat().resolvedOptions().timeZone) || "UTC";

  // ---- timezone helpers ----
  function offsetMin(tz, date) {
    try {
      var dtf = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
      var p = {}; dtf.formatToParts(date).forEach(function (x) { p[x.type] = x.value; });
      var h = p.hour === "24" ? 0 : p.hour;
      var asUTC = Date.UTC(+p.year, p.month - 1, +p.day, +h, +p.minute, +p.second);
      return Math.round((asUTC - date.getTime()) / 60000);
    } catch (e) { return 0; }
  }
  function nameFromTz(tz) {
    var seg = tz.split("/").pop().replace(/_/g, " ");
    for (var i = 0; i < CITIES.length; i++) if (CITIES[i][1] === tz) return CITIES[i][0];
    return seg;
  }

  // ---- day/night color ramp (a bar reads as a little day) ----
  var RAMP = [
    [0, [38, 48, 80]], [5.5, [43, 54, 97]], [7, [224, 137, 90]], [9, [134, 202, 240]],
    [13, [169, 220, 245]], [17, [123, 192, 238]], [18.5, [229, 122, 85]], [20.5, [43, 54, 97]], [24, [38, 48, 80]]
  ];
  function ramp(h) {
    h = ((h % 24) + 24) % 24;
    for (var i = 0; i < RAMP.length - 1; i++) {
      var a = RAMP[i], b = RAMP[i + 1];
      if (h >= a[0] && h <= b[0]) {
        var t = (h - a[0]) / (b[0] - a[0]);
        return "rgb(" + Math.round(a[1][0] + (b[1][0] - a[1][0]) * t) + "," + Math.round(a[1][1] + (b[1][1] - a[1][1]) * t) + "," + Math.round(a[1][2] + (b[1][2] - a[1][2]) * t) + ")";
      }
    }
    return "rgb(38,48,80)";
  }
  function barGradient(deltaH) {
    var stops = [];
    for (var i = 0; i <= 24; i++) stops.push(ramp(i + deltaH) + " " + (i / 24 * 100).toFixed(2) + "%");
    return "linear-gradient(90deg," + stops.join(",") + ")";
  }

  function fmtTime(h) {
    h = ((h % 24) + 24) % 24;
    var hr = Math.floor(h + 1e-6), mn = Math.round((h - hr) * 60);
    if (mn === 60) { mn = 0; hr = (hr + 1) % 24; }
    var ap = hr < 12 ? "AM" : "PM", h12 = hr % 12; if (h12 === 0) h12 = 12;
    return h12 + (mn ? ":" + (mn < 10 ? "0" + mn : mn) : "") + " " + ap;
  }
  function fmtHourLabel(h) {
    h = ((h % 24) + 24) % 24;
    if (h === 0) return "12a"; if (h === 12) return "12p";
    return h < 12 ? h + "a" : (h - 12) + "p";
  }

  // ---- state ----
  var cities = [];        // [{name, tz}]
  var nowFrac = 0;        // 0..1 across the 24h local window
  var pinned = true;      // now-line tracks real time until dragged

  function nowLocalFrac() {
    var d = new Date();
    return (d.getHours() * 60 + d.getMinutes()) / 1440;
  }

  function load() {
    var tzs = null;
    if (location.hash.length > 1) {
      tzs = decodeURIComponent(location.hash.slice(1)).split(",").filter(Boolean);
    }
    if (!tzs) { try { tzs = JSON.parse(localStorage.getItem("wc_cities") || "null"); } catch (e) {} }
    if (!tzs || !tzs.length) tzs = [localTz, "America/New_York", "Europe/London"];
    // de-dup, cap
    var seen = {}, out = [];
    tzs.forEach(function (tz) { if (!seen[tz] && out.length < MAX_CITIES) { seen[tz] = 1; out.push({ name: nameFromTz(tz), tz: tz }); } });
    cities = out;
  }
  function persist() {
    var tzs = cities.map(function (c) { return c.tz; });
    try { localStorage.setItem("wc_cities", JSON.stringify(tzs)); } catch (e) {}
    try { history.replaceState(null, "", "#" + encodeURIComponent(tzs.join(","))); } catch (e) {}
  }

  // ---- render ----
  function buildAxis() {
    axisEl.innerHTML = '<div class="axis__labels"><span>12a</span><span>6a</span><span>12p</span><span>6p</span><span>12a</span></div>';
  }
  function buildAddOptions() {
    var used = {}; cities.forEach(function (c) { used[c.tz] = 1; });
    var full = cities.length >= MAX_CITIES;
    var html = '<option value="">' + (full ? "Up to " + MAX_CITIES + " cities" : "Add a city…") + "</option>";
    CITIES.forEach(function (c) { if (!used[c[1]]) html += '<option value="' + c[1] + '">' + c[0] + "</option>"; });
    addSel.innerHTML = html;
    addSel.disabled = full;
  }

  var now = new Date();
  function render() {
    now = new Date();
    var userOff = offsetMin(localTz, now);
    rowsEl.innerHTML = "";
    var deltas = [];
    cities.forEach(function (c, idx) {
      var d = (offsetMin(c.tz, now) - userOff) / 60;   // hours ahead of user
      deltas.push(d);
      var row = document.createElement("div");
      row.className = "crow" + (cities.length <= 1 ? " crow--solo" : "");
      var localH = nowFrac * 24 + d;
      row.innerHTML =
        '<div class="crow__name"><button type="button" class="crow__rm" data-i="' + idx + '" aria-label="Remove ' + c.name + '">✕</button><span class="crow__city">' + c.name + "</span></div>" +
        '<div class="crow__bar" style="background:' + barGradient(d) + '"></div>' +
        '<div class="crow__time">' + fmtTime(localH) + "</div>";
      rowsEl.appendChild(row);
    });

    // overlap ranges over the user-local day (fine steps)
    var STEP = 1 / 96, ranges = [], inRun = false, runStart = 0;
    for (var f = 0; f <= 1.0001; f += STEP) {
      var awake = cities.length > 0;
      for (var k = 0; k < deltas.length; k++) {
        var lh = ((f * 24 + deltas[k]) % 24 + 24) % 24;
        if (lh < WAKE_START || lh >= WAKE_END) { awake = false; break; }
      }
      if (awake && !inRun) { inRun = true; runStart = f; }
      else if (!awake && inRun) { inRun = false; ranges.push([runStart, f]); }
    }
    if (inRun) ranges.push([runStart, 1]);

    // draw overlap bands
    overlay.querySelectorAll(".overlap").forEach(function (n) { n.remove(); });
    ranges.forEach(function (r) {
      var band = document.createElement("div");
      band.className = "overlap";
      band.style.left = (r[0] * 100).toFixed(2) + "%";
      band.style.width = ((r[1] - r[0]) * 100).toFixed(2) + "%";
      overlay.insertBefore(band, nowline);
    });

    // headline (in user-local time)
    if (!ranges.length) {
      overlapText.innerHTML = '<span class="none">No shared awake hours</span>';
    } else {
      var parts = ranges.slice(0, 2).map(function (r) { return "<b>" + fmtTime(r[0] * 24) + "</b> to <b>" + fmtTime(r[1] * 24 - 1e-6) + "</b>"; });
      overlapText.innerHTML = parts.join(" &amp; ") + (cities.length > 1 ? " your time" : "");
    }

    // now-line
    nowline.style.left = (nowFrac * 100).toFixed(2) + "%";
    nowLab.textContent = fmtTime(nowFrac * 24) + (pinned ? " now" : "");
  }

  function renderAll() { buildAddOptions(); render(); }

  // ---- interactions ----
  function fracFromEvent(e) {
    var rect = overlay.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  }
  var dragging = false;
  overlay.addEventListener("pointerdown", function (e) {
    dragging = true; pinned = false; overlay.setPointerCapture(e.pointerId);
    nowFrac = fracFromEvent(e); render(); e.preventDefault();
  });
  overlay.addEventListener("pointermove", function (e) { if (dragging) { nowFrac = fracFromEvent(e); render(); } });
  function endDrag() { dragging = false; }
  overlay.addEventListener("pointerup", endDrag);
  overlay.addEventListener("pointercancel", endDrag);

  nowBtn.addEventListener("click", function () { pinned = true; nowFrac = nowLocalFrac(); render(); });

  addSel.addEventListener("change", function () {
    var tz = addSel.value; if (!tz || cities.length >= MAX_CITIES) return;
    cities.push({ name: nameFromTz(tz), tz: tz });
    persist(); renderAll();
  });

  rowsEl.addEventListener("click", function (e) {
    var b = e.target.closest(".crow__rm"); if (!b) return;
    var i = +b.getAttribute("data-i");
    if (cities.length > 1) { cities.splice(i, 1); persist(); renderAll(); }
  });

  // keep real time fresh; if pinned, the now-line follows
  setInterval(function () { if (pinned) nowFrac = nowLocalFrac(); render(); }, 20000);

  // ---- boot ----
  load();
  buildAxis();
  nowFrac = nowLocalFrac();
  renderAll();
})();
