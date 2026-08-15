// Pose Twisty Cube for its card: scramble, then let the scramble animation
// finish so the capture is a solid, clearly-mixed cube rather than a blur.
(function () {
  var btn = document.getElementById("ovBtn");
  if (btn) btn.click();
  return new Promise(function (r) { setTimeout(r, 100); });
})();

/* Regenerate this toy's card + OG:
 *   python3 -m http.server 3000
 *   node scripts/gen-card.cjs twisty-cube --size 1080 --vw 1200 --vh 1200 \
 *        --at 4200 --motion --eval "$(cat scripts/poses/twisty-cube.js)"
 *   node scripts/gen-og.cjs twisty-cube
 * A 3x3 scramble is 25 quick turns at 55ms, so ~1.4s; --at 4200 leaves the
 * cube settled and the idle turntable at a three-quarter angle. Capture square
 * — the cube auto-frames itself to whatever aspect it is given.
 */
