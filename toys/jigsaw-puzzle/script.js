/* Jigsaw Puzzle — a real interlocking jigsaw.
 * Pieces have classic tab/blank edges; they scatter around the tray and you drag
 * each one home, where it snaps into place. Cycle a gallery of procedurally-drawn
 * scenes (no external images — stays self-contained), pick 3x3 / 4x4 / 5x5 for
 * more or fewer pieces. Canvas 2D.
 */
(function () {
  "use strict";

  // ---- TUNABLES -----------------------------------------------------------
  var S = 900;              // source-picture resolution (square)
  var SIZES = [3, 4, 5];    // grid options (pieces per side)
  var TAB_H = 0.26;         // jigsaw tab height as a fraction of a cell
  var SNAP_FRAC = 0.42;     // snap when within this fraction of a cell of home
  // -------------------------------------------------------------------------

  // Normalized jigsaw edge profile (x along 0..1, y perpendicular 0..1 head).
  // moveTo the start, then bezierCurveTo through the points in groups of three.
  var JIG = [
    [0, 0],
    [0.35, 0], [0.40, 0.125], [0.40, 0.25],
    [0.40, 0.45], [0.25, 0.45], [0.25, 0.70],
    [0.25, 0.95], [0.40, 1.0], [0.50, 1.0],
    [0.60, 1.0], [0.75, 0.95], [0.75, 0.70],
    [0.75, 0.45], [0.60, 0.45], [0.60, 0.25],
    [0.60, 0.125], [0.65, 0], [1.0, 0]
  ];

  var canvas = document.getElementById("canvas");
  var ctx = canvas.getContext("2d");
  var hintEl = document.querySelector(".hint");
  var chip = document.getElementById("movesChip");

  // offscreen source picture
  var srcCv = document.createElement("canvas"); srcCv.width = S; srcCv.height = S;
  var sctx = srcCv.getContext("2d");

  var W, H, DPR, tray, bx, by, cell;   // board geometry (tray = square side)
  var N = 3;
  var pieces = [];                     // draw order (placed first, then floating)
  var picIdx = 0, sizeIdx = 0;
  var peek = false, solved = false, confetti = [];
  var drag = null;                     // {piece, ox, oy}

  // ---- picture generators (each draws a square scene into g at size S) -----
  function R(a, b) { return a + Math.random() * (b - a); }
  function pSunset(g) {
    var sky = g.createLinearGradient(0, 0, 0, S * 0.64);
    sky.addColorStop(0, "#241a4e"); sky.addColorStop(0.45, "#e8556d"); sky.addColorStop(1, "#ffcf87");
    g.fillStyle = sky; g.fillRect(0, 0, S, S);
    var sx = S * R(0.32, 0.68), sy = S * 0.5;
    var sg = g.createRadialGradient(sx, sy, 0, sx, sy, S * 0.19);
    sg.addColorStop(0, "#fff6cf"); sg.addColorStop(0.55, "#ffce6b"); sg.addColorStop(1, "rgba(255,180,90,0)");
    g.fillStyle = sg; g.beginPath(); g.arc(sx, sy, S * 0.19, 0, 6.283); g.fill();
    g.fillStyle = "#ffe19a"; g.beginPath(); g.arc(sx, sy, S * 0.088, 0, 6.283); g.fill();
    var sea = g.createLinearGradient(0, S * 0.64, 0, S);
    sea.addColorStop(0, "#c76e66"); sea.addColorStop(1, "#3a1f52");
    g.fillStyle = sea; g.fillRect(0, S * 0.64, S, S * 0.36);
    g.save(); g.globalAlpha = 0.35; g.fillStyle = "#ffce6b";
    for (var i = 0; i < 26; i++) { var y = S * 0.65 + Math.random() * S * 0.34; g.fillRect(sx - S * 0.1, y, S * 0.2, 2.5); } g.restore();
    hills(g, S * 0.64, "#331d4a", 0.06);
  }
  function pAurora(g) {
    var sky = g.createLinearGradient(0, 0, 0, S);
    sky.addColorStop(0, "#050a1e"); sky.addColorStop(0.6, "#0a1636"); sky.addColorStop(1, "#0c2140");
    g.fillStyle = sky; g.fillRect(0, 0, S, S);
    for (var i = 0; i < 120; i++) { g.fillStyle = "rgba(220,230,255," + R(0.2, 0.9) + ")"; var r = R(0.5, 1.8); g.fillRect(R(0, S), R(0, S * 0.6), r, r); }
    g.save(); g.globalCompositeOperation = "lighter";
    var hues = [150, 165, 190, 280];
    for (i = 0; i < 5; i++) {
      var hue = hues[(Math.random() * hues.length) | 0], baseY = S * R(0.15, 0.5);
      g.strokeStyle = "hsla(" + hue + ",90%,60%,0.5)"; g.lineWidth = R(14, 34);
      g.beginPath();
      for (var x = 0; x <= S; x += S / 24) { var y = baseY + Math.sin(x * 0.012 + i) * S * 0.06 + Math.sin(x * 0.03 + i * 2) * S * 0.03; x === 0 ? g.moveTo(x, y) : g.lineTo(x, y); }
      g.stroke();
    }
    g.restore();
    hills(g, S * 0.8, "#04060f", 0.08); hills(g, S * 0.9, "#010208", 0.05);
  }
  function pMountains(g) {
    var sky = g.createLinearGradient(0, 0, 0, S);
    sky.addColorStop(0, "#6db3d9"); sky.addColorStop(0.55, "#bfe0ea"); sky.addColorStop(1, "#eef6f2");
    g.fillStyle = sky; g.fillRect(0, 0, S, S);
    var sx = S * R(0.55, 0.82); g.fillStyle = "#fff7e0"; g.beginPath(); g.arc(sx, S * 0.24, S * 0.07, 0, 6.283); g.fill();
    var cols = ["#8fb8c9", "#6f97ad", "#4f7286", "#31506a"];
    for (var k = 0; k < 4; k++) {
      g.fillStyle = cols[k]; var base = S * (0.42 + k * 0.15);
      g.beginPath(); g.moveTo(0, S); g.lineTo(0, base);
      for (var x = 0; x <= S; x += S / 6) { var y = base - R(0.02, 0.16) * S; g.lineTo(x, y); }
      g.lineTo(S, S); g.closePath(); g.fill();
    }
  }
  function pBauhaus(g) {
    g.fillStyle = "#f3ead6"; g.fillRect(0, 0, S, S);
    var cols = ["#e4572e", "#f3a712", "#2e86ab", "#1b1b1e", "#8ac926", "#c1292e"];
    for (var i = 0; i < 9; i++) {
      g.fillStyle = cols[(Math.random() * cols.length) | 0];
      var t = Math.random();
      if (t < 0.4) { g.beginPath(); g.arc(R(0.1, 0.9) * S, R(0.1, 0.9) * S, R(0.06, 0.2) * S, 0, 6.283); g.fill(); }
      else if (t < 0.7) { g.fillRect(R(0, 0.8) * S, R(0, 0.8) * S, R(0.1, 0.3) * S, R(0.1, 0.3) * S); }
      else { var x = R(0.1, 0.9) * S, y = R(0.1, 0.9) * S, s = R(0.1, 0.26) * S; g.beginPath(); g.moveTo(x, y - s); g.lineTo(x + s, y + s); g.lineTo(x - s, y + s); g.closePath(); g.fill(); }
    }
    g.strokeStyle = "#1b1b1e"; g.lineWidth = S * 0.02;
    g.beginPath(); g.moveTo(0, R(0.2, 0.8) * S); g.lineTo(S, R(0.2, 0.8) * S); g.stroke();
  }
  function pBalloons(g) {
    var sky = g.createLinearGradient(0, 0, 0, S);
    sky.addColorStop(0, "#4aa3df"); sky.addColorStop(1, "#cdeaf7");
    g.fillStyle = sky; g.fillRect(0, 0, S, S);
    g.fillStyle = "rgba(255,255,255,0.85)";
    for (var i = 0; i < 5; i++) { var cx = R(0, S), cy = R(S * 0.55, S * 0.9), r = R(0.05, 0.11) * S; for (var b = 0; b < 4; b++) { g.beginPath(); g.arc(cx + b * r * 0.8 - r, cy, r, 0, 6.283); g.fill(); } }
    var bc = [["#e63946", "#f1a208"], ["#2a9d8f", "#e9c46a"], ["#7209b7", "#f72585"], ["#118ab2", "#06d6a0"]];
    for (i = 0; i < 4; i++) {
      var x = S * (0.18 + i * 0.22 + R(-0.03, 0.03)), y = S * R(0.2, 0.55), rr = S * R(0.07, 0.11), c = bc[i % bc.length];
      var gg = g.createRadialGradient(x - rr * 0.3, y - rr * 0.3, rr * 0.2, x, y, rr);
      gg.addColorStop(0, c[1]); gg.addColorStop(1, c[0]); g.fillStyle = gg;
      g.beginPath(); g.ellipse(x, y, rr * 0.9, rr * 1.05, 0, 0, 6.283); g.fill();
      g.strokeStyle = "rgba(0,0,0,0.15)"; g.lineWidth = 1;
      g.beginPath(); g.moveTo(x - rr * 0.5, y + rr * 0.9); g.lineTo(x, y + rr * 1.4); g.lineTo(x + rr * 0.5, y + rr * 0.9); g.stroke();
      g.fillStyle = "#7a5230"; g.fillRect(x - rr * 0.12, y + rr * 1.4, rr * 0.24, rr * 0.2);
    }
  }
  function pWaves(g) {
    var sea = g.createLinearGradient(0, 0, 0, S);
    sea.addColorStop(0, "#013a63"); sea.addColorStop(0.5, "#0a6c8f"); sea.addColorStop(1, "#2ec4b6");
    g.fillStyle = sea; g.fillRect(0, 0, S, S);
    g.save(); g.globalCompositeOperation = "lighter";
    for (var i = 0; i < 9; i++) {
      g.strokeStyle = "rgba(180,240,240," + R(0.06, 0.2) + ")"; g.lineWidth = R(3, 10);
      g.beginPath();
      var yb = S * (i / 9);
      for (var x = 0; x <= S; x += S / 40) { var y = yb + Math.sin(x * 0.02 + i) * S * 0.03 + Math.sin(x * 0.05 + i * 2) * S * 0.012; x === 0 ? g.moveTo(x, y) : g.lineTo(x, y); }
      g.stroke();
    }
    g.restore();
    g.fillStyle = "rgba(255,255,255,0.8)";
    for (i = 0; i < 60; i++) g.fillRect(R(0, S), R(0, S), R(1, 3), R(1, 3));
  }
  function pNight(g) {
    var sky = g.createRadialGradient(S * 0.7, S * 0.3, 0, S * 0.5, S * 0.5, S);
    sky.addColorStop(0, "#1a2350"); sky.addColorStop(0.6, "#0d1230"); sky.addColorStop(1, "#05061a");
    g.fillStyle = sky; g.fillRect(0, 0, S, S);
    for (var i = 0; i < 160; i++) { g.fillStyle = "rgba(230,235,255," + R(0.2, 1) + ")"; var r = R(0.5, 2.2); g.fillRect(R(0, S), R(0, S), r, r); }
    var mx = S * 0.7, my = S * 0.28, mr = S * 0.1;
    var mg = g.createRadialGradient(mx, my, 0, mx, my, mr * 2.6); mg.addColorStop(0, "rgba(255,250,220,0.5)"); mg.addColorStop(1, "rgba(255,250,220,0)");
    g.save(); g.globalCompositeOperation = "lighter"; g.fillStyle = mg; g.beginPath(); g.arc(mx, my, mr * 2.6, 0, 6.283); g.fill(); g.restore();
    g.fillStyle = "#fdf6d8"; g.beginPath(); g.arc(mx, my, mr, 0, 6.283); g.fill();
    g.fillStyle = "rgba(210,205,180,0.35)"; g.beginPath(); g.arc(mx + mr * 0.35, my - mr * 0.2, mr * 0.22, 0, 6.283); g.fill();
    hills(g, S * 0.82, "#0a1024", 0.09); hills(g, S * 0.92, "#03040f", 0.06);
  }
  function hills(g, baseY, col, amp) {
    g.fillStyle = col; g.beginPath(); g.moveTo(0, S); g.lineTo(0, baseY);
    for (var x = 0; x <= S; x += S / 10) g.lineTo(x, baseY - Math.random() * amp * S);
    g.lineTo(S, S); g.closePath(); g.fill();
  }
  var PICTURES = [pSunset, pAurora, pMountains, pBauhaus, pBalloons, pWaves, pNight];
  function drawSource() { sctx.clearRect(0, 0, S, S); PICTURES[picIdx % PICTURES.length](sctx); }

  // ---- geometry -----------------------------------------------------------
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = W * DPR; canvas.height = H * DPR;
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    tray = Math.min(W * 0.6, H * 0.56, 500);
    cell = tray / N;
    bx = (W - tray) / 2; by = Math.max(H * 0.52 - tray / 2, H * 0.2);
  }

  // ---- puzzle build -------------------------------------------------------
  function build() {
    solved = false; confetti = []; drag = null; pieces = [];
    // seam signs
    var vSeam = [], hSeam = [];   // vSeam[r][c] between (r,c)&(r,c+1); hSeam[r][c] between (r,c)&(r+1,c)
    for (var r = 0; r < N; r++) { vSeam[r] = []; hSeam[r] = []; for (var c = 0; c < N; c++) { vSeam[r][c] = Math.random() < 0.5 ? 1 : -1; hSeam[r][c] = Math.random() < 0.5 ? 1 : -1; } }
    for (r = 0; r < N; r++) for (c = 0; c < N; c++) {
      pieces.push({
        col: c, row: r,
        top:    r === 0 ? 0 : -hSeam[r - 1][c],
        bottom: r === N - 1 ? 0 : hSeam[r][c],
        left:   c === 0 ? 0 : -vSeam[r][c - 1],
        right:  c === N - 1 ? 0 : vSeam[r][c],
        x: 0, y: 0, placed: false
      });
    }
    scatter();
    if (hintEl) hintEl.classList.remove("is-hidden");
  }
  function scatter() {
    solved = false; confetti = [];
    var minY = 108, maxY = H - cell - 24, minX = 24, maxX = W - cell - 24;
    if (maxY < minY) maxY = minY; if (maxX < minX) maxX = minX;
    for (var i = 0; i < pieces.length; i++) {
      var p = pieces[i]; p.placed = false;
      // scatter, biased to the sides so pieces don't all pile on the tray
      var tries = 0, x, y;
      do {
        x = R(minX, maxX); y = R(minY, maxY); tries++;
      } while (tries < 12 && x > bx - cell * 0.7 && x < bx + tray - cell * 0.3 && y > by - cell * 0.7 && y < by + tray - cell * 0.3);
      p.x = x; p.y = y;
    }
    // random draw order
    for (i = pieces.length - 1; i > 0; i--) { var j = (Math.random() * (i + 1)) | 0, t = pieces[i]; pieces[i] = pieces[j]; pieces[j] = t; }
    updateChip();
  }
  function homeXY(p) { return [bx + p.col * cell, by + p.row * cell]; }
  function placedCount() { var n = 0; for (var i = 0; i < pieces.length; i++) if (pieces[i].placed) n++; return n; }
  function updateChip() {
    if (!chip) return;
    var n = placedCount(), tot = pieces.length;
    chip.textContent = solved ? "Solved!" : n + " / " + tot;
    chip.classList.toggle("is-solved", solved);
  }

  // ---- piece path ---------------------------------------------------------
  function edgePath(ax, ay, bx2, by2, sign) {
    if (!sign) { ctx.lineTo(bx2, by2); return; }
    var dx = bx2 - ax, dy = by2 - ay, L = Math.hypot(dx, dy);
    var ux = dx / L, uy = dy / L, nx = uy, ny = -ux;   // outward normal
    function map(px, py) {
      var off = L * py * TAB_H * sign;
      return [ax + ux * L * px + nx * off, ay + uy * L * px + ny * off];
    }
    for (var i = 1; i < JIG.length; i += 3) {
      var c1 = map(JIG[i][0], JIG[i][1]), c2 = map(JIG[i + 1][0], JIG[i + 1][1]), e = map(JIG[i + 2][0], JIG[i + 2][1]);
      ctx.bezierCurveTo(c1[0], c1[1], c2[0], c2[1], e[0], e[1]);
    }
  }
  function piecePath(p, X, Y) {
    ctx.beginPath();
    ctx.moveTo(X, Y);
    edgePath(X, Y, X + cell, Y, p.top);
    edgePath(X + cell, Y, X + cell, Y + cell, p.right);
    edgePath(X + cell, Y + cell, X, Y + cell, p.bottom);
    edgePath(X, Y + cell, X, Y, p.left);
    ctx.closePath();
  }

  // ---- render -------------------------------------------------------------
  function drawPiece(p, lifted) {
    var X = p.x, Y = p.y;
    ctx.save();
    if (lifted) { ctx.shadowColor = "rgba(0,0,0,0.45)"; ctx.shadowBlur = 18; ctx.shadowOffsetY = 8; }
    piecePath(p, X, Y);
    if (lifted) { ctx.fillStyle = "#0b0e16"; ctx.fill(); }   // solid base so shadow reads
    ctx.restore();

    ctx.save();
    piecePath(p, X, Y); ctx.clip();
    // full source image aligned so this piece's home cell lands at (X,Y)
    ctx.drawImage(srcCv, 0, 0, S, S, X - p.col * cell, Y - p.row * cell, cell * N, cell * N);
    // soft top-light shading for relief
    var sg = ctx.createLinearGradient(X, Y, X, Y + cell);
    sg.addColorStop(0, "rgba(255,255,255,0.16)"); sg.addColorStop(0.12, "rgba(255,255,255,0)");
    sg.addColorStop(0.86, "rgba(0,0,0,0)"); sg.addColorStop(1, "rgba(0,0,0,0.22)");
    ctx.fillStyle = sg; ctx.fillRect(X - cell, Y - cell, cell * 3, cell * 3);
    ctx.restore();

    // edge lines: dark seam + inner highlight
    piecePath(p, X, Y);
    ctx.strokeStyle = "rgba(6,9,16," + (p.placed ? 0.4 : 0.6) + ")"; ctx.lineWidth = 1.4; ctx.stroke();
    piecePath(p, X + 0.6, Y + 0.6);
    ctx.strokeStyle = "rgba(255,255,255,0.14)"; ctx.lineWidth = 1; ctx.stroke();
  }
  function render() {
    ctx.fillStyle = "#12151f"; ctx.fillRect(0, 0, W, H);
    // tray recess
    roundRect(bx - 10, by - 10, tray + 20, tray + 20, 16);
    ctx.fillStyle = "#191d2b"; ctx.fill();
    ctx.strokeStyle = "rgba(150,170,210,0.14)"; ctx.lineWidth = 1.5; ctx.stroke();
    // inner tray face
    roundRect(bx, by, tray, tray, 8); ctx.fillStyle = "#0d1018"; ctx.fill();
    // peek ghost
    if (peek && !solved) {
      ctx.save(); roundRect(bx, by, tray, tray, 8); ctx.clip();
      ctx.globalAlpha = 0.28; ctx.drawImage(srcCv, 0, 0, S, S, bx, by, tray, tray); ctx.restore();
    }
    // faint grid guide
    ctx.save(); ctx.globalAlpha = 0.5; ctx.strokeStyle = "rgba(150,170,210,0.08)"; ctx.lineWidth = 1;
    for (var i = 1; i < N; i++) {
      ctx.beginPath(); ctx.moveTo(bx + i * cell, by); ctx.lineTo(bx + i * cell, by + tray); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(bx, by + i * cell); ctx.lineTo(bx + tray, by + i * cell); ctx.stroke();
    }
    ctx.restore();

    // placed pieces (flush), then floating pieces (with shadow), drag piece last
    for (i = 0; i < pieces.length; i++) if (pieces[i].placed) drawPiece(pieces[i], false);
    for (i = 0; i < pieces.length; i++) { var p = pieces[i]; if (!p.placed && !(drag && drag.piece === p)) drawPiece(p, true); }
    if (drag) drawPiece(drag.piece, true);

    if (solved) {
      roundRect(bx, by, tray, tray, 8); ctx.strokeStyle = "rgba(125,255,176,0.85)"; ctx.lineWidth = 3; ctx.stroke();
    }
    // confetti
    for (i = 0; i < confetti.length; i++) {
      var q = confetti[i]; ctx.save(); ctx.globalAlpha = Math.max(0, q.life); ctx.translate(q.x, q.y); ctx.rotate(q.rot);
      ctx.fillStyle = q.col; ctx.fillRect(-q.s / 2, -q.s / 2, q.s, q.s * 0.6); ctx.restore();
    }
    if (solved) {
      ctx.save(); ctx.textAlign = "center"; ctx.textBaseline = "middle";
      var big = Math.round(Math.min(W, H) * 0.06);
      ctx.font = "700 " + big + "px Geist, system-ui, sans-serif";
      ctx.shadowColor = "rgba(0,0,0,0.6)"; ctx.shadowBlur = 14; ctx.fillStyle = "#eafff2";
      ctx.fillText("Solved!", W / 2, by + tray + big * 1.0);
      ctx.restore();
    }
  }
  function roundRect(x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  // ---- loop ---------------------------------------------------------------
  var lastTs = null;
  function frame(ts) {
    var dt = lastTs !== null ? Math.min((ts - lastTs) / 1000, 0.05) : 0.016; lastTs = ts;
    if (confetti.length) { for (var i = confetti.length - 1; i >= 0; i--) { var p = confetti[i]; p.vy += 900 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt; p.life -= dt * 0.55; if (p.life <= 0) confetti.splice(i, 1); } }
    render(); requestAnimationFrame(frame);
  }

  function win() {
    solved = true; updateChip(); chime();
    var cols = ["#ff5d73", "#ffd166", "#06d6a0", "#4aa3df", "#c77dff"];
    for (var i = 0; i < 140; i++) confetti.push({ x: W / 2 + R(-tray / 2, tray / 2), y: by + tray * 0.4, vx: R(-260, 260), vy: R(-640, -260), rot: R(0, 6.28), vr: R(-8, 8), s: R(7, 14), col: cols[(Math.random() * cols.length) | 0], life: 1 + Math.random() });
  }

  // ---- input --------------------------------------------------------------
  function pieceAt(x, y) {
    // isPointInPath expects device pixels (it ignores the current transform),
    // so scale the CSS-pixel cursor by DPR — otherwise nothing is grabbable on
    // high-DPI (Retina) screens where DPR > 1.
    var dx = x * DPR, dy = y * DPR;
    for (var i = pieces.length - 1; i >= 0; i--) {
      var p = pieces[i]; if (p.placed) continue;
      piecePath(p, p.x, p.y);
      if (ctx.isPointInPath(dx, dy)) return p;
    }
    return null;
  }
  function down(x, y) {
    unlock(); if (solved) return;
    var p = pieceAt(x, y); if (!p) return;
    drag = { piece: p, ox: x - p.x, oy: y - p.y };
    // bring to top of array
    var idx = pieces.indexOf(p); pieces.splice(idx, 1); pieces.push(p);
    lift();
  }
  function move(x, y) { if (drag) { drag.piece.x = x - drag.ox; drag.piece.y = y - drag.oy; } }
  function up() {
    if (!drag) return;
    var p = drag.piece, h = homeXY(p);
    if (Math.hypot(p.x - h[0], p.y - h[1]) < cell * SNAP_FRAC) {
      p.x = h[0]; p.y = h[1]; p.placed = true; snap();
      // move placed piece to the bottom so it sits under floating ones
      var idx = pieces.indexOf(p); pieces.splice(idx, 1); pieces.unshift(p);
      updateChip();
      if (hintEl) hintEl.classList.add("is-hidden");
      if (placedCount() === pieces.length) win();
    }
    drag = null;
  }
  canvas.addEventListener("mousedown", function (e) { down(e.clientX, e.clientY); });
  window.addEventListener("mousemove", function (e) { move(e.clientX, e.clientY); });
  window.addEventListener("mouseup", up);
  canvas.addEventListener("touchstart", function (e) { e.preventDefault(); var t = e.touches[0]; down(t.clientX, t.clientY); }, { passive: false });
  canvas.addEventListener("touchmove", function (e) { e.preventDefault(); var t = e.touches[0]; move(t.clientX, t.clientY); }, { passive: false });
  window.addEventListener("touchend", up);

  document.getElementById("picBtn").addEventListener("click", function () { picIdx = (picIdx + 1) % PICTURES.length; drawSource(); build(); });
  var sizeBtn = document.getElementById("sizeBtn");
  sizeBtn.addEventListener("click", function () {
    sizeIdx = (sizeIdx + 1) % SIZES.length; N = SIZES[sizeIdx]; cell = tray / N;
    sizeBtn.textContent = "Pieces: " + N + "×" + N; build();
  });
  document.getElementById("shuffleBtn").addEventListener("click", function () { unlock(); scatter(); if (hintEl) hintEl.classList.remove("is-hidden"); });
  var peekBtn = document.getElementById("peekBtn");
  peekBtn.addEventListener("click", function () { peek = !peek; peekBtn.setAttribute("aria-pressed", peek ? "true" : "false"); });

  // ---- audio (synth) ------------------------------------------------------
  var actx = null, master = null, outGain = null, muted = false;
  function unlock() {
    if (actx) { if (actx.state === "suspended") actx.resume(); return; }
    try {
      actx = new (window.AudioContext || window.webkitAudioContext)();
      var b = actx.createBuffer(1, 1, 22050), s = actx.createBufferSource(); s.buffer = b; s.connect(actx.destination); s.start(0);
      outGain = actx.createGain(); outGain.gain.value = muted ? 0 : 1; outGain.connect(actx.destination);
      master = actx.createGain(); master.gain.value = 0.6; master.connect(outGain);
    } catch (e) { actx = null; }
  }
  function lift() {
    if (!actx) return; var t = actx.currentTime;
    var o = actx.createOscillator(); o.type = "sine"; o.frequency.value = 320;
    var g = actx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.03, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0004, t + 0.08);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.1);
  }
  function snap() {
    if (!actx) return; var t = actx.currentTime;
    // woody click: short filtered noise + low thunk
    var n = actx.createBufferSource(), len = 0.05 * actx.sampleRate, buf = actx.createBuffer(1, len, actx.sampleRate), d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
    n.buffer = buf; var bp = actx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 1700; bp.Q.value = 0.8;
    var ng = actx.createGain(); ng.gain.value = 0.09; n.connect(bp); bp.connect(ng); ng.connect(master); n.start(t);
    var o = actx.createOscillator(); o.type = "triangle"; o.frequency.setValueAtTime(220, t); o.frequency.exponentialRampToValueAtTime(120, t + 0.06);
    var g = actx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.07, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0004, t + 0.11);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.13);
  }
  function chime() {
    if (!actx) return; var t = actx.currentTime, notes = [523, 659, 784, 1047, 1319];
    notes.forEach(function (f, i) {
      var o = actx.createOscillator(); o.type = "triangle"; o.frequency.value = f; var st = t + i * 0.08;
      var g = actx.createGain(); g.gain.setValueAtTime(0.0001, st); g.gain.exponentialRampToValueAtTime(0.11, st + 0.02); g.gain.exponentialRampToValueAtTime(0.0005, st + 0.6);
      o.connect(g); g.connect(master); o.start(st); o.stop(st + 0.65);
    });
  }
  var soundBtn = document.getElementById("soundBtn");
  soundBtn.addEventListener("click", function () {
    muted = !muted; unlock();
    if (outGain) outGain.gain.setTargetAtTime(muted ? 0 : 1, actx.currentTime, 0.02);
    soundBtn.textContent = muted ? "Sound: off" : "Sound: on";
    soundBtn.setAttribute("aria-pressed", muted ? "true" : "false");
  });

  // ---- boot ---------------------------------------------------------------
  resize();
  window.addEventListener("resize", function () { var pf = pieces.map(function (p) { return { c: p.col, r: p.row, placed: p.placed }; }); resize(); relayout(pf); });
  function relayout(pf) {
    // keep placed pieces snapped to their (new) home; leave floaters where they are, clamped
    for (var i = 0; i < pieces.length; i++) {
      var p = pieces[i];
      if (p.placed) { var h = homeXY(p); p.x = h[0]; p.y = h[1]; }
      else { p.x = Math.max(10, Math.min(W - cell - 10, p.x)); p.y = Math.max(100, Math.min(H - cell - 10, p.y)); }
    }
  }
  picIdx = (Math.random() * PICTURES.length) | 0;   // random free picture on start
  drawSource(); build();
  requestAnimationFrame(frame);
})();
