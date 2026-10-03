/* Jettison — sound. Everything is synthesised; there are no samples.
 *
 * A cargo bay is a steel room, and in a station you hear things THROUGH the
 * structure. So:
 *   - A module stopping is a structure-borne thunk: a short contact through
 *     the low modes of the deck plating (a big steel plate rings low), plus the
 *     mag-clamp clunk of it locking down: a bright modal latch over a soft
 *     thump. Hitting another module adds that module's hollow container knock.
 *     Weight lives in the depth and length of the thunk, never in a tune: the
 *     pitch spread across sizes stays inside a fourth.
 *   - A push is a puff from the attitude thrusters (short bandpassed gas),
 *     and a glide carries a low mag-deck hum for as long as it moves.
 *   - An airlock is a servo, a pressure hiss as the inner door cracks, and the
 *     seal clunk of the outer door. Then nothing: the module is out in vacuum,
 *     and there is no sound out there. A soft console chime per jettison
 *     climbs a pentatonic ladder through the level.
 *   - Under it all, the station: a quiet air-handling roar and mains hum.
 *
 * House bar: modal contacts with sqrt(Q) makeup, pooled noise bursts (one
 * cached burst made every hit identical in Meld), stereo by position, a
 * metal room, glue compressor then brickwall, iOS unlock, one mute.
 * Levels measured with an analyser spliced in front of the destination.
 */
(function () {
  "use strict";

  var A = null, SR = 48000, mix = null, master = null, revIn = null, bedG = null;
  var on = true, ready = false;
  var noise = {};

  var PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26, 28, 31];
  function pent(step) { return 523.25 * Math.pow(2, PENTA[Math.max(0, Math.min(PENTA.length - 1, step))] / 12); }   // C major pentatonic from C5

  function noiseBuf(sec, brown) {
    var key = sec + (brown ? "b" : "w" + (sec <= 0.5 ? Math.floor(Math.random() * 8) : ""));
    if (noise[key]) return noise[key];
    var len = Math.max(1, Math.ceil(SR * sec)), b = A.createBuffer(1, len, SR), d = b.getChannelData(0), last = 0;
    for (var i = 0; i < len; i++) {
      var w = Math.random() * 2 - 1;
      if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.2; } else d[i] = w;
    }
    noise[key] = b;
    return b;
  }

  // a steel room: bright early reflections, a medium tail whose treble dies first
  function room() {
    var len = Math.ceil(SR * 1.7), b = A.createBuffer(2, len, SR);
    for (var ch = 0; ch < 2; ch++) {
      var d = b.getChannelData(ch), lp = 0;
      for (var e = 0; e < 9; e++) {
        var at = Math.floor(SR * (0.004 + Math.random() * 0.03)), amp = (0.5 - e * 0.04) * (Math.random() < 0.5 ? -1 : 1);
        for (var k = 0; k < 5; k++) d[at + k] += amp * (1 - k / 5);
      }
      for (var i = Math.floor(SR * 0.012); i < len; i++) {
        var t = i / SR, cut = 0.55 - 0.4 * Math.min(1, t / 1.2);   // darkening as it decays
        lp += ((Math.random() * 2 - 1) - lp) * cut;
        d[i] += lp * Math.exp(-6.9 * t / 1.5) * 0.5;
      }
    }
    return b;
  }

  function build() {
    if (ready) return;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try { A = new AC(); } catch (e) { return; }
    SR = A.sampleRate;
    mix = A.createGain();
    master = A.createGain(); master.gain.value = on ? 1 : 0;
    var comp = A.createDynamicsCompressor();
    comp.threshold.value = -10; comp.ratio.value = 3; comp.knee.value = 8; comp.attack.value = 0.003; comp.release.value = 0.18;
    var limit = A.createDynamicsCompressor();
    limit.threshold.value = -1.5; limit.ratio.value = 20; limit.knee.value = 0; limit.attack.value = 0.002; limit.release.value = 0.09;
    var silk = A.createBiquadFilter(); silk.type = "lowpass"; silk.frequency.value = 14000;
    var rev = A.createConvolver(); rev.buffer = room();
    var revG = A.createGain(); revG.gain.value = 0.5;
    var revHP = A.createBiquadFilter(); revHP.type = "highpass"; revHP.frequency.value = 160;
    revIn = A.createGain();
    revIn.connect(revHP); revHP.connect(rev); rev.connect(revG); revG.connect(mix);
    mix.connect(silk); silk.connect(master); master.connect(comp); comp.connect(limit); limit.connect(A.destination);

    // the station: air handling and a little mains hum
    var air = A.createBufferSource(); air.buffer = noiseBuf(4, true); air.loop = true;
    var airLP = A.createBiquadFilter(); airLP.type = "lowpass"; airLP.frequency.value = 340; airLP.Q.value = 0.4;
    bedG = A.createGain(); bedG.gain.value = 0;
    air.connect(airLP); airLP.connect(bedG);
    [60, 120, 180].forEach(function (f, k) {
      var o = A.createOscillator(); o.frequency.value = f;
      var g = A.createGain(); g.gain.value = [0.05, 0.035, 0.015][k];
      o.connect(g); g.connect(bedG); o.start();
    });
    bedG.connect(mix);
    air.start();

    var s0 = A.createBufferSource(); s0.buffer = A.createBuffer(1, 1, SR); s0.connect(A.destination); s0.start(0);
    ready = true;
  }

  function live() { return ready && on && A && A.state === "running"; }

  function chain(pan, send) {
    var g = A.createGain();
    if (A.createStereoPanner) { var p = A.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan || 0)); g.connect(p); p.connect(mix); }
    else g.connect(mix);
    if (send) { var s = A.createGain(); s.gain.value = send; g.connect(s); s.connect(revIn); }
    return g;
  }
  function drop(n, s) { setTimeout(function () { try { n.disconnect(); } catch (e) {} }, s * 1000); }

  /* A contact: a noise burst through resonant bandpasses at the object's own
   * modes. ⚠ Burst length sets the LEVEL, and each mode needs sqrt(Q) makeup,
   * or the whole thing measures near silence. */
  function modal(freqs, decays, amp, pan, send, burstMs, when) {
    var t = A.currentTime + (when || 0), out = chain(pan, send);
    out.gain.value = amp;
    var src = A.createBufferSource(); src.buffer = noiseBuf((burstMs || 8) / 1000, false);
    for (var k = 0; k < freqs.length; k++) {
      var Q = 10 + k * 5;
      var bp = A.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = Math.min(16000, freqs[k]); bp.Q.value = Q;
      var g = A.createGain();
      g.gain.setValueAtTime(Math.sqrt(Q) * (k ? 0.6 / (0.7 + k * 0.45) : 1), t);
      g.gain.exponentialRampToValueAtTime(1e-4, t + decays[Math.min(k, decays.length - 1)]);
      src.connect(bp); bp.connect(g); g.connect(out);
    }
    src.start(t);
    drop(out, (when || 0) + Math.max.apply(null, decays) + 0.4);
  }

  function tack(amp, pan, lp, when, len) {
    var t = A.currentTime + (when || 0), out = chain(pan, 0.12);
    out.gain.value = amp;
    var n = A.createBufferSource(); n.buffer = noiseBuf(0.012, false);
    var f = A.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = lp || 9000; f.Q.value = 0.6;
    var g = A.createGain(); g.gain.setValueAtTime(1, t); g.gain.exponentialRampToValueAtTime(1e-4, t + (len || 0.03));
    n.connect(f); f.connect(g); g.connect(out); n.start(t);
    drop(out, (when || 0) + 0.3);
  }

  function thump(f0, amp, pan, dur, when) {
    var t = A.currentTime + (when || 0), out = chain(pan, 0.12);
    out.gain.value = amp;
    var o = A.createOscillator(); o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f0 * 0.55, t + dur);
    var g = A.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(1, t + 0.005); g.gain.exponentialRampToValueAtTime(1e-4, t + dur);
    o.connect(g); g.connect(out); o.start(t); o.stop(t + dur + 0.05);
    drop(out, (when || 0) + dur + 0.3);
  }

  function hiss(amp, pan, dur, hp, lp, when, att) {
    var t = A.currentTime + (when || 0), out = chain(pan, 0.3);
    out.gain.value = amp;
    var n = A.createBufferSource(); n.buffer = noiseBuf(1.5, false);
    var h = A.createBiquadFilter(); h.type = "highpass"; h.frequency.value = hp; h.Q.value = 0.5;
    var l = A.createBiquadFilter(); l.type = "lowpass"; l.frequency.value = lp; l.Q.value = 0.5;
    var g = A.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(1, t + (att || 0.02)); g.gain.exponentialRampToValueAtTime(1e-4, t + dur);
    n.connect(h); h.connect(l); l.connect(g); g.connect(out);
    n.start(t, Math.random() * 0.8); n.stop(t + dur + 0.05);
    drop(out, (when || 0) + dur + 0.3);
  }

  // a console chime: a clean tone with one quiet overtone and a soft edge
  function chime(f, amp, pan, dur, when) {
    var t = A.currentTime + (when || 0), out = chain(pan, 0.45);
    out.gain.value = amp;
    [[1, 0.7], [2, 0.12], [3.01, 0.05], [1.0015, 0.2]].forEach(function (p) {
      var o = A.createOscillator(); o.frequency.value = f * p[0];
      var g = A.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(p[1], t + 0.008);
      g.gain.exponentialRampToValueAtTime(1e-4, t + dur);
      o.connect(g); g.connect(out); o.start(t); o.stop(t + dur + 0.05);
    });
    drop(out, (when || 0) + dur + 0.4);
  }

  /* ------------------------------------------------------------- voices */

  // mass is cells (1 to 4): deeper and longer, never a different tune
  function weight(mass) { return 1 - Math.min(3, mass - 1) * 0.055; }

  // one cell of a drag: the module's mag pads skating over the deck plates.
  // Quiet, a little different every time, and throttled so a fast drag is a
  // run of ticks rather than a buzz
  var lastStep = 0;
  function step(mass, pan) {
    if (!live()) return;
    var t = A.currentTime;
    if (t - lastStep < 0.035) return;
    lastStep = t;
    var w = weight(mass) * (0.96 + Math.random() * 0.08);
    modal([310 * w, 702 * w, 1490 * w], [0.05, 0.035, 0.02], 0.11, pan, 0.12, 5);
    tack(0.06, pan, 4200 + Math.random() * 1500, 0, 0.012);
    hiss(0.03 + mass * 0.004, pan, 0.07, 1600, 6000, 0, 0.004);
  }

  // up against a module or the hull: the contact, felt through the deck
  function knock(mass, otherMass, pan) {
    if (!live()) return;
    var w = weight(mass), v = 0.95;
    modal([92 * w, 171 * w, 263 * w, 397 * w], [0.3, 0.24, 0.16, 0.11], 0.1 * v * (0.8 + mass * 0.08), pan, 0.3, 14);
    thump(130 * w, 0.16 * v * (0.75 + mass * 0.1), pan, 0.1 + mass * 0.015);
    tack(0.08 * v, pan, 8000, 0, 0.01);
    if (otherMass) {
      var w2 = weight(otherMass);
      // the other one's hollow container knock
      modal([212 * w2, 468 * w2, 862 * w2, 1340 * w2], [0.14, 0.09, 0.06, 0.045], 0.1 * v, pan, 0.28, 10);
    }
  }

  // let go: the mag clamps lock it to the deck where it is
  function clamp(mass, strength, pan) {
    if (!live()) return;
    var w = weight(mass), v = 0.35 + strength * 0.65;
    modal([1180 * w, 2730 * w, 4310 * w], [0.06, 0.04, 0.03], 0.13 * v, pan, 0.2, 6);
    modal([150 * w, 310 * w, 520 * w], [0.18, 0.12, 0.08], 0.13 * v, pan, 0.25, 12, 0.008);
    thump(120 * w, 0.18 * v, pan, 0.09);
    tack(0.1 * v, pan, 8500, 0.004);
  }

  function grab(pan, mass) {
    if (!live()) return;
    var w = weight(mass || 2);
    // the clamps letting go, and a breath of gas as it lifts
    modal([1650 * w, 3900 * w], [0.03, 0.02], 0.065, pan, 0.1, 4);
    thump(170 * w, 0.08, pan, 0.05);
    hiss(0.04, pan, 0.1, 1800, 7000, 0, 0.01);
  }
  function tick() { if (live()) tack(0.03, 0, 6000); }
  // pressed into its own airlock, but too wide for it: the lock refuses
  function deny(pan) {
    if (!live()) return;
    thump(150, 0.08, pan, 0.07);
    chime(392, 0.06, pan, 0.16);
    chime(311.13, 0.06, pan, 0.22, 0.09);
  }

  function airlock(pan) {
    if (!live()) return;
    // servo: two short pulls of a geared motor, felt more than heard
    [0, 0.09].forEach(function (w) {
      var t = A.currentTime + w, out = chain(pan, 0.2); out.gain.value = 0.045;
      var o = A.createOscillator(); o.type = "triangle"; o.frequency.setValueAtTime(240, t); o.frequency.linearRampToValueAtTime(300, t + 0.07);
      var lp = A.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 1800;
      var g = A.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(1, t + 0.01); g.gain.exponentialRampToValueAtTime(1e-4, t + 0.08);
      o.connect(lp); lp.connect(g); g.connect(out); o.start(t); o.stop(t + 0.1);
      drop(out, w + 0.4);
    });
    // the inner door cracks: pressure equalising
    hiss(0.14, pan, 0.42, 1800, 9000, 0.05, 0.03);
    // the outer door seals behind it, a heavy latch
    modal([150, 380, 940], [0.3, 0.18, 0.1], 0.14, pan, 0.4, 14, 0.38);
    thump(96, 0.16, pan, 0.2, 0.38);
  }

  var outCount = 0;
  function jettison(n, pan) {
    if (!live()) return;
    outCount = n;
    chime(pent(n - 1), 0.11, pan, 0.9, 0.42);
  }

  function clear(nGates) {
    if (!live()) return;
    for (var k = 0; k < Math.max(3, nGates); k++) chime(pent(4 + k * 2), 0.12, (k % 2 ? 0.4 : -0.4), 1.2, 0.08 + k * 0.12);
    chime(pent(9), 0.11, 0, 2, 0.08 + Math.max(3, nGates) * 0.12 + 0.05);
    thump(70, 0.16, 0, 0.6, 0.05);
  }

  function undo() { if (live()) { hiss(0.04, 0, 0.08, 2500, 7000, 0, 0.004); tack(0.03, 0, 4000, 0.02); } }
  function restart() { if (live()) { hiss(0.06, 0, 0.3, 1200, 6000, 0, 0.05); chime(pent(0), 0.05, 0, 0.4, 0.1); } }
  function hint() { if (live()) { chime(pent(7), 0.085, 0, 0.5); chime(pent(9), 0.07, 0, 0.6, 0.09); } }

  window.JettisonAudio = {
    init: function (v) { on = v; },
    unlock: function () { build(); if (A && A.state === "suspended") A.resume(); },
    toggle: function () { on = !on; if (master) master.gain.setTargetAtTime(on ? 1 : 0, A.currentTime, 0.02); return on; },
    start: function () { if (ready && bedG) bedG.gain.setTargetAtTime(on ? 0.035 : 0, A.currentTime, 0.8); },
    step: step, knock: knock, drop: clamp, grab: grab, tick: tick, deny: deny,
    airlock: airlock, jettison: jettison, clear: clear,
    undo: undo, restart: restart, hint: hint
  };
})();
