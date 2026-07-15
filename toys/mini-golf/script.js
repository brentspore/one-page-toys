/* Mini Golf — an 18-hole sculpted course. Vanilla Canvas 2D.
 * Drag back from the ball to aim + set power, release to putt. Greens are
 * unions of SDF "plates" (rounded rects / circles / capsules) so holes can be
 * doglegs, arenas, rivers and rings; terrain is a height field (gaussian
 * hills + tilt) the ball genuinely rolls on; hazards: sand, water, windmills,
 * mushroom kicker-bumpers, boulders and a culvert tunnel. One sun (NW) lights
 * everything; six palettes pass a full day over the round, ending gold. */
(function () {
  "use strict";

  var canvas = document.getElementById("canvas");
  var ctx = canvas.getContext("2d");
  var holePill = document.getElementById("holePill");
  var strokePill = document.getElementById("strokePill");
  var parPill = document.getElementById("parPill");
  var scorePill = document.getElementById("scorePill");
  var soundBtn = document.getElementById("soundBtn");
  var toast = document.getElementById("toast");
  var hintEl = document.getElementById("hint");
  var holeCard = document.getElementById("holeCard");
  var overlay = document.getElementById("overlay");
  var ovTitle = document.getElementById("ovTitle");
  var ovText = document.getElementById("ovText");
  var ovBtn = document.getElementById("ovBtn");
  var ovBest = document.getElementById("ovBest");

  var W = 0, H = 0, DPR = 1;
  var PRM = false;
  try { PRM = window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) {}

  // ---------- tunables ----------
  var FRICTION = 1.55;         // exp damping per second (felt) — rolls a touch further
  var SAND_FRICTION = 6.8;     // exp damping in sand
  var REST = 0.76;             // wall/wood restitution — livelier banks
  var STOP = 12;               // rest speed
  var HOLD_SLOPE = 55;         // static hold: settle only where slope accel is below this
  var SINK_SPEED = 300;        // arrive slower than this to drop; faster rattles out
  var KICK = 360;              // mushroom bumper minimum exit speed
  var VMAX = 1700;             // full-power putt speed
  var CUP_PULL = 300;          // cup funnel-gravity strength
  var PIN_REST = 0.55;         // flagstick bounce restitution
  var MAXPULL, POWER_SCALE, BR, CUPR, PIN_R;

  // ---------- course state ----------
  var TOTAL_HOLES = 18;
  var plan = null, coursePar = 0, parSoFar = 0;
  var totalStrokes = 0, aces = 0, done = false;
  var hole = 1, strokes = 0, par = 3;
  var cur = null;              // current hole def (plates, hills, hazards, ...)
  var field = null;            // playable bbox (inside the rail)
  var ball = null, cup = null;
  var aiming = false, aimX = 0, aimY = 0;
  var sinking = 0, settled = true, doneSquash = null;
  var soundOn = true;
  var simT = 0;                // per-hole clock (windmill phase)
  var timeScale = 1, slowT = 0;
  var shotStart = null, lastDry = null, dryTick = 0, unsettledT = 0;
  var combo = 0;
  var transit = null;          // culvert transit {t,dur}
  var splashHide = 0, pendingHole = false;
  var cupCross = false, cupHopT = 0;   // ball is rimming/rattling across the cup mouth
  var pinWiggle = 0, pinWigT = 0, pinWigDir = 1;   // flagstick sway after a hit

  // fx
  var confetti = [], drops = [], rings = [], pops = [], chalk = [], motes = [];
  var flashes = [];            // bumper hit flashes

  function rnd(a, b) { return a + Math.random() * (b - a); }
  function dist(ax, ay, bx, by) { return Math.hypot(ax - bx, ay - by); }
  function mulberry(seed) { var t = seed >>> 0; return function () { t += 0x6D2B79F5; var r = Math.imul(t ^ (t >>> 15), 1 | t); r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r; return ((r ^ (r >>> 14)) >>> 0) / 4294967296; }; }

  // ---------- palettes: one sun, a day passing over 18 holes ----------
  var PALS = {
    dawn:  { fl: "#96cf78", fs: "#63a457", r1: "#45543a", r2: "#26301d", sky: "rgba(255,158,110,0.34)", flag: "#ff8f7a", accent: "#ffab76", mote: "255,210,160", stars: false },
    noon:  { fl: "#3fbf74", fs: "#279a5b", r1: "#0f522d", r2: "#0a3a1f", sky: "rgba(170,230,255,0.14)", flag: "#e5484d", accent: "#4fc3f7", mote: "235,255,245", stars: false },
    aft:   { fl: "#8fca6d", fs: "#61a651", r1: "#2f4f23", r2: "#20391a", sky: "rgba(255,212,110,0.14)", flag: "#f0a92e", accent: "#ffd76a", mote: "255,240,190", stars: false },
    dusk:  { fl: "#37a077", fs: "#20745a", r1: "#123742", r2: "#0a222b", sky: "rgba(255,118,150,0.12)", flag: "#ff5470", accent: "#38e5d8", mote: "160,245,255", stars: false },
    night: { fl: "#3f815f", fs: "#295c45", r1: "#0b1330", r2: "#060b1a", sky: "rgba(96,124,255,0.10)", flag: "#cdd7f2", accent: "#a5b4fc", mote: "255,229,138", stars: true },
    gold:  { fl: "#79b453", fs: "#4f8f3e", r1: "#2f381a", r2: "#1a220d", sky: "rgba(255,196,64,0.24)", flag: "#ffd76a", accent: "#ffd76a", mote: "255,224,150", stars: false }
  };
  function pal() { return PALS[cur ? cur.pal : "noon"]; }

  // ---------- layout ----------
  var along = true; // long axis horizontal?
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.floor(W * DPR); canvas.height = Math.floor(H * DPR);
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    var inset = Math.max(30, Math.min(W, H) * 0.065);
    var topPad = Math.max(70, H * 0.1);
    field = { x: inset, y: topPad, w: W - inset * 2, h: H - topPad - inset * 1.1 };
    along = field.w >= field.h;
    BR = Math.max(8.5, Math.min(W, H) * 0.0135);
    CUPR = BR * 1.42;          // tighter hole — precision matters more
    PIN_R = BR * 0.4;          // flagstick base the ball bounces off
    MAXPULL = Math.min(W, H) * 0.30;
    POWER_SCALE = VMAX / MAXPULL;
  }
  // Rebuild on resize, preserving the ball's relative lie (a bare rebuild
  // teleported it back to the tee); debounced — buildScene is expensive.
  var resizeT = null, resizeKeep = null;
  window.addEventListener("resize", function () {
    if (!plan || !field || pendingHole) { resize(); return; }
    if (!resizeKeep && ball) resizeKeep = { fx: (ball.x - field.x) / field.w, fy: (ball.y - field.y) / field.h, strokes: strokes };
    clearTimeout(resizeT);
    resizeT = setTimeout(function () {
      var keep = resizeKeep; resizeKeep = null;
      resize();
      if (done) return;
      buildHole(hole);
      if (keep) {
        strokes = keep.strokes;
        var bx = field.x + keep.fx * field.w, by = field.y + keep.fy * field.h;
        if (greenSD(bx, by) < -BR) { ball.x = bx; ball.y = by; }
        lastDry = { x: ball.x, y: ball.y }; shotStart = { x: ball.x, y: ball.y };
        updateHud();
      }
    }, 140);
  });

  // template space: u along the long axis (0..1), v across (0..1); radii are cross-dim fractions
  // mirrorV flips the cross axis so a back-nine reprise of a template reads as
  // a new hole rather than a verbatim repeat.
  var mirrorV = false;
  function LONG() { return along ? field.w : field.h; }
  function CROSS() { return along ? field.h : field.w; }
  function P(u, v) {
    if (mirrorV) v = 1 - v;
    return along ? { x: field.x + u * field.w, y: field.y + v * field.h }
                 : { x: field.x + v * field.w, y: field.y + u * field.h };
  }
  function S(f) { return f * CROSS(); }

  // plate builders (world coords)
  function rrUV(u0, v0, u1, v1, r) { // rounded rect from corner to corner in uv
    // normalize AFTER mapping — mirrorV flips v, which would invert a
    // pre-sorted corner pair into a negative-height rect
    var a = P(u0, v0), b = P(u1, v1);
    return { t: "rr", x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y), r: S(r || 0.06) };
  }
  function cUV(u, v, rf) { var p = P(u, v); return { t: "c", x: p.x, y: p.y, r: S(rf) }; }
  function capUV(u0, v0, u1, v1, rf) { var a = P(u0, v0), b = P(u1, v1); return { t: "cap", x1: a.x, y1: a.y, x2: b.x, y2: b.y, r: S(rf) }; }

  // ---------- SDF ----------
  function sdShape(s, x, y) {
    if (s.t === "c") return dist(x, y, s.x, s.y) - s.r;
    if (s.t === "rr") {
      var qx = Math.abs(x - (s.x + s.w / 2)) - (s.w / 2 - s.r), qy = Math.abs(y - (s.y + s.h / 2)) - (s.h / 2 - s.r);
      var ax = Math.max(qx, 0), ay = Math.max(qy, 0);
      return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - s.r;
    }
    // capsule
    var dx = s.x2 - s.x1, dy = s.y2 - s.y1;
    var t = ((x - s.x1) * dx + (y - s.y1) * dy) / (dx * dx + dy * dy || 1);
    t = Math.max(0, Math.min(1, t));
    return dist(x, y, s.x1 + dx * t, s.y1 + dy * t) - s.r;
  }
  function sdList(list, x, y) {
    var d = 1e9;
    for (var i = 0; i < list.length; i++) { var s = sdShape(list[i], x, y); if (s < d) d = s; }
    return d;
  }
  function greenSD(x, y) { return sdList(cur.plates, x, y); }
  function greenGrad(x, y) {
    var e = 0.8;
    var gx = greenSD(x + e, y) - greenSD(x - e, y), gy = greenSD(x, y + e) - greenSD(x, y - e);
    var m = Math.hypot(gx, gy) || 1;
    return { x: gx / m, y: gy / m };
  }
  function inList(list, x, y, pad) { return list.length ? sdList(list, x, y) < (pad || 0) : false; }

  // ---------- terrain (height field) ----------
  // hills: {x,y,r,s} — s = peak accel px/s² (+mound repels, −bowl attracts). tilt: {x,y} accel.
  function slopeAt(x, y) {
    var ax = cur.tilt.x, ay = cur.tilt.y;
    for (var i = 0; i < cur.hills.length; i++) {
      var h = cur.hills[i];
      var dx = x - h.x, dy = y - h.y, d = Math.hypot(dx, dy);
      if (d > h.r * 3.2 || d < 0.001) continue;
      var q = d / h.r;
      var m = h.s * q * Math.exp(0.5 - 0.5 * q * q); // peaks at q=1 with value s
      ax += (dx / d) * m; ay += (dy / d) * m;
    }
    return { x: ax, y: ay };
  }

  // ---------- hole templates ----------
  // Each returns {name, par, plates, hills, tilt, sand, water, bridges, woods, posts, mills, tunnel, ballStart, cupPos}
  function alongTilt(mag) { var a = P(0, 0), b = P(1, 0); var dx = b.x - a.x, dy = b.y - a.y, m = Math.hypot(dx, dy); return { x: dx / m * mag, y: dy / m * mag }; }

  var TPL = {
    firstlight: function (R) {
      var vy = 0.5 + (R() - 0.5) * 0.16;
      var cupP = P(0.84, vy);
      return {
        name: "First Light", par: 2,
        plates: [capUV(0.09, 0.5, 0.91, vy, 0.19)],
        hills: [{ x: cupP.x, y: cupP.y, r: S(0.16), s: -70 }],
        tilt: alongTilt(22),
        sand: [], water: [], bridges: [], woods: [], posts: [], mills: [], tunnel: null,
        ballStart: P(0.12, 0.5), cupPos: cupP
      };
    },
    fairway: function (R) {
      // explicit wall thickness — unclamped random ranges once emitted a
      // 4px "toothpick" wall that read as a rendering glitch
      var u1 = 0.32 + R() * 0.08, u2 = 0.58 + R() * 0.06;
      var w1 = { s: rrUV(u1, 0.14, u1 + 0.045 + R() * 0.03, 0.46, 0.02) };
      var w2 = { s: rrUV(u2, 0.56, u2 + 0.045 + R() * 0.03, 0.88, 0.02) };
      return {
        name: "The Fairway", par: 3,
        plates: [rrUV(0.05, 0.12, 0.95, 0.88, 0.09)],
        hills: [{ x: P(0.5, 0.5).x, y: P(0.5, 0.5).y, r: S(0.34), s: 26 }],
        tilt: alongTilt(16),
        sand: [], water: [], bridges: [], woods: [w1.s, w2.s], posts: [], mills: [], tunnel: null,
        ballStart: P(0.11, 0.3 + R() * 0.4), cupPos: P(0.88, 0.26 + R() * 0.48)
      };
    },
    terraces: function (R) {
      var elbow = P(0.62, 0.42);
      return {
        name: "Twin Terraces", par: 3,
        // elbow circle spans v 0.22–0.62 → real overlap with BOTH terraces
        // (a narrower throat than the ball diameter sealed the cup off once)
        plates: [rrUV(0.05, 0.1, 0.62, 0.5, 0.08), cUV(0.62, 0.42, 0.2), rrUV(0.58, 0.44, 0.95, 0.9, 0.08)],
        hills: [{ x: elbow.x, y: elbow.y, r: S(0.17), s: -85 }],
        tilt: alongTilt(20),
        sand: [capUV(0.66, 0.58, 0.74, 0.66, 0.045)],
        water: [], bridges: [], woods: [], posts: [], mills: [], tunnel: null,
        ballStart: P(0.11, 0.3), cupPos: P(0.88, 0.7 + R() * 0.1)
      };
    },
    ridge: function (R) {
      var rv = 0.34 + R() * 0.3;
      return {
        name: "The Ridge", par: 3,
        plates: [rrUV(0.05, 0.12, 0.95, 0.88, 0.09)],
        hills: [
          { x: P(0.5, 0.22).x, y: P(0.5, 0.22).y, r: S(0.2), s: 175 },
          { x: P(0.5, 0.62).x, y: P(0.5, 0.62).y, r: S(0.2), s: 175 },
          { x: P(0.88, rv).x, y: P(0.88, rv).y, r: S(0.12), s: -60 }
        ],
        tilt: { x: 0, y: 0 },
        sand: [], water: [], bridges: [], woods: [], posts: [], mills: [], tunnel: null,
        ballStart: P(0.11, 0.3 + R() * 0.4), cupPos: P(0.88, rv)
      };
    },
    dunes: function (R) {
      return {
        name: "The Dunes", par: 3,
        plates: [rrUV(0.05, 0.1, 0.95, 0.9, 0.09)],
        hills: [{ x: P(0.66, 0.5).x, y: P(0.66, 0.5).y, r: S(0.3), s: 22 }],
        tilt: alongTilt(14),
        sand: [cUV(0.38, 0.3 + R() * 0.12, 0.11), cUV(0.56, 0.66, 0.13), capUV(0.72, 0.24, 0.8, 0.36, 0.06)],
        water: [], bridges: [], woods: [], posts: [], mills: [], tunnel: null,
        ballStart: P(0.1, 0.5), cupPos: P(0.89, 0.44 + R() * 0.16)
      };
    },
    puttmore: function (R) {
      var c = P(0.64, 0.5);
      return {
        name: "Mount Puttmore", par: 3,
        plates: [capUV(0.07, 0.5, 0.64, 0.5, 0.15), cUV(0.64, 0.5, 0.42)],
        hills: [
          { x: c.x, y: c.y, r: S(0.155), s: 235 },              // the mountain
          { x: c.x, y: c.y, r: S(0.045), s: -150 },             // crater at the summit
          { x: c.x, y: c.y, r: S(0.36), s: -26 }                // gutter moat gathers failures
        ],
        tilt: { x: 0, y: 0 },
        sand: [], water: [], bridges: [], woods: [],
        posts: [
          { kind: "shroom", s: cUV(0.64 + 0.24, 0.5, 0.032) },
          { kind: "shroom", s: cUV(0.64 - 0.12, 0.5 - 0.21, 0.032) },
          { kind: "shroom", s: cUV(0.64 - 0.12, 0.5 + 0.21, 0.032) }
        ],
        mills: [], tunnel: null,
        ballStart: P(0.1, 0.5), cupPos: c
      };
    },
    rapids: function (R) {
      var vA = 0.26, vB = 0.74;
      return {
        name: "The Rapids", par: 4,
        plates: [
          capUV(0.06, vA, 0.42, vA, 0.14), cUV(0.46, vA, 0.17),
          capUV(0.46, vA, 0.58, vB, 0.13), cUV(0.58, vB, 0.17),
          capUV(0.58, vB, 0.94, vB, 0.14)
        ],
        hills: [{ x: P(0.46, vA).x, y: P(0.46, vA).y, r: S(0.15), s: -55 }, { x: P(0.58, vB).x, y: P(0.58, vB).y, r: S(0.15), s: -55 }],
        tilt: alongTilt(24),
        sand: [], water: [], bridges: [], woods: [],
        posts: [
          { kind: "shroom", s: cUV(0.35, vA + 0.13, 0.028) },
          { kind: "shroom", s: cUV(0.52, 0.5, 0.028) },
          { kind: "shroom", s: cUV(0.7, vB - 0.13, 0.028) }
        ],
        mills: [], tunnel: null,
        ballStart: P(0.1, vA), cupPos: P(0.9, vB)
      };
    },
    bridge: function (R) {
      var bv = 0.5 + (R() - 0.5) * 0.1;
      var bridge = capUV(0.4, bv, 0.6, bv, 0.052);
      return {
        name: "Splash Bridge", par: 3,
        plates: [rrUV(0.05, 0.12, 0.42, 0.88, 0.09), rrUV(0.58, 0.12, 0.95, 0.88, 0.09), bridge],
        hills: [
          { x: P(0.5, bv).x, y: P(0.5, bv).y, r: S(0.09), s: 60 } // crowned bridge spine
        ],
        tilt: alongTilt(16),
        sand: [],
        water: [rrUV(0.4, 0.06, 0.6, 0.94, 0.1)],
        bridges: [bridge],
        woods: [], posts: [], mills: [], tunnel: null,
        ballStart: P(0.1, 0.5), cupPos: P(0.89, 0.3 + R() * 0.4)
      };
    },
    windmill: function (R) {
      var mid = P(0.52, 0.5);
      return {
        name: "The Windmill", par: 3,
        plates: [capUV(0.07, 0.5, 0.52, 0.5, 0.15), cUV(0.52, 0.5, 0.24), capUV(0.52, 0.5, 0.93, 0.5, 0.13)],
        hills: [{ x: P(0.32, 0.5).x, y: P(0.32, 0.5).y, r: S(0.12), s: -55 }],
        tilt: alongTilt(-14),                                   // drifts rejected balls back to the bowl
        sand: [], water: [], bridges: [], woods: [],
        posts: [
          { kind: "boulder", s: cUV(0.52, 0.5 - 0.2, 0.05) },
          { kind: "boulder", s: cUV(0.52, 0.5 + 0.2, 0.05) }
        ],
        mills: [{ x: mid.x, y: mid.y, hub: S(0.035), len: S(0.16), bw: S(0.03), omega: 1.6, phase: R() * 6.28, blades: 2 }],
        tunnel: null,
        ballStart: P(0.1, 0.5), cupPos: P(0.88, 0.5)
      };
    },
    oxbow: function (R) {
      var c = P(0.52, 0.5), RING = S(0.3), TUBE = S(0.105);
      var plates = [];
      for (var i = 0; i < 20; i++) {
        var a1 = (i / 20) * 6.283, a2 = ((i + 1) / 20) * 6.283;
        plates.push({ t: "cap", x1: c.x + Math.cos(a1) * RING, y1: c.y + Math.sin(a1) * RING, x2: c.x + Math.cos(a2) * RING, y2: c.y + Math.sin(a2) * RING, r: TUBE });
      }
      var teeA = 2.35, cupA = -0.78; // opposite sides of the ring
      return {
        name: "The Oxbow", par: 3,
        plates: plates,
        hills: [{ x: c.x, y: c.y, r: RING * 1.05, s: -40 }],    // gentle pull toward the pond lip
        tilt: { x: 0, y: 0 },
        sand: [], bridges: [], woods: [], posts: [], mills: [], tunnel: null,
        water: [{ t: "c", x: c.x, y: c.y, r: RING - TUBE + BR * 0.6 }],
        ballStart: { x: c.x + Math.cos(teeA) * RING, y: c.y + Math.sin(teeA) * RING },
        cupPos: { x: c.x + Math.cos(cupA) * RING, y: c.y + Math.sin(cupA) * RING }
      };
    },
    pinball: function (R) {
      var posts = [];
      var ring = [[0.5, 0.34], [0.62, 0.6], [0.42, 0.66], [0.68, 0.3], [0.33, 0.4]];
      for (var i = 0; i < ring.length; i++) posts.push({ kind: "shroom", s: cUV(ring[i][0] + (R() - 0.5) * 0.04, ring[i][1] + (R() - 0.5) * 0.06, 0.03) });
      return {
        name: "Bumper Grove", par: 3,
        // both necks overlap the arena deeply — a tangent join seals at phone scale
        plates: [capUV(0.06, 0.5, 0.52, 0.5, 0.13), cUV(0.52, 0.5, 0.4), capUV(0.52, 0.5, 0.93, 0.5, 0.12)],
        hills: [{ x: P(0.9, 0.5).x, y: P(0.9, 0.5).y, r: S(0.1), s: -55 }],
        tilt: alongTilt(15),
        sand: [], water: [], bridges: [], woods: [], posts: posts, mills: [], tunnel: null,
        ballStart: P(0.09, 0.5), cupPos: P(0.9, 0.5)
      };
    },
    culvert: function (R) {
      var inMouth = P(0.42, 0.36), outMouth = P(0.72, 0.62);
      var exitDir = along ? { x: 1, y: 0.35 } : { x: 0.35, y: 1 };
      var m = Math.hypot(exitDir.x, exitDir.y); exitDir.x /= m; exitDir.y /= m;
      return {
        name: "The Old Culvert", par: 3,
        // generous elbow overlap — the corner route must be a real alternative
        // to the pipe on every screen size, not an invisible keyhole
        plates: [rrUV(0.05, 0.1, 0.66, 0.5, 0.08), cUV(0.66, 0.4, 0.21), rrUV(0.56, 0.42, 0.95, 0.9, 0.08)],
        hills: [],
        tilt: alongTilt(15),
        sand: [cUV(0.62, 0.62, 0.06)],
        water: [], bridges: [], woods: [], posts: [], mills: [],
        tunnel: { ax: inMouth.x, ay: inMouth.y, bx: outMouth.x, by: outMouth.y, dx: exitDir.x, dy: exitDir.y, r: BR * 1.7 },
        ballStart: P(0.1, 0.26), cupPos: P(0.89, 0.74)
      };
    },
    finale: function (R) {
      var summit = P(0.85, 0.5);
      return {
        name: "The Gilded Summit", par: 5, gold: true,
        plates: [
          cUV(0.09, 0.5, 0.16),
          rrUV(0.09, 0.2, 0.5, 0.8, 0.1),
          // wide mill reach: the clear lane past the blades must run the whole
          // segment, or the upstream walls funnel every shot into the sweep
          capUV(0.5, 0.5, 0.7, 0.5, 0.22),
          capUV(0.7, 0.5, 0.85, 0.5, 0.09),
          cUV(0.85, 0.5, 0.2)
        ],
        hills: [
          { x: summit.x, y: summit.y, r: S(0.16), s: 250 },
          { x: summit.x, y: summit.y, r: S(0.05), s: -160 },
          { x: P(0.7, 0.5).x, y: P(0.7, 0.5).y, r: S(0.14), s: -45 }
        ],
        tilt: alongTilt(14),
        sand: [capUV(0.3, 0.28, 0.38, 0.36, 0.05), capUV(0.36, 0.64, 0.44, 0.72, 0.05)],
        water: [], bridges: [], woods: [],
        posts: [],
        // 2 blades + slower sweep: the gate opens generously between passes —
        // the 3-blade fast version made the course a ~3% lottery (unfinishable)
        mills: [{ x: P(0.6, 0.5).x, y: P(0.6, 0.5).y, hub: S(0.032), len: S(0.095), bw: S(0.026), omega: 0.7, phase: R() * 6.28, blades: 2, gold: true }],
        tunnel: null,
        ballStart: P(0.08, 0.5), cupPos: summit
      };
    }
  };

  // A fresh 18-hole course every day: the local date seeds the whole plan, so
  // every player gets the same course today and a different one tomorrow.
  // Difficulty ramps (gentle opener → hard back nine) and the sun crosses the
  // sky by slot; repeats of a template are mirrored + renamed so no two holes
  // read the same.
  var SLOT_PAL = ["dawn", "dawn", "dawn", "noon", "noon", "noon", "noon", "aft", "aft", "aft", "aft", "dusk", "dusk", "dusk", "night", "night", "night", "gold"];
  var TIERS =    ["open", "easy", "easy", "med",  "easy", "med",  "med",  "hard", "med", "hard", "med", "hard", "med",  "hard", "hard", "med",   "hard",  "fin"];
  // Pools overlap on purpose: the dry terrain/obstacle holes appear across easy→hard
  // so difficulty isn't a synonym for "water hazard." Selection (below) then spreads
  // every hole type across the round so no template dominates.
  var POOL = {
    open: ["firstlight"],
    easy: ["fairway", "dunes", "pinball", "ridge"],
    med:  ["terraces", "ridge", "oxbow", "puttmore", "dunes", "windmill"],
    hard: ["rapids", "windmill", "culvert", "bridge", "terraces", "puttmore", "ridge", "pinball", "dunes"],
    fin:  ["finale"]
  };
  var REPRISE = {
    fairway: ["The Long Fairway", "Home Straight"], dunes: ["Windswept Flats", "The Sahara"],
    pinball: ["Firefly Grove", "Bumper Alley"], terraces: ["The Switchback", "Stepped Descent"],
    ridge: ["The Divide", "Rolling Break"], oxbow: ["Moon Pond", "The Lagoon"],
    puttmore: ["Moonrise Summit", "The Anthill"], rapids: ["The Undertow", "Whitewater"],
    windmill: ["The Night Mill", "Old Sails"], culvert: ["The Underpass", "Storm Drain"],
    bridge: ["Moonlit Crossing", "The Ford"]
  };
  // Water-hazard holes are kept a scattered minority (never back-to-back, at most a
  // few per round) so the course doesn't read as "the water one over and over."
  var WATER = { oxbow: 1, rapids: 1, culvert: 1, bridge: 1 };
  var WATER_CAP = 5;

  var dayOverride = 0;
  function todayNum() {
    if (dayOverride) return dayOverride;
    var d = new Date();
    return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  }
  function dayLabel() {
    try {
      var d = dayOverride ? new Date(Math.floor(dayOverride / 10000), (Math.floor(dayOverride / 100) % 100) - 1, dayOverride % 100) : new Date();
      return d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
    } catch (e) { return "Today"; }
  }

  function buildPlan() {
    resize();
    var R = mulberry((todayNum() ^ 0x9e3779b9) >>> 0);
    var used = {}, waterCount = 0;
    plan = [];
    for (var i = 0; i < 18; i++) {
      var pool = POOL[TIERS[i]].slice();
      var prev = i > 0 ? plan[i - 1].tpl : null;
      var prevWater = i > 0 && WATER[prev];
      // deterministic per-day shuffle so equal-score ties break differently each day
      for (var sh = pool.length - 1; sh > 0; sh--) { var kk = (R() * (sh + 1)) | 0, tmp = pool[sh]; pool[sh] = pool[kk]; pool[kk] = tmp; }
      // pick the least-used template in this tier, penalising an adjacent repeat,
      // back-to-back water, or blowing the water cap — this spreads all ~13 hole
      // types across the round and keeps water a scattered minority
      var tpl = pool[0], bestScore = Infinity;
      for (var c = 0; c < pool.length; c++) {
        var t = pool[c], u = used[t] || 0, score = u * 10;
        if (u >= 2) score += 300;                          // strongly avoid a 3rd appearance
        if (t === prev) score += 1000;                     // never repeat adjacent
        if (WATER[t] && prevWater) score += 100;           // no back-to-back water
        if (WATER[t] && waterCount >= WATER_CAP) score += 500; // cap total water
        if (score < bestScore) { bestScore = score; tpl = t; }
      }
      var n = used[tpl] || 0; used[tpl] = n + 1;
      if (WATER[tpl]) waterCount++;
      var name = null, flip = false;
      if (n > 0) { flip = (n % 2 === 1); var rl = REPRISE[tpl]; name = rl ? rl[(n - 1) % rl.length] : null; }
      plan.push({ tpl: tpl, pal: SLOT_PAL[i], name: name, flip: flip, seed: (R() * 1e9) | 0 });
    }
    coursePar = 0;
    for (var j = 0; j < plan.length; j++) {
      var RR = mulberry(plan[j].seed);
      var def = TPL[plan[j].tpl](RR);
      plan[j].par = def.par;
      coursePar += def.par;
    }
  }

  function buildHole(idx) {
    var p = plan[idx - 1];
    var R = mulberry(p.seed);
    mirrorV = p.flip;
    cur = TPL[p.tpl](R);
    mirrorV = false;
    cur.pal = p.pal;
    if (p.name) cur.name = p.name;
    par = cur.par;
    cup = { x: cur.cupPos.x, y: cur.cupPos.y };
    ball = { x: cur.ballStart.x, y: cur.ballStart.y, vx: 0, vy: 0 };
    // containment: every post must sit fully on the felt (scattered ones
    // occasionally landed on the rail — reads as a misplaced prop)
    for (var pi = cur.posts.length - 1; pi >= 0; pi--) {
      var ps = cur.posts[pi].s, tries = 0;
      while (tries++ < 12) {
        var psd = greenSD(ps.x, ps.y);
        if (psd <= -(ps.r + 5)) break;
        var pg2 = greenGrad(ps.x, ps.y);
        ps.x -= pg2.x * (psd + ps.r + 6); ps.y -= pg2.y * (psd + ps.r + 6);
      }
      if (greenSD(ps.x, ps.y) > -(ps.r + 3) || dist(ps.x, ps.y, cup.x, cup.y) < CUPR * 3) cur.posts.splice(pi, 1);
    }
    lastDry = { x: ball.x, y: ball.y };
    shotStart = { x: ball.x, y: ball.y };
    simT = 0; combo = 0; transit = null; splashHide = 0; cupCross = false; cupHopT = 0;
    chalk.length = 0; drops.length = 0; rings.length = 0; flashes.length = 0;
    strokes = 0; sinking = 0; settled = true; aiming = false;
    seedMotes();
    updateHud();
    buildScene();
    marks.width = scene.width; marks.height = scene.height; // clear sand grooves
  }

  function showHoleCard(html, ms) {
    holeCard.innerHTML = html;
    holeCard.classList.add("show");
    clearTimeout(showHoleCard._t);
    showHoleCard._t = setTimeout(function () { holeCard.classList.remove("show"); }, ms || 2000);
  }
  function newHole() {
    resize();
    buildHole(hole);
    if (hole === 1) {
      showHoleCard(
        '<span class="hc-eyebrow">Daily Course</span>' +
        '<div class="hc-title hc-title--date">' + dayLabel() + '</div>' +
        '<div class="hc-meta"><b>18</b> Holes &nbsp;·&nbsp; Par <b>' + coursePar + '</b></div>' +
        '<div class="hc-foot">Hole 1 · <b>' + cur.name + '</b> · Par ' + par + '</div>', 3200);
    } else if (hole === TOTAL_HOLES) {
      showHoleCard(
        '<span class="hc-eyebrow hc-eyebrow--finale">⛳ The Final Hole</span>' +
        '<div class="hc-title">' + cur.name + '</div>' +
        '<div class="hc-par">Par <b>' + par + '</b></div>', 2600);
    } else {
      showHoleCard(
        '<span class="hc-eyebrow">Hole ' + hole + ' of ' + TOTAL_HOLES + '</span>' +
        '<div class="hc-title">' + cur.name + '</div>' +
        '<div class="hc-par">Par <b>' + par + '</b></div>', 2000);
    }
  }

  function updateHud() {
    holePill.textContent = "Hole " + hole + " / " + TOTAL_HOLES;
    strokePill.textContent = "Strokes " + strokes;
    parPill.textContent = "Par " + par;
    var d = totalStrokes - parSoFar;
    scorePill.textContent = "Total " + (parSoFar === 0 ? "–" : (d === 0 ? "E" : (d > 0 ? "+" + d : String(d))));
  }

  function showToast(msg, ms) {
    toast.textContent = msg; toast.hidden = false;
    requestAnimationFrame(function () { toast.classList.add("show"); });
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () { toast.classList.remove("show"); setTimeout(function () { toast.hidden = true; }, 240); }, ms || 1500);
  }
  function stamp(x, y, txt, color) {
    pops.push({ x: x, y: y, txt: txt, t: 0, rot: rnd(-0.12, 0.12), color: color || "#ffffff" });
  }

  // ---------- input ----------
  function evt(e) { var r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  var aimId = null;
  function onDown(e) {
    unlock();
    if (!settled || sinking || done || transit || splashHide > 0 || pendingHole || aiming) return;
    var p = evt(e); aimId = e.pointerId;
    aiming = true; aimX = p.x; aimY = p.y;
  }
  function onMove(e) { if (!aiming || e.pointerId !== aimId) return; var p = evt(e); aimX = p.x; aimY = p.y; }
  function onUp(e) {
    if (!aiming || (e && e.pointerId !== aimId)) return; aiming = false; aimId = null;
    var dx = ball.x - aimX, dy = ball.y - aimY;
    var pull = Math.min(Math.hypot(dx, dy), MAXPULL);
    if (pull < BR * 0.6) return;
    var a = Math.atan2(dy, dx);
    var power = pull * POWER_SCALE * (inList(cur.sand, ball.x, ball.y, 0) ? 0.62 : 1);
    shotStart = { x: ball.x, y: ball.y };
    ball.vx = Math.cos(a) * power; ball.vy = Math.sin(a) * power;
    strokes++; settled = false; combo = 0; unsettledT = 0; chalk.length = 0; updateHud();
    sndPutt(pull / MAXPULL);
  }
  canvas.addEventListener("pointerdown", onDown);
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", function () { aiming = false; aimId = null; });
  soundBtn.addEventListener("click", function () {
    soundOn = !soundOn; soundBtn.setAttribute("aria-pressed", soundOn ? "true" : "false");
    if (outGain) outGain.gain.value = soundOn ? 1 : 0; unlock();
  });
  ovBtn.addEventListener("click", playAgain);

  // ---------- physics ----------
  var chalkTick = 0;
  function step(dt) {
    simT += dt;
    if (slowT > 0) { slowT -= dt; if (slowT <= 0) timeScale = 1; }
    if (splashHide > 0) { splashHide -= dt; if (splashHide <= 0) { settled = true; } return; }
    if (transit) {
      transit.t += dt;
      if (transit.t >= transit.dur) {
        var tn = cur.tunnel;
        ball.x = tn.bx + tn.dx * (tn.r + BR + 2); ball.y = tn.by + tn.dy * (tn.r + BR + 2);
        var sp = Math.min(transit.speed * 0.85, VMAX * 0.55);
        ball.vx = tn.dx * sp; ball.vy = tn.dy * sp;
        settled = false; unsettledT = 0;
        transit = null; sndTunnel(1);
      }
      return;
    }
    if (sinking > 0) {
      if (sinking < 1) { sinking = Math.min(1, sinking + dt * 3.2); if (sinking >= 1) advance(); }
      return;
    }
    if (settled) {
      // blades still sweep a resting ball
      if (cur && cur.mills.length) {
        for (var mi = 0; mi < cur.mills.length; mi++) collideMill(cur.mills[mi]);
        if (ball.vx !== 0 || ball.vy !== 0) { settled = false; unsettledT = 0; }
      }
      if (settled) return;
    }

    var h = 1 / 240, steps = Math.min(12, Math.ceil(dt / h));
    var sub = dt / steps;
    for (var k = 0; k < steps; k++) {
      if (settled || sinking || transit || splashHide > 0) break;
      substep(sub);
    }

    // chalk trail
    chalkTick -= dt;
    if (chalkTick <= 0 && !settled && Math.hypot(ball.vx, ball.vy) > 40) {
      chalk.push({ x: ball.x, y: ball.y, t: 0 });
      if (chalk.length > 160) chalk.shift();
      chalkTick = 0.028;
    }
  }

  function substep(dt) {
    var inSand = inList(cur.sand, ball.x, ball.y, 0);
    var slope = slopeAt(ball.x, ball.y);
    ball.vx += slope.x * dt; ball.vy += slope.y * dt;
    var damp = Math.exp(-(inSand ? SAND_FRICTION : FRICTION) * dt);
    ball.vx *= damp; ball.vy *= damp;
    ball.x += ball.vx * dt; ball.y += ball.vy * dt;

    if (inSand) stampSand();

    // water first (a pond lip can sit outside the walled green)
    if (cur.water.length && inList(cur.water, ball.x, ball.y, -BR * 0.35) && !inList(cur.bridges, ball.x, ball.y, 0)) { splash(); return; }

    // green walls — except where the green simply ends at water (the ball
    // rolls off the lip and splashes instead of banking)
    var sd = greenSD(ball.x, ball.y);
    if (sd > -BR) {
      var g = greenGrad(ball.x, ball.y);
      var waterEdge = cur.water.length && inList(cur.water, ball.x + g.x * BR * 2, ball.y + g.y * BR * 2, 0);
      if (!waterEdge) {
        ball.x -= g.x * (sd + BR); ball.y -= g.y * (sd + BR);
        var vd = ball.vx * g.x + ball.vy * g.y;
        if (vd > 0) {
          ball.vx = (ball.vx - 2 * vd * g.x) * REST; ball.vy = (ball.vy - 2 * vd * g.y) * REST;
          hitSquash(g.x, g.y); sndWall();
        }
      }
    }

    // wood rects
    for (var i = 0; i < cur.woods.length; i++) collideRect(cur.woods[i]);
    // posts (boulders + mushrooms)
    for (i = 0; i < cur.posts.length; i++) collidePost(cur.posts[i]);
    // windmill blades
    for (i = 0; i < cur.mills.length; i++) collideMill(cur.mills[i]);
    // culvert — a started transit owns the ball until it exits
    if (cur.tunnel) { tryTunnel(); if (transit) return; }

    // ---- the hole: a funnel draws a good lag in; the flagstick (pin) at the
    // center BOUNCES a fast ball off (dead-on → straight back, off-center →
    // ricochets at an angle); the outer rim lets a fast graze SLIDE around the
    // edge and roll on. A slow ball simply nestles in. ----
    var dx = ball.x - cup.x, dy = ball.y - cup.y, d = Math.hypot(dx, dy) || 0.0001;
    var nx = dx / d, ny = dy / d;                 // unit vector cup → ball
    var spd = Math.hypot(ball.vx, ball.vy);
    var reach = CUPR + BR * 1.15;
    if (d < reach) {
      // funnel gravity: curls a well-paced lag toward the hole
      var t = 1 - d / reach;
      ball.vx -= nx * CUP_PULL * (0.4 + 1.4 * t) * dt;
      ball.vy -= ny * CUP_PULL * (0.4 + 1.4 * t) * dt;
      spd = Math.hypot(ball.vx, ball.vy);

      if (spd < SINK_SPEED && d < CUPR) {
        beginSink(); return;                                          // slow + over the cup → drops in
      } else if (d < PIN_R + BR) {
        // strikes the flagstick → bounce off it (reflect about the contact
        // normal). A square hit comes straight back; a glancing hit angles off.
        var vd = ball.vx * nx + ball.vy * ny;                         // + outward, − into the pin
        if (vd < 0) {
          pinWigDir = ball.vx >= 0 ? 1 : -1; pinWiggle = Math.min(1, spd / 650); pinWigT = 0;   // knock the flag
          ball.x = cup.x + nx * (PIN_R + BR + 0.5); ball.y = cup.y + ny * (PIN_R + BR + 0.5);
          ball.vx = (ball.vx - 2 * vd * nx) * PIN_REST;
          ball.vy = (ball.vy - 2 * vd * ny) * PIN_REST;
          cupHopT = 0.1; sndPin(Math.min(1, spd / 900));
        }
      } else if (d < CUPR + BR) {
        // fast graze of the outer rim → hug the edge and slide around it (a
        // smooth redirect, not a bounce), keeping most of the speed
        var vr = ball.vx * nx + ball.vy * ny;
        var impact = spd > 1 ? Math.abs(dx * (ball.vy / spd) - dy * (ball.vx / spd)) : d;
        if (spd >= SINK_SPEED && impact > CUPR * 0.5 && vr < 0) {
          var hold = CUPR + BR * 0.55;
          ball.x = cup.x + nx * hold; ball.y = cup.y + ny * hold;
          ball.vx -= nx * vr; ball.vy -= ny * vr;
          ball.vx *= 0.99; ball.vy *= 0.99;
          if (spd > 220) sndRim(Math.min(1, spd / 900));
        }
      }
    }

    // settle: static hold only where the slope is gentle; after a long
    // unsettled spell, relax the hold so no terrain can trap the ball rolling
    unsettledT += dt;
    spd = Math.hypot(ball.vx, ball.vy);
    var sl2 = slopeAt(ball.x, ball.y);
    var sm = Math.hypot(sl2.x, sl2.y);
    // static friction: gentle slopes hold a slow ball (terminal creep speed is
    // slope/FRICTION, so the threshold must rise with slope or creep never ends)
    if ((spd < STOP + sm * 0.6 && (sm < HOLD_SLOPE || unsettledT > 9)) || (unsettledT > 14 && spd < 90)) {
      ball.vx = 0; ball.vy = 0; settled = true;
      lastDry = { x: ball.x, y: ball.y };
    }

    // track a dry respawn point
    dryTick -= dt;
    if (dryTick <= 0) {
      dryTick = 0.1;
      if (!inList(cur.water, ball.x, ball.y, BR) && greenSD(ball.x, ball.y) < -BR) lastDry = { x: ball.x, y: ball.y };
    }
  }

  function collideRect(r) {
    var nx = Math.max(r.x, Math.min(ball.x, r.x + r.w));
    var ny = Math.max(r.y, Math.min(ball.y, r.y + r.h));
    var dx = ball.x - nx, dy = ball.y - ny, d2 = dx * dx + dy * dy;
    if (d2 >= BR * BR) return;
    var d = Math.sqrt(d2) || 0.0001;
    var ux = dx / d, uy = dy / d;
    if (d < 0.5) {
      var left = ball.x - r.x, right = r.x + r.w - ball.x, top = ball.y - r.y, bot = r.y + r.h - ball.y;
      var m = Math.min(left, right, top, bot);
      if (m === left) { ux = -1; uy = 0; } else if (m === right) { ux = 1; uy = 0; } else if (m === top) { ux = 0; uy = -1; } else { ux = 0; uy = 1; }
    }
    ball.x = nx + ux * BR; ball.y = ny + uy * BR;
    var vdot = ball.vx * ux + ball.vy * uy;
    if (vdot < 0) { ball.vx = (ball.vx - 2 * vdot * ux) * REST; ball.vy = (ball.vy - 2 * vdot * uy) * REST; hitSquash(ux, uy); sndWall(); }
  }

  function collidePost(post) {
    var s = post.s;
    var d = dist(ball.x, ball.y, s.x, s.y);
    if (d >= BR + s.r) return;
    var ux = (ball.x - s.x) / (d || 1), uy = (ball.y - s.y) / (d || 1);
    ball.x = s.x + ux * (BR + s.r + 0.5); ball.y = s.y + uy * (BR + s.r + 0.5);
    var vdot = ball.vx * ux + ball.vy * uy;
    if (vdot >= 0) return;
    ball.vx -= 2 * vdot * ux; ball.vy -= 2 * vdot * uy;
    if (post.kind === "shroom") {
      var now = simT;
      var sp = Math.hypot(ball.vx, ball.vy);
      // kick only real impacts — a ball nestling against the cap must NOT be
      // pumped forever (bowl + kicker = perpetual-motion softlock)
      if (sp > 120 && (!post.cool || now - post.cool > 0.09)) {
        post.cool = now;
        var out = Math.min(1400, Math.max(sp * 0.85, KICK));
        var m = out / (sp || 1);
        ball.vx *= m; ball.vy *= m;
        combo++;
        flashes.push({ x: s.x, y: s.y, r: s.r, t: 0 });
        if (combo >= 3) stamp(s.x, s.y - s.r - 14, "×" + combo + "!", pal().accent);
        sndBoing(Math.min(1, sp / 1000));
      } else if (sp <= 120) {
        ball.vx *= REST; ball.vy *= REST;
      }
    } else {
      ball.vx *= REST; ball.vy *= REST;
      sndWall();
    }
  }

  function collideMill(mill) {
    for (var b = 0; b < mill.blades; b++) {
      var ang = mill.phase + mill.omega * simT + (b * 6.283 / mill.blades);
      var cx = Math.cos(ang), cy = Math.sin(ang);
      var x2 = mill.x + cx * mill.len, y2 = mill.y + cy * mill.len;
      // capsule from hub to tip
      var dx = x2 - mill.x, dy = y2 - mill.y;
      var t = ((ball.x - mill.x) * dx + (ball.y - mill.y) * dy) / (dx * dx + dy * dy || 1);
      t = Math.max(0, Math.min(1, t));
      var px = mill.x + dx * t, py = mill.y + dy * t;
      var d = dist(ball.x, ball.y, px, py);
      var rad = mill.bw + BR;
      if (d >= rad) continue;
      var ux = (ball.x - px) / (d || 1), uy = (ball.y - py) / (d || 1);
      ball.x = px + ux * (rad + 0.5); ball.y = py + uy * (rad + 0.5);
      // blade surface velocity at the contact point (omega x r)
      var rx = px - mill.x, ry = py - mill.y;
      var bvx = -mill.omega * ry, bvy = mill.omega * rx;
      var rvx = ball.vx - bvx, rvy = ball.vy - bvy;
      var vdot = rvx * ux + rvy * uy;
      if (vdot < 0) { rvx -= 2 * vdot * ux; rvy -= 2 * vdot * uy; }
      ball.vx = rvx * REST + bvx * 0.8; ball.vy = rvy * REST + bvy * 0.8;
      var sp = Math.hypot(ball.vx, ball.vy);
      if (sp > 1500) { ball.vx *= 1500 / sp; ball.vy *= 1500 / sp; }
      hitSquash(ux, uy);
      sndThunk();
      return;
    }
    // hub is solid
    collidePost({ kind: "boulder", s: { x: mill.x, y: mill.y, r: mill.hub } });
  }

  function tryTunnel() {
    var tn = cur.tunnel;
    var spd = Math.hypot(ball.vx, ball.vy);
    if (spd < 150) return;
    if (dist(ball.x, ball.y, tn.ax, tn.ay) < tn.r) {
      transit = { t: 0, dur: 0.42, speed: spd };
      ball.vx = 0; ball.vy = 0;
      sndTunnel(0);
    }
  }

  function splash() {
    sndSplash();
    for (var i = 0; i < 9; i++) {
      var a = rnd(0, 6.283), sp = rnd(60, 240);
      drops.push({ x: ball.x, y: ball.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - rnd(60, 160), t: 0, life: rnd(0.4, 0.8) });
    }
    rings.push({ x: ball.x, y: ball.y, t: 0 });
    rings.push({ x: ball.x, y: ball.y, t: -0.12 });
    stamp(ball.x, ball.y - 26, "SPLASH +1", "#7fd8ff");
    strokes++;
    updateHud();
    ball.x = lastDry.x; ball.y = lastDry.y; ball.vx = 0; ball.vy = 0;
    splashHide = 0.55;
  }

  var sandStamp = { x: 0, y: 0 };
  function stampSand() {
    if (dist(ball.x, ball.y, sandStamp.x, sandStamp.y) < 3) return;
    sandStamp.x = ball.x; sandStamp.y = ball.y;
    mctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    mctx.beginPath(); mctx.arc(ball.x, ball.y, BR * 0.62, 0, 6.283);
    mctx.fillStyle = "rgba(96,74,36,0.09)"; mctx.fill();
  }

  function hitSquash(nx, ny) {
    var sp = Math.hypot(ball.vx, ball.vy);
    if (sp > 180) doneSquash = { nx: nx, ny: ny, t: 0 };
  }

  function beginSink() {
    sinking = 0.001; ball.vx = 0; ball.vy = 0; settled = false;
    if (!PRM) { timeScale = 0.5; slowT = 0.5; }
    sndSink();
  }
  function advance() {
    var ace = strokes === 1;
    totalStrokes += strokes; parSoFar += par;
    var diff = strokes - par;
    if (ace) { aces++; try { var a = (parseInt(localStorage.getItem("golf_aces"), 10) || 0) + 1; localStorage.setItem("golf_aces", String(a)); } catch (e) {} sndAce(); }
    var label = ace ? "ACE!" : diff <= -2 ? "EAGLE!" : diff === -1 ? "BIRDIE!" : diff === 0 ? "PAR" : null;
    if (label) stamp(cup.x, cup.y - CUPR * 3.2, label, "#ffd76a");
    updateHud();
    if (hole === TOTAL_HOLES) { courseComplete(); return; }
    if (!label) showToast("Hole " + hole + " in " + strokes, 1400);
    hole++;
    pendingHole = true;
    setTimeout(function () { pendingHole = false; newHole(); }, 950);
  }

  function courseComplete() {
    done = true;
    burstConfetti(); sndFanfare();
    setTimeout(showScorecard, 950);
  }
  function showScorecard() {
    var diff = totalStrokes - coursePar;
    var vs = diff === 0 ? "even par" : (diff > 0 ? "+" + diff + " over par" : Math.abs(diff) + " under par");
    var dkey = "golf_day_" + todayNum();
    var best = null;
    try { best = parseInt(localStorage.getItem(dkey), 10); } catch (e) {}
    var isBest = !best || totalStrokes < best;
    if (isBest) { try { localStorage.setItem(dkey, String(totalStrokes)); } catch (e) {} }
    ovTitle.textContent = "Round complete!";
    ovText.innerHTML = "<b>" + dayLabel() + "</b>'s course, all 18 holes in <b>" + totalStrokes + "</b> strokes, <b>" + vs +
      "</b>." + (aces ? " With <b>" + aces + "</b> hole-in-one" + (aces > 1 ? "s" : "") + "." : "") + " A brand-new course drops tomorrow.";
    ovBest.textContent = isBest ? "★ NEW BEST TODAY: " + totalStrokes + " strokes" : "Today's best: " + best + " · this round: " + totalStrokes;
    window.OPT_SHARE_TEXT = "I played today's Mini Golf course (par " + coursePar + ") in " + totalStrokes + " strokes, " + vs + ". Can you beat it?";
    overlay.removeAttribute("hidden");
    requestAnimationFrame(function () { overlay.classList.remove("is-hidden"); });
  }
  function playAgain() {
    hole = 1; totalStrokes = 0; parSoFar = 0; aces = 0; done = false; confetti.length = 0; pops.length = 0;
    overlay.classList.add("is-hidden");
    setTimeout(function () { overlay.setAttribute("hidden", ""); }, 280);
    buildPlan();
    newHole();
  }

  // ---------- particles ----------
  function burstConfetti() {
    var cx = W / 2, cy = H * 0.42;
    var hues = cur && cur.gold ? [46, 40, 52, 36, 30] : [46, 140, 168, 4, 320, 200];
    for (var i = 0; i < 140; i++) {
      var a = rnd(0, 6.283), sp = rnd(140, 560);
      confetti.push({ x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - rnd(80, 260), life: rnd(1.3, 2.6), size: rnd(3, 7.5), hue: hues[(Math.random() * hues.length) | 0], rot: rnd(0, 6.28), vr: rnd(-10, 10) });
    }
  }
  function seedMotes() {
    motes.length = 0;
    if (PRM) return;
    var n = pal().stars ? 18 : 13;
    for (var i = 0; i < n; i++) motes.push({ x: rnd(0, W), y: rnd(0, H), p: rnd(0, 6.283), s: rnd(0.5, 1.4) });
  }
  function updateFx(dt) {
    var i, p;
    for (i = confetti.length - 1; i >= 0; i--) { p = confetti[i]; p.life -= dt; if (p.life <= 0) { confetti.splice(i, 1); continue; } p.vy += 560 * dt; p.vx *= 0.99; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt; }
    for (i = drops.length - 1; i >= 0; i--) { p = drops[i]; p.t += dt; if (p.t > p.life) { drops.splice(i, 1); continue; } p.vy += 900 * dt; p.x += p.vx * dt; p.y += p.vy * dt; }
    for (i = rings.length - 1; i >= 0; i--) { p = rings[i]; p.t += dt; if (p.t > 0.7) rings.splice(i, 1); }
    for (i = pops.length - 1; i >= 0; i--) { p = pops[i]; p.t += dt; if (p.t > 1.4) pops.splice(i, 1); }
    for (i = flashes.length - 1; i >= 0; i--) { p = flashes[i]; p.t += dt; if (p.t > 0.24) flashes.splice(i, 1); }
    for (i = chalk.length - 1; i >= 0; i--) { chalk[i].t += dt; if (chalk[i].t > 2.4) chalk.splice(i, 1); }
    if (doneSquash) { doneSquash.t += dt; if (doneSquash.t > 0.1) doneSquash = null; }
    if (cupHopT > 0) cupHopT -= dt;
    if (pinWiggle > 0) { pinWigT += dt; if (pinWigT > 1.5) pinWiggle = 0; }
  }
  function poleSway() {   // current horizontal sway of the flagstick top
    if (pinWiggle <= 0 || PRM) return 0;
    return pinWigDir * Math.sin(pinWigT * 25) * Math.exp(-pinWigT * 4.2) * pinWiggle * BR * 1.8;
  }

  // ---------- render: cached scene ----------
  var scene = document.createElement("canvas");
  var sctx = scene.getContext("2d");
  var marks = document.createElement("canvas");
  var mctx = marks.getContext("2d");
  var caustic = null;
  var grain = null;

  function makeGrain() {
    grain = document.createElement("canvas"); grain.width = grain.height = 128;
    var gc = grain.getContext("2d"), id = gc.createImageData(128, 128);
    for (var i = 0; i < id.data.length; i += 4) {
      var v = 128 + (Math.random() * 2 - 1) * 30;
      id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 255;
    }
    gc.putImageData(id, 0, 0);
  }
  function makeCaustic() {
    caustic = document.createElement("canvas"); caustic.width = caustic.height = 160;
    var c = caustic.getContext("2d");
    c.strokeStyle = "rgba(190,240,255,0.32)"; c.lineWidth = 1.2;
    for (var i = 0; i < 34; i++) {
      c.beginPath();
      c.arc(rnd(0, 160), rnd(0, 160), rnd(4, 13), rnd(0, 6.28), rnd(0, 6.28) + rnd(0.7, 1.8));
      c.stroke();
    }
  }

  function shapePath(c, s, grow) {
    var g = grow || 0;
    if (s.t === "c") { c.moveTo(s.x + s.r + g, s.y); c.arc(s.x, s.y, s.r + g, 0, 6.283); return; }
    if (s.t === "rr") {
      var x = s.x - g, y = s.y - g, w = s.w + g * 2, h = s.h + g * 2, r = s.r + g;
      c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
      c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); return;
    }
    var a = Math.atan2(s.y2 - s.y1, s.x2 - s.x1), r2 = s.r + g;
    c.moveTo(s.x1 + Math.cos(a + Math.PI / 2) * r2, s.y1 + Math.sin(a + Math.PI / 2) * r2);
    c.arc(s.x1, s.y1, r2, a + Math.PI / 2, a - Math.PI / 2);
    c.arc(s.x2, s.y2, r2, a - Math.PI / 2, a + Math.PI / 2);
    c.closePath();
  }
  function unionPath(c, list, grow) { c.beginPath(); for (var i = 0; i < list.length; i++) shapePath(c, list[i], grow); }

  function drawCupInto(c) {
    var x = cup.x, y = cup.y, gold = !!cur.gold;
    if (gold) {
      var gl = c.createRadialGradient(x, y, 2, x, y, CUPR * 3.6);
      gl.addColorStop(0, "rgba(255,208,90,0.5)"); gl.addColorStop(1, "rgba(255,208,90,0)");
      c.fillStyle = gl; c.beginPath(); c.arc(x, y, CUPR * 3.6, 0, 6.283); c.fill();
    }
    c.beginPath(); c.arc(x, y, CUPR + 2.5, 0, 6.283);
    c.fillStyle = gold ? "#d9b23f" : "rgba(255,255,255,0.16)"; c.fill();
    var hg = c.createRadialGradient(x, y - CUPR * 0.25, CUPR * 0.2, x, y, CUPR);
    hg.addColorStop(0, "#0a2a15"); hg.addColorStop(1, "#02120a");
    c.beginPath(); c.arc(x, y, CUPR, 0, 6.283); c.fillStyle = hg; c.fill();
    c.beginPath(); c.arc(x, y, CUPR * 0.6, 0, 6.283); c.fillStyle = "#010c07"; c.fill();
    c.beginPath(); c.arc(x, y + CUPR * 0.35, CUPR * 0.85, 0.12 * Math.PI, 0.88 * Math.PI);
    c.strokeStyle = "rgba(255,255,255,0.14)"; c.lineWidth = 2; c.stroke();
    // pin base (the ferrule the ball bounces off) seated in the cup — baked;
    // the pole + flag draw live so they can wiggle when struck
    var bg = c.createRadialGradient(x - PIN_R * 0.4, y - PIN_R * 0.4, PIN_R * 0.2, x, y, PIN_R * 1.15);
    bg.addColorStop(0, gold ? "#ffe9a8" : "#eef2f7"); bg.addColorStop(1, gold ? "#b3861f" : "#9098a3");
    c.beginPath(); c.arc(x, y, PIN_R, 0, 6.283); c.fillStyle = bg; c.fill();
    c.strokeStyle = "rgba(0,0,0,0.4)"; c.lineWidth = 1; c.stroke();
  }
  function drawPole() {
    var x = cup.x, yBase = cup.y - CUPR * 0.3, yTop = cup.y - flagPoleH();
    var sway = poleSway(), topX = x + sway;
    var pg = ctx.createLinearGradient(x - 2, 0, x + 2, 0);
    pg.addColorStop(0, "#c3cad3"); pg.addColorStop(0.5, "#f4f7fb"); pg.addColorStop(1, "#a2aab5");
    ctx.strokeStyle = pg; ctx.lineWidth = 3.4; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(x, yBase);
    ctx.quadraticCurveTo(x + sway * 0.35, (yBase + yTop) / 2, topX, yTop);   // bows toward the sway
    ctx.stroke();
    ctx.beginPath(); ctx.arc(topX, yTop, 3.3, 0, 6.283);
    ctx.fillStyle = (cur && cur.gold) ? "#ffd76a" : "#eef2f7"; ctx.fill();
  }
  function flagPoleH() { return Math.max(54, CUPR * 4.8); }

  function buildScene() {
    if (!field || !cur) return;
    if (!grain) makeGrain();
    if (!caustic) makeCaustic();
    scene.width = Math.floor(W * DPR); scene.height = Math.floor(H * DPR);
    var c = sctx, PL = pal();
    c.setTransform(DPR, 0, 0, DPR, 0, 0);
    c.clearRect(0, 0, W, H);

    // --- the rough (backdrop world) ---
    var rg = c.createLinearGradient(0, 0, 0, H);
    rg.addColorStop(0, PL.r1); rg.addColorStop(1, PL.r2);
    c.fillStyle = rg; c.fillRect(0, 0, W, H);
    c.save(); c.globalAlpha = 0.05; c.fillStyle = c.createPattern(grain, "repeat"); c.fillRect(0, 0, W, H); c.restore();
    // sky tint (dawn peach / dusk rose / gold hour...)
    var sky = c.createLinearGradient(0, 0, 0, H * 0.9);
    sky.addColorStop(0, PL.sky); sky.addColorStop(1, "rgba(0,0,0,0)");
    c.fillStyle = sky; c.fillRect(0, 0, W, H);
    if (PL.stars) {
      var SR = mulberry(9042);
      for (var st = 0; st < 90; st++) {
        var sxp = SR() * W, syp = SR() * H;
        if (greenSD(sxp, syp) < S(0.08)) continue;
        c.globalAlpha = 0.25 + SR() * 0.55;
        c.fillStyle = "#dfe7ff"; c.fillRect(sxp, syp, SR() < 0.12 ? 2 : 1, SR() < 0.12 ? 2 : 1);
      }
      c.globalAlpha = 1;
    }
    // vignette on the rough
    var vg0 = c.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
    vg0.addColorStop(0, "rgba(0,0,0,0)"); vg0.addColorStop(1, "rgba(0,0,0,0.36)");
    c.fillStyle = vg0; c.fillRect(0, 0, W, H);

    var RAIL = Math.max(9, S(0.02));

    // --- ponds sitting below the deck (drawn before the plinth so off-green water shows) ---
    drawWater(c);

    // --- diorama plinth: extrusion + drop shadow ---
    c.save();
    c.translate(7, 12);
    unionPath(c, cur.plates, RAIL);
    c.fillStyle = "rgba(0,0,0,0.42)"; c.fill();
    c.restore();
    c.save();
    c.translate(0, 5);
    unionPath(c, cur.plates, RAIL);
    c.fillStyle = cur.gold ? "#4a3a12" : "#0a2917"; c.fill();
    c.restore();

    // --- rail (wood ring) ---
    unionPath(c, cur.plates, RAIL);
    var wg = c.createLinearGradient(0, field.y, 0, field.y + field.h);
    if (cur.gold) { wg.addColorStop(0, "#e8c05a"); wg.addColorStop(1, "#a37c22"); }
    else { wg.addColorStop(0, "#17573a"); wg.addColorStop(1, "#0c3a22"); }
    c.fillStyle = wg; c.fill();
    // rail highlight: stroke sits half under the felt → a crisp outer rim remains
    unionPath(c, cur.plates, 0);
    c.lineWidth = 5; c.strokeStyle = cur.gold ? "rgba(255,236,170,0.7)" : "rgba(255,255,255,0.2)"; c.stroke();

    // --- felt ---
    unionPath(c, cur.plates, 0);
    var gg = c.createRadialGradient(field.x + field.w * 0.42, field.y + field.h * 0.3, 30, field.x + field.w * 0.5, field.y + field.h * 0.55, Math.max(field.w, field.h) * 0.82);
    gg.addColorStop(0, PL.fl); gg.addColorStop(1, PL.fs);
    c.fillStyle = gg; c.fill();

    c.save();
    unionPath(c, cur.plates, 0); c.clip();
    // mow stripes along the long axis
    var bandW = Math.max(38, LONG() / 13);
    c.globalAlpha = 0.05;
    if (along) { for (var sx = field.x, k = 0; sx < field.x + field.w; sx += bandW, k++) { c.fillStyle = k % 2 ? "#ffffff" : "#00330f"; c.fillRect(sx, 0, bandW, H); } }
    else { for (var sy = field.y, k2 = 0; sy < field.y + field.h; sy += bandW, k2++) { c.fillStyle = k2 % 2 ? "#ffffff" : "#00330f"; c.fillRect(0, sy, W, bandW); } }
    c.globalAlpha = 1;
    c.globalAlpha = 0.06; c.fillStyle = c.createPattern(grain, "repeat"); c.fillRect(0, 0, W, H); c.globalAlpha = 1;

    // --- terrain shading: one NW sun over the height field ---
    drawTerrainShading(c);
    drawChevrons(c);

    // inner vignette on the felt
    var vg = c.createRadialGradient(field.x + field.w / 2, field.y + field.h / 2, Math.min(field.w, field.h) * 0.3, field.x + field.w / 2, field.y + field.h / 2, Math.max(field.w, field.h) * 0.68);
    vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,0.24)");
    c.fillStyle = vg; c.fillRect(0, 0, W, H);

    // --- sand traps (raked) ---
    for (var i = 0; i < cur.sand.length; i++) drawSand(c, cur.sand[i]);
    // --- on-green water (pools cut into the felt) + bridge planks ---
    if (cur.water.length && cur.bridges.length) { drawWater(c); drawBridges(c); }
    c.restore();

    // --- tunnel mouths + dashed buried path ---
    if (cur.tunnel) drawTunnel(c);

    // --- wood rect bumpers ---
    for (i = 0; i < cur.woods.length; i++) {
      var r = cur.woods[i];
      c.save(); c.shadowColor = "rgba(0,0,0,0.4)"; c.shadowBlur = 12; c.shadowOffsetY = 6;
      var bgr = c.createLinearGradient(r.x, r.y, r.x, r.y + r.h);
      bgr.addColorStop(0, "#d99f63"); bgr.addColorStop(1, "#87582d");
      c.fillStyle = bgr; c.beginPath(); shapePath(c, r, 0); c.fill(); c.restore();
      c.strokeStyle = "rgba(255,255,255,0.3)"; c.lineWidth = 2; c.beginPath(); shapePath(c, { t: "rr", x: r.x + 2.5, y: r.y + 2.5, w: r.w - 5, h: r.h - 5, r: Math.max(3, r.r - 2.5) }, 0); c.stroke();
      c.strokeStyle = "rgba(0,0,0,0.32)"; c.lineWidth = 1.5; c.beginPath(); shapePath(c, r, 0); c.stroke();
    }

    // --- posts: boulders + mushroom bumpers ---
    for (i = 0; i < cur.posts.length; i++) drawPost(c, cur.posts[i]);

    // --- windmill hub platform (blades draw live) ---
    for (i = 0; i < cur.mills.length; i++) {
      var ml = cur.mills[i];
      c.save(); c.shadowColor = "rgba(0,0,0,0.35)"; c.shadowBlur = 10; c.shadowOffsetY = 5;
      c.beginPath(); c.arc(ml.x, ml.y, ml.hub * 1.7, 0, 6.283);
      c.fillStyle = ml.gold ? "#8a6a1e" : "#5d4024"; c.fill(); c.restore();
    }

    drawCupInto(c);
  }

  function drawTerrainShading(c) {
    if (!cur.hills.length && !cur.tilt.x && !cur.tilt.y) return;
    var res = 4; // sample every 4 css px
    var bw = Math.ceil(field.w / res) + 2, bh = Math.ceil(field.h / res) + 2;
    var off = document.createElement("canvas"); off.width = bw; off.height = bh;
    var oc = off.getContext("2d"), id = oc.createImageData(bw, bh);
    // light from the NW; warm lit faces, cool shaded ones
    var lx = -0.62, ly = -0.62;
    for (var j = 0; j < bh; j++) {
      for (var i2 = 0; i2 < bw; i2++) {
        var x = field.x + i2 * res, y = field.y + j * res;
        var a = slopeAt(x, y); // accel = -k * height gradient → shading proxy
        var b = (a.x * lx + a.y * ly) / 300; // signed brightness
        b = Math.max(-0.55, Math.min(0.55, b));
        var o = (j * bw + i2) * 4;
        if (b > 0) { id.data[o] = 255; id.data[o + 1] = 240; id.data[o + 2] = 208; id.data[o + 3] = b * 150; }
        else { id.data[o] = 14; id.data[o + 1] = 34; id.data[o + 2] = 66; id.data[o + 3] = -b * 170; }
      }
    }
    oc.putImageData(id, 0, 0);
    c.imageSmoothingEnabled = true;
    c.drawImage(off, field.x, field.y, bw * res, bh * res);
  }

  function drawChevrons(c) {
    var stepPx = Math.max(44, S(0.13));
    c.lineWidth = 2; c.lineCap = "round";
    for (var y = field.y + stepPx / 2; y < field.y + field.h; y += stepPx) {
      for (var x = field.x + stepPx / 2; x < field.x + field.w; x += stepPx) {
        if (greenSD(x, y) > -BR * 2) continue;
        var a = slopeAt(x, y);
        var m = Math.hypot(a.x, a.y);
        if (m < 60) continue;
        var ux = a.x / m, uy = a.y / m;
        var al = Math.min(0.2, m / 900);
        c.strokeStyle = "rgba(255,255,255," + al.toFixed(3) + ")";
        var s2 = 5;
        c.beginPath();
        c.moveTo(x - ux * s2 - uy * s2 * 0.8, y - uy * s2 + ux * s2 * 0.8);
        c.lineTo(x + ux * s2, y + uy * s2);
        c.lineTo(x - ux * s2 + uy * s2 * 0.8, y - uy * s2 - ux * s2 * 0.8);
        c.stroke();
      }
    }
  }

  function drawSand(c, s) {
    c.save();
    c.beginPath(); shapePath(c, s, 0); c.clip();
    var b = boundsOf(s);
    var sg = c.createLinearGradient(b.x, b.y, b.x, b.y + b.h);
    sg.addColorStop(0, "#ecd9a8"); sg.addColorStop(1, "#d3ba82");
    c.fillStyle = sg; c.fillRect(b.x, b.y, b.w, b.h);
    c.globalAlpha = 0.1; c.fillStyle = c.createPattern(grain, "repeat"); c.fillRect(b.x, b.y, b.w, b.h); c.globalAlpha = 1;
    // raked rings (stop before the inset degenerates the shape)
    var maxIn = (s.t === "rr" ? Math.min(s.w, s.h) / 2 : s.r) - 1.5;
    c.strokeStyle = "rgba(120,95,50,0.28)"; c.lineWidth = 1.2;
    for (var g2 = -5; g2 > -maxIn; g2 -= 6) { c.beginPath(); shapePath(c, s, g2); c.stroke(); }
    c.restore();
    // lip: inner shadow ring
    c.beginPath(); shapePath(c, s, 0);
    c.strokeStyle = "rgba(40,28,10,0.4)"; c.lineWidth = 2.4; c.stroke();
  }

  function drawWater(c) {
    if (!cur.water.length) return;
    for (var i = 0; i < cur.water.length; i++) {
      var s = cur.water[i], b = boundsOf(s);
      c.save(); c.beginPath(); shapePath(c, s, 0); c.clip();
      var wgr = c.createRadialGradient(b.x + b.w / 2, b.y + b.h / 2, 4, b.x + b.w / 2, b.y + b.h / 2, Math.max(b.w, b.h) * 0.62);
      wgr.addColorStop(0, "#0d4257"); wgr.addColorStop(1, "#041e2a");
      c.fillStyle = wgr; c.fillRect(b.x - 4, b.y - 4, b.w + 8, b.h + 8);
      // sun glint streak (NW light)
      c.globalAlpha = 0.12; c.strokeStyle = "#cfeaff"; c.lineWidth = 2;
      c.beginPath(); c.moveTo(b.x + b.w * 0.2, b.y + b.h * 0.28); c.quadraticCurveTo(b.x + b.w * 0.45, b.y + b.h * 0.2, b.x + b.w * 0.72, b.y + b.h * 0.3); c.stroke();
      c.globalAlpha = 1;
      c.restore();
      // lip
      c.beginPath(); shapePath(c, s, 0);
      c.strokeStyle = "rgba(226,207,157,0.5)"; c.lineWidth = 2.2; c.stroke();
      c.beginPath(); shapePath(c, s, -2.6);
      c.strokeStyle = "rgba(0,0,0,0.35)"; c.lineWidth = 2; c.stroke();
    }
  }

  function drawBridges(c) {
    for (var i = 0; i < cur.bridges.length; i++) {
      var s = cur.bridges[i];
      c.save(); c.beginPath(); shapePath(c, s, 0); c.clip();
      var a = Math.atan2(s.y2 - s.y1, s.x2 - s.x1);
      var L2 = dist(s.x1, s.y1, s.x2, s.y2) + s.r * 2;
      var bg2 = c.createLinearGradient(s.x1, s.y1 - s.r, s.x1, s.y1 + s.r);
      bg2.addColorStop(0, "#caa06a"); bg2.addColorStop(1, "#8f6535");
      c.fillStyle = bg2;
      c.fillRect(Math.min(s.x1, s.x2) - s.r, Math.min(s.y1, s.y2) - s.r, Math.abs(s.x2 - s.x1) + s.r * 2, Math.abs(s.y2 - s.y1) + s.r * 2);
      // planks
      c.strokeStyle = "rgba(60,38,12,0.5)"; c.lineWidth = 1.6;
      var n = Math.floor(L2 / 9);
      for (var k = 0; k <= n; k++) {
        var t = k / n;
        var px = s.x1 - Math.cos(a) * s.r + (s.x2 - s.x1 + Math.cos(a) * s.r * 2) * t;
        var py = s.y1 - Math.sin(a) * s.r + (s.y2 - s.y1 + Math.sin(a) * s.r * 2) * t;
        c.beginPath();
        c.moveTo(px + Math.cos(a + Math.PI / 2) * s.r, py + Math.sin(a + Math.PI / 2) * s.r);
        c.lineTo(px + Math.cos(a - Math.PI / 2) * s.r, py + Math.sin(a - Math.PI / 2) * s.r);
        c.stroke();
      }
      c.restore();
      // rails
      c.beginPath(); shapePath(c, s, 0);
      c.strokeStyle = "rgba(255,235,200,0.4)"; c.lineWidth = 2; c.stroke();
    }
  }

  function drawTunnel(c) {
    var tn = cur.tunnel;
    // buried path
    c.save();
    c.setLineDash([5, 8]); c.lineWidth = 2; c.strokeStyle = "rgba(0,0,0,0.25)";
    c.beginPath(); c.moveTo(tn.ax, tn.ay); c.lineTo(tn.bx, tn.by); c.stroke();
    c.setLineDash([]);
    c.restore();
    [[tn.ax, tn.ay], [tn.bx, tn.by]].forEach(function (m2, mi) {
      var hg = c.createRadialGradient(m2[0], m2[1] - tn.r * 0.3, tn.r * 0.15, m2[0], m2[1], tn.r);
      hg.addColorStop(0, "#1c1206"); hg.addColorStop(1, "#000000");
      c.beginPath(); c.arc(m2[0], m2[1], tn.r, 0, 6.283); c.fillStyle = hg; c.fill();
      c.beginPath(); c.arc(m2[0], m2[1], tn.r + 1.5, 0, 6.283);
      c.strokeStyle = mi === 0 ? "#ffd76a" : "#7fd8ff"; c.lineWidth = 2.5; c.globalAlpha = 0.85; c.stroke(); c.globalAlpha = 1;
    });
  }

  function drawPost(c, post) {
    var s = post.s;
    c.save(); c.shadowColor = "rgba(0,0,0,0.4)"; c.shadowBlur = 10; c.shadowOffsetX = 4; c.shadowOffsetY = 6;
    if (post.kind === "boulder") {
      var bg3 = c.createRadialGradient(s.x - s.r * 0.35, s.y - s.r * 0.4, s.r * 0.2, s.x, s.y, s.r);
      bg3.addColorStop(0, "#b9c0c9"); bg3.addColorStop(1, "#6b737d");
      c.beginPath(); c.arc(s.x, s.y, s.r, 0, 6.283); c.fillStyle = bg3; c.fill();
      c.restore();
      c.strokeStyle = "rgba(0,0,0,0.3)"; c.lineWidth = 1.5; c.beginPath(); c.arc(s.x, s.y, s.r, 0, 6.283); c.stroke();
      c.globalAlpha = 0.35; c.strokeStyle = "#3d444d"; c.lineWidth = 1;
      c.beginPath(); c.arc(s.x + s.r * 0.15, s.y + s.r * 0.1, s.r * 0.5, 0.4, 2.2); c.stroke(); c.globalAlpha = 1;
    } else {
      // mushroom kicker: white stalk ring + glossy dotted cap
      c.beginPath(); c.arc(s.x, s.y, s.r * 1.2, 0, 6.283); c.fillStyle = "#efe6d2"; c.fill();
      c.restore();
      var capCol = pal().accent;
      var cg = c.createRadialGradient(s.x - s.r * 0.4, s.y - s.r * 0.45, s.r * 0.1, s.x, s.y, s.r * 1.02);
      cg.addColorStop(0, "#ffffff"); cg.addColorStop(0.25, capCol); cg.addColorStop(1, shade(capCol, -38));
      c.beginPath(); c.arc(s.x, s.y, s.r, 0, 6.283); c.fillStyle = cg; c.fill();
      c.fillStyle = "rgba(255,255,255,0.85)";
      var DR = mulberry((s.x * 13 + s.y * 7) | 0);
      for (var k = 0; k < 4; k++) {
        var a2 = DR() * 6.283, rr2 = DR() * s.r * 0.55 + s.r * 0.15;
        c.beginPath(); c.arc(s.x + Math.cos(a2) * rr2, s.y + Math.sin(a2) * rr2, s.r * 0.14, 0, 6.283); c.fill();
      }
      c.strokeStyle = "rgba(0,0,0,0.25)"; c.lineWidth = 1.2; c.beginPath(); c.arc(s.x, s.y, s.r * 1.2, 0, 6.283); c.stroke();
    }
  }
  function shade(hex, amt) {
    var n = parseInt(hex.slice(1), 16);
    var r = Math.max(0, Math.min(255, (n >> 16) + amt)), g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amt)), b = Math.max(0, Math.min(255, (n & 255) + amt));
    return "rgb(" + r + "," + g + "," + b + ")";
  }
  function boundsOf(s) {
    if (s.t === "c") return { x: s.x - s.r, y: s.y - s.r, w: s.r * 2, h: s.r * 2 };
    if (s.t === "rr") return { x: s.x, y: s.y, w: s.w, h: s.h };
    return { x: Math.min(s.x1, s.x2) - s.r, y: Math.min(s.y1, s.y2) - s.r, w: Math.abs(s.x2 - s.x1) + s.r * 2, h: Math.abs(s.y2 - s.y1) + s.r * 2 };
  }

  // ---------- render: live layer ----------
  function render() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (scene.width) ctx.drawImage(scene, 0, 0);
    else { ctx.fillStyle = "#0a2016"; ctx.fillRect(0, 0, canvas.width, canvas.height); }
    if (marks.width) ctx.drawImage(marks, 0, 0);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    if (!field || !cur) return;

    drawCaustics();
    drawChalk();
    drawMills();
    drawTransit();
    if (aiming && settled) drawAim();
    drawBall();
    drawPole();
    drawFlagCloth();
    drawFlashes();
    drawSplash();
    drawMotes();
    drawPops();
    drawConfetti();
  }

  function drawCaustics() {
    if (!cur.water.length || !caustic || PRM) return;
    var t = simT;
    ctx.save();
    unionPath(ctx, cur.water, -2); ctx.clip();
    ctx.globalAlpha = 0.14; ctx.globalCompositeOperation = "screen";
    var o1 = (t * 6) % 160, o2 = (t * -4) % 160;
    for (var i = 0; i < cur.water.length; i++) {
      var b = boundsOf(cur.water[i]);
      for (var x = b.x - 160; x < b.x + b.w + 160; x += 160) {
        for (var y = b.y - 160; y < b.y + b.h + 160; y += 160) {
          ctx.drawImage(caustic, x + o1, y + o2);
          ctx.drawImage(caustic, x - o2, y + o1);
        }
      }
    }
    ctx.restore();
  }

  function drawChalk() {
    for (var i = 0; i < chalk.length; i++) {
      var p = chalk[i], a = Math.max(0, 1 - p.t / 2.4) * 0.34;
      ctx.globalAlpha = a;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath(); ctx.arc(p.x, p.y, 1.5, 0, 6.283); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawMills() {
    for (var i = 0; i < cur.mills.length; i++) {
      var m = cur.mills[i];
      // sweeping shadows first
      for (var b = 0; b < m.blades; b++) {
        var ang = m.phase + m.omega * simT + (b * 6.283 / m.blades);
        drawBlade(m, ang, true);
      }
      for (b = 0; b < m.blades; b++) {
        var ang2 = m.phase + m.omega * simT + (b * 6.283 / m.blades);
        drawBlade(m, ang2, false);
      }
      // hub cap
      var hg = ctx.createRadialGradient(m.x - m.hub * 0.3, m.y - m.hub * 0.3, 1, m.x, m.y, m.hub);
      if (m.gold) { hg.addColorStop(0, "#ffe9a8"); hg.addColorStop(1, "#b3861f"); }
      else { hg.addColorStop(0, "#f3e2c0"); hg.addColorStop(1, "#7d5a2e"); }
      ctx.beginPath(); ctx.arc(m.x, m.y, m.hub, 0, 6.283); ctx.fillStyle = hg; ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.3)"; ctx.lineWidth = 1.4; ctx.stroke();
      ctx.beginPath(); ctx.arc(m.x - m.hub * 0.3, m.y - m.hub * 0.35, m.hub * 0.22, 0, 6.283); ctx.fillStyle = "rgba(255,255,255,0.8)"; ctx.fill();
    }
  }
  function drawBlade(m, ang, isShadow) {
    var ca = Math.cos(ang), sa = Math.sin(ang);
    var tipX = m.x + ca * m.len, tipY = m.y + sa * m.len;
    var w1 = m.bw * 0.7, w2 = m.bw * 1.25; // tapered: wider at the tip
    var px = -sa, py = ca;
    ctx.save();
    if (isShadow) { ctx.translate(5, 8); ctx.globalAlpha = 0.24; }
    ctx.beginPath();
    ctx.moveTo(m.x + px * w1, m.y + py * w1);
    ctx.lineTo(tipX + px * w2, tipY + py * w2);
    ctx.arc(tipX, tipY, w2, Math.atan2(py, px), Math.atan2(-py, -px));
    ctx.lineTo(m.x - px * w1, m.y - py * w1);
    ctx.closePath();
    if (isShadow) { ctx.fillStyle = "#000"; ctx.fill(); ctx.restore(); return; }
    // sun-lit blades: brightness follows facing vs the NW light
    var lit = 0.5 - 0.5 * (ca * -0.7 + sa * -0.7);
    var base = m.gold ? [255, 214, 106] : [232, 226, 214];
    var f = 0.62 + lit * 0.38;
    ctx.fillStyle = "rgb(" + (base[0] * f | 0) + "," + (base[1] * f | 0) + "," + (base[2] * f | 0) + ")";
    ctx.fill();
    // painted stripe
    ctx.strokeStyle = m.gold ? "rgba(140,96,10,0.55)" : "rgba(213,56,62,0.6)";
    ctx.lineWidth = m.bw * 0.5;
    ctx.beginPath();
    ctx.moveTo(m.x + ca * m.len * 0.35, m.y + sa * m.len * 0.35);
    ctx.lineTo(m.x + ca * m.len * 0.62, m.y + sa * m.len * 0.62);
    ctx.stroke();
    ctx.strokeStyle = "rgba(0,0,0,0.28)"; ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(m.x + px * w1, m.y + py * w1);
    ctx.lineTo(tipX + px * w2, tipY + py * w2);
    ctx.moveTo(m.x - px * w1, m.y - py * w1);
    ctx.lineTo(tipX - px * w2, tipY - py * w2);
    ctx.stroke();
    ctx.restore();
  }

  function drawTransit() {
    if (!transit || !cur.tunnel) return;
    var tn = cur.tunnel, t = transit.t / transit.dur;
    var x = tn.ax + (tn.bx - tn.ax) * t, y = tn.ay + (tn.by - tn.ay) * t;
    ctx.beginPath(); ctx.ellipse(x, y, BR * 1.5, BR * 0.9, 0, 0, 6.283);
    ctx.fillStyle = "rgba(0,0,0,0.18)"; ctx.fill();
    ctx.beginPath(); ctx.ellipse(x - BR * 0.4, y - BR * 0.35, BR * 0.7, BR * 0.4, 0, 0, 6.283);
    ctx.fillStyle = "rgba(255,255,255,0.08)"; ctx.fill();
  }

  function drawBall() {
    if (splashHide > 0 || transit) return;
    if (sinking >= 1) return;
    var br = BR * (sinking > 0 ? (1 - sinking * 0.85) : 1);
    // lip-out pop: the ball rides up over the rim and drops back
    if (cupHopT > 0) br *= 1 + Math.sin((1 - cupHopT / 0.17) * Math.PI) * 0.22;
    var bxp = sinking > 0 ? ball.x + (cup.x - ball.x) * sinking : ball.x;
    var byp = sinking > 0 ? ball.y + (cup.y - ball.y) * sinking : ball.y;
    ctx.save();
    // contact shadow stretches downhill — a live terrain tell
    var sl = slopeAt(bxp, byp);
    var sm = Math.min(1, Math.hypot(sl.x, sl.y) / 260);
    var sax = sl.x === 0 && sl.y === 0 ? 0 : Math.atan2(sl.y, sl.x);
    ctx.beginPath();
    ctx.ellipse(bxp + br * 0.26 + Math.cos(sax) * sm * br * 0.5, byp + br * 0.58 + Math.sin(sax) * sm * br * 0.5, br * (1.05 + sm * 0.35), br * 0.58, sax * sm * 0.4, 0, 6.283);
    ctx.fillStyle = "rgba(0,0,0,0.3)"; ctx.fill();
    // squash on impact
    if (doneSquash) {
      var q = 1 - (doneSquash.t / 0.1);
      var na = Math.atan2(doneSquash.ny, doneSquash.nx);
      ctx.translate(bxp, byp); ctx.rotate(na); ctx.scale(1 - 0.16 * q, 1 + 0.1 * q); ctx.rotate(-na); ctx.translate(-bxp, -byp);
    }
    var bg2 = ctx.createRadialGradient(bxp - br * 0.38, byp - br * 0.42, br * 0.1, bxp, byp, br);
    bg2.addColorStop(0, "#ffffff"); bg2.addColorStop(0.72, "#eef1f5"); bg2.addColorStop(1, "#c0c6cf");
    ctx.beginPath(); ctx.arc(bxp, byp, br, 0, 6.283); ctx.fillStyle = bg2; ctx.fill();
    ctx.lineWidth = 1; ctx.strokeStyle = "rgba(0,0,0,0.12)"; ctx.stroke();
    ctx.beginPath(); ctx.arc(bxp - br * 0.32, byp - br * 0.36, br * 0.22, 0, 6.283); ctx.fillStyle = "rgba(255,255,255,0.92)"; ctx.fill();
    ctx.restore();
  }

  function drawFlagCloth() {
    var x = cup.x + poleSway(), yTop = cup.y - flagPoleH();   // rides the swaying pole top
    var fw2 = Math.max(30, CUPR * 2.4), fh2 = fw2 * 0.58;
    var wob = (PRM ? 0 : Math.sin(simT * 2.1) * 2.2 + Math.sin(simT * 3.7) * 1.1) + poleSway() * 0.6;
    var PL = pal();
    ctx.beginPath();
    ctx.moveTo(x + 1.5, yTop + 1);
    ctx.quadraticCurveTo(x + fw2 * 0.5, yTop - 4 + wob, x + fw2, yTop + fh2 * 0.42 + wob * 1.4);
    ctx.quadraticCurveTo(x + fw2 * 0.55, yTop + fh2 * 0.62 + wob * 0.6, x + 1.5, yTop + fh2);
    ctx.closePath();
    var fg = ctx.createLinearGradient(x, 0, x + fw2, 0);
    fg.addColorStop(0, PL.flag); fg.addColorStop(1, shade(PL.flag, -46));
    ctx.fillStyle = fg; ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.16)"; ctx.lineWidth = 1; ctx.stroke();
  }

  function drawFlashes() {
    for (var i = 0; i < flashes.length; i++) {
      var f = flashes[i], t = f.t / 0.24;
      ctx.globalAlpha = (1 - t) * 0.7;
      ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.arc(f.x, f.y, f.r * (1.15 + t * 0.6), 0, 6.283); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function drawSplash() {
    var i, p;
    for (i = 0; i < rings.length; i++) {
      p = rings[i]; if (p.t < 0) continue;
      var t = p.t / 0.7;
      ctx.globalAlpha = (1 - t) * 0.5;
      ctx.strokeStyle = "#bfe8ff"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(p.x, p.y, 6 + t * 34, (6 + t * 34) * 0.62, 0, 0, 6.283); ctx.stroke();
    }
    for (i = 0; i < drops.length; i++) {
      p = drops[i];
      ctx.globalAlpha = Math.max(0, 1 - p.t / p.life);
      ctx.fillStyle = "#9fd8f5";
      ctx.beginPath(); ctx.arc(p.x, p.y, 2, 0, 6.283); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawMotes() {
    if (PRM) return;
    var PL = pal();
    for (var i = 0; i < motes.length; i++) {
      var m = motes[i];
      var x = m.x + Math.sin(simT * 0.4 + m.p) * 26;
      var y = m.y + Math.sin(simT * 0.27 + m.p * 1.7) * 18 - simT * 1.5 % H;
      y = ((y % H) + H) % H;
      var tw = PL.stars ? (0.35 + 0.65 * Math.abs(Math.sin(simT * 1.4 + m.p))) : 0.55;
      ctx.globalAlpha = 0.35 * tw * m.s;
      ctx.fillStyle = "rgba(" + PL.mote + ",1)";
      ctx.beginPath(); ctx.arc(x, y, m.s * (PL.stars ? 1.7 : 1.2), 0, 6.283); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawPops() {
    for (var i = 0; i < pops.length; i++) {
      var p = pops[i];
      var inT = Math.min(1, p.t / 0.12);
      var sc = 0.6 + inT * 0.4 + Math.max(0, 0.14 - p.t) * 2;
      var al = p.t > 1 ? Math.max(0, 1 - (p.t - 1) / 0.4) : 1;
      ctx.save();
      ctx.translate(p.x, p.y - p.t * 14); ctx.rotate(p.rot); ctx.scale(sc, sc);
      ctx.globalAlpha = al;
      ctx.font = "900 20px 'Archivo', system-ui, sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.lineWidth = 4; ctx.strokeStyle = "rgba(0,0,0,0.55)"; ctx.strokeText(p.txt, 0, 0);
      ctx.fillStyle = p.color; ctx.fillText(p.txt, 0, 0);
      ctx.restore();
    }
  }

  function drawConfetti() {
    for (var i = 0; i < confetti.length; i++) {
      var p = confetti[i], a = Math.min(1, p.life / 0.5);
      ctx.save(); ctx.globalAlpha = a; ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.fillStyle = "hsl(" + p.hue + ",85%,60%)";
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.62);
      ctx.restore();
    }
  }

  function drawAim() {
    var dx = ball.x - aimX, dy = ball.y - aimY;
    var pull = Math.min(Math.hypot(dx, dy), MAXPULL);
    if (pull < 2) return;
    var a = Math.atan2(dy, dx), frac = pull / MAXPULL;
    var len = BR + 16 + frac * Math.min(W, H) * 0.13;
    var ex = ball.x + Math.cos(a) * len, ey = ball.y + Math.sin(a) * len;
    ctx.save();
    ctx.setLineDash([4, 8]); ctx.lineWidth = 3; ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(255,255,255,0.7)";
    ctx.beginPath(); ctx.moveTo(ball.x, ball.y); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.setLineDash([]);
    var ah = 8;
    ctx.beginPath();
    ctx.moveTo(ex, ey); ctx.lineTo(ex - Math.cos(a - 0.42) * ah, ey - Math.sin(a - 0.42) * ah);
    ctx.moveTo(ex, ey); ctx.lineTo(ex - Math.cos(a + 0.42) * ah, ey - Math.sin(a + 0.42) * ah);
    ctx.strokeStyle = "rgba(255,255,255,0.85)"; ctx.lineWidth = 3; ctx.stroke();
    var col = "hsl(" + (120 - frac * 120) + ",85%,55%)";
    ctx.beginPath(); ctx.arc(ball.x, ball.y, BR + 5, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2); ctx.strokeStyle = col; ctx.lineWidth = 4; ctx.stroke();
    ctx.restore();
  }

  var last = 0;
  function frame(ts) {
    var dt = last ? Math.min((ts - last) / 1000, 0.05) : 0; last = ts;
    var sdt = dt * timeScale;
    step(sdt); updateFx(dt); updateRoll(); render();
    requestAnimationFrame(frame);
  }

  // ============================ AUDIO ============================
  // Physically-grounded voices (transient + body + tail), stereo-panned by
  // on-course position, glued by a bus compressor and silked by a master
  // lowpass; a smoothed convolver hall gives the hits air. Headless can't
  // audition any of this — built for realism, final judgment by ear.
  var actx = null, master = null, outGain = null, convo = null, comp = null, silk = null;
  var rollGain = null, rollFilt = null, rollPan = null;
  function initAudio() {
    if (actx) return;
    try {
      actx = new (window.AudioContext || window.webkitAudioContext)();
      outGain = actx.createGain(); outGain.gain.value = soundOn ? 1 : 0;
      outGain.connect(actx.destination);
      silk = actx.createBiquadFilter(); silk.type = "lowpass"; silk.frequency.value = 9500; silk.connect(outGain);
      comp = actx.createDynamicsCompressor();
      comp.threshold.value = -15; comp.ratio.value = 3; comp.attack.value = 0.003; comp.release.value = 0.25;
      comp.connect(silk);
      master = actx.createGain(); master.gain.value = 0.9; master.connect(comp);
      convo = actx.createConvolver(); convo.buffer = makeImpulse(1.9, 2.6); convo.connect(comp);
      // felt-roll bed: looped brown noise, gain/brightness keyed to ball speed
      var rb = actx.createBuffer(1, actx.sampleRate * 2, actx.sampleRate), rd = rb.getChannelData(0), lastB = 0;
      for (var i = 0; i < rd.length; i++) { var w = Math.random() * 2 - 1; lastB = (lastB + 0.02 * w) / 1.02; rd[i] = lastB * 3.5; }
      var rsrc = actx.createBufferSource(); rsrc.buffer = rb; rsrc.loop = true;
      rollFilt = actx.createBiquadFilter(); rollFilt.type = "lowpass"; rollFilt.frequency.value = 400;
      rollGain = actx.createGain(); rollGain.gain.value = 0;
      rsrc.connect(rollFilt); rollFilt.connect(rollGain);
      var rTail = rollGain;
      if (actx.createStereoPanner) { rollPan = actx.createStereoPanner(); rollGain.connect(rollPan); rTail = rollPan; }
      rTail.connect(master); rsrc.start(0);
    } catch (e) { actx = null; }
  }
  // smooth hall impulse: progressively low-passed noise (no grainy tail) with
  // the lows filtered back out so the reverb never muddies the knocks
  function makeImpulse(dur, decay) {
    var n = Math.floor(actx.sampleRate * dur), buf = actx.createBuffer(2, n, actx.sampleRate);
    for (var ch = 0; ch < 2; ch++) {
      var d = buf.getChannelData(ch), lp = 0, hp = 0;
      for (var i = 0; i < n; i++) {
        var t = i / n;
        var raw = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
        lp += (raw - lp) * 0.22;
        hp += (lp - hp) * 0.012;
        d[i] = (lp - hp) * 1.7;
      }
    }
    return buf;
  }
  function unlock() { initAudio(); if (actx && actx.state === "suspended") actx.resume(); if (actx) { var b = actx.createBuffer(1, 1, 22050), s = actx.createBufferSource(); s.buffer = b; s.connect(actx.destination); s.start(0); } }
  function panOf(x) { return Math.max(-0.8, Math.min(0.8, ((x / W) - 0.5) * 1.1)); }
  // route a voice: pan by course position, dry to master, wetAmt into the hall
  function bus(g, x, wetAmt) {
    var tail = g;
    if (x != null && actx.createStereoPanner) { var p = actx.createStereoPanner(); p.pan.value = panOf(x); g.connect(p); tail = p; }
    tail.connect(master);
    var w = actx.createGain(); w.gain.value = wetAmt == null ? 0.12 : wetAmt;
    tail.connect(w); w.connect(convo);
  }
  function noise(dur) { var n = Math.floor(actx.sampleRate * dur), b = actx.createBuffer(1, n, actx.sampleRate), d = b.getChannelData(0); for (var i = 0; i < n; i++) d[i] = Math.random() * 2 - 1; var s = actx.createBufferSource(); s.buffer = b; return s; }
  // one damped resonant mode of a struck object
  function mode(t, freq, drop, dur, vol, type, x, wetAmt, atk) {
    var o = actx.createOscillator(); o.type = type || "sine"; o.frequency.setValueAtTime(freq, t);
    if (drop && drop !== 1) o.frequency.exponentialRampToValueAtTime(freq * drop, t + dur);
    var g = actx.createGain(); g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + (atk || 0.004));
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g); bus(g, x, wetAmt); o.start(t); o.stop(t + dur + 0.03);
  }
  // the contact transient: a short filtered burst of noise
  function click(t, freq, q, dur, vol, x, wetAmt, type) {
    var s = noise(dur + 0.01), f = actx.createBiquadFilter(); f.type = type || "bandpass"; f.frequency.value = freq; f.Q.value = q;
    var g = actx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f); f.connect(g); bus(g, x, wetAmt); s.start(t); s.stop(t + dur + 0.02);
  }

  // putter face on a solid ball: bright contact click + hollow shell knock + low face thump
  function sndPutt(f) {
    if (!actx || !soundOn) return;
    var t = actx.currentTime, x = ball.x, v = rnd(0.96, 1.04);
    click(t, 2600 + f * 1600, 1.1, 0.02, 0.10 + f * 0.14, x, 0.05);
    mode(t, 870 * v, 0.72, 0.05, 0.05 + f * 0.09, "triangle", x, 0.05);
    mode(t, 195 * v, 0.6, 0.07, 0.09 + f * 0.11, "sine", x, 0.06);
  }
  // painted timber rail: woody knock — two inharmonic wood modes, brighter when fast
  var lastWall = 0;
  function sndWall() {
    if (!actx || !soundOn) return; var now = actx.currentTime; if (now - lastWall < 0.045) return; lastWall = now;
    var spd = Math.min(1, Math.hypot(ball.vx, ball.vy) / 900);
    if (spd < 0.05) return;
    var x = ball.x, v = rnd(0.95, 1.05);
    mode(now, 305 * v, 0.9, 0.09, 0.13 * spd, "sine", x, 0.08);
    mode(now, 640 * v, 0.85, 0.05, 0.05 * spd, "triangle", x, 0.08);
    click(now, 1500 + spd * 900, 1.4, 0.012, 0.06 * spd, x, 0.06);
    if (spd > 0.5) mode(now, 130, 0.7, 0.05, 0.1 * (spd - 0.5), "sine", x, 0.05);
  }
  // ball chattering on the cup lip: shallow metallic clank
  function sndRim(v) {
    if (!actx || !soundOn) return;
    var now = actx.currentTime; if (sndRim._t && now - sndRim._t < 0.06) return; sndRim._t = now;
    var x = cup.x, d = rnd(0.96, 1.04);
    click(now, 3100, 2.5, 0.012, 0.05 * v, x, 0.08);
    mode(now, 460 * d, 0.94, 0.09, 0.06 + v * 0.06, "triangle", x, 0.1);
    mode(now, 1280 * d, 0.9, 0.05, 0.035 * v, "sine", x, 0.1);
    mode(now, 2540 * d, 0.9, 0.03, 0.02 * v, "sine", x, 0.1);
  }
  // hollow aluminum flagstick: bright ping with real tube partials (1 : 2.76 : 5.40)
  function sndPin(v) {
    if (!actx || !soundOn) return;
    var now = actx.currentTime; if (sndPin._t && now - sndPin._t < 0.06) return; sndPin._t = now;
    var x = cup.x, f0 = 640 * rnd(0.97, 1.03);
    click(now, 4200, 2, 0.01, 0.06 * v, x, 0.1);
    mode(now, f0, 0.985, 0.22, 0.07 + v * 0.09, "sine", x, 0.16);
    mode(now, f0 * 2.76, 0.985, 0.14, 0.04 + v * 0.05, "sine", x, 0.16);
    mode(now, f0 * 5.40, 0.985, 0.07, 0.025 * v, "sine", x, 0.16);
  }
  // mushroom kicker: rubbery spring — pitch wobbles through a few cycles as it recoils
  function sndBoing(f) {
    if (!actx || !soundOn) return;
    var t = actx.currentTime, x = ball.x;
    var penta = [0, 3, 5, 7, 10];
    var f0 = 330 * Math.pow(2, penta[Math.min(4, Math.floor(f * 5))] / 12) * rnd(0.98, 1.02);
    click(t, 900, 1, 0.015, 0.06 + f * 0.05, x, 0.08, "lowpass");
    var o = actx.createOscillator(); o.type = "sine";
    o.frequency.setValueAtTime(f0 * 0.72, t);
    o.frequency.exponentialRampToValueAtTime(f0 * 1.28, t + 0.05);
    o.frequency.exponentialRampToValueAtTime(f0 * 0.9, t + 0.11);
    o.frequency.exponentialRampToValueAtTime(f0 * 1.06, t + 0.16);
    o.frequency.exponentialRampToValueAtTime(f0, t + 0.22);
    var g = actx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.13 + f * 0.09, t + 0.01); g.gain.exponentialRampToValueAtTime(0.001, t + 0.26);
    o.connect(g); bus(g, x, 0.14); o.start(t); o.stop(t + 0.28);
    mode(t, f0 * 2.02, 0.95, 0.08, 0.03 + f * 0.03, "triangle", x, 0.14);
  }
  // boulder: dense stone knock — dead, low, no ring
  function sndThunk() {
    if (!actx || !soundOn) return;
    var t = actx.currentTime, x = ball.x, v = rnd(0.95, 1.05);
    click(t, 360, 1, 0.01, 0.14, x, 0.04, "lowpass");
    mode(t, 138 * v, 0.8, 0.06, 0.18, "sine", x, 0.04);
    mode(t, 226 * v, 0.8, 0.045, 0.08, "sine", x, 0.04);
  }
  // pond plunk: deep impact thud + rising cavity "bloop" + splash wash + after-drips
  function sndSplash() {
    if (!actx || !soundOn) return;
    var t = actx.currentTime, x = ball.x;
    mode(t, 150, 0.39, 0.12, 0.16, "sine", x, 0.12);
    var o = actx.createOscillator(); o.type = "sine";
    o.frequency.setValueAtTime(230, t + 0.03); o.frequency.exponentialRampToValueAtTime(560, t + 0.17);
    var g = actx.createGain(); g.gain.setValueAtTime(0.0001, t + 0.03); g.gain.exponentialRampToValueAtTime(0.12, t + 0.06); g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    o.connect(g); bus(g, x, 0.16); o.start(t + 0.03); o.stop(t + 0.22);
    var s = noise(0.3), bp = actx.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = 0.8;
    bp.frequency.setValueAtTime(1050, t); bp.frequency.exponentialRampToValueAtTime(560, t + 0.26);
    var g2 = actx.createGain(); g2.gain.setValueAtTime(0.001, t); g2.gain.exponentialRampToValueAtTime(0.12, t + 0.03); g2.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    s.connect(bp); bp.connect(g2); bus(g2, x, 0.18); s.start(t); s.stop(t + 0.32);
    for (var i = 0; i < 2; i++) {
      var tt = t + 0.16 + i * 0.09 + rnd(0, 0.04), fd = rnd(800, 1300);
      var od = actx.createOscillator(); od.type = "sine";
      od.frequency.setValueAtTime(fd, tt); od.frequency.exponentialRampToValueAtTime(fd * 1.6, tt + 0.045);
      var gd = actx.createGain(); gd.gain.setValueAtTime(0.0001, tt); gd.gain.exponentialRampToValueAtTime(0.03, tt + 0.012); gd.gain.exponentialRampToValueAtTime(0.001, tt + 0.05);
      od.connect(gd); bus(gd, x, 0.2); od.start(tt); od.stop(tt + 0.07);
    }
  }
  // culvert: hollow pipe whoosh + resonant mouth
  function sndTunnel(exit) {
    if (!actx || !soundOn) return;
    var t = actx.currentTime, x = ball.x;
    var s = noise(0.2), lp = actx.createBiquadFilter(); lp.type = "lowpass";
    if (exit) { lp.frequency.setValueAtTime(340, t); lp.frequency.exponentialRampToValueAtTime(1200, t + 0.16); }
    else { lp.frequency.setValueAtTime(1200, t); lp.frequency.exponentialRampToValueAtTime(340, t + 0.16); }
    var g = actx.createGain(); g.gain.setValueAtTime(0.001, t); g.gain.exponentialRampToValueAtTime(0.1, t + 0.03); g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    s.connect(lp); lp.connect(g); bus(g, x, 0.14);
    s.start(t); s.stop(t + 0.22);
    click(t, 285, 9, 0.18, 0.05, x, 0.14);
    mode(t, 235, 0.9, 0.05, 0.08, "sine", x, 0.1);
  }
  // THE cup sound: the ball drops in, knocks the plastic bottom, rebounds
  // smaller, and rattles to rest inside the hollow cavity
  function sndSink() {
    if (!actx || !soundOn) return;
    var t = actx.currentTime, x = cup.x;
    function knock(tt, m) {
      click(tt, 800, 1, 0.01, 0.11 * m, x, 0.16, "lowpass");
      mode(tt, 425 * rnd(0.97, 1.05), 0.9, 0.07, 0.13 * m, "triangle", x, 0.2);
      mode(tt, 152, 0.75, 0.05, 0.11 * m, "sine", x, 0.1);
    }
    knock(t, 1);
    knock(t + 0.07 + rnd(0, 0.015), 0.55);
    knock(t + 0.13 + rnd(0, 0.02), 0.3);
    for (var i = 0; i < 4; i++) {
      var tt = t + 0.18 + i * 0.026 + rnd(0, 0.012);
      click(tt, rnd(1150, 1750), 3, 0.008, 0.028 * Math.pow(0.6, i), x, 0.18);
    }
  }
  // celebratory voice: fundamental + chorus detune + soft octave, blooming in the hall
  function pluck(tt, f0, vol, dur) {
    var o = actx.createOscillator(); o.type = "triangle"; o.frequency.value = f0;
    var o2 = actx.createOscillator(); o2.type = "triangle"; o2.frequency.value = f0 * Math.pow(2, 4 / 1200);
    var o3 = actx.createOscillator(); o3.type = "sine"; o3.frequency.value = f0 * 2;
    [[o, vol], [o2, vol * 0.4], [o3, vol * 0.28]].forEach(function (p) {
      var g = actx.createGain();
      g.gain.setValueAtTime(0.0001, tt); g.gain.exponentialRampToValueAtTime(p[1], tt + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0008, tt + dur);
      p[0].connect(g); bus(g, null, 0.3); p[0].start(tt); p[0].stop(tt + dur + 0.03);
    });
  }
  function sndAce() {
    if (!actx || !soundOn) return;
    var t = actx.currentTime, notes = [0, 4, 7, 12, 16];
    notes.forEach(function (st, i) { pluck(t + 0.14 + i * 0.08, 523.25 * Math.pow(2, st / 12), 0.13, 0.5); });
  }
  function sndFanfare() {
    if (!actx || !soundOn) return;
    var t = actx.currentTime;
    var seq = [0, 4, 7, 12, 7, 12, 16, 19];
    seq.forEach(function (st, i) { pluck(t + i * 0.11, 392 * Math.pow(2, st / 12), 0.12, 0.6); });
    [0, 4, 7, 12].forEach(function (st) { pluck(t + seq.length * 0.11 + 0.1, 392 * Math.pow(2, st / 12), 0.07, 1.3); });
    var b = actx.createOscillator(); b.type = "sine"; b.frequency.setValueAtTime(196, t); b.frequency.exponentialRampToValueAtTime(261.6, t + 0.9);
    var bg = actx.createGain(); bg.gain.setValueAtTime(0.0001, t); bg.gain.exponentialRampToValueAtTime(0.16, t + 0.06); bg.gain.exponentialRampToValueAtTime(0.001, t + 1.3);
    b.connect(bg); bus(bg, null, 0.25); b.start(t); b.stop(t + 1.35);
  }
  // continuous felt-roll bed: the quiet rumble of the ball on carpet, going
  // gritty and bright over sand; keyed to speed, panned with the ball
  function updateRoll() {
    if (!actx || !rollGain) return;
    var now = actx.currentTime;
    var moving = !settled && sinking <= 0 && !transit && splashHide <= 0 && !done;
    var sp = moving ? Math.min(1, Math.hypot(ball.vx, ball.vy) / 800) : 0;
    if (sp < 0.05) sp = 0;
    var sand = sp > 0 && inList(cur.sand, ball.x, ball.y, 0);
    rollGain.gain.setTargetAtTime(!soundOn || sp === 0 ? 0 : (sand ? 0.05 + sp * 0.05 : sp * 0.045), now, 0.07);
    rollFilt.frequency.setTargetAtTime(sand ? 1500 + sp * 600 : 320 + sp * 620, now, 0.09);
    if (rollPan) rollPan.pan.setTargetAtTime(panOf(ball.x), now, 0.12);
  }

  // ---------- boot ----------
  resize();
  buildPlan();
  newHole();
  setTimeout(function () { hintEl.classList.add("is-gone"); }, 6500);
  requestAnimationFrame(frame);
})();
