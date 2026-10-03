// Pose Jettison for its card: a packed hold at its first jettison, caught with a
// module sliding out through its lit, open airlock. Real input only: a level
// link (#level=N, which the toy honours on hashchange), then the arrow keys
// and Enter exactly as a keyboard player drives it (arrows pick a module,
// Enter takes hold, arrows move it a cell at a time, pressing into its own
// airlock jettisons it). No debug hook: the pose steers the cursor with the
// toy's own nearest-module rule and plans each drag on the public rules
// (window.JettisonRules) and level pack (window.JETTISON_LEVELS).
//
// ⚠ Pick a level that is NOT the first of its stage, or its lesson tip shows
//   in the card (a fresh browser has seen no tips).
// ⚠ gen-card waits ~370ms after the eval resolves, and a module takes ~0.3s
//   to clear its airlock, so the final move is fired un-awaited AFTER the
//   promise resolves.
(function () {
  var N = window.__poseLevel || 38;          // level number, 1-based
  var K = window.__poseMoves;               // moves of the optimal line to play first (default: up to its first jettison, so the hold is still packed)
  var R = window.JettisonRules, raw = window.JETTISON_LEVELS[N - 1], L = R.prepare(raw);
  var st = L.start.slice(), cursor = 0, KEYS = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"];
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function key(k) {
    var shift = k === "Shift+Tab";
    window.dispatchEvent(new KeyboardEvent("keydown", { key: shift ? "Tab" : k, shiftKey: shift, bubbles: true, cancelable: true }));
  }
  function alive(i) { return st[2 * i] !== R.GONE; }
  function center(i) { var b = L.blocks[i]; return { x: st[2 * i] + b.info.w / 2, y: st[2 * i + 1] + b.info.h / 2 }; }
  function firstAlive() { for (var i = 0; i < L.blocks.length; i++) if (alive(i)) return i; return -1; }
  // the toy's own rule (script.js nearestFrom)
  function nearest(i, d) {
    var c0 = center(i), best = -1, bs = 1e9;
    for (var j = 0; j < L.blocks.length; j++) {
      if (j === i || !alive(j)) continue;
      var cj = center(j), vx = cj.x - c0.x, vy = cj.y - c0.y;
      var along = vx * R.DX[d] + vy * R.DY[d], side = Math.abs(vx * R.DY[d]) + Math.abs(vy * R.DX[d]);
      if (along <= 0.01) continue;
      var score = along + side * 2;
      if (score < bs) { bs = score; best = j; }
    }
    return best;
  }
  // the shortest run of arrow presses from the cursor to `target`, searched
  // over the toy's own cursor rule (a greedy walk can circle forever)
  function steer(target) {
    if (!alive(cursor)) cursor = firstAlive();
    var prev = {}, q = [cursor], seen = {};
    seen[cursor] = 1;
    while (q.length && !seen[target]) {
      var a = q.shift();
      for (var d = 0; d < 4; d++) {
        var n = nearest(a, d);
        if (n >= 0 && !seen[n]) { seen[n] = 1; prev[n] = [a, d]; q.push(n); }
      }
    }
    var out = [];
    if (seen[target]) for (var k = target; k !== cursor; k = prev[k][0]) out.unshift(KEYS[prev[k][1]]);
    else {
      // out of the arrows' reach: Tab through the modules in order instead
      // (the toy's tabFrom; the cursor is showing, since the pose has used keys)
      var j = cursor, back = target < cursor;
      while (j !== target) { do j += back ? -1 : 1; while (!alive(j)); out.push(back ? "Shift+Tab" : "Tab"); }
    }
    cursor = target;
    return out;
  }
  // the arrow keys that walk module i to (x, y), on the solver's own flood
  function route(i, x, y) {
    var re = R.reach(L, R.buildOcc(L, st), i, st[2 * i], st[2 * i + 1]);
    var k = x + y * 64, s = st[2 * i] + st[2 * i + 1] * 64, out = [];
    while (k !== s) {
      var p = re.parent[k], dx = (k % 64) - (p % 64), dy = Math.floor(k / 64) - Math.floor(p / 64);
      out.unshift(dx < 0 ? KEYS[0] : dx > 0 ? KEYS[1] : dy < 0 ? KEYS[2] : KEYS[3]);
      k = p;
    }
    return out;
  }
  function keysFor(m) {
    var ks = steer(m[0]).concat(["Enter"], route(m[0], m[1], m[2]));
    ks.push(m[3] >= 0 ? KEYS[m[3]] : "Enter");
    return ks;
  }
  function apply(m) { st[2 * m[0]] = m[3] >= 0 ? R.GONE : m[1]; st[2 * m[0] + 1] = m[3] >= 0 ? R.GONE : m[2]; }
  if (K === undefined) {
    K = 0;
    while (K < L.line.length - 1 && L.line[K][3] < 0) K++;
  }

  location.hash = "level=" + N;
  return wait(900).then(function () {
    var chain = Promise.resolve();
    L.line.slice(0, K).forEach(function (m) {
      chain = chain.then(function () { keysFor(m).forEach(key); apply(m); return wait(450); });
    });
    return chain.then(function () { return wait(700); });
  }).then(function () {
    var ks = keysFor(L.line[K]);
    setTimeout(function () { ks.forEach(key); }, 250);
  });
})();

// Regenerate (dev server on :8123 — :3000 is taken on this machine):
//   node scripts/gen-card.cjs jettison --base http://localhost:8123 --motion --size 760 --vw 760 --vh 900 \
//     --at 0 --eval "$(cat scripts/poses/jettison.js)"
