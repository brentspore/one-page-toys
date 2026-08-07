/* Moon Phase Tonight — One Page Toys
 *
 * Two halves:
 *   1. Astronomy. Low-precision Meeus (Astronomical Algorithms, ch. 47/25),
 *      carrying only the leading periodic terms: about a percent on
 *      illumination and well under an hour on the quarter dates. Plenty for a
 *      phase viewer, NOT an ephemeris — don't quote it for an eclipse. No API,
 *      no data file, works offline and for any date you scrub to.
 *   2. Rendering. The face is drawn ONCE into an offscreen canvas with the real
 *      maria and rayed craters roughly where they sit on the near side, then
 *      each frame composites that texture under a terminator shadow. Drawing
 *      the actual near side is the whole point: a generic cratered ball reads
 *      as clip art, this reads as the moon you'd look up at.
 */
(function () {
  "use strict";

  var rad = Math.PI / 180;
  var DAY_MS = 86400000;
  var SYNODIC = 29.530588853;          // mean lunar month, days
  var J1970 = 2440588, J2000 = 2451545;
  var EARTH_TILT = rad * 23.4397;

  function toDays(date) { return (date / DAY_MS - 0.5 + J1970) - J2000; }

  function rightAscension(l, b) {
    return Math.atan2(Math.sin(l) * Math.cos(EARTH_TILT) - Math.tan(b) * Math.sin(EARTH_TILT), Math.cos(l));
  }
  function declination(l, b) {
    return Math.asin(Math.sin(b) * Math.cos(EARTH_TILT) + Math.cos(b) * Math.sin(EARTH_TILT) * Math.sin(l));
  }

  function sunCoords(d) {
    var M = rad * (357.5291 + 0.98560028 * d);                       // mean anomaly
    var C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
    var L = M + C + rad * 102.9372 + Math.PI;                        // ecliptic longitude
    return { ra: rightAscension(L, 0), dec: declination(L, 0) };
  }

  function moonCoords(d) {
    var L = rad * (218.316 + 13.176396 * d);   // mean longitude
    var M = rad * (134.963 + 13.064993 * d);   // mean anomaly
    var F = rad * (93.272 + 13.229350 * d);    // argument of latitude
    var l = L + rad * 6.289 * Math.sin(M);     // ecliptic longitude
    var b = rad * 5.128 * Math.sin(F);         // ecliptic latitude
    var dt = 385001 - 20905 * Math.cos(M);     // distance, km
    return { ra: rightAscension(l, b), dec: declination(l, b), dist: dt };
  }

  /* Illuminated fraction + where we are in the cycle.
   * phase: 0 = new, 0.25 = first quarter, 0.5 = full, 0.75 = last quarter. */
  function illumination(date) {
    var d = toDays(date);
    var s = sunCoords(d), m = moonCoords(d);
    var sdist = 149598000;
    var phi = Math.acos(Math.sin(s.dec) * Math.sin(m.dec) +
                        Math.cos(s.dec) * Math.cos(m.dec) * Math.cos(s.ra - m.ra));
    var inc = Math.atan2(sdist * Math.sin(phi), m.dist - sdist * Math.cos(phi));
    var angle = Math.atan2(Math.cos(s.dec) * Math.sin(s.ra - m.ra),
                           Math.sin(s.dec) * Math.cos(m.dec) -
                           Math.cos(s.dec) * Math.sin(m.dec) * Math.cos(s.ra - m.ra));
    return {
      fraction: (1 + Math.cos(inc)) / 2,
      phase: 0.5 + 0.5 * inc * (angle < 0 ? -1 : 1) / Math.PI,
      dist: m.dist
    };
  }

  var PHASE_NAMES = [
    [0.021, "New Moon"], [0.229, "Waxing Crescent"], [0.271, "First Quarter"],
    [0.479, "Waxing Gibbous"], [0.521, "Full Moon"], [0.729, "Waning Gibbous"],
    [0.771, "Last Quarter"], [0.979, "Waning Crescent"], [1.01, "New Moon"]
  ];
  function phaseName(p) {
    for (var i = 0; i < PHASE_NAMES.length; i++) if (p < PHASE_NAMES[i][0]) return PHASE_NAMES[i][1];
    return "New Moon";
  }

  // Traditional (Farmers' Almanac) full-moon names, by the month the full moon lands in.
  var MOON_NAMES = ["Wolf Moon", "Snow Moon", "Worm Moon", "Pink Moon", "Flower Moon",
    "Strawberry Moon", "Buck Moon", "Sturgeon Moon", "Harvest Moon", "Hunter's Moon",
    "Beaver Moon", "Cold Moon"];

  /* Next time the cycle hits `target` (0 = new, 0.5 = full) after t.
   * f() is the signed distance to the target, wrapped into [-0.5, 0.5); phase
   * climbs with time, so the answer is the first negative-to-positive crossing.
   * If we're sitting on the target right now, walk off it first so "next"
   * never returns "now". */
  function nextPhase(t, target) {
    function f(x) {
      var p = illumination(new Date(x)).phase;
      var v = (p - target + 0.5) % 1;
      if (v < 0) v += 1;
      return v - 0.5;
    }
    var step = 6 * 3600 * 1000;
    var x = t, guard = 0;
    while (f(x) >= 0 && guard++ < 200) x += step;          // step off / past the target
    var prev = f(x);
    while (guard++ < 400) {
      var nx = x + step, cur = f(nx);
      if (prev < 0 && cur >= 0) {
        var lo = x, hi = nx;
        for (var i = 0; i < 40; i++) {                      // bisect to the minute
          var mid = (lo + hi) / 2;
          if (f(mid) < 0) lo = mid; else hi = mid;
        }
        return new Date((lo + hi) / 2);
      }
      x = nx; prev = cur;
    }
    return new Date(t + SYNODIC * DAY_MS);
  }

  // ------------------------------------------------------------------ face

  /* The near side, in normalised disc coordinates (-1..1, x east, y south).
   * Positions are eyeballed from a near-side map — close enough that the
   * silhouette is recognisable, which is what sells it. */
  var MARIA = [
    { x: -0.52, y: -0.06, r: 0.46, a: 0.30 },  // Oceanus Procellarum
    { x: -0.28, y: -0.44, r: 0.30, a: 0.38 },  // Mare Imbrium
    { x: 0.06, y: -0.34, r: 0.19, a: 0.40 },   // Mare Serenitatis
    { x: 0.25, y: -0.11, r: 0.21, a: 0.40 },   // Mare Tranquillitatis
    { x: 0.62, y: -0.22, r: 0.12, a: 0.42 },   // Mare Crisium
    { x: 0.45, y: 0.12, r: 0.16, a: 0.34 },    // Mare Fecunditatis
    { x: 0.30, y: 0.30, r: 0.11, a: 0.34 },    // Mare Nectaris
    { x: -0.36, y: 0.34, r: 0.12, a: 0.32 },   // Mare Humorum
    { x: -0.16, y: 0.30, r: 0.16, a: 0.30 },   // Mare Nubium
    { x: 0.10, y: -0.06, r: 0.09, a: 0.26 }    // Mare Vaporum
  ];
  // Bright rayed craters — Tycho's ray system is the moon's loudest feature.
  var CRATERS = [
    { x: -0.08, y: 0.60, r: 0.055, rays: 0.62 },  // Tycho
    { x: -0.22, y: -0.07, r: 0.045, rays: 0.26 }, // Copernicus
    { x: -0.52, y: 0.20, r: 0.032, rays: 0.20 },  // Kepler
    { x: 0.10, y: 0.46, r: 0.030, rays: 0 },
    { x: -0.62, y: -0.30, r: 0.028, rays: 0 },
    { x: 0.44, y: -0.44, r: 0.026, rays: 0 },
    { x: 0.66, y: 0.30, r: 0.024, rays: 0 },
    { x: -0.04, y: -0.66, r: 0.030, rays: 0 }
  ];

  // deterministic noise so the moon looks the same every visit
  function mulberry(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  var faceCanvas = null, faceSize = 0;

  function buildFace(size) {
    var c = document.createElement("canvas");
    c.width = c.height = size;
    var g = c.getContext("2d");
    var R = size / 2, cx = R, cy = R;
    var rnd = mulberry(20260806);

    g.save();
    g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.clip();

    // base regolith, lit from upper-left so the disc reads spherical
    var base = g.createRadialGradient(cx - R * 0.28, cy - R * 0.30, R * 0.05, cx, cy, R * 1.05);
    base.addColorStop(0, "#efece3");
    base.addColorStop(0.55, "#d6d1c4");
    base.addColorStop(1, "#a49e91");
    g.fillStyle = base;
    g.fillRect(0, 0, size, size);

    /* Maria. Drawn as irregular closed shapes into their own layer and then
     * composited through a blur, so neighbouring seas bleed into one another
     * the way Imbrium runs into Procellarum. Filling each as a soft circle —
     * the obvious approach — gives the moon a leopard-spot look that reads as
     * clip art immediately. The outline is a radius modulated by a few sines
     * at random phases: cheap, smooth, and never a circle. */
    var ml = document.createElement("canvas");
    ml.width = ml.height = size;
    var mg = ml.getContext("2d");
    MARIA.forEach(function (m) {
      var ph = [rnd() * 6.283, rnd() * 6.283, rnd() * 6.283];
      var amp = [0.16 + rnd() * 0.12, 0.10 + rnd() * 0.08, 0.06 + rnd() * 0.06];
      var mx = cx + m.x * R, my = cy + m.y * R, mr = m.r * R;
      mg.beginPath();
      for (var i = 0; i <= 72; i++) {
        var a = (i / 72) * Math.PI * 2;
        var wob = 1 + amp[0] * Math.sin(a * 2 + ph[0]) +
                      amp[1] * Math.sin(a * 3 + ph[1]) +
                      amp[2] * Math.sin(a * 5 + ph[2]);
        var rr = mr * wob;
        var px = mx + Math.cos(a) * rr, py = my + Math.sin(a) * rr * 0.92;
        if (i === 0) mg.moveTo(px, py); else mg.lineTo(px, py);
      }
      mg.closePath();
      mg.fillStyle = "rgba(66, 70, 86, " + Math.min(0.62, m.a * 1.35) + ")";
      mg.fill();
    });
    g.save();
    if (typeof g.filter === "string") g.filter = "blur(" + Math.max(2, R * 0.035) + "px)";
    g.drawImage(ml, 0, 0);
    g.restore();

    /* Ray systems. Kept faint and irregular: evenly spaced bright spokes read
     * as a cartoon starburst, and the real rays are a diffuse smudge that only
     * resolves into streaks near full. Skipping every few angles and starting
     * them off-centre breaks the wheel. */
    CRATERS.forEach(function (k) {
      if (!k.rays) return;
      var kx = cx + k.x * R, ky = cy + k.y * R;
      var n = 30;
      for (var i = 0; i < n; i++) {
        if (rnd() < 0.34) continue;                       // gaps, not a wheel
        var a = (i / n) * Math.PI * 2 + rnd() * 0.5;
        var r0 = k.r * R * (0.9 + rnd() * 1.6);           // start clear of the bowl
        var len = k.rays * R * (0.3 + rnd() * 0.8);
        var w = k.r * R * (0.18 + rnd() * 0.4);
        var x0 = kx + Math.cos(a) * r0, y0 = ky + Math.sin(a) * r0;
        var x1 = kx + Math.cos(a) * (r0 + len), y1 = ky + Math.sin(a) * (r0 + len);
        var grd = g.createLinearGradient(x0, y0, x1, y1);
        grd.addColorStop(0, "rgba(252, 250, 244, 0.07)");
        grd.addColorStop(1, "rgba(252, 250, 244, 0)");
        g.strokeStyle = grd; g.lineWidth = w; g.lineCap = "round";
        g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
      }
    });

    // crater bowls: bright rim up-left, shadow inside down-right
    CRATERS.forEach(function (k) {
      var kx = cx + k.x * R, ky = cy + k.y * R, kr = k.r * R;
      var bowl = g.createRadialGradient(kx + kr * 0.3, ky + kr * 0.3, kr * 0.1, kx, ky, kr);
      bowl.addColorStop(0, "rgba(120, 118, 112, 0.5)");
      bowl.addColorStop(1, "rgba(180, 176, 166, 0.1)");
      g.fillStyle = bowl;
      g.beginPath(); g.arc(kx, ky, kr, 0, Math.PI * 2); g.fill();
      g.strokeStyle = "rgba(255, 252, 244, 0.5)"; g.lineWidth = Math.max(1, kr * 0.14);
      g.beginPath(); g.arc(kx, ky, kr, Math.PI * 0.9, Math.PI * 1.9); g.stroke();
    });

    // pitting — tiny craters for surface tooth
    for (var i = 0; i < 260; i++) {
      var a = rnd() * Math.PI * 2, rr = Math.sqrt(rnd()) * R * 0.97;
      var px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr;
      var pr = R * (0.004 + rnd() * 0.013);
      g.fillStyle = rnd() > 0.5 ? "rgba(255,255,255,0.10)" : "rgba(60,58,55,0.11)";
      g.beginPath(); g.arc(px, py, pr, 0, Math.PI * 2); g.fill();
    }

    // limb darkening — the disc must not look like a flat coin
    var limb = g.createRadialGradient(cx, cy, R * 0.62, cx, cy, R);
    limb.addColorStop(0, "rgba(0,0,0,0)");
    limb.addColorStop(1, "rgba(20, 18, 26, 0.55)");
    g.fillStyle = limb;
    g.fillRect(0, 0, size, size);

    g.restore();
    return c;
  }

  // ---------------------------------------------------------------- render

  var canvas = document.getElementById("moon");
  var ctx = canvas.getContext("2d");
  var cssSize = 0, dpr = 1;

  function resize() {
    var r = canvas.getBoundingClientRect();
    var s = Math.max(120, Math.round(r.width));
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    cssSize = s;
    canvas.width = Math.round(s * dpr);
    canvas.height = Math.round(s * dpr);
    var need = Math.round(s * dpr);
    if (!faceCanvas || faceSize !== need) { faceCanvas = buildFace(need); faceSize = need; }
    draw();
  }

  /* Terminator: the day/night boundary projects to a half-ellipse whose signed
   * semi-axis is a = R*(1-2k) — a = +R at new, 0 at the quarters, -R at full.
   * Sampling it into a path (rather than fighting ctx.ellipse sweep directions)
   * keeps waxing/waning and crescent/gibbous all one code path.
   *
   * Waxing is lit on the right, so the DARK cap runs from the terminator round
   * the LEFT limb; waning mirrors both. The terminator and the limb mirror
   * independently — flipping only one of them silently renders the complement
   * of the real phase, which looks plausible and is completely wrong. */
  function shadowPath(g, cx, cy, R, k, waxing) {
    var a = R * (1 - 2 * k);
    var sx = waxing ? 1 : -1;
    var N = 96, i, y, x;
    g.beginPath();
    for (i = 0; i <= N; i++) {                       // down the terminator
      y = -R + (2 * R * i) / N;
      x = a * Math.sqrt(Math.max(0, 1 - (y / R) * (y / R)));
      g.lineTo(cx + sx * x, cy + y);
    }
    for (i = N; i >= 0; i--) {                       // back up the dark limb
      y = -R + (2 * R * i) / N;
      x = Math.sqrt(Math.max(0, R * R - y * y));
      g.lineTo(cx - sx * x, cy + y);
    }
    g.closePath();
  }

  var state = { fraction: 0.5, phase: 0.25, dist: 384400 };

  function draw() {
    if (!cssSize) return;
    var W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    /* The disc is deliberately small in the canvas: the halo has to reach zero
     * BEFORE the canvas edge, or it gets clipped square and the panel shows a
     * bright rectangle around the moon. */
    var half = W / 2;
    var R = half * 0.72, cx = W / 2, cy = H / 2;
    var k = state.fraction, waxing = state.phase < 0.5;

    // moonlight halo, brighter the fuller it is
    var halo = ctx.createRadialGradient(cx, cy, R * 0.92, cx, cy, half);
    halo.addColorStop(0, "rgba(196, 212, 255, " + (0.15 + 0.20 * k) + ")");
    halo.addColorStop(0.55, "rgba(190, 206, 255, " + (0.05 + 0.08 * k) + ")");
    halo.addColorStop(1, "rgba(190, 206, 255, 0)");
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(cx, cy, half, 0, Math.PI * 2); ctx.fill();

    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.clip();

    var s = R * 2;
    ctx.drawImage(faceCanvas, cx - R, cy - R, s, s);

    // Night side: not black. Earthshine keeps the dark limb faintly readable,
    // which is exactly what you see on a real crescent.
    ctx.save();
    if (typeof ctx.filter === "string") ctx.filter = "blur(" + Math.max(1, R * 0.018) + "px)";
    shadowPath(ctx, cx, cy, R, k, waxing);
    ctx.fillStyle = "rgba(6, 8, 18, 0.93)";
    ctx.fill();
    ctx.restore();

    // faint blue cast over the whole night side
    ctx.save();
    shadowPath(ctx, cx, cy, R, k, waxing);
    ctx.clip();
    var es = ctx.createRadialGradient(cx - R * 0.2, cy - R * 0.2, 0, cx, cy, R);
    es.addColorStop(0, "rgba(74, 96, 150, 0.16)");
    es.addColorStop(1, "rgba(40, 56, 96, 0.05)");
    ctx.fillStyle = es;
    ctx.fillRect(cx - R, cy - R, s, s);
    ctx.restore();

    ctx.restore();

    // crisp rim on the lit limb only
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255, 250, 236, " + (0.10 + 0.18 * k) + ")";
    ctx.lineWidth = Math.max(1, R * 0.012);
    ctx.stroke();
    ctx.restore();
  }

  // ------------------------------------------------------------------ ui

  var phaseNameEl = document.getElementById("phaseName");
  var eyebrowEl = document.getElementById("eyebrow");
  var statLit = document.getElementById("statLit");
  var statAge = document.getElementById("statAge");
  var statDist = document.getElementById("statDist");
  var dayRange = document.getElementById("dayRange");
  var dateLabel = document.getElementById("dateLabel");
  var nextFull = document.getElementById("nextFull");
  var nextFullName = document.getElementById("nextFullName");
  var nextNew = document.getElementById("nextNew");
  var nextNewSub = document.getElementById("nextNewSub");
  var todayBtn = document.getElementById("todayBtn");
  var datePick = document.getElementById("datePick");
  var sky = document.getElementById("sky");
  var skyHint = document.getElementById("skyHint");

  var offsetDays = 0;
  var hintGone = false;

  function currentDate() { return new Date(Date.now() + offsetDays * DAY_MS); }

  function fmtDate(d) {
    return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  }
  function fmtShort(d) {
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  function fmtGap(ms) {
    if (ms < 0) ms = 0;
    var mins = Math.round(ms / 60000);
    var days = Math.floor(mins / 1440), hrs = Math.floor((mins % 1440) / 60), m = mins % 60;
    if (days > 0) return days + "d " + hrs + "h";
    if (hrs > 0) return hrs + "h " + m + "m";
    return m + "m";
  }

  function render() {
    var d = currentDate();
    var il = illumination(d);
    state = il;

    phaseNameEl.textContent = phaseName(il.phase);
    statLit.textContent = Math.round(il.fraction * 1000) / 10 + "%";
    var age = il.phase * SYNODIC;
    statAge.textContent = (Math.round(age * 10) / 10) + " days";
    statDist.textContent = Math.round(il.dist).toLocaleString() + " km";

    var isToday = Math.abs(offsetDays) < 0.02;
    eyebrowEl.textContent = isToday ? "Tonight's moon" : "The moon on";
    dateLabel.textContent = isToday ? "Tonight — " + fmtDate(d) : fmtDate(d);
    todayBtn.hidden = isToday;

    var t = d.getTime();
    var nf = nextPhase(t, 0.5), nn = nextPhase(t, 0);
    nextFull.textContent = fmtGap(nf - t);
    nextFullName.textContent = fmtShort(nf) + " · " + MOON_NAMES[nf.getMonth()];
    nextNew.textContent = fmtGap(nn - t);
    nextNewSub.textContent = fmtShort(nn);

    // keep the date picker in step without fighting the user mid-edit
    if (document.activeElement !== datePick) {
      datePick.value = d.getFullYear() + "-" +
        String(d.getMonth() + 1).padStart(2, "0") + "-" +
        String(d.getDate()).padStart(2, "0");
    }

    draw();
  }

  function setOffset(v, fromUser) {
    offsetDays = Math.max(-182, Math.min(182, v));
    if (dayRange.value !== String(offsetDays)) dayRange.value = offsetDays;
    if (fromUser && !hintGone) { hintGone = true; skyHint.classList.add("is-gone"); }
    render();
  }

  dayRange.addEventListener("input", function () { setOffset(parseFloat(dayRange.value), true); });

  todayBtn.addEventListener("click", function () {
    setOffset(0, true);
    track("moon_today");
  });

  datePick.addEventListener("change", function () {
    var parts = datePick.value.split("-");
    if (parts.length !== 3) return;
    var picked = new Date(+parts[0], +parts[1] - 1, +parts[2], 21, 0, 0);
    var diff = (picked.getTime() - Date.now()) / DAY_MS;
    setOffset(Math.max(-182, Math.min(182, diff)), true);
    track("moon_date_pick");
  });

  // drag across the sky to travel through days
  var drag = null;
  sky.addEventListener("pointerdown", function (e) {
    if (e.target.closest("input, button, a")) return;
    drag = { x: e.clientX, start: offsetDays };
    sky.setPointerCapture(e.pointerId);
  });
  sky.addEventListener("pointermove", function (e) {
    if (!drag) return;
    var perDay = Math.max(4, sky.clientWidth / 26);   // ~26 days across the panel
    setOffset(drag.start + (e.clientX - drag.x) / perDay, true);
  });
  function endDrag(e) {
    if (!drag) return;
    drag = null;
    try { sky.releasePointerCapture(e.pointerId); } catch (err) {}
    track("moon_scrub");
  }
  sky.addEventListener("pointerup", endDrag);
  sky.addEventListener("pointercancel", endDrag);

  // keyboard: arrows nudge a day, shift a week
  window.addEventListener("keydown", function (e) {
    if (e.target.matches("input, button, select, a")) return;
    var step = e.shiftKey ? 7 : 1;
    if (e.key === "ArrowRight") { e.preventDefault(); setOffset(offsetDays + step, true); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); setOffset(offsetDays - step, true); }
    else if (e.key === "Home") { e.preventDefault(); setOffset(0, true); }
  });

  var trackedOnce = {};
  function track(name) {
    if (trackedOnce[name]) return;
    trackedOnce[name] = true;
    try {
      if (typeof window.gtag === "function") window.gtag("event", name, { toy: "moon-phase" });
    } catch (e) {}
  }

  window.addEventListener("resize", resize);
  resize();
  render();

  // the countdowns are live, so tick them (cheap: once a minute)
  setInterval(function () { if (Math.abs(offsetDays) < 0.02) render(); }, 60000);

  try {
    if (typeof window.gtag === "function") window.gtag("event", "toy_start", { toy: "moon-phase" });
  } catch (e) {}
})();
