/* Hearing Age: the pure parts, shared by the page and the node tests.
 *
 * - ageFor(hz): the typical age for a top-of-hearing frequency.
 * - pulseEnv(t) / renderPulse(): the test signal, a pure sine shaped by
 *   raised-cosine ramps. Nothing else touches it: no filter, no compressor, no
 *   reverb. A hard onset is a broadband click you can hear at ANY pitch, so a
 *   click would make every tone "heard".
 * - Test: the step logic. A coarse climb from 8 kHz, then a fine confirm pass
 *   that starts below the found point. The result comes from the confirm pass.
 *   Silent catch trials keep the answers honest.
 *
 * Where the numbers come from:
 * - Audiology: under-20s top out around 18.5 kHz on average (19.6 at best), and
 *   the top falls about 2 kHz per decade after 20, to roughly 14 kHz at 45
 *   (Oliva et al., cited by Martinho, Zeigelboim and Marques, 2005). In a 2021
 *   study of 162 adults, everyone under 30 heard 16 kHz and about half heard
 *   20 kHz; nobody aged 51-60 heard 20 kHz and nobody 61-70 heard 18 kHz.
 * - The popular charts say much the same: 17.4 kHz (the "mosquito tone")
 *   around 24, 16 kHz around 30, 15 kHz around 40, 14 kHz around 45,
 *   12 kHz around 55.
 */
(function (root) {
  "use strict";

  /* ---------------------------------------------------------------- ages */

  // [top frequency in Hz, typical age], highest first. Piecewise linear.
  var AGE_TABLE = [
    [20000, 15], [19000, 18], [18500, 20], [18000, 22], [17400, 24],
    [16800, 27], [16000, 31], [15500, 35], [15000, 40], [14000, 45],
    [13000, 50], [12000, 55], [11000, 60], [10000, 65], [9000, 70], [8000, 75]
  ];

  function ageFor(hz) {
    if (!(hz > 0)) return null;
    var T = AGE_TABLE;
    if (hz >= T[0][0]) return T[0][1];
    if (hz <= T[T.length - 1][0]) return T[T.length - 1][1];
    for (var i = 0; i < T.length - 1; i++) {
      var a = T[i], b = T[i + 1];
      if (hz <= a[0] && hz >= b[0]) {
        var u = (a[0] - hz) / (a[0] - b[0]);
        return a[1] + u * (b[1] - a[1]);
      }
    }
    return null;
  }

  // The words for the result. Kept here so the share line and the page agree.
  function ageWords(hz) {
    var age = ageFor(hz);
    if (age === null) return null;
    var n = Math.round(age);
    if (hz < 9000) return { age: n, short: "70-something", text: "Ears of a 70-something" };
    if (n <= 19) return { age: n, short: "teen", text: "Ears of a teenager" };
    return { age: n, short: String(n), text: "Ears of a " + n + "-year-old" };
  }

  /* --------------------------------------------------------- the signal */

  var RAMP = 0.06;     // raised-cosine attack and release, seconds (>= 40ms)
  var HOLD = 0.16;     // full level between the ramps
  var PULSE = RAMP * 2 + HOLD;   // 0.28s of tone
  var PERIOD = 0.5;    // one pulse every half second
  var PULSES = 3;      // three beeps, then a rest
  var CYCLE = 2.3;     // 3 x 0.5s + 0.8s rest, then it loops

  // 0..1, the loudness envelope at time t (seconds) into a looping train.
  function pulseEnv(t) {
    if (!(t >= 0)) return 0;
    var tc = t % CYCLE;
    var k = Math.floor(tc / PERIOD);
    if (k >= PULSES) return 0;
    var u = tc - k * PERIOD;
    if (u < RAMP) return 0.5 - 0.5 * Math.cos(Math.PI * u / RAMP);
    if (u < RAMP + HOLD) return 1;
    if (u < PULSE) return 0.5 + 0.5 * Math.cos(Math.PI * (u - RAMP - HOLD) / RAMP);
    return 0;
  }

  // Which pulse (0, 1, 2) is sounding at t, or -1 in a gap.
  function pulseIndex(t) {
    if (!(t >= 0)) return -1;
    var tc = t % CYCLE;
    var k = Math.floor(tc / PERIOD);
    if (k >= PULSES) return -1;
    return (tc - k * PERIOD) < PULSE ? k : -1;
  }

  // One loop of the pulse train as raw samples: sin(2 pi f t) * env(t) * amp.
  // Computed sample by sample (no oscillator) so it is exactly a sine, and the
  // node test can check the very same samples the page plays.
  function renderPulse(freq, sr, amp, out) {
    var n = Math.round(CYCLE * sr);
    var a = out && out.length === n ? out : new Float32Array(n);
    var w = 2 * Math.PI * freq / sr;
    for (var i = 0; i < n; i++) {
      var e = pulseEnv(i / sr);
      var v = e > 0 ? Math.sin(w * i) * e * amp : 0;
      a[i] = isFinite(v) ? v : 0;   // never let a NaN near the output
    }
    return a;
  }

  // The highest tone we play: 20 kHz, or 0.45 x the sample rate if lower
  // (a tone near Nyquist aliases), rounded down to 100 Hz.
  function capFor(sr) {
    var c = Math.floor((sr * 0.45) / 100) * 100;
    return Math.max(4000, Math.min(20000, c));
  }

  // The coarse climb: big steps where nearly everyone hears, 1 kHz up top.
  function coarseLadder(cap) {
    var base = [8000, 10000, 12000, 13000, 14000, 15000, 16000, 17000, 18000, 19000, 20000];
    var out = base.filter(function (f) { return f <= cap; });
    if (out[out.length - 1] < cap && cap - out[out.length - 1] >= 300) out.push(cap);
    return out;
  }

  /* ----------------------------------------------------------- the test */

  var DOWN = [6000, 4000];   // if 8 kHz is already gone
  var FLOOR = 3000;
  var MAX_TRIALS = 64;

  function Test(opts) {
    opts = opts || {};
    var rand = opts.rand || Math.random;
    this.cap = opts.cap || 20000;
    this.ladder = coarseLadder(this.cap);
    this.phase = "coarse";       // coarse | down | confirm | confirmDown | done
    this.i = 0;                  // index into ladder / DOWN
    this.f = this.ladder[0];
    this.stepInPhase = 0;        // real steps presented in this phase
    this.lastHeard = null;       // coarse result
    this.firstGone = null;
    this.step = 200;             // confirm step size
    this.start = null;           // confirm start
    this.best = null;            // highest heard in the confirm pass
    this.result = null;          // { hz, atCap, low, falseAlarms, ... } or { hz: null }
    this.history = [];           // every answer: { f, heard, phase, isCatch }
    this.trials = 0;
    this.falseAlarms = 0;
    this.correctRejects = 0;
    this.catches = 0;
    // One silent trial early in each pass, at a random step.
    this.catchAt = { coarse: 1 + Math.floor(rand() * 2), confirm: 1 + Math.floor(rand() * 2) };
    this.extraCatch = null;      // { phase, at } a re-check after a false alarm
    this.isCatch = false;
    this.done = false;
    this._maybeCatch();
  }

  Test.prototype._maybeCatch = function () {
    var p = this.phase === "confirmDown" ? "confirm" : this.phase;
    var want = (this.catchAt[p] === this.stepInPhase) ||
      (this.extraCatch && this.extraCatch.phase === p && this.extraCatch.at === this.stepInPhase);
    if (want && this.catches < 4) {
      this.isCatch = true;
      this.catches++;
      if (this.catchAt[p] === this.stepInPhase) this.catchAt[p] = -1;
      if (this.extraCatch && this.extraCatch.phase === p && this.extraCatch.at === this.stepInPhase) this.extraCatch = null;
    } else {
      this.isCatch = false;
    }
  };

  // What to play now.
  Test.prototype.current = function () {
    return { f: this.f, isCatch: this.isCatch, phase: this.phase, step: this.stepInPhase, done: this.done };
  };

  Test.prototype._advance = function (f) {
    this.f = f;
    this.stepInPhase++;
    this._maybeCatch();
  };

  Test.prototype._enterPhase = function (phase, f) {
    this.phase = phase;
    this.f = f;
    this.stepInPhase = 0;
    this._maybeCatch();
  };

  Test.prototype._toConfirm = function (lo, hi) {
    this.lastHeard = lo;
    this.firstGone = hi;
    this.step = (hi === null || hi - lo <= 1000) ? 200 : 400;
    this.start = Math.max(FLOOR, lo - 2 * this.step);
    this._enterPhase("confirm", this.start);
  };

  Test.prototype._finish = function (hz, atCap) {
    this.done = true;
    this.phase = "done";
    this.isCatch = false;
    this.result = {
      hz: hz,
      atCap: !!atCap,
      low: hz !== null && hz < 8000,
      falseAlarms: this.falseAlarms,
      correctRejects: this.correctRejects,
      catches: this.catches,
      trials: this.trials
    };
  };

  // heard: true for "I hear it", false for "It's gone".
  // Returns { type: "false-alarm" | "correct-reject" | "next" | "done" }.
  Test.prototype.answer = function (heard) {
    if (this.done) return { type: "done" };
    heard = !!heard;
    this.trials++;
    var f = this.f;
    this.history.push({ f: f, heard: heard, phase: this.phase, isCatch: this.isCatch });

    if (this.isCatch) {
      // Same step again, for real this time.
      this.isCatch = false;
      if (heard) {
        this.falseAlarms++;
        // Check again a couple of steps on.
        var p = this.phase === "confirmDown" ? "confirm" : this.phase;
        if (!this.extraCatch) this.extraCatch = { phase: p, at: this.stepInPhase + 2 };
        return { type: "false-alarm" };
      }
      this.correctRejects++;
      return { type: "correct-reject" };
    }

    if (this.trials >= MAX_TRIALS) {
      this._finish(this.best !== null ? this.best : this.lastHeard, false);
      return { type: "done" };
    }

    switch (this.phase) {
      case "coarse":
        if (heard) {
          this.lastHeard = f;
          this.i++;
          if (this.i >= this.ladder.length) this._toConfirm(f, null);
          else this._advance(this.ladder[this.i]);
        } else if (this.i === 0) {
          this.i = 0;
          this.firstGone = f;
          this._enterPhase("down", DOWN[0]);
        } else {
          this._toConfirm(this.lastHeard, f);
        }
        break;

      case "down":
        if (heard) {
          this._toConfirm(f, this.i === 0 ? 8000 : DOWN[this.i - 1]);
        } else {
          this.i++;
          if (this.i >= DOWN.length) { this._finish(null, false); return { type: "done" }; }
          this._advance(DOWN[this.i]);
        }
        break;

      case "confirm":
        if (heard) {
          this.best = f;
          var nf = f + this.step;
          if (nf > this.cap) {
            if (f < this.cap) { this._advance(this.cap); }
            else { this._finish(this.cap, true); return { type: "done" }; }
          } else {
            this._advance(nf);
          }
        } else if (this.best === null) {
          // Gone already at the start: walk down until it comes back.
          var df = this.start - this.step;
          if (df < FLOOR) { this._finish(null, false); return { type: "done" }; }
          this.phase = "confirmDown";
          this._advance(df);
        } else {
          this._finish(this.best, false);
          return { type: "done" };
        }
        break;

      case "confirmDown":
        if (heard) { this._finish(f, false); return { type: "done" }; }
        var dn = f - this.step;
        if (dn < FLOOR) { this._finish(null, false); return { type: "done" }; }
        this._advance(dn);
        break;
    }
    return { type: this.done ? "done" : "next" };
  };

  var api = {
    AGE_TABLE: AGE_TABLE,
    ageFor: ageFor,
    ageWords: ageWords,
    pulseEnv: pulseEnv,
    pulseIndex: pulseIndex,
    renderPulse: renderPulse,
    capFor: capFor,
    coarseLadder: coarseLadder,
    Test: Test,
    RAMP: RAMP, HOLD: HOLD, PULSE: PULSE, PERIOD: PERIOD, PULSES: PULSES, CYCLE: CYCLE,
    TEST_AMP: 0.1,      // -20 dBFS peak, fixed, every test tone
    CHECK_AMP: 0.0316   // -30 dBFS, the 1 kHz volume check
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.HearingLogic = api;
})(typeof window !== "undefined" ? window : this);
