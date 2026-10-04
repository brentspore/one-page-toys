/* Sun Path — One Page Toys
 *
 * A sky dome seen from above (a polar sun chart: the horizon is the rim, the
 * point overhead is the center), the chosen day's sun drawn across it, and a
 * wedge you aim like a window. Every answer comes from SunMath.computeDay(),
 * a once-a-minute sampling of the sun across the LOCAL day, so the drawing
 * and the sentence read off the same numbers and can never disagree.
 *
 * Nothing leaves the page: no API, no geo database, no network. Location and
 * compass readings are used here and dropped (the place is kept in
 * localStorage, rounded, so the page opens where you left it).
 */
(function () {
  "use strict";

  var S = window.SunMath;
  var rad = Math.PI / 180, TAU = Math.PI * 2;
  var MIN = 60000, HOUR = 3600000, DAY = 86400000;
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var mod = S.mod;

  function $(id) { return document.getElementById(id); }
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function clamp01(x) { return clamp(x, 0, 1); }
  function ease(u) { return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2; }
  function signed(a) { return mod(a + 180, 360) - 180; }

  // ------------------------------------------------------------ storage

  function load(k, d) {
    try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; }
  }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

  var tracked = {};
  function track(name, extra) {
    if (tracked[name]) return;
    tracked[name] = true;
    try {
      if (typeof window.gtag === "function") {
        var p = { toy: "sun-path" };
        for (var k in extra || {}) p[k] = extra[k];
        window.gtag("event", name, p);
      }
    } catch (e) {}
  }

  // ------------------------------------------------------------- places

  var CITIES = [];
  (window.SUNPATH_CITIES || []).forEach(function (g) {
    g[1].forEach(function (c) { CITIES.push({ n: c[0], lat: c[1], lon: c[2], tz: c[3], g: g[0] }); });
  });
  function browserTz() {
    try { var z = Intl.DateTimeFormat().resolvedOptions().timeZone; if (z && S.validTz(z)) return z; } catch (e) {}
    return "UTC";
  }
  function cityCopy(c) { return { n: c.n, lat: c.lat, lon: c.lon, tz: c.tz, city: true }; }
  function defaultPlace() {
    var p = load("sunpath_place", null);
    if (p && isFinite(p.lat) && isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180 &&
        typeof p.tz === "string" && S.validTz(p.tz) && typeof p.n === "string") return p;
    var tz = browserTz();
    for (var i = 0; i < CITIES.length; i++) if (CITIES[i].tz === tz) return cityCopy(CITIES[i]);
    return cityCopy(CITIES[0]);
  }
  function distKm(a, b) {
    var p1 = a.lat * rad, p2 = b.lat * rad, dp = p2 - p1, dl = (b.lon - a.lon) * rad;
    var h = Math.sin(dp / 2) * Math.sin(dp / 2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
    return 12742 * Math.asin(Math.sqrt(h));
  }
  /* Best guess at the clock for typed coordinates: the nearest listed city's
   * zone when one is close, else this browser's. The picker can override it. */
  function guessTz(lat, lon) {
    var best = null, bd = Infinity;
    CITIES.forEach(function (c) { var d = distKm({ lat: lat, lon: lon }, c); if (d < bd) { bd = d; best = c; } });
    return best && bd < 450 ? best.tz : browserTz();
  }
  function coordName(lat, lon) {
    return Math.abs(lat).toFixed(2) + "°" + (lat >= 0 ? "N" : "S") + ", " + Math.abs(lon).toFixed(2) + "°" + (lon >= 0 ? "E" : "W");
  }

  // ------------------------------------------------------------- format

  var fmtCache = {};
  function fmtr(tz) {
    if (!fmtCache[tz]) fmtCache[tz] = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" });
    return fmtCache[tz];
  }
  function tParts(t, tz) {
    var o = { hm: "", ap: "" };
    // round to the nearest minute, as almanacs do (Intl alone would truncate)
    fmtr(tz).formatToParts(new Date(Math.round(t / MIN) * MIN)).forEach(function (p) {
      if (p.type === "dayPeriod") o.ap = p.value.toUpperCase();
      else if (p.type === "hour" || p.type === "minute" || (p.type === "literal" && p.value === ":")) o.hm += p.value;
    });
    return o;
  }
  function fmtT(t, tz) { var p = tParts(t, tz); return p.hm + (p.ap ? " " + p.ap : ""); }
  /* "2:10 to 6:40 PM", "11:40 AM to 3:50 PM", "midnight to 2:10 AM". */
  function fmtSpan(a, b, day) {
    var tz = day.tz;
    var sa = a <= day.t0 + 500, sb = b >= day.t1 - 500;
    if (sa && sb) return "all day";
    if (sa) return "midnight to " + fmtT(b, tz);
    if (sb) return fmtT(a, tz) + " to midnight";
    var pa = tParts(a, tz), pb = tParts(b, tz);
    if (pa.ap === pb.ap) return pa.hm + " to " + pb.hm + " " + pb.ap;
    return pa.hm + " " + pa.ap + " to " + pb.hm + " " + pb.ap;
  }
  /* Total of the spans AS SHOWN (each end rounded to the minute), so "12:01 to
   * 5:37 PM" never sits next to a total that is a minute short. */
  function shownMs(runs) {
    var t = 0;
    runs.forEach(function (r) { t += (Math.round(r.b / MIN) - Math.round(r.a / MIN)) * MIN; });
    return t;
  }
  function fmtDur(ms) {
    var mins = Math.round(ms / MIN);
    var h = Math.floor(mins / 60), m = mins % 60;
    if (h && m) return h + " h " + m + " min";
    if (h) return h + " h";
    return m + " min";
  }
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  function fmtDate(ymd) { return WD[new Date(Date.UTC(ymd.y, ymd.m, ymd.d)).getUTCDay()] + ", " + MON[ymd.m] + " " + ymd.d; }
  function fmtDateShort(ymd) { return MON[ymd.m] + " " + ymd.d; }
  function sameYmd(a, b) { return a && b && a.y === b.y && a.m === b.m && a.d === b.d; }
  function doyOf(ymd) { return Math.round((Date.UTC(ymd.y, ymd.m, ymd.d) - Date.UTC(ymd.y, 0, 1)) / DAY); }
  function ymdFromDoy(y, n) { var u = new Date(Date.UTC(y, 0, 1 + n)); return { y: u.getUTCFullYear(), m: u.getUTCMonth(), d: u.getUTCDate() }; }
  function yearLen(y) { return (Date.UTC(y + 1, 0, 1) - Date.UTC(y, 0, 1)) / DAY; }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  // ------------------------------------------------------------- state

  var savedAim = load("sunpath_aim", null);
  var st = {
    place: defaultPlace(),
    ymd: null, tMin: 0, live: true,
    mode: "window",
    aim: { center: 225, width: 120, obst: 10 },
    gardenView: 180,
    rot: 0, compassOn: false
  };
  if (savedAim && typeof savedAim === "object") {
    if (["window", "balcony", "garden"].indexOf(savedAim.mode) >= 0) st.mode = savedAim.mode;
    if (isFinite(savedAim.center)) st.aim.center = mod(+savedAim.center, 360);
    if (isFinite(savedAim.width)) st.aim.width = clamp(+savedAim.width, 20, 300);
    if (isFinite(savedAim.obst)) st.aim.obst = clamp(+savedAim.obst, 0, 60);
  }
  var MAXW = { window: 180, balcony: 300 };
  function maxWidth() { return MAXW[st.mode] || 360; }
  function aimNow() {
    return { center: st.aim.center, width: st.mode === "garden" ? 360 : Math.min(st.aim.width, maxWidth()), obst: st.aim.obst };
  }
  function saveAim() { save("sunpath_aim", { mode: st.mode, center: Math.round(st.aim.center), width: Math.round(st.aim.width), obst: st.aim.obst }); }

  var D = { day: null, jun: null, dec: null, equ: null, year: null, yearKey: "", runs: [], junRuns: [], decRuns: [], yearHours: [] };

  function todayYmd() { return S.ymdOf(Date.now(), st.place.tz); }
  function nowMin(day) { return clamp((Date.now() - day.t0) / MIN, 0, day.n); }

  function placeKey() { return st.place.lat + "," + st.place.lon + "," + st.place.tz; }

  /* Days that depend only on the place and the date. */
  function computeDays() {
    var p = st.place, y = st.ymd.y;
    D.day = S.computeDay(st.ymd, p);
    var key = placeKey() + "|" + y;
    if (D.yearKey !== key) {
      D.yearKey = key;
      D.jun = S.computeDay({ y: y, m: 5, d: 21 }, p);
      D.dec = S.computeDay({ y: y, m: 11, d: 21 }, p);
      D.equ = S.computeDay({ y: y, m: 2, d: 20 }, p);
      D.year = [];
      for (var m = 0; m < 12; m++) D.year.push(m === 5 ? D.jun : m === 11 ? D.dec : S.computeDay({ y: y, m: m, d: 21 }, p));
      paintYearTrack();
    }
    st.tMin = clamp(st.tMin, 0, D.day.n);
  }
  /* Windows of sun, which depend on the aim too. Cheap: a scan of each day's
   * samples plus a bisection at every edge. */
  function computeRuns() {
    var a = aimNow();
    D.runs = S.sunIntervals(D.day, a);
    D.junRuns = S.sunIntervals(D.jun, a);
    D.decRuns = S.sunIntervals(D.dec, a);
    D.yearHours = D.year.map(function (d) { return S.totalMs(S.sunIntervals(d, a)) / HOUR; });
  }

  function sunNow() { return S.sunPosition(D.day.t0 + st.tMin * MIN, st.place.lat, st.place.lon); }

  // ------------------------------------------------------------- colors

  /* Horizon color by sun altitude, the same stops as Golden Hour so the two
   * tools agree about what the sky looks like. */
  var HOR = [
    [-90, [4, 6, 14]], [-18, [7, 11, 26]], [-12, [14, 23, 52]],
    [-8, [26, 45, 96]], [-6, [40, 68, 132]], [-4, [86, 96, 152]],
    [-2, [176, 116, 132]], [-0.833, [232, 130, 90]], [1, [243, 158, 74]],
    [4, [246, 186, 96]], [6, [247, 209, 142]], [10, [206, 219, 214]],
    [18, [154, 197, 235]], [35, [106, 172, 235]], [60, [74, 146, 228]], [90, [62, 132, 220]]
  ];
  /* The point overhead runs deeper than the horizon. */
  var ZEN = [
    [-90, [3, 5, 12]], [-18, [5, 8, 20]], [-10, [10, 15, 38]], [-4, [22, 32, 78]],
    [0, [40, 56, 116]], [6, [50, 84, 158]], [15, [44, 104, 192]], [40, [34, 106, 204]], [90, [28, 98, 200]]
  ];
  function stop(stops, alt) {
    if (alt <= stops[0][0]) return stops[0][1];
    for (var i = 1; i < stops.length; i++) {
      if (alt <= stops[i][0]) {
        var a = stops[i - 1], b = stops[i], u = (alt - a[0]) / (b[0] - a[0]);
        return mix(a[1], b[1], u);
      }
    }
    return stops[stops.length - 1][1];
  }
  function mix(a, b, u) { return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u]; }
  function rgb(c) { return "rgb(" + (c[0] | 0) + "," + (c[1] | 0) + "," + (c[2] | 0) + ")"; }
  function rgba(c, a) { return "rgba(" + (c[0] | 0) + "," + (c[1] | 0) + "," + (c[2] | 0) + "," + a + ")"; }
  var NIGHT = [6, 8, 16];
  var GOLD = [255, 190, 82], WARM = [255, 214, 140], JUN = [255, 205, 110], DEC = [150, 196, 255];

  // a fixed sky of stars, so the night never flickers between draws
  var STARS = (function () {
    var out = [], s = 1234567;
    function r() { s = (s * 16807) % 2147483647; return s / 2147483647; }
    for (var i = 0; i < 110; i++) out.push({ az: r() * 360, alt: Math.asin(r()) / rad * 0.95 + 2, m: 0.35 + r() * 0.65 });
    return out;
  })();

  // -------------------------------------------------------------- dome

  var dome = $("dome"), dctx = dome.getContext("2d");
  var strip = $("strip"), sctx = strip.getContext("2d");
  var panel = $("panel");
  var DPR = 1, G = null, SW = 0, SH = 0;
  var cache = { pts: null, sun: null, hc: null, he1: null, he2: null };

  function geom(size, ox, oy, rot) {
    var u = size / 360;
    var lab = Math.max(17, 21 * u);
    var R = (size / 2 - lab) / 1.12;
    return { size: size, cx: ox + size / 2, cy: oy + size / 2, R: R, M: R * 0.12, u: u, rot: rot || 0 };
  }
  function proj(g, az, alt) {
    var r = alt >= 0 ? g.R * (90 - alt) / 90 : g.R + g.M * Math.min(1, -alt / 18);
    var th = (az - g.rot) * rad;
    return { x: g.cx + r * Math.sin(th), y: g.cy - r * Math.cos(th), r: r };
  }
  function unproj(g, x, y) {
    var dx = x - g.cx, dy = y - g.cy, r = Math.hypot(dx, dy);
    return { az: mod(Math.atan2(dx, -dy) / rad + g.rot, 360), r: r, alt: r <= g.R ? 90 - r / g.R * 90 : -18 * Math.min(1, (r - g.R) / g.M) };
  }
  function cang(g, az) { return (az - g.rot - 90) * rad; }   // canvas arc angle for a bearing

  function sizeCanvases() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    var w = dome.getBoundingClientRect().width || 320;
    dome.width = Math.round(w * DPR); dome.height = Math.round(w * DPR);
    var sr = strip.getBoundingClientRect();
    SW = sr.width || w; SH = sr.height || 108;
    strip.width = Math.round(SW * DPR); strip.height = Math.round(SH * DPR);
  }

  /* Path through a day's samples where keep(i) holds, broken where it does
   * not. Returns nothing; the caller strokes. */
  function tracePath(ctx, g, day, keep) {
    var on = false;
    ctx.beginPath();
    for (var i = 0; i <= day.n; i++) {
      if (!keep(i)) { on = false; continue; }
      var p = proj(g, day.az[i], day.alt[i]);
      if (!on) { ctx.moveTo(p.x, p.y); on = true; } else ctx.lineTo(p.x, p.y);
    }
  }
  function traceRun(ctx, g, day, run) {
    var a = S.sunPosition(run.a, day.lat, day.lon), b = S.sunPosition(run.b, day.lat, day.lon);
    var p = proj(g, a.az, a.alt);
    ctx.moveTo(p.x, p.y);
    var i0 = Math.ceil((run.a - day.t0) / MIN), i1 = Math.floor((run.b - day.t0) / MIN);
    for (var i = i0; i <= i1; i++) { p = proj(g, day.az[i], day.alt[i]); ctx.lineTo(p.x, p.y); }
    p = proj(g, b.az, b.alt); ctx.lineTo(p.x, p.y);
  }

  function drawDome(ctx, g, F) {
    var cx = g.cx, cy = g.cy, R = g.R, M = g.M, u = g.u;
    var sun = F.sun, sa = sun.alt;
    var hor = stop(HOR, sa), zen = stop(ZEN, sa);
    var a = F.aim, garden = F.mode === "garden";
    var a1 = a.center - a.width / 2, a2 = a.center + a.width / 2;

    // below the horizon: a dark ring, where the night half of the sun's day runs
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, R + M, 0, TAU); ctx.arc(cx, cy, R, 0, TAU, true);
    var rg = ctx.createRadialGradient(cx, cy, R, cx, cy, R + M);
    rg.addColorStop(0, rgba(mix(hor, NIGHT, 0.6), 0.96));
    rg.addColorStop(1, rgba(NIGHT, 0.9));
    ctx.fillStyle = rg; ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.10)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, R + M, 0, TAU); ctx.stroke();
    ctx.restore();

    // the sky itself
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.clip();
    var sg = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
    sg.addColorStop(0, rgb(zen)); sg.addColorStop(0.62, rgb(mix(zen, hor, 0.5))); sg.addColorStop(1, rgb(hor));
    ctx.fillStyle = sg; ctx.fillRect(cx - R, cy - R, 2 * R, 2 * R);
    var starA = clamp01((-sa - 3) / 9);
    if (starA > 0) {
      for (var k = 0; k < STARS.length; k++) {
        var s = STARS[k], sp = proj(g, s.az, s.alt);
        ctx.fillStyle = "rgba(255,255,255," + (starA * s.m * 0.8).toFixed(3) + ")";
        ctx.beginPath(); ctx.arc(sp.x, sp.y, (0.6 + s.m * 0.9) * u, 0, TAU); ctx.fill();
      }
    }
    if (sa > -9) {
      var gp = proj(g, sun.az, Math.max(sa, -3));
      var glowA = clamp01((sa + 9) / 11);
      var warm = mix([255, 170, 90], [255, 248, 228], clamp01(sa / 35));
      var gg = ctx.createRadialGradient(gp.x, gp.y, 0, gp.x, gp.y, R * 1.15);
      gg.addColorStop(0, rgba(warm, (0.62 * glowA).toFixed(3)));
      gg.addColorStop(0.3, rgba(warm, (0.2 * glowA).toFixed(3)));
      gg.addColorStop(1, rgba(warm, 0));
      ctx.fillStyle = gg; ctx.fillRect(cx - R, cy - R, 2 * R, 2 * R);
    }
    // the wall: everything outside the window's view is a little darker
    if (!garden) {
      ctx.beginPath(); ctx.arc(cx, cy, R + 1, 0, TAU);
      ctx.moveTo(cx, cy); ctx.arc(cx, cy, R + 1, cang(g, a1), cang(g, a2)); ctx.closePath();
      ctx.fillStyle = "rgba(4,6,14,0.30)"; ctx.fill("evenodd");
    }
    // whatever blocks the low sky, as a hatched band from the horizon up
    if (a.obst > 0) {
      var ro = R * (90 - a.obst) / 90;
      ctx.save();
      ctx.beginPath();
      if (garden) { ctx.arc(cx, cy, R + 1, 0, TAU); ctx.arc(cx, cy, ro, 0, TAU, true); }
      else { ctx.arc(cx, cy, R + 1, cang(g, a1), cang(g, a2)); ctx.arc(cx, cy, ro, cang(g, a2), cang(g, a1), true); ctx.closePath(); }
      ctx.fillStyle = "rgba(12,15,28,0.46)"; ctx.fill();
      ctx.clip();
      ctx.strokeStyle = "rgba(255,255,255,0.10)"; ctx.lineWidth = 1;
      for (var hx = -R * 2; hx < R * 2; hx += 7 * u) { ctx.beginPath(); ctx.moveTo(cx + hx, cy - R); ctx.lineTo(cx + hx + 2 * R, cy + R); ctx.stroke(); }
      ctx.restore();
      ctx.strokeStyle = "rgba(255,255,255,0.32)"; ctx.lineWidth = 1;
      ctx.beginPath();
      if (garden) ctx.arc(cx, cy, ro, 0, TAU); else ctx.arc(cx, cy, ro, cang(g, a1), cang(g, a2));
      ctx.stroke();
    }
    ctx.restore();

    // altitude rings and bearing spokes
    ctx.save();
    ctx.lineWidth = 1;
    for (var alt = 15; alt < 90; alt += 15) {
      ctx.strokeStyle = alt % 30 === 0 ? "rgba(255,255,255,0.20)" : "rgba(255,255,255,0.09)";
      ctx.beginPath(); ctx.arc(cx, cy, R * (90 - alt) / 90, 0, TAU); ctx.stroke();
    }
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    for (var b = 0; b < 360; b += 30) {
      var e = proj(g, b, 0), i5 = proj(g, b, 75);
      ctx.beginPath(); ctx.moveTo(i5.x, i5.y); ctx.lineTo(e.x, e.y); ctx.stroke();
    }
    for (b = 0; b < 360; b += 5) {
      var len = b % 30 === 0 ? 0.55 : b % 10 === 0 ? 0.32 : 0.18;
      var t0 = (b - g.rot) * rad, sn = Math.sin(t0), cs = Math.cos(t0);
      ctx.strokeStyle = b % 30 === 0 ? "rgba(255,255,255,0.55)" : "rgba(255,255,255,0.28)";
      ctx.beginPath(); ctx.moveTo(cx + R * sn, cy - R * cs); ctx.lineTo(cx + (R + M * len) * sn, cy - (R + M * len) * cs); ctx.stroke();
    }
    ctx.strokeStyle = "rgba(255,255,255,0.62)"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.stroke();
    // ring labels, on the side of the sky the sun seldom crosses
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.font = "600 " + (9 * u + 1).toFixed(1) + "px Inter, system-ui, sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    var labAz = F.lat >= 0 ? 338 : 158;
    [30, 60].forEach(function (al) { var q = proj(g, labAz, al); ctx.fillText(al + "°", q.x, q.y); });
    ctx.restore();

    // the window's wedge of sky
    if (!garden) {
      ctx.save();
      var flash = F.flash || 0;
      var wg = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
      wg.addColorStop(0, rgba(GOLD, (0.05 + 0.1 * flash).toFixed(3)));
      wg.addColorStop(1, rgba(GOLD, (0.2 + 0.25 * flash).toFixed(3)));
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, R, cang(g, a1), cang(g, a2)); ctx.closePath();
      ctx.fillStyle = wg; ctx.fill();
      ctx.strokeStyle = rgba(WARM, 0.85); ctx.lineWidth = 1.5 * Math.max(1, u);
      var e1 = proj(g, a1, 0), e2 = proj(g, a2, 0);
      ctx.beginPath(); ctx.moveTo(e1.x, e1.y); ctx.lineTo(cx, cy); ctx.lineTo(e2.x, e2.y); ctx.stroke();
      ctx.lineWidth = 2.4 * Math.max(1, u); ctx.strokeStyle = "rgba(255,238,206,0.75)";
      ctx.beginPath(); ctx.arc(cx, cy, R, cang(g, a1), cang(g, a2)); ctx.stroke();
      ctx.restore();
    }

    // reference days: June solstice, the equinox, December solstice
    ctx.save();
    ctx.lineCap = "round";
    function ref(day, col, dash, w, al) {
      ctx.setLineDash(dash.map(function (x) { return x * u; }));
      ctx.strokeStyle = rgba(col, al); ctx.lineWidth = w * Math.max(1, u);
      tracePath(ctx, g, day, function (i) { return day.alt[i] >= 0; });
      ctx.stroke();
    }
    ref(F.dec, DEC, [5, 5], 1.6, 0.85);
    ref(F.equ, [255, 255, 255], [1.5, 4.5], 1.6, 0.6);
    ref(F.jun, JUN, [5, 5], 1.6, 0.9);
    ctx.setLineDash([]);
    ctx.restore();

    // the chosen day
    var day = F.day;
    ctx.save();
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.setLineDash([1.2 * u, 4 * u]);
    ctx.strokeStyle = "rgba(255,255,255,0.38)"; ctx.lineWidth = 1.6 * Math.max(1, u);
    tracePath(ctx, g, day, function (i) { return day.alt[i] < 0.5 && day.alt[i] > -18; });
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = "rgba(10,14,30,0.35)"; ctx.lineWidth = 5 * Math.max(1, u);
    tracePath(ctx, g, day, function (i) { return day.alt[i] >= 0; });
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,0.92)"; ctx.lineWidth = 2.2 * Math.max(1, u);
    ctx.stroke();
    // when the sun is on the window: the same path, thick and gold
    if (F.runs.length) {
      ctx.shadowColor = "rgba(255,180,60,0.85)"; ctx.shadowBlur = 12 * u;
      ctx.strokeStyle = rgba([255, 196, 84], 1); ctx.lineWidth = 6 * Math.max(1, u);
      ctx.beginPath();
      F.runs.forEach(function (r) { traceRun(ctx, g, day, r); });
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = "rgba(255,246,214,0.95)"; ctx.lineWidth = 1.6 * Math.max(1, u);
      ctx.stroke();
    }
    ctx.restore();

    // hours along the chosen day
    var marks = [];
    for (var h = 0; day.t0 + h * HOUR < day.t1; h++) {
      var tt = day.t0 + h * HOUR, idx = Math.round((tt - day.t0) / MIN);
      if (day.alt[idx] < 1) continue;
      marks.push({ i: idx, p: proj(g, day.az[idx], day.alt[idx]), hr: S.wall(tt, day.tz).h });
    }
    var minGap = Infinity;
    for (k = 1; k < marks.length; k++) minGap = Math.min(minGap, Math.hypot(marks[k].p.x - marks[k - 1].p.x, marks[k].p.y - marks[k - 1].p.y));
    var stepH = minGap >= 24 * u ? 1 : minGap >= 12 * u ? 2 : 3;
    ctx.save();
    ctx.font = "700 " + (9.5 * u + 0.8).toFixed(1) + "px Inter, system-ui, sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    var labeled = marks.filter(function (m) { return m.hr % stepH === 0; });
    marks.forEach(function (m) {
      ctx.fillStyle = "rgba(255,255,255,0.95)";
      ctx.beginPath(); ctx.arc(m.p.x, m.p.y, 2.6 * Math.max(1, u), 0, TAU); ctx.fill();
      if (m.hr % stepH !== 0) return;
      var j = labeled.indexOf(m);
      var dx = m.p.x - cx, dy = m.p.y - cy, dl = Math.hypot(dx, dy) || 1;
      var off = 12 * u + 3;
      var lx = m.p.x + dx / dl * off, ly = m.p.y + dy / dl * off;
      var h12 = m.hr % 12 === 0 ? 12 : m.hr % 12;
      var txt = m.hr === 12 ? "noon" : String(h12);
      if ((j === 0 || j === labeled.length - 1) && m.hr !== 12) txt = h12 + (m.hr < 12 ? " AM" : " PM");
      ctx.lineWidth = 3; ctx.strokeStyle = "rgba(8,10,22,0.55)";
      ctx.strokeText(txt, lx, ly);
      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.fillText(txt, lx, ly);
    });
    ctx.restore();

    // the observer at the center: a wall with a window, or a bed of soil
    ctx.save();
    ctx.translate(cx, cy);
    if (garden) {
      ctx.rotate(-g.rot * rad);
      var bw = 26 * u, bh = 16 * u;
      ctx.fillStyle = "#5b8f43"; ctx.strokeStyle = "rgba(255,255,255,0.75)"; ctx.lineWidth = 1.2;
      roundRect(ctx, -bw / 2, -bh / 2, bw, bh, 3 * u); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = "rgba(220,255,190,0.55)";
      for (var rr = -1; rr <= 1; rr++) { ctx.beginPath(); ctx.moveTo(-bw / 2 + 4 * u, rr * 4.5 * u); ctx.lineTo(bw / 2 - 4 * u, rr * 4.5 * u); ctx.stroke(); }
    } else {
      // plan view of a wall with a window in it, glass toward the sky it faces
      ctx.rotate((a.center - g.rot) * rad);
      var ww = 34 * u, wt = 5 * u;
      ctx.shadowColor = "rgba(0,0,0,0.35)"; ctx.shadowBlur = 6 * u;
      ctx.fillStyle = "rgba(248,240,226,0.97)";
      ctx.fillRect(-ww / 2, 0, ww, wt);
      ctx.shadowBlur = 0;
      ctx.fillStyle = "rgba(150,205,255,0.95)";
      ctx.fillRect(-ww * 0.26, wt * 0.3, ww * 0.52, wt * 0.4);
      if (F.mode === "balcony") {
        ctx.strokeStyle = "rgba(248,240,226,0.9)"; ctx.lineWidth = 1.6 * Math.max(1, u);
        ctx.beginPath(); ctx.moveTo(-ww * 0.32, 0); ctx.lineTo(-ww * 0.32, -10 * u); ctx.lineTo(ww * 0.32, -10 * u); ctx.lineTo(ww * 0.32, 0); ctx.stroke();
      }
      ctx.fillStyle = "#ffc457";
      var ay = F.mode === "balcony" ? -13 * u : -4 * u;
      ctx.beginPath(); ctx.moveTo(0, ay - 9 * u); ctx.lineTo(5 * u, ay - 2 * u); ctx.lineTo(-5 * u, ay - 2 * u); ctx.closePath(); ctx.fill();
    }
    ctx.restore();

    // the sun
    var spn = proj(g, sun.az, sa);
    ctx.save();
    if (sa > -0.9) {
      var halo = ctx.createRadialGradient(spn.x, spn.y, 0, spn.x, spn.y, 30 * u);
      halo.addColorStop(0, "rgba(255,246,214,0.95)");
      halo.addColorStop(0.35, "rgba(255,206,110,0.45)");
      halo.addColorStop(1, "rgba(255,170,60,0)");
      ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(spn.x, spn.y, 30 * u, 0, TAU); ctx.fill();
      var tw = F.time || 0;
      ctx.strokeStyle = "rgba(255,226,150,0.85)"; ctx.lineWidth = 1.6 * Math.max(1, u); ctx.lineCap = "round";
      for (var ry = 0; ry < 12; ry++) {
        var ang = ry / 12 * TAU + tw * 0.00012;
        var r1 = 12.5 * u, r2 = (ry % 2 ? 16 : 19) * u + Math.sin(tw * 0.0016 + ry) * 0.8 * u;
        ctx.beginPath(); ctx.moveTo(spn.x + Math.cos(ang) * r1, spn.y + Math.sin(ang) * r1);
        ctx.lineTo(spn.x + Math.cos(ang) * r2, spn.y + Math.sin(ang) * r2); ctx.stroke();
      }
      ctx.fillStyle = "#fff4d6"; ctx.strokeStyle = "#ffbf52"; ctx.lineWidth = 2.2 * Math.max(1, u);
      ctx.beginPath(); ctx.arc(spn.x, spn.y, 9 * u, 0, TAU); ctx.fill(); ctx.stroke();
    } else {
      ctx.fillStyle = "rgba(255,170,96,0.55)"; ctx.strokeStyle = "rgba(255,210,160,0.8)"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(spn.x, spn.y, 7 * u, 0, TAU); ctx.fill(); ctx.stroke();
    }
    if (F.invite) {
      ctx.strokeStyle = "rgba(255,255,255," + (0.35 + 0.25 * Math.sin((F.time || 0) * 0.004)).toFixed(3) + ")";
      ctx.lineWidth = 1.2; ctx.setLineDash([3 * u, 3 * u]);
      ctx.beginPath(); ctx.arc(spn.x, spn.y, 24 * u, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();

    // handles on the horizon: aim from the middle one, widen from the edges
    var out = { sun: spn, hc: null, he1: null, he2: null };
    if (!garden) {
      ctx.save();
      var hc = proj(g, a.center, 0), h1 = proj(g, a1, 0), h2 = proj(g, a2, 0);
      [h1, h2].forEach(function (p) {
        ctx.fillStyle = "#fff8e8"; ctx.strokeStyle = rgba([150, 90, 20], 0.9); ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(p.x, p.y, 7.5 * u, 0, TAU); ctx.fill(); ctx.stroke();
      });
      ctx.shadowColor = "rgba(0,0,0,0.35)"; ctx.shadowBlur = 8 * u;
      ctx.fillStyle = "#ffc457"; ctx.strokeStyle = "#5a3606"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(hc.x, hc.y, 14 * u, 0, TAU); ctx.fill();
      ctx.shadowBlur = 0; ctx.stroke();
      ctx.fillStyle = "#3a2205";
      ctx.font = "800 " + (9.5 * u + 0.5).toFixed(1) + "px Inter, system-ui, sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(S.compassPoint(a.center), hc.x, hc.y + 0.5);
      ctx.restore();
      out.hc = hc; out.he1 = h1; out.he2 = h2;
    }

    // compass letters outside the rim
    ctx.save();
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    var lr = R + M + Math.max(9, 11 * u);
    ["N", "E", "S", "W"].forEach(function (l, j) {
      var th = (j * 90 - g.rot) * rad;
      ctx.font = "800 " + (12 * u + 1).toFixed(1) + "px Inter, system-ui, sans-serif";
      ctx.fillStyle = l === "N" ? "#ffb35c" : "rgba(255,255,255,0.9)";
      ctx.fillText(l, cx + lr * Math.sin(th), cy - lr * Math.cos(th));
    });
    ctx.font = "700 " + (7.5 * u + 1).toFixed(1) + "px Inter, system-ui, sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ["NE", "SE", "SW", "NW"].forEach(function (l, j) {
      var th = (45 + j * 90 - g.rot) * rad;
      ctx.fillText(l, cx + lr * Math.sin(th), cy - lr * Math.cos(th));
    });
    ctx.restore();
    return out;
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
  }

  // ------------------------------------------------------------- strip

  /* The horizon unrolled, centered on where the window looks: what you'd see
   * standing in it, with the wall either side and the roofline across the way. */
  function stripCenter() { return st.mode === "garden" ? st.gardenView : st.aim.center; }
  function stripGeom(W, H) {
    var c = stripCenter();
    var hy = Math.round(H * 0.76), top = 8;
    return {
      W: W, H: H, hy: hy, c: c,
      x: function (az) { return W / 2 + signed(az - c) / 180 * (W / 2); },
      y: function (alt) { return hy - Math.max(-6, alt) / 90 * (hy - top); }
    };
  }
  function drawStrip(ctx, W, H, F) {
    var sg = stripGeom(W, H), sa = F.sun.alt;
    var hor = stop(HOR, sa), zen = stop(ZEN, sa);
    ctx.clearRect(0, 0, W, H);
    var g1 = ctx.createLinearGradient(0, 0, 0, sg.hy);
    g1.addColorStop(0, rgb(zen)); g1.addColorStop(1, rgb(hor));
    ctx.fillStyle = g1; ctx.fillRect(0, 0, W, sg.hy);
    var sx = sg.x(F.sun.az), sy = sg.y(sa);
    if (sa > -9) {
      var warm = mix([255, 170, 90], [255, 248, 228], clamp01(sa / 35)), ga = clamp01((sa + 9) / 11);
      var gg = ctx.createRadialGradient(sx, Math.min(sy, sg.hy), 0, sx, Math.min(sy, sg.hy), W * 0.42);
      gg.addColorStop(0, rgba(warm, (0.6 * ga).toFixed(3))); gg.addColorStop(1, rgba(warm, 0));
      ctx.fillStyle = gg; ctx.fillRect(0, 0, W, sg.hy);
    }
    var starA = clamp01((-sa - 3) / 9);
    if (starA > 0) {
      STARS.forEach(function (s) {
        if (s.alt > 70) return;
        ctx.fillStyle = "rgba(255,255,255," + (starA * s.m * 0.7).toFixed(3) + ")";
        ctx.fillRect(sg.x(s.az), sg.y(s.alt), 1.2, 1.2);
      });
    }
    // ground
    var g2 = ctx.createLinearGradient(0, sg.hy, 0, H);
    g2.addColorStop(0, rgb(mix(hor, NIGHT, 0.72))); g2.addColorStop(1, rgb(NIGHT));
    ctx.fillStyle = g2; ctx.fillRect(0, sg.hy, W, H - sg.hy);

    // the roofline across the way, flat at the height you set
    if (F.aim.obst > 0) {
      var oy = sg.y(F.aim.obst);
      ctx.fillStyle = rgba(mix(hor, NIGHT, 0.82), 0.97);
      ctx.fillRect(0, oy, W, sg.hy - oy + 1);
      var s0 = 99, x = -((sg.c * 3) % 40);
      function rr() { s0 = (s0 * 16807) % 2147483647; return s0 / 2147483647; }
      ctx.strokeStyle = "rgba(255,255,255,0.08)"; ctx.lineWidth = 1;
      var lit = clamp01((-sa + 2) / 8);
      while (x < W) {
        var bw = 18 + rr() * 34;
        ctx.beginPath(); ctx.moveTo(x + 0.5, oy); ctx.lineTo(x + 0.5, sg.hy); ctx.stroke();
        if (rr() < 0.5) { ctx.fillStyle = "rgba(255,255,255,0.14)"; ctx.fillRect(x + bw * 0.3, oy - 3, 1, 3); }
        if (lit > 0) {
          for (var wy = oy + 4; wy < sg.hy - 3; wy += 6) for (var wx = x + 4; wx < x + bw - 4; wx += 6) {
            if (rr() < 0.32) { ctx.fillStyle = "rgba(255,206,130," + (0.75 * lit).toFixed(2) + ")"; ctx.fillRect(wx, wy, 2, 2.5); }
          }
        }
        x += bw;
      }
      ctx.fillStyle = "rgba(255,255,255,0.22)"; ctx.fillRect(0, oy, W, 1);
    }
    // horizon
    ctx.fillStyle = "rgba(255,255,255,0.35)"; ctx.fillRect(0, sg.hy, W, 1);

    // the sun's paths
    function path(day, keep) {
      ctx.beginPath();
      var on = false, lx = 0;
      for (var i = 0; i <= day.n; i += 2) {
        if (!keep(i)) { on = false; continue; }
        var px = sg.x(day.az[i]), py = sg.y(day.alt[i]);
        if (on && Math.abs(px - lx) > W / 2) on = false;
        if (!on) { ctx.moveTo(px, py); on = true; } else ctx.lineTo(px, py);
        lx = px;
      }
    }
    ctx.save();
    ctx.lineCap = "round";
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = rgba(DEC, 0.8); path(F.dec, function (i) { return F.dec.alt[i] > -1; }); ctx.stroke();
    ctx.strokeStyle = rgba(JUN, 0.85); path(F.jun, function (i) { return F.jun.alt[i] > -1; }); ctx.stroke();
    ctx.setLineDash([]);
    var day = F.day;
    ctx.strokeStyle = "rgba(255,255,255,0.9)"; ctx.lineWidth = 2;
    path(day, function (i) { return day.alt[i] > -1; }); ctx.stroke();
    if (F.runs.length) {
      ctx.strokeStyle = "rgb(255,196,84)"; ctx.lineWidth = 4.5;
      ctx.shadowColor = "rgba(255,180,60,0.8)"; ctx.shadowBlur = 8;
      F.runs.forEach(function (r) {
        var i0 = Math.max(0, Math.ceil((r.a - day.t0) / MIN)), i1 = Math.min(day.n, Math.floor((r.b - day.t0) / MIN));
        ctx.beginPath();
        var on = false, lx = 0;
        for (var i = i0; i <= i1; i++) {
          var px = sg.x(day.az[i]), py = sg.y(day.alt[i]);
          if (on && Math.abs(px - lx) > W / 2) on = false;
          if (!on) { ctx.moveTo(px, py); on = true; } else ctx.lineTo(px, py);
          lx = px;
        }
        ctx.stroke();
      });
      ctx.shadowBlur = 0;
    }
    ctx.restore();

    // the sun
    if (sa > -6) {
      ctx.fillStyle = sa > -0.9 ? "#fff4d6" : "rgba(255,170,96,0.6)";
      ctx.strokeStyle = "#ffbf52"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(sx, sy, 6.5, 0, TAU); ctx.fill(); ctx.stroke();
    }

    // the wall around the window, and its frame
    if (F.mode !== "garden") {
      var w2 = Math.min(F.aim.width, 359) / 2;
      var xl = sg.x(sg.c - w2), xr = sg.x(sg.c + w2);
      ctx.fillStyle = "rgba(14,11,9,0.78)";
      ctx.fillRect(0, 0, xl, H); ctx.fillRect(xr, 0, W - xr, H);
      var fw = F.mode === "balcony" ? 3 : 5;
      ctx.fillStyle = "rgba(244,236,222,0.92)";
      ctx.fillRect(xl - fw, 0, fw, H); ctx.fillRect(xr, 0, fw, H);
      if (F.mode === "balcony") {
        ctx.fillStyle = "rgba(244,236,222,0.55)";
        ctx.fillRect(xl, sg.hy + 4, xr - xl, 2);
        for (var bx = xl + 6; bx < xr; bx += 9) ctx.fillRect(bx, sg.hy + 4, 1.2, Math.max(0, H - sg.hy - 20));
      } else {
        ctx.fillStyle = "rgba(244,236,222,0.8)";
        ctx.fillRect(xl - fw, sg.hy + 6, xr - xl + 2 * fw, 3);
      }
    }
    // bearings along the bottom
    ctx.font = "700 9.5px Inter, system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
    ["N", "NE", "E", "SE", "S", "SW", "W", "NW"].forEach(function (l, j) {
      var x = sg.x(j * 45);
      if (x < 8 || x > W - 8) return;
      ctx.fillStyle = l === "N" ? "#ffb35c" : l.length === 1 ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.5)";
      ctx.fillText(l, x, H - 6);
      ctx.fillRect(x - 0.5, sg.hy, 1, 4);
    });
  }

  // ------------------------------------------------------------ frame

  var fx = { flash: 0, flashAt: 0, invite: !load("sunpath_seen", false) };
  var raf = 0, looping = false;
  function frameData(time, sun) {
    return {
      day: D.day, jun: D.jun, dec: D.dec, equ: D.equ, runs: D.runs,
      sun: sun || sunNow(), aim: aimNow(), mode: st.mode, lat: st.place.lat,
      flash: fx.flash, invite: fx.invite, time: reduce ? 0 : time
    };
  }
  function draw(time) {
    raf = 0;
    if (!D.day) return;
    time = time || performance.now();
    if (fx.flashAt) {
      var k = (time - fx.flashAt) / 700;
      fx.flash = k >= 1 ? 0 : Math.sin(Math.PI * clamp01(k)) * (1 - k * 0.3);
      if (k >= 1) fx.flashAt = 0;
    }
    var w = dome.width / DPR;
    G = geom(w, 0, 0, st.rot);
    var F = frameData(time);
    dctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    dctx.clearRect(0, 0, w, w);
    var h = drawDome(dctx, G, F);
    cache.sun = h.sun; cache.hc = h.hc; cache.he1 = h.he1; cache.he2 = h.he2;
    sctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    drawStrip(sctx, SW, SH, F);
    paintPanel(F.sun.alt);
    if (fx.flashAt) schedule();
    else if (looping && !reduce && time < idleUntil) { clearTimeout(idleT); idleT = setTimeout(schedule, 60); }
  }
  var idleT = 0, idleUntil = 0;
  // the shimmer runs for a while after each touch, then rests (it is only a nicety)
  function wake() {
    idleUntil = performance.now() + 20000;
    if (looping && !reduce) schedule();
  }
  ["pointerdown", "keydown", "input"].forEach(function (n) { document.addEventListener(n, wake, true); });
  function schedule() { if (!raf) raf = requestAnimationFrame(draw); }
  function paintPanel(alt) {
    var hor = stop(HOR, alt), zen = stop(ZEN, alt);
    panel.style.setProperty("--sky-a", rgb(mix(zen, NIGHT, 0.45)));
    panel.style.setProperty("--sky-b", rgb(mix(hor, NIGHT, 0.7)));
  }
  // a slow, calm shimmer on the sun while the page is visible (off with reduced motion)
  function startLoop() {
    if (reduce) return;
    looping = !document.hidden;
    if (looping) wake();
  }
  document.addEventListener("visibilitychange", startLoop);

  // ------------------------------------------------------------- words

  var els = {
    eyebrow: $("eyebrow"), hlNum: $("hlNum"), hlRest: $("hlRest"), sentence: $("sentence"),
    status: $("status"), placeName: $("placeName"), placeTz: $("placeTz"),
    timeOut: $("timeOut"), sunOut: $("sunOut"), dateOut: $("dateOut"),
    timeRange: $("timeRange"), dateRange: $("dateRange"),
    faceRange: $("faceRange"), widthRange: $("widthRange"), obstRange: $("obstRange"),
    faceOut: $("faceOut"), widthOut: $("widthOut"), obstOut: $("obstOut"),
    faceRow: $("faceRow"), widthRow: $("widthRow"),
    bars: $("bars"), verdict: $("verdict"), verdictWhy: $("verdictWhy"),
    stRise: $("stRise"), stRiseAz: $("stRiseAz"), stNoon: $("stNoon"), stNoonAlt: $("stNoonAlt"),
    stSet: $("stSet"), stSetAz: $("stSetAz"), stLen: $("stLen"), stLenD: $("stLenD"),
    stripLab: $("stripLab"), hint: $("domeHelp"), yearNote: $("yearNote")
  };
  var NOUN = { window: "this window", balcony: "this balcony", garden: "this bed" };

  function aimName() {
    if (st.mode === "garden") return "Garden bed";
    return cap(S.compassName(st.aim.center)) + (st.mode === "balcony" ? " balcony" : " window");
  }
  function runsList(runs, day, pre) {
    var parts = runs.map(function (r) { return (pre || "") + fmtSpan(r.a, r.b, day); });
    if (parts.length <= 1) return parts[0] || "";
    return parts.slice(0, -1).join(", ") + " and " + parts[parts.length - 1];
  }
  function isToday() { return sameYmd(st.ymd, todayYmd()); }
  function whenWord() { return isToday() ? "today" : "on " + fmtDateShort(st.ymd); }

  var shownMin = null, numTween = 0;
  function setHeadlineNum(mins, text) {
    if (reduce || shownMin == null || text) {
      shownMin = mins;
      els.hlNum.textContent = text || fmtDur(mins * MIN);
      return;
    }
    var from = shownMin, to = mins, t0 = performance.now();
    cancelAnimationFrame(numTween);
    shownMin = mins;
    (function step(now) {
      var k = clamp01((now - t0) / 380), v = from + (to - from) * ease(k);
      els.hlNum.textContent = fmtDur(v * MIN);
      if (k < 1) numTween = requestAnimationFrame(step);
    })(t0);
  }

  function updateWords(quietSentence, chimeOk) {
    var day = D.day, tot = shownMs(D.runs), noun = NOUN[st.mode];
    els.eyebrow.textContent = aimName() + " · " + st.place.n;
    var allDay = D.runs.length === 1 && D.runs[0].a <= day.t0 && D.runs[0].b >= day.t1;
    if (tot < MIN / 2) { setHeadlineNum(0, "No direct sun"); els.hlRest.textContent = " " + whenWord(); }
    else { setHeadlineNum(Math.round(tot / MIN)); els.hlRest.textContent = " of sun " + whenWord(); }

    if (!quietSentence) {
      var s = [];
      if (!D.runs.length) {
        s.push(day.alwaysDown ? "The sun stays below the horizon all day " + whenWord() + "." :
          "No direct sun on " + noun + " " + whenWord() + ".");
      } else if (allDay) {
        s.push("Sun on " + noun + " around the clock " + whenWord() + ": the midnight sun.");
      } else {
        s.push("Sun on " + noun + " " + runsList(D.runs, day, "from ") + " " + whenWord() + " (" + fmtDur(tot) + ").");
      }
      function refLine(label, runs, ref) {
        var t = shownMs(runs);
        if (!runs.length) return label + ": none.";
        return label + ": " + runsList(runs, ref) + " (" + fmtDur(t) + ").";
      }
      var html = "<b>" + esc(s[0]) + "</b>";
      var rest = [];
      if (!sameYmd(st.ymd, D.jun.ymd)) rest.push(refLine("In late June", D.junRuns, D.jun));
      if (!sameYmd(st.ymd, D.dec.ymd)) rest.push(refLine("In December", D.decRuns, D.dec));
      if (rest.length) html += " " + esc(rest.join(" "));
      els.sentence.innerHTML = html;
    }
    updateStatus(chimeOk);
    updateWhen();
    updateYear();
    updateStats();
    updateShare();
    if (!quietSentence) describeDome();
  }
  /* What the chart shows, in words, for anyone who can't see it. */
  function describeDome() {
    var d = D.day, tz = d.tz, bits = ["Sun path chart for " + fmtDateShort(st.ymd) + " in " + st.place.n + ", seen from above."];
    if (d.rise != null && d.set != null) {
      bits.push("The sun rises at " + fmtT(d.rise, tz) + " in the " + S.compassName(S.sunPosition(d.rise, d.lat, d.lon).az) +
        ", climbs to " + Math.round(d.noonAlt) + "° at " + fmtT(d.noon, tz) + " and sets at " + fmtT(d.set, tz) + " in the " +
        S.compassName(S.sunPosition(d.set, d.lat, d.lon).az) + ".");
    } else bits.push(d.alwaysUp ? "The sun never sets today." : "The sun never rises today.");
    if (st.mode !== "garden") bits.push("The wedge is a " + S.compassName(st.aim.center) + "-facing view " + Math.round(aimNow().width) + "° wide.");
    if (st.rot) bits.push("Turned so " + S.compassPoint(st.rot) + " is at the top.");
    dome.setAttribute("aria-label", bits.join(" "));
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  var lastInRun = null;
  function updateStatus(chimeOk) {
    var day = D.day, t = day.t0 + st.tMin * MIN, tz = day.tz;
    var inRun = D.runs.some(function (r) { return t >= r.a && t <= r.b; });
    var sun = sunNow(), txt = "", on = false;
    if (st.live && isToday()) {
      var next = null, cur = null;
      D.runs.forEach(function (r) { if (t >= r.a && t <= r.b) cur = r; else if (r.a > t && !next) next = r; });
      if (cur) { on = true; txt = cur.b >= day.t1 - 500 ? "In the sun now" : "In the sun now, until " + fmtT(cur.b, tz); }
      else if (next) txt = "Sun reaches it at " + fmtT(next.a, tz);
      else if (D.runs.length) txt = "Out of the sun for today";
      else txt = "No direct sun today";
    } else {
      var at = "At " + fmtT(t, tz) + ": ";
      if (sun.alt < S.RISE_ALT) txt = at + "the sun is down";
      else if (inRun) { txt = at + "in the sun"; on = true; }
      else txt = at + "in shade";
    }
    els.status.textContent = txt;
    els.status.classList.toggle("is-sun", on);
    if (lastInRun !== null && inRun !== lastInRun && chimeOk) {
      if (inRun) { fx.flashAt = performance.now(); schedule(); sound.chime(panOf(sun)); }
      else sound.leave(panOf(sun));
    }
    lastInRun = inRun;
  }

  function updateWhen() {
    var day = D.day, t = day.t0 + st.tMin * MIN, sun = sunNow();
    els.timeOut.textContent = fmtT(t, day.tz);
    els.sunOut.textContent = sun.alt > S.RISE_ALT
      ? "Sun " + Math.round(sun.alt) + "° up, " + S.compassPoint(sun.az) + " " + Math.round(sun.az) + "°"
      : "Sun below the horizon";
    els.dateOut.textContent = fmtDate(st.ymd) + (isToday() ? " · today" : "");
    els.timeRange.max = String(day.n - 1);
    if (!rangeBusy.time) els.timeRange.value = String(Math.round(st.tMin));
    els.dateRange.max = String(yearLen(st.ymd.y) - 1);
    if (!rangeBusy.date) els.dateRange.value = String(doyOf(st.ymd));
    els.timeRange.setAttribute("aria-valuetext", fmtT(t, day.tz));
    els.dateRange.setAttribute("aria-valuetext", fmtDate(st.ymd));
    $("nowBtn").classList.toggle("is-on", st.live && isToday());
    var jumps = document.querySelectorAll("[data-jump]");
    for (var i = 0; i < jumps.length; i++) {
      var j = jumps[i].getAttribute("data-jump"), on;
      if (j === "today") on = isToday();
      else { var p = j.split("-"); on = st.ymd.m === +p[0] && st.ymd.d === +p[1]; }
      jumps[i].classList.toggle("is-on", on);
    }
    // the aim controls
    els.faceRange.value = String(Math.round(st.aim.center) % 360);
    els.faceOut.textContent = S.compassPoint(st.aim.center) + " · " + Math.round(st.aim.center) % 360 + "°";
    els.widthRange.max = String(maxWidth());
    els.widthRange.value = String(Math.round(Math.min(st.aim.width, maxWidth())));
    els.widthOut.textContent = Math.round(Math.min(st.aim.width, maxWidth())) + "° of sky";
    els.obstRange.value = String(st.aim.obst);
    els.obstOut.textContent = st.aim.obst ? st.aim.obst + "° up" : "Nothing, open horizon";
    els.faceRange.setAttribute("aria-valuetext", S.compassName(st.aim.center) + ", " + Math.round(st.aim.center) + " degrees");
    els.faceRow.hidden = st.mode === "garden";
    els.widthRow.hidden = st.mode === "garden";
    var segs = document.querySelectorAll(".seg__b");
    for (i = 0; i < segs.length; i++) segs[i].setAttribute("aria-checked", String(segs[i].getAttribute("data-mode") === st.mode));
    els.hint.textContent = st.mode === "garden"
      ? "Drag the sun along its path to change the time. Drag the view below to look around. Arrow keys work too."
      : "Drag the sun to change the time. Drag the glowing wedge to aim it, or its edges to widen it. Tap the sky to point it there. Arrow keys work too.";
    els.stripLab.textContent = st.mode === "garden" ? "The horizon all around" : st.mode === "balcony" ? "The view off the balcony" : "The view out the window";
  }

  var barEls = [];
  function buildBars() {
    for (var m = 0; m < 12; m++) {
      var b = document.createElement("button");
      b.type = "button"; b.className = "mbar"; b.setAttribute("data-m", String(m));
      b.innerHTML = '<span class="mbar__col"><span class="mbar__fill"></span><span class="mbar__val"></span></span><span class="mbar__m">' + MON[m].charAt(0) + "</span>";
      b.addEventListener("click", (function (mm) { return function () { jumpTo({ y: st.ymd.y, m: mm, d: 21 }); sound.tick(0, 1.1); }; })(m));
      els.bars.appendChild(b);
      barEls.push(b);
    }
    var rule = document.createElement("div");
    rule.className = "bars__rule"; rule.hidden = true;
    els.bars.appendChild(rule);
    barEls.rule = rule;
  }
  function updateYear() {
    var hrs = D.yearHours, mx = 0;
    hrs.forEach(function (h) { mx = Math.max(mx, h); });
    var scale = Math.max(st.mode === "garden" ? 8 : 6, Math.ceil(mx));
    barEls.forEach(function (b, m) {
      var h = hrs[m];
      b.style.setProperty("--h", (h / scale).toFixed(4));
      // the value label rides up the column; keep it inside the column's box
      b.querySelector(".mbar__val").textContent = h < 0.05 ? "0" : h < 10 ? h.toFixed(1) : String(Math.round(h));
      b.classList.toggle("is-on", m === st.ymd.m);
      b.setAttribute("aria-label", MONTHS[m] + " 21: " + (h < 0.01 ? "no direct sun" : fmtDur(h * HOUR) + " of direct sun"));
      b.setAttribute("aria-pressed", String(m === st.ymd.m));
    });
    var rule = barEls.rule, garden = st.mode === "garden";
    rule.hidden = !garden;
    els.yearNote.textContent = garden ? "On the 21st of each month. The dashed line is 6 hours, the mark for full sun. Tap a month to see it on the sky." : "On the 21st of each month. Tap a month to see it on the sky.";
    if (garden) {
      var col = barEls[0].querySelector(".mbar__col");
      var top = barEls[0].offsetTop + col.offsetTop + col.offsetHeight * (1 - 6 / scale);
      rule.style.top = top + "px";
      var now = S.totalMs(D.runs) / HOUR, v = S.verdict(now);
      els.verdict.hidden = false; els.verdictWhy.hidden = false;
      els.verdict.className = "verdict verdict--" + v.key;
      els.verdict.textContent = v.label;
      var season = st.place.lat >= 0 ? [3, 4, 5, 6, 7, 8] : [9, 10, 11, 0, 1, 2];
      var avg = season.reduce(function (s, m) { return s + hrs[m]; }, 0) / 6;
      var sv = S.verdict(avg);
      var PLANTS = {
        full: "Room for tomatoes, peppers, squash, beans, roses and most herbs.",
        partsun: "Good for lettuce, spinach, peas, beets, chard, parsley and many flowering perennials.",
        partshade: "Try ferns, hostas, mint, impatiens and greens that bolt in the heat.",
        shade: "Ferns, moss and shade ground covers will be happiest. Most vegetables will struggle."
      };
      els.verdictWhy.textContent = fmtDur(shownMs(D.runs)) + " of direct sun " + whenWord() + ". " +
        "Through the growing season (" + (st.place.lat >= 0 ? "April to September" : "October to March") + ") it averages " +
        fmtDur(avg * HOUR) + ", " + sv.label.toLowerCase() + ". " + PLANTS[sv.key];
    } else {
      els.verdict.hidden = true; els.verdictWhy.hidden = true;
    }
  }

  function updateStats() {
    var day = D.day, tz = day.tz, p = st.place;
    function evt(t, elV, elS) {
      if (t == null) {
        elV.textContent = "None";
        elS.textContent = day.alwaysUp ? "Up all day" : day.alwaysDown ? "Down all day" : "";
        return;
      }
      var s = S.sunPosition(t, p.lat, p.lon);
      elV.textContent = fmtT(t, tz);
      elS.textContent = "in the " + S.compassPoint(s.az) + ", " + Math.round(s.az) + "°";
    }
    evt(day.rise, els.stRise, els.stRiseAz);
    evt(day.set, els.stSet, els.stSetAz);
    if (day.noon != null) {
      els.stNoon.textContent = fmtT(day.noon, tz);
      els.stNoonAlt.textContent = day.noonAlt > 0 ? Math.round(day.noonAlt) + "° up" : "below the horizon";
    } else { els.stNoon.textContent = "None"; els.stNoonAlt.textContent = ""; }
    els.stLen.textContent = fmtDur(day.daylight);
    var yd = S.computeDay(S.addDays(st.ymd, -1), p), dd = Math.round((day.daylight - yd.daylight) / 1000);
    var ad = Math.abs(dd);
    els.stLenD.textContent = day.alwaysUp || day.alwaysDown ? "" :
      ad < 10 ? "same as yesterday" :
      (ad >= 60 ? Math.floor(ad / 60) + " min " : "") + (ad % 60) + " s " + (dd > 0 ? "longer" : "shorter");
    els.stLenD.title = "Compared with yesterday";
  }

  /* The year slider's track glows with day length, so the solstices show. */
  function paintYearTrack() {
    if (!D.year) return;
    var stops = D.year.map(function (d, m) {
      var f = clamp01(d.daylight / DAY);
      var c = mix([46, 52, 82], [246, 184, 80], f);
      return rgb(c) + " " + ((m + 0.66) / 12 * 100).toFixed(1) + "%";
    });
    els.dateRange.style.setProperty("--track", "linear-gradient(90deg, " + stops.join(", ") + ")");
  }

  // ------------------------------------------------------------- share

  function updateShare() {
    var tot = shownMs(D.runs), place = st.place.n, what = st.mode === "garden" ? "garden bed" : aimName().toLowerCase();
    var best = -1, bm = 0;
    D.yearHours.forEach(function (h, m) { if (h > best) { best = h; bm = m; } });
    if (tot >= MIN) {
      window.OPT_SHARE_TEXT = "My " + what + " in " + place + " gets " + fmtDur(tot) + " of direct sun " + whenWord() +
        ", " + runsList(D.runs, D.day) + "." + (D.decRuns.length && !sameYmd(st.ymd, D.dec.ymd) ? " In December: " + runsList(D.decRuns, D.dec) + "." : "");
      window.OPT_SHARE_LINE = fmtDur(tot) + " of sun on my " + (st.mode === "garden" ? "garden bed" : S.compassPoint(st.aim.center) + " " + st.mode);
      window.OPT_SHARE_IMAGE = shareCanvas;
    } else if (best > 0.05) {
      window.OPT_SHARE_TEXT = "My " + what + " in " + place + " gets no direct sun " + whenWord() + ", but " +
        fmtDur(best * HOUR) + " a day in " + MONTHS[bm] + ".";
      window.OPT_SHARE_LINE = fmtDur(best * HOUR) + " of sun in " + MONTHS[bm];
      window.OPT_SHARE_IMAGE = shareCanvas;
    } else {
      // nothing to brag about: share the sky instead
      var d = D.day;
      window.OPT_SHARE_IMAGE = null; window.OPT_SHARE_LINE = null;
      window.OPT_SHARE_TEXT = d.rise != null
        ? "In " + place + " " + whenWord() + " the sun rises at " + fmtT(d.rise, d.tz) + " and climbs to " + Math.round(d.noonAlt) + "°."
        : "In " + place + " " + whenWord() + " the sun " + (d.alwaysUp ? "never sets." : "never rises.");
    }
  }
  function shareCanvas() {
    var W = 1080, H = 1350, c = document.createElement("canvas");
    c.width = W; c.height = H;
    // the picture shows the sun ON the window: the middle of its longest spell
    var sun = sunNow(), longest = null;
    D.runs.forEach(function (r) { if (!longest || r.b - r.a > longest.b - longest.a) longest = r; });
    if (longest) sun = S.sunPosition((longest.a + longest.b) / 2, st.place.lat, st.place.lon);
    var x = c.getContext("2d"), sa = sun.alt;
    var hor = stop(HOR, sa), zen = stop(ZEN, sa);
    var bg = x.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, rgb(mix(zen, NIGHT, 0.45))); bg.addColorStop(1, rgb(mix(hor, NIGHT, 0.78)));
    x.fillStyle = bg; x.fillRect(0, 0, W, H);
    x.textAlign = "center";
    x.fillStyle = "rgba(255,255,255,0.7)";
    x.font = "700 30px Inter, system-ui, sans-serif";
    x.fillText((aimName() + " · " + st.place.n + " · " + fmtDateShort(st.ymd)).toUpperCase(), W / 2, 84);
    x.fillStyle = "#ffffff";
    x.font = "600 64px Fraunces, Georgia, serif";
    var tot = shownMs(D.runs);
    x.fillText(tot >= MIN ? fmtDur(tot) + " of direct sun" : "No direct sun " + whenWord(), W / 2, 160);
    var g = geom(940, (W - 940) / 2, 190, 0);
    var F = frameData(0, sun); F.invite = false; F.flash = 0;
    drawDome(x, g, F);
    return c;
  }

  // ------------------------------------------------------------- audio

  var sound = (function () {
    var AC = null, out = null, bus = null, on = load("sunpath_sound", true) !== false;
    var lastTick = 0, lastChime = 0;
    function ir(secs) {
      var rate = AC.sampleRate, n = Math.floor(rate * secs), b = AC.createBuffer(2, n, rate);
      for (var ch = 0; ch < 2; ch++) {
        var d = b.getChannelData(ch), lp = 0, s = ch ? 7 : 3;
        for (var i = 0; i < n; i++) {
          s = (s * 16807) % 2147483647;
          var w = s / 1073741823.5 - 1;
          lp += (w - lp) * (0.32 - 0.24 * i / n);            // darker as it decays: the air eats the treble
          var v = lp * Math.pow(1 - i / n, 2.4) * (i < rate * 0.004 ? i / (rate * 0.004) : 1);
          d[i] = isFinite(v) ? v : 0;
        }
      }
      return b;
    }
    function init() {
      if (AC) return AC;
      var C = window.AudioContext || window.webkitAudioContext;
      if (!C) return null;
      try { AC = new C(); } catch (e) { AC = null; return null; }
      try {   // iOS unlock: a one-sample silent buffer inside the first gesture
        var sb = AC.createBuffer(1, 1, 22050), src = AC.createBufferSource();
        src.buffer = sb; src.connect(AC.destination); src.start(0);
      } catch (e) {}
      out = AC.createGain(); out.gain.value = on ? 1 : 0;
      var glue = AC.createDynamicsCompressor();
      glue.threshold.value = -15; glue.ratio.value = 3; glue.knee.value = 8; glue.attack.value = 0.004; glue.release.value = 0.25;
      var brick = AC.createDynamicsCompressor();
      brick.threshold.value = -1.5; brick.ratio.value = 20; brick.knee.value = 0; brick.attack.value = 0.001; brick.release.value = 0.06;
      bus = AC.createGain(); bus.gain.value = 1;
      var verb = AC.createConvolver(); verb.buffer = ir(2.2);
      var send = AC.createGain(); send.gain.value = 0.32;
      var hp = AC.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 260;
      bus.connect(glue); bus.connect(send); send.connect(hp); hp.connect(verb); verb.connect(glue);
      glue.connect(brick); brick.connect(out); out.connect(AC.destination);
      return AC;
    }
    function resume() { if (AC && AC.state === "suspended") { try { AC.resume(); } catch (e) {} } }
    function voiceOut(pan) {
      var g = AC.createGain();
      if (AC.createStereoPanner) { var p = AC.createStereoPanner(); p.pan.value = clamp(pan || 0, -0.9, 0.9); g.connect(p); p.connect(bus); }
      else g.connect(bus);
      return g;
    }
    var noiseBuf = null;
    function noise() {
      if (noiseBuf) return noiseBuf;
      var n = Math.floor(AC.sampleRate * 0.05), b = AC.createBuffer(1, n, AC.sampleRate), d = b.getChannelData(0), s = 99;
      for (var i = 0; i < n; i++) { s = (s * 16807) % 2147483647; d[i] = s / 1073741823.5 - 1; }
      return (noiseBuf = b);
    }
    /* A dial detent: a tiny contact click, rung through two small brass modes. */
    function tick(pan, pitch) {
      if (!on || !init()) return;
      resume();
      var now = AC.currentTime;
      if (now - lastTick < 0.035) return;
      lastTick = now;
      var o = voiceOut(pan), f = 2650 * (pitch || 1) * (0.98 + Math.random() * 0.04);
      o.gain.value = 0.16;
      var src = AC.createBufferSource(); src.buffer = noise();
      var env = AC.createGain();
      env.gain.setValueAtTime(0, now);
      env.gain.linearRampToValueAtTime(1, now + 0.0008);
      env.gain.exponentialRampToValueAtTime(0.0008, now + 0.006);
      src.connect(env);
      var tack = AC.createBiquadFilter(); tack.type = "lowpass"; tack.frequency.value = 8000; tack.Q.value = 0.6;
      var tg = AC.createGain(); tg.gain.value = 0.35;
      env.connect(tack); tack.connect(tg); tg.connect(o);
      [[1, 14, 0.9], [1.71, 11, 0.55], [2.93, 9, 0.3]].forEach(function (m) {
        var bp = AC.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = f * m[0]; bp.Q.value = m[1];
        var mg = AC.createGain(); mg.gain.value = m[2] * Math.sqrt(m[1]) * 0.9;
        env.connect(bp); bp.connect(mg); mg.connect(o);
      });
      src.start(now); src.stop(now + 0.05);
    }
    /* Sunlight arriving on the window: a small glass bell, additive (bells
     * ring too long for resonant filters), with a soft strike. */
    var PENTA = [1, 9 / 8, 5 / 4, 3 / 2, 5 / 3];
    var chimeN = 0;
    function bell(base, amp, pan, len) {
      var now = AC.currentTime + 0.005, o = voiceOut(pan);
      o.gain.value = amp;
      [[1, 1, 1], [2.0, 0.42, 0.62], [3.01, 0.22, 0.42], [4.17, 0.12, 0.28], [5.43, 0.07, 0.2]].forEach(function (p, j) {
        [0, 4].forEach(function (cents, k) {
          var os = AC.createOscillator(); os.type = "sine";
          os.frequency.value = base * p[0] * Math.pow(2, cents / 1200);
          var g = AC.createGain(), a = p[1] * (k ? 0.35 : 1) / 1.6, d = len * p[2];
          g.gain.setValueAtTime(0, now);
          g.gain.linearRampToValueAtTime(a, now + 0.004 + j * 0.001);
          g.gain.exponentialRampToValueAtTime(0.0005, now + d);
          os.connect(g); g.connect(o); os.start(now); os.stop(now + d + 0.05);
        });
      });
      var src = AC.createBufferSource(); src.buffer = noise();
      var hp = AC.createBiquadFilter(); hp.type = "bandpass"; hp.frequency.value = base * 3; hp.Q.value = 0.8;
      var sg = AC.createGain();
      sg.gain.setValueAtTime(0.5, now); sg.gain.exponentialRampToValueAtTime(0.001, now + 0.02);
      src.connect(hp); hp.connect(sg); sg.connect(o); src.start(now); src.stop(now + 0.05);
    }
    function chime(pan) {
      if (!on || !init()) return;
      resume();
      if (AC.currentTime - lastChime < 0.25) return;
      lastChime = AC.currentTime;
      bell(659.25 * PENTA[chimeN++ % PENTA.length], 0.13, pan, 2.6);
    }
    function leave(pan) {
      if (!on || !init()) return;
      resume();
      if (AC.currentTime - lastChime < 0.25) return;
      lastChime = AC.currentTime;
      bell(329.63, 0.085, pan, 1.3);
    }
    function set(v) {
      on = v; save("sunpath_sound", v);
      if (v) init();
      if (out) out.gain.setTargetAtTime(v ? 1 : 0, AC.currentTime, 0.02);
    }
    return { tick: tick, chime: chime, leave: leave, set: set, init: init, get on() { return on; }, ctx: function () { return AC; } };
  })();
  function panOf(sun) {
    if (!G) return 0;
    var p = proj(G, sun.az, sun.alt);
    return clamp((p.x - G.cx) / G.R, -1, 1) * 0.7;
  }

  var soundBtn = $("soundBtn");
  function paintSoundBtn() {
    soundBtn.setAttribute("aria-pressed", String(sound.on));
    soundBtn.setAttribute("aria-label", sound.on ? "Sound on" : "Sound off");
  }
  soundBtn.addEventListener("click", function () { sound.set(!sound.on); paintSoundBtn(); if (sound.on) sound.tick(0, 1); });
  paintSoundBtn();

  // ------------------------------------------------------------- updates

  function refreshAll() {
    computeDays();
    computeRuns();
    updateWords();
    schedule();
  }
  var aimRaf = 0;
  function aimChanged(quiet) {
    if (aimRaf) return;
    aimRaf = requestAnimationFrame(function () {
      aimRaf = 0;
      computeRuns();
      updateWords(quiet, true);
      schedule();
    });
  }
  function timeChanged(fromUser) {
    updateStatus(fromUser); updateWhen(); schedule();
  }

  // ------------------------------------------------------------- input: dome

  var drag = null;
  function dragging() { return !!drag; }
  function local(e, el) {
    var r = el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  function nearestSample(x, y, around) {
    var day = D.day, best = -1, bd = Infinity;
    var lo = 0, hi = day.n;
    if (around != null) { lo = Math.max(0, around - 200); hi = Math.min(day.n, around + 200); }
    for (var i = lo; i <= hi; i++) {
      if (day.alt[i] <= -18) continue;
      var p = proj(G, day.az[i], day.alt[i]), d = (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y);
      if (d < bd) { bd = d; best = i; }
    }
    return { i: best, d: Math.sqrt(bd) };
  }
  function hitTest(x, y) {
    if (!G || !D.day) return null;
    var u = Math.max(1, G.u);
    if (cache.sun && Math.hypot(cache.sun.x - x, cache.sun.y - y) < 26 * u) return { kind: "sun" };
    if (st.mode !== "garden") {
      if (cache.hc && Math.hypot(cache.hc.x - x, cache.hc.y - y) < 24 * u) return { kind: "rotate", grab: 0 };
      if (cache.he1 && Math.hypot(cache.he1.x - x, cache.he1.y - y) < 22 * u) return { kind: "width" };
      if (cache.he2 && Math.hypot(cache.he2.x - x, cache.he2.y - y) < 22 * u) return { kind: "width" };
    }
    var ns = nearestSample(x, y);
    if (ns.i >= 0 && ns.d < 16 * u) return { kind: "sun", jump: ns.i };
    var up = unproj(G, x, y);
    if (up.r > G.R + G.M + 14 * u) return null;
    if (st.mode !== "garden" && up.r > 6 && S.inWedge(up.az, st.aim.center, aimNow().width)) {
      return { kind: "rotate", grab: signed(up.az - st.aim.center) };
    }
    return { kind: "tap", az: up.az };
  }
  var lastHour = null, lastDetent = null;
  function setTime(min, fromDrag) {
    var day = D.day;
    min = clamp(min, 0, day.n);
    var hr = Math.floor(S.wall(day.t0 + min * MIN, day.tz).h);
    if (fromDrag && lastHour !== null && hr !== lastHour) sound.tick(panOf(S.sunPosition(day.t0 + min * MIN, day.lat, day.lon)), 1);
    lastHour = hr;
    st.tMin = min; st.live = false;
    timeChanged(!!fromDrag);
  }
  function setCenter(az, fromDrag) {
    az = mod(az, 360);
    var det = Math.round(az / 15);
    if (fromDrag && lastDetent !== null && det !== lastDetent) sound.tick(0, 0.8);
    lastDetent = det;
    st.aim.center = az;
    aimChanged(true);
  }
  function seen() {
    if (fx.invite) { fx.invite = false; save("sunpath_seen", true); }
    els.hint.classList.add("is-quiet");
  }

  dome.addEventListener("pointerdown", function (e) {
    if (e.button && e.button !== 0) return;
    sound.init();
    var p = local(e, dome), h = hitTest(p.x, p.y);
    if (!h) return;
    drag = { kind: h.kind, grab: h.grab || 0, x0: p.x, y0: p.y, moved: false, az: h.az, id: e.pointerId };
    if (h.kind === "tap") return;
    try { dome.setPointerCapture(e.pointerId); } catch (err) {}
    dome.classList.add("is-grab");
    e.preventDefault();
    lastHour = null; lastDetent = Math.round(st.aim.center / 15);
    if (h.kind === "sun" && h.jump != null) setTime(h.jump, true);
    if (h.kind !== "sun") track("sunpath_aim", { how: "drag" });
    seen();
  });
  dome.addEventListener("pointermove", function (e) {
    if (!drag || e.pointerId !== drag.id) return;
    var p = local(e, dome);
    if (Math.hypot(p.x - drag.x0, p.y - drag.y0) > 6) drag.moved = true;
    if (drag.kind === "tap") return;
    var up = unproj(G, p.x, p.y);
    if (drag.kind === "sun") {
      var ns = nearestSample(p.x, p.y, Math.round(st.tMin));
      if (ns.d > 40 * Math.max(1, G.u)) ns = nearestSample(p.x, p.y);
      if (ns.i >= 0) setTime(ns.i, true);
    } else if (drag.kind === "rotate") {
      setCenter(up.az - drag.grab, true);
    } else if (drag.kind === "width") {
      var w = clamp(2 * S.angDiff(up.az, st.aim.center), 20, maxWidth());
      var det = Math.round(w / 15);
      if (drag.det != null && det !== drag.det) sound.tick(0, 0.9);
      drag.det = det;
      st.aim.width = w;
      aimChanged(true);
    }
  });
  function endDrag(e) {
    if (!drag || (e && e.pointerId !== drag.id)) return;
    var d = drag;
    drag = null;
    dome.classList.remove("is-grab");
    if (d.kind === "tap" && !d.moved && st.mode !== "garden" && e && e.type === "pointerup") {
      animateCenter(d.az);
      sound.tick(0, 0.8);
      track("sunpath_aim", { how: "tap" });
      seen();
    } else if (d.kind === "rotate" || d.kind === "width") {
      st.aim.center = Math.round(st.aim.center) % 360; st.aim.width = Math.round(st.aim.width);
      saveAim();
    }
    computeRuns(); updateWords(); schedule();
  }
  dome.addEventListener("pointerup", endDrag);
  dome.addEventListener("pointercancel", endDrag);
  // Let the page scroll when a finger lands on empty sky; hold it still when
  // it lands on the sun, the wedge or a handle.
  dome.addEventListener("touchstart", function (e) {
    if (e.touches.length !== 1) return;
    var t = e.touches[0], r = dome.getBoundingClientRect();
    var h = hitTest(t.clientX - r.left, t.clientY - r.top);
    if (h && h.kind !== "tap") e.preventDefault();
  }, { passive: false });

  dome.addEventListener("keydown", function (e) {
    var k = e.key, big = e.shiftKey ? 1 : 5, used = true;
    if (k === "ArrowLeft" && st.mode !== "garden") { setCenter(st.aim.center - big, true); saveAim(); }
    else if (k === "ArrowRight" && st.mode !== "garden") { setCenter(st.aim.center + big, true); saveAim(); }
    else if (k === "ArrowUp") setTime(st.tMin + (e.shiftKey ? 1 : 10), true);
    else if (k === "ArrowDown") setTime(st.tMin - (e.shiftKey ? 1 : 10), true);
    else if (k === "[" && st.mode !== "garden") { st.aim.width = clamp(st.aim.width - 5, 20, maxWidth()); aimChanged(); saveAim(); }
    else if (k === "]" && st.mode !== "garden") { st.aim.width = clamp(st.aim.width + 5, 20, maxWidth()); aimChanged(); saveAim(); }
    else used = false;
    if (used) { e.preventDefault(); sound.init(); seen(); }
  });
  dome.addEventListener("keyup", function () { if (!drag) { computeRuns(); updateWords(); } });

  var centerTween = 0;
  function animateCenter(target) {
    var from = st.aim.center, delta = signed(target - from);
    cancelAnimationFrame(centerTween);
    if (reduce || Math.abs(delta) < 1) { st.aim.center = mod(Math.round(target), 360); saveAim(); computeRuns(); updateWords(); schedule(); return; }
    var t0 = performance.now(), dur = 260 + Math.abs(delta) * 2;
    (function step(now) {
      var k = clamp01((now - t0) / dur);
      st.aim.center = mod(from + delta * ease(k), 360);
      computeRuns();
      if (k < 1) { updateWords(true); schedule(); centerTween = requestAnimationFrame(step); }
      else { st.aim.center = mod(Math.round(target), 360); saveAim(); computeRuns(); updateWords(); schedule(); }
    })(t0);
  }

  // ------------------------------------------------------------- input: strip

  var sdrag = null;
  strip.addEventListener("pointerdown", function (e) {
    sound.init();
    sdrag = { x: local(e, strip).x, id: e.pointerId, c0: stripCenter(), moved: false };
    try { strip.setPointerCapture(e.pointerId); } catch (err) {}
  });
  strip.addEventListener("pointermove", function (e) {
    if (!sdrag || e.pointerId !== sdrag.id) return;
    var x = local(e, strip).x, dx = x - sdrag.x;
    if (Math.abs(dx) > 3) sdrag.moved = true;
    var c = sdrag.c0 - dx / (SW / 2) * 180;
    if (st.mode === "garden") { st.gardenView = mod(c, 360); schedule(); }
    else setCenter(c, true);
    seen();
  });
  function endStrip(e) {
    if (!sdrag || (e && e.pointerId !== sdrag.id)) return;
    var moved = sdrag.moved;
    sdrag = null;
    if (st.mode !== "garden" && moved) { st.aim.center = Math.round(st.aim.center) % 360; saveAim(); track("sunpath_aim", { how: "strip" }); }
    computeRuns(); updateWords(); schedule();
  }
  strip.addEventListener("pointerup", endStrip);
  strip.addEventListener("pointercancel", endStrip);

  // ------------------------------------------------------------ controls

  var rangeBusy = { time: false, date: false };
  els.timeRange.addEventListener("input", function () {
    rangeBusy.time = true; setTime(+els.timeRange.value, true); rangeBusy.time = false; seen();
  });
  els.dateRange.addEventListener("input", function () {
    rangeBusy.date = true;
    setDate(ymdFromDoy(st.ymd.y, +els.dateRange.value), true);
    rangeBusy.date = false;
  });
  els.dateRange.addEventListener("change", function () { updateWords(); });
  $("nowBtn").addEventListener("click", function () { goNow(true); sound.tick(0, 1.2); });
  document.querySelectorAll("[data-jump]").forEach(function (b) {
    b.addEventListener("click", function () {
      var j = b.getAttribute("data-jump");
      sound.tick(0, 1.1);
      if (j === "today") { goNow(true); return; }
      var p = j.split("-");
      jumpTo({ y: st.ymd.y, m: +p[0], d: +p[1] });
    });
  });
  els.faceRange.addEventListener("input", function () { setCenter(+els.faceRange.value, true); saveAim(); track("sunpath_aim", { how: "slider" }); });
  els.widthRange.addEventListener("input", function () { st.aim.width = +els.widthRange.value; aimChanged(true); saveAim(); });
  els.obstRange.addEventListener("input", function () {
    var v = +els.obstRange.value;
    if (Math.round(v / 5) !== Math.round(st.aim.obst / 5)) sound.tick(0, 0.9);
    st.aim.obst = v; aimChanged(true); saveAim();
  });
  [els.faceRange, els.widthRange, els.obstRange].forEach(function (r) {
    r.addEventListener("change", function () { computeRuns(); updateWords(); });
  });
  document.querySelectorAll(".seg__b").forEach(function (b) {
    b.addEventListener("click", function () { setMode(b.getAttribute("data-mode")); });
    b.addEventListener("keydown", function (e) {
      var order = ["window", "balcony", "garden"], i = order.indexOf(st.mode);
      if (e.key === "ArrowRight" || e.key === "ArrowDown") i = (i + 1) % 3;
      else if (e.key === "ArrowLeft" || e.key === "ArrowUp") i = (i + 2) % 3;
      else return;
      e.preventDefault(); setMode(order[i]);
      document.querySelector('.seg__b[data-mode="' + order[i] + '"]').focus();
    });
  });
  function setMode(m) {
    if (m === st.mode) return;
    st.mode = m;
    if (m === "balcony" && st.aim.width < 150) st.aim.width = 170;
    if (m === "window" && st.aim.width > 180) st.aim.width = 120;
    if (m === "garden") st.gardenView = st.place.lat >= 0 ? 180 : 0;
    saveAim(); sound.tick(0, 1.05);
    track("sunpath_mode_" + m);
    computeRuns(); updateWords(); schedule();
  }

  function setDate(ymd, quiet) {
    st.ymd = ymd;
    if (st.live && !sameYmd(ymd, todayYmd())) st.live = false;
    computeDays();
    computeRuns();
    updateWords(!!quiet);
    schedule();
  }
  var dateTween = 0;
  function jumpTo(target) {
    cancelAnimationFrame(dateTween);
    var from = st.ymd, n0 = doyOf(from), n1 = doyOf(target);
    if (target.y !== from.y) n0 = n1;
    st.live = false;
    if (reduce || n0 === n1) { setDate(target); return; }
    var t0 = performance.now(), dur = Math.min(900, 380 + Math.abs(n1 - n0) * 2.4), last = n0;
    (function step(now) {
      var k = clamp01((now - t0) / dur), n = Math.round(n0 + (n1 - n0) * ease(k));
      if (n !== last || k >= 1) {
        last = n;
        st.ymd = ymdFromDoy(target.y, n);
        computeDays();
        computeRuns();
        updateWords(k < 1);
        schedule();
      }
      if (k < 1) dateTween = requestAnimationFrame(step);
      else setDate(target);
    })(t0);
  }
  function goNow(user) {
    cancelAnimationFrame(dateTween);
    st.ymd = todayYmd();
    computeDays();
    st.tMin = nowMin(D.day);
    st.live = true;
    computeRuns();
    updateWords();
    schedule();
    if (user) seen();
  }

  // -------------------------------------------------------------- place

  var citySel = $("citySel"), tzSel = $("tzSel"), placeNote = $("placeNote");
  (function fillSelects() {
    var o = document.createElement("option");
    o.value = ""; o.textContent = "Choose a city"; citySel.appendChild(o);
    var idx = 0;
    (window.SUNPATH_CITIES || []).forEach(function (g) {
      var og = document.createElement("optgroup"); og.label = g[0];
      g[1].forEach(function () {
        var c = CITIES[idx], op = document.createElement("option");
        op.value = String(idx); op.textContent = c.n; og.appendChild(op); idx++;
      });
      citySel.appendChild(og);
    });
    var zones = {};
    CITIES.forEach(function (c) { zones[c.tz] = 1; });
    zones[browserTz()] = 1; zones.UTC = 1;
    Object.keys(zones).sort().forEach(function (z) {
      var op = document.createElement("option");
      op.value = z; op.textContent = z.replace(/_/g, " ") + " (" + offsetLabel(z) + ")";
      tzSel.appendChild(op);
    });
  })();
  function offsetLabel(tz) {
    var off = Math.round(S.tzOffset(Date.now(), tz) / MIN), sgn = off < 0 ? "−" : "+";
    off = Math.abs(off);
    return "UTC" + sgn + Math.floor(off / 60) + (off % 60 ? ":" + String(off % 60).padStart(2, "0") : "");
  }
  function showPlace() {
    var p = st.place;
    els.placeName.textContent = p.n;
    var tzc = p.tz.split("/").pop().replace(/_/g, " ");
    els.placeTz.textContent = p.city ? offsetLabel(p.tz) : coordName(p.lat, p.lon) + " · " + tzc + " time";
    var idx = -1;
    for (var i = 0; i < CITIES.length; i++) if (p.city && CITIES[i].n === p.n && CITIES[i].tz === p.tz) idx = i;
    citySel.value = idx >= 0 ? String(idx) : "";
    $("latIn").value = p.city ? "" : String(+p.lat.toFixed(4));
    $("lonIn").value = p.city ? "" : String(+p.lon.toFixed(4));
    tzSel.value = p.tz;
    if (tzSel.value !== p.tz) {
      var op = document.createElement("option"); op.value = p.tz; op.textContent = p.tz.replace(/_/g, " ") + " (" + offsetLabel(p.tz) + ")";
      tzSel.appendChild(op); tzSel.value = p.tz;
    }
  }
  function setPlace(p, how) {
    var wasLive = st.live;
    st.place = p;
    save("sunpath_place", p);
    if (wasLive || !st.ymd) { st.ymd = todayYmd(); computeDays(); st.tMin = nowMin(D.day); st.live = true; }
    else { computeDays(); }
    computeRuns();
    showPlace();
    updateWords();
    schedule();
    if (how) track("sunpath_place_" + how);
  }
  citySel.addEventListener("change", function () {
    var c = CITIES[+citySel.value];
    if (!citySel.value || !c) return;
    placeNote.textContent = "";
    setPlace(cityCopy(c), "city");
    $("place").open = false;
    sound.tick(0, 1.1);
  });
  function parseCoord(s, posCh, negCh) {
    s = String(s || "").trim().toUpperCase().replace(/[°º]/g, " ");
    var m = /^([+-]?\d+(?:\.\d+)?)\s*([A-Z])?$/.exec(s.replace(/\s+/g, " ").replace(/ (?=[A-Z]$)/, ""));
    if (!m) return NaN;
    var v = parseFloat(m[1]);
    if (m[2] === negCh) v = -Math.abs(v); else if (m[2] && m[2] !== posCh) return NaN;
    return v;
  }
  $("latIn").addEventListener("change", function () {
    var lat = parseCoord($("latIn").value, "N", "S"), lon = parseCoord($("lonIn").value, "E", "W");
    if (isFinite(lat) && isFinite(lon)) tzSel.value = guessTz(lat, lon);
  });
  $("lonIn").addEventListener("change", function () {
    var lat = parseCoord($("latIn").value, "N", "S"), lon = parseCoord($("lonIn").value, "E", "W");
    if (isFinite(lat) && isFinite(lon)) tzSel.value = guessTz(lat, lon);
  });
  $("coordBtn").addEventListener("click", function () {
    var lat = parseCoord($("latIn").value, "N", "S"), lon = parseCoord($("lonIn").value, "E", "W");
    if (!isFinite(lat) || Math.abs(lat) > 90) { placeNote.textContent = "Latitude runs from -90 (south) to 90 (north), like 40.71."; $("latIn").focus(); return; }
    if (!isFinite(lon) || Math.abs(lon) > 180) { placeNote.textContent = "Longitude runs from -180 (west) to 180 (east), like -74.01."; $("lonIn").focus(); return; }
    var tz = tzSel.value && S.validTz(tzSel.value) ? tzSel.value : guessTz(lat, lon);
    setPlace({ n: coordName(lat, lon), lat: lat, lon: lon, tz: tz }, "coords");
    placeNote.textContent = "Showing times on the " + tz.replace(/_/g, " ") + " clock.";
    sound.tick(0, 1.1);
  });
  $("locBtn").addEventListener("click", function () {
    var btn = $("locBtn");
    if (!navigator.geolocation) { placeNote.textContent = "This browser can't share a location. Pick a city or type coordinates."; return; }
    btn.disabled = true;
    placeNote.textContent = "Asking your browser…";
    navigator.geolocation.getCurrentPosition(function (pos) {
      btn.disabled = false;
      var lat = Math.round(pos.coords.latitude * 1000) / 1000, lon = Math.round(pos.coords.longitude * 1000) / 1000;
      setPlace({ n: "Your location", lat: lat, lon: lon, tz: browserTz() }, "geo");
      placeNote.textContent = "Using " + coordName(lat, lon) + ", rounded to about 100 m. It stays on this device.";
      $("place").open = false;
      sound.tick(0, 1.1);
    }, function (err) {
      btn.disabled = false;
      placeNote.textContent = err && err.code === 1
        ? "Location is turned off for this page. Pick a city or type coordinates instead."
        : "Couldn't get a location just now. Pick a city or type coordinates instead.";
    }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 });
  });

  // ------------------------------------------------------------ compass

  var compass = $("compass"), headingPill = $("headingPill");
  var cs = { on: false, raw: null, acc: null, vx: 0, vy: 0, got: false, abs: false, offset: +load("sunpath_compass_offset", 0) || 0, timer: 0 };
  var coarse = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
  if ("DeviceOrientationEvent" in window && coarse) compass.hidden = false;
  function screenAngle() {
    var a = 0;
    try { a = screen.orientation && typeof screen.orientation.angle === "number" ? screen.orientation.angle : (window.orientation || 0); } catch (e) {}
    return +a || 0;
  }
  function feed(h, acc) {
    if (h == null || !isFinite(h)) return;
    cs.got = true;
    cs.raw = mod(h, 360); cs.acc = acc;
    var k = cs.vx || cs.vy ? 0.22 : 1;            // smooth the needle, on the circle so 359→1 never spins
    cs.vx += (Math.sin(cs.raw * rad) - cs.vx) * k;
    cs.vy += (Math.cos(cs.raw * rad) - cs.vy) * k;
    var hd = heading();
    st.rot = hd;
    var pt = S.compassPoint(hd);
    headingPill.hidden = false;
    headingPill.textContent = "You face " + pt + " " + Math.round(hd) + "°";
    $("aimPill").hidden = false;
    $("compassRead").innerHTML = "Pointing " + esc(S.compassName(hd)) + ", " + Math.round(hd) + "° <span class=\"dim\">" +
      (acc != null && acc >= 0 ? "(accurate to about ±" + Math.round(acc) + "°)" : "(phone compasses can be 10 to 20° off)") + "</span>";
    schedule();
  }
  function heading() { return mod(Math.atan2(cs.vx, cs.vy) / rad + cs.offset, 360); }
  function onAbs(e) {
    cs.abs = true;
    if (e.alpha == null) return;
    var r = S.headingFromOrientation(e.alpha, e.beta, e.gamma, screenAngle());
    if (r) feed(r.heading, null);
  }
  function onOri(e) {
    if (typeof e.webkitCompassHeading === "number" && !isNaN(e.webkitCompassHeading)) {
      var flat = Math.abs(e.beta || 0) < 50 && Math.abs(e.gamma || 0) < 50;
      feed(e.webkitCompassHeading + (flat ? screenAngle() : 0), typeof e.webkitCompassAccuracy === "number" ? e.webkitCompassAccuracy : null);
    } else if (!cs.abs && e.absolute === true && e.alpha != null) {
      var r = S.headingFromOrientation(e.alpha, e.beta, e.gamma, screenAngle());
      if (r) feed(r.heading, null);
    }
  }
  function compassStart() {
    var DO = window.DeviceOrientationEvent;
    var go = function () {
      cs.on = true; cs.got = false; cs.vx = cs.vy = 0;
      window.addEventListener("deviceorientationabsolute", onAbs);
      window.addEventListener("deviceorientation", onOri);
      $("compassLive").hidden = false;
      $("compassBtn").hidden = true;
      $("compassRead").textContent = "Waiting for the compass…";
      // the dome is the thing to watch while you turn
      try { panel.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" }); } catch (e) {}
      clearTimeout(cs.timer);
      cs.timer = setTimeout(function () {
        if (!cs.got) $("compassRead").textContent = "No compass reading from this device. Set the direction with the wedge or the slider instead.";
      }, 3500);
      track("sunpath_compass");
    };
    if (DO && typeof DO.requestPermission === "function") {
      DO.requestPermission().then(function (r) {
        if (r === "granted") go();
        else $("compassNote").textContent = "Motion access was turned down, so the compass can't be read. The wedge and the slider still work.";
      }).catch(function () {
        $("compassNote").textContent = "The compass needs a tap to start. Try the button again.";
      });
    } else go();
  }
  function compassStop() {
    cs.on = false;
    window.removeEventListener("deviceorientationabsolute", onAbs);
    window.removeEventListener("deviceorientation", onOri);
    clearTimeout(cs.timer);
    st.rot = 0;
    headingPill.hidden = true;
    $("aimPill").hidden = true;
    $("compassLive").hidden = true;
    $("compassBtn").hidden = false;
    schedule();
  }
  $("compassBtn").addEventListener("click", function () { sound.init(); compassStart(); });
  $("compassOff").addEventListener("click", compassStop);
  function aimHere() {
    if (!cs.got) return;
    if (st.mode === "garden") setMode("window");
    animateCenter(Math.round(heading()));
    sound.tick(0, 1.2);
    track("sunpath_point_set");
  }
  $("aimHereBtn").addEventListener("click", aimHere);
  $("aimPill").addEventListener("click", aimHere);
  $("calBtn").addEventListener("click", function () {
    if (!cs.got) return;
    var sun = S.sunPosition(Date.now(), st.place.lat, st.place.lon);
    if (sun.alt < 2) { $("compassRead").textContent = "The sun needs to be up and clear of the horizon to line it up."; return; }
    var rawSmoothed = mod(Math.atan2(cs.vx, cs.vy) / rad, 360);
    cs.offset = signed(sun.az - rawSmoothed);
    save("sunpath_compass_offset", Math.round(cs.offset * 10) / 10);
    feed(cs.raw, cs.acc);
    $("compassRead").textContent = "Lined up with the sun. Your compass was reading " + Math.abs(Math.round(cs.offset)) + "° " + (cs.offset >= 0 ? "left" : "right") + " of true.";
    sound.chime(0);
    track("sunpath_compass_cal");
  });

  // -------------------------------------------------------------- start

  window.addEventListener("resize", function () { sizeCanvases(); updateYear(); schedule(); });
  setInterval(function () {
    if (!st.live || drag) return;
    var t = todayYmd();
    if (!sameYmd(t, st.ymd)) { goNow(false); return; }
    st.tMin = nowMin(D.day);
    timeChanged();
  }, 20000);

  buildBars();
  sizeCanvases();
  st.ymd = todayYmd();
  computeDays();
  st.tMin = nowMin(D.day);
  computeRuns();
  showPlace();
  updateWords();
  draw();
  startLoop();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { schedule(); });

  // test handle for automation only; a visitor's browser never gets it
  if (navigator.webdriver) {
    window.__sunPath = {
      state: function () {
        return { place: st.place, ymd: st.ymd, tMin: st.tMin, live: st.live, mode: st.mode, aim: aimNow(), rot: st.rot,
                 runs: D.runs.map(function (r) { return [r.a, r.b]; }), hours: S.totalMs(D.runs) / HOUR,
                 yearHours: D.yearHours.slice(), sound: sound.on, compassOffset: cs.offset };
      },
      // client coordinates of a sky point, a handle or the sun, for real pointer input
      at: function (az, alt) { var r = dome.getBoundingClientRect(), p = proj(G, az, alt); return { x: r.left + p.x, y: r.top + p.y }; },
      handle: function (which) {
        var r = dome.getBoundingClientRect(), p = which === "sun" ? cache.sun : which === "e1" ? cache.he1 : which === "e2" ? cache.he2 : cache.hc;
        return p ? { x: r.left + p.x, y: r.top + p.y } : null;
      },
      daySample: function (min) { var r = dome.getBoundingClientRect(), p = proj(G, D.day.az[min], D.day.alt[min]); return { x: r.left + p.x, y: r.top + p.y }; },
      audio: function () { return sound.ctx(); }
    };
  }
})();
