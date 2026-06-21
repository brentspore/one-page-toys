/* Star Click Sky — an immersive cosmos you build by clicking.
 * Twinkling parallax starfield, click bursts, persistent stars that connect into
 * constellations, periodic shooting stars, and a stardust cursor trail.
 */
(function () {
  "use strict";

  var canvas = document.getElementById("sky");
  var ctx = canvas.getContext("2d");
  var counter = document.getElementById("counter");
  var breakBtn = document.getElementById("breakBtn");
  var clearBtn = document.getElementById("clearBtn");
  var hint = document.getElementById("hint");
  if (!canvas) return;

  var reduceMotion =
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var W = 0, H = 0, DPR = Math.min(2, window.devicePixelRatio || 1);
  var ambient = [], groups = [[]], bursts = [], shooters = [], trail = [];
  var placedCount = 0;

  function resize() {
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = W * DPR; canvas.height = H * DPR;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    seedAmbient();
  }
  function seedAmbient() {
    ambient = [];
    var n = Math.min(440, Math.floor((W * H) / 6000));
    for (var i = 0; i < n; i++) {
      ambient.push({
        x: Math.random() * W, y: Math.random() * H,
        r: 0.4 + Math.random() * 1.6,
        a: 0.3 + Math.random() * 0.6,
        ph: Math.random() * Math.PI * 2,
        sp: 0.6 + Math.random() * 1.6,
        vy: 0.02 + Math.random() * 0.06
      });
    }
  }

  function star(x, y) {
    groups[groups.length - 1].push({ x: x, y: y, r: 1.8 + Math.random() * 1.6, ph: Math.random() * 6 });
    placedCount++;
    counter.textContent = placedCount + (placedCount === 1 ? " star" : " stars");
    burst(x, y);
  }

  function burst(x, y) {
    var ps = [];
    var n = reduceMotion ? 6 : 16;
    for (var i = 0; i < n; i++) {
      var a = (i / n) * Math.PI * 2 + Math.random() * 0.4;
      var sp = 1 + Math.random() * 3.4;
      ps.push({ x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1 });
    }
    bursts.push({ x: x, y: y, ring: 0, ps: ps });
  }

  function shooter() {
    var edge = Math.random() < 0.5;
    var x = edge ? -40 : Math.random() * W;
    var y = edge ? Math.random() * H * 0.5 : -40;
    var ang = Math.PI * (0.18 + Math.random() * 0.16);
    var sp = 8 + Math.random() * 6;
    shooters.push({ x: x, y: y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, life: 1 });
  }
  var nextShoot = 1500;

  // ---- loop ----
  var last = 0;
  function frame(ts) {
    var dt = last ? ts - last : 16; last = ts;
    var t = ts / 1000;
    ctx.clearRect(0, 0, W, H);

    // ambient starfield
    ctx.globalCompositeOperation = "lighter";
    for (var i = 0; i < ambient.length; i++) {
      var s = ambient[i];
      if (!reduceMotion) { s.y += s.vy; if (s.y > H + 2) { s.y = -2; s.x = Math.random() * W; } }
      var tw = s.a * (0.45 + 0.55 * Math.sin(t * s.sp + s.ph));
      ctx.fillStyle = "rgba(220,232,255," + tw.toFixed(3) + ")";
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 6.2832); ctx.fill();
    }

    // constellations: lines then stars
    for (var g = 0; g < groups.length; g++) {
      var grp = groups[g];
      if (grp.length > 1) {
        ctx.strokeStyle = "rgba(140,184,255,0.4)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(grp[0].x, grp[0].y);
        for (var k = 1; k < grp.length; k++) ctx.lineTo(grp[k].x, grp[k].y);
        ctx.stroke();
      }
      for (var j = 0; j < grp.length; j++) {
        var p = grp[j];
        var tw2 = 0.7 + 0.3 * Math.sin(t * 2 + p.ph);
        var rad = p.r * (0.9 + 0.2 * Math.sin(t * 2 + p.ph));
        var grd = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, rad * 5);
        grd.addColorStop(0, "rgba(255,255,255," + tw2.toFixed(2) + ")");
        grd.addColorStop(0.3, "rgba(170,200,255,0.5)");
        grd.addColorStop(1, "rgba(120,160,255,0)");
        ctx.fillStyle = grd;
        ctx.beginPath(); ctx.arc(p.x, p.y, rad * 5, 0, 6.2832); ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.beginPath(); ctx.arc(p.x, p.y, rad, 0, 6.2832); ctx.fill();
      }
    }

    // bursts
    for (var b = bursts.length - 1; b >= 0; b--) {
      var bu = bursts[b];
      bu.ring += dt * 0.5;
      var ringR = bu.ring;
      var ringA = Math.max(0, 1 - bu.ring / 70);
      if (ringA > 0) {
        ctx.strokeStyle = "rgba(190,214,255," + (ringA * 0.7).toFixed(3) + ")";
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(bu.x, bu.y, ringR, 0, 6.2832); ctx.stroke();
      }
      var alive = ringA > 0;
      for (var q = 0; q < bu.ps.length; q++) {
        var pp = bu.ps[q];
        pp.x += pp.vx; pp.y += pp.vy; pp.vx *= 0.95; pp.vy *= 0.95; pp.life -= 0.02;
        if (pp.life > 0) {
          alive = true;
          ctx.fillStyle = "rgba(255,250,220," + pp.life.toFixed(2) + ")";
          ctx.beginPath(); ctx.arc(pp.x, pp.y, 1.6 * pp.life + 0.4, 0, 6.2832); ctx.fill();
        }
      }
      if (!alive) bursts.splice(b, 1);
    }

    // shooting stars
    if (!reduceMotion) {
      nextShoot -= dt;
      if (nextShoot <= 0) { shooter(); nextShoot = 2600 + Math.random() * 3800; }
    }
    for (var sh = shooters.length - 1; sh >= 0; sh--) {
      var st = shooters[sh];
      st.x += st.vx; st.y += st.vy; st.life -= 0.012;
      if (st.life <= 0 || st.x > W + 60 || st.y > H + 60) { shooters.splice(sh, 1); continue; }
      var tx = st.x - st.vx * 6, ty = st.y - st.vy * 6;
      var lg = ctx.createLinearGradient(st.x, st.y, tx, ty);
      lg.addColorStop(0, "rgba(255,255,255," + st.life.toFixed(2) + ")");
      lg.addColorStop(1, "rgba(255,255,255,0)");
      ctx.strokeStyle = lg; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(st.x, st.y); ctx.lineTo(tx, ty); ctx.stroke();
    }

    // cursor stardust
    for (var tr = trail.length - 1; tr >= 0; tr--) {
      var d = trail[tr]; d.life -= 0.04;
      if (d.life <= 0) { trail.splice(tr, 1); continue; }
      ctx.fillStyle = "rgba(200,220,255," + (d.life * 0.5).toFixed(3) + ")";
      ctx.beginPath(); ctx.arc(d.x, d.y, 1.4 * d.life + 0.3, 0, 6.2832); ctx.fill();
    }

    ctx.globalCompositeOperation = "source-over";
    requestAnimationFrame(frame);
  }

  // ---- input ----
  var moved = false, downX = 0, downY = 0;
  canvas.addEventListener("pointerdown", function (e) { downX = e.clientX; downY = e.clientY; moved = false; });
  canvas.addEventListener("pointermove", function (e) {
    trail.push({ x: e.clientX, y: e.clientY, life: 1 });
    if (trail.length > 40) trail.shift();
    if (Math.hypot(e.clientX - downX, e.clientY - downY) > 6) moved = true;
  }, { passive: true });
  canvas.addEventListener("pointerup", function (e) {
    star(e.clientX, e.clientY);
    if (hint && !hint.classList.contains("is-hidden")) hint.classList.add("is-hidden");
  });

  breakBtn.addEventListener("click", function () { if (groups[groups.length - 1].length) groups.push([]); });
  clearBtn.addEventListener("click", function () {
    groups = [[]]; bursts = []; shooters = []; placedCount = 0; counter.textContent = "0 stars";
  });
  window.addEventListener("resize", resize);

  resize();
  requestAnimationFrame(frame);
})();
