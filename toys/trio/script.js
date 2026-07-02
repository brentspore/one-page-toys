/* Trio — a slide-and-merge number puzzle in the spirit of the classic
 * "combine to three" games. A 1 and a 2 join into a 3; after that, matching
 * tiles double (3+3=6, 6+6=12 …). Unlike 2048, every swipe nudges the whole
 * board just ONE step, and a fresh tile slides in from the trailing edge — so
 * it plays slower and more deliberately. Vanilla Canvas 2D, no build. */
(function () {
  "use strict";

  var canvas = document.getElementById("canvas");
  var ctx = canvas.getContext("2d");
  var scoreEl = document.getElementById("score");
  var bestEl = document.getElementById("best");
  var soundBtn = document.getElementById("soundBtn");
  var newBtn = document.getElementById("newBtn");
  var overlay = document.getElementById("overlay");
  var ovTitle = document.getElementById("ovTitle");
  var ovText = document.getElementById("ovText");
  var ovBtn = document.getElementById("ovBtn");
  var hintEl = document.getElementById("hint");

  var W = 0, H = 0, DPR = 1;
  var N = 4;                       // grid is N x N
  var ANIM_MS = 115;               // slide duration
  var SPAWN_MS = 150;              // new-tile pop duration

  // board geometry (set in resize)
  var BS = 0, CS = 0, GAP = 0, BX = 0, BY = 0, PREV_Y = 0;

  // state
  var cells = [];                  // N x N of tile refs or null
  var tiles = [];                  // flat list for rendering
  var deck = [];
  var next = null;                 // {val, bonus}
  var idSeq = 1;
  var animT = 1, animMerges = [], animSpawn = null;
  var soundOn = true, started = false, over = false;
  var score = 0, best = 0;

  try { best = parseInt(localStorage.getItem("trio_best"), 10) || 0; } catch (e) { best = 0; }
  bestEl.textContent = "Best " + best;

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.floor(W * DPR); canvas.height = Math.floor(H * DPR);
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    // the board + its next-tile preview are centered in the play region
    // (between the HUD at top and the hint at the bottom).
    var topLimit = 122, botLimit = H - 50, region = botLimit - topLimit;
    BS = Math.min(W * 0.92, 520);
    GAP = Math.round(BS * 0.028); CS = (BS - GAP * (N + 1)) / N;
    var blockH = BS + CS * 0.62 + 16;
    if (blockH > region) {          // shrink to fit tall/short viewports
      BS = Math.min(BS, (region - 16) / 1.19);
      GAP = Math.round(BS * 0.028); CS = (BS - GAP * (N + 1)) / N;
      blockH = BS + CS * 0.62 + 16;
    }
    BX = (W - BS) / 2;
    var blockTop = topLimit + Math.max(0, (region - blockH) / 2);
    PREV_Y = blockTop;              // next-tile preview sits above the board
    BY = blockTop + CS * 0.62 + 16;
  }
  window.addEventListener("resize", function () { resize(); syncTilePx(); });

  function cellPx(r, c) { return { x: BX + GAP + c * (CS + GAP), y: BY + GAP + r * (CS + GAP) }; }
  function syncTilePx() {
    for (var i = 0; i < tiles.length; i++) {
      var t = tiles[i], p = cellPx(t.r, t.c);
      t.ax = t.tx = p.x; t.ay = t.ty = p.y;
    }
  }

  // ---------- deck / next ----------
  function shuffle(a) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function drawDeck() { if (!deck.length) deck = shuffle([1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3]); return deck.pop(); }
  function maxVal() { var m = 0; for (var i = 0; i < tiles.length; i++) if (tiles[i].val > m) m = tiles[i].val; return m; }
  function computeNext() {
    var mx = maxVal();
    if (mx >= 48 && Math.random() < 0.05) {
      // bonus high tile: a random face between 6 and max/8
      var opts = [];
      for (var v = 6; v <= mx / 8; v *= 2) opts.push(v);
      if (opts.length) return { val: opts[Math.floor(Math.random() * opts.length)], bonus: true };
    }
    return { val: drawDeck(), bonus: false };
  }

  // ---------- setup ----------
  function newTile(r, c, val, spawn) {
    var p = cellPx(r, c);
    var t = { id: idSeq++, r: r, c: c, val: val, ax: p.x, ay: p.y, tx: p.x, ty: p.y, pop: spawn ? 0 : 0, spawnT: spawn ? 0 : 1, mergedFlag: false };
    cells[r][c] = t; tiles.push(t);
    return t;
  }
  function reset() {
    resize();
    cells = []; for (var r = 0; r < N; r++) { cells.push([]); for (var c = 0; c < N; c++) cells[r].push(null); }
    tiles = []; deck = []; idSeq = 1; score = 0; over = false;
    animT = 1; animMerges = []; animSpawn = null;
    // seed 9 starting tiles
    var spots = [];
    for (var i = 0; i < N * N; i++) spots.push(i);
    shuffle(spots);
    for (var k = 0; k < 9; k++) { var idx = spots[k]; newTile(Math.floor(idx / N), idx % N, drawDeck(), false); }
    next = computeNext();
    updateScore();
  }

  function scoreOf(val) {
    if (val < 3) return 0;
    var k = Math.round(Math.log(val / 3) / Math.log(2));   // 3->0, 6->1 ...
    return Math.pow(3, k + 1);
  }
  function updateScore() {
    var s = 0; for (var i = 0; i < tiles.length; i++) s += scoreOf(tiles[i].val);
    score = s; scoreEl.textContent = s;
    if (s > best) { best = s; try { localStorage.setItem("trio_best", String(best)); } catch (e) {} bestEl.textContent = "Best " + best; }
  }

  // ---------- move logic ----------
  function canMerge(a, b) { return (a === 1 && b === 2) || (a === 2 && b === 1) || (a >= 3 && a === b); }
  function mergedVal(a, b) { return (a < 3 || b < 3) ? 3 : a + b; }

  function order(dir) {
    // returns array of [r,c,nr,nc] source->neighbor, processed leading-edge first
    var list = [];
    var r, c;
    if (dir === "left") { for (r = 0; r < N; r++) for (c = 1; c < N; c++) list.push([r, c, r, c - 1]); }
    else if (dir === "right") { for (r = 0; r < N; r++) for (c = N - 2; c >= 0; c--) list.push([r, c, r, c + 1]); }
    else if (dir === "up") { for (c = 0; c < N; c++) for (r = 1; r < N; r++) list.push([r, c, r - 1, c]); }
    else { for (c = 0; c < N; c++) for (r = N - 2; r >= 0; r--) list.push([r, c, r + 1, c]); }
    return list;
  }

  function performMove(dir) {
    if (over || animT < 1) return false;
    for (var i = 0; i < tiles.length; i++) tiles[i].mergedFlag = false;
    var moved = false, merges = [], lanes = {};
    var ord = order(dir);
    for (var k = 0; k < ord.length; k++) {
      var r = ord[k][0], c = ord[k][1], nr = ord[k][2], nc = ord[k][3];
      var t = cells[r][c]; if (!t) continue;
      var nbr = cells[nr][nc];
      if (!nbr) {
        cells[nr][nc] = t; cells[r][c] = null; t.r = nr; t.c = nc; moved = true;
        lanes[(dir === "left" || dir === "right") ? r : c] = true;
      } else if (canMerge(nbr.val, t.val) && !nbr.mergedFlag && !t.mergedFlag) {
        cells[r][c] = null; t.r = nr; t.c = nc; nbr.mergedFlag = true;
        merges.push({ from: t, into: nbr });
        moved = true;
        lanes[(dir === "left" || dir === "right") ? r : c] = true;
      }
    }
    if (!moved) return false;

    // set animation targets
    for (i = 0; i < tiles.length; i++) { var p = cellPx(tiles[i].r, tiles[i].c); tiles[i].tx = p.x; tiles[i].ty = p.y; }
    animMerges = merges; animT = 0;
    slideSound();

    // spawn the incoming tile on the trailing edge, in a lane that moved
    spawnAfter(dir, lanes);
    return true;
  }

  function spawnAfter(dir, lanes) {
    var laneList = Object.keys(lanes).map(Number);
    var cand = [];
    var i;
    if (dir === "left") { for (i = 0; i < laneList.length; i++) if (!cells[laneList[i]][N - 1]) cand.push([laneList[i], N - 1]); }
    else if (dir === "right") { for (i = 0; i < laneList.length; i++) if (!cells[laneList[i]][0]) cand.push([laneList[i], 0]); }
    else if (dir === "up") { for (i = 0; i < laneList.length; i++) if (!cells[N - 1][laneList[i]]) cand.push([N - 1, laneList[i]]); }
    else { for (i = 0; i < laneList.length; i++) if (!cells[0][laneList[i]]) cand.push([0, laneList[i]]); }
    if (!cand.length) return;
    var pick = cand[Math.floor(Math.random() * cand.length)];
    animSpawn = { r: pick[0], c: pick[1], val: next.val };
    next = computeNext();
  }

  function finishMove() {
    var i;
    for (i = 0; i < animMerges.length; i++) {
      var m = animMerges[i];
      m.into.val = mergedVal(m.into.val, m.from.val);
      m.into.pop = 1;
      // remove the absorbed tile
      var idx = tiles.indexOf(m.from);
      if (idx >= 0) tiles.splice(idx, 1);
      mergeSound(m.into.val);
    }
    animMerges = [];
    if (animSpawn) {
      var t = newTile(animSpawn.r, animSpawn.c, animSpawn.val, true);
      t.spawnT = 0;
      animSpawn = null;
    }
    updateScore();
    if (isGameOver()) endGame();
  }

  function isGameOver() {
    // full board with no adjacent mergeable pair
    for (var r = 0; r < N; r++) for (var c = 0; c < N; c++) if (!cells[r][c]) return false;
    for (r = 0; r < N; r++) for (c = 0; c < N; c++) {
      var v = cells[r][c].val;
      if (c < N - 1 && canMerge(cells[r][c + 1].val, v)) return false;
      if (r < N - 1 && canMerge(cells[r + 1][c].val, v)) return false;
    }
    return true;
  }

  function endGame() {
    over = true;
    var mx = maxVal();
    setTimeout(function () {
      ovTitle.textContent = "No moves left";
      ovText.innerHTML = "Biggest tile <b>" + mx + "</b> · score <b>" + score.toLocaleString() + "</b>. Nicely done — try to beat it.";
      ovBtn.textContent = "Play again";
      overlay.hidden = false;
      overlay.classList.remove("is-hidden");
    }, 420);
    overSound();
  }

  // ---------- tile styling ----------
  var HI = ["#c07be0", "#7b8cf0", "#3fb6c8", "#43c07b", "#e0b23f", "#e0743f", "#e04f8f", "#8f5fe0"];
  function tileStyle(val) {
    if (val === 1) return { bg1: "#54acf0", bg2: "#2f7fd0", fg: "#eaf6ff", glow: null };
    if (val === 2) return { bg1: "#f77f98", bg2: "#dd506f", fg: "#fff", glow: null };
    var k = Math.round(Math.log(val / 3) / Math.log(2));
    if (val < 48) return { bg1: "#faf7f0", bg2: "#e9dfcd", fg: "#3a3a46", glow: null };
    var col = HI[(k - 4) % HI.length];
    return { bg1: shade(col, 1.16), bg2: shade(col, 0.82), fg: "#fff", glow: col };
  }
  function shade(hex, f) {
    var n = parseInt(hex.slice(1), 16);
    var r = Math.min(255, Math.round(((n >> 16) & 255) * f));
    var g = Math.min(255, Math.round(((n >> 8) & 255) * f));
    var b = Math.min(255, Math.round((n & 255) * f));
    return "rgb(" + r + "," + g + "," + b + ")";
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

  function drawTile(x, y, size, val, scale, glowPulse) {
    var st = tileStyle(val);
    var s = size * scale;
    var cx = x + size / 2, cy = y + size / 2;
    var tx = cx - s / 2, ty = cy - s / 2;
    var rad = Math.max(5, s * 0.16);
    ctx.save();
    // shadow
    ctx.shadowColor = "rgba(0,0,0,0.35)"; ctx.shadowBlur = s * 0.12; ctx.shadowOffsetY = s * 0.05;
    if (st.glow) { ctx.shadowColor = st.glow; ctx.shadowBlur = s * (0.22 + 0.18 * (glowPulse || 0)); ctx.shadowOffsetY = s * 0.04; }
    var g = ctx.createLinearGradient(tx, ty, tx, ty + s);
    g.addColorStop(0, st.bg1); g.addColorStop(1, st.bg2);
    rr(tx, ty, s, s, rad); ctx.fillStyle = g; ctx.fill();
    ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    // top sheen
    rr(tx, ty, s, s, rad); ctx.save(); ctx.clip();
    var sh = ctx.createLinearGradient(tx, ty, tx, ty + s * 0.5);
    sh.addColorStop(0, "rgba(255,255,255,0.28)"); sh.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = sh; ctx.fillRect(tx, ty, s, s * 0.5);
    ctx.restore();
    // number
    var txt = "" + val;
    var fs = s * (txt.length >= 4 ? 0.30 : txt.length === 3 ? 0.38 : 0.46);
    ctx.fillStyle = st.fg;
    ctx.font = "800 " + fs + "px Archivo, system-ui, sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(txt, cx, cy + s * 0.02);
    ctx.restore();
  }

  function ease(p) { return 1 - Math.pow(1 - p, 3); }

  function draw() {
    // background
    var bg = ctx.createRadialGradient(W / 2, BY + BS * 0.35, 40, W / 2, BY + BS * 0.5, Math.max(W, H) * 0.7);
    bg.addColorStop(0, "#241a33"); bg.addColorStop(0.6, "#191322"); bg.addColorStop(1, "#100b18");
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

    // board panel
    rr(BX, BY, BS, BS, BS * 0.045);
    ctx.fillStyle = "rgba(255,255,255,0.05)"; ctx.fill();
    rr(BX, BY, BS, BS, BS * 0.045);
    ctx.lineWidth = 1.5; ctx.strokeStyle = "rgba(255,255,255,0.08)"; ctx.stroke();
    // empty cell slots
    for (var r = 0; r < N; r++) for (var c = 0; c < N; c++) {
      var p = cellPx(r, c);
      rr(p.x, p.y, CS, CS, CS * 0.16);
      ctx.fillStyle = "rgba(0,0,0,0.22)"; ctx.fill();
    }

    // next-tile preview
    var pv = CS * 0.62;
    ctx.save();
    ctx.font = "800 " + Math.round(pv * 0.28) + "px Archivo, system-ui, sans-serif";
    ctx.fillStyle = "rgba(240,233,255,0.55)"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("NEXT", W / 2 - pv * 1.1, PREV_Y + pv / 2);
    ctx.restore();
    if (next) {
      if (next.bonus) {
        drawTile(W / 2 - pv / 2, PREV_Y, pv, next.val, 1, 0);
        // veil the bonus value with a "+"
        rr(W / 2 - pv / 2, PREV_Y, pv, pv, pv * 0.16);
        ctx.fillStyle = "rgba(30,22,40,0.55)"; ctx.fill();
        ctx.fillStyle = "#fff"; ctx.font = "800 " + Math.round(pv * 0.5) + "px Archivo, system-ui, sans-serif";
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText("+", W / 2, PREV_Y + pv / 2);
      } else {
        drawTile(W / 2 - pv / 2, PREV_Y, pv, next.val, 1, 0);
      }
    }

    // tiles (animate positions)
    var p2 = animT < 1 ? ease(animT) : 1;
    for (var i = 0; i < tiles.length; i++) {
      var t = tiles[i];
      var ax = t.tx, ay = t.ty;
      if (animT < 1) { ax = t.ax + (t.tx - t.ax) * p2; ay = t.ay + (t.ty - t.ay) * p2; }
      var scale = 1;
      if (t.spawnT < 1) { t.spawnT = Math.min(1, t.spawnT + 16 / SPAWN_MS); scale = 0.2 + 0.8 * ease(t.spawnT); }
      if (t.pop > 0) { t.pop = Math.max(0, t.pop - 0.08); scale *= 1 + 0.16 * Math.sin(t.pop * Math.PI); }
      var glow = t.val >= 48 ? 0.5 + 0.5 * Math.sin(now() * 0.004 + t.id) : 0;
      drawTile(ax, ay, CS, t.val, scale, glow);
    }
  }

  var _t0 = 0;
  function now() { return _t0; }

  // ---------- loop ----------
  var last = 0;
  function loop(ts) {
    if (!last) last = ts;
    var dt = Math.min(0.033, (ts - last) / 1000); last = ts; _t0 = ts;
    if (animT < 1) { animT = Math.min(1, animT + (dt * 1000) / ANIM_MS); if (animT >= 1) { finalizeAnimStart(); } }
    draw();
    requestAnimationFrame(loop);
  }
  // when the slide finishes, commit merges + spawn (once)
  function finalizeAnimStart() {
    // commit ax/ay to targets
    for (var i = 0; i < tiles.length; i++) { tiles[i].ax = tiles[i].tx; tiles[i].ay = tiles[i].ty; }
    finishMove();
  }

  // ---------- input ----------
  function tryDir(dir) {
    if (!started || over) return;
    performMove(dir);
  }
  window.addEventListener("keydown", function (e) {
    var d = null;
    if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") d = "left";
    else if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") d = "right";
    else if (e.key === "ArrowUp" || e.key === "w" || e.key === "W") d = "up";
    else if (e.key === "ArrowDown" || e.key === "s" || e.key === "S") d = "down";
    else if (e.key === "r" || e.key === "R") { startNew(); return; }
    if (d) { e.preventDefault(); unlockAudio(); tryDir(d); }
  });

  var sx0 = 0, sy0 = 0, swiping = false;
  function ptStart(e) {
    unlockAudio();
    var pt = e.touches ? e.touches[0] : e;
    sx0 = pt.clientX; sy0 = pt.clientY; swiping = true;
  }
  function ptEnd(e) {
    if (!swiping) return; swiping = false;
    var pt = (e.changedTouches ? e.changedTouches[0] : e);
    var dx = pt.clientX - sx0, dy = pt.clientY - sy0;
    var adx = Math.abs(dx), ady = Math.abs(dy);
    if (Math.max(adx, ady) < 24) return;   // a tap, not a swipe
    if (adx > ady) tryDir(dx > 0 ? "right" : "left");
    else tryDir(dy > 0 ? "down" : "up");
  }
  canvas.addEventListener("mousedown", ptStart);
  window.addEventListener("mouseup", ptEnd);
  canvas.addEventListener("touchstart", function (e) { ptStart(e); e.preventDefault(); }, { passive: false });
  canvas.addEventListener("touchend", function (e) { ptEnd(e); e.preventDefault(); }, { passive: false });

  // ---------- controls ----------
  function beginPlay() {
    started = true;
    overlay.classList.add("is-hidden");
    setTimeout(function () { overlay.hidden = true; }, 280);
    if (hintEl) setTimeout(function () { hintEl.classList.add("is-gone"); }, 5000);
  }
  function startNew() {
    reset(); over = false; started = true;
    overlay.classList.add("is-hidden");
    setTimeout(function () { overlay.hidden = true; }, 200);
  }
  if (ovBtn) ovBtn.addEventListener("click", function () {
    unlockAudio();
    if (over) { startNew(); } else { beginPlay(); }
  });
  newBtn.addEventListener("click", function () { unlockAudio(); startNew(); });
  soundBtn.addEventListener("click", function () {
    soundOn = !soundOn; soundBtn.setAttribute("aria-pressed", soundOn ? "true" : "false");
    if (outGain) outGain.gain.value = soundOn ? 1 : 0;
  });

  // ---------- audio ----------
  var actx = null, master = null, outGain = null;
  function initAudio() {
    if (actx) return;
    try {
      actx = new (window.AudioContext || window.webkitAudioContext)();
      outGain = actx.createGain(); outGain.gain.value = soundOn ? 1 : 0;
      master = actx.createGain(); master.gain.value = 0.85;
      var lp = actx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 9000;
      var rev = actx.createConvolver(); rev.buffer = makeImpulse(1.6, 3.0);
      var wet = actx.createGain(); wet.gain.value = 0.2;
      master.connect(lp); lp.connect(outGain);
      master.connect(rev); rev.connect(wet); wet.connect(outGain);
      outGain.connect(actx.destination);
    } catch (e) { actx = null; }
  }
  function makeImpulse(dur, decay) {
    var rate = actx.sampleRate, len = Math.floor(rate * dur), buf = actx.createBuffer(2, len, rate);
    for (var ch = 0; ch < 2; ch++) { var d = buf.getChannelData(ch); for (var i = 0; i < len; i++) { var t = i / len; d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay); } for (var k = 1; k < len; k++) d[k] = d[k] * 0.55 + d[k - 1] * 0.45; }
    return buf;
  }
  function unlockAudio() {
    initAudio();
    if (actx && actx.state === "suspended") actx.resume();
    if (actx) { var b = actx.createBuffer(1, 1, 22050); var s = actx.createBufferSource(); s.buffer = b; s.connect(actx.destination); s.start(0); }
  }
  function tone(freq, t0, dur, type, gain) {
    if (!actx) return;
    var o = actx.createOscillator(); o.type = type || "sine"; o.frequency.value = freq;
    var g = actx.createGain(); g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(master); o.start(t0); o.stop(t0 + dur + 0.03);
  }
  function slideSound() {
    if (!actx) return; var t = actx.currentTime;
    var n = actx.createBufferSource(); var len = Math.floor(actx.sampleRate * 0.09);
    var buf = actx.createBuffer(1, len, actx.sampleRate); var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    n.buffer = buf;
    var bp = actx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 620; bp.Q.value = 0.8;
    var g = actx.createGain(); g.gain.value = 0.06;
    n.connect(bp); bp.connect(g); g.connect(master); n.start(t);
  }
  var PENTA = [0, 2, 4, 7, 9];
  function mergeSound(val) {
    if (!actx) return; var t = actx.currentTime;
    var k = Math.max(0, Math.round(Math.log(val / 3) / Math.log(2)));
    var semis = PENTA[k % 5] + 12 * Math.floor(k / 5);
    var f = 392 * Math.pow(2, semis / 12);       // G4 base, climbing pentatonic
    tone(f, t, 0.5, "triangle", 0.16);
    tone(f * 2, t + 0.005, 0.35, "sine", 0.06);
    tone(f * 1.5, t + 0.01, 0.25, "sine", 0.04);
  }
  function overSound() {
    if (!actx) return; var t = actx.currentTime;
    var ns = [523, 440, 349, 262];
    for (var i = 0; i < ns.length; i++) tone(ns[i], t + i * 0.12, 0.5, "triangle", 0.12);
  }

  // ---------- boot ----------
  reset();
  overlay.hidden = false;
  requestAnimationFrame(loop);
})();
