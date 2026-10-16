// Pose Go for its card: a real game against Hana, fifteen-odd stones down, caught a
// moment after Black takes a group, with the captured stones in the air on their way
// to the lid and the ring on the last stone played.
//
// Every move is real input: the lesson is closed with its own buttons, Hana is picked
// from the cast, and each stone is placed with PointerEvents at a point's screen
// position, READ from window.__go (exposed only to automated browsers through
// navigator.webdriver). The moves are chosen with GoCore, the page's own rules file:
// take anything that captures, otherwise press the weakest white group.
//
// ⚠ Run gen-card with --motion: headless Chromium reports reduced motion, and the toy
//   then drops stones and captures instantly, so nothing is in the air.
// ⚠ gen-card hides the usual chrome; the status note, the corner buttons and the count
//   sheet are this toy's own, so the pose tucks them away.
// ⚠ Hana is random enough that each run plays a different game: treat it as a
//   candidate generator and pick by eye.
(function () {
  var MIN_STONES = window.__poseStones || 15;
  var st = document.createElement("style");
  st.textContent = ".note, .corner-btn, .count { display: none !important; }";
  document.head.appendChild(st);
  var K = window.GoCore, cv = document.getElementById("canvas");
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function S() { return window.__go.state(); }
  function until(fn, ms) {
    return new Promise(function (res) {
      var t0 = performance.now();
      (function look() { var s = S(); if (fn(s) || performance.now() - t0 > (ms || 15000)) return res(s); setTimeout(look, 40); })();
    });
  }
  function click(p) {
    var c = window.__go.at(K.px(p), K.py(p)), r = cv.getBoundingClientRect();
    var o = { clientX: r.left + c.x, clientY: r.top + c.y, pointerId: 7, isPrimary: true, bubbles: true, cancelable: true, pointerType: "mouse" };
    cv.dispatchEvent(new PointerEvent("pointermove", o));
    cv.dispatchEvent(new PointerEvent("pointerdown", o));
    cv.dispatchEvent(new PointerEvent("pointerup", o));
  }
  /* a position GoCore can try moves on (superko is the page's business: we only
     choose among the moves it says are legal) */
  function posOf(s) {
    var p = K.start(0);
    p.b = Uint8Array.from(s.board); p.turn = s.turn; p.seen = {}; p.prev = "";
    var h = K.hashBoard(p.b); p.h1 = h[0]; p.h2 = h[1];
    return p;
  }
  function choose(s) {
    var pos = posOf(s), me = s.turn, best = 0, bestScore = -1e9;
    s.legal.forEach(function (p) {
      var r = K.tryMove(pos, p);
      if (!r.ok) return;
      var b = Uint8Array.from(pos.b); b[p] = me; r.caps.forEach(function (q) { b[q] = 0; });
      var mine = K.libertiesAt(b, p);
      if (mine < 2 && !r.caps.length) return;
      var score = r.caps.length * 100;
      /* press white: the fewer liberties left on a neighboring white group, the better */
      K.DIRS.forEach(function (d) { var q = p + d; if (b[q] === 3 - me) score += 12 / K.libertiesAt(b, q); });
      var x = K.px(p), y = K.py(p), edge = Math.min(x, y, 8 - x, 8 - y);
      score += edge === 0 ? -6 : edge === 1 ? -1 : 0;
      score += Math.random() * 2;
      if (score > bestScore) { bestScore = score; best = p; }
    });
    return { p: best, captures: bestScore >= 100 };
  }
  var lesson = document.getElementById("lesson");
  var chain = wait(300).then(function () {
    for (var i = 0; i < 5 && !lesson.hidden; i++) document.getElementById("lessonNext").click();
    document.querySelectorAll(".foe")[0].click();               /* Hana */
    return wait(900);
  });
  function stones(s) { var n = 0; s.board.forEach(function (v) { if (v === 1 || v === 2) n++; }); return n; }
  function turn(k) {
    return until(function (s) { return s.myTurn || s.phase !== "play"; }).then(function (s) {
      if (s.phase !== "play" || k > 60) return true;
      var c = choose(s);
      if (!c.p) return true;
      var done = c.captures && stones(s) >= MIN_STONES;
      click(c.p);
      return done ? wait(60).then(function () { return true; }) : wait(120).then(function () { return turn(k + 1); });
    });
  }
  return chain.then(function () { return turn(0); });
})();

// Regenerate a candidate (dev server on :8147). Leave --at short so the captured
// stones are still in the air:
//   node scripts/gen-card.cjs go --base http://127.0.0.1:8147 --size 1080 --vw 1280 --vh 1080 \
//     --motion --at 260 --eval "$(cat scripts/poses/go.js)" --out assets/cards/go.png
