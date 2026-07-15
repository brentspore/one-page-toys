/* Nova Coil — a marble-shooter chain matcher. A chain of glowing orbs spirals
 * toward a reactor core; aim the cannon, fire an orb, and land 3+ of a color
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
  var RETRACT = 300, PROJ_SPEED = 940, SPAWN0 = 44, SPAWN_WAVE = 10;

  // neon palette (color id = index). glow = rgba prefix.
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
  var chain = [];          // {c, s} — chain[0] = leader (largest s, nearest core)
  var projectiles = [];
  var particles = [];
  var floaters = [];       // rising reward labels ("+score", "CHAIN xN")
  var obstacles = [];      // asteroids floating in the coil's open pockets, they block shots
  var shooter = { x: 0, y: 0, aim: -Math.PI / 2, cur: 0, next: 0, coolT: 0 };
  var mouse = { x: 0, y: 0 };
  var spawnRemaining = 0, wave = 1, speed = SPEED0;
  var score = 0, best = 0, combo = 0, comboT = 0;
  var running = false, over = false, soundOn = true;
  var shake = 0, waveFlash = 0, dangerLevel = 0, holeSpin = 0, starT = 0;
  var lastClear = { x: 0, y: 0, cid: 0 }, comboFlash = 0, comboFlashCid = 0, chainBanner = null;

  try { best = parseInt(localStorage.getItem("nova_best"), 10) || 0; } catch (e) { best = 0; }
  bestEl.textContent = "Best " + best;

  function activeColorCount() { return Math.min(6, 4 + Math.floor((wave - 1) / 2)); }

  // ---------------- track (spiral) ----------------
  function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

  // A fresh coil per wave — seeded by the wave number so it's stable across a
  // resize but distinct every level (turns / direction / phase / squish /
  // silhouette). The coil isn't always a round ellipse: each wave draws a
  // radial profile (squircle / lobed flower / egg / organic wobble / classic
  // round). Profiles use only integer harmonics of the screen angle, so every
  // turn gets the same modulation — successive arms stay parallel and the path
  // always spirals cleanly into the core no matter the silhouette.
  function buildTrack() {
    R = Math.max(13, Math.min(20, Math.min(W, H) / 40)); D = R * 2; PROJR = R * 0.94;
    var cx = W / 2, cy = H * 0.53;
    var rng = mulberry((wave * 2654435761) >>> 0);
    var turns = 2.4 + rng() * 1.3;
    var dir = rng() < 0.5 ? 1 : -1;
    var startAngle = rng() * Math.PI * 2;
    var innerR = R * (2.3 + rng() * 1.1);
    var squish = 0.9 + rng() * 0.2;                          // gentle oval on top of the profile
    var outerScale = 0.82 + rng() * 0.18;                    // size variety within the frame

    // silhouette for this wave — wave 1 stays the familiar round coil
    var kind = wave === 1 ? 0 : (rng() * 5) | 0, pf;
    if (kind === 1) {          // squircle — a rounded-square board
      var sp = 3 + rng() * 2.5, srot = rng() * Math.PI;
      pf = function (a) { var c = Math.abs(Math.cos(a - srot)), s = Math.abs(Math.sin(a - srot)); return Math.pow(Math.pow(c, sp) + Math.pow(s, sp), -1 / sp); };
    } else if (kind === 2) {   // lobed flower
      var lk = 3 + ((rng() * 3) | 0), lamp = 0.09 + rng() * 0.07, lph = rng() * 6.283;
      pf = function (a) { return 1 + lamp * Math.sin(lk * a + lph); };
    } else if (kind === 3) {   // egg — one fat side
      var eamp = 0.1 + rng() * 0.09, eph = rng() * 6.283;
      pf = function (a) { return 1 + eamp * Math.cos(a - eph); };
    } else if (kind === 4) {   // organic wobble — two soft harmonics
      var w1 = 0.07 + rng() * 0.05, w2 = 0.045 + rng() * 0.035, wp1 = rng() * 6.283, wp2 = rng() * 6.283;
      pf = function (a) { return 1 + w1 * Math.cos(2 * a + wp1) + w2 * Math.sin(5 * a + wp2); };
    } else pf = function () { return 1; };
    var maxP = 0, minP = 9;
    for (var q = 0; q < 96; q++) { var pv = pf(q / 96 * 6.283); if (pv > maxP) maxP = pv; if (pv < minP) minP = pv; }

    var yScale = squish, xScale = 1;
    var outerR = Math.min(Math.min(W, H) * 0.46, (Math.min(cy, H - cy) - 34) / yScale, (W * 0.5 - 34) / xScale) * outerScale / maxP;
    outerR = Math.max(outerR, innerR + R * 4.5);
    // keep adjacent arms ≥ ~2.3 balls apart at the silhouette's thinnest point
    turns = Math.min(turns, Math.max(1.9, ((outerR - innerR) * minP) / (R * 2.3)));
    var thetaMax = Math.PI * 2 * turns, steps = 1000, pts = [];
    for (var i = 0; i <= steps; i++) {
      var f = i / steps;                    // 0 = outer start (s=0), 1 = inner hole (s=L)
      var theta = thetaMax * (1 - f);
      var ang = startAngle + theta * dir;
      var r = (innerR + (outerR - innerR) * (theta / thetaMax)) * pf(ang);
      pts.push({ x: cx + Math.cos(ang) * r, y: cy + Math.sin(ang) * r * squish });
    }
    var s = [0];
    for (i = 1; i < pts.length; i++) s[i] = s[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    L = s[s.length - 1];
    track = { pts: pts, s: s, cx: cx, cy: cy, hole: pts[pts.length - 1] };
    shooter.x = cx; shooter.y = cy;

    // asteroids — seeded sampling into the coil's open pockets (between arms
    // and just beyond the outer arm, where the shaped silhouettes leave room).
    // Each rock is sized from its pocket: nearest track distance minus ball
    // clearance, so chain balls can never touch one, but rocks sit squarely in
    // the firing lanes and you have to shoot around them.
    obstacles = [];
    var wantObs = wave === 1 ? 0 : Math.min(1 + ((wave - 2) >> 1), 4);
    var tries = 0;
    while (obstacles.length < wantObs && tries++ < 420) {
      var oa = rng() * 6.283;
      var orr = (innerR + (outerR - innerR) * (0.15 + rng() * 1.2)) * pf(oa);
      var ox = cx + Math.cos(oa) * orr, oy = cy + Math.sin(oa) * orr * squish;
      var md = 1e9;
      for (var pi = 0; pi < pts.length; pi += 3) { var ddx = pts[pi].x - ox, ddy = pts[pi].y - oy, dd = ddx * ddx + ddy * ddy; if (dd < md) md = dd; }
      md = Math.sqrt(md);
      var orad = Math.min(R * (0.8 + rng() * 0.7), md - R - 7);       // fit the pocket
      if (orad < R * 0.6) continue;                                   // pocket too small
      if (Math.hypot(ox - cx, oy - cy) < R * 5.2 + orad) continue;    // keep the cannon's pocket open
      if (ox - orad < 6 || ox + orad > W - 6 || oy - orad < 6 || oy + orad > H - 6) continue;
      if (oy - orad < 96 && Math.abs(ox - W / 2) < 190) continue;     // stay out from under the score HUD
      if (oy + orad > H - 44 && Math.abs(ox - W / 2) < 220) continue; // and from under the hint line
      var ok = true;
      for (var oi = 0; oi < obstacles.length; oi++) { var oo = obstacles[oi]; if (Math.hypot(oo.x - ox, oo.y - oy) < (oo.r + orad) * 2.2) { ok = false; break; } }
      if (!ok) continue;
      obstacles.push({ x: ox, y: oy, r: orad, rot: rng() * 6.283, spin: (rng() - 0.5) * 0.5, seed: (rng() * 1e4) | 0 });
    }
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
  // the core). Localizing to the neighborhood of the hit ball keeps insertion where the
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
    if (!chain.length) { chain.push({ c: pickWaveColor(), s: 0 }); spawnRemaining--; return; }
    var tail = chain[chain.length - 1];
    if (tail.s >= D) { chain.push({ c: pickWaveColor(), s: tail.s - D }); spawnRemaining--; }
  }

  function insertBall(cid, sv) {
    var idx = 0; while (idx < chain.length && chain[idx].s > sv) idx++;
    chain.splice(idx, 0, { c: cid, s: sv });
    if (idx > 0 && chain[idx].s > chain[idx - 1].s - D) chain[idx].s = chain[idx - 1].s - D;
    for (var k = idx + 1; k < chain.length; k++) if (chain[k].s > chain[k - 1].s - D) chain[k].s = chain[k - 1].s - D;
    return idx;
  }

  // remove the same-color run covering anchor if it's 3+, return count removed
  function clearRun(anchor) {
    if (anchor < 0 || anchor >= chain.length) return 0;
    var c = chain[anchor].c, lo = anchor, hi = anchor;
    while (lo > 0 && chain[lo - 1].c === c) lo--;
    while (hi < chain.length - 1 && chain[hi + 1].c === c) hi++;
    var n = hi - lo + 1;
    if (n < 3) return 0;
    var sx = 0, sy = 0;
    for (var i = lo; i <= hi; i++) { var p = posAt(chain[i].s); popBurst(p.x, p.y, chain[i].c); sx += p.x; sy += p.y; }
    lastClear = { x: sx / n, y: sy / n, cid: c };   // where the reward label + flash originate
    chain.splice(lo, n);
    return n;
  }

  // Exponential chain-reaction reward: a shot clear is the base (combo 1); each
  // run that clears as the chain snaps back together doubles the multiplier, so
  // a deep cascade pays off enormously and escalates the shake / flash / banner.
  function scorePop(n, combo) {
    var mult = Math.pow(2, Math.min(combo - 1, 8));   // x1, x2, x4, x8 ... capped at x256
    var pts = n * 10 * mult;
    score += pts; scoreEl.textContent = String(score);
    sndPop(combo);
    shake = Math.max(shake, Math.min(26, 3 + combo * 3));
    var lc = lastClear;
    floaters.push({ x: lc.x, y: lc.y, life: 0, max: combo >= 2 ? 1.3 : 0.85, pts: pts, combo: combo, mult: mult, cid: lc.cid });
    if (combo >= 2) {
      comboFlash = Math.min(0.85, 0.2 + combo * 0.13); comboFlashCid = lc.cid;
      var extra = combo * 7;
      for (var b = 0; b < extra; b++) { var ang = Math.random() * 6.283, spd = 140 + Math.random() * 320 + combo * 22; particles.push({ x: lc.x, y: lc.y, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd, life: 0, max: 0.55 + Math.random() * 0.6, r: 2 + Math.random() * 3.5, col: PALETTE[lc.cid] }); }
      sndChain(combo);
    }
    if (combo >= 3) chainBanner = { t: 1.2, combo: combo };
  }

  function update(dt) {
    starT += dt; holeSpin += dt * 0.9;
    if (waveFlash > 0) waveFlash -= dt;
    if (shake > 0) shake = Math.max(0, shake - dt * 26);
    if (comboFlash > 0) comboFlash = Math.max(0, comboFlash - dt * 2.2);
    if (chainBanner) { chainBanner.t -= dt; if (chainBanner.t <= 0) chainBanner = null; }
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
      // Zuma-style movement: split the chain into segments at gaps. Only the
      // tail segment is pushed forward by the feed; every segment ahead of a
      // gap pulls BACK until it rejoins the train, so clearing a run buys
      // distance from the core instead of rushing survivors toward it.
      var bounds = [], segStart = 0, joins = [];
      for (var i = 1; i <= chain.length; i++) {
        if (i === chain.length || chain[i].s < chain[i - 1].s - D - 0.6) { bounds.push([segStart, i - 1]); segStart = i; }
      }
      for (var bi = 0; bi < bounds.length; bi++) {
        var a = bounds[bi][0], b2 = bounds[bi][1], isTail = bi === bounds.length - 1;
        if (isTail) {
          // the feed pushes the whole tail train forward rigidly
          var adv = sp * dt;
          if (a > 0) adv = Math.max(0, Math.min(adv, chain[a - 1].s - D - chain[a].s));
          for (var k2 = a; k2 <= b2; k2++) chain[k2].s += adv;
          if (a > 0 && chain[a - 1].s - D - chain[a].s <= 0.001) joins.push(a - 1);
        } else {
          var gap = chain[b2].s - D - chain[b2 + 1].s;  // distance to the segment behind
          var shift = Math.min(RETRACT * dt, gap);
          for (var k2 = a; k2 <= b2; k2++) chain[k2].s -= shift;
          if (shift >= gap - 0.001) joins.push(b2);
        }
        for (k2 = a + 1; k2 <= b2; k2++) if (chain[k2].s > chain[k2 - 1].s - D) chain[k2].s = chain[k2 - 1].s - D;
      }
      // a rejoin with matching colors clears the run and extends the combo
      for (i = joins.length - 1; i >= 0; i--) {
        var j = joins[i];
        if (chain[j] && chain[j + 1] && chain[j].c === chain[j + 1].c) {
          var removed = clearRun(j);
          if (removed) { combo++; comboT = 1.15; scorePop(removed, combo); }
        }
      }
      if (chain.length && chain[0].s >= L) { chain[0].s = L; gameOver(); }   // a cascade can empty the chain mid-frame
    } else if (spawnRemaining <= 0) {
      nextWave();
    }

    // projectiles
    for (var p = projectiles.length - 1; p >= 0; p--) {
      var pr = projectiles[p];
      pr.x += pr.vx * dt; pr.y += pr.vy * dt;
      pr.trail.push({ x: pr.x, y: pr.y }); if (pr.trail.length > 7) pr.trail.shift();
      // asteroids block shots — the orb shatters on the rock
      var blocked = false;
      for (var ob = 0; ob < obstacles.length; ob++) {
        var o = obstacles[ob], odx = o.x - pr.x, ody = o.y - pr.y;
        if (odx * odx + ody * ody < (o.r + PROJR) * (o.r + PROJR)) { popBurst(pr.x, pr.y, pr.c); sndBlock(); projectiles.splice(p, 1); blocked = true; break; }
      }
      if (blocked) continue;
      var hit = -1, hd = (R + PROJR) * (R + PROJR);
      for (var j = 0; j < chain.length; j++) { var cp = posAt(chain[j].s), dx = cp.x - pr.x, dy = cp.y - pr.y; if (dx * dx + dy * dy < hd) { hit = j; break; } }
      var off = pr.x < -40 || pr.x > W + 40 || pr.y < -40 || pr.y > H + 40;
      if (hit >= 0) {
        var sv = nearestSNear(pr.x, pr.y, chain[hit].s, D * 2.5), idx = insertBall(pr.c, sv);
        var removed2 = clearRun(idx);
        if (removed2) { combo = 1; comboT = 1.15; scorePop(removed2, 1); }
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
    for (i = floaters.length - 1; i >= 0; i--) {
      var f = floaters[i]; f.life += dt; f.y -= (34 + f.combo * 6) * dt;
      if (f.life >= f.max) floaters.splice(i, 1);
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

  function drawRock(o) {
    var rr = mulberry(o.seed);
    ctx.save(); ctx.translate(o.x, o.y);
    // faint cool halo so the rock reads against the void
    ctx.globalCompositeOperation = "lighter";
    var hg = ctx.createRadialGradient(0, 0, o.r * 0.4, 0, 0, o.r * 2.1);
    hg.addColorStop(0, "rgba(140,175,225,0.12)"); hg.addColorStop(1, "rgba(140,175,225,0)");
    ctx.fillStyle = hg; ctx.beginPath(); ctx.arc(0, 0, o.r * 2.1, 0, 6.2832); ctx.fill();
    ctx.globalCompositeOperation = "source-over";
    ctx.rotate(o.rot + holeSpin * o.spin);
    // jagged rocky body, lit from the upper left
    var radii = [], verts = 10;
    for (var v = 0; v < verts; v++) radii.push(o.r * (0.82 + rr() * 0.24));
    var bg2 = ctx.createRadialGradient(-o.r * 0.4, -o.r * 0.45, o.r * 0.15, 0, 0, o.r * 1.15);
    bg2.addColorStop(0, "#8e9ab2"); bg2.addColorStop(0.45, "#525d75"); bg2.addColorStop(1, "#252c3d");
    ctx.fillStyle = bg2;
    ctx.beginPath();
    for (v = 0; v <= verts; v++) { var va = v / verts * 6.2832, vr = radii[v % verts], vx = Math.cos(va) * vr, vy = Math.sin(va) * vr; if (v) ctx.lineTo(vx, vy); else ctx.moveTo(vx, vy); }
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "rgba(160,195,245,0.3)"; ctx.lineWidth = 1.5; ctx.stroke();
    // craters
    for (var c = 0; c < 3; c++) {
      var ca = rr() * 6.2832, cd = rr() * o.r * 0.55, cr = o.r * (0.13 + rr() * 0.14);
      var kx = Math.cos(ca) * cd, ky = Math.sin(ca) * cd;
      ctx.fillStyle = "rgba(15,20,34,0.55)";
      ctx.beginPath(); ctx.ellipse(kx, ky, cr, cr * 0.8, ca, 0, 6.2832); ctx.fill();
      ctx.strokeStyle = "rgba(160,190,235,0.18)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(kx, ky + 0.5, cr * 0.9, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke();
    }
    ctx.restore();
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

    // asteroids
    for (i = 0; i < obstacles.length; i++) drawRock(obstacles[i]);

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

    // combo flash: a brief screen-wide wash in the cleared color
    if (comboFlash > 0.01) {
      ctx.fillStyle = PALETTE[comboFlashCid].glow + (0.16 * comboFlash) + ")";
      ctx.fillRect(0, 0, W, H);
    }

    // floating reward labels
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    for (i = 0; i < floaters.length; i++) {
      var f = floaters[i], fa = Math.min(1, (1 - f.life / f.max) * 1.6);
      var pop = Math.min(1, f.life / 0.12), sc = (0.7 + pop * 0.5) * (1 + Math.min(f.combo, 8) * 0.14);
      var col = PALETTE[f.cid];
      ctx.save(); ctx.globalAlpha = fa; ctx.translate(f.x, f.y); ctx.scale(sc, sc);
      if (f.combo >= 2) {
        ctx.font = "900 22px Archivo, system-ui, sans-serif";
        ctx.shadowColor = col.glow + "0.9)"; ctx.shadowBlur = 16;
        ctx.fillStyle = col.g; ctx.fillText("CHAIN x" + f.combo, 0, -13);
        ctx.shadowBlur = 6; ctx.font = "800 18px Archivo, system-ui, sans-serif";
        ctx.fillStyle = "#eafcff"; ctx.fillText("+" + f.pts, 0, 9);
      } else {
        ctx.font = "800 18px Archivo, system-ui, sans-serif";
        ctx.shadowColor = col.glow + "0.8)"; ctx.shadowBlur = 8;
        ctx.fillStyle = "#eafcff"; ctx.fillText("+" + f.pts, 0, 0);
      }
      ctx.restore();
    }
    ctx.shadowBlur = 0;

    // chain-reaction banner for a deep cascade
    if (chainBanner && chainBanner.t > 0) {
      var bt = chainBanner.t, ba = Math.min(1, bt * 1.5), bpop = Math.min(1, (1.2 - bt) / 0.15);
      var bcol = PALETTE[comboFlashCid];
      ctx.save(); ctx.globalAlpha = ba; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.translate(W / 2, H * 0.78); ctx.scale(0.8 + bpop * 0.25, 0.8 + bpop * 0.25);
      ctx.font = "900 " + Math.max(28, W * 0.045) + "px Archivo, system-ui, sans-serif";
      ctx.shadowColor = bcol.glow + "0.9)"; ctx.shadowBlur = 24; ctx.fillStyle = bcol.g;
      ctx.fillText("CHAIN REACTION x" + chainBanner.combo, 0, 0);
      ctx.restore(); ctx.shadowBlur = 0;
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
    // aim tracer — stops at the first asteroid so a blocked line reads instantly
    var reach = R * 9;
    for (var oi = 0; oi < obstacles.length; oi++) {
      var o = obstacles[oi];
      var rx = o.x - x, ry = o.y - y, along = rx * Math.cos(a) + ry * Math.sin(a);
      if (along <= 0) continue;
      var perp2 = rx * rx + ry * ry - along * along, rad = o.r + PROJR;
      if (perp2 < rad * rad) { var hitD = along - Math.sqrt(rad * rad - perp2); if (hitD > 0 && hitD < reach) reach = hitD; }
    }
    ctx.save(); ctx.globalAlpha = 0.28; ctx.strokeStyle = PALETTE[shooter.cur].m; ctx.lineWidth = 2; ctx.setLineDash([4, 8]);
    ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * R * 1.7, y + Math.sin(a) * R * 1.7); ctx.lineTo(x + Math.cos(a) * reach, y + Math.sin(a) * reach); ctx.stroke(); ctx.restore();
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
  function sndChain(combo) {
    if (!actx || !soundOn) return; var t = actx.currentTime;
    // a bright rising arpeggio sparkle that climbs with the cascade depth
    var st = Math.min(combo, 9), base = 523.25 * Math.pow(2, st / 12);
    tone("triangle", base, base * 2, t, 0.22, 0.14);
    tone("sine", base * 2, base * 3, t + 0.03, 0.18, 0.07);
    var s = noise(0.06), bp = actx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = base * 3; bp.Q.value = 2;
    var g = actx.createGain(); g.gain.setValueAtTime(0.06, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    s.connect(bp); bp.connect(g); bus(g); s.start(t); s.stop(t + 0.07);
  }
  function sndBlock() {
    if (!actx || !soundOn) return; var t = actx.currentTime;
    tone("sine", 160, 90, t, 0.1, 0.14);
    var s = noise(0.05), lp = actx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 700;
    var g = actx.createGain(); g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    s.connect(lp); lp.connect(g); bus(g); s.start(t); s.stop(t + 0.06);
  }
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

  // The tip-jar + fullscreen badges are relocated to the bottom-right corner on
  // this toy (the firing lane crosses their usual right-center dock). Announce
  // the move: on load they slide from the center dock down to the corner, so
  // players see where they went. Reusable pattern — pair with the CSS override
  // block in styles.css on any toy that relocates the badges.
  (function () {
    var frames = 0;
    (function wait() {
      var tip = document.querySelector(".opt-tipjar"), fs = document.querySelector(".opt-fs");
      if ((!tip || !fs) && ++frames < 600) return requestAnimationFrame(wait);
      if (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      [[tip, 0], [fs, -56]].forEach(function (pair) {
        var el = pair[0];
        if (!el) return;
        var r = el.getBoundingClientRect();
        var dy = (window.innerHeight / 2 + pair[1]) - (r.top + r.height / 2); // old center dock → new corner
        el.style.transition = "none";
        el.style.transform = "translateY(" + dy + "px)";
        requestAnimationFrame(function () { requestAnimationFrame(function () {
          el.style.transition = "transform 900ms cubic-bezier(0.6, 0.05, 0.28, 1) 700ms";
          el.style.transform = "translateY(0)";
          setTimeout(function () { el.style.transition = ""; el.style.transform = ""; }, 1900);
        }); });
      });
    })();
  })();
})();
