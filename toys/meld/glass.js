/* Meld — the glass. Eleven hand-blown orbs, drawn once per size and cached.
 *
 * Each orb is three sprites, because a rolling glass ball has two kinds of
 * look: what is INSIDE it turns with it, and what the light does stays put.
 *   body  — the coloured glass and its pattern. Drawn rotated by the orb's angle.
 *   dark  — thickness at the edge and the shadowed side. Fixed, source-over.
 *   light — the window reflection, the hot spot, the caustic the sphere
 *           focuses on its own far side, and the furnace bouncing up from
 *           below. Fixed, additive.
 * The order of the ladder runs warm and cool in turn so no two neighbours
 * read alike, and only three of the eleven are dark.
 */
(function () {
  "use strict";

  var TIERS = [
    { name: "Seed",       c: ["#e2fff8", "#86d6c8", "#1f5f5b"], caustic: "#bffff2", glow: "#7fffe6" },
    { name: "Amber",      c: ["#ffe7ac", "#f2a531", "#6e2c05"], caustic: "#ffd27a", glow: "#ffb547" },
    { name: "Cobalt",     c: ["#a9c8ff", "#2e5ee6", "#081664"], caustic: "#8fb4ff", glow: "#5b8cff" },
    { name: "Jade",       c: ["#c4f8d6", "#2fae6a", "#063f26"], caustic: "#a6ffcc", glow: "#4dffa0" },
    { name: "Cat's Eye",  c: ["#f6fdff", "#b4dcef", "#36607c"], caustic: "#e8fbff", glow: "#ff7a3d" },
    { name: "Rose",       c: ["#ffd6e8", "#ec4b8f", "#5e0a2f"], caustic: "#ffb3d4", glow: "#ff5aa5" },
    { name: "Millefiori", c: ["#fff6e2", "#ecca8c", "#8a5a22"], caustic: "#fff0c8", glow: "#ffd27a" },
    { name: "Dichroic",   c: ["#1c6a74", "#0b3238", "#020d10"], caustic: "#5fffe6", glow: "#4ff0e0" },
    { name: "Galaxy",     c: ["#4a37a8", "#1b1150", "#04021a"], caustic: "#b48cff", glow: "#a77bff" },
    { name: "Opal",       c: ["#fbfaff", "#d6d0ec", "#6f6895"], caustic: "#d8ccff", glow: "#e6dcff" },
    { name: "Sun",        c: ["#fffbe6", "#ffbf38", "#c2330a"], caustic: "#fff3c0", glow: "#ffae3a" }
  ];

  function rng(seed) {
    var s = seed >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0;
      var t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function canvas(n) {
    var c = document.createElement("canvas");
    c.width = c.height = n;
    return c;
  }

  function hexA(hex, a) {
    var n = parseInt(hex.slice(1), 16);
    return "rgba(" + (n >> 16 & 255) + "," + (n >> 8 & 255) + "," + (n & 255) + "," + a + ")";
  }

  /* ---------------------------------------------------------------- body */

  function body(t, R, x, rand) {
    var T = TIERS[t], c = T.c;
    // glass is coloured by THICKNESS: thin and pale where you look straight
    // through the middle, deep at the edge where the path through is long
    var g = x.createRadialGradient(-R * 0.18, -R * 0.22, R * 0.05, 0, 0, R);
    g.addColorStop(0, c[0]);
    g.addColorStop(0.55, c[1]);
    g.addColorStop(1, c[2]);
    x.fillStyle = g;
    x.fillRect(-R, -R, R * 2, R * 2);
    PATTERN[t](x, R, rand, T);
  }

  function bubbles(x, R, rand, n, a) {
    for (var i = 0; i < n; i++) {
      var ang = rand() * 6.283, d = Math.sqrt(rand()) * R * 0.78, r = R * (0.02 + rand() * 0.05);
      var bx = Math.cos(ang) * d, by = Math.sin(ang) * d;
      x.strokeStyle = "rgba(255,255,255," + (a * 0.7) + ")";
      x.lineWidth = Math.max(0.5, r * 0.25);
      x.beginPath(); x.arc(bx, by, r, 0, 6.283); x.stroke();
      x.fillStyle = "rgba(255,255,255," + a + ")";
      x.beginPath(); x.arc(bx - r * 0.35, by - r * 0.35, r * 0.28, 0, 6.283); x.fill();
    }
  }

  // soft > 0 draws each stroke as a few wide faint passes under a narrow one,
  // which is a blur that also works on Safari (canvas filter does not, there)
  function wisp(x, R, rand, color, width, n, curl, soft) {
    x.save();
    x.lineCap = "round";
    var passes = soft ? [[2.6, 0.22], [1.7, 0.32], [1, 0.55]] : [[1, 1]];
    for (var i = 0; i < n; i++) {
      var a0 = rand() * 6.283, d0 = R * (0.2 + rand() * 0.6);
      var x0 = Math.cos(a0) * d0, y0 = Math.sin(a0) * d0;
      var a1 = a0 + Math.PI * (0.6 + rand() * 0.8), d1 = R * (0.2 + rand() * 0.7);
      var x1 = Math.cos(a1) * d1, y1 = Math.sin(a1) * d1;
      var lw = width * (0.5 + rand());
      var c1x = x0 + (rand() - 0.5) * R * curl, c1y = y0 + (rand() - 0.5) * R * curl;
      var c2x = x1 + (rand() - 0.5) * R * curl, c2y = y1 + (rand() - 0.5) * R * curl;
      x.strokeStyle = color;
      for (var p = 0; p < passes.length; p++) {
        x.globalAlpha = passes[p][1];
        x.lineWidth = lw * passes[p][0];
        x.beginPath();
        x.moveTo(x0, y0);
        x.bezierCurveTo(c1x, c1y, c2x, c2y, x1, y1);
        x.stroke();
      }
    }
    x.restore();
  }

  var PATTERN = [
    // 0 Seed: clear, a little sea-glass green, a few seed bubbles
    function (x, R, rand) {
      bubbles(x, R, rand, 5, 0.55);
    },
    // 1 Amber: honey with the striae of a pull, and bubbles caught in it
    function (x, R, rand) {
      x.save();
      x.globalAlpha = 0.28;
      for (var i = 0; i < 9; i++) {
        var y = -R + (i + rand() * 0.6) * R * 0.24;
        x.strokeStyle = i % 2 ? "#fff1c8" : "#8a3c08";
        x.lineWidth = R * (0.02 + rand() * 0.03);
        x.beginPath();
        x.moveTo(-R, y);
        x.bezierCurveTo(-R * 0.3, y - R * 0.25, R * 0.3, y + R * 0.25, R, y - R * 0.05);
        x.stroke();
      }
      x.restore();
      bubbles(x, R, rand, 4, 0.5);
    },
    // 2 Cobalt: deep blue with a white latticino twist running through it
    function (x, R) {
      x.save();
      x.lineCap = "round";
      for (var k = 0; k < 7; k++) {
        var off = (k - 3) * R * 0.075;
        x.strokeStyle = "rgba(255,255,255," + (0.75 - Math.abs(k - 3) * 0.14) + ")";
        x.lineWidth = R * 0.028;
        x.beginPath();
        for (var s = 0; s <= 40; s++) {
          var u = s / 40, px = -R * 0.95 + u * R * 1.9;
          var py = Math.sin(u * Math.PI * 2.2 + k * 0.5) * R * 0.22 + off + (u - 0.5) * R * 0.5;
          if (s) x.lineTo(px, py); else x.moveTo(px, py);
        }
        x.stroke();
      }
      x.restore();
    },
    // 3 Jade: marbled, white and dark-green veins pulled through each other
    function (x, R, rand) {
      wisp(x, R, rand, "rgba(235,255,240,0.7)", R * 0.07, 5, 1.4, true);
      wisp(x, R, rand, "rgba(2,40,22,0.6)", R * 0.08, 4, 1.2, true);
      wisp(x, R, rand, "rgba(255,255,255,0.35)", R * 0.02, 4, 1.2);
    },
    // 4 Cat's Eye: clear, with the classic fat twisted vane through the centre
    function (x, R) {
      var w = R * 0.36;
      // the vane twists, so it shows a broad face at one end and an edge at the other
      x.beginPath();
      x.moveTo(-R * 0.9, -w * 0.1);
      x.bezierCurveTo(-R * 0.35, -w * 1.25, R * 0.25, w * 0.2, R * 0.9, -w * 0.05);
      x.bezierCurveTo(R * 0.35, w * 0.85, -R * 0.3, w * 0.55, -R * 0.9, -w * 0.1);
      var g = x.createLinearGradient(0, -w, 0, w);
      g.addColorStop(0, "#ffe2c8");
      g.addColorStop(0.35, "#ff6a26");
      g.addColorStop(0.7, "#d81f0c");
      g.addColorStop(1, "#ff9a52");
      x.fillStyle = g;
      x.fill();
      // a white seam where the two colours of the cane were fused
      x.strokeStyle = "rgba(255,255,255,0.75)";
      x.lineWidth = Math.max(0.6, R * 0.04);
      x.beginPath();
      x.moveTo(-R * 0.86, -w * 0.08);
      x.bezierCurveTo(-R * 0.3, -w * 0.45, R * 0.3, w * 0.45, R * 0.86, -w * 0.02);
      x.stroke();
    },
    // 5 Rose: gold-ruby pink with soft lighter veils and a little gold dust
    function (x, R, rand) {
      wisp(x, R, rand, "rgba(255,225,240,0.6)", R * 0.12, 4, 1.6, true);
      for (var i = 0; i < 26; i++) {
        var a = rand() * 6.283, d = Math.sqrt(rand()) * R * 0.8;
        x.fillStyle = "rgba(255,226,150," + (0.4 + rand() * 0.5) + ")";
        x.beginPath(); x.arc(Math.cos(a) * d, Math.sin(a) * d, R * (0.008 + rand() * 0.014), 0, 6.283); x.fill();
      }
    },
    // 6 Millefiori: a cream ground studded with flower canes
    function (x, R, rand) {
      var placed = [], tries = 0, PAL = [
        ["#d8263a", "#ffffff", "#ffd23f"], ["#1f6fd6", "#ffffff", "#ff3d7a"],
        ["#0f9b6c", "#fff3a8", "#e8402a"], ["#7b2fbf", "#ffd0ef", "#ffe24a"],
        ["#f07d12", "#ffffff", "#1d4fb3"]
      ];
      while (placed.length < 15 && tries < 400) {
        tries++;
        var a = rand() * 6.283, d = Math.sqrt(rand()) * R * 0.86, r = R * (0.11 + rand() * 0.1);
        var cx = Math.cos(a) * d, cy = Math.sin(a) * d, ok = true;
        for (var k = 0; k < placed.length; k++) {
          var p = placed[k];
          if (Math.hypot(p[0] - cx, p[1] - cy) < (p[2] + r) * 0.92) { ok = false; break; }
        }
        if (!ok) continue;
        placed.push([cx, cy, r]);
        var pal = PAL[Math.floor(rand() * PAL.length)];
        x.fillStyle = pal[0];
        x.beginPath(); x.arc(cx, cy, r, 0, 6.283); x.fill();
        var petals = 6 + Math.floor(rand() * 4), rot = rand() * 6.283;
        x.fillStyle = pal[1];
        for (var pi = 0; pi < petals; pi++) {
          var pa = rot + pi / petals * 6.283;
          x.beginPath();
          x.ellipse(cx + Math.cos(pa) * r * 0.48, cy + Math.sin(pa) * r * 0.48, r * 0.34, r * 0.15, pa, 0, 6.283);
          x.fill();
        }
        x.fillStyle = pal[2];
        x.beginPath(); x.arc(cx, cy, r * 0.22, 0, 6.283); x.fill();
      }
    },
    // 7 Dichroic: dark teal glass with iridescent sheets that change colour
    function (x, R, rand) {
      x.save();
      x.globalCompositeOperation = "lighter";
      var HUES = [["#2ef2d0", "#9a5cff"], ["#ffcf4a", "#2ef2d0"], ["#ff5ab4", "#ffcf4a"], ["#5ab4ff", "#ff5ab4"]];
      for (var i = 0; i < 7; i++) {
        var h = HUES[i % 4], ang = rand() * 6.283;
        x.save();
        x.rotate(ang);
        var w = R * (0.1 + rand() * 0.16), off = (rand() - 0.5) * R * 1.1;
        var g = x.createLinearGradient(-R, 0, R, 0);
        g.addColorStop(0, hexA(h[0], 0));
        g.addColorStop(0.35, hexA(h[0], 0.55));
        g.addColorStop(0.65, hexA(h[1], 0.55));
        g.addColorStop(1, hexA(h[1], 0));
        x.fillStyle = g;
        x.beginPath();
        x.moveTo(-R, off - w);
        x.bezierCurveTo(-R * 0.3, off - w * 2.2, R * 0.3, off + w * 0.3, R, off - w * 0.4);
        x.lineTo(R, off + w * 0.5);
        x.bezierCurveTo(R * 0.3, off + w * 1.2, -R * 0.3, off - w * 0.6, -R, off + w);
        x.closePath();
        x.fill();
        x.restore();
      }
      x.restore();
      // fine crazing where the sheets were fused
      x.strokeStyle = "rgba(200,255,250,0.25)";
      x.lineWidth = Math.max(0.5, R * 0.01);
      for (var c = 0; c < 10; c++) {
        var a0 = rand() * 6.283, d0 = rand() * R * 0.7;
        x.beginPath();
        x.moveTo(Math.cos(a0) * d0, Math.sin(a0) * d0);
        x.lineTo(Math.cos(a0) * d0 + (rand() - 0.5) * R * 0.35, Math.sin(a0) * d0 + (rand() - 0.5) * R * 0.35);
        x.stroke();
      }
    },
    // 8 Galaxy: aventurine — a nebula and a field of copper and gold glitter
    function (x, R, rand) {
      x.save();
      x.globalCompositeOperation = "lighter";
      var NEB = ["rgba(255,70,190,0.32)", "rgba(80,140,255,0.34)", "rgba(160,90,255,0.3)"];
      for (var i = 0; i < 6; i++) {
        var a = rand() * 6.283, d = rand() * R * 0.5, r = R * (0.35 + rand() * 0.35);
        var cx = Math.cos(a) * d, cy = Math.sin(a) * d;
        var g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
        g.addColorStop(0, NEB[i % 3]); g.addColorStop(1, "rgba(0,0,0,0)");
        x.fillStyle = g; x.fillRect(-R, -R, R * 2, R * 2);
      }
      // a spiral arm, so it reads as a galaxy and not just a bruise
      for (var s = 0; s < 260; s++) {
        var u = s / 260, arm = s % 2, ang = u * 5.2 + arm * Math.PI, rad = u * R * 0.85;
        var px = Math.cos(ang) * rad + (rand() - 0.5) * R * 0.12 * (0.4 + u);
        var py = Math.sin(ang) * rad * 0.8 + (rand() - 0.5) * R * 0.12 * (0.4 + u);
        x.fillStyle = "rgba(220,200,255," + (0.12 + (1 - u) * 0.25) + ")";
        x.beginPath(); x.arc(px, py, R * 0.018, 0, 6.283); x.fill();
      }
      x.restore();
      var n = Math.min(420, Math.floor(R * R * 0.6));
      for (var k = 0; k < n; k++) {
        var aa = rand() * 6.283, dd = Math.sqrt(rand()) * R * 0.95, br = rand();
        x.fillStyle = br > 0.85 ? "rgba(255,250,230,0.95)" : br > 0.45 ? "rgba(255,196,96,0.8)" : "rgba(214,120,60,0.7)";
        var sz = Math.max(0.45, R * (0.006 + br * 0.012));
        x.fillRect(Math.cos(aa) * dd - sz / 2, Math.sin(aa) * dd - sz / 2, sz, sz);
      }
    },
    // 9 Opal: milky, with play-of-colour flashing through it
    function (x, R, rand) {
      var FIRE = ["#3dff9a", "#3ab0ff", "#ff5ad1", "#ffb13a", "#b6ff3a", "#7a6bff"];
      for (var i = 0; i < 70; i++) {
        var a = rand() * 6.283, d = Math.sqrt(rand()) * R * 0.85;
        var cx = Math.cos(a) * d, cy = Math.sin(a) * d;
        x.fillStyle = hexA(FIRE[Math.floor(rand() * FIRE.length)], 0.5 + rand() * 0.35);
        x.beginPath();
        var sides = 5, r = R * (0.04 + rand() * 0.08), rot = rand() * 6.283;
        for (var s = 0; s < sides; s++) {
          var pa = rot + s / sides * 6.283, pr = r * (0.6 + rand() * 0.6);
          if (s) x.lineTo(cx + Math.cos(pa) * pr, cy + Math.sin(pa) * pr);
          else x.moveTo(cx + Math.cos(pa) * pr, cy + Math.sin(pa) * pr);
        }
        x.closePath(); x.fill();
      }
      wisp(x, R, rand, "rgba(255,255,255,0.5)", R * 0.14, 4, 1.6, true);
    },
    // 10 Sun: molten. Soft convection cells, and it gives off its own light
    function (x, R, rand) {
      wisp(x, R, rand, "rgba(190,45,0,0.55)", R * 0.09, 7, 1.8, true);
      wisp(x, R, rand, "rgba(255,250,200,0.42)", R * 0.05, 4, 1.4, true);
      // granulation: a dappled surface of small brighter cells
      for (var i = 0; i < 90; i++) {
        var a = rand() * 6.283, d = Math.sqrt(rand()) * R * 0.9, r = R * (0.03 + rand() * 0.05);
        var cx = Math.cos(a) * d, cy = Math.sin(a) * d;
        var g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
        g.addColorStop(0, "rgba(255,245,190,0.4)"); g.addColorStop(1, "rgba(255,245,190,0)");
        x.fillStyle = g;
        x.beginPath(); x.arc(cx, cy, r, 0, 6.283); x.fill();
      }
    }
  ];

  /* ---------------------------------------------------------- dark/light */

  function dark(t, R, x) {
    var sun = t === 10;
    var g = x.createRadialGradient(0, 0, R * (sun ? 0.8 : 0.62), 0, 0, R);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(0.75, "rgba(0,0,0," + (sun ? 0.08 : 0.16) + ")");
    g.addColorStop(1, "rgba(0,0,0," + (sun ? 0.3 : 0.5) + ")");
    x.fillStyle = g;
    x.beginPath(); x.arc(0, 0, R, 0, 6.283); x.fill();
    // the side turned from the key light is a touch deeper
    var s = x.createLinearGradient(-R * 0.7, -R * 0.7, R * 0.8, R * 0.8);
    s.addColorStop(0, "rgba(0,0,0,0)");
    s.addColorStop(1, "rgba(0,0,0," + (sun ? 0.05 : 0.22) + ")");
    x.fillStyle = s;
    x.beginPath(); x.arc(0, 0, R, 0, 6.283); x.fill();
  }

  function light(t, R, x) {
    var T = TIERS[t];
    // the caustic: a sphere focuses the light that passes through it onto
    // its own far side, so the bottom-right glows in the glass's own colour
    var cx = R * 0.3, cy = R * 0.42;
    var g = x.createRadialGradient(cx, cy, 0, cx, cy, R * 0.55);
    g.addColorStop(0, hexA(T.caustic, t === 10 ? 0.5 : t === 9 ? 0.22 : 0.42));
    g.addColorStop(1, hexA(T.caustic, 0));
    x.fillStyle = g;
    x.beginPath(); x.arc(0, 0, R, 0, 6.283); x.fill();

    // the studio window, curved round the ball
    x.save();
    x.beginPath(); x.arc(0, 0, R * 0.96, 0, 6.283); x.clip();
    x.translate(-R * 0.34, -R * 0.4);
    x.rotate(-0.62);
    var w = x.createLinearGradient(0, -R * 0.2, 0, R * 0.2);
    w.addColorStop(0, "rgba(255,255,255,0)");
    w.addColorStop(0.5, "rgba(255,255,255,0.2)");
    w.addColorStop(1, "rgba(255,255,255,0)");
    x.fillStyle = w;
    x.beginPath(); x.ellipse(0, 0, R * 0.46, R * 0.2, 0, 0, 6.283); x.fill();
    x.restore();

    // hot spot
    var hx = -R * 0.4, hy = -R * 0.46;
    var hs = x.createRadialGradient(hx, hy, 0, hx, hy, R * 0.2);
    hs.addColorStop(0, "rgba(255,255,255,0.95)");
    hs.addColorStop(0.3, "rgba(255,255,255,0.45)");
    hs.addColorStop(1, "rgba(255,255,255,0)");
    x.fillStyle = hs;
    x.beginPath(); x.arc(hx, hy, R * 0.2, 0, 6.283); x.fill();
    x.fillStyle = "rgba(255,255,255,0.95)";
    x.beginPath(); x.ellipse(hx, hy, R * 0.055, R * 0.035, -0.6, 0, 6.283); x.fill();

    // a crisp rim where the edge catches the key light
    x.lineWidth = Math.max(0.6, R * 0.025);
    var rim = x.createLinearGradient(-R, -R * 0.2, -R * 0.2, -R);
    rim.addColorStop(0, "rgba(255,255,255,0)");
    rim.addColorStop(0.5, "rgba(255,255,255,0.26)");
    rim.addColorStop(1, "rgba(255,255,255,0)");
    x.strokeStyle = rim;
    x.beginPath(); x.arc(0, 0, R * 0.975, Math.PI * 0.98, Math.PI * 1.66); x.stroke();
    // and the furnace, low and warm, bouncing up off the bottom of every orb
    var fur = x.createLinearGradient(-R * 0.7, 0, R * 0.7, 0);
    fur.addColorStop(0, "rgba(255,130,40,0)");
    fur.addColorStop(0.5, "rgba(255,130,40,0.3)");
    fur.addColorStop(1, "rgba(255,130,40,0)");
    x.strokeStyle = fur;
    x.lineWidth = Math.max(0.6, R * 0.035);
    x.beginPath(); x.arc(0, 0, R * 0.955, Math.PI * 0.22, Math.PI * 0.78); x.stroke();
  }

  /* ---------------------------------------------------------------- cache */

  var cache = {}, shared = {};
  var VARIANTS = 3;

  // r is the orb radius in device pixels; v picks one of a few blowings of
  // the same glass, so a pile is not eleven rubber stamps
  function sprite(t, r, v) {
    v = (v || 0) % VARIANTS;
    var rk = Math.round(r * 4), key = t + ":" + rk + ":" + v;
    if (cache[key]) return cache[key];
    var n = Math.ceil(r * 2 + 4), h = n / 2;
    var cb = canvas(n), xb = cb.getContext("2d");
    xb.translate(h, h);
    xb.save();
    xb.beginPath(); xb.arc(0, 0, r, 0, 6.283); xb.clip();
    body(t, r, xb, rng(t * 7919 + v * 104729 + 13));
    xb.restore();
    var sk = t + ":" + rk, sh = shared[sk];
    if (!sh) {
      var cd = canvas(n), xd = cd.getContext("2d");
      xd.translate(h, h); dark(t, r, xd);
      var cl = canvas(n), xl = cl.getContext("2d");
      xl.translate(h, h); light(t, r, xl);
      sh = shared[sk] = { dark: cd, light: cl };
    }
    return (cache[key] = { body: cb, dark: sh.dark, light: sh.light, half: h, r: r });
  }

  // one flattened picture of an orb (the ladder, the next-up socket, panels)
  function flat(t, r, angle, v) {
    var s = sprite(t, r, v), n = s.half * 2;
    var c = canvas(n), x = c.getContext("2d");
    x.translate(s.half, s.half);
    x.save(); x.rotate(angle || 0); x.drawImage(s.body, -s.half, -s.half); x.restore();
    x.drawImage(s.dark, -s.half, -s.half);
    x.globalCompositeOperation = "lighter";
    x.drawImage(s.light, -s.half, -s.half);
    return c;
  }

  function clear() { cache = {}; shared = {}; }

  window.MeldGlass = { TIERS: TIERS, sprite: sprite, flat: flat, clear: clear, hexA: hexA };
})();
