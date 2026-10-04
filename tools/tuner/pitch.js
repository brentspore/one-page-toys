/* Tuner — pitch detection and smoothing. Pure functions, no DOM, no audio graph.
 * Loaded by the page AND by the node tests (module.exports at the bottom), so the
 * numbers the tests prove are the numbers the needle shows.
 *
 * detect() is the McLeod Pitch Method: the normalized square difference
 * function (NSDF) of one window, computed through an FFT autocorrelation so a
 * 4096-sample window costs a fraction of a millisecond. Three things on top of
 * the textbook version:
 *
 *  1. Octave guard. A guitar's low E heard through a phone mic often has a much
 *     stronger 2nd harmonic than fundamental, so the waveform is NEARLY periodic
 *     at half the period and the NSDF shows a tall peak there. MPM's "first peak
 *     above k x the highest" can take it and read E3 instead of E2. If the peak
 *     at twice (or three times) the chosen lag is clearly taller, the longer
 *     period is the real one. A true fundamental never loses that test, because
 *     its own multiples can only be as tall as it is, never taller.
 *  2. Many-period refinement. Parabolic interpolation on one peak is good to a
 *     few hundredths of a sample, which is fine for a bass note (1555 samples a
 *     period) and several cents for E6 (36 samples). So once the period is known
 *     we measure the peak at m x period, as far out as the window allows, and
 *     divide by m. The same sample error over m periods is m times smaller.
 *  3. Caller-friendly result: { freq, clarity, rms }. freq 0 means "nothing
 *     here"; the gate on clarity and level lives in the tracker, which knows
 *     what it has been hearing. */
(function (root) {
  "use strict";

  /* ------------------------------------------------------------------ FFT */

  var tables = {};
  function fftTable(n) {
    if (tables[n]) return tables[n];
    var bits = Math.round(Math.log(n) / Math.LN2);
    var rev = new Uint32Array(n);
    for (var i = 0; i < n; i++) {
      var r = 0, v = i;
      for (var b = 0; b < bits; b++) { r = (r << 1) | (v & 1); v >>= 1; }
      rev[i] = r;
    }
    var cos = new Float64Array(n / 2), sin = new Float64Array(n / 2);
    for (var k = 0; k < n / 2; k++) { cos[k] = Math.cos(2 * Math.PI * k / n); sin[k] = Math.sin(2 * Math.PI * k / n); }
    tables[n] = { rev: rev, cos: cos, sin: sin };
    return tables[n];
  }

  // In-place iterative radix-2. inverse=true conjugates the twiddles (no 1/n).
  function fft(re, im, inverse) {
    var n = re.length, t = fftTable(n), rev = t.rev, i, j, tr, ti;
    for (i = 0; i < n; i++) {
      j = rev[i];
      if (j > i) { tr = re[i]; re[i] = re[j]; re[j] = tr; ti = im[i]; im[i] = im[j]; im[j] = ti; }
    }
    var sgn = inverse ? 1 : -1;
    for (var size = 2; size <= n; size <<= 1) {
      var half = size >> 1, step = n / size;
      for (var start = 0; start < n; start += size) {
        for (var k = 0, w = 0; k < half; k++, w += step) {
          var wr = t.cos[w], wi = sgn * t.sin[w];
          var a = start + k, b2 = a + half;
          var xr = re[b2] * wr - im[b2] * wi;
          var xi = re[b2] * wi + im[b2] * wr;
          re[b2] = re[a] - xr; im[b2] = im[a] - xi;
          re[a] += xr; im[a] += xi;
        }
      }
    }
  }

  /* --------------------------------------------------------------- detect */

  var work = {};
  function scratch(n) {
    if (!work[n]) work[n] = { re: new Float64Array(n), im: new Float64Array(n) };
    return work[n];
  }

  // Parabola through (p-1, p, p+1): returns [offset, height].
  function parabola(a, b, c) {
    var den = a - 2 * b + c;
    if (den === 0) return [0, b];
    var d = 0.5 * (a - c) / den;
    if (d > 1) d = 1; else if (d < -1) d = -1;
    return [d, b - 0.25 * (a - c) * d];
  }

  /* Where exactly is the top of the peak at integer lag p? A 3-point parabola is
   * right for a sharp peak, but a low note's peak is hundreds of samples wide and
   * gently curved, so any noise in the NSDF (a ripple a sample wide) outweighs
   * the curvature across three neighbors and drags the vertex several cents.
   * So: least-squares parabola over the part of the peak within 2% of its
   * height. Sharp peaks get 3 points, broad ones up to 129, and noise averages
   * out exactly where it used to dominate. */
  function peakWidth(nsdf, p) {
    var top = nsdf[p], lim = top - 0.02 * Math.abs(top), l = 0, r = 0;
    while (l < 64 && p - l - 1 > 0 && nsdf[p - l - 1] > lim) l++;
    while (r < 64 && p + r + 1 < nsdf.length && nsdf[p + r + 1] > lim) r++;
    return Math.max(1, Math.min(l, r));
  }
  function interpAt(nsdf, p, w) {
    if (p <= 0 || p >= nsdf.length - 1) return [p, nsdf[p] || 0];
    if (!w) w = peakWidth(nsdf, p);
    w = Math.min(w, p - 1, nsdf.length - 2 - p);
    if (w <= 1) {
      var q = parabola(nsdf[p - 1], nsdf[p], nsdf[p + 1]);
      return [p + q[0], q[1]];
    }
    var s0 = 0, s2 = 0, s4 = 0, sy = 0, suy = 0, su2y = 0;
    for (var u = -w; u <= w; u++) {
      var y = nsdf[p + u], u2 = u * u;
      s0++; s2 += u2; s4 += u2 * u2; sy += y; suy += u * y; su2y += u2 * y;
    }
    var b = suy / s2;
    var det = s0 * s4 - s2 * s2;
    var a = (sy * s4 - s2 * su2y) / det;
    var c = (s0 * su2y - s2 * sy) / det;
    var d = -b / (2 * c), top = a - b * b / (4 * c);
    // a noisy, nearly flat fit can put its vertex anywhere and its height far
    // above the data; then the plain 3-point parabola is the honest answer
    if (!(c < 0) || Math.abs(d) > 0.75 * w || !(top <= nsdf[p] + 0.01)) {
      var q2 = parabola(nsdf[p - 1], nsdf[p], nsdf[p + 1]);
      return [p + q2[0], q2[1]];
    }
    return [p + d, top];
  }

  // Highest NSDF sample within [lo, hi], as an integer index.
  function argmaxIn(nsdf, lo, hi) {
    lo = Math.max(1, lo); hi = Math.min(nsdf.length - 2, hi);
    var best = -1, bv = -Infinity;
    for (var i = lo; i <= hi; i++) if (nsdf[i] > bv) { bv = nsdf[i]; best = i; }
    return best;
  }

  function detect(buf, sampleRate, opts) {
    opts = opts || {};
    var N = buf.length;
    var minF = opts.minFreq || 26, maxF = opts.maxFreq || 4400;
    var K = opts.k || 0.9;
    var none = { freq: 0, clarity: 0, rms: 0 };

    // remove the mean only. Detrending (a best-fit line) sounds safer and is
    // worse: with two or three periods of B0 in the window, a sine has a real
    // linear component, and taking it out bent the waveform by up to 11 cents.
    // Rumble and DC are the job of the highpass in front of the analysis, not this one.
    var mean = 0, i;
    for (i = 0; i < N; i++) mean += buf[i];
    mean /= N;
    var M = 1; while (M < 2 * N) M <<= 1;
    var s = scratch(M), re = s.re, im = s.im;
    var e = 0;
    for (i = 0; i < N; i++) { var v = buf[i] - mean; re[i] = v; im[i] = 0; e += v * v; }
    for (i = N; i < M; i++) { re[i] = 0; im[i] = 0; }
    var rms = Math.sqrt(e / N);
    none.rms = rms;
    if (!(rms > 1e-6)) return none;

    // keep x for the m(tau) recursion before the FFT overwrites re
    var x = s.x && s.x.length === N ? s.x : (s.x = new Float64Array(N));
    for (i = 0; i < N; i++) x[i] = re[i];

    fft(re, im, false);
    for (i = 0; i < M; i++) { re[i] = re[i] * re[i] + im[i] * im[i]; im[i] = 0; }
    fft(re, im, true);                      // re[tau] * M = sum x[j] x[j+tau]

    var tauMin = Math.max(2, Math.floor(sampleRate / maxF));
    var tauMax = Math.min(Math.floor(N * 0.62), Math.ceil(sampleRate / minF) + 2);
    var limit = Math.max(tauMax, Math.floor(N * 0.55));
    var nsdf = s.nsdf && s.nsdf.length === limit + 2 ? s.nsdf : (s.nsdf = new Float64Array(limit + 2));
    var m = 2 * e;
    nsdf[0] = 1;
    for (var t = 1; t <= limit + 1; t++) {
      m -= x[t - 1] * x[t - 1] + x[N - t] * x[N - t];
      nsdf[t] = m > 1e-12 ? (2 * re[t] / M) / m : 0;
    }

    // Key maxima: the highest point of each positive lobe after the first
    // negative-going crossing (the lobe around lag 0 is the signal matching itself).
    var keys = [], t2 = 1;
    while (t2 < tauMax && nsdf[t2] > 0) t2++;
    var inLobe = false, kb = -1, kv = -Infinity, nmax = 0;
    for (; t2 <= tauMax; t2++) {
      var y = nsdf[t2];
      if (y > 0) {
        if (!inLobe) { inLobe = true; kb = -1; kv = -Infinity; }
        if (y > kv) { kv = y; kb = t2; }
      } else if (inLobe) {
        inLobe = false;
        if (kb >= tauMin) { keys.push(kb); if (kv > nmax) nmax = kv; }
      }
    }
    if (inLobe && kb >= tauMin && kb < tauMax) { keys.push(kb); if (kv > nmax) nmax = kv; }
    if (!keys.length || nmax <= 0) return none;

    var pick = -1;
    for (i = 0; i < keys.length; i++) if (nsdf[keys[i]] >= K * nmax) { pick = keys[i]; break; }
    if (pick < 0) return none;
    var est = interpAt(nsdf, pick);

    // 1. Octave guard: is a multiple of this lag clearly the better period?
    for (var guard = 0; guard < 3; guard++) {
      var moved = false;
      for (var mult = 2; mult <= 3; mult++) {
        var at = est[0] * mult;
        if (at > tauMax) break;
        var w = Math.max(2, Math.ceil(at * 0.03));
        var p2 = argmaxIn(nsdf, Math.round(at) - w, Math.round(at) + w);
        if (p2 < 0) continue;
        var e2 = interpAt(nsdf, p2);
        // the margin widens with noise: at 6 dB SNR the NSDF wobbles by more than 0.035
        // (three times the lag is a rarer error and gets twice the margin)
        if (e2[1] > est[1] + (0.03 + 0.35 * (1 - est[1])) * (mult - 1) && e2[1] > 0.5) { est = e2; moved = true; break; }
      }
      if (!moved) break;
    }
    /* Instrument mode knows the strings. When the period and its double (or
     * half) are equally good explanations of the waveform, which happens when a
     * fundamental is almost missing, take the one that is a string's note. A
     * weak low E reads E3, which is no string at all; E2 is the one being tuned. */
    var targets = opts.targets;
    if (targets && targets.length) {
      var dist = function (f) {
        var best = Infinity;
        for (var q = 0; q < targets.length; q++) best = Math.min(best, Math.abs(1200 * Math.log(f / targets[q]) / Math.LN2));
        return best;
      };
      var here = dist(sampleRate / est[0]);
      var alts = [est[0] * 2, est[0] / 2];
      for (var ai = 0; ai < 2; ai++) {
        var lag = alts[ai];
        if (lag > tauMax || lag < tauMin) continue;
        var wa = Math.max(2, Math.ceil(lag * 0.03));
        var pa = argmaxIn(nsdf, Math.round(lag) - wa, Math.round(lag) + wa);
        if (pa < 0) continue;
        var ea = interpAt(nsdf, pa);
        if (ea[1] >= est[1] - 0.03 && dist(sampleRate / ea[0]) + 150 < here) { est = ea; break; }
      }
    }
    var clarity = Math.min(1, est[1]);
    var period = est[0];
    var wMain = peakWidth(nsdf, Math.round(period));

    // 2. Many-period refinement.
    var reach = Math.floor(N * 0.5);
    var mm = Math.min(48, Math.floor(reach / period));
    if (mm >= 2) {
      var c = period * mm;
      var w2 = 2 + Math.ceil(mm * 0.12);
      var p3 = argmaxIn(nsdf, Math.round(c) - w2, Math.round(c) + w2);
      if (p3 > 0) {
        var e3 = interpAt(nsdf, p3, wMain);
        var refined = e3[0] / mm;
        if (e3[1] > 0.55 * clarity && Math.abs(refined - period) < 0.5) period = refined;
      }
    }

    var freq = sampleRate / period;
    if (!(freq >= minF * 0.97 && freq <= maxF * 1.03)) return none;
    return { freq: freq, clarity: clarity, rms: rms };
  }

  /* ----------------------------------------------------------- note math */

  var SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  var FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

  function midiFreq(midi, a4) { return (a4 || 440) * Math.pow(2, (midi - 69) / 12); }
  function centsBetween(f, ref) { return 1200 * Math.log(f / ref) / Math.LN2; }

  // Nearest equal-tempered note to f, given the A4 reference.
  function noteOf(f, a4) {
    var x = 69 + 12 * Math.log(f / (a4 || 440)) / Math.LN2;
    var midi = Math.round(x);
    return { midi: midi, cents: (x - midi) * 100 };
  }

  function noteName(midi, flats) {
    var pc = ((midi % 12) + 12) % 12;
    return { name: (flats ? FLAT : SHARP)[pc], octave: Math.floor(midi / 12) - 1 };
  }

  // Which string of the set is this pitch closest to (in cents)?
  function nearestString(f, strings, a4) {
    var best = -1, bc = Infinity;
    for (var i = 0; i < strings.length; i++) {
      var c = centsBetween(f, midiFreq(strings[i], a4));
      if (Math.abs(c) < Math.abs(bc)) { bc = c; best = i; }
    }
    return { index: best, cents: bc };
  }

  /* -------------------------------------------------------------- tracker
   * Turns a stream of per-frame detections into one calm reading.
   *  - gate: level must clear an adaptive noise floor, and clarity a
   *    frequency-dependent bar (high notes have naturally lower NSDF peaks).
   *  - median of the last few accepted frames, so one stray frame cannot kick
   *    the needle; a genuine note change has to show up twice in a row.
   *  - exponential follow in cents, so the readout glides instead of jumping.
   *  - hold: when the string dies away the last reading stays up for a beat,
   *    dimmed, the way a hardware tuner does. */
  function claritySpec(f) { return f < 200 ? 0.86 : f < 500 ? 0.82 : f < 900 ? 0.76 : 0.7; }

  function median(a) {
    var b = a.slice().sort(function (p, q) { return p - q; });
    var n = b.length;
    return n % 2 ? b[(n - 1) / 2] : 0.5 * (b[n / 2 - 1] + b[n / 2]);
  }

  function createTracker(opts) {
    opts = opts || {};
    var HOLD = opts.holdMs || 1100;
    var FOLLOW = opts.followMs || 70;
    var MED = opts.medianN || 5;
    var hist = [], pend = null, pendN = 0;
    var floor = 0.0008, lastAccept = -1e9, lastT = null, pitch = null;
    var st = { active: false, holding: false, freq: 0, pitch: 0, clarity: 0, level: 0, since: 0 };

    function reset() { hist = []; pend = null; pendN = 0; pitch = null; st.active = false; st.holding = false; st.freq = 0; }

    function push(det, tMs) {
      var dt = lastT === null ? 16 : Math.max(1, Math.min(200, tMs - lastT));
      lastT = tMs;
      var lvl = det ? det.rms : 0;
      st.level = lvl;
      // the noise floor drops quickly to whatever is quietest, and only creeps up
      // on frames that are NOT a clear pitch: a long, ringing note must never
      // raise the floor under itself and gate its own tail away
      var pitched = det && det.freq > 0 && det.clarity > 0.8;
      if (lvl > 0) floor = lvl < floor ? floor + (lvl - floor) * 0.2 : pitched ? floor : floor + (lvl - floor) * 0.01;
      var gate = Math.max(opts.minLevel || 0.0025, Math.min(0.02, floor * 2.6));
      var ok = det && det.freq > 0 && lvl >= gate && det.clarity >= claritySpec(det.freq) - (st.active ? 0.06 : 0);
      if (ok) {
        var p = 1200 * Math.log(det.freq / 440) / Math.LN2;   // cents from A440, absolute
        if (hist.length && Math.abs(p - median(hist)) > 60) {
          // a jump: believe it only if the next frame agrees
          if (pend !== null && Math.abs(p - pend) < 40) pendN++; else { pend = p; pendN = 1; }
          if (pendN >= 2 || tMs - lastAccept > 250) { hist = [pend, p]; pitch = null; pend = null; pendN = 0; st.since = tMs; }
          else ok = false;
        } else { pend = null; pendN = 0; hist.push(p); }
        if (ok) {
          if (hist.length > MED) hist.shift();
          if (!st.active) st.since = tMs;
          lastAccept = tMs;
          var med = median(hist);
          var a = 1 - Math.exp(-dt / FOLLOW);
          pitch = pitch === null ? med : pitch + (med - pitch) * a;
          st.active = true; st.holding = false; st.clarity = det.clarity;
        }
      }
      if (!ok && st.active) {
        if (tMs - lastAccept > HOLD) reset();
        else st.holding = tMs - lastAccept > 90;
      }
      if (pitch !== null) { st.pitch = pitch; st.freq = 440 * Math.pow(2, pitch / 1200); }
      st.gate = gate;
      return st;
    }

    return { push: push, reset: reset, state: st };
  }

  var api = {
    detect: detect, fft: fft, midiFreq: midiFreq, centsBetween: centsBetween, noteOf: noteOf,
    noteName: noteName, nearestString: nearestString, createTracker: createTracker,
    claritySpec: claritySpec, median: median
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TunerPitch = api;
})(typeof window !== "undefined" ? window : this);
