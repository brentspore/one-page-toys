/* Rain on a Window — a foggy pane on a rainy night.
 * Raindrops cling, grow, and slide down the glass leaving clear trails that
 * reveal the warm bokeh world outside. Tap or drag to wipe the fog away.
 * Ambient rain + distant thunder, all synthesized.
 */
(function () {
  "use strict";

  var canvas = document.getElementById("canvas");
  var ctx = canvas.getContext("2d");
  var hintEl = document.querySelector(".hint");

  // the warm world outside (drawn once per resize) + the fog layer on the glass.
  // the fog is a BLURRED, frosted copy of the world — so wiping it reveals the
  // SHARP world at the same brightness (reads as "clearing", never a dark smear).
  var bg = document.createElement("canvas"), bgx = bg.getContext("2d");
  var fog = document.createElement("canvas"), fgx = fog.getContext("2d");
  var frost = document.createElement("canvas"), frx = frost.getContext("2d");

  var W, H, DPR;

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = W * DPR; canvas.height = H * DPR;
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    bg.width = W * DPR; bg.height = H * DPR; bgx.setTransform(DPR, 0, 0, DPR, 0, 0);
    fog.width = W * DPR; fog.height = H * DPR; fgx.setTransform(DPR, 0, 0, DPR, 0, 0);
    frost.width = W * DPR; frost.height = H * DPR; frx.setTransform(DPR, 0, 0, DPR, 0, 0);
    initBokeh();
    paintScene(0);
    buildFrost();
    resetFog();
    seedCondensation();
  }

  // the frosted-glass layer: a soft-blurred copy of the world + a pale milky veil
  function buildFrost() {
    frx.setTransform(DPR, 0, 0, DPR, 0, 0);
    frx.globalCompositeOperation = "source-over"; frx.globalAlpha = 1;
    frx.clearRect(0, 0, W, H);
    frx.filter = "blur(" + (Math.max(W, H) * 0.018).toFixed(1) + "px)";
    frx.drawImage(bg, 0, 0, W, H);
    frx.filter = "none";
    // thin pale veil so the fogged glass reads a touch cooler & milkier than the
    // sharp world behind it — the wipe then reveals FOCUS, not a brightness jump
    frx.fillStyle = "rgba(198,212,233,0.16)";
    frx.fillRect(0, 0, W, H);
  }

  // ---- the bokeh world outside -------------------------------------------
  var bokeh = [];
  // generate the out-of-focus city lights once (per resize). Each carries a slow
  // sway + a gentle twinkle so the world outside drifts and shimmers softly.
  function initBokeh() {
    bokeh.length = 0;
    var warm = ["255,198,124", "255,176,100", "255,154,84", "255,222,156", "255,186,116"];
    var cool = ["156,200,255", "184,224,255", "168,238,236"];
    var minD = Math.min(W, H);
    var n = Math.round(W * H / 17000);
    for (var i = 0; i < n; i++) {
      var warmy = Math.random() < 0.82;
      var col = warmy ? warm[(Math.random() * warm.length) | 0] : cool[(Math.random() * cool.length) | 0];
      // big defocused discs — scale with the screen so they read as real bokeh
      var r = minD * (0.045 + Math.random() * 0.11);
      // cover the full pane (so wiping the top reveals light too), with extra density low
      var y = Math.random() < 0.45 ? Math.random() * H : Math.pow(Math.random(), 0.55) * H;
      bokeh.push({
        x: Math.random() * W, y: y, r: r, col: col, a: 0.22 + Math.random() * 0.40,
        // slow elliptical drift (period ~13–40s) + a soft twinkle (period ~4–13s)
        sx: rand(6, 18), sy: rand(4, 13), sxp: rand(0, 6.28), syp: rand(0, 6.28),
        ss: rand(0.16, 0.48), twp: rand(0, 6.28), tws: rand(0.5, 1.5), twa: rand(0.10, 0.30)
      });
    }
    bokeh.sort(function (a, b) { return a.r - b.r; });
  }

  function paintScene(time) {
    // a deep rainy NIGHT — dark enough that the city-light bokeh glows when the fog clears
    bgx.clearRect(0, 0, W, H);
    var g = bgx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#070d1a");
    g.addColorStop(0.5, "#0a1428");
    g.addColorStop(0.82, "#0e1b32");
    g.addColorStop(1, "#13233c");
    bgx.fillStyle = g; bgx.fillRect(0, 0, W, H);

    // broad warm city-glow rising from below (night light pollution against the dark)
    var wg = bgx.createRadialGradient(W * 0.5, H * 1.04, H * 0.08, W * 0.5, H * 1.04, H * 1.15);
    wg.addColorStop(0, "rgba(255,150,74,0.34)");
    wg.addColorStop(0.5, "rgba(255,138,70,0.12)");
    wg.addColorStop(1, "rgba(255,138,70,0)");
    bgx.fillStyle = wg; bgx.fillRect(0, 0, W, H);
    // faint cool moonlit sky-glow from above so the top isn't a dead black band
    var sg = bgx.createRadialGradient(W * 0.5, -H * 0.1, H * 0.05, W * 0.5, -H * 0.1, H * 0.9);
    sg.addColorStop(0, "rgba(120,156,206,0.16)");
    sg.addColorStop(1, "rgba(120,156,206,0)");
    bgx.fillStyle = sg; bgx.fillRect(0, 0, W, H);

    // draw each disc at its slowly-drifted position with a gently twinkling brightness
    for (var i = 0; i < bokeh.length; i++) {
      var bk = bokeh[i];
      var x = bk.x + Math.sin(time * bk.ss + bk.sxp) * bk.sx;
      var y = bk.y + Math.cos(time * bk.ss * 0.8 + bk.syp) * bk.sy;
      var a = bk.a * (1 + Math.sin(time * bk.tws + bk.twp) * bk.twa);
      // a defocused highlight = a fairly EVEN disc of light with a brighter rim
      // and a soft feathered edge (no hard center dot, no plain glow falloff)
      var rg = bgx.createRadialGradient(x, y, 0, x, y, bk.r);
      rg.addColorStop(0, "rgba(" + bk.col + "," + (a * 0.70).toFixed(3) + ")");
      rg.addColorStop(0.55, "rgba(" + bk.col + "," + (a * 0.74).toFixed(3) + ")");
      rg.addColorStop(0.84, "rgba(" + bk.col + "," + Math.min(0.98, a * 1.08).toFixed(3) + ")"); // bright aperture rim
      rg.addColorStop(0.94, "rgba(" + bk.col + "," + (a * 0.52).toFixed(3) + ")");
      rg.addColorStop(1, "rgba(" + bk.col + ",0)");                                              // soft feathered edge
      bgx.fillStyle = rg;
      bgx.beginPath(); bgx.arc(x, y, bk.r, 0, 6.28); bgx.fill();
    }
  }

  function resetFog() {
    fgx.globalCompositeOperation = "source-over"; fgx.globalAlpha = 1;
    fgx.clearRect(0, 0, W, H);
    fgx.drawImage(frost, 0, 0, W, H);
  }

  // ---- drops --------------------------------------------------------------
  // cond[] = the fine condensation haze (the "food"); drops[] = larger beads
  // that CLING and grow by absorbing condensation + each other, and only begin
  // to slide once they pass a critical size (gravity beats surface tension).
  var cond = [];
  var drops = [];
  var SLIDE_R = 8.5;      // a bead must reach this radius before it runs
  var MAX_R = 16;
  function rand(a, b) { return a + Math.random() * (b - a); }

  function seedCondensation() {
    cond.length = 0; drops.length = 0;
    var n = Math.round(W * H / 6200);
    for (var i = 0; i < n; i++) cond.push({ x: Math.random() * W, y: Math.random() * H, r: rand(1.3, 4.2) });
    // a few clinging beads already on the glass
    var d = Math.round(W * H / 90000);
    for (i = 0; i < d; i++) spawnDrop(Math.random() * W, Math.random() * H, rand(3.5, 6.5));
  }

  function spawnDrop(x, y, r) {
    drops.push({ x: x, y: y, r: r, vy: 0, sliding: false, wob: rand(0, 6.28), wobSpeed: rand(1.6, 2.6) });
  }

  function eraseFogAt(x, y, r) {
    fgx.globalCompositeOperation = "destination-out";
    var g = fgx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, "rgba(0,0,0,0.9)");
    g.addColorStop(0.6, "rgba(0,0,0,0.5)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    fgx.fillStyle = g;
    fgx.beginPath(); fgx.arc(x, y, r, 0, 6.28); fgx.fill();
  }

  function grow(d, byR) { d.r = Math.min(MAX_R, Math.sqrt(d.r * d.r + byR * byR)); }

  function update(dt) {
    var i, j;
    // slowly re-mist the glass: paint the frost back over wiped areas at low alpha
    fgx.globalCompositeOperation = "source-over";
    fgx.globalAlpha = Math.min(0.05, 0.16 * dt);
    fgx.drawImage(frost, 0, 0, W, H);
    fgx.globalAlpha = 1;

    // fresh condensation keeps forming on the cooling glass (food for the beads)
    var add = Math.round(W * H / 2400 * dt);
    for (i = 0; i < add; i++) cond.push({ x: Math.random() * W, y: Math.random() * H, r: rand(0.8, 3.2) });
    // occasionally a new clinging bead nucleates
    if (Math.random() < dt * 1.6) spawnDrop(rand(W * 0.03, W * 0.97), rand(0, H), rand(3, 5.5));

    // condensation keeps its tiny patch of glass clear
    for (i = 0; i < cond.length; i++) eraseFogAt(cond[i].x, cond[i].y, cond[i].r * 1.4);

    for (i = drops.length - 1; i >= 0; i--) {
      var t = drops[i];

      // absorb nearby condensation → grow (whether clinging or sliding)
      for (j = cond.length - 1; j >= 0; j--) {
        var c = cond[j];
        if (Math.abs(c.x - t.x) < t.r + c.r + 2 && Math.abs(c.y - t.y) < t.r + c.r + 3) {
          if (Math.hypot(c.x - t.x, c.y - t.y) < t.r + c.r) { grow(t, c.r); cond.splice(j, 1); }
        }
      }
      // merge with smaller beads it overlaps (drops join to get bigger)
      for (j = drops.length - 1; j >= 0; j--) {
        if (j === i) continue;
        var o = drops[j];
        if (o.r > t.r) continue;                 // let the larger one do the eating
        if (Math.hypot(o.x - t.x, o.y - t.y) < t.r + o.r * 0.6) {
          grow(t, o.r); drops.splice(j, 1);
          if (j < i) i--;
        }
      }

      // a bead only runs once it's heavy enough to beat surface tension
      if (!t.sliding && t.r >= SLIDE_R) t.sliding = true;

      if (t.sliding) {
        t.vy += 240 * dt * (0.45 + t.r / 18);    // bigger drops fall faster
        t.vy *= Math.pow(0.72, dt);
        t.wob += dt * t.wobSpeed;
        // gentle meander only — drops mostly track straight down
        var nx = t.x + Math.sin(t.wob) * (0.15 + t.r * 0.012);
        var ny = t.y + t.vy * dt;
        // carve the wet streak along the path + shed a few residual beads
        var steps = Math.max(1, Math.ceil(t.vy * dt / 4));
        for (j = 1; j <= steps; j++) {
          var px = t.x + (nx - t.x) * (j / steps), py = t.y + (ny - t.y) * (j / steps);
          eraseFogAt(px, py, t.r * 0.85);
          if (Math.random() < 0.12) { cond.push({ x: px + rand(-2, 2), y: py + rand(-1, 3), r: rand(0.8, 1.8) }); t.r = Math.max(SLIDE_R * 0.7, t.r - 0.06); }
        }
        t.x = nx; t.y = ny;
        // shed so much mass it can no longer run → it clings again
        if (t.r < SLIDE_R * 0.78 && t.vy < 40) { t.sliding = false; t.vy = 0; }
        if (t.y - t.r > H) drops.splice(i, 1);
      } else {
        // clinging: sit still and keep its own patch of glass clear
        eraseFogAt(t.x, t.y, t.r * 1.1);
      }
    }

    // cap counts so things don't grow unbounded
    if (cond.length > 1100) cond.splice(0, cond.length - 1100);
    if (drops.length > 240) drops.splice(0, drops.length - 240);
  }

  function refog() {
    resetFog();
    seedCondensation();
  }

  // ---- rendering: drops as little lenses ----------------------------------
  function drawDrop(x, y, r) {
    // a water bead magnifies and brightens the glow behind it — light, not dark
    var g = ctx.createRadialGradient(x - r * 0.22, y - r * 0.22, r * 0.05, x, y, r * 1.04);
    g.addColorStop(0, "rgba(255,250,242,0.20)");
    g.addColorStop(0.5, "rgba(220,234,255,0.05)");
    g.addColorStop(0.84, "rgba(150,180,214,0.12)");   // faint cool refraction rim
    g.addColorStop(1, "rgba(150,180,214,0)");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, 6.28); ctx.fill();
    // warm light gathered at the lower edge on bigger beads
    if (r > 3) {
      var bg2 = ctx.createRadialGradient(x, y + r * 0.42, 0, x, y + r * 0.42, r * 0.9);
      bg2.addColorStop(0, "rgba(255,238,206,0.16)");
      bg2.addColorStop(1, "rgba(255,238,206,0)");
      ctx.fillStyle = bg2;
      ctx.beginPath(); ctx.arc(x, y, r, 0, 6.28); ctx.fill();
    }
    // crisp specular highlight, top-left
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.beginPath(); ctx.arc(x - r * 0.3, y - r * 0.32, Math.max(0.45, r * 0.2), 0, 6.28); ctx.fill();
  }

  // ---- audio: rain bed + distant thunder + wipe-on-glass friction --------
  var actx = null, master = null, rainGain = null;
  function unlock() {
    if (actx) { if (actx.state === "suspended") actx.resume(); return; }
    try {
      actx = new (window.AudioContext || window.webkitAudioContext)();
      var b = actx.createBuffer(1, 1, 22050); var s = actx.createBufferSource(); s.buffer = b; s.connect(actx.destination); s.start(0);
      master = actx.createGain(); master.gain.value = 0.9; master.connect(actx.destination);
      startRain();
    } catch (e) { actx = null; }
  }
  // ONE short squeak per stroke — a finger catching on wet glass. A brief
  // band-limited tone with a quick "eek" pitch contour + fast shallow vibrato
  // (the squeak grain) + a tiny contact-noise tick. No sustain, no slow sweep
  // (that read as a siren). Pitch & loudness scale with how fast you dragged.
  function streak(speed) {
    if (!actx) return;
    var t = actx.currentTime;
    var v = Math.max(0, Math.min(1, speed / 1500));
    var dur = 0.16 + 0.14 * v;
    var f0 = 1500 + 1300 * v;
    var o1 = actx.createOscillator(); o1.type = "sawtooth";
    var o2 = actx.createOscillator(); o2.type = "sawtooth";
    o1.frequency.setValueAtTime(f0, t);
    o2.frequency.setValueAtTime(f0 * 1.006, t);
    // quick "eek": a small rise then settle down — natural, not a siren sweep
    o1.frequency.linearRampToValueAtTime(f0 * 1.12, t + dur * 0.22);
    o1.frequency.exponentialRampToValueAtTime(f0 * 0.84, t + dur);
    o2.frequency.linearRampToValueAtTime(f0 * 1.12 * 1.006, t + dur * 0.22);
    o2.frequency.exponentialRampToValueAtTime(f0 * 0.84 * 1.006, t + dur);
    var bp = actx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = f0 * 1.1; bp.Q.value = 5;
    // fast, shallow vibrato = the rubbery squeak grain (NOT a slow siren wobble)
    var vib = actx.createOscillator(); vib.type = "sine"; vib.frequency.value = 33;
    var vibG = actx.createGain(); vibG.gain.value = 60; vib.connect(vibG);
    vibG.connect(o1.frequency); vibG.connect(o2.frequency);
    var g = actx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16 * (0.45 + 0.55 * v), t + 0.018);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o1.connect(bp); o2.connect(bp); bp.connect(g); g.connect(master);
    o1.start(t); o2.start(t); vib.start(t);
    o1.stop(t + dur + 0.02); o2.stop(t + dur + 0.02); vib.stop(t + dur + 0.02);
    // a tiny contact tick at the onset (skin meeting glass)
    var n = whiteLoop(0.12);
    var nbp = actx.createBiquadFilter(); nbp.type = "bandpass"; nbp.frequency.value = 3200; nbp.Q.value = 1.1;
    var ng = actx.createGain(); ng.gain.setValueAtTime(0.06 * v, t); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    n.connect(nbp); nbp.connect(ng); ng.connect(master); n.start(t); n.stop(t + 0.12);
  }
  function noiseLoop(seconds) {
    var len = Math.floor(actx.sampleRate * seconds), buf = actx.createBuffer(1, len, actx.sampleRate), d = buf.getChannelData(0), last = 0;
    for (var i = 0; i < len; i++) { var wn = Math.random() * 2 - 1; last = (last + 0.02 * wn) / 1.02; d[i] = last * 3.0; }
    var src = actx.createBufferSource(); src.buffer = buf; src.loop = true; return src;
  }
  // raw WHITE noise — full of the high-frequency energy a glass-streak hiss needs
  function whiteLoop(seconds) {
    var len = Math.floor(actx.sampleRate * seconds), buf = actx.createBuffer(1, len, actx.sampleRate), d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    var src = actx.createBufferSource(); src.buffer = buf; src.loop = true; return src;
  }
  function startRain() {
    // steady hiss of rain — two filtered noise beds
    var src = noiseLoop(3);
    var lp = actx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 1800; lp.Q.value = 0.5;
    var bp = actx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 2600; bp.Q.value = 0.5;
    rainGain = actx.createGain(); rainGain.gain.value = 0.16;
    var bpG = actx.createGain(); bpG.gain.value = 0.05;
    src.connect(lp); lp.connect(rainGain); rainGain.connect(master);
    var src2 = noiseLoop(3.3); src2.connect(bp); bp.connect(bpG); bpG.connect(master);
    src.start(); src2.start();
    // slow swell on the bed so it breathes
    var lfo = actx.createOscillator(); lfo.frequency.value = 0.05;
    var lg = actx.createGain(); lg.gain.value = 0.05; lfo.connect(lg); lg.connect(rainGain.gain); lfo.start();
  }
  function thunder() {
    if (!actx) return;
    var t = actx.currentTime;
    var src = noiseLoop(2.5);
    var lp = actx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 130; lp.Q.value = 0.6;
    var g = actx.createGain(); g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.5, t + 0.5); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.4);
    var sub = actx.createOscillator(); sub.type = "sine"; sub.frequency.setValueAtTime(48, t); sub.frequency.exponentialRampToValueAtTime(28, t + 2);
    var sg = actx.createGain(); sg.gain.setValueAtTime(0.0001, t); sg.gain.linearRampToValueAtTime(0.4, t + 0.4); sg.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
    src.connect(lp); lp.connect(g); g.connect(master); src.start(t); src.stop(t + 2.5);
    sub.connect(sg); sg.connect(master); sub.start(t); sub.stop(t + 2.3);
  }
  // ---- interaction: wipe the glass ---------------------------------------
  var down = false, lx = 0, ly = 0, lastMoveT = 0, streakArmed = true;
  function wipe(x, y) {
    eraseFogAt(x, y, 34);
    // wiping leaves a little residual water that beads up and clings
    if (Math.random() < 0.3) spawnDrop(x + rand(-12, 12), y + rand(-6, 10), rand(3, 6));
  }
  function start(x, y) { unlock(); down = true; lx = x; ly = y; streakArmed = true; wipe(x, y); if (hintEl) hintEl.classList.add("is-hidden"); }
  function move(x, y) {
    if (!down) return;
    var now = (typeof performance !== "undefined" ? performance.now() : 0);
    var gap = now - lastMoveT;                       // pause since the last move
    var d = Math.hypot(x - lx, y - ly), steps = Math.max(1, Math.ceil(d / 14));
    for (var i = 1; i <= steps; i++) wipe(lx + (x - lx) * (i / steps), ly + (y - ly) * (i / steps));
    // a fresh stroke (drag begins after a pause) re-arms ONE streak sound
    if (gap > 130) streakArmed = true;
    if (d > 3 && streakArmed) {
      var speed = gap > 0 ? d / (gap / 1000) : 600;  // px/s
      streak(speed);
      streakArmed = false;                           // just one streak per stroke
    }
    lastMoveT = now; lx = x; ly = y;
  }
  function end() { down = false; }

  canvas.addEventListener("mousedown", function (e) { start(e.clientX, e.clientY); });
  window.addEventListener("mousemove", function (e) { if (e.buttons & 1) move(e.clientX, e.clientY); });
  window.addEventListener("mouseup", end);
  canvas.addEventListener("touchstart", function (e) { e.preventDefault(); var t = e.touches[0]; start(t.clientX, t.clientY); }, { passive: false });
  canvas.addEventListener("touchmove", function (e) { e.preventDefault(); var t = e.touches[0]; move(t.clientX, t.clientY); }, { passive: false });
  canvas.addEventListener("touchend", function (e) { e.preventDefault(); end(); }, { passive: false });

  // ---- loop ---------------------------------------------------------------
  var lastTs = null, nowish = 0, thunderT = rand(7, 14), sceneAcc = 0;
  function frame(ts) {
    var dt = lastTs !== null ? Math.min((ts - lastTs) / 1000, 0.05) : 0.016;
    lastTs = ts; nowish += dt;

    thunderT -= dt;
    if (thunderT <= 0) { thunder(); thunderT = rand(12, 26); }

    // the world outside drifts + twinkles slowly; repaint the scene (and rebuild the
    // blurred fog from it) on a throttle — the motion is gentle, so ~9fps is plenty
    sceneAcc += dt;
    if (sceneAcc >= 0.11) {
      sceneAcc = 0;
      paintScene(nowish);
      buildFrost();
    }

    update(dt);

    // compose: world → fog → drops
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(bg, 0, 0, W, H);
    ctx.drawImage(fog, 0, 0, W, H);
    var i;
    for (i = 0; i < cond.length; i++) drawDrop(cond[i].x, cond[i].y, cond[i].r);
    for (i = 0; i < drops.length; i++) drawDrop(drops[i].x, drops[i].y, drops[i].r);

    requestAnimationFrame(frame);
  }

  var fogBtn = document.getElementById("fogBtn");
  if (fogBtn) fogBtn.addEventListener("click", function () { unlock(); refog(); if (hintEl) hintEl.classList.add("is-hidden"); });

  resize();
  window.addEventListener("resize", resize);
  requestAnimationFrame(frame);
  setTimeout(function () { if (hintEl) hintEl.classList.add("is-hidden"); }, 8500);
})();
