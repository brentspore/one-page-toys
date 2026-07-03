/* Paper Plane — a one-tap flyer. Tap/click/space to lift a folded paper plane
 * and thread the gaps between dusk-lit skyscrapers. One clip ends the run.
 * Vanilla Canvas 2D + Web Audio. */
(function () {
  "use strict";

  var canvas = document.getElementById("canvas");
  var ctx = canvas.getContext("2d");
  var scoreEl = document.getElementById("score");
  var bestEl = document.getElementById("best");
  var soundBtn = document.getElementById("soundBtn");
  var overlay = document.getElementById("overlay");
  var ovTitle = document.getElementById("ovTitle");
  var ovText = document.getElementById("ovText");
  var ovBtn = document.getElementById("ovBtn");
  var hintEl = document.getElementById("hint");

  var W = 0, H = 0, DPR = 1;

  // tunables (feel)
  var GRAV = 1500;           // px/s^2
  var FLAP = -430;           // px/s impulse on a tap
  var SPEED = 158;           // px/s the city scrolls
  var PAIR_DIST = 264;       // px between building pairs
  var PIPE_W = 78;           // building width
  var GROUND = 74;           // city base height
  var PLANE_X = 0;           // set in resize (fixed horizontal position)
  var HALF_W = 16, HALF_H = 8;

  var GAP = 180;
  var plane = { y: 0, vy: 0, rot: 0 };
  var buildings = [];
  var trail = [], particles = [];
  var scrollFar = 0, scrollMid = 0, clouds = [];
  var score = 0, best = 0;
  var running = false, over = false, started = false;
  var shake = 0, flash = 0, soundOn = true, t = 0;

  try { best = parseInt(localStorage.getItem("plane_best"), 10) || 0; } catch (e) { best = 0; }
  bestEl.textContent = "Best " + best;

  function floorY() { return H - GROUND; }

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.floor(W * DPR); canvas.height = Math.floor(H * DPR);
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    PLANE_X = Math.round(W * 0.3);
    GAP = Math.max(148, Math.min(210, floorY() * 0.3));
    if (clouds.length === 0) seedClouds();
  }
  window.addEventListener("resize", resize);

  function seedClouds() { clouds = []; for (var i = 0; i < 4; i++) clouds.push({ x: Math.random(), y: 0.1 + Math.random() * 0.4, s: 0.5 + Math.random() * 0.7, sp: 0.2 + Math.random() * 0.25 }); }

  function reset() {
    resize();
    plane.y = floorY() * 0.44; plane.vy = 0; plane.rot = 0;
    buildings = []; trail = []; particles = [];
    score = 0; over = false; scoreEl.textContent = "0";
    spawnBuilding(W + 120);
  }

  function spawnBuilding(x) {
    var margin = 46, lo = GAP / 2 + margin, hi = floorY() - GAP / 2 - margin;
    var gy = lo + Math.random() * Math.max(10, hi - lo);
    // window-light pattern seed + a rooftop feature
    buildings.push({ x: x, gapY: gy, scored: false, seed: (Math.random() * 9999) | 0, roof: Math.random() < 0.5 });
  }

  function flap() {
    if (over) return;
    if (!started) { startGame(); }
    if (!running) return;
    plane.vy = FLAP; unlock(); sndFlap();
    for (var i = 0; i < 3; i++) particles.push({ x: PLANE_X - 14, y: plane.y + (Math.random() * 8 - 4), vx: -40 - Math.random() * 40, vy: 20 + Math.random() * 30, life: 0, max: 0.4, r: 1.5 + Math.random() * 1.5, c: "rgba(255,240,220," });
  }

  function update(dt) {
    t += dt;
    if (flash > 0) flash = Math.max(0, flash - dt * 3);
    if (shake > 0) shake = Math.max(0, shake - dt * 30);

    // parallax always drifts a little; faster while playing
    var pf = running ? 1 : 0.18;
    scrollFar = (scrollFar + SPEED * 0.18 * pf * dt);
    scrollMid = (scrollMid + SPEED * 0.42 * pf * dt);
    for (var c = 0; c < clouds.length; c++) { clouds[c].x -= (clouds[c].sp * (running ? 1 : 0.4) * dt) / 10; if (clouds[c].x < -0.2) { clouds[c].x = 1.2; clouds[c].y = 0.1 + Math.random() * 0.4; } }

    if (running && !over) {
      plane.vy += GRAV * dt; plane.y += plane.vy * dt;
      plane.rot = Math.max(-0.5, Math.min(1.15, plane.vy * 0.0016));
      if (plane.y < HALF_H) { plane.y = HALF_H; if (plane.vy < 0) plane.vy = 0; }

      trail.push({ x: PLANE_X, y: plane.y }); if (trail.length > 14) trail.shift();

      for (var b = buildings.length - 1; b >= 0; b--) {
        var bd = buildings[b];
        bd.x -= SPEED * dt;
        if (!bd.scored && bd.x + PIPE_W < PLANE_X) { bd.scored = true; score++; scoreEl.textContent = String(score); sndScore(); }
        if (bd.x + PIPE_W < -20) buildings.splice(b, 1);
      }
      var last = buildings[buildings.length - 1];
      if (!last || last.x < W - PAIR_DIST) spawnBuilding((last ? last.x : W) + PAIR_DIST);

      // collisions
      var px0 = PLANE_X - HALF_W, px1 = PLANE_X + HALF_W, py0 = plane.y - HALF_H, py1 = plane.y + HALF_H;
      if (py1 >= floorY()) { die(); }
      else for (var k = 0; k < buildings.length; k++) {
        var g = buildings[k]; if (px1 < g.x || px0 > g.x + PIPE_W) continue;
        var gapTop = g.gapY - GAP / 2, gapBot = g.gapY + GAP / 2;
        if (py1 > gapBot) { die(); break; }                              // grounded skyscraper (full width)
        var gcx = g.x + PIPE_W / 2, mastB = Math.min(26, gapTop * 0.35);
        var envHW = PIPE_W * 0.45;                                       // airship envelope half-width
        if (px1 > gcx - 6 && px0 < gcx + 6 && py0 < mastB) { die(); break; }                         // mooring mast
        if (px1 > gcx - envHW && px0 < gcx + envHW && py0 < gapTop && py1 > mastB) { die(); break; }  // airship envelope
      }
    } else if (!started) {
      // gentle idle bob before the game starts
      plane.y = floorY() * 0.44 + Math.sin(t * 2) * 8; plane.rot = Math.sin(t * 2) * 0.12;
    }

    for (var p = particles.length - 1; p >= 0; p--) {
      var q = particles[p]; q.life += dt; q.vy += 300 * dt; q.x += q.vx * dt; q.y += q.vy * dt;
      if (q.life >= q.max) particles.splice(p, 1);
    }
  }

  function die() {
    if (over) return;
    over = true; running = false; shake = 9; flash = 1; sndCrash();
    for (var i = 0; i < 20; i++) { var a = Math.random() * 6.283, s = 60 + Math.random() * 240; particles.push({ x: PLANE_X, y: plane.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 60, life: 0, max: 0.7 + Math.random() * 0.5, r: 2 + Math.random() * 3, c: "rgba(255,240,220," }); }
    if (score > best) { best = score; try { localStorage.setItem("plane_best", String(best)); } catch (e) {} bestEl.textContent = "Best " + best; }
    setTimeout(function () {
      ovTitle.textContent = score >= best && score > 0 ? "New best!" : "Grounded";
      ovText.textContent = "You cleared " + score + " gap" + (score === 1 ? "" : "s") + ". Best: " + best + ".";
      ovBtn.textContent = "Fly again";
      overlay.hidden = false; overlay.classList.remove("is-hidden");
    }, 750);
  }

  // ---------------- render ----------------
  function render() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.save();
    if (shake > 0) ctx.translate((Math.random() * 2 - 1) * shake, (Math.random() * 2 - 1) * shake);

    var fy = floorY();
    // dusk sky
    var sky = ctx.createLinearGradient(0, 0, 0, fy);
    sky.addColorStop(0, "#1d1848"); sky.addColorStop(0.45, "#453363"); sky.addColorStop(0.78, "#a55668"); sky.addColorStop(1, "#f0a765");
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, fy);
    // sun glow near horizon
    var sx = W * 0.72, sy = fy * 0.9;
    var sun = ctx.createRadialGradient(sx, sy, 0, sx, sy, fy * 0.7);
    sun.addColorStop(0, "rgba(255,210,150,0.75)"); sun.addColorStop(0.35, "rgba(255,160,100,0.25)"); sun.addColorStop(1, "rgba(255,160,100,0)");
    ctx.fillStyle = sun; ctx.fillRect(0, 0, W, fy);
    ctx.fillStyle = "rgba(255,230,180,0.85)"; ctx.beginPath(); ctx.arc(sx, sy, fy * 0.11, 0, 6.2832); ctx.fill();

    // clouds
    for (var c = 0; c < clouds.length; c++) { var cl = clouds[c]; cloud(cl.x * W, cl.y * fy, cl.s * fy * 0.09); }

    // far + mid parallax skylines
    skyline(scrollFar, 240, fy, fy * 0.30, "rgba(38,28,58,0.55)", 12);
    skyline(scrollMid, 150, fy, fy * 0.44, "rgba(24,18,40,0.8)", 9);

    // obstacle buildings
    for (var b = 0; b < buildings.length; b++) drawBuilding(buildings[b], fy);

    // ground
    var gg = ctx.createLinearGradient(0, fy, 0, H);
    gg.addColorStop(0, "#2a2038"); gg.addColorStop(1, "#150f22");
    ctx.fillStyle = gg; ctx.fillRect(0, fy, W, GROUND);
    ctx.fillStyle = "rgba(255,190,120,0.85)";
    var lx = (-(scrollMid) % 34);
    for (var g = lx; g < W; g += 34) { ctx.beginPath(); ctx.arc(g, fy + 10, 1.7, 0, 6.2832); ctx.fill(); }
    ctx.fillStyle = "rgba(255,210,160,0.12)"; ctx.fillRect(0, fy, W, 2);

    // trail
    for (var i = 0; i < trail.length; i++) { var tp = trail[i], a = i / trail.length; ctx.globalAlpha = a * 0.32; ctx.fillStyle = "#fff4e0"; ctx.beginPath(); ctx.arc(tp.x - (trail.length - i) * 2.2, tp.y, 1.6 * a + 0.4, 0, 6.2832); ctx.fill(); }
    ctx.globalAlpha = 1;

    // paper plane
    drawPlane(PLANE_X, plane.y, plane.rot);

    // particles
    for (i = 0; i < particles.length; i++) { var q = particles[i], al = 1 - q.life / q.max; ctx.globalAlpha = Math.max(0, al); ctx.fillStyle = q.c + al + ")"; ctx.beginPath(); ctx.arc(q.x, q.y, q.r, 0, 6.2832); ctx.fill(); }
    ctx.globalAlpha = 1;

    ctx.restore();
    if (flash > 0) { ctx.fillStyle = "rgba(255,255,255," + (flash * 0.5) + ")"; ctx.fillRect(0, 0, W, H); }
  }

  function cloud(x, y, r) {
    ctx.fillStyle = "rgba(255,210,180,0.14)";
    ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.arc(x + r, y + r * 0.2, r * 0.8, 0, 6.2832); ctx.arc(x - r, y + r * 0.25, r * 0.7, 0, 6.2832); ctx.arc(x + r * 0.4, y - r * 0.4, r * 0.7, 0, 6.2832); ctx.fill();
  }

  function hsh(n) { n = Math.imul(n, 2654435761) >>> 0; n = (n ^ (n >>> 13)) >>> 0; return (n % 10007) / 10007; }
  function skyline(scroll, spacing, fy, maxH, color, seedBase) {
    // size derived from a stable per-building index so it scrolls smoothly (no flicker)
    ctx.fillStyle = color;
    var startIdx = Math.floor((scroll - spacing) / spacing), endIdx = Math.ceil((scroll + W + spacing) / spacing);
    for (var idx = startIdx; idx <= endIdx; idx++) {
      var bx = idx * spacing - scroll;
      var w = spacing * (0.55 + hsh(idx * 2 + seedBase) * 0.4);
      var h = maxH * (0.4 + hsh(idx * 2 + seedBase + 1) * 0.6);
      ctx.fillRect(bx, fy - h, w, h);
    }
  }

  function drawBuilding(bd, fy) {
    var x = bd.x, w = PIPE_W, gapTop = bd.gapY - GAP / 2, botY = bd.gapY + GAP / 2;
    drawAirship(x, gapTop, w, bd);                 // top = a moored airship
    drawTower(x, botY, w, fy - botY, bd, false);    // bottom = a grounded skyscraper
  }
  // a moored airship hanging from a mast at the top of the screen down to the gap
  function drawAirship(x, gapTop, w, bd) {
    var cx = x + w / 2, mastB = Math.min(26, gapTop * 0.35);
    var envW = w * 0.9, bodyTop = mastB, bodyBot = gapTop, envH = bodyBot - bodyTop, midY = (bodyTop + bodyBot) / 2, ry = envH / 2;
    // mooring mast + docking light
    ctx.strokeStyle = "#4a3a63"; ctx.lineWidth = 5; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, bodyTop + 3); ctx.stroke();
    ctx.fillStyle = "rgba(255,120,90,0.9)"; ctx.beginPath(); ctx.arc(cx, 3, 2, 0, 6.2832); ctx.fill();
    // tail fins at the bottom
    ctx.fillStyle = "#5b4a78";
    ctx.beginPath(); ctx.moveTo(cx, bodyBot); ctx.lineTo(cx - envW * 0.6, bodyBot - 8); ctx.lineTo(cx - envW * 0.3, bodyBot - 3); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(cx, bodyBot); ctx.lineTo(cx + envW * 0.6, bodyBot - 8); ctx.lineTo(cx + envW * 0.3, bodyBot - 3); ctx.closePath(); ctx.fill();
    // envelope
    var g = ctx.createLinearGradient(cx - envW / 2, 0, cx + envW / 2, 0);
    g.addColorStop(0, "#cec1e2"); g.addColorStop(0.5, "#a28cbe"); g.addColorStop(1, "#6d5a86");
    ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(cx, midY, envW / 2, ry, 0, 0, 6.2832); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.13)"; ctx.beginPath(); ctx.ellipse(cx - envW * 0.15, midY, envW * 0.13, Math.min(ry * 0.9, envH * 0.4), 0, 0, 6.2832); ctx.fill();
    // stripe rings following the curve
    ctx.strokeStyle = "rgba(66,48,86,0.5)"; ctx.lineWidth = 2;
    for (var s = 1; s <= 2; s++) { var yy = bodyTop + envH * (s / 3), tt = (yy - midY) / ry, hw = Math.sqrt(Math.max(0, 1 - tt * tt)) * envW / 2; if (hw > 2) { ctx.beginPath(); ctx.moveTo(cx - hw, yy); ctx.lineTo(cx + hw, yy); ctx.stroke(); } }
    // gondola with warm lit windows
    if (envH > 34) {
      var gw = envW * 0.5, gh = Math.min(15, envH * 0.2), gy = bodyBot - gh - 8;
      ctx.fillStyle = "#37294c"; ctx.beginPath(); ctx.roundRect(cx - gw / 2, gy, gw, gh, 3); ctx.fill();
      ctx.fillStyle = "rgba(255,214,150,0.92)"; for (var i = 0; i < 3; i++) ctx.fillRect(cx - gw / 2 + 5 + i * (gw - 10) / 3, gy + gh / 2 - 2.5, (gw - 10) / 3 * 0.55, 5);
    }
  }
  function drawTower(x, y, w, h, bd, isTop) {
    if (h <= 0) return;
    var g = ctx.createLinearGradient(x, 0, x + w, 0);
    g.addColorStop(0, "#3a2f52"); g.addColorStop(0.5, "#4a3a63"); g.addColorStop(1, "#2c2340");
    ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
    // lit cap edge (the end nearest the gap)
    ctx.fillStyle = "#5c4a78"; ctx.fillRect(x, isTop ? y + h - 6 : y, w, 6);
    ctx.fillStyle = "rgba(255,200,140,0.5)"; ctx.fillRect(x, isTop ? y + h - 7 : y + 6, w, 1.5);
    // windows
    var cols = Math.max(2, Math.round(w / 20)), pad = w * 0.16, gx = (w - pad * 2) / cols, ww = gx * 0.55;
    var rows = Math.max(1, Math.floor(h / 22));
    for (var r = 0; r < rows; r++) for (var cc = 0; cc < cols; cc++) {
      var lit = ((r * 7 + cc * 3 + bd.seed) % 5) > 1;
      ctx.fillStyle = lit ? "rgba(255,214,150,0.92)" : "rgba(30,24,48,0.6)";
      ctx.fillRect(x + pad + cc * gx + (gx - ww) / 2, y + 12 + r * 22, ww, 10);
    }
    // rooftop feature on top-hanging towers (antenna)
    if (!isTop && bd.roof) { ctx.strokeStyle = "#5c4a78"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x + w / 2, y); ctx.lineTo(x + w / 2, y - 14); ctx.stroke(); ctx.fillStyle = "rgba(255,120,90,0.9)"; ctx.beginPath(); ctx.arc(x + w / 2, y - 14, 2.2, 0, 6.2832); ctx.fill(); }
  }

  function drawPlane(x, y, rot) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
    // soft shadow
    ctx.fillStyle = "rgba(0,0,0,0.18)"; tri(3, 5, "#000");
    // upper (lit) and lower (shadowed) folds
    ctx.beginPath(); ctx.moveTo(17, 0); ctx.lineTo(-15, -11); ctx.lineTo(-6, 0); ctx.closePath(); ctx.fillStyle = "#fff8ee"; ctx.fill();
    ctx.beginPath(); ctx.moveTo(17, 0); ctx.lineTo(-6, 0); ctx.lineTo(-15, 11); ctx.closePath(); ctx.fillStyle = "#e5d6c2"; ctx.fill();
    // crease + tail fin
    ctx.strokeStyle = "rgba(120,100,80,0.55)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(17, 0); ctx.lineTo(-6, 0); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-6, 0); ctx.lineTo(-15, -11); ctx.lineTo(-13, 0); ctx.closePath(); ctx.fillStyle = "#f2e6d6"; ctx.fill();
    ctx.strokeStyle = "rgba(120,100,80,0.35)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(17, 0); ctx.lineTo(-15, -11); ctx.lineTo(-6, 0); ctx.lineTo(-15, 11); ctx.closePath(); ctx.stroke();
    ctx.restore();
  }
  function tri(ox, oy) { ctx.beginPath(); ctx.moveTo(17 + ox, oy); ctx.lineTo(-15 + ox, -11 + oy); ctx.lineTo(-15 + ox, 11 + oy); ctx.closePath(); ctx.fill(); }

  var last = 0;
  function frame(ts) {
    var dt = last ? Math.min((ts - last) / 1000, 0.05) : 0.016; last = ts;
    update(dt); render();
    requestAnimationFrame(frame);
  }

  // ---------------- input ----------------
  function startGame() {
    overlay.classList.add("is-hidden"); setTimeout(function () { overlay.hidden = true; }, 200);
    started = true; running = true; over = false;
    plane.y = floorY() * 0.44; plane.vy = FLAP * 0.6;
    hintEl.classList.remove("is-gone");
    setTimeout(function () { hintEl.classList.add("is-gone"); }, 4000);
  }
  function tap() { if (over) return; if (!started) { startGame(); return; } flap(); }
  canvas.addEventListener("pointerdown", function (e) { e.preventDefault(); tap(); });
  window.addEventListener("keydown", function (e) { if (e.code === "Space" || e.code === "ArrowUp") { e.preventDefault(); tap(); } });
  ovBtn.addEventListener("click", function () { if (over) { reset(); } startGame(); });
  soundBtn.addEventListener("click", function () {
    soundOn = !soundOn; soundBtn.setAttribute("aria-pressed", soundOn ? "true" : "false");
    if (outGain) outGain.gain.value = soundOn ? 1 : 0; unlock();
  });

  // ============================ AUDIO ============================
  var actx = null, master = null, outGain = null, convo = null, wet = null;
  function initAudio() {
    if (actx) return;
    try {
      actx = new (window.AudioContext || window.webkitAudioContext)();
      outGain = actx.createGain(); outGain.gain.value = soundOn ? 1 : 0;
      master = actx.createGain(); master.gain.value = 0.85;
      convo = actx.createConvolver(); convo.buffer = makeImpulse(1.2, 3);
      wet = actx.createGain(); wet.gain.value = 0.14;
      master.connect(outGain); wet.connect(convo); convo.connect(outGain); outGain.connect(actx.destination);
    } catch (e) { actx = null; }
  }
  function makeImpulse(dur, decay) {
    var n = Math.floor(actx.sampleRate * dur), buf = actx.createBuffer(2, n, actx.sampleRate);
    for (var ch = 0; ch < 2; ch++) { var d = buf.getChannelData(ch); for (var i = 0; i < n; i++) { var tt = i / n; d[i] = (Math.random() * 2 - 1) * Math.pow(1 - tt, decay); } }
    return buf;
  }
  function unlock() { initAudio(); if (actx && actx.state === "suspended") actx.resume(); if (actx) { var b = actx.createBuffer(1, 1, 22050), s = actx.createBufferSource(); s.buffer = b; s.connect(actx.destination); s.start(0); } }
  function bus(g) { g.connect(master); g.connect(wet); }
  function noise(dur) { var n = Math.floor(actx.sampleRate * dur), b = actx.createBuffer(1, n, actx.sampleRate), d = b.getChannelData(0); for (var i = 0; i < n; i++) d[i] = Math.random() * 2 - 1; var s = actx.createBufferSource(); s.buffer = b; return s; }
  function sndFlap() {
    if (!actx || !soundOn) return; var t0 = actx.currentTime;
    var s = noise(0.12), bp = actx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.setValueAtTime(900, t0); bp.frequency.exponentialRampToValueAtTime(2600, t0 + 0.09); bp.Q.value = 0.7;
    var g = actx.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.12, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0006, t0 + 0.12);
    s.connect(bp); bp.connect(g); bus(g); s.start(t0); s.stop(t0 + 0.13);
  }
  function sndScore() {
    if (!actx || !soundOn) return; var t0 = actx.currentTime;
    var o = actx.createOscillator(); o.type = "triangle"; o.frequency.setValueAtTime(680, t0); o.frequency.exponentialRampToValueAtTime(1020, t0 + 0.08);
    var g = actx.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.13, t0 + 0.01); g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.16);
    o.connect(g); bus(g); o.start(t0); o.stop(t0 + 0.18);
  }
  function sndCrash() {
    if (!actx || !soundOn) return; var t0 = actx.currentTime;
    var o = actx.createOscillator(); o.type = "sine"; o.frequency.setValueAtTime(220, t0); o.frequency.exponentialRampToValueAtTime(60, t0 + 0.35);
    var g = actx.createGain(); g.gain.setValueAtTime(0.24, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.4);
    o.connect(g); bus(g); o.start(t0); o.stop(t0 + 0.42);
    var s = noise(0.22), lp = actx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 1800;
    var g2 = actx.createGain(); g2.gain.setValueAtTime(0.16, t0); g2.gain.exponentialRampToValueAtTime(0.001, t0 + 0.22);
    s.connect(lp); lp.connect(g2); bus(g2); s.start(t0); s.stop(t0 + 0.23);
  }

  // ---------------- boot ----------------
  reset();
  overlay.hidden = false;
  requestAnimationFrame(frame);
})();
