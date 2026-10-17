/* core.js — the rules of Reversi on an 8x8 board. Loaded by the page, by the engine's
   Worker, and by the tests in Node, so it touches nothing but its own arguments.

   A square is y * 8 + x, with x running left to right (a to h) and y running from the
   far side of the board (row 1) to the near side (row 8) as you sit at it.

   Rules, as played at the club:
   - The game starts with four discs crossed in the middle (White on d4 and e5, Black
     on d5 and e4). Black moves first.
   - A move puts one disc of your color on an empty square so that it brackets at
     least one straight line of the other color's discs (across, up and down, or on a
     diagonal) between the new disc and one of yours. Every bracketed disc, in all
     eight directions at once, turns over to your color.
   - If you have no such move, you pass, and only then. A pass is not a choice.
   - The game ends when neither side can move: the board is full, or both are stuck.
   - The side with more discs wins. Equal counts are a draw. */
(function (root) {
  "use strict";

  var N = 8, SZ = 64, EMPTY = 0, BLACK = 1, WHITE = 2, PASS = -1;
  var DX = [1, 1, 0, -1, -1, -1, 0, 1], DY = [0, 1, 1, 1, 0, -1, -1, -1];

  function sq(x, y) { return y * 8 + x; }
  function sx(s) { return s & 7; }
  function sy(s) { return s >> 3; }

  /* RAYS[s * 8 + d] is every square walking out from s in direction d, nearest first */
  var RAYS = new Array(SZ * 8);
  for (var s0 = 0; s0 < SZ; s0++) {
    for (var d0 = 0; d0 < 8; d0++) {
      var ray = [], x = sx(s0) + DX[d0], y = sy(s0) + DY[d0];
      while (x >= 0 && x < N && y >= 0 && y < N) { ray.push(sq(x, y)); x += DX[d0]; y += DY[d0]; }
      RAYS[s0 * 8 + d0] = ray;
    }
  }

  /* The discs a disc of `color` on s would turn over, nearest first in each direction.
     Empty array = not a legal move. */
  function flipsFor(b, s, color) {
    if (b[s] !== EMPTY) return [];
    var opp = 3 - color, out = [];
    for (var d = 0; d < 8; d++) {
      var ray = RAYS[s * 8 + d], k = 0;
      while (k < ray.length && b[ray[k]] === opp) k++;
      if (k > 0 && k < ray.length && b[ray[k]] === color) for (var i = 0; i < k; i++) out.push(ray[i]);
    }
    return out;
  }
  function isLegal(b, s, color) {
    if (b[s] !== EMPTY) return false;
    var opp = 3 - color;
    for (var d = 0; d < 8; d++) {
      var ray = RAYS[s * 8 + d], k = 0;
      while (k < ray.length && b[ray[k]] === opp) k++;
      if (k > 0 && k < ray.length && b[ray[k]] === color) return true;
    }
    return false;
  }
  function movesFor(b, color) {
    var out = [];
    for (var s = 0; s < SZ; s++) if (isLegal(b, s, color)) out.push(s);
    return out;
  }
  function hasMove(b, color) {
    for (var s = 0; s < SZ; s++) if (isLegal(b, s, color)) return true;
    return false;
  }

  function start() {
    var b = new Uint8Array(SZ);
    b[sq(3, 3)] = WHITE; b[sq(4, 4)] = WHITE;
    b[sq(3, 4)] = BLACK; b[sq(4, 3)] = BLACK;
    return { b: b, turn: BLACK, plies: 0, moves: 0, passes: 0, last: -2, ended: false };
  }
  function clone(p) {
    return { b: Uint8Array.from(p.b), turn: p.turn, plies: p.plies, moves: p.moves, passes: p.passes, last: p.last, ended: p.ended };
  }
  function legal(pos) { return pos.ended ? [] : movesFor(pos.b, pos.turn); }
  /* the side to move is stuck while the other side is not: the only move is a pass */
  function mustPass(pos) { return !pos.ended && !hasMove(pos.b, pos.turn); }

  /* Play s (or PASS) for the side to move. Throws on an illegal move. Returns what
     happened: the color that moved, the discs it turned over, and whether it passed. */
  function play(pos, s) {
    if (pos.ended) throw new Error("the game is over");
    var color = pos.turn, b = pos.b;
    if (s === PASS) {
      if (hasMove(b, color)) throw new Error("a pass is only allowed with no move");
      pos.turn = 3 - color; pos.passes++; pos.plies++; pos.last = PASS;
      if (!hasMove(b, pos.turn)) pos.ended = true;
      return { color: color, pass: true, flips: [], s: PASS };
    }
    var f = flipsFor(b, s, color);
    if (!f.length) throw new Error("illegal move " + s);
    b[s] = color;
    for (var i = 0; i < f.length; i++) b[f[i]] = color;
    pos.turn = 3 - color; pos.passes = 0; pos.plies++; pos.moves++; pos.last = s;
    if (!hasMove(b, pos.turn) && !hasMove(b, color)) pos.ended = true;
    return { color: color, pass: false, flips: f, s: s };
  }

  function count(b) {
    var k = [0, 0, 0];
    for (var s = 0; s < SZ; s++) k[b[s]]++;
    return { black: k[BLACK], white: k[WHITE], empty: k[EMPTY] };
  }
  /* BLACK, WHITE, or 0 for a draw */
  function winner(b) {
    var c = count(b);
    return c.black > c.white ? BLACK : c.white > c.black ? WHITE : 0;
  }
  function name(s) {
    if (s === PASS) return "pass";
    return "abcdefgh".charAt(sx(s)) + (sy(s) + 1);
  }

  root.ReversiCore = {
    N: N, SZ: SZ, EMPTY: EMPTY, BLACK: BLACK, WHITE: WHITE, PASS: PASS, DX: DX, DY: DY, RAYS: RAYS,
    sq: sq, sx: sx, sy: sy, flipsFor: flipsFor, isLegal: isLegal, movesFor: movesFor, hasMove: hasMove,
    start: start, clone: clone, legal: legal, mustPass: mustPass, play: play, count: count, winner: winner, name: name
  };
})(typeof self !== "undefined" ? self : this);
