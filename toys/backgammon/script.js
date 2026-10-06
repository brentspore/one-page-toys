/* Backgammon — No. 136.
   An inlaid board on a café table by the sea: a whitewashed wall, the water below it,
   tea glasses and a leather dice cup, and six regulars who will play you a match to 5.

   The board is drawn with a real perspective camera, like Checkers. Everything that
   never moves (the sky, the sea, the wall, the table, the inlaid case) is baked once
   per layout into one canvas; each frame draws the light off the water, the marks,
   the checkers, the dice, the cups and the cube.

   Sides: 0 is you (the light checkers), 1 is the regular (the dark ones). Each
   side's checkers live in its own numbering (see core.js). On screen your home board
   is bottom right, theirs top right, and both bear off into the tray on the right. */
(function () {
  "use strict";

  var K = window.BackgammonCore, A = window.BackgammonAudio;
  var canvas = document.getElementById("canvas");
  var ctx = canvas.getContext("2d");
  var $ = function (id) { return document.getElementById(id); };

  /* ================= camera ================= */
  var TILT = 0.56;                                   /* from straight down */
  var THETA = Math.PI / 2 - TILT;
  var SIN = Math.sin(THETA), COS = Math.cos(THETA);  /* SIN squashes flat circles, COS scales heights */
  var CAM_D = 34, FOCAL = 1000, CX = 0, CY = 0;
  var CAM = { x: 0, y: CAM_D * SIN, z: CAM_D * COS };

  function project(x, y, z) {
    var ry = y * COS - z * SIN, rz = y * SIN + z * COS;
    var s = FOCAL / (CAM_D - rz);
    return { x: CX + x * s, y: CY - ry * s, s: s };
  }
  /* The inverse on a horizontal plane at height y: where on the table is this pixel? */
  function unproject(px, py, y) {
    var D = CY - py;
    var z = (FOCAL * y * COS + D * y * SIN - D * CAM_D) / (FOCAL * SIN - D * COS);
    var s = FOCAL / (CAM_D - y * SIN - z * COS);
    return { x: (px - CX) / s, z: z };
  }

  /* ================= the case ================= */
  var BAR = 0.55, FIELD = 6.55, ZF = 5.5, ZE = 6.05;
  var EDGE_L = -7.1, TRAY0 = 7.0, TRAY1 = 8.05, EDGE_R = 8.45, TRAY_X = 7.525;
  var R = 0.45, CH = 0.13, GAP = 0.9, PTLEN = 4.6;
  var FRAME_Y = 0.16, TABLE_Y = -0.38, TRAY_Y = -0.03;

  /* x of a point's column, in YOUR numbering */
  function pointX(p) { return p <= 6 ? 7.05 - p : p <= 12 ? 5.95 - p : p <= 18 ? p - 19.05 : p - 17.95; }
  function boardPoint(side, own) { return side === 0 ? own : 25 - own; }

  /* Where the k-th checker of a slot sits. own: 1..24 point, 25 bar, 0 off. */
  var CAP_PT = 5, CAP_BAR = 4;
  function slotWorld(side, own, k) {
    if (own === 0) {
      var zo = 5.05 - 0.205 * k;
      return { x: TRAY_X, y: TRAY_Y + 0.004 * k, z: side === 0 ? zo : -zo };
    }
    if (own === 25) {
      var kb = Math.min(k, CAP_BAR - 1), zb = 1.0 + GAP * kb;
      return { x: 0, y: FRAME_Y, z: side === 0 ? -zb : zb };
    }
    var p = boardPoint(side, own), kk = Math.min(k, CAP_PT - 1), zz = 5.05 - GAP * kk;
    return { x: pointX(p), y: 0, z: p >= 13 ? -zz : zz };
  }

  /* ================= persistence ================= */
  var LS = { beaten: "backgammon_beaten", defeated: "backgammon_defeated", sound: "backgammon_sound",
    w: "backgammon_wins", l: "backgammon_losses", cube: "backgammon_cube", foe: "backgammon_foe" };
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function track(name, params) { try { if (typeof window.gtag === "function") window.gtag("event", name, params || {}); } catch (e) {} }

  /* ================= the regulars ================= */
  var FOES = [
    { id: "mina", name: "Mina", role: "the owner's granddaughter", tier: 1, glyph: "shell", accent: "#f2a3b3",
      trait: "Plays whatever she sees first.",
      quips: { start: "Grandma says I have to let you roll first. No, wait.", hit: "Off you go!", double: "Double! Is that how it works?",
               take: "Okay! I take it.", pass: "Hmm. No thank you.", gwin: "I won one!", glose: "That's okay.", win: "I beat you! I'm telling everyone.", lose: "Again? Please?" } },
    { id: "teo", name: "Teo", role: "mends nets on the quay", tier: 2, glyph: "anchor", accent: "#8fc3d8",
      trait: "Runs his back checkers home.",
      quips: { start: "Tide's out for an hour. Roll.", hit: "Back to the water.", double: "I'll make it two.",
               take: "I'll take it.", pass: "Not this one.", gwin: "Easy as hauling.", glose: "Snagged.", win: "Same time tomorrow?", lose: "Fair winds. Well played." } },
    { id: "despina", name: "Auntie Despina", role: "bakes the almond cakes", tier: 3, glyph: "cake", accent: "#e9b96f",
      trait: "Builds her board like a sea wall.",
      quips: { start: "Sit, sit. Have a cake first.", hit: "Into the oven.", double: "Shall we double, dear?",
               take: "I'll take it, dear.", pass: "No, no. You have it.", gwin: "There we are.", glose: "Well, well.", win: "Take a cake for the road.", lose: "Lovely play. Lovely." } },
    { id: "marek", name: "Captain Marek", role: "skippers the island ferry", tier: 4, glyph: "wheel", accent: "#d9714a",
      trait: "Hits every blot in sight.",
      quips: { start: "Ferry leaves at six. Plenty of time.", hit: "Man overboard!", double: "Full speed. I double.",
               take: "Aye, I'll take it.", pass: "I know when to turn back.", gwin: "Steady as she goes.", glose: "Rough water.", win: "All ashore that's going ashore.", lose: "You've sailed before. Good game." } },
    { id: "aris", name: "Mr. Aris", role: "retired schoolmaster", tier: 5, glyph: "glasses", accent: "#a6c48a",
      trait: "Counts every pip before he breathes.",
      quips: { start: "We count our pips, yes? Begin.", hit: "Elementary.", double: "The numbers say double.",
               take: "The arithmetic says take.", pass: "I concede the point.", gwin: "As calculated.", glose: "A rounding error.", win: "A fine lesson. Same time Thursday.", lose: "Top marks. Truly." } },
    { id: "noor", name: "Madame Noor", role: "runs the café", tier: 6, glyph: "cup", accent: "#f2b44c",
      trait: "Has never lost at her own table.",
      quips: { start: "Tea is on the house. The game is not.", hit: "Mm.", double: "I think it's worth two now.",
               take: "I'll take.", pass: "Yours.", gwin: "Mm-hm.", glose: "Hm.", win: "Come back tomorrow. The tea is still free.", lose: "In forty years. Well. Sit, have another glass." } }
  ];
  function foeById(id) { for (var i = 0; i < FOES.length; i++) if (FOES[i].id === id) return FOES[i]; return FOES[0]; }
  function shortName(f) { return f.name.replace(/^(Auntie|Captain|Mr\.|Madame) /, ""); }

  /* ================= state ================= */
  var MATCH_TO = 5;
  var foe = FOES[0], cubeOn = lsGet(LS.cube, "0") === "1";
  var board = [K.start(), K.start()];
  var score = [0, 0], crawfordDone = false, crawfordGame = false, cube = { v: 1, owner: -1 };
  var phase = "idle";            /* idle | opening | preroll | rolling | moving | ai | ask | gameover | over */
  var turn = null;               /* the player's turn: { d1, d2, left, need, only, steps } */
  var who = 0;                   /* whose turn */
  var sel = -1, dests = [], drag = null, hint = null, lastMove = null, cursor = null;
  var flyers = [], particles = [], dice = [], cupShake = [0, 0], cubeAnim = null;
  var games = [];                /* per game: { winner, pts, kind } */
  var toldCube = false, hintSteps = [];
  var matchToken = 0;
  var soundOn = lsGet(LS.sound, "1") !== "0";
  var worker = null, workerBroken = false, reqId = 0;

  function reduced() { return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches; }
  function later(ms, fn) {
    var t = matchToken;
    setTimeout(function () { if (t === matchToken) fn(); }, reduced() ? Math.min(ms, 120) : ms);
  }
  /* lock: a play in progress (between its steps, or waiting to auto-play a forced
     remainder) must not take input, or a tap lands on a board the play no longer
     matches */
  var lock = 0;
  function busy() { return lock > 0 || flyers.length > 0 || dice.some(function (d) { return d.anim; }) || !!cubeAnim; }

  /* ================= layout ================= */
  var dpr = 1, W = 0, H = 0, sceneCv = null, wallY = 0, props = {};

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.floor(W * dpr); canvas.height = Math.floor(H * dpr);
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    fit();
    buildSprites();
    placeProps();
    buildScene();
  }

  /* Screen offsets are linear in FOCAL, so one measure-and-scale pass fits exactly. */
  function fit() {
    CX = 0; CY = 0; FOCAL = 1000;
    var pts = [[EDGE_L, FRAME_Y, -ZE], [EDGE_R, FRAME_Y, -ZE], [EDGE_L, TABLE_Y, ZE], [EDGE_R, TABLE_Y, ZE]];
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    pts.forEach(function (q) {
      var p = project(q[0], q[1], q[2]);
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    });
    var narrow = W < 620, low = H < 560;
    var padX = narrow ? 6 : 36, padTop = low ? 48 : narrow ? 74 : Math.max(86, H * 0.2), padBot = low ? 52 : narrow ? 150 : 112;
    var availW = W - padX * 2, availH = H - padTop - padBot;
    var k = Math.min(availW / (maxX - minX), availH / (maxY - minY));
    FOCAL *= k;
    minX *= k; maxX *= k; minY *= k; maxY *= k;
    CX = W / 2 - (minX + maxX) / 2;
    /* in a tall layout the spare height goes above the board, where the sea is */
    var spare = availH - (maxY - minY);
    var top = padTop + (spare > 0 ? spare * (narrow ? 0.55 : 0.5) : spare / 2);
    CY = top - minY;
  }

  /* ================= small helpers ================= */
  function srnd(n) { var x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }
  function ease(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function panOf(x) { return clamp(x / 8, -0.85, 0.85); }
  function polyPath(g, pts) { g.beginPath(); g.moveTo(pts[0].x, pts[0].y); for (var i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y); g.closePath(); }
  function quadW(x0, z0, x1, z1, y) { return [project(x0, y, z0), project(x1, y, z0), project(x1, y, z1), project(x0, y, z1)]; }
  function rgbi(c, k) { return "rgb(" + (clamp(c[0] * k, 0, 255) | 0) + "," + (clamp(c[1] * k, 0, 255) | 0) + "," + (clamp(c[2] * k, 0, 255) | 0) + ")"; }
  /* Draw in a horizontal plane at height y with world units, as an affine map of
     the local neighborhood of (x, z). Good for small flat things: inlay, lettering. */
  function planeTransform(g, x, y, z, unit) {
    var o = project(x, y, z), ax = project(x + unit, y, z), az = project(x, y, z + unit);
    g.setTransform(dpr * (ax.x - o.x), dpr * (ax.y - o.y), dpr * (az.x - o.x), dpr * (az.y - o.y), dpr * o.x, dpr * o.y);
  }

  /* ================= checkers =================
     Turned hardwood, about as thick as a thumb: a fluted rim, two cut rings, and an
     inlay in the face (a walnut rosette in the bone checkers, a mother-of-pearl eye
     in the ebony ones). Baked once per layout at the nearest size, then scaled. */
  var PAL = [
    { t0: "#fffaf0", t1: "#eadfc4", t2: "#bba57d", b0: "#f1e5c9", b1: "#cdb891", b2: "#7f6b4c",
      groove: "rgba(118,90,52,0.5)", lo: "rgba(96,70,40,0.3)", hi: "rgba(255,252,240,0.45)", spec: "rgba(255,255,250,0.6)", ink: "#4a2e17" },
    { t0: "#61402e", t1: "#2c1a11", t2: "#0d0705", b0: "#4e3022", b1: "#24150d", b2: "#080403",
      groove: "rgba(0,0,0,0.6)", lo: "rgba(0,0,0,0.5)", hi: "rgba(255,214,170,0.15)", spec: "rgba(255,236,214,0.32)", ink: "#f6ead2" }
  ];
  var sprites = [], shadowSp = null, spriteRef = 1;

  function buildSprites() {
    spriteRef = project(0, 0, ZE).s;
    var U = spriteRef * dpr;
    sprites = [makeSprite(U, PAL[0], 0), makeSprite(U, PAL[1], 1)];
    var Rr = R * U, ry = Rr * SIN, sw = Math.ceil(Rr * 3.2), sh = Math.ceil(ry * 3.2);
    var c = document.createElement("canvas"); c.width = sw; c.height = sh;
    var g = c.getContext("2d");
    g.translate(sw / 2, sh / 2); g.scale(1, ry / Rr);
    var gr = g.createRadialGradient(0, 0, Rr * 0.4, 0, 0, Rr * 1.5);
    gr.addColorStop(0, "rgba(20,8,0,0.55)"); gr.addColorStop(0.55, "rgba(20,8,0,0.26)"); gr.addColorStop(1, "rgba(20,8,0,0)");
    g.fillStyle = gr; g.beginPath(); g.arc(0, 0, Rr * 1.55, 0, Math.PI * 2); g.fill();
    shadowSp = { cv: c, ax: sw / 2, ay: sh / 2 };
  }

  function makeSprite(U, pal, side) {
    var Rr = R * U, ry = Rr * SIN, Hp = CH * U * COS, pad = Math.ceil(Rr * 0.12) + 2;
    var w = Math.ceil(2 * Rr + pad * 2), h = Math.ceil(2 * ry + Hp + pad * 2);
    var c = document.createElement("canvas"); c.width = w; c.height = h;
    var g = c.getContext("2d");
    var cx = w / 2, by = h - pad - ry, top = by - Hp;
    /* the rim */
    g.save();
    g.beginPath();
    g.moveTo(cx - Rr, top); g.lineTo(cx - Rr, by);
    g.ellipse(cx, by, Rr, ry, 0, Math.PI, 0, true);
    g.lineTo(cx + Rr, top);
    g.ellipse(cx, top, Rr, ry, 0, 0, Math.PI, false);
    g.closePath();
    var bg = g.createLinearGradient(cx - Rr, 0, cx + Rr, 0);
    bg.addColorStop(0, pal.b0); bg.addColorStop(0.42, pal.b1); bg.addColorStop(1, pal.b2);
    g.fillStyle = bg; g.fill();
    g.clip();
    var N = 30;
    for (var k = 0; k < N; k++) {
      var a = Math.PI * (k + 0.5) / N, x = cx - Rr * Math.cos(a), dy = ry * Math.sin(a);
      var lw = Math.max(0.6, Rr * Math.PI / N * 0.4 * Math.sin(a));
      g.strokeStyle = pal.lo; g.lineWidth = lw;
      g.beginPath(); g.moveTo(x, top + dy - 1); g.lineTo(x, by + dy + 1); g.stroke();
      g.strokeStyle = pal.hi; g.lineWidth = lw * 0.45;
      g.beginPath(); g.moveTo(x - lw * 0.7, top + dy - 1); g.lineTo(x - lw * 0.7, by + dy + 1); g.stroke();
    }
    var sh = g.createLinearGradient(0, top, 0, by + ry);
    sh.addColorStop(0, "rgba(0,0,0,0)"); sh.addColorStop(1, "rgba(0,0,0,0.36)");
    g.fillStyle = sh; g.fillRect(cx - Rr, top, 2 * Rr, Hp + ry * 2);
    g.restore();

    /* the face */
    g.save();
    g.beginPath(); g.ellipse(cx, top, Rr, ry, 0, 0, Math.PI * 2);
    var tg = g.createRadialGradient(cx - Rr * 0.38, top - ry * 0.4, Rr * 0.05, cx, top, Rr * 1.25);
    tg.addColorStop(0, pal.t0); tg.addColorStop(0.5, pal.t1); tg.addColorStop(1, pal.t2);
    g.fillStyle = tg; g.fill();
    g.clip();
    /* a little wood figure in the face */
    for (var f = 0; f < 9; f++) {
      g.strokeStyle = side ? "rgba(255,220,180,0.05)" : "rgba(140,100,50,0.08)"; g.lineWidth = Math.max(0.6, Rr * 0.02);
      g.beginPath(); g.ellipse(cx + Rr * 0.9, top, Rr * (0.4 + f * 0.17), ry * (0.4 + f * 0.17), 0, 0, Math.PI * 2); g.stroke();
    }
    [0.82, 0.6].forEach(function (rr) {
      g.strokeStyle = pal.groove; g.lineWidth = Math.max(0.8, Rr * 0.04);
      g.beginPath(); g.ellipse(cx, top, Rr * rr, ry * rr, 0, 0, Math.PI * 2); g.stroke();
      g.strokeStyle = side ? "rgba(255,226,196,0.12)" : "rgba(255,255,248,0.5)"; g.lineWidth = Math.max(0.6, Rr * 0.02);
      g.beginPath(); g.ellipse(cx, top + Rr * 0.025, Rr * rr, ry * rr, 0, 0.15, Math.PI - 0.15); g.stroke();
    });
    if (side === 0) {
      /* a walnut rosette: eight dots round a center */
      for (var d = 0; d < 8; d++) {
        var an = d / 8 * Math.PI * 2;
        g.fillStyle = "#6a4426";
        g.beginPath(); g.ellipse(cx + Math.cos(an) * Rr * 0.27, top + Math.sin(an) * Rr * 0.27 * SIN, Rr * 0.07, Rr * 0.07 * SIN, 0, 0, Math.PI * 2); g.fill();
      }
      g.fillStyle = "#5a3a20"; g.beginPath(); g.ellipse(cx, top, Rr * 0.1, Rr * 0.1 * SIN, 0, 0, Math.PI * 2); g.fill();
    } else {
      pearl(g, cx, top, Rr * 0.24, Rr * 0.24 * SIN, 1);
    }
    var sp = g.createRadialGradient(cx - Rr * 0.4, top - ry * 0.45, 0, cx - Rr * 0.4, top - ry * 0.45, Rr * 0.65);
    sp.addColorStop(0, pal.spec); sp.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = sp; g.fillRect(cx - Rr, top - ry, 2 * Rr, 2 * ry);
    g.restore();
    /* the bevel: the sun catches the far-left lip, the near-right falls into shade */
    var bv = g.createLinearGradient(cx - Rr, top - ry, cx + Rr, top + ry);
    bv.addColorStop(0, "rgba(255,246,226,0.7)"); bv.addColorStop(0.5, "rgba(255,246,226,0.08)"); bv.addColorStop(1, "rgba(0,0,0,0.45)");
    g.strokeStyle = bv; g.lineWidth = Math.max(1, Rr * 0.05);
    g.beginPath(); g.ellipse(cx, top, Rr * 0.975, ry * 0.975, 0, 0, Math.PI * 2); g.stroke();
    return { cv: c, ax: cx, ay: by, top: by - top };
  }

  /* Mother-of-pearl: a milky shell with a shifting pink-green-blue sheen. */
  function pearl(g, cx, cy, rx, ry, a) {
    g.save();
    g.globalAlpha = a == null ? 1 : a;
    var pg = g.createRadialGradient(cx - rx * 0.3, cy - ry * 0.35, rx * 0.05, cx, cy, rx * 1.1);
    pg.addColorStop(0, "#fffdf6"); pg.addColorStop(0.35, "#f3e4ee"); pg.addColorStop(0.65, "#d9eee8"); pg.addColorStop(1, "#b9cfe0");
    g.fillStyle = pg; g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = "rgba(60,40,30,0.35)"; g.lineWidth = Math.max(0.5, rx * 0.12); g.stroke();
    g.restore();
  }

  function drawChecker(side, x, y, z, glow, alpha) {
    var b = project(x, y, z), sp = sprites[side];
    var k = b.s / spriteRef / dpr;
    if (alpha != null) ctx.globalAlpha = alpha;
    if (glow) {
      ctx.save();
      ctx.shadowColor = glow; ctx.shadowBlur = 16 * b.s / spriteRef;
      ctx.drawImage(sp.cv, b.x - sp.ax * k, b.y - sp.ay * k, sp.cv.width * k, sp.cv.height * k);
      ctx.restore();
    }
    ctx.drawImage(sp.cv, b.x - sp.ax * k, b.y - sp.ay * k, sp.cv.width * k, sp.cv.height * k);
    ctx.globalAlpha = 1;
  }
  function drawShadow(x, y, z, base, alpha) {
    /* the sun is up and to the left, so shadows fall to the near right */
    var lift = Math.max(0, y - base);
    var b = project(x + 0.07 + lift * 0.3, base, z + 0.06 + lift * 0.22);
    var k = b.s / spriteRef / dpr * (1 + lift * 0.4);
    ctx.globalAlpha = (alpha == null ? 1 : alpha) * Math.max(0.25, 1 - lift * 0.5);
    ctx.drawImage(shadowSp.cv, b.x - shadowSp.ax * k, b.y - shadowSp.ay * k, shadowSp.cv.width * k, shadowSp.cv.height * k);
    ctx.globalAlpha = 1;
  }
  function drawCount(side, x, y, z, n) {
    var p = project(x, y + CH, z);
    ctx.save();
    ctx.font = "800 " + Math.max(9, p.s * 0.42).toFixed(1) + "px Manrope, system-ui, sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillStyle = side === 0 ? "#3a2210" : "#fbeed4";
    ctx.fillText(String(n), p.x, p.y + p.s * 0.01);
    ctx.restore();
  }

  /* ================= the scene ================= */
  function buildScene() {
    sceneCv = document.createElement("canvas");
    sceneCv.width = canvas.width; sceneCv.height = canvas.height;
    var g = sceneCv.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    wallY = project(0, TABLE_Y, -7.4).y;
    drawBackdrop(g);
    drawTable(g);
    drawPropsBaked(g, "far");
    drawCase(g);
    drawPropsBaked(g, "near");
    /* afternoon sun from the upper left, warm; the far right corner falls into shade */
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    var c0 = project(0, 0, 0);
    var sun = g.createRadialGradient(c0.x - W * 0.45, wallY - H * 0.1, 0, c0.x - W * 0.3, wallY, Math.max(W, H) * 1.05);
    sun.addColorStop(0, "rgba(255,220,160,0.22)"); sun.addColorStop(0.5, "rgba(255,206,140,0.08)"); sun.addColorStop(1, "rgba(255,190,120,0)");
    g.globalCompositeOperation = "lighter"; g.fillStyle = sun; g.fillRect(0, Math.max(0, wallY), W, H);
    g.globalCompositeOperation = "source-over";
    var vg = g.createRadialGradient(W / 2, c0.y, Math.min(W, H) * 0.35, W / 2, c0.y, Math.max(W, H) * 0.85);
    vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(4,16,30,0.32)");
    g.fillStyle = vg; g.fillRect(0, 0, W, H);
    seedGlints();
    buildCaustics();
  }

  /* The view over the wall: sky, the Aegean with the sun's path on it, a headland
     with a castle on its hill, a white village at the water, sails, and
     bougainvillea hanging over the top of it all. */
  var SEA = { top: 0, bottom: 0, sunX: 0 };
  function drawBackdrop(g) {
    var bandH = Math.max(0, wallY);
    if (bandH < 6) { SEA.top = SEA.bottom = 0; return; }
    var capH = Math.min(34, Math.max(8, bandH * 0.17));
    var seaBottom = wallY - capH;
    var horizon = Math.max(0, seaBottom - Math.max(24, seaBottom * 0.6));
    if (seaBottom < 30) horizon = -10;
    SEA.top = horizon; SEA.bottom = seaBottom; SEA.sunX = W * 0.62;
    var hz = Math.max(0, horizon), hill = Math.min(46, Math.max(10, horizon * 0.42));
    /* sky: clear blue, warming to a gold haze at the horizon */
    var sk = g.createLinearGradient(0, horizon - Math.max(90, horizon), 0, horizon);
    sk.addColorStop(0, "#4f97d6"); sk.addColorStop(0.62, "#a9cfe6"); sk.addColorStop(1, "#fbe4bd");
    g.fillStyle = sk; g.fillRect(0, 0, W, hz + 1);
    if (horizon > 20) {
      /* fair-weather clouds, lit warm from below */
      for (var c = 0; c < 9; c++) {
        var cx = W * (0.08 + srnd(c * 3.1) * 0.9), cy = horizon * (0.18 + srnd(c * 7.7) * 0.5), cw = W * (0.05 + srnd(c) * 0.08);
        for (var puff = 0; puff < 5; puff++) {
          var px = cx + (puff - 2) * cw * 0.45, py = cy - Math.sin(puff / 4 * Math.PI) * cw * 0.18, pr = cw * (0.35 + Math.sin(puff / 4 * Math.PI) * 0.25);
          var cg = g.createRadialGradient(px, py - pr * 0.3, 0, px, py, pr);
          cg.addColorStop(0, "rgba(255,252,244,0.75)"); cg.addColorStop(0.7, "rgba(255,238,214,0.35)"); cg.addColorStop(1, "rgba(255,238,214,0)");
          g.fillStyle = cg; g.beginPath(); g.ellipse(px, py, pr, pr * 0.55, 0, 0, Math.PI * 2); g.fill();
        }
      }
      /* far mountains, then the headland with its castle */
      g.fillStyle = "rgba(118,140,170,0.55)";
      g.beginPath(); g.moveTo(W * 0.38, horizon + 1);
      for (var mx = 0; mx <= 30; mx++) { var mt = mx / 30; g.lineTo(W * (0.38 + mt * 0.4), horizon - (Math.sin(mt * Math.PI) * 0.55 + Math.sin(mt * 9) * 0.08) * hill * 0.6); }
      g.lineTo(W * 0.78, horizon + 1); g.closePath(); g.fill();
      var h0 = W * 0.62, h1 = W * 1.04;
      g.fillStyle = "#6f8a7a";
      g.beginPath(); g.moveTo(h0, horizon + 1);
      for (var hx = 0; hx <= 30; hx++) {
        var t = hx / 30, x = h0 + (h1 - h0) * t;
        var y = horizon - (Math.pow(Math.sin(Math.min(1, t * 1.25) * Math.PI * 0.5), 1.4) * (1 - Math.max(0, t - 0.75) * 1.6) + Math.sin(t * 13) * 0.04) * hill;
        g.lineTo(x, y);
      }
      g.lineTo(h1, horizon + 1); g.closePath(); g.fill();
      var hl = g.createLinearGradient(h0, 0, h1, 0);
      hl.addColorStop(0, "rgba(255,214,150,0.35)"); hl.addColorStop(1, "rgba(255,214,150,0)");
      g.fillStyle = hl; g.fill();
      /* the castle on the crown of the hill */
      var kx = h0 + (h1 - h0) * 0.42, ky = horizon - hill * 0.96, ks = Math.max(1.5, hill * 0.16);
      g.fillStyle = "#c9b48e";
      g.fillRect(kx - ks * 3.2, ky - ks * 1.4, ks * 6.4, ks * 1.6);
      g.fillRect(kx - ks * 2.6, ky - ks * 2.6, ks * 1.4, ks * 2.6);
      g.fillRect(kx + ks * 0.6, ky - ks * 3.2, ks * 1.6, ks * 3.2);
      for (var cr = -3; cr < 3; cr++) g.fillRect(kx + cr * ks + ks * 0.15, ky - ks * 1.8, ks * 0.55, ks * 0.45);
      g.fillStyle = "rgba(90,70,50,0.35)"; g.fillRect(kx + ks * 1.6, ky - ks * 3.2, ks * 0.6, ks * 3.2);
      /* a white village down at the water, terracotta roofs catching the sun */
      for (var hh = 0; hh < 16; hh++) {
        var hx2 = W * (0.8 + srnd(hh * 5.3) * 0.22), hy = horizon - hill * (0.05 + srnd(hh * 2.9) * 0.3);
        var hw = Math.max(3, hill * (0.12 + srnd(hh * 2) * 0.12)), hhh = hw * (0.6 + srnd(hh * 4) * 0.4);
        g.fillStyle = "#fbf6ec"; g.fillRect(hx2, hy - hhh, hw, hhh);
        g.fillStyle = "rgba(120,140,160,0.35)"; g.fillRect(hx2 + hw * 0.7, hy - hhh, hw * 0.3, hhh);
        if (srnd(hh * 7) > 0.45) { g.fillStyle = "#c8643b"; g.fillRect(hx2 - 0.5, hy - hhh - Math.max(1, hw * 0.18), hw + 1, Math.max(1, hw * 0.18)); }
      }
    }
    /* sea: hazy at the horizon, a clear bright blue close in */
    var sg = g.createLinearGradient(0, hz, 0, seaBottom);
    sg.addColorStop(0, "#9dd2e6"); sg.addColorStop(0.18, "#46a6d6"); sg.addColorStop(0.7, "#1f78b8"); sg.addColorStop(1, "#1a66a2");
    g.fillStyle = sg; g.fillRect(0, hz, W, seaBottom - hz + 1);
    g.strokeStyle = "rgba(255,255,255,0.08)"; g.lineWidth = 1;
    for (var s2 = 0; s2 < 28; s2++) {
      var f = Math.pow(s2 / 28, 1.8), yy = hz + (seaBottom - hz) * f;
      g.beginPath();
      for (var sx = 0; sx <= W; sx += 16) g.lineTo(sx, yy + Math.sin(sx * 0.03 + s2 * 1.7) * (1 + f * 2));
      g.stroke();
    }
    /* the sun's path on the water: a wide glare that the glints sparkle along */
    var path = g.createRadialGradient(SEA.sunX, hz, 0, SEA.sunX, hz + (seaBottom - hz) * 0.4, W * 0.4);
    path.addColorStop(0, "rgba(255,240,200,0.5)"); path.addColorStop(0.5, "rgba(255,240,200,0.14)"); path.addColorStop(1, "rgba(255,240,200,0)");
    g.globalCompositeOperation = "lighter"; g.fillStyle = path;
    g.fillRect(0, hz, W, seaBottom - hz);
    g.globalCompositeOperation = "source-over";
    /* sails */
    if (seaBottom - horizon > 30) {
      [[0.3, 0.16, 1], [0.44, 0.1, 0.8], [0.73, 0.24, 1.1]].forEach(function (sb) {
        var bx = W * sb[0], by = hz + (seaBottom - hz) * sb[1], bs = Math.max(4, (seaBottom - hz) * 0.06 * sb[2]);
        g.fillStyle = "rgba(255,252,246,0.95)";
        g.beginPath(); g.moveTo(bx, by); g.lineTo(bx, by - bs * 1.7); g.lineTo(bx + bs * 0.9, by); g.closePath(); g.fill();
        g.fillStyle = "rgba(220,226,232,0.9)";
        g.beginPath(); g.moveTo(bx - bs * 0.1, by - bs * 0.2); g.lineTo(bx - bs * 0.1, by - bs * 1.3); g.lineTo(bx - bs * 0.6, by - bs * 0.2); g.closePath(); g.fill();
        g.fillStyle = "rgba(30,50,70,0.65)"; g.fillRect(bx - bs * 0.6, by, bs * 1.6, Math.max(1, bs * 0.16));
      });
    }
    /* the wall: rough whitewash, bright on top, its face in shade */
    var cap = g.createLinearGradient(0, seaBottom, 0, wallY);
    cap.addColorStop(0, "#fffaf1"); cap.addColorStop(0.4, "#f1e9dc"); cap.addColorStop(1, "#c4b7a4");
    g.fillStyle = cap;
    g.beginPath(); g.moveTo(0, wallY);
    for (var wx = 0; wx <= W + 12; wx += 12) g.lineTo(wx, seaBottom + Math.sin(wx * 0.05) * 1.2 + (srnd(wx) - 0.5) * 1.6);
    g.lineTo(W, wallY); g.closePath(); g.fill();
    for (var st = 0; st < 60; st++) {
      g.fillStyle = "rgba(140,124,104," + (0.05 + srnd(st) * 0.08) + ")";
      g.beginPath(); g.ellipse(srnd(st * 3.3) * W, seaBottom + capH * (0.25 + srnd(st * 1.9) * 0.7), 3 + srnd(st * 9) * 12, 1 + srnd(st * 4) * 2, 0, 0, Math.PI * 2); g.fill();
    }
    bougainvillea(g, Math.min(W * 0.36, 230), seaBottom);
  }

  function bougainvillea(g, reach, seaBottom) {
    var n = Math.floor(reach * 0.9);
    for (var i = 0; i < n; i++) {
      var t = srnd(i * 1.37), u = srnd(i * 2.71);
      var x = t * reach * (1 - u * 0.25), y = Math.pow(u, 1.6) * Math.min(seaBottom * 0.9, reach * 0.7) - 4;
      if (y > seaBottom - 4) continue;
      var r = 2.5 + srnd(i * 5.3) * 4;
      if (srnd(i * 8.1) < 0.36) {
        g.fillStyle = "rgba(" + (40 + srnd(i) * 30 | 0) + "," + (86 + srnd(i * 3) * 40 | 0) + "," + (44 + srnd(i * 2) * 20 | 0) + ",0.9)";
        g.beginPath(); g.ellipse(x, y, r * 1.5, r * 0.75, srnd(i * 4) * Math.PI, 0, Math.PI * 2); g.fill();
      } else {
        var pinks = ["#d93a85", "#e85a9a", "#c42b74", "#f07bb0", "#b8236a"];
        g.fillStyle = pinks[(srnd(i * 6.2) * pinks.length) | 0];
        for (var p = 0; p < 3; p++) {
          var a = p / 3 * Math.PI * 2 + i;
          g.beginPath(); g.ellipse(x + Math.cos(a) * r * 0.55, y + Math.sin(a) * r * 0.55, r * 0.7, r * 0.5, a, 0, Math.PI * 2); g.fill();
        }
        g.fillStyle = "rgba(255,240,210,0.8)"; g.beginPath(); g.arc(x, y, Math.max(0.6, r * 0.18), 0, Math.PI * 2); g.fill();
      }
    }
  }

  /* The table: planks painted the blue of the shutters, weathered through to the
     wood where elbows and glasses have worn it. */
  var TABLE_BLUE = [72, 128, 188], WOOD = [158, 140, 116];
  function drawTable(g) {
    var top = Math.max(0, wallY);
    g.save();
    g.beginPath(); g.rect(0, top, W, H - top); g.clip();
    g.fillStyle = rgbi(TABLE_BLUE, 0.8); g.fillRect(0, top, W, H - top);
    var z0 = -7.4, pw = 1.45;
    for (var i = 0; i < 40; i++) {
      var za = z0 + i * pw, zb = za + pw;
      var q = quadW(-40, za, 40, zb, TABLE_Y);
      if (q[0].y > H + 4) break;
      var tone = 0.82 + srnd(i * 3.7) * 0.2;
      polyPath(g, q); g.fillStyle = rgbi(TABLE_BLUE, tone); g.fill();
      /* brush strokes along the plank */
      g.save(); polyPath(g, q); g.clip();
      for (var k = 0; k < 70; k++) {
        var xw = -14 + srnd(i * 31 + k * 1.3) * 28, zw = za + srnd(i * 17 + k * 2.1) * pw;
        var p0 = project(xw, TABLE_Y, zw), p1 = project(xw + 0.6 + srnd(k + i) * 1.6, TABLE_Y, zw + (srnd(k * 3 + i) - 0.5) * 0.04);
        g.strokeStyle = srnd(k * 7 + i) > 0.45 ? "rgba(235,246,255,0.09)" : "rgba(0,20,50,0.08)";
        g.lineWidth = Math.max(0.6, p0.s * 0.03);
        g.beginPath(); g.moveTo(p0.x, p0.y); g.lineTo(p1.x, p1.y); g.stroke();
      }
      /* worn patches: the paint gone, the wood showing */
      for (var w = 0; w < 7; w++) {
        if (srnd(i * 13 + w) < 0.4) continue;
        /* paint chipped along the grain: short ragged slivers of bare wood */
        var cx = -14 + srnd(i * 7 + w * 3) * 28, cz = za + pw * (0.12 + srnd(i * 5 + w) * 0.76);
        var len = 0.25 + srnd(i + w * 9) * 0.9, c0 = project(cx, TABLE_Y, cz), c1 = project(cx + len, TABLE_Y, cz + (srnd(w * 3 + i) - 0.5) * 0.06);
        g.strokeStyle = "rgba(" + WOOD[0] + "," + WOOD[1] + "," + WOOD[2] + "," + (0.35 + srnd(w * 7 + i) * 0.3).toFixed(2) + ")";
        g.lineWidth = Math.max(1, c0.s * (0.04 + srnd(i * 3 + w) * 0.07)); g.lineCap = "round";
        g.beginPath(); g.moveTo(c0.x, c0.y); g.lineTo(c1.x, c1.y); g.stroke();
        g.lineCap = "butt";
      }
      g.restore();
      /* the gap between planks */
      var s0 = project(-40, TABLE_Y, za), s1 = project(40, TABLE_Y, za);
      g.strokeStyle = "rgba(6,24,36,0.65)"; g.lineWidth = Math.max(1, s0.s * 0.05);
      g.beginPath(); g.moveTo(s0.x, s0.y); g.lineTo(s1.x, s1.y); g.stroke();
      g.strokeStyle = "rgba(255,255,255,0.08)"; g.lineWidth = 1;
      g.beginPath(); g.moveTo(s0.x, s0.y + Math.max(1, s0.s * 0.04)); g.lineTo(s1.x, s1.y + Math.max(1, s0.s * 0.04)); g.stroke();
    }
    g.restore();
    /* dappled shade from the bougainvillea over the top-left of the table */
    for (var l = 0; l < 26; l++) {
      var lx = -16 + srnd(l * 4.1) * 10, lz = -7.5 + srnd(l * 6.3) * 7;
      var lc = project(lx, TABLE_Y, lz), lr = lc.s * (0.4 + srnd(l * 2.2) * 1.1);
      var lg = g.createRadialGradient(lc.x, lc.y, 0, lc.x, lc.y, lr);
      lg.addColorStop(0, "rgba(6,22,48,0.2)"); lg.addColorStop(1, "rgba(6,22,48,0)");
      g.fillStyle = lg; g.beginPath(); g.ellipse(lc.x, lc.y, lr, lr * SIN * 0.7, srnd(l) * 3, 0, Math.PI * 2); g.fill();
    }
    /* the wall's shadow falls across the far planks */
    if (wallY > 0) {
      var ws = g.createLinearGradient(0, wallY, 0, wallY + Math.max(20, project(0, TABLE_Y, -6.5).y - wallY));
      ws.addColorStop(0, "rgba(4,18,30,0.45)"); ws.addColorStop(1, "rgba(4,18,30,0)");
      g.fillStyle = ws; g.fillRect(0, wallY, W, Math.max(20, project(0, TABLE_Y, -6.5).y - wallY));
    }
  }

  /* ---------- the inlaid case ---------- */
  var WALNUT = [108, 64, 36], FIELDW = [218, 180, 128], EBONY = [56, 33, 20], BONE = [242, 231, 208];
  function grain(g, x0, z0, x1, z1, y, n, seed, dark, light, along) {
    g.save(); polyPath(g, quadW(x0, z0, x1, z1, y)); g.clip();
    for (var k = 0; k < n; k++) {
      var t = srnd(seed + k * 1.7), u = srnd(seed * 3 + k * 2.3);
      var a, b;
      if (along === "z") {
        var xx = x0 + t * (x1 - x0);
        a = project(xx, y, z0); b = project(xx + (u - 0.5) * 0.12, y, z1);
      } else {
        var zz = z0 + t * (z1 - z0);
        a = project(x0, y, zz); b = project(x1, y, zz + (u - 0.5) * 0.15);
      }
      g.strokeStyle = srnd(seed + k * 5) > 0.55 ? light : dark;
      g.lineWidth = Math.max(0.5, a.s * (0.012 + srnd(k * 9 + seed) * 0.03));
      g.beginPath(); g.moveTo(a.x, a.y);
      var mx = (a.x + b.x) / 2 + (srnd(k * 11 + seed) - 0.5) * a.s * 0.25, my = (a.y + b.y) / 2 + (srnd(k * 13 + seed) - 0.5) * a.s * 0.08;
      g.quadraticCurveTo(mx, my, b.x, b.y); g.stroke();
    }
    g.restore();
  }

  function drawCase(g) {
    var s0 = project(0, 0, 0).s;
    /* shadow of the case on the table, cast to the near right */
    g.save();
    g.shadowColor = "rgba(2,12,20,0.6)"; g.shadowBlur = s0 * 0.8; g.shadowOffsetX = s0 * 0.35; g.shadowOffsetY = s0 * 0.4;
    polyPath(g, quadW(EDGE_L, -ZE, EDGE_R, ZE, TABLE_Y)); g.fillStyle = "#000"; g.fill();
    g.restore();
    /* the near face of the case */
    var f = [project(EDGE_L, FRAME_Y, ZE), project(EDGE_R, FRAME_Y, ZE), project(EDGE_R, TABLE_Y, ZE), project(EDGE_L, TABLE_Y, ZE)];
    polyPath(g, f);
    var fg = g.createLinearGradient(0, f[0].y, 0, f[2].y);
    fg.addColorStop(0, rgbi(WALNUT, 0.95)); fg.addColorStop(1, rgbi(WALNUT, 0.45));
    g.fillStyle = fg; g.fill();
    /* a pearl line along the face */
    var lf0 = project(EDGE_L + 0.3, (FRAME_Y + TABLE_Y) / 2, ZE), lf1 = project(EDGE_R - 0.3, (FRAME_Y + TABLE_Y) / 2, ZE);
    g.strokeStyle = "rgba(240,232,236,0.5)"; g.lineWidth = Math.max(1, s0 * 0.025);
    g.beginPath(); g.moveTo(lf0.x, lf0.y); g.lineTo(lf1.x, lf1.y); g.stroke();
    /* the frame's top */
    polyPath(g, quadW(EDGE_L, -ZE, EDGE_R, ZE, FRAME_Y));
    g.fillStyle = rgbi(WALNUT, 1); g.fill();
    grain(g, EDGE_L, -ZE, EDGE_R, ZE, FRAME_Y, 260, 11, "rgba(30,14,6,0.22)", "rgba(255,210,160,0.06)", "x");
    /* recesses: the two fields and the tray, with their far and side walls showing */
    recess(g, -FIELD, -BAR, 0);
    recess(g, BAR, FIELD, 0);
    recess(g, TRAY0, TRAY1, TRAY_Y);
    fieldWood(g, -FIELD, -BAR, 21);
    fieldWood(g, BAR, FIELD, 37);
    trayFloor(g);
    drawPoints(g);
    inlayFrame(g);
    drawBar(g);
    /* the varnish catches the sun along the near lip */
    g.strokeStyle = "rgba(255,226,180,0.32)"; g.lineWidth = Math.max(1, s0 * 0.02);
    g.beginPath(); g.moveTo(f[0].x, f[0].y); g.lineTo(f[1].x, f[1].y); g.stroke();
  }

  function recess(g, x0, x1, y) {
    var depth = FRAME_Y - y;
    /* far wall (faces you) */
    var far = [project(x0, FRAME_Y, -ZF), project(x1, FRAME_Y, -ZF), project(x1, y, -ZF), project(x0, y, -ZF)];
    polyPath(g, far); g.fillStyle = rgbi(WALNUT, 0.62); g.fill();
    /* side walls: the one on the left faces right and shows if you sit to its right */
    if (CAM.x > x0) {
      var lw = [project(x0, FRAME_Y, -ZF), project(x0, FRAME_Y, ZF), project(x0, y, ZF), project(x0, y, -ZF)];
      polyPath(g, lw); g.fillStyle = rgbi(WALNUT, 0.55); g.fill();
    }
    if (CAM.x < x1) {
      var rw = [project(x1, FRAME_Y, -ZF), project(x1, FRAME_Y, ZF), project(x1, y, ZF), project(x1, y, -ZF)];
      polyPath(g, rw); g.fillStyle = rgbi(WALNUT, 0.4); g.fill();
    }
    if (depth <= 0) return;
  }

  function fieldWood(g, x0, x1, seed) {
    var q = quadW(x0, -ZF, x1, ZF, 0);
    polyPath(g, q);
    var fg = g.createLinearGradient(q[0].x, q[0].y, q[2].x, q[2].y);
    fg.addColorStop(0, rgbi(FIELDW, 1.05)); fg.addColorStop(1, rgbi(FIELDW, 0.86));
    g.fillStyle = fg; g.fill();
    grain(g, x0, -ZF, x1, ZF, 0, 150, seed, "rgba(120,72,30,0.16)", "rgba(255,236,200,0.12)", "z");
    /* the frame's lip shades the edges of the field */
    var sh = g.createLinearGradient(0, project(0, 0, -ZF).y, 0, project(0, 0, -ZF + 0.6).y);
    sh.addColorStop(0, "rgba(40,20,8,0.35)"); sh.addColorStop(1, "rgba(40,20,8,0)");
    g.save(); polyPath(g, q); g.clip(); g.fillStyle = sh; g.fillRect(0, 0, W, H); g.restore();
  }

  function trayFloor(g) {
    polyPath(g, quadW(TRAY0, -ZF, TRAY1, ZF, TRAY_Y));
    g.fillStyle = rgbi(WALNUT, 0.7); g.fill();
    grain(g, TRAY0, -ZF, TRAY1, ZF, TRAY_Y, 50, 77, "rgba(20,10,4,0.25)", "rgba(255,210,160,0.05)", "z");
    /* the divider between your tray and theirs */
    polyPath(g, quadW(TRAY0, -0.08, TRAY1, 0.08, FRAME_Y));
    g.fillStyle = rgbi(WALNUT, 1.05); g.fill();
  }

  /* Points: long ebony and bone triangles, each outlined with a hairline of the
     other and set with a pearl dot at its base. */
  function triangle(p) {
    var x = pointX(p), top = p >= 13, zb = top ? -ZF : ZF, zt = top ? -ZF + PTLEN : ZF - PTLEN;
    return [project(x - 0.47, 0, zb), project(x + 0.47, 0, zb), project(x, 0, zt)];
  }
  function drawPoints(g) {
    for (var p = 1; p <= 24; p++) {
      var dark = p % 2 === 1, tri = triangle(p), x = pointX(p), top = p >= 13;
      polyPath(g, tri);
      var base = dark ? EBONY : BONE;
      var tg = g.createLinearGradient(tri[0].x, tri[0].y, tri[2].x, tri[2].y);
      tg.addColorStop(0, rgbi(base, 1.04)); tg.addColorStop(1, rgbi(base, dark ? 0.85 : 0.9));
      g.fillStyle = tg; g.fill();
      /* inlay grain runs the length of the point */
      g.save(); polyPath(g, tri); g.clip();
      for (var k = 0; k < 9; k++) {
        var gx = x - 0.4 + srnd(p * 13 + k) * 0.8;
        var a = project(gx, 0, top ? -ZF : ZF), b = project(x + (gx - x) * 0.2, 0, top ? -ZF + PTLEN : ZF - PTLEN);
        g.strokeStyle = dark ? "rgba(255,220,180,0.06)" : "rgba(130,96,54,0.12)"; g.lineWidth = Math.max(0.5, a.s * 0.02);
        g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
      }
      g.restore();
      polyPath(g, tri);
      g.strokeStyle = dark ? "rgba(236,214,170,0.55)" : "rgba(70,44,24,0.5)"; g.lineWidth = Math.max(0.7, tri[0].s * 0.022); g.stroke();
      var dot = project(x, 0, top ? -ZF + 0.34 : ZF - 0.34);
      pearl(g, dot.x, dot.y, dot.s * 0.09, dot.s * 0.09 * SIN, 0.95);
    }
  }

  /* Pearl diamonds chained around the frame, a rosette at each corner. */
  function inlayFrame(g) {
    var y = FRAME_Y, s0 = project(0, y, 0).s;
    function chain(x0, z0, x1, z1, n) {
      for (var i = 0; i <= n; i++) {
        var t = i / n, x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t;
        var d = 0.085, along = Math.abs(x1 - x0) > Math.abs(z1 - z0);
        var pts = along ? [project(x - d * 1.6, y, z), project(x, y, z - d), project(x + d * 1.6, y, z), project(x, y, z + d)]
                        : [project(x, y, z - d * 1.6), project(x + d, y, z), project(x, y, z + d * 1.6), project(x - d, y, z)];
        polyPath(g, pts);
        var c = project(x, y, z);
        var pg = g.createRadialGradient(c.x - c.s * 0.04, c.y - c.s * 0.03, 0, c.x, c.y, c.s * 0.18);
        pg.addColorStop(0, "#fffcf4"); pg.addColorStop(0.5, i % 3 === 0 ? "#efdcea" : i % 3 === 1 ? "#dcefe9" : "#e6e4f4"); pg.addColorStop(1, "#b8c8d8");
        g.fillStyle = pg; g.fill();
      }
    }
    var mz = (ZE + ZF) / 2, mxL = (EDGE_L - FIELD) / 2;
    chain(-FIELD + 0.2, -mz, -BAR - 0.2, -mz, 22);
    chain(BAR + 0.2, -mz, FIELD - 0.2, -mz, 22);
    chain(-FIELD + 0.2, mz, -BAR - 0.2, mz, 22);
    chain(BAR + 0.2, mz, FIELD - 0.2, mz, 22);
    chain(mxL, -ZF + 0.3, mxL, ZF - 0.3, 40);
    /* thin bone stringing just inside the edges */
    g.strokeStyle = "rgba(236,222,192,0.45)"; g.lineWidth = Math.max(0.6, s0 * 0.014);
    polyPath(g, quadW(EDGE_L + 0.08, -ZE + 0.08, EDGE_R - 0.08, ZE - 0.08, y)); g.stroke();
    [[EDGE_L + 0.28, -ZE + 0.28], [EDGE_R - 0.2, -ZE + 0.28], [EDGE_L + 0.28, ZE - 0.28], [EDGE_R - 0.2, ZE - 0.28]].forEach(function (c) {
      rosette(g, c[0], y, c[1], 0.17);
    });
  }

  function rosette(g, x, y, z, r) {
    for (var i = 0; i < 8; i++) {
      var a = i / 8 * Math.PI * 2, px = x + Math.cos(a) * r * 0.55, pz = z + Math.sin(a) * r * 0.55;
      var c = project(px, y, pz);
      pearl(g, c.x, c.y, c.s * r * 0.36, c.s * r * 0.36 * SIN, 0.95);
    }
    var m = project(x, y, z);
    g.fillStyle = "#2a160b"; g.beginPath(); g.ellipse(m.x, m.y, m.s * r * 0.26, m.s * r * 0.26 * SIN, 0, 0, Math.PI * 2); g.fill();
  }

  /* The bar is where the case folds: the hinge seam down the middle, two brass
     hinges, and a pearl rosette between them. */
  function drawBar(g) {
    var y = FRAME_Y;
    var seam0 = project(0, y, -ZE + 0.05), seam1 = project(0, y, ZE - 0.05);
    g.strokeStyle = "rgba(14,6,2,0.85)"; g.lineWidth = Math.max(1, seam0.s * 0.04);
    g.beginPath(); g.moveTo(seam0.x, seam0.y); g.lineTo(seam1.x, seam1.y); g.stroke();
    [-3.6, 3.6].forEach(function (zc) {
      var q = quadW(-0.22, zc - 0.55, 0.22, zc + 0.55, y + 0.01);
      polyPath(g, q);
      var hg = g.createLinearGradient(q[0].x, q[0].y, q[2].x, q[2].y);
      hg.addColorStop(0, "#f3d48e"); hg.addColorStop(0.5, "#b88a3e"); hg.addColorStop(1, "#6f4f1e");
      g.fillStyle = hg; g.fill();
      g.strokeStyle = "rgba(40,24,6,0.6)"; g.lineWidth = 1; g.stroke();
      [-0.35, 0, 0.35].forEach(function (dz) {
        [-0.12, 0.12].forEach(function (dx) {
          var sc = project(dx, y + 0.01, zc + dz);
          g.fillStyle = "rgba(60,40,10,0.8)"; g.beginPath(); g.ellipse(sc.x, sc.y, sc.s * 0.035, sc.s * 0.035 * SIN, 0, 0, Math.PI * 2); g.fill();
        });
      });
    });
    rosette(g, 0, y, 0, 0.36);
  }

  /* ---------- table props ---------- */
  function placeProps() {
    /* what part of the table can be seen, in world units, near the board */
    var leftNear = unproject(8, project(0, TABLE_Y, ZE + 1.5).y, TABLE_Y).x;
    var rightNear = unproject(W - 8, project(0, TABLE_Y, ZE + 1.5).y, TABLE_Y).x;
    var bottomZ = unproject(W / 2, H - 4, TABLE_Y).z;
    var side = Math.min(EDGE_L - leftNear, rightNear - EDGE_R);
    props = {};
    if (side > 1.9) {
      props.cup0 = { x: EDGE_R + 1.6, z: 3.6 };
      props.glass0 = { x: EDGE_L - 1.5, z: 3.2 };
      props.glass1 = { x: EDGE_R + 1.7, z: -3.4 };
      props.cup1 = { x: EDGE_L - 1.6, z: -3.0 };
      props.beads = { x: EDGE_L - 1.7, z: -0.2 };
    } else if (bottomZ > ZE + 2.2) {
      var z = Math.min(ZE + 1.7, bottomZ - 0.8);
      props.cup0 = { x: 5.4, z: z };
      props.glass0 = { x: -4.6, z: z + 0.2 };
      props.beads = { x: 0.8, z: z + 0.3 };
      props.cup1 = null;
    }
    if (!props.cup0) props.cup0 = null;
  }

  function drawPropsBaked(g, layer) {
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    ["glass0", "glass1", "beads"].forEach(function (k) {
      var p = props[k];
      if (!p) return;
      if ((layer === "far") !== (p.z < 0)) return;
      if (k === "beads") beads(g, p.x, p.z);
      else teaGlass(g, p.x, p.z, k === "glass1");
    });
  }

  /* A tulip glass of tea on a saucer: amber tea, the glass catching the sun. */
  function teaGlass(g, x, z, half) {
    var b = project(x, TABLE_Y, z), s = b.s * 1.35;
    /* shadow */
    g.fillStyle = "rgba(2,14,24,0.35)";
    g.beginPath(); g.ellipse(b.x + s * 0.5, b.y + s * 0.18, s * 0.72, s * 0.72 * SIN * 0.7, 0, 0, Math.PI * 2); g.fill();
    /* saucer */
    g.fillStyle = "#f4ede0"; g.beginPath(); g.ellipse(b.x, b.y, s * 0.62, s * 0.62 * SIN, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = "#b8322a"; g.lineWidth = Math.max(1, s * 0.04);
    g.beginPath(); g.ellipse(b.x, b.y, s * 0.55, s * 0.55 * SIN, 0, 0, Math.PI * 2); g.stroke();
    g.fillStyle = "rgba(160,140,120,0.35)"; g.beginPath(); g.ellipse(b.x, b.y, s * 0.3, s * 0.3 * SIN, 0, 0, Math.PI * 2); g.fill();
    /* the glass: a waist and a flared rim */
    var hgt = 0.95 * s * COS, rB = s * 0.2, rW = s * 0.15, rT = s * 0.27;
    var yB = b.y - s * 0.02, yW = yB - hgt * 0.42, yT = yB - hgt;
    var fill = half ? 0.55 : 0.82, yTea = yB - hgt * fill;
    function side(sign) { return [b.x + sign * rB, yB, b.x + sign * rW * 0.9, yW + hgt * 0.1, b.x + sign * rW, yW, b.x + sign * rT, yT]; }
    function outline() {
      var L = side(-1), Rr = side(1);
      g.beginPath();
      g.moveTo(L[0], L[1]); g.bezierCurveTo(L[2], L[3], L[4], L[5] + hgt * 0.05, L[4], L[5]);
      g.bezierCurveTo(L[4], L[5] - hgt * 0.2, L[6], L[7] + hgt * 0.25, L[6], L[7]);
      g.lineTo(Rr[6], Rr[7]);
      g.bezierCurveTo(Rr[6], Rr[7] + hgt * 0.25, Rr[4], Rr[5] - hgt * 0.2, Rr[4], Rr[5]);
      g.bezierCurveTo(Rr[4], Rr[5] + hgt * 0.05, Rr[2], Rr[3], Rr[0], Rr[1]);
      g.ellipse(b.x, yB, rB, rB * SIN, 0, 0, Math.PI, false);
      g.closePath();
    }
    g.save(); outline(); g.clip();
    /* tea */
    var tg = g.createLinearGradient(b.x - rT, 0, b.x + rT, 0);
    tg.addColorStop(0, "#7a2208"); tg.addColorStop(0.35, "#c95a1c"); tg.addColorStop(0.6, "#e58a3a"); tg.addColorStop(1, "#6a1c06");
    g.fillStyle = tg; g.fillRect(b.x - rT * 1.2, yTea, rT * 2.4, yB - yTea + rB);
    g.fillStyle = "rgba(255,255,255,0.08)"; g.fillRect(b.x - rT * 1.2, yT, rT * 2.4, yTea - yT);
    g.restore();
    /* tea surface */
    var rTea = rW + (rT - rW) * Math.max(0, (fill - 0.42) / 0.58);
    g.fillStyle = "#a8420f"; g.beginPath(); g.ellipse(b.x, yTea, rTea, rTea * SIN, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = "rgba(255,200,140,0.45)"; g.beginPath(); g.ellipse(b.x - rTea * 0.3, yTea - rTea * SIN * 0.2, rTea * 0.35, rTea * SIN * 0.25, 0, 0, Math.PI * 2); g.fill();
    /* glass edges and the sun on them */
    outline(); g.strokeStyle = "rgba(255,255,255,0.35)"; g.lineWidth = Math.max(0.8, s * 0.025); g.stroke();
    g.fillStyle = "rgba(255,255,255,0.55)";
    g.beginPath(); g.ellipse(b.x - rT * 0.55, yT + hgt * 0.22, rT * 0.08, hgt * 0.16, 0.08, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.ellipse(b.x - rB * 0.5, yB - hgt * 0.15, rB * 0.07, hgt * 0.08, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = "rgba(255,255,255,0.6)"; g.lineWidth = Math.max(0.8, s * 0.02);
    g.beginPath(); g.ellipse(b.x, yT, rT, rT * SIN, 0, 0, Math.PI * 2); g.stroke();
    /* a teaspoon on the saucer */
    g.strokeStyle = "rgba(210,210,215,0.9)"; g.lineWidth = Math.max(1, s * 0.035); g.lineCap = "round";
    g.beginPath(); g.moveTo(b.x + s * 0.18, b.y + s * 0.2 * SIN); g.lineTo(b.x + s * 0.55, b.y + s * 0.38 * SIN); g.stroke();
    g.lineCap = "butt";
  }

  /* Worry beads: a loop of amber with a tassel, left in a heap. */
  function beads(g, x, z) {
    var n = 19, pts = [];
    for (var i = 0; i < n; i++) {
      var a = i / n * Math.PI * 2;
      var rr = 0.7 + Math.sin(a * 2 + 1) * 0.15;
      pts.push(project(x + Math.cos(a) * rr * 1.2, TABLE_Y + 0.05, z + Math.sin(a) * rr * 0.8));
    }
    var t0 = pts[0], tz = project(x + 1.7, TABLE_Y, z + 0.6);
    g.strokeStyle = "rgba(60,20,10,0.6)"; g.lineWidth = Math.max(0.6, t0.s * 0.02);
    g.beginPath(); pts.forEach(function (p, i) { if (i) g.lineTo(p.x, p.y); else g.moveTo(p.x, p.y); }); g.closePath(); g.stroke();
    /* tassel */
    for (var t = 0; t < 7; t++) {
      g.strokeStyle = "rgba(150,30,30,0.85)"; g.lineWidth = Math.max(0.7, t0.s * 0.025);
      g.beginPath(); g.moveTo(t0.x, t0.y); g.quadraticCurveTo((t0.x + tz.x) / 2, (t0.y + tz.y) / 2 + t, tz.x + (t - 3) * t0.s * 0.04, tz.y + t0.s * 0.05); g.stroke();
    }
    pts.slice().sort(function (a, b) { return a.y - b.y; }).forEach(function (p, i) {
      var r = p.s * 0.125;
      g.fillStyle = "rgba(2,14,24,0.3)"; g.beginPath(); g.ellipse(p.x + r * 0.5, p.y + r * 0.4, r, r * 0.6, 0, 0, Math.PI * 2); g.fill();
      var bg = g.createRadialGradient(p.x - r * 0.35, p.y - r * 0.4, 0, p.x, p.y, r);
      bg.addColorStop(0, "#ffe2a0"); bg.addColorStop(0.45, "#e09228"); bg.addColorStop(1, "#7a3a08");
      g.fillStyle = bg; g.beginPath(); g.arc(p.x, p.y, r, 0, Math.PI * 2); g.fill();
    });
  }

  /* A leather dice cup, drawn live because it shakes. */
  function drawCup(p, shake, t) {
    if (!p) return;
    var jx = 0, jz = 0, lift = 0;
    if (shake > 0) { jx = Math.sin(t * 0.055) * 0.12 * shake; jz = Math.cos(t * 0.047) * 0.08 * shake; lift = 0.25 * shake; }
    var x = p.x + jx, z = p.z + jz, r = 0.6, h = 1.15, y0 = TABLE_Y + lift;
    var b = project(x, y0, z), tp = project(x, y0 + h, z), s = b.s;
    ctx.fillStyle = "rgba(2,14,24," + (0.35 - lift * 0.4) + ")";
    var sb = project(x + 0.35 + lift * 0.5, TABLE_Y, z + 0.25 + lift * 0.3);
    ctx.beginPath(); ctx.ellipse(sb.x, sb.y, s * r * 1.15, s * r * 1.15 * SIN, 0, 0, Math.PI * 2); ctx.fill();
    var rb = s * r * 0.92, rt = tp.s * r;
    ctx.beginPath();
    ctx.moveTo(b.x - rb, b.y);
    ctx.lineTo(tp.x - rt, tp.y);
    ctx.ellipse(tp.x, tp.y, rt, rt * SIN, 0, Math.PI, 0, true);
    ctx.lineTo(b.x + rb, b.y);
    ctx.ellipse(b.x, b.y, rb, rb * SIN, 0, 0, Math.PI, false);
    ctx.closePath();
    var lg = ctx.createLinearGradient(b.x - rb, 0, b.x + rb, 0);
    lg.addColorStop(0, "#8a5530"); lg.addColorStop(0.35, "#5d3218"); lg.addColorStop(1, "#22110a");
    ctx.fillStyle = lg; ctx.fill();
    /* stitching around the top and a tooled band */
    ctx.strokeStyle = "rgba(240,210,160,0.55)"; ctx.lineWidth = Math.max(0.7, s * 0.02); ctx.setLineDash([s * 0.05, s * 0.04]);
    var st = project(x, y0 + h * 0.84, z);
    ctx.beginPath(); ctx.ellipse(st.x, st.y, st.s * r * 0.98, st.s * r * 0.98 * SIN, 0, 0, Math.PI, false); ctx.stroke();
    var st2 = project(x, y0 + h * 0.16, z);
    ctx.beginPath(); ctx.ellipse(st2.x, st2.y, st2.s * r * 0.93, st2.s * r * 0.93 * SIN, 0, 0, Math.PI, false); ctx.stroke();
    ctx.setLineDash([]);
    /* the mouth */
    ctx.fillStyle = "#170a05"; ctx.beginPath(); ctx.ellipse(tp.x, tp.y, rt * 0.9, rt * 0.9 * SIN, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#a06a3c"; ctx.lineWidth = Math.max(1, s * 0.05);
    ctx.beginPath(); ctx.ellipse(tp.x, tp.y, rt * 0.95, rt * 0.95 * SIN, 0, 0, Math.PI * 2); ctx.stroke();
  }

  /* ---------- the light off the water ----------
     A caustic tile (thin bright lines where crossing ripples focus the light),
     drawn twice across the table drifting in different directions. */
  var caustic = null, glints = [];
  function buildCaustics() {
    var N = 192, c = document.createElement("canvas"); c.width = N; c.height = N;
    var g = c.getContext("2d"), img = g.createImageData(N, N), d = img.data;
    var waves = [[1, 2, 0.3], [-2, 1, 1.7], [3, -1, 2.9], [1, -3, 4.1], [-1, -2, 5.3]];
    for (var y = 0; y < N; y++) for (var x = 0; x < N; x++) {
      var v = 0;
      for (var k = 0; k < waves.length; k++) v += Math.cos((waves[k][0] * x + waves[k][1] * y) / N * Math.PI * 2 + waves[k][2]);
      var l = Math.pow(Math.max(0, 1 - Math.abs(v) * 0.55), 5);
      var i = (y * N + x) * 4;
      d[i] = 255; d[i + 1] = 244; d[i + 2] = 220; d[i + 3] = l * 255;
    }
    g.putImageData(img, 0, 0);
    caustic = { cv: c, n: N, pat: null };
  }
  function seedGlints() {
    glints = [];
    if (!(SEA.bottom > SEA.top + 6)) return;
    for (var i = 0; i < 70; i++) {
      var f = Math.pow(Math.random(), 0.7);
      glints.push({ x: SEA.sunX + (Math.random() - 0.5) * W * (0.08 + f * 0.3), y: SEA.top + (SEA.bottom - SEA.top) * f,
        r: 0.5 + f * 1.6, w: 1.5 + Math.random() * 4, ph: Math.random() * 6.28 });
    }
  }
  function drawLight(now) {
    var t = now / 1000, top = Math.max(0, wallY);
    if (glints.length && !reduced()) {
      ctx.globalCompositeOperation = "lighter";
      for (var i = 0; i < glints.length; i++) {
        var gl = glints[i], a = Math.max(0, Math.sin(t * gl.w + gl.ph));
        if (a < 0.6) continue;
        ctx.fillStyle = "rgba(255,248,226," + ((a - 0.6) * 1.8).toFixed(3) + ")";
        ctx.fillRect(gl.x - gl.r * 2, gl.y - gl.r * 0.4, gl.r * 4, Math.max(0.8, gl.r * 0.8));
      }
      ctx.globalCompositeOperation = "source-over";
    }
    if (!caustic) return;
    /* The ripples are drawn at a third of the resolution into their own small
       canvas and laid over the scene scaled up: soft light wants no detail, and a
       full-size pattern fill costs ten times the rest of the frame put together. */
    var q = 3, cw = Math.ceil(W / q), chh = Math.ceil((H - top) / q);
    if (!caustic.buf || caustic.buf.width !== cw || caustic.buf.height !== chh) {
      caustic.buf = document.createElement("canvas"); caustic.buf.width = cw; caustic.buf.height = chh;
      caustic.bctx = caustic.buf.getContext("2d"); caustic.pat = caustic.bctx.createPattern(caustic.cv, "repeat"); caustic.f = 0; caustic.still = false;
    }
    var bg = caustic.bctx;
    var still = reduced();
    if (still ? !caustic.still : caustic.f++ % 2 === 0) {
      caustic.still = still;
      var layers = reduced() ? [[0, 0, 1]] : [[t * 0.18, t * 0.07, 1], [-t * 0.11, t * 0.15, 0.8]];
      bg.setTransform(1, 0, 0, 1, 0, 0);
      bg.clearRect(0, 0, cw, chh);
      bg.globalCompositeOperation = "lighter";
      layers.forEach(function (L, li) {
        var x = -2 + L[0], z = -2 + L[1];
        var o = project(x, TABLE_Y, z), ax = project(x + 1, TABLE_Y, z), az = project(x, TABLE_Y, z + 1);
        bg.setTransform((ax.x - o.x) / q, (ax.y - o.y) / q, (az.x - o.x) / q, (az.y - o.y) / q, o.x / q, (o.y - top) / q);
        var k = 7 / caustic.n * (li ? 1.3 : 1);
        bg.transform(k, 0, 0, k, 0, 0);
        bg.globalAlpha = L[2];
        bg.fillStyle = caustic.pat;
        bg.fillRect(-caustic.n * 5, -caustic.n * 3, caustic.n * 10, caustic.n * 8);
      });
      bg.globalAlpha = 1;
    }
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = reduced() ? 0.035 : 0.042;
    ctx.drawImage(caustic.buf, 0, top, cw * q, chh * q);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  /* ================= dice ================= */
  var DS = 0.34;
  var FACES = [
    { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, 1], val: 1 }, { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, -1], val: 6 },
    { n: [1, 0, 0], u: [0, 0, 1], v: [0, 1, 0], val: 2 }, { n: [-1, 0, 0], u: [0, 0, -1], v: [0, 1, 0], val: 5 },
    { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0], val: 3 }, { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0], val: 4 }
  ];
  var PIPS = { 1: [[0, 0]], 2: [[-0.5, -0.5], [0.5, 0.5]], 3: [[-0.5, -0.5], [0, 0], [0.5, 0.5]],
    4: [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]], 5: [[-0.5, -0.5], [0.5, -0.5], [0, 0], [-0.5, 0.5], [0.5, 0.5]],
    6: [[-0.5, -0.55], [-0.5, 0], [-0.5, 0.55], [0.5, -0.55], [0.5, 0], [0.5, 0.55]] };
  function rotX(a) { var c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, c, -s, 0, s, c]; }
  function rotY(a) { var c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 1, 0, -s, 0, c]; }
  function rotZ(a) { var c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, s, c, 0, 0, 0, 1]; }
  function rotAxis(ax, a) {
    var c = Math.cos(a), s = Math.sin(a), t = 1 - c, x = ax[0], y = ax[1], z = ax[2];
    return [t * x * x + c, t * x * y - s * z, t * x * z + s * y, t * x * y + s * z, t * y * y + c, t * y * z - s * x, t * x * z - s * y, t * y * z + s * x, t * z * z + c];
  }
  function mul(a, b) {
    var o = new Array(9);
    for (var r = 0; r < 3; r++) for (var c = 0; c < 3; c++) o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
    return o;
  }
  function mv(m, v) { return [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]]; }
  var BASE_ROT = { 1: [1, 0, 0, 0, 1, 0, 0, 0, 1], 6: rotX(Math.PI), 2: rotZ(Math.PI / 2), 5: rotZ(-Math.PI / 2), 3: rotX(-Math.PI / 2), 4: rotX(Math.PI / 2) };
  var LIGHT = (function () { var l = [-0.45, 0.85, -0.3], n = Math.hypot(l[0], l[1], l[2]); return [l[0] / n, l[1] / n, l[2] / n]; })();

  function dieRest(side, i, n) {
    var cx = side === 0 ? 3.55 : -3.55, gap = 0.95;
    return { x: cx + (i - (n - 1) / 2) * gap * (n > 2 ? 1 : 1.15), z: (i % 2 ? 0.08 : -0.08) };
  }
  function cubeFace(c, f, Rm, size, label, fillBase) {
    var n = mv(Rm, f.n), u = mv(Rm, f.u), v = mv(Rm, f.v);
    var fc = [c[0] + n[0] * size, c[1] + n[1] * size, c[2] + n[2] * size];
    if ((CAM.x - fc[0]) * n[0] + (CAM.y - fc[1]) * n[1] + (CAM.z - fc[2]) * n[2] <= 0) return;
    var corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(function (q) {
      return project(fc[0] + (u[0] * q[0] + v[0] * q[1]) * size, fc[1] + (u[1] * q[0] + v[1] * q[1]) * size, fc[2] + (u[2] * q[0] + v[2] * q[1]) * size);
    });
    var shade = 0.6 + 0.45 * Math.max(0, n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]);
    var rr = 0.2;
    ctx.beginPath();
    for (var i = 0; i < 4; i++) {
      var a = corners[i], b = corners[(i + 1) % 4], c2 = corners[(i + 2) % 4];
      var p1 = { x: b.x + (a.x - b.x) * rr, y: b.y + (a.y - b.y) * rr }, p2 = { x: b.x + (c2.x - b.x) * rr, y: b.y + (c2.y - b.y) * rr };
      if (i === 0) ctx.moveTo(p1.x, p1.y); else ctx.lineTo(p1.x, p1.y);
      ctx.quadraticCurveTo(b.x, b.y, p2.x, p2.y);
    }
    ctx.closePath();
    ctx.fillStyle = rgbi(fillBase, shade); ctx.fill();
    ctx.strokeStyle = "rgba(60,40,20,0.35)"; ctx.lineWidth = 0.8; ctx.stroke();
    var proj = function (pu, pv, r) {
      var p = [fc[0] + (u[0] * pu + v[0] * pv) * size, fc[1] + (u[1] * pu + v[1] * pv) * size, fc[2] + (u[2] * pu + v[2] * pv) * size];
      var o = project(p[0], p[1], p[2]);
      var a = project(p[0] + u[0] * r, p[1] + u[1] * r, p[2] + u[2] * r);
      var b2 = project(p[0] + v[0] * r, p[1] + v[1] * r, p[2] + v[2] * r);
      return [o, a, b2];
    };
    if (typeof label === "number") {
      PIPS[label].forEach(function (pp) {
        var t = proj(pp[0] * 0.98, pp[1] * 0.98, size * 0.19);
        ctx.save();
        ctx.setTransform(dpr * (t[1].x - t[0].x), dpr * (t[1].y - t[0].y), dpr * (t[2].x - t[0].x), dpr * (t[2].y - t[0].y), dpr * t[0].x, dpr * t[0].y);
        ctx.beginPath(); ctx.arc(0, 0, 1, 0, Math.PI * 2);
        ctx.fillStyle = label === 1 ? "#a32a1c" : "#2b1b12"; ctx.fill();
        ctx.beginPath(); ctx.arc(-0.18, -0.22, 0.45, 0, Math.PI * 2); ctx.fillStyle = "rgba(255,255,255,0.12)"; ctx.fill();
        ctx.restore();
      });
    } else if (label) {
      var t2 = proj(0, 0, size * 0.62);
      ctx.save();
      ctx.setTransform(dpr * (t2[1].x - t2[0].x), dpr * (t2[1].y - t2[0].y), dpr * (t2[2].x - t2[0].x), dpr * (t2[2].y - t2[0].y), dpr * t2[0].x, dpr * t2[0].y);
      ctx.font = "700 " + (label.length > 1 ? 0.95 : 1.25) + "px Fraunces, Georgia, serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillStyle = "#f3d48e"; ctx.fillText(label, 0, 0.06);
      ctx.restore();
    }
  }
  function drawDie(d) {
    var c = [d.x, d.y + DS, d.z];
    var base = project(d.x, d.surf, d.z), lift = Math.max(0, d.y - d.surf);
    var sh = project(d.x + 0.12 + lift * 0.35, d.surf, d.z + 0.1 + lift * 0.25);
    ctx.globalAlpha = (d.used ? 0.42 : 1) * Math.max(0.3, 1 - lift * 0.4);
    ctx.fillStyle = "rgba(20,8,0,0.38)";
    ctx.beginPath(); ctx.ellipse(sh.x, sh.y, sh.s * DS * 1.35, sh.s * DS * 1.35 * SIN, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = d.used ? 0.42 : 1;
    var faces = FACES.slice().sort(function (a, b) {
      var na = mv(d.R, a.n), nb = mv(d.R, b.n);
      return (na[2] * COS + na[1] * SIN) - (nb[2] * COS + nb[1] * SIN);
    });
    for (var i = 0; i < faces.length; i++) cubeFace(c, faces[i], d.R, DS, faces[i].val, [248, 240, 222]);
    ctx.globalAlpha = 1;
    void base;
  }

  /* Throw: the dice leave the cup (or come in over the edge), hit the wood two or
     three times, and settle showing their numbers. The tumble is the final
     orientation unwound backwards in time, so it always lands exactly right. */
  function throwDice(side, values, onDone) {
    var cup = side === 0 ? props.cup0 : props.cup1;
    var from = cup ? { x: cup.x, y: TABLE_Y + 1.2, z: cup.z } : side === 0 ? { x: 5.5, y: 2.2, z: 8.5 } : { x: -5.5, y: 2.2, z: -8.5 };
    dice = dice.filter(function (d) { return d.side !== side; });
    var n = values.length, landed = 0;
    values.forEach(function (v, i) {
      var to = dieRest(side, i, n);
      var yaw = (Math.random() - 0.5) * 0.7;
      var Rf = mul(rotY(yaw), BASE_ROT[v]);
      var ax = [Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5], al = Math.hypot(ax[0], ax[1], ax[2]) || 1;
      ax = [ax[0] / al, ax[1] / al, ax[2] / al];
      var d = { side: side, v: v, used: false, x: from.x, y: from.y, z: from.z, surf: 0, R: Rf,
        anim: { t: 0, dur: reduced() ? 1 : 820 + i * 90 + Math.random() * 120, from: from, to: to, Rf: Rf, ax: ax,
          spin: (5 + Math.random() * 4) * (Math.random() < 0.5 ? -1 : 1), hits: [0.5, 0.78, 0.92], hit: 0, pan: panOf(to.x),
          done: function () { if (++landed === n && onDone) onDone(); } } };
      d.x = from.x; d.y = from.y; d.z = from.z;
      dice.push(d);
    });
  }
  function stepDie(d, dt) {
    var a = d.anim; a.t += dt / a.dur;
    var t = Math.min(1, a.t);
    /* horizontal: fast out of the cup, slowing as it skids */
    var h = 1 - Math.pow(1 - t, 2.2);
    d.x = a.from.x + (a.to.x - a.from.x) * h;
    d.z = a.from.z + (a.to.z - a.from.z) * h;
    /* vertical: a fall, then two shrinking bounces */
    var y;
    if (t < 0.5) { var u = t / 0.5; y = a.from.y * (1 - u * u); }
    else if (t < 0.78) { var u2 = (t - 0.5) / 0.28; y = 0.55 * 4 * u2 * (1 - u2); }
    else if (t < 0.92) { var u3 = (t - 0.78) / 0.14; y = 0.16 * 4 * u3 * (1 - u3); }
    else y = 0;
    d.surf = 0;
    d.y = Math.max(0, y);
    var spinLeft = Math.pow(1 - t, 2.4) * a.spin;
    d.R = mul(rotAxis(a.ax, spinLeft), a.Rf);
    while (a.hit < a.hits.length && t >= a.hits[a.hit]) {
      A.dieHit([0.95, 0.55, 0.28][a.hit], a.pan);
      a.hit++;
    }
    if (a.t >= 1) {
      d.x = a.to.x; d.z = a.to.z; d.y = 0; d.R = a.Rf;
      var done = a.done; d.anim = null; if (done) done();
    }
  }
  function useDie(side, v) {
    for (var i = 0; i < dice.length; i++) if (dice[i].side === side && dice[i].v === v && !dice[i].used) { dice[i].used = true; return; }
  }
  /* Doubles: two more dice slide out beside the pair, so all four moves are on the table. */
  function splitDoubles(side, v) {
    var have = dice.filter(function (d) { return d.side === side; });
    if (have.length !== 2) return;
    have.forEach(function (d, i) { var r = dieRest(side, i === 0 ? 1 : 2, 4); slideDie(d, r); });
    [0, 3].forEach(function (i) {
      var r = dieRest(side, i, 4), src = have[i ? 1 : 0];
      var d = { side: side, v: v, used: false, x: src.x, y: 0, z: src.z, surf: 0, R: mul(rotY((Math.random() - 0.5) * 0.6), BASE_ROT[v]), anim: null };
      dice.push(d);
      slideDie(d, r);
    });
  }
  function slideDie(d, to) {
    var from = { x: d.x, z: d.z }, t = 0, dur = reduced() ? 1 : 260;
    d.slide = function (dt) {
      t += dt / dur; var e = ease(Math.min(1, t));
      d.x = from.x + (to.x - from.x) * e; d.z = from.z + (to.z - from.z) * e;
      if (t >= 1) d.slide = null;
    };
  }

  /* ---------- the doubling cube ---------- */
  function cubeSpot(owner) { return { x: TRAY_X, z: owner === 0 ? 1.2 : owner === 1 ? -1.2 : 0 }; }
  function cubeLabel(v) { return String(v === 1 ? 64 : v); }
  function drawCube(now) {
    if (!cubeOn) return;
    var sp = cubeSpot(cube.owner), x = sp.x, z = sp.z, Rm = [1, 0, 0, 0, 1, 0, 0, 0, 1], top = cubeLabel(cube.v), front = String(cube.v === 1 ? 2 : Math.min(64, cube.v * 2));
    if (cubeAnim) {
      var e = ease(Math.min(1, cubeAnim.t));
      x = cubeAnim.from.x + (cubeAnim.to.x - cubeAnim.from.x) * e;
      z = cubeAnim.from.z + (cubeAnim.to.z - cubeAnim.from.z) * e;
      Rm = rotX(-Math.PI / 2 * e);
      top = cubeAnim.top; front = cubeAnim.front;
    }
    var size = 0.32, y = FRAME_Y + (cubeAnim ? Math.sin(Math.PI * Math.min(1, cubeAnim.t)) * 0.5 : 0);
    var sh = project(x + 0.12, FRAME_Y, z + 0.1);
    ctx.fillStyle = "rgba(10,4,0,0.4)"; ctx.beginPath(); ctx.ellipse(sh.x, sh.y, sh.s * size * 1.4, sh.s * size * 1.4 * SIN, 0, 0, Math.PI * 2); ctx.fill();
    var labels = { 1: top, 6: "", 2: "16", 5: "32", 3: front, 4: "8" };
    var faces = FACES.slice().sort(function (a, b) {
      var na = mv(Rm, a.n), nb = mv(Rm, b.n);
      return (na[2] * COS + na[1] * SIN) - (nb[2] * COS + nb[1] * SIN);
    });
    for (var i = 0; i < faces.length; i++) cubeFace([x, y + size, z], faces[i], Rm, size, labels[faces[i].val], [96, 56, 30]);
    void now;
  }

  /* ================= per-frame drawing ================= */
  function draw(now) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (sceneCv) ctx.drawImage(sceneCv, 0, 0, sceneCv.width, sceneCv.height, 0, 0, W, H);
    drawLight(now);
    drawMarks(now);
    drawCheckers(now);
    drawGhosts(now);
    drawCube(now);
    dice.forEach(drawDie);
    drawCup(props.cup0, cupShake[0], now);
    drawCup(props.cup1, cupShake[1], now);
    drawArrows(now);
    drawParticles();
    if (drag && drag.moved) {
      drawShadow(drag.x, 0.5, drag.z, 0, 0.7);
      drawChecker(0, drag.x, 0.5, drag.z, "rgba(255,226,150,0.8)");
    }
  }

  function triPath(p) { polyPath(ctx, triangle(p)); }
  /* A lit point: lamplight gold, strongest at its base, with a glowing edge. It
     has to read at a glance on both the ebony and the bone points. */
  function glowTriangle(p, a) {
    var tri = triangle(p);
    ctx.save();
    polyPath(ctx, tri);
    var lg = ctx.createLinearGradient(tri[0].x, tri[0].y, tri[2].x, tri[2].y);
    lg.addColorStop(0, "rgba(255,196,84," + (0.62 * a).toFixed(3) + ")"); lg.addColorStop(1, "rgba(255,214,120," + (0.22 * a).toFixed(3) + ")");
    ctx.fillStyle = lg; ctx.fill();
    ctx.shadowColor = "rgba(255,190,80,0.9)"; ctx.shadowBlur = 10;
    ctx.strokeStyle = "rgba(255,236,170," + (0.75 + 0.25 * a).toFixed(3) + ")"; ctx.lineWidth = 2.6; ctx.lineJoin = "round"; ctx.stroke();
    ctx.restore();
  }
  function glowTray(side, a) {
    var q = side === 0 ? quadW(TRAY0 + 0.05, 0.15, TRAY1 - 0.05, ZF - 0.05, TRAY_Y) : quadW(TRAY0 + 0.05, -ZF + 0.05, TRAY1 - 0.05, -0.15, TRAY_Y);
    ctx.save();
    polyPath(ctx, q);
    ctx.fillStyle = "rgba(255,200,96," + (0.45 * a).toFixed(3) + ")"; ctx.fill();
    ctx.shadowColor = "rgba(255,190,80,0.9)"; ctx.shadowBlur = 10;
    ctx.strokeStyle = "rgba(255,236,170," + (0.75 + 0.25 * a).toFixed(3) + ")"; ctx.lineWidth = 2.6; ctx.stroke();
    ctx.restore();
  }
  function ring(x, y, z, rad, color, width) {
    var p = project(x, y, z);
    ctx.strokeStyle = color; ctx.lineWidth = width;
    ctx.beginPath(); ctx.ellipse(p.x, p.y, p.s * rad, p.s * rad * SIN, 0, 0, Math.PI * 2); ctx.stroke();
  }
  function topOf(side, own) {
    var n = board[side][own];
    return slotWorld(side, own, Math.max(0, n - 1));
  }

  var ghosts = [];
  function drawGhosts(now) {
    if (sel < 0 || phase !== "moving" || busy()) return;
    var a = 0.42 + 0.12 * Math.sin(now / 1000 * 4.2);
    ghosts.forEach(function (w) {
      drawChecker(0, w.x, w.y, w.z, null, a);
      ring(w.x, w.y + CH + 0.01, w.z, 0.47, "rgba(255,236,170,0.95)", 2);
    });
  }
  function drawMarks(now) {
    var t = now / 1000, pulse = 0.75 + 0.25 * Math.sin(t * 4.2);
    if (phase === "moving" && who === 0 && !busy()) {
      if (sel < 0 && !drag) {
        /* every checker that can move wears a faint ring */
        sources().forEach(function (own) {
          var w0 = topOf(0, own);
          ring(w0.x, w0.y + CH + 0.01, w0.z, 0.5, "rgba(255,226,150," + (0.28 + 0.2 * Math.sin(t * 3)).toFixed(3) + ")", 1.6);
        });
      }
      if (sel >= 0 && !(drag && drag.moved)) {
        /* the picked-up checker stands in a pool of light */
        var sw = topOf(0, sel), sp = project(sw.x, sw.y, sw.z);
        ctx.save();
        ctx.translate(sp.x, sp.y); ctx.scale(1, SIN);
        var pg = ctx.createRadialGradient(0, 0, sp.s * 0.2, 0, 0, sp.s * 0.85);
        pg.addColorStop(0, "rgba(255,206,100,0.85)"); pg.addColorStop(0.55, "rgba(255,200,90,0.45)"); pg.addColorStop(1, "rgba(255,200,90,0)");
        ctx.fillStyle = pg; ctx.beginPath(); ctx.arc(0, 0, sp.s * 0.85, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
      if (sel >= 0) {
        ghosts = [];
        dests.forEach(function (d) {
          if (d.to === 0) glowTray(0, pulse);
          else glowTriangle(d.to, pulse);
          /* where it would land: a ghost of the checker */
          var k = d.to === 0 ? board[0][0] : board[0][d.to];
          var w = slotWorld(0, d.to, k);
          ghosts.push(w);
        });
      }
    }
    if (cursor) drawCursor();
  }

  function drawCursor() {
    var c = cursor;
    ctx.save(); ctx.setLineDash([5, 4]); ctx.strokeStyle = "rgba(255,240,200,0.95)"; ctx.lineWidth = 2;
    if (c.own === 0) {
      polyPath(ctx, c.top ? quadW(TRAY0, -ZF, TRAY1, -0.1, TRAY_Y) : quadW(TRAY0, 0.1, TRAY1, ZF, TRAY_Y)); ctx.stroke();
    } else if (c.own === 25) {
      polyPath(ctx, c.top ? quadW(-BAR, -ZF, BAR, -0.1, FRAME_Y) : quadW(-BAR, 0.1, BAR, ZF, FRAME_Y)); ctx.stroke();
    } else {
      var x = pointX(c.own), top = c.own >= 13;
      polyPath(ctx, top ? quadW(x - 0.5, -ZF, x + 0.5, -0.05, 0) : quadW(x - 0.5, 0.05, x + 0.5, ZF, 0)); ctx.stroke();
    }
    ctx.restore();
  }

  /* Arrows: the hint (gold, marching) and what the regular just did (faint). */
  function drawArrows(now) {
    var list = [];
    if (hint) list.push({ steps: hint, color: "255,226,150", alpha: 0.95, march: true });
    else if (lastMove && phase !== "ai") list.push({ steps: lastMove, color: "255,250,240", alpha: 0.45, march: false });
    list.forEach(function (L) {
      L.steps.forEach(function (st) {
        var a = project(st.a.x, 0.25, st.a.z), b = project(st.b.x, 0.25, st.b.z);
        var mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2 - Math.min(60, Math.hypot(b.x - a.x, b.y - a.y) * 0.22);
        ctx.save();
        ctx.strokeStyle = "rgba(" + L.color + "," + L.alpha + ")"; ctx.lineWidth = Math.max(2, a.s * 0.07); ctx.lineCap = "round";
        if (L.march) { ctx.setLineDash([a.s * 0.18, a.s * 0.14]); ctx.lineDashOffset = -now / 1000 * 30; }
        else ctx.setLineDash([a.s * 0.08, a.s * 0.1]);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo(mx, my, b.x, b.y); ctx.stroke();
        ctx.setLineDash([]);
        var ang = Math.atan2(b.y - my, b.x - mx), hs = Math.max(6, a.s * 0.26);
        ctx.fillStyle = "rgba(" + L.color + "," + L.alpha + ")";
        ctx.beginPath(); ctx.moveTo(b.x, b.y);
        ctx.lineTo(b.x - Math.cos(ang - 0.45) * hs, b.y - Math.sin(ang - 0.45) * hs);
        ctx.lineTo(b.x - Math.cos(ang + 0.45) * hs, b.y - Math.sin(ang + 0.45) * hs);
        ctx.closePath(); ctx.fill();
        ctx.restore();
      });
    });
  }

  function drawCheckers(now) {
    var items = [], hidden = {};
    flyers.forEach(function (f) { var k = f.side + ":" + f.own; hidden[k] = (hidden[k] || 0) + 1; });
    if (drag && drag.moved) { var dk = "0:" + drag.own; hidden[dk] = (hidden[dk] || 0) + 1; }
    for (var side = 0; side < 2; side++) {
      for (var own = 0; own <= 25; own++) {
        var n = board[side][own] - (hidden[side + ":" + own] || 0);
        if (n <= 0) continue;
        var cap = own === 0 ? 15 : own === 25 ? CAP_BAR : CAP_PT;
        var shown = Math.min(n, cap);
        for (var k = 0; k < shown; k++) {
          var w = slotWorld(side, own, k);
          var it = { side: side, x: w.x, y: w.y, z: w.z, base: w.y, own: own, k: k, count: (k === shown - 1 && n > cap) ? n : 0 };
          if (side === 0 && own === sel && k === shown - 1 && phase === "moving" && !(drag && drag.moved)) { it.y += 0.42 + 0.06 * Math.sin(now / 200); it.glow = "rgba(255,214,110,1)"; it.picked = true; }
          items.push(it);
        }
      }
    }
    flyers.forEach(function (f) {
      items.push({ side: f.side, x: f.x, y: f.y, z: f.z, base: f.base, fly: true });
    });
    items.sort(function (a, b) { return (a.fly ? 1 : 0) - (b.fly ? 1 : 0) || a.z - b.z || a.y - b.y; });
    items.forEach(function (it) { if (it.own !== 0 || it.k < 1) drawShadow(it.x, it.y, it.z, it.base, it.own === 0 ? 0.6 : 1); });
    items.forEach(function (it) {
      drawChecker(it.side, it.x, it.y, it.z, it.glow);
      if (it.count) drawCount(it.side, it.x, it.y, it.z, it.count);
      if (it.picked) {
        var fp = project(it.x, it.y + CH, it.z);
        ctx.save();
        ctx.shadowColor = "rgba(255,190,70,1)"; ctx.shadowBlur = 12;
        ctx.strokeStyle = "rgba(255,226,140,1)"; ctx.lineWidth = Math.max(2.5, fp.s * 0.07);
        ctx.beginPath(); ctx.ellipse(fp.x, fp.y, fp.s * R * 1.08, fp.s * R * 1.08 * SIN, 0, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      }
    });
  }

  function burst(x, z, y, kind) {
    var p = project(x, y || 0, z), n = kind === "big" ? 26 : 10;
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2, sp = (kind === "big" ? 1.2 : 0.6) + Math.random() * 2;
      particles.push({ x: p.x, y: p.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * SIN - (kind === "big" ? 1.6 : 0.6),
        r: kind === "big" ? 1.2 + Math.random() * 2 : 0.7 + Math.random() * 1.2, life: 1,
        c: kind === "big" ? "rgba(255,220,140,A)" : "rgba(236,214,170,A)" });
    }
  }
  function drawParticles() {
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      ctx.fillStyle = p.c.replace("A", String(Math.max(0, p.life).toFixed(3)));
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
    }
  }

  /* ================= motion ================= */
  var lastT = performance.now();
  function tick(now) {
    var dt = Math.min(48, now - lastT); lastT = now;
    for (var i = flyers.length - 1; i >= 0; i--) {
      var f = flyers[i];
      if (f.delay > 0) { f.delay -= dt; f.x = f.a.x; f.y = f.a.y; f.z = f.a.z; continue; }
      if (!f.started) { f.started = true; if (f.start) f.start(); }
      f.t += dt / f.dur;
      var u = Math.min(1, f.t), e = ease(u);
      f.x = f.a.x + (f.b.x - f.a.x) * e; f.z = f.a.z + (f.b.z - f.a.z) * e;
      f.y = f.a.y + (f.b.y - f.a.y) * e + Math.sin(Math.PI * u) * f.arc;
      if (f.t >= 1) { flyers.splice(i, 1); if (f.land) f.land(); }
    }
    dice.forEach(function (d) { if (d.anim) stepDie(d, dt); if (d.slide) d.slide(dt); });
    for (var s = 0; s < 2; s++) if (cupShake[s] > 0 && cupShake[s] < 1) cupShake[s] = Math.max(0, cupShake[s] - dt / 260);
    if ((phase === "preroll" || phase === "opening") && btnRoll.disabled && who === 0 && !busy()) updateBar();
    if (cubeAnim) {
      cubeAnim.t += dt / cubeAnim.dur;
      if (cubeAnim.t >= 1) { var cd = cubeAnim.done; cubeAnim = null; if (cd) cd(); }
    }
    for (var j = particles.length - 1; j >= 0; j--) {
      var p = particles[j];
      p.x += p.vx; p.y += p.vy; p.vy += 0.07; p.life -= dt / 900;
      if (p.life <= 0) particles.splice(j, 1);
    }
    draw(now);
    requestAnimationFrame(tick);
  }

  /* ================= moving checkers ================= */
  /* Apply a step to the board and animate it. Returns the duration. */
  function animateStep(side, st, delay, onLand) {
    var me = board[side], them = board[1 - side];
    /* never apply a step the board no longer allows: it would corrupt the counts */
    if (!me[st.from] || (st.to > 0 && them[25 - st.to] >= 2) || (st.to > 0 && !!st.hit !== (them[25 - st.to] === 1))) {
      console.error("backgammon: stale step ignored", JSON.stringify(st));
      return 0;
    }
    var a = topOf(side, st.from);
    var victim = st.hit ? topOf(1 - side, 25 - st.to) : null;
    K.apply(me, them, st);
    var b = slotWorld(side, st.to, board[side][st.to] - 1);
    var dist = Math.hypot(b.x - a.x, b.z - a.z);
    var dur = reduced() ? 1 : clamp(240 + dist * 34, 260, 620);
    var landsOn = st.to !== 0 && board[side][st.to] > 1;
    flyers.push({ side: side, own: st.to, a: { x: a.x, y: a.y, z: a.z }, b: b, x: a.x, y: a.y, z: a.z, base: b.y, t: 0, delay: delay || 0,
      dur: dur, arc: 0.22 + Math.min(0.5, dist * 0.04),
      start: function () { A.slide(dur / 1000 * 0.8, panOf(a.x)); },
      land: function () {
        if (st.to === 0) { A.tray(1, panOf(b.x)); burst(b.x, b.z, 0, "chip"); }
        else if (st.hit) { A.hit(panOf(b.x)); burst(b.x, b.z, 0.1, "chip"); }
        else if (landsOn) { A.clack(1, panOf(b.x)); A.place(0.55, panOf(b.x)); }
        else A.place(1, panOf(b.x));
        if (onLand) onLand();
      } });
    if (st.hit) {
      var bb = slotWorld(1 - side, 25, board[1 - side][25] - 1);
      flyers.push({ side: 1 - side, own: 25, a: victim, b: bb, x: victim.x, y: victim.y, z: victim.z, base: bb.y, t: 0,
        delay: (delay || 0) + dur, dur: reduced() ? 1 : 520, arc: 1.1,
        land: function () { A.place(0.7, panOf(bb.x)); } });
    }
    updatePips();
    return dur + (st.hit ? 520 : 0);
  }

  /* ================= rules glue for the player ================= */
  /* drawn every frame, so cached on the position and the dice left */
  var vKey = "", vList = [];
  function playerValid() {
    if (!turn || turn.need <= 0) return [];
    var key = String.fromCharCode.apply(null, board[0]) + String.fromCharCode.apply(null, board[1]) + turn.left.join("") + turn.need;
    if (key !== vKey) { vKey = key; vList = K.validSteps(board[0], board[1], turn.left, turn.need, turn.only); }
    return vList;
  }
  function sources() {
    var seen = {}, out = [];
    playerValid().forEach(function (s) { if (!seen[s.from]) { seen[s.from] = 1; out.push(s.from); } });
    return out;
  }
  /* Where the checker on `from` can go this turn: single steps, and the same
     checker carried on with more dice. Each destination keeps one chain of steps;
     a chain that hits on the way beats one that does not, and fewer steps win. */
  function destinationsFrom(from) {
    var out = {}, me = Int8Array.from(board[0]), them = Int8Array.from(board[1]);
    (function walk(at, left, need, chain, hits) {
      if (need <= 0) return;
      var vs = K.validSteps(me, them, left, need, turn.only).filter(function (s) { return s.from === at; });
      /* bearing off: prefer the smaller die when two would do */
      vs.sort(function (a, b) { return a.die - b.die; });
      vs.forEach(function (s) {
        var c = chain.concat([s]), h = hits + (s.hit ? 1 : 0);
        var cur = out[s.to];
        if (!cur || c.length < cur.chain.length || (c.length === cur.chain.length && h > cur.hits)) out[s.to] = { to: s.to, chain: c, hits: h };
        if (s.to === 0) return;
        K.apply(me, them, s);
        var i = left.indexOf(s.die);
        walk(s.to, left.slice(0, i).concat(left.slice(i + 1)), need - 1, c, h);
        K.undo(me, them, s);
      });
    })(from, turn.left.slice(), turn.need, [], 0);
    return Object.keys(out).map(function (k) { return out[k]; });
  }

  function select(own) {
    var ds = destinationsFrom(own);
    if (!ds.length) return false;
    sel = own; dests = ds; hint = null;
    A.select(panOf(topOf(0, own).x));
    return true;
  }
  function deselect() { sel = -1; dests = []; }

  /* Why a checker will not move, in plain words. */
  function explainNo(own) {
    if (board[0][25] > 0 && own !== 25) return "Come in from the bar first";
    if (own < 1 || own > 25 || !board[0][own]) return null;
    var any = false;
    turn.left.forEach(function (d) { if (K.steps(board[0], board[1], d, []).some(function (s) { return s.from === own; })) any = true; });
    if (any) return turn.only ? "Only the " + turn.only + " can be played" : "Both dice have to be played";
    return "That one is blocked";
  }

  /* ================= input ================= */
  function local(ev) { var r = canvas.getBoundingClientRect(); return { x: ev.clientX - r.left, y: ev.clientY - r.top }; }
  /* The slot under a world position: points are their whole half-column, the bar
     and tray their whole strip, so a target is always bigger than its artwork. */
  function slotAt(x, z) {
    if (Math.abs(z) > ZE + 0.9) return -1;
    if (x >= TRAY0 - 0.3 && x <= EDGE_R + 0.9) return 0;
    if (Math.abs(x) <= BAR) return 25;
    if (x < EDGE_L - 0.9 || x > TRAY0) return -1;
    var top = z < 0;
    if (x > 0) return top ? clamp(Math.round(x + 17.95), 19, 24) : clamp(Math.round(7.05 - x), 1, 6);
    return top ? clamp(Math.round(x + 19.05), 13, 18) : clamp(Math.round(5.95 - x), 7, 12);
  }
  function slotCenterX(own) { return own === 0 ? TRAY_X : own === 25 ? 0 : pointX(own); }
  function sameRow(own, z) { return own === 0 || own === 25 || (own >= 13) === (z < 0); }
  /* Forgiving: a near miss snaps to the nearest slot that makes sense. */
  function nearest(list, x, z, maxDx) {
    var best = -1, bd = maxDx;
    list.forEach(function (own) {
      if (!sameRow(own, z)) return;
      var dx = Math.abs(slotCenterX(own) - x);
      if (dx < bd) { bd = dx; best = own; }
    });
    return best;
  }

  function tapAt(x, z) {
    if ((phase === "preroll" || phase === "opening") && who === 0) {
      /* the right half's middle (where your dice land) or your cup rolls */
      var cup = props.cup0;
      if ((x > BAR && x < FIELD && Math.abs(z) < 1.3) || (cup && Math.hypot(x - cup.x, z - cup.z) < 1.1)) roll();
      return;
    }
    if (phase !== "moving" || who !== 0 || busy()) return;
    var own = slotAt(x, z);
    if (sel >= 0) {
      var tos = dests.map(function (d) { return d.to; });
      var to = tos.indexOf(own) >= 0 ? own : nearest(tos, x, z, 1.15);
      if (to >= 0 && to !== sel) { commit(to); return; }
    }
    var src = sources();
    var pick = src.indexOf(own) >= 0 ? own : nearest(src, x, z, 0.75);
    if (pick >= 0) {
      if (pick === sel) { deselect(); return; }
      select(pick);
      return;
    }
    if (own >= 0 && own !== 0 && board[0][own] && own !== sel) {
      var why = explainNo(own);
      deny(why);
    }
    deselect();
  }

  function commit(to) {
    var d = null;
    for (var i = 0; i < dests.length; i++) if (dests[i].to === to) d = dests[i];
    if (!d) return;
    deselect(); hint = null; lastMove = null;
    playChain(d.chain);
  }

  function deny(msg) {
    A.deny();
    if (msg) note(msg, 1800);
  }

  canvas.addEventListener("pointerdown", function (ev) {
    A.init();
    if (cursor) cursor = null;
    closeMenu();
    var p = local(ev), w = unproject(p.x, p.y, 0);
    if (phase === "moving" && who === 0 && !busy()) {
      var own = slotAt(w.x, w.z), src = sources();
      var pick = src.indexOf(own) >= 0 ? own : (sel >= 0 ? -1 : nearest(src, w.x, w.z, 0.75));
      if (pick >= 0 && !(sel >= 0 && dests.some(function (d) { return d.to === own; }))) {
        /* read this BEFORE selecting: a second press on a selected checker puts it down */
        var wasSel = pick === sel;
        if (!wasSel && !select(pick)) return;
        drag = { own: pick, x0: p.x, y0: p.y, moved: false, id: ev.pointerId, wasSel: wasSel, x: w.x, z: w.z };
        try { canvas.setPointerCapture(ev.pointerId); } catch (e) {}
        return;
      }
    }
    tapAt(w.x, w.z);
  });
  canvas.addEventListener("pointermove", function (ev) {
    if (!drag || ev.pointerId !== drag.id) return;
    var p = local(ev);
    if (!drag.moved && Math.hypot(p.x - drag.x0, p.y - drag.y0) < 8) return;
    drag.moved = true;
    var w = unproject(p.x, p.y, 0.5);
    drag.x = clamp(w.x, EDGE_L - 0.5, EDGE_R + 0.5); drag.z = clamp(w.z, -ZE - 0.5, ZE + 0.5);
  });
  function endDrag(ev) {
    if (!drag || ev.pointerId !== drag.id) return;
    var d = drag; drag = null;
    if (!d.moved) { if (d.wasSel) deselect(); return; }
    var p = local(ev), w = unproject(p.x, p.y, 0);
    var own = slotAt(w.x, w.z), tos = dests.map(function (q) { return q.to; });
    var to = tos.indexOf(own) >= 0 ? own : nearest(tos, w.x, w.z, 1.15);
    if (to >= 0) { commit(to); return; }
    /* not a legal point: it goes back where it was */
    var home = topOf(0, d.own);
    flyers.push({ side: 0, own: d.own, a: { x: d.x, y: 0.5, z: d.z }, b: home, x: d.x, y: 0.5, z: d.z, base: home.y, t: 0, delay: 0,
      dur: reduced() ? 1 : 200, arc: 0, land: function () { A.place(0.5, panOf(home.x)); } });
    if (own >= 1 && own !== d.own) deny(null);
  }
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);

  /* ================= the player's turn ================= */
  function playChain(chain, after) {
    var i = 0;
    lock++;
    (function next() {
      if (i >= chain.length) { lock--; afterPlayerStep(); if (after) after(); return; }
      var st = chain[i++];
      takeStep(st);
      var dur = animateStep(0, st, 0, null);
      later(dur + 40, next);
    })();
  }
  function takeStep(st) {
    var i = turn.left.indexOf(st.die);
    turn.left.splice(i, 1);
    turn.need--;
    turn.steps.push(st);
    useDie(0, st.die);
  }
  function afterPlayerStep() {
    if (board[0][0] === 15) { endTurn(); return; }
    if (turn.need <= 0) { later(260, endTurn); return; }
    /* the rest is forced: play it */
    var rest = K.plays(board[0], board[1], 0, 0, { dice: turn.left, max: turn.need, only: turn.only });
    if (rest.length === 1) {
      note(rest[0].steps.length === 1 ? "The last one is forced" : "The rest is forced", 1400);
      lock++;
      later(420, function () { lock--; playChain(rest[0].steps); });
      return;
    }
    if (board[0][25] > 0) select(25);
  }

  function beginPlayerMove(d1, d2) {
    var r = K.rule(board[0], board[1], d1, d2);
    turn = { d1: d1, d2: d2, left: r.dice.slice(), need: r.max, only: r.only, steps: [] };
    phase = "moving"; who = 0; hint = null;
    updateBar();
    if (r.max === 0) {
      note(board[0][25] ? "You can't come in. No move." : "No legal move", 1800);
      dice.forEach(function (d) { if (d.side === 0) d.used = true; });
      A.deny();
      later(1500, endTurn);
      return;
    }
    if (d1 === d2) splitDoubles(0, d1);
    if (r.max < r.dice.length) {
      dice.forEach(function (d) { if (d.side === 0 && r.only && d.v !== r.only) d.used = true; });
      if (d1 !== d2) note("Only the " + r.only + " can be played", 2200);
      else note("Only " + r.max + " of your " + d1 + "s can be played", 2200);
    }
    var ps = K.plays(board[0], board[1], d1, d2);
    if (ps.length === 1) {
      note(r.max < r.dice.length ? "Only one way to play it: forced" : "Forced move", 1600);
      lock++;
      later(650, function () { lock--; playChain(ps[0].steps); });
      return;
    }
    if (board[0][25] > 0) select(25);
  }

  function roll() {
    if (who !== 0 || (phase !== "preroll" && phase !== "opening") || busy()) return;
    A.init();
    hint = null; lastMove = null; closeMenu();
    var opening = phase === "opening";
    phase = "rolling"; updateBar(); clearNote();
    elHintLine.classList.add("is-gone");
    dice = [];
    if (opening) { openingRoll(); return; }
    var d1 = K.die(), d2 = K.die();
    shakeThenThrow(0, [d1, d2], function () { later(160, function () { beginPlayerMove(d1, d2); }); });
  }

  function shakeThenThrow(side, values, done) {
    var cup = side === 0 ? props.cup0 : props.cup1;
    var ms = reduced() ? 0 : cup ? 520 : 300;
    if (cup) cupShake[side] = 1;
    A.shake(ms / 1000 || 0.25, side === 0 ? 0.4 : -0.4);
    later(ms, function () { cupShake[side] = 0.99; throwDice(side, values, done); });
  }

  /* ================= the regular's turn ================= */
  /* The regulars think in a Worker. If one cannot start (an odd browser, a saved
     copy opened from disk), the same engine runs on the page instead, so a game can
     never stall waiting for a reply that will not come. */
  var inflight = {};
  function ensureWorker() {
    if (worker || workerBroken) return;
    try {
      worker = new Worker("engine.js?v=1");
      worker.onmessage = function (e) {
        var d = e.data, job = inflight[d.id];
        delete inflight[d.id];
        if (job) job.cb(d);
      };
      worker.onerror = function () {
        workerBroken = true; worker = null;
        Object.keys(inflight).forEach(function (id) { var job = inflight[id]; delete inflight[id]; runLocal(job.msg, job.cb); });
      };
    } catch (e) { workerBroken = true; worker = null; }
  }
  function runLocal(msg, cb) {
    function go() {
      var E = window.BGEngine, res = { id: msg.id, type: msg.type };
      var me = Int8Array.from(msg.me), them = Int8Array.from(msg.them);
      try {
        if (msg.type === "play" || msg.type === "hint") {
          var c = E.choose(msg.type === "hint" ? "noor" : msg.who, me, them, msg.d1, msg.d2, msg.match, null, msg.rest || null);
          res.steps = c.play.steps;
        } else if (msg.type === "double") res.r = E.shouldDouble(msg.who, me, them, msg.match);
        else if (msg.type === "take") res.r = E.shouldTake(msg.who, me, them, msg.match);
      } catch (err) { res.error = String(err); }
      cb(res);
    }
    if (window.BGEngine) { setTimeout(go, 20); return; }
    var sc = document.createElement("script");
    sc.src = "engine.js?v=1"; sc.onload = go;
    document.head.appendChild(sc);
  }
  function ask(msg, cb) {
    ensureWorker();
    msg.id = ++reqId;
    var tok = matchToken;
    var done = function (d) { if (tok === matchToken) cb(d); };
    if (!worker) { runLocal(msg, done); return; }
    inflight[msg.id] = { msg: msg, cb: done };
    worker.postMessage(msg);
  }
  function matchInfo(side) {
    var away = [MATCH_TO - score[0], MATCH_TO - score[1]];
    return { myAway: away[side], theirAway: away[1 - side], cube: cube.v, owner: cube.owner < 0 ? null : (cube.owner === side ? "me" : "them"),
      postCrawford: crawfordDone && !crawfordGame };
  }
  function canDouble(side) {
    return cubeOn && !crawfordGame && (cube.owner < 0 || cube.owner === side) && cube.v < 64 && score[0] < MATCH_TO && score[1] < MATCH_TO;
  }

  function aiTurn() {
    who = 1; phase = "ai"; turn = null; deselect(); hint = null; clearNote();
    updateBar();
    if (canDouble(1)) {
      thinking(true);
      var t0 = performance.now();
      ask({ type: "double", who: foe.id, me: Array.from(board[1]), them: Array.from(board[0]), match: matchInfo(1) }, function (d) {
        thinking(false);
        var go = function () { if (d.r && d.r.double) aiDoubles(); else aiRoll(); };
        later(Math.max(0, 380 - (performance.now() - t0)), go);
      });
      return;
    }
    later(380, aiRoll);
  }

  function aiRoll() {
    var d1 = K.die(), d2 = K.die();
    dice = dice.filter(function (d) { return d.side !== 1; });
    shakeThenThrow(1, [d1, d2], function () { later(260, function () { aiMove(d1, d2); }); });
  }

  function aiMove(d1, d2) {
    who = 1; phase = "ai";
    if (d1 === d2) splitDoubles(1, d1);
    var r = K.rule(board[1], board[0], d1, d2);
    if (r.max === 0) {
      say(board[1][25] ? "Can't come in." : "Nothing to play.");
      dice.forEach(function (d) { if (d.side === 1) d.used = true; });
      later(1200, function () { lastMove = []; afterAi(); });
      return;
    }
    thinking(true);
    var t0 = performance.now();
    ask({ type: "play", who: foe.id, me: Array.from(board[1]), them: Array.from(board[0]), d1: d1, d2: d2, match: matchInfo(1) }, function (d) {
      thinking(false);
      var steps = d.steps || [];
      later(Math.max(0, 420 - (performance.now() - t0)), function () { playAi(steps); });
    });
  }

  function playAi(steps) {
    var i = 0, arrows = [], hitAny = false;
    (function next() {
      if (i >= steps.length) {
        lastMove = arrows;
        if (hitAny) say(foe.quips.hit);
        later(220, afterAi);
        return;
      }
      var st = steps[i++];
      var a = topOf(1, st.from);
      useDie(1, st.die);
      if (st.hit) hitAny = true;
      var dur = animateStep(1, st, 0, null);
      var b = topOf(1, st.to);
      arrows.push({ a: { x: a.x, z: a.z }, b: { x: b.x, z: b.z } });
      later(dur + (reduced() ? 0 : 130), next);
    })();
  }

  function afterAi() {
    if (board[1][0] === 15) { gameOver(1, K.winKind(board[1], board[0]) * cube.v, "board"); return; }
    playerTurn();
  }

  function aiDoubles() {
    say(foe.quips.double);
    A.double();
    phase = "ask"; updateBar();
    showAsk(shortName(foe) + " doubles",
      "The cube would go to <b>" + cube.v * 2 + "</b>. Take, and play on for " + cube.v * 2 + " points a game (" + cube.v * 4 + " with a gammon). Pass, and give up this game for <b>" + cube.v + "</b>.",
      [{ label: "Take", key: "t", go: true, fn: function () { hideAsk(); takeCube(0, function () { aiRoll(); }); track("bg_double", { by: "opponent", response: "take", opponent: foe.id }); } },
       { label: "Pass", key: "p", fn: function () { hideAsk(); track("bg_double", { by: "opponent", response: "pass", opponent: foe.id }); gameOver(1, cube.v, "pass"); } }]);
  }

  function playerDoubles() {
    if (!(phase === "preroll" && who === 0 && canDouble(0))) return;
    A.init(); A.double(); closeMenu();
    phase = "ask"; updateBar();
    note("You offer the cube at " + cube.v * 2, 1600);
    thinking(true);
    var t0 = performance.now();
    ask({ type: "take", who: foe.id, me: Array.from(board[1]), them: Array.from(board[0]), match: matchInfo(1) }, function (d) {
      later(Math.max(0, 1100 - (performance.now() - t0)), function () {
        thinking(false);
        var take = d.r && d.r.take;
        track("bg_double", { by: "player", response: take ? "take" : "pass", opponent: foe.id });
        if (take) {
          say(foe.quips.take);
          flash(shortName(foe) + " takes");
          takeCube(1, function () { phase = "preroll"; updateBar(); });
        } else {
          say(foe.quips.pass);
          flash(shortName(foe) + " passes");
          later(900, function () { gameOver(0, cube.v, "pass"); });
        }
      });
    });
  }

  /* The cube turns to its new number and moves to the side that took it. */
  function takeCube(taker, done) {
    var from = cubeSpot(cube.owner), to = cubeSpot(taker);
    var nv = cube.v * 2;
    cubeAnim = { t: 0, dur: reduced() ? 1 : 640, from: from, to: to, top: cubeLabel(cube.v), front: String(nv),
      done: function () { cube.v = nv; cube.owner = taker; A.cube(1, panOf(TRAY_X)); updateScore(); done(); } };
    A.cube(0.6, panOf(TRAY_X));
  }

  /* ================= game flow ================= */
  function newMatch(id) {
    matchToken++; lock = 0;
    foe = foeById(id);
    lsSet(LS.foe, foe.id);
    score = [0, 0]; crawfordDone = false; crawfordGame = false; games = []; toldCube = false;
    clearShare();
    renderOpp(); say(foe.quips.start);
    elOpp.hidden = false; elBar.hidden = false; elScore.hidden = false;
    document.body.classList.add("is-playing");
    A.startBed();
    track("bg_match_start", { opponent: foe.id, cube: cubeOn ? "on" : "off" });
    newGame();
  }

  function newGame() {
    board = [K.start(), K.start()];
    cube = { v: 1, owner: -1 };
    crawfordGame = cubeOn && !crawfordDone && (score[0] === MATCH_TO - 1 || score[1] === MATCH_TO - 1);
    if (crawfordGame) crawfordDone = true;
    flyers = []; dice = []; particles = []; turn = null; deselect(); hint = null; lastMove = null; cubeAnim = null;
    who = 0; phase = "opening";
    hideAsk();
    updatePips(); updateScore(); updateBar();
    if (crawfordGame) note("The Crawford game: no doubling this game", 2600);
  }

  /* Each side rolls one die. Higher goes first and plays both numbers. */
  function openingRoll() {
    var mine = K.die(), theirs = K.die(), landed = 0;
    function both() {
      if (++landed < 2) return;
      later(500, function () {
        if (mine === theirs) {
          flash("Tie. Roll again");
          later(900, function () { dice = []; phase = "opening"; who = 0; updateBar(); });
          return;
        }
        var starter = mine > theirs ? 0 : 1;
        flash(starter === 0 ? "You go first" : shortName(foe) + " goes first");
        /* both dice slide over to the starter's side: that is their first roll */
        var hi = Math.max(mine, theirs), lo = Math.min(mine, theirs);
        dice.forEach(function (d) {
          d.side = starter;
          slideDie(d, dieRest(starter, d.v === hi ? 0 : 1, 2));
        });
        later(700, function () {
          if (starter === 0) beginPlayerMove(hi, lo);
          else { who = 1; phase = "ai"; updateBar(); aiMove(hi, lo); }
        });
      });
    }
    shakeThenThrow(0, [mine], both);
    later(reduced() ? 0 : 160, function () {
      if (props.cup1) cupShake[1] = 1;
      A.shake(0.3, -0.4);
      later(reduced() ? 0 : 300, function () {
        cupShake[1] = 0.99;
        throwDice(1, [theirs], both);
      });
    });
  }

  function playerTurn() {
    who = 0; phase = "preroll"; turn = null; deselect();
    updateBar();
    if (canDouble(0) && !toldCube) { toldCube = true; note("You can double before you roll", 2000); }
  }

  function endTurn() {
    if (board[0][0] === 15) { gameOver(0, K.winKind(board[0], board[1]) * cube.v, "board"); return; }
    turn = null; deselect();
    aiTurn();
  }

  var KIND = { 1: "a single game", 2: "a gammon", 3: "a backgammon" };
  function gameOver(winner, pts, how) {
    phase = "gameover"; updateBar(); clearNote();
    var mult = how === "pass" ? 0 : pts / cube.v;
    var kind = how === "pass" ? "the double, passed" : KIND[mult] || "a game";
    score[winner] += pts;
    games.push({ winner: winner, pts: pts, mult: mult, how: how });
    updateScore(true);
    track("bg_game_end", { opponent: foe.id, result: winner === 0 ? "win" : "loss", points: pts, kind: how === "pass" ? "pass" : mult === 3 ? "backgammon" : mult === 2 ? "gammon" : "single" });
    var over = score[winner] >= MATCH_TO;
    if (winner === 0) {
      flash(mult === 3 ? "Backgammon!" : mult === 2 ? "Gammon!" : "+" + pts);
      if (!over) { A.gameWin(); say(foe.quips.glose); }
      burst(4, 3.5, 0.2, "big");
    } else {
      flash(shortName(foe) + (mult === 3 ? " backgammons you" : mult === 2 ? " gammons you" : " +" + pts), true);
      if (!over) { A.gameLose(); say(foe.quips.gwin); }
    }
    if (over) { later(1300, function () { matchOver(winner); }); return; }
    var line = (winner === 0 ? "You win " : shortName(foe) + " wins ") + (how === "pass" ? pts + (pts === 1 ? " point" : " points") + " on a pass" : kind + " for " + pts + (pts === 1 ? " point" : " points")) + ".";
    var next = MATCH_TO - 1;
    var craw = cubeOn && !crawfordDone && (score[0] === next || score[1] === next);
    later(1100, function () {
      showAsk("You " + score[0] + " &ndash; " + score[1] + " " + shortName(foe),
        line + (craw ? " The next game is the <b>Crawford game</b>: no doubling." : "") + " First to " + MATCH_TO + " takes the match.",
        [{ label: "Next game", key: "n", go: true, fn: function () { hideAsk(); newGame(); } }]);
    });
  }

  function matchOver(winner) {
    phase = "over"; updateBar();
    var won = winner === 0, s = score[0] + "–" + score[1];
    var gam = games.filter(function (g) { return g.winner === winner && g.mult >= 2; }).length;
    var bg = games.filter(function (g) { return g.winner === winner && g.mult === 3; }).length;
    var extra = bg ? (bg > 1 ? ", with " + bg + " backgammons" : ", with a backgammon") : gam ? (gam > 1 ? ", with " + gam + " gammons" : ", with a gammon") : "";
    if (won) {
      bump(LS.w); recordDefeat(foe.id); A.matchWin(); confetti(); say(foe.quips.lose);
      elResTitle.textContent = "You win the match";
      elResText.innerHTML = "You beat <b>" + foe.name + "</b> " + s + extra + ".";
    } else {
      bump(LS.l); A.matchLose(); say(foe.quips.win);
      elResTitle.textContent = foe.name + " wins";
      elResText.innerHTML = "<b>" + foe.name + "</b> beat you " + score[1] + "–" + score[0] + extra + ".";
    }
    elResLine.textContent = "match to " + MATCH_TO + (cubeOn ? " · with the cube" : "");
    elResSeal.innerHTML = sealSvg(foe, 56);
    elResRecord.textContent = record();
    setupShare(won, extra);
    track("bg_match_end", { opponent: foe.id, result: won ? "win" : "loss", score: s, cube: cubeOn ? "on" : "off" });
    later(900, function () { elResult.hidden = false; });
  }

  function record() {
    return "Matches  " + lsGet(LS.w, "0") + " won · " + lsGet(LS.l, "0") + " lost   ·   regulars beaten " + defeated().length + "/6";
  }
  function bump(k) { lsSet(k, String((parseInt(lsGet(k, "0"), 10) || 0) + 1)); }
  function defeated() { try { return JSON.parse(lsGet(LS.defeated, "[]")) || []; } catch (e) { return []; } }
  function recordDefeat(id) {
    var l = defeated();
    if (l.indexOf(id) < 0) l.push(id);
    lsSet(LS.defeated, JSON.stringify(l));
    /* the ticket rule reads this; it only ever goes up, and nothing awards directly */
    var prev = parseInt(lsGet(LS.beaten, "0"), 10) || 0;
    lsSet(LS.beaten, String(Math.max(prev, l.length)));
  }
  function confetti() {
    for (var i = 0; i < 7; i++) later(i * 140, function () { burst(-6 + Math.random() * 12, -4 + Math.random() * 8, 0.3, "big"); });
  }

  /* ================= hint ================= */
  function requestHint() {
    if (phase !== "moving" || who !== 0 || busy() || !turn || turn.need <= 0) return;
    A.init(); deselect();
    thinking(true, "hint");
    track("bg_hint", { opponent: foe.id });
    var snap = turn.steps.length;
    ask({ type: "hint", me: Array.from(board[0]), them: Array.from(board[1]), d1: turn.d1, d2: turn.d2, match: matchInfo(0),
      rest: { dice: turn.left.slice(), max: turn.need, only: turn.only } }, function (d) {
      thinking(false);
      say(foe.trait);
      if (!turn || turn.steps.length !== snap || phase !== "moving") return;
      var me = Int8Array.from(board[0]), them = Int8Array.from(board[1]), arrows = [];
      (d.steps || []).forEach(function (st) {
        var a = slotWorld(0, st.from, Math.max(0, me[st.from] - 1));
        K.apply(me, them, st);
        var b = slotWorld(0, st.to, me[st.to] - 1);
        arrows.push({ a: a, b: b });
      });
      hint = arrows.length ? arrows : null;
      hintSteps = (d.steps || []).map(function (st) { return [st.from, st.to]; });
      A.hint();
      if (hint) note("The hint: follow the gold arrows", 1600);
    });
  }

  /* ================= chrome ================= */
  var elOpp = $("opp"), elSeal = $("oppSeal"), elName = $("oppName"), elRole = $("oppRole"), elSay = $("oppSay"), elOppPips = $("oppPips");
  var elBar = $("bar"), elTurn = $("turn"), elMyPips = $("myPips"), elCallout = $("callout"), elOverlay = $("overlay"), elCast = $("cast");
  var elResult = $("result"), elResTitle = $("resTitle"), elResLine = $("resLine"), elResText = $("resText"),
      elResRecord = $("resRecord"), elResSeal = $("resSeal"), elSound = $("soundBtn"), elHintLine = $("hintLine");
  var elScore = $("score"), elScoreMe = $("scoreMe"), elScoreThem = $("scoreThem"), elScoreTo = $("scoreTo");
  var elAsk = $("ask"), elAskTitle = $("askTitle"), elAskText = $("askText"), elAskBtns = $("askBtns"), elNote = $("note");
  var btnRoll = $("btnRoll"), btnDouble = $("btnDouble"), btnHint = $("btnHint"), elMenu = $("menu"), btnMore = $("btnMore");

  var said = "";
  function say(t) { said = t || ""; elSay.textContent = said; }
  function thinking(on, kind) {
    elSay.classList.toggle("is-think", !!on);
    elSay.textContent = on ? (kind === "hint" ? "looking over your roll" : "thinking") : said;
  }
  var calloutT = null;
  function flash(t, bad, ms) {
    if (!t) return;
    elCallout.textContent = t; elCallout.classList.toggle("is-bad", !!bad);
    elCallout.hidden = false; elCallout.classList.remove("is-pop"); void elCallout.offsetWidth; elCallout.classList.add("is-pop");
    clearTimeout(calloutT); calloutT = setTimeout(function () { elCallout.hidden = true; }, ms || 1400);
  }
  var noteT = null;
  function clearNote() { clearTimeout(noteT); elNote.classList.remove("is-on"); }
  function note(t, ms) {
    elNote.textContent = t; elNote.classList.add("is-on");
    clearTimeout(noteT); noteT = setTimeout(function () { elNote.classList.remove("is-on"); }, ms || 1600);
  }
  function renderOpp() { elSeal.innerHTML = sealSvg(foe, 40); elName.textContent = foe.name; elRole.textContent = foe.role; }
  function updatePips() { elMyPips.textContent = K.pips(board[0]); elOppPips.textContent = K.pips(board[1]); }
  function updateScore(bump) {
    elScoreMe.textContent = score[0]; elScoreThem.textContent = score[1];
    elScoreTo.innerHTML = crawfordGame ? "Crawford" : "to " + MATCH_TO + (cubeOn && cube.v > 1 ? '<span class="score__cube"> · cube ' + cube.v + "</span>" : "");
    elScoreTo.classList.toggle("is-crawford", crawfordGame);
    if (bump) { elScore.classList.remove("is-bump"); void elScore.offsetWidth; elScore.classList.add("is-bump"); }
  }
  function updateBar() {
    var mine = who === 0;
    var txt = phase === "opening" ? "Roll to start" : phase === "rolling" ? "Rolling" :
      phase === "preroll" ? "Your roll" : phase === "moving" ? (turn && turn.need > 0 ? "Your move" : "Your move") :
      phase === "ai" ? shortName(foe) + "'s turn" : phase === "ask" ? (who === 0 ? "The cube" : shortName(foe) + " doubles") :
      phase === "gameover" ? "Game over" : phase === "over" ? "Match over" : "";
    elTurn.textContent = txt;
    elTurn.classList.toggle("is-you", mine && (phase === "preroll" || phase === "moving" || phase === "opening"));
    var canRoll = mine && (phase === "preroll" || phase === "opening") && !busy();
    btnRoll.disabled = !canRoll;
    btnRoll.classList.toggle("is-ready", canRoll);
    btnRoll.textContent = phase === "opening" ? "Roll" : "Roll";
    btnDouble.hidden = !cubeOn;
    btnDouble.disabled = !(mine && phase === "preroll" && canDouble(0));
    btnDouble.textContent = "Double" + (cubeOn && canDouble(0) ? " to " + cube.v * 2 : "");
    btnHint.disabled = !(mine && phase === "moving" && turn && turn.need > 0);
  }

  var askBtns = [];
  function showAsk(title, html, btns) {
    clearNote();
    elAskTitle.innerHTML = title; elAskText.innerHTML = html; elAskBtns.innerHTML = ""; askBtns = btns;
    btns.forEach(function (b, i) {
      var e = document.createElement("button");
      e.type = "button"; e.className = "btn" + (b.go ? " btn--go" : ""); e.textContent = b.label;
      e.addEventListener("click", function () { A.init(); b.fn(); });
      elAskBtns.appendChild(e);
      if (i === 0) setTimeout(function () { try { e.focus({ preventScroll: true }); } catch (x) {} }, 30);
    });
    elAsk.hidden = false;
  }
  function hideAsk() { elAsk.hidden = true; askBtns = []; }

  function closeMenu() { elMenu.hidden = true; btnMore.setAttribute("aria-expanded", "false"); }
  btnMore.addEventListener("click", function () {
    var open = elMenu.hidden;
    elMenu.hidden = !open; btnMore.setAttribute("aria-expanded", open ? "true" : "false");
  });

  /* Each regular gets a painted tile with a mark of their life by the harbor. */
  function sealSvg(f, size) {
    var g = {
      shell: '<path d="M-7 4c0-6 3-10 7-10s7 4 7 10z"/><path d="M0-6v10M-3.6-4.4L-1.4 4M3.6-4.4L1.4 4M-6.2-0.4l3 4.4M6.2-0.4l-3 4.4"/><path d="M-2 4v2.6h4V4"/>',
      anchor: '<circle cx="0" cy="-6.6" r="1.8"/><path d="M0-4.8v12.4"/><path d="M-4-2.4h8"/><path d="M-7.6 2.6c1 3.6 4 5 7.6 5s6.6-1.4 7.6-5"/><path d="M-7.6 2.6l-1.2 2.4M7.6 2.6l1.2 2.4"/>',
      cake: '<path d="M-7.5 2h15v4.6h-15z"/><path d="M-6.5 2c0-3.4 3-5.4 6.5-5.4S6.5-1.4 6.5 2"/><path d="M-3-3.8l1.4-2.6M0-4.4v-2.6M3-3.8l-1.4-2.6"/>',
      wheel: '<circle cx="0" cy="0" r="5.4"/><circle cx="0" cy="0" r="1.6"/><path d="M0-9v3.6M0 5.4V9M-9 0h3.6M5.4 0H9M-6.4-6.4l2.6 2.6M3.8 3.8l2.6 2.6M6.4-6.4l-2.6 2.6M-3.8 3.8l-2.6 2.6"/>',
      glasses: '<circle cx="-4.4" cy="1" r="3.2"/><circle cx="4.4" cy="1" r="3.2"/><path d="M-1.2 0.4c0.8-0.8 1.6-0.8 2.4 0"/><path d="M-7.6 0l-1.6-3M7.6 0l1.6-3"/>',
      cup: '<path d="M-4.6-5.4h9.2l-1.2 3.4c-0.6 1.6-0.6 3 0 4.4l0.8 2.6h-7.4l0.8-2.6c0.6-1.4 0.6-2.8 0-4.4z"/><path d="M-7 7.2h14"/><path d="M-1.4-8c0-1 1-1 1-2M1.4-8c0-1 1-1 1-2"/>'
    }[f.glyph];
    return '<svg viewBox="-14 -14 28 28" width="' + size + '" height="' + size + '" aria-hidden="true">' +
      '<circle cx="0" cy="0" r="13" fill="#123a4c" stroke="' + f.accent + '" stroke-opacity="0.6" stroke-width="1"/>' +
      '<circle cx="0" cy="0" r="10.6" fill="none" stroke="' + f.accent + '" stroke-opacity="0.24" stroke-width="0.7" stroke-dasharray="1.6 1.4"/>' +
      '<g fill="none" stroke="' + f.accent + '" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round">' + g + "</g></svg>";
  }

  var picked = null;
  /* the first regular you have not beaten yet; once you have beaten them all,
     whoever you played last */
  function defaultFoe() {
    var beaten = defeated();
    for (var i = 0; i < FOES.length; i++) if (beaten.indexOf(FOES[i].id) < 0) return FOES[i];
    return foeById(lsGet(LS.foe, "noor"));
  }
  function buildCast() {
    var beaten = defeated();
    if (!picked) picked = defaultFoe();
    elCast.innerHTML = "";
    FOES.forEach(function (f) {
      var b = document.createElement("button");
      b.type = "button"; b.className = "foe" + (f === picked ? " is-pick" : "");
      var pips = "";
      for (var i = 1; i <= 6; i++) pips += '<span class="foe__pip' + (i <= f.tier ? " on" : "") + '"></span>';
      b.innerHTML = '<span class="foe__seal">' + sealSvg(f, 38) + "</span>" +
        '<span class="foe__name">' + f.name + "</span>" +
        '<span class="foe__role">' + f.role + "</span>" +
        '<span class="foe__pips">' + pips + "</span>" +
        '<span class="foe__trait">' + f.trait + "</span>" +
        (beaten.indexOf(f.id) >= 0 ? '<span class="foe__won" title="You have beaten this regular">&#10003;</span>' : "");
      b.setAttribute("data-opt-start", "");
      b.addEventListener("click", function () { picked = f; start(); });
      elCast.appendChild(b);
    });
    paintGo();
  }
  function paintGo() { $("ovBtn").textContent = "Sit down with " + shortName(picked); }
  function start() {
    A.init();
    elOverlay.classList.add("is-out");
    setTimeout(function () { elOverlay.hidden = true; elOverlay.classList.remove("is-out"); }, 240);
    newMatch(picked.id);
  }
  function wireOptions() {
    var cb = $("cubeBtn");
    function paint() {
      cb.setAttribute("aria-checked", cubeOn ? "true" : "false");
      $("cubeNote").textContent = cubeOn
        ? "First to 5 points. Double before you roll. When someone reaches 4, the next game is played without the cube (the Crawford rule)."
        : "First to 5 points. A gammon counts 2, a backgammon 3.";
    }
    cb.addEventListener("click", function () { cubeOn = !cubeOn; lsSet(LS.cube, cubeOn ? "1" : "0"); paint(); A.init(); A.cube(0.5, 0); });
    paint();
    $("ovBtn").addEventListener("click", start);
  }
  function showCast() {
    matchToken++; lock = 0;
    elResult.hidden = true; hideAsk(); closeMenu();
    phase = "idle"; flyers = []; dice = []; turn = null; deselect(); hint = null; lastMove = null;
    board = [K.start(), K.start()];
    picked = null; buildCast(); elOverlay.hidden = false;
    elOpp.hidden = true; elBar.hidden = true; elScore.hidden = true;
    document.body.classList.remove("is-playing");
  }

  btnRoll.addEventListener("click", roll);
  btnDouble.addEventListener("click", playerDoubles);
  btnHint.addEventListener("click", requestHint);
  $("btnNew").addEventListener("click", showCast);
  var concedeT = null;
  $("btnConcede").addEventListener("click", function () {
    var b = $("btnConcede");
    if (b.getAttribute("data-sure") !== "1") {
      b.setAttribute("data-sure", "1"); b.textContent = "Sure? Tap again";
      clearTimeout(concedeT); concedeT = setTimeout(function () { b.removeAttribute("data-sure"); b.textContent = "Concede the match"; }, 3000);
      return;
    }
    b.removeAttribute("data-sure"); b.textContent = "Concede the match";
    closeMenu(); hideAsk();
    if (phase === "idle" || phase === "over") return;
    matchToken++; lock = 0;
    flyers = []; turn = null; deselect();
    score[1] = Math.max(score[1], MATCH_TO);
    updateScore(true);
    games.push({ winner: 1, pts: 0, mult: 0, how: "concede" });
    matchOver(1);
    elResLine.textContent = "you conceded";
  });
  $("btnAgain").addEventListener("click", function () { elResult.hidden = true; newMatch(foe.id); });
  $("btnCast").addEventListener("click", showCast);

  elSound.addEventListener("click", function () {
    soundOn = !soundOn; lsSet(LS.sound, soundOn ? "1" : "0");
    elSound.setAttribute("aria-pressed", soundOn ? "true" : "false");
    A.init(); A.setOn(soundOn); if (soundOn) A.select(0);
  });
  elSound.setAttribute("aria-pressed", soundOn ? "true" : "false");
  A.setOn(soundOn);

  /* ---------- keyboard ----------
     Arrows walk a cursor over the points, the bar and the tray; Enter picks up and
     puts down. It is a real way to play, and it is how the tests and the card pose
     drive the board without a debug hook. */
  var ROWS = [[13, 14, 15, 16, 17, 18, 25, 19, 20, 21, 22, 23, 24, 0], [12, 11, 10, 9, 8, 7, 25, 6, 5, 4, 3, 2, 1, 0]];
  function cursorOwn() { return ROWS[cursor.row][cursor.i]; }
  function moveCursor(dx, dy) {
    if (!cursor) {
      var src = sources();
      var first = src.length ? src[0] : 24, row = first >= 13 || first === 25 ? 0 : 1;
      cursor = { row: row, i: Math.max(0, ROWS[row].indexOf(first)) };
    } else {
      cursor.i = clamp(cursor.i + dx, 0, 13);
      if (dy) cursor.row = dy < 0 ? 0 : 1;
    }
    cursor.own = cursorOwn(); cursor.top = cursor.row === 0;
  }
  function cursorWorld() {
    var own = cursorOwn();
    if (own === 0) return { x: TRAY_X, z: cursor.row === 0 ? -2 : 2 };
    if (own === 25) return { x: 0, z: cursor.row === 0 ? -2 : 2 };
    return { x: pointX(own), z: own >= 13 ? -3 : 3 };
  }
  window.addEventListener("keydown", function (e) {
    var k = e.key;
    if (!elAsk.hidden && askBtns.length) {
      for (var i = 0; i < askBtns.length; i++) if (askBtns[i].key === k.toLowerCase()) { e.preventDefault(); askBtns[i].fn(); return; }
      return;
    }
    if (phase === "idle" || phase === "over") return;
    if (k === "ArrowLeft" || k === "ArrowRight" || k === "ArrowUp" || k === "ArrowDown") {
      e.preventDefault();
      moveCursor(k === "ArrowRight" ? 1 : k === "ArrowLeft" ? -1 : 0, k === "ArrowUp" ? -1 : k === "ArrowDown" ? 1 : 0);
      return;
    }
    if (k === "Enter" || k === " ") {
      if (document.activeElement && document.activeElement.tagName === "BUTTON" && document.activeElement !== document.body) {
        if (k === " " || k === "Enter") { if (!cursor) return; }
      }
      e.preventDefault(); A.init();
      if (!cursor) { if (phase === "preroll" || phase === "opening") { roll(); return; } moveCursor(0, 0); return; }
      var w = cursorWorld();
      if (phase === "moving") {
        var own = cursorOwn();
        if (sel >= 0 && dests.some(function (d) { return d.to === own; })) { commit(own); return; }
        if (own === sel) { deselect(); return; }
        if (sources().indexOf(own) >= 0) { select(own); return; }
        if (own >= 1 && board[0][own]) deny(explainNo(own));
        return;
      }
      tapAt(w.x, w.z);
      return;
    }
    if (k === "r" || k === "R") roll();
    else if (k === "d" || k === "D") playerDoubles();
    else if (k === "h" || k === "H") requestHint();
    else if (k === "m" || k === "M") elSound.click();
    else if (k === "Escape") { deselect(); cursor = null; closeMenu(); }
  });

  /* ---------- share ---------- */
  function clearShare() { window.OPT_SHARE_TEXT = undefined; window.OPT_SHARE_LINE = undefined; window.OPT_SHARE_IMAGE = undefined; }
  function setupShare(won, extra) {
    var s = won ? score[0] + "-" + score[1] : score[1] + "-" + score[0];
    window.OPT_SHARE_TEXT = won
      ? "I beat " + foe.name + " " + s + " at backgammon" + extra + ". " + foe.name + " " + foe.role + "."
      : foe.name + " beat me " + s + " at backgammon" + extra + ". Your turn.";
    window.OPT_SHARE_LINE = won ? "Beat " + foe.name + " " + s : "Lost to " + foe.name + " " + s;
    window.OPT_SHARE_IMAGE = function () {
      var c0 = project(EDGE_L, FRAME_Y, -ZE), c1 = project(EDGE_R, TABLE_Y, ZE);
      var x0 = Math.max(0, Math.min(c0.x, project(EDGE_L, 0, ZE).x) - 20), y0 = Math.max(0, c0.y - 60);
      var x1 = Math.min(W, Math.max(c1.x, project(EDGE_R, 0, -ZE).x) + 20), y1 = Math.min(H, c1.y + 30);
      var w = (x1 - x0) * dpr, h = (y1 - y0) * dpr;
      var out = document.createElement("canvas"); out.width = Math.round(w); out.height = Math.round(h);
      out.getContext("2d").drawImage(canvas, x0 * dpr, y0 * dpr, w, h, 0, 0, w, h);
      return out;
    };
  }

  /* ---------- automation handle (tests and the card pose only) ---------- */
  if (navigator.webdriver) {
    window.__backgammon = {
      state: function () {
        return { me: Array.from(board[0]), them: Array.from(board[1]), phase: phase, who: who, score: score.slice(), cube: { v: cube.v, owner: cube.owner },
          crawford: crawfordGame, sel: sel, dests: dests.map(function (d) { return d.to; }), sources: phase === "moving" && who === 0 ? sources() : [],
          turn: turn ? { d1: turn.d1, d2: turn.d2, left: turn.left.slice(), need: turn.need, only: turn.only } : null,
          busy: busy(), hint: hint ? hint.length : 0, hintSteps: hint ? hintSteps : [], cursor: cursor ? [cursor.row, cursor.i] : null, askOpen: !elAsk.hidden, result: !elResult.hidden, dice: dice.map(function (d) { return [d.side, d.v, d.used]; }) };
      },
      slot: function (own, top) {
        var x = own === 0 ? TRAY_X : own === 25 ? 0 : pointX(own);
        var z = own === 0 ? (top ? -2.5 : 2.5) : own === 25 ? (top ? -2 : 2) : (own >= 13 ? -3.2 : 3.2);
        var p = project(x, 0, z);
        return { x: p.x, y: p.y };
      },
      at: function (x, y, z) { var p = project(x, y, z); return { x: p.x, y: p.y }; }
    };
  }

  /* ---------- boot ---------- */
  wireOptions();
  buildCast();
  window.addEventListener("resize", resize);
  resize();
  requestAnimationFrame(tick);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { buildScene(); });
  setTimeout(function () { elHintLine.classList.add("is-gone"); }, 9000);
})();
