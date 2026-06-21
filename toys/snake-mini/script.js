/* Snake — classic neon snake on a canvas grid. Keys / WASD / swipe / pad. */
(function () {
  "use strict";

  var canvas = document.getElementById("board");
  var ctx = canvas.getContext("2d");
  var scoreEl = document.getElementById("score");
  var bestEl = document.getElementById("best");
  var overlay = document.getElementById("overlay");
  var overTitle = document.getElementById("overTitle");
  var overSub = document.getElementById("overSub");
  var startBtn = document.getElementById("startBtn");
  if (!canvas) return;

  var N = 17;                 // grid cells per side
  var DPR = Math.min(2, window.devicePixelRatio || 1);
  var px = 500;               // logical size
  function fit() {
    var rect = canvas.getBoundingClientRect();
    px = Math.round(rect.width);
    canvas.width = px * DPR; canvas.height = px * DPR;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }

  var cell, snake, dir, nextDir, food, score, best, speed, running, dead, loopTO;
  best = parseInt(localStorage.getItem("snake:best") || "0", 10) || 0;
  bestEl.textContent = best;

  function reset() {
    cell = px / N;
    snake = [{ x: 8, y: 8 }, { x: 7, y: 8 }, { x: 6, y: 8 }];
    dir = { x: 1, y: 0 }; nextDir = dir;
    score = 0; speed = 150; dead = false; running = false;
    placeFood();
    scoreEl.textContent = "0";
    draw();
  }

  function placeFood() {
    do {
      food = { x: Math.floor(Math.random() * N), y: Math.floor(Math.random() * N) };
    } while (snake.some(function (s) { return s.x === food.x && s.y === food.y; }));
  }

  function start() {
    if (running) return;
    reset();
    running = true;
    overlay.classList.add("hide");
    tick();
  }

  function gameOver() {
    running = false; dead = true;
    if (score > best) { best = score; localStorage.setItem("snake:best", String(best)); bestEl.textContent = best; }
    overTitle.textContent = "Game over";
    overSub.textContent = "Score " + score + (score >= best && score > 0 ? " · new best!" : "");
    startBtn.textContent = "Play again";
    overlay.classList.remove("hide");
  }

  function tick() {
    if (!running) return;
    step();
    draw();
    loopTO = setTimeout(tick, speed);
  }

  function step() {
    dir = nextDir;
    var head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };
    if (head.x < 0 || head.y < 0 || head.x >= N || head.y >= N) return gameOver();
    if (snake.some(function (s) { return s.x === head.x && s.y === head.y; })) return gameOver();
    snake.unshift(head);
    if (head.x === food.x && head.y === food.y) {
      score++; scoreEl.textContent = score;
      if (speed > 70) speed -= 4;
      placeFood();
    } else {
      snake.pop();
    }
  }

  function rrect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function draw() {
    ctx.clearRect(0, 0, px, px);
    // faint grid
    ctx.strokeStyle = "rgba(74,222,128,0.06)";
    ctx.lineWidth = 1;
    for (var i = 1; i < N; i++) {
      ctx.beginPath(); ctx.moveTo(i * cell, 0); ctx.lineTo(i * cell, px); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i * cell); ctx.lineTo(px, i * cell); ctx.stroke();
    }
    // food — a glowing apple with a highlight, gently pulsing
    var fx = food.x * cell + cell / 2, fy = food.y * cell + cell / 2;
    var pulse = 1 + 0.08 * Math.sin(Date.now() / 220);
    ctx.save();
    ctx.shadowColor = "rgba(251,113,133,0.95)"; ctx.shadowBlur = 18;
    ctx.fillStyle = "#fb7185";
    ctx.beginPath(); ctx.arc(fx, fy, cell * 0.3 * pulse, 0, 6.2832); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(255,255,255,0.65)";
    ctx.beginPath(); ctx.arc(fx - cell * 0.08, fy - cell * 0.09, cell * 0.07, 0, 6.2832); ctx.fill();
    ctx.restore();

    // snake
    for (var s = snake.length - 1; s >= 0; s--) {
      var seg = snake[s];
      var t = 1 - s / snake.length;
      ctx.save();
      ctx.shadowColor = "rgba(74,222,128,0.7)"; ctx.shadowBlur = s === 0 ? 18 : 8;
      ctx.fillStyle = s === 0 ? "#d7ffe6" : "rgba(74,222,128," + (0.5 + t * 0.5).toFixed(2) + ")";
      var g = cell * (s === 0 ? 0.08 : 0.12);
      rrect(seg.x * cell + g, seg.y * cell + g, cell - g * 2, cell - g * 2, (cell - g * 2) * 0.34);
      ctx.fill();
      ctx.restore();
      // eyes on the head, facing the travel direction
      if (s === 0) {
        var ex = seg.x * cell + cell / 2, ey = seg.y * cell + cell / 2;
        var fwd = cell * 0.16, side = cell * 0.16;
        var perpx = -dir.y, perpy = dir.x;
        ctx.fillStyle = "#0a2e16";
        for (var e = -1; e <= 1; e += 2) {
          var exx = ex + dir.x * fwd + perpx * side * e;
          var eyy = ey + dir.y * fwd + perpy * side * e;
          ctx.beginPath(); ctx.arc(exx, eyy, cell * 0.075, 0, 6.2832); ctx.fill();
        }
      }
    }
  }

  function turn(d) {
    var map = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
    var nd = map[d]; if (!nd) return;
    if (nd.x === -dir.x && nd.y === -dir.y) return; // no reverse
    nextDir = nd;
    if (!running && !dead) start();
  }

  // ---- input ----
  window.addEventListener("keydown", function (e) {
    var k = e.key.toLowerCase();
    var m = { arrowup: "up", w: "up", arrowdown: "down", s: "down", arrowleft: "left", a: "left", arrowright: "right", d: "right" };
    if (m[k]) { e.preventDefault(); turn(m[k]); }
    else if (k === "p") { if (running) { running = false; clearTimeout(loopTO); overTitle.textContent = "Paused"; overSub.textContent = "Press P or Play"; startBtn.textContent = "Resume"; overlay.classList.remove("hide"); } else if (!dead) { running = true; overlay.classList.add("hide"); tick(); } }
    else if ((k === " " || k === "enter") && !running) start();
  });
  document.querySelectorAll(".pad__btn").forEach(function (b) {
    b.addEventListener("click", function () { turn(b.dataset.dir); });
  });
  startBtn.addEventListener("click", function () {
    if (!running && !dead && overTitle.textContent === "Paused") { running = true; overlay.classList.add("hide"); tick(); }
    else start();
  });

  // swipe
  var sx = 0, sy = 0;
  canvas.addEventListener("pointerdown", function (e) { sx = e.clientX; sy = e.clientY; });
  canvas.addEventListener("pointerup", function (e) {
    var dx = e.clientX - sx, dy = e.clientY - sy;
    if (Math.abs(dx) < 18 && Math.abs(dy) < 18) { if (!running && !dead) start(); return; }
    if (Math.abs(dx) > Math.abs(dy)) turn(dx > 0 ? "right" : "left");
    else turn(dy > 0 ? "down" : "up");
  });

  window.addEventListener("resize", function () { fit(); cell = px / N; draw(); });

  fit();
  reset();
})();
