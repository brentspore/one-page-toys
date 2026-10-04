/* Settle Up sound: a small thermal receipt printer, coins landing on a pile,
 * a paper tear, a rubber stamp on a wooden table, a soft chip tick.
 * Everything is synthesized into buffers on first use (no sample files), then
 * played through one room, a glue compressor and a brickwall. */
(function () {
  "use strict";

  var KEY = "settleup_sound";
  var on = true;
  try { if (localStorage.getItem(KEY) === "0") on = false; } catch (e) {}

  var ctx = null, out = null, wet = null, bank = {};
  var SR = 48000;

  function rnd(seed) {
    var s = seed >>> 0 || 1;
    return function () { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  }

  // one NaN in a shared compressor silences everything until reload
  function scrub(data) {
    for (var i = 0; i < data.length; i++) if (!isFinite(data[i])) data[i] = 0;
  }

  function buffer(seconds, fill) {
    var n = Math.max(1, Math.round(seconds * SR));
    var b = ctx.createBuffer(2, n, SR);
    var L = b.getChannelData(0), R = b.getChannelData(1);
    fill(L, R, n);
    scrub(L); scrub(R);
    return b;
  }

  // ---------- the graph ----------
  function build() {
    if (ctx) return true;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try { ctx = new AC(); } catch (e) { ctx = null; return false; }
    SR = ctx.sampleRate || 48000;

    var glue = ctx.createDynamicsCompressor();
    glue.threshold.value = -15; glue.ratio.value = 3; glue.knee.value = 8;
    glue.attack.value = 0.004; glue.release.value = 0.18;
    var wall = ctx.createDynamicsCompressor();
    wall.threshold.value = -1.5; wall.ratio.value = 20; wall.knee.value = 0;
    wall.attack.value = 0.001; wall.release.value = 0.08;
    var silk = ctx.createBiquadFilter();
    silk.type = "lowpass"; silk.frequency.value = 14000; silk.Q.value = 0.5;

    out = ctx.createGain();
    out.gain.value = on ? 1 : 0;
    out.connect(glue); glue.connect(silk); silk.connect(wall); wall.connect(ctx.destination);

    // a small wooden room: short, dark, no grain
    var room = ctx.createConvolver();
    room.buffer = buffer(0.55, function (L, R, n) {
      var r = rnd(77), lpL = 0, lpR = 0;
      for (var i = 0; i < n; i++) {
        var t = i / SR, env = Math.exp(-t * 9.5) * (t < 0.004 ? t / 0.004 : 1);
        var k = 0.18 + 0.5 * Math.exp(-t * 14);   // treble dies first
        lpL += k * ((r() * 2 - 1) - lpL); lpR += k * ((r() * 2 - 1) - lpR);
        L[i] = lpL * env; R[i] = lpR * env;
      }
    });
    wet = ctx.createGain();
    wet.gain.value = 0.22;
    wet.connect(room); room.connect(out);
    return true;
  }

  function unlock() {
    if (!build()) return;
    try {
      var s = ctx.createBufferSource();
      s.buffer = ctx.createBuffer(1, 1, 22050);
      s.connect(ctx.destination); s.start(0);
    } catch (e) {}
    if (ctx.state === "suspended" && ctx.resume) ctx.resume().catch(function () {});
  }

  function play(buf, opts) {
    if (!on || !build() || !buf) return;
    opts = opts || {};
    var t = ctx.currentTime + (opts.delay || 0) + 0.005;
    var src = ctx.createBufferSource();
    src.buffer = buf;
    if (opts.rate) src.playbackRate.value = opts.rate;
    var g = ctx.createGain();
    g.gain.value = opts.gain == null ? 1 : opts.gain;
    var node = g;
    if (ctx.createStereoPanner && opts.pan) {
      var p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, opts.pan));
      g.connect(p); node = p;
    }
    src.connect(g);
    node.connect(out);
    var send = ctx.createGain();
    send.gain.value = opts.wet == null ? 1 : opts.wet;
    node.connect(send); send.connect(wet);
    src.start(t);
    src.onended = function () { try { src.disconnect(); g.disconnect(); send.disconnect(); if (node !== g) node.disconnect(); } catch (e) {} };
  }

  // ---------- voices ----------

  // Thermal printer: a stepper motor ticking the paper on (a fast click train
  // ringing a small plastic housing), paper hiss under it, a pause per line.
  function printerBuf(lines, seed) {
    var r = rnd(seed);
    var seg = 0.075, gap = 0.035, tail = 0.12;
    var dur = lines * (seg + gap) + tail;
    return buffer(dur, function (L, R, n) {
      var modes = [[2150, 0.0035, 1], [3420, 0.0022, 0.55], [1180, 0.006, 0.45], [5200, 0.0012, 0.25]];
      var st = modes.map(function () { return [0, 0]; });
      var coef = modes.map(function (m) {
        var w = 2 * Math.PI * m[0] / SR, rr = Math.exp(-1 / (m[1] * SR));
        return [2 * rr * Math.cos(w), -rr * rr, m[2]];
      });
      var nextTick = 0, hiss = 0, hum = 0, phase = 0;
      for (var i = 0; i < n; i++) {
        var t = i / SR;
        var line = Math.floor(t / (seg + gap));
        var inLine = t - line * (seg + gap);
        var running = line < lines && inLine < seg;
        var x = 0;
        if (running && i >= nextTick) {
          x = 0.9 + r() * 0.2;
          nextTick = i + Math.round(SR / (560 + r() * 18));   // ~560 steps a second
        }
        var ramp = running ? Math.min(1, inLine / 0.008, (seg - inLine) / 0.01) : 0;
        var y = 0;
        for (var k = 0; k < modes.length; k++) {
          var s = st[k], c = coef[k];
          var v = c[0] * s[0] + c[1] * s[1] + x;
          s[1] = s[0]; s[0] = v;
          y += v * c[2];
        }
        // motor hum: a little 560Hz fundamental under the clicks
        phase += 2 * Math.PI * 560 / SR;
        hum = Math.sin(phase) * 0.018 * ramp;
        hiss += 0.35 * ((r() * 2 - 1) - hiss);
        var paper = hiss * 0.05 * ramp;
        var smp = y * 0.016 * ramp + hum + paper;
        // the cut at the end: a short snip
        var tc = t - lines * (seg + gap);
        if (tc > 0 && tc < 0.018) smp += (r() * 2 - 1) * 0.16 * Math.exp(-tc * 260);
        L[i] = smp; R[i] = smp * 0.94;
      }
    });
  }

  // A coin: a thin metal disc. Free-plate mode ratios 1 : 1.73 : 2.33 : 3.91 :
  // 4.11, each a slightly split doublet so it shimmers, higher modes die first.
  // A short lowpassed contact tack opens it. Several bounces, each quieter and
  // sooner, then it settles on the pile.
  function coinBuf(seed) {
    var r = rnd(seed);
    var f0 = 2350 + r() * 520;
    var ratios = [1, 1.73, 2.33, 3.91, 4.11];
    var amps = [1, 0.55, 0.62, 0.3, 0.26];
    var decs = [0.42, 0.3, 0.24, 0.12, 0.1];
    var bounces = [[0, 1], [0.105, 0.5], [0.175, 0.3], [0.222, 0.17], [0.254, 0.09]];
    var dur = 1.0;
    return buffer(dur, function (L, R, n) {
      var ph = [];
      for (var b = 0; b < bounces.length; b++) {
        ph.push(ratios.map(function () { return [r() * 6.283, r() * 6.283]; }));
      }
      var tack = 0;
      for (var i = 0; i < n; i++) {
        var t = i / SR, s = 0;
        for (var bi = 0; bi < bounces.length; bi++) {
          var tb = t - bounces[bi][0];
          if (tb < 0) continue;
          var a = bounces[bi][1];
          var att = tb < 0.0015 ? tb / 0.0015 : 1;
          for (var k = 0; k < ratios.length; k++) {
            var f = f0 * ratios[k] * (1 + bi * 0.0015);
            var e = Math.exp(-tb / (decs[k] * (bi ? 0.6 : 1)));
            if (e < 0.0005) continue;
            s += a * att * amps[k] * e * 0.5 * (Math.sin(2 * Math.PI * f * tb + ph[bi][k][0]) +
                 Math.sin(2 * Math.PI * f * 1.0025 * tb + ph[bi][k][1]));
          }
          if (tb < 0.006) s += a * (r() * 2 - 1) * 1.4 * Math.exp(-tb * 900);
        }
        tack += 0.45 * (s - tack);       // gentle lowpass on the whole thing
        L[i] = tack * 0.09; R[i] = tack * 0.09;
      }
    });
  }

  // Paper tear: a crackle of tiny fiber snaps riding a band of noise that
  // sweeps as the rip runs across.
  function tearBuf(seed) {
    var r = rnd(seed);
    var dur = 0.36;
    return buffer(dur, function (L, R, n) {
      var lp = 0, bp1 = 0, bp2 = 0;
      for (var i = 0; i < n; i++) {
        var t = i / SR, u = t / dur;
        var env = Math.sin(Math.PI * Math.min(1, Math.max(0, u * 1.08))) * (0.75 + 0.25 * Math.sin(t * 90));
        var x = r() * 2 - 1;
        if (r() < 0.012 + 0.03 * env) x *= 6;            // fiber snaps
        var fc = 1800 + 2400 * u;
        var k = Math.min(0.9, 2 * Math.PI * fc / SR);
        bp1 += k * (x - bp1); bp2 += k * (bp1 - bp2);
        var band = bp1 - bp2;
        lp += 0.5 * (band - lp);
        var s = lp * env * 0.55;
        L[i] = s * (0.8 + 0.2 * u); R[i] = s * (1 - 0.2 * u);
      }
    });
  }

  // Rubber stamp: the handle's thump into a wooden table (low body, pitch
  // dropping as it seats), the rubber slapping paper, and a smaller second
  // rock as it settles.
  function stampBuf(seed) {
    var r = rnd(seed);
    var dur = 0.7;
    return buffer(dur, function (L, R, n) {
      var lp = 0, lp2 = 0, ph = 0, ph2 = 0, slapLp = 0;
      for (var i = 0; i < n; i++) {
        var t = i / SR, s = 0;
        // body: sine glide 150 -> 52Hz
        var f = 52 + 98 * Math.exp(-t * 26);
        ph += 2 * Math.PI * f / SR;
        s += Math.sin(ph) * Math.exp(-t * 11) * 0.9;
        // wood knock around 190Hz
        ph2 += 2 * Math.PI * 192 / SR;
        s += Math.sin(ph2) * Math.exp(-t * 30) * 0.35;
        // thud noise, lowpassed and closing
        var k = 0.02 + 0.12 * Math.exp(-t * 18);
        lp += k * ((r() * 2 - 1) - lp);
        s += lp * Math.exp(-t * 16) * 2.2;
        // rubber on paper: a short bright slap
        if (t < 0.03) {
          slapLp += 0.55 * ((r() * 2 - 1) - slapLp);
          s += slapLp * Math.exp(-t * 140) * 0.9;
        }
        // the rock: a quieter second contact
        var t2 = t - 0.085;
        if (t2 > 0) {
          lp2 += 0.08 * ((r() * 2 - 1) - lp2);
          s += lp2 * Math.exp(-t2 * 30) * 0.9 + Math.sin(2 * Math.PI * 88 * t2) * Math.exp(-t2 * 22) * 0.25;
        }
        var att = t < 0.002 ? t / 0.002 : 1;
        L[i] = s * att * 0.42; R[i] = s * att * 0.42;
      }
    });
  }

  // A soft plastic tick for chips and checkboxes.
  function tickBuf(seed) {
    var r = rnd(seed);
    return buffer(0.05, function (L, R, n) {
      var lp = 0, st = [0, 0];
      var w = 2 * Math.PI * 3100 / SR, rr = Math.exp(-1 / (0.0025 * SR));
      var c1 = 2 * rr * Math.cos(w), c2 = -rr * rr;
      for (var i = 0; i < n; i++) {
        var t = i / SR;
        var x = t < 0.0012 ? (r() * 2 - 1) : 0;
        var v = c1 * st[0] + c2 * st[1] + x;
        st[1] = st[0]; st[0] = v;
        lp += 0.6 * (x - lp);
        var s = v * 0.05 + lp * 0.6;
        L[i] = s * 0.5; R[i] = s * 0.5;
      }
    });
  }

  function variant(name, count, make) {
    if (!bank[name]) {
      bank[name] = [];
      for (var i = 0; i < count; i++) bank[name].push(make(1000 + i * 7919));
    }
    var list = bank[name];
    return list[Math.floor(Math.random() * list.length)];
  }

  var lastTick = 0;
  var API = {
    unlock: unlock,
    isOn: function () { return on; },
    setOn: function (v) {
      on = !!v;
      try { localStorage.setItem(KEY, on ? "1" : "0"); } catch (e) {}
      if (out && ctx) out.gain.setTargetAtTime(on ? 1 : 0, ctx.currentTime, 0.02);
    },
    print: function (lines) {
      if (!on || !build()) return;
      var n = Math.max(1, Math.min(4, lines || 2));
      if (!bank["print" + n]) bank["print" + n] = [printerBuf(n, 31 + n)];
      play(bank["print" + n][0], { gain: 0.55, wet: 0.6 });
    },
    coin: function (pan, count, delay) {
      if (!on || !build()) return;
      var c = Math.max(1, Math.min(4, count || 1));
      for (var i = 0; i < c; i++) {
        play(variant("coin", 5, coinBuf), { pan: (pan || 0) + (Math.random() - 0.5) * 0.2, delay: (delay || 0) + i * 0.11, gain: 0.78 * (1 - i * 0.2), rate: 0.97 + Math.random() * 0.06 });
      }
    },
    tear: function () {
      if (!on || !build()) return;
      play(variant("tear", 3, tearBuf), { gain: 0.34, wet: 0.7, rate: 0.92 + Math.random() * 0.16 });
    },
    stamp: function () {
      if (!on || !build()) return;
      play(variant("stamp", 2, stampBuf), { gain: 0.24, wet: 1.1 });
    },
    tick: function () {
      if (!on || !build()) return;
      var now = Date.now();
      if (now - lastTick < 35) return;      // a fast double tap is one tick
      lastTick = now;
      play(variant("tick", 3, tickBuf), { gain: 0.12, wet: 0.4, rate: 0.9 + Math.random() * 0.2 });
    }
  };
  window.SettleAudio = API;
})();
