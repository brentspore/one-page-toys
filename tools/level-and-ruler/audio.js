/* Level & Ruler — sound.
 *
 * Three voices, all small brass hardware:
 *   detent()  the level locking in: a spring-loaded ball dropping into its
 *             groove. Two contacts a few ms apart (snap, then seat), each a
 *             noise tack through the part's own inharmonic modes, plus a low
 *             thock of the instrument body you'd feel in your hand.
 *   tick()    the caliper jaw passing a millimeter: one tiny contact.
 *   chime()   calibration done: a struck brass bell, additive (bells ring too
 *             long to be modal), with its strike transient.
 * Contacts are modal (noise burst -> parallel resonant bandpasses with sqrt(Q)
 * makeup), everything goes through a glue compressor, a lowpass and a brickwall,
 * with a small workshop room on a send.
 */
window.LRAudio = (function () {
  "use strict";

  var KEY = "level-and-ruler_sound";
  var A = null, out = null, room = null, on = true, lastTick = 0;
  try { on = localStorage.getItem(KEY) !== "0"; } catch (e) {}

  function scrub(d) {
    for (var i = 0; i < d.length; i++) if (!isFinite(d[i])) d[i] = 0;
  }

  function build() {
    if (A) return true;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try { A = new AC(); } catch (e) { A = null; return false; }

    out = A.createGain(); out.gain.value = on ? 1 : 0;
    var glue = A.createDynamicsCompressor();
    glue.threshold.value = -14; glue.ratio.value = 3; glue.knee.value = 6;
    glue.attack.value = 0.003; glue.release.value = 0.12;
    var silk = A.createBiquadFilter(); silk.type = "lowpass"; silk.frequency.value = 12500; silk.Q.value = 0.5;
    var wall = A.createDynamicsCompressor();
    wall.threshold.value = -1.5; wall.ratio.value = 20; wall.knee.value = 0;
    wall.attack.value = 0.001; wall.release.value = 0.06;
    out.connect(glue); glue.connect(silk); silk.connect(wall); wall.connect(A.destination);

    // A small workshop: a few early reflections, then a short smooth tail that
    // loses its treble first. Lowpassed noise so the tail is not grainy.
    var sr = A.sampleRate, len = Math.floor(sr * 0.6), ir = A.createBuffer(2, len, sr);
    for (var c = 0; c < 2; c++) {
      var d = ir.getChannelData(c), lp = 0, k;
      for (var i = 0; i < len; i++) {
        var t = i / len;
        lp += ((Math.random() * 2 - 1) - lp) * (0.55 - 0.4 * t);
        d[i] = lp * Math.pow(1 - t, 3.4) * 0.6;
      }
      var early = c ? [0.0071, 0.0133, 0.0219] : [0.0059, 0.0117, 0.0247];
      for (k = 0; k < early.length; k++) {
        var at = Math.floor(early[k] * sr);
        if (at < len) d[at] += (c ? -0.5 : 0.5) * (1 - k * 0.25);
      }
      scrub(d);
    }
    var conv = A.createConvolver(); conv.buffer = ir;
    var hp = A.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 280;
    room = A.createGain(); room.gain.value = 0.24;
    room.connect(hp); hp.connect(conv); conv.connect(out);

    // iOS: a one-sample silent buffer inside the first gesture opens the gate
    try {
      var s0 = A.createBufferSource();
      s0.buffer = A.createBuffer(1, 1, sr);
      s0.connect(A.destination); s0.start(0);
    } catch (e) {}
    return true;
  }

  // A small pool of noise per length: one cached burst would make every click
  // identical; a fresh one per hit is garbage the GC has to chase.
  var pools = {};
  function noise(sec) {
    var key = Math.round(sec * 10000);
    var p = pools[key] || (pools[key] = []);
    if (p.length < 6) {
      var n = Math.max(1, Math.floor(A.sampleRate * sec)), b = A.createBuffer(1, n, A.sampleRate), d = b.getChannelData(0);
      for (var i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      scrub(d);
      p.push(b);
      return b;
    }
    return p[(Math.random() * p.length) | 0];
  }

  // A voice bus that cleans itself up when its longest-lived part ends. A
  // silent keeper source sets the lifetime, so this works the same in an
  // offline render as in real time (a wall-clock timeout would not).
  function voice(t, life, amp, pan, send) {
    var bus = A.createGain(); bus.gain.value = amp;
    var p = A.createStereoPanner ? A.createStereoPanner() : null;
    var dry = p || bus;
    if (p) { p.pan.value = pan || 0; bus.connect(p); }
    dry.connect(out);
    var s = A.createGain(); s.gain.value = send; dry.connect(s); s.connect(room);
    var keep = A.createBufferSource();
    keep.buffer = A.createBuffer(1, Math.max(1, Math.floor(A.sampleRate * life)), A.sampleRate);
    keep.connect(bus);
    keep.onended = function () { try { bus.disconnect(); if (p) p.disconnect(); s.disconnect(); } catch (e) {} };
    keep.start(t);
    return bus;
  }

  // noise burst -> parallel resonators. The burst envelope carries the shape;
  // each mode gets sqrt(Q) makeup, or a narrow band rejects nearly all of it.
  function modal(bus, t, f0, ratios, qs, gains, burst) {
    var src = A.createBufferSource(); src.buffer = noise(burst);
    var eg = A.createGain();
    eg.gain.setValueAtTime(1, t);
    eg.gain.exponentialRampToValueAtTime(0.001, t + burst);
    src.connect(eg);
    for (var m = 0; m < ratios.length; m++) {
      var bp = A.createBiquadFilter(); bp.type = "bandpass";
      bp.frequency.value = Math.min(16000, f0 * ratios[m]); bp.Q.value = qs[m];
      var g = A.createGain(); g.gain.value = gains[m] * Math.sqrt(qs[m]);
      eg.connect(bp); bp.connect(g); g.connect(bus);
    }
    src.start(t);
  }

  // the broadband contact before any ring: what says "two hard things touched"
  function tack(bus, t, amp, dur, lpHz) {
    var s = A.createBufferSource(); s.buffer = noise(dur);
    var lp = A.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = lpHz; lp.Q.value = 0.6;
    var g = A.createGain();
    g.gain.setValueAtTime(amp, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(lp); lp.connect(g); g.connect(bus);
    s.start(t);
  }

  function thock(bus, t, f, amp, decay) {
    var o = A.createOscillator(); o.type = "sine";
    o.frequency.setValueAtTime(f * 1.35, t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.018);
    var g = A.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(amp, t + 0.0015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    o.connect(g); g.connect(bus);
    o.start(t); o.stop(t + decay + 0.02);
  }

  function now() { return A.currentTime + 0.004; }

  return {
    unlock: function () {
      if (!build()) return;
      if (A.state === "suspended") {
        try { var p = A.resume(); if (p && p.catch) p.catch(function () {}); } catch (e) {}
      }
    },
    set: function (v) {
      on = !!v;
      try { localStorage.setItem(KEY, on ? "1" : "0"); } catch (e) {}
      if (out) out.gain.value = on ? 1 : 0;
    },
    on: function () { return on; },

    /* The lock. v (0..1) is how decisively it arrived; it nudges brightness. */
    detent: function (v, pan) {
      if (!A || !on) return;
      v = v === undefined ? 1 : Math.max(0.4, Math.min(1, v));
      var t = now(), jit = 1 + (Math.random() - 0.5) * 0.04;
      var bus = voice(t, 0.7, 0.62 * v, pan || 0, 0.9);
      // snap: the ball leaves the land and hits the groove wall
      tack(bus, t, 0.55, 0.0025, 7200);
      modal(bus, t, 2650 * jit, [1, 1.58, 2.71, 4.13], [26, 22, 18, 14], [0.55, 0.36, 0.22, 0.12], 0.004);
      // seat: it settles to the bottom 9ms later, smaller and a touch lower
      tack(bus, t + 0.009, 0.22, 0.002, 6000);
      modal(bus, t + 0.009, 2480 * jit, [1, 1.58, 2.71], [24, 20, 16], [0.3, 0.2, 0.1], 0.003);
      // the brass housing answers, longer and lower
      modal(bus, t, 940 * jit, [1, 2.29, 3.61], [70, 55, 40], [0.22, 0.12, 0.06], 0.005);
      // and the body you are holding
      thock(bus, t, 150, 0.32, 0.05);
    },

    /* One millimeter passing under the caliper jaw. Throttled. */
    tick: function (pan) {
      if (!A || !on) return;
      var ms = A.currentTime * 1000;
      if (ms - lastTick < 28) return;
      lastTick = ms;
      var t = now();
      var bus = voice(t, 0.25, 0.19, pan || 0, 0.4);
      tack(bus, t, 0.25, 0.0015, 8000);
      modal(bus, t, 3500 * (1 + (Math.random() - 0.5) * 0.06), [1, 2.4], [22, 16], [0.5, 0.2], 0.002);
    },

    /* Calibration finished: a small struck brass bell. */
    chime: function () {
      if (!A || !on) return;
      var t = now();
      var bus = voice(t, 2.2, 0.5, 0, 1.1);
      tack(bus, t, 0.35, 0.006, 9000);
      var f0 = 1318.5, R = [1, 2, 3.01, 4.17, 5.43], Gn = [1, 0.42, 0.28, 0.17, 0.1], D = [1.5, 0.95, 0.65, 0.45, 0.3];
      for (var i = 0; i < R.length; i++) {
        var o = A.createOscillator(); o.type = "sine";
        o.frequency.value = f0 * R[i] * (1 + (i ? (Math.random() - 0.5) * 0.002 : 0));
        var g = A.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.16 * Gn[i], t + 0.003);
        g.gain.exponentialRampToValueAtTime(0.0001, t + D[i]);
        var p = A.createStereoPanner ? A.createStereoPanner() : null;
        if (p) { p.pan.value = (i % 2 ? 0.18 : -0.18); o.connect(g); g.connect(p); p.connect(bus); }
        else { o.connect(g); g.connect(bus); }
        o.start(t); o.stop(t + D[i] + 0.05);
      }
    }
  };
})();
