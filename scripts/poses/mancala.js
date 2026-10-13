// Pose Mancala for its card: a real game against Juniper a dozen moves in, the pits
// uneven and the stores filling, caught mid-sowing with a handful of glass beads in
// the air. Every move is real input: H asks for the game's own hint, the pits are
// pressed with PointerEvents, and Space hurries the sowings in between. Pit positions
// are READ from window.__mancala, which the toy only exposes to automated browsers
// (navigator.webdriver).
//
// ⚠ Run gen-card with --motion: headless Chromium reports reduced motion, and the toy
//   then sows instantly, so there is no handful in the air to photograph.
// ⚠ gen-card hides the usual chrome; the counts button and the status note are this
//   toy's own, so the pose tucks them away, and C turns the seed counts off for a
//   cleaner board. Each run plays a different game (the regulars jitter), so treat it
//   as a candidate generator and pick by eye.
(function () {
  var MOVES = window.__poseMoves || 9;
  var cv = document.getElementById("canvas");
  var st = document.createElement("style");
  st.textContent = ".note, .counts-btn, .corner-btn { display: none !important; }";
  document.head.appendChild(st);
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function S() { return window.__mancala.state(); }
  function key(k) { document.body.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true })); }
  function press(i) {
    var c = window.__mancala.center(i), r = cv.getBoundingClientRect();
    var o = { clientX: r.left + c.x, clientY: r.top + c.y, pointerId: 7, isPrimary: true, bubbles: true, cancelable: true, pointerType: "mouse" };
    cv.dispatchEvent(new PointerEvent("pointerdown", o));
    cv.dispatchEvent(new PointerEvent("pointerup", o));
  }
  function until(fn, ms) {
    return new Promise(function (res) {
      var t0 = performance.now();
      (function look() { var s = S(); if (fn(s) || performance.now() - t0 > (ms || 15000)) return res(s); setTimeout(look, 40); })();
    });
  }
  /* hurry whatever is sowing, then wait for our turn */
  function ourTurn() {
    return until(function (s) {
      if (s.anim) { key(" "); key(" "); }
      return s.over || s.human === 0;
    });
  }
  function one() {
    return ourTurn().then(function (s) {
      if (s.over) return;
      key("h");
      return until(function (x) { return !x.thinking && (x.hint >= 0 || x.human < 0); }, 5000).then(function (x) {
        if (x.hint < 0) return;
        var h = x.history;
        press(x.hint);
        return until(function (y) { return y.history > h; }, 3000);
      });
    });
  }
  var cast = document.querySelectorAll(".foe");
  if (cast[3]) cast[3].click();                       /* Juniper */
  var chain = wait(700).then(function () { key("c"); });
  for (var i = 0; i < MOVES; i++) chain = chain.then(one);
  return chain.then(ourTurn).then(function (s) {
    /* the last move: the fullest pit we may play, for a big handful, left in the air */
    var best = -1, n = -1;
    s.legal.forEach(function (p) { if (s.b[p] > n) { n = s.b[p]; best = p; } });
    if (best >= 0) press(best);
    return wait(60);
  });
})();

// Regenerate a candidate (dev server on :8141). The toy has the owner's key art, which
// build-art-assets.cjs turns into its card and share image (cards/mancala.webp), so this
// PNG is the gameplay still for the day the art is dropped. The shipped still was
// three hinted moves in, frozen 470ms into the last sowing:
//   node scripts/gen-card.cjs mancala --base http://127.0.0.1:8141 --size 1080 --vw 1280 --vh 1400 --cropy 300 \
//     --motion --at 470 --eval "window.__poseMoves=3; $(cat scripts/poses/mancala.js)" --out assets/cards/mancala.png
