/* core.js — the rules of Go on a 9x9 board. Loaded by the page, by the engine's
   Worker, and by the tests in Node, so it touches nothing but its own arguments.

   The board is padded: 11 x 11 cells, with the border marked EDGE, so a neighbor
   lookup never needs a bounds check. A point is (y + 1) * 11 + (x + 1), with x
   running left to right and y top to bottom as you sit at the board. PASS is 0,
   which is a border cell and so can never be a real move.

   Rules, as played at the teahouse:
   - Captures: a placed stone takes every enemy group it leaves with no liberties.
   - Suicide is illegal: a stone that would leave its own group with no liberties,
     and captures nothing, may not be played.
   - Positional superko: no move may recreate any earlier whole-board position (who
     is to move does not matter). This covers the simple ko and every longer cycle.
     Positions are compared by a 64-bit Zobrist hash, two 32-bit halves.
   - Two passes in a row end play and go to counting.
   - Area (Chinese) scoring: each side's stones on the board plus the empty points
     reached only by that side's stones, with komi added to White. */
(function (root) {
  "use strict";

  var N = 9, S = 11, SZ = S * S;
  var EMPTY = 0, BLACK = 1, WHITE = 2, EDGE = 3, PASS = 0;
  var DIRS = [1, -1, S, -S];
  var DIAG = [S + 1, S - 1, -S + 1, -S - 1];

  function pt(x, y) { return (y + 1) * S + (x + 1); }
  function px(p) { return p % S - 1; }
  function py(p) { return ((p / S) | 0) - 1; }
  var POINTS = [];
  for (var yy = 0; yy < N; yy++) for (var xx = 0; xx < N; xx++) POINTS.push(pt(xx, yy));
  function onBoard(p) { return p > 0 && p < SZ && px(p) >= 0 && px(p) < N && py(p) >= 0 && py(p) < N; }

  /* ---------- Zobrist ---------- */
  var seed = 0x6d2b79f5 | 0;
  function rnd32() { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed | 0; }
  var Z1 = new Int32Array(SZ * 3), Z2 = new Int32Array(SZ * 3);
  for (var zi = 0; zi < Z1.length; zi++) { Z1[zi] = rnd32(); Z2[zi] = rnd32(); }
  function keyOf(h1, h2) { return (h1 >>> 0).toString(36) + ":" + (h2 >>> 0).toString(36); }

  function emptyBoard() {
    var b = new Uint8Array(SZ);
    b.fill(EDGE);
    for (var i = 0; i < POINTS.length; i++) b[POINTS[i]] = EMPTY;
    return b;
  }
  function hashBoard(b) {
    var h1 = 0, h2 = 0;
    for (var i = 0; i < POINTS.length; i++) {
      var p = POINTS[i], c = b[p];
      if (c === BLACK || c === WHITE) { h1 ^= Z1[p * 3 + c]; h2 ^= Z2[p * 3 + c]; }
    }
    return [h1, h2];
  }

  /* ---------- groups ---------- */
  var mark = new Int32Array(SZ), lmark = new Int32Array(SZ), stamp = 1;
  var stack = new Int16Array(SZ);
  /* Flood the group at p. Fills `out` with its stones and returns its liberty count. */
  function flood(b, p, out) {
    var c = b[p], sp = 0, libs = 0;
    stamp++;
    if (out) out.length = 0;
    mark[p] = stamp; stack[sp++] = p;
    while (sp) {
      var q = stack[--sp];
      if (out) out.push(q);
      for (var d = 0; d < 4; d++) {
        var r = q + DIRS[d], v = b[r];
        if (v === c) { if (mark[r] !== stamp) { mark[r] = stamp; stack[sp++] = r; } }
        else if (v === EMPTY && lmark[r] !== stamp) { lmark[r] = stamp; libs++; }
      }
    }
    return libs;
  }
  function groupAt(b, p) { var out = []; if (b[p] === BLACK || b[p] === WHITE) flood(b, p, out); return out; }
  function libertiesAt(b, p) { return b[p] === BLACK || b[p] === WHITE ? flood(b, p, null) : 0; }
  /* every group on the board: [{ color, stones: [...], libs }] */
  function groups(b) {
    var seen = new Uint8Array(SZ), out = [];
    for (var i = 0; i < POINTS.length; i++) {
      var p = POINTS[i];
      if ((b[p] !== BLACK && b[p] !== WHITE) || seen[p]) continue;
      var st = [], libs = flood(b, p, st);
      for (var k = 0; k < st.length; k++) seen[st[k]] = 1;
      out.push({ color: b[p], stones: st, libs: libs });
    }
    return out;
  }

  /* ---------- a game ---------- */
  /* 9x9 handicap on the 3-3 points: two opposite corners, then a third, then all four.
     (2,6) is the lower left as Black sits, (6,2) the upper right. */
  var HANDI = [pt(6, 2), pt(2, 6), pt(6, 6), pt(2, 2)];
  var STARS = [pt(2, 2), pt(6, 2), pt(4, 4), pt(2, 6), pt(6, 6)];

  function start(handicap, komi) {
    var b = emptyBoard();
    handicap = handicap >= 2 ? Math.min(4, handicap | 0) : 0;
    for (var i = 0; i < handicap; i++) b[HANDI[i]] = BLACK;
    var h = hashBoard(b), seen = {};
    seen[keyOf(h[0], h[1])] = 1;
    return {
      b: b, turn: handicap ? WHITE : BLACK, h1: h[0], h2: h[1], seen: seen,
      passes: 0, caps: [0, 0, 0], moves: 0, plies: 0,
      komi: komi != null ? komi : handicap ? 0.5 : 7.5, handicap: handicap,
      last: -1, over: false, ended: false, prev: ""
    };
  }
  function clone(pos) {
    var seen = {};
    for (var k in pos.seen) seen[k] = 1;
    return { b: new Uint8Array(pos.b), turn: pos.turn, h1: pos.h1, h2: pos.h2, seen: seen, passes: pos.passes,
      caps: pos.caps.slice(), moves: pos.moves, plies: pos.plies, komi: pos.komi, handicap: pos.handicap,
      last: pos.last, over: pos.over, ended: pos.ended, prev: pos.prev };
  }

  var tmpStones = [];
  /* Would `color` playing at p be legal? Never mutates. Returns
     { ok, why, caps: [points], h1, h2 }; why is "occupied", "suicide", "ko" (the
     immediate retake of a ko), "superko" (any older position), or "off". */
  function tryMove(pos, p, color) {
    var b = pos.b, c = color || pos.turn, o = 3 - c;
    if (!onBoard(p)) return { ok: false, why: "off" };
    if (b[p] !== EMPTY) return { ok: false, why: "occupied" };
    b[p] = c;
    var caps = [], h1 = pos.h1 ^ Z1[p * 3 + c], h2 = pos.h2 ^ Z2[p * 3 + c];
    for (var d = 0; d < 4; d++) {
      var q = p + DIRS[d];
      if (b[q] !== o || caps.indexOf(q) >= 0) continue;
      if (flood(b, q, tmpStones) === 0) {
        for (var k = 0; k < tmpStones.length; k++) {
          var s = tmpStones[k];
          if (caps.indexOf(s) < 0) { caps.push(s); h1 ^= Z1[s * 3 + o]; h2 ^= Z2[s * 3 + o]; }
        }
      }
    }
    var why = null;
    if (!caps.length && flood(b, p, null) === 0) why = "suicide";
    b[p] = EMPTY;
    if (why) return { ok: false, why: why };
    var key = keyOf(h1, h2);
    if (pos.seen[key]) {
      /* taking straight back what was just taken is the ordinary ko; any older
         position coming round again is superko */
      return { ok: false, why: key === pos.prev ? "ko" : "superko" };
    }
    return { ok: true, why: null, caps: caps, h1: h1, h2: h2 };
  }

  function legal(pos) {
    var out = [];
    if (pos.over || pos.ended) return out;
    for (var i = 0; i < POINTS.length; i++) {
      var p = POINTS[i];
      if (pos.b[p] === EMPTY && tryMove(pos, p).ok) out.push(p);
    }
    return out;
  }

  /* Play p (or PASS) for the side to move. Returns the record of the move, or throws
     on an illegal one. */
  function play(pos, p) {
    if (pos.over || pos.ended) throw new Error("go: the game is over");
    var c = pos.turn;
    pos.prev = keyOf(pos.h1, pos.h2);
    if (p === PASS) {
      pos.passes++; pos.turn = 3 - c; pos.plies++; pos.last = PASS;
      if (pos.passes >= 2) pos.ended = true;
      return { color: c, p: PASS, pass: true, caps: [] };
    }
    var r = tryMove(pos, p, c);
    if (!r.ok) throw new Error("go: illegal move (" + r.why + ") at " + p);
    pos.b[p] = c;
    for (var k = 0; k < r.caps.length; k++) pos.b[r.caps[k]] = EMPTY;
    pos.h1 = r.h1; pos.h2 = r.h2;
    pos.seen[keyOf(r.h1, r.h2)] = 1;
    pos.caps[c] += r.caps.length;
    pos.passes = 0; pos.turn = 3 - c; pos.moves++; pos.plies++; pos.last = p;
    return { color: c, p: p, pass: false, caps: r.caps };
  }

  /* ---------- counting ---------- */
  /* Area scoring. `dead` (optional) is a Uint8Array over points: 1 = a stone the
     players agree is dead, taken off before counting. Returns the counts, each
     point's owner (1 Black, 2 White, 0 neither), and the winner. */
  function score(b, komi, dead) {
    var bb = new Uint8Array(b), i, p;
    var removed = [0, 0, 0];
    if (dead) for (i = 0; i < POINTS.length; i++) { p = POINTS[i]; if (dead[p] && (bb[p] === BLACK || bb[p] === WHITE)) { removed[bb[p]]++; bb[p] = EMPTY; } }
    var owner = new Uint8Array(SZ), seen = new Uint8Array(SZ);
    var stones = [0, 0, 0], terr = [0, 0, 0];
    var reg = [];
    for (i = 0; i < POINTS.length; i++) {
      p = POINTS[i];
      var v = bb[p];
      if (v === BLACK || v === WHITE) { stones[v]++; owner[p] = v; continue; }
      if (seen[p]) continue;
      /* flood the empty region and note which colors touch it */
      reg.length = 0; var touch = 0, sp = 0;
      seen[p] = 1; stack[sp++] = p;
      while (sp) {
        var q = stack[--sp]; reg.push(q);
        for (var d = 0; d < 4; d++) {
          var r = q + DIRS[d], w = bb[r];
          if (w === EMPTY) { if (!seen[r]) { seen[r] = 1; stack[sp++] = r; } }
          else if (w === BLACK) touch |= 1; else if (w === WHITE) touch |= 2;
        }
      }
      var who = touch === 1 ? BLACK : touch === 2 ? WHITE : 0;
      if (who) { terr[who] += reg.length; for (var k = 0; k < reg.length; k++) owner[reg[k]] = who; }
    }
    var black = stones[BLACK] + terr[BLACK], white = stones[WHITE] + terr[WHITE] + komi;
    return {
      black: { stones: stones[BLACK], terr: terr[BLACK], total: black, dead: removed[BLACK] },
      white: { stones: stones[WHITE], terr: terr[WHITE], komi: komi, total: white, dead: removed[WHITE] },
      owner: owner, winner: black > white ? BLACK : WHITE, margin: Math.abs(black - white)
    };
  }

  /* Is p a single-point eye of `color`: all four sides that color (or the edge), and
     not given away by the diagonals? Used to keep the engine from filling its own. */
  function isEye(b, p, color) {
    if (b[p] !== EMPTY) return false;
    for (var d = 0; d < 4; d++) { var v = b[p + DIRS[d]]; if (v !== color && v !== EDGE) return false; }
    var bad = 0, edge = 0;
    for (var e = 0; e < 4; e++) { var w = b[p + DIAG[e]]; if (w === EDGE) edge = 1; else if (w === 3 - color) bad++; }
    return bad + edge < 2;
  }

  function name(p) {
    if (p === PASS) return "pass";
    return "ABCDEFGHJ".charAt(px(p)) + (N - py(p));
  }

  root.GoCore = {
    N: N, S: S, SZ: SZ, EMPTY: EMPTY, BLACK: BLACK, WHITE: WHITE, EDGE: EDGE, PASS: PASS,
    DIRS: DIRS, DIAG: DIAG, POINTS: POINTS, STARS: STARS, HANDI: HANDI, Z1: Z1, Z2: Z2,
    pt: pt, px: px, py: py, onBoard: onBoard, keyOf: keyOf, emptyBoard: emptyBoard, hashBoard: hashBoard,
    groupAt: groupAt, libertiesAt: libertiesAt, groups: groups,
    start: start, clone: clone, tryMove: tryMove, legal: legal, play: play, score: score, isEye: isEye, name: name
  };
})(typeof self !== "undefined" ? self : this);
