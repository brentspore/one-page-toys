(function () {
  "use strict";

  var canvas = document.getElementById("canvas");
  var ctx = canvas.getContext("2d");

  var W, H, CR, CX, CY;

  function resize() {
    W = canvas.width = window.innerWidth;
    H = canvas.height = window.innerHeight;
    CR = Math.min(W * 0.42, H * 0.40, 310);
    CX = W / 2;
    CY = H / 2 - CR * 0.05;
  }
  resize();
  window.addEventListener("resize", resize);

  // Pointer tracking
  var mX = null, mY = null, mIn = false;
  function setPtr(px, py) {
    mX = px; mY = py;
    mIn = Math.hypot(px - CX, py - CY) < CR * 0.97;
  }
  function clearPtr() { mIn = false; }

  canvas.addEventListener("mousemove", function (e) {
    var r = canvas.getBoundingClientRect();
    setPtr(e.clientX - r.left, e.clientY - r.top);
  });
  canvas.addEventListener("mouseleave", clearPtr);
  canvas.addEventListener("touchstart", function (e) {
    e.preventDefault();
    var r = canvas.getBoundingClientRect();
    setPtr(e.touches[0].clientX - r.left, e.touches[0].clientY - r.top);
  }, { passive: false });
  canvas.addEventListener("touchmove", function (e) {
    e.preventDefault();
    var r = canvas.getBoundingClientRect();
    setPtr(e.touches[0].clientX - r.left, e.touches[0].clientY - r.top);
  }, { passive: false });
  canvas.addEventListener("touchend", clearPtr);
  canvas.addEventListener("touchcancel", clearPtr);

  // Mid-glow color per arc (blue → cyan → violet spectrum)
  var MID_COLORS = [
    "rgba(100,180,255,0.30)",   // cornflower blue
    "rgba(80,205,255,0.30)",    // cyan
    "rgba(145,130,255,0.30)",   // blue-violet
    "rgba(170,110,255,0.30)",   // violet
    "rgba(110,175,255,0.30)",   // sky blue
    "rgba(140,145,255,0.30)",   // periwinkle
    "rgba(88,200,255,0.30)",    // light cyan
  ];

  // Arc state — each filament holds an angle that re-strikes (jumps) at random
  // intervals; the jagged path is regenerated every frame so it crackles.
  var N = 8;
  var arcs = [];
  for (var i = 0; i < N; i++) {
    arcs.push({
      isTouch: i === 0,
      angle: (i / N) * Math.PI * 2,
      restrikeIn: Math.random() * 0.6,
      midColor: MID_COLORS[i % MID_COLORS.length],
      energy: 0.85,
      flick: 1
    });
  }

  function updateArcs(dt) {
    var f = dt * 60;
    for (var i = 0; i < N; i++) {
      var a = arcs[i];
      a.restrikeIn -= dt;
      if (a.isTouch && mIn) {
        // track the finger tightly (no slow clock-hand sweep)
        var tAngle = Math.atan2(mY - CY, mX - CX);
        var da = tAngle - a.angle;
        while (da > Math.PI) da -= Math.PI * 2;
        while (da < -Math.PI) da += Math.PI * 2;
        a.angle += da * Math.min(1, 0.55 * f);
        a.energy = 1.05;
      } else {
        if (a.restrikeIn <= 0) {        // re-strike: the filament jumps to a new spot
          a.angle += (Math.random() - 0.5) * 1.5;
          a.restrikeIn = 0.16 + Math.random() * 0.7;
        }
        a.angle += (Math.random() - 0.5) * 0.03 * f;  // subtle crackle wander
        a.energy = 0.8;
      }
      a.flick = 0.7 + Math.random() * 0.45;            // per-frame brightness flicker
    }
  }

  // Fractal lightning via midpoint displacement (regenerated each frame → crackle)
  function bolt(x0, y0, x1, y1, disp, out) {
    if (disp < 3.5) { out.push({ x: x1, y: y1 }); return; }
    var dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy) || 1;
    var mx = (x0 + x1) / 2 + (-dy / L) * (Math.random() - 0.5) * disp;
    var my = (y0 + y1) / 2 + (dx / L) * (Math.random() - 0.5) * disp;
    bolt(x0, y0, mx, my, disp * 0.55, out);
    bolt(mx, my, x1, y1, disp * 0.55, out);
  }
  function makeBolt(x0, y0, x1, y1, disp) {
    var out = [{ x: x0, y: y0 }];
    bolt(x0, y0, x1, y1, disp, out);
    return out;
  }

  // jagged filament from the electrode to the surface (or to the finger when touching)
  function getArcPts(a) {
    var R = CR * 0.97, ex, ey;
    if (a.isTouch && mIn) {
      var d = Math.hypot(mX - CX, mY - CY) || 1, rr = Math.min(d, R);
      ex = CX + (mX - CX) / d * rr; ey = CY + (mY - CY) / d * rr;
    } else {
      ex = CX + Math.cos(a.angle) * R; ey = CY + Math.sin(a.angle) * R;
    }
    return makeBolt(CX, CY, ex, ey, Math.hypot(ex - CX, ey - CY) * 0.16);
  }

  // a shorter jagged branch off the middle of the main filament
  function getBranchPts(a, pts) {
    var s = pts[(pts.length * 0.5) | 0];
    var bAng = Math.atan2(s.y - CY, s.x - CX) + (Math.random() - 0.5) * 1.3;
    var bLen = CR * (0.16 + Math.random() * 0.2);
    var ex = s.x + Math.cos(bAng) * bLen, ey = s.y + Math.sin(bAng) * bLen;
    return makeBolt(s.x, s.y, ex, ey, bLen * 0.5);
  }

  function polyline(pts) {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  }

  function spt(pts, lw, color, alpha) {
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    polyline(pts);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function drawArcs() {
    ctx.save();
    ctx.beginPath();
    ctx.arc(CX, CY, CR * 0.992, 0, Math.PI * 2);
    ctx.clip();
    ctx.globalCompositeOperation = "lighter";

    for (var i = 0; i < N; i++) {
      var a = arcs[i];
      var e = a.energy * a.flick;
      var pts = getArcPts(a);
      var bpts = getBranchPts(a, pts);
      var isTch = a.isTouch && mIn;
      var mc = isTch ? "rgba(180,220,255,0.28)" : a.midColor;

      // Outer bloom
      spt(pts, 32 * e, "rgba(40,60,200,0.055)", 1);
      spt(pts, 18 * e, "rgba(80,120,240,0.090)", 1);
      spt(bpts, 22 * e, "rgba(40,60,200,0.042)", 1);
      spt(bpts, 12 * e, "rgba(80,120,240,0.070)", 1);

      // Mid glow (colored, wider)
      var mc2 = isTch ? "rgba(160,210,255,0.50)" : mc;
      spt(pts, 8.5 * e, mc2, 1);
      spt(bpts, 6.0 * e, mc2, 1);

      // Tight colored band (between mid and core)
      spt(pts, 3.8, "rgba(150,190,255,0.50)", 1);
      spt(bpts, 2.8, "rgba(130,175,255,0.40)", 1);

      // Core (thin, near-white)
      var ca = isTch ? 1.0 : 0.90;
      spt(pts, 2.2, "rgba(230,240,255," + ca + ")", 1);
      spt(bpts, 1.6, "rgba(215,230,255," + (ca * 0.82) + ")", 1);
    }

    ctx.globalCompositeOperation = "source-over";
    ctx.restore();
  }

  function drawElectrode() {
    ctx.save();
    ctx.beginPath();
    ctx.arc(CX, CY, CR * 0.992, 0, Math.PI * 2);
    ctx.clip();
    ctx.globalCompositeOperation = "lighter";

    // Hot glowing orb
    var g1 = ctx.createRadialGradient(CX, CY, 0, CX, CY, CR * 0.10);
    g1.addColorStop(0, "rgba(255,255,255,0.98)");
    g1.addColorStop(0.30, "rgba(200,220,255,0.72)");
    g1.addColorStop(0.65, "rgba(100,145,255,0.30)");
    g1.addColorStop(1, "rgba(60,85,225,0)");
    ctx.fillStyle = g1;
    ctx.beginPath();
    ctx.arc(CX, CY, CR * 0.10, 0, Math.PI * 2);
    ctx.fill();

    // Wider electrode glow
    var g2 = ctx.createRadialGradient(CX, CY, CR * 0.07, CX, CY, CR * 0.28);
    g2.addColorStop(0, "rgba(120,165,255,0.22)");
    g2.addColorStop(1, "rgba(60,85,220,0)");
    ctx.fillStyle = g2;
    ctx.beginPath();
    ctx.arc(CX, CY, CR * 0.28, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalCompositeOperation = "source-over";
    ctx.restore();
  }

  function drawSphereBack() {
    var g = ctx.createRadialGradient(CX, CY, 0, CX, CY, CR);
    g.addColorStop(0, "#0d0820");
    g.addColorStop(0.52, "#080618");
    g.addColorStop(0.88, "#060414");
    g.addColorStop(1, "#040310");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(CX, CY, CR, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawSphereGlass() {
    // Edge darkening (thick glass look)
    var gv = ctx.createRadialGradient(CX, CY, CR * 0.60, CX, CY, CR);
    gv.addColorStop(0, "rgba(8,6,20,0)");
    gv.addColorStop(0.62, "rgba(10,7,22,0.07)");
    gv.addColorStop(0.88, "rgba(20,13,44,0.28)");
    gv.addColorStop(1, "rgba(34,22,65,0.54)");
    ctx.fillStyle = gv;
    ctx.beginPath();
    ctx.arc(CX, CY, CR, 0, Math.PI * 2);
    ctx.fill();

    // Glass rim
    ctx.strokeStyle = "rgba(130,158,218,0.50)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(CX, CY, CR, 0, Math.PI * 2);
    ctx.stroke();

    // Electric outer rim glow
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = "rgba(50,90,215,0.14)";
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.arc(CX, CY, CR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalCompositeOperation = "source-over";

    // Primary specular (top-left, broad)
    var sp1 = ctx.createRadialGradient(
      CX - CR * 0.33, CY - CR * 0.39, 0,
      CX - CR * 0.16, CY - CR * 0.22, CR * 0.55
    );
    sp1.addColorStop(0, "rgba(255,255,255,0.27)");
    sp1.addColorStop(0.26, "rgba(222,234,255,0.10)");
    sp1.addColorStop(1, "rgba(180,205,255,0)");
    ctx.fillStyle = sp1;
    ctx.beginPath();
    ctx.arc(CX, CY, CR, 0, Math.PI * 2);
    ctx.fill();

    // Sharp catch-light dot
    ctx.fillStyle = "rgba(255,255,255,0.60)";
    ctx.beginPath();
    ctx.ellipse(CX - CR * 0.31, CY - CR * 0.40, CR * 0.068, CR * 0.029, -0.55, 0, Math.PI * 2);
    ctx.fill();

    // Secondary dim reflection (bottom-right)
    var sp2 = ctx.createRadialGradient(
      CX + CR * 0.47, CY + CR * 0.53, 0,
      CX + CR * 0.47, CY + CR * 0.53, CR * 0.25
    );
    sp2.addColorStop(0, "rgba(168,194,235,0.14)");
    sp2.addColorStop(1, "rgba(140,172,222,0)");
    ctx.fillStyle = sp2;
    ctx.beginPath();
    ctx.arc(CX, CY, CR, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawAmbientGlow() {
    ctx.globalCompositeOperation = "lighter";
    var g = ctx.createRadialGradient(CX, CY, CR * 0.84, CX, CY, CR * 1.68);
    g.addColorStop(0, "rgba(38,58,180,0.055)");
    g.addColorStop(0.48, "rgba(22,38,145,0.028)");
    g.addColorStop(1, "rgba(8,12,60,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(CX, CY, CR * 1.68, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = "source-over";
  }

  function drawBase() {
    var topY = CY + CR - 2;
    var bh = CR * 0.25;
    var tw = CR * 0.54;
    var bw = CR * 0.60;
    var r = 9;

    // Drop shadow
    var sh = ctx.createRadialGradient(CX, topY + bh + 10, 0, CX, topY + bh + 10, bw * 0.85);
    sh.addColorStop(0, "rgba(0,0,0,0.58)");
    sh.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = sh;
    ctx.beginPath();
    ctx.ellipse(CX, topY + bh + 5, bw * 0.72, 14, 0, 0, Math.PI * 2);
    ctx.fill();

    // Base body (cylindrical shading: dark on sides, lighter in middle)
    var bg = ctx.createLinearGradient(CX - bw / 2, topY, CX + bw / 2, topY);
    bg.addColorStop(0, "#111020");
    bg.addColorStop(0.14, "#252238");
    bg.addColorStop(0.50, "#1a1730");
    bg.addColorStop(0.86, "#252238");
    bg.addColorStop(1, "#111020");
    ctx.fillStyle = bg;

    ctx.beginPath();
    ctx.moveTo(CX - tw / 2, topY);
    ctx.lineTo(CX + tw / 2, topY);
    ctx.lineTo(CX + bw / 2, topY + bh - r);
    ctx.arcTo(CX + bw / 2, topY + bh, CX + bw / 2 - r, topY + bh, r);
    ctx.lineTo(CX - bw / 2 + r, topY + bh);
    ctx.arcTo(CX - bw / 2, topY + bh, CX - bw / 2, topY + bh - r, r);
    ctx.lineTo(CX - bw / 2, topY);
    ctx.closePath();
    ctx.fill();

    // Top rim highlight
    ctx.strokeStyle = "rgba(130,155,215,0.45)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(CX - tw / 2, topY);
    ctx.lineTo(CX + tw / 2, topY);
    ctx.stroke();

    // LED ring glow where sphere meets base
    ctx.globalCompositeOperation = "lighter";
    var lg = ctx.createLinearGradient(CX - tw / 2, topY, CX + tw / 2, topY);
    lg.addColorStop(0, "rgba(30,50,185,0)");
    lg.addColorStop(0.28, "rgba(60,100,228,0.10)");
    lg.addColorStop(0.50, "rgba(90,145,255,0.17)");
    lg.addColorStop(0.72, "rgba(60,100,228,0.10)");
    lg.addColorStop(1, "rgba(30,50,185,0)");
    ctx.strokeStyle = lg;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(CX - tw / 2, topY);
    ctx.lineTo(CX + tw / 2, topY);
    ctx.stroke();
    ctx.globalCompositeOperation = "source-over";
  }

  function drawBackground() {
    ctx.fillStyle = "#04030c";
    ctx.fillRect(0, 0, W, H);
    // Very faint purple haze around sphere
    var g = ctx.createRadialGradient(CX, CY, 0, CX, CY, Math.max(W, H) * 0.65);
    g.addColorStop(0, "rgba(16,10,36,0.55)");
    g.addColorStop(0.45, "rgba(8,6,20,0.28)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  var lastTs = null;

  function render(ts) {
    var dt = lastTs !== null ? Math.min((ts - lastTs) / 1000, 0.05) : 0.016;
    lastTs = ts;

    updateArcs(dt);
    drawBackground();
    drawAmbientGlow();
    drawBase();
    drawSphereBack();
    drawArcs();
    drawElectrode();
    drawSphereGlass();

    requestAnimationFrame(render);
  }

  requestAnimationFrame(render);
})();
