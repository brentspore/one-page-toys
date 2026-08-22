/* Pose Pinball for its card.
 *
 * Everything here is REAL INPUT — click Play, charge the plunger with the
 * space bar, release it — because the card has to show a state a player can
 * actually reach. The only thing the pose reads is state (where the ball is,
 * whether a bumper just lit), never a hook that moves the ball for it.
 *
 * A launched ball spends most of its life in the lower half, but the card crop
 * shows the middle band of the table, so the pose WAITS for the ball to be up
 * among the pop bumpers with one of them still flashing. That is the frame that
 * explains the toy: neon table, lit bumper, ball in flight.
 */
(function () {
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function key(type, k) {
    window.dispatchEvent(new KeyboardEvent(type, { key: k, bubbles: true }));
  }

  function launch() {
    key("keydown", " ");
    return wait(900).then(function () { key("keyup", " "); });
  }

  /* Wait for the ball to be up among the pop bumpers with one still lit. A
   * single launch often does not get there — the ball can rattle the orbits and
   * come straight back down — so re-launch whenever it drains and keep trying.
   * The first version shot on a fixed deadline and caught an empty table. */
  function huntForTheShot(triesLeft) {
    var P = window.__pin;
    if (!P || triesLeft <= 0) return Promise.resolve();
    var t0 = Date.now();
    return new Promise(function (resolve) {
      (function look() {
        var b = P.ball;
        if (b.live) {
          var inField = b.y > 150 && b.y < 460;
          var lit = P.BUMPERS.some(function (q) { return q.flash > 0.3; });
          if (inField && lit) return resolve(true);
        }
        if (Date.now() - t0 > 5000) return resolve(false);
        requestAnimationFrame(look);
      })();
    }).then(function (got) {
      if (got) return true;
      // drained or never made it up: the game re-serves, so shoot again
      return wait(1400).then(launch).then(function () {
        return huntForTheShot(triesLeft - 1);
      });
    });
  }

  var btn = document.getElementById("ovBtn");
  if (btn) btn.click();

  return wait(240)
    .then(launch)
    .then(function () { return huntForTheShot(6); })
    .then(function () {
      // un-awaited on purpose: gen-card counts --at from after this resolves
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    });
})();
