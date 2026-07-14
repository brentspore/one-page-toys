/* Magnetic Face — a "Wooly Willy" style magnetic drawing toy.
 * A heap of iron filings sits on a cartoon face under glass. Drag the magnetic
 * wand and the filings within its field follow, aligning to it like a magnetic
 * pole — sweep them up onto the face to make hair, beards, brows. Canvas 2D.
 */
(function () {
  "use strict";

  // ---- TUNABLES -----------------------------------------------------------
  var N = 3400;             // number of iron filings
  var R_FRAC = 0.135;       // magnet field radius (fraction of min screen dim)
  var CORE = 12;            // wand-tip indicator radius
  var PULL = 2.1;           // attraction accel near the wand (px/frame^2)
  var CARRY = 0.92;         // how strongly near filings ride along with the wand's motion
  var FRICTION = 0.62;      // filing velocity retention (heavy = they settle fast)
  var SLIVER = 5;           // filing length (px, scaled)
  // -------------------------------------------------------------------------

  var canvas = document.getElementById("canvas");
  var ctx = canvas.getContext("2d");
  var hintEl = document.querySelector(".hint");

  var W, H, DPR, scale;
  var card = {};            // {x,y,w,h,r}
  var face = {};            // {cx,cy,hr}
  var fx, fy, fvx, fvy, fang;   // filing arrays (typed for speed)

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = W * DPR; canvas.height = H * DPR;
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    scale = Math.min(W, H);
    // card fills most of the viewport, capped to a friendly aspect
    var cw = Math.min(W * 0.9, H * 0.78), ch = Math.min(H * 0.9, cw * 1.16);
    cw = Math.min(cw, ch / 1.16);
    card = { x: (W - cw) / 2, y: (H - ch) / 2, w: cw, h: ch, r: cw * 0.06 };
    face = { cx: card.x + cw / 2, cy: card.y + ch * 0.44, hr: cw * 0.30 };
    if (!fx) initFilings(); else clampAll();
  }

  function initFilings() {
    fx = new Float32Array(N); fy = new Float32Array(N);
    fvx = new Float32Array(N); fvy = new Float32Array(N); fang = new Float32Array(N);
    shake();
  }
  function shake() {
    // heap the filings in a reservoir along the bottom of the card
    var bx = card.x + card.w * 0.12, bw = card.w * 0.76;
    var by = card.y + card.h * 0.80, bh = card.h * 0.14;
    for (var i = 0; i < N; i++) {
      fx[i] = bx + Math.random() * bw;
      fy[i] = by + Math.random() * bh + Math.random() * bh * 0.4;
      fvx[i] = 0; fvy[i] = 0; fang[i] = Math.random() * Math.PI;
    }
  }
  function clampAll() { for (var i = 0; i < N; i++) clamp(i); }
  function clamp(i) {
    var pad = 3;
    if (fx[i] < card.x + pad) { fx[i] = card.x + pad; fvx[i] *= -0.3; }
    if (fx[i] > card.x + card.w - pad) { fx[i] = card.x + card.w - pad; fvx[i] *= -0.3; }
    if (fy[i] < card.y + pad) { fy[i] = card.y + pad; fvy[i] *= -0.3; }
    if (fy[i] > card.y + card.h - pad) { fy[i] = card.y + card.h - pad; fvy[i] *= -0.3; }
  }

  // ---- simulation ---------------------------------------------------------
  var pressing = false, mx = 0, my = 0, pmx = 0, pmy = 0, mvx = 0, mvy = 0, moveAmt = 0;
  function simulate() {
    var R = scale * R_FRAC, R2 = R * R;
    // how far the wand moved this frame — near filings ride along with it (grab & carry)
    mvx = mx - pmx; mvy = my - pmy; pmx = mx; pmy = my;
    var dragged = 0;
    for (var i = 0; i < N; i++) {
      if (pressing) {
        var dx = mx - fx[i], dy = my - fy[i], d2 = dx * dx + dy * dy;
        if (d2 < R2) {
          var d = Math.sqrt(d2) + 0.001;
          var t = 1 - d / R;                    // 0 at the field edge → 1 at the wand
          var pull = PULL * t;                  // attraction, stronger near the wand
          fvx[i] += (dx / d) * pull;
          fvy[i] += (dy / d) * pull;
          // carry: the closer to the wand, the more the filing inherits its motion,
          // so a drag sweeps the whole clump instead of leaving it behind
          var carry = CARRY * t * t;
          fvx[i] += mvx * carry;
          fvy[i] += mvy * carry;
          fang[i] = Math.atan2(dy, dx);         // slivers align to the pole (field lines)
          dragged++;
        }
      }
      fvx[i] *= FRICTION; fvy[i] *= FRICTION;
      fx[i] += fvx[i]; fy[i] += fvy[i];
      clamp(i);
    }
    moveAmt = dragged;
  }

  // ---- render -------------------------------------------------------------
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function drawFace() {
    var c = face.cx, cyF = face.cy, hr = face.hr;
    // head
    var hg = ctx.createRadialGradient(c - hr * 0.3, cyF - hr * 0.35, hr * 0.2, c, cyF, hr * 1.05);
    hg.addColorStop(0, "#ffe0c0"); hg.addColorStop(0.7, "#f6c69c"); hg.addColorStop(1, "#e0a878");
    // ears
    ctx.fillStyle = "#f0b98c";
    ear(c - hr * 0.98, cyF, hr * 0.22); ear(c + hr * 0.98, cyF, hr * 0.22);
    ctx.strokeStyle = "rgba(150,96,60,0.5)"; ctx.lineWidth = 2;
    ctx.fillStyle = hg;
    ctx.beginPath(); ctx.arc(c, cyF, hr, 0, 6.283); ctx.fill(); ctx.stroke();
    // cheeks
    ctx.fillStyle = "rgba(240,130,120,0.35)";
    blob(c - hr * 0.5, cyF + hr * 0.28, hr * 0.2); blob(c + hr * 0.5, cyF + hr * 0.28, hr * 0.2);
    // eyes
    eye(c - hr * 0.36, cyF - hr * 0.12, hr * 0.16);
    eye(c + hr * 0.36, cyF - hr * 0.12, hr * 0.16);
    // nose
    var ng = ctx.createRadialGradient(c - hr * 0.06, cyF + hr * 0.06, hr * 0.03, c, cyF + hr * 0.14, hr * 0.24);
    ng.addColorStop(0, "#ffbfa0"); ng.addColorStop(1, "#e08862");
    ctx.fillStyle = ng; ctx.strokeStyle = "rgba(150,80,52,0.5)"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(c, cyF + hr * 0.18, hr * 0.19, hr * 0.22, 0, 0, 6.283); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.5)"; ctx.beginPath(); ctx.ellipse(c - hr * 0.06, cyF + hr * 0.1, hr * 0.05, hr * 0.06, 0, 0, 6.283); ctx.fill();
    // smile
    ctx.strokeStyle = "#a63a2e"; ctx.lineWidth = hr * 0.055; ctx.lineCap = "round";
    ctx.beginPath(); ctx.arc(c, cyF + hr * 0.34, hr * 0.44, 0.28 * Math.PI, 0.72 * Math.PI); ctx.stroke();
  }
  function ear(x, y, r) { ctx.beginPath(); ctx.ellipse(x, y, r * 0.7, r, 0, 0, 6.283); ctx.fill(); }
  function blob(x, y, r) { ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.72, 0, 0, 6.283); ctx.fill(); }
  function eye(x, y, r) {
    ctx.fillStyle = "#fff"; ctx.strokeStyle = "rgba(120,80,60,0.4)"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.ellipse(x, y, r, r * 1.12, 0, 0, 6.283); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#2a2320"; ctx.beginPath(); ctx.arc(x + r * 0.12, y + r * 0.14, r * 0.5, 0, 6.283); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(x - r * 0.06, y - r * 0.06, r * 0.16, 0, 6.283); ctx.fill();
  }

  function render() {
    ctx.fillStyle = "#cdbf9f"; ctx.fillRect(0, 0, W, H);
    // card
    ctx.save();
    ctx.shadowColor = "rgba(40,26,10,0.35)"; ctx.shadowBlur = 30; ctx.shadowOffsetY = 12;
    roundRect(card.x, card.y, card.w, card.h, card.r);
    ctx.fillStyle = "#f2e6cc"; ctx.fill();
    ctx.restore();
    // red border
    roundRect(card.x + card.w * 0.02, card.y + card.h * 0.017, card.w * 0.96, card.h * 0.966, card.r * 0.8);
    ctx.lineWidth = Math.max(5, card.w * 0.02); ctx.strokeStyle = "#c0392b"; ctx.stroke();

    ctx.save(); roundRect(card.x, card.y, card.w, card.h, card.r); ctx.clip();
    drawFace();

    // iron filings — one batched dark stroke, then a faint metallic highlight pass
    var L = SLIVER * (scale / 900);
    ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(26,28,32,0.92)"; ctx.lineWidth = Math.max(1.3, scale * 0.0018);
    ctx.beginPath();
    for (var i = 0; i < N; i++) {
      var ca = Math.cos(fang[i]) * L, sa = Math.sin(fang[i]) * L;
      ctx.moveTo(fx[i] - ca, fy[i] - sa); ctx.lineTo(fx[i] + ca, fy[i] + sa);
    }
    ctx.stroke();
    ctx.strokeStyle = "rgba(150,158,170,0.35)"; ctx.lineWidth = Math.max(0.6, scale * 0.0007);
    ctx.beginPath();
    for (i = 0; i < N; i += 2) {
      var ca2 = Math.cos(fang[i]) * L * 0.5, sa2 = Math.sin(fang[i]) * L * 0.5;
      ctx.moveTo(fx[i] - ca2, fy[i] - sa2 - 0.6); ctx.lineTo(fx[i] + ca2, fy[i] + sa2 - 0.6);
    }
    ctx.stroke();

    // glass dome sheen
    var gl = ctx.createRadialGradient(face.cx - card.w * 0.18, card.y + card.h * 0.16, 0, face.cx, face.cy, card.w * 0.75);
    gl.addColorStop(0, "rgba(255,255,255,0.16)"); gl.addColorStop(0.5, "rgba(255,255,255,0.03)"); gl.addColorStop(1, "rgba(70,50,30,0.14)");
    ctx.fillStyle = gl; ctx.fillRect(card.x, card.y, card.w, card.h);
    ctx.restore();

    // wand halo
    if (pressing) {
      var R = scale * R_FRAC;
      var wg = ctx.createRadialGradient(mx, my, 0, mx, my, R);
      wg.addColorStop(0, "rgba(120,150,200,0.18)"); wg.addColorStop(0.7, "rgba(120,150,200,0.05)"); wg.addColorStop(1, "rgba(120,150,200,0)");
      ctx.fillStyle = wg; ctx.beginPath(); ctx.arc(mx, my, R, 0, 6.283); ctx.fill();
      ctx.strokeStyle = "rgba(80,90,110,0.5)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(mx, my, CORE, 0, 6.283); ctx.stroke();
    }
  }

  var lastTs = null;
  function frame(ts) { lastTs = ts; simulate(); if (pressing) shimmer(moveAmt); render(); requestAnimationFrame(frame); }

  // ---- input --------------------------------------------------------------
  function pdown(x, y) { unlock(); pressing = true; mx = pmx = x; my = pmy = y; if (hintEl) hintEl.classList.add("is-hidden"); }
  function pmove(x, y) { mx = x; my = y; }
  function pup() { pressing = false; if (shGain && actx) shGain.gain.setTargetAtTime(0, actx.currentTime, 0.05); }
  canvas.addEventListener("mousedown", function (e) { pdown(e.clientX, e.clientY); });
  window.addEventListener("mousemove", function (e) { pmove(e.clientX, e.clientY); });
  window.addEventListener("mouseup", pup);
  canvas.addEventListener("touchstart", function (e) { e.preventDefault(); var t = e.touches[0]; pdown(t.clientX, t.clientY); }, { passive: false });
  canvas.addEventListener("touchmove", function (e) { e.preventDefault(); var t = e.touches[0]; pmove(t.clientX, t.clientY); }, { passive: false });
  canvas.addEventListener("touchend", function (e) { e.preventDefault(); pup(); }, { passive: false });

  document.getElementById("shakeBtn").addEventListener("click", function () { shake(); });

  // ---- audio (soft magnetic shimmer while dragging) -----------------------
  var actx = null, master = null, outGain = null, muted = false, noiseBuf = null, shNode = null, shGain = null, shFilt = null;
  function unlock() {
    if (actx) { if (actx.state === "suspended") actx.resume(); return; }
    try {
      actx = new (window.AudioContext || window.webkitAudioContext)();
      var b = actx.createBuffer(1, 1, 22050), s = actx.createBufferSource(); s.buffer = b; s.connect(actx.destination); s.start(0);
      outGain = actx.createGain(); outGain.gain.value = muted ? 0 : 1; outGain.connect(actx.destination);
      master = actx.createGain(); master.gain.value = 0.7; master.connect(outGain);
      noiseBuf = actx.createBuffer(1, actx.sampleRate, actx.sampleRate);
      var nd = noiseBuf.getChannelData(0); for (var i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
      shNode = actx.createBufferSource(); shNode.buffer = noiseBuf; shNode.loop = true;
      shFilt = actx.createBiquadFilter(); shFilt.type = "bandpass"; shFilt.frequency.value = 5200; shFilt.Q.value = 0.9;
      shGain = actx.createGain(); shGain.gain.value = 0;
      shNode.connect(shFilt); shFilt.connect(shGain); shGain.connect(master); shNode.start(0);
    } catch (e) { actx = null; }
  }
  var lastMX = 0, lastMY = 0;
  function shimmer(count) {
    if (!actx || !shGain) return;
    var spd = Math.hypot(mx - lastMX, my - lastMY); lastMX = mx; lastMY = my;
    var v = Math.min(1, (spd * 0.02) * (count > 0 ? 1 : 0.15));
    shGain.gain.setTargetAtTime(v * 0.05, actx.currentTime, 0.05);
    shFilt.frequency.setTargetAtTime(4200 + spd * 30, actx.currentTime, 0.06);
  }
  var soundBtn = document.getElementById("soundBtn");
  soundBtn.addEventListener("click", function () {
    muted = !muted; unlock();
    if (outGain) outGain.gain.setTargetAtTime(muted ? 0 : 1, actx.currentTime, 0.02);
    soundBtn.textContent = muted ? "Sound: off" : "Sound: on";
    soundBtn.setAttribute("aria-pressed", muted ? "true" : "false");
  });

  // ---- boot ---------------------------------------------------------------
  resize(); window.addEventListener("resize", resize);
  requestAnimationFrame(frame);
})();
