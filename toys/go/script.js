/* Go — No. 138.
   A thick kaya goban on tatami in a mountain teahouse at dusk. The shoji are slid
   open onto the engawa, the rain comes down on the maples outside, and a paper
   lantern hangs from the eaves. Six regulars play 9x9 here, with a handicap if you
   want one.

   The board is drawn with a real perspective camera, like Mancala and Checkers.
   Everything that never moves is baked once per layout into two canvases: the BACK
   (the garden, the engawa, the tatami, and the far bowl and lid) and the BOARD (the
   goban itself with its grid, and the near bowl and lid). Each frame draws the rain,
   the lantern's breathing light, the stones, the prisoners in the lids and the marks.

   Rules come from core.js (shared with the engine Worker and the tests); the
   regulars think in engine.js, off the main thread. */
(function () {
  "use strict";

  var K = window.GoCore, A = window.GoAudio;
  var BLACK = 1, WHITE = 2, PASS = 0;
  var canvas = document.getElementById("canvas");
  var ctx = canvas.getContext("2d");
  var $ = function (id) { return document.getElementById(id); };

  /* ================= camera ================= */
  var TILT = 0.68, SIN = 1, COS = 0, CAM_D = 30, FOCAL = 1000, CX = 0, CY = 0;
  function setCam(tilt, d) { TILT = tilt; var th = Math.PI / 2 - tilt; SIN = Math.sin(th); COS = Math.cos(th); CAM_D = d; }
  function project(x, y, z) {
    var ry = y * COS - z * SIN, rz = y * SIN + z * COS;
    var s = FOCAL / (CAM_D - rz);
    return { x: CX + x * s, y: CY - ry * s, s: s };
  }
  /* the inverse on a horizontal plane at height y */
  function unproject(px, py, y) {
    var D = CY - py;
    var z = (FOCAL * y * COS + D * y * SIN - D * CAM_D) / (FOCAL * SIN - D * COS);
    var s = FOCAL / (CAM_D - y * SIN - z * COS);
    return { x: (px - CX) / s, z: z };
  }

  /* ================= the goban =================
     One grid step across is 1; a step toward you is a touch longer, as on a real
     board (22 x 23.7 mm), which also keeps the far rows tappable on a phone. */
  var GX = 1.0, GZ = 1.07, MX = 0.6, MZ = 0.66;
  var HW = 4 * GX + MX, HD = 4 * GZ + MZ;
  var BT = 2.8, LEG = 2.2, FLOOR = -(BT + LEG), LEG_IN = 0.5;
  var RB = 0.492, RW = 0.482, SH = 0.36;            /* stone radii (black a hair bigger), lens height */
  var portrait = false;
  function gx(p) { return (K.px(p) - 4) * GX; }
  function gz(p) { return (K.py(p) - 4) * GZ; }
  /* the lantern hangs high to the left and behind: shadows fall right and toward you */
  var SHX = 0.13, SHZ = 0.11;

  /* bowls and lids, per layout; mine is the player's */
  var PROPS = null;
  function layoutProps() {
    if (portrait) {
      PROPS = {
        myBowl: { x: 2.9, z: HD + 1.9 }, myLid: { x: -2.4, z: HD + 1.8 },
        thBowl: { x: -2.9, z: -HD - 2.35 }, thLid: { x: 0.8, z: -HD - 2.2 }
      };
    } else {
      PROPS = {
        myBowl: { x: HW + 2.75, z: 1.7 }, myLid: { x: HW + 2.55, z: -1.95 },
        thBowl: { x: -HW - 2.75, z: -1.7 }, thLid: { x: -HW - 2.55, z: 1.95 }
      };
    }
  }
  var BOWL_R = 1.5, BOWL_H = 1.45, LID_R = 1.42, LID_H = 0.32;

  /* ================= persistence ================= */
  var LS = { beaten: "go_beaten", record: "go_record", w: "go_wins", l: "go_losses", foe: "go_foe",
    handi: "go_handicap", first: "go_first", sound: "go_sound", lesson: "go_lesson_seen", terr: "go_territory" };
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function track(name, params) { try { if (typeof window.gtag === "function") window.gtag("event", name, params || {}); } catch (e) {} }

  /* ================= the regulars ================= */
  var FOES = [
    { id: "hana", name: "Hana", role: "the innkeeper's granddaughter", bio: "Hana is the innkeeper's granddaughter.", rank: "about 25 kyu", tier: 1, glyph: "flower", accent: "#f0a0b4",
      trait: "Learned the rules last summer. Loves a big capture more than a big area.", pause: 650, resigns: false,
      quips: { start: "Grandpa says I can go first next time.", handi: "You get extra stones? Okay, but I'm still going to win.",
        capture: "Got them!", pass: "Um… I pass?", resign: "", win: "I won! I'm telling Grandpa!", lose: "Again tomorrow? I'll be better.", count: "Let's count!" } },
    { id: "ota", name: "Mr. Ota", role: "carries the mail up the mountain", bio: "Mr. Ota carries the mail up the mountain.", rank: "about 20 kyu", tier: 2, glyph: "letter", accent: "#e8b46a",
      trait: "Plays fast so he can finish his round before dark.", pause: 450, resigns: false,
      quips: { start: "One game, then the last bag of letters.", handi: "Stones on the board already? Fine, fine.",
        capture: "Delivered.", pass: "Nothing left for me. Pass.", resign: "", win: "Right on time.", lose: "You beat the postman. Well done.", count: "Let's count it up." } },
    { id: "emiko", name: "Emiko", role: "a potter from the village below", bio: "Emiko is a potter from the village below.", rank: "about 16 kyu", tier: 3, glyph: "pot", accent: "#d98c66",
      trait: "Shapes her groups slowly and hates to see them cut.", pause: 900, resigns: true,
      quips: { start: "My hands still smell of clay. Your move.", handi: "Take your stones. Clay needs a good base too.",
        capture: "That one was cracked anyway.", pass: "I'm done shaping. Pass.", resign: "It won't hold together. I resign.", win: "A good firing.", lose: "Yours held its shape better.", count: "Let's see what we made." } },
    { id: "saito", name: "Mr. Saito", role: "a retired teacher, here every Thursday", bio: "Mr. Saito is a retired teacher who plays every Thursday.", rank: "about 12 kyu", tier: 4, glyph: "book", accent: "#a9c48a",
      trait: "Plays by the proverbs, and tells you which one.", pause: 1000, resigns: true,
      quips: { start: "Remember: the corner is gold, the side is silver.", handi: "Handicap stones are nothing to be ashamed of. I took nine once.",
        capture: "Don't go back to fix a cut too late.", pass: "Nothing big left. I'll pass.", resign: "I know when I'm beaten. I resign.", win: "Good game. Now, about that move on the side…", lose: "Excellent. You listened.", count: "Shall we count?" } },
    { id: "lin", name: "Professor Lin", role: "visiting from Taipei", bio: "Professor Lin is visiting from Taipei.", rank: "about 8 kyu", tier: 5, glyph: "cup", accent: "#9fc3e6",
      trait: "Reads every fight out to the end. Never in a hurry.", pause: 1200, resigns: true,
      quips: { start: "In Taipei we call it weiqi. Please, begin.", handi: "A few stones. A fair way to start.",
        capture: "As I read it.", pass: "I believe the board is settled. Pass.", resign: "I have read it out. I resign.", win: "Thank you for a careful game.", lose: "Very well read. Thank you.", count: "Let us count." } },
    { id: "kenji", name: "Kenji", role: "owns the teahouse, once an insei", bio: "Kenji owns the teahouse, and trained to turn pro when he was young.", rank: "about 5 kyu", tier: 6, glyph: "kettle", accent: "#e7a352",
      trait: "Trained to turn pro as a boy, then came home to run the teahouse.", pause: 1100, resigns: true,
      quips: { start: "The tea is on. Please.", handi: "Put your stones down. I gave my teacher four once.",
        capture: "Mm.", pass: "Pass.", resign: "That's enough. I resign. More tea?", win: "Come back when it rains again.", lose: "Well. It has been a long time. Thank you.", count: "Let's count." } }
  ];
  function foeById(id) { for (var i = 0; i < FOES.length; i++) if (FOES[i].id === id) return FOES[i]; return FOES[0]; }
  function shortName(f) { return f.name; }

  /* ================= state ================= */
  var handicap = clampInt(parseInt(lsGet(LS.handi, "0"), 10), [0, 2, 3, 4]);
  function clampInt(v, list) { return list.indexOf(v) >= 0 ? v : list[0]; }
  var firstPref = lsGet(LS.first, "black");
  if (["black", "white", "alt"].indexOf(firstPref) < 0) firstPref = "black";
  var soundOn = lsGet(LS.sound, "1") !== "0";
  var terrOn = lsGet(LS.terr, "0") === "1";
  var foe = foeById(lsGet(LS.foe, "hana")), picked = null;
  var pos = K.start(0);
  var phase = "menu";                        /* menu | play | count | over */
  var human = BLACK, cpu = WHITE;
  var thinking = false, lock = 0, gameToken = 0;
  var stones = {};                           /* point -> stone on the board */
  var flights = [], parts = [], leaves = [];
  var lidShown = [0, 0, 0];                  /* prisoners showing in each color's lid (by capturer) */
  var own = null, ownTok = 0;                /* the latest ownership map (Black positive) */
  var ghost = 0, ghostKind = "", ghostBad = "", shakeT = 0, cursor = 0, touchArm = 0, press = null;
  var lowStreak = 0, lastWinrate = 0.5, aimTold = 0;
  var count = null;                          /* the counting phase */
  var worker = null, workerBroken = false, reqId = 0, inflight = {};
  var lampBoost = 0, winLeaf = null;
  var perf = { n: 0, sum: 0, max: 0 };

  function reduced() { return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches; }
  function later(ms, fn) { var t = gameToken; setTimeout(function () { if (t === gameToken) fn(); }, ms); }
  function busy() { return lock > 0 || thinking || flights.length > 0; }
  function myTurn() { return phase === "play" && pos.turn === human && !busy(); }

  /* ================= layout ================= */
  var dpr = 1, W = 0, H = 0, backCv = null, boardCv = null, terrCv = null, terrDirty = true;
  var SILL = 0, ENG = 0, LAMP = null, POSTS = null, boardPoly = [], lampCv = null, RECT = {};

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.floor(W * dpr); canvas.height = Math.floor(H * dpr);
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    portrait = H > W && W < 700;
    if (portrait) setCam(0.4, 46);
    else setCam(H < 560 ? 0.62 : 0.7, 30);
    layoutProps();
    fit();
    buildSprites();
    buildScene();
    terrDirty = true;
  }

  /* Screen offsets are linear in FOCAL, so one measure-and-scale pass fits exactly. */
  function fit() {
    CX = 0; CY = 0; FOCAL = 1000;
    var pts = [];
    [[-HW, -HD], [HW, -HD], [HW, HD], [-HW, HD]].forEach(function (c) { pts.push([c[0], 0, c[1]]); });
    pts.push([-HW, FLOOR, HD - LEG_IN], [HW, FLOOR, HD - LEG_IN], [-HW, -BT, HD], [HW, -BT, HD]);
    if (!portrait) {
      [PROPS.myBowl, PROPS.thBowl].forEach(function (b) {
        var r = BOWL_R + 0.2;
        pts.push([b.x - r, FLOOR + BOWL_H, b.z], [b.x + r, FLOOR + BOWL_H, b.z], [b.x - r, FLOOR, b.z + r * 0.5], [b.x + r, FLOOR, b.z + r * 0.5]);
      });
    }
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    pts.forEach(function (q) {
      var p = project(q[0], q[1], q[2]);
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    });
    var low = H < 560;
    var padX = portrait ? 6 : low ? 10 : Math.max(24, W * 0.03);
    var short = H < 740;
    var padTop = portrait ? 66 : low ? 46 : Math.max(96, H * 0.3);
    var padBot = portrait ? (short ? 104 : 124) : low ? 54 : 104;
    var availW = W - padX * 2, availH = H - padTop - padBot;
    var k = Math.min(availW / (maxX - minX), availH / (maxY - minY));
    FOCAL *= k;
    minX *= k; maxX *= k; minY *= k; maxY *= k;
    CX = W / 2 - (minX + maxX) / 2;
    var spare = availH - (maxY - minY);
    CY = padTop + Math.max(0, spare) * (portrait ? 0.7 : 0.62) - minY;
  }

  /* ================= helpers ================= */
  function srnd(n) { var x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function ease(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function polyPath(g, pts) { g.beginPath(); g.moveTo(pts[0].x, pts[0].y); for (var i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y); g.closePath(); }
  function panOf(p) { return clamp((K.px(p) - 4) / 5, -0.8, 0.8); }
  function panX(x) { return clamp(x / 8, -0.85, 0.85); }
  function now() { return performance.now(); }

  /* ================= stones =================
     A stone is a lens, slightly domed on both faces. Slate is dark and matte with a
     soft sheen; clamshell is ivory with fine curved growth lines, each stone cut at
     its own angle. Both are baked as sprites at the board's nearest scale. */
  var spr = { b: [], w: [], shadow: null, ref: 1 };
  function maxScale() {
    var m = 0;
    [[-HW, HD], [HW, HD], [0, HD]].forEach(function (c) { m = Math.max(m, project(c[0], 0, c[1]).s); });
    return m * 1.08;
  }
  function buildSprites() {
    spr.ref = maxScale();
    var U = spr.ref * dpr;
    spr.b = []; spr.w = [];
    for (var v = 0; v < 4; v++) spr.b.push(makeStone(BLACK, v, U));
    for (var w = 0; w < 8; w++) spr.w.push(makeStone(WHITE, w, U));
    spr.shadow = makeShadow(U);
  }
  function makeStone(color, variant, U) {
    var R = (color === BLACK ? RB : RW) * U, ry = R * SIN, h = SH * U * COS, pad = Math.ceil(R * 0.2) + 2;
    var ey = ry + h * 0.5;
    var w = Math.ceil(2 * R + 2 * pad), hh = Math.ceil(2 * ey + 2 * pad);
    var c = document.createElement("canvas"); c.width = w; c.height = hh;
    var g = c.getContext("2d");
    var cx = w / 2, cy = pad + ey;
    function body() { g.beginPath(); g.ellipse(cx, cy, R, ey, 0, 0, Math.PI * 2); }
    var j = srnd(variant * 7.3 + color * 3.1);
    if (color === BLACK) {
      body();
      var base = g.createRadialGradient(cx - R * 0.3, cy - ey * 0.42, R * 0.05, cx, cy, R * 1.25);
      base.addColorStop(0, "#55565c"); base.addColorStop(0.32, "#2b2c31"); base.addColorStop(0.72, "#141518"); base.addColorStop(1, "#08080a");
      g.fillStyle = base; g.fill();
      g.save(); body(); g.clip();
      /* the slate's soft, wide sheen toward the lantern */
      var sx = cx - R * (0.3 + j * 0.08), sy = cy - ey * (0.4 + j * 0.06);
      var sh = g.createRadialGradient(sx, sy, 0, sx, sy, R * 0.85);
      sh.addColorStop(0, "rgba(255,236,210," + (0.16 + j * 0.05) + ")"); sh.addColorStop(1, "rgba(255,236,210,0)");
      g.fillStyle = sh; g.fillRect(0, 0, w, hh);
      var sp = g.createRadialGradient(sx - R * 0.04, sy - ey * 0.05, 0, sx, sy, R * 0.2);
      sp.addColorStop(0, "rgba(255,244,226,0.42)"); sp.addColorStop(1, "rgba(255,244,226,0)");
      g.fillStyle = sp; g.fillRect(0, 0, w, hh);
      /* warm light bounced up off the kaya, along the lower rim */
      var bo = g.createRadialGradient(cx + R * 0.15, cy + ey * 1.05, R * 0.1, cx + R * 0.15, cy + ey * 1.05, R * 0.95);
      bo.addColorStop(0, "rgba(214,150,80,0.16)"); bo.addColorStop(1, "rgba(214,150,80,0)");
      g.fillStyle = bo; g.fillRect(0, 0, w, hh);
      g.restore();
      body(); g.strokeStyle = "rgba(0,0,0,0.55)"; g.lineWidth = Math.max(1, U * 0.012); g.stroke();
    } else {
      body();
      var bw = g.createRadialGradient(cx - R * 0.32, cy - ey * 0.45, R * 0.05, cx, cy, R * 1.22);
      bw.addColorStop(0, "#fffdf7"); bw.addColorStop(0.42, "#f3ecdc"); bw.addColorStop(0.8, "#dcd2bd"); bw.addColorStop(1, "#b9ae98");
      g.fillStyle = bw; g.fill();
      g.save(); body(); g.clip();
      /* the shell's growth lines: gentle parallel curves, cut at this stone's angle */
      g.save();
      g.translate(cx, cy - h * 0.12);
      g.scale(1, SIN);
      g.rotate(srnd(variant * 13.7 + 2) * Math.PI * 2);
      var n = 18, gap = R * (0.1 + srnd(variant * 3.3) * 0.03);
      for (var i = -n; i <= n; i++) {
        var rr = R * 4.2 + i * gap;
        g.beginPath(); g.arc(0, R * 4.2, rr, -Math.PI / 2 - 0.5, -Math.PI / 2 + 0.5);
        var a = 0.045 + srnd(i * 1.7 + variant) * 0.07;
        g.strokeStyle = "rgba(150,128,96," + a + ")"; g.lineWidth = Math.max(0.6, R * (0.02 + srnd(i + variant * 5) * 0.025)); g.stroke();
      }
      g.restore();
      var hl = g.createRadialGradient(cx - R * 0.3, cy - ey * 0.48, 0, cx - R * 0.3, cy - ey * 0.48, R * 0.7);
      hl.addColorStop(0, "rgba(255,255,255,0.6)"); hl.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = hl; g.fillRect(0, 0, w, hh);
      var dk = g.createRadialGradient(cx + R * 0.4, cy + ey * 0.6, R * 0.1, cx + R * 0.4, cy + ey * 0.6, R * 1.0);
      dk.addColorStop(0, "rgba(96,84,70,0.22)"); dk.addColorStop(1, "rgba(96,84,70,0)");
      g.fillStyle = dk; g.fillRect(0, 0, w, hh);
      g.restore();
      body(); g.strokeStyle = "rgba(118,102,82,0.5)"; g.lineWidth = Math.max(1, U * 0.01); g.stroke();
    }
    /* anchor: the point under the stone, at the board's surface */
    return { c: c, ax: cx, ay: cy + h * 0.5, w: w, h: hh };
  }
  function makeShadow(U) {
    var R = RB * U * 1.08, ry = R * SIN, pad = Math.ceil(R * 0.6);
    var w = Math.ceil(2 * R + 2 * pad), hh = Math.ceil(2 * ry + 2 * pad);
    var c = document.createElement("canvas"); c.width = w; c.height = hh;
    var g = c.getContext("2d");
    g.save(); g.translate(w / 2, hh / 2); g.scale(1, SIN);
    var gr = g.createRadialGradient(0, 0, R * 0.3, 0, 0, R * 1.35);
    gr.addColorStop(0, "rgba(28,14,4,0.62)"); gr.addColorStop(0.6, "rgba(28,14,4,0.3)"); gr.addColorStop(1, "rgba(28,14,4,0)");
    g.fillStyle = gr; g.beginPath(); g.arc(0, 0, R * 1.35, 0, Math.PI * 2); g.fill();
    g.restore();
    return { c: c, ax: w / 2, ay: hh / 2, w: w, h: hh };
  }
  /* draw a sprite whose anchor sits at world (x, y, z) */
  function blit(g, sp, x, y, z, alpha, mul) {
    var p = project(x, y, z), k = p.s / spr.ref / dpr * (mul || 1);
    if (alpha != null && alpha < 1) g.globalAlpha = alpha;
    g.drawImage(sp.c, p.x - sp.ax * k, p.y - sp.ay * k, sp.w * k, sp.h * k);
    if (alpha != null && alpha < 1) g.globalAlpha = 1;
    return p;
  }
  function stoneSprite(color, variant) { return color === BLACK ? spr.b[variant % spr.b.length] : spr.w[variant % spr.w.length]; }

  /* ================= the scene ================= */
  function newCv() { var c = document.createElement("canvas"); c.width = canvas.width; c.height = canvas.height; var g = c.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); return { c: c, g: g }; }

  function buildScene() {
    var back = newCv(), board = newCv();
    backCv = back.c; boardCv = board.c;
    var g = back.g;
    var farEdge = project(0, 0, -HD).y;
    var thTop = propTop(PROPS.thBowl);
    /* where the room ends and the engawa begins */
    SILL = clamp((portrait ? thTop : farEdge) - (portrait ? 24 : Math.max(34, H * 0.05)), 40, H * 0.5);
    ENG = Math.max(14, Math.min(46, SILL * 0.2));
    LAMP = { x: portrait ? W * 0.13 : W * 0.12, y: portrait ? Math.max(96, SILL * 0.66) : Math.max(54, SILL * 0.46), r: clamp(Math.min(W, H) * 0.042, 14, 32) };
    POSTS = { l: portrait ? W * 0.035 : W * 0.06, r: portrait ? W * 0.965 : W * 0.94, w: clamp(W * 0.03, 12, 30) };
    drawGarden(g);
    drawFloor(g);
    drawProp(g, PROPS.thBowl, PROPS.thLid, false);
    drawRoomFrame(g);
    lampCv = newCv().c;
    drawLantern(lampCv.getContext("2d"));
    /* the board layer */
    var b = board.g;
    drawBoard(b);
    drawProp(b, PROPS.myBowl, PROPS.myLid, true);
    terrCv = newCv().c;
    measureRects();
  }
  function propTop(bw) { return project(bw.x, FLOOR + BOWL_H + 0.3, bw.z).y - BOWL_R * 0.6 * project(bw.x, FLOOR + BOWL_H, bw.z).s * SIN; }

  /* --- outside: dusk over the mountain, maples in the rain --- */
  function drawGarden(g) {
    var top = 0, bot = SILL - ENG;
    var sky = g.createLinearGradient(0, top, 0, bot);
    sky.addColorStop(0, "#0a111d"); sky.addColorStop(0.45, "#15253a"); sky.addColorStop(0.85, "#28405a"); sky.addColorStop(1, "#30485f");
    g.fillStyle = sky; g.fillRect(0, 0, W, SILL);
    /* far ridges, softened by rain */
    ridge(g, bot * 0.42, bot * 0.2, "#1b2c41", 11, 0.9);
    mist(g, bot * 0.5, bot * 0.25, 0.07);
    ridge(g, bot * 0.62, bot * 0.18, "#13202f", 23, 1.3);
    mist(g, bot * 0.72, bot * 0.2, 0.06);
    /* cedars on the slope */
    for (var i = 0; i < 26; i++) {
      var x = srnd(i * 3.7 + 1) * W, base = bot * (0.78 + srnd(i * 1.3) * 0.14), ht = bot * (0.16 + srnd(i * 2.1) * 0.22);
      g.fillStyle = "rgba(10,20,26," + (0.6 + srnd(i) * 0.3) + ")";
      g.beginPath(); g.moveTo(x, base - ht); g.lineTo(x - ht * 0.22, base); g.lineTo(x + ht * 0.22, base); g.closePath(); g.fill();
    }
    /* a stone lantern in the garden, unlit, wet */
    var tx = portrait ? W * 0.78 : W * 0.72, ty = bot * 0.97, ts = clamp(bot * 0.2, 14, 46);
    g.fillStyle = "#1c2733";
    g.fillRect(tx - ts * 0.08, ty - ts * 0.8, ts * 0.16, ts * 0.8);
    g.fillRect(tx - ts * 0.24, ty - ts * 1.02, ts * 0.48, ts * 0.22);
    g.beginPath(); g.moveTo(tx - ts * 0.42, ty - ts * 1.02); g.quadraticCurveTo(tx, ty - ts * 1.42, tx + ts * 0.42, ty - ts * 1.02); g.fill();
    g.fillStyle = "rgba(255,190,110,0.1)"; g.fillRect(tx - ts * 0.14, ty - ts * 0.98, ts * 0.28, ts * 0.14);
    g.fillRect(tx - ts * 0.3, ty, ts * 0.6, ts * 0.06);
    /* maples: one leaning in from the right, a branch over the eaves on the left */
    maple(g, portrait ? W * 0.92 : W * 0.86, bot * 0.42, Math.max(bot * 0.5, 60), 5, 1);
    maple(g, portrait ? W * 0.3 : W * 0.24, bot * 0.15, Math.max(bot * 0.36, 44), 9, 0.8);
    mist(g, bot * 0.92, bot * 0.14, 0.05);
    /* the engawa: wet planks catching the dusk and the lantern */
    var ey0 = SILL - ENG;
    var eg = g.createLinearGradient(0, ey0, 0, SILL);
    eg.addColorStop(0, "#3a2c22"); eg.addColorStop(0.5, "#2b1f17"); eg.addColorStop(1, "#1c140f");
    g.fillStyle = eg; g.fillRect(0, ey0, W, ENG);
    var planks = Math.max(3, Math.round(ENG / 7));
    for (var k = 1; k < planks; k++) {
      var py = ey0 + ENG * k / planks;
      g.fillStyle = "rgba(0,0,0,0.38)"; g.fillRect(0, py, W, 1);
      g.fillStyle = "rgba(160,190,220,0.05)"; g.fillRect(0, py + 1, W, 1);
    }
    /* the wet sheen: dusk sky on the boards, warm near the lantern */
    var wet = g.createLinearGradient(0, 0, W, 0);
    wet.addColorStop(0, "rgba(255,180,100,0.12)"); wet.addColorStop(0.35, "rgba(140,170,210,0.06)"); wet.addColorStop(1, "rgba(140,170,210,0.1)");
    g.fillStyle = wet; g.fillRect(0, ey0, W, ENG * 0.7);
    g.fillStyle = "rgba(0,0,0,0.5)"; g.fillRect(0, ey0 - 1, W, 2);
    g.fillStyle = "rgba(190,210,235,0.12)"; g.fillRect(0, ey0 + 1, W, 1);
  }
  function ridge(g, y, amp, color, seed, wav) {
    g.fillStyle = color; g.beginPath(); g.moveTo(0, SILL);
    for (var x = 0; x <= W + 8; x += 8) {
      var t = x / W;
      var v = Math.sin(t * 5.1 * wav + seed) * 0.5 + Math.sin(t * 11.3 * wav + seed * 2) * 0.22 + Math.sin(t * 2.3 + seed * 0.7) * 0.6;
      g.lineTo(x, y - v * amp * 0.5);
    }
    g.lineTo(W, SILL); g.closePath(); g.fill();
  }
  function mist(g, y, h, a) {
    var m = g.createLinearGradient(0, y - h, 0, y + h);
    m.addColorStop(0, "rgba(170,195,220,0)"); m.addColorStop(0.5, "rgba(170,195,220," + a + ")"); m.addColorStop(1, "rgba(170,195,220,0)");
    g.fillStyle = m; g.fillRect(0, y - h, W, h * 2);
  }
  /* a Japanese maple leaf: seven slender lobes fanned around a short stem */
  var LOBES = [0.5, 0.78, 0.95, 1, 0.95, 0.78, 0.5];
  function leafPath(g, x, y, r, rot) {
    g.save(); g.translate(x, y); g.rotate(rot); g.beginPath();
    var spread = Math.PI * 0.27, a0 = -Math.PI / 2 - spread * 3;
    g.moveTo(0, r * 0.12);
    for (var i = 0; i < 7; i++) {
      var a = a0 + i * spread, L = r * LOBES[i];
      var v1 = a - spread * 0.5, v2 = a + spread * 0.5;
      if (i === 0) g.lineTo(Math.cos(v1) * r * 0.24, Math.sin(v1) * r * 0.24);
      /* one small tooth on each side of a lobe on the way to its tip */
      g.lineTo(Math.cos(a - spread * 0.2) * L * 0.62, Math.sin(a - spread * 0.2) * L * 0.62);
      g.lineTo(Math.cos(a - spread * 0.09) * L * 0.66, Math.sin(a - spread * 0.09) * L * 0.66);
      g.lineTo(Math.cos(a) * L, Math.sin(a) * L);
      g.lineTo(Math.cos(a + spread * 0.09) * L * 0.66, Math.sin(a + spread * 0.09) * L * 0.66);
      g.lineTo(Math.cos(a + spread * 0.2) * L * 0.62, Math.sin(a + spread * 0.2) * L * 0.62);
      g.lineTo(Math.cos(v2) * r * 0.24, Math.sin(v2) * r * 0.24);
    }
    g.closePath(); g.restore();
  }
  function maple(g, x, y, size, seed, lit) {
    /* trunk and limbs */
    g.strokeStyle = "#120b0a"; g.lineCap = "round";
    g.lineWidth = Math.max(2, size * 0.05);
    g.beginPath(); g.moveTo(x + size * 0.1, SILL - ENG); g.quadraticCurveTo(x - size * 0.1, y + size * 0.5, x, y); g.stroke();
    g.lineWidth = Math.max(1, size * 0.025);
    for (var b = 0; b < 5; b++) {
      var a = -Math.PI / 2 + (srnd(seed + b) - 0.5) * 2.4;
      g.beginPath(); g.moveTo(x, y + size * 0.1); g.lineTo(x + Math.cos(a) * size * 0.6, y + Math.sin(a) * size * 0.45); g.stroke();
    }
    /* the canopy: clusters of small leaves, dark at the back, lit in front */
    var n = Math.round(size * 2.4);
    for (var i = 0; i < n; i++) {
      var ang = srnd(seed * 31 + i * 1.7) * Math.PI * 2, d = Math.sqrt(srnd(seed * 17 + i * 2.3)) * size * 0.7;
      var lx = x + Math.cos(ang) * d * 1.25, ly = y + Math.sin(ang) * d * 0.62;
      var front = i / n;
      var r = clamp(size * 0.045, 2.5, 7) * (0.7 + srnd(i * 5.1) * 0.6);
      var warm = front * lit;
      var col = warm > 0.7 ? "rgba(196,70,44,0.92)" : warm > 0.45 ? "rgba(150,44,32,0.9)" : "rgba(92,24,22,0.88)";
      g.fillStyle = col;
      leafPath(g, lx, ly, r, srnd(i * 9.1) * 6.3); g.fill();
    }
  }

  /* --- the room: tatami, then the posts, the lintel and the eaves --- */
  function drawFloor(g) {
    var zFar = unproject(CX, SILL + 1, FLOOR).z;
    var X0 = -26, X1 = 26, Z0 = Math.max(zFar, -60), Z1 = 26;
    var tex = tatamiTexture(X0, X1, Z0, Z1);
    g.save(); g.setTransform(1, 0, 0, 1, 0, 0);
    mapPlane(g, tex, X0, X1, Z0, Z1, FLOOR, SILL);
    g.restore();
    /* the threshold beam */
    g.fillStyle = "#24170f"; g.fillRect(0, SILL - 2, W, 5);
    g.fillStyle = "rgba(255,200,140,0.16)"; g.fillRect(0, SILL - 2, W, 1);
    /* the lantern's pool on the mats */
    var c0 = project(-2.5, FLOOR, -1.5), reach = Math.max(W, H) * 0.9;
    var pool = g.createRadialGradient(c0.x, c0.y, 0, c0.x, c0.y, reach);
    pool.addColorStop(0, "rgba(255,178,96,0.2)"); pool.addColorStop(0.45, "rgba(255,160,90,0.08)"); pool.addColorStop(1, "rgba(255,160,90,0)");
    g.globalCompositeOperation = "lighter"; g.fillStyle = pool; g.fillRect(0, SILL, W, H - SILL);
    g.globalCompositeOperation = "source-over";
    /* the board's shadow on the tatami, and the dark under it */
    var fp = [[-HW + 0.4, -HD + 0.4], [HW - 0.2, -HD + 0.4], [HW - 0.2, HD - 0.3], [-HW + 0.4, HD - 0.3]].map(function (c) { return project(c[0] + 0.45, FLOOR, c[1] + 0.5); });
    g.save();
    g.shadowColor = "rgba(0,0,0,0.9)"; g.shadowBlur = project(0, FLOOR, HD).s * 2.2;
    polyPath(g, fp); g.fillStyle = "rgba(10,5,2,0.55)"; g.fill();
    g.restore();
    var vg = g.createRadialGradient(W / 2, project(0, 0, 0).y, Math.min(W, H) * 0.28, W / 2, project(0, 0, 0).y, Math.max(W, H) * 0.75);
    vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(0.55, "rgba(8,4,2,0.38)"); vg.addColorStop(1, "rgba(8,4,2,0.8)");
    g.fillStyle = vg; g.fillRect(0, SILL, W, H - SILL);
  }
  function tatamiTexture(X0, X1, Z0, Z1) {
    var ppu = clamp(Math.floor(4096 / Math.max(X1 - X0, Z1 - Z0)), 8, 24);
    var tw = Math.ceil((X1 - X0) * ppu), th = Math.ceil((Z1 - Z0) * ppu);
    var c = document.createElement("canvas"); c.width = tw; c.height = th;
    var g = c.getContext("2d");
    g.fillStyle = "#5a4c28"; g.fillRect(0, 0, tw, th);
    /* the rush: fine lines along each mat's length (z), with the weft every so often */
    for (var x = 0; x < tw; x += Math.max(2, ppu * 0.14)) {
      var a = srnd(x * 0.37);
      g.fillStyle = a > 0.6 ? "rgba(176,156,92,0.12)" : "rgba(36,28,10,0.13)";
      g.fillRect(x, 0, Math.max(1, ppu * 0.05), th);
    }
    for (var y = 0; y < th; y += ppu * 1.15) { g.fillStyle = "rgba(30,24,10,0.1)"; g.fillRect(0, y, tw, Math.max(1, ppu * 0.04)); }
    /* years of feet: the mats are worn paler down the middle, darker at the edges */
    for (var i = 0; i < 900; i++) {
      g.fillStyle = srnd(i * 1.9) > 0.5 ? "rgba(196,176,112,0.035)" : "rgba(30,22,8,0.045)";
      g.fillRect(srnd(i * 2.3) * tw, srnd(i * 3.1) * th, ppu * (0.4 + srnd(i) * 2), ppu * (2 + srnd(i * 4.4) * 6));
    }
    /* the heri: plain dark cloth where the mats meet */
    function heriX(wx) { var px = (wx - X0) * ppu, w = ppu * 0.9; g.fillStyle = "#1a1410"; g.fillRect(px - w / 2, 0, w, th); g.fillStyle = "rgba(150,120,80,0.14)"; g.fillRect(px - w / 2, 0, Math.max(1, ppu * 0.04), th); g.fillRect(px + w / 2 - Math.max(1, ppu * 0.04), 0, Math.max(1, ppu * 0.04), th); }
    function heriZ(wz) { var py = (wz - Z0) * ppu, w = ppu * 0.9; g.fillStyle = "#1a1410"; g.fillRect(0, py - w / 2, tw, w); g.fillStyle = "rgba(150,120,80,0.14)"; g.fillRect(0, py - w / 2, tw, Math.max(1, ppu * 0.04)); }
    heriX(-12.5); heriX(12.5); heriZ(-HD - 3.0); heriZ(HD + 7.5);
    return c;
  }
  /* Lay a flat texture onto the horizontal plane at height y, one device row at a
     time: every screen row is one line of constant depth, so this is exact. */
  function mapPlane(g, tex, X0, X1, Z0, Z1, y, minY) {
    var top = Math.max(minY || 0, project(0, y, Z0).y), bot = project(0, y, Z1).y;
    var r0 = Math.max(0, Math.floor(top * dpr)), r1 = Math.min(Math.ceil(H * dpr), Math.ceil(bot * dpr));
    for (var r = r0; r < r1; r++) {
      var py = (r + 0.5) / dpr;
      var z = unproject(CX, py, y).z;
      if (z < Z0 || z > Z1) continue;
      var s = FOCAL / (CAM_D - (y * SIN + z * COS));
      var dx0 = (CX + X0 * s) * dpr, dx1 = (CX + X1 * s) * dpr;
      var sy = (z - Z0) / (Z1 - Z0) * tex.height;
      g.drawImage(tex, 0, Math.min(tex.height - 1, Math.max(0, sy)), tex.width, 1, dx0, r, dx1 - dx0, 1.02);
    }
  }

  function drawRoomFrame(g) {
    /* the eaves along the top: the roof's edge, rafter ends, a gutter of drips */
    var eave = Math.max(10, SILL * 0.1);
    var eg = g.createLinearGradient(0, 0, 0, eave);
    eg.addColorStop(0, "#0b0705"); eg.addColorStop(1, "#1d130d");
    g.fillStyle = eg; g.fillRect(0, 0, W, eave);
    var step = clamp(W / 26, 18, 40);
    for (var x = step * 0.3; x < W; x += step) { g.fillStyle = "#2a1c13"; g.fillRect(x, eave - 3, step * 0.36, 5); g.fillStyle = "rgba(255,190,120,0.08)"; g.fillRect(x, eave - 3, step * 0.36, 1); }
    /* posts at the sides, with lantern light on their faces */
    [POSTS.l, POSTS.r].forEach(function (px, i) {
      var pw = POSTS.w, x0 = px - pw / 2;
      var pg = g.createLinearGradient(x0, 0, x0 + pw, 0);
      if (i === 0) { pg.addColorStop(0, "#1a110b"); pg.addColorStop(0.6, "#3b2617"); pg.addColorStop(1, "#5a3a22"); }
      else { pg.addColorStop(0, "#3a2416"); pg.addColorStop(0.4, "#24170e"); pg.addColorStop(1, "#140c07"); }
      g.fillStyle = pg; g.fillRect(x0, 0, pw, SILL + 2);
      /* shoji slid back beside the post, glowing */
      var sw = Math.min(W * 0.16, 120), sx = i === 0 ? x0 - sw : x0 + pw;
      var shoji = g.createLinearGradient(0, eave, 0, SILL);
      shoji.addColorStop(0, "rgba(240,200,140,0.5)"); shoji.addColorStop(1, "rgba(200,140,80,0.38)");
      g.fillStyle = shoji; g.fillRect(sx, eave, sw, SILL - eave);
      g.strokeStyle = "rgba(40,24,12,0.75)"; g.lineWidth = 1.2;
      var cols = 3, rows = Math.max(3, Math.round((SILL - eave) / 26));
      for (var cI = 0; cI <= cols; cI++) { var lx = sx + sw * cI / cols; g.beginPath(); g.moveTo(lx, eave); g.lineTo(lx, SILL); g.stroke(); }
      for (var rI = 0; rI <= rows; rI++) { var ly = eave + (SILL - eave) * rI / rows; g.beginPath(); g.moveTo(sx, ly); g.lineTo(sx + sw, ly); g.stroke(); }
      g.fillStyle = "#2a1b11"; g.fillRect(i === 0 ? sx : sx + sw - 3, eave, 3, SILL - eave);
    });
  }

  /* --- the lantern: a paper chochin hanging from the eaves --- */
  function drawLantern(g) {
    var L = LAMP, r = L.r;
    g.strokeStyle = "rgba(20,12,8,0.9)"; g.lineWidth = 1.2;
    g.beginPath(); g.moveTo(L.x, 0); g.lineTo(L.x, L.y - r * 1.5); g.stroke();
    var glow = g.createRadialGradient(L.x, L.y, r * 0.5, L.x, L.y, r * 7);
    glow.addColorStop(0, "rgba(255,190,110,0.35)"); glow.addColorStop(0.4, "rgba(255,160,80,0.1)"); glow.addColorStop(1, "rgba(255,160,80,0)");
    g.globalCompositeOperation = "lighter"; g.fillStyle = glow; g.fillRect(L.x - r * 7, L.y - r * 7, r * 14, r * 14);
    g.globalCompositeOperation = "source-over";
    /* the paper body */
    var body = g.createRadialGradient(L.x - r * 0.25, L.y - r * 0.2, r * 0.1, L.x, L.y, r * 1.35);
    body.addColorStop(0, "#fff3cf"); body.addColorStop(0.45, "#f8c06e"); body.addColorStop(0.85, "#d97a2f"); body.addColorStop(1, "#a24d1c");
    g.fillStyle = body; g.beginPath(); g.ellipse(L.x, L.y, r, r * 1.3, 0, 0, Math.PI * 2); g.fill();
    /* bamboo ribs */
    g.strokeStyle = "rgba(140,70,24,0.35)"; g.lineWidth = 1;
    for (var i = -4; i <= 4; i++) {
      var yy = L.y + i * r * 0.27, hw = r * Math.sqrt(Math.max(0, 1 - Math.pow(i * 0.27 / 1.3, 2)));
      g.beginPath(); g.ellipse(L.x, yy, hw, hw * 0.12, 0, 0, Math.PI); g.stroke();
    }
    /* black lacquer caps */
    g.fillStyle = "#16100c";
    g.fillRect(L.x - r * 0.55, L.y - r * 1.42, r * 1.1, r * 0.2);
    g.fillRect(L.x - r * 0.55, L.y + r * 1.22, r * 1.1, r * 0.2);
    g.fillStyle = "rgba(255,210,150,0.3)"; g.fillRect(L.x - r * 0.55, L.y - r * 1.42, r * 1.1, 1);
  }

  /* --- the goban --- */
  function drawBoard(g) {
    /* legs: carved like gardenia fruit, only the near pair shows */
    [[-HW + 0.95, HD - LEG_IN], [HW - 0.95, HD - LEG_IN]].forEach(function (lp, i) { drawLeg(g, lp[0], lp[1], i); });
    /* the front face: kaya side grain, lit from above */
    var a = project(-HW, 0, HD), b = project(HW, 0, HD), c = project(HW, -BT, HD), d = project(-HW, -BT, HD);
    var fg = g.createLinearGradient(0, a.y, 0, d.y);
    fg.addColorStop(0, "#b7793a"); fg.addColorStop(0.18, "#9a612b"); fg.addColorStop(1, "#4a2a12");
    g.fillStyle = fg; polyPath(g, [a, b, c, d]); g.fill();
    g.save(); polyPath(g, [a, b, c, d]); g.clip();
    for (var i = 0; i < 70; i++) {
      var t = srnd(i * 3.17), x = lerp(a.x, b.x, t), wv = (srnd(i * 1.3) - 0.5) * 4;
      g.strokeStyle = srnd(i * 7.7) > 0.5 ? "rgba(60,30,10,0.16)" : "rgba(255,210,150,0.06)";
      g.lineWidth = 0.6 + srnd(i * 2.2) * 1.2;
      g.beginPath(); g.moveTo(x, a.y); g.quadraticCurveTo(x + wv, (a.y + d.y) / 2, x + wv * 0.4, d.y); g.stroke();
    }
    var side = g.createLinearGradient(a.x, 0, b.x, 0);
    side.addColorStop(0, "rgba(255,200,130,0.08)"); side.addColorStop(0.5, "rgba(0,0,0,0)"); side.addColorStop(1, "rgba(0,0,0,0.25)");
    g.fillStyle = side; g.fillRect(a.x, a.y, b.x - a.x, d.y - a.y);
    g.restore();
    /* the top, painted flat and laid onto its plane */
    var ext = { X0: -HW, X1: HW, Z0: -HD, Z1: HD };
    var ppu = Math.min(4096 / (2 * HW), maxScale() * dpr * 1.1);
    var tex = kayaTexture(ext, ppu);
    g.save(); g.setTransform(1, 0, 0, 1, 0, 0);
    mapPlane(g, tex, ext.X0, ext.X1, ext.Z0, ext.Z1, 0);
    g.restore();
    boardPoly = [project(-HW, 0, -HD), project(HW, 0, -HD), project(HW, 0, HD), project(-HW, 0, HD)];
    /* the lantern's warm reflection across the oiled top */
    g.save(); polyPath(g, boardPoly); g.clip();
    var hs = project(-1.8, 0, -1.6);
    var sheen = g.createRadialGradient(hs.x, hs.y, 0, hs.x, hs.y, hs.s * 6.5);
    sheen.addColorStop(0, "rgba(255,206,140,0.22)"); sheen.addColorStop(0.5, "rgba(255,186,120,0.07)"); sheen.addColorStop(1, "rgba(255,186,120,0)");
    g.globalCompositeOperation = "lighter"; g.fillStyle = sheen; g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = "source-over";
    var fall = g.createLinearGradient(boardPoly[0].x, 0, boardPoly[1].x, 0);
    fall.addColorStop(0, "rgba(0,0,0,0)"); fall.addColorStop(0.65, "rgba(0,0,0,0)"); fall.addColorStop(1, "rgba(30,10,0,0.18)");
    g.fillStyle = fall; g.fillRect(0, 0, W, H);
    g.restore();
    /* black lacquer lines, laid on with a blade, and the five star points */
    var s0 = project(0, 0, 0).s, lw = Math.max(1, s0 * 0.034);
    g.strokeStyle = "rgba(24,13,6,0.86)"; g.lineCap = "butt";
    for (var k = 0; k < 9; k++) {
      var x = (k - 4) * GX, z = (k - 4) * GZ;
      var p1 = project(x, 0, -4 * GZ), p2 = project(x, 0, 4 * GZ);
      g.lineWidth = lw; g.beginPath(); g.moveTo(p1.x, p1.y); g.lineTo(p2.x, p2.y); g.stroke();
      var q1 = project(-4 * GX, 0, z), q2 = project(4 * GX, 0, z);
      g.lineWidth = lw * (0.9 + 0.2 * (k / 8)); g.beginPath(); g.moveTo(q1.x, q1.y); g.lineTo(q2.x, q2.y); g.stroke();
    }
    K.STARS.forEach(function (p) {
      var sp = project(gx(p), 0, gz(p));
      g.fillStyle = "rgba(24,13,6,0.92)";
      g.beginPath(); g.ellipse(sp.x, sp.y, sp.s * 0.085, sp.s * 0.085 * SIN, 0, 0, Math.PI * 2); g.fill();
    });
    /* the rounded-over edge catching the lantern along the front and left */
    g.strokeStyle = "rgba(255,222,170,0.32)"; g.lineWidth = Math.max(1, s0 * 0.02);
    g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
    g.strokeStyle = "rgba(255,222,170,0.18)";
    g.beginPath(); g.moveTo(boardPoly[0].x, boardPoly[0].y); g.lineTo(boardPoly[1].x, boardPoly[1].y); g.stroke();
    g.beginPath(); g.moveTo(boardPoly[0].x, boardPoly[0].y); g.lineTo(boardPoly[3].x, boardPoly[3].y); g.stroke();
    g.strokeStyle = "rgba(40,18,6,0.45)"; g.lineWidth = 1;
    g.beginPath(); g.moveTo(a.x, a.y + 1.5); g.lineTo(b.x, b.y + 1.5); g.stroke();
  }
  function drawLeg(g, x, z, i) {
    var top = project(x, -BT, z), bot = project(x, FLOOR, z), s = top.s;
    var hw = s * 0.62, h = bot.y - top.y;
    var cx = top.x;
    var lg = g.createLinearGradient(cx - hw, 0, cx + hw, 0);
    lg.addColorStop(0, "#7a4a20"); lg.addColorStop(0.32, "#c2843f"); lg.addColorStop(0.62, "#7c4a1f"); lg.addColorStop(1, "#331a0b");
    /* shadow where it meets the mat */
    g.fillStyle = "rgba(0,0,0,0.55)";
    g.beginPath(); g.ellipse(cx + s * 0.25, bot.y, hw * 1.25, hw * 0.4, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = lg;
    g.beginPath();
    g.moveTo(cx - hw * 0.5, top.y);
    g.bezierCurveTo(cx - hw * 0.45, top.y + h * 0.18, cx - hw * 1.08, top.y + h * 0.3, cx - hw * 1.02, top.y + h * 0.6);
    g.bezierCurveTo(cx - hw * 0.98, top.y + h * 0.92, cx - hw * 0.4, bot.y, cx, bot.y);
    g.bezierCurveTo(cx + hw * 0.4, bot.y, cx + hw * 0.98, top.y + h * 0.92, cx + hw * 1.02, top.y + h * 0.6);
    g.bezierCurveTo(cx + hw * 1.08, top.y + h * 0.3, cx + hw * 0.45, top.y + h * 0.18, cx + hw * 0.5, top.y);
    g.closePath(); g.fill();
    /* the carved ridges of the fruit */
    g.strokeStyle = "rgba(30,14,4,0.45)"; g.lineWidth = 1;
    [-0.5, 0, 0.5].forEach(function (f) {
      g.beginPath(); g.moveTo(cx + f * hw * 0.5, top.y + h * 0.12); g.quadraticCurveTo(cx + f * hw * 1.4, top.y + h * 0.6, cx + f * hw * 0.5, bot.y - h * 0.04); g.stroke();
    });
    void i;
  }
  function kayaTexture(ext, ppu) {
    var tw = Math.ceil((ext.X1 - ext.X0) * ppu), th = Math.ceil((ext.Z1 - ext.Z0) * ppu);
    var c = document.createElement("canvas"); c.width = tw; c.height = th;
    var g = c.getContext("2d");
    var base = g.createLinearGradient(0, 0, tw, th);
    base.addColorStop(0, "#d9a75b"); base.addColorStop(0.5, "#cf9a4f"); base.addColorStop(1, "#bf8742");
    g.fillStyle = base; g.fillRect(0, 0, tw, th);
    /* masame: straight, close, even grain running the length of the board */
    var x = 0, i = 0;
    while (x < tw) {
      var gap = ppu * (0.05 + srnd(i * 1.37) * 0.11), late = srnd(i * 2.91);
      var wob = ppu * 0.02;
      g.strokeStyle = late > 0.82 ? "rgba(140,82,30,0.28)" : late > 0.5 ? "rgba(150,96,40,0.13)" : "rgba(255,226,170,0.08)";
      g.lineWidth = late > 0.82 ? Math.max(1, ppu * 0.022) : Math.max(0.6, ppu * 0.01);
      g.beginPath(); g.moveTo(x, 0);
      for (var y = 0; y <= th; y += th / 8) g.lineTo(x + Math.sin(y / th * 3 + i) * wob, y);
      g.stroke();
      x += gap; i++;
    }
    /* soft figure, so it is not too perfect */
    for (var k = 0; k < 40; k++) {
      var fx = srnd(k * 3.3) * tw, fy = srnd(k * 5.7) * th, fr = ppu * (0.6 + srnd(k) * 2.2);
      var fg2 = g.createRadialGradient(fx, fy, 0, fx, fy, fr);
      fg2.addColorStop(0, srnd(k * 9.1) > 0.5 ? "rgba(255,220,160,0.06)" : "rgba(120,70,20,0.06)"); fg2.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = fg2; g.fillRect(fx - fr, fy - fr, fr * 2, fr * 2);
    }
    return c;
  }

  /* --- a chestnut bowl, and its lid turned over beside it for prisoners --- */
  function drawProp(g, bw, ld, mine) {
    drawLidShell(g, ld);
    drawBowl(g, bw, mine ? human : cpu);
  }
  function drawBowl(g, bw, color) {
    var base = project(bw.x, FLOOR, bw.z), rim = project(bw.x, FLOOR + BOWL_H, bw.z), mid = project(bw.x, FLOOR + BOWL_H * 0.5, bw.z);
    var s = mid.s, R = BOWL_R * s, rr = R * 0.8, br = R * 0.62;
    /* shadow on the mat */
    g.fillStyle = "rgba(0,0,0,0.5)";
    g.beginPath(); g.ellipse(base.x + R * 0.3, base.y + R * 0.06 * SIN, R * 1.15, R * 1.1 * SIN, 0, 0, Math.PI * 2); g.fill();
    /* the turned body */
    var bg = g.createLinearGradient(mid.x - R, 0, mid.x + R, 0);
    bg.addColorStop(0, "#5a2e15"); bg.addColorStop(0.28, "#9b5a2b"); bg.addColorStop(0.55, "#6e3a1a"); bg.addColorStop(1, "#24110a");
    g.fillStyle = bg;
    g.beginPath();
    g.moveTo(rim.x - rr, rim.y);
    g.bezierCurveTo(rim.x - R * 1.06, rim.y + (mid.y - rim.y) * 0.6, mid.x - R * 1.05, mid.y + (base.y - mid.y) * 0.5, base.x - br, base.y);
    g.ellipse(base.x, base.y, br, br * SIN, 0, Math.PI, 0, true);
    g.bezierCurveTo(mid.x + R * 1.05, mid.y + (base.y - mid.y) * 0.5, rim.x + R * 1.06, rim.y + (mid.y - rim.y) * 0.6, rim.x + rr, rim.y);
    g.ellipse(rim.x, rim.y, rr, rr * SIN, 0, 0, Math.PI, false);
    g.closePath(); g.fill();
    /* growth rings from the lathe */
    g.save(); g.clip();
    for (var i = 1; i < 9; i++) {
      var t = i / 9, yy = lerp(rim.y, base.y, t), wr = lerp(rr, br, t) + Math.sin(t * Math.PI) * R * 0.28;
      g.strokeStyle = i % 2 ? "rgba(40,16,4,0.22)" : "rgba(255,190,120,0.07)"; g.lineWidth = 1;
      g.beginPath(); g.ellipse(rim.x, yy, wr, wr * SIN, 0, 0.1, Math.PI - 0.1); g.stroke();
    }
    var sh = g.createRadialGradient(mid.x - R * 0.45, mid.y - R * 0.3 * SIN, 0, mid.x - R * 0.45, mid.y - R * 0.3 * SIN, R * 0.8);
    sh.addColorStop(0, "rgba(255,210,150,0.2)"); sh.addColorStop(1, "rgba(255,210,150,0)");
    g.fillStyle = sh; g.fillRect(mid.x - R * 1.2, rim.y - R, R * 2.4, base.y - rim.y + R * 2);
    g.restore();
    /* the mouth, full of stones */
    g.fillStyle = "#1a0c06"; g.beginPath(); g.ellipse(rim.x, rim.y, rr, rr * SIN, 0, 0, Math.PI * 2); g.fill();
    g.save(); g.beginPath(); g.ellipse(rim.x, rim.y, rr * 0.93, rr * 0.93 * SIN, 0, 0, Math.PI * 2); g.clip();
    var heapY = FLOOR + BOWL_H - 0.12;
    var n = 26;
    var list = [];
    for (var k = 0; k < n; k++) {
      var a = k * 2.39996 + srnd(k) * 0.4, d = Math.sqrt((k + 0.5) / n) * BOWL_R * 0.72;
      list.push({ x: bw.x + Math.cos(a) * d, z: bw.z + Math.sin(a) * d * 0.95, y: heapY + (1 - d / BOWL_R) * 0.18, v: k });
    }
    list.sort(function (p, q) { return p.z - q.z; });
    list.forEach(function (st) { blit(g, stoneSprite(color, st.v), st.x, st.y, st.z, 1, 0.92); });
    g.restore();
    g.strokeStyle = "rgba(196,120,64,0.9)"; g.lineWidth = Math.max(1.5, s * 0.05);
    g.beginPath(); g.ellipse(rim.x, rim.y, rr, rr * SIN, 0, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = "rgba(255,206,150,0.4)"; g.lineWidth = Math.max(1, s * 0.02);
    g.beginPath(); g.ellipse(rim.x, rim.y, rr, rr * SIN, 0, Math.PI * 1.08, Math.PI * 1.7); g.stroke();
    g.strokeStyle = "rgba(20,8,2,0.6)"; g.lineWidth = 1;
    g.beginPath(); g.ellipse(rim.x, rim.y, rr, rr * SIN, 0, 0.1, Math.PI - 0.1); g.stroke();
  }
  function drawLidShell(g, ld) {
    var base = project(ld.x, FLOOR, ld.z), top = project(ld.x, FLOOR + LID_H, ld.z), s = top.s, R = LID_R * s;
    g.fillStyle = "rgba(0,0,0,0.45)";
    g.beginPath(); g.ellipse(base.x + R * 0.25, base.y + 2, R * 1.08, R * 1.05 * SIN, 0, 0, Math.PI * 2); g.fill();
    var lg = g.createLinearGradient(top.x - R, 0, top.x + R, 0);
    lg.addColorStop(0, "#4d2611"); lg.addColorStop(0.3, "#8c4f25"); lg.addColorStop(1, "#22100a");
    g.fillStyle = lg;
    g.beginPath();
    g.ellipse(top.x, top.y, R, R * SIN, 0, Math.PI, 0, true);
    g.lineTo(base.x + R * 0.94, base.y);
    g.ellipse(base.x, base.y, R * 0.94, R * 0.94 * SIN, 0, 0, Math.PI, false);
    g.closePath(); g.fill();
    /* the hollow, where the prisoners go */
    var ig = g.createRadialGradient(top.x - R * 0.3, top.y - R * 0.2 * SIN, 0, top.x, top.y, R);
    ig.addColorStop(0, "#9a5c2e"); ig.addColorStop(0.7, "#6a3818"); ig.addColorStop(1, "#3a1b0b");
    g.fillStyle = ig; g.beginPath(); g.ellipse(top.x, top.y, R * 0.92, R * 0.92 * SIN, 0, 0, Math.PI * 2); g.fill();
    for (var i = 1; i < 5; i++) {
      g.strokeStyle = "rgba(40,16,4,0.18)"; g.lineWidth = 1;
      g.beginPath(); g.ellipse(top.x, top.y, R * 0.92 * i / 5, R * 0.92 * i / 5 * SIN, 0, 0, Math.PI * 2); g.stroke();
    }
    g.strokeStyle = "rgba(255,200,140,0.32)"; g.lineWidth = Math.max(1, s * 0.022);
    g.beginPath(); g.ellipse(top.x, top.y, R, R * SIN, 0, Math.PI * 1.1, Math.PI * 1.7); g.stroke();
  }
  /* where the k-th prisoner sits in a lid */
  function lidSpot(ld, k) {
    var ring = Math.floor(k / 22), j = k % 22;
    var a = j * 2.39996 + ring * 1.3, d = Math.sqrt((j + 0.5) / 22) * LID_R * 0.56;
    return { x: ld.x + Math.cos(a) * d, z: ld.z + Math.sin(a) * d * 0.95, y: FLOOR + 0.08 + ring * 0.13 };
  }
  function lidOf(capturer) { return capturer === human ? PROPS.myLid : PROPS.thLid; }

  /* ================= per-frame drawing ================= */
  var lastT = 0, frameDt = 16, tNow = 0;
  var rain = [], splashes = [], drips = [];
  function seedWeather() {
    rain = [];
    for (var i = 0; i < 110; i++) rain.push({ x: Math.random(), y: Math.random(), v: 0.0011 + Math.random() * 0.0009, l: 8 + Math.random() * 14, a: 0.08 + Math.random() * 0.14 });
    leaves = [];
    for (var k = 0; k < 6; k++) leaves.push(newLeaf(true));
  }
  function newLeaf(anywhere) {
    return { x: Math.random(), y: anywhere ? Math.random() : -0.05, v: 0.00004 + Math.random() * 0.00005, sw: Math.random() * 6, r: 2 + Math.random() * 3, rot: Math.random() * 6, spin: (Math.random() - 0.5) * 0.004, hue: Math.random() };
  }

  function draw(now) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (backCv) ctx.drawImage(backCv, 0, 0, backCv.width, backCv.height, 0, 0, W, H);
    /* the other layers are drawn only where they have something, which keeps the
       per-frame fill small on a big, dense screen */
    drawWeather(now);
    if (lampCv) blitRect(lampCv, RECT.lamp);
    drawLidStones(PROPS.thLid, false);
    if (boardCv) blitRect(boardCv, RECT.board);
    drawLampLight(now);
    if ((terrOn && phase === "play" && own) || (count && count.owner && (phase === "count" || phase === "over"))) {
      if (terrDirty) paintTerritory();
      blitRect(terrCv, RECT.top);
    }
    drawStones(now);
    drawLidStones(PROPS.myLid, true);
    drawMarks(now);
    drawFlights(now);
    drawParticles();
    drawWinLeaf(now);
  }

  function blitRect(cv, r) {
    if (!r || r.w <= 0 || r.h <= 0) return;
    ctx.drawImage(cv, r.x * dpr, r.y * dpr, r.w * dpr, r.h * dpr, r.x, r.y, r.w, r.h);
  }
  function rectOf(pts, pad) {
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    pts.forEach(function (p) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); });
    x0 = Math.max(0, Math.floor(x0 - pad)); y0 = Math.max(0, Math.floor(y0 - pad));
    x1 = Math.min(W, Math.ceil(x1 + pad)); y1 = Math.min(H, Math.ceil(y1 + pad));
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  function measureRects() {
    var pts = [];
    [[-HW, -HD], [HW, -HD], [HW, HD], [-HW, HD]].forEach(function (c) { pts.push(project(c[0], 0, c[1]), project(c[0], FLOOR, c[1])); });
    var top = rectOf(pts.filter(function (p, i) { return i % 2 === 0; }), 4);
    [PROPS.myBowl, PROPS.myLid].forEach(function (b) {
      var r = BOWL_R * 1.3;
      [[-r, 0], [r, 0], [0, -r], [0, r]].forEach(function (d) { pts.push(project(b.x + d[0], FLOOR, b.z + d[1]), project(b.x + d[0], FLOOR + BOWL_H + 0.4, b.z + d[1])); });
    });
    var board = rectOf(pts, 40);
    var lr = LAMP.r * 7.2;
    RECT = { board: board, top: top, lamp: rectOf([{ x: LAMP.x - lr, y: 0 }, { x: LAMP.x + lr, y: LAMP.y + lr }], 2) };
  }

  function drawWeather(now) {
    var dt = frameDt, still = reduced();
    var x0 = POSTS.l + POSTS.w / 2, x1 = POSTS.r - POSTS.w / 2, y0 = Math.max(8, SILL * 0.1), y1 = SILL - ENG;
    ctx.save();
    ctx.beginPath(); ctx.rect(x0, y0, x1 - x0, SILL - y0); ctx.clip();
    /* maple leaves drifting down behind the rain */
    for (var i = 0; i < leaves.length; i++) {
      var lf = leaves[i];
      if (!still) { lf.y += lf.v * dt; lf.rot += lf.spin * dt; lf.sw += dt * 0.0012; }
      if (lf.y > 1.05) leaves[i] = lf = newLeaf(false);
      var lx = x0 + (lf.x + Math.sin(lf.sw) * 0.02) * (x1 - x0), ly = y0 + lf.y * (y1 - y0);
      ctx.fillStyle = lf.hue > 0.5 ? "rgba(190,64,40,0.85)" : "rgba(140,38,28,0.85)";
      leafPath(ctx, lx, ly, lf.r, lf.rot); ctx.fill();
    }
    /* the rain */
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(176,198,228,0.16)";
    ctx.beginPath();
    for (var k = 0; k < rain.length; k++) {
      var r = rain[k];
      if (!still) r.y += r.v * dt;
      if (r.y > 1.08) { r.y -= 1.12; r.x = Math.random(); if (Math.random() < 0.5) splashes.push({ x: x0 + r.x * (x1 - x0), y: y1 + 2 + Math.random() * (ENG - 6), t: 0 }); }
      var x = x0 + r.x * (x1 - x0), y = y0 + r.y * (y1 - y0);
      ctx.moveTo(x, y); ctx.lineTo(x - r.l * 0.12, y + r.l);
    }
    ctx.stroke();
    /* drips off the eaves, fat and slow */
    if (!still && Math.random() < dt / 260) drips.push({ x: x0 + Math.random() * (x1 - x0), y: y0, v: 0.18 + Math.random() * 0.1 });
    ctx.strokeStyle = "rgba(200,220,245,0.32)"; ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (var d = drips.length - 1; d >= 0; d--) {
      var dp = drips[d];
      dp.y += dp.v * dt; dp.v += 0.0006 * dt;
      if (dp.y > y1 + 4) { splashes.push({ x: dp.x, y: y1 + 3, t: 0, big: 1 }); drips.splice(d, 1); continue; }
      ctx.moveTo(dp.x, dp.y); ctx.lineTo(dp.x, dp.y + 7);
    }
    ctx.stroke();
    /* splashes on the engawa */
    for (var j = splashes.length - 1; j >= 0; j--) {
      var sp = splashes[j];
      sp.t += dt / (sp.big ? 420 : 300);
      if (sp.t >= 1) { splashes.splice(j, 1); continue; }
      var rr = (sp.big ? 7 : 3.5) * sp.t + 0.5;
      ctx.strokeStyle = "rgba(200,220,245," + (0.3 * (1 - sp.t)) + ")";
      ctx.beginPath(); ctx.ellipse(sp.x, sp.y, rr, rr * 0.3, 0, Math.PI, 0); ctx.stroke();
    }
    if (splashes.length > 80) splashes.splice(0, splashes.length - 80);
    ctx.restore();
  }

  /* the lantern breathes: a soft flicker, brighter for a win */
  function drawLampLight(now) {
    var f = reduced() ? 0 : Math.sin(now * 0.0017) * 0.04 + Math.sin(now * 0.0061 + 1.3) * 0.025 + Math.sin(now * 0.0123) * 0.015;
    var a = 0.08 + f + lampBoost * 0.12;
    if (a <= 0) return;
    /* the breathing reaches the lantern's own corner of the room; only a win lights
       the whole room up */
    var L = LAMP, reach = Math.max(W, H) * 0.42;
    var gr = ctx.createRadialGradient(L.x, L.y, L.r, L.x, L.y, reach);
    gr.addColorStop(0, "rgba(255,180,100," + a + ")"); gr.addColorStop(0.5, "rgba(255,160,90," + (a * 0.3) + ")"); gr.addColorStop(1, "rgba(255,160,90,0)");
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = gr;
    var gx0 = Math.max(0, L.x - reach), gy0 = Math.max(0, L.y - reach);
    ctx.fillRect(gx0, gy0, Math.min(W, L.x + reach) - gx0, Math.min(H, L.y + reach) - gy0);
    if (lampBoost > 0) { ctx.fillStyle = "rgba(255,170,90," + (lampBoost * 0.07) + ")"; ctx.fillRect(0, 0, W, H); }
    var core = ctx.createRadialGradient(L.x, L.y, 0, L.x, L.y, L.r * 2.2);
    core.addColorStop(0, "rgba(255,230,170," + (0.22 + f * 2) + ")"); core.addColorStop(1, "rgba(255,200,120,0)");
    ctx.fillStyle = core; ctx.fillRect(L.x - L.r * 2.2, L.y - L.r * 2.2, L.r * 4.4, L.r * 4.4);
    ctx.globalCompositeOperation = "source-over";
  }

  /* The live territory wash: one soft gaussian blob per point, summed ADDITIVELY into a
     mask per color (so a solid area comes out even, with no seams between points), then
     tinted. Painted at full resolution, only when ownership changes. */
  var washMask = null;
  function paintWash(full) {
    if (!own) return;
    if (!washMask) washMask = document.createElement("canvas");
    washMask.width = terrCv.width; washMask.height = terrCv.height;
    var m = washMask.getContext("2d");
    /* a sigma of 0.5 cell sums to a flat field on a unit lattice (within ~1.5%) */
    var SIG = 0.5, R = SIG * 3, NORM = 1 / (2 * Math.PI * SIG * SIG);
    [[1, "10,7,5", 0.8], [-1, "255,251,240", 0.72]].forEach(function (side) {
      m.setTransform(1, 0, 0, 1, 0, 0); m.globalCompositeOperation = "source-over";
      m.clearRect(0, 0, washMask.width, washMask.height);
      m.globalCompositeOperation = "lighter";
      var any = false;
      K.POINTS.forEach(function (p) {
        var o = own[p] * side[0];
        if (o < 0.12) return;
        any = true;
        var a = Math.min(1, o) * side[2] * NORM;
        var c = project(gx(p), 0, gz(p));
        m.setTransform(dpr * GX * c.s, 0, 0, dpr * GZ * c.s * SIN, dpr * c.x, dpr * c.y);
        var gr = m.createRadialGradient(0, 0, 0, 0, 0, R);
        /* gaussian falloff, sampled at 0, 0.5, 1, 1.5, 2, 2.5, 3 sigma */
        [1, 0.8825, 0.6065, 0.3247, 0.1353, 0.0439, 0].forEach(function (v, i) {
          gr.addColorStop(i / 6, "rgba(255,255,255," + (a * v) + ")");
        });
        m.fillStyle = gr;
        m.fillRect(-R, -R, R * 2, R * 2);
      });
      if (!any) return;
      m.setTransform(1, 0, 0, 1, 0, 0);
      m.globalCompositeOperation = "source-in";
      m.fillStyle = "rgb(" + side[1] + ")";
      m.fillRect(0, 0, washMask.width, washMask.height);
      full.setTransform(1, 0, 0, 1, 0, 0);
      full.drawImage(washMask, 0, 0);
    });
    m.globalCompositeOperation = "source-over";
  }

  /* the territory wash (play) or the count (counting), baked once per change */
  function paintTerritory() {
    terrDirty = false;
    var full = terrCv.getContext("2d");
    full.setTransform(1, 0, 0, 1, 0, 0); full.clearRect(0, 0, terrCv.width, terrCv.height);
    var map = count && count.owner ? count.owner : null;
    if (!map) { paintWash(full); return; }
    var g = full;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    K.POINTS.forEach(function (p) {
      var o = map[p] === BLACK ? 0.85 : map[p] === WHITE ? -0.85 : 0;
      if (!o) return;
      var x = gx(p), z = gz(p), hx = GX * 0.5, hz = GZ * 0.5;
      var q = [project(x - hx, 0, z - hz), project(x + hx, 0, z - hz), project(x + hx, 0, z + hz), project(x - hx, 0, z + hz)];
      g.fillStyle = o > 0 ? "rgba(12,8,6," + (0.85 * 0.66) + ")" : "rgba(255,251,240," + (0.85 * 0.6) + ")";
      polyPath(g, q); g.fill();
    });
    if (map) {
      /* small squares on counted points, like a scorer's tokens */
      K.POINTS.forEach(function (p) {
        var stoneHere = pos.b[p] !== 0 && !(count.dead[p]);
        if (stoneHere || !map[p]) return;
        var c = project(gx(p), 0, gz(p)), sz = c.s * 0.2;
        g.fillStyle = map[p] === BLACK ? "#17120e" : "#f7f2e6";
        g.strokeStyle = map[p] === BLACK ? "rgba(255,230,190,0.35)" : "rgba(60,40,20,0.5)";
        g.lineWidth = 1;
        g.beginPath(); g.rect(c.x - sz, c.y - sz * SIN, sz * 2, sz * 2 * SIN); g.fill(); g.stroke();
      });
    }
  }

  function drawStones(now) {
    var list = [];
    for (var k in stones) list.push(stones[k]);
    list.sort(function (a, b) { return a.z - b.z || a.x - b.x; });
    /* shadows first, so a neighbor's shadow never lands on a stone */
    for (var i = 0; i < list.length; i++) {
      var st = list[i], lift = stoneLift(st, now);
      var dead = count && count.dead[st.p];
      blit(ctx, spr.shadow, st.x + SHX + lift * 0.25, 0, st.z + SHZ + lift * 0.2, (dead ? 0.35 : 1) * (1 - Math.min(0.7, lift * 0.8)));
    }
    for (var j = 0; j < list.length; j++) {
      var s2 = list[j], l2 = stoneLift(s2, now);
      var dd = count && count.dead[s2.p];
      var settle = s2.settle > 0 ? 1 + Math.sin(s2.settle * Math.PI) * 0.025 : 1;
      var p = blit(ctx, stoneSprite(s2.color, s2.v), s2.x, l2, s2.z, dd ? 0.42 : 1, settle);
      if (dd) {
        var r = p.s * 0.17;
        ctx.strokeStyle = s2.color === BLACK ? "rgba(255,236,206,0.9)" : "rgba(40,24,14,0.85)"; ctx.lineWidth = Math.max(1.5, p.s * 0.045);
        var cy = p.y - SH * COS * p.s * 0.6;
        ctx.beginPath(); ctx.moveTo(p.x - r, cy - r * SIN); ctx.lineTo(p.x + r, cy + r * SIN); ctx.moveTo(p.x + r, cy - r * SIN); ctx.lineTo(p.x - r, cy + r * SIN); ctx.stroke();
      }
    }
  }
  function stoneLift(st, now) {
    if (st.drop > 0) return st.drop;
    return 0;
  }

  function drawLidStones(ld, mine) {
    var capturer = mine ? human : cpu, n = Math.min(lidShown[capturer], 68), color = 3 - capturer;
    if (!n) return;
    for (var k = 0; k < n; k++) {
      var sp = lidSpot(ld, k);
      blit(ctx, stoneSprite(color, k), sp.x, sp.y, sp.z, 1, 0.9);
    }
    if (lidShown[capturer] > 0) {
      var top = project(ld.x, FLOOR + LID_H, ld.z);
      var lx = top.x, ly = top.y - LID_R * top.s * SIN - 9;
      ctx.font = "800 12px Manrope, system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      var label = String(lidShown[capturer]);
      var tw = ctx.measureText(label).width + 12;
      ctx.fillStyle = "rgba(20,14,11,0.78)"; rrect(ctx, lx - tw / 2, ly - 9, tw, 18, 9); ctx.fill();
      ctx.fillStyle = "#f6eadb"; ctx.fillText(label, lx, ly + 0.5);
    }
  }
  function rrect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }

  function drawMarks(now) {
    /* the last move */
    var last = pos.last;
    if (last > 0 && stones[last] && phase !== "menu") {
      var st = stones[last], p = project(st.x, SH * 0.98 + st.drop, st.z), r = p.s * 0.19;
      ctx.strokeStyle = st.color === BLACK ? "rgba(255,234,200,0.92)" : "rgba(36,22,12,0.85)";
      ctx.lineWidth = Math.max(1.6, p.s * 0.05);
      ctx.beginPath(); ctx.ellipse(p.x, p.y, r, r * SIN, 0, 0, Math.PI * 2); ctx.stroke();
    }
    /* the ghost: where a tap would play */
    var gp = ghost || (cursor && phase === "play" ? cursor : 0);
    if (gp && phase === "play" && !stones[gp]) {
      var shake = shakeT > 0 ? Math.sin(shakeT * 40) * shakeT * 0.12 : 0;
      var x = gx(gp) + shake, z = gz(gp);
      var c = project(x, 0, z);
      var showCross = ghostKind === "touch" || ghostKind === "key";
      if (showCross) {
        /* lines along the row and the column, so the point is clear around a finger */
        ctx.strokeStyle = "rgba(196,58,30,0.62)"; ctx.lineWidth = Math.max(1.5, c.s * 0.045);
        var a1 = project(x, 0, -4 * GZ - 0.4), a2 = project(x, 0, 4 * GZ + 0.4), b1 = project(-4 * GX - 0.4, 0, z), b2 = project(4 * GX + 0.4, 0, z);
        ctx.beginPath(); ctx.moveTo(a1.x, a1.y); ctx.lineTo(a2.x, a2.y); ctx.moveTo(b1.x, b1.y); ctx.lineTo(b2.x, b2.y); ctx.stroke();
        ctx.strokeStyle = "rgba(196,58,30,0.85)"; ctx.lineWidth = 2.2;
        ctx.beginPath(); ctx.ellipse(c.x, c.y, c.s * 0.78, c.s * 0.78 * SIN, 0, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = "rgba(255,236,200,0.5)"; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.ellipse(c.x, c.y, c.s * 0.78 + 2, (c.s * 0.78 + 2) * SIN, 0, 0, Math.PI * 2); ctx.stroke();
      }
      if (ghostBad) {
        ctx.strokeStyle = "rgba(224,96,80,0.9)"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.ellipse(c.x, c.y, c.s * 0.42, c.s * 0.42 * SIN, 0, 0, Math.PI * 2); ctx.stroke();
        var rx = c.s * 0.2;
        ctx.beginPath(); ctx.moveTo(c.x - rx, c.y - rx * SIN); ctx.lineTo(c.x + rx, c.y + rx * SIN); ctx.moveTo(c.x + rx, c.y - rx * SIN); ctx.lineTo(c.x - rx, c.y + rx * SIN); ctx.stroke();
      } else {
        blit(ctx, stoneSprite(human, 1), x, 0, z, ghostKind === "touch" ? 0.66 : 0.5);
      }
    }
  }

  function drawFlights(now) {
    for (var i = 0; i < flights.length; i++) {
      var f = flights[i], t = clamp((now - f.t0) / f.dur, 0, 1);
      if (t <= 0) continue;
      var e = ease(t);
      var x = lerp(f.x0, f.x1, e), z = lerp(f.z0, f.z1, e), y = lerp(f.y0, f.y1, e) + Math.sin(t * Math.PI) * f.arc;
      blit(ctx, spr.shadow, x + SHX, Math.max(FLOOR, Math.min(0, y - 0.3)), z + SHZ, 0.25 * (1 - t));
      blit(ctx, stoneSprite(f.color, f.v), x, y, z, 1, 1 - 0.08 * t);
    }
  }
  function drawParticles() {
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      ctx.fillStyle = "rgba(255,226,170," + (p.life * 0.5) + ")";
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
    }
  }
  function drawWinLeaf(now) {
    if (!winLeaf) return;
    var t = clamp((now - winLeaf.t0) / winLeaf.dur, 0, 1), e = 1 - Math.pow(1 - t, 2);
    var x = lerp(winLeaf.x0, winLeaf.x1, e) + Math.sin(t * 9) * 0.35 * (1 - t);
    var z = lerp(winLeaf.z0, winLeaf.z1, e), y = lerp(winLeaf.y0, 0.02, e);
    var p = project(x, y, z), r = p.s * 0.46;
    var sh = project(x + y * 0.3, 0, z + y * 0.25);
    ctx.fillStyle = "rgba(30,12,4," + (0.25 * e) + ")";
    leafPath(ctx, sh.x, sh.y, r, winLeaf.rot + t * 3); ctx.fill();
    ctx.fillStyle = "rgba(204,72,42,0.95)";
    leafPath(ctx, p.x, p.y, r, winLeaf.rot + t * 3); ctx.fill();
    ctx.strokeStyle = "rgba(110,26,14,0.7)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + Math.cos(winLeaf.rot + t * 3 + 1.6) * r * 1.4, p.y + Math.sin(winLeaf.rot + t * 3 + 1.6) * r * 1.4); ctx.stroke();
  }

  function tick(now) {
    var dt = Math.min(48, now - lastT); lastT = now; frameDt = dt; tNow = now;
    /* stones dropping into place, then settling */
    for (var k in stones) {
      var st = stones[k];
      if (st.drop > 0) {
        st.vy -= 0.00007 * dt;
        st.drop = Math.max(0, st.drop + st.vy * dt);
        if (st.drop === 0) { st.settle = 1; if (st.onLand) { var f = st.onLand; st.onLand = null; f(); } }
      } else if (st.settle > 0) st.settle = Math.max(0, st.settle - dt / 160);
    }
    for (var i = flights.length - 1; i >= 0; i--) {
      var fl = flights[i];
      if (now - fl.t0 >= fl.dur) { flights.splice(i, 1); if (fl.done) fl.done(); }
    }
    for (var j = parts.length - 1; j >= 0; j--) {
      var p = parts[j]; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 0.00012 * dt; p.life -= dt / 900;
      if (p.life <= 0) parts.splice(j, 1);
    }
    if (shakeT > 0) shakeT = Math.max(0, shakeT - dt / 420);
    if (winLeaf && now - winLeaf.t0 > winLeaf.dur + 6000) winLeaf = null;
    var t0 = performance.now();
    draw(now);
    var ft = performance.now() - t0;
    perf.n++; perf.sum += ft; if (ft > perf.max) perf.max = ft;
    requestAnimationFrame(tick);
  }

  /* ================= stones on the board ================= */
  function addStone(p, color, animate, onLand) {
    var jx = (srnd(p * 3.1 + pos.plies * 0.7) - 0.5) * 0.09, jz = (srnd(p * 5.3 + pos.plies * 1.3) - 0.5) * 0.09;
    if (Math.abs(jx) < 0.012) jx = jx < 0 ? -0.018 : 0.018;            /* never dead center */
    var st = { p: p, color: color, x: gx(p) + jx, z: gz(p) + jz, v: (Math.random() * 8) | 0, drop: 0, vy: 0, settle: 0, onLand: null };
    if (animate && !reduced()) { st.drop = 0.55; st.vy = -0.0012; st.onLand = onLand; }
    stones[p] = st;
    if (!animate || reduced()) { st.settle = animate ? 1 : 0; if (onLand) onLand(); }
    return st;
  }
  function placeAll() {
    stones = {};
    K.POINTS.forEach(function (p) { if (pos.b[p]) addStone(p, pos.b[p], false); });
  }

  /* captured stones lift off and fly to the capturer's lid */
  function capture(caps, capturer, done) {
    if (!caps.length) { done(); return; }
    var ld = lidOf(capturer), t0 = now(), fast = reduced();
    A.pickup(caps.length, panOf(caps[0]));
    var left = caps.length;
    caps.forEach(function (p, i) {
      var st = stones[p];
      delete stones[p];
      if (!st) { if (--left === 0) done(); return; }
      var k = lidShown[capturer] + i, spot = lidSpot(ld, k);
      flights.push({ color: st.color, v: st.v, x0: st.x, z0: st.z, y0: 0, x1: spot.x, z1: spot.z, y1: spot.y,
        arc: fast ? 0 : 2.6 + Math.random() * 0.6, t0: t0 + (fast ? 0 : i * 55), dur: fast ? 1 : 620 + Math.random() * 80,
        done: function () {
          lidShown[capturer]++;
          if (--left === 0) { A.lid(caps.length, panX(ld.x), 3 - capturer); done(); }
        } });
      var c = project(st.x, 0, st.z);
      for (var q = 0; q < 4; q++) parts.push({ x: c.x, y: c.y, vx: (Math.random() - 0.5) * 0.05, vy: -0.03 - Math.random() * 0.04, r: 1 + Math.random() * 1.4, life: 1 });
    });
  }

  /* ================= input ================= */
  function local(ev) { var r = canvas.getBoundingClientRect(); return { x: ev.clientX - r.left, y: ev.clientY - r.top }; }
  function pointAt(px, py, loose) {
    var w = unproject(px, py, 0);
    var fx = w.x / GX + 4, fz = w.z / GZ + 4, lim = loose ? 0.9 : 0.55;
    if (fx < -lim || fx > 8 + lim || fz < -lim || fz > 8 + lim) return 0;
    return K.pt(clamp(Math.round(fx), 0, 8), clamp(Math.round(fz), 0, 8));
  }
  var WHY = {
    occupied: "That point is taken",
    suicide: "That stone would have no liberties",
    ko: "Ko: play elsewhere first",
    superko: "That would repeat an earlier position"
  };
  function why(p) {
    if (pos.b[p]) return "occupied";
    var r = K.tryMove(pos, p);
    return r.ok ? "" : r.why;
  }
  function deny(p, reason) {
    A.deny();
    ghost = p; ghostBad = reason; shakeT = 1;
    note(WHY[reason] || "You can't play there", 1900);
  }
  function tryPlay(p) {
    if (!myTurn()) return false;
    var w = why(p);
    if (w) { deny(p, w); return false; }
    ghost = 0; ghostBad = ""; cursor = 0; touchArm = 0;
    commit(p);
    return true;
  }

  canvas.addEventListener("pointerdown", function (ev) {
    A.init();
    if (phase === "count") { var q = local(ev), cp = pointAt(q.x, q.y, false); if (cp && pos.b[cp]) toggleDead(cp); return; }
    if (phase !== "play") return;
    var pt0 = local(ev), p = pointAt(pt0.x, pt0.y, ev.pointerType !== "mouse");
    if (ev.pointerType === "mouse") {
      if (p && myTurn()) press = { p: p, id: ev.pointerId, mouse: true };
      return;
    }
    /* touch: the first tap aims, a second tap on the same point plays */
    if (!p) { ghost = 0; ghostBad = ""; return; }
    press = { p: p, id: ev.pointerId, mouse: false, armed: ghost === p && touchArm === p, moved: false };
    if (!press.armed) {
      ghost = p; ghostKind = "touch"; ghostBad = myTurn() ? why(p) : "";
      if (ghostBad === "occupied") ghostBad = "";
      A.tick(panOf(p));
    }
    try { canvas.setPointerCapture(ev.pointerId); } catch (e) {}
  });
  canvas.addEventListener("pointermove", function (ev) {
    if (phase !== "play") return;
    var q = local(ev);
    if (press && ev.pointerId === press.id && !press.mouse) {
      /* sliding a finger walks the aim around, without playing */
      var p = pointAt(q.x, q.y, true);
      if (p && p !== ghost) { ghost = p; ghostKind = "touch"; ghostBad = myTurn() ? why(p) : ""; if (ghostBad === "occupied") ghostBad = ""; press.moved = true; press.armed = false; A.tick(panOf(p)); }
      return;
    }
    if (ev.pointerType === "mouse") {
      var m = pointAt(q.x, q.y, false);
      ghostKind = "mouse";
      ghost = m && myTurn() && !pos.b[m] ? m : 0;
      ghostBad = "";
      canvas.style.cursor = ghost ? "pointer" : "default";
    }
  });
  function endPress(ev) {
    if (!press || ev.pointerId !== press.id) return;
    var pr = press; press = null;
    if (ev.type === "pointercancel") return;
    var q = local(ev);
    if (pr.mouse) {
      var p = pointAt(q.x, q.y, false);
      if (p === pr.p) tryPlay(p);
      return;
    }
    if (pr.armed && !pr.moved) {
      if (pointAt(q.x, q.y, true) === pr.p) tryPlay(pr.p);
      return;
    }
    /* aimed: the next tap on this point will play it */
    touchArm = ghost;
    if (myTurn() && ghost && why(ghost) && why(ghost) !== "occupied") note(WHY[why(ghost)], 1700);
    else if (myTurn() && ghost && aimTold < 3) { aimTold++; note("Tap the same point again to place your stone", 2000); }
  }
  canvas.addEventListener("pointerup", endPress);
  canvas.addEventListener("pointercancel", endPress);
  canvas.addEventListener("pointerleave", function (ev) { if (ev.pointerType === "mouse" && ghostKind === "mouse") ghost = 0; });

  /* ================= game flow ================= */
  function commit(p) {
    var color = pos.turn, rec;
    try { rec = K.play(pos, p); } catch (e) { console.error("go: refused", e); return; }
    lock++;
    var tok = gameToken;
    elHint.classList.add("is-gone");
    updateBar();
    addStone(p, color, true, function () {
      A.stone(color, 0.75 + Math.random() * 0.25, panOf(p));
      if (rec.caps.length && color === cpu) say(foe.quips.capture);
      later(rec.caps.length ? 90 : 0, function () {
        capture(rec.caps, color, function () {
          if (tok !== gameToken) return;
          lock--;
          afterMove();
        });
      });
    });
  }

  function afterMove() {
    updateBar();
    requestOwn();
    if (pos.ended) { enterCount(); return; }
    if (pos.turn === cpu) later(80, cpuTurn);
    else if (pos.passes === 1) note(shortName(foe) + " passed. Pass too to count, or keep playing.", 2600);
  }

  function humanPass() {
    if (!myTurn()) return;
    A.init(); A.pass(0);
    K.play(pos, PASS);
    ghost = 0; cursor = 0;
    flash("You pass", "cool", 1000);
    afterMove();
  }

  function cpuTurn() {
    if (phase !== "play" || pos.turn !== cpu) return;
    thinking = true; updateBar();
    elSay.classList.add("is-think"); elSay.textContent = "thinking";
    var t0 = now();
    ask({ type: "go", b: Array.from(pos.b), turn: pos.turn, komi: pos.komi, legal: K.legal(pos), who: foe.id,
      passes: pos.passes, last: pos.last, moveNum: pos.moves }, function (d) {
      var res = d.res;
      if (!res) { console.error("go: the engine failed", d.error); res = { move: PASS, winrate: 0.5, est: { winner: cpu } }; }
      var wait = Math.max(0, foe.pause - (now() - t0));
      if (reduced()) wait = Math.min(wait, 150);
      later(wait, function () {
        thinking = false;
        elSay.classList.remove("is-think"); elSay.textContent = said;
        lastWinrate = res.winrate;
        /* resigning: only the four who ever do, only past move 25, and only when the
           search and the count have agreed for three moves running */
        if (foe.resigns && pos.moves > 25 && res.winrate < 0.05 && res.est && res.est.winner !== cpu) lowStreak++;
        else lowStreak = 0;
        if (lowStreak >= 3) { cpuResign(); return; }
        var m = res.move;
        if (m && (pos.b[m] || !K.tryMove(pos, m).ok)) { console.error("go: the engine sent an illegal move", m); m = K.legal(pos)[0] || PASS; }
        if (m === PASS) {
          A.pass(panX(PROPS.thBowl.x));
          K.play(pos, PASS);
          say(foe.quips.pass);
          flash(shortName(foe) + " passes", "", 1200);
          updateBar();
          afterMove();
          return;
        }
        A.rustle(cpu, panX(PROPS.thBowl.x));
        updateBar();
        later(reduced() ? 40 : 240, function () { commit(m); });
      });
    });
  }

  function cpuResign() {
    say(foe.quips.resign);
    flash(shortName(foe) + " resigns", "", 1600);
    finish({ winner: human, how: "resign" });
  }
  function humanResign() {
    if (phase !== "play") return;
    finish({ winner: cpu, how: "resign" });
  }

  /* ---------- counting ----------
     Two passes. A big ownership pass from the engine says which groups it thinks are
     dead (their stones end up the other color's in most playouts). Seki stones
     survive in playouts, so they never get marked. The player can tap any group to
     flip it. If the two of you disagree, the rule is to play it out. */
  function enterCount() {
    phase = "count"; ghost = 0; cursor = 0;
    clearTimeout(noteT); elNote.classList.remove("is-on");
    document.body.classList.add("is-counting");
    elBar.hidden = true;
    count = { dead: new Uint8Array(K.SZ), engine: new Uint8Array(K.SZ), owner: null, ready: false };
    elCount.hidden = false;
    $("countHelp").textContent = "Counting…";
    $("cB").textContent = ""; $("cW").textContent = ""; $("countVerdict").textContent = "";
    elCountGo.disabled = true; $("countWhy").textContent = "";
    say(foe.quips.count);
    var tok = gameToken;
    ask({ type: "own", b: Array.from(pos.b), turn: pos.turn, komi: pos.komi, playouts: 6000, timeMs: 2200 }, function (d) {
      if (tok !== gameToken || phase !== "count") return;
      var o = d.res ? d.res.own : null;
      if (o) {
        own = o;
        K.groups(pos.b).forEach(function (g) {
          var s = 0; g.stones.forEach(function (p) { s += o[p]; }); s /= g.stones.length;
          if (g.color === WHITE) s = -s;
          if (s < -0.2) g.stones.forEach(function (p) { count.engine[p] = 1; });
        });
      }
      count.dead.set(count.engine);
      count.ready = true;
      elCountGo.disabled = false;
      $("countHelp").textContent = "Tap a group to mark it dead or alive.";
      recount();
    });
  }
  function toggleDead(p) {
    if (!count || !count.ready) return;
    var g = K.groupAt(pos.b, p), v = count.dead[p] ? 0 : 1;
    g.forEach(function (q) { count.dead[q] = v; });
    A.tick(panOf(p));
    recount();
  }
  function disagree() {
    for (var i = 0; i < K.POINTS.length; i++) { var p = K.POINTS[i]; if (count.dead[p] !== count.engine[p]) return true; }
    return false;
  }
  function recount() {
    var sc = K.score(pos.b, pos.komi, count.dead);
    count.owner = sc.owner; count.score = sc;
    terrDirty = true;
    var bName = human === BLACK ? "You" : shortName(foe), wName = human === WHITE ? "You" : shortName(foe);
    $("cBName").textContent = bName; $("cWName").textContent = wName;
    $("cB").innerHTML = sc.black.stones + " stones + " + sc.black.terr + " = <b>" + sc.black.total + "</b>";
    $("cW").innerHTML = sc.white.stones + " stones + " + sc.white.terr + " + " + pos.komi + " komi = <b>" + sc.white.total + "</b>";
    var wHuman = sc.winner === human;
    $("countVerdict").textContent = (wHuman ? "You win" : shortName(foe) + " wins") + " by " + sc.margin;
    if (disagree()) {
      elCountGo.textContent = "Play it out";
      $("countWhy").textContent = shortName(foe) + " sees those stones differently. When players disagree, the game goes on until it's clear.";
    } else {
      elCountGo.textContent = "Count";
      $("countWhy").textContent = "";
    }
  }
  function countGo() {
    if (!count || !count.ready) return;
    if (disagree()) { resume(); return; }
    var sc = count.score;
    /* the dead stones come off into the lids, then the count stands */
    var deadB = [], deadW = [];
    K.POINTS.forEach(function (p) { if (count.dead[p] && stones[p]) (pos.b[p] === BLACK ? deadB : deadW).push(p); });
    elCountGo.disabled = true;
    if (deadB.length) capture(deadB, WHITE, function () {});
    if (deadW.length) capture(deadW, BLACK, function () {});
    terrDirty = true;
    later(deadB.length || deadW.length ? (reduced() ? 100 : 700) : 0, function () {
      finish({ winner: sc.winner, how: "count", margin: sc.margin, score: sc });
    });
  }
  function resume() {
    phase = "play";
    pos.ended = false; pos.passes = 0;
    count = null; terrDirty = true;
    document.body.classList.remove("is-counting");
    elCount.hidden = true; elBar.hidden = false;
    flash("Play on", "cool", 1000);
    updateBar();
    requestOwn();
    if (pos.turn === cpu) later(500, cpuTurn);
  }

  /* ---------- the end ---------- */
  function finish(r) {
    phase = "over"; thinking = false; terrDirty = true;
    document.body.classList.remove("is-counting");
    elCount.hidden = true; elBar.hidden = true;
    var won = r.winner === human;
    var label = handicap ? handicap + "-stone handicap" : "Even game";
    var title = won ? "You win" : shortName(foe) + " wins";
    var scoreLine = "";
    if (r.how === "resign") scoreLine = won ? shortName(foe) + " resigned" : "You resigned";
    else {
      var sc = r.score;
      var bLabel = human === BLACK ? "You" : shortName(foe), wLabel = human === WHITE ? "You" : shortName(foe);
      scoreLine = bLabel + " " + sc.black.total + " · " + wLabel + " " + sc.white.total;
    }
    if (won) {
      bump(LS.w); recordWin(foe.id, handicap); setupShare(r);
      say(foe.quips.lose); A.win(); winMoment();
    } else {
      bump(LS.l); clearShare();
      say(foe.quips.win); A.lose();
    }
    elResLine.textContent = label + " · against " + foe.name;
    elResTitle.textContent = title;
    elResScore.textContent = scoreLine + (r.how === "count" ? "  ·  by " + r.margin : "");
    elResText.innerHTML = '<span class="result__quote">“' + (won ? foe.quips.lose : foe.quips.win) + '”</span>';
    elResSeal.innerHTML = sealSvg(foe, 56);
    elResRecord.textContent = record();
    track("go_game_end", { opponent: foe.id, handicap: handicap, color: human === BLACK ? "black" : "white",
      result: won ? "win" : "loss", how: r.how, margin: r.margin || 0, moves: pos.moves });
    updateBar();
    later(reduced() ? 400 : won ? 2600 : 1500, function () { elResult.hidden = false; });
  }
  function winMoment() {
    if (reduced()) { lampBoost = 1; setTimeout(function () { lampBoost = 0; }, 3000); return; }
    /* the lantern swells, and one maple leaf blows in off the engawa and comes to rest */
    var t0 = now();
    (function swell() {
      var t = (now() - t0) / 4200;
      lampBoost = t < 0.25 ? t / 0.25 : Math.max(0, 1 - (t - 0.25) / 0.75);
      if (t < 1) requestAnimationFrame(swell); else lampBoost = 0;
    })();
    winLeaf = { t0: t0 + 300, dur: 2400, x0: -HW - 2, z0: -HD - 3, y0: 4.5, x1: 1.2 + Math.random() * 1.5, z1: HD - 0.35, rot: Math.random() * 6 };
    later(1500, function () { A.chime(); });
  }
  function bump(k) { lsSet(k, String((parseInt(lsGet(k, "0"), 10) || 0) + 1)); }
  function getRecord() { try { var r = JSON.parse(lsGet(LS.record, "{}")); return r && typeof r === "object" && !Array.isArray(r) ? r : {}; } catch (e) { return {}; } }
  function recordWin(id, stonesGiven) {
    var r = getRecord();
    if (!(id in r) || stonesGiven < r[id]) r[id] = stonesGiven;
    lsSet(LS.record, JSON.stringify(r));
    /* the ticket rule reads this; it only ever goes up, and nothing awards directly */
    var prev = parseInt(lsGet(LS.beaten, "0"), 10) || 0;
    lsSet(LS.beaten, String(Math.max(prev, Object.keys(r).length)));
  }
  function record() {
    return "Record  " + lsGet(LS.w, "0") + "W · " + lsGet(LS.l, "0") + "L   ·   regulars beaten " + Object.keys(getRecord()).length + "/6";
  }
  function beatenLabel(id) {
    var r = getRecord();
    if (!(id in r)) return "";
    return r[id] === 0 ? "Beaten even" : "Beaten with " + r[id] + " stones";
  }

  /* ================= the engine ================= */
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
  /* no Worker (an odd browser, a copy opened from disk): the same engine on the page */
  function runLocal(msg, cb) {
    function go() {
      var res = null, err = null, E = window.GoEngine;
      try { res = msg.type === "own" ? E.ownPass(msg) : E.think(msg); } catch (e) { err = String(e); console.error(e); }
      cb({ type: msg.type, id: msg.id, res: res, error: err });
    }
    if (window.GoEngine) { setTimeout(go, 20); return; }
    var sc = document.createElement("script");
    sc.src = "engine.js?v=1"; sc.onload = go;
    document.head.appendChild(sc);
  }
  function ask(msg, cb) {
    ensureWorker();
    msg.id = ++reqId;
    var tok = gameToken;
    var done = function (d) { if (tok === gameToken) cb(d); };
    if (!worker) { runLocal(msg, done); return; }
    inflight[msg.id] = { msg: msg, cb: done };
    worker.postMessage(msg);
  }
  /* the Territory view's map, refreshed after every move while it is on */
  function requestOwn() {
    if (!terrOn || phase !== "play") return;
    var tok = ++ownTok;
    ask({ type: "own", b: Array.from(pos.b), turn: pos.turn, komi: pos.komi, playouts: 1600, timeMs: 450 }, function (d) {
      if (tok !== ownTok || !d.res) return;
      own = d.res.own; terrDirty = true;
    });
  }
  function setTerr(v) {
    terrOn = !!v; lsSet(LS.terr, terrOn ? "1" : "0");
    elTerr.setAttribute("aria-pressed", terrOn ? "true" : "false");
    terrDirty = true;
    if (terrOn) { own = null; requestOwn(); }
  }

  /* ================= the page ================= */
  var elOverlay = $("overlay"), elResult = $("result"), elBar = $("bar"), elOpp = $("opp"), elSay = $("oppSay");
  var elTurn = $("turn"), elTurnText = $("turnText"), elTurnSub = $("turnSub"), elTurnStone = $("turnStone");
  var elCast = $("cast"), elSound = $("soundBtn"), elTerr = $("btnTerr"), elHint = $("hintLine"), elNote = $("note");
  var elCallout = $("callout"), elCount = $("count"), elCountGo = $("countGo");
  var elResLine = $("resLine"), elResTitle = $("resTitle"), elResScore = $("resScore"), elResText = $("resText"), elResSeal = $("resSeal"), elResRecord = $("resRecord");

  var said = "";
  function say(t) { said = t || ""; if (!elSay.classList.contains("is-think")) elSay.textContent = said; }
  var calloutT = null;
  function flash(t, kind, ms) {
    if (!t) return;
    elCallout.textContent = t;
    elCallout.className = "callout" + (kind === "cool" ? " is-cool" : "");
    elCallout.hidden = false; void elCallout.offsetWidth; elCallout.classList.add("is-pop");
    clearTimeout(calloutT); calloutT = setTimeout(function () { elCallout.hidden = true; }, ms || 1300);
  }
  var noteT = null;
  function note(t, ms) {
    if (!t) return;
    elNote.textContent = t; elNote.classList.add("is-on");
    clearTimeout(noteT); noteT = setTimeout(function () { elNote.classList.remove("is-on"); }, ms || 1600);
  }

  function updateBar() {
    var txt, wait = false;
    if (phase === "count") txt = "Counting";
    else if (phase === "over") txt = "Game over";
    else if (pos.turn === human) { txt = busy() ? "…" : "Your turn"; }
    else { txt = shortName(foe) + (thinking ? " is thinking" : "'s turn"); wait = true; }
    elTurnText.textContent = txt;
    elTurnSub.textContent = "Move " + (pos.moves + 1) + (pos.passes === 1 && phase === "play" ? " · a pass" : "");
    elTurn.className = "turn" + (wait ? " is-wait" : "");
    elTurnStone.className = "turn__stone" + (pos.turn === WHITE ? " is-white" : "");
    elOpp.classList.toggle("is-turn", phase === "play" && pos.turn === cpu);
    var mine = myTurn();
    $("btnPass").disabled = !mine;
    $("btnPass").textContent = pos.passes === 1 && phase === "play" ? "Pass & count" : "Pass";
    $("btnResign").disabled = phase !== "play";
  }

  /* Each regular gets a small lacquer seal with a mark of their life. */
  function sealSvg(f, size) {
    var g = {
      flower: '<circle cx="0" cy="0" r="2"/><path d="M0-2.2C-2.6-7.6 2.6-7.6 0-2.2M2.1-0.7C7.4-3.4 9-0.6 2.1-0.7M1.3 1.8C4.6 6.8 1.6 8.6 1.3 1.8M-1.3 1.8C-1.6 8.6-4.6 6.8-1.3 1.8M-2.1-0.7C-9-0.6-7.4-3.4-2.1-0.7"/>',
      letter: '<rect x="-7.5" y="-5" width="15" height="10" rx="1.2"/><path d="M-7.5-4.4L0 1l7.5-5.4"/>',
      pot: '<path d="M-4-7h8M-3-7c0 2-4 3-4 7 0 4 3 6.5 7 6.5S7 4 7 0c0-4-4-5-4-7"/><path d="M-6.6 1.2h13.2"/>',
      book: '<path d="M0-5.5C-2.5-7-5.5-7-7.5-6v12C-5.5 5-2.5 5 0 6.5 2.5 5 5.5 5 7.5 6V-6C5.5-7 2.5-7 0-5.5z"/><path d="M0-5.5v12"/>',
      cup: '<path d="M-6-3h12l-1.4 7.6C4.3 6.3 2.4 7 0 7s-4.3-.7-4.6-2.4z"/><path d="M-2-8c-1 1.4 1 2.2 0 3.6M2-8c-1 1.4 1 2.2 0 3.6"/>',
      kettle: '<path d="M-7 5.5h14M-6 5.5c-1-6 2-9 6-9s7 3 6 9"/><path d="M6.2 0c2.4-.4 3.2 1.6 2 3.4"/><path d="M-2.4-6.6c0-2.4 4.8-2.4 4.8 0"/>'
    }[f.glyph];
    return '<svg viewBox="-14 -14 28 28" width="' + size + '" height="' + size + '" aria-hidden="true" style="color:' + f.accent + '">' +
      '<defs><radialGradient id="sg' + f.id + size + '" cx="35%" cy="30%" r="80%"><stop offset="0" stop-color="#3a2416"/><stop offset="1" stop-color="#120a06"/></radialGradient></defs>' +
      '<circle cx="0" cy="0" r="13" fill="url(#sg' + f.id + size + ')" stroke="' + f.accent + '" stroke-opacity="0.6" stroke-width="1"/>' +
      '<circle cx="0" cy="0" r="10.6" fill="none" stroke="' + f.accent + '" stroke-opacity="0.24" stroke-width="0.7" stroke-dasharray="1.4 1.4"/>' +
      '<g fill="none" stroke="' + f.accent + '" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round">' + g + "</g></svg>";
  }
  function renderOpp() {
    $("oppSeal").innerHTML = sealSvg(foe, 40); $("oppName").textContent = foe.name; $("oppRole").textContent = foe.role;
  }

  /* the first regular not yet beaten; after that, whoever you played last */
  function defaultFoe() {
    var r = getRecord();
    for (var i = 0; i < FOES.length; i++) if (!(FOES[i].id in r)) return FOES[i];
    return foeById(lsGet(LS.foe, "kenji"));
  }
  function buildCast() {
    if (!picked) picked = defaultFoe();
    elCast.innerHTML = "";
    FOES.forEach(function (f) {
      var b = document.createElement("button");
      b.type = "button"; b.className = "foe" + (f === picked ? " is-pick" : "");
      var won = beatenLabel(f.id);
      b.innerHTML = '<span class="foe__seal">' + sealSvg(f, 38) + "</span>" +
        '<span class="foe__name">' + f.name + "</span>" +
        '<span class="foe__role">' + f.role + "</span>" +
        '<span class="foe__rank">' + f.rank + "</span>" +
        '<span class="foe__trait">' + f.trait + "</span>" +
        (won ? '<i class="foe__won">' + won + "</i>" : "");
      b.setAttribute("data-opt-start", "");
      b.addEventListener("click", function () { picked = f; start(); });
      elCast.appendChild(b);
    });
    $("ovBtn").textContent = "Sit down with " + shortName(picked);
  }
  function wireOptions() {
    function paint() {
      Array.prototype.forEach.call(document.querySelectorAll("[data-handi]"), function (b) { b.setAttribute("aria-checked", +b.getAttribute("data-handi") === handicap ? "true" : "false"); });
      Array.prototype.forEach.call(document.querySelectorAll("[data-first]"), function (b) { b.setAttribute("aria-checked", b.getAttribute("data-first") === firstPref ? "true" : "false"); });
      $("colorSeg").hidden = handicap > 0;
      $("handiNote").textContent = handicap
        ? "You take Black with " + handicap + " stones already on the board. White moves first and gets half a point (komi 0.5)."
        : firstPref === "white" ? "You take White and move second. White gets 7.5 points (komi) for going second."
        : firstPref === "alt" ? "You switch colors every game. White gets 7.5 points (komi) for going second."
        : "You take Black and move first. White gets 7.5 points (komi) for going second.";
    }
    Array.prototype.forEach.call(document.querySelectorAll("[data-handi]"), function (b) {
      b.addEventListener("click", function () { handicap = +b.getAttribute("data-handi"); lsSet(LS.handi, String(handicap)); paint(); A.init(); A.tick(0); });
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-first]"), function (b) {
      b.addEventListener("click", function () { firstPref = b.getAttribute("data-first"); lsSet(LS.first, firstPref); paint(); A.init(); A.tick(0); });
    });
    $("ovBtn").addEventListener("click", start);
    $("howBtn").addEventListener("click", function () { openLesson(); });
    paint();
  }

  function start() {
    A.init();
    elOverlay.classList.add("is-out");
    setTimeout(function () { elOverlay.hidden = true; elOverlay.classList.remove("is-out"); }, 240);
    newGame(picked.id);
  }
  function chooseColor() {
    if (handicap) return BLACK;
    if (firstPref === "white") return WHITE;
    if (firstPref === "alt") {
      var n = (parseInt(lsGet(LS.w, "0"), 10) || 0) + (parseInt(lsGet(LS.l, "0"), 10) || 0);
      return n % 2 === 0 ? BLACK : WHITE;
    }
    return BLACK;
  }
  function newGame(foeId) {
    gameToken++; lock = 0; thinking = false; flights = []; parts = []; winLeaf = null; lampBoost = 0;
    foe = foeById(foeId); lsSet(LS.foe, foe.id);
    human = chooseColor(); cpu = 3 - human;
    pos = K.start(handicap);
    phase = "play"; count = null; own = null; terrDirty = true;
    lowStreak = 0; ghost = 0; cursor = 0; touchArm = 0; press = null;
    lidShown = [0, 0, 0];
    clearShare();
    layoutProps(); buildScene();
    placeAll();
    renderOpp();
    say(handicap ? foe.quips.handi : foe.quips.start);
    elOpp.hidden = false; elBar.hidden = false; elResult.hidden = true; elCount.hidden = true;
    document.body.classList.add("is-playing"); document.body.classList.remove("is-counting");
    A.startBed();
    track("go_game_start", { opponent: foe.id, handicap: handicap, color: human === BLACK ? "black" : "white" });
    updateBar();
    requestOwn();
    if (pos.turn === cpu) later(800, cpuTurn);
    else flash(handicap ? "Your stones are set" : "Your move", "", 1100);
  }

  function showCast() {
    gameToken++; lock = 0; thinking = false; flights = []; phase = "menu"; count = null;
    elResult.hidden = true; elBar.hidden = true; elOpp.hidden = true; elCount.hidden = true;
    pos = K.start(0); stones = {}; lidShown = [0, 0, 0];
    picked = null; buildCast(); elOverlay.hidden = false;
    document.body.classList.remove("is-playing"); document.body.classList.remove("is-counting");
  }

  $("btnPass").addEventListener("click", humanPass);
  $("btnResign").addEventListener("click", function () {
    var b = $("btnResign");
    if (b.getAttribute("data-sure") !== "1") {
      b.setAttribute("data-sure", "1"); b.textContent = "Sure?"; b.classList.add("btn--sure");
      setTimeout(function () { b.removeAttribute("data-sure"); b.textContent = "Resign"; b.classList.remove("btn--sure"); }, 2600);
      return;
    }
    b.removeAttribute("data-sure"); b.textContent = "Resign"; b.classList.remove("btn--sure");
    humanResign();
  });
  elTerr.addEventListener("click", function () { A.init(); setTerr(!terrOn); A.tick(0); });
  elCountGo.addEventListener("click", countGo);
  $("btnAgain").addEventListener("click", function () { elResult.hidden = true; newGame(foe.id); });
  $("btnCast").addEventListener("click", showCast);
  $("helpBtn").addEventListener("click", function () { openLesson(); });
  elSound.addEventListener("click", function () {
    soundOn = !soundOn; lsSet(LS.sound, soundOn ? "1" : "0");
    elSound.setAttribute("aria-pressed", soundOn ? "true" : "false");
    A.init(); A.setOn(soundOn); if (soundOn) A.tick(0);
  });
  elSound.setAttribute("aria-pressed", soundOn ? "true" : "false");
  elTerr.setAttribute("aria-pressed", terrOn ? "true" : "false");
  A.setOn(soundOn);

  /* ---------- keyboard ----------
     Arrows walk a cursor over the points, Enter or Space plays it, P passes, T shows
     territory, M mutes. It is a real way to play, and the tests drive the board with it. */
  window.addEventListener("keydown", function (e) {
    var k = e.key;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (!elLesson.hidden) {
      if (k === "ArrowRight" || k === "Enter") { e.preventDefault(); $("lessonNext").click(); }
      else if (k === "ArrowLeft") { e.preventDefault(); $("lessonBack").click(); }
      else if (k === "Escape") closeLesson();
      return;
    }
    if (phase !== "play") return;
    if (k === "m" || k === "M") { elSound.click(); return; }
    if (k === "t" || k === "T") { setTerr(!terrOn); return; }
    if (k === "p" || k === "P") { humanPass(); return; }
    if (k === "ArrowLeft" || k === "ArrowRight" || k === "ArrowUp" || k === "ArrowDown") {
      e.preventDefault();
      if (!cursor) cursor = ghost || pos.last > 0 && pos.last || K.pt(4, 4);
      else {
        var x = K.px(cursor), y = K.py(cursor);
        if (k === "ArrowLeft") x--; else if (k === "ArrowRight") x++; else if (k === "ArrowUp") y--; else y++;
        cursor = K.pt(clamp(x, 0, 8), clamp(y, 0, 8));
      }
      ghost = cursor; ghostKind = "key"; ghostBad = "";
      A.init(); A.tick(panOf(cursor));
      return;
    }
    if (k === "Enter" || k === " ") {
      if (document.activeElement && document.activeElement.tagName === "BUTTON") return;
      e.preventDefault(); A.init();
      if (!cursor) { cursor = K.pt(4, 4); ghost = cursor; ghostKind = "key"; return; }
      tryPlay(cursor);
      return;
    }
    if (k === "Escape") { cursor = 0; ghost = 0; }
  });

  /* ================= the lesson =================
     Four short cards with a small board that plays itself. */
  var elLesson = $("lesson"), lessonCv = $("lessonCv"), lessonG = lessonCv.getContext("2d");
  var lessonAt = 0, lessonT0 = 0, lessonRaf = 0;
  var FINAL5 = { b: [[2, 0], [2, 1], [2, 2], [2, 3], [2, 4], [3, 4]], w: [[3, 0], [3, 1], [3, 2], [3, 3], [4, 3]] };
  var LESSON = [
    { title: "Take turns", text: "Black and White take turns putting one stone on an empty point, where two lines cross. Stones never move once they are down. Try to surround more of the board than the other side.", aside: "",
      seq: [[2, 2, 1], [3, 2, 2], [2, 1, 1], [3, 1, 2], [2, 3, 1], [3, 3, 2], [2, 0, 1], [3, 0, 2], [3, 4, 1], [4, 3, 2], [2, 4, 1]], wash: true },
    { title: "Capture", text: "The empty points next to a stone are its liberties. Fill every one and the stone is captured and taken off. Stones joined in a line share their liberties.", aside: "<b>Ko:</b> you can't take back a single stone right after it was taken. Play somewhere else first.",
      cap: true },
    { title: "Two eyes", text: "A group with two separate empty points inside it can never be captured. Those points are called eyes. A stone dropped into either one would have no liberties, so it can't be played.", aside: "",
      eyes: true },
    { title: "Counting", text: "When nothing useful is left, both players pass. Your score is your stones plus the empty points only you surround. White gets 7.5 points for going second, so there are no ties.", aside: "",
      count: true }
  ];
  function openLesson(at) {
    lessonAt = at || 0;
    elLesson.hidden = false;
    renderLesson();
    cancelAnimationFrame(lessonRaf);
    (function loop(t) { drawLesson(t); if (!elLesson.hidden) lessonRaf = requestAnimationFrame(loop); })(now());
  }
  function closeLesson() {
    elLesson.hidden = true;
    cancelAnimationFrame(lessonRaf);
    lsSet(LS.lesson, "1");
  }
  function renderLesson() {
    var L = LESSON[lessonAt];
    $("lessonTitle").textContent = L.title;
    $("lessonText").textContent = L.text;
    $("lessonAside").innerHTML = L.aside;
    $("lessonStep").textContent = "· " + (lessonAt + 1) + " of " + LESSON.length;
    $("lessonBack").disabled = lessonAt === 0;
    $("lessonNext").textContent = lessonAt === LESSON.length - 1 ? "Got it" : "Next";
    var dots = "";
    for (var i = 0; i < LESSON.length; i++) dots += '<i class="' + (i === lessonAt ? "on" : "") + '"></i>';
    $("lessonDots").innerHTML = dots;
    lessonT0 = now();
  }
  $("lessonNext").addEventListener("click", function () { A.init(); if (lessonAt < LESSON.length - 1) { lessonAt++; renderLesson(); A.tick(0); } else closeLesson(); });
  $("lessonBack").addEventListener("click", function () { if (lessonAt > 0) { lessonAt--; renderLesson(); } });
  elLesson.addEventListener("click", function (e) { if (e.target === elLesson) closeLesson(); });

  function drawLesson(t) {
    var cssW = lessonCv.clientWidth || 240, d = Math.min(window.devicePixelRatio || 1, 2);
    if (lessonCv.width !== Math.round(cssW * d)) { lessonCv.width = Math.round(cssW * d); lessonCv.height = Math.round(cssW * d); }
    var g = lessonG, S2 = cssW;
    g.setTransform(d, 0, 0, d, 0, 0);
    var bg = g.createLinearGradient(0, 0, S2, S2);
    bg.addColorStop(0, "#dcaa5e"); bg.addColorStop(1, "#bd8540");
    g.fillStyle = bg; g.fillRect(0, 0, S2, S2);
    for (var gl = 0; gl < 40; gl++) { g.fillStyle = "rgba(140,82,30," + (0.04 + srnd(gl) * 0.06) + ")"; g.fillRect(srnd(gl * 3.1) * S2, 0, 1, S2); }
    var m = S2 * 0.17, step = (S2 - 2 * m) / 4;
    function P(x, y) { return { x: m + x * step, y: m + y * step }; }
    g.strokeStyle = "rgba(24,13,6,0.85)"; g.lineWidth = 1.4;
    for (var i = 0; i < 5; i++) {
      g.beginPath(); g.moveTo(m, m + i * step); g.lineTo(S2 - m, m + i * step); g.stroke();
      g.beginPath(); g.moveTo(m + i * step, m); g.lineTo(m + i * step, S2 - m); g.stroke();
    }
    var R = step * 0.47;
    function stone(x, y, c, a) {
      var p = P(x, y);
      g.globalAlpha = a == null ? 1 : a;
      g.fillStyle = "rgba(40,20,6,0.35)"; g.beginPath(); g.arc(p.x + R * 0.12, p.y + R * 0.14, R, 0, Math.PI * 2); g.fill();
      var gr = g.createRadialGradient(p.x - R * 0.35, p.y - R * 0.4, R * 0.1, p.x, p.y, R * 1.1);
      if (c === 1) { gr.addColorStop(0, "#5a5b60"); gr.addColorStop(1, "#0d0d0f"); } else { gr.addColorStop(0, "#fffdf6"); gr.addColorStop(1, "#cfc5b0"); }
      g.fillStyle = gr; g.beginPath(); g.arc(p.x, p.y, R, 0, Math.PI * 2); g.fill();
      g.globalAlpha = 1;
    }
    function wash(x, y, c, a) {
      var p = P(x, y);
      g.fillStyle = c === 1 ? "rgba(14,10,8," + (0.45 * a) + ")" : "rgba(255,250,238," + (0.5 * a) + ")";
      g.fillRect(p.x - step / 2, p.y - step / 2, step, step);
    }
    function label(txt, y) {
      g.font = "800 " + Math.round(S2 * 0.052) + "px Manrope, system-ui, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
      var tw = g.measureText(txt).width + 14;
      g.fillStyle = "rgba(20,14,11,0.86)"; rrect(g, S2 / 2 - tw / 2, y - 10, tw, 20, 10); g.fill();
      g.fillStyle = "#f6eadb"; g.fillText(txt, S2 / 2, y + 1);
    }
    var L = LESSON[lessonAt], e = reduced() ? 1e9 : Math.max(0, t - lessonT0);
    if (L.seq) {
      var per = 520, n = Math.min(L.seq.length, Math.floor(e / per) + 1), cyc = L.seq.length * per + 2600;
      if (!reduced()) { var ce = e % cyc; n = Math.min(L.seq.length, Math.floor(ce / per) + 1); e = ce; }
      if (n >= L.seq.length && e > L.seq.length * per) {
        var a = clamp((e - L.seq.length * per) / 600, 0, 1);
        for (var x = 0; x < 2; x++) for (var y = 0; y < 5; y++) wash(x, y, 1, a);
        [[4, 0], [4, 1], [4, 2]].forEach(function (q) { wash(q[0], q[1], 2, a); });
      }
      for (var k = 0; k < n; k++) stone(L.seq[k][0], L.seq[k][1], L.seq[k][2]);
    } else if (L.cap) {
      var cyc2 = 4600, ce2 = reduced() ? 3000 : e % cyc2;
      var around = [[2, 1], [1, 2], [3, 2], [2, 3]];
      var placed = Math.min(4, Math.floor(ce2 / 650));
      var gone = ce2 > 650 * 4 + 200;
      var lift = gone ? clamp((ce2 - 2800) / 500, 0, 1) : 0;
      if (lift < 1) stone(2, 2, 2, 1 - lift);
      for (var j = 0; j < placed; j++) stone(around[j][0], around[j][1], 1);
      if (!gone) for (var q = placed; q < 4; q++) { var lp = P(around[q][0], around[q][1]); g.fillStyle = "rgba(255,246,220,0.85)"; g.beginPath(); g.arc(lp.x, lp.y, step * 0.11, 0, Math.PI * 2); g.fill(); }
      label(placed >= 4 ? "Captured" : (4 - placed) + (4 - placed === 1 ? " liberty left" : " liberties left"), S2 - m * 0.42);
    } else if (L.eyes) {
      var bl = [[1, 0], [0, 1], [1, 1], [2, 1], [3, 1], [3, 0]], wh = [[0, 2], [1, 2], [2, 2], [3, 2], [4, 2], [4, 1], [4, 0]];
      bl.forEach(function (q) { stone(q[0], q[1], 1); });
      wh.forEach(function (q) { stone(q[0], q[1], 2); });
      var cyc3 = 3200, ce3 = reduced() ? 1000 : e % cyc3, tryAt = ce3 < 1600 ? [0, 0] : [2, 0];
      var ph = (ce3 % 1600) / 1600;
      if (ph > 0.25 && ph < 0.85) {
        var tp = P(tryAt[0], tryAt[1]), sh = Math.sin(ph * 40) * 3 * (ph < 0.5 ? 1 : 0);
        g.globalAlpha = 0.6; stone(tryAt[0] + sh / step, tryAt[1], 2, 0.55); g.globalAlpha = 1;
        g.strokeStyle = "rgba(210,60,40,0.95)"; g.lineWidth = 3; var rx = R * 0.5;
        g.beginPath(); g.moveTo(tp.x - rx, tp.y - rx); g.lineTo(tp.x + rx, tp.y + rx); g.moveTo(tp.x + rx, tp.y - rx); g.lineTo(tp.x - rx, tp.y + rx); g.stroke();
      }
      [[0, 0], [2, 0]].forEach(function (q) { var ep = P(q[0], q[1]); g.strokeStyle = "rgba(255,246,220,0.9)"; g.lineWidth = 2; g.beginPath(); g.arc(ep.x, ep.y, step * 0.2, 0, Math.PI * 2); g.stroke(); });
      label("Two eyes: safe", S2 - m * 0.42);
    } else if (L.count) {
      var cyc4 = 5200, ce4 = reduced() ? 5000 : e % cyc4;
      var a4 = clamp((ce4 - 1800) / 700, 0, 1);
      for (var x2 = 0; x2 < 2; x2++) for (var y2 = 0; y2 < 5; y2++) wash(x2, y2, 1, a4);
      [[4, 0], [4, 1], [4, 2]].forEach(function (q) { wash(q[0], q[1], 2, a4); });
      FINAL5.b.forEach(function (q) { stone(q[0], q[1], 1); });
      FINAL5.w.forEach(function (q) { stone(q[0], q[1], 2); });
      if (ce4 < 900) label("Black passes", S2 / 2);
      else if (ce4 < 1800) label("White passes", S2 / 2);
      else if (ce4 > 2600) { label("Black 6 + 10 = 16", m * 0.42); label("White 5 + 3 + 7.5 = 15.5", S2 - m * 0.42); }
    }
  }

  /* ---------- share ---------- */
  function clearShare() { window.OPT_SHARE_TEXT = undefined; window.OPT_SHARE_LINE = undefined; window.OPT_SHARE_IMAGE = undefined; }
  function setupShare(r) {
    var by = r.how === "resign" ? null : r.margin;
    if (r.how !== "resign" && !(by > 0)) { clearShare(); return; }
    var hcText = handicap ? " I took " + handicap + " stones." : "";
    var hcLine = handicap ? " with " + handicap + " stones" : "";
    window.OPT_SHARE_TEXT = (r.how === "resign"
      ? "I beat " + foe.name + " at Go. " + foe.name + " resigned."
      : "I beat " + foe.name + " at Go by " + by + " points.") + hcText + " " + foe.bio;
    window.OPT_SHARE_LINE = r.how === "resign" ? "Beat " + foe.name + " at Go" + hcLine + ", by resignation" : "Beat " + foe.name + " at Go by " + by + " points" + hcLine;
    window.OPT_SHARE_IMAGE = function () {
      var xs = boardPoly.map(function (p) { return p.x; }), ys = boardPoly.map(function (p) { return p.y; });
      var x0 = Math.max(0, Math.min.apply(null, xs) - 24), x1 = Math.min(W, Math.max.apply(null, xs) + 24);
      var y0 = Math.max(0, Math.min.apply(null, ys) - 40), y1 = Math.min(H, Math.max.apply(null, ys) + 60);
      var w = (x1 - x0) * dpr, h = (y1 - y0) * dpr;
      var out = document.createElement("canvas"); out.width = Math.round(w); out.height = Math.round(h);
      out.getContext("2d").drawImage(canvas, x0 * dpr, y0 * dpr, w, h, 0, 0, w, h);
      return out;
    };
  }

  /* ---------- automation handle (tests and the card pose only) ---------- */
  if (navigator.webdriver) {
    window.__go = {
      state: function () {
        return { phase: phase, turn: pos.turn, human: human, cpu: cpu, moves: pos.moves, passes: pos.passes, ended: pos.ended,
          busy: busy(), thinking: thinking, myTurn: myTurn(), handicap: handicap, foe: foe.id, komi: pos.komi,
          board: Array.from(pos.b), legal: K.legal(pos), caps: pos.caps.slice(), lids: lidShown.slice(), last: pos.last,
          ghost: ghost, terr: terrOn, own: own ? 1 : 0, resultShown: !elResult.hidden, portrait: portrait,
          count: count ? { ready: count.ready, disagree: count.ready ? disagree() : false, button: elCountGo.textContent,
            black: count.score ? count.score.black.total : 0, white: count.score ? count.score.white.total : 0,
            dead: K.POINTS.filter(function (p) { return count.dead[p]; }) } : null,
          lesson: !elLesson.hidden, perf: { n: perf.n, avg: perf.n ? perf.sum / perf.n : 0, max: perf.max } };
      },
      /* a point's position on screen (CSS px), and the grid spacing there */
      at: function (x, y) { var p = K.pt(x, y), c = project(gx(p), 0, gz(p)); return { x: c.x, y: c.y }; },
      spacing: function () {
        var out = { minX: 1e9, minZ: 1e9 };
        for (var y = 0; y < 9; y++) for (var x = 0; x < 8; x++) { var a = project((x - 4) * GX, 0, (y - 4) * GZ), b = project((x - 3) * GX, 0, (y - 4) * GZ); out.minX = Math.min(out.minX, b.x - a.x); }
        for (var x2 = 0; x2 < 9; x2++) for (var y2 = 0; y2 < 8; y2++) { var c = project((x2 - 4) * GX, 0, (y2 - 4) * GZ), d = project((x2 - 4) * GX, 0, (y2 - 3) * GZ); out.minZ = Math.min(out.minZ, d.y - c.y); }
        return out;
      },
      resetPerf: function () { perf = { n: 0, sum: 0, max: 0 }; }
    };
  }

  /* ---------- boot ---------- */
  wireOptions();
  buildCast();
  seedWeather();
  window.addEventListener("resize", resize);
  resize();
  requestAnimationFrame(function (t) { lastT = t; tick(t); });
  if (lsGet(LS.lesson, "0") !== "1") openLesson(0);
  setTimeout(function () { elHint.classList.add("is-gone"); }, 9000);
})();
