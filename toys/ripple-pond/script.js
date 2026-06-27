(function () {
  "use strict";

  var canvas = document.getElementById("canvas");
  var ctx = canvas.getContext("2d");

  // low-res offscreen the water grid renders into, then scaled up (soft + cheap)
  var off = document.createElement("canvas");
  var octx = off.getContext("2d");

  var W, H, CELL = 5, gw, gh, a, b, img, moonX, moonY, moonR;

  function resize() {
    W = canvas.width = window.innerWidth;
    H = canvas.height = window.innerHeight;
    gw = Math.ceil(W / CELL) + 1;
    gh = Math.ceil(H / CELL) + 1;
    off.width = gw; off.height = gh;
    a = new Float32Array(gw * gh);
    b = new Float32Array(gw * gh);
    img = octx.createImageData(gw, gh);
    moonX = gw * 0.5; moonY = gh * 0.15; moonR = gh * 0.04;
  }
  resize();
  window.addEventListener("resize", resize);

  // ---- water simulation (damped wave equation) ---------------------------
  // 9-point Laplacian couples the diagonal neighbours, which kills the
  // checkerboard sublattice instability the simple 4-point scheme suffers.
  var DAMP = 0.9955, K = 0.42;
  function stepWater() {
    var w = gw;
    for (var y = 1; y < gh - 1; y++) {
      var row = y * w;
      for (var x = 1; x < w - 1; x++) {
        var i = row + x, c = a[i];
        var lap = 0.5 * (a[i - 1] + a[i + 1] + a[i - w] + a[i + w])
                + 0.25 * (a[i - w - 1] + a[i - w + 1] + a[i + w - 1] + a[i + w + 1])
                - 3 * c;
        b[i] = (2 * c - b[i] + K * lap) * DAMP;
      }
    }
    var t = a; a = b; b = t;
  }

  function drop(px, py, amp, rad) {
    var cx = px / CELL, cy = py / CELL;
    rad = rad || 2;
    for (var dy = -rad; dy <= rad; dy++) {
      for (var dx = -rad; dx <= rad; dx++) {
        var gx = Math.round(cx + dx), gy = Math.round(cy + dy);
        if (gx < 1 || gy < 1 || gx >= gw - 1 || gy >= gh - 1) continue;
        var d = Math.hypot(dx, dy);
        if (d > rad) continue;
        var fall = Math.cos((d / rad) * Math.PI * 0.5);
        a[gy * gw + gx] -= amp * fall;     // negative = depression that springs back
      }
    }
  }

  // ---- render the moonlit water ------------------------------------------
  function renderWater() {
    var data = img.data, w = gw, h = gh;
    var trailW = gw * 0.085;
    for (var y = 0; y < h; y++) {
      var row = y * w;
      var topFade = 1 - y / h;                       // moon reflection strongest up top
      for (var x = 0; x < w; x++) {
        var i = row + x;
        var p = i * 4;

        // --- base moonlit water ---
        var depth = y / h;                           // darker toward bottom
        var rB = 8 + depth * 4, gB = 28 - depth * 6, bB = 40 - depth * 8;

        // moon reflection trail (vertical shimmer column)
        var dxm = (x - moonX) / trailW;
        var trail = Math.exp(-dxm * dxm) * topFade * topFade;
        rB += trail * 38; gB += trail * 52; bB += trail * 66;

        // the moon disc itself
        var dm = Math.hypot(x - moonX, y - moonY);
        var disc = Math.exp(-(dm * dm) / (moonR * moonR * 2.2));
        rB += disc * 150; gB += disc * 165; bB += disc * 185;

        // --- ripple lighting from surface slope ---
        var gx = (x > 0 && x < w - 1) ? a[i - 1] - a[i + 1] : 0;
        var gy = (y > 0 && y < h - 1) ? a[i - w] - a[i + w] : 0;
        var sparkleBoost = 1 + trail * 2.4 + disc * 3;  // ripples sparkle inside the moonlight
        var lume = gy * 3.0 * sparkleBoost;             // top-lit slopes
        var spec = (Math.abs(gx) + Math.abs(gy)) * 1.5 * sparkleBoost;
        rB += lume * 0.7 + spec * 0.8;
        gB += lume * 0.9 + spec * 0.92;
        bB += lume * 1.0 + spec * 1.0;

        data[p] = rB < 0 ? 0 : rB > 255 ? 255 : rB;
        data[p + 1] = gB < 0 ? 0 : gB > 255 ? 255 : gB;
        data[p + 2] = bB < 0 ? 0 : bB > 255 ? 255 : bB;
        data[p + 3] = 255;
      }
    }
    octx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(off, 0, 0, gw, gh, 0, 0, W, H);
  }

  // ---- koi ----------------------------------------------------------------
  var koi = [];
  var KOI_KINDS = ["orange", "koi", "gold", "koi", "red"];
  function seedKoi() {
    koi.length = 0;
    var n = Math.max(3, Math.min(5, Math.round(W / 360)));
    for (var i = 0; i < n; i++) {
      var kind = KOI_KINDS[i % KOI_KINDS.length];
      var patches = [];
      if (kind === "koi") {
        var pc = 2 + (Math.random() < 0.5 ? 1 : 0);
        for (var p = 0; p < pc; p++) patches.push({
          dx: Math.random() * 1.1 - 0.45, dy: (Math.random() - 0.5) * 0.4,
          r: 0.2 + Math.random() * 0.16, red: Math.random() < 0.5
        });
      }
      koi.push({
        x: Math.random() * W, y: H * (0.32 + Math.random() * 0.56),
        ang: Math.random() * Math.PI * 2,
        spd: 15 + Math.random() * 11,
        size: 30 + Math.random() * 22,
        kind: kind, patches: patches,
        wob: Math.random() * Math.PI * 2,
        turn: 0, dart: 0, flick: 0
      });
    }
  }

  function updateKoi(dt) {
    for (var i = 0; i < koi.length; i++) {
      var k = koi[i];
      k.wob += dt * 6;
      k.ang += k.turn * dt + Math.sin(k.wob) * 0.16 * dt * 6;
      k.turn *= 0.96;
      var v = k.spd * (1 + k.dart * 3);
      k.dart *= 0.94;
      k.x += Math.cos(k.ang) * v * dt;
      k.y += Math.sin(k.ang) * v * dt;
      // steer away from edges
      var m = 70;
      if (k.x < m) k.turn += 1.4 * dt * 6;
      if (k.x > W - m) k.turn -= 1.4 * dt * 6;
      if (k.y < H * 0.28) k.turn += 1.2 * dt * 6;
      if (k.y > H - m) k.turn -= 1.2 * dt * 6;
      if (k.x < -60) k.x = -60; if (k.x > W + 60) k.x = W + 60;
      if (k.y < -60) k.y = -60; if (k.y > H + 60) k.y = H + 60;
      // occasional tail-flick ripple
      k.flick -= dt;
      if (k.flick <= 0) { drop(k.x - Math.cos(k.ang) * k.size, k.y - Math.sin(k.ang) * k.size, 7, 2); k.flick = 0.5 + Math.random() * 1.4; }
    }
  }

  function kindRGB(kind) {
    if (kind === "orange") return [255, 122, 46];
    if (kind === "gold") return [240, 184, 74];
    if (kind === "red") return [212, 56, 38];
    return [248, 240, 232];                          // koi white
  }
  function rgba(c, a) { return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + a + ")"; }
  function shade(c, f) {
    return "rgb(" + Math.min(255, c[0] * f | 0) + "," + Math.min(255, c[1] * f | 0) + "," + Math.min(255, c[2] * f | 0) + ")";
  }

  function drawKoi() {
    for (var i = 0; i < koi.length; i++) {
      var k = koi[i], L = k.size, base = kindRGB(k.kind);
      var swish = Math.sin(k.wob) * 0.5, bend = Math.sin(k.wob) * 0.12;
      ctx.save();
      ctx.translate(k.x, k.y);
      ctx.rotate(k.ang);
      ctx.scale(1, 0.64);                            // top-down foreshorten

      // soft shadow beneath = depth in the water
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = "#000";
      ctx.beginPath(); ctx.ellipse(-2, 5, L * 0.7, L * 0.34, 0, 0, Math.PI * 2); ctx.fill();

      ctx.globalAlpha = 0.8;
      var tb = -L * 0.55;

      // flowing tail fin
      ctx.fillStyle = rgba(base, 0.55);
      ctx.beginPath();
      ctx.moveTo(tb, 0);
      ctx.quadraticCurveTo(-L * 0.95, (-0.34 + swish) * L, -L * 1.18, (-0.16 + swish) * L);
      ctx.quadraticCurveTo(-L * 0.82, swish * L * 0.3, -L * 1.06, (0.3 + swish) * L);
      ctx.quadraticCurveTo(-L * 0.95, (0.38 + swish) * L, tb, 0);
      ctx.fill();

      // pectoral fins
      var fa = 0.5 + Math.sin(k.wob * 1.3) * 0.18;
      ctx.fillStyle = rgba(base, 0.5);
      ctx.save(); ctx.translate(L * 0.12, L * 0.24); ctx.rotate(fa);
      ctx.beginPath(); ctx.ellipse(0, L * 0.18, L * 0.1, L * 0.26, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      ctx.save(); ctx.translate(L * 0.12, -L * 0.24); ctx.rotate(-fa);
      ctx.beginPath(); ctx.ellipse(0, -L * 0.18, L * 0.1, L * 0.26, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();

      // body
      var grad = ctx.createLinearGradient(0, -L * 0.4, 0, L * 0.4);
      grad.addColorStop(0, shade(base, 1.14));
      grad.addColorStop(0.5, shade(base, 1.0));
      grad.addColorStop(1, shade(base, 0.78));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(L * 0.92, 0);
      ctx.quadraticCurveTo(L * 0.5, -L * 0.42, -L * 0.1, (-0.34 + bend) * L);
      ctx.quadraticCurveTo(-L * 0.45, -L * 0.18, tb, -L * 0.06);
      ctx.lineTo(tb, L * 0.06);
      ctx.quadraticCurveTo(-L * 0.45, L * 0.18, -L * 0.1, (0.34 + bend) * L);
      ctx.quadraticCurveTo(L * 0.5, L * 0.42, L * 0.92, 0);
      ctx.closePath();
      ctx.fill();

      // koi colour patches (clipped to the body)
      if (k.kind === "koi" && k.patches.length) {
        ctx.save(); ctx.clip();
        for (var p = 0; p < k.patches.length; p++) {
          var pt = k.patches[p];
          ctx.fillStyle = pt.red ? "rgba(210,52,34,0.9)" : "rgba(255,120,42,0.9)";
          ctx.beginPath(); ctx.ellipse(pt.dx * L, pt.dy * L, pt.r * L, pt.r * L * 0.78, 0, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
      }

      // spine sheen + eyes
      ctx.globalAlpha = 0.42;
      ctx.strokeStyle = "rgba(255,255,255,0.6)"; ctx.lineWidth = L * 0.05;
      ctx.beginPath(); ctx.moveTo(L * 0.62, 0); ctx.quadraticCurveTo(0, -L * 0.03, tb, 0); ctx.stroke();
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = "rgba(18,14,10,0.85)";
      ctx.beginPath(); ctx.arc(L * 0.62, -L * 0.13, L * 0.05, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(L * 0.62, L * 0.13, L * 0.05, 0, Math.PI * 2); ctx.fill();

      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  // ---- lily pads ----------------------------------------------------------
  var pads = [];
  function seedPads() {
    pads.length = 0;
    var n = Math.max(3, Math.min(6, Math.round(W / 320)));
    for (var i = 0; i < n; i++) {
      pads.push({
        x: (0.1 + Math.random() * 0.8) * W,
        y: (0.2 + Math.random() * 0.7) * H,
        r: 30 + Math.random() * 26,
        rot: Math.random() * Math.PI * 2,
        bob: Math.random() * Math.PI * 2,
        flower: Math.random() < 0.4
      });
    }
  }

  function drawPads(t) {
    for (var i = 0; i < pads.length; i++) {
      var pd = pads[i];
      var bx = pd.x + Math.sin(t * 0.6 + pd.bob) * 3;
      var by = pd.y + Math.cos(t * 0.5 + pd.bob) * 3;
      ctx.save();
      ctx.translate(bx, by);
      ctx.rotate(pd.rot);
      ctx.scale(1, 0.62);
      // shadow under the pad
      ctx.fillStyle = "rgba(0,0,0,0.28)";
      ctx.beginPath(); ctx.ellipse(3, 6, pd.r, pd.r, 0, 0, Math.PI * 2); ctx.fill();
      // pad body with a wedge notch
      var notch = 0.5;
      var gp = ctx.createRadialGradient(-pd.r * 0.25, -pd.r * 0.25, pd.r * 0.1, 0, 0, pd.r);
      gp.addColorStop(0, "#2f7d4e");
      gp.addColorStop(0.7, "#1d5a37");
      gp.addColorStop(1, "#123e26");
      ctx.fillStyle = gp;
      ctx.beginPath();
      ctx.arc(0, 0, pd.r, notch / 2, Math.PI * 2 - notch / 2);
      ctx.lineTo(0, 0);
      ctx.closePath();
      ctx.fill();
      // radial veins + rim light
      ctx.strokeStyle = "rgba(120,200,150,0.18)";
      ctx.lineWidth = 1;
      for (var v = 0; v < 7; v++) {
        var ang = notch / 2 + (v / 6) * (Math.PI * 2 - notch);
        ctx.beginPath(); ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(ang) * pd.r * 0.92, Math.sin(ang) * pd.r * 0.92); ctx.stroke();
      }
      ctx.strokeStyle = "rgba(160,230,180,0.25)";
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(0, 0, pd.r - 1, notch / 2, Math.PI * 2 - notch / 2); ctx.stroke();
      ctx.restore();
      // lotus flower
      if (pd.flower) {
        ctx.save();
        ctx.translate(bx - pd.r * 0.2, by - pd.r * 0.2);
        for (var f = 0; f < 8; f++) {
          var fa = (f / 8) * Math.PI * 2 + pd.rot;
          ctx.save(); ctx.rotate(fa);
          ctx.fillStyle = f % 2 ? "rgba(255,182,210,0.92)" : "rgba(255,210,228,0.92)";
          ctx.beginPath();
          ctx.ellipse(0, -pd.r * 0.22, pd.r * 0.12, pd.r * 0.26, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
        ctx.fillStyle = "#ffe6a0";
        ctx.beginPath(); ctx.arc(0, 0, pd.r * 0.13, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
    }
  }

  seedKoi(); seedPads();
  window.addEventListener("resize", function () { seedKoi(); seedPads(); });

  // ---- audio --------------------------------------------------------------
  var actx = null, ambGain = null, noiseBuf = null;

  function makeNoise() {
    var len = Math.floor(actx.sampleRate * 2.5);
    noiseBuf = actx.createBuffer(1, len, actx.sampleRate);
    var d = noiseBuf.getChannelData(0), last = 0;
    for (var i = 0; i < len; i++) {
      var w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;        // brown-ish noise = soft water bed
      d[i] = last * 3.4;
    }
  }

  function noiseLayer(lpType, freq, q, baseGain, lfoRate, lfoDepth, rate) {
    var src = actx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    if (rate) src.playbackRate.value = rate;
    var f = actx.createBiquadFilter(); f.type = lpType; f.frequency.value = freq; f.Q.value = q;
    var g = actx.createGain(); g.gain.value = baseGain;
    src.connect(f); f.connect(g); g.connect(ambGain);
    if (lfoRate) {
      var lfo = actx.createOscillator(); lfo.frequency.value = lfoRate;
      var lfoG = actx.createGain(); lfoG.gain.value = lfoDepth;
      lfo.connect(lfoG); lfoG.connect(g.gain); lfo.start();
    }
    src.start();
    return f;
  }

  // a single soft water droplet (rising "tink") — for distant trickles
  function drip(t, freq, vol, pan) {
    var o = actx.createOscillator(); o.type = "sine";
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(freq * 1.9, t + 0.08);
    var g = actx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    var lp = actx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 2300;
    o.connect(lp);
    if (actx.createStereoPanner) {
      var p = actx.createStereoPanner(); p.pan.value = pan;
      lp.connect(g); g.connect(p); p.connect(ambGain);
    } else { lp.connect(g); g.connect(ambGain); }
    o.start(t); o.stop(t + 0.26);
  }

  // an occasional little run of drips — a water trickle off to one side
  function trickle() {
    if (!actx) return;
    var t = actx.currentTime;
    var n = 2 + (Math.random() * 4 | 0);
    var pan = Math.random() * 1.4 - 0.7;
    var f = 560 + Math.random() * 520;
    for (var i = 0; i < n; i++) {
      drip(t + i * (0.05 + Math.random() * 0.1), f * (0.82 + Math.random() * 0.45),
        0.028 + Math.random() * 0.022, pan + (Math.random() - 0.5) * 0.2);
    }
  }
  var trickleTimer = null;
  function scheduleTrickle() {
    trickleTimer = setTimeout(function () { trickle(); scheduleTrickle(); }, 3500 + Math.random() * 8000);
  }

  function startAmbient() {
    // soft water hiss bed
    noiseLayer("lowpass", 560, 0.4, 0.045, 0.08, 0.018, 1);
    // low river body / rumble
    noiseLayer("lowpass", 150, 0.7, 0.06, 0.05, 0.02, 0.6);
    // a moving "burble" band that sweeps to suggest flowing water
    var bp = noiseLayer("bandpass", 700, 3.5, 0.038, 0, 0, 1.4);
    var sweep = actx.createOscillator(); sweep.type = "sine"; sweep.frequency.value = 0.13;
    var sweepG = actx.createGain(); sweepG.gain.value = 340;
    sweep.connect(sweepG); sweepG.connect(bp.frequency); sweep.start();
    // distant trickles every so often
    scheduleTrickle();
  }

  function unlock() {
    if (actx) return;
    try {
      actx = new (window.AudioContext || window.webkitAudioContext)();
      var bb = actx.createBuffer(1, 1, 22050);
      var s = actx.createBufferSource(); s.buffer = bb; s.connect(actx.destination); s.start(0);
      ambGain = actx.createGain(); ambGain.gain.value = 0.0001; ambGain.connect(actx.destination);
      makeNoise(); startAmbient();
      ambGain.gain.exponentialRampToValueAtTime(1, actx.currentTime + 3.5);  // ease the ambience in
    } catch (e) { actx = null; }
  }

  // a rock dropping into water: deep impact thud + rising cavity "bloop" + splash
  function splash(strength) {
    if (!actx) return;
    if (actx.state === "suspended") actx.resume();
    strength = strength || 1;
    var t = actx.currentTime;
    var out = actx.createGain(); out.gain.value = 1; out.connect(actx.destination);

    // rising underwater "bloop" (cavity resonance) — the signature water-plunk
    var o = actx.createOscillator(); o.type = "sine";
    var f0 = 110 + Math.random() * 30;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f0 * 2.4, t + 0.14);
    var og = actx.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.34 * strength, t + 0.015);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    o.connect(og); og.connect(out);
    o.start(t); o.stop(t + 0.5);

    // deep impact thud (weight of the rock)
    var o2 = actx.createOscillator(); o2.type = "sine";
    o2.frequency.setValueAtTime(150, t);
    o2.frequency.exponentialRampToValueAtTime(58, t + 0.12);
    var o2g = actx.createGain();
    o2g.gain.setValueAtTime(0.0001, t);
    o2g.gain.exponentialRampToValueAtTime(0.26 * strength, t + 0.01);
    o2g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    o2.connect(o2g); o2g.connect(out);
    o2.start(t); o2.stop(t + 0.34);

    // splash noise burst (the "sploosh" at the surface)
    if (noiseBuf) {
      var ns = actx.createBufferSource(); ns.buffer = noiseBuf; ns.playbackRate.value = 2.6;
      var nlp = actx.createBiquadFilter(); nlp.type = "bandpass"; nlp.frequency.value = 1700; nlp.Q.value = 0.6;
      var ng = actx.createGain();
      ng.gain.setValueAtTime(0.0001, t);
      ng.gain.exponentialRampToValueAtTime(0.13 * strength, t + 0.004);
      ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      ns.connect(nlp); nlp.connect(ng); ng.connect(out);
      ns.start(t); ns.stop(t + 0.18);
    }
  }

  // ---- interaction --------------------------------------------------------
  var lastDx = 0, lastDy = 0, lastT = 0, downAt = 0;
  function disturb(px, py, amp, rad) {
    drop(px, py, amp, rad);
    // startle nearby koi
    for (var i = 0; i < koi.length; i++) {
      var k = koi[i], d = Math.hypot(k.x - px, k.y - py);
      if (d < 140) { k.dart = Math.max(k.dart, 1); k.ang = Math.atan2(k.y - py, k.x - px) + (Math.random() - 0.5) * 0.6; }
    }
  }
  function pointerDown(px, py) {
    unlock();
    disturb(px, py, 90, 2);
    splash(1);
    lastDx = px; lastDy = py; downAt = nowish;
  }
  function pointerMove(px, py) {
    var d = Math.hypot(px - lastDx, py - lastDy);
    if (d > 14) {
      disturb(px, py, 42, 2);
      if (nowish - lastT > 0.12) { splash(0.4); lastT = nowish; }
      lastDx = px; lastDy = py;
    }
  }
  canvas.addEventListener("mousedown", function (e) { pointerDown(e.clientX, e.clientY); });
  window.addEventListener("mousemove", function (e) { if (e.buttons & 1) pointerMove(e.clientX, e.clientY); });
  canvas.addEventListener("touchstart", function (e) { e.preventDefault(); var t = e.touches[0]; pointerDown(t.clientX, t.clientY); }, { passive: false });
  canvas.addEventListener("touchmove", function (e) { e.preventDefault(); var t = e.touches[0]; pointerMove(t.clientX, t.clientY); }, { passive: false });

  // ---- loop ---------------------------------------------------------------
  var lastTs = null, nowish = 0, acc = 0;
  function render(ts) {
    var dt = lastTs !== null ? Math.min((ts - lastTs) / 1000, 0.05) : 0.016;
    lastTs = ts; nowish += dt;
    // fixed-step the water sim for stability
    acc += dt;
    var steps = 0;
    while (acc > 1 / 60 && steps < 3) { stepWater(); acc -= 1 / 60; steps++; }
    updateKoi(dt);
    renderWater();
    drawKoi();
    drawPads(nowish);
    requestAnimationFrame(render);
  }
  requestAnimationFrame(render);
})();
