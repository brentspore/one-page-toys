/* Random Maze — a fresh procedurally-generated neon maze every time.
 * Move with arrow keys / WASD (glide down a corridor until a wall), swipe,
 * or tap a spot to auto-path there. Race the timer to the glowing exit.
 * Vanilla Canvas 2D + Web Audio. */
(function () {
  "use strict";

  var canvas = document.getElementById("canvas");
  var ctx = canvas.getContext("2d");
  var timeEl = document.getElementById("time");
  var bestEl = document.getElementById("best");
  var soundBtn = document.getElementById("soundBtn");
  var diffBtn = document.getElementById("diffBtn");
  var fogBtn = document.getElementById("fogBtn");
  var newBtn = document.getElementById("newBtn");
  var overlay = document.getElementById("overlay");
  var ovTitle = document.getElementById("ovTitle");
  var ovText = document.getElementById("ovText");
  var ovBtn = document.getElementById("ovBtn");
  var hintEl = document.getElementById("hint");

  var W = 0, H = 0, DPR = 1;

  // tunables
  var STEP_TIME = 0.085;        // seconds to glide one cell (movement snappiness)
  var TORCH_CELLS = 3.2;        // fog torch radius, in cells
  var MARGIN_TOP = 70, MARGIN_BOT = 66, PADX = 24;
  var DIFFS = [
    { name: "Easy", short: 9 },
    { name: "Medium", short: 15 },
    { name: "Hard", short: 23 }
  ];

  // colors
  var C_WALL = "#39e1ff", C_PLAYER = "#eafcff", C_EXIT = "#37ffb0", C_TRAIL = "#39e1ff";

  // maze state
  var cols = 0, rows = 0, cell = 0, ox = 0, oy = 0;
  var grid = [];                // each: {walls:[N,E,S,W]}
  var mazeCv = document.createElement("canvas");
  var mazeCtx = mazeCv.getContext("2d");
  var fogCv = document.createElement("canvas");
  var fogCtx = fogCv.getContext("2d");

  // player / play state
  var player = { x: 0, y: 0, px: 0, py: 0 };   // x,y = cell; px,py = pixel pos
  var target = null;            // {x,y} cell we are gliding toward
  var path = [];                // queued cells (tap-to-path)
  var queuedDir = null;         // pending direction intent
  var glideDir = null;          // current auto-glide direction
  var visited = {};             // "x,y" -> true (breadcrumbs)
  var seen = {};                // fog memory
  var exit = { x: 0, y: 0 };

  var diffIdx = 1, fog = false, soundOn = true;
  var started = false, running = false, won = false;
  var startT = 0, elapsed = 0, best = null;
  var particles = [];
  var swayT = 0;

  var DIRS = [
    { dx: 0, dy: -1, w: 0 },  // up
    { dx: 1, dy: 0, w: 1 },   // right
    { dx: 0, dy: 1, w: 2 },   // down
    { dx: -1, dy: 0, w: 3 }   // left
  ];
  var OPP = [2, 3, 0, 1];

  try { diffIdx = Math.min(2, Math.max(0, parseInt(localStorage.getItem("maze_diff"), 10) || 1)); } catch (e) {}
  diffBtn.textContent = DIFFS[diffIdx].name;

  function bestKey() { return "maze_best_" + DIFFS[diffIdx].short; }
  function loadBest() { try { var v = parseFloat(localStorage.getItem(bestKey())); best = isFinite(v) ? v : null; } catch (e) { best = null; } bestEl.textContent = best == null ? "Best –" : "Best " + fmt(best); }

  function fmt(sec) {
    var m = Math.floor(sec / 60), s = sec - m * 60;
    return m + ":" + (s < 10 ? "0" : "") + s.toFixed(1);
  }

  // ---------------- layout + generation ----------------
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.floor(W * DPR); canvas.height = Math.floor(H * DPR);
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    for (var i = 0, cvs = [mazeCv, fogCv]; i < 2; i++) {
      cvs[i].width = Math.floor(W * DPR); cvs[i].height = Math.floor(H * DPR);
    }
    mazeCtx.setTransform(DPR, 0, 0, DPR, 0, 0);
    layout();
    renderMaze();
    // keep the player pinned to its cell center after a resize
    player.px = cx(player.x); player.py = cy(player.y);
    if (target) { target = null; glideDir = null; path = []; }
  }

  function layout() {
    var s = DIFFS[diffIdx].short;
    var availW = W - PADX * 2, availH = H - MARGIN_TOP - MARGIN_BOT;
    var aspect = availW / Math.max(1, availH);
    if (aspect >= 1) { rows = s; cols = Math.max(s, Math.round(s * aspect)); }
    else { cols = s; rows = Math.max(s, Math.round(s / aspect)); }
    cols = Math.max(5, cols); rows = Math.max(5, rows);
    cell = Math.min(availW / cols, availH / rows);
    var mw = cols * cell, mh = rows * cell;
    ox = (W - mw) / 2;
    oy = MARGIN_TOP + (availH - mh) / 2;
  }

  function idx(x, y) { return y * cols + x; }
  function cx(x) { return ox + x * cell + cell / 2; }
  function cy(y) { return oy + y * cell + cell / 2; }

  function generate() {
    grid = new Array(cols * rows);
    for (var i = 0; i < grid.length; i++) grid[i] = { walls: [true, true, true, true] };
    // iterative recursive-backtracker (depth-first)
    var seenGen = new Uint8Array(cols * rows);
    var stack = [0]; seenGen[0] = 1;
    while (stack.length) {
      var cur = stack[stack.length - 1];
      var cxi = cur % cols, cyi = (cur / cols) | 0;
      var opts = [];
      for (var d = 0; d < 4; d++) {
        var nx = cxi + DIRS[d].dx, ny = cyi + DIRS[d].dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        if (!seenGen[idx(nx, ny)]) opts.push(d);
      }
      if (opts.length) {
        var d2 = opts[(Math.random() * opts.length) | 0];
        var nx2 = cxi + DIRS[d2].dx, ny2 = cyi + DIRS[d2].dy, ni = idx(nx2, ny2);
        grid[cur].walls[d2] = false;
        grid[ni].walls[OPP[d2]] = false;
        seenGen[ni] = 1; stack.push(ni);
      } else stack.pop();
    }
  }

  function renderMaze() {
    mazeCtx.setTransform(DPR, 0, 0, DPR, 0, 0);
    mazeCtx.clearRect(0, 0, W, H);
    if (!grid.length) return;
    var p = new Path2D();
    for (var y = 0; y < rows; y++) for (var x = 0; x < cols; x++) {
      var c = grid[idx(x, y)], X = ox + x * cell, Y = oy + y * cell;
      if (c.walls[0]) { p.moveTo(X, Y); p.lineTo(X + cell, Y); }
      if (c.walls[3]) { p.moveTo(X, Y); p.lineTo(X, Y + cell); }
      if (x === cols - 1 && c.walls[1]) { p.moveTo(X + cell, Y); p.lineTo(X + cell, Y + cell); }
      if (y === rows - 1 && c.walls[2]) { p.moveTo(X, Y + cell); p.lineTo(X + cell, Y + cell); }
    }
    var lw = Math.max(1.6, cell * 0.10);
    mazeCtx.lineCap = "round"; mazeCtx.lineJoin = "round";
    // outer glow
    mazeCtx.shadowColor = C_WALL; mazeCtx.shadowBlur = Math.max(6, cell * 0.5);
    mazeCtx.strokeStyle = "rgba(57,225,255,0.55)"; mazeCtx.lineWidth = lw; mazeCtx.stroke(p);
    mazeCtx.stroke(p);
    // bright core
    mazeCtx.shadowBlur = Math.max(2, cell * 0.14);
    mazeCtx.strokeStyle = "#cdf6ff"; mazeCtx.lineWidth = Math.max(1, lw * 0.5); mazeCtx.stroke(p);
    mazeCtx.shadowBlur = 0;
  }

  // ---------------- new game ----------------
  function newMaze() {
    layout();
    generate();
    renderMaze();
    player.x = 0; player.y = 0; player.px = cx(0); player.py = cy(0);
    exit = { x: cols - 1, y: rows - 1 };
    target = null; path = []; queuedDir = null; glideDir = null;
    visited = {}; seen = {}; markVisited(0, 0);
    elapsed = 0; running = false; won = false; startT = 0;
    timeEl.textContent = "0:00.0";
    loadBest();
    particles = [];
  }

  function markVisited(x, y) { visited[x + "," + y] = true; }

  // ---------------- movement ----------------
  function canGo(x, y, d) {
    if (grid[idx(x, y)].walls[d]) return false;
    var nx = x + DIRS[d].dx, ny = y + DIRS[d].dy;
    return nx >= 0 && ny >= 0 && nx < cols && ny < rows;
  }
  function setDir(d) {
    if (!started || won) return;
    path = [];                 // manual input cancels an auto-path
    queuedDir = d;
    if (!running && !won) startRun();
  }
  function startRun() { if (!running && !won) { running = true; startT = perfNow() - elapsed * 1000; } }

  // choose the next cell to glide toward once we arrive at a center
  function pickNext() {
    if (path.length) { target = path.shift(); glideDir = null; return; }
    var x = player.x, y = player.y;
    if (queuedDir != null && canGo(x, y, queuedDir)) { glideDir = queuedDir; queuedDir = null; }
    else if (glideDir != null && canGo(x, y, glideDir)) { /* keep gliding straight */ }
    else {
      if (queuedDir != null) { sndBump(); queuedDir = null; }   // pressed into a wall
      glideDir = null; target = null; return;
    }
    target = { x: x + DIRS[glideDir].dx, y: y + DIRS[glideDir].dy };
  }

  function update(dt) {
    swayT += dt;
    if (running && !won) { elapsed = (perfNow() - startT) / 1000; timeEl.textContent = fmt(elapsed); }

    if (!target && (path.length || glideDir != null || queuedDir != null)) pickNext();

    if (target) {
      var tx = cx(target.x), ty = cy(target.y);
      var vx = tx - player.px, vy = ty - player.py;
      var dist = Math.hypot(vx, vy), step = (cell / STEP_TIME) * dt;
      if (dist <= step || dist < 0.5) {
        player.px = tx; player.py = ty; player.x = target.x; player.y = target.y;
        target = null;
        markVisited(player.x, player.y);
        sndStep();
        if (player.x === exit.x && player.y === exit.y) { doWin(); return; }
        pickNext();               // immediately continue (glide / path)
      } else {
        player.px += vx / dist * step; player.py += vy / dist * step;
      }
    }

    if (fog) reveal();

    for (var i = particles.length - 1; i >= 0; i--) {
      var q = particles[i]; q.life += dt; q.vy += 640 * dt; q.x += q.vx * dt; q.y += q.vy * dt; q.rot += q.vr * dt;
      if (q.life >= q.max) particles.splice(i, 1);
    }
  }

  function reveal() {
    var R = cell * TORCH_CELLS, r2 = R * R;
    var minX = Math.max(0, Math.floor((player.px - R - ox) / cell)), maxX = Math.min(cols - 1, Math.ceil((player.px + R - ox) / cell));
    var minY = Math.max(0, Math.floor((player.py - R - oy) / cell)), maxY = Math.min(rows - 1, Math.ceil((player.py + R - oy) / cell));
    for (var y = minY; y <= maxY; y++) for (var x = minX; x <= maxX; x++) {
      var dx = cx(x) - player.px, dy = cy(y) - player.py;
      if (dx * dx + dy * dy <= r2) seen[x + "," + y] = true;
    }
  }

  // ---------------- tap-to-path (BFS) ----------------
  function bfs(sx, sy, tx, ty) {
    if (sx === tx && sy === ty) return [];
    var q = [idx(sx, sy)], head = 0, prev = new Int32Array(cols * rows).fill(-1), seenB = new Uint8Array(cols * rows);
    seenB[idx(sx, sy)] = 1; prev[idx(sx, sy)] = -2;
    var goal = idx(tx, ty), found = false;
    while (head < q.length) {
      var cur = q[head++], ccx = cur % cols, ccy = (cur / cols) | 0;
      if (cur === goal) { found = true; break; }
      for (var d = 0; d < 4; d++) {
        if (grid[cur].walls[d]) continue;
        var nx = ccx + DIRS[d].dx, ny = ccy + DIRS[d].dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        var ni = idx(nx, ny);
        if (seenB[ni]) continue;
        seenB[ni] = 1; prev[ni] = cur; q.push(ni);
      }
    }
    if (!found) return null;
    var out = [], node = goal;
    while (node !== idx(sx, sy)) { out.push({ x: node % cols, y: (node / cols) | 0 }); node = prev[node]; }
    out.reverse();
    return out;
  }
  function cellFromPx(mx, my) {
    var gx = Math.floor((mx - ox) / cell), gy = Math.floor((my - oy) / cell);
    if (gx < 0 || gy < 0 || gx >= cols || gy >= rows) return null;
    return { x: gx, y: gy };
  }
  function tapTo(mx, my) {
    if (!started || won) return;
    var c = cellFromPx(mx, my);
    if (!c) return;
    var p = bfs(player.x, player.y, c.x, c.y);
    if (p && p.length) { path = p; queuedDir = null; glideDir = null; target = null; startRun(); }
  }

  // ---------------- win ----------------
  function doWin() {
    won = true; running = false;
    elapsed = (perfNow() - startT) / 1000; timeEl.textContent = fmt(elapsed);
    var isBest = best == null || elapsed < best;
    if (isBest) { best = elapsed; try { localStorage.setItem(bestKey(), String(best)); } catch (e) {} bestEl.textContent = "Best " + fmt(best); }
    sndWin(isBest);
    burst(cx(exit.x), cy(exit.y), isBest ? 90 : 46);
    setTimeout(function () {
      ovTitle.textContent = isBest ? "New best!" : "Solved!";
      ovText.textContent = "You cleared the " + DIFFS[diffIdx].name.toLowerCase() + " maze in " + fmt(elapsed) + "." + (best != null ? " Best: " + fmt(best) + "." : "");
      ovBtn.textContent = "New maze";
      overlay.hidden = false; overlay.classList.remove("is-hidden");
    }, 850);
  }

  function burst(x, y, n) {
    var cols2 = ["#39e1ff", "#37ffb0", "#ffd24d", "#ff5db8", "#b48bff"];
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2, sp = 120 + Math.random() * 360;
      particles.push({ x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 160, life: 0, max: 0.9 + Math.random() * 0.7, rot: Math.random() * 6, vr: (Math.random() * 2 - 1) * 10, c: cols2[(Math.random() * cols2.length) | 0], s: 3 + Math.random() * 4 });
    }
  }

  // ---------------- render ----------------
  function render() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    // background
    var bg = ctx.createRadialGradient(W / 2, H * 0.42, 0, W / 2, H * 0.42, Math.max(W, H) * 0.75);
    bg.addColorStop(0, "#0a1120"); bg.addColorStop(1, "#04060c");
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

    // breadcrumb trail (visited cells) — faint glow
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (var k in visited) {
      var pp = k.split(","), vx = +pp[0], vy = +pp[1];
      if (fog && !seen[k]) continue;
      var g = ctx.createRadialGradient(cx(vx), cy(vy), 0, cx(vx), cy(vy), cell * 0.5);
      g.addColorStop(0, "rgba(57,225,255,0.16)"); g.addColorStop(1, "rgba(57,225,255,0)");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx(vx), cy(vy), cell * 0.5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();

    // maze walls
    ctx.drawImage(mazeCv, 0, 0, W, H);

    // exit gate — pulsing green
    if (!fog || seen[exit.x + "," + exit.y]) {
      var pulse = 0.6 + 0.4 * Math.sin(swayT * 3.2);
      ctx.save(); ctx.globalCompositeOperation = "lighter";
      var eg = ctx.createRadialGradient(cx(exit.x), cy(exit.y), 0, cx(exit.x), cy(exit.y), cell * 0.95);
      eg.addColorStop(0, "rgba(55,255,176," + (0.55 * pulse) + ")"); eg.addColorStop(0.6, "rgba(55,255,176,0.18)"); eg.addColorStop(1, "rgba(55,255,176,0)");
      ctx.fillStyle = eg; ctx.beginPath(); ctx.arc(cx(exit.x), cy(exit.y), cell * 0.95, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      ctx.fillStyle = C_EXIT; ctx.shadowColor = C_EXIT; ctx.shadowBlur = cell * 0.6;
      diamond(cx(exit.x), cy(exit.y), cell * 0.24); ctx.fill(); ctx.shadowBlur = 0;
    }

    // fog overlay
    if (fog) { buildFog(); ctx.drawImage(fogCv, 0, 0, W, H); }

    // player spark
    ctx.save(); ctx.globalCompositeOperation = "lighter";
    var pr = cell * 0.30;
    var pg = ctx.createRadialGradient(player.px, player.py, 0, player.px, player.py, pr * 2.6);
    pg.addColorStop(0, "rgba(230,252,255,0.95)"); pg.addColorStop(0.4, "rgba(57,225,255,0.6)"); pg.addColorStop(1, "rgba(57,225,255,0)");
    ctx.fillStyle = pg; ctx.beginPath(); ctx.arc(player.px, player.py, pr * 2.6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = C_PLAYER; ctx.beginPath(); ctx.arc(player.px, player.py, pr * 0.62, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // particles
    for (var i = 0; i < particles.length; i++) {
      var q = particles[i], a = 1 - q.life / q.max;
      ctx.save(); ctx.globalAlpha = Math.max(0, a); ctx.translate(q.x, q.y); ctx.rotate(q.rot);
      ctx.fillStyle = q.c; ctx.fillRect(-q.s / 2, -q.s / 2, q.s, q.s * 1.6); ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  function diamond(x, y, r) { ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath(); }

  function buildFog() {
    fogCtx.setTransform(1, 0, 0, 1, 0, 0);
    fogCtx.clearRect(0, 0, fogCv.width, fogCv.height);
    fogCtx.setTransform(DPR, 0, 0, DPR, 0, 0);
    fogCtx.globalCompositeOperation = "source-over";
    fogCtx.fillStyle = "rgba(3,5,11,0.965)"; fogCtx.fillRect(0, 0, W, H);
    fogCtx.globalCompositeOperation = "destination-out";
    // dim reveal of explored cells
    fogCtx.fillStyle = "rgba(0,0,0,0.34)";
    for (var k in seen) { var pp = k.split(","); fogCtx.fillRect(ox + (+pp[0]) * cell, oy + (+pp[1]) * cell, cell, cell); }
    // bright torch around the player
    var R = cell * TORCH_CELLS;
    var tg = fogCtx.createRadialGradient(player.px, player.py, 0, player.px, player.py, R);
    tg.addColorStop(0, "rgba(0,0,0,1)"); tg.addColorStop(0.55, "rgba(0,0,0,0.9)"); tg.addColorStop(1, "rgba(0,0,0,0)");
    fogCtx.fillStyle = tg; fogCtx.beginPath(); fogCtx.arc(player.px, player.py, R, 0, Math.PI * 2); fogCtx.fill();
    fogCtx.globalCompositeOperation = "source-over";
  }

  var last = 0;
  function frame(ts) {
    var dt = last ? Math.min((ts - last) / 1000, 0.05) : 0; last = ts;
    update(dt); render();
    requestAnimationFrame(frame);
  }

  // ---------------- input ----------------
  function startGame() {
    overlay.classList.add("is-hidden");
    setTimeout(function () { overlay.hidden = true; }, 200);
    started = true;
    hintEl.classList.remove("is-gone");
    setTimeout(function () { hintEl.classList.add("is-gone"); }, 5000);
  }

  var KEYMAP = { ArrowUp: 0, KeyW: 0, ArrowRight: 1, KeyD: 1, ArrowDown: 2, KeyS: 2, ArrowLeft: 3, KeyA: 3 };
  window.addEventListener("keydown", function (e) {
    if (e.code === "Space" || e.code === "Enter") { if (!started || won) { e.preventDefault(); handleAdvance(); } return; }
    var d = KEYMAP[e.code];
    if (d == null) return;
    e.preventDefault();
    unlock();
    if (!started) return;
    setDir(d);
  });

  var downX = 0, downY = 0, downT = 0, dragging = false;
  canvas.addEventListener("pointerdown", function (e) {
    e.preventDefault(); unlock();
    if (!started || won) { handleAdvance(); return; }
    downX = e.clientX; downY = e.clientY; downT = perfNow(); dragging = true;
  });
  canvas.addEventListener("pointerup", function (e) {
    if (!dragging) return; dragging = false;
    if (!started || won) return;
    var dx = e.clientX - downX, dy = e.clientY - downY, dist = Math.hypot(dx, dy);
    if (dist < 14 && perfNow() - downT < 500) { tapTo(e.clientX, e.clientY); return; }   // tap → path there
    if (dist >= 14) {                                                                     // swipe → glide that way
      if (Math.abs(dx) > Math.abs(dy)) setDir(dx > 0 ? 1 : 3);
      else setDir(dy > 0 ? 2 : 0);
    }
  });
  canvas.addEventListener("pointercancel", function () { dragging = false; });

  function handleAdvance() {
    if (won) { newMaze(); startGame(); return; }
    if (!started) { startGame(); return; }
  }
  ovBtn.addEventListener("click", handleAdvance);

  diffBtn.addEventListener("click", function () {
    diffIdx = (diffIdx + 1) % DIFFS.length;
    diffBtn.textContent = DIFFS[diffIdx].name;
    try { localStorage.setItem("maze_diff", String(diffIdx)); } catch (e) {}
    newMaze(); if (started) { /* keep playing */ }
  });
  fogBtn.addEventListener("click", function () {
    fog = !fog; fogBtn.setAttribute("aria-pressed", fog ? "true" : "false"); unlock();
  });
  newBtn.addEventListener("click", function () { newMaze(); unlock(); });
  soundBtn.addEventListener("click", function () {
    soundOn = !soundOn; soundBtn.setAttribute("aria-pressed", soundOn ? "true" : "false");
    if (outGain) outGain.gain.value = soundOn ? 1 : 0; unlock();
  });

  // ============================ AUDIO ============================
  var actx = null, master = null, outGain = null, convo = null, wet = null, stepI = 0;
  function perfNow() { return (window.performance && performance.now) ? performance.now() : Date.now(); }
  function initAudio() {
    if (actx) return;
    try {
      actx = new (window.AudioContext || window.webkitAudioContext)();
      outGain = actx.createGain(); outGain.gain.value = soundOn ? 1 : 0;
      master = actx.createGain(); master.gain.value = 0.9;
      convo = actx.createConvolver(); convo.buffer = makeImpulse(1.6, 3.2);
      wet = actx.createGain(); wet.gain.value = 0.2;
      master.connect(outGain); wet.connect(convo); convo.connect(outGain); outGain.connect(actx.destination);
    } catch (e) { actx = null; }
  }
  function makeImpulse(dur, decay) {
    var n = Math.floor(actx.sampleRate * dur), buf = actx.createBuffer(2, n, actx.sampleRate);
    for (var ch = 0; ch < 2; ch++) { var d = buf.getChannelData(ch); for (var i = 0; i < n; i++) { var t = i / n; d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay); } }
    return buf;
  }
  function unlock() { initAudio(); if (actx && actx.state === "suspended") actx.resume(); if (actx) { var b = actx.createBuffer(1, 1, 22050), s = actx.createBufferSource(); s.buffer = b; s.connect(actx.destination); s.start(0); } }
  function bus(g) { g.connect(master); g.connect(wet); }

  var PENTA = [0, 2, 4, 7, 9, 12];
  function sndStep() {
    if (!actx || !soundOn) return;
    var t = actx.currentTime;
    var semi = PENTA[stepI % PENTA.length]; stepI++;
    var f = 523.25 * Math.pow(2, semi / 12);
    var o = actx.createOscillator(); o.type = "triangle"; o.frequency.value = f;
    var g = actx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0008, t + 0.13);
    o.connect(g); bus(g); o.start(t); o.stop(t + 0.15);
  }
  function sndBump() {
    if (!actx || !soundOn) return;
    var t = actx.currentTime;
    var o = actx.createOscillator(); o.type = "sine"; o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(70, t + 0.12);
    var g = actx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12, t + 0.005); g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    o.connect(g); bus(g); o.start(t); o.stop(t + 0.18);
  }
  function sndWin(isBest) {
    if (!actx || !soundOn) return;
    var t = actx.currentTime, notes = isBest ? [0, 4, 7, 12, 16, 19] : [0, 4, 7, 12];
    notes.forEach(function (st, i) {
      var o = actx.createOscillator(); o.type = "triangle"; o.frequency.value = 523.25 * Math.pow(2, st / 12);
      var g = actx.createGain(); var tt = t + i * 0.085; g.gain.setValueAtTime(0, tt); g.gain.linearRampToValueAtTime(0.14, tt + 0.02); g.gain.exponentialRampToValueAtTime(0.001, tt + 0.5);
      o.connect(g); bus(g); o.start(tt); o.stop(tt + 0.55);
    });
  }

  // ---------------- boot ----------------
  window.addEventListener("resize", resize);
  resize();
  newMaze();
  overlay.hidden = false;
  requestAnimationFrame(frame);
})();
