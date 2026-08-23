// Pose Skyscrapers for its card: a city part-way through being solved, with
// towers of every height standing and gaps still to fill.
//
// Driven entirely by the KEYBOARD — arrows to move the cursor, digits to set a
// height. That is real input, and it means the pose needs no knowledge of where
// the grid landed on screen, which a pointer pose would have had to duplicate
// from the layout maths.
(function () {
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function key(k) {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
  }

  var btn = document.getElementById("ovBtn");
  if (btn) btn.click();

  return wait(420).then(function () {
    // the HUD already says how big the grid is: "0/25"
    var m = (document.getElementById("filled").textContent || "").match(/\/(\d+)/);
    var n = Math.round(Math.sqrt(m ? +m[1] : 25));

    /* One gap per row AND per column, so no line is ever complete. A complete
     * line gets judged, and a judged line that does not match its clue turns
     * the chip red — a card full of red chips reads as a broken toy. */
    var hole = [];
    for (var r = 0; r < n; r++) hole.push((r * (n - 1) + 2) % n);

    key("ArrowRight");                       // the first arrow only takes the cursor
    var p = Promise.resolve();
    for (var rr = 0; rr < n; rr++) {
      for (var cc = 0; cc < n; cc++) {
        (function (rr, cc) {
          p = p.then(function () {
            if (cc !== hole[rr]) key(String(((rr + cc) % n) + 1));   // a Latin square: never conflicts
            key("ArrowRight");
            return wait(34);
          });
        })(rr, cc);
      }
      p = p.then(function () { key("ArrowDown"); return wait(34); });
    }
    /* Park the cursor mid-grid so the card shows a live selection, and do NOT
       await the last move: gen-card starts its --at clock when this resolves,
       so returning early is what keeps the placement bounce still running. */
    return p.then(function () {
      key("ArrowDown"); key("ArrowDown"); key("ArrowRight"); key("ArrowRight");
      var last = Math.max(1, n - 2);
      key(String(last));
    });
  });
})();
