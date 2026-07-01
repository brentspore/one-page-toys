/* Kalimba — a glowing thumb-piano, dreamy in the spirit of Sky.
 * Pluck the tines to play a warm pentatonic mbira; swipe across for a glissando.
 * Every note releases a small rising mote of light and blooms the scene, and the
 * whole instrument is tuned pentatonic so anything you play sounds consonant.
 * Vanilla Canvas 2D + Web Audio (fully synthesized — no samples).
 */
(function () {
  "use strict";

  // ---- TUNABLES -----------------------------------------------------------
  var N = 15;                       // number of tines (3 octaves of pentatonic)
  var DEGREES = [0, 2, 4, 7, 9];    // major pentatonic scale (semitone offsets)
  var ROOTS = [                     // selectable keys (root MIDI note)
    { name: "C", midi: 60 }, { name: "D", midi: 62 }, { name: "F", midi: 65 },
    { name: "G", midi: 67 }, { name: "A", midi: 69 }
  ];
  var VIB_DECAY = 6.5;              // visual tine-wobble decay (1/s)
  var MAX_DISP = 11;               // px of tine-tip sway at full pluck
  // -------------------------------------------------------------------------

  var NOTE_NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];

  var canvas = document.getElementById("canvas");
  var ctx = canvas.getContext("2d");
  var hintEl = document.querySelector(".hint");

  var W, H, DPR, cx;
  var bx, boardTopY, boardBottom, bh, bw, bridgeY, Hmax, Hmin, leftX, rightX, spacing;
  var tines = [];
  var rootIdx = 0, labels = false;
  var motes = [], bgMotes = [], rings = [], stars = [];
  var glow = 0;                      // scene bloom energy (rises as you play)
  var pointerDown = false, lastTine = -1;

  // ---- layout / tuning ----------------------------------------------------
  function buildTines() {
    tines = [];
    var center = (N - 1) / 2;
    // center-out pitch order (authentic kalimba: lowest in the middle, alternating out)
    var order = [Math.round(center)];
    for (var k = 1; order.length < N; k++) {
      var r = Math.round(center) + k, l = Math.round(center) - k;
      if (r < N) order.push(r);
      if (l >= 0) order.push(l);
    }
    var rank = new Array(N);
    for (var i = 0; i < N; i++) rank[order[i]] = i;   // tine index -> pitch rank
    var rootMidi = ROOTS[rootIdx].midi;
    for (i = 0; i < N; i++) {
      var rk = rank[i];
      var midi = rootMidi + DEGREES[rk % 5] + 12 * Math.floor(rk / 5);
      tines.push({
        i: i, rank: rk, midi: midi,
        freq: 440 * Math.pow(2, (midi - 69) / 12),
        name: NOTE_NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1),
        vib: 0, vphase: 0, lit: 0
      });
    }
  }

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = W * DPR; canvas.height = H * DPR;
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    cx = W / 2;
    bw = Math.min(W * 0.86, 560);
    bh = Math.min(H * 0.46, 380);
    boardBottom = Math.min(H * 0.82, H - 78);
    boardTopY = boardBottom - bh;
    bridgeY = boardTopY + bh * 0.52;
    Hmax = bh * 0.62; Hmin = bh * 0.24;
    leftX = cx - bw * 0.40; rightX = cx + bw * 0.40;
    spacing = (rightX - leftX) / (N - 1);
    if (!bgMotes.length) seedBgMotes();
    seedStars();
  }
  function tineX(i) { return leftX + i * spacing; }
  function tineHeight(i) {
    var center = (N - 1) / 2, t = (i - center) / center;
    return Hmax - (Hmax - Hmin) * Math.pow(Math.abs(t), 1.35);
  }
  function tipY(i) { return bridgeY - tineHeight(i); }

  function seedBgMotes() {
    bgMotes = [];
    for (var i = 0; i < 24; i++) bgMotes.push({ x: Math.random() * W, y: Math.random() * H, r: 0.6 + Math.random() * 2.0, sp: 6 + Math.random() * 16, ph: Math.random() * 6.28, tw: 0.4 + Math.random() * 0.6 });
  }
  function seedStars() {
    stars = [];
    var n = Math.round(W * H / 9000);
    for (var i = 0; i < n; i++) stars.push({ x: Math.random() * W, y: Math.random() * H * 0.7, r: 0.3 + Math.random() * 1.5, base: 0.3 + Math.random() * 0.6, tw: 0.6 + Math.random() * 2.0, ph: Math.random() * 6.28 });
  }

  // ---- render -------------------------------------------------------------
  function render(t) {
    // dreamy night sky
    var sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, "#070818"); sky.addColorStop(0.42, "#12123a"); sky.addColorStop(0.74, "#241d48"); sky.addColorStop(1, "#3a2b55");
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);

    // stars
    ctx.save(); ctx.globalCompositeOperation = "lighter";
    for (var si = 0; si < stars.length; si++) {
      var st = stars[si], sa = st.base * (0.45 + 0.55 * (0.5 + 0.5 * Math.sin(t * st.tw + st.ph)));
      ctx.fillStyle = "rgba(226,232,255," + sa + ")";
      ctx.beginPath(); ctx.arc(st.x, st.y, st.r, 0, 6.283); ctx.fill();
    }
    ctx.restore();

    // moon (upper-right) with a soft halo
    var mx = W * 0.82, my = H * 0.17, mr = Math.min(W, H) * 0.05;
    ctx.save(); ctx.globalCompositeOperation = "lighter";
    var halo = ctx.createRadialGradient(mx, my, 0, mx, my, mr * 3.4);
    halo.addColorStop(0, "rgba(210,220,255,0.22)"); halo.addColorStop(1, "rgba(210,220,255,0)");
    ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(mx, my, mr * 3.4, 0, 6.283); ctx.fill(); ctx.restore();
    var mg = ctx.createRadialGradient(mx - mr * 0.3, my - mr * 0.3, mr * 0.2, mx, my, mr);
    mg.addColorStop(0, "#f2f4ff"); mg.addColorStop(0.7, "#d3d8ee"); mg.addColorStop(1, "#aab0cc");
    ctx.fillStyle = mg; ctx.beginPath(); ctx.arc(mx, my, mr, 0, 6.283); ctx.fill();
    ctx.fillStyle = "rgba(150,158,190,0.35)"; ctx.beginPath(); ctx.arc(mx + mr * 0.32, my - mr * 0.18, mr * 0.2, 0, 6.283); ctx.fill();
    ctx.beginPath(); ctx.arc(mx - mr * 0.25, my + mr * 0.3, mr * 0.13, 0, 6.283); ctx.fill();

    // warm bloom behind the instrument — intensifies as you play
    var gy = boardTopY + bh * 0.4;
    var bloomR = Math.max(W, H) * (0.45 + glow * 0.16);
    var bg = ctx.createRadialGradient(cx, gy, 0, cx, gy, bloomR);
    bg.addColorStop(0, "rgba(255,214,150," + (0.16 + glow * 0.34) + ")");
    bg.addColorStop(0.5, "rgba(255,180,120," + (0.05 + glow * 0.12) + ")");
    bg.addColorStop(1, "rgba(255,180,120,0)");
    ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.fillStyle = bg;
    ctx.beginPath(); ctx.arc(cx, gy, bloomR, 0, 6.283); ctx.fill(); ctx.restore();

    // drifting background light motes
    ctx.save(); ctx.globalCompositeOperation = "lighter";
    for (var i = 0; i < bgMotes.length; i++) {
      var m = bgMotes[i]; var a = (0.14 + 0.4 * (0.5 + 0.5 * Math.sin(t * m.tw + m.ph)));
      ctx.fillStyle = "rgba(214,226,255," + a * (0.5 + glow * 0.6) + ")";
      ctx.beginPath(); ctx.arc(m.x, m.y, m.r, 0, 6.283); ctx.fill();
    }
    ctx.restore();

    drawBoard();
    for (i = 0; i < N; i++) drawTine(tines[i], t);

    // rings (pluck halos)
    ctx.save(); ctx.globalCompositeOperation = "lighter";
    for (i = 0; i < rings.length; i++) {
      var rg = rings[i];
      ctx.strokeStyle = "rgba(255,226,170," + Math.max(0, rg.life * 0.5) + ")";
      ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(rg.x, rg.y, rg.r, 0, 6.283); ctx.stroke();
    }
    // rising motes
    for (i = 0; i < motes.length; i++) {
      var p = motes[i];
      var mg = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
      mg.addColorStop(0, "rgba(255,246,214," + Math.max(0, p.life) + ")");
      mg.addColorStop(1, "rgba(255,210,150,0)");
      ctx.fillStyle = mg; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.283); ctx.fill();
    }
    ctx.restore();
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function drawBoard() {
    var x = cx - bw / 2;
    // soft glow rim
    ctx.save(); ctx.shadowColor = "rgba(255,190,130,0.5)"; ctx.shadowBlur = 40;
    roundRect(x, boardTopY, bw, bh, Math.min(46, bw * 0.08));
    var wood = ctx.createLinearGradient(0, boardTopY, 0, boardBottom);
    wood.addColorStop(0, "#4a2d63"); wood.addColorStop(0.5, "#331d47"); wood.addColorStop(1, "#1e1233");
    ctx.fillStyle = wood; ctx.fill(); ctx.restore();
    // top sheen
    ctx.save(); roundRect(x, boardTopY, bw, bh, Math.min(46, bw * 0.08)); ctx.clip();
    var sh = ctx.createLinearGradient(0, boardTopY, 0, boardTopY + bh * 0.5);
    sh.addColorStop(0, "rgba(255,236,210,0.18)"); sh.addColorStop(1, "rgba(255,236,210,0)");
    ctx.fillStyle = sh; ctx.fillRect(x, boardTopY, bw, bh * 0.5);
    // faint figured grain
    ctx.globalAlpha = 0.10; ctx.strokeStyle = "#180d29"; ctx.lineWidth = 1;
    for (var ggi = 0; ggi < 7; ggi++) { var gy2 = boardTopY + bh * (0.12 + ggi * 0.12); ctx.beginPath(); for (var xx = x; xx <= x + bw; xx += 14) ctx.lineTo(xx, gy2 + Math.sin(xx * 0.03 + ggi) * 3); ctx.stroke(); }
    ctx.restore();
    // rim highlight
    roundRect(x, boardTopY, bw, bh, Math.min(46, bw * 0.08));
    ctx.strokeStyle = "rgba(255,224,180,0.28)"; ctx.lineWidth = 1.5; ctx.stroke();

    // soundhole
    var hy = bridgeY + bh * 0.24, hr = bh * 0.10;
    var hg = ctx.createRadialGradient(cx, hy, hr * 0.2, cx, hy, hr);
    hg.addColorStop(0, "#0e0718"); hg.addColorStop(0.8, "#1a0f2b"); hg.addColorStop(1, "#241638");
    ctx.fillStyle = hg; ctx.beginPath(); ctx.arc(cx, hy, hr, 0, 6.283); ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.5)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx, hy, hr, 0, 6.283); ctx.stroke();

    // bridge / pressure bar across the tines
    var bym = bridgeY;
    var barg = ctx.createLinearGradient(0, bym - 9, 0, bym + 9);
    barg.addColorStop(0, "#d9d2c4"); barg.addColorStop(0.5, "#8b8477"); barg.addColorStop(1, "#4c463b");
    ctx.fillStyle = barg; roundRect(leftX - spacing * 0.7, bym - 9, (rightX - leftX) + spacing * 1.4, 18, 6); ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.3)"; ctx.lineWidth = 1; ctx.stroke();
  }

  function drawTine(tn, t) {
    var x = tineX(tn.i), baseY = bridgeY + bh * 0.14, ty = tipY(tn.i);
    var disp = tn.vib * MAX_DISP * Math.sin(tn.vphase);
    var wdt = Math.max(5, spacing * 0.36);
    // sampled path base->tip with tip sway
    ctx.save();
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    var segs = 7, pts = [];
    for (var s = 0; s <= segs; s++) {
      var f = s / segs;                 // 0 at base, 1 at tip
      var yy = baseY + (ty - baseY) * f;
      var xx = x + disp * (f * f);      // bends more toward the free tip
      pts.push([xx, yy]);
    }
    // steel body
    var mg = ctx.createLinearGradient(x, baseY, x, ty);
    mg.addColorStop(0, "#5a6270"); mg.addColorStop(0.5, "#aeb8c6"); mg.addColorStop(1, "#e9f0fb");
    ctx.strokeStyle = mg; ctx.lineWidth = wdt;
    ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (s = 1; s <= segs; s++) ctx.lineTo(pts[s][0], pts[s][1]); ctx.stroke();
    // center highlight
    ctx.strokeStyle = "rgba(255,255,255,0.55)"; ctx.lineWidth = Math.max(1, wdt * 0.22);
    ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (s = 1; s <= segs; s++) ctx.lineTo(pts[s][0], pts[s][1]); ctx.stroke();
    ctx.restore();

    // glowing tip (bright when freshly plucked)
    var tipx = pts[segs][0], tipy = pts[segs][1];
    var litAmt = Math.max(tn.vib, tn.lit);
    if (litAmt > 0.01) {
      ctx.save(); ctx.globalCompositeOperation = "lighter";
      var r = wdt * (1.1 + litAmt * 1.8);
      var tg = ctx.createRadialGradient(tipx, tipy, 0, tipx, tipy, r);
      tg.addColorStop(0, "rgba(255,244,210," + (0.5 + 0.5 * litAmt) + ")");
      tg.addColorStop(1, "rgba(255,210,150,0)");
      ctx.fillStyle = tg; ctx.beginPath(); ctx.arc(tipx, tipy, r, 0, 6.283); ctx.fill();
      ctx.restore();
    } else {
      // resting tip cap
      ctx.fillStyle = "#f2f6ff"; ctx.beginPath(); ctx.arc(tipx, tipy, wdt * 0.5, 0, 6.283); ctx.fill();
    }

    if (labels) {
      ctx.save(); ctx.textAlign = "center"; ctx.textBaseline = "bottom";
      ctx.font = "600 " + Math.max(9, spacing * 0.34) + "px Geist, system-ui, sans-serif";
      ctx.fillStyle = "rgba(255,240,214,0.72)";
      ctx.fillText(tn.name, tipx, tipy - wdt * 0.7);
      ctx.restore();
    }
  }

  // ---- pluck --------------------------------------------------------------
  function pluckTine(idx, vel) {
    if (idx < 0 || idx >= N) return;
    var tn = tines[idx];
    tn.vib = 1; tn.lit = 1; tn.vphase = Math.random() * 6.28;
    glow = Math.min(1, glow + 0.16 * (vel || 1));
    var tx = tineX(idx), ty = tipY(idx);
    rings.push({ x: tx, y: ty, r: 6, life: 1 });
    for (var k = 0; k < 2; k++) motes.push({ x: tx + (Math.random() - 0.5) * 10, y: ty, vx: (Math.random() - 0.5) * 14, vy: -(26 + Math.random() * 46), r: 4 + Math.random() * 5, life: 1 });
    tone(tn.freq, vel || 1, (idx / (N - 1) - 0.5) * 0.6);   // spread tines across the stereo field
    if (hintEl) hintEl.classList.add("is-hidden");
  }

  // ---- loop ---------------------------------------------------------------
  var lastTs = null;
  function frame(ts) {
    var t = ts / 1000;
    var dt = lastTs !== null ? Math.min((ts - lastTs) / 1000, 0.05) : 0.016; lastTs = ts;
    glow = Math.max(0, glow - dt * 0.7);
    for (var i = 0; i < N; i++) {
      var tn = tines[i];
      if (tn.vib > 0) { tn.vphase += dt * (26 + tn.rank * 1.5); tn.vib = Math.max(0, tn.vib - dt * VIB_DECAY); }
      if (tn.lit > 0) tn.lit = Math.max(0, tn.lit - dt * 1.6);
    }
    for (i = rings.length - 1; i >= 0; i--) { var rg = rings[i]; rg.r += dt * 120; rg.life -= dt * 1.6; if (rg.life <= 0) rings.splice(i, 1); }
    for (i = motes.length - 1; i >= 0; i--) { var p = motes[i]; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 8 * dt; p.life -= dt * 0.5; if (p.life <= 0) motes.splice(i, 1); }
    for (i = 0; i < bgMotes.length; i++) { var m = bgMotes[i]; m.y -= m.sp * dt; m.x += Math.sin(t * 0.3 + m.ph) * 6 * dt; if (m.y < -6) { m.y = H + 6; m.x = Math.random() * W; } }
    render(t); requestAnimationFrame(frame);
  }

  // ---- input --------------------------------------------------------------
  function tineAt(x, y) {
    if (x < leftX - spacing * 0.6 || x > rightX + spacing * 0.6) return -1;
    if (y < boardTopY - bh * 0.16 || y > boardBottom) return -1;
    var idx = Math.round((x - leftX) / spacing);
    return (idx >= 0 && idx < N) ? idx : -1;
  }
  function down(x, y) {
    unlock(); pointerDown = true;
    var idx = tineAt(x, y);
    if (idx >= 0) { pluckTine(idx, 1); lastTine = idx; }
  }
  function moveTo(x, y) {
    if (!pointerDown) return;
    var idx = tineAt(x, y);
    if (idx >= 0 && idx !== lastTine) { pluckTine(idx, 0.8); lastTine = idx; }
  }
  function up() { pointerDown = false; lastTine = -1; }
  canvas.addEventListener("mousedown", function (e) { down(e.clientX, e.clientY); });
  window.addEventListener("mousemove", function (e) { moveTo(e.clientX, e.clientY); });
  window.addEventListener("mouseup", up);
  canvas.addEventListener("touchstart", function (e) { e.preventDefault(); for (var i = 0; i < e.changedTouches.length; i++) { var t = e.changedTouches[i]; unlock(); pointerDown = true; var idx = tineAt(t.clientX, t.clientY); if (idx >= 0) { pluckTine(idx, 1); lastTine = idx; } } }, { passive: false });
  canvas.addEventListener("touchmove", function (e) { e.preventDefault(); var t = e.touches[0]; moveTo(t.clientX, t.clientY); }, { passive: false });
  window.addEventListener("touchend", up);

  var keyBtn = document.getElementById("keyBtn");
  keyBtn.addEventListener("click", function () { rootIdx = (rootIdx + 1) % ROOTS.length; keyBtn.textContent = "Key: " + ROOTS[rootIdx].name; buildTines(); });
  var labelBtn = document.getElementById("labelBtn");
  labelBtn.addEventListener("click", function () { labels = !labels; labelBtn.setAttribute("aria-pressed", labels ? "true" : "false"); labelBtn.textContent = labels ? "Labels: on" : "Labels: off"; });

  // ---- audio (synth) ------------------------------------------------------
  // A kalimba tine is a clamped-free steel bar: its overtones are INHARMONIC
  // (ratios ≈ 1 : 6.27 : 17.55), a bright metallic "ting" on attack over a warm
  // fundamental. We voice that with additive bar modes + a chorused/octave body,
  // a filtered-noise pluck contact, spread the tines across the stereo field,
  // and glue everything with a soft compressor into a lush, clean reverb.
  var actx = null, dryBus = null, wetBus = null, comp = null, outGain = null, muted = false;
  function makeImpulse(sec, decay) {
    var rate = actx.sampleRate, len = (rate * sec) | 0, buf = actx.createBuffer(2, len, rate);
    for (var ch = 0; ch < 2; ch++) {
      var d = buf.getChannelData(ch);
      for (var i = 0; i < len; i++) { var e = Math.pow(1 - i / len, decay); d[i] = (Math.random() * 2 - 1) * e; }
    }
    return buf;
  }
  function unlock() {
    if (actx) { if (actx.state === "suspended") actx.resume(); return; }
    try {
      actx = new (window.AudioContext || window.webkitAudioContext)();
      var b = actx.createBuffer(1, 1, 22050), s = actx.createBufferSource(); s.buffer = b; s.connect(actx.destination); s.start(0);
      outGain = actx.createGain(); outGain.gain.value = muted ? 0 : 0.9;
      var mlp = actx.createBiquadFilter(); mlp.type = "lowpass"; mlp.frequency.value = 11000; mlp.Q.value = 0.5;
      comp = actx.createDynamicsCompressor();
      comp.threshold.value = -16; comp.knee.value = 26; comp.ratio.value = 3.2; comp.attack.value = 0.003; comp.release.value = 0.2;
      comp.connect(mlp); mlp.connect(outGain); outGain.connect(actx.destination);
      dryBus = actx.createGain(); dryBus.gain.value = 0.9; dryBus.connect(comp);
      // reverb: pre-delay -> highpass (keep the tail clean) -> convolver
      var conv = actx.createConvolver(); conv.buffer = makeImpulse(2.6, 2.4);
      var pre = actx.createDelay(0.1); pre.delayTime.value = 0.02;
      var hp = actx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 250;
      wetBus = actx.createGain(); wetBus.gain.value = 0.27;
      wetBus.connect(pre); pre.connect(hp); hp.connect(conv); conv.connect(comp);
    } catch (e) { actx = null; }
  }
  function tone(freq, vel, pan) {
    if (!actx) return; vel = vel || 1;
    var t = actx.currentTime, nyq = actx.sampleRate / 2;
    var dur = Math.max(0.9, Math.min(4.0, 3.2 * Math.pow(261.63 / freq, 0.5)));  // lower notes ring longer
    var voice = actx.createGain(); voice.gain.value = 0.8 * vel;
    try { var pn = actx.createStereoPanner(); pn.pan.value = Math.max(-1, Math.min(1, pan || 0)); voice.connect(pn); pn.connect(dryBus); pn.connect(wetBus); }
    catch (e) { voice.connect(dryBus); voice.connect(wetBus); }
    // a single voice partial (glide = slight attack pitch drop, like a released tine)
    function part(type, f, peak, dec, glide) {
      if (f > nyq * 0.9) return;
      var o = actx.createOscillator(); o.type = type;
      if (glide) { o.frequency.setValueAtTime(f * 1.012, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.03); }
      else o.frequency.setValueAtTime(f, t);
      var g = actx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0005, t + dec);
      o.connect(g); g.connect(voice); o.start(t); o.stop(t + dec + 0.05);
    }
    // warm body
    part("sine", freq, 0.30, dur, true);
    part("sine", freq * Math.pow(2, 4 / 1200), 0.16, dur, true);   // +4-cent chorus shimmer
    part("triangle", freq, 0.05, dur * 0.7, true);                  // gentle reedy edge
    part("sine", freq * 2, 0.05, dur * 0.6, false);                 // octave register
    // inharmonic clamped-free bar modes — the metallic tine "ting" (fast decay)
    part("sine", freq * 6.27, 0.10 * vel, 0.14, false);
    part("sine", freq * 17.55, 0.032 * vel, 0.06, false);
    // pluck contact tick
    var ln = (0.012 * actx.sampleRate) | 0, nb = actx.createBufferSource(), buf = actx.createBuffer(1, ln, actx.sampleRate), d = buf.getChannelData(0);
    for (var i = 0; i < ln; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / ln, 2.5);
    nb.buffer = buf; var bp = actx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = Math.min(3400, freq * 4); bp.Q.value = 0.8;
    var ng = actx.createGain(); ng.gain.value = 0.05 * vel; nb.connect(bp); bp.connect(voice); nb.start(t);
  }
  var soundBtn = document.getElementById("soundBtn");
  soundBtn.addEventListener("click", function () {
    muted = !muted; unlock();
    if (outGain) outGain.gain.setTargetAtTime(muted ? 0 : 0.9, actx.currentTime, 0.02);
    soundBtn.textContent = muted ? "Sound: off" : "Sound: on";
    soundBtn.setAttribute("aria-pressed", muted ? "true" : "false");
  });

  // ---- boot ---------------------------------------------------------------
  resize(); window.addEventListener("resize", resize);
  buildTines();
  requestAnimationFrame(frame);
})();
