// Pose Meld for its card: a jar well filled with glass orbs, caught just after
// a melt so one of them is still white-hot. Real input only: the toy's own
// start button, then taps on the canvas exactly as a thumb drops them; no
// debug hook.
//
// ⚠ A card shows only the vertical MIDDLE of its square, and the OG shows the
// whole square, so the crop (--cropy) is set to sit on the pile, not the empty
// top of the jar.
// ⚠ Every run deals different drops and the physics is live, so this is a
// CANDIDATE generator: render a few and keep the best by eye.
(function () {
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  var c = document.getElementById("c");
  function tap(x, y) {
    var o = { clientX: x, clientY: y, pointerId: 7, pointerType: "touch", isPrimary: true, bubbles: true, cancelable: true };
    c.dispatchEvent(new PointerEvent("pointerdown", o));
    c.dispatchEvent(new PointerEvent("pointerup", o));
  }

  document.getElementById("ovBtn").click();

  var W = window.innerWidth, H = window.innerHeight, n = 0;
  return wait(600).then(function () {
    // sweep back and forth across the jar, a little ragged, like a person
    function loop() {
      if (n >= 58) return Promise.resolve();
      var u = (n * 0.37) % 1;
      var x = W * (0.12 + 0.76 * u) + (Math.random() - 0.5) * 30;
      tap(x, H * 0.5);
      n++;
      return wait(470).then(loop);
    }
    return loop();
  }).then(function () {
    // gen-card waits ~370ms after this resolves; these land mid-capture, so a
    // fresh melt is still glowing when the frame is taken
    setTimeout(function () { tap(W * 0.42, H * 0.5); }, 40);
  });
})();

// Regenerate (dev server on :8123 — :3000 is taken on this machine):
//   node scripts/gen-card.cjs meld --base http://localhost:8123 --motion --vw 1080 --vh 1920 \
//     --cropy 640 --at 300 --eval "$(cat scripts/poses/meld.js)"
