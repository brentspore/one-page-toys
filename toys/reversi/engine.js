/* engine.js — the regulars at the club, in a Worker so a thinking opponent never costs
   the board a frame. If a Worker cannot start, the page loads this same file as a
   script and calls ReversiEngine.think() directly.

   Bitboards: a board side is 64 bits held as two signed 32-bit halves, lo for squares
   0-31 (rows 1-4) and hi for 32-63 (rows 5-8). Square s = y * 8 + x is bit s. Moves
   come from a seven-step fill along each of the eight directions, with the
   opponent's discs masked to the inner six columns for the sideways and diagonal
   directions so nothing wraps from one row to the next. No BigInt anywhere.

   Search: negamax alpha-beta with principal-variation (null-window) search, iterative
   deepening, a transposition table, and move ordering by the table's move, then by
   how few replies a move leaves the other side (fastest-first), then by square value.
   Near the end it solves exactly: with N or fewer empty squares it searches every line
   to the last disc and plays the move with the best final count.

   Evaluation (from the side to move, 100 = one disc): mobility, potential mobility
   (empty squares next to the other side's discs), corners, X-square and C-square
   penalties while the corner is still empty, discs made stable along the edges from
   the corners, the disc count late in the game, and parity (who gets the last move).

   The six regulars differ in depth, how far from the end they can solve, how crude
   their judgement is, and how often they wander off the best move. */
(function (root) {
  "use strict";
  if (!root.ReversiCore && typeof importScripts === "function") importScripts("core.js?v=1");

  var hasPerf = typeof performance !== "undefined" && performance.now;
  function now() { return hasPerf ? performance.now() : Date.now(); }

  function pop(x) {
    x = x - ((x >>> 1) & 0x55555555);
    x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
    x = (x + (x >>> 4)) & 0x0F0F0F0F;
    return Math.imul(x, 0x01010101) >>> 24;
  }

  var INNER = 0x7E7E7E7E | 0;

  /* ---------- move generation ---------- */
  var gL = 0, gH = 0;
  function dirMoves(pL, pH, iL, iH, eL, eH, n) {
    var m = 32 - n, tL, tH;
    /* toward higher squares: s + n */
    tL = (pL << n) & iL; tH = ((pH << n) | (pL >>> m)) & iH;
    tH |= ((tH << n) | (tL >>> m)) & iH; tL |= (tL << n) & iL;
    tH |= ((tH << n) | (tL >>> m)) & iH; tL |= (tL << n) & iL;
    tH |= ((tH << n) | (tL >>> m)) & iH; tL |= (tL << n) & iL;
    tH |= ((tH << n) | (tL >>> m)) & iH; tL |= (tL << n) & iL;
    tH |= ((tH << n) | (tL >>> m)) & iH; tL |= (tL << n) & iL;
    gH |= ((tH << n) | (tL >>> m)) & eH; gL |= (tL << n) & eL;
    /* toward lower squares: s - n */
    tL = ((pL >>> n) | (pH << m)) & iL; tH = (pH >>> n) & iH;
    tL |= ((tL >>> n) | (tH << m)) & iL; tH |= (tH >>> n) & iH;
    tL |= ((tL >>> n) | (tH << m)) & iL; tH |= (tH >>> n) & iH;
    tL |= ((tL >>> n) | (tH << m)) & iL; tH |= (tH >>> n) & iH;
    tL |= ((tL >>> n) | (tH << m)) & iL; tH |= (tH >>> n) & iH;
    tL |= ((tL >>> n) | (tH << m)) & iL; tH |= (tH >>> n) & iH;
    gL |= ((tL >>> n) | (tH << m)) & eL; gH |= (tH >>> n) & eH;
  }
  /* legal moves for P against O, into gL / gH */
  function gen(pL, pH, oL, oH) {
    var eL = ~(pL | oL), eH = ~(pH | oH), iL = oL & INNER, iH = oH & INNER;
    gL = 0; gH = 0;
    dirMoves(pL, pH, iL, iH, eL, eH, 1);
    dirMoves(pL, pH, iL, iH, eL, eH, 7);
    dirMoves(pL, pH, iL, iH, eL, eH, 9);
    dirMoves(pL, pH, oL, oH, eL, eH, 8);
  }

  /* ---------- flips ---------- */
  var fL = 0, fH = 0;
  function dirFlips(bL, bH, pL, pH, iL, iH, n) {
    var m = 32 - n, tL, tH;
    tL = (bL << n) & iL; tH = ((bH << n) | (bL >>> m)) & iH;
    if (tL | tH) {
      tH |= ((tH << n) | (tL >>> m)) & iH; tL |= (tL << n) & iL;
      tH |= ((tH << n) | (tL >>> m)) & iH; tL |= (tL << n) & iL;
      tH |= ((tH << n) | (tL >>> m)) & iH; tL |= (tL << n) & iL;
      tH |= ((tH << n) | (tL >>> m)) & iH; tL |= (tL << n) & iL;
      tH |= ((tH << n) | (tL >>> m)) & iH; tL |= (tL << n) & iL;
      if (((tL << n) & pL) | (((tH << n) | (tL >>> m)) & pH)) { fL |= tL; fH |= tH; }
    }
    tL = ((bL >>> n) | (bH << m)) & iL; tH = (bH >>> n) & iH;
    if (tL | tH) {
      tL |= ((tL >>> n) | (tH << m)) & iL; tH |= (tH >>> n) & iH;
      tL |= ((tL >>> n) | (tH << m)) & iL; tH |= (tH >>> n) & iH;
      tL |= ((tL >>> n) | (tH << m)) & iL; tH |= (tH >>> n) & iH;
      tL |= ((tL >>> n) | (tH << m)) & iL; tH |= (tH >>> n) & iH;
      tL |= ((tL >>> n) | (tH << m)) & iL; tH |= (tH >>> n) & iH;
      if ((((tL >>> n) | (tH << m)) & pL) | ((tH >>> n) & pH)) { fL |= tL; fH |= tH; }
    }
  }
  /* the discs P turns over by playing s, into fL / fH (empty if s is not legal) */
  function flips(pL, pH, oL, oH, s) {
    var bL = s < 32 ? (1 << s) : 0, bH = s < 32 ? 0 : (1 << (s - 32));
    var iL = oL & INNER, iH = oH & INNER;
    fL = 0; fH = 0;
    dirFlips(bL, bH, pL, pH, iL, iH, 1);
    dirFlips(bL, bH, pL, pH, iL, iH, 7);
    dirFlips(bL, bH, pL, pH, iL, iH, 9);
    dirFlips(bL, bH, pL, pH, oL, oH, 8);
  }

  /* all squares next to X, into aL / aH */
  var aL = 0, aH = 0;
  var NOT_A = 0xFEFEFEFE | 0, NOT_H = 0x7F7F7F7F;
  function adjacent(xL, xH) {
    var rL, rH;
    rL = (xL << 1) & NOT_A; rH = ((xH << 1) | (xL >>> 31)) & NOT_A;              /* east */
    rL |= ((xL >>> 1) | (xH << 31)) & NOT_H; rH |= (xH >>> 1) & NOT_H;           /* west */
    rL |= xL << 8; rH |= (xH << 8) | (xL >>> 24);                                /* south */
    rL |= (xL >>> 8) | (xH << 24); rH |= xH >>> 8;                               /* north */
    rL |= (xL << 9) & NOT_A; rH |= ((xH << 9) | (xL >>> 23)) & NOT_A;             /* south-east */
    rL |= (xL << 7) & NOT_H; rH |= ((xH << 7) | (xL >>> 25)) & NOT_H;             /* south-west */
    rL |= ((xL >>> 7) | (xH << 25)) & NOT_A; rH |= (xH >>> 7) & NOT_A;           /* north-east */
    rL |= ((xL >>> 9) | (xH << 23)) & NOT_H; rH |= (xH >>> 9) & NOT_H;           /* north-west */
    aL = rL; aH = rH;
  }

  function bitOf(L, H, s) { return s < 32 ? (L >>> s) & 1 : (H >>> (s - 32)) & 1; }

  /* ---------- static tables ---------- */
  /* the classic square values: corners gold, the squares next to them poison */
  var SQT = [
    100, -25, 10, 5, 5, 10, -25, 100,
    -25, -45, -2, -2, -2, -2, -45, -25,
    10, -2, 1, 1, 1, 1, -2, 10,
    5, -2, 1, 0, 0, 1, -2, 5,
    5, -2, 1, 0, 0, 1, -2, 5,
    10, -2, 1, 1, 1, 1, -2, 10,
    -25, -45, -2, -2, -2, -2, -45, -25,
    100, -25, 10, 5, 5, 10, -25, 100];
  /* the porter's: every edge square is a good square, corners best, little else */
  var NAIVE = [
    60, 20, 20, 20, 20, 20, 20, 60,
    20, -8, 0, 0, 0, 0, -8, 20,
    20, 0, 1, 1, 1, 1, 0, 20,
    20, 0, 1, 2, 2, 1, 0, 20,
    20, 0, 1, 2, 2, 1, 0, 20,
    20, 0, 1, 1, 1, 1, 0, 20,
    20, -8, 0, 0, 0, 0, -8, 20,
    60, 20, 20, 20, 20, 20, 20, 60];
  /* row lookups: ROW_x[r * 256 + byte] = the table's sum over that row's set bits */
  function rowTable(T) {
    var out = new Int32Array(8 * 256);
    for (var r = 0; r < 8; r++) for (var v = 0; v < 256; v++) {
      var s = 0;
      for (var i = 0; i < 8; i++) if (v & (1 << i)) s += T[r * 8 + i];
      out[r * 256 + v] = s;
    }
    return out;
  }
  var ROW_SQT = rowTable(SQT), ROW_NAIVE = rowTable(NAIVE);
  function tableSum(R, L, H) {
    return R[L & 255] + R[256 + ((L >>> 8) & 255)] + R[512 + ((L >>> 16) & 255)] + R[768 + (L >>> 24)] +
      R[1024 + (H & 255)] + R[1280 + ((H >>> 8) & 255)] + R[1536 + ((H >>> 16) & 255)] + R[1792 + (H >>> 24)];
  }

  /* Edge stability: EDGE[(p << 8) | o] for one edge read as an 8-square line = (discs P
     holds that can never turn) minus (the same for O). A disc is counted stable if it
     sits in an unbroken run of its color from an occupied corner, or the line is full. */
  var EDGE = new Int8Array(65536);
  (function () {
    for (var p = 0; p < 256; p++) for (var o = 0; o < 256; o++) {
      if (p & o) continue;
      var c = [], full = true;
      for (var i = 0; i < 8; i++) { c.push(p & (1 << i) ? 1 : o & (1 << i) ? 2 : 0); if (!c[i]) full = false; }
      var st = [0, 0, 0];
      if (full) { for (var j = 0; j < 8; j++) st[c[j]]++; }
      else {
        if (c[0]) { var k = 0; while (k < 8 && c[k] === c[0]) { st[c[0]]++; k++; } }
        if (c[7]) { var q = 7; while (q >= 0 && c[q] === c[7]) { st[c[7]]++; q--; } }
      }
      EDGE[(p << 8) | o] = st[1] - st[2];
    }
  })();
  function colByte(L, H, sh) {
    var lo = (Math.imul((L >>> sh) & 0x01010101, 0x08040201) >>> 24) & 15;
    var hi = (Math.imul((H >>> sh) & 0x01010101, 0x08040201) >>> 24) & 15;
    return (lo << 4) | hi;
  }
  function edgeScore(pL, pH, oL, oH) {
    return EDGE[((pL & 255) << 8) | (oL & 255)] + EDGE[((pH >>> 24) << 8) | (oH >>> 24)] +
      EDGE[(colByte(pL, pH, 0) << 8) | colByte(oL, oH, 0)] + EDGE[(colByte(pL, pH, 7) << 8) | colByte(oL, oH, 7)];
  }

  /* corners, and the X and C squares beside each */
  var CORNERS = [0, 7, 56, 63], XSQ = [9, 14, 49, 54], CSQ = [[1, 8], [6, 15], [48, 57], [55, 62]];
  var CORNER_L = 0x81, CORNER_H = 0x81000000 | 0;

  /* ---------- evaluation ---------- */
  var W = null;            /* the weights of whoever is thinking */
  var WIN = 10000;
  function evalNode(pL, pH, oL, oH, mobP) {
    var kind = W.ev, v = 0;
    var dP = pop(pL) + pop(pH), dO = pop(oL) + pop(oH), empties = 64 - dP - dO;
    if (kind === "naive") {
      v = (tableSum(ROW_NAIVE, pL, pH) - tableSum(ROW_NAIVE, oL, oH)) * 10 + (dP - dO) * 30;
    } else if (kind === "table") {
      gen(oL, oH, pL, pH);
      var mobO0 = pop(gL) + pop(gH);
      v = (tableSum(ROW_SQT, pL, pH) - tableSum(ROW_SQT, oL, oH)) * 8 + (mobP - mobO0) * 45;
      if (empties < 12) v += (dP - dO) * 40;
    } else {
      gen(oL, oH, pL, pH);
      var mobO = pop(gL) + pop(gH);
      var e1 = ~(pL | oL), e2 = ~(pH | oH);
      adjacent(oL, oH); var potP = pop(aL & e1) + pop(aH & e2);
      adjacent(pL, pH); var potO = pop(aL & e1) + pop(aH & e2);
      var cP = pop(pL & CORNER_L) + pop(pH & CORNER_H), cO = pop(oL & CORNER_L) + pop(oH & CORNER_H);
      var xs = 0, cs = 0;
      for (var i = 0; i < 4; i++) {
        var cn = CORNERS[i];
        if (bitOf(pL, pH, cn) | bitOf(oL, oH, cn)) continue;
        var x = XSQ[i];
        xs += bitOf(pL, pH, x) - bitOf(oL, oH, x);
        var c2 = CSQ[i];
        cs += bitOf(pL, pH, c2[0]) - bitOf(oL, oH, c2[0]) + bitOf(pL, pH, c2[1]) - bitOf(oL, oH, c2[1]);
      }
      var phase = empties / 60;
      /* mobility as a share, so 2 against 1 and 12 against 11 are not the same */
      v = W.mob * (mobP - mobO) * 10 / (mobP + mobO + 2) +
        W.pot * (potP - potO) +
        W.corner * (cP - cO) -
        W.x * xs - W.c * cs +
        W.edge * edgeScore(pL, pH, oL, oH) +
        W.disc * (1 - phase) * (1 - phase) * (dP - dO);
      if (empties < 18) v += (empties & 1) ? W.parity : -W.parity;
    }
    if (W.noise) v += ((rnd() * 2 - 1) * W.noise) | 0;
    return v > 9500 ? 9500 : v < -9500 ? -9500 : v | 0;
  }
  function final(pL, pH, oL, oH) {
    var d = pop(pL) + pop(pH) - pop(oL) - pop(oH);
    return d > 0 ? WIN + d * 100 : d < 0 ? -WIN + d * 100 : 0;
  }

  /* ---------- random (seedable, for tests) ---------- */
  var rs = (Math.random() * 4294967296) >>> 0;
  function rnd() { rs ^= rs << 13; rs ^= rs >>> 17; rs ^= rs << 5; return (rs >>> 0) / 4294967296; }
  function seedRandom(s) { rs = (s >>> 0) || 1; }

  /* ---------- transposition table ---------- */
  var TT_BITS = 18, TT_SIZE = 1 << TT_BITS, TT_MASK = TT_SIZE - 1;
  var ttK = new Int32Array(TT_SIZE), ttS = new Int32Array(TT_SIZE), ttI = new Int32Array(TT_SIZE), ttG = new Int32Array(TT_SIZE);
  var curGen = 1;
  var EXACT = 0, LOWER = 1, UPPER = 2;
  function hashA(pL, pH, oL, oH) {
    var h = Math.imul(pL ^ 0x2545F491, 0x9E3779B1);
    h = Math.imul(h ^ (h >>> 15) ^ pH, 0x85EBCA77);
    h = Math.imul(h ^ (h >>> 13) ^ oL, 0xC2B2AE3D);
    h = Math.imul(h ^ (h >>> 16) ^ oH, 0x27D4EB2F);
    return h ^ (h >>> 15);
  }
  function hashB(pL, pH, oL, oH) {
    var h = Math.imul(oH ^ 0x6A09E667, 0x165667B1);
    h = Math.imul(h ^ (h >>> 13) ^ oL, 0xD3A2646C | 1);
    h = Math.imul(h ^ (h >>> 15) ^ pH, 0xFD7046C5);
    h = Math.imul(h ^ (h >>> 16) ^ pL, 0xB55A4F09);
    return h ^ (h >>> 16);
  }

  /* ---------- search ---------- */
  var nodes = 0, stop = false, deadline = Infinity;
  var MV = new Int8Array(66 * 34), OS = new Int32Array(66 * 34), FLL = new Int32Array(66 * 34), FLH = new Int32Array(66 * 34);

  function search(pL, pH, oL, oH, depth, alpha, beta, ply) {
    nodes++;
    if ((nodes & 1023) === 0 && now() > deadline) stop = true;
    if (stop) return 0;
    gen(pL, pH, oL, oH);
    var mL = gL, mH = gH;
    if (!(mL | mH)) {
      gen(oL, oH, pL, pH);
      if (!(gL | gH)) return final(pL, pH, oL, oH);
      return -search(oL, oH, pL, pH, depth, -beta, -alpha, ply + 1);
    }
    if (depth <= 0) return evalNode(pL, pH, oL, oH, pop(mL) + pop(mH));

    var idx = hashA(pL, pH, oL, oH) & TT_MASK, key = hashB(pL, pH, oL, oH), ttMove = 64;
    if (ttG[idx] === curGen && ttK[idx] === key) {
      var inf = ttI[idx], d = inf & 63, fl = (inf >> 6) & 3, tv = ttS[idx];
      ttMove = (inf >> 8) & 127;
      if (d >= depth) {
        if (fl === EXACT) return tv;
        if (fl === LOWER && tv >= beta) return tv;
        if (fl === UPPER && tv <= alpha) return tv;
      }
    }

    var base = ply * 34, n = 0, s, bit;
    while (mL) { bit = mL & -mL; s = 31 - Math.clz32(bit); mL ^= bit; MV[base + n++] = s; }
    while (mH) { bit = mH & -mH; s = 63 - Math.clz32(bit); mH ^= bit; MV[base + n++] = s; }
    var deep = depth >= 3;
    for (var i = 0; i < n; i++) {
      s = MV[base + i];
      flips(pL, pH, oL, oH, s);
      FLL[base + i] = fL; FLH[base + i] = fH;
      var sc;
      if (s === ttMove) sc = 1 << 30;
      else if (deep) {
        var bL = s < 32 ? (1 << s) : 0, bH = s < 32 ? 0 : (1 << (s - 32));
        gen(oL & ~fL, oH & ~fH, pL | fL | bL, pH | fH | bH);
        sc = SQT[s] * 4 - (pop(gL) + pop(gH)) * 100;
      } else sc = SQT[s];
      OS[base + i] = sc;
    }
    /* insertion sort, best first */
    for (var a = 1; a < n; a++) {
      var ms = MV[base + a], mo = OS[base + a], ml = FLL[base + a], mh = FLH[base + a], j = a - 1;
      while (j >= 0 && OS[base + j] < mo) {
        MV[base + j + 1] = MV[base + j]; OS[base + j + 1] = OS[base + j]; FLL[base + j + 1] = FLL[base + j]; FLH[base + j + 1] = FLH[base + j]; j--;
      }
      MV[base + j + 1] = ms; OS[base + j + 1] = mo; FLL[base + j + 1] = ml; FLH[base + j + 1] = mh;
    }

    var best = -100000, bestMove = 64, a0 = alpha;
    for (var k = 0; k < n; k++) {
      s = MV[base + k];
      var xL = FLL[base + k], xH = FLH[base + k];
      var sL = s < 32 ? (1 << s) : 0, sH = s < 32 ? 0 : (1 << (s - 32));
      var nPL = pL | xL | sL, nPH = pH | xH | sH, nOL = oL & ~xL, nOH = oH & ~xH;
      var v;
      if (k === 0) v = -search(nOL, nOH, nPL, nPH, depth - 1, -beta, -alpha, ply + 1);
      else {
        v = -search(nOL, nOH, nPL, nPH, depth - 1, -alpha - 1, -alpha, ply + 1);
        if (v > alpha && v < beta && !stop) v = -search(nOL, nOH, nPL, nPH, depth - 1, -beta, -alpha, ply + 1);
      }
      if (stop) return 0;
      if (v > best) {
        best = v; bestMove = s;
        if (v > alpha) { alpha = v; if (alpha >= beta) break; }
      }
    }
    ttG[idx] = curGen; ttK[idx] = key; ttS[idx] = best;
    ttI[idx] = (depth > 63 ? 63 : depth) | ((best <= a0 ? UPPER : best >= beta ? LOWER : EXACT) << 6) | (bestMove << 8);
    return best;
  }

  /* One child of the root, as boards from the other side's point of view. */
  function child(pL, pH, oL, oH, s) {
    flips(pL, pH, oL, oH, s);
    var sL = s < 32 ? (1 << s) : 0, sH = s < 32 ? 0 : (1 << (s - 32));
    return [oL & ~fL, oH & ~fH, pL | fL | sL, pH | fH | sH, pop(fL) + pop(fH)];
  }

  /* Full-window score of every root move at a depth (for the regulars who pick with a
     little chance, and for variety in the opening). Returns null if time ran out. */
  function rootScores(pos, moves, depth) {
    var out = [];
    for (var i = 0; i < moves.length; i++) {
      var c = moves[i].c;
      var v = -search(c[0], c[1], c[2], c[3], depth - 1, -100000, 100000, 1);
      if (stop) return null;
      out.push(v);
    }
    return out;
  }

  /* principal-variation search at the root; moves come in best-guess order */
  function rootPVS(moves, depth) {
    var alpha = -100000, beta = 100000, best = -1, bestV = -100000;
    for (var i = 0; i < moves.length; i++) {
      var c = moves[i].c, v;
      if (i === 0) v = -search(c[0], c[1], c[2], c[3], depth - 1, -beta, -alpha, 1);
      else {
        v = -search(c[0], c[1], c[2], c[3], depth - 1, -alpha - 1, -alpha, 1);
        if (v > alpha && !stop) v = -search(c[0], c[1], c[2], c[3], depth - 1, -beta, -alpha, 1);
      }
      if (stop) return null;
      moves[i].v = v;
      if (v > bestV) { bestV = v; best = i; if (v > alpha) alpha = v; }
    }
    return { i: best, v: bestV };
  }

  /* ---------- the regulars ----------
     ev: how they judge a position. depth: how far they look. solve: from how many empty
     squares they read the ending out exactly. temp: how freely they choose among
     moves that look close (in hundredths of a disc). slip: the chance of playing a
     merely decent move instead of the best. ms: a time budget per move. */
  var BASE = { mob: 75, pot: 28, corner: 720, x: 260, c: 85, edge: 95, disc: 60, parity: 70 };
  function weights(extra) { var o = {}, k; for (k in BASE) o[k] = BASE[k]; for (k in extra) o[k] = extra[k]; return o; }
  var P = {
    /* Alfie, the page boy: grabs whatever turns the most discs, and corners when he sees them */
    alfie: { kind: "greedy", corner: 220, temp: 90, slip: 0 },
    /* Mr. Dobbs, the hall porter: two moves deep, and every edge looks like a good edge */
    dobbs: weights({ ev: "naive", depth: 2, solve: 0, temp: 70, slip: 0.1, gap: 500, ms: 400 }),
    /* Mrs. Marlowe: square values and a feel for mobility, two deep, reads the last 8 */
    marlowe: weights({ ev: "table", depth: 2, solve: 8, temp: 45, slip: 0.08, gap: 400, ms: 500 }),
    /* Captain Hale: the real judgement, four deep, reads the last 10 */
    hale: weights({ ev: "full", depth: 4, solve: 10, temp: 0, slip: 0.04, gap: 300, ms: 700, open: 6, openGap: 120, noise: 40 }),
    /* Dr. Pembroke: five deep, reads the last 12 */
    pembroke: weights({ ev: "full", depth: 5, solve: 12, temp: 0, slip: 0, gap: 0, ms: 1000, open: 6, openGap: 80 }),
    /* Mr. Desai, the champion: six deep, reads the last 14, a time budget for slow phones */
    desai: weights({ ev: "full", depth: 6, solve: 14, temp: 0, slip: 0, gap: 0, ms: 1200, solveMs: 1600, open: 4, openGap: 60 })
  };

  function toBits(b, color) {
    var pL = 0, pH = 0, oL = 0, oH = 0;
    for (var s = 0; s < 64; s++) {
      var v = b[s];
      if (!v) continue;
      if (s < 32) { if (v === color) pL |= 1 << s; else oL |= 1 << s; }
      else { if (v === color) pH |= 1 << (s - 32); else oH |= 1 << (s - 32); }
    }
    return [pL, pH, oL, oH];
  }

  function softPick(scores, temp) {
    var mx = -Infinity, i;
    for (i = 0; i < scores.length; i++) if (scores[i] > mx) mx = scores[i];
    var w = [], sum = 0;
    for (i = 0; i < scores.length; i++) { var e = Math.exp((scores[i] - mx) / temp); w.push(e); sum += e; }
    var r = rnd() * sum;
    for (i = 0; i < w.length; i++) { r -= w[i]; if (r <= 0) return i; }
    return w.length - 1;
  }
  function argmaxRandomTie(scores) {
    var mx = -Infinity, list = [];
    for (var i = 0; i < scores.length; i++) {
      if (scores[i] > mx) { mx = scores[i]; list = [i]; } else if (scores[i] === mx) list.push(i);
    }
    return list[(rnd() * list.length) | 0];
  }
  /* a merely decent move: any but the best whose score is within gap of it */
  function slipPick(scores, best, gap) {
    var list = [];
    for (var i = 0; i < scores.length; i++) if (i !== best && scores[i] >= scores[best] - gap) list.push(i);
    return list.length ? list[(rnd() * list.length) | 0] : best;
  }

  /* think: msg = { b: 64 squares, turn: 1|2, who: id, moveNum, nodeLimit? }
     returns { move, score, depth, nodes, ms, solved } */
  function think(msg) {
    var t0 = now();
    var prm = P[msg.who] || P.hale;
    W = prm;
    curGen = (curGen + 1) & 0x3fffffff || 1;
    nodes = 0; stop = false;
    var bits = toBits(msg.b, msg.turn), pL = bits[0], pH = bits[1], oL = bits[2], oH = bits[3];
    gen(pL, pH, oL, oH);
    var mL = gL, mH = gH, list = [], s, bit;
    while (mL) { bit = mL & -mL; s = 31 - Math.clz32(bit); mL ^= bit; list.push(s); }
    while (mH) { bit = mH & -mH; s = 63 - Math.clz32(bit); mH ^= bit; list.push(s); }
    if (!list.length) return { move: -1, score: 0, depth: 0, nodes: 0, ms: 0 };
    var empties = 64 - pop(pL) - pop(pH) - pop(oL) - pop(oH);
    var moves = list.map(function (q) { return { s: q, c: child(pL, pH, oL, oH, q), v: 0 }; });
    function done(i, v, depth, solved) {
      return { move: moves[i].s, score: v, depth: depth, nodes: nodes, ms: Math.round(now() - t0), solved: !!solved, n: moves.length };
    }
    if (moves.length === 1) return done(0, 0, 0, false);

    if (prm.kind === "greedy") {
      var gs = moves.map(function (m) {
        var corner = CORNERS.indexOf(m.s) >= 0 ? prm.corner : 0;
        return m.c[4] * 100 + corner + (rnd() - 0.5) * 60;
      });
      return done(softPick(gs, prm.temp), 0, 1, false);
    }

    var budget = prm.ms || 800;
    /* the end: read it out exactly */
    if (prm.solve && empties <= prm.solve) {
      deadline = t0 + (prm.solveMs || budget * 1.4);
      var sc = rootScores(null, moves, empties);
      if (sc) {
        var bi = argmaxRandomTie(sc);
        if (prm.slip && rnd() < prm.slip) bi = slipPick(sc, bi, prm.gap);
        return done(bi, sc[bi], empties, true);
      }
      stop = false;
    }
    deadline = t0 + budget;

    /* the lower regulars score every move at their depth and pick with a little chance */
    if (prm.temp > 0) {
      var d0 = Math.min(prm.depth, empties);
      var sc2 = rootScores(null, moves, d0);
      if (!sc2) { stop = false; deadline = Infinity; sc2 = rootScores(null, moves, 1); }
      var pi = softPick(sc2, prm.temp);
      if (prm.slip && rnd() < prm.slip) pi = slipPick(sc2, argmaxRandomTie(sc2), prm.gap);
      return done(pi, sc2[pi], d0, false);
    }

    /* the stronger ones: in the first few moves, any move close to the best (a little
       variety, so no two games open alike) */
    if (prm.open && (msg.moveNum || 0) < prm.open) {
      var sc3 = rootScores(null, moves, Math.min(4, prm.depth));
      if (sc3) {
        var bst = argmaxRandomTie(sc3), near = [];
        for (var q = 0; q < sc3.length; q++) if (sc3[q] >= sc3[bst] - prm.openGap) near.push(q);
        var oi = near[(rnd() * near.length) | 0];
        return done(oi, sc3[oi], Math.min(4, prm.depth), false);
      }
      stop = false;
    }

    /* iterative deepening */
    var best = { i: 0, v: 0 }, reached = 0, tID = now();
    for (var d = 1; d <= prm.depth && d <= empties; d++) {
      /* the first two depths always finish, so even a slow phone gets a sensible move */
      deadline = d <= 2 ? Infinity : tID + budget;
      var r = rootPVS(moves, d);
      if (!r) break;
      best = r; reached = d;
      /* the best move first next time, then the rest by this depth's scores */
      var top = moves[r.i];
      moves.sort(function (x, y) { return x === top ? -1 : y === top ? 1 : y.v - x.v; });
      best.i = 0;
      if (now() - tID > budget * 0.4) break;
    }
    if (prm.slip && rnd() < prm.slip && reached >= 2) {
      var sc4 = moves.map(function (m) { return m.v; });
      best.i = slipPick(sc4, 0, prm.gap);
    }
    return done(best.i, moves[best.i].v, reached, false);
  }

  /* ---------- verification helpers ---------- */
  /* perft: a forced pass counts as one ply. A finished game (neither side can move)
     counts as one leaf wherever it ends (mode "end") or not at all unless the depth is
     used up (mode "strict"). */
  function perft(pL, pH, oL, oH, depth, mode) {
    if (depth === 0) return 1;
    gen(pL, pH, oL, oH);
    var mL = gL, mH = gH;
    if (!(mL | mH)) {
      gen(oL, oH, pL, pH);
      if (!(gL | gH)) return mode === "end" ? 1 : 0;
      return perft(oL, oH, pL, pH, depth - 1, mode);
    }
    if (depth === 1) return pop(mL) + pop(mH);
    var n = 0, s, bit;
    while (mL) { bit = mL & -mL; s = 31 - Math.clz32(bit); mL ^= bit; n += perftChild(pL, pH, oL, oH, s, depth, mode); }
    while (mH) { bit = mH & -mH; s = 63 - Math.clz32(bit); mH ^= bit; n += perftChild(pL, pH, oL, oH, s, depth, mode); }
    return n;
  }
  function perftChild(pL, pH, oL, oH, s, depth, mode) {
    flips(pL, pH, oL, oH, s);
    var sL = s < 32 ? (1 << s) : 0, sH = s < 32 ? 0 : (1 << (s - 32));
    return perft(oL & ~fL, oH & ~fH, pL | fL | sL, pH | fH | sH, depth - 1, mode);
  }
  /* the legal moves and resulting board, from a 64-square array, for cross-checks */
  function movesAndResults(b, color) {
    var bits = toBits(b, color), out = [];
    gen(bits[0], bits[1], bits[2], bits[3]);
    for (var s = 0; s < 64; s++) {
      if (!bitOf(gL, gH, s)) continue;
      var c = child(bits[0], bits[1], bits[2], bits[3], s), nb = new Uint8Array(64);
      for (var q = 0; q < 64; q++) nb[q] = bitOf(c[2], c[3], q) ? color : bitOf(c[0], c[1], q) ? 3 - color : 0;
      out.push({ s: s, b: nb });
      gen(bits[0], bits[1], bits[2], bits[3]);
    }
    return out;
  }
  function bench(msg) {
    var b = msg.b, color = msg.turn || 1, bits = toBits(b, color);
    W = P[msg.who || "desai"];
    curGen++; nodes = 0; stop = false; deadline = Infinity;
    var t0 = now();
    search(bits[0], bits[1], bits[2], bits[3], msg.depth || 7, -100000, 100000, 0);
    var ms = now() - t0;
    return { nodes: nodes, ms: ms, perSec: Math.round(nodes / (ms / 1000)) };
  }

  var api = { P: P, think: think, perft: perft, toBits: toBits, movesAndResults: movesAndResults, bench: bench,
    seedRandom: seedRandom, WIN: WIN };
  root.ReversiEngine = api;

  if (typeof self !== "undefined" && typeof importScripts === "function" && typeof window === "undefined") {
    self.onmessage = function (e) {
      var d = e.data, res = null, err = null;
      try {
        if (d.type === "think") res = think(d);
        else if (d.type === "bench") res = bench(d);
      } catch (x) { err = String(x && x.message || x); }
      self.postMessage({ type: d.type, id: d.id, res: res, error: err });
    };
  }
})(typeof self !== "undefined" ? self : this);
