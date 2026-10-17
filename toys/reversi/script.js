/* Reversi — No. 139.
   The card room of a London club on a foggy night in 1888. A Reversi board of green
   baize set in a brass-bound mahogany case sits on the card table, with discs that are
   ebony on one face and ivory on the other. Gas lamps hiss on the green walls, a coal
   fire burns in the grate under the mantel clock, and fog presses at the sash window.
   Six regulars play here.

   The board is drawn with a real perspective camera. Everything that never moves is
   baked once per layout into canvases: the BACK (the room, the table and its props),
   the CASE (the board itself, its rails, brass and baize) and the window's frame and
   curtains. The resting discs live in their own layer too, rebuilt only when a disc
   changes. Each frame draws the fog, the fire, the gaslight, the clock's hands, and
   whatever discs are moving: the one being set down, the ones turning over, and the
   ones a move would flip.

   A disc is a real cylinder: two faces and an edge, projected with an affine frame
   from its own axes, so it can lie flat, lift, or stand on its edge mid-turn.

   Rules come from core.js (shared with the engine Worker and the tests); the regulars
   think in engine.js, off the main thread. */
(function () {
  "use strict";

  var K = window.ReversiCore, A = window.ReversiAudio;
  var BLACK = 1, WHITE = 2, PASS = -1;
  var canvas = document.getElementById("canvas");
  var ctx = canvas.getContext("2d");
  var $ = function (id) { return document.getElementById(id); };

  /* ================= camera ================= */
  var TILT = 0.66, SIN = 1, COS = 0, CAM_D = 30, FOCAL = 1000, CX = 0, CY = 0;
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

  /* ================= the board =================
     One square is 1 across. The baize is the plane y = 0; the rails stand RIM_H above
     it, and the case's front drops to the table at TABLE_Y. */
  var RS = 0.62, RF = 0.62, RN = 0.92, RIM_H = 0.1, CASE_D = 0.62, TABLE_Y = -0.62;
  var DR = 0.415, DT = 0.13;                    /* disc radius, thickness */
  var portrait = false;
  function cxOf(s) { return (K.sx(s) - 3.5); }
  function czOf(s) { return (K.sy(s) - 3.5); }
  var HX = 4 + RS, ZF = -(4 + RF), ZN = 4 + RN;

  /* ================= persistence ================= */
  var LS = { beaten: "reversi_beaten", defeated: "reversi_defeated", w: "reversi_wins", l: "reversi_losses", d: "reversi_draws",
    foe: "reversi_foe", first: "reversi_first", dots: "reversi_dots", sound: "reversi_sound" };
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function track(name, params) { try { if (typeof window.gtag === "function") window.gtag("event", name, params || {}); } catch (e) {} }

  /* ================= the regulars ================= */
  var FOES = [
    { id: "alfie", name: "Alfie", short: "Alfie", role: "the page boy", bio: "Alfie is the club's page boy.", level: "Easiest", glyph: "bell", accent: "#e8c877",
      trait: "Twelve years old. Turns over as many discs as he can reach.", pause: 600,
      quips: { start: "Mr. Dobbs says I can play till the bell goes.", pass: "I can't go anywhere. Is that allowed?", youPass: "You're stuck! My turn again.",
        big: "Look at them all go!", win: "I won! Don't tell Mr. Dobbs I was playing.", lose: "Again? I'll be quicker next time.", draw: "Even! That's fair, isn't it?" } },
    { id: "dobbs", name: "Mr. Dobbs", short: "Dobbs", role: "the hall porter", bio: "Mr. Dobbs has been the hall porter for thirty years.", level: "Easy", glyph: "key", accent: "#c9b38a",
      trait: "Thirty years on the door. Trusts an edge square the way he trusts a locked door.", pause: 700,
      quips: { start: "Coats are hung and the fire's banked. Your move.", pass: "Nothing for me there. I'll pass.", youPass: "No way through for you. That's a pass.",
        big: "That'll do nicely.", win: "Thirty years on the door, and I still know a good edge.", lose: "Well played. I'll hold the door for you.", draw: "Square, then. Fair enough." } },
    { id: "marlowe", name: "Mrs. Marlowe", short: "Marlowe", role: "a novelist, here on ladies' night", bio: "Mrs. Marlowe writes mysteries and comes on ladies' night.", level: "Medium", glyph: "quill", accent: "#d9a0a0",
      trait: "Writes mysteries. Plays a patient middle game and waits for you to slip.", pause: 900,
      quips: { start: "Every good mystery starts in the middle. Shall we?", pass: "I have no move. I'll let you carry the plot.", youPass: "Nowhere to go? A pass, then.",
        big: "The twist in chapter twelve.", win: "I saw that ending coming three chapters ago.", lose: "A clever ending. I may borrow it.", draw: "Even. My editor would hate that ending." } },
    { id: "hale", name: "Captain Hale", short: "Hale", role: "retired from the sea", bio: "Captain Hale sailed out of London for forty years.", level: "Hard", glyph: "anchor", accent: "#a9bccb",
      trait: "Forty years at sea. Takes corners the way he took harbors.", pause: 1000,
      quips: { start: "Fog's thick as soup tonight. Good weather for a game.", pass: "Becalmed. I pass.", youPass: "No wind in your sails. You pass.",
        big: "Broadside!", win: "Steady as she goes. Good game.", lose: "You outsailed me. Well done.", draw: "A dead heat. Rare as a calm in the Channel." } },
    { id: "pembroke", name: "Dr. Pembroke", short: "Pembroke", role: "a mathematics don", bio: "Dr. Pembroke teaches mathematics and counts everything.", level: "Harder", glyph: "dividers", accent: "#b7c99a",
      trait: "Counts every line to the end. Gives up discs now to win moves later.", pause: 1100,
      quips: { start: "Sixty empty squares. Plenty to count.", pass: "No legal move. A pass, by the rules.", youPass: "You have no legal move. That's a pass.",
        big: "Exactly as calculated.", win: "The arithmetic was on my side.", lose: "I must have miscounted somewhere. Well played.", draw: "Thirty-two each. Very tidy." } },
    { id: "desai", name: "Mr. Desai", short: "Desai", role: "barrister, club champion", bio: "Mr. Desai is a barrister and the club champion.", level: "Champion", glyph: "scales", accent: "#e0b45c",
      trait: "Champion seven winters running. Strong, but he has lost before.", pause: 1150,
      quips: { start: "A good game is all I ask. Shall we?", pass: "I have no move, so I pass.", youPass: "No move for you. It's a pass.",
        big: "A strong argument, that.", win: "Thank you. A well-argued game.", lose: "Well played. It has been some time since I lost.", draw: "A hung jury. Shall we play it again?" } }
  ];
  function foeById(id) { for (var i = 0; i < FOES.length; i++) if (FOES[i].id === id) return FOES[i]; return FOES[0]; }

  /* ================= state ================= */
  var firstPref = lsGet(LS.first, "black");
  if (["black", "white", "alt"].indexOf(firstPref) < 0) firstPref = "black";
  var soundOn = lsGet(LS.sound, "1") !== "0";
  var dotsOn = lsGet(LS.dots, "1") !== "0";
  var foe = foeById(lsGet(LS.foe, "alfie")), picked = null;
  var pos = K.start();
  var phase = "menu";                        /* menu | play | over */
  var human = BLACK, cpu = WHITE;
  var thinking = false, lock = 0, gameToken = 0;
  var disc = new Array(64);                  /* what each square shows: { color, rot, v, jx, jz } */
  var anim = {};                             /* square -> a disc on the move */
  var drop = null, cpuAim = null, lastPlaced = -1;
  var aim = -1, aimKind = "", aimBad = false, flipsPrev = [], touchArm = -1, press = null, cursor = -1, aimTold = 0;
  var discDirty = true;
  var worker = null, workerBroken = false, reqId = 0, inflight = {};
  var lampBoost = 0, glint = null, lastThink = null;
  var perf = { n: 0, sum: 0, max: 0 };

  function reduced() { return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches; }
  function later(ms, fn) { var t = gameToken; setTimeout(function () { if (t === gameToken) fn(); }, ms); }
  function busy() { return lock > 0 || thinking || drop !== null || animCount() > 0; }
  function animCount() { var n = 0; for (var k in anim) n++; return n; }
  function myTurn() { return phase === "play" && pos.turn === human && !busy() && !K.mustPass(pos); }

  /* ================= layout ================= */
  var dpr = 1, W = 0, H = 0, backCv = null, caseCv = null, discCv = null, winCv = null;
  var SILL = 0, RECT = {}, ROOM = null;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.floor(W * dpr); canvas.height = Math.floor(H * dpr);
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    portrait = H > W && W < 700;
    if (portrait) { RS = 0.3; RF = 0.42; RN = 0.95; setCam(0.36, 56); }
    else { RS = 0.62; RF = 0.62; RN = 0.92; setCam(H < 560 ? 0.6 : 0.66, 32); }
    HX = 4 + RS; ZF = -(4 + RF); ZN = 4 + RN;
    fit();
    buildTextures();
    buildScene();
    discDirty = true;
  }

  /* Screen offsets are linear in FOCAL, so one measure-and-scale pass fits exactly. */
  function fit() {
    CX = 0; CY = 0; FOCAL = 1000;
    var pts = [[-HX, RIM_H, ZF], [HX, RIM_H, ZF], [HX, RIM_H, ZN], [-HX, RIM_H, ZN], [-HX, TABLE_Y, ZN], [HX, TABLE_Y, ZN]];
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    pts.forEach(function (q) {
      var p = project(q[0], q[1], q[2]);
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    });
    var low = H < 560, short = H < 740;
    var padX = portrait ? 4 : low ? 10 : Math.max(24, W * 0.03);
    var padTop = portrait ? (short ? 70 : 96) : low ? 46 : Math.max(96, H * 0.27);
    var padBot = portrait ? (short ? 106 : 128) : low ? 54 : 100;
    var availW = W - padX * 2, availH = H - padTop - padBot;
    var k = Math.min(availW / (maxX - minX), availH / (maxY - minY));
    FOCAL *= k;
    minX *= k; maxX *= k; minY *= k; maxY *= k;
    CX = W / 2 - (minX + maxX) / 2;
    var spare = availH - (maxY - minY);
    CY = padTop + Math.max(0, spare) * (portrait ? 0.8 : 0.6) - minY;
  }

  /* ================= helpers ================= */
  function srnd(n) { var x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function ease(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
  function now() { return performance.now(); }
  function polyPath(g, pts) { g.beginPath(); g.moveTo(pts[0].x, pts[0].y); for (var i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y); g.closePath(); }
  function panOf(s) { return clamp((K.sx(s) - 3.5) / 4.5, -0.8, 0.8); }
  function rrect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
  function newCv() { var c = document.createElement("canvas"); c.width = canvas.width; c.height = canvas.height; var g = c.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); return { c: c, g: g }; }
  function cvOf(w, h) { var c = document.createElement("canvas"); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h)); return c; }
  /* a cheap, smooth flicker: a few incommensurate sines */
  function wob(t, k) { return Math.sin(t * 1.7 + k) * 0.5 + Math.sin(t * 3.9 + k * 2.3) * 0.3 + Math.sin(t * 8.3 + k * 0.7) * 0.2; }

  /* Map unit space onto a parallelogram in the world: the origin goes to (x, y, z),
     (1, 0) to (x, y, z) + U and (0, 1) to (x, y, z) + V. Good for anything small and
     flat (a disc face, a shadow, a plaque), where perspective inside it is negligible. */
  function affine(g, x, y, z, ux, uy, uz, vx, vy, vz) {
    var p0 = project(x, y, z), pu = project(x + ux, y + uy, z + uz), pv = project(x + vx, y + vy, z + vz);
    g.setTransform(dpr * (pu.x - p0.x), dpr * (pu.y - p0.y), dpr * (pv.x - p0.x), dpr * (pv.y - p0.y), dpr * p0.x, dpr * p0.y);
    return p0;
  }
  function resetT(g) { g.setTransform(dpr, 0, 0, dpr, 0, 0); }
  var TAU = Math.PI * 2;

  /* Lay a flat texture onto the horizontal plane at height y, one device row at a
     time: every screen row is one line of constant depth, so this is exact. */
  function mapPlane(g, tex, X0, X1, Z0, Z1, y, minY, maxY) {
    var top = Math.max(minY || 0, project(0, y, Z0).y), bot = Math.min(maxY == null ? H : maxY, project(0, y, Z1).y);
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

  /* ================= textures ================= */
  var TX = { ebony: [], ivory: [], light: {}, shadow: null, fog: null, damask: null };
  function maxScale() { return project(0, 0, ZN).s * 1.1; }
  function buildTextures() {
    var px = Math.min(256, Math.max(64, Math.ceil(maxScale() * DR * 2 * dpr * 1.3)));
    TX.ebony = []; TX.ivory = [];
    for (var i = 0; i < 4; i++) TX.ebony.push(faceTex(BLACK, i, px));
    for (var j = 0; j < 6; j++) TX.ivory.push(faceTex(WHITE, j, px));
    TX.light[BLACK] = lightTex(BLACK, px); TX.light[WHITE] = lightTex(WHITE, px);
    TX.shadow = shadowTex(Math.ceil(px * 0.8));
    if (!TX.fog) TX.fog = fogTex();
  }
  /* a disc face seen straight down, grain only (the light is a separate layer, so a
     disc can be turned without turning its highlight) */
  function faceTex(color, v, px) {
    var c = cvOf(px, px), g = c.getContext("2d"), r = px / 2;
    g.translate(r, r);
    g.beginPath(); g.arc(0, 0, r, 0, TAU); g.clip();
    if (color === BLACK) {
      /* ebony: near black, with the faint brown stripes of a good billet */
      var b = g.createRadialGradient(-r * 0.1, -r * 0.15, r * 0.1, 0, 0, r);
      b.addColorStop(0, "#2a201b"); b.addColorStop(0.7, "#17110e"); b.addColorStop(1, "#0d0908");
      g.fillStyle = b; g.fillRect(-r, -r, px, px);
      var n = 16 + ((srnd(v * 3.1) * 10) | 0);
      for (var i = 0; i < n; i++) {
        var y = -r + (i + srnd(v * 7 + i)) / n * px, wob2 = (srnd(i * 2.3 + v) - 0.5) * r * 0.3;
        g.strokeStyle = srnd(i * 4.1 + v) > 0.62 ? "rgba(92,58,34," + (0.09 + srnd(i + v * 9) * 0.12) + ")" : "rgba(0,0,0," + (0.14 + srnd(i * 1.9) * 0.16) + ")";
        g.lineWidth = r * (0.02 + srnd(i * 5.5 + v) * 0.08);
        g.beginPath(); g.moveTo(-r, y); g.bezierCurveTo(-r * 0.3, y + wob2, r * 0.3, y - wob2, r, y + wob2 * 0.5); g.stroke();
      }
    } else {
      /* ivory: warm cream, fine grain, a soft yellowing toward one side */
      var w = g.createRadialGradient(-r * 0.12, -r * 0.18, r * 0.1, 0, 0, r);
      w.addColorStop(0, "#f7efdc"); w.addColorStop(0.65, "#ece0c4"); w.addColorStop(1, "#d9c8a4");
      g.fillStyle = w; g.fillRect(-r, -r, px, px);
      var py2 = g.createRadialGradient(r * (srnd(v) - 0.5), r * (srnd(v * 2) - 0.5), 0, 0, 0, r * 1.2);
      py2.addColorStop(0, "rgba(214,180,110,0.22)"); py2.addColorStop(1, "rgba(214,180,110,0)");
      g.fillStyle = py2; g.fillRect(-r, -r, px, px);
      for (var k = 0; k < 40; k++) {
        var yy = -r + (k + srnd(k * 1.3 + v)) / 40 * px;
        g.strokeStyle = "rgba(150,120,78," + (0.04 + srnd(k * 3.7 + v) * 0.07) + ")";
        g.lineWidth = Math.max(0.6, r * 0.012);
        g.beginPath(); g.moveTo(-r, yy); g.quadraticCurveTo(0, yy + (srnd(k + v * 5) - 0.5) * r * 0.12, r, yy); g.stroke();
      }
    }
    return c;
  }
  /* the overhead gasolier on a disc's face: a broad sheen toward the far side, a
     brighter catch on the far bevel, the near bevel in shade */
  function lightTex(color, px) {
    var c = cvOf(px, px), g = c.getContext("2d"), r = px / 2;
    g.translate(r, r);
    g.beginPath(); g.arc(0, 0, r, 0, TAU); g.clip();
    var eb = color === BLACK;
    var sh = g.createRadialGradient(-r * 0.18, -r * 0.42, 0, -r * 0.18, -r * 0.42, r * 0.95);
    sh.addColorStop(0, eb ? "rgba(255,236,206,0.2)" : "rgba(255,255,248,0.32)"); sh.addColorStop(1, "rgba(255,236,206,0)");
    g.fillStyle = sh; g.fillRect(-r, -r, px, px);
    if (eb) {
      var sp = g.createRadialGradient(-r * 0.24, -r * 0.55, 0, -r * 0.24, -r * 0.55, r * 0.28);
      sp.addColorStop(0, "rgba(255,244,224,0.42)"); sp.addColorStop(1, "rgba(255,244,224,0)");
      g.fillStyle = sp; g.fillRect(-r, -r, px, px);
    }
    var near = g.createLinearGradient(0, -r, 0, r);
    near.addColorStop(0, "rgba(0,0,0,0)"); near.addColorStop(0.55, "rgba(0,0,0,0)"); near.addColorStop(1, eb ? "rgba(0,0,0,0.35)" : "rgba(80,58,30,0.28)");
    g.fillStyle = near; g.fillRect(-r, -r, px, px);
    /* the bevel: a thin ring, bright on the far edge, dark on the near */
    var bev = g.createLinearGradient(0, -r, 0, r);
    bev.addColorStop(0, eb ? "rgba(255,226,186,0.55)" : "rgba(255,255,250,0.85)");
    bev.addColorStop(0.5, eb ? "rgba(255,226,186,0.08)" : "rgba(255,255,250,0.1)");
    bev.addColorStop(1, eb ? "rgba(0,0,0,0.5)" : "rgba(90,66,36,0.5)");
    g.strokeStyle = bev; g.lineWidth = r * 0.09;
    g.beginPath(); g.arc(0, 0, r * 0.95, 0, TAU); g.stroke();
    return c;
  }
  function shadowTex(px) {
    var c = cvOf(px, px), g = c.getContext("2d"), r = px / 2;
    var gr = g.createRadialGradient(r, r, 0, r, r, r);
    gr.addColorStop(0, "rgba(4,10,6,0.62)"); gr.addColorStop(0.62, "rgba(4,10,6,0.5)"); gr.addColorStop(0.78, "rgba(4,10,6,0.22)"); gr.addColorStop(1, "rgba(4,10,6,0)");
    g.fillStyle = gr; g.fillRect(0, 0, px, px);
    return c;
  }
  function fogTex() {
    var c = cvOf(512, 256), g = c.getContext("2d");
    for (var i = 0; i < 160; i++) {
      var x = srnd(i * 1.7) * 512, y = 40 + srnd(i * 2.9) * 200, r = 22 + srnd(i * 4.3) * 60;
      for (var dx = -512; dx <= 512; dx += 512) {
        var gr = g.createRadialGradient(x + dx, y, 0, x + dx, y, r);
        gr.addColorStop(0, "rgba(168,186,202," + (0.05 + srnd(i) * 0.06) + ")"); gr.addColorStop(1, "rgba(168,186,202,0)");
        g.fillStyle = gr; g.fillRect(x + dx - r, y - r, r * 2, r * 2);
      }
    }
    return c;
  }
  /* the edge of a disc, shaded across: a gradient in the disc's own unit space */
  function edgeFill(g, color) {
    var key = color === BLACK ? "_eb" : "_iv";
    if (!g[key]) {
      var gr = g.createLinearGradient(-1, -0.4, 1, 0.4);
      if (color === BLACK) { gr.addColorStop(0, "#43322a"); gr.addColorStop(0.4, "#1e1612"); gr.addColorStop(1, "#060403"); }
      else { gr.addColorStop(0, "#f1e6cb"); gr.addColorStop(0.45, "#cdb993"); gr.addColorStop(1, "#7f6b4c"); }
      g[key] = gr;
    }
    return g[key];
  }

  /* ================= a disc ================= */
  /* d: { x, y, z: the disc's center; th: how far it has turned (0..PI) about a
     horizontal axis (ax, az); top: the color of the face that started up; bot: the
     other; v, rot: which grain, at what angle; pip: the last-move mark } */
  var CAM_Y = 0, CAM_Z = 0;
  function drawDisc(g, d) {
    var th = d.th || 0, cth = Math.cos(th), sth = Math.sin(th);
    var ax = d.ax == null ? 1 : d.ax, az = d.az || 0;
    var wx = -az, wz = ax;
    var nx = wx * sth, ny = cth, nz = wz * sth;              /* the top face's normal */
    var vx = wx * cth, vy = -sth, vz = wz * cth;             /* in the face, across the axis */
    var R = DR * (d.k || 1);
    var topFacing = nx * (-d.x) + ny * (CAM_Y - d.y) + nz * (CAM_Z - d.z) > 0;
    var slices = th ? 6 : 3;
    for (var i = 0; i <= slices; i++) {
      var f = topFacing ? i / slices : 1 - i / slices, h = (f - 0.5) * DT;
      affine(g, d.x + nx * h, d.y + ny * h, d.z + nz * h, ax * R, 0, az * R, vx * R, vy * R, vz * R);
      g.fillStyle = edgeFill(g, f >= 0.5 ? d.top : d.bot);
      g.beginPath(); g.arc(0, 0, 1, 0, TAU); g.fill();
    }
    var sg = topFacing ? 1 : -1, face = topFacing ? d.top : d.bot;
    var fx = d.x + nx * DT * 0.5 * sg, fy = d.y + ny * DT * 0.5 * sg, fz = d.z + nz * DT * 0.5 * sg;
    var cr = Math.cos(d.rot || 0), sr = Math.sin(d.rot || 0);
    var fux = ax * cr + vx * sr, fuy = vy * sr, fuz = az * cr + vz * sr;
    var fvx = -ax * sr + vx * cr, fvy = vy * cr, fvz = -az * sr + vz * cr;
    affine(g, fx, fy, fz, fux * R, fuy * R, fuz * R, fvx * R * sg, fvy * R * sg, fvz * R * sg);
    var tex = face === BLACK ? TX.ebony[(d.v || 0) % TX.ebony.length] : TX.ivory[(d.v || 0) % TX.ivory.length];
    g.drawImage(tex, -1, -1, 2, 2);
    /* the gasolier's light, fixed to the room for a disc at rest */
    if (!th) affine(g, fx, fy, fz, R, 0, 0, 0, 0, R);
    else affine(g, fx, fy, fz, ax * R, 0, az * R, vx * R * sg, vy * R * sg, vz * R * sg);
    g.drawImage(TX.light[face], -1, -1, 2, 2);
    if (th) {
      /* a face turned away from the lamp goes darker */
      var lit = (ny * 0.75 + nz * 0.66) * sg;
      var dark = clamp((0.95 - lit) * 0.3, 0, 0.32);
      if (dark > 0.01) { g.fillStyle = "rgba(0,0,0," + dark + ")"; g.beginPath(); g.arc(0, 0, 1, 0, TAU); g.fill(); }
    }
    if (d.glow) {
      g.fillStyle = "rgba(255,214,120," + (0.1 + d.glow * 0.12) + ")";
      g.beginPath(); g.arc(0, 0, 1, 0, TAU); g.fill();
    }
    if (d.pip) {
      g.fillStyle = face === BLACK ? "#c23a2c" : "#a8261c";
      g.beginPath(); g.arc(0, 0, 0.17, 0, TAU); g.fill();
      g.strokeStyle = face === BLACK ? "rgba(255,190,160,0.55)" : "rgba(255,240,220,0.7)"; g.lineWidth = 0.05;
      g.beginPath(); g.arc(0, 0, 0.17, 0, TAU); g.stroke();
    }
    resetT(g);
  }
  /* a soft contact shadow on the baize; height lifts and softens it */
  function drawShadow(g, x, z, lift, alpha) {
    var k = 1.22 + lift * 0.9, a = (alpha == null ? 1 : alpha) * (1 - Math.min(0.65, lift * 1.1));
    if (a <= 0.02) return;
    affine(g, x + 0.045 + lift * 0.12, 0.002, z + 0.07 + lift * 0.22, DR * k, 0, 0, 0, 0, DR * k);
    g.globalAlpha = a; g.drawImage(TX.shadow, -1, -1, 2, 2); g.globalAlpha = 1;
    resetT(g);
  }

  /* ================= the scene ================= */
  function buildScene() {
    CAM_Y = CAM_D * SIN; CAM_Z = CAM_D * COS;
    var back = newCv(), cs = newCv(), win = newCv();
    backCv = back.c; caseCv = cs.c; winCv = win.c;
    discCv = newCv().c;
    var top = project(0, RIM_H, ZF).y;
    SILL = clamp(top - (portrait ? 14 : Math.max(18, H * 0.03)), 40, H * 0.55);
    layoutRoom();
    drawRoom(back.g, win.g);
    drawTable(back.g);
    drawCase(cs.g);
    measureRects();
  }

  /* ---------- the room above the table: green walls, the window, the chair, the fire ---------- */
  function layoutRoom() {
    var hb = SILL, u = hb;
    var R = { hb: hb };
    var winW = portrait ? clamp(W * 0.22, 64, 120) : clamp(W * 0.13, 90, 230);
    R.win = { x: portrait ? W * 0.05 : W * 0.06, y: hb * 0.13, w: winW, h: hb * 0.95 };
    R.chair = { x: W / 2, w: clamp(project(4, 0, -4).x - project(-4, 0, -4).x, 120, 520) * (portrait ? 0.62 : 0.52), top: hb * (portrait ? 0.4 : 0.36) };
    var fw = portrait ? clamp(W * 0.3, 96, 170) : clamp(W * 0.2, 150, 360);
    R.fire = { x: portrait ? W - fw * 0.92 : W * 0.72, w: fw };
    R.mantelY = hb * 0.47;
    R.sconces = portrait ? [{ x: (R.win.x + R.win.w + R.chair.x - R.chair.w / 2) / 2, y: hb * 0.3 }]
      : [{ x: (R.win.x + R.win.w + R.chair.x - R.chair.w / 2) / 2, y: hb * 0.32 }, { x: (R.chair.x + R.chair.w / 2 + R.fire.x) / 2, y: hb * 0.32 }];
    R.sr = clamp(u * 0.075, 6, 16);
    var fx = R.fire.x, fwid = R.fire.w;
    R.box = { x: fx + fwid * 0.2, y: hb * 0.64, w: fwid * 0.6, h: hb * 0.5 };
    R.clock = { x: fx + fwid * 0.5, y: R.mantelY - clamp(u * 0.16, 12, 34), r: clamp(u * 0.075, 6, 15) };
    void u;
    ROOM = R;
  }

  function drawRoom(g, wg) {
    var R = ROOM, hb = R.hb;
    /* the wall: deep green paper with a damask, over a dark mahogany dado */
    var wall = g.createLinearGradient(0, 0, 0, hb);
    wall.addColorStop(0, "#07100b"); wall.addColorStop(0.35, "#10261b"); wall.addColorStop(1, "#0b1a12");
    g.fillStyle = wall; g.fillRect(0, 0, W, hb + 2);
    var tile = damaskTile(clamp(hb * 0.18, 14, 34));
    g.save(); g.globalAlpha = 0.9; g.fillStyle = g.createPattern(tile, "repeat"); g.fillRect(0, hb * 0.08, W, hb * 0.6); g.restore();
    /* cornice and picture rail */
    var cor = g.createLinearGradient(0, 0, 0, hb * 0.07);
    cor.addColorStop(0, "#050806"); cor.addColorStop(1, "#16221a");
    g.fillStyle = cor; g.fillRect(0, 0, W, hb * 0.07);
    g.fillStyle = "#2a1a10"; g.fillRect(0, hb * 0.07, W, Math.max(2, hb * 0.012));
    g.fillStyle = "rgba(230,190,120,0.18)"; g.fillRect(0, hb * 0.07, W, 1);
    /* the dado: raised mahogany panels */
    var dy = hb * 0.68;
    var dado = g.createLinearGradient(0, dy, 0, hb);
    dado.addColorStop(0, "#2b1610"); dado.addColorStop(1, "#160a07");
    g.fillStyle = dado; g.fillRect(0, dy, W, hb - dy + 2);
    var pw = clamp(hb * 0.42, 36, 110);
    for (var x = pw * 0.18; x < W; x += pw) {
      g.strokeStyle = "rgba(0,0,0,0.45)"; g.lineWidth = 1.5; g.strokeRect(x, dy + hb * 0.06, pw * 0.82, hb * 0.5);
      g.strokeStyle = "rgba(220,150,100,0.08)"; g.lineWidth = 1; g.strokeRect(x + 1.5, dy + hb * 0.06 + 1.5, pw * 0.82, hb * 0.5);
    }
    g.fillStyle = "#3a1e13"; g.fillRect(0, dy - 3, W, 5);
    g.fillStyle = "rgba(240,190,130,0.2)"; g.fillRect(0, dy - 3, W, 1);

    drawWindowOutside(g);
    drawWindowFrame(wg);
    drawFireplace(g);
    drawChair(g);
    R.sconces.forEach(function (s) { drawSconce(g, s.x, s.y, R.sr); });
    /* the gas lamps' pools on the paper */
    g.globalCompositeOperation = "lighter";
    R.sconces.forEach(function (s) {
      var gl = g.createRadialGradient(s.x, s.y, 0, s.x, s.y, hb * 0.9);
      gl.addColorStop(0, "rgba(255,190,110,0.2)"); gl.addColorStop(0.4, "rgba(255,170,90,0.06)"); gl.addColorStop(1, "rgba(255,170,90,0)");
      g.fillStyle = gl; g.fillRect(s.x - hb, 0, hb * 2, hb);
    });
    g.globalCompositeOperation = "source-over";
  }
  function damaskTile(u) {
    var c = cvOf(u, u * 1.4), g = c.getContext("2d"), w = u, h = u * 1.4;
    g.strokeStyle = "rgba(60,110,78,0.14)"; g.fillStyle = "rgba(60,110,78,0.08)"; g.lineWidth = Math.max(0.8, u * 0.04);
    function motif(cx, cy, s) {
      g.beginPath();
      g.moveTo(cx, cy - s * 0.6);
      g.bezierCurveTo(cx + s * 0.45, cy - s * 0.35, cx + s * 0.45, cy + s * 0.2, cx, cy + s * 0.6);
      g.bezierCurveTo(cx - s * 0.45, cy + s * 0.2, cx - s * 0.45, cy - s * 0.35, cx, cy - s * 0.6);
      g.fill(); g.stroke();
      g.beginPath(); g.arc(cx, cy - s * 0.05, s * 0.12, 0, TAU); g.stroke();
    }
    motif(w / 2, h / 2, u * 0.55);
    motif(0, 0, u * 0.4); motif(w, 0, u * 0.4); motif(0, h, u * 0.4); motif(w, h, u * 0.4);
    return c;
  }
  /* outside: a foggy street, the houses opposite, one gas lamp in the murk */
  function drawWindowOutside(g) {
    var o = ROOM.win, x = o.x, y = o.y, w = o.w, h = o.h;
    var sky = g.createLinearGradient(0, y, 0, y + h);
    sky.addColorStop(0, "#2c3a46"); sky.addColorStop(0.6, "#3b4a56"); sky.addColorStop(1, "#46535c");
    g.fillStyle = sky; g.fillRect(x, y, w, h);
    /* the terrace across the street */
    g.fillStyle = "rgba(24,32,40,0.75)";
    g.beginPath(); g.moveTo(x, y + h * 0.42);
    for (var i = 0; i <= 6; i++) { var bx = x + w * i / 6; g.lineTo(bx, y + h * (0.36 + srnd(i * 3.3) * 0.08)); g.lineTo(bx + w / 6, y + h * (0.36 + srnd(i * 3.3) * 0.08)); }
    g.lineTo(x + w, y + h); g.lineTo(x, y + h); g.closePath(); g.fill();
    for (var k = 0; k < 9; k++) {
      var wx = x + w * (0.06 + srnd(k * 2.7) * 0.86), wy = y + h * (0.48 + srnd(k * 1.9) * 0.3);
      g.fillStyle = "rgba(255,196,120," + (0.12 + srnd(k) * 0.14) + ")";
      g.fillRect(wx, wy, Math.max(2, w * 0.05), Math.max(3, h * 0.04));
    }
    /* the street lamp, its light smeared by fog */
    var lx = x + w * 0.66, ly = y + h * 0.5;
    g.fillStyle = "rgba(14,18,22,0.7)"; g.fillRect(lx - 1, ly, 2, h * 0.5);
    var halo = g.createRadialGradient(lx, ly, 0, lx, ly, w * 0.55);
    halo.addColorStop(0, "rgba(255,220,150,0.75)"); halo.addColorStop(0.12, "rgba(255,200,130,0.35)"); halo.addColorStop(1, "rgba(200,190,170,0)");
    g.fillStyle = halo; g.fillRect(x, y, w, h);
    /* railings at the bottom */
    g.fillStyle = "rgba(10,12,14,0.7)";
    for (var r = x + 2; r < x + w; r += Math.max(4, w * 0.06)) g.fillRect(r, y + h * 0.8, 1.4, h * 0.2);
    g.fillRect(x, y + h * 0.8, w, 1.5);
  }
  function drawWindowFrame(g) {
    var o = ROOM.win, x = o.x, y = o.y, w = o.w, h = o.h, fr = Math.max(3, w * 0.05);
    g.fillStyle = "#1d130d";
    g.fillRect(x - fr, y - fr, w + fr * 2, fr);
    g.fillRect(x - fr, y, fr, h); g.fillRect(x + w, y, fr, h);
    /* the two sashes, meeting rail across the middle, glazing bars */
    g.fillRect(x, y + h * 0.48, w, fr * 1.1);
    var bar = Math.max(1.5, fr * 0.45);
    g.fillRect(x + w / 2 - bar / 2, y, bar, h);
    g.fillRect(x, y + h * 0.24, w, bar); g.fillRect(x, y + h * 0.74, w, bar);
    g.fillStyle = "rgba(230,190,140,0.12)";
    g.fillRect(x + w / 2 - bar / 2, y, 1, h); g.fillRect(x, y + h * 0.48, w, 1);
    /* old glass catching the room */
    g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
    g.globalCompositeOperation = "lighter";
    for (var i = 0; i < 3; i++) {
      var sx = x + w * (0.1 + i * 0.35);
      var gl = g.createLinearGradient(sx, y, sx + w * 0.25, y + h * 0.3);
      gl.addColorStop(0, "rgba(255,210,160,0)"); gl.addColorStop(0.5, "rgba(255,210,160,0.05)"); gl.addColorStop(1, "rgba(255,210,160,0)");
      g.fillStyle = gl; g.fillRect(x, y, w, h);
    }
    g.restore();
    /* heavy oxblood velvet, drawn back */
    var cw = Math.max(14, w * 0.3);
    [[x - fr - cw * 0.7, 1], [x + w + fr - cw * 0.3, -1]].forEach(function (c) {
      var cx = c[0], cg = g.createLinearGradient(cx, 0, cx + cw, 0);
      for (var k = 0; k <= 6; k++) cg.addColorStop(k / 6, k % 2 ? "#3e0d0b" : "#6a1a15");
      g.fillStyle = cg;
      g.beginPath();
      g.moveTo(cx, y - fr * 2); g.lineTo(cx + cw, y - fr * 2);
      g.quadraticCurveTo(cx + cw * (c[1] > 0 ? 0.6 : 0.95), y + h * 0.55, cx + cw * (c[1] > 0 ? 0.9 : 0.6), ROOM.hb + 4);
      g.lineTo(cx + cw * (c[1] > 0 ? 0.0 : 0.1), ROOM.hb + 4);
      g.closePath(); g.fill();
      /* the tieback */
      g.fillStyle = "#b8893a"; g.fillRect(cx + cw * 0.15, y + h * 0.56, cw * 0.7, Math.max(2, h * 0.02));
    });
    /* pelmet with a gold fringe */
    var pg = g.createLinearGradient(0, y - fr * 3, 0, y + h * 0.06);
    pg.addColorStop(0, "#4a0f0c"); pg.addColorStop(1, "#2a0806");
    g.fillStyle = pg; g.fillRect(x - fr - cw * 0.7, y - fr * 3, w + fr * 2 + cw * 1.4, h * 0.08 + fr * 2);
    g.fillStyle = "rgba(200,150,70,0.8)";
    for (var t = x - fr - cw * 0.7; t < x + w + fr + cw * 0.7; t += 3) g.fillRect(t, y + h * 0.06 - fr + 1, 1.2, Math.max(2, h * 0.025));
  }
  function drawSconce(g, x, y, r) {
    /* brass backplate and arm */
    g.fillStyle = "#6b4a1e"; rrect(g, x - r * 0.35, y + r * 0.6, r * 0.7, r * 1.6, r * 0.3); g.fill();
    g.strokeStyle = "#a8803a"; g.lineWidth = Math.max(1.5, r * 0.18);
    g.beginPath(); g.moveTo(x, y + r * 1.4); g.quadraticCurveTo(x, y + r * 0.9, x, y + r * 0.55); g.stroke();
    /* the frosted tulip shade, lit from inside */
    var sh = g.createRadialGradient(x, y + r * 0.1, r * 0.1, x, y, r * 1.1);
    sh.addColorStop(0, "#fff5d8"); sh.addColorStop(0.5, "#f5d79a"); sh.addColorStop(1, "#c08a42");
    g.fillStyle = sh;
    g.beginPath();
    g.moveTo(x - r * 0.3, y + r * 0.6);
    g.bezierCurveTo(x - r * 1.05, y + r * 0.2, x - r * 0.95, y - r * 0.8, x - r * 0.5, y - r * 0.95);
    g.lineTo(x + r * 0.5, y - r * 0.95);
    g.bezierCurveTo(x + r * 0.95, y - r * 0.8, x + r * 1.05, y + r * 0.2, x + r * 0.3, y + r * 0.6);
    g.closePath(); g.fill();
    g.strokeStyle = "rgba(255,240,200,0.6)"; g.lineWidth = 1;
    g.beginPath(); g.ellipse(x, y - r * 0.95, r * 0.5, r * 0.12, 0, 0, TAU); g.stroke();
  }
  function drawChair(g) {
    /* the far player's chair: a tall buttoned wingback in oxblood leather */
    var c = ROOM.chair, cx = c.x, w = c.w, top = c.top, bot = ROOM.hb + 4;
    var hw = w / 2;
    var lg = g.createLinearGradient(cx - hw, 0, cx + hw, 0);
    lg.addColorStop(0, "#2a0807"); lg.addColorStop(0.25, "#5e1612"); lg.addColorStop(0.5, "#6e1c16"); lg.addColorStop(0.78, "#4a100d"); lg.addColorStop(1, "#1c0505");
    g.fillStyle = lg;
    g.beginPath();
    g.moveTo(cx - hw, bot);
    g.lineTo(cx - hw, top + w * 0.16);
    g.bezierCurveTo(cx - hw, top - w * 0.02, cx - hw * 0.72, top - w * 0.05, cx - hw * 0.55, top + w * 0.02);
    g.bezierCurveTo(cx - hw * 0.3, top - w * 0.06, cx + hw * 0.3, top - w * 0.06, cx + hw * 0.55, top + w * 0.02);
    g.bezierCurveTo(cx + hw * 0.72, top - w * 0.05, cx + hw, top - w * 0.02, cx + hw, top + w * 0.16);
    g.lineTo(cx + hw, bot); g.closePath(); g.fill();
    g.save(); g.clip();
    /* diamond tufting: creases and buttons */
    var step = Math.max(10, w * 0.12);
    g.strokeStyle = "rgba(10,0,0,0.45)"; g.lineWidth = 1;
    for (var k = -12; k < 12; k++) {
      g.beginPath(); g.moveTo(cx + k * step, top + w * 0.1); g.lineTo(cx + k * step + (bot - top), bot); g.stroke();
      g.beginPath(); g.moveTo(cx + k * step, top + w * 0.1); g.lineTo(cx + k * step - (bot - top), bot); g.stroke();
    }
    for (var row = 0; row < 8; row++) for (var col = -8; col <= 8; col++) {
      var bx = cx + col * step + (row % 2 ? step / 2 : 0), by = top + w * 0.1 + row * step / 2;
      if (by > bot) continue;
      g.fillStyle = "rgba(12,2,2,0.7)"; g.beginPath(); g.arc(bx, by, Math.max(1.2, step * 0.09), 0, TAU); g.fill();
      g.fillStyle = "rgba(255,170,140,0.18)"; g.beginPath(); g.arc(bx - 0.6, by - 0.6, Math.max(0.6, step * 0.04), 0, TAU); g.fill();
    }
    /* the gaslight on the top roll */
    var hl = g.createLinearGradient(0, top - w * 0.05, 0, top + w * 0.2);
    hl.addColorStop(0, "rgba(255,190,150,0.3)"); hl.addColorStop(1, "rgba(255,190,150,0)");
    g.fillStyle = hl; g.fillRect(cx - hw, top - w * 0.1, w, w * 0.32);
    g.restore();
    /* brass nailheads along the top */
    g.fillStyle = "rgba(220,170,80,0.85)";
    for (var t = 0; t <= 1; t += 0.035) {
      var px = cx - hw * 0.92 + hw * 1.84 * t, py = top + w * 0.04 - Math.sin(t * Math.PI) * w * 0.04 + (Math.abs(t - 0.5) > 0.38 ? w * 0.04 : 0);
      g.beginPath(); g.arc(px, py, Math.max(0.9, w * 0.008), 0, TAU); g.fill();
    }
  }
  function drawFireplace(g) {
    var R = ROOM, f = R.fire, hb = R.hb, x = f.x, w = f.w, my = R.mantelY;
    /* a gilt frame over the mantel, an old dark seascape in it */
    var pw = w * 0.62, ph = Math.max(10, my - hb * 0.18 - (R.clock.r * 3.4)), px0 = x + (w - pw) / 2, py0 = hb * 0.12;
    if (ph > 14) {
      g.fillStyle = "#7a5520"; g.fillRect(px0 - 4, py0 - 4, pw + 8, ph + 8);
      g.strokeStyle = "rgba(255,220,140,0.45)"; g.lineWidth = 1; g.strokeRect(px0 - 3.5, py0 - 3.5, pw + 7, ph + 7);
      var pt = g.createLinearGradient(0, py0, 0, py0 + ph);
      pt.addColorStop(0, "#2a2a22"); pt.addColorStop(0.55, "#4a4632"); pt.addColorStop(0.6, "#1e2a2a"); pt.addColorStop(1, "#141c1c");
      g.fillStyle = pt; g.fillRect(px0, py0, pw, ph);
      g.fillStyle = "rgba(230,200,140,0.18)"; g.beginPath(); g.ellipse(px0 + pw * 0.7, py0 + ph * 0.35, pw * 0.08, ph * 0.08, 0, 0, TAU); g.fill();
      g.fillStyle = "rgba(10,10,8,0.6)"; g.beginPath(); g.moveTo(px0 + pw * 0.3, py0 + ph * 0.58); g.lineTo(px0 + pw * 0.36, py0 + ph * 0.3); g.lineTo(px0 + pw * 0.4, py0 + ph * 0.58); g.fill();
    }
    /* the surround: black marble, a little green in the veins */
    var sy = my, sx = x, sw = w;
    var mg = g.createLinearGradient(sx, 0, sx + sw, 0);
    mg.addColorStop(0, "#0e1310"); mg.addColorStop(0.5, "#1c241f"); mg.addColorStop(1, "#0b0f0d");
    g.fillStyle = mg; g.fillRect(sx, sy, sw, hb - sy + 4);
    g.strokeStyle = "rgba(160,190,170,0.08)"; g.lineWidth = 1;
    for (var v = 0; v < 6; v++) {
      g.beginPath(); g.moveTo(sx + srnd(v) * sw, sy); g.bezierCurveTo(sx + srnd(v + 1) * sw, sy + (hb - sy) * 0.3, sx + srnd(v + 2) * sw, sy + (hb - sy) * 0.6, sx + srnd(v + 3) * sw, hb); g.stroke();
    }
    /* the mantel shelf */
    g.fillStyle = "#1a201c"; g.fillRect(sx - w * 0.06, sy - Math.max(3, hb * 0.03), sw + w * 0.12, Math.max(4, hb * 0.04));
    g.fillStyle = "rgba(220,230,220,0.14)"; g.fillRect(sx - w * 0.06, sy - Math.max(3, hb * 0.03), sw + w * 0.12, 1);
    /* the firebox: black iron, the back glowing */
    var b = R.box;
    var fb = g.createLinearGradient(0, b.y, 0, b.y + b.h);
    fb.addColorStop(0, "#050302"); fb.addColorStop(0.6, "#2a0e04"); fb.addColorStop(1, "#4a1a06");
    g.fillStyle = fb;
    g.beginPath(); g.moveTo(b.x, b.y + b.h); g.lineTo(b.x, b.y + b.w * 0.18); g.quadraticCurveTo(b.x + b.w / 2, b.y - b.w * 0.12, b.x + b.w, b.y + b.w * 0.18); g.lineTo(b.x + b.w, b.y + b.h); g.closePath(); g.fill();
    g.strokeStyle = "#3a3a34"; g.lineWidth = Math.max(1.5, w * 0.012); g.stroke();
    /* the clock on the mantel: a brass bracket clock, arched top, enamel dial */
    var c = R.clock, cr = c.r;
    g.fillStyle = "#5a3a14";
    rrect(g, c.x - cr * 1.5, c.y - cr * 1.4, cr * 3, cr * 3.1 + (sy - (c.y + cr * 1.7)), cr * 0.3); g.fill();
    var bg = g.createLinearGradient(c.x - cr * 1.5, 0, c.x + cr * 1.5, 0);
    bg.addColorStop(0, "#7a5118"); bg.addColorStop(0.35, "#d9ac52"); bg.addColorStop(1, "#5a3a12");
    g.fillStyle = bg;
    g.beginPath(); g.moveTo(c.x - cr * 1.5, c.y - cr * 1.2); g.quadraticCurveTo(c.x, c.y - cr * 2.6, c.x + cr * 1.5, c.y - cr * 1.2); g.closePath(); g.fill();
    g.fillRect(c.x - cr * 1.6, sy - Math.max(3, cr * 0.5), cr * 3.2, Math.max(3, cr * 0.5));
    g.fillStyle = "#c99a40"; g.beginPath(); g.arc(c.x, c.y - cr * 2.2, Math.max(1.2, cr * 0.18), 0, TAU); g.fill();
    var dial = g.createRadialGradient(c.x - cr * 0.3, c.y - cr * 0.3, 0, c.x, c.y, cr);
    dial.addColorStop(0, "#fbf6ea"); dial.addColorStop(1, "#d8ccb0");
    g.fillStyle = dial; g.beginPath(); g.arc(c.x, c.y, cr, 0, TAU); g.fill();
    g.strokeStyle = "#a07a30"; g.lineWidth = Math.max(1, cr * 0.14); g.stroke();
    g.fillStyle = "#3a2a18";
    for (var hI = 0; hI < 12; hI++) {
      var a = hI / 12 * TAU, rr = cr * 0.8;
      g.fillRect(c.x + Math.cos(a) * rr - 0.6, c.y + Math.sin(a) * rr - 0.6, hI % 3 ? 1 : 1.8, hI % 3 ? 1 : 1.8);
    }
    /* a candlestick on each end of the mantel */
    [sx + w * 0.08, sx + w * 0.92].forEach(function (bx) {
      var ch = clamp(hb * 0.12, 8, 26);
      g.fillStyle = "#a8803a"; g.fillRect(bx - 1.2, sy - ch, 2.4, ch);
      g.fillRect(bx - ch * 0.18, sy - 2.5, ch * 0.36, 2.5);
      g.fillStyle = "#efe6d0"; g.fillRect(bx - 1.6, sy - ch - ch * 0.5, 3.2, ch * 0.5);
    });
  }

  /* ---------- the card table: polished mahogany, lit from above and by the fire ---------- */
  function drawTable(g) {
    var zFar = unproject(CX, SILL + 1, TABLE_Y).z;
    var X0 = -30, X1 = 30, Z0 = Math.max(zFar, -90), Z1 = 30;
    var tex = mahoganyTexture(X1 - X0, Z1 - Z0, 1);
    g.save(); g.setTransform(1, 0, 0, 1, 0, 0);
    mapPlane(g, tex, X0, X1, Z0, Z1, TABLE_Y, SILL);
    g.restore();
    /* the table's far edge, against the chair */
    g.fillStyle = "#1a0a06"; g.fillRect(0, SILL - 2, W, 4);
    g.fillStyle = "rgba(255,190,130,0.22)"; g.fillRect(0, SILL - 2, W, 1);
    /* light: the gasolier's pool, the fire from the right, the window's cold light at left */
    var c0 = project(0, TABLE_Y, 0), reach = Math.max(W, H) * 0.75;
    g.globalCompositeOperation = "lighter";
    var pool = g.createRadialGradient(c0.x, c0.y, 0, c0.x, c0.y, reach);
    pool.addColorStop(0, "rgba(255,186,110,0.2)"); pool.addColorStop(0.45, "rgba(255,160,90,0.07)"); pool.addColorStop(1, "rgba(255,160,90,0)");
    g.fillStyle = pool; g.fillRect(0, SILL, W, H - SILL);
    var fx = ROOM.fire.x + ROOM.fire.w / 2;
    var fire = g.createRadialGradient(fx, SILL, 0, fx, SILL, Math.max(W, H) * 0.6);
    fire.addColorStop(0, "rgba(255,120,40,0.16)"); fire.addColorStop(1, "rgba(255,120,40,0)");
    g.fillStyle = fire; g.fillRect(0, SILL, W, H - SILL);
    var wx = ROOM.win.x + ROOM.win.w / 2;
    var cold = g.createRadialGradient(wx, SILL, 0, wx, SILL, Math.max(W, H) * 0.5);
    cold.addColorStop(0, "rgba(120,150,180,0.12)"); cold.addColorStop(1, "rgba(120,150,180,0)");
    g.fillStyle = cold; g.fillRect(0, SILL, W, H - SILL);
    g.globalCompositeOperation = "source-over";
    var vg = g.createRadialGradient(W / 2, c0.y, Math.min(W, H) * 0.3, W / 2, c0.y, Math.max(W, H) * 0.8);
    vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(0.6, "rgba(4,2,1,0.35)"); vg.addColorStop(1, "rgba(4,2,1,0.78)");
    g.fillStyle = vg; g.fillRect(0, SILL, W, H - SILL);
    /* the case's shadow on the table */
    /* only the blurred copy lands: the polygon itself is drawn far off the canvas and its
       shadow offset back into place (shadow offsets ignore the transform, so they are in
       device pixels), so the shadow has no hard edge */
    var OFF = W + H + 200;
    var sp = [[-HX, ZF], [HX, ZF], [HX, ZN], [-HX, ZN]].map(function (q) { var p = project(q[0] + 0.06, TABLE_Y, q[1] + 0.2); return { x: p.x - OFF, y: p.y }; });
    g.save();
    g.shadowColor = "rgba(4,1,0,0.78)"; g.shadowBlur = project(0, TABLE_Y, ZN).s * 0.9 * dpr;
    g.shadowOffsetX = OFF * dpr;
    polyPath(g, sp); g.fillStyle = "#000"; g.fill();
    g.restore();
    if (!portrait) drawProps(g);
  }
  function mahoganyTexture(wu, du, kind) {
    var ppu = clamp(Math.floor(3000 / Math.max(wu, du)), 6, 40);
    var tw = Math.ceil(wu * ppu), th = Math.ceil(du * ppu);
    var c = cvOf(tw, th), g = c.getContext("2d");
    var base = g.createLinearGradient(0, 0, 0, th);
    base.addColorStop(0, kind ? "#2a110a" : "#5a2414"); base.addColorStop(1, kind ? "#3a170c" : "#4a1d10");
    g.fillStyle = base; g.fillRect(0, 0, tw, th);
    /* long figured grain running across */
    for (var i = 0; i < 260; i++) {
      var y = srnd(i * 1.31 + kind) * th, amp = ppu * (0.1 + srnd(i * 2.2) * 0.6);
      g.strokeStyle = srnd(i * 3.7) > 0.5 ? "rgba(140,60,30," + (0.06 + srnd(i) * 0.1) + ")" : "rgba(10,2,0," + (0.08 + srnd(i * 5) * 0.14) + ")";
      g.lineWidth = Math.max(0.6, ppu * (0.03 + srnd(i * 7.1) * 0.12));
      g.beginPath(); g.moveTo(0, y);
      for (var x = 0; x <= tw; x += tw / 12) g.lineTo(x, y + Math.sin(x / tw * 9 + i) * amp);
      g.stroke();
    }
    return c;
  }
  function drawProps(g) {
    /* a brandy glass on the left, a brass tray with a cigar on the right */
    var gx = -HX - 1.7, gz = 1.4;
    if (project(gx - 0.8, TABLE_Y, gz).x > 8) {
      var b = project(gx, TABLE_Y, gz), s = b.s;
      g.fillStyle = "rgba(0,0,0,0.4)"; g.beginPath(); g.ellipse(b.x + s * 0.15, b.y + s * 0.05, s * 0.5, s * 0.5 * SIN, 0, 0, TAU); g.fill();
      var bowlY = b.y - s * 0.95 * COS - s * 0.2, br = s * 0.48;
      g.fillStyle = "rgba(220,230,235,0.12)"; g.beginPath(); g.ellipse(b.x, b.y, s * 0.36, s * 0.36 * SIN, 0, 0, TAU); g.fill();
      g.strokeStyle = "rgba(230,240,245,0.4)"; g.lineWidth = 1; g.stroke();
      g.fillRect(b.x - 1, bowlY + br * 0.8, 2, b.y - bowlY - br * 0.8);
      var liq = g.createLinearGradient(0, bowlY, 0, bowlY + br);
      liq.addColorStop(0, "rgba(200,110,30,0.75)"); liq.addColorStop(1, "rgba(110,40,8,0.9)");
      g.fillStyle = liq; g.beginPath(); g.ellipse(b.x, bowlY + br * 0.25, br * 0.92, br * 0.66, 0, 0, Math.PI); g.fill();
      g.fillStyle = "rgba(230,240,245,0.08)"; g.beginPath(); g.ellipse(b.x, bowlY, br, br * 0.92, 0, 0, TAU); g.fill();
      g.strokeStyle = "rgba(240,248,252,0.42)"; g.lineWidth = 1.2; g.stroke();
      g.strokeStyle = "rgba(255,255,255,0.55)"; g.lineWidth = 1.5; g.beginPath(); g.arc(b.x, bowlY, br * 0.82, Math.PI * 1.1, Math.PI * 1.35); g.stroke();
      g.fillStyle = "rgba(255,220,160,0.6)"; g.beginPath(); g.ellipse(b.x - br * 0.3, bowlY + br * 0.3, br * 0.12, br * 0.05, -0.3, 0, TAU); g.fill();
    }
    var tx = HX + 1.8, tz = 1.6;
    if (project(tx + 1.0, TABLE_Y, tz).x < W - 8) {
      var t = project(tx, TABLE_Y, tz), ts = t.s;
      g.fillStyle = "rgba(0,0,0,0.4)"; g.beginPath(); g.ellipse(t.x + ts * 0.12, t.y + ts * 0.06, ts * 0.72, ts * 0.72 * SIN, 0, 0, TAU); g.fill();
      var tg = g.createLinearGradient(t.x - ts * 0.7, 0, t.x + ts * 0.7, 0);
      tg.addColorStop(0, "#6a4a18"); tg.addColorStop(0.35, "#d6a850"); tg.addColorStop(1, "#5a3c12");
      g.fillStyle = tg; g.beginPath(); g.ellipse(t.x, t.y - ts * 0.05, ts * 0.66, ts * 0.66 * SIN, 0, 0, TAU); g.fill();
      g.fillStyle = "#3a2a10"; g.beginPath(); g.ellipse(t.x, t.y - ts * 0.04, ts * 0.48, ts * 0.48 * SIN, 0, 0, TAU); g.fill();
      /* the cigar resting across the rim */
      g.strokeStyle = "#5a3418"; g.lineCap = "round"; g.lineWidth = Math.max(3, ts * 0.12);
      var c1 = { x: t.x - ts * 0.5, y: t.y - ts * 0.2 }, c2 = { x: t.x + ts * 0.42, y: t.y - ts * 0.02 };
      g.beginPath(); g.moveTo(c1.x, c1.y); g.lineTo(c2.x, c2.y); g.stroke();
      g.strokeStyle = "rgba(255,200,150,0.25)"; g.lineWidth = Math.max(1, ts * 0.03);
      g.beginPath(); g.moveTo(c1.x, c1.y - ts * 0.04); g.lineTo(c2.x, c2.y - ts * 0.04); g.stroke();
      g.strokeStyle = "#bfa070"; g.lineWidth = Math.max(3, ts * 0.12); g.lineCap = "butt";
      g.beginPath(); g.moveTo(c2.x - ts * 0.18, c2.y - ts * 0.04); g.lineTo(c2.x - ts * 0.12, c2.y - ts * 0.03); g.stroke();
      ROOM.cigar = { x: c1.x, y: c1.y, s: ts };
    } else ROOM.cigar = null;
  }

  /* ---------- the case: mahogany rails, brass corners, a recess of green baize ---------- */
  function drawCase(g) {
    var PL = function (x, y, z) { return project(x, y, z); };
    /* the front of the case */
    var a = PL(-HX, RIM_H, ZN), b = PL(HX, RIM_H, ZN), c = PL(HX, TABLE_Y, ZN), d = PL(-HX, TABLE_Y, ZN);
    var fg = g.createLinearGradient(0, a.y, 0, d.y);
    fg.addColorStop(0, "#6a2a14"); fg.addColorStop(0.25, "#4e1c0c"); fg.addColorStop(1, "#200a04");
    g.fillStyle = fg; polyPath(g, [a, b, c, d]); g.fill();
    g.save(); polyPath(g, [a, b, c, d]); g.clip();
    for (var i = 0; i < 60; i++) {
      var yy = lerp(a.y, d.y, srnd(i * 2.1)), wv = (srnd(i * 1.3) - 0.5) * 3;
      g.strokeStyle = srnd(i * 7.7) > 0.5 ? "rgba(20,4,0,0.25)" : "rgba(255,170,120,0.05)";
      g.lineWidth = 0.6 + srnd(i * 2.2);
      g.beginPath(); g.moveTo(a.x, yy); g.quadraticCurveTo((a.x + b.x) / 2, yy + wv, b.x, yy - wv * 0.5); g.stroke();
    }
    var side = g.createLinearGradient(a.x, 0, b.x, 0);
    side.addColorStop(0, "rgba(120,160,190,0.06)"); side.addColorStop(0.5, "rgba(0,0,0,0)"); side.addColorStop(1, "rgba(255,120,50,0.08)");
    g.fillStyle = side; g.fillRect(a.x, a.y, b.x - a.x, d.y - a.y);
    g.restore();
    /* brass caps down the front corners, and an escutcheon in the middle */
    var cw = (b.x - a.x) * 0.022;
    [[a, d, 1], [b, c, -1]].forEach(function (e) {
      var x0 = e[2] > 0 ? e[0].x : e[0].x - cw;
      brassRect(g, x0, e[0].y, cw, e[1].y - e[0].y);
    });
    if (d.y - a.y > 12) {
      var m = PL(0, (RIM_H + TABLE_Y) / 2, ZN), ek = (d.y - a.y) * 0.32;
      brassRect(g, m.x - ek * 0.55, m.y - ek * 0.7, ek * 1.1, ek * 1.4, ek * 0.25);
      g.fillStyle = "#1a0c04"; g.beginPath(); g.arc(m.x, m.y - ek * 0.12, ek * 0.16, 0, TAU); g.fill();
      g.fillRect(m.x - ek * 0.06, m.y - ek * 0.1, ek * 0.12, ek * 0.4);
    }
    /* the rails' top, then the recess cut into it */
    var tex = mahoganyTexture(HX * 2, ZN - ZF, 0);
    g.save(); g.setTransform(1, 0, 0, 1, 0, 0);
    mapPlane(g, tex, -HX, HX, ZF, ZN, RIM_H);
    g.restore();
    /* rail lighting: lamp from above, fire on the right */
    var outer = [PL(-HX, RIM_H, ZF), PL(HX, RIM_H, ZF), PL(HX, RIM_H, ZN), PL(-HX, RIM_H, ZN)];
    g.save(); polyPath(g, outer); g.clip();
    g.globalCompositeOperation = "lighter";
    var hs = PL(-0.8, RIM_H, -1.2);
    var sheen = g.createRadialGradient(hs.x, hs.y, 0, hs.x, hs.y, hs.s * 9);
    sheen.addColorStop(0, "rgba(255,190,130,0.16)"); sheen.addColorStop(1, "rgba(255,190,130,0)");
    g.fillStyle = sheen; g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = "source-over";
    g.restore();
    /* edge highlights on the outer rim */
    g.strokeStyle = "rgba(255,200,150,0.35)"; g.lineWidth = Math.max(1, hs.s * 0.02);
    g.beginPath(); g.moveTo(outer[3].x, outer[3].y); g.lineTo(outer[2].x, outer[2].y); g.stroke();
    g.strokeStyle = "rgba(255,200,150,0.14)";
    polyPath(g, outer); g.stroke();
    /* the recess: inner walls in shadow */
    var inner = [PL(-4, RIM_H, -4), PL(4, RIM_H, -4), PL(4, RIM_H, 4), PL(-4, RIM_H, 4)];
    g.fillStyle = "#1a0904"; polyPath(g, inner); g.fill();
    /* the baize */
    var bt = baizeTexture();
    g.save(); polyPath(g, inner); g.clip();
    g.setTransform(1, 0, 0, 1, 0, 0);
    mapPlane(g, bt, -4, 4, -4, 4, 0);
    resetT(g);
    /* the far wall of the recess, lit */
    var fw = [PL(-4, RIM_H, -4), PL(4, RIM_H, -4), PL(4, 0, -4), PL(-4, 0, -4)];
    var wg = g.createLinearGradient(0, fw[0].y, 0, fw[3].y);
    wg.addColorStop(0, "#5a2410"); wg.addColorStop(1, "#2a0e05");
    g.fillStyle = wg; polyPath(g, fw); g.fill();
    [[-4, 1], [4, -1]].forEach(function (sd) {
      var sw = [PL(sd[0], RIM_H, -4), PL(sd[0], RIM_H, 4), PL(sd[0], 0, 4), PL(sd[0], 0, -4)];
      g.fillStyle = "#2a0e05"; polyPath(g, sw); g.fill();
    });
    /* the baize in the light of the gasolier */
    var cc = PL(0, 0, -0.5);
    g.globalCompositeOperation = "lighter";
    var pool = g.createRadialGradient(cc.x, cc.y, 0, cc.x, cc.y, cc.s * 6.5);
    pool.addColorStop(0, "rgba(255,214,140,0.14)"); pool.addColorStop(0.6, "rgba(255,200,120,0.05)"); pool.addColorStop(1, "rgba(255,200,120,0)");
    g.fillStyle = pool; g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = "source-over";
    var vin = g.createRadialGradient(cc.x, cc.y, cc.s * 2.5, cc.x, cc.y, cc.s * 6.5);
    vin.addColorStop(0, "rgba(0,0,0,0)"); vin.addColorStop(1, "rgba(0,8,2,0.32)");
    g.fillStyle = vin; g.fillRect(0, 0, W, H);
    /* the lines, pressed into the cloth: dark, with the felt catching light below */
    var s0 = PL(0, 0, 0).s, lw = Math.max(1, s0 * 0.022);
    for (var k = 0; k <= 8; k++) {
      var x = k - 4;
      var p1 = PL(x, 0, -4), p2 = PL(x, 0, 4), q1 = PL(-4, 0, x), q2 = PL(4, 0, x);
      g.strokeStyle = "rgba(150,210,160,0.08)"; g.lineWidth = lw;
      g.beginPath(); g.moveTo(p1.x + 1, p1.y); g.lineTo(p2.x + 1, p2.y); g.moveTo(q1.x, q1.y + 1); g.lineTo(q2.x, q2.y + 1); g.stroke();
      g.strokeStyle = "rgba(4,16,8,0.82)";
      g.beginPath(); g.moveTo(p1.x, p1.y); g.lineTo(p2.x, p2.y); g.moveTo(q1.x, q1.y); g.lineTo(q2.x, q2.y); g.stroke();
    }
    /* the four marks, little brass studs */
    [[-2, -2], [2, -2], [-2, 2], [2, 2]].forEach(function (q) {
      var p = PL(q[0], 0.01, q[1]), r = p.s * 0.06;
      var bg = g.createRadialGradient(p.x - r * 0.3, p.y - r * 0.4, 0, p.x, p.y, r);
      bg.addColorStop(0, "#fbe3a0"); bg.addColorStop(0.6, "#b88b3c"); bg.addColorStop(1, "#5a3c12");
      g.fillStyle = bg; g.beginPath(); g.ellipse(p.x, p.y, r, r * SIN, 0, 0, TAU); g.fill();
    });
    g.restore();
    /* the inlaid brass line around the recess */
    var inl = 0.12;
    g.strokeStyle = "rgba(214,170,80,0.7)"; g.lineWidth = Math.max(1, s0 * 0.014);
    polyPath(g, [PL(-4 - inl, RIM_H, -4 - inl), PL(4 + inl, RIM_H, -4 - inl), PL(4 + inl, RIM_H, 4 + inl), PL(-4 - inl, RIM_H, 4 + inl)]); g.stroke();
    g.strokeStyle = "rgba(0,0,0,0.5)"; g.lineWidth = 1; polyPath(g, inner); g.stroke();
    /* brass corners on the rails */
    var cl = Math.min(RS, RF) * 0.9 + 0.35;
    [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(function (q) {
      var x0 = q[0] * HX, z0 = q[1] < 0 ? ZF : ZN, ix = -q[0], iz = -q[1];
      var pts = [[x0, z0], [x0 + ix * cl, z0], [x0 + ix * cl, z0 + iz * 0.16], [x0 + ix * 0.16, z0 + iz * 0.16], [x0 + ix * 0.16, z0 + iz * cl], [x0, z0 + iz * cl]];
      var pp = pts.map(function (r) { return PL(r[0], RIM_H + 0.004, r[1]); });
      var cg = g.createLinearGradient(pp[0].x, pp[0].y, pp[1].x, pp[4].y);
      cg.addColorStop(0, "#f2cf7a"); cg.addColorStop(0.5, "#b4883a"); cg.addColorStop(1, "#7a5420");
      g.fillStyle = cg; polyPath(g, pp); g.fill();
      g.strokeStyle = "rgba(60,36,8,0.6)"; g.lineWidth = 1; g.stroke();
      var sc = PL(x0 + ix * 0.08, RIM_H, z0 + iz * 0.08);
      g.fillStyle = "#5a3c12"; g.beginPath(); g.arc(sc.x, sc.y, Math.max(1, sc.s * 0.025), 0, TAU); g.fill();
    });
    /* the score plaques, set into the near rail */
    PLAQUES.forEach(function (pq) { drawPlaqueBase(g, pq); });
    /* letters and numbers, tooled faintly in gold on the far and left rails */
    if (!portrait) {
      g.fillStyle = "rgba(214,170,80,0.5)";
      for (var n = 0; n < 8; n++) {
        tooled(g, "abcdefgh".charAt(n), n - 3.5, -4 - RF * 0.5, 0.26);
        tooled(g, String(n + 1), -4 - RS * 0.5, n - 3.5, 0.26);
      }
    }
  }
  function tooled(g, txt, x, z, size) {
    affine(g, x, RIM_H + 0.002, z, size / 40, 0, 0, 0, 0, size / 40);
    g.font = "600 40px 'Playfair Display', Georgia, serif"; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(txt, 0, 2);
    resetT(g);
  }
  function brassRect(g, x, y, w, h, r) {
    var bg = g.createLinearGradient(x, y, x + w, y + h);
    bg.addColorStop(0, "#f0cc78"); bg.addColorStop(0.45, "#b58a3c"); bg.addColorStop(1, "#6a4818");
    g.fillStyle = bg;
    if (r) { rrect(g, x, y, w, h, r); g.fill(); } else g.fillRect(x, y, w, h);
  }
  function baizeTexture() {
    var ppu = clamp(Math.floor(maxScale() * dpr * 1.05), 20, 220);
    var tw = ppu * 8, th = ppu * 8;
    var c = cvOf(tw, th), g = c.getContext("2d");
    var base = g.createLinearGradient(0, 0, tw, th);
    base.addColorStop(0, "#1d5534"); base.addColorStop(0.5, "#1a4e30"); base.addColorStop(1, "#15422a");
    g.fillStyle = base; g.fillRect(0, 0, tw, th);
    /* the nap of the felt: fine speckle, a little worn paler in the middle squares */
    var n = Math.min(26000, tw * th / 40);
    for (var i = 0; i < n; i++) {
      var x = srnd(i * 1.37) * tw, y = srnd(i * 2.71) * th;
      g.fillStyle = srnd(i * 3.3) > 0.5 ? "rgba(120,190,140,0.07)" : "rgba(0,20,8,0.1)";
      g.fillRect(x, y, Math.max(1, ppu * 0.012), Math.max(1, ppu * 0.012));
    }
    var wear = g.createRadialGradient(tw / 2, th / 2, 0, tw / 2, th / 2, tw * 0.45);
    wear.addColorStop(0, "rgba(120,170,120,0.08)"); wear.addColorStop(1, "rgba(120,170,120,0)");
    g.fillStyle = wear; g.fillRect(0, 0, tw, th);
    return c;
  }

  /* ---------- the plaques ---------- */
  var PLAQUES = [];
  function layoutPlaques() {
    var pw = portrait ? 3.5 : 3.1, pd = RN * 0.6, z = 4 + RN * 0.52;
    PLAQUES = [{ color: BLACK, x: -0.2 - pw / 2, z: z, w: pw, d: pd }, { color: WHITE, x: 0.2 + pw / 2, z: z, w: pw, d: pd }];
  }
  function plaqueFrame(g, pq) {
    /* local units: x in [-170, 170], y in [-30, 30] */
    affine(g, pq.x, RIM_H + 0.003, pq.z, pq.w / 340, 0, 0, 0, 0, pq.d / 60);
  }
  function drawPlaqueBase(g, pq) {
    plaqueFrame(g, pq);
    var bg = g.createLinearGradient(-170, -30, 170, 30);
    bg.addColorStop(0, "#f2d184"); bg.addColorStop(0.4, "#c79a46"); bg.addColorStop(0.75, "#a0742c"); bg.addColorStop(1, "#6e4c1a");
    rrect(g, -170, -30, 340, 60, 10); g.fillStyle = bg; g.fill();
    g.strokeStyle = "rgba(60,36,8,0.65)"; g.lineWidth = 2; g.stroke();
    rrect(g, -162, -23, 324, 46, 6); g.strokeStyle = "rgba(80,50,12,0.45)"; g.lineWidth = 1.5; g.stroke();
    /* the inlaid disc: ebony or ivory, set into the brass */
    var dg = g.createRadialGradient(-136, -6, 2, -132, 0, 19);
    if (pq.color === BLACK) { dg.addColorStop(0, "#3a2c24"); dg.addColorStop(1, "#0b0706"); }
    else { dg.addColorStop(0, "#fff8e8"); dg.addColorStop(1, "#cdb994"); }
    g.fillStyle = dg; g.beginPath(); g.arc(-132, 0, 18, 0, TAU); g.fill();
    g.strokeStyle = "rgba(60,36,8,0.8)"; g.lineWidth = 2; g.stroke();
    /* two screws */
    [-160, 160].forEach(function (sx) { g.fillStyle = "#6a4818"; g.beginPath(); g.arc(sx, 0, 3, 0, TAU); g.fill(); });
    resetT(g);
  }
  /* the numbers, engraved; drawn each frame (they change), with the side to move lit */
  function drawPlaqueText(pq, n, label, active, glow) {
    var g = ctx;
    plaqueFrame(g, pq);
    if (active || glow) {
      g.fillStyle = "rgba(255,236,170," + (glow ? 0.3 * glow : 0.16) + ")";
      rrect(g, -170, -30, 340, 60, 10); g.fill();
    }
    g.textBaseline = "middle";
    g.font = "800 44px 'Playfair Display', Georgia, serif"; g.textAlign = "left";
    g.fillStyle = "rgba(255,240,200,0.55)"; g.fillText(String(n), -100, 3.5);
    g.fillStyle = "#3a240a"; g.fillText(String(n), -100, 1.5);
    g.font = "800 21px Manrope, system-ui, sans-serif"; g.textAlign = "right";
    var lab = label.toUpperCase();
    g.fillStyle = "rgba(255,240,200,0.45)"; g.fillText(lab, 146, 3);
    g.fillStyle = "rgba(58,36,10,0.9)"; g.fillText(lab, 146, 1.5);
    resetT(g);
  }

  /* ================= the disc layer ================= */
  function hidden(s) { return anim[s] || (drop && drop.s === s) || flipsPrev.indexOf(s) >= 0; }
  function paintDiscs() {
    discDirty = false;
    var g = discCv.getContext("2d");
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, discCv.width, discCv.height);
    resetT(g);
    var list = [];
    for (var s = 0; s < 64; s++) if (disc[s] && !hidden(s)) list.push(s);
    list.forEach(function (s) { var q = disc[s]; drawShadow(g, cxOf(s) + q.jx, czOf(s) + q.jz, 0, 1); });
    list.forEach(function (s) {
      var q = disc[s];
      drawDisc(g, { x: cxOf(s) + q.jx, y: DT / 2, z: czOf(s) + q.jz, top: q.color, bot: 3 - q.color, v: q.v, rot: q.rot, pip: s === lastPlaced && phase !== "menu" });
    });
  }

  /* ================= per-frame drawing ================= */
  var lastT = 0, frameDt = 16;
  function draw(t) {
    resetT(ctx);
    if (backCv) ctx.drawImage(backCv, 0, 0, backCv.width, backCv.height, 0, 0, W, H);
    drawRoomLife(t);
    if (caseCv) blitRect(caseCv, RECT.board);
    drawDots(t);
    if (discDirty) paintDiscs();
    blitRect(discCv, RECT.top);
    drawMoving(t);
    drawPlaques(t);
    drawLight(t);
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
    [[-HX, ZF], [HX, ZF], [HX, ZN], [-HX, ZN]].forEach(function (c) { pts.push(project(c[0], RIM_H, c[1]), project(c[0], TABLE_Y, c[1])); });
    var top = rectOf([project(-4, 0.6, -4), project(4, 0.6, -4), project(4, 0, 4), project(-4, 0, 4), project(-4.3, 0, 4.3), project(4.3, 0, 4.3)], 6);
    RECT = { board: rectOf(pts, 30), top: top };
  }

  /* the room breathing: fog at the window, the fire, the gas jets, the clock */
  function drawRoomLife(t) {
    var still = reduced(), ts = still ? 4 : t * 0.001, R = ROOM;
    /* fog drifting past the glass, two layers at different speeds */
    var o = R.win;
    ctx.save(); ctx.beginPath(); ctx.rect(o.x, o.y, o.w, Math.min(o.h, SILL - o.y)); ctx.clip();
    var fw = Math.max(o.w * 2.2, 200), fh = o.h * 1.2;
    for (var L = 0; L < 2; L++) {
      var sp = L ? 9 : 5, off = ((ts * sp + L * 77) % fw + fw) % fw;
      ctx.globalAlpha = L ? 0.42 : 0.58;
      ctx.drawImage(TX.fog, o.x - off, o.y - o.h * 0.1 + L * o.h * 0.08, fw, fh);
      ctx.drawImage(TX.fog, o.x - off + fw, o.y - o.h * 0.1 + L * o.h * 0.08, fw, fh);
    }
    ctx.globalAlpha = 0.1 + 0.05 * Math.sin(ts * 0.21);
    ctx.fillStyle = "#8a9cac"; ctx.fillRect(o.x, o.y, o.w, o.h);
    ctx.globalAlpha = 1;
    ctx.restore();
    blitRect(winCv, R.winRect || (R.winRect = rectOf([{ x: o.x - o.w * 0.4, y: o.y - o.w * 0.2 }, { x: o.x + o.w * 1.4, y: SILL }], 4)));
    /* the fire */
    var b = R.box, flick = still ? 0.5 : 0.5 + 0.5 * wob(ts * 2.2, 1);
    ctx.save(); ctx.beginPath(); ctx.rect(b.x, b.y - b.w * 0.15, b.w, SILL - b.y + b.w * 0.15); ctx.clip();
    ctx.globalCompositeOperation = "lighter";
    var bed = b.y + b.h * 0.62;
    var cg = ctx.createRadialGradient(b.x + b.w / 2, bed, 0, b.x + b.w / 2, bed, b.w * 0.6);
    cg.addColorStop(0, "rgba(255,140,40," + (0.55 + flick * 0.2) + ")"); cg.addColorStop(1, "rgba(255,80,20,0)");
    ctx.fillStyle = cg; ctx.fillRect(b.x, b.y, b.w, b.h);
    for (var i = 0; i < 7; i++) {
      var fx = b.x + b.w * (0.18 + 0.64 * i / 6), k = i * 1.7;
      var hgt = b.h * (0.32 + 0.16 * (wob(ts * 2.8, k) + 1)) * (i % 3 === 1 ? 1.15 : 1);
      var wd = b.w * (0.07 + 0.02 * Math.sin(ts * 3 + k));
      var sway = b.w * 0.03 * wob(ts * 3.6, k + 4);
      var fg = ctx.createLinearGradient(0, bed, 0, bed - hgt);
      fg.addColorStop(0, "rgba(255,236,170,0.85)"); fg.addColorStop(0.35, "rgba(255,150,40,0.6)"); fg.addColorStop(1, "rgba(200,40,10,0)");
      ctx.fillStyle = fg;
      ctx.beginPath(); ctx.moveTo(fx - wd, bed);
      ctx.quadraticCurveTo(fx - wd * 0.9 + sway, bed - hgt * 0.55, fx + sway * 1.6, bed - hgt);
      ctx.quadraticCurveTo(fx + wd * 0.9 + sway, bed - hgt * 0.55, fx + wd, bed);
      ctx.closePath(); ctx.fill();
    }
    ctx.globalCompositeOperation = "source-over";
    /* the coals and the iron grate in front of them */
    ctx.fillStyle = "#140805";
    for (var c = 0; c < 9; c++) { var cxp = b.x + b.w * (0.12 + c * 0.095); ctx.beginPath(); ctx.ellipse(cxp, bed + b.h * 0.02, b.w * 0.06, b.h * 0.05, 0, 0, TAU); ctx.fill(); }
    ctx.globalCompositeOperation = "lighter";
    for (var e = 0; e < 9; e++) {
      var ex = b.x + b.w * (0.12 + e * 0.095), ea = 0.25 + 0.25 * (wob(ts * 1.3, e * 2.1) + 1) / 2;
      ctx.fillStyle = "rgba(255,90,20," + ea + ")"; ctx.beginPath(); ctx.ellipse(ex, bed + b.h * 0.035, b.w * 0.035, b.h * 0.022, 0, 0, TAU); ctx.fill();
    }
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = "#0a0a0a"; ctx.lineWidth = Math.max(1.5, b.w * 0.02);
    for (var gI = 0; gI < 7; gI++) { var gxp = b.x + b.w * (0.12 + gI * 0.127); ctx.beginPath(); ctx.moveTo(gxp, bed - b.h * 0.05); ctx.lineTo(gxp, bed + b.h * 0.12); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(b.x + b.w * 0.08, bed + b.h * 0.02); ctx.lineTo(b.x + b.w * 0.92, bed + b.h * 0.02); ctx.stroke();
    ctx.restore();
    /* the fire and the gas lamps light the room, breathing */
    ctx.globalCompositeOperation = "lighter";
    var fxc = b.x + b.w / 2, reach = SILL * 1.4;
    var gl = ctx.createRadialGradient(fxc, bed, 0, fxc, bed, reach);
    gl.addColorStop(0, "rgba(255,120,40," + (0.1 + flick * 0.06 + lampBoost * 0.08) + ")"); gl.addColorStop(1, "rgba(255,120,40,0)");
    ctx.fillStyle = gl; ctx.fillRect(Math.max(0, fxc - reach), 0, reach * 2, SILL);
    R.sconces.forEach(function (s, j) {
      var f = still ? 0 : wob(ts * 3.1, j * 5) * 0.5 + 0.5;
      var r = R.sr * (3.2 + lampBoost * 2);
      var sg = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, r);
      sg.addColorStop(0, "rgba(255,230,170," + (0.22 + f * 0.08 + lampBoost * 0.25) + ")"); sg.addColorStop(1, "rgba(255,200,120,0)");
      ctx.fillStyle = sg; ctx.fillRect(s.x - r, s.y - r, r * 2, r * 2);
    });
    ctx.globalCompositeOperation = "source-over";
    /* the clock keeps real time */
    var C = R.clock, d = new Date(), sec = d.getSeconds() + (still ? 0 : (d.getMilliseconds() > 900 ? 0 : 0)), mn = d.getMinutes() + sec / 60, hr = (d.getHours() % 12) + mn / 60;
    ctx.strokeStyle = "#1e140a"; ctx.lineCap = "round";
    hand(C, hr / 12, 0.5, Math.max(1.2, C.r * 0.14));
    hand(C, mn / 60, 0.78, Math.max(1, C.r * 0.1));
    ctx.strokeStyle = "#8a1e14"; hand(C, sec / 60, 0.82, Math.max(0.6, C.r * 0.05));
    ctx.lineCap = "butt";
    /* smoke off the cigar */
    if (R.cigar && !still) {
      var cz = R.cigar;
      ctx.strokeStyle = "rgba(200,205,210,0.09)"; ctx.lineWidth = Math.max(2, cz.s * 0.06);
      for (var w = 0; w < 3; w++) {
        ctx.beginPath(); ctx.moveTo(cz.x, cz.y);
        for (var st = 1; st <= 10; st++) {
          var yy = cz.y - st * cz.s * 0.16, xx = cz.x + Math.sin(ts * 0.9 + st * 0.6 + w * 2) * cz.s * 0.06 * st * 0.4;
          ctx.lineTo(xx, yy);
        }
        ctx.stroke();
      }
      var em = 0.5 + 0.5 * wob(ts * 0.8, 3);
      var eg = ctx.createRadialGradient(cz.x, cz.y, 0, cz.x, cz.y, cz.s * 0.1);
      eg.addColorStop(0, "rgba(255,120,40," + (0.6 + em * 0.3) + ")"); eg.addColorStop(1, "rgba(255,80,20,0)");
      ctx.fillStyle = eg; ctx.fillRect(cz.x - cz.s * 0.1, cz.y - cz.s * 0.1, cz.s * 0.2, cz.s * 0.2);
    }
  }
  function hand(C, f, len, w) {
    var a = f * TAU - Math.PI / 2;
    ctx.lineWidth = w;
    ctx.beginPath(); ctx.moveTo(C.x, C.y); ctx.lineTo(C.x + Math.cos(a) * C.r * len, C.y + Math.sin(a) * C.r * len); ctx.stroke();
  }

  /* the legal-move dots: a cream spot with a dark rim, loud enough to read on baize */
  var legalNow = [];
  function drawDots(t) {
    if (!dotsOn || !myTurn()) return;
    var pulse = reduced() ? 0 : 0.5 + 0.5 * Math.sin(t * 0.003);
    for (var i = 0; i < legalNow.length; i++) {
      var s = legalNow[i];
      if (s === aim) continue;
      var p = project(cxOf(s), 0.004, czOf(s)), r = p.s * 0.1;
      ctx.fillStyle = "rgba(8,24,14,0.55)"; ctx.beginPath(); ctx.ellipse(p.x, p.y + 0.5, r * 1.35, r * 1.35 * SIN, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = "rgba(246,232,196," + (0.72 + pulse * 0.12) + ")"; ctx.beginPath(); ctx.ellipse(p.x, p.y, r, r * SIN, 0, 0, TAU); ctx.fill();
    }
  }

  function drawMoving(t) {
    var list = [];
    /* discs a move here would turn: lifted a little, leaning, and lit gold */
    var pulse = reduced() ? 0.6 : 0.5 + 0.5 * Math.sin(t * 0.006);
    if (flipsPrev.length && aim >= 0) {
      for (var i = 0; i < flipsPrev.length; i++) {
        var f = flipsPrev[i], q = disc[f];
        if (!q) continue;
        var dx = K.sx(f) - K.sx(aim), dz = K.sy(f) - K.sy(aim), L = Math.sqrt(dx * dx + dz * dz) || 1;
        var lean = reduced() ? 0.12 : 0.1 + 0.08 * pulse;
        list.push({ x: cxOf(f) + q.jx, y: DT / 2 + 0.05 + pulse * 0.02, z: czOf(f) + q.jz, th: lean, ax: dz / L, az: -dx / L,
          top: q.color, bot: 3 - q.color, v: q.v, rot: q.rot, glow: pulse, lift: 0.06, under: true, pip: f === lastPlaced });
      }
    }
    /* the disc being set down */
    if (drop) {
      var dt = clamp((t - drop.t0) / drop.dur, 0, 1), qd = disc[drop.s];
      if (qd) list.push({ x: cxOf(drop.s) + qd.jx, y: DT / 2 + drop.h * (1 - dt * dt), z: czOf(drop.s) + qd.jz, top: qd.color, bot: 3 - qd.color, v: qd.v, rot: qd.rot, lift: drop.h * (1 - dt * dt) });
    }
    /* discs turning over */
    for (var k in anim) {
      var a = anim[k], s = +k, qa = disc[s];
      if (!qa) continue;
      var p = clamp((t - a.t0) / a.dur, 0, 1), e = ease(p);
      var th = Math.PI * e, y = DT / 2 + DR * Math.sin(th) * 1.04 + 0.1 * Math.sin(Math.PI * p);
      list.push({ x: cxOf(s) + qa.jx, y: y, z: czOf(s) + qa.jz, th: p > 0 ? th : 0, ax: a.ax, az: a.az, top: a.from, bot: a.to, v: qa.v, rot: qa.rot, lift: y - DT / 2 });
    }
    if (!list.length && aim < 0 && !cpuAim && cursor < 0) return;
    list.sort(function (m, n) { return m.z - n.z || m.y - n.y; });
    /* shadows first */
    for (var j = 0; j < list.length; j++) drawShadow(ctx, list[j].x, list[j].z, list[j].lift || 0, 1);
    for (var u = 0; u < list.length; u++) {
      var d = list[u];
      if (d.under) {
        var gp = project(d.x, 0.003, d.z), gr = gp.s * DR * 1.7;
        ctx.globalCompositeOperation = "lighter";
        var gg = ctx.createRadialGradient(gp.x, gp.y, gr * 0.3, gp.x, gp.y, gr);
        gg.addColorStop(0, "rgba(255,200,90," + (0.3 + d.glow * 0.22) + ")"); gg.addColorStop(1, "rgba(255,200,90,0)");
        ctx.fillStyle = gg;
        ctx.save(); ctx.translate(gp.x, gp.y); ctx.scale(1, SIN); ctx.beginPath(); ctx.arc(0, 0, gr, 0, TAU); ctx.restore(); ctx.fill();
        ctx.globalCompositeOperation = "source-over";
      }
      drawDisc(ctx, d);
    }
    drawAim(t);
  }

  /* where a tap or the cursor is: a ghost of your disc, or a cross if nothing flips */
  function drawAim(t) {
    if (cpuAim) {
      var pc = project(cxOf(cpuAim.s), 0.004, czOf(cpuAim.s)), k = clamp((t - cpuAim.t0) / 300, 0, 1);
      ctx.strokeStyle = "rgba(255,220,150," + (0.7 * (1 - k * 0.4)) + ")"; ctx.lineWidth = 2;
      var rr = pc.s * (0.62 - 0.18 * k);
      ctx.beginPath(); ctx.ellipse(pc.x, pc.y, rr, rr * SIN, 0, 0, TAU); ctx.stroke();
    }
    if (phase !== "play") return;
    var s = aim >= 0 ? aim : cursor;
    if (s < 0 || pos.turn !== human || busy()) return;
    var x = cxOf(s), z = cxOf(0) * 0 + czOf(s);
    if (aimKind === "key" || cursor >= 0) {
      var c = [project(x - 0.48, 0.004, z - 0.48), project(x + 0.48, 0.004, z - 0.48), project(x + 0.48, 0.004, z + 0.48), project(x - 0.48, 0.004, z + 0.48)];
      ctx.strokeStyle = "rgba(246,214,130,0.9)"; ctx.lineWidth = 2; polyPath(ctx, c); ctx.stroke();
    }
    if (disc[s]) return;
    if (aimBad) {
      var p = project(x, 0.004, z), rx = p.s * 0.18;
      ctx.strokeStyle = "rgba(214,80,64,0.95)"; ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.moveTo(p.x - rx, p.y - rx * SIN); ctx.lineTo(p.x + rx, p.y + rx * SIN); ctx.moveTo(p.x + rx, p.y - rx * SIN); ctx.lineTo(p.x - rx, p.y + rx * SIN); ctx.stroke();
      return;
    }
    if (aim < 0) return;
    /* a translucent face hovering where the disc would land */
    var tex = human === BLACK ? TX.ebony[1] : TX.ivory[1];
    affine(ctx, x, DT + 0.05, z, DR, 0, 0, 0, 0, DR);
    ctx.globalAlpha = aimKind === "touch" ? 0.72 : 0.58;
    ctx.drawImage(tex, -1, -1, 2, 2);
    ctx.drawImage(TX.light[human], -1, -1, 2, 2);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "rgba(255,220,150,0.8)"; ctx.lineWidth = 0.05;
    ctx.beginPath(); ctx.arc(0, 0, 1.02, 0, TAU); ctx.stroke();
    resetT(ctx);
  }

  function drawPlaques(t) {
    var c = K.count(pos.b), names = {};
    names[human] = "You"; names[cpu] = foe.short;
    var mv = phase === "play" ? pos.turn : 0;
    PLAQUES.forEach(function (pq) {
      var n = pq.color === BLACK ? shownCount[0] : shownCount[1];
      var g2 = glint && glint.color === pq.color ? clamp(1 - Math.abs((t - glint.t0) / 900 - 0.5) * 2, 0, 1) : 0;
      drawPlaqueText(pq, n, phase === "menu" ? (pq.color === BLACK ? "Black" : "White") : names[pq.color], mv === pq.color, g2);
    });
    void c;
  }
  var shownCount = [2, 2];
  function syncCount() {
    var c = K.count(pos.b);
    shownCount = [c.black, c.white];
    var b = human === BLACK ? "You " + c.black + ", " + foe.short + " " + c.white : foe.short + " " + c.black + ", you " + c.white;
    $("countLive").textContent = phase === "play" ? b : "";
  }

  /* the gaslight swell for a win; otherwise a faint warm breathing over the board */
  function drawLight(t) {
    if (lampBoost <= 0.001) return;
    ctx.globalCompositeOperation = "lighter";
    var c = project(0, 0, -1), r = Math.max(W, H) * 0.8;
    var gr = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, r);
    gr.addColorStop(0, "rgba(255,200,120," + (lampBoost * 0.16) + ")"); gr.addColorStop(1, "rgba(255,170,90,0)");
    ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = "source-over";
    void t;
  }

  function tick(t) {
    var dt = Math.min(48, t - lastT); lastT = t; frameDt = dt;
    stepAnim(t);
    var t0 = performance.now();
    draw(t);
    var ft = performance.now() - t0;
    perf.n++; perf.sum += ft; if (ft > perf.max) perf.max = ft;
    requestAnimationFrame(tick);
  }

  /* ================= moves on the board ================= */
  var STAG = 85, FLIP_MS = 340;
  function newDisc(color) { return { color: color, rot: Math.random() * TAU, v: (Math.random() * 6) | 0, jx: (Math.random() - 0.5) * 0.06, jz: (Math.random() - 0.5) * 0.06 }; }
  function placeAll() {
    disc = new Array(64);
    for (var s = 0; s < 64; s++) if (pos.b[s]) disc[s] = newDisc(pos.b[s]);
    discDirty = true;
  }
  var waveDone = null;
  function stepAnim(t) {
    if (drop && t - drop.t0 >= drop.dur) {
      var dd = drop; drop = null; discDirty = true;
      if (dd.done) dd.done(t);
    }
    var any = false, left = 0;
    for (var k in anim) {
      var a = anim[k], p = (t - a.t0) / a.dur;
      if (p >= 0 && !a.lifted) { a.lifted = true; A.tick && a.n > 0 && Math.random() < 0.5 && false; }
      if (p >= 0.86 && !a.landed) { a.landed = true; A.flip(a.to, panOf(+k), a.k, a.n); shownCount[a.to - 1]++; shownCount[a.from - 1]--; }
      if (p >= 1) { delete anim[k]; any = true; } else left++;
    }
    if (any) discDirty = true;
    if (!left && waveDone && !drop) { var f = waveDone; waveDone = null; f(); }
  }
  /* set the disc down, then turn the captured ones over in a ripple outward from it */
  function animateMove(rec, done) {
    var s = rec.s, color = rec.color, fast = reduced();
    disc[s] = newDisc(color);
    var t0 = now();
    var ripple = function (tLand) {
      A.place(color, 0.78 + Math.random() * 0.22, panOf(s));
      shownCount[color - 1]++;
      var n = rec.flips.length;
      rec.flips.forEach(function (f) {
        var dx = K.sx(f) - K.sx(s), dz = K.sy(f) - K.sy(s), L = Math.sqrt(dx * dx + dz * dz) || 1;
        var ring = Math.max(Math.abs(dx), Math.abs(dz));
        disc[f].color = color;
        if (fast) return;
        anim[f] = { t0: tLand + 70 + (ring - 1) * STAG + Math.random() * 22, dur: FLIP_MS, from: 3 - color, to: color,
          ax: dz / L, az: -dx / L, k: (ring - 1) / 6, n: n, lifted: false, landed: false };
      });
      discDirty = true;
      if (fast) {
        /* no ripple to watch, but the clicks still say how many turned */
        syncCount();
        rec.flips.slice(0, 6).forEach(function (f, i) { later(60 + i * 45, function () { A.flip(color, panOf(f), i / 6, n); }); });
        later(120, done);
        return;
      }
      waveDone = done;
    };
    if (fast) { discDirty = true; ripple(t0); return; }
    drop = { s: s, t0: t0, dur: 210, h: 0.6, done: ripple };
    discDirty = true;
  }

  /* ================= input ================= */
  function local(ev) { var r = canvas.getBoundingClientRect(); return { x: ev.clientX - r.left, y: ev.clientY - r.top }; }
  function cellAt(px, py, loose) {
    var w = unproject(px, py, 0);
    var fx = w.x + 4, fz = w.z + 4, lim = loose ? 0.3 : 0;
    if (fx < -lim || fx >= 8 + lim || fz < -lim || fz >= 8 + lim) return -1;
    return K.sq(clamp(Math.floor(fx), 0, 7), clamp(Math.floor(fz), 0, 7));
  }
  function setAim(s, kind) {
    var prev = aim, prevFlips = flipsPrev.length;
    aim = s; aimKind = kind;
    if (s >= 0 && myTurn() && !disc[s]) {
      flipsPrev = K.flipsFor(pos.b, s, human);
      aimBad = flipsPrev.length === 0;
    } else { flipsPrev = []; aimBad = s >= 0 && myTurn() && !disc[s] ? true : false; }
    if (s >= 0 && disc[s]) aimBad = false;
    if (prev !== s || prevFlips !== flipsPrev.length) discDirty = true;
  }
  function clearAim() { if (aim >= 0 || flipsPrev.length) discDirty = true; aim = -1; flipsPrev = []; aimBad = false; }
  function deny(s) {
    A.deny();
    note(disc[s] ? "That square is taken" : "Nothing flips there. A move has to trap a line.", 1900);
  }
  function tryPlay(s) {
    if (!myTurn()) return false;
    if (disc[s] || !K.isLegal(pos.b, s, human)) { deny(s); return false; }
    clearAim(); cursor = -1; touchArm = -1;
    commit(s);
    return true;
  }

  canvas.addEventListener("pointerdown", function (ev) {
    A.init();
    if (phase !== "play") return;
    var q = local(ev), s = cellAt(q.x, q.y, ev.pointerType !== "mouse");
    if (ev.pointerType === "mouse") {
      if (s >= 0 && myTurn()) press = { s: s, id: ev.pointerId, mouse: true };
      return;
    }
    /* touch: the first tap aims and shows what would flip; a second tap on the same square plays */
    if (s < 0) { clearAim(); return; }
    press = { s: s, id: ev.pointerId, mouse: false, armed: aim === s && touchArm === s, moved: false };
    if (!press.armed) { setAim(s, "touch"); if (myTurn()) A.tick(panOf(s)); }
    try { canvas.setPointerCapture(ev.pointerId); } catch (e) {}
  });
  canvas.addEventListener("pointermove", function (ev) {
    if (phase !== "play") return;
    var q = local(ev);
    if (press && ev.pointerId === press.id && !press.mouse) {
      /* sliding a finger walks the aim around, without playing */
      var s = cellAt(q.x, q.y, true);
      if (s >= 0 && s !== aim) { setAim(s, "touch"); press.moved = true; press.armed = false; if (myTurn()) A.tick(panOf(s)); }
      return;
    }
    if (ev.pointerType === "mouse") {
      var m = cellAt(q.x, q.y, false);
      cursor = -1;
      if (m >= 0 && myTurn() && !disc[m]) { if (m !== aim) setAim(m, "mouse"); }
      else if (aim >= 0) clearAim();
      canvas.style.cursor = aim >= 0 && !aimBad ? "pointer" : "default";
    }
  });
  function endPress(ev) {
    if (!press || ev.pointerId !== press.id) return;
    var pr = press; press = null;
    if (ev.type === "pointercancel") return;
    var q = local(ev);
    if (pr.mouse) {
      var s = cellAt(q.x, q.y, false);
      if (s === pr.s) tryPlay(s);
      return;
    }
    if (pr.armed && !pr.moved) {
      if (cellAt(q.x, q.y, true) === pr.s) tryPlay(pr.s);
      return;
    }
    touchArm = aim;
    if (!myTurn() || aim < 0) return;
    if (disc[aim]) return;
    if (aimBad) note("Nothing flips there. A move has to trap a line.", 1800);
    else if (aimTold < 3) { aimTold++; note(flipsPrev.length + (flipsPrev.length === 1 ? " disc would flip. Tap again to play." : " discs would flip. Tap again to play."), 2100); }
  }
  canvas.addEventListener("pointerup", endPress);
  canvas.addEventListener("pointercancel", endPress);
  canvas.addEventListener("pointerleave", function (ev) { if (ev.pointerType === "mouse" && aimKind === "mouse") clearAim(); });

  /* ================= game flow ================= */
  function commit(s) {
    var rec;
    try { rec = K.play(pos, s); } catch (e) { console.error("reversi: refused", e); return; }
    lock++;
    lastPlaced = s;
    elHint.classList.add("is-gone");
    legalNow = [];
    updateBar();
    var tok = gameToken;
    if (rec.color === cpu && rec.flips.length >= 6) say(foe.quips.big);
    animateMove(rec, function () {
      if (tok !== gameToken) return;
      lock--;
      syncCount();
      afterMove();
    });
  }

  function afterMove() {
    discDirty = true;
    syncCount();
    if (pos.ended) { updateBar(); finish("count"); return; }
    if (K.mustPass(pos)) {
      var who = pos.turn;
      lock++;
      updateBar();
      if (who === human) {
        flash("You pass", "cool", 1600);
        note("No move for you, so you pass", 2400);
        say(foe.quips.youPass);
      } else {
        flash(foe.short + " passes", "", 1500);
        note(foe.name + " has no move and passes", 2400);
        say(foe.quips.pass);
      }
      later(who === human ? 1600 : 1300, function () {
        A.pass(who === human ? 0.1 : -0.1);
        K.play(pos, PASS);
        lock--;
        afterMove();
      });
      return;
    }
    legalNow = pos.turn === human ? K.legal(pos) : [];
    updateBar();
    if (pos.turn === cpu) later(90, cpuTurn);
    else if (aim >= 0) setAim(aim, aimKind);
  }

  function cpuTurn() {
    if (phase !== "play" || pos.turn !== cpu) return;
    thinking = true; updateBar();
    elSay.classList.add("is-think"); elSay.textContent = "thinking";
    var t0 = now();
    ask({ type: "think", b: Array.from(pos.b), turn: pos.turn, who: foe.id, moveNum: pos.moves }, function (d) {
      var res = d.res, m = res ? res.move : -1;
      lastThink = res ? { ms: res.ms, depth: res.depth, nodes: res.nodes, solved: res.solved } : null;
      if (!res) console.error("reversi: the engine failed", d.error);
      if (m < 0 || !K.isLegal(pos.b, m, cpu)) { if (res) console.error("reversi: the engine sent an illegal move", m); m = K.legal(pos)[0]; }
      var wait = Math.max(0, foe.pause - (now() - t0));
      if (reduced()) wait = Math.min(wait, 150);
      later(wait, function () {
        thinking = false;
        elSay.classList.remove("is-think"); elSay.textContent = said;
        cpuAim = { s: m, t0: now() };
        updateBar();
        later(reduced() ? 40 : 300, function () { cpuAim = null; commit(m); });
      });
    });
  }

  function humanResign() {
    if (phase !== "play") return;
    finish("resign");
  }

  /* ---------- the end ---------- */
  function finish(how) {
    phase = "over"; thinking = false; clearAim(); cursor = -1; legalNow = [];
    elBar.hidden = true;
    var c = K.count(pos.b), mine = human === BLACK ? c.black : c.white, theirs = human === BLACK ? c.white : c.black;
    var result = how === "resign" ? "loss" : mine > theirs ? "win" : mine < theirs ? "loss" : "draw";
    var title = result === "win" ? "You win" : result === "loss" ? foe.name + " wins" : "A draw";
    var scoreLine = how === "resign" ? "You resigned" : "You " + mine + " · " + foe.short + " " + theirs;
    if (result === "win") {
      bump(LS.w); recordWin(foe.id); setupShare(mine, theirs);
      say(foe.quips.lose); winMoment();
    } else if (result === "loss") {
      bump(LS.l); clearShare(); say(foe.quips.win); later(500, function () { A.lose(); });
    } else {
      bump(LS.d); clearShare(); say(foe.quips.draw); later(500, function () { A.draw(); });
    }
    elResLine.textContent = (human === BLACK ? "Black" : "White") + " · against " + foe.name;
    elResTitle.textContent = title;
    elResScore.textContent = scoreLine;
    elResText.innerHTML = '<span class="result__quote">“' + (result === "win" ? foe.quips.lose : result === "loss" ? foe.quips.win : foe.quips.draw) + '”</span>';
    elResSeal.innerHTML = sealSvg(foe, 56);
    elResRecord.textContent = record();
    track("reversi_game_end", { opponent: foe.id, color: human === BLACK ? "black" : "white", result: result,
      black: c.black, white: c.white, moves: pos.moves });
    updateBar();
    syncCount();
    later(reduced() ? 400 : result === "win" ? 2600 : 1500, function () { elResult.hidden = false; });
  }
  function winMoment() {
    glint = { color: human, t0: now() + 300 };
    if (reduced()) { lampBoost = 0.8; setTimeout(function () { lampBoost = 0; }, 2600); A.win(); return; }
    /* the gas comes up, the fire with it, and the clock chimes */
    var t0 = now();
    (function swell() {
      var t = (now() - t0) / 4200;
      lampBoost = t < 0.25 ? t / 0.25 : Math.max(0, 1 - (t - 0.25) / 0.75);
      if (t < 1) requestAnimationFrame(swell); else lampBoost = 0;
    })();
    later(400, function () { A.win(); });
  }
  function bump(k) { lsSet(k, String((parseInt(lsGet(k, "0"), 10) || 0) + 1)); }
  function getDefeated() { try { var r = JSON.parse(lsGet(LS.defeated, "[]")); return Array.isArray(r) ? r : []; } catch (e) { return []; } }
  function recordWin(id) {
    var r = getDefeated();
    if (r.indexOf(id) < 0) r.push(id);
    lsSet(LS.defeated, JSON.stringify(r));
    /* the ticket rule reads this; it only ever goes up, and nothing awards directly */
    var prev = parseInt(lsGet(LS.beaten, "0"), 10) || 0;
    lsSet(LS.beaten, String(Math.max(prev, r.length)));
  }
  function record() {
    return "Record  " + lsGet(LS.w, "0") + "W · " + lsGet(LS.l, "0") + "L · " + lsGet(LS.d, "0") + "D   ·   regulars beaten " + getDefeated().length + "/6";
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
      var res = null, err = null, E = window.ReversiEngine;
      try { res = E.think(msg); } catch (e) { err = String(e); console.error(e); }
      cb({ type: msg.type, id: msg.id, res: res, error: err });
    }
    if (window.ReversiEngine) { setTimeout(go, 20); return; }
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

  /* ================= the page ================= */
  var elOverlay = $("overlay"), elResult = $("result"), elBar = $("bar"), elOpp = $("opp"), elSay = $("oppSay");
  var elTurn = $("turn"), elTurnText = $("turnText"), elTurnSub = $("turnSub"), elTurnDisc = $("turnDisc");
  var elCast = $("cast"), elSound = $("soundBtn"), elDots = $("btnDots"), elHint = $("hintLine"), elNote = $("note");
  var elCallout = $("callout");
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
    if (phase === "over") txt = "Game over";
    else if (K.mustPass(pos)) txt = pos.turn === human ? "You pass" : foe.short + " passes";
    else if (pos.turn === human) txt = busy() ? "…" : "Your turn";
    else { txt = foe.short + (thinking ? " is thinking" : "'s turn"); wait = true; }
    elTurnText.textContent = txt;
    elTurnSub.textContent = "Move " + (pos.moves + 1);
    elTurn.className = "turn" + (wait ? " is-wait" : "");
    elTurnDisc.className = "turn__disc" + (pos.turn === WHITE ? " is-white" : "");
    elOpp.classList.toggle("is-turn", phase === "play" && pos.turn === cpu);
    $("btnResign").disabled = phase !== "play";
  }

  /* Each regular gets a small brass medallion with a mark of their life. */
  function sealSvg(f, size) {
    var g = {
      bell: '<path d="M-7 4h14M-6 4c0-5 2.5-8 6-8s6 3 6 8"/><path d="M0-4v-2.4M-2-6.6h4"/><path d="M-8.5 6.5h17"/>',
      key: '<circle cx="-4.2" cy="0" r="3.4"/><path d="M-0.8 0H8.2M5.2 0v3M7.6 0v2.4"/>',
      quill: '<path d="M7.5-7.5C1-5.5-3.2 0-5.5 6.5"/><path d="M7.5-7.5C6.6-1.2 2.4 2.2-2.8 3.4"/><path d="M-5.5 6.5l-1.6 1.6"/>',
      anchor: '<circle cx="0" cy="-6" r="1.8"/><path d="M0-4.2V7M-4-2.4h8"/><path d="M-7 2.5c0 3 3.5 4.5 7 4.5s7-1.5 7-4.5"/><path d="M-7 2.5l-1.3 1.7M7 2.5l1.3 1.7"/>',
      dividers: '<circle cx="0" cy="-6.4" r="1.5"/><path d="M-0.7-5.1L-5 7.4M0.7-5.1L5 7.4M-3.3 2.2h6.6"/>',
      scales: '<path d="M0-7.4V7M-4 7h8M-7-4.4h14"/><path d="M-7-4.4l-2.6 5.4h5.2zM7-4.4l-2.6 5.4h5.2z"/>'
    }[f.glyph];
    return '<svg viewBox="-14 -14 28 28" width="' + size + '" height="' + size + '" aria-hidden="true">' +
      '<defs><radialGradient id="sg' + f.id + size + '" cx="35%" cy="30%" r="80%"><stop offset="0" stop-color="#1f3a2a"/><stop offset="1" stop-color="#08130d"/></radialGradient>' +
      '<linearGradient id="sb' + f.id + size + '" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f2d184"/><stop offset="0.5" stop-color="#b58a3c"/><stop offset="1" stop-color="#6a4818"/></linearGradient></defs>' +
      '<circle cx="0" cy="0" r="13" fill="url(#sg' + f.id + size + ')" stroke="url(#sb' + f.id + size + ')" stroke-width="1.6"/>' +
      '<circle cx="0" cy="0" r="10.6" fill="none" stroke="' + f.accent + '" stroke-opacity="0.3" stroke-width="0.7" stroke-dasharray="1.4 1.4"/>' +
      '<g fill="none" stroke="' + f.accent + '" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round">' + g + "</g></svg>";
  }
  function renderOpp() {
    $("oppSeal").innerHTML = sealSvg(foe, 40); $("oppName").textContent = foe.name; $("oppRole").textContent = foe.role;
  }

  /* the first regular not yet beaten; after that, whoever you played last */
  function defaultFoe() {
    var r = getDefeated();
    for (var i = 0; i < FOES.length; i++) if (r.indexOf(FOES[i].id) < 0) return FOES[i];
    return foeById(lsGet(LS.foe, "desai"));
  }
  function buildCast() {
    if (!picked) picked = defaultFoe();
    elCast.innerHTML = "";
    var won = getDefeated();
    FOES.forEach(function (f) {
      var b = document.createElement("button");
      b.type = "button"; b.className = "foe" + (f === picked ? " is-pick" : "");
      b.innerHTML = '<span class="foe__seal">' + sealSvg(f, 38) + "</span>" +
        '<span class="foe__name">' + f.name + "</span>" +
        '<span class="foe__role">' + f.role + "</span>" +
        '<span class="foe__rank">' + f.level + "</span>" +
        '<span class="foe__trait">' + f.trait + "</span>" +
        (won.indexOf(f.id) >= 0 ? '<i class="foe__won">Beaten</i>' : "");
      b.setAttribute("data-opt-start", "");
      b.addEventListener("click", function () { picked = f; start(); });
      elCast.appendChild(b);
    });
    $("ovBtn").textContent = "Sit down with " + picked.name;
  }
  function wireOptions() {
    function paint() {
      Array.prototype.forEach.call(document.querySelectorAll("[data-first]"), function (b) { b.setAttribute("aria-checked", b.getAttribute("data-first") === firstPref ? "true" : "false"); });
      $("colorNote").textContent = firstPref === "white" ? "You take the ivory side. Black moves first, so your opponent opens."
        : firstPref === "alt" ? "You switch colors every game. Black always moves first."
        : "You take the ebony side and move first.";
    }
    Array.prototype.forEach.call(document.querySelectorAll("[data-first]"), function (b) {
      b.addEventListener("click", function () { firstPref = b.getAttribute("data-first"); lsSet(LS.first, firstPref); paint(); A.init(); A.tick(0); });
    });
    $("ovBtn").addEventListener("click", start);
    $("howBtn").addEventListener("click", function () { openLesson(); });
    paint();
  }

  function start() {
    A.init();
    /* the cast button keeps focus once the panel hides; Enter would start a new game */
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    elOverlay.classList.add("is-out");
    setTimeout(function () { elOverlay.hidden = true; elOverlay.classList.remove("is-out"); }, 240);
    newGame(picked.id);
  }
  function chooseColor() {
    if (firstPref === "white") return WHITE;
    if (firstPref === "alt") {
      var n = (parseInt(lsGet(LS.w, "0"), 10) || 0) + (parseInt(lsGet(LS.l, "0"), 10) || 0) + (parseInt(lsGet(LS.d, "0"), 10) || 0);
      return n % 2 === 0 ? BLACK : WHITE;
    }
    return BLACK;
  }
  function newGame(foeId) {
    gameToken++; lock = 0; thinking = false; anim = {}; drop = null; cpuAim = null; waveDone = null; lampBoost = 0; glint = null;
    foe = foeById(foeId); lsSet(LS.foe, foe.id);
    human = chooseColor(); cpu = 3 - human;
    pos = K.start();
    phase = "play"; lastPlaced = -1;
    clearAim(); cursor = -1; touchArm = -1; press = null;
    clearShare();
    placeAll();
    renderOpp();
    say(foe.quips.start);
    elOpp.hidden = false; elBar.hidden = false; elResult.hidden = true;
    document.body.classList.add("is-playing");
    A.startBed();
    track("reversi_game_start", { opponent: foe.id, color: human === BLACK ? "black" : "white" });
    syncCount();
    legalNow = pos.turn === human ? K.legal(pos) : [];
    updateBar();
    if (pos.turn === cpu) later(900, cpuTurn);
    else flash("Your move", "", 1100);
  }

  function showCast() {
    gameToken++; lock = 0; thinking = false; anim = {}; drop = null; cpuAim = null; waveDone = null; phase = "menu";
    elResult.hidden = true; elBar.hidden = true; elOpp.hidden = true;
    pos = K.start(); placeAll(); lastPlaced = -1; syncCount();
    picked = null; buildCast(); elOverlay.hidden = false;
    document.body.classList.remove("is-playing");
  }

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
  function setDots(v) {
    dotsOn = !!v; lsSet(LS.dots, dotsOn ? "1" : "0");
    elDots.setAttribute("aria-pressed", dotsOn ? "true" : "false");
  }
  elDots.addEventListener("click", function () { A.init(); setDots(!dotsOn); A.tick(0); });
  $("btnAgain").addEventListener("click", function () {
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    elResult.hidden = true; newGame(foe.id);
  });
  $("btnCast").addEventListener("click", showCast);
  $("helpBtn").addEventListener("click", function () { openLesson(); });
  elSound.addEventListener("click", function () {
    soundOn = !soundOn; lsSet(LS.sound, soundOn ? "1" : "0");
    elSound.setAttribute("aria-pressed", soundOn ? "true" : "false");
    A.init(); A.setOn(soundOn); if (soundOn) A.tick(0);
  });
  elSound.setAttribute("aria-pressed", soundOn ? "true" : "false");
  elDots.setAttribute("aria-pressed", dotsOn ? "true" : "false");
  A.setOn(soundOn);

  /* ---------- keyboard ----------
     Arrows walk a cursor over the squares (with the flip preview), Enter or Space
     plays it, D shows the legal-move dots, M mutes. */
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
    if (k === "d" || k === "D") { setDots(!dotsOn); return; }
    if (k === "ArrowLeft" || k === "ArrowRight" || k === "ArrowUp" || k === "ArrowDown") {
      e.preventDefault();
      if (cursor < 0) cursor = aim >= 0 ? aim : (legalNow[0] != null ? legalNow[0] : K.sq(3, 2));
      else {
        var x = K.sx(cursor), y = K.sy(cursor);
        if (k === "ArrowLeft") x--; else if (k === "ArrowRight") x++; else if (k === "ArrowUp") y--; else y++;
        cursor = K.sq(clamp(x, 0, 7), clamp(y, 0, 7));
      }
      setAim(cursor, "key");
      A.init(); A.tick(panOf(cursor));
      return;
    }
    if (k === "Enter" || k === " ") {
      var ae = document.activeElement;
      if (ae && ae.tagName === "BUTTON" && ae.offsetParent !== null) return;
      e.preventDefault(); A.init();
      if (cursor < 0) { cursor = legalNow[0] != null ? legalNow[0] : K.sq(3, 2); setAim(cursor, "key"); return; }
      tryPlay(cursor);
      return;
    }
    if (k === "Escape") { cursor = -1; clearAim(); }
  });

  /* ================= the lesson =================
     Three short cards with a small board that plays itself. */
  var elLesson = $("lesson"), lessonCv = $("lessonCv"), lessonG = lessonCv.getContext("2d");
  var lessonAt = 0, lessonT0 = 0, lessonRaf = 0;
  var LESSON = [
    { title: "Trap a line", text: "Put your disc down so a line of the other color sits between it and one of yours. That whole line turns over to your color.",
      aside: "Hover over a square, or tap it once, to see what would flip. Tap again to play.",
      start: { b: [[1, 2, 1], [2, 2, 2], [3, 2, 2], [2, 3, 1], [3, 3, 2]], play: [4, 2, 1] } },
    { title: "Every line at once", text: "If your disc traps lines in more than one direction, all of them flip together: across, up and down, and on the diagonals.",
      aside: "",
      start: { b: [[0, 2, 1], [1, 2, 2], [2, 0, 1], [2, 1, 2], [4, 0, 1], [3, 1, 2], [3, 2, 2], [4, 2, 2], [5, 2, 1], [2, 4, 1], [2, 3, 2], [3, 3, 2], [4, 4, 1]], play: [2, 2, 1] } },
    { title: "Pass, and the end", text: "If no move would flip anything, you pass. When neither side can move, the game ends. Whoever has more discs wins.",
      aside: "<b>Tip:</b> a disc in a corner can never be turned over.", end: true }
  ];
  function openLesson(at) {
    lessonAt = at || 0;
    elLesson.hidden = false;
    renderLesson();
    cancelAnimationFrame(lessonRaf);
    (function loop(t) { drawLesson(t); if (!elLesson.hidden) lessonRaf = requestAnimationFrame(loop); })(now());
  }
  function closeLesson() { elLesson.hidden = true; cancelAnimationFrame(lessonRaf); }
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
    var g = lessonG, S2 = cssW, N6 = 6, m = S2 * 0.06, step = (S2 - 2 * m) / N6;
    g.setTransform(d, 0, 0, d, 0, 0);
    g.fillStyle = "#3a160a"; g.fillRect(0, 0, S2, S2);
    g.fillStyle = "#1c5232"; g.fillRect(m, m, S2 - 2 * m, S2 - 2 * m);
    g.strokeStyle = "rgba(4,16,8,0.8)"; g.lineWidth = 1.2;
    for (var i = 0; i <= N6; i++) {
      g.beginPath(); g.moveTo(m, m + i * step); g.lineTo(S2 - m, m + i * step); g.stroke();
      g.beginPath(); g.moveTo(m + i * step, m); g.lineTo(m + i * step, S2 - m); g.stroke();
    }
    function C(x, y) { return { x: m + (x + 0.5) * step, y: m + (y + 0.5) * step }; }
    function piece(x, y, c, flipT, glow) {
      var p = C(x, y), R = step * 0.4, sx = 1, col = c;
      if (flipT != null) { sx = Math.abs(Math.cos(flipT * Math.PI)); if (flipT > 0.5) col = 3 - c; }
      g.save(); g.translate(p.x, p.y); g.scale(Math.max(0.06, sx), 1);
      if (glow) { g.fillStyle = "rgba(255,210,110,0.35)"; g.beginPath(); g.arc(0, 0, R * 1.35, 0, TAU); g.fill(); }
      g.fillStyle = "rgba(0,0,0,0.35)"; g.beginPath(); g.arc(R * 0.08, R * 0.12, R, 0, TAU); g.fill();
      var gr = g.createRadialGradient(-R * 0.3, -R * 0.35, R * 0.1, 0, 0, R);
      if (col === BLACK) { gr.addColorStop(0, "#3c302a"); gr.addColorStop(1, "#0b0807"); } else { gr.addColorStop(0, "#fffaf0"); gr.addColorStop(1, "#d2c19b"); }
      g.fillStyle = gr; g.beginPath(); g.arc(0, 0, R, 0, TAU); g.fill();
      g.restore();
    }
    var L = LESSON[lessonAt], e = reduced() ? 3000 : (t - lessonT0) % 4200;
    if (L.start) {
      var pl = L.start.play, b = new Uint8Array(36);
      L.start.b.forEach(function (q) { b[q[1] * 6 + q[0]] = q[2]; });
      /* which discs the play turns, in this 6x6 */
      var flips = [];
      for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        var line = [], x = pl[0] + dx, y = pl[1] + dy;
        while (x >= 0 && x < 6 && y >= 0 && y < 6 && b[y * 6 + x] === 3 - pl[2]) { line.push([x, y, Math.max(Math.abs(x - pl[0]), Math.abs(y - pl[1]))]); x += dx; y += dy; }
        if (line.length && x >= 0 && x < 6 && y >= 0 && y < 6 && b[y * 6 + x] === pl[2]) flips = flips.concat(line);
      }
      var aimOn = e > 500 && e < 1500, placed = e >= 1500;
      for (var s = 0; s < 36; s++) {
        if (!b[s]) continue;
        var fx = s % 6, fy = (s / 6) | 0, fl = null, hit = false;
        flips.forEach(function (f) { if (f[0] === fx && f[1] === fy) { hit = true; fl = f; } });
        if (hit && placed) {
          var ft = clamp((e - 1600 - (fl[2] - 1) * 140) / 380, 0, 1);
          piece(fx, fy, b[s], ft);
        } else piece(fx, fy, b[s], null, hit && aimOn);
      }
      if (aimOn) { var ap = C(pl[0], pl[1]); g.globalAlpha = 0.5; piece(pl[0], pl[1], pl[2]); g.globalAlpha = 1; void ap; }
      if (placed) piece(pl[0], pl[1], pl[2]);
    } else if (L.end) {
      /* a corner position where White has no move: White passes, Black plays on */
      var B = [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [0, 2], [3, 0], [2, 1], [1, 2]], Wh = [[4, 0], [3, 1]];
      B.forEach(function (q) { piece(q[0], q[1], BLACK); });
      Wh.forEach(function (q) { piece(q[0], q[1], WHITE); });
      var lab = e < 1600 ? "White has no move" : e < 2800 ? "White passes" : "Black plays on";
      g.font = "800 " + Math.round(S2 * 0.055) + "px Manrope, system-ui, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
      var tw = g.measureText(lab).width + 16;
      g.fillStyle = "rgba(10,18,14,0.88)"; rrect(g, S2 / 2 - tw / 2, S2 * 0.72 - 11, tw, 22, 11); g.fill();
      g.fillStyle = "#f3ead8"; g.fillText(lab, S2 / 2, S2 * 0.72 + 1);
      /* the corner, ringed */
      var cp = C(0, 0); g.strokeStyle = "rgba(246,214,130,0.9)"; g.lineWidth = 2; g.beginPath(); g.arc(cp.x, cp.y, step * 0.5, 0, TAU); g.stroke();
    }
  }

  /* ---------- share ---------- */
  function clearShare() { window.OPT_SHARE_TEXT = undefined; window.OPT_SHARE_LINE = undefined; window.OPT_SHARE_IMAGE = undefined; }
  function setupShare(mine, theirs) {
    if (!(mine > theirs) || !(mine > 0)) { clearShare(); return; }
    window.OPT_SHARE_TEXT = "I beat " + foe.name + " at Reversi, " + mine + " to " + theirs + ". " + foe.bio;
    window.OPT_SHARE_LINE = "Beat " + foe.name + " at Reversi, " + mine + " to " + theirs;
    window.OPT_SHARE_IMAGE = function () {
      var pts = [project(-HX, RIM_H, ZF), project(HX, RIM_H, ZF), project(HX, TABLE_Y, ZN), project(-HX, TABLE_Y, ZN)];
      var xs = pts.map(function (p) { return p.x; }), ys = pts.map(function (p) { return p.y; });
      var x0 = Math.max(0, Math.min.apply(null, xs) - 24), x1 = Math.min(W, Math.max.apply(null, xs) + 24);
      var y0 = Math.max(0, Math.min.apply(null, ys) - 40), y1 = Math.min(H, Math.max.apply(null, ys) + 24);
      var w = (x1 - x0) * dpr, h = (y1 - y0) * dpr;
      var out = document.createElement("canvas"); out.width = Math.round(w); out.height = Math.round(h);
      out.getContext("2d").drawImage(canvas, x0 * dpr, y0 * dpr, w, h, 0, 0, w, h);
      return out;
    };
  }

  /* ---------- automation handle (tests and the card pose only) ---------- */
  if (navigator.webdriver) {
    window.__reversi = {
      state: function () {
        var c = K.count(pos.b);
        return { phase: phase, turn: pos.turn, human: human, cpu: cpu, moves: pos.moves, plies: pos.plies, passes: pos.passes, ended: pos.ended,
          busy: busy(), thinking: thinking, myTurn: myTurn(), mustPass: K.mustPass(pos), foe: foe.id, board: Array.from(pos.b),
          legal: K.legal(pos), black: c.black, white: c.white, aim: aim, flipsPrev: flipsPrev.slice(), anim: animCount(),
          dots: dotsOn, resultShown: !elResult.hidden, portrait: portrait, lastPlaced: lastPlaced, lastThink: lastThink,
          perf: { n: perf.n, avg: perf.n ? perf.sum / perf.n : 0, max: perf.max } };
      },
      /* a square's center on screen (CSS px) */
      at: function (x, y) { var c = project(x - 3.5, 0, y - 3.5); return { x: c.x, y: c.y }; },
      /* the smallest square on screen: its width (across) and its height (toward you) */
      cells: function () {
        var out = { minW: 1e9, minH: 1e9, maxW: 0 };
        for (var y = 0; y < 8; y++) for (var x = 0; x < 8; x++) {
          var a = project(x - 4, 0, y - 4), b = project(x - 3, 0, y - 4), c = project(x - 4, 0, y - 3);
          out.minW = Math.min(out.minW, b.x - a.x); out.maxW = Math.max(out.maxW, b.x - a.x); out.minH = Math.min(out.minH, c.y - a.y);
        }
        return out;
      },
      /* put a position on the board (for rare cases such as a forced pass) */
      setup: function (b, turn) {
        pos.b = Uint8Array.from(b); pos.turn = turn; pos.passes = 0;
        pos.ended = !K.hasMove(pos.b, 1) && !K.hasMove(pos.b, 2);
        anim = {}; drop = null; placeAll(); clearAim();
        afterMove();
      },
      resetPerf: function () { perf = { n: 0, sum: 0, max: 0 }; }
    };
  }

  /* ---------- boot ---------- */
  layoutPlaques();
  wireOptions();
  buildCast();
  placeAll();
  window.addEventListener("resize", function () { layoutPlaques(); resize(); layoutPlaques(); });
  resize();
  layoutPlaques();
  buildScene();
  requestAnimationFrame(function (t) { lastT = t; tick(t); });
  setTimeout(function () { elHint.classList.add("is-gone"); }, 9000);
})();
