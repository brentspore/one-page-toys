/* Jettison — a cargo bay in zero g, packed solid. Drag a module and it
 * follows your finger through whatever space there is; drag it into an
 * airlock of its own color and it is jettisoned into space. Clear the hold.
 *
 * rules.js is the rules (shared with the offline level builder and the hint
 * worker), levels.js is the generated pack, audio.js the station. This file
 * is the game: layout, the hold, the modules, the drag, undo, hints, the
 * level flow, sharing and challenge links.
 *
 * A level is cell-based; every screen position is cell units times `c`.
 */
(function () {
  "use strict";

  var R = window.JettisonRules, AU = window.JettisonAudio, RAW = window.JETTISON_LEVELS || [];
  var GONE = R.GONE, DX = R.DX, DY = R.DY;

  // hazard-bright cargo colors, each with its own glyph so color is never the
  // only cue
  var COLORS = [
    { name: "Orange", base: "#ff8a2a", hi: "#ffc07a", lo: "#b04a08", glyph: "tri" },
    { name: "Cyan", base: "#2fd3ff", hi: "#a6ecff", lo: "#0b6f96", glyph: "circle" },
    { name: "Lime", base: "#8fe04a", hi: "#cdf59c", lo: "#3f7a14", glyph: "square" },
    { name: "Magenta", base: "#ff4f9a", hi: "#ffa8cb", lo: "#9a1450", glyph: "diamond" },
    { name: "Yellow", base: "#ffd23f", hi: "#fff0a8", lo: "#a17a00", glyph: "plus" },
    { name: "Violet", base: "#a083ff", hi: "#d4c7ff", lo: "#4a2fa8", glyph: "star" }
  ];

  var KEY_LEVEL = "jettison_level", KEY_BEST = "jettison_best", KEY_SOUND = "jettison_sound", KEY_TIPS = "jettison_tips";

  var el = {
    canvas: document.getElementById("c"),
    hud: document.getElementById("hud"),
    lvl: document.getElementById("lvl"), moves: document.getElementById("moves"),
    par: document.getElementById("par"), parK: document.getElementById("parK"),
    tip: document.getElementById("tip"),
    bar: document.getElementById("bar"),
    undoBtn: document.getElementById("undoBtn"), restartBtn: document.getElementById("restartBtn"),
    hintBtn: document.getElementById("hintBtn"), menuBtn: document.getElementById("menuBtn"),
    soundBtn: document.getElementById("soundBtn"),
    overlay: document.getElementById("overlay"),
    ovEyebrow: document.getElementById("ovEyebrow"), ovTitle: document.getElementById("ovTitle"),
    ovText: document.getElementById("ovText"), ovDemo: document.getElementById("ovDemo"),
    ovBtn: document.getElementById("ovBtn"), chBtn: document.getElementById("chBtn"),
    levelsBtn: document.getElementById("levelsBtn"), levels: document.getElementById("levels"),
    ovKeys: document.getElementById("ovKeys")
  };
  var ctx = el.canvas.getContext("2d");
  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var coarse = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;

  /* ------------------------------------------------------------- state */

  var G = {
    phase: "menu",          // menu | menu-play | play | clear
    idx: 0, raw: null, level: null,
    st: null, hist: [], moves: 0,
    pos: [],                // drawn position of each module, easing after the real one
    drag: null,             // { i, x0, y0, offX, offY, tx, ty, kb, hitKey }
    out: [],                // modules on their way out through an airlock
    fx: {},                 // per module: nudge
    drift: [], puffs: [],
    doors: [],              // per airlock: open 0..1, target, glow, hold
    cursor: 0, held: false, showCursor: false,   // keyboard
    hint: null,             // { i, x, y, d, t }
    challenge: null,
    clock: 0, shake: 0, clearT: 0, clearAt: 0,
    deepest: 0, best: {}, tipsSeen: {},
    jettisoned: 0
  };

  /* ------------------------------------------------------------ layout */

  var W = 0, H = 0, DPR = 1, c = 40, ox = 0, oy = 0, BT = 0.5;   // BT: bulkhead thickness, cells
  var bg = null, deck = null;

  function layout() {
    W = window.innerWidth; H = window.innerHeight;
    DPR = Math.min(2, window.devicePixelRatio || 1);
    el.canvas.width = Math.round(W * DPR); el.canvas.height = Math.round(H * DPR);
    var land = W > H * 1.1 && H < 560;
    var narrow = W < 620;
    var topRes = land ? 16 : 104, botRes = land ? 16 : narrow ? 128 : 88;
    var sideRes = land ? 150 : 12;
    var L = G.level || { W: 6, H: 6 };
    var uw = L.W + BT * 2 + 0.3, uh = L.H + BT * 2 + 0.3;
    c = Math.min((W - sideRes * 2) / uw, (H - topRes - botRes) / uh, 84);
    c = Math.max(18, c);
    ox = Math.round(W / 2 - (L.W * c) / 2);
    oy = Math.round(topRes + (H - topRes - botRes - L.H * c) / 2);
    buildBg();
    if (G.level) buildDeck();
  }

  function sx(x) { return ox + x * c; }
  function sy(y) { return oy + y * c; }

  /* ---------------------------------------------------------- the void */

  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function buildBg() {
    bg = document.createElement("canvas");
    bg.width = Math.round(W * DPR); bg.height = Math.round(H * DPR);
    var x = bg.getContext("2d");
    x.scale(DPR, DPR);
    x.fillStyle = "#03050a"; x.fillRect(0, 0, W, H);
    var r = rng(77);
    // soft nebulae, cold and a little warm, far off
    [[0.18, 0.22, "rgba(40,80,170,0.20)"], [0.86, 0.78, "rgba(120,40,140,0.14)"], [0.7, 0.12, "rgba(30,120,150,0.10)"]].forEach(function (n) {
      var g = x.createRadialGradient(W * n[0], H * n[1], 0, W * n[0], H * n[1], Math.max(W, H) * 0.6);
      g.addColorStop(0, n[2]); g.addColorStop(1, "rgba(0,0,0,0)");
      x.fillStyle = g; x.fillRect(0, 0, W, H);
    });
    // a planet's limb, enormous, lit from the side: the station is in orbit
    var px = W * 1.05, py = H * 1.25, pr = Math.max(W, H) * 0.75;
    var pg = x.createRadialGradient(px - pr * 0.35, py - pr * 0.4, pr * 0.2, px, py, pr);
    pg.addColorStop(0, "rgba(40,90,150,0.55)"); pg.addColorStop(0.8, "rgba(12,30,60,0.55)"); pg.addColorStop(1, "rgba(10,20,40,0)");
    x.fillStyle = pg; x.beginPath(); x.arc(px, py, pr, 0, 6.283); x.fill();
    x.strokeStyle = "rgba(120,200,255,0.35)"; x.lineWidth = 2;
    x.beginPath(); x.arc(px, py, pr * 0.985, Math.PI * 1.02, Math.PI * 1.48); x.stroke();
    var n = Math.round(W * H / 2600);
    for (var i = 0; i < n; i++) {
      var s = r(), a = 0.25 + r() * 0.7;
      x.fillStyle = s > 0.92 ? "rgba(255,230,200," + a + ")" : s > 0.8 ? "rgba(190,215,255," + a + ")" : "rgba(255,255,255," + a * 0.8 + ")";
      var sz = s > 0.97 ? 1.6 : s > 0.85 ? 1.1 : 0.7;
      x.fillRect(r() * W, r() * H, sz, sz);
    }
  }

  /* ------------------------------------------------- outlines of cell sets */

  // Every boundary loop of a set of cells, as corners in order, each flagged
  // convex or concave (so outer corners round and inner ones stay crisp).
  // Edges run with the set on their right, so outer loops go clockwise on
  // screen and the loop round a hole goes the other way.
  function loopsOf(list, has) {
    var edges = {}, k;
    function add(a, b, p, q) { var key = a + "," + b; (edges[key] || (edges[key] = [])).push([p, q]); }
    for (k = 0; k < list.length; k++) {
      var x = list[k][0], y = list[k][1];
      if (!has(x, y - 1)) add(x, y, x + 1, y);
      if (!has(x + 1, y)) add(x + 1, y, x + 1, y + 1);
      if (!has(x, y + 1)) add(x + 1, y + 1, x, y + 1);
      if (!has(x - 1, y)) add(x, y + 1, x, y);
    }
    var loops = [];
    for (var key0 in edges) {
      while (edges[key0] && edges[key0].length) {
        var start = key0.split(",").map(Number), pts = [], cur = start, guard = 0;
        do {
          pts.push(cur);
          var kk = cur[0] + "," + cur[1], outs = edges[kk];
          if (!outs || !outs.length) break;
          var nx = outs.pop();
          if (!outs.length) delete edges[kk];
          cur = nx;
        } while ((cur[0] !== start[0] || cur[1] !== start[1]) && ++guard < 2000);
        var v = [];
        for (k = 0; k < pts.length; k++) {
          var p = pts[(k - 1 + pts.length) % pts.length], q = pts[k], n = pts[(k + 1) % pts.length];
          var ax = q[0] - p[0], ay = q[1] - p[1], bx = n[0] - q[0], by = n[1] - q[1];
          var cr = ax * by - ay * bx;
          if (cr !== 0) v.push({ x: q[0], y: q[1], convex: cr > 0, ax: ax, ay: ay, bx: bx, by: by });
        }
        if (v.length > 2) loops.push(v);
      }
    }
    return loops;
  }

  var outlineCache = {};
  function outline(shape) {
    if (outlineCache[shape]) return outlineCache[shape];
    var cells = R.SHAPES[shape], set = {};
    cells.forEach(function (q) { set[q[0] + "," + q[1]] = 1; });
    return (outlineCache[shape] = loopsOf(cells, function (x, y) { return !!set[x + "," + y]; })[0]);
  }

  // trace a loop at screen offset (px, py), inset by `ins` px (negative grows
  // it), corner radius `rad` px on convex corners; `cont` adds to the path
  function tracePath(x, v, px, py, ins, rad, cont) {
    var n = v.length, P = [];
    for (var k = 0; k < n; k++) {
      var q = v[k], ia = norm(q.ax, q.ay), ib = norm(q.bx, q.by);
      P.push({ x: px + q.x * c + (-ia[1] - ib[1]) * ins, y: py + q.y * c + (ia[0] + ib[0]) * ins, convex: q.convex });
    }
    if (!cont) x.beginPath();
    x.moveTo((P[0].x + P[1].x) / 2, (P[0].y + P[1].y) / 2);
    for (var j = 1; j <= n; j++) {
      var a = P[j % n], b = P[(j + 1) % n];
      if (a.convex && rad > 0) x.arcTo(a.x, a.y, b.x, b.y, rad);
      else x.lineTo(a.x, a.y);
    }
    x.closePath();
  }
  function shapePath(x, shape, px, py, ins, rad) { tracePath(x, outline(shape), px, py, ins, rad); }
  function norm(dx, dy) { var l = Math.abs(dx) + Math.abs(dy) || 1; return [dx / l, dy / l]; }

  /* ---------------------------------------------------- the hold (static) */

  function active(x, y) { var L = G.level; return x >= 0 && y >= 0 && x < L.W && y < L.H && !!L.active[y * L.W + x]; }

  // per level: the hold's outline, and how far open space runs behind each
  // airlock (an exit is drawn down that corridor)
  function prepHold() {
    var L = G.level, list = [];
    for (var y = 0; y < L.H; y++) for (var x = 0; x < L.W; x++) if (L.active[y * L.W + x]) list.push([x, y]);
    G.loops = loopsOf(list, active);
    L.gates.forEach(function (g) {
      var d = R.SIDE.indexOf(g.side), run = 0;
      for (var k = 1; k < 40; k++) {
        var px = d < 2 ? g.line + DX[d] * k : g.from, py = d < 2 ? g.from : g.line + DY[d] * k;
        if (px < 0 || py < 0 || px >= L.W || py >= L.H) { run = 40; break; }
        if (active(px, py)) break;
        run = k;
      }
      g.d = d; g.open = run;
    });
  }

  function buildDeck() {
    var L = G.level, w = L.W, h = L.H;
    deck = document.createElement("canvas");
    deck.width = Math.round(W * DPR); deck.height = Math.round(H * DPR);
    var x = deck.getContext("2d");
    x.scale(DPR, DPR);
    var bt = BT * c, L0 = sx(0), T0 = sy(0), xx, yy, k;

    // the hull round the bay, following the hold's own outline
    var hull = x.createLinearGradient(0, T0 - bt, 0, T0 + h * c + bt);
    hull.addColorStop(0, "#5c6a86"); hull.addColorStop(0.5, "#39445a"); hull.addColorStop(1, "#262e3e");
    x.fillStyle = hull;
    x.beginPath();
    G.loops.forEach(function (v) { tracePath(x, v, L0, T0, -bt, bt * 0.7, true); });
    x.fill("nonzero");
    x.strokeStyle = "rgba(255,255,255,0.2)"; x.lineWidth = 1;
    x.beginPath();
    G.loops.forEach(function (v) { tracePath(x, v, L0, T0, -bt + 0.5, bt * 0.7, true); });
    x.stroke();
    x.strokeStyle = "rgba(0,0,0,0.5)";
    x.beginPath();
    G.loops.forEach(function (v) { tracePath(x, v, L0, T0, -1, 0, true); });
    x.stroke();

    // the deck: one plate per cell, each a touch different, bevelled
    var r = rng(w * 131 + h * 17 + L.gates.length + L.blocks.length * 7);
    for (yy = 0; yy < h; yy++) for (xx = 0; xx < w; xx++) {
      if (!active(xx, yy)) continue;
      var px = sx(xx), py = sy(yy), v = (r() - 0.5) * 6;
      x.fillStyle = "rgb(" + Math.round(24 + v) + "," + Math.round(30 + v) + "," + Math.round(44 + v) + ")";
      x.fillRect(px, py, c, c);
      x.fillStyle = "rgba(255,255,255,0.045)"; x.fillRect(px + 1, py + 1, c - 2, 1.2);
      x.fillStyle = "rgba(0,0,0,0.35)"; x.fillRect(px, py + c - 1, c, 1);
      x.fillStyle = "rgba(0,0,0,0.25)"; x.fillRect(px + c - 1, py, 1, c);
      x.fillStyle = "rgba(0,0,0,0.28)";
      for (var a = 0; a < 3; a++) for (var b = 0; b < 3; b++) {
        x.beginPath(); x.arc(px + c * (0.25 + a * 0.25), py + c * (0.25 + b * 0.25), Math.max(0.6, c * 0.018), 0, 6.283); x.fill();
      }
    }
    // pools of light from the overhead floods
    x.save();
    x.beginPath();
    for (yy = 0; yy < h; yy++) for (xx = 0; xx < w; xx++) if (active(xx, yy)) x.rect(sx(xx), sy(yy), c, c);
    x.clip();
    x.globalCompositeOperation = "lighter";
    [[0.3, 0.3], [0.72, 0.62], [0.45, 0.85]].forEach(function (q) {
      var lx = L0 + w * c * q[0], ly = T0 + h * c * q[1], lr = Math.max(w, h) * c * 0.42;
      var lg = x.createRadialGradient(lx, ly, 0, lx, ly, lr);
      lg.addColorStop(0, "rgba(150,180,230,0.07)"); lg.addColorStop(1, "rgba(0,0,0,0)");
      x.fillStyle = lg; x.fillRect(L0, T0, w * c, h * c);
    });
    x.restore();

    // along every wall: the shadow under the bulkhead and a hazard stripe,
    // broken where an airlock opens
    var band = Math.max(2, c * 0.07), ish = 0.22 * c, strips = [];
    for (yy = 0; yy < h; yy++) for (xx = 0; xx < w; xx++) {
      if (!active(xx, yy)) continue;
      for (var d = 0; d < 4; d++) {
        if (active(xx + DX[d], yy + DY[d])) continue;
        strips.push({ x: xx, y: yy, d: d, gate: gateAt(xx, yy, d) });
      }
    }
    strips.forEach(function (s) {
      var px = sx(s.x), py = sy(s.y), gx0 = px, gy0 = py, gx1 = px, gy1 = py;
      if (s.d === 0) gx1 = px + ish; else if (s.d === 1) { gx0 = px + c; gx1 = px + c - ish; }
      else if (s.d === 2) gy1 = py + ish; else { gy0 = py + c; gy1 = py + c - ish; }
      var g = x.createLinearGradient(gx0, gy0, gx1, gy1);
      g.addColorStop(0, "rgba(0,0,0,0.42)"); g.addColorStop(1, "rgba(0,0,0,0)");
      x.fillStyle = g; x.fillRect(px, py, c, c);
    });
    x.save();
    x.beginPath();
    strips.forEach(function (s) {
      if (s.gate) return;
      var px = sx(s.x), py = sy(s.y);
      if (s.d === 0) x.rect(px, py, band, c); else if (s.d === 1) x.rect(px + c - band, py, band, c);
      else if (s.d === 2) x.rect(px, py, c, band); else x.rect(px, py + c - band, c, band);
    });
    x.clip();
    x.fillStyle = "rgba(255,200,40,0.55)"; x.fillRect(L0, T0, w * c, h * c);
    x.fillStyle = "rgba(10,10,12,0.75)";
    for (k = -h * c; k < w * c + h * c; k += band * 2.4) {
      x.beginPath(); x.moveTo(L0 + k, T0); x.lineTo(L0 + k + band * 1.2, T0); x.lineTo(L0 + k + band * 1.2 - h * c, T0 + h * c); x.lineTo(L0 + k - h * c, T0 + h * c); x.closePath(); x.fill();
    }
    x.restore();

    // bolts along the hull, one per cell of wall
    x.fillStyle = "rgba(10,14,22,0.55)";
    strips.forEach(function (s) {
      if (s.gate) return;
      var cx = sx(s.x + 0.5) + DX[s.d] * (c * 0.5 + bt * 0.5), cy = sy(s.y + 0.5) + DY[s.d] * (c * 0.5 + bt * 0.5);
      bolt(x, cx - DY[s.d] * c * 0.3, cy - DX[s.d] * c * 0.3); bolt(x, cx + DY[s.d] * c * 0.3, cy + DX[s.d] * c * 0.3);
    });

    // lane markings: chevrons in each airlock's color on the cells in front of it
    L.gates.forEach(function (g) {
      var col = COLORS[g.color % COLORS.length], ang = [Math.PI, 0, -Math.PI / 2, Math.PI / 2][g.d];
      x.save();
      x.globalAlpha = 0.22;
      x.fillStyle = col.base;
      for (var a2 = g.from; a2 <= g.to; a2++) {
        var cx = g.d < 2 ? sx(g.line + 0.5) : sx(a2 + 0.5), cy = g.d < 2 ? sy(a2 + 0.5) : sy(g.line + 0.5);
        chevron(x, cx, cy, ang, c * 0.22);
        chevron(x, cx - Math.cos(ang) * c * 0.22, cy - Math.sin(ang) * c * 0.22, ang, c * 0.22);
      }
      x.restore();
    });

    // the airlock openings cut clean through the hull: open space behind
    // (the doors are drawn live)
    L.gates.forEach(function (g) {
      var o = gateRect(g);
      x.clearRect(o.x, o.y, o.w, o.h);
      x.strokeStyle = "rgba(0,0,0,0.6)"; x.lineWidth = 2; x.strokeRect(o.x - 1, o.y - 1, o.w + 2, o.h + 2);
    });
  }

  function gateAt(x, y, d) {
    var gs = G.level.gates;
    for (var k = 0; k < gs.length; k++) {
      var g = gs[k];
      if (g.d !== d || g.line !== (d < 2 ? x : y)) continue;
      var a = d < 2 ? y : x;
      if (g.from <= a && a <= g.to) return g;
    }
    return null;
  }

  function bolt(x, px, py) { x.beginPath(); x.arc(px, py, Math.max(1, c * 0.04), 0, 6.283); x.fill(); }
  function chevron(x, cx, cy, ang, s) {
    x.save(); x.translate(cx, cy); x.rotate(ang);
    x.beginPath(); x.moveTo(-s * 0.5, -s * 0.6); x.lineTo(s * 0.2, 0); x.lineTo(-s * 0.5, s * 0.6);
    x.lineTo(-s * 0.2, s * 0.6); x.lineTo(s * 0.5, 0); x.lineTo(-s * 0.2, -s * 0.6); x.closePath(); x.fill();
    x.restore();
  }

  // an airlock's opening in screen space (inside the hull band)
  function gateRect(g) {
    var bt = BT * c, inset = c * 0.08, span = (g.to - g.from + 1) * c - inset * 2;
    if (g.side === "L") return { x: sx(g.line) - bt * 0.85 - 0.5, y: sy(g.from) + inset, w: bt * 0.85, h: span };
    if (g.side === "R") return { x: sx(g.line + 1) + 0.5, y: sy(g.from) + inset, w: bt * 0.85, h: span };
    if (g.side === "T") return { x: sx(g.from) + inset, y: sy(g.line) - bt * 0.85 - 0.5, w: span, h: bt * 0.85 };
    return { x: sx(g.from) + inset, y: sy(g.line + 1) + 0.5, w: span, h: bt * 0.85 };
  }

  /* ------------------------------------------------------- the modules */

  function drawModule(x, i, px, py, opts) {
    var b = G.level.blocks[i], col = COLORS[b.color % COLORS.length], v = outline(b.shape);
    var ins = c * 0.06, rad = c * 0.16, depth = c * 0.12;
    opts = opts || {};
    x.save();
    var lift = opts.lift || 0;
    // the shadow on the deck: it floats, so the shadow sits off and soft
    x.save();
    x.shadowColor = "rgba(0,0,0,0.55)";
    x.shadowBlur = c * (0.16 + lift * 0.3);
    x.shadowOffsetX = c * (0.06 + lift * 0.1);
    x.shadowOffsetY = c * (0.12 + lift * 0.18);
    x.fillStyle = "rgba(0,0,0,0.35)";
    tracePath(x, v, px, py + depth * 0.3, ins, rad);
    x.fill();
    x.restore();
    var top = py - lift * c * 0.08;
    // the body: extruded down so it reads as a box
    x.fillStyle = col.lo;
    for (var k = depth; k > 0; k -= Math.max(1, depth / 6)) { tracePath(x, v, px, top + k, ins, rad); x.fill(); }
    // the lid
    var g = x.createLinearGradient(px, top, px + b.info.w * c, top + b.info.h * c);
    g.addColorStop(0, col.hi); g.addColorStop(0.35, col.base); g.addColorStop(1, col.lo);
    x.fillStyle = g;
    tracePath(x, v, px, top, ins, rad);
    x.fill();
    x.save();
    tracePath(x, v, px, top, ins, rad);
    x.clip();
    // container ribs along the long axis, and a recessed rim
    x.strokeStyle = "rgba(0,0,0,0.12)"; x.lineWidth = Math.max(1, c * 0.025);
    var along = b.info.w >= b.info.h, n = Math.round((along ? b.info.h : b.info.w) * 4);
    for (var r2 = 1; r2 < n; r2++) {
      x.beginPath();
      if (along) { var yy = top + (r2 / n) * b.info.h * c; x.moveTo(px, yy); x.lineTo(px + b.info.w * c, yy); }
      else { var xx = px + (r2 / n) * b.info.w * c; x.moveTo(xx, top); x.lineTo(xx, top + b.info.h * c); }
      x.stroke();
    }
    x.strokeStyle = "rgba(0,0,0,0.32)"; x.lineWidth = c * 0.13;
    tracePath(x, v, px, top, ins, rad); x.stroke();
    x.strokeStyle = "rgba(255,255,255,0.3)"; x.lineWidth = Math.max(1, c * 0.03);
    tracePath(x, v, px - c * 0.015, top - c * 0.02, ins + c * 0.035, rad); x.stroke();
    x.restore();
    // reinforced corners: the cargo-container cue
    cornerCaps(x, v, px, top, ins);
    // a stencilled cargo code on a second cell, where there is one
    var cc = centerCell(b);
    if (b.info.cells.length > 1) {
      var sc = null;
      for (var q = 0; q < b.info.cells.length && !sc; q++) if (b.info.cells[q] !== cc) sc = b.info.cells[q];
      x.fillStyle = "rgba(0,0,0,0.32)";
      x.font = "700 " + Math.max(7, Math.round(c * 0.15)) + "px 'Geist Mono', ui-monospace, monospace";
      x.textAlign = "center"; x.textBaseline = "middle";
      x.fillText(String.fromCharCode(65 + b.color) + (i + 10), px + (sc[0] + 0.5) * c, top + (sc[1] + 0.5) * c);
      x.textBaseline = "alphabetic";
    }
    // glyph on the cell nearest the middle
    glyph(x, col.glyph, px + (cc[0] + 0.5) * c, top + (cc[1] + 0.5) * c, c * 0.2, "rgba(255,255,255,0.92)", "rgba(0,0,0,0.35)");
    // a status light, glowing
    var lc = b.info.cells[0];
    var lx = px + (lc[0] + 0.2) * c, ly = top + (lc[1] + 0.2) * c;
    x.fillStyle = "rgba(255,255,255,0.9)";
    x.beginPath(); x.arc(lx, ly, Math.max(1.2, c * 0.035), 0, 6.283); x.fill();
    x.globalCompositeOperation = "lighter";
    var lg = x.createRadialGradient(lx, ly, 0, lx, ly, c * 0.14);
    lg.addColorStop(0, col.hi); lg.addColorStop(1, "rgba(0,0,0,0)");
    x.fillStyle = lg; x.beginPath(); x.arc(lx, ly, c * 0.14, 0, 6.283); x.fill();
    x.globalCompositeOperation = "source-over";
    if (opts.ring) {
      x.strokeStyle = opts.ring; x.lineWidth = Math.max(2, c * 0.06);
      tracePath(x, v, px, top, ins - c * 0.06, rad + c * 0.06); x.stroke();
    }
    x.restore();
  }

  function cornerCaps(x, v, px, py, ins) {
    var len = c * 0.2, o = ins + c * 0.045;
    x.save();
    x.lineCap = "round";
    for (var k = 0; k < v.length; k++) {
      var q = v[k];
      if (!q.convex) continue;
      var ia = norm(q.ax, q.ay), ib = norm(q.bx, q.by);
      var vx = px + q.x * c + (-ia[1] - ib[1]) * o, vy = py + q.y * c + (ia[0] + ib[0]) * o;
      x.strokeStyle = "rgba(20,22,30,0.5)"; x.lineWidth = Math.max(1.5, c * 0.06);
      x.beginPath(); x.moveTo(vx - ia[0] * len, vy - ia[1] * len); x.lineTo(vx, vy); x.lineTo(vx + ib[0] * len, vy + ib[1] * len); x.stroke();
      x.strokeStyle = "rgba(255,255,255,0.22)"; x.lineWidth = Math.max(1, c * 0.02);
      x.beginPath(); x.moveTo(vx - ia[0] * len, vy - ia[1] * len); x.lineTo(vx, vy); x.lineTo(vx + ib[0] * len, vy + ib[1] * len); x.stroke();
    }
    x.restore();
  }

  function centerCell(b) {
    var mx = 0, my = 0, cells = b.info.cells, k;
    for (k = 0; k < cells.length; k++) { mx += cells[k][0] + 0.5; my += cells[k][1] + 0.5; }
    mx /= cells.length; my /= cells.length;
    var best = cells[0], bd = 99;
    for (k = 0; k < cells.length; k++) {
      var d = Math.abs(cells[k][0] + 0.5 - mx) + Math.abs(cells[k][1] + 0.5 - my);
      if (d < bd) { bd = d; best = cells[k]; }
    }
    return best;
  }

  function tri(x, cx, cy, ang, s) {
    x.save(); x.translate(cx, cy); x.rotate(ang);
    x.beginPath(); x.moveTo(s, 0); x.lineTo(-s * 0.6, -s * 0.8); x.lineTo(-s * 0.6, s * 0.8); x.closePath(); x.fill();
    x.restore();
  }

  function glyph(x, kind, cx, cy, s, fill, stroke) {
    x.save();
    x.translate(cx, cy);
    x.beginPath();
    if (kind === "tri") { x.moveTo(0, -s); x.lineTo(s * 0.92, s * 0.62); x.lineTo(-s * 0.92, s * 0.62); x.closePath(); }
    else if (kind === "circle") { x.arc(0, 0, s * 0.82, 0, 6.283); }
    else if (kind === "square") { x.rect(-s * 0.72, -s * 0.72, s * 1.44, s * 1.44); }
    else if (kind === "diamond") { x.moveTo(0, -s); x.lineTo(s * 0.85, 0); x.lineTo(0, s); x.lineTo(-s * 0.85, 0); x.closePath(); }
    else if (kind === "plus") {
      var t = s * 0.34;
      x.moveTo(-t, -s); x.lineTo(t, -s); x.lineTo(t, -t); x.lineTo(s, -t); x.lineTo(s, t); x.lineTo(t, t);
      x.lineTo(t, s); x.lineTo(-t, s); x.lineTo(-t, t); x.lineTo(-s, t); x.lineTo(-s, -t); x.lineTo(-t, -t); x.closePath();
    } else {
      for (var k = 0; k < 10; k++) {
        var a = -Math.PI / 2 + k * Math.PI / 5, rr = k % 2 ? s * 0.45 : s;
        if (k) x.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); else x.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      x.closePath();
    }
    if (stroke) { x.strokeStyle = stroke; x.lineWidth = Math.max(1, s * 0.3); x.stroke(); }
    x.fillStyle = fill; x.fill();
    x.restore();
  }

  /* ------------------------------------------------------ the airlocks */

  function drawDoors(x) {
    G.level.gates.forEach(function (g, k) {
      var d = G.doors[k], o = gateRect(g), col = COLORS[g.color % COLORS.length];
      var open = d.open, horiz = g.side === "T" || g.side === "B";
      var glow = 0.45 + d.glow * 0.55 + 0.08 * Math.sin(G.clock * 2 + k);
      x.save();
      x.globalCompositeOperation = "lighter";
      var gx = o.x + o.w / 2, gy = o.y + o.h / 2, gr = Math.max(o.w, o.h) * 0.9;
      var lg = x.createRadialGradient(gx, gy, 0, gx, gy, gr);
      lg.addColorStop(0, hexA(col.base, 0.3 * glow)); lg.addColorStop(1, "rgba(0,0,0,0)");
      x.fillStyle = lg; x.fillRect(gx - gr, gy - gr, gr * 2, gr * 2);
      x.restore();
      // door leaves sliding apart along the bulkhead
      x.save();
      x.beginPath(); x.rect(o.x, o.y, o.w, o.h); x.clip();
      var leafCol = "#2b3344";
      if (horiz) {
        var lw = o.w / 2 * (1 - open);
        doorLeaf(x, o.x, o.y, lw, o.h, leafCol, true);
        doorLeaf(x, o.x + o.w - lw, o.y, lw, o.h, leafCol, true);
      } else {
        var lh = o.h / 2 * (1 - open);
        doorLeaf(x, o.x, o.y, o.w, lh, leafCol, false);
        doorLeaf(x, o.x, o.y + o.h - lh, o.w, lh, leafCol, false);
      }
      x.restore();
      x.strokeStyle = hexA(col.base, 0.65 + 0.35 * glow); x.lineWidth = Math.max(1.5, c * 0.05);
      x.strokeRect(o.x, o.y, o.w, o.h);
      // too wide for this lock: a red flash on the frame
      if (d.deny > 0) {
        x.strokeStyle = "rgba(255,70,60," + (d.deny * (0.6 + 0.4 * Math.sin(G.clock * 40))).toFixed(3) + ")";
        x.lineWidth = Math.max(2, c * 0.08);
        x.strokeRect(o.x - 2, o.y - 2, o.w + 4, o.h + 4);
      }
      // an arrow on the door: this way out
      x.fillStyle = hexA(col.hi, 0.55 + 0.4 * glow);
      tri(x, gx, gy, [Math.PI, 0, -Math.PI / 2, Math.PI / 2][g.d], Math.min(o.w, o.h) * 0.32);
    });
  }

  // each airlock throws its color across the deck in front of it
  function laneLight(x) {
    x.save();
    x.globalCompositeOperation = "lighter";
    G.level.gates.forEach(function (g, k) {
      var col = COLORS[g.color % COLORS.length], d = G.doors[k];
      var a = 0.07 + d.glow * 0.18 + d.open * 0.1, depth = 1.6 * c, span = (g.to - g.from + 1) * c, rx, ry, rw, rh, x0, y0, x1, y1;
      if (g.side === "L") { rx = sx(g.line); ry = sy(g.from); rw = depth; rh = span; x0 = rx; y0 = 0; x1 = rx + depth; y1 = 0; }
      else if (g.side === "R") { rx = sx(g.line + 1) - depth; ry = sy(g.from); rw = depth; rh = span; x0 = sx(g.line + 1); y0 = 0; x1 = rx; y1 = 0; }
      else if (g.side === "T") { rx = sx(g.from); ry = sy(g.line); rw = span; rh = depth; x0 = 0; y0 = ry; x1 = 0; y1 = ry + depth; }
      else { rx = sx(g.from); ry = sy(g.line + 1) - depth; rw = span; rh = depth; x0 = 0; y0 = sy(g.line + 1); x1 = 0; y1 = ry; }
      var lg = x.createLinearGradient(x0, y0, x1, y1);
      lg.addColorStop(0, hexA(col.base, a)); lg.addColorStop(1, "rgba(0,0,0,0)");
      x.fillStyle = lg; x.fillRect(rx, ry, rw, rh);
    });
    x.restore();
  }

  // port red, starboard green, blinking on the hull's outer corners
  function navLights(x) {
    if (!G.loops || !G.loops.length) return;
    var bt = BT * c, outer = G.loops[0], spots = [];
    G.loops.forEach(function (v) { if (v.length > outer.length) outer = v; });
    outer.forEach(function (q) {
      if (!q.convex) return;
      var ia = norm(q.ax, q.ay), ib = norm(q.bx, q.by);
      spots.push({ x: sx(q.x) - (-ia[1] - ib[1]) * bt * 0.5, y: sy(q.y) - (ia[0] + ib[0]) * bt * 0.5, port: q.x * 2 < G.level.W });
    });
    spots.forEach(function (q, k) {
      var lit = (G.clock + k * 0.2) % 1.6 < 0.12, rgb = q.port ? "255,70,60" : "70,255,140";
      x.fillStyle = "rgba(" + rgb + "," + (lit ? 1 : 0.35) + ")";
      x.beginPath(); x.arc(q.x, q.y, Math.max(1.5, c * 0.045), 0, 6.283); x.fill();
      if (lit) {
        x.globalCompositeOperation = "lighter";
        var g = x.createRadialGradient(q.x, q.y, 0, q.x, q.y, c * 0.5);
        g.addColorStop(0, "rgba(" + rgb + ",0.45)"); g.addColorStop(1, "rgba(0,0,0,0)");
        x.fillStyle = g; x.beginPath(); x.arc(q.x, q.y, c * 0.5, 0, 6.283); x.fill();
        x.globalCompositeOperation = "source-over";
      }
    });
  }

  function doorLeaf(x, l, t, w, h, colr, horiz) {
    if (w <= 0.5 || h <= 0.5) return;
    x.fillStyle = colr; x.fillRect(l, t, w, h);
    x.fillStyle = "rgba(255,200,40,0.55)";
    var n = 4;
    for (var k = 0; k < n; k++) {
      if (horiz) x.fillRect(l + w * (k + 0.3) / n, t + h * 0.25, w / n * 0.3, h * 0.5);
      else x.fillRect(l + w * 0.25, t + h * (k + 0.3) / n, w * 0.5, h / n * 0.3);
    }
    x.strokeStyle = "rgba(0,0,0,0.5)"; x.lineWidth = 1; x.strokeRect(l + 0.5, t + 0.5, w - 1, h - 1);
  }
  function hexA(h, a) {
    var n = parseInt(h.slice(1), 16);
    return "rgba(" + (n >> 16 & 255) + "," + (n >> 8 & 255) + "," + (n & 255) + "," + Math.max(0, Math.min(1, a)).toFixed(3) + ")";
  }

  /* ------------------------------------------------------------- levels */

  function loadProgress() {
    G.deepest = parseInt(store(KEY_LEVEL) || "0", 10) || 0;
    try { G.best = JSON.parse(store(KEY_BEST) || "{}") || {}; } catch (e) { G.best = {}; }
    try { G.tipsSeen = JSON.parse(store(KEY_TIPS) || "{}") || {}; } catch (e) { G.tipsSeen = {}; }
  }

  function setLevel(idx) {
    idx = Math.max(0, Math.min(RAW.length - 1, idx));
    G.idx = idx;
    G.raw = RAW[idx];
    G.level = R.prepare(G.raw);
    G.st = G.level.start.slice();
    G.hist = [G.st.slice()];
    G.moves = 0;
    G.pos = [];
    for (var i = 0; i < G.level.blocks.length; i++) G.pos.push({ x: G.st[2 * i], y: G.st[2 * i + 1] });
    G.drag = null; G.out = []; G.fx = {}; G.drift = []; G.puffs = [];
    G.doors = G.level.gates.map(function () { return { open: 0, target: 0, glow: 0, hold: 0 }; });
    G.held = false; G.hint = null; G.cursor = 0; G.jettisoned = 0; G.clearAt = 0;
    prepHold();
  }

  function startLevel(idx) {
    setLevel(idx);
    G.phase = "play";
    layout();
    hudSync();
    showTip();
    AU.start();
    gtagSafe("level_start", { toy: "jettison", level: G.idx + 1 });
  }

  function showTip() {
    var t = G.raw.tip, chall = G.challenge && G.challenge.level === G.idx + 1;
    var text = chall ? "A friend cleared this hold in " + G.challenge.moves + " moves. Beat it." : t && !G.tipsSeen[G.idx] ? t : "";
    if (!text) { el.tip.hidden = true; return; }
    if (t) { G.tipsSeen[G.idx] = 1; store(KEY_TIPS, JSON.stringify(G.tipsSeen)); }
    flashTip(text, chall ? 6000 : 7000);
  }
  function flashTip(t, ms) {
    el.tip.textContent = t; el.tip.hidden = false; el.tip.classList.remove("is-out");
    clearTimeout(flashTip.t);
    flashTip.t = setTimeout(function () { el.tip.classList.add("is-out"); setTimeout(function () { el.tip.hidden = true; }, 500); }, ms || 2600);
  }

  function hudSync() {
    el.lvl.textContent = String(G.idx + 1);
    el.moves.textContent = String(G.moves);
    var chall = G.challenge && G.challenge.level === G.idx + 1;
    el.parK.textContent = chall ? "Beat" : "Par";
    el.par.textContent = chall ? String(G.challenge.moves) : String(G.level.par);
    el.par.classList.toggle("is-target", !!chall);
    el.moves.classList.toggle("is-over", G.moves > G.level.par);
    el.undoBtn.disabled = G.hist.length < 2;
    el.restartBtn.disabled = G.hist.length < 2;
  }

  /* --------------------------------------------------------- the drag
   * A held module follows the finger a cell at a time through free space,
   * sliding along whatever it meets. Pressed into an airlock of its own
   * color that it fits, it goes. One drag is one move. */

  function alive(i) { return G.st[2 * i] !== GONE; }
  function mass(i) { return G.level.blocks[i].info.cells.length; }
  function panOf(cx) { return Math.max(-0.85, Math.min(0.85, (cx / G.level.W) * 2 - 1)); }

  function grab(i, offX, offY, kb) {
    if (G.phase !== "play" || !alive(i)) return;
    G.drag = { i: i, x0: G.st[2 * i], y0: G.st[2 * i + 1], offX: offX, offY: offY, tx: G.st[2 * i], ty: G.st[2 * i + 1], kb: !!kb, hitKey: "" };
    G.hint = null;
    AU.grab(panOf(G.st[2 * i] + G.level.blocks[i].info.w / 2), mass(i));
  }

  // one cell in direction d, if there is room; false if not
  function step(i, d) {
    var occ = R.buildOcc(G.level, G.st), x = G.st[2 * i] + DX[d], y = G.st[2 * i + 1] + DY[d];
    if (!R.fits(G.level, occ, i, x, y)) return false;
    G.st[2 * i] = x; G.st[2 * i + 1] = y;
    G.drag.hitKey = "";
    AU.step(mass(i), panOf(x + G.level.blocks[i].info.w / 2));
    return true;
  }

  // up against something going d: its own airlock takes it, anything else
  // is a knock (once per contact, not once per pointer event)
  function pressed(i, d) {
    var occ = R.buildOcc(G.level, G.st), x = G.st[2 * i], y = G.st[2 * i + 1];
    if (R.canExit(G.level, occ, i, x, y, d)) { jettison(i, d); return true; }
    var key = x + "," + y + "," + d;
    if (G.drag.hitKey === key) return false;
    G.drag.hitKey = key;
    var b = G.level.blocks[i], hit = -1;
    // against an airlock of its own color that it does not fit: say so
    for (var k0 = 0; k0 < b.info.cells.length; k0++) {
      var gx = x + b.info.cells[k0][0], gy = y + b.info.cells[k0][1];
      if (active(gx + DX[d], gy + DY[d])) continue;
      var g0 = gateAt(gx, gy, d);
      if (g0 && g0.color === b.color) {
        var gk = G.level.gates.indexOf(g0);
        G.doors[gk].deny = 1;
        AU.deny(panOf(gx + 0.5));
        return false;
      }
    }
    // what it met: the first other module in the way, or hull
    for (var k = 0; k < b.info.cells.length && hit < 0; k++) {
      var cx = x + b.info.cells[k][0] + DX[d], cy = y + b.info.cells[k][1] + DY[d];
      if (cx < 0 || cy < 0 || cx >= G.level.W || cy >= G.level.H) continue;
      var o = occ[cy * G.level.W + cx];
      if (o > 0 && o !== i + 1) hit = o - 1;
    }
    if (hit >= 0) G.fx[hit] = { nud: 1, nudT: 0, d: d, mass: mass(i) };
    AU.knock(mass(i), hit >= 0 ? mass(hit) : 0, panOf(x + b.info.w / 2));
    return false;
  }

  // walk the held module toward where the finger wants it
  function follow() {
    var D = G.drag;
    if (!D) return;
    var i = D.i;
    for (var guard = 0; guard < 40 && G.drag; guard++) {
      var ex = D.tx - G.st[2 * i], ey = D.ty - G.st[2 * i + 1];
      var stx = ex > 0.5 ? 1 : ex < -0.5 ? -1 : 0, sty = ey > 0.5 ? 1 : ey < -0.5 ? -1 : 0;
      if (!stx && !sty) break;
      var dx = stx < 0 ? 0 : 1, dy = sty < 0 ? 2 : 3;
      var first = Math.abs(ex) >= Math.abs(ey) ? (stx ? dx : dy) : (sty ? dy : dx);
      var second = first < 2 ? (sty ? dy : -1) : (stx ? dx : -1);
      if (step(i, first)) continue;
      if (second >= 0 && step(i, second)) continue;
      if (pressed(i, first)) return;
      if (second >= 0 && pressed(i, second)) return;
      break;
    }
  }

  function release(cancel) {
    var D = G.drag;
    if (!D) return;
    G.drag = null;
    var i = D.i, x = G.st[2 * i], y = G.st[2 * i + 1];
    if (cancel) { G.st[2 * i] = D.x0; G.st[2 * i + 1] = D.y0; AU.drop(mass(i), 0.15, panOf(D.x0)); return; }
    if (x === D.x0 && y === D.y0) { AU.drop(mass(i), 0.1, panOf(x)); return; }
    // let go touching its own airlock: it goes, as part of the same move
    var d = R.exitDir(G.level, R.buildOcc(G.level, G.st), i, x, y);
    if (d >= 0) { jettison(i, d); return; }
    commit();
    AU.drop(mass(i), 0.5, panOf(x + G.level.blocks[i].info.w / 2));
  }

  function commit() {
    G.hist.push(G.st.slice());
    G.moves = G.hist.length - 1;
    hudSync();
  }

  function jettison(i, d) {
    G.drag = null;
    var b = G.level.blocks[i], x = G.st[2 * i], y = G.st[2 * i + 1];
    var gate = R.canExit(G.level, R.buildOcc(G.level, G.st), i, x, y, d);
    var gi = G.level.gates.indexOf(gate);
    G.st[2 * i] = GONE; G.st[2 * i + 1] = GONE;
    G.jettisoned++;
    commit();
    G.out.push({ i: i, x: x, y: y, d: d, t: 0, s: 0, v: 3, gi: gi, len: d < 2 ? b.info.w : b.info.h });
    if (gi >= 0) { G.doors[gi].target = 1; G.doors[gi].glow = 1; G.doors[gi].hold = 0; }
    var pan = panOf(x + b.info.w / 2);
    AU.airlock(pan, mass(i));
    AU.jettison(G.jettisoned, pan);
    ventPuff(i, x, y, d);
    if (G.hint && G.hint.i === i) G.hint = null;
    if (R.isGoal(G.st)) { G.clearAt = G.clock + (reduceMotion ? 0.2 : 0.7); G.phase = "clearing"; }
  }

  function undo() {
    if (G.drag || G.hist.length < 2 || G.phase !== "play") return;
    G.hist.pop();
    G.st = G.hist[G.hist.length - 1].slice();
    G.moves = G.hist.length - 1;
    // anything brought back in eases home from where it left
    G.out = G.out.filter(function (o) { return !alive(o.i); });
    G.drift = G.drift.filter(function (m) { return !alive(m.i); });
    G.jettisoned = G.level.blocks.length - R.alive(G.st);
    G.hint = null;
    hudSync();
    AU.undo();
  }

  function restart() {
    if (G.drag || G.phase !== "play" || G.hist.length < 2) return;
    G.hist = [G.level.start.slice()];
    G.st = G.level.start.slice();
    G.out = []; G.drift = [];
    G.moves = 0; G.jettisoned = 0; G.hint = null;
    hudSync();
    AU.restart();
  }

  /* --------------------------------------------- hints (search in a worker) */

  var worker = null, pending = {}, reqId = 0;
  try {
    worker = new Worker("hint-worker.js?v=2");
    worker.onmessage = function (e) { var cb = pending[e.data.id]; delete pending[e.data.id]; if (cb) cb(e.data); };
    worker.onerror = function () { worker = null; };
  } catch (e) { worker = null; }

  function ask(st, cb) {
    var id = ++reqId;
    if (worker) { pending[id] = cb; worker.postMessage({ id: id, op: "hint", level: G.raw, st: st }); return; }
    // no worker (a file:// open, say): think on the main thread instead
    setTimeout(function () {
      var res = R.solve(G.level, Int16Array.from(st), 120000, 14), m = res.par > 0 && res.path.length ? res.path[0] : null;
      cb({ move: m ? [m.i, m.x, m.y, m.d] : null });
    }, 0);
  }

  function hint() {
    if (G.phase !== "play" || G.drag) return;
    // a jettison on offer is always a right move: no search needed
    var occ = R.buildOcc(G.level, G.st);
    for (var i = 0; i < G.level.blocks.length; i++) {
      if (!alive(i)) continue;
      var list = R.reach(G.level, occ, i, G.st[2 * i], G.st[2 * i + 1]).list;
      for (var k = 0; k < list.length; k++) {
        var d = R.exitDir(G.level, occ, i, list[k][0], list[k][1]);
        if (d >= 0) { showHint([i, list[k][0], list[k][1], d]); return; }
      }
    }
    el.hintBtn.classList.add("is-on");
    var lvlAt = G.idx, movesAt = G.moves;
    ask(Array.prototype.slice.call(G.st), function (res) {
      el.hintBtn.classList.remove("is-on");
      if (lvlAt !== G.idx || movesAt !== G.moves || G.phase !== "play") return;
      if (!res.move) { flashTip("Too tangled to see from here. Try undoing a few moves."); return; }
      showHint(res.move);
    });
  }
  function showHint(m) {
    G.hint = { i: m[0], x: m[1], y: m[2], d: m[3], t: 0 };
    G.cursor = m[0];
    AU.hint();
    gtagSafe("hint", { toy: "jettison", level: G.idx + 1 });
  }

  /* -------------------------------------------------------- level clear */

  function levelClear() {
    G.phase = "clear";
    G.clearT = 0;
    var n = G.idx + 1, m = G.moves, par = G.level.par;
    var prev = G.best[n];
    if (!prev || m < prev) G.best[n] = m;
    store(KEY_BEST, JSON.stringify(G.best));
    if (n > G.deepest) { G.deepest = n; store(KEY_LEVEL, String(n)); }
    AU.clear(G.level.gates.length);
    gtagSafe("level_clear", { toy: "jettison", level: n, moves: m, par: par });
    var chall = G.challenge && G.challenge.level === n ? G.challenge : null;
    if (chall && m < chall.moves) gtagSafe("challenge_beaten", { toy: "jettison", level: n, moves: m });

    window.OPT_SHARE_IMAGE = function () { return shareCanvas(n, m, par); };
    window.OPT_SHARE_LINE = "Level " + n + " in " + m + " moves (par " + par + ")";
    window.OPT_SHARE_TEXT = "I cleared Jettison level " + n + " in " + m + " moves (par " + par + "). Beat it: " + challengeUrl(n, m);

    setTimeout(function () {
      var last = n >= RAW.length;
      var html = "<span class=\"big\">" + m + " moves</span>" +
        (m <= par ? "<span class=\"badge\">" + (m < par ? "Under par" : "Matched par") + "</span><br />" : "Par is " + par + ".<br />") +
        "Best on this hold: " + G.best[n] + "." +
        (chall ? (m < chall.moves ? "<br /><span class=\"win\">You beat your friend's " + chall.moves + ".</span>"
          : m === chall.moves ? "<br />You tied your friend's " + chall.moves + "." : "<br /><span class=\"short\">Your friend did it in " + chall.moves + ".</span>") : "") +
        (last ? "<br /><br /><b>That was the last hold.</b> Every cargo bay is clear." : "");
      showPanel(m <= par ? "Hold clear, at par" : "Hold clear", "Level " + n, html, last ? "Play it again" : "Next level", true);
      el.ovBtn.onclick = function () {
        AU.unlock();
        hidePanel();
        startLevel(last ? G.idx : G.idx + 1);
      };
    }, reduceMotion ? 300 : 1100);
  }

  function challengeUrl(n, m) { return "https://onepagetoys.com/toys/jettison/#l=" + n + "-" + m; }

  /* -------------------------------------------------------------- panel */

  function showPanel(eyebrow, title, html, btn, withChallenge) {
    el.ovEyebrow.textContent = eyebrow;
    el.ovTitle.textContent = title;
    el.ovText.innerHTML = html;
    el.ovBtn.textContent = btn;
    el.ovDemo.setAttribute("hidden", "");   // <svg> has no `hidden` IDL property
    el.chBtn.hidden = !withChallenge;
    el.chBtn.textContent = "Challenge a friend";
    el.levels.hidden = true;
    el.levelsBtn.textContent = "Choose a level";
    el.overlay.hidden = false;
    el.overlay.classList.remove("is-out");
    el.hud.hidden = true; el.bar.hidden = true;
  }
  function hidePanel() {
    el.overlay.classList.add("is-out");
    setTimeout(function () { el.overlay.hidden = true; }, 260);
    el.hud.hidden = false; el.bar.hidden = false;
    window.OPT_SHARE_IMAGE = null; window.OPT_SHARE_LINE = null; window.OPT_SHARE_TEXT = null;
  }

  function openMenu() {
    if (G.drag) release(true);
    var resume = G.level && G.phase === "play";
    if (resume) G.phase = "menu-play";
    showPanel("Cargo bay 7", "Jettison",
      "Level " + (G.idx + 1) + " is waiting where you left it.<br />Pick another hold, or carry on.",
      "Back to level " + (G.idx + 1), false);
    el.ovBtn.onclick = function () { hidePanel(); if (resume) G.phase = "play"; else startLevel(G.idx); };
    buildLevels();
    el.levels.hidden = false;
    el.levelsBtn.textContent = "Hide levels";
  }

  var STAGE_NAMES = { first: "First out", fit: "Fit", path: "Clear a path", room: "Make room", odd: "Odd holds", jam: "Jams", deep: "Deep hold", expert: "Expert" };
  function buildLevels() {
    var html = "", lastStage = null;
    for (var k = 0; k < RAW.length; k++) {
      var s = RAW[k].stage;
      if (s !== lastStage) { html += "<p class=\"levels__stage\">" + (STAGE_NAMES[s] || s) + "</p>"; lastStage = s; }
      var n = k + 1, open = n <= G.deepest + 1 || (G.challenge && G.challenge.level === n);
      var best = G.best[n], cls = "lv" + (best ? " is-done" : "") + (best && best <= RAW[k].par ? " is-par" : "") + (G.level && k === G.idx ? " is-here" : "");
      html += "<button type=\"button\" class=\"" + cls + "\" data-l=\"" + k + "\"" + (open ? "" : " disabled") +
        " aria-label=\"Level " + n + (best ? ", best " + best + " moves, par " + RAW[k].par : "") + "\">" + n + "</button>";
    }
    el.levels.innerHTML = html;
  }
  el.levels.addEventListener("click", function (e) {
    var b = e.target.closest ? e.target.closest(".lv") : null;
    if (!b || b.disabled) return;
    AU.unlock();
    hidePanel();
    startLevel(+b.getAttribute("data-l"));
  });
  el.levelsBtn.addEventListener("click", function () {
    if (el.levels.hidden) { buildLevels(); el.levels.hidden = false; el.levelsBtn.textContent = "Hide levels"; }
    else { el.levels.hidden = true; el.levelsBtn.textContent = "Choose a level"; }
  });

  /* -------------------------------------------------------------- update */

  function update(dt) {
    G.clock += dt;
    if (!G.level) return;
    var k, i;
    // drawn positions chase the real ones: quick, so a drag feels attached
    var ease = reduceMotion ? 1 : Math.min(1, dt * 26);
    for (i = 0; i < G.level.blocks.length; i++) {
      if (!alive(i)) continue;
      var p = G.pos[i], tx = G.st[2 * i], ty = G.st[2 * i + 1];
      if (G.drag && G.drag.i === i && !G.drag.kb) {
        // a little strain toward the finger when something is in the way
        var ex = G.drag.tx - tx, ey = G.drag.ty - ty;
        tx += Math.max(-0.12, Math.min(0.12, ex * 0.3)); ty += Math.max(-0.12, Math.min(0.12, ey * 0.3));
      }
      p.x += (tx - p.x) * ease; p.y += (ty - p.y) * ease;
    }
    // modules leaving through their airlocks, then drifting off into space
    for (k = G.out.length - 1; k >= 0; k--) {
      var o = G.out[k];
      o.t += dt; o.v += dt * 34; o.s += o.v * dt;
      if (o.s > o.len + BT + 0.4) {
        G.drift.push({ i: o.i, x: o.x + DX[o.d] * o.s, y: o.y + DY[o.d] * o.s, dx: DX[o.d], dy: DY[o.d], v: o.v * 0.4, t: 0, rot: 0, w: (Math.random() - 0.5) * 1.6 });
        G.out.splice(k, 1);
      }
    }
    for (k = 0; k < G.doors.length; k++) {
      var d = G.doors[k], busy = G.out.some(function (q) { return q.gi === k; });
      if (d.target && !busy) { d.hold += dt; if (d.hold > 0.25) { d.target = 0; d.hold = 0; } }
      d.open += (d.target - d.open) * Math.min(1, dt * 14);
      d.glow = Math.max(0, d.glow - dt * 1.4);
      if (d.deny) d.deny = Math.max(0, d.deny - dt * 2.2);
    }
    // a held module lights the airlocks it is allowed through
    if (G.drag && alive(G.drag.i)) {
      var col = G.level.blocks[G.drag.i].color;
      G.level.gates.forEach(function (g, gk) { if (g.color === col) G.doors[gk].glow = Math.max(G.doors[gk].glow, 0.45); });
    }
    for (var f in G.fx) {
      var e = G.fx[f];
      if (e.nud !== undefined) { e.nudT += dt; if (e.nudT > 0.25) delete G.fx[f]; }
    }
    for (k = G.drift.length - 1; k >= 0; k--) {
      var m = G.drift[k];
      m.t += dt;
      m.v = Math.max(0.9, m.v - dt * 10);
      m.x += m.dx * m.v * dt; m.y += m.dy * m.v * dt;
      m.rot += m.w * dt;
      if (m.t > 5) G.drift.splice(k, 1);
    }
    for (k = G.puffs.length - 1; k >= 0; k--) { var pf = G.puffs[k]; pf.t += dt; pf.x += pf.vx * dt; pf.y += pf.vy * dt; pf.vx *= 1 - 3 * dt; pf.vy *= 1 - 3 * dt; if (pf.t > pf.max) G.puffs.splice(k, 1); }
    if (G.hint) { G.hint.t += dt; if (G.hint.t > 5) G.hint = null; }
    G.shake = Math.max(0, G.shake - dt * 6);
    if (G.phase === "clearing" && G.clock >= G.clearAt) levelClear();
    if (G.phase === "clear") {
      G.clearT += dt;
      for (k = 0; k < G.doors.length; k++) if (G.clearT > k * 0.12 && G.clearT < k * 0.12 + 0.1) G.doors[k].glow = 1;
    }
  }

  function ventPuff(i, x, y, d) {
    if (reduceMotion) return;
    var b = G.level.blocks[i];
    for (var k = 0; k < 14; k++) {
      var px = d < 2 ? (d === 0 ? x : x + b.info.w) : x + Math.random() * b.info.w;
      var py = d >= 2 ? (d === 2 ? y : y + b.info.h) : y + Math.random() * b.info.h;
      G.puffs.push({ x: px, y: py, vx: DX[d] * (2 + Math.random() * 3) + (Math.random() - 0.5) * 2, vy: DY[d] * (2 + Math.random() * 3) + (Math.random() - 0.5) * 2, t: 0, max: 0.5 + Math.random() * 0.4, r: 0.12 + Math.random() * 0.16 });
    }
  }

  /* -------------------------------------------------------------- render */

  function render() {
    var x = ctx;
    x.setTransform(1, 0, 0, 1, 0, 0);
    if (bg) x.drawImage(bg, 0, 0);
    if (!G.level) return;
    x.setTransform(DPR, 0, 0, DPR, 0, 0);
    var k, j;

    // jettisoned modules out in the dark, behind the hull
    for (j = 0; j < G.drift.length; j++) drawDrift(x, G.drift[j]);

    x.setTransform(1, 0, 0, 1, 0, 0);
    if (deck) x.drawImage(deck, 0, 0);
    x.setTransform(DPR, 0, 0, DPR, 0, 0);

    laneLight(x);
    drawDoors(x);
    navLights(x);

    // modules on their way out, clipped to their airlock's corridor so they
    // slide INTO the wall and out through the opening
    G.out.forEach(function (o) {
      var g = G.level.gates[o.gi];
      x.save();
      if (g) {
        var a0 = sx(g.d < 2 ? g.line : g.from), b0 = sy(g.d < 2 ? g.from : g.line);
        // an inner airlock opens into a cut-out: stop at the hull across it,
        // and the module drifts on beneath the far side of the station
        var span = (g.to - g.from + 1) * c, run = (g.open >= 40 ? 40 : g.open - BT) * c;
        x.beginPath();
        if (g.d === 0) x.rect(a0 - run, b0, run + c * 4, span);
        else if (g.d === 1) x.rect(a0 - c * 3, b0, run + c * 4, span);
        else if (g.d === 2) x.rect(a0, b0 - run, span, run + c * 4);
        else x.rect(a0, b0 - c * 3, span, run + c * 4);
        x.clip();
      }
      drawModule(x, o.i, sx(o.x + DX[o.d] * o.s), sy(o.y + DY[o.d] * o.s), {});
      x.restore();
    });

    var L = G.level, order = [];
    for (var i = 0; i < L.blocks.length; i++) if (alive(i)) order.push(i);
    // back to front so extrusions overlap correctly; the held one on top
    order.sort(function (a, b) {
      var ha = G.drag && G.drag.i === a ? 1 : 0, hb = G.drag && G.drag.i === b ? 1 : 0;
      return ha - hb || (G.pos[a].y + L.blocks[a].info.h) - (G.pos[b].y + L.blocks[b].info.h);
    });
    for (k = 0; k < order.length; k++) {
      var mi = order[k], p = drawPos(mi), held = G.drag && G.drag.i === mi;
      var bob = reduceMotion || held ? 0 : Math.sin(G.clock * 1.4 + mi * 1.7) * c * 0.01;
      var ring = null;
      if (G.hint && G.hint.i === mi) ring = hexA("#ffffff", 0.5 + 0.5 * Math.sin(G.hint.t * 8));
      else if (held) ring = G.drag.kb ? "rgba(255,210,90,0.95)" : "rgba(255,255,255,0.75)";
      else if (!coarse && G.cursor === mi && G.phase === "play" && G.showCursor) ring = "rgba(255,255,255,0.55)";
      drawModule(x, mi, sx(p.x), sy(p.y) + bob, { lift: held ? 1 : 0, ring: ring });
    }

    if (G.hint) drawHint(x);

    // gas and vents
    x.globalCompositeOperation = "lighter";
    for (j = 0; j < G.puffs.length; j++) {
      var pf = G.puffs[j], u = pf.t / pf.max, rr = (pf.r + u * 0.25) * c;
      var gg = x.createRadialGradient(sx(pf.x), sy(pf.y), 0, sx(pf.x), sy(pf.y), rr);
      gg.addColorStop(0, "rgba(220,235,255," + (0.35 * (1 - u)).toFixed(3) + ")");
      gg.addColorStop(1, "rgba(0,0,0,0)");
      x.fillStyle = gg; x.beginPath(); x.arc(sx(pf.x), sy(pf.y), rr, 0, 6.283); x.fill();
    }
    x.globalCompositeOperation = "source-over";
  }

  function drawPos(i) {
    var p = G.pos[i], x = p.x, y = p.y, f = G.fx[i];
    if (f && f.nud !== undefined && !reduceMotion) {
      var k = Math.sin(Math.min(1, f.nudT / 0.25) * Math.PI) * 0.05 * Math.min(1.5, (f.mass || 1) / 2);
      x += DX[f.d] * k; y += DY[f.d] * k;
    }
    return { x: x, y: y };
  }

  function drawDrift(x, m) {
    var b = G.level.blocks[m.i], u = Math.min(1, m.t / 4);
    var scale = 1 - u * 0.45, alpha = 1 - Math.max(0, (m.t - 2.2) / 2.6);
    if (alpha <= 0) return;
    x.save();
    x.globalAlpha = Math.max(0, alpha);
    var cx = sx(m.x + b.info.w / 2), cy = sy(m.y + b.info.h / 2);
    x.translate(cx, cy); x.rotate(m.rot); x.scale(scale, scale); x.translate(-cx, -cy);
    drawModule(x, m.i, sx(m.x), sy(m.y), {});
    x.restore();
  }

  // the hint: where to take it (a dashed outline), and out through the lock
  function drawHint(x) {
    var h = G.hint, b = G.level.blocks[h.i];
    if (!alive(h.i)) return;
    var col = COLORS[b.color % COLORS.length], pulse = 0.6 + 0.4 * Math.sin(h.t * 6);
    x.save();
    x.setLineDash([c * 0.12, c * 0.08]);
    x.strokeStyle = hexA(col.hi, 0.9 * pulse); x.lineWidth = Math.max(1.5, c * 0.05);
    x.fillStyle = hexA(col.base, 0.14);
    var moving = h.x !== G.st[2 * h.i] || h.y !== G.st[2 * h.i + 1];
    if (moving) { shapePath(x, b.shape, sx(h.x), sy(h.y), c * 0.06, c * 0.16); x.fill(); x.stroke(); }
    x.setLineDash([]);
    if (h.d >= 0) {
      var cx = sx(h.x + b.info.w / 2), cy = sy(h.y + b.info.h / 2);
      var off = ((h.d < 2 ? b.info.w : b.info.h) / 2 + BT + 0.25 + 0.12 * Math.sin(h.t * 6)) * c;
      x.fillStyle = "rgba(255,255,255," + pulse.toFixed(3) + ")";
      tri(x, cx + DX[h.d] * off, cy + DY[h.d] * off, Math.atan2(DY[h.d], DX[h.d]), c * 0.22);
    }
    x.restore();
  }

  /* --------------------------------------------------------------- input */

  function cellAt(clientX, clientY) {
    var r = el.canvas.getBoundingClientRect();
    return { x: (clientX - r.left - ox) / c, y: (clientY - r.top - oy) / c };
  }
  function moduleAt(cx, cy) {
    var gx = Math.floor(cx), gy = Math.floor(cy);
    if (gx >= 0 && gy >= 0 && gx < G.level.W && gy < G.level.H) {
      var o = R.buildOcc(G.level, G.st)[gy * G.level.W + gx];
      if (o > 0) return o - 1;
    }
    // a touch target may be larger than the art: forgive a near miss
    var best = -1, bd = 0.45;
    for (var i = 0; i < G.level.blocks.length; i++) {
      if (!alive(i)) continue;
      var b = G.level.blocks[i];
      for (var k = 0; k < b.info.cells.length; k++) {
        var mx = G.st[2 * i] + b.info.cells[k][0] + 0.5, my = G.st[2 * i + 1] + b.info.cells[k][1] + 0.5;
        var d = Math.max(Math.abs(cx - mx), Math.abs(cy - my)) - 0.5;
        if (d < bd) { bd = d; best = i; }
      }
    }
    return best;
  }

  var pointerId = null;
  el.canvas.addEventListener("pointerdown", function (e) {
    if (G.phase !== "play" || !G.level || G.drag) return;
    AU.unlock();
    var p = cellAt(e.clientX, e.clientY), i = moduleAt(p.x, p.y);
    if (i < 0) return;
    pointerId = e.pointerId;
    grab(i, p.x - G.st[2 * i], p.y - G.st[2 * i + 1], false);
    G.cursor = i; G.showCursor = false; G.held = false;
    try { el.canvas.setPointerCapture(e.pointerId); } catch (err) {}
    e.preventDefault();
  });
  el.canvas.addEventListener("pointermove", function (e) {
    if (!G.drag || G.drag.kb || e.pointerId !== pointerId) return;
    var p = cellAt(e.clientX, e.clientY);
    G.drag.tx = p.x - G.drag.offX; G.drag.ty = p.y - G.drag.offY;
    follow();
  });
  function pointerEnd(e) {
    if (e.pointerId !== pointerId) return;
    pointerId = null;
    if (G.drag && !G.drag.kb) release(e.type === "pointercancel");
  }
  el.canvas.addEventListener("pointerup", pointerEnd);
  el.canvas.addEventListener("pointercancel", pointerEnd);

  // keyboard: arrows pick a module, Enter takes hold, arrows move it a cell
  // at a time (into its own airlock to jettison), Enter lets go
  function nearestFrom(i, d) {
    var c0 = centerOf(i), best = -1, bs = 1e9;
    for (var j = 0; j < G.level.blocks.length; j++) {
      if (j === i || !alive(j)) continue;
      var cj = centerOf(j), vx = cj.x - c0.x, vy = cj.y - c0.y;
      var along = vx * DX[d] + vy * DY[d], side = Math.abs(vx * DY[d]) + Math.abs(vy * DX[d]);
      if (along <= 0.01) continue;
      var score = along + side * 2;
      if (score < bs) { bs = score; best = j; }
    }
    return best;
  }
  function centerOf(i) { var b = G.level.blocks[i]; return { x: G.st[2 * i] + b.info.w / 2, y: G.st[2 * i + 1] + b.info.h / 2 }; }
  function firstAlive() { for (var i = 0; i < G.level.blocks.length; i++) if (alive(i)) return i; return -1; }
  // the next (or previous) module still aboard, in index order; -1 past the end
  function tabFrom(i, back) {
    var n = G.level.blocks.length, j = !G.showCursor ? (back ? n : -1) : i;
    for (j += back ? -1 : 1; j >= 0 && j < n; j += back ? -1 : 1) if (alive(j)) return j;
    return -1;
  }

  window.addEventListener("keydown", function (e) {
    var k = e.key;
    if (G.phase !== "play") {
      if (k === "Escape" && !el.overlay.hidden && G.phase === "menu-play") { hidePanel(); G.phase = "play"; e.preventDefault(); }
      return;
    }
    if (document.activeElement && document.activeElement.tagName === "BUTTON" && (k === "Enter" || k === " ")) return;
    var dir = k === "ArrowLeft" ? 0 : k === "ArrowRight" ? 1 : k === "ArrowUp" ? 2 : k === "ArrowDown" ? 3 : -1;
    if (dir >= 0) {
      e.preventDefault();
      AU.unlock();
      G.showCursor = true;
      if (G.drag && G.drag.kb) {
        if (!step(G.drag.i, dir)) pressed(G.drag.i, dir);
        return;
      }
      if (G.drag) return;
      if (!alive(G.cursor)) G.cursor = Math.max(0, firstAlive());
      var n = nearestFrom(G.cursor, dir);
      if (n >= 0) { G.cursor = n; AU.tick(); }
      return;
    }
    if (k === "Enter" || k === " ") {
      e.preventDefault(); AU.unlock(); G.showCursor = true;
      if (G.drag && G.drag.kb) { release(false); return; }
      if (G.drag) return;
      if (!alive(G.cursor)) G.cursor = Math.max(0, firstAlive());
      grab(G.cursor, 0, 0, true);
      return;
    }
    // Tab steps through the modules in order (the arrows' nearest-module rule
    // can, rarely, leave one out of reach); past the last one, Tab moves on
    // to the page's own controls as usual
    if (k === "Tab" && !G.drag) {
      var ae = document.activeElement;
      if (ae && ae !== document.body && ae !== el.canvas) return;
      var nx = tabFrom(G.cursor, e.shiftKey);
      if (nx < 0) { G.showCursor = false; return; }
      e.preventDefault(); AU.unlock();
      G.cursor = nx; G.showCursor = true; AU.tick();
      return;
    }
    if (k === "m" || k === "M") { el.soundBtn.click(); return; }
    if (k === "z" || k === "Z" || k === "Backspace") { e.preventDefault(); undo(); return; }
    if (k === "r" || k === "R") { restart(); return; }
    if (k === "h" || k === "H") { hint(); return; }
    if (k === "Escape") { if (G.drag) release(true); else openMenu(); }
  });

  el.undoBtn.addEventListener("click", function () { AU.unlock(); undo(); el.undoBtn.blur(); });
  el.restartBtn.addEventListener("click", function () { AU.unlock(); restart(); el.restartBtn.blur(); });
  el.hintBtn.addEventListener("click", function () { AU.unlock(); hint(); el.hintBtn.blur(); });
  el.menuBtn.addEventListener("click", function () { AU.unlock(); AU.tick(); openMenu(); el.menuBtn.blur(); });
  el.soundBtn.addEventListener("click", function () {
    AU.unlock();
    var v = AU.toggle();
    el.soundBtn.setAttribute("aria-pressed", v ? "true" : "false");
    store(KEY_SOUND, v ? "1" : "0");
  });
  el.chBtn.addEventListener("click", function () {
    var n = G.idx + 1, m = G.moves, url = challengeUrl(n, m);
    var text = "I cleared Jettison level " + n + " in " + m + " moves. Same hold, your turn:";
    gtagSafe("share", { method: "challenge_link", content_type: "toy", item_id: "/toys/jettison/" });
    if (navigator.share && coarse) { navigator.share({ title: "Jettison", text: text, url: url }).catch(function () {}); return; }
    var done = function () { el.chBtn.textContent = "Challenge link copied"; setTimeout(function () { el.chBtn.textContent = "Challenge a friend"; }, 1800); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text + " " + url).then(done, function () { window.prompt("Copy this link:", url); });
    else window.prompt("Copy this link:", url);
  });

  /* -------------------------------------------------------------- share */

  // the hold as it started, with the result: a cleared hold is an empty
  // picture, the jam is the interesting one
  function shareCanvas(n, m, par) {
    var keep = { st: G.st, pos: G.pos, drift: G.drift, out: G.out, drag: G.drag, hint: G.hint, fx: G.fx, puffs: G.puffs };
    G.st = G.level.start.slice(); G.drift = []; G.out = []; G.drag = null; G.hint = null; G.fx = {}; G.puffs = [];
    G.pos = [];
    for (var i = 0; i < G.level.blocks.length; i++) G.pos.push({ x: G.st[2 * i], y: G.st[2 * i + 1] });
    G.doors.forEach(function (d) { d.open = 0; });
    render();
    for (var k in keep) G[k] = keep[k];
    var S = 1080, cv = document.createElement("canvas");
    cv.width = S; cv.height = S;
    var x = cv.getContext("2d");
    x.fillStyle = "#03050a"; x.fillRect(0, 0, S, S);
    var bt = BT * c, l = sx(0) - bt - c * 0.4, t = sy(0) - bt - c * 0.4;
    var w = G.level.W * c + bt * 2 + c * 0.8, h = G.level.H * c + bt * 2 + c * 0.8, side = Math.max(w, h);
    var pad = 70, inner = S - pad * 2 - 180;
    var scale = inner / side, dw = w * scale, dh = h * scale;
    x.drawImage(el.canvas, l * DPR, t * DPR, w * DPR, h * DPR, (S - dw) / 2, pad + 120 + (inner - dh) / 2, dw, dh);
    x.textAlign = "left";
    x.fillStyle = "#ffffff";
    x.shadowColor = "rgba(95,212,255,0.7)"; x.shadowBlur = 26;
    x.font = "900 70px Archivo, system-ui, sans-serif";
    x.fillText("JETTISON", pad, pad + 64);
    x.shadowBlur = 0;
    x.textAlign = "right";
    x.font = "600 30px 'Geist Mono', ui-monospace, monospace";
    x.fillStyle = "#ff9a3c";
    x.fillText("LEVEL " + n, S - pad, pad + 58);
    x.textAlign = "left";
    x.fillStyle = "#eaf2ff";
    x.font = "900 64px Archivo, system-ui, sans-serif";
    x.fillText(m + " moves", pad, S - pad - 4);
    x.font = "600 28px 'Geist Mono', ui-monospace, monospace";
    x.fillStyle = m <= par ? "#ffc84a" : "rgba(214,228,255,0.7)";
    x.textAlign = "right";
    x.fillText(m <= par ? "AT PAR " + par : "PAR " + par, S - pad, S - pad - 12);
    return cv;
  }

  /* ------------------------------------------------------------ helpers */

  function store(k, v) {
    try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); }
    catch (e) { return null; }
  }
  function gtagSafe(n, p) { try { if (typeof gtag === "function") gtag("event", n, p); } catch (e) {} }

  /* --------------------------------------------------------------- loop */

  var last = 0, warned = false;
  function frame(now) {
    var dt = Math.min(0.05, (now - last) / 1000 || 0);
    last = now;
    try { update(dt); } catch (e) { if (!warned) { warned = true; try { console.error("update failed:", e); } catch (e2) {} } }
    try { render(); } catch (e) { if (!warned) { warned = true; try { console.error("render failed:", e); } catch (e2) {} } }
    requestAnimationFrame(frame);
  }

  function init() {
    var on = store(KEY_SOUND) !== "0";
    AU.init(on);
    el.soundBtn.setAttribute("aria-pressed", on ? "true" : "false");
    loadProgress();
    if (!RAW.length) { el.ovText.textContent = "The level pack did not load."; return; }

    var lv = /level=(\d+)/.exec(location.hash || "");
    var m = /l=(\d+)-(\d+)/.exec(location.hash || "");
    if (m && +m[1] >= 1 && +m[1] <= RAW.length) {
      G.challenge = { level: +m[1], moves: +m[2] };
      el.ovEyebrow.textContent = "You've been challenged";
      el.ovText.innerHTML = "<b>A friend cleared level " + G.challenge.level + " in " + G.challenge.moves + " moves.</b> Same hold. Beat it.<br /><br />" + el.ovText.innerHTML;
      el.ovBtn.textContent = "Take the challenge";
      gtagSafe("challenge_open", { toy: "jettison", level: G.challenge.level });
    } else if (G.deepest > 0) {
      el.ovBtn.textContent = G.deepest >= RAW.length ? "Play again" : "Continue at level " + (G.deepest + 1);
    }
    if (coarse) el.ovKeys.textContent = "drag a module with your finger · into its own airlock to jettison it";

    el.ovBtn.onclick = function () {
      AU.unlock();
      hidePanel();
      startLevel(G.challenge ? G.challenge.level - 1 : Math.min(G.deepest, RAW.length - 1));
    };
    if (lv && +lv[1] >= 1 && +lv[1] <= RAW.length) {
      var want = +lv[1] - 1;
      el.ovBtn.textContent = "Play level " + (want + 1);
      el.ovBtn.onclick = function () { AU.unlock(); hidePanel(); startLevel(want); };
    }
    // behind the intro: the next hold, waiting
    setLevel(lv && +lv[1] >= 1 && +lv[1] <= RAW.length ? +lv[1] - 1 : G.challenge ? G.challenge.level - 1 : Math.min(G.deepest, RAW.length - 1));
    layout();
    requestAnimationFrame(frame);
    gtagSafe("toy_open", { toy: "jettison" });
  }

  // a level link (#level=N) or a challenge link (#l=N-M) followed while the
  // page is already open goes straight to that hold
  window.addEventListener("hashchange", function () {
    var h = location.hash || "", lm = /level=(\d+)/.exec(h), cm = /l=(\d+)-(\d+)/.exec(h);
    var n = lm ? +lm[1] : cm ? +cm[1] : 0;
    if (!n || n > RAW.length) return;
    if (G.drag) release(true);
    if (cm) { G.challenge = { level: n, moves: +cm[2] }; gtagSafe("challenge_open", { toy: "jettison", level: n }); }
    if (!el.overlay.hidden) hidePanel();
    startLevel(n - 1);
  });

  var resizeT = null;
  window.addEventListener("resize", function () { clearTimeout(resizeT); resizeT = setTimeout(layout, 80); });
  window.addEventListener("orientationchange", function () { setTimeout(layout, 150); });

  init();
})();
