/* Reversi — the sound of thick ebony and ivory discs on green baize in a brass-bound
   mahogany case, in the card room of a London club on a foggy night.

   House rules, each learned on an earlier toy:
   - Contacts are MODAL: a short noise burst through parallel resonant bandpasses at
     the object's own modes, opened by a broadband, LOWPASSED tack. Each mode gets a
     sqrt(Q) makeup, or a narrow resonator swallows the burst and the voice goes quiet.
   - A disc set on the board is two things: the felt and the wood under it take the
     blow (a soft, low thud, because baize eats the attack), and the disc itself gives
     a small, muted click. The case is the same for every disc, so it lives in ONE
     shared body filter that every wooden sound goes through.
   - Ivory is a touch brighter and harder than ebony.
   - Long tails (the clock's chime) are ADDITIVE, never modal.
   - Velocity is applied ONCE, at the top of a voice.
   - A big capture turns many discs at once. Their clicks are spread out in time by the
     ripple, close ones are merged and thinned, and their pitch stays within a fourth,
     so a wave reads as many discs and not as a tune. The compressor is glue; the
     brickwall after it is the ceiling. */
(function () {
  "use strict";

  var ac = null, busIn = null, dryIn = null, outGain = null, on = true;
  var bed = null;

  function init() {
    if (ac) { if (ac.state === "suspended" && ac.resume) ac.resume(); return; }
    try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
    var b = ac.createBuffer(1, 1, ac.sampleRate);               /* iOS unlock */
    var s = ac.createBufferSource(); s.buffer = b; s.connect(ac.destination); s.start(0);

    busIn = ac.createGain();
    /* The case: a mahogany tray with a thin wooden floor under the baize, its brass
       corners and the table under it. The floor is the low body; the rim a broad bump
       above it; the felt takes the top end off everything. */
    var floor = ac.createBiquadFilter(); floor.type = "peaking"; floor.frequency.value = 178; floor.Q.value = 1.1; floor.gain.value = 3.5;
    var rim = ac.createBiquadFilter(); rim.type = "peaking"; rim.frequency.value = 420; rim.Q.value = 1.5; rim.gain.value = 2;
    var felt = ac.createBiquadFilter(); felt.type = "highshelf"; felt.frequency.value = 5200; felt.gain.value = -5;
    var comp = ac.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 3; comp.knee.value = 6; comp.attack.value = 0.003; comp.release.value = 0.15;
    var wall = ac.createDynamicsCompressor();
    wall.threshold.value = -1.5; wall.ratio.value = 20; wall.knee.value = 0; wall.attack.value = 0.001; wall.release.value = 0.05;
    outGain = ac.createGain(); outGain.gain.value = on ? 0.9 : 0;

    busIn.connect(floor); floor.connect(rim); rim.connect(felt); felt.connect(comp);
    comp.connect(wall); wall.connect(outGain); outGain.connect(ac.destination);
    /* sounds that ring in the air (the clock) skip the case */
    dryIn = ac.createGain(); dryIn.connect(comp);

    /* A card room panelled in oak, carpeted, curtains drawn: short and warm. */
    var conv = ac.createConvolver(); conv.buffer = roomIR(1.3);
    var wet = ac.createGain(); wet.gain.value = 0.22;
    felt.connect(conv); dryIn.connect(conv); conv.connect(wet); wet.connect(comp);
  }

  function clean(d) { for (var i = 0; i < d.length; i++) if (!isFinite(d[i])) d[i] = 0; }

  function roomIR(sec) {
    var n = Math.floor(ac.sampleRate * sec), buf = ac.createBuffer(2, n, ac.sampleRate);
    for (var ch = 0; ch < 2; ch++) {
      var d = buf.getChannelData(ch), lo = 0, lo2 = 0;
      for (var i = 0; i < n; i++) {
        var t = i / n, w = Math.random() * 2 - 1;
        lo = lo * 0.55 + w * 0.45;
        lo2 = lo2 * (0.5 + 0.42 * t) + lo * (0.5 - 0.42 * t);       /* darker as it decays */
        var early = i < ac.sampleRate * 0.035 && Math.random() < 0.004 ? (Math.random() - 0.5) * 2.2 : 0;
        d[i] = (lo2 + early) * Math.pow(1 - t, 4.2);
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

  /* modes: [freq, Q, gain, decaySeconds]; tack: broadband contact level (0 = none);
     tone: a pitch factor; tackHz: where the contact click is centered; tackLp: how much
     top the contact keeps (felt keeps little) */
  function modal(modes, amp, pan, burstMs, when, tack, dest, tone, tackHz, tackLp) {
    if (!ac || !on || !(amp > 0)) return;
    var t0 = ac.currentTime + (when || 0);
    var out = panner(pan, dest);
    var src = ac.createBufferSource(); src.buffer = burst(burstMs || 8);
    var detune = (tone || 1) * (0.99 + Math.random() * 0.02);
    for (var i = 0; i < modes.length; i++) {
      var m = modes[i], f = ac.createBiquadFilter(), g = ac.createGain();
      f.type = "bandpass"; f.frequency.value = Math.min(17000, m[0] * detune * (0.994 + Math.random() * 0.012)); f.Q.value = m[1];
      var len = m[3] * (0.85 + Math.random() * 0.3);
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(amp * m[2] * Math.sqrt(m[1]), t0 + 0.001);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + len);
      src.connect(f); f.connect(g); g.connect(out);
    }
    if (tack) {
      var tk = ac.createBufferSource(); tk.buffer = burst(3);
      var lp = ac.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = tackLp || 7000;
      var bp = ac.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = tackHz || 2400; bp.Q.value = 0.6;
      var tg = ac.createGain();
      tg.gain.setValueAtTime(amp * tack, t0); tg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.02);
      tk.connect(lp); lp.connect(bp); bp.connect(tg); tg.connect(out);
      tk.start(t0); tk.stop(t0 + 0.08);
    }
    src.start(t0); src.stop(t0 + 0.6);
  }

  /* ---------- the voices ---------- */
  /* The case floor under the baize: damped wood, low, and the felt dulls the strike. */
  var CASE = [[150, 4, 1.0, 0.1], [248, 5, 0.8, 0.08], [520, 6, 0.5, 0.055], [960, 8, 0.28, 0.035], [1700, 10, 0.14, 0.022]];
  /* An ebony disc, thick and dense: its own ring is high, short and muffled by the felt. */
  var EBONY = [[2150, 16, 0.55, 0.026], [3480, 20, 0.42, 0.018], [5230, 26, 0.22, 0.012]];
  /* Ivory: harder, a touch brighter, a hint more ring. */
  var IVORY = [[2520, 18, 0.55, 0.03], [4060, 22, 0.44, 0.021], [6100, 28, 0.24, 0.014]];
  /* The mahogany rim, tapped with a knuckle (a pass). */
  var RIM = [[212, 5, 1.0, 0.11], [468, 6, 0.55, 0.075], [990, 8, 0.28, 0.045], [2100, 11, 0.12, 0.025]];
  /* A disc's edge against a fingernail: the small tick of lifting one. */
  var NAIL = [[3100, 14, 0.5, 0.012], [5200, 18, 0.4, 0.009]];
  /* Brass: the clock's own tick, a small escapement click. */
  var ESCAPE = [[3800, 24, 0.5, 0.02], [6100, 30, 0.35, 0.014], [8800, 34, 0.2, 0.01]];

  var recent = [], lastHit = -1;
  function crowd(t) {
    while (recent.length && recent[0] < t - 0.12) recent.shift();
    recent.push(t);
    return recent.length;
  }

  /* A disc set down. color 1 ebony face up, 2 ivory; v 0..1; pan -1..1 */
  function place(color, v, pan) {
    if (!ac || !on) return;
    var t = ac.currentTime;
    lastHit = t;
    v = Math.max(0.25, Math.min(1, v == null ? 0.85 : v));
    var ivory = color === 2;
    /* the felt and the case floor take the blow */
    modal(CASE, 0.7 * v, pan, 16, 0, 0.3, null, ivory ? 1.02 : 0.98, 1500, 4200);
    /* and the disc itself, a muted click a hair after the felt gives */
    modal(ivory ? IVORY : EBONY, 0.3 * v, pan, 3, 0.0012, 0.4, null, 0.98 + Math.random() * 0.04, ivory ? 3000 : 2600, 7600);
  }

  /* One disc turning over in a capture: a faint tick as it lifts, then it drops back
     onto the felt, new face up. k 0..1 is how far along the ripple it is (pitch rises a
     little, never past a fourth); n is how many discs the wave turns. */
  function flip(color, pan, k, n) {
    if (!ac || !on) return;
    var t = ac.currentTime;
    if (t - lastHit < 0.012) return;
    lastHit = t;
    var thin = 1 / Math.sqrt(crowd(t));
    var big = n > 1 ? 1 / Math.sqrt(1 + (n - 1) * 0.08) : 1;
    var v = (0.78 + Math.random() * 0.22) * thin * big;
    var tone = Math.pow(2, (Math.max(0, Math.min(1, k)) * 4.6) / 12);
    var ivory = color === 2;
    modal(NAIL, 0.1 * v, pan, 2, 0, 0.25, null, tone, 3600, 8000);
    modal(CASE, 0.48 * v, pan, 10, 0.07, 0.24, null, tone * (ivory ? 1.03 : 0.99), 1700, 4400);
    modal(ivory ? IVORY : EBONY, 0.25 * v, pan, 3, 0.071, 0.34, null, tone, ivory ? 3100 : 2700, 7600);
  }

  function pass(pan) { modal(RIM, 0.84, pan || 0, 16, 0, 0.32, null, 1, 2200, 6000); modal(RIM, 0.54, pan || 0, 14, 0.13, 0.28, null, 1.03, 2200, 6000); }
  function deny() { modal(RIM, 0.32, 0, 14, 0, 0.3, null, 1.2); }
  function tick(pan) { modal(NAIL, 0.16, pan || 0, 2, 0, 0.3, null, 1.1, 3600, 8000); }

  /* ---------- the clock ----------
     A bracket clock's bell, struck by a small hammer: inharmonic partials, each a
     slowly beating pair, over a soft strike. Additive, so the tail is clean. */
  function bell(f0, amp, dur, when, pan) {
    if (!ac || !on) return;
    var t0 = ac.currentTime + (when || 0);
    var dest = panner(pan || 0, dryIn);
    var parts = [[1, 1, 1], [2.0, 0.42, 0.62], [2.76, 0.26, 0.42], [4.07, 0.13, 0.3], [5.4, 0.07, 0.2]];
    for (var i = 0; i < parts.length; i++) {
      for (var k = 0; k < 2; k++) {
        var o = ac.createOscillator(), g = ac.createGain();
        o.type = "sine";
        o.frequency.value = f0 * parts[i][0] + (k ? 0.8 + i * 0.5 : 0);
        var a = amp * parts[i][1] * (k ? 0.5 : 1);
        g.gain.setValueAtTime(0, t0);
        g.gain.linearRampToValueAtTime(a, t0 + 0.004);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur * parts[i][2]);
        o.connect(g); g.connect(dest);
        o.start(t0); o.stop(t0 + dur + 0.05);
      }
    }
    modal([[f0 * 3.3, 7, 0.4, 0.025], [f0 * 6.1, 9, 0.25, 0.016]], amp * 0.6, pan || 0, 3, when, 0.25, dryIn);
  }
  /* C major, the clock on the mantel: consonant and unhurried */
  function win() { bell(659.3, 0.075, 3.4, 0, 0.35); bell(523.3, 0.07, 3.6, 0.55, 0.35); bell(784, 0.06, 3.8, 1.1, 0.35); }
  function lose() { bell(523.3, 0.07, 3.2, 0, 0.35); bell(392, 0.065, 3.6, 0.6, 0.35); }
  function draw() { bell(523.3, 0.07, 3.2, 0, 0.35); bell(523.3, 0.06, 3.4, 0.7, 0.35); }
  function chime() { bell(1046.5, 0.035, 1.8, 0, 0.35); }

  /* ---------- the room ----------
     The fire in the grate (a low roar, small crackles, now and then a pop), the gas
     jets' faint hiss, and the mantel clock ticking once a second. Far under the game,
     scheduled ahead in audio time a few seconds at a time. */
  function startBed() {
    if (!ac || bed) return;
    bed = { until: 0, tickAt: 0, tock: 0, timer: 0 };
    var sr = ac.sampleRate, n = Math.floor(sr * 4), buf = ac.createBuffer(2, n, sr);
    for (var ch = 0; ch < 2; ch++) {
      var d = buf.getChannelData(ch), br = 0;
      for (var i = 0; i < n; i++) {
        var w = Math.random() * 2 - 1;
        br = (br + 0.02 * w) / 1.02;                       /* brown */
        d[i] = br * 3.2 + w * 0.05;
      }
      var f = Math.floor(sr * 0.3);
      for (var j = 0; j < f; j++) { var k = j / f; d[n - f + j] = d[n - f + j] * (1 - k) + d[j] * k; }
      clean(d);
    }
    /* the fire's roar: low and soft, from the grate on the right */
    var roar = ac.createBufferSource(); roar.buffer = buf; roar.loop = true;
    var rlp = ac.createBiquadFilter(); rlp.type = "lowpass"; rlp.frequency.value = 380;
    var rg = ac.createGain(); rg.gain.value = 0.05;
    var rp = panner(0.45, outGain);
    roar.connect(rlp); rlp.connect(rg); rg.connect(rp);
    /* the gas: a thin, steady hiss from the jets on the walls */
    var gas = ac.createBufferSource(); gas.buffer = buf; gas.loop = true;
    var hp = ac.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 3800;
    var glp = ac.createBiquadFilter(); glp.type = "lowpass"; glp.frequency.value = 9000;
    var gg = ac.createGain(); gg.gain.value = 0.05;
    gas.connect(hp); hp.connect(glp); glp.connect(gg); gg.connect(outGain);
    var t0 = ac.currentTime;
    roar.start(t0); gas.start(t0, 1.7);
    bed.until = t0; bed.tickAt = t0 + 0.5;
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
        /* a crackle: a twig of coal splitting, small and woody; sometimes a louder pop */
        var big = Math.random() < 0.07;
        var f = 700 + Math.random() * 2400;
        modal([[f, 6, 0.6, 0.02], [f * 2.2, 9, 0.3, 0.012]], big ? 0.05 + Math.random() * 0.03 : 0.008 + Math.random() * 0.014,
          0.35 + Math.random() * 0.25, 2, t - now, 0.4, dryIn, 1, 2600, 7000);
      }
      bed.until += 0.05 + Math.random() * (Math.random() < 0.3 ? 0.6 : 0.2);
    }
    if (bed.tickAt < now) bed.tickAt = now + 0.2;
    while (bed.tickAt < to) {
      if (on) modal(ESCAPE, 0.022, 0.4, 2, bed.tickAt - now, 0.2, dryIn, bed.tock ? 0.86 : 1);
      bed.tock ^= 1;
      bed.tickAt += 1;
    }
  }

  function setOn(v) {
    on = !!v;
    if (outGain) outGain.gain.setTargetAtTime(on ? 0.9 : 0, ac.currentTime, 0.03);
  }

  window.ReversiAudio = {
    init: init, setOn: setOn, startBed: startBed,
    place: place, flip: flip, pass: pass, deny: deny, tick: tick,
    win: win, lose: lose, draw: draw, chime: chime
  };
})();
