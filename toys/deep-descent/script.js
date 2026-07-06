/* Deep Descent — an endless, torch-lit cave you descend through.
 * A winding, procedurally-streamed passage scrolls up to meet a fixed
 * torchbearer near the bottom; steer left/right to thread it, grab glowing
 * gems for a combo multiplier, and dodge the stone that looms out of the dark.
 * Vanilla Canvas 2D + Web Audio. No libraries, no build. */
(function () {
  "use strict";

  var canvas = document.getElementById("canvas");
  var ctx = canvas.getContext("2d");
  var scoreEl = document.getElementById("score");
  var bestEl = document.getElementById("best");
  var comboEl = document.getElementById("combo");
  var soundBtn = document.getElementById("soundBtn");
  var overlay = document.getElementById("overlay");
  var ovTitle = document.getElementById("ovTitle");
  var ovText = document.getElementById("ovText");
  var ovBtn = document.getElementById("ovBtn");
  var hintEl = document.getElementById("hint");
  var flashEl = document.getElementById("flash");

  var W = 0, H = 0, DPR = 1, playerScreenY = 0;

  // ---------------- tunables ----------------
  var PR = 15;               // player radius (px)
  var PPM = 30;              // px descended per "metre" of score
  var NODE_DZ = 74;          // depth spacing of corridor control nodes
  var SPEED0 = 195, SPEEDMAX = 560, RAMP_DIST = 9200;
  var HW0 = 158, HWMIN = 72; // corridor half-width (px), start → deep
  var EDGE_M = 12;           // min rock margin at the screen edge
  var PVMAX = 560;           // used to cap corridor slope so it stays dodgeable
  var KEY_V = 660;           // keyboard steer speed (full, when held)
  var KEY_ACCEL = 9;         // how fast the key steer ramps up/down (lower = gentler quick taps)
  var GEM_R = 9, GEM_PTS = 25;
  var GRACE_OBST = 900, GRACE_GEM = 520; // depth before obstacles / gems appear
  var NEAR_D = 11;           // near-miss clearance
  var DRIFT = 46;            // idle background drift speed

  // ---------------- state ----------------
  var started = false, running = false, dead = false, soundOn = true;
  var travel = 0, speed = SPEED0;
  var score = 0, gemScore = 0, best = 0, gemStreak = 0, mult = 1;
  var nodes = [], obstacles = [], gems = [], decor = [];
  var particles = [], motes = [];
  var player = { x: 0, tx: 0, vx: 0, bob: 0 };
  var meanderTarget = 0;
  var shake = 0, flick = 0, nearCd = 0, ambLevel = 0, driftScore = 0;
  var keyL = false, keyR = false, keyVel = 0;

  try { best = parseInt(localStorage.getItem("descent_best"), 10) || 0; } catch (e) { best = 0; }
  bestEl.textContent = best > 0 ? "Best " + best + "m" : "Best —";

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function cr(p0, p1, p2, p3, t) { var t2 = t * t, t3 = t2 * t; return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3); }
  function screenY(d) { return playerScreenY - (d - travel); }

  // ---------------- layout ----------------
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.floor(W * DPR); canvas.height = Math.floor(H * DPR);
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    playerScreenY = Math.round(H * 0.70);
    player.x = clamp(player.x || W / 2, PR, W - PR);
    player.tx = clamp(player.tx || W / 2, PR, W - PR);
  }

  // ---------------- corridor ----------------
  function sampleCorridor(d) {
    var n = nodes.length;
    if (n === 0) return { cx: W / 2, hw: HW0 };
    if (d <= nodes[0].d) return { cx: nodes[0].cx, hw: nodes[0].hw };
    if (d >= nodes[n - 1].d) return { cx: nodes[n - 1].cx, hw: nodes[n - 1].hw };
    var i = 0; while (i < n - 1 && nodes[i + 1].d < d) i++;
    var a = nodes[Math.max(0, i - 1)], b = nodes[i], c = nodes[i + 1], e = nodes[Math.min(n - 1, i + 2)];
    var seg = c.d - b.d, t = seg > 0 ? (d - b.d) / seg : 0;
    return { cx: cr(a.cx, b.cx, c.cx, e.cx, t), hw: cr(a.hw, b.hw, c.hw, e.hw, t) };
  }
  function edgeWob(d, s) { return Math.sin(d * 0.082 + s) * 0.5 + Math.sin(d * 0.031 + s * 1.7) * 0.5 + Math.sin(d * 0.171 + s * 2.3) * 0.24; }
  function edges(d) {
    var c = sampleCorridor(d);
    var wl = (edgeWob(d, 1.0) + 1.24) * 3.6;   // 0..~9 inward bumpiness
    var wr = (edgeWob(d, 4.7) + 1.24) * 3.6;
    return { l: c.cx - c.hw + wl, r: c.cx + c.hw - wr, cx: c.cx, hw: c.hw };
  }

  function difficulty() { return clamp(travel / RAMP_DIST, 0, 1); }

  function genNode() {
    var prev = nodes[nodes.length - 1];
    var newD = prev.d + NODE_DZ;
    var t = clamp(newD / RAMP_DIST, 0, 1);
    var breath = 0.86 + 0.14 * Math.sin(newD * 0.0032 + 1.7);
    var hw = lerp(HW0, HWMIN, t) * breath;
    hw = Math.min(hw, Math.max(52, W * 0.40));
    hw = Math.max(hw, PR + 24);
    var lo = hw + EDGE_M, hi = W - hw - EDGE_M;
    if (lo >= hi) { hw = Math.max(PR + 16, (W - 2 * EDGE_M) / 2 - 6); lo = hw + EDGE_M; hi = W - hw - EDGE_M; if (lo > hi) { lo = hi = W / 2; } }
    var maxStep = clamp(PVMAX * NODE_DZ / Math.max(140, speed) * 0.5, 10, 78);
    var amp = maxStep * (0.42 + 0.58 * t);
    meanderTarget += (Math.random() * 2 - 1) * amp * 0.72;
    meanderTarget += (W / 2 - meanderTarget) * 0.045;
    meanderTarget = clamp(meanderTarget, lo, hi);
    var dx = clamp(meanderTarget - prev.cx, -maxStep, maxStep);
    var cx = clamp(prev.cx + dx, lo, hi);
    var node = { d: newD, cx: cx, hw: hw };
    nodes.push(node);
    populate(node, t);
  }

  function populate(node, t) {
    // decor first (texture) — always
    for (var k = 0; k < 2; k++) decor.push({ d: node.d - Math.random() * NODE_DZ, frac: (Math.random() * 2 - 1) * 0.82, kind: 0, r: 1.4 + Math.random() * 2.6, tone: Math.random() });
    if (Math.random() < 0.55) decor.push({ d: node.d - Math.random() * NODE_DZ, side: Math.random() < 0.5 ? -1 : 1, kind: 1, len: 7 + Math.random() * 16 });

    var minGap = 2 * PR + 30;
    var hw = node.hw, cx = node.cx, left = cx - hw, right = cx + hw;
    var pObst = 0.05 + 0.30 * t;
    if (node.d > GRACE_OBST && Math.random() < pObst && 2 * hw > minGap + 40) {
      if (Math.random() < 0.55) {
        var side = Math.random() < 0.5 ? -1 : 1;
        var maxLen = 2 * hw - minGap;
        if (maxLen >= 26) {
          var len = 26 + Math.random() * Math.min(maxLen - 26, hw * 0.85);
          obstacles.push({ type: 0, d: node.d, side: side, len: len, half: 13 + len * 0.42, cx: cx, hw: hw });
        }
      } else {
        var r = 13 + Math.random() * 12;
        if (2 * hw > 2 * r + minGap + 6) {
          var s2 = Math.random() < 0.5 ? -1 : 1, room = Math.max(2, (2 * hw - 2 * r - minGap) * 0.5), x;
          if (s2 < 0) x = left + r + Math.random() * room; else x = right - r - Math.random() * room;
          x = clamp(x, left + r, right - r);
          if ((x - r - left) >= minGap || (right - (x + r)) >= minGap) obstacles.push({ type: 1, d: node.d, x: x, r: r });
        }
      }
    } else if (node.d > GRACE_GEM && Math.random() < 0.42) {
      var gside = Math.random() < 0.5 ? -1 : 1;
      var frac = 0.44 + Math.random() * 0.42;
      var gx = clamp(cx + gside * frac * hw, cx - hw + PR + 4, cx + hw - PR - 4);
      gems.push({ d: node.d, x: gx, taken: false, missed: false, spin: Math.random() * 6.28 });
    }
  }

  function streamTerrain() {
    var aheadD = travel + playerScreenY + 430;
    while (nodes.length === 0 || nodes[nodes.length - 1].d < aheadD) genNode();
    var cutD = travel + playerScreenY - H - 250;
    while (nodes.length > 4 && nodes[1].d < cutD) nodes.shift();
    var below = travel + playerScreenY - H - 60;
    for (var i = obstacles.length - 1; i >= 0; i--) if (obstacles[i].d < below) obstacles.splice(i, 1);
    for (var j = gems.length - 1; j >= 0; j--) if (gems[j].d < below) gems.splice(j, 1);
    for (var m = decor.length - 1; m >= 0; m--) if (decor[m].d < below) decor.splice(m, 1);
  }

  // ---------------- collision ----------------
  function wallCrash() {
    var e = edges(travel);
    return (player.x - PR < e.l) || (player.x + PR > e.r);
  }
  function obstacleHit(ob) {
    if (ob.type === 1) {
      var dx = ob.x - player.x, dd = ob.d - travel, rr = ob.r + PR;
      return dx * dx + dd * dd < rr * rr;
    }
    var ddp = Math.abs(travel - ob.d);
    if (ddp >= ob.half) return false;
    var intr = ob.len * (1 - ddp / ob.half);
    if (ob.side < 0) return player.x - PR < (ob.cx - ob.hw) + intr;
    return player.x + PR > (ob.cx + ob.hw) - intr;
  }
  function checkCollisions() {
    if (wallCrash()) return true;
    for (var i = 0; i < obstacles.length; i++) {
      if (Math.abs(obstacles[i].d - travel) > 80) continue;
      if (obstacleHit(obstacles[i])) return true;
    }
    return false;
  }
  function clearance() {
    var e = edges(travel), c = Math.min((player.x - PR) - e.l, e.r - (player.x + PR));
    for (var i = 0; i < obstacles.length; i++) {
      var ob = obstacles[i];
      if (ob.type === 1) {
        if (Math.abs(ob.d - travel) > ob.r + PR + NEAR_D) continue;
        var dx = ob.x - player.x, dd = ob.d - travel;
        c = Math.min(c, Math.sqrt(dx * dx + dd * dd) - ob.r - PR);
      } else {
        var ddp = Math.abs(travel - ob.d);
        if (ddp >= ob.half) continue;
        var intr = ob.len * (1 - ddp / ob.half);
        if (ob.side < 0) c = Math.min(c, (player.x - PR) - ((ob.cx - ob.hw) + intr));
        else c = Math.min(c, ((ob.cx + ob.hw) - intr) - (player.x + PR));
      }
    }
    return c;
  }

  // ---------------- gems / combo ----------------
  function setCombo() {
    mult = Math.min(5, 1 + Math.floor(gemStreak / 3));
    if (mult > 1) { comboEl.textContent = "×" + mult; comboEl.hidden = false; comboEl.style.animation = "none"; void comboEl.offsetWidth; comboEl.style.animation = ""; }
    else comboEl.hidden = true;
  }
  function collectGem(g) {
    g.taken = true; gemStreak++; setCombo();
    var add = GEM_PTS * mult; gemScore += add;
    var sy = screenY(g.d);
    for (var i = 0; i < 12; i++) { var a = Math.random() * 6.28, sp = 40 + Math.random() * 150; particles.push({ x: g.x, y: sy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0, max: 0.5 + Math.random() * 0.4, size: 1.5 + Math.random() * 2.5, color: "#bff6ff", grav: 40, add: true }); }
    particles.push({ x: g.x, y: sy - 6, vx: 0, vy: -46, life: 0, max: 0.85, size: 0, text: "+" + add, color: "#cdfaff", grav: 0, add: false });
    sndGem();
  }
  function missGem() { gemStreak = Math.max(0, gemStreak - 2); setCombo(); }

  function updateGems() {
    for (var i = 0; i < gems.length; i++) {
      var g = gems[i]; if (g.taken || g.missed) continue;
      var dd = g.d - travel;
      if (Math.abs(dd) < PR + GEM_R + 2) {
        var dx = g.x - player.x, rr = PR + GEM_R + 3;
        if (dx * dx + dd * dd < rr * rr) { collectGem(g); continue; }
      }
      if (g.d < travel - (PR + GEM_R + 6)) { g.missed = true; missGem(); }
    }
  }

  // ---------------- update ----------------
  function update(dt) {
    flick += dt * 9;
    if (running) {
      var t = difficulty();
      speed = SPEED0 + t * (SPEEDMAX - SPEED0);
      if (travel > RAMP_DIST) speed += Math.min(170, (travel - RAMP_DIST) * 0.006);
      travel += speed * dt;
    } else if (!dead) {
      travel += DRIFT * dt;
    }
    streamTerrain();

    // steer — keyboard ramps up while held (gentle quick taps) and stops the target
    // the instant you release (no coasting); player.x still eases so the ship glides smoothly
    var kdir = (keyR ? 1 : 0) - (keyL ? 1 : 0);
    if (kdir !== 0) {
      keyVel += (kdir * KEY_V - keyVel) * Math.min(1, dt * KEY_ACCEL);
      player.tx += keyVel * dt;
    } else {
      keyVel = 0;
    }
    player.tx = clamp(player.tx, PR, W - PR);
    var ox = player.x;
    player.x += (player.tx - player.x) * (1 - Math.exp(-dt * 17));
    player.x = clamp(player.x, PR, W - PR);
    player.vx = dt > 0 ? (player.x - ox) / dt : 0;
    player.bob += dt * (6 + speed * 0.01);

    if (running) {
      updateGems();
      if (checkCollisions()) { crash(); }
      else {
        if (nearCd > 0) nearCd -= dt;
        var c = clearance();
        if (c < NEAR_D && c > -1 && nearCd <= 0 && Math.abs(player.vx) > 40) { nearCd = 0.45; shake = Math.max(shake, 3); sndWhoosh(); }
      }
      score = Math.floor(travel / PPM) + gemScore;
      scoreEl.textContent = score + "m";
    }

    // ambient audio level
    ambLevel += ((running ? 1 : 0) - ambLevel) * Math.min(1, dt * 3);
    updateAudio();

    // dust motes (torch-lit specks)
    if (motes.length < 26 && Math.random() < 0.6) motes.push({ x: Math.random() * W, y: Math.random() * H, vx: (Math.random() * 2 - 1) * 8, vy: 10 + Math.random() * 22, life: 0, max: 2 + Math.random() * 3, r: 0.6 + Math.random() * 1.4 });
    for (var i = motes.length - 1; i >= 0; i--) { var q = motes[i]; q.life += dt; q.x += q.vx * dt; q.y += (q.vy + speed * 0.12) * dt; if (q.life >= q.max || q.y > H + 10) motes.splice(i, 1); }

    // player kicked dust
    if (running && Math.abs(player.vx) > 120 && Math.random() < 0.5) particles.push({ x: player.x - Math.sign(player.vx) * 8, y: playerScreenY + 8, vx: -player.vx * 0.15 + (Math.random() * 2 - 1) * 20, vy: 20 + Math.random() * 30, life: 0, max: 0.5 + Math.random() * 0.3, size: 1.5 + Math.random() * 2, color: "#5a4230", grav: 30, add: false });

    for (var p = particles.length - 1; p >= 0; p--) { var s = particles[p]; s.life += dt; s.vy += (s.grav || 0) * dt; s.x += s.vx * dt; s.y += s.vy * dt; if (s.life >= s.max) particles.splice(p, 1); }

    if (shake > 0) shake = Math.max(0, shake - dt * 26);
  }

  function crash() {
    if (dead) return;
    dead = true; running = false;
    shake = 22;
    flashEl.classList.add("is-on");
    setTimeout(function () { flashEl.classList.remove("is-on"); }, 70);
    var e = edges(travel);
    var wx = (player.x - PR < e.l) ? e.l : (player.x + PR > e.r ? e.r : player.x);
    for (var i = 0; i < 34; i++) { var a = Math.random() * 6.28, sp = 60 + Math.random() * 300; particles.push({ x: player.x, y: playerScreenY, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60, life: 0, max: 0.7 + Math.random() * 0.7, size: 2 + Math.random() * 4, color: Math.random() < 0.5 ? "#3a2a1c" : "#6a4c30", grav: 520, add: false }); }
    sndCrash();
    var isBest = score > best;
    if (isBest) { best = score; try { localStorage.setItem("descent_best", String(best)); } catch (e2) {} bestEl.textContent = "Best " + best + "m"; burstConfetti(); }
    setTimeout(function () {
      ovTitle.textContent = isBest ? "New record!" : "Crushed.";
      ovText.innerHTML = "You made it <span class='stat'>" + score + "m</span> down" + (gemScore > 0 ? " and pocketed <span class='stat'>" + gemScore + "</span> in gems" : "") + "." + (best > 0 ? " Best: <span class='stat'>" + best + "m</span>." : "");
      ovBtn.textContent = "Descend again";
      overlay.hidden = false; overlay.classList.remove("is-hidden");
    }, 620);
  }

  function burstConfetti() {
    var cs = ["#ffcf5a", "#ff8a3c", "#8ff0ff", "#7dffb0", "#ff6f91", "#fff2d0"];
    for (var i = 0; i < 90; i++) particles.push({ x: W / 2 + (Math.random() * 2 - 1) * W * 0.3, y: -20, vx: (Math.random() * 2 - 1) * 220, vy: 80 + Math.random() * 260, life: 0, max: 1.6 + Math.random() * 1.2, size: 3 + Math.random() * 4, color: cs[(Math.random() * cs.length) | 0], grav: 240, add: false, rect: true, rot: Math.random() * 6, vr: (Math.random() * 2 - 1) * 12 });
  }

  // ---------------- render ----------------
  function render() {
    var sx = shake > 0 ? (Math.random() * 2 - 1) * shake : 0;
    var sy = shake > 0 ? (Math.random() * 2 - 1) * shake : 0;
    ctx.setTransform(DPR, 0, 0, DPR, sx * DPR, sy * DPR);

    // base rock (walls fill the whole screen; the floor ribbon is drawn over it)
    var bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#171009"); bg.addColorStop(0.6, "#100a07"); bg.addColorStop(1, "#0a0605");
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

    // sample corridor edges down the screen
    var step = 9, ys = [], L = [], R = [];
    for (var y = -30; y <= H + 30; y += step) { var d = travel + playerScreenY - y; var e = edges(d); ys.push(y); L.push(e.l); R.push(e.r); }

    // floor ribbon
    var floor = new Path2D();
    floor.moveTo(L[0], ys[0]);
    for (var i = 1; i < ys.length; i++) floor.lineTo(L[i], ys[i]);
    for (var j = ys.length - 1; j >= 0; j--) floor.lineTo(R[j], ys[j]);
    floor.closePath();
    var fg = ctx.createLinearGradient(0, playerScreenY - 220, 0, playerScreenY + 120);
    fg.addColorStop(0, "#241811"); fg.addColorStop(1, "#2c1d13");
    ctx.save(); ctx.fillStyle = fg; ctx.fill(floor);
    // faint floor sheen down the middle
    ctx.clip(floor);
    var mid = ctx.createLinearGradient(0, 0, 0, H);
    mid.addColorStop(0, "rgba(60,40,26,0)"); mid.addColorStop(1, "rgba(70,48,30,0.25)");
    ctx.fillStyle = mid; ctx.fillRect(0, 0, W, H);
    // decor pebbles inside floor
    for (var p = 0; p < decor.length; p++) {
      var dc = decor[p]; if (dc.kind !== 0) continue;
      var c = sampleCorridor(dc.d), px = c.cx + dc.frac * c.hw, py = screenY(dc.d);
      if (py < -10 || py > H + 10) continue;
      ctx.fillStyle = dc.tone > 0.5 ? "rgba(120,86,52,0.5)" : "rgba(30,20,13,0.6)";
      ctx.beginPath(); ctx.arc(px, py, dc.r, 0, 6.2832); ctx.fill();
    }
    ctx.restore();

    // wall cracks (just outside the edge)
    ctx.strokeStyle = "rgba(12,8,5,0.7)"; ctx.lineWidth = 1.4; ctx.lineCap = "round";
    for (var q = 0; q < decor.length; q++) {
      var dk = decor[q]; if (dk.kind !== 1) continue;
      var ee = edges(dk.d), yy = screenY(dk.d); if (yy < -10 || yy > H + 10) continue;
      var ex = dk.side < 0 ? ee.l : ee.r;
      ctx.beginPath(); ctx.moveTo(ex - dk.side * 2, yy - dk.len * 0.4); ctx.lineTo(ex - dk.side * (2 + dk.len * 0.5), yy + dk.len * 0.4); ctx.stroke();
    }

    // lit rim along the corridor edges
    function edgeStroke(arr, col, wid) {
      ctx.beginPath(); ctx.moveTo(arr[0], ys[0]); for (var k = 1; k < ys.length; k++) ctx.lineTo(arr[k], ys[k]); ctx.strokeStyle = col; ctx.lineWidth = wid; ctx.stroke();
    }
    ctx.lineJoin = "round";
    edgeStroke(L, "rgba(20,12,7,0.9)", 5); edgeStroke(R, "rgba(20,12,7,0.9)", 5);
    edgeStroke(L, "rgba(255,168,92,0.5)", 2); edgeStroke(R, "rgba(255,168,92,0.5)", 2);

    // obstacles (rock — will loom out of the dark under the veil)
    for (var o = 0; o < obstacles.length; o++) drawObstacle(obstacles[o]);

    // player figure
    drawPlayer();

    // ---- torch lighting: darkness veil (elliptical reveal around the torch) ----
    var fl = 1 + 0.035 * Math.sin(flick * 1.7) + 0.02 * Math.sin(flick * 4.3);
    var cxT = player.x, cyT = playerScreenY - H * 0.11;
    var rx = W * 0.47 * fl, ry = H * 0.54 * fl;
    ctx.save();
    ctx.translate(cxT, cyT); ctx.scale(rx / ry, 1);
    var veil = ctx.createRadialGradient(0, 0, 0, 0, 0, ry);
    veil.addColorStop(0, "rgba(6,4,7,0)"); veil.addColorStop(0.46, "rgba(6,4,7,0)");
    veil.addColorStop(0.72, "rgba(6,4,7,0.5)"); veil.addColorStop(1, "rgba(4,3,5,0.985)");
    ctx.fillStyle = veil; ctx.fillRect(-W * 3, -H * 3, W * 6, H * 6);
    ctx.restore();

    // gems — drawn after the veil so they glimmer as they enter torchlight
    for (var g = 0; g < gems.length; g++) drawGem(gems[g], cxT, cyT, Math.max(rx, ry));

    // warm torch pool (additive, over the veil)
    ctx.save(); ctx.globalCompositeOperation = "lighter";
    ctx.translate(cxT, cyT); ctx.scale(rx / ry, 1);
    var pool = ctx.createRadialGradient(0, 0, 0, 0, 0, ry * 0.82);
    pool.addColorStop(0, "rgba(255,186,104,0.42)"); pool.addColorStop(0.4, "rgba(255,150,70,0.18)"); pool.addColorStop(1, "rgba(255,120,50,0)");
    ctx.fillStyle = pool; ctx.fillRect(-W * 3, -H * 3, W * 6, H * 6);
    ctx.restore();

    // torch flame + close glow on the player
    drawTorchGlow(fl);

    // motes
    ctx.save(); ctx.globalCompositeOperation = "lighter";
    for (var mm = 0; mm < motes.length; mm++) {
      var mt = motes[mm]; var dxm = mt.x - cxT, dym = (mt.y - cyT);
      var vis = 1 - clamp((Math.sqrt(dxm * dxm + dym * dym * 1.3) / (ry * 0.9)), 0, 1);
      if (vis <= 0.02) continue;
      var a = vis * (0.5 + 0.5 * Math.sin(mt.life * 3 + mt.x)) * 0.5;
      ctx.fillStyle = "rgba(255,214,150," + a.toFixed(3) + ")"; ctx.beginPath(); ctx.arc(mt.x, mt.y, mt.r, 0, 6.2832); ctx.fill();
    }
    ctx.restore();

    // particles (sparks / debris / floating text / confetti)
    for (var pp = 0; pp < particles.length; pp++) {
      var s = particles[pp], al = clamp(1 - s.life / s.max, 0, 1);
      if (s.text) { ctx.globalAlpha = al; ctx.fillStyle = s.color; ctx.font = "800 15px Archivo, system-ui, sans-serif"; ctx.textAlign = "center"; ctx.fillText(s.text, s.x, s.y); ctx.globalAlpha = 1; continue; }
      if (s.add) ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = al; ctx.fillStyle = s.color;
      if (s.rect) { ctx.save(); ctx.translate(s.x, s.y); ctx.rotate((s.rot || 0) + s.life * (s.vr || 0)); ctx.fillRect(-s.size / 2, -s.size / 2, s.size, s.size * 1.5); ctx.restore(); }
      else { ctx.beginPath(); ctx.arc(s.x, s.y, s.size, 0, 6.2832); ctx.fill(); }
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
    }
  }

  function drawObstacle(ob) {
    if (ob.type === 1) {
      var x = ob.x, y = screenY(ob.d); if (y < -40 || y > H + 40) return;
      var rg = ctx.createRadialGradient(x - ob.r * 0.4, y - ob.r * 0.5, ob.r * 0.2, x, y, ob.r);
      rg.addColorStop(0, "#3a2a1b"); rg.addColorStop(1, "#160e08");
      ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(x, y, ob.r, 0, 6.2832); ctx.fill();
      var ang = Math.atan2(playerScreenY - y, player.x - x);
      ctx.strokeStyle = "rgba(255,160,90,0.5)"; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.arc(x, y, ob.r - 0.6, ang - 1.1, ang + 1.1); ctx.stroke();
    } else {
      var baseX = ob.side < 0 ? ob.cx - ob.hw : ob.cx + ob.hw;
      var tipX = baseX + (ob.side < 0 ? ob.len : -ob.len);
      var yTop = screenY(ob.d + ob.half), yBot = screenY(ob.d - ob.half), yMid = screenY(ob.d);
      if (yMid < -50 || yMid > H + 50) return;
      ctx.beginPath(); ctx.moveTo(baseX, yTop); ctx.lineTo(tipX, yMid); ctx.lineTo(baseX, yBot); ctx.closePath();
      var tg = ctx.createLinearGradient(baseX, 0, tipX, 0); tg.addColorStop(0, "#241710"); tg.addColorStop(1, "#0f0906");
      ctx.fillStyle = tg; ctx.fill();
      ctx.strokeStyle = "rgba(255,158,84,0.42)"; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(baseX, yTop); ctx.lineTo(tipX, yMid); ctx.lineTo(baseX, yBot); ctx.stroke();
    }
  }

  function drawGem(g, cxT, cyT, R) {
    if (g.taken || g.missed) return;
    var x = g.x, y = screenY(g.d); if (y < -20 || y > H + 20) return;
    var dxg = x - cxT, dyg = (y - cyT);
    var vis = 1 - clamp(Math.sqrt(dxg * dxg + dyg * dyg * 1.25) / (R * 0.92), 0, 1);
    if (vis <= 0.02) return;
    var pulse = 0.7 + 0.3 * Math.sin(flick * 1.4 + g.spin);
    ctx.save(); ctx.globalCompositeOperation = "lighter";
    var gl = ctx.createRadialGradient(x, y, 0, x, y, 20);
    gl.addColorStop(0, "rgba(150,240,255," + (0.55 * vis * pulse).toFixed(3) + ")"); gl.addColorStop(1, "rgba(120,220,255,0)");
    ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(x, y, 20, 0, 6.2832); ctx.fill();
    ctx.restore();
    ctx.save(); ctx.globalAlpha = clamp(vis * 1.2, 0, 1); ctx.translate(x, y); ctx.rotate(g.spin + flick * 0.3);
    var r = GEM_R;
    ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(r * 0.72, -r * 0.15); ctx.lineTo(r * 0.5, r); ctx.lineTo(-r * 0.5, r); ctx.lineTo(-r * 0.72, -r * 0.15); ctx.closePath();
    var gg = ctx.createLinearGradient(-r, -r, r, r); gg.addColorStop(0, "#e8ffff"); gg.addColorStop(0.5, "#7fe6ff"); gg.addColorStop(1, "#2aa6d8");
    ctx.fillStyle = gg; ctx.fill();
    ctx.strokeStyle = "rgba(230,255,255,0.8)"; ctx.lineWidth = 1; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(0, r); ctx.moveTo(-r * 0.72, -r * 0.15); ctx.lineTo(r * 0.72, -r * 0.15); ctx.strokeStyle = "rgba(255,255,255,0.35)"; ctx.stroke();
    ctx.restore(); ctx.globalAlpha = 1;
  }

  function drawPlayer() {
    var px = player.x, py = playerScreenY + Math.sin(player.bob) * 1.4;
    var lean = clamp(player.vx * 0.0016, -0.42, 0.42);
    // contact shadow
    ctx.save(); ctx.globalCompositeOperation = "multiply";
    ctx.fillStyle = "rgba(0,0,0,0.35)"; ctx.beginPath(); ctx.ellipse(px, py + 9, PR * 0.9, PR * 0.5, 0, 0, 6.2832); ctx.fill();
    ctx.restore();
    ctx.save(); ctx.translate(px, py); ctx.rotate(lean);
    // cloak body — a rounded arrow pointing up (travel direction)
    ctx.beginPath();
    ctx.moveTo(0, -PR - 2);
    ctx.quadraticCurveTo(PR * 0.95, -PR * 0.2, PR * 0.7, PR * 0.9);
    ctx.quadraticCurveTo(0, PR * 1.25, -PR * 0.7, PR * 0.9);
    ctx.quadraticCurveTo(-PR * 0.95, -PR * 0.2, 0, -PR - 2);
    ctx.closePath();
    var bg = ctx.createLinearGradient(0, -PR, 0, PR); bg.addColorStop(0, "#4a3120"); bg.addColorStop(1, "#241509");
    ctx.fillStyle = bg; ctx.fill();
    ctx.strokeStyle = "rgba(255,176,96,0.55)"; ctx.lineWidth = 1.4; ctx.stroke();
    // hood/head
    ctx.fillStyle = "#c69a6c"; ctx.beginPath(); ctx.arc(0, -PR * 0.2, PR * 0.42, 0, 6.2832); ctx.fill();
    ctx.fillStyle = "rgba(60,38,22,0.6)"; ctx.beginPath(); ctx.arc(0, -PR * 0.34, PR * 0.44, Math.PI, 6.2832); ctx.fill();
    ctx.restore();
  }

  function drawTorchGlow(fl) {
    var px = player.x, py = playerScreenY + Math.sin(player.bob) * 1.4;
    var lean = clamp(player.vx * 0.0016, -0.42, 0.42);
    var tx = px + Math.sin(lean) * 10 + 7, ty = py - PR - 8;
    ctx.save(); ctx.globalCompositeOperation = "lighter";
    // close warm halo on the figure
    var halo = ctx.createRadialGradient(px, py, 0, px, py, PR * 3.4 * fl);
    halo.addColorStop(0, "rgba(255,196,120,0.5)"); halo.addColorStop(0.5, "rgba(255,150,70,0.18)"); halo.addColorStop(1, "rgba(255,120,50,0)");
    ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(px, py, PR * 3.4 * fl, 0, 6.2832); ctx.fill();
    // flame
    var flame = ctx.createRadialGradient(tx, ty, 0, tx, ty, 10 * fl);
    flame.addColorStop(0, "rgba(255,255,235,0.95)"); flame.addColorStop(0.35, "rgba(255,200,110,0.85)"); flame.addColorStop(1, "rgba(255,120,40,0)");
    ctx.fillStyle = flame; ctx.beginPath(); ctx.arc(tx, ty, 10 * fl, 0, 6.2832); ctx.fill();
    ctx.fillStyle = "rgba(255,250,230,0.95)"; ctx.beginPath(); ctx.arc(tx, ty, 2.1, 0, 6.2832); ctx.fill();
    ctx.restore();
  }

  // ---------------- loop ----------------
  var last = 0;
  function frame(ts) {
    var dt = last ? Math.min((ts - last) / 1000, 0.05) : 0; last = ts;
    if (dt > 0) update(dt);
    render();
    requestAnimationFrame(frame);
  }

  // ---------------- flow ----------------
  function resetRun() {
    travel = 0; speed = SPEED0; score = 0; gemScore = 0; gemStreak = 0; mult = 1;
    nodes = []; obstacles = []; gems = []; decor = []; particles = []; motes = [];
    meanderTarget = W / 2; shake = 0; nearCd = 0; dead = false;
    player.x = W / 2; player.tx = W / 2; player.vx = 0; player.bob = 0;
    // seed a straight, wide starting corridor around the visible band
    var startD = travel + playerScreenY - H - 200;
    for (var d = startD; d < travel + playerScreenY + 300; d += NODE_DZ) nodes.push({ d: d, cx: W / 2, hw: HW0 });
    comboEl.hidden = true;
    scoreEl.textContent = "0m";
    streamTerrain();
  }

  function startGame() {
    overlay.classList.add("is-hidden");
    setTimeout(function () { overlay.hidden = true; }, 240);
    started = true; running = true; dead = false;
    hintEl.classList.remove("is-gone");
    setTimeout(function () { hintEl.classList.add("is-gone"); }, 4500);
    unlock();
  }
  function advance() {
    if (dead) { resetRun(); startGame(); return; }
    if (!started) { resetRun(); startGame(); return; }
  }
  ovBtn.addEventListener("click", advance);

  // ---------------- input ----------------
  window.addEventListener("keydown", function (e) {
    if (e.code === "Space" || e.code === "Enter") { if (!started || dead) { e.preventDefault(); advance(); } return; }
    if (e.code === "ArrowLeft" || e.code === "KeyA") { keyL = true; e.preventDefault(); unlock(); }
    else if (e.code === "ArrowRight" || e.code === "KeyD") { keyR = true; e.preventDefault(); unlock(); }
  });
  window.addEventListener("keyup", function (e) {
    if (e.code === "ArrowLeft" || e.code === "KeyA") keyL = false;
    else if (e.code === "ArrowRight" || e.code === "KeyD") keyR = false;
  });

  var pointerDown = false;
  canvas.addEventListener("pointerdown", function (e) {
    e.preventDefault(); unlock();
    if (!started || dead) { advance(); return; }
    pointerDown = true; player.tx = clamp(e.clientX, PR, W - PR);
  });
  canvas.addEventListener("pointermove", function (e) {
    if (!started || dead) return;
    if (e.pointerType === "mouse" || pointerDown) player.tx = clamp(e.clientX, PR, W - PR);
  });
  window.addEventListener("pointerup", function () { pointerDown = false; });
  window.addEventListener("pointercancel", function () { pointerDown = false; });

  soundBtn.addEventListener("click", function () {
    soundOn = !soundOn; soundBtn.setAttribute("aria-pressed", soundOn ? "true" : "false");
    if (outGain) outGain.gain.value = soundOn ? 1 : 0; unlock();
  });

  // ============================ AUDIO ============================
  var actx = null, master = null, outGain = null, convo = null, wet = null;
  var droneG = null, windG = null, windBP = null, ambReady = false, dripT = 0;
  function initAudio() {
    if (actx) return;
    try {
      actx = new (window.AudioContext || window.webkitAudioContext)();
      outGain = actx.createGain(); outGain.gain.value = soundOn ? 1 : 0;
      master = actx.createGain(); master.gain.value = 0.9;
      convo = actx.createConvolver(); convo.buffer = makeImpulse(2.2, 3.0);
      wet = actx.createGain(); wet.gain.value = 0.26;
      master.connect(outGain); wet.connect(convo); convo.connect(outGain); outGain.connect(actx.destination);
      buildAmbient();
    } catch (e) { actx = null; }
  }
  function makeImpulse(dur, decay) {
    var n = Math.floor(actx.sampleRate * dur), buf = actx.createBuffer(2, n, actx.sampleRate);
    for (var ch = 0; ch < 2; ch++) { var d = buf.getChannelData(ch); for (var i = 0; i < n; i++) { var t = i / n; d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay); } }
    return buf;
  }
  function noiseBuffer(dur) {
    var n = Math.floor(actx.sampleRate * dur), b = actx.createBuffer(1, n, actx.sampleRate), dd = b.getChannelData(0);
    for (var i = 0; i < n; i++) dd[i] = Math.random() * 2 - 1;
    return b;
  }
  function buildAmbient() {
    if (ambReady) return; ambReady = true;
    // low cave drone
    droneG = actx.createGain(); droneG.gain.value = 0;
    var lp = actx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 240;
    [55, 82.4, 110].forEach(function (f, i) { var o = actx.createOscillator(); o.type = i === 2 ? "sine" : "triangle"; o.frequency.value = f; var g = actx.createGain(); g.gain.value = i === 2 ? 0.25 : 0.5; o.connect(g); g.connect(lp); o.start(); });
    lp.connect(droneG); droneG.connect(master); droneG.connect(wet);
    // wind bed (looping noise → bandpass)
    var src = actx.createBufferSource(); src.buffer = noiseBuffer(3); src.loop = true;
    windBP = actx.createBiquadFilter(); windBP.type = "bandpass"; windBP.frequency.value = 480; windBP.Q.value = 0.7;
    windG = actx.createGain(); windG.gain.value = 0;
    src.connect(windBP); windBP.connect(windG); windG.connect(master); windG.connect(wet); src.start();
  }
  function updateAudio() {
    if (!actx || !ambReady) return;
    var spn = clamp((speed - SPEED0) / (SPEEDMAX - SPEED0), 0, 1);
    droneG.gain.value = 0.06 * ambLevel;
    windG.gain.value = (0.02 + 0.085 * spn) * ambLevel;
    windBP.frequency.value = 420 + spn * 900;
    // occasional cave drip when running
    if (running && soundOn) { dripT -= 1 / 60; if (dripT <= 0 && Math.random() < 0.01) { dripT = 1.4 + Math.random() * 2.5; sndDrip(); } }
  }
  function unlock() { initAudio(); if (actx && actx.state === "suspended") actx.resume(); if (actx) { var b = actx.createBuffer(1, 1, 22050), s = actx.createBufferSource(); s.buffer = b; s.connect(actx.destination); s.start(0); } }
  function bus(g) { g.connect(master); g.connect(wet); }

  var PENTA = [0, 3, 5, 7, 10, 12, 15];
  function sndGem() {
    if (!actx || !soundOn) return; var t = actx.currentTime;
    var deg = PENTA[Math.min(PENTA.length - 1, gemStreak % PENTA.length + (mult - 1))];
    var f = 587.33 * Math.pow(2, deg / 12);
    [1, 2].forEach(function (h, i) { var o = actx.createOscillator(); o.type = i ? "sine" : "triangle"; o.frequency.value = f * h; var g = actx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(i ? 0.05 : 0.09, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0006, t + 0.34); o.connect(g); bus(g); o.start(t); o.stop(t + 0.4); });
  }
  function sndWhoosh() {
    if (!actx || !soundOn) return; var t = actx.currentTime;
    var src = actx.createBufferSource(); src.buffer = noiseBuffer(0.35);
    var bp = actx.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = 1.2; bp.frequency.setValueAtTime(1500, t); bp.frequency.exponentialRampToValueAtTime(350, t + 0.28);
    var g = actx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.14, t + 0.03); g.gain.exponentialRampToValueAtTime(0.0006, t + 0.3);
    src.connect(bp); bp.connect(g); bus(g); src.start(t); src.stop(t + 0.34);
  }
  function sndDrip() {
    if (!actx || !soundOn) return; var t = actx.currentTime;
    var o = actx.createOscillator(); o.type = "sine"; o.frequency.setValueAtTime(1400, t); o.frequency.exponentialRampToValueAtTime(760, t + 0.12);
    var g = actx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0004, t + 0.24);
    o.connect(g); g.connect(wet); g.connect(master); o.start(t); o.stop(t + 0.28);
  }
  function sndCrash() {
    if (!actx || !soundOn) return; var t = actx.currentTime;
    var o = actx.createOscillator(); o.type = "sine"; o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.5);
    var og = actx.createGain(); og.gain.setValueAtTime(0.0001, t); og.gain.exponentialRampToValueAtTime(0.5, t + 0.02); og.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
    o.connect(og); bus(og); o.start(t); o.stop(t + 0.75);
    var src = actx.createBufferSource(); src.buffer = noiseBuffer(0.6);
    var lp = actx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.setValueAtTime(1600, t); lp.frequency.exponentialRampToValueAtTime(240, t + 0.5);
    var ng = actx.createGain(); ng.gain.setValueAtTime(0.0001, t); ng.gain.exponentialRampToValueAtTime(0.4, t + 0.015); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
    var sh = actx.createWaveShaper(); sh.curve = (function () { var c = new Float32Array(256); for (var i = 0; i < 256; i++) { var x = i / 128 - 1; c[i] = Math.tanh(x * 2.4); } return c; })();
    src.connect(sh); sh.connect(lp); lp.connect(ng); bus(ng); src.start(t); src.stop(t + 0.6);
  }

  // ---------------- boot ----------------
  window.addEventListener("resize", function () { resize(); if (!nodes.length) resetRun(); });
  resize();
  resetRun();
  overlay.hidden = false;
  requestAnimationFrame(frame);
})();
