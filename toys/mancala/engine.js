/* engine.js — the regulars, in a Worker so a thinking opponent never costs the board
   a frame. If a Worker cannot start, the page loads this same file as a script and
   calls MancalaEngine.think() directly.

   Negamax alpha-beta with iterative deepening under a time budget, a transposition
   table, and move ordering (the table's move, then extra turns and captures, then
   history). Two rules shape the search:
   - ⚠ In Kalah a seed landing in your own store means the SAME side moves again, so
     that child is searched with the same window and NOT negated.
   - Every root move gets a FULL window, so each comes back with a true score the
     regular's temperature can weigh (a lesson from Chess: with a narrowing window
     only the best move is true and the rest come back as bounds).

   Weakness is a noisy preference (a softmax over the root scores, plus the odd
   blunder), not a broken search, so a weak regular's moves still look like moves.
   Scores are in tenths of a seed from the side to move. */
(function (root) {
  "use strict";
  if (!root.MancalaCore && typeof importScripts === "function") importScripts("core.js");
  var K = root.MancalaCore;
  var KALAH = K.KALAH, OWARE = K.OWARE;

  var WIN = 100000, INF = 1e9;

  /* ---------- the regulars ----------
     depth: the deepest iteration; timeMs: the budget; temp: softmax temperature in
     tenths of a seed (0 = always the best); blunder: chance of a random legal move;
     deeper: chance of searching one extra ply (Juniper's "sometimes three");
     sow: a root bonus per seed sown (Felix's long sowings).
     The evaluation weights are symmetric: what a regular values in their own
     position they also fear in yours. Tuned separately for each ruleset by
     engine-against-engine matches (see toys-log). */
  var P = {
    kalah: {
      pip:     { depth: 1,  timeMs: 100,  temp: 60, blunder: 0.25, w: { side: 0, extra: 0, hoard: 0, cap: 0 } },
      rosa:    { depth: 1,  timeMs: 100,  temp: 12, blunder: 0.08, w: { side: 1, extra: 6, hoard: 0, cap: 4 } },
      felix:   { depth: 2,  timeMs: 200,  temp: 10, blunder: 0.03, sow: 2, w: { side: 2, extra: 8, hoard: 0.4, cap: 6 } },
      juniper: { depth: 3,  timeMs: 320,  temp: 7,  blunder: 0, deeper: 0.35, w: { side: 2, extra: 8, hoard: 0.5, cap: 6 } },
      hollis:  { depth: 6,  timeMs: 700,  temp: 3,  blunder: 0, w: { side: 2.5, extra: 8, hoard: 0.6, cap: 6 } },
      adjei:   { depth: 40, timeMs: 1500, temp: 0,  blunder: 0, open: 4, w: { side: 2.5, extra: 8, hoard: 0.6, cap: 6 } }
    },
    oware: {
      pip:     { depth: 1,  timeMs: 100,  temp: 60, blunder: 0.25, w: { side: 0, mob: 0, vuln: 0, kroo: 0, empty: 0 } },
      rosa:    { depth: 1,  timeMs: 100,  temp: 12, blunder: 0.08, w: { side: 0.5, mob: 2, vuln: 2, kroo: 0, empty: 0 } },
      felix:   { depth: 2,  timeMs: 200,  temp: 10, blunder: 0.03, sow: 2, w: { side: 0.5, mob: 3, vuln: 3, kroo: 0.4, empty: 1 } },
      juniper: { depth: 3,  timeMs: 320,  temp: 7,  blunder: 0, deeper: 0.35, w: { side: 0.5, mob: 3, vuln: 4, kroo: 0.4, empty: 1 } },
      hollis:  { depth: 6,  timeMs: 700,  temp: 3,  blunder: 0, w: { side: 0.6, mob: 3, vuln: 4, kroo: 0.5, empty: 1 } },
      adjei:   { depth: 40, timeMs: 1500, temp: 0,  blunder: 0, open: 4, w: { side: 0.6, mob: 3, vuln: 4, kroo: 0.5, empty: 1 } }
    }
  };

  /* ---------- hashing ---------- */
  var seed = 0x2545f491 | 0;
  function rnd32() { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed | 0; }
  var ZA = new Int32Array(14 * 64), ZB = new Int32Array(14 * 64);
  for (var z = 0; z < ZA.length; z++) { ZA[z] = rnd32(); ZB[z] = rnd32(); }
  var SIDE_A = rnd32(), SIDE_B = rnd32();
  var H1 = 0, H2 = 0;
  function hashOf(b, side) {
    var a = side ? SIDE_A : 0, c = side ? SIDE_B : 0;
    for (var i = 0; i < 14; i++) { var v = b[i] & 63; a ^= ZA[i * 64 + v]; c ^= ZB[i * 64 + v]; }
    H1 = a; H2 = c;
  }

  var TT_BITS = 20, TT_SIZE = 1 << TT_BITS, TT_MASK = TT_SIZE - 1;
  var ttKey = new Int32Array(TT_SIZE), ttScore = new Float64Array(TT_SIZE);
  var ttDepth = new Int8Array(TT_SIZE), ttFlag = new Uint8Array(TT_SIZE), ttMove = new Int8Array(TT_SIZE);
  var EXACT = 1, LOWER = 2, UPPER = 3;

  /* ---------- search state ---------- */
  var MAXPLY = 128;
  var BS = [], QU = new Int32Array(MAXPLY + 2), P1 = new Int32Array(MAXPLY + 2), P2 = new Int32Array(MAXPLY + 2);
  for (var bi = 0; bi < MAXPLY + 2; bi++) BS.push(new Int8Array(14));
  var hist = new Int32Array(14);
  var rules, W, nodes, stopAt, aborted, past1 = [], past2 = [];

  function st(side) { return side === 0 ? 6 : 13; }
  function rowSum(b, side) { var o = side ? 7 : 0; return b[o] + b[o + 1] + b[o + 2] + b[o + 3] + b[o + 4] + b[o + 5]; }

  /* the final score of a finished game, from `side`'s seat */
  function final(b, side) {
    var d = b[st(side)] - b[st(1 - side)];
    return d > 0 ? WIN + d * 10 : d < 0 ? -WIN + d * 10 : 0;
  }

  /* ---------- evaluation ---------- */
  function evalKalah(b, side) {
    var me = side, op = 1 - side, mo = me ? 7 : 0, oo = op ? 7 : 0;
    var s = (b[st(me)] - b[st(op)]) * 10;
    var mySide = 0, opSide = 0, myX = 0, opX = 0, myH = 0, opH = 0, myC = 0, opC = 0;
    for (var k = 0; k < 6; k++) {
      var nm = b[mo + k], no = b[oo + k];
      mySide += nm; opSide += no;
      if (nm && nm === 6 - k) myX++;
      if (no && no === 6 - k) opX++;
      myH += nm * k; opH += no * k;
      if (!nm) {
        var across = b[12 - (mo + k)];
        if (across) for (var j = 0; j < k; j++) if (b[mo + j] === k - j) { if (across + 1 > myC) myC = across + 1; break; }
      }
      if (!no) {
        var across2 = b[12 - (oo + k)];
        if (across2) for (var j2 = 0; j2 < k; j2++) if (b[oo + j2] === k - j2) { if (across2 + 1 > opC) opC = across2 + 1; break; }
      }
    }
    /* the side to move can take its capture now; the other side's is only a threat */
    return s + W.side * (mySide - opSide) + W.extra * (myX - opX) + W.hoard * (myH - opH) + W.cap * (myC - opC * 0.5);
  }

  function evalOware(b, side) {
    var me = side, op = 1 - side, mo = me ? 7 : 0, oo = op ? 7 : 0;
    var s = (b[st(me)] - b[st(op)]) * 10;
    var mySide = 0, opSide = 0, myMob = 0, opMob = 0, myV = 0, opV = 0, myK = 0, opK = 0, myE = 0, opE = 0;
    for (var k = 0; k < 6; k++) {
      var nm = b[mo + k], no = b[oo + k];
      mySide += nm; opSide += no;
      if (nm) myMob++; else myE++;
      if (no) opMob++; else opE++;
      if (nm === 1 || nm === 2) myV++;
      if (no === 1 || no === 2) opV++;
      if (nm >= 12) myK += nm;
      if (no >= 12) opK += no;
    }
    return s + W.side * (mySide - opSide) + W.mob * (myMob - opMob) - W.vuln * (myV - opV)
      + W.kroo * (myK - opK) - W.empty * (myE - opE);
  }

  /* ---------- the search ---------- */
  function orderScore(b, side, p, ttIdx) {
    if (p === ttIdx) return 1e7;
    var n = b[p], o = side ? 7 : 0, k = p - o;
    if (rules === KALAH) {
      var toStore = 6 - k;
      if (n === toStore || (n > 13 && (n - toStore) % 13 === 0)) return 1e6 + p;   /* extra turn */
      if (n < 13) {
        var land = k + n;
        if (land < 6 && !b[o + land] && b[12 - (o + land)]) return 5e5 + b[12 - (o + land)] * 100;
      }
    } else if (n < 12) {
      /* the landing house, and whether it would be taken */
      var ring = k + n, li = ring < 6 ? o + ring : ring < 12 ? (side ? 0 : 7) + ring - 6 : o + ring - 12;
      if ((side ? li <= 5 : li >= 7) && (b[li] === 1 || b[li] === 2)) return 5e5 + b[li] * 100;
    }
    return hist[p];
  }

  function search(side, depth, alpha, beta, ply) {
    if ((++nodes & 1023) === 0 && Date.now() > stopAt) aborted = true;
    if (aborted) return 0;
    var b = BS[ply];

    if (rules === KALAH) {
      /* more than half the seeds banked: the game is decided, if not yet over */
      if (b[st(side)] > 24 || b[st(1 - side)] > 24) return final(b, side);
    }
    if (depth <= 0 || ply >= MAXPLY) return rules === KALAH ? evalKalah(b, side) : evalOware(b, side);

    hashOf(b, side);
    var h1 = H1, h2 = H2, slot = h1 & TT_MASK, ttIdx = -1;
    if (ttKey[slot] === h2 && ttFlag[slot]) {
      ttIdx = ttMove[slot];
      if (ttDepth[slot] >= depth) {
        var ts = ttScore[slot], f = ttFlag[slot];
        if (f === EXACT) return ts;
        if (f === LOWER && ts >= beta) return ts;
        if (f === UPPER && ts <= alpha) return ts;
      }
    }

    var o = side ? 7 : 0, moves = [], scores = [];
    var mustFeed = rules === OWARE && rowSum(b, 1 - side) === 0;
    for (var p = o; p < o + 6; p++) {
      if (!b[p]) continue;
      if (mustFeed && !K.feeds(b, side, p)) continue;
      moves.push(p); scores.push(orderScore(b, side, p, ttIdx));
    }
    if (!moves.length) {
      /* only reachable in Oware: the side to move cannot play */
      var tb = BS[ply + 1]; tb.set(b);
      if (rowSum(b, side) > 0) { var s0 = st(side); for (var q = 0; q < 13; q++) if (q !== 6 && tb[q]) { tb[s0] += tb[q]; tb[q] = 0; } }
      else sweepOwn(tb);
      return final(tb, side);
    }
    /* insertion sort, best first */
    for (var i = 1; i < moves.length; i++) {
      var mv = moves[i], sc = scores[i], j = i - 1;
      while (j >= 0 && scores[j] < sc) { moves[j + 1] = moves[j]; scores[j + 1] = scores[j]; j--; }
      moves[j + 1] = mv; scores[j + 1] = sc;
    }

    var a0 = alpha, best = -INF, bestMove = moves[0];
    P1[ply] = h1; P2[ply] = h2;
    for (var m = 0; m < moves.length; m++) {
      var v = child(side, moves[m], depth, alpha, beta, ply);
      if (aborted) return 0;
      if (v > best) { best = v; bestMove = moves[m]; }
      if (v > alpha) alpha = v;
      if (alpha >= beta) { hist[moves[m]] += depth * depth; break; }
    }
    ttKey[slot] = h2; ttScore[slot] = best; ttDepth[slot] = depth > 127 ? 127 : depth; ttMove[slot] = bestMove;
    ttFlag[slot] = best <= a0 ? UPPER : best >= beta ? LOWER : EXACT;
    return best;
  }

  function sweepOwn(b) {
    for (var p = 0; p < 6; p++) { b[6] += b[p]; b[p] = 0; }
    for (var q = 7; q < 13; q++) { b[13] += b[q]; b[q] = 0; }
  }

  /* Play pit p from BS[ply] into BS[ply + 1] and score it from `side`'s seat. */
  function child(side, p, depth, alpha, beta, ply) {
    var nb = BS[ply + 1];
    nb.set(BS[ply]);
    if (rules === KALAH) {
      var r = K.sowKalah(nb, side, p, null);
      QU[ply + 1] = r.cap ? 0 : QU[ply] + 1;
      if (rowSum(nb, 0) === 0 || rowSum(nb, 1) === 0) { sweepOwn(nb); return final(nb, side); }
      if (r.extra) return search(side, depth - 1, alpha, beta, ply + 1);
      return -search(1 - side, depth - 1, -beta, -alpha, ply + 1);
    }
    var o = K.sowOware(nb, side, p, null);
    QU[ply + 1] = o.cap ? 0 : QU[ply] + 1;
    if (nb[6] >= 25 || nb[13] >= 25 || (nb[6] === 24 && nb[13] === 24)) return final(nb, side);
    var other = 1 - side;
    if (QU[ply + 1] >= K.QUIET_LIMIT) { sweepOwn(nb); return final(nb, side); }
    /* a position seen before, in this line or in the game: call it the end it would
       become (each side banks its own row) */
    hashOf(nb, other);
    var h1 = H1, h2 = H2;
    for (var k = ply - 1; k >= 0; k -= 2) if (P1[k] === h1 && P2[k] === h2) { sweepOwn(nb); return final(nb, side); }
    for (var g = 0; g < past1.length; g++) if (past1[g] === h1 && past2[g] === h2) { sweepOwn(nb); return final(nb, side); }
    return -search(other, depth - 1, -beta, -alpha, ply + 1);
  }

  /* ---------- the root ---------- */
  function think(msg) {
    rules = msg.rules === OWARE ? OWARE : KALAH;
    var who = (P[rules][msg.who] || P[rules].adjei);
    W = who.w;
    var b0 = BS[0]; for (var i = 0; i < 14; i++) b0[i] = msg.b[i];
    var side = msg.turn;
    QU[0] = msg.quiet || 0;
    ttFlag.fill(0); hist.fill(0);
    past1 = []; past2 = [];
    (msg.past || []).forEach(function (pb) { hashOf(pb.b, pb.turn); past1.push(H1); past2.push(H2); });
    nodes = 0; aborted = false;
    var budget = msg.timeMs || who.timeMs;
    stopAt = Date.now() + budget;

    var roots = K.legalOn(b0, side, rules);
    if (!roots.length) return null;
    if (roots.length === 1) return { pit: roots[0], score: 0, depth: 0, nodes: 0, list: [] };

    var maxDepth = msg.depth || who.depth;
    if (who.deeper && Math.random() < who.deeper) maxDepth += 1;
    hashOf(b0, side); P1[0] = H1; P2[0] = H2;

    var scored = roots.map(function (p) { return { p: p, s: -INF }; });
    var bestDepth = 0;
    for (var depth = 1; depth <= maxDepth; depth++) {
      var iter = [];
      for (var r = 0; r < scored.length; r++) {
        var v = child(side, scored[r].p, depth, -INF, INF, 0);
        if (aborted) break;
        iter.push({ p: scored[r].p, s: v });
      }
      if (aborted) break;
      scored = iter.sort(function (a, c) { return c.s - a.s; });
      bestDepth = depth;
      if (Math.abs(scored[0].s) >= WIN && depth >= 2) {
        /* a forced result: no deeper look will change the choice */
        if (scored[0].s >= WIN || scored.every(function (x) { return x.s <= -WIN; })) break;
      }
      if (Date.now() > stopAt) break;
    }

    /* the regular's own taste: Felix likes to see a long sowing */
    if (who.sow) scored.forEach(function (x) { x.s2 = x.s + who.sow * Math.min(12, b0[x.p]); });
    else scored.forEach(function (x) { x.s2 = x.s; });

    var pick = scored[0], temp = who.temp;
    if (who.open && (msg.plies || 0) < 4) temp = Math.max(temp, who.open);
    if (who.blunder && Math.random() < who.blunder) {
      var rp = roots[(Math.random() * roots.length) | 0];
      pick = scored.filter(function (x) { return x.p === rp; })[0] || pick;
    } else if (temp > 0) {
      var top = -INF;
      scored.forEach(function (x) { if (x.s2 > top) top = x.s2; });
      var wonFound = scored[0].s >= WIN;
      var pool = scored.filter(function (x) {
        if (wonFound && x.s < WIN) return false;          /* never wander away from a found win */
        if (x.s <= -WIN && scored[0].s > -WIN) return false; /* or into a found loss */
        return true;
      });
      var sum = 0, wts = pool.map(function (x) { var w = Math.exp(Math.max(-60, (x.s2 - top) / temp)); sum += w; return w; });
      var u = Math.random() * sum;
      for (var q = 0; q < pool.length; q++) { u -= wts[q]; if (u <= 0) { pick = pool[q]; break; } }
    } else {
      var bestS = -INF;
      scored.forEach(function (x) { if (x.s2 > bestS) { bestS = x.s2; pick = x; } });
    }
    return { pit: pick.p, score: pick.s, depth: bestDepth, nodes: nodes, list: scored.map(function (x) { return [x.p, x.s]; }) };
  }

  var api = { P: P, think: think };
  root.MancalaEngine = api;

  if (typeof self !== "undefined" && typeof importScripts === "function" && typeof window === "undefined") {
    self.onmessage = function (e) {
      var d = e.data;
      if (d.type !== "go") return;
      var res = null, err = null;
      try { res = think(d); } catch (x) { err = String(x && x.message || x); }
      self.postMessage({ type: "bestmove", id: d.id, pit: res ? res.pit : -1, score: res ? res.score : 0,
        depth: res ? res.depth : 0, nodes: res ? res.nodes : 0, error: err });
    };
  }
})(typeof self !== "undefined" ? self : this);
