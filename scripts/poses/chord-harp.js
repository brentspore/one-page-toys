// Pose Chord Harp for its card: pick a chord with more strings in it than C,
// then strum, so the capture shows lit strings mid-vibration against damped
// ones — the contrast that explains the instrument in one frame.
(function () {
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function pt(type, x, y) {
    var c = document.getElementById("canvas");
    c.dispatchEvent(new PointerEvent(type, {
      clientX: x, clientY: y, bubbles: true, pointerId: 1, isPrimary: true
    }));
  }
  var bars = document.querySelectorAll(".bar");
  if (bars[4]) bars[4].click();            // G7: four pitch classes, a full field
  var w = window.innerWidth, h = window.innerHeight;
  var y = h * 0.45;
  function sweep() {
    pt("pointerdown", w * 0.08, y);
    var p = Promise.resolve();
    for (var i = 1; i <= 14; i++) {
      (function (k) {
        p = p.then(function () {
          pt("pointermove", w * (0.08 + k * 0.062), y);
          return wait(22);
        });
      })(i);
    }
    return p.then(function () { pt("pointerup", w * 0.95, y); });
  }
  /* Two sweeps. One leaves the strings almost still by the time the shutter
   * opens — the visual amplitude decays in well under a second, so the card
   * came out as a set of straight lines with nothing happening. */
  /* Two awaited sweeps to fill the field, then a third that is deliberately
     NOT awaited: gen-card's --at clock only starts once this promise resolves,
     so returning early is what lets the shutter open in the middle of a strum
     rather than a second after the last one. */
  return wait(200).then(sweep).then(function () { return wait(240); }).then(function () {
    sweep();
  });
})();

/* Regenerate this toy's card + OG:
 *   python3 -m http.server 3000
 *   node scripts/gen-card.cjs chord-harp --size 1080 --vw 1500 --vh 1080 \
 *        --at 180 --motion --show ".bars" --eval "$(cat scripts/poses/chord-harp.js)"
 *   node scripts/gen-og.cjs chord-harp
 * Capture wide: the soundboard is a landscape panel and a square crop cuts the
 * chord bars and the rose. ⚠ --at is counted from AFTER this script's promise
 * resolves, not from page load — so it must be SMALL, and the last sweep is
 * left un-awaited so the capture lands mid-strum with the strings swinging.
 * --show ".bars" keeps the chord bars, which are the toy's identity.
 */
