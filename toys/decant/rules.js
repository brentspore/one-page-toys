/* Decant — the rules, shared by the game, the hint worker and the offline
 * level builder (scripts/build-decant-levels.cjs), so the shelf can never
 * disagree with the solver about what a pour does.
 *
 *   - Bottles hold up to `cap` layers of potion, listed bottom to top.
 *   - Pour from A to B: the top run of A (same color, all of it revealed)
 *     moves onto B if B is empty or its top layer is the same color, as much
 *     as fits.
 *   - Hidden layers start as "?" and are revealed the moment they become the
 *     top layer of their bottle. A pour only moves revealed layers, so the
 *     solver plays by exactly the player's rules (it simply knows the colors).
 *   - Solved: every bottle is empty or full of one color.
 *
 * A state is { t: [[color...]], h: [[hidden...]] } with t and h the same
 * shape. Colors are small integers.
 */
(function (root) {
  "use strict";

  function clone(S) { return { t: S.t.map(function (x) { return x.slice(); }), h: S.h.map(function (x) { return x.slice(); }) }; }
  function top(t) { return t.length ? t[t.length - 1] : -1; }

  // the run that would move: same color from the top, revealed layers only
  function run(S, a) {
    var t = S.t[a], h = S.h[a], c = top(t), k = 0;
    for (var i = t.length - 1; i >= 0 && t[i] === c && !h[i]; i--) k++;
    return k;
  }

  // how many layers pouring a -> b would move (0 = not allowed)
  function amount(S, cap, a, b) {
    if (a === b) return 0;
    var A = S.t[a], B = S.t[b];
    if (!A.length || B.length >= cap) return 0;
    if (B.length && top(B) !== top(A)) return 0;
    return Math.min(run(S, a), cap - B.length);
  }

  // do it, in place; returns { n, revealed } (revealed = bottle a's new top was hidden)
  function pour(S, cap, a, b) {
    var n = amount(S, cap, a, b);
    if (!n) return null;
    for (var k = 0; k < n; k++) { S.t[b].push(S.t[a].pop()); S.h[b].push(S.h[a].pop()); }
    var revealed = false, ha = S.h[a];
    if (ha.length && ha[ha.length - 1]) { ha[ha.length - 1] = false; revealed = true; }
    return { n: n, revealed: revealed };
  }

  function complete(t, cap) {
    if (t.length !== cap) return false;
    for (var i = 1; i < t.length; i++) if (t[i] !== t[0]) return false;
    return true;
  }
  function solved(S, cap) {
    for (var i = 0; i < S.t.length; i++) if (S.t[i].length && !complete(S.t[i], cap)) return false;
    return true;
  }

  // a move worth trying (prunes the pointless ones)
  function useful(S, cap, a, b) {
    var n = amount(S, cap, a, b);
    if (!n) return 0;
    var A = S.t[a];
    if (complete(A, cap)) return 0;                                   // a finished bottle stays put
    if (!S.t[b].length && run(S, a) === A.length && !S.h[a].some(Boolean)) return 0;   // a pure bottle into an empty one
    return n;
  }

  function moves(S, cap) {
    var out = [];
    for (var a = 0; a < S.t.length; a++) for (var b = 0; b < S.t.length; b++) {
      var n = useful(S, cap, a, b);
      if (n) out.push([a, b, n]);
    }
    return out;
  }

  // bottle order does not matter to the puzzle: sort them for the visited set
  function key(S) {
    var parts = [];
    for (var i = 0; i < S.t.length; i++) {
      var s = "";
      for (var j = 0; j < S.t[i].length; j++) s += String.fromCharCode(65 + S.t[i][j] + (S.h[i][j] ? 32 : 0));
      parts.push(s);
    }
    return parts.sort().join("|");
  }

  // how promising a move is: finish a bottle > pour onto its own color > into an empty one
  function score(S, cap, m) {
    var B = S.t[m[1]], A = S.t[m[0]];
    var s = 0;
    if (B.length && B.length + m[2] === cap && complete(B.concat(new Array(m[2]).fill(top(A))), cap)) s += 100;
    if (B.length) s += 20 + B.length;
    if (m[2] === run(S, m[0]) && A.length - m[2] === 0) s += 10;     // empties a bottle
    if (S.h[m[0]][A.length - m[2] - 1]) s += 6;                      // uncovers a hidden layer
    return s;
  }

  // depth-first, best moves first, with a visited set. Returns a list of
  // [from, to], or null: unsolvable, or it gave up (then api.lastCapped is
  // true, and "null" means "don't know", never "dead end").
  function solve(S0, cap, budget) {
    budget = budget || 200000;
    api.lastCapped = false;
    var seen = new Set([key(S0)]), path = [], found = null;
    var stack = [{ S: S0, ms: order(S0), i: 0 }];
    function order(S) { var ms = moves(S, cap); ms.sort(function (x, y) { return score(S, cap, y) - score(S, cap, x); }); return ms; }
    while (stack.length) {
      var f = stack[stack.length - 1];
      if (solved(f.S, cap)) { found = path.slice(); break; }
      if (seen.size > budget) { api.lastCapped = true; return null; }
      if (f.i >= f.ms.length) { stack.pop(); path.pop(); continue; }
      var m = f.ms[f.i++], S = clone(f.S);
      pour(S, cap, m[0], m[1]);
      var k = key(S);
      if (seen.has(k)) continue;
      seen.add(k);
      path.push([m[0], m[1]]);
      stack.push({ S: S, ms: order(S), i: 0 });
    }
    return found;
  }

  function stuck(S, cap) {
    for (var a = 0; a < S.t.length; a++) for (var b = 0; b < S.t.length; b++) if (amount(S, cap, a, b)) return false;
    return true;
  }

  var api = { lastCapped: false, clone: clone, top: top, run: run, amount: amount, pour: pour, complete: complete, solved: solved, moves: moves, key: key, solve: solve, stuck: stuck };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.DecantRules = api;
})(typeof self !== "undefined" ? self : this);
