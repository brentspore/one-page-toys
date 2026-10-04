/* Sun Path: the math, with no page in it.
 *
 * Everything the page shows comes from one function, sunPosition(): where the
 * sun is (altitude and compass bearing) at an instant, for a latitude and
 * longitude. It is the NOAA solar calculator's own algorithm (Meeus, with the
 * equation of time and the nutation term), good to a fraction of an arc minute
 * for centuries either side of 2000, which is far finer than a window needs.
 *
 * Days are LOCAL calendar days in the place's own time zone, read through Intl,
 * so a daylight-saving day is 23 or 25 hours long and the sun's times still land
 * on the right clock. Loaded by the page (window.SunMath) and by the node tests.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.SunMath = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var rad = Math.PI / 180;
  var MIN = 60000, HOUR = 3600000, DAY = 86400000;

  function mod(a, n) { return ((a % n) + n) % n; }
  function clamp1(x) { return x > 1 ? 1 : x < -1 ? -1 : x; }

  // ------------------------------------------------------------ the sun

  /* Altitude (degrees above the true horizon, geometric, sun's center) and
   * azimuth (degrees clockwise from true north) at instant t (ms since epoch). */
  function sunPosition(t, lat, lon) {
    var T = (t / DAY + 2440587.5 - 2451545) / 36525;
    var L0 = mod(280.46646 + T * (36000.76983 + T * 0.0003032), 360);
    var M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
    var e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
    var Mr = M * rad;
    var C = Math.sin(Mr) * (1.914602 - T * (0.004817 + 0.000014 * T)) +
            Math.sin(2 * Mr) * (0.019993 - 0.000101 * T) +
            Math.sin(3 * Mr) * 0.000289;
    var omega = (125.04 - 1934.136 * T) * rad;
    var lambda = (L0 + C - 0.00569 - 0.00478 * Math.sin(omega)) * rad;
    var eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
    var eps = (eps0 + 0.00256 * Math.cos(omega)) * rad;
    var dec = Math.asin(Math.sin(eps) * Math.sin(lambda));

    var y = Math.tan(eps / 2); y *= y;
    var L0r = L0 * rad;
    var eot = 4 / rad * (y * Math.sin(2 * L0r) - 2 * e * Math.sin(Mr) +
              4 * e * y * Math.sin(Mr) * Math.cos(2 * L0r) -
              0.5 * y * y * Math.sin(4 * L0r) - 1.25 * e * e * Math.sin(2 * Mr));   // minutes

    var tst = mod(mod(t / MIN, 1440) + eot + 4 * lon, 1440);   // true solar time, minutes
    var H = (tst / 4 - 180) * rad;                              // hour angle
    var phi = lat * rad;
    var alt = Math.asin(clamp1(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H)));
    var az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi)) / rad + 180;
    return { alt: alt / rad, az: mod(az, 360), dec: dec / rad, eot: eot };
  }

  /* Atmospheric refraction in degrees for an apparent altitude h (Bennett,
   * scaled to the almanacs' standard 34' at the horizon). */
  function refraction(h) {
    if (h < -1) h = -1;
    return 1 / Math.tan((h + 7.31 / (h + 4.4)) * rad) / 60 * (34 / 34.478);
  }

  /* The geometric altitude at which the TOP of the sun just clears a line `deg`
   * above the horizon: half the sun's width plus the bend of the air. At 0 this
   * is -0.84, the almanac's sunrise, so open sky agrees with sunrise to the
   * minute; a roofline 20° up needs the center only 0.3° below it. */
  function clearAlt(deg) {
    return (deg || 0) - 0.2667 - refraction(deg || 0);
  }
  var RISE_ALT = -0.833;

  // ------------------------------------------------------------ time zones

  var dtfCache = {};
  function partsFmt(tz) {
    if (!dtfCache[tz]) {
      dtfCache[tz] = new Intl.DateTimeFormat("en-US", {
        timeZone: tz, hourCycle: "h23",
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit"
      });
    }
    return dtfCache[tz];
  }
  function wall(t, tz) {
    var p = {};
    partsFmt(tz).formatToParts(new Date(t)).forEach(function (x) { p[x.type] = x.value; });
    return { y: +p.year, m: +p.month - 1, d: +p.day, h: (+p.hour) % 24, mi: +p.minute, s: +p.second };
  }
  /* Offset of tz from UTC at instant t, in ms (formats the instant in the zone
   * and reads it back as if it were UTC; DST comes free from Intl). */
  function tzOffset(t, tz) {
    var w = wall(t, tz);
    return Date.UTC(w.y, w.m, w.d, w.h, w.mi, w.s) - Math.floor(t / 1000) * 1000;
  }
  function validTz(tz) {
    try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch (e) { return false; }
  }
  /* UTC instant of local midnight starting calendar day y-m-d (m 0-based). Two
   * passes settle the DST case where the first guess's offset is not the one in
   * force at midnight. */
  function midnight(y, m, d, tz) {
    var base = Date.UTC(y, m, d);
    var g = base - tzOffset(base, tz);
    for (var k = 0; k < 2; k++) {
      var g2 = base - tzOffset(g, tz);
      if (g2 === g) break;
      g = g2;
    }
    return g;
  }
  function ymdOf(t, tz) { var w = wall(t, tz); return { y: w.y, m: w.m, d: w.d }; }
  function addDays(ymd, n) {
    var u = new Date(Date.UTC(ymd.y, ymd.m, ymd.d + n));
    return { y: u.getUTCFullYear(), m: u.getUTCMonth(), d: u.getUTCDate() };
  }
  function dayBounds(ymd, tz) {
    var n = addDays(ymd, 1);
    return { t0: midnight(ymd.y, ymd.m, ymd.d, tz), t1: midnight(n.y, n.m, n.d, tz) };
  }

  // -------------------------------------------------------------- one day

  /* The sun sampled once a minute across a local day. Every answer for that day
   * (events, intervals, the drawn arc) reads from these arrays, so the picture
   * and the words can never disagree. */
  function computeDay(ymd, place) {
    var b = dayBounds(ymd, place.tz);
    var n = Math.round((b.t1 - b.t0) / MIN);
    var alt = new Float64Array(n + 1), az = new Float64Array(n + 1);
    var maxA = -91, minA = 91;
    for (var i = 0; i <= n; i++) {
      var p = sunPosition(b.t0 + i * MIN, place.lat, place.lon);
      alt[i] = p.alt; az[i] = p.az;
      if (p.alt > maxA) maxA = p.alt;
      if (p.alt < minA) minA = p.alt;
    }
    var day = { ymd: ymd, t0: b.t0, t1: b.t1, n: n, alt: alt, az: az, lat: place.lat, lon: place.lon, tz: place.tz,
                maxAlt: maxA, minAlt: minA };
    day.rise = crossing(day, RISE_ALT, 1);
    day.set = crossing(day, RISE_ALT, -1, true);
    day.alwaysUp = minA > RISE_ALT;
    day.alwaysDown = maxA <= RISE_ALT;
    day.noon = transit(day);
    day.noonAlt = day.noon != null ? sunPosition(day.noon, place.lat, place.lon).alt : null;
    day.daylight = daylightMs(day);
    return day;
  }

  /* The instant the altitude crosses `deg` going up (dir 1) or down (dir -1),
   * refined by bisection to well under a second; the first one, or the `last`.
   * Sunset is the last: near the Arctic Circle a day can open with the previous
   * evening's sunset at 00:13 and close with its own at 23:59. null when it
   * does not happen, which is a real answer in Tromsø in June, not an error. */
  function crossing(day, deg, dir, last) {
    for (var j = 0; j < day.n; j++) {
      var i = last ? day.n - 1 - j : j;
      var a = day.alt[i], b = day.alt[i + 1];
      var hit = dir > 0 ? (a < deg && b >= deg) : (a >= deg && b < deg);
      if (!hit) continue;
      var lo = day.t0 + i * MIN, hi = lo + MIN;
      for (var k = 0; k < 20; k++) {
        var mid = (lo + hi) / 2;
        var v = sunPosition(mid, day.lat, day.lon).alt;
        if (dir > 0 ? v < deg : v >= deg) lo = mid; else hi = mid;
      }
      return (lo + hi) / 2;
    }
    return null;
  }

  /* Solar noon: the instant the hour angle is zero, solved from the equation of
   * time (two passes are plenty). */
  function transit(day) {
    var t = day.t0 + DAY / 2;
    for (var k = 0; k < 3; k++) {
      var eot = sunPosition(t, day.lat, day.lon).eot;
      var target = 720 - 4 * day.lon - eot;                 // UTC minutes
      var dayStartUTC = Math.floor(t / DAY) * DAY;
      t = dayStartUTC + target * MIN;
      while (t < day.t0) t += DAY;
      while (t >= day.t1) t -= DAY;
    }
    return t >= day.t0 && t < day.t1 ? t : null;
  }

  function daylightMs(day) {
    if (day.alwaysUp) return day.t1 - day.t0;
    if (day.alwaysDown) return 0;
    var tot = 0;
    var runs = runsOf(day, function (i) { return day.alt[i] > RISE_ALT; }, function (t) {
      return sunPosition(t, day.lat, day.lon).alt > RISE_ALT;
    });
    for (var i = 0; i < runs.length; i++) tot += runs[i].b - runs[i].a;
    return tot;
  }

  // ------------------------------------------------------------ the window

  function angDiff(a, b) { return Math.abs(mod(a - b + 180, 360) - 180); }

  /* Is bearing `az` inside a view of `width` degrees centered on `center`?
   * Measured as an angular distance, so a wedge across north just works. */
  function inWedge(az, center, width) {
    if (width >= 359.999) return true;
    return angDiff(az, center) <= width / 2;
  }

  /* Contiguous runs where the per-sample test holds, each edge refined by
   * bisection with the exact test. Runs touching the day's ends start at t0 or
   * end at t1, so a window that has the midnight sun reads "until 2:10 AM". */
  function runsOf(day, sampleTest, exactTest) {
    var out = [], inRun = false, start = 0;
    function edge(i) {   // boundary between sample i and i+1
      var lo = day.t0 + i * MIN, hi = lo + MIN, want = exactTest(lo);
      for (var k = 0; k < 18; k++) {
        var mid = (lo + hi) / 2;
        if (exactTest(mid) === want) lo = mid; else hi = mid;
      }
      return (lo + hi) / 2;
    }
    for (var i = 0; i <= day.n; i++) {
      var v = sampleTest(i);
      if (v && !inRun) { inRun = true; start = i === 0 ? day.t0 : edge(i - 1); }
      else if (!v && inRun) { inRun = false; out.push({ a: start, b: edge(i - 1) }); }
    }
    if (inRun) out.push({ a: start, b: day.t1 });
    return out;
  }

  /* When the sun is on this window: inside the view wedge AND with its top edge
   * clear of whatever blocks the lower sky. aim = { center, width, obst }. */
  function sunIntervals(day, aim) {
    var thr = clearAlt(aim.obst || 0);
    var w = aim.width, c = aim.center;
    return runsOf(day, function (i) {
      return day.alt[i] > thr && inWedge(day.az[i], c, w);
    }, function (t) {
      var p = sunPosition(t, day.lat, day.lon);
      return p.alt > thr && inWedge(p.az, c, w);
    });
  }
  function totalMs(runs) {
    var s = 0;
    for (var i = 0; i < runs.length; i++) s += runs[i].b - runs[i].a;
    return s;
  }

  /* Gardeners' light classes, by hours of direct sun a day. */
  function verdict(hours) {
    if (hours >= 6) return { key: "full", label: "Full sun" };
    if (hours >= 4) return { key: "partsun", label: "Part sun" };
    if (hours >= 2) return { key: "partshade", label: "Part shade" };
    return { key: "shade", label: "Shade" };
  }

  // -------------------------------------------------------------- compass

  /* Compass heading (degrees from north, clockwise) from W3C device orientation
   * angles taken against EARTH (an absolute event). Which way the phone "points"
   * depends on how it is held: lying flat, it is the top edge; held up, it is
   * the back (the camera). Whichever of the two lies flatter wins. The screen's
   * own rotation only matters for the top edge. Returns null when the phone is
   * held so the answer is meaningless. */
  function headingFromOrientation(alpha, beta, gamma, screenAngle) {
    var a = (alpha || 0) * rad, b = (beta || 0) * rad, g = (gamma || 0) * rad;
    var cA = Math.cos(a), sA = Math.sin(a), cB = Math.cos(b), sB = Math.sin(b), cG = Math.cos(g), sG = Math.sin(g);
    // top edge (device +y) in east/north/up
    var tx = -sA * cB, ty = cA * cB;
    // back of the phone (device -z)
    var bx = -(cA * sG + sA * sB * cG), by = -(sA * sG - cA * sB * cG);
    var tl = Math.hypot(tx, ty), bl = Math.hypot(bx, by);
    if (Math.max(tl, bl) < 0.2) return null;
    if (tl >= bl) {
      return { heading: mod(Math.atan2(tx, ty) / rad + (screenAngle || 0), 360), flat: true };
    }
    return { heading: mod(Math.atan2(bx, by) / rad, 360), flat: false };
  }

  var POINTS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  var NAMES = { N: "north", NE: "northeast", E: "east", SE: "southeast", S: "south", SW: "southwest", W: "west", NW: "northwest" };
  function compassPoint(az) { return POINTS[Math.round(mod(az, 360) / 22.5) % 16]; }
  function compassName(az) { return NAMES[["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(mod(az, 360) / 45) % 8]]; }

  return {
    sunPosition: sunPosition, refraction: refraction, clearAlt: clearAlt, RISE_ALT: RISE_ALT,
    tzOffset: tzOffset, validTz: validTz, wall: wall, midnight: midnight, ymdOf: ymdOf, addDays: addDays,
    dayBounds: dayBounds, computeDay: computeDay, crossing: crossing,
    angDiff: angDiff, inWedge: inWedge, sunIntervals: sunIntervals, totalMs: totalMs, verdict: verdict,
    headingFromOrientation: headingFromOrientation, compassPoint: compassPoint, compassName: compassName,
    mod: mod, MIN: MIN, HOUR: HOUR, DAY: DAY
  };
});
