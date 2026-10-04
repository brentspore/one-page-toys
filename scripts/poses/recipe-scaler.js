// Pose Recipe Scaler for its card: the cookie sample doubled with the 2x chip
// (amounts rolled, stamp down), then the eggs line pressed so its "how many
// eggs do you have?" sticky note is open, nudged down to 3. Real clicks and
// pointer events only. Returns a promise; Playwright's evaluate awaits it.
(function () {
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function tap(el) {
    var r = el.getBoundingClientRect();
    var o = { bubbles: true, cancelable: true, clientX: r.left + 30, clientY: r.top + r.height / 2, pointerId: 1, pointerType: "mouse", button: 0, isPrimary: true };
    el.dispatchEvent(new PointerEvent("pointerdown", o));
    el.dispatchEvent(new PointerEvent("pointerup", o));
    el.click();
  }
  tap(document.querySelector('#chips button[data-f="2"]'));
  return wait(2300).then(function () {
    var lines = document.querySelectorAll("#lines .ln.is-have"), egg = null;
    for (var i = 0; i < lines.length; i++) if (/eggs/.test(lines[i].textContent)) { egg = lines[i]; break; }
    if (egg) tap(egg);
    return wait(450);
  }).then(function () {
    tap(document.getElementById("haveMinus"));
    return wait(250);
  });
})();

// Regenerate (dev server on :8123):
// node scripts/gen-card.cjs recipe-scaler --dir tools --base http://localhost:8123 --el ".desk" --size 1080 --motion --at 400 --eval "$(cat scripts/poses/recipe-scaler.js)"
