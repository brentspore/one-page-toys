/* Slide Puzzle — a sliding-tile picture puzzle.
 * The pictures are drawn procedurally (no external images, stays self-contained):
 * cycle a gallery of little generated scenes, pick one, scramble the tiles, and
 * slide them back into place. 3x3 / 4x4 / 5x5 for more or fewer pieces. Canvas 2D.
 */
(function () {
  "use strict";

  // ---- TUNABLES -----------------------------------------------------------
  var S = 900;              // source-picture resolution (square)
  var SIZES = [3, 4, 5];    // grid options (pieces per side)
  var SCRAMBLE_MOVES = 220; // random legal moves used to shuffle
  var SLIDE_TIME = 0.09;    // tile slide animation seconds
  // -------------------------------------------------------------------------

  var canvas = document.getElementById("canvas");
  var ctx = canvas.getContext("2d");
  var hintEl = document.querySelector(".hint");
  var movesChip = document.getElementById("movesChip");

  // offscreen source picture
  var srcCv = document.createElement("canvas"); srcCv.width = S; srcCv.height = S;
  var sctx = srcCv.getContext("2d");

  var W, H, DPR, bx, by, board;     // board pixel geometry
  var N = 3, BLANK = -1;
  var tiles = [];                   // tiles[pos] = tileIndex (0..N*N-1) or BLANK
  var blankPos = 0, moves = 0, solved = false, scrambled = false;
  var peek = false, confetti = [];
  var picIdx = 0, sizeIdx = 0;
  var anim = null;                  // {tile, fromPos, toPos, t}

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
      g.beginPath(); g.moveTo(0, S);
      var px = 0, py = base;
      g.lineTo(0, base);
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

  // ---- board --------------------------------------------------------------
  function resetBoard() {
    tiles = []; for (var i = 0; i < N * N; i++) tiles.push(i);
    tiles[N * N - 1] = BLANK; blankPos = N * N - 1;
    moves = 0; solved = false; scrambled = false; anim = null; confetti = [];
    updateChip();
  }
  function neighbors(pos) {
    var r = Math.floor(pos / N), c = pos % N, out = [];
    if (r > 0) out.push(pos - N); if (r < N - 1) out.push(pos + N);
    if (c > 0) out.push(pos - 1); if (c < N - 1) out.push(pos + 1);
    return out;
  }
  function scramble() {
    resetBoard();
    var prev = -1;
    for (var k = 0; k < SCRAMBLE_MOVES; k++) {
      var nb = neighbors(blankPos).filter(function (p) { return p !== prev; });
      var pick = nb[(Math.random() * nb.length) | 0];
      prev = blankPos; tiles[blankPos] = tiles[pick]; tiles[pick] = BLANK; blankPos = pick;
    }
    if (isSolved()) return scramble();   // reshuffle on the rare identity
    moves = 0; scrambled = true; solved = false; updateChip();
    if (hintEl) hintEl.classList.add("is-hidden");
  }
  function isSolved() {
    for (var i = 0; i < N * N - 1; i++) if (tiles[i] !== i) return false;
    return tiles[N * N - 1] === BLANK;
  }
  function tryMove(pos) {
    if (anim || solved) return;
    if (neighbors(pos).indexOf(blankPos) === -1) return;   // must be adjacent to gap
    var tile = tiles[pos];
    anim = { tile: tile, fromPos: pos, toPos: blankPos, t: 0 };
    tiles[blankPos] = tile; tiles[pos] = BLANK;
    var oldBlank = blankPos; blankPos = pos;
    moves++; updateChip(); click(tile);
    // resolve after animation completes (handled in loop)
    anim.done = function () {
      if (scrambled && isSolved()) win();
    };
    void oldBlank;
  }
  function updateChip() {
    if (!movesChip) return;
    movesChip.textContent = solved ? "Solved in " + moves + "!" : moves + (moves === 1 ? " move" : " moves");
    movesChip.classList.toggle("is-solved", solved);
  }

  // ---- geometry -----------------------------------------------------------
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = W * DPR; canvas.height = H * DPR;
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    board = Math.min(W * 0.9, H * 0.72, 640);
    bx = (W - board) / 2; by = Math.max(H * 0.54 - board / 2, H * 0.16);
  }

  // ---- render -------------------------------------------------------------
  function roundRect(x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function cellXY(pos) { return [bx + (pos % N) * cell(), by + Math.floor(pos / N) * cell()]; }
  function cell() { return board / N; }
  function drawTile(tile, x, y) {
    var cl = cell(), gap = cl * 0.035, ts = S / N, sc = tile % N, sr = Math.floor(tile / N), rr = cl * 0.06;
    ctx.save();
    roundRect(x + gap, y + gap, cl - gap * 2, cl - gap * 2, rr); ctx.clip();
    ctx.drawImage(srcCv, sc * ts, sr * ts, ts, ts, x + gap, y + gap, cl - gap * 2, cl - gap * 2);
    // bevel
    var bg = ctx.createLinearGradient(x, y, x, y + cl);
    bg.addColorStop(0, "rgba(255,255,255,0.22)"); bg.addColorStop(0.12, "rgba(255,255,255,0)");
    bg.addColorStop(0.85, "rgba(0,0,0,0)"); bg.addColorStop(1, "rgba(0,0,0,0.28)");
    ctx.fillStyle = bg; ctx.fillRect(x + gap, y + gap, cl - gap * 2, cl - gap * 2);
    ctx.restore();
    roundRect(x + gap, y + gap, cl - gap * 2, cl - gap * 2, rr);
    ctx.strokeStyle = "rgba(10,14,24,0.5)"; ctx.lineWidth = 1; ctx.stroke();
  }
  function render() {
    ctx.fillStyle = "#10131c"; ctx.fillRect(0, 0, W, H);
    // board recess
    roundRect(bx - 8, by - 8, board + 16, board + 16, 16);
    ctx.fillStyle = "#191d2b"; ctx.fill();
    ctx.strokeStyle = "rgba(150,170,210,0.14)"; ctx.lineWidth = 1.5; ctx.stroke();

    if (peek || solved) {
      // show the whole picture (goal / finished)
      ctx.save(); roundRect(bx, by, board, board, 10); ctx.clip();
      ctx.globalAlpha = solved ? 1 : 0.5;
      ctx.drawImage(srcCv, 0, 0, S, S, bx, by, board, board); ctx.restore();
      if (solved) { roundRect(bx, by, board, board, 10); ctx.strokeStyle = "rgba(125,255,176,0.8)"; ctx.lineWidth = 3; ctx.stroke(); }
    }
    if (!solved) {
      for (var pos = 0; pos < N * N; pos++) {
        var tile = tiles[pos]; if (tile === BLANK) continue;
        if (anim && anim.tile === tile) continue;             // drawn separately (animating)
        var xy = cellXY(pos); drawTile(tile, xy[0], xy[1]);
      }
      if (anim) {
        var f = cellXY(anim.fromPos), t = cellXY(anim.toPos), e = ease(anim.t);
        drawTile(anim.tile, f[0] + (t[0] - f[0]) * e, f[1] + (t[1] - f[1]) * e);
      }
    }
    // confetti
    for (var i = 0; i < confetti.length; i++) {
      var p = confetti[i]; ctx.save(); ctx.globalAlpha = Math.max(0, p.life); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.fillStyle = p.col; ctx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * 0.6); ctx.restore();
    }
    if (solved) {
      ctx.save(); ctx.textAlign = "center"; ctx.textBaseline = "middle";
      var big = Math.round(Math.min(W, H) * 0.06);
      ctx.font = "700 " + big + "px Geist, system-ui, sans-serif";
      ctx.shadowColor = "rgba(0,0,0,0.6)"; ctx.shadowBlur = 14; ctx.fillStyle = "#eafff2";
      ctx.fillText("Solved!", W / 2, by + board + big * 1.0);
      ctx.restore();
    }
  }
  function ease(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }

  // ---- loop ---------------------------------------------------------------
  var lastTs = null;
  function frame(ts) {
    var dt = lastTs !== null ? Math.min((ts - lastTs) / 1000, 0.05) : 0.016; lastTs = ts;
    if (anim) { anim.t += dt / SLIDE_TIME; if (anim.t >= 1) { var d = anim.done; anim = null; if (d) d(); } }
    if (confetti.length) { for (var i = confetti.length - 1; i >= 0; i--) { var p = confetti[i]; p.vy += 900 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt; p.life -= dt * 0.55; if (p.life <= 0) confetti.splice(i, 1); } }
    render(); requestAnimationFrame(frame);
  }

  function win() {
    solved = true; updateChip(); chime();
    var cols = ["#ff5d73", "#ffd166", "#06d6a0", "#4aa3df", "#c77dff"];
    for (var i = 0; i < 130; i++) confetti.push({ x: W / 2 + R(-board / 2, board / 2), y: by + board * 0.4, vx: R(-260, 260), vy: R(-620, -260), rot: R(0, 6.28), vr: R(-8, 8), s: R(7, 14), col: cols[(Math.random() * cols.length) | 0], life: 1 + Math.random() });
  }

  // ---- input --------------------------------------------------------------
  function hit(x, y) {
    if (x < bx || y < by || x > bx + board || y > by + board) return -1;
    var c = Math.floor((x - bx) / cell()), r = Math.floor((y - by) / cell());
    return r * N + c;
  }
  function down(x, y) { unlock(); if (!scrambled && !solved) return; var pos = hit(x, y); if (pos >= 0) tryMove(pos); }
  canvas.addEventListener("mousedown", function (e) { down(e.clientX, e.clientY); });
  canvas.addEventListener("touchstart", function (e) { e.preventDefault(); var t = e.touches[0]; down(t.clientX, t.clientY); }, { passive: false });

  document.getElementById("picBtn").addEventListener("click", function () { picIdx = (picIdx + 1) % PICTURES.length; drawSource(); resetBoard(); });
  var sizeBtn = document.getElementById("sizeBtn");
  sizeBtn.addEventListener("click", function () {
    sizeIdx = (sizeIdx + 1) % SIZES.length; N = SIZES[sizeIdx];
    sizeBtn.textContent = "Pieces: " + N + "×" + N; resetBoard();
  });
  document.getElementById("scrambleBtn").addEventListener("click", function () { unlock(); scramble(); });
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
  function click(tile) {
    if (!actx) return; var t = actx.currentTime;
    var o = actx.createOscillator(); o.type = "triangle"; o.frequency.value = 180 + (tile % 7) * 12;
    var g = actx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.06, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0004, t + 0.12);
    var lp = actx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 900;
    o.connect(lp); lp.connect(g); g.connect(master); o.start(t); o.stop(t + 0.14);
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
  resize(); window.addEventListener("resize", resize);
  picIdx = (Math.random() * PICTURES.length) | 0;   // random free picture on start
  drawSource(); resetBoard();
  requestAnimationFrame(frame);
})();
