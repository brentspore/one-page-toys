/* Backgammon — the rules. Loaded by BOTH the page and the engine Worker
   (importScripts), so there is one move generator and the board can never disagree
   with the opponent about what is legal.

   A side's checkers live in an Int8Array(26) in that side's OWN numbering:
     1..24  the points, counted from that side's home (its 1-point) outward
     25     the bar
     0      borne off
   Checkers move from high numbers to low. A side's point i is the other side's
   point 25 - i. Most functions take (me, them) from the point of view of the side
   about to move.

   The rules that casual play gets wrong, all enforced here:
   - Both dice must be used if any legal play uses both. If only one can be used,
     it must be the larger when either could be used alone.
   - Doubles move four times, or as many times as possible.
   - A checker on the bar must enter before anything else moves.
   - Bearing off needs every checker home. A die bears off from its own point; a
     higher die may bear off from the highest occupied point only when no checker
     sits higher; otherwise it must be moved inside the board.
   - A step is {from, to, die, hit}. from 25 = the bar, to 0 = off. */
(function (root) {
  "use strict";

  function start() {
    var a = new Int8Array(26);
    a[24] = 2; a[13] = 5; a[8] = 3; a[6] = 5;
    return a;
  }

  function pips(a) {
    var s = 0;
    for (var i = 1; i <= 25; i++) s += a[i] * i;
    return s;
  }
  function count(a) { var n = 0; for (var i = 1; i <= 25; i++) n += a[i]; return n; }

  /* Every legal single step for one die value, pushed onto out. */
  function steps(me, them, d, out) {
    if (me[25] > 0) {
      var e = 25 - d;
      if (them[25 - e] < 2) out.push({ from: 25, to: e, die: d, hit: them[25 - e] === 1 });
      return out;
    }
    var home = true, high = 0;
    for (var i = 24; i >= 1; i--) {
      if (me[i]) { if (i > 6) { home = false; break; } if (!high) high = i; }
    }
    for (var f = 24; f >= 1; f--) {
      if (!me[f]) continue;
      var t = f - d;
      if (t >= 1) {
        if (them[25 - t] < 2) out.push({ from: f, to: t, die: d, hit: them[25 - t] === 1 });
      } else if (home && (t === 0 || f === high)) {
        out.push({ from: f, to: 0, die: d, hit: false });
      }
    }
    return out;
  }

  function apply(me, them, s) {
    me[s.from]--; me[s.to]++;
    if (s.hit) { them[25 - s.to]--; them[25]++; }
  }
  function undo(me, them, s) {
    me[s.to]--; me[s.from]++;
    if (s.hit) { them[25 - s.to]++; them[25]--; }
  }

  /* The deepest a play can go from here with these dice left (capped at need). */
  function depth(me, them, dice, need) {
    if (!dice.length || need <= 0) return 0;
    var best = 0, tried = {};
    for (var k = 0; k < dice.length; k++) {
      var d = dice[k];
      if (tried[d]) continue; tried[d] = 1;
      var rest = dice.slice(0, k).concat(dice.slice(k + 1));
      var ss = steps(me, them, d, []);
      for (var j = 0; j < ss.length; j++) {
        apply(me, them, ss[j]);
        var v = 1 + depth(me, them, rest, need - 1);
        undo(me, them, ss[j]);
        if (v > best) best = v;
        if (best >= need) return best;
      }
    }
    return best;
  }

  function diceOf(d1, d2) { return d1 === d2 ? [d1, d1, d1, d1] : [d1, d2]; }

  /* How a roll must be played from here: how many dice it can use, and, when only
     one of two different dice can be used, which one. */
  function rule(me, them, d1, d2) {
    var dice = diceOf(d1, d2);
    var max = depth(me, them, dice, dice.length);
    var only = 0;
    if (d1 !== d2 && max === 1) {
      var hi = Math.max(d1, d2), lo = Math.min(d1, d2);
      only = steps(me, them, hi, []).length ? hi : lo;
    }
    return { dice: dice, max: max, only: only };
  }

  /* The steps that keep the turn legal, given the dice still unplayed and how many
     steps the whole play must still make. This is what the page offers the player:
     any step that is the start of a legal play, in any order. */
  function validSteps(me, them, left, need, only) {
    var out = [];
    if (need <= 0) return out;
    var tried = {};
    for (var k = 0; k < left.length; k++) {
      var d = left[k];
      if (tried[d]) continue; tried[d] = 1;
      if (only && d !== only) continue;
      var rest = left.slice(0, k).concat(left.slice(k + 1));
      var ss = steps(me, them, d, []);
      for (var j = 0; j < ss.length; j++) {
        apply(me, them, ss[j]);
        var ok = need === 1 || depth(me, them, rest, need - 1) >= need - 1;
        undo(me, them, ss[j]);
        if (ok) out.push(ss[j]);
      }
    }
    return out;
  }

  /* A position key for the side that moved: its whole array plus which of the
     other side's points it hit (the only way it can change the other side). */
  function keyOf(me, mask) {
    return String.fromCharCode.apply(null, me) + mask;
  }

  /* Every distinct legal play for a roll: [{ steps, key }], one representative
     sequence per resulting position. Pass `rest` ({ dice, max, only }) to finish a
     turn that is already part played (the hint does this). */
  function plays(me, them, d1, d2, rest) {
    var r = rest || rule(me, them, d1, d2);
    var out = [], seen = {};
    if (r.max === 0) { out.push({ steps: [], key: keyOf(me, 0) }); return out; }
    var seq = [], memo = {};
    function rec(left, mask) {
      if (seq.length === r.max) {
        var k = keyOf(me, mask);
        if (!seen[k]) { seen[k] = 1; out.push({ steps: seq.slice(), key: k }); }
        return;
      }
      /* Doubles reach the same middle position many ways: explore each once. */
      if (r.dice.length > 2 && seq.length >= 1) {
        var mk = keyOf(me, mask) + "/" + seq.length;
        if (memo[mk]) return;
        memo[mk] = 1;
      }
      var tried = {};
      for (var k2 = 0; k2 < left.length; k2++) {
        var d = left[k2];
        if (tried[d]) continue; tried[d] = 1;
        if (r.only && d !== r.only) continue;
        var left2 = left.slice(0, k2).concat(left.slice(k2 + 1));
        var ss = steps(me, them, d, []);
        for (var j = 0; j < ss.length; j++) {
          var s = ss[j];
          apply(me, them, s); seq.push(s);
          if (seq.length === r.max || depth(me, them, left2, r.max - seq.length) >= r.max - seq.length) {
            rec(left2, s.hit ? (mask | (1 << s.to)) : mask);
          }
          seq.pop(); undo(me, them, s);
        }
      }
    }
    rec(r.dice, 0);
    return out;
  }

  /* After a game ends, how many points the winner takes per cube unit: 1 single,
     2 gammon (the loser has borne off nothing), 3 backgammon (and still has a
     checker on the bar or in the winner's home board). */
  function winKind(winner, loser) {
    if (loser[0] > 0) return 1;
    if (loser[25] > 0) return 3;
    for (var i = 19; i <= 24; i++) if (loser[i] > 0) return 3;  /* loser's 19..24 = winner's 1..6 */
    return 2;
  }

  /* Contact: can any checker of one side still meet one of the other's? */
  function contact(me, them) {
    var a = 0, b = 0;
    for (var i = 25; i >= 1; i--) if (me[i]) { a = i; break; }
    for (var j = 25; j >= 1; j--) if (them[j]) { b = j; break; }
    return a + b > 25;
  }

  /* A fair die from the platform's crypto source, rejection-sampled so no face is
     favored. */
  var rbuf = new Uint8Array(16), rpos = 16;
  function die() {
    for (;;) {
      if (rpos >= rbuf.length) {
        var c = (typeof crypto !== "undefined" && crypto.getRandomValues) ? crypto : null;
        if (c) c.getRandomValues(rbuf);
        else for (var i = 0; i < rbuf.length; i++) rbuf[i] = (Math.random() * 256) | 0;
        rpos = 0;
      }
      var v = rbuf[rpos++];
      if (v < 252) return 1 + (v % 6);
    }
  }

  var api = {
    start: start, pips: pips, count: count, steps: steps, apply: apply, undo: undo,
    depth: depth, rule: rule, validSteps: validSteps, plays: plays, keyOf: keyOf,
    diceOf: diceOf, winKind: winKind, contact: contact, die: die
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.BackgammonCore = api;
})(typeof self !== "undefined" ? self : this);
