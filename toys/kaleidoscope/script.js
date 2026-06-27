(function () {
  "use strict";

  var canvas = document.getElementById("canvas");
  var ctx = canvas.getContext("2d");

  // Offscreen "object cell" — the moving shards live here; the kaleidoscope
  // reflects a wedge of it around the centre.
  var src = document.createElement("canvas");
  var sctx = src.getContext("2d");

  var W, H, CX, CY, R, S;
  var SLICES = 12;                 // even → clean dihedral (mirror) symmetry
  var SEG = (Math.PI * 2) / SLICES;

  function resize() {
    W = canvas.width = window.innerWidth;
    H = canvas.height = window.innerHeight;
    CX = W / 2; CY = H / 2;
    R = Math.min(W, H) * 0.54;     // radius of the scope disc
    S = Math.ceil(R * 2);          // square object-cell
    src.width = S; src.height = S;
  }
  resize();
  window.addEventListener("resize", resize);

  // ---- shards -------------------------------------------------------------
  // Jewel hues kept saturated & luminous; "lighter" blending mixes overlaps
  // into fresh colours the way real glass chips do.
  var HUES = [276, 318, 200, 168, 44, 14, 250, 130];
  var shards = [];

  function rand(a, b) { return a + Math.random() * (b - a); }

  function makeShard(sx, sy, hue) {
    var sides = (Math.random() < 0.5) ? 3 : (Math.random() < 0.5 ? 4 : 6);
    return {
      x: sx, y: sy,
      vx: rand(-0.25, 0.25), vy: rand(-0.25, 0.25),
      r: rand(S * 0.05, S * 0.13),
      hue: hue,
      sides: sides,
      rot: rand(0, Math.PI * 2),
      spin: rand(-0.012, 0.012),
      squish: rand(0.6, 1)
    };
  }

  function seed() {
    shards.length = 0;
    var cx = S / 2, cy = S / 2;
    var n = 16;
    for (var i = 0; i < n; i++) {
      var ang = (i / n) * Math.PI * 2 + rand(-0.5, 0.5);
      // spread across the whole radius → concentric rings of colour in the reflection
      var dist = rand(S * 0.05, S * 0.42);
      shards.push(makeShard(cx + Math.cos(ang) * dist, cy + Math.sin(ang) * dist, HUES[i % HUES.length]));
    }
  }
  seed();

  // ---- interaction --------------------------------------------------------
  // screen → object-cell coordinates
  function toCell(px, py) { return { x: px - CX + S / 2, y: py - CY + S / 2 }; }

  var ptr = { down: false, x: 0, y: 0, px: 0, py: 0, moved: 0, t0: 0 };

  function stir(cx, cy, dx, dy, strength) {
    for (var i = 0; i < shards.length; i++) {
      var s = shards[i];
      var d = Math.hypot(s.x - cx, s.y - cy);
      var reach = S * 0.34;
      if (d < reach) {
        var f = (1 - d / reach) * strength;
        s.vx += dx * f; s.vy += dy * f;
        s.spin += (dx * (s.y - cy) - dy * (s.x - cx)) * 0.00002 * f;
      }
    }
  }

  function onDown(px, py) {
    ptr.down = true; ptr.moved = 0; ptr.t0 = nowish;
    ptr.x = px; ptr.y = py; ptr.px = px; ptr.py = py;
  }
  function onMove(px, py) {
    var dx = px - ptr.x, dy = py - ptr.y;
    ptr.px = ptr.x; ptr.py = ptr.y; ptr.x = px; ptr.y = py;
    var c = toCell(px, py);
    if (ptr.down) {
      ptr.moved += Math.hypot(dx, dy);
      stir(c.x, c.y, dx * 0.05, dy * 0.05, 1.0);
    } else {
      stir(c.x, c.y, dx * 0.018, dy * 0.018, 0.5);   // gentle hover-swirl (desktop)
    }
  }
  function onUp() {
    // A tap is defined purely by not dragging — no time limit (a deliberate,
    // slightly-held click is still a tap and must drop a gem).
    if (ptr.down && ptr.moved < 12) {
      var c = toCell(ptr.x, ptr.y);
      // clamp the drop inside the cell so it always reflects into view
      var dcx = c.x - S / 2, dcy = c.y - S / 2, dd = Math.hypot(dcx, dcy), cap = S * 0.42;
      if (dd > cap) { c.x = S / 2 + dcx / dd * cap; c.y = S / 2 + dcy / dd * cap; }
      var fresh = makeShard(c.x, c.y, HUES[(Math.random() * HUES.length) | 0]);
      fresh.r *= 1.18;                 // a touch bigger so a new gem reads as "it landed"
      shards.push(fresh);
      if (shards.length > 26) shards.splice(0, shards.length - 26);
    }
    ptr.down = false;
  }

  canvas.addEventListener("mousedown", function (e) { onDown(e.clientX, e.clientY); });
  window.addEventListener("mousemove", function (e) { onMove(e.clientX, e.clientY); });
  window.addEventListener("mouseup", onUp);
  canvas.addEventListener("touchstart", function (e) { e.preventDefault(); var t = e.touches[0]; onDown(t.clientX, t.clientY); }, { passive: false });
  canvas.addEventListener("touchmove", function (e) { e.preventDefault(); var t = e.touches[0]; onMove(t.clientX, t.clientY); }, { passive: false });
  canvas.addEventListener("touchend", function (e) { e.preventDefault(); onUp(); }, { passive: false });
  canvas.addEventListener("touchcancel", onUp);

  // ---- physics ------------------------------------------------------------
  function step(dt) {
    var f = dt * 60;
    var cx = S / 2, cy = S / 2, bound = S * 0.46;
    for (var i = 0; i < shards.length; i++) {
      var s = shards[i];
      s.x += s.vx * f; s.y += s.vy * f;
      s.rot += s.spin * f;
      s.vx *= 0.992; s.vy *= 0.992; s.spin *= 0.99;
      // gentle perpetual drift so it never goes fully static
      s.vx += Math.cos(s.rot * 0.7) * 0.0016 * f;
      s.vy += Math.sin(s.rot * 0.7) * 0.0016 * f;
      // soft circular containment
      var dx = s.x - cx, dy = s.y - cy, d = Math.hypot(dx, dy);
      if (d > bound) {
        var nx = dx / d, ny = dy / d;
        s.x = cx + nx * bound; s.y = cy + ny * bound;
        var dot = s.vx * nx + s.vy * ny;
        s.vx -= 2 * dot * nx * 0.9; s.vy -= 2 * dot * ny * 0.9;
      }
      // cap speed
      var sp = Math.hypot(s.vx, s.vy), mx = S * 0.012;
      if (sp > mx) { s.vx = s.vx / sp * mx; s.vy = s.vy / sp * mx; }
    }
  }

  // ---- draw the object cell ----------------------------------------------
  function drawShard(s) {
    sctx.save();
    sctx.translate(s.x, s.y);
    sctx.rotate(s.rot);
    sctx.scale(1, s.squish);

    // soft outer bloom (restrained so each gem keeps its own colour)
    var g = sctx.createRadialGradient(0, 0, 0, 0, 0, s.r * 1.35);
    g.addColorStop(0, "hsla(" + s.hue + ",95%,62%,0.34)");
    g.addColorStop(0.55, "hsla(" + s.hue + ",92%,52%,0.13)");
    g.addColorStop(1, "hsla(" + s.hue + ",90%,50%,0)");
    sctx.fillStyle = g;
    sctx.beginPath();
    sctx.arc(0, 0, s.r * 1.35, 0, Math.PI * 2);
    sctx.fill();

    // faceted gem body
    sctx.beginPath();
    for (var k = 0; k < s.sides; k++) {
      var a = (k / s.sides) * Math.PI * 2;
      var px = Math.cos(a) * s.r, py = Math.sin(a) * s.r;
      if (k === 0) sctx.moveTo(px, py); else sctx.lineTo(px, py);
    }
    sctx.closePath();
    var gb = sctx.createLinearGradient(-s.r, -s.r, s.r, s.r);
    gb.addColorStop(0, "hsla(" + s.hue + ",94%,58%,0.78)");
    gb.addColorStop(1, "hsla(" + ((s.hue + 28) % 360) + ",92%,40%,0.66)");
    sctx.fillStyle = gb;
    sctx.fill();

    // facet core + small specular (kept dim so overlaps mix instead of blowing white)
    sctx.beginPath();
    sctx.arc(0, 0, s.r * 0.3, 0, Math.PI * 2);
    sctx.fillStyle = "hsla(" + s.hue + ",100%,72%,0.5)";
    sctx.fill();
    sctx.beginPath();
    sctx.arc(-s.r * 0.24, -s.r * 0.24, s.r * 0.12, 0, Math.PI * 2);
    sctx.fillStyle = "rgba(255,255,255,0.5)";
    sctx.fill();

    sctx.restore();
  }

  function drawCell() {
    // trailing fade gives silky, dreamy motion
    sctx.globalCompositeOperation = "source-over";
    sctx.fillStyle = "rgba(8,5,22,0.22)";
    sctx.fillRect(0, 0, S, S);
    sctx.globalCompositeOperation = "lighter";
    for (var i = 0; i < shards.length; i++) drawShard(shards[i]);
    sctx.globalCompositeOperation = "source-over";
  }

  // ---- compose the kaleidoscope ------------------------------------------
  function drawScope() {
    // deep background + vignette
    ctx.fillStyle = "#07061a";
    ctx.fillRect(0, 0, W, H);
    var bgg = ctx.createRadialGradient(CX, CY, R * 0.2, CX, CY, Math.max(W, H) * 0.72);
    bgg.addColorStop(0, "rgba(26,16,52,0.55)");
    bgg.addColorStop(0.5, "rgba(12,8,30,0.35)");
    bgg.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = bgg;
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    // clip to the scope disc
    ctx.beginPath();
    ctx.arc(CX, CY, R, 0, Math.PI * 2);
    ctx.clip();

    for (var k = 0; k < SLICES; k++) {
      ctx.save();
      ctx.translate(CX, CY);
      if (k % 2 === 0) ctx.rotate(k * SEG);
      else { ctx.rotate((k + 1) * SEG); ctx.scale(1, -1); }
      // wedge clip [0, SEG]
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, R + 2, 0, SEG);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(src, -S / 2, -S / 2);
      ctx.restore();
    }
    ctx.restore();

    // central bright core
    ctx.globalCompositeOperation = "lighter";
    var cg = ctx.createRadialGradient(CX, CY, 0, CX, CY, R * 0.16);
    cg.addColorStop(0, "rgba(255,255,255,0.5)");
    cg.addColorStop(0.5, "rgba(220,210,255,0.14)");
    cg.addColorStop(1, "rgba(180,160,255,0)");
    ctx.fillStyle = cg;
    ctx.beginPath();
    ctx.arc(CX, CY, R * 0.16, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = "source-over";

    // glass bezel: inner shade ring + bright rim + outer glow
    var bez = ctx.createRadialGradient(CX, CY, R * 0.82, CX, CY, R);
    bez.addColorStop(0, "rgba(0,0,0,0)");
    bez.addColorStop(0.86, "rgba(8,5,20,0.18)");
    bez.addColorStop(1, "rgba(4,2,12,0.6)");
    ctx.fillStyle = bez;
    ctx.beginPath();
    ctx.arc(CX, CY, R, 0, Math.PI * 2);
    ctx.fill();

    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(200,180,255,0.35)";
    ctx.beginPath();
    ctx.arc(CX, CY, R - 1, 0, Math.PI * 2);
    ctx.stroke();

    ctx.globalCompositeOperation = "lighter";
    ctx.lineWidth = 10;
    ctx.strokeStyle = "rgba(120,90,220,0.10)";
    ctx.beginPath();
    ctx.arc(CX, CY, R + 3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalCompositeOperation = "source-over";
  }

  // ---- loop ---------------------------------------------------------------
  var lastTs = null, nowish = 0;
  function render(ts) {
    var dt = lastTs !== null ? Math.min((ts - lastTs) / 1000, 0.05) : 0.016;
    lastTs = ts; nowish += dt;
    step(dt);
    drawCell();
    drawScope();
    requestAnimationFrame(render);
  }
  requestAnimationFrame(render);
})();
