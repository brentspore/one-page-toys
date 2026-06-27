(function () {
  "use strict";

  var canvas = document.getElementById("canvas");
  var ctx = canvas.getContext("2d");

  var W, H, MR, PR, leftX, rightX, floorY, pegTop, dropY, binTop;
  var pegs = [], dividers = [], spacingX = 40;
  var marbles = [];
  var MAX = 170;

  var G = 2300;                 // gravity px/s²
  var HUES = [350, 28, 48, 140, 190, 215, 268, 312];

  function build() {
    W = canvas.width = window.innerWidth;
    H = canvas.height = window.innerHeight;
    MR = Math.max(9, Math.min(15, W * 0.012));
    PR = MR * 0.5;
    var margin = Math.max(26, W * 0.06);
    leftX = margin; rightX = W - margin;
    floorY = H - Math.max(30, H * 0.05);
    pegTop = H * 0.2;
    dropY = pegTop - MR * 2.5;

    // peg grid (offset rows = plinko triangle)
    pegs.length = 0;
    var usable = rightX - leftX;
    var cols = Math.max(5, Math.floor(usable / (MR * 3.4)));
    spacingX = usable / cols;
    var spacingY = MR * 2.9;
    var pegBottom = H * 0.62;
    var rows = Math.max(5, Math.floor((pegBottom - pegTop) / spacingY));
    for (var r = 0; r < rows; r++) {
      var y = pegTop + r * spacingY;
      var off = (r % 2) ? spacingX / 2 : 0;
      for (var c = 0; c <= cols; c++) {
        var x = leftX + off + c * spacingX;
        if (x > leftX + 2 && x < rightX - 2) pegs.push({ x: x, y: y });
      }
    }

    // bin dividers below the pegs
    dividers.length = 0;
    binTop = pegBottom + spacingY * 0.4;
    for (var i = 0; i <= cols; i++) {
      var dx = leftX + i * spacingX;
      if (dx > leftX + 1 && dx < rightX - 1) dividers.push(dx);
    }
  }
  build();
  window.addEventListener("resize", function () { build(); });

  function makeMarble(x) {
    return {
      x: Math.max(leftX + MR, Math.min(rightX - MR, x)),
      y: dropY, vx: (Math.random() - 0.5) * 30, vy: 0,
      r: MR * (0.92 + Math.random() * 0.16),
      hue: HUES[(Math.random() * HUES.length) | 0]
    };
  }
  function drop(x) {
    marbles.push(makeMarble(x));
    if (marbles.length > MAX) marbles.splice(0, marbles.length - MAX);
  }

  // ---- audio (glass clack) ------------------------------------------------
  var actx = null, lastClack = 0;
  function unlock() {
    if (actx) return;
    try {
      actx = new (window.AudioContext || window.webkitAudioContext)();
      var b = actx.createBuffer(1, 1, 22050);
      var s = actx.createBufferSource(); s.buffer = b; s.connect(actx.destination); s.start(0);
    } catch (e) { actx = null; }
  }
  function clack(vol) {
    if (!actx) return;
    var t = actx.currentTime;
    if (t - lastClack < 0.012) return;
    lastClack = t;
    vol = Math.max(0.02, Math.min(0.13, vol));
    var o = actx.createOscillator(), g = actx.createGain(), bp = actx.createBiquadFilter();
    bp.type = "bandpass"; bp.frequency.value = 1500 + Math.random() * 1400; bp.Q.value = 4;
    o.type = "triangle";
    o.frequency.value = 900 + Math.random() * 900;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    o.connect(bp); bp.connect(g); g.connect(actx.destination);
    o.start(t); o.stop(t + 0.09);
  }

  // ---- physics ------------------------------------------------------------
  function resolveStatic(m, px, py, minD, e, nudge) {
    var dx = m.x - px, dy = m.y - py, d2 = dx * dx + dy * dy;
    if (d2 >= minD * minD || d2 === 0) return;
    var d = Math.sqrt(d2), nx = dx / d, ny = dy / d, overlap = minD - d;
    m.x += nx * overlap; m.y += ny * overlap;
    var vn = m.vx * nx + m.vy * ny;
    if (vn < 0) {
      m.vx -= (1 + e) * vn * nx; m.vy -= (1 + e) * vn * ny;
      if (-vn > 230) clack(-vn / 1400);
    }
    // a marble balanced on top of a peg/cap must roll off, never rest there
    if (nudge && ny < -0.5 && Math.abs(m.vx) < 55) {
      var side = nx > 0.02 ? 1 : nx < -0.02 ? -1 : (((px + py) | 0) % 2 ? 1 : -1);
      // near a side rail, always roll toward open center — never into the wall
      // (rolling into the wall is exactly what pins marbles in the corners)
      if (m.x < leftX + m.r * 2.5) side = 1;
      else if (m.x > rightX - m.r * 2.5) side = -1;
      m.vx += side * 70;
    }
  }

  function step(dt) {
    var sub = 2, h = dt / sub, i, j, m;
    for (var s = 0; s < sub; s++) {
      // integrate
      for (i = 0; i < marbles.length; i++) {
        m = marbles[i];
        m.vy += G * h;
        m.x += m.vx * h; m.y += m.vy * h;
        m.vx *= 0.999;
      }
      // pegs
      for (i = 0; i < marbles.length; i++) {
        m = marbles[i];
        for (j = 0; j < pegs.length; j++) {
          var p = pegs[j];
          if (Math.abs(p.y - m.y) < m.r + PR && Math.abs(p.x - m.x) < m.r + PR)
            resolveStatic(m, p.x, p.y, m.r + PR, 0.5, true);
        }
      }
      // bin dividers (vertical walls with a rounded top cap)
      for (i = 0; i < marbles.length; i++) {
        m = marbles[i];
        for (j = 0; j < dividers.length; j++) {
          var dvx = dividers[j];
          resolveStatic(m, dvx, binTop, m.r + PR, 0.4, true); // rounded top
          if (m.y > binTop && Math.abs(m.x - dvx) < m.r) {     // wall body
            var sgn = m.x >= dvx ? 1 : -1;
            m.x = dvx + sgn * m.r;
            if (sgn * m.vx < 0) m.vx = -m.vx * 0.32;
          }
        }
      }
      // walls + floor
      for (i = 0; i < marbles.length; i++) {
        m = marbles[i];
        if (m.x < leftX + m.r) { m.x = leftX + m.r; if (m.vx < 0) m.vx = -m.vx * 0.4; }
        if (m.x > rightX - m.r) { m.x = rightX - m.r; if (m.vx > 0) m.vx = -m.vx * 0.4; }
        if (m.y > floorY - m.r) { m.y = floorY - m.r; if (m.vy > 0) m.vy = -m.vy * 0.28; m.vx *= 0.86; }
      }
      // marble vs marble (a couple relaxation passes for stable piling)
      for (var it = 0; it < 2; it++) {
        for (i = 0; i < marbles.length; i++) {
          var a = marbles[i];
          for (j = i + 1; j < marbles.length; j++) {
            var b = marbles[j];
            var dx = b.x - a.x; if (dx > a.r + b.r || dx < -(a.r + b.r)) continue;
            var dy = b.y - a.y, d2 = dx * dx + dy * dy, rr = a.r + b.r;
            if (d2 >= rr * rr || d2 === 0) continue;
            var d = Math.sqrt(d2), nx = dx / d, ny = dy / d, overlap = (rr - d) * 0.5;
            a.x -= nx * overlap; a.y -= ny * overlap;
            b.x += nx * overlap; b.y += ny * overlap;
            var rvx = b.vx - a.vx, rvy = b.vy - a.vy, vn = rvx * nx + rvy * ny;
            if (vn < 0) {
              var jimp = -(1.18) * vn / 2;
              var ix = jimp * nx, iy = jimp * ny;
              a.vx -= ix; a.vy -= iy; b.vx += ix; b.vy += iy;
              if (-vn > 220) clack(-vn / 1700);
            }
          }
        }
      }
    }

    // anti-stuck: a marble dawdling in the peg field gets nudged so it never lodges,
    // biased away from the side rails so it can't pin against the walls
    for (i = 0; i < marbles.length; i++) {
      m = marbles[i];
      if (m.y < binTop - m.r && Math.hypot(m.vx, m.vy) < 28) {
        var jit = (Math.random() - 0.5) * 70;
        if (m.x < leftX + m.r * 2.5) jit = Math.abs(jit);
        else if (m.x > rightX - m.r * 2.5) jit = -Math.abs(jit);
        m.vx += jit; m.vy += 25;
      }
    }
  }

  // ---- drawing ------------------------------------------------------------
  function drawBoard() {
    // felt board
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#10202f");
    g.addColorStop(0.55, "#0c1a28");
    g.addColorStop(1, "#091420");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // soft top light
    var tg = ctx.createRadialGradient(W / 2, H * 0.02, 10, W / 2, H * 0.02, H * 0.7);
    tg.addColorStop(0, "rgba(90,140,190,0.16)");
    tg.addColorStop(1, "rgba(90,140,190,0)");
    ctx.fillStyle = tg; ctx.fillRect(0, 0, W, H);
    // vignette
    var vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.7);
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(0,0,0,0.45)");
    ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);

    // side rails
    ctx.fillStyle = "#1a2c3d";
    ctx.fillRect(leftX - 8, pegTop - 30, 6, floorY - pegTop + 30);
    ctx.fillRect(rightX + 2, pegTop - 30, 6, floorY - pegTop + 30);
    // floor
    ctx.fillStyle = "#16273700";
    ctx.fillStyle = "rgba(20,40,58,0.9)";
    ctx.fillRect(leftX - 8, floorY, rightX - leftX + 16, H - floorY);
  }

  function drawDividers() {
    for (var i = 0; i < dividers.length; i++) {
      var dvx = dividers[i];
      var g = ctx.createLinearGradient(dvx - PR, 0, dvx + PR, 0);
      g.addColorStop(0, "#16293a");
      g.addColorStop(0.45, "#2c4860");
      g.addColorStop(0.55, "#33536d");
      g.addColorStop(1, "#16293a");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(dvx - PR, floorY);
      ctx.lineTo(dvx - PR, binTop);
      ctx.arc(dvx, binTop, PR, Math.PI, 0);
      ctx.lineTo(dvx + PR, floorY);
      ctx.closePath();
      ctx.fill();
    }
  }

  function drawPegs() {
    for (var i = 0; i < pegs.length; i++) {
      var p = pegs[i];
      // shadow
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.beginPath(); ctx.arc(p.x + 1, p.y + 1.5, PR, 0, Math.PI * 2); ctx.fill();
      // brass stud
      var g = ctx.createRadialGradient(p.x - PR * 0.4, p.y - PR * 0.4, PR * 0.1, p.x, p.y, PR);
      g.addColorStop(0, "#ffe9ad");
      g.addColorStop(0.45, "#d9aa64");
      g.addColorStop(1, "#7a5524");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(p.x, p.y, PR, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "rgba(255,250,230,0.7)";
      ctx.beginPath(); ctx.arc(p.x - PR * 0.32, p.y - PR * 0.32, PR * 0.26, 0, Math.PI * 2); ctx.fill();
    }
  }

  function drawMarble(m) {
    var r = m.r, h = m.hue;
    // contact shadow
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.beginPath(); ctx.ellipse(m.x + 1.5, m.y + r * 0.55, r * 0.95, r * 0.5, 0, 0, Math.PI * 2); ctx.fill();
    // glass body
    var g = ctx.createRadialGradient(m.x - r * 0.35, m.y - r * 0.4, r * 0.1, m.x, m.y, r);
    g.addColorStop(0, "hsl(" + h + ",90%,82%)");
    g.addColorStop(0.4, "hsl(" + h + ",85%,60%)");
    g.addColorStop(0.82, "hsl(" + h + ",80%,38%)");
    g.addColorStop(1, "hsl(" + h + ",75%,24%)");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(m.x, m.y, r, 0, Math.PI * 2); ctx.fill();
    // inner core glow (glassy)
    var cg = ctx.createRadialGradient(m.x + r * 0.2, m.y + r * 0.25, 0, m.x + r * 0.2, m.y + r * 0.25, r * 0.7);
    cg.addColorStop(0, "hsla(" + h + ",95%,70%,0.5)");
    cg.addColorStop(1, "hsla(" + h + ",90%,60%,0)");
    ctx.fillStyle = cg;
    ctx.beginPath(); ctx.arc(m.x, m.y, r, 0, Math.PI * 2); ctx.fill();
    // bright specular highlight
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.beginPath(); ctx.ellipse(m.x - r * 0.34, m.y - r * 0.38, r * 0.22, r * 0.15, -0.6, 0, Math.PI * 2); ctx.fill();
    // rim reflection
    ctx.strokeStyle = "rgba(255,255,255,0.18)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(m.x, m.y, r - 0.6, 0, Math.PI * 2); ctx.stroke();
  }

  // ---- interaction --------------------------------------------------------
  var hoverX = W / 2, hovering = false;
  function pointerDrop(px, py) { unlock(); drop(px); }
  canvas.addEventListener("mousedown", function (e) { pointerDrop(e.clientX, e.clientY); });
  canvas.addEventListener("mousemove", function (e) { hoverX = e.clientX; hovering = true; });
  canvas.addEventListener("mouseleave", function () { hovering = false; });
  canvas.addEventListener("touchstart", function (e) { e.preventDefault(); var t = e.touches[0]; pointerDrop(t.clientX, t.clientY); }, { passive: false });

  document.getElementById("clearBtn").addEventListener("click", function () { marbles.length = 0; });

  // auto-run: keep dropping marbles by itself (a self-running simulation)
  var auto = false, autoTimer = 0;
  var autoBtn = document.getElementById("autoBtn");
  autoBtn.addEventListener("click", function () {
    auto = !auto;
    autoBtn.classList.toggle("active", auto);
    autoBtn.textContent = auto ? "▮▮ Auto" : "▶ Auto";
    if (auto) { unlock(); autoTimer = 0; }
  });
  function autoTick(dt) {
    if (!auto) return;
    autoTimer -= dt;
    if (autoTimer <= 0) { drop(leftX + MR + Math.random() * (rightX - leftX - 2 * MR)); autoTimer = 0.28; }
  }

  // intro cascade so the board isn't empty
  var seedLeft = 26, seedTimer = 0.4;
  function seedTick(dt) {
    if (seedLeft <= 0) return;
    seedTimer -= dt;
    if (seedTimer <= 0) { drop(leftX + MR + Math.random() * (rightX - leftX - 2 * MR)); seedLeft--; seedTimer = 0.16; }
  }

  // ---- loop ---------------------------------------------------------------
  function drawDropGuide() {
    if (!hovering) return;
    var x = Math.max(leftX + MR, Math.min(rightX - MR, hoverX));
    ctx.strokeStyle = "rgba(170,205,235,0.25)"; ctx.lineWidth = 1; ctx.setLineDash([3, 6]);
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, pegTop - MR); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(170,205,235,0.5)";
    ctx.beginPath(); ctx.arc(x, dropY, MR * 0.5, 0, Math.PI * 2); ctx.fill();
  }

  var lastTs = null;
  function render(ts) {
    var dt = lastTs !== null ? Math.min((ts - lastTs) / 1000, 0.033) : 0.016;
    lastTs = ts;
    seedTick(dt);
    autoTick(dt);
    step(dt);
    drawBoard();
    drawPegs();
    drawDividers();
    drawDropGuide();
    for (var i = 0; i < marbles.length; i++) drawMarble(marbles[i]);
    requestAnimationFrame(render);
  }
  requestAnimationFrame(render);
})();
