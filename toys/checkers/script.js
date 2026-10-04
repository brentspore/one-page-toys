/* Checkers — No. 127.
   A worn folk-art board on a cracker barrel at the back of a country store: a stove
   ticking over to the left, a lamp overhead, and six regulars who will play you.

   The board is drawn with a real perspective camera, like Chess, but tilted further:
   a checker is a flat disc, so it can never hide the square behind it, and the
   extra tilt is free drama. Everything that never moves (the room, the barrel, the
   painted board) is baked once per layout into one canvas; each frame only draws
   the marks, the checkers and the light from the stove. */
(function () {
  "use strict";

  var K = window.CheckersCore, A = window.CheckersAudio;
  var BLACK = K.BLACK, RED = K.RED, ROW = K.ROW, COL = K.COL;
  var canvas = document.getElementById("canvas");
  var ctx = canvas.getContext("2d");
  var $ = function (id) { return document.getElementById(id); };

  /* ================= camera ================= */
  var TILT = 0.68;                                   /* from straight down */
  var THETA = Math.PI / 2 - TILT;
  var SIN = Math.sin(THETA), COS = Math.cos(THETA);  /* SIN squashes flat circles, COS scales heights */
  var CAM_D = 17, FOCAL = 1000, CX = 0, CY = 0;

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

  /* The player always sits at the near edge. Black's back row is row 0. */
  var flip = false;
  function cellWorld(r, c) { return flip ? { x: 3.5 - c, z: 3.5 - r } : { x: c - 3.5, z: r - 3.5 }; }
  function sqWorld(i) { return cellWorld(ROW[i], COL[i]); }

  var PR = 0.40, PH = 0.15;                          /* checker radius and thickness */

  /* ================= persistence ================= */
  var LS = { beaten: "checkers_beaten", defeated: "checkers_defeated", sound: "checkers_sound",
    w: "checkers_wins", l: "checkers_losses", d: "checkers_draws", side: "checkers_side", forced: "checkers_forced" };
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  /* ================= the regulars ================= */
  var FOES = [
    { id: "junie", name: "Junie", role: "the storekeeper's girl", tier: 1, glyph: "broom", accent: "#e8b04a",
      trait: "Grabs whatever's closest.",
      quips: { start: "Ma says I'm not allowed to win too fast.", capture: "Gotcha!", crown: "King me! King me!",
               win: "I won! Somebody tell Grandpa!", lose: "Best two out of three?" } },
    { id: "hal", name: "Hal", role: "the mail carrier", tier: 2, glyph: "envelope", accent: "#86abcf",
      trait: "Plays quick between deliveries.",
      quips: { start: "I've got ten minutes. Make 'em count.", capture: "Special delivery.", crown: "King me. And step on it.",
               win: "Signed, sealed, delivered.", lose: "Return to sender. Good game." } },
    { id: "odette", name: "Miss Odette", role: "the schoolteacher", tier: 3, glyph: "apple", accent: "#d86a5c",
      trait: "Keeps her back row home and waits.",
      quips: { start: "Sit up straight. Black moves first.", capture: "Careless.", crown: "King me, if you please.",
               win: "See me after class.", lose: "Very good. A gold star." } },
    { id: "jasper", name: "Jasper Quill", role: "traveling salesman", tier: 4, glyph: "hat", accent: "#a487cc",
      trait: "Gives you a free checker. Then the trap.",
      quips: { start: "Friend, have I got a deal for you.", capture: "No refunds.", crown: "King me. Top of the line.",
               win: "Pleasure doing business.", lose: "Well, I'll be. You drive a hard bargain." } },
    { id: "doc", name: "Doc Whitlow", role: "the county doctor", tier: 5, glyph: "steth", accent: "#74bb8f",
      trait: "Patient, careful, hard to rattle.",
      quips: { start: "Let's take a look.", capture: "That'll sting.", crown: "King me. Doctor's orders.",
               win: "The prognosis was never good.", lose: "A clean bill of health. Well played." } },
    { id: "silas", name: "Old Silas", role: "owns the store", tier: 6, glyph: "bell", accent: "#e6ad3e",
      trait: "County champion forty years running.",
      quips: { start: "Pull up a barrel.", capture: "Mm-hm.", crown: "King me.",
               win: "Come back anytime. Store's open till six.", lose: "Well now. Forty years, and here you are." } }
  ];
  function foeById(id) { for (var i = 0; i < FOES.length; i++) if (FOES[i].id === id) return FOES[i]; return FOES[0]; }

  /* ================= state ================= */
  var pos = K.start(), foe = FOES[0], player = BLACK, forced = lsGet(LS.forced, "1") !== "0";
  var started = false, gameOver = false, thinking = false;
  var history = [], snaps = [], stackHist = [];      /* per ply: move notes, boards, captured stacks */
  var stacks = { mine: 0, theirs: 0 };               /* discs captured BY the player / BY the opponent */
  var sel = -1, cands = [], prefix = [], inJump = false;
  var hintMove = null, lastMove = null, cursor = -1;
  var mustT = 0, shakeSq = -1, shakeT = 0;
  var drag = null;
  var view = { hide: {}, mover: null };              /* overrides to the board while something moves */
  var flyers = [], hopQ = [], hop = null, afterHops = null;
  var particles = [], motes = [];
  var replay = null, rboard = null;
  var worker = null, workerBroken = false, reqId = 0, pending = null, thinkStart = 0;
  var soundOn = lsGet(LS.sound, "1") !== "0";

  function reduced() { return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches; }
  function board() { return replay ? rboard : pos.b; }
  function sideOf(p) { return p > 0 ? BLACK : p < 0 ? RED : 0; }
  function mine(p) { return p && sideOf(p) === player; }
  function myTurn() { return started && !gameOver && !replay && !thinking && pos.turn === player && !hop && !hopQ.length && !flyers.some(function (f) { return f.blocking; }); }
  function discsOf(p) { return Math.abs(p) === 2 ? 2 : 1; }

  /* ================= layout ================= */
  var dpr = 1, W = 0, H = 0, squares = [], sceneCv = null;
  var STOVE = { x: 0, y: 0, r: 0, on: false }, LAMP = { x: 0, y: 0 };

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.floor(W * dpr); canvas.height = Math.floor(H * dpr);
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    fit();
    buildSprites();
    buildScene();
    dirty = true;
  }

  /* Screen offsets are linear in FOCAL, so one measure-and-scale pass fits exactly. */
  function fit() {
    CX = 0; CY = 0; FOCAL = 1000;
    var pts = [[-4.75, 0, -5.6], [4.75, 0, -5.6], [-4.75, 0, 5.55], [4.75, 0, 5.55], [0, 0.9, -5.4]];
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    pts.forEach(function (q) {
      var p = project(q[0], q[1], q[2]);
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    });
    var narrow = W < 620, low = H < 560;
    var padX = narrow ? 8 : 40, padTop = low ? 56 : narrow ? 86 : 96, padBot = low ? 64 : narrow ? 122 : 112;
    var availW = W - padX * 2, availH = H - padTop - padBot;
    var k = Math.min(availW / (maxX - minX), availH / (maxY - minY));
    FOCAL *= k;
    minX *= k; maxX *= k; minY *= k; maxY *= k;
    CX = W / 2 - (minX + maxX) / 2;
    CY = padTop + availH / 2 - (minY + maxY) / 2;
    cacheSquares();
  }

  function cacheSquares() {
    squares = [];
    for (var r = 0; r < 8; r++) for (var c = 0; c < 8; c++) {
      var w0 = cellWorld(r, c);
      var quad = [project(w0.x - 0.5, 0, w0.z - 0.5), project(w0.x + 0.5, 0, w0.z - 0.5),
                  project(w0.x + 0.5, 0, w0.z + 0.5), project(w0.x - 0.5, 0, w0.z + 0.5)];
      squares.push({ r: r, c: c, sq: K.at(r, c), quad: quad, ctr: project(w0.x, 0, w0.z), z: w0.z });
    }
  }
  function cellOf(sq) { for (var i = 0; i < squares.length; i++) if (squares[i].sq === sq) return squares[i]; return null; }

  /* ================= small helpers ================= */
  function srnd(n) { var x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }
  function quadPath(g, q) { g.beginPath(); g.moveTo(q[0].x, q[0].y); for (var i = 1; i < q.length; i++) g.lineTo(q[i].x, q[i].y); g.closePath(); }
  function worldQuad(x0, z0, x1, z1, y) { y = y || 0; return [project(x0, y, z0), project(x1, y, z0), project(x1, y, z1), project(x0, y, z1)]; }
  function circlePath(g, cx, cz, r, y, n) {
    g.beginPath();
    for (var i = 0; i <= n; i++) {
      var a = i / n * Math.PI * 2, p = project(cx + Math.cos(a) * r, y, cz + Math.sin(a) * r);
      if (i) g.lineTo(p.x, p.y); else g.moveTo(p.x, p.y);
    }
    g.closePath();
  }
  function ease(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
  function panOf(x) { return Math.max(-0.8, Math.min(0.8, x / 5)); }

  /* ================= the checkers =================
     A turned checker: a fluted rim, a top with two cut rings and a dimple, a lacquer
     sheen. Baked once per layout at the largest size it is ever drawn, then scaled. */
  var PAL = {
    red: { t0: "#ec6a4c", t1: "#b62a1d", t2: "#5e0f09", b0: "#d0412f", b1: "#82180f", b2: "#330604",
           groove: "rgba(64,6,2,0.55)", lo: "rgba(46,4,2,0.42)", hi: "rgba(255,176,146,0.20)", spec: "rgba(255,232,210,0.34)" },
    black: { t0: "#6a584b", t1: "#251d18", t2: "#090706", b0: "#4a3c33", b1: "#1b1512", b2: "#050404",
           groove: "rgba(0,0,0,0.62)", lo: "rgba(0,0,0,0.5)", hi: "rgba(255,222,184,0.13)", spec: "rgba(255,236,214,0.26)" }
  };
  var sprites = {}, shadowSp = null, spriteRef = 1;

  function buildSprites() {
    spriteRef = project(0, 0, 5.2).s;              /* the nearest a checker ever sits */
    var U = spriteRef * dpr;
    ["red", "black"].forEach(function (col) {
      sprites[col + "1"] = makeSprite(U, PAL[col], false, col);
      sprites[col + "2"] = makeSprite(U, PAL[col], true, col);
    });
    var R = PR * U, ry = R * SIN, sw = Math.ceil(R * 3.2), sh = Math.ceil(ry * 3.2);
    var c = document.createElement("canvas"); c.width = sw; c.height = sh;
    var g = c.getContext("2d");
    g.translate(sw / 2, sh / 2); g.scale(1, ry / R);
    var gr = g.createRadialGradient(0, 0, R * 0.4, 0, 0, R * 1.55);
    gr.addColorStop(0, "rgba(0,0,0,0.62)"); gr.addColorStop(0.55, "rgba(0,0,0,0.3)"); gr.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = gr; g.beginPath(); g.arc(0, 0, R * 1.6, 0, Math.PI * 2); g.fill();
    shadowSp = { cv: c, ax: sw / 2, ay: sh / 2 };
  }

  function makeSprite(U, pal, king, col) {
    var R = PR * U, ry = R * SIN, Hp = PH * U * COS, pad = Math.ceil(R * 0.12) + 2;
    var stack = king ? 2 : 1;
    var w = Math.ceil(2 * R + pad * 2), h = Math.ceil(2 * ry + Hp * stack + pad * 2);
    var c = document.createElement("canvas"); c.width = w; c.height = h;
    var g = c.getContext("2d");
    var cx = w / 2, by = h - pad - ry;
    disc(g, cx, by, R, Hp, pal, col, false);
    if (king) disc(g, cx, by - Hp, R, Hp, pal, col, true);
    return { cv: c, ax: cx, ay: by, U: U };
  }

  function disc(g, cx, by, R, Hp, pal, col, crown) {
    var ry = R * SIN, top = by - Hp;
    /* the rim */
    g.save();
    g.beginPath();
    g.moveTo(cx - R, top); g.lineTo(cx - R, by);
    g.ellipse(cx, by, R, ry, 0, Math.PI, 0, true);
    g.lineTo(cx + R, top);
    g.ellipse(cx, top, R, ry, 0, 0, Math.PI, false);
    g.closePath();
    var bg = g.createLinearGradient(cx - R, 0, cx + R, 0);
    bg.addColorStop(0, pal.b0); bg.addColorStop(0.42, pal.b1); bg.addColorStop(1, pal.b2);
    g.fillStyle = bg; g.fill();
    g.clip();
    /* fluting: the ridges that let a thumb grip it */
    var N = 26;
    for (var k = 0; k < N; k++) {
      var a = Math.PI * (k + 0.5) / N, x = cx - R * Math.cos(a), dy = ry * Math.sin(a);
      var lw = Math.max(0.6, R * Math.PI / N * 0.42 * Math.sin(a));
      g.strokeStyle = pal.lo; g.lineWidth = lw;
      g.beginPath(); g.moveTo(x, top + dy - 1); g.lineTo(x, by + dy + 1); g.stroke();
      g.strokeStyle = pal.hi; g.lineWidth = lw * 0.45;
      g.beginPath(); g.moveTo(x - lw * 0.7, top + dy - 1); g.lineTo(x - lw * 0.7, by + dy + 1); g.stroke();
    }
    var sh = g.createLinearGradient(0, top, 0, by + ry);
    sh.addColorStop(0, "rgba(0,0,0,0)"); sh.addColorStop(1, "rgba(0,0,0,0.38)");
    g.fillStyle = sh; g.fillRect(cx - R, top, 2 * R, Hp + ry * 2);
    g.restore();

    /* the face */
    g.save();
    g.beginPath(); g.ellipse(cx, top, R, ry, 0, 0, Math.PI * 2);
    var tg = g.createRadialGradient(cx - R * 0.38, top - ry * 0.4, R * 0.05, cx, top, R * 1.25);
    tg.addColorStop(0, pal.t0); tg.addColorStop(0.5, pal.t1); tg.addColorStop(1, pal.t2);
    g.fillStyle = tg; g.fill();
    g.clip();
    [0.84, 0.62].forEach(function (rr) {
      g.strokeStyle = pal.groove; g.lineWidth = Math.max(0.8, R * 0.038);
      g.beginPath(); g.ellipse(cx, top, R * rr, ry * rr, 0, 0, Math.PI * 2); g.stroke();
      g.strokeStyle = "rgba(255,232,206,0.12)"; g.lineWidth = Math.max(0.6, R * 0.02);
      g.beginPath(); g.ellipse(cx, top + R * 0.022, R * rr, ry * rr, 0, 0.15, Math.PI - 0.15); g.stroke();
    });
    var dg = g.createRadialGradient(cx, top, 0, cx, top, R * 0.2);
    dg.addColorStop(0, "rgba(0,0,0,0.32)"); dg.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = dg; g.beginPath(); g.ellipse(cx, top, R * 0.2, ry * 0.2, 0, 0, Math.PI * 2); g.fill();
    /* honest wear: a few hairline scuffs */
    var seed = col === "red" ? 3 : 7;
    for (var s = 0; s < 6; s++) {
      var a0 = srnd(seed * 11 + s) * Math.PI * 2, rr2 = R * (0.3 + srnd(seed * 13 + s) * 0.6);
      g.strokeStyle = "rgba(255,236,210," + (0.05 + srnd(seed + s) * 0.06) + ")"; g.lineWidth = 0.7;
      g.beginPath(); g.ellipse(cx, top, rr2, rr2 * SIN, 0, a0, a0 + 0.2 + srnd(s * 3 + seed) * 0.5); g.stroke();
    }
    var sp = g.createRadialGradient(cx - R * 0.4, top - ry * 0.45, 0, cx - R * 0.4, top - ry * 0.45, R * 0.6);
    sp.addColorStop(0, pal.spec); sp.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = sp; g.fillRect(cx - R, top - ry, 2 * R, 2 * ry);
    if (crown) crownMark(g, cx, top, R, ry, col);
    g.restore();

    /* the bevel: light catches the far-left lip, the near-right falls into shade */
    var bv = g.createLinearGradient(cx - R, top - ry, cx + R, top + ry);
    bv.addColorStop(0, "rgba(255,238,214,0.62)"); bv.addColorStop(0.5, "rgba(255,238,214,0.08)"); bv.addColorStop(1, "rgba(0,0,0,0.5)");
    g.strokeStyle = bv; g.lineWidth = Math.max(1, R * 0.05);
    g.beginPath(); g.ellipse(cx, top, R * 0.975, ry * 0.975, 0, 0, Math.PI * 2); g.stroke();
  }

  /* A king wears a crown pressed into its face and gilded, the way the good sets did. */
  function crownMark(g, cx, top, R, ry, col) {
    var s = R * 0.5, k = SIN;
    function P(u, v) { return [cx + u * s, top + v * s * k]; }
    var pts = [[-1, 0.55], [-1, -0.35], [-0.55, 0.12], [0, -0.68], [0.55, 0.12], [1, -0.35], [1, 0.55]];
    function path(dx, dy) {
      g.beginPath();
      pts.forEach(function (q, i) { var p = P(q[0], q[1]); if (i) g.lineTo(p[0] + dx, p[1] + dy); else g.moveTo(p[0] + dx, p[1] + dy); });
      g.closePath();
    }
    path(0, R * 0.03); g.fillStyle = "rgba(0,0,0,0.45)"; g.fill();
    path(0, 0);
    var gl = g.createLinearGradient(cx - s, top - s * k, cx + s, top + s * k);
    gl.addColorStop(0, "#fbe4a2"); gl.addColorStop(0.5, "#d9a64e"); gl.addColorStop(1, "#8a5a1c");
    g.fillStyle = gl; g.fill();
    g.strokeStyle = col === "red" ? "rgba(70,10,4,0.6)" : "rgba(0,0,0,0.6)"; g.lineWidth = Math.max(0.7, R * 0.02); g.stroke();
    [[-1, -0.35], [0, -0.68], [1, -0.35]].forEach(function (q) {
      var p = P(q[0], q[1] - 0.1);
      g.beginPath(); g.ellipse(p[0], p[1], s * 0.13, s * 0.13 * k, 0, 0, Math.PI * 2); g.fillStyle = "#f6d68c"; g.fill();
    });
    var band = P(-0.95, 0.4), band2 = P(0.95, 0.4);
    g.strokeStyle = "rgba(120,72,20,0.55)"; g.lineWidth = Math.max(0.6, R * 0.025);
    g.beginPath(); g.moveTo(band[0], band[1]); g.lineTo(band2[0], band2[1]); g.stroke();
  }

  function spriteKey(p) { return (sideOf(p) === BLACK ? "black" : "red") + Math.abs(p); }

  /* Draw a checker whose base sits at world (x, y, z). */
  function drawChecker(p, x, y, z, alpha, glow) {
    var b = project(x, y, z), sp = sprites[spriteKey(p)];
    var k = b.s / spriteRef / dpr;
    if (alpha != null) ctx.globalAlpha = alpha;
    if (glow) {
      ctx.save();
      ctx.shadowColor = glow; ctx.shadowBlur = 18 * b.s / spriteRef;
      ctx.drawImage(sp.cv, b.x - sp.ax * k, b.y - sp.ay * k, sp.cv.width * k, sp.cv.height * k);
      ctx.restore();
    }
    ctx.drawImage(sp.cv, b.x - sp.ax * k, b.y - sp.ay * k, sp.cv.width * k, sp.cv.height * k);
    ctx.globalAlpha = 1;
  }
  function drawShadow(x, y, z, alpha) {
    /* The lamp is up and to the left, so shadows fall away to the near right. */
    var lift = Math.max(0, y);
    var b = project(x + 0.06 + lift * 0.22, 0, z + 0.05 + lift * 0.16);
    var k = b.s / spriteRef / dpr * (1 + lift * 0.5);
    ctx.globalAlpha = (alpha == null ? 1 : alpha) * Math.max(0.25, 1 - lift * 0.6);
    ctx.drawImage(shadowSp.cv, b.x - shadowSp.ax * k, b.y - shadowSp.ay * k, shadowSp.cv.width * k, shadowSp.cv.height * k);
    ctx.globalAlpha = 1;
  }

  /* ================= the store ================= */
  function buildScene() {
    sceneCv = document.createElement("canvas");
    sceneCv.width = canvas.width; sceneCv.height = canvas.height;
    var g = sceneCv.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    var c0 = project(0, 0, 0), farY = project(0, 0, -4.7).y, boardW = project(4.7, 0, 0).x - project(-4.7, 0, 0).x;
    LAMP.x = c0.x - boardW * 0.08; LAMP.y = Math.min(farY - 30, H * 0.12);
    drawRoom(g, farY, boardW, c0);
    drawBarrel(g);
    drawBoard(g, boardW);
    /* lamplight pooled on the board, falling off into the room */
    var lp = project(-0.8, 0, -0.6);
    var pool = g.createRadialGradient(lp.x, lp.y, 0, lp.x, lp.y, boardW * 0.75);
    pool.addColorStop(0, "rgba(255,196,120,0.13)"); pool.addColorStop(1, "rgba(255,196,120,0)");
    g.globalCompositeOperation = "lighter"; g.fillStyle = pool; g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = "source-over";
    var vg = g.createRadialGradient(W / 2, c0.y, Math.min(W, H) * 0.3, W / 2, c0.y, Math.max(W, H) * 0.85);
    vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,0.62)");
    g.fillStyle = vg; g.fillRect(0, 0, W, H);
  }

  function drawRoom(g, farY, boardW, c0) {
    var bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#21150d"); bg.addColorStop(0.55, "#140c07"); bg.addColorStop(1, "#090604");
    g.fillStyle = bg; g.fillRect(0, 0, W, H);

    /* plank wall */
    var pw = Math.max(28, boardW * 0.085), n = Math.ceil(W / pw) + 1;
    for (var i = 0; i < n; i++) {
      var x = i * pw - (W % pw) / 2, tone = srnd(i * 3.3);
      g.fillStyle = "rgba(" + (70 + tone * 26 | 0) + "," + (44 + tone * 16 | 0) + "," + (26 + tone * 10 | 0) + ",0.32)";
      g.fillRect(x, 0, pw - 2, H);
      g.fillStyle = "rgba(0,0,0,0.5)"; g.fillRect(x + pw - 2, 0, 2, H);
      g.strokeStyle = "rgba(255,210,160,0.035)"; g.lineWidth = 1;
      for (var gl = 0; gl < 3; gl++) {
        var gx = x + pw * (0.2 + srnd(i * 7 + gl) * 0.6);
        g.beginPath(); g.moveTo(gx, 0);
        for (var yy = 0; yy <= H; yy += 40) g.lineTo(gx + Math.sin(yy * 0.02 + i + gl) * 2.5, yy);
        g.stroke();
      }
    }
    /* chair rail */
    var railY = Math.max(farY - 6, H * 0.36);
    g.fillStyle = "rgba(40,24,14,0.9)"; g.fillRect(0, railY, W, 7);
    g.fillStyle = "rgba(255,206,150,0.08)"; g.fillRect(0, railY, W, 1);

    /* shelves of stock, above the board, softly out of focus */
    var room = railY - 24;
    var shelves = room > 220 ? [room * 0.36, room * 0.82] : room > 110 ? [room * 0.72] : [];
    shelves.forEach(function (sy, si) { shelf(g, sy, si, boardW); });

    /* the stove, if there is room to its left */
    var stx = c0.x - boardW * 0.66, sty = project(0, 0, -1).y, sr = boardW * 0.13;
    STOVE.on = stx + sr > -sr * 0.2;
    STOVE.x = stx; STOVE.y = sty; STOVE.r = sr;
    var warm = g.createRadialGradient(stx, sty, 0, stx, sty, boardW * 0.9);
    warm.addColorStop(0, "rgba(255,120,40,0.22)"); warm.addColorStop(1, "rgba(255,120,40,0)");
    g.globalCompositeOperation = "lighter"; g.fillStyle = warm; g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = "source-over";
    if (STOVE.on) stove(g, stx, sty, sr);

    /* the lamp overhead */
    var lw2 = g.createRadialGradient(LAMP.x, LAMP.y, 0, LAMP.x, LAMP.y, boardW * 0.7);
    lw2.addColorStop(0, "rgba(255,206,130,0.30)"); lw2.addColorStop(0.4, "rgba(255,190,110,0.08)"); lw2.addColorStop(1, "rgba(255,190,110,0)");
    g.globalCompositeOperation = "lighter"; g.fillStyle = lw2; g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = "source-over";
    lamp(g, LAMP.x, LAMP.y, boardW);
  }

  function shelf(g, sy, si, boardW) {
    var x = 6, k = 0, unit = Math.max(16, boardW * 0.042);
    while (x < W - 6) {
      var t = srnd(si * 101 + k * 7), wd = unit * (0.8 + srnd(si * 31 + k) * 0.9), ht;
      var kind = t < 0.35 ? "jar" : t < 0.6 ? "tin" : t < 0.8 ? "bottle" : "box";
      ht = unit * (kind === "bottle" ? 2.3 : kind === "jar" ? 1.7 : kind === "tin" ? 1.25 : 1.1) * (0.85 + srnd(k * 3 + si) * 0.3);
      if (kind === "bottle") wd *= 0.55;
      var hue = srnd(k * 13 + si * 5);
      if (kind === "jar") {
        g.fillStyle = hue < 0.4 ? "rgba(190,128,54,0.42)" : hue < 0.7 ? "rgba(96,128,84,0.4)" : "rgba(196,184,160,0.22)";
        rrect(g, x, sy - ht, wd, ht, wd * 0.22); g.fill();
        g.fillStyle = "rgba(40,30,20,0.6)"; g.fillRect(x + wd * 0.1, sy - ht * 0.62, wd * 0.8, ht * 0.5);
        g.fillStyle = "rgba(150,120,80,0.55)"; g.fillRect(x + wd * 0.12, sy - ht - unit * 0.18, wd * 0.76, unit * 0.2);
        g.fillStyle = "rgba(255,236,200,0.16)"; g.fillRect(x + wd * 0.16, sy - ht * 0.9, wd * 0.08, ht * 0.7);
      } else if (kind === "tin") {
        g.fillStyle = "rgba(60,50,44,0.85)"; g.fillRect(x, sy - ht, wd, ht);
        g.fillStyle = hue < 0.33 ? "rgba(150,52,38,0.75)" : hue < 0.66 ? "rgba(58,82,120,0.7)" : "rgba(186,160,96,0.7)";
        g.fillRect(x, sy - ht * 0.72, wd, ht * 0.44);
        g.fillStyle = "rgba(255,236,200,0.12)"; g.fillRect(x + wd * 0.12, sy - ht, wd * 0.08, ht);
      } else if (kind === "bottle") {
        g.fillStyle = hue < 0.5 ? "rgba(70,96,60,0.6)" : "rgba(120,62,30,0.6)";
        rrect(g, x, sy - ht * 0.68, wd, ht * 0.68, wd * 0.3); g.fill();
        g.fillRect(x + wd * 0.32, sy - ht, wd * 0.36, ht * 0.36);
        g.fillStyle = "rgba(255,236,200,0.16)"; g.fillRect(x + wd * 0.18, sy - ht * 0.62, wd * 0.12, ht * 0.5);
      } else {
        g.fillStyle = hue < 0.5 ? "rgba(150,118,76,0.62)" : "rgba(110,86,60,0.62)"; g.fillRect(x, sy - ht, wd, ht);
        g.strokeStyle = "rgba(0,0,0,0.3)"; g.strokeRect(x + 0.5, sy - ht + 0.5, wd - 1, ht - 1);
      }
      x += wd + unit * (0.12 + srnd(k * 17 + si) * 0.5);
      k++;
    }
    var bd = g.createLinearGradient(0, sy, 0, sy + 12);
    bd.addColorStop(0, "#4a2f1b"); bd.addColorStop(1, "#24160c");
    g.fillStyle = bd; g.fillRect(0, sy, W, 10);
    g.fillStyle = "rgba(255,214,160,0.12)"; g.fillRect(0, sy, W, 1);
    var sd = g.createLinearGradient(0, sy + 10, 0, sy + 30);
    sd.addColorStop(0, "rgba(0,0,0,0.45)"); sd.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = sd; g.fillRect(0, sy + 10, W, 20);
    /* push the stock back into the room */
    g.fillStyle = "rgba(20,12,7,0.26)"; g.fillRect(0, sy - unit * 2.6, W, unit * 2.6);
  }

  function rrect(g, x, y, w, h, r) {
    g.beginPath(); g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
    g.lineTo(x + w, y + h); g.lineTo(x, y + h); g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y); g.closePath();
  }

  function stove(g, x, y, r) {
    /* pipe */
    g.fillStyle = "#0f0b09"; g.fillRect(x - r * 0.18, -10, r * 0.36, y - r * 0.9 + 10);
    g.fillStyle = "rgba(255,190,120,0.07)"; g.fillRect(x - r * 0.16, -10, r * 0.05, y - r * 0.9 + 10);
    /* belly */
    var bg = g.createRadialGradient(x + r * 0.35, y - r * 0.3, r * 0.1, x, y, r * 1.1);
    bg.addColorStop(0, "#3a2c24"); bg.addColorStop(0.5, "#17110e"); bg.addColorStop(1, "#070505");
    g.fillStyle = bg;
    g.beginPath(); g.ellipse(x, y, r * 0.82, r, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#0c0908"; g.fillRect(x - r * 0.62, y - r * 1.06, r * 1.24, r * 0.16);
    g.fillRect(x - r * 0.7, y + r * 0.86, r * 1.4, r * 0.14);
    g.fillStyle = "rgba(255,180,110,0.12)"; g.fillRect(x - r * 0.62, y - r * 1.06, r * 1.24, 1.5);
    /* the door glow is drawn live; here, its iron frame */
    g.strokeStyle = "#1c1410"; g.lineWidth = Math.max(2, r * 0.06);
    g.beginPath(); g.ellipse(x + r * 0.05, y + r * 0.18, r * 0.36, r * 0.3, 0, 0, Math.PI * 2); g.stroke();
  }

  function lamp(g, x, y, boardW) {
    var s = boardW * 0.045;
    g.strokeStyle = "rgba(20,14,10,0.9)"; g.lineWidth = 1.2;
    g.beginPath(); g.moveTo(x, -4); g.lineTo(x, y - s * 1.6); g.stroke();
    var ch = g.createLinearGradient(x - s * 0.5, 0, x + s * 0.5, 0);
    ch.addColorStop(0, "rgba(255,226,170,0.55)"); ch.addColorStop(0.5, "rgba(255,240,206,0.9)"); ch.addColorStop(1, "rgba(255,210,150,0.45)");
    g.fillStyle = ch;
    g.beginPath(); g.ellipse(x, y - s * 0.4, s * 0.42, s * 0.85, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#6a4a22"; g.beginPath(); g.ellipse(x, y + s * 0.55, s * 0.6, s * 0.28, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = "rgba(255,214,140,0.5)"; g.beginPath(); g.ellipse(x - s * 0.15, y + s * 0.48, s * 0.25, s * 0.08, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#3e2a14"; g.fillRect(x - s * 0.5, y - s * 1.45, s, s * 0.22);
  }

  /* The barrel: a pine head of five boards inside an iron hoop, oak staves below. */
  var HEAD_R = 6.1, HEAD_Y = -0.18;
  function drawBarrel(g) {
    /* staves, front half only, bulging as they go down */
    var steps = 26, ys = [HEAD_Y, -1.2, -2.6, -4.2, -6.5, -9.5];
    function rad(y) { var t = (HEAD_Y - y) / 8; return HEAD_R + Math.sin(Math.min(1, t) * Math.PI * 0.5) * 0.9; }
    for (var i = 0; i < steps; i++) {
      var a0 = i / steps * Math.PI, a1 = (i + 1) / steps * Math.PI;
      g.beginPath();
      ys.forEach(function (y, k) { var p = project(Math.cos(a0) * rad(y), y, Math.sin(a0) * rad(y)); if (k) g.lineTo(p.x, p.y); else g.moveTo(p.x, p.y); });
      for (var k2 = ys.length - 1; k2 >= 0; k2--) { var y2 = ys[k2], q = project(Math.cos(a1) * rad(y2), y2, Math.sin(a1) * rad(y2)); g.lineTo(q.x, q.y); }
      g.closePath();
      var mid = (a0 + a1) / 2, lit = 0.3 + 0.7 * Math.max(0, Math.cos(mid - 2.1)), tone = srnd(i * 5.1) * 0.15;
      g.fillStyle = "rgb(" + ((70 + 60 * lit) * (1 - tone) | 0) + "," + ((40 + 34 * lit) * (1 - tone) | 0) + "," + ((22 + 18 * lit) * (1 - tone) | 0) + ")";
      g.fill();
      g.strokeStyle = "rgba(0,0,0,0.45)"; g.lineWidth = 1; g.stroke();
    }
    /* hoops */
    [[-0.45, 0.22], [-2.9, 0.3]].forEach(function (hp) {
      var y0 = hp[0], y1 = hp[0] - hp[1];
      g.beginPath();
      for (var j = 0; j <= 40; j++) { var a = j / 40 * Math.PI, p = project(Math.cos(a) * (rad(y0) + 0.04), y0, Math.sin(a) * (rad(y0) + 0.04)); if (j) g.lineTo(p.x, p.y); else g.moveTo(p.x, p.y); }
      for (var j2 = 40; j2 >= 0; j2--) { var a2 = j2 / 40 * Math.PI, p2 = project(Math.cos(a2) * (rad(y1) + 0.04), y1, Math.sin(a2) * (rad(y1) + 0.04)); g.lineTo(p2.x, p2.y); }
      g.closePath();
      var hg = g.createLinearGradient(0, project(0, y0, HEAD_R).y, 0, project(0, y1, HEAD_R).y);
      hg.addColorStop(0, "#3b3530"); hg.addColorStop(0.4, "#1b1715"); hg.addColorStop(1, "#0b0a09");
      g.fillStyle = hg; g.fill();
      for (var rv = 1; rv < 12; rv++) {
        var ra = rv / 12 * Math.PI, rp = project(Math.cos(ra) * (rad(y0) + 0.05), (y0 + y1) / 2, Math.sin(ra) * (rad(y0) + 0.05));
        g.fillStyle = "rgba(255,220,180,0.22)"; g.beginPath(); g.arc(rp.x, rp.y, Math.max(1, rp.s * 0.03), 0, Math.PI * 2); g.fill();
      }
    });
    /* the head */
    g.save();
    circlePath(g, 0, 0, HEAD_R, HEAD_Y, 72); g.clip();
    var boards = 5, bw = HEAD_R * 2 / boards;
    for (var b = 0; b < boards; b++) {
      var x0 = -HEAD_R + b * bw, tone2 = srnd(b * 9.7);
      var q2 = worldQuad(x0, -HEAD_R, x0 + bw, HEAD_R, HEAD_Y);
      quadPath(g, q2);
      g.fillStyle = "rgb(" + (120 + tone2 * 30 | 0) + "," + (82 + tone2 * 18 | 0) + "," + (48 + tone2 * 10 | 0) + ")"; g.fill();
      g.strokeStyle = "rgba(60,34,16,0.35)"; g.lineWidth = 1;
      for (var gr = 0; gr < 7; gr++) {
        var gx = x0 + bw * (0.1 + srnd(b * 19 + gr) * 0.8);
        g.beginPath();
        for (var zz = -HEAD_R; zz <= HEAD_R; zz += 0.5) {
          var p3 = project(gx + Math.sin(zz * 0.7 + gr) * 0.05, HEAD_Y, zz);
          if (zz === -HEAD_R) g.moveTo(p3.x, p3.y); else g.lineTo(p3.x, p3.y);
        }
        g.stroke();
      }
      quadPath(g, [project(x0, HEAD_Y, -HEAD_R), project(x0 + 0.02, HEAD_Y, -HEAD_R), project(x0 + 0.02, HEAD_Y, HEAD_R), project(x0, HEAD_Y, HEAD_R)]);
      g.fillStyle = "rgba(20,10,4,0.7)"; g.fill();
    }
    var shade = g.createRadialGradient(project(-1, HEAD_Y, -1).x, project(-1, HEAD_Y, -1).y, 0, project(0, HEAD_Y, 0).x, project(0, HEAD_Y, 0).y, project(HEAD_R, HEAD_Y, 0).x - project(0, HEAD_Y, 0).x);
    shade.addColorStop(0, "rgba(0,0,0,0)"); shade.addColorStop(0.7, "rgba(0,0,0,0.25)"); shade.addColorStop(1, "rgba(0,0,0,0.6)");
    g.fillStyle = shade; g.fillRect(0, 0, W, H);
    g.restore();
    /* the chime: the head's worn top edge, then the hoop that binds it */
    circlePath(g, 0, 0, HEAD_R, HEAD_Y, 72);
    g.strokeStyle = "rgba(210,160,110,0.5)"; g.lineWidth = Math.max(1.5, project(0, 0, 0).s * 0.05); g.stroke();
    circlePath(g, 0, 0, HEAD_R + 0.12, HEAD_Y - 0.05, 72);
    g.strokeStyle = "rgba(14,12,11,0.95)"; g.lineWidth = Math.max(2, project(0, 0, 0).s * 0.11); g.stroke();
  }

  /* The board: a slab of painted pine. Mustard and green, an oxblood border with a
     cream pinstripe, the paint rubbed through where forty years of hands slid
     checkers across the dark squares. */
  var SQ_LIGHT = [205, 172, 108], SQ_DARK = [42, 66, 48];
  function drawBoard(g, boardW) {
    var E = 4.62, T = 0.2;
    /* shadow on the barrel head */
    g.save();
    g.shadowColor = "rgba(0,0,0,0.7)"; g.shadowBlur = boardW * 0.05; g.shadowOffsetX = boardW * 0.012; g.shadowOffsetY = boardW * 0.02;
    quadPath(g, worldQuad(-E, -E, E, E, HEAD_Y + 0.01)); g.fillStyle = "#000"; g.fill();
    g.restore();
    /* the slab's near face */
    var f = [project(-E, 0, E), project(E, 0, E), project(E, -T, E), project(-E, -T, E)];
    quadPath(g, f);
    var fg = g.createLinearGradient(0, f[0].y, 0, f[2].y);
    fg.addColorStop(0, "#5c2016"); fg.addColorStop(1, "#2a0d08");
    g.fillStyle = fg; g.fill();
    /* top: the oxblood frame */
    quadPath(g, worldQuad(-E, -E, E, E));
    g.fillStyle = "#5e1b13"; g.fill();
    paintTexture(g, worldQuad(-E, -E, E, E), 900, [94, 27, 19], 7);
    /* rubbed corners showing the pine underneath */
    [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(function (cn, i) {
      var p = project(cn[0] * (E - 0.18), 0, cn[1] * (E - 0.18));
      var wr = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.s * 0.42);
      wr.addColorStop(0, "rgba(176,128,78,0.55)"); wr.addColorStop(1, "rgba(176,128,78,0)");
      g.fillStyle = wr; g.beginPath(); g.ellipse(p.x, p.y, p.s * 0.42, p.s * 0.42 * SIN, 0, 0, Math.PI * 2); g.fill();
    });
    /* pinstripe */
    quadPath(g, worldQuad(-4.24, -4.24, 4.24, 4.24));
    g.strokeStyle = "rgba(236,212,160,0.6)"; g.lineWidth = Math.max(1, project(0, 0, 0).s * 0.028); g.stroke();
    /* folk diamonds at the corners */
    [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(function (cn) {
      var cx = cn[0] * 4.4, cz = cn[1] * 4.4, d = 0.13;
      quadPath(g, [project(cx, 0, cz - d), project(cx + d, 0, cz), project(cx, 0, cz + d), project(cx - d, 0, cz)]);
      g.fillStyle = "rgba(236,212,160,0.7)"; g.fill();
    });
    lettering(g, "CHECKERS", 0, 4.42, 0.24);
    /* the squares */
    for (var i = 0; i < squares.length; i++) {
      var s = squares[i], dark = ((s.r + s.c) & 1) === 1, base = dark ? SQ_DARK : SQ_LIGHT;
      var v = (srnd(i * 4.7) - 0.5) * (dark ? 8 : 14);
      quadPath(g, s.quad);
      g.fillStyle = "rgb(" + (base[0] + v | 0) + "," + (base[1] + v | 0) + "," + (base[2] + v * 0.6 | 0) + ")"; g.fill();
      paintTexture(g, s.quad, 70, base, i * 13 + 1);
      if (dark) {
        /* worn through in the middle, where checkers live */
        var c = s.ctr;
        var wear = g.createRadialGradient(c.x, c.y, 0, c.x, c.y, c.s * 0.46);
        wear.addColorStop(0, "rgba(120,104,70," + (0.10 + srnd(i) * 0.12) + ")"); wear.addColorStop(1, "rgba(120,104,70,0)");
        g.save(); quadPath(g, s.quad); g.clip();
        g.fillStyle = wear; g.beginPath(); g.ellipse(c.x, c.y, c.s * 0.46, c.s * 0.46 * SIN, 0, 0, Math.PI * 2); g.fill();
        g.restore();
      }
    }
    g.strokeStyle = "rgba(20,12,6,0.32)"; g.lineWidth = 0.7;
    for (var j = 0; j < squares.length; j++) { quadPath(g, squares[j].quad); g.stroke(); }
    quadPath(g, worldQuad(-4, -4, 4, 4));
    g.strokeStyle = "rgba(20,8,4,0.7)"; g.lineWidth = Math.max(1.2, project(0, 0, 0).s * 0.03); g.stroke();
    /* the near lip catches the lamp */
    g.strokeStyle = "rgba(255,206,150,0.22)"; g.lineWidth = 1;
    g.beginPath(); g.moveTo(f[0].x, f[0].y); g.lineTo(f[1].x, f[1].y); g.stroke();
  }

  /* Brushed paint: short strokes a shade either side of the base color. */
  function paintTexture(g, quad, n, base, seed) {
    g.save(); quadPath(g, quad); g.clip();
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    quad.forEach(function (p) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); });
    for (var k = 0; k < n; k++) {
      var x = minX + srnd(seed * 7 + k * 1.3) * (maxX - minX), y = minY + srnd(seed * 11 + k * 2.1) * (maxY - minY);
      var len = 3 + srnd(seed + k * 3.7) * 9, up = srnd(seed * 3 + k) > 0.5;
      g.strokeStyle = up ? "rgba(255,236,200,0.05)" : "rgba(0,0,0,0.07)";
      g.lineWidth = 1 + srnd(k + seed) * 1.5;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + len, y + (srnd(k * 5 + seed) - 0.5) * 2); g.stroke();
    }
    g.restore();
  }

  /* Sign-painted letters laid flat on the frame, so they foreshorten with it. */
  function lettering(g, text, x, z, size) {
    var o = project(x, 0, z), ax = project(x + 1, 0, z), az = project(x, 0, z + 1);
    g.save();
    g.setTransform(dpr * (ax.x - o.x) / 100, dpr * (ax.y - o.y) / 100, dpr * (az.x - o.x) / 100, dpr * (az.y - o.y) / 100, dpr * o.x, dpr * o.y);
    g.font = (size * 100 | 0) + "px 'Alfa Slab One', Georgia, serif";
    g.textAlign = "center"; g.textBaseline = "middle";
    if (g.letterSpacing !== undefined) g.letterSpacing = (size * 40 | 0) + "px";
    g.fillStyle = "rgba(0,0,0,0.35)"; g.fillText(text, 1.5, 2.5);
    g.fillStyle = "rgba(236,212,160,0.74)"; g.fillText(text, 0, 0);
    g.restore();
  }

  /* ================= per-frame drawing ================= */
  var flick = 0.5, flickT = 0, frameT = 0;
  function draw(now) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (sceneCv) ctx.drawImage(sceneCv, 0, 0, sceneCv.width, sceneCv.height, 0, 0, W, H);
    stoveLight(now);
    drawMarks(now);
    drawStacks();
    drawCheckers(now);
    drawParticles();
    drawMotes();
  }

  function stoveLight(now) {
    if (!reduced()) {
      flickT += 1;
      if (flickT % 3 === 0) flick += (Math.random() - 0.5) * 0.35;
      flick = Math.max(0.2, Math.min(1, flick * 0.96 + 0.6 * 0.04));
    }
    var x = STOVE.x, y = STOVE.y, r = STOVE.r;
    if (STOVE.on) {
      /* the fire seen through the door's grate: embers low, flame licking up */
      var dx = x + r * 0.05, dy = y + r * 0.18, rx = r * 0.33, ry2 = r * 0.27;
      ctx.save();
      ctx.beginPath(); ctx.ellipse(dx, dy, rx, ry2, 0, 0, Math.PI * 2); ctx.clip();
      ctx.fillStyle = "#1a0703"; ctx.fillRect(dx - rx, dy - ry2, rx * 2, ry2 * 2);
      var em = ctx.createRadialGradient(dx, dy + ry2 * 0.7, 0, dx, dy + ry2 * 0.5, rx * 1.1);
      em.addColorStop(0, "rgba(255,214,120," + (0.7 + flick * 0.3) + ")");
      em.addColorStop(0.35, "rgba(240,110,30," + (0.6 + flick * 0.3) + ")");
      em.addColorStop(1, "rgba(90,20,4,0.2)");
      ctx.fillStyle = em; ctx.fillRect(dx - rx, dy - ry2, rx * 2, ry2 * 2);
      ctx.strokeStyle = "rgba(14,8,6,0.95)"; ctx.lineWidth = Math.max(1.5, r * 0.035);
      for (var gb = -3; gb <= 3; gb++) { ctx.beginPath(); ctx.moveTo(dx + gb * rx * 0.27, dy - ry2); ctx.lineTo(dx + gb * rx * 0.27, dy + ry2); ctx.stroke(); }
      ctx.beginPath(); ctx.moveTo(dx - rx, dy); ctx.lineTo(dx + rx, dy); ctx.stroke();
      ctx.restore();
    }
    var spill = ctx.createRadialGradient(x, y, 0, x, y, r * 7);
    spill.addColorStop(0, "rgba(255,120,40," + (0.05 + flick * 0.07) + ")"); spill.addColorStop(1, "rgba(255,120,40,0)");
    ctx.globalCompositeOperation = "lighter"; ctx.fillStyle = spill; ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = "source-over";
  }

  function fillSq(sq, color) { var c = cellOf(sq); if (!c) return; quadPath(ctx, c.quad); ctx.fillStyle = color; ctx.fill(); }
  function ring(sq, rad, color, width, y) {
    var w0 = sqWorld(sq), p = project(w0.x, y || 0, w0.z);
    ctx.strokeStyle = color; ctx.lineWidth = width;
    ctx.beginPath(); ctx.ellipse(p.x, p.y, p.s * rad, p.s * rad * SIN, 0, 0, Math.PI * 2); ctx.stroke();
  }

  function drawMarks(now) {
    var t = now / 1000;
    if (lastMove && !replay) {
      fillSq(lastMove.from, "rgba(242,207,134,0.12)");
      lastMove.path.forEach(function (s) { fillSq(s, "rgba(242,207,134,0.16)"); });
    }
    if (replay && replay.k > 0) {
      var rm = history[replay.k - 1].m;
      fillSq(rm.from, "rgba(242,207,134,0.12)");
      rm.path.forEach(function (s) { fillSq(s, "rgba(242,207,134,0.18)"); });
    }
    if (shakeT > 0 && shakeSq >= 0) fillSq(shakeSq, "rgba(214,64,48," + (shakeT * 0.32) + ")");
    if (!replay && started && !gameOver && pos.turn === player && !thinking) {
      /* when a jump is compulsory, the pieces that can make it glow until you do */
      var ms = legal();
      if (forced && ms.length && ms[0].caps.length && sel < 0) {
        var from = {};
        ms.forEach(function (m) { from[m.from] = 1; });
        var a = 0.35 + 0.3 * Math.sin(t * 4) + mustT * 0.4;
        Object.keys(from).forEach(function (s) { ring(+s, 0.47, "rgba(255,186,90," + Math.min(1, a) + ")", 2.2, 0.01); });
      }
    }
    if (sel >= 0) {
      var at = inJump ? prefix[prefix.length - 1] : sel;
      fillSq(at, "rgba(242,207,134,0.22)");
      targets().forEach(function (s) {
        var cap = cands.some(function (m) { return m.caps.length; });
        var w0 = sqWorld(s), p = project(w0.x, 0, w0.z);
        ctx.fillStyle = cap ? "rgba(255,150,96,0.32)" : "rgba(255,226,170,0.28)";
        ctx.beginPath(); ctx.ellipse(p.x, p.y, p.s * 0.16, p.s * 0.16 * SIN, 0, 0, Math.PI * 2); ctx.fill();
        ring(s, 0.3 + 0.03 * Math.sin(t * 5), cap ? "rgba(255,150,96,0.75)" : "rgba(255,226,170,0.6)", 1.6);
      });
    }
    if (hintMove && !replay) {
      var pts = [hintMove.from].concat(hintMove.path).map(function (s) { var w0 = sqWorld(s); return project(w0.x, 0.02, w0.z); });
      ctx.save();
      ctx.strokeStyle = "rgba(255,236,190,0.85)"; ctx.lineWidth = Math.max(2, pts[0].s * 0.07); ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.setLineDash([pts[0].s * 0.14, pts[0].s * 0.12]); ctx.lineDashOffset = -t * 30;
      ctx.beginPath(); pts.forEach(function (p, i) { if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); }); ctx.stroke();
      ctx.restore();
      ring(hintMove.from, 0.46, "rgba(255,236,190,0.9)", 2);
      ring(K.last(hintMove), 0.32, "rgba(255,236,190,0.9)", 2);
    }
    if (cursor >= 0 && !drag) {
      var cc = squares[cursor];
      ctx.save(); quadPath(ctx, cc.quad);
      ctx.strokeStyle = "rgba(255,236,190,0.9)"; ctx.lineWidth = 2; ctx.setLineDash([5, 4]); ctx.stroke(); ctx.restore();
    }
  }

  /* Captured checkers stack on the barrel head: yours at the near right, theirs
     at the far left, the way two people actually keep them. */
  function stackSpot(who, i) {
    var col = Math.floor(i / 5), h = i % 5;
    return who === "mine" ? { x: 2.15 + col * 0.92, z: 5.06, y: h * PH } : { x: -2.15 - col * 0.92, z: -5.06, y: h * PH };
  }
  function stackColor(who) { var mineCol = player === BLACK ? 1 : -1; return who === "mine" ? -mineCol : mineCol; }
  function shownStacks() { return replay ? stackHist[replay.k] : stacks; }
  function drawStacks() {
    var st = shownStacks();
    ["theirs", "mine"].forEach(function (who) {
      var n = st[who], p = stackColor(who);
      for (var c = 0; c * 5 < n; c++) {
        var base = stackSpot(who, c * 5);
        drawShadow(base.x, 0, base.z, 0.9);
        for (var h = 0; h < 5 && c * 5 + h < n; h++) drawChecker(p, base.x, h * PH, base.z);
      }
    });
  }

  function drawCheckers(now) {
    var b = board(), items = [];
    for (var i = 0; i < 32; i++) {
      if (!b[i] || view.hide[i]) continue;
      var w0 = sqWorld(i);
      items.push({ p: b[i], x: w0.x, y: 0, z: w0.z, sq: i });
    }
    if (view.mover) items.push({ p: view.mover.p, x: view.mover.x, y: view.mover.y, z: view.mover.z, top: !!drag, sq: -2 });
    flyers.forEach(function (f) { items.push({ p: f.p, x: f.x, y: f.y, z: f.z, sq: -3 }); });
    items.sort(function (a, c) { return (a.top ? 1 : 0) - (c.top ? 1 : 0) || a.z - c.z; });
    items.forEach(function (it) { drawShadow(it.x, it.y, it.z); });
    var selAt = sel >= 0 && !inJump ? sel : -1;
    items.forEach(function (it) {
      var lift = it.y;
      if (it.sq === selAt && !view.mover) lift = 0.08 + 0.02 * Math.sin(now / 220);
      drawChecker(it.p, it.x, lift, it.z, null, it.sq === selAt ? "rgba(255,214,140,0.7)" : null);
    });
  }

  function drawParticles() {
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      ctx.fillStyle = p.c.replace("A", String(Math.max(0, p.life)));
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
    }
  }

  function seedMotes() {
    motes = [];
    for (var i = 0; i < 26; i++) motes.push({ x: Math.random(), y: Math.random(), v: 0.02 + Math.random() * 0.05, a: Math.random() * 6.28, r: 0.6 + Math.random() * 1.4 });
  }
  function drawMotes() {
    if (reduced()) return;
    for (var i = 0; i < motes.length; i++) {
      var m = motes[i];
      var x = LAMP.x + (m.x - 0.5) * W * 0.55, y = LAMP.y + m.y * H * 0.7;
      var a = 0.12 * Math.sin(m.y * Math.PI) * (0.6 + 0.4 * Math.sin(m.a));
      ctx.fillStyle = "rgba(255,226,170," + a + ")";
      ctx.beginPath(); ctx.arc(x, y, m.r, 0, Math.PI * 2); ctx.fill();
    }
  }

  function burst(x, z, y, kind) {
    var p = project(x, y || 0, z), n = kind === "crown" ? 26 : 10;
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2, sp = (kind === "crown" ? 1.2 : 0.7) + Math.random() * 2;
      particles.push({ x: p.x, y: p.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * SIN - (kind === "crown" ? 1.6 : 0.8),
        r: kind === "crown" ? 1.2 + Math.random() * 2 : 0.8 + Math.random() * 1.4, life: 1,
        c: kind === "crown" ? "rgba(255,214,120,A)" : "rgba(214,176,120,A)" });
    }
  }

  /* ================= motion ================= */
  var dirty = true, lastT = performance.now();
  function tick(now) {
    var dt = Math.min(48, now - lastT); lastT = now;
    var r = reduced();
    if (hop) {
      hop.t += dt / hop.dur;
      var t = Math.min(1, hop.t), e = ease(t);
      view.mover.x = hop.a.x + (hop.b.x - hop.a.x) * e;
      view.mover.z = hop.a.z + (hop.b.z - hop.a.z) * e;
      view.mover.y = hop.jump ? Math.sin(Math.PI * t) * 0.7 : Math.sin(Math.PI * t) * 0.06;
      if (hop.t >= 1) endHop();
    }
    for (var i = flyers.length - 1; i >= 0; i--) {
      var f = flyers[i];
      f.t += dt / f.dur;
      var u = Math.min(1, f.t), eu = ease(u);
      f.x = f.a.x + (f.b.x - f.a.x) * eu; f.z = f.a.z + (f.b.z - f.a.z) * eu;
      f.y = f.a.y + (f.b.y - f.a.y) * eu + Math.sin(Math.PI * u) * f.arc;
      if (f.t >= 1) { flyers.splice(i, 1); f.land && f.land(); }
    }
    for (var j = particles.length - 1; j >= 0; j--) {
      var p = particles[j];
      p.x += p.vx; p.y += p.vy; p.vy += 0.07; p.life -= dt / 900;
      if (p.life <= 0) particles.splice(j, 1);
    }
    if (!r) for (var k = 0; k < motes.length; k++) {
      var m = motes[k]; m.y -= m.v * dt / 1000 * 0.4; m.a += dt / 1400; m.x += Math.sin(m.a) * 0.0004;
      if (m.y < 0) { m.y = 1; m.x = Math.random(); }
    }
    if (shakeT > 0) shakeT = Math.max(0, shakeT - dt / 420);
    if (mustT > 0) mustT = Math.max(0, mustT - dt / 900);
    if (replay && replay.playing && !replay.busy && now > replay.next) stepReplay(1);
    draw(now);
    requestAnimationFrame(tick);
  }

  /* A move is played as a queue of hops: slides for plain moves, arcs for jumps.
     The jumped checker leaves at the top of the arc and lands on the capturer's
     stack, which is when it is counted. */
  function queueHops(piece, fromSq, m, startAt, onDone) {
    if (!view.mover) {
      var w0 = sqWorld(fromSq);
      view.mover = { p: piece, x: w0.x, y: 0, z: w0.z };
      view.hide[fromSq] = 1;
    }
    var pts = [fromSq].concat(m.path);
    for (var i = startAt || 0; i < m.path.length; i++) {
      hopQ.push({ aSq: pts[i], bSq: pts[i + 1], cap: m.caps.length ? m.caps[i] : -1, capturer: sideOf(piece) });
    }
    afterHops = onDone;
    if (!hop) nextHop();
  }
  function nextHop() {
    var h = hopQ.shift();
    if (!h) { hop = null; var d = afterHops; afterHops = null; if (d) d(); return; }
    var a = h.from || { x: view.mover.x, z: view.mover.z }, b = sqWorld(h.bSq);
    hop = { a: a, b: b, bSq: h.bSq, cap: h.cap, capturer: h.capturer, jump: h.cap >= 0, t: 0 };
    hop.dur = reduced() ? 1 : hop.jump ? 320 : 240;
    if (!hop.jump) A.scrape(hop.dur / 1000, panOf(b.x));
  }
  function endHop() {
    var h = hop;
    view.mover.x = h.b.x; view.mover.z = h.b.z; view.mover.y = 0;
    A.place(h.jump ? 1.05 : 1, panOf(h.b.x));
    if (h.jump) {
      var b = board(), victim = b[h.cap];
      view.hide[h.cap] = 1;
      launchCapture(victim, h.cap, h.capturer);
    }
    hop = null;
    nextHop();
  }
  function launchCapture(p, sq, capturer) {
    var who = capturer === player ? "mine" : "theirs";
    var st = shownStacks(), slot = st[who] + pendingFlyers(who);
    var w0 = sqWorld(sq), to = stackSpot(who, slot);
    burst(w0.x, w0.z, 0.1, "chip");
    flyers.push({ p: sideOf(p), a: { x: w0.x, y: 0, z: w0.z }, b: to, x: w0.x, y: 0, z: w0.z, t: 0,
      dur: reduced() ? 1 : 520, arc: 1.4, who: who, discs: discsOf(p),
      land: function () { st[who] += discsOf(p); A.stack(1, panOf(to.x)); } });
  }
  function pendingFlyers(who) { var n = 0; flyers.forEach(function (f) { if (f.who === who) n += f.discs || 0; }); return n; }

  /* Crowning: the other side hands you one of your own captured checkers to stack
     on top. If they have none, one comes down from the box. */
  function crownAnim(sq, side, onDone) {
    var who = side === player ? "theirs" : "mine";
    var st = shownStacks(), w0 = sqWorld(sq), from;
    if (st[who] > 0) { from = stackSpot(who, st[who] - 1); st[who] -= 1; }
    else from = { x: w0.x, y: 2.4, z: w0.z - 0.3 };
    flyers.push({ p: side, a: { x: from.x, y: from.y, z: from.z }, b: { x: w0.x, y: PH, z: w0.z }, x: from.x, y: from.y, z: from.z,
      t: 0, dur: reduced() ? 1 : 560, arc: 1.1, blocking: true,
      land: function () {
        A.crown(panOf(w0.x));
        burst(w0.x, w0.z, 0.3, "crown");
        onDone();
      } });
  }

  /* ================= rules glue ================= */
  var legalCache = null, legalKey = "";
  function legal() {
    var k = K.key(pos) + (forced ? "f" : "o");
    if (k !== legalKey) { legalKey = k; legalCache = K.generate(pos, forced); }
    return legalCache;
  }
  function targets() {
    var out = [], seen = {}, n = prefix.length;
    cands.forEach(function (m) { var s = m.path[n]; if (s != null && !seen[s]) { seen[s] = 1; out.push(s); } });
    return out;
  }

  /* ================= input ================= */
  function pointInQuad(px, py, q) {
    var inside = false;
    for (var i = 0, j = 3; i < 4; j = i++) {
      if (((q[i].y > py) !== (q[j].y > py)) && (px < (q[j].x - q[i].x) * (py - q[i].y) / (q[j].y - q[i].y) + q[i].x)) inside = !inside;
    }
    return inside;
  }
  function hitSquare(px, py) {
    for (var i = 0; i < squares.length; i++) if (squares[i].sq >= 0 && pointInQuad(px, py, squares[i].quad)) return squares[i].sq;
    /* a checker stands above its square: also accept a press on its face */
    var best = -1, bd = 1e9;
    for (var k = 0; k < squares.length; k++) {
      var s = squares[k]; if (s.sq < 0) continue;
      var sw = sqWorld(s.sq), c = project(sw.x, PH, sw.z);
      var d = Math.hypot(px - c.x, (py - c.y) / SIN);
      if (d < c.s * PR && d < bd) { bd = d; best = s.sq; }
    }
    return best;
  }

  function deny(sq, msg) {
    A.deny();
    if (sq >= 0) { shakeSq = sq; shakeT = 1; }
    if (msg) flash(msg, true);
  }

  function select(sq) {
    var ms = legal(), own = ms.filter(function (m) { return m.from === sq; });
    hintMove = null;
    if (!own.length) {
      if (forced && ms.length && ms[0].caps.length) { mustT = 1; deny(sq, "You have to jump"); }
      else deny(sq, mine(pos.b[sq]) ? "That one's stuck" : null);
      sel = -1; cands = []; return false;
    }
    sel = sq; cands = own; prefix = []; inJump = false;
    A.select(panOf(sqWorld(sq).x));
    return true;
  }

  function tapSquare(sq) {
    if (!myTurn() || sq < 0) return;
    if (inJump) {
      if (targets().indexOf(sq) >= 0) advance(sq);
      else deny(sq, "Finish the jump");
      return;
    }
    if (mine(pos.b[sq])) { if (sq === sel) { sel = -1; cands = []; } else select(sq); return; }
    if (sel >= 0) {
      if (targets().indexOf(sq) >= 0) { advance(sq); return; }
      var fin = cands.filter(function (m) { return K.last(m) === sq; });
      if (fin.length === 1) { playerMove(fin[0], 0); return; }
      deny(sq); sel = -1; cands = [];
    }
  }

  /* One landing at a time, so a double jump is two deliberate taps (or one tap on
     the final square when only one route leads there). */
  function advance(sq, fromWorld) {
    var n = prefix.length;
    var next = cands.filter(function (m) { return m.path[n] === sq; });
    if (!next.length) return;
    prefix.push(sq); cands = next;
    var done = cands.every(function (m) { return m.path.length === prefix.length; });
    var m = cands[0], piece = pos.b[m.from];
    if (!view.mover) { var w0 = sqWorld(m.from); view.mover = { p: piece, x: w0.x, y: 0, z: w0.z }; view.hide[m.from] = 1; }
    if (fromWorld) { view.mover.x = fromWorld.x; view.mover.z = fromWorld.z; }
    hopQ.push({ aSq: n ? prefix[n - 1] : m.from, bSq: sq, cap: m.caps.length ? m.caps[n] : -1, capturer: sideOf(piece) });
    afterHops = function () {
      if (done) commit(m, true);
      else { inJump = true; if (n === 0) flash(m.caps.length > 1 ? "Keep jumping" : null); }
    };
    if (!hop) nextHop();
  }

  function playerMove(m, startAt) {
    prefix = m.path.slice(); cands = [m];
    queueHops(pos.b[m.from], m.from, m, startAt, function () { commit(m, true); });
  }

  /* ---------- pointer: tap, or drag a checker to its square ---------- */
  function local(ev) { var r = canvas.getBoundingClientRect(); return { x: ev.clientX - r.left, y: ev.clientY - r.top }; }
  canvas.addEventListener("pointerdown", function (ev) {
    if (!started) return;
    A.init();
    if (cursor >= 0) cursor = -1;
    if (!myTurn()) return;
    var p = local(ev), sq = hitSquare(p.x, p.y);
    if (sq < 0) return;
    var atMover = inJump && sq === prefix[prefix.length - 1];
    if (atMover || (!inJump && mine(pos.b[sq]))) {
      /* read this BEFORE selecting: a second press on a selected checker puts it down */
      var wasSel = sq === sel;
      if (!atMover && !wasSel && !select(sq)) return;
      drag = { sq: sq, x0: p.x, y0: p.y, moved: false, id: ev.pointerId, wasSel: wasSel };
      try { canvas.setPointerCapture(ev.pointerId); } catch (e) {}
      return;
    }
    tapSquare(sq);
  });
  canvas.addEventListener("pointermove", function (ev) {
    if (!drag || ev.pointerId !== drag.id) return;
    var p = local(ev);
    if (!drag.moved && Math.hypot(p.x - drag.x0, p.y - drag.y0) < 8) return;
    if (!drag.moved) {
      drag.moved = true;
      if (!view.mover) { var w0 = sqWorld(drag.sq); view.mover = { p: pos.b[drag.sq], x: w0.x, y: 0, z: w0.z }; view.hide[drag.sq] = 1; drag.made = true; }
    }
    var w = unproject(p.x, p.y, 0.35);
    view.mover.x = Math.max(-4.4, Math.min(4.4, w.x)); view.mover.z = Math.max(-4.4, Math.min(4.4, w.z)); view.mover.y = 0.35;
  });
  function endDrag(ev) {
    if (!drag || ev.pointerId !== drag.id) return;
    var d = drag; drag = null;
    if (!d.moved) {
      if (d.wasSel && !inJump) { sel = -1; cands = []; }
      return;
    }
    var p = local(ev), sq = hitSquare(p.x, p.y);
    var from = { x: view.mover.x, z: view.mover.z };
    view.mover.y = 0;
    var ok = sq >= 0 && targets().indexOf(sq) >= 0;
    var fin = !ok && sq >= 0 ? cands.filter(function (m) { return K.last(m) === sq; }) : [];
    if (ok) { advance(sq, from); return; }
    if (fin.length === 1) { var o = sqWorld(d.sq); view.mover.x = o.x; view.mover.z = o.z; playerMove(fin[0], 0); return; }
    /* not a legal square: the checker slides home */
    var home = sqWorld(inJump ? prefix[prefix.length - 1] : d.sq);
    hop = { a: from, b: home, bSq: -1, cap: -1, jump: false, t: 0, dur: reduced() ? 1 : 180 };
    afterHops = function () {
      if (!inJump && d.made) { view.mover = null; view.hide = {}; }
    };
    if (sq >= 0 && sq !== d.sq) deny(sq);
  }
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);

  /* ================= game flow ================= */
  function startGame(foeId) {
    foe = foeById(foeId);
    player = lsGet(LS.side, "black") === "red" ? RED : BLACK;
    flip = player === BLACK;
    pos = K.start();
    history = []; snaps = [{ b: new Int8Array(pos.b), turn: pos.turn }];
    stacks = { mine: 0, theirs: 0 }; stackHist = [{ mine: 0, theirs: 0 }];
    sel = -1; cands = []; prefix = []; inJump = false; hintMove = null; lastMove = null;
    view = { hide: {}, mover: null }; flyers = []; hopQ = []; hop = null; particles = [];
    gameOver = false; started = true; thinking = false; replay = null; legalKey = "";
    cacheSquares(); buildScene();
    renderOpp(); say(foe.quips.start);
    elOpp.hidden = false; elBar.hidden = false; elReplay.hidden = true;
    document.body.classList.add("is-playing");
    renderMoves(); updateBar();
    A.startBed();
    if (pos.turn !== player) setTimeout(requestEngine, 700);
    else flash("Your move", false, 1100);
  }

  function commit(m, byPlayer) {
    var piece = pos.b[m.from], side = sideOf(piece);
    function finishCommit() {
      var note = K.notation(m);
      K.makeMove(pos, m);
      history.push({ note: note, m: m, side: side });
      snaps.push({ b: new Int8Array(pos.b), turn: pos.turn });
      /* a captured checker may still be in the air; count it where it is going */
      stackHist.push({ mine: stacks.mine + pendingFlyers("mine"), theirs: stacks.theirs + pendingFlyers("theirs") });
      lastMove = m; view = { hide: {}, mover: null };
      sel = -1; cands = []; prefix = []; inJump = false; hintMove = null; legalKey = "";
      if (!byPlayer && m.caps.length) say(foe.quips.capture);
      if (byPlayer && m.caps.length >= 2) flash(m.caps.length === 2 ? "Double jump!" : m.caps.length === 3 ? "Triple jump!" : m.caps.length + " in one!");
      renderMoves(); updateBar();
      var st = K.status(pos, forced);
      if (st.over) { finish(st); return; }
      if (pos.turn !== player) setTimeout(requestEngine, 240);
    }
    if (m.crown) {
      view.mover.p = piece;
      crownAnim(K.last(m), side, function () {
        view.mover.p = piece * 2;
        flash("King me!", false);
        if (!byPlayer) say(foe.quips.crown);
        setTimeout(finishCommit, reduced() ? 0 : 160);
      });
    } else finishCommit();
  }

  /* ---------- the opponent ---------- */
  function ensureWorker() {
    if (worker || workerBroken) return;
    try {
      worker = new Worker("engine.js?v=1");
      worker.onmessage = onEngine;
      worker.onerror = function () { workerBroken = true; say("(stepped out back for a minute)"); };
    } catch (e) { workerBroken = true; }
  }
  function pastSnaps() {
    return snaps.slice(Math.max(0, snaps.length - 1 - pos.half), snaps.length - 1).map(function (s) { return { b: Array.from(s.b), turn: s.turn }; });
  }
  function requestEngine(kind) {
    if (gameOver || replay) return;
    ensureWorker(); if (!worker) return;
    thinking = true; pending = { id: ++reqId, kind: kind || "move" };
    elSay.classList.add("is-think");
    elSay.textContent = kind === "hint" ? "looking over your options" : "thinking";
    thinkStart = performance.now();
    updateBar();
    worker.postMessage({ type: "go", id: reqId, b: Array.from(pos.b), turn: pos.turn, half: pos.half, forced: forced,
      who: kind === "hint" ? "silas" : foe.id, timeMs: kind === "hint" ? 1100 : undefined, plies: history.length, past: pastSnaps() });
  }
  function onEngine(e) {
    var d = e.data;
    if (d.type !== "bestmove" || !pending || d.id !== pending.id) return;
    var kind = pending.kind; pending = null;
    thinking = false; elSay.classList.remove("is-think");
    if (gameOver || replay) { updateBar(); return; }
    var m = d.note ? K.findMove(pos, forced, d.note) : null;
    if (kind === "hint") {
      say(foe.trait); updateBar();
      if (!m) return;
      hintMove = m; sel = -1; cands = []; A.hint();
      return;
    }
    if (!m) { updateBar(); return; }
    /* a reply that lands the instant you let go reads as a reflex, not a decision */
    var wait = Math.max(0, 480 - (performance.now() - thinkStart));
    setTimeout(function () {
      if (gameOver || replay) return;
      say(foe.trait); updateBar();
      queueHops(pos.b[m.from], m.from, m, 0, function () { commit(m, false); });
    }, wait);
  }

  /* ---------- the end ---------- */
  var finishT = null;
  function finish(st) {
    gameOver = true; updateBar();
    var won = st.winner === player, drawn = st.winner === 0;
    var title, line, text, n = Math.ceil(history.length / 2);
    if (drawn) {
      title = "A draw"; line = st.reason;
      text = "Neither of you could break through. The game ends by " + st.reason + ".";
      bump(LS.d); A.draw();
    } else if (won) {
      title = "You win"; line = st.reason === "no pieces left" ? "every checker taken" : "no moves left";
      text = "You beat <b>" + foe.name + "</b> in " + n + " moves.";
      bump(LS.w); recordDefeat(foe.id); A.win(); confetti();
      say(foe.quips.lose);
    } else {
      title = foe.name + " wins"; line = st.reason === "no pieces left" ? "every checker taken" : "no moves left";
      text = "<b>" + foe.name + "</b> beat you in " + n + " moves.";
      bump(LS.l); A.lose(); say(foe.quips.win);
    }
    elResTitle.textContent = title; elResLine.textContent = line; elResText.innerHTML = text;
    elResSeal.innerHTML = sealSvg(foe, 54);
    elResRecord.textContent = record();
    setupShare(won, drawn);
    clearTimeout(finishT);
    finishT = setTimeout(function () { elResult.hidden = false; }, reduced() ? 0 : 1100);
  }
  function record() {
    return "Record  " + lsGet(LS.w, "0") + "W · " + lsGet(LS.l, "0") + "L · " + lsGet(LS.d, "0") + "D   ·   regulars beaten " + defeated().length + "/6";
  }
  function bump(k) { lsSet(k, String((parseInt(lsGet(k, "0"), 10) || 0) + 1)); }
  function defeated() { try { return JSON.parse(lsGet(LS.defeated, "[]")) || []; } catch (e) { return []; } }
  function recordDefeat(id) {
    var l = defeated();
    if (l.indexOf(id) < 0) l.push(id);
    lsSet(LS.defeated, JSON.stringify(l));
    lsSet(LS.beaten, String(l.length));           /* the ticket rule reads this; nothing awards directly */
  }
  function confetti() {
    for (var i = 0; i < 6; i++) setTimeout(function () {
      var s = squares[(Math.random() * 64) | 0], w0 = cellWorld(s.r, s.c);
      burst(w0.x, w0.z, 0.2, "crown");
    }, i * 140);
  }

  /* ---------- replay ---------- */
  function enterReplay() {
    elResult.hidden = true;
    replay = { k: history.length, playing: false, next: 0, token: 0, busy: false, queued: 0 };
    rboard = new Int8Array(snaps[replay.k].b);
    elReplay.hidden = false; elBar.hidden = true;
    renderReplay();
  }
  function setReplay(k) {
    hop = null; hopQ = []; flyers = []; view = { hide: {}, mover: null };
    replay.token++; replay.busy = false; replay.queued = 0;       /* cancel any step in flight */
    replay.k = Math.max(0, Math.min(history.length, k));
    rboard = new Int8Array(snaps[replay.k].b);
    renderReplay();
  }
  function stepReplay(dir) {
    if (!replay) return;
    if (dir < 0) { replay.playing = false; setReplay(replay.k - 1); return; }
    if (replay.k >= history.length) { replay.playing = false; renderReplay(); return; }
    /* a step is only over when its captured checkers have landed; clicks that
       arrive before then are queued, not dropped */
    if (replay.busy) { replay.queued++; return; }
    replay.busy = true;
    var h = history[replay.k], k0 = replay.k, token = replay.token;
    var saved = stackHist[k0];
    stackHist[k0] = { mine: saved.mine, theirs: saved.theirs };   /* animate on a copy */
    queueHops(rboard[h.m.from], h.m.from, h.m, 0, function () {
      function done() {
        stackHist[k0] = saved;
        if (!replay || replay.token !== token) return;
        replay.k = k0 + 1; rboard = new Int8Array(snaps[replay.k].b);
        view = { hide: {}, mover: null };
        replay.busy = false;
        replay.next = performance.now() + 650;
        renderReplay();
        if (replay.queued > 0) { replay.queued--; stepReplay(1); }
      }
      function settled() { if (!replay || replay.token !== token) { stackHist[k0] = saved; return; } if (flyers.length) setTimeout(settled, 40); else done(); }
      if (h.m.crown) crownAnim(K.last(h.m), h.side, settled); else settled();
    });
    renderReplay();
  }
  function exitReplay() {
    replay = null; hop = null; hopQ = []; flyers = []; view = { hide: {}, mover: null };
    elReplay.hidden = true; elBar.hidden = false; elResult.hidden = false;
    renderMoves();
  }
  function renderReplay() {
    if (!replay) return;
    var k = replay.k;
    elRpLabel.textContent = k === 0 ? "Start" : "Move " + Math.ceil(k / 2) + (k % 2 ? "" : "…") + "  " + history[k - 1].note;
    elRpCount.textContent = k + " / " + history.length;
    $("rpPlay").textContent = replay.playing ? "Pause" : "Play";
    renderMoves();
  }

  /* ================= chrome ================= */
  var elOpp = $("opp"), elSeal = $("oppSeal"), elName = $("oppName"), elRole = $("oppRole"), elSay = $("oppSay");
  var elBar = $("bar"), elTurn = $("turn"), elCallout = $("callout"), elOverlay = $("overlay"), elCast = $("cast");
  var elResult = $("result"), elResTitle = $("resTitle"), elResLine = $("resLine"), elResText = $("resText"),
      elResRecord = $("resRecord"), elResSeal = $("resSeal"), elMoves = $("moves"), elSound = $("soundBtn");
  var elReplay = $("replay"), elRpLabel = $("rpLabel"), elRpCount = $("rpCount"), elHintLine = $("hintLine");

  function say(t) { elSay.textContent = t || ""; }
  var calloutT = null;
  function flash(t, bad, ms) {
    if (!t) return;
    elCallout.textContent = t; elCallout.classList.toggle("is-bad", !!bad);
    elCallout.hidden = false; elCallout.classList.remove("is-pop"); void elCallout.offsetWidth; elCallout.classList.add("is-pop");
    clearTimeout(calloutT); calloutT = setTimeout(function () { elCallout.hidden = true; }, ms || 1300);
  }
  function renderOpp() { elSeal.innerHTML = sealSvg(foe, 40); elName.textContent = foe.name; elRole.textContent = foe.role; }

  function updateBar() {
    var yours = started && !gameOver && pos.turn === player;
    elTurn.textContent = gameOver ? "Game over" : thinking ? (pending && pending.kind === "hint" ? "Looking…" : foe.name.replace(/^Old /, "") + " to move") : yours ? "Your move" : foe.name.replace(/^Old /, "") + " to move";
    elTurn.className = "turn " + (player === BLACK ? "turn--black" : "turn--red") + (yours ? " is-you" : "");
    $("btnHint").disabled = !yours || thinking || !!hop;
    $("btnResign").disabled = gameOver || !started;
  }

  function renderMoves() {
    if (!history.length) { elMoves.innerHTML = '<div class="moves__empty">No moves yet.</div>'; return; }
    var html = "", cur = replay ? replay.k - 1 : history.length - 1;
    for (var i = 0; i < history.length; i += 2) {
      html += '<div class="moves__row"><span class="moves__n">' + (i / 2 + 1) + "</span>" +
        '<span class="moves__b' + (i === cur ? " is-cur" : "") + '">' + history[i].note + "</span>" +
        '<span class="moves__r' + (i + 1 === cur ? " is-cur" : "") + '">' + (history[i + 1] ? history[i + 1].note : "") + "</span></div>";
    }
    elMoves.innerHTML = html;
    var c = elMoves.querySelector(".is-cur");
    if (c) elMoves.scrollTop = c.offsetTop - elMoves.clientHeight / 2;
    elMoves.hidden = false;
  }

  /* Each regular gets a carved roundel with a mark of their trade. */
  function sealSvg(f, size) {
    var g = {
      broom: '<path d="M-7 -8L1.5 0.5"/><path d="M0 -1.5l7.5 6-3.5 4.2-6.3-7.4z"/><path d="M2.6 4.4l-2 2.3M4.6 6l-1.8 2.4"/>',
      envelope: '<rect x="-8" y="-5.5" width="16" height="11" rx="1.4"/><path d="M-8 -4.5l8 5.6 8-5.6"/>',
      apple: '<path d="M0 -3.4c-2.6-2.2-7.5-1.2-7.5 3.6 0 4.4 3.1 8.1 5.2 8.1 1 0 1.3-.6 2.3-.6s1.3.6 2.3.6c2.1 0 5.2-3.7 5.2-8.1 0-4.8-4.9-5.8-7.5-3.6z"/><path d="M0 -3.6c0-2.2.8-3.8 2.4-4.8"/>',
      hat: '<path d="M-9.5 3.4c3 2 16 2 19 0"/><path d="M-6.2 2.8c0-6.6 2.7-9.6 6.2-9.6s6.2 3 6.2 9.6"/><path d="M-6 -0.2h12"/>',
      steth: '<path d="M-6 -8v5a6 6 0 0 0 12 0v-5"/><path d="M0 3v2.4a3.4 3.4 0 0 0 6.8 0v-1.4"/><circle cx="6.8" cy="2.6" r="1.8"/>',
      bell: '<path d="M-7 4.4a7 7 0 0 1 14 0z"/><path d="M-9.4 4.4h18.8"/><path d="M0 -2.6v-2.6"/><circle cx="0" cy="-6.4" r="1.3"/>'
    }[f.glyph];
    return '<svg viewBox="-14 -14 28 28" width="' + size + '" height="' + size + '" aria-hidden="true">' +
      '<circle cx="0" cy="0" r="13" fill="#2a1a10" stroke="' + f.accent + '" stroke-opacity="0.55" stroke-width="1"/>' +
      '<circle cx="0" cy="0" r="10.6" fill="none" stroke="' + f.accent + '" stroke-opacity="0.22" stroke-width="0.7"/>' +
      '<g fill="none" stroke="' + f.accent + '" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' + g + "</g></svg>";
  }

  function buildCast() {
    var beaten = defeated();
    elCast.innerHTML = "";
    FOES.forEach(function (f) {
      var b = document.createElement("button");
      b.type = "button"; b.className = "foe"; b.setAttribute("data-opt-start", "");
      var pips = "";
      for (var i = 1; i <= 6; i++) pips += '<span class="foe__pip' + (i <= f.tier ? " on" : "") + '"></span>';
      b.innerHTML = '<span class="foe__seal">' + sealSvg(f, 38) + "</span>" +
        '<span class="foe__name">' + f.name + "</span>" +
        '<span class="foe__role">' + f.role + "</span>" +
        '<span class="foe__pips">' + pips + "</span>" +
        '<span class="foe__trait">' + f.trait + "</span>" +
        (beaten.indexOf(f.id) >= 0 ? '<span class="foe__won" title="You have beaten this player">&#10003;</span>' : "");
      b.addEventListener("click", function () {
        A.init();
        elOverlay.classList.add("is-out");
        setTimeout(function () { elOverlay.hidden = true; elOverlay.classList.remove("is-out"); }, 240);
        elHintLine.classList.add("is-gone");
        startGame(f.id);
      });
      elCast.appendChild(b);
    });
  }

  function wireOptions() {
    var side = lsGet(LS.side, "black");
    Array.prototype.forEach.call(document.querySelectorAll("[data-side]"), function (b) {
      b.classList.toggle("is-on", b.getAttribute("data-side") === side);
      b.setAttribute("aria-pressed", b.getAttribute("data-side") === side ? "true" : "false");
      b.addEventListener("click", function () {
        lsSet(LS.side, b.getAttribute("data-side"));
        Array.prototype.forEach.call(document.querySelectorAll("[data-side]"), function (o) {
          o.classList.toggle("is-on", o === b); o.setAttribute("aria-pressed", o === b ? "true" : "false");
        });
      });
    });
    var fb = $("forcedBtn");
    function paint() { fb.setAttribute("aria-checked", forced ? "true" : "false"); $("forcedLabel").textContent = forced ? "Jumps are compulsory (official rules)" : "Jumps are optional (house rules)"; }
    fb.addEventListener("click", function () { forced = !forced; lsSet(LS.forced, forced ? "1" : "0"); legalKey = ""; paint(); });
    paint();
  }

  function showCast() {
    elResult.hidden = true; elReplay.hidden = true; replay = null;
    buildCast(); elOverlay.hidden = false; started = false;
    document.body.classList.remove("is-playing");
  }

  $("btnNew").addEventListener("click", showCast);
  $("btnHint").addEventListener("click", function () { if (myTurn()) { sel = -1; cands = []; requestEngine("hint"); } });
  $("btnResign").addEventListener("click", function () {
    if (gameOver || !started) return;
    finish({ over: true, winner: -player, reason: "resignation" });
    elResTitle.textContent = "You resigned"; elResLine.textContent = foe.name + " wins";
    elResText.innerHTML = "You gave it up after " + Math.ceil(history.length / 2) + " moves against <b>" + foe.name + "</b>.";
  });
  $("btnAgain").addEventListener("click", function () { elResult.hidden = true; startGame(foe.id); });
  $("btnCast").addEventListener("click", showCast);
  $("btnReplay").addEventListener("click", enterReplay);
  $("rpStart").addEventListener("click", function () { replay.playing = false; setReplay(0); });
  $("rpBack").addEventListener("click", function () { stepReplay(-1); });
  $("rpFwd").addEventListener("click", function () { replay.playing = false; stepReplay(1); });
  $("rpEnd").addEventListener("click", function () { replay.playing = false; setReplay(history.length); });
  $("rpPlay").addEventListener("click", function () {
    if (replay.k >= history.length) setReplay(0);
    replay.playing = !replay.playing; replay.next = 0; renderReplay();
  });
  $("rpDone").addEventListener("click", exitReplay);

  elSound.addEventListener("click", function () {
    soundOn = !soundOn; lsSet(LS.sound, soundOn ? "1" : "0");
    elSound.setAttribute("aria-pressed", soundOn ? "true" : "false");
    A.init(); A.setOn(soundOn); if (soundOn) A.select(0);
  });
  elSound.setAttribute("aria-pressed", soundOn ? "true" : "false");
  A.setOn(soundOn);

  /* ---------- keyboard ----------
     Arrows walk a cursor over the board, Enter picks up and puts down. It is a
     real way to play, and it is how the tests and the card pose drive the board
     without a debug hook. */
  function moveCursor(dc, dr) {
    if (cursor < 0) { cursor = squares.findIndex(function (s) { return s.sq === (player === BLACK ? 9 : 22); }); return; }
    var s = squares[cursor], w0 = cellWorld(s.r, s.c);
    var tx = w0.x + dc, tz = w0.z - dr;
    for (var i = 0; i < squares.length; i++) {
      var w1 = cellWorld(squares[i].r, squares[i].c);
      if (Math.abs(w1.x - tx) < 0.1 && Math.abs(w1.z - tz) < 0.1) { cursor = i; return; }
    }
  }
  window.addEventListener("keydown", function (e) {
    var k = e.key;
    if (replay) {
      if (k === "ArrowLeft") { e.preventDefault(); stepReplay(-1); }
      else if (k === "ArrowRight") { e.preventDefault(); replay.playing = false; stepReplay(1); }
      else if (k === "Home") setReplay(0);
      else if (k === "End") setReplay(history.length);
      else if (k === " ") { e.preventDefault(); $("rpPlay").click(); }
      else if (k === "Escape") exitReplay();
      return;
    }
    if (!started || gameOver) return;
    if (k === "ArrowLeft" || k === "ArrowRight" || k === "ArrowUp" || k === "ArrowDown") {
      e.preventDefault();
      moveCursor(k === "ArrowRight" ? 1 : k === "ArrowLeft" ? -1 : 0, k === "ArrowUp" ? 1 : k === "ArrowDown" ? -1 : 0);
      return;
    }
    if (k === "Enter" || k === " ") {
      e.preventDefault(); A.init();
      if (cursor < 0) { moveCursor(0, 0); return; }
      var sq = squares[cursor].sq;
      if (sq >= 0) tapSquare(sq);
      return;
    }
    if (k === "h" || k === "H") $("btnHint").click();
    else if (k === "n" || k === "N") showCast();
    else if (k === "m" || k === "M") elSound.click();
    else if (k === "Escape" && sel >= 0 && !inJump) { sel = -1; cands = []; }
  });

  /* ---------- share ---------- */
  function setupShare(won, drawn) {
    var verb = drawn ? "drew with" : won ? "beat" : "lost to";
    window.OPT_SHARE_TEXT = "I " + verb + " " + foe.name + " at checkers on One Page Toys. " + foe.name + " is " + foe.role + ".";
    window.OPT_SHARE_LINE = won ? "Beat " + foe.name + " at checkers" : drawn ? "Drew with " + foe.name : "Lost to " + foe.name;
    window.OPT_SHARE_IMAGE = function () {
      var w = 1200, h = 900, out = document.createElement("canvas");
      out.width = w; out.height = h;
      var g = out.getContext("2d");
      g.fillStyle = "#120b06"; g.fillRect(0, 0, w, h);
      var sw = canvas.width, sh = canvas.height, k = Math.max(w / sw, (h - 118) / sh);
      g.drawImage(canvas, (w - sw * k) / 2, ((h - 118) - sh * k) / 2, sw * k, sh * k);
      g.fillStyle = "rgba(18,11,6,0.95)"; g.fillRect(0, h - 118, w, 118);
      g.fillStyle = "#f2cf86"; g.font = "44px 'Alfa Slab One', Georgia, serif"; g.textBaseline = "middle";
      g.fillText(window.OPT_SHARE_LINE, 46, h - 74);
      g.fillStyle = "rgba(243,230,204,0.55)"; g.font = "25px 'Courier Prime', monospace";
      g.fillText("onepagetoys.com/toys/checkers", 46, h - 30);
      return out;
    };
  }

  /* ---------- automation handle (tests and the card pose only) ---------- */
  if (navigator.webdriver) {
    window.__checkers = {
      state: function () { return { b: Array.from(pos.b), turn: pos.turn, player: player, history: history.map(function (h) { return h.note; }), over: gameOver, thinking: thinking, busy: !!(hop || hopQ.length || flyers.length), replay: replay ? replay.k : -1, stacks: stacks, sel: sel, inJump: inJump, started: started, my: myTurn(), hint: hintMove ? K.notation(hintMove) : null }; },
      center: function (sq) { var w0 = sqWorld(sq), p = project(w0.x, 0, w0.z); return { x: p.x, y: p.y }; }
    };
  }

  /* ---------- boot ---------- */
  wireOptions();
  buildCast();
  seedMotes();
  window.addEventListener("resize", resize);
  resize();
  requestAnimationFrame(tick);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { buildScene(); });
  setTimeout(function () { elHintLine.classList.add("is-gone"); }, 9000);
})();
