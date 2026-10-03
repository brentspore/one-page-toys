/* Decant — an apothecary's shelf of potions to sort. Tap a bottle, tap
 * another, and its top potion pours across (same color or an empty bottle
 * only, as much as fits). Every potion in a bottle of its own wins the level.
 *
 * rules.js is the rules and solver (shared with the level builder), levels.js
 * the generated pack, audio.js the sound. This file is the game: layout, the
 * shelf and its candles, the glass and the liquid, the pour, input, undo, the
 * spare bottle, hints, corking, the level flow, sharing and challenge links.
 *
 * Liquid is drawn by VOLUME: a layer's top is wherever the area inside the
 * bottle below it adds up to its share, measured in screen space. Upright
 * that is a plain stack; tilted, the same sum keeps every surface level while
 * the potion runs toward the neck, which is what makes the pour read as liquid.
 */
(function () {
  "use strict";

  var R = window.DecantRules, AU = window.DecantAudio, RAW = window.DECANT_LEVELS || [];

  // potions, each with an alchemical mark so color is never the only cue
  var COLORS = [
    { name: "Crimson", base: "#e8344a", hi: "#ff8a8f", lo: "#7c0f22", glyph: "fire" },
    { name: "Amber", base: "#ff9a1f", hi: "#ffd08a", lo: "#8a3f00", glyph: "sun" },
    { name: "Gold", base: "#ffd43b", hi: "#fff2a8", lo: "#8f6a00", glyph: "salt" },
    { name: "Lime", base: "#9be24a", hi: "#dcffaa", lo: "#3d6e0f", glyph: "earth" },
    { name: "Emerald", base: "#22c47f", hi: "#8ff0c3", lo: "#0a5c3a", glyph: "venus" },
    { name: "Aqua", base: "#2ad4d8", hi: "#a8f6f6", lo: "#0b6266", glyph: "water" },
    { name: "Azure", base: "#4a9dff", hi: "#b2d5ff", lo: "#123f8a", glyph: "air" },
    { name: "Indigo", base: "#5e5cf0", hi: "#b4b3ff", lo: "#221f8a", glyph: "jupiter" },
    { name: "Violet", base: "#a65cf5", hi: "#dcb6ff", lo: "#4b1a8a", glyph: "mercury" },
    { name: "Magenta", base: "#f04bd1", hi: "#ffb0ee", lo: "#7a0f68", glyph: "star" },
    { name: "Rose", base: "#ff8fb4", hi: "#ffd4e2", lo: "#a3375c", glyph: "mars" },
    { name: "Pearl", base: "#e8eefc", hi: "#ffffff", lo: "#8d96ad", glyph: "moon" }
  ];

  var KEY_LEVEL = "decant_level", KEY_BEST = "decant_best", KEY_SOUND = "decant_sound", KEY_TIPS = "decant_tips";

  var el = {
    canvas: document.getElementById("c"),
    hud: document.getElementById("hud"), lvl: document.getElementById("lvl"), moves: document.getElementById("moves"),
    best: document.getElementById("best"), bestK: document.getElementById("bestK"),
    tip: document.getElementById("tip"), bar: document.getElementById("bar"),
    undoBtn: document.getElementById("undoBtn"), restartBtn: document.getElementById("restartBtn"),
    spareBtn: document.getElementById("spareBtn"), hintBtn: document.getElementById("hintBtn"), menuBtn: document.getElementById("menuBtn"),
    soundBtn: document.getElementById("soundBtn"),
    overlay: document.getElementById("overlay"), ovEyebrow: document.getElementById("ovEyebrow"), ovTitle: document.getElementById("ovTitle"),
    ovText: document.getElementById("ovText"), ovDemo: document.getElementById("ovDemo"), ovBtn: document.getElementById("ovBtn"),
    chBtn: document.getElementById("chBtn"), levelsBtn: document.getElementById("levelsBtn"), levels: document.getElementById("levels"),
    ovKeys: document.getElementById("ovKeys")
  };
  var ctx = el.canvas.getContext("2d");
  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var coarse = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;

  /* ------------------------------------------------------------- state */

  var G = {
    phase: "menu",            // menu | menu-play | play | clearing | clear
    idx: 0, raw: null, cap: 4,
    S: null,                  // rules state { t: colors, h: hidden }
    ids: null,                // the same shape, a unique id per layer
    col: [],                  // id -> color
    seen: null,               // ids ever revealed (undo never re-hides them)
    hist: [], moves: 0, spare: false,
    rescue: false,            // stuck: the spare bottle is unlocked (rescue only, owner 2026-10-03)
    vis: [],                  // per bottle: drawn layers [{ id, c, amt, rev }]
    pos: [],                  // per bottle: drawn origin { x, y, a } (bottom center, angle)
    lift: [],                 // per bottle: 0..1 raised for selection
    corked: [],               // per bottle: cork animation 0..1, or -1
    anims: [],                // pours in flight
    sel: -1, cursor: 0, showCursor: false,
    hint: null, sparks: [], motes: [],
    corkedCount: 0, clock: 0, clearAt: 0, clearT: 0,
    challenge: null, deepest: 0, best: {}, tipsSeen: {}
  };

  /* ------------------------------------------------------------ layout */

  var W = 0, H = 0, DPR = 1;
  var L = { bw: 60, rows: [], shelfY: [], home: [] };   // bottle width, rows of bottle indices, shelf tops, home spots
  var bg = null;

  function bottleH(bw, cap) { return bw * (0.08 + cap * unitK(cap) + 0.34 + 0.26 + 0.06); }
  function unitK(cap) { return cap <= 4 ? 0.56 : cap === 5 ? 0.5 : 0.45; }

  function layout() {
    W = window.innerWidth; H = window.innerHeight;
    DPR = Math.min(2, window.devicePixelRatio || 1);
    el.canvas.width = Math.round(W * DPR); el.canvas.height = Math.round(H * DPR);
    var land = W > H * 1.1 && H < 560, narrow = W < 620;
    var top = land ? 18 : 92, bot = land ? 16 : narrow ? 132 : 92, side = land ? 150 : 14;
    var n = G.S ? G.S.t.length : 6, cap = G.cap;
    var availW = W - side * 2, availH = H - top - bot;
    // try 1 to 3 rows; keep the arrangement that gives the biggest bottles
    var best = null;
    for (var rows = 1; rows <= 3; rows++) {
      var per = Math.ceil(n / rows);
      var bwW = availW / (per * 1.42 + 0.3);
      var hPer = bottleH(1, cap) + 0.75;                  // a bottle plus its shelf and headroom, per unit width
      var bwH = availH / (rows * hPer);
      var bw = Math.min(bwW, bwH, 92);
      if (!best || bw > best.bw + 0.5) best = { bw: bw, rows: rows, per: per };
    }
    var bw = Math.max(16, best.bw), per = best.per, rows = best.rows;
    var rowH = bw * (bottleH(1, cap) + 0.75), total = rowH * rows;
    var y0 = top + (availH - total) / 2;
    L.bw = bw; L.rows = []; L.shelfY = []; L.home = [];
    for (var r = 0, k = 0; r < rows; r++) {
      var cnt = Math.min(per, n - k), row = [];
      var pitch = bw * 1.42, x0 = W / 2 - (cnt - 1) * pitch / 2;
      var sy = y0 + rowH * (r + 1) - bw * 0.3;
      for (var j = 0; j < cnt; j++, k++) { row.push(k); L.home[k] = { x: x0 + j * pitch, y: sy }; }
      L.rows.push(row); L.shelfY.push({ y: sy, x0: x0 - pitch * 0.62, x1: x0 + (cnt - 1) * pitch + pitch * 0.62 });
    }
    buildGeom();
    buildBg();
    for (var b = 0; b < n; b++) if (!G.pos[b] || G.pos[b].snap) G.pos[b] = { x: L.home[b].x, y: L.home[b].y, a: 0 };
  }

  /* --------------------------------------------- bottle shape and volume */

  // local coordinates: origin at the bottom center of the glass, y UP, in units
  // of the bottle's width; scaled by L.bw when drawn
  var GEO = null;
  function buildGeom() {
    var cap = G.cap, u = unitK(cap), iw = 0.4, rb = 0.17, yb = 0.08, nw = 0.15;
    var yBody = yb + cap * u, sh = 0.34, nh = 0.26;
    var right = [];
    for (var i = 0; i <= 6; i++) { var a = -Math.PI / 2 + (i / 6) * Math.PI / 2; right.push([iw - rb + Math.cos(a) * rb, yb + rb + Math.sin(a) * rb]); }
    right.push([iw, yBody]);
    for (i = 1; i <= 8; i++) {         // the shoulder, a quadratic from body to neck
      var t = i / 8, cx = iw, cy = yBody + sh * 0.9;
      right.push([(1 - t) * (1 - t) * iw + 2 * (1 - t) * t * cx + t * t * nw, (1 - t) * (1 - t) * yBody + 2 * (1 - t) * t * cy + t * t * (yBody + sh)]);
    }
    right.push([nw, yBody + sh + nh]);
    var poly = [];
    right.forEach(function (p) { poly.push(p); });
    for (i = right.length - 1; i >= 0; i--) poly.push([-right[i][0], right[i][1]]);
    // one layer's volume: the body's area divided by cap
    var area = upArea(poly, yBody);
    GEO = { poly: poly, yb: yb, yBody: yBody, yNeck: yBody + sh + nh, iw: iw, nw: nw, rb: rb, unit: u, V: area / cap, table: upTable(poly, yBody + sh + nh) };
  }

  function halfWidthAt(poly, y) {
    // interior is symmetric: the right side's x at height y
    var best = 0;
    for (var i = 0; i < poly.length; i++) {
      var a = poly[i], b = poly[(i + 1) % poly.length];
      if (a[0] < 0 || b[0] < 0) continue;
      if ((a[1] - y) * (b[1] - y) <= 0 && a[1] !== b[1]) { var x = a[0] + (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]); if (x > best) best = x; }
    }
    return best;
  }
  function upArea(poly, yTo) {
    var s = 0, n = 200, y0 = 0;
    for (var i = 0; i < n; i++) { var y = y0 + (i + 0.5) * (yTo - y0) / n; s += 2 * halfWidthAt(poly, y) * (yTo - y0) / n; }
    return s;
  }
  // upright: cumulative area by height, so volume -> height is a lookup
  function upTable(poly, yTop) {
    var n = 260, ys = [], vs = [], s = 0;
    for (var i = 0; i <= n; i++) {
      var y = (i / n) * yTop;
      if (i) s += 2 * halfWidthAt(poly, y - yTop / n / 2) * (yTop / n);
      ys.push(y); vs.push(s);
    }
    return { ys: ys, vs: vs };
  }
  function upHeight(v) {
    var T = GEO.table, vs = T.vs;
    if (v <= 0) return GEO.yb;
    for (var i = 1; i < vs.length; i++) if (vs[i] >= v) { var f = (v - vs[i - 1]) / (vs[i] - vs[i - 1] || 1); return T.ys[i - 1] + f * (T.ys[i] - T.ys[i - 1]); }
    return T.ys[T.ys.length - 1];
  }

  // local (x, y up, in widths) -> screen, for a bottle at origin o, angle a
  function toScreen(o, a, x, y) {
    var bw = L.bw, vx = x * bw, vy = -y * bw, c = Math.cos(a), s = Math.sin(a);
    return [o.x + vx * c - vy * s, o.y + vx * s + vy * c];
  }
  function screenPoly(o, a) { return GEO.poly.map(function (p) { return toScreen(o, a, p[0], p[1]); }); }

  // tilted: the screen y at which the volume below reaches each target
  function tiltLevels(sp, targets) {
    var minY = 1e9, maxY = -1e9;
    sp.forEach(function (p) { if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1]; });
    var n = 90, dy = (maxY - minY) / n, cum = 0, out = [], ti = 0, scale = L.bw * L.bw;
    for (var i = 0; i < n && ti < targets.length; i++) {
      var y = maxY - (i + 0.5) * dy, xs = [];
      for (var k = 0; k < sp.length; k++) {
        var a = sp[k], b = sp[(k + 1) % sp.length];
        if ((a[1] - y) * (b[1] - y) < 0) xs.push(a[0] + (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]));
      }
      xs.sort(function (p, q) { return p - q; });
      var wdt = 0; for (k = 0; k + 1 < xs.length; k += 2) wdt += xs[k + 1] - xs[k];
      var next = cum + wdt * dy / scale;
      while (ti < targets.length && targets[ti] <= next) {
        var f = wdt > 0 ? (targets[ti] - cum) / (wdt * dy / scale) : 0;
        out.push(maxY - i * dy - f * dy);
        ti++;
      }
      cum = next;
    }
    while (out.length < targets.length) out.push(minY);
    return out;
  }

  /* ---------------------------------------------------------- the room */

  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  var CANDLES = [];
  function buildBg() {
    bg = document.createElement("canvas");
    bg.width = Math.round(W * DPR); bg.height = Math.round(H * DPR);
    var x = bg.getContext("2d");
    x.scale(DPR, DPR);
    // a deep blue-black plaster wall: cool shadows, so the warm light and the
    // potions carry the color (a flat brown room was rejected before)
    var wall = x.createLinearGradient(0, 0, 0, H);
    wall.addColorStop(0, "#070a0f"); wall.addColorStop(0.55, "#0b1016"); wall.addColorStop(1, "#06080b");
    x.fillStyle = wall; x.fillRect(0, 0, W, H);
    var r = rng(91);
    x.globalAlpha = 0.05;
    for (var i = 0; i < W * H / 900; i++) { x.fillStyle = r() < 0.5 ? "#9fb3c8" : "#000"; x.fillRect(r() * W, r() * H, 1 + r() * 2, 1 + r() * 2); }
    x.globalAlpha = 1;
    // stone courses, barely there
    x.strokeStyle = "rgba(160,180,200,0.035)"; x.lineWidth = 1;
    for (var cy = 40, row = 0; cy < H; cy += 56, row++) {
      x.beginPath(); x.moveTo(0, cy); x.lineTo(W, cy); x.stroke();
      for (var cx = (row % 2) * 70; cx < W; cx += 140) { x.beginPath(); x.moveTo(cx, cy); x.lineTo(cx, cy + 56); x.stroke(); }
    }
    // the shelves: ebonized wood, brass brackets
    var bw = L.bw;
    L.shelfY.forEach(function (s) {
      var x0 = Math.max(6, s.x0), x1 = Math.min(W - 6, s.x1), th = Math.max(6, bw * 0.13), fr = Math.max(8, bw * 0.2);
      x.fillStyle = "rgba(0,0,0,0.45)"; x.fillRect(x0 + 6, s.y + th + fr, x1 - x0 - 12, bw * 0.18);    // its shadow on the wall
      var topG = x.createLinearGradient(0, s.y, 0, s.y + th);
      topG.addColorStop(0, "#5a4434"); topG.addColorStop(1, "#2a1f17");
      x.fillStyle = topG; x.fillRect(x0, s.y, x1 - x0, th);
      var fG = x.createLinearGradient(0, s.y + th, 0, s.y + th + fr);
      fG.addColorStop(0, "#1c1611"); fG.addColorStop(1, "#0f0c0a");
      x.fillStyle = fG; x.fillRect(x0, s.y + th, x1 - x0, fr);
      x.strokeStyle = "rgba(255,210,160,0.06)";
      for (var g = 0; g < 4; g++) { x.beginPath(); var gy = s.y + th + fr * (0.25 + g * 0.18); x.moveTo(x0, gy); x.bezierCurveTo(x0 + (x1 - x0) * 0.3, gy + 1.5, x0 + (x1 - x0) * 0.7, gy - 1.5, x1, gy); x.stroke(); }
      x.fillStyle = "rgba(255,225,180,0.22)"; x.fillRect(x0, s.y, x1 - x0, 1);
      [x0 + 18, x1 - 18].forEach(function (bx) {
        x.fillStyle = "#6e5326"; x.fillRect(bx - 3, s.y + th + fr, 6, bw * 0.34);
        x.fillStyle = "rgba(255,220,150,0.35)"; x.fillRect(bx - 3, s.y + th + fr, 1.5, bw * 0.34);
      });
    });
    // candles stand at the ends of the lowest shelf
    var last = L.shelfY[L.shelfY.length - 1];
    CANDLES = [];
    if (last) {
      var ch = Math.max(26, bw * 0.75), cw = Math.max(10, bw * 0.22);
      [[Math.max(cw + 8, last.x0 - cw * 0.2), 1.0], [Math.min(W - cw - 8, last.x1 + cw * 0.2), 0.8]].forEach(function (c, k) {
        CANDLES.push({ x: c[0], y: last.y - ch * c[1], h: ch * c[1], w: cw, seed: k * 3.7 });
      });
    }
    // the vignette
    var v = x.createRadialGradient(W / 2, H * 0.48, Math.min(W, H) * 0.25, W / 2, H / 2, Math.max(W, H) * 0.8);
    v.addColorStop(0, "rgba(0,0,0,0)"); v.addColorStop(1, "rgba(0,0,0,0.6)");
    x.fillStyle = v; x.fillRect(0, 0, W, H);
  }

  function drawCandles(x) {
    CANDLES.forEach(function (c) {
      var t = G.clock + c.seed, fl = reduceMotion ? 1 : 0.86 + 0.08 * Math.sin(t * 11) + 0.06 * Math.sin(t * 23.3 + 1);
      // the wax
      var g = x.createLinearGradient(c.x - c.w / 2, 0, c.x + c.w / 2, 0);
      g.addColorStop(0, "#c9b28c"); g.addColorStop(0.45, "#f3e2c2"); g.addColorStop(1, "#a8916c");
      x.fillStyle = g; x.fillRect(c.x - c.w / 2, c.y, c.w, c.h);
      x.fillStyle = "rgba(255,240,210,0.5)"; x.beginPath(); x.ellipse(c.x, c.y, c.w / 2, c.w * 0.14, 0, 0, 6.283); x.fill();
      x.strokeStyle = "#2a2018"; x.lineWidth = 1.5; x.beginPath(); x.moveTo(c.x, c.y); x.lineTo(c.x, c.y - c.w * 0.4); x.stroke();
      // the flame
      var fh = c.w * 1.5 * fl, fw = c.w * 0.42, sway = reduceMotion ? 0 : Math.sin(t * 3.1) * c.w * 0.08;
      x.save();
      x.globalCompositeOperation = "lighter";
      var halo = x.createRadialGradient(c.x, c.y - fh * 0.6, 0, c.x, c.y - fh * 0.6, c.w * 9 * fl);
      halo.addColorStop(0, "rgba(255,170,70," + (0.22 * fl).toFixed(3) + ")"); halo.addColorStop(1, "rgba(0,0,0,0)");
      x.fillStyle = halo; x.fillRect(c.x - c.w * 10, c.y - c.w * 10, c.w * 20, c.w * 20);
      x.beginPath();
      x.moveTo(c.x - fw, c.y - c.w * 0.35);
      x.quadraticCurveTo(c.x - fw * 1.05, c.y - fh * 0.55, c.x + sway, c.y - fh);
      x.quadraticCurveTo(c.x + fw * 1.05, c.y - fh * 0.55, c.x + fw, c.y - c.w * 0.35);
      x.closePath();
      var fg = x.createLinearGradient(0, c.y - fh, 0, c.y);
      fg.addColorStop(0, "rgba(255,240,200,0.0)"); fg.addColorStop(0.3, "rgba(255,210,120,0.95)"); fg.addColorStop(0.8, "rgba(255,150,40,0.9)"); fg.addColorStop(1, "rgba(90,120,255,0.6)");
      x.fillStyle = fg; x.fill();
      x.restore();
    });
  }

  /* ------------------------------------------------------ alchemy marks */

  function glyph(x, kind, cx, cy, s, col) {
    x.save();
    x.translate(cx, cy);
    x.strokeStyle = col; x.fillStyle = col; x.lineWidth = Math.max(1.2, s * 0.22); x.lineCap = "round"; x.lineJoin = "round";
    x.beginPath();
    var tri = function (up) { var d = up ? 1 : -1; x.moveTo(0, -s * d); x.lineTo(s * 0.92, s * 0.62 * d); x.lineTo(-s * 0.92, s * 0.62 * d); x.closePath(); };
    if (kind === "fire") { tri(true); x.stroke(); }
    else if (kind === "water") { tri(false); x.stroke(); }
    else if (kind === "air") { tri(true); x.moveTo(-s * 0.62, s * 0.12); x.lineTo(s * 0.62, s * 0.12); x.stroke(); }
    else if (kind === "earth") { tri(false); x.moveTo(-s * 0.62, -s * 0.12); x.lineTo(s * 0.62, -s * 0.12); x.stroke(); }
    else if (kind === "sun") { x.arc(0, 0, s * 0.85, 0, 6.283); x.stroke(); x.beginPath(); x.arc(0, 0, s * 0.18, 0, 6.283); x.fill(); }
    else if (kind === "salt") { x.arc(0, 0, s * 0.85, 0, 6.283); x.moveTo(-s * 0.85, 0); x.lineTo(s * 0.85, 0); x.stroke(); }
    else if (kind === "moon") { x.arc(0, 0, s * 0.85, Math.PI * 0.32, Math.PI * 1.68); x.arc(s * 0.45, 0, s * 0.62, Math.PI * 1.55, Math.PI * 0.45, true); x.closePath(); x.fill(); }
    else if (kind === "venus") { x.arc(0, -s * 0.3, s * 0.55, 0, 6.283); x.moveTo(0, s * 0.25); x.lineTo(0, s * 1.0); x.moveTo(-s * 0.4, s * 0.62); x.lineTo(s * 0.4, s * 0.62); x.stroke(); }
    else if (kind === "mars") { x.arc(-s * 0.2, s * 0.2, s * 0.55, 0, 6.283); x.moveTo(s * 0.2, -s * 0.2); x.lineTo(s * 0.85, -s * 0.85); x.moveTo(s * 0.35, -s * 0.85); x.lineTo(s * 0.85, -s * 0.85); x.lineTo(s * 0.85, -s * 0.35); x.stroke(); }
    else if (kind === "mercury") { x.arc(0, -s * 0.1, s * 0.42, 0, 6.283); x.moveTo(-s * 0.42, -s * 0.85); x.quadraticCurveTo(0, -s * 0.4, s * 0.42, -s * 0.85); x.moveTo(0, s * 0.32); x.lineTo(0, s * 1.0); x.moveTo(-s * 0.32, s * 0.68); x.lineTo(s * 0.32, s * 0.68); x.stroke(); }
    else if (kind === "jupiter") { x.moveTo(-s * 0.6, -s * 0.5); x.quadraticCurveTo(0, -s * 1.1, 0, -s * 0.2); x.lineTo(-s * 0.7, s * 0.35); x.lineTo(s * 0.8, s * 0.35); x.moveTo(s * 0.35, -s * 0.2); x.lineTo(s * 0.35, s * 0.95); x.stroke(); }
    else { for (var k = 0; k < 8; k++) { var a = -Math.PI / 2 + k * Math.PI / 4, rr = k % 2 ? s * 0.38 : s; if (k) x.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); else x.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); } x.closePath(); x.fill(); }
    x.restore();
  }

  /* --------------------------------------------------------- the bottles */

  function hexA(h, a) {
    var n = parseInt(h.slice(1), 16);
    return "rgba(" + (n >> 16 & 255) + "," + (n >> 8 & 255) + "," + (n & 255) + "," + Math.max(0, Math.min(1, a)).toFixed(3) + ")";
  }

  function tracePoly(x, sp) { x.beginPath(); x.moveTo(sp[0][0], sp[0][1]); for (var i = 1; i < sp.length; i++) x.lineTo(sp[i][0], sp[i][1]); x.closePath(); }

  function drawBottle(x, b) {
    var p = G.pos[b], bw = L.bw, a = p.a, lift = G.lift[b] || 0;
    var o = { x: p.x, y: p.y - lift * bw * 0.32 };
    var units = G.vis[b] || [], sp = screenPoly(o, a), upright = Math.abs(a) < 0.002;
    // the shadow on the shelf
    if (p.y > L.home[b].y - bw) {
      x.fillStyle = "rgba(0,0,0," + (0.4 * (1 - lift * 0.5)).toFixed(3) + ")";
      x.beginPath(); x.ellipse(L.home[b].x, L.home[b].y + 1, bw * (0.48 - lift * 0.08), bw * 0.07, 0, 0, 6.283); x.fill();
    }
    // the back of the glass
    tracePoly(x, sp);
    x.fillStyle = "rgba(170,210,200,0.05)"; x.fill();
    // the potion, by volume
    var targets = [], acc = 0;
    units.forEach(function (u) { acc += u.amt * GEO.V; targets.push(acc); });
    var ys;
    if (upright) ys = targets.map(function (v) { return o.y - upHeight(v) * bw; });
    else ys = tiltLevels(sp, targets);
    var floorY;
    if (upright) floorY = o.y - GEO.yb * bw + 1;
    else { floorY = -1e9; sp.forEach(function (q) { if (q[1] > floorY) floorY = q[1]; }); }
    if (units.length) {
      x.save();
      tracePoly(x, sp); x.clip();
      var minX = o.x - bw * 2, wid = bw * 4, prevY = floorY;
      for (var i = 0; i < units.length; i++) {
        var u = units[i], yTop = ys[i], c = COLORS[u.c % COLORS.length];
        if (u.amt <= 0.001) continue;
        var grad = x.createLinearGradient(o.x - bw * 0.42, 0, o.x + bw * 0.42, 0);
        grad.addColorStop(0, c.lo); grad.addColorStop(0.35, c.base); grad.addColorStop(0.62, c.hi); grad.addColorStop(1, c.lo);
        x.fillStyle = grad;
        x.fillRect(minX, yTop - 0.5, wid, prevY - yTop + 1);
        // clouded: murk over the color, clearing as it is revealed
        var murk = u.hid ? 1 : u.rev > 0 ? u.rev : 0;
        if (murk > 0) {
          x.fillStyle = "rgba(24,22,30," + (0.94 * murk).toFixed(3) + ")";
          x.fillRect(minX, yTop - 0.5, wid, prevY - yTop + 1);
          x.save();
          x.globalAlpha = 0.5 * murk;
          for (var s = 0; s < 3; s++) {
            var sx = o.x + Math.sin(G.clock * 0.7 + i + s * 2.1) * bw * 0.22, syy = (yTop + prevY) / 2 + Math.cos(G.clock * 0.9 + s) * (prevY - yTop) * 0.2;
            var sg = x.createRadialGradient(sx, syy, 0, sx, syy, bw * 0.35);
            sg.addColorStop(0, "rgba(120,110,140,0.45)"); sg.addColorStop(1, "rgba(0,0,0,0)");
            x.fillStyle = sg; x.fillRect(minX, yTop, wid, prevY - yTop);
          }
          x.restore();
        }
        prevY = yTop;
      }
      // each run of one potion catches the light along its top
      for (i = 0; i < units.length; i++) {
        var top2 = ys[i];
        if (!units[i].hid && units[i].amt > 0.01 && (i + 1 >= units.length || units[i + 1].c !== units[i].c || units[i + 1].hid)) {
          var r0 = i; while (r0 > 0 && units[r0 - 1].c === units[i].c && !units[r0 - 1].hid) r0--;
          var runBot = r0 ? ys[r0 - 1] : floorY, hl = x.createLinearGradient(0, top2, 0, top2 + (runBot - top2) * 0.45);
          hl.addColorStop(0, "rgba(255,255,255,0.2)"); hl.addColorStop(1, "rgba(255,255,255,0)");
          x.fillStyle = hl; x.fillRect(minX, top2, wid, (runBot - top2) * 0.45);
        }
      }
      // the light inside: a soft glow, brightest at the middle
      x.globalCompositeOperation = "lighter";
      // a few bubbles drifting up through it
      if (!reduceMotion && upright) {
        for (var q = 0; q < 3; q++) {
          var ph = (G.clock * (0.16 + q * 0.04) + q * 0.37 + b * 0.173) % 1;
          var by = floorY - ph * (floorY - prevY - bw * 0.05), bx = o.x + Math.sin(q * 2.1 + b) * bw * 0.2 + Math.sin(G.clock * 2 + q + b) * bw * 0.025;
          x.fillStyle = "rgba(255,255,255," + (0.28 * Math.sin(ph * Math.PI)).toFixed(3) + ")";
          x.beginPath(); x.arc(bx, by, bw * (0.018 + q * 0.006), 0, 6.283); x.fill();
        }
      }
      var gl = x.createRadialGradient(o.x - bw * 0.08, (prevY + floorY) / 2, 0, o.x, (prevY + floorY) / 2, bw * 0.9);
      gl.addColorStop(0, "rgba(255,255,255,0.10)"); gl.addColorStop(1, "rgba(255,255,255,0)");
      x.fillStyle = gl; x.fillRect(minX, prevY, wid, floorY - prevY);
      x.globalCompositeOperation = "source-over";
      // the surface: a bright meniscus line
      x.fillStyle = "rgba(255,255,255,0.35)"; x.fillRect(minX, prevY - 0.5, wid, Math.max(1, bw * 0.025));
      x.restore();
      // the marks, one per layer, upright only
      if (upright) {
        var yPrev = floorY;
        for (i = 0; i < units.length; i++) {
          var uu = units[i];
          if (uu.hid || uu.amt < 0.95) { yPrev = ys[i]; continue; }
          var cc = COLORS[uu.c % COLORS.length];
          // one mark per run of the same potion, on its middle layer
          var runStart = i; while (runStart > 0 && units[runStart - 1].c === uu.c && !units[runStart - 1].hid) runStart--;
          var runEnd = i; while (runEnd + 1 < units.length && units[runEnd + 1].c === uu.c && !units[runEnd + 1].hid) runEnd++;
          if (i === Math.floor((runStart + runEnd) / 2)) {
            var yA = runStart ? ys[runStart - 1] : floorY, yB = ys[runEnd];
            glyph(x, cc.glyph, o.x, (yA + yB) / 2, bw * 0.13, uu.c === 11 ? "rgba(40,44,60,0.55)" : "rgba(255,255,255,0.55)");
          }
          yPrev = ys[i];
        }
        // clouded layers carry a "?"
        yPrev = floorY;
        for (i = 0; i < units.length; i++) {
          if (units[i].hid) {
            x.fillStyle = "rgba(220,210,240,0.42)";
            x.font = "600 " + Math.round(bw * 0.26) + "px 'Cormorant Garamond', Georgia, serif";
            x.textAlign = "center"; x.textBaseline = "middle";
            x.fillText("?", o.x, (ys[i] + yPrev) / 2 + bw * 0.01);
            x.textBaseline = "alphabetic";
          }
          yPrev = ys[i];
        }
      }
    }
    // the front of the glass: rim light, walls, a specular streak
    x.save();
    x.lineJoin = "round";
    var outer = GEO.poly.map(function (q) { var sx = q[0] === 0 ? 0 : q[0] + Math.sign(q[0]) * 0.055; return toScreen(o, a, sx, Math.max(0, q[1] - (q[1] < GEO.yb + GEO.rb ? 0.06 : 0))); });
    tracePoly(x, outer);
    x.strokeStyle = "rgba(190,230,215,0.38)"; x.lineWidth = Math.max(1.2, bw * 0.035); x.stroke();
    tracePoly(x, sp);
    x.strokeStyle = "rgba(255,255,255,0.12)"; x.lineWidth = 1; x.stroke();
    // the candlelit streak down the left of the body
    var s0 = toScreen(o, a, -0.27, GEO.yb + 0.2), s1 = toScreen(o, a, -0.27, GEO.yBody + 0.1);
    var sg2 = x.createLinearGradient(s0[0], s0[1], s1[0], s1[1]);
    sg2.addColorStop(0, "rgba(255,240,220,0)"); sg2.addColorStop(0.5, "rgba(255,240,220,0.42)"); sg2.addColorStop(1, "rgba(255,240,220,0)");
    x.strokeStyle = sg2; x.lineWidth = Math.max(1.5, bw * 0.06); x.lineCap = "round";
    x.beginPath(); x.moveTo(s0[0], s0[1]); x.lineTo(s1[0], s1[1]); x.stroke();
    var s2 = toScreen(o, a, 0.3, GEO.yb + 0.3), s3 = toScreen(o, a, 0.3, GEO.yb + 0.65);
    x.strokeStyle = "rgba(255,200,140,0.18)"; x.lineWidth = Math.max(1, bw * 0.03);
    x.beginPath(); x.moveTo(s2[0], s2[1]); x.lineTo(s3[0], s3[1]); x.stroke();
    // the lip at the mouth
    var m0 = toScreen(o, a, -GEO.nw - 0.06, GEO.yNeck), m1 = toScreen(o, a, GEO.nw + 0.06, GEO.yNeck);
    x.strokeStyle = "rgba(220,245,235,0.55)"; x.lineWidth = Math.max(2, bw * 0.06);
    x.beginPath(); x.moveTo(m0[0], m0[1]); x.lineTo(m1[0], m1[1]); x.stroke();
    x.restore();
    // a cork, once the bottle is done
    var ck = G.corked[b];
    if (ck !== undefined && ck >= 0) drawCork(x, o, a, ck);
    // selected, cursor or hinted: a ring of light on the shelf
    var ring = 0;
    if (G.sel === b) ring = 0.8;
    if (G.hint && (G.hint.a === b || G.hint.b === b)) ring = Math.max(ring, 0.55 + 0.45 * Math.sin(G.hint.t * 7));
    if (G.showCursor && G.cursor === b && G.phase === "play") ring = Math.max(ring, 0.45);
    if (ring > 0) {
      x.save();
      x.globalCompositeOperation = "lighter";
      var hx = L.home[b].x, hy = L.home[b].y;
      var rg = x.createRadialGradient(hx, hy, 0, hx, hy, bw * 0.8);
      rg.addColorStop(0, "rgba(255,200,120," + (0.45 * ring).toFixed(3) + ")"); rg.addColorStop(1, "rgba(0,0,0,0)");
      x.fillStyle = rg; x.beginPath(); x.ellipse(hx, hy, bw * 0.8, bw * 0.2, 0, 0, 6.283); x.fill();
      x.restore();
    }
  }

  function drawCork(x, o, a, k) {
    var e = reduceMotion ? 1 : Math.min(1, k);
    var drop = (1 - easeOutBack(e)) * 0.9;
    var w = GEO.nw * 2 + 0.08, h = 0.24;
    var c0 = toScreen(o, a, 0, GEO.yNeck + h * 0.35 + drop);
    x.save();
    x.translate(c0[0], c0[1]); x.rotate(a);
    var bw = L.bw, cw = w * bw, ch = h * bw;
    var g = x.createLinearGradient(-cw / 2, 0, cw / 2, 0);
    g.addColorStop(0, "#8a6440"); g.addColorStop(0.4, "#c79a66"); g.addColorStop(1, "#7a5534");
    x.fillStyle = g;
    x.beginPath(); x.moveTo(-cw * 0.42, ch * 0.5); x.lineTo(-cw * 0.5, -ch * 0.5); x.lineTo(cw * 0.5, -ch * 0.5); x.lineTo(cw * 0.42, ch * 0.5); x.closePath(); x.fill();
    x.fillStyle = "rgba(60,36,18,0.45)";
    for (var i = 0; i < 6; i++) { x.beginPath(); x.arc((((i * 37) % 10) / 10 - 0.5) * cw * 0.7, (((i * 53) % 10) / 10 - 0.5) * ch * 0.7, Math.max(0.6, bw * 0.012), 0, 6.283); x.fill(); }
    x.fillStyle = "rgba(255,230,190,0.35)"; x.fillRect(-cw * 0.5, -ch * 0.5, cw, Math.max(1, ch * 0.12));
    x.restore();
  }

  function easeOutBack(t) { var c1 = 1.6, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); }
  function easeInOut(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }

  // the stream between two bottles
  function drawStream(x, an) {
    if (an.stage !== "pour" || an.p >= 1) return;
    var c = COLORS[an.c % COLORS.length], bw = L.bw;
    var o = { x: G.pos[an.a].x, y: G.pos[an.a].y - (G.lift[an.a] || 0) * bw * 0.32 };
    var m = toScreen(o, G.pos[an.a].a, (an.side > 0 ? 1 : -1) * GEO.nw * 0.6, GEO.yNeck);
    var tb = L.home[an.b], acc = 0;
    (G.vis[an.b] || []).forEach(function (u) { acc += u.amt; });
    var surf = tb.y - upHeight(acc * GEO.V) * bw;
    var wdt = Math.max(2, bw * 0.1 * (an.p < 0.85 ? 1 : (1 - an.p) / 0.15));
    x.save();
    x.lineCap = "round";
    x.strokeStyle = c.base; x.lineWidth = wdt;
    x.beginPath(); x.moveTo(m[0], m[1]); x.quadraticCurveTo(m[0] + an.side * bw * 0.06, (m[1] + surf) / 2, tb.x, surf); x.stroke();
    x.globalCompositeOperation = "lighter";
    x.strokeStyle = hexA(c.hi, 0.6); x.lineWidth = wdt * 0.35;
    x.setLineDash([bw * 0.12, bw * 0.16]); x.lineDashOffset = -G.clock * bw * 2.5;
    x.beginPath(); x.moveTo(m[0], m[1]); x.quadraticCurveTo(m[0] + an.side * bw * 0.06, (m[1] + surf) / 2, tb.x, surf); x.stroke();
    x.setLineDash([]);
    var sg = x.createRadialGradient(tb.x, surf, 0, tb.x, surf, bw * 0.4);
    sg.addColorStop(0, hexA(c.hi, 0.5)); sg.addColorStop(1, "rgba(0,0,0,0)");
    x.fillStyle = sg; x.fillRect(tb.x - bw * 0.4, surf - bw * 0.4, bw * 0.8, bw * 0.8);
    x.restore();
  }

  /* ------------------------------------------------------------- levels */

  function loadProgress() {
    G.deepest = parseInt(store(KEY_LEVEL) || "0", 10) || 0;
    try { G.best = JSON.parse(store(KEY_BEST) || "{}") || {}; } catch (e) { G.best = {}; }
    try { G.tipsSeen = JSON.parse(store(KEY_TIPS) || "{}") || {}; } catch (e) { G.tipsSeen = {}; }
  }

  function setLevel(idx) {
    idx = Math.max(0, Math.min(RAW.length - 1, idx));
    G.idx = idx; G.raw = RAW[idx]; G.cap = G.raw.cap;
    var id = 0;
    G.col = []; G.seen = new Set();
    G.ids = G.raw.t.map(function (t) { return t.map(function (c) { G.col[id] = c; return id++; }); });
    G.raw.h.forEach(function (row, b) { row.forEach(function (hid, k) { if (!hid) G.seen.add(G.ids[b][k]); }); });
    G.ids.forEach(function (row) { if (row.length) G.seen.add(row[row.length - 1]); });
    G.spare = false;
    rebuildState();
    G.hist = [snapshot()];
    G.moves = 0;
    G.anims = []; G.sel = -1; G.hint = null; G.sparks = []; G.corkedCount = 0; G.rescue = false; G.plan = null;
    G.pos = []; G.lift = []; G.corked = [];
    G.vis = G.ids.map(function (row) { return row.map(function (i) { return { id: i, c: G.col[i], amt: 1, hid: !G.seen.has(i), rev: 0 }; }); });
    G.cursor = 0;
  }

  function rebuildState() {
    G.S = { t: G.ids.map(function (r) { return r.map(function (i) { return G.col[i]; }); }), h: G.ids.map(function (r) { return r.map(function (i) { return !G.seen.has(i); }); }) };
  }
  function snapshot() { return { ids: G.ids.map(function (r) { return r.slice(); }), spare: G.spare }; }

  function startLevel(idx) {
    clearTimeout(G.panelT);           // a pending "shelf sorted" panel belongs to the old level
    setLevel(idx);
    G.phase = "play";
    layout();
    syncVisual(true);
    hudSync();
    showTip();
    AU.start();
    gtagSafe("level_start", { toy: "decant", level: idx + 1 });
  }

  // drawn state = logic state (after undo, restart, spare)
  function syncVisual(fresh) {
    G.vis = G.ids.map(function (row) { return row.map(function (i) { return { id: i, c: G.col[i], amt: 1, hid: !G.seen.has(i), rev: 0 }; }); });
    G.corked = G.ids.map(function (row, b) { return R.complete(G.S.t[b], G.cap) ? 1 : -1; });
    G.corkedCount = G.corked.filter(function (c) { return c >= 0; }).length;
    for (var b = 0; b < G.ids.length; b++) {
      if (fresh || !G.pos[b]) G.pos[b] = { x: L.home[b].x, y: L.home[b].y, a: 0 };
      G.lift[b] = 0;
    }
  }

  function showTip() {
    var t = G.raw.tip, chall = G.challenge && G.challenge.level === G.idx + 1;
    var text = chall ? "A friend sorted this shelf in " + G.challenge.moves + " pours. Beat it." : t && !G.tipsSeen[G.idx] ? t : "";
    if (!text) { el.tip.hidden = true; return; }
    if (t) { G.tipsSeen[G.idx] = 1; store(KEY_TIPS, JSON.stringify(G.tipsSeen)); }
    flashTip(text, chall ? 6000 : 7000);
  }
  function flashTip(t, ms) {
    el.tip.textContent = t; el.tip.hidden = false; el.tip.classList.remove("is-out");
    clearTimeout(flashTip.t);
    flashTip.t = setTimeout(function () { el.tip.classList.add("is-out"); setTimeout(function () { el.tip.hidden = true; }, 500); }, ms || 2800);
  }

  function hudSync() {
    el.lvl.textContent = String(G.idx + 1);
    el.moves.textContent = String(G.moves);
    var chall = G.challenge && G.challenge.level === G.idx + 1, best = G.best[G.idx + 1];
    el.bestK.textContent = chall ? "Beat" : "Best";
    el.best.textContent = chall ? String(G.challenge.moves) : best ? String(best) : "–";
    el.best.classList.toggle("is-target", !!chall);
    el.undoBtn.disabled = G.hist.length < 2;
    el.restartBtn.disabled = G.hist.length < 2 && !G.spare;
    el.spareBtn.disabled = G.spare || !G.rescue;
    el.spareBtn.classList.toggle("is-on", G.rescue && !G.spare);
    el.spareBtn.title = G.spare ? "Spare bottle used" : G.rescue ? "Add the spare bottle (B)" : "Unlocks if you get stuck, once per level";
  }

  /* ---------------------------------------------------------- the pours */

  function panOf(b) { return Math.max(-0.85, Math.min(0.85, (L.home[b].x / W) * 2 - 1)); }
  function busy(b) { return G.anims.some(function (an) { return an.a === b || an.b === b; }); }

  function select(b) {
    if (G.phase !== "play" || busy(b)) return;
    if (G.sel < 0) {
      if (!G.S.t[b].length || R.complete(G.S.t[b], G.cap)) { AU.tick(); return; }
      G.sel = b; G.hint = null;
      AU.lift(panOf(b));
      return;
    }
    if (G.sel === b) { G.sel = -1; AU.setDown(panOf(b), 0.3); return; }
    var a = G.sel;
    if (busy(a)) return;
    var n = R.amount(G.S, G.cap, a, b);
    if (!n) {
      G.sel = -1;
      shake(b);
      AU.clink(panOf(b));
      return;
    }
    pourNow(a, b);
  }

  var shakes = {};
  function shake(b) { shakes[b] = { t: 0 }; }

  function pourNow(a, b) {
    var c = G.S.t[a][G.S.t[a].length - 1], fill0 = G.S.t[b].length / G.cap;
    var res = R.pour(G.S, G.cap, a, b);
    var moved = [];
    for (var k = 0; k < res.n; k++) moved.push(G.ids[a].pop());
    moved.reverse();
    moved.forEach(function (id) { G.ids[b].push(id); });
    var revealedId = -1;
    if (res.revealed) { revealedId = G.ids[a][G.ids[a].length - 1]; G.seen.add(revealedId); }
    rebuildState();
    G.hist.push(snapshot());
    G.moves = G.hist.length - 1;
    G.sel = -1; G.hint = null;
    hudSync();
    // the visual: n layers leave the top of a and arrive on b
    G.vis[b] = G.vis[b].concat(moved.map(function (id) { return { id: id, c: c, amt: 0, hid: false, rev: 0 }; }));
    var side = L.home[b].x >= L.home[a].x ? 1 : -1;
    var dur = reduceMotion ? 0.12 : 0.2 + res.n * 0.13;
    G.anims.push({ a: a, b: b, n: res.n, c: c, side: side, stage: "go", t: 0, p: 0, dur: dur, start: { x: G.pos[a].x, y: G.pos[a].y, a: 0 }, revealedId: revealedId });
    AU.lift(panOf(a));
    setTimeout(function () { AU.pour(panOf(a), panOf(b), dur, fill0, G.S.t[b].length / G.cap); }, reduceMotion ? 60 : 230);
    gtagSafe("pour", { toy: "decant", level: G.idx + 1 });
  }

  // where the source must stand, tilted by ang, for its mouth to sit over b
  function pourSpot(an, ang) {
    var bw = L.bw, tb = L.home[an.b];
    var mouthY = tb.y - (GEO.yNeck + 0.32) * bw, mouthX = tb.x - an.side * bw * 0.04;
    var local = toScreen({ x: 0, y: 0 }, ang, an.side * GEO.nw * 0.6, GEO.yNeck);
    return { x: mouthX - local[0], y: mouthY - local[1] };
  }

  function stepAnim(an, dt) {
    var GO = reduceMotion ? 0.08 : 0.24, BACK = reduceMotion ? 0.08 : 0.26;
    var a0 = an.side * 1.25, a1 = an.side * (G.S.t[an.a].length ? 1.62 : 1.95);
    an.t += dt;
    var P = G.pos[an.a];
    if (an.stage === "go") {
      var e = easeInOut(Math.min(1, an.t / GO)), spot = pourSpot(an, a0 * e);
      P.x = an.start.x + (spot.x - an.start.x) * e; P.y = an.start.y + (spot.y - an.start.y) * e; P.a = a0 * e;
      G.lift[an.a] = Math.max(0, (G.lift[an.a] || 0) - dt * 4);
      if (an.t >= GO) { an.stage = "pour"; an.t = 0; }
    } else if (an.stage === "pour") {
      an.p = Math.min(1, an.t / an.dur);
      var ang = a0 + (a1 - a0) * easeInOut(an.p), sp2 = pourSpot(an, ang);
      P.x = sp2.x; P.y = sp2.y; P.a = ang;
      var moved = an.n * easeInOut(an.p);
      var src = G.vis[an.a], dst = G.vis[an.b];
      for (var j = 0; j < an.n; j++) {
        var su = src[src.length - 1 - j]; if (su) su.amt = 1 - Math.max(0, Math.min(1, moved - j));
        var du = dst[dst.length - an.n + j]; if (du) du.amt = Math.max(0, Math.min(1, moved - j));
      }
      if (an.p >= 1) {
        src.splice(src.length - an.n, an.n);
        dst.forEach(function (u) { u.amt = 1; });
        an.stage = "back"; an.t = 0; an.from = { x: P.x, y: P.y, a: P.a };
        // a clouded layer just came to the top
        if (an.revealedId >= 0) {
          var top = src[src.length - 1];
          if (top && top.id === an.revealedId) { top.hid = false; top.rev = 1; AU.reveal(panOf(an.a)); }
        }
        finishedFill(an.b);
      }
    } else {
      var e2 = easeInOut(Math.min(1, an.t / BACK)), H0 = L.home[an.a];
      P.x = an.from.x + (H0.x - an.from.x) * e2; P.y = an.from.y + (H0.y - an.from.y) * e2; P.a = an.from.a * (1 - e2);
      if (an.t >= BACK) { P.x = H0.x; P.y = H0.y; P.a = 0; an.done = true; AU.setDown(panOf(an.a), 0.4); }
    }
  }

  function finishedFill(b) {
    if (R.complete(G.S.t[b], G.cap) && G.corked[b] < 0) {
      G.corked[b] = 0;
      G.corkedCount++;
      AU.cork(panOf(b), G.corkedCount + 1);
      burst(b);
    }
  }

  function afterPours() {
    if (G.phase !== "play" || G.anims.length) return;
    if (R.solved(G.S, G.cap)) { G.phase = "clearing"; G.clearAt = G.clock + (reduceMotion ? 0.2 : 0.65); return; }
    checkRescue(true);
  }

  // Stuck = no pours left, or the solver proves the shelf cannot be sorted
  // from here (a millisecond even on the biggest shelves). Only then does the
  // spare bottle unlock: free, it took a casual player from 19% to 82% at
  // level 25, so it was an easy button rather than a rescue.
  function deadEnd() {
    if (R.stuck(G.S, G.cap)) return true;
    var line = R.solve(R.clone(G.S), G.cap, 60000);
    return !line && !R.lastCapped;
  }
  function checkRescue(announce) {
    var was = G.rescue, dead = deadEnd();
    G.rescue = dead && !G.spare;
    hudSync();
    if (dead && announce) {
      flashTip(G.spare ? "This shelf can't be sorted from here. Undo or restart." : "This shelf can't be sorted from here. The spare bottle is unlocked, or undo.", 4600);
      AU.stuck();
      if (!was) gtagSafe("stuck", { toy: "decant", level: G.idx + 1, moves: G.moves });
    }
  }

  function burst(b) {
    if (reduceMotion) return;
    var c = COLORS[G.S.t[b][0] % COLORS.length], h = L.home[b], top = h.y - GEO.yNeck * L.bw;
    for (var k = 0; k < 16; k++) {
      var ang = -Math.PI / 2 + (Math.random() - 0.5) * 2.2, sp = L.bw * (1.2 + Math.random() * 2.2);
      G.sparks.push({ x: h.x, y: top, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, t: 0, max: 0.5 + Math.random() * 0.5, c: Math.random() < 0.5 ? c.hi : "#fff2cc" });
    }
  }

  function undo() {
    if (G.anims.length || G.hist.length < 2 || G.phase !== "play") return;
    G.hist.pop();
    restore(G.hist[G.hist.length - 1]);
    AU.undo();
  }
  function restart() {
    if (G.anims.length || G.phase !== "play") return;
    if (G.hist.length < 2 && !G.spare) return;
    G.hist = [G.hist[0]];
    if (G.spare) { G.hist[0] = { ids: G.hist[0].ids.filter(function (r, k) { return k < RAW[G.idx].t.length; }), spare: false }; }
    var spareWas = G.spare;
    restore(G.hist[0]);
    if (spareWas) { layout(); syncVisual(true); }
    AU.undo();
  }
  function restore(snap) {
    var hadSpare = G.spare;
    clearTimeout(flashTip.t); el.tip.hidden = true;    // a "stuck" message is stale after an undo
    G.ids = snap.ids.map(function (r) { return r.slice(); });
    G.spare = snap.spare;
    rebuildState();
    G.moves = G.hist.length - 1;
    G.sel = -1; G.hint = null;
    if (hadSpare !== G.spare) layout();
    syncVisual(false);
    checkRescue(false);             // undoing out of a dead end locks the spare again
  }

  function addSpare() {
    if (G.phase !== "play" || G.spare || G.anims.length) return;
    if (!G.rescue) { flashTip("The spare bottle unlocks if you get stuck."); AU.tick(); return; }
    G.spare = true; G.rescue = false;
    G.ids.push([]);
    rebuildState();
    G.hist.forEach(function (h) { h.ids.push([]); h.spare = true; });
    G.sel = -1; G.hint = null;
    var old = G.pos.slice();
    layout();
    syncVisual(false);
    // the others slide over to make room; the new bottle drops in
    for (var b = 0; b < G.ids.length; b++) {
      if (old[b]) G.pos[b] = { x: old[b].x, y: old[b].y, a: 0, ease: 1 };
      else G.pos[b] = { x: L.home[b].x, y: L.home[b].y - L.bw * 2, a: 0, ease: 1 };
    }
    hudSync();
    AU.spare(panOf(G.ids.length - 1));
    gtagSafe("spare_used", { toy: "decant", level: G.idx + 1 });
    afterPours();
  }

  /* ⚠ A hint must follow ONE plan. Re-solving from scratch after every pour
   * can start a different plan each time, and one of them may pour straight
   * back: a test that took the solver's first move after each pour ran 462
   * pours without finishing. So the plan is kept, with the exact state at
   * each step, and only redone when the player leaves it. */
  function exactKey(S) {
    return S.t.map(function (t, i) { return t.map(function (c, j) { return String.fromCharCode(65 + c + (S.h[i][j] ? 32 : 0)); }).join(""); }).join("|");
  }
  function nextPour() {
    var k = exactKey(G.S);
    if (G.plan) { var at = G.plan.keys.indexOf(k); if (at >= 0 && at < G.plan.line.length) return G.plan.line[at]; }
    var line = R.solve(R.clone(G.S), G.cap, 120000);
    if (!line || !line.length) { G.plan = null; return null; }
    var S = R.clone(G.S), keys = [exactKey(S)];
    line.forEach(function (m) { R.pour(S, G.cap, m[0], m[1]); keys.push(exactKey(S)); });
    G.plan = { keys: keys, line: line };
    return line[0];
  }

  function hint() {
    if (G.phase !== "play" || G.anims.length) return;
    var mv = nextPour(), line = mv ? [mv] : null;
    if (!line || !line.length) {
      if (!R.lastCapped) checkRescue(true);
      else flashTip("Too tangled to see a way from here. Try undoing a few pours.", 4200);
      AU.stuck();
      return;
    }
    G.sel = -1;
    G.hint = { a: line[0][0], b: line[0][1], t: 0 };
    G.cursor = line[0][0];
    AU.hint();
    gtagSafe("hint", { toy: "decant", level: G.idx + 1 });
  }

  /* -------------------------------------------------------- level clear */

  function levelClear() {
    G.phase = "clear"; G.clearT = 0;
    var n = G.idx + 1, m = G.moves, prev = G.best[n];
    if (!prev || m < prev) G.best[n] = m;
    store(KEY_BEST, JSON.stringify(G.best));
    if (n > G.deepest) { G.deepest = n; store(KEY_LEVEL, String(n)); }
    AU.clear(G.ids.length);
    gtagSafe("level_clear", { toy: "decant", level: n, moves: m, spare: G.spare ? 1 : 0 });
    var chall = G.challenge && G.challenge.level === n ? G.challenge : null;
    if (chall && m < chall.moves) gtagSafe("challenge_beaten", { toy: "decant", level: n, moves: m });
    window.OPT_SHARE_IMAGE = function () { return shareCanvas(n, m); };
    window.OPT_SHARE_LINE = "Level " + n + " in " + m + " pours";
    window.OPT_SHARE_TEXT = "I sorted Decant level " + n + " in " + m + " pours. Beat it: " + challengeUrl(n, m);
    clearTimeout(G.panelT);
    G.panelT = setTimeout(function () {
      var last = n >= RAW.length, isBest = !prev || m < prev;
      var html = "<span class=\"big\">" + m + " pours</span>" +
        (isBest && prev ? "<span class=\"badge\">New best</span><br />" : "") +
        "Best on this shelf: " + G.best[n] + "." + (G.spare ? " (with the spare bottle)" : "") +
        (chall ? (m < chall.moves ? "<br /><span class=\"win\">You beat your friend's " + chall.moves + ".</span>"
          : m === chall.moves ? "<br />You tied your friend's " + chall.moves + "." : "<br /><span class=\"short\">Your friend did it in " + chall.moves + ".</span>") : "") +
        (last ? "<br /><br /><b>That was the last shelf.</b> Every potion is sorted." : "");
      showPanel("Shelf sorted", "Level " + n, html, last ? "Play it again" : "Next level", true);
      el.ovBtn.onclick = function () { AU.unlock(); hidePanel(); startLevel(last ? G.idx : G.idx + 1); };
    }, reduceMotion ? 300 : 1300);
  }

  function challengeUrl(n, m) { return "https://onepagetoys.com/toys/decant/#l=" + n + "-" + m; }

  /* -------------------------------------------------------------- panel */

  function showPanel(eyebrow, title, html, btn, withChallenge) {
    el.ovEyebrow.textContent = eyebrow; el.ovTitle.textContent = title; el.ovText.innerHTML = html; el.ovBtn.textContent = btn;
    el.ovDemo.setAttribute("hidden", "");
    el.chBtn.hidden = !withChallenge; el.chBtn.textContent = "Challenge a friend";
    el.levels.hidden = true; el.levelsBtn.textContent = "Choose a level";
    el.overlay.hidden = false; el.overlay.classList.remove("is-out");
    el.hud.hidden = true; el.bar.hidden = true;
  }
  function hidePanel() {
    el.overlay.classList.add("is-out");
    setTimeout(function () { el.overlay.hidden = true; }, 260);
    el.hud.hidden = false; el.bar.hidden = false;
    window.OPT_SHARE_IMAGE = null; window.OPT_SHARE_LINE = null; window.OPT_SHARE_TEXT = null;
  }
  function openMenu() {
    if (G.anims.length) return;
    var resume = G.S && G.phase === "play";
    if (resume) G.phase = "menu-play";
    showPanel("The apothecary's shelf", "Decant", "Level " + (G.idx + 1) + " is waiting where you left it.<br />Pick another shelf, or carry on.", "Back to level " + (G.idx + 1), false);
    el.ovBtn.onclick = function () { hidePanel(); if (resume) G.phase = "play"; else startLevel(G.idx); };
    buildLevels(); el.levels.hidden = false; el.levelsBtn.textContent = "Hide levels";
  }

  function stageOf(k) { return k < 2 ? "First pours" : k < 9 ? "A few potions" : k < 15 ? "A full shelf" : k < 50 ? "Clouded layers" : k < 90 ? "Tall bottles" : "Master apothecary"; }
  function buildLevels() {
    var html = "", lastStage = null;
    for (var k = 0; k < RAW.length; k++) {
      var s = stageOf(k);
      if (s !== lastStage) { html += "<p class=\"levels__stage\">" + s + "</p>"; lastStage = s; }
      var n = k + 1, open = n <= G.deepest + 1 || (G.challenge && G.challenge.level === n);
      var best = G.best[n], cls = "lv" + (best ? " is-done" : "") + (G.S && k === G.idx ? " is-here" : "");
      html += "<button type=\"button\" class=\"" + cls + "\" data-l=\"" + k + "\"" + (open ? "" : " disabled") + " aria-label=\"Level " + n + (best ? ", best " + best + " pours" : "") + "\">" + n + "</button>";
    }
    el.levels.innerHTML = html;
  }
  el.levels.addEventListener("click", function (e) {
    var b = e.target.closest ? e.target.closest(".lv") : null;
    if (!b || b.disabled) return;
    AU.unlock(); hidePanel(); startLevel(+b.getAttribute("data-l"));
  });
  el.levelsBtn.addEventListener("click", function () {
    if (el.levels.hidden) { buildLevels(); el.levels.hidden = false; el.levelsBtn.textContent = "Hide levels"; }
    else { el.levels.hidden = true; el.levelsBtn.textContent = "Choose a level"; }
  });

  /* -------------------------------------------------------------- update */

  function update(dt) {
    G.clock += dt;
    if (!G.S) return;
    for (var i = G.anims.length - 1; i >= 0; i--) { stepAnim(G.anims[i], dt); if (G.anims[i].done) G.anims.splice(i, 1); }
    for (var b = 0; b < G.ids.length; b++) {
      var target = G.sel === b ? 1 : 0;
      if (!busy(b)) G.lift[b] = (G.lift[b] || 0) + (target - (G.lift[b] || 0)) * Math.min(1, dt * 16);
      var P = G.pos[b];
      if (P && P.ease && !busy(b)) {
        var H0 = L.home[b], k = Math.min(1, dt * 9);
        P.x += (H0.x - P.x) * k; P.y += (H0.y - P.y) * k;
        if (Math.abs(H0.x - P.x) + Math.abs(H0.y - P.y) < 0.5) { P.x = H0.x; P.y = H0.y; P.ease = 0; }
      }
      if (G.corked[b] >= 0 && G.corked[b] < 1) G.corked[b] = Math.min(1, G.corked[b] + dt * 3.2);
      (G.vis[b] || []).forEach(function (u) { if (u.rev > 0) u.rev = Math.max(0, u.rev - dt * 2.2); });
    }
    for (var s in shakes) { shakes[s].t += dt; if (shakes[s].t > 0.3) delete shakes[s]; }
    for (i = G.sparks.length - 1; i >= 0; i--) {
      var p = G.sparks[i]; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += L.bw * 3 * dt; p.vx *= 1 - dt * 1.5;
      if (p.t > p.max) G.sparks.splice(i, 1);
    }
    if (!reduceMotion) {
      if (G.motes.length < 26) G.motes.push({ x: Math.random() * W, y: H * (0.2 + Math.random() * 0.7), vx: (Math.random() - 0.5) * 6, vy: -2 - Math.random() * 5, t: 0, max: 6 + Math.random() * 8, r: 0.6 + Math.random() * 1.3 });
      for (i = G.motes.length - 1; i >= 0; i--) { var m = G.motes[i]; m.t += dt; m.x += m.vx * dt + Math.sin(G.clock + i) * 0.1; m.y += m.vy * dt; if (m.t > m.max) G.motes.splice(i, 1); }
    }
    if (G.hint) { G.hint.t += dt; if (G.hint.t > 6) G.hint = null; }
    if (!G.anims.length && G.phase === "play" && G.pendingCheck) { G.pendingCheck = false; afterPours(); }
    if (G.anims.length) G.pendingCheck = true;
    if (G.phase === "clearing" && G.clock >= G.clearAt) levelClear();
    if (G.phase === "clear") G.clearT += dt;
  }

  /* -------------------------------------------------------------- render */

  function render() {
    var x = ctx;
    x.setTransform(1, 0, 0, 1, 0, 0);
    if (bg) x.drawImage(bg, 0, 0);
    x.setTransform(DPR, 0, 0, DPR, 0, 0);
    if (!G.S) return;
    // the candles' light, breathing with the flames
    var fl = reduceMotion ? 1 : 0.92 + 0.05 * Math.sin(G.clock * 9) + 0.03 * Math.sin(G.clock * 17);
    x.save();
    x.globalCompositeOperation = "lighter";
    CANDLES.forEach(function (c) {
      var g = x.createRadialGradient(c.x, c.y, 0, c.x, c.y, Math.max(W, H) * 0.55);
      g.addColorStop(0, "rgba(255,150,60," + (0.11 * fl).toFixed(3) + ")"); g.addColorStop(0.5, "rgba(255,120,40," + (0.035 * fl).toFixed(3) + ")"); g.addColorStop(1, "rgba(0,0,0,0)");
      x.fillStyle = g; x.fillRect(0, 0, W, H);
    });
    G.motes.forEach(function (m) {
      var a = Math.sin(Math.PI * m.t / m.max) * 0.5;
      x.fillStyle = "rgba(255,220,170," + a.toFixed(3) + ")";
      x.beginPath(); x.arc(m.x, m.y, m.r, 0, 6.283); x.fill();
    });
    x.restore();
    drawCandles(x);
    // bottles at rest first, the ones in a pour on top
    var order = [];
    for (var b = 0; b < G.ids.length; b++) order.push(b);
    order.sort(function (p, q) { return (busy(p) ? 1 : 0) - (busy(q) ? 1 : 0) || (G.lift[p] || 0) - (G.lift[q] || 0); });
    order.forEach(function (b2) {
      var sh = shakes[b2];
      if (sh && !reduceMotion) { x.save(); x.translate(Math.sin(sh.t * 60) * L.bw * 0.05 * (1 - sh.t / 0.3), 0); drawBottle(x, b2); x.restore(); }
      else drawBottle(x, b2);
    });
    G.anims.forEach(function (an) { drawStream(x, an); });
    if (G.hint && G.S.t[G.hint.a]) drawHintArrow(x);
    // sparks from a fresh cork
    x.save(); x.globalCompositeOperation = "lighter";
    G.sparks.forEach(function (p) {
      var u = p.t / p.max, r = L.bw * (0.05 + 0.04 * (1 - u));
      x.fillStyle = hexA(p.c, 1 - u); x.beginPath(); x.arc(p.x, p.y, r, 0, 6.283); x.fill();
    });
    x.restore();
    if (G.phase === "clear" && !reduceMotion) {
      var a = Math.max(0, 0.18 - G.clearT * 0.12);
      if (a > 0) { x.fillStyle = "rgba(255,210,150," + a.toFixed(3) + ")"; x.fillRect(0, 0, W, H); }
    }
  }

  function drawHintArrow(x) {
    var h = G.hint, A0 = L.home[h.a], B0 = L.home[h.b], bw = L.bw;
    var y = Math.min(A0.y, B0.y) - (GEO.yNeck + 0.55) * bw - Math.sin(h.t * 6) * bw * 0.06;
    x.save();
    x.strokeStyle = "rgba(255,225,170,0.85)"; x.lineWidth = Math.max(2, bw * 0.05); x.lineCap = "round";
    x.setLineDash([bw * 0.1, bw * 0.1]); x.lineDashOffset = -h.t * bw;
    x.beginPath(); x.moveTo(A0.x, y + bw * 0.25); x.quadraticCurveTo((A0.x + B0.x) / 2, y - bw * 0.35, B0.x, y + bw * 0.2); x.stroke();
    x.setLineDash([]);
    var dir = B0.x >= A0.x ? 1 : -1;
    x.fillStyle = "rgba(255,225,170,0.9)";
    x.beginPath(); x.moveTo(B0.x, y + bw * 0.32); x.lineTo(B0.x - dir * bw * 0.16, y + bw * 0.08); x.lineTo(B0.x + dir * bw * 0.06, y + bw * 0.05); x.closePath(); x.fill();
    x.restore();
  }

  /* --------------------------------------------------------------- input */

  function bottleAt(px, py) {
    var bw = L.bw, best = -1, bd = 1e9;
    for (var b = 0; b < G.ids.length; b++) {
      var h = L.home[b], top = h.y - (GEO.yNeck + 0.6) * bw;
      if (py < top || py > h.y + bw * 0.35) continue;
      var d = Math.abs(px - h.x);
      if (d < bw * 0.71 && d < bd) { bd = d; best = b; }
    }
    return best;
  }

  el.canvas.addEventListener("pointerdown", function (e) {
    if (G.phase !== "play" || !G.S) return;
    AU.unlock();
    var r = el.canvas.getBoundingClientRect(), b = bottleAt(e.clientX - r.left, e.clientY - r.top);
    G.showCursor = false;
    if (b < 0) { if (G.sel >= 0) { AU.setDown(panOf(G.sel), 0.3); G.sel = -1; } return; }
    G.cursor = b;
    select(b);
    e.preventDefault();
  });

  // keyboard: arrows move the cursor, Enter picks up or pours, Esc puts down
  function moveCursor(d) {
    var rowOf = function (b) { for (var r = 0; r < L.rows.length; r++) if (L.rows[r].indexOf(b) >= 0) return r; return 0; };
    var r = rowOf(G.cursor), row = L.rows[r], i = row.indexOf(G.cursor);
    if (d === 0) G.cursor = row[Math.max(0, i - 1)];
    else if (d === 1) G.cursor = row[Math.min(row.length - 1, i + 1)];
    else {
      var r2 = Math.max(0, Math.min(L.rows.length - 1, r + (d === 2 ? -1 : 1)));
      if (r2 !== r) {
        var hx = L.home[G.cursor].x, near = L.rows[r2][0];
        L.rows[r2].forEach(function (b) { if (Math.abs(L.home[b].x - hx) < Math.abs(L.home[near].x - hx)) near = b; });
        G.cursor = near;
      }
    }
  }

  window.addEventListener("keydown", function (e) {
    var k = e.key;
    if (G.phase !== "play") {
      if (k === "Escape" && !el.overlay.hidden && G.phase === "menu-play") { hidePanel(); G.phase = "play"; e.preventDefault(); }
      return;
    }
    if (document.activeElement && document.activeElement.tagName === "BUTTON" && (k === "Enter" || k === " ")) return;
    var dir = k === "ArrowLeft" ? 0 : k === "ArrowRight" ? 1 : k === "ArrowUp" ? 2 : k === "ArrowDown" ? 3 : -1;
    if (dir >= 0) { e.preventDefault(); AU.unlock(); G.showCursor = true; moveCursor(dir); AU.tick(); return; }
    if (k === "Enter" || k === " ") { e.preventDefault(); AU.unlock(); G.showCursor = true; select(G.cursor); return; }
    if (k === "z" || k === "Z" || k === "Backspace") { e.preventDefault(); undo(); return; }
    if (k === "r" || k === "R") { restart(); return; }
    if (k === "h" || k === "H") { hint(); return; }
    if (k === "b" || k === "B") { addSpare(); return; }
    if (k === "m" || k === "M") { el.soundBtn.click(); return; }
    if (k === "Escape") { if (G.sel >= 0) { G.sel = -1; AU.setDown(panOf(G.cursor), 0.3); } else openMenu(); }
  });

  el.undoBtn.addEventListener("click", function () { AU.unlock(); undo(); el.undoBtn.blur(); });
  el.restartBtn.addEventListener("click", function () { AU.unlock(); restart(); el.restartBtn.blur(); });
  el.spareBtn.addEventListener("click", function () { AU.unlock(); addSpare(); el.spareBtn.blur(); });
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
    var text = "I sorted Decant level " + n + " in " + m + " pours. Same shelf, your turn:";
    gtagSafe("share", { method: "challenge_link", content_type: "toy", item_id: "/toys/decant/" });
    if (navigator.share && coarse) { navigator.share({ title: "Decant", text: text, url: url }).catch(function () {}); return; }
    var done = function () { el.chBtn.textContent = "Challenge link copied"; setTimeout(function () { el.chBtn.textContent = "Challenge a friend"; }, 1800); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text + " " + url).then(done, function () { window.prompt("Copy this link:", url); });
    else window.prompt("Copy this link:", url);
  });

  /* -------------------------------------------------------------- share */

  // the sorted shelf, corked, with the result
  function shareCanvas(n, m) {
    render();
    var S = 1080, cv = document.createElement("canvas");
    cv.width = S; cv.height = S;
    var x = cv.getContext("2d");
    x.fillStyle = "#06090d"; x.fillRect(0, 0, S, S);
    var minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    for (var b = 0; b < G.ids.length; b++) {
      var h = L.home[b];
      minX = Math.min(minX, h.x - L.bw); maxX = Math.max(maxX, h.x + L.bw);
      minY = Math.min(minY, h.y - (GEO.yNeck + 0.6) * L.bw); maxY = Math.max(maxY, h.y + L.bw * 0.6);
    }
    var w = maxX - minX, hh = maxY - minY, pad = 70, room = S - pad * 2 - 190, sc = Math.min(room / w, room / hh);
    x.drawImage(el.canvas, minX * DPR, minY * DPR, w * DPR, hh * DPR, (S - w * sc) / 2, pad + 130 + (room - hh * sc) / 2, w * sc, hh * sc);
    x.textAlign = "left"; x.fillStyle = "#fff3dc";
    x.shadowColor = "rgba(255,170,70,0.6)"; x.shadowBlur = 24;
    x.font = "700 84px 'Cormorant Garamond', Georgia, serif";
    x.fillText("Decant", pad, pad + 70);
    x.shadowBlur = 0;
    x.textAlign = "right"; x.font = "600 28px 'Geist Mono', ui-monospace, monospace"; x.fillStyle = "#ffb54a";
    x.fillText("LEVEL " + n, S - pad, pad + 58);
    x.textAlign = "left"; x.fillStyle = "#f6ead7"; x.font = "700 64px 'Cormorant Garamond', Georgia, serif";
    x.fillText(m + " pours", pad, S - pad - 4);
    return cv;
  }

  /* ------------------------------------------------------------ helpers */

  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }
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
    var lv = /level=(\d+)/.exec(location.hash || ""), m = /l=(\d+)-(\d+)/.exec(location.hash || "");
    if (m && +m[1] >= 1 && +m[1] <= RAW.length) {
      G.challenge = { level: +m[1], moves: +m[2] };
      el.ovEyebrow.textContent = "You've been challenged";
      el.ovText.innerHTML = "<b>A friend sorted level " + G.challenge.level + " in " + G.challenge.moves + " pours.</b> Same shelf. Beat it.<br /><br />" + el.ovText.innerHTML;
      el.ovBtn.textContent = "Take the challenge";
      gtagSafe("challenge_open", { toy: "decant", level: G.challenge.level });
    } else if (G.deepest > 0) {
      el.ovBtn.textContent = G.deepest >= RAW.length ? "Play again" : "Continue at level " + (G.deepest + 1);
    }
    if (coarse) el.ovKeys.textContent = "tap a bottle, then tap where to pour it";
    el.ovBtn.onclick = function () { AU.unlock(); hidePanel(); startLevel(G.challenge ? G.challenge.level - 1 : Math.min(G.deepest, RAW.length - 1)); };
    if (lv && +lv[1] >= 1 && +lv[1] <= RAW.length) {
      var want = +lv[1] - 1;
      el.ovBtn.textContent = "Play level " + (want + 1);
      el.ovBtn.onclick = function () { AU.unlock(); hidePanel(); startLevel(want); };
    }
    // behind the intro: the next shelf, waiting
    setLevel(lv && +lv[1] >= 1 && +lv[1] <= RAW.length ? +lv[1] - 1 : G.challenge ? G.challenge.level - 1 : Math.min(G.deepest, RAW.length - 1));
    layout();
    syncVisual(true);
    requestAnimationFrame(frame);
    gtagSafe("toy_open", { toy: "decant" });
  }

  window.addEventListener("hashchange", function () {
    var h = location.hash || "", lm = /level=(\d+)/.exec(h), cm = /l=(\d+)-(\d+)/.exec(h);
    var n = lm ? +lm[1] : cm ? +cm[1] : 0;
    if (!n || n > RAW.length) return;
    if (cm) { G.challenge = { level: n, moves: +cm[2] }; gtagSafe("challenge_open", { toy: "decant", level: n }); }
    G.anims = [];
    if (!el.overlay.hidden) hidePanel();
    startLevel(n - 1);
  });

  var resizeT = null;
  window.addEventListener("resize", function () { clearTimeout(resizeT); resizeT = setTimeout(function () { layout(); for (var b = 0; b < G.ids.length; b++) if (!busy(b)) G.pos[b] = { x: L.home[b].x, y: L.home[b].y, a: 0 }; }, 80); });
  window.addEventListener("orientationchange", function () { setTimeout(function () { layout(); }, 150); });

  // headless verification handle (tests and the card pose read positions and
  // state; every move they make is real pointer or keyboard input). Only an
  // automated browser gets it.
  if (navigator.webdriver) window.__decant = { G: G, L: L, R: R, home: function (b) { return L.home[b]; }, bw: function () { return L.bw; } };

  init();
})();
