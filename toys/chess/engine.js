/* engine.js — the search, running in a Worker so a thinking opponent never costs
   the board a frame. Alpha-beta with iterative deepening, a transposition table,
   quiescence, killers and history.

   The six opponents are NOT six search depths wearing different names. Depth sets
   how much they see; the evaluation WEIGHTS set what they want, and that is what
   makes them feel like different players. The weights stay symmetric (they apply to
   both sides equally) because an asymmetric evaluation breaks alpha-beta — so a
   personality reads as "this player believes king attacks are worth more than a
   pawn", which is exactly how a human style reads too. */
importScripts("chess-core.js");
var C = self.ChessCore;

var MATE = 30000, INF = 1e9;
var VAL = [0, 100, 320, 330, 500, 900, 20000];
/* Endgame values: bishops and rooks gain as the board opens, knights lose. */
var VAL_EG = [0, 120, 300, 340, 540, 940, 20000];

/* ---------- piece-square tables (written rank 8 first, so they read like a board) ---------- */
function T(a) { return a; }
var PST = {};
PST[C.PAWN] = T([
    0,  0,  0,  0,  0,  0,  0,  0,
   50, 50, 50, 50, 50, 50, 50, 50,
   10, 10, 20, 30, 30, 20, 10, 10,
    5,  5, 10, 25, 25, 10,  5,  5,
    0,  0,  0, 20, 20,  0,  0,  0,
    5, -5,-10,  0,  0,-10, -5,  5,
    5, 10, 10,-20,-20, 10, 10,  5,
    0,  0,  0,  0,  0,  0,  0,  0]);
PST[C.KNIGHT] = T([
  -50,-40,-30,-30,-30,-30,-40,-50,
  -40,-20,  0,  0,  0,  0,-20,-40,
  -30,  0, 10, 15, 15, 10,  0,-30,
  -30,  5, 15, 20, 20, 15,  5,-30,
  -30,  0, 15, 20, 20, 15,  0,-30,
  -30,  5, 10, 15, 15, 10,  5,-30,
  -40,-20,  0,  5,  5,  0,-20,-40,
  -50,-40,-30,-30,-30,-30,-40,-50]);
PST[C.BISHOP] = T([
  -20,-10,-10,-10,-10,-10,-10,-20,
  -10,  0,  0,  0,  0,  0,  0,-10,
  -10,  0,  5, 10, 10,  5,  0,-10,
  -10,  5,  5, 10, 10,  5,  5,-10,
  -10,  0, 10, 10, 10, 10,  0,-10,
  -10, 10, 10, 10, 10, 10, 10,-10,
  -10,  5,  0,  0,  0,  0,  5,-10,
  -20,-10,-10,-10,-10,-10,-10,-20]);
PST[C.ROOK] = T([
    0,  0,  0,  0,  0,  0,  0,  0,
    5, 10, 10, 10, 10, 10, 10,  5,
   -5,  0,  0,  0,  0,  0,  0, -5,
   -5,  0,  0,  0,  0,  0,  0, -5,
   -5,  0,  0,  0,  0,  0,  0, -5,
   -5,  0,  0,  0,  0,  0,  0, -5,
   -5,  0,  0,  0,  0,  0,  0, -5,
    0,  0,  0,  5,  5,  0,  0,  0]);
PST[C.QUEEN] = T([
  -20,-10,-10, -5, -5,-10,-10,-20,
  -10,  0,  0,  0,  0,  0,  0,-10,
  -10,  0,  5,  5,  5,  5,  0,-10,
   -5,  0,  5,  5,  5,  5,  0, -5,
    0,  0,  5,  5,  5,  5,  0, -5,
  -10,  5,  5,  5,  5,  5,  0,-10,
  -10,  0,  5,  0,  0,  0,  0,-10,
  -20,-10,-10, -5, -5,-10,-10,-20]);
var KING_MG = T([
  -30,-40,-40,-50,-50,-40,-40,-30,
  -30,-40,-40,-50,-50,-40,-40,-30,
  -30,-40,-40,-50,-50,-40,-40,-30,
  -30,-40,-40,-50,-50,-40,-40,-30,
  -20,-30,-30,-40,-40,-30,-30,-20,
  -10,-20,-20,-20,-20,-20,-20,-10,
   20, 20,  0,  0,  0,  0, 20, 20,
   20, 30, 10,  0,  0, 10, 30, 20]);
var KING_EG = T([
  -50,-40,-30,-20,-20,-30,-40,-50,
  -30,-20,-10,  0,  0,-10,-20,-30,
  -30,-10, 20, 30, 30, 20,-10,-30,
  -30,-10, 30, 40, 40, 30,-10,-30,
  -30,-10, 30, 40, 40, 30,-10,-30,
  -30,-10, 20, 30, 30, 20,-10,-30,
  -30,-30,  0,  0,  0,  0,-30,-30,
  -50,-30,-30,-30,-30,-30,-30,-50]);
var PAWN_EG = T([
    0,  0,  0,  0,  0,  0,  0,  0,
   80, 80, 80, 80, 80, 80, 80, 80,
   50, 50, 50, 50, 50, 50, 50, 50,
   30, 30, 30, 30, 30, 30, 30, 30,
   20, 20, 20, 20, 20, 20, 20, 20,
   10, 10, 10, 10, 10, 10, 10, 10,
   10, 10, 10, 10, 10, 10, 10, 10,
    0,  0,  0,  0,  0,  0,  0,  0]);

/* 0x88 square -> table index, flipped for black so one table serves both sides. */
function pstIdx(sq, white) {
  var r = sq >> 4, f = sq & 7;
  return white ? (7 - r) * 8 + f : r * 8 + f;
}
/* Chebyshev distance drives king tropism — how close our force is massing to their king. */
function chebyshev(a, b) {
  var dr = Math.abs((a >> 4) - (b >> 4)), df = Math.abs((a & 7) - (b & 7));
  return dr > df ? dr : df;
}
var TROPISM = [0, 0, 3, 2, 2, 5, 0];

/* ---------- evaluation ---------- */
var W = null;   /* active personality weights */

function evaluate(pos) {
  var b = pos.board, sq, pc, t, white, i;
  var mgW = 0, egW = 0, mgB = 0, egB = 0;      /* piece-square, tapered */
  var matW = 0, matB = 0, matEgW = 0, matEgB = 0;
  var phase = 0;
  var pawnFilesW = [0,0,0,0,0,0,0,0], pawnFilesB = [0,0,0,0,0,0,0,0];
  var pawnsW = [], pawnsB = [];
  var bishopsW = 0, bishopsB = 0;
  var tropW = 0, tropB = 0;
  var mobW = 0, mobB = 0;
  var kW = pos.kings[0], kB = pos.kings[1];

  for (i = 0; i < 64; i++) {
    sq = C.SQUARES[i]; pc = b[sq];
    if (!pc) continue;
    t = pc & C.TYPE;
    white = (pc & C.COLOR) === C.WHITE;
    var idx = pstIdx(sq, white);

    /* Game phase: 24 at the full opening array, 0 in a bare endgame. */
    if (t === C.KNIGHT || t === C.BISHOP) phase += 1;
    else if (t === C.ROOK) phase += 2;
    else if (t === C.QUEEN) phase += 4;

    var mgv, egv;
    if (t === C.KING) { mgv = KING_MG[idx]; egv = KING_EG[idx]; }
    else if (t === C.PAWN) { mgv = PST[C.PAWN][idx]; egv = PAWN_EG[idx]; }
    else { mgv = PST[t][idx]; egv = PST[t][idx]; }

    if (white) {
      matW += VAL[t]; matEgW += VAL_EG[t]; mgW += mgv; egW += egv;
      if (t === C.PAWN) { pawnFilesW[sq & 7]++; pawnsW.push(sq); }
      if (t === C.BISHOP) bishopsW++;
      if (t !== C.KING && t !== C.PAWN) tropW += TROPISM[t] * (7 - chebyshev(sq, kB));
    } else {
      matB += VAL[t]; matEgB += VAL_EG[t]; mgB += mgv; egB += egv;
      if (t === C.PAWN) { pawnFilesB[sq & 7]++; pawnsB.push(sq); }
      if (t === C.BISHOP) bishopsB++;
      if (t !== C.KING && t !== C.PAWN) tropB += TROPISM[t] * (7 - chebyshev(sq, kW));
    }

    /* Mobility, counted as reachable squares rather than generated moves — the
       ray walk is the same work the generator would do without the bookkeeping. */
    if (t === C.KNIGHT || t === C.BISHOP || t === C.ROOK || t === C.QUEEN) {
      var cnt = mobilityOf(b, sq, t, pc & C.COLOR);
      if (white) mobW += cnt; else mobB += cnt;
    }
  }

  if (phase > 24) phase = 24;
  var mgPhase = phase / 24, egPhase = 1 - mgPhase;

  var material = (matW - matB) * mgPhase + (matEgW - matEgB) * egPhase;
  var pst = (mgW - mgB) * mgPhase + (egW - egB) * egPhase;

  /* Pawn structure: doubled, isolated, passed. */
  var struct = 0;
  for (i = 0; i < 8; i++) {
    if (pawnFilesW[i] > 1) struct -= 18 * (pawnFilesW[i] - 1);
    if (pawnFilesB[i] > 1) struct += 18 * (pawnFilesB[i] - 1);
    if (pawnFilesW[i] && !(i > 0 && pawnFilesW[i-1]) && !(i < 7 && pawnFilesW[i+1])) struct -= 16;
    if (pawnFilesB[i] && !(i > 0 && pawnFilesB[i-1]) && !(i < 7 && pawnFilesB[i+1])) struct += 16;
  }
  for (i = 0; i < pawnsW.length; i++) if (isPassed(b, pawnsW[i], true)) struct += 14 + 8 * (pawnsW[i] >> 4);
  for (i = 0; i < pawnsB.length; i++) if (isPassed(b, pawnsB[i], false)) struct -= 14 + 8 * (7 - (pawnsB[i] >> 4));

  if (bishopsW >= 2) struct += 35;
  if (bishopsB >= 2) struct -= 35;

  /* King safety: the pawn shield in front of a castled king, scaled out in the endgame. */
  var safety = (shield(b, kW, true) - shield(b, kB, false)) * mgPhase;
  var tropism = (tropW - tropB) * mgPhase;
  var mobility = (mobW - mobB);

  var score =
      material * W.mat +
      pst * W.pst +
      struct * W.pawns +
      safety * W.king +
      tropism * W.atk +
      mobility * 3 * W.mob;

  return pos.turn === C.WHITE ? score : -score;
}

function mobilityOf(b, sq, t, color) {
  var offs, n, cnt = 0, j, s, off, pc;
  if (t === C.KNIGHT) {
    offs = [-33,-31,-18,-14,14,18,31,33];
    for (j = 0; j < 8; j++) { s = sq + offs[j]; if (!(s & 0x88)) { pc = b[s]; if (!pc || (pc & C.COLOR) !== color) cnt++; } }
    return cnt;
  }
  if (t === C.BISHOP) { offs = [-17,-15,15,17]; n = 4; }
  else if (t === C.ROOK) { offs = [-16,-1,1,16]; n = 4; }
  else { offs = [-17,-16,-15,-1,1,15,16,17]; n = 8; }
  for (j = 0; j < n; j++) {
    off = offs[j]; s = sq + off;
    while (!(s & 0x88)) {
      pc = b[s];
      if (pc) { if ((pc & C.COLOR) !== color) cnt++; break; }
      cnt++; s += off;
    }
  }
  return cnt;
}

function isPassed(b, sq, white) {
  var f = sq & 7, r = sq >> 4;
  var them = white ? C.BLACK : C.WHITE;
  for (var df = -1; df <= 1; df++) {
    var ff = f + df;
    if (ff < 0 || ff > 7) continue;
    if (white) { for (var rr = r + 1; rr <= 7; rr++) if (b[(rr << 4) | ff] === (them | C.PAWN)) return false; }
    else { for (var rr2 = r - 1; rr2 >= 0; rr2--) if (b[(rr2 << 4) | ff] === (them | C.PAWN)) return false; }
  }
  return true;
}

function shield(b, ksq, white) {
  var f = ksq & 7, r = ksq >> 4, s = 0, own = (white ? C.WHITE : C.BLACK) | C.PAWN;
  var dir = white ? 1 : -1;
  for (var df = -1; df <= 1; df++) {
    var ff = f + df;
    if (ff < 0 || ff > 7) continue;
    var r1 = r + dir, r2 = r + dir * 2;
    if (r1 >= 0 && r1 <= 7 && b[(r1 << 4) | ff] === own) s += 12;
    else if (r2 >= 0 && r2 <= 7 && b[(r2 << 4) | ff] === own) s += 6;
    else s -= 14;
  }
  /* An exposed king on a wide-open board is worse than the shield alone suggests. */
  return s;
}

/* ---------- transposition table ---------- */
var TT_BITS = 18, TT_SIZE = 1 << TT_BITS, TT_MASK = TT_SIZE - 1;
var ttKey = new Int32Array(TT_SIZE), ttMove = new Int32Array(TT_SIZE);
var ttScore = new Int32Array(TT_SIZE), ttMeta = new Int32Array(TT_SIZE);
var TT_EXACT = 1, TT_LOWER = 2, TT_UPPER = 3;
function ttClear() { ttKey.fill(0); ttMove.fill(0); ttScore.fill(0); ttMeta.fill(0); }

/* ---------- search state ---------- */
var nodes = 0, stopAt = 0, aborted = false;
var killers = [], history = null;
var moveBuf = [];
for (var d = 0; d < 64; d++) { moveBuf.push(new Int32Array(256)); killers.push([0, 0]); }

function orderScore(pos, m, ply, ttm) {
  if (m === ttm) return 1e7;
  var cap = C.mCap(m), promo = C.mPromo(m);
  if (cap) {
    var victim = VAL[cap & C.TYPE], attacker = VAL[pos.board[C.mFrom(m)] & C.TYPE];
    return 1e6 + victim * 16 - attacker;
  }
  if (promo) return 9e5 + VAL[promo];
  if (killers[ply][0] === m) return 8e5;
  if (killers[ply][1] === m) return 7.9e5;
  return history[C.mFrom(m) * 128 + C.mTo(m)];
}

function quiesce(pos, alpha, beta, ply) {
  nodes++;
  if ((nodes & 2047) === 0 && Date.now() > stopAt) { aborted = true; return alpha; }

  var stand = evaluate(pos);
  if (stand >= beta) return beta;
  if (stand > alpha) alpha = stand;
  if (ply >= 40) return stand;

  var buf = moveBuf[ply < 63 ? ply : 63];
  var n = C.genMoves(pos, buf, true);
  var list = [];
  for (var i = 0; i < n; i++) list.push(buf[i]);
  list.sort(function (a, b2) { return orderScore(pos, b2, 0, 0) - orderScore(pos, a, 0, 0); });

  var us = pos.turn;
  for (var j = 0; j < list.length; j++) {
    var m = list[j];
    /* Delta pruning: a capture that cannot possibly lift us to alpha is noise. */
    var gain = VAL[C.mCap(m) & C.TYPE] || 0;
    if (stand + gain + 200 < alpha && !C.mPromo(m)) continue;
    C.makeMove(pos, m);
    if (C.isAttacked(pos, C.kingSq(pos, us), pos.turn)) { C.unmakeMove(pos); continue; }
    var s = -quiesce(pos, -beta, -alpha, ply + 1);
    C.unmakeMove(pos);
    if (aborted) return alpha;
    if (s >= beta) return beta;
    if (s > alpha) alpha = s;
  }
  return alpha;
}

function search(pos, depth, alpha, beta, ply, canNull) {
  if (aborted) return alpha;
  nodes++;
  if ((nodes & 2047) === 0 && Date.now() > stopAt) { aborted = true; return alpha; }

  /* Repetition and the fifty-move rule are draws inside the search too, or the
     engine happily shuffles into one while "winning". */
  if (ply > 0) {
    if (pos.half >= 100) return 0;
    var reps = 0, h = pos.hashLo;
    for (var r = pos.hist.length - 2; r >= 0 && r >= pos.hist.length - 1 - pos.half; r--) {
      if (pos.hist[r] === h) { reps++; if (reps >= 1) return 0; }
    }
  }

  var idx = (pos.hashLo & TT_MASK) >>> 0;
  var ttm = 0;
  if (ttKey[idx] === pos.hashHi && ttKey[idx] !== 0) {
    ttm = ttMove[idx];
    var meta = ttMeta[idx], tdepth = meta >> 2, flag = meta & 3;
    if (ply > 0 && tdepth >= depth) {
      var ts = ttScore[idx];
      if (flag === TT_EXACT) return ts;
      if (flag === TT_LOWER && ts >= beta) return ts;
      if (flag === TT_UPPER && ts <= alpha) return ts;
    }
  }

  var us = pos.turn;
  var checked = C.isAttacked(pos, C.kingSq(pos, us), us === C.WHITE ? C.BLACK : C.WHITE);
  if (checked) depth++;                                   /* check extension */
  /* ⚠ Quiescence is what stops an engine hanging a piece to a one-move recapture,
     so it is also the single biggest lever on how weak an opponent FEELS. The
     Novice searches without it on purpose: that, not a low depth, is what produces
     the specific texture of a beginner who leaves pieces en prise. */
  if (depth <= 0) return W.quiesce ? quiesce(pos, alpha, beta, ply) : evaluate(pos);

  /* Null move: give the opponent a free move; if we are still winning, prune.
     Skipped in check and in thin endgames, where zugzwang makes it a lie. */
  if (W.nullMove && canNull && !checked && depth >= 3 && ply > 0 && hasNonPawn(pos, us)) {
    var savedEp = pos.ep, savedHalf = pos.half;
    pos.turn = us === C.WHITE ? C.BLACK : C.WHITE; pos.ep = -1;
    pos.hist.push(pos.hashLo);
    var nullScore = -search(pos, depth - 3, -beta, -beta + 1, ply + 1, false);
    pos.hist.pop();
    pos.turn = us; pos.ep = savedEp; pos.half = savedHalf;
    if (aborted) return alpha;
    if (nullScore >= beta) return beta;
  }

  var buf = moveBuf[ply < 63 ? ply : 63];
  var n = C.genMoves(pos, buf, false);
  var list = [];
  for (var i = 0; i < n; i++) list.push(buf[i]);
  list.sort(function (a, b2) { return orderScore(pos, b2, ply, ttm) - orderScore(pos, a, ply, ttm); });

  var best = -INF, bestMove = 0, legal = 0, origAlpha = alpha;
  for (var j = 0; j < list.length; j++) {
    var m = list[j];
    C.makeMove(pos, m);
    if (C.isAttacked(pos, C.kingSq(pos, us), pos.turn)) { C.unmakeMove(pos); continue; }
    legal++;
    var s;
    /* Late-move reduction: quiet moves far down a well-ordered list rarely
       deserve full depth, so search them shallow and re-search only on a surprise. */
    if (legal > 4 && depth >= 3 && !C.mCap(m) && !C.mPromo(m) && !checked) {
      s = -search(pos, depth - 2, -alpha - 1, -alpha, ply + 1, true);
      if (s > alpha) s = -search(pos, depth - 1, -beta, -alpha, ply + 1, true);
    } else {
      s = -search(pos, depth - 1, -beta, -alpha, ply + 1, true);
    }
    C.unmakeMove(pos);
    if (aborted) return best > -INF ? best : alpha;

    if (s > best) { best = s; bestMove = m; }
    if (s > alpha) alpha = s;
    if (alpha >= beta) {
      if (!C.mCap(m)) {
        if (killers[ply][0] !== m) { killers[ply][1] = killers[ply][0]; killers[ply][0] = m; }
        history[C.mFrom(m) * 128 + C.mTo(m)] += depth * depth;
      }
      break;
    }
  }

  if (!legal) return checked ? -MATE + ply : 0;

  var storeFlag = best <= origAlpha ? TT_UPPER : best >= beta ? TT_LOWER : TT_EXACT;
  ttKey[idx] = pos.hashHi; ttMove[idx] = bestMove;
  ttScore[idx] = best; ttMeta[idx] = (depth << 2) | storeFlag;
  return best;
}

function hasNonPawn(pos, color) {
  for (var i = 0; i < 64; i++) {
    var pc = pos.board[C.SQUARES[i]];
    if (pc && (pc & C.COLOR) === color) { var t = pc & C.TYPE; if (t !== C.PAWN && t !== C.KING) return true; }
  }
  return false;
}

/* ---------- root ---------- */
function think(pos, personality) {
  W = personality.w;
  ttClear();
  history = new Int32Array(128 * 128);
  for (var k = 0; k < killers.length; k++) { killers[k][0] = 0; killers[k][1] = 0; }
  nodes = 0; aborted = false;
  stopAt = Date.now() + personality.timeMs;

  var roots = C.legalMoves(pos);
  if (!roots.length) return null;
  if (roots.length === 1) return { move: roots[0], score: 0, depth: 0, nodes: 0 };

  var scored = roots.map(function (m) { return { m: m, s: -INF }; });
  var bestDepth = 0, bestSoFar = roots[0];

  for (var depth = 1; depth <= personality.depth; depth++) {
    var localBest = -INF, localMove = 0;
    var iterScores = [];
    for (var i = 0; i < scored.length; i++) {
      var m = scored[i].m;
      C.makeMove(pos, m);
      /* ⚠ EVERY root move gets a FULL window, deliberately giving up the alpha-beta
         saving here. With a narrowing (-INF, -alpha) window only the best move
         returns a true score; every other move fails low and comes back as a BOUND
         sitting just under alpha. Sorting still works, but the personality system
         reads these numbers as centipawns — so a losing move scored at ~alpha
         instead of -900 was well inside the temperature jitter, and the engine
         played it. Measured: the Architect (temp 32) found mate in 1 once in
         twenty, while the Novice (temp 260) found it fourteen times, because
         deeper search tightens the bounds. Root move counts are small and the
         search is nowhere near its time budget, so the full window is cheap. */
      var s = -search(pos, depth - 1, -INF, INF, 1, true);
      C.unmakeMove(pos);
      if (aborted) break;
      iterScores.push({ m: m, s: s });
      if (s > localBest) { localBest = s; localMove = m; }
    }
    if (iterScores.length) {
      /* Only trust a fully completed iteration; a half-searched depth is biased
         toward whatever happened to be ordered first. */
      if (!aborted) {
        scored = iterScores.slice().sort(function (a, b) { return b.s - a.s; });
        bestDepth = depth;
        bestSoFar = localMove;
        self.postMessage({ type: "info", depth: depth, score: localBest, nodes: nodes });
      }
    }
    if (aborted) break;
    if (Math.abs(localBest) > MATE - 100) break;      /* forced mate found */
    if (Date.now() > stopAt) break;
  }

  /* ---------- how a weaker player picks ----------
     Weakness is not "search badly then take the best of the rubbish". It is a
     noisy preference: jitter the root scores and take the max. Combined with a
     shallow depth and no quiescence, that produces the specific texture of a weak
     human — reasonable-looking moves that drop material to a two-move tactic. */
  var pick = scored[0] ? scored[0].m : bestSoFar;
  var pickScore = scored[0] ? scored[0].s : 0;

  if (personality.blunder > 0 && Math.random() < personality.blunder) {
    pick = roots[(Math.random() * roots.length) | 0];
    pickScore = 0;
  } else if (personality.temp > 0) {
    var bestJ = -INF, bestM = pick;
    for (var q = 0; q < scored.length; q++) {
      var j = scored[q].s + (Math.random() * 2 - 1) * personality.temp;
      if (j > bestJ) { bestJ = j; bestM = scored[q].m; }
    }
    pick = bestM;
  }
  return { move: pick, score: pickScore, depth: bestDepth, nodes: nodes };
}

/* ---------- opening book ----------
   Lines are UCI and matched by prefix, so the book works whichever colour the
   engine has. Each line is tagged, and a personality only draws from the tags that
   suit it — the Duelist opens with gambits, the Architect will not. */
var BOOK = [
  ["ital", "e2e4 e7e5 g1f3 b8c6 f1c4 f8c5 c2c3 g8f6 d2d4 e5d4 c3d4 c5b4"],
  ["ital", "e2e4 e7e5 g1f3 b8c6 f1c4 g8f6 d2d3 f8c5 c2c3 d7d6 b2b4"],
  ["ruy",  "e2e4 e7e5 g1f3 b8c6 f1b5 a7a6 b5a4 g8f6 e1g1 f8e7 f1e1 b7b5"],
  ["ruy",  "e2e4 e7e5 g1f3 b8c6 f1b5 g8f6 e1g1 f6e4 d2d4 e4d6"],
  ["scotch","e2e4 e7e5 g1f3 b8c6 d2d4 e5d4 f3d4 f8c5 d4b3 c5b6"],
  ["gambit","e2e4 e7e5 f2f4 e5f4 g1f3 g7g5 f1c4 f8g7 e1g1"],
  ["gambit","e2e4 e7e5 g1f3 b8c6 f1c4 f8c5 b2b4 c5b4 c2c3 b4a5 d2d4"],
  ["gambit","e2e4 e7e5 b1c3 g8f6 f2f4 d7d5 f4e5 f6e4"],
  ["gambit","d2d4 d7d5 c2c4 e7e5 d4e5 d5d4 g1f3 b8c6"],
  ["sharp", "e2e4 c7c5 g1f3 d7d6 d2d4 c5d4 f3d4 g8f6 b1c3 a7a6 f1e2 e7e5"],
  ["sharp", "e2e4 c7c5 g1f3 d7d6 d2d4 c5d4 f3d4 g8f6 b1c3 g7g6 c1e3 f8g7"],
  ["sharp", "e2e4 c7c5 g1f3 b8c6 d2d4 c5d4 f3d4 g8f6 b1c3 e7e5"],
  ["sharp", "e2e4 d7d5 e4d5 d8d5 b1c3 d5a5 d2d4 g8f6 g1f3 c7c6"],
  ["sharp", "d2d4 g8f6 c2c4 g7g6 b1c3 f8g7 e2e4 d7d6 g1f3 e8g8"],
  ["solid", "d2d4 d7d5 c1f4 g8f6 e2e3 e7e6 g1f3 f8d6 f4d6 c7d6"],
  ["solid", "d2d4 d7d5 c2c4 e7e6 b1c3 g8f6 c1g5 f8e7 e2e3 e8g8"],
  ["solid", "d2d4 d7d5 c2c4 c7c6 g1f3 g8f6 b1c3 d5c4 a2a4 c8f5"],
  ["solid", "e2e4 c7c6 d2d4 d7d5 b1c3 d5e4 c3e4 c8f5 e4g3 f5g6"],
  ["solid", "e2e4 e7e6 d2d4 d7d5 b1c3 g8f6 c1g5 f8e7 e4e5 f6d7"],
  ["solid", "d2d4 g8f6 c2c4 e7e6 b1c3 f8b4 e2e3 e8g8 f1d3 d7d5"],
  ["quiet", "c2c4 e7e5 b1c3 g8f6 g2g3 f8b4 f1g2 e8g8"],
  ["quiet", "d2d4 d7d5 g1f3 g8f6 e2e3 e7e6 f1d3 c7c5"],
  ["quiet", "e2e4 e7e5 g1f3 b8c6 b1c3 g8f6 f1b5 f8b4 e1g1 e8g8"],
  ["quiet", "e2e4 e7e5 g1f3 g8f6 f3e5 d7d6 e5f3 f6e4 d2d4 d6d5"]
];

function bookMove(historyUci, tags) {
  var played = historyUci.length;
  var options = [];
  for (var i = 0; i < BOOK.length; i++) {
    if (tags.indexOf(BOOK[i][0]) < 0) continue;
    var line = BOOK[i][1].split(" ");
    if (line.length <= played) continue;
    var ok = true;
    for (var j = 0; j < played; j++) if (line[j] !== historyUci[j]) { ok = false; break; }
    if (ok) options.push(line[played]);
  }
  if (!options.length) return null;
  return options[(Math.random() * options.length) | 0];
}

/* ---------- the cast ----------
   mat  material  ·  pst positional tables  ·  pawns structure  ·  king own safety
   atk  king tropism (how much it wants to mass on your king)  ·  mob mobility */
var PERSONALITIES = {
  novice: {
    depth: 2, timeMs: 200, blunder: 0.28, temp: 260,
    tags: [], nullMove: false,
    w: { mat: 1.0, pst: 0.30, pawns: 0.0, king: 0.0, atk: 0.5, mob: 0.1, nullMove: false, quiesce: false }
  },
  merchant: {
    depth: 3, timeMs: 350, blunder: 0.07, temp: 95,
    tags: ["quiet", "scotch"], nullMove: false,
    w: { mat: 1.18, pst: 0.45, pawns: 0.25, king: 0.2, atk: 0.1, mob: 0.2, nullMove: false, quiesce: true }
  },
  duelist: {
    depth: 5, timeMs: 700, blunder: 0.02, temp: 52,
    tags: ["gambit", "ital", "scotch"], nullMove: true,
    w: { mat: 0.94, pst: 1.0, pawns: 0.35, king: 0.5, atk: 1.9, mob: 1.1, nullMove: true, quiesce: true }
  },
  architect: {
    depth: 5, timeMs: 900, blunder: 0.005, temp: 32,
    tags: ["solid", "quiet", "ruy"], nullMove: true,
    w: { mat: 1.0, pst: 1.15, pawns: 1.7, king: 1.5, atk: 0.55, mob: 0.9, nullMove: true, quiesce: true }
  },
  trickster: {
    depth: 6, timeMs: 1400, blunder: 0, temp: 30,
    tags: ["sharp", "gambit"], nullMove: true,
    w: { mat: 0.95, pst: 1.0, pawns: 0.85, king: 0.9, atk: 1.5, mob: 1.25, nullMove: true, quiesce: true }
  },
  oracle: {
    depth: 12, timeMs: 2000, blunder: 0, temp: 0,
    tags: ["ital", "ruy", "solid", "sharp", "quiet", "scotch"], nullMove: true,
    w: { mat: 1.0, pst: 1.0, pawns: 1.0, king: 1.0, atk: 0.9, mob: 1.0, nullMove: true, quiesce: true }
  }
};

/* Replay the claimed history from the start and see whether it lands on the
   position we were actually asked about. Guards the book against takebacks,
   custom starts, and any UI desync. */
function historyMatches(historyUci, fen) {
  var p = C.fromFen(C.START_FEN);
  for (var i = 0; i < historyUci.length; i++) {
    var m = C.uciToMove(p, historyUci[i]);
    if (!m) return false;
    C.makeMove(p, m);
  }
  /* Compare placement, side, castling and ep — the clocks are irrelevant here. */
  return C.toFen(p).split(" ").slice(0, 4).join(" ") === String(fen).split(" ").slice(0, 4).join(" ");
}

self.onmessage = function (e) {
  var msg = e.data;
  if (msg.type !== "go") return;
  var p = PERSONALITIES[msg.personality] || PERSONALITIES.oracle;
  W = p.w;

  var pos = C.fromFen(msg.fen);

  /* Book first — it is what stops every game against the same opponent opening
     with the same six moves, and it is free.

     ⚠ The book is indexed by move history, so it must only be trusted when that
     history genuinely produces this position. Replaying it and comparing is cheap
     at fourteen plies, and without the check a stale history returns a move for a
     different position entirely — which still passes a legality test often enough
     to be played. */
  if (msg.history && msg.history.length < 14 && p.tags.length && historyMatches(msg.history, msg.fen)) {
    var bm = bookMove(msg.history, p.tags);
    if (bm) {
      var mv = C.uciToMove(pos, bm);
      if (mv) { self.postMessage({ type: "bestmove", uci: bm, score: 0, depth: 0, nodes: 0, book: true }); return; }
    }
  }

  var t0 = Date.now();
  var res = think(pos, p);
  if (!res) { self.postMessage({ type: "bestmove", uci: null }); return; }
  self.postMessage({
    type: "bestmove", uci: C.moveToUci(res.move), score: res.score,
    depth: res.depth, nodes: res.nodes, ms: Date.now() - t0, book: false
  });
};
