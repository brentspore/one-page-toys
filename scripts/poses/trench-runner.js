// Pose Trench Runner for its card: mid-flight, a gun bracketed under the
// crosshair and the canal streaking past. No debug hook — it reads the screen
// the way a player does (amber = a gun, magenta = a gate) and flies with real
// PointerEvents, which is also exactly how the toy is played.
(function () {
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  var cv = document.getElementById("canvas");
  var g = cv.getContext("2d");

  function ev(t, x, y) {
    var e = new PointerEvent(t, {
      pointerId: 1, pointerType: "mouse", isPrimary: true,
      clientX: x, clientY: y, bubbles: true, cancelable: true
    });
    (t === "pointerdown" ? cv : window).dispatchEvent(e);
  }

  // Score a coarse grid: amber guns pull the crosshair in, magenta gates and
  // violet girders push it away. The same judgement the player is making.
  function aim() {
    var r = cv.width / cv.clientWidth;
    var x0 = Math.round(cv.clientWidth * 0.16), x1 = Math.round(cv.clientWidth * 0.84);
    var y0 = Math.round(cv.clientHeight * 0.18), y1 = Math.round(cv.clientHeight * 0.74);
    var d = g.getImageData(Math.round(x0 * r), Math.round(y0 * r),
                           Math.round((x1 - x0) * r), Math.round((y1 - y0) * r));
    var cols = 24, rows = 15, hz = [], gold = [], i;
    for (i = 0; i < cols * rows; i++) { hz.push(0); gold.push(0); }
    for (var y = 0; y < d.height; y += 2) {
      for (var x = 0; x < d.width; x += 2) {
        var o = (y * d.width + x) * 4, R = d.data[o], G2 = d.data[o + 1], B = d.data[o + 2];
        var ci = Math.min(cols - 1, (x / d.width * cols) | 0);
        var ri = Math.min(rows - 1, (y / d.height * rows) | 0);
        if (R > 70 && R > G2 * 1.9 && B > G2 * 1.2) hz[ri * cols + ci]++;          // gate
        else if (B > 150 && R > G2 + 20 && B > R + 40) hz[ri * cols + ci]++;       // girder
        else if (R > 150 && G2 > 110 && B < G2 * 0.8) gold[ri * cols + ci]++;      // gun
      }
    }
    var midC = (cols - 1) / 2, midR = (rows - 1) * 0.5, best = -1e9, bc = midC, br = midR;
    for (var r2 = 0; r2 < rows; r2++) {
      for (var c2 = 0; c2 < cols; c2++) {
        var near = 99;
        for (var r3 = 0; r3 < rows; r3++) {
          for (var c3 = 0; c3 < cols; c3++) {
            if (!hz[r3 * cols + c3]) continue;
            var dd = Math.hypot(c3 - c2, (r3 - r2) * 1.4);
            if (dd < near) near = dd;
          }
        }
        var sc = Math.min(near, 6) * 7 + (gold[r2 * cols + c2] ? 60 : 0)
               - Math.abs(c2 - midC) * 0.7 - Math.abs(r2 - midR) * 0.9;
        if (sc > best) { best = sc; bc = c2; br = r2; }
      }
    }
    return { x: x0 + (bc + 0.5) / cols * (x1 - x0), y: y0 + (br + 0.5) / rows * (y1 - y0),
             // how MUCH gold is in the aimed cell: a distant gun is a few
             // pixels, a close one is a lot — and only a close one photographs
             gunSize: gold[br * cols + bc] };
  }

  document.getElementById("ovBtn").click();

  return wait(400).then(function () {
    /* Fly for a while so the canal has real traffic in it — guns, a gate, some
     * girders — rather than the empty opening stretch. */
    var t0 = Date.now(), last = 0;
    function step() {
      var a = aim();
      ev("pointermove", a.x, a.y);
      if (Date.now() - last > 200) { last = Date.now(); ev("pointerdown", a.x, a.y); ev("pointerup", a.x, a.y); }
      if (Date.now() - t0 > 13000) return Promise.resolve();
      return wait(16).then(step);
    }
    return step();
  }).then(function () {
    // settle the crosshair ON a gun for the shot: brackets, gold reticle, and a
    // canal with something happening in it
    var t1 = Date.now();
    function hold() {
      var a = aim();
      ev("pointermove", a.x, a.y);
      if (a.gunSize > 55 || Date.now() - t1 > 9000) return Promise.resolve();
      return wait(16).then(hold);
    }
    return hold();
  });
})();
