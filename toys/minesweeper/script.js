/* Minesweeper — obsidian-glass board, first-click-safe, flag + chord, best-per-difficulty.
   Full-bleed Canvas 2D; synth audio bus; touch-first (long-press to flag). */
(function () {
  "use strict";

  var canvas = document.getElementById("canvas");
  var ctx = canvas.getContext("2d");
  var RM = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------- difficulty ----------
  // w >= h; on portrait devices the board is transposed so tiles stay tappable.
  var DIFF = {
    easy:   { w: 9,  h: 9,  mines: 10, label: "Easy" },
    medium: { w: 16, h: 16, mines: 40, label: "Medium" },
    hard:   { w: 30, h: 16, mines: 99, label: "Hard" }
  };
  var ORDER = ["easy", "medium", "hard"];
  var diffKey = (function () {
    try { var s = localStorage.getItem("mines_diff"); if (s && DIFF[s]) return s; } catch (e) {}
    return "easy";
  })();

  // number colours — classic palette, brightened for a dark board
  var NUMCOL = ["", "#5b9dff", "#43d17f", "#ff6b6b", "#c08cff", "#ffb454", "#2fd4c8", "#dfe4ec", "#9aa2ad"];

  // ---------- state ----------
  var cols = 9, rows = 9, mines = 10, total = 81;
  var mineArr, adjArr, stateArr, revealT, flagT; // state: 0 hidden, 1 revealed, 2 flagged
  var placed = false, phase = "ready", revealedCount = 0, flagCount = 0;
  var startMs = 0, endMs = 0, timerRunning = false, lastNewBest = false;
  var explodedIdx = -1;
  var particles = [];
  var shake = 0;
  var flash = 0;
  var hoverIdx = -1;
  var now = 0;

  // ---------- layout ----------
  var DPR = 1, W = 0, H = 0;
  var cell = 30, boardX = 0, boardY = 0, boardW = 0, boardH = 0;
  var TOPBAR = 62, BOTTOMBAR = 44, PAD = 14, TRAY = 9;

  function resize() {
    DPR = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    layout();
  }
  function layout() {
    var availW = W - PAD * 2 - TRAY * 2;
    var availH = H - TOPBAR - BOTTOMBAR - TRAY * 2;
    cell = Math.floor(Math.min(availW / cols, availH / rows));
    cell = Math.max(12, Math.min(cell, 52));
    boardW = cols * cell; boardH = rows * cell;
    boardX = Math.round((W - boardW) / 2);
    var region = H - TOPBAR - BOTTOMBAR;
    boardY = Math.round(TOPBAR + Math.max(0, (region - boardH) / 2));
  }

  // ---------- board setup ----------
  function newGame(key) {
    if (key && DIFF[key]) diffKey = key;
    try { localStorage.setItem("mines_diff", diffKey); } catch (e) {}
    var base = DIFF[diffKey];
    var landscape = window.innerWidth >= window.innerHeight;
    if (base.w !== base.h && !landscape) { cols = base.h; rows = base.w; }
    else { cols = base.w; rows = base.h; }
    mines = base.mines; total = cols * rows;

    mineArr = new Uint8Array(total);
    adjArr = new Uint8Array(total);
    stateArr = new Uint8Array(total);
    revealT = new Float64Array(total);
    flagT = new Float64Array(total);
    placed = false; phase = "ready"; revealedCount = 0; flagCount = 0;
    explodedIdx = -1; particles.length = 0; shake = 0; flash = 0;
    timerRunning = false; startMs = 0; endMs = 0;
    layout();
    updateHud();
    syncDiffUi();
  }

  function idx(c, r) { return r * cols + c; }
  function inb(c, r) { return c >= 0 && c < cols && r >= 0 && r < rows; }
  function eachNeighbor(i, fn) {
    var c = i % cols, r = (i / cols) | 0;
    for (var dr = -1; dr <= 1; dr++) for (var dc = -1; dc <= 1; dc++) {
      if (!dc && !dr) continue;
      if (inb(c + dc, r + dr)) fn(idx(c + dc, r + dr));
    }
  }

  function placeMines(safe) {
    var banned = {};
    banned[safe] = 1;
    eachNeighbor(safe, function (n) { banned[n] = 1; });
    var pool = [];
    for (var i = 0; i < total; i++) if (!banned[i]) pool.push(i);
    // Fisher-Yates, take `mines`
    var need = Math.min(mines, pool.length);
    for (var k = 0; k < need; k++) {
      var j = k + Math.floor(Math.random() * (pool.length - k));
      var t = pool[k]; pool[k] = pool[j]; pool[j] = t;
      mineArr[pool[k]] = 1;
    }
    for (var m = 0; m < total; m++) {
      if (mineArr[m]) continue;
      var cnt = 0;
      eachNeighbor(m, function (n) { if (mineArr[n]) cnt++; });
      adjArr[m] = cnt;
    }
    placed = true;
  }

  // ---------- actions ----------
  function reveal(i) {
    if (phase === "won" || phase === "lost") return;
    if (stateArr[i] === 1 || stateArr[i] === 2) return;
    if (!placed) { placeMines(i); startTimer(); phase = "playing"; }

    if (mineArr[i]) { stateArr[i] = 1; revealT[i] = now; explode(i); return; }

    // flood-fill (BFS) with staggered reveal times for the ripple
    var queue = [i], depth = { }; depth[i] = 0;
    var revealedNow = 0, head = 0;
    while (head < queue.length) {
      var cur = queue[head++];
      if (stateArr[cur] === 1) continue;
      if (stateArr[cur] === 2) continue; // don't auto-open flagged
      stateArr[cur] = 1;
      revealT[cur] = now + Math.min(depth[cur], 12) * 16;
      revealedCount++; revealedNow++;
      if (adjArr[cur] === 0 && !mineArr[cur]) {
        eachNeighbor(cur, function (n) {
          if (stateArr[n] === 0 && depth[n] === undefined) { depth[n] = depth[cur] + 1; queue.push(n); }
        });
      }
    }
    sfxReveal(revealedNow, i);
    checkWin();
  }

  function chord(i) {
    if (phase !== "playing") return;
    if (stateArr[i] !== 1 || adjArr[i] === 0) return;
    var flagged = 0;
    eachNeighbor(i, function (n) { if (stateArr[n] === 2) flagged++; });
    if (flagged !== adjArr[i]) { pulseCell(i); return; }
    var targets = [];
    eachNeighbor(i, function (n) { if (stateArr[n] === 0) targets.push(n); });
    if (!targets.length) return;
    for (var t = 0; t < targets.length; t++) reveal(targets[t]);
  }

  function toggleFlag(i) {
    if (phase === "won" || phase === "lost") return;
    if (stateArr[i] === 1) return;
    if (stateArr[i] === 2) { stateArr[i] = 0; flagCount--; sfxFlag(false); }
    else { stateArr[i] = 2; flagCount++; flagT[i] = now; sfxFlag(true); }
    if (phase === "ready") phase = "playing"; // allow flagging first
    updateHud();
  }

  function explode(i) {
    phase = "lost";
    explodedIdx = i;
    stopTimer();
    if (!RM) { shake = 1; flash = 1; }
    spawnEmber(i);
    // reveal every un-flagged mine, staggered outward from the blast
    // (correctly-flagged mines stay flagged; wrong flags get crossed out)
    var ec = i % cols, er = (i / cols) | 0;
    for (var m = 0; m < total; m++) {
      if (mineArr[m] && stateArr[m] === 0) {
        stateArr[m] = 1;
        var mc = m % cols, mr = (m / cols) | 0;
        var d = Math.hypot(mc - ec, mr - er);
        revealT[m] = now + (RM ? 0 : Math.min(d * 34, 620));
      }
    }
    sfxBoom();
    setTimeout(function () { showEnd(false); }, RM ? 260 : 1050);
    try { if (window.gtag) window.gtag("event", "minesweeper_lose", { level: diffKey }); } catch (e) {}
  }

  function checkWin() {
    if (revealedCount >= total - mines && phase === "playing") {
      phase = "won"; stopTimer();
      // auto-flag remaining mines
      for (var m = 0; m < total; m++) { if (mineArr[m] && stateArr[m] !== 2) { stateArr[m] = 2; flagT[m] = now; } }
      flagCount = mines; updateHud();
      lastNewBest = saveBest();
      if (!RM) spawnConfetti();
      sfxWin();
      setTimeout(function () { showEnd(true); }, RM ? 200 : 720);
      try { if (window.gtag) window.gtag("event", "minesweeper_win", { level: diffKey, time_ms: endMs - startMs }); } catch (e) {}
    }
  }

  function pulseCell(i) { flagT[i] = now; } // tiny nudge feedback for a bad chord

  // ---------- timer + best ----------
  function startTimer() { startMs = perfNow(); timerRunning = true; }
  function stopTimer() { if (timerRunning) { endMs = perfNow(); timerRunning = false; } }
  function elapsedSec() {
    if (!startMs) return 0;
    var e = (timerRunning ? perfNow() : endMs) - startMs;
    return Math.max(0, e / 1000);
  }
  function bestKey() { return "mines_best_" + diffKey; }
  function getBest() { try { var v = parseFloat(localStorage.getItem(bestKey())); return isFinite(v) ? v : 0; } catch (e) { return 0; } }
  function saveBest() {
    var t = elapsedSec(), b = getBest();
    if (!b || t < b) { try { localStorage.setItem(bestKey(), String(t)); } catch (e) {} return true; }
    return false;
  }
  function fmtTime(sec) {
    sec = Math.floor(sec);
    var m = Math.floor(sec / 60), s = sec % 60;
    return m + ":" + (s < 10 ? "0" + s : s);
  }

  // ---------- HUD ----------
  var mineVal = document.getElementById("mineVal");
  var timeVal = document.getElementById("timeVal");
  var diffBtn = document.getElementById("diffBtn");
  function pad3(n) { n = Math.max(0, Math.min(999, n | 0)); return (n < 10 ? "00" : n < 100 ? "0" : "") + n; }
  function updateHud() {
    if (mineVal) mineVal.textContent = pad3(mines - flagCount);
    if (diffBtn) diffBtn.textContent = DIFF[diffKey].label;
  }
  function tickHud() {
    if (timeVal) timeVal.textContent = pad3(Math.floor(elapsedSec()));
  }

  // ---------- rendering ----------
  function rr(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function draw() {
    // background field
    var g = ctx.createRadialGradient(W * 0.5, H * 0.34, 40, W * 0.5, H * 0.5, Math.max(W, H) * 0.75);
    g.addColorStop(0, "#141922"); g.addColorStop(1, "#080a0d");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    ctx.save();
    if (shake > 0.001 && !RM) {
      var s = shake * 9;
      ctx.translate((Math.random() * 2 - 1) * s, (Math.random() * 2 - 1) * s);
    }

    // tray
    var tx = boardX - TRAY, ty = boardY - TRAY, tw = boardW + TRAY * 2, th = boardH + TRAY * 2;
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.55)"; ctx.shadowBlur = 34; ctx.shadowOffsetY = 16;
    rr(tx, ty, tw, th, 16); ctx.fillStyle = "#0c0f14"; ctx.fill();
    ctx.restore();
    rr(tx, ty, tw, th, 16);
    ctx.strokeStyle = "rgba(255,255,255,0.06)"; ctx.lineWidth = 1; ctx.stroke();

    for (var i = 0; i < total; i++) drawCell(i);

    // particles (embers) live in board space
    drawParticles();
    ctx.restore();

    // full-screen blast flash
    if (flash > 0.001 && !RM) {
      ctx.fillStyle = "rgba(229,72,77," + (flash * 0.32) + ")";
      ctx.fillRect(0, 0, W, H);
    }
    // confetti (screen space)
    drawConfetti();
  }

  function drawCell(i) {
    var c = i % cols, r = (i / cols) | 0;
    var x = boardX + c * cell, y = boardY + r * cell;
    var gap = Math.max(1.5, cell * 0.07);
    var ix = x + gap * 0.5, iy = y + gap * 0.5, iw = cell - gap, ih = cell - gap;
    var rad = Math.max(2.5, cell * 0.16);
    var st = stateArr[i];
    var rt = revealT[i];
    var appearing = rt > now; // scheduled but not yet shown (staggered)

    // revealed well underneath
    if (st === 1 && !appearing) {
      drawWell(ix, iy, iw, ih, rad);
      var pop = clamp((now - rt) / 200, 0, 1);
      if (mineArr[i]) {
        drawMine(ix + iw / 2, iy + ih / 2, iw, i === explodedIdx, pop);
      } else if (adjArr[i] > 0) {
        drawNumber(i, ix + iw / 2, iy + ih / 2, iw, pop);
      }
      // cover dissolving away on top
      if (pop < 1 && !RM) {
        ctx.save();
        ctx.globalAlpha = 1 - pop;
        var sc = 1 + 0.05 * (1 - pop);
        ctx.translate(ix + iw / 2, iy + ih / 2); ctx.scale(sc, sc); ctx.translate(-(ix + iw / 2), -(iy + ih / 2));
        drawCover(ix, iy, iw, ih, rad, false, false);
        ctx.restore();
      }
      return;
    }

    // covered / flagged / scheduled-to-appear tile
    var flagged = st === 2;
    var hovered = i === hoverIdx && phase === "playing";
    drawCover(ix, iy, iw, ih, rad, hovered, flagged);
    if (flagged) {
      var wrong = (phase === "lost") && !mineArr[i];
      var fp = clamp((now - flagT[i]) / 180, 0, 1);
      drawFlag(ix + iw / 2, iy + ih / 2, iw, fp, wrong);
    }
  }

  function drawCover(x, y, w, h, rad, hovered, flagged) {
    var g = ctx.createLinearGradient(0, y, 0, y + h);
    if (hovered) { g.addColorStop(0, "#30353f"); g.addColorStop(1, "#1e222a"); }
    else { g.addColorStop(0, "#272c34"); g.addColorStop(1, "#161a20"); }
    rr(x, y, w, h, rad); ctx.fillStyle = g; ctx.fill();
    // top highlight
    ctx.save(); rr(x, y, w, h, rad); ctx.clip();
    ctx.strokeStyle = "rgba(255,255,255,0.09)"; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(x + rad, y + 0.8); ctx.lineTo(x + w - rad, y + 0.8); ctx.stroke();
    // bottom inner shadow
    ctx.strokeStyle = "rgba(0,0,0,0.35)"; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(x + rad, y + h - 0.8); ctx.lineTo(x + w - rad, y + h - 0.8); ctx.stroke();
    ctx.restore();
    if (flagged) { rr(x, y, w, h, rad); ctx.fillStyle = "rgba(229,72,77,0.08)"; ctx.fill(); }
  }

  function drawWell(x, y, w, h, rad) {
    rr(x, y, w, h, rad); ctx.fillStyle = "#0d1015"; ctx.fill();
    ctx.save(); rr(x, y, w, h, rad); ctx.clip();
    var g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, "rgba(0,0,0,0.5)"); g.addColorStop(0.35, "rgba(0,0,0,0)");
    ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
    ctx.restore();
    rr(x, y, w, h, rad); ctx.strokeStyle = "rgba(255,255,255,0.03)"; ctx.lineWidth = 1; ctx.stroke();
  }

  function drawNumber(i, cx, cy, w, pop) {
    var n = adjArr[i];
    var col = NUMCOL[n] || "#dfe4ec";
    ctx.save();
    ctx.translate(cx, cy);
    var sc = RM ? 1 : (0.6 + 0.4 * pop);
    ctx.scale(sc, sc);
    ctx.globalAlpha = RM ? 1 : pop;
    ctx.font = "800 " + Math.round(w * 0.56) + "px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.shadowColor = col; ctx.shadowBlur = w * 0.28;
    ctx.fillStyle = col;
    ctx.fillText(String(n), 0, w * 0.04);
    ctx.restore();
  }

  function drawMine(cx, cy, w, exploded, pop) {
    var rad = w * 0.24;
    ctx.save();
    ctx.translate(cx, cy);
    var sc = RM ? 1 : (0.5 + 0.5 * pop);
    ctx.scale(sc, sc);
    if (exploded) {
      ctx.fillStyle = "rgba(229,72,77," + (0.28 + 0.14 * Math.sin(now / 90)) + ")";
      ctx.beginPath(); ctx.arc(0, 0, w * 0.46, 0, Math.PI * 2); ctx.fill();
    }
    // spikes
    ctx.strokeStyle = exploded ? "#ffd0a0" : "#c65b3a";
    ctx.lineWidth = Math.max(1.4, w * 0.05); ctx.lineCap = "round";
    for (var k = 0; k < 8; k++) {
      var a = k * Math.PI / 4;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * rad * 0.7, Math.sin(a) * rad * 0.7);
      ctx.lineTo(Math.cos(a) * rad * 1.5, Math.sin(a) * rad * 1.5);
      ctx.stroke();
    }
    // body
    var g = ctx.createRadialGradient(-rad * 0.3, -rad * 0.3, rad * 0.1, 0, 0, rad);
    if (exploded) { g.addColorStop(0, "#fff0d8"); g.addColorStop(0.4, "#ffa24d"); g.addColorStop(1, "#8a1f0e"); }
    else { g.addColorStop(0, "#ffcaa0"); g.addColorStop(0.45, "#e07b45"); g.addColorStop(1, "#5f1a0c"); }
    ctx.shadowColor = exploded ? "rgba(255,140,60,0.9)" : "rgba(224,123,69,0.55)";
    ctx.shadowBlur = w * (exploded ? 0.5 : 0.28);
    ctx.beginPath(); ctx.arc(0, 0, rad, 0, Math.PI * 2); ctx.fillStyle = g; ctx.fill();
    ctx.shadowBlur = 0;
    ctx.beginPath(); ctx.arc(-rad * 0.32, -rad * 0.32, rad * 0.22, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.6)"; ctx.fill();
    ctx.restore();
  }

  function drawFlag(cx, cy, w, pop, wrong) {
    ctx.save();
    ctx.translate(cx, cy + w * 0.04);
    var sc = RM ? 1 : (0.7 + 0.3 * (pop < 1 ? 1 + (1 - pop) * 0.5 * Math.sin(pop * Math.PI) : 1));
    ctx.scale(sc, sc);
    var ph = w * 0.34; // pole half-height
    // pole
    ctx.strokeStyle = "#c8cdd6"; ctx.lineWidth = Math.max(1.4, w * 0.045); ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(-w * 0.02, -ph); ctx.lineTo(-w * 0.02, ph); ctx.stroke();
    // base
    ctx.fillStyle = "#c8cdd6";
    ctx.beginPath();
    ctx.moveTo(-w * 0.2, ph); ctx.lineTo(w * 0.16, ph); ctx.lineTo(w * 0.16, ph - w * 0.05); ctx.lineTo(-w * 0.2, ph - w * 0.05);
    ctx.closePath(); ctx.fill();
    // flag
    var fc = wrong ? "#8b929c" : "#e5484d";
    ctx.fillStyle = fc; ctx.shadowColor = wrong ? "transparent" : "rgba(229,72,77,0.55)"; ctx.shadowBlur = w * 0.2;
    ctx.beginPath();
    ctx.moveTo(-w * 0.02, -ph);
    ctx.lineTo(w * 0.26, -ph + w * 0.13);
    ctx.lineTo(-w * 0.02, -ph + w * 0.26);
    ctx.closePath(); ctx.fill();
    ctx.shadowBlur = 0;
    if (wrong) {
      ctx.strokeStyle = "#ff5257"; ctx.lineWidth = Math.max(1.6, w * 0.06); ctx.lineCap = "round";
      var q = w * 0.26;
      ctx.beginPath(); ctx.moveTo(-q, -q); ctx.lineTo(q, q); ctx.moveTo(q, -q); ctx.lineTo(-q, q); ctx.stroke();
    }
    ctx.restore();
  }

  // ---------- particles ----------
  function spawnEmber(i) {
    var c = i % cols, r = (i / cols) | 0;
    var cx = boardX + c * cell + cell / 2, cy = boardY + r * cell + cell / 2;
    for (var k = 0; k < 26; k++) {
      var a = Math.random() * Math.PI * 2, sp = 60 + Math.random() * 260;
      particles.push({
        x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60,
        life: 1, decay: 0.6 + Math.random() * 0.7, size: 1.5 + Math.random() * 3,
        col: Math.random() < 0.5 ? "#ff8a4d" : "#ffd27a", kind: "ember"
      });
    }
  }
  function drawParticles() {
    for (var k = particles.length - 1; k >= 0; k--) {
      var p = particles[k];
      if (p.kind !== "ember") continue;
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.col;
      ctx.shadowColor = p.col; ctx.shadowBlur = 8;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1; ctx.shadowBlur = 0;
  }

  // ---------- confetti ----------
  var confetti = [];
  function spawnConfetti() {
    var cols5 = ["#5b9dff", "#43d17f", "#ffb454", "#c08cff", "#ff6b6b", "#2fd4c8"];
    for (var k = 0; k < 130; k++) {
      confetti.push({
        x: W * (0.2 + Math.random() * 0.6), y: -20 - Math.random() * H * 0.3,
        vx: (Math.random() * 2 - 1) * 60, vy: 120 + Math.random() * 200,
        rot: Math.random() * Math.PI, vr: (Math.random() * 2 - 1) * 6,
        w: 5 + Math.random() * 6, h: 8 + Math.random() * 8,
        col: cols5[(Math.random() * cols5.length) | 0], life: 1
      });
    }
  }
  function drawConfetti() {
    for (var k = 0; k < confetti.length; k++) {
      var p = confetti[k];
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life));
      ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.fillStyle = p.col;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  // ---------- loop ----------
  var last = 0;
  function frame(t) {
    now = t;
    var dt = last ? Math.min(0.05, (t - last) / 1000) : 0.016; last = t;

    // integrate particles
    for (var k = particles.length - 1; k >= 0; k--) {
      var p = particles[k];
      p.vy += 620 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.life -= p.decay * dt;
      if (p.life <= 0) particles.splice(k, 1);
    }
    for (var c = confetti.length - 1; c >= 0; c--) {
      var q = confetti[c];
      q.vy += 260 * dt; q.x += q.vx * dt; q.y += q.vy * dt; q.rot += q.vr * dt;
      if (q.y > H + 40) q.life -= dt * 1.2;
      if (q.life <= 0 || q.y > H + 120) confetti.splice(c, 1);
    }
    if (shake > 0) shake = Math.max(0, shake - dt * 2.2);
    if (flash > 0) flash = Math.max(0, flash - dt * 2.4);

    if (timerRunning) tickHud();
    draw();
    requestAnimationFrame(frame);
  }

  // ---------- input ----------
  var down = null, longTimer = null, longFired = false;
  var LONGPRESS = 380, MOVE_CANCEL = 0.62; // cells

  function cellAt(px, py) {
    var c = Math.floor((px - boardX) / cell), r = Math.floor((py - boardY) / cell);
    if (!inb(c, r)) return -1;
    return idx(c, r);
  }
  function evPos(e) {
    var rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  canvas.addEventListener("pointerdown", function (e) {
    if (!overlayHidden()) return;
    unlockAudio();
    var pos = evPos(e), i = cellAt(pos.x, pos.y);
    hoverIdx = i;
    if (i < 0) { down = null; return; }
    down = { i: i, x: pos.x, y: pos.y, t: perfNow(), touch: e.pointerType !== "mouse", btn: e.button };
    longFired = false;
    clearTimeout(longTimer);
    if (down.touch) {
      longTimer = setTimeout(function () {
        longFired = true;
        if (stateArr[down.i] !== 1) { toggleFlag(down.i); if (navigator.vibrate) try { navigator.vibrate(14); } catch (x) {} }
      }, LONGPRESS);
    }
    try { canvas.setPointerCapture(e.pointerId); } catch (x) {}
  });

  canvas.addEventListener("pointermove", function (e) {
    var pos = evPos(e), i = cellAt(pos.x, pos.y);
    if (e.pointerType === "mouse") hoverIdx = i;
    if (!down) return;
    if (Math.abs(pos.x - down.x) > cell * MOVE_CANCEL || Math.abs(pos.y - down.y) > cell * MOVE_CANCEL) {
      clearTimeout(longTimer); down.moved = true;
    }
  });

  canvas.addEventListener("pointerup", function (e) {
    clearTimeout(longTimer);
    if (!down) return;
    var d = down; down = null;
    if (d.moved || longFired) return;
    if (d.btn === 2) return; // handled by contextmenu
    var st = stateArr[d.i];
    if (st === 1 && adjArr[d.i] > 0) chord(d.i);
    else if (st === 0) reveal(d.i);
    else if (st === 2 && !d.touch) { /* mouse: quick click on a flag does nothing */ }
    hideHint();
  });
  canvas.addEventListener("pointercancel", function () { clearTimeout(longTimer); down = null; });
  canvas.addEventListener("pointerleave", function () { if (!down) hoverIdx = -1; });

  canvas.addEventListener("contextmenu", function (e) {
    e.preventDefault();
    if (!overlayHidden()) return;
    var pos = evPos(e), i = cellAt(pos.x, pos.y);
    if (i >= 0) { unlockAudio(); toggleFlag(i); }
  });

  function hideHint() { var h = document.getElementById("hint"); if (h) h.classList.add("is-gone"); }

  // ---------- overlay flow ----------
  var overlay = document.getElementById("overlay");
  var ovTitle = document.getElementById("ovTitle");
  var ovText = document.getElementById("ovText");
  var ovBtn = document.getElementById("ovBtn");
  function overlayHidden() { return overlay.classList.contains("is-hidden"); }
  function hideOverlay() { overlay.classList.add("is-hidden"); }
  function showOverlay() { overlay.hidden = false; overlay.classList.remove("is-hidden"); }

  function startPlay(key) {
    newGame(key || diffKey);
    ovTitle.classList.remove("is-win", "is-lose");
    hideOverlay();
    var h = document.getElementById("hint"); if (h) h.classList.remove("is-gone");
    window.OPT_SHARE_TEXT = "Come sweep some mines on One Page Toys — a premium dark-glass Minesweeper.";
  }

  function showEnd(won) {
    ovTitle.textContent = won ? "Cleared!" : "Boom.";
    ovTitle.classList.remove("is-win", "is-lose");
    ovTitle.classList.add(won ? "is-win" : "is-lose");
    var t = elapsedSec(), best = getBest();
    if (won) {
      ovText.innerHTML = "You cleared <b>" + DIFF[diffKey].label + "</b> in <b>" + fmtTime(t) + "</b>." +
        (lastNewBest ? " <span style='color:#7ff0b6'>New best time!</span>" : (best ? " Best: " + fmtTime(best) + "." : ""));
      window.OPT_SHARE_TEXT = "I cleared Minesweeper (" + DIFF[diffKey].label + ") in " + fmtTime(t) + " on One Page Toys.";
    } else {
      ovText.innerHTML = "You hit a mine on <b>" + DIFF[diffKey].label + "</b>. " + (best ? "Best time: " + fmtTime(best) + "." : "Give it another sweep.");
      window.OPT_SHARE_TEXT = "Come sweep some mines on One Page Toys — a premium dark-glass Minesweeper.";
    }
    ovBtn.textContent = won ? "Play again" : "Try again";
    showOverlay();
  }

  ovBtn.addEventListener("click", function () { startPlay(diffKey); });

  // difficulty chips (overlay)
  var chips = Array.prototype.slice.call(document.querySelectorAll(".chip"));
  chips.forEach(function (ch) {
    ch.addEventListener("click", function () { startPlay(ch.getAttribute("data-diff")); });
  });
  function syncDiffUi() {
    chips.forEach(function (ch) { ch.classList.toggle("is-active", ch.getAttribute("data-diff") === diffKey); });
    updateHud();
  }

  // topbar buttons
  diffBtn.addEventListener("click", function () {
    var i = ORDER.indexOf(diffKey);
    startPlay(ORDER[(i + 1) % ORDER.length]);
  });
  document.getElementById("newBtn").addEventListener("click", function () { startPlay(diffKey); });

  // ---------- audio ----------
  var AC = null, master = null, reverb = null, revGain = null, soundOn = true;
  function buildAudio() {
    if (AC) return;
    try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
    master = AC.createGain(); master.gain.value = soundOn ? 0.9 : 0;
    var comp = AC.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 3; comp.attack.value = 0.004; comp.release.value = 0.25;
    var lp = AC.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 13000;
    master.connect(comp); comp.connect(lp); lp.connect(AC.destination);
    reverb = AC.createConvolver(); reverb.buffer = makeImpulse(1.7, 2.6);
    revGain = AC.createGain(); revGain.gain.value = 0.5;
    reverb.connect(revGain); revGain.connect(master);
  }
  function makeImpulse(dur, decay) {
    var rate = AC.sampleRate, len = Math.floor(rate * dur), buf = AC.createBuffer(2, len, rate);
    for (var ch = 0; ch < 2; ch++) {
      var d = buf.getChannelData(ch);
      for (var i = 0; i < len; i++) {
        var t = i / len;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
      }
    }
    return buf;
  }
  function unlockAudio() {
    buildAudio();
    if (!AC) return;
    if (AC.state === "suspended") AC.resume();
    var b = AC.createBuffer(1, 1, AC.sampleRate);
    var s = AC.createBufferSource(); s.buffer = b; s.connect(master); s.start(0);
  }
  function panFor(i) {
    if (!AC.createStereoPanner) return null;
    var c = i % cols;
    var p = AC.createStereoPanner();
    p.pan.value = Math.max(-0.8, Math.min(0.8, (c / Math.max(1, cols - 1) - 0.5) * 1.4));
    return p;
  }
  function voice(freq, type, dur, vol, filt, wet, pan) {
    if (!AC) return;
    var t0 = AC.currentTime;
    var o = AC.createOscillator(); o.type = type || "sine"; o.frequency.value = freq;
    var g = AC.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    var node = o;
    if (filt) { var f = AC.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = filt; o.connect(f); node = f; }
    node.connect(g);
    var out = pan || null;
    if (out) { g.connect(out); out.connect(master); if (wet) out.connect(reverb); }
    else { g.connect(master); if (wet) g.connect(reverb); }
    o.start(t0); o.stop(t0 + dur + 0.05);
  }
  function noiseBurst(dur, vol, filtFreq, wet) {
    if (!AC) return;
    var t0 = AC.currentTime;
    var len = Math.floor(AC.sampleRate * dur), buf = AC.createBuffer(1, len, AC.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
    var s = AC.createBufferSource(); s.buffer = buf;
    var f = AC.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = filtFreq;
    var g = AC.createGain(); g.gain.value = vol;
    s.connect(f); f.connect(g); g.connect(master); if (wet) g.connect(reverb);
    s.start(t0);
  }

  var PENTA = [0, 2, 4, 7, 9, 12, 14, 16];
  function midi(n) { return 261.63 * Math.pow(2, n / 12); }

  function sfxReveal(count, i) {
    if (!AC || !soundOn) return;
    if (count <= 1) {
      voice(300 + Math.random() * 40, "triangle", 0.08, 0.12, 1600, false, panFor(i));
      noiseBurst(0.03, 0.05, 2600, false);
      return;
    }
    var n = Math.min(count, 6);
    for (var k = 0; k < n; k++) {
      (function (k) {
        setTimeout(function () {
          if (!soundOn) return;
          voice(midi(PENTA[k % PENTA.length]) * 1.5, "triangle", 0.14, 0.1, 2400, true, panFor(i));
        }, k * 26);
      })(k);
    }
  }
  function sfxFlag(on) {
    if (!AC || !soundOn) return;
    voice(on ? 560 : 300, "square", 0.06, 0.09, 1400, false, null);
    noiseBurst(0.02, 0.03, 3000, false);
  }
  function sfxBoom() {
    if (!AC || !soundOn) return;
    var t0 = AC.currentTime;
    var o = AC.createOscillator(); o.type = "sine";
    o.frequency.setValueAtTime(120, t0); o.frequency.exponentialRampToValueAtTime(42, t0 + 0.5);
    var g = AC.createGain();
    g.gain.setValueAtTime(0.6, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.7);
    o.connect(g); g.connect(master); g.connect(reverb);
    o.start(t0); o.stop(t0 + 0.75);
    noiseBurst(0.4, 0.4, 900, true);
    noiseBurst(0.12, 0.3, 4000, false);
  }
  function sfxWin() {
    if (!AC || !soundOn) return;
    var seq = [0, 4, 7, 12, 16, 19];
    for (var k = 0; k < seq.length; k++) {
      (function (k) {
        setTimeout(function () {
          if (!soundOn) return;
          voice(midi(seq[k]) * 2, "triangle", 0.6, 0.13, 5000, true, null);
          voice(midi(seq[k]) * 4, "sine", 0.4, 0.04, 8000, true, null);
        }, k * 90);
      })(k);
    }
  }

  // sound toggle
  var soundBtn = document.getElementById("soundBtn");
  soundBtn.addEventListener("click", function () {
    soundOn = !soundOn;
    soundBtn.setAttribute("aria-pressed", soundOn ? "true" : "false");
    soundBtn.textContent = soundOn ? "♪" : "♩";
    if (master) master.gain.setTargetAtTime(soundOn ? 0.9 : 0, AC.currentTime, 0.02);
    if (soundOn) unlockAudio();
  });

  // ---------- utils ----------
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function perfNow() { return (window.performance && performance.now) ? performance.now() : now; }

  // ---------- boot ----------
  window.addEventListener("resize", resize);
  window.addEventListener("orientationchange", function () { setTimeout(resize, 60); });
  resize();
  newGame(diffKey);
  requestAnimationFrame(frame);
})();
