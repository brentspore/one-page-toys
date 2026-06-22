/* Falling Sand — a cellular-automaton material sandbox.
 * Powders fall and pile, liquids flow, fire spreads and burns out, plant burns,
 * sand sinks through water. Draw with a brush; pick a material.
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
  var EMPTY = 0, WALL = 1, SAND = 2, WATER = 3, OIL = 4, PLANT = 5, FIRE = 6, SMOKE = 7, STEAM = 8;

  var MATS = [
    { id: SAND, name: "Sand", color: "#d8b25a" },
    { id: WATER, name: "Water", color: "#3f86e0" },
    { id: STONE_ID(), name: "Stone", color: "#7b8088" },
    { id: PLANT, name: "Plant", color: "#46ae57" },
    { id: FIRE, name: "Fire", color: "#ff8a3c" },
    { id: OIL, name: "Oil", color: "#6b5230" },
    { id: EMPTY, name: "Erase", color: "#1a1712" }
  ];
  function STONE_ID() { return 1; } // WALL

  var CELL = 5;            // screen px per cell
  var cols = 0, rows = 0, n = 0;
  var grid, life, moved;
  var off, offCtx, img;

  function resize() {
    var W = window.innerWidth, H = window.innerHeight;
    cols = Math.max(40, Math.floor(W / CELL));
    rows = Math.max(40, Math.floor(H / CELL));
    n = cols * rows;
    var old = grid, oc = cols, or_ = rows; // (no remap on resize — keep simple)
    grid = new Uint8Array(n);
    life = new Uint8Array(n);
    moved = new Uint8Array(n);
    cv.width = W; cv.height = H;
    off = document.createElement("canvas"); off.width = cols; off.height = rows;
    offCtx = off.getContext("2d");
    img = offCtx.createImageData(cols, rows);
    ctx.imageSmoothingEnabled = false;
    void old; void oc; void or_;
  }
  window.addEventListener("resize", function () { resize(); });

  // ---- palette (RGB) ----
  var BG = [14, 12, 10];
  function colorOf(i, m) {
    var v = (((i * 2654435761) >>> 0) % 22) - 11; // subtle deterministic grain
    switch (m) {
      case WALL: return [110 + v, 114 + v, 122 + v];
      case SAND: return [216 + v, 178 + v, 90 + v];
      case WATER: return [52 + (v >> 1), 124 + (v >> 1), 226 + (v >> 1)];
      case OIL: return [80 + (v >> 1), 62 + (v >> 1), 38 + (v >> 1)];
      case PLANT: return [62 + v, 168 + v, 84 + v];
      case FIRE: {
        var l = life[i] / 60; // 1 hot .. 0 cool
        return [255, Math.round(90 + 150 * l), Math.round(20 + 40 * l)];
      }
      case SMOKE: { var s = life[i] / 70; return [80 + 30 * s, 80 + 30 * s, 88 + 30 * s]; }
      case STEAM: { var t = life[i] / 70; return [180 + 40 * t, 190 + 40 * t, 205 + 40 * t]; }
      default: return BG;
    }
  }

  function render() {
    var d = img.data;
    for (var i = 0; i < n; i++) {
      var c = colorOf(i, grid[i]);
      var p = i * 4;
      d[p] = c[0]; d[p + 1] = c[1]; d[p + 2] = c[2]; d[p + 3] = 255;
    }
    offCtx.putImageData(img, 0, 0);
    ctx.drawImage(off, 0, 0, cols, rows, 0, 0, cv.width, cv.height);
  }

  // ---- helpers ----
  function isLiquid(m) { return m === WATER || m === OIL; }
  function swap(a, b) { var t = grid[a]; grid[a] = grid[b]; grid[b] = t; var tl = life[a]; life[a] = life[b]; life[b] = tl; moved[a] = 1; moved[b] = 1; }

  // ---- simulation ----
  var frame = 0;
  function step() {
    moved.fill(0);
    var flip = (frame & 1) === 1;
    for (var y = rows - 1; y >= 0; y--) {
      for (var k = 0; k < cols; k++) {
        var x = flip ? (cols - 1 - k) : k;
        var i = y * cols + x;
        if (moved[i]) continue;
        var m = grid[i];
        if (m === EMPTY || m === WALL || m === PLANT) {
          if (m === PLANT) plantStep(i, x, y);
          continue;
        }
        if (m === SAND) sandStep(i, x, y);
        else if (m === WATER || m === OIL) liquidStep(i, x, y);
        else if (m === FIRE) fireStep(i, x, y);
        else if (m === SMOKE || m === STEAM) gasStep(i, x, y);
      }
    }
    frame++;
  }

  function sandStep(i, x, y) {
    if (y >= rows - 1) return;
    var b = i + cols;
    if (grid[b] === EMPTY || isLiquid(grid[b])) { swap(i, b); return; }
    var dirs = Math.random() < 0.5 ? [-1, 1] : [1, -1];
    for (var q = 0; q < 2; q++) {
      var dx = dirs[q], nx = x + dx;
      if (nx < 0 || nx >= cols) continue;
      var bd = b + dx;
      if (grid[bd] === EMPTY || isLiquid(grid[bd])) { swap(i, bd); return; }
    }
  }

  function liquidStep(i, x, y) {
    // fall
    if (y < rows - 1) {
      var b = i + cols;
      if (grid[b] === EMPTY) { swap(i, b); return; }
      // oil floats on water: oil above water stays; water below oil rises (handled when water processed)
      var dirs = Math.random() < 0.5 ? [-1, 1] : [1, -1];
      for (var q = 0; q < 2; q++) {
        var dx = dirs[q], nx = x + dx;
        if (nx < 0 || nx >= cols) continue;
        if (grid[b + dx] === EMPTY) { swap(i, b + dx); return; }
      }
    }
    // spread horizontally
    var ds = Math.random() < 0.5 ? [-1, 1] : [1, -1];
    for (var r = 0; r < 2; r++) {
      var sx = x + ds[r];
      if (sx < 0 || sx >= cols) continue;
      var ni = i + ds[r];
      if (grid[ni] === EMPTY) { swap(i, ni); return; }
    }
  }

  function neighbors(i, x, y) {
    var out = [];
    if (x > 0) out.push(i - 1);
    if (x < cols - 1) out.push(i + 1);
    if (y > 0) out.push(i - cols);
    if (y < rows - 1) out.push(i + cols);
    return out;
  }

  function fireStep(i, x, y) {
    var nb = neighbors(i, x, y);
    for (var j = 0; j < nb.length; j++) {
      var g = grid[nb[j]];
      if ((g === PLANT || g === OIL) && Math.random() < (g === OIL ? 0.34 : 0.22)) {
        grid[nb[j]] = FIRE; life[nb[j]] = 46 + ((Math.random() * 22) | 0); moved[nb[j]] = 1;
      } else if (g === WATER) {
        // doused
        if (Math.random() < 0.6) grid[nb[j]] = STEAM, life[nb[j]] = 60;
        life[i] = 1;
      }
    }
    if (life[i] <= 1) {
      if (Math.random() < 0.5) { grid[i] = SMOKE; life[i] = 50 + ((Math.random() * 30) | 0); }
      else grid[i] = EMPTY;
      return;
    }
    life[i] -= 1;
    // flicker upward
    if (y > 0 && grid[i - cols] === EMPTY && Math.random() < 0.35) swap(i, i - cols);
  }

  function plantStep(i, x, y) {
    // slowly creep upward when sitting on/near water (a little life)
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
        var nx = x + dirs[q];
        if (nx < 0 || nx >= cols) continue;
        if (grid[u + dirs[q]] === EMPTY) { swap(i, u + dirs[q]); return; }
      }
    }
    // drift sideways
    if (Math.random() < 0.4) {
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
        // density: solids fill fully; liquids/gas a bit sparser; erase fully
        if (current === EMPTY || current === WALL) { grid[i] = current; life[i] = 0; }
        else if (Math.random() < (current === FIRE ? 0.7 : 0.85)) {
          grid[i] = current;
          life[i] = current === FIRE ? 52 + ((Math.random() * 20) | 0) : 0;
        }
      }
    }
  }

  function posFromEvent(e) {
    return [e.clientX, e.clientY];
  }
  cv.addEventListener("pointerdown", function (e) {
    e.preventDefault(); drawing = true; var p = posFromEvent(e); paint(p[0], p[1]); hideHint();
    cv.setPointerCapture && cv.setPointerCapture(e.pointerId);
  });
  cv.addEventListener("pointermove", function (e) {
    if (!drawing) return; var p = posFromEvent(e); paint(p[0], p[1]);
  });
  window.addEventListener("pointerup", function () { drawing = false; });
  window.addEventListener("pointercancel", function () { drawing = false; });

  // ---- toolbar ----
  MATS.forEach(function (mt, idx) {
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
  clearBtn.addEventListener("click", function () { grid.fill(0); life.fill(0); });

  function hideHint() { if (hintEl) hintEl.classList.add("is-hidden"); }
  function track(name, params) { try { if (typeof window.gtag === "function") window.gtag("event", name, params || {}); } catch (e) {} }

  // ---- loop ----
  function loop() { step(); render(); requestAnimationFrame(loop); }
  resize();
  brush = +brushEl.value;
  setTimeout(hideHint, 8000);
  requestAnimationFrame(loop);
})();
