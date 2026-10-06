/* Backgammon — the sound of a game at a café table by the sea: hardwood checkers on
   an inlaid board that is really a hollow wooden case, bone dice shaken in a
   leather cup and thrown across the wood, tea glasses, and the water below.

   House rules, each learned the hard way on an earlier toy:
   - Contacts are MODAL: a short noise burst through parallel resonant bandpasses at
     the object's own modes, opened by a broadband, LOWPASSED tack (that tack is what
     says "two solid things touched"). Each mode gets a sqrt(Q) makeup, or a narrow
     resonator swallows the burst and the voice is inaudible.
   - Long tails (the tea glass) are ADDITIVE, each partial a beating doublet.
   - Every wooden hit goes through one shared body, here the board's hollow case:
     that is what makes the set sound like one object instead of a pile of samples.
   - Noise bursts come from a POOL per length; one cached burst made every hit
     identical and swung a session's level by a fifth.
   - The compressor is glue; the brickwall after it is the ceiling.
   - Every rendered buffer is scrubbed of NaN: one bad sample in a shared compressor
     silences everything until reload. */
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
    /* The case: a shallow hollow box of walnut. Its air cavity and panel are most of
       what makes a light click of wood sound like it landed on something. */
    var cav = ac.createBiquadFilter(); cav.type = "peaking"; cav.frequency.value = 205; cav.Q.value = 1.3; cav.gain.value = 4.5;
    var panel = ac.createBiquadFilter(); panel.type = "peaking"; panel.frequency.value = 520; panel.Q.value = 1.5; panel.gain.value = 2.4;
    var shelf = ac.createBiquadFilter(); shelf.type = "highshelf"; shelf.frequency.value = 7500; shelf.gain.value = -3;
    var comp = ac.createDynamicsCompressor();
    comp.threshold.value = -9; comp.ratio.value = 3; comp.knee.value = 6; comp.attack.value = 0.003; comp.release.value = 0.15;
    var wall = ac.createDynamicsCompressor();
    wall.threshold.value = -1.5; wall.ratio.value = 20; wall.knee.value = 0; wall.attack.value = 0.001; wall.release.value = 0.05;
    outGain = ac.createGain(); outGain.gain.value = on ? 0.9 : 0;

    busIn.connect(cav); cav.connect(panel); panel.connect(shelf); shelf.connect(comp);
    comp.connect(wall); wall.connect(outGain); outGain.connect(ac.destination);
    /* things that are not wood (glass, the sea) skip the case */
    dryIn = ac.createGain(); dryIn.connect(comp);

    /* An open terrace: no walls to speak of, so a short, airy space with the
       treble dying first, not a hall. */
    roomIn = ac.createGain();
    var conv = ac.createConvolver(); conv.buffer = roomIR(1.4);
    var wet = ac.createGain(); wet.gain.value = 0.2;
    shelf.connect(conv); roomIn.connect(conv); dryIn.connect(conv); conv.connect(wet); wet.connect(comp);
  }

  function clean(d) { for (var i = 0; i < d.length; i++) if (!isFinite(d[i])) d[i] = 0; }

  function roomIR(sec) {
    var n = Math.floor(ac.sampleRate * sec), buf = ac.createBuffer(2, n, ac.sampleRate);
    for (var ch = 0; ch < 2; ch++) {
      var d = buf.getChannelData(ch), lo = 0, lo2 = 0;
      for (var i = 0; i < n; i++) {
        var t = i / n, w = Math.random() * 2 - 1;
        lo = lo * 0.5 + w * 0.5;
        lo2 = lo2 * (0.45 + 0.5 * t) + lo * (0.55 - 0.5 * t);
        var early = i < ac.sampleRate * 0.045 && Math.random() < 0.003 ? (Math.random() - 0.5) * 2.5 : 0;
        d[i] = (lo2 + early) * Math.pow(1 - t, 3.2);
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

  /* modes: [freq, Q, gain, decaySeconds]; tack: how much broadband contact noise */
  function modal(modes, amp, pan, burstMs, when, tack, dest) {
    if (!ac || !on || !(amp > 0)) return;
    var t0 = ac.currentTime + (when || 0);
    var out = panner(pan, dest);
    var src = ac.createBufferSource(); src.buffer = burst(burstMs || 10);
    var detune = 0.985 + Math.random() * 0.03;
    for (var i = 0; i < modes.length; i++) {
      var m = modes[i], f = ac.createBiquadFilter(), g = ac.createGain();
      f.type = "bandpass"; f.frequency.value = m[0] * detune * (0.995 + Math.random() * 0.01); f.Q.value = m[1];
      var len = m[3] * (0.85 + Math.random() * 0.3);
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(amp * m[2] * Math.sqrt(m[1]), t0 + 0.001);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + len);
      src.connect(f); f.connect(g); g.connect(out);
    }
    var tk = ac.createBufferSource(); tk.buffer = burst(4);
    var lp = ac.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 9000;
    var bp = ac.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 2900; bp.Q.value = 0.6;
    var tg = ac.createGain();
    tg.gain.setValueAtTime(amp * (tack == null ? 0.45 : tack), t0); tg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.03);
    tk.connect(lp); lp.connect(bp); bp.connect(tg); tg.connect(out);
    src.start(t0); tk.start(t0); src.stop(t0 + 0.8); tk.stop(t0 + 0.1);
  }

  /* A turned hardwood checker set down on the inlaid field: the case thumps low,
     the disc rings short and woody. */
  var PLACE = [[236, 5, 0.9, 0.11], [574, 8, 0.66, 0.07], [1330, 11, 0.44, 0.045], [2620, 14, 0.26, 0.03], [4180, 16, 0.12, 0.018]];
  /* Checker against checker, edge to edge: no board in it, so higher and tighter. */
  var CLACK = [[1080, 9, 0.4, 0.04], [2240, 12, 0.85, 0.045], [3710, 15, 0.42, 0.03], [5620, 18, 0.18, 0.018]];
  /* A checker dropped into the tray at the end of the case: a deeper, boxier knock. */
  var TRAY = [[168, 5, 1.0, 0.14], [392, 7, 0.62, 0.09], [866, 9, 0.36, 0.06], [2050, 12, 0.2, 0.03]];
  /* The doubling cube: a solid block of wood, bigger than a checker. */
  var CUBE = [[298, 6, 1.0, 0.1], [702, 9, 0.6, 0.06], [1530, 12, 0.34, 0.04], [3100, 14, 0.14, 0.02]];
  /* A bone die: small, dense, hard, so its modes sit high and die fast. */
  var DIE = [[2630, 12, 0.7, 0.03], [4120, 15, 0.55, 0.022], [6310, 18, 0.3, 0.015]];
  var KNOCK = [[178, 5, 1.0, 0.12], [356, 6, 0.5, 0.08], [742, 8, 0.24, 0.05]];

  function place(v, pan) { modal(PLACE, 0.95 * (v || 1), pan, 12); }
  function clack(v, pan, when) { modal(CLACK, 0.5 * (v || 1), pan, 6, when, 0.55); }
  function select(pan) { modal([[2380, 9, 0.5, 0.02], [1180, 7, 0.32, 0.025]], 0.36, pan, 5); }
  function deny() { modal(KNOCK, 0.62, 0, 16); modal(KNOCK, 0.48, 0, 16, 0.11); }
  function tray(v, pan) {
    modal(TRAY, 0.9 * (v || 1), pan, 14);
    modal(CLACK, 0.2 * (v || 1), pan, 5, 0.035 + Math.random() * 0.02, 0.4);   /* it settles against the others */
  }
  function cube(v, pan) { modal(CUBE, 0.8 * (v || 1), pan, 14); }
  /* a hit: the striker's edge cracks into the blot, which then skids to the bar */
  function hit(pan) {
    modal(CLACK, 0.62, pan, 7, 0, 0.75);
    modal(PLACE, 0.42, pan, 10, 0.012);
  }

  /* Wood sliding on wood: a soft, grainy hiss whose grain comes from the buffer
     itself, so it never sounds like a filter sweep. */
  var scrapeBuf = null;
  function slide(sec, pan) {
    if (!ac || !on) return;
    if (!scrapeBuf) {
      var n = Math.floor(ac.sampleRate * 1.2);
      scrapeBuf = ac.createBuffer(1, n, ac.sampleRate);
      var d = scrapeBuf.getChannelData(0), grain = 0;
      for (var i = 0; i < n; i++) {
        if (Math.random() < 0.004) grain = 0.4 + Math.random() * 0.6;
        grain *= 0.9995;
        d[i] = (Math.random() * 2 - 1) * (0.35 + grain);
      }
      clean(d);
    }
    var t0 = ac.currentTime, len = Math.max(0.12, sec);
    var src = ac.createBufferSource(); src.buffer = scrapeBuf;
    var bp = ac.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 1500; bp.Q.value = 0.9;
    var lp = ac.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 3800;
    var g = ac.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.16, t0 + 0.04);
    g.gain.setValueAtTime(0.16, t0 + len - 0.05);
    g.gain.linearRampToValueAtTime(0, t0 + len);
    src.connect(bp); bp.connect(lp); lp.connect(g); g.connect(panner(pan));
    src.start(t0, Math.random() * 0.4); src.stop(t0 + len + 0.05);
  }

  /* ---------- dice ----------
     The cup is leather over wood: the dice rattle inside it (bone on bone, bone on
     the cup's wall), muffled by the leather, and the cup itself thumps dully each
     time the hand changes direction. */
  function shake(sec, pan) {
    if (!ac || !on) return;
    var t = 0, n = 0, dur = Math.max(0.3, sec);
    var muff = ac.createBiquadFilter(); muff.type = "lowpass"; muff.frequency.value = 3600; muff.Q.value = 0.5;
    muff.connect(panner(pan));
    while (t < dur && n < 40) {
      var phase = (t / dur) * 3 % 1;                    /* three strokes of the hand */
      var hard = phase < 0.18;                           /* the turnaround throws the dice at the wall */
      modal(DIE, (hard ? 0.5 : 0.3) * (0.7 + Math.random() * 0.5), pan, 3, t, 0.5, muff);
      if (hard && Math.random() < 0.5) modal([[240, 4, 1, 0.05], [610, 6, 0.4, 0.03]], 0.32, pan, 8, t + 0.004, 0.2, muff);
      t += hard ? 0.018 + Math.random() * 0.025 : 0.035 + Math.random() * 0.05;
      n++;
    }
  }
  /* A die landing on, or skittering across, the wood: v is the impact speed 0..1. */
  function dieHit(v, pan) {
    v = Math.max(0.05, Math.min(1, v || 0.5));
    modal(DIE, 0.62 * v, pan, 3, 0, 0.6);
    modal(PLACE, 0.42 * v * v, pan, 6, 0.001, 0.2);     /* the case under it */
  }

  /* ---------- glass ----------
     A tea glass tapped with a spoon: thin, hard, long, and every partial a doublet
     that beats, which is the shimmer a real glass has. */
  function glass(f0, amp, dur, when, pan) {
    if (!ac || !on) return;
    var t0 = ac.currentTime + (when || 0);
    var dest = panner(pan || 0, dryIn);
    var parts = [[1, 1, 1], [2.32, 0.5, 0.6], [4.25, 0.24, 0.35], [6.63, 0.1, 0.2]];
    for (var i = 0; i < parts.length; i++) {
      for (var k = 0; k < 2; k++) {
        var o = ac.createOscillator(), g = ac.createGain();
        o.type = "sine";
        o.frequency.value = f0 * parts[i][0] + (k ? 1.3 + i * 0.9 : 0);
        var a = amp * parts[i][1] * (k ? 0.5 : 1);
        g.gain.setValueAtTime(0, t0);
        g.gain.linearRampToValueAtTime(a, t0 + 0.003);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur * parts[i][2]);
        o.connect(g); g.connect(dest);
        o.start(t0); o.stop(t0 + dur + 0.05);
      }
    }
    modal([[f0 * 3.3, 10, 0.5, 0.02], [f0 * 5.1, 12, 0.3, 0.015]], amp * 0.7, pan || 0, 3, when, 0.3, dryIn);   /* the spoon */
  }

  function hint() { glass(2093, 0.05, 0.7, 0, 0.2); }
  function double() { cube(1.15, -0.2); glass(784, 0.05, 0.9, 0.12, -0.2); }
  function gameWin() { glass(1319, 0.085, 1.6, 0); glass(1661, 0.08, 1.6, 0.12); glass(1976, 0.08, 2, 0.24); }
  function gameLose() { modal(KNOCK, 0.62, 0, 16); glass(988, 0.085, 1.4, 0.16); glass(784, 0.085, 1.8, 0.42); }
  function matchWin() {
    glass(1319, 0.08, 1.8, 0, -0.3); glass(1661, 0.075, 1.8, 0.1, 0.3); glass(1976, 0.075, 2, 0.2, -0.1);
    glass(2637, 0.07, 2.4, 0.34, 0.2);
    /* glasses raised around the table */
    for (var i = 0; i < 4; i++) glass(1700 + Math.random() * 900, 0.04, 1.2, 0.7 + i * 0.09 + Math.random() * 0.05, Math.random() * 1.2 - 0.6);
  }
  function matchLose() { modal(KNOCK, 0.66, 0, 16); glass(784, 0.09, 1.6, 0.18); glass(659, 0.085, 1.8, 0.46); glass(523, 0.085, 2.4, 0.78); }

  /* ---------- the terrace ----------
     Small waves on the rocks below (a brown-noise wash that swells and draws back),
     a breeze, and now and then a spoon on a glass at another table. All of it sits
     far under the game. */
  function startBed() {
    if (!ac || bed) return;
    bed = { timers: [], nodes: [] };
    var n = Math.floor(ac.sampleRate * 4), buf = ac.createBuffer(2, n, ac.sampleRate);
    for (var ch = 0; ch < 2; ch++) {
      var d = buf.getChannelData(ch), x = 0;
      for (var i = 0; i < n; i++) { x = (x + (Math.random() * 2 - 1) * 0.02) * 0.997; d[i] = x * 3.2; }
      /* fade the loop's ends into each other so it never clicks */
      var f = Math.floor(ac.sampleRate * 0.25);
      for (var j = 0; j < f; j++) { var k = j / f; d[n - f + j] = d[n - f + j] * (1 - k) + d[j] * k; }
      clean(d);
    }
    var src = ac.createBufferSource(); src.buffer = buf; src.loop = true;
    var lp = ac.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 520;
    var swell = ac.createGain(); swell.gain.value = 0.03;
    src.connect(lp); lp.connect(swell); swell.connect(outGain); src.start();
    bed.nodes.push(src);

    (function wave() {
      if (!bed) return;
      var t0 = ac.currentTime, rise = 2.2 + Math.random() * 1.6, fall = 2.8 + Math.random() * 2;
      if (on) {
        lp.frequency.cancelScheduledValues(t0); swell.gain.cancelScheduledValues(t0);
        lp.frequency.setValueAtTime(lp.frequency.value, t0);
        lp.frequency.linearRampToValueAtTime(900 + Math.random() * 500, t0 + rise);
        lp.frequency.linearRampToValueAtTime(420, t0 + rise + fall);
        swell.gain.setValueAtTime(swell.gain.value, t0);
        swell.gain.linearRampToValueAtTime(0.055 + Math.random() * 0.02, t0 + rise);
        swell.gain.linearRampToValueAtTime(0.025, t0 + rise + fall);
        /* the wash on the stones as a wave draws back */
        var hs = ac.createBufferSource(); hs.buffer = buf;
        var hp = ac.createBiquadFilter(); hp.type = "bandpass"; hp.frequency.value = 2400; hp.Q.value = 0.5;
        var hg = ac.createGain();
        hg.gain.setValueAtTime(0, t0 + rise * 0.8);
        hg.gain.linearRampToValueAtTime(0.012, t0 + rise + 0.5);
        hg.gain.linearRampToValueAtTime(0, t0 + rise + fall);
        hs.connect(hp); hp.connect(hg); hg.connect(outGain);
        hs.start(t0 + rise * 0.8, Math.random() * 2); hs.stop(t0 + rise + fall + 0.1);
      }
      bed.timers.push(setTimeout(wave, (rise + fall) * 1000 + Math.random() * 1200));
    })();
    (function clink() {
      if (!bed) return;
      if (on) glass(1500 + Math.random() * 1400, 0.008 + Math.random() * 0.008, 0.9, 0, Math.random() < 0.5 ? -0.7 : 0.7);
      bed.timers.push(setTimeout(clink, 9000 + Math.random() * 16000));
    })();
  }

  function setOn(v) {
    on = !!v;
    if (outGain) outGain.gain.setTargetAtTime(on ? 0.9 : 0, ac.currentTime, 0.03);
  }

  window.BackgammonAudio = {
    init: init, setOn: setOn, startBed: startBed,
    place: place, clack: clack, select: select, deny: deny, tray: tray, cube: cube, hit: hit, slide: slide,
    shake: shake, dieHit: dieHit, hint: hint, double: double,
    gameWin: gameWin, gameLose: gameLose, matchWin: matchWin, matchLose: matchLose
  };
})();
