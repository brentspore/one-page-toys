/* Chess — No. 118.
   Obsidian and alabaster under one warm key light, on a gently tilted board.

   The board is drawn with a real perspective projection rather than a flat grid,
   so pieces have height and cast shadows, but the tilt is kept shallow (26 degrees
   off vertical) because a chess position has to be READ, not just admired — a
   proper tabletop camera shrinks the far rank until the back pieces are guesswork.

   Pieces are surfaces of revolution, which is what a real set is: turned on a
   lathe. Each is rendered ONCE into a sprite by stacking shaded elliptical rings
   from a profile curve, then blitted and scaled by depth. Rendering the rings
   every frame would be ~2000 gradient fills per frame; baking them costs nothing
   after the first paint and the camera never moves, so the shading stays correct. */
(function () {
  "use strict";

  var C = window.ChessCore;
  var canvas = document.getElementById("canvas");
  var ctx = canvas.getContext("2d");

  /* ---------- camera ----------
     TILT is measured from straight-down. THETA is the rotation that carries the
     camera onto the view axis; sin/cos of it are used constantly, so they are
     hoisted out. */
  /* How far a piece hides the rank behind it is exactly height * tan(TILT), which
     is the whole readability budget. At 26 degrees pieces were squashed to 44% and
     looked like bottles; at 38 the king swallowed 1.4 ranks and the back row became
     guesswork. 31.5 degrees puts the king at ~1.1 ranks — real height, nothing
     hidden — with the board's depth still 85% of its width. */
  var TILT = 0.550;
  var THETA = Math.PI / 2 - TILT;
  var SIN = Math.sin(THETA), COS = Math.cos(THETA);
  var CAM_D = 15.0, FOCAL = 1000, CX = 0, CY = 0;

  function project(x, y, z) {
    var ry = y * COS - z * SIN;
    var rz = y * SIN + z * COS;
    var depth = CAM_D - rz;
    var s = FOCAL / depth;
    return { x: CX + x * s, y: CY - ry * s, s: s, d: depth };
  }
  /* Scale in px per board-unit at a given board row — used to size sprites. */
  function scaleAt(z) { return FOCAL / (CAM_D - z * COS); }

  /* ---------- board mapping ---------- */
  var flip = false;
  function fileRankToWorld(file, rank) {
    return flip
      ? { x: 3.5 - file, z: rank - 3.5 }
      : { x: file - 3.5, z: 3.5 - rank };
  }

  /* ---------- materials ---------- */
  var MAT = {
    light: {                                  /* alabaster */
      base: [234, 226, 210], hi: [255, 251, 240], lo: [118, 108, 92],
      amb: [44, 38, 30], spec: 0.34, specPow: 24, rim: [255, 216, 156], rimAmt: 0.17,
      sss: 0.20
    },
    dark: {                                   /* obsidian: near-black polished stone.
      The rim is deliberately small — it only has to hold the silhouette against a
      dark square, and any more turns black marble into copper. */
      base: [24, 26, 32], hi: [66, 74, 90], lo: [3, 4, 6],
      amb: [7, 8, 11], spec: 1.15, specPow: 64, rim: [226, 170, 102], rimAmt: 0.24,
      sss: 0.0
    }
  };
  /* The key art rings every piece with a brass collar at the base; it is most of
     what makes the set read as a real object rather than carved soap. */
  MAT.gold = {
    base: [198, 158, 86], hi: [255, 234, 172], lo: [86, 60, 22],
    amb: [26, 19, 7], spec: 0.92, specPow: 30, rim: [255, 220, 158], rimAmt: 0.52, sss: 0
  };
  var GOLD_BAND = [0.050, 0.084];

  var LIGHT = norm([-0.52, 0.74, 0.42]);
  var VIEW = norm([0, Math.cos(TILT), Math.sin(TILT)]);

  function norm(v) {
    var l = Math.hypot(v[0], v[1], v[2]);
    return [v[0] / l, v[1] / l, v[2] / l];
  }
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function mix(a, b, t) { return a + (b - a) * t; }

  /* Shade one point of a turned surface: diffuse against the key, a Blinn
     specular, and a fresnel rim. The rim is what stops the obsidian pieces from
     reading as black holes on a dark board — without it they lose their silhouette
     entirely against the dark squares. */
  function shade(mat, n) {
    var d = clamp01(n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]);
    var h = norm([LIGHT[0] + VIEW[0], LIGHT[1] + VIEW[1], LIGHT[2] + VIEW[2]]);
    var sp = Math.pow(clamp01(n[0] * h[0] + n[1] * h[1] + n[2] * h[2]), mat.specPow) * mat.spec;
    var nv = clamp01(n[0] * VIEW[0] + n[1] * VIEW[1] + n[2] * VIEW[2]);
    var fres = Math.pow(1 - nv, 3) * mat.rimAmt;
    /* A little light bleeding through the shadow side reads as stone rather than plastic. */
    var wrap = mat.sss * clamp01(0.35 + 0.65 * (1 - d));

    var r = mix(mat.lo[0], mat.hi[0], d) + mat.amb[0] + sp * 255 + fres * mat.rim[0] + wrap * mat.base[0] * 0.35;
    var g = mix(mat.lo[1], mat.hi[1], d) + mat.amb[1] + sp * 255 + fres * mat.rim[1] + wrap * mat.base[1] * 0.30;
    var b = mix(mat.lo[2], mat.hi[2], d) + mat.amb[2] + sp * 255 + fres * mat.rim[2] + wrap * mat.base[2] * 0.24;
    return "rgb(" + byte(r) + "," + byte(g) + "," + byte(b) + ")";
  }
  /* Clamp to a channel. Written as its own function on purpose: the inline version
     of this was `r | 0 > 255 ? 255 : clamp(r)`, and `>` binds tighter than `|`, so
     it evaluated as `r | clamp(r)` — a bitwise OR that saturated red past 255 and
     turned every obsidian piece bright pink. */
  function byte(v) {
    v = v | 0;
    return v < 0 ? 0 : v > 255 ? 255 : v;
  }

  /* ---------- piece profiles ----------
     [heightFraction, radius] control points, radius in board units. Sampled and
     smoothed into a lathe; the smoothing is what turns straight segments between
     control points into the soft curves a real turned piece has. */
  var PROFILE = {};
  PROFILE[C.PAWN] = { h: 1.06, p: [
    [0.00,0.355],[0.045,0.350],[0.075,0.318],[0.100,0.252],[0.135,0.203],
    [0.195,0.163],[0.335,0.139],[0.445,0.149],[0.500,0.199],[0.545,0.204],
    [0.590,0.149],[0.645,0.150],[0.705,0.200],[0.795,0.225],[0.885,0.199],
    [0.960,0.118],[1.00,0.020]] };
  PROFILE[C.ROOK] = { h: 1.14, p: [
    [0.00,0.368],[0.048,0.362],[0.082,0.330],[0.112,0.276],[0.152,0.250],
    [0.300,0.238],[0.470,0.236],[0.560,0.252],[0.640,0.246],[0.700,0.290],
    [0.760,0.304],[0.792,0.300],[0.815,0.256],[1.00,0.252]] };
  /* ⚠ latheTo: sampleProfile CLAMPS past the last control point, so without this
     the knight's lathe carries a full-height cylinder of radius 0.192 all the way
     to the top — a literal lollipop stick, with the flat head pasted on the front
     of it. The lathe has to stop where the sculpted head takes over. */
  PROFILE[C.KNIGHT] = { h: 1.34, latheTo: 0.345, p: [
    [0.00,0.362],[0.048,0.356],[0.082,0.324],[0.112,0.266],[0.152,0.226],
    [0.235,0.200],[0.310,0.196],[0.340,0.192]] };
  PROFILE[C.BISHOP] = { h: 1.40, p: [
    [0.00,0.358],[0.045,0.352],[0.080,0.320],[0.108,0.256],[0.150,0.202],
    [0.230,0.161],[0.335,0.141],[0.430,0.151],[0.480,0.201],[0.522,0.206],
    [0.562,0.151],[0.612,0.156],[0.682,0.206],[0.762,0.216],[0.842,0.186],
    [0.900,0.120],[0.930,0.074],[0.958,0.086],[0.986,0.058],[1.00,0.014]] };
  PROFILE[C.QUEEN] = { h: 1.52, p: [
    [0.00,0.378],[0.045,0.372],[0.082,0.338],[0.112,0.272],[0.155,0.217],
    [0.240,0.174],[0.360,0.154],[0.470,0.165],[0.520,0.214],[0.562,0.220],
    [0.602,0.167],[0.662,0.177],[0.732,0.232],[0.792,0.264],[0.842,0.274],
    [0.872,0.252],[0.902,0.242],[0.940,0.100],[0.968,0.088],[1.00,0.052]] };
  PROFILE[C.KING] = { h: 1.72, p: [
    [0.00,0.378],[0.045,0.372],[0.082,0.338],[0.112,0.272],[0.155,0.217],
    [0.245,0.172],[0.380,0.152],[0.480,0.162],[0.530,0.212],[0.572,0.218],
    [0.612,0.165],[0.672,0.174],[0.742,0.224],[0.802,0.252],[0.852,0.260],
    [0.882,0.238],[0.906,0.224],[0.930,0.122],[0.952,0.106],[1.00,0.030]] };

  var RINGS = 168;
  function sampleProfile(prof) {
    var r = new Float32Array(RINGS), i, k = 0;
    for (i = 0; i < RINGS; i++) {
      var t = i / (RINGS - 1);
      while (k < prof.length - 2 && prof[k + 1][0] < t) k++;
      var a = prof[k], b = prof[k + 1];
      var u = b[0] === a[0] ? 0 : (t - a[0]) / (b[0] - a[0]);
      r[i] = a[1] + (b[1] - a[1]) * clamp01(u);
    }
    /* Two light smoothing passes: the lathe rounds every corner, and this is what
       separates a turned piece from a stack of cylinders. */
    for (var pass = 0; pass < 2; pass++) {
      var c2 = new Float32Array(r);
      for (i = 1; i < RINGS - 1; i++) r[i] = c2[i - 1] * 0.25 + c2[i] * 0.5 + c2[i + 1] * 0.25;
    }
    return r;
  }

  /* ---------- sprite rendering ---------- */
  var sprites = {};
  var SPRITE_UNIT = 64;

  function makeSprite(type, isWhite, unit) {
    var prof = PROFILE[type];
    var radii = sampleProfile(prof.p);
    var mat = isWhite ? MAT.light : MAT.dark;
    var maxR = 0;
    for (var i = 0; i < RINGS; i++) if (radii[i] > maxR) maxR = radii[i];
    if (type === C.QUEEN || type === C.KING) maxR = Math.max(maxR, 0.30);

    var pad = Math.ceil(unit * 0.16);
    var topExtra = (type === C.KING ? 0.30 : type === C.QUEEN ? 0.12 : 0) * unit * COS;
    /* ⚠ The TOP ring is an ellipse too, and it rises `r * SIN` ABOVE the piece's
       nominal top. Reserving only `pad` for it silently clipped the widest-topped
       pieces against the edge of their own canvas: measured, the rook's crown edge
       landed at y = -1.96. That is why the rook read as flat and the knight's ears
       felt cramped — the art was never wrong, it was being cut off. */
    var rTop = radii[Math.min(RINGS - 1, Math.round((prof.latheTo || 1) * (RINGS - 1)))];
    var w = Math.ceil(maxR * 2 * unit) + pad * 2;
    var h = Math.ceil(prof.h * unit * COS + maxR * unit * SIN + rTop * unit * SIN + topExtra) + pad * 2;
    var cv = document.createElement("canvas");
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = Math.ceil(w * dpr); cv.height = Math.ceil(h * dpr);
    var g = cv.getContext("2d");
    g.scale(dpr, dpr);

    var ax = w / 2;                                     /* anchor: centre of base */
    var ay = h - pad - maxR * unit * SIN;

    /* Rings bottom to top, each an ellipse filled with an azimuthal gradient
       derived from the true surface normal at that latitude. */
    var latheTo = prof.latheTo || 1;
    for (i = 0; i < RINGS; i++) {
      var t = i / (RINGS - 1);
      if (t > latheTo) break;
      var r = radii[i];
      if (r <= 0.001) continue;
      var drdy = (radii[Math.min(RINGS - 1, i + 1)] - radii[Math.max(0, i - 1)]) /
                 (2 / (RINGS - 1) * prof.h);
      var L = Math.hypot(1, drdy);
      var nY = -drdy / L, nXZ = 1 / L;

      var cy = ay - t * prof.h * unit * COS;
      var rx = r * unit, ry = r * unit * SIN;

      /* Ambient occlusion: the base of the piece sits in its own contact shadow. */
      var ao = 0.42 + 0.58 * clamp01(t / 0.14);

      var ringMat = (t >= GOLD_BAND[0] && t <= GOLD_BAND[1]) ? MAT.gold : mat;

      var grad = g.createLinearGradient(ax - rx, 0, ax + rx, 0);
      for (var st = 0; st <= 8; st++) {
        var u = st / 8;
        var cosphi = u * 2 - 1;
        var sinphi = Math.sqrt(Math.max(0, 1 - cosphi * cosphi));
        var n = [nXZ * cosphi, nY, nXZ * sinphi];
        var col = shade(ringMat, n);
        if (ao < 1) col = darken(col, ao);
        grad.addColorStop(u, col);
      }
      g.fillStyle = grad;
      g.beginPath();
      g.ellipse(ax, cy, rx, Math.max(0.4, ry), 0, 0, Math.PI * 2);
      g.fill();
    }

    if (type === C.ROOK) crenellate(g, ax, ay, unit, prof, radii, mat);
    if (type === C.KNIGHT) knightHead(g, ax, ay, unit, mat, isWhite, prof.h);
    if (type === C.BISHOP) bishopSlit(g, ax, ay, unit, prof, mat);
    if (type === C.QUEEN) queenCrown(g, ax, ay, unit, prof, mat);
    if (type === C.KING) kingCross(g, ax, ay, unit, prof, mat);

    return { cv: cv, w: w, h: h, ax: ax, ay: ay, unit: unit };
  }

  function darken(rgb, f) {
    var m = /rgb\((\d+),(\d+),(\d+)\)/.exec(rgb);
    if (!m) return rgb;
    return "rgb(" + ((+m[1] * f) | 0) + "," + ((+m[2] * f) | 0) + "," + ((+m[3] * f) | 0) + ")";
  }

  /* Rook battlements: cut the notches out of the finished top band, then paint the
     revealed inner faces darker so the cut reads as depth rather than a hole. */
  /* Points on the crown rim: azimuth -> screen, with the camera's foreshortening. */
  function rimPt(cx, cy, r, a) { return [cx + Math.cos(a) * r, cy - Math.sin(a) * r * SIN]; }
  function rimArc(g, cx, cy, r, a0, a1, first) {
    var steps = 10;
    for (var i = 0; i <= steps; i++) {
      var pt = rimPt(cx, cy, r, a0 + (a1 - a0) * (i / steps));
      if (i === 0 && first) g.moveTo(pt[0], pt[1]); else g.lineTo(pt[0], pt[1]);
    }
  }

  /* Battlements, and the failed attempts are worth recording because each looked
     plausible in code: merlons at body value read as a chipped cup; a wide well
     with full-depth gaps read as a SPOKED WHEEL; a bright unbroken top face read
     as a lollipop. The common fault was PAINTING the notches onto a face. What
     actually reads is cutting them OUT — `destination-out` removes pixels, so the
     notches break the silhouette and show the board through the crown, which is
     the thing the eye recognises. The crown also tapers in below a lip so its top
     face is no longer as wide as the piece. */
  function crenellate(g, ax, ay, unit, prof, radii, mat) {
    var topY = ay - prof.h * unit * COS;
    var rO = radii[RINGS - 1] * unit;
    var ry = rO * SIN;

    /* ⚠ Cutting the notches THROUGH looked right until you notice what shows
       behind them is the board — the same rook then reads with dark notches on one
       square and light ones on the next. They have to be painted.
       ⚠ And they must sit INSIDE the rim. Measured, an earlier version started
       them at the crown's top edge (row 12 of a crown beginning at row 11), which
       left no bright arc above them and made them read as posts stuck on top.
       Placement is by AZIMUTH so each notch sits at the right height on the
       ellipse — parallel vertical bars ignore the perspective entirely. */
    var rim = rO * 0.995;

    g.beginPath(); g.ellipse(ax, topY, rim, rim * SIN, 0, 0, Math.PI * 2);
    g.fillStyle = shade(mat, norm([-0.12, 0.99, 0.08]));
    g.fill();

    var n = 5, step = Math.PI * 2 / n, span = step * 0.40;
    var inner = rim * 0.58;
    for (var k = 0; k < n; k++) {
      var ac = k * step + Math.PI / 2 + step * 0.5;
      g.beginPath();
      rimArc(g, ax, topY, rim * 0.97, ac - span / 2, ac + span / 2, true);
      rimArc(g, ax, topY, inner, ac + span / 2, ac - span / 2, false);
      g.closePath();
      g.fillStyle = darken(shade(mat, norm([0, 0.88, -0.46])), 0.50);
      g.fill();
    }

    /* Well last, so the notch mouths read as opening into it. */
    g.beginPath(); g.ellipse(ax, topY, inner * 0.86, inner * 0.86 * SIN, 0, 0, Math.PI * 2);
    g.fillStyle = darken(shade(mat, norm([0, 0.94, -0.34])), 0.58);
    g.fill();

    /* A lit inner lip on the near side gives the wall thickness. */
    g.beginPath();
    rimArc(g, ax, topY, inner * 0.86, Math.PI, Math.PI * 2, true);
    rimArc(g, ax, topY - unit * 0.018 * COS, inner * 0.86, Math.PI * 2, Math.PI, false);
    g.closePath();
    g.fillStyle = shade(mat, norm([0, 0.86, 0.5]));
    g.fill();
  }

  function bishopSlit(g, ax, ay, unit, prof, mat) {
    var y = ay - 0.80 * prof.h * unit * COS;
    g.save();
    g.strokeStyle = "rgba(0,0,0,0.55)";
    g.lineWidth = Math.max(1.2, unit * 0.030);
    g.lineCap = "round";
    g.beginPath();
    g.moveTo(ax - unit * 0.075, y + unit * 0.075);
    g.lineTo(ax + unit * 0.045, y - unit * 0.055);
    g.stroke();
    g.restore();
  }

  /* A coronet: a banded rim with small points standing on it. Free-floating balls
     on a dome read as a molecule, which is what the first two passes produced. */
  function queenCrown(g, ax, ay, unit, prof, mat) {
    var y = ay - 0.876 * prof.h * unit * COS;
    var r = 0.236 * unit;

    /* The band the points sit on, so they belong to the piece. */
    g.beginPath();
    rimArc(g, ax, y, r * 1.04, 0, Math.PI * 2, true);
    g.closePath();
    g.fillStyle = darken(shade(mat, norm([0, 0.9, 0.2])), 0.88);
    g.fill();
    g.beginPath();
    rimArc(g, ax, y, r * 0.74, 0, Math.PI * 2, true);
    g.closePath();
    g.fillStyle = darken(shade(mat, norm([0, 0.95, -0.28])), 0.66);
    g.fill();

    var pts = [];
    for (var i = 0; i < 8; i++) {
      var a = (i / 8) * Math.PI * 2 + 0.40;
      pts.push({ a: a, x: ax + Math.cos(a) * r * 0.92, y: y - Math.sin(a) * r * 0.92 * SIN });
    }
    pts.sort(function (p, q) { return p.y - q.y; });          /* far points first */
    for (var j = 0; j < pts.length; j++) {
      var o = pts[j], rad = unit * 0.030, up = unit * 0.062 * COS;
      var gr = g.createLinearGradient(o.x - rad, 0, o.x + rad, 0);
      gr.addColorStop(0, shade(mat, norm([-0.62, 0.70, 0.42])));
      gr.addColorStop(1, shade(mat, norm([0.66, 0.30, -0.16])));
      g.fillStyle = gr;
      g.beginPath();
      g.moveTo(o.x - rad, o.y);
      g.quadraticCurveTo(o.x - rad * 0.55, o.y - up, o.x, o.y - up);
      g.quadraticCurveTo(o.x + rad * 0.55, o.y - up, o.x + rad, o.y);
      g.quadraticCurveTo(o.x, o.y + rad * 0.5 * SIN, o.x - rad, o.y);
      g.closePath();
      g.fill();
    }
  }

  function kingCross(g, ax, ay, unit, prof, mat) {
    var y = ay - prof.h * unit * COS;
    var armW = unit * 0.074, up = unit * 0.32 * COS, arm = unit * 0.120;
    var lit = shade(mat, norm([-0.45, 0.72, 0.52])), dim = shade(mat, norm([0.55, 0.28, -0.18]));
    var gr = g.createLinearGradient(ax - arm, 0, ax + arm, 0);
    gr.addColorStop(0, lit); gr.addColorStop(1, dim);
    g.fillStyle = gr;
    /* Sits ON the finial: an outlined, floating cross read as a pasted-on icon. */
    roundRect(g, ax - armW / 2, y - up, armW, up + armW * 1.1, armW * 0.34);
    roundRect(g, ax - arm, y - up * 0.66, arm * 2, armW, armW * 0.34);
  }

  /* Fills and leaves the path current so a caller can stroke the same outline.
     ⚠ ctx.save()/restore() does NOT preserve the current path, so nothing may be
     saved between the fill here and the caller's stroke. */
  function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath(); g.fill();
  }

  /* The knight is the one piece that is not a surface of revolution, so its head is
     a sculpted silhouette sitting on a turned base. */
  /* The one piece that is not a surface of revolution.
     ⚠ THE FEATURE THAT MAKES IT A HORSE IS THE DISH — the CONCAVE sweep from the
     nose up to the forehead. Every earlier pass curved convex there, and a convex
     top on a tapering muzzle is a bird's head; no amount of tweaking the outline
     fixed it. The muzzle front is also close to VERTICAL and the jaw has a real
     corner: smooth tapers read as a beak. */
  function knightHead(g, ax, ay, unit, mat, isWhite, pieceH) {
    var U = unit;
    /* The camera foreshortens vertically by COS but leaves x alone, so the head is
       mapped onto the piece's true on-screen height rather than raw model units. */
    var VS = pieceH * U * COS / 1.15;
    function X(v) { return ax + v * U; }
    function Y(v) { return ay - v * VS; }

    g.save();
    /* ⚠ The base of this outline must be as wide as the collar it stands on.
       It used to span x 0.020..0.212 — narrower than the lathe below it and pushed
       off-axis — so the turned column showed on both sides and the head read as a
       cut-out glued to a stick. */
    function headPath() {
    g.beginPath();
    g.moveTo(X(-0.170), Y(0.180));
    g.bezierCurveTo(X(-0.166), Y(0.330), X(-0.150), Y(0.470), X(-0.135), Y(0.605)); /* throat */
    g.lineTo(X(-0.235), Y(0.652));                                    /* jaw corner */
    g.lineTo(X(-0.340), Y(0.700));                                    /* under the muzzle */
    g.bezierCurveTo(X(-0.378), Y(0.726), X(-0.386), Y(0.772), X(-0.372), Y(0.822)); /* vertical nose face */
    g.lineTo(X(-0.352), Y(0.856));                                    /* nose top corner */
    /* THE DISH — pulled INWARD so the profile is hollow, not domed. */
    g.bezierCurveTo(X(-0.268), Y(0.836), X(-0.196), Y(0.868), X(-0.140), Y(0.938));
    g.bezierCurveTo(X(-0.104), Y(0.982), X(-0.070), Y(1.006), X(-0.028), Y(1.020)); /* forehead */
    g.lineTo(X(0.020), Y(1.150));                                     /* front ear */
    g.lineTo(X(0.092), Y(1.012));                                     /* notch between ears */
    g.lineTo(X(0.178), Y(1.128));                                     /* rear ear */
    g.bezierCurveTo(X(0.222), Y(0.986), X(0.256), Y(0.842), X(0.268), Y(0.690)); /* poll into mane */
    g.bezierCurveTo(X(0.278), Y(0.512), X(0.262), Y(0.348), X(0.246), Y(0.180)); /* back of neck */
    g.closePath();
    }

    /* A darker copy offset back-and-right reads as the far side of the head, so the
       piece has thickness instead of being a flat silhouette standing on the board. */
    g.save();
    g.translate(U * 0.032, -U * 0.014 * COS);
    headPath();
    g.fillStyle = darken(shade(mat, norm([0.86, 0.20, -0.32])), 0.78);
    g.fill();
    g.restore();

    headPath();

    var gr = g.createLinearGradient(X(-0.39), 0, X(0.28), 0);
    gr.addColorStop(0.00, shade(mat, norm([-0.88, 0.40, 0.26])));
    gr.addColorStop(0.30, shade(mat, norm([-0.34, 0.56, 0.76])));
    gr.addColorStop(0.66, shade(mat, norm([0.30, 0.40, 0.62])));
    gr.addColorStop(1.00, shade(mat, norm([0.90, 0.16, -0.26])));
    g.fillStyle = gr;
    g.fill();
    g.save(); g.clip();

    /* Far cheek: a darker plane inset from the back edge. Without a second plane
       the head is a flat gradient and reads as a paper cut-out. */
    g.beginPath();
    g.moveTo(X(0.055), Y(1.020));
    g.bezierCurveTo(X(0.150), Y(0.980), X(0.205), Y(0.840), X(0.216), Y(0.680));
    g.bezierCurveTo(X(0.226), Y(0.500), X(0.212), Y(0.350), X(0.190), Y(0.215));
    g.lineTo(X(0.300), Y(0.215)); g.lineTo(X(0.300), Y(1.160)); g.closePath();
    g.fillStyle = "rgba(0,0,0,0.20)";
    g.fill();

    /* Mane: a stepped ridge along the crest. Long swept curves read as whiskers. */
    g.strokeStyle = "rgba(0,0,0,0.30)";
    g.lineWidth = Math.max(1, U * 0.020); g.lineCap = "round";
    for (var i = 0; i < 4; i++) {
      var t = 0.500 + i * 0.125;
      g.beginPath();
      g.moveTo(X(0.272 - i * 0.004), Y(t + 0.062));
      g.lineTo(X(0.214), Y(t + 0.020));
      g.stroke();
    }
    g.restore();

    /* Muzzle top catches the key light — separates the nose from the dish. */
    var mg = g.createLinearGradient(X(-0.36), Y(0.86), X(-0.22), Y(0.78));
    mg.addColorStop(0, "rgba(255,255,255,0.13)");
    mg.addColorStop(1, "rgba(255,255,255,0)");
    g.beginPath();
    g.moveTo(X(-0.352), Y(0.852));
    g.bezierCurveTo(X(-0.300), Y(0.840), X(-0.258), Y(0.844), X(-0.226), Y(0.854));
    g.lineTo(X(-0.244), Y(0.796)); g.lineTo(X(-0.358), Y(0.792)); g.closePath();
    g.fillStyle = mg;
    g.fill();

    /* Mouth line along the lower muzzle, and a defined jaw. */
    g.strokeStyle = "rgba(0,0,0,0.34)";
    g.lineWidth = Math.max(1, U * 0.017);
    g.beginPath();
    g.moveTo(X(-0.360), Y(0.742));
    g.quadraticCurveTo(X(-0.286), Y(0.726), X(-0.232), Y(0.706));
    g.stroke();

    /* Eye sits HIGH, up by the dish. Placed low on the muzzle it reads as a bird. */
    g.fillStyle = isWhite ? "rgba(34,27,18,0.86)" : "rgba(222,204,176,0.72)";
    g.beginPath();
    g.ellipse(X(-0.118), Y(0.930), U * 0.026, U * 0.019, -0.45, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.ellipse(X(-0.330), Y(0.800), U * 0.015, U * 0.011, 0.35, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }

  function buildSprites() {
    var unit = SPRITE_UNIT;
    sprites = {};
    [C.PAWN, C.KNIGHT, C.BISHOP, C.ROOK, C.QUEEN, C.KING].forEach(function (t) {
      sprites[t + "w"] = makeSprite(t, true, unit);
      sprites[t + "b"] = makeSprite(t, false, unit);
    });
  }

  /* ================= state ================= */
  var LS = {
    beaten: "chess_beaten", defeated: "chess_defeated", sound: "chess_sound",
    w: "chess_wins", l: "chess_losses", d: "chess_draws"
  };
  function lsGet(k, dflt) { try { var v = localStorage.getItem(k); return v === null ? dflt : v; } catch (e) { return dflt; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  var FOES = [
    { id: "novice", name: "The Novice", elo: 600, tier: 1, glyph: "pawn", accent: "#8fb39b",
      trait: "Hangs pieces. Loves its queen.",
      quips: { start: "I've read the rules twice.", capture: "Was that one important?",
               check: "Check! I think.", blunder: "Oh. Oh no.", win: "I won? I won!", lose: "Good game. I'll get better." } },
    { id: "merchant", name: "The Merchant", elo: 1000, tier: 2, glyph: "scale", accent: "#d8a54a",
      trait: "Pure greed. Counts every pawn.",
      quips: { start: "Everything has a price.", capture: "Mine now.", check: "Pay up.",
               blunder: "A poor investment.", win: "Debt collected.", lose: "You drove a hard bargain." } },
    { id: "duelist", name: "The Duelist", elo: 1350, tier: 3, glyph: "blades", accent: "#d9584f",
      trait: "Gambits and sacrifices. Hunts your king.",
      quips: { start: "Let's not make this dull.", capture: "A necessary cruelty.", check: "En garde.",
               blunder: "A flourish too far.", win: "Beautifully done, if I say so.", lose: "Touché." } },
    { id: "architect", name: "The Architect", elo: 1600, tier: 4, glyph: "compass", accent: "#7f9dc4",
      trait: "Structure first. A slow, patient squeeze.",
      quips: { start: "We build from the foundation.", capture: "Structurally necessary.", check: "The design holds.",
               blunder: "A crack in the plan.", win: "As drawn.", lose: "Your structure was sounder." } },
    { id: "trickster", name: "The Trickster", elo: 1800, tier: 5, glyph: "mask", accent: "#a97fc4",
      trait: "Wild tactics, traps, and chaos.",
      quips: { start: "Watch my hands.", capture: "Did you see that coming?", check: "Surprise.",
               blunder: "Even I didn't plan that.", win: "The trick worked.", lose: "You saw through me." } },
    { id: "oracle", name: "The Oracle", elo: 2100, tier: 6, glyph: "eye", accent: "#e8a13c",
      trait: "Deep, cold, and without weaknesses.",
      quips: { start: "I have seen this game already.", capture: "It was always going to be that square.",
               check: "As foretold.", blunder: "Unexpected.", win: "The outcome was never in doubt.",
               lose: "…I did not see that." } }
  ];
  function foeById(id) { for (var i = 0; i < FOES.length; i++) if (FOES[i].id === id) return FOES[i]; return FOES[0]; }

  var pos = null, foe = FOES[0], playerColor = C.WHITE;
  var selected = -1, legalFrom = [], lastMove = null, thinking = false;
  var anim = null, fading = [], particles = [], hintMove = 0;
  var sanList = [], uciList = [], captured = { w: [], b: [] };
  var gameOver = false, started = false, checkPulse = 0, shakeSq = -1, shakeT = 0;
  var worker = null, workerBroken = false, pendingKind = null;
  var promoPending = null, cursor = -1;
  var boardGeom = { squares: [], size: 0 };

  /* ================= DOM ================= */
  var $ = function (id) { return document.getElementById(id); };
  var elOpp = $("opp"), elOppSeal = $("oppSeal"), elOppName = $("oppName"),
      elOppElo = $("oppElo"), elOppSay = $("oppSay");
  var elBar = $("bar"), elCallout = $("callout"), elHint = $("hint");
  var elOverlay = $("overlay"), elCast = $("cast");
  var elResult = $("result"), elResTitle = $("resTitle"), elResLine = $("resLine"),
      elResText = $("resText"), elResRecord = $("resRecord"), elResSeal = $("resSeal");
  var elPromo = $("promo"), elPromoBox = $("promoBox");
  var elMoves = $("moves"), elTrayTop = $("trayTop"), elTrayBot = $("trayBot");
  var elSound = $("soundBtn");

  /* ================= audio =================
     House rule: contacts are MODAL — a short noise burst through parallel resonant
     bandpasses at the object's own modes, opened by a broadband lowpassed tack so
     it reads as two solid things touching. Long tails (the check bell) are ADDITIVE
     instead, because a bell cannot be built from a filtered burst. Everything runs
     through one shared body and a brickwall, so a fast exchange cannot clip. */
  var ac = null, busIn = null, outGain = null, soundOn = lsGet(LS.sound, "1") !== "0";

  function audioInit() {
    if (ac) return;
    try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
    /* iOS stays silent until a real buffer has played on a gesture. */
    var b = ac.createBuffer(1, 1, ac.sampleRate);
    var s = ac.createBufferSource(); s.buffer = b; s.connect(ac.destination); s.start(0);

    busIn = ac.createGain(); busIn.gain.value = 1;

    /* The "cabinet": every contact is heard through the same wooden box. */
    var body1 = ac.createBiquadFilter();
    body1.type = "peaking"; body1.frequency.value = 210; body1.Q.value = 1.1; body1.gain.value = 3.2;
    var body2 = ac.createBiquadFilter();
    body2.type = "peaking"; body2.frequency.value = 460; body2.Q.value = 1.5; body2.gain.value = 2.0;
    var shelf = ac.createBiquadFilter();
    shelf.type = "highshelf"; shelf.frequency.value = 6200; shelf.gain.value = -4;

    var comp = ac.createDynamicsCompressor();
    /* ⚠ At -15dB (0.178 linear) this was limiting SINGLE contacts, not gluing an
       exchange: raising the voice amp by 53% moved the measured peak by 15%. The
       glue has to sit above a normal hit so only dense passages touch it; the
       brickwall below is the actual ceiling. */
    comp.threshold.value = -6; comp.ratio.value = 3; comp.knee.value = 6;
    comp.attack.value = 0.003; comp.release.value = 0.14;
    /* The compressor is glue, not a limiter — this is the actual ceiling. */
    var wall = ac.createDynamicsCompressor();
    wall.threshold.value = -1.5; wall.ratio.value = 20; wall.knee.value = 0;
    wall.attack.value = 0.001; wall.release.value = 0.05;

    outGain = ac.createGain(); outGain.gain.value = soundOn ? 0.9 : 0;

    busIn.connect(body1); body1.connect(body2); body2.connect(shelf);
    shelf.connect(comp); comp.connect(wall); wall.connect(outGain); outGain.connect(ac.destination);

    var conv = ac.createConvolver();
    conv.buffer = makeIR(1.5, 2.4);
    var wet = ac.createGain(); wet.gain.value = 0.20;
    shelf.connect(conv); conv.connect(wet); wet.connect(comp);
  }

  function makeIR(sec, decay) {
    var n = Math.floor(ac.sampleRate * sec), buf = ac.createBuffer(2, n, ac.sampleRate);
    for (var ch = 0; ch < 2; ch++) {
      var d = buf.getChannelData(ch), last = 0;
      for (var i = 0; i < n; i++) {
        var t = i / n;
        var white = Math.random() * 2 - 1;
        last = last * 0.72 + white * 0.28;                 /* lowpassed: a grainy tail sounds cheap */
        d[i] = last * Math.pow(1 - t, decay);
      }
    }
    return buf;
  }

  function noiseBuf(ms) {
    var n = Math.max(1, Math.floor(ac.sampleRate * ms / 1000));
    var b = ac.createBuffer(1, n, ac.sampleRate), d = b.getChannelData(0);
    for (var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    return b;
  }

  /* burstMs matters more than amp: a very short click cannot push energy into a
     narrow resonator, so a crisper tack is also a quieter one. */
  function modalHit(modes, amp, pan, burstMs) {
    if (!ac || !soundOn) return;
    var t0 = ac.currentTime;
    var src = ac.createBufferSource(); src.buffer = noiseBuf(burstMs || 13);
    var p = ac.createStereoPanner ? ac.createStereoPanner() : null;
    var dest = busIn;
    if (p) { p.pan.value = pan || 0; p.connect(busIn); dest = p; }

    for (var i = 0; i < modes.length; i++) {
      var m = modes[i];
      var f = ac.createBiquadFilter();
      f.type = "bandpass"; f.frequency.value = m[0] * (0.985 + Math.random() * 0.03); f.Q.value = m[1];
      var g = ac.createGain();
      /* A narrow bandpass rejects nearly all of a short burst — the sqrt(Q) makeup
         is what stops a correctly-tuned voice from being inaudible. */
      var makeup = Math.sqrt(m[1]);
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(amp * m[2] * makeup, t0 + 0.001);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + m[3]);
      src.connect(f); f.connect(g); g.connect(dest);
    }
    /* Broadband tack: what actually says "two solid things touched". Lowpassed,
       because highpassed noise runs to Nyquist and reads as a hiss. */
    var tk = ac.createBufferSource(); tk.buffer = noiseBuf(4);
    var lp = ac.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 8600;
    var bp = ac.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 2400; bp.Q.value = 0.6;
    var tg = ac.createGain();
    tg.gain.setValueAtTime(amp * 0.5, t0);
    tg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.035);
    tk.connect(lp); lp.connect(bp); bp.connect(tg); tg.connect(dest);

    src.start(t0); tk.start(t0);
    src.stop(t0 + 0.6); tk.stop(t0 + 0.1);
  }

  var STONE = [[404, 7, 1.00, 0.115], [1148, 11, 0.52, 0.070], [2260, 14, 0.26, 0.042], [3380, 16, 0.12, 0.028]];
  function sPlace(v, pan) { modalHit(STONE, 0.89 * (v || 1), pan, 15); }
  function sCapture(pan) {
    modalHit([[300, 6, 1.0, 0.15], [880, 9, 0.55, 0.09], [1810, 13, 0.28, 0.05]], 1.00, pan, 19);
    setTimeout(function () { sPlace(1.05, pan); }, 62);
  }
  function sCastle(pan) { sPlace(0.9, pan); setTimeout(function () { sPlace(0.95, pan + 0.1); }, 128); }
  function sSelect(pan) { modalHit([[1500, 10, 0.5, 0.028], [2900, 12, 0.2, 0.018]], 0.27, pan, 6); }
  function sIllegal() {
    if (!ac || !soundOn) return;
    var t0 = ac.currentTime;
    var o = ac.createOscillator(), g = ac.createGain(), lp = ac.createBiquadFilter();
    o.type = "sine"; o.frequency.setValueAtTime(120, t0);
    o.frequency.exponentialRampToValueAtTime(64, t0 + 0.09);
    lp.type = "lowpass"; lp.frequency.value = 420;
    g.gain.setValueAtTime(0.42, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.13);
    o.connect(lp); lp.connect(g); g.connect(busIn); o.start(t0); o.stop(t0 + 0.16);
  }
  /* A long ring has to be ADDITIVE — inharmonic partials plus a strike transient. */
  function bell(f0, amp, dur) {
    if (!ac || !soundOn) return;
    var t0 = ac.currentTime, ratios = [1, 2, 3.01, 4.17, 5.43, 6.79];
    var gains = [1, 0.5, 0.34, 0.2, 0.12, 0.07];
    for (var i = 0; i < ratios.length; i++) {
      var o = ac.createOscillator(), g = ac.createGain();
      o.type = "sine"; o.frequency.value = f0 * ratios[i] * (1 + (Math.random() - 0.5) * 0.004);
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(amp * gains[i], t0 + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur * (1 - i * 0.1));
      o.connect(g); g.connect(busIn); o.start(t0); o.stop(t0 + dur + 0.1);
    }
    modalHit([[f0 * 4.2, 9, 0.4, 0.05]], amp * 0.5, 0, 6);
  }
  function sCheck() { bell(178, 0.30, 1.5); }
  function sMate() {
    bell(116, 0.34, 2.6);
    setTimeout(function () { bell(87, 0.20, 3.0); }, 240);
  }
  function sWin() { [0, 150, 300].forEach(function (d, i) { setTimeout(function () { bell(196 * [1, 1.25, 1.5][i], 0.17, 1.9); }, d); }); }

  elSound.addEventListener("click", function () {
    soundOn = !soundOn;
    elSound.setAttribute("aria-pressed", soundOn ? "true" : "false");
    lsSet(LS.sound, soundOn ? "1" : "0");
    audioInit();
    if (outGain) outGain.gain.value = soundOn ? 0.9 : 0;
    if (soundOn) sSelect(0);
  });
  elSound.setAttribute("aria-pressed", soundOn ? "true" : "false");

  /* ================= layout ================= */
  var dpr = 1;
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = window.innerWidth, h = window.innerHeight;
    canvas.width = Math.floor(w * dpr); canvas.height = Math.floor(h * dpr);
    canvas.style.width = w + "px"; canvas.style.height = h + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    fitBoard(w, h);
    buildSprites();
    buildBoardTexture(w, h);
    draw();
  }

  /* Screen offsets are exactly linear in FOCAL (depth does not depend on it), so
     one measure-and-scale pass fits the board precisely. */
  function fitBoard(w, h) {
    CX = 0; CY = 0; FOCAL = 1000;
    var ext = 4.62;                                  /* board plus its surround */
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    var pts = [[-ext, -ext], [ext, -ext], [-ext, ext], [ext, ext]];
    for (var i = 0; i < pts.length; i++) {
      var p = project(pts[i][0], 0, pts[i][1]);
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    /* Tall pieces on the far rank stick up past the board's own bounding box. */
    var topPiece = project(0, 1.72, -3.5);
    minY = Math.min(minY, topPiece.y);

    var narrow = w < 620;
    var padX = narrow ? 12 : 30;
    var padTop = narrow ? 92 : 104;
    var padBot = narrow ? 132 : 116;
    var availW = w - padX * 2, availH = h - padTop - padBot;
    var scale = Math.min(availW / (maxX - minX), availH / (maxY - minY));
    FOCAL *= scale;

    minX *= scale; maxX *= scale; minY *= scale; maxY *= scale;
    CX = w / 2 - (minX + maxX) / 2;
    CY = padTop + availH / 2 - (minY + maxY) / 2;

    boardGeom.size = (maxX - minX);
    cacheSquares();
  }

  function cacheSquares() {
    boardGeom.squares = [];
    for (var rank = 0; rank < 8; rank++) {
      for (var file = 0; file < 8; file++) {
        var w0 = fileRankToWorld(file, rank);
        var quad = [
          project(w0.x - 0.5, 0, w0.z - 0.5), project(w0.x + 0.5, 0, w0.z - 0.5),
          project(w0.x + 0.5, 0, w0.z + 0.5), project(w0.x - 0.5, 0, w0.z + 0.5)
        ];
        boardGeom.squares.push({ file: file, rank: rank, sq: C.sq88(file, rank), quad: quad,
          c: project(w0.x, 0, w0.z), z: w0.z });
      }
    }
  }
  window.addEventListener("resize", resize);

  /* ================= drawing ================= */
  /* Palette taken from the toy's own key art: warm cream marble against a
     near-black with a navy cast, gold trim, everything falling off into dark. The
     light squares stay below the alabaster pieces in value so the white side never
     disappears into the board. */
  var SQ_LIGHT = "#bcb096", SQ_DARK = "#151922";

  /* The ground, frame, squares, veining and labels never change between frames, so
     they are baked once per layout into an offscreen canvas and blitted. That is
     roughly two hundred gradient fills moved off the per-frame path. */
  var boardCv = null;
  function buildBoardTexture(w, h) {
    boardCv = document.createElement("canvas");
    boardCv.width = Math.floor(w * dpr); boardCv.height = Math.floor(h * dpr);
    var real = ctx;
    ctx = boardCv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    var pool = ctx.createRadialGradient(w * 0.42, h * 0.34, 0, w * 0.5, h * 0.5, Math.max(w, h) * 0.78);
    pool.addColorStop(0, "#161a24");
    pool.addColorStop(0.42, "#0c0f17");
    pool.addColorStop(1, "#04050a");
    ctx.fillStyle = pool; ctx.fillRect(0, 0, w, h);

    drawSurround();
    drawSquares();
    ctx = real;
  }

  function draw() {
    var w = window.innerWidth, h = window.innerHeight;
    ctx.clearRect(0, 0, w, h);
    if (boardCv) ctx.drawImage(boardCv, 0, 0, boardCv.width, boardCv.height, 0, 0, w, h);
    drawMarks();
    drawReflections();
    drawPieces();
    drawParticles();
  }

  function quadPath(q) {
    ctx.beginPath();
    ctx.moveTo(q[0].x, q[0].y);
    for (var i = 1; i < q.length; i++) ctx.lineTo(q[i].x, q[i].y);
    ctx.closePath();
  }

  function drawSurround() {
    var e = 4.60, i2 = 4.02;
    var outer = [project(-e, 0, -e), project(e, 0, -e), project(e, 0, e), project(-e, 0, e)];
    var inner = [project(-i2, 0, -i2), project(i2, 0, -i2), project(i2, 0, i2), project(-i2, 0, i2)];

    /* A soft shadow the whole board sits in. */
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.85)";
    ctx.shadowBlur = 60; ctx.shadowOffsetY = 26;
    ctx.fillStyle = "#0c0d11";
    quadPath(outer); ctx.fill();
    ctx.restore();

    var g = ctx.createLinearGradient(outer[0].x, outer[0].y, outer[2].x, outer[2].y);
    g.addColorStop(0, "#33302c"); g.addColorStop(0.45, "#221f1d"); g.addColorStop(1, "#14131a");
    ctx.fillStyle = g;
    quadPath(outer); ctx.fill();

    /* Brass hairline where the frame meets the playing field. */
    ctx.strokeStyle = "rgba(226, 178, 96, 0.72)";
    ctx.lineWidth = 1.6;
    quadPath(inner); ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    quadPath(outer); ctx.stroke();

    drawLabels();
  }

  function drawLabels() {
    ctx.save();
    ctx.fillStyle = "rgba(236,230,218,0.34)";
    ctx.font = "500 " + Math.max(8, Math.round(boardGeom.size * 0.019)) + "px 'Geist Mono', monospace";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    for (var i = 0; i < 8; i++) {
      var fw = fileRankToWorld(i, flip ? 7 : 0);
      var p = project(fw.x, 0, fw.z + (flip ? -0.78 : 0.78));
      ctx.fillText("abcdefgh"[i], p.x, p.y);
      var rw = fileRankToWorld(flip ? 7 : 0, i);
      var q = project(rw.x + (flip ? 0.78 : -0.78), 0, rw.z);
      ctx.fillText(String(i + 1), q.x, q.y);
    }
    ctx.restore();
  }

  function drawSquares() {
    for (var i = 0; i < boardGeom.squares.length; i++) {
      var s = boardGeom.squares[i];
      var isLight = ((s.file + s.rank) & 1) === 1;
      quadPath(s.quad);
      ctx.fillStyle = isLight ? SQ_LIGHT : SQ_DARK;
      ctx.fill();
      /* Polished sheen: the key light grazes the near-left of every square. */
      var g = ctx.createLinearGradient(s.quad[0].x, s.quad[0].y, s.quad[2].x, s.quad[2].y);
      g.addColorStop(0, "rgba(255,255,255,0.055)");
      g.addColorStop(0.55, "rgba(255,255,255,0.0)");
      g.addColorStop(1, "rgba(0,0,0,0.16)");
      ctx.fillStyle = g; ctx.fill();
      veinSquare(s, i, isLight);
    }
    ctx.strokeStyle = "rgba(0,0,0,0.28)"; ctx.lineWidth = 0.6;
    for (var j = 0; j < boardGeom.squares.length; j++) { quadPath(boardGeom.squares[j].quad); ctx.stroke(); }
  }

  /* Seeded so the veining is identical every rebuild — a board whose marble
     reshuffles on resize looks like a bug. */
  function srnd(n) { var x = Math.sin(n * 127.1) * 43758.5453; return x - Math.floor(x); }

  function veinSquare(s, idx, isLight) {
    var w = Math.hypot(s.quad[1].x - s.quad[0].x, s.quad[1].y - s.quad[0].y);
    ctx.save();
    quadPath(s.quad); ctx.clip();
    ctx.lineCap = "round";
    for (var v = 0; v < 3; v++) {
      var a = srnd(idx * 9 + v), b = srnd(idx * 9 + v + 101), c = srnd(idx * 9 + v + 211);
      var x0 = s.c.x + (a - 0.5) * w * 1.6, y0 = s.c.y + (b - 0.5) * w * SIN * 1.6;
      var ang = c * Math.PI;
      var len = w * (0.5 + a * 0.7);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.quadraticCurveTo(
        x0 + Math.cos(ang) * len * 0.5 + (b - 0.5) * w * 0.35,
        y0 + Math.sin(ang) * len * 0.5 * SIN,
        x0 + Math.cos(ang) * len, y0 + Math.sin(ang) * len * SIN);
      ctx.strokeStyle = isLight
        ? "rgba(60,50,38," + (0.05 + a * 0.07).toFixed(3) + ")"
        : "rgba(190,205,230," + (0.030 + a * 0.045).toFixed(3) + ")";
      ctx.lineWidth = Math.max(0.6, w * (0.008 + b * 0.016));
      ctx.stroke();
    }
    ctx.restore();
  }

  /* Pieces reflected in the polished stone. Cheap — the sprite is simply mirrored
     about its own base point and squashed by the camera's foreshortening — but it
     is most of the difference between "rendered" and "photographed". */
  function drawReflections() {
    if (!pos) return;
    var inner = 4.02;
    ctx.save();
    quadPath([project(-inner, 0, -inner), project(inner, 0, -inner),
              project(inner, 0, inner), project(-inner, 0, inner)]);
    ctx.clip();
    ctx.globalAlpha = 0.15;
    for (var i = 0; i < 64; i++) {
      var sq = C.SQUARES[i], pc = pos.board[sq];
      if (!pc) continue;
      if (anim && sq === C.mFrom(anim.m)) continue;
      var s = squareAt(sq); if (!s) continue;
      var sp = sprites[(pc & C.TYPE) + (((pc & C.COLOR) === C.WHITE) ? "w" : "b")];
      if (!sp) continue;
      var k = s.c.s / SPRITE_UNIT;
      ctx.save();
      ctx.translate(s.c.x, s.c.y);
      ctx.scale(1, -0.62);
      ctx.drawImage(sp.cv, -sp.ax * k, -sp.ay * k, sp.w * k, sp.h * k);
      ctx.restore();
    }
    ctx.restore();
  }

  function squareAt(sq) {
    for (var i = 0; i < boardGeom.squares.length; i++) if (boardGeom.squares[i].sq === sq) return boardGeom.squares[i];
    return null;
  }

  function drawMarks() {
    var now = performance.now();
    if (lastMove) {
      [C.mFrom(lastMove), C.mTo(lastMove)].forEach(function (sq) {
        var s = squareAt(sq); if (!s) return;
        quadPath(s.quad);
        ctx.fillStyle = "rgba(232, 161, 60, 0.17)"; ctx.fill();
      });
    }
    if (hintMove) {
      [C.mFrom(hintMove), C.mTo(hintMove)].forEach(function (sq) {
        var s = squareAt(sq); if (!s) return;
        quadPath(s.quad);
        ctx.fillStyle = "rgba(111, 191, 136, 0.26)"; ctx.fill();
      });
    }
    if (selected >= 0) {
      var s0 = squareAt(selected);
      if (s0) {
        quadPath(s0.quad);
        ctx.fillStyle = "rgba(232, 161, 60, 0.30)"; ctx.fill();
        ctx.strokeStyle = "rgba(247, 205, 147, 0.85)"; ctx.lineWidth = 2; ctx.stroke();
      }
    }
    /* Legal destinations: a disc for a quiet move, a ring for a capture. */
    for (var i = 0; i < legalFrom.length; i++) {
      var m = legalFrom[i], to = C.mTo(m), s = squareAt(to);
      if (!s) continue;
      var r = Math.hypot(s.quad[1].x - s.quad[0].x, s.quad[1].y - s.quad[0].y) * 0.5;
      var occupied = pos.board[to] || (C.mFlags(m) & C.F_EP);
      ctx.save();
      if (occupied) {
        ctx.strokeStyle = "rgba(247, 205, 147, 0.72)";
        ctx.lineWidth = Math.max(2.5, r * 0.13);
        ctx.beginPath(); ctx.ellipse(s.c.x, s.c.y, r * 0.82, r * 0.82 * SIN, 0, 0, Math.PI * 2); ctx.stroke();
      } else {
        var g = ctx.createRadialGradient(s.c.x, s.c.y, 0, s.c.x, s.c.y, r * 0.34);
        g.addColorStop(0, "rgba(247, 205, 147, 0.75)");
        g.addColorStop(1, "rgba(247, 205, 147, 0.18)");
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.ellipse(s.c.x, s.c.y, r * 0.30, r * 0.30 * SIN, 0, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }
    if (cursor >= 0 && started && !gameOver) {
      var sc = squareAt(cursor);
      if (sc) {
        quadPath(sc.quad);
        ctx.strokeStyle = "rgba(236,230,218,0.8)";
        ctx.lineWidth = 2; ctx.setLineDash([5, 4]); ctx.stroke(); ctx.setLineDash([]);
      }
    }
    if (checkPulse > 0 && pos) {
      var ksq = C.kingSq(pos, pos.turn), s2 = squareAt(ksq);
      if (s2) {
        var a = 0.28 + 0.24 * Math.sin(now / 180);
        quadPath(s2.quad);
        ctx.fillStyle = "rgba(224, 85, 79," + a.toFixed(3) + ")"; ctx.fill();
      }
    }
  }

  /* Painter's algorithm: far rank first, so a near piece correctly overlaps the one
     behind it. Without this the board looks flat however good the shading is. */
  function drawPieces() {
    if (!pos) return;
    var list = [];
    for (var i = 0; i < 64; i++) {
      var sq = C.SQUARES[i], pc = pos.board[sq];
      if (!pc) continue;
      if (anim && sq === C.mFrom(anim.m)) continue;
      var s = squareAt(sq);
      if (!s) continue;
      list.push({ pc: pc, x: s.c.x, y: s.c.y, z: s.z, sq: sq, scale: s.c.s, lift: 0 });
    }
    for (var f = 0; f < fading.length; f++) {
      var fd = fading[f], sf = squareAt(fd.sq);
      if (sf) list.push({ pc: fd.pc, x: sf.c.x, y: sf.c.y, z: sf.z, sq: -1, scale: sf.c.s, alpha: fd.a, shrink: fd.a });
    }
    if (anim) {
      var t = anim.t;
      var e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      var wf = anim.wFrom, wt = anim.wTo;
      var x = wf.x + (wt.x - wf.x) * e, z = wf.z + (wt.z - wf.z) * e;
      var lift = anim.arc ? Math.sin(e * Math.PI) * 0.55 : Math.sin(e * Math.PI) * 0.11;
      var p = project(x, lift, z);
      list.push({ pc: anim.pc, x: p.x, y: p.y, z: z, sq: -1, scale: p.s, lift: lift, moving: true });
    }
    list.sort(function (a, b) { return a.z - b.z; });

    for (var k = 0; k < list.length; k++) drawPiece(list[k]);
  }

  function drawPiece(o) {
    var type = o.pc & C.TYPE, isWhite = (o.pc & C.COLOR) === C.WHITE;
    var sp = sprites[type + (isWhite ? "w" : "b")];
    if (!sp) return;
    var k = (o.scale / SPRITE_UNIT) * (o.shrink !== undefined ? o.shrink : 1);
    var shakeX = 0;
    if (shakeSq === o.sq && shakeT > 0) shakeX = Math.sin(shakeT * 52) * shakeT * 9;

    /* Contact shadow, offset away from the key light and softened with the lift. */
    var sr = 0.34 * o.scale * (o.shrink !== undefined ? o.shrink : 1);
    var lift = o.lift || 0;
    ctx.save();
    ctx.globalAlpha = (o.alpha !== undefined ? o.alpha : 1) * (0.5 - lift * 0.36);
    var sg = ctx.createRadialGradient(o.x + sr * 0.34, o.y + sr * 0.10 * SIN, 0,
                                      o.x + sr * 0.34, o.y + sr * 0.10 * SIN, sr * (1.15 + lift));
    sg.addColorStop(0, "rgba(0,0,0,0.72)");
    sg.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.ellipse(o.x + sr * 0.34 + shakeX, o.y + sr * 0.1 * SIN, sr * (1.15 + lift), sr * (1.15 + lift) * SIN, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    if (o.alpha !== undefined) ctx.globalAlpha = o.alpha;
    ctx.drawImage(sp.cv, o.x - sp.ax * k + shakeX, o.y - sp.ay * k, sp.w * k, sp.h * k);
    ctx.restore();
  }

  function drawParticles() {
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.c;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function puff(sq, color) {
    var s = squareAt(sq); if (!s) return;
    for (var i = 0; i < 16; i++) {
      var a = Math.random() * Math.PI * 2, sp = 0.4 + Math.random() * 1.6;
      particles.push({
        x: s.c.x, y: s.c.y - s.c.s * 0.12, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * SIN - 0.7,
        r: 1 + Math.random() * 2.6, life: 1, c: color || "rgba(232,178,110,0.85)"
      });
    }
  }

  /* ================= loop ================= */
  var last = performance.now();
  function tick(now) {
    var dt = Math.min(64, now - last); last = now;
    var need = false;

    if (anim) {
      anim.t += dt / anim.dur;
      if (anim.t >= 1) { var done = anim; anim = null; done.onDone && done.onDone(); }
      need = true;
    }
    for (var i = fading.length - 1; i >= 0; i--) {
      fading[i].a -= dt / 200;
      if (fading[i].a <= 0) fading.splice(i, 1);
      need = true;
    }
    for (var j = particles.length - 1; j >= 0; j--) {
      var p = particles[j];
      p.x += p.vx; p.y += p.vy; p.vy += 0.08; p.life -= dt / 620;
      if (p.life <= 0) particles.splice(j, 1);
      need = true;
    }
    if (shakeT > 0) { shakeT -= dt / 320; need = true; }
    if (checkPulse > 0) need = true;

    if (need || dirty) { draw(); dirty = false; }
    requestAnimationFrame(tick);
  }
  var dirty = true;

  /* ================= interaction ================= */
  function pointInQuad(px, py, q) {
    var inside = false;
    for (var i = 0, j = 3; i < 4; j = i++) {
      if (((q[i].y > py) !== (q[j].y > py)) &&
          (px < (q[j].x - q[i].x) * (py - q[i].y) / (q[j].y - q[i].y) + q[i].x)) inside = !inside;
    }
    return inside;
  }
  function hitSquare(px, py) {
    for (var i = 0; i < boardGeom.squares.length; i++) {
      if (pointInQuad(px, py, boardGeom.squares[i].quad)) return boardGeom.squares[i].sq;
    }
    return -1;
  }
  function panOf(sq) {
    var s = squareAt(sq);
    return s ? Math.max(-0.85, Math.min(0.85, (s.c.x - window.innerWidth / 2) / (boardGeom.size * 0.5))) : 0;
  }

  canvas.addEventListener("pointerdown", function (ev) {
    if (!started || gameOver || thinking || anim || promoPending) return;
    if (pos.turn !== playerColor) return;
    audioInit();
    /* A visible keyboard caret alongside mouse play reads as a stuck highlight. */
    if (cursor >= 0) { cursor = -1; dirty = true; }
    var rect = canvas.getBoundingClientRect();
    var sq = hitSquare(ev.clientX - rect.left, ev.clientY - rect.top);
    if (sq < 0) return;
    onSquare(sq);
  });

  function onSquare(sq) {
    hintMove = 0;
    var pc = pos.board[sq];
    if (selected >= 0) {
      var found = 0, promos = [];
      for (var i = 0; i < legalFrom.length; i++) {
        if (C.mTo(legalFrom[i]) === sq) {
          if (C.mPromo(legalFrom[i])) promos.push(legalFrom[i]);
          else found = legalFrom[i];
        }
      }
      if (promos.length) { askPromotion(promos); return; }
      if (found) { selected = -1; legalFrom = []; playMove(found, true); return; }
      if (pc && (pc & C.COLOR) === playerColor) { select(sq); return; }
      /* A tap on an illegal square is feedback, not silence. */
      selected = -1; legalFrom = []; shakeSq = sq; shakeT = 1; sIllegal(); dirty = true;
      return;
    }
    if (pc && (pc & C.COLOR) === playerColor) select(sq);
  }

  function select(sq) {
    selected = sq;
    legalFrom = C.legalMoves(pos).filter(function (m) { return C.mFrom(m) === sq; });
    sSelect(panOf(sq));
    dirty = true;
  }

  function askPromotion(moves) {
    promoPending = moves;
    elPromoBox.innerHTML = "";
    [C.QUEEN, C.ROOK, C.BISHOP, C.KNIGHT].forEach(function (t) {
      var m = null;
      for (var i = 0; i < moves.length; i++) if (C.mPromo(moves[i]) === t) m = moves[i];
      if (!m) return;
      var b = document.createElement("button");
      b.type = "button"; b.className = "promo__opt";
      b.setAttribute("aria-label", { 5: "Queen", 4: "Rook", 3: "Bishop", 2: "Knight" }[t]);
      var sp = sprites[t + (playerColor === C.WHITE ? "w" : "b")];
      var cv = document.createElement("canvas");
      var size = 76, d = Math.min(window.devicePixelRatio || 1, 2);
      cv.width = size * d; cv.height = size * d;
      var g = cv.getContext("2d"); g.scale(d, d);
      var k = Math.min(size * 0.78 / sp.h, size * 0.78 / sp.w);
      g.drawImage(sp.cv, size / 2 - sp.ax * k, size * 0.92 - sp.ay * k, sp.w * k, sp.h * k);
      b.appendChild(cv);
      b.addEventListener("click", function () {
        elPromo.hidden = true; promoPending = null;
        selected = -1; legalFrom = [];
        playMove(m, true);
      });
      elPromoBox.appendChild(b);
    });
    elPromo.hidden = false;
  }

  /* ================= game flow ================= */
  function startGame(foeId, color) {
    foe = foeById(foeId);
    playerColor = color;
    flip = color === C.BLACK;
    pos = C.fromFen(C.START_FEN);
    selected = -1; legalFrom = []; lastMove = null; anim = null; fading = []; particles = [];
    sanList = []; uciList = []; captured = { w: [], b: [] };
    gameOver = false; started = true; checkPulse = 0; hintMove = 0; thinking = false; cursor = -1;
    cacheSquares();
    buildBoardTexture(window.innerWidth, window.innerHeight);
    renderOppCard();
    say(foe.quips.start);
    updateTrays(); renderMoves(); updateBar();
    elOpp.hidden = false; elBar.hidden = false;
    elTrayTop.hidden = false; elTrayBot.hidden = false;
    elMoves.hidden = false;
    hideCallout();
    dirty = true;
    if (pos.turn !== playerColor) setTimeout(requestEngineMove, 520);
  }

  function playMove(m, byPlayer) {
    var from = C.mFrom(m), to = C.mTo(m), flags = C.mFlags(m);
    var moverPc = pos.board[from];
    var capturedPc = (flags & C.F_EP) ? (pos.board[to + ((moverPc & C.COLOR) === C.WHITE ? -16 : 16)]) : pos.board[to];
    var capSq = (flags & C.F_EP) ? (to + ((moverPc & C.COLOR) === C.WHITE ? -16 : 16)) : to;

    sanList.push({ san: C.moveToSan(pos, m), white: (moverPc & C.COLOR) === C.WHITE });
    uciList.push(C.moveToUci(m));

    var wf = fileRankToWorld(C.fileOf(from), C.rankOf(from));
    var wt = fileRankToWorld(C.fileOf(to), C.rankOf(to));
    var pan = panOf(to);

    if (capturedPc) {
      fading.push({ pc: capturedPc, sq: capSq, a: 1 });
      var side = (capturedPc & C.COLOR) === C.WHITE ? "w" : "b";
      captured[side].push(capturedPc & C.TYPE);
    }

    anim = {
      m: m, pc: moverPc, wFrom: wf, wTo: wt, t: 0,
      dur: prefersReduced() ? 1 : ((moverPc & C.TYPE) === C.KNIGHT ? 330 : 250),
      arc: (moverPc & C.TYPE) === C.KNIGHT,
      onDone: function () {
        C.makeMove(pos, m);
        lastMove = m;
        if (capturedPc) { sCapture(pan); puff(capSq); }
        else if (flags & C.F_CASTLE) sCastle(pan);
        else sPlace(1, pan);

        var st = C.status(pos);
        checkPulse = st.check ? 1 : 0;
        if (st.check && !st.over) { sCheck(); flash(byPlayer ? "Check" : "Check!", !byPlayer); if (!byPlayer) say(foe.quips.check); }
        else if (!byPlayer && capturedPc) say(foe.quips.capture);

        updateTrays(); renderMoves(); updateBar();
        dirty = true;

        if (st.over) { finish(st); return; }
        if (pos.turn !== playerColor) setTimeout(requestEngineMove, 260);
      }
    };
    if (prefersReduced()) { anim.dur = 1; }
    dirty = true;
  }

  function prefersReduced() {
    return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  /* ---------- worker ---------- */
  function ensureWorker() {
    if (worker || workerBroken) return;
    try {
      worker = new Worker("engine.js");
      worker.onmessage = onEngineMessage;
      worker.onerror = function () { workerBroken = true; say("(the opponent has stepped out)"); };
    } catch (e) { workerBroken = true; }
  }

  function requestEngineMove() {
    if (gameOver) return;
    ensureWorker();
    if (!worker) return;
    thinking = true; pendingKind = "move";
    elOppSay.classList.add("is-think");
    elOppSay.textContent = "thinking";
    updateBar();
    thinkStart = performance.now();
    worker.postMessage({ type: "go", fen: C.toFen(pos), personality: foe.id, history: uciList.slice() });
  }
  var thinkStart = 0;

  function requestHint() {
    if (gameOver || thinking || pos.turn !== playerColor) return;
    ensureWorker();
    if (!worker) return;
    thinking = true; pendingKind = "hint";
    elOppSay.classList.add("is-think");
    elOppSay.textContent = "considering your position";
    updateBar();
    worker.postMessage({ type: "go", fen: C.toFen(pos), personality: "oracle", history: [] });
  }

  function onEngineMessage(e) {
    var d = e.data;
    if (d.type !== "bestmove") return;
    var kind = pendingKind; pendingKind = null;
    thinking = false;
    elOppSay.classList.remove("is-think");

    if (kind === "hint") {
      updateBar();
      if (!d.uci) { say("Nothing to suggest."); return; }
      hintMove = C.uciToMove(pos, d.uci);
      say("Try that.");
      dirty = true;
      return;
    }

    if (!d.uci) { updateBar(); return; }
    var m = C.uciToMove(pos, d.uci);
    if (!m) { updateBar(); return; }

    /* A move that lands the instant you release the mouse feels like a reflex, not
       a decision. Hold the weaker opponents back to a human-ish beat. */
    var elapsed = performance.now() - thinkStart;
    var floor = 420;
    var wait = Math.max(0, floor - elapsed);
    setTimeout(function () {
      say(foe.trait);
      updateBar();
      playMove(m, false);
    }, wait);
  }

  /* ---------- end of game ---------- */
  function finish(st) {
    gameOver = true; started = true;
    var playerWon = st.reason === "checkmate" && st.result === (playerColor === C.WHITE ? "1-0" : "0-1");
    var drawn = st.result === "1/2-1/2";

    var title, line, text;
    if (drawn) {
      title = "Drawn"; line = st.reason;
      text = "Neither side could force it. " + capitalise(st.reason) + " ends the game.";
      bump(LS.d);
    } else if (playerWon) {
      title = "You win"; line = "checkmate";
      text = "You beat <b>" + foe.name + "</b> in " + fullMoveCount() + " moves.";
      bump(LS.w);
      recordDefeat(foe.id);
      sMate(); setTimeout(sWin, 500);
      say(foe.quips.lose);
      confetti();
    } else {
      title = "Checkmate"; line = foe.name + " wins";
      text = "<b>" + foe.name + "</b> mated you in " + fullMoveCount() + " moves.";
      bump(LS.l);
      sMate();
      say(foe.quips.win);
    }
    if (drawn) sCheck();

    elResTitle.textContent = title;
    elResLine.textContent = line;
    elResText.innerHTML = text;
    elResSeal.innerHTML = sealSvg(foe, 54);
    elResRecord.textContent = "Record  " + lsGet(LS.w, "0") + "W · " + lsGet(LS.l, "0") + "L · " + lsGet(LS.d, "0") + "D" +
      "   ·   opponents beaten " + defeatedList().length + "/6";
    elResult.hidden = false;
    updateBar();
    setupShare(title, playerWon, drawn);
    dirty = true;
  }

  function capitalise(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function fullMoveCount() { return Math.ceil(sanList.length / 2); }
  function bump(k) { lsSet(k, String((parseInt(lsGet(k, "0"), 10) || 0) + 1)); }
  function defeatedList() {
    try { return JSON.parse(lsGet(LS.defeated, "[]")) || []; } catch (e) { return []; }
  }
  function recordDefeat(id) {
    var l = defeatedList();
    if (l.indexOf(id) < 0) l.push(id);
    lsSet(LS.defeated, JSON.stringify(l));
    /* One number for the ticket rule; the rule reads it, nothing awards directly. */
    lsSet(LS.beaten, String(l.length));
  }
  function confetti() {
    for (var i = 0; i < 5; i++) {
      setTimeout(function () {
        var s = boardGeom.squares[(Math.random() * 64) | 0];
        for (var k = 0; k < 10; k++) {
          var a = Math.random() * Math.PI * 2, sp = 1 + Math.random() * 2.4;
          particles.push({ x: s.c.x, y: s.c.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1.4,
            r: 1.5 + Math.random() * 2.4, life: 1,
            c: ["rgba(247,205,147,0.9)", "rgba(232,161,60,0.9)", "rgba(236,230,218,0.8)"][(Math.random() * 3) | 0] });
        }
      }, i * 130);
    }
  }

  /* ================= chrome ================= */
  function say(t) { elOppSay.textContent = t; }
  var calloutT = null;
  function flash(t, bad) {
    elCallout.textContent = t;
    elCallout.classList.toggle("is-bad", !!bad);
    elCallout.hidden = false;
    clearTimeout(calloutT);
    calloutT = setTimeout(hideCallout, 1400);
  }
  function hideCallout() { elCallout.hidden = true; }

  function renderOppCard() {
    elOppSeal.innerHTML = sealSvg(foe, 40);
    elOppName.textContent = foe.name;
    elOppElo.textContent = "~" + foe.elo;
  }

  var PIECE_CH = { 1: "♟", 2: "♞", 3: "♝", 4: "♜", 5: "♛" };
  var PIECE_VAL = { 1: 1, 2: 3, 3: 3, 4: 5, 5: 9 };
  function trayHtml(side) {
    var arr = captured[side].slice().sort(function (a, b) { return b - a; });
    var s = arr.map(function (t) { return PIECE_CH[t] || ""; }).join("");
    return s;
  }
  function updateTrays() {
    var wLost = captured.w.reduce(function (a, t) { return a + (PIECE_VAL[t] || 0); }, 0);
    var bLost = captured.b.reduce(function (a, t) { return a + (PIECE_VAL[t] || 0); }, 0);
    var edge = bLost - wLost;                    /* positive = white is ahead */
    var youAreWhite = playerColor === C.WHITE;
    var yourEdge = youAreWhite ? edge : -edge;

    /* Top tray is the opponent, bottom is you, whichever colour you chose. */
    elTrayTop.innerHTML = '<span class="captured__pieces">' + trayHtml(youAreWhite ? "b" : "w") + "</span>" +
      (yourEdge < 0 ? '<span class="captured__edge">+' + (-yourEdge) + "</span>" : "");
    elTrayBot.innerHTML = '<span class="captured__pieces">' + trayHtml(youAreWhite ? "w" : "b") + "</span>" +
      (yourEdge > 0 ? '<span class="captured__edge">+' + yourEdge + "</span>" : "");
  }

  function renderMoves() {
    if (!sanList.length) { elMoves.innerHTML = '<div class="moves__empty">No moves yet.</div>'; return; }
    var html = "", n = 1;
    for (var i = 0; i < sanList.length; i += 2) {
      var isLast = (i + 1 >= sanList.length - 1);
      html += '<div class="moves__row' + (i >= sanList.length - 2 ? " is-last" : "") + '">' +
        '<span class="moves__n">' + n + "</span>" +
        '<span class="moves__w">' + (sanList[i] ? sanList[i].san : "") + "</span>" +
        '<span class="moves__b">' + (sanList[i + 1] ? sanList[i + 1].san : "") + "</span></div>";
      n++;
    }
    elMoves.innerHTML = html;
    elMoves.scrollTop = elMoves.scrollHeight;
  }

  function updateBar() {
    $("btnUndo").disabled = thinking || gameOver || sanList.length < 1 || !!anim;
    $("btnHint").disabled = thinking || gameOver || pos === null || pos.turn !== playerColor || !!anim;
    $("btnResign").disabled = gameOver || !started;
  }

  /* ---------- opponent seals ----------
     A carved roundel with an engraved glyph. Six distinct marks read faster at
     40px than six faces would, and they stay legible in the gallery card. */
  function sealSvg(f, size) {
    var g = {
      pawn: '<circle cx="0" cy="-5" r="4.2"/><path d="M-2.6 -1.4h5.2l1.4 4.6h-8z"/><path d="M-5.6 6.4h11.2v2.2h-11.2z"/>',
      scale: '<path d="M0 -8v14"/><path d="M-7.5 -6h15"/><path d="M-7.5 -6l-2.6 5.2a3 3 0 0 0 5.2 0z"/><path d="M7.5 -6l-2.6 5.2a3 3 0 0 0 5.2 0z"/><path d="M-4 7h8"/>',
      blades: '<path d="M-6.5 -7L6 6.5"/><path d="M6.5 -7L-6 6.5"/><circle cx="0" cy="0" r="1.7"/>',
      compass: '<path d="M0 -8l-5.4 15"/><path d="M0 -8l5.4 15"/><path d="M-3.2 1.4h6.4"/><circle cx="0" cy="-8" r="1.6"/>',
      mask: '<path d="M-8 -4c0-2.4 16-2.4 16 0 0 6-3.6 9.6-8 9.6S-8 2-8 -4z"/><circle cx="-3.4" cy="-1.4" r="1.5" fill="#0b0c10" stroke="none"/><circle cx="3.4" cy="-1.4" r="1.5" fill="#0b0c10" stroke="none"/>',
      eye: '<path d="M-9 0c3.4-4.8 14.6-4.8 18 0-3.4 4.8-14.6 4.8-18 0z"/><circle cx="0" cy="0" r="2.9"/>'
    }[f.glyph];
    return '<svg viewBox="-14 -14 28 28" width="' + size + '" height="' + size + '" aria-hidden="true">' +
      '<circle cx="0" cy="0" r="13" fill="#111319" stroke="' + f.accent + '" stroke-opacity="0.5" stroke-width="1"/>' +
      '<circle cx="0" cy="0" r="10.6" fill="none" stroke="' + f.accent + '" stroke-opacity="0.22" stroke-width="0.7"/>' +
      '<g fill="none" stroke="' + f.accent + '" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
      g + "</g></svg>";
  }

  /* ---------- the cast screen ---------- */
  function buildCast() {
    var beaten = defeatedList();
    elCast.innerHTML = "";
    FOES.forEach(function (f) {
      var b = document.createElement("button");
      b.type = "button"; b.className = "foe";
      var pips = "";
      for (var i = 1; i <= 6; i++) pips += '<span class="foe__pip' + (i <= f.tier ? " on" : "") + '"></span>';
      b.innerHTML = '<span class="foe__seal">' + sealSvg(f, 38) + "</span>" +
        '<span class="foe__name">' + f.name + "</span>" +
        '<span class="foe__elo">~' + f.elo + " elo</span>" +
        '<span class="foe__pips">' + pips + "</span>" +
        '<span class="foe__trait">' + f.trait + "</span>" +
        (beaten.indexOf(f.id) >= 0 ? '<span class="foe__won" title="You have beaten this opponent">✓</span>' : "");
      b.addEventListener("click", function () {
        audioInit();
        elOverlay.classList.add("is-out");
        setTimeout(function () { elOverlay.hidden = true; elOverlay.classList.remove("is-out"); }, 240);
        startGame(f.id, sideChoice);
        elHint.classList.add("is-gone");
      });
      elCast.appendChild(b);
    });
  }

  var sideChoice = C.WHITE;
  function wireSide() {
    var btns = document.querySelectorAll("[data-side]");
    Array.prototype.forEach.call(btns, function (b) {
      b.addEventListener("click", function () {
        sideChoice = b.getAttribute("data-side") === "black" ? C.BLACK : C.WHITE;
        Array.prototype.forEach.call(btns, function (o) { o.classList.toggle("btn--go", o === b); });
      });
    });
  }

  /* ---------- bar actions ---------- */
  $("btnNew").addEventListener("click", function () {
    elResult.hidden = true;
    buildCast();
    elOverlay.hidden = false;
    started = false;
  });
  $("btnUndo").addEventListener("click", function () {
    if (thinking || anim || !sanList.length) return;
    /* Take back to the player's own turn: their move and the reply. */
    var n = (pos.turn === playerColor) ? 2 : 1;
    for (var i = 0; i < n && pos.undo.length; i++) {
      C.unmakeMove(pos);
      var s = sanList.pop(); uciList.pop();
    }
    rebuildCaptures();
    lastMove = pos.undo.length ? pos.undo[pos.undo.length - 1].m : null;
    selected = -1; legalFrom = []; hintMove = 0; gameOver = false;
    checkPulse = C.inCheck(pos, pos.turn) ? 1 : 0;
    elResult.hidden = true;
    updateTrays(); renderMoves(); updateBar();
    sSelect(0); dirty = true;
  });
  $("btnHint").addEventListener("click", requestHint);
  $("btnFlip").addEventListener("click", function () {
    flip = !flip; cacheSquares();
    buildBoardTexture(window.innerWidth, window.innerHeight);
    dirty = true;
  });
  $("btnResign").addEventListener("click", function () {
    if (gameOver || !started) return;
    gameOver = true;
    bump(LS.l);
    elResTitle.textContent = "Resigned";
    elResLine.textContent = foe.name + " wins";
    elResText.innerHTML = "You resigned after " + fullMoveCount() + " moves against <b>" + foe.name + "</b>.";
    elResSeal.innerHTML = sealSvg(foe, 54);
    elResRecord.textContent = "Record  " + lsGet(LS.w, "0") + "W · " + lsGet(LS.l, "0") + "L · " + lsGet(LS.d, "0") + "D";
    elResult.hidden = false;
    say(foe.quips.win);
    updateBar();
  });
  $("btnAgain").addEventListener("click", function () {
    elResult.hidden = true;
    startGame(foe.id, playerColor);
  });
  $("btnCast").addEventListener("click", function () {
    elResult.hidden = true;
    buildCast();
    elOverlay.hidden = false;
    started = false;
  });

  /* Recompute the captured trays from the board, which is cheaper to get right
     than unwinding the tray on every undo. */
  function rebuildCaptures() {
    var full = { 1: 8, 2: 2, 3: 2, 4: 2, 5: 1 };
    var have = { w: {}, b: {} };
    for (var i = 0; i < 64; i++) {
      var pc = pos.board[C.SQUARES[i]];
      if (!pc) continue;
      var t = pc & C.TYPE; if (t === C.KING) continue;
      var s = (pc & C.COLOR) === C.WHITE ? "w" : "b";
      have[s][t] = (have[s][t] || 0) + 1;
    }
    captured = { w: [], b: [] };
    ["w", "b"].forEach(function (s) {
      Object.keys(full).forEach(function (t) {
        var miss = full[t] - (have[s][t] || 0);
        for (var k = 0; k < miss; k++) captured[s].push(+t);
      });
    });
  }

  /* ---------- keyboard ----------
     Arrows walk a cursor, Enter picks up and puts down. Chess is a grid game and
     suits the keyboard perfectly, so this is a genuine accessibility path — and it
     is also how the card pose and the headless tests drive the board without a
     debug hook. */
  function moveCursor(df, dr) {
    if (!started || gameOver) return;
    if (cursor < 0) cursor = C.sq88(4, playerColor === C.WHITE ? 1 : 6);
    else {
      var f = C.fileOf(cursor) + (flip ? -df : df);
      var r = C.rankOf(cursor) + (flip ? -dr : dr);
      if (f < 0 || f > 7 || r < 0 || r > 7) return;
      cursor = C.sq88(f, r);
    }
    dirty = true;
  }
  window.addEventListener("keydown", function (e) {
    var k = e.key;
    if (k === "ArrowLeft" || k === "ArrowRight" || k === "ArrowUp" || k === "ArrowDown") {
      e.preventDefault();
      moveCursor(k === "ArrowRight" ? 1 : k === "ArrowLeft" ? -1 : 0,
                 k === "ArrowUp" ? 1 : k === "ArrowDown" ? -1 : 0);
      return;
    }
    if (k === "Enter" || k === " ") {
      if (!started || gameOver || thinking || anim || promoPending) return;
      if (pos.turn !== playerColor) return;
      e.preventDefault();
      audioInit();
      if (cursor < 0) { moveCursor(0, 0); return; }
      onSquare(cursor);
      return;
    }
    if (e.key === "u" || e.key === "U") $("btnUndo").click();
    else if (e.key === "h" || e.key === "H") $("btnHint").click();
    else if (e.key === "f" || e.key === "F") $("btnFlip").click();
    else if (e.key === "n" || e.key === "N") $("btnNew").click();
    else if (e.key === "Escape" && promoPending) { elPromo.hidden = true; promoPending = null; selected = -1; legalFrom = []; dirty = true; }
  });

  /* ---------- share ---------- */
  function setupShare(title, won, drawn) {
    var verb = drawn ? "drew with" : won ? "beat" : "lost to";
    window.OPT_SHARE_TEXT = "I " + verb + " " + foe.name + " (~" + foe.elo + ") at chess on One Page Toys";
    window.OPT_SHARE_LINE = verb === "beat" ? "Beat " + foe.name : capitalise(verb) + " " + foe.name;
    window.OPT_SHARE_IMAGE = function () {
      var w = 1200, h = 900;
      var out = document.createElement("canvas");
      out.width = w; out.height = h;
      var g = out.getContext("2d");
      g.fillStyle = "#08090c"; g.fillRect(0, 0, w, h);
      /* Reuse the live board: the position on screen IS the result. */
      g.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, w, h * 0.86);
      g.fillStyle = "rgba(8,9,12,0.94)"; g.fillRect(0, h - 118, w, 118);
      g.fillStyle = "#f7cd93";
      g.font = "800 44px Archivo, sans-serif"; g.textBaseline = "middle";
      g.fillText(window.OPT_SHARE_LINE, 46, h - 74);
      g.fillStyle = "rgba(236,230,218,0.5)";
      g.font = "500 25px 'Geist Mono', monospace";
      g.fillText("onepagetoys.com/toys/chess", 46, h - 32);
      return out;
    };
  }

  /* ---------- boot ---------- */
  wireSide();
  buildCast();
  resize();
  requestAnimationFrame(tick);
  setTimeout(function () { elHint.classList.add("is-gone"); }, 9000);
})();
