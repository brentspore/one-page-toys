/* Campfire — tend a crackling fire on a dark night.
 * Tap to toss on a log (it grows the fire), drag to fan the flames brighter.
 * Flames/embers/smoke are a particle system; the fire dims over time so you
 * keep feeding it. ALL audio is synthesized (no samples): a filtered-noise roar
 * with breathing modulation, Poisson crackle pops, a high sizzle, and for a log
 * a woody resonant-mode knock + bark scrape + spark flare.
 */
(function () {
  "use strict";

  var canvas = document.getElementById("canvas");
  var ctx = canvas.getContext("2d");
  var hintEl = document.querySelector(".hint");

  var W, H, DPR, CX, BASEY;
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = W * DPR; canvas.height = H * DPR;
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    CX = W / 2; BASEY = H * 0.72;
    seedStars(); seedRocks();
  }

  // ---- backdrop -----------------------------------------------------------
  var stars = [], rocks = [];
  function seedStars() {
    stars.length = 0;
    var n = Math.round(W * H / 9000);
    for (var i = 0; i < n; i++) stars.push({ x: Math.random() * W, y: Math.random() * H * 0.6, r: Math.random() * 1.1 + 0.3, tw: Math.random() * 6.28, sp: 0.4 + Math.random() * 1.3 });
  }
  function seedRocks() {
    rocks.length = 0;
    var ring = Math.min(W, H) * 0.13, n = 9;
    for (var i = 0; i < n; i++) {
      var a = Math.PI * 0.12 + (i / (n - 1)) * (Math.PI - 0.24);   // front arc only
      rocks.push({ x: CX + Math.cos(a) * ring * 1.5, y: BASEY + Math.sin(a) * ring * 0.5 + 6, r: 13 + Math.random() * 12 });
    }
  }

  // ---- fire state ---------------------------------------------------------
  var intensity = 0.72, fan = 0;
  var FLOOR = 0.34;                 // settles to a steady cosy fire, never near-out
  var logs = [];
  var FIRE_W = 0;

  function addLog(x) {
    if (logs.length >= 7) logs.shift();
    var lx = CX + (Math.random() - 0.5) * 46;
    logs.push({ x: lx, y: BASEY + 4 + (Math.random() - 0.5) * 6, len: 90 + Math.random() * 50, ang: (Math.random() - 0.5) * 0.9, fuel: 1, seed: Math.random() * 6.28, born: nowish });
    intensity = Math.min(1, intensity + 0.28);
    fan = Math.min(1.6, fan + 0.5);
    sparkBurst(20);
    logKnock();
  }

  // ---- particles ----------------------------------------------------------
  var flames = [], embers = [], smoke = [];
  function spawnFlame() {
    var spread = (Math.min(W, H) * 0.06) * (0.6 + intensity * 0.7);
    // bias toward the centre so the fire forms a body, not a flat row
    var x = CX + (Math.random() - 0.5) * spread * 2 * (0.4 + Math.random() * 0.6);
    var lift = (120 + Math.random() * 90) * (0.6 + intensity * 1.0 + fan * 0.6);
    flames.push({
      x: x, y: BASEY - Math.random() * 10,
      vx: (CX - x) * 0.9 + (Math.random() - 0.5) * 10 + fanDir * fan * 34,
      vy: -lift, age: 0, life: 0.6 + Math.random() * 0.8,
      r: (13 + Math.random() * 18) * (0.8 + intensity * 0.55), seed: Math.random() * 6.28
    });
  }
  function spawnEmber() {
    embers.push({
      x: CX + (Math.random() - 0.5) * 40, y: BASEY - Math.random() * 20,
      vx: (Math.random() - 0.5) * 18 + fanDir * fan * 40, vy: -(80 + Math.random() * 90) * (0.7 + intensity * 0.6),
      age: 0, life: 1.4 + Math.random() * 1.8, r: 1 + Math.random() * 1.6, tw: Math.random() * 6.28
    });
  }
  function spawnSmoke(x, y) {
    smoke.push({ x: x, y: y, vx: (Math.random() - 0.5) * 10 + 4, vy: -(20 + Math.random() * 24), age: 0, life: 2.4 + Math.random() * 2, r: 14 + Math.random() * 16 });
  }
  function sparkBurst(n) { for (var i = 0; i < n; i++) spawnEmber(); }

  function update(dt) {
    fan = Math.max(0, fan - dt * 1.4);
    // burn the logs down (a hotter fire + fanning consume them faster)
    var totalFuel = 0;
    for (var li = logs.length - 1; li >= 0; li--) {
      var lg = logs[li];
      lg.fuel -= dt * 0.02 * (0.6 + intensity * 0.5 + fan * 0.7);
      if (lg.fuel <= 0) { logs.splice(li, 1); continue; }
      totalFuel += lg.fuel;
    }
    // fire strength follows available fuel, easing toward it, with an ember floor
    var target = Math.min(1, FLOOR + totalFuel * 0.5);
    intensity += (target - intensity) * Math.min(1, dt * 0.6);
    if (intensity < FLOOR) intensity = FLOOR;
    FIRE_W = (Math.min(W, H) * 0.07) * (0.6 + intensity * 0.7);

    // spawn
    var fcount = (intensity * 26 + fan * 16);
    flameAcc += fcount * dt;
    while (flameAcc >= 1) { spawnFlame(); flameAcc--; }
    if (Math.random() < (intensity * 0.5 + fan * 0.6) * dt * 60 / 60) { if (Math.random() < 0.4) spawnEmber(); }
    emberAcc += (intensity * 3 + fan * 6) * dt;
    while (emberAcc >= 1) { spawnEmber(); emberAcc--; }

    var i, p;
    for (i = flames.length - 1; i >= 0; i--) {
      p = flames[i]; p.age += dt;
      p.vy *= (1 - 0.6 * dt); p.vx *= (1 - 1.2 * dt);
      p.x += (p.vx + Math.sin(p.age * 7 + p.seed) * 22) * dt;
      p.y += p.vy * dt;
      if (p.age >= p.life) { if (Math.random() < 0.25 && intensity < 0.7) spawnSmoke(p.x, p.y); flames.splice(i, 1); }
    }
    for (i = embers.length - 1; i >= 0; i--) {
      p = embers[i]; p.age += dt; p.vy *= (1 - 0.3 * dt); p.vy += 14 * dt;   // cool & start to fall
      p.x += (p.vx + Math.sin(p.age * 4 + p.tw) * 16) * dt; p.y += p.vy * dt;
      if (p.age >= p.life || p.y > H) embers.splice(i, 1);
    }
    for (i = smoke.length - 1; i >= 0; i--) {
      p = smoke[i]; p.age += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.r += 14 * dt; p.vx += 3 * dt;
      if (p.age >= p.life) smoke.splice(i, 1);
    }

    // crackle audio: Poisson-ish pops, rate scales with fire
    if (actx) {
      var rate = 6 + intensity * 38 + fan * 30;            // pops/sec
      crackAcc += rate * dt;
      while (crackAcc >= 1) { pop(); crackAcc--; }
      // keep the roar/sizzle beds tracking the fire
      var breath = 0.8 + Math.sin(nowish * 1.7) * 0.12 + Math.sin(nowish * 0.7) * 0.08;
      roarGain.gain.setTargetAtTime((0.05 + intensity * 0.14 + fan * 0.06) * breath, actx.currentTime, 0.1);
      sizzleGain.gain.setTargetAtTime(0.012 + intensity * 0.03, actx.currentTime, 0.15);
    }
  }
  var flameAcc = 0, emberAcc = 0, crackAcc = 0;

  // ---- render -------------------------------------------------------------
  function frameDraw() {
    // night
    var sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, "#070608"); sky.addColorStop(0.6, "#0a0707"); sky.addColorStop(1, "#0c0805");
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
    for (var i = 0; i < stars.length; i++) { var s = stars[i]; ctx.globalAlpha = (0.25 + Math.abs(Math.sin(nowish * s.sp + s.tw)) * 0.5) * (1 - intensity * 0.3); ctx.fillStyle = "#cdd6f0"; ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 6.28); ctx.fill(); }
    ctx.globalAlpha = 1;

    // warm ground glow
    var gr = (Math.min(W, H) * 0.5) * (0.5 + intensity * 0.9 + fan * 0.2);
    var glow = ctx.createRadialGradient(CX, BASEY, 0, CX, BASEY, gr);
    var gi = 0.5 + intensity * 0.5;
    glow.addColorStop(0, "rgba(255,150,50," + (0.32 * gi).toFixed(3) + ")");
    glow.addColorStop(0.4, "rgba(200,90,30," + (0.14 * gi).toFixed(3) + ")");
    glow.addColorStop(1, "rgba(120,40,10,0)");
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(CX, BASEY, gr, 0, 6.28); ctx.fill();

    // ground plane catching the light
    var gp = ctx.createLinearGradient(0, BASEY, 0, H);
    gp.addColorStop(0, "rgba(40,22,10," + (0.5 + intensity * 0.3).toFixed(3) + ")");
    gp.addColorStop(1, "rgba(6,4,3,1)");
    ctx.fillStyle = gp; ctx.fillRect(0, BASEY, W, H - BASEY);

    // smoke (behind flames)
    for (i = 0; i < smoke.length; i++) { var sm = smoke[i], f = sm.age / sm.life; ctx.globalAlpha = (1 - f) * 0.12; ctx.fillStyle = "#6b6660"; ctx.beginPath(); ctx.arc(sm.x, sm.y, sm.r, 0, 6.28); ctx.fill(); }
    ctx.globalAlpha = 1;

    // logs
    drawLogs();

    // flames (additive)
    ctx.globalCompositeOperation = "lighter";
    for (i = 0; i < flames.length; i++) drawFlame(flames[i]);
    // embers
    for (i = 0; i < embers.length; i++) { var e = embers[i], ef = e.age / e.life; var a = (1 - ef) * (0.6 + Math.abs(Math.sin(e.age * 10 + e.tw)) * 0.4); var col = ef < 0.5 ? "255,210,120" : "255,120,50"; ctx.fillStyle = "rgba(" + col + "," + a.toFixed(3) + ")"; ctx.beginPath(); ctx.arc(e.x, e.y, e.r, 0, 6.28); ctx.fill(); }
    ctx.globalCompositeOperation = "source-over";

    // rocks (front rim)
    drawRocks();
  }

  function drawFlame(p) {
    var f = p.age / p.life, a = (1 - f);
    var r, g, b;
    if (f < 0.22) { r = 255; g = 248; b = 214; }       // white-hot base
    else if (f < 0.5) { r = 255; g = 186; b = 72; }     // yellow-orange
    else if (f < 0.78) { r = 240; g = 110; b = 38; }    // orange
    else { r = 200; g = 56; b = 26; }                   // red tip
    var rad = p.r * (1 + f * 0.5);
    // flames are taller than wide — draw an upward-elongated glow tongue
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.scale(1, 1.7);
    var gr = ctx.createRadialGradient(0, -rad * 0.15, 0, 0, 0, rad);
    gr.addColorStop(0, "rgba(" + r + "," + g + "," + b + "," + (a * 0.62).toFixed(3) + ")");
    gr.addColorStop(0.5, "rgba(" + r + "," + g + "," + b + "," + (a * 0.3).toFixed(3) + ")");
    gr.addColorStop(1, "rgba(" + r + "," + g + "," + b + ",0)");
    ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(0, 0, rad, 0, 6.28); ctx.fill();
    ctx.restore();
  }

  function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
  function rgbA(c) { return "rgb(" + (c[0] | 0) + "," + (c[1] | 0) + "," + (c[2] | 0) + ")"; }
  function drawLogs() {
    for (var i = 0; i < logs.length; i++) {
      var L = logs[i], f = L.fuel, burn = 1 - f;        // f: 1 fresh → 0 ash
      var len = L.len * (0.4 + 0.6 * f);                  // shrinks as it's consumed
      var h = 15 * (0.5 + 0.5 * f);
      ctx.save(); ctx.translate(L.x, L.y); ctx.rotate(L.ang);
      // body: fresh brown chars toward charcoal
      var g = ctx.createLinearGradient(0, -h, 0, h);
      g.addColorStop(0, rgbA(mix([90, 58, 32], [54, 47, 42], burn)));
      g.addColorStop(0.5, rgbA(mix([63, 38, 19], [34, 29, 25], burn)));
      g.addColorStop(1, rgbA(mix([35, 21, 10], [18, 16, 13], burn)));
      ctx.fillStyle = g; roundRect(-len / 2, -h, len, h * 2, Math.min(7, h * 0.5)); ctx.fill();
      if (f > 0.05) {
        var ig = 0.4 + intensity * 0.6, fadeEnds = Math.min(1, f * 1.6);
        // glowing charred underside (fades as the log turns to ash)
        ctx.fillStyle = "rgba(255,120,40," + (0.45 * ig * fadeEnds).toFixed(3) + ")";
        roundRect(-len / 2 + 4, h - Math.min(6, h * 0.6), len - 8, Math.min(6, h * 0.6), 3); ctx.fill();
        // glowing burn cracks, brightest at mid-burn, flickering
        var crackA = 0.55 * ig * (1 - Math.abs(f - 0.5) * 1.5) * (0.7 + Math.sin(nowish * 9 + L.seed) * 0.3);
        if (crackA > 0.02) {
          ctx.strokeStyle = "rgba(255,150,55," + crackA.toFixed(3) + ")"; ctx.lineWidth = 1.4;
          for (var cc = 0; cc < 3; cc++) { var yy = -h * 0.4 + cc * h * 0.4; ctx.beginPath(); ctx.moveTo(-len * 0.4, yy + Math.sin(cc + L.seed) * 2); ctx.lineTo(len * 0.4, yy + Math.cos(cc + L.seed) * 2); ctx.stroke(); }
        }
      }
      // end grain (lightens fresh, darkens to ash)
      ctx.fillStyle = rgbA(mix([202, 160, 116], [74, 66, 58], burn));
      ctx.beginPath(); ctx.ellipse(-len / 2, 0, 3.6, h, 0, 0, 6.28); ctx.fill();
      ctx.beginPath(); ctx.ellipse(len / 2, 0, 3.6, h, 0, 0, 6.28); ctx.fill();
      ctx.restore();
    }
  }
  function drawRocks() {
    for (var i = 0; i < rocks.length; i++) {
      var rk = rocks[i];
      var g = ctx.createRadialGradient(rk.x - rk.r * 0.3, rk.y - rk.r * 0.4, rk.r * 0.2, rk.x, rk.y, rk.r);
      // lit on the side facing the fire
      g.addColorStop(0, "#5b4f47"); g.addColorStop(1, "#1b1512");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.ellipse(rk.x, rk.y, rk.r, rk.r * 0.7, 0, 0, 6.28); ctx.fill();
      // warm fire-side rim
      ctx.fillStyle = "rgba(255,140,60," + (0.16 + intensity * 0.2).toFixed(3) + ")";
      ctx.beginPath(); ctx.ellipse(rk.x, rk.y - rk.r * 0.18, rk.r * 0.8, rk.r * 0.4, 0, Math.PI, 6.28); ctx.fill();
    }
  }
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  // ---- audio (fully synthesized) -----------------------------------------
  var actx = null, master = null, noiseBuf = null, roarGain = null, sizzleGain = null;
  var fanDir = 0;
  function unlock() {
    if (actx) { if (actx.state === "suspended") actx.resume(); return; }
    try {
      actx = new (window.AudioContext || window.webkitAudioContext)();
      var b = actx.createBuffer(1, 1, 22050); var s = actx.createBufferSource(); s.buffer = b; s.connect(actx.destination); s.start(0);
      master = actx.createGain(); master.gain.value = 0.9; master.connect(actx.destination);
      makeNoise();
      // roar bed: low-passed noise = the body of the fire
      var rs = actx.createBufferSource(); rs.buffer = noiseBuf; rs.loop = true;
      var rlp = actx.createBiquadFilter(); rlp.type = "lowpass"; rlp.frequency.value = 480; rlp.Q.value = 0.5;
      roarGain = actx.createGain(); roarGain.gain.value = 0.0001;
      rs.connect(rlp); rlp.connect(roarGain); roarGain.connect(master); rs.start();
      // sizzle bed: high-passed noise = steam/hiss
      var ss = actx.createBufferSource(); ss.buffer = noiseBuf; ss.loop = true; ss.playbackRate.value = 1.3;
      var shp = actx.createBiquadFilter(); shp.type = "highpass"; shp.frequency.value = 4200;
      sizzleGain = actx.createGain(); sizzleGain.gain.value = 0.0001;
      ss.connect(shp); shp.connect(sizzleGain); sizzleGain.connect(master); ss.start();
    } catch (e) { actx = null; }
  }
  function makeNoise() {
    var len = Math.floor(actx.sampleRate * 2);
    noiseBuf = actx.createBuffer(1, len, actx.sampleRate);
    var d = noiseBuf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }
  // one crackle: a tiny exponentially-decaying noise burst through a bandpass.
  // Mostly faint ticks; occasionally a louder, lower, woody snap.
  function pop() {
    if (!actx) return;
    var t = actx.currentTime;
    var snap = Math.random() < 0.12;
    var dur = snap ? 0.02 + Math.random() * 0.05 : 0.003 + Math.random() * 0.018;
    var n = Math.max(2, Math.floor(actx.sampleRate * dur));
    var buf = actx.createBuffer(1, n, actx.sampleRate), d = buf.getChannelData(0);
    for (var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, snap ? 2.5 : 4);
    var src = actx.createBufferSource(); src.buffer = buf;
    var bp = actx.createBiquadFilter(); bp.type = "bandpass";
    bp.frequency.value = snap ? 500 + Math.random() * 900 : 1400 + Math.random() * 3200;
    bp.Q.value = snap ? 4 + Math.random() * 4 : 1 + Math.random() * 3;
    var g = actx.createGain();
    var amp = snap ? 0.12 + Math.random() * 0.16 : 0.015 + Math.random() * 0.07;
    g.gain.value = amp;
    src.connect(bp); bp.connect(g); g.connect(master);
    src.start(t); src.stop(t + dur + 0.01);
  }
  // a log being added: woody resonant knock (two hits settling) + bark scrape + spark flare
  function logKnock() {
    if (!actx) return;
    var t = actx.currentTime;
    woodKnock(t, 1);
    woodKnock(t + 0.08 + Math.random() * 0.04, 0.55);     // the settle
    // bark scrape: short band-limited noise
    var n = Math.floor(actx.sampleRate * 0.16), buf = actx.createBuffer(1, n, actx.sampleRate), d = buf.getChannelData(0);
    for (var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    var src = actx.createBufferSource(); src.buffer = buf;
    var bp = actx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 900; bp.Q.value = 1.2;
    var g = actx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    src.connect(bp); bp.connect(g); g.connect(master); src.start(t); src.stop(t + 0.17);
    // a soft flare of the fire body
    if (roarGain) { roarGain.gain.cancelScheduledValues(t); roarGain.gain.setValueAtTime(roarGain.gain.value, t); roarGain.gain.linearRampToValueAtTime(0.26, t + 0.05); }
    // a quick flurry of extra crackles
    for (var k = 0; k < 10; k++) setTimeout(pop, 30 + k * (20 + Math.random() * 40));
  }
  // hollow wooden knock: a click exciting a few inharmonic decaying modes
  function woodKnock(t, amp) {
    var modes = [[176, 0.2], [403, 0.13], [761, 0.09]];   // freq, decay (s)
    for (var m = 0; m < modes.length; m++) {
      var o = actx.createOscillator(); o.type = "sine"; o.frequency.value = modes[m][0] * (0.96 + Math.random() * 0.08);
      var g = actx.createGain(); var a = amp * (0.5 - m * 0.13);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(a, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + modes[m][1]);
      o.connect(g); g.connect(master); o.start(t); o.stop(t + modes[m][1] + 0.05);
    }
    // attack transient (the "tock")
    var n = Math.floor(actx.sampleRate * 0.012), buf = actx.createBuffer(1, n, actx.sampleRate), d = buf.getChannelData(0);
    for (var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    var src = actx.createBufferSource(); src.buffer = buf;
    var lp = actx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 2600;
    var ng = actx.createGain(); ng.gain.setValueAtTime(amp * 0.5, t); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
    src.connect(lp); lp.connect(ng); ng.connect(master); src.start(t); src.stop(t + 0.04);
  }
  // fanning whoosh while dragging
  var airGain = null, airBP = null, airOn = false;
  function ensureAir() {
    if (airGain || !actx) return;
    var ns = actx.createBufferSource(); ns.buffer = noiseBuf; ns.loop = true;
    airBP = actx.createBiquadFilter(); airBP.type = "bandpass"; airBP.frequency.value = 1200; airBP.Q.value = 0.8;
    airGain = actx.createGain(); airGain.gain.value = 0.0001;
    ns.connect(airBP); airBP.connect(airGain); airGain.connect(master); ns.start();
  }
  function airWhoosh(speed) { if (!actx) return; ensureAir(); airGain.gain.setTargetAtTime(Math.min(0.08, speed * 0.0006), actx.currentTime, 0.08); airBP.frequency.setTargetAtTime(900 + Math.min(2600, speed * 4), actx.currentTime, 0.1); }
  function airOff() { if (airGain) airGain.gain.setTargetAtTime(0.0001, actx.currentTime, 0.2); }

  // ---- interaction --------------------------------------------------------
  var down = false, lx = 0, ly = 0, lastT = 0, moved = 0, downT = 0, downX = 0;
  function now() { return (window.performance && performance.now ? performance.now() : Date.now()); }
  function start(x, y) { unlock(); down = true; lx = x; ly = y; downX = x; lastT = now(); downT = now(); moved = 0; if (hintEl) hintEl.classList.add("is-hidden"); }
  function move(x, y) {
    if (!down) return;
    var d = Math.hypot(x - lx, y - ly); if (d < 3) return;
    moved += d;
    var tn = now(), dtm = Math.max(8, tn - lastT); lastT = tn;
    var speed = d / (dtm / 1000);
    fanDir = x > lx ? 1 : -1;
    fan = Math.min(1.8, fan + Math.min(0.5, speed * 0.0006));
    intensity = Math.min(1, intensity + Math.min(0.02, speed * 0.00002));
    airWhoosh(speed);
    if (Math.random() < 0.4) sparkBurst(2);
    lx = x; ly = y;
  }
  function end() {
    if (!down) return;
    down = false; airOff();
    if (moved < 9 && (now() - downT) < 360) addLog(downX);   // a tap tosses a log
  }
  canvas.addEventListener("mousedown", function (e) { start(e.clientX, e.clientY); });
  window.addEventListener("mousemove", function (e) { if (e.buttons & 1) move(e.clientX, e.clientY); });
  window.addEventListener("mouseup", end);
  canvas.addEventListener("touchstart", function (e) { e.preventDefault(); var t = e.touches[0]; start(t.clientX, t.clientY); }, { passive: false });
  canvas.addEventListener("touchmove", function (e) { e.preventDefault(); var t = e.touches[0]; move(t.clientX, t.clientY); }, { passive: false });
  canvas.addEventListener("touchend", function (e) { e.preventDefault(); end(); }, { passive: false });

  // ---- loop ---------------------------------------------------------------
  var lastTs = null, nowish = 0;
  function frame(ts) {
    var dt = lastTs !== null ? Math.min((ts - lastTs) / 1000, 0.05) : 0.016;
    lastTs = ts; nowish += dt;
    update(dt);
    frameDraw();
    requestAnimationFrame(frame);
  }

  resize();
  window.addEventListener("resize", resize);
  // start with a couple of logs already burning
  logs.push({ x: CX - 26, y: BASEY + 2, len: 120, ang: 0.22, fuel: 0.8, seed: 1.3, born: 0 });
  logs.push({ x: CX + 24, y: BASEY + 6, len: 110, ang: -0.32, fuel: 0.65, seed: 4.1, born: 0 });
  requestAnimationFrame(frame);
  setTimeout(function () { if (hintEl) hintEl.classList.add("is-hidden"); }, 9000);
})();
