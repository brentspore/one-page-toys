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

  // Arc state
  var N = 7;
  var arcs = [];
  for (var i = 0; i < N; i++) {
    arcs.push({
      isTouch: i === 0,
      angle: (i / N) * Math.PI * 2 + (Math.random() - 0.5) * 0.3,
      angleVel: (Math.random() - 0.5) * 0.007,
      // 3 waypoints: {t (fractional position), p (perp offset), v (velocity)}
      wp: [
        { t: 0.24, p: 0, v: (Math.random() - 0.5) * 0.5 },
        { t: 0.52, p: 0, v: (Math.random() - 0.5) * 0.7 },
        { t: 0.76, p: 0, v: (Math.random() - 0.5) * 0.5 },
      ],
      // Branch from wp[1]
      bOff: (Math.random() - 0.5) * 1.1,   // angle offset from arc direction
      bLen: 0.22 + Math.random() * 0.18,    // length as fraction of CR
      bMidP: 0,
      bMidV: (Math.random() - 0.5) * 0.4,
      midColor: MID_COLORS[i],
      energy: 0.75 + Math.random() * 0.25,
      touchBoost: 0,
    });
  }

  function updateArcs(dt) {
    var f = dt * 60;
    var mx = CR * 0.32;
    for (var i = 0; i < N; i++) {
      var a = arcs[i];
      var isTch = a.isTouch && mIn;

      if (isTch) {
        var tAngle = Math.atan2(mY - CY, mX - CX);
        var da = tAngle - a.angle;
        while (da > Math.PI) da -= Math.PI * 2;
        while (da < -Math.PI) da += Math.PI * 2;
        a.angle += da * Math.min(0.16 * f, 0.9);
        // Arc straightens toward finger
        for (var j = 0; j < a.wp.length; j++) a.wp[j].p *= Math.pow(0.80, f);
        a.touchBoost = Math.min(0.55, a.touchBoost + 0.07 * f);
        a.energy = 0.85 + Math.random() * 0.15;
      } else {
        a.angle += a.angleVel * f + (Math.random() - 0.5) * 0.004 * f;
        a.touchBoost = Math.max(0, a.touchBoost - 0.05 * f);
        a.energy = 0.68 + Math.random() * 0.40;
      }

      // Jitter waypoints
      for (var k = 0; k < a.wp.length; k++) {
        var wp = a.wp[k];
        wp.v += (Math.random() - 0.5) * 0.28 * f;
        wp.v *= Math.pow(0.86, f);
        wp.p += wp.v * f;
        if (wp.p > mx) { wp.p = mx; wp.v = -Math.abs(wp.v) * 0.4; }
        if (wp.p < -mx) { wp.p = -mx; wp.v = Math.abs(wp.v) * 0.4; }
      }

      // Jitter branch midpoint
      a.bMidV += (Math.random() - 0.5) * 0.24 * f;
      a.bMidV *= Math.pow(0.83, f);
      a.bMidP += a.bMidV * f;
      a.bMidP = Math.max(-CR * 0.22, Math.min(CR * 0.22, a.bMidP));
    }
  }

  // Returns arc point array from electrode center to sphere surface
  function getArcPts(a) {
    var ex = CX + Math.cos(a.angle) * CR * 0.95;
    var ey = CY + Math.sin(a.angle) * CR * 0.95;
    var dx = ex - CX, dy = ey - CY;
    var len = Math.hypot(dx, dy);
    var nx = -dy / len, ny = dx / len; // unit perpendicular

    var pts = [{ x: CX, y: CY }];
    for (var j = 0; j < a.wp.length; j++) {
      var wp = a.wp[j];
      pts.push({ x: CX + dx * wp.t + nx * wp.p, y: CY + dy * wp.t + ny * wp.p });
    }
    pts.push({ x: ex, y: ey });
    return pts;
  }

  // Branch from the mid-arc waypoint (pts[2])
  function getBranchPts(a, pts) {
    var s = pts[2];
    var bAngle = a.angle + a.bOff;
    var bLen = CR * a.bLen;
    var ex = s.x + Math.cos(bAngle) * bLen;
    var ey = s.y + Math.sin(bAngle) * bLen;
    var dx = ex - s.x, dy = ey - s.y;
    var len = Math.hypot(dx, dy) || 1;
    var nx = -dy / len, ny = dx / len;
    return [
      s,
      { x: s.x + dx * 0.52 + nx * a.bMidP, y: s.y + dy * 0.52 + ny * a.bMidP },
      { x: ex, y: ey },
    ];
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
      var e = a.energy + a.touchBoost;
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
