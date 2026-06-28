/* Fireworks — tap the night sky to launch shells that arc up and burst.
 * Glowing sparks with fading light-trails (additive trail buffer), layered
 * boom + crackle synthesis, drifting smoke, and a soft reflection on the water.
 */
(function () {
  "use strict";

  var canvas = document.getElementById("canvas");
  var ctx = canvas.getContext("2d");
  var hintEl = document.querySelector(".hint");

  // additive trail buffer — sparks/rockets accumulate here and fade each frame,
  // giving silky light-trails over a crisp starry sky
  var tcv = document.createElement("canvas");
  var tctx = tcv.getContext("2d");

  var W, H, DPR, WATER;

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = W * DPR; canvas.height = H * DPR;
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    tcv.width = W * DPR; tcv.height = H * DPR;
    tctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    WATER = H * 0.84;
    seedStars();
  }

  // ---- stars + city silhouette -------------------------------------------
  var stars = [];
  function seedStars() {
    stars.length = 0;
    var n = Math.round(W * H / 7000);
    for (var i = 0; i < n; i++) {
      var y = Math.random() * WATER * 0.96;
      stars.push({ x: Math.random() * W, y: y, r: Math.random() * 1.1 + 0.3, tw: Math.random() * 6.28, sp: 0.6 + Math.random() * 1.8 });
    }
  }

  // ---- particles ----------------------------------------------------------
  var rockets = [], sparks = [], smoke = [], flashes = [], pending = [];
  var HUES = [0, 18, 45, 120, 175, 205, 280, 320];
  // weighted pool of shell effects (duplicates = more common)
  var SHELLS = ["peony", "peony", "chrys", "ring", "willow", "palm", "crackle",
                "strobe", "crossette", "double", "spider", "dahlia", "multibreak"];

  function rand(a, b) { return a + Math.random() * (b - a); }

  function launch(tx, ty) {
    unlock();
    tx = Math.max(W * 0.08, Math.min(W * 0.92, tx));
    ty = Math.max(H * 0.08, Math.min(WATER * 0.62, ty == null ? rand(H * 0.16, H * 0.4) : ty));
    var hue = HUES[(Math.random() * HUES.length) | 0];
    rockets.push({
      x: tx, y: WATER - 4, ty: ty,
      vx: rand(-22, 22), vy: -(WATER - ty) / 0.72,   // px/s — reaches target in ~0.7s
      hue: hue, life: 0, trailT: 0,
      type: SHELLS[(Math.random() * SHELLS.length) | 0]
    });
    launchThump();
    if (Math.random() < 0.45) whistle();   // only some shells scream as they climb
  }

  function burst(x, y, hue, type) {
    boom();
    var n, i, ang, sp, B = Math.min(W, H) * 0.52;   // reference burst speed, px/s
    // the hard white flash on the break — a real shell lights the sky for a moment
    flashes.push({ x: x, y: y, hue: hue, life: 0.2, max: 0.2 });

    if (type === "ring") {
      n = 48;
      for (i = 0; i < n; i++) {
        ang = (i / n) * 6.283; sp = B * 0.52;
        addSpark(x, y, Math.cos(ang) * sp, Math.sin(ang) * sp, hue, 1.15, 0.95);
      }
    } else if (type === "double") {                  // two concentric rings, two colours
      var h2 = (hue + rand(120, 200)) % 360;
      n = 42; for (i = 0; i < n; i++) { ang = (i / n) * 6.283; sp = B * 0.56; addSpark(x, y, Math.cos(ang) * sp, Math.sin(ang) * sp, hue, 1.25, 0.95); }
      n = 30; for (i = 0; i < n; i++) { ang = (i / n) * 6.283 + 0.1; sp = B * 0.32; addSpark(x, y, Math.cos(ang) * sp, Math.sin(ang) * sp, h2, 1.05, 0.9); }
    } else if (type === "willow") {
      n = 84;
      for (i = 0; i < n; i++) {
        ang = rand(0, 6.283); sp = B * rand(0.16, 0.44);
        addSpark(x, y, Math.cos(ang) * sp, Math.sin(ang) * sp - B * 0.1, 44, 2.5, 0.5, true, 0.5);
      }
    } else if (type === "palm") {
      n = 12; // few thick rising fronds that droop
      for (i = 0; i < n; i++) {
        ang = -1.57 + rand(-1.0, 1.0); sp = B * rand(0.44, 0.64);
        addSpark(x, y, Math.cos(ang) * sp, Math.sin(ang) * sp, hue, 1.9, 0.75, true, 1.5);
      }
    } else if (type === "spider") {                  // thin straight long-lived rays
      n = 30;
      for (i = 0; i < n; i++) {
        ang = (i / n) * 6.283 + rand(-0.05, 0.05); sp = B * rand(0.58, 0.7);
        addSpark(x, y, Math.cos(ang) * sp, Math.sin(ang) * sp, hue, 1.5, 0.9, true, 0.45);
      }
    } else if (type === "dahlia") {                  // fewer, bigger, long-throw stars
      n = 40;
      for (i = 0; i < n; i++) {
        ang = rand(0, 6.283); sp = B * rand(0.42, 0.66);
        addSpark(x, y, Math.cos(ang) * sp, Math.sin(ang) * sp, hue, 2.0, 1.0, true, 0.7, false, { big: true });
      }
    } else if (type === "crossette") {               // stars that split into a cross
      n = 20;
      for (i = 0; i < n; i++) {
        ang = (i / n) * 6.283; sp = B * rand(0.4, 0.46);
        addSpark(x, y, Math.cos(ang) * sp, Math.sin(ang) * sp, hue, 1.4, 0.95, true, 0.7, false, { split: 0.5 });
      }
    } else if (type === "strobe") {                  // glittering twinkle sphere
      n = 110;
      for (i = 0; i < n; i++) {
        ang = rand(0, 6.283); sp = B * rand(0.1, 0.5);
        addSpark(x, y, Math.cos(ang) * sp, Math.sin(ang) * sp, hue, rand(1.4, 2.2), 0.85, false, 1, false, { twinkle: true });
      }
    } else if (type === "crackle") {
      n = 64;
      for (i = 0; i < n; i++) {
        ang = rand(0, 6.283); sp = B * rand(0.1, 0.46);
        addSpark(x, y, Math.cos(ang) * sp, Math.sin(ang) * sp, hue, rand(0.7, 1.3), 0.85, false, 1, true);
      }
      crackle(0.9);
    } else if (type === "multibreak") {              // a small break + 2–3 offset secondaries
      n = 60;
      for (i = 0; i < n; i++) {
        ang = rand(0, 6.283); sp = B * rand(0.12, 0.4);
        addSpark(x, y, Math.cos(ang) * sp, Math.sin(ang) * sp, hue, 1.05, 0.9);
      }
      var subs = ["peony", "ring", "willow", "strobe", "chrys"], nb = 2 + ((Math.random() * 2) | 0);
      for (i = 0; i < nb; i++) {
        pending.push({
          t: rand(0.18, 0.5), x: x + rand(-B * 0.22, B * 0.22), y: y + rand(-B * 0.16, B * 0.16),
          hue: HUES[(Math.random() * HUES.length) | 0], type: subs[(Math.random() * subs.length) | 0]
        });
      }
    } else { // peony / chrysanthemum — full sphere, often colour-changing + a pistil
      n = type === "chrys" ? 124 : 96;
      var twoTone = Math.random() < 0.55, ht = (hue + rand(120, 210)) % 360;
      for (i = 0; i < n; i++) {
        ang = rand(0, 6.283); sp = B * rand(0.12, 0.6) * (Math.random() < 0.5 ? 1 : rand(0.5, 1));
        addSpark(x, y, Math.cos(ang) * sp, Math.sin(ang) * sp, hue, type === "chrys" ? 1.8 : 1.25, 0.9, type === "chrys", 1, false, twoTone ? { hue2: ht } : null);
      }
      // pistil — a dense contrasting inner sphere (very common in real peonies)
      if (Math.random() < 0.55) {
        var hp = (hue + rand(120, 220)) % 360;
        for (i = 0; i < 30; i++) { ang = rand(0, 6.283); sp = B * rand(0.06, 0.2); addSpark(x, y, Math.cos(ang) * sp, Math.sin(ang) * sp, hp, 1.05, 0.95); }
      }
    }
    // some shells finish with an extra burst of crackling pops a beat after the flower
    // (the classic "crackling" chrysanthemum) — skip the shells that already crackle
    if (type !== "crackle" && type !== "crossette" && Math.random() < 0.34) {
      pending.push({ t: rand(0.35, 0.7), x: x, y: y, hue: hue, B: B, crk: true });
    }
    // a couple of smoke puffs at the burst
    for (i = 0; i < 4; i++) smoke.push({ x: x + rand(-12, 12), y: y + rand(-12, 12), r: rand(8, 16), vy: rand(-8, -3), life: rand(2.2, 3.4), max: 3.4 });
  }

  // a field of glittering crackle pops (gold-white) bursting outward + the crackle sound
  function crackleField(x, y, hue, B) {
    var n = 56, i, ang, sp;
    for (i = 0; i < n; i++) {
      ang = rand(0, 6.283); sp = B * rand(0.06, 0.34);
      addSpark(x, y, Math.cos(ang) * sp, Math.sin(ang) * sp, hue, rand(0.5, 1.0), 0.85, false, 1, true);
    }
    crackle(rand(0.7, 1.0));
  }

  function addSpark(x, y, vx, vy, hue, life, bright, trail, gmul, crk, opts) {
    opts = opts || {};
    sparks.push({
      x: x, y: y, vx: vx, vy: vy, hue: hue, hue2: opts.hue2 == null ? hue : opts.hue2,
      life: life, max: life, bright: bright,
      trail: !!trail, g: (gmul == null ? 1 : gmul) * 130, drag: 0.4, crk: !!crk,
      twinkle: !!opts.twinkle, splitT: opts.split || 0, big: !!opts.big,
      flick: Math.random() * 6.28
    });
  }

  function update(dt) {
    var i, r, s, dpow = Math.pow(0.4, dt);
    // rockets
    for (i = rockets.length - 1; i >= 0; i--) {
      r = rockets[i];
      r.vy += 220 * dt;                      // gravity px/s² so it decelerates near apex
      r.x += r.vx * dt; r.y += r.vy * dt;
      r.life += dt;
      // emit a sparky trail
      r.trailT -= dt;
      if (r.trailT <= 0) {
        r.trailT = 0.014;
        addSpark(r.x + rand(-1.5, 1.5), r.y + rand(2, 6), rand(-26, 26), rand(50, 120), 38, 0.32, 0.6);
      }
      if (r.vy >= -20 || r.y <= r.ty) { burst(r.x, r.y, r.hue, r.type); rockets.splice(i, 1); }
    }
    // pending secondary bursts (multi-break shells)
    for (i = pending.length - 1; i >= 0; i--) {
      pending[i].t -= dt;
      if (pending[i].t <= 0) {
        var pb = pending.splice(i, 1)[0];
        if (pb.crk) crackleField(pb.x, pb.y, pb.hue, pb.B);
        else burst(pb.x, pb.y, pb.hue, pb.type);
      }
    }
    // burst flashes fade fast
    for (i = flashes.length - 1; i >= 0; i--) { flashes[i].life -= dt; if (flashes[i].life <= 0) flashes.splice(i, 1); }
    // sparks
    for (i = sparks.length - 1; i >= 0; i--) {
      s = sparks[i];
      s.vy += s.g * dt;
      s.vx *= dpow; s.vy *= dpow;            // air drag — fast expand, gentle slow
      s.x += s.vx * dt; s.y += s.vy * dt;
      s.life -= dt;
      // crossette stars split into a little cross partway through their flight
      if (s.splitT > 0) {
        s.splitT -= dt;
        if (s.splitT <= 0 && s.life > 0.2) {
          var base = Math.atan2(s.vy, s.vx), spd = Math.hypot(s.vx, s.vy) * 0.55;
          for (var c = 0; c < 4; c++) {
            var a2 = base + c * 1.5708;
            addSpark(s.x, s.y, Math.cos(a2) * spd, Math.sin(a2) * spd, s.hue, 0.5, 1, true, 0.9, true);
          }
          sparks.splice(i, 1); continue;
        }
      }
      if (s.life <= 0) sparks.splice(i, 1);
    }
    // smoke
    for (i = smoke.length - 1; i >= 0; i--) {
      var sm = smoke[i];
      sm.y += sm.vy * dt; sm.vy *= 0.99; sm.r += 8 * dt; sm.life -= dt;
      if (sm.life <= 0) smoke.splice(i, 1);
    }
  }

  // ---- rendering ----------------------------------------------------------
  function drawSky() {
    var g = ctx.createLinearGradient(0, 0, 0, WATER);
    g.addColorStop(0, "#070512");
    g.addColorStop(0.55, "#0a0a20");
    g.addColorStop(1, "#11162e");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, WATER);
    // stars
    for (var i = 0; i < stars.length; i++) {
      var st = stars[i], a = 0.25 + Math.abs(Math.sin(nowish * st.sp + st.tw)) * 0.55;
      ctx.globalAlpha = a; ctx.fillStyle = "#cfd8ff";
      ctx.beginPath(); ctx.arc(st.x, st.y, st.r, 0, 6.28); ctx.fill();
    }
    ctx.globalAlpha = 1;
    // water
    var wg = ctx.createLinearGradient(0, WATER, 0, H);
    wg.addColorStop(0, "#0a1024");
    wg.addColorStop(1, "#05060f");
    ctx.fillStyle = wg; ctx.fillRect(0, WATER, W, H - WATER);
  }

  function drawSmoke() {
    for (var i = 0; i < smoke.length; i++) {
      var sm = smoke[i], a = (sm.life / sm.max) * 0.10;
      var g = ctx.createRadialGradient(sm.x, sm.y, 0, sm.x, sm.y, sm.r);
      g.addColorStop(0, "rgba(120,120,140," + a.toFixed(3) + ")");
      g.addColorStop(1, "rgba(120,120,140,0)");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sm.x, sm.y, sm.r, 0, 6.28); ctx.fill();
    }
  }

  function paintSparks(c) {
    // draws all sparks/rockets onto the (additive) target context c
    var i, s;
    // burst flashes first (a bright bloom of light at each break)
    for (i = 0; i < flashes.length; i++) {
      var f = flashes[i], fk = f.life / f.max, fr = (1 - fk) * Math.min(W, H) * 0.09 + 8, fa = fk * 0.85;
      var fg = c.createRadialGradient(f.x, f.y, 0, f.x, f.y, fr + 26);
      fg.addColorStop(0, "rgba(255,255,255," + fa.toFixed(3) + ")");
      fg.addColorStop(0.3, "hsla(" + f.hue + ",100%,82%," + (fa * 0.7).toFixed(3) + ")");
      fg.addColorStop(1, "hsla(" + f.hue + ",100%,60%,0)");
      c.fillStyle = fg; c.beginPath(); c.arc(f.x, f.y, fr + 26, 0, 6.28); c.fill();
    }
    for (i = 0; i < sparks.length; i++) {
      s = sparks[i];
      var k = s.life / s.max;
      var lum = 46 + 20 * k;                 // keep saturated colour, not blown white
      var a = Math.min(1, k * 1.5) * s.bright;
      // twinkle/strobe stars wink on and off; crackle flickers white near the end
      if (s.twinkle && Math.random() < 0.45) continue;
      var size = (s.trail ? 1.7 : 2.2) * (s.big ? 1.7 : 1) * (0.45 + k * 0.85);
      // colour-changing stars drift from their start hue toward hue2 as they burn
      var hue = s.hue2 === s.hue ? s.hue : (s.hue2 + (s.hue - s.hue2) * k);
      var col;
      if (s.crk && Math.random() < 0.5) col = "rgba(255,255,255," + a.toFixed(3) + ")";
      else col = "hsla(" + hue + ",100%," + lum + "%," + a.toFixed(3) + ")";
      var g = c.createRadialGradient(s.x, s.y, 0, s.x, s.y, size * 3.2);
      g.addColorStop(0, col);
      g.addColorStop(0.4, "hsla(" + hue + ",100%," + lum + "%," + (a * 0.5).toFixed(3) + ")");
      g.addColorStop(1, "hsla(" + hue + ",100%,50%,0)");
      c.fillStyle = g;
      c.beginPath(); c.arc(s.x, s.y, size * 3.2, 0, 6.28); c.fill();
      // hot core
      c.fillStyle = "rgba(255,255,255," + (a * 0.7).toFixed(3) + ")";
      c.beginPath(); c.arc(s.x, s.y, size * 0.8, 0, 6.28); c.fill();
    }
    for (i = 0; i < rockets.length; i++) {
      var r = rockets[i];
      var g2 = c.createRadialGradient(r.x, r.y, 0, r.x, r.y, 7);
      g2.addColorStop(0, "rgba(255,240,200,0.95)");
      g2.addColorStop(1, "rgba(255,180,90,0)");
      c.fillStyle = g2; c.beginPath(); c.arc(r.x, r.y, 7, 0, 6.28); c.fill();
    }
  }

  // ---- audio: synthesized launch thump / boom / crackle ------------------
  var actx = null, master = null, verb = null, verbSend = null, outGain = null, muted = false, rainGain;
  function unlock() {
    if (actx) { if (actx.state === "suspended") actx.resume(); return; }
    try {
      actx = new (window.AudioContext || window.webkitAudioContext)();
      var b = actx.createBuffer(1, 1, 22050); var s = actx.createBufferSource(); s.buffer = b; s.connect(actx.destination); s.start(0);
      // single output gain so the mute toggle silences BOTH the dry + reverb paths at once
      outGain = actx.createGain(); outGain.gain.value = muted ? 0 : 1; outGain.connect(actx.destination);
      master = actx.createGain(); master.gain.value = 0.9; master.connect(outGain);
      // a big, dark convolver reverb so the WHOLE scene rolls + echoes across the open
      // night sky — fed by a global wet send off the master bus (everything reverbs).
      verb = actx.createConvolver(); verb.buffer = makeIR(3.2, 2.6);
      var vlp = actx.createBiquadFilter(); vlp.type = "lowpass"; vlp.frequency.value = 1400;
      var vhp = actx.createBiquadFilter(); vhp.type = "highpass"; vhp.frequency.value = 90;
      var vg = actx.createGain(); vg.gain.value = 0.5;
      // wet path joins the dry at outGain (NOT back to master — that would loop)
      verb.connect(vlp); vlp.connect(vhp); vhp.connect(vg); vg.connect(outGain);
      // global send: tap the master bus so every sound gets the open-air tail
      verbSend = actx.createGain(); verbSend.gain.value = 0.32;
      master.connect(verbSend); verbSend.connect(verb);
    } catch (e) { actx = null; }
  }
  function noiseBurst(dur) {
    var len = Math.floor(actx.sampleRate * dur), buf = actx.createBuffer(1, len, actx.sampleRate), d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    var src = actx.createBufferSource(); src.buffer = buf; return src;
  }
  // stereo noise impulse response with an exponential decay tail (cheap reverb)
  function makeIR(dur, decay) {
    var rate = actx.sampleRate, len = Math.floor(rate * dur), ir = actx.createBuffer(2, len, rate);
    for (var ch = 0; ch < 2; ch++) {
      var d = ir.getChannelData(ch);
      for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return ir;
  }
  // soft-clip (tanh) saturation curve — real blasts are distorted, not clean
  var boomCurve = null;
  function getBoomCurve() {
    if (boomCurve) return boomCurve;
    var n = 2048; boomCurve = new Float32Array(n);
    for (var i = 0; i < n; i++) { var x = i / (n - 1) * 2 - 1; boomCurve[i] = Math.tanh(x * 2.2); }
    return boomCurve;
  }
  // a firework "screamer" rising as the shell climbs — a clean PITCHED tone (not hiss)
  // with the characteristic fast warble that deepens as it goes up
  function whistle() {
    if (!actx) return;
    var t = actx.currentTime, dur = 0.95, f0 = 2600, f1 = 5400;
    // main reedy voice — a rising triangle carries the recognizable "wheeee"
    var o = actx.createOscillator(); o.type = "triangle";
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    // a softer voice a fifth up adds the hollow "scream" without harshness
    var o2 = actx.createOscillator(); o2.type = "sine";
    o2.frequency.setValueAtTime(f0 * 1.5, t); o2.frequency.exponentialRampToValueAtTime(f1 * 1.5, t + dur);
    var o2g = actx.createGain(); o2g.gain.value = 0.18;
    // vibrato LFO — a fast warble that widens as the shell climbs (the firework wobble)
    var lfo = actx.createOscillator(); lfo.type = "sine";
    lfo.frequency.setValueAtTime(6, t); lfo.frequency.linearRampToValueAtTime(11, t + dur);
    var lg = actx.createGain(); lg.gain.setValueAtTime(18, t); lg.gain.linearRampToValueAtTime(110, t + dur);
    lfo.connect(lg); lg.connect(o.frequency); lg.connect(o2.frequency);
    // a broad resonant formant tracking the pitch so it reads as a whistle, not a synth lead
    var bp = actx.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = 2.5;
    bp.frequency.setValueAtTime(f0, t); bp.frequency.exponentialRampToValueAtTime(f1, t + dur);
    var g = actx.createGain(); g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.022, t + 0.12);
    g.gain.setValueAtTime(0.022, t + dur * 0.62); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(bp); o2.connect(o2g); o2g.connect(bp); bp.connect(g); g.connect(master);
    // just a whisper of breath under the tone
    var src = noiseBurst(dur);
    var nbp = actx.createBiquadFilter(); nbp.type = "bandpass"; nbp.Q.value = 9;
    nbp.frequency.setValueAtTime(f0, t); nbp.frequency.exponentialRampToValueAtTime(f1, t + dur);
    var ng = actx.createGain(); ng.gain.setValueAtTime(0.0001, t);
    ng.gain.exponentialRampToValueAtTime(0.018, t + 0.12); ng.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(nbp); nbp.connect(ng); ng.connect(master);
    o.start(t); o.stop(t + dur + 0.05); o2.start(t); o2.stop(t + dur + 0.05);
    lfo.start(t); lfo.stop(t + dur + 0.05); src.start(t); src.stop(t + dur);
  }
  // the mortar firing the shell — a faint, low hollow "thoomp" at launch only
  // (no rising whistle, and silence as it climbs until the burst)
  function launchThump() {
    if (!actx) return;
    var t = actx.currentTime;
    // low hollow thump
    var o = actx.createOscillator(); o.type = "sine";
    o.frequency.setValueAtTime(rand(95, 130), t); o.frequency.exponentialRampToValueAtTime(rand(44, 58), t + 0.12);
    var og = actx.createGain(); og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.16, t + 0.006); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    o.connect(og); og.connect(master); if (verb) og.connect(verb); o.start(t); o.stop(t + 0.2);
    // a short low "pop" of escaping gas
    var src = noiseBurst(0.12);
    var lp = actx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 850;
    var g = actx.createGain(); g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.07, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    src.connect(lp); lp.connect(g); g.connect(master); src.start(t); src.stop(t + 0.12);
  }
  function boom() {
    if (!actx) return;
    var t = actx.currentTime;
    var size = 0.85 + Math.random() * 0.4;

    // soft-clip saturation bus — gives the blast its gritty, compressed punch
    var sh = actx.createWaveShaper(); sh.curve = getBoomCurve(); sh.oversample = "2x";
    var shg = actx.createGain(); shg.gain.value = 0.8;
    sh.connect(shg); shg.connect(master); shg.connect(verb);

    // 1) the CRACK — a very short, full-spectrum snap (the report of the blast)
    var c = noiseBurst(0.09);
    var chp = actx.createBiquadFilter(); chp.type = "highpass"; chp.frequency.value = 280;
    var cg = actx.createGain(); cg.gain.setValueAtTime(0.0001, t);
    cg.gain.exponentialRampToValueAtTime(0.7 * size, t + 0.002); cg.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    c.connect(chp); chp.connect(cg); cg.connect(sh); c.start(t); c.stop(t + 0.09);

    // 2) the BODY — ALL noise (no pure tone), heavy low end, fast punchy decay
    var bsrc = noiseBurst(0.45);
    var blp = actx.createBiquadFilter(); blp.type = "lowpass"; blp.Q.value = 0.7;
    blp.frequency.setValueAtTime(420, t); blp.frequency.exponentialRampToValueAtTime(68, t + 0.32);
    var bg = actx.createGain(); bg.gain.setValueAtTime(0.0001, t);
    bg.gain.exponentialRampToValueAtTime(0.85 * size, t + 0.008); bg.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
    bsrc.connect(blp); blp.connect(bg); bg.connect(sh); bsrc.start(t); bsrc.stop(t + 0.45);
    // deep sub-thump — lowpassed noise (noisy weight, NOT a tonal sine kick)
    var sub = noiseBurst(0.4);
    var slp = actx.createBiquadFilter(); slp.type = "lowpass"; slp.frequency.value = 78; slp.Q.value = 0.5;
    var sg = actx.createGain(); sg.gain.setValueAtTime(0.0001, t);
    sg.gain.exponentialRampToValueAtTime(0.7 * size, t + 0.012); sg.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    sub.connect(slp); slp.connect(sg); sg.connect(master); sub.start(t); sub.stop(t + 0.4);

    // 3) the ROLLING RUMBLE — long lowpassed noise, amplitude-rolled = the echo
    var rsrc = noiseBurst(2.1);
    var rlp = actx.createBiquadFilter(); rlp.type = "lowpass";
    rlp.frequency.setValueAtTime(240, t); rlp.frequency.exponentialRampToValueAtTime(85, t + 1.8);
    var rg = actx.createGain(); rg.gain.setValueAtTime(0.0001, t);
    rg.gain.exponentialRampToValueAtTime(0.22 * size, t + 0.06); rg.gain.exponentialRampToValueAtTime(0.0001, t + 2.0);
    rsrc.connect(rlp); rlp.connect(rg); rg.connect(master); rg.connect(verb); rsrc.start(t); rsrc.stop(t + 2.1);
    // irregular rolling: two slow detuned LFOs wobble the rumble's amplitude
    var l1 = actx.createOscillator(); l1.type = "sine"; l1.frequency.value = 3.0 + Math.random();
    var l1g = actx.createGain(); l1g.gain.value = 0.1 * size; l1.connect(l1g); l1g.connect(rg.gain); l1.start(t); l1.stop(t + 2.1);
    var l2 = actx.createOscillator(); l2.type = "sine"; l2.frequency.value = 1.2 + Math.random() * 0.6;
    var l2g = actx.createGain(); l2g.gain.value = 0.06 * size; l2.connect(l2g); l2g.connect(rg.gain); l2.start(t); l2.stop(t + 2.1);
  }
  function crackle(dur, delay) {
    if (!actx) return;
    var t0 = actx.currentTime + (delay || 0), n = 26;
    for (var i = 0; i < n; i++) {
      var t = t0 + Math.random() * dur;
      var src = noiseBurst(0.04);
      var bp = actx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 2500 + Math.random() * 3500; bp.Q.value = 6;
      var g = actx.createGain(); g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.05 + Math.random() * 0.06, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
      src.connect(bp); bp.connect(g); g.connect(master); src.start(t); src.stop(t + 0.06);
    }
  }

  // ---- interaction --------------------------------------------------------
  function pointer(px, py) { launch(px, py); if (hintEl) hintEl.classList.add("is-hidden"); }
  canvas.addEventListener("mousedown", function (e) { pointer(e.clientX, e.clientY); });
  canvas.addEventListener("touchstart", function (e) {
    e.preventDefault();
    for (var i = 0; i < e.touches.length; i++) pointer(e.touches[i].clientX, e.touches[i].clientY);
  }, { passive: false });

  // sound on/off toggle
  var soundBtn = document.getElementById("soundBtn");
  if (soundBtn) {
    soundBtn.addEventListener("click", function () {
      muted = !muted;
      unlock(); // keep the audio context alive within this user gesture
      if (outGain) outGain.gain.setTargetAtTime(muted ? 0 : 1, actx.currentTime, 0.02);
      soundBtn.textContent = muted ? "Sound: off" : "Sound: on";
      soundBtn.setAttribute("aria-pressed", muted ? "true" : "false");
    });
  }

  // gentle self-running show so the sky is alive on arrival
  var autoT = 1.2;
  function auto(dt) {
    autoT -= dt;
    if (autoT <= 0) { launch(rand(W * 0.15, W * 0.85), rand(H * 0.16, H * 0.4)); autoT = rand(2.4, 4.6); }
  }

  // ---- loop ---------------------------------------------------------------
  var lastTs = null, nowish = 0;
  function frame(ts) {
    var dt = lastTs !== null ? Math.min((ts - lastTs) / 1000, 0.05) : 0.016;
    lastTs = ts; nowish += dt;
    auto(dt);
    update(dt);

    // fade the additive trail buffer a little each frame
    tctx.globalCompositeOperation = "destination-out";
    tctx.fillStyle = "rgba(0,0,0,0.18)";
    tctx.fillRect(0, 0, W, H);
    // accumulate fresh sparks (additive)
    tctx.globalCompositeOperation = "lighter";
    paintSparks(tctx);

    // compose
    drawSky();
    drawSmoke();
    // blurry reflection on the water — flipped + blurred, only near-water sparks
    // land inside the band (high bursts mirror off-screen below the clip)
    ctx.save();
    ctx.beginPath(); ctx.rect(0, WATER, W, H - WATER); ctx.clip();
    ctx.globalAlpha = 0.4;
    if (ctx.filter !== undefined) ctx.filter = "blur(" + (Math.max(W, H) * 0.007).toFixed(1) + "px)";
    ctx.translate(0, WATER * 2);
    ctx.scale(1, -1);
    ctx.drawImage(tcv, 0, 0, W, H);
    ctx.restore();
    // fade the reflection into the dark depths
    var rf = ctx.createLinearGradient(0, WATER, 0, H);
    rf.addColorStop(0, "rgba(5,7,16,0)");
    rf.addColorStop(1, "rgba(5,7,16,0.8)");
    ctx.fillStyle = rf; ctx.fillRect(0, WATER, W, H - WATER);
    // main trails
    ctx.globalAlpha = 1;
    ctx.drawImage(tcv, 0, 0, W, H);

    requestAnimationFrame(frame);
  }

  resize();
  window.addEventListener("resize", resize);
  requestAnimationFrame(frame);
  setTimeout(function () { if (hintEl) hintEl.classList.add("is-hidden"); }, 8000);
})();
