/* engine.js — the regulars, in a Worker so a thinking opponent never costs the
   board a frame.

   The evaluation is hand-tuned, not trained. It reads a position the way a strong
   club player talks about one: the race (pips), blots and how many of the 36 rolls
   hit them, made points and where they are, primes, anchors, the bar against a
   closed board, and the gammon chances. In a pure race it switches to a race
   formula (rolls to finish, with the classic adjustments for stacked and gapped
   home boards). Every number is from the side that just moved, with the other
   side to roll.

   Search: 1-ply = pick the play with the best evaluation. 2-ply = for the best few
   candidates, average over all 21 replies of the other side's best answer.

   Lessons carried over from Chess and Checkers:
   - Every candidate gets a TRUE score. The personalities read scores as equity, so
     no candidate may come back as a bound.
   - Weakness is a noisy preference (jitter the scores, take the max) plus a crude
     evaluation, not a broken search, so a weak player's plays still look like plays.
   - The cube uses the same evaluation, one roll deep, and a small match equity
     table, so a double means "I am clearly ahead here", not a dice-luck reflex. */
(function (root) {
  "use strict";
  if (!root.BackgammonCore && typeof importScripts === "function") importScripts("core.js");
  var K = root.BackgammonCore;

  var ROLLS = [];
  for (var a = 1; a <= 6; a++) for (var b = a; b <= 6; b++) ROLLS.push([a, b, a === b ? 1 : 2]);

  /* ---------- the regulars ----------
     T is the logistic scale (pip-equivalents per logit). Weights are symmetric:
     whatever a regular values in their own position they also fear in yours. */
  /* Tuned by duplicate self-play (thousands of games per change, same dice in each
     seat with the players swapped): each value is where moving it either way stopped
     winning points. */
  var BASE = { T: 22, pip: 0.5, onRoll: 4, blot: 1, hitPip: 0.65, hitBase: 5, hitBoard: 1.2, closeout: 8,
    bar: 2.5, barBoard: 12, build: 0, home: 1.3, outer: 1, anchor: 0.35, prime: 1, stack: 0.8, dead: 1.4, back: 0, hitLove: 0,
    gammons: true };
  function mk(over) { var w = {}, k; for (k in BASE) w[k] = BASE[k]; for (k in over) w[k] = over[k]; return w; }

  var P = {
    /* plays the first sensible thing she sees; barely notices blots; takes every double */
    mina:   { plies: 1, temp: 0.16, blunder: 0.05, w: mk({ blot: 0.5, home: 0.8, outer: 0.7, prime: 0.5, anchor: 0.2, stack: 0.3, dead: 0.4 }),
              dbl: 0.78, takeBias: 0.18 },
    /* runs his back checkers home, leaves shots behind him */
    teo:    { plies: 1, temp: 0.13, blunder: 0.02, w: mk({ blot: 0.7, back: 2.6, anchor: 0.2, prime: 0.7 }),
              dbl: 0.72, takeBias: 0.08 },
    /* builds her board like a sea wall */
    despina:{ plies: 1, temp: 0.07, blunder: 0, w: mk({ home: 1.8, prime: 1.5, blot: 0.85 }),
              dbl: 0.7, takeBias: 0.03 },
    /* hits anything that moves */
    marek:  { plies: 1, temp: 0.05, blunder: 0, w: mk({ hitLove: 1.8 }),
              dbl: 0.66, takeBias: 0.05 },
    /* counts every pip, plays the percentages */
    aris:   { plies: 1, temp: 0, blunder: 0, w: mk({}), dbl: 0.68, takeBias: 0 },
    /* has never lost at her own table: looks one full roll ahead */
    noor:   { plies: 2, top: 14, cut: 0.6, temp: 0, blunder: 0, w: mk({}), dbl: 0.68, takeBias: 0 }
  };

  /* ---------- small helpers ---------- */
  function closed(a) { var c = 0; for (var i = 1; i <= 6; i++) if (a[i] >= 2) c++; return c; }
  function pips(a) { var s = 0; for (var i = 1; i <= 25; i++) s += a[i] * i; return s; }
  function Phi(x) {                                   /* standard normal CDF */
    var t = 1 / (1 + 0.2316419 * Math.abs(x));
    var d = 0.3989423 * Math.exp(-x * x / 2);
    var q = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
    return x > 0 ? 1 - q : q;
  }

  /* ---------- the race ----------
     Rolls to finish: pips plus the classic wastage for a stacked or gapped home
     board, and never fewer rolls than the checkers need (about 2.3 per roll). */
  function wastePips(a) {
    var e = 0, home = true;
    for (var i = 7; i <= 25; i++) if (a[i]) { home = false; break; }
    e += 2 * Math.max(0, a[1] - 1) + Math.max(0, a[2] - 1) + Math.max(0, a[3] - 3);
    if (home) for (var g = 4; g <= 6; g++) if (!a[g]) e += 1;
    return e;
  }
  function rollsLeft(a) {
    var n = 0; for (var i = 1; i <= 25; i++) n += a[i];
    if (!n) return 0;
    return Math.max((pips(a) + wastePips(a)) / 8.17, n * 0.43, 1);
  }
  /* Rolls before the side can bear its first checker off (to save the gammon). */
  function rollsToSave(a) {
    if (a[0] > 0) return 0;
    var need = 0, out = 0;
    for (var i = 7; i <= 25; i++) if (a[i]) { need += (i - 6) * a[i]; out += a[i]; }
    var low = 6; for (var j = 1; j <= 6; j++) if (a[j]) { low = j; break; }
    need += out ? 3 : low;
    return Math.max(need / 8.17, out / 2.4, 0.6);
  }

  /* ---------- shots ----------
     How badly the side to roll (them) can hurt my blots, averaged over all 36
     rolls. Each roll counts its worst hit, with the real paths: a combination
     needs an open point to touch down on, doubles step four times, and a checker
     on the bar must come in first. */
  var costAt = new Float64Array(26), stk = new Int32Array(32);
  function shotCost(me, them, W, tClosed) {
    var any = false, i;
    for (i = 0; i < 26; i++) costAt[i] = 0;
    for (i = 1; i <= 24; i++) {
      if (me[i] !== 1) continue;
      any = true;
      var c = W.hitPip * (25 - i) + W.hitBase * (i <= 18 ? 1 : 0.35) + W.hitBoard * tClosed + (tClosed >= 5 ? W.closeout : 0);
      costAt[25 - i] = c;                               /* their point number */
    }
    if (!any) return 0;
    var n = 0, bar = them[25];
    for (var j = 1; j <= 24; j++) if (them[j]) stk[n++] = j;
    function open(x) { return x >= 1 && me[25 - x] < 2; }
    var total = 0;
    for (var r = 0; r < 21; r++) {
      var d1 = ROLLS[r][0], d2 = ROLLS[r][1], best = 0, k, x, q;
      if (d1 !== d2) {
        if (bar >= 2) {
          best = Math.max(costAt[25 - d1], costAt[25 - d2]);
        } else if (bar === 1) {
          for (var o = 0; o < 2; o++) {
            var ea = o ? d2 : d1, eb = o ? d1 : d2, ep = 25 - ea;
            if (!open(ep)) continue;
            if (costAt[ep] > best) best = costAt[ep];
            x = ep - eb; if (x >= 1 && costAt[x] > best) best = costAt[x];
            for (k = 0; k < n; k++) { x = stk[k] - eb; if (x >= 1 && costAt[x] > best) best = costAt[x]; }
          }
        } else {
          for (k = 0; k < n; k++) {
            var f = stk[k];
            x = f - d1; if (x >= 1 && costAt[x] > best) best = costAt[x];
            x = f - d2; if (x >= 1 && costAt[x] > best) best = costAt[x];
            x = f - d1 - d2;
            if (x >= 1 && costAt[x] > best && (open(f - d1) || open(f - d2))) best = costAt[x];
          }
        }
      } else {
        var d = d1, left = 4;
        if (bar) {
          if (!open(25 - d)) { continue; }
          best = costAt[25 - d];
          left = Math.max(0, 4 - bar);
          if (left) {
            for (q = 1; q <= left; q++) { x = 25 - d - q * d; if (!open(x)) break; if (costAt[x] > best) best = costAt[x]; }
          }
        }
        if (left) {
          for (k = 0; k < n; k++) {
            for (q = 1; q <= left; q++) {
              x = stk[k] - q * d;
              if (!open(x)) break;
              if (costAt[x] > best) best = costAt[x];
            }
          }
        }
      }
      total += best * ROLLS[r][2];
    }
    return total / 36;
  }

  /* ---------- structure: what one side has built against the other ---------- */
  var PT = [0, 2, 3, 4, 6.5, 8.5, 7.5, 6, 4, 3, 2.5, 2, 1.5, 1, 1, 1, 1, 1, 1];
  var ANCH = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 7, 6, 4, 3, 2.5];
  var PRIME = [0, 0, 0, 3, 7, 13, 22];
  var cum = new Int32Array(27);
  function structure(a, b, W) {
    /* cum[k] = b's checkers on b-points k..25 (25 = the bar) */
    cum[26] = 0;
    for (var k = 25; k >= 1; k--) cum[k] = cum[k + 1] + b[k];
    var v = 0, run = 0, lo = 0, bestPrime = 0;
    for (var i = 1; i <= 24; i++) {
      var n = a[i], behind = cum[26 - i];               /* b's checkers still to pass a's point i */
      /* builders: checkers bearing on the points still worth making */
      if (W.build && n && i >= 4 && i <= 11) v += W.build * Math.min(n, 2) * (0.3 + 0.7 * Math.min(1, behind / 2));
      if (n >= 2) {
        if (i <= 18) v += PT[i] * (i <= 6 ? W.home : W.outer) * (0.25 + 0.75 * Math.min(1, behind / 2));
        else v += ANCH[i] * W.anchor;
        if (n >= 4) v -= W.stack * (n - 3);
        if (i <= 2 && n >= 3) v -= W.dead * (n - 2);
        if (!run) lo = i;
        run++;
        if (run >= 3) {
          var trapped = cum[26 - lo];
          if (trapped) {
            var pv = PRIME[Math.min(6, run)] * Math.min(1, trapped / 2);
            if (pv > bestPrime) bestPrime = pv;
          }
        }
      } else run = 0;
    }
    return v + bestPrime * W.prime;
  }

  /* ---------- the evaluation ----------
     Returns equity for `me` (just moved; `them` to roll), cubeless, with gammons
     valued by gvMe / gvThem (0 when that gammon cannot matter at this score).
     Also leaves the win and gammon chances in OUT for the cube. */
  var OUT = { p: 0.5, gw: 0, gl: 0 };
  function evaluate(me, them, W, gvMe, gvThem) {
    if (me[0] === 15) { OUT.p = 1; OUT.gw = them[0] ? 0 : 1; OUT.gl = 0; return 1 + (them[0] ? 0 : gvMe); }
    var p, gw = 0, gl = 0;
    if (!K.contact(me, them)) {
      var rm = rollsLeft(me), rt = rollsLeft(them);
      var sd = 0.5 * Math.sqrt(rm + rt) + 0.25;
      p = Phi((rt - 0.5 - rm) / sd);
      if (!them[0]) gw = Phi((rollsToSave(them) - 0.5 - rm) / (0.45 + 0.2 * Math.sqrt(rm)));
      if (!me[0]) gl = Phi((rollsToSave(me) + 0.5 - rt) / (0.45 + 0.2 * Math.sqrt(rt)));
      gw = Math.min(gw, p); gl = Math.min(gl, 1 - p);
    } else {
      var mc = closed(me), tc = closed(them);
      var S = W.pip * (pips(them) - pips(me)) - W.onRoll;
      S += structure(me, them, W) - structure(them, me, W);
      if (them[25]) S += them[25] * (W.bar + W.barBoard * mc * mc / 36) + (mc === 6 ? 14 * them[25] : 0);
      if (me[25]) S -= me[25] * (W.bar + W.barBoard * tc * tc / 36) + (tc === 6 ? 14 * me[25] : 0);
      S -= W.blot * shotCost(me, them, W, tc);
      if (W.back) {
        var mb = me[25], tb = them[25];
        for (var i = 19; i <= 24; i++) { mb += me[i]; tb += them[i]; }
        S -= W.back * (mb - tb);
      }
      if (W.hitLove) S += W.hitLove * (them[25] - me[25]);
      p = 1 / (1 + Math.exp(-S / W.T));
      if (W.gammons) {
        var tBack = them[25] * 2, mBack = me[25] * 2;
        for (var j = 19; j <= 24; j++) { tBack += them[j]; mBack += me[j]; }
        if (!them[0]) gw = p * Math.min(0.7, 0.1 + 0.06 * tBack + 0.025 * mc) * (0.4 + 1.2 * p);
        if (!me[0]) gl = (1 - p) * Math.min(0.7, 0.1 + 0.06 * mBack + 0.025 * tc) * (0.4 + 1.2 * (1 - p));
        gw = Math.min(gw, p * 0.9); gl = Math.min(gl, (1 - p) * 0.9);
      }
    }
    OUT.p = p; OUT.gw = gw; OUT.gl = gl;
    return 2 * p - 1 + gvMe * gw - gvThem * gl;
  }

  /* ---------- choosing a play ---------- */
  function applied(me, them, play) {
    var a = Int8Array.from(me), b = Int8Array.from(them);
    for (var i = 0; i < play.steps.length; i++) K.apply(a, b, play.steps[i]);
    return [a, b];
  }

  /* The side to roll's best reply value, from MY side (so negated), for 2-ply. */
  function replyValue(me, them, W, gvMe, gvThem) {
    var tot = 0;
    for (var r = 0; r < 21; r++) {
      var ps = K.plays(them, me, ROLLS[r][0], ROLLS[r][1]), best = -1e9;
      for (var i = 0; i < ps.length; i++) {
        var a = Int8Array.from(them), b = Int8Array.from(me);
        for (var s = 0; s < ps[i].steps.length; s++) K.apply(a, b, ps[i].steps[s]);
        var e = evaluate(a, b, W, gvThem, gvMe);
        if (e > best) best = e;
      }
      tot -= best * ROLLS[r][2];
    }
    return tot / 36;
  }

  function rand() { return Math.random(); }

  /* gv: how much a gammon is worth to each side at this score and cube. */
  function gammonValues(match) {
    if (!match) return [1, 1];
    var v = match.cube || 1;
    /* a single win already takes the match, so a gammon adds nothing */
    return [match.myAway <= v ? 0 : 1, match.theirAway <= v ? 0 : 1];
  }

  function choose(who, me, them, d1, d2, match, rng, rest) {
    var cfg = P[who] || P.noor, W = cfg.w;
    rng = rng || rand;
    var gv = gammonValues(match);
    if (!W.gammons) gv = [0, 0];
    var ps = K.plays(me, them, d1, d2, rest);
    if (ps.length === 1) return { play: ps[0], score: 0, list: [] };
    var sc = [];
    for (var i = 0; i < ps.length; i++) {
      var ab = applied(me, them, ps[i]);
      sc.push({ play: ps[i], s: evaluate(ab[0], ab[1], W, gv[0], gv[1]), a: ab[0], b: ab[1] });
    }
    sc.sort(function (x, y) { return y.s - x.s; });
    if (cfg.plies >= 2) {
      var top = Math.min(sc.length, cfg.top || 6);
      var cut = [];
      for (var t = 0; t < top; t++) if (t === 0 || sc[0].s - sc[t].s < (cfg.cut || 0.35)) cut.push(sc[t]);
      for (var c = 0; c < cut.length; c++) cut[c].s = replyValue(cut[c].a, cut[c].b, W, gv[0], gv[1]);
      cut.sort(function (x, y) { return y.s - x.s; });
      sc = cut.concat(sc.slice(cut.length));
    }
    var pick = sc[0];
    if (cfg.blunder && rng() < cfg.blunder) {
      pick = sc[Math.min(sc.length - 1, 1 + ((rng() * Math.min(sc.length - 1, 6)) | 0))];
    } else if (cfg.temp > 0) {
      var bestJ = -1e9;
      for (var q = 0; q < sc.length && q < 12; q++) {
        var j = sc[q].s + (rng() * 2 - 1) * cfg.temp;
        if (j > bestJ) { bestJ = j; pick = sc[q]; }
      }
    }
    return { play: pick.play, score: pick.s, list: sc.slice(0, 3).map(function (x) { return { steps: x.play.steps, s: x.s }; }) };
  }

  /* ---------- the cube ---------- */
  /* Before rolling: chances for the side on roll, one roll deep. */
  function preRoll(me, them, W, gv) {
    var p = 0, gw = 0, gl = 0;
    for (var r = 0; r < 21; r++) {
      var ps = K.plays(me, them, ROLLS[r][0], ROLLS[r][1]), best = -1e9, bp = 0, bgw = 0, bgl = 0;
      for (var i = 0; i < ps.length; i++) {
        var ab = applied(me, them, ps[i]);
        var e = evaluate(ab[0], ab[1], W, gv[0], gv[1]);
        if (e > best) { best = e; bp = OUT.p; bgw = OUT.gw; bgl = OUT.gl; }
      }
      var w = ROLLS[r][2];
      p += bp * w; gw += bgw * w; gl += bgl * w;
    }
    return { p: p / 36, gw: gw / 36, gl: gl / 36 };
  }

  /* Match winning chances when I need a points and they need b (no cube, a fifth
     of wins are gammons). Small and smooth: it only has to rank cube actions. */
  var MET = {};
  function M(a, b) {
    if (a <= 0) return 1;
    if (b <= 0) return 0;
    var k = a + "," + b;
    if (MET[k] != null) return MET[k];
    var G = 0.2;
    var v = (a === 1 && b === 1) ? 0.5 :
      0.5 * ((1 - G) * M(a - 1, b) + G * M(a - 2, b)) + 0.5 * ((1 - G) * M(a, b - 1) + G * M(a, b - 2));
    MET[k] = v;
    return v;
  }
  function mwc(q, a, b, v) {
    var ws = Math.max(0, q.p - q.gw), ls = Math.max(0, 1 - q.p - q.gl);
    return ws * M(a - v, b) + q.gw * M(a - 2 * v, b) + ls * M(a, b - v) + q.gl * M(a, b - 2 * v);
  }

  /* The classic count for races: pips plus wastage. */
  function keith(a) {
    var k = pips(a) + 2 * Math.max(0, a[1] - 1) + Math.max(0, a[2] - 1) + Math.max(0, a[3] - 3);
    for (var g = 4; g <= 6; g++) if (!a[g]) k += 1;
    return k;
  }

  /* Should `who` (me, on roll) double? match: { myAway, theirAway, cube, owner: "me"|"them"|null, postCrawford } */
  function shouldDouble(who, me, them, match) {
    var cfg = P[who] || P.noor, W = cfg.w, v = match.cube;
    if (match.myAway <= v) return { double: false, why: "pointless" };
    /* post-Crawford, trailing a leader who needs one: double at once */
    if (match.postCrawford && match.theirAway === 1 && match.owner == null) return { double: true, why: "post-crawford" };
    var gv = gammonValues(match), q = preRoll(me, them, W, gv);
    if (!K.contact(me, them)) {
      var kr = keith(me) * 8 / 7, ko = keith(them);
      var lim = match.owner == null ? 4 : 3;
      var ok = kr - ko <= lim && q.p < 0.97;
      return { double: ok, why: "race", p: q.p };
    }
    if (q.p < cfg.dbl) return { double: false, why: "not yet", p: q.p };
    var nd = mwc(q, match.myAway, match.theirAway, v);
    var dt = mwc(q, match.myAway, match.theirAway, 2 * v);
    var dp = M(match.myAway - v, match.theirAway);
    if (nd > dp) return { double: false, why: "too good", p: q.p };
    return { double: Math.min(dt, dp) > nd, why: "market", p: q.p };
  }

  /* Should `who` (me) take a double from them (on roll)? */
  function shouldTake(who, me, them, match) {
    var cfg = P[who] || P.noor, W = cfg.w, v = match.cube;
    var gv = gammonValues({ myAway: match.theirAway, theirAway: match.myAway, cube: 2 * v });
    var d = preRoll(them, me, W, gv);
    var q = { p: Math.min(1, 1 - d.p + cfg.takeBias), gw: d.gl, gl: d.gw };
    if (!K.contact(me, them)) {
      var kr = keith(them) * 8 / 7, ko = keith(me);
      var t = kr - ko >= 2 - (cfg.takeBias > 0.05 ? 6 : 0);
      return { take: t, why: "race", p: q.p };
    }
    /* owning the cube is worth a few percent */
    var qT = { p: Math.min(1, q.p + 0.035), gw: q.gw, gl: Math.max(0, q.gl - 0.01) };
    var take = mwc(qT, match.myAway, match.theirAway, 2 * v);
    var pass = M(match.myAway, match.theirAway - v);
    return { take: take >= pass, why: "mwc", p: q.p, tk: take, ps: pass };
  }

  var api = { P: P, ROLLS: ROLLS, evaluate: evaluate, choose: choose, preRoll: preRoll, shouldDouble: shouldDouble,
    shouldTake: shouldTake, M: M, keith: keith, OUT: OUT, rollsLeft: rollsLeft };
  root.BGEngine = api;

  if (typeof self !== "undefined" && typeof importScripts === "function" && typeof window === "undefined") {
    self.onmessage = function (e) {
      var d = e.data, res = { id: d.id, type: d.type };
      var me = Int8Array.from(d.me), them = Int8Array.from(d.them);
      try {
        if (d.type === "play" || d.type === "hint") {
          var c = choose(d.type === "hint" ? "noor" : d.who, me, them, d.d1, d.d2, d.match, null, d.rest || null);
          res.steps = c.play.steps; res.score = c.score; res.list = c.list;
        } else if (d.type === "double") {
          res.r = shouldDouble(d.who, me, them, d.match);
        } else if (d.type === "take") {
          res.r = shouldTake(d.who, me, them, d.match);
        } else if (d.type === "chances") {
          res.r = preRoll(me, them, P.noor.w, [1, 1]);
        }
      } catch (err) { res.error = String(err && err.message || err); }
      self.postMessage(res);
    };
  }
})(typeof self !== "undefined" ? self : this);
