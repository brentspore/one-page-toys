// Pose Decant for its card: a shelf part-sorted, a corked bottle or two, and a
// pour caught mid-stream. Real input only: a level link (#level=N, honored on
// hashchange), the H key for the game's own hint, and pointerdown taps on the
// canvas. Bottle positions are READ from window.__decant, which the toy only
// exposes to automated browsers (navigator.webdriver).
//
// ⚠ Pick a level without a lesson tip (tips sit on 1, 2, 10, 16 and 51), or it
//   shows in the card.
// ⚠ gen-card waits ~370ms after the eval resolves; a pour spends ~0.24s lifting
//   before the stream starts, so the final pour is fired un-awaited right after
//   the promise resolves, and the shot lands mid-stream.
(function () {
  var N = window.__poseLevel || 22, K = window.__poseMoves === undefined ? 12 : window.__poseMoves;
  var cv = document.getElementById("c");
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function tap(i) {
    var D = window.__decant, h = D.home(i), bw = D.bw(), r = cv.getBoundingClientRect();
    cv.dispatchEvent(new PointerEvent("pointerdown", { clientX: r.left + h.x, clientY: r.top + h.y - bw * 1.2, pointerId: 1, isPrimary: true, bubbles: true, cancelable: true }));
  }
  function idle() { return new Promise(function (res) { (function look() { if (!window.__decant.G.anims.length) return res(); requestAnimationFrame(look); })(); }); }
  function hinted() {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "h", bubbles: true, cancelable: true }));
    var h = window.__decant.G.hint;
    return h ? [h.a, h.b] : null;
  }
  location.hash = "level=" + N;
  return wait(900).then(function () {
    var chain = Promise.resolve();
    for (var k = 0; k < K; k++) {
      chain = chain.then(function () {
        var m = hinted();
        if (!m) return;
        tap(m[0]); tap(m[1]);
        return wait(60).then(idle).then(function () { return wait(40); });
      });
    }
    return chain.then(function () { return wait(900); });
  }).then(function () {
    var m = hinted();
    setTimeout(function () { if (m) { tap(m[0]); tap(m[1]); } }, 30);
  });
})();

// Regenerate (dev server on :8123, :3000 is taken on this machine):
//   node scripts/gen-card.cjs decant --base http://localhost:8123 --motion --size 760 --vw 760 --vh 900 \
//     --at 0 --eval "$(cat scripts/poses/decant.js)"
