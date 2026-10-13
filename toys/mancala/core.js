/* Mancala — the rules. Loaded by BOTH the page and the engine Worker (importScripts),
   so there is one move generator and the board can never disagree with the opponent
   about what is legal.

   One board, two rulesets. The board is an Int8Array(14):
     0..5    side 0's pits, left to right from side 0's seat (side 0 = you, or Player 1)
     6       side 0's store
     7..12   side 1's pits, left to right from side 1's seat
     13      side 1's store
   Sowing runs counter-clockwise: 0 → 5, store 6, 7 → 12, store 13, back to 0. Pit i
   faces pit 12 - i across the board.

   KALAH (6 pits, 4 seeds): sow one seed per pit from the next pit on, through your own
   store and past your opponent's. Last seed in your store: move again. Last seed in an
   empty pit of your own, with seeds opposite: take both into your store (nothing
   happens when the pit opposite is empty). When either row is empty after a move, the
   game ends and each side banks what is left on its own row. A Kalah game always ends:
   between store drops every seed only moves toward its own side's store.

   OWARE, abapa rules: the stores are never sown into; they only hold captures. A pit
   of 12 or more skips its own pit on each lap. Last seed on the far side making a pit
   2 or 3: take it, and keep taking backwards while the pits stay on the far side and
   hold 2 or 3. A capture that would take every seed the other side has takes nothing
   (the grand slam). If the other side is empty you must give them seeds; when you
   cannot, the game ends and you take everything left. First to 25 wins at once. A
   third repetition of the same position, or 120 plies without a capture, ends the
   game with each side taking what is on its own row. */
(function (root) {
  "use strict";

  var KALAH = "kalah", OWARE = "oware";
  var STORE = [6, 13];
  var QUIET_LIMIT = 120;

  function storeOf(side) { return side === 0 ? 6 : 13; }
  function sideOfPit(i) { return i <= 6 ? 0 : 1; }
  function isPit(i) { return i !== 6 && i !== 13 && i >= 0 && i <= 12; }
  function onRow(i, side) { return side === 0 ? (i >= 0 && i <= 5) : (i >= 7 && i <= 12); }
  function rowSum(b, side) {
    var o = side === 0 ? 0 : 7;
    return b[o] + b[o + 1] + b[o + 2] + b[o + 3] + b[o + 4] + b[o + 5];
  }
  function opposite(i) { return 12 - i; }
  function nextHouse(i) { return i === 5 ? 7 : i === 12 ? 0 : i + 1; }
  function prevHouse(i) { return i === 7 ? 5 : i === 0 ? 12 : i - 1; }

  function emptyBoard() {
    var b = new Int8Array(14);
    for (var i = 0; i < 14; i++) if (isPit(i)) b[i] = 4;
    return b;
  }

  /* ---------- low level: a single sowing, in place ----------
     Both return the last pit sown into and fill `path` (when given) with every pit a
     seed dropped into, in order. Kalah: { last, extra, cap } where cap is the seeds
     banked by a capture (the last seed counted). Oware: { last, cap, grand, caps } where
     caps lists [pit, n] taken, in the order they are taken (backwards from the last). */
  function sowKalah(b, side, pit, path) {
    var n = b[pit], skip = side === 0 ? 13 : 6, st = side === 0 ? 6 : 13, i = pit;
    b[pit] = 0;
    while (n > 0) {
      i = i === 13 ? 0 : i + 1;
      if (i === skip) continue;
      b[i]++; n--;
      if (path) path.push(i);
    }
    var cap = 0, opp = 12 - i;
    if (i !== st && onRow(i, side) && b[i] === 1 && b[opp] > 0) {
      cap = b[opp] + 1;
      b[st] += cap; b[i] = 0; b[opp] = 0;
    }
    return { last: i, extra: i === st, cap: cap, opp: opp };
  }

  function sowOware(b, side, pit, path) {
    var n = b[pit], i = pit;
    b[pit] = 0;
    while (n > 0) {
      i = nextHouse(i);
      if (i === pit) continue;              /* a lap never refills the pit it came from */
      b[i]++; n--;
      if (path) path.push(i);
    }
    var other = 1 - side, total = 0, caps = [], j = i;
    while (onRow(j, other) && (b[j] === 2 || b[j] === 3)) {
      caps.push([j, b[j]]); total += b[j];
      j = prevHouse(j);
    }
    var grand = false;
    if (total > 0) {
      if (total === rowSum(b, other)) { grand = true; caps = []; total = 0; }
      else {
        var st = side === 0 ? 6 : 13;
        for (var k = 0; k < caps.length; k++) { b[st] += caps[k][1]; b[caps[k][0]] = 0; }
      }
    }
    return { last: i, cap: total, grand: grand, caps: caps };
  }

  /* Does sowing this pit drop at least one seed on the other row? (Oware feeding) */
  function feeds(b, side, pit) {
    var n = b[pit];
    return side === 0 ? n >= 6 - pit : n >= 13 - pit;
  }

  /* Legal pits for `side`. Oware: when the other row is empty, only moves that feed it. */
  function legalOn(b, side, rules) {
    var o = side === 0 ? 0 : 7, out = [];
    var mustFeed = rules === OWARE && rowSum(b, 1 - side) === 0;
    for (var p = o; p < o + 6; p++) {
      if (!b[p]) continue;
      if (mustFeed && !feeds(b, side, p)) continue;
      out.push(p);
    }
    return out;
  }

  /* ---------- the game ---------- */
  function keyOf(b, turn) {
    var s = turn ? "b" : "a";
    for (var i = 0; i < 14; i++) s += String.fromCharCode(65 + b[i]);
    return s;
  }

  function start(rules, first) {
    var pos = { rules: rules === OWARE ? OWARE : KALAH, b: emptyBoard(), turn: first ? 1 : 0, plies: 0, quiet: 0,
      reps: {}, over: false, result: null };
    pos.reps[keyOf(pos.b, pos.turn)] = 1;
    return pos;
  }

  function clone(pos) {
    var reps = {};
    for (var k in pos.reps) reps[k] = pos.reps[k];
    return { rules: pos.rules, b: new Int8Array(pos.b), turn: pos.turn, plies: pos.plies, quiet: pos.quiet,
      reps: reps, over: pos.over, result: pos.result };
  }

  function legal(pos) { return pos.over ? [] : legalOn(pos.b, pos.turn, pos.rules); }

  /* Why a pit cannot be played, or "" when it can. */
  function whyNot(pos, pit) {
    if (pos.over) return "over";
    if (!onRow(pit, pos.turn)) return "theirs";
    if (!pos.b[pit]) return "empty";
    if (pos.rules === OWARE && rowSum(pos.b, 1 - pos.turn) === 0 && !feeds(pos.b, pos.turn, pit)) return "feed";
    return "";
  }

  /* Each side banks what is left on its own row. */
  function sweepOwn(b) {
    var out = [];
    for (var side = 0; side < 2; side++) {
      var o = side === 0 ? 0 : 7, st = storeOf(side);
      for (var p = o; p < o + 6; p++) if (b[p]) { out.push({ pit: p, n: b[p], to: st }); b[st] += b[p]; b[p] = 0; }
    }
    return out;
  }
  /* One side takes everything left on the board. */
  function sweepAll(b, side) {
    var out = [], st = storeOf(side);
    for (var p = 0; p < 13; p++) if (isPit(p) && b[p]) { out.push({ pit: p, n: b[p], to: st }); b[st] += b[p]; b[p] = 0; }
    return out;
  }

  function finish(pos, reason, sweep) {
    pos.over = true;
    var s0 = pos.b[6], s1 = pos.b[13];
    pos.result = { scores: [s0, s1], winner: s0 > s1 ? 0 : s1 > s0 ? 1 : -1, reason: reason, sweep: sweep || [] };
  }

  /* Play a legal pit. Mutates pos and returns everything the page needs to animate
     it: the drop path, the capture, the extra turn and how the game ended. */
  function play(pos, pit) {
    if (whyNot(pos, pit)) throw new Error("illegal pit " + pit);
    var b = pos.b, side = pos.turn;
    var rec = { pit: pit, side: side, n: b[pit], path: [], last: -1, extra: false, caps: [], grand: false, end: null };
    if (pos.rules === KALAH) {
      var r = sowKalah(b, side, pit, rec.path);
      rec.last = r.last; rec.extra = r.extra;
      if (r.cap) rec.caps = [{ pit: r.last, n: 1, to: storeOf(side) }, { pit: r.opp, n: r.cap - 1, to: storeOf(side) }];
      pos.plies++;
      pos.quiet = r.cap ? 0 : pos.quiet + 1;
      if (rowSum(b, 0) === 0 || rowSum(b, 1) === 0) {
        finish(pos, "empty", sweepOwn(b));
      } else {
        pos.turn = r.extra ? side : 1 - side;
      }
    } else {
      var o = sowOware(b, side, pit, rec.path);
      rec.last = o.last; rec.grand = o.grand;
      rec.caps = o.caps.map(function (c) { return { pit: c[0], n: c[1], to: storeOf(side) }; });
      pos.plies++;
      pos.quiet = o.cap ? 0 : pos.quiet + 1;
      var next = 1 - side;
      if (b[6] >= 25 || b[13] >= 25) finish(pos, "25");
      else if (b[6] === 24 && b[13] === 24) finish(pos, "split");
      else if (!legalOn(b, next, OWARE).length) {
        /* the side to move cannot play: either the other row is empty and cannot be
           fed (they take everything), or they have nothing at all */
        if (rowSum(b, next) > 0) finish(pos, "nofeed", sweepAll(b, next));
        else finish(pos, "stuck", sweepOwn(b));
      } else {
        pos.turn = next;
        var key = keyOf(b, next);
        pos.reps[key] = (pos.reps[key] || 0) + 1;
        if (pos.reps[key] >= 3) finish(pos, "repeat", sweepOwn(b));
        else if (pos.quiet >= QUIET_LIMIT) finish(pos, "quiet", sweepOwn(b));
      }
    }
    if (pos.over) rec.end = pos.result;
    return rec;
  }

  /* Where the seeds of a pit would go, without playing it: for the landing preview. */
  function preview(pos, pit) {
    if (whyNot(pos, pit)) return null;
    var p = clone(pos);
    var rec = play(p, pit);
    var counts = {};
    rec.path.forEach(function (i) { counts[i] = (counts[i] || 0) + 1; });
    var taken = 0;
    rec.caps.forEach(function (c) { taken += c.n; });
    return { path: rec.path, counts: counts, last: rec.last, extra: rec.extra && !p.over, caps: rec.caps, taken: taken, grand: rec.grand, over: p.over };
  }

  function total(b) { var s = 0; for (var i = 0; i < 14; i++) s += b[i]; return s; }

  var api = {
    KALAH: KALAH, OWARE: OWARE, STORE: STORE, QUIET_LIMIT: QUIET_LIMIT,
    storeOf: storeOf, sideOfPit: sideOfPit, isPit: isPit, onRow: onRow, rowSum: rowSum, opposite: opposite,
    nextHouse: nextHouse, prevHouse: prevHouse, feeds: feeds,
    sowKalah: sowKalah, sowOware: sowOware, legalOn: legalOn,
    start: start, clone: clone, legal: legal, whyNot: whyNot, play: play, preview: preview, keyOf: keyOf, total: total
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MancalaCore = api;
})(typeof self !== "undefined" ? self : this);
