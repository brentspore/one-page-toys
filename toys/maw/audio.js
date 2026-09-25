/* Maw — sound. Everything is synthesised; there are no samples.
 *
 * The well is a body, so the bed is a body: a heartbeat that quickens as the
 * pressure builds, slow breathing air, and the odd gurgle deep in the reverb.
 * On top of that, three families:
 *   - YOURS: a soft wet spit and a glassy ping that falls away down the well.
 *   - THEIRS: modal contacts (chitin cracking, a shell clicking on the rim) and
 *     a chitter whose rate and pitch rise as the nearest thing climbs. That
 *     chitter is the whole point on a small screen: you HEAR a threat nearing
 *     the rim, panned to where it is, before you have found it.
 *   - REWARD: every kill rings a bell tuned to a minor pentatonic, one step
 *     higher per hit in your streak, so a clean run plays a rising line.
 *
 * House bar: layered voices, stereo by lane position, a convolver cavern, one
 * shared echo loop (never one per shot — a feedback delay keeps itself alive),
 * a glue compressor and a brickwall after it, iOS unlock, one mute gain.
 * Levels were measured with an analyser spliced in front of the destination.
 */
(function () {
  "use strict";

  var A = null, mix = null, master = null, revIn = null, echoIn = null, sat = null;
  var on = true, ready = false, bed = null;
  var noiseCache = {};

  // D minor pentatonic, from D5 up two and a bit octaves
  var PENTA = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22, 24, 27, 29, 31, 34, 36];
  function note(step) { return 587.33 * Math.pow(2, PENTA[Math.max(0, Math.min(PENTA.length - 1, step))] / 12); }

  function ir(sec, decay) {
    var rate = A.sampleRate, len = Math.floor(rate * sec), buf = A.createBuffer(2, len, rate);
    for (var ch = 0; ch < 2; ch++) {
      var d = buf.getChannelData(ch), lp = 0;
      for (var i = 0; i < len; i++) {
        // low-passed noise, so the tail is smooth rather than grainy
        lp += ((Math.random() * 2 - 1) - lp) * 0.3;
        d[i] = lp * Math.pow(1 - i / len, decay) * (i < rate * 0.012 ? i / (rate * 0.012) : 1);
      }
    }
    return buf;
  }

  function noiseBuf(sec, brown) {
    var key = sec + (brown ? "b" : "w");
    if (noiseCache[key]) return noiseCache[key];
    var len = Math.max(1, Math.ceil(A.sampleRate * sec));
    var buf = A.createBuffer(1, len, A.sampleRate), d = buf.getChannelData(0), last = 0;
    for (var i = 0; i < len; i++) {
      var w = Math.random() * 2 - 1;
      if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.2; }
      else d[i] = w;
    }
    // cache the short ones only; they are rebuilt a lot and never need to differ
    if (sec <= 0.5) noiseCache[key] = buf;
    return buf;
  }

  function build() {
    if (ready) return;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try { A = new AC(); } catch (e) { return; }
    mix = A.createGain();
    master = A.createGain(); master.gain.value = on ? 1 : 0;

    // glue, not a limiter...
    var comp = A.createDynamicsCompressor();
    comp.threshold.value = -12; comp.ratio.value = 3; comp.knee.value = 8;
    comp.attack.value = 0.005; comp.release.value = 0.2;
    // ...and the brickwall that actually stops a flare cascade clipping
    var limit = A.createDynamicsCompressor();
    limit.threshold.value = -1.5; limit.ratio.value = 20; limit.knee.value = 0;
    limit.attack.value = 0.002; limit.release.value = 0.09;
    var silk = A.createBiquadFilter(); silk.type = "lowpass"; silk.frequency.value = 11000;

    // The cavern: long, dark, no grain. Highpassed on the way in so the
    // heartbeat does not turn the tail to mud; a shelf adds wet shimmer.
    var rev = A.createConvolver(); rev.buffer = ir(3.4, 2.6);
    var revG = A.createGain(); revG.gain.value = 0.85;
    var revHP = A.createBiquadFilter(); revHP.type = "highpass"; revHP.frequency.value = 220;
    var revLP = A.createBiquadFilter(); revLP.type = "lowpass"; revLP.frequency.value = 6500;
    var shelf = A.createBiquadFilter(); shelf.type = "highshelf"; shelf.frequency.value = 4000; shelf.gain.value = 3;
    revIn = A.createGain();
    revIn.connect(revHP); revHP.connect(revLP); revLP.connect(rev); rev.connect(shelf); shelf.connect(revG); revG.connect(mix);

    /* The well echo: sound going DOWN a shaft comes back up it, late and dark.
     * One shared ping-pong loop for the whole session. */
    echoIn = A.createGain();
    var dl = A.createDelay(1), dr = A.createDelay(1);
    dl.delayTime.value = 0.21; dr.delayTime.value = 0.29;
    var fb = A.createGain(); fb.gain.value = 0.34;
    var elp = A.createBiquadFilter(); elp.type = "lowpass"; elp.frequency.value = 2200;
    var eo = A.createGain(); eo.gain.value = 0.5;
    var merger = A.createChannelMerger(2);
    echoIn.connect(dl); dl.connect(elp); elp.connect(dr); dr.connect(fb); fb.connect(dl);
    dl.connect(merger, 0, 0); dr.connect(merger, 0, 1);
    merger.connect(eo); eo.connect(mix); eo.connect(revIn);

    mix.connect(silk); silk.connect(master); master.connect(comp); comp.connect(limit); limit.connect(A.destination);

    sat = new Float32Array(1024);
    for (var si = 0; si < 1024; si++) {
      var xx = si / 511.5 - 1;
      sat[si] = Math.tanh(xx * 2.6) / Math.tanh(2.6);
    }

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

  function later(fn, ms) { setTimeout(fn, ms); }
  function drop(node, ms) { later(function () { try { node.disconnect(); } catch (e) {} }, ms); }

  /* A contact: a short noise burst through parallel resonant bandpasses at the
   * object's own inharmonic modes. ⚠ The burst length sets the LEVEL (a 2ms
   * click cannot push energy into a narrow resonator), and each mode gets a
   * sqrt(Q) makeup, or the whole thing measures near silence. */
  function modal(freqs, amp, pan, decay, send, burstMs) {
    var t = A.currentTime, out = chain(pan, send || 0.25);
    out.gain.value = amp;
    var burst = A.createBufferSource(); burst.buffer = noiseBuf((burstMs || 9) / 1000, false);
    freqs.forEach(function (f, k) {
      var Q = 9 + k * 5;
      var bp = A.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = Math.min(18000, f); bp.Q.value = Q;
      var g = A.createGain();
      g.gain.setValueAtTime(Math.sqrt(Q) * (k ? 0.5 / (0.6 + k * 0.5) : 1), t);
      g.gain.exponentialRampToValueAtTime(1e-4, t + decay / (1 + k * 0.6));
      burst.connect(bp); bp.connect(g); g.connect(out);
    });
    // what says "two solid things touched" is the broadband contact before the ring
    var tack = A.createBufferSource(); tack.buffer = noiseBuf(0.012, false);
    var lp = A.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 8000; lp.Q.value = 0.6;
    var tg = A.createGain();
    tg.gain.setValueAtTime(0.55, t); tg.gain.exponentialRampToValueAtTime(1e-4, t + 0.035);
    tack.connect(lp); lp.connect(tg); tg.connect(out);
    burst.start(t); tack.start(t);
    drop(out, (decay + 0.5) * 1000);
  }

  /* Bells are additive, never modal: a long tail through narrow filters loses
   * its level. Inharmonic stack, higher partials dying faster, plus a strike. */
  var PART = [1, 2, 3.01, 4.17, 5.43];
  var PG = [0.5, 0.21, 0.14, 0.09, 0.06];
  function bell(freq, amp, pan, dur, send, when) {
    var t = A.currentTime + (when || 0), out = chain(pan, send === undefined ? 0.7 : send, 0.12);
    out.gain.value = amp;
    var det = 1 + (Math.random() - 0.5) * 0.004;
    PART.forEach(function (r, k) {
      var o = A.createOscillator(); o.type = "sine";
      o.frequency.value = freq * r * det;
      var g = A.createGain(), d = dur / (1 + k * 0.7);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(PG[k], t + 0.003);
      g.gain.exponentialRampToValueAtTime(1e-4, t + d);
      o.connect(g); g.connect(out); o.start(t); o.stop(t + d + 0.05);
    });
    // a +4 cent ghost for shimmer
    var o2 = A.createOscillator(); o2.type = "sine"; o2.frequency.value = freq * 1.0023;
    var g2 = A.createGain();
    g2.gain.setValueAtTime(0, t); g2.gain.linearRampToValueAtTime(0.18, t + 0.004);
    g2.gain.exponentialRampToValueAtTime(1e-4, t + dur * 0.8);
    o2.connect(g2); g2.connect(out); o2.start(t); o2.stop(t + dur);
    var st = A.createBufferSource(); st.buffer = noiseBuf(0.01, false);
    var sb = A.createBiquadFilter(); sb.type = "bandpass"; sb.frequency.value = Math.min(12000, freq * 4); sb.Q.value = 1.4;
    var sg = A.createGain();
    sg.gain.setValueAtTime(0.35, t); sg.gain.exponentialRampToValueAtTime(1e-4, t + 0.02);
    st.connect(sb); sb.connect(sg); sg.connect(out); st.start(t);
    drop(out, ((when || 0) + dur + 0.8) * 1000);
  }

  /* A wet bloop: the sound of a bubble closing — a sine RISING fast from f0,
   * which is physically what a collapsing cavity does. */
  function bloop(f0, amp, pan, send, when) {
    var t = A.currentTime + (when || 0), out = chain(pan, send === undefined ? 0.8 : send);
    out.gain.value = amp;
    var o = A.createOscillator(); o.type = "sine";
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f0 * 2.3, t + 0.05);
    var g = A.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(1, t + 0.004);
    g.gain.exponentialRampToValueAtTime(1e-4, t + 0.07);
    o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.09);
    drop(out, ((when || 0) + 0.6) * 1000);
  }

  // A soft-clipped strip for low-end that has to survive a phone speaker.
  function driven(out, amount) {
    var drive = A.createGain(); drive.gain.value = amount || 1.6;
    var sh = A.createWaveShaper(); sh.curve = sat; sh.oversample = "2x";
    drive.connect(sh); sh.connect(out);
    return drive;
  }

  /* ------------------------------------------------------------ the bed */

  function startBed() {
    if (!ready || bed) return;
    var t = A.currentTime;
    // breathing air: brown noise with a lowpass that inhales and exhales
    var src = A.createBufferSource(); src.buffer = noiseBuf(4, true); src.loop = true;
    var lp = A.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 300; lp.Q.value = 0.7;
    var lfo = A.createOscillator(); lfo.type = "sine"; lfo.frequency.value = 0.12;
    var lfoG = A.createGain(); lfoG.gain.value = 170;
    lfo.connect(lfoG); lfoG.connect(lp.frequency);
    var g = A.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.09, t + 2.5);
    var amp = A.createGain(); amp.gain.value = 1;
    var alfo = A.createGain(); alfo.gain.value = 0.35;
    lfo.connect(alfo); alfo.connect(amp.gain);
    src.connect(lp); lp.connect(amp); amp.connect(g); g.connect(mix);
    var send = A.createGain(); send.gain.value = 0.25; g.connect(send); send.connect(revIn);
    src.start(t); lfo.start(t);
    bed = { src: src, lfo: lfo, g: g, lp: lp, next: performance.now() + 2500, groan: performance.now() + 14000 };
  }

  function stopBed() {
    if (!bed) return;
    var b = bed; bed = null;
    b.g.gain.setTargetAtTime(0, A.currentTime, 0.4);
    later(function () { try { b.src.stop(); b.lfo.stop(); } catch (e) {} }, 2000);
  }

  // called every frame: the occasional gurgle, and a distant groan now and then
  function tickBed(pressure) {
    if (!bed || !live()) return;
    var now = performance.now();
    bed.lp.frequency.setTargetAtTime(280 + pressure * 260, A.currentTime, 0.5);
    if (now > bed.next) {
      bed.next = now + 2200 + Math.random() * 4200;
      var n = 1 + Math.floor(Math.random() * 3), pan = Math.random() * 1.6 - 0.8, f = 220 + Math.random() * 380;
      for (var i = 0; i < n; i++) bloop(f * (0.85 + Math.random() * 0.4), 0.05, pan, 1.2, i * (0.05 + Math.random() * 0.09));
    }
    if (now > bed.groan) {
      bed.groan = now + 22000 + Math.random() * 16000;
      groan();
    }
  }

  // something very large, very far down: noise through two gliding formants
  function groan() {
    var t = A.currentTime, out = chain((Math.random() - 0.5) * 0.8, 1.4);
    out.gain.value = 0.16;
    var src = A.createBufferSource(); src.buffer = noiseBuf(4, true);
    var f0 = 150 + Math.random() * 60;
    [[1, 9, 1], [2.6, 7, 0.5], [4.4, 6, 0.25]].forEach(function (fm) {
      var bp = A.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = fm[1];
      bp.frequency.setValueAtTime(f0 * fm[0], t);
      bp.frequency.linearRampToValueAtTime(f0 * fm[0] * 1.12, t + 1.2);
      bp.frequency.exponentialRampToValueAtTime(f0 * fm[0] * 0.72, t + 3.6);
      var g = A.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(Math.sqrt(fm[1]) * fm[2], t + 1.1);
      g.gain.exponentialRampToValueAtTime(1e-4, t + 3.8);
      src.connect(bp); bp.connect(g); g.connect(out);
    });
    src.start(t); src.stop(t + 4);
    drop(out, 6000);
  }

  /* ------------------------------------------------------------ voices */

  var api = {
    unlock: function () { build(); if (A && A.state === "suspended") { try { A.resume(); } catch (e) {} } },
    init: function (v) { on = v; },
    isOn: function () { return on; },
    toggle: function () {
      on = !on;
      if (master) master.gain.setTargetAtTime(on ? 1 : 0, A.currentTime, 0.02);
      return on;
    },
    suspend: function () { if (A && A.state === "running") { try { A.suspend(); } catch (e) {} } },
    resume: function () { if (A && A.state === "suspended") { try { A.resume(); } catch (e) {} } },
    startBed: startBed,
    stopBed: stopBed,
    tickBed: tickBed,

    /* The heartbeat, heard from inside: a resonant low thump through the soft
     * clipper (so a phone speaker still gets harmonics it can play), a body
     * glide under it, and a faint wet valve click. The second beat is shorter
     * and a little higher, which is what makes it read as lub-dub, not a kick. */
    heart: function (dub, amp) {
      if (!live()) return;
      var t = A.currentTime, out = chain(0, 0.12);
      out.gain.value = amp * 0.6;
      var drv = driven(out, 1.5);
      var nb = A.createBufferSource(); nb.buffer = noiseBuf(0.3, true);
      var lp = A.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = dub ? 150 : 115; lp.Q.value = 2.4;
      var ng = A.createGain();
      ng.gain.setValueAtTime(0.0001, t);
      ng.gain.exponentialRampToValueAtTime(3.4, t + 0.008);
      ng.gain.exponentialRampToValueAtTime(1e-4, t + (dub ? 0.12 : 0.19));
      nb.connect(lp); lp.connect(ng); ng.connect(drv);
      nb.start(t); nb.stop(t + 0.3);
      var o = A.createOscillator(); o.type = "sine";
      o.frequency.setValueAtTime(dub ? 82 : 64, t);
      o.frequency.exponentialRampToValueAtTime(dub ? 56 : 44, t + 0.14);
      var og = A.createGain();
      og.gain.setValueAtTime(0.0001, t);
      og.gain.exponentialRampToValueAtTime(0.9, t + 0.01);
      og.gain.exponentialRampToValueAtTime(1e-4, t + (dub ? 0.14 : 0.22));
      o.connect(og); og.connect(drv); o.start(t); o.stop(t + 0.26);
      drop(out, 900);
    },

    /* One grain of chitter. The game calls this at a rate that rises as the
     * nearest creature climbs, and passes how close it is, so pitch rises too. */
    chitter: function (pan, close) {
      if (!live()) return;
      var t = A.currentTime, out = chain(pan, 0.12);
      out.gain.value = 0.04 + close * 0.16;
      var f = 1500 + close * 2900;
      for (var i = 0; i < 2; i++) {
        var tt = t + i * (0.011 + Math.random() * 0.006);
        var b = A.createBufferSource(); b.buffer = noiseBuf(0.005, false);
        var bp = A.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = f * (i ? 1.13 : 1); bp.Q.value = 7;
        var g = A.createGain();
        g.gain.setValueAtTime(Math.sqrt(7) * (i ? 0.6 : 1), tt);
        g.gain.exponentialRampToValueAtTime(1e-4, tt + 0.03);
        b.connect(bp); bp.connect(g); g.connect(out); b.start(tt);
      }
      drop(out, 400);
    },

    /* Yours: a soft wet spit and a small glass ping that drops a little in pitch
     * as it falls away from you, sent into the well echo so it comes back up. */
    shot: function (pan, pierce) {
      if (!live()) return;
      var t = A.currentTime, out = chain(pan * 0.6, 0.12, 0.3);
      out.gain.value = pierce ? 0.16 : 0.13;
      var n = A.createBufferSource(); n.buffer = noiseBuf(0.04, false);
      var bp = A.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 1700; bp.Q.value = 1.1;
      var ng = A.createGain();
      ng.gain.setValueAtTime(0.0001, t);
      ng.gain.exponentialRampToValueAtTime(0.9, t + 0.003);
      ng.gain.exponentialRampToValueAtTime(1e-4, t + 0.035);
      n.connect(bp); bp.connect(ng); ng.connect(out); n.start(t);
      var f = (pierce ? 2093 : 1568) * (0.985 + Math.random() * 0.03);
      [[1, 1, 0.16], [2.76, 0.28, 0.07], [pierce ? 1.5 : 5.4, pierce ? 0.5 : 0.1, 0.05]].forEach(function (p) {
        var o = A.createOscillator(); o.type = "sine";
        o.frequency.setValueAtTime(f * p[0], t);
        o.frequency.exponentialRampToValueAtTime(f * p[0] * 0.93, t + p[2]);
        var g = A.createGain();
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(p[1], t + 0.004);
        g.gain.exponentialRampToValueAtTime(1e-4, t + p[2]);
        o.connect(g); g.connect(out); o.start(t); o.stop(t + p[2] + 0.02);
      });
      drop(out, 500);
    },

    /* A kill. Every one gets the squelch (a lowpass CLOSING over noise — bright
     * to dark is what a splat is) and the streak bell; shelled things also crack. */
    kill: function (kind, pan, step, big) {
      if (!live()) return;
      var t = A.currentTime, out = chain(pan, 0.35);
      out.gain.value = 0.22;
      var n = A.createBufferSource(); n.buffer = noiseBuf(0.16, false);
      var lp = A.createBiquadFilter(); lp.type = "lowpass"; lp.Q.value = 1.2;
      lp.frequency.setValueAtTime(big ? 3800 : 5200, t);
      lp.frequency.exponentialRampToValueAtTime(big ? 180 : 320, t + (big ? 0.2 : 0.09));
      var ng = A.createGain();
      ng.gain.setValueAtTime(0.0001, t);
      ng.gain.exponentialRampToValueAtTime(big ? 1.0 : 0.9, t + 0.004);
      ng.gain.exponentialRampToValueAtTime(1e-4, t + (big ? 0.24 : 0.11));
      n.connect(lp); lp.connect(ng); ng.connect(out); n.start(t); n.stop(t + 0.3);
      if (kind === "skitter" || kind === "spitter" || kind === "weaver") {
        var f0 = kind === "weaver" ? 1300 : kind === "spitter" ? 720 : 980;
        f0 *= 0.94 + Math.random() * 0.12;
        modal([f0, f0 * 2.31, f0 * 3.93, f0 * 5.72], 0.16, pan, 0.16, 0.2, 10);
      }
      if (big) {
        var sub = A.createOscillator(); sub.type = "sine";
        sub.frequency.setValueAtTime(120, t); sub.frequency.exponentialRampToValueAtTime(48, t + 0.3);
        var sg = A.createGain();
        sg.gain.setValueAtTime(0.0001, t); sg.gain.exponentialRampToValueAtTime(0.5, t + 0.01);
        sg.gain.exponentialRampToValueAtTime(1e-4, t + 0.34);
        var dv = driven(out, 1.4); sub.connect(sg); sg.connect(dv); sub.start(t); sub.stop(t + 0.4);
        bloop(260, 0.12, pan, 0.9, 0.03); bloop(340, 0.09, -pan * 0.5, 0.9, 0.08);
      }
      bell(note(step), 0.075, pan, 1.1, 0.8);
      drop(out, 900);
    },

    // a shot eating into silk: a dry tick and a thread snapping
    chip: function (pan) {
      if (!live()) return;
      var t = A.currentTime, out = chain(pan, 0.2);
      out.gain.value = 0.1;
      var o = A.createOscillator(); o.type = "triangle";
      o.frequency.setValueAtTime(1900, t); o.frequency.exponentialRampToValueAtTime(700, t + 0.05);
      var g = A.createGain();
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.8, t + 0.002);
      g.gain.exponentialRampToValueAtTime(1e-4, t + 0.07);
      o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.09);
      modal([3100, 5200], 0.08, pan, 0.05, 0.1, 5);
      drop(out, 500);
    },

    // a globule hawked up the lane at you
    spit: function (pan) {
      if (!live()) return;
      var t = A.currentTime, out = chain(pan, 0.4);
      out.gain.value = 0.2;
      var n = A.createBufferSource(); n.buffer = noiseBuf(0.2, false);
      var lp = A.createBiquadFilter(); lp.type = "lowpass"; lp.Q.value = 0.8;
      lp.frequency.setValueAtTime(500, t);
      lp.frequency.exponentialRampToValueAtTime(2600, t + 0.04);
      lp.frequency.exponentialRampToValueAtTime(400, t + 0.16);
      var g = A.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.8, t + 0.02);
      g.gain.exponentialRampToValueAtTime(1e-4, t + 0.17);
      n.connect(lp); lp.connect(g); g.connect(out); n.start(t); n.stop(t + 0.2);
      var o = A.createOscillator(); o.type = "sine";
      o.frequency.setValueAtTime(210, t); o.frequency.exponentialRampToValueAtTime(130, t + 0.12);
      var og = A.createGain();
      og.gain.setValueAtTime(0.0001, t); og.gain.exponentialRampToValueAtTime(0.7, t + 0.01);
      og.gain.exponentialRampToValueAtTime(1e-4, t + 0.15);
      o.connect(og); og.connect(out); o.start(t); o.stop(t + 0.18);
      bloop(300, 0.3, pan, 0.6, 0.06);
      drop(out, 700);
    },

    // a globule shot out of the air
    pop: function (pan) {
      if (!live()) return;
      bloop(520 + Math.random() * 120, 0.16, pan, 0.6);
      modal([2400, 3900], 0.06, pan, 0.05, 0.2, 6);
    },

    // a crawler stepping along the lip: three quick shell ticks
    rimHop: function (pan) {
      if (!live()) return;
      for (var i = 0; i < 3; i++) {
        (function (i) {
          later(function () { if (live()) modal([2300 + i * 180, 4100 + i * 200], 0.22, pan, 0.05, 0.15, 8); }, i * 34);
        })(i);
      }
    },

    // it is in your lane and about to bite
    bite: function (pan) {
      if (!live()) return;
      var t = A.currentTime, out = chain(pan, 0.2);
      out.gain.value = 0.12;
      var n = A.createBufferSource(); n.buffer = noiseBuf(0.3, false);
      var hp = A.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 2600;
      var lp = A.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 9000;
      var g = A.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(1, t + 0.2);
      g.gain.exponentialRampToValueAtTime(1e-4, t + 0.28);
      n.connect(hp); hp.connect(lp); lp.connect(g); g.connect(out); n.start(t); n.stop(t + 0.3);
      drop(out, 700);
    },

    // taken: a crunch, a gulp, and the long drag down
    grab: function (pan) {
      if (!live()) return;
      modal([170, 395, 760, 1210], 0.28, pan, 0.5, 0.4, 16);
      var t = A.currentTime, out = chain(pan * 0.5, 0.7);
      out.gain.value = 0.2;
      var dv = driven(out, 1.7);
      var o = A.createOscillator(); o.type = "sine";
      o.frequency.setValueAtTime(130, t + 0.05); o.frequency.exponentialRampToValueAtTime(36, t + 0.7);
      var og = A.createGain();
      og.gain.setValueAtTime(0.0001, t); og.gain.exponentialRampToValueAtTime(0.9, t + 0.06);
      og.gain.exponentialRampToValueAtTime(1e-4, t + 0.8);
      o.connect(og); og.connect(dv); o.start(t); o.stop(t + 0.85);
      var n = A.createBufferSource(); n.buffer = noiseBuf(1.3, false);
      var lp = A.createBiquadFilter(); lp.type = "lowpass"; lp.Q.value = 0.9;
      lp.frequency.setValueAtTime(2600, t); lp.frequency.exponentialRampToValueAtTime(140, t + 1.1);
      var ng = A.createGain();
      ng.gain.setValueAtTime(0.0001, t); ng.gain.exponentialRampToValueAtTime(0.55, t + 0.08);
      ng.gain.exponentialRampToValueAtTime(1e-4, t + 1.2);
      n.connect(lp); lp.connect(ng); ng.connect(out); n.start(t); n.stop(t + 1.3);
      bloop(180, 0.2, pan, 1, 0.25); bloop(140, 0.15, pan, 1, 0.42);
      drop(out, 2400);
    },

    /* The flare: a deep bloom of pressure, then light — a slow-swelling chord
     * of bells in the cavern. A weak one is the same gesture, smaller. */
    flare: function (weak) {
      if (!live()) return;
      var t = A.currentTime, out = chain(0, 0.9);
      out.gain.value = weak ? 0.11 : 0.17;
      var dv = driven(out, 1.5);
      var o = A.createOscillator(); o.type = "sine";
      o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(30, t + 1.1);
      var og = A.createGain();
      og.gain.setValueAtTime(0.0001, t); og.gain.exponentialRampToValueAtTime(1, t + 0.02);
      og.gain.exponentialRampToValueAtTime(1e-4, t + 1.2);
      o.connect(og); og.connect(dv); o.start(t); o.stop(t + 1.3);
      var n = A.createBufferSource(); n.buffer = noiseBuf(1.2, false);
      var lp = A.createBiquadFilter(); lp.type = "lowpass"; lp.Q.value = 0.7;
      lp.frequency.setValueAtTime(260, t); lp.frequency.exponentialRampToValueAtTime(7000, t + 0.28);
      lp.frequency.exponentialRampToValueAtTime(300, t + 1.1);
      var ng = A.createGain();
      ng.gain.setValueAtTime(0.0001, t); ng.gain.exponentialRampToValueAtTime(0.7, t + 0.2);
      ng.gain.exponentialRampToValueAtTime(1e-4, t + 1.15);
      n.connect(lp); lp.connect(ng); ng.connect(out); n.start(t); n.stop(t + 1.2);
      var chord = weak ? [0, 7] : [0, 7, 12, 15, 19, 24];
      chord.forEach(function (s, i) {
        var f = 293.66 * Math.pow(2, s / 12), c = chain((i - chord.length / 2) * 0.25, 1.1);
        c.gain.value = weak ? 0.035 : 0.035;
        var ov = A.createOscillator(); ov.type = "sine"; ov.frequency.value = f;
        var vib = A.createOscillator(); vib.frequency.value = 4.5 + i * 0.3;
        var vg = A.createGain(); vg.gain.value = f * 0.004;
        vib.connect(vg); vg.connect(ov.frequency);
        var g = A.createGain();
        g.gain.setValueAtTime(0, t + 0.05);
        g.gain.linearRampToValueAtTime(1, t + 0.18 + i * 0.03);
        g.gain.exponentialRampToValueAtTime(1e-4, t + (weak ? 1.4 : 3.2));
        ov.connect(g); g.connect(c); ov.start(t); vib.start(t);
        ov.stop(t + 3.4); vib.stop(t + 3.4);
        drop(c, 4200);
      });
      drop(out, 1800);
    },

    /* The dive: wind rushing past as you fall down the throat, climbing in
     * pitch with speed. Returns nothing — it runs for `dur` seconds. */
    dive: function (dur) {
      if (!live()) return;
      var t = A.currentTime, out = chain(0, 0.5);
      out.gain.value = 0.2;
      var n = A.createBufferSource(); n.buffer = noiseBuf(dur + 0.5, false);
      var bp = A.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = 0.7;
      bp.frequency.setValueAtTime(220, t);
      bp.frequency.exponentialRampToValueAtTime(2600, t + dur);
      var g = A.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(1, t + dur * 0.85);
      g.gain.exponentialRampToValueAtTime(1e-4, t + dur + 0.12);
      n.connect(bp); bp.connect(g); g.connect(out); n.start(t); n.stop(t + dur + 0.3);
      var r = A.createBufferSource(); r.buffer = noiseBuf(dur + 0.5, true);
      var rl = A.createBiquadFilter(); rl.type = "lowpass"; rl.frequency.value = 160;
      var rg = A.createGain();
      rg.gain.setValueAtTime(0.0001, t); rg.gain.exponentialRampToValueAtTime(1.2, t + dur * 0.7);
      rg.gain.exponentialRampToValueAtTime(1e-4, t + dur + 0.1);
      r.connect(rl); rl.connect(rg); rg.connect(out); r.start(t); r.stop(t + dur + 0.3);
      drop(out, (dur + 1) * 1000);
    },

    // through the throat and out into the next well: a plunge and a bloom
    plunge: function () {
      if (!live()) return;
      var t = A.currentTime, out = chain(0, 1);
      out.gain.value = 0.13;
      var n = A.createBufferSource(); n.buffer = noiseBuf(1.4, false);
      var lp = A.createBiquadFilter(); lp.type = "lowpass";
      lp.frequency.setValueAtTime(5000, t); lp.frequency.exponentialRampToValueAtTime(200, t + 1.1);
      var g = A.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.9, t + 0.01);
      g.gain.exponentialRampToValueAtTime(1e-4, t + 1.2);
      n.connect(lp); lp.connect(g); g.connect(out); n.start(t); n.stop(t + 1.3);
      bloop(160, 0.2, 0, 1.2, 0.05);
      drop(out, 2000);
    },

    // the ribs lighting one by one around the new well: a spread arpeggio
    levelIn: function (pans) {
      if (!live()) return;
      var steps = [0, 2, 4, 5, 7, 9, 10, 12];
      pans.forEach(function (p, i) {
        bell(note(steps[i % steps.length]), 0.055, p, 0.9, 0.9, 0.2 + i * 0.045);
      });
    },

    cleared: function () {
      if (!live()) return;
      [0, 2, 4, 5, 7].forEach(function (s, i) { bell(note(s + 2), 0.09, (i - 2) * 0.3, 1.6, 0.8, i * 0.07); });
    },

    pearl: function (pan) {
      if (!live()) return;
      [7, 9, 12, 14].forEach(function (s, i) { bell(note(s), 0.08, pan + (i - 1.5) * 0.15, 1.4, 0.9, i * 0.05); });
    },

    extraLife: function () {
      if (!live()) return;
      [0, 5, 7, 10, 12].forEach(function (s, i) { bell(note(s), 0.1, (i - 2) * 0.35, 2, 0.9, i * 0.09); });
    },

    challenge: function () {
      if (!live()) return;
      [0, 3, 5, 7, 10, 12, 15].forEach(function (s, i) { bell(note(s), 0.09, (i - 3) * 0.25, 1.8, 0.9, i * 0.06); });
    },

    /* Swallowed. The heart stops, the maw gulps, and one low bell rings in the
     * dark after it. */
    gameOver: function () {
      if (!live()) return;
      var t = A.currentTime, out = chain(0, 1);
      out.gain.value = 0.15;
      var dv = driven(out, 1.6);
      var o = A.createOscillator(); o.type = "sine";
      o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(30, t + 1.4);
      var og = A.createGain();
      og.gain.setValueAtTime(0.0001, t); og.gain.exponentialRampToValueAtTime(1, t + 0.05);
      og.gain.exponentialRampToValueAtTime(1e-4, t + 1.5);
      o.connect(og); og.connect(dv); o.start(t); o.stop(t + 1.6);
      bloop(120, 0.22, 0, 1.4, 0.1);
      groan();
      bell(146.83, 0.12, 0, 4.5, 1.2, 1.4);
      drop(out, 3000);
    }
  };

  window.MAW_AUDIO = api;
})();
