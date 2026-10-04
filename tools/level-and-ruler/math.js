/* Level & Ruler — the pure math, shared by the page and the node tests.
 *
 * Conventions used everywhere in here:
 *   - "up" is a vector pointing AWAY from the earth, in g units (1 = 9.80665 m/s²).
 *   - Device frame (from the spec): x to the right of the screen, y to the top of
 *     the screen, z out of the glass toward your face. It does NOT turn with the
 *     page when the screen rotates; toScreen() takes the rotation back out.
 *   - Screen frame: the same axes, but for the page as it is drawn right now.
 *     y is UP here (math), not down (canvas). The drawing code flips it.
 *   - Angles leave this file in degrees.
 */
(function (root) {
  "use strict";

  var G = 9.80665;
  var RAD = Math.PI / 180, DEG = 180 / Math.PI;

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function len3(v) { return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z); }
  function norm3(v) {
    var l = len3(v) || 1;
    return { x: v.x / l, y: v.y / l, z: v.z / l };
  }

  /* devicemotion -> up.
   * The spec says a phone lying face up reports accelerationIncludingGravity
   * z = +9.8 (the push of the table, which points up): sign +1. iPhone Safari
   * still reports gravity itself, z = -9.8: sign -1. The page works the sign out
   * at runtime (see signVote) and only guesses from the platform until then. */
  function upFromAccel(a, sign) {
    return { x: sign * a.x / G, y: sign * a.y / G, z: sign * a.z / G };
  }

  /* deviceorientation -> up. Gravity in the device frame is
   * (cos b sin g, -sin b, -cos b cos g) for the spec's Z-X'-Y'' angles; up is
   * its negative. beta and gamma agree across platforms, which is why they are
   * the referee for the accelerometer's sign. */
  function upFromOrientation(beta, gamma) {
    var b = beta * RAD, g = gamma * RAD;
    return { x: -Math.cos(b) * Math.sin(g), y: Math.sin(b), z: Math.cos(b) * Math.cos(g) };
  }

  /* +1 or -1 when a motion sample and an orientation sample clearly agree or
   * disagree about which way is up, 0 when they are too far apart to say
   * (the phone was moving between the two events). */
  function signVote(accel, beta, gamma) {
    var m = Math.sqrt(accel.x * accel.x + accel.y * accel.y + accel.z * accel.z);
    if (m < 4) return 0;
    var u = upFromOrientation(beta, gamma);
    var d = (accel.x * u.x + accel.y * u.y + accel.z * u.z) / m;
    return d > 0.8 ? 1 : d < -0.8 ? -1 : 0;
  }

  /* Device frame -> screen frame. angle is screen.orientation.angle: 90 means
   * the phone has been turned a quarter counterclockwise (its top to the left). */
  function toScreen(v, angleDeg) {
    var a = (angleDeg || 0) * RAD, c = Math.cos(a), s = Math.sin(a);
    var x = v.x * c - v.y * s, y = v.x * s + v.y * c;
    // tidy the float dust off exact quarter turns so tests read cleanly
    if (Math.abs(x) < 1e-12) x = 0;
    if (Math.abs(y) < 1e-12) y = 0;
    return { x: x, y: y, z: v.z };
  }

  /* ---------------------------------------------------------------- modes */

  /* How far the screen is from lying flat, in degrees (0 flat, 90 on edge). */
  function tiltFromFlat(us) {
    var u = norm3(us);
    return Math.acos(clamp(Math.abs(u.z), 0, 1)) * DEG;
  }

  /* Surface below 40 degrees, Edge above 50, and in between it keeps whatever
   * it was, so a phone held at 45 does not flicker between the two. */
  function classifyMode(us, prev) {
    var t = tiltFromFlat(us);
    if (prev === "surface") return t > 50 ? "edge" : "surface";
    if (prev === "edge") return t < 40 ? "surface" : "edge";
    return t < 45 ? "surface" : "edge";
  }

  /* The up vector seen by someone whose "down" is screen edge q:
   * 0 bottom, 1 right, 2 top, 3 left. In that frame +y is up, +x is their right. */
  function frameUp(us, q) {
    switch (q) {
      case 1: return { x: us.y, y: -us.x };
      case 2: return { x: -us.x, y: -us.y };
      case 3: return { x: -us.y, y: us.x };
      default: return { x: us.x, y: us.y };
    }
  }

  /* Which edge is down. The edge angle runs out to ±45 before another edge is
   * closer, so it switches only past 45 + 8 degrees (no flicker at a diagonal). */
  function pickQuadrant(us, prev) {
    function off(q) { var f = frameUp(us, q); return Math.abs(Math.atan2(f.x, f.y)) * DEG; }
    var best = 0, bestOff = 999;
    for (var q = 0; q < 4; q++) { var o = off(q); if (o < bestOff) { bestOff = o; best = q; } }
    if (prev === 0 || prev === 1 || prev === 2 || prev === 3) {
      if (off(prev) <= 53) return prev;
    }
    return best;
  }

  /* Edge reading: the slope of the edge the phone is standing on, positive when
   * the right-hand end (in the viewer's frame) is HIGH. asin, not atan2, so a
   * phone leaning back against the wall still reads the edge's true slope. */
  function edgeAngle(us, q) {
    var u = norm3(us);
    var f = frameUp(u, q);
    return Math.asin(clamp(f.x, -1, 1)) * DEG;
  }

  /* Surface reading: how far each screen axis rises above the horizontal.
   * x > 0: the right side is high. y > 0: the top is high. */
  function surfaceTilt(us) {
    var u = norm3(us);
    var x = Math.asin(clamp(u.x, -1, 1)) * DEG;
    var y = Math.asin(clamp(u.y, -1, 1)) * DEG;
    var total = Math.acos(clamp(u.z, -1, 1)) * DEG;
    return { x: x, y: y, total: total };
  }

  /* --------------------------------------------------------- bubble + vial */

  /* Where the bubble sits for a tilt, as a fraction of its travel (-1..1).
   * A real vial is a circular arc, so the bubble moves in step with the angle
   * until it hits the end. tanh keeps that straight line near zero (0.1 degree
   * is a visible nudge) and lets it ease into the ends instead of slamming. */
  function bubbleMap(deg, scale) {
    return Math.tanh(deg / (scale || 4));
  }
  function bubbleUnmap(frac, scale) {
    var f = clamp(frac, -0.999999, 0.999999);
    return 0.5 * Math.log((1 + f) / (1 - f)) * (scale || 4);
  }

  /* Spring-damper step for the bubble, so it lags and settles like a bubble in
   * spirit rather than snapping. State {p, v}; returns the new state. */
  function springStep(s, target, dt, omega, zeta) {
    var a = omega * omega * (target - s.p) - 2 * zeta * omega * s.v;
    var v = s.v + a * dt;
    return { p: s.p + v * dt, v: v };
  }

  /* --------------------------------------------------------- calibration */

  /* The two-position (reversal) method, the way a carpenter checks a level:
   * read it, turn it end for end on the same spot, read it again. Turning it
   * half a turn about the screen's own axis flips the true x and y but not the
   * sensor's error, so the error is the average of the two readings and the
   * surface's real tilt is half their difference. Works flat (spin it on the
   * table) and on edge (stand it on its opposite edge).
   * m1, m2: averaged raw up vectors (g units). Returns null when the second
   * reading does not look like a half turn of the first. */
  function twoPosition(m1, m2, mode) {
    var b = { x: (m1.x + m2.x) / 2, y: (m1.y + m2.y) / 2 };
    var half = { x: (m1.x - m2.x) / 2, y: (m1.y - m2.y) / 2 };
    var bias = Math.sqrt(b.x * b.x + b.y * b.y);
    if (mode === "surface") {
      if (m1.z < 0.8 || m2.z < 0.8) return null;           // not lying flat
    } else {
      var l1 = Math.hypot(m1.x, m1.y), l2 = Math.hypot(m2.x, m2.y);
      if (l1 < 0.7 || l2 < 0.7) return null;                // not standing on an edge
      var dot = (m1.x * m2.x + m1.y * m2.y) / (l1 * l2);
      if (dot > -0.9) return null;                          // not stood on the OPPOSITE edge
    }
    if (bias > 0.06) return null;                           // over ~3.4 degrees: not a half turn
    var surface;
    if (mode === "surface") {
      var sx = Math.asin(clamp(half.x, -1, 1)) * DEG, sy = Math.asin(clamp(half.y, -1, 1)) * DEG;
      surface = { x: sx, y: sy, total: Math.sqrt(sx * sx + sy * sy) };
    } else {
      // corrected first reading, measured along the edge it stood on
      var c = norm3({ x: m1.x - b.x, y: m1.y - b.y, z: m1.z });
      var along = Math.abs(m1.y) > Math.abs(m1.x) ? c.x : c.y;
      var e = Math.asin(clamp(along, -1, 1)) * DEG;
      surface = { x: e, y: 0, total: Math.abs(e) };
    }
    var err = Math.asin(clamp(bias, 0, 1)) * DEG;
    return { bias: b, surface: surface, error: err };
  }

  /* Quick zero: "call this level". It only touches the components that the
   * current reading depends on, and keeps the rest of the stored bias. */
  function quickZero(m, mode, prev) {
    var b = { x: prev ? prev.x : 0, y: prev ? prev.y : 0 };
    if (mode === "surface") { b.x = m.x; b.y = m.y; }
    else if (Math.abs(m.y) >= Math.abs(m.x)) b.x = m.x;     // standing on a short edge
    else b.y = m.y;                                          // standing on a long edge
    return b;
  }

  function applyBias(u, b) {
    if (!b) return u;
    return { x: u.x - b.x, y: u.y - b.y, z: u.z };
  }

  /* ------------------------------------------------------------ filtering */

  /* One Euro filter (Casiez, Roussel, Vogel 2012): a low-pass whose cutoff rises
   * with speed. Held still it averages hard (steady to a tenth of a degree);
   * moved, it follows at once. Exactly what a level wants. t in seconds. */
  function OneEuro(minCutoff, beta, dCutoff) {
    this.minCutoff = minCutoff; this.beta = beta; this.dCutoff = dCutoff || 1;
    this.x = null; this.dx = 0; this.t = null;
  }
  function alphaFor(cutoff, dt) {
    var tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }
  OneEuro.prototype.filter = function (x, t) {
    if (this.x === null || this.t === null) { this.x = x; this.t = t; this.dx = 0; return x; }
    var dt = t - this.t;
    if (!(dt > 0)) dt = 1 / 60;
    if (dt > 0.5) dt = 0.5;
    this.t = t;
    var dx = (x - this.x) / dt;
    this.dx += alphaFor(this.dCutoff, dt) * (dx - this.dx);
    var cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += alphaFor(cutoff, dt) * (x - this.x);
    return this.x;
  };
  OneEuro.prototype.reset = function () { this.x = null; this.t = null; this.dx = 0; };

  /* A tenths readout that does not flicker between neighbors: the shown value
   * only moves once the reading is more than 0.06 away from it. */
  function steadyTenth(raw, shown) {
    if (shown === null || shown === undefined || Math.abs(raw - shown) > 0.06) {
      var r = Math.round(raw * 10) / 10;
      return r === 0 ? 0 : r;                               // no "-0.0"
    }
    return shown;
  }

  /* ------------------------------------------------------- level helpers */

  /* How much to raise the low end over a span, same units as span. */
  function riseOver(span, deg) { return span * Math.tan(Math.abs(deg) * RAD); }

  /* 2 3/8, 1/16, 5 ... to the nearest 1/den inch. "0" under half a step. */
  function fracInches(x, den) {
    den = den || 16;
    var neg = x < 0; x = Math.abs(x);
    var n = Math.round(x * den);
    var whole = Math.floor(n / den), rem = n - whole * den, d = den;
    while (rem && rem % 2 === 0 && d % 2 === 0) { rem /= 2; d /= 2; }
    var s = rem ? (whole ? whole + " " : "") + rem + "/" + d : String(whole);
    return (neg && n ? "-" : "") + s;
  }

  /* ---------------------------------------------------------------- ruler */

  var CARD_MM = { w: 85.60, h: 53.98, r: 3.18 };   // ID-1, every bank card
  var QUARTER_MM = 24.26;                          // US quarter dollar

  /* A ruler is only as good as its pixels-per-millimeter. Before anyone
   * calibrates, guess it. iPhones are a closed list, so their size and pixel
   * ratio pin the panel's density; everything else gets the honest default
   * (Android lays out at about 160 CSS px to the inch, desktops at 96). */
  var IPHONE_PPI = {
    "320x568@2": 163, "375x667@2": 163, "414x736@3": 153.7, "375x812@3": 159,
    "414x896@2": 163, "414x896@3": 152.7, "390x844@3": 153.3, "428x926@3": 152.7,
    "393x852@3": 153.3, "430x932@3": 153.3, "402x874@3": 153.3, "440x956@3": 153.3,
    "420x912@3": 153.3, "360x780@3": 158.7,
    // iPads: 264 ppi at 2x, the minis 326
    "768x1024@2": 132, "810x1080@2": 132, "820x1180@2": 132, "834x1112@2": 132,
    "834x1194@2": 132, "1024x1366@2": 132, "744x1133@2": 163
  };

  function deviceKey(w, h, dpr) {
    var a = Math.round(Math.min(w, h)), b = Math.round(Math.max(w, h));
    return a + "x" + b + "@" + (Math.round(dpr * 100) / 100);
  }

  /* -> { pxPerMm, how: "known" | "phone" | "desktop" } */
  function defaultScale(w, h, dpr, touch, apple) {
    var key = deviceKey(w, h, dpr);
    if (apple && IPHONE_PPI[key]) return { pxPerMm: IPHONE_PPI[key] / 25.4, how: "known" };
    if (touch) return { pxPerMm: 160 / 25.4, how: "phone" };
    return { pxPerMm: 96 / 25.4, how: "desktop" };
  }

  function scaleFromCard(cardLongPx) { return cardLongPx / CARD_MM.w; }
  function scaleFromCoin(diameterPx) { return diameterPx / QUARTER_MM; }

  /* Caliper readout from two jaw positions in CSS px. */
  function measure(aPx, bPx, pxPerMm) {
    var mm = Math.abs(bPx - aPx) / pxPerMm;
    var inches = mm / 25.4;
    return { mm: mm, mmText: mm.toFixed(1), inches: inches, inText: fracInches(inches, 16), inDec: inches.toFixed(2) };
  }

  /* Ruler ticks along a length (px) at a scale, for either system. Each tick is
   * { at (px from zero), rank (0 = biggest), label (or "") }. */
  function ticks(lengthPx, pxPerMm, system) {
    var out = [], i, at;
    if (system === "in") {
      var per = 25.4 * pxPerMm / 16;                  // px per sixteenth
      for (i = 0; (at = i * per) <= lengthPx + 0.5; i++) {
        var rank = i % 16 === 0 ? 0 : i % 8 === 0 ? 1 : i % 4 === 0 ? 2 : i % 2 === 0 ? 3 : 4;
        out.push({ at: at, rank: rank, label: rank === 0 && i ? String(i / 16) : "" });
      }
    } else {
      for (i = 0; (at = i * pxPerMm) <= lengthPx + 0.5; i++) {
        var r = i % 10 === 0 ? 0 : i % 5 === 0 ? 1 : 2;
        out.push({ at: at, rank: r, label: r === 0 && i ? String(i / 10) : "" });
      }
    }
    return out;
  }

  var API = {
    G: G, clamp: clamp, norm3: norm3,
    upFromAccel: upFromAccel, upFromOrientation: upFromOrientation, signVote: signVote,
    toScreen: toScreen, tiltFromFlat: tiltFromFlat, classifyMode: classifyMode,
    frameUp: frameUp, pickQuadrant: pickQuadrant, edgeAngle: edgeAngle, surfaceTilt: surfaceTilt,
    bubbleMap: bubbleMap, bubbleUnmap: bubbleUnmap, springStep: springStep,
    twoPosition: twoPosition, quickZero: quickZero, applyBias: applyBias,
    OneEuro: OneEuro, steadyTenth: steadyTenth, riseOver: riseOver, fracInches: fracInches,
    CARD_MM: CARD_MM, QUARTER_MM: QUARTER_MM, deviceKey: deviceKey, defaultScale: defaultScale,
    scaleFromCard: scaleFromCard, scaleFromCoin: scaleFromCoin, measure: measure, ticks: ticks
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else root.LRMath = API;
})(typeof window !== "undefined" ? window : this);
