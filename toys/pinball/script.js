/* Pinball — one curated table, three balls, no progression.
 *
 * Geometry lives in a fixed 440x820 "table space" and is scaled to the viewport,
 * so the table plays identically at every size. Every wall is a line segment and
 * every post is a circle; arcs are tessellated into segments so the whole world
 * needs only two swept tests. Collision is CONTINUOUS (earliest time-of-impact
 * per substep) because a pinball is small and fast enough to tunnel through a
 * wall on any discrete test.
 */
(function () {
  "use strict";

  var TW = 440, TH = 820;             // table space
  var BALL_R = 11;
  var GRAV = 1500;                    // units/s^2 down the inclined playfield
  var STEP = 1 / 240;                 // physics timestep
  var MAX_SUB = 8;
  var MAX_SPEED = 2600;

  var WALL_R = 5;                     // walls are capsules: half-thickness
  var FLIP_LEN = 66, FLIP_R = 7;
  /* The flippers are CAPSULES of radius FLIP_R, so the real drain opening is
   * (tip gap - 2*FLIP_R). At the first spacing that came to 15 units against a
   * 20-wide ball and the ball simply bridged the tips and never drained. These
   * pivots leave a 31-unit opening, about 1.5 ball widths, which is what a real
   * table runs. */
  /* The pivot sits ON the funnel wall's end, not beside it. Set 10 units inboard
   * it left a shelf, and a ball could settle up-LEFT of the pivot — a spot no
   * flip can ever reach, because the flipper body only sweeps to the right of
   * its own pivot. That was a hard lock, not a cradle. */
  var LEFT_PIVOT = { x: 120, y: 710 };
  var RIGHT_PIVOT = { x: 286, y: 710 };
  var FLIP_REST_L = 28 * Math.PI / 180;
  var FLIP_UP_L = -32 * Math.PI / 180;
  var FLIP_REST_R = Math.PI - FLIP_REST_L;
  var FLIP_UP_R = Math.PI - FLIP_UP_L;
  var FLIP_TIME = 0.044;              // seconds for a full sweep
  /* A real flipper is close to inelastic: the ball leaves at roughly the speed
   * of the bat's surface at the contact point, not double it. At 0.34 the
   * reflection doubled a 1570 u/s tip and EVERY shot pinned the speed clamp, so
   * where you caught the ball stopped mattering. */
  var FLIP_REST = 0.06;

  var BALLS_PER_GAME = 3;

  // ---------------------------------------------------------------- geometry

  function seg(x1, y1, x2, y2, kind) {
    return { a: { x: x1, y: y1 }, b: { x: x2, y: y2 }, r: WALL_R, kind: kind || "wall" };
  }

  // Tessellate an arc into segments. th0/th1 in radians, measured with y UP so
  // the maths reads normally; we flip when emitting into table space.
  function arcSegs(cx, cy, rad, th0, th1, n, kind) {
    var out = [], i, t, p, prev = null;
    for (i = 0; i <= n; i++) {
      t = th0 + (th1 - th0) * (i / n);
      p = { x: cx + rad * Math.cos(t), y: cy - rad * Math.sin(t) };
      if (prev) {
        var sg = seg(prev.x, prev.y, p.x, p.y, kind);
        sg.arcPart = true;      // drawn as one smooth path, not as rails
        out.push(sg);
      }
      prev = p;
    }
    return out;
  }

  var WALLS = [];
  // outer shell: left wall, arc over the top, right wall of the plunger lane
  WALLS.push(seg(16, 250, 16, 600));
  WALLS = WALLS.concat(arcSegs(220, 250, 204, Math.PI, 0, 40));
  WALLS.push(seg(424, 250, 424, 764));
  // lower funnels down to the flipper pivots
  // funnels end exactly at the flipper pivots so there is no shelf to catch on
  WALLS.push(seg(16, 600, 120, 710));
  WALLS.push(seg(390, 600, 286, 710));
  // divider between playfield and plunger lane
  WALLS.push(seg(390, 250, 390, 600));
  // plunger lane floor
  WALLS.push(seg(390, 764, 424, 764));
  // orbit guides — two lanes hugging the sides
  WALLS.push(seg(58, 300, 58, 548));
  WALLS.push(seg(348, 300, 348, 548));
  // little deflectors at the bottom of each orbit lane so a ball can leave it
  WALLS.push(seg(58, 548, 82, 590));
  WALLS.push(seg(348, 548, 324, 590));

  // one-way gate across the top of the plunger lane: passable going up only
  var GATE = seg(390, 250, 424, 250, "gate");
  GATE.oneWay = true;

  var POSTS = [
    { x: 176, y: 108, r: 7 }, { x: 230, y: 108, r: 7 },
    { x: 96, y: 470, r: 7 }, { x: 310, y: 470, r: 7 },
    { x: 152, y: 520, r: 9 }, { x: 254, y: 520, r: 9 }
  ];

  var BUMPERS = [
    { x: 146, y: 268, r: 21, flash: 0 },
    { x: 258, y: 268, r: 21, flash: 0 },
    { x: 202, y: 190, r: 21, flash: 0 }
  ];

  /* A slingshot is a triangle with BOTH base vertices sitting exactly on the
   * funnel wall and its apex pushed into the playfield, so the two exposed
   * faces are the rubber. An earlier version had a vertical back edge standing
   * proud of the slope, and a ball wedged in the V behind it — a dead pocket no
   * flipper could reach. Flush base vertices mean there is no behind. */
  function slingshot(ax, ay, cx, cy, bx, by, side) {
    return {
      A: { x: ax, y: ay }, C: { x: cx, y: cy }, B: { x: bx, y: by },
      faces: [
        { a: { x: ax, y: ay }, b: { x: cx, y: cy }, r: WALL_R },
        { a: { x: cx, y: cy }, b: { x: bx, y: by }, r: WALL_R }
      ],
      flash: 0, side: side
    };
  }
  var SLINGS = [
    slingshot(48, 634, 88, 647, 99, 688, -1),
    slingshot(358, 634, 318, 647, 307, 688, 1)
  ];

  // drop-target bank, upper left
  var TARGETS = [
    { x: 74, y: 356, w: 30, down: false, drop: 0 },
    { x: 112, y: 356, w: 30, down: false, drop: 0 },
    { x: 150, y: 356, w: 30, down: false, drop: 0 }
  ];

  // top rollover lanes spelling T O Y
  var LANES = [
    { x: 150, y: 122, lit: false, letter: "T", glow: 0 },
    { x: 203, y: 112, lit: false, letter: "O", glow: 0 },
    { x: 256, y: 122, lit: false, letter: "Y", glow: 0 }
  ];

  var SCOOP = { x: 300, y: 424, r: 15, hold: 0, glow: 0 };

  // orbit sensors: crossing one travelling upward completes a loop
  var ORBITS = [
    { x0: 16, x1: 58, y: 330, armed: true, cool: 0 },
    { x0: 348, x1: 390, y: 330, armed: true, cool: 0 }
  ];

  // ---------------------------------------------------------------- audio

  var Audio2 = (function () {
    var ctx = null, out = null, comp = null, verb = null, wet = null, lp = null, body = null;
    var on = true, ready = false;
    var rollSrc = null, rollGain = null, rollFilt = null;

    function impulse(sec, decay) {
      var rate = ctx.sampleRate, len = Math.floor(rate * sec);
      var buf = ctx.createBuffer(2, len, rate), c, i, n, last0 = 0, last1 = 0;
      for (c = 0; c < 2; c++) {
        var d = buf.getChannelData(c);
        for (i = 0; i < len; i++) {
          n = (Math.random() * 2 - 1);
          // low-passed noise: a raw tail sounds grainy
          if (c === 0) { last0 = last0 * 0.72 + n * 0.28; n = last0; }
          else { last1 = last1 * 0.72 + n * 0.28; n = last1; }
          d[i] = n * Math.pow(1 - i / len, decay);
        }
      }
      return buf;
    }

    function init() {
      if (ready) return;
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      // iOS needs a real buffer to unlock
      var b = ctx.createBuffer(1, 1, 22050), s = ctx.createBufferSource();
      s.buffer = b; s.connect(ctx.destination); s.start(0);

      out = ctx.createGain(); out.gain.value = on ? 1 : 0;
      comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -15; comp.ratio.value = 3;
      comp.attack.value = 0.003; comp.release.value = 0.14;
      lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 12000;

      verb = ctx.createConvolver(); verb.buffer = impulse(2.4, 2.2);
      wet = ctx.createGain(); wet.gain.value = 0.3;
      var hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 300;
      var shelf = ctx.createBiquadFilter(); shelf.type = "highshelf";
      shelf.frequency.value = 4200; shelf.gain.value = 4;

      /* Everything percussive goes through a WOODEN BOX first. A pinball table
       * is a big hollow cabinet and every solenoid in it is heard through that
       * body — two resonant peaks in the low-mid are most of what makes these
       * sounds read as "machine" rather than "sample of a bell". */
      body = ctx.createBiquadFilter();
      body.type = "peaking"; body.frequency.value = 196; body.Q.value = 1.1; body.gain.value = 3.5;
      var body2 = ctx.createBiquadFilter();
      body2.type = "peaking"; body2.frequency.value = 430; body2.Q.value = 1.5; body2.gain.value = 2;
      var boxCut = ctx.createBiquadFilter();
      boxCut.type = "highshelf"; boxCut.frequency.value = 6200; boxCut.gain.value = -4;
      body.connect(body2); body2.connect(boxCut); boxCut.connect(out);

      // a feedback delay that also feeds the hall, so repeats bloom
      var dly = ctx.createDelay(1.0); dly.delayTime.value = 0.13;
      var fb = ctx.createGain(); fb.gain.value = 0.22;
      var dw = ctx.createGain(); dw.gain.value = 0.14;
      out.connect(dly); dly.connect(fb); fb.connect(dly); dly.connect(dw); dw.connect(comp);

      out.connect(comp); comp.connect(lp); lp.connect(ctx.destination);
      comp.connect(hp); hp.connect(verb); verb.connect(shelf); shelf.connect(wet);
      wet.connect(ctx.destination);
      dly.connect(verb);
      ready = true;
      startRoll();
    }

    function now() { return ctx.currentTime; }

    function panNode(p) {
      if (ctx.createStereoPanner) { var n = ctx.createStereoPanner(); n.pan.value = p; return n; }
      var g = ctx.createGain(); return g;
    }

    function noiseBuf(ms) {
      var len = Math.max(1, Math.floor(ctx.sampleRate * ms / 1000));
      var b = ctx.createBuffer(1, len, ctx.sampleRate), d = b.getChannelData(0), i;
      for (i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      return b;
    }

    /* Modal contact: a noise burst pushed through parallel resonant bandpasses
     * tuned to the object's own modes. Burst LENGTH drives the level as much as
     * gain does — a 2ms click cannot pump a narrow resonator — so bursts here
     * are 8-22ms and each mode carries a sqrt(Q) makeup term. */
    function modal(f0, ratios, decay, amp, burstMs, pan) {
      if (!ready) return;
      var t = now();
      var src = ctx.createBufferSource();
      src.buffer = noiseBuf(burstMs);
      var env = ctx.createGain();
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(1, t + 0.0012);
      env.gain.exponentialRampToValueAtTime(0.0008, t + burstMs / 1000);
      src.connect(env);

      var mix = ctx.createGain(); mix.gain.value = amp;
      var p = panNode(pan || 0);
      for (var i = 0; i < ratios.length; i++) {
        var f = f0 * ratios[i];
        if (f > 15000) continue;
        var bp = ctx.createBiquadFilter();
        bp.type = "bandpass"; bp.frequency.value = f;
        var d = decay / (1 + i * 0.85);
        var Q = Math.max(2, Math.PI * f * d);
        bp.Q.value = Q;
        var g = ctx.createGain();
        // noise through a bandpass loses energy as 1/sqrt(Q); put it back
        g.gain.value = Math.sqrt(Q) / (1 + i * 0.6);
        var e = ctx.createGain();
        e.gain.setValueAtTime(1, t);
        e.gain.exponentialRampToValueAtTime(0.0006, t + d);
        env.connect(bp); bp.connect(g); g.connect(e); e.connect(mix);
      }
      mix.connect(p); p.connect(out);
      src.start(t); src.stop(t + Math.max(0.4, decay + 0.1));
    }

    /* A ringing bell cannot be driven by a noise burst — the burst is gone long
     * before the tail. Long tails are ADDITIVE, with inharmonic ratios plus a
     * noise strike so it still starts like something being struck. */
    function bell(f0, amp, pan, dur) {
      if (!ready) return;
      var t = now(), ratios = [1, 2, 3.01, 4.17, 5.43, 6.79];
      var mix = ctx.createGain(); mix.gain.value = amp;
      var p = panNode(pan || 0);
      for (var i = 0; i < ratios.length; i++) {
        var o = ctx.createOscillator();
        o.type = "sine";
        o.frequency.value = f0 * ratios[i] * (1 + (Math.random() - 0.5) * 0.004);
        var g = ctx.createGain();
        var d = dur / (1 + i * 0.7);
        var a = 1 / (1 + i * 1.25);
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(a, t + 0.004);
        g.gain.exponentialRampToValueAtTime(0.0005, t + d);
        o.connect(g); g.connect(mix);
        o.start(t); o.stop(t + d + 0.05);
      }
      // strike transient
      var s = ctx.createBufferSource(); s.buffer = noiseBuf(9);
      var sf = ctx.createBiquadFilter(); sf.type = "bandpass";
      sf.frequency.value = f0 * 4.5; sf.Q.value = 1.1;
      var sg = ctx.createGain(); sg.gain.value = 0.5;
      s.connect(sf); sf.connect(sg); sg.connect(mix);
      s.start(t); s.stop(t + 0.05);
      mix.connect(p); p.connect(out);
    }

    /* A pop bumper, a slingshot and a flipper are all the same event: a coil
     * slams a plunger into a stop. That is a low mechanical THUMP with a coil
     * buzz and a metal clack on top — and it is most of what says "pinball".
     * Chimes alone read as a toy; this is the layer that was missing. */
    function solenoid(amp, pan, tone) {
      if (!ready) return;
      var t = now();
      var mix = ctx.createGain(); mix.gain.value = amp;
      var pn = panNode(pan || 0);

      // the coil pulling: a fast low thump
      var o = ctx.createOscillator(); o.type = "sine";
      o.frequency.setValueAtTime(150 * tone, t);
      o.frequency.exponentialRampToValueAtTime(46 * tone, t + 0.075);
      var og = ctx.createGain();
      og.gain.setValueAtTime(0.0001, t);
      og.gain.linearRampToValueAtTime(1, t + 0.003);
      og.gain.exponentialRampToValueAtTime(0.0005, t + 0.1);
      o.connect(og); og.connect(mix);
      o.start(t); o.stop(t + 0.12);

      // the plunger hitting its stop: a hard, short metal clack
      var n = ctx.createBufferSource(); n.buffer = noiseBuf(26);
      var bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = (1500 + Math.random() * 500) * tone;
      bp.Q.value = 1.4;
      var ng = ctx.createGain();
      ng.gain.setValueAtTime(0.0001, t);
      ng.gain.linearRampToValueAtTime(0.62, t + 0.001);
      ng.gain.exponentialRampToValueAtTime(0.0005, t + 0.035);
      n.connect(bp); bp.connect(ng); ng.connect(mix);
      n.start(t); n.stop(t + 0.06);

      // 60Hz coil buzz, very short — the electrical part of the sound
      var b = ctx.createOscillator(); b.type = "square";
      b.frequency.value = 118;
      var bg = ctx.createGain();
      bg.gain.setValueAtTime(0.12, t);
      bg.gain.exponentialRampToValueAtTime(0.0004, t + 0.045);
      b.connect(bg); bg.connect(mix);
      b.start(t); b.stop(t + 0.06);

      mix.connect(pn); pn.connect(body);
    }

    /* The ball stays in contact with a bat or a bumper for several substeps, so
     * the collision handler fires the voice many times for ONE event. Measured
     * unthrottled, a single flip peaked at 3.35 — four times into clipping.
     * Throttle each voice to one hit per physical event. */
    var lastAt = {};
    function throttled(nameKey, ms) {
      var t = ctx ? ctx.currentTime : 0;
      if (lastAt[nameKey] && t - lastAt[nameKey] < ms / 1000) return true;
      lastAt[nameKey] = t;
      return false;
    }

    function startRoll() {
      if (!ready || rollSrc) return;
      var len = Math.floor(ctx.sampleRate * 2), b = ctx.createBuffer(1, len, ctx.sampleRate);
      var d = b.getChannelData(0), last = 0, i;
      for (i = 0; i < len; i++) {
        var w = Math.random() * 2 - 1;
        last = (last + 0.04 * w) / 1.04;      // brown-ish
        d[i] = last * 5;
      }
      rollSrc = ctx.createBufferSource(); rollSrc.buffer = b; rollSrc.loop = true;
      rollFilt = ctx.createBiquadFilter(); rollFilt.type = "bandpass";
      rollFilt.frequency.value = 220; rollFilt.Q.value = 0.9;
      rollGain = ctx.createGain(); rollGain.gain.value = 0;
      rollSrc.connect(rollFilt); rollFilt.connect(rollGain); rollGain.connect(out);
      rollSrc.start();
    }

    return {
      init: init,
      isReady: function () { return ready; },
      setOn: function (v) { on = v; if (out) out.gain.setTargetAtTime(v ? 1 : 0, now(), 0.01); },
      /* Flipper = coil clack THROUGH the cabinet + the rubber contact. A live
       * flip is a much harder event than the ball merely resting on the bat. */
      flip: function (pan, hard) {
        init();
        if (throttled("flip" + (pan < 0 ? "L" : "R"), 70)) return;
        var v = 0.4 + (hard || 0) * 0.6;
        solenoid(0.3 * v, pan, 1.0);
        modal(196 * (0.97 + Math.random() * 0.06), [1, 2.44, 4.12, 6.7], 0.075, 0.5 * v, 16, pan);
      },
      // pop bumper: the coil fires, then the chime rings out of the cabinet
      bumper: function (pan, n, vel) {
        init();
        if (throttled("bump" + n, 55)) return;
        var v = 0.45 + Math.min(1, (vel || 500) / 1100) * 0.55;
        solenoid(0.42 * v, pan, 0.92 + (n % 3) * 0.06);
        bell((430 + (n % 3) * 62) * (0.995 + Math.random() * 0.01), 0.2 * v, pan, 0.44 + v * 0.2);
      },
      sling: function (pan, vel) {
        init();
        if (throttled("sling" + (pan < 0 ? "L" : "R"), 60)) return;
        var v = 0.5 + Math.min(1, (vel || 500) / 1100) * 0.5;
        solenoid(0.34 * v, pan, 1.25);
        modal(320 * (0.96 + Math.random() * 0.08), [1, 2.31, 4.07, 6.62], 0.05, 1.5 * v, 18, pan);
      },
      target: function (pan) {
        init();
        // a drop target is a plastic face falling into a metal frame
        modal(560 * (0.95 + Math.random() * 0.1), [1, 2.71, 4.93, 7.4], 0.045, 1.5, 16, pan);
        solenoid(0.16, pan, 1.5);
      },
      // the knocker: one loud mechanical rap for a real award
      knocker: function () {
        init(); if (!ready) return;
        solenoid(0.8, 0, 0.72);
        setTimeout(function () { solenoid(0.28, 0, 0.8); }, 62);
      },
      wall: function (pan, v) {
        init();
        if (!ready || v < 220) return;
        if (throttled("wall", 34)) return;
        // ball on steel rail: brighter and louder the harder it arrives
        modal(150 * (0.9 + Math.random() * 0.2), [1, 2.7, 5.1], 0.03,
              Math.min(0.6, v / 2600), 10, pan);
      },
      lane: function (pan, i) { init(); bell(720 * Math.pow(1.26, i), 0.13, pan, 0.34); },
      scoop: function () {
        init(); if (!ready) return;
        var i, t = now();
        for (i = 0; i < 4; i++) setTimeout(function (k) {
          return function () { bell(520 * Math.pow(1.335, k), 0.16, 0, 0.5); };
        }(i), i * 88);
      },
      plunger: function (power) {
        init(); if (!ready) return;
        var t = now();
        var s = ctx.createBufferSource(); s.buffer = noiseBuf(220);
        var bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = 9;
        bp.frequency.setValueAtTime(120 + power * 90, t);
        bp.frequency.exponentialRampToValueAtTime(600 + power * 900, t + 0.09);
        bp.frequency.exponentialRampToValueAtTime(200, t + 0.22);
        var g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(1.05 * (0.4 + power * 0.6), t + 0.006);
        g.gain.exponentialRampToValueAtTime(0.0005, t + 0.24);
        s.connect(bp); bp.connect(g); g.connect(out);
        s.start(t); s.stop(t + 0.26);
      },
      drain: function () {
        init(); if (!ready) return;
        var t = now();
        var o = ctx.createOscillator(); o.type = "sine";
        o.frequency.setValueAtTime(150, t);
        o.frequency.exponentialRampToValueAtTime(46, t + 0.5);
        var g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.3, t + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0005, t + 0.6);
        o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.62);
        modal(110, [1, 2.4, 3.9], 0.13, 0.4, 20, 0);
      },
      gameOver: function () {
        init(); if (!ready) return;
        var notes = [523.25, 392, 329.63, 261.63], i;
        for (i = 0; i < notes.length; i++) setTimeout(function (f) {
          return function () { bell(f, 0.17, 0, 1.1); };
        }(notes[i]), i * 150);
      },
      roll: function (speed) {
        if (!ready || !rollGain) return;
        var s = Math.min(1, speed / 1500);
        rollGain.gain.setTargetAtTime(on ? s * s * 0.11 : 0, now(), 0.06);
        rollFilt.frequency.setTargetAtTime(150 + s * 460, now(), 0.06);
      }
    };
  })();

  // ---------------------------------------------------------------- swept collision

  function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y }; }
  function dot(a, b) { return a.x * b.x + a.y * b.y; }
  function len(a) { return Math.sqrt(a.x * a.x + a.y * a.y); }
  function norm(a) { var l = len(a) || 1; return { x: a.x / l, y: a.y / l }; }

  // earliest t in [0,tMax] where a circle at p moving v touches circle (c,rad)
  function sweepCircle(p, v, r, c, rad, tMax) {
    var m = sub(p, c), R = r + rad;
    var b = dot(m, v), cc = dot(m, m) - R * R;
    if (cc < 0) {                       // already overlapping: resolve now
      return b < 0 ? 0 : -1;
    }
    if (b >= 0) return -1;
    var a = dot(v, v);
    if (a < 1e-9) return -1;
    var disc = b * b - a * cc;
    if (disc < 0) return -1;
    var t = (-b - Math.sqrt(disc)) / a;
    return (t >= 0 && t <= tMax) ? t : -1;
  }

  // earliest t where circle (p,r) moving v touches capsule segment s
  function sweepSegment(p, v, r, s, tMax) {
    var ab = sub(s.b, s.a), abLen = len(ab);
    if (abLen < 1e-6) return null;
    var n = { x: -ab.y / abLen, y: ab.x / abLen };
    var R = r + s.r;
    var d = dot(sub(p, s.a), n);
    var vn = dot(v, n);
    var best = -1, bn = null;

    // flat face of the capsule
    if (Math.abs(d) > R || vn !== 0) {
      var sign = d >= 0 ? 1 : -1;
      var t;
      if (Math.abs(d) <= R) t = 0;
      else if (vn * sign < 0) t = (Math.abs(d) - R) / Math.abs(vn);
      else t = -1;
      if (t >= 0 && t <= tMax) {
        var hx = p.x + v.x * t, hy = p.y + v.y * t;
        var proj = ((hx - s.a.x) * ab.x + (hy - s.a.y) * ab.y) / (abLen * abLen);
        if (proj >= 0 && proj <= 1) { best = t; bn = { x: n.x * sign, y: n.y * sign }; }
      }
    }
    // rounded ends
    var ends = [s.a, s.b], i, te, cx, cy;
    for (i = 0; i < 2; i++) {
      te = sweepCircle(p, v, r, ends[i], s.r, tMax);
      if (te >= 0 && (best < 0 || te < best)) {
        cx = p.x + v.x * te; cy = p.y + v.y * te;
        best = te; bn = norm({ x: cx - ends[i].x, y: cy - ends[i].y });
      }
    }
    return best < 0 ? null : { t: best, n: bn };
  }

  // ---------------------------------------------------------------- game state

  var G = {
    mode: "intro",          // intro | serve | play | drained | over
    score: 0, best: 0, ball: 1,
    mult: 1, combo: 0,
    plunger: 0, plungerHeld: false,
    shake: 0, shakeX: 0, shakeY: 0,
    flash: 0,
    tilt: 0, nudges: 0, tiltCool: 0,
    skillLane: 1, skillLive: false,
    msg: "", msgT: 0,
    started: false
  };

  var ball = { x: 407, y: 720, vx: 0, vy: 0, live: false, trail: [] };
  var flipL = { a: FLIP_REST_L, rest: FLIP_REST_L, up: FLIP_UP_L, held: false, w: 0 };
  var flipR = { a: FLIP_REST_R, rest: FLIP_REST_R, up: FLIP_UP_R, held: false, w: 0 };
  var particles = [];
  var pops = [];

  function say(t, dur) { G.msg = t; G.msgT = dur || 1.6; }

  function addScore(n, x, y, label) {
    var got = n * G.mult;
    G.score += got;
    if (label) pops.push({ x: x, y: y, t: 0, txt: label, big: true });
    else pops.push({ x: x, y: y, t: 0, txt: "+" + got, big: false });
    if (G.score > G.best) {
      G.best = G.score;
      try { localStorage.setItem("pinball_best", String(G.best)); } catch (e) {}
    }
  }

  function burst(x, y, n, hue, spd) {
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2, s = (0.4 + Math.random()) * (spd || 130);
      particles.push({
        x: x, y: y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: 0.32 + Math.random() * 0.34, t: 0, hue: hue
      });
    }
  }

  function panOf(x) { return Math.max(-1, Math.min(1, (x - TW / 2) / (TW / 2))) * 0.7; }

  // ---------------------------------------------------------------- physics

  function flipperSeg(f, pivot) {
    return {
      a: { x: pivot.x, y: pivot.y },
      b: { x: pivot.x + Math.cos(f.a) * FLIP_LEN, y: pivot.y + Math.sin(f.a) * FLIP_LEN },
      r: FLIP_R
    };
  }

  function stepFlipper(f, dt) {
    var target = f.held ? f.up : f.rest;
    var span = Math.abs(f.up - f.rest);
    var rate = span / FLIP_TIME;
    var prev = f.a;
    if (f.a < target) f.a = Math.min(target, f.a + rate * dt);
    else if (f.a > target) f.a = Math.max(target, f.a - rate * dt);
    f.w = (f.a - prev) / dt;
  }

  /* A surface cannot push an object faster than the surface itself is moving.
   * Without this the ball stayed in contact through the whole 44ms stroke and
   * took a fresh impulse every substep — the contact point slides outward as
   * the bat rotates, so the surface keeps catching up — and it left the bat at
   * 2600 u/s instead of the bat's own 1571. Cap the result at the local
   * contact-point speed plus a small elastic bonus. */
  function capToBat(vx, vy, cvx, cvy) {
    var lim = Math.sqrt(cvx * cvx + cvy * cvy) + 140;
    var sp = Math.sqrt(vx * vx + vy * vy);
    if (sp > lim && sp > 1e-6) { vx = vx / sp * lim; vy = vy / sp * lim; }
    return { x: vx, y: vy };
  }

  function reflect(v, n, rest) {
    var vn = dot(v, n);
    if (vn > 0) return v;                    // already separating
    return {
      x: v.x - (1 + rest) * vn * n.x,
      y: v.y - (1 + rest) * vn * n.y
    };
  }

  function collideStep(dt) {
    var p = { x: ball.x, y: ball.y };
    var v = { x: ball.vx, y: ball.vy };
    var remaining = dt, guard = 0;

    while (remaining > 1e-6 && guard++ < 5) {
      var bestT = remaining, hit = null;

      // static walls
      for (var i = 0; i < WALLS.length; i++) {
        var h = sweepSegment(p, v, BALL_R, WALLS[i], bestT);
        if (h && h.t <= bestT) { bestT = h.t; hit = { n: h.n, type: "wall", rest: 0.36, ref: WALLS[i] }; }
      }
      // one-way gate: solid only to a ball heading down into the lane
      if (v.y > 0) {
        var hg = sweepSegment(p, v, BALL_R, GATE, bestT);
        if (hg && hg.t <= bestT) { bestT = hg.t; hit = { n: hg.n, type: "wall", rest: 0.2, ref: GATE }; }
      }
      // posts
      for (i = 0; i < POSTS.length; i++) {
        var tp = sweepCircle(p, v, BALL_R, POSTS[i], POSTS[i].r, bestT);
        if (tp >= 0 && tp <= bestT) {
          var cp = { x: p.x + v.x * tp, y: p.y + v.y * tp };
          bestT = tp; hit = { n: norm(sub(cp, POSTS[i])), type: "wall", rest: 0.5 };
        }
      }
      // pop bumpers
      for (i = 0; i < BUMPERS.length; i++) {
        var tb = sweepCircle(p, v, BALL_R, BUMPERS[i], BUMPERS[i].r, bestT);
        if (tb >= 0 && tb <= bestT) {
          var cb = { x: p.x + v.x * tb, y: p.y + v.y * tb };
          bestT = tb; hit = { n: norm(sub(cb, BUMPERS[i])), type: "bumper", idx: i, rest: 0.2 };
        }
      }
      // slingshot kicking faces
      for (i = 0; i < SLINGS.length; i++) {
        for (var fi = 0; fi < SLINGS[i].faces.length; fi++) {
          var hs = sweepSegment(p, v, BALL_R, SLINGS[i].faces[fi], bestT);
          if (hs && hs.t <= bestT) { bestT = hs.t; hit = { n: hs.n, type: "sling", idx: i, rest: 0.2 }; }
        }
      }
      // drop targets that are still standing
      for (i = 0; i < TARGETS.length; i++) {
        if (TARGETS[i].down) continue;
        var tg = TARGETS[i];
        var ts = { a: { x: tg.x, y: tg.y }, b: { x: tg.x + tg.w, y: tg.y }, r: 4 };
        var ht = sweepSegment(p, v, BALL_R, ts, bestT);
        if (ht && ht.t <= bestT) { bestT = ht.t; hit = { n: ht.n, type: "target", idx: i, rest: 0.35 }; }
      }
      // flippers (capsules that move; contact velocity is added on response)
      var fl = flipperSeg(flipL, LEFT_PIVOT), fr = flipperSeg(flipR, RIGHT_PIVOT);
      var hfl = sweepSegment(p, v, BALL_R, fl, bestT);
      if (hfl && hfl.t <= bestT) { bestT = hfl.t; hit = { n: hfl.n, type: "flipper", f: flipL, pivot: LEFT_PIVOT, rest: FLIP_REST }; }
      var hfr = sweepSegment(p, v, BALL_R, fr, bestT);
      if (hfr && hfr.t <= bestT) { bestT = hfr.t; hit = { n: hfr.n, type: "flipper", f: flipR, pivot: RIGHT_PIVOT, rest: FLIP_REST }; }

      // advance to the impact (or through the whole remaining slice)
      p.x += v.x * bestT; p.y += v.y * bestT;
      remaining -= bestT;
      if (!hit) break;

      // nudge out of the surface so the next sweep starts clean
      p.x += hit.n.x * 0.08; p.y += hit.n.y * 0.08;
      var speed = len(v);

      if (hit.type === "bumper") {
        var bm = BUMPERS[hit.idx];
        bm.flash = 1;
        v = reflect(v, hit.n, hit.rest);
        v.x += hit.n.x * 520; v.y += hit.n.y * 520;
        addScore(100, bm.x, bm.y);
        G.combo++;
        burst(bm.x, bm.y, 12, 190, 200);
        G.shake = Math.max(G.shake, 0.35);
        Audio2.bumper(panOf(bm.x), hit.idx, speed);
      } else if (hit.type === "sling") {
        var sg2 = SLINGS[hit.idx];
        sg2.flash = 1;
        v = reflect(v, hit.n, hit.rest);
        v.x += hit.n.x * 560; v.y += hit.n.y * 560;
        addScore(50, sg2.C.x, sg2.C.y);
        burst(sg2.C.x, sg2.C.y, 8, 320, 180);
        G.shake = Math.max(G.shake, 0.25);
        Audio2.sling(panOf(sg2.C.x), speed);
      } else if (hit.type === "target") {
        var tt = TARGETS[hit.idx];
        tt.down = true; tt.drop = 1;
        v = reflect(v, hit.n, hit.rest);
        addScore(500, tt.x + tt.w / 2, tt.y);
        burst(tt.x + tt.w / 2, tt.y, 10, 48, 170);
        Audio2.target(panOf(tt.x));
        var allDown = TARGETS.every(function (q) { return q.down; });
        if (allDown) {
          addScore(5000, TW / 2, 400, "BANK COMPLETE  +" + (5000 * G.mult));
          G.flash = 1;
          burst(TW / 2, 380, 30, 48, 260);
          Audio2.knocker();
          setTimeout(function () {
            for (var k = 0; k < TARGETS.length; k++) { TARGETS[k].down = false; TARGETS[k].drop = 0; }
          }, 900);
          Audio2.scoop();
        }
      } else if (hit.type === "flipper") {
        var f = hit.f, pv = hit.pivot;
        // velocity of the flipper surface at the contact point: w x r
        var rx = p.x - pv.x, ry = p.y - pv.y;
        var cvx = -f.w * ry, cvy = f.w * rx;
        var rel = { x: v.x - cvx, y: v.y - cvy };
        var out2 = reflect(rel, hit.n, hit.rest);
        v = { x: out2.x + cvx, y: out2.y + cvy };
        // only a MOVING bat gets capped: a still bat is just a dead rubber
        // surface, and a fast ball bouncing off it is legitimate
        if (Math.abs(f.w) > 4) v = capToBat(v.x, v.y, cvx, cvy);
        if (Math.abs(f.w) > 4) {
          // a live flip adds a little punch beyond simple reflection. Keep it
          // small: the contact velocity should stay the dominant term, or every
          // shot saturates the speed clamp and WHERE you catch the ball on the
          // bat stops mattering — which is the whole skill of the game.
          v.x += hit.n.x * 60; v.y += hit.n.y * 60;
          burst(p.x, p.y, 5, 205, 120);
        }
        Audio2.flip(panOf(p.x), Math.min(1, Math.abs(f.w) / 24));
      } else {
        v = reflect(v, hit.n, hit.rest);
        Audio2.wall(panOf(p.x), speed);
      }

      if (len(v) > MAX_SPEED) { var u = norm(v); v = { x: u.x * MAX_SPEED, y: u.y * MAX_SPEED }; }
    }

    ball.x = p.x; ball.y = p.y; ball.vx = v.x; ball.vy = v.y;
  }

  /* A flipper sweeps 60 degrees in 44ms; even at 240Hz it covers 5 degrees per
   * substep, which is enough to close on a ball that the swept test already
   * passed. If the bat ends a substep overlapping the ball, push the ball back
   * to the surface and hand it the contact velocity — otherwise a hard flip can
   * squeeze it straight through the bat and into the drain. */
  function resolveFlipperOverlap(f, pivot) {
    var ax = pivot.x, ay = pivot.y;
    var bx = ax + Math.cos(f.a) * FLIP_LEN, by = ay + Math.sin(f.a) * FLIP_LEN;
    var dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
    var t = L2 ? ((ball.x - ax) * dx + (ball.y - ay) * dy) / L2 : 0;
    t = Math.max(0, Math.min(1, t));
    var cx = ax + dx * t, cy = ay + dy * t;
    var nx = ball.x - cx, ny = ball.y - cy;
    var d = Math.sqrt(nx * nx + ny * ny);
    var minD = BALL_R + FLIP_R;
    if (d >= minD || d < 1e-6) return;
    nx /= d; ny /= d;
    ball.x = cx + nx * minD;
    ball.y = cy + ny * minD;
    if (Math.abs(f.w) > 4) {
      var rx = ball.x - ax, ry = ball.y - ay;
      var cvx = -f.w * ry, cvy = f.w * rx;
      // reflect the ball's velocity RELATIVE to the moving bat, then put the
      // bat's motion back. Adding the contact velocity on top of that as well
      // double-counted it and every shot blew past the speed clamp.
      var vn = (ball.vx - cvx) * nx + (ball.vy - cvy) * ny;
      if (vn < 0) {
        var cap = capToBat(
          ball.vx - (1 + FLIP_REST) * vn * nx,
          ball.vy - (1 + FLIP_REST) * vn * ny,
          cvx, cvy);
        ball.vx = cap.x; ball.vy = cap.y;
      }
      // leave a real gap so the ball separates instead of riding the bat
      ball.x = cx + nx * (minD + 0.6);
      ball.y = cy + ny * (minD + 0.6);
    }
    var sp = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
    if (sp > MAX_SPEED) { ball.vx = ball.vx / sp * MAX_SPEED; ball.vy = ball.vy / sp * MAX_SPEED; }
  }

  function sensors(dt) {
    var i;
    // top rollover lanes
    for (i = 0; i < LANES.length; i++) {
      var L = LANES[i];
      if (!L.lit && Math.abs(ball.x - L.x) < 20 && Math.abs(ball.y - L.y) < 18) {
        L.lit = true; L.glow = 1;
        addScore(250, L.x, L.y);
        Audio2.lane(panOf(L.x), i);
        if (G.skillLive && i === G.skillLane) {
          G.skillLive = false;
          addScore(5000, TW / 2, 200, "SKILL SHOT  +" + (5000 * G.mult));
          G.flash = 1; burst(L.x, L.y, 26, 168, 240);
          Audio2.knocker();
        }
        if (LANES.every(function (q) { return q.lit; })) {
          G.mult = Math.min(5, G.mult + 1);
          say("MULTIPLIER  " + G.mult + "x", 2);
          G.flash = 1;
          for (var k = 0; k < LANES.length; k++) { LANES[k].lit = false; }
          burst(TW / 2, 130, 24, 168, 220);
          Audio2.scoop();
        }
      }
    }
    // orbit loops
    for (i = 0; i < ORBITS.length; i++) {
      var O = ORBITS[i];
      O.cool = Math.max(0, O.cool - dt);
      if (O.cool === 0 && ball.vy < -120 && ball.x > O.x0 && ball.x < O.x1 &&
          Math.abs(ball.y - O.y) < 26) {
        O.cool = 1.1;
        addScore(1000, (O.x0 + O.x1) / 2, O.y, "ORBIT  +" + (1000 * G.mult));
        G.combo++;
        burst((O.x0 + O.x1) / 2, O.y, 12, 285, 190);
        Audio2.lane(panOf(ball.x), 2);
      }
    }
    // scoop: capture, reward, eject
    if (SCOOP.hold > 0) {
      SCOOP.hold -= dt;
      ball.x = SCOOP.x; ball.y = SCOOP.y; ball.vx = 0; ball.vy = 0;
      if (SCOOP.hold <= 0) {
        ball.vy = -1180; ball.vx = -160;
        burst(SCOOP.x, SCOOP.y, 18, 40, 220);
      }
      return;
    }
    var dsx = ball.x - SCOOP.x, dsy = ball.y - SCOOP.y;
    if (dsx * dsx + dsy * dsy < (SCOOP.r + 2) * (SCOOP.r + 2) && len({ x: ball.vx, y: ball.vy }) < 900) {
      SCOOP.hold = 1.0; SCOOP.glow = 1;
      addScore(2500, SCOOP.x, SCOOP.y, "SCOOP  +" + (2500 * G.mult));
      G.flash = 1;
      Audio2.scoop();
    }
  }

  function physics(dt) {
    if (G.mode !== "play" && G.mode !== "serve") return;
    stepFlipper(flipL, dt);
    stepFlipper(flipR, dt);
    if (!ball.live) return;

    if (SCOOP.hold > 0) { sensors(dt); return; }

    ball.vy += GRAV * dt;
    if (G.tilt <= 0) {
      // gentle air drag so the ball settles instead of pinging forever
      ball.vx *= (1 - 0.28 * dt);
      ball.vy *= (1 - 0.16 * dt);
    }
    collideStep(dt);
    resolveFlipperOverlap(flipL, LEFT_PIVOT);
    resolveFlipperOverlap(flipR, RIGHT_PIVOT);
    sensors(dt);

    // Drained. The cut-off sits just below the flipper tips rather than under
    // the table: the trough has no side walls, so a ball left alive down there
    // can slide out past the cabinet edge and be seen doing it.
    if (ball.y > 772) {
      ball.live = false;
      G.combo = 0;
      Audio2.drain();
      if (G.ball >= BALLS_PER_GAME) {
        G.mode = "over";
        setTimeout(function () { Audio2.gameOver(); }, 260);
        showOver();
      } else {
        G.ball++;
        G.mode = "drained";
        say("BALL " + G.ball, 1.4);
        setTimeout(serve, 1100);
      }
    }
  }

  // ---------------------------------------------------------------- flow

  function serve() {
    ball.x = 407; ball.y = 726; ball.vx = 0; ball.vy = 0;
    ball.live = true; ball.trail.length = 0;
    G.plunger = 0;
    G.mode = "serve";
    G.tilt = 0; G.nudges = 0;
    SCOOP.hold = 0;
    G.skillLane = Math.floor(Math.random() * 3);
    G.skillLive = true;
    for (var i = 0; i < ORBITS.length; i++) ORBITS[i].cool = 0;
    updateHud();
  }

  function startGame() {
    G.score = 0; G.ball = 1; G.mult = 1; G.combo = 0;
    for (var i = 0; i < TARGETS.length; i++) { TARGETS[i].down = false; TARGETS[i].drop = 0; }
    for (i = 0; i < LANES.length; i++) LANES[i].lit = false;
    G.started = true;
    hideOverlay();
    // the hint has done its job once play starts; it also collides with the
    // back-link on a narrow screen, so it should not live there forever
    var hintEl = document.getElementById("hint");
    if (hintEl) setTimeout(function () { hintEl.classList.add("is-gone"); }, 6000);
    serve();
    if (window.gtag) window.gtag("event", "toy_start", { toy_slug: "pinball" });
  }

  function launch() {
    if (G.mode !== "serve" || !ball.live) return;
    var pw = G.plunger;
    ball.vy = -(920 + 1020 * pw);
    ball.vx = 0;
    G.plunger = 0;
    G.mode = "play";
    Audio2.plunger(pw);
    updateHud();
  }

  function nudge(dir) {
    if (G.mode !== "play" || G.tilt > 0 || G.tiltCool > 0) return;
    ball.vx += dir * 250;
    ball.vy -= 70;
    G.shakeX = dir * 8;
    G.shake = Math.max(G.shake, 0.4);
    G.nudges++;
    G.tiltCool = 0.45;
    if (G.nudges >= 4) {
      G.tilt = 1;
      say("TILT", 2.4);
      flipL.held = false; flipR.held = false;
    } else if (G.nudges === 3) {
      say("careful…", 1.1);
    }
  }

  // ---------------------------------------------------------------- rendering

  var cv = document.getElementById("canvas");
  var ctx = cv.getContext("2d");
  var W = 0, H = 0, DPR = 1, SC = 1, OX = 0, OY = 0;
  var staticCv = null, staticCtx = null;
  var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function resize() {
    DPR = Math.min(2, window.devicePixelRatio || 1);
    W = window.innerWidth; H = window.innerHeight;
    cv.width = Math.floor(W * DPR); cv.height = Math.floor(H * DPR);
    cv.style.width = W + "px"; cv.style.height = H + "px";
    // fit the table with room for the cabinet edge
    var pad = Math.min(W, H) < 560 ? 8 : 26;
    SC = Math.min((W - pad * 2) / TW, (H - pad * 2) / TH);
    OX = (W - TW * SC) / 2;
    OY = (H - TH * SC) / 2;
    buildStatic();
  }

  function T(x, y) { return { x: OX + x * SC, y: OY + y * SC }; }

  function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  // Neon is drawn as a wide translucent underlay plus a thin bright core —
  // shadowBlur on every stroke is far too slow to do this per frame.
  function neonLine(c, x1, y1, x2, y2, w, col, glowCol) {
    c.lineCap = "round";
    c.strokeStyle = glowCol; c.lineWidth = w * 3.4;
    c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke();
    c.strokeStyle = col; c.lineWidth = w;
    c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke();
  }

  // Rails read as real wire guides: a dark base, a bright top highlight and a
  // soft cast shadow, drawn in three passes over the whole set so the layers
  // never interleave and leave a rail sitting on top of its neighbour's shadow.
  /* A rail is a chromed steel wire standing a few mm above the board. Flat
   * stroke + one highlight reads as a drawn line; a real one has a dark
   * underside, a bright specular running along its top and a soft shadow cast
   * down-right onto the playfield. Passes are drawn across the WHOLE set so a
   * later rail's shadow never lands on an earlier rail's highlight. */
  var RAIL_PASSES = [
    { off: [2.4, 3.2], col: "rgba(0, 0, 0, 0.55)", mul: 1.35, blur: true },
    { off: [0, 0], col: "#141a30", mul: 1.15 },
    { off: [0, 0], col: "#3d466b", mul: 0.92 },
    { off: [-0.22, -0.32], col: "#8b9ac4", mul: 0.55 },
    { off: [-0.34, -0.5], col: "#eaf1ff", mul: 0.22 }
  ];

  function railPass(c, list, pass) {
    var cfg = RAIL_PASSES[pass];
    for (var i = 0; i < list.length; i++) {
      var s2 = list[i];
      var a = T(s2.a.x, s2.a.y), b = T(s2.b.x, s2.b.y);
      var w = s2.r * 2 * SC;
      c.lineCap = "round";
      c.strokeStyle = cfg.col;
      c.lineWidth = Math.max(0.6, w * cfg.mul);
      c.beginPath();
      c.moveTo(a.x + cfg.off[0] * SC, a.y + cfg.off[1] * SC);
      c.lineTo(b.x + cfg.off[0] * SC, b.y + cfg.off[1] * SC);
      c.stroke();
    }
  }

  function insert(c, x, y, w, h, rot, col, lit) {
    var p = T(x, y);
    c.save();
    c.translate(p.x, p.y);
    c.rotate(rot);
    var W2 = w * SC, H2 = h * SC;
    if (lit > 0.02) {
      c.shadowColor = col; c.shadowBlur = 22 * SC * lit;
    }
    roundRect(c, -W2 / 2, -H2 / 2, W2, H2, Math.min(W2, H2) * 0.42);
    c.fillStyle = lit > 0.02
      ? "rgba(255,255,255," + (0.35 + lit * 0.55) + ")"
      : "rgba(255,255,255,0.055)";
    c.fill();
    c.shadowBlur = 0;
    c.strokeStyle = lit > 0.02 ? col : "rgba(200, 220, 255, 0.13)";
    c.lineWidth = Math.max(0.8, 1.3 * SC);
    c.stroke();
    c.restore();
  }

  var _grain = null;
  function grainCanvas() {
    if (_grain) return _grain;
    var n = 128;
    var g = document.createElement("canvas");
    g.width = n; g.height = n;
    var gc = g.getContext("2d");
    var img = gc.createImageData(n, n);
    for (var i = 0; i < n * n; i++) {
      // fine, mostly-neutral speckle; overlay mode turns it into tooth
      var v = 118 + (Math.random() * 32 - 16) + (Math.random() < 0.02 ? 26 : 0);
      img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    gc.putImageData(img, 0, 0);
    _grain = g;
    return g;
  }

  function buildStatic() {
    if (!staticCv) { staticCv = document.createElement("canvas"); staticCtx = staticCv.getContext("2d"); }
    staticCv.width = Math.max(1, Math.floor(W * DPR));
    staticCv.height = Math.max(1, Math.floor(H * DPR));
    var c = staticCtx;
    c.setTransform(DPR, 0, 0, DPR, 0, 0);
    c.clearRect(0, 0, W, H);

    var tl = T(0, 0), br = T(TW, TH);
    var pw = br.x - tl.x, ph = br.y - tl.y;

    // ---- the room the machine stands in. On a wide screen the playfield is a
    // tall column with a lot of dead space either side, so the surround has to
    // carry real imagery: a back wall, a nebula mural, and lit cabinet side art.
    var room = c.createLinearGradient(0, 0, 0, H);
    room.addColorStop(0, "#0b0c1e");
    room.addColorStop(0.52, "#090a18");
    room.addColorStop(0.78, "#07070f");
    room.addColorStop(1, "#0a0812");
    c.fillStyle = room; c.fillRect(0, 0, W, H);

    // mural on the back wall: a wide nebula behind the machine
    var neb = c.createRadialGradient(W * 0.5, H * 0.3, 10, W * 0.5, H * 0.34, Math.max(W, H) * 0.62);
    neb.addColorStop(0, "rgba(96, 66, 200, 0.30)");
    neb.addColorStop(0.35, "rgba(58, 40, 140, 0.16)");
    neb.addColorStop(0.7, "rgba(30, 22, 78, 0.07)");
    neb.addColorStop(1, "rgba(0,0,0,0)");
    c.fillStyle = neb; c.fillRect(0, 0, W, H);
    var neb2 = c.createRadialGradient(W * 0.16, H * 0.72, 10, W * 0.16, H * 0.72, Math.max(W, H) * 0.42);
    neb2.addColorStop(0, "rgba(220, 50, 130, 0.16)");
    neb2.addColorStop(1, "rgba(0,0,0,0)");
    c.fillStyle = neb2; c.fillRect(0, 0, W, H);
    var neb3 = c.createRadialGradient(W * 0.86, H * 0.24, 10, W * 0.86, H * 0.24, Math.max(W, H) * 0.38);
    neb3.addColorStop(0, "rgba(40, 190, 220, 0.13)");
    neb3.addColorStop(1, "rgba(0,0,0,0)");
    c.fillStyle = neb3; c.fillRect(0, 0, W, H);

    // stars across the whole room, denser than the ones printed on the board
    for (var rs = 0; rs < 220; rs++) {
      var rx = ((rs * 733) % 1000) / 1000 * W;
      var ry = ((rs * 397) % 1000) / 1000 * H;
      var rr = (0.4 + (rs % 4) * 0.4);
      c.fillStyle = "rgba(210, 228, 255," + (0.05 + (rs % 6) * 0.035) + ")";
      c.beginPath(); c.arc(rx, ry, rr, 0, Math.PI * 2); c.fill();
    }

    // floor: the machine's own light pooling on it
    var floorY = H * 0.78;
    var floor = c.createLinearGradient(0, floorY, 0, H);
    floor.addColorStop(0, "rgba(0,0,0,0)");
    floor.addColorStop(1, "rgba(3, 3, 8, 0.85)");
    c.fillStyle = floor; c.fillRect(0, floorY, W, H - floorY);
    var pool = c.createRadialGradient(W / 2, H * 0.94, 10, W / 2, H * 0.94, W * 0.55);
    pool.addColorStop(0, "rgba(150, 90, 220, 0.16)");
    pool.addColorStop(0.5, "rgba(90, 50, 160, 0.06)");
    pool.addColorStop(1, "rgba(0,0,0,0)");
    c.fillStyle = pool; c.fillRect(0, floorY, W, H - floorY);

    // ---- cabinet side art: fills the dead columns on a wide screen the way a
    // real machine's decals do. Skipped when there is no room for it (portrait
    // phones), where the playfield already fills the frame.
    var tlp = T(0, 0), brp = T(TW, TH);
    var sideW = tlp.x - 12 * SC;
    if (sideW > 54) {
      [[0, sideW, -1], [brp.x + 12 * SC, W - (brp.x + 12 * SC), 1]].forEach(function (col) {
        var x0 = col[0], cw = col[1], dir = col[2];
        c.save();
        c.beginPath();
        c.rect(x0, tlp.y - 10 * SC, cw, (brp.y - tlp.y) + 20 * SC);
        c.clip();
        // panel body
        var body = c.createLinearGradient(x0, 0, x0 + cw, 0);
        body.addColorStop(0, dir < 0 ? "#0a0b1c" : "#1a1330");
        body.addColorStop(0.5, "#150f2a");
        body.addColorStop(1, dir < 0 ? "#1a1330" : "#0a0b1c");
        c.fillStyle = body;
        c.fillRect(x0, tlp.y - 10 * SC, cw, (brp.y - tlp.y) + 20 * SC);
        // diagonal neon striping, the classic cabinet decal
        var cx0 = x0 + cw / 2;
        for (var st = -4; st < 26; st++) {
          var yy = tlp.y + st * 62 * SC;
          var hue = st % 3 === 0 ? "rgba(255, 70, 150, 0.11)"
                  : st % 3 === 1 ? "rgba(110, 200, 255, 0.085)"
                                 : "rgba(180, 120, 255, 0.07)";
          c.strokeStyle = hue;
          c.lineWidth = Math.max(2, 9 * SC);
          c.beginPath();
          c.moveTo(x0 - 20, yy);
          c.lineTo(x0 + cw + 20, yy + dir * 74 * SC);
          c.stroke();
        }
        // a big soft planet echoing the playfield art
        var pg2 = c.createRadialGradient(cx0, tlp.y + (brp.y - tlp.y) * 0.3, 4,
                                         cx0, tlp.y + (brp.y - tlp.y) * 0.3, cw * 0.85);
        pg2.addColorStop(0, "rgba(150, 110, 255, 0.16)");
        pg2.addColorStop(0.6, "rgba(70, 40, 160, 0.07)");
        pg2.addColorStop(1, "rgba(0,0,0,0)");
        c.fillStyle = pg2;
        c.fillRect(x0, tlp.y, cw, brp.y - tlp.y);
        // vertical wordmark down the panel
        if (cw > 96) {
          c.save();
          c.translate(cx0, tlp.y + (brp.y - tlp.y) * 0.62);
          c.rotate(dir * Math.PI / 2);
          c.textAlign = "center"; c.textBaseline = "middle";
          c.font = "900 " + Math.max(16, 40 * SC) + "px Archivo, system-ui, sans-serif";
          c.fillStyle = "rgba(220, 235, 255, 0.055)";
          c.fillText("NOVA COAST", 0, 0);
          c.restore();
        }
        // the panel is lit from the playfield side and falls off outward
        var fall = c.createLinearGradient(x0, 0, x0 + cw, 0);
        if (dir < 0) {
          fall.addColorStop(0, "rgba(0,0,0,0.92)");
          fall.addColorStop(0.62, "rgba(0,0,0,0.42)");
          fall.addColorStop(1, "rgba(0,0,0,0.18)");
        } else {
          fall.addColorStop(0, "rgba(0,0,0,0.18)");
          fall.addColorStop(0.38, "rgba(0,0,0,0.42)");
          fall.addColorStop(1, "rgba(0,0,0,0.92)");
        }
        c.fillStyle = fall;
        c.fillRect(x0, tlp.y - 10 * SC, cw, (brp.y - tlp.y) + 20 * SC);
        c.restore();
      });
    }

    // cabinet edge under the playfield
    c.save();
    roundRect(c, tl.x - 10 * SC, tl.y - 10 * SC, pw + 20 * SC, ph + 20 * SC, 30 * SC);
    var edge = c.createLinearGradient(tl.x, tl.y, tl.x + pw, tl.y + ph);
    edge.addColorStop(0, "#2b2f56"); edge.addColorStop(0.5, "#151833"); edge.addColorStop(1, "#0d0f22");
    c.fillStyle = edge; c.fill();
    c.strokeStyle = "rgba(150, 190, 255, 0.22)"; c.lineWidth = Math.max(1, 1.6 * SC); c.stroke();
    c.restore();

    c.save();
    roundRect(c, tl.x, tl.y, pw, ph, 22 * SC);
    c.clip();

    // ---- playfield bed: a lit board, not a black hole
    var bed = c.createLinearGradient(tl.x, tl.y, tl.x, tl.y + ph);
    bed.addColorStop(0, "#25275c");
    bed.addColorStop(0.38, "#1a1c46");
    bed.addColorStop(0.72, "#141534");
    bed.addColorStop(1, "#191233");
    c.fillStyle = bed; c.fillRect(tl.x, tl.y, pw, ph);

    // overhead key light falling down the board
    var key = c.createRadialGradient(T(220, 210).x, T(220, 210).y, 12 * SC,
                                     T(220, 260).x, T(220, 260).y, 330 * SC);
    key.addColorStop(0, "rgba(150, 190, 255, 0.22)");
    key.addColorStop(0.5, "rgba(90, 120, 220, 0.10)");
    key.addColorStop(1, "rgba(0,0,0,0)");
    c.fillStyle = key; c.fillRect(tl.x, tl.y, pw, ph);

    // ---- painted art: a planet behind the bumpers
    var pc = T(203, 250), pr = 118 * SC;
    var planet = c.createRadialGradient(pc.x - pr * 0.35, pc.y - pr * 0.4, pr * 0.1, pc.x, pc.y, pr);
    planet.addColorStop(0, "rgba(120, 90, 235, 0.55)");
    planet.addColorStop(0.55, "rgba(72, 44, 160, 0.34)");
    planet.addColorStop(1, "rgba(28, 16, 74, 0)");
    c.fillStyle = planet;
    c.beginPath(); c.arc(pc.x, pc.y, pr, 0, Math.PI * 2); c.fill();
    // ring around it
    c.save();
    c.translate(pc.x, pc.y); c.rotate(-0.36); c.scale(1, 0.28);
    c.strokeStyle = "rgba(190, 160, 255, 0.30)";
    c.lineWidth = Math.max(1.5, 7 * SC);
    c.beginPath(); c.arc(0, 0, pr * 1.32, 0, Math.PI * 2); c.stroke();
    c.strokeStyle = "rgba(255, 220, 190, 0.18)";
    c.lineWidth = Math.max(1, 3 * SC);
    c.beginPath(); c.arc(0, 0, pr * 1.52, 0, Math.PI * 2); c.stroke();
    c.restore();

    // starfield across the upper board
    for (var i = 0; i < 90; i++) {
      var sx = 20 + ((i * 97) % 400), sy = 60 + ((i * 61) % 470);
      var sp = T(sx, sy), sr = (0.5 + (i % 3) * 0.45) * SC;
      c.fillStyle = "rgba(220, 235, 255," + (0.10 + (i % 5) * 0.055) + ")";
      c.beginPath(); c.arc(sp.x, sp.y, sr, 0, Math.PI * 2); c.fill();
    }

    // magenta wash over the lower third so the flipper zone is not dead space
    var low = c.createRadialGradient(T(203, 790).x, T(203, 790).y, 10 * SC,
                                     T(203, 760).x, T(203, 760).y, 260 * SC);
    low.addColorStop(0, "rgba(255, 60, 140, 0.30)");
    low.addColorStop(0.6, "rgba(150, 30, 110, 0.12)");
    low.addColorStop(1, "rgba(0,0,0,0)");
    c.fillStyle = low; c.fillRect(tl.x, tl.y, pw, ph);

    // ---- screened lane arrows in each orbit
    [[37, -1], [369, 1]].forEach(function (o) {
      for (var y = 330; y <= 520; y += 34) {
        var a1 = T(o[0] - 11, y + 11), a2 = T(o[0], y - 5), a3 = T(o[0] + 11, y + 11);
        c.strokeStyle = "rgba(140, 200, 255, 0.20)";
        c.lineWidth = Math.max(1, 2.2 * SC);
        c.beginPath(); c.moveTo(a1.x, a1.y); c.lineTo(a2.x, a2.y); c.lineTo(a3.x, a3.y); c.stroke();
      }
    });

    // ---- screened branding on the board
    c.save();
    c.translate(T(203, 588).x, T(203, 588).y);
    c.textAlign = "center"; c.textBaseline = "middle";
    c.font = "900 " + Math.max(11, 30 * SC) + "px Archivo, system-ui, sans-serif";
    c.fillStyle = "rgba(190, 215, 255, 0.07)";
    c.fillText("NOVA", 0, 0);
    c.font = "700 " + Math.max(6, 10 * SC) + "px 'Geist Mono', monospace";
    c.fillStyle = "rgba(190, 215, 255, 0.10)";
    c.fillText("O N E   P A G E   T O Y S", 0, 22 * SC);
    c.restore();

    // ---- plunger lane: a proper channel
    var lane = T(390, 250), laneW = 34 * SC;
    var lg = c.createLinearGradient(lane.x, 0, lane.x + laneW, 0);
    lg.addColorStop(0, "rgba(10, 12, 30, 0.75)");
    lg.addColorStop(0.5, "rgba(60, 80, 170, 0.16)");
    lg.addColorStop(1, "rgba(10, 12, 30, 0.75)");
    c.fillStyle = lg;
    c.fillRect(lane.x, lane.y, laneW, (772 - 250) * SC);

    // ---- apron below the flippers, so the drain is a place and not a void
    var apY = T(0, 752).y;
    var ap = c.createLinearGradient(0, apY, 0, tl.y + ph);
    ap.addColorStop(0, "rgba(24, 28, 54, 0.0)");
    ap.addColorStop(0.25, "rgba(20, 23, 46, 0.92)");
    ap.addColorStop(1, "rgba(10, 11, 26, 1)");
    c.fillStyle = ap;
    c.fillRect(tl.x, apY, pw, tl.y + ph - apY);
    c.strokeStyle = "rgba(150, 190, 255, 0.16)";
    c.lineWidth = Math.max(1, 1.4 * SC);
    c.beginPath();
    c.moveTo(T(16, 764).x, T(16, 764).y);
    c.lineTo(T(180, 776).x, T(180, 776).y);
    c.lineTo(T(226, 776).x, T(226, 776).y);
    c.lineTo(T(390, 764).x, T(390, 764).y);
    c.stroke();
    c.save();
    c.translate(T(203, 800).x, T(203, 800).y);
    c.textAlign = "center"; c.textBaseline = "middle";
    c.font = "700 " + Math.max(6, 9 * SC) + "px 'Geist Mono', monospace";
    c.fillStyle = "rgba(180, 205, 255, 0.22)";
    c.fillText("N O V A   C O A S T", 0, 0);
    c.restore();

    // ---- the top arc as ONE smooth path (tessellated segments beaded into a
    // dashed line, because every round cap overlapped its neighbour)
    var ac = T(220, 250);
    c.lineCap = "round";
    for (var ap2 = 0; ap2 < RAIL_PASSES.length; ap2++) {
      var cf = RAIL_PASSES[ap2];
      c.beginPath();
      c.arc(ac.x + cf.off[0] * SC, ac.y + cf.off[1] * SC, 204 * SC, Math.PI, 0, false);
      c.strokeStyle = cf.col;
      c.lineWidth = Math.max(0.6, WALL_R * 2 * SC * cf.mul);
      c.stroke();
    }

    // ---- rails, in ordered passes
    var rails = WALLS.filter(function (w2) { return !w2.arcPart; });
    for (var rp = 0; rp < RAIL_PASSES.length; rp++) railPass(c, rails, rp);
    // gate reads as a thin one-way flap
    var ga = T(GATE.a.x, GATE.a.y), gb = T(GATE.b.x, GATE.b.y);
    c.strokeStyle = "rgba(150, 190, 255, 0.32)";
    c.lineWidth = Math.max(1, 2.4 * SC);
    c.beginPath(); c.moveTo(ga.x, ga.y); c.lineTo(gb.x, gb.y); c.stroke();

    // ---- posts: chrome with a rubber collar
    for (i = 0; i < POSTS.length; i++) {
      var pp = T(POSTS[i].x, POSTS[i].y), prr = POSTS[i].r * SC;
      c.fillStyle = "rgba(0,0,0,0.45)";
      c.beginPath(); c.arc(pp.x + prr * 0.2, pp.y + prr * 0.28, prr * 1.05, 0, Math.PI * 2); c.fill();
      c.strokeStyle = "rgba(255, 110, 170, 0.5)";
      c.lineWidth = Math.max(1, prr * 0.42);
      c.beginPath(); c.arc(pp.x, pp.y, prr * 0.94, 0, Math.PI * 2); c.stroke();
      var pg = c.createRadialGradient(pp.x - prr * 0.4, pp.y - prr * 0.4, prr * 0.12, pp.x, pp.y, prr);
      pg.addColorStop(0, "#f4f8ff"); pg.addColorStop(0.55, "#9aa9d6"); pg.addColorStop(1, "#3a4168");
      c.fillStyle = pg;
      c.beginPath(); c.arc(pp.x, pp.y, prr * 0.72, 0, Math.PI * 2); c.fill();
    }

    // ---- printed-board grain: a real playfield is screened ink on wood under
    // clear-coat, and a perfectly smooth gradient is the giveaway that it is not
    var grain = grainCanvas();
    if (grain) {
      c.save();
      c.globalAlpha = 0.5;
      c.globalCompositeOperation = "overlay";
      var gp = c.createPattern(grain, "repeat");
      c.fillStyle = gp;
      c.fillRect(tl.x, tl.y, pw, ph);
      c.restore();
    }

    // ---- clear-coat: the varnish reflects the room as a broad soft sweep
    var coat = c.createLinearGradient(tl.x, tl.y, tl.x + pw * 0.85, tl.y + ph);
    coat.addColorStop(0, "rgba(255,255,255,0.10)");
    coat.addColorStop(0.22, "rgba(255,255,255,0.035)");
    coat.addColorStop(0.45, "rgba(255,255,255,0)");
    coat.addColorStop(0.78, "rgba(255,255,255,0.028)");
    coat.addColorStop(1, "rgba(255,255,255,0)");
    c.fillStyle = coat; c.fillRect(tl.x, tl.y, pw, ph);

    // ---- vignette: the lamp is above the middle, the corners fall away
    var vig = c.createRadialGradient(tl.x + pw / 2, tl.y + ph * 0.36, ph * 0.12,
                                     tl.x + pw / 2, tl.y + ph * 0.5, ph * 0.78);
    vig.addColorStop(0, "rgba(0,0,0,0)");
    vig.addColorStop(0.62, "rgba(0,0,0,0.10)");
    vig.addColorStop(1, "rgba(0,0,0,0.5)");
    c.fillStyle = vig; c.fillRect(tl.x, tl.y, pw, ph);

    c.restore();

    // playfield glass rim
    roundRect(c, tl.x, tl.y, pw, ph, 22 * SC);
    c.strokeStyle = "rgba(190, 215, 255, 0.26)";
    c.lineWidth = Math.max(1.5, 2.5 * SC);
    c.stroke();
  }

  function drawBumper(c, b) {
    var p = T(b.x, b.y), r = b.r * SC, f = b.flash;

    // shadow on the board, cast down-right from the overhead lamp
    c.fillStyle = "rgba(0,0,0,0.5)";
    c.beginPath();
    c.ellipse(p.x + r * 0.16, p.y + r * 0.24, r * 1.08, r * 1.0, 0, 0, Math.PI * 2);
    c.fill();

    // lamp bleeding out under the skirt
    var sg = c.createRadialGradient(p.x, p.y, r * 0.55, p.x, p.y, r * 1.85);
    sg.addColorStop(0, "rgba(120, 215, 255," + (0.30 + f * 0.62) + ")");
    sg.addColorStop(0.55, "rgba(70, 150, 255," + (0.10 + f * 0.3) + ")");
    sg.addColorStop(1, "rgba(70, 150, 255, 0)");
    c.fillStyle = sg;
    c.beginPath(); c.arc(p.x, p.y, r * 1.85, 0, Math.PI * 2); c.fill();

    // metal skirt ring
    var skirt = c.createLinearGradient(p.x, p.y - r, p.x, p.y + r);
    skirt.addColorStop(0, "#c9d6f2"); skirt.addColorStop(0.45, "#6d789e"); skirt.addColorStop(1, "#232a45");
    c.fillStyle = skirt;
    c.beginPath(); c.arc(p.x, p.y, r * 1.02, 0, Math.PI * 2); c.fill();
    c.fillStyle = "#0d1226";
    c.beginPath(); c.arc(p.x, p.y, r * 0.86, 0, Math.PI * 2); c.fill();

    // the moulded cap: translucent plastic lit from within
    var capR = r * 0.84;
    var cap = c.createRadialGradient(p.x - capR * 0.34, p.y - capR * 0.42, capR * 0.06,
                                     p.x, p.y, capR);
    if (f > 0.1) {
      cap.addColorStop(0, "#ffffff");
      cap.addColorStop(0.28, "#d6f6ff");
      cap.addColorStop(0.66, "#54c8f5");
      cap.addColorStop(1, "#1b5f9c");
    } else {
      cap.addColorStop(0, "#eaf6ff");
      cap.addColorStop(0.3, "#9fd0ec");
      cap.addColorStop(0.68, "#3f7db4");
      cap.addColorStop(1, "#16375c");
    }
    c.fillStyle = cap;
    c.beginPath(); c.arc(p.x, p.y, capR, 0, Math.PI * 2); c.fill();

    // rim light along the lower-right edge, where the dome turns away
    c.strokeStyle = "rgba(180, 230, 255," + (0.3 + f * 0.4) + ")";
    c.lineWidth = Math.max(1, capR * 0.1);
    c.beginPath(); c.arc(p.x, p.y, capR * 0.94, 0.5, 2.4); c.stroke();

    // the hard specular: a small bright ellipse, plus a soft bloom around it
    var hx = p.x - capR * 0.33, hy = p.y - capR * 0.4;
    var bloom = c.createRadialGradient(hx, hy, 0, hx, hy, capR * 0.55);
    bloom.addColorStop(0, "rgba(255,255,255,0.55)");
    bloom.addColorStop(1, "rgba(255,255,255,0)");
    c.fillStyle = bloom;
    c.beginPath(); c.arc(hx, hy, capR * 0.55, 0, Math.PI * 2); c.fill();
    c.fillStyle = "rgba(255,255,255,0.95)";
    c.beginPath(); c.ellipse(hx, hy, capR * 0.2, capR * 0.13, -0.7, 0, Math.PI * 2); c.fill();
  }

  function drawSling(c, s) {
    var A = T(s.A.x, s.A.y), C = T(s.C.x, s.C.y), B = T(s.B.x, s.B.y);
    c.beginPath();
    c.moveTo(A.x, A.y); c.lineTo(C.x, C.y); c.lineTo(B.x, B.y); c.closePath();
    var gg = c.createLinearGradient(C.x, C.y, (A.x + B.x) / 2, (A.y + B.y) / 2);
    gg.addColorStop(0, "rgba(255, 90, 165," + (0.34 + s.flash * 0.6) + ")");
    gg.addColorStop(1, "rgba(86, 18, 66, 0.66)");
    c.fillStyle = gg; c.fill();
    var w = Math.max(1.6, 3 * SC);
    var core = "rgba(255," + Math.floor(120 + s.flash * 135) + ",200,0.98)";
    var glow = "rgba(255, 60, 150," + (0.20 + s.flash * 0.55) + ")";
    neonLine(c, A.x, A.y, C.x, C.y, w, core, glow);
    neonLine(c, C.x, C.y, B.x, B.y, w, core, glow);
  }

  function drawTarget(c, t, idx) {
    var p = T(t.x, t.y), w = t.w * SC;
    var full = Math.max(3, 15 * SC);
    var h = full * (1 - t.drop * 0.88);
    var lit = !t.down;
    // lit insert in the board behind the target, so the bank reads as a bank
    insert(c, t.x + t.w / 2, t.y + 13, t.w + 4, 9, 0, "rgba(255, 196, 90, 0.95)", lit ? 0.85 : 0.12);
    if (h < 1) return;
    // cast shadow on the playfield
    c.fillStyle = "rgba(0,0,0,0.42)";
    roundRect(c, p.x + 2 * SC, p.y - h + 3 * SC, w, h, 3 * SC);
    c.fill();
    // the target face
    roundRect(c, p.x, p.y - h, w, h, Math.min(3.5 * SC, h / 2));
    var g = c.createLinearGradient(p.x, p.y - h, p.x, p.y);
    if (lit) {
      g.addColorStop(0, "#fff3cf"); g.addColorStop(0.45, "#ffc65a"); g.addColorStop(1, "#b9721a");
    } else {
      g.addColorStop(0, "rgba(120,112,96,0.55)"); g.addColorStop(1, "rgba(52,46,38,0.55)");
    }
    c.fillStyle = g; c.fill();
    if (lit) {
      c.strokeStyle = "rgba(255, 236, 180, 0.9)";
      c.lineWidth = Math.max(0.8, 1.2 * SC); c.stroke();
      // specular strip along the top edge
      c.fillStyle = "rgba(255,255,255,0.55)";
      roundRect(c, p.x + 2 * SC, p.y - h + 1.5 * SC, w - 4 * SC, Math.max(1, h * 0.16), 1.5 * SC);
      c.fill();
      if (h > 8 * SC) {
        c.fillStyle = "rgba(90, 52, 8, 0.8)";
        c.font = "800 " + Math.max(7, 9 * SC) + "px Archivo, system-ui, sans-serif";
        c.textAlign = "center"; c.textBaseline = "middle";
        c.fillText(String(idx + 1), p.x + w / 2, p.y - h * 0.45);
      }
    }
  }

  function drawLanes(c) {
    for (var i = 0; i < LANES.length; i++) {
      var L = LANES[i], p = T(L.x, L.y), r = 13 * SC;
      var on = L.lit ? 1 : 0.16 + L.glow * 0.6;
      var g = c.createRadialGradient(p.x, p.y, r * 0.1, p.x, p.y, r * 1.7);
      g.addColorStop(0, "rgba(120, 255, 190," + (0.5 * on + L.glow * 0.5) + ")");
      g.addColorStop(1, "rgba(120, 255, 190, 0)");
      c.fillStyle = g;
      c.beginPath(); c.arc(p.x, p.y, r * 1.7, 0, Math.PI * 2); c.fill();
      c.strokeStyle = "rgba(150, 255, 205," + (0.35 + on * 0.6) + ")";
      c.lineWidth = Math.max(1, 1.8 * SC);
      c.beginPath(); c.arc(p.x, p.y, r, 0, Math.PI * 2); c.stroke();
      c.fillStyle = L.lit ? "rgba(230,255,240,0.96)" : "rgba(190, 235, 215, 0.5)";
      c.font = "700 " + Math.max(9, 15 * SC) + "px Archivo, system-ui, sans-serif";
      c.textAlign = "center"; c.textBaseline = "middle";
      c.fillText(L.letter, p.x, p.y + 0.5);
      // skill-shot marker
      if (G.skillLive && i === G.skillLane) {
        c.strokeStyle = "rgba(255, 220, 120," + (0.45 + 0.35 * Math.sin(perf / 140)) + ")";
        c.lineWidth = Math.max(1, 2 * SC);
        c.beginPath(); c.arc(p.x, p.y, r * 1.45, 0, Math.PI * 2); c.stroke();
      }
    }
  }

  function drawScoop(c) {
    var p = T(SCOOP.x, SCOOP.y), r = SCOOP.r * SC;
    var g = c.createRadialGradient(p.x, p.y, r * 0.1, p.x, p.y, r * 2.1);
    g.addColorStop(0, "rgba(255, 190, 90," + (0.28 + SCOOP.glow * 0.6) + ")");
    g.addColorStop(1, "rgba(255, 160, 60, 0)");
    c.fillStyle = g;
    c.beginPath(); c.arc(p.x, p.y, r * 2.1, 0, Math.PI * 2); c.fill();
    c.fillStyle = "#05060f";
    c.beginPath(); c.arc(p.x, p.y, r, 0, Math.PI * 2); c.fill();
    c.strokeStyle = "rgba(255, 205, 120, " + (0.6 + SCOOP.glow * 0.4) + ")";
    c.lineWidth = Math.max(1.4, 2.6 * SC);
    c.beginPath(); c.arc(p.x, p.y, r, 0, Math.PI * 2); c.stroke();
  }

  function drawFlipper(c, f, pivot, side) {
    var p0 = T(pivot.x, pivot.y);
    var tipT = { x: pivot.x + Math.cos(f.a) * FLIP_LEN, y: pivot.y + Math.sin(f.a) * FLIP_LEN };
    var p1 = T(tipT.x, tipT.y);
    var w = FLIP_R * 2 * SC;
    c.lineCap = "round";
    // glow underlay when actively flipping
    if (Math.abs(f.w) > 3) {
      c.strokeStyle = "rgba(120, 200, 255, 0.30)";
      c.lineWidth = w * 2.1;
      c.beginPath(); c.moveTo(p0.x, p0.y); c.lineTo(p1.x, p1.y); c.stroke();
    }
    var g = c.createLinearGradient(p0.x, p0.y, p1.x, p1.y);
    g.addColorStop(0, "#f2f6ff"); g.addColorStop(0.5, "#9fb6e8"); g.addColorStop(1, "#5a6ea8");
    c.strokeStyle = g; c.lineWidth = w;
    c.beginPath(); c.moveTo(p0.x, p0.y); c.lineTo(p1.x, p1.y); c.stroke();
    c.strokeStyle = "rgba(255,255,255,0.5)";
    c.lineWidth = Math.max(1, w * 0.24);
    c.beginPath(); c.moveTo(p0.x, p0.y); c.lineTo(p1.x, p1.y); c.stroke();
    // pivot cap
    c.fillStyle = "#c9d6f5";
    c.beginPath(); c.arc(p0.x, p0.y, w * 0.42, 0, Math.PI * 2); c.fill();
  }

  function drawBall(c) {
    if (!ball.live) return;
    var i, p;
    // motion trail
    for (i = 0; i < ball.trail.length; i++) {
      var q = ball.trail[i], f = (i + 1) / (ball.trail.length + 1);
      p = T(q.x, q.y);
      c.fillStyle = "rgba(198, 224, 255," + (0.09 * f) + ")";
      c.beginPath(); c.arc(p.x, p.y, BALL_R * SC * (0.45 + f * 0.55), 0, Math.PI * 2); c.fill();
    }

    p = T(ball.x, ball.y);
    var r = BALL_R * SC;

    // Contact shadow: soft and offset, and it TIGHTENS as the ball slows, the
    // way a real one does when it settles onto the board.
    var spd = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
    var lift = Math.min(1, spd / 1600);
    c.fillStyle = "rgba(0,0,0," + (0.5 - lift * 0.18) + ")";
    c.beginPath();
    c.ellipse(p.x + r * 0.3, p.y + r * 0.36, r * (0.95 + lift * 0.15), r * (0.84 + lift * 0.12), 0, 0, Math.PI * 2);
    c.fill();

    /* A chrome sphere is mostly a mirror: the top half reflects the bright lamp
     * above, the bottom half reflects the dark board, and the two meet at a
     * hard horizon. Painting it as one soft radial gradient is what made the
     * first version read as a grey marble. */
    var g = c.createLinearGradient(p.x, p.y - r, p.x, p.y + r);
    g.addColorStop(0, "#ffffff");
    g.addColorStop(0.30, "#dce7fb");
    g.addColorStop(0.49, "#93a3c4");
    g.addColorStop(0.52, "#2a3050");     // horizon
    g.addColorStop(0.74, "#4a5578");
    g.addColorStop(1, "#8fa2c9");        // bounce light off the board
    c.save();
    c.beginPath(); c.arc(p.x, p.y, r, 0, Math.PI * 2); c.clip();
    c.fillStyle = g; c.fillRect(p.x - r, p.y - r, r * 2, r * 2);

    // the playfield's magenta glow picked up along the lower edge
    var warm = c.createRadialGradient(p.x - r * 0.2, p.y + r * 0.75, 0, p.x, p.y + r * 0.6, r * 1.2);
    warm.addColorStop(0, "rgba(255, 110, 175, 0.5)");
    warm.addColorStop(1, "rgba(255, 110, 175, 0)");
    c.fillStyle = warm; c.fillRect(p.x - r, p.y - r, r * 2, r * 2);

    // curved sliver of the room reflected around the rim
    c.strokeStyle = "rgba(255,255,255,0.28)";
    c.lineWidth = Math.max(0.8, r * 0.13);
    c.beginPath(); c.arc(p.x, p.y, r * 0.8, 2.5, 4.0); c.stroke();
    c.restore();

    // terminator darkening at the very edge so it reads as a sphere
    var edge = c.createRadialGradient(p.x, p.y, r * 0.72, p.x, p.y, r);
    edge.addColorStop(0, "rgba(0,0,0,0)");
    edge.addColorStop(1, "rgba(0,0,0,0.45)");
    c.fillStyle = edge;
    c.beginPath(); c.arc(p.x, p.y, r, 0, Math.PI * 2); c.fill();

    // hard specular from the lamp, with a bloom
    var hx = p.x - r * 0.36, hy = p.y - r * 0.44;
    var bl = c.createRadialGradient(hx, hy, 0, hx, hy, r * 0.62);
    bl.addColorStop(0, "rgba(255,255,255,0.5)");
    bl.addColorStop(1, "rgba(255,255,255,0)");
    c.fillStyle = bl;
    c.beginPath(); c.arc(hx, hy, r * 0.62, 0, Math.PI * 2); c.fill();
    c.fillStyle = "#ffffff";
    c.beginPath(); c.ellipse(hx, hy, r * 0.21, r * 0.15, -0.7, 0, Math.PI * 2); c.fill();
  }

  function drawPlunger(c) {
    if (G.mode !== "serve") return;
    var top = T(407, 726 + 20), bot = T(407, 764);
    var pull = G.plunger * 26 * SC;
    c.strokeStyle = "rgba(180, 200, 255, 0.5)";
    c.lineWidth = Math.max(2, 5 * SC);
    c.beginPath(); c.moveTo(top.x, top.y + pull); c.lineTo(bot.x, bot.y); c.stroke();
    // spring coils
    c.strokeStyle = "rgba(210, 225, 255, 0.8)";
    c.lineWidth = Math.max(1, 2 * SC);
    var n = 6, y0 = top.y + pull, y1 = bot.y;
    c.beginPath();
    for (var i = 0; i <= n; i++) {
      var t = i / n, yy = y0 + (y1 - y0) * t;
      var xx = top.x + (i % 2 === 0 ? -5 : 5) * SC;
      if (i === 0) c.moveTo(xx, yy); else c.lineTo(xx, yy);
    }
    c.stroke();
    // power meter
    if (G.plunger > 0.01) {
      var mx = T(424, 764).x + 8 * SC, my0 = T(0, 600).y, my1 = T(0, 764).y;
      c.fillStyle = "rgba(255,255,255,0.10)";
      c.fillRect(mx, my0, 5 * SC, my1 - my0);
      var hgt = (my1 - my0) * G.plunger;
      var mg = c.createLinearGradient(0, my1 - hgt, 0, my1);
      mg.addColorStop(0, "#ff5f8a"); mg.addColorStop(1, "#ffd36a");
      c.fillStyle = mg;
      c.fillRect(mx, my1 - hgt, 5 * SC, hgt);
    }
  }

  var perf = 0;

  function render() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    if (G.shake > 0 && !reduced) {
      var s = G.shake * 7;
      ctx.translate((Math.random() - 0.5) * s + G.shakeX * G.shake,
                    (Math.random() - 0.5) * s + G.shakeY * G.shake);
    }
    ctx.drawImage(staticCv, 0, 0, W, H);

    var i;
    for (i = 0; i < TARGETS.length; i++) drawTarget(ctx, TARGETS[i], i);
    drawLanes(ctx);
    // playfield inserts: they light with what they mean
    insert(ctx, SCOOP.x, SCOOP.y + 30, 26, 8, 0, "rgba(255, 190, 90, 0.95)", 0.3 + SCOOP.glow * 0.7);
    insert(ctx, SCOOP.x, SCOOP.y + 42, 18, 7, 0, "rgba(255, 190, 90, 0.95)", 0.18 + SCOOP.glow * 0.6);
    insert(ctx, 37, 300, 9, 30, 0, "rgba(150, 210, 255, 0.95)", ORBITS[0].cool > 0 ? 0.9 : 0.16);
    insert(ctx, 369, 300, 9, 30, 0, "rgba(150, 210, 255, 0.95)", ORBITS[1].cool > 0 ? 0.9 : 0.16);
    insert(ctx, 203, 560, 44, 9, 0, "rgba(255, 120, 190, 0.95)", G.mult > 1 ? 0.85 : 0.14);
    drawScoop(ctx);
    for (i = 0; i < SLINGS.length; i++) drawSling(ctx, SLINGS[i]);
    for (i = 0; i < BUMPERS.length; i++) drawBumper(ctx, BUMPERS[i]);
    drawFlipper(ctx, flipL, LEFT_PIVOT, -1);
    drawFlipper(ctx, flipR, RIGHT_PIVOT, 1);
    drawPlunger(ctx);
    drawBall(ctx);

    // particles
    for (i = 0; i < particles.length; i++) {
      var q = particles[i], f = 1 - q.t / q.life;
      if (f <= 0) continue;
      var p = T(q.x, q.y);
      ctx.fillStyle = "hsla(" + q.hue + ", 100%, " + (62 + f * 30) + "%, " + (f * 0.85) + ")";
      ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(0.6, 2.6 * SC * f), 0, Math.PI * 2); ctx.fill();
    }
    // score pops
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    for (i = 0; i < pops.length; i++) {
      var o = pops[i], of2 = 1 - o.t / (o.big ? 1.5 : 0.9);
      if (of2 <= 0) continue;
      var pp = T(o.x, o.y - (1 - of2) * 34);
      ctx.font = "800 " + Math.max(11, (o.big ? 21 : 15) * SC) + "px Archivo, system-ui, sans-serif";
      ctx.fillStyle = "rgba(255,255,255," + (of2 * 0.95) + ")";
      ctx.fillText(o.txt, pp.x, pp.y);
    }

    // full-table flash on a big award
    if (G.flash > 0.001) {
      ctx.fillStyle = "rgba(180, 220, 255," + (G.flash * 0.22) + ")";
      var tl = T(0, 0);
      roundRect(ctx, tl.x, tl.y, TW * SC, TH * SC, 22 * SC);
      ctx.fill();
    }
    ctx.restore();

    // tilt veil
    if (G.tilt > 0) {
      ctx.fillStyle = "rgba(8, 4, 12, 0.45)";
      ctx.fillRect(0, 0, W, H);
    }
  }

  // ---------------------------------------------------------------- HUD

  var elScore = document.getElementById("score");
  var elBest = document.getElementById("best");
  var elBall = document.getElementById("ballNo");
  var elMult = document.getElementById("mult");
  var elMsg = document.getElementById("callout");
  var elHud = document.getElementById("hud");
  var overlay = document.getElementById("overlay");
  var ovTitle = document.getElementById("ovTitle");
  var ovText = document.getElementById("ovText");
  var ovBtn = document.getElementById("ovBtn");
  var ovEyebrow = document.getElementById("ovEyebrow");

  function fmt(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }

  function updateHud() {
    if (elScore) elScore.textContent = fmt(G.score);
    if (elBest) elBest.textContent = G.best ? fmt(G.best) : "—";
    if (elBall) elBall.textContent = G.ball + "/" + BALLS_PER_GAME;
    if (elMult) elMult.textContent = G.mult + "×";
  }

  function hideOverlay() {
    if (overlay) overlay.classList.add("is-out");
    if (elHud) elHud.hidden = false;
    setTimeout(function () { if (overlay) overlay.hidden = true; }, 260);
  }

  function showOver() {
    if (!overlay) return;
    overlay.hidden = false;
    overlay.classList.remove("is-out");
    ovEyebrow.textContent = G.score >= G.best && G.score > 0 ? "New best" : "Game over";
    ovTitle.textContent = fmt(G.score);
    ovText.innerHTML = "Three balls played. Best so far <b>" + fmt(G.best) + "</b>.";
    ovBtn.textContent = "Play again";
    if (window.gtag) {
      window.gtag("event", "toy_score", { toy_slug: "pinball", value: G.score });
    }
  }

  // ---------------------------------------------------------------- loop

  var lastT = 0, acc = 0;

  function frame(t) {
    if (!lastT) lastT = t;
    var dt = Math.min(0.05, (t - lastT) / 1000);
    lastT = t; perf = t;

    acc += dt;
    var n = 0;
    while (acc >= STEP && n < MAX_SUB) { physics(STEP); acc -= STEP; n++; }
    if (acc > STEP * MAX_SUB) acc = 0;

    // plunger charge
    if (G.mode === "serve" && G.plungerHeld) G.plunger = Math.min(1, G.plunger + dt * 1.25);

    // decay visual state
    var i;
    for (i = 0; i < BUMPERS.length; i++) BUMPERS[i].flash = Math.max(0, BUMPERS[i].flash - dt * 4.5);
    for (i = 0; i < SLINGS.length; i++) SLINGS[i].flash = Math.max(0, SLINGS[i].flash - dt * 5);
    for (i = 0; i < LANES.length; i++) LANES[i].glow = Math.max(0, LANES[i].glow - dt * 2.2);
    for (i = 0; i < TARGETS.length; i++) {
      if (TARGETS[i].down && TARGETS[i].drop < 1) TARGETS[i].drop = Math.min(1, TARGETS[i].drop + dt * 6);
      if (!TARGETS[i].down && TARGETS[i].drop > 0) TARGETS[i].drop = Math.max(0, TARGETS[i].drop - dt * 4);
    }
    SCOOP.glow = Math.max(0, SCOOP.glow - dt * 1.6);
    G.shake = Math.max(0, G.shake - dt * 2.6);
    G.flash = Math.max(0, G.flash - dt * 2.2);
    G.tiltCool = Math.max(0, G.tiltCool - dt);

    for (i = particles.length - 1; i >= 0; i--) {
      var q = particles[i];
      q.t += dt;
      q.x += q.vx * dt; q.y += q.vy * dt;
      q.vy += 420 * dt; q.vx *= 0.97;
      if (q.t >= q.life) particles.splice(i, 1);
    }
    for (i = pops.length - 1; i >= 0; i--) {
      pops[i].t += dt;
      if (pops[i].t >= (pops[i].big ? 1.5 : 0.9)) pops.splice(i, 1);
    }

    // ball trail
    if (ball.live && !reduced) {
      ball.trail.push({ x: ball.x, y: ball.y });
      if (ball.trail.length > 7) ball.trail.shift();
    }

    // rolling sound follows speed
    Audio2.roll(ball.live && G.mode === "play" ? Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy) : 0);

    if (G.msgT > 0) {
      G.msgT -= dt;
      if (elMsg) { elMsg.hidden = false; elMsg.textContent = G.msg; }
      if (G.msgT <= 0 && elMsg) elMsg.hidden = true;
    }

    updateHud();
    render();
    requestAnimationFrame(frame);
  }

  // ---------------------------------------------------------------- input

  function pointerZone(clientX) {
    return clientX < window.innerWidth / 2 ? "L" : "R";
  }

  var activePointers = {};

  function onDown(e) {
    Audio2.init();
    if (G.mode === "intro" || G.mode === "over") return;   // the button handles it
    var x = e.clientX;
    // the plunger lane is a live zone while serving
    if (G.mode === "serve") {
      G.plungerHeld = true;
      activePointers[e.pointerId] = "P";
      return;
    }
    if (G.tilt > 0) return;
    var z = pointerZone(x);
    activePointers[e.pointerId] = z;
    if (z === "L") flipL.held = true; else flipR.held = true;
  }

  function onUp(e) {
    var z = activePointers[e.pointerId];
    delete activePointers[e.pointerId];
    if (z === "P") { G.plungerHeld = false; launch(); return; }
    var stillL = false, stillR = false, k;
    for (k in activePointers) {
      if (activePointers[k] === "L") stillL = true;
      if (activePointers[k] === "R") stillR = true;
    }
    flipL.held = stillL; flipR.held = stillR;
  }

  cv.addEventListener("pointerdown", function (e) { e.preventDefault(); onDown(e); }, { passive: false });
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);

  window.addEventListener("keydown", function (e) {
    if (e.repeat) return;
    var k = e.key;
    if (k === "ArrowLeft" || k === "a" || k === "A") { Audio2.init(); if (G.tilt <= 0) flipL.held = true; e.preventDefault(); }
    else if (k === "ArrowRight" || k === "d" || k === "D") { Audio2.init(); if (G.tilt <= 0) flipR.held = true; e.preventDefault(); }
    else if (k === " " || k === "ArrowDown") {
      Audio2.init();
      e.preventDefault();
      if (G.mode === "intro" || G.mode === "over") { startGame(); return; }
      if (G.mode === "serve") G.plungerHeld = true;
    }
    else if (k === "z" || k === "Z") { nudge(-1); }
    else if (k === "x" || k === "X" || k === "/") { nudge(1); }
    else if (k === "Enter") { if (G.mode === "intro" || G.mode === "over") startGame(); }
  });

  window.addEventListener("keyup", function (e) {
    var k = e.key;
    if (k === "ArrowLeft" || k === "a" || k === "A") flipL.held = false;
    else if (k === "ArrowRight" || k === "d" || k === "D") flipR.held = false;
    else if (k === " " || k === "ArrowDown") {
      if (G.mode === "serve" && G.plungerHeld) { G.plungerHeld = false; launch(); }
    }
  });

  if (ovBtn) ovBtn.addEventListener("click", function () { Audio2.init(); startGame(); });

  var soundBtn = document.getElementById("soundBtn");
  var soundOn = true;
  try {
    var st = localStorage.getItem("pinball_sound");
    if (st === "off") soundOn = false;
  } catch (e) {}
  function syncSound() {
    Audio2.setOn(soundOn);
    if (soundBtn) {
      soundBtn.setAttribute("aria-pressed", soundOn ? "true" : "false");
      soundBtn.textContent = soundOn ? "♪" : "♪̸";
      soundBtn.classList.toggle("is-off", !soundOn);
    }
  }
  if (soundBtn) soundBtn.addEventListener("click", function () {
    soundOn = !soundOn;
    try { localStorage.setItem("pinball_sound", soundOn ? "on" : "off"); } catch (e) {}
    Audio2.init();
    syncSound();
  });

  try {
    var b = parseInt(localStorage.getItem("pinball_best") || "0", 10);
    if (b > 0) G.best = b;
  } catch (e) {}

  window.addEventListener("resize", resize);
  window.addEventListener("orientationchange", function () { setTimeout(resize, 120); });

  resize();
  syncSound();
  updateHud();
  requestAnimationFrame(frame);

  // expose a little state for headless verification
  window.__pin = {
    G: G, ball: ball, WALLS: WALLS, BUMPERS: BUMPERS, TARGETS: TARGETS,
    LANES: LANES, SCOOP: SCOOP, flipL: flipL, flipR: flipR,
    start: startGame, launch: launch, serve: serve,
    place: function (x, y, vx, vy) {
      ball.x = x; ball.y = y; ball.vx = vx || 0; ball.vy = vy || 0;
      ball.live = true; G.mode = "play";
    },
    step: function (n) { for (var i = 0; i < (n || 1); i++) physics(STEP); },
    TW: TW, TH: TH, BALL_R: BALL_R, STEP: STEP
  };
})();
