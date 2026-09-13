// Pose Tiny Across for its card: a mini crossword part-way solved, two rows
// filled, the cursor mid-word on the third with its word highlighted, and the
// lower rows still waiting.
//
// Real input only. The toy picks a random practice puzzle, so to photograph
// the same one every time the pose plays a round through to the end with the
// toy's own "reveal whole puzzle", after marking every OTHER puzzle as seen in
// the toy's own storage key. "New puzzle" then has exactly one fresh choice.
//
// Regenerate: node scripts/gen-card.cjs tiny-across --base http://localhost:8000
//   --el ".tray" --at 450 --eval "$(cat scripts/poses/tiny-across.js)"
(function () {
  var WANT = "p10";            // #TUBS / MAPLE / ASPEN / STEED / HERD#
  var TYPE = "TUBSMAPLEAS";    // rows one and two, then two letters into ASPEN
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function key(k) { document.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true })); }
  function click(sel) { var el = document.querySelector(sel); if (el) el.click(); }

  var ids = (window.TA_PRACTICE || []).map(function (_, i) { return "p" + (i + 1); });
  localStorage.setItem("tinyacross_seen", JSON.stringify(ids.filter(function (id) { return id !== WANT; })));

  click("#startBtn");
  return wait(500)
    .then(function () {
      click("#helpBtn");
      click("#revealAllAsk");
      click('[data-act="reveal"][data-scope="puzzle"]');
      return wait(1100);
    })
    .then(function () {
      click('[data-go="new"]');
      return wait(1000);
    })
    .then(function () {
      var p = Promise.resolve();
      TYPE.split("").forEach(function (l) {
        p = p.then(function () { key(l); return wait(60); });
      });
      return p;
    })
    .then(function () { return wait(500); });
})()
