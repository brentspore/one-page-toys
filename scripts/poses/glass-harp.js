// Pose Glass Harp for its card: rub across the middle of the rank so several
// glasses are lit and their water is rippling when the shutter opens.
(function () {
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function pt(type, x, y) {
    var c = document.getElementById("canvas");
    c.dispatchEvent(new PointerEvent(type, {
      clientX: x, clientY: y, bubbles: true, pointerId: 1, isPrimary: true
    }));
  }
  var w = window.innerWidth, h = window.innerHeight;
  var y = h * 0.55;
  pt("pointerdown", w * 0.30, y);
  var p = Promise.resolve();
  for (var i = 1; i <= 10; i++) {
    (function (k) {
      p = p.then(function () {
        pt("pointermove", w * (0.30 + k * 0.042), y);
        return wait(28);
      });
    })(i);
  }
  return p;
})();

/* Regenerate this toy's card + OG:
 *   python3 -m http.server 3000
 *   node scripts/gen-card.cjs glass-harp --size 1080 --vw 1500 --vh 1080 \
 *        --at 1500 --motion --eval "$(cat scripts/poses/glass-harp.js)"
 *   node scripts/gen-og.cjs glass-harp
 * The rank is wide and short, so capture wide and let `cover` crop it: a square
 * viewport puts most of the frame above the rims. --at 1500 catches the glasses
 * still lit — `drive` decays over roughly a second after the finger lifts.
 */
