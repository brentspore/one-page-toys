// Pose Reversi for its card: a real game against Alfie, twenty-odd discs down, caught
// a moment after Black sets down a disc that turns a long line, with the captured
// discs standing on their edges as the ripple runs outward.
//
// Every move is real input: Alfie is picked from the cast, and each disc is placed
// with mouse PointerEvents at a square's screen position, READ from window.__reversi
// (exposed only to automated browsers through navigator.webdriver). The moves are
// chosen with ReversiCore, the page's own rules file: keep the board busy and the
// count close, then play the move that turns the most discs.
//
// Set window.__posePreview = true first to photograph the flip preview instead: the
// pointer rests on that last square, and the discs it would turn lean up and glow.
//
// ⚠ Run gen-card with --motion: headless Chromium reports reduced motion, and the toy
//   then turns discs over instantly, so nothing is caught mid-turn.
// ⚠ gen-card hides the usual chrome; the status note and the corner buttons are this
//   toy's own, and the shared tickets fly in on a first visit, so the pose tucks them away.
// ⚠ gen-card waits 250ms after this resolves, then --at, then 120ms more. The disc
//   lands at 210ms and the first ring turns from about 280ms, so --at 0 to 120 catches
//   the wave. Alfie plays with a little chance, so each run is a different game:
//   treat it as a candidate generator and pick by eye.
(function () {
  var MIN_DISCS = window.__poseDiscs || 24, PREVIEW = !!window.__posePreview;
  var st = document.createElement("style");
  st.textContent = ".note, .corner-btn, .opt-tickets-fly { display: none !important; }";
  document.head.appendChild(st);
  var K = window.ReversiCore, cv = document.getElementById("canvas");
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function S() { return window.__reversi.state(); }
  function until(fn, ms) {
    return new Promise(function (res) {
      var t0 = performance.now();
      (function look() { var s = S(); if (fn(s) || performance.now() - t0 > (ms || 20000)) return res(s); setTimeout(look, 40); })();
    });
  }
  function point(s) {
    var c = window.__reversi.at(K.sx(s), K.sy(s)), r = cv.getBoundingClientRect();
    return { clientX: r.left + c.x, clientY: r.top + c.y, pointerId: 7, isPrimary: true, bubbles: true, cancelable: true, pointerType: "mouse" };
  }
  function hover(s) { cv.dispatchEvent(new PointerEvent("pointermove", point(s))); }
  function click(s) {
    var o = point(s);
    cv.dispatchEvent(new PointerEvent("pointermove", o));
    cv.dispatchEvent(new PointerEvent("pointerdown", o));
    cv.dispatchEvent(new PointerEvent("pointerup", o));
  }
  function flipsOf(s, b, me) { return K.flipsFor(Uint8Array.from(b), s, me).length; }
  /* early on: moves away from the edges that keep the count close, so the board
     fills in the middle with both colors */
  function choose(s) {
    var best = -1, bestScore = -1e9;
    s.legal.forEach(function (m) {
      var x = K.sx(m), y = K.sy(m), edge = Math.min(x, y, 7 - x, 7 - y), f = flipsOf(m, s.board, s.turn);
      var mine = (s.turn === 1 ? s.black : s.white) + f + 1, theirs = (s.turn === 1 ? s.white : s.black) - f;
      var score = -Math.abs(mine - theirs - 2) * 0.6 + (edge === 0 ? -3 : edge === 1 ? -1.5 : 0) + Math.random() * 1.5;
      if (score > bestScore) { bestScore = score; best = m; }
    });
    return best;
  }
  function biggest(s) {
    var best = -1, n = -1;
    s.legal.forEach(function (m) { var f = flipsOf(m, s.board, s.turn); if (f > n) { n = f; best = m; } });
    return { m: best, n: n };
  }
  function discs(s) { return s.black + s.white; }
  var chain = wait(300).then(function () {
    document.querySelectorAll(".foe")[0].click();                 /* Alfie */
    return wait(900);
  });
  function turn(k) {
    return until(function (s) { return s.myTurn || s.phase !== "play"; }).then(function (s) {
      if (s.phase !== "play" || k > 40) return true;
      var big = biggest(s);
      if (discs(s) >= MIN_DISCS && big.n >= 4) {
        if (PREVIEW) { hover(big.m); return wait(500).then(function () { return true; }); }
        click(big.m);                                              /* not awaited: the wave runs on */
        return true;
      }
      click(choose(s));
      return wait(120).then(function () { return turn(k + 1); });
    });
  }
  return chain.then(function () { return turn(0); });
})();

// Regenerate a candidate (dev server on :8159). Leave --at short so the discs are
// still turning:
//   node scripts/gen-card.cjs reversi --base http://127.0.0.1:8159 --size 1080 --vw 1280 --vh 1080 \
//     --motion --at 40 --eval "$(cat scripts/poses/reversi.js)" --out assets/cards/reversi.png
