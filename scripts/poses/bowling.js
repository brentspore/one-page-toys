// Pose Bowling for its card: start a game and throw a hooking ball, so the
// capture lands on the pin-deck cut with the ball driving into the pocket.
// Uses only real pointer events — no debug hooks ship in this toy.
(function () {
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function pt(type, x, y) {
    var c = document.getElementById("canvas");
    c.dispatchEvent(new PointerEvent(type, {
      clientX: x, clientY: y, bubbles: true, pointerId: 1, isPrimary: true
    }));
  }
  var btn = document.getElementById("ovBtn");
  if (btn) btn.click();
  return wait(400).then(function () {
    var w = window.innerWidth, h = window.innerHeight;
    var sx = w * 0.545, sy = h * 0.42;
    pt("pointerdown", sx, sy);
    return wait(60)
      .then(function () { pt("pointermove", sx, h * 0.80); return wait(60); })
      .then(function () { pt("pointermove", w * 0.50, h * 0.80); return wait(30); })
      .then(function () { pt("pointerup", w * 0.50, h * 0.80); });
  });
})();

/* Regenerate this toy's card + OG:
 *   python3 -m http.server 3000
 *   node scripts/gen-card.cjs bowling --size 1080 --vw 1700 --vh 1700 \
 *        --at 1240 --motion --eval "$(cat scripts/poses/bowling.js)"
 *   node scripts/gen-og.cjs bowling
 * Rendering at 1700 and keeping the middle 1080 is a TIGHT LENS: the pin deck
 * camera sits ~4.7m back, so a 1:1 capture leaves the action small and far.
 * --at 1240 is the instant the ball is buried in the pins with the head pin
 * lifting. Retune it if MAX_POWER or the camera cut changes — raising the ball
 * speed moves the impact earlier.
 */
