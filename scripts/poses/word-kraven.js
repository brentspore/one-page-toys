/* Pose Word Kraven for its card: dismiss the intro, then trace a REAL word out
 * of the grid and hold the gesture so the capture catches the game mid-hunt —
 * lit tiles, the freehand glow trail, and the word reading green above.
 *
 * ⚠ WHY THIS IS NOT A HARDCODED TRACE. Grids here are generated in the browser
 * from `Math.random()` with no seed, so a fixed path spells nonsense and the
 * card ends up advertising a struck-through dead word. That is what an earlier
 * version of this pose gave up on, settling for an untouched board — which
 * photographed as a dead grid: no trail, no found words, "0 of 51 · 0 pts".
 * Instead this SOLVES whatever grid it was dealt: it reads the letters out of
 * the DOM, fetches the toy's own `words.txt`, and searches it. Whatever word it
 * traces is genuinely there and genuinely valid.
 *
 * Still real input only, never a debug hook: letters come from `[data-index]`
 * text, positions from `getBoundingClientRect`, and the trace is dispatched as
 * PointerEvents that the toy's own handlers hit-test exactly like a finger.
 *
 * ⚠ Stops at TWO found words on purpose. `showCta()` reveals the feeder's CTA
 * block at three, which pushes the vertically-centred shell up and out of the
 * crop. Two is enough to put words on the board and move the meter.
 */
(function () {
  "use strict";

  var N = 4, MINLEN = 4, MAXLEN = 8;
  var grid = document.getElementById("grid");
  var ov = document.getElementById("ovBtn");
  if (ov && !ov.disabled) ov.click();

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function readLetters() {
    var out = [], t = grid.querySelectorAll("[data-index]");
    for (var i = 0; i < t.length; i++) {
      out[parseInt(t[i].getAttribute("data-index"), 10)] = t[i].textContent.trim().toLowerCase();
    }
    return out;
  }

  function centre(i) {
    var r = grid.querySelector('[data-index="' + i + '"]').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  function adjacent(a, b) {
    var ar = (a / N) | 0, ac = a % N, br = (b / N) | 0, bc = b % N;
    return a !== b && Math.abs(ar - br) <= 1 && Math.abs(ac - bc) <= 1;
  }

  /* The toy keeps its dictionary in a closure, so the pose loads its own copy
   * of the same file rather than reaching into the page. */
  function loadDict() {
    return fetch("words.txt").then(function (r) { return r.text(); }).then(function (text) {
      var words = Object.create(null), pre = Object.create(null);
      var arr = text.split("\n");
      for (var i = 0; i < arr.length; i++) {
        var w = arr[i].trim().toLowerCase();
        if (w.length < MINLEN || w.length > MAXLEN) continue;
        words[w] = 1;
        for (var k = 1; k <= w.length; k++) pre[w.slice(0, k)] = 1;
      }
      return { words: words, pre: pre };
    });
  }

  function solve(L, D) {
    var out = [], used = [], path = [];
    function walk(i, w) {
      w += L[i];
      if (!D.pre[w]) return;
      used[i] = 1; path.push(i);
      if (w.length >= MINLEN && D.words[w]) out.push({ w: w, path: path.slice() });
      if (w.length < MAXLEN) {
        for (var j = 0; j < N * N; j++) if (!used[j] && adjacent(i, j)) walk(j, w);
      }
      used[i] = 0; path.pop();
    }
    for (var s = 0; s < N * N; s++) walk(s, "");
    return out;
  }

  /* A good hero word photographs as a GESTURE: long enough to read as a hunt,
   * bent rather than a straight run down one column, and centred in the grid so
   * the trail sits in the band the gallery card actually shows. */
  function heroScore(c) {
    var p = c.path, bends = 0, rs = 0, cs = 0;
    for (var i = 0; i < p.length; i++) { rs += (p[i] / N) | 0; cs += p[i] % N; }
    for (var j = 2; j < p.length; j++) {
      var d1r = ((p[j - 1] / N) | 0) - ((p[j - 2] / N) | 0), d1c = (p[j - 1] % N) - (p[j - 2] % N);
      var d2r = ((p[j] / N) | 0) - ((p[j - 1] / N) | 0), d2c = (p[j] % N) - (p[j - 1] % N);
      if (d1r !== d2r || d1c !== d2c) bends++;
    }
    var mid = (N - 1) / 2;
    return c.w.length * 12 + bends * 9
      - Math.abs(rs / p.length - mid) * 14
      - Math.abs(cs / p.length - mid) * 8
      - (c.w.length > 7 ? 20 : 0);
  }

  function pe(type, x, y) {
    grid.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, composed: true,
      pointerId: 1, pointerType: "mouse", isPrimary: true,
      clientX: x, clientY: y, buttons: type === "pointerup" ? 0 : 1
    }));
  }

  /* Dispatch a dense, slightly bowed stroke. The trail draws every sampled
   * position, so straight centre-to-centre hops would render as a ruled
   * polyline; the alternating arc is what makes it read as a hand. */
  function trace(path, release) {
    var chain = Promise.resolve();
    var a = centre(path[0]);
    chain = chain.then(function () { pe("pointerdown", a.x, a.y); return sleep(16); });
    for (var s = 1; s < path.length; s++) {
      (function (s) {
        chain = chain.then(function () {
          var p0 = centre(path[s - 1]), p1 = centre(path[s]);
          var dx = p1.x - p0.x, dy = p1.y - p0.y;
          var nl = Math.hypot(-dy, dx) || 1, nx = -dy / nl, ny = dx / nl;
          var bow = 8 * (s % 2 ? 1 : -1), STEPS = 16, sub = Promise.resolve();
          for (var k = 1; k <= STEPS; k++) {
            (function (k) {
              sub = sub.then(function () {
                var t = k / STEPS, b = Math.sin(t * Math.PI) * bow;
                pe("pointermove", p0.x + dx * t + nx * b, p0.y + dy * t + ny * b);
                return sleep(6);
              });
            })(k);
          }
          return sub;
        });
      })(s);
    }
    if (release) {
      chain = chain.then(function () {
        var e = centre(path[path.length - 1]);
        pe("pointerup", e.x, e.y);
        return sleep(220);
      });
    }
    return chain;
  }

  return loadDict().then(function (D) {
    var all = solve(readLetters(), D);
    if (!all.length) return sleep(300);           // unsolvable draw: clean board beats a broken pose

    var hero = all.filter(function (c) { return c.w.length >= 5 && c.w.length <= 7; })
                  .sort(function (a, b) { return heroScore(b) - heroScore(a); })[0]
             || all.sort(function (a, b) { return b.w.length - a.w.length; })[0];

    // Two short words to bank first, so the board is not sitting at zero.
    // Five letters before four: the longer ones read as ordinary English, where
    // the four-letter leftovers of a random grid tend to be the obscure corners
    // of the dictionary and make the found list look like a typo.
    var seen = {}, banked = [];
    [5, 4].forEach(function (len) {
      all.forEach(function (c) {
        if (banked.length >= 2 || c.w === hero.w || seen[c.w] || c.w.length !== len) return;
        seen[c.w] = 1; banked.push(c);
      });
    });

    var chain = Promise.resolve();
    banked.forEach(function (c) { chain = chain.then(function () { return trace(c.path, true); }); });
    // Hero last, held down: the capture wants the gesture live, not committed.
    return chain.then(function () { return trace(hero.path, false); });
  });
})();

/* Regenerate this toy's card + OG (any port; pass the same one to --base if
 * 3000 is busy, as it is whenever another project's dev server is up):
 *   python3 -m http.server 3000
 *   node scripts/gen-card.cjs word-kraven --size 720 --vw 720 --vh 1000 \
 *        --cropy 69 --at 120 --motion --eval "$(cat scripts/poses/word-kraven.js)"
 *   node scripts/gen-og.cjs word-kraven
 *
 * ⚠ Every run deals a DIFFERENT grid and therefore a different word, so this is
 * a candidate generator, not a deterministic build step: render a handful, look
 * at them, and keep the one whose word reads as ordinary English and whose
 * trail sweeps the middle of the board. ANEMONE was chosen over LUTEUM,
 * DISTILL and BASTION on exactly that basis.
 * ⚠ Check the RENDERED gallery card, not this square: `.card__preview` shows
 * only a middle band (measured 287x118, so ~41% of the height).
 * ⚠ --at counts from AFTER this script's promise resolves, and the promise
 * resolves with the hero gesture still HELD DOWN. Keep --at short: it is only
 * there to let the last trail frame paint, and nothing releases the pointer.
 */
