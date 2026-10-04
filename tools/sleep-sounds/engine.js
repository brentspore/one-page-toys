/* Sleep Sounds: the sound engine. Runs as an AudioWorklet, so every sound is
 * made fresh, sample by sample, on the audio thread:
 *   - nothing is a recording and nothing loops: the noise comes from a random
 *     generator with a period of 2^128 samples, so there is no loop point to hear;
 *   - every event (rain drops, drips off the eaves, wave sets, fire crackles,
 *     thunder) is scheduled HERE, not by page timers, so it keeps happening
 *     when the tab is in the background and the page's own timers are asleep.
 * The same file loads in node for the level and repetition tests (see the
 * bottom); it has no imports and no exports so it works as both.
 *
 * Output 0 is the dry stereo mix. Output 1 is a stereo send to the page's
 * convolver (the night outside: thunder rolls into it, drips echo in it). */
"use strict";

{  // one block, so a classic-script load (the fallback) adds a single global

const TAU = Math.PI * 2;
const BLK = 128;

// ---------- random: xoshiro128** (period 2^128 - 1) ----------
function rotl(x, k) { return (x << k) | (x >>> (32 - k)); }
class Rng {
  constructor(seed) {
    seed = seed >>> 0 || 0x51ed270b;
    this.a = seed ^ 0x9e3779b9; this.b = 0x243f6a88; this.c = 0xb7e15162; this.d = Math.imul(seed, 0x85ebca6b) ^ 0x632be5ab;
    for (let i = 0; i < 20; i++) this.u32();
  }
  u32() {
    const r = Math.imul(rotl(Math.imul(this.b, 5), 7), 9);
    const t = this.b << 9;
    this.c ^= this.a; this.d ^= this.b; this.b ^= this.c; this.a ^= this.d; this.c ^= t; this.d = rotl(this.d, 11);
    return r >>> 0;
  }
  f() { return this.u32() / 4294967296; }            // [0, 1)
  s() { return (this.u32() | 0) / 2147483648; }      // [-1, 1)
  range(a, b) { return a + (b - a) * this.f(); }
  logr(a, b) { return a * Math.pow(b / a, this.f()); }  // log-uniform
  gauss() { return (this.f() + this.f() + this.f() + this.f() - 2) * 1.7320508; }
  expo(mean) { return -Math.log(1 - this.f()) * mean; }
}

// ---------- helpers ----------
const SIN_N = 4096;
const SIN = new Float32Array(SIN_N + 1);
for (let i = 0; i <= SIN_N; i++) SIN[i] = Math.sin(TAU * i / SIN_N);
function sinc(ph) {                                  // ph in cycles, [0, 1)
  const x = ph * SIN_N, i = x | 0;
  return SIN[i] + (SIN[i + 1] - SIN[i]) * (x - i);
}
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function panL(p) { return Math.cos((clamp(p, -1, 1) + 1) * Math.PI / 4); }
function panR(p) { return Math.sin((clamp(p, -1, 1) + 1) * Math.PI / 4); }
function onePole(hz, sr) { return 1 - Math.exp(-TAU * hz / sr); }

// Zavalishin/Simper state-variable filter: stable while its cutoff moves.
class SVF {
  constructor() { this.i1 = 0; this.i2 = 0; this.a1 = 1; this.a2 = 0; this.a3 = 0; this.k = 1.4; }
  set(fc, q, sr) {
    const g = Math.tan(Math.PI * clamp(fc, 10, sr * 0.45) / sr);
    this.k = 1 / q; this.a1 = 1 / (1 + g * (g + this.k)); this.a2 = g * this.a1; this.a3 = g * this.a2;
  }
  lp(x) {
    const v3 = x - this.i2, v1 = this.a1 * this.i1 + this.a2 * v3, v2 = this.i2 + this.a2 * this.i1 + this.a3 * v3;
    this.i1 = 2 * v1 - this.i1; this.i2 = 2 * v2 - this.i2; return v2;
  }
  bp(x) {
    const v3 = x - this.i2, v1 = this.a1 * this.i1 + this.a2 * v3, v2 = this.i2 + this.a2 * this.i1 + this.a3 * v3;
    this.i1 = 2 * v1 - this.i1; this.i2 = 2 * v2 - this.i2; return v1;
  }
  hp(x) {
    const v3 = x - this.i2, v1 = this.a1 * this.i1 + this.a2 * v3, v2 = this.i2 + this.a2 * this.i1 + this.a3 * v3;
    this.i1 = 2 * v1 - this.i1; this.i2 = 2 * v2 - this.i2; return x - this.k * v1 - v2;
  }
}

// A slow smooth random wander, roughly unit spread, stepped once per block.
class Drift {
  constructor(rng, hz, blockRate) {
    this.rng = rng; this.a = 1 - Math.exp(-TAU * hz / blockRate);
    const p = 1 - this.a;
    // two cascaded one-poles on uniform noise (variance 1/3): output variance
    // = (1/3) a^4 (1 + p^2) / (1 - p^2)^3. Normalize to unit spread.
    this.norm = 1 / Math.sqrt((1 / 3) * Math.pow(this.a, 4) * (1 + p * p) / Math.pow(1 - p * p, 3));
    this.y1 = 0; this.y2 = 0; this.v = 0;
    for (let i = 0; i < 4 / this.a; i++) this.next();
  }
  next() {
    this.y1 += this.a * (this.rng.s() - this.y1);
    this.y2 += this.a * (this.y1 - this.y2);
    return (this.v = clamp(this.y2 * this.norm, -2.5, 2.5));
  }
}

// A pool of struck resonators: each voice is a decaying complex phasor (a
// damped sine at the object's own frequency) plus an optional noise click on
// the front. Rain drops and fire crackles are built from these.
class ResPool {
  constructor(n, rng) {
    this.n = n; this.rng = rng;
    this.on = new Uint8Array(n); this.st = new Int32Array(n);
    this.re = new Float64Array(n); this.im = new Float64Array(n);
    this.cr = new Float64Array(n); this.ci = new Float64Array(n);
    this.pl = new Float32Array(n); this.pr = new Float32Array(n);
    this.ck = new Float64Array(n); this.cd = new Float64Array(n); this.cn = new Int32Array(n);
    this.a0 = new Float64Array(n);
    this.L = new Float32Array(BLK); this.R = new Float32Array(BLK);
    this.count = 0;
  }
  // f Hz, tau seconds (amplitude 1/e), amp, pan -1..1, click amp/len samples, start offset
  spawn(f, tau, amp, pan, cAmp, cLen, at, sr) {
    let v = -1;
    for (let i = 0; i < this.n; i++) if (!this.on[i]) { v = i; break; }
    if (v < 0) return;                                   // pool full: drop it, the bed covers
    const w = TAU * Math.min(f, sr * 0.45) / sr, r = Math.exp(-1 / (tau * sr));
    this.on[v] = 1; this.st[v] = at; this.re[v] = amp; this.im[v] = 0; this.a0[v] = amp;
    this.cr[v] = r * Math.cos(w); this.ci[v] = r * Math.sin(w);
    this.pl[v] = panL(pan); this.pr[v] = panR(pan);
    this.ck[v] = cAmp; this.cn[v] = cLen | 0; this.cd[v] = cLen > 0 ? Math.pow(0.02, 1 / cLen) : 0;
    this.count++;
  }
  render(n) {
    const L = this.L, R = this.R, rng = this.rng;
    L.fill(0, 0, n); R.fill(0, 0, n);
    if (!this.count) return;
    for (let v = 0; v < this.n; v++) {
      if (!this.on[v]) continue;
      let re = this.re[v], im = this.im[v], ck = this.ck[v], cn = this.cn[v];
      const cr = this.cr[v], ci = this.ci[v], cd = this.cd[v], pl = this.pl[v], pr = this.pr[v];
      for (let i = this.st[v]; i < n; i++) {
        const nr = re * cr - im * ci; im = re * ci + im * cr; re = nr;
        let s = im;
        if (cn > 0) { s += rng.s() * ck; ck *= cd; cn--; }
        L[i] += s * pl; R[i] += s * pr;
      }
      this.st[v] = 0; this.re[v] = re; this.im[v] = im; this.ck[v] = ck; this.cn[v] = cn;
      if (cn <= 0 && Math.abs(re) + Math.abs(im) < this.a0[v] * 2e-4 + 1e-7) { this.on[v] = 0; this.count--; }
    }
  }
  clear() { this.on.fill(0); this.count = 0; }
}

// ======================= the layers =======================
// Each render() ADDS into the dry (oL, oR) and send (sL, sR) buffers, scaled
// by the per-sample layer gain G[]. Level constants (K) were set by measuring
// loudness in node (see the test), so equal sliders sound roughly equally loud.

// ---- brown: white noise through a one-pole lowpass at 32 Hz (-6 dB/oct
// above it), sub-bass below 18 Hz removed. Deep, smooth, waterfall-like.
class Brown {
  constructor(E) { this.r = new Rng(E.rng.u32()); this.a = onePole(32, E.sr); this.h = onePole(18, E.sr); this.yl = 0; this.yr = 0; this.hl = 0; this.hr = 0; this.K = 4.95; }
  render(n, G, oL, oR) {
    const r = this.r, a = this.a, h = this.h, K = this.K;
    let yl = this.yl, yr = this.yr, hl = this.hl, hr = this.hr;
    for (let i = 0; i < n; i++) {
      const c = r.s();
      yl += a * (0.75 * c + 0.66 * r.s() - yl); yr += a * (0.75 * c + 0.66 * r.s() - yr);
      hl += h * (yl - hl); hr += h * (yr - hr);
      const g = G[i] * K;
      oL[i] += (yl - hl) * g; oR[i] += (yr - hr) * g;
    }
    this.yl = yl; this.yr = yr; this.hl = hl; this.hr = hr;
  }
}

// ---- pink: Paul Kellet's filter, -3 dB/oct. Each channel its own state.
class Pink {
  constructor(E) { this.r = new Rng(E.rng.u32()); this.L = new Float64Array(7); this.R = new Float64Array(7); this.K = 0.375; }
  static step(b, w) {
    b[0] = 0.99886 * b[0] + w * 0.0555179; b[1] = 0.99332 * b[1] + w * 0.0750759;
    b[2] = 0.96900 * b[2] + w * 0.1538520; b[3] = 0.86650 * b[3] + w * 0.3104856;
    b[4] = 0.55000 * b[4] + w * 0.5329522; b[5] = -0.7616 * b[5] - w * 0.0168980;
    const p = b[0] + b[1] + b[2] + b[3] + b[4] + b[5] + b[6] + w * 0.5362;
    b[6] = w * 0.115926;
    return p * 0.11;
  }
  render(n, G, oL, oR) {
    const r = this.r, K = this.K;
    for (let i = 0; i < n; i++) {
      const c = r.s();
      const g = G[i] * K;
      oL[i] += Pink.step(this.L, 0.75 * c + 0.66 * r.s()) * g;
      oR[i] += Pink.step(this.R, 0.75 * c + 0.66 * r.s()) * g;
    }
  }
}

// ---- white: flat. The harshest color, so its constant is the smallest.
class White {
  constructor(E) { this.r = new Rng(E.rng.u32()); this.K = 0.076; }
  render(n, G, oL, oR) {
    const r = this.r, K = this.K;
    for (let i = 0; i < n; i++) {
      const c = r.s(), g = G[i] * K;
      oL[i] += (0.75 * c + 0.66 * r.s()) * g; oR[i] += (0.75 * c + 0.66 * r.s()) * g;
    }
  }
}

// ---- rain: one control from a light shower to a downpour.
//  bed:   the countless far drops, which sum to noise. Pink, banded 250 Hz to
//         ~8 kHz, darker and thinner for light rain, a low roar added when heavy,
//         breathing with slow gusts.
//  drops: the near ones you hear one by one, a Poisson stream of tiny struck
//         resonators (ticks on stone and leaves, a few pats on wood, the odd
//         plip into a puddle), 6 a second light, ~180 a second heavy.
//  drips: three drips off the eaves, each with its own pitch, place and slowly
//         drifting rhythm: a tap and a rising bubble note, like a drop into a
//         puddle. They carry the intimacy of light rain and get masked in heavy.
class Rain {
  constructor(E) {
    const sr = E.sr; this.E = E; this.sr = sr;
    this.r = new Rng(E.rng.u32());
    this.pl = new Float64Array(7); this.pr = new Float64Array(7);
    this.hl = new SVF(); this.hr = new SVF(); this.ll = new SVF(); this.lr = new SVF();
    this.bl = 0; this.br = 0; this.ba = onePole(140, sr);
    this.dl = 0; this.dr = 0; this.da = onePole(7000, sr);
    this.pool = new ResPool(72, this.r);
    this.gust = new Drift(this.r, 0.06, sr / BLK); this.g = 1;
    this.nextDrop = 0; this.int = 0; this.coef = -1;
    this.drips = [
      { f: 980,  pan: -0.62, amp: 1.0,  per: 1.3, next: sr * 0.7 },
      { f: 1380, pan: 0.38,  amp: 0.72, per: 2.1, next: sr * 1.6 },
      { f: 1840, pan: 0.78,  amp: 0.55, per: 0.9, next: sr * 2.4 }
    ];
    this.dv = [];                                         // sounding drips
    this.Kbed = 0.55; this.Kdrop = 0.36; this.Kdrip = 0.09;
  }
  setIntensity(x) { this.int = x; }
  render(n, G, oL, oR, sL, sR) {
    const r = this.r, sr = this.sr, x = this.int;
    // gusts: slow swell of the whole rain
    this.g = 1 + 0.2 * this.gust.next();
    const gust = this.g;
    const key = Math.round(x * 200);
    if (key !== this.coef) {
      this.coef = key;
      const fh = 520 - 300 * x, fl = 4200 + 4200 * x;
      this.hl.set(fh, 0.7, sr); this.hr.set(fh, 0.7, sr); this.ll.set(fl, 0.6, sr); this.lr.set(fl, 0.6, sr);
    }
    // --- schedule near drops for this block ---
    const rate = (6 + 175 * x * x) * (0.75 + 0.25 * gust);
    while (this.nextDrop < n) {
      const at = Math.max(0, this.nextDrop | 0);
      const kind = r.f();
      const big = clamp(Math.exp(0.45 * r.gauss()), 0.3, 2.2);
      if (kind < 0.72) this.pool.spawn(r.logr(1500, 6200), r.range(0.0005, 0.0016), 0.22 * big, r.range(-0.95, 0.95), 0.12 * big, 10 + (r.f() * 18 | 0), at, sr);
      else if (kind < 0.94) this.pool.spawn(r.logr(480, 1500), r.range(0.002, 0.006), 0.2 * big, r.range(-0.9, 0.9), 0.08 * big, 24, at, sr);
      else this.pool.spawn(r.logr(1800, 3600), r.range(0.006, 0.014), 0.09 * big, r.range(-0.8, 0.8), 0.05, 12, at, sr);
      this.nextDrop += r.expo(sr / rate);
    }
    this.nextDrop -= n;
    this.pool.render(n);
    // --- drips off the eaves ---
    const dripOn = 0.35 + 0.9 * x;
    for (let d = 0; d < this.drips.length; d++) {
      const D = this.drips[d];
      D.next -= n;
      if (D.next <= 0) {
        if (r.f() < dripOn && this.dv.length < 6) {
          this.dv.push({
            ph: 0, f: D.f * (1 + 0.04 * r.gauss()), up: r.range(0.25, 0.55), t: 0, st: Math.max(0, n + D.next | 0) % n,
            tau: r.range(0.018, 0.034), amp: D.amp * (0.75 + 0.25 * r.f()), pl: panL(D.pan), pr: panR(D.pan), tap: 90
          });
        }
        D.per = clamp(D.per * Math.exp(0.08 * r.gauss()), 0.55, 3.4);
        D.next += D.per * sr * (0.88 + 0.24 * r.f());
      }
    }
    // --- bed + mix ---
    const bedAmp = this.Kbed * Math.pow(x, 0.75) * gust, roar = 1.6 * x * x * x * gust;
    const dropK = this.Kdrop, da = this.da, ba = this.ba;
    const PL = this.pool.L, PR = this.pool.R;
    let bl = this.bl, br = this.br, dl = this.dl, dr = this.dr;
    for (let i = 0; i < n; i++) {
      const c = r.s();
      const wl = 0.6 * c + 0.8 * r.s(), wr = 0.6 * c + 0.8 * r.s();
      let L = this.ll.lp(this.hl.hp(Pink.step(this.pl, wl)));
      let R = this.lr.lp(this.hr.hp(Pink.step(this.pr, wr)));
      bl += ba * (wl - bl); br += ba * (wr - br);           // heavy-rain roar
      L = L * bedAmp + bl * roar; R = R * bedAmp + br * roar;
      dl += da * (PL[i] - dl); dr += da * (PR[i] - dr);     // soften the drop clicks
      const g = G[i];
      oL[i] += (L + dl * dropK) * g; oR[i] += (R + dr * dropK) * g;
      sL[i] += (L * 0.12 + dl * dropK * 0.3) * g; sR[i] += (R * 0.12 + dr * dropK * 0.3) * g;
    }
    this.bl = bl; this.br = br; this.dl = dl; this.dr = dr;
    // drips: a soft tap, then a sine that rises in pitch as it rings
    const Kd = this.Kdrip;
    for (let v = this.dv.length - 1; v >= 0; v--) {
      const V = this.dv[v];
      const dec = Math.exp(-1 / (V.tau * sr));
      let env = V.env === undefined ? 1 : V.env, ph = V.ph, t = V.t, tap = V.tap;
      for (let i = V.st; i < n; i++) {
        const att = t < 24 ? t / 24 : 1;
        const fNow = V.f * (1 + V.up * (1 - env));         // pitch rises as it decays
        ph += fNow / sr; if (ph >= 1) ph -= 1;
        let s = sinc(ph) * env * att * V.amp;
        if (tap > 0) { s += r.s() * 0.25 * V.amp * (tap / 90); tap--; }
        env *= dec; t++;
        const g = G[i] * Kd;
        oL[i] += s * V.pl * g; oR[i] += s * V.pr * g;
        sL[i] += s * V.pl * g * 0.55; sR[i] += s * V.pr * g * 0.55;
      }
      V.st = 0; V.env = env; V.ph = ph; V.t = t; V.tap = tap;
      if (env < 1e-4) this.dv.splice(v, 1);
    }
  }
}

// ---- box fan: five blades at ~14 turns a second.
//  air:   turbulent rush (lowpassed noise with a bump where the housing rings),
//         chopped by each blade passing the struts (amplitude modulation at the
//         71 Hz blade-pass rate), plus a faint once-a-turn imbalance.
//  tones: the blade-pass note and its harmonics (the 2nd to 4th are what a
//         phone speaker can actually play), a faint 120 Hz motor hum.
//  wobble: the speed wanders by a fraction of a percent over seconds.
class Fan {
  constructor(E) {
    const sr = E.sr; this.sr = sr; this.r = new Rng(E.rng.u32());
    this.lpL = new SVF(); this.lpR = new SVF(); this.bpL = new SVF(); this.bpR = new SVF(); this.hsL = new SVF(); this.hsR = new SVF();
    this.lpL.set(1050, 0.6, sr); this.lpR.set(1050, 0.6, sr); this.bpL.set(330, 1.3, sr); this.bpR.set(330, 1.3, sr);
    this.hsL.set(2600, 0.7, sr); this.hsR.set(2600, 0.7, sr);
    this.hpa = onePole(70, sr); this.hl = 0; this.hr = 0;
    this.wob = new Drift(this.r, 0.12, sr / BLK); this.rot = 14.2; this.ph = 0; this.mph = 0; this.ht = 0;
    this.K = 0.434;
  }
  render(n, G, oL, oR, sL, sR) {
    const r = this.r, sr = this.sr, K = this.K;
    this.ht += n / sr;
    this.rot = 14.2 * (1 + 0.0045 * this.wob.next() + 0.0012 * Math.sin(TAU * 0.11 * this.ht));
    const dph = this.rot / sr;                            // one turn per cycle
    const humAmp = 0.05 * (1 + 0.25 * Math.sin(TAU * 0.07 * this.ht));
    let ph = this.ph, mph = this.mph, hl = this.hl, hr = this.hr;
    const ha = this.hpa;
    for (let i = 0; i < n; i++) {
      ph += dph; if (ph >= 1) ph -= 1;
      mph += 120 / sr; if (mph >= 1) mph -= 1;
      const bp = ph * 5 - Math.floor(ph * 5);               // blade-pass phase
      const chop = 1 + 0.17 * sinc(bp) + 0.06 * sinc((bp * 2) % 1) + 0.05 * sinc(ph);
      const c = r.s();
      const wl = 0.85 * c + 0.53 * r.s(), wr = 0.85 * c + 0.53 * r.s();
      hl += ha * (wl - hl); hr += ha * (wr - hr);
      const xl = wl - hl, xr = wr - hr;
      const airL = (this.lpL.lp(xl) + 0.55 * this.bpL.bp(xl) + 0.07 * this.hsL.hp(xl)) * chop;
      const airR = (this.lpR.lp(xr) + 0.55 * this.bpR.bp(xr) + 0.07 * this.hsR.hp(xr)) * chop;
      const tone = 0.05 * sinc(bp) + 0.04 * sinc((bp * 2) % 1) + 0.028 * sinc((bp * 3) % 1) + 0.016 * sinc((bp * 4) % 1)
        + humAmp * sinc(mph) + humAmp * 0.4 * sinc((mph * 2) % 1);
      const g = G[i] * K;
      const L = airL + tone * 0.8, R = airR + tone * 1.0;     // the fan sits a little right
      oL[i] += L * g; oR[i] += R * g;
      sL[i] += L * g * 0.05; sR[i] += R * g * 0.05;
    }
    this.ph = ph; this.mph = mph; this.hl = hl; this.hr = hr;
  }
}

// ---- ocean waves, heard from a house above the beach.
//  roar:  the distant constant surf, low and wide.
//  waves: irregular swells, 6.5 to 12 s apart with a set of bigger ones every
//         few minutes. Each one builds dark as it rises (a lowpass opening), breaks
//         (brightest, loudest), then washes back for 5 to 9 s while a fizzing
//         foam layer (bubbles popping) lingers. A break sweeps a little across
//         the stereo field, the way a wave breaks along the shore.
class Waves {
  constructor(E) {
    const sr = E.sr; this.sr = sr; this.E = E; this.r = new Rng(E.rng.u32());
    this.ra = onePole(110, sr); this.rl = 0; this.rr = 0;
    this.v = [];
    this.next = sr * 1.2; this.toSet = 4 + (this.r.f() * 5 | 0); this.inSet = 0;
    this.K = 0.68; this.swell = 0;
  }
  spawn(at) {
    const r = this.r, sr = this.sr;
    let size;
    if (this.inSet > 0) { size = r.range(0.85, 1.15); this.inSet--; }
    else { size = r.range(0.42, 0.82); if (--this.toSet <= 0) { this.inSet = 3; this.toSet = 5 + (r.f() * 5 | 0); } }
    const A = r.range(2.2, 3.6), D = r.range(4.5, 8) * (0.75 + 0.4 * size);
    const p0 = r.range(-0.6, 0.6);
    const w = {
      t: 0, st: at, A: A * sr, D: D * sr, size: size, p0: p0, p1: clamp(p0 + r.range(-0.55, 0.55), -0.85, 0.85),
      fl: new SVF(), fr: new SVF(), zl: new SVF(), zr: new SVF(), bub: 0, bubA: onePole(36, sr), env: 0, fz: 0
    };
    w.zl.set(2600, 0.7, sr); w.zr.set(2600, 0.7, sr);
    this.v.push(w);
    this.next += (this.inSet > 0 ? r.range(5, 8) : r.range(6.5, 12)) * sr;
  }
  render(n, G, oL, oR, sL, sR) {
    const r = this.r, sr = this.sr, K = this.K;
    while (this.next < n) this.spawn(Math.max(0, this.next | 0));
    this.next -= n;
    let sw = 0;
    for (let k = 0; k < this.v.length; k++) sw += this.v[k].env;
    this.swell = sw;
    const roarAmp = 0.5 * (0.8 + 0.35 * Math.min(1, sw));
    let rl = this.rl, rr = this.rr; const ra = this.ra;
    for (let i = 0; i < n; i++) {
      rl += ra * (r.s() - rl); rr += ra * (r.s() - rr);
      const g = G[i] * K;
      oL[i] += rl * roarAmp * g * 4; oR[i] += rr * roarAmp * g * 4;
    }
    this.rl = rl; this.rr = rr;
    for (let k = this.v.length - 1; k >= 0; k--) {
      const w = this.v[k];
      let t = w.t;
      const A = w.A, D = w.D, crash = 0.28 * sr, sz = w.size;
      for (let i0 = w.st; i0 < n; i0 += 32) {
        // control rate: envelope, filter cutoff, pan
        let env, fc, fz;
        if (t < A) { const u = t / A; env = sz * 0.32 * u * u; fc = 180 + 900 * u * u; fz = 0; }
        else if (t < A + crash) { const u = (t - A) / crash; env = sz * (0.32 + 0.68 * u); fc = 1080 + (1600 + 2600 * sz) * u; fz = 0; }
        else {
          const u = t - A - crash;
          env = sz * Math.exp(-u / (D / 3)); fc = 520 + (1600 + 2600 * sz) * Math.exp(-u / (D / 4.5));
          fz = sz * 0.55 * (1 - Math.exp(-u / (0.45 * sr))) * Math.exp(-u / (D / 2.1));
        }
        w.fl.set(fc, 0.65, sr); w.fr.set(fc, 0.65, sr);
        const pu = clamp((t - A * 0.7) / (D * 0.6), 0, 1), pan = w.p0 + (w.p1 - w.p0) * pu * pu * (3 - 2 * pu);
        const gl = panL(pan) * 1.25, gr = panR(pan) * 1.25;
        const e0 = w.env, f0 = w.fz, m = Math.min(32, n - i0);
        for (let j = 0; j < m; j++) {
          const i = i0 + j, q = j / m;
          const e = e0 + (env - e0) * q, f = f0 + (fz - f0) * q;
          const nl = r.s(), nr = r.s();
          w.bub += w.bubA * (Math.abs(r.s()) - w.bub);        // bubble graininess
          const foam = (0.35 + 2.4 * w.bub);
          const L = w.fl.lp(nl) * e + w.zl.hp(nr * 0.6 + nl * 0.4) * f * foam * 0.5;
          const R = w.fr.lp(nr) * e + w.zr.hp(nl * 0.6 + nr * 0.4) * f * foam * 0.5;
          const g = G[i] * K;
          oL[i] += L * gl * g; oR[i] += R * gr * g;
          sL[i] += L * gl * g * 0.14; sR[i] += R * gr * g * 0.14;
        }
        w.env = env; w.fz = fz; t += m;
      }
      w.st = 0; w.t = t;
      if (t > A + crash + D * 2.2) this.v.splice(k, 1);
    }
  }
  // for the window: [phase 0..1 approach, 1..2 break and wash, size, pan]
  state() {
    const out = [];
    for (let k = 0; k < this.v.length; k++) {
      const w = this.v[k], c = 0.28 * this.sr;
      const ph = w.t < w.A ? w.t / w.A : 1 + Math.min(1, (w.t - w.A) / (c + w.D * 1.4));
      out.push([+ph.toFixed(3), +w.size.toFixed(2), +w.p0.toFixed(2)]);
    }
    return out;
  }
}

// ---- crackling fire in a fireplace.
//  roar:     the flames' low breath, lowpassed noise that swells and sinks.
//  hiss:     sap and steam, faint high noise that seethes.
//  crackles: a self-exciting process (each crackle makes more likely for a
//            moment), so they come in little bursts the way wood really splits:
//            mostly tiny ticks, some woody cracks with a hollow pock, and rarely
//            a resin pop with a soft thump and a spit of steam. Pops are kept
//            gentle on purpose: this is for sleeping.
//  flares:   every 8 to 25 s a log shifts and the fire flares for a few seconds.
class Fire {
  constructor(E) {
    const sr = E.sr; this.sr = sr; this.r = new Rng(E.rng.u32());
    this.pl = new Float64Array(7); this.pr = new Float64Array(7);
    this.lL = new SVF(); this.lR = new SVF(); this.hL = new SVF(); this.hR = new SVF();
    this.hL.set(3600, 0.7, sr); this.hR.set(3600, 0.7, sr);
    this.hpa = onePole(55, sr); this.hl = 0; this.hr = 0;
    this.sz = 0; this.sza = onePole(30, sr);
    this.breath = new Drift(this.r, 0.5, sr / BLK);
    this.pool = new ResPool(48, this.r);
    this.cl = 0; this.cr = 0; this.ca = onePole(6500, sr);
    this.exc = 0; this.flare = 0; this.flareT = -1; this.flareSize = 0; this.nextFlare = sr * 6;
    this.glow = 0; this.flash = 0; this.coef = -1;
    this.K = 1.0; this.Kc = 0.8;
  }
  render(n, G, oL, oR, sL, sR) {
    const r = this.r, sr = this.sr;
    // flares
    this.nextFlare -= n;
    if (this.nextFlare <= 0) { this.flareT = 0; this.flareSize = r.range(0.3, 1); this.nextFlare = r.range(8, 25) * sr; }
    if (this.flareT >= 0) {
      const u = this.flareT / sr;
      this.flare = this.flareSize * (u < 0.8 ? u / 0.8 : Math.exp(-(u - 0.8) / 1.6));
      this.flareT += n; if (u > 9) this.flareT = -1;
    } else this.flare = 0;
    const b = this.breath.next();
    const breath = 0.78 + 0.22 * b;
    const key = Math.round(this.flare * 40);
    if (key !== this.coef) { this.coef = key; const fc = 340 * (1 + 0.7 * this.flare); this.lL.set(fc, 0.55, sr); this.lR.set(fc, 0.55, sr); }
    // crackles: self-exciting arrivals, decided per sample
    const base = 2.2 + 1.8 * this.flare, decay = Math.exp(-1 / (0.13 * sr)), jump = 4.6;
    let exc = this.exc;
    for (let i = 0; i < n; i++) {
      exc *= decay;
      if (r.f() < (base + exc) / sr) {
        exc += jump;
        const k = r.f(), big = clamp(Math.exp(0.5 * r.gauss()), 0.25, 3), pan = -0.3 + 0.32 * r.gauss();
        if (k < 0.6) this.pool.spawn(r.logr(2400, 7000), r.range(0.00025, 0.0008), 0.12 * big, pan, 0.1 * big, 6 + (r.f() * 10 | 0), i, sr);
        else if (k < 0.95) {
          this.pool.spawn(r.logr(320, 950), r.range(0.006, 0.016), 0.22 * big, pan, 0.3 * big, 20 + (r.f() * 40 | 0), i, sr);
          this.flash = Math.min(1, this.flash + 0.25 * big);
        } else {
          const a = Math.min(0.5, 0.34 * big);
          this.pool.spawn(r.logr(110, 220), r.range(0.025, 0.045), a, pan, a * 0.9, 90 + (r.f() * 50 | 0), i, sr);
          this.pool.spawn(r.logr(2600, 5200), r.range(0.02, 0.05), a * 0.12, pan + 0.1, 0, 0, Math.min(n - 1, i + 40), sr);
          this.flash = 1;
        }
      }
    }
    this.exc = exc;
    this.pool.render(n);
    const PL = this.pool.L, PR = this.pool.R;
    const roarAmp = 0.9 * breath * (1 + 0.6 * this.flare), hissAmp = 0.05 * (0.7 + 0.5 * this.flare);
    let hl = this.hl, hr = this.hr, sz = this.sz, cl = this.cl, cr = this.cr;
    const ha = this.hpa, sza = this.sza, ca = this.ca, K = this.K, Kc = this.Kc;
    for (let i = 0; i < n; i++) {
      const c = r.s();
      const pL = Pink.step(this.pl, 0.8 * c + 0.6 * r.s()), pR = Pink.step(this.pr, 0.8 * c + 0.6 * r.s());
      hl += ha * (pL - hl); hr += ha * (pR - hr);
      const roL = this.lL.lp(pL - hl) * roarAmp, roR = this.lR.lp(pR - hr) * roarAmp;
      sz += sza * (Math.abs(r.s()) - sz);                    // seething
      const hs = (0.3 + 2.2 * sz) * hissAmp;
      const hiL = this.hL.hp(r.s()) * hs, hiR = this.hR.hp(r.s()) * hs;
      cl += ca * (PL[i] - cl); cr += ca * (PR[i] - cr);
      const g = G[i];
      const L = (roL + hiL) * K + cl * Kc, R = (roR + hiR) * K + cr * Kc;
      oL[i] += L * g; oR[i] += R * g;
      sL[i] += L * g * 0.1; sR[i] += R * g * 0.1;
    }
    this.hl = hl; this.hr = hr; this.sz = sz; this.cl = cl; this.cr = cr;
    this.glow = breath * (1 + 0.6 * this.flare);
    this.flash *= Math.exp(-n / (0.12 * sr));
  }
}

// ---- distant thunderstorm.
// A strike is a flash now and a roll a beat later (light outruns sound, about
// 3 s per km). Each roll is a cluster of rumbles arriving from different parts
// of a long lightning channel: brown-ish noise, lowpassed lower the farther the
// strike (the air eats the highs over distance), a little mid rattle when
// nearer, soft-clipped so its harmonics reach a phone speaker, and sent hard
// into the convolver so it rolls on into the night. Strikes come at random,
// 20 s to a few minutes apart. Turn the layer up from nothing and the first
// one comes within seconds, so you hear what it does.
class Thunder {
  constructor(E) {
    const sr = E.sr; this.sr = sr; this.E = E; this.r = new Rng(E.rng.u32());
    this.next = this.r.range(9, 16) * sr; this.roll = null; this.pending = null;
    this.K = 0.5; this.on = false;
  }
  wake() { const s = this.r.range(2.5, 5) * this.sr; if (this.next > s) this.next = s; }
  render(n, G, oL, oR, sL, sR) {
    const r = this.r, sr = this.sr;
    this.next -= n;
    if (this.next <= 0 && !this.pending && !this.roll) {
      const d = r.f(), delay = 1.0 + 2.6 * d + r.range(0, 0.6);
      this.pending = { d: d, at: delay * sr, size: r.range(0.55, 1) * (1 - 0.4 * d) };
      this.E.post({ t: "flash", d: +d.toFixed(2), size: +this.pending.size.toFixed(2), delay: +delay.toFixed(2) });
      this.next = clamp(20 + r.expo(55), 20, 210) * sr;
    }
    if (this.pending) {
      this.pending.at -= n;
      if (this.pending.at <= 0) { this.roll = this.makeRoll(this.pending); this.pending = null; }
    }
    if (!this.roll) return;
    const R = this.roll;
    for (let i0 = 0; i0 < n; i0 += 32) {
      const m = Math.min(32, n - i0);
      // control rate: sum of rumble bumps, weighted pan, brightness
      const ts = R.t / sr;
      let env = 0, pw = 0;
      for (let k = 0; k < R.b.length; k++) {
        const B = R.b[k], u = ts - B.t;
        if (u <= 0) continue;
        const e = B.a * (u < B.att ? u / B.att : Math.exp(-(u - B.att) / B.dec));
        env += e; pw += e * B.pan;
      }
      const pan = env > 1e-6 ? pw / env : R.theta;
      const bright = 1 + R.near * 1.4 * Math.exp(-ts / 0.7);
      const fc = R.fc * bright;
      R.l1.set(fc, 0.6, sr); R.l2.set(fc, 0.6, sr);
      const gl = panL(pan), gr = panR(pan);
      const e0 = R.env;
      for (let j = 0; j < m; j++) {
        const i = i0 + j, e = e0 + (env - e0) * (j / m);
        const a = R.l1.lp(r.s()) , b = R.l2.lp(r.s());
        const rat = R.bp.bp(r.s()) * R.near * 0.35 * e * e;
        let mid = Math.tanh((a * 2.4 + rat) * e * 1.6) / 1.6;
        let side = b * e * 0.9;
        const g = G[i] * this.K * R.size;
        const L = (mid * gl * 1.3 + side * 0.5) * g, Rr = (mid * gr * 1.3 - side * 0.5) * g;
        oL[i] += L; oR[i] += Rr;
        sL[i] += L * 0.85; sR[i] += Rr * 0.85;
      }
      R.env = env; R.t += m;
    }
    if (R.t > R.len) this.roll = null;
  }
  makeRoll(p) {
    const r = this.r, sr = this.sr, d = p.d;
    const L = 5 + 9 * d + r.range(0, 4), k = 5 + (r.f() * 8 | 0), theta = r.range(-0.7, 0.7);
    const b = [];
    for (let i = 0; i < k; i++) {
      const t = i === 0 ? r.range(0, 0.15) : L * Math.pow(r.f(), 1.6) * 0.8;
      b.push({ t: t, a: (i === 0 ? 1 : r.range(0.3, 1)) * (1 - 0.55 * t / L), att: r.range(0.06, 0.35) + 0.25 * d, dec: r.range(0.5, 2.2), pan: clamp(theta + r.range(-0.35, 0.35), -0.9, 0.9) });
    }
    const R = { t: 0, len: (L + 8) * sr, b: b, theta: theta, size: p.size, near: Math.max(0, 1 - d * 1.6), fc: 330 - 200 * d, env: 0,
      l1: new SVF(), l2: new SVF(), bp: new SVF() };
    R.bp.set(r.range(380, 620), 0.8, sr);
    return R;
  }
}

// ======================= the engine =======================
const NL = 8;  // brown, pink, white, rain, fan, waves, fire, thunder
class Engine {
  constructor(sr, seed) {
    this.sr = sr; this.rng = new Rng(seed || 0x2545f491);
    this.target = new Float32Array(NL); this.s = new Float32Array(NL); this.g = new Float32Array(NL);
    this.G = new Float32Array(BLK);
    this.msgs = []; this.vis = true; this.postEvery = Math.round(sr / 15 / BLK); this.blk = 0;
    this.layers = [new Brown(this), new Pink(this), new White(this), new Rain(this), new Fan(this), new Waves(this), new Fire(this), new Thunder(this)];
    this.sm = 1 - Math.exp(-BLK / (0.3 * sr));
    this.stopAt = Infinity; this.frame = 0; this.idle = true;
  }
  post(m) { this.msgs.push(m); }
  setLevels(arr) {
    for (let k = 0; k < NL; k++) {
      const v = clamp(+arr[k] || 0, 0, 1);
      if (k === 7 && v > 0.005 && this.target[7] <= 0.005) this.layers[7].wake();
      this.target[k] = v;
    }
  }
  // start-up levels: no wake-up strike (the first one comes 9 to 16 s in)
  setNow(arr) { for (let k = 0; k < NL; k++) this.s[k] = this.target[k] = clamp(+arr[k] || 0, 0, 1); }
  // Rain's slider is intensity, and intensity already makes it louder (more
  // drops, a fuller bed), so its gain leans the other way: measured, this keeps
  // light rain audible and a downpour from towering over the other layers.
  gainOf(k, s) { return k === 3 ? Math.pow(10, (5.5 - 9.6 * s) / 20) * Math.min(1, s / 0.03) : k === 7 ? Math.pow(s, 1.6) : s * s; }
  process(oL, oR, sL, sR, frame) {
    const n = oL.length, G = this.G;
    if (frame !== undefined) this.frame = frame;
    if (this.frame >= this.stopAt) { this.frame += n; return false; }
    let any = false;
    for (let k = 0; k < NL; k++) {
      const s0 = this.s[k];
      let s1 = s0 + (this.target[k] - s0) * this.sm;
      if (Math.abs(s1 - this.target[k]) < 1e-4) s1 = this.target[k];
      this.s[k] = s1;
      const g0 = this.g[k], g1 = this.gainOf(k, s1);
      this.g[k] = g1;
      if (g0 < 1e-6 && g1 < 1e-6) continue;
      any = true;
      if (k === 3) this.layers[3].setIntensity(s1);
      const dg = (g1 - g0) / n;
      for (let i = 0; i < n; i++) G[i] = g0 + dg * i;
      this.layers[k].render(n, G, oL, oR, sL, sR);
    }
    this.idle = !any;
    // one NaN reaching the convolver or the compressors would silence the page
    // until a reload, so check every block and start over if anything broke
    let sum = 0;
    for (let i = 0; i < n; i += 16) sum += oL[i] + oR[i] + sL[i] + sR[i];
    if (!isFinite(sum)) {
      oL.fill(0); oR.fill(0); sL.fill(0); sR.fill(0);
      this.layers = [new Brown(this), new Pink(this), new White(this), new Rain(this), new Fan(this), new Waves(this), new Fire(this), new Thunder(this)];
      this.post({ t: "reset" });
    }
    this.frame += n;
    if (this.vis && ++this.blk >= this.postEvery) {
      this.blk = 0;
      const W = this.layers[5], F = this.layers[6], Ra = this.layers[3];
      this.post({ t: "s", w: this.g[5] > 1e-6 ? W.state() : [], f: +(F.glow * Math.min(1, this.s[6] * 1.4)).toFixed(3), fl: +F.flash.toFixed(3), gu: +Ra.g.toFixed(3) });
    }
    return any;
  }
}

// ---- AudioWorklet glue ----
if (typeof registerProcessor === "function") {
  class SleepProcessor extends AudioWorkletProcessor {
    constructor(opts) {
      super();
      const o = (opts && opts.processorOptions) || {};
      this.e = new Engine(sampleRate, o.seed >>> 0);
      if (o.levels) this.e.setNow(o.levels);
      this.port.onmessage = (ev) => {
        const m = ev.data || {};
        if (m.levels) this.e.setLevels(m.levels);
        if (m.vis !== undefined) this.e.vis = !!m.vis;
        if (m.stopAt !== undefined) this.e.stopAt = m.stopAt === null ? Infinity : m.stopAt * sampleRate;
      };
    }
    process(inputs, outputs) {
      const a = outputs[0], b = outputs[1];
      if (!a || !a[0]) return true;
      const L = a[0], R = a[1] || a[0];
      const SL = b && b[0] ? b[0] : new Float32Array(L.length), SR = b && b[1] ? b[1] : SL;
      this.e.process(L, R, SL, SR, currentFrame);
      const ms = this.e.msgs;
      if (ms.length) { for (let i = 0; i < ms.length; i++) this.port.postMessage(ms[i]); ms.length = 0; }
      return true;
    }
  }
  registerProcessor("sleep-sounds", SleepProcessor);
}
if (typeof module !== "undefined" && module.exports) module.exports = { Engine, Rng, NL, BLK };
else if (typeof registerProcessor !== "function" && typeof globalThis !== "undefined") globalThis.SleepEngine = Engine;

}
