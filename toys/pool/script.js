/* Pool — top-down pocket billiards with real 2D rolling physics.
 * Drag back from the cue ball to aim + set power; add spin; sink the balls.
 * Two modes: solo clear-the-table (fewest shots) and pass-and-play 8-ball.
 * Vanilla Canvas 2D + Web Audio. */
(function () {
  "use strict";

  // ---- tunables ----
  var MAXV = 1650;             // px/s at full power (scaled by table size at runtime)
  var FRIC = 2.2;              // rolling friction (per second, exponential)
  var STOP = 7;                // speed below which a ball is parked (px/s, scaled)
  var BALL_REST = 0.955;       // ball-ball restitution
  var CUSH_REST = 0.72;        // cushion restitution
  var FOLLOW = 0.62, ENGLISH = 0.44;   // spin transfer factors
  var MAXPULL_FRAC = 0.34;     // full power at this fraction of the table's long side

  var canvas = document.getElementById("canvas");
  var ctx = canvas.getContext("2d");
  var hudMsg = document.getElementById("hudMsg");
  var hudSub = document.getElementById("hudSub");
  var hintEl = document.getElementById("hint");
  var overlay = document.getElementById("overlay");
  var ovTitle = document.getElementById("ovTitle");
  var ovText = document.getElementById("ovText");
  var ovBtn = document.getElementById("ovBtn");
  var modeBtn = document.getElementById("modeBtn");
  var newBtn = document.getElementById("newBtn");
  var soundBtn = document.getElementById("soundBtn");
  var spinBall = document.getElementById("spinBall");
  var spinDot = document.getElementById("spinDot");

  var W, H, DPR, R, PLAY, TABLE, RAIL, POCKR, pockets = [], portrait = false, scaleV = 1;
  var tableCanvas = document.createElement("canvas");
  var tctx = tableCanvas.getContext("2d");

  var COLORS = {
    1: "#e8b31f", 2: "#1c50b0", 3: "#c22f22", 4: "#5f2e91", 5: "#df6a1e", 6: "#1c8347", 7: "#7c2a1a",
    8: "#161616",
    9: "#e8b31f", 10: "#1c50b0", 11: "#c22f22", 12: "#5f2e91", 13: "#df6a1e", 14: "#1c8347", 15: "#7c2a1a"
  };
  function ballType(n) { return n === 0 ? "cue" : n === 8 ? "eight" : n <= 7 ? "solid" : "stripe"; }

  // ---- state ----
  var balls = [];             // {n, x, y, vx, vy, potted, dropT, color}
  var cue = null;
  var mode = "solo";
  var phase = "aiming";       // aiming | shooting | placing | over
  var chalk = [], confetti = [];
  var spin = { x: 0, y: 0 };
  var aiming = false, aimX = 0, aimY = 0;
  var shotPotted = [], shotContact = null, cueScratch = false, cueSpinPending = null;
  var settleT = 0;

  // solo
  var strokes = 0, best = 0;
  // 8-ball
  var players = [{ group: null }, { group: null }], turn = 0, open = true, winner = -1, ballInHand = false;

  try { best = parseInt(localStorage.getItem("pool_best"), 10) || 0; } catch (e) {}

  // ---- geometry ----
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.floor(W * DPR); canvas.height = Math.floor(H * DPR);
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

    portrait = H > W;
    var availLong = (portrait ? H : W) - 40;
    var availShort = (portrait ? W : H) - 96;      // leave room for HUD/buttons
    var tLong = Math.min(availLong, availShort * 2);
    var tShort = tLong / 2;
    var tw = portrait ? tShort : tLong, th = portrait ? tLong : tShort;
    TABLE = { x: (W - tw) / 2, y: (H - th) / 2, w: tw, h: th };
    RAIL = Math.max(16, tShort * 0.075);
    PLAY = { x: TABLE.x + RAIL, y: TABLE.y + RAIL, w: tw - 2 * RAIL, h: th - 2 * RAIL };
    PLAY.cx = PLAY.x + PLAY.w / 2; PLAY.cy = PLAY.y + PLAY.h / 2;
    R = Math.min(PLAY.w, PLAY.h) * 0.0265;
    POCKR = R * 1.78;
    scaleV = Math.min(PLAY.w, PLAY.h) / 300;
    // 6 pockets: 4 corners + 2 on the long sides
    var lx = PLAY.x, rx = PLAY.x + PLAY.w, ty = PLAY.y, by = PLAY.y + PLAY.h;
    pockets = [{ x: lx, y: ty }, { x: rx, y: ty }, { x: lx, y: by }, { x: rx, y: by }];
    if (portrait) { pockets.push({ x: lx, y: PLAY.cy }, { x: rx, y: PLAY.cy }); }
    else { pockets.push({ x: PLAY.cx, y: ty }, { x: PLAY.cx, y: by }); }
    buildTable();
  }

  // length axis points from head end toward foot end; width axis is across
  function tp(lengthFrac, widthPx) {
    if (portrait) return { x: PLAY.cx + widthPx, y: PLAY.y + (1 - lengthFrac) * PLAY.h };
    return { x: PLAY.x + lengthFrac * PLAY.w, y: PLAY.cy + widthPx };
  }
  function lenDir() { return portrait ? { x: 0, y: -1 } : { x: 1, y: 0 }; }
  function widDir() { return portrait ? { x: 1, y: 0 } : { x: 0, y: 1 }; }

  // ---- rack ----
  function shuffle(a) { for (var i = a.length - 1; i > 0; i--) { var j = (Math.random() * (i + 1)) | 0, t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function rack() {
    balls = [];
    var apex = tp(0.70, 0);
    var ld = lenDir(), wd = widDir(), gap = 2 * R + 0.5;
    var rowStep = gap * 0.866;   // √3/2
    // ball numbers: 8 in the centre, rest shuffled (casual rack)
    var others = shuffle([1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15]);
    var slots = [];
    for (var r = 0; r <= 4; r++) for (var k = 0; k <= r; k++) slots.push({ r: r, k: k });
    var oi = 0;
    slots.forEach(function (s) {
      var isCentre = s.r === 2 && s.k === 1;
      var n = isCentre ? 8 : others[oi++];
      var px = apex.x + ld.x * (s.r * rowStep) + wd.x * ((s.k - s.r / 2) * gap);
      var py = apex.y + ld.y * (s.r * rowStep) + wd.y * ((s.k - s.r / 2) * gap);
      balls.push({ n: n, x: px, y: py, vx: 0, vy: 0, potted: false, dropT: 0, color: COLORS[n], stripe: n >= 9, band: Math.random() * Math.PI });
    });
    var head = tp(0.25, 0);
    cue = { n: 0, x: head.x, y: head.y, vx: 0, vy: 0, potted: false, dropT: 0, color: "#fbfaf5", inHand: false };
    balls.push(cue);
  }

  function newGame(startShooting) {
    rack();
    chalk = []; confetti = [];
    strokes = 0; open = true; winner = -1; ballInHand = false; turn = 0;
    players = [{ group: null }, { group: null }];
    phase = "aiming";
    spin = { x: 0, y: 0 }; updateSpinDot();
    updateHud();
  }

  // ---- table render (cached) ----
  function roundRect(c, x, y, w, h, r) {
    c.beginPath(); c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
  }
  function buildTable() {
    tableCanvas.width = W * DPR; tableCanvas.height = H * DPR;
    tctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    tctx.clearRect(0, 0, W, H);
    // room floor
    var fg = tctx.createRadialGradient(PLAY.cx, PLAY.cy, 0, PLAY.cx, PLAY.cy, Math.max(W, H) * 0.7);
    fg.addColorStop(0, "#12160f"); fg.addColorStop(1, "#070a06");
    tctx.fillStyle = fg; tctx.fillRect(0, 0, W, H);
    // wooden frame
    tctx.save();
    tctx.shadowColor = "rgba(0,0,0,0.6)"; tctx.shadowBlur = 40; tctx.shadowOffsetY = 16;
    roundRect(tctx, TABLE.x, TABLE.y, TABLE.w, TABLE.h, RAIL * 0.7);
    var wg = tctx.createLinearGradient(TABLE.x, TABLE.y, TABLE.x, TABLE.y + TABLE.h);
    wg.addColorStop(0, "#4a2f1a"); wg.addColorStop(0.5, "#3a2413"); wg.addColorStop(1, "#2a1a0d");
    tctx.fillStyle = wg; tctx.fill();
    tctx.restore();
    // felt
    roundRect(tctx, PLAY.x - RAIL * 0.28, PLAY.y - RAIL * 0.28, PLAY.w + RAIL * 0.56, PLAY.h + RAIL * 0.56, RAIL * 0.4);
    tctx.fillStyle = "#0d6b3f"; tctx.fill();
    tctx.save(); tctx.beginPath(); tctx.rect(PLAY.x - RAIL * 0.28, PLAY.y - RAIL * 0.28, PLAY.w + RAIL * 0.56, PLAY.h + RAIL * 0.56); tctx.clip();
    var lg = tctx.createRadialGradient(PLAY.cx, PLAY.cy, R, PLAY.cx, PLAY.cy, Math.max(PLAY.w, PLAY.h) * 0.62);
    lg.addColorStop(0, "#1a955a"); lg.addColorStop(0.55, "#127a48"); lg.addColorStop(1, "#0a5330");
    tctx.fillStyle = lg; tctx.fillRect(PLAY.x - RAIL, PLAY.y - RAIL, PLAY.w + 2 * RAIL, PLAY.h + 2 * RAIL);
    // cloth speckle
    tctx.globalAlpha = 0.05;
    for (var i = 0; i < 900; i++) { tctx.fillStyle = i % 2 ? "#eafff2" : "#03301b"; tctx.fillRect(PLAY.x + Math.random() * PLAY.w, PLAY.y + Math.random() * PLAY.h, 1.2, 1.2); }
    tctx.globalAlpha = 1; tctx.restore();
    // cushions (raised bevel)
    tctx.strokeStyle = "rgba(255,255,255,0.10)"; tctx.lineWidth = 2;
    roundRect(tctx, PLAY.x, PLAY.y, PLAY.w, PLAY.h, R * 0.4); tctx.stroke();
    tctx.strokeStyle = "rgba(0,0,0,0.28)"; tctx.lineWidth = RAIL * 0.34;
    roundRect(tctx, PLAY.x - RAIL * 0.24, PLAY.y - RAIL * 0.24, PLAY.w + RAIL * 0.48, PLAY.h + RAIL * 0.48, R * 0.6); tctx.stroke();
    // diamonds (rail sights)
    tctx.fillStyle = "rgba(240,225,190,0.55)";
    for (var d = 1; d <= 3; d++) {
      var f = d / 4;
      [tp(f, -PLAY.h / 2 - RAIL * 0.5), tp(f, PLAY.h / 2 + RAIL * 0.5)].forEach(function (p) { if (!portrait) diamond(p.x, p.y); });
    }
    // pockets
    pockets.forEach(function (p) {
      var pg = tctx.createRadialGradient(p.x, p.y, 1, p.x, p.y, POCKR * 1.15);
      pg.addColorStop(0, "#000"); pg.addColorStop(0.7, "#05100a"); pg.addColorStop(1, "rgba(5,16,10,0)");
      tctx.fillStyle = pg; tctx.beginPath(); tctx.arc(p.x, p.y, POCKR * 1.15, 0, 6.2832); tctx.fill();
      tctx.fillStyle = "#020604"; tctx.beginPath(); tctx.arc(p.x, p.y, POCKR * 0.82, 0, 6.2832); tctx.fill();
      tctx.strokeStyle = "rgba(20,12,4,0.9)"; tctx.lineWidth = 3; tctx.beginPath(); tctx.arc(p.x, p.y, POCKR * 0.82, 0, 6.2832); tctx.stroke();
    });
    // head string + spot
    tctx.strokeStyle = "rgba(240,230,200,0.16)"; tctx.lineWidth = 1;
    var a = tp(0.25, -PLAY.h / 2), b = tp(0.25, PLAY.h / 2);
    tctx.beginPath(); tctx.moveTo(a.x, a.y); tctx.lineTo(b.x, b.y); tctx.stroke();
    var foot = tp(0.70, 0);
    tctx.fillStyle = "rgba(240,230,200,0.22)"; tctx.beginPath(); tctx.arc(foot.x, foot.y, 2.2, 0, 6.2832); tctx.fill();
  }
  function diamond(x, y) { tctx.save(); tctx.translate(x, y); tctx.rotate(Math.PI / 4); tctx.fillRect(-2.2, -2.2, 4.4, 4.4); tctx.restore(); }

  // ---- ball render ----
  function drawBall(c, bx, by, r, ball, alpha) {
    alpha = alpha == null ? 1 : alpha;
    c.save(); c.globalAlpha = alpha;
    // shadow
    c.fillStyle = "rgba(0,0,0,0.32)"; c.beginPath(); c.ellipse(bx + r * 0.28, by + r * 0.42, r * 1.02, r * 0.86, 0, 0, 6.2832); c.fill();
    // face
    c.beginPath(); c.arc(bx, by, r, 0, 6.2832); c.closePath(); c.save(); c.clip();
    if (ball.n === 0) { c.fillStyle = "#fbfaf5"; c.fillRect(bx - r, by - r, 2 * r, 2 * r); }
    else if (ball.stripe) {
      c.fillStyle = "#f6f3ea"; c.fillRect(bx - r, by - r, 2 * r, 2 * r);
      c.fillStyle = ball.color; c.fillRect(bx - r, by - r * 0.52, 2 * r, r * 1.04);
    } else { c.fillStyle = ball.color; c.fillRect(bx - r, by - r, 2 * r, 2 * r); }
    // number disc
    if (ball.n > 0) {
      c.fillStyle = "#f7f4ec"; c.beginPath(); c.arc(bx, by, r * 0.46, 0, 6.2832); c.fill();
      c.fillStyle = "#1c1c1c"; c.font = "800 " + (r * 0.62).toFixed(1) + "px Archivo, system-ui, sans-serif";
      c.textAlign = "center"; c.textBaseline = "middle"; c.fillText(String(ball.n), bx, by + r * 0.03);
    }
    c.restore();
    // gloss
    var gl = c.createRadialGradient(bx - r * 0.36, by - r * 0.42, r * 0.05, bx - r * 0.2, by - r * 0.2, r * 1.25);
    gl.addColorStop(0, "rgba(255,255,255,0.85)"); gl.addColorStop(0.28, "rgba(255,255,255,0.18)"); gl.addColorStop(0.75, "rgba(255,255,255,0)");
    c.fillStyle = gl; c.beginPath(); c.arc(bx, by, r, 0, 6.2832); c.fill();
    // rim shade
    var rg = c.createRadialGradient(bx, by, r * 0.6, bx, by, r);
    rg.addColorStop(0, "rgba(0,0,0,0)"); rg.addColorStop(1, "rgba(0,0,0,0.28)");
    c.fillStyle = rg; c.beginPath(); c.arc(bx, by, r, 0, 6.2832); c.fill();
    c.restore();
  }

  // ---- physics ----
  function anyMoving() {
    for (var i = 0; i < balls.length; i++) if (!balls[i].potted && (balls[i].vx !== 0 || balls[i].vy !== 0)) return true;
    return false;
  }
  function nearPocket(x, y) {
    for (var i = 0; i < pockets.length; i++) { var dx = x - pockets[i].x, dy = y - pockets[i].y; if (dx * dx + dy * dy < (POCKR * 1.35) * (POCKR * 1.35)) return true; }
    return false;
  }
  function step(dt) {
    if (dt > 0.05) dt = 0.05;
    var live = balls.filter(function (b) { return !b.potted; });
    // substep to avoid tunnelling
    var maxV = 0; for (var i = 0; i < live.length; i++) maxV = Math.max(maxV, Math.abs(live[i].vx), Math.abs(live[i].vy));
    var steps = Math.max(1, Math.min(48, Math.ceil(maxV * dt / (R * 0.45))));
    var sub = dt / steps;
    var stopv = STOP * scaleV;
    for (var s = 0; s < steps; s++) {
      for (i = 0; i < live.length; i++) {
        var b = live[i];
        if (b.vx === 0 && b.vy === 0) continue;
        var damp = Math.exp(-FRIC * sub);
        b.vx *= damp; b.vy *= damp;
        b.x += b.vx * sub; b.y += b.vy * sub;
        if (Math.hypot(b.vx, b.vy) < stopv) { b.vx = 0; b.vy = 0; }
        // cushions
        cushion(b);
      }
      // ball-ball
      for (i = 0; i < live.length; i++) for (var j = i + 1; j < live.length; j++) collide(live[i], live[j]);
      // pockets
      for (i = live.length - 1; i >= 0; i--) {
        var lb = live[i];
        for (var p = 0; p < pockets.length; p++) {
          var dx = lb.x - pockets[p].x, dy = lb.y - pockets[p].y;
          if (dx * dx + dy * dy < POCKR * POCKR) { potBall(lb); live.splice(i, 1); break; }
        }
      }
    }
  }
  function cushion(b) {
    if (nearPocket(b.x, b.y)) return;
    var hit = 0, sp = Math.hypot(b.vx, b.vy);
    if (b.x - R < PLAY.x) { b.x = PLAY.x + R; b.vx = Math.abs(b.vx) * CUSH_REST; hit = 1; }
    else if (b.x + R > PLAY.x + PLAY.w) { b.x = PLAY.x + PLAY.w - R; b.vx = -Math.abs(b.vx) * CUSH_REST; hit = 1; }
    if (b.y - R < PLAY.y) { b.y = PLAY.y + R; b.vy = Math.abs(b.vy) * CUSH_REST; hit = 1; }
    else if (b.y + R > PLAY.y + PLAY.h) { b.y = PLAY.y + PLAY.h - R; b.vy = -Math.abs(b.vy) * CUSH_REST; hit = 1; }
    if (hit && sp > 40 * scaleV) sndCushion(Math.min(1, sp / (900 * scaleV)));
  }
  function collide(a, b) {
    var dx = b.x - a.x, dy = b.y - a.y, d2 = dx * dx + dy * dy, min = 2 * R;
    if (d2 >= min * min || d2 === 0) return;
    var d = Math.sqrt(d2), nx = dx / d, ny = dy / d, overlap = min - d;
    a.x -= nx * overlap / 2; a.y -= ny * overlap / 2; b.x += nx * overlap / 2; b.y += ny * overlap / 2;
    var dvx = b.vx - a.vx, dvy = b.vy - a.vy, vn = dvx * nx + dvy * ny;
    if (vn > 0) return;                 // separating
    var imp = -(1 + BALL_REST) * vn / 2;
    a.vx -= imp * nx; a.vy -= imp * ny; b.vx += imp * nx; b.vy += imp * ny;
    var rel = Math.abs(vn);
    if (rel > 30 * scaleV) sndClack(Math.min(1, rel / (1400 * scaleV)), (a.x + b.x) / 2, a.n === 0 || b.n === 0);
    chalkPuff((a.x + b.x) / 2, (a.y + b.y) / 2, Math.min(1, rel / (900 * scaleV)) * 0.5);
    // cue spin transfer on first contact
    if (cueSpinPending && (a.n === 0 || b.n === 0)) {
      var cueB = a.n === 0 ? a : b, sp = Math.hypot(cueSpinPending.vx, cueSpinPending.vy);
      if (sp > 1) {
        var tx = cueSpinPending.vx / sp, ty = cueSpinPending.vy / sp;    // travel dir
        cueB.vx += tx * spin.y * FOLLOW * sp + (-ty) * spin.x * ENGLISH * sp;
        cueB.vy += ty * spin.y * FOLLOW * sp + (tx) * spin.x * ENGLISH * sp;
      }
      cueSpinPending = null;
    }
    // rules bookkeeping
    if (shotContact === null) { if (a.n === 0) shotContact = b.n; else if (b.n === 0) shotContact = a.n; }
  }
  function potBall(b) {
    b.potted = true; b.dropT = 0.001; b.vx = 0; b.vy = 0;
    sndPot(b.n === 0);
    if (b.n === 0) cueScratch = true; else shotPotted.push(b.n);
  }

  // ---- shooting ----
  function strike(dirx, diry, power) {
    unlock();
    shotPotted = []; shotContact = null; cueScratch = false;
    var v = power * MAXV * scaleV;
    cue.vx = dirx * v; cue.vy = diry * v;
    cueSpinPending = { vx: cue.vx, vy: cue.vy };
    if (mode === "solo") strokes++;
    sndCue(power);
    phase = "shooting"; settleT = 0;
    if (hintEl) hintEl.classList.add("is-gone");
    updateHud();
  }

  // ---- rules: called when the table settles ----
  function evaluateShot() {
    phase = "aiming";
    if (mode === "solo") {
      if (cueScratch) { respawnCue(); phase = "placing"; }
      if (allObjectsPotted()) soloWin();
      updateHud();
      return;
    }
    // 8-ball
    var me = players[turn], eightPotted = shotPotted.indexOf(8) >= 0;
    var myPots = shotPotted.filter(function (n) { return n !== 8 && groupOf(n) === (me.group || groupOf(n)); });
    // assign groups on an open table
    if (open && !cueScratch) {
      var firstReal = shotPotted.filter(function (n) { return n !== 8; })[0];
      if (firstReal) {
        var g = groupOf(firstReal);
        players[turn].group = g; players[1 - turn].group = g === "solid" ? "stripe" : "solid";
        open = false;
      }
    }
    // win/lose on the 8
    if (eightPotted) {
      var clearedBefore = me.group && groupRemaining(me.group) === 0 && shotPotted.filter(function (n) { return groupOf(n) === me.group; }).length === 0;
      // legal 8: your group was already clear before this shot, and no scratch
      if (me.group && groupRemaining(me.group) === 0 && !cueScratch) { winner = turn; }
      else { winner = 1 - turn; }        // early 8 or scratch on the 8
      phase = "over"; updateHud(); if (winner === turn || winner >= 0) { /* handled below */ }
      if (winner >= 0) { over8ball(); }
      return;
    }
    // foul: scratch, or no contact
    var foul = cueScratch || shotContact === null;
    // continue turn if you legally potted one of yours (and not a foul)
    var potGood = !foul && shotPotted.some(function (n) { return n !== 8 && (open || groupOf(n) === players[turn].group); });
    if (foul) {
      if (cueScratch) respawnCue();
      turn = 1 - turn; ballInHand = true; phase = "placing";
    } else if (!potGood) {
      turn = 1 - turn;
    }
    updateHud();
  }
  function groupOf(n) { return n >= 1 && n <= 7 ? "solid" : n >= 9 ? "stripe" : "eight"; }
  function groupRemaining(g) { var c = 0; balls.forEach(function (b) { if (!b.potted && groupOf(b.n) === g) c++; }); return c; }
  function allObjectsPotted() { for (var i = 0; i < balls.length; i++) if (balls[i].n !== 0 && !balls[i].potted) return false; return true; }
  function respawnCue() { cue.potted = false; cue.dropT = 0; cue.vx = 0; cue.vy = 0; cue.inHand = true; var h = tp(0.25, 0); cue.x = h.x; cue.y = h.y; }

  function soloWin() {
    phase = "over";
    var isBest = best === 0 || strokes < best;
    if (isBest) { best = strokes; try { localStorage.setItem("pool_best", String(best)); } catch (e) {} }
    burstConfetti(); sndWin();
    ovTitle.textContent = isBest ? "New best!" : "Table cleared";
    ovText.textContent = "You cleared the table in " + strokes + " shot" + (strokes === 1 ? "" : "s") + ". Best: " + best + ".";
    ovBtn.textContent = "Rack 'em again";
    showOverlay();
  }
  function over8ball() {
    phase = "over"; burstConfetti(); sndWin();
    ovTitle.textContent = "Player " + (winner + 1) + " wins";
    ovText.textContent = "Player " + (winner + 1) + " sank the 8 ball. Nicely done. Rack them up for a rematch.";
    ovBtn.textContent = "Rematch";
    showOverlay();
  }

  // ---- HUD ----
  function updateHud() {
    modeBtn.textContent = mode === "solo" ? "Solo" : "8-Ball";
    if (mode === "solo") {
      var left = 0; balls.forEach(function (b) { if (b.n !== 0 && !b.potted) left++; });
      hudMsg.textContent = phase === "placing" ? "Place the cue ball" : "Shots: " + strokes;
      hudSub.textContent = (best ? "Best " + best + " · " : "") + left + " left";
    } else {
      if (winner >= 0) { hudMsg.textContent = "Player " + (winner + 1) + " wins"; hudSub.textContent = ""; return; }
      var g = players[turn].group;
      hudMsg.textContent = (phase === "placing" ? "P" + (turn + 1) + ": ball in hand" : "Player " + (turn + 1));
      if (open) hudSub.textContent = "Open table";
      else hudSub.textContent = g + "s · " + groupRemaining(g) + " left" + (groupRemaining(g) === 0 ? " · on the 8" : "");
    }
  }

  // ---- input ----
  function pt(e) { var r = canvas.getBoundingClientRect(); var t = e.touches ? e.touches[0] : e; return { x: t.clientX - r.left, y: t.clientY - r.top }; }
  function overlaps(x, y) {
    if (x < PLAY.x + R || x > PLAY.x + PLAY.w - R || y < PLAY.y + R || y > PLAY.y + PLAY.h - R) return true;
    for (var i = 0; i < balls.length; i++) { var b = balls[i]; if (b !== cue && !b.potted && Math.hypot(b.x - x, b.y - y) < 2 * R) return true; }
    for (var p = 0; p < pockets.length; p++) if (Math.hypot(pockets[p].x - x, pockets[p].y - y) < POCKR + R) return true;
    return false;
  }
  function down(e) {
    unlock();
    if (phase === "shooting" || phase === "over" || winner >= 0) return;
    var p = pt(e);
    if (phase === "placing") {
      cue.x = p.x; cue.y = p.y; return;    // drag to preview; place on up
    }
    // must grab near the cue ball to aim
    if (Math.hypot(p.x - cue.x, p.y - cue.y) < R * 4.5) { aiming = true; aimX = p.x; aimY = p.y; }
  }
  function move(e) {
    var p = pt(e);
    if (phase === "placing") { cue.x = p.x; cue.y = p.y; }
    else if (aiming) { aimX = p.x; aimY = p.y; }
  }
  function up() {
    if (phase === "placing") {
      if (!overlaps(cue.x, cue.y)) { cue.inHand = false; ballInHand = false; phase = "aiming"; updateHud(); }
      return;
    }
    if (!aiming) return;
    aiming = false;
    var dx = cue.x - aimX, dy = cue.y - aimY, d = Math.hypot(dx, dy);
    var maxPull = (portrait ? H : W) * MAXPULL_FRAC;
    var power = Math.min(d, maxPull) / maxPull;
    if (power < 0.05 || d < 3) return;
    strike(dx / d, dy / d, power);
  }
  canvas.addEventListener("mousedown", down); window.addEventListener("mousemove", move); window.addEventListener("mouseup", up);
  canvas.addEventListener("touchstart", function (e) { e.preventDefault(); down(e); }, { passive: false });
  canvas.addEventListener("touchmove", function (e) { e.preventDefault(); move(e); }, { passive: false });
  canvas.addEventListener("touchend", function (e) { e.preventDefault(); up(); }, { passive: false });

  // spin picker
  function setSpinFrom(e) {
    var r = spinBall.getBoundingClientRect(); var t = e.touches ? e.touches[0] : e;
    var nx = (t.clientX - r.left) / r.width * 2 - 1, ny = (t.clientY - r.top) / r.height * 2 - 1;
    var m = Math.hypot(nx, ny); if (m > 1) { nx /= m; ny /= m; }
    spin.x = nx; spin.y = -ny;   // up = follow (positive y)
    updateSpinDot();
  }
  function updateSpinDot() { spinDot.style.left = (50 + spin.x * 34) + "%"; spinDot.style.top = (50 - spin.y * 34) + "%"; }
  var spinning = false;
  spinBall.addEventListener("mousedown", function (e) { spinning = true; setSpinFrom(e); });
  window.addEventListener("mousemove", function (e) { if (spinning) setSpinFrom(e); });
  window.addEventListener("mouseup", function () { spinning = false; });
  spinBall.addEventListener("touchstart", function (e) { e.preventDefault(); spinning = true; setSpinFrom(e); }, { passive: false });
  spinBall.addEventListener("touchmove", function (e) { e.preventDefault(); if (spinning) setSpinFrom(e); }, { passive: false });
  spinBall.addEventListener("touchend", function (e) { e.preventDefault(); spinning = false; }, { passive: false });

  modeBtn.addEventListener("click", function () { mode = mode === "solo" ? "8ball" : "solo"; newGame(); });
  newBtn.addEventListener("click", function () { newGame(); });
  ovBtn.addEventListener("click", function () { hideOverlay(); newGame(); });

  function showOverlay() { overlay.hidden = false; requestAnimationFrame(function () { overlay.classList.remove("is-hidden"); }); }
  function hideOverlay() { overlay.classList.add("is-hidden"); setTimeout(function () { overlay.hidden = true; }, 200); }

  // ---- fx ----
  function chalkPuff(x, y, amt) { for (var i = 0; i < 3 + amt * 8; i++) { var a = Math.random() * 6.283, s = 20 + Math.random() * 90 * amt; chalk.push({ x: x, y: y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0, max: 0.3 + Math.random() * 0.3, r: 1 + Math.random() * 2 }); } }
  function burstConfetti() { for (var i = 0; i < 130; i++) confetti.push({ x: PLAY.cx + (Math.random() - 0.5) * PLAY.w * 0.6, y: PLAY.cy - PLAY.h * 0.3, vx: (Math.random() - 0.5) * 320, vy: -120 - Math.random() * 320, life: 0, max: 1.6 + Math.random(), rot: Math.random() * 6.28, hue: (Math.random() * 360) | 0, size: 5 + Math.random() * 6 }); }
  function updateFx(dt) {
    for (var i = chalk.length - 1; i >= 0; i--) { var c = chalk[i]; c.life += dt; c.vx *= 0.9; c.vy *= 0.9; c.x += c.vx * dt; c.y += c.vy * dt; if (c.life >= c.max) chalk.splice(i, 1); }
    for (i = confetti.length - 1; i >= 0; i--) { var p = confetti[i]; p.life += dt; p.vy += 620 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += dt * 6; if (p.life >= p.max) confetti.splice(i, 1); }
    for (i = 0; i < balls.length; i++) if (balls[i].potted && balls[i].dropT > 0 && balls[i].dropT < 1) balls[i].dropT = Math.min(1, balls[i].dropT + dt * 3.4);
  }

  // ---- render ----
  function render() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(tableCanvas, 0, 0, W, H);

    // potted balls dropping into pockets
    for (var i = 0; i < balls.length; i++) {
      var b = balls[i];
      if (b.potted && b.dropT > 0 && b.dropT < 1) drawBall(ctx, b.x, b.y, R * (1 - b.dropT * 0.7), b, 1 - b.dropT);
    }
    // live balls
    for (i = 0; i < balls.length; i++) { b = balls[i]; if (!b.potted && b !== cue) drawBall(ctx, b.x, b.y, R, b, 1); }
    // cue ball (with ball-in-hand ghost)
    if (!cue.potted) {
      if (phase === "placing") {
        var bad = overlaps(cue.x, cue.y);
        ctx.save(); ctx.globalAlpha = 0.5; drawBall(ctx, cue.x, cue.y, R, cue, 1); ctx.restore();
        ctx.strokeStyle = bad ? "rgba(230,80,60,0.9)" : "rgba(120,230,150,0.9)"; ctx.lineWidth = 2; ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.arc(cue.x, cue.y, R + 4, 0, 6.2832); ctx.stroke(); ctx.setLineDash([]);
      } else drawBall(ctx, cue.x, cue.y, R, cue, 1);
    }
    // aim + cue stick
    if (aiming && phase === "aiming" && !cue.potted) drawAim();
    // fx
    ctx.globalCompositeOperation = "lighter";
    for (i = 0; i < chalk.length; i++) { var c = chalk[i]; ctx.globalAlpha = (1 - c.life / c.max) * 0.5; ctx.fillStyle = "#dfeaf5"; ctx.beginPath(); ctx.arc(c.x, c.y, c.r, 0, 6.2832); ctx.fill(); }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
    for (i = 0; i < confetti.length; i++) { var p = confetti[i]; ctx.save(); ctx.globalAlpha = Math.max(0, 1 - p.life / p.max); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = "hsl(" + p.hue + ",85%,60%)"; ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6); ctx.restore(); }
  }
  function drawAim() {
    var dx = cue.x - aimX, dy = cue.y - aimY, d = Math.hypot(dx, dy);
    if (d < 3) return;
    var ux = dx / d, uy = dy / d;
    var maxPull = (portrait ? H : W) * MAXPULL_FRAC, power = Math.min(d, maxPull) / maxPull;
    // aim guide (short, no full prediction)
    ctx.save(); ctx.setLineDash([5, 7]); ctx.lineWidth = 2; ctx.strokeStyle = "rgba(250,245,225,0.55)";
    ctx.beginPath(); ctx.moveTo(cue.x + ux * (R + 2), cue.y + uy * (R + 2)); ctx.lineTo(cue.x + ux * R * 10, cue.y + uy * R * 10); ctx.stroke(); ctx.setLineDash([]);
    // cue stick (pulled back by power)
    var gap = R + 6 + power * R * 7, sx = cue.x - ux * gap, sy = cue.y - uy * gap, ex = sx - ux * R * 22, ey = sy - uy * R * 22;
    var grd = ctx.createLinearGradient(sx, sy, ex, ey); grd.addColorStop(0, "#c98b3a"); grd.addColorStop(0.12, "#e7c07a"); grd.addColorStop(1, "#5a3c1a");
    ctx.lineCap = "round"; ctx.strokeStyle = grd; ctx.lineWidth = R * 0.5; ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.strokeStyle = "#eef2f6"; ctx.lineWidth = R * 0.5; ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx - ux * R * 1.4, sy - uy * R * 1.4); ctx.stroke();
    // power ring
    ctx.strokeStyle = "rgba(0,0,0,0.3)"; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(cue.x, cue.y, R + 7, 0, 6.2832); ctx.stroke();
    ctx.strokeStyle = "hsl(" + (120 - power * 120) + ",85%,55%)"; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(cue.x, cue.y, R + 7, -Math.PI / 2, -Math.PI / 2 + power * 6.2832); ctx.stroke();
    ctx.restore();
  }

  var last = 0;
  function frame(ts) {
    var dt = last ? Math.min((ts - last) / 1000, 0.05) : 0.016; last = ts;
    if (phase === "shooting") {
      step(dt);
      if (!anyMoving()) { settleT += dt; if (settleT > 0.08) evaluateShot(); }
      else settleT = 0;
    }
    updateFx(dt); render();
    requestAnimationFrame(frame);
  }

  // ============================ AUDIO ============================
  var actx = null, master = null, comp = null, convo = null, wet = null, muted = false;
  function unlock() {
    if (actx) { if (actx.state === "suspended") actx.resume(); return; }
    try {
      actx = new (window.AudioContext || window.webkitAudioContext)();
      master = actx.createGain(); master.gain.value = muted ? 0 : 1.15;
      comp = actx.createDynamicsCompressor(); comp.threshold.value = -9; comp.ratio.value = 2.5; comp.attack.value = 0.002; comp.release.value = 0.18;
      comp.connect(master); master.connect(actx.destination);
      convo = actx.createConvolver(); convo.buffer = impulse(1.1, 3.4); wet = actx.createGain(); wet.gain.value = 0.14; wet.connect(comp); convo.connect(wet);
      var b = actx.createBuffer(1, 1, 22050), s = actx.createBufferSource(); s.buffer = b; s.connect(actx.destination); s.start(0);
    } catch (e) { actx = null; }
  }
  function impulse(dur, decay) { var n = (actx.sampleRate * dur) | 0, buf = actx.createBuffer(2, n, actx.sampleRate); for (var ch = 0; ch < 2; ch++) { var d = buf.getChannelData(ch), lp = 0; for (var i = 0; i < n; i++) { var t = i / n, raw = (Math.random() * 2 - 1) * Math.pow(1 - t, decay); lp += (raw - lp) * 0.25; d[i] = lp; } } return buf; }
  function noise(dur) { var n = (actx.sampleRate * dur) | 0, b = actx.createBuffer(1, n, actx.sampleRate), d = b.getChannelData(0); for (var i = 0; i < n; i++) d[i] = Math.random() * 2 - 1; var s = actx.createBufferSource(); s.buffer = b; return s; }
  function panner(x) { if (!actx.createStereoPanner) return null; var p = actx.createStereoPanner(); p.pan.value = Math.max(-0.7, Math.min(0.7, ((x / W) - 0.5) * 1.2)); return p; }
  function route(g, x, wetAmt) { var tail = g, p = panner(x); if (p) { g.connect(p); tail = p; } tail.connect(comp); var w = actx.createGain(); w.gain.value = wetAmt == null ? 0.1 : wetAmt; tail.connect(w); w.connect(convo); }
  function tone(type, f0, f1, t, dur, vol, x, wetAmt) { var o = actx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t); if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur); var g = actx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0008, t + dur); o.connect(g); route(g, x, wetAmt); o.start(t); o.stop(t + dur + 0.03); }
  function click(t, freq, q, dur, vol, x, wetAmt, type) { var s = noise(dur + 0.01), f = actx.createBiquadFilter(); f.type = type || "bandpass"; f.frequency.value = freq; f.Q.value = q; var g = actx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur); s.connect(f); f.connect(g); route(g, x, wetAmt); s.start(t); s.stop(t + dur + 0.02); }
  var lastClack = 0;
  function sndCue(power) {
    // leather cue tip on the ball: a soft, low, damped "tock" (not a bright crack or a tone)
    if (!actx || muted) return; var t = actx.currentTime;
    click(t, 1300 + power * 600, 0.45, 0.022, 1.0 + power * 0.7, cue.x, 0.05, "lowpass");
    click(t, 3000, 0.8, 0.005, 0.24 + power * 0.16, cue.x, 0.04);
  }
  function sndClack(v, x, cueInvolved) {
    // hard-ball crack: a bright sharp transient + a short knock body, both filtered
    // noise (no pitched tone, so it reads as a click, not a beep).
    if (!actx || muted) return; var now = actx.currentTime; if (now - lastClack < 0.012) return; lastClack = now;
    var crack = (cueInvolved ? 2700 : 3300) + v * 1500;
    click(now, crack, 0.55, 0.011, 0.7 + v * 0.8, x, 0.05);
    click(now, 1200 + v * 550, 0.45, 0.024, 0.45 + v * 0.45, x, 0.05);
  }
  function sndCushion(v) {
    // ball into a rubber cushion: a low thud body (sub-160Hz, percussive) + noise texture
    if (!actx || muted) return; var t = actx.currentTime;
    tone("sine", 132, 78, t, 0.05, 0.45 + v * 0.35, cue.x, 0.04);
    click(t, 520 + v * 220, 0.5, 0.03, 0.32 + v * 0.32, cue.x, 0.05, "lowpass");
  }
  function sndPot(isCue) {
    // ball dropping into the pocket: a low thunk, then a couple of muffled rattles
    if (!actx || muted) return; var t = actx.currentTime;
    tone("sine", 106, 54, t, 0.14, 0.55, cue.x, 0.1);
    click(t, 520, 0.5, 0.04, 0.4, cue.x, 0.1, "lowpass");
    for (var i = 0; i < 3; i++) { var tt = t + 0.05 + i * 0.055; click(tt, 240 - i * 30, 1.0, 0.024, 0.32 * Math.pow(0.72, i), cue.x, 0.12, "lowpass"); }
  }
  function sndWin() { if (!actx || muted) return; var t = actx.currentTime; [0, 4, 7, 12, 16].forEach(function (st, i) { tone("triangle", 392 * Math.pow(2, st / 12), 392 * Math.pow(2, st / 12), t + i * 0.1, 0.5, 0.22, PLAY.cx, 0.3); }); }
  soundBtn.addEventListener("click", function () { muted = !muted; unlock(); if (master) master.gain.value = muted ? 0 : 1.15; soundBtn.setAttribute("aria-pressed", muted ? "false" : "true"); soundBtn.textContent = muted ? "♪̸" : "♪"; });

  // ---- boot ----
  resize(); window.addEventListener("resize", resize);
  newGame();
  updateSpinDot();
  setTimeout(function () { if (hintEl) hintEl.classList.add("is-gone"); }, 7000);
  requestAnimationFrame(frame);

  // The tip-jar + fullscreen badges are relocated to the bottom-right corner on
  // this toy (the whole table is a drag surface). Announce the move: on load they
  // slide from their centre dock down to the corner. Reusable pattern — pair with
  // the .opt-*.opt-* override block in styles.css on any toy that relocates them.
  (function () {
    var frames = 0;
    (function wait() {
      var tip = document.querySelector(".opt-tipjar"), fs = document.querySelector(".opt-fs");
      if ((!tip || !fs) && ++frames < 600) return requestAnimationFrame(wait);
      if (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      [[tip, 0], [fs, -56]].forEach(function (pair) {
        var el = pair[0];
        if (!el) return;
        var r = el.getBoundingClientRect();
        var dy = (window.innerHeight / 2 + pair[1]) - (r.top + r.height / 2);
        el.style.transition = "none";
        el.style.transform = "translateY(" + dy + "px)";
        requestAnimationFrame(function () { requestAnimationFrame(function () {
          el.style.transition = "transform 900ms cubic-bezier(0.6, 0.05, 0.28, 1) 700ms";
          el.style.transform = "translateY(0)";
          setTimeout(function () { el.style.transition = ""; el.style.transform = ""; }, 1900);
        }); });
      });
    })();
  })();
})();
