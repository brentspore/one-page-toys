/* Meld — sound. Everything is synthesised; there are no samples.
 *
 * A glass studio: a low furnace roar under everything, glass knocking on
 * glass, and the melt.
 *   - CONTACTS are modal: a short noise burst through resonant bandpasses at a
 *     glass ball's own modes, a lowpassed tack in front (what says two solid
 *     things touched), and for the big orbs a low thump. Size changes the pitch
 *     only a little (about a fourth across all eleven); size lives in the
 *     WEIGHT, the thump and the length. An orb hitting the jar also rings the
 *     jar, faintly: the sound of being inside a glass vessel.
 *   - A MELD is heat and a bell: a lowpassed noise "fwoomp" as the glass goes
 *     soft, then an additive glass bell (inharmonic, wine-glass ratios), then
 *     a few annealing ticks as the new orb cools. Chains climb a major
 *     pentatonic, one step per link, so a cascade plays a rising run.
 *   - A SUN is a chord and a swell; two suns burning out is a bright cluster
 *     over a low boom. Overflow cracks the jar.
 *
 * House bar: stereo by position in the jar, a convolver room, one shared
 * echo loop for the bells, a glue compressor and a brickwall after it, iOS
 * unlock, one mute gain. Levels measured with an analyser before destination.
 */
(function () {
  "use strict";

  var A = null, mix = null, master = null, revIn = null, echoIn = null;
  var bedGain = null, bedLP = null;
  var on = true, ready = false;
  var noiseCache = {};
  var nextPulse = 0, chainRoot = 0;

  // E major pentatonic up from E5
  var PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26, 28];
  function pent(step) { return 659.25 * Math.pow(2, PENTA[Math.max(0, Math.min(PENTA.length - 1, step))] / 12); }

  function ir(sec, decay) {
    var rate = A.sampleRate, len = Math.floor(rate * sec), buf = A.createBuffer(2, len, rate);
    for (var ch = 0; ch < 2; ch++) {
      var d = buf.getChannelData(ch), lp = 0;
      for (var i = 0; i < len; i++) {
        // low-passed noise, so the tail is smooth rather than grainy
        lp += ((Math.random() * 2 - 1) - lp) * 0.42;
        d[i] = lp * Math.pow(1 - i / len, decay) * (i < rate * 0.008 ? i / (rate * 0.008) : 1);
      }
    }
    return buf;
  }

  // Short white bursts come from a pool of eight per length, picked at random:
  // one cached burst made every hit identical, and since a narrow resonator
  // hears only part of a burst's spectrum, a session's whole contact level
  // depended on which single burst it happened to draw (measured: 0.26 one
  // session, 0.33 the next, same settings).
  function noiseBuf(sec, brown) {
    var key = sec + (brown ? "b" : "w" + (sec <= 0.5 ? Math.floor(Math.random() * 8) : ""));
    if (noiseCache[key]) return noiseCache[key];
    var len = Math.max(1, Math.ceil(A.sampleRate * sec));
    var buf = A.createBuffer(1, len, A.sampleRate), d = buf.getChannelData(0), last = 0;
    for (var i = 0; i < len; i++) {
      var w = Math.random() * 2 - 1;
      if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.2; }
      else d[i] = w;
    }
    if (sec <= 0.5 || brown) noiseCache[key] = buf;
    return buf;
  }

  function build() {
    if (ready) return;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try { A = new AC(); } catch (e) { return; }
    mix = A.createGain();
    master = A.createGain(); master.gain.value = on ? 1 : 0;

    var comp = A.createDynamicsCompressor();
    comp.threshold.value = -12; comp.ratio.value = 3; comp.knee.value = 8;
    comp.attack.value = 0.004; comp.release.value = 0.2;
    var limit = A.createDynamicsCompressor();
    limit.threshold.value = -1.5; limit.ratio.value = 20; limit.knee.value = 0;
    limit.attack.value = 0.002; limit.release.value = 0.09;
    var silk = A.createBiquadFilter(); silk.type = "lowpass"; silk.frequency.value = 13000;

    // the studio: a hard-walled room, bright, about two seconds
    var rev = A.createConvolver(); rev.buffer = ir(2.3, 2.4);
    var revG = A.createGain(); revG.gain.value = 0.7;
    var revHP = A.createBiquadFilter(); revHP.type = "highpass"; revHP.frequency.value = 260;
    var revLP = A.createBiquadFilter(); revLP.type = "lowpass"; revLP.frequency.value = 8500;
    var shelf = A.createBiquadFilter(); shelf.type = "highshelf"; shelf.frequency.value = 5000; shelf.gain.value = 3;
    revIn = A.createGain();
    revIn.connect(revHP); revHP.connect(revLP); revLP.connect(rev); rev.connect(shelf); shelf.connect(revG); revG.connect(mix);

    // one shared ping-pong for the bells, so a chain blooms into the room
    echoIn = A.createGain();
    var dl = A.createDelay(1), dr = A.createDelay(1);
    dl.delayTime.value = 0.19; dr.delayTime.value = 0.27;
    var fb = A.createGain(); fb.gain.value = 0.24;
    var elp = A.createBiquadFilter(); elp.type = "lowpass"; elp.frequency.value = 4200;
    var eo = A.createGain(); eo.gain.value = 0.42;
    var merger = A.createChannelMerger(2);
    echoIn.connect(dl); dl.connect(elp); elp.connect(dr); dr.connect(fb); fb.connect(dl);
    dl.connect(merger, 0, 0); dr.connect(merger, 0, 1);
    merger.connect(eo); eo.connect(mix); eo.connect(revIn);

    mix.connect(silk); silk.connect(master); master.connect(comp); comp.connect(limit); limit.connect(A.destination);

    // the furnace bed, quiet until the jar heats up
    var bed = A.createBufferSource(); bed.buffer = noiseBuf(4, true); bed.loop = true;
    bedLP = A.createBiquadFilter(); bedLP.type = "lowpass"; bedLP.frequency.value = 260; bedLP.Q.value = 0.5;
    bedGain = A.createGain(); bedGain.gain.value = 0;
    bed.connect(bedLP); bedLP.connect(bedGain); bedGain.connect(mix);
    bed.start();

    var s0 = A.createBufferSource();        // iOS unlock: one silent sample on the first gesture
    s0.buffer = A.createBuffer(1, 1, A.sampleRate);
    s0.connect(A.destination); s0.start(0);
    ready = true;
  }

  function live() { return ready && on && A && A.state === "running"; }

  function chain(pan, send, echo) {
    var g = A.createGain();
    if (A.createStereoPanner) {
      var pn = A.createStereoPanner();
      pn.pan.value = Math.max(-1, Math.min(1, pan || 0));
      g.connect(pn); pn.connect(mix);
    } else g.connect(mix);
    if (send) { var sg = A.createGain(); sg.gain.value = send; g.connect(sg); sg.connect(revIn); }
    if (echo) { var eg = A.createGain(); eg.gain.value = echo; g.connect(eg); eg.connect(echoIn); }
    return g;
  }

  function drop(node, ms) { setTimeout(function () { try { node.disconnect(); } catch (e) {} }, ms); }

  /* A contact. ⚠ The burst length sets the LEVEL (a 2ms click cannot push
   * energy into a narrow resonator) and each mode needs a sqrt(Q) makeup. */
  function modal(freqs, amp, pan, decay, send, burstMs, when) {
    var t = A.currentTime + (when || 0), out = chain(pan, send || 0.22);
    out.gain.value = amp;
    var burst = A.createBufferSource(); burst.buffer = noiseBuf((burstMs || 8) / 1000, false);
    for (var k = 0; k < freqs.length; k++) {
      var Q = 14 + k * 6;
      var bp = A.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = Math.min(17000, freqs[k]); bp.Q.value = Q;
      var g = A.createGain();
      g.gain.setValueAtTime(Math.sqrt(Q) * (k ? 0.55 / (0.7 + k * 0.5) : 1), t);
      g.gain.exponentialRampToValueAtTime(1e-4, t + decay / (1 + k * 0.7));
      burst.connect(bp); bp.connect(g); g.connect(out);
    }
    burst.start(t);
    drop(out, ((when || 0) + decay + 0.4) * 1000);
    return out;
  }

  function tack(amp, pan, lp, when) {
    var t = A.currentTime + (when || 0), out = chain(pan, 0.12);
    out.gain.value = amp;
    var n = A.createBufferSource(); n.buffer = noiseBuf(0.012, false);
    var f = A.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = lp || 8500; f.Q.value = 0.6;
    var g = A.createGain();
    g.gain.setValueAtTime(1, t); g.gain.exponentialRampToValueAtTime(1e-4, t + 0.028);
    n.connect(f); f.connect(g); g.connect(out); n.start(t);
    drop(out, ((when || 0) + 0.3) * 1000);
  }

  function thump(f0, amp, pan, dur, when) {
    var t = A.currentTime + (when || 0), out = chain(pan, 0.1);
    out.gain.value = amp;
    var o = A.createOscillator(); o.type = "sine";
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f0 * 0.5, t + dur);
    var g = A.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(1, t + 0.004);
    g.gain.exponentialRampToValueAtTime(1e-4, t + dur);
    o.connect(g); g.connect(out); o.start(t); o.stop(t + dur + 0.05);
    drop(out, ((when || 0) + dur + 0.3) * 1000);
  }

  /* Bells are additive, never modal: a long tail through narrow filters loses
   * its level. Wine-glass partials, the higher ones dying faster. */
  var GP = [1, 2.32, 4.25, 6.63];
  var GG = [0.56, 0.2, 0.1, 0.05];
  function bell(freq, amp, pan, dur, when, body) {
    var t = A.currentTime + (when || 0), out = chain(pan, 0.55, 0.16);
    out.gain.value = amp;
    var det = 1 + (Math.random() - 0.5) * 0.003;
    for (var k = 0; k < GP.length; k++) {
      var o = A.createOscillator(); o.type = "sine";
      o.frequency.value = freq * GP[k] * det;
      var g = A.createGain(), d = dur / (1 + k * 0.8);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(GG[k], t + 0.006);
      g.gain.exponentialRampToValueAtTime(1e-4, t + d);
      o.connect(g); g.connect(out); o.start(t); o.stop(t + d + 0.05);
    }
    // a +3 cent ghost for shimmer
    var o2 = A.createOscillator(); o2.type = "sine"; o2.frequency.value = freq * 1.0017;
    var g2 = A.createGain();
    g2.gain.setValueAtTime(0, t); g2.gain.linearRampToValueAtTime(0.16, t + 0.01);
    g2.gain.exponentialRampToValueAtTime(1e-4, t + dur * 0.8);
    o2.connect(g2); g2.connect(out); o2.start(t); o2.stop(t + dur);
    // the bigger the orb, the more body under the bell
    if (body) {
      var o3 = A.createOscillator(); o3.type = "sine"; o3.frequency.value = freq * 0.5;
      var g3 = A.createGain();
      g3.gain.setValueAtTime(0, t); g3.gain.linearRampToValueAtTime(body, t + 0.02);
      g3.gain.exponentialRampToValueAtTime(1e-4, t + dur * 0.7);
      o3.connect(g3); g3.connect(out); o3.start(t); o3.stop(t + dur);
    }
    // the strike
    var st = A.createBufferSource(); st.buffer = noiseBuf(0.012, false);
    var sb = A.createBiquadFilter(); sb.type = "bandpass"; sb.frequency.value = Math.min(12000, freq * 4); sb.Q.value = 1.2;
    var sg = A.createGain();
    sg.gain.setValueAtTime(0.32, t); sg.gain.exponentialRampToValueAtTime(1e-4, t + 0.025);
    st.connect(sb); sb.connect(sg); sg.connect(out); st.start(t);
    drop(out, ((when || 0) + dur + 0.6) * 1000);
  }

  // the glass going soft: a wide LOWPASS opening on noise (never a resonant
  // band gliding up, which is the most synthetic sound there is)
  function fwoomp(amp, pan, dur, top, when) {
    var t = A.currentTime + (when || 0), out = chain(pan, 0.35);
    out.gain.value = amp;
    var n = A.createBufferSource(); n.buffer = noiseBuf(1.5, true);
    var f = A.createBiquadFilter(); f.type = "lowpass"; f.Q.value = 0.4;
    f.frequency.setValueAtTime(220, t);
    f.frequency.exponentialRampToValueAtTime(top, t + dur * 0.18);
    f.frequency.exponentialRampToValueAtTime(320, t + dur);
    var g = A.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(1, t + dur * 0.12);
    g.gain.exponentialRampToValueAtTime(1e-4, t + dur);
    n.connect(f); f.connect(g); g.connect(out);
    n.start(t, Math.random() * 2); n.stop(t + dur + 0.05);
    drop(out, ((when || 0) + dur + 0.4) * 1000);
  }

  // the new orb cooling: a few tiny ticks of annealing stress
  function ticks(n, amp, pan, when) {
    for (var i = 0; i < n; i++) {
      var w = (when || 0) + 0.18 + Math.random() * 0.75;
      var f = 4200 + Math.random() * 5200;
      modal([f, f * 2.7], amp * (0.5 + Math.random() * 0.5), pan + (Math.random() - 0.5) * 0.4, 0.05, 0.3, 3, w);
    }
  }

  /* ------------------------------------------------------------- voices */

  // glass knocking on glass; a = -1 means the jar itself
  function hit(a, b, v, pan) {
    if (!live()) return;
    var size = a < 0 ? b : Math.max(a, b);
    var f = 1.15 - size * 0.03;          // a fourth, all the way from Seed to Sun
    var amp = 0.27 * v;
    modal([2650 * f, 6180 * f, 10200 * f], amp, pan, 0.07 + size * 0.006, 0.2, 9);
    tack(amp * 0.55, pan, 8500);
    // weight is in the thump, not the pitch
    if (size >= 4) thump(150 - size * 6, amp * (0.2 + (size - 4) * 0.045), pan, 0.08 + size * 0.006);
    if (a < 0) modal([612, 1460, 2710], amp * 0.38, pan, 0.32, 0.3, 14);   // the jar rings
  }

  function dropVoice(tier, pan) {
    if (!live()) return;
    modal([5200, 11200], 0.06, pan, 0.03, 0.15, 4);
    tack(0.05, pan, 4000);
  }

  function merge(tier, n, pan) {
    if (!live()) return;
    var w = tier / 10;
    if (n <= 1) chainRoot = Math.floor(Math.random() * 3);
    var step = chainRoot + n - 1;
    fwoomp(0.23 + w * 0.1, pan, 0.32 + w * 0.3, 1500 + w * 2200);
    bell(pent(step), 0.17 + w * 0.03, pan, 1.1 + w * 1.4, 0.03, tier >= 5 ? 0.1 + (tier - 5) * 0.02 : 0);
    if (tier >= 6) thump(110 - tier * 4, 0.1 + w * 0.06, pan, 0.22 + w * 0.2, 0.01);
    ticks(2 + Math.floor(tier / 3), 0.05, pan, 0.05);
  }

  function sun(pan) {
    if (!live()) return;
    var root = 329.63;   // E4
    [1, 1.5, 2, 2.52].forEach(function (r, i) {
      bell(root * r, 0.12, pan + (i - 1.5) * 0.25, 3.2, 0.05 + i * 0.07, i === 0 ? 0.2 : 0);
    });
    fwoomp(0.42, pan, 1.6, 2600, 0);
    thump(82, 0.32, pan, 1.4, 0.02);
  }

  function nova(pan) {
    if (!live()) return;
    [2, 3, 4, 6, 8].forEach(function (r, i) {
      bell(329.63 * r, 0.09, (i - 2) * 0.35, 2.4, 0.03 + i * 0.05, 0);
    });
    fwoomp(0.6, 0, 2.2, 5200, 0);
    thump(64, 0.5, 0, 1.6, 0);
  }

  function discover(tier) {
    if (!live()) return;
    bell(pent(7), 0.1, -0.3, 1.6, 0.35, 0);
    bell(pent(10), 0.1, 0.3, 1.8, 0.5, 0);
  }

  // the jar overflowing: a crack running through it, then glass settling
  function overflow() {
    if (!live()) return;
    for (var i = 0; i < 9; i++) {
      var w = i * 0.018 + Math.random() * 0.012;
      var f = 2200 + Math.random() * 6000;
      modal([f, f * 1.9, f * 3.1], 0.2 * (1 - i / 12), (Math.random() - 0.5) * 0.8, 0.05, 0.35, 5, w);
    }
    tack(0.4, 0, 2400);
    thump(120, 0.3, 0, 0.25, 0.01);
    modal([612, 1460, 2710], 0.16, 0, 0.6, 0.5, 18, 0.02);
    for (var k = 0; k < 4; k++) {
      var f2 = 3000 + Math.random() * 4000;
      modal([f2, f2 * 2.4], 0.07, (Math.random() - 0.5), 0.12, 0.5, 4, 0.35 + k * 0.11 + Math.random() * 0.08);
    }
  }

  // heat rising: the furnace swells and a slow pulse quickens toward overflow
  var lastLevel = 0;
  function danger(level) {
    if (!ready || !A) return;
    var t = A.currentTime;
    if (Math.abs(level - lastLevel) > 0.01 || (level === 0 && lastLevel !== 0)) {
      bedGain.gain.setTargetAtTime(on ? 0.05 + level * 0.14 : 0, t, 0.15);
      bedLP.frequency.setTargetAtTime(260 + level * 900, t, 0.2);
      lastLevel = level;
    }
    if (level > 0.05 && live()) {
      if (t >= nextPulse) {
        var rate = 1.4 + level * 4.5;
        thump(72, 0.1 + level * 0.1, 0, 0.12);
        tack(0.04 + level * 0.04, 0, 900);
        nextPulse = t + 1 / rate;
      }
    } else nextPulse = 0;
  }

  /* --------------------------------------------------------------- api */

  window.MeldAudio = {
    init: function (v) { on = v; },
    unlock: function () {
      build();
      if (A && A.state === "suspended") A.resume();
    },
    toggle: function () {
      on = !on;
      if (master) master.gain.setTargetAtTime(on ? 1 : 0, A.currentTime, 0.02);
      if (!on && bedGain) bedGain.gain.setTargetAtTime(0, A.currentTime, 0.05);
      return on;
    },
    start: function () {
      if (!ready) return;
      bedGain.gain.setTargetAtTime(on ? 0.05 : 0, A.currentTime, 0.4);
    },
    stop: function () {
      if (!ready) return;
      bedGain.gain.setTargetAtTime(0, A.currentTime, 0.8);
      lastLevel = -1;
    },
    hit: hit, drop: dropVoice, merge: merge, sun: sun, nova: nova,
    discover: discover, overflow: overflow,
    danger: function (level) { if (level || lastLevel > 0) danger(level); }
  };
})();
