/* Rain Stick — tip the tube and hundreds of beads cascade past the pins in a
 * soft shower of rain. Tilt (device motion) or drag to rotate the stick; flip
 * it for the full downpour. The sound is granular: a filtered-noise rain bed
 * whose density follows the flow, plus velocity-scaled woody tick grains struck
 * from the actual bead-on-pin collisions.
 * Vanilla Canvas 2D + Web Audio (fully synthesized — no samples).
 */
(function () {
  "use strict";

  // ---- TUNABLES -----------------------------------------------------------
  var N_BEADS = 460;            // beads in the tube (small + many → a fine, long shower)
  var G = 1150;                 // gravity (px/s²)
  var MAX_GRAINS = 24;          // audible tick grains per frame (rest are visual only)
  // -------------------------------------------------------------------------

  var TAU = Math.PI * 2;
  var canvas = document.getElementById("canvas");
  var ctx = canvas.getContext("2d");
  var hintEl = document.querySelector(".hint");

  var W, H, DPR, cx, cy;
  var TL, TW, CAP, R_IN;        // tube length, width, wood-cap length, interior radius pad
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // tube orientation: `tilt` = screen rotation of the tube's long axis (0 = vertical,
  // "far" end at top). gravity-local derives from it, so beads pour when tilted.
  var tilt = 0.32, targetTilt = 0.32, prevTilt = 0.32;
  var dragging = false, grabAng = 0, grabTilt = 0, downX = 0, downY = 0, downT = 0, moved = false;
  var gyroOn = false, gyroSign = 1;

  var beads = [], pins = [], pinBuckets = [], pinTop = 0, pinRowGap = 1, motes = [], flashes = [];
  var hits = [];                // collisions this frame → audio
  var activity = 0;             // smoothed flow amount 0..1

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function rnd(a, b) { return a + Math.random() * (b - a); }

  var BEAD_HUES = [38, 44, 30, 22, 46, 40, 15, 200, 338, 32]; // warm sand/amber + a few jewel accents

  // ---- layout -------------------------------------------------------------
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = W * DPR; canvas.height = H * DPR;
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    cx = W / 2; cy = H / 2;

    var m = Math.min(W, H);
    TL = clamp(m * 0.8, 320, 760);
    TW = clamp(TL * 0.15, 42, 74);
    CAP = TW * 0.62;
    R_IN = 3;

    buildPins();
    if (!beads.length) seedBeads(); else reflowBeads();
    seedMotes();
    buildSky();
  }

  function seedBeads() {
    beads = [];
    for (var i = 0; i < N_BEADS; i++) {
      var r = rnd(2.3, 3.7);
      beads.push({
        u: rnd(TW * 0.18, TW * 0.82),
        v: rnd(CAP, TL - CAP),
        vu: 0, vv: 0,
        r: r, pm: 3.0 / r,                 // pitch multiplier: smaller bead rings higher
        hue: BEAD_HUES[(Math.random() * BEAD_HUES.length) | 0],
        awake: true, slp: 0
      });
    }
  }
  function reflowBeads() {
    for (var i = 0; i < beads.length; i++) {
      beads[i].u = clamp(beads[i].u, R_IN + beads[i].r, TW - R_IN - beads[i].r);
      beads[i].v = clamp(beads[i].v, CAP, TL - CAP);
    }
  }

  // staggered pin lattice — beads can't free-fall, they zigzag past the pins (that's the
  // long shower). Denser now for the smaller beads; bucketed by row so the per-bead
  // collision check stays O(1) no matter how many pins there are.
  function buildPins() {
    pins = []; pinBuckets = [];
    pinRowGap = TW * 0.25;                          // many rows → beads bounce their way down slowly
    var pinR = TW * 0.044;
    pinTop = CAP + pinRowGap;
    var bot = TL - CAP - pinRowGap * 0.5, row = 0;
    for (var v = pinTop; v < bot; v += pinRowGap) {
      var n = (row % 2) ? 3 : 4, bucket = [];       // dense, but gaps stay wider than a bead so nothing clogs
      for (var k = 0; k < n; k++) {
        var frac = (k + 0.5) / n;
        // jitter off the grid so the pins read as organic thorns, not a pegboard
        var pu = clamp(TW * (0.1 + 0.8 * frac) + (Math.random() - 0.5) * TW * 0.08, pinR + 3, TW - pinR - 3);
        var pin = { u: pu, v: v + (row % 2 ? pinRowGap * 0.22 : 0) + (Math.random() - 0.5) * pinRowGap * 0.3, r: pinR };
        pins.push(pin); bucket.push(pin);
      }
      pinBuckets.push(bucket); row++;
    }
  }

  function seedMotes() {
    motes = [];
    if (reduce) return;
    for (var i = 0; i < 26; i++) motes.push({ x: Math.random() * W, y: Math.random() * H, r: rnd(0.5, 1.8), sp: rnd(3, 11), ph: Math.random() * TAU, tw: rnd(0.3, 0.7) });
  }

  // ---- physics ------------------------------------------------------------
  function step(dt) {
    // ease the tube toward its target angle (drag sets both; flip/gyro set target)
    if (!dragging) {
      var d = targetTilt - tilt;
      tilt += d * Math.min(1, dt * 9);
    }
    var gu = -Math.sin(tilt) * G, gv = Math.cos(tilt) * G;

    // wake everything whenever the stick is actually turned (drag / flip / tilt)
    if (Math.abs(tilt - prevTilt) > 0.0016) { for (var w = 0; w < beads.length; w++) { beads[w].awake = true; beads[w].slp = 0; } }
    prevTilt = tilt;

    hits.length = 0;
    var i, b, j, cosT = Math.cos(tilt), sinT = Math.sin(tilt), panScale = 1 / (Math.min(W, H) * 0.3);
    var sT = -G * 0.2;   // a contact "supports" a bead if its push opposes gravity by this much
    for (i = 0; i < beads.length; i++) {
      b = beads[i];
      if (!b.awake) continue;                 // frozen beads are a solid, silent pile (free to skip)
      b.sup = false;
      b.vu += gu * dt; b.vv += gv * dt;
      b.vu *= 0.992; b.vv *= 0.992;
      b.u += b.vu * dt; b.v += b.vv * dt;
      // pins (only the row buckets around this bead)
      var ri = ((b.v - pinTop) / pinRowGap) | 0;
      for (var rr = ri - 1; rr <= ri + 1; rr++) {
        if (rr < 0 || rr >= pinBuckets.length) continue;
        var bucket = pinBuckets[rr];
        for (j = 0; j < bucket.length; j++) {
          var p = bucket[j], du = b.u - p.u, dv = b.v - p.v, minD = b.r + p.r, d2 = du * du + dv * dv;
          if (d2 < minD * minD && d2 > 0.0001) {
            var dd = Math.sqrt(d2), nu = du / dd, nv = dv / dd, ov = minD - dd;
            b.u += nu * ov; b.v += nv * ov;
            var vn = b.vu * nu + b.vv * nv;
            if (vn < 0) { b.vu -= 1.5 * vn * nu; b.vv -= 1.5 * vn * nv; if (-vn > 55) pushHit(b, -vn, cosT, sinT, panScale); }
            if (nu * gu + nv * gv < sT) b.sup = true;
          }
        }
      }
      // walls + end caps
      var lo = R_IN + b.r, hiU = TW - R_IN - b.r;
      if (b.u < lo) { b.u = lo; if (b.vu < 0) b.vu *= -0.25; if (gu < sT) b.sup = true; }
      else if (b.u > hiU) { b.u = hiU; if (b.vu > 0) b.vu *= -0.25; if (gu > -sT) b.sup = true; }
      var loV = CAP, hiV = TL - CAP;
      if (b.v < loV) { b.v = loV; if (b.vv < 0) b.vv *= -0.22; if (gv < sT) b.sup = true; }
      else if (b.v > hiV) { b.v = hiV; if (b.vv > 0) b.vv *= -0.22; if (gv > -sT) b.sup = true; }
    }

    separate(cosT, sinT, panScale, gu, gv);   // awake beads collide; frozen ones act as static walls

    // freeze beads that are SUPPORTED and quiet → the pile fully rests (no shimmer / no sound).
    // unsupported (mid-fall) beads keep going, so nothing sticks on a slope.
    for (i = 0; i < beads.length; i++) {
      b = beads[i];
      if (!b.awake) continue;
      if (b.sup && b.vu * b.vu + b.vv * b.vv < 2600) { if (++b.slp > 16) { b.awake = false; b.vu = 0; b.vv = 0; } }
      else b.slp = 0;
    }

    for (i = flashes.length - 1; i >= 0; i--) { flashes[i].life -= dt * 3.4; if (flashes[i].life <= 0) flashes.splice(i, 1); }
    if (!reduce) for (i = 0; i < motes.length; i++) { var mo = motes[i]; mo.y -= mo.sp * dt; mo.x += Math.sin(mo.ph) * 4 * dt; mo.ph += dt * 0.4; if (mo.y < -4) { mo.y = H + 4; mo.x = Math.random() * W; } }

    // audio follows the ACTUAL collision rate → it dies away as the beads settle
    var flow = clamp(hits.length / 16, 0, 1);
    activity += (flow - activity) * Math.min(1, dt * (flow > activity ? 14 : 3.5)); // rise fast, tail off slow
    updateAudio();
  }

  // record an audible collision, panned by the bead's actual on-screen position so the
  // shower sweeps across the stereo field as it falls, and pitched by bead size
  function pushHit(b, sp, cosT, sinT, panScale) {
    var pan = clamp(((b.u - TW / 2) * cosT + (b.v - TL / 2) * sinT) * panScale, -1, 1);
    hits.push({ sp: sp, pan: pan, pm: b.pm });
  }

  // linked-list spatial hash (Int32Array head/next → zero per-frame allocation)
  var _head = null, _next = null;
  function separate(cosT, sinT, panScale, gu, gv) {
    var sT = -G * 0.2;
    var cell = TW * 0.36, cols = ((TW / cell) | 0) + 3, rows = ((TL / cell) | 0) + 3, ncell = cols * rows;
    if (!_head || _head.length < ncell) _head = new Int32Array(ncell);
    if (!_next || _next.length < beads.length) _next = new Int32Array(beads.length);
    _head.fill(-1, 0, ncell);
    var i, b, N = beads.length;
    for (i = 0; i < N; i++) {
      b = beads[i];
      var ci = clamp((b.u / cell) | 0, 0, cols - 3) + 1 + (clamp((b.v / cell) | 0, 0, rows - 3) + 1) * cols;
      _next[i] = _head[ci]; _head[ci] = i;
    }
    for (i = 0; i < N; i++) {
      b = beads[i];
      if (!b.awake) continue;                 // only awake beads move; frozen ones are static
      var cx0 = clamp((b.u / cell) | 0, 0, cols - 3) + 1, cy0 = clamp((b.v / cell) | 0, 0, rows - 3) + 1;
      for (var ay = -1; ay <= 1; ay++) {
        var rowBase = (cy0 + ay) * cols + cx0;
        for (var ax = -1; ax <= 1; ax++) {
          for (var jj = _head[rowBase + ax]; jj !== -1; jj = _next[jj]) {
            if (jj === i) continue;
            var c = beads[jj], du = b.u - c.u, dv = b.v - c.v, rr = b.r + c.r, d2 = du * du + dv * dv;
            if (d2 >= rr * rr || d2 < 0.0001) continue;
            var d = Math.sqrt(d2), nu = du / d, nv = dv / d, over = rr - d, ng = nu * gu + nv * gv;
            if (c.awake) {
              if (jj > i) {                     // both awake → resolve the pair once
                var h = over * 0.5;
                b.u += nu * h; b.v += nv * h; c.u -= nu * h; c.v -= nv * h;
                var rvn = (b.vu - c.vu) * nu + (b.vv - c.vv) * nv;
                if (rvn < 0) { var im = rvn * 0.5; b.vu -= im * nu; b.vv -= im * nv; c.vu += im * nu; c.vv += im * nv; }
                if (ng < sT) b.sup = true; else if (ng > -sT) c.sup = true;
              }
            } else {                            // neighbour frozen → static wall: push b out
              b.u += nu * over; b.v += nv * over;
              var vn2 = b.vu * nu + b.vv * nv;
              if (vn2 < 0) { b.vu -= vn2 * nu; b.vv -= vn2 * nv; if (-vn2 > 85) pushHit(b, -vn2 * 0.7, cosT, sinT, panScale); }
              if (ng < sT) b.sup = true;
            }
          }
        }
      }
    }
  }

  // ---- audio --------------------------------------------------------------
  var actx = null, outGain = null, comp = null, dryBus = null, wetBus = null, shell = null, muted = false;
  var bedSrc = null, bedLP = null, bedGain = null;
  function makeImpulse(sec, decay) {
    var rate = actx.sampleRate, len = (rate * sec) | 0, buf = actx.createBuffer(2, len, rate);
    for (var ch = 0; ch < 2; ch++) {
      var d = buf.getChannelData(ch), lp = 0;
      for (var i = 0; i < len; i++) { var env = Math.pow(1 - i / len, decay), n = Math.random() * 2 - 1; lp += (n - lp) * 0.35; d[i] = (n * 0.4 + lp * 0.6) * env; }
    }
    return buf;
  }
  function noiseBuf(sec) {
    var len = (actx.sampleRate * sec) | 0, buf = actx.createBuffer(1, len, actx.sampleRate), d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }
  function unlock() {
    if (actx) { if (actx.state === "suspended") actx.resume(); return; }
    try {
      actx = new (window.AudioContext || window.webkitAudioContext)();
      var b = actx.createBuffer(1, 1, 22050), s = actx.createBufferSource(); s.buffer = b; s.connect(actx.destination); s.start(0);
      outGain = actx.createGain(); outGain.gain.value = muted ? 0 : 0.9;
      var mlp = actx.createBiquadFilter(); mlp.type = "lowpass"; mlp.frequency.value = 12000; mlp.Q.value = 0.4;
      comp = actx.createDynamicsCompressor();
      comp.threshold.value = -18; comp.knee.value = 26; comp.ratio.value = 3.2; comp.attack.value = 0.003; comp.release.value = 0.2;
      comp.connect(mlp); mlp.connect(outGain); outGain.connect(actx.destination);
      // hollow-wood shell colour: everything runs through a gentle body resonance
      shell = actx.createBiquadFilter(); shell.type = "peaking"; shell.frequency.value = 1300; shell.Q.value = 0.8; shell.gain.value = 3;
      shell.connect(comp);
      dryBus = actx.createGain(); dryBus.gain.value = 0.9; dryBus.connect(shell);
      // soft room reverb so the shower has air around it
      var conv = actx.createConvolver(); conv.buffer = makeImpulse(2.1, 2.3);
      var hp = actx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 500;
      wetBus = actx.createGain(); wetBus.gain.value = 0.26;
      wetBus.connect(hp); hp.connect(conv); conv.connect(comp);
      // continuous rain bed (looping noise → moving lowpass, gain follows flow)
      bedSrc = actx.createBufferSource(); bedSrc.buffer = noiseBuf(2.2); bedSrc.loop = true;
      bedLP = actx.createBiquadFilter(); bedLP.type = "lowpass"; bedLP.frequency.value = 2000; bedLP.Q.value = 0.6;
      var bedHP = actx.createBiquadFilter(); bedHP.type = "highpass"; bedHP.frequency.value = 700;
      bedGain = actx.createGain(); bedGain.gain.value = 0.0001;
      bedSrc.connect(bedLP); bedLP.connect(bedHP); bedHP.connect(bedGain); bedGain.connect(dryBus); bedGain.connect(wetBus);
      bedSrc.start(0);
    } catch (e) { actx = null; }
  }
  function updateAudio() {
    if (!actx || muted) return;
    var t = actx.currentTime;
    // the "shhh" bed only glues DENSE cascades — gentle flow is pure discrete patter,
    // and it fades to nothing as the collisions stop (no more constant static)
    var bed = Math.max(0, activity - 0.24) * 0.05;
    bedGain.gain.setTargetAtTime(0.0001 + bed, t, 0.04);
    bedLP.frequency.setTargetAtTime(1500 + activity * 3600, t, 0.05);
    // each significant bead-on-pin hit is a woody tick; cap how many voice per frame
    if (!hits.length) return;
    if (hits.length > MAX_GRAINS) hits.sort(function (a, b) { return b.sp - a.sp; });
    var n = Math.min(hits.length, MAX_GRAINS);
    for (var i = 0; i < n; i++) grain(hits[i].sp, hits[i].pan, hits[i].pm, t);
  }
  function grain(sp, pan, pm, t) {
    var vol = clamp(sp / 1000, 0.03, 0.6) * 0.72;
    var dur = rnd(0.005, 0.012);
    var src = actx.createBufferSource(); src.buffer = grainNoise;
    var off = Math.random() * (grainNoise.duration - dur);
    // bright, crisp bead tick; pitch spread by bead size (pm) + a touch by impact speed
    var bp = actx.createBiquadFilter(); bp.type = "bandpass";
    bp.frequency.value = clamp(rnd(2400, 5200) * pm * (0.9 + sp / 4000), 1400, 8600); bp.Q.value = rnd(0.9, 2.0);
    var g = actx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.0007); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    var pn; try { pn = actx.createStereoPanner(); pn.pan.value = pan; } catch (e) { pn = g; }
    src.connect(bp); bp.connect(g);
    if (pn !== g) { g.connect(pn); pn.connect(dryBus); pn.connect(wetBus); } else { g.connect(dryBus); g.connect(wetBus); }
    src.start(t, off, dur + 0.005);
  }
  var grainNoise = null;
  function ensureGrainNoise() { if (actx && !grainNoise) grainNoise = noiseBuf(0.5); }

  // ---- render -------------------------------------------------------------
  var beadSprites = {};
  function beadSprite(hue) {
    var s = beadSprites[hue]; if (s) return s;
    var S = 36, cv = document.createElement("canvas"); cv.width = cv.height = S;
    var c = cv.getContext("2d"), r = S * 0.42, x = S / 2, y = S / 2;
    var g = c.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
    g.addColorStop(0, "hsl(" + hue + ",88%,86%)");
    g.addColorStop(0.45, "hsl(" + hue + ",82%,64%)");
    g.addColorStop(0.85, "hsl(" + hue + ",78%,42%)");
    g.addColorStop(1, "hsl(" + hue + ",70%,26%)");
    c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
    c.fillStyle = "rgba(255,255,255,0.85)"; c.beginPath(); c.arc(x - r * 0.32, y - r * 0.36, r * 0.28, 0, TAU); c.fill();
    beadSprites[hue] = cv; return cv;
  }
  // the dusk sky + sun glow + dune are static → bake them once, blit each frame
  var skyCanvas = null;
  function buildSky() {
    skyCanvas = document.createElement("canvas");
    skyCanvas.width = W * DPR; skyCanvas.height = H * DPR;
    var c = skyCanvas.getContext("2d"); c.setTransform(DPR, 0, 0, DPR, 0, 0);
    var g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#241033"); g.addColorStop(0.42, "#4a2340"); g.addColorStop(0.72, "#8a3f4a"); g.addColorStop(0.9, "#c96a44"); g.addColorStop(1, "#e08a4a");
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    var sun = c.createRadialGradient(W * 0.5, H * 0.94, 0, W * 0.5, H * 0.94, Math.max(W, H) * 0.55);
    sun.addColorStop(0, "rgba(255,208,140,0.5)"); sun.addColorStop(0.4, "rgba(240,150,90,0.14)"); sun.addColorStop(1, "rgba(240,150,90,0)");
    c.fillStyle = sun; c.fillRect(0, 0, W, H);
    c.fillStyle = "#1c0f22";
    c.beginPath(); c.moveTo(0, H);
    c.quadraticCurveTo(W * 0.28, H - TL * 0.1 - 20, W * 0.5, H - 24);
    c.quadraticCurveTo(W * 0.78, H - TL * 0.08, W, H - TL * 0.14);
    c.lineTo(W, H); c.closePath(); c.fill();
  }
  function drawBackdrop(t) {
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(skyCanvas, 0, 0); ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    if (reduce || !motes.length) return;
    ctx.save(); ctx.globalCompositeOperation = "lighter";
    for (var i = 0; i < motes.length; i++) {
      var mo = motes[i];
      ctx.fillStyle = "rgba(255,240,220," + (0.05 + 0.12 * (0.5 + 0.5 * Math.sin(t * mo.tw + mo.ph))) + ")";
      ctx.beginPath(); ctx.arc(mo.x, mo.y, mo.r, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  function tubePath(c, halfW, top, bot, r) {
    c.beginPath();
    c.moveTo(-halfW + r, top); c.arcTo(halfW, top, halfW, top + r, r);
    c.lineTo(halfW, bot - r); c.arcTo(halfW, bot, halfW - r, bot, r);
    c.lineTo(-halfW + r, bot); c.arcTo(-halfW, bot, -halfW, bot - r, r);
    c.lineTo(-halfW, top + r); c.arcTo(-halfW, top, -halfW + r, top, r); c.closePath();
  }

  function draw(t) {
    drawBackdrop(t);

    ctx.save();
    ctx.translate(cx, cy); ctx.rotate(-tilt);   // tube frame: local (u-TW/2, v-TL/2)
    var hw = TW / 2, top = -TL / 2, bot = TL / 2, gr = hw * 0.9;

    // soft shadow hugging the tube, offset toward true world-down (correct at any angle)
    var soff = 12, sox = -soff * Math.sin(tilt), soy = soff * Math.cos(tilt);
    ctx.save(); ctx.translate(sox, soy); ctx.filter = "blur(16px)"; ctx.globalAlpha = 0.32; ctx.fillStyle = "#0e070c";
    tubePath(ctx, hw * 1.2, top - CAP * 0.2, bot + CAP * 0.2, hw);
    ctx.fill(); ctx.filter = "none"; ctx.globalAlpha = 1; ctx.restore();

    // glass interior (dark warm), clipped
    ctx.save();
    tubePath(ctx, hw, top + CAP * 0.5, bot - CAP * 0.5, gr); ctx.clip();
    var ig = ctx.createLinearGradient(-hw, 0, hw, 0);
    ig.addColorStop(0, "#3a2016"); ig.addColorStop(0.5, "#221019"); ig.addColorStop(1, "#140a12");
    ctx.fillStyle = ig; ctx.fillRect(-hw, top, TW, TL);

    // pins (small dim brass thorns behind the glass — present but not competing with the beads)
    for (var i = 0; i < pins.length; i++) {
      var p = pins[i], px = p.u - hw, py = p.v - TL / 2, pr = p.r * 0.72;
      ctx.fillStyle = "rgba(140,102,54,0.5)";
      ctx.beginPath(); ctx.arc(px, py, pr, 0, TAU); ctx.fill();
      ctx.fillStyle = "rgba(255,224,168,0.38)";
      ctx.beginPath(); ctx.arc(px - pr * 0.3, py - pr * 0.32, pr * 0.5, 0, TAU); ctx.fill();
    }

    // beads (cached sprite blit; motion streaks for the fast ones)
    ctx.lineCap = "round";
    for (i = 0; i < beads.length; i++) {
      var b = beads[i], bx = b.u - hw, by = b.v - TL / 2;
      if (b.awake && (b.vu * b.vu + b.vv * b.vv) > 17000) {
        ctx.strokeStyle = "hsla(" + b.hue + ",80%,74%,0.26)"; ctx.lineWidth = b.r * 0.9;
        ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx - b.vu * 0.018, by - b.vv * 0.018); ctx.stroke();
      }
      var d = b.r * 2.35;
      ctx.drawImage(beadSprite(b.hue), bx - d / 2, by - d / 2, d, d);
    }
    ctx.restore();

    // glass overlay — sheen + tint + rim so beads read as "under glass"
    tubePath(ctx, hw, top + CAP * 0.5, bot - CAP * 0.5, gr);
    var tint = ctx.createLinearGradient(-hw, 0, hw, 0);
    tint.addColorStop(0, "rgba(60,30,20,0.28)"); tint.addColorStop(0.5, "rgba(255,230,200,0.02)"); tint.addColorStop(1, "rgba(0,0,0,0.34)");
    ctx.fillStyle = tint; ctx.fill();
    ctx.save(); ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = "rgba(255,240,220,0.35)"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-hw * 0.5, top + CAP); ctx.lineTo(-hw * 0.5, bot - CAP); ctx.stroke();
    ctx.strokeStyle = "rgba(255,240,220,0.12)"; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(-hw * 0.5, top + CAP); ctx.lineTo(-hw * 0.5, bot - CAP); ctx.stroke();
    ctx.restore();
    // rim
    tubePath(ctx, hw, top + CAP * 0.5, bot - CAP * 0.5, gr);
    ctx.lineWidth = 2; ctx.strokeStyle = "rgba(20,8,6,0.6)"; ctx.stroke();

    // wood end caps
    drawCap(top, 1);
    drawCap(bot, -1);
    // binding bands
    band(top + CAP + TL * 0.02); band(bot - CAP - TL * 0.02);

    ctx.restore();

    // vignette
    var vg = ctx.createRadialGradient(cx, cy, Math.min(W, H) * 0.32, cx, cy, Math.max(W, H) * 0.72);
    vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,0.5)");
    ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
  }

  function drawCap(vEnd, dir) {
    var hw = TW / 2, cw = hw * 1.16;
    var yTip = vEnd, yBase = vEnd + dir * CAP;
    var lo = Math.min(yTip, yBase), hi = Math.max(yTip, yBase);
    // rounded turned-wood plug
    ctx.save();
    tubePath(ctx, cw, lo, hi, Math.min(cw * 0.5, (hi - lo) * 0.5));
    var wood = ctx.createLinearGradient(-cw, 0, cw, 0);
    wood.addColorStop(0, "#4a2c18"); wood.addColorStop(0.35, "#8a5227"); wood.addColorStop(0.5, "#a5652f"); wood.addColorStop(0.65, "#7d4a23"); wood.addColorStop(1, "#3a2113");
    ctx.fillStyle = wood; ctx.fill();
    // grain rings
    ctx.clip();
    ctx.strokeStyle = "rgba(60,32,14,0.5)"; ctx.lineWidth = 1;
    for (var k = 1; k < 5; k++) { ctx.beginPath(); ctx.ellipse(0, vEnd + dir * CAP, cw * (k / 5), CAP * (k / 5), 0, 0, TAU); ctx.stroke(); }
    ctx.restore();
    tubePath(ctx, cw, lo, hi, Math.min(cw * 0.5, (hi - lo) * 0.5));
    ctx.lineWidth = 1.5; ctx.strokeStyle = "rgba(20,10,4,0.6)"; ctx.stroke();
    // brass ferrule where cap meets glass
    ctx.fillStyle = "rgba(210,168,96,0.9)";
    ctx.fillRect(-cw, vEnd + dir * CAP - dir * 3 - (dir > 0 ? 3 : 0), cw * 2, 4);
  }
  function band(v) {
    var hw = TW / 2;
    ctx.fillStyle = "rgba(150,96,52,0.85)";
    ctx.fillRect(-hw * 1.04, v - 3, hw * 2.08, 6);
    ctx.fillStyle = "rgba(255,220,170,0.25)";
    ctx.fillRect(-hw * 1.04, v - 3, hw * 2.08, 2);
  }

  // ---- loop ---------------------------------------------------------------
  var lastTs = null;
  function frame(ts) {
    var t = ts / 1000, dt = lastTs !== null ? Math.min((ts - lastTs) / 1000, 0.033) : 0.016; lastTs = ts;
    step(dt); draw(t);
    requestAnimationFrame(frame);
  }

  // ---- input --------------------------------------------------------------
  function down(x, y) {
    unlock(); ensureGrainNoise();
    dragging = true; moved = false;
    downX = x; downY = y; downT = performance.now();
    grabAng = Math.atan2(y - cy, x - cx); grabTilt = tilt;
    canvas.classList.add("grabbing");
  }
  function move(x, y) {
    if (!dragging) return;
    if (Math.abs(x - downX) + Math.abs(y - downY) > 6) moved = true;
    var a = Math.atan2(y - cy, x - cx);
    tilt = grabTilt - (a - grabAng);   // tube is drawn rotate(-tilt) → follow the pointer, not oppose it
    targetTilt = tilt;
    if (hintEl) hintEl.classList.add("is-hidden");
  }
  function up() {
    if (dragging && !moved && performance.now() - downT < 240) {
      // a quick tap = a shake: dislodge the beads for a little burst
      for (var i = 0; i < beads.length; i++) { beads[i].vu += rnd(-70, 70); beads[i].vv += rnd(-70, 70); }
      if (hintEl) hintEl.classList.add("is-hidden");
    }
    dragging = false; canvas.classList.remove("grabbing");
  }
  canvas.addEventListener("mousedown", function (e) { down(e.clientX, e.clientY); });
  window.addEventListener("mousemove", function (e) { move(e.clientX, e.clientY); });
  window.addEventListener("mouseup", up);
  canvas.addEventListener("touchstart", function (e) { e.preventDefault(); var tt = e.changedTouches[0]; down(tt.clientX, tt.clientY); }, { passive: false });
  canvas.addEventListener("touchmove", function (e) { e.preventDefault(); var tt = e.touches[0]; move(tt.clientX, tt.clientY); }, { passive: false });
  window.addEventListener("touchend", up);

  // ---- controls -----------------------------------------------------------
  var flipBtn = document.getElementById("flipBtn");
  var tiltBtn = document.getElementById("tiltBtn");
  var soundBtn = document.getElementById("soundBtn");

  flipBtn.addEventListener("click", function () {
    unlock(); ensureGrainNoise();
    targetTilt += Math.PI * (Math.cos(tilt) >= 0 ? 1 : -1);   // flip so the full end is now up → cascade
    if (hintEl) hintEl.classList.add("is-hidden");
    track("rain_flip");
  });

  function onMotion(e) {
    if (!gyroOn) return;
    var a = e.accelerationIncludingGravity;
    if (!a || a.x == null) return;
    var mag = Math.hypot(a.x, a.y);
    if (mag < 2.2) return;                     // phone near-flat → hold last angle
    var ang = Math.atan2(gyroSign * a.x, -a.y);
    if (!dragging) targetTilt = ang;
  }
  function enableTilt() {
    function attach() { gyroOn = true; window.addEventListener("devicemotion", onMotion); tiltBtn.textContent = "Tilt: on"; tiltBtn.setAttribute("aria-pressed", "true"); if (hintEl) hintEl.classList.add("is-hidden"); }
    var DM = window.DeviceMotionEvent;
    if (DM && typeof DM.requestPermission === "function") {
      DM.requestPermission().then(function (s) { if (s === "granted") attach(); }).catch(function () {});
    } else attach();
  }
  tiltBtn.addEventListener("click", function () {
    if (gyroOn) { gyroOn = false; window.removeEventListener("devicemotion", onMotion); tiltBtn.textContent = "Tilt: off"; tiltBtn.setAttribute("aria-pressed", "false"); }
    else enableTilt();
  });

  soundBtn.addEventListener("click", function () {
    muted = !muted; unlock();
    if (outGain) outGain.gain.setTargetAtTime(muted ? 0 : 0.9, actx.currentTime, 0.02);
    soundBtn.textContent = muted ? "Sound: off" : "Sound: on";
    soundBtn.setAttribute("aria-pressed", muted ? "true" : "false");
  });

  function track(name) { try { if (typeof window.gtag === "function") window.gtag("event", name, {}); } catch (e) {} }

  // ---- boot ---------------------------------------------------------------
  if (window.DeviceMotionEvent) tiltBtn.hidden = false;   // offer tilt only where motion exists
  resize(); window.addEventListener("resize", resize);
  setTimeout(function () { if (hintEl) hintEl.classList.add("is-hidden"); }, 9000);
  requestAnimationFrame(frame);
})();
