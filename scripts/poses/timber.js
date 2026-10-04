// Pose Timber for its card: the tower standing, one block caught half way out,
// lit as it is when you hold it. Real input only: the start button, then a
// pointer pressed on the block's visible end and dragged along its length, and
// left held down, so gen-card photographs the block mid-pull. Block positions are
// READ from window.__timber, which the toy only exposes to automated browsers.
(function () {
  var LV = window.__poseLevel || 5, SLOT = window.__poseSlot === undefined ? 1 : window.__poseSlot, FRAC = 0.5;
  var cv = document.getElementById("canvas");
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function ev(type, x, y) {
    var r = cv.getBoundingClientRect();
    cv.dispatchEvent(new PointerEvent(type, { clientX: r.left + x, clientY: r.top + y, pointerId: 1, isPrimary: true, bubbles: true, cancelable: true, buttons: 1 }));
  }
  document.getElementById("ovBtn").click();
  return wait(1800).then(function () {
    var T = window.__timber, bl = T.blocks.filter(function (b) { return b.lv === LV && b.slot === SLOT; })[0];
    var p = bl.body.position, ax = bl.body.quaternion.vmult(new p.constructor(1, 0, 0));
    /* pull toward whichever end faces the camera, so the block comes out at us */
    var e1 = T.project([p.x + ax.x * 0.3, p.y, p.z + ax.z * 0.3]), e2 = T.project([p.x - ax.x * 0.3, p.y, p.z - ax.z * 0.3]);
    var dir = T.pickBlock(e1[0], e1[1]) === bl ? 1 : -1;
    var a = T.project([p.x + ax.x * 0.3 * dir, p.y, p.z + ax.z * 0.3 * dir]);
    var c = T.project([p.x + ax.x * (0.3 + 0.75 * FRAC) * dir, p.y, p.z + ax.z * (0.3 + 0.75 * FRAC) * dir]);
    ev("pointerdown", a[0], a[1]);
    var chain = Promise.resolve();
    for (var i = 1; i <= 20; i++) (function (k) {
      chain = chain.then(function () { ev("pointermove", a[0] + (c[0] - a[0]) * k / 20, a[1] + (c[1] - a[1]) * k / 20); return wait(45); });
    })(i);
    return chain.then(function () { return wait(300); });
  });
})();

// Regenerate (dev server on :8123, :3000 is taken on this machine):
//   node scripts/gen-card.cjs timber --base http://localhost:8123 --size 1080 --vw 1080 --vh 1080 \
//     --at 200 --eval "$(cat scripts/poses/timber.js)"
