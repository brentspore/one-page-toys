/* Golden Hour — One Page Toys
 *
 * Everything is derived from one function: the sun's altitude at an instant,
 * for a latitude and longitude. Sample that across the local day and you get
 * the ribbon colours, the event times (by scanning for threshold crossings)
 * and the countdown, all from the same curve — so the picture and the numbers
 * can never disagree with each other.
 *
 * No API and no geo database: the solar position is standard low-precision
 * astronomy, and time zones come from Intl, which every target browser ships.
 */
(function () {
  "use strict";

  var rad = Math.PI / 180;
  var DAY_MS = 86400000;
  var J1970 = 2440588, J2000 = 2451545;
  var EARTH_TILT = rad * 23.4397;

  function toDays(t) { return (t / DAY_MS - 0.5 + J1970) - J2000; }

  /* Sun altitude in degrees. NOAA/Meeus low precision — a fraction of a degree,
   * which at the sun's ~0.25°/min sink rate is well under a minute of error on
   * the event times. */
  function sunAltitude(t, lat, lon) {
    var d = toDays(t);
    var M = rad * (357.5291 + 0.98560028 * d);
    var C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
    var L = M + C + rad * 102.9372 + Math.PI;
    var dec = Math.asin(Math.sin(EARTH_TILT) * Math.sin(L));
    var ra = Math.atan2(Math.sin(L) * Math.cos(EARTH_TILT), Math.cos(L));
    var lw = rad * -lon;
    var theta = rad * (280.16 + 360.9856235 * d) - lw;      // local sidereal time
    var H = theta - ra;
    var phi = rad * lat;
    return Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H)) / rad;
  }

  // ------------------------------------------------------------ time zones

  /* Offset of `tz` from UTC at instant t, in ms. Formatting the instant in the
   * zone and reading it back as if it were UTC is the standard trick — it
   * needs no tz database of our own and handles DST because Intl does. */
  function tzOffset(t, tz) {
    var dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hour12: false,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit"
    });
    var p = {};
    dtf.formatToParts(new Date(t)).forEach(function (x) { p[x.type] = x.value; });
    var asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, (+p.hour) % 24, +p.minute, +p.second);
    return asUTC - t;
  }

  /* The UTC instant of local midnight for the day containing t.
   * One refinement pass settles the DST-boundary case where the offset used to
   * build the guess is not the offset in force at the guess. */
  function localMidnight(t, tz) {
    var off = tzOffset(t, tz);
    var local = new Date(t + off);
    var guess = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - off;
    var off2 = tzOffset(guess, tz);
    if (off2 !== off) {
      guess = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - off2;
    }
    return guess;
  }

  function fmtTime(t, tz) {
    return new Intl.DateTimeFormat(undefined, {
      timeZone: tz, hour: "numeric", minute: "2-digit"
    }).format(new Date(t));
  }

  // ------------------------------------------------------------- the curve

  /* Sun altitude sampled once a minute across the local day. Every downstream
   * answer reads from this array. */
  function daySamples(t0, lat, lon) {
    var n = 1440, out = new Float64Array(n + 1);
    for (var i = 0; i <= n; i++) out[i] = sunAltitude(t0 + i * 60000, lat, lon);
    return out;
  }

  /* First minute where altitude crosses `deg` in `dir` (+1 rising, -1 setting),
   * refined by bisection. Returns null when it simply never happens that day —
   * a real answer in Reykjavík in June, not an error. */
  function crossing(samples, t0, lat, lon, deg, dir) {
    for (var i = 0; i < samples.length - 1; i++) {
      var a = samples[i], b = samples[i + 1];
      var hit = dir > 0 ? (a < deg && b >= deg) : (a >= deg && b < deg);
      if (!hit) continue;
      var lo = t0 + i * 60000, hi = lo + 60000;
      for (var k = 0; k < 22; k++) {
        var mid = (lo + hi) / 2;
        var v = sunAltitude(mid, lat, lon);
        if (dir > 0 ? v < deg : v >= deg) lo = mid; else hi = mid;
      }
      return (lo + hi) / 2;
    }
    return null;
  }

  /* Altitude thresholds. -0.833° folds in refraction and the solar radius, so
   * sunrise means the upper limb touching the horizon, matching every almanac.
   * Golden hour is -4°..+6° and blue hour -6°..-4°, the photographic
   * conventions. */
  var SUN_H = -0.833, GOLD_HI = 6, GOLD_LO = -4, BLUE_LO = -6, NIGHT = -18;

  function computeDay(t0, lat, lon) {
    var s = daySamples(t0, lat, lon);
    var maxAlt = -90, maxAt = t0;
    for (var i = 0; i < s.length; i++) if (s[i] > maxAlt) { maxAlt = s[i]; maxAt = t0 + i * 60000; }
    var minAlt = 90;
    for (i = 0; i < s.length; i++) if (s[i] < minAlt) minAlt = s[i];

    var rise = crossing(s, t0, lat, lon, SUN_H, 1);
    var set = crossing(s, t0, lat, lon, SUN_H, -1);
    return {
      samples: s, t0: t0, maxAlt: maxAlt, minAlt: minAlt, noon: maxAt,
      rise: rise, set: set,
      goldAmEnd: crossing(s, t0, lat, lon, GOLD_HI, 1),
      goldAmStart: crossing(s, t0, lat, lon, GOLD_LO, 1),
      goldPmStart: crossing(s, t0, lat, lon, GOLD_HI, -1),
      goldPmEnd: crossing(s, t0, lat, lon, GOLD_LO, -1),
      blueAmStart: crossing(s, t0, lat, lon, BLUE_LO, 1),
      bluePmEnd: crossing(s, t0, lat, lon, BLUE_LO, -1),
      dayLen: (rise != null && set != null) ? set - rise : (maxAlt > SUN_H ? DAY_MS : 0)
    };
  }

  // --------------------------------------------------------------- colours

  /* Sky colour as a function of sun altitude. The stops are the whole look of
   * the piece: night holds until astronomical twilight, then blue hour lifts
   * fast, the horizon band goes warm, and daylight settles to a flat blue. */
  var STOPS = [
    [-90, [4, 6, 14]], [-18, [7, 11, 26]], [-12, [14, 23, 52]],
    [-8, [26, 45, 96]], [-6, [40, 68, 132]], [-4, [86, 96, 152]],
    [-2, [176, 116, 132]], [-0.833, [232, 130, 90]], [1, [243, 158, 74]],
    [4, [246, 186, 96]], [6, [247, 209, 142]], [10, [206, 219, 214]],
    [18, [154, 197, 235]], [35, [106, 172, 235]], [60, [74, 146, 228]], [90, [62, 132, 220]]
  ];
  function skyColor(alt) {
    if (alt <= STOPS[0][0]) return STOPS[0][1];
    for (var i = 1; i < STOPS.length; i++) {
      if (alt <= STOPS[i][0]) {
        var a = STOPS[i - 1], b = STOPS[i];
        var u = (alt - a[0]) / (b[0] - a[0]);
        return [
          Math.round(a[1][0] + (b[1][0] - a[1][0]) * u),
          Math.round(a[1][1] + (b[1][1] - a[1][1]) * u),
          Math.round(a[1][2] + (b[1][2] - a[1][2]) * u)
        ];
      }
    }
    return STOPS[STOPS.length - 1][1];
  }
  function rgb(c) { return "rgb(" + c[0] + "," + c[1] + "," + c[2] + ")"; }

  // ------------------------------------------------------------------ data

  var PLACES = [
    { n: "London", lat: 51.507, lon: -0.128, tz: "Europe/London" },
    { n: "New York", lat: 40.713, lon: -74.006, tz: "America/New_York" },
    { n: "Los Angeles", lat: 34.052, lon: -118.244, tz: "America/Los_Angeles" },
    { n: "Chicago", lat: 41.878, lon: -87.630, tz: "America/Chicago" },
    { n: "Denver", lat: 39.739, lon: -104.990, tz: "America/Denver" },
    { n: "Toronto", lat: 43.653, lon: -79.383, tz: "America/Toronto" },
    { n: "Mexico City", lat: 19.433, lon: -99.133, tz: "America/Mexico_City" },
    { n: "São Paulo", lat: -23.551, lon: -46.633, tz: "America/Sao_Paulo" },
    { n: "Reykjavík", lat: 64.147, lon: -21.942, tz: "Atlantic/Reykjavik" },
    { n: "Paris", lat: 48.857, lon: 2.352, tz: "Europe/Paris" },
    { n: "Berlin", lat: 52.520, lon: 13.405, tz: "Europe/Berlin" },
    { n: "Madrid", lat: 40.417, lon: -3.704, tz: "Europe/Madrid" },
    { n: "Moscow", lat: 55.756, lon: 37.617, tz: "Europe/Moscow" },
    { n: "Cape Town", lat: -33.925, lon: 18.424, tz: "Africa/Johannesburg" },
    { n: "Dubai", lat: 25.205, lon: 55.271, tz: "Asia/Dubai" },
    { n: "Mumbai", lat: 19.076, lon: 72.878, tz: "Asia/Kolkata" },
    { n: "Singapore", lat: 1.352, lon: 103.820, tz: "Asia/Singapore" },
    { n: "Tokyo", lat: 35.676, lon: 139.650, tz: "Asia/Tokyo" },
    { n: "Sydney", lat: -33.868, lon: 151.209, tz: "Australia/Sydney" },
    { n: "Auckland", lat: -36.848, lon: 174.763, tz: "Pacific/Auckland" }
  ];

  var LEGEND = [
    { c: [10, 16, 38], l: "Night" },
    { c: [40, 68, 132], l: "Blue hour" },
    { c: [243, 158, 74], l: "Golden hour" },
    { c: [140, 190, 232], l: "Daylight" }
  ];

  // -------------------------------------------------------------------- ui

  var eyebrow = document.getElementById("eyebrow");
  var countdownEl = document.getElementById("countdown");
  var sublineEl = document.getElementById("subline");
  var band = document.getElementById("band");
  var bctx = band.getContext("2d");
  var ribbon = document.getElementById("ribbon");
  var nowMark = document.getElementById("nowMark");
  var nowLab = document.getElementById("nowLab");
  var ticksEl = document.getElementById("ticks");
  var legendEl = document.getElementById("legend");
  var timesEl = document.getElementById("times");
  var placeSel = document.getElementById("placeSel");
  var locBtn = document.getElementById("locBtn");
  var noteEl = document.getElementById("note");

  var PLACE_KEY = "gh_place";
  var place = null, day = null;

  function defaultPlace() {
    try {
      var saved = JSON.parse(localStorage.getItem(PLACE_KEY) || "null");
      if (saved && typeof saved.lat === "number" && typeof saved.lon === "number" && saved.tz) return saved;
    } catch (e) {}
    // Guess from the browser's zone so the first paint is usually already right.
    try {
      var tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      for (var i = 0; i < PLACES.length; i++) if (PLACES[i].tz === tz) return PLACES[i];
    } catch (e) {}
    return PLACES[0];
  }

  function savePlace(p) {
    try { localStorage.setItem(PLACE_KEY, JSON.stringify(p)); } catch (e) {}
  }

  PLACES.forEach(function (p, i) {
    var o = document.createElement("option");
    o.value = String(i); o.textContent = p.n;
    placeSel.appendChild(o);
  });

  LEGEND.forEach(function (g) {
    var li = document.createElement("li");
    var i = document.createElement("i");
    i.style.background = rgb(g.c);
    li.appendChild(i);
    li.appendChild(document.createTextNode(g.l));
    legendEl.appendChild(li);
  });

  function sizeBand() {
    var r = band.getBoundingClientRect();
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    band.width = Math.max(2, Math.round(r.width * dpr));
    band.height = Math.max(2, Math.round(r.height * dpr));
  }

  function drawBand() {
    if (!day) return;
    sizeBand();
    var W = band.width, H = band.height;
    var s = day.samples, n = s.length - 1;

    // one column per pixel, colour from the sun's altitude at that minute
    for (var x = 0; x < W; x++) {
      var idx = Math.min(n, Math.round((x / (W - 1)) * n));
      bctx.fillStyle = rgb(skyColor(s[idx]));
      bctx.fillRect(x, 0, 1, H);
    }

    // vertical shading so the band has depth instead of reading as a flat swatch
    var vg = bctx.createLinearGradient(0, 0, 0, H);
    vg.addColorStop(0, "rgba(0,0,0,0.28)");
    vg.addColorStop(0.45, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(0,0,0,0.30)");
    bctx.fillStyle = vg;
    bctx.fillRect(0, 0, W, H);

    // the sun's own arc, mapped so the horizon sits low in the band
    var lo = -25, hi = Math.max(20, day.maxAlt + 8);
    function yOf(alt) {
      var u = (alt - lo) / (hi - lo);
      return H - Math.max(0, Math.min(1, u)) * H * 0.86 - H * 0.07;
    }
    bctx.beginPath();
    for (x = 0; x < W; x++) {
      var i2 = Math.min(n, Math.round((x / (W - 1)) * n));
      var y = yOf(s[i2]);
      if (x === 0) bctx.moveTo(x, y); else bctx.lineTo(x, y);
    }
    bctx.strokeStyle = "rgba(255,255,255,0.5)";
    bctx.lineWidth = Math.max(1, H * 0.014);
    bctx.stroke();

    // horizon reference
    var hy = yOf(0);
    bctx.beginPath();
    bctx.moveTo(0, hy); bctx.lineTo(W, hy);
    bctx.strokeStyle = "rgba(255,255,255,0.26)";
    bctx.lineWidth = Math.max(1, H * 0.008);
    bctx.setLineDash([H * 0.05, H * 0.05]);
    bctx.stroke();
    bctx.setLineDash([]);
  }

  function fmtGap(ms) {
    if (ms < 0) ms = 0;
    var mins = Math.round(ms / 60000);
    var h = Math.floor(mins / 60), m = mins % 60;
    if (h >= 24) { var d = Math.floor(h / 24); return d + "d " + (h % 24) + "h"; }
    if (h > 0) return h + "h " + String(m).padStart(2, "0") + "m";
    return m + "m";
  }
  function fmtLen(ms) {
    var mins = Math.round(ms / 60000);
    return Math.floor(mins / 60) + "h " + String(mins % 60).padStart(2, "0") + "m";
  }

  function card(k, v, sub, hero) {
    var d = document.createElement("div");
    d.className = "tcard" + (hero ? " tcard--hero" : "");
    var a = document.createElement("span"); a.className = "tcard__k"; a.textContent = k;
    var b = document.createElement("span"); b.className = "tcard__v"; b.textContent = v;
    d.appendChild(a); d.appendChild(b);
    if (sub) { var c = document.createElement("span"); c.className = "tcard__sub"; c.textContent = sub; d.appendChild(c); }
    return d;
  }

  function span(a, b, tz) {
    if (a == null || b == null) return "—";
    return fmtTime(a, tz) + " – " + fmtTime(b, tz);
  }

  function render() {
    var now = Date.now();
    var t0 = localMidnight(now, place.tz);
    day = computeDay(t0, place.lat, place.lon);
    var tz = place.tz;

    drawBand();

    // now-line, only when "now" actually falls inside the drawn day
    var frac = (now - t0) / DAY_MS;
    if (frac >= 0 && frac <= 1) {
      nowMark.hidden = false;
      nowMark.style.left = (frac * 100) + "%";
      nowLab.textContent = fmtTime(now, tz);
    } else {
      nowMark.hidden = true;
    }

    ticksEl.innerHTML = "";
    ["00:00", "06:00", "12:00", "18:00", "24:00"].forEach(function (t) {
      var s = document.createElement("span"); s.textContent = t; ticksEl.appendChild(s);
    });

    timesEl.innerHTML = "";
    var pmHero = day.goldPmStart != null;
    timesEl.appendChild(card("Golden hour AM", span(day.goldAmStart, day.goldAmEnd, tz), null, false));
    timesEl.appendChild(card("Golden hour PM", span(day.goldPmStart, day.goldPmEnd, tz), null, pmHero));
    timesEl.appendChild(card("Sunrise", day.rise != null ? fmtTime(day.rise, tz) : "—", null, false));
    timesEl.appendChild(card("Sunset", day.set != null ? fmtTime(day.set, tz) : "—", null, false));
    timesEl.appendChild(card("Blue hour PM", span(day.goldPmEnd, day.bluePmEnd, tz), null, false));
    timesEl.appendChild(card("Day length", day.dayLen ? fmtLen(day.dayLen) : "—", null, false));

    // headline: the next golden-hour edge, or that we're inside one right now
    var inAm = day.goldAmStart != null && day.goldAmEnd != null && now >= day.goldAmStart && now <= day.goldAmEnd;
    var inPm = day.goldPmStart != null && day.goldPmEnd != null && now >= day.goldPmStart && now <= day.goldPmEnd;

    if (inAm || inPm) {
      var until = inAm ? day.goldAmEnd : day.goldPmEnd;
      eyebrow.textContent = "Golden hour, right now";
      countdownEl.textContent = fmtGap(until - now) + " left";
      sublineEl.textContent = "Go shoot. Ends at " + fmtTime(until, tz) + " in " + place.n + ".";
    } else {
      var next = null, label = "";
      if (day.goldAmStart != null && now < day.goldAmStart) { next = day.goldAmStart; label = "this morning"; }
      else if (day.goldPmStart != null && now < day.goldPmStart) { next = day.goldPmStart; label = "this evening"; }
      if (next == null) {
        // past today's light — look at tomorrow
        var tmr = computeDay(localMidnight(now + DAY_MS, tz), place.lat, place.lon);
        if (tmr.goldAmStart != null) { next = tmr.goldAmStart; label = "tomorrow morning"; }
      }
      if (next == null) {
        eyebrow.textContent = "No golden hour";
        countdownEl.textContent = day.maxAlt > GOLD_HI ? "Sun stays high" : "Sun stays low";
        sublineEl.textContent = place.n + " does not pass through the golden band today — that is what living at this latitude looks like.";
      } else {
        eyebrow.textContent = "Next golden hour";
        countdownEl.textContent = "in " + fmtGap(next - now);
        sublineEl.textContent = "Starts " + fmtTime(next, tz) + " " + label + " in " + place.n + ".";
      }
    }

    // keep the picker in step when the place came from geolocation
    var idx = PLACES.findIndex(function (p) { return p.n === place.n; });
    placeSel.value = idx >= 0 ? String(idx) : "";
  }

  placeSel.addEventListener("change", function () {
    var p = PLACES[+placeSel.value];
    if (!p) return;
    place = p; savePlace(p); noteEl.textContent = "";
    render();
    track("gh_place_change");
  });

  locBtn.addEventListener("click", function () {
    if (!navigator.geolocation) { noteEl.textContent = "This browser has no location support — pick a city instead."; return; }
    locBtn.disabled = true;
    noteEl.textContent = "Asking your browser for a location…";
    navigator.geolocation.getCurrentPosition(function (pos) {
      var tz = PLACES[0].tz;
      try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || tz; } catch (e) {}
      place = {
        n: "your location", lat: pos.coords.latitude, lon: pos.coords.longitude, tz: tz
      };
      savePlace(place);
      locBtn.disabled = false;
      noteEl.textContent = "Using your location, to one decimal: " +
        place.lat.toFixed(1) + ", " + place.lon.toFixed(1) + ". It never leaves this page.";
      render();
      track("gh_geolocate");
    }, function () {
      locBtn.disabled = false;
      noteEl.textContent = "Could not get a location — pick a city instead.";
    }, { timeout: 9000, maximumAge: 600000 });
  });

  var tracked = {};
  function track(name) {
    if (tracked[name]) return;
    tracked[name] = true;
    try { if (typeof window.gtag === "function") window.gtag("event", name, { toy: "golden-hour" }); } catch (e) {}
  }

  window.addEventListener("resize", function () { if (day) { drawBand(); render(); } });

  place = defaultPlace();
  render();
  setInterval(render, 30000);

  try { if (typeof window.gtag === "function") window.gtag("event", "toy_start", { toy: "golden-hour" }); } catch (e) {}
})();
