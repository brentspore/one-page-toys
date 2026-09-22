// Pose Untangle for its card: level 2's ten stars part-way out of the knot —
// some filaments already cooled to white, several still burning red — with one
// star lifted and held under the cursor.
//
// No debug hook. The stars are found the way a player finds them, by looking at
// the screen: read the canvas back and cluster the bright cores, then drag with
// real PointerEvents.
//
// ⚠ Two traps this has already fallen into, both worth keeping in mind for any
// canvas pose that moves things around:
//   1. A plain "fewest crossings" search heaps every star into one corner,
//      because crossing count says nothing about spacing. Candidates are a grid
//      across the frame and a move must also leave the star clear of its
//      neighbours.
//   2. Re-reading the star list inside the search loop RESHUFFLES it — the
//      clusters come back in scan order, so `list[i]` stops meaning the same
//      star the moment anything moves, and the search starts dragging whatever
//      happens to be i-th now. The list is read ONCE per sweep and this file
//      keeps its own copy up to date; drags are exact, so the copy stays true.
(function () {
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  var canvas = document.getElementById("canvas");
  var g = canvas.getContext("2d");
  var MIN = Math.min(innerWidth, innerHeight);

  function stars() {
    var d = g.getImageData(0, 0, canvas.width, canvas.height);
    var W = canvas.width, H = canvas.height, seen = new Uint8Array(W * H), out = [];
    function bright(o) { return d.data[o] > 236 && d.data[o + 1] > 236 && d.data[o + 2] > 236; }
    for (var i = 0; i < W * H; i++) {
      if (seen[i] || !bright(i * 4)) continue;
      var q = [i], sx = 0, sy = 0, n = 0;
      seen[i] = 1;
      while (q.length) {
        var p = q.pop(), px = p % W, py = (p / W) | 0;
        sx += px; sy += py; n++;
        for (var dy = -1; dy <= 1; dy++) {
          for (var dx = -1; dx <= 1; dx++) {
            var nx = px + dx, ny = py + dy;
            if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
            var k = ny * W + nx;
            if (seen[k] || !bright(k * 4)) continue;
            seen[k] = 1; q.push(k);
          }
        }
      }
      if (n >= 40) out.push({ x: sx / n, y: sy / n });   // the crossing pips are far smaller
    }
    var ratio = canvas.width / canvas.clientWidth;
    return out.map(function (p) { return { x: p.x / ratio, y: p.y / ratio }; });
  }

  function crossings() { return +document.getElementById("crossings").textContent; }

  function ev(type, x, y) {
    (type === "pointerdown" ? canvas : window).dispatchEvent(new PointerEvent(type, {
      pointerId: 1, pointerType: "mouse", isPrimary: true,
      clientX: x, clientY: y, bubbles: true, cancelable: true,
      buttons: type === "pointerup" ? 0 : 1
    }));
  }

  // A drag translates the star by exactly (to - from), so dragging back by the
  // same vector returns it precisely — which is what lets a trial be undone
  // without looking at the screen again.
  function drag(from, to, hold) {
    ev("pointerdown", from.x, from.y);
    for (var i = 1; i <= 4; i++) {
      ev("pointermove", from.x + (to.x - from.x) * i / 4, from.y + (to.y - from.y) * i / 4);
    }
    if (!hold) ev("pointerup", to.x, to.y);
  }

  function grid() {
    // The gallery crops to the middle band of the image, so the rows stay off
    // the extreme top and bottom: a star parked at y=0.12 is cropped away.
    var out = [];
    for (var r = 0; r < 5; r++) {
      for (var c = 0; c < 6; c++) {
        out.push({ x: innerWidth * (0.1 + c * 0.16), y: innerHeight * (0.26 + r * 0.12) });
      }
    }
    return out;
  }

  function ring() {
    var out = [];
    for (var i = 0; i < 26; i++) {
      var a = i / 26 * Math.PI * 2;
      var rad = (0.3 + 0.62 * ((i % 3) / 2)) * MIN * 0.42;
      out.push({ x: innerWidth / 2 + Math.cos(a) * rad, y: innerHeight / 2 + Math.sin(a) * rad });
    }
    return out;
  }

  function clearOf(pt, pos, skip, min) {
    for (var i = 0; i < pos.length; i++) {
      if (i === skip) continue;
      if (Math.hypot(pos[i].x - pt.x, pos[i].y - pt.y) < min) return false;
    }
    return true;
  }

  function pull(cands, gap, stopAt, moves, sweeps, budgetMs) {
    var t0 = Date.now(), taken = 0;
    for (var s = 0; s < sweeps; s++) {
      var pos = stars();                 // read ONCE, then keep it current by hand
      var before = crossings();
      for (var i = 0; i < pos.length; i++) {
        if (crossings() <= stopAt || taken >= moves || Date.now() - t0 > budgetMs) return;
        var here = pos[i], best = crossings(), at = null;
        for (var k = 0; k < cands.length; k++) {
          if (!clearOf(cands[k], pos, i, gap)) continue;
          drag(here, cands[k]);
          var c = crossings();
          if (c < best) { best = c; at = cands[k]; }
          drag(cands[k], here);          // exact undo
          if (best <= stopAt) break;
        }
        if (at) { drag(here, at); pos[i] = at; taken++; }
      }
      if (crossings() >= before) return; // a sweep that gained nothing will not gain more
    }
  }

  document.getElementById("ovBtn").click();

  return wait(400).then(function () {
    pull(ring(), MIN * 0.06, 0, 999, 7, 30000);   // clear level 1 outright
    return wait(2600);                            // let the finish ripple play out
  }).then(function () {
    /* ⚠ The finish overlay is the ONLY thing that makes this button advance a
     * level. Clicking it while the overlay is hidden just restarts the level
     * you are on, which is how an earlier run quietly photographed level 1. */
    var overlay = document.getElementById("overlay");
    if (overlay.hidden || overlay.classList.contains("is-out")) {
      throw new Error("pose: level 1 was not solved, so level 2 was never reached");
    }
    document.getElementById("ovBtn").click();     // on to level 2: ten stars
    return wait(600);
  }).then(function () {
    pull(grid(), MIN * 0.1, 8, 8, 2, 40000);      // a few moves; stop with red still showing
    var list = stars();
    if (list.length < 6) throw new Error("pose: only " + list.length + " stars on screen");
    // the star nearest the middle reads best under a cursor at this crop
    var cx = innerWidth / 2, cy = innerHeight / 2, pick = 0, bd = Infinity;
    for (var i = 0; i < list.length; i++) {
      var d = Math.hypot(list[i].x - cx, list[i].y - cy);
      if (d < bd) { bd = d; pick = i; }
    }
    /* Hold it down and never release: the held star keeps its lifted halo and
     * its ring, which is what makes the card a moment of play. */
    drag(list[pick], { x: list[pick].x + 30, y: list[pick].y - 24 }, true);
  });
})();
