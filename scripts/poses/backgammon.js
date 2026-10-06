// Pose Backgammon for a gameplay still: a real match against Captain Marek a dozen
// turns in, checkers hit and stacked, fresh dice on the board, and one checker picked
// up so its lit points and landing ghosts show. Every move is real input: R rolls, H
// asks the game's own hint, and the points are pressed with PointerEvents. Positions are
// READ from window.__backgammon, which the toy only exposes to automated browsers
// (navigator.webdriver).
//
// ⚠ The toy has the owner's key art, so its card and share image come from the art
//   (scripts/build-art-assets.cjs). Keep this pose for the day the art is dropped.
// ⚠ gen-card hides the usual chrome; the match score pill and the status note are
//   this toy's own, so the pose tucks them away too. Each run plays a different game
//   (the dice are random), so treat it as a candidate generator and pick by eye.
(function () {
  var TURNS = window.__poseTurns || 12;
  var cv = document.getElementById("canvas");
  var st = document.createElement("style");
  st.textContent = ".score, .note, .ask { display: none !important; }";
  document.head.appendChild(st);
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function S() { return window.__backgammon.state(); }
  function key(k) { window.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true })); }
  function press(own, top) {
    var c = window.__backgammon.slot(own, top), r = cv.getBoundingClientRect();
    var o = { clientX: r.left + c.x, clientY: r.top + c.y, pointerId: 1, isPrimary: true, bubbles: true, cancelable: true };
    cv.dispatchEvent(new PointerEvent("pointerdown", o));
    cv.dispatchEvent(new PointerEvent("pointerup", o));
  }
  function until(fn, ms) {
    return new Promise(function (res) {
      var t0 = performance.now();
      (function look() { var s = S(); if (fn(s) || performance.now() - t0 > (ms || 12000)) return res(s); setTimeout(look, 50); })();
    });
  }
  function mine(s) { return s.who === 0 && !s.busy && !s.askOpen && (s.phase === "opening" || s.phase === "preroll" || (s.phase === "moving" && s.sources.length > 0)); }
  /* one step of the hinted play */
  function step() {
    key("h");
    return until(function (s) { return s.hintSteps.length > 0; }, 4000).then(function (s) {
      if (!s.hintSteps.length) return;
      var f = s.hintSteps[0][0], t = s.hintSteps[0][1];
      press(f, f === 25);
      return wait(80).then(function () { press(t, false); return wait(120); });
    });
  }
  function turn() {
    return until(function (s) { return mine(s) || s.askOpen; }).then(function (s) {
      if (s.askOpen) { var b = document.querySelector("#askBtns button"); if (b) b.click(); return wait(300); }
      if (s.phase === "opening" || s.phase === "preroll") { key("r"); return wait(200); }
      if (s.phase === "moving") return step();
    });
  }
  var cast = document.querySelectorAll(".foe");
  if (cast[3]) cast[3].click();                     /* Captain Marek */
  var chain = wait(700), n = 0;
  for (var i = 0; i < TURNS * 3; i++) chain = chain.then(function () { n++; return turn(); });
  return chain.then(function () {
    /* end on a fresh roll of ours, a checker in hand */
    return until(function (s) { return s.who === 0 && (s.phase === "preroll" || s.phase === "moving") && !s.busy; });
  }).then(function (s) {
    if (s.phase === "preroll") key("r");
    return until(function (x) { return x.phase === "moving" && !x.busy && x.sources.length > 0; });
  }).then(function () {
    key("h");
    return until(function (s) { return s.hintSteps.length > 0; }, 4000);
  }).then(function (s) {
    if (s.hintSteps.length) press(s.hintSteps[0][0], s.hintSteps[0][0] === 25);
    return wait(400);
  });
})();

// Regenerate a candidate (dev server on :8123; :3000 is taken on this machine). The toy uses
// its key art for the card, so write to a scratch path unless the art is ever dropped:
//   node scripts/gen-card.cjs backgammon --base http://localhost:8123 --size 1080 --vw 1280 --vh 1080 \
//     --at 300 --eval "$(cat scripts/poses/backgammon.js)" --out /tmp/backgammon-card.png
