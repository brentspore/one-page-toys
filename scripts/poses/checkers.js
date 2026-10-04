// Pose Checkers for its card: a real game a dozen moves in, with checkers taken
// and stacked on the barrel, and one picked up so its squares glow. Moves are real
// input: the H key asks for the game's own hint, and the squares are pressed with
// PointerEvents. Square positions are READ from window.__checkers, which the toy
// only exposes to automated browsers (navigator.webdriver).
//
// ⚠ gen-card hides the chrome; the photo is the board itself. Each run plays a
//   slightly different game (the opponents jitter), so treat it as a candidate
//   generator and pick by eye.
(function () {
  var N = window.__posePlies || 12;
  var cv = document.getElementById("canvas");
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function st() { return window.__checkers.state(); }
  function press(sq) {
    var c = window.__checkers.center(sq), r = cv.getBoundingClientRect();
    var o = { clientX: r.left + c.x, clientY: r.top + c.y, pointerId: 1, isPrimary: true, bubbles: true, cancelable: true };
    cv.dispatchEvent(new PointerEvent("pointerdown", o));
    cv.dispatchEvent(new PointerEvent("pointerup", o));
  }
  function until(fn, ms) {
    return new Promise(function (res) {
      var t0 = performance.now();
      (function look() { var s = st(); if (fn(s) || performance.now() - t0 > (ms || 8000)) return res(s); setTimeout(look, 40); })();
    });
  }
  function myTurn(s) { return s.over || (!s.thinking && !s.busy && s.turn === s.player); }
  function playOne() {
    return until(myTurn).then(function (s) {
      if (s.over) return;
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "h", bubbles: true }));
      return until(function (x) { return !!x.hint; }).then(function (x) {
        if (!x.hint) return;
        var sqs = x.hint.split(/[-x]/).map(function (n) { return +n - 1; });
        var chain = Promise.resolve();
        sqs.forEach(function (q, i) { chain = chain.then(function () { press(q); return wait(i ? 420 : 60); }); });
        return chain.then(function () { return until(function (y) { return y.history.length > x.history.length; }); });
      });
    });
  }
  var cast = document.querySelectorAll(".foe");
  if (cast[3]) cast[3].click();                     // Jasper Quill
  var chain = wait(900);
  for (var i = 0; i < N; i++) chain = chain.then(playOne);
  return chain.then(function () { return until(myTurn); }).then(function () {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "h", bubbles: true }));
    return until(function (x) { return !!x.hint; });
  }).then(function (x) {
    /* pick up the hinted checker: it lifts and its squares glow */
    if (x.hint) press(+x.hint.split(/[-x]/)[0] - 1);
    return wait(400);
  });
})();

// Regenerate (dev server on :8123, :3000 is taken on this machine):
//   node scripts/gen-card.cjs checkers --base http://localhost:8123 --size 1080 --vw 1280 --vh 1080 \
//     --at 300 --eval "$(cat scripts/poses/checkers.js)"
