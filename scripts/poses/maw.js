// Pose Maw for its card: the ring of fangs, creatures climbing the flesh, and
// you on the lip at nine o'clock spitting light down your lane toward the
// throat. Real input only — the toy's own start button and keyboard, exactly as
// a player drives it; no debug hook.
//
// ⚠ A card shows only the vertical MIDDLE of this square, so the creature is
// walked round from its start at the bottom to the left-hand side of the rim,
// where it (and its shot) land inside that band.
// ⚠ Each run spawns creatures in different lanes, so this is a CANDIDATE
// generator: render a few and keep the best by eye.
(function () {
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function key(type, code) { window.dispatchEvent(new KeyboardEvent(type, { code: code, bubbles: true, cancelable: true })); }
  function tap(code) { key("keydown", code); key("keyup", code); }

  document.getElementById("ovBtn").click();
  // the flare button is the toy's own chrome, not the scene
  document.getElementById("flareBtn").style.visibility = "hidden";

  return wait(1400).then(function () {
    // from the bottom lane, four steps left puts you at nine o'clock
    var steps = [0, 1, 2, 3];
    return steps.reduce(function (p) {
      return p.then(function () { tap("ArrowLeft"); return wait(120); });
    }, Promise.resolve());
  }).then(function () {
    // let the well fill: climbers need a few seconds to come up out of the dark
    var t0 = Date.now();
    function loop() {
      if (Date.now() - t0 > 9400) return Promise.resolve();
      tap("Space");
      return wait(650).then(loop);
    }
    return loop();
  }).then(function () {
    // gen-card waits ~370ms after this resolves, and a shot crosses the whole
    // well in 0.4s — so the photographed shots are fired LATER, un-awaited
    setTimeout(function () { tap("Space"); }, 160);
    setTimeout(function () { tap("Space"); }, 290);
  });
})();

// Regenerate (dev server on :8123 — :3000 is taken on this machine):
//   node scripts/gen-card.cjs maw --base http://localhost:8123 --motion --at 0 \
//     --eval "$(cat scripts/poses/maw.js)"
