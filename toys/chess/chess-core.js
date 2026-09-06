/* chess-core.js — the rules, shared verbatim by the UI thread and the search worker.
   Loaded with <script> in the page and importScripts() in the worker, so there is
   exactly one move generator on the site and the board can never disagree with the
   engine about what is legal.

   Board is 0x88: a square is (rank << 4) | file, which makes the off-board test a
   single mask — (sq & 0x88) is non-zero exactly when the square has fallen off the
   edge. a1 = 0, h1 = 7, a8 = 112, h8 = 119; white pawns move +16. */
(function (root) {
  "use strict";

  /* ---------- pieces ---------- */
  var EMPTY = 0;
  var PAWN = 1, KNIGHT = 2, BISHOP = 3, ROOK = 4, QUEEN = 5, KING = 6;
  var WHITE = 8, BLACK = 16;
  var TYPE = 7, COLOR = 24;

  var SQUARES = [];
  for (var r = 0; r < 8; r++) for (var f = 0; f < 8; f++) SQUARES.push((r << 4) | f);

  function rankOf(sq) { return sq >> 4; }
  function fileOf(sq) { return sq & 7; }
  function sq88(file, rank) { return (rank << 4) | file; }
  function onBoard(sq) { return (sq & 0x88) === 0; }
  function algebraic(sq) { return "abcdefgh"[fileOf(sq)] + (rankOf(sq) + 1); }
  function fromAlgebraic(s) { return sq88("abcdefgh".indexOf(s[0]), parseInt(s[1], 10) - 1); }

  /* ---------- move packing ----------
     One 32-bit int per move so the search never allocates: from and to need 7 bits
     each (0-119), the captured piece 5 (codes run to 22), promotion 3, flags 3. */
  var FROM_MASK = 0x7f, TO_SHIFT = 7, CAP_SHIFT = 14, PROMO_SHIFT = 19, FLAG_SHIFT = 22;
  var F_EP = 1, F_CASTLE = 2, F_DOUBLE = 4;

  function mk(from, to, cap, promo, flags) {
    return from | (to << TO_SHIFT) | (cap << CAP_SHIFT) | (promo << PROMO_SHIFT) | (flags << FLAG_SHIFT);
  }
  function mFrom(m) { return m & FROM_MASK; }
  function mTo(m) { return (m >> TO_SHIFT) & 0x7f; }
  function mCap(m) { return (m >> CAP_SHIFT) & 0x1f; }
  function mPromo(m) { return (m >> PROMO_SHIFT) & 7; }
  function mFlags(m) { return (m >> FLAG_SHIFT) & 7; }

  /* ---------- offsets ---------- */
  var KNIGHT_OFF = [-33, -31, -18, -14, 14, 18, 31, 33];
  var BISHOP_OFF = [-17, -15, 15, 17];
  var ROOK_OFF = [-16, -1, 1, 16];
  var KING_OFF = [-17, -16, -15, -1, 1, 15, 16, 17];

  /* Castling rights are recomputed by masking on both the from and the to square,
     which handles "rook captured on its home square" without a special case. */
  var WK = 1, WQ = 2, BK = 4, BQ = 8;
  var CASTLE_MASK = new Int32Array(128);
  for (var i = 0; i < 128; i++) CASTLE_MASK[i] = 15;
  CASTLE_MASK[0x04] = 15 & ~(WK | WQ);   /* e1 */
  CASTLE_MASK[0x00] = 15 & ~WQ;          /* a1 */
  CASTLE_MASK[0x07] = 15 & ~WK;          /* h1 */
  CASTLE_MASK[0x74] = 15 & ~(BK | BQ);   /* e8 */
  CASTLE_MASK[0x70] = 15 & ~BQ;          /* a8 */
  CASTLE_MASK[0x77] = 15 & ~BK;          /* h8 */

  /* ---------- zobrist ----------
     Seeded so both threads derive identical keys; the opening book and the
     transposition table both depend on that agreement. Kept as two 32-bit halves
     because JS bitwise ops are 32-bit and BigInt is far too slow in the hot loop. */
  var seed = 0x9e3779b9;
  function rnd32() {
    seed ^= seed << 13; seed |= 0;
    seed ^= seed >>> 17;
    seed ^= seed << 5; seed |= 0;
    return seed | 0;
  }
  var zpLo = new Int32Array(23 * 128), zpHi = new Int32Array(23 * 128);
  for (var z = 0; z < 23 * 128; z++) { zpLo[z] = rnd32(); zpHi[z] = rnd32(); }
  var zSideLo = rnd32(), zSideHi = rnd32();
  var zCastLo = new Int32Array(16), zCastHi = new Int32Array(16);
  for (var c = 0; c < 16; c++) { zCastLo[c] = rnd32(); zCastHi[c] = rnd32(); }
  var zEpLo = new Int32Array(8), zEpHi = new Int32Array(8);
  for (var e = 0; e < 8; e++) { zEpLo[e] = rnd32(); zEpHi[e] = rnd32(); }

  function hashPos(pos) {
    var lo = 0, hi = 0;
    for (var i = 0; i < 64; i++) {
      var sq = SQUARES[i], pc = pos.board[sq];
      if (pc) { var k = pc * 128 + sq; lo ^= zpLo[k]; hi ^= zpHi[k]; }
    }
    if (pos.turn === BLACK) { lo ^= zSideLo; hi ^= zSideHi; }
    lo ^= zCastLo[pos.castling]; hi ^= zCastHi[pos.castling];
    if (pos.ep >= 0) { lo ^= zEpLo[fileOf(pos.ep)]; hi ^= zEpHi[fileOf(pos.ep)]; }
    pos.hashLo = lo; pos.hashHi = hi;
  }

  /* ---------- position ---------- */
  var START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

  function fromFen(fen) {
    var pos = {
      board: new Int32Array(128),
      turn: WHITE, castling: 15, ep: -1, half: 0, full: 1,
      kings: [0, 0],            /* [white, black] */
      undo: [], hist: [],
      hashLo: 0, hashHi: 0
    };
    var parts = (fen || START_FEN).trim().split(/\s+/);
    var rows = parts[0].split("/");
    for (var r = 0; r < 8; r++) {
      var row = rows[7 - r], file = 0;
      for (var i = 0; i < row.length; i++) {
        var ch = row[i];
        if (ch >= "1" && ch <= "8") { file += +ch; continue; }
        var color = ch === ch.toUpperCase() ? WHITE : BLACK;
        var t = { p: PAWN, n: KNIGHT, b: BISHOP, r: ROOK, q: QUEEN, k: KING }[ch.toLowerCase()];
        var sq = sq88(file, r);
        pos.board[sq] = color | t;
        if (t === KING) pos.kings[color === WHITE ? 0 : 1] = sq;
        file++;
      }
    }
    pos.turn = parts[1] === "b" ? BLACK : WHITE;
    pos.castling = 0;
    if (parts[2] && parts[2] !== "-") {
      if (parts[2].indexOf("K") >= 0) pos.castling |= WK;
      if (parts[2].indexOf("Q") >= 0) pos.castling |= WQ;
      if (parts[2].indexOf("k") >= 0) pos.castling |= BK;
      if (parts[2].indexOf("q") >= 0) pos.castling |= BQ;
    }
    pos.ep = parts[3] && parts[3] !== "-" ? fromAlgebraic(parts[3]) : -1;
    pos.half = parts[4] ? +parts[4] : 0;
    pos.full = parts[5] ? +parts[5] : 1;
    hashPos(pos);
    pos.hist.push(pos.hashLo);
    return pos;
  }

  function toFen(pos) {
    var out = "";
    for (var r = 7; r >= 0; r--) {
      var run = 0;
      for (var f = 0; f < 8; f++) {
        var pc = pos.board[sq88(f, r)];
        if (!pc) { run++; continue; }
        if (run) { out += run; run = 0; }
        var ch = " pnbrqk"[pc & TYPE];
        out += (pc & COLOR) === WHITE ? ch.toUpperCase() : ch;
      }
      if (run) out += run;
      if (r) out += "/";
    }
    var cast = ((pos.castling & WK) ? "K" : "") + ((pos.castling & WQ) ? "Q" : "") +
               ((pos.castling & BK) ? "k" : "") + ((pos.castling & BQ) ? "q" : "");
    return out + " " + (pos.turn === WHITE ? "w" : "b") + " " + (cast || "-") + " " +
      (pos.ep >= 0 ? algebraic(pos.ep) : "-") + " " + pos.half + " " + pos.full;
  }

  function clone(pos) {
    var n = {
      board: new Int32Array(pos.board), turn: pos.turn, castling: pos.castling,
      ep: pos.ep, half: pos.half, full: pos.full, kings: pos.kings.slice(),
      undo: [], hist: pos.hist.slice(), hashLo: pos.hashLo, hashHi: pos.hashHi
    };
    return n;
  }

  /* ---------- attack detection ----------
     Used for legality (is my king attacked after this move) and for king safety in
     the evaluation, so it is on the hottest path in the whole engine. */
  function isAttacked(pos, sq, byColor) {
    var b = pos.board, i, off, s, pc;

    /* pawns: step back along the capture diagonals of the attacking colour */
    var pd = byColor === WHITE ? -16 : 16;
    for (i = -1; i <= 1; i += 2) {
      s = sq + pd + i;
      if (onBoard(s) && b[s] === (byColor | PAWN)) return true;
    }
    for (i = 0; i < 8; i++) {
      s = sq + KNIGHT_OFF[i];
      if (onBoard(s) && b[s] === (byColor | KNIGHT)) return true;
    }
    for (i = 0; i < 8; i++) {
      s = sq + KING_OFF[i];
      if (onBoard(s) && b[s] === (byColor | KING)) return true;
    }
    for (i = 0; i < 4; i++) {
      off = BISHOP_OFF[i]; s = sq + off;
      while (onBoard(s)) {
        pc = b[s];
        if (pc) {
          if ((pc & COLOR) === byColor) { var t = pc & TYPE; if (t === BISHOP || t === QUEEN) return true; }
          break;
        }
        s += off;
      }
    }
    for (i = 0; i < 4; i++) {
      off = ROOK_OFF[i]; s = sq + off;
      while (onBoard(s)) {
        pc = b[s];
        if (pc) {
          if ((pc & COLOR) === byColor) { var t2 = pc & TYPE; if (t2 === ROOK || t2 === QUEEN) return true; }
          break;
        }
        s += off;
      }
    }
    return false;
  }

  function kingSq(pos, color) { return pos.kings[color === WHITE ? 0 : 1]; }
  function inCheck(pos, color) { return isAttacked(pos, kingSq(pos, color), color === WHITE ? BLACK : WHITE); }

  /* ---------- move generation ----------
     Pseudo-legal into a caller-supplied array; the search filters by make/unmake so
     that pins and discovered checks need no special handling. */
  function genMoves(pos, out, capturesOnly) {
    var b = pos.board, us = pos.turn, them = us === WHITE ? BLACK : WHITE;
    var n = 0, i, j, sq, pc, t, off, s, cap;

    for (i = 0; i < 64; i++) {
      sq = SQUARES[i]; pc = b[sq];
      if (!pc || (pc & COLOR) !== us) continue;
      t = pc & TYPE;

      if (t === PAWN) {
        var fwd = us === WHITE ? 16 : -16;
        var startRank = us === WHITE ? 1 : 6;
        var lastRank = us === WHITE ? 7 : 0;
        s = sq + fwd;
        if (!capturesOnly && onBoard(s) && !b[s]) {
          if (rankOf(s) === lastRank) {
            out[n++] = mk(sq, s, 0, QUEEN, 0); out[n++] = mk(sq, s, 0, ROOK, 0);
            out[n++] = mk(sq, s, 0, BISHOP, 0); out[n++] = mk(sq, s, 0, KNIGHT, 0);
          } else {
            out[n++] = mk(sq, s, 0, 0, 0);
            var s2 = s + fwd;
            if (rankOf(sq) === startRank && !b[s2]) out[n++] = mk(sq, s2, 0, 0, F_DOUBLE);
          }
        }
        for (j = -1; j <= 1; j += 2) {
          s = sq + fwd + j;
          if (!onBoard(s)) continue;
          cap = b[s];
          if (cap && (cap & COLOR) === them) {
            if (rankOf(s) === lastRank) {
              out[n++] = mk(sq, s, cap, QUEEN, 0); out[n++] = mk(sq, s, cap, ROOK, 0);
              out[n++] = mk(sq, s, cap, BISHOP, 0); out[n++] = mk(sq, s, cap, KNIGHT, 0);
            } else out[n++] = mk(sq, s, cap, 0, 0);
          } else if (!cap && s === pos.ep) {
            out[n++] = mk(sq, s, them | PAWN, 0, F_EP);
          }
        }
        continue;
      }

      if (t === KNIGHT || t === KING) {
        var offs = t === KNIGHT ? KNIGHT_OFF : KING_OFF;
        for (j = 0; j < 8; j++) {
          s = sq + offs[j];
          if (!onBoard(s)) continue;
          cap = b[s];
          if (cap && (cap & COLOR) === us) continue;
          if (capturesOnly && !cap) continue;
          out[n++] = mk(sq, s, cap, 0, 0);
        }
        continue;
      }

      var slides = t === BISHOP ? BISHOP_OFF : t === ROOK ? ROOK_OFF : KING_OFF;
      var nSlides = t === QUEEN ? 8 : 4;
      for (j = 0; j < nSlides; j++) {
        off = slides[j]; s = sq + off;
        while (onBoard(s)) {
          cap = b[s];
          if (cap) {
            if ((cap & COLOR) === them) out[n++] = mk(sq, s, cap, 0, 0);
            break;
          }
          if (!capturesOnly) out[n++] = mk(sq, s, 0, 0, 0);
          s += off;
        }
      }
    }

    /* Castling: the king may not start in check, pass through an attacked square, or
       land in one, and every square between king and rook must be empty. */
    if (!capturesOnly) {
      var home = us === WHITE ? 0 : 0x70;
      var kSide = us === WHITE ? WK : BK, qSide = us === WHITE ? WQ : BQ;
      var ksq = home + 4;
      if (b[ksq] === (us | KING) && !isAttacked(pos, ksq, them)) {
        if ((pos.castling & kSide) && !b[home + 5] && !b[home + 6] &&
            b[home + 7] === (us | ROOK) &&
            !isAttacked(pos, home + 5, them) && !isAttacked(pos, home + 6, them)) {
          out[n++] = mk(ksq, home + 6, 0, 0, F_CASTLE);
        }
        if ((pos.castling & qSide) && !b[home + 3] && !b[home + 2] && !b[home + 1] &&
            b[home + 0] === (us | ROOK) &&
            !isAttacked(pos, home + 3, them) && !isAttacked(pos, home + 2, them)) {
          out[n++] = mk(ksq, home + 2, 0, 0, F_CASTLE);
        }
      }
    }
    return n;
  }

  /* ---------- make / unmake ---------- */
  function makeMove(pos, m) {
    var b = pos.board;
    var from = mFrom(m), to = mTo(m), promo = mPromo(m), flags = mFlags(m), cap = mCap(m);
    var pc = b[from], us = pc & COLOR, t = pc & TYPE;
    var them = us === WHITE ? BLACK : WHITE;
    var lo = pos.hashLo, hi = pos.hashHi, k;

    pos.undo.push({
      m: m, castling: pos.castling, ep: pos.ep, half: pos.half,
      hashLo: lo, hashHi: hi, kings: pos.kings[0] + "," + pos.kings[1]
    });

    if (pos.ep >= 0) { lo ^= zEpLo[fileOf(pos.ep)]; hi ^= zEpHi[fileOf(pos.ep)]; }
    lo ^= zCastLo[pos.castling]; hi ^= zCastHi[pos.castling];

    k = pc * 128 + from; lo ^= zpLo[k]; hi ^= zpHi[k];
    b[from] = EMPTY;

    if (flags & F_EP) {
      var capSq = to + (us === WHITE ? -16 : 16);
      k = (them | PAWN) * 128 + capSq; lo ^= zpLo[k]; hi ^= zpHi[k];
      b[capSq] = EMPTY;
    } else if (cap) {
      k = cap * 128 + to; lo ^= zpLo[k]; hi ^= zpHi[k];
    }

    var placed = promo ? (us | promo) : pc;
    b[to] = placed;
    k = placed * 128 + to; lo ^= zpLo[k]; hi ^= zpHi[k];

    if (flags & F_CASTLE) {
      var home = us === WHITE ? 0 : 0x70;
      var rFrom = to > from ? home + 7 : home + 0;
      var rTo = to > from ? home + 5 : home + 3;
      var rook = us | ROOK;
      b[rFrom] = EMPTY; b[rTo] = rook;
      k = rook * 128 + rFrom; lo ^= zpLo[k]; hi ^= zpHi[k];
      k = rook * 128 + rTo; lo ^= zpLo[k]; hi ^= zpHi[k];
    }

    if (t === KING) pos.kings[us === WHITE ? 0 : 1] = to;

    pos.castling &= CASTLE_MASK[from] & CASTLE_MASK[to];
    lo ^= zCastLo[pos.castling]; hi ^= zCastHi[pos.castling];

    pos.ep = (flags & F_DOUBLE) ? (from + (us === WHITE ? 16 : -16)) : -1;
    if (pos.ep >= 0) { lo ^= zEpLo[fileOf(pos.ep)]; hi ^= zEpHi[fileOf(pos.ep)]; }

    pos.half = (t === PAWN || cap) ? 0 : pos.half + 1;
    if (us === BLACK) pos.full++;
    pos.turn = them;
    lo ^= zSideLo; hi ^= zSideHi;

    pos.hashLo = lo; pos.hashHi = hi;
    pos.hist.push(lo);
  }

  function unmakeMove(pos) {
    var u = pos.undo.pop();
    if (!u) return;
    var b = pos.board, m = u.m;
    var from = mFrom(m), to = mTo(m), promo = mPromo(m), flags = mFlags(m), cap = mCap(m);
    var placed = b[to];
    var us = placed & COLOR;
    var them = us === WHITE ? BLACK : WHITE;

    pos.hist.pop();
    b[from] = promo ? (us | PAWN) : placed;
    b[to] = EMPTY;

    if (flags & F_EP) {
      b[to + (us === WHITE ? -16 : 16)] = them | PAWN;
    } else if (cap) {
      b[to] = cap;
    }

    if (flags & F_CASTLE) {
      var home = us === WHITE ? 0 : 0x70;
      var rFrom = to > from ? home + 7 : home + 0;
      var rTo = to > from ? home + 5 : home + 3;
      b[rTo] = EMPTY; b[rFrom] = us | ROOK;
    }

    var kk = u.kings.split(",");
    pos.kings[0] = +kk[0]; pos.kings[1] = +kk[1];
    pos.castling = u.castling; pos.ep = u.ep; pos.half = u.half;
    pos.hashLo = u.hashLo; pos.hashHi = u.hashHi;
    if (us === BLACK) pos.full--;
    pos.turn = us;
  }

  /* ---------- legality ---------- */
  var _tmp = new Int32Array(256);
  function legalMoves(pos) {
    var n = genMoves(pos, _tmp, false), out = [], us = pos.turn;
    for (var i = 0; i < n; i++) {
      var m = _tmp[i];
      makeMove(pos, m);
      if (!isAttacked(pos, kingSq(pos, us), pos.turn)) out.push(m);
      unmakeMove(pos);
    }
    return out;
  }

  function hasLegal(pos) {
    var buf = new Int32Array(256);
    var n = genMoves(pos, buf, false), us = pos.turn;
    for (var i = 0; i < n; i++) {
      makeMove(pos, buf[i]);
      var ok = !isAttacked(pos, kingSq(pos, us), pos.turn);
      unmakeMove(pos);
      if (ok) return true;
    }
    return false;
  }

  /* ---------- draws and terminal states ---------- */
  function insufficientMaterial(pos) {
    var b = pos.board, bishops = [], knights = 0, others = 0;
    for (var i = 0; i < 64; i++) {
      var sq = SQUARES[i], pc = b[sq];
      if (!pc) continue;
      var t = pc & TYPE;
      if (t === KING) continue;
      if (t === BISHOP) bishops.push((fileOf(sq) + rankOf(sq)) & 1);
      else if (t === KNIGHT) knights++;
      else others++;
    }
    if (others) return false;
    if (!bishops.length && knights <= 1) return true;            /* K, K+N */
    if (bishops.length && !knights) {                             /* all bishops one colour */
      for (var j = 1; j < bishops.length; j++) if (bishops[j] !== bishops[0]) return false;
      return true;
    }
    return false;
  }

  function repetitionCount(pos) {
    var h = pos.hashLo, n = 0;
    for (var i = pos.hist.length - 1; i >= 0; i--) if (pos.hist[i] === h) n++;
    return n;
  }

  function status(pos) {
    var check = inCheck(pos, pos.turn);
    if (!hasLegal(pos)) {
      if (check) return { over: true, result: pos.turn === WHITE ? "0-1" : "1-0", reason: "checkmate", check: true };
      return { over: true, result: "1/2-1/2", reason: "stalemate", check: false };
    }
    if (pos.half >= 100) return { over: true, result: "1/2-1/2", reason: "fifty-move", check: check };
    if (repetitionCount(pos) >= 3) return { over: true, result: "1/2-1/2", reason: "repetition", check: check };
    if (insufficientMaterial(pos)) return { over: true, result: "1/2-1/2", reason: "insufficient material", check: check };
    return { over: false, result: null, reason: null, check: check };
  }

  /* ---------- notation ----------
     Must be called with the move still unplayed, since disambiguation depends on
     which other pieces could legally reach the same square right now. */
  function moveToSan(pos, m) {
    var flags = mFlags(m);
    if (flags & F_CASTLE) {
      var san = mTo(m) > mFrom(m) ? "O-O" : "O-O-O";
      return san + checkSuffix(pos, m);
    }
    var from = mFrom(m), to = mTo(m), pc = pos.board[from], t = pc & TYPE;
    var cap = mCap(m), promo = mPromo(m);
    var s = "";
    if (t === PAWN) {
      if (cap) s += "abcdefgh"[fileOf(from)] + "x";
      s += algebraic(to);
      if (promo) s += "=" + " PNBRQK"[promo];
    } else {
      s += " PNBRQK"[t];
      var others = legalMoves(pos).filter(function (o) {
        return o !== m && mTo(o) === to && (pos.board[mFrom(o)] & TYPE) === t;
      });
      if (others.length) {
        var sameFile = others.some(function (o) { return fileOf(mFrom(o)) === fileOf(from); });
        var sameRank = others.some(function (o) { return rankOf(mFrom(o)) === rankOf(from); });
        if (!sameFile) s += "abcdefgh"[fileOf(from)];
        else if (!sameRank) s += (rankOf(from) + 1);
        else s += algebraic(from);
      }
      if (cap) s += "x";
      s += algebraic(to);
    }
    return s + checkSuffix(pos, m);
  }

  function checkSuffix(pos, m) {
    makeMove(pos, m);
    var suffix = "";
    if (inCheck(pos, pos.turn)) suffix = hasLegal(pos) ? "+" : "#";
    unmakeMove(pos);
    return suffix;
  }

  function moveToUci(m) {
    return algebraic(mFrom(m)) + algebraic(mTo(m)) + (mPromo(m) ? " pnbrqk"[mPromo(m)] : "");
  }
  function uciToMove(pos, uci) {
    var list = legalMoves(pos);
    for (var i = 0; i < list.length; i++) if (moveToUci(list[i]) === uci) return list[i];
    return 0;
  }

  root.ChessCore = {
    EMPTY: EMPTY, PAWN: PAWN, KNIGHT: KNIGHT, BISHOP: BISHOP, ROOK: ROOK, QUEEN: QUEEN, KING: KING,
    WHITE: WHITE, BLACK: BLACK, TYPE: TYPE, COLOR: COLOR, SQUARES: SQUARES,
    F_EP: F_EP, F_CASTLE: F_CASTLE, F_DOUBLE: F_DOUBLE, START_FEN: START_FEN,
    rankOf: rankOf, fileOf: fileOf, sq88: sq88, onBoard: onBoard,
    algebraic: algebraic, fromAlgebraic: fromAlgebraic,
    mk: mk, mFrom: mFrom, mTo: mTo, mCap: mCap, mPromo: mPromo, mFlags: mFlags,
    fromFen: fromFen, toFen: toFen, clone: clone, hashPos: hashPos,
    genMoves: genMoves, legalMoves: legalMoves, hasLegal: hasLegal,
    isAttacked: isAttacked, inCheck: inCheck, kingSq: kingSq,
    makeMove: makeMove, unmakeMove: unmakeMove,
    status: status, insufficientMaterial: insufficientMaterial, repetitionCount: repetitionCount,
    moveToSan: moveToSan, moveToUci: moveToUci, uciToMove: uciToMove
  };
})(typeof self !== "undefined" ? self : this);
