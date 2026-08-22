/* Pose Dominoes for its card.
 *
 * The frame that explains this toy in one still is the WAVE: fallen tiles
 * behind it, standing tiles ahead, and the break between them. A finished run
 * is just a ribbon on the floor and an untouched one is just a line, so the
 * pose waits for roughly a third of the tiles to be down and shoots there.
 *
 * Real input only — click Start, click the Spiral preset, click Topple. The
 * only thing read is state, never a hook that moves tiles.
 */
(function () {
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function click(sel) {
    var el = document.querySelector(sel);
    if (el) el.click();
    return !!el;
  }

  click("#ovBtn");

  return wait(260).then(function () {
    click('[data-preset="spiral"]');
    return wait(500);
  }).then(function () {
    click("#btnGo");
    // Wait for the cascade to be about a third through, so the shot has both
    // a fallen ribbon and a standing run with the wave breaking between them.
    var D = window.__dom;
    var t0 = Date.now();
    return new Promise(function (resolve) {
      (function look() {
        if (!D) return resolve();
        var total = D.tiles.length;
        var down = 0;
        for (var i = 0; i < total; i++) if (D.tiles[i].state !== 0) down++;
        if (total && down / total > 0.34) return resolve();
        if (Date.now() - t0 > 6000) return resolve();
        requestAnimationFrame(look);
      })();
    });
  });
})();
