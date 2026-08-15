// Pose Claw Machine for its card: start a run, steer the claw over the middle
// of the pit and drop, so the capture lands mid-lift with a prize in the jaws.
// Real pointer events and the toy's own DROP button — no debug hooks.
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
  return wait(500).then(function () {
    var w = window.innerWidth, h = window.innerHeight;
    // steer to the middle-right of the tray, where the pile is deepest
    var sx = w * 0.545, sy = h * 0.50;
    pt("pointerdown", sx, sy);
    pt("pointermove", sx, sy);
    pt("pointerup", sx, sy);
    return wait(900).then(function () {
      document.getElementById("dropBtn").click();
    });
  });
})();

/* Regenerate this toy's card + OG:
 *   python3 -m http.server 3000
 *   node scripts/gen-card.cjs claw-machine --size 1080 --vw 1400 --vh 1400 \
 *        --at 5200 --motion --eval "$(cat scripts/poses/claw-machine.js)"
 *   node scripts/gen-og.cjs claw-machine
 * --at 5200 is during the lift, after the jaws have closed and before the claw
 * reaches the chute: descend ~0.6s + close 0.42s + lift ~0.8s from the drop at
 * ~1.4s. Retune it if the winch speeds in updateClaw change.
 */
