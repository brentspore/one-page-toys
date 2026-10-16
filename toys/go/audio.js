/* Go — the sound of slate and shell on a thick kaya board, in a mountain teahouse at
   dusk with rain on the roof.

   House rules, each learned on an earlier toy:
   - Contacts are MODAL: a short noise burst through parallel resonant bandpasses at
     the object's own modes, opened by a broadband, LOWPASSED tack (the tack is what
     says "two hard things met"). Each mode gets a sqrt(Q) makeup, or a narrow
     resonator swallows the burst and the voice is inaudible.
   - A stone on a goban is three things at once: the stone itself (small, hard, bright
     and short), the click of the contact, and the board, a thick slab of kaya with a
     carved hollow underneath that gives the famous low "pachi" body. The board is
     the same for every stone, so it lives in ONE shared body filter that every wooden
     sound goes through.
   - Slate is dense and a little lower; clamshell is lighter and brighter.
   - Long tails (the bells at the end) are ADDITIVE, never modal.
   - Velocity is applied ONCE, at the top of a voice.
   - Throttled: a capture of many stones asks for many clicks at once; close hits are
     merged and thinned, so nothing stacks into a clip. The compressor is glue and the
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
    /* The goban: a slab of kaya as thick as a hand is wide, on four short legs, with
       a shallow hollow carved under it. The slab's mass is the low body; the hollow
       is a broad bump just above it; the top rings a little in the low mids. */
    var mass = ac.createBiquadFilter(); mass.type = "peaking"; mass.frequency.value = 196; mass.Q.value = 1.1; mass.gain.value = 3.5;
    var hollow = ac.createBiquadFilter(); hollow.type = "peaking"; hollow.frequency.value = 330; hollow.Q.value = 1.6; hollow.gain.value = 2.5;
    var top = ac.createBiquadFilter(); top.type = "peaking"; top.frequency.value = 760; top.Q.value = 1.4; top.gain.value = 1.5;
    var shelf = ac.createBiquadFilter(); shelf.type = "highshelf"; shelf.frequency.value = 9500; shelf.gain.value = -3;
    var comp = ac.createDynamicsCompressor();
    comp.threshold.value = -12; comp.ratio.value = 3; comp.knee.value = 6; comp.attack.value = 0.003; comp.release.value = 0.15;
    var wall = ac.createDynamicsCompressor();
    wall.threshold.value = -1.5; wall.ratio.value = 20; wall.knee.value = 0; wall.attack.value = 0.001; wall.release.value = 0.05;
    outGain = ac.createGain(); outGain.gain.value = on ? 0.9 : 0;

    busIn.connect(mass); mass.connect(hollow); hollow.connect(top); top.connect(shelf); shelf.connect(comp);
    comp.connect(wall); wall.connect(outGain); outGain.connect(ac.destination);
    /* sounds that ring in the air (the bells) skip the board */
    dryIn = ac.createGain(); dryIn.connect(comp);

    /* A small wooden room floored with tatami: the mats eat the highs and the paper
       walls let the tail out, so it is short, soft and woody. */
    var conv = ac.createConvolver(); conv.buffer = roomIR(1.1);
    var wet = ac.createGain(); wet.gain.value = 0.2;
    shelf.connect(conv); dryIn.connect(conv); conv.connect(wet); wet.connect(comp);
  }

  function clean(d) { for (var i = 0; i < d.length; i++) if (!isFinite(d[i])) d[i] = 0; }

  function roomIR(sec) {
    var n = Math.floor(ac.sampleRate * sec), buf = ac.createBuffer(2, n, ac.sampleRate);
    for (var ch = 0; ch < 2; ch++) {
      var d = buf.getChannelData(ch), lo = 0, lo2 = 0;
      for (var i = 0; i < n; i++) {
        var t = i / n, w = Math.random() * 2 - 1;
        lo = lo * 0.5 + w * 0.5;
        lo2 = lo2 * (0.45 + 0.45 * t) + lo * (0.55 - 0.45 * t);       /* darker as it decays */
        var early = i < ac.sampleRate * 0.03 && Math.random() < 0.005 ? (Math.random() - 0.5) * 2.4 : 0;
        d[i] = (lo2 + early) * Math.pow(1 - t, 3.8);
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
     tone: a pitch factor; tackHz: where the contact click is centered */
  function modal(modes, amp, pan, burstMs, when, tack, dest, tone, tackHz) {
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
      var lp = ac.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 9000;
      var bp = ac.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = tackHz || 3400; bp.Q.value = 0.6;
      var tg = ac.createGain();
      tg.gain.setValueAtTime(amp * tack, t0); tg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.022);
      tk.connect(lp); lp.connect(bp); bp.connect(tg); tg.connect(out);
      tk.start(t0); tk.stop(t0 + 0.08);
    }
    src.start(t0); src.stop(t0 + 0.6);
  }

  /* ---------- the voices ---------- */
  /* A slate stone, 22mm across and about 9 thick: dense, so it rings high and dies fast. */
  var SLATE = [[2860, 22, 0.62, 0.032], [4410, 28, 0.5, 0.024], [6570, 34, 0.3, 0.016], [9100, 40, 0.14, 0.01]];
  /* Clamshell: lighter and harder, a touch brighter, a hint more ring. */
  var SHELL = [[3320, 24, 0.6, 0.036], [5180, 30, 0.52, 0.026], [7740, 36, 0.32, 0.018], [10400, 42, 0.14, 0.011]];
  /* The kaya slab under it: damped wood modes in the low mids, and the hollow's boom. */
  var KAYA = [[148, 4, 1.0, 0.11], [236, 5, 0.85, 0.09], [512, 7, 0.55, 0.06], [1010, 9, 0.34, 0.04], [1880, 12, 0.18, 0.025]];
  /* The board's edge, tapped with a fingertip (a pass). */
  var EDGE = [[176, 5, 1.0, 0.1], [384, 6, 0.5, 0.07], [820, 8, 0.24, 0.045]];
  /* Two stones knocking together in a bowl or a lid. */
  var CLACK = [[3050, 18, 0.5, 0.02], [4780, 24, 0.6, 0.016], [7100, 30, 0.4, 0.012], [9600, 36, 0.2, 0.008]];
  /* A chestnut lid, thin and light: higher wood than the board. */
  var LID = [[380, 6, 1.0, 0.06], [820, 8, 0.66, 0.045], [1620, 11, 0.4, 0.03], [3100, 14, 0.2, 0.02]];

  var recent = [], lastHit = -1;
  function crowd(t) {
    while (recent.length && recent[0] < t - 0.12) recent.shift();
    recent.push(t);
    return recent.length;
  }

  /* A stone set down. color 1 slate, 2 shell; v 0..1; pan -1..1 */
  function stone(color, v, pan) {
    if (!ac || !on) return;
    var t = ac.currentTime;
    if (t - lastHit < 0.012) return;
    lastHit = t;
    var thin = 1 / Math.sqrt(crowd(t));
    v = Math.max(0.2, Math.min(1, v == null ? 0.85 : v)) * thin;
    var shell = color === 2;
    /* the board takes the blow */
    modal(KAYA, 0.8 * v, pan, 14, 0, 0.42, null, shell ? 1.02 : 0.98, 2600);
    /* and the stone rings, a hair later than the wood's first push */
    modal(shell ? SHELL : SLATE, (shell ? 0.33 : 0.36) * v, pan, 3, 0.0008, 0.62, null, 0.98 + Math.random() * 0.04, shell ? 4300 : 3600);
  }

  /* A hand going into the bowl for a stone: stones shifting against each other. */
  function rustle(color, pan) {
    if (!ac || !on) return;
    var n = 3 + ((Math.random() * 3) | 0), t = 0;
    for (var i = 0; i < n; i++) {
      modal(CLACK, (0.16 + Math.random() * 0.12) * (i ? 0.8 : 1), pan + (Math.random() - 0.5) * 0.1, 2, t, 0.35, null,
        (color === 2 ? 1.08 : 0.96) * (0.94 + Math.random() * 0.14));
      t += 0.014 + Math.random() * 0.03;
    }
    brush(0.12, pan, 0.035);
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
    var bp = ac.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 2100; bp.Q.value = 0.8;
    var lp = ac.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 5600;
    var g = ac.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(amp, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + len);
    src.connect(bp); bp.connect(lp); lp.connect(g); g.connect(panner(pan));
    src.start(t0, Math.random() * 0.3); src.stop(t0 + len + 0.05);
  }

  /* Captured stones picked off the board, one tiny click each. */
  function pickup(n, pan) {
    if (!ac || !on || !n) return;
    var count = Math.min(8, n), t = 0;
    for (var i = 0; i < count; i++) {
      modal(CLACK, 0.18 * (1 - i * 0.05), pan + (Math.random() - 0.5) * 0.2, 2, t, 0.4, null, 0.9 + Math.random() * 0.2);
      t += 0.03 + Math.random() * 0.03;
    }
  }

  /* ...and dropped into the lid: wood, then the stones settling on each other. */
  function lid(n, pan, color) {
    if (!ac || !on || !n) return;
    var count = Math.min(10, 1 + n), t = 0, shell = color === 2;
    var thin = 1 / Math.sqrt(Math.max(1, n * 0.5));
    modal(LID, 0.62 * Math.min(1, 0.6 + n * 0.08), pan, 10, 0, 0.35, null, 1);
    for (var i = 0; i < count; i++) {
      var k = i / count;
      modal(CLACK, (0.3 - 0.14 * k) * thin, pan + (Math.random() - 0.5) * 0.16, 2, t, 0.5, null, (shell ? 1.08 : 0.95) * (0.94 + Math.random() * 0.12));
      if (i % 3 === 0) modal(LID, 0.2 * thin, pan, 6, t + 0.002, 0, null, 1.03 + Math.random() * 0.08);
      t += 0.022 + Math.random() * 0.03 + k * 0.03;
    }
  }

  function pass(pan) { modal(EDGE, 0.62, pan || 0, 18, 0, 0.3); }
  function deny() { modal(EDGE, 0.36, 0, 16, 0, 0.3); modal(EDGE, 0.28, 0, 16, 0.1, 0.3); }
  function tick(pan) { modal(CLACK, 0.12, pan || 0, 2, 0, 0.3, null, 1.15); }

  /* ---------- bells ----------
     A small temple bowl (rin) struck with a padded stick: inharmonic partials, each
     a slowly beating doublet, over a soft strike. Additive, so the tail is clean. */
  function bell(f0, amp, dur, when, pan) {
    if (!ac || !on) return;
    var t0 = ac.currentTime + (when || 0);
    var dest = panner(pan || 0, dryIn);
    var parts = [[1, 1, 1], [2.01, 0.5, 0.7], [3.01, 0.22, 0.5], [4.17, 0.12, 0.34], [5.43, 0.06, 0.24]];
    for (var i = 0; i < parts.length; i++) {
      for (var k = 0; k < 2; k++) {
        var o = ac.createOscillator(), g = ac.createGain();
        o.type = "sine";
        o.frequency.value = f0 * parts[i][0] + (k ? 0.7 + i * 0.6 : 0);
        var a = amp * parts[i][1] * (k ? 0.55 : 1);
        g.gain.setValueAtTime(0, t0);
        g.gain.linearRampToValueAtTime(a, t0 + 0.006);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur * parts[i][2]);
        o.connect(g); g.connect(dest);
        o.start(t0); o.stop(t0 + dur + 0.05);
      }
    }
    modal([[f0 * 2.6, 6, 0.4, 0.03], [f0 * 4.9, 8, 0.25, 0.02]], amp * 0.5, pan || 0, 4, when, 0.25, dryIn);
  }
  /* D minor pentatonic-ish (the in scale's softer cousin): consonant, a little wistful */
  function win() { bell(587.3, 0.07, 3.2, 0, -0.25); bell(880, 0.06, 3.0, 0.32, 0.2); bell(1174.7, 0.045, 3.4, 0.7, 0); }
  function lose() { bell(440, 0.07, 3.0, 0, 0.1); bell(392, 0.06, 3.4, 0.5, -0.1); }
  function chime() { bell(1174.7, 0.035, 1.6, 0, 0); }

  /* ---------- the room ----------
     Rain on the roof and on the engawa: a dark wash with a brighter hiss of rain on
     leaves, single drops off the eaves onto the boards, now and then a gust. Far
     under the game. Scheduled ahead in audio time, a few seconds at a time. */
  function startBed() {
    if (!ac || bed) return;
    bed = { until: 0, timer: 0 };
    var sr = ac.sampleRate, n = Math.floor(sr * 4), buf = ac.createBuffer(2, n, sr);
    for (var ch = 0; ch < 2; ch++) {
      var d = buf.getChannelData(ch), br = 0;
      for (var i = 0; i < n; i++) {
        var w = Math.random() * 2 - 1;
        br = (br + 0.02 * w) / 1.02;                       /* brown */
        d[i] = br * 3.2 + w * 0.06;
      }
      var f = Math.floor(sr * 0.3);
      for (var j = 0; j < f; j++) { var k = j / f; d[n - f + j] = d[n - f + j] * (1 - k) + d[j] * k; }
      clean(d);
    }
    /* the roof: a low, soft roar */
    var roof = ac.createBufferSource(); roof.buffer = buf; roof.loop = true;
    var rlp = ac.createBiquadFilter(); rlp.type = "lowpass"; rlp.frequency.value = 520;
    var rg = ac.createGain(); rg.gain.value = 0.065;
    roof.connect(rlp); rlp.connect(rg); rg.connect(outGain);
    /* rain on the maples and the garden: the hiss */
    var leaves = ac.createBufferSource(); leaves.buffer = buf; leaves.loop = true;
    var hp = ac.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 1800;
    var llp = ac.createBiquadFilter(); llp.type = "lowpass"; llp.frequency.value = 7000;
    var lg = ac.createGain(); lg.gain.value = 0.3;
    leaves.connect(hp); hp.connect(llp); llp.connect(lg); lg.connect(outGain);
    var t0 = ac.currentTime;
    roof.start(t0); leaves.start(t0, 1.9);
    bed.rg = rg; bed.lg = lg; bed.until = t0;
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
        /* a drop off the eaves onto the engawa boards: woody, small */
        var f = 900 + Math.random() * 1500;
        modal([[f, 9, 0.6, 0.03], [f * 2.3, 12, 0.3, 0.018]], 0.012 + Math.random() * 0.016, -0.6 + Math.random() * 1.2, 3, t - now, 0.3, dryIn);
        if (Math.random() < 0.025) {
          var g = bed.lg.gain;
          g.setTargetAtTime(0.48, t, 0.7); g.setTargetAtTime(0.3, t + 2.4, 1.3);
        }
      }
      bed.until += 0.08 + Math.random() * (Math.random() < 0.25 ? 0.7 : 0.26);
    }
  }

  function setOn(v) {
    on = !!v;
    if (outGain) outGain.gain.setTargetAtTime(on ? 0.9 : 0, ac.currentTime, 0.03);
  }

  window.GoAudio = {
    init: init, setOn: setOn, startBed: startBed,
    stone: stone, rustle: rustle, pickup: pickup, lid: lid, pass: pass, deny: deny, tick: tick,
    win: win, lose: lose, chime: chime
  };
})();
