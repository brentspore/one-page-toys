/* Falling Sand — a cellular-automaton material sandbox with heat + light.
 * Powders fall, liquids layer by density, fire spreads, plants grow. New:
 * LAVA (glows, melts sand→glass, quenches to stone in water + steam),
 * ACID (dissolves solids), ICE (freezes water, melts near heat), GUNPOWDER
 * (chain-explodes), GLASS (sand fused by heat), GAS (rises, ignites into a
 * fireball). A diffusing heat field drives melting/freezing/ignition, and an
 * emissive bloom pass makes hot materials glow and light nearby cells.
 */
(function () {
  "use strict";

  var cv = document.getElementById("sand");
  var ctx = cv.getContext("2d");
  var matsEl = document.getElementById("mats");
  var brushEl = document.getElementById("brush");
  var clearBtn = document.getElementById("clearBtn");
  var hintEl = document.getElementById("hint");

  // material ids
  var EMPTY = 0, WALL = 1, SAND = 2, WATER = 3, OIL = 4, PLANT = 5, FIRE = 6,
    SMOKE = 7, STEAM = 8, LAVA = 9, ACID = 10, ICE = 11, POWDER = 12, GLASS = 13, GAS = 14;

  var MATS = [
    { id: SAND, name: "Sand", color: "#d8b25a" },
    { id: WATER, name: "Water", color: "#3f86e0" },
    { id: WALL, name: "Stone", color: "#7b8088" },
    { id: PLANT, name: "Plant", color: "#46ae57" },
    { id: FIRE, name: "Fire", color: "#ff8a3c" },
    { id: LAVA, name: "Lava", color: "#ff5a1e" },
    { id: OIL, name: "Oil", color: "#6b5230" },
    { id: ACID, name: "Acid", color: "#8ce63a" },
    { id: ICE, name: "Ice", color: "#a9d8ee" },
    { id: POWDER, name: "Gunpowder", color: "#5c6152" },
    { id: GLASS, name: "Glass", color: "#a9c6d8" },
    { id: GAS, name: "Gas", color: "#7fae5a" },
    { id: EMPTY, name: "Erase", color: "#1a1712" }
  ];

  // density for fall/layering (fluids only sort; solids are immovable-heavy)
  var DENS = new Float32Array(16);
  DENS[EMPTY] = 0; DENS[GAS] = 0.1; DENS[SMOKE] = 0.1; DENS[STEAM] = 0.1; DENS[FIRE] = 0.2;
  DENS[OIL] = 0.8; DENS[WATER] = 1.0; DENS[ACID] = 1.05; DENS[LAVA] = 1.7;
  DENS[SAND] = 2.0; DENS[POWDER] = 2.1;
  DENS[WALL] = 9; DENS[GLASS] = 9; DENS[ICE] = 9; DENS[PLANT] = 9;

  function fluidLike(m) { return m === WATER || m === OIL || m === ACID || m === LAVA || m === GAS || m === SMOKE || m === STEAM || m === FIRE; }
  function canFall(self, target) { return target === EMPTY || (fluidLike(target) && DENS[target] < DENS[self]); }

  var CELL = 5;            // screen px per cell
  var cols = 0, rows = 0, n = 0;
  var grid, life, moved, heat, heat2, emit, emitB, emitTmp;
  var off, offCtx, img, glowCv, glowCtx, glowImg;

  function resize() {
    var W = window.innerWidth, H = window.innerHeight;
    cols = Math.max(40, Math.floor(W / CELL));
    rows = Math.max(40, Math.floor(H / CELL));
    n = cols * rows;
    grid = new Uint8Array(n); life = new Uint8Array(n); moved = new Uint8Array(n);
    heat = new Float32Array(n); heat2 = new Float32Array(n);
    emit = new Float32Array(n); emitB = new Float32Array(n); emitTmp = new Float32Array(n);
    cv.width = W; cv.height = H;
    off = document.createElement("canvas"); off.width = cols; off.height = rows;
    offCtx = off.getContext("2d"); img = offCtx.createImageData(cols, rows);
    glowCv = document.createElement("canvas"); glowCv.width = cols; glowCv.height = rows;
    glowCtx = glowCv.getContext("2d"); glowImg = glowCtx.createImageData(cols, rows);
    ctx.imageSmoothingEnabled = false;
  }
  window.addEventListener("resize", function () { resize(); });

  // ---- palette (RGB) ----
  var BG = [14, 12, 10];
  var tick = 0;
  function colorOf(i, m) {
    var h = (i * 2654435761) >>> 0;
    var v = (h % 30) - 15, v2 = ((h >>> 5) % 16) - 8;
    switch (m) {
      case WALL:
        if (h % 19 === 0) return [72, 76, 84];
        var g = 112 + v; return [g, g + 6, g + 16];
      case SAND:
        if (h % 9 === 0) return [196 + v2, 158, 72];
        if (h % 6 === 0) return [234, 198 + v2, 112];
        return [216 + v, 178 + v, 88 + v2];
      case WATER:
        if (h % 31 === 0) return [150, 200, 255];
        return [42 + v2, 112 + v2, 214 + (v >> 1)];
      case OIL:
        if (h % 13 === 0) return [98, 80, 54];
        return [72 + (v2 >> 1), 56 + (v2 >> 1), 38 + (v2 >> 1)];
      case PLANT:
        if (h % 6 === 0) return [40, 138, 62];
        return [60 + v, 166 + v, 82 + v2];
      case FIRE: {
        var l = life[i] / 64;
        var fl = ((tick + i * 3) % 7) - 3;
        return [255, 70 + 168 * l + fl * 7, 16 + 44 * l];
      }
      case SMOKE: { var s = life[i] / 70; var sg = 76 + 30 * s + v2; return [sg, sg, sg + 9]; }
      case STEAM: { var t = life[i] / 70; var tg = 178 + 42 * t + v2; return [tg, tg + 4, tg + 14]; }
      case LAVA: {
        var lf = ((tick * 2 + i * 5) % 13) - 6;                 // molten churn
        if (h % 11 === 0) return [255, 220 + (v2 >> 1), 120];    // bright hot fleck
        return [206 + (v >> 1) + lf, 70 + (v2 >> 1) + lf, 22 + (v2 >> 2)];
      }
      case ACID:
        if (h % 12 === 0) return [200, 255, 150];
        return [108 + v, 214 + v2, 74 + v2];
      case ICE:
        if (h % 14 === 0) return [220, 240, 255];
        return [168 + v, 206 + (v2 >> 1), 232 + (v2 >> 2)];
      case POWDER:
        if (h % 17 === 0) return [120, 122, 96];
        return [70 + (v2 >> 1), 74 + (v2 >> 1), 66 + (v2 >> 1)];
      case GLASS:
        if (h % 15 === 0) return [206, 226, 240];
        return [150 + v2, 180 + v2, 200 + v2];
      case GAS: { var gg = 58 + v2; return [gg - 6, gg + 20, gg - 10]; }
      default: return BG;
    }
  }

  // ---- render (base + emissive bloom/light) ----
  function render() {
    tick++;
    var d = img.data, i, p;
    for (i = 0; i < n; i++) {
      var c = colorOf(i, grid[i]);
      p = i * 4; d[p] = c[0]; d[p + 1] = c[1]; d[p + 2] = c[2]; d[p + 3] = 255;
    }
    offCtx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.globalCompositeOperation = "source-over";
    ctx.drawImage(off, 0, 0, cols, rows, 0, 0, cv.width, cv.height);

    // emission: fire/lava glow, plus anything very hot
    for (i = 0; i < n; i++) {
      var m = grid[i], e = 0;
      if (m === FIRE) e = 0.62 + (((tick + i * 3) % 7) - 3) * 0.03;
      else if (m === LAVA) e = 0.82;
      var hh = heat[i];
      if (hh > 0.5) { var he = (hh - 0.5) * 0.7; if (he > e) e = he; }
      emit[i] = e < 0 ? 0 : e;
    }
    blurEmit(3);
    var gd = glowImg.data;
    for (i = 0; i < n; i++) {
      var b = emitB[i];
      p = i * 4;
      if (b < 0.02) { gd[p] = 0; gd[p + 1] = 0; gd[p + 2] = 0; gd[p + 3] = 255; continue; }
      var R = b * 300; if (R > 255) R = 255;
      var G = (b - 0.26) * 270; G = G < 0 ? 0 : G > 255 ? 255 : G;
      var B = (b - 0.72) * 230; B = B < 0 ? 0 : B > 255 ? 255 : B;
      gd[p] = R; gd[p + 1] = G; gd[p + 2] = B; gd[p + 3] = 255;
    }
    glowCtx.putImageData(glowImg, 0, 0);
    ctx.imageSmoothingEnabled = true;                 // soft bloom on upscale
    ctx.globalCompositeOperation = "lighter";
    ctx.drawImage(glowCv, 0, 0, cols, rows, 0, 0, cv.width, cv.height);
    ctx.globalCompositeOperation = "source-over";
    ctx.imageSmoothingEnabled = false;
  }

  // separable [1,2,1] blur applied `passes` times → soft glow
  function blurEmit(passes) {
    emitB.set(emit);
    for (var pc = 0; pc < passes; pc++) {
      var x, y, base;
      for (y = 0; y < rows; y++) {
        base = y * cols;
        for (x = 0; x < cols; x++) {
          var l = x > 0 ? emitB[base + x - 1] : emitB[base + x];
          var c = emitB[base + x];
          var r = x < cols - 1 ? emitB[base + x + 1] : emitB[base + x];
          emitTmp[base + x] = (l + 2 * c + r) * 0.25;
        }
      }
      for (y = 0; y < rows; y++) {
        base = y * cols;
        for (x = 0; x < cols; x++) {
          var u = y > 0 ? emitTmp[base + x - cols] : emitTmp[base + x];
          var c2 = emitTmp[base + x];
          var dn = y < rows - 1 ? emitTmp[base + x + cols] : emitTmp[base + x];
          emitB[base + x] = (u + 2 * c2 + dn) * 0.25;
        }
      }
    }
  }

  // ---- heat field (emit → diffuse → decay) ----
  function heatPass() {
    var i;
    for (i = 0; i < n; i++) {
      var m = grid[i];
      if (m === LAVA) heat[i] = 1.0;
      else if (m === FIRE) { if (heat[i] < 0.74) heat[i] = 0.74; }
    }
    var K = 0.16, DEC = 0.99;
    for (var y = 0; y < rows; y++) {
      var base = y * cols;
      for (var x = 0; x < cols; x++) {
        i = base + x;
        var c = heat[i], s = 0, cnt = 0;
        if (x > 0) { s += heat[i - 1]; cnt++; }
        if (x < cols - 1) { s += heat[i + 1]; cnt++; }
        if (y > 0) { s += heat[i - cols]; cnt++; }
        if (y < rows - 1) { s += heat[i + cols]; cnt++; }
        heat2[i] = (c + K * (s - cnt * c)) * DEC;
      }
    }
    var t = heat; heat = heat2; heat2 = t;
  }

  // ---- helpers ----
  function swap(a, b) { var t = grid[a]; grid[a] = grid[b]; grid[b] = t; var tl = life[a]; life[a] = life[b]; life[b] = tl; moved[a] = 1; moved[b] = 1; }
  function ignite(j, lifeVal) { grid[j] = FIRE; life[j] = lifeVal + ((Math.random() * 14) | 0); heat[j] = 0.85; moved[j] = 1; }
  function adjHas(x, y, m) {
    return (x > 0 && grid[y * cols + x - 1] === m) || (x < cols - 1 && grid[y * cols + x + 1] === m) ||
      (y > 0 && grid[(y - 1) * cols + x] === m) || (y < rows - 1 && grid[(y + 1) * cols + x] === m);
  }

  // ---- simulation ----
  var frameN = 0;
  function step() {
    moved.fill(0);
    var flip = (frameN & 1) === 1;
    for (var y = rows - 1; y >= 0; y--) {
      for (var k = 0; k < cols; k++) {
        var x = flip ? (cols - 1 - k) : k;
        var i = y * cols + x;
        if (moved[i]) continue;
        var m = grid[i];
        switch (m) {
          case SAND: sandStep(i, x, y); break;
          case WATER: case OIL: liquidStep(i, x, y, m); break;
          case ACID: acidStep(i, x, y); break;
          case LAVA: lavaStep(i, x, y); break;
          case ICE: iceStep(i, x, y); break;
          case PLANT: plantStep(i, x, y); break;
          case POWDER: powderStep(i, x, y); break;
          case FIRE: fireStep(i, x, y); break;
          case GAS: gasMethaneStep(i, x, y); break;
          case SMOKE: case STEAM: gasStep(i, x, y); break;
          default: break;                       // EMPTY, WALL, GLASS = inert
        }
      }
    }
    frameN++;
  }

  function sandStep(i, x, y) {
    if (heat[i] > 0.9 && Math.random() < 0.2) { grid[i] = GLASS; return; }   // fuse to glass
    if (y >= rows - 1) return;
    var b = i + cols;
    if (canFall(SAND, grid[b])) { swap(i, b); return; }
    var dirs = Math.random() < 0.5 ? [-1, 1] : [1, -1];
    for (var q = 0; q < 2; q++) {
      var dx = dirs[q]; if (x + dx < 0 || x + dx >= cols) continue;
      if (canFall(SAND, grid[b + dx])) { swap(i, b + dx); return; }
    }
  }

  function liquidStep(i, x, y, m) {
    if (m === WATER && heat[i] > 0.6 && Math.random() < 0.24) { grid[i] = STEAM; life[i] = 60; return; }
    if (m === OIL && heat[i] > 0.4 && Math.random() < 0.3) { ignite(i, 40); return; }
    if (y < rows - 1) {
      var b = i + cols;
      if (canFall(m, grid[b])) { swap(i, b); return; }
      var dirs = Math.random() < 0.5 ? [-1, 1] : [1, -1];
      for (var q = 0; q < 2; q++) {
        var dx = dirs[q]; if (x + dx < 0 || x + dx >= cols) continue;
        if (canFall(m, grid[b + dx])) { swap(i, b + dx); return; }
      }
    }
    var ds = Math.random() < 0.5 ? [-1, 1] : [1, -1];
    for (var r = 0; r < 2; r++) {
      var sx = x + ds[r]; if (sx < 0 || sx >= cols) continue;
      var ni = i + ds[r];
      if (grid[ni] === EMPTY || (fluidLike(grid[ni]) && DENS[grid[ni]] < DENS[m])) { swap(i, ni); return; }
    }
  }

  function acidStep(i, x, y) {
    // dissolve a solid neighbour; acid is used up sometimes
    var nb = [x > 0 ? i - 1 : -1, x < cols - 1 ? i + 1 : -1, y > 0 ? i - cols : -1, y < rows - 1 ? i + cols : -1];
    for (var j = 0; j < 4; j++) {
      var t = nb[j]; if (t < 0) continue;
      var g = grid[t];
      if (g === WALL || g === SAND || g === PLANT || g === GLASS || g === POWDER || g === ICE) {
        if (Math.random() < 0.22) {
          grid[t] = EMPTY; life[t] = 0; moved[t] = 1;
          if (Math.random() < 0.4) { grid[i] = EMPTY; return; }   // acid consumed
        }
      } else if (g === WATER && Math.random() < 0.02) { grid[i] = WATER; return; }  // diluted
    }
    liquidStep(i, x, y, ACID);
  }

  function lavaStep(i, x, y) {
    var nb = [x > 0 ? i - 1 : -1, x < cols - 1 ? i + 1 : -1, y > 0 ? i - cols : -1, y < rows - 1 ? i + cols : -1];
    for (var j = 0; j < 4; j++) {
      var t = nb[j]; if (t < 0) continue;
      var g = grid[t];
      if (g === WATER || g === ICE || g === STEAM) {          // quench → obsidian stone + steam
        grid[i] = WALL; life[i] = 0; heat[i] = 0.5;
        if (g === WATER) { grid[t] = STEAM; life[t] = 60; moved[t] = 1; }
        else if (g === ICE) { grid[t] = WATER; moved[t] = 1; }
        return;
      } else if (g === SAND) { if (Math.random() < 0.25) { grid[t] = GLASS; moved[t] = 1; } }
      else if (g === POWDER) { explode(t % cols, (t / cols) | 0, 4 + ((Math.random() * 2) | 0)); }
      else if (g === PLANT || g === OIL || g === GAS) { if (Math.random() < 0.4) ignite(t, 40); }
    }
    heat[i] = 1.0;
    if (heat[i] < 0.44 && Math.random() < 0.02) { grid[i] = WALL; return; }  // (rarely reached; lava keeps itself hot)
    if (Math.random() < 0.42) liquidStep(i, x, y, LAVA);                     // viscous: oozes slowly
  }

  function iceStep(i, x, y) {
    if (heat[i] > 0.2 || adjHas(x, y, FIRE) || adjHas(x, y, LAVA)) {
      if (Math.random() < 0.16) { grid[i] = WATER; return; }
    } else if (heat[i] < 0.08 && Math.random() < 0.02) {                     // spread the freeze
      var nb = [x > 0 ? i - 1 : -1, x < cols - 1 ? i + 1 : -1, y > 0 ? i - cols : -1, y < rows - 1 ? i + cols : -1];
      var t = nb[(Math.random() * 4) | 0];
      if (t >= 0 && grid[t] === WATER) { grid[t] = ICE; moved[t] = 1; }
    }
  }

  function powderStep(i, x, y) {
    if (heat[i] > 0.42 || adjHas(x, y, FIRE) || adjHas(x, y, LAVA)) { explode(x, y, 4 + ((Math.random() * 2) | 0)); return; }
    if (y >= rows - 1) return;
    var b = i + cols;
    if (canFall(POWDER, grid[b])) { swap(i, b); return; }
    var dirs = Math.random() < 0.5 ? [-1, 1] : [1, -1];
    for (var q = 0; q < 2; q++) {
      var dx = dirs[q]; if (x + dx < 0 || x + dx >= cols) continue;
      if (canFall(POWDER, grid[b + dx])) { swap(i, b + dx); return; }
    }
  }

  function explode(cx, cy, R) {
    var R2 = R * R;
    for (var dy = -R; dy <= R; dy++) {
      for (var dx = -R; dx <= R; dx++) {
        var dd = dx * dx + dy * dy; if (dd > R2) continue;
        var xx = cx + dx, yy = cy + dy;
        if (xx < 0 || xx >= cols || yy < 0 || yy >= rows) continue;
        var j = yy * cols + xx, g = grid[j];
        if (g === WALL || g === GLASS) { if (dd < R2 * 0.28 && Math.random() < 0.6) { grid[j] = EMPTY; moved[j] = 1; } continue; }
        grid[j] = FIRE; life[j] = 26 + ((Math.random() * 32) | 0); heat[j] = 1.0; moved[j] = 1;
      }
    }
  }

  function fireStep(i, x, y) {
    if (heat[i] < 0.74) heat[i] = 0.74;
    var nb = [x > 0 ? i - 1 : -1, x < cols - 1 ? i + 1 : -1, y > 0 ? i - cols : -1, y < rows - 1 ? i + cols : -1];
    for (var j = 0; j < 4; j++) {
      var t = nb[j]; if (t < 0) continue;
      var g = grid[t];
      if (g === PLANT && Math.random() < 0.24) ignite(t, 40);
      else if (g === OIL && Math.random() < 0.36) ignite(t, 46);
      else if (g === GAS && Math.random() < 0.6) ignite(t, 18);
      else if (g === POWDER) explode(t % cols, (t / cols) | 0, 4 + ((Math.random() * 2) | 0));
      else if (g === ICE && Math.random() < 0.2) { grid[t] = WATER; moved[t] = 1; }
      else if (g === WATER && Math.random() < 0.5) { grid[t] = STEAM; life[t] = 60; moved[t] = 1; life[i] = 1; }
    }
    if (life[i] <= 1) {
      if (Math.random() < 0.5) { grid[i] = SMOKE; life[i] = 50 + ((Math.random() * 30) | 0); }
      else grid[i] = EMPTY;
      return;
    }
    life[i] -= 1;
    if (y > 0 && grid[i - cols] === EMPTY && Math.random() < 0.35) swap(i, i - cols);
  }

  function plantStep(i, x, y) {
    if (heat[i] > 0.44 && Math.random() < 0.3) { ignite(i, 38); return; }
    if (y > 0 && grid[i - cols] === EMPTY && Math.random() < 0.004) {
      var below = y < rows - 1 ? grid[i + cols] : WALL;
      var wet = below === WATER || (x > 0 && grid[i - 1] === WATER) || (x < cols - 1 && grid[i + 1] === WATER);
      if (wet) { grid[i - cols] = PLANT; moved[i - cols] = 1; }
    }
  }

  function gasStep(i, x, y) {
    if (life[i] <= 1) { grid[i] = EMPTY; return; }
    life[i] -= 1;
    if (y > 0) {
      var u = i - cols;
      if (grid[u] === EMPTY) { swap(i, u); return; }
      var dirs = Math.random() < 0.5 ? [-1, 1] : [1, -1];
      for (var q = 0; q < 2; q++) {
        var nx = x + dirs[q]; if (nx < 0 || nx >= cols) continue;
        if (grid[u + dirs[q]] === EMPTY) { swap(i, u + dirs[q]); return; }
      }
    }
    if (Math.random() < 0.4) {
      var sx = x + (Math.random() < 0.5 ? -1 : 1);
      if (sx >= 0 && sx < cols && grid[i + (sx - x)] === EMPTY) swap(i, i + (sx - x));
    }
  }

  function gasMethaneStep(i, x, y) {
    if (heat[i] > 0.3 || adjHas(x, y, FIRE) || adjHas(x, y, LAVA)) { ignite(i, 16); return; }
    if (Math.random() < 0.0022) { grid[i] = EMPTY; return; }    // slowly dissipates
    if (y > 0) {
      var u = i - cols;
      if (grid[u] === EMPTY) { swap(i, u); return; }
      var dirs = Math.random() < 0.5 ? [-1, 1] : [1, -1];
      for (var q = 0; q < 2; q++) {
        var nx = x + dirs[q]; if (nx < 0 || nx >= cols) continue;
        if (grid[u + dirs[q]] === EMPTY) { swap(i, u + dirs[q]); return; }
      }
    }
    if (Math.random() < 0.5) {
      var sx = x + (Math.random() < 0.5 ? -1 : 1);
      if (sx >= 0 && sx < cols && grid[i + (sx - x)] === EMPTY) swap(i, i + (sx - x));
    }
  }

  // ---- painting ----
  var current = SAND, brush = 4, drawing = false;
  function paint(px, py) {
    var cx = Math.floor(px / cv.width * cols), cy = Math.floor(py / cv.height * rows);
    var rad = brush;
    for (var dy = -rad; dy <= rad; dy++) {
      for (var dx = -rad; dx <= rad; dx++) {
        if (dx * dx + dy * dy > rad * rad) continue;
        var x = cx + dx, y = cy + dy;
        if (x < 0 || x >= cols || y < 0 || y >= rows) continue;
        var i = y * cols + x;
        if (current === EMPTY || current === WALL || current === GLASS || current === ICE) {
          grid[i] = current; life[i] = 0; if (current === EMPTY) heat[i] = 0;
        } else {
          var dens = current === FIRE ? 0.7 : current === GAS ? 0.6 : 0.85;
          if (Math.random() < dens) {
            grid[i] = current;
            life[i] = current === FIRE ? 52 + ((Math.random() * 20) | 0) : (current === GAS ? 0 : 0);
            if (current === LAVA) heat[i] = 1.0;
            else if (current === FIRE) heat[i] = 0.8;
          }
        }
      }
    }
  }

  cv.addEventListener("pointerdown", function (e) {
    e.preventDefault(); drawing = true; paint(e.clientX, e.clientY); hideHint();
    cv.setPointerCapture && cv.setPointerCapture(e.pointerId);
  });
  cv.addEventListener("pointermove", function (e) { if (drawing) paint(e.clientX, e.clientY); });
  window.addEventListener("pointerup", function () { drawing = false; });
  window.addEventListener("pointercancel", function () { drawing = false; });

  // ---- toolbar ----
  MATS.forEach(function (mt) {
    var b = document.createElement("button");
    b.type = "button"; b.className = "mat" + (mt.id === SAND ? " is-active" : "");
    b.dataset.mat = mt.id;
    b.innerHTML = '<span class="mat__sw" style="background:' + mt.color + '"></span>' + mt.name;
    b.addEventListener("click", function () {
      current = mt.id;
      [].forEach.call(matsEl.children, function (c) { c.classList.remove("is-active"); });
      b.classList.add("is-active");
      track("sand_material", { material: mt.name });
    });
    matsEl.appendChild(b);
  });
  brushEl.addEventListener("input", function () { brush = +brushEl.value; });
  clearBtn.addEventListener("click", function () { grid.fill(0); life.fill(0); heat.fill(0); });

  function hideHint() { if (hintEl) hintEl.classList.add("is-hidden"); }
  function track(name, params) { try { if (typeof window.gtag === "function") window.gtag("event", name, params || {}); } catch (e) {} }

  // ---- loop ----
  function loop() { step(); heatPass(); render(); requestAnimationFrame(loop); }
  resize();
  brush = +brushEl.value;
  setTimeout(hideHint, 8000);
  requestAnimationFrame(loop);
})();
