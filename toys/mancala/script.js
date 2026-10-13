/* Mancala — No. 137.
   A carved walnut board and forty-eight glass beads on a low table in the back room of
   a bookshop after closing: a banker's lamp, the shelves in shadow, rain on the tall
   window, and the shop cat asleep on a stack of atlases. Six regulars stay late to play.

   The board is drawn with a real perspective camera, like Checkers and Backgammon.
   Everything that never moves (the room, the window, the table, the carved board) is
   baked once per layout into one canvas. The board's top is painted flat, in its own
   coordinates (grain, cups, inlay), and then laid onto the table one screen row at a
   time, which is an exact perspective map. Each frame draws only the rain, the cat's
   breathing, the marks, the beads and their light.

   On a tall phone the board turns on end: your pits run down the left column into
   your store at the bottom, theirs up the right into theirs at the top. That keeps
   the sowing counter-clockwise on the screen, the same as on a wide one. */
(function () {
  "use strict";

  var K = window.MancalaCore, A = window.MancalaAudio;
  var canvas = document.getElementById("canvas");
  var ctx = canvas.getContext("2d");
  var $ = function (id) { return document.getElementById(id); };

  /* ================= camera ================= */
  var TILT = 0.64, SIN = 1, COS = 0, CAM_D = 24, FOCAL = 1000, CX = 0, CY = 0;
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

  /* ================= the board, in its own coordinates =================
     u runs along the board (your store at +u), v across it (your row at +v). */
  var HALF_U = 4.95, HALF_V = 1.42, CORNER = 1.0, BT = 0.36;
  var ROW_V = 0.62, PIT_RU = 0.43, PIT_RV = 0.46, PIT_D = 0.22;
  var STORE_U = 3.98, STORE_RU = 0.46, STORE_RV = 1.12, STORE_D = 0.25;
  var BR = 0.144, BH = 0.115;                         /* a bead's radius and height */
  var portrait = false;

  function slotUV(i) {
    if (i <= 5) return { u: -2.5 + i, v: ROW_V };
    if (i === 6) return { u: STORE_U, v: 0 };
    if (i <= 12) return { u: 2.5 - (i - 7), v: -ROW_V };
    return { u: -STORE_U, v: 0 };
  }
  function isStore(i) { return i === 6 || i === 13; }
  function slotR(i) { return isStore(i) ? { ru: STORE_RU, rv: STORE_RV, d: STORE_D } : { ru: PIT_RU, rv: PIT_RV, d: PIT_D }; }
  function toWorld(u, v) { return portrait ? { x: -v, z: u } : { x: u, z: v }; }
  function toBoard(x, z) { return portrait ? { u: z, v: -x } : { u: x, v: z }; }
  function slotWorld(i) { var p = slotUV(i); return toWorld(p.u, p.v); }
  /* the slot's radii along world x and z */
  function slotRW(i) { var r = slotR(i); return portrait ? { rx: r.rv, rz: r.ru } : { rx: r.ru, rz: r.rv }; }
  /* the light comes from the lamp, far and to the left on the screen */
  var LIGHT_W = { x: -0.62, z: -0.78 };
  function lightB() { return portrait ? { u: LIGHT_W.z, v: -LIGHT_W.x } : { u: LIGHT_W.x, v: LIGHT_W.z }; }

  /* ================= persistence ================= */
  var LS = { beaten: "mancala_beaten", defeated: "mancala_defeated", rules: "mancala_rules", foe: "mancala_foe",
    first: "mancala_first", counts: "mancala_counts", sound: "mancala_sound",
    w: "mancala_wins", l: "mancala_losses", d: "mancala_draws" };
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function track(name, params) { try { if (typeof window.gtag === "function") window.gtag("event", name, params || {}); } catch (e) {} }

  /* ================= the regulars ================= */
  var FOES = [
    { id: "pip", name: "Pip", role: "the owner's grandson", tier: 1, glyph: "tally", accent: "#f2c46d",
      trait: "Counts every seed out loud, and sometimes loses count.", pause: 520,
      quips: { start: "I'll count for both of us. One, two, three…", startO: "Grandma says this one is harder. One, two…",
               capture: "I took them! That's… lots!", again: "Again! I get to go again!",
               win: "I won! I counted and I won!", lose: "Again? I'll count slower.", draw: "Twenty-four and twenty-four. The same!" } },
    { id: "rosa", name: "Rosa", role: "drives the night bus", tier: 2, glyph: "bus", accent: "#e98a6c",
      trait: "Plays fast on her break and never looks twice.", pause: 420,
      quips: { start: "I've got twenty minutes. Go.", startO: "Twenty minutes. Feed me or lose.",
               capture: "Next stop, my store.", again: "Hold the doors.",
               win: "That's my break. Same time tomorrow?", lose: "Fair play. You'd make a good driver.", draw: "Even fare." } },
    { id: "felix", name: "Felix", role: "a poet who never buys anything", tier: 3, glyph: "quill", accent: "#a9c1ff",
      trait: "Loves a long sowing more than a good one.", pause: 820,
      quips: { start: "Ah, the long way round. My favorite.", startO: "Oware. Even the name sounds like a poem.",
               capture: "A rhyme, and a reward.", again: "Another verse.",
               win: "I'll write about this one.", lose: "Defeat has its own meter. Well played.", draw: "A perfect couplet." } },
    { id: "juniper", name: "Juniper", role: "sets the crossword for the paper", tier: 4, glyph: "grid", accent: "#a3d68f",
      trait: "Sees two moves ahead, sometimes three.", pause: 950,
      quips: { start: "Seven letters, 'to begin'. Your move.", startO: "Four letters, 'harvest'. Your move.",
               capture: "Down, and across.", again: "One more clue.",
               win: "Solved.", lose: "You found the answer before I did.", draw: "Two answers fit. How rare." } },
    { id: "hollis", name: "Dr. Hollis", role: "an astronomer on her way to the observatory", tier: 5, glyph: "scope", accent: "#c2adff",
      trait: "Counts the whole board before she moves.", pause: 1150,
      quips: { start: "I have a while before the sky clears.", startO: "Forty-eight seeds. Fewer than the stars, but harder.",
               capture: "Expected.", again: "As predicted.",
               win: "The numbers were always going to come out this way.", lose: "An anomaly. A good one.", draw: "Perfect symmetry." } },
    { id: "adjei", name: "Mrs. Adjei", role: "owns the shop", tier: 6, glyph: "key", accent: "#e8b04a",
      trait: "Learned Oware as a girl in Kumasi. Has never lost at her own table.", pause: 1300,
      quips: { start: "Sit down. The tea is coming.", startO: "My mother taught me this on her front step in Kumasi.",
               capture: "Mm.", again: "Again.",
               win: "Come back tomorrow. We open at nine.", lose: "Well. After all these years. Sit, have some tea.", draw: "Even. That is a good game." } }
  ];
  function foeById(id) { for (var i = 0; i < FOES.length; i++) if (FOES[i].id === id) return FOES[i]; return FOES[0]; }
  function shortName(f) { return f.name.replace(/^(Dr\.|Mrs\.) /, ""); }
  function himHer(f) { return f.id === "pip" || f.id === "felix" ? "him" : "her"; }

  /* ================= state ================= */
  var rules = lsGet(LS.rules, "kalah") === "oware" ? "oware" : "kalah";
  var mode = "solo";                                 /* solo | duo */
  var firstPref = lsGet(LS.first, "0") === "1" ? 1 : 0;
  var showCounts = lsGet(LS.counts, "1") !== "0";
  var soundOn = lsGet(LS.sound, "1") !== "0";
  var foe = foeById(lsGet(LS.foe, "pip")), picked = null;
  var pos = K.start(rules, 0);
  var started = false, over = false, thinking = false;
  var history = [], finalSnap = null, gameToken = 0, lock = 0;
  var hoverPit = -1, press = null, cursor = -1, hintPit = -1, reachPit = -1, reachT = 0;
  var shakeSlot = -1, shakeT = 0, pulseSlot = -1, pulseT = 0, pulseSide = 0;
  var glowSlots = {}, particles = [], motes = [];
  var replay = null;
  var worker = null, workerBroken = false, reqId = 0, inflight = {};
  var told = { hurry: false };

  function reduced() { return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches; }
  function later(ms, fn) {
    var t = gameToken;
    setTimeout(function () { if (t === gameToken) fn(); }, ms);
  }
  function busy() { return lock > 0 || !!anim || thinking; }
  /* whose pits take input right now */
  function humanSide() {
    if (!started || over || replay || busy()) return -1;
    if (mode === "duo") return pos.turn;
    return pos.turn === 0 ? 0 : -1;
  }
  function sideName(side) {
    if (mode === "duo") return side === 0 ? "Player 1" : "Player 2";
    return side === 0 ? "You" : shortName(foe);
  }

  /* ================= layout ================= */
  var dpr = 1, W = 0, H = 0, sceneCv = null;
  var WIN = null, CAT = null, LAMP = null, boardPoly = [];

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.floor(W * dpr); canvas.height = Math.floor(H * dpr);
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    var wasPortrait = portrait;
    portrait = H > W && W < 640;
    /* on end, the board loses a little length at the stores and the ends, so the
       pits can be as big as a phone allows */
    if (portrait) { HALF_U = 4.24; STORE_U = 3.62; STORE_RU = 0.4; setCam(0.32, 34); }
    else { HALF_U = 4.95; STORE_U = 3.98; STORE_RU = 0.46; setCam(H < 560 ? 0.6 : 0.64, 24); }
    fit();
    buildSprites();
    buildScene();
    numCache = {};
    if (wasPortrait !== portrait) beads.forEach(function (b) { b.wake = 1; });
  }

  /* Screen offsets are linear in FOCAL, so one measure-and-scale pass fits exactly. */
  function fit() {
    CX = 0; CY = 0; FOCAL = 1000;
    var pts = [];
    [[-HALF_U, -HALF_V], [HALF_U, -HALF_V], [HALF_U, HALF_V], [-HALF_U, HALF_V]].forEach(function (c) {
      var w = toWorld(c[0], c[1]);
      pts.push([w.x, 0.25, w.z]); pts.push([w.x, -BT, w.z]);
    });
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    pts.forEach(function (q) {
      var p = project(q[0], q[1], q[2]);
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    });
    var low = H < 560;
    var padX = portrait ? 10 : low ? 14 : Math.max(30, W * 0.04);
    var short = H < 740;
    var padTop = portrait ? (short ? 58 : 66) : low ? 50 : Math.max(96, H * 0.24);
    var padBot = portrait ? (short ? 100 : 120) : low ? 56 : 116;
    var availW = W - padX * 2, availH = H - padTop - padBot;
    var k = Math.min(availW / (maxX - minX), availH / (maxY - minY));
    FOCAL *= k;
    minX *= k; maxX *= k; minY *= k; maxY *= k;
    CX = W / 2 - (minX + maxX) / 2;
    var spare = availH - (maxY - minY);
    CY = padTop + Math.max(0, spare) * (portrait ? 0.5 : 0.62) - minY;
  }

  /* ================= helpers ================= */
  function srnd(n) { var x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }
  function ease(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function rgba(c, a) { return "rgba(" + (c[0] | 0) + "," + (c[1] | 0) + "," + (c[2] | 0) + "," + a + ")"; }
  function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
  function panOfSlot(i) { var w = slotWorld(i); return clamp(w.x / 5, -0.8, 0.8); }
  function polyPath(g, pts) { g.beginPath(); g.moveTo(pts[0].x, pts[0].y); for (var i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y); g.closePath(); }

  /* the board's rounded outline, in board coordinates */
  function outlineUV(inset, n) {
    var out = [], hu = HALF_U - inset, hv = HALF_V - inset, r = Math.max(0.05, CORNER - inset);
    var cs = [[hu - r, hv - r, 0], [-hu + r, hv - r, Math.PI / 2], [-hu + r, -hv + r, Math.PI], [hu - r, -hv + r, Math.PI * 1.5]];
    for (var c = 0; c < 4; c++) for (var k = 0; k <= n; k++) {
      var a = cs[c][2] + k / n * Math.PI / 2;
      out.push({ u: cs[c][0] + Math.cos(a) * r, v: cs[c][1] + Math.sin(a) * r });
    }
    return out;
  }
  function outlineScreen(y, inset) {
    return outlineUV(inset || 0, 10).map(function (p) { var w = toWorld(p.u, p.v); return project(w.x, y, w.z); });
  }

  /* ================= glass beads =================
     A flat-backed glass gem, the kind mancala sets have used for a century: a low
     dome of colored glass. Lit by a warm lamp up and to the left, so the glint is on
     that side and the light that goes THROUGH the glass gathers on the far side, in
     the glass and on the wood under it. */
  var GEMS = [
    { name: "emerald",  deep: [4, 58, 36],    base: [14, 138, 84],  mid: [62, 196, 132], light: [150, 255, 196], a: 0.9 },
    { name: "sapphire", deep: [8, 22, 86],    base: [28, 74, 204],  mid: [86, 138, 244], light: [160, 198, 255], a: 0.9 },
    { name: "amber",    deep: [104, 44, 0],   base: [222, 132, 14], mid: [250, 186, 66], light: [255, 224, 140], a: 0.88 },
    { name: "ruby",     deep: [84, 4, 20],    base: [196, 18, 48],  mid: [238, 78, 98],  light: [255, 150, 166], a: 0.9 },
    { name: "amethyst", deep: [50, 14, 88],   base: [132, 60, 204], mid: [180, 124, 240], light: [222, 184, 255], a: 0.9 },
    { name: "teal",     deep: [2, 64, 70],    base: [14, 152, 156], mid: [76, 210, 204], light: [150, 252, 242], a: 0.88 },
    { name: "smoke",    deep: [22, 20, 26],   base: [74, 70, 82],   mid: [128, 122, 138], light: [214, 206, 222], a: 0.9 },
    { name: "clear",    deep: [92, 108, 118], base: [176, 196, 206], mid: [224, 236, 242], light: [255, 255, 255], a: 0.5 }
  ];
  var VARIANTS = 2;
  var beadSp = [], shadowSp = null, causticSp = [], spriteRef = 1;

  function buildSprites() {
    spriteRef = maxScale();
    var U = spriteRef * dpr;
    beadSp = [];
    for (var g = 0; g < GEMS.length; g++) {
      beadSp[g] = [];
      for (var v = 0; v < VARIANTS; v++) beadSp[g][v] = makeBead(GEMS[g], v, U, g);
      causticSp[g] = makeCaustic(GEMS[g], U);
    }
    shadowSp = makeShadow(U);
  }
  function maxScale() {
    var m = 0;
    for (var i = 0; i < 14; i++) { var w = slotWorld(i); m = Math.max(m, project(w.x, 0, w.z).s); }
    return m * 1.12;
  }

  function makeBead(gem, variant, U, gi) {
    var R = BR * U, ry = R * SIN, h = BH * U * COS, pad = Math.ceil(R * 0.3) + 2;
    var ey = ry + h * 0.5;                               /* the silhouette: a low dome seen from above */
    var w = Math.ceil(2 * R + 2 * pad), hh = Math.ceil(2 * ey + 2 * pad);
    var c = document.createElement("canvas"); c.width = w; c.height = hh;
    var g = c.getContext("2d");
    var cx = w / 2, cy = pad + ey, by = cy + h * 0.5, ty = cy - h * 0.5;   /* center, base, top */
    var deep = gem.deep, base = gem.base, mid = gem.mid, lite = gem.light, a = gem.a;
    var clear = gem.name === "clear";
    function body() { g.beginPath(); g.ellipse(cx, cy, R, ey, 0, 0, Math.PI * 2); }
    /* the glass: deep at the rim, where the light runs through the most glass */
    body();
    var bg = g.createRadialGradient(cx - R * 0.12, ty, R * 0.05, cx, cy, R * 1.05);
    bg.addColorStop(0, rgba(mid, clear ? 0.26 : a * 0.8));
    bg.addColorStop(0.62, rgba(base, clear ? 0.32 : a * 0.9));
    bg.addColorStop(1, rgba(deep, clear ? 0.7 : 0.97));
    g.fillStyle = bg; g.fill();
    g.save();
    body(); g.clip();
    /* the dome's flat top, a little lighter than its rolled edge */
    var tg = g.createRadialGradient(cx - R * 0.2, ty - ry * 0.1, 0, cx, ty, R * 0.95);
    tg.addColorStop(0, rgba(lite, clear ? 0.14 : 0.16)); tg.addColorStop(0.7, rgba(mid, 0.05)); tg.addColorStop(1, rgba(deep, 0));
    g.fillStyle = tg; g.beginPath(); g.ellipse(cx, ty, R * 0.86, ry * 0.86, 0, 0, Math.PI * 2); g.fill();
    /* the near edge rolls under, into shadow */
    var sg = g.createLinearGradient(0, cy - ey, 0, cy + ey);
    sg.addColorStop(0, "rgba(0,0,0,0)"); sg.addColorStop(0.7, "rgba(0,0,0,0)"); sg.addColorStop(1, rgba(deep, clear ? 0.4 : 0.6));
    g.fillStyle = sg; g.fillRect(0, 0, w, hh);
    /* lamplight gathered inside the glass, on the side away from the lamp */
    g.globalCompositeOperation = "lighter";
    var kx = cx + R * 0.34, ky = cy + ey * 0.32;
    var cg = g.createRadialGradient(kx, ky, 0, kx, ky, R * 0.7);
    cg.addColorStop(0, rgba(lite, clear ? 0.62 : 0.85)); cg.addColorStop(0.4, rgba(mid, clear ? 0.2 : 0.34)); cg.addColorStop(1, rgba(mid, 0));
    g.fillStyle = cg; g.fillRect(0, 0, w, hh);
    g.globalCompositeOperation = "source-over";
    /* a bubble or two caught in the glass */
    for (var k = 0; k <= variant; k++) {
      var bx = cx + (srnd(gi * 17 + variant * 5 + k * 3) - 0.5) * R * 0.9, byy = cy + (srnd(gi * 13 + variant * 7 + k) - 0.5) * ey * 0.9;
      var brr = R * (0.035 + srnd(gi + k * 11 + variant) * 0.035);
      g.strokeStyle = "rgba(255,255,255,0.3)"; g.lineWidth = Math.max(0.6, brr * 0.5);
      g.beginPath(); g.arc(bx, byy, brr, 0, Math.PI * 2); g.stroke();
    }
    g.restore();
    /* the edge: dark where the glass turns away, a thin bright line where it faces the lamp */
    body(); g.strokeStyle = rgba(deep, clear ? 0.6 : 0.8); g.lineWidth = Math.max(0.8, R * 0.055); g.stroke();
    g.save(); g.lineCap = "round";
    g.beginPath(); g.ellipse(cx, cy, R * 0.93, ey * 0.93, 0, Math.PI * 1.02, Math.PI * 1.56);
    g.strokeStyle = "rgba(255,244,226,0.5)"; g.lineWidth = Math.max(0.8, R * 0.045); g.stroke();
    g.restore();
    /* the rainy window, reflected small and cool on the far side of the dome */
    g.save();
    g.translate(cx + R * 0.46, cy - ey * 0.36); g.rotate(0.5);
    g.fillStyle = "rgba(186,212,255,0.26)";
    g.beginPath(); g.ellipse(0, 0, R * 0.07, R * 0.16, 0, 0, Math.PI * 2); g.fill();
    g.restore();
    /* the lamp's glint: crisp and small, toward the light */
    var gx = cx - R * 0.36, gy = cy - ey * 0.42;
    var gl = g.createRadialGradient(gx, gy, 0, gx, gy, R * 0.3);
    gl.addColorStop(0, "rgba(255,246,228,0.55)"); gl.addColorStop(1, "rgba(255,246,228,0)");
    g.fillStyle = gl; g.beginPath(); g.arc(gx, gy, R * 0.3, 0, Math.PI * 2); g.fill();
    g.save(); g.translate(gx, gy); g.rotate(-0.5);
    g.fillStyle = "rgba(255,255,255,0.97)";
    g.beginPath(); g.ellipse(0, 0, R * 0.12, R * 0.055, 0, 0, Math.PI * 2); g.fill();
    g.restore();
    return { cv: c, ax: cx, ay: by, R: R };
  }

  function makeShadow(U) {
    var R = BR * U, ry = R * SIN, sw = Math.ceil(R * 3.4), sh = Math.ceil(ry * 3.4) + 2;
    var c = document.createElement("canvas"); c.width = sw; c.height = sh;
    var g = c.getContext("2d");
    g.translate(sw / 2, sh / 2); g.scale(1, ry / R);
    var gr = g.createRadialGradient(0, 0, R * 0.35, 0, 0, R * 1.6);
    gr.addColorStop(0, "rgba(6,2,0,0.66)"); gr.addColorStop(0.55, "rgba(6,2,0,0.3)"); gr.addColorStop(1, "rgba(6,2,0,0)");
    g.fillStyle = gr; g.beginPath(); g.arc(0, 0, R * 1.65, 0, Math.PI * 2); g.fill();
    return { cv: c, ax: sw / 2, ay: sh / 2 };
  }
  /* the colored light a bead throws onto the wood: focused, on the far side */
  function makeCaustic(gem, U) {
    var R = BR * U, ry = R * SIN, sw = Math.ceil(R * 2.6), sh = Math.ceil(ry * 2.6) + 2;
    var c = document.createElement("canvas"); c.width = sw; c.height = sh;
    var g = c.getContext("2d");
    g.translate(sw / 2, sh / 2); g.scale(1, ry / R);
    var gr = g.createRadialGradient(0, 0, 0, 0, 0, R * 1.2);
    var k = gem.name === "clear" ? 0.5 : gem.name === "smoke" ? 0.3 : 0.62;
    gr.addColorStop(0, rgba(gem.light, k)); gr.addColorStop(0.35, rgba(gem.mid, k * 0.5)); gr.addColorStop(1, rgba(gem.base, 0));
    g.fillStyle = gr; g.beginPath(); g.arc(0, 0, R * 1.25, 0, Math.PI * 2); g.fill();
    return { cv: c, ax: sw / 2, ay: sh / 2 };
  }

  /* ================= the room ================= */
  function buildScene() {
    sceneCv = document.createElement("canvas");
    sceneCv.width = canvas.width; sceneCv.height = canvas.height;
    var g = sceneCv.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    var zFar = portrait ? -HALF_U - 1.0 : -HALF_V - 2.6;
    var farY = project(0, -BT, zFar).y;
    drawWall(g, farY);
    drawTable(g, zFar, farY);
    drawWindowLight(g);
    drawProps(g);
    drawBoard(g);
    /* the lamp's warm pool over the table and board */
    var lp = project(LAMP.wx + 2.2, -BT, LAMP.wz + 1.4), reach = Math.max(W, H) * (portrait ? 0.95 : 0.75);
    var pool = g.createRadialGradient(lp.x, lp.y, 0, lp.x, lp.y, reach);
    pool.addColorStop(0, "rgba(255,186,110,0.16)"); pool.addColorStop(0.5, "rgba(255,170,100,0.06)"); pool.addColorStop(1, "rgba(255,170,100,0)");
    g.globalCompositeOperation = "lighter"; g.fillStyle = pool; g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = "source-over";
    var c0 = project(0, 0, 0);
    var vg = g.createRadialGradient(W / 2, c0.y, Math.min(W, H) * 0.32, W / 2, c0.y, Math.max(W, H) * 0.86);
    vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,0.66)");
    g.fillStyle = vg; g.fillRect(0, 0, W, H);
  }

  /* --- the back wall: shelves of books in shadow, and the tall window --- */
  function drawWall(g, farY) {
    var bg = g.createLinearGradient(0, 0, 0, Math.max(1, farY));
    bg.addColorStop(0, "#0d0806"); bg.addColorStop(1, "#1b110b");
    g.fillStyle = bg; g.fillRect(0, 0, W, Math.max(0, farY) + 2);
    if (farY < 8) { WIN = null; return; }
    var unit = clamp(project(0, 0, 0).s * 0.34, 9, 34);
    /* the window: tall, toward the right, cut off by the top of the screen */
    var ww = portrait ? Math.min(W * 0.44, 190) : clamp(W * 0.19, 150, 300);
    var wx = portrait ? W * 0.5 - ww / 2 : W * 0.6;
    var wTop = -10, wBot = farY - Math.max(6, unit * 0.5);
    if (wBot - wTop > 30) {
      WIN = { x: wx, y: Math.max(0, wTop), w: ww, h: wBot - Math.max(0, wTop), unit: unit };
      drawWindow(g, WIN);
    } else WIN = null;
    /* shelves either side */
    var rows = [];
    for (var y = farY - unit * 0.6; y > -unit * 3; y -= unit * 3.1) rows.push(y);
    rows.forEach(function (sy, ri) {
      shelfRow(g, 0, WIN ? WIN.x - unit * 0.9 : W, sy, unit, ri);
      if (WIN) shelfRow(g, WIN.x + WIN.w + unit * 0.9, W, sy, unit, ri + 7);
    });
    /* the shelves sit in shadow away from the lamp */
    var sh = g.createLinearGradient(0, 0, W, 0);
    sh.addColorStop(0, "rgba(10,6,4,0.18)"); sh.addColorStop(0.5, "rgba(10,6,4,0.42)"); sh.addColorStop(1, "rgba(10,6,4,0.62)");
    g.fillStyle = sh; g.fillRect(0, 0, W, farY);
    if (WIN) {
      /* the window's cool light spills onto the wall around it */
      var spill = g.createRadialGradient(WIN.x + WIN.w / 2, WIN.y + WIN.h * 0.7, WIN.w * 0.3, WIN.x + WIN.w / 2, WIN.y + WIN.h * 0.7, WIN.w * 1.6);
      spill.addColorStop(0, "rgba(90,130,190,0.10)"); spill.addColorStop(1, "rgba(90,130,190,0)");
      g.globalCompositeOperation = "lighter"; g.fillStyle = spill; g.fillRect(0, 0, W, farY);
      g.globalCompositeOperation = "source-over";
    }
  }

  var SPINES = [[92, 30, 26], [34, 62, 46], [32, 46, 76], [116, 82, 34], [70, 36, 64], [112, 88, 60], [30, 26, 24], [124, 54, 36], [58, 74, 70], [96, 72, 98]];
  function shelfRow(g, x0, x1, sy, unit, seed) {
    if (x1 - x0 < unit) return;
    var x = x0 + 2, k = 0, hMax = unit * 2.7;
    while (x < x1 - 2) {
      var t = srnd(seed * 97 + k * 7.3), wd = unit * (0.32 + srnd(seed * 31 + k) * 0.36);
      if (x + wd > x1) break;
      var ht = hMax * (0.72 + srnd(k * 5 + seed) * 0.26);
      var col = SPINES[(srnd(k * 13 + seed * 3) * SPINES.length) | 0];
      var lean = t > 0.93 ? 0.12 : 0;
      g.save();
      g.translate(x, sy); if (lean) g.rotate(lean);
      var sg = g.createLinearGradient(0, 0, wd, 0);
      sg.addColorStop(0, rgba(mix(col, [0, 0, 0], 0.45), 1)); sg.addColorStop(0.35, rgba(col, 1)); sg.addColorStop(1, rgba(mix(col, [0, 0, 0], 0.6), 1));
      g.fillStyle = sg; g.fillRect(0, -ht, wd, ht);
      /* gilt bands and a title panel */
      g.fillStyle = "rgba(214,172,98,0.32)";
      g.fillRect(0, -ht + unit * 0.18, wd, Math.max(1, unit * 0.05));
      g.fillRect(0, -unit * 0.26, wd, Math.max(1, unit * 0.05));
      if (srnd(k * 3 + seed) > 0.45) { g.fillStyle = "rgba(20,12,8,0.45)"; g.fillRect(wd * 0.18, -ht * 0.66, wd * 0.64, ht * 0.18); g.fillStyle = "rgba(214,172,98,0.22)"; g.fillRect(wd * 0.28, -ht * 0.6, wd * 0.44, Math.max(1, unit * 0.04)); }
      g.restore();
      x += wd + (srnd(k * 19 + seed) < 0.1 ? unit * 0.5 : 0.6);
      k++;
    }
    /* the shelf board */
    var bd = g.createLinearGradient(0, sy, 0, sy + unit * 0.3);
    bd.addColorStop(0, "#3b2416"); bd.addColorStop(1, "#1a0f08");
    g.fillStyle = bd; g.fillRect(x0, sy, x1 - x0, unit * 0.3);
    g.fillStyle = "rgba(255,206,150,0.10)"; g.fillRect(x0, sy, x1 - x0, 1);
    var sd = g.createLinearGradient(0, sy + unit * 0.3, 0, sy + unit * 0.9);
    sd.addColorStop(0, "rgba(0,0,0,0.45)"); sd.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = sd; g.fillRect(x0, sy + unit * 0.3, x1 - x0, unit * 0.6);
  }

  function drawWindow(g, w) {
    var fr = Math.max(5, w.unit * 0.42);
    /* the night outside: wet street light under a low sky */
    var sky = g.createLinearGradient(0, w.y, 0, w.y + w.h);
    sky.addColorStop(0, "#070d18"); sky.addColorStop(0.6, "#0f1b2c"); sky.addColorStop(1, "#22273a");
    g.fillStyle = sky; g.fillRect(w.x, w.y, w.w, w.h);
    g.save();
    g.beginPath(); g.rect(w.x, w.y, w.w, w.h); g.clip();
    /* the far side of the street, out of focus: lit windows and lamps */
    var hz = w.y + w.h * 0.62;
    g.fillStyle = "rgba(8,12,20,0.9)"; g.fillRect(w.x, hz - w.h * 0.22, w.w, w.h * 0.6);
    for (var i = 0; i < 26; i++) {
      var bx = w.x + srnd(i * 3.1) * w.w, by = hz - w.h * 0.2 + srnd(i * 7.7) * w.h * 0.34, br = w.unit * (0.3 + srnd(i * 1.9) * 0.9);
      var hue = srnd(i * 5.3);
      var col = hue < 0.55 ? [255, 176, 92] : hue < 0.75 ? [255, 226, 180] : hue < 0.88 ? [96, 210, 200] : [255, 88, 96];
      var bk = g.createRadialGradient(bx, by, 0, bx, by, br);
      bk.addColorStop(0, rgba(col, 0.55)); bk.addColorStop(0.6, rgba(col, 0.2)); bk.addColorStop(1, rgba(col, 0));
      g.globalCompositeOperation = "lighter"; g.fillStyle = bk; g.beginPath(); g.arc(bx, by, br, 0, Math.PI * 2); g.fill();
    }
    /* a streetlamp's sodium glow, and the wet street catching it */
    var sl = g.createRadialGradient(w.x + w.w * 0.3, hz - w.h * 0.18, 0, w.x + w.w * 0.3, hz - w.h * 0.18, w.w * 0.7);
    sl.addColorStop(0, "rgba(255,170,80,0.35)"); sl.addColorStop(1, "rgba(255,170,80,0)");
    g.fillStyle = sl; g.fillRect(w.x, w.y, w.w, w.h);
    var wet = g.createLinearGradient(0, hz + w.h * 0.1, 0, w.y + w.h);
    wet.addColorStop(0, "rgba(255,160,90,0.10)"); wet.addColorStop(1, "rgba(255,160,90,0.02)");
    g.fillStyle = wet; g.fillRect(w.x, hz + w.h * 0.1, w.w, w.h);
    g.globalCompositeOperation = "source-over";
    /* a fine haze on the glass */
    g.fillStyle = "rgba(150,170,200,0.05)"; g.fillRect(w.x, w.y, w.w, w.h);
    /* drops that have settled on the pane, baked; the moving ones are drawn live */
    for (var d = 0; d < 140; d++) {
      var dx = w.x + srnd(d * 2.3 + 1) * w.w, dy = w.y + srnd(d * 4.1 + 2) * w.h, dr = 0.6 + srnd(d * 9.7) * 1.8;
      g.fillStyle = "rgba(10,16,26,0.5)"; g.beginPath(); g.ellipse(dx, dy - dr * 0.25, dr, dr * 1.15, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = "rgba(220,230,255,0.35)"; g.beginPath(); g.ellipse(dx, dy + dr * 0.35, dr * 0.7, dr * 0.45, 0, 0, Math.PI * 2); g.fill();
    }
    g.restore();
    /* the frame and its glazing bars */
    g.strokeStyle = "#140b06"; g.lineWidth = fr; g.strokeRect(w.x - fr / 2, w.y - fr / 2 - 20, w.w + fr, w.h + fr + 20);
    g.strokeStyle = "rgba(255,200,140,0.10)"; g.lineWidth = 1; g.strokeRect(w.x - fr, w.y - fr - 20, w.w + fr * 2, w.h + fr * 2 + 20);
    g.fillStyle = "#140b06";
    g.fillRect(w.x + w.w / 2 - fr * 0.3, w.y, fr * 0.6, w.h);
    for (var b = 1; b < 4; b++) { var yy = w.y + w.h - b * w.h / 3.2; if (yy > w.y + 4) g.fillRect(w.x, yy - fr * 0.25, w.w, fr * 0.5); }
    /* the sill */
    var sill = g.createLinearGradient(0, w.y + w.h, 0, w.y + w.h + fr * 1.1);
    sill.addColorStop(0, "#3a2416"); sill.addColorStop(1, "#160d07");
    g.fillStyle = sill; g.fillRect(w.x - fr * 1.6, w.y + w.h, w.w + fr * 3.2, fr * 1.1);
    g.fillStyle = "rgba(160,190,240,0.18)"; g.fillRect(w.x - fr * 1.6, w.y + w.h, w.w + fr * 3.2, 1);
  }

  /* --- the table: a low reading table under green leather --- */
  function drawTable(g, zFar, farY) {
    var X0 = -16, X1 = 16, Z0 = zFar, Z1 = 16;
    var tex = leatherTexture(X1 - X0, Z1 - Z0);
    g.save(); g.setTransform(1, 0, 0, 1, 0, 0);
    mapPlane(g, tex, X0, X1, Z0, Z1, -BT);
    g.restore();
    /* the far edge of the table catches the lamp */
    var a = project(X0, -BT, Z0), b = project(X1, -BT, Z0);
    g.strokeStyle = "rgba(255,210,150,0.22)"; g.lineWidth = 1.2;
    g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
    g.fillStyle = "rgba(0,0,0,0.5)"; g.fillRect(0, a.y - 1, W, 1);
  }
  function leatherTexture(wu, hu) {
    var ppu = 26, tw = Math.ceil(wu * ppu), th = Math.ceil(hu * ppu);
    var c = document.createElement("canvas"); c.width = tw; c.height = th;
    var g = c.getContext("2d");
    g.fillStyle = "#142a20"; g.fillRect(0, 0, tw, th);
    /* mottling */
    for (var i = 0; i < 900; i++) {
      var x = srnd(i * 1.37) * tw, y = srnd(i * 2.71) * th, r = 6 + srnd(i * 3.3) * 40;
      g.fillStyle = srnd(i * 5.1) > 0.5 ? "rgba(40,70,52,0.10)" : "rgba(4,12,8,0.12)";
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
    /* fine grain of the hide */
    for (var k = 0; k < 7000; k++) {
      var gx = srnd(k * 0.917 + 3) * tw, gy = srnd(k * 1.733 + 5) * th;
      g.fillStyle = srnd(k) > 0.5 ? "rgba(255,255,255,0.025)" : "rgba(0,0,0,0.08)";
      g.fillRect(gx, gy, 1.5, 1);
    }
    /* the tooled gilt border, a hand's width in from the edges */
    g.strokeStyle = "rgba(200,160,90,0.30)"; g.lineWidth = 2;
    g.strokeRect(ppu * 1.6, ppu * 0.5, tw - ppu * 3.2, th + ppu * 4);
    g.strokeStyle = "rgba(200,160,90,0.16)"; g.lineWidth = 1;
    g.strokeRect(ppu * 1.9, ppu * 0.8, tw - ppu * 3.8, th + ppu * 4);
    return c;
  }

  /* Lay a flat texture onto the horizontal plane at height y, one device row at a
     time. Every screen row is one line of constant depth on the plane, so this is an
     exact perspective map. */
  function mapPlane(g, tex, X0, X1, Z0, Z1, y) {
    var top = project(0, y, Z0).y, bot = project(0, y, Z1).y;
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

  /* --- the street light through the rainy window, lying on the table --- */
  var PATCH = null, patchDrops = [];
  function drawWindowLight(g) {
    /* far-left, far-right, near-right, near-left, in world x / z on the table */
    PATCH = portrait ? [[-2.95, -4.2], [-1.75, -4.4], [-1.6, 0.6], [-2.8, 0.9]]
                     : [[0.3, -3.75], [3.3, -3.75], [3.95, -1.75], [0.95, -1.75]];
    var pts = PATCH.map(function (q) { return project(q[0], -BT, q[1]); });
    g.save(); polyPath(g, pts); g.clip();
    var gr = g.createLinearGradient(pts[0].x, pts[0].y, pts[2].x, pts[2].y);
    gr.addColorStop(0, "rgba(120,160,230,0.13)"); gr.addColorStop(1, "rgba(120,160,230,0.035)");
    g.globalCompositeOperation = "lighter"; g.fillStyle = gr; g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = "source-over";
    /* the glazing bars' shadows */
    g.strokeStyle = "rgba(4,10,8,0.32)"; g.lineWidth = Math.max(2, project(0, -BT, 0).s * 0.06);
    g.beginPath();
    var m0 = patchPoint(0.5, 0), m1 = patchPoint(0.5, 1); g.moveTo(m0.x, m0.y); g.lineTo(m1.x, m1.y);
    [0.36, 0.7].forEach(function (t) { var a = patchPoint(0, t), b = patchPoint(1, t); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); });
    g.stroke();
    g.restore();
    patchDrops = [];
    for (var i = 0; i < 22; i++) patchDrops.push({ s: Math.random(), t: Math.random(), v: 0.00004 + Math.random() * 0.00012, r: 0.02 + Math.random() * 0.04, p: Math.random() * 3 });
  }
  function patchPoint(s, t) {
    var a = PATCH[0], b = PATCH[1], c = PATCH[2], d = PATCH[3];
    var x = (a[0] * (1 - s) + b[0] * s) * (1 - t) + (d[0] * (1 - s) + c[0] * s) * t;
    var z = (a[1] * (1 - s) + b[1] * s) * (1 - t) + (d[1] * (1 - s) + c[1] * s) * t;
    return project(x, -BT, z);
  }
  /* the shadows of drops running down the pane, crawling across the light */
  function drawPatch(dt) {
    if (!PATCH) return;
    var still = reduced();
    for (var i = 0; i < patchDrops.length; i++) {
      var d = patchDrops[i];
      if (!still) { d.t += d.v * dt * (0.4 + 0.6 * Math.abs(Math.sin(d.p += dt / 900))); if (d.t > 1.02) { d.t = -0.02; d.s = Math.random(); } }
      var p = patchPoint(d.s, d.t), r = d.r * p.s;
      ctx.fillStyle = "rgba(2,6,10,0.16)";
      ctx.beginPath(); ctx.ellipse(p.x, p.y, r, r * SIN * 1.4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "rgba(170,200,255,0.08)";
      ctx.beginPath(); ctx.ellipse(p.x + r * 0.3, p.y + r * 0.4, r * 0.6, r * 0.5 * SIN, 0, 0, Math.PI * 2); ctx.fill();
    }
  }

  /* --- the lamp and the cat --- */
  function drawProps(g) {
    LAMP = portrait ? { wx: -2.5, wz: -HALF_U - 0.7, hide: true } : { wx: -HALF_U + 0.35, wz: -HALF_V - 1.75 };
    var lb = project(LAMP.wx, -BT, LAMP.wz);
    var u = lb.s;
    /* the green glass shade throws light down onto the leather */
    g.save();
    g.translate(lb.x + u * 0.8, lb.y + u * 0.5); g.scale(1, SIN);
    var pool = g.createRadialGradient(0, 0, 0, 0, 0, u * 5);
    pool.addColorStop(0, "rgba(255,196,118,0.26)"); pool.addColorStop(0.35, "rgba(255,186,110,0.1)"); pool.addColorStop(1, "rgba(255,186,110,0)");
    g.globalCompositeOperation = "lighter"; g.fillStyle = pool;
    g.beginPath(); g.arc(0, 0, u * 5, 0, Math.PI * 2); g.fill();
    g.restore();
    g.globalCompositeOperation = "source-over";
    if (!LAMP.hide) drawLamp(g, lb.x, lb.y, u);
    /* the atlases and the cat, on the other side */
    var cw = portrait ? { x: HALF_V + 0.95, z: -1.6 } : { x: HALF_U - 0.55, z: -HALF_V - 1.55 };
    var cb = project(cw.x, -BT, cw.z);
    CAT = { x: cb.x, y: cb.y, s: cb.s };
    drawAtlases(g, cb.x, cb.y, cb.s);
    buildCat(cb.s * 0.92);
  }

  function drawLamp(g, x, y, u) {
    var k = u * 0.62;
    /* base */
    var bb = g.createLinearGradient(x - k, 0, x + k, 0);
    bb.addColorStop(0, "#f0c873"); bb.addColorStop(0.4, "#9a6a28"); bb.addColorStop(1, "#3a2408");
    g.fillStyle = "rgba(0,0,0,0.5)"; g.beginPath(); g.ellipse(x + k * 0.2, y + k * 0.08, k * 1.0, k * 0.36 * SIN + 2, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = bb; g.beginPath(); g.ellipse(x, y - k * 0.08, k * 0.8, k * 0.3 * SIN + 2, 0, 0, Math.PI * 2); g.fill();
    /* stem */
    g.fillStyle = bb; g.fillRect(x - k * 0.07, y - k * 1.9, k * 0.14, k * 1.85);
    g.fillStyle = "rgba(255,236,190,0.55)"; g.fillRect(x - k * 0.05, y - k * 1.9, k * 0.03, k * 1.85);
    /* the shade: a long half cylinder of cased green glass, lit from inside along its rim */
    var sx = x, sy = y - k * 2.0, sw = k * 1.2, shh = k * 0.5;
    var gs = g.createLinearGradient(0, sy - shh, 0, sy + shh * 0.25);
    gs.addColorStop(0, "#06210f"); gs.addColorStop(0.5, "#11502e"); gs.addColorStop(0.85, "#2f8f58"); gs.addColorStop(1, "#5cc489");
    g.fillStyle = gs;
    g.beginPath();
    g.moveTo(sx - sw, sy + shh * 0.12);
    g.bezierCurveTo(sx - sw * 0.98, sy - shh * 0.75, sx - sw * 0.7, sy - shh, sx, sy - shh);
    g.bezierCurveTo(sx + sw * 0.7, sy - shh, sx + sw * 0.98, sy - shh * 0.75, sx + sw, sy + shh * 0.12);
    g.closePath(); g.fill();
    /* the curve of the glass: a long soft highlight, and the dark end caps */
    var hl = g.createLinearGradient(sx - sw, 0, sx + sw, 0);
    hl.addColorStop(0, "rgba(0,0,0,0.35)"); hl.addColorStop(0.3, "rgba(200,255,220,0.0)"); hl.addColorStop(0.42, "rgba(200,255,220,0.2)"); hl.addColorStop(0.55, "rgba(200,255,220,0.0)"); hl.addColorStop(1, "rgba(0,0,0,0.45)");
    g.fillStyle = hl; g.fill();
    /* the brass rim */
    g.fillStyle = "#d7a656"; g.fillRect(sx - sw, sy + shh * 0.1, sw * 2, Math.max(1.5, k * 0.07));
    g.fillStyle = "rgba(255,240,200,0.6)"; g.fillRect(sx - sw, sy + shh * 0.1, sw * 2, 1);
    /* the bulb's glow under the rim, an ellipse of light */
    g.save();
    g.globalCompositeOperation = "lighter";
    g.translate(sx, sy + shh * 0.3); g.scale(1, 0.42);
    var gl = g.createRadialGradient(0, 0, 0, 0, 0, sw * 1.5);
    gl.addColorStop(0, "rgba(255,232,170,0.85)"); gl.addColorStop(0.18, "rgba(255,206,130,0.4)"); gl.addColorStop(0.55, "rgba(255,180,100,0.08)"); gl.addColorStop(1, "rgba(255,180,100,0)");
    g.fillStyle = gl; g.beginPath(); g.arc(0, 0, sw * 1.5, 0, Math.PI * 2); g.fill();
    g.restore();
  }

  /* A stack of three big atlases in cloth, spines toward us, gilt on the spines. */
  function drawAtlases(g, x, y, s) {
    var books = [[1.42, 0.17, [70, 24, 22]], [1.3, 0.15, [24, 40, 62]], [1.36, 0.16, [34, 52, 34]]];
    var yy = y, k = s;
    g.save(); g.translate(x + k * 0.2, y); g.scale(1, SIN * 0.5);
    var bs = g.createRadialGradient(0, 0, k * 0.3, 0, 0, k * 1.0);
    bs.addColorStop(0, "rgba(0,0,0,0.45)"); bs.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = bs; g.beginPath(); g.arc(0, 0, k, 0, Math.PI * 2); g.fill();
    g.restore();
    books.forEach(function (b, i) {
      var w = b[0] * k, h = Math.max(3, b[1] * k * COS * 1.6), d = 0.95 * k * SIN;
      var x0 = x - w / 2 + (i === 1 ? k * 0.06 : i === 2 ? -k * 0.04 : 0);
      /* the spine */
      var sg = g.createLinearGradient(x0, 0, x0 + w, 0);
      sg.addColorStop(0, rgba(mix(b[2], [255, 200, 140], 0.18), 1)); sg.addColorStop(0.5, rgba(b[2], 1)); sg.addColorStop(1, rgba(mix(b[2], [0, 0, 0], 0.55), 1));
      g.fillStyle = sg; rrect(g, x0, yy - h, w, h, Math.min(3, h * 0.3)); g.fill();
      g.fillStyle = "rgba(226,184,104,0.55)";
      g.fillRect(x0 + w * 0.1, yy - h * 0.66, w * 0.05, h * 0.32);
      g.fillRect(x0 + w * 0.85, yy - h * 0.66, w * 0.05, h * 0.32);
      g.fillRect(x0 + w * 0.36, yy - h * 0.6, w * 0.28, Math.max(1, h * 0.18));
      yy -= h;
      if (i === books.length - 1) {
        /* the top cover, seen from above: cloth with a blind-stamped border */
        var tg = g.createLinearGradient(0, yy - d, 0, yy);
        tg.addColorStop(0, rgba(mix(b[2], [0, 0, 0], 0.5), 1)); tg.addColorStop(1, rgba(mix(b[2], [255, 210, 160], 0.08), 1));
        g.fillStyle = tg;
        g.beginPath(); g.moveTo(x0, yy); g.lineTo(x0 + w * 0.05, yy - d); g.lineTo(x0 + w * 0.97, yy - d); g.lineTo(x0 + w, yy); g.closePath(); g.fill();
        g.strokeStyle = "rgba(226,184,104,0.28)"; g.lineWidth = 1;
        g.beginPath(); g.moveTo(x0 + w * 0.08, yy - d * 0.12); g.lineTo(x0 + w * 0.11, yy - d * 0.88); g.lineTo(x0 + w * 0.91, yy - d * 0.88); g.lineTo(x0 + w * 0.92, yy - d * 0.12); g.closePath(); g.stroke();
        g.fillStyle = "rgba(255,214,160,0.16)"; g.fillRect(x0, yy, w, 1);
        CAT.top = yy - d * 0.42;
      }
    });
  }

  /* The shop cat, curled asleep on the atlases: a dark tabby loaf, head down on her
     paws, tail wrapped round, the lamp along her back. Drawn once; each frame only
     scales her a hair as she breathes. */
  function buildCat(s) {
    var k = s * dpr, w = Math.ceil(k * 1.7), h = Math.ceil(k * 1.05);
    var c = document.createElement("canvas"); c.width = w; c.height = h;
    var g = c.getContext("2d");
    var cx = w * 0.53, by = h * 0.86;
    function fur(x, y, r) {
      var fg = g.createRadialGradient(x - r * 0.45, y - r * 0.55, r * 0.05, x, y, r * 1.15);
      fg.addColorStop(0, "#6a5544"); fg.addColorStop(0.45, "#33261c"); fg.addColorStop(1, "#110b07");
      return fg;
    }
    /* body and haunch */
    g.fillStyle = fur(cx, by - k * 0.3, k * 0.55);
    g.beginPath(); g.ellipse(cx, by - k * 0.27, k * 0.55, k * 0.27, 0, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.ellipse(cx + k * 0.3, by - k * 0.31, k * 0.29, k * 0.26, 0, 0, Math.PI * 2); g.fill();
    /* tabby stripes across the back */
    g.save();
    g.beginPath(); g.ellipse(cx, by - k * 0.27, k * 0.55, k * 0.27, 0, 0, Math.PI * 2); g.ellipse(cx + k * 0.3, by - k * 0.31, k * 0.29, k * 0.26, 0, 0, Math.PI * 2); g.clip();
    g.strokeStyle = "rgba(10,6,3,0.45)"; g.lineWidth = k * 0.035; g.lineCap = "round";
    for (var i = -4; i <= 5; i++) {
      var sx = cx + i * k * 0.1;
      g.beginPath(); g.moveTo(sx - k * 0.02, by - k * 0.56); g.quadraticCurveTo(sx + k * 0.05, by - k * 0.36, sx - k * 0.01, by - k * 0.16); g.stroke();
    }
    g.restore();
    /* the tail, wrapped round the front, tip under her chin */
    g.lineCap = "round";
    var tl = g.createLinearGradient(cx + k * 0.55, 0, cx - k * 0.4, 0);
    tl.addColorStop(0, "#2a1e15"); tl.addColorStop(1, "#181009");
    g.strokeStyle = tl; g.lineWidth = k * 0.1;
    g.beginPath(); g.moveTo(cx + k * 0.52, by - k * 0.14); g.bezierCurveTo(cx + k * 0.3, by + k * 0.03, cx - k * 0.1, by + k * 0.02, cx - k * 0.36, by - k * 0.03); g.stroke();
    g.strokeStyle = "rgba(255,190,120,0.18)"; g.lineWidth = k * 0.025;
    g.beginPath(); g.moveTo(cx + k * 0.46, by - k * 0.17); g.bezierCurveTo(cx + k * 0.28, by - k * 0.02, cx - k * 0.1, by - k * 0.03, cx - k * 0.34, by - k * 0.07); g.stroke();
    /* head, resting on her paws at the front left */
    var hx = cx - k * 0.44, hy = by - k * 0.19;
    g.fillStyle = "#2c2118"; g.beginPath(); g.ellipse(hx + k * 0.05, by - k * 0.05, k * 0.14, k * 0.06, 0, 0, Math.PI * 2); g.fill();   /* paws */
    g.fillStyle = fur(hx, hy, k * 0.2);
    g.beginPath(); g.ellipse(hx, hy, k * 0.2, k * 0.16, -0.12, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.moveTo(hx - k * 0.17, hy - k * 0.06); g.lineTo(hx - k * 0.2, hy - k * 0.27); g.lineTo(hx - k * 0.04, hy - k * 0.14); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(hx + k * 0.01, hy - k * 0.15); g.lineTo(hx + k * 0.1, hy - k * 0.31); g.lineTo(hx + k * 0.17, hy - k * 0.09); g.closePath(); g.fill();
    g.fillStyle = "rgba(196,120,104,0.32)";
    g.beginPath(); g.moveTo(hx - k * 0.15, hy - k * 0.09); g.lineTo(hx - k * 0.17, hy - k * 0.22); g.lineTo(hx - k * 0.07, hy - k * 0.14); g.closePath(); g.fill();
    g.strokeStyle = "rgba(8,5,3,0.85)"; g.lineWidth = Math.max(1, k * 0.016); g.lineCap = "round";
    g.beginPath(); g.arc(hx - k * 0.07, hy - k * 0.01, k * 0.04, 0.25, Math.PI - 0.25); g.stroke();
    g.beginPath(); g.arc(hx + k * 0.06, hy - k * 0.02, k * 0.035, 0.25, Math.PI - 0.25); g.stroke();
    g.fillStyle = "rgba(120,70,60,0.6)"; g.beginPath(); g.ellipse(hx - k * 0.005, hy + k * 0.05, k * 0.018, k * 0.012, 0, 0, Math.PI * 2); g.fill();
    /* the lamp along her back and the tops of her ears */
    g.strokeStyle = "rgba(255,200,130,0.26)"; g.lineWidth = Math.max(1, k * 0.014);
    g.beginPath(); g.ellipse(cx, by - k * 0.27, k * 0.53, k * 0.25, 0, Math.PI * 1.1, Math.PI * 1.5); g.stroke();
    g.beginPath(); g.ellipse(hx, hy, k * 0.19, k * 0.15, -0.12, Math.PI * 1.0, Math.PI * 1.4); g.stroke();
    g.beginPath(); g.moveTo(hx - k * 0.19, hy - k * 0.24); g.lineTo(hx - k * 0.17, hy - k * 0.08); g.stroke();
    CAT.cv = c; CAT.ax = cx; CAT.ay = by;
  }

  /* ================= the board ================= */
  var boardTex = null, TEX = null;
  function drawBoard(g) {
    var L = lightB();
    /* the soft shadow on the leather, away from the lamp */
    var shadow = outlineUV(0, 10).map(function (p) { var w = toWorld(p.u, p.v); return project(w.x + 0.28, -BT, w.z + 0.34); });
    g.save();
    g.shadowColor = "rgba(0,0,0,0.85)"; g.shadowBlur = project(0, 0, 0).s * 0.5;
    polyPath(g, shadow); g.fillStyle = "rgba(0,0,0,0.6)"; g.fill();
    g.restore();
    /* the board's sides: the near ones face the camera */
    var top = outlineUV(0, 12), cam = { x: 0, y: CAM_D * SIN, z: CAM_D * COS };
    for (var i = 0; i < top.length; i++) {
      var a = top[i], b = top[(i + 1) % top.length];
      var wa = toWorld(a.u, a.v), wb = toWorld(b.u, b.v);
      var nx = wb.z - wa.z, nz = -(wb.x - wa.x);              /* outward normal of a counter-clockwise outline */
      var mx = (wa.x + wb.x) / 2, mz = (wa.z + wb.z) / 2;
      if (orientationSign() * (nx * (cam.x - mx) + nz * (cam.z - mz)) <= 0) continue;
      var q = [project(wa.x, 0, wa.z), project(wb.x, 0, wb.z), project(wb.x, -BT, wb.z), project(wa.x, -BT, wa.z)];
      var nl = Math.hypot(nx, nz) || 1, lit = 0.5 + 0.5 * orientationSign() * (-(nx / nl) * LIGHT_W.x - (nz / nl) * LIGHT_W.z);
      var sg = g.createLinearGradient(0, q[0].y, 0, q[3].y);
      sg.addColorStop(0, rgba(mix([58, 32, 18], [120, 74, 42], lit * 0.6), 1));
      sg.addColorStop(1, rgba(mix([22, 12, 7], [40, 24, 14], lit), 1));
      g.fillStyle = sg; polyPath(g, q); g.fill();
      g.strokeStyle = g.fillStyle; g.lineWidth = 0.8; g.stroke();
    }
    /* end grain lines on the sides, faint */
    /* the carved top, painted flat and laid onto the plane */
    var ext = portrait ? { X0: -HALF_V - 0.02, X1: HALF_V + 0.02, Z0: -HALF_U - 0.02, Z1: HALF_U + 0.02 }
                       : { X0: -HALF_U - 0.02, X1: HALF_U + 0.02, Z0: -HALF_V - 0.02, Z1: HALF_V + 0.02 };
    var ppu = Math.min(4096 / (ext.X1 - ext.X0), 4096 / (ext.Z1 - ext.Z0), maxScale() * dpr * 1.05);
    boardTex = paintBoardTop(ext, ppu, L);
    TEX = ext;
    g.save(); g.setTransform(1, 0, 0, 1, 0, 0);
    mapPlane(g, boardTex, ext.X0, ext.X1, ext.Z0, ext.Z1, 0);
    g.restore();
    /* the oiled finish: a broad, soft reflection of the lamp across the top */
    var poly = outlineScreen(0, 0.02);
    boardPoly = poly;
    g.save(); polyPath(g, poly); g.clip();
    var hp = toWorld(portrait ? -2.2 : -1.8, portrait ? 0.2 : -0.5), hs = project(hp.x, 0, hp.z);
    var sheen = g.createRadialGradient(hs.x, hs.y, 0, hs.x, hs.y, hs.s * 3.6);
    sheen.addColorStop(0, "rgba(255,196,130,0.2)"); sheen.addColorStop(0.45, "rgba(255,180,120,0.07)"); sheen.addColorStop(1, "rgba(255,180,120,0)");
    g.globalCompositeOperation = "lighter"; g.fillStyle = sheen; g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = "source-over";
    g.restore();
    /* the rounded-over edge of the top catches the lamp along the far side */
    g.save();
    polyPath(g, outlineScreen(0, 0.015));
    g.strokeStyle = "rgba(255,214,166,0.22)"; g.lineWidth = Math.max(1, project(0, 0, 0).s * 0.012); g.stroke();
    g.restore();
  }
  /* +1 when the board's outline runs counter-clockwise in world x/z, -1 when the
     portrait turn has mirrored it */
  function orientationSign() {
    var a = toWorld(1, 0), b = toWorld(0, 1);
    return a.x * b.z - a.z * b.x > 0 ? 1 : -1;
  }

  /* Paint the board top in board coordinates: walnut, its figure and pores, the
     carved border groove, brass and pewter inlay, and the cups. */
  function paintBoardTop(ext, ppu, L) {
    var tw = Math.ceil((ext.X1 - ext.X0) * ppu), th = Math.ceil((ext.Z1 - ext.Z0) * ppu);
    var c = document.createElement("canvas"); c.width = tw; c.height = th;
    var g = c.getContext("2d");
    /* board (u, v) -> texture pixels */
    if (portrait) g.setTransform(0, ppu, -ppu, 0, -ext.X0 * ppu, -ext.Z0 * ppu);
    else g.setTransform(ppu, 0, 0, ppu, -ext.X0 * ppu, -ext.Z0 * ppu);
    var px = 1 / ppu;
    function outline(inset) { var o = outlineUV(inset, 14); g.beginPath(); o.forEach(function (p, i) { if (i) g.lineTo(p.u, p.v); else g.moveTo(p.u, p.v); }); g.closePath(); }

    g.save();
    outline(0); g.clip();
    /* the walnut: deep, with warmer streaks running the length of the board */
    var base = g.createLinearGradient(0, -HALF_V, 0, HALF_V);
    base.addColorStop(0, "#2a1209"); base.addColorStop(0.5, "#401c0d"); base.addColorStop(1, "#2c130a");
    g.fillStyle = base; g.fillRect(-HALF_U, -HALF_V, HALF_U * 2, HALF_V * 2);
    /* broad bands of heartwood color */
    for (var bnd = 0; bnd < 7; bnd++) {
      var bv = -HALF_V + srnd(bnd * 4.3) * HALF_V * 2, bw = 0.1 + srnd(bnd * 7.1) * 0.35;
      var col = srnd(bnd * 2.9) > 0.5 ? "rgba(184,84,36,0.16)" : "rgba(12,4,2,0.26)";
      g.fillStyle = col;
      g.beginPath();
      for (var uu = -HALF_U; uu <= HALF_U + 0.01; uu += 0.2) g.lineTo(uu, bv + Math.sin(uu * 0.7 + bnd) * 0.12);
      for (var uu2 = HALF_U; uu2 >= -HALF_U - 0.01; uu2 -= 0.2) g.lineTo(uu2, bv + bw + Math.sin(uu2 * 0.7 + bnd + 0.4) * 0.12);
      g.closePath(); g.fill();
    }
    /* grain lines */
    g.lineCap = "round";
    for (var i = 0; i < 230; i++) {
      var v0 = -HALF_V - 0.2 + srnd(i * 1.91) * (HALF_V * 2 + 0.4);
      var a1 = 0.02 + srnd(i * 3.7) * 0.06, f1 = 0.4 + srnd(i * 5.3) * 0.9, p1 = srnd(i * 8.1) * 6.28;
      var a2 = 0.005 + srnd(i * 6.1) * 0.015, f2 = 3 + srnd(i * 2.2) * 5;
      var dark = srnd(i * 4.4) > 0.42;
      g.strokeStyle = dark ? "rgba(10,3,1," + (0.14 + srnd(i * 9.9) * 0.24).toFixed(3) + ")" : (srnd(i * 3.3) > 0.8 ? "rgba(226,130,64," : "rgba(186,90,42,") + (0.04 + srnd(i * 9.1) * 0.1).toFixed(3) + ")";
      g.lineWidth = (dark ? 0.6 + srnd(i * 7.7) * 2.2 : 1.6 + srnd(i * 7.7) * 4) * px;
      g.beginPath();
      for (var u = -HALF_U - 0.1; u <= HALF_U + 0.1; u += 0.08) {
        var v = v0 + a1 * Math.sin(u * f1 + p1) + a2 * Math.sin(u * f2 + i);
        if (u === -HALF_U - 0.1) g.moveTo(u, v); else g.lineTo(u, v);
      }
      g.stroke();
    }
    /* cathedral figure: nested arches where the log was cut through a growth ring */
    [[-1.2, -0.1, 1], [2.1, 0.25, -1]].forEach(function (fg, fi) {
      for (var j = 1; j <= 14; j++) {
        var ra = 0.12 * j, rb = 0.035 * j;
        g.strokeStyle = j % 2 ? "rgba(12,5,2,0.16)" : "rgba(150,86,44,0.10)";
        g.lineWidth = (1 + (j % 3)) * px;
        g.beginPath();
        for (var t = -1; t <= 1.001; t += 0.05) {
          var uu3 = fg[0] + fg[2] * (ra * (1 - t * t) - 0.5), vv3 = fg[1] + t * (0.25 + rb * 3);
          if (t === -1) g.moveTo(uu3, vv3); else g.lineTo(uu3, vv3);
        }
        g.stroke();
      }
    });
    /* pores */
    g.fillStyle = "rgba(6,2,1,0.32)";
    for (var p = 0; p < 2600; p++) {
      var pu = -HALF_U + srnd(p * 0.71 + 9) * HALF_U * 2, pv = -HALF_V + srnd(p * 1.33 + 4) * HALF_V * 2;
      g.fillRect(pu, pv, (1.5 + srnd(p) * 4) * px, 0.9 * px);
    }
    /* the carved border groove: a V cut, dark on the lamp side, lit on the other */
    outline(0.17); g.strokeStyle = "rgba(8,3,1,0.62)"; g.lineWidth = 3 * px; g.stroke();
    g.save(); g.translate(-L.u * 1.6 * px, -L.v * 1.6 * px);
    outline(0.17); g.strokeStyle = "rgba(220,150,96,0.22)"; g.lineWidth = 1.4 * px; g.stroke();
    g.restore();
    /* the edge rounded over: lighter along the rim on the lamp side, darker away */
    var eg = g.createLinearGradient(L.u * HALF_U, L.v * HALF_V, -L.u * HALF_U, -L.v * HALF_V);
    eg.addColorStop(0, "rgba(255,200,150,0.18)"); eg.addColorStop(0.5, "rgba(255,200,150,0.0)"); eg.addColorStop(1, "rgba(0,0,0,0.35)");
    outline(0.03); g.strokeStyle = eg; g.lineWidth = 0.07; g.stroke();
    /* brass diamonds inlaid down the middle, between the pit columns */
    for (var d = -3; d <= 3; d++) inlayDiamond(g, d, 0, 0.075, px, L, "brass");
    /* each store is ringed with inlay: brass for side 0, pewter for side 1 */
    [6, 13].forEach(function (s) {
      var c0 = slotUV(s), r = slotR(s);
      g.beginPath(); g.ellipse(c0.u, c0.v, r.ru + 0.075, r.rv + 0.06, 0, 0, Math.PI * 2);
      g.strokeStyle = s === 6 ? "rgba(214,166,80,0.7)" : "rgba(168,184,194,0.55)"; g.lineWidth = 2 * px; g.stroke();
    });
    /* the cups */
    for (var k = 0; k < 14; k++) carveCup(g, k, L, px);
    g.restore();
    return c;
  }

  function inlayDiamond(g, u, v, r, px, L, kind) {
    g.beginPath(); g.moveTo(u, v - r * 1.4); g.lineTo(u + r, v); g.lineTo(u, v + r * 1.4); g.lineTo(u - r, v); g.closePath();
    var dg = g.createLinearGradient(u + L.u * r, v + L.v * r, u - L.u * r, v - L.v * r);
    if (kind === "brass") { dg.addColorStop(0, "#ffe2a0"); dg.addColorStop(0.5, "#c8923e"); dg.addColorStop(1, "#6e4612"); }
    else { dg.addColorStop(0, "#eef4f6"); dg.addColorStop(0.5, "#a8b6be"); dg.addColorStop(1, "#4c565c"); }
    g.fillStyle = dg; g.fill();
    g.strokeStyle = "rgba(20,8,2,0.6)"; g.lineWidth = 1 * px; g.stroke();
  }

  /* A cup cut into the walnut. The wall on the lamp side faces away from the light
     and sits in the rim's shadow; the far wall faces the lamp and glows. */
  function carveCup(g, i, L, px) {
    var c0 = slotUV(i), r = slotR(i), cu = c0.u, cv = c0.v, ru = r.ru, rv = r.rv;
    /* which way is "away from the camera" on the board */
    var F = portrait ? { u: -1, v: 0 } : { u: 0, v: -1 };
    function cup(sc, du, dv) { g.beginPath(); g.ellipse(cu + (du || 0), cv + (dv || 0), ru * sc, rv * sc, 0, 0, Math.PI * 2); }
    g.save();
    /* a little bevel around the lip */
    cup(1.07);
    var lg = g.createLinearGradient(cu + F.u * ru, cv + F.v * rv, cu - F.u * ru, cv - F.v * rv);
    lg.addColorStop(0, "rgba(0,0,0,0.4)"); lg.addColorStop(0.5, "rgba(0,0,0,0.1)"); lg.addColorStop(1, "rgba(255,196,136,0.2)");
    g.fillStyle = lg; g.fill();
    cup(1); g.clip();
    /* the floor: end grain, dark, warmer toward the middle */
    var fl = g.createRadialGradient(cu - F.u * ru * 0.15, cv - F.v * rv * 0.15, 0, cu, cv, Math.max(ru, rv) * 1.05);
    fl.addColorStop(0, isStore(i) ? "#3a1a0b" : "#3c1b0c"); fl.addColorStop(0.65, "#22100a"); fl.addColorStop(1, "#0e0603");
    g.fillStyle = fl; g.fillRect(cu - ru, cv - rv, ru * 2, rv * 2);
    /* gouge marks, following the curve of the cup */
    for (var k = 1; k < 9; k++) {
      var sc = k / 9;
      g.strokeStyle = k % 2 ? "rgba(255,190,130,0.045)" : "rgba(0,0,0,0.12)";
      g.lineWidth = 1.2 * px;
      g.beginPath(); g.ellipse(cu, cv, ru * sc, rv * sc, 0, srnd(i * 7 + k) * 6, srnd(i * 7 + k) * 6 + 2.2 + srnd(k + i) * 2); g.stroke();
    }
    /* light: the wall on the lamp side is in shade, the wall facing the lamp glows */
    var sh = g.createLinearGradient(cu + L.u * ru, cv + L.v * rv, cu - L.u * ru, cv - L.v * rv);
    sh.addColorStop(0, "rgba(0,0,0,0.6)"); sh.addColorStop(0.45, "rgba(0,0,0,0.08)"); sh.addColorStop(0.8, "rgba(255,160,100,0.06)"); sh.addColorStop(1, "rgba(255,186,124,0.2)");
    g.fillStyle = sh; g.fillRect(cu - ru, cv - rv, ru * 2, rv * 2);
    /* the far wall, seen face on from this camera: a band as tall as the cup is deep,
       in shade, darkest at the rim and on the lamp side */
    var rf = F.u ? ru : rv, dep = Math.min(0.6, (r.d * COS / SIN) / rf * 1.15);
    g.beginPath();
    g.ellipse(cu, cv, ru * 1.1, rv * 1.1, 0, 0, Math.PI * 2);
    g.ellipse(cu - F.u * ru * dep, cv - F.v * rv * dep, ru * 1.0, rv * 1.0, 0, 0, Math.PI * 2, true);
    var wg = g.createLinearGradient(cu + F.u * rf, cv + F.v * rf, cu + F.u * rf * (1 - 2 * dep), cv + F.v * rf * (1 - 2 * dep));
    wg.addColorStop(0, "rgba(3,1,0,0.82)"); wg.addColorStop(0.7, "rgba(12,4,1,0.5)"); wg.addColorStop(1, "rgba(30,12,4,0.25)");
    g.fillStyle = wg; g.fill("evenodd");
    var wl = g.createLinearGradient(cu + L.u * ru, cv + L.v * rv, cu - L.u * ru, cv - L.v * rv);
    wl.addColorStop(0, "rgba(0,0,0,0.25)"); wl.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = wl; g.fill("evenodd");
    /* the rim's cast shadow on the lamp side */
    var off = isStore(i) ? 0.5 : 0.34;
    g.beginPath();
    g.ellipse(cu, cv, ru * 1.2, rv * 1.2, 0, 0, Math.PI * 2);
    g.ellipse(cu - L.u * Math.min(ru, rv) * off, cv - L.v * Math.min(ru, rv) * off, ru * 1.0, rv * 1.0, 0, 0, Math.PI * 2, true);
    g.fillStyle = "rgba(4,1,0,0.4)"; g.fill("evenodd");
    /* the oiled bowl gives back a soft highlight on the wall facing the lamp */
    var hx = cu - L.u * ru * 0.55, hy = cv - L.v * rv * 0.55;
    var hg = g.createRadialGradient(hx, hy, 0, hx, hy, Math.min(ru, rv) * 0.6);
    hg.addColorStop(0, "rgba(255,206,150,0.16)"); hg.addColorStop(1, "rgba(255,206,150,0)");
    g.fillStyle = hg; g.fillRect(cu - ru, cv - rv, ru * 2, rv * 2);
    g.restore();
    /* the lip: the near edge catches the lamp, the far edge falls away dark */
    var a0 = Math.atan2(-F.v / rv, -F.u / ru) + Math.atan2(-L.v, -L.u) * 0.0;
    g.lineCap = "round";
    g.beginPath(); g.ellipse(cu, cv, ru, rv, 0, a0 - 1.2, a0 + 1.2);
    g.strokeStyle = "rgba(255,212,156,0.4)"; g.lineWidth = 1.6 * px; g.stroke();
    g.beginPath(); g.ellipse(cu, cv, ru, rv, 0, a0 + Math.PI - 1.2, a0 + Math.PI + 1.2);
    g.strokeStyle = "rgba(0,0,0,0.55)"; g.lineWidth = 2 * px; g.stroke();
  }

  /* ================= the beads ================= */
  var beads = [], slots = [], order = 0;
  for (var si = 0; si < 14; si++) slots.push([]);

  function makeBeads() {
    beads = [];
    var gems = [];
    for (var g = 0; g < GEMS.length; g++) for (var k = 0; k < 6; k++) gems.push(g);
    /* a fixed shuffle, so every pit starts with a mix */
    for (var i = gems.length - 1; i > 0; i--) { var j = (srnd(i * 3.7 + 1) * (i + 1)) | 0; var t = gems[i]; gems[i] = gems[j]; gems[j] = t; }
    for (var b = 0; b < 48; b++) {
      beads.push({ id: b, gem: gems[b], vr: b % VARIANTS, tone: 0.93 + srnd(b * 5.1) * 0.14, size: 0.95 + srnd(b * 2.3) * 0.1,
        slot: -1, u: 0, v: 0, y: 0, vu: 0, vv: 0, lay: 0, order: 0, state: "rest", wake: 0, fly: null, hand: null });
    }
  }
  function cap(i) { return isStore(i) ? 13 : 6; }
  function bowl(i, du, dv) {
    var r = slotR(i), q = (du * du) / (r.ru * r.ru) + (dv * dv) / (r.rv * r.rv);
    return -r.d * (1 - Math.min(1, q));
  }
  function relayer(i) {
    var list = slots[i];
    list.sort(function (a, b) { return a.order - b.order; });
    for (var k = 0; k < list.length; k++) list[k].lay = Math.floor(k / cap(i));
  }
  function placeRest(b, i, u, v, y) {
    b.slot = i; b.state = "rest"; b.u = u; b.v = v; b.y = y; b.vu = 0; b.vv = 0; b.fly = null; b.hand = null;
    b.order = ++order;
    slots[i].push(b);
    relayer(i);
    wakeSlot(i);
  }
  function takeFrom(b) {
    var list = slots[b.slot];
    if (list) { var k = list.indexOf(b); if (k >= 0) list.splice(k, 1); relayer(b.slot); wakeSlot(b.slot); }
    b.slot = -1;
  }
  function wakeSlot(i) { slots[i].forEach(function (b) { b.wake = 70; }); }
  function landingSpot(i) {
    var c = slotUV(i), r = slotR(i), a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * 0.42;
    return { u: c.u + Math.cos(a) * r.ru * d, v: c.v + Math.sin(a) * r.rv * d * (isStore(i) ? 1.4 : 1) };
  }
  function restHeight(i, b) {
    var c = slotUV(i);
    return bowl(i, b.u - c.u, b.v - c.v) + b.lay * BH * 0.78;
  }
  function deal() {
    for (var i = 0; i < 14; i++) slots[i] = [];
    var n = 0;
    for (var p = 0; p < 14; p++) {
      if (isStore(p)) continue;
      for (var k = 0; k < 4; k++) {
        var b = beads[n++], s = landingSpot(p);
        placeRest(b, p, s.u, s.v, 0);
      }
    }
    for (var it = 0; it < 160; it++) physics(1 / 60, true);
    beads.forEach(function (b) { if (b.state === "rest") b.y = restHeight(b.slot, b); });
  }

  /* Resting beads settle into a pile: pulled to the bottom of the cup, pushed apart
     by their neighbors, damped. A higher layer is pulled harder to the middle, so a
     crowded pit heaps up. Only pits that something just happened to are simulated. */
  function physics(dt, force) {
    for (var i = 0; i < 14; i++) {
      var list = slots[i];
      if (!list.length) continue;
      var awake = force;
      for (var a = 0; a < list.length; a++) if (list[a].wake > 0) { awake = true; break; }
      if (!awake) continue;
      var c = slotUV(i), r = slotR(i), maxV = 0;
      var ru = r.ru - BR * 0.85, rv = r.rv - BR * 0.85;
      for (var p = 0; p < list.length; p++) {
        var b = list[p], du = b.u - c.u, dv = b.v - c.v, kp = 2.2 + b.lay * 2.6;
        b.vu += -du * kp * dt * 6; b.vv += -dv * kp * dt * 6;
      }
      for (var x = 0; x < list.length; x++) {
        var b1 = list[x];
        for (var y = x + 1; y < list.length; y++) {
          var b2 = list[y], ld = Math.abs(b1.lay - b2.lay);
          if (ld > 1) continue;
          var minD = BR * (ld ? 1.15 : 1.96) * (b1.size + b2.size) * 0.5;
          var du2 = b2.u - b1.u, dv2 = b2.v - b1.v, d = Math.sqrt(du2 * du2 + dv2 * dv2);
          if (d >= minD) continue;
          if (d < 1e-4) { du2 = Math.random() - 0.5; dv2 = Math.random() - 0.5; d = Math.sqrt(du2 * du2 + dv2 * dv2) || 1; }
          var push = (minD - d) / d * 0.5 * (ld ? 0.35 : 1);
          b1.u -= du2 * push; b1.v -= dv2 * push; b2.u += du2 * push; b2.v += dv2 * push;
          b1.vu -= du2 * push * 4; b1.vv -= dv2 * push * 4; b2.vu += du2 * push * 4; b2.vv += dv2 * push * 4;
        }
      }
      var damp = Math.pow(0.02, dt);
      for (var q = 0; q < list.length; q++) {
        var bb = list[q];
        bb.vu *= damp; bb.vv *= damp;
        bb.u += bb.vu * dt; bb.v += bb.vv * dt;
        var eu = (bb.u - c.u) / ru, ev = (bb.v - c.v) / rv, e2 = eu * eu + ev * ev;
        if (e2 > 1) { var sc = 1 / Math.sqrt(e2); bb.u = c.u + (bb.u - c.u) * sc; bb.v = c.v + (bb.v - c.v) * sc; bb.vu *= 0.3; bb.vv *= 0.3; }
        var yt = restHeight(i, bb);
        bb.y += (yt - bb.y) * Math.min(1, dt * 12);
        var sp = Math.abs(bb.vu) + Math.abs(bb.vv) + Math.abs(yt - bb.y) * 4;
        if (sp > maxV) maxV = sp;
        if (bb.wake > 0) bb.wake--;
      }
      if (maxV > 0.02) list.forEach(function (o) { if (o.wake < 8) o.wake = 8; });
    }
  }
  function jostle(i, k) {
    slots[i].forEach(function (b) { b.vu += (Math.random() - 0.5) * k; b.vv += (Math.random() - 0.5) * k; b.wake = 50; });
  }

  /* where a bead is in the world right now */
  function beadWorld(b) { var w = toWorld(b.u, b.v); return { x: w.x, y: b.y, z: w.z }; }

  /* ================= the sowing: a timeline =================
     A move is a list of timed events (lift the handful, carry it pit to pit, drop a
     bead in each, glow and pour a capture, sweep the rows at the end) running on its
     own clock, so a tap can run it at 3x or finish it at once. Beads in the air are
     flights on the same clock. */
  var anim = null;
  var hand = { on: false, u: 0, v: 0, y: 0, beads: [], segs: [], t0: 0 };

  function newAnim(done) {
    anim = { clock: 0, events: [], flights: [], speed: 1, instant: false, done: done, quiet: false };
    return anim;
  }
  function ev(at, fn) { anim.events.push({ at: at, fn: fn, fired: false }); }

  function speedUp() {
    if (!anim) return;
    if (anim.instant) return;
    if (anim.speed < 2) { anim.speed = 3; if (!told.hurry) { told.hurry = true; note("Faster. Tap again to finish it", 1400); } }
    else { anim.instant = true; flushInstant(); }
  }

  /* Run everything left on the clock now. Landings stay silent; one settle sound
     at the end stands in for them all. */
  function flushInstant() {
    var a = anim;
    a.quiet = true;
    var guard = 0;
    while (anim === a && guard++ < 5000) {
      a.flights.slice().forEach(function (f) { finishFlight(f); });
      a.flights = [];
      var next = null;
      for (var i = 0; i < a.events.length; i++) if (!a.events[i].fired && (!next || a.events[i].at < next.at)) next = a.events[i];
      if (!next) break;
      a.clock = Math.max(a.clock, next.at);
      next.fired = true; next.fn();
    }
    if (anim === a) {
      a.flights.slice().forEach(function (f) { finishFlight(f); });
      a.flights = [];
      endAnim();
    }
    A.drop({ fill: 0.7, v: 0.7, pan: 0 });
  }

  function stepAnim(dt) {
    var a = anim;
    if (!a) return;
    if (a.instant) return;
    var adv = dt * a.speed;
    a.clock += adv;
    a.events.sort(function (x, y) { return x.at - y.at; });
    for (var i = 0; i < a.events.length; i++) {
      var e = a.events[i];
      if (!e.fired && e.at <= a.clock) { e.fired = true; e.fn(); if (anim !== a) return; }
    }
    for (var k = a.flights.length - 1; k >= 0; k--) {
      var f = a.flights[k];
      if (f.delay > 0) { f.delay -= adv; if (f.delay > 0) continue; }
      f.t += adv / f.dur;
      if (f.t >= 1) { a.flights.splice(k, 1); finishFlight(f); continue; }
      moveFlight(f);
    }
    if (a.events.every(function (e) { return e.fired; }) && !a.flights.length) endAnim();
  }
  function endAnim() {
    var a = anim;
    anim = null; hand.on = false; hand.beads = [];
    if (a && a.done) a.done();
  }

  /* a bead's path through the air, from where it is to a point on a slot */
  function fly(b, to, dur, arc, delay, land) {
    /* a bead is only ever on one path: a new one replaces any it is still on */
    if (b.fly && anim) { var ix = anim.flights.indexOf(b.fly); if (ix >= 0) anim.flights.splice(ix, 1); }
    var f = { b: b, a: { u: b.u, v: b.v, y: b.y }, to: to, t: 0, dur: Math.max(1, dur), arc: arc, delay: delay || 0, land: land };
    b.state = "fly"; b.fly = f;
    anim.flights.push(f);
    return f;
  }
  function moveFlight(f) {
    var b = f.b, t = Math.max(0, Math.min(1, f.t)), e = ease(t);
    var to = typeof f.to === "function" ? f.to() : f.to;
    b.u = f.a.u + (to.u - f.a.u) * e; b.v = f.a.v + (to.v - f.a.v) * e;
    b.y = f.a.y + (to.y - f.a.y) * e + Math.sin(Math.PI * t) * f.arc;
  }
  function finishFlight(f) {
    var to = typeof f.to === "function" ? f.to() : f.to;
    f.b.u = to.u; f.b.v = to.v; f.b.y = to.y; f.b.fly = null;
    if (f.land) f.land(f.b);
  }

  /* the handful: beads ride the hand in a little clump */
  function handOffsets(n) {
    var out = [];
    for (var k = 0; k < n; k++) {
      var a = k * 2.39996, r = BR * 0.78 * Math.sqrt(k);
      out.push({ u: Math.cos(a) * r, v: Math.sin(a) * r * 0.9, y: Math.floor(k / 7) * BH * 0.75 + (k % 2) * BH * 0.2 });
    }
    return out;
  }
  function handPos() { return { u: hand.u, v: hand.v, y: hand.y }; }
  function stepHand() {
    if (!hand.on || !anim) return;
    var t = anim.clock, s = null;
    for (var i = 0; i < hand.segs.length; i++) if (t >= hand.segs[i].t0) s = hand.segs[i];
    if (!s) return;
    var k = Math.min(1, (t - s.t0) / Math.max(1, s.t1 - s.t0)), e = ease(k);
    hand.u = s.a.u + (s.b.u - s.a.u) * e; hand.v = s.a.v + (s.b.v - s.a.v) * e;
    hand.y = 0.9 + Math.sin(Math.PI * k) * s.arc;
    var offs = handOffsets(hand.beads.length);
    hand.beads.forEach(function (b, idx) {
      if (b.state !== "hand" || !b.hand) return;
      var o = offs[idx], bob = reduced() ? 0 : Math.sin(t / 140 + b.id) * 0.012;
      b.hand.u += (o.u - b.hand.u) * 0.2; b.hand.v += (o.v - b.hand.v) * 0.2; b.hand.y += (o.y - b.hand.y) * 0.2;
      b.u = hand.u + b.hand.u; b.v = hand.v + b.hand.v; b.y = hand.y + b.hand.y + bob;
    });
  }

  /* Which beads go where, decided before anything moves, from the slots as they
     are: the handful is the whole pit; it drops in that order; a capture takes
     everything in the captured pits; the sweep takes each row. Stored with the move
     so the replay moves the very same beads. */
  function planMove(rec) {
    var mem = slots.map(function (l) { return l.map(function (b) { return b.id; }); });
    var scoop = mem[rec.pit].slice();
    /* the top of the pile comes up first */
    scoop.sort(function (a, b) { return beads[b].lay - beads[a].lay || beads[a].order - beads[b].order; });
    mem[rec.pit] = [];
    var drops = [];
    rec.path.forEach(function (to, k) { drops.push(scoop[k]); mem[to].push(scoop[k]); });
    var caps = rec.caps.map(function (c) { var ids = mem[c.pit].slice(); mem[c.pit] = []; ids.forEach(function (id) { mem[c.to].push(id); }); return { pit: c.pit, to: c.to, ids: ids }; });
    var sweep = rec.end ? rec.end.sweep.map(function (s) { var ids = mem[s.pit].slice(); mem[s.pit] = []; ids.forEach(function (id) { mem[s.to].push(id); }); return { pit: s.pit, to: s.to, ids: ids }; }) : [];
    return { scoop: scoop, drops: drops, caps: caps, sweep: sweep, counts: mem.map(function (l) { return l.length; }) };
  }

  /* Build and run a move's timeline. opts.live: a real move (callouts, sounds, the
     opponent's quips); otherwise a replay step. */
  function animateMove(rec, plan, opts, done) {
    newAnim(done);
    var fast = reduced();
    var origin = rec.pit, oc = slotUV(origin);
    var scoopBeads = plan.scoop.map(function (id) { return beads[id]; });
    var side = rec.side;
    /* 1. the handful comes up */
    var LIFT = fast ? 1 : 260;
    hand.on = true; hand.u = oc.u; hand.v = oc.v; hand.y = 0.9; hand.beads = scoopBeads.slice(); hand.segs = [{ t0: 0, t1: 1, a: oc, b: oc, arc: 0 }];
    ev(0, function () {
      if (!anim.quiet) A.scoop(scoopBeads.length, panOfSlot(origin));
      var offs = handOffsets(scoopBeads.length);
      scoopBeads.forEach(function (b, k) {
        takeFrom(b);
        b.hand = { u: offs[k].u, v: offs[k].v, y: offs[k].y };
        var tgt = function () { return { u: hand.u + b.hand.u, v: hand.v + b.hand.v, y: hand.y + b.hand.y }; };
        var stag = fast ? 0 : k * 6;
        fly(b, tgt, LIFT - stag, 0.12, stag, function () { if (b.hand) b.state = "hand"; });
      });
    });
    /* 2. carried pit to pit, one bead into each */
    var t = LIFT + 20, prev = oc;
    rec.path.forEach(function (to, k) {
      var c = slotUV(to), dist = Math.hypot(c.u - prev.u, c.v - prev.v);
      var dur = fast ? 1 : 95 + 62 * Math.min(2.2, dist);
      hand.segs.push({ t0: t, t1: t + dur, a: prev, b: c, arc: 0.1 + Math.min(0.14, dist * 0.05) });
      var dropAt = t + dur * 0.62;
      (function (to, k) {
        ev(dropAt, function () {
          var b = beads[plan.drops[k]];
          var idx = hand.beads.indexOf(b);
          if (idx >= 0) hand.beads.splice(idx, 1);
          b.hand = null;
          var spot = landingSpot(to);
          b.state = "fly";
          var fill = slots[to].length;
          fly(b, { u: spot.u, v: spot.v, y: bowl(to, spot.u - slotUV(to).u, spot.v - slotUV(to).v) + Math.floor(fill / cap(to)) * BH * 0.78 },
            fast ? 1 : 170, 0.05, 0, function () {
              placeRest(b, to, b.u, b.v, b.y);
              jostle(to, 0.25);
              if (!anim || !anim.quiet) A.drop({ fill: Math.min(1, fill / 8), store: isStore(to), v: 0.65 + Math.random() * 0.3, pan: panOfSlot(to), tone: b.tone });
              if (k === rec.path.length - 1 && opts.live) lastLanded(rec, plan);
            });
        });
      })(to, k);
      t += dur;
      prev = c;
    });
    var tEnd = t + (fast ? 1 : 200);
    /* 3. captures */
    if (plan.caps.length) {
      var tc = tEnd + (fast ? 1 : 160);
      ev(tc, function () {
        plan.caps.forEach(function (c) { glowSlots[c.pit] = { t: 0, side: side }; });
        if (opts.live) captured(rec, plan);
        else if (!anim.quiet) A.capture(panOfSlot(plan.caps[0].to));
      });
      var tp = tc + (fast ? 1 : 420), n = 0;
      plan.caps.forEach(function (c, ci) {
        var ids = c.ids;
        ev(tp + ci * (fast ? 0 : 160), function () {
          if (!anim.quiet) A.pour(ids.length, 0.5, panOfSlot(c.to));
          pourInto(ids, c.to, fast);
        });
        n += ids.length;
      });
      tEnd = fast ? tp + 260 : tp + plan.caps.length * 160 + n * 34 + 600;
    }
    /* 4. the sweep at the end */
    if (plan.sweep.length) {
      var ts = tEnd + (fast ? 1 : 520);
      ev(ts - (fast ? 0 : 300), function () { if (opts.live) sweeping(rec); });
      var byStore = {};
      plan.sweep.forEach(function (s) { (byStore[s.to] = byStore[s.to] || []).push.apply(byStore[s.to], s.ids); });
      Object.keys(byStore).forEach(function (st, k) {
        ev(ts + k * (fast ? 0 : 260), function () {
          if (!anim.quiet) A.pour(byStore[st].length, 0.7, panOfSlot(+st));
          pourInto(byStore[st], +st, fast);
        });
      });
      var sw = 0; plan.sweep.forEach(function (x) { sw += x.ids.length; });
      tEnd = fast ? ts + 320 : ts + 300 + sw * 34 + 650;
    }
    ev(tEnd, function () {});
  }

  function pourInto(ids, to, fast) {
    ids.forEach(function (id, k) {
      var b = beads[id];
      if (b.slot >= 0) takeFrom(b);
      var spot = landingSpot(to);
      fly(b, function () { return { u: spot.u, v: spot.v, y: bowl(to, spot.u - slotUV(to).u, spot.v - slotUV(to).v) + Math.floor(slots[to].length / cap(to)) * BH * 0.78 }; },
        fast ? 1 : 460 + Math.random() * 80, 0.55 + Math.random() * 0.25, fast ? 0 : k * 34, function () {
          var fill = slots[to].length;
          placeRest(b, to, b.u, b.v, b.y);
          jostle(to, 0.18);
          if (!anim || !anim.quiet) A.drop({ fill: Math.min(1, 0.25 + fill / 20), store: true, v: 0.55 + Math.random() * 0.35, pan: panOfSlot(to), tone: b.tone });
          if (!reduced()) sparkle(to, b.gem, 3);
        });
    });
  }

  /* ================= live-move moments ================= */
  function lastLanded(rec, plan) {
    if (rec.extra && !rec.end) {
      pulseSlot = K.storeOf(rec.side); pulseT = 1; pulseSide = rec.side;
      A.again(panOfSlot(pulseSlot));
      flash(mode === "solo" && rec.side === 1 ? shortName(foe) + " goes again" : "Again!", rec.side === 1 && mode === "solo" ? "them" : "side" + rec.side);
      if (mode === "solo" && rec.side === 1) say(foe.quips.again);
      sparkle(pulseSlot, -1, 10);
    }
    if (rec.grand) note("Grand slam: it would take every seed they have, so it takes none", 2600);
  }
  function captured(rec, plan) {
    var n = 0;
    plan.caps.forEach(function (c) { n += c.ids.length; });
    A.capture(panOfSlot(plan.caps[0].to));
    plan.caps.forEach(function (c) { sparkle(c.pit, -1, 8); });
    var who = rec.side;
    if (mode === "solo") {
      if (who === 0) flash("You take " + n, "side0");
      else { flash(shortName(foe) + " takes " + n, "them"); say(foe.quips.capture); }
    } else flash((who === 0 ? "Player 1" : "Player 2") + " takes " + n, "side" + who);
  }
  function sweeping(rec) {
    var r = rec.end;
    if (!r) return;
    note(endLine(r, true), 2600);
  }

  /* ================= per-frame drawing ================= */
  var frameT = 0, frameDt = 16, lastT = performance.now();
  function draw(now) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (sceneCv) ctx.drawImage(sceneCv, 0, 0, sceneCv.width, sceneCv.height, 0, 0, W, H);
    drawRain(now);
    drawPatch(frameDt);
    drawCat(now);
    drawMarks(now);
    drawBeads(now);
    drawCounts();
    drawTags(now);
    drawParticles();
    drawMotes();
  }

  /* --- rain running down the pane --- */
  var runs = [], streaks = [];
  function drawRain(now) {
    if (!WIN) return;
    var w = WIN;
    ctx.save();
    ctx.beginPath(); ctx.rect(w.x, w.y, w.w, w.h); ctx.clip();
    if (!reduced()) {
      /* rain falling outside, seen through the glass */
      ctx.strokeStyle = "rgba(170,190,230,0.10)"; ctx.lineWidth = 1;
      ctx.beginPath();
      for (var i = 0; i < streaks.length; i++) {
        var s = streaks[i];
        var x = w.x + s.x * w.w, y = w.y + ((s.y + now * s.v) % 1.2 - 0.1) * w.h;
        ctx.moveTo(x, y); ctx.lineTo(x - s.l * 0.18, y + s.l);
      }
      ctx.stroke();
    }
    /* drops running down the glass, each leaving a clearer trail */
    for (var r = 0; r < runs.length; r++) {
      var d = runs[r], dx = w.x + d.x * w.w, dy = w.y + d.y * w.h;
      ctx.strokeStyle = "rgba(190,210,240,0.10)"; ctx.lineWidth = d.r * 1.1;
      ctx.beginPath(); ctx.moveTo(dx, dy); ctx.lineTo(dx + d.wob, Math.max(w.y, dy - d.trail * w.h)); ctx.stroke();
      ctx.fillStyle = "rgba(8,14,24,0.55)"; ctx.beginPath(); ctx.ellipse(dx, dy - d.r * 0.2, d.r, d.r * 1.25, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "rgba(230,238,255,0.5)"; ctx.beginPath(); ctx.ellipse(dx, dy + d.r * 0.4, d.r * 0.7, d.r * 0.45, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }
  function stepRain(dt) {
    if (!WIN || reduced()) return;
    for (var i = runs.length - 1; i >= 0; i--) {
      var d = runs[i];
      if (d.pause > 0) { d.pause -= dt; continue; }
      d.y += d.v * dt / 1000; d.trail = Math.min(0.5, d.trail + d.v * dt / 1000);
      d.wob = Math.sin(d.y * 30 + d.x * 9) * 1.5;
      if (Math.random() < 0.01) d.pause = 120 + Math.random() * 600;
      if (d.y > 1.05) runs.splice(i, 1);
    }
    if (runs.length < 7 && Math.random() < 0.02) runs.push({ x: 0.04 + Math.random() * 0.92, y: Math.random() * 0.5, v: 0.05 + Math.random() * 0.12, r: 1.2 + Math.random() * 1.6, trail: 0, wob: 0, pause: 0 });
  }
  function seedRain() {
    streaks = [];
    for (var i = 0; i < 40; i++) streaks.push({ x: Math.random(), y: Math.random(), v: 0.0009 + Math.random() * 0.0007, l: 6 + Math.random() * 12 });
  }

  function drawCat(now) {
    if (!CAT || !CAT.cv) return;
    var k = 1 / dpr, br = reduced() ? 0 : Math.sin(now / 1000 * 1.25) * 0.018;
    var w = CAT.cv.width * k, h = CAT.cv.height * k;
    ctx.save();
    ctx.translate(CAT.x, CAT.top + 2);
    ctx.scale(1 + br * 0.4, 1 + br);
    ctx.drawImage(CAT.cv, -CAT.ax * k, -CAT.ay * k, w, h);
    ctx.restore();
  }

  function ringSlot(i, scale, color, width, dash, offset) {
    var w = slotWorld(i), rw = slotRW(i), p = project(w.x, 0.005, w.z);
    ctx.save();
    ctx.strokeStyle = color; ctx.lineWidth = width;
    if (dash) { ctx.setLineDash(dash); ctx.lineDashOffset = offset || 0; }
    ctx.beginPath(); ctx.ellipse(p.x, p.y, rw.rx * p.s * scale, rw.rz * p.s * SIN * scale, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }
  function fillSlot(i, scale, color) {
    var w = slotWorld(i), rw = slotRW(i), p = project(w.x, 0.005, w.z);
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.ellipse(p.x, p.y, rw.rx * p.s * scale, rw.rz * p.s * SIN * scale, 0, 0, Math.PI * 2); ctx.fill();
  }
  function glowSlot(i, a, rgb) {
    var w = slotWorld(i), rw = slotRW(i), p = project(w.x, 0, w.z);
    var rx = rw.rx * p.s * 1.25, ry = rw.rz * p.s * SIN * 1.25;
    ctx.save();
    ctx.translate(p.x, p.y); ctx.scale(1, ry / rx);
    var gr = ctx.createRadialGradient(0, 0, rx * 0.2, 0, 0, rx);
    gr.addColorStop(0, "rgba(" + rgb + "," + (0.5 * a).toFixed(3) + ")"); gr.addColorStop(0.7, "rgba(" + rgb + "," + (0.22 * a).toFixed(3) + ")"); gr.addColorStop(1, "rgba(" + rgb + ",0)");
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(0, 0, rx, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  var P1RGB = "255,196,110", P2RGB = "127,214,196", BADRGB = "255,120,120";
  function sideRGB(side) { return mode === "solo" ? (side === 0 ? P1RGB : "196,176,255") : side === 0 ? P1RGB : P2RGB; }

  /* the preview: where the seeds of the pit under the finger would go */
  var pvKey = "", pv = null;
  function previewFor(pit) {
    if (pit < 0) return null;
    var key = pit + ":" + K.keyOf(pos.b, pos.turn);
    if (key !== pvKey) { pvKey = key; pv = K.preview(pos, pit); }
    return pv;
  }

  function drawMarks(now) {
    var t = now / 1000;
    var hs = humanSide();
    /* the side to move: its playable pits wear a soft ring in its color */
    if (hs >= 0) {
      var legal = K.legal(pos), rgb = sideRGB(hs), duo = mode === "duo";
      legal.forEach(function (p) {
        var a = (duo ? 0.55 : 0.32) + 0.14 * Math.sin(t * 2.6 + p);
        if (duo) glowSlot(p, 0.28 + 0.08 * Math.sin(t * 2.6 + p), rgb);
        ringSlot(p, 1.08, "rgba(" + rgb + "," + a.toFixed(3) + ")", duo ? 2.4 : 1.6);
      });
      /* two players: the mover's store glows too, so the whole side reads as theirs */
      if (duo) ringSlot(K.storeOf(hs), 1.04, "rgba(" + rgb + "," + (0.45 + 0.12 * Math.sin(t * 2.6)).toFixed(3) + ")", 2.4);
    }
    /* the regular reaching for a pit */
    if (reachPit >= 0) {
      var ra = Math.min(1, (now - reachT) / 260);
      glowSlot(reachPit, ra * 0.9, sideRGB(1));
      ringSlot(reachPit, 1.1, "rgba(" + sideRGB(1) + "," + (0.8 * ra).toFixed(3) + ")", 2.2);
    }
    /* hover / press preview */
    var pp = (press && !press.cancelled) ? press.pit : hoverPit >= 0 ? hoverPit : cursor >= 0 && hs >= 0 ? cursor : -1;
    if (pp >= 0 && hs >= 0 && !K.whyNot(pos, pp)) {
      var pr = previewFor(pp), rgb2 = sideRGB(hs);
      if (pr) {
        glowSlot(pp, 0.85, rgb2);
        ringSlot(pp, 1.1, "rgba(" + rgb2 + ",0.95)", 2.4);
        /* the trail: every cup a seed will reach wears a rim of light, brighter where more land */
        pr.path.forEach(function (i, k) {
          var n = pr.counts[i], a = Math.min(1, 0.4 + n * 0.2) * (0.55 + 0.45 * Math.max(0, Math.sin(t * 5 - k * 0.55)));
          glowSlot(i, a * 0.45, rgb2);
          ringSlot(i, 1.03, "rgba(" + rgb2 + "," + (a * 0.8).toFixed(3) + ")", 1.8);
        });
        var good = pr.extra || pr.taken > 0;
        ringSlot(pr.last, good ? 1.0 + 0.04 * Math.sin(t * 6) : 0.98, good ? "rgba(255,236,170,1)" : "rgba(" + rgb2 + ",0.9)", good ? 3 : 2, [6, 5], -t * 26);
        if (pr.taken > 0) pr.caps.forEach(function (c) { glowSlot(c.pit, 0.6 + 0.2 * Math.sin(t * 5), "255,226,150"); });
      }
    }
    /* the hint */
    if (hintPit >= 0 && hs >= 0) {
      glowSlot(hintPit, 0.55 + 0.25 * Math.sin(t * 4), "255,236,180");
      ringSlot(hintPit, 1.12, "rgba(255,240,196,0.95)", 2.4, [7, 5], -t * 30);
    }
    /* the keyboard cursor */
    if (cursor >= 0 && hs >= 0 && pp !== cursor) ringSlot(cursor, 1.16, "rgba(255,240,200,0.9)", 2, [5, 4]);
    /* a refused pit */
    if (shakeSlot >= 0 && shakeT > 0) glowSlot(shakeSlot, shakeT, BADRGB);
    /* captures glowing as they go */
    Object.keys(glowSlots).forEach(function (k) {
      var g = glowSlots[k];
      glowSlot(+k, Math.max(0, 1 - g.t), "255,226,150");
      ringSlot(+k, 1.05, "rgba(255,236,170," + Math.max(0, 1 - g.t).toFixed(3) + ")", 2.4);
    });
    /* the store that just earned another turn */
    if (pulseSlot >= 0 && pulseT > 0) {
      glowSlot(pulseSlot, pulseT, sideRGB(pulseSide));
      ringSlot(pulseSlot, 1.0 + (1 - pulseT) * 0.25, "rgba(" + sideRGB(pulseSide) + "," + pulseT.toFixed(3) + ")", 2.5);
    }
  }

  /* --- the beads, back to front --- */
  var drawList = [];
  function drawBeads(now) {
    drawList.length = 0;
    for (var i = 0; i < beads.length; i++) {
      var b = beads[i], w = beadWorld(b);
      b._x = w.x; b._z = w.z; b._d = w.y * SIN + w.z * COS;
      drawList.push(b);
    }
    drawList.sort(function (a, c) { return a._d - c._d; });
    /* shadows, then the colored light, then the glass */
    var ss = shadowSp;
    for (var k = 0; k < drawList.length; k++) {
      var b1 = drawList[k], lift = Math.max(0, b1.y + 0.02);
      var floor = b1.state === "rest" ? b1.y - b1.lay * BH * 0.78 : -0.04;
      var p = project(b1._x + 0.07 + lift * 0.3, floor, b1._z + 0.06 + lift * 0.24), sc = p.s / spriteRef / dpr * b1.size * (1 + lift * 0.6);
      ctx.globalAlpha = Math.max(0.12, 0.85 - lift * 0.9) * (b1.lay ? 0.6 : 1);
      ctx.drawImage(ss.cv, p.x - ss.ax * sc, p.y - ss.ay * sc, ss.cv.width * sc, ss.cv.height * sc);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "lighter";
    for (var c = 0; c < drawList.length; c++) {
      var b2 = drawList[c];
      if (b2.state !== "rest" || b2.lay > 1) continue;
      var cs = causticSp[b2.gem], fl2 = b2.y - b2.lay * BH * 0.78;
      var p2 = project(b2._x + BR * 0.62, fl2 + 0.002, b2._z + BR * 0.55), sc2 = p2.s / spriteRef / dpr * b2.size;
      ctx.globalAlpha = b2.lay ? 0.45 : 0.9;
      ctx.drawImage(cs.cv, p2.x - cs.ax * sc2, p2.y - cs.ay * sc2, cs.cv.width * sc2, cs.cv.height * sc2);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    for (var m = 0; m < drawList.length; m++) {
      var b3 = drawList[m], sp = beadSp[b3.gem][b3.vr];
      var p3 = project(b3._x, b3.y, b3._z), sc3 = p3.s / spriteRef / dpr * b3.size * (1 + 0.12 * Math.min(1, Math.max(0, b3.y)));
      ctx.drawImage(sp.cv, p3.x - sp.ax * sc3, p3.y - sp.ay * sc3, sp.cv.width * sc3, sp.cv.height * sc3);
    }
  }

  /* --- seed counts, beside each cup and at each end --- */
  var numCache = {};
  function numSprite(n, px, store) {
    var key = n + ":" + px + (store ? "s" : "");
    var c = numCache[key];
    if (c) return c;
    var f = px * dpr, pad = Math.ceil(f * 0.35);
    c = document.createElement("canvas");
    var g = c.getContext("2d");
    var font = "800 " + f + "px Manrope, system-ui, sans-serif";
    g.font = font;
    var tw = Math.ceil(g.measureText(String(n)).width);
    c.width = tw + pad * 2; c.height = Math.ceil(f * 1.3) + pad;
    g = c.getContext("2d"); g.font = font; g.textAlign = "center"; g.textBaseline = "middle";
    g.lineJoin = "round"; g.lineWidth = Math.max(2, f * 0.22); g.strokeStyle = "rgba(14,7,3,0.82)";
    g.strokeText(String(n), c.width / 2, c.height / 2);
    g.fillStyle = store ? "#f6d593" : "rgba(247,236,217,0.92)";
    g.fillText(String(n), c.width / 2, c.height / 2);
    numCache[key] = c;
    return c;
  }
  function countAt(i) {
    var c = slotUV(i);
    if (isStore(i)) { var e = portrait ? 0.17 : 0.33; return toWorld(c.u > 0 ? HALF_U - e : -HALF_U + e, 0); }
    return toWorld(c.u, c.v > 0 ? HALF_V - 0.22 : -HALF_V + 0.22);
  }
  function drawCounts() {
    if (!showCounts || !started) return;
    for (var i = 0; i < 14; i++) {
      var n = slots[i].length, w = countAt(i), p = project(w.x, 0.01, w.z);
      var px = Math.max(11, Math.round(p.s * (isStore(i) ? 0.27 : 0.2)));
      var sp = numSprite(n, px, isStore(i));
      ctx.drawImage(sp, p.x - sp.width / dpr / 2, p.y - sp.height / dpr / 2, sp.width / dpr, sp.height / dpr);
    }
  }

  /* --- the tag over the landing pit: Again, or how many it takes --- */
  function drawTags(now) {
    var hs = humanSide();
    var pp = (press && !press.cancelled) ? press.pit : hoverPit >= 0 ? hoverPit : cursor >= 0 && hs >= 0 ? cursor : -1;
    if (pp < 0 || hs < 0 || K.whyNot(pos, pp)) return;
    var pr = previewFor(pp);
    if (!pr) return;
    var txt = pr.extra ? "Again" : pr.taken > 0 ? "Takes " + pr.taken : pr.grand ? "No capture" : "";
    if (!txt) return;
    var w = slotWorld(pr.last), rw = slotRW(pr.last), p = project(w.x, 0.3, w.z);
    var ty = p.y - rw.rz * p.s * SIN - 14;
    ctx.save();
    ctx.font = "800 13px Manrope, system-ui, sans-serif";
    var tw = ctx.measureText(txt).width + 18;
    ctx.fillStyle = "rgba(24,14,8,0.88)"; ctx.strokeStyle = "rgba(255,226,160,0.8)"; ctx.lineWidth = 1;
    rrect(ctx, p.x - tw / 2, ty - 12, tw, 24, 12); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#ffe7b0"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(txt, p.x, ty + 0.5);
    ctx.restore();
  }
  function rrect(g, x, y, w, h, r) {
    g.beginPath(); g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.arcTo(x + w, y, x + w, y + r, r); g.lineTo(x + w, y + h - r); g.arcTo(x + w, y + h, x + w - r, y + h, r);
    g.lineTo(x + r, y + h); g.arcTo(x, y + h, x, y + h - r, r); g.lineTo(x, y + r); g.arcTo(x, y, x + r, y, r); g.closePath();
  }

  /* --- sparkle --- */
  function sparkle(i, gem, n) {
    if (reduced()) return;
    var w = slotWorld(i), rw = slotRW(i);
    for (var k = 0; k < n; k++) {
      var col = gem >= 0 ? GEMS[gem].light : GEMS[(Math.random() * GEMS.length) | 0].light;
      particles.push({ x: w.x + (Math.random() - 0.5) * rw.rx * 1.6, z: w.z + (Math.random() - 0.5) * rw.rz * 1.6, y: 0.05 + Math.random() * 0.2,
        vy: 0.25 + Math.random() * 0.5, life: 1, r: 0.6 + Math.random() * 1.6, c: col, tw: Math.random() * 6 });
    }
  }
  function drawParticles() {
    if (!particles.length) return;
    ctx.globalCompositeOperation = "lighter";
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i], s = project(p.x, p.y, p.z);
      var a = Math.max(0, p.life) * (0.6 + 0.4 * Math.sin(p.tw));
      ctx.fillStyle = rgba(p.c, a.toFixed(3));
      ctx.beginPath(); ctx.arc(s.x, s.y, p.r, 0, Math.PI * 2); ctx.fill();
      if (p.r > 1.3) { ctx.fillStyle = rgba(p.c, (a * 0.25).toFixed(3)); ctx.fillRect(s.x - p.r * 3, s.y - 0.5, p.r * 6, 1); ctx.fillRect(s.x - 0.5, s.y - p.r * 3, 1, p.r * 6); }
    }
    ctx.globalCompositeOperation = "source-over";
  }
  function seedMotes() {
    motes = [];
    for (var i = 0; i < 22; i++) motes.push({ x: Math.random(), y: Math.random(), v: 0.015 + Math.random() * 0.04, a: Math.random() * 6.28, r: 0.6 + Math.random() * 1.2 });
  }
  function drawMotes() {
    if (reduced() || !LAMP) return;
    var lp = project(LAMP.wx, -BT, LAMP.wz);
    for (var i = 0; i < motes.length; i++) {
      var m = motes[i];
      var x = lp.x + (m.x - 0.2) * W * 0.5, y = lp.y - H * 0.25 + m.y * H * 0.6;
      var a = 0.1 * Math.sin(m.y * Math.PI) * (0.6 + 0.4 * Math.sin(m.a));
      ctx.fillStyle = "rgba(255,222,170," + a.toFixed(3) + ")";
      ctx.beginPath(); ctx.arc(x, y, m.r, 0, Math.PI * 2); ctx.fill();
    }
  }

  /* ================= the clock ================= */
  var perf = { n: 0, sum: 0, max: 0 };
  function tick(now) {
    var dt = Math.min(48, now - lastT); lastT = now; frameDt = dt;
    stepAnim(dt);
    stepHand();
    physics(Math.min(dt, 32) / 1000, false);
    stepRain(dt);
    for (var j = particles.length - 1; j >= 0; j--) {
      var p = particles[j];
      p.y += p.vy * dt / 1000; p.vy *= 0.985; p.life -= dt / 1100; p.tw += dt / 90;
      if (p.life <= 0) particles.splice(j, 1);
    }
    if (!reduced()) for (var k = 0; k < motes.length; k++) {
      var m = motes[k]; m.y -= m.v * dt / 1000 * 0.4; m.a += dt / 1400; m.x += Math.sin(m.a) * 0.0004;
      if (m.y < 0) { m.y = 1; m.x = Math.random(); }
    }
    Object.keys(glowSlots).forEach(function (k2) { glowSlots[k2].t += dt / 1400; if (glowSlots[k2].t >= 1) delete glowSlots[k2]; });
    if (shakeT > 0) shakeT = Math.max(0, shakeT - dt / 480);
    if (pulseT > 0) pulseT = Math.max(0, pulseT - dt / 1100);
    if (replay && replay.playing && !replay.busy && now > replay.next) stepReplay(1);
    var t0 = performance.now();
    draw(now);
    var ft = performance.now() - t0;
    perf.n++; perf.sum += ft; if (ft > perf.max) perf.max = ft;
    requestAnimationFrame(tick);
  }

  /* ================= input ================= */
  function local(ev) { var r = canvas.getBoundingClientRect(); return { x: ev.clientX - r.left, y: ev.clientY - r.top }; }
  /* the slot under a screen point: a pit's whole cell, out to the board's edge, so
     the target is always bigger than the cup */
  function slotAt(px, py) {
    var w = unproject(px, py, 0), b = toBoard(w.x, w.z);
    if (Math.abs(b.v) > HALF_V + 0.35 || Math.abs(b.u) > HALF_U + 0.3) return -1;
    if (b.u >= STORE_U - STORE_RU - 0.12) return 6;
    if (b.u <= -STORE_U + STORE_RU + 0.12) return 13;
    var col = clamp(Math.round(b.u + 2.5), 0, 5);
    return b.v >= 0 ? col : 12 - col;
  }

  var reasonT = 0;
  function explain(i, why) {
    var other = mode === "solo" ? shortName(foe) : pos.turn === 0 ? "Player 2" : "Player 1";
    if (why === "store") return isStore(i) && K.storeOf(pos.turn) === i ? "That's the store. Sow from a pit on your side" : "Stores aren't sown from";
    if (why === "theirs") return mode === "solo" ? "Those are " + other + "'s pits" : "Those are " + other + "'s pits. Yours glow";
    if (why === "empty") return "That pit is empty";
    if (why === "feed") return other + " has no seeds: you must give " + (mode === "solo" ? himHer(foe) : "them") + " some";
    return null;
  }
  function deny(i, why) {
    A.deny();
    shakeSlot = i; shakeT = 1;
    var msg = explain(i, why);
    if (msg) note(msg, 1900);
  }

  function tryPress(i) {
    if (isStore(i)) { deny(i, "store"); return false; }
    var why = K.whyNot(pos, i);
    if (why) { deny(i, why); return false; }
    return true;
  }

  canvas.addEventListener("pointerdown", function (ev) {
    A.init();
    if (!started) return;
    if (anim) { speedUp(); return; }
    if (replay) return;
    var p = local(ev), i = slotAt(p.x, p.y);
    if (cursor >= 0 && ev.pointerType !== "mouse") cursor = -1;
    var hs = humanSide();
    if (hs < 0 || i < 0) return;
    if (!tryPress(i)) return;
    press = { pit: i, id: ev.pointerId, cancelled: false };
    hintPit = -1;
    A.select(panOfSlot(i));
    try { canvas.setPointerCapture(ev.pointerId); } catch (e) {}
  });
  canvas.addEventListener("pointermove", function (ev) {
    var p = local(ev);
    if (press && ev.pointerId === press.id) {
      if (slotAt(p.x, p.y) !== press.pit) press.cancelled = true;
      return;
    }
    if (ev.pointerType === "mouse") {
      var i = slotAt(p.x, p.y), hs = humanSide();
      var ok = hs >= 0 && i >= 0 && !isStore(i) && !K.whyNot(pos, i);
      if (ok && i !== hoverPit) A.select(panOfSlot(i));
      hoverPit = ok ? i : -1;
      canvas.style.cursor = ok ? "pointer" : "default";
    }
  });
  function endPress(ev) {
    if (!press || ev.pointerId !== press.id) return;
    var pr = press; press = null;
    if (ev.type === "pointercancel" || pr.cancelled) return;
    var p = local(ev);
    if (slotAt(p.x, p.y) === pr.pit && humanSide() >= 0) playPit(pr.pit);
  }
  canvas.addEventListener("pointerup", endPress);
  canvas.addEventListener("pointercancel", endPress);
  canvas.addEventListener("pointerleave", function () { hoverPit = -1; });

  /* the side's pits in screen order: left to right on a wide board, top to bottom on a tall one */
  function screenPits(side) { return side === 0 ? [0, 1, 2, 3, 4, 5] : [12, 11, 10, 9, 8, 7]; }

  /* ================= game flow ================= */
  function playPit(pit) {
    var hs = humanSide();
    if (hs < 0 || K.onRow(pit, hs) === false) return;
    if (!tryPress(pit)) return;
    hoverPit = -1; cursorKeep();
    commit(pit);
  }
  function cursorKeep() { if (cursor >= 0 && K.onRow(cursor, pos.turn) === false) cursor = -1; }

  function snapshot() {
    return beads.map(function (b) { return [b.slot, b.u, b.v, b.lay, b.order]; });
  }
  function restore(snap) {
    for (var i = 0; i < 14; i++) slots[i] = [];
    hand.on = false; hand.beads = [];
    snap.forEach(function (s, id) {
      var b = beads[id];
      b.slot = s[0]; b.u = s[1]; b.v = s[2]; b.lay = s[3]; b.order = s[4]; b.state = "rest"; b.fly = null; b.hand = null; b.vu = 0; b.vv = 0;
      slots[b.slot].push(b);
    });
    for (var k = 0; k < 14; k++) relayer(k);
    beads.forEach(function (b) { b.y = restHeight(b.slot, b); b.wake = 20; });
  }

  /* A move: the rules decide it, the plan says which beads go where, and the
     timeline plays it. Input stays locked from here until the next turn begins. */
  function commit(pit) {
    if (over || anim) return;
    var rec;
    var posBefore = K.clone(pos), snap = snapshot();
    try { rec = K.play(pos, pit); } catch (e) { console.error("mancala: refused", e); return; }
    var plan = planMove(rec);
    history.push({ rec: rec, plan: plan, snap: snap, pos: posBefore });
    hintPit = -1; reachPit = -1; press = null; hoverPit = -1;
    lock++;
    var tok = gameToken;
    animateMove(rec, plan, { live: true }, function () {
      if (tok !== gameToken) return;
      lock--;
      /* the beads must agree with the rules, or something has gone wrong */
      for (var i = 0; i < 14; i++) if (slots[i].length !== pos.b[i]) { console.error("mancala: bead count mismatch at slot " + i, slots[i].length, pos.b[i]); break; }
      afterMove(rec);
    });
    elHintLine.classList.add("is-gone");
    updateBar();
  }

  function afterMove(rec) {
    if (pos.over) { finish(); return; }
    nextTurn(rec && rec.extra ? 220 : 120);
  }

  function nextTurn(delay) {
    updateBar();
    if (over) return;
    if (mode === "solo" && pos.turn === 1) { later(delay || 200, aiTurn); return; }
    /* a human's turn */
    if (pos.rules === "oware" && K.rowSum(pos.b, 1 - pos.turn) === 0) {
      var other = mode === "solo" ? shortName(foe) : pos.turn === 0 ? "Player 2" : "Player 1";
      note(other + " has no seeds left. You must give " + (mode === "solo" ? himHer(foe) : "them") + " some", 2600);
    }
    if (mode === "duo") flash(pos.turn === 0 ? "Player 1" : "Player 2", "side" + pos.turn, 900);
  }

  /* ---------- the regular ---------- */
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
      var res = null;
      try { res = window.MancalaEngine.think(msg); } catch (e) { console.error(e); }
      cb({ type: "bestmove", id: msg.id, pit: res ? res.pit : -1, score: res ? res.score : 0 });
    }
    if (window.MancalaEngine) { setTimeout(go, 20); return; }
    var sc = document.createElement("script");
    sc.src = "engine.js?v=1"; sc.onload = go;
    document.head.appendChild(sc);
  }
  function ask(msg, cb) {
    ensureWorker();
    msg.type = "go"; msg.id = ++reqId;
    var tok = gameToken;
    var done = function (d) { if (tok === gameToken) cb(d); };
    if (!worker) { runLocal(msg, done); return; }
    inflight[msg.id] = { msg: msg, cb: done };
    worker.postMessage(msg);
  }
  function pastPositions() {
    /* positions since the last capture, for the repetition rule */
    var out = [];
    for (var i = history.length - 1; i >= 0; i--) {
      var h = history[i];
      if (h.rec.caps.length) break;
      out.push({ b: Array.from(h.pos.b), turn: h.pos.turn });
    }
    return out;
  }
  function engineMsg(who, timeMs) {
    return { rules: pos.rules, b: Array.from(pos.b), turn: pos.turn, who: who, quiet: pos.quiet, plies: pos.plies,
      past: pos.rules === "oware" ? pastPositions() : [], timeMs: timeMs };
  }

  function aiTurn() {
    if (over || mode !== "solo" || pos.turn !== 1) return;
    thinking = true; updateBar();
    elSay.classList.add("is-think"); elSay.textContent = "thinking";
    var t0 = performance.now();
    ask(engineMsg(foe.id), function (d) {
      thinking = false;
      elSay.classList.remove("is-think"); elSay.textContent = said;
      var pit = d.pit;
      if (pit < 0 || K.whyNot(pos, pit)) {
        var l = K.legal(pos);
        if (!l.length) return;
        console.error("mancala: engine sent an illegal pit", pit);
        pit = l[0];
      }
      /* a considered pause: longer for the stronger regulars, never long */
      var wait = Math.max(0, Math.min(1400, foe.pause) - (performance.now() - t0));
      if (reduced()) wait = Math.min(wait, 200);
      lock++;
      later(wait, function () {
        reachPit = pit; reachT = performance.now();
        A.select(panOfSlot(pit));
        later(reduced() ? 60 : 380, function () { lock--; reachPit = -1; commit(pit); });
      });
      updateBar();
    });
  }

  /* ---------- the end ---------- */
  function endLine(r, during) {
    if (r.reason === "empty") return during ? "A row has run dry: each side banks what is left on its own row" : "The game ends when a row runs dry, and each side banks what is left on its own row.";
    if (r.reason === "25") return during ? "" : "First to 25 seeds takes the game.";
    if (r.reason === "split") return "Twenty-four each: every seed captured, and an even split.";
    if (r.reason === "nofeed") {
      var taker = r.sweep.length && r.sweep[0].to === 13 ? 1 : 0, empty = 1 - taker;
      var tn = sideName(taker), en = sideName(empty);
      var them = empty === 0 && mode === "solo" ? "you" : mode === "duo" ? "them" : himHer(foe);
      return en + (en === "You" ? " had" : " had") + " no seeds, and " + (tn === "You" ? "you" : tn) + " could not give " + them + " any, so " +
        (tn === "You" ? "you take" : tn + " takes") + " every seed left on the board.";
    }
    if (r.reason === "repeat") return "The same position came round a third time, so each side keeps what is on its own row.";
    if (r.reason === "quiet") return "120 moves passed without a capture, so each side keeps what is on its own row.";
    if (r.reason === "stuck") return "The side to move had no seeds at all, so each side keeps what is on its own row.";
    return "";
  }

  function finish() {
    over = true; updateBar();
    finalSnap = snapshot();
    var r = pos.result, s0 = r.scores[0], s1 = r.scores[1];
    var won = r.winner === 0, drawn = r.winner === -1;
    var label = rules === "kalah" ? "Kalah" : "Oware";
    var title, text = "", score = s0 + " – " + s1;
    if (mode === "duo") {
      title = drawn ? "A draw" : r.winner === 0 ? "Player 1 wins" : "Player 2 wins";
      elResLine.textContent = label + " · two players";
      text = drawn ? "Twenty-four seeds each." : "";
      A[drawn ? "draw" : "win"]();
      if (!drawn) confetti(r.winner);
      clearShare();
    } else {
      elResLine.textContent = label + " · against " + foe.name;
      if (drawn) { title = "A draw"; bump(LS.d); A.draw(); text = quote(foe.quips.draw); say(foe.quips.draw); clearShare(); }
      else if (won) {
        title = "You win"; bump(LS.w); recordDefeat(foe.id, rules); A.win(); confetti(0);
        text = quote(foe.quips.lose); say(foe.quips.lose);
        setupShare(s0, s1);
      } else {
        title = shortName(foe) + " wins"; bump(LS.l); A.lose();
        text = quote(foe.quips.win); say(foe.quips.win);
        clearShare();
      }
    }
    elResTitle.textContent = title;
    elResScore.textContent = mode === "duo" ? "Player 1 " + s0 + " – " + s1 + " Player 2" : "You " + s0 + " – " + s1 + " " + shortName(foe);
    elResText.innerHTML = text;
    elResWhy.textContent = endLine(r, false);
    elResSeal.innerHTML = mode === "solo" ? sealSvg(foe, 56) : duoSeal(56);
    elResRecord.textContent = mode === "solo" ? record() : "";
    track("mancala_game_end", { opponent: mode === "solo" ? foe.id : "two_players", rules: rules, mode: mode,
      result: mode === "duo" ? (drawn ? "draw" : r.winner === 0 ? "p1" : "p2") : drawn ? "draw" : won ? "win" : "loss", score: s0 + "-" + s1 });
    later(reduced() ? 300 : 1300, function () { elBar.hidden = true; elResult.hidden = false; });
  }
  function quote(q) { return "<span class=\"result__quote\">“" + q + "”</span>"; }
  function record() {
    return "Record  " + lsGet(LS.w, "0") + "W · " + lsGet(LS.l, "0") + "L · " + lsGet(LS.d, "0") + "D   ·   regulars beaten " + defeated().length + "/12";
  }
  function bump(k) { lsSet(k, String((parseInt(lsGet(k, "0"), 10) || 0) + 1)); }
  function defeated() { try { var l = JSON.parse(lsGet(LS.defeated, "[]")); return Array.isArray(l) ? l : []; } catch (e) { return []; } }
  function recordDefeat(id, rl) {
    var l = defeated(), key = id + ":" + rl;
    if (l.indexOf(key) < 0) l.push(key);
    lsSet(LS.defeated, JSON.stringify(l));
    /* the ticket rule reads this; it only ever goes up, and nothing awards directly */
    var prev = parseInt(lsGet(LS.beaten, "0"), 10) || 0;
    lsSet(LS.beaten, String(Math.max(prev, l.length)));
  }
  function confetti(side) {
    var st = K.storeOf(side);
    for (var i = 0; i < 6; i++) later(i * 150, function () { sparkle(st, -1, 10); });
  }

  /* ---------- hint ---------- */
  function requestHint() {
    var hs = humanSide();
    if (hs < 0) return;
    A.init();
    thinking = true; updateBar();
    elSay.classList.add("is-think"); elSay.textContent = "looking over your pits";
    track("mancala_hint", { opponent: mode === "solo" ? foe.id : "two_players", rules: rules });
    var key = K.keyOf(pos.b, pos.turn);
    ask(engineMsg("adjei", 600), function (d) {
      thinking = false;
      elSay.classList.remove("is-think"); elSay.textContent = said;
      updateBar();
      if (K.keyOf(pos.b, pos.turn) !== key || d.pit < 0) return;
      hintPit = d.pit; A.hint();
      var pr = K.preview(pos, d.pit);
      note(pr && pr.extra ? "Try the glowing pit: it lands in your store" : pr && pr.taken ? "Try the glowing pit: it takes " + pr.taken : "Try the glowing pit", 2000);
    });
  }

  /* ================= replay ================= */
  function enterReplay() {
    if (!history.length) return;
    elResult.hidden = true;
    replay = { k: history.length, playing: false, next: 0, token: 0, busy: false, queued: 0 };
    restore(finalSnap);
    elReplay.hidden = false; elBar.hidden = true;
    track("mancala_replay", { opponent: mode === "solo" ? foe.id : "two_players", rules: rules });
    renderReplay();
  }
  function setReplay(k) {
    if (anim) { anim = null; hand.on = false; hand.beads = []; }
    replay.token++; replay.busy = false; replay.queued = 0;
    replay.k = clamp(k, 0, history.length);
    restore(replay.k >= history.length ? finalSnap : history[replay.k].snap);
    renderReplay();
  }
  function stepReplay(dir) {
    if (!replay) return;
    if (dir < 0) { replay.playing = false; setReplay(replay.k - 1); return; }
    if (replay.k >= history.length) { replay.playing = false; renderReplay(); return; }
    /* a step is over when its last bead has landed; clicks before then queue */
    if (replay.busy) { replay.queued++; return; }
    replay.busy = true;
    var h = history[replay.k], k0 = replay.k, token = replay.token;
    animateMove(h.rec, h.plan, { live: false }, function () {
      if (!replay || replay.token !== token) return;
      replay.k = k0 + 1;
      replay.busy = false;
      replay.next = performance.now() + 700;
      renderReplay();
      if (replay.queued > 0) { replay.queued--; stepReplay(1); }
    });
    renderReplay();
  }
  function exitReplay() {
    if (anim) { anim = null; hand.on = false; hand.beads = []; }
    if (replay) replay.token++;
    replay = null;
    restore(finalSnap);
    elReplay.hidden = true; elResult.hidden = false;
  }
  function renderReplay() {
    if (!replay) return;
    var k = replay.k;
    if (k === 0) elRpLabel.textContent = "Start";
    else {
      var h = history[k - 1].rec;
      var took = 0; h.caps.forEach(function (c) { took += c.n; });
      elRpLabel.textContent = sideName(h.side) + ", pit " + (screenPits(h.side).indexOf(h.pit) + 1) + (h.extra && !h.end ? " · again" : took ? " · took " + took : "");
    }
    elRpCount.textContent = k + " / " + history.length;
    $("rpPlay").textContent = replay.playing ? "Pause" : "Play";
  }

  /* ================= chrome ================= */
  var elOpp = $("opp"), elSeal = $("oppSeal"), elName = $("oppName"), elRole = $("oppRole"), elSay = $("oppSay");
  var elBar = $("bar"), elTurn = $("turn"), elTurnText = $("turnText"), elCallout = $("callout"), elOverlay = $("overlay"), elCast = $("cast");
  var elResult = $("result"), elResTitle = $("resTitle"), elResLine = $("resLine"), elResText = $("resText"), elResScore = $("resScore"),
      elResWhy = $("resWhy"), elResRecord = $("resRecord"), elResSeal = $("resSeal"), elSound = $("soundBtn"), elCounts = $("countsBtn");
  var elReplay = $("replay"), elRpLabel = $("rpLabel"), elRpCount = $("rpCount"), elHintLine = $("hintLine"), elNote = $("note");

  var said = "";
  function say(t) { said = t || ""; if (!elSay.classList.contains("is-think")) elSay.textContent = said; }
  var calloutT = null;
  function flash(t, kind, ms) {
    if (!t) return;
    elCallout.textContent = t;
    elCallout.className = "callout" + (kind === "them" ? " is-bad" : kind === "side1" && mode === "duo" ? " is-p2" : "");
    elCallout.hidden = false; void elCallout.offsetWidth; elCallout.classList.add("is-pop");
    clearTimeout(calloutT); calloutT = setTimeout(function () { elCallout.hidden = true; }, ms || 1300);
  }
  var noteT = null;
  function note(t, ms) {
    if (!t) return;
    elNote.textContent = t; elNote.classList.add("is-on");
    clearTimeout(noteT); noteT = setTimeout(function () { elNote.classList.remove("is-on"); }, ms || 1600);
  }
  function renderOpp() {
    if (mode === "duo") { elSeal.innerHTML = duoSeal(40); elName.textContent = "Player 2"; elRole.textContent = portrait ? "the right-hand row" : "the far row"; say("Pass the device across."); return; }
    elSeal.innerHTML = sealSvg(foe, 40); elName.textContent = foe.name; elRole.textContent = foe.role;
  }

  function updateBar() {
    var txt, cls = "turn";
    if (!started) { txt = ""; }
    else if (over) txt = "Game over";
    else if (mode === "duo") { txt = (pos.turn === 0 ? "Player 1" : "Player 2") + "'s turn"; cls += pos.turn === 0 ? " is-p1" : " is-p2"; if (anim) cls += " is-wait"; }
    else if (pos.turn === 0) { txt = anim ? "Sowing…" : thinking ? "Looking…" : "Your turn"; cls += " is-p1"; if (anim) cls += " is-wait"; }
    else { txt = shortName(foe) + (thinking ? " is thinking" : "'s turn"); cls += " is-wait"; }
    elTurnText.textContent = txt; elTurn.className = cls;
    elOpp.classList.toggle("is-turn", started && !over && pos.turn === 1);
    $("btnHint").disabled = humanSide() < 0;
  }

  /* Each regular gets a little brass medallion with a mark of their life. */
  function sealSvg(f, size) {
    var g = {
      tally: '<path d="M-6-6v12M-3-6v12M0-6v12M3-6v12"/><path d="M-8 4L6-4"/>',
      bus: '<rect x="-7" y="-7" width="14" height="12" rx="2.4"/><path d="M-7-1.6h14"/><path d="M-4.6-4.6h9.2"/><circle cx="-3.8" cy="6.6" r="1.4"/><circle cx="3.8" cy="6.6" r="1.4"/>',
      quill: '<path d="M6.6-7.6C-0.4-6.2-4.6 0-5.6 6.6"/><path d="M6.6-7.6C5 -1.6 0.6 2.4-4.2 3.4"/><path d="M-5.6 6.6l-1.6 1.6"/>',
      grid: '<rect x="-7" y="-7" width="14" height="14" rx="1"/><path d="M-2.3-7v14M2.3-7v14M-7-2.3h14M-7 2.3h14"/><path d="M-7-7h4.7v4.7H-7zM2.3 2.3H7V7H2.3z" fill="currentColor"/>',
      scope: '<path d="M-7 2.4l11-6.4 1.6 2.8-11 6.4z"/><path d="M4-4l2.6-1.5 1.6 2.8-2.6 1.5"/><path d="M-1 4.6l-2.6 4M0.6 4l2.4 4.6"/>',
      key: '<circle cx="-3.6" cy="0" r="3.4"/><path d="M-0.2 0H8M5 0v3M7.4 0v2.2"/>'
    }[f.glyph];
    return '<svg viewBox="-14 -14 28 28" width="' + size + '" height="' + size + '" aria-hidden="true" style="color:' + f.accent + '">' +
      '<defs><radialGradient id="sg' + f.id + size + '" cx="35%" cy="30%" r="80%"><stop offset="0" stop-color="#3a2416"/><stop offset="1" stop-color="#140b06"/></radialGradient></defs>' +
      '<circle cx="0" cy="0" r="13" fill="url(#sg' + f.id + size + ')" stroke="' + f.accent + '" stroke-opacity="0.6" stroke-width="1"/>' +
      '<circle cx="0" cy="0" r="10.6" fill="none" stroke="' + f.accent + '" stroke-opacity="0.24" stroke-width="0.7" stroke-dasharray="1.4 1.4"/>' +
      '<g fill="none" stroke="' + f.accent + '" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round">' + g + "</g></svg>";
  }
  function duoSeal(size) {
    return '<svg viewBox="-14 -14 28 28" width="' + size + '" height="' + size + '" aria-hidden="true">' +
      '<circle cx="0" cy="0" r="13" fill="#140b06" stroke="#7fd6c4" stroke-opacity="0.6" stroke-width="1"/>' +
      '<circle cx="-3.4" cy="0" r="4.4" fill="#f2c46d" fill-opacity="0.85"/><circle cx="3.4" cy="0" r="4.4" fill="#7fd6c4" fill-opacity="0.85"/></svg>';
  }

  /* the first regular not yet beaten at these rules; after that, whoever you played last */
  function defaultFoe() {
    var beaten = defeated();
    for (var i = 0; i < FOES.length; i++) if (beaten.indexOf(FOES[i].id + ":" + rules) < 0) return FOES[i];
    return foeById(lsGet(LS.foe, "adjei"));
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
      var won = "";
      if (beaten.indexOf(f.id + ":kalah") >= 0) won += "<i>Kalah</i>";
      if (beaten.indexOf(f.id + ":oware") >= 0) won += "<i>Oware</i>";
      b.innerHTML = '<span class="foe__seal">' + sealSvg(f, 38) + "</span>" +
        '<span class="foe__name">' + f.name + "</span>" +
        '<span class="foe__role">' + f.role + "</span>" +
        '<span class="foe__pips">' + pips + "</span>" +
        '<span class="foe__trait">' + f.trait + "</span>" +
        (won ? '<span class="foe__won" title="You have beaten ' + f.name + ' at these rules">' + won + "</span>" : "");
      b.setAttribute("data-opt-start", "");
      b.addEventListener("click", function () { picked = f; start(); });
      elCast.appendChild(b);
    });
    paintGo();
  }
  function paintGo() {
    $("ovBtn").textContent = mode === "duo" ? "Start a two-player game" : "Sit down with " + shortName(picked);
    $("firstMe").textContent = mode === "duo" ? "Player 1 starts" : "You start";
    $("firstThem").textContent = mode === "duo" ? "Player 2 starts" : "They start";
    elCast.hidden = mode === "duo"; $("castLabel").hidden = mode === "duo";
  }
  var RULES_NOTE = {
    kalah: "Sow into your own store as you pass it. Land there and you go again; land in an empty pit on your side and take what is across.",
    oware: "Stores only hold captures. Make a pit on their side 2 or 3 with your last seed and take it, and the pits before it. First to 25."
  };
  function wireOptions() {
    function paint() {
      Array.prototype.forEach.call(document.querySelectorAll("[data-rules]"), function (b) { b.setAttribute("aria-checked", b.getAttribute("data-rules") === rules ? "true" : "false"); });
      Array.prototype.forEach.call(document.querySelectorAll("[data-first]"), function (b) { b.setAttribute("aria-checked", +b.getAttribute("data-first") === firstPref ? "true" : "false"); });
      $("rulesNote").textContent = RULES_NOTE[rules];
      $("countsSwitch").setAttribute("aria-checked", showCounts ? "true" : "false");
      $("duoSwitch").setAttribute("aria-checked", mode === "duo" ? "true" : "false");
      elCounts.setAttribute("aria-pressed", showCounts ? "true" : "false");
    }
    Array.prototype.forEach.call(document.querySelectorAll("[data-rules]"), function (b) {
      b.addEventListener("click", function () { rules = b.getAttribute("data-rules"); lsSet(LS.rules, rules); picked = null; buildCast(); paint(); A.init(); A.select(0); });
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-first]"), function (b) {
      b.addEventListener("click", function () { firstPref = +b.getAttribute("data-first"); lsSet(LS.first, String(firstPref)); paint(); });
    });
    $("countsSwitch").addEventListener("click", function () { setCounts(!showCounts); paint(); });
    $("duoSwitch").addEventListener("click", function () { mode = mode === "duo" ? "solo" : "duo"; paint(); paintGo(); });
    $("ovBtn").addEventListener("click", start);
    paint();
    wireOptions.paint = paint;
  }
  function setCounts(v) {
    showCounts = !!v; lsSet(LS.counts, showCounts ? "1" : "0");
    elCounts.setAttribute("aria-pressed", showCounts ? "true" : "false");
    if (wireOptions.paint) wireOptions.paint();
  }

  function start() {
    A.init();
    elOverlay.classList.add("is-out");
    setTimeout(function () { elOverlay.hidden = true; elOverlay.classList.remove("is-out"); }, 240);
    newGame(mode === "solo" ? picked.id : null);
  }

  function newGame(foeId) {
    gameToken++; lock = 0; anim = null; hand.on = false; hand.beads = []; thinking = false;
    if (foeId) { foe = foeById(foeId); lsSet(LS.foe, foe.id); }
    pos = K.start(rules, firstPref);
    history = []; finalSnap = null; over = false; started = true; replay = null;
    hintPit = -1; reachPit = -1; press = null; hoverPit = -1; cursor = -1; glowSlots = {}; particles = [];
    clearShare();
    deal();
    renderOpp();
    if (mode === "solo") say(rules === "oware" ? foe.quips.startO : foe.quips.start);
    elOpp.hidden = false; elBar.hidden = false; elResult.hidden = true; elReplay.hidden = true;
    document.body.classList.add("is-playing");
    A.startBed();
    track("mancala_game_start", { opponent: mode === "solo" ? foe.id : "two_players", rules: rules, mode: mode,
      first: mode === "solo" ? (firstPref === 0 ? "you" : "them") : (firstPref === 0 ? "p1" : "p2") });
    updateBar();
    if (mode === "solo" && pos.turn === 1) later(700, aiTurn);
    else flash(mode === "duo" ? "Player " + (pos.turn + 1) + " starts" : "Your move", mode === "duo" ? "side" + pos.turn : "side0", 1100);
  }

  function showCast() {
    gameToken++; lock = 0; anim = null; hand.on = false; hand.beads = []; thinking = false;
    if (replay) replay.token++;
    replay = null; started = false; over = false;
    elResult.hidden = true; elReplay.hidden = true; elBar.hidden = true; elOpp.hidden = true;
    pos = K.start(rules, 0); deal();
    picked = null; buildCast(); elOverlay.hidden = false;
    document.body.classList.remove("is-playing");
  }

  $("btnNew").addEventListener("click", function () {
    var b = $("btnNew");
    if (started && !over && history.length && b.getAttribute("data-sure") !== "1") {
      b.setAttribute("data-sure", "1"); b.textContent = "Sure?";
      setTimeout(function () { b.removeAttribute("data-sure"); b.textContent = "New game"; }, 2600);
      return;
    }
    b.removeAttribute("data-sure"); b.textContent = "New game";
    showCast();
  });
  $("btnHint").addEventListener("click", requestHint);
  $("btnAgain").addEventListener("click", function () { elResult.hidden = true; newGame(mode === "solo" ? foe.id : null); });
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
  elCounts.addEventListener("click", function () { setCounts(!showCounts); });

  /* ---------- keyboard ----------
     1-6 sow the side to move's pits in screen order; arrows walk a cursor over them
     and Enter sows it; Space or Enter during a sowing hurries it. It is a real way to
     play, and it is how the tests and the card pose drive the board. */
  window.addEventListener("keydown", function (e) {
    var k = e.key;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (replay) {
      if (k === "ArrowLeft") { e.preventDefault(); stepReplay(-1); }
      else if (k === "ArrowRight") { e.preventDefault(); replay.playing = false; stepReplay(1); }
      else if (k === "Home") setReplay(0);
      else if (k === "End") setReplay(history.length);
      else if (k === " ") { e.preventDefault(); $("rpPlay").click(); }
      else if (k === "Escape") exitReplay();
      return;
    }
    if (!started || over) return;
    if (k === "m" || k === "M") { elSound.click(); return; }
    if (k === "c" || k === "C") { setCounts(!showCounts); return; }
    if (anim && (k === " " || k === "Enter")) { e.preventDefault(); speedUp(); return; }
    var hs = humanSide();
    if (k === "h" || k === "H") { requestHint(); return; }
    if (k === "n" || k === "N") { $("btnNew").click(); return; }
    if (hs < 0) return;
    var order = screenPits(hs);
    if (/^[1-6]$/.test(k)) { e.preventDefault(); A.init(); cursor = -1; playPit(order[+k - 1]); return; }
    if (k === "ArrowLeft" || k === "ArrowRight" || k === "ArrowUp" || k === "ArrowDown") {
      e.preventDefault();
      var dir = (k === "ArrowRight" || k === "ArrowDown") ? 1 : -1;
      var at = order.indexOf(cursor);
      at = at < 0 ? (dir > 0 ? 0 : 5) : clamp(at + dir, 0, 5);
      cursor = order[at];
      A.select(panOfSlot(cursor));
      return;
    }
    if (k === "Enter" || k === " ") {
      if (document.activeElement && document.activeElement.tagName === "BUTTON") return;
      e.preventDefault(); A.init();
      if (cursor < 0 || !K.onRow(cursor, hs)) { cursor = order[0]; return; }
      playPit(cursor);
      return;
    }
    if (k === "Escape") cursor = -1;
  });

  /* ---------- share ---------- */
  function clearShare() { window.OPT_SHARE_TEXT = undefined; window.OPT_SHARE_LINE = undefined; window.OPT_SHARE_IMAGE = undefined; }
  function setupShare(s0, s1) {
    var label = rules === "kalah" ? "Kalah" : "Oware";
    window.OPT_SHARE_TEXT = "I beat " + foe.name + " at Mancala (" + label + "), " + s0 + " to " + s1 + ". " + foe.name + " " + foe.role + ".";
    window.OPT_SHARE_LINE = "Beat " + foe.name + " at " + label + ", " + s0 + " to " + s1;
    window.OPT_SHARE_IMAGE = function () {
      var xs = boardPoly.map(function (p) { return p.x; }), ys = boardPoly.map(function (p) { return p.y; });
      var x0 = Math.max(0, Math.min.apply(null, xs) - 24), x1 = Math.min(W, Math.max.apply(null, xs) + 24);
      var y0 = Math.max(0, Math.min.apply(null, ys) - 40), y1 = Math.min(H, Math.max.apply(null, ys) + 40);
      var w = (x1 - x0) * dpr, h = (y1 - y0) * dpr;
      var out = document.createElement("canvas"); out.width = Math.round(w); out.height = Math.round(h);
      out.getContext("2d").drawImage(canvas, x0 * dpr, y0 * dpr, w, h, 0, 0, w, h);
      return out;
    };
  }

  /* ---------- automation handle (tests and the card pose only) ---------- */
  if (navigator.webdriver) {
    window.__mancala = {
      state: function () {
        return { b: Array.from(pos.b), turn: pos.turn, rules: pos.rules, mode: mode, over: over, started: started,
          busy: busy(), anim: !!anim, speed: anim ? (anim.instant ? "now" : anim.speed) : 0, thinking: thinking,
          legal: K.legal(pos), human: humanSide(), hint: hintPit, history: history.length, cursor: cursor,
          replay: replay ? replay.k : -1, replayBusy: replay ? replay.busy : false, counts: slots.map(function (l) { return l.length; }),
          showCounts: showCounts, result: pos.result ? { scores: pos.result.scores, winner: pos.result.winner, reason: pos.result.reason } : null,
          resultShown: !elResult.hidden, portrait: portrait, perf: { n: perf.n, avg: perf.n ? perf.sum / perf.n : 0, max: perf.max },
          log: history.map(function (h) { return [h.rec.side, h.rec.pit, h.rec.n, h.rec.extra ? 1 : 0, h.rec.caps.length, h.rec.grand ? 1 : 0]; }) };
      },
      center: function (i) { var w = slotWorld(i), p = project(w.x, 0, w.z); return { x: p.x, y: p.y }; },
      pitSize: function (i) { var w = slotWorld(i), rw = slotRW(i), p = project(w.x, 0, w.z); return { w: rw.rx * 2 * p.s, h: rw.rz * 2 * p.s * SIN, cellW: (portrait ? 1.0 : 1.0) * p.s }; },
      resetPerf: function () { perf = { n: 0, sum: 0, max: 0 }; },
      note: function () { return elNote.classList.contains("is-on") ? elNote.textContent : ""; },
      expect: function () { return replay ? Array.from(replay.k < history.length ? history[replay.k].pos.b : pos.b) : null; },
      /* tests only: load a position (same 48 beads, dealt to match) to reach rare rules */
      setup: function (b, turn) {
        if (!started || busy()) return false;
        pos.b = Int8Array.from(b); pos.turn = turn; pos.reps = {}; pos.reps[K.keyOf(pos.b, pos.turn)] = 1; pos.quiet = 0;
        for (var i = 0; i < 14; i++) slots[i] = [];
        var n = 0;
        for (var j = 0; j < 14; j++) for (var k = 0; k < b[j]; k++) { var bd = beads[n++], sp = landingSpot(j); placeRest(bd, j, sp.u, sp.v, 0); }
        for (var it = 0; it < 120; it++) physics(1 / 60, true);
        updateBar(); nextTurn(50);
        return true;
      }
    };
  }

  /* ---------- boot ---------- */
  makeBeads();
  wireOptions();
  buildCast();
  seedMotes();
  seedRain();
  window.addEventListener("resize", resize);
  resize();
  deal();
  requestAnimationFrame(tick);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { numCache = {}; });
  setTimeout(function () { elHintLine.classList.add("is-gone"); }, 9000);
})();
