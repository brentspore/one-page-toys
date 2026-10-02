/* Meld — sound. Everything is synthesised; there are no samples.
 *
 * Built from how glass actually sounds, not from chimes:
 *
 *   - A CLACK is the impact itself: a pressure pulse shaped by how long the
 *     two stay in contact, which is longer for bigger balls, so a big orb's
 *     clack is darker. Real clacks also chatter: one or two tiny re-bounces a
 *     couple of milliseconds later. Those clicks are rendered sample by sample.
 *   - Then the orbs RING. Hand-blown orbs are hollow, and a hollow glass shell
 *     rings like an ornament, lower the bigger it is, so every size has its own
 *     note: two octaves of E major pentatonic, Seed high to Sun low. Both orbs
 *     in a collision ring, so the pile plays changing chords, and every knock
 *     varies its overtones, length, shimmer and brightness.
 *   - The JAR rings when it is struck (a wall or the floor): wine-glass mode
 *     ratios on a B, each mode a slightly split pair that beats.
 *   - A pile that shifts makes a granular rustle of micro-contacts; one looping
 *     texture follows how much of the pile is moving.
 *   - A MELD is a torch puff (turbulent, several overlapping gusts, never one
 *     smooth envelope), the crystal ring of the new orb on a major pentatonic
 *     that climbs one step per link of a chain, a fall of glints like the
 *     sparks, and for the heavy orbs a settling thump.
 *   - Near overflow the jar SINGS: a rubbed-rim tone that swells, roughens and
 *     creeps sharp, with stress ticks speeding up. A sun is a glass-harmonica
 *     chord. Overflow is a real fracture: a snap, a crack running through the
 *     glass, the jar's ring choked off, a few chips settling.
 *
 * The heavy lifting (clicks, jar rings, rustle, torch puffs, furnace, room)
 * is rendered into buffers once, a piece at a time after the first tap, so a
 * hit at play time is one buffer and a filter, which a phone can do dozens of.
 * House bar: stereo by position, a room with early reflections and a tail
 * whose treble dies first, glue compressor plus brickwall, iOS unlock, one
 * mute. Levels measured with an analyser before the destination.
 */
(function () {
  "use strict";

  var A = null, SR = 48000;
  var mix = null, master = null, revIn = null, roomConv = null, furnaceG = null;
  var on = true, ready = false, rendered = false, running = false;
  var B = { click: [], jar: [], puff: [], glint: null };
  var rollG = null, rollLP = null, rollPan = null, rollSrc = null;
  var singG = null, singOsc = [], singLFO = null, singLFOg = null;
  var nextTick = 0, chainRoot = 0, lastDanger = -1;

  var RADII_R = [3.6, 4.8, 6.1, 8.0, 9.6, 11.5, 13.4, 15.6, 19.6, 23.8, 28.5];

  // E major pentatonic, from E5
  var PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26, 28, 31];
  function pent(step, base) { return (base || 659.25) * Math.pow(2, PENTA[Math.max(0, Math.min(PENTA.length - 1, step))] / 12); }
  var JAR_F = 987.77;   // B5

  /* -------------------------------------------------------------- tools */

  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // RBJ biquad, run over a buffer in place
  function filt(d, type, f, Q) {
    var w0 = 2 * Math.PI * Math.min(f, SR * 0.45) / SR, cs = Math.cos(w0), al = Math.sin(w0) / (2 * Q);
    var b0, b1, b2, a0 = 1 + al, a1 = -2 * cs, a2 = 1 - al;
    if (type === "lp") { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = b0; }
    else if (type === "hp") { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = b0; }
    else { b0 = al; b1 = 0; b2 = -al; }
    b0 /= a0; b1 /= a0; b2 /= a0; a1 /= a0; a2 /= a0;
    var x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (var i = 0; i < d.length; i++) {
      var x = d[i], y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = x; y2 = y1; y1 = y; d[i] = y;
    }
    return d;
  }

  function norm(d, peak) {
    var m = 0, i;
    for (i = 0; i < d.length; i++) { var v = Math.abs(d[i]); if (v > m) m = v; }
    if (m > 0) { var k = (peak || 1) / m; for (i = 0; i < d.length; i++) d[i] *= k; }
    return d;
  }

  // every rendered buffer is scrubbed of non-finite samples on the way out:
  // the mix is shared, so one bad sample anywhere would mute the whole toy
  function buf(chans) {
    var b = A.createBuffer(chans.length, chans[0].length, SR);
    for (var c = 0; c < chans.length; c++) {
      var d = chans[c];
      for (var i = 0; i < d.length; i++) if (!isFinite(d[i])) d[i] = 0;
      b.getChannelData(c).set(d);
    }
    return b;
  }

  // a damped sinusoid added into d, by recursion rather than Math.sin per sample
  function mode(d, start, f, decay, amp, phase) {
    var w = 2 * Math.PI * f / SR, k = Math.exp(-1 / (decay * SR));
    var c2 = 2 * Math.cos(w), y1 = Math.sin(phase || 0) * amp, y2 = Math.sin((phase || 0) - w) * amp, env = 1;
    for (var i = start; i < d.length; i++) {
      var y = c2 * y1 - y2;
      y2 = y1; y1 = y;
      d[i] += y2 * env;
      env *= k;
      if (env < 1e-5) break;
    }
  }

  /* ----------------------------------------------------------- renders */

  // The impact: a Hertz contact force f(t) = sin(pi t / tau)^1.5 radiates as
  // its derivative. tau grows with the size of the ball, which is what darkens
  // a big orb's clack. Then the chatter bounces, a highpass at the size where
  // a ball stops radiating efficiently, and a whisper of high glassy ring.
  function renderClick(k, v) {
    var r = rng(k * 131 + v * 17 + 5);
    var len = Math.ceil(SR * 0.07), d = new Float32Array(len);
    var tau = (0.085 + k * 0.034) / 1000;
    function pulse(at, amp, t) {
      var n = Math.max(2, Math.round(t * SR)), prev = 0, s = Math.round(at * SR);
      for (var i = 0; i <= n && s + i < len; i++) {
        // ⚠ (PI*i)/n can land a hair past PI, making sin a hair negative, and
        // a negative to the 1.5 is NaN. One NaN sample poisons the shared
        // compressor and silences everything until reload (it did).
        var f = Math.pow(Math.max(0, Math.sin(Math.PI * i / n)), 1.5);
        d[s + i] += (f - prev) * amp * n * 0.5;
        prev = f;
      }
    }
    pulse(0, 1, tau * (0.92 + r() * 0.16));
    pulse(0.0016 + r() * 0.0022, 0.18 + r() * 0.16, tau * 0.8);
    if (r() < 0.7) pulse(0.0048 + r() * 0.004, 0.05 + r() * 0.08, tau * 0.7);
    var a = 0.009 * RADII_R[k] / RADII_R[0];          // metres
    filt(d, "hp", 343 / (2 * Math.PI * a) * 0.7, 0.6);
    filt(d, "lp", 13000 - k * 600, 0.5);
    var fr = (9400 - k * 520) * (0.94 + r() * 0.12);
    mode(d, 0, fr, 0.012 + k * 0.002, 0.05, 0);
    mode(d, 0, fr * 1.63, 0.008 + k * 0.0015, 0.03, 0);
    return buf([norm(d, 1)]);
  }

  // The jar: wine-glass mode ratios on a B, each mode a split doublet that
  // beats, plus the thick base's dull low mode
  function renderJar(v) {
    var r = rng(900 + v * 37);
    var len = Math.ceil(SR * 1.8), d = new Float32Array(len);
    var R = [1, 2.32, 4.25, 6.63, 9.38], G = [1, 0.5, 0.3, 0.16, 0.08], D = [1.5, 0.95, 0.6, 0.38, 0.24];
    for (var m = 0; m < R.length; m++) {
      var f = JAR_F * R[m] * (1 + (r() - 0.5) * 0.004), split = 0.7 + m * 0.7 + r() * 0.8;
      mode(d, 0, f, D[m], G[m] * 0.58, 0);
      mode(d, 0, f + split, D[m] * 0.9, G[m] * 0.42, 0);
    }
    mode(d, 0, 415 * (0.97 + r() * 0.06), 0.16, 0.45, 0);
    // a soft strike in front, or the ring arrives from nowhere
    for (var i = 0; i < SR * 0.004; i++) d[i] += (r() * 2 - 1) * 0.3 * (1 - i / (SR * 0.004));
    return buf([norm(d, 1)]);
  }

  // A pile shifting: a stream of micro-contacts, dense and uneven, two
  // decorrelated channels, looped
  function renderRoll(c) {
    var len = Math.ceil(SR * 3), i;
    {
      var r = rng(700 + c * 11), d = new Float32Array(len), t = 0;
      while (t < len - 40) {
        t += Math.max(1, Math.round(-Math.log(1 - r()) * SR / 420));
        var amp = Math.pow(r(), 2.2), n = 2 + Math.floor(r() * 4), prev = 0;
        for (i = 0; i <= n && t + i < len; i++) {
          var f = Math.sin(Math.PI * i / n);
          d[t + i] += (f - prev) * amp;
          prev = f;
        }
      }
      filt(d, "hp", 900, 0.6); filt(d, "lp", 7500, 0.6);
      var lo = 0;
      for (i = 0; i < len; i++) { lo += ((r() * 2 - 1) - lo) * 0.02; d[i] += lo * 0.35; }
      // seamless loop: fold the last 50ms over the start
      var x = Math.floor(SR * 0.05);
      for (i = 0; i < x; i++) { var u = i / x; d[i] = d[i] * u + d[len - x + i] * (1 - u); }
      return norm(d.subarray(0, len - x).slice(), 0.9);
    }
  }

  // A torch puff: a turbulent cluster of overlapping gusts (one smooth
  // envelope is what makes synthesised fire sound fake), with flutter
  function renderPuff(v) {
    var len = Math.ceil(SR * 1.0), ch = [], c, i, g;
    for (c = 0; c < 2; c++) {
      var r = rng(300 + v * 23 + c * 7), d = new Float32Array(len);
      var grains = 7 + Math.floor(r() * 6);
      for (g = 0; g < grains; g++) {
        var start = Math.floor(Math.pow(r(), 1.8) * SR * 0.28), dur = SR * (0.12 + r() * 0.45);
        var co = 0.02 + r() * 0.07, lp = 0, amp = 0.4 + r() * 0.6;
        for (i = 0; i < dur && start + i < len; i++) {
          lp += ((r() * 2 - 1) - lp) * co;
          var e = i < SR * 0.025 ? i / (SR * 0.025) : Math.exp(-(i - SR * 0.025) / (dur * 0.35));
          d[start + i] += lp * e * amp;
        }
      }
      var ph = r() * 6.28, fr = 9 + r() * 7;
      for (i = 0; i < len; i++) d[i] *= 1 + 0.28 * Math.sin(ph + 2 * Math.PI * fr * i / SR);
      filt(d, "hp", 60, 0.7);
      ch.push(norm(d, 1));
    }
    return buf(ch);
  }

  // The furnace, far off: a low roar that breathes, and the odd crackle
  function renderFurnace() {
    var len = Math.ceil(SR * 6), r = rng(55), d = new Float32Array(len), lo = 0, i;
    for (i = 0; i < len; i++) {
      lo += ((r() * 2 - 1) - lo) * 0.01;
      var br = 0.75 + 0.25 * Math.sin(2 * Math.PI * 0.17 * i / SR) * Math.sin(2 * Math.PI * 0.05 * i / SR + 1);
      d[i] = lo * br;
    }
    for (var k = 0; k < 7; k++) {
      var at = Math.floor(r() * (len - SR * 0.01));
      for (i = 0; i < SR * 0.006; i++) d[at + i] += (r() * 2 - 1) * 0.08 * (1 - i / (SR * 0.006));
    }
    var x = Math.floor(SR * 0.2);
    for (i = 0; i < x; i++) { var u = i / x; d[i] = d[i] * u + d[len - x + i] * (1 - u); }
    return buf([norm(d.subarray(0, len - x).slice(), 0.8)]);
  }

  // A glint: a tiny high glass ping, pitched by playbackRate
  function renderGlint() {
    var len = Math.ceil(SR * 0.22), d = new Float32Array(len);
    mode(d, 0, 4000, 0.07, 0.8, 0);
    mode(d, 0, 4000 * 2.32, 0.03, 0.25, 0);
    for (var i = 0; i < SR * 0.0015; i++) d[i] *= i / (SR * 0.0015);
    return buf([norm(d, 1)]);
  }

  // The room: early reflections, then a diffuse tail whose treble dies
  // first, decorrelated left and right
  function renderRoom(c) {
    var len = Math.ceil(SR * 2.4);
    {
      var r = rng(40 + c * 9), d = new Float32Array(len), i;
      for (var e = 0; e < 11; e++) {
        var at = Math.floor(SR * (0.005 + Math.pow(r(), 0.8) * 0.042));
        var amp = (0.55 - e * 0.035) * (r() < 0.5 ? -1 : 1);
        for (i = 0; i < 6; i++) d[at + i] += amp * (1 - i / 6);
      }
      var bands = [[480, "lp", 2.1], [2600, "bp", 1.6], [5200, "hp", 0.75]];
      for (var b = 0; b < 3; b++) {
        var n = new Float32Array(len);
        for (i = 0; i < len; i++) n[i] = r() * 2 - 1;
        filt(n, bands[b][1], bands[b][0], 0.7);
        var T = bands[b][2], on0 = Math.floor(SR * 0.022);
        for (i = on0; i < len; i++) {
          var tt = (i - on0) / SR, fade = Math.min(1, (i - on0) / (SR * 0.03));
          d[i] += n[i] * Math.exp(-6.9 * tt / T) * fade * 0.42;
        }
      }
      return norm(d, 0.9);
    }
  }

  /* -------------------------------------------------------------- build */

  function renderAll() {
    // a piece at a time, so the first tap never stalls a frame for long
    var jobs = [function () { B.glint = renderGlint(); }];
    for (var k = 0; k < RADII_R.length; k++) {
      (function (k) { jobs.push(function () { B.click[k] = [renderClick(k, 0), renderClick(k, 1), renderClick(k, 2)]; }); })(k);
    }
    var tmp = {};
    [0, 1, 2].forEach(function (v) {
      jobs.push(function () { B.jar.push(renderJar(v)); });
      jobs.push(function () { B.puff.push(renderPuff(v)); });
    });
    jobs.push(function () { tmp.rl = renderRoll(0); });
    jobs.push(function () { startRoll(buf([tmp.rl, renderRoll(1)])); });
    jobs.push(function () { startFurnace(renderFurnace()); });
    jobs.push(function () { tmp.ml = renderRoom(0); });
    jobs.push(function () { roomConv.buffer = buf([tmp.ml, renderRoom(1)]); });
    jobs.push(function () { tmp.hl = renderHall(0); });
    jobs.push(function () { MU.hall.buffer = buf([tmp.hl, renderHall(1)]); rendered = true; });
    (function next() {
      var j = jobs.shift();
      if (!j) return;
      try { j(); } catch (e) { try { console.warn("meld audio render:", e); } catch (e2) {} }
      setTimeout(next, 0);
    })();
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
    comp.threshold.value = -10; comp.ratio.value = 3; comp.knee.value = 8;
    comp.attack.value = 0.003; comp.release.value = 0.18;
    var limit = A.createDynamicsCompressor();
    limit.threshold.value = -1.5; limit.ratio.value = 20; limit.knee.value = 0;
    limit.attack.value = 0.002; limit.release.value = 0.09;
    var silk = A.createBiquadFilter(); silk.type = "lowpass"; silk.frequency.value = 15000;

    roomConv = A.createConvolver();
    var revG = A.createGain(); revG.gain.value = 0.62;
    var revHP = A.createBiquadFilter(); revHP.type = "highpass"; revHP.frequency.value = 200;
    revIn = A.createGain();
    revIn.connect(revHP); revHP.connect(roomConv); roomConv.connect(revG); revG.connect(mix);

    mix.connect(silk); silk.connect(master); master.connect(comp); comp.connect(limit); limit.connect(A.destination);

    buildSing();
    buildMusic();

    var s0 = A.createBufferSource();        // iOS unlock: one silent sample on the first gesture
    s0.buffer = A.createBuffer(1, 1, SR);
    s0.connect(A.destination); s0.start(0);
    ready = true;
    renderAll();
  }

  function live() { return ready && on && A && A.state === "running"; }

  function chain(pan, send) {
    var g = A.createGain();
    if (A.createStereoPanner) {
      var pn = A.createStereoPanner();
      pn.pan.value = Math.max(-1, Math.min(1, pan || 0));
      g.connect(pn); pn.connect(mix);
    } else g.connect(mix);
    if (send) { var sg = A.createGain(); sg.gain.value = send; g.connect(sg); sg.connect(revIn); }
    return g;
  }
  function later(node, s) { setTimeout(function () { try { node.disconnect(); } catch (e) {} }, s * 1000); }

  function play(b, amp, pan, send, rate, when, lp) {
    if (!b) return null;
    var t = A.currentTime + (when || 0);
    var out = chain(pan, send);
    out.gain.value = amp;
    var src = A.createBufferSource(); src.buffer = b;
    src.playbackRate.value = rate || 1;
    if (lp) {
      var f = A.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = lp; f.Q.value = 0.5;
      src.connect(f); f.connect(out);
    } else src.connect(out);
    src.start(t);
    later(out, (when || 0) + b.duration / (rate || 1) + 0.3);
    return out;
  }

  function pick(arr) { return arr && arr.length ? arr[Math.floor(Math.random() * arr.length)] : null; }

  /* ------------------------------------------------------- persistent */

  function startRoll(b) {
    rollSrc = A.createBufferSource(); rollSrc.buffer = b; rollSrc.loop = true;
    rollLP = A.createBiquadFilter(); rollLP.type = "lowpass"; rollLP.frequency.value = 3000; rollLP.Q.value = 0.5;
    rollG = A.createGain(); rollG.gain.value = 0;
    rollPan = A.createStereoPanner ? A.createStereoPanner() : null;
    rollSrc.connect(rollLP); rollLP.connect(rollG);
    if (rollPan) { rollG.connect(rollPan); rollPan.connect(mix); } else rollG.connect(mix);
    var sg = A.createGain(); sg.gain.value = 0.25; rollG.connect(sg); sg.connect(revIn);
    rollSrc.start();
  }

  function startFurnace(b) {
    var src = A.createBufferSource(); src.buffer = b; src.loop = true;
    furnaceG = A.createGain(); furnaceG.gain.value = 0;
    src.connect(furnaceG); furnaceG.connect(mix);
    src.start();
    if (running) furnaceG.gain.setTargetAtTime(0.045, A.currentTime, 0.6);
  }

  // the jar singing under strain: a rubbed-rim tone, a doublet that beats,
  // roughened by stick-slip, silent until the jar is close to overflowing
  function buildSing() {
    singG = A.createGain(); singG.gain.value = 0;
    var tone = A.createGain(); tone.gain.value = 1;
    var f0 = JAR_F / 2;   // B4: a bigger, lower voice than the struck ring
    [[1, 0.5, 0], [1, 0.38, 1.4], [2.32, 0.08, 0], [4.25, 0.03, 0]].forEach(function (p) {
      var o = A.createOscillator(); o.type = "sine";
      o.frequency.value = f0 * p[0] + p[2];
      var g = A.createGain(); g.gain.value = p[1];
      o.connect(g); g.connect(tone); o.start();
      singOsc.push(o);
    });
    // stick-slip: a fast wobble of the level that quickens with the strain
    singLFO = A.createOscillator(); singLFO.type = "sine"; singLFO.frequency.value = 6;
    singLFOg = A.createGain(); singLFOg.gain.value = 0;
    singLFO.connect(singLFOg); singLFOg.connect(tone.gain); singLFO.start();
    tone.connect(singG);
    var out = chain(0, 0.5);
    out.gain.value = 1;
    singG.connect(out);
  }

  /* -------------------------------------------------------------- voices */

  /* Each orb's own note. Hand-blown orbs are HOLLOW, and a hollow glass shell
   * rings like an ornament, lower the bigger it is: so every size has a pitch,
   * two octaves of E major pentatonic from a high E (Seed) to a low E (Sun).
   * Any mix of them is consonant, so a clattering pile plays chords instead
   * of one note over and over (owner, 10-01: "really repetitive... the
   * different sizes should have different pitches"). */
  var TIER_F = [1318.51, 1108.73, 987.77, 830.61, 739.99, 659.25, 554.37, 493.88, 415.30, 369.99, 329.63];
  var rings = 0;

  // one orb ringing from a knock. Nothing about it is fixed from hit to hit:
  // where it was struck sets the overtone balance, the doublet beats at its own
  // rate, the length wanders, and a soft knock is darker than a hard one.
  function ring(tier, v, pan, when) {
    if (rings > 12) return;            // a pile-up keeps its clicks but not a wall of rings
    rings++;
    var t = A.currentTime + (when || 0), out = chain(pan, 0.32);
    out.gain.value = 0.11 * v;
    var f = TIER_F[tier] * (1 + (Math.random() - 0.5) * 0.004);
    var dur = (0.2 + tier * 0.055) * (0.8 + Math.random() * 0.4);
    var P = [[1, 1], [2.32, 0.42 * v], [4.25, 0.2 * v * v]];
    var sum = 0, i;
    for (i = 0; i < P.length; i++) { P[i][1] *= 0.55 + Math.random() * 0.9; sum += P[i][1]; }
    for (i = 0; i < P.length; i++) {
      var fr = f * P[i][0];
      if (fr > 15000) break;
      var d = dur / (1 + i * 0.9);
      var split = i ? 0 : 0.8 + Math.random() * 2.6;   // the fundamental is a beating pair
      for (var h = 0; h < (split ? 2 : 1); h++) {
        var o = A.createOscillator(); o.type = "sine";
        o.frequency.value = fr + (h ? split : 0);
        var g = A.createGain(), lvl = P[i][1] / sum * (split ? (h ? 0.42 : 0.58) : 1);
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(lvl, t + 0.0015);
        g.gain.exponentialRampToValueAtTime(1e-4, t + d * (h ? 0.9 : 1));
        o.connect(g); g.connect(out); o.start(t); o.stop(t + d + 0.05);
      }
    }
    setTimeout(function () { rings--; try { out.disconnect(); } catch (e) {} }, ((when || 0) + dur + 0.3) * 1000);
  }

  // glass knocking on glass; a = -1 means the jar itself
  function hit(a, b, v, pan) {
    if (!live() || !B.click[0]) return;
    var big = a < 0 ? b : Math.max(a, b), small = a < 0 ? b : Math.min(a, b);
    var vv = Math.pow(v, 1.15);
    var rate = 0.96 + Math.random() * 0.08 + v * 0.05;   // a harder hit is a shorter contact: brighter
    play(pick(B.click[big]), 0.17 * vv, pan, 0.14, rate);
    // both orbs ring, each at its own note: a two-note chord that changes with every pair
    ring(big, vv, pan);
    if (a >= 0) {
      play(pick(B.click[small]), 0.1 * vv, pan, 0.1, rate);
      if (small !== big) ring(small, vv * 0.85, pan, 0.002);
    } else {
      // the jar itself rings only when it is struck: a wall or the floor
      var lp = 1800 + (1 - big / 10) * 5200 + v * 3500;
      play(pick(B.jar), 0.16 * vv * (0.7 + big * 0.03), pan, 0.4, 0.995 + Math.random() * 0.01, 0, lp);
    }
  }

  // the shears cutting the gather off the punty: two crisp metal ticks
  function dropVoice(tier, pan) {
    if (!live() || !B.click[0]) return;
    var t = A.currentTime, out = chain(pan, 0.12);
    out.gain.value = 0.075;
    [[5600, 0], [8300, 0.016]].forEach(function (p) {
      var n = A.createBufferSource(); n.buffer = pick(B.click[0]);
      n.playbackRate.value = p[0] / 5200;
      var bp = A.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = p[0]; bp.Q.value = 3;
      n.connect(bp); bp.connect(out); n.start(t + p[1]);
    });
    later(out, 0.4);
  }

  // a struck crystal: wine-glass partials, every one a split doublet that beats
  function crystal(freq, amp, pan, dur, when, weight) {
    var t = A.currentTime + (when || 0), out = chain(pan, 0.62);
    out.gain.value = amp;
    var R = [1, 2.32, 4.25, 6.63, 9.38], G = [0.6, 0.22, 0.1, 0.05, 0.025], D = [1, 0.55, 0.32, 0.2, 0.13];
    for (var k = 0; k < R.length; k++) {
      var f = freq * R[k] * (1 + (Math.random() - 0.5) * 0.002);
      if (f > 16000) break;
      var split = 0.6 + k * 0.6 + Math.random() * 0.9;
      for (var h = 0; h < 2; h++) {
        var o = A.createOscillator(); o.type = "sine";
        o.frequency.value = f + (h ? split : 0);
        var g = A.createGain(), d = dur * D[k] * (h ? 0.92 : 1);
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(G[k] * (h ? 0.42 : 0.58), t + 0.005);
        g.gain.exponentialRampToValueAtTime(1e-4, t + d);
        o.connect(g); g.connect(out); o.start(t); o.stop(t + d + 0.05);
      }
    }
    if (weight) {
      var o3 = A.createOscillator(); o3.type = "sine"; o3.frequency.value = freq * 0.5;
      var g3 = A.createGain();
      g3.gain.setValueAtTime(0, t); g3.gain.linearRampToValueAtTime(weight, t + 0.012);
      g3.gain.exponentialRampToValueAtTime(1e-4, t + dur * 0.6);
      o3.connect(g3); g3.connect(out); o3.start(t); o3.stop(t + dur);
    }
    later(out, (when || 0) + dur + 0.5);
  }

  // rubbed glass: a slow swell rather than a strike
  function harmonica(freq, amp, pan, dur, when) {
    var t = A.currentTime + (when || 0), out = chain(pan, 0.75);
    out.gain.value = amp;
    [[1, 0.56, 0], [1, 0.4, 0.9 + Math.random()], [2.32, 0.05, 0]].forEach(function (p) {
      var o = A.createOscillator(); o.type = "sine";
      o.frequency.value = freq * p[0] + p[2];
      var g = A.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(p[1], t + Math.min(0.35, dur * 0.2));
      g.gain.setTargetAtTime(1e-4, t + dur * 0.35, dur * 0.22);
      o.connect(g); g.connect(out); o.start(t); o.stop(t + dur + 0.2);
    });
    later(out, (when || 0) + dur + 0.6);
  }

  function glints(n, amp, pan, spread, when, hi) {
    if (!B.glint) return;
    for (var i = 0; i < n; i++) {
      var w = (when || 0) + Math.pow(Math.random(), 1.4) * spread;
      var f = pent(9 + Math.floor(Math.random() * (hi || 5)), 659.25);
      play(B.glint, amp * (0.4 + Math.random() * 0.6), pan + (Math.random() - 0.5) * 0.5, 0.5, f / 4000, w);
    }
  }

  function thump(f0, amp, pan, dur, when) {
    var t = A.currentTime + (when || 0), out = chain(pan, 0.08);
    out.gain.value = amp;
    var o = A.createOscillator(); o.type = "sine";
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f0 * 0.55, t + dur);
    var g = A.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(1, t + 0.006);
    g.gain.exponentialRampToValueAtTime(1e-4, t + dur);
    o.connect(g); g.connect(out); o.start(t); o.stop(t + dur + 0.05);
    later(out, (when || 0) + dur + 0.3);
  }

  function merge(tier, n, pan) {
    if (!live()) return;
    var w = tier / 10;
    if (n <= 1) chainRoot = Math.floor(Math.random() * 4);
    var step = chainRoot + n - 1;
    // the two touching
    play(pick(B.click[tier]), 0.22, pan, 0.12, 0.92);
    // the torch: deeper and longer for the big ones
    play(pick(B.puff), 0.2 + w * 0.12, pan, 0.3, 1.25 - w * 0.45, 0.005, 1400 + w * 1600);
    // the new orb rings
    crystal(pent(step), 0.15 + w * 0.03, pan, 1.3 + w * 1.9, 0.045, tier >= 5 ? 0.06 + (tier - 5) * 0.015 : 0);
    glints(3 + Math.min(6, Math.floor(tier / 2) + n), 0.035, pan, 0.32, 0.06);
    if (tier >= 5) thump(130 - tier * 5, 0.12 + w * 0.08, pan, 0.18 + w * 0.15, 0.03);
    // a couple of annealing ticks as it cools
    for (var i = 0; i < 2 + Math.floor(tier / 4); i++) {
      play(pick(B.click[0]), 0.035 + Math.random() * 0.03, pan + (Math.random() - 0.5) * 0.4, 0.3, 1.6 + Math.random() * 0.8, 0.3 + Math.random() * 0.9);
    }
  }

  function sun(pan) {
    if (!live()) return;
    [329.63, 493.88, 659.25, 830.61].forEach(function (f, i) {
      harmonica(f, 0.11, pan + (i - 1.5) * 0.3, 4.2, 0.08 + i * 0.09);
    });
    play(pick(B.puff), 0.36, pan, 0.4, 0.62, 0, 1800);
    thump(82.4, 0.3, pan, 1.6, 0.02);
    glints(16, 0.04, pan, 1.3, 0.1, 9);
  }

  function nova(pan) {
    if (!live()) return;
    [659.25, 987.77, 1318.5].forEach(function (f, i) { harmonica(f, 0.09, (i - 1) * 0.5, 3.4, 0.05 + i * 0.06); });
    play(pick(B.puff), 0.3, -0.3, 0.45, 0.5, 0, 2600);
    play(pick(B.puff), 0.3, 0.3, 0.45, 0.55, 0.04, 2600);
    thump(58, 0.34, 0, 1.4, 0);
    glints(36, 0.045, 0, 1.8, 0.02, 12);
  }

  function discover() {
    if (!live()) return;
    harmonica(987.77, 0.08, -0.3, 1.8, 0.3);
    harmonica(1318.5, 0.08, 0.3, 2.2, 0.48);
    glints(6, 0.03, 0, 0.6, 0.35, 8);
  }

  // the jar gives: a snap, a crack running through it, its ring choked off
  function overflow() {
    if (!live()) return;
    play(pick(B.click[0]), 0.36, 0, 0.3, 0.8);
    var t = 0, gap = 0.004;
    for (var i = 0; i < 26; i++) {
      t += gap * (0.4 + Math.random() * 1.2);
      gap *= 1.09;
      var spreadPan = (i / 26) * (i % 2 ? 0.8 : -0.8);
      play(pick(B.click[Math.floor(Math.random() * 3)]), 0.2 * Math.pow(1 - i / 30, 1.4), spreadPan, 0.25, 0.7 + Math.random() * 0.7, t);
    }
    var j = play(pick(B.jar), 0.3, 0, 0.35, 0.93, 0.01, 1700);
    if (j) j.gain.setTargetAtTime(1e-4, A.currentTime + 0.05, 0.05);
    thump(110, 0.26, 0, 0.22, 0.01);
    glints(5, 0.03, 0, 0.7, 0.35, 6);
  }

  function danger(level) {
    if (!ready || !singG) return;
    var t = A.currentTime;
    if (Math.abs(level - lastDanger) > 0.01) {
      lastDanger = level;
      var lv = on ? Math.pow(Math.max(0, level - 0.05), 1.4) : 0;
      singG.gain.setTargetAtTime(lv * 0.16, t, 0.12);
      singLFO.frequency.setTargetAtTime(5 + level * 9, t, 0.2);
      singLFOg.gain.setTargetAtTime(0.12 + level * 0.3, t, 0.2);
      // creeping sharp, by up to a third of a semitone
      for (var i = 0; i < singOsc.length; i++) singOsc[i].detune.setTargetAtTime(level * 30, t, 0.3);
      // the music steps back and darkens, so the singing glass comes through
      if (MU.gain && MU.piece) {
        MU.gain.gain.setTargetAtTime(MU.level * (1 - 0.6 * level), t, 0.4);
        MU.lp.frequency.setTargetAtTime(7500 - 5600 * level, t, 0.4);
      }
    }
    // stress ticks, quickening
    if (level > 0.15 && live() && B.click[0]) {
      if (t >= nextTick) {
        play(pick(B.click[Math.floor(Math.random() * 2)]), 0.05 + level * 0.06, (Math.random() - 0.5) * 0.8, 0.3, 1.4 + Math.random());
        nextTick = t + (0.9 - level * 0.7) * (0.5 + Math.random());
      }
    } else nextTick = 0;
  }

  // how much of the pile is on the move, 0..1, and where
  function roll(energy, pan) {
    if (!rollG || !A) return;
    var t = A.currentTime, e = on && running ? Math.min(1, energy) : 0;
    rollG.gain.setTargetAtTime(e * 0.32, t, 0.06);
    rollLP.frequency.setTargetAtTime(1800 + e * 5500, t, 0.08);
    rollSrc.playbackRate.setTargetAtTime(0.85 + e * 0.35, t, 0.1);
    if (rollPan) rollPan.pan.setTargetAtTime(Math.max(-0.8, Math.min(0.8, pan || 0)), t, 0.1);
  }

  /* ------------------------------------------------------------- music */

  /* Calm generative music, a new piece every run (owner, 10-01: "calming
   * background music. Different every time").
   *
   * Everything is drawn from the same E major pentatonic as the clacks and the
   * melts, so nothing the orbs do can clash with it. Four chords built ONLY
   * from those five notes (E add9, C#m7, B6sus, F#11) wander by weighted
   * chance, voice-led so each change moves as little as it can, under:
   *   - a rubbed-glass pad: a glass harmonica, i.e. a doublet that beats plus
   *     the faint harmonics stick-slip adds, each voice breathing on its own;
   *   - a soft root a couple of octaves down;
   *   - three or four short melodic loops, Eno style: each repeats on its own
   *     odd period, so they drift in and out of phase and the combination never
   *     comes round the same way twice. Each pass may skip, and now and then a
   *     note mutates, so a piece also evolves;
   *   - now and then, glints far away.
   * Each piece rolls its own lead instrument (kalimba tine, celesta, or a soft
   * glass marimba), tempo of change, registers and loop lengths from a seed.
   * The seed comes from the run's drops, so a challenge plays the same piece.
   * It lives in its own long hall, further away than the clatter, and ducks and
   * darkens as the jar nears overflow so the singing glass comes through. */

  var MU = { on: true, level: 0.16, gain: null, lp: null, dry: null, wet: null, hall: null, piece: null, timer: null };
  var PENTA_PC = [0, 2, 4, 7, 9];                 // E F# G# B C#, as semitones above E
  var CHORDS = [
    { root: 0, pcs: [0, 7, 4, 2] },               // E add9
    { root: 9, pcs: [9, 4, 7, 0] },               // C#m7
    { root: 7, pcs: [7, 0, 2, 4] },               // B6sus4 (B E F# G#)
    { root: 2, pcs: [2, 9, 0, 7] }                // F#11 (F# C# E B)
  ];
  var NEXT = [[[1, 3], [2, 2], [3, 2]], [[0, 2], [2, 2], [3, 3]], [[0, 4], [1, 2], [3, 1]], [[0, 2], [2, 3], [1, 2]]];
  function hzE2(semi) { return 82.407 * Math.pow(2, semi / 12); }   // semitones above E2

  function renderHall(c) {
    var len = Math.ceil(SR * 4.8), r = rng(510 + c * 13), d = new Float32Array(len), i;
    var bands = [[900, "lp", 4.6], [900, "hp", 2.6]];
    for (var b = 0; b < 2; b++) {
      var n = new Float32Array(len), lp = 0;
      for (i = 0; i < len; i++) { lp += ((r() * 2 - 1) - lp) * 0.3; n[i] = lp; }
      filt(n, bands[b][1], bands[b][0], 0.7);
      if (b) filt(n, "lp", 6500, 0.7);
      var T = bands[b][2], pre = Math.floor(SR * 0.035);
      for (i = pre; i < len; i++) {
        var tt = (i - pre) / SR;
        d[i] += n[i] * Math.exp(-6.9 * tt / T) * Math.min(1, (i - pre) / (SR * 0.08));
      }
    }
    return norm(d, 0.9);
  }

  function buildMusic() {
    MU.gain = A.createGain(); MU.gain.gain.value = 0;
    MU.lp = A.createBiquadFilter(); MU.lp.type = "lowpass"; MU.lp.frequency.value = 7500; MU.lp.Q.value = 0.5;
    MU.dry = A.createGain();
    MU.wet = A.createGain();
    MU.hall = A.createConvolver();
    MU.dry.connect(MU.gain);
    MU.wet.connect(MU.hall); MU.hall.connect(MU.gain);
    MU.gain.connect(MU.lp); MU.lp.connect(mix);
  }

  function musicOut(pan, send) {
    var g = A.createGain();
    if (A.createStereoPanner) {
      var p = A.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan));
      g.connect(p); p.connect(MU.dry);
      var s = A.createGain(); s.gain.value = send; p.connect(s); s.connect(MU.wet);
    } else { g.connect(MU.dry); var s2 = A.createGain(); s2.gain.value = send; g.connect(s2); s2.connect(MU.wet); }
    return g;
  }

  // one breathing glass-harmonica voice; returns a release(t) handle
  function padVoice(f, t, att, lvl, pan, bright) {
    var env = A.createGain(), rel = A.createGain(), out = musicOut(pan, 0.85);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(lvl, t + att);
    rel.gain.value = 1;
    env.connect(rel); rel.connect(out);
    var oscs = [];
    [[1, 0.56, 0], [1, 0.38, 0.5 + Math.random() * 1.1], [2, 0.07 * bright, 0], [3, 0.025 * bright, 0]].forEach(function (p) {
      var o = A.createOscillator(); o.type = "sine";
      o.frequency.value = f * p[0] + p[2];
      var g = A.createGain(); g.gain.value = p[1];
      o.connect(g); g.connect(env); o.start(t);
      oscs.push(o);
    });
    // each voice breathes at its own slow rate
    var lfo = A.createOscillator(); lfo.frequency.value = 0.05 + Math.random() * 0.12;
    var lg = A.createGain(); lg.gain.value = lvl * 0.22;
    lfo.connect(lg); lg.connect(env.gain); lfo.start(t);
    oscs.push(lfo);
    return function (tr, tc) {
      rel.gain.setTargetAtTime(0, tr, tc);
      oscs.forEach(function (o) { try { o.stop(tr + tc * 7); } catch (e) {} });
      setTimeout(function () { try { out.disconnect(); } catch (e) {} }, (tr - A.currentTime + tc * 7 + 0.5) * 1000);
    };
  }

  var LEADS = {
    // a kalimba tine: a clamped bar, so its overtones are far from harmonic
    kalimba: { P: [[1, 1, 1], [6.27, 0.12, 0.14], [17.55, 0.035, 0.05]], att: 0.004, dur: 3.0, strike: 0.1 },
    // a celesta: struck plates over resonators, sweet and nearly harmonic
    celesta: { P: [[1, 1, 1], [2, 0.16, 0.5], [3, 0.05, 0.3], [4.2, 0.025, 0.15]], att: 0.003, dur: 2.2, strike: 0.08 },
    // a soft glass marimba: felt mallet, tuned bar, darker and rounder
    marimba: { P: [[1, 1, 1], [3.93, 0.2, 0.18], [10.2, 0.04, 0.06]], att: 0.009, dur: 1.8, strike: 0.06 }
  };

  function leadNote(kind, semi, t, vel, pan, send) {
    var L = LEADS[kind], f = hzE2(semi);
    var out = musicOut(pan, send);
    out.gain.value = vel * 0.16;
    var dur = L.dur * (1.25 - Math.min(1, (semi - 24) / 30) * 0.5);   // low notes ring longer
    L.P.forEach(function (p) {
      if (f * p[0] > 14000) return;
      var o = A.createOscillator(); o.type = "sine";
      o.frequency.value = f * p[0] * (1 + (Math.random() - 0.5) * 0.002);
      var g = A.createGain(), d = dur * p[2];
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(p[1], t + L.att);
      g.gain.exponentialRampToValueAtTime(1e-4, t + Math.max(0.05, d));
      o.connect(g); g.connect(out); o.start(t); o.stop(t + d + 0.05);
    });
    // the felt or the pluck: a soft tick in front
    if (B.click[3]) {
      var n = A.createBufferSource(); n.buffer = pick(B.click[3]);
      n.playbackRate.value = 0.6;
      var lp = A.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = Math.min(6000, f * 4); lp.Q.value = 0.5;
      var ng = A.createGain(); ng.gain.value = L.strike;
      n.connect(lp); lp.connect(ng); ng.connect(out); n.start(t);
    }
    setTimeout(function () { try { out.disconnect(); } catch (e) {} }, (t - A.currentTime + dur + 0.6) * 1000);
  }

  function Piece(seed) {
    var r = this.r = rng(seed >>> 0);
    var kinds = ["kalimba", "celesta", "marimba"];
    this.lead = kinds[Math.floor(r() * 3)];
    this.lead2 = r() < 0.4 ? kinds[Math.floor(r() * 3)] : this.lead;
    this.chordBase = 9 + r() * 6;            // seconds a chord holds, on average
    this.bright = 0.6 + r() * 0.8;
    this.padLvl = 0.075 + r() * 0.025;
    this.sub = r() < 0.75;
    this.chord = Math.floor(r() * 4);
    if (r() < 0.5) this.chord = 0;           // half the pieces start home, on E
    this.voices = [];                         // current pad voicing, semitones above E2
    this.releases = [];
    var nLoops = 3 + (r() < 0.5 ? 1 : 0), periods = [];
    this.loops = [];
    for (var i = 0; i < nLoops; i++) {
      var P;
      do { P = 13 + r() * 22; } while (periods.some(function (q) { return Math.abs(q - P) < 2.5; }));
      periods.push(P);
      var notes = [], k = 1 + Math.floor(r() * 3), off = 0;
      var oct = 24 + 12 * Math.floor(r() * 2) + (r() < 0.2 ? 12 : 0);   // E4 or E5, sometimes E6
      for (var j = 0; j < k; j++) {
        notes.push({ deg: Math.floor(r() * 5), oct: oct + (r() < 0.25 ? 12 : 0), off: off, vel: 0.55 + r() * 0.45 });
        off += 0.35 + r() * 1.4;
      }
      this.loops.push({ P: P, phase: r() * P, notes: notes, pan: (r() - 0.5) * 1.3, p: 0.7 + r() * 0.3, kind: i % 2 ? this.lead2 : this.lead });
    }
  }

  Piece.prototype.start = function (t0) {
    this.nextChord = t0 + 0.1;
    for (var i = 0; i < this.loops.length; i++) this.loops[i].next = t0 + 3 + this.loops[i].phase;
    this.nextSpark = t0 + 8 + this.r() * 10;
  };

  Piece.prototype.voiceLead = function (pcs) {
    var out = [], used = {};
    if (!this.voices.length) {
      // first chord: root low, the rest stacked open above it
      var base = 12 + pcs[0];
      if (base > 20) base -= 12;
      out.push(base);
      for (var k = 1; k < pcs.length; k++) {
        var s = base + ((pcs[k] - pcs[0] + 12) % 12) + (k > 1 ? 12 : 0);
        out.push(s);
      }
      return out.sort(function (a, b) { return a - b; });
    }
    // later chords: each voice moves to the nearest tone of the new chord
    for (var v = 0; v < this.voices.length; v++) {
      var best = null, bd = 99;
      for (var c = 0; c < pcs.length; c++) {
        for (var o = 0; o < 4; o++) {
          var cand = pcs[c] + 12 * o;
          if (cand < 8 || cand > 34) continue;
          var dd = Math.abs(cand - this.voices[v]) + (used[pcs[c]] ? 4 : 0);
          if (dd < bd) { bd = dd; best = cand; }
        }
      }
      used[((best % 12) + 12) % 12] = true;
      out.push(best);
    }
    return out;
  };

  Piece.prototype.playChord = function (t) {
    var r = this.r, ch = CHORDS[this.chord];
    var rel = this.releases; this.releases = [];
    rel.forEach(function (f) { f(t, 1.4); });
    this.voices = this.voiceLead(ch.pcs);
    for (var i = 0; i < this.voices.length; i++) {
      var pan = (i / (this.voices.length - 1) - 0.5) * 1.1;
      this.releases.push(padVoice(hzE2(this.voices[i]), t - 1.2, 3.2 + r() * 1.5, this.padLvl, pan, this.bright));
    }
    if (this.sub) {
      var root = ch.root > 4 ? ch.root - 12 : ch.root;
      this.releases.push(padVoice(hzE2(root), t - 0.8, 4, this.padLvl * 1.3, 0, 0.3));
    }
    // the next chord, by weighted chance
    var opts = NEXT[this.chord], tot = 0, u, j;
    for (j = 0; j < opts.length; j++) tot += opts[j][1];
    u = r() * tot;
    for (j = 0; j < opts.length; j++) { u -= opts[j][1]; if (u <= 0) { this.chord = opts[j][0]; break; } }
  };

  Piece.prototype.tick = function (now) {
    var ahead = now + 0.5, r = this.r, i, j;
    // never play catch-up after a stall (a background tab): skip to now
    if (this.nextChord < now - 1) this.nextChord = now + 0.1;
    while (this.nextChord < ahead) {
      this.playChord(this.nextChord);
      this.nextChord += this.chordBase * (0.7 + r() * 0.6);
    }
    for (i = 0; i < this.loops.length; i++) {
      var L = this.loops[i];
      while (L.next < now - 1) L.next += L.P;
      while (L.next < ahead) {
        if (r() < L.p) {
          for (j = 0; j < L.notes.length; j++) {
            var n = L.notes[j];
            var semi = n.oct + PENTA_PC[n.deg];
            leadNote(L.kind, semi, L.next + n.off, n.vel * (0.8 + r() * 0.4), L.pan, 0.55);
          }
        }
        // a piece evolves: now and then one note of a loop moves
        if (r() < 0.12) L.notes[Math.floor(r() * L.notes.length)].deg = Math.floor(r() * 5);
        L.next += L.P;
      }
    }
    if (this.nextSpark < now - 1) this.nextSpark = now + 5;
    if (this.nextSpark < ahead && B.glint) {
      var n2 = 2 + Math.floor(r() * 3);
      for (j = 0; j < n2; j++) {
        var f = hzE2(48 + PENTA_PC[Math.floor(r() * 5)] + (r() < 0.4 ? 12 : 0));
        var o = musicOut((r() - 0.5) * 1.6, 0.95);
        o.gain.value = 0.035 + r() * 0.03;
        var src = A.createBufferSource(); src.buffer = B.glint; src.playbackRate.value = f / 4000;
        src.connect(o); src.start(this.nextSpark + j * (0.2 + r() * 0.5));
      }
      this.nextSpark += 7 + r() * 14;
    }
  };

  Piece.prototype.stop = function (t) {
    this.releases.forEach(function (f) { f(t, 1.6); });
    this.releases = [];
  };

  function musicTick() {
    if (!MU.piece || !A) return;
    if (!on || !MU.on || document.hidden) return;
    try { MU.piece.tick(A.currentTime); } catch (e) {}
  }

  function musicNew(seed) {
    if (!ready || !MU.gain) return;
    var t = A.currentTime;
    if (MU.piece) MU.piece.stop(t);
    MU.piece = null;
    if (!MU.on || !on) return;
    MU.piece = new Piece(seed === undefined ? (Math.random() * 4294967296) >>> 0 : seed);
    MU.piece.start(t + 0.3);
    MU.gain.gain.setTargetAtTime(MU.level, t, 1.2);
    if (!MU.timer) MU.timer = setInterval(musicTick, 120);
    musicTick();
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
      return on;
    },
    start: function () {
      running = true;
      if (ready && furnaceG) furnaceG.gain.setTargetAtTime(0.045, A.currentTime, 0.6);
    },
    stop: function () {
      running = false;
      if (!ready) return;
      if (furnaceG) furnaceG.gain.setTargetAtTime(0, A.currentTime, 0.8);
      if (singG) singG.gain.setTargetAtTime(0, A.currentTime, 0.3);
      if (rollG) rollG.gain.setTargetAtTime(0, A.currentTime, 0.2);
      lastDanger = -1;
      // the music carries on through the result, settling back after the crack
      if (MU.gain && MU.piece) {
        MU.gain.gain.setTargetAtTime(MU.level, A.currentTime + 0.8, 1.6);
        MU.lp.frequency.setTargetAtTime(7500, A.currentTime + 0.8, 1.6);
      }
    },
    musicInit: function (v) { MU.on = v; },
    // a new piece: every run gets one, seeded from the run's drops
    musicNew: function (seed) { musicNew(seed); },
    musicToggle: function () {
      MU.on = !MU.on;
      if (!ready) return MU.on;
      if (MU.on) musicNew();
      else {
        if (MU.piece) MU.piece.stop(A.currentTime);
        MU.piece = null;
        MU.gain.gain.setTargetAtTime(0, A.currentTime, 0.5);
      }
      return MU.on;
    },
    hit: hit, drop: dropVoice, merge: merge, sun: sun, nova: nova,
    discover: discover, overflow: overflow, roll: roll,
    danger: function (level) { if (level || lastDanger > 0) danger(level); }
  };
})();
