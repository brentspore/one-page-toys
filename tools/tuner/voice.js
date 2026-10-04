/* Tuner — reference tones, rendered into plain sample arrays. Pure, so the node
 * tests can run the tuner's own detector over them.
 *
 * A reference tone that is a few cents off is worse than none, and textbook
 * Karplus-Strong is exactly that: the loop is a whole number of samples plus
 * the half sample of its averaging filter, so E4 at 48 kHz lands 145.6 samples
 * where it should be 145.63 (0.4 cents) and E5 misses by more. The loop here
 * carries a first-order allpass for the fraction, and its coefficient is SOLVED
 * so the allpass's phase delay at the fundamental (not at DC, where the usual
 * formula is exact) makes the loop exactly one period long. The tests hold every
 * string under a tenth of a cent.
 *
 * renderPluck: a noise burst (lowpassed, so it is a finger and not a hiss),
 *   notched at the pick position, circulating through the tuned loop. The
 *   averaging filter is why the bright attack settles into a round tone and why
 *   high strings die faster than low ones.
 * renderBow: Helmholtz motion is close to a sawtooth, so the bowed voice is a
 *   band-limited sawtooth with the bow-position notches, read from a one-period
 *   table with an exact phase step. It swells in, breathes a little (bow
 *   pressure, never pitch: a reference tone must not wobble), carries a whisper
 *   of rosin noise on the slip, and lets go. */
(function (root) {
  "use strict";

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  // Seeded random so a test run is repeatable; the page passes Math.random.
  function rng(seed) {
    var s = (seed >>> 0) || 1;
    return function () { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  }

  // Phase delay (samples) of (C + z^-1) / (1 + C z^-1) at angular frequency w.
  function apDelay(C, w) {
    var p1 = Math.atan2(-Math.sin(w), C + Math.cos(w));
    var p2 = Math.atan2(-C * Math.sin(w), 1 + C * Math.cos(w));
    return -(p1 - p2) / w;
  }
  // The allpass coefficient whose phase delay at w is exactly d (0.05..1.2).
  function solveAllpass(d, w) {
    var lo = -0.9, hi = 0.999;             // delay falls as C rises
    for (var i = 0; i < 60; i++) {
      var mid = 0.5 * (lo + hi);
      if (apDelay(mid, w) > d) lo = mid; else hi = mid;
    }
    return 0.5 * (lo + hi);
  }

  function scrub(out) {
    for (var i = 0; i < out.length; i++) if (!isFinite(out[i])) out[i] = 0;
    return out;
  }

  /* opts: seconds, t60 (s, for the fundamental), bright (0..1), pick (0..0.5),
   *       random (fn), knock (0..1) */
  function renderPluck(freq, sr, opts) {
    opts = opts || {};
    var rand = opts.random || rng(opts.seed || 7);
    var secs = opts.seconds || 3;
    var len = Math.floor(sr * secs);
    var out = new Float32Array(len);
    var P = sr / freq;
    var Nd = Math.floor(P - 0.5 - 0.15);
    var frac = P - 0.5 - Nd;                         // 0.15 .. 1.15
    var w = 2 * Math.PI * freq / sr;
    var C = solveAllpass(frac, w);
    // loss per trip: the averager already takes cos(w/2) from the fundamental
    var t60 = opts.t60 || 3;
    var rho = Math.pow(10, -3 / (freq * t60)) / Math.max(0.5, Math.cos(w / 2));
    rho = Math.min(rho, 0.99995);

    var line = new Float64Array(Nd);
    var bright = clamp(opts.bright === undefined ? 0.55 : opts.bright, 0.05, 1);
    var beta = opts.pick === undefined ? 0.16 : opts.pick;
    var i, h;
    /* The excitation is the plucked shape, not raw noise. A random burst on a
     * 47-sample loop (B5) can land with almost no fundamental in it, and then
     * the reference tone sounds, and measures, an octave up. A string plucked a
     * fraction beta along its length has harmonics in sin(pi h beta) over a
     * power of h, so the fundamental is always there and the pick position's
     * notches come for free. A little lowpassed noise on top is the finger. */
    var H = Math.max(1, Math.floor(Nd / 2.2));
    var tilt = 2.05 - 0.9 * bright;
    for (h = 1; h <= H; h++) {
      var amp = Math.abs(Math.sin(Math.PI * h * beta)) / Math.pow(h, tilt);
      var ph = rand() * 0.6;
      var dw = 2 * Math.PI * h / Nd;
      for (i = 0; i < Nd; i++) line[i] += amp * Math.sin(dw * i + ph);
    }
    var lp = 0, mean = 0, nz = new Float64Array(Nd), lpk = 0, npk = 0;
    for (i = 0; i < Nd; i++) { lp += bright * ((rand() * 2 - 1) - lp); nz[i] = lp; mean += lp; }
    mean /= Nd;
    for (i = 0; i < Nd; i++) { nz[i] -= mean; npk = Math.max(npk, Math.abs(nz[i])); lpk = Math.max(lpk, Math.abs(line[i])); }
    for (i = 0; i < Nd; i++) line[i] += nz[i] * 0.22 * (lpk / (npk || 1));
    // normalize the excitation so every string starts at the same level
    var peak = 0;
    for (i = 0; i < Nd; i++) peak = Math.max(peak, Math.abs(line[i]));
    for (i = 0; i < Nd; i++) line[i] /= (peak || 1);

    var idx = 0, prev = 0, apIn = 0, apOut = 0;
    for (var k = 0; k < len; k++) {
      var s = line[idx];
      out[k] = s;
      var avg = 0.5 * (s + prev);
      prev = s;
      var a = C * avg + apIn - C * apOut;
      apIn = avg; apOut = a;
      line[idx] = a * rho;
      idx++; if (idx === Nd) idx = 0;
    }

    // a finger or pick meets the string: a short soft knock under the attack
    var knock = opts.knock === undefined ? 0.18 : opts.knock;
    if (knock > 0) {
      var kl = Math.floor(sr * 0.012), kp = 0;
      for (i = 0; i < kl; i++) {
        kp += 0.25 * ((rand() * 2 - 1) - kp);
        out[i] += kp * knock * Math.pow(1 - i / kl, 2);
      }
    }
    // DC blocker (~8 Hz): belt and braces against any offset left in the loop
    var R = 1 - 2 * Math.PI * 8 / sr, xm = 0, ym = 0;
    for (i = 0; i < len; i++) { var y0 = out[i] - xm + R * ym; xm = out[i]; ym = y0; out[i] = y0; }
    // gentle onset (no click) and a fade so stopping never clicks
    var on = Math.floor(sr * 0.0015);
    for (i = 0; i < on; i++) out[i] *= i / on;
    var fade = Math.min(Math.floor(sr * 0.4), Math.floor(len * 0.2));
    for (i = 0; i < fade; i++) out[len - 1 - i] *= i / fade;
    return scrub(out);
  }

  /* opts: seconds, attack, release, bright (0..1), random */
  function renderBow(freq, sr, opts) {
    opts = opts || {};
    var rand = opts.random || rng(opts.seed || 11);
    var secs = opts.seconds || 2.6;
    var len = Math.floor(sr * secs);
    var out = new Float32Array(len);
    var TS = 2048;
    var H = Math.max(1, Math.min(64, Math.floor(0.42 * sr / freq)));
    var beta = 0.115;
    var hard = new Float64Array(TS + 1), soft = new Float64Array(TS + 1);
    var bright = clamp(opts.bright === undefined ? 0.6 : opts.bright, 0, 1);
    for (var h = 1; h <= H; h++) {
      var notch = 0.5 + 0.5 * Math.abs(Math.sin(Math.PI * h * beta)) / Math.max(0.2, Math.abs(Math.sin(Math.PI * beta)));
      var a = notch / h;
      var as = a / (1 + Math.pow(h / (3 + 6 * bright), 2));
      var ph = h * 0.37;                                  // fixed phases: no sharp sawtooth edge
      for (var j = 0; j < TS; j++) {
        var sn = Math.sin(2 * Math.PI * h * j / TS + ph);
        hard[j] += a * sn; soft[j] += as * sn;
      }
    }
    hard[TS] = hard[0]; soft[TS] = soft[0];
    var pk = 0;
    for (var q = 0; q < TS; q++) pk = Math.max(pk, Math.abs(hard[q]));
    var atk = opts.attack || 0.16, rel = opts.release || 0.45;
    var step = freq / sr, phase = 0, np = 0;
    var w1 = rand() * 6.28, w2 = rand() * 6.28;
    for (var k = 0; k < len; k++) {
      var t = k / sr;
      var env = t < atk ? Math.sin(0.5 * Math.PI * t / atk) : 1;
      if (t > secs - rel) env *= Math.max(0, (secs - t) / rel);
      env = env * env * (3 - 2 * env);
      // bow pressure breathes: a slow, small, irregular swell (amplitude only)
      env *= 1 + 0.025 * Math.sin(2 * Math.PI * 4.7 * t + w1) + 0.018 * Math.sin(2 * Math.PI * 1.9 * t + w2);
      // the attack is a touch scratchier, then the tone settles
      var mix = clamp(0.35 + 0.65 * Math.exp(-t / 0.09), 0, 1);
      var x = phase * TS, i0 = x | 0, fr = x - i0;
      var vh = hard[i0] + (hard[i0 + 1] - hard[i0]) * fr;
      var vs = soft[i0] + (soft[i0 + 1] - soft[i0]) * fr;
      var v = (vs + (vh - vs) * (mix * 0.6 + 0.4 * bright)) / pk;
      // rosin: noise that rides the slip at the start of each cycle
      np += 0.35 * ((rand() * 2 - 1) - np);
      var slip = phase < 0.12 ? 1 - phase / 0.12 : 0;
      v += np * 0.05 * (0.3 + slip) * (0.6 + mix);
      out[k] = v * env;
      phase += step; if (phase >= 1) phase -= 1;
    }
    return scrub(out);
  }

  var api = { renderPluck: renderPluck, renderBow: renderBow, solveAllpass: solveAllpass, apDelay: apDelay, rng: rng };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TunerVoice = api;
})(typeof window !== "undefined" ? window : this);
