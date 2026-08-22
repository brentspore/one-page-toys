/* Pose Steady Hand for its card.
 *
 * The frame that explains this toy is the loop mid-wire with the filament
 * running HOT under it — that one image says "these two must not touch". An
 * untouched wire is just a squiggle, so the pose starts a real run and rides
 * the rim rather than the safe centreline.
 *
 * Real input for starting; the ring position is set directly because a card
 * needs a repeatable frame, and a mouse path would land somewhere different
 * every run.
 */
(function () {
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  var btn = document.getElementById("ovBtn");
  if (btn) btn.click();

  return wait(320).then(function () {
    var S = window.__steady;
    if (!S) return;
    var w = S.wire, clr = S.clearance();
    var i = Math.floor(w.pts.length * 0.46);
    // walk up to the middle so the threaded section shows behind the loop
    S.setRing(w.startPt.x, w.startPt.y);
    S.forceLive();
    for (var k = 0; k < i; k++) { S.setRing(w.pts[k].x, w.pts[k].y); S.step(1 / 120); }
    // then sit hard against the rim so the wire runs white-hot
    var ax = w.pts[i + 1].x - w.pts[i].x, ay = w.pts[i + 1].y - w.pts[i].y;
    var L = Math.hypot(ax, ay) || 1;
    S.setRing(w.pts[i].x + (-ay / L) * (clr - 2), w.pts[i].y + (ax / L) * (clr - 2));
    S.step(1 / 120);
  });
})();
