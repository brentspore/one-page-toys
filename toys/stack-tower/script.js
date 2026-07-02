/* Stack Tower — a Tower Bloxx-style crane stacker. Vanilla Canvas 2D.
 * A crane swings each floor on a rope; tap to drop it. Line-ups build a
 * steady tower; sloppy drops make it lean and sway until it topples.
 * Perfect drops snap true, score a combo, and steady the tower. */
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
  var GRAV = 2600;             // fall acceleration (px/s^2)
  var PERFECT = 0.05;          // |offset|/w below this = perfect
  var MISS = 0.86;             // |offset|/w above this = slides off (game over)
  var PLACE_PENALTY = 0.42;    // instability added per unit off-centre
  var PERFECT_HEAL = 0.10;     // instability removed on a perfect
  var HEIGHT_CREEP = 0.004;    // instability added each floor (slow ramp)
  var SWAY_FREQ = 1.7;
  var DROP_INHERIT = 0.4;      // how much of the crane's swing velocity the drop keeps

  var BW = 160, BH = 66;       // block size (set in resize)
  var GROUND_Y = 0;            // world y of the ground surface (bottom of base block)

  // state
  var blocks = [];             // {x, y, w, h, hue} — y is world centre, up = smaller y
  var falling = null;          // {x, y, vy, w, h, hue}
  var crane = null;            // pendulum: {pivotX, pivotY, len, angMax, phase, ang, speed, x, y, w, h, hue}
  var camY = 0, camTarget = 0;
  var instability = 0, swayT = 0;
  var score = 0, combo = 0, best = 0;
  var running = false, over = false, toppling = false, toppleT = 0;
  var particles = [], perfectPops = [];
  var soundOn = true;

  try { best = parseInt(localStorage.getItem("stack_best"), 10) || 0; } catch (e) { best = 0; }
  bestEl.textContent = "Best " + best;

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.floor(W * DPR); canvas.height = Math.floor(H * DPR);
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    BW = Math.max(96, Math.min(W * 0.34, 196));
    BH = BW * 0.42;
    GROUND_Y = 0;
  }
  window.addEventListener("resize", resize);

  function hueFor(i) { return (28 + i * 14) % 360; }

  function reset() {
    resize();
    blocks = [];
    var baseY = GROUND_Y - BH / 2;
    blocks.push({ x: W / 2, y: baseY, w: BW, h: BH, hue: hueFor(0) });
    falling = null; instability = 0; swayT = 0; score = 0; combo = 0;
    over = false; toppling = false; toppleT = 0; particles = []; perfectPops = [];
    scoreEl.textContent = "0";
    camTarget = topY() - H * 0.60; camY = camTarget;
    spawnCrane();
  }
  function topBlock() { return blocks[blocks.length - 1]; }
  function topY() { return topBlock().y - BH; }   // world y of the surface to land on (centre of the next block)

  function spawnCrane() {
    var t = topBlock();
    var speed = 1.35 + blocks.length * 0.035;      // swings faster as you climb
    var yLow = t.y - BH * 2.2;                      // lowest point of the swing (block centre)
    var len = Math.max(BH * 3, H * 0.6 - BH * 1.2 - 44);  // rope length → pivot sits near the top of screen
    var pivotY = yLow - len;                        // fixed pivot, directly above the stack centre
    crane = {
      pivotX: t.x, pivotY: pivotY, len: len, angMax: 0.95,
      phase: (Math.random() < 0.5 ? -1 : 1) * (0.4 + Math.random() * 0.5),  // start part-way through a swing
      speed: Math.min(speed, 3.2), ang: 0, x: t.x, y: yLow, w: BW, h: BH, hue: hueFor(blocks.length),
      life: 0, maxLife: Math.max(2.5, 4.8 - blocks.length * 0.1)  // auto-drops if you dawdle (shorter as you climb)
    };
    swingCrane(0);
  }
  // position the hanging block along the pendulum arc for the current phase
  function swingCrane(dt) {
    crane.phase += crane.speed * dt;
    crane.ang = crane.angMax * Math.sin(crane.phase);
    crane.x = crane.pivotX + crane.len * Math.sin(crane.ang);
    crane.y = crane.pivotY + crane.len * Math.cos(crane.ang);
  }

  function drop() {
    if (!running || over || falling || !crane) return;
    unlock();
    // inherit the crane's pendulum velocity so the block arcs with the swing:
    // released at a swing extreme it drops nearly straight; released through the
    // centre it carries sideways momentum — so timing the release is the skill.
    var craneVel = crane.len * Math.cos(crane.ang) * crane.angMax * Math.cos(crane.phase) * crane.speed;
    falling = { x: crane.x, y: crane.y, vy: 0, vx: craneVel * DROP_INHERIT, w: crane.w, h: crane.h, hue: crane.hue };
    crane = null;
  }

  function place() {
    var t = topBlock();
    var off = falling.x - t.x;
    var rel = Math.abs(off) / falling.w;
    if (rel > MISS) {                       // no real support → it slides off
      // let it keep falling past, then game over
      falling.slip = off > 0 ? 1 : -1;
      startTopple(true, falling);
      return;
    }
    var perfect = rel < PERFECT;
    var nx = perfect ? t.x : falling.x;
    var nb = { x: nx, y: t.y - BH, w: falling.w, h: falling.h, hue: falling.hue };
    blocks.push(nb);
    falling = null;
    score++;
    scoreEl.textContent = String(score);

    if (perfect) {
      combo++;
      instability = Math.max(0, instability - PERFECT_HEAL);
      perfectPops.push({ x: nx, y: nb.y, t: 0, combo: combo });
      spawnSparkle(nx, nb.y - BH * 0.5, 16);
      sndPerfect(combo);
    } else {
      combo = 0;
      instability += rel * PLACE_PENALTY;
      sndPlace(rel);
    }
    instability += HEIGHT_CREEP;

    if (instability >= 1) { startTopple(false, null); return; }
    camTarget = (nb.y - BH) - H * 0.60;
    spawnCrane();
  }

  function startTopple(slip, blk) {
    toppling = true; toppleT = 0; crane = null;
    // give each block an angular tumble so the tower collapses
    var pivotFrom = Math.max(0, blocks.length - 3);
    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i];
      b.vx = (Math.random() * 2 - 1) * 60 + (leanShear() * (GROUND_Y - b.y - BH / 2)) * 8;
      b.vy = -Math.random() * 80;
      b.va = (Math.random() * 2 - 1) * 3;
      b.rot = 0;
      b.tumble = i >= pivotFrom;
    }
    if (blk) { blk.va = 5 * blk.slip; blk.tumble = true; blocks.push(blk); }
    sndCrash();
  }

  function endGame() {
    over = true; running = false;
    if (score > best) { best = score; try { localStorage.setItem("stack_best", String(best)); } catch (e) {} }
    bestEl.textContent = "Best " + best;
    ovTitle.textContent = score >= best && score > 0 ? "New best!" : "Toppled!";
    ovText.textContent = "You stacked " + score + " floor" + (score === 1 ? "" : "s") + ". Best: " + best + ".";
    ovBtn.textContent = "Build again";
    overlay.hidden = false; overlay.classList.remove("is-hidden");
  }

  function spawnSparkle(x, y, n) {
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2, sp = 60 + Math.random() * 180;
      particles.push({ x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40, life: 0, max: 0.5 + Math.random() * 0.4, hue: 48 });
    }
  }

  // gentle sway grows with instability; this is the shear factor applied per unit world-height
  function leanShear() { return (0.012 + instability * 0.085) * Math.sin(swayT * SWAY_FREQ); }

  function update(dt) {
    swayT += dt;
    camY += (camTarget - camY) * Math.min(1, dt * 6);

    if (crane && running && !over) {
      swingCrane(dt);
      crane.life += dt;
      if (crane.life >= crane.maxLife) drop();   // release on timeout — no swinging forever
    }

    if (falling) {
      falling.vy += GRAV * dt;
      falling.y += falling.vy * dt;
      falling.x += (falling.vx || 0) * dt;    // horizontal momentum carried from the swing
      var landY = topBlock().y - BH;          // centre y when resting on the stack
      if (falling.y >= landY) { falling.y = landY; place(); }
    }

    if (toppling) {
      toppleT += dt;
      for (var i = 0; i < blocks.length; i++) {
        var b = blocks[i];
        if (!b.tumble) continue;
        b.vy = (b.vy || 0) + GRAV * 0.55 * dt;
        b.x += (b.vx || 0) * dt;
        b.y += b.vy * dt;
        b.rot = (b.rot || 0) + (b.va || 0) * dt;
      }
      if (toppleT > 1.15 && !over) endGame();
    }

    for (var p = particles.length - 1; p >= 0; p--) {
      var q = particles[p]; q.life += dt; q.vy += 420 * dt; q.x += q.vx * dt; q.y += q.vy * dt;
      if (q.life >= q.max) particles.splice(p, 1);
    }
    for (var k = perfectPops.length - 1; k >= 0; k--) { perfectPops[k].t += dt; if (perfectPops[k].t > 0.9) perfectPops.splice(k, 1); }
  }

  // ---------- render ----------
  function skyStops(h) {
    // shift the sky as the tower climbs: day → gold dusk → deep night → space
    var f = Math.min(1, blocks.length / 42);
    function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
    var day = [[126, 178, 232], [206, 226, 246]];
    var dusk = [[58, 60, 128], [232, 150, 110]];
    var night = [[14, 20, 48], [40, 44, 96]];
    var space = [[4, 6, 20], [16, 14, 44]];
    var top, bot;
    if (f < 0.4) { var t = f / 0.4; top = mix(day[0], dusk[0], t); bot = mix(day[1], dusk[1], t); }
    else if (f < 0.75) { var t2 = (f - 0.4) / 0.35; top = mix(dusk[0], night[0], t2); bot = mix(dusk[1], night[1], t2); }
    else { var t3 = (f - 0.75) / 0.25; top = mix(night[0], space[0], t3); bot = mix(night[1], space[1], t3); }
    return { top: "rgb(" + top.map(Math.round).join(",") + ")", bot: "rgb(" + bot.map(Math.round).join(",") + ")", f: f };
  }

  var stars = [];
  function ensureStars() { if (stars.length) return; for (var i = 0; i < 90; i++) stars.push({ x: Math.random(), y: Math.random(), r: Math.random() * 1.4 + 0.3, tw: Math.random() * 6 }); }

  function worldToScreenX(x, worldY) {
    var heightAboveBase = GROUND_Y - worldY;   // >=0 going up
    return x + heightAboveBase * leanShear();
  }
  function sy(worldY) { return worldY - camY; }

  function drawBlock(b, screenXCentre) {
    var x = screenXCentre, y = sy(b.y), w = b.w, h = b.h;
    ctx.save();
    if (b.rot) { ctx.translate(x, y); ctx.rotate(b.rot); ctx.translate(-x, -y); }
    var lx = x - w / 2, ty = y - h / 2;
    // body
    var g = ctx.createLinearGradient(lx, ty, lx + w, ty + h);
    g.addColorStop(0, "hsl(" + b.hue + ",62%,64%)");
    g.addColorStop(1, "hsl(" + b.hue + ",58%,46%)");
    roundRect(lx, ty, w, h, 5); ctx.fillStyle = g; ctx.fill();
    // top face highlight
    ctx.fillStyle = "hsl(" + b.hue + ",64%,72%)";
    roundRect(lx, ty, w, Math.max(5, h * 0.16), 5); ctx.fill();
    // windows
    var cols = Math.max(3, Math.round(w / 26)), rows = Math.max(2, Math.round(h / 24));
    var pad = w * 0.12, ww = (w - pad * 2) / cols * 0.62, wh = (h - h * 0.34) / rows * 0.56;
    var gx = (w - pad * 2) / cols, gy = (h - h * 0.34) / rows;
    for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
      var lit = ((r * 7 + c * 3 + (b.hue | 0)) % 5) > 1;
      ctx.fillStyle = lit ? "rgba(255,240,190,0.92)" : "rgba(20,26,54,0.5)";
      ctx.fillRect(lx + pad + c * gx + (gx - ww) / 2, ty + h * 0.24 + r * gy + (gy - wh) / 2, ww, wh);
    }
    // edge shade
    ctx.strokeStyle = "rgba(0,0,0,0.18)"; ctx.lineWidth = 1.5; roundRect(lx, ty, w, h, 5); ctx.stroke();
    ctx.restore();
  }

  function render() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    var sk = skyStops();
    var bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, sk.top); bg.addColorStop(1, sk.bot);
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

    // stars fade in with altitude
    if (sk.f > 0.35) {
      ensureStars();
      ctx.save(); ctx.globalAlpha = Math.min(1, (sk.f - 0.35) / 0.4);
      for (var i = 0; i < stars.length; i++) {
        var s = stars[i];
        var tw = 0.6 + 0.4 * Math.sin(swayT * 2 + s.tw);
        ctx.globalAlpha = Math.min(1, (sk.f - 0.35) / 0.4) * tw;
        ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(s.x * W, s.y * H * 0.8, s.r, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }

    // ground + skyline base
    var groundScreen = sy(GROUND_Y);
    if (groundScreen < H + 40) {
      ctx.fillStyle = sk.f > 0.5 ? "#0a1030" : "#2b3b52";
      // simple silhouette skyline
      var baseline = groundScreen;
      ctx.beginPath(); ctx.moveTo(0, baseline);
      var seed = 7;
      for (var bx = 0; bx <= W; bx += 46) {
        seed = (seed * 9301 + 49297) % 233280; var rnd = seed / 233280;
        var bh = 30 + rnd * 90;
        ctx.lineTo(bx, baseline - bh); ctx.lineTo(bx + 46, baseline - bh);
      }
      ctx.lineTo(W, baseline); ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath();
      ctx.globalAlpha = 0.55; ctx.fill(); ctx.globalAlpha = 1;
      // ground fill
      ctx.fillStyle = sk.f > 0.5 ? "#070b1e" : "#1c2b3e";
      ctx.fillRect(0, baseline, W, H - baseline);
    }

    // tower
    for (var b = 0; b < blocks.length; b++) {
      var blk = blocks[b];
      var scx = blk.tumble ? blk.x : worldToScreenX(blk.x, blk.y);
      // soft contact shadow
      drawBlock(blk, scx);
    }

    // crane: fixed pivot overhead, rope tilting as the block swings on its arc
    if (crane && !over) {
      var pcx = crane.pivotX, pcy = sy(crane.pivotY);
      var bcx = crane.x, bcy = sy(crane.y);
      // short jib beam + mount at the pivot
      var HB = BW * 0.75;
      ctx.strokeStyle = "rgba(255,255,255,0.30)"; ctx.lineWidth = 5; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(pcx - HB, pcy); ctx.lineTo(pcx + HB, pcy); ctx.stroke();
      // drop-timer: an accent segment on the beam that drains inward, reddening + pulsing when time's low
      var rem = Math.max(0, 1 - crane.life / crane.maxLife), warn = rem < 0.32;
      var pulse = warn ? 0.55 + 0.45 * Math.sin(swayT * 18) : 1;
      ctx.strokeStyle = warn ? "rgba(255,92,80," + (0.9 * pulse) + ")" : "rgba(255,208,128,0.9)";
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(pcx - HB * rem, pcy); ctx.lineTo(pcx + HB * rem, pcy); ctx.stroke();
      ctx.fillStyle = "#cfd7ea"; ctx.beginPath(); ctx.arc(pcx, pcy, 6, 0, Math.PI * 2); ctx.fill();
      // tilted rope from pivot to the top of the block
      ctx.strokeStyle = "rgba(230,236,250,0.7)"; ctx.lineWidth = 2.5; ctx.lineCap = "butt";
      ctx.beginPath(); ctx.moveTo(pcx, pcy); ctx.lineTo(bcx, bcy - crane.h / 2); ctx.stroke();
      drawBlock({ x: crane.x, y: crane.y, w: crane.w, h: crane.h, hue: crane.hue }, bcx);
    }

    // falling block
    if (falling) drawBlock(falling, falling.x);

    // sparkles
    for (var p = 0; p < particles.length; p++) {
      var q = particles[p]; var a = 1 - q.life / q.max;
      ctx.globalAlpha = a; ctx.fillStyle = "hsl(" + q.hue + ",100%,72%)";
      ctx.beginPath(); ctx.arc(worldToScreenX(q.x, q.y), sy(q.y), 2.4, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;

    // PERFECT popups
    for (var k = 0; k < perfectPops.length; k++) {
      var pp = perfectPops[k]; var a2 = 1 - pp.t / 0.9;
      ctx.globalAlpha = a2; ctx.fillStyle = "#ffe27a";
      ctx.font = "900 " + (Math.max(18, BW * 0.16)) + "px Archivo, system-ui, sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      var label = pp.combo > 1 ? "PERFECT ×" + pp.combo : "PERFECT";
      ctx.fillText(label, worldToScreenX(pp.x, pp.y), sy(pp.y) - BH * 0.8 - pp.t * 40);
    }
    ctx.globalAlpha = 1;
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  var last = 0;
  function frame(ts) {
    var dt = last ? Math.min((ts - last) / 1000, 0.05) : 0; last = ts;
    if (running || toppling) update(dt);
    render();
    requestAnimationFrame(frame);
  }

  // ---------- input ----------
  function tap() {
    if (over) return;
    if (!running) { startGame(); return; }
    drop();
  }
  function startGame() {
    overlay.classList.add("is-hidden");
    setTimeout(function () { overlay.hidden = true; }, 200);
    running = true;
    hintEl.classList.add("is-gone");
  }
  canvas.addEventListener("pointerdown", function (e) { e.preventDefault(); tap(); });
  ovBtn.addEventListener("click", function () { if (over) { reset(); } startGame(); });
  window.addEventListener("keydown", function (e) { if (e.code === "Space" || e.code === "ArrowDown") { e.preventDefault(); tap(); } });
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
      master = actx.createGain(); master.gain.value = 0.9;
      convo = actx.createConvolver(); convo.buffer = makeImpulse(1.2, 3);
      wet = actx.createGain(); wet.gain.value = 0.16;
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
  function noise(dur) { var n = Math.floor(actx.sampleRate * dur), b = actx.createBuffer(1, n, actx.sampleRate), d = b.getChannelData(0); for (var i = 0; i < n; i++)d[i] = Math.random() * 2 - 1; var s = actx.createBufferSource(); s.buffer = b; return s; }
  function sndPlace(rel) {
    if (!actx || !soundOn) return;
    var t = actx.currentTime;
    // woody thunk — pitch drops a touch for sloppier drops
    var o = actx.createOscillator(); o.type = "triangle";
    var f = 180 - rel * 60; o.frequency.setValueAtTime(f + 60, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.09);
    var g = actx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.22, t + 0.008); g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    o.connect(g); bus(g); o.start(t); o.stop(t + 0.22);
    var s = noise(0.05), bp = actx.createBiquadFilter(); bp.type = "lowpass"; bp.frequency.value = 900;
    var g2 = actx.createGain(); g2.gain.setValueAtTime(0.14, t); g2.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    s.connect(bp); bp.connect(g2); bus(g2); s.start(t); s.stop(t + 0.06);
  }
  function sndPerfect(combo) {
    if (!actx || !soundOn) return;
    var t = actx.currentTime;
    var semis = [0, 4, 7, 11, 12]; var base = 523.25 * Math.pow(2, Math.min(combo - 1, 8) / 12);
    [0, 7].forEach(function (st, i) {
      var o = actx.createOscillator(); o.type = "triangle"; o.frequency.value = base * Math.pow(2, st / 12);
      var g = actx.createGain(); var tt = t + i * 0.05; g.gain.setValueAtTime(0, tt); g.gain.linearRampToValueAtTime(0.16, tt + 0.01); g.gain.exponentialRampToValueAtTime(0.001, tt + 0.4);
      o.connect(g); bus(g); o.start(tt); o.stop(tt + 0.42);
    });
  }
  function sndCrash() {
    if (!actx || !soundOn) return;
    var t = actx.currentTime;
    var s = noise(0.7), bp = actx.createBiquadFilter(); bp.type = "lowpass"; bp.frequency.setValueAtTime(1400, t); bp.frequency.exponentialRampToValueAtTime(180, t + 0.6);
    var g = actx.createGain(); g.gain.setValueAtTime(0.32, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
    s.connect(bp); bp.connect(g); bus(g); s.start(t); s.stop(t + 0.72);
    var o = actx.createOscillator(); o.type = "sine"; o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.5);
    var g2 = actx.createGain(); g2.gain.setValueAtTime(0.26, t); g2.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
    o.connect(g2); bus(g2); o.start(t); o.stop(t + 0.57);
  }

  // ---------- boot ----------
  reset();
  overlay.hidden = false;
  setTimeout(function () { hintEl.classList.add("is-gone"); }, 6000);
  requestAnimationFrame(frame);
})();
