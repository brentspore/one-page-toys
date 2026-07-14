/* Nova Coil — a marble-shooter chain matcher. A chain of glowing orbs spirals
 * toward a reactor core; aim the cannon, fire an orb, and land 3+ of a colour
 * in a row to blast them. Gaps close and can chain into combos. Clear the coil
 * before it reaches the core. Vanilla Canvas 2D + Web Audio. */
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

  // tunables
  var SPEED0 = 24, SPEED_WAVE = 5, DANGER_MULT = 1.7, DANGER_AT = 0.72;
  var CATCHUP = 520, PROJ_SPEED = 940, SPAWN0 = 44, SPAWN_WAVE = 10;

  // neon palette (colour id = index). glow = rgba prefix.
  var PALETTE = [
    { g: "#b9f7ff", m: "#25c8e6", d: "#0b5f74", glow: "rgba(60,220,255," },
    { g: "#ffb6e4", m: "#ff49af", d: "#8c1c66", glow: "rgba(255,90,190," },
    { g: "#fff0a8", m: "#ffcb35", d: "#977010", glow: "rgba(255,205,70," },
    { g: "#c1ffb6", m: "#48e05c", d: "#1a7d2c", glow: "rgba(95,235,110," },
    { g: "#dcbcff", m: "#a45cff", d: "#571f9c", glow: "rgba(175,110,255," },
    { g: "#ffca9a", m: "#ff7a38", d: "#983b10", glow: "rgba(255,135,70," }
  ];

  var R = 16, D = 32, PROJR = 15;
  var track = null, L = 0;

  // state
  var chain = [];          // {c, s, wasFlush} — chain[0] = leader (largest s, nearest core)
  var projectiles = [];
  var particles = [];
  var shooter = { x: 0, y: 0, aim: -Math.PI / 2, cur: 0, next: 0, coolT: 0 };
  var mouse = { x: 0, y: 0 };
  var spawnRemaining = 0, wave = 1, speed = SPEED0;
  var score = 0, best = 0, combo = 0, comboT = 0;
  var running = false, over = false, soundOn = true;
  var shake = 0, waveFlash = 0, dangerLevel = 0, holeSpin = 0, starT = 0;

  try { best = parseInt(localStorage.getItem("nova_best"), 10) || 0; } catch (e) { best = 0; }
  bestEl.textContent = "Best " + best;

  function activeColorCount() { return Math.min(6, 4 + Math.floor((wave - 1) / 2)); }

  // ---------------- track (spiral) ----------------
  function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

  // A fresh coil per wave — seeded by the wave number so it's stable across a
  // resize but distinct every level (turns / direction / phase / squish / lobes).
  function buildTrack() {
    R = Math.max(13, Math.min(20, Math.min(W, H) / 40)); D = R * 2; PROJR = R * 0.94;
    var cx = W / 2, cy = H * 0.53;
    var rng = mulberry((wave * 2654435761) >>> 0);
    var turns = 2.4 + rng() * 1.3;
    var dir = rng() < 0.5 ? 1 : -1;
    var startAngle = rng() * Math.PI * 2;
    var innerR = R * (2.3 + rng() * 1.1);
    var squish = 0.9 + rng() * 0.2;                          // gentle oval — still reads as a circle
    var outerScale = 0.82 + rng() * 0.18;                    // size variety within the frame
    var yScale = squish, xScale = 1;
    var outerR = Math.min(Math.min(W, H) * 0.46, (Math.min(cy, H - cy) - 34) / yScale, (W * 0.5 - 34) / xScale) * outerScale;
    outerR = Math.max(outerR, innerR + R * 4.5);
    var thetaMax = Math.PI * 2 * turns, steps = 1000, pts = [];
    for (var i = 0; i <= steps; i++) {
      var f = i / steps;                    // 0 = outer start (s=0), 1 = inner hole (s=L)
      var theta = thetaMax * (1 - f);
      var r = innerR + (outerR - innerR) * (theta / thetaMax);
      var ang = startAngle + theta * dir;
      pts.push({ x: cx + Math.cos(ang) * r, y: cy + Math.sin(ang) * r * squish });
    }
    var s = [0];
    for (i = 1; i < pts.length; i++) s[i] = s[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    L = s[s.length - 1];
    track = { pts: pts, s: s, cx: cx, cy: cy, hole: pts[pts.length - 1] };
    shooter.x = cx; shooter.y = cy;
  }
  function posAt(sv) {
    if (sv <= 0) return track.pts[0];
    if (sv >= L) return track.hole;
    var s = track.s, lo = 0, hi = s.length - 1;
    while (lo + 1 < hi) { var m = (lo + hi) >> 1; if (s[m] <= sv) lo = m; else hi = m; }
    var t = (sv - s[lo]) / ((s[hi] - s[lo]) || 1), a = track.pts[lo], b = track.pts[hi];
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  }
  // Nearest arc-length to (x,y) but ONLY within `win` of `sc`. The spiral loops back on
  // itself, so a global nearest-point search can snap a shot onto an arm far ahead of the
  // ball it actually struck (making it the new leader and yanking the whole chain toward
  // the core). Localising to the neighbourhood of the hit ball keeps insertion where the
  // collision happened.
  function nearestSNear(x, y, sc, win) {
    var best = sc, bd = 1e9, p = track.pts, s = track.s;
    for (var i = 0; i < p.length; i++) {
      var si = s[i];
      if (si < sc - win || si > sc + win) continue;
      var dx = p[i].x - x, dy = p[i].y - y, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = si; }
    }
    return best;
  }

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.floor(W * DPR); canvas.height = Math.floor(H * DPR);
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    buildTrack();
  }
  window.addEventListener("resize", resize);

  // ---------------- game flow ----------------
  function reset() {
    wave = 1; buildTrack();
    chain = []; projectiles = []; particles = [];
    speed = SPEED0; spawnRemaining = SPAWN0;
    score = 0; combo = 0; comboT = 0; over = false; dangerLevel = 0; shake = 0;
    scoreEl.textContent = "0";
    shooter.cur = pickWaveColor(); shooter.next = pickWaveColor(); shooter.coolT = 0;
  }
  function startGame() {
    overlay.classList.add("is-hidden"); setTimeout(function () { overlay.hidden = true; }, 200);
    running = true; hintEl.classList.remove("is-gone");
    setTimeout(function () { hintEl.classList.add("is-gone"); }, 5000);
  }
  function nextWave() {
    wave++; buildTrack();                 // a fresh coil each level
    speed = SPEED0 + (wave - 1) * SPEED_WAVE; spawnRemaining = SPAWN0 + (wave - 1) * SPAWN_WAVE;
    waveFlash = 1.4; sndWave();
  }
  function gameOver() {
    over = true; running = false;
    if (score > best) { best = score; try { localStorage.setItem("nova_best", String(best)); } catch (e) {} }
    bestEl.textContent = "Best " + best;
    ovTitle.textContent = score >= best && score > 0 ? "New best!" : "Core breached";
    ovText.textContent = "You scored " + score + " over " + wave + " wave" + (wave === 1 ? "" : "s") + ". Best: " + best + ".";
    ovBtn.textContent = "Play again";
    overlay.hidden = false; overlay.classList.remove("is-hidden");
    sndLose();
  }

  function pickWaveColor() {
    var n = activeColorCount();
    return (Math.random() * n) | 0;
  }
  function pickShotColor() {
    var present = {}, keys = [];
    for (var i = 0; i < chain.length; i++) if (!present[chain[i].c]) { present[chain[i].c] = 1; keys.push(chain[i].c); }
    if (!keys.length) return pickWaveColor();
    return keys[(Math.random() * keys.length) | 0];
  }

  // ---------------- chain mechanics ----------------
  function spawn() {
    if (spawnRemaining <= 0) return;
    if (!chain.length) { chain.push({ c: pickWaveColor(), s: 0, wasFlush: true }); spawnRemaining--; return; }
    var tail = chain[chain.length - 1];
    if (tail.s >= D) { chain.push({ c: pickWaveColor(), s: tail.s - D, wasFlush: true }); spawnRemaining--; }
  }

  function insertBall(cid, sv) {
    var idx = 0; while (idx < chain.length && chain[idx].s > sv) idx++;
    chain.splice(idx, 0, { c: cid, s: sv, wasFlush: false });
    if (idx > 0 && chain[idx].s > chain[idx - 1].s - D) chain[idx].s = chain[idx - 1].s - D;
    for (var k = idx + 1; k < chain.length; k++) if (chain[k].s > chain[k - 1].s - D) chain[k].s = chain[k - 1].s - D;
    return idx;
  }

  // remove the same-colour run covering anchor if it's 3+, return count removed
  function clearRun(anchor) {
    if (anchor < 0 || anchor >= chain.length) return 0;
    var c = chain[anchor].c, lo = anchor, hi = anchor;
    while (lo > 0 && chain[lo - 1].c === c) lo--;
    while (hi < chain.length - 1 && chain[hi + 1].c === c) hi++;
    var n = hi - lo + 1;
    if (n < 3) return 0;
    for (var i = lo; i <= hi; i++) { var p = posAt(chain[i].s); popBurst(p.x, p.y, chain[i].c); }
    chain.splice(lo, n);
    return n;
  }

  function scorePop(n, combo) {
    var pts = n * 10 * combo;
    score += pts; scoreEl.textContent = String(score);
    sndPop(combo);
    if (combo >= 3) shake = Math.min(10, 3 + combo);
  }

  function update(dt) {
    starT += dt; holeSpin += dt * 0.9;
    if (waveFlash > 0) waveFlash -= dt;
    if (shake > 0) shake = Math.max(0, shake - dt * 26);
    if (comboT > 0) { comboT -= dt; if (comboT <= 0) combo = 0; }
    shooter.coolT = Math.max(0, shooter.coolT - dt);
    shooter.aim = Math.atan2(mouse.y - shooter.y, mouse.x - shooter.x);

    if (!running || over) { updateParticles(dt); return; }

    spawn();

    // danger + advance
    var lead = chain.length ? chain[0].s : 0;
    dangerLevel = Math.max(0, (lead / L - DANGER_AT) / (1 - DANGER_AT));
    var sp = speed * (1 + dangerLevel * (DANGER_MULT - 1));

    if (chain.length) {
      chain[0].s += sp * dt;
      if (chain[0].s >= L) { chain[0].s = L; gameOver(); }
      for (var i = 1; i < chain.length; i++) {
        var maxS = chain[i - 1].s - D, b = chain[i];
        var flushNow;
        if (b.s < maxS - 0.4) { b.s = Math.min(maxS, b.s + (sp + CATCHUP) * dt); flushNow = b.s >= maxS - 0.4; }
        else { b.s = maxS; flushNow = true; }
        if (flushNow && !b.wasFlush) {                 // a gap just closed here → combo check
          if (chain[i - 1].c === b.c) {
            var removed = clearRun(i);
            if (removed) { combo++; comboT = 0.9; scorePop(removed, combo); }
          }
        }
        b.wasFlush = flushNow;
      }
    } else if (spawnRemaining <= 0) {
      nextWave();
    }

    // projectiles
    for (var p = projectiles.length - 1; p >= 0; p--) {
      var pr = projectiles[p];
      pr.x += pr.vx * dt; pr.y += pr.vy * dt;
      pr.trail.push({ x: pr.x, y: pr.y }); if (pr.trail.length > 7) pr.trail.shift();
      var hit = -1, hd = (R + PROJR) * (R + PROJR);
      for (var j = 0; j < chain.length; j++) { var cp = posAt(chain[j].s), dx = cp.x - pr.x, dy = cp.y - pr.y; if (dx * dx + dy * dy < hd) { hit = j; break; } }
      var off = pr.x < -40 || pr.x > W + 40 || pr.y < -40 || pr.y > H + 40;
      if (hit >= 0) {
        var sv = nearestSNear(pr.x, pr.y, chain[hit].s, D * 2.5), idx = insertBall(pr.c, sv);
        var removed2 = clearRun(idx);
        if (removed2) { combo = 1; comboT = 0.9; scorePop(removed2, 1); }
        else sndClack();
        projectiles.splice(p, 1);
      } else if (off) projectiles.splice(p, 1);
    }

    updateParticles(dt);
  }

  function updateParticles(dt) {
    for (var i = particles.length - 1; i >= 0; i--) {
      var q = particles[i]; q.life += dt; q.vx *= 0.94; q.vy *= 0.94; q.x += q.vx * dt; q.y += q.vy * dt;
      if (q.life >= q.max) particles.splice(i, 1);
    }
  }
  function popBurst(x, y, cid) {
    var col = PALETTE[cid];
    for (var i = 0; i < 12; i++) { var a = Math.random() * 6.283, sp = 60 + Math.random() * 260; particles.push({ x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0, max: 0.5 + Math.random() * 0.4, r: 1.5 + Math.random() * 3, col: col }); }
  }

  function fire() {
    if (!running || over || shooter.coolT > 0) return;
    unlock();
    var a = shooter.aim, sp = PROJ_SPEED;
    projectiles.push({ x: shooter.x + Math.cos(a) * R * 1.6, y: shooter.y + Math.sin(a) * R * 1.6, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, c: shooter.cur, trail: [] });
    shooter.cur = shooter.next; shooter.next = pickShotColor(); shooter.coolT = 0.16;
    sndFire();
  }
  function swap() { var t = shooter.cur; shooter.cur = shooter.next; shooter.next = t; sndSwap(); }

  // ---------------- render ----------------
  var stars = [];
  function ensureStars() { if (stars.length) return; var sd = 7; function r() { sd = (sd * 9301 + 49297) % 233280; return sd / 233280; } for (var i = 0; i < 130; i++) stars.push({ x: r(), y: r(), r: r() * 1.5 + 0.3, tw: r() * 6 }); }

  function drawMarble(x, y, r, cid, alpha) {
    var p = PALETTE[cid]; alpha = alpha == null ? 1 : alpha;
    ctx.globalCompositeOperation = "lighter";
    var gl = ctx.createRadialGradient(x, y, r * 0.4, x, y, r * 1.8);
    gl.addColorStop(0, p.glow + (0.55 * alpha) + ")"); gl.addColorStop(1, p.glow + "0)");
    ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(x, y, r * 1.8, 0, 6.2832); ctx.fill();
    ctx.globalCompositeOperation = "source-over";
    var bg = ctx.createRadialGradient(x - r * 0.34, y - r * 0.4, r * 0.1, x, y, r);
    bg.addColorStop(0, p.g); bg.addColorStop(0.5, p.m); bg.addColorStop(1, p.d);
    ctx.globalAlpha = alpha; ctx.fillStyle = bg; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.8)"; ctx.beginPath(); ctx.arc(x - r * 0.34, y - r * 0.4, r * 0.17, 0, 6.2832); ctx.fill();
    ctx.globalAlpha = 1;
  }

  function render() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.save();
    if (shake > 0) ctx.translate((Math.random() * 2 - 1) * shake, (Math.random() * 2 - 1) * shake);

    // space bg
    var bg = ctx.createRadialGradient(track.cx, track.cy, 0, track.cx, track.cy, Math.max(W, H) * 0.75);
    bg.addColorStop(0, "#0d1230"); bg.addColorStop(0.6, "#070914"); bg.addColorStop(1, "#04050c");
    ctx.fillStyle = bg; ctx.fillRect(-20, -20, W + 40, H + 40);
    ensureStars();
    for (var i = 0; i < stars.length; i++) { var s = stars[i], tw = 0.5 + 0.5 * Math.sin(starT * 2 + s.tw); ctx.globalAlpha = tw; ctx.fillStyle = "#cfe6ff"; ctx.beginPath(); ctx.arc(s.x * W, s.y * H, s.r, 0, 6.2832); ctx.fill(); }
    ctx.globalAlpha = 1;

    // track channel
    var pts = track.pts;
    ctx.lineJoin = "round"; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y); for (i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.strokeStyle = "rgba(90,150,220,0.10)"; ctx.lineWidth = D * 1.15; ctx.stroke();
    ctx.strokeStyle = "rgba(120,190,255,0.16)"; ctx.lineWidth = D * 0.92; ctx.stroke();
    ctx.strokeStyle = "rgba(150,210,255,0.10)"; ctx.lineWidth = 2; ctx.stroke();

    // the core / hole (goal)
    var ho = track.hole, dp = 0.5 + 0.5 * Math.sin(starT * 3) * dangerLevel;
    ctx.save(); ctx.globalCompositeOperation = "lighter";
    var hg = ctx.createRadialGradient(ho.x, ho.y, 0, ho.x, ho.y, R * 3.2);
    var hc = dangerLevel > 0.01 ? "rgba(255,90,70," : "rgba(120,90,255,";
    hg.addColorStop(0, hc + (0.5 + 0.4 * dp) + ")"); hg.addColorStop(0.5, hc + "0.18)"); hg.addColorStop(1, hc + "0)");
    ctx.fillStyle = hg; ctx.beginPath(); ctx.arc(ho.x, ho.y, R * 3.2, 0, 6.2832); ctx.fill();
    ctx.restore();
    ctx.fillStyle = "#05060f"; ctx.beginPath(); ctx.arc(ho.x, ho.y, R * 1.05, 0, 6.2832); ctx.fill();
    for (var k = 0; k < 5; k++) { var a = holeSpin + k * 1.2566; ctx.strokeStyle = (dangerLevel > 0.01 ? "rgba(255,120,90," : "rgba(150,120,255,") + "0.5)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(ho.x, ho.y, R * 0.95, a, a + 0.7); ctx.stroke(); }

    // chain
    for (i = chain.length - 1; i >= 0; i--) { var cp = posAt(chain[i].s); drawMarble(cp.x, cp.y, R, chain[i].c, 1); }

    // shooter core
    drawShooter();

    // projectiles
    for (i = 0; i < projectiles.length; i++) {
      var pr = projectiles[i];
      for (var t = 0; t < pr.trail.length; t++) { var tp = pr.trail[t]; ctx.globalAlpha = (t / pr.trail.length) * 0.4; drawMarble(tp.x, tp.y, R * 0.6, pr.c, 0.5); }
      ctx.globalAlpha = 1; drawMarble(pr.x, pr.y, PROJR, pr.c, 1);
    }

    // particles
    ctx.globalCompositeOperation = "lighter";
    for (i = 0; i < particles.length; i++) { var q = particles[i], al = 1 - q.life / q.max; ctx.globalAlpha = al; ctx.fillStyle = q.col.g; ctx.beginPath(); ctx.arc(q.x, q.y, q.r, 0, 6.2832); ctx.fill(); }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";

    // danger vignette
    if (dangerLevel > 0.01) {
      var vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.6);
      vg.addColorStop(0, "rgba(255,40,40,0)"); vg.addColorStop(1, "rgba(255,30,30," + (0.28 * dangerLevel * (0.7 + 0.3 * Math.sin(starT * 8))) + ")");
      ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
    }

    // wave flash
    if (waveFlash > 0) {
      ctx.globalAlpha = Math.min(1, waveFlash); ctx.fillStyle = "#eafcff"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.font = "900 " + Math.max(26, W * 0.05) + "px Archivo, system-ui, sans-serif";
      ctx.fillText("WAVE " + wave, W / 2, H * 0.3); ctx.globalAlpha = 1;
    }

    ctx.restore();
  }

  function drawShooter() {
    var x = shooter.x, y = shooter.y, a = shooter.aim;
    // aim tracer
    ctx.save(); ctx.globalAlpha = 0.28; ctx.strokeStyle = PALETTE[shooter.cur].m; ctx.lineWidth = 2; ctx.setLineDash([4, 8]);
    ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * R * 1.7, y + Math.sin(a) * R * 1.7); ctx.lineTo(x + Math.cos(a) * R * 9, y + Math.sin(a) * R * 9); ctx.stroke(); ctx.restore();
    // barrel
    ctx.save(); ctx.translate(x, y); ctx.rotate(a);
    ctx.fillStyle = "#1a2340"; ctx.strokeStyle = "rgba(120,190,255,0.5)"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect(-R * 0.3, -R * 0.55, R * 2.1, R * 1.1, R * 0.4); ctx.fill(); ctx.stroke();
    ctx.restore();
    // core ring
    ctx.save(); ctx.globalCompositeOperation = "lighter";
    var rg = ctx.createRadialGradient(x, y, 0, x, y, R * 2.1);
    rg.addColorStop(0, "rgba(120,200,255,0.5)"); rg.addColorStop(0.6, "rgba(90,140,255,0.15)"); rg.addColorStop(1, "rgba(90,140,255,0)");
    ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(x, y, R * 2.1, 0, 6.2832); ctx.fill(); ctx.restore();
    ctx.fillStyle = "#0c1330"; ctx.strokeStyle = "rgba(140,200,255,0.6)"; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(x, y, R * 1.4, 0, 6.2832); ctx.fill(); ctx.stroke();
    // loaded orb + next
    drawMarble(x, y, R * 0.95, shooter.cur, 1);
    var nx = x - Math.cos(a) * R * 2.4, ny = y - Math.sin(a) * R * 2.4;
    drawMarble(nx, ny, R * 0.55, shooter.next, 0.85);
  }

  var last = 0;
  function frame(ts) {
    var dt = last ? Math.min((ts - last) / 1000, 0.05) : 0.016; last = ts;
    update(dt); render();
    requestAnimationFrame(frame);
  }

  // ---------------- input ----------------
  function pointer(e) { mouse.x = e.clientX; mouse.y = e.clientY; }
  canvas.addEventListener("pointermove", pointer);
  canvas.addEventListener("pointerdown", function (e) {
    e.preventDefault(); pointer(e); unlock();
    if (over) return;
    if (!running) { startGame(); return; }
    var dx = e.clientX - shooter.x, dy = e.clientY - shooter.y;
    if (dx * dx + dy * dy < (R * 1.8) * (R * 1.8)) { swap(); return; }   // tap the core to swap
    shooter.aim = Math.atan2(dy, dx); fire();
  });
  canvas.addEventListener("contextmenu", function (e) { e.preventDefault(); if (running && !over) swap(); });
  window.addEventListener("keydown", function (e) { if (e.code === "Space") { e.preventDefault(); if (running && !over) swap(); } });
  ovBtn.addEventListener("click", function () { if (over) reset(); startGame(); });
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
      convo = actx.createConvolver(); convo.buffer = makeImpulse(1.6, 3);
      wet = actx.createGain(); wet.gain.value = 0.2;
      master.connect(outGain); wet.connect(convo); convo.connect(outGain); outGain.connect(actx.destination);
    } catch (e) { actx = null; }
  }
  function makeImpulse(dur, decay) {
    var n = Math.floor(actx.sampleRate * dur), buf = actx.createBuffer(2, n, actx.sampleRate);
    for (var ch = 0; ch < 2; ch++) { var d = buf.getChannelData(ch); for (var i = 0; i < n; i++) { var t = i / n; d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay); } }
    return buf;
  }
  function unlock() { initAudio(); if (actx && actx.state === "suspended") actx.resume(); if (actx) { var b = actx.createBuffer(1, 1, 22050), s = actx.createBufferSource(); s.buffer = b; s.connect(actx.destination); s.start(0); } }
  function bus(g) { g.connect(master); g.connect(wet); }
  function noise(dur) { var n = Math.floor(actx.sampleRate * dur), b = actx.createBuffer(1, n, actx.sampleRate), d = b.getChannelData(0); for (var i = 0; i < n; i++) d[i] = Math.random() * 2 - 1; var s = actx.createBufferSource(); s.buffer = b; return s; }
  function tone(type, f0, f1, t0, dur, vol) {
    var o = actx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t0); if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    var g = actx.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + 0.008); g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
    o.connect(g); bus(g); o.start(t0); o.stop(t0 + dur + 0.02);
  }
  function sndFire() { if (!actx || !soundOn) return; var t = actx.currentTime; tone("triangle", 640, 300, t, 0.14, 0.14); var s = noise(0.05), bp = actx.createBiquadFilter(); bp.type = "highpass"; bp.frequency.value = 1600; var g = actx.createGain(); g.gain.setValueAtTime(0.09, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.05); s.connect(bp); bp.connect(g); bus(g); s.start(t); s.stop(t + 0.06); }
  function sndClack() { if (!actx || !soundOn) return; var t = actx.currentTime; tone("sine", 300, 180, t, 0.09, 0.12); }
  function sndSwap() { if (!actx || !soundOn) return; var t = actx.currentTime; tone("triangle", 420, 620, t, 0.08, 0.08); }
  function sndPop(combo) {
    if (!actx || !soundOn) return; var t = actx.currentTime;
    var base = 523.25 * Math.pow(2, Math.min(combo - 1, 10) / 12);
    tone("triangle", base, base * 1.5, t, 0.28, 0.16);
    tone("sine", base * 2, base * 2, t + 0.02, 0.2, 0.08);
    var s = noise(0.08), bp = actx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = base * 2; var g = actx.createGain(); g.gain.setValueAtTime(0.08, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.08); s.connect(bp); bp.connect(g); bus(g); s.start(t); s.stop(t + 0.09);
  }
  function sndWave() { if (!actx || !soundOn) return; var t = actx.currentTime; [0, 4, 7, 12].forEach(function (st, i) { tone("triangle", 392 * Math.pow(2, st / 12), 392 * Math.pow(2, st / 12), t + i * 0.09, 0.5, 0.12); }); }
  function sndLose() { if (!actx || !soundOn) return; var t = actx.currentTime; tone("sawtooth", 220, 60, t, 0.9, 0.16); var s = noise(0.7), lp = actx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.setValueAtTime(900, t); lp.frequency.exponentialRampToValueAtTime(120, t + 0.6); var g = actx.createGain(); g.gain.setValueAtTime(0.22, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.8); s.connect(lp); lp.connect(g); bus(g); s.start(t); s.stop(t + 0.82); }

  // ---------------- boot ----------------
  resize();
  reset();
  overlay.hidden = false;
  requestAnimationFrame(frame);
})();
