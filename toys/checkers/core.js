/* Checkers — the rules, American checkers / English draughts. Loaded by BOTH the
   page and the engine Worker (importScripts), so there is one move generator and
   the board can never disagree with the opponent about what is legal.

   The 32 playable squares are indexed 0..31, which is the standard square number
   minus one. Row 0 is Black's back row (the top of a standard diagram) and row 7 is
   Red's. Black moves first.

   Pieces: 1 black man, 2 black king, -1 red man, -2 red king, 0 empty.

   The rules that matter, and that casual play often gets wrong:
   - Captures are MANDATORY (unless the house-rules toggle turns that off), but you
     may choose WHICH capture; you are not required to take the most pieces.
   - A multi-jump must be completed once started.
   - Men capture forward only; kings both ways. No flying kings.
   - A man that reaches the far row is crowned and the move ENDS there, even if it
     could keep jumping as a king.
   - A captured piece stays on the board until the move ends, so it cannot be
     jumped twice and nothing can land on its square. The square the mover started
     from is empty, so a king's loop may land back on it.
   - Draws: 40 moves by each side with no capture and no man moved (80 plies), or
     the same position three times with the same side to move. */
(function (root) {
  "use strict";

  var BLACK = 1, RED = -1;
  var DR = [-1, -1, 1, 1], DC = [-1, 1, -1, 1];
  var ROW = new Int8Array(32), COL = new Int8Array(32);
  var NB = new Int8Array(128), JP = new Int8Array(128);

  function at(r, c) {
    if (r < 0 || r > 7 || c < 0 || c > 7 || ((r + c) & 1) === 0) return -1;
    return r * 4 + (c >> 1);
  }
  for (var i = 0; i < 32; i++) {
    var r = i >> 2, c = 2 * (i & 3) + ((r & 1) ? 0 : 1);
    ROW[i] = r; COL[i] = c;
    for (var d = 0; d < 4; d++) {
      NB[i * 4 + d] = at(r + DR[d], c + DC[d]);
      JP[i * 4 + d] = at(r + 2 * DR[d], c + 2 * DC[d]);
    }
  }
  /* Black men head for row 7 (directions 2, 3); red men for row 0 (0, 1). */
  var FWD_B = [2, 3], FWD_R = [0, 1], ALL = [0, 1, 2, 3];
  function dirsOf(p) { return p === 1 ? FWD_B : p === -1 ? FWD_R : ALL; }
  function isCrownRow(sq, p) { return (p === 1 && ROW[sq] === 7) || (p === -1 && ROW[sq] === 0); }

  function start() {
    var b = new Int8Array(32);
    for (var k = 0; k < 12; k++) b[k] = BLACK;
    for (var j = 20; j < 32; j++) b[j] = RED;
    var pos = { b: b, turn: BLACK, half: 0, undo: [], keys: [] };
    pos.keys.push(key(pos));
    return pos;
  }

  function clone(pos) {
    return { b: new Int8Array(pos.b), turn: pos.turn, half: pos.half, undo: [], keys: pos.keys.slice() };
  }

  /* A position key for repetition: the board plus the side to move. */
  var CH = { "-2": "R", "-1": "r", "0": ".", "1": "b", "2": "B" };
  function key(pos) {
    var s = pos.turn === BLACK ? "b:" : "r:";
    for (var k = 0; k < 32; k++) s += CH[pos.b[k]];
    return s;
  }

  /* ---------- move generation ----------
     A move is { from, path: [landing squares], caps: [jumped squares], crown }. */
  function jumps(b, from, sq, p, caps, path, out) {
    var dirs = dirsOf(p), found = false;
    for (var q = 0; q < dirs.length; q++) {
      var d = dirs[q], mid = NB[sq * 4 + d], land = JP[sq * 4 + d];
      if (land < 0) continue;
      var v = b[mid];
      if (!v || (v > 0) === (p > 0)) continue;              /* must be an enemy piece */
      if (caps.indexOf(mid) >= 0) continue;                  /* never the same piece twice */
      if (b[land] !== 0 && land !== from) continue;           /* the start square is vacated */
      found = true;
      var nc = caps.concat(mid), np = path.concat(land);
      if ((p === 1 || p === -1) && isCrownRow(land, p)) out.push({ from: from, path: np, caps: nc, crown: true });
      else jumps(b, from, land, p, nc, np, out);
    }
    if (!found && path.length) out.push({ from: from, path: path, caps: caps, crown: false });
  }

  /* forced = the official rule (captures mandatory). With it off, captures and
     plain moves are offered side by side. */
  function generate(pos, forced) {
    var b = pos.b, side = pos.turn, caps = [], plain = [];
    for (var s = 0; s < 32; s++) {
      var p = b[s];
      if (!p || (p > 0) !== (side > 0)) continue;
      jumps(b, s, s, p, [], [], caps);
    }
    if (caps.length && forced !== false) return caps;
    for (var t = 0; t < 32; t++) {
      var pc = b[t];
      if (!pc || (pc > 0) !== (side > 0)) continue;
      var dirs = dirsOf(pc);
      for (var q = 0; q < dirs.length; q++) {
        var to = NB[t * 4 + dirs[q]];
        if (to < 0 || b[to] !== 0) continue;
        plain.push({ from: t, path: [to], caps: [], crown: (pc === 1 || pc === -1) && isCrownRow(to, pc) });
      }
    }
    return caps.concat(plain);
  }

  function hasCapture(pos) {
    var b = pos.b, side = pos.turn, out = [];
    for (var s = 0; s < 32; s++) {
      var p = b[s];
      if (!p || (p > 0) !== (side > 0)) continue;
      jumps(b, s, s, p, [], [], out);
      if (out.length) return true;
    }
    return false;
  }

  function last(m) { return m.path[m.path.length - 1]; }

  function makeMove(pos, m, keepKeys) {
    var b = pos.b, p = b[m.from], to = last(m);
    var taken = [];
    for (var k = 0; k < m.caps.length; k++) { taken.push(b[m.caps[k]]); b[m.caps[k]] = 0; }
    b[m.from] = 0;
    b[to] = m.crown ? p * 2 : p;
    pos.undo.push({ m: m, p: p, taken: taken, half: pos.half });
    pos.half = (m.caps.length || p === 1 || p === -1) ? 0 : pos.half + 1;
    pos.turn = -pos.turn;
    if (keepKeys !== false) pos.keys.push(key(pos));
  }

  function unmakeMove(pos, keepKeys) {
    var u = pos.undo.pop();
    if (!u) return;
    var b = pos.b, m = u.m;
    b[last(m)] = 0;
    b[m.from] = u.p;
    for (var k = 0; k < m.caps.length; k++) b[m.caps[k]] = u.taken[k];
    pos.half = u.half;
    pos.turn = -pos.turn;
    if (keepKeys !== false) pos.keys.pop();
  }

  /* Standard notation: 11-15 for a move, 15x24 or 15x24x31 for captures. */
  function notation(m) {
    var sq = [m.from].concat(m.path).map(function (x) { return x + 1; });
    return sq.join(m.caps.length ? "x" : "-");
  }
  function findMove(pos, forced, note) {
    var ms = generate(pos, forced);
    for (var k = 0; k < ms.length; k++) if (notation(ms[k]) === note) return ms[k];
    return null;
  }

  function count(pos) {
    var o = { bm: 0, bk: 0, rm: 0, rk: 0 };
    for (var k = 0; k < 32; k++) {
      var p = pos.b[k];
      if (p === 1) o.bm++; else if (p === 2) o.bk++; else if (p === -1) o.rm++; else if (p === -2) o.rk++;
    }
    return o;
  }

  /* { over, winner (BLACK | RED | 0 for a draw), reason } */
  function status(pos, forced) {
    if (!generate(pos, forced).length) {
      var n = count(pos), mine = pos.turn === BLACK ? n.bm + n.bk : n.rm + n.rk;
      return { over: true, winner: -pos.turn, reason: mine ? "no moves left" : "no pieces left" };
    }
    if (pos.half >= 80) return { over: true, winner: 0, reason: "the 40-move rule" };
    var k = pos.keys[pos.keys.length - 1], seen = 0;
    for (var j = 0; j < pos.keys.length; j++) if (pos.keys[j] === k) seen++;
    if (seen >= 3) return { over: true, winner: 0, reason: "threefold repetition" };
    return { over: false };
  }

  function perft(pos, depth, forced) {
    if (depth === 0) return 1;
    var ms = generate(pos, forced), n = 0;
    if (depth === 1) return ms.length;
    for (var k = 0; k < ms.length; k++) {
      makeMove(pos, ms[k], false);
      n += perft(pos, depth - 1, forced);
      unmakeMove(pos, false);
    }
    return n;
  }

  var api = {
    BLACK: BLACK, RED: RED, ROW: ROW, COL: COL, NB: NB, JP: JP, at: at,
    start: start, clone: clone, key: key, generate: generate, hasCapture: hasCapture,
    makeMove: makeMove, unmakeMove: unmakeMove, notation: notation, findMove: findMove,
    last: last, status: status, count: count, perft: perft, isCrownRow: isCrownRow
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.CheckersCore = api;
})(typeof self !== "undefined" ? self : this);
