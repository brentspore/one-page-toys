/* Checkers — the sound of a country store game: turned wooden checkers on a painted
   board that sits on a barrel head, a counter bell, and a stove ticking over.

   House rules, each learned the hard way on an earlier toy:
   - Contacts are MODAL: a short noise burst through parallel resonant bandpasses at
     the object's own modes, opened by a broadband, LOWPASSED tack (that tack is what
     says "two solid things touched"). Each mode gets a sqrt(Q) makeup, or a narrow
     resonator swallows the burst and the voice is inaudible.
   - Long tails (the bell) are ADDITIVE, with each partial a beating doublet.
   - Every hit goes through one shared body, here the barrel: that is what makes
     the set sound like one object instead of a pile of samples.
   - Noise bursts come from a POOL per length; one cached burst made every hit
     identical and swung a session's level by a fifth.
   - The compressor is glue; the brickwall after it is the ceiling. */
(function () {
  "use strict";

  var ac = null, busIn = null, outGain = null, roomIn = null, on = true;
  var bed = null;

  function init() {
    if (ac) { if (ac.state === "suspended") ac.resume(); return; }
    try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
    var b = ac.createBuffer(1, 1, ac.sampleRate);               /* iOS unlock */
    var s = ac.createBufferSource(); s.buffer = b; s.connect(ac.destination); s.start(0);

    busIn = ac.createGain();
    /* The barrel: a big hollow cask under the board. Its cavity and staves are
       most of what makes a light wooden click sound weighty. */
    var cask = ac.createBiquadFilter(); cask.type = "peaking"; cask.frequency.value = 176; cask.Q.value = 1.2; cask.gain.value = 4;
    var stave = ac.createBiquadFilter(); stave.type = "peaking"; stave.frequency.value = 430; stave.Q.value = 1.4; stave.gain.value = 2.2;
    var shelf = ac.createBiquadFilter(); shelf.type = "highshelf"; shelf.frequency.value = 7000; shelf.gain.value = -3.5;
    var comp = ac.createDynamicsCompressor();
    comp.threshold.value = -8; comp.ratio.value = 3; comp.knee.value = 6; comp.attack.value = 0.003; comp.release.value = 0.15;
    var wall = ac.createDynamicsCompressor();
    wall.threshold.value = -1.5; wall.ratio.value = 20; wall.knee.value = 0; wall.attack.value = 0.001; wall.release.value = 0.05;
    outGain = ac.createGain(); outGain.gain.value = on ? 0.9 : 0;

    busIn.connect(cask); cask.connect(stave); stave.connect(shelf); shelf.connect(comp);
    comp.connect(wall); wall.connect(outGain); outGain.connect(ac.destination);

    /* A small wooden room: short, warm, the treble dying first. */
    roomIn = ac.createGain(); roomIn.gain.value = 1;
    var conv = ac.createConvolver(); conv.buffer = roomIR(1.15);
    var wet = ac.createGain(); wet.gain.value = 0.22;
    shelf.connect(conv); roomIn.connect(conv); conv.connect(wet); wet.connect(comp);
  }

  function roomIR(sec) {
    var n = Math.floor(ac.sampleRate * sec), buf = ac.createBuffer(2, n, ac.sampleRate);
    for (var ch = 0; ch < 2; ch++) {
      var d = buf.getChannelData(ch), lo = 0, lo2 = 0;
      for (var i = 0; i < n; i++) {
        var t = i / n, w = Math.random() * 2 - 1;
        lo = lo * 0.6 + w * 0.4;
        lo2 = lo2 * (0.6 + 0.35 * t) + lo * (0.4 - 0.35 * t);      /* darker as it decays */
        var early = i < ac.sampleRate * 0.03 && Math.random() < 0.004 ? (Math.random() - 0.5) * 3 : 0;
        d[i] = (lo2 + early) * Math.pow(1 - t, 2.6);
      }
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

  function panner(pan) {
    if (!ac.createStereoPanner) return busIn;
    var p = ac.createStereoPanner(); p.pan.value = Math.max(-0.9, Math.min(0.9, pan || 0)); p.connect(busIn);
    return p;
  }

  /* modes: [freq, Q, gain, decaySeconds] */
  function modal(modes, amp, pan, burstMs, when) {
    if (!ac || !on) return;
    var t0 = ac.currentTime + (when || 0);
    var dest = panner(pan);
    var src = ac.createBufferSource(); src.buffer = burst(burstMs || 12);
    var detune = 0.985 + Math.random() * 0.03;
    for (var i = 0; i < modes.length; i++) {
      var m = modes[i], f = ac.createBiquadFilter(), g = ac.createGain();
      f.type = "bandpass"; f.frequency.value = m[0] * detune * (0.995 + Math.random() * 0.01); f.Q.value = m[1];
      var len = m[3] * (0.85 + Math.random() * 0.3);
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(amp * m[2] * Math.sqrt(m[1]), t0 + 0.001);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + len);
      src.connect(f); f.connect(g); g.connect(dest);
    }
    var tk = ac.createBufferSource(); tk.buffer = burst(4);
    var lp = ac.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 8800;
    var bp = ac.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 2600; bp.Q.value = 0.6;
    var tg = ac.createGain();
    tg.gain.setValueAtTime(amp * 0.45, t0); tg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.03);
    tk.connect(lp); lp.connect(bp); bp.connect(tg); tg.connect(dest);
    src.start(t0); tk.start(t0); src.stop(t0 + 0.7); tk.stop(t0 + 0.1);
  }

  /* A turned maple checker on a painted board: the board panel thumps low, the disc
     rings high and short. */
  var PLACE = [[262, 5, 0.85, 0.10], [612, 8, 0.7, 0.065], [1490, 11, 0.46, 0.042], [2880, 14, 0.27, 0.028], [4310, 16, 0.12, 0.018]];
  /* Checker on checker: no board under it, so it is higher, tighter, almost a clink. */
  var STACK = [[930, 8, 0.32, 0.045], [1910, 12, 0.8, 0.05], [3420, 15, 0.42, 0.034], [5230, 18, 0.18, 0.02]];
  var KNOCK = [[168, 5, 1.0, 0.13], [338, 6, 0.5, 0.08], [716, 8, 0.24, 0.05]];

  function place(v, pan) { modal(PLACE, 0.92 * (v || 1), pan, 13); }
  function stack(v, pan, when) { modal(STACK, 0.48 * (v || 1), pan, 7, when); }
  function select(pan) { modal([[2250, 9, 0.55, 0.02], [1120, 7, 0.3, 0.025]], 0.34, pan, 5); }
  function deny() {
    modal(KNOCK, 0.68, 0, 16);
    modal(KNOCK, 0.52, 0, 16, 0.11);
  }

  /* Wood sliding on painted wood: a soft, grainy hiss whose grain comes from the
     buffer itself, so it never sounds like a filter sweep. */
  var scrapeBuf = null;
  function scrape(sec, pan) {
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
    }
    var t0 = ac.currentTime, len = Math.max(0.12, sec);
    var src = ac.createBufferSource(); src.buffer = scrapeBuf;
    var bp = ac.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 1700; bp.Q.value = 0.9;
    var lp = ac.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 4200;
    var g = ac.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.14, t0 + 0.035);
    g.gain.setValueAtTime(0.14, t0 + len - 0.05);
    g.gain.linearRampToValueAtTime(0, t0 + len);
    src.connect(bp); bp.connect(lp); lp.connect(g); g.connect(panner(pan));
    src.start(t0, Math.random() * 0.4); src.stop(t0 + len + 0.05);
  }

  /* The counter bell: a struck steel dome. Additive, every partial a doublet that
     beats, which is the shimmer a real one has. */
  function bell(f0, amp, dur, when, pan) {
    if (!ac || !on) return;
    var t0 = ac.currentTime + (when || 0);
    var dest = panner(pan || 0);
    var parts = [[1, 1, 1], [2.04, 0.42, 0.62], [2.79, 0.3, 0.45], [3.92, 0.16, 0.3], [5.21, 0.08, 0.2]];
    for (var i = 0; i < parts.length; i++) {
      for (var k = 0; k < 2; k++) {
        var o = ac.createOscillator(), g = ac.createGain();
        o.type = "sine";
        o.frequency.value = f0 * parts[i][0] + (k ? 1.6 + i * 0.7 : 0);
        var a = amp * parts[i][1] * (k ? 0.55 : 1);
        g.gain.setValueAtTime(0, t0);
        g.gain.linearRampToValueAtTime(a, t0 + 0.004);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur * parts[i][2]);
        o.connect(g); g.connect(dest);
        o.start(t0); o.stop(t0 + dur + 0.05);
      }
    }
    modal([[f0 * 3.1, 9, 0.5, 0.03]], amp * 0.6, pan || 0, 4, when);   /* the striker */
  }

  function crown(pan) {
    stack(1.25, pan);
    bell(1760, 0.1, 1.7, 0.1, pan * 0.5);
  }
  function hint() { bell(2637, 0.045, 0.6, 0, 0); }
  function win() { bell(784, 0.1, 2.2, 0); bell(988, 0.09, 2.2, 0.16); bell(1175, 0.09, 2.6, 0.32); }
  function lose() { modal(KNOCK, 0.6, 0, 16); bell(392, 0.09, 2.0, 0.18); bell(330, 0.085, 2.4, 0.5); }
  function draw() { bell(587, 0.1, 2.0, 0); }

  /* ---------- the store around you ----------
     A stove ticking over (sparse pops, the odd knot cracking), the low hum of a
     quiet room, and wind leaning on the building now and then. All of it sits far
     under the game. */
  function startBed() {
    if (!ac || bed) return;
    bed = { timers: [], nodes: [] };
    var n = Math.floor(ac.sampleRate * 3), buf = ac.createBuffer(1, n, ac.sampleRate), d = buf.getChannelData(0), x = 0;
    for (var i = 0; i < n; i++) { x = (x + (Math.random() * 2 - 1) * 0.02) * 0.998; d[i] = x * 3; }
    var tone = ac.createBufferSource(); tone.buffer = buf; tone.loop = true;
    var lp = ac.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 260;
    var g = ac.createGain(); g.gain.value = 0.05;
    tone.connect(lp); lp.connect(g); g.connect(outGain); tone.start();
    bed.nodes.push(tone);

    (function pop() {
      if (!bed) return;
      var big = Math.random() < 0.12;
      if (on) modal(big ? [[330, 4, 0.5, 0.05], [2400, 3, 0.6, 0.02]] : [[3200 + Math.random() * 2600, 2, 0.5, 0.012]],
        big ? 0.05 : 0.02 + Math.random() * 0.02, -0.55, big ? 9 : 3);
      bed.timers.push(setTimeout(pop, 120 + Math.random() * (Math.random() < 0.3 ? 1800 : 500)));
    })();
    (function gust() {
      if (!bed) return;
      if (on) {
        var t0 = ac.currentTime, src = ac.createBufferSource(); src.buffer = buf;
        var bp = ac.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = 0.8;
        bp.frequency.setValueAtTime(380, t0); bp.frequency.linearRampToValueAtTime(760, t0 + 2.2); bp.frequency.linearRampToValueAtTime(420, t0 + 4.4);
        var gg = ac.createGain();
        gg.gain.setValueAtTime(0, t0); gg.gain.linearRampToValueAtTime(0.09, t0 + 1.8); gg.gain.linearRampToValueAtTime(0, t0 + 4.4);
        src.connect(bp); bp.connect(gg); gg.connect(roomIn); src.start(t0); src.stop(t0 + 4.5);
      }
      bed.timers.push(setTimeout(gust, 22000 + Math.random() * 30000));
    })();
  }

  function setOn(v) {
    on = !!v;
    if (outGain) outGain.gain.setTargetAtTime(on ? 0.9 : 0, ac.currentTime, 0.03);
  }

  window.CheckersAudio = {
    init: init, setOn: setOn, startBed: startBed,
    place: place, stack: stack, select: select, deny: deny, scrape: scrape,
    crown: crown, hint: hint, win: win, lose: lose, draw: draw
  };
})();
