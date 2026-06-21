/* Weird Generative Canvas — a multi-mode generative-art playground.
 * Modes: flow field, harmonograph, particle swarm, kaleidoscope. Palettes,
 * speed/density, drag to steer, randomize, clear, save PNG.
 */
(function () {
  "use strict";

  var canvas = document.getElementById("canvas");
  var ctx = canvas.getContext("2d");
  var hint = document.getElementById("hint");
  if (!canvas) return;

  var BG = "#07070e";
  var PALETTES = [
    ["#22d3ee", "#818cf8", "#c084fc", "#f0abfc"],   // aurora
    ["#39ff14", "#00e5ff", "#ff2079", "#fa0ff"],    // neon
    ["#fb7185", "#f472b6", "#c084fc", "#fcd34d"],    // bloom
    ["#a7f3d0", "#bfdbfe", "#ddd6fe", "#fbcfe8"],    // pastel
    ["#f8fafc", "#cbd5e1", "#94a3b8", "#e2e8f0"]     // mono
  ];

  var W = 0, H = 0, DPR = Math.min(2, window.devicePixelRatio || 1);
  function resize() {
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = W * DPR; canvas.height = H * DPR;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    fillBg();
    if (mode && mode.init) mode.init();
  }
  function fillBg() { ctx.globalCompositeOperation = "source-over"; ctx.fillStyle = BG; ctx.fillRect(0, 0, W, H); }
  function fade(a) { ctx.globalCompositeOperation = "source-over"; ctx.fillStyle = "rgba(7,7,14," + a + ")"; ctx.fillRect(0, 0, W, H); }

  // ---- controls / state ----
  var pal = PALETTES[0];
  var speed = 5, density = 5;
  var seed = 1;
  var ptr = { x: 0, y: 0, down: false, active: false };
  function col(i, a) {
    var c = pal[((i % pal.length) + pal.length) % pal.length];
    if (a == null) return c;
    var r = parseInt(c.slice(1, 3), 16), g = parseInt(c.slice(3, 5), 16), b = parseInt(c.slice(5, 7), 16);
    return "rgba(" + r + "," + g + "," + b + "," + a + ")";
  }

  // ---- value noise ----
  function n2(x, y) { var s = Math.sin(x * 12.9898 + y * 78.233 + seed) * 43758.5453; return s - Math.floor(s); }
  function sm(t) { return t * t * (3 - 2 * t); }
  function vnoise(x, y) {
    var xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    var u = sm(xf), v = sm(yf);
    var tl = n2(xi, yi), tr = n2(xi + 1, yi), bl = n2(xi, yi + 1), br = n2(xi + 1, yi + 1);
    return (tl * (1 - u) + tr * u) * (1 - v) + (bl * (1 - u) + br * u) * v;
  }

  // ================= MODES =================
  var TAU = Math.PI * 2;

  var Flow = {
    parts: [],
    init: function () {
      this.parts = [];
      var n = 50 + density * 45;
      for (var i = 0; i < n; i++) this.spawn(i);
    },
    spawn: function (i) {
      var p = this.parts[i] || {};
      p.x = Math.random() * W; p.y = Math.random() * H; p.px = p.x; p.py = p.y;
      p.ci = Math.floor(Math.random() * pal.length); p.life = 60 + Math.random() * 160;
      this.parts[i] = p;
    },
    step: function () {
      fade(0.035);
      var sp = 0.6 + speed * 0.34;
      ctx.globalCompositeOperation = "lighter";
      ctx.lineWidth = 1.1;
      for (var i = 0; i < this.parts.length; i++) {
        var p = this.parts[i];
        var a = vnoise(p.x * 0.0016, p.y * 0.0016) * TAU * 2;
        if (ptr.down) { var dx = p.x - ptr.x, dy = p.y - ptr.y, d = Math.hypot(dx, dy) + 1; a += (200 / d) * Math.atan2(dy, dx) * 0.02; }
        p.px = p.x; p.py = p.y;
        p.x += Math.cos(a) * sp; p.y += Math.sin(a) * sp;
        ctx.strokeStyle = col(p.ci, 0.5);
        ctx.beginPath(); ctx.moveTo(p.px, p.py); ctx.lineTo(p.x, p.y); ctx.stroke();
        if (--p.life < 0 || p.x < 0 || p.y < 0 || p.x > W || p.y > H) this.spawn(i);
      }
    }
  };

  var Harmono = {
    t: 0, P: null,
    rand: function () {
      function pen() { return { f: 1 + Math.floor(Math.random() * 5) + Math.random() * 0.02, p: Math.random() * TAU, a: 0.5 + Math.random() * 0.5, d: 0.0008 + Math.random() * 0.0022 }; }
      this.P = { x1: pen(), x2: pen(), y1: pen(), y2: pen() };
      this.t = 0; this.last = null;
    },
    init: function () { fillBg(); if (!this.P) this.rand(); this.last = null; this.t = 0; },
    val: function (a, b, t) { return (a.a * Math.sin(a.f * t + a.p) * Math.exp(-a.d * t) + b.a * Math.sin(b.f * t + b.p) * Math.exp(-b.d * t)) / 2; },
    step: function () {
      var P = this.P, R = Math.min(W, H) * 0.42, cx = W / 2, cy = H / 2;
      ctx.globalCompositeOperation = "lighter";
      ctx.lineWidth = 1.1;
      var steps = 2 + speed;
      for (var s = 0; s < steps; s++) {
        this.t += 0.6;
        var x = cx + this.val(P.x1, P.x2, this.t) * R;
        var y = cy + this.val(P.y1, P.y2, this.t) * R;
        if (this.last) {
          ctx.strokeStyle = col(Math.floor(this.t * 0.012), 0.5);
          ctx.beginPath(); ctx.moveTo(this.last.x, this.last.y); ctx.lineTo(x, y); ctx.stroke();
        }
        this.last = { x: x, y: y };
      }
      if (this.t > 4200) { this.rand(); fade(0.5); }
    }
  };

  var Swarm = {
    parts: [],
    init: function () {
      this.parts = [];
      var n = 40 + density * 36;
      for (var i = 0; i < n; i++) this.parts.push({ x: Math.random() * W, y: Math.random() * H, vx: 0, vy: 0, ci: Math.floor(Math.random() * pal.length) });
      this.tt = 0;
    },
    step: function () {
      fade(0.06);
      this.tt += 0.01 * (0.5 + speed * 0.15);
      var tx = ptr.down ? ptr.x : W / 2 + Math.cos(this.tt) * W * 0.3 + Math.cos(this.tt * 2.3) * 60;
      var ty = ptr.down ? ptr.y : H / 2 + Math.sin(this.tt * 1.3) * H * 0.28 + Math.sin(this.tt * 1.9) * 60;
      var sp = 0.4 + speed * 0.16;
      ctx.globalCompositeOperation = "lighter";
      ctx.lineWidth = 1.4;
      for (var i = 0; i < this.parts.length; i++) {
        var p = this.parts[i];
        var dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy) + 1;
        p.vx += (dx / d) * sp + (Math.random() - 0.5) * 0.3;
        p.vy += (dy / d) * sp + (Math.random() - 0.5) * 0.3;
        p.vx *= 0.94; p.vy *= 0.94;
        var ox = p.x, oy = p.y; p.x += p.vx; p.y += p.vy;
        ctx.strokeStyle = col(p.ci, 0.4);
        ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(p.x, p.y); ctx.stroke();
      }
    }
  };

  var Kaleido = {
    N: 8, last: null,
    init: function () { fillBg(); this.last = null; this.tt = 0; this.N = 6 + Math.floor(Math.random() * 4); },
    step: function () {
      var cx = W / 2, cy = H / 2;
      var sx, sy;
      if (ptr.down) { sx = ptr.x - cx; sy = ptr.y - cy; }
      else {
        this.tt += 0.02 * (0.5 + speed * 0.2);
        var rr = Math.min(W, H) * 0.34 * (0.4 + 0.6 * vnoise(this.tt, 7.3));
        sx = Math.cos(this.tt * 1.7) * rr; sy = Math.sin(this.tt * 2.3) * rr;
      }
      var cur = { x: sx, y: sy };
      ctx.globalCompositeOperation = "lighter";
      ctx.lineWidth = 1.6;
      var ci = Math.floor((this.tt || 0) * 6 + (ptr.down ? performance.now() * 0.004 : 0));
      if (this.last) {
        for (var k = 0; k < this.N; k++) {
          var ang = (k / this.N) * TAU;
          for (var m = 0; m < 2; m++) {
            var f = m ? -1 : 1;
            ctx.strokeStyle = col(ci + k, 0.55);
            ctx.beginPath();
            ctx.moveTo(cx + rot(this.last.x, this.last.y * f, ang).x, cy + rot(this.last.x, this.last.y * f, ang).y);
            ctx.lineTo(cx + rot(cur.x, cur.y * f, ang).x, cy + rot(cur.x, cur.y * f, ang).y);
            ctx.stroke();
          }
        }
      }
      this.last = cur;
    }
  };
  function rot(x, y, a) { var c = Math.cos(a), s = Math.sin(a); return { x: x * c - y * s, y: x * s + y * c }; }

  var MODES = { flow: Flow, harmono: Harmono, swarm: Swarm, kaleido: Kaleido };
  var mode = Flow;

  function loop() { mode.step(); requestAnimationFrame(loop); }

  // ---- wires ----
  function setMode(key) {
    mode = MODES[key] || Flow;
    fillBg();
    if (mode.rand && !mode.P) mode.rand();
    mode.init();
    document.querySelectorAll("#modes .seg__btn").forEach(function (b) { b.classList.toggle("is-on", b.dataset.mode === key); });
  }
  document.querySelectorAll("#modes .seg__btn").forEach(function (b) {
    b.addEventListener("click", function () { setMode(b.dataset.mode); });
  });

  // palette swatches
  var palWrap = document.getElementById("palettes");
  PALETTES.forEach(function (pp, idx) {
    var sw = document.createElement("button");
    sw.type = "button"; sw.className = "swatch" + (idx === 0 ? " is-on" : "");
    sw.setAttribute("aria-label", "Palette " + (idx + 1));
    sw.style.background = "linear-gradient(90deg," + pp.join(",") + ")";
    sw.addEventListener("click", function () {
      pal = pp;
      document.querySelectorAll(".swatch").forEach(function (s) { s.classList.toggle("is-on", s === sw); });
    });
    palWrap.appendChild(sw);
  });

  document.getElementById("speed").addEventListener("input", function (e) { speed = +e.target.value; });
  document.getElementById("density").addEventListener("input", function (e) { density = +e.target.value; if (mode.init) mode.init(); });
  document.getElementById("randomBtn").addEventListener("click", function () {
    seed = Math.floor(Math.random() * 1e6) + 1;
    if (mode.rand) mode.rand();
    fillBg(); mode.init();
  });
  document.getElementById("clearBtn").addEventListener("click", function () { fillBg(); if (mode.init) mode.init(); });
  document.getElementById("saveBtn").addEventListener("click", function () {
    try {
      var a = document.createElement("a");
      a.download = "generative-canvas.png";
      a.href = canvas.toDataURL("image/png");
      a.click();
    } catch (e) { /* ignore */ }
  });

  // pointer steer
  function pos(e) { ptr.x = e.clientX; ptr.y = e.clientY; }
  canvas.addEventListener("pointerdown", function (e) { ptr.down = true; pos(e); if (hint && !hint.classList.contains("is-hidden")) hint.classList.add("is-hidden"); });
  canvas.addEventListener("pointermove", function (e) { if (ptr.down) pos(e); }, { passive: true });
  window.addEventListener("pointerup", function () { ptr.down = false; });
  window.addEventListener("resize", resize);

  resize();
  setMode("flow");
  requestAnimationFrame(loop);
})();
