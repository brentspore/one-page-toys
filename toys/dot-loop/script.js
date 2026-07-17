/* Dot Loop — a calm connect-the-dots puzzle. Drag across touching same-color
 * dots to clear them; draw a path back onto itself to close a LOOP, which
 * clears every dot of that color. Dots fall to refill. Endless, no fail.
 * Vanilla Canvas 2D + Web Audio. */
(function () {
  "use strict";

  var canvas = document.getElementById("canvas");
  var ctx = canvas.getContext("2d");
  var scoreEl = document.getElementById("score");
  var bestEl = document.getElementById("best");
  var soundBtn = document.getElementById("soundBtn");
  var newBtn = document.getElementById("newBtn");
  var overlay = document.getElementById("overlay");
  var ovBtn = document.getElementById("ovBtn");
  var hintEl = document.getElementById("hint");

  var W = 0, H = 0, DPR = 1;
  var COLS = 6, ROWS = 7;
  var GRAV = 3000;

  // rich jewel palette on a dark board: {base, hi (light center), line (saturated)}
  var PAL = [
    { base: "#f0515f", hi: "#ff8a94", line: "#ff5a68" },   // rose
    { base: "#f0a12e", hi: "#ffca6e", line: "#ffab33" },   // amber
    { base: "#1fbf92", hi: "#5fe3bd", line: "#25d6a4" },   // teal
    { base: "#3f8ef0", hi: "#7db8ff", line: "#4f9bff" },   // azure
    { base: "#9a5cf0", hi: "#c49bff", line: "#a86bff" }    // violet
  ];

  var cell = 60, bx = 0, by = 0, R = 20;
  var grid = [];                 // grid[gx][gy] = {c, py, vy} | null
  var chain = [], chainC = 0, dragging = false, loop = false, loopClose = null;
  var particles = [], wash = null, animating = false;
  var score = 0, best = 0, prevBest = 0, crossed = false, started = false, soundOn = true, t = 0;

  try { best = parseInt(localStorage.getItem("dotloop_best"), 10) || 0; } catch (e) { best = 0; }
  prevBest = best;
  bestEl.textContent = "Best " + best;

  function cellX(gx) { return bx + gx * cell + cell / 2; }
  function cellY(gy) { return by + gy * cell + cell / 2; }

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.floor(W * DPR); canvas.height = Math.floor(H * DPR);
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    var mt = 96, mb = 78, px = 22;
    var availW = W - px * 2, availH = H - mt - mb;
    cell = Math.min(availW / COLS, availH / ROWS, 94);
    R = cell * 0.34;
    var boardW = COLS * cell, boardH = ROWS * cell;
    bx = (W - boardW) / 2; by = mt + (availH - boardH) / 2;
    // keep dots pinned to their rows after a resize
    for (var gx = 0; gx < COLS; gx++) for (var gy = 0; gy < ROWS; gy++) if (grid[gx] && grid[gx][gy]) grid[gx][gy].py = cellY(gy);
  }
  window.addEventListener("resize", resize);

  function fillBoard() {
    grid = [];
    for (var gx = 0; gx < COLS; gx++) { grid[gx] = []; for (var gy = 0; gy < ROWS; gy++) grid[gx][gy] = { c: (Math.random() * PAL.length) | 0, py: cellY(gy), vy: 0 }; }
    chain = []; loop = false; dragging = false; particles = []; wash = null;
  }

  // ---------------- interaction ----------------
  function dotAt(mx, my) {
    // cell-based hit test — the whole cell is the dot, so drags are forgiving
    var gx = Math.floor((mx - bx) / cell), gy = Math.floor((my - by) / cell);
    if (gx < 0 || gy < 0 || gx >= COLS || gy >= ROWS) return null;
    if (!grid[gx][gy]) return null;
    return { x: gx, y: gy };
  }
  function inChain(gx, gy) { for (var i = 0; i < chain.length; i++) if (chain[i].x === gx && chain[i].y === gy) return i; return -1; }

  function startChain(mx, my) {
    if (animating) return;
    var c = dotAt(mx, my); if (!c) return;
    chain = [c]; chainC = grid[c.x][c.y].c; dragging = true; loop = false; loopClose = null;
  }
  function extendChain(mx, my) {
    if (!dragging) return;
    var c = dotAt(mx, my); if (!c) return;
    var last = chain[chain.length - 1];
    if (c.x === last.x && c.y === last.y) { loop = false; loopClose = null; return; }
    if (Math.abs(c.x - last.x) + Math.abs(c.y - last.y) !== 1) return;   // must be an orthogonal neighbor
    if (grid[c.x][c.y].c !== chainC) return;                             // same color only
    var idx = inChain(c.x, c.y);
    if (idx >= 0) {
      if (idx === chain.length - 2) { chain.pop(); loop = false; loopClose = null; return; }  // backtrack (undo last)
      if (!loop) { loop = true; loopClose = c; sndLoop(); } return;                            // revisit earlier = loop
    }
    chain.push(c); loop = false; loopClose = null; sndPluck(chain.length);                     // new link
  }
  function endChain() {
    if (!dragging) return; dragging = false;
    if (loop) {
      var cells = [];
      for (var gx = 0; gx < COLS; gx++) for (var gy = 0; gy < ROWS; gy++) if (grid[gx][gy] && grid[gx][gy].c === chainC) cells.push({ x: gx, y: gy });
      if (cells.length) { addScore(cells.length * 2); wash = { c: chainC, t: 0, max: 0.6 }; sndLoopClear(); clearCells(cells); }
    } else if (chain.length >= 2) {
      addScore(chain.length + (chain.length > 3 ? chain.length - 3 : 0));
      sndClear(chain.length); clearCells(chain.slice());
    }
    chain = []; loop = false; loopClose = null;
  }

  function clearCells(cells) {
    for (var i = 0; i < cells.length; i++) { var d = grid[cells[i].x][cells[i].y]; if (d) { popFx(cellX(cells[i].x), d.py, d.c); grid[cells[i].x][cells[i].y] = null; } }
    applyGravity();
  }
  function applyGravity() {
    for (var gx = 0; gx < COLS; gx++) {
      var stack = [];
      for (var gy = ROWS - 1; gy >= 0; gy--) if (grid[gx][gy]) stack.push(grid[gx][gy]);   // existing, bottom-up
      var col = new Array(ROWS).fill(null), row = ROWS - 1;
      for (var s = 0; s < stack.length; s++) { col[row] = stack[s]; row--; }               // repack to the bottom
      var above = 1;
      for (; row >= 0; row--) { col[row] = { c: (Math.random() * PAL.length) | 0, py: by - above * cell, vy: 0 }; above++; }  // new dots drop from above
      grid[gx] = col;
    }
  }

  function addScore(n) {
    score += n; scoreEl.textContent = String(score);
    if (score > best) { best = score; try { localStorage.setItem("dotloop_best", String(best)); } catch (e) {} bestEl.textContent = "Best " + best; }
    if (!crossed && score > prevBest && prevBest >= 0) { crossed = true; sparkle(); }   // one celebratory sparkle when you beat your record
  }
  function sparkle() { for (var i = 0; i < 14; i++) { var a = Math.random() * 6.283, sp = 60 + Math.random() * 160; particles.push({ x: W / 2, y: 70, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40, life: 0, max: 0.7, r: 2 + Math.random() * 2, sp: 1, col: PAL[(Math.random() * PAL.length) | 0].line }); } }

  function popFx(x, y, c) {
    particles.push({ ring: 1, x: x, y: y, r: R * 0.7, life: 0, max: 0.5, col: PAL[c].line });
    for (var i = 0; i < 5; i++) { var a = Math.random() * 6.283, sp = 40 + Math.random() * 130; particles.push({ x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0, max: 0.5, r: 1.5 + Math.random() * 2.5, col: PAL[c].hi }); }
  }

  // ---------------- update ----------------
  function update(dt) {
    t += dt;
    animating = false;
    for (var gx = 0; gx < COLS; gx++) for (var gy = 0; gy < ROWS; gy++) {
      var d = grid[gx][gy]; if (!d) continue; var ty = cellY(gy);
      if (Math.abs(d.py - ty) > 0.4 || Math.abs(d.vy) > 2) {
        d.vy += GRAV * dt; d.py += d.vy * dt;
        if (d.py >= ty) { d.py = ty; if (d.vy > 70) d.vy = -d.vy * 0.24; else d.vy = 0; }
        animating = true;
      } else { d.py = ty; d.vy = 0; }
    }
    for (var p = particles.length - 1; p >= 0; p--) {
      var q = particles[p]; q.life += dt;
      if (q.ring) q.r += (R * 1.8) * dt; else { if (!q.sp) q.vy += 280 * dt; q.x += (q.vx || 0) * dt; q.y += (q.vy || 0) * dt; }
      if (q.life >= q.max) particles.splice(p, 1);
    }
    if (wash) { wash.t += dt; if (wash.t >= wash.max) wash = null; }
  }

  // ---------------- render ----------------
  function render() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    var bg = ctx.createRadialGradient(W / 2, H * 0.4, 0, W / 2, H * 0.4, Math.max(W, H) * 0.72);
    bg.addColorStop(0, "#232734"); bg.addColorStop(0.65, "#181b24"); bg.addColorStop(1, "#12141b");
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

    // board backing — subtle raised panel
    var pad = cell * 0.14;
    roundRect(bx - pad, by - pad, COLS * cell + pad * 2, ROWS * cell + pad * 2, cell * 0.34);
    ctx.fillStyle = "rgba(255,255,255,0.035)"; ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.06)"; ctx.lineWidth = 1; ctx.stroke();

    // connection line
    if (chain.length >= 1) {
      var col = PAL[chainC].line;
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      var pts = [];
      for (var i = 0; i < chain.length; i++) pts.push({ x: cellX(chain[i].x), y: grid[chain[i].x][chain[i].y].py });
      if (loop && loopClose) pts.push({ x: cellX(loopClose.x), y: grid[loopClose.x][loopClose.y].py });
      if (pts.length >= 2) {
        ctx.strokeStyle = hexA(col, 0.28); ctx.lineWidth = R * 0.9; strokePts(pts);
        ctx.strokeStyle = col; ctx.lineWidth = R * 0.42; strokePts(pts);
      }
    }

    // dots
    for (var gx = 0; gx < COLS; gx++) for (var gy = 0; gy < ROWS; gy++) {
      var d = grid[gx][gy]; if (!d) continue;
      var sel = inChain(gx, gy) >= 0;
      var pulse = (loop && d.c === chainC) ? 1 + 0.1 * Math.sin(t * 9) : 1;
      var rr = R * (sel ? 1.08 : 1) * pulse;
      drawDot(cellX(gx), d.py, rr, d.c, sel);
    }

    // particles
    for (var p = 0; p < particles.length; p++) {
      var q = particles[p], a = 1 - q.life / q.max;
      if (q.ring) { ctx.globalAlpha = a * 0.6; ctx.strokeStyle = q.col; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(q.x, q.y, q.r, 0, 6.2832); ctx.stroke(); }
      else { ctx.globalAlpha = a; ctx.fillStyle = q.col; ctx.beginPath(); ctx.arc(q.x, q.y, q.r, 0, 6.2832); ctx.fill(); }
    }
    ctx.globalAlpha = 1;

    // loop-clear wash
    if (wash) { ctx.globalAlpha = (1 - wash.t / wash.max) * 0.3; ctx.fillStyle = PAL[wash.c].base; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
  }

  function drawDot(cx, cy, r, c, sel) {
    var p = PAL[c];
    // soft glow
    ctx.save(); ctx.globalCompositeOperation = "lighter";
    var gl = ctx.createRadialGradient(cx, cy, r * 0.4, cx, cy, r * (sel ? 1.9 : 1.55));
    gl.addColorStop(0, hexA(p.line, sel ? 0.5 : 0.34)); gl.addColorStop(1, hexA(p.line, 0));
    ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(cx, cy, r * (sel ? 1.9 : 1.55), 0, 6.2832); ctx.fill();
    ctx.restore();
    // body — matte gradient, lit from upper-left
    var g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.34, r * 0.15, cx, cy, r);
    g.addColorStop(0, p.hi); g.addColorStop(0.6, p.base); g.addColorStop(1, hexA(p.line, 0.9));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, r, 0, 6.2832); ctx.fill();
    // subtle top sheen (not a candy hotspot)
    ctx.fillStyle = "rgba(255,255,255,0.22)"; ctx.beginPath(); ctx.ellipse(cx, cy - r * 0.42, r * 0.42, r * 0.16, 0, 0, 6.2832); ctx.fill();
    if (sel) { ctx.strokeStyle = "rgba(255,255,255,0.9)"; ctx.lineWidth = Math.max(2, r * 0.13); ctx.beginPath(); ctx.arc(cx, cy, r * 1.32, 0, 6.2832); ctx.stroke(); }
  }
  function strokePts(pts) { ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y); for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y); ctx.stroke(); }
  function roundRect(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  function hexA(hex, a) { var n = parseInt(hex.slice(1), 16); return "rgba(" + (n >> 16 & 255) + "," + (n >> 8 & 255) + "," + (n & 255) + "," + a + ")"; }

  var last = 0;
  function frame(ts) { var dt = last ? Math.min((ts - last) / 1000, 0.05) : 0.016; last = ts; update(dt); render(); requestAnimationFrame(frame); }

  // ---------------- input ----------------
  function startGame() { overlay.classList.add("is-hidden"); setTimeout(function () { overlay.hidden = true; }, 200); started = true; hintEl.classList.remove("is-gone"); setTimeout(function () { hintEl.classList.add("is-gone"); }, 5500); }
  canvas.addEventListener("pointerdown", function (e) { e.preventDefault(); unlock(); if (!started) { startGame(); return; } startChain(e.clientX, e.clientY); });
  canvas.addEventListener("pointermove", function (e) { if (dragging) extendChain(e.clientX, e.clientY); });
  window.addEventListener("pointerup", function () { endChain(); });
  canvas.addEventListener("pointercancel", function () { chain = []; dragging = false; loop = false; });
  ovBtn.addEventListener("click", startGame);
  newBtn.addEventListener("click", function () { fillBoard(); for (var gx = 0; gx < COLS; gx++) for (var gy = 0; gy < ROWS; gy++) grid[gx][gy].py = by - (ROWS - gy) * cell * 0.4; unlock(); });
  soundBtn.addEventListener("click", function () { soundOn = !soundOn; soundBtn.setAttribute("aria-pressed", soundOn ? "true" : "false"); if (outGain) outGain.gain.value = soundOn ? 1 : 0; unlock(); });

  // ============================ AUDIO ============================
  var actx = null, master = null, outGain = null, convo = null, wet = null, delay = null;
  function initAudio() {
    if (actx) return;
    try {
      actx = new (window.AudioContext || window.webkitAudioContext)();
      outGain = actx.createGain(); outGain.gain.value = soundOn ? 1 : 0;
      master = actx.createGain(); master.gain.value = 0.8;
      convo = actx.createConvolver(); convo.buffer = makeImpulse(2, 3);
      wet = actx.createGain(); wet.gain.value = 0.24;
      delay = actx.createDelay(); delay.delayTime.value = 0.26; var fb = actx.createGain(); fb.gain.value = 0.22;
      delay.connect(fb); fb.connect(delay); delay.connect(wet);
      master.connect(outGain); wet.connect(convo); convo.connect(outGain); outGain.connect(actx.destination);
    } catch (e) { actx = null; }
  }
  function makeImpulse(dur, decay) { var n = Math.floor(actx.sampleRate * dur), b = actx.createBuffer(2, n, actx.sampleRate); for (var ch = 0; ch < 2; ch++) { var d = b.getChannelData(ch); for (var i = 0; i < n; i++) { var x = i / n; d[i] = (Math.random() * 2 - 1) * Math.pow(1 - x, decay); } } return b; }
  function unlock() { initAudio(); if (actx && actx.state === "suspended") actx.resume(); if (actx) { var b = actx.createBuffer(1, 1, 22050), s = actx.createBufferSource(); s.buffer = b; s.connect(actx.destination); s.start(0); } }
  function bus(g, toDelay) { g.connect(master); g.connect(wet); if (toDelay) g.connect(delay); }
  var PENTA = [0, 2, 4, 7, 9];
  function note(i) { var n = PENTA[i % 5] + 12 * Math.min(3, Math.floor(i / 5)); return 523.25 * Math.pow(2, n / 12); }
  function ping(f, t0, vol, dur, toDelay) {
    var o = actx.createOscillator(); o.type = "sine"; o.frequency.value = f;
    var o2 = actx.createOscillator(); o2.type = "triangle"; o2.frequency.value = f * 2; var g2 = actx.createGain(); g2.gain.value = 0.3; o2.connect(g2);
    var g = actx.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + 0.01); g.gain.exponentialRampToValueAtTime(0.0006, t0 + dur);
    o.connect(g); g2.connect(g); bus(g, toDelay); o.start(t0); o2.start(t0); o.stop(t0 + dur + 0.02); o2.stop(t0 + dur + 0.02);
  }
  function sndPluck(n) { if (!actx || !soundOn) return; ping(note(n - 1), actx.currentTime, 0.12, 0.32, true); }
  function sndClear(n) { if (!actx || !soundOn) return; var t0 = actx.currentTime; ping(note(n), t0, 0.13, 0.4, true); ping(note(n) * 1.5, t0 + 0.03, 0.08, 0.4, false); }
  function sndLoop() { if (!actx || !soundOn) return; ping(880, actx.currentTime, 0.06, 0.5, true); }
  function sndLoopClear() { if (!actx || !soundOn) return; var t0 = actx.currentTime; for (var i = 0; i < 7; i++) ping(note(i + 2), t0 + i * 0.055, 0.11, 0.6, true); }

  // ---------------- boot ----------------
  resize();
  fillBoard();
  overlay.hidden = false;
  requestAnimationFrame(frame);

  // The tip-jar + fullscreen badges are relocated to the bottom-right corner on
  // this toy (their usual right-center dock sits in the drag field). Announce
  // the move: on load they slide from the center dock down to the corner, so
  // players see where they went. Reusable pattern — pair with the CSS override
  // block in styles.css on any toy that relocates the badges.
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
        var dy = (window.innerHeight / 2 + pair[1]) - (r.top + r.height / 2); // old center dock → new corner
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
