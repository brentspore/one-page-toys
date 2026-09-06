// Pose Chess for its card: a real opening, played out — pieces developed and the
// king castled — rather than the untouched starting array, which photographs as a
// box of pieces rather than a game.
//
// Driven entirely by the KEYBOARD, like the Skyscrapers pose. That is real input,
// and it means the pose needs no knowledge of where the board landed on screen —
// which a pointer pose would have had to duplicate from the projection maths.
//
// ⚠ moveCursor() refuses to step off the board, so spamming Down/Left HOMES the
// cursor on a1. Every navigation below is absolute from that corner, so the pose
// cannot drift as earlier moves change what is selected.
(function () {
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function key(k) {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
  }
  // ⚠ NOT (n || 1): a zero-delta navigation must press ZERO times, and the
  // default-argument idiom fires once for n === 0. That bug moved every
  // cursor one square past its target and turned 1.e4 into 1.e3.
  function press(k, n) { if (n === undefined) n = 1; for (var i = 0; i < n; i++) key(k); }

  // The Architect: a solid opening book, so black's replies look like real chess.
  var cast = document.querySelectorAll(".foe");
  if (cast[3]) cast[3].click();

  // ⚠ Spawn the cursor with an ARROW, never Enter: if the cursor already exists,
  // Enter selects a piece or plays a move, and an earlier version of this pose
  // scrambled the whole position that way.
  function goTo(file, rank) {
    key("ArrowUp");                                 // creates the cursor if absent
    press("ArrowDown", 9); press("ArrowLeft", 9);   // home on a1
    press("ArrowRight", file); press("ArrowUp", rank);
  }
  // Select at (f0,r0) then play to (f1,r1).
  function move(f0, r0, f1, r1) {
    goTo(f0, r0);
    key("Enter");
    return wait(90).then(function () {
      press("ArrowRight", f1 - f0 > 0 ? f1 - f0 : 0);
      press("ArrowLeft", f0 - f1 > 0 ? f0 - f1 : 0);
      press("ArrowUp", r1 - r0 > 0 ? r1 - r0 : 0);
      press("ArrowDown", r0 - r1 > 0 ? r0 - r1 : 0);
      key("Enter");
      return wait(2600);                // engine thinks, then both moves animate
    });
  }

  return wait(700)
    .then(function () { return move(4, 1, 4, 3); })   // 1. e4
    .then(function () { return move(6, 0, 5, 2); })   // 2. Nf3
    .then(function () { return move(5, 0, 2, 3); })   // 3. Bc4
    .then(function () { return move(4, 0, 6, 0); })   // 4. O-O  (king two squares)
    .then(function () {
      // Leave nothing selected and no caret showing: a highlighted square, a ring
      // of move dots or a dashed cursor all read as UI, not as a chess position.
      // A pointer press off the board clears both without moving anything.
      var cv = document.getElementById("canvas");
      cv.dispatchEvent(new PointerEvent("pointerdown", { clientX: 2, clientY: 2, bubbles: true }));
      return wait(600);
    });
})()
