/* Mancala — the sound of glass beads in a carved walnut board, in the back room of a
   bookshop after closing, with rain on the window.

   House rules, each learned the hard way on an earlier toy:
   - Contacts are MODAL: a short noise burst through parallel resonant bandpasses at
     the object's own modes, opened by a broadband, LOWPASSED tack (that tack is what
     says "two solid things touched"). Each mode gets a sqrt(Q) makeup, or a narrow
     resonator swallows the burst and the voice is inaudible.
   - A bead is not one sound. What it lands ON decides it: an empty cup is a woody
     knock with a glass ring on top; a full one is glass clacking on glass, with
     hardly any wood, and a little chatter as the bead settles among the others. A
     store is a bigger cavity, so the wood in it is deeper and longer.
   - Long tails (the glass tings) are ADDITIVE, each partial a beating doublet.
   - Every wooden hit goes through one shared body, the board on its table: that is
     what makes the set sound like one object instead of a pile of samples.
   - Velocity is applied ONCE, at the top of a voice (a layer that multiplies it again
     scales as v squared and vanishes on soft hits).
   - Drops are throttled: a sped-up sowing or a big pour asks for dozens of beads a
     second, and stacking them all would clip. Close hits are merged and thinned.
   - Noise bursts come from a POOL per length, every rendered buffer is scrubbed of
     NaN, the compressor is glue and the brickwall after it is the ceiling. */
(function () {
  "use strict";

  var ac = null, busIn = null, dryIn = null, outGain = null, roomIn = null, on = true;
  var bed = null;

  function init() {
    if (ac) { if (ac.state === "suspended") ac.resume(); return; }
    try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
    var b = ac.createBuffer(1, 1, ac.sampleRate);               /* iOS unlock */
    var s = ac.createBufferSource(); s.buffer = b; s.connect(ac.destination); s.start(0);

    busIn = ac.createGain();
    /* The board: a slab of walnut on a low table. Its mass thumps low, the carved
       top rings a little in the low mids. */
    var mass = ac.createBiquadFilter(); mass.type = "peaking"; mass.frequency.value = 214; mass.Q.value = 1.2; mass.gain.value = 3.5;
    var top = ac.createBiquadFilter(); top.type = "peaking"; top.frequency.value = 540; top.Q.value = 1.4; top.gain.value = 2;
    var shelf = ac.createBiquadFilter(); shelf.type = "highshelf"; shelf.frequency.value = 9000; shelf.gain.value = -2.5;
    var comp = ac.createDynamicsCompressor();
    comp.threshold.value = -10; comp.ratio.value = 3; comp.knee.value = 6; comp.attack.value = 0.003; comp.release.value = 0.16;
    var wall = ac.createDynamicsCompressor();
    wall.threshold.value = -1.5; wall.ratio.value = 20; wall.knee.value = 0; wall.attack.value = 0.001; wall.release.value = 0.05;
    outGain = ac.createGain(); outGain.gain.value = on ? 0.9 : 0;

    busIn.connect(mass); mass.connect(top); top.connect(shelf); shelf.connect(comp);
    comp.connect(wall); wall.connect(outGain); outGain.connect(ac.destination);
    /* glass that rings in the air (the tings) skips the board */
    dryIn = ac.createGain(); dryIn.connect(comp);

    /* A small room lined with books: books eat the highs and kill flutter, so the
       tail is short, soft and dark. */
    roomIn = ac.createGain();
    var conv = ac.createConvolver(); conv.buffer = roomIR(1.25);
    var wet = ac.createGain(); wet.gain.value = 0.24;
    shelf.connect(conv); dryIn.connect(conv); roomIn.connect(conv); conv.connect(wet); wet.connect(comp);
  }

  function clean(d) { for (var i = 0; i < d.length; i++) if (!isFinite(d[i])) d[i] = 0; }

  function roomIR(sec) {
    var n = Math.floor(ac.sampleRate * sec), buf = ac.createBuffer(2, n, ac.sampleRate);
    for (var ch = 0; ch < 2; ch++) {
      var d = buf.getChannelData(ch), lo = 0, lo2 = 0;
      for (var i = 0; i < n; i++) {
        var t = i / n, w = Math.random() * 2 - 1;
        lo = lo * 0.55 + w * 0.45;
        lo2 = lo2 * (0.5 + 0.42 * t) + lo * (0.5 - 0.42 * t);          /* darker as it decays */
        var early = i < ac.sampleRate * 0.025 && Math.random() < 0.004 ? (Math.random() - 0.5) * 2.2 : 0;
        d[i] = (lo2 + early) * Math.pow(1 - t, 3.4);
      }
      clean(d);
    }
    return buf;
  }

  var pools = {};
  function burst(ms) {
    var key = Math.round(ms), pool = pools[key];
    if (!pool) {
      pool = pools[key] = [];
      for (var k = 0; k < 8; k++) {
        var n = Math.max(1, Math.floor(ac.sampleRate * ms / 1000));
        var b = ac.createBuffer(1, n, ac.sampleRate), d = b.getChannelData(0);
        for (var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
        clean(d);
        pool.push(b);
      }
    }
    return pool[(Math.random() * pool.length) | 0];
  }

  function panner(pan, dest) {
    dest = dest || busIn;
    if (!ac.createStereoPanner) return dest;
    var p = ac.createStereoPanner(); p.pan.value = Math.max(-0.9, Math.min(0.9, pan || 0)); p.connect(dest);
    return p;
  }

  /* modes: [freq, Q, gain, decaySeconds]; tack: broadband contact noise level;
     tone: a pitch factor (each bead is a slightly different size) */
  function modal(modes, amp, pan, burstMs, when, tack, dest, tone) {
    if (!ac || !on || !(amp > 0)) return;
    var t0 = ac.currentTime + (when || 0);
    var out = panner(pan, dest);
    var src = ac.createBufferSource(); src.buffer = burst(burstMs || 8);
    var detune = (tone || 1) * (0.99 + Math.random() * 0.02);
    for (var i = 0; i < modes.length; i++) {
      var m = modes[i], f = ac.createBiquadFilter(), g = ac.createGain();
      f.type = "bandpass"; f.frequency.value = Math.min(17000, m[0] * detune * (0.995 + Math.random() * 0.01)); f.Q.value = m[1];
      var len = m[3] * (0.85 + Math.random() * 0.3);
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(amp * m[2] * Math.sqrt(m[1]), t0 + 0.001);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + len);
      src.connect(f); f.connect(g); g.connect(out);
    }
    if (tack !== 0) {
      var tk = ac.createBufferSource(); tk.buffer = burst(3);
      var lp = ac.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 9000;
      var bp = ac.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 3200; bp.Q.value = 0.6;
      var tg = ac.createGain();
      tg.gain.setValueAtTime(amp * (tack == null ? 0.45 : tack), t0); tg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.025);
      tk.connect(lp); lp.connect(bp); bp.connect(tg); tg.connect(out);
      tk.start(t0); tk.stop(t0 + 0.08);
    }
    src.start(t0); src.stop(t0 + 0.6);
  }

  /* ---------- the voices ---------- */
  /* A flat glass gem about the size of a thumbnail: small, dense, so it rings high,
     inharmonic and short. */
  var GLASS = [[3240, 26, 0.55, 0.05], [4890, 32, 0.48, 0.04], [7110, 38, 0.32, 0.03], [9560, 42, 0.18, 0.02]];
  /* Glass striking glass among other beads: brighter and harder, almost all click. */
  var CLACK = [[2720, 18, 0.5, 0.032], [4230, 24, 0.62, 0.028], [6050, 30, 0.42, 0.02], [8400, 36, 0.22, 0.014]];
  /* The carved cup: a shallow bowl cut into the walnut. */
  var CUP = [[252, 5, 0.9, 0.085], [618, 8, 0.6, 0.06], [1390, 11, 0.38, 0.04], [2740, 14, 0.2, 0.024]];
  /* The store: a long, deeper trough, so a bigger, lower cavity. */
  var STORE = [[168, 5, 1.0, 0.13], [412, 7, 0.68, 0.09], [955, 10, 0.4, 0.055], [2140, 13, 0.2, 0.03]];
  var KNOCK = [[182, 5, 1.0, 0.12], [362, 6, 0.5, 0.08], [760, 8, 0.24, 0.05]];

  /* Throttle: one drop per THROTTLE seconds at full strength; a crowd of them is
     merged and thinned so a sped-up sowing or a big pour never stacks into a clip. */
  var lastDrop = -1, recent = [];
  var THROTTLE = 0.014;
  function crowd(t) {
    while (recent.length && recent[0] < t - 0.12) recent.shift();
    recent.push(t);
    return recent.length;
  }

  /* A bead lands. o: { fill 0..1 (how full the pit already is), store, v 0..1, pan, tone } */
  function drop(o) {
    if (!ac || !on) return;
    var t = ac.currentTime;
    if (t - lastDrop < THROTTLE) return;
    lastDrop = t;
    var n = crowd(t), thin = 1 / Math.sqrt(n);
    var v = Math.max(0.15, Math.min(1, o.v == null ? 0.8 : o.v)) * thin;
    var fill = Math.max(0, Math.min(1, o.fill || 0)), pan = o.pan || 0, tone = o.tone || 1;
    var wood = o.store ? 1 - 0.55 * fill : 1 - 0.75 * fill;
    /* the wood under it */
    modal(o.store ? STORE : CUP, (o.store ? 1.3 : 1.08) * v * wood, pan, o.store ? 12 : 10, 0, 0.3, null, 1);
    /* the bead itself rings */
    modal(GLASS, 0.44 * v * (0.75 + 0.35 * fill), pan, 4, 0.0015, 0.5, null, tone);
    /* and in a crowded pit it clacks on the others, then chatters as it settles */
    if (fill > 0.05) {
      modal(CLACK, 0.4 * v * fill, pan, 3, 0.002, 0.6, null, tone * (0.97 + Math.random() * 0.06));
      var chat = fill > 0.55 ? 2 : fill > 0.25 ? 1 : 0;
      for (var k = 0; k < chat; k++) {
        modal(CLACK, 0.16 * v * fill * (1 - k * 0.3), pan + (Math.random() - 0.5) * 0.1, 2, 0.018 + k * 0.022 + Math.random() * 0.015, 0.5, null, tone * (1.05 + Math.random() * 0.15));
      }
    }
  }

  /* A handful lifted out of a pit: the beads rattle against each other in the hand,
     and fingertips brush the wood. */
  function scoop(n, pan) {
    if (!ac || !on || !n) return;
    var count = Math.min(9, 2 + Math.round(n * 0.6)), t = 0;
    for (var i = 0; i < count; i++) {
      modal(CLACK, (0.24 + Math.random() * 0.18) * (i === 0 ? 1 : 0.8), pan + (Math.random() - 0.5) * 0.12, 2, t, 0.45, null, 0.95 + Math.random() * 0.2);
      t += 0.012 + Math.random() * 0.026;
    }
    brush(0.08, pan, 0.05);
  }

  var brushBuf = null;
  function brush(sec, pan, amp) {
    if (!ac || !on) return;
    if (!brushBuf) {
      var n = Math.floor(ac.sampleRate * 0.6);
      brushBuf = ac.createBuffer(1, n, ac.sampleRate);
      var d = brushBuf.getChannelData(0), grain = 0;
      for (var i = 0; i < n; i++) {
        if (Math.random() < 0.006) grain = 0.5 + Math.random() * 0.5;
        grain *= 0.999;
        d[i] = (Math.random() * 2 - 1) * (0.3 + grain);
      }
      clean(d);
    }
    var t0 = ac.currentTime, len = Math.max(0.05, sec);
    var src = ac.createBufferSource(); src.buffer = brushBuf;
    var bp = ac.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 1900; bp.Q.value = 0.8;
    var lp = ac.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 5200;
    var g = ac.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(amp, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + len);
    src.connect(bp); bp.connect(lp); lp.connect(g); g.connect(panner(pan));
    src.start(t0, Math.random() * 0.3); src.stop(t0 + len + 0.05);
  }

  /* A pour into a store: the landings themselves come from drop(); under them, a
     rattle that is dense at first and thins out as the heap settles. */
  function pour(n, sec, pan) {
    if (!ac || !on || !n) return;
    var count = Math.min(26, 4 + n * 2), t = 0.02, span = Math.max(0.25, sec || 0.5);
    for (var i = 0; i < count; i++) {
      var k = i / count;
      modal(CLACK, 0.14 * (1 - k * 0.6), pan + (Math.random() - 0.5) * 0.2, 2, t, 0.4, null, 0.92 + Math.random() * 0.25);
      t += span / count * (0.4 + 1.6 * k) * (0.6 + Math.random() * 0.8);
    }
    modal(STORE, 0.34, pan, 14, 0, 0.2, null, 1);
  }

  /* ---------- glass, ringing in the air ----------
     A bead tapped against a glass: thin, hard, long, every partial a doublet that
     beats, which is the shimmer real glass has. */
  function glass(f0, amp, dur, when, pan) {
    if (!ac || !on) return;
    var t0 = ac.currentTime + (when || 0);
    var dest = panner(pan || 0, dryIn);
    var parts = [[1, 1, 1], [2.32, 0.42, 0.6], [4.25, 0.2, 0.35], [6.63, 0.08, 0.2]];
    for (var i = 0; i < parts.length; i++) {
      for (var k = 0; k < 2; k++) {
        var o = ac.createOscillator(), g = ac.createGain();
        o.type = "sine";
        o.frequency.value = f0 * parts[i][0] + (k ? 1.2 + i * 0.8 : 0);
        var a = amp * parts[i][1] * (k ? 0.5 : 1);
        g.gain.setValueAtTime(0, t0);
        g.gain.linearRampToValueAtTime(a, t0 + 0.003);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur * parts[i][2]);
        o.connect(g); g.connect(dest);
        o.start(t0); o.stop(t0 + dur + 0.05);
      }
    }
    modal([[f0 * 3.3, 10, 0.5, 0.02], [f0 * 5.1, 12, 0.3, 0.015]], amp * 0.7, pan || 0, 3, when, 0.3, dryIn);
  }

  function select(pan) { modal(GLASS, 0.3, pan, 3, 0, 0.35, null, 1.12); }
  function deny() { modal(KNOCK, 0.48, 0, 16, 0, 0.4); modal(KNOCK, 0.37, 0, 16, 0.11, 0.4); }
  function again(pan) { glass(1568, 0.048, 1.0, 0, pan || 0); glass(2349, 0.028, 0.8, 0.07, pan || 0); }
  function capture(pan) { glass(1976, 0.03, 0.9, 0, pan || 0); glass(2637, 0.026, 0.8, 0.06, pan || 0); }
  function hint() { glass(2093, 0.038, 0.7, 0, 0.2); }
  function win() { glass(1319, 0.085, 1.5, 0, -0.3); glass(1568, 0.08, 1.5, 0.11, 0.1); glass(2093, 0.08, 1.9, 0.22, 0.3); glass(2637, 0.05, 2.2, 0.36, -0.1); }
  function lose() { modal(KNOCK, 0.5, 0, 16, 0, 0.4); glass(784, 0.085, 1.4, 0.14); glass(659, 0.085, 1.6, 0.38); glass(523, 0.085, 2.2, 0.66); }
  function draw() { glass(1047, 0.085, 1.8, 0, -0.2); glass(1568, 0.075, 1.8, 0.12, 0.2); }

  /* ---------- the room ----------
     Rain on the tall window: a soft wash with the street's hiss under it, single
     drops ticking on the glass, now and then a heavier gust. A very low room tone.
     All of it sits far under the game. Events are scheduled ahead in audio time, a
     few seconds at a time. */
  function startBed() {
    if (!ac || bed) return;
    bed = { until: 0, timer: 0 };
    var sr = ac.sampleRate, n = Math.floor(sr * 4), buf = ac.createBuffer(2, n, sr);
    for (var ch = 0; ch < 2; ch++) {
      var d = buf.getChannelData(ch), b0 = 0, b1 = 0, b2 = 0;
      for (var i = 0; i < n; i++) {
        var w = Math.random() * 2 - 1;                     /* pink-ish */
        b0 = 0.99765 * b0 + w * 0.099; b1 = 0.963 * b1 + w * 0.2965; b2 = 0.57 * b2 + w * 1.0526;
        d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
      }
      var f = Math.floor(sr * 0.3);                        /* loop ends cross-faded */
      for (var j = 0; j < f; j++) { var k = j / f; d[n - f + j] = d[n - f + j] * (1 - k) + d[j] * k; }
      clean(d);
    }
    /* the wash on the pane */
    var rain = ac.createBufferSource(); rain.buffer = buf; rain.loop = true;
    var bp = ac.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 2600; bp.Q.value = 0.45;
    var lp = ac.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 6500;
    var rg = ac.createGain(); rg.gain.value = 0.056;
    rain.connect(bp); bp.connect(lp); lp.connect(rg); rg.connect(outGain);
    /* the street outside, through the glass */
    var street = ac.createBufferSource(); street.buffer = buf; street.loop = true;
    var slp = ac.createBiquadFilter(); slp.type = "lowpass"; slp.frequency.value = 700;
    var sg = ac.createGain(); sg.gain.value = 0.06;
    street.connect(slp); slp.connect(sg); sg.connect(outGain);
    /* the room itself, felt more than heard */
    var hum = ac.createOscillator(); hum.type = "sine"; hum.frequency.value = 58;
    var hg = ac.createGain(); hg.gain.value = 0.004;
    hum.connect(hg); hg.connect(outGain);
    var t0 = ac.currentTime;
    rain.start(t0); street.start(t0, 1.7); hum.start(t0);
    bed.rg = rg; bed.until = t0;
    pump();
    bed.timer = setInterval(pump, 1500);
  }

  function pump() {
    if (!bed || !ac) return;
    var now = ac.currentTime, to = now + 3;
    if (bed.until < now) bed.until = now;
    while (bed.until < to) {
      var t = bed.until;
      if (on) {
        /* a drop on the glass: high, tiny, panned toward the window */
        var f = 2600 + Math.random() * 3400;
        modal([[f, 22, 0.5, 0.014], [f * 1.62, 26, 0.3, 0.01]], 0.012 + Math.random() * 0.02, 0.35 + Math.random() * 0.5, 2, t - now, 0.5, dryIn);
        if (Math.random() < 0.03) {
          /* a gust leans the rain against the pane */
          var g = bed.rg.gain;
          g.setTargetAtTime(0.09, t, 0.6); g.setTargetAtTime(0.056, t + 2.2, 1.2);
        }
      }
      bed.until += 0.05 + Math.random() * (Math.random() < 0.2 ? 0.6 : 0.22);
    }
  }

  function setOn(v) {
    on = !!v;
    if (outGain) outGain.gain.setTargetAtTime(on ? 0.9 : 0, ac.currentTime, 0.03);
  }

  window.MancalaAudio = {
    init: init, setOn: setOn, startBed: startBed,
    drop: drop, scoop: scoop, pour: pour, select: select, deny: deny,
    again: again, capture: capture, hint: hint, win: win, lose: lose, draw: draw
  };
})();
