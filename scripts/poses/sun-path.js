// Pose Sun Path for its card: New York, the June solstice, the sun dragged to
// 4 PM while it is on the default southwest window, so the gold "sun on it"
// stretch of the arc runs through the middle of the dome. Real input only:
// the city picker's change event, a chip click, and pointer events on the dome
// (positions read from the automation-only handle).
// Run: node scripts/gen-card.cjs sun-path --dir tools --base http://localhost:8123 --el "#panel" --vw 560 --vh 1300 --size 560 --at 600 --eval "$(cat scripts/poses/sun-path.js)"
(function () {
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  var sel = document.getElementById("citySel");
  for (var i = 0; i < sel.options.length; i++) if (sel.options[i].textContent === "New York") sel.value = sel.options[i].value;
  sel.dispatchEvent(new Event("change", { bubbles: true }));
  document.querySelector('[data-jump="5-21"]').click();
  var dome = document.getElementById("dome");
  function pe(type, p) {
    dome.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId: 7, pointerType: "mouse", isPrimary: true,
      button: 0, buttons: type === "pointerup" ? 0 : 1, clientX: p.x, clientY: p.y
    }));
  }
  return wait(1100).then(function () {
    var a = window.__sunPath.handle("sun"), b = window.__sunPath.daySample(16 * 60);
    pe("pointerdown", a);
    for (var k = 1; k <= 14; k++) pe("pointermove", { x: a.x + (b.x - a.x) * k / 14, y: a.y + (b.y - a.y) * k / 14 });
    pe("pointerup", b);
    return wait(300);
  });
})();
