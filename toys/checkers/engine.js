/* engine.js — the opponent, in a Worker so a thinking player never costs the board
   a frame. Alpha-beta with iterative deepening, a transposition table, history
   ordering, a single-reply extension, and a capture search past the horizon.

   Lessons carried over from Chess, where each one cost a round of tuning:
   - Every root move gets a FULL window. With a narrowing window only the best move
     returns a true score and the rest come back as bounds just under alpha, which
     the temperature jitter then cannot tell apart from good moves.
   - The capture search is the difficulty lever, not depth. In checkers a capture is
     compulsory, so a position with one pending is not quiet: stopping there misreads
     every exchange. The youngest opponent searches without it on purpose, which is
     what makes her walk into two-for-ones.
   - Weakness is a noisy preference (jitter the root scores, take the max), not a
     bad search, so a weak player's moves still look like moves. */
importScripts("core.js");
var K = self.CheckersCore;
var ROW = K.ROW, COL = K.COL;

var WIN = 100000, INF = 1e9;

/* ---------- personalities ----------
   Weights are symmetric (they apply to both sides), because an asymmetric
   evaluation breaks alpha-beta. A personality is "this player believes the back
   row is worth more", which is how a human style reads too. */
var P = {
  junie:  { depth: 2,  timeMs: 120,  q: false, temp: 130, blunder: 0.12,
            w: { man: 100, king: 140, adv: 1, back: 0,  center: 1, kcent: 0, trade: 0, chase: 0 } },
  hal:    { depth: 4,  timeMs: 220,  q: true,  temp: 48,  blunder: 0.03,
            w: { man: 100, king: 145, adv: 2, back: 4,  center: 2, kcent: 2, trade: 2, chase: 2 } },
  odette: { depth: 5,  timeMs: 400,  q: true,  temp: 26,  blunder: 0,
            w: { man: 100, king: 150, adv: 2, back: 14, center: 3, kcent: 3, trade: 3, chase: 3 } },
  jasper: { depth: 9,  timeMs: 700,  q: true,  temp: 9,   blunder: 0,
            w: { man: 100, king: 140, adv: 4, back: 3,  center: 4, kcent: 2, trade: 5, chase: 4 } },
  doc:    { depth: 12, timeMs: 1000, q: true,  temp: 4,   blunder: 0,
            w: { man: 100, king: 150, adv: 3, back: 10, center: 3, kcent: 3, trade: 4, chase: 4 } },
  silas:  { depth: 40, timeMs: 1600, q: true,  temp: 0,   blunder: 0, open: 10,
            w: { man: 100, king: 155, adv: 3, back: 10, center: 3, kcent: 4, trade: 5, chase: 5 } }
};

/* ---------- tables ---------- */
var ADV = [0, 1, 2, 3, 4, 6, 8, 0];          /* rows advanced from a man's own back row */
var CENTER = new Int8Array(32), KCENT = new Int8Array(32);
for (var i = 0; i < 32; i++) {
  var dr = Math.abs(ROW[i] - 3.5), dc = Math.abs(COL[i] - 3.5);
  CENTER[i] = (dr < 1 && dc < 2) ? 2 : (dr < 2 && dc < 3) ? 1 : 0;
  var edge = Math.min(ROW[i], 7 - ROW[i], COL[i], 7 - COL[i]);
  KCENT[i] = edge === 0 ? -1 : edge === 1 ? 1 : 2;
}
/* Black's back-row "bridge" is squares 1 and 3, Red's 30 and 32: the classic
   defensive pair that keeps the other side from crowning. */
var BRIDGE = { 0: 1, 2: 1, 29: 1, 31: 1 };
var DOUBLE_CORNER = [0, 4, 27, 31];

/* ---------- hashing ---------- */
var seed = 0x9e3779b9 | 0;
function rnd() { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed | 0; }
var ZA = new Int32Array(32 * 5), ZB = new Int32Array(32 * 5);
for (var z = 0; z < ZA.length; z++) { ZA[z] = rnd(); ZB[z] = rnd(); }
var SIDE_A = rnd(), SIDE_B = rnd();
var H1 = 0, H2 = 0;
function hashOf(b, turn) {
  var a = turn > 0 ? SIDE_A : 0, c = turn > 0 ? SIDE_B : 0;
  for (var k = 0; k < 32; k++) { var p = b[k]; if (p) { a ^= ZA[k * 5 + p + 2]; c ^= ZB[k * 5 + p + 2]; } }
  H1 = a; H2 = c;
}

var TT_BITS = 20, TT_SIZE = 1 << TT_BITS, TT_MASK = TT_SIZE - 1;
var ttKey = new Int32Array(TT_SIZE), ttScore = new Int32Array(TT_SIZE);
var ttDepth = new Int8Array(TT_SIZE), ttFlag = new Uint8Array(TT_SIZE), ttMove = new Int8Array(TT_SIZE);
var EXACT = 1, LOWER = 2, UPPER = 3;

/* ---------- search state ---------- */
var pos, forced, W, useQ, nodes, stopAt, aborted;
var stk1 = new Int32Array(512), stk2 = new Int32Array(512), sp = 0;
var hist = new Int32Array(32 * 32);

function evaluate() {
  var b = pos.b, s = 0, bm = 0, bk = 0, rm = 0, rk = 0;
  for (var k = 0; k < 32; k++) { var p = b[k]; if (p === 1) bm++; else if (p === 2) bk++; else if (p === -1) rm++; else if (p === -2) rk++; }
  var total = bm + bk + rm + rk;
  var late = total <= 12, adv = W.adv * (late ? 2 : 1);
  var guard = total > 10;
  for (var j = 0; j < 32; j++) {
    var q = b[j];
    if (!q) continue;
    if (q === 1) {
      s += W.man + ADV[ROW[j]] * adv + CENTER[j] * W.center;
      if (guard && ROW[j] === 0 && !rk) s += BRIDGE[j] ? W.back : W.back >> 1;
    } else if (q === -1) {
      s -= W.man + ADV[7 - ROW[j]] * adv + CENTER[j] * W.center;
      if (guard && ROW[j] === 7 && !bk) s -= BRIDGE[j] ? W.back : W.back >> 1;
    } else if (q === 2) s += W.king + KCENT[j] * W.kcent;
    else s -= W.king + KCENT[j] * W.kcent;
  }
  if (late) {
    var nb = bm + bk, nr = rm + rk;
    /* When ahead, trading down wins: 2 against 1 is a win, 7 against 6 is a long night. */
    if (nb !== nr && W.trade) s += (nb > nr ? 1 : -1) * W.trade * (24 - total);
    /* Drive the stronger side's kings at the enemy, and push the weaker side's lone
       king out of the double corner, where it can otherwise hold for a long time. */
    if (W.chase && nb !== nr) {
      var strong = nb > nr ? 1 : -1, sum = 0;
      for (var a = 0; a < 32; a++) {
        if (b[a] !== 2 * strong) continue;
        var best = 99;
        for (var e = 0; e < 32; e++) {
          if (!b[e] || (b[e] > 0) === (strong > 0)) continue;
          var d = Math.max(Math.abs(ROW[a] - ROW[e]), Math.abs(COL[a] - COL[e]));
          if (d < best) best = d;
        }
        if (best < 99) sum += best;
      }
      s -= strong * sum * W.chase;
      for (var dc2 = 0; dc2 < 4; dc2++) {
        var v = b[DOUBLE_CORNER[dc2]];
        if (v && (v > 0) !== (strong > 0)) s -= strong * W.chase * 3;
      }
    }
  }
  return pos.turn === 1 ? s : -s;
}

function moveScore(m, idx, ttIdx) {
  if (idx === ttIdx) return 1e7;
  if (m.caps.length) return 1e6 + m.caps.length * 1000;
  if (m.crown) return 5e5;
  return hist[m.from * 32 + m.path[0]];
}

function search(depth, alpha, beta, ply) {
  if ((++nodes & 1023) === 0 && Date.now() > stopAt) aborted = true;
  if (aborted) return 0;

  hashOf(pos.b, pos.turn);
  var h1 = H1, h2 = H2;
  if (ply > 0) {
    if (pos.half >= 80) return 0;
    /* Repetition: only positions since the last capture or man move can recur. */
    for (var r = sp - 2, n = 2; r >= 0 && n <= pos.half; r -= 2, n += 2) {
      if (stk1[r] === h1 && stk2[r] === h2) return 0;
    }
  }

  var moves = K.generate(pos, forced);
  if (!moves.length) return -WIN + ply;

  var quiet = depth <= 0;
  if (quiet) {
    if (!useQ || ply >= 64) return evaluate();
    if (forced) {
      /* A pending capture is compulsory, so there is no "stand pat": play it out. */
      if (!moves[0].caps.length) return evaluate();
    } else {
      var stand = evaluate();
      if (stand >= beta) return stand;
      if (stand > alpha) alpha = stand;
      moves = moves.filter(function (m) { return m.caps.length > 0; });
      if (!moves.length) return stand;
    }
  }

  var slot = h1 & TT_MASK, ttIdx = -1;
  if (!quiet && ttKey[slot] === h2 && ttFlag[slot]) {
    ttIdx = ttMove[slot];
    if (ttDepth[slot] >= depth && ply > 0) {
      var ts = ttScore[slot];
      if (ts > WIN - 1000) ts -= ply; else if (ts < -WIN + 1000) ts += ply;
      var f = ttFlag[slot];
      if (f === EXACT) return ts;
      if (f === LOWER && ts >= beta) return ts;
      if (f === UPPER && ts <= alpha) return ts;
    }
  }

  /* A single legal reply costs nothing to play, so it does not cost depth either. */
  var next = (moves.length === 1 && !quiet && ply < 48) ? depth : depth - 1;

  var order = [];
  for (var k = 0; k < moves.length; k++) order.push({ i: k, s: moveScore(moves[k], k, ttIdx) });
  order.sort(function (x, y) { return y.s - x.s; });

  var a0 = alpha, best = -INF, bestIdx = order[0].i;
  stk1[sp] = h1; stk2[sp] = h2; sp++;
  for (var o = 0; o < order.length; o++) {
    var m = moves[order[o].i];
    K.makeMove(pos, m, false);
    var sc = -search(next, -beta, -alpha, ply + 1);
    K.unmakeMove(pos, false);
    if (aborted) { sp--; return 0; }
    if (sc > best) { best = sc; bestIdx = order[o].i; }
    if (sc > alpha) alpha = sc;
    if (alpha >= beta) {
      if (!m.caps.length) hist[m.from * 32 + m.path[0]] += depth * depth;
      break;
    }
  }
  sp--;

  if (!quiet) {
    var stored = best;
    if (stored > WIN - 1000) stored += ply; else if (stored < -WIN + 1000) stored -= ply;
    ttKey[slot] = h2; ttScore[slot] = stored; ttDepth[slot] = depth > 127 ? 127 : depth; ttMove[slot] = bestIdx;
    ttFlag[slot] = best <= a0 ? UPPER : best >= beta ? LOWER : EXACT;
  }
  return best;
}

function think(msg) {
  var who = P[msg.who] || P.silas;
  W = who.w; useQ = who.q; forced = msg.forced !== false;
  pos = { b: new Int8Array(msg.b), turn: msg.turn, half: msg.half || 0, undo: [], keys: [] };
  ttFlag.fill(0); hist.fill(0);
  nodes = 0; aborted = false; stopAt = Date.now() + (msg.timeMs || who.timeMs);

  /* Earlier positions since the last irreversible move, for repetition. */
  sp = 0;
  (msg.past || []).forEach(function (p) {
    hashOf(p.b, p.turn); stk1[sp] = H1; stk2[sp] = H2; sp++;
  });

  var roots = K.generate(pos, forced);
  if (!roots.length) return null;
  if (roots.length === 1) return { move: roots[0], score: 0, depth: 0, nodes: 0 };

  var scored = roots.map(function (m) { return { m: m, s: -INF }; });
  var bestDepth = 0;
  hashOf(pos.b, pos.turn);
  var rh1 = H1, rh2 = H2;

  for (var depth = 1; depth <= who.depth; depth++) {
    var iter = [];
    stk1[sp] = rh1; stk2[sp] = rh2; sp++;
    for (var i2 = 0; i2 < scored.length; i2++) {
      var m = scored[i2].m;
      K.makeMove(pos, m, false);
      var s = -search(depth - 1, -INF, INF, 1);
      K.unmakeMove(pos, false);
      if (aborted) break;
      iter.push({ m: m, s: s });
    }
    sp--;
    if (aborted) break;
    scored = iter.sort(function (a, b) { return b.s - a.s; });
    bestDepth = depth;
    if (Math.abs(scored[0].s) > WIN - 1000) break;          /* a forced result is found */
    if (Date.now() > stopAt) break;
  }

  var pick = scored[0].m, pickScore = scored[0].s;
  var temp = who.temp;
  if (who.open && (msg.plies || 0) < 6) temp = Math.max(temp, who.open);
  if (who.blunder && Math.random() < who.blunder) {
    pick = roots[(Math.random() * roots.length) | 0];
  } else if (temp > 0) {
    var bestJ = -INF;
    for (var q = 0; q < scored.length; q++) {
      /* Never jitter away from a found win, or into a found loss. */
      if (scored[0].s > WIN - 1000 && scored[q].s < WIN - 1000) continue;
      var j = scored[q].s + (Math.random() * 2 - 1) * temp;
      if (scored[q].s < -WIN + 1000 && scored[0].s > -WIN + 1000) continue;
      if (j > bestJ) { bestJ = j; pick = scored[q].m; pickScore = scored[q].s; }
    }
  }
  return { move: pick, score: pickScore, depth: bestDepth, nodes: nodes };
}

self.onmessage = function (e) {
  var d = e.data;
  if (d.type !== "go") return;
  var res = think(d);
  self.postMessage({
    type: "bestmove", id: d.id,
    note: res ? K.notation(res.move) : null,
    score: res ? res.score : 0, depth: res ? res.depth : 0, nodes: res ? res.nodes : 0
  });
};
