/* Pin Art — a fullscreen digital metal pinscreen.
 * A dense grid of pins. On hover the relief rises under your hand; press and DRAG
 * to push pins up and leave a lasting raised impression you can draw with. Each pin
 * gets a warm metallic highlight + shadow so it reads as a real 3D relief.
 * Erase to push pins back down; Clear flattens the whole screen.
 */
(function () {
  "use strict";

  // ---- TUNABLES — adjust these to change the feel --------------------------
  var SPACING = 40;     // px between pins (grid density) — smaller = denser screen
  var RADIUS  = 150;    // px brush / hover radius — how wide the relief spreads
  var R0      = 1.6;    // resting pin radius (px)
  var RPUSH   = 7.6;    // extra radius a fully-raised pin gains (px)
  var EASE    = 16;     // springiness of the rise/fall — higher = snappier
  // --------------------------------------------------------------------------

  var canvas = document.getElementById("canvas");
  var ctx = canvas.getContext("2d");

  // grid geometry (derived from SPACING on resize)
  var W, H, DPR;
  var cols, rows, ox, oy;
  var cur;                            // eased push amount per pin [0..1] (what's drawn)
  var base;                           // the PERSISTENT impression you've drawn
  // scratch buffers for the pushed pins drawn each frame
  var pX, pY, pP;

  function build() {
    cols = Math.max(2, Math.floor(W / SPACING));
    rows = Math.max(2, Math.floor(H / SPACING));
    ox = (W - (cols - 1) * SPACING) / 2;   // center the grid in the viewport
    oy = (H - (rows - 1) * SPACING) / 2;
    var n = cols * rows;
    var nb = new Float32Array(n);
    // preserve the drawn impression across resizes where the grid size matches
    if (base && base.length === n) nb.set(base);
    base = nb;
    cur = new Float32Array(n);
    pX = new Float32Array(n);
    pY = new Float32Array(n);
    pP = new Float32Array(n);
  }

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = W * DPR; canvas.height = H * DPR;
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    build();
  }

  // smoothstep radial falloff, 1 at the center → 0 at the edge of RADIUS
  function falloff(d) {
    if (d >= RADIUS) return 0;
    var t = 1 - d / RADIUS;
    return t * t * (3 - 2 * t);
  }

  // ---- drawing into the persistent impression -----------------------------
  // stamp the brush at one point: raise (or erase) every pin within RADIUS
  function stamp(x, y, erase) {
    var invS = 1 / SPACING;
    var c0 = Math.max(0, Math.floor((x - RADIUS - ox) * invS));
    var c1 = Math.min(cols - 1, Math.ceil((x + RADIUS - ox) * invS));
    var r0 = Math.max(0, Math.floor((y - RADIUS - oy) * invS));
    var r1 = Math.min(rows - 1, Math.ceil((y + RADIUS - oy) * invS));
    for (var r = r0; r <= r1; r++) {
      var py = oy + r * SPACING, dy = py - y;
      for (var c = c0; c <= c1; c++) {
        var px = ox + c * SPACING, dx = px - x;
        var inf = falloff(Math.sqrt(dx * dx + dy * dy));
        if (inf <= 0) continue;
        var i = r * cols + c;
        if (erase) base[i] = Math.max(0, base[i] - inf);
        else base[i] = Math.max(base[i], inf);
      }
    }
  }
  // a continuous stroke from the last point to the new one (no gaps on fast moves)
  function stroke(x, y, erase) {
    if (px0 === null) { stamp(x, y, erase); }
    else {
      var dx = x - px0, dy = y - py0, dist = Math.hypot(dx, dy);
      var steps = Math.max(1, Math.ceil(dist / (SPACING * 0.5)));
      for (var s = 1; s <= steps; s++) stamp(px0 + dx * s / steps, py0 + dy * s / steps, erase);
    }
    px0 = x; py0 = y;
  }

  // ---- interaction --------------------------------------------------------
  var mx = -9999, my = -9999;          // hover position (transient preview bump)
  var down = false, erasing = false, eraseMode = false;
  var px0 = null, py0 = null;          // last stroke point

  function pointerDown(x, y, shift) {
    down = true; erasing = eraseMode || !!shift; px0 = null;
    mx = x; my = y; stroke(x, y, erasing);
  }
  function pointerMove(x, y) {
    mx = x; my = y;
    if (down) stroke(x, y, erasing);
  }
  function pointerUp() { down = false; px0 = null; }

  canvas.addEventListener("mousedown", function (e) { pointerDown(e.clientX, e.clientY, e.shiftKey); });
  window.addEventListener("mousemove", function (e) { pointerMove(e.clientX, e.clientY); });
  window.addEventListener("mouseup", pointerUp);
  window.addEventListener("mouseout", function (e) { if (!e.relatedTarget) { mx = -9999; my = -9999; } });

  canvas.addEventListener("touchstart", function (e) {
    e.preventDefault(); var t = e.touches[0]; pointerDown(t.clientX, t.clientY, false);
  }, { passive: false });
  canvas.addEventListener("touchmove", function (e) {
    e.preventDefault(); var t = e.touches[0]; pointerMove(t.clientX, t.clientY);
  }, { passive: false });
  canvas.addEventListener("touchend", function (e) {
    e.preventDefault(); pointerUp(); mx = -9999; my = -9999;   // no hover bump on touch
  }, { passive: false });

  // controls
  var clearBtn = document.getElementById("clearBtn");
  if (clearBtn) clearBtn.addEventListener("click", function () { if (base) base.fill(0); });
  var eraseBtn = document.getElementById("eraseBtn");
  if (eraseBtn) eraseBtn.addEventListener("click", function () {
    eraseMode = !eraseMode;
    eraseBtn.setAttribute("aria-pressed", eraseMode ? "true" : "false");
    eraseBtn.textContent = eraseMode ? "Erasing" : "Erase";
  });

  // ---- render -------------------------------------------------------------
  function drawPushedPin(x, y, p) {
    var r = R0 + p * RPUSH;
    var so = 1 + p * 3;                 // shadow offset grows as it rises
    ctx.fillStyle = "rgba(0,0,0," + (0.42 * p).toFixed(3) + ")";
    ctx.beginPath(); ctx.arc(x + so, y + so, r, 0, 6.283); ctx.fill();
    var lx = x - r * 0.34, ly = y - r * 0.34;
    var g = ctx.createRadialGradient(lx, ly, r * 0.12, x, y, r * 1.06);
    var hR = (62 + p * 193) | 0, hG = (62 + p * 184) | 0, hB = (62 + p * 166) | 0;  // warm highlight
    var mR = (50 + p * 150) | 0, mG = (50 + p * 142) | 0, mB = (50 + p * 128) | 0;  // mid metal
    var eR = (26 + p * 74) | 0,  eG = (26 + p * 68) | 0,  eB = (26 + p * 60) | 0;   // dark rim
    g.addColorStop(0, "rgb(" + hR + "," + hG + "," + hB + ")");
    g.addColorStop(0.5, "rgb(" + mR + "," + mG + "," + mB + ")");
    g.addColorStop(1, "rgb(" + eR + "," + eG + "," + eB + ")");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283); ctx.fill();
    if (p > 0.45) {
      ctx.fillStyle = "rgba(255,250,240," + ((p - 0.45) * 0.85).toFixed(3) + ")";
      ctx.beginPath(); ctx.arc(lx, ly, r * 0.2, 0, 6.283); ctx.fill();
    }
  }

  var lastTs = null;
  function frame(ts) {
    var dt = lastTs !== null ? Math.min((ts - lastTs) / 1000, 0.05) : 0.016;
    lastTs = ts;
    var ease = Math.min(1, dt * EASE);
    var hoverOn = !down && mx > -9000;   // show the live preview bump only while hovering

    ctx.fillStyle = "#1a1a1a"; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#363636";
    ctx.beginPath();
    var k = 0, i = 0;
    for (var r = 0; r < rows; r++) {
      var py = oy + r * SPACING;
      for (var c = 0; c < cols; c++, i++) {
        var px = ox + c * SPACING;
        // target = the drawn impression, plus a transient bump under the cursor
        var t = base[i];
        if (hoverOn) {
          var hv = falloff(Math.hypot(px - mx, py - my));
          if (hv > t) t = hv;
        }
        var p = cur[i] + (t - cur[i]) * ease;
        cur[i] = p;
        if (p < 0.02) {
          ctx.moveTo(px + R0, py);
          ctx.arc(px, py, R0, 0, 6.283);
        } else {
          pX[k] = px; pY[k] = py; pP[k] = p; k++;
        }
      }
    }
    ctx.fill();
    for (var j = 0; j < k; j++) drawPushedPin(pX[j], pY[j], pP[j]);

    requestAnimationFrame(frame);
  }

  resize();
  window.addEventListener("resize", resize);
  requestAnimationFrame(frame);
})();
