/* Decant — sound. Everything is synthesized; there are no samples.
 *
 * Pouring is the instrument here, so it is modeled from what actually makes
 * the sound:
 *   - The receiving bottle is a pipe closed at the bottom: its air column
 *     resonates at about c / 4L. As it fills, L shortens and the pitch RISES
 *     (roughly 590Hz empty to 2.4kHz near full, for a bottle this size). That
 *     rising whistle under the stream is what makes filling sound like filling.
 *   - The stream itself is broadband turbulence, a little unsteady.
 *   - The bottle being emptied GLUGS: air gulps back in through the neck as
 *     bubbles, each a short chirp that rises as it forms (a Minnaert bubble).
 *   - Glass on a wooden shelf: the wood's low modes plus a short glass ring.
 *     Two bottles touching (a pour that cannot happen) is a bright glass clink.
 *   - A finished bottle is corked: a rubbing squeak, a hollow "thoonk", and a
 *     glass chime that climbs a pentatonic ladder through the level.
 *   - Under it all, the room: a low hush and the odd candle crackle.
 *
 * House bar: modal contacts with sqrt(Q) makeup, pooled noise bursts, stereo
 * by position, a small wooden room, glue compressor then brickwall, iOS
 * unlock, one mute. Levels are measured with an analyser in front of the
 * destination.
 */
(function () {
  "use strict";

  var A = null, SR = 48000, mix = null, master = null, revIn = null, bedG = null;
  var on = true, ready = false, crackleT = null;
  var noise = {};

  var PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26, 28, 31];
  function pent(step) { return 587.33 * Math.pow(2, PENTA[Math.max(0, Math.min(PENTA.length - 1, step))] / 12); }   // D major pentatonic from D5

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

  // a small room of wood and plaster: early reflections, a warm, short tail
  function room() {
    var len = Math.ceil(SR * 1.2), b = A.createBuffer(2, len, SR);
    for (var ch = 0; ch < 2; ch++) {
      var d = b.getChannelData(ch), lp = 0;
      for (var e = 0; e < 7; e++) {
        var at = Math.floor(SR * (0.005 + Math.random() * 0.025)), amp = (0.45 - e * 0.05) * (Math.random() < 0.5 ? -1 : 1);
        for (var k = 0; k < 6; k++) d[at + k] += amp * (1 - k / 6);
      }
      for (var i = Math.floor(SR * 0.01); i < len; i++) {
        var t = i / SR, cut = 0.42 - 0.32 * Math.min(1, t / 0.8);
        lp += ((Math.random() * 2 - 1) - lp) * cut;
        d[i] += lp * Math.exp(-6.9 * t / 1.0) * 0.45;
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
    comp.threshold.value = -10; comp.ratio.value = 3; comp.knee.value = 8; comp.attack.value = 0.003; comp.release.value = 0.2;
    var limit = A.createDynamicsCompressor();
    limit.threshold.value = -1.5; limit.ratio.value = 20; limit.knee.value = 0; limit.attack.value = 0.002; limit.release.value = 0.09;
    var silk = A.createBiquadFilter(); silk.type = "lowpass"; silk.frequency.value = 13000;
    var rev = A.createConvolver(); rev.buffer = room();
    var revG = A.createGain(); revG.gain.value = 0.55;
    var revHP = A.createBiquadFilter(); revHP.type = "highpass"; revHP.frequency.value = 180;
    revIn = A.createGain();
    revIn.connect(revHP); revHP.connect(rev); rev.connect(revG); revG.connect(mix);
    mix.connect(silk); silk.connect(master); master.connect(comp); comp.connect(limit); limit.connect(A.destination);

    // the room's hush
    var air = A.createBufferSource(); air.buffer = noiseBuf(4, true); air.loop = true;
    var airLP = A.createBiquadFilter(); airLP.type = "lowpass"; airLP.frequency.value = 260; airLP.Q.value = 0.4;
    bedG = A.createGain(); bedG.gain.value = 0;
    air.connect(airLP); airLP.connect(bedG); bedG.connect(mix);
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
  function later(n, s) { setTimeout(function () { try { n.disconnect(); } catch (e) {} }, s * 1000); }

  /* A contact: a noise burst through resonant bandpasses at the object's own
   * modes. Burst length sets the LEVEL, and each mode needs sqrt(Q) makeup. */
  function modal(freqs, decays, amp, pan, send, burstMs, when) {
    var t = A.currentTime + (when || 0), out = chain(pan, send);
    out.gain.value = amp;
    var src = A.createBufferSource(); src.buffer = noiseBuf((burstMs || 8) / 1000, false);
    for (var k = 0; k < freqs.length; k++) {
      var Q = 12 + k * 6;
      var bp = A.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = Math.min(16000, freqs[k]); bp.Q.value = Q;
      var g = A.createGain();
      g.gain.setValueAtTime(Math.sqrt(Q) * (k ? 0.6 / (0.7 + k * 0.45) : 1), t);
      g.gain.exponentialRampToValueAtTime(1e-4, t + decays[Math.min(k, decays.length - 1)]);
      src.connect(bp); bp.connect(g); g.connect(out);
    }
    src.start(t);
    later(out, (when || 0) + Math.max.apply(null, decays) + 0.4);
  }

  // the broadband contact before any ring: what says two hard things touched
  function tack(amp, pan, lp, when, len) {
    var t = A.currentTime + (when || 0), out = chain(pan, 0.12);
    out.gain.value = amp;
    var n = A.createBufferSource(); n.buffer = noiseBuf(0.012, false);
    var f = A.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = lp || 8000; f.Q.value = 0.6;
    var g = A.createGain(); g.gain.setValueAtTime(1, t); g.gain.exponentialRampToValueAtTime(1e-4, t + (len || 0.025));
    n.connect(f); f.connect(g); g.connect(out); n.start(t);
    later(out, (when || 0) + 0.3);
  }

  function thump(f0, f1, amp, pan, dur, when) {
    var t = A.currentTime + (when || 0), out = chain(pan, 0.15);
    out.gain.value = amp;
    var o = A.createOscillator(); o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    var g = A.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(1, t + 0.004); g.gain.exponentialRampToValueAtTime(1e-4, t + dur);
    o.connect(g); g.connect(out); o.start(t); o.stop(t + dur + 0.05);
    later(out, (when || 0) + dur + 0.3);
  }

  // a glass chime: additive, with a whisper of a detuned twin for life
  function chime(f, amp, pan, dur, when) {
    var t = A.currentTime + (when || 0), out = chain(pan, 0.5);
    out.gain.value = amp;
    [[1, 0.62], [1.0021, 0.22], [2.01, 0.12], [3.02, 0.05], [4.17, 0.03]].forEach(function (p, k) {
      var o = A.createOscillator(); o.frequency.value = f * p[0];
      var g = A.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(p[1], t + 0.006);
      g.gain.exponentialRampToValueAtTime(1e-4, t + dur / (1 + k * 0.6));
      o.connect(g); g.connect(out); o.start(t); o.stop(t + dur + 0.05);
    });
    later(out, (when || 0) + dur + 0.5);
  }

  // one air bubble gulping into a bottle: a chirp that rises as it forms
  function bubble(f, amp, pan, when) {
    var t = A.currentTime + (when || 0), out = chain(pan, 0.2);
    out.gain.value = amp;
    var o = A.createOscillator(); o.type = "sine";
    o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 1.45, t + 0.035);
    var g = A.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(1, t + 0.003); g.gain.exponentialRampToValueAtTime(1e-4, t + 0.055);
    o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.08);
    later(out, (when || 0) + 0.4);
  }

  // the pitch of a bottle's air column at a given fill (0 empty .. 1 full)
  function column(fill) { return 343 / (4 * (0.035 + (1 - Math.max(0, Math.min(0.97, fill))) * 0.11)); }

  /* ------------------------------------------------------------ voices */

  // fromPan: the bottle being emptied; toPan: the one filling. fill0/fill1 are
  // the receiving bottle's fill before and after, 0..1.
  function pour(fromPan, toPan, dur, fill0, fill1) {
    if (!live()) return;
    var t = A.currentTime + 0.02;
    // the stream: unsteady turbulence
    var src = A.createBufferSource(); src.buffer = noiseBuf(1.5, false); src.loop = true;
    var bp = A.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 1500; bp.Q.value = 0.7;
    var lp = A.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 5200;
    var g = A.createGain(), out = chain(toPan, 0.25); out.gain.value = 0.22;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.7, t + 0.05);
    for (var k = 1; k < 10; k++) g.gain.linearRampToValueAtTime(0.5 + Math.random() * 0.45, t + dur * k / 10);
    g.gain.linearRampToValueAtTime(0, t + dur + 0.07);
    src.connect(bp); bp.connect(lp); lp.connect(g); g.connect(out);
    // the receiving bottle's air column, rising as it fills
    var Q = 9, rbp = A.createBiquadFilter(); rbp.type = "bandpass"; rbp.Q.value = Q;
    rbp.frequency.setValueAtTime(column(fill0), t);
    rbp.frequency.exponentialRampToValueAtTime(column(fill1), t + dur);
    var rg = A.createGain();
    rg.gain.setValueAtTime(0, t); rg.gain.linearRampToValueAtTime(Math.sqrt(Q) * 0.55, t + 0.08);
    rg.gain.setValueAtTime(Math.sqrt(Q) * 0.55, t + dur); rg.gain.linearRampToValueAtTime(0, t + dur + 0.1);
    src.connect(rbp); rbp.connect(rg); rg.connect(out);
    src.start(t); src.stop(t + dur + 0.2);
    later(out, dur + 0.8);
    // the emptying bottle glugs
    var n = Math.max(2, Math.round(dur / 0.085));
    for (var b = 0; b < n; b++) {
      var w = 0.04 + b * (dur * 0.9) / n + (Math.random() - 0.5) * 0.02;
      bubble(330 + Math.random() * 170 + b * 6, 0.06 + Math.random() * 0.04, fromPan, w);
    }
    // the first of the stream landing
    tack(0.05, toPan, 3500, 0.03, 0.03);
  }

  function lift(pan) {
    if (!live()) return;
    tack(0.06, pan, 6000);
    modal([2700, 5900], [0.08, 0.05], 0.05, pan, 0.15, 4);
  }

  // glass set down on a wooden shelf
  function setDown(pan, weight) {
    if (!live()) return;
    var w = 0.6 + 0.4 * (weight || 0.5);
    modal([170, 390, 840], [0.13, 0.09, 0.06], 0.12 * w, pan, 0.25, 12);
    modal([2600, 5600, 8300], [0.16, 0.09, 0.05], 0.06 * w, pan, 0.25, 4, 0.004);
    tack(0.08 * w, pan, 6500);
  }

  // two bottles touching: a pour that cannot happen
  function clink(pan) {
    if (!live()) return;
    [0, 0.07].forEach(function (d, k) {
      var f = 1 + (Math.random() - 0.5) * 0.04;
      modal([1900 * f, 4300 * f, 7100 * f, 9800 * f], [0.32, 0.2, 0.13, 0.08], k ? 0.15 : 0.21, pan, 0.3, 5, d);
      tack(k ? 0.05 : 0.07, pan, 9000, d, 0.012);
    });
  }

  // a finished bottle is corked; step climbs through the level
  function cork(pan, step) {
    if (!live()) return;
    var t = A.currentTime;
    var sq = A.createBufferSource(); sq.buffer = noiseBuf(0.09, false);
    var sbp = A.createBiquadFilter(); sbp.type = "bandpass"; sbp.Q.value = 7;
    sbp.frequency.setValueAtTime(900, t); sbp.frequency.exponentialRampToValueAtTime(2300, t + 0.07);
    var sg = A.createGain(), sout = chain(pan, 0.15); sout.gain.value = 0.12;
    sg.gain.setValueAtTime(0, t); sg.gain.linearRampToValueAtTime(Math.sqrt(7), t + 0.01); sg.gain.exponentialRampToValueAtTime(1e-3, t + 0.08);
    sq.connect(sbp); sbp.connect(sg); sg.connect(sout); sq.start(t);
    later(sout, 0.5);
    thump(240, 120, 0.22, pan, 0.11, 0.07);
    tack(0.07, pan, 2500, 0.07, 0.02);
    chime(pent(step), 0.1, pan, 1.3, 0.12);
  }

  // a clouded layer clears
  function reveal(pan) {
    if (!live()) return;
    var t = A.currentTime;
    var n = A.createBufferSource(); n.buffer = noiseBuf(0.5, false);
    var f = A.createBiquadFilter(); f.type = "bandpass"; f.Q.value = 2;
    f.frequency.setValueAtTime(5200, t); f.frequency.exponentialRampToValueAtTime(1800, t + 0.35);
    var g = A.createGain(), out = chain(pan, 0.4); out.gain.value = 0.05;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(1, t + 0.06); g.gain.exponentialRampToValueAtTime(1e-3, t + 0.4);
    n.connect(f); f.connect(g); g.connect(out); n.start(t);
    later(out, 0.8);
    [9, 11, 12].forEach(function (s, k) { chime(pent(s), 0.035, pan + (k - 1) * 0.15, 0.6, 0.05 + k * 0.06); });
  }

  function clear(n) {
    if (!live()) return;
    var steps = [4, 6, 7, 9, 11, 12];
    steps.forEach(function (s, k) { chime(pent(s), 0.11, (k / (steps.length - 1)) * 1.2 - 0.6, 1.6, 0.05 + k * 0.11); });
    chime(pent(14) / 2, 0.08, 0, 2.6, 0.75);
    thump(110, 70, 0.12, 0, 0.5, 0.05);
  }

  function stuck() { if (live()) { chime(pent(2) / 2, 0.08, 0, 0.6); chime(pent(0) / 2, 0.08, 0, 0.8, 0.18); } }
  function undo() {
    if (!live()) return;
    var t = A.currentTime, n = A.createBufferSource(); n.buffer = noiseBuf(0.2, false);
    var f = A.createBiquadFilter(); f.type = "lowpass"; f.frequency.setValueAtTime(800, t); f.frequency.exponentialRampToValueAtTime(5000, t + 0.12);
    var g = A.createGain(), out = chain(0, 0.2); out.gain.value = 0.06;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(1, t + 0.1); g.gain.exponentialRampToValueAtTime(1e-3, t + 0.16);
    n.connect(f); f.connect(g); g.connect(out); n.start(t); later(out, 0.5);
    tack(0.05, 0, 6000, 0.12);
  }
  function hint() { if (live()) { chime(pent(7), 0.085, 0, 0.6); chime(pent(9), 0.07, 0, 0.7, 0.1); } }
  function spare(pan) { if (live()) { setDown(pan, 0.4); chime(pent(5), 0.06, pan, 0.8, 0.08); } }
  function tick() { if (live()) tack(0.03, 0, 6000); }

  // the odd candle crackle: sparse, quiet, random
  function crackle() {
    if (!live() || document.hidden) return;
    if (Math.random() < 0.55) {
      var pan = (Math.random() < 0.5 ? -0.7 : 0.7);
      tack(0.012 + Math.random() * 0.02, pan, 3000 + Math.random() * 4000, 0, 0.008);
      if (Math.random() < 0.3) tack(0.01, pan, 5000, 0.03 + Math.random() * 0.04, 0.006);
    }
  }

  window.DecantAudio = {
    init: function (v) { on = v; },
    unlock: function () { build(); if (A && A.state === "suspended") A.resume(); },
    toggle: function () { on = !on; if (master) master.gain.setTargetAtTime(on ? 1 : 0, A.currentTime, 0.02); return on; },
    start: function () {
      if (!ready) return;
      if (bedG) bedG.gain.setTargetAtTime(on ? 0.03 : 0, A.currentTime, 0.8);
      if (!crackleT) crackleT = setInterval(crackle, 420);
    },
    pour: pour, lift: lift, setDown: setDown, clink: clink, cork: cork, reveal: reveal,
    clear: clear, stuck: stuck, undo: undo, hint: hint, spare: spare, tick: tick
  };
})();
