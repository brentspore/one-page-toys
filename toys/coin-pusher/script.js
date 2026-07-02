/* Coin Pusher — the arcade coin-pusher machine, in vanilla Canvas 2D.
 * A reciprocating steel plate at the back sweeps a pile of gold coins toward
 * you; drop coins onto the shelf (tap / hold to pour) and shove the pile off
 * the front ledge into your tray. Coins can also slip off the open front
 * corners into the side gutters and be lost — so aim for the middle.
 *
 * Physics runs in a flat top-down field (x across, y = depth toward you) and
 * is projected to a shallow 2.5D perspective. Coins collide as circles; the
 * plate is a moving wall that only ever pushes forward (a ratchet). */
(function () {
  "use strict";

  var canvas = document.getElementById("canvas");
  var ctx = canvas.getContext("2d");
  var scoreEl = document.getElementById("score");
  var bestEl = document.getElementById("best");
  var soundBtn = document.getElementById("soundBtn");
  var overlay = document.getElementById("overlay");
  var ovBtn = document.getElementById("ovBtn");
  var hintEl = document.getElementById("hint");

  var W = 0, H = 0, DPR = 1;

  // ---------- field (virtual, top-down) ----------
  var FW = 100;                 // field width  (x: 0..FW, left..right)
  var FD = 132;                 // field depth  (y: 0..FD, back..front)
  var CR = 6.6;                 // coin radius
  var PLATE_MIN = 15, PLATE_MAX = 34;   // front face of the pusher plate travels here
  var PUSH_PERIOD = 2.7;        // seconds per full push cycle
  var DROP_Y = PLATE_MAX + CR - 2;      // depth a dropped coin lands at (in the sweep zone)
  var SIDE_END = FD * 0.78;     // beyond this depth the side walls open (loss gutters)
  var FRICTION = 0.86;          // per-frame velocity damping (settles the pile)
  var MAX_COINS = 170;
  var STAR_VAL = 8;             // a star token is worth this much
  var STAR_CHANCE = 0.09;       // chance a dropped coin is a star

  // ---------- screen projection (set in resize) ----------
  var backY = 0, frontY = 0, backHalf = 0, frontHalf = 0, trayY = 0;

  // ---------- state ----------
  var coins = [];               // {x,y,vx,vy,z,vz,val,star,spin}
  var falling = [];             // payout coins dropping into the tray {sx,sy,vy,r,val,star,rot,vr,a}
  var sideLost = [];            // coins slipping into side gutters {sx,sy,vy,r,rot,vr,a}
  var pops = [];                // "+N" score popups {sx,sy,vy,a,txt,star}
  var sparks = [];              // gold sparkle particles {sx,sy,vx,vy,a,r,hue}
  var plateY = PLATE_MIN, prevPlateY = PLATE_MIN, phase = 0;
  var payout = 0, best = 0, shown = 0;   // shown = eased displayed score
  var soundOn = true, started = false;
  var lastClack = 0;

  try { best = parseInt(localStorage.getItem("coinpush_best"), 10) || 0; } catch (e) { best = 0; }
  bestEl.textContent = "Best " + best;

  // deterministic PRNG for the stable tray heap
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.floor(W * DPR); canvas.height = Math.floor(H * DPR);
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    // fit the machine to the viewport
    backY = H * 0.205;
    frontY = H * 0.70;
    trayY = H * 0.82;
    var maxHalf = W * 0.46;
    frontHalf = Math.min(maxHalf, W * 0.40);
    backHalf = frontHalf * 0.63;
  }
  window.addEventListener("resize", resize);

  // ---------- projection ----------
  function depthT(y) { return y / FD; }
  function halfAt(y) { return backHalf + depthT(y) * (frontHalf - backHalf); }
  function screenY(y) { return backY + depthT(y) * (frontY - backY); }
  function screenX(x, y) { return W / 2 + ((x / FW) - 0.5) * 2 * halfAt(y); }
  function unitPx(y) { return (2 * halfAt(y)) / FW; }        // px per field unit at depth y
  function coinRpx(y) { return CR * unitPx(y); }

  // ---------- setup ----------
  function seedPile() {
    coins = [];
    var rnd = mulberry32(20260702);
    var n = 44;
    for (var i = 0; i < n; i++) {
      var star = (i % 15 === 7);   // a few stars sprinkled in
      coins.push({
        x: CR + 2 + rnd() * (FW - 2 * CR - 4),
        y: DROP_Y + 3 + rnd() * (FD - DROP_Y - CR - 6),
        vx: 0, vy: 0, z: 0, vz: 0,
        val: star ? STAR_VAL : 1, star: star, spin: rnd() * 6.28
      });
    }
    // relax initial overlaps a few passes
    for (var p = 0; p < 8; p++) collideAll(true);
  }

  function reset() {
    resize();
    seedPile();
    falling = []; sideLost = []; pops = []; sparks = [];
    plateY = prevPlateY = PLATE_MIN; phase = 0;
    payout = 0; shown = 0;
    scoreEl.textContent = "0";
  }

  // ---------- coin drop ----------
  function dropCoin(px) {
    if (coins.length >= MAX_COINS) return;
    var x = clamp(fieldXFromScreen(px), CR + 1, FW - CR - 1);
    var star = Math.random() < STAR_CHANCE;
    coins.push({
      x: x, y: DROP_Y + (Math.random() - 0.5) * 3,
      vx: (Math.random() - 0.5) * 2, vy: 0,
      z: 24 + Math.random() * 5, vz: 0,
      val: star ? STAR_VAL : 1, star: star, spin: Math.random() * 6.28
    });
    dropSound(star);
  }
  // invert the perspective at the drop depth to get a field x from a screen x
  function fieldXFromScreen(px) {
    var hw = halfAt(DROP_Y);
    return (((px - W / 2) / (2 * hw)) + 0.5) * FW;
  }

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  // ---------- physics ----------
  function collideAll(positionalOnly) {
    var n = coins.length;
    for (var i = 0; i < n; i++) {
      var a = coins[i]; if (a.z > 0) continue;
      for (var j = i + 1; j < n; j++) {
        var b = coins[j]; if (b.z > 0) continue;
        var dx = b.x - a.x, dy = b.y - a.y;
        var d2 = dx * dx + dy * dy;
        var min = 2 * CR;
        if (d2 < min * min && d2 > 0.0001) {
          var d = Math.sqrt(d2);
          var nx = dx / d, ny = dy / d;
          var overlap = min - d;
          var half = overlap * 0.5;
          a.x -= nx * half; a.y -= ny * half;
          b.x += nx * half; b.y += ny * half;
          if (!positionalOnly) {
            var rvn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
            if (rvn < 0) {
              var imp = -rvn * 0.5;
              a.vx -= imp * nx; a.vy -= imp * ny;
              b.vx += imp * nx; b.vy += imp * ny;
              var mag = Math.abs(rvn);
              if (mag > 5) clackSound(Math.min(1, mag / 30));
            }
          }
        }
      }
    }
  }

  function step(dt) {
    // pusher plate reciprocates
    phase += (dt / PUSH_PERIOD) * Math.PI * 2;
    prevPlateY = plateY;
    plateY = PLATE_MIN + (PLATE_MAX - PLATE_MIN) * (0.5 - 0.5 * Math.cos(phase));
    var plateDV = plateY - prevPlateY;   // >0 advancing

    var i, c;
    // drop animation (z above shelf)
    for (i = 0; i < coins.length; i++) {
      c = coins[i];
      if (c.z > 0) {
        c.vz -= 220 * dt;
        c.z += c.vz * dt;
        if (c.z <= 0) { c.z = 0; c.vz = 0; }
      }
    }

    collideAll(false);

    var faceStop = plateY + CR;   // coins can't be behind the plate face
    for (i = 0; i < coins.length; i++) {
      c = coins[i];
      if (c.z > 0) continue;
      // plate wall: solid at all times, boosts forward only while advancing
      if (c.y < faceStop) {
        c.y = faceStop;
        if (plateDV > 0) c.vy = Math.max(c.vy, plateDV * 26);
        if (c.vy < 0) c.vy = 0;
      }
      // integrate
      c.x += c.vx * dt; c.y += c.vy * dt;
      c.vx *= FRICTION; c.vy *= FRICTION;
      c.spin += c.vx * 0.02;
      // side walls (only in the back section)
      if (c.y < SIDE_END) {
        if (c.x < CR) { c.x = CR; c.vx = Math.abs(c.vx) * 0.3; }
        else if (c.x > FW - CR) { c.x = FW - CR; c.vx = -Math.abs(c.vx) * 0.3; }
      }
    }

    // payout / loss sweep
    for (i = coins.length - 1; i >= 0; i--) {
      c = coins[i];
      if (c.z > 0) continue;
      if (c.y > FD) {                 // over the front ledge → tray
        winCoin(c);
        coins.splice(i, 1);
      } else if (c.y > SIDE_END && (c.x < -CR * 0.4 || c.x > FW + CR * 0.4)) {
        loseCoin(c);                  // slipped off an open side
        coins.splice(i, 1);
      }
    }
  }

  function winCoin(c) {
    payout += c.val;
    var sx = clamp(screenX(clamp(c.x, CR, FW - CR), FD), 30, W - 30);
    var r = coinRpx(FD) * (c.star ? 1.05 : 1);
    falling.push({ sx: sx, sy: frontY, vy: 60 + Math.random() * 40, r: r, val: c.val, star: c.star, rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 8, a: 1 });
    pops.push({ sx: sx, sy: frontY - 6, vy: -34, a: 1, txt: "+" + c.val, star: c.star });
    if (c.star) {
      for (var k = 0; k < 14; k++) sparks.push({ sx: sx, sy: frontY, vx: (Math.random() - 0.5) * 160, vy: -Math.random() * 200 - 30, a: 1, r: 2 + Math.random() * 2, hue: 40 + Math.random() * 20 });
      starSound();
    } else {
      payoutSound();
    }
    if (payout > best) { best = payout; try { localStorage.setItem("coinpush_best", String(best)); } catch (e) {} bestEl.textContent = "Best " + best; }
  }

  function loseCoin(c) {
    var side = c.x < FW / 2 ? -1 : 1;
    var sx = clamp(screenX(clamp(c.x, -4, FW + 4), c.y), -20, W + 20);
    sideLost.push({ sx: sx, sy: screenY(c.y), vy: 30, vx: side * 40, r: coinRpx(c.y), rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 10, a: 1 });
  }

  // ---------- render ----------
  function frameEls(dt) {
    var i, f;
    for (i = falling.length - 1; i >= 0; i--) {
      f = falling[i]; f.vy += 520 * dt; f.sy += f.vy * dt; f.rot += f.vr * dt;
      if (f.sy > trayY - 6) { f.sy = trayY - 6; f.vy *= -0.32; f.a -= dt * 2.2; }
      if (f.a <= 0) falling.splice(i, 1);
    }
    for (i = sideLost.length - 1; i >= 0; i--) {
      f = sideLost[i]; f.vy += 480 * dt; f.sy += f.vy * dt; f.sx += f.vx * dt; f.rot += f.vr * dt; f.a -= dt * 0.9;
      if (f.a <= 0 || f.sy > H + 40) sideLost.splice(i, 1);
    }
    for (i = pops.length - 1; i >= 0; i--) {
      var p = pops[i]; p.sy += p.vy * dt; p.a -= dt * 1.3; if (p.a <= 0) pops.splice(i, 1);
    }
    for (i = sparks.length - 1; i >= 0; i--) {
      var s = sparks[i]; s.vy += 320 * dt; s.sx += s.vx * dt; s.sy += s.vy * dt; s.a -= dt * 1.4; if (s.a <= 0) sparks.splice(i, 1);
    }
  }

  var TAU = Math.PI * 2;

  function drawCabinet() {
    // interior back gradient
    var bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#122130");
    bg.addColorStop(0.4, "#0d1824");
    bg.addColorStop(1, "#070d14");
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

    // marquee band
    var mg = ctx.createLinearGradient(0, 0, 0, backY * 0.92);
    mg.addColorStop(0, "#3a2a10"); mg.addColorStop(1, "#20160a");
    ctx.fillStyle = mg; ctx.fillRect(0, 0, W, backY * 0.92);
    // marquee bulbs
    var bulbs = Math.max(6, Math.floor(W / 78));
    for (var b = 0; b < bulbs; b++) {
      var bx = (b + 0.5) / bulbs * W;
      var tw = 0.6 + 0.4 * Math.sin(phase * 2 + b * 0.9);
      ctx.beginPath(); ctx.arc(bx, backY * 0.6, 3, 0, TAU);
      ctx.fillStyle = "rgba(255," + Math.floor(200 + 40 * tw) + ",120," + (0.5 + 0.45 * tw) + ")"; ctx.fill();
    }

    // playfield surface (a receding trapezoid)
    ctx.beginPath();
    ctx.moveTo(screenX(0, 0), screenY(0));
    ctx.lineTo(screenX(FW, 0), screenY(0));
    ctx.lineTo(screenX(FW, FD), screenY(FD));
    ctx.lineTo(screenX(0, FD), screenY(FD));
    ctx.closePath();
    var pg = ctx.createLinearGradient(0, backY, 0, frontY);
    pg.addColorStop(0, "#20303f"); pg.addColorStop(0.5, "#2b4152"); pg.addColorStop(1, "#33505f");
    ctx.fillStyle = pg; ctx.fill();
    // soft length vignette on the shelf
    ctx.save(); ctx.clip();
    var vg = ctx.createRadialGradient(W / 2, frontY, 10, W / 2, (backY + frontY) / 2, W * 0.6);
    vg.addColorStop(0, "rgba(120,170,200,0.10)"); vg.addColorStop(1, "rgba(0,0,0,0.28)");
    ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
    ctx.restore();

    // side walls (back section only — front opens into gutters)
    drawWall(0, -1);
    drawWall(FW, 1);

    // side loss-gutters (dark slots at the open front)
    ctx.fillStyle = "rgba(4,8,12,0.86)";
    var glx1 = screenX(0, SIDE_END), gly1 = screenY(SIDE_END);
    ctx.beginPath();
    ctx.moveTo(0, gly1); ctx.lineTo(glx1, gly1); ctx.lineTo(screenX(0, FD), screenY(FD)); ctx.lineTo(0, frontY + 26); ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(W, gly1); ctx.lineTo(screenX(FW, SIDE_END), gly1); ctx.lineTo(screenX(FW, FD), screenY(FD)); ctx.lineTo(W, frontY + 26); ctx.closePath(); ctx.fill();
  }

  function drawWall(fx, dir) {
    // vertical wall face from back to SIDE_END
    var wallH = coinRpx(FD * 0.5) * 1.4;
    ctx.beginPath();
    ctx.moveTo(screenX(fx, 0), screenY(0) - wallH * 0.7);
    ctx.lineTo(screenX(fx, SIDE_END), screenY(SIDE_END) - wallH);
    ctx.lineTo(screenX(fx, SIDE_END), screenY(SIDE_END));
    ctx.lineTo(screenX(fx, 0), screenY(0));
    ctx.closePath();
    var wg = ctx.createLinearGradient(screenX(fx, 0), 0, screenX(fx, 0) + dir * 40, 0);
    if (dir < 0) { wg.addColorStop(0, "#0c141d"); wg.addColorStop(1, "#22303e"); }
    else { wg.addColorStop(0, "#22303e"); wg.addColorStop(1, "#0c141d"); }
    ctx.fillStyle = wg; ctx.fill();
    // top rail highlight
    ctx.beginPath();
    ctx.moveTo(screenX(fx, 0), screenY(0) - wallH * 0.7);
    ctx.lineTo(screenX(fx, SIDE_END), screenY(SIDE_END) - wallH);
    ctx.lineWidth = 2; ctx.strokeStyle = "rgba(150,180,205,0.5)"; ctx.stroke();
  }

  function drawPlate() {
    var wallH = coinRpx(plateY) * 1.5;
    var lx = screenX(0, plateY), rx = screenX(FW, plateY), by = screenY(plateY);
    // back housing (behind the plate)
    ctx.beginPath();
    ctx.moveTo(screenX(0, 0), screenY(0));
    ctx.lineTo(screenX(FW, 0), screenY(0));
    ctx.lineTo(rx, by - wallH); ctx.lineTo(lx, by - wallH); ctx.closePath();
    var hg = ctx.createLinearGradient(0, backY, 0, by);
    hg.addColorStop(0, "#0a1119"); hg.addColorStop(1, "#182734"); ctx.fillStyle = hg; ctx.fill();
    // plate front face (the pushing wall)
    ctx.beginPath();
    ctx.moveTo(lx, by - wallH); ctx.lineTo(rx, by - wallH); ctx.lineTo(rx, by); ctx.lineTo(lx, by); ctx.closePath();
    var fg = ctx.createLinearGradient(0, by - wallH, 0, by);
    fg.addColorStop(0, "#c3ccd6"); fg.addColorStop(0.5, "#8794a1"); fg.addColorStop(1, "#4c5763");
    ctx.fillStyle = fg; ctx.fill();
    // brushed lines + top bevel
    ctx.strokeStyle = "rgba(255,255,255,0.5)"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(lx, by - wallH); ctx.lineTo(rx, by - wallH); ctx.stroke();
    ctx.strokeStyle = "rgba(0,0,0,0.35)"; ctx.lineWidth = 1;
    for (var g = 1; g < 4; g++) {
      var yy = by - wallH + (wallH / 4) * g;
      ctx.beginPath(); ctx.moveTo(lx, yy); ctx.lineTo(rx, yy); ctx.stroke();
    }
  }

  function drawCoinAt(sx, sy, r, rot, star, val) {
    var ry = r * 0.42;
    var thick = r * 0.30;
    // contact shadow
    ctx.beginPath(); ctx.ellipse(sx + r * 0.12, sy + ry * 0.7, r * 1.02, ry * 1.0, 0, 0, TAU);
    ctx.fillStyle = "rgba(0,0,0,0.30)"; ctx.fill();
    // edge (thickness peeking below the face)
    ctx.beginPath(); ctx.ellipse(sx, sy + thick, r, ry, 0, 0, TAU);
    ctx.fillStyle = star ? "#7d2a68" : "#9a6a1c"; ctx.fill();
    // face
    var fg = ctx.createRadialGradient(sx - r * 0.32, sy - ry * 0.5, r * 0.1, sx, sy, r);
    if (star) { fg.addColorStop(0, "#ffe6f6"); fg.addColorStop(0.4, "#ff9ad6"); fg.addColorStop(0.78, "#e05bb0"); fg.addColorStop(1, "#a23388"); }
    else { fg.addColorStop(0, "#fff6d2"); fg.addColorStop(0.42, "#ffdf87"); fg.addColorStop(0.8, "#eab53f"); fg.addColorStop(1, "#c08a24"); }
    ctx.beginPath(); ctx.ellipse(sx, sy, r, ry, 0, 0, TAU); ctx.fillStyle = fg; ctx.fill();
    // inner rim
    ctx.lineWidth = Math.max(1, r * 0.09);
    ctx.strokeStyle = star ? "rgba(120,40,100,0.6)" : "rgba(150,100,20,0.55)";
    ctx.beginPath(); ctx.ellipse(sx, sy, r * 0.74, ry * 0.74, 0, 0, TAU); ctx.stroke();
    // motif (only when big enough to read)
    if (r > 12) {
      if (star) drawStar(sx, sy, r * 0.42, ry / r, "rgba(255,240,250,0.92)");
      else drawStar(sx, sy, r * 0.34, ry / r, "rgba(180,130,30,0.55)");
    }
    // specular highlight
    ctx.beginPath(); ctx.ellipse(sx - r * 0.34, sy - ry * 0.42, r * 0.32, ry * 0.34, -0.5, 0, TAU);
    ctx.fillStyle = "rgba(255,255,255,0.5)"; ctx.fill();
  }

  function drawStar(cx, cy, rad, squash, color) {
    ctx.beginPath();
    for (var i = 0; i < 10; i++) {
      var a = -Math.PI / 2 + i * Math.PI / 5;
      var rr = (i % 2 === 0) ? rad : rad * 0.44;
      var px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr * squash;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath(); ctx.fillStyle = color; ctx.fill();
  }

  function drawCoin(c) {
    var sx = screenX(c.x, c.y);
    var sy = screenY(c.y) - c.z * unitPx(c.y);
    var r = coinRpx(c.y);
    if (c.z > 0.5) {
      // airborne shadow on the shelf
      var shr = r * (1 - Math.min(0.5, c.z / 60));
      ctx.beginPath(); ctx.ellipse(sx, screenY(c.y) + r * 0.2, shr, shr * 0.42, 0, 0, TAU);
      ctx.fillStyle = "rgba(0,0,0,0.24)"; ctx.fill();
    }
    drawCoinAt(sx, sy, r, c.spin, c.star, c.val);
  }

  function rr(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawTrayHeap() {
    // winnings bin
    var bw = W * 0.76, bx = W / 2 - bw / 2, top = trayY, bh = H - top - 6;
    rr(bx, top, bw, bh, 14);
    var g = ctx.createLinearGradient(0, top, 0, H);
    g.addColorStop(0, "#182430"); g.addColorStop(1, "#0a1016");
    ctx.fillStyle = g; ctx.fill();
    // inner shadow so it reads as a recessed bin
    ctx.save(); rr(bx, top, bw, bh, 14); ctx.clip();
    var sg = ctx.createLinearGradient(0, top, 0, top + 26);
    sg.addColorStop(0, "rgba(0,0,0,0.5)"); sg.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = sg; ctx.fillRect(bx, top, bw, 26);

    // the heap of won coins, growing with the total
    var n = Math.min(90, Math.floor(payout / 2));
    var rnd = mulberry32(7);
    var baseR = coinRpx(FD) * 0.58;
    var perRow = 26, hw = bw * 0.9, hx0 = W / 2 - hw / 2;
    for (var i = 0; i < n; i++) {
      var col = i % perRow;
      var stack = Math.floor(i / perRow);
      var hx = hx0 + (col + 0.5) / perRow * hw + (rnd() - 0.5) * 7;
      var hy = H - 16 - stack * baseR * 0.42 - rnd() * 3;
      drawCoinAt(hx, hy, baseR, 0, false, 1);
    }
    ctx.restore();
    // gold lip
    ctx.lineWidth = 3.5; ctx.strokeStyle = "rgba(255,214,120,0.5)";
    ctx.beginPath(); ctx.moveTo(bx + 10, top); ctx.lineTo(bx + bw - 10, top); ctx.stroke();
  }

  function draw(dt) {
    drawCabinet();
    drawPlate();

    // coins back-to-front
    coins.sort(function (a, b) { return a.y - b.y; });
    for (var i = 0; i < coins.length; i++) drawCoin(coins[i]);

    // front ledge lip
    ctx.beginPath();
    ctx.moveTo(screenX(0, FD), screenY(FD)); ctx.lineTo(screenX(FW, FD), screenY(FD));
    ctx.lineWidth = 4; ctx.strokeStyle = "rgba(255,214,120,0.5)"; ctx.stroke();
    ctx.lineWidth = 1.5; ctx.strokeStyle = "rgba(60,44,16,0.6)"; ctx.stroke();

    // tray heap + falling coins
    drawTrayHeap();
    var f;
    for (i = 0; i < sideLost.length; i++) { f = sideLost[i]; ctx.globalAlpha = Math.max(0, f.a); drawCoinAt(f.sx, f.sy, f.r, f.rot, false, 1); }
    ctx.globalAlpha = 1;
    for (i = 0; i < falling.length; i++) { f = falling[i]; ctx.globalAlpha = Math.max(0, f.a); drawCoinAt(f.sx, f.sy, f.r, f.rot, f.star, f.val); }
    ctx.globalAlpha = 1;

    // sparks
    for (i = 0; i < sparks.length; i++) {
      var s = sparks[i]; ctx.globalAlpha = Math.max(0, s.a);
      ctx.beginPath(); ctx.arc(s.sx, s.sy, s.r, 0, TAU);
      ctx.fillStyle = "hsl(" + s.hue + ",100%,70%)"; ctx.fill();
    }
    ctx.globalAlpha = 1;

    // score popups
    ctx.textAlign = "center"; ctx.font = "900 " + Math.round(H * 0.03) + "px Archivo, system-ui, sans-serif";
    for (i = 0; i < pops.length; i++) {
      var p = pops[i]; ctx.globalAlpha = Math.max(0, p.a);
      ctx.fillStyle = p.star ? "#ff9ad6" : "#ffe08a";
      ctx.fillText(p.txt, p.sx, p.sy);
    }
    ctx.globalAlpha = 1; ctx.textAlign = "start";

    // drop indicator following the cursor
    if (pointerX >= 0) {
      var ix = clamp(pointerX, 0, W);
      ctx.globalAlpha = 0.5 + 0.3 * Math.sin(phase * 3);
      ctx.beginPath(); ctx.moveTo(ix, backY * 0.98); ctx.lineTo(ix - 7, backY * 0.98 - 12); ctx.lineTo(ix + 7, backY * 0.98 - 12); ctx.closePath();
      ctx.fillStyle = "#ffe08a"; ctx.fill(); ctx.globalAlpha = 1;
    }

    // glass sheen
    var sh = ctx.createLinearGradient(0, 0, W, H);
    sh.addColorStop(0, "rgba(255,255,255,0.05)"); sh.addColorStop(0.28, "rgba(255,255,255,0)");
    sh.addColorStop(0.62, "rgba(255,255,255,0)"); sh.addColorStop(0.66, "rgba(255,255,255,0.04)"); sh.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = sh; ctx.fillRect(0, 0, W, H);
  }

  // ---------- loop ----------
  var last = 0, pointerX = -1;
  function loop(t) {
    if (!last) last = t;
    var dt = Math.min(0.033, (t - last) / 1000); last = t;
    if (started) { step(dt); } else { // idle: plate still moves so the intro looks alive
      phase += (dt / PUSH_PERIOD) * Math.PI * 2;
      prevPlateY = plateY;
      plateY = PLATE_MIN + (PLATE_MAX - PLATE_MIN) * (0.5 - 0.5 * Math.cos(phase));
    }
    frameEls(dt);
    // ease the score display
    if (Math.abs(shown - payout) > 0.5) { shown += (payout - shown) * Math.min(1, dt * 12); scoreEl.textContent = Math.round(shown); }
    else if (Math.round(shown) !== payout) { shown = payout; scoreEl.textContent = payout; }
    draw(dt);
    requestAnimationFrame(loop);
  }

  // ---------- audio (synth arcade voices) ----------
  var actx = null, master = null, outGain = null, reverb = null;
  function initAudio() {
    if (actx) return;
    try {
      actx = new (window.AudioContext || window.webkitAudioContext)();
      outGain = actx.createGain(); outGain.gain.value = soundOn ? 1 : 0;
      master = actx.createGain(); master.gain.value = 0.9;
      var lp = actx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 12000;
      reverb = actx.createConvolver(); reverb.buffer = makeImpulse(1.1, 2.6);
      var wet = actx.createGain(); wet.gain.value = 0.16;
      master.connect(lp); lp.connect(outGain);
      master.connect(reverb); reverb.connect(wet); wet.connect(outGain);
      outGain.connect(actx.destination);
    } catch (e) { actx = null; }
  }
  function makeImpulse(dur, decay) {
    var rate = actx.sampleRate, len = Math.floor(rate * dur), buf = actx.createBuffer(2, len, rate);
    for (var ch = 0; ch < 2; ch++) {
      var d = buf.getChannelData(ch);
      for (var i = 0; i < len; i++) { var t = i / len; d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay); }
      // gentle low-pass of the noise for a smoother tail
      for (var k = 1; k < len; k++) d[k] = d[k] * 0.6 + d[k - 1] * 0.4;
    }
    return buf;
  }
  function unlockAudio() {
    initAudio();
    if (actx && actx.state === "suspended") actx.resume();
    if (actx) { var b = actx.createBuffer(1, 1, 22050); var s = actx.createBufferSource(); s.buffer = b; s.connect(actx.destination); s.start(0); }
  }
  function blip(freq, t0, dur, type, gain, pan) {
    var o = actx.createOscillator(); o.type = type || "triangle"; o.frequency.value = freq;
    var g = actx.createGain(); g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    var p = actx.createStereoPanner ? actx.createStereoPanner() : null;
    if (p) { p.pan.value = pan || 0; o.connect(g); g.connect(p); p.connect(master); }
    else { o.connect(g); g.connect(master); }
    o.start(t0); o.stop(t0 + dur + 0.02);
  }
  function noiseTick(t0, dur, freq, q, gain) {
    var n = actx.createBufferSource(); var len = Math.floor(actx.sampleRate * dur);
    var buf = actx.createBuffer(1, len, actx.sampleRate); var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    n.buffer = buf;
    var bp = actx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = freq; bp.Q.value = q || 3;
    var g = actx.createGain(); g.gain.value = gain;
    n.connect(bp); bp.connect(g); g.connect(master); n.start(t0);
  }
  function dropSound(star) {
    if (!actx) return; var t = actx.currentTime;
    noiseTick(t, 0.05, 2600, 4, 0.18);
    blip(star ? 1500 : 1180 + Math.random() * 120, t, 0.09, "triangle", 0.10, (Math.random() - 0.5) * 0.5);
  }
  function clackSound(v) {
    if (!actx) return; var t = actx.currentTime;
    if (t - lastClack < 0.03) return; lastClack = t;
    noiseTick(t, 0.04, 1700 + Math.random() * 900, 5, 0.05 + v * 0.10);
    blip(900 + Math.random() * 500, t, 0.05, "square", 0.02 + v * 0.05, (Math.random() - 0.5) * 0.6);
  }
  function payoutSound() {
    if (!actx) return; var t = actx.currentTime;
    blip(1046, t, 0.14, "triangle", 0.12, (Math.random() - 0.5) * 0.4);
    blip(1568, t + 0.02, 0.16, "sine", 0.08, 0);
    noiseTick(t, 0.03, 3200, 6, 0.06);
  }
  function starSound() {
    if (!actx) return; var t = actx.currentTime;
    var notes = [784, 988, 1175, 1568, 1976];
    for (var i = 0; i < notes.length; i++) blip(notes[i], t + i * 0.05, 0.3, "triangle", 0.11, (i / 4 - 0.5) * 0.6);
  }

  // ---------- input ----------
  var POUR_DELAY = 340;      // must hold this long (ms) before a stream starts
  var POUR_INTERVAL = 150;   // ms between poured coins once streaming
  var holding = false, downTime = 0, lastPour = 0;
  function evX(e) {
    var r = canvas.getBoundingClientRect();
    return (e.touches && e.touches[0] ? e.touches[0].clientX : e.clientX) - r.left;
  }
  function beginPlay() {
    if (!started) { started = true; }
    overlay.classList.add("is-hidden");
    setTimeout(function () { overlay.hidden = true; }, 280);
    if (hintEl) setTimeout(function () { hintEl.classList.add("is-gone"); }, 4200);
  }
  function onDown(e) {
    unlockAudio();
    beginPlay();
    pointerX = evX(e);
    holding = true; downTime = performance.now(); lastPour = downTime;
    dropCoin(pointerX);
    e.preventDefault();
  }
  function onMove(e) { if (pointerX >= 0 || holding) pointerX = evX(e); }
  function onUp() { holding = false; }

  canvas.addEventListener("mousedown", onDown);
  canvas.addEventListener("mousemove", function (e) { pointerX = evX(e); if (holding) onMove(e); });
  window.addEventListener("mouseup", onUp);
  canvas.addEventListener("touchstart", onDown, { passive: false });
  canvas.addEventListener("touchmove", function (e) { onMove(e); e.preventDefault(); }, { passive: false });
  window.addEventListener("touchend", onUp);
  canvas.addEventListener("mouseleave", function () { if (!holding) pointerX = -1; });

  // held-pour: a stream only starts once the press is held past POUR_DELAY,
  // so a quick tap always drops exactly one coin (never two).
  setInterval(function () {
    if (!holding || !started) return;
    var t = performance.now();
    if (t - downTime < POUR_DELAY) return;
    if (t - lastPour >= POUR_INTERVAL) { dropCoin(pointerX); lastPour = t; }
  }, 40);

  if (ovBtn) ovBtn.addEventListener("click", function () { unlockAudio(); beginPlay(); });

  soundBtn.addEventListener("click", function () {
    soundOn = !soundOn;
    soundBtn.setAttribute("aria-pressed", soundOn ? "true" : "false");
    if (outGain) outGain.gain.value = soundOn ? 1 : 0;
  });

  // ---------- boot ----------
  reset();
  overlay.hidden = false;
  requestAnimationFrame(loop);
})();
