/* Trench Runner — No. 121. Fly a neon canal at speed and breach the core.
 *
 * Canvas 2D, no WebGL. A corridor is the one 3D shape that a pinhole projection
 * draws honestly with nothing but strokes: ribs at rising depth, rails running
 * between them, and everything scaled by FOCAL/dz. Stroked glow is also the
 * cheapest good-looking thing this repo has, so the vector-arcade skin pays for
 * itself twice.
 *
 * Nothing here references any particular film: the canal is a maintenance
 * channel, the hazards are broken machinery, and the finish is a reactor throat.
 */
(function () {
  "use strict";

  var TAU = Math.PI * 2;
  var canvas = document.getElementById("canvas");
  var ctx = canvas.getContext("2d");
  var W = 0, H = 0, DPR = 1, cx = 0, cy = 0;

  var el = {
    hud: document.getElementById("hud"),
    score: document.getElementById("score"),
    time: document.getElementById("time"),
    best: document.getElementById("best"),
    kills: document.getElementById("kills"),
    hull: document.getElementById("hull"),
    prog: document.getElementById("prog"),
    progFill: document.getElementById("progFill"),
    heat: document.getElementById("heat"),
    heatFill: document.getElementById("heatFill"),
    boost: document.getElementById("boostPad"),
    callout: document.getElementById("callout"),
    lock: document.getElementById("lock"),
    overlay: document.getElementById("overlay"),
    ovEyebrow: document.getElementById("ovEyebrow"),
    ovTitle: document.getElementById("ovTitle"),
    ovText: document.getElementById("ovText"),
    ovBtn: document.getElementById("ovBtn"),
    ovDemo: document.getElementById("ovDemo"),
    soundBtn: document.getElementById("soundBtn"),
    hint: document.getElementById("hint")
  };

  var KEY_BEST = "trench_best";     // best score — the one ticket key, dir up
  var KEY_TIME = "trench_time";     // best clear time, shown only
  var KEY_SOUND = "trench_sound";

  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var coarse = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;

  /* ------------------------------------------------------------ the world */

  var HALF = 9.6;            // canal half-width, world units
  var FLOOR = 6.4;           // floor below the centreline
  var TOP = -6.6;            // wall top — the canal is OPEN above this
  var MIDY = (FLOOR + TOP) / 2;
  var SHIP_R = 1.05;
  /* ⚠ ONE constant for every collision AND every warning colour. The hitbox is
   * deliberately smaller than the ship you see — standard for this kind of
   * game and the cheapest way to make contact feel fair — but if the ghost
   * marker or a gap outline used a different radius they would lie about
   * whether you fit. Everything that tests contact uses HIT_R. */
  var HIT_R = SHIP_R * 0.58;
  var INV_TIME = 0.9;        // grace after a hit, so one mistake is not three
  var RIB_GAP = 8;           // depth between ribs
  var FAR = 300;             // draw distance
  var FOCAL = 0;             // set per screen in layout()
  var RUN_LEN = 3150;        // ~56s at base speed — a phone sitting, not a desk one
  var FINAL = 300;           // the last stretch: no hazards, the throat ahead

  /* A chase camera sitting behind and above the ship. The first pass pinned the
   * ship to a fixed point on screen and slid the canal around it, which looks
   * fine and plays terribly: if the ship never moves, "put it where I point"
   * cannot mean anything, and on a touch screen that is the only control worth
   * having. CAM_F is how much the camera follows sideways — some, so the world
   * leans, but well under 1 so the ship still travels across the frame. */
  var CAM_BACK = 20, CAM_UP = 2.0, CAM_F = 0.82;
  /* ⚠ THE SHIP IS NOT WHAT YOU STEER — the RETICLE is. The 1983 cabinet flew
   * for you: the stick moved a crosshair out in front and the ship only leaned
   * after it. That is what makes the run about SHOOTING rather than driving, so
   * the ship tracks only SHIP_FOLLOW of the reticle's deflection and is pulled
   * back to the middle of the canal on its own. */
  var AIM_DEPTH = 108;       // how far ahead the crosshair sits, world units
  /* ⚠ MEASURED: at 0.52 the ship could only reach 65% of the canal's width and
   * 76% of its height — a gap hard against a wall was literally unreachable,
   * and 58% of all deaths were flying into a barrier because of it. The ship's
   * reachable box must COVER the canal. The "it flies for you" feel comes from
   * the lag and the speed cap below, not from a scale factor that breaks the
   * correspondence between where you point and where you end up. */
  var SHIP_FOLLOW = 0.75;    // how much of the reticle's travel the ship copies
  var FIRE_CD = 0.09;        // anti-spam floor only — one shot per click, not a stream
  var MAX_LAT = 23;          // world units/sec the ship will ever travel sideways
  var SHOT_SPD = 620, BOLT_SPD = 150;
  var TOUCH_LIFT = 74;       // draw the ship this far ABOVE the thumb holding it
  var SCALE = 0, CTRL = 0;   // px per world unit at the ship, and for steering
  var CAM = { x: 0, y: 0, z: 0 };

  var SPEED_BASE = 56, SPEED_BOOST = 95;
  var BOOM_LEN = 4.2;        // seconds of detonation before the panel
  var SHOCK_SPD = 900;       // how fast the blast front comes up the canal
  var HEAT_UP = 0.52, HEAT_DOWN = 0.34;   // per second

  var G = {
    phase: "idle",           // idle | fly | lock | dead | won
    z: 0, x: 0, y: 0,        // ship position (x,y are canal-LOCAL)
    ax: 0, ay: 0,            // reticle, canal-local at AIM_DEPTH ahead
    shots: [], turrets: [], bolts: [], props: [],
    fireCd: 0, kills: 0, shotsFired: 0, hitsLanded: 0,
    hull: 3, portHit: false,
    vx: 0, vy: 0,
    speed: SPEED_BASE,
    roll: 0,
    heat: 0, over: false,
    boosting: false,
    score: 0, combo: 0,
    hits: 0, grazes: 0,
    t0: 0, elapsed: 0,
    best: 0, bestTime: 0,
    lockAmt: 0, fired: false,
    shake: 0, flash: 0, hitFlash: 0, scrapeFlash: 0, hitMark: 0, inv: 0,
    boomT: -1, shockZ: 0, debris: [], whiteout: 0, washed: false,
    bars: [],                // hazards ahead
    sparks: [],
    stars: []
  };

  /* The canal wanders. Two slow sines per axis read as a route rather than a
   * wobble, and keeping the amplitude under about a third of the width means a
   * turn is always survivable at boost. */
  function canalX(z) { return Math.sin(z * 0.00152) * 15 + Math.sin(z * 0.00061 + 1.7) * 23; }
  function canalY(z) { return Math.sin(z * 0.00104 + 0.6) * 6.5; }

  /* --------------------------------------------------------------- hazards */

  function buildBars() {
    var bars = [], z = 340;
    while (z < RUN_LEN - FINAL) {
      // difficulty ramps with distance: the gap tightens, the spacing closes
      var p = z / (RUN_LEN - FINAL);
      var gapW = (HALF * 2) * (0.62 - p * 0.24);          // 62% of the canal down to 38%
      var gapH = (FLOOR - TOP) * (0.64 - p * 0.22);
      var kind = Math.random();
      var b = { z: z, hit: false, scored: false };

      if (kind < 0.34) {                                   // a slab from one side
        var left = Math.random() < 0.5;
        b.x0 = left ? HALF - gapW : -HALF;
        b.x1 = b.x0 + gapW;
        b.y0 = TOP; b.y1 = FLOOR;
      } else if (kind < 0.6) {                             // fly over, or under
        var low = Math.random() < 0.5;
        b.x0 = -HALF; b.x1 = HALF;
        b.y0 = low ? FLOOR - gapH : TOP;
        b.y1 = b.y0 + gapH;
      } else if (kind < 0.84) {                            // a pillar: two gaps, pick one
        b.pillar = true;
        var w = gapW * 0.52;
        b.px = (Math.random() - 0.5) * (HALF * 0.7);
        b.x0 = -HALF; b.x1 = HALF; b.y0 = TOP; b.y1 = FLOOR;
        b.gapA = [-HALF, b.px - w * 0.5];
        b.gapB = [b.px + w * 0.5, HALF];
      } else {                                             // a window: a hole in a wall
        var w2 = gapW * 0.8, h2 = gapH * 0.92;
        b.x0 = (Math.random() - 0.5) * (HALF * 2 - w2) - w2 / 2;
        b.x1 = b.x0 + w2;
        b.y0 = MIDY - h2 / 2 + (Math.random() - 0.5) * ((FLOOR - TOP) - h2) * 0.8;
        b.y1 = b.y0 + h2;
      }
      bars.push(b);
      z += 250 - p * 70 + Math.random() * 90;
    }
    return bars;
  }

  /* Gun emplacements along the canal. They are the point of the run, so they
   * outnumber the hazards and sit where a crosshair naturally sweeps.
   *
   * ⚠ THEY MUST BE PLACED AGAINST THE HAZARDS, NOT INDEPENDENTLY OF THEM.
   * Aiming pulls the ship SHIP_FOLLOW of the way toward whatever the crosshair
   * is on, so a gun sitting beyond a barrier whose opening is somewhere else
   * makes shooting it and surviving it mutually exclusive — owner: "some of the
   * targets are too close to the barriers to steer to and hit". A gun is only
   * kept if the position aiming at it would DRAG THE SHIP INTO still clears
   * every barrier the player is threading at the time. */
  var AIM_LEAD = AIM_DEPTH + 40;       // how far ahead the crosshair already works
  var BAR_CLEAR = 26;                  // never sit in a barrier's own plane

  function turretIsFair(tx, ty, tz, bars, props) {
    var sx = tx * SHIP_FOLLOW, sy = MIDY + (ty - MIDY) * SHIP_FOLLOW;
    var i;
    for (i = 0; i < bars.length; i++) {
      var b = bars[i];
      if (Math.abs(b.z - tz) < BAR_CLEAR) return false;
      if (tz < b.z - 30 || tz > b.z + AIM_LEAD) continue;
      if (!through(b, sx, sy, SHIP_R)) return false;
    }
    // the same trap applies to wall structure: a gun you can only hit by
    // flying into a girder is a gun you cannot hit
    if (props) {
      for (i = 0; i < props.length; i++) {
        var pr = props[i];
        if (tz < pr.z - 20 || tz > pr.z + AIM_LEAD) continue;
        if (inProp(pr, sx, sy, SHIP_R)) return false;
      }
    }
    return true;
  }

  /* Girders and housings bolted to the canal walls. They jut into the channel,
   * they hurt, and one shot clears them — so the same crosshair that kills guns
   * also opens a lane. Each one blocks at most PROP_MAX of the width from ONE
   * side, so a clear line always exists even where two overlap. */
  var PROP_MAX = 0.44;

  function buildProps(bars) {
    var out = [], z = 190, lastZ = -999;
    while (z < RUN_LEN - FINAL - 20) {
      var nearBar = false;
      for (var i = 0; i < bars.length; i++) {
        if (Math.abs(bars[i].z - z) < 34) { nearBar = true; break; }
      }
      if (!nearBar && z - lastZ > 26) {
        var p = z / RUN_LEN;
        var depth = (0.22 + Math.random() * (PROP_MAX - 0.22) + p * 0.06) * HALF * 2;
        var span = (FLOOR - TOP) * (0.3 + Math.random() * 0.42);
        var vy = TOP + Math.random() * (FLOOR - TOP - span);
        var side = Math.random();
        var pr = { z: z, dead: false, boom: 0 };
        if (side < 0.40) { pr.x0 = -HALF; pr.x1 = -HALF + depth; pr.y0 = vy; pr.y1 = vy + span; }
        else if (side < 0.80) { pr.x0 = HALF - depth; pr.x1 = HALF; pr.y0 = vy; pr.y1 = vy + span; }
        else {
          var w = (0.28 + Math.random() * 0.3) * HALF * 2;
          pr.x0 = -HALF + Math.random() * (HALF * 2 - w); pr.x1 = pr.x0 + w;
          if (Math.random() < 0.5) { pr.y1 = FLOOR; pr.y0 = FLOOR - (FLOOR - TOP) * (0.22 + Math.random() * 0.2); }
          else { pr.y0 = TOP; pr.y1 = TOP + (FLOOR - TOP) * (0.22 + Math.random() * 0.2); }
        }
        out.push(pr);
        lastZ = z;
      }
      /* DENSITY DIAL — a girder roughly every two seconds. Easing this to
       * 62+54 was measured and changed the autopilot's average depth by 1%,
       * so the difficulty lives in the return fire, not here. Raise both
       * numbers for a barer canal. */
      z += 48 + Math.random() * 46;
    }
    return out;
  }

  function inProp(pr, x, y, pad) {
    pad = pad || 0;
    return x > pr.x0 - pad && x < pr.x1 + pad && y > pr.y0 - pad && y < pr.y1 + pad;
  }

  var PROPS_FOR_FAIRNESS = null;
  function buildTurrets(bars, props) {
    PROPS_FOR_FAIRNESS = props || null;
    var out = [], z = 260;
    while (z < RUN_LEN - FINAL + 40) {
      var p = z / RUN_LEN;
      var n = 1 + (Math.random() < 0.3 + p * 0.4 ? 1 : 0);
      for (var i = 0; i < n; i++) {
        var tz = z + i * 26;
        for (var attempt = 0; attempt < 12; attempt++) {
          var side = Math.random(), tx, ty, face;
          if (side < 0.38) { tx = -HALF + 0.5; ty = TOP + 1.6 + Math.random() * (FLOOR - TOP - 3); face = 1; }
          else if (side < 0.76) { tx = HALF - 0.5; ty = TOP + 1.6 + Math.random() * (FLOOR - TOP - 3); face = -1; }
          else { tx = (Math.random() - 0.5) * (HALF * 1.5); ty = FLOOR - 0.5; face = 0; }
          if (!turretIsFair(tx, ty, tz, bars, PROPS_FOR_FAIRNESS)) continue;
          out.push({ x: tx, y: ty, z: tz, face: face, dead: false, charge: 0,
                     cd: 0.9 + Math.random() * 1.6, fired: 0 });
          break;
        }
      }
      z += 95 + Math.random() * 80;
    }
    return out;
  }

  // Is the ship inside this bar's opening? Pillars have two.
  function through(b, x, y, pad) {
    pad = pad || 0;
    function inside(x0, x1, y0, y1) {
      return x - pad >= x0 && x + pad <= x1 && y - pad >= y0 && y + pad <= y1;
    }
    if (b.pillar) {
      return inside(b.gapA[0], b.gapA[1], b.y0, b.y1) || inside(b.gapB[0], b.gapB[1], b.y0, b.y1);
    }
    return inside(b.x0, b.x1, b.y0, b.y1);
  }

  // Distance from the ship to the nearest edge of the opening it is in.
  function clearance(b, x, y) {
    function edge(x0, x1, y0, y1) {
      return Math.min(x - x0, x1 - x, y - y0, y1 - y);
    }
    if (b.pillar) return Math.max(edge(b.gapA[0], b.gapA[1], b.y0, b.y1), edge(b.gapB[0], b.gapB[1], b.y0, b.y1));
    return edge(b.x0, b.x1, b.y0, b.y1);
  }

  /* ------------------------------------------------------------ projection */

  function syncCam() {
    CAM.x = canalX(G.z) + G.x * CAM_F;
    CAM.y = canalY(G.z) + G.y * CAM_F - CAM_UP;
    CAM.z = G.z - CAM_BACK;
  }

  function project(wx, wy, wz) {
    var dz = wz - CAM.z;
    if (dz < 1.2) return null;
    var s = FOCAL / dz;
    var dx = (wx - CAM.x) * s;
    var dy = (wy - CAM.y) * s;      // camera sits a little above the ship
    if (G.roll) {
      var c = Math.cos(G.roll), sn = Math.sin(G.roll);
      var rx = dx * c - dy * sn, ry = dx * sn + dy * c;
      dx = rx; dy = ry;
    }
    return { x: cx + dx, y: cy + dy, s: s };
  }

  // A point on the canal cross-section at depth z ahead: local (lx,ly) -> screen
  function px(lx, ly, z) {
    return project(canalX(z) + lx, canalY(z) + ly, z);
  }

  /* ---------------------------------------------------------------- render */

  var CYAN = "143,228,255", HOT = "255,61,129", GOLD = "255,209,102", LIME = "150,255,190";
  var STEEL = "176,138,255";       // structure: its own hue, not a shade of the wall
  var LAMP = "120,255,238";        // wall lamps — landmarks to clock speed against

  function glowLine(pts, col, alpha, wide, thin) {
    if (pts.length < 2) return;
    var i;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.strokeStyle = "rgba(" + col + "," + (alpha * 0.14).toFixed(3) + ")";
    ctx.lineWidth = wide;
    ctx.stroke();
    ctx.strokeStyle = "rgba(" + col + "," + Math.min(1, alpha).toFixed(3) + ")";
    ctx.lineWidth = thin;
    ctx.stroke();
  }

  function fade(dz) { return Math.max(0, Math.min(1, 1 - dz / FAR)); }

  function draw(now) {
    syncCam();
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#03040c";
    ctx.fillRect(0, 0, W, H);

    var shakeX = 0, shakeY = 0;
    if (G.shake > 0.001 && !reduceMotion) {
      shakeX = (Math.random() - 0.5) * G.shake * 26;
      shakeY = (Math.random() - 0.5) * G.shake * 26;
      ctx.translate(shakeX, shakeY);
    }

    ctx.globalCompositeOperation = "lighter";

    /* Sky above the canal walls — the only thing that is not a line, and the
     * only cue that the channel is open at the top rather than a tube. */
    var i, s, p;
    for (i = 0; i < G.stars.length; i++) {
      s = G.stars[i];
      var sy = s.y - (G.z * 0.02 % H);
      if (sy < 0) sy += H;
      var twinkle = reduceMotion ? 1 : 0.7 + 0.3 * Math.sin(now * 0.0016 + s.p);
      ctx.fillStyle = "rgba(190,215,255," + (s.a * twinkle).toFixed(3) + ")";
      ctx.fillRect(s.x, sy, s.r, s.r);
    }

    var z0 = Math.floor((G.z - CAM_BACK) / RIB_GAP) * RIB_GAP;

    /* Rails: the long lines running away down the canal. They are what sells
     * speed, because they are the only thing whose motion you can actually
     * track between frames. */
    var rails = [
      [-HALF, TOP], [HALF, TOP],
      [-HALF, MIDY], [HALF, MIDY],
      [-HALF, FLOOR], [HALF, FLOOR],
      [-HALF * 0.5, FLOOR], [0, FLOOR], [HALF * 0.5, FLOOR]
    ];
    for (var r = 0; r < rails.length; r++) {
      var pts = [];
      /* ⚠ Starting at +2 puts the first vertex almost on the lens, where it
       * projects thousands of pixels off-screen — and the segment joining it to
       * the next one rakes a bright line right across the frame. +6 is still
       * close enough to run the floor off the bottom edge without that. */
      for (var zz = CAM.z + 6; zz < G.z + FAR; zz += RIB_GAP) {
        p = px(rails[r][0], rails[r][1], zz);
        if (p) pts.push(p);
      }
      var faintRail = (r === 2 || r === 3 || r >= 6);
      var rt = G.phase === "boom" ? boomTint(G.z + 40) : null;
      glowLine(pts, rt ? rt.col : CYAN, rt ? rt.a * 0.8 : (faintRail ? 0.26 : 0.62), 7, faintRail ? 0.9 : 1.5);
    }

    // Ribs, far to near, fading out at the draw distance
    for (var zr = z0 + FAR; zr > CAM.z + 2; zr -= RIB_GAP) {
      var a = fade(zr - CAM.z) * 0.8;
      if (a < 0.02) continue;
      var bt = boomTint(zr);
      var g2 = bt ? 1 + bt.tear : 1;
      var hw = HALF * g2, ty2 = MIDY + (TOP - MIDY) * g2, fy2 = MIDY + (FLOOR - MIDY) * g2;
      var c1 = px(-hw, ty2, zr), c2 = px(hw, ty2, zr),
          c3 = px(hw, fy2, zr), c4 = px(-hw, fy2, zr);
      if (!c1 || !c2 || !c3 || !c4) continue;
      glowLine([c1, c4, c3, c2], bt ? bt.col : CYAN, (bt ? bt.a : a * 0.5), bt ? 9 : 5, bt ? 2 : 1.1);

      // a lamp on each wall every fourth rib
      if (Math.round(zr / RIB_GAP) % 4 === 0) {
        for (var sgn = -1; sgn <= 1; sgn += 2) {
          var l1 = px(sgn * HALF, MIDY - 0.9, zr), l2 = px(sgn * HALF, MIDY + 0.9, zr);
          if (l1 && l2) glowLine([l1, l2], LAMP, a * 0.9, 9, 2.4);
        }
      }
    }

    // Hazards
    for (i = 0; i < G.bars.length; i++) {
      var b = G.bars[i], dz = b.z - G.z;
      if (dz < -6 || dz > FAR) continue;
      var af = fade(dz);
      if (af < 0.02) continue;
      drawBar(b, af);
    }

    // wall structure
    for (i = 0; i < G.props.length; i++) {
      var pw = G.props[i], pdz = pw.z - CAM.z;
      if (pdz < 2 || pdz > FAR) continue;
      var pa = fade(pdz);
      if (pa < 0.03) continue;
      if (pw.dead) {
        if (pw.boom > 0) {
          var bq = px((pw.x0 + pw.x1) / 2, (pw.y0 + pw.y1) / 2, pw.z);
          if (bq) {
            ctx.strokeStyle = "rgba(" + GOLD + "," + (pw.boom * 0.7).toFixed(3) + ")";
            ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(bq.x, bq.y, (1 - pw.boom) * 46 + 4, 0, TAU); ctx.stroke();
          }
        }
        continue;
      }
      var willHit = inProp(pw, G.x, G.y, HIT_R);
      quad(pw.x0, pw.x1, pw.y0, pw.y1, pw.z, willHit ? HOT : STEEL, pa * (willHit ? 1 : 0.85));
      // a bracket back to the wall it is bolted to, so it reads as attached
      var anchor = pw.x0 <= -HALF + 0.01 ? -HALF : (pw.x1 >= HALF - 0.01 ? HALF : null);
      if (anchor !== null) {
        var e1 = px(anchor, pw.y0, pw.z), e2 = px(anchor, pw.y1, pw.z);
        if (e1 && e2) {
          ctx.strokeStyle = "rgba(" + STEEL + "," + (pa * 0.5).toFixed(3) + ")";
          ctx.lineWidth = 2.4;
          ctx.beginPath(); ctx.moveTo(e1.x, e1.y); ctx.lineTo(e2.x, e2.y); ctx.stroke();
        }
      }
    }

    // turrets
    for (i = 0; i < G.turrets.length; i++) {
      var t3 = G.turrets[i];
      var tdz = t3.z - CAM.z;
      if (tdz < 2 || tdz > FAR) continue;
      var ta = fade(tdz);
      if (ta < 0.03) continue;
      if (t3.dead) {
        if (t3.boom > 0) {
          var bp = px(t3.x, t3.y, t3.z);
          if (bp) {
            var rr = (1 - t3.boom) * 60 * (FOCAL / tdz / SCALE) + 4;
            ctx.strokeStyle = "rgba(" + GOLD + "," + (t3.boom * 0.8).toFixed(3) + ")";
            ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(bp.x, bp.y, rr, 0, TAU); ctx.stroke();
          }
        }
        continue;
      }
      var core = px(t3.x, t3.y, t3.z);
      if (!core) continue;
      var charging = t3.charge > 0.05;
      var col2 = charging ? HOT : GOLD;
      // Screen radius, capped: a gun a few units away would otherwise fill the
      // frame with a hexagon and read as scenery rather than a target.
      var rad2 = Math.max(4.5, Math.min(46, 1.9 * FOCAL / tdz));
      var pts2 = [];
      for (var q = 0; q <= 6; q++) {
        var ang2 = q / 6 * TAU + 0.5;
        pts2.push({ x: core.x + Math.cos(ang2) * rad2, y: core.y + Math.sin(ang2) * rad2 });
      }
      glowLine(pts2, col2, ta * (charging ? 0.75 + t3.charge * 0.25 : 0.95), 11, 2.4);

      /* Target brackets. A gun has to read as a THING TO SHOOT at a glance,
       * against a wall made of the same kind of glowing lines. */
      var br = rad2 * 1.75, bl = rad2 * 0.6;
      ctx.strokeStyle = "rgba(" + col2 + "," + (ta * 0.6).toFixed(3) + ")";
      ctx.lineWidth = Math.max(1, rad2 * 0.1);
      ctx.beginPath();
      for (var sx2 = -1; sx2 <= 1; sx2 += 2) {
        for (var sy2 = -1; sy2 <= 1; sy2 += 2) {
          ctx.moveTo(core.x + sx2 * br, core.y + sy2 * br);
          ctx.lineTo(core.x + sx2 * br, core.y + sy2 * (br - bl));
          ctx.moveTo(core.x + sx2 * br, core.y + sy2 * br);
          ctx.lineTo(core.x + sx2 * (br - bl), core.y + sy2 * br);
        }
      }
      ctx.stroke();

      // a charging gun throws an expanding warning ring: it is about to fire
      if (charging && !reduceMotion) {
        ctx.strokeStyle = "rgba(" + HOT + "," + (ta * (1 - t3.charge) * 0.8).toFixed(3) + ")";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(core.x, core.y, rad2 * (1 + t3.charge * 2.4), 0, TAU);
        ctx.stroke();
      }
      // a barrel pointing into the canal, so you can see which way it is facing
      if (t3.face) {
        ctx.strokeStyle = "rgba(" + col2 + "," + (ta * 0.6).toFixed(3) + ")";
        ctx.lineWidth = Math.max(1, rad2 * 0.16);
        ctx.beginPath();
        ctx.moveTo(core.x + t3.face * rad2 * 0.6, core.y);
        ctx.lineTo(core.x + t3.face * rad2 * 1.8, core.y);
        ctx.stroke();
      }
      ctx.fillStyle = "rgba(" + col2 + "," + (ta * (0.35 + t3.charge * 0.65)).toFixed(3) + ")";
      ctx.beginPath(); ctx.arc(core.x, core.y, Math.max(1.4, rad2 * 0.34), 0, TAU); ctx.fill();
    }

    // our shots, drawn as streaks so the cadence reads
    for (i = 0; i < G.shots.length; i++) {
      var s2 = G.shots[i];
      var za = s2.z, zb = Math.max(CAM.z + 3, s2.z - 42);
      var pa = px(s2.x + s2.dx * (za - s2.z0), s2.y + s2.dy * (za - s2.z0), za);
      var pb = px(s2.x + s2.dx * (zb - s2.z0), s2.y + s2.dy * (zb - s2.z0), zb);
      if (!pa || !pb) continue;
      glowLine([pb, pa], LIME, 1, 7, 2.2);
    }

    // incoming
    for (i = 0; i < G.bolts.length; i++) {
      var b2 = G.bolts[i];
      var tailZ = Math.min(b2.z0, b2.z + 18);
      var q1 = px(boltX(b2, b2.z), boltY(b2, b2.z), b2.z);
      var q2 = px(boltX(b2, tailZ), boltY(b2, tailZ), tailZ);
      if (!q1 || !q2) continue;
      glowLine([q2, q1], HOT, 0.95, 7, 2.2);
    }

    /* The clearest possible answer to "will I fit": put a marker where the ship
     * currently sits, drawn ON the plane of the next hazard. Lined up with the
     * gap outline, it turns a depth judgement into a 2D one. */
    if (G.phase === "fly") {
      var next = null;
      for (i = 0; i < G.bars.length; i++) {
        var nb = G.bars[i];
        if (nb.z <= G.z || nb.z - G.z > 170) continue;
        if (!next || nb.z < next.z) next = nb;
      }
      if (next) {
        var gp = px(G.x, G.y, next.z);
        if (gp) {
          var safe = through(next, G.x, G.y, HIT_R);
          var gr = Math.max(4, HIT_R * FOCAL / (next.z - CAM.z));
          ctx.strokeStyle = "rgba(" + (safe ? LIME : HOT) + ",0.7)";
          ctx.lineWidth = 1.4;
          ctx.beginPath(); ctx.arc(gp.x, gp.y, gr, 0, TAU); ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(gp.x - gr * 1.9, gp.y); ctx.lineTo(gp.x - gr * 1.15, gp.y);
          ctx.moveTo(gp.x + gr * 1.15, gp.y); ctx.lineTo(gp.x + gr * 1.9, gp.y);
          ctx.stroke();
        }
      }
    }

    if (G.phase === "lock" || G.phase === "won") drawThroat(now);
    if (G.phase === "boom") drawBoom(now);

    // Sparks from clips and grazes
    for (i = G.sparks.length - 1; i >= 0; i--) {
      var sp = G.sparks[i];
      sp.life -= 0.045;
      if (sp.life <= 0) { G.sparks.splice(i, 1); continue; }
      sp.sx += sp.vx; sp.sy += sp.vy; sp.vy += 0.35;
      ctx.fillStyle = "rgba(" + sp.col + "," + (sp.life * 0.9).toFixed(3) + ")";
      ctx.fillRect(sp.sx, sp.sy, 2.4, 2.4);
    }

    if (G.phase !== "dead") drawShip();
    if (G.phase === "fly" || G.phase === "lock") drawReticle();

    if (G.flash > 0.001) {
      ctx.fillStyle = "rgba(180,240,255," + (G.flash * 0.5).toFixed(3) + ")";
      ctx.fillRect(-40, -40, W + 80, H + 80);
      G.flash *= reduceMotion ? 0.7 : 0.9;
    }
    // DAMAGE: a red vignette pulled in from the edges. Unmistakable, and it
    // does not wash out the canal you still have to fly.
    if (G.hitFlash > 0.001) {
      ctx.globalCompositeOperation = "source-over";
      var vg = ctx.createRadialGradient(cx, cy, Math.min(W, H) * 0.18, cx, cy, Math.max(W, H) * 0.72);
      // strong enough to be unmissable, light enough to still fly through
      vg.addColorStop(0, "rgba(255,40,90,0)");
      vg.addColorStop(0.5, "rgba(255,40,90," + (G.hitFlash * 0.12).toFixed(3) + ")");
      vg.addColorStop(1, "rgba(255,16,64," + (G.hitFlash * 0.62).toFixed(3) + ")");
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = "lighter";
      G.hitFlash *= reduceMotion ? 0.7 : 0.945;   // hold long enough to be read
    }
    // SCRAPE: a thin amber rim. Costs nothing, so it must not look like damage.
    if (G.scrapeFlash > 0.001) {
      ctx.strokeStyle = "rgba(255,209,102," + (G.scrapeFlash * 0.5).toFixed(3) + ")";
      ctx.lineWidth = 8;
      ctx.strokeRect(4, 4, W - 8, H - 8);
      G.scrapeFlash *= reduceMotion ? 0.6 : 0.86;
    }

    if (shakeX || shakeY) ctx.translate(-shakeX, -shakeY);
    ctx.globalCompositeOperation = "source-over";
  }

  function quad(x0, x1, y0, y1, z, col, a) {
    var p1 = px(x0, y0, z), p2 = px(x1, y0, z), p3 = px(x1, y1, z), p4 = px(x0, y1, z);
    if (!p1 || !p2 || !p3 || !p4) return;
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.lineTo(p3.x, p3.y); ctx.lineTo(p4.x, p4.y); ctx.closePath();
    ctx.fillStyle = "rgba(" + col + "," + (a * 0.26).toFixed(3) + ")";
    ctx.fill();
    ctx.strokeStyle = "rgba(" + col + "," + (a * 0.95).toFixed(3) + ")";
    ctx.lineWidth = 1.6;
    ctx.stroke();
    // a couple of hatch lines so a slab does not read as empty space
    var n = 4;
    ctx.strokeStyle = "rgba(" + col + "," + (a * 0.38).toFixed(3) + ")";
    ctx.lineWidth = 0.9;
    for (var k = 1; k < n; k++) {
      var t = k / n;
      var ha = px(x0 + (x1 - x0) * t, y0, z), hb = px(x0 + (x1 - x0) * t, y1, z);
      if (ha && hb) { ctx.beginPath(); ctx.moveTo(ha.x, ha.y); ctx.lineTo(hb.x, hb.y); ctx.stroke(); }
      var va = px(x0, y0 + (y1 - y0) * t, z), vb = px(x1, y0 + (y1 - y0) * t, z);
      if (va && vb) { ctx.beginPath(); ctx.moveTo(va.x, va.y); ctx.lineTo(vb.x, vb.y); ctx.stroke(); }
    }
  }

  /* A hazard is drawn as the cross-section MINUS its opening, in up to four
   * slabs. Drawing the hole instead of the wall is the mistake that makes these
   * unreadable — the eye needs the solid to know where it cannot go. */
  function gapOutline(x0, x1, y0, y1, z, col, a) {
    var p1 = px(x0, y0, z), p2 = px(x1, y0, z), p3 = px(x1, y1, z), p4 = px(x0, y1, z);
    if (!p1 || !p2 || !p3 || !p4) return;
    glowLine([p1, p2, p3, p4, p1], col, a, 9, 2.2);
  }

  function drawBar(b, a) {
    var col = b.hit ? "120,130,160" : HOT;
    var z = b.z;
    // will we fit through it as we are flying right now?
    var clear = b.hit ? true : through(b, G.x, G.y, HIT_R);
    var gcol = b.hit ? "120,130,160" : (clear ? LIME : HOT);
    var ga = a * (clear ? 0.85 : 0.95);
    if (b.pillar) {
      quad(b.gapA[1], b.gapB[0], b.y0, b.y1, z, col, a);      // the pillar itself
      quad(-HALF, HALF, TOP, b.y0, z, col, a * 0.8);
      quad(-HALF, HALF, b.y1, FLOOR, z, col, a * 0.8);
      gapOutline(b.gapA[0], b.gapA[1], b.y0, b.y1, z, gcol, ga);
      gapOutline(b.gapB[0], b.gapB[1], b.y0, b.y1, z, gcol, ga);
      return;
    }
    if (b.x0 > -HALF) quad(-HALF, b.x0, TOP, FLOOR, z, col, a);
    if (b.x1 < HALF) quad(b.x1, HALF, TOP, FLOOR, z, col, a);
    if (b.y0 > TOP) quad(Math.max(-HALF, b.x0), Math.min(HALF, b.x1), TOP, b.y0, z, col, a);
    if (b.y1 < FLOOR) quad(Math.max(-HALF, b.x0), Math.min(HALF, b.x1), b.y1, FLOOR, z, col, a);
    gapOutline(b.x0, b.x1, b.y0, b.y1, z, gcol, ga);
  }

  function drawThroat(now) {
    var z = RUN_LEN, dz = z - G.z;
    if (dz < -20) return;
    /* ⚠ This used fade(), which is keyed to the draw distance — and the final
     * stretch is exactly that long, so the core sat at alpha 0 for the first
     * three seconds of the lock phase: invisible, while the HUD told you to aim
     * at it. The goal gets its own curve and a floor. */
    var a = Math.max(0.42, Math.min(1, 1 - Math.max(0, dz) / (FINAL + 160)));
    var rings = 5;
    for (var k = 0; k < rings; k++) {
      var rz = z + k * 22;
      var rad = 5.6 - k * 0.55;
      var pts = [];
      for (var t = 0; t <= 24; t++) {
        var ang = t / 24 * TAU;
        var p = px(Math.cos(ang) * rad, Math.sin(ang) * rad + MIDY, rz);
        if (p) pts.push(p);
      }
      var pulse = reduceMotion ? 1 : 0.7 + 0.3 * Math.sin(now * 0.005 - k * 0.6);
      glowLine(pts, G.fired ? LIME : GOLD, a * pulse * (1 - k * 0.14), 12, 2.4);
    }

    // brackets, so the core reads as THE target and not as more scenery
    var c = px(0, MIDY, z);
    if (c && !G.fired) {
      var br = Math.max(14, 7 * FOCAL / Math.max(30, dz + CAM_BACK));
      var bl = br * 0.36;
      ctx.strokeStyle = "rgba(" + GOLD + "," + (a * 0.85).toFixed(3) + ")";
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      for (var sx3 = -1; sx3 <= 1; sx3 += 2) {
        for (var sy3 = -1; sy3 <= 1; sy3 += 2) {
          ctx.moveTo(c.x + sx3 * br, c.y + sy3 * br);
          ctx.lineTo(c.x + sx3 * br, c.y + sy3 * (br - bl));
          ctx.moveTo(c.x + sx3 * br, c.y + sy3 * br);
          ctx.lineTo(c.x + sx3 * (br - bl), c.y + sy3 * br);
        }
      }
      ctx.stroke();
    }
  }

  /* Everything between the blast front and you is inside the fireball, so it
   * blazes gold; everything beyond it is still cold canal. Watching that line
   * travel up the walls is what sells the size of it. */
  function boomTint(zr) {
    if (G.phase !== "boom") return null;
    if (zr > G.shockZ + 40) return null;                 // not reached yet
    var d = Math.abs(zr - G.shockZ);
    // how far this slice has been blown open since the front went through it
    var tear = Math.min(2.2, Math.max(0, (G.shockZ - zr)) / 260);
    if (d < 70) return { col: "255,255,255", a: 1, tear: tear };
    return { col: GOLD, a: Math.max(0.2, 1 - (G.shockZ - zr) / 1100), tear: tear };
  }

  function drawBoom(now) {
    var i;
    // the throat tearing itself open, rings on rings
    for (i = 0; i < 6; i++) {
      var age = G.boomT - i * 0.11;
      if (age < 0) continue;
      var rad = 4 + age * 34;
      var al = Math.max(0, 1 - age / 1.5);
      if (al <= 0) continue;
      var pts = [];
      for (var t = 0; t <= 26; t++) {
        var ang = t / 26 * TAU;
        var q = px(Math.cos(ang) * rad, MIDY + Math.sin(ang) * rad, RUN_LEN + i * 18);
        if (q) pts.push(q);
      }
      glowLine(pts, i % 2 ? "255,255,255" : GOLD, al * 0.9, 16, 3);
    }

    // the blast front: the canal cross-section, overscaled and blazing
    if (G.shockZ > CAM.z + 4) {
      var g = 1 + Math.max(0, (RUN_LEN - G.shockZ)) / 700;
      var f1 = px(-HALF * g, TOP * g + MIDY * (1 - g), G.shockZ);
      var f2 = px(HALF * g, TOP * g + MIDY * (1 - g), G.shockZ);
      var f3 = px(HALF * g, FLOOR * g + MIDY * (1 - g), G.shockZ);
      var f4 = px(-HALF * g, FLOOR * g + MIDY * (1 - g), G.shockZ);
      if (f1 && f2 && f3 && f4) {
        ctx.beginPath();
        ctx.moveTo(f1.x, f1.y); ctx.lineTo(f2.x, f2.y); ctx.lineTo(f3.x, f3.y); ctx.lineTo(f4.x, f4.y); ctx.closePath();
        ctx.fillStyle = "rgba(255,226,150,0.3)";
        ctx.fill();
        glowLine([f1, f2, f3, f4, f1], "255,255,255", 1, 26, 5);
      }
    }

    // debris blown up the canal past the cockpit
    for (i = 0; i < G.debris.length; i++) {
      var d = G.debris[i];
      var q1 = px(d.x, d.y, d.z);
      var q2 = px(d.x - d.vx * 0.03, d.y - d.vy * 0.03, d.z - d.vz * 0.03);
      if (!q1 || !q2) continue;
      glowLine([q2, q1], i % 3 ? GOLD : "255,255,255", Math.min(1, d.life) * 0.85, 7, 2);
    }

    // the fireball filling the far end
    var far = px(0, MIDY, Math.max(G.shockZ, G.z + 30));
    if (far) {
      var rr = Math.min(Math.max(W, H) * 1.4, 120 + G.boomT * 900);
      var rg = ctx.createRadialGradient(far.x, far.y, 0, far.x, far.y, rr);
      var core = Math.max(0, 1 - G.boomT / 2.4);
      rg.addColorStop(0, "rgba(255,255,255," + (core * 0.75).toFixed(3) + ")");
      rg.addColorStop(0.25, "rgba(255,214,102," + (core * 0.34).toFixed(3) + ")");
      rg.addColorStop(1, "rgba(255,120,40,0)");
      ctx.fillStyle = rg;
      ctx.beginPath(); ctx.arc(far.x, far.y, rr, 0, TAU); ctx.fill();
    }

    // and the wash as the front goes over you
    if (G.whiteout > 0.001) {
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "rgba(255,252,240," + Math.min(1, G.whiteout).toFixed(3) + ")";
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = "lighter";
      G.whiteout *= reduceMotion ? 0.8 : 0.93;
    }
  }

  function drawShip() {
    var sp = px(G.x, G.y, G.z);
    if (!sp) return;
    var sx = sp.x, sy = sp.y;
    var sc = SCALE * 0.42;
    if (G.inv > 0 && !reduceMotion && Math.floor(G.inv * 14) % 2 === 0) return;   // blink while safe
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(G.roll * 0.55);
    var body = [[0, -1.35], [0.95, 0.72], [0, 0.3], [-0.95, 0.72]];
    ctx.beginPath();
    ctx.moveTo(body[0][0] * sc, body[0][1] * sc);
    for (var i = 1; i < body.length; i++) ctx.lineTo(body[i][0] * sc, body[i][1] * sc);
    ctx.closePath();
    ctx.strokeStyle = "rgba(255,255,255,0.22)"; ctx.lineWidth = 7; ctx.stroke();
    ctx.strokeStyle = "rgba(230,250,255,0.98)"; ctx.lineWidth = 1.8; ctx.stroke();
    // thrust, longer under boost
    var flame = (G.boosting && !G.over ? 1.9 : 1) * (0.7 + Math.random() * 0.4);
    ctx.beginPath();
    ctx.moveTo(-0.34 * sc, 0.5 * sc); ctx.lineTo(0, (0.62 + flame * 0.7) * sc); ctx.lineTo(0.34 * sc, 0.5 * sc);
    ctx.strokeStyle = "rgba(" + (G.over ? HOT : CYAN) + ",0.9)";
    ctx.lineWidth = 2; ctx.stroke();
    ctx.restore();
  }

  /* The crosshair is the cursor of this game, so it is drawn out in the canal
   * at the depth it actually aims at, not flat on the glass. */
  function drawReticle() {
    var az = G.z + AIM_DEPTH;
    var p = px(G.ax, G.ay, az);
    if (!p) return;
    var r = Math.max(15, Math.min(W, H) * 0.045);
    // is a live gun under the crosshair right now?
    var hot = false;
    for (var ti = 0; ti < G.turrets.length; ti++) {
      var tq = G.turrets[ti];
      if (tq.dead || tq.z < G.z || tq.z - G.z > FAR) continue;
      var run2 = tq.z - G.z;
      var lx = G.x + (G.ax - G.x) / AIM_DEPTH * run2, ly = G.y + (G.ay - G.y) / AIM_DEPTH * run2;
      if (Math.hypot(lx - tq.x, ly - tq.y) < 2.1) { hot = true; break; }
    }
    var rc = hot ? GOLD : LIME;
    if (hot) { r *= 1.18; }
    ctx.strokeStyle = "rgba(" + rc + ",0.98)";
    ctx.lineWidth = hot ? 2.6 : 2;
    ctx.beginPath();
    ctx.moveTo(p.x - r, p.y); ctx.lineTo(p.x - r * 0.35, p.y);
    ctx.moveTo(p.x + r * 0.35, p.y); ctx.lineTo(p.x + r, p.y);
    ctx.moveTo(p.x, p.y - r); ctx.lineTo(p.x, p.y - r * 0.35);
    ctx.moveTo(p.x, p.y + r * 0.35); ctx.lineTo(p.x, p.y + r);
    ctx.stroke();
    ctx.strokeStyle = "rgba(" + rc + "," + (hot ? 0.75 : 0.28) + ")";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(p.x, p.y, r * 0.72, 0, TAU); ctx.stroke();
    // HIT MARKER: the shot landed. Without it a miss and a hit look identical,
    // and a red screen a moment later gets blamed on the shot.
    if (G.hitMark > 0.001) {
      var hm = r * (1.5 - G.hitMark * 0.5);
      ctx.strokeStyle = "rgba(255,255,255," + Math.min(1, G.hitMark * 1.2).toFixed(3) + ")";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(p.x - hm, p.y - hm); ctx.lineTo(p.x - hm * 0.45, p.y - hm * 0.45);
      ctx.moveTo(p.x + hm, p.y - hm); ctx.lineTo(p.x + hm * 0.45, p.y - hm * 0.45);
      ctx.moveTo(p.x - hm, p.y + hm); ctx.lineTo(p.x - hm * 0.45, p.y + hm * 0.45);
      ctx.moveTo(p.x + hm, p.y + hm); ctx.lineTo(p.x + hm * 0.45, p.y + hm * 0.45);
      ctx.stroke();
      G.hitMark *= reduceMotion ? 0.7 : 0.88;
    }

    // a thin tether from the nose, so the aim never reads as detached
    var sp = px(G.x, G.y, G.z);
    if (sp) {
      ctx.strokeStyle = "rgba(" + rc + ",0.1)";
      ctx.beginPath(); ctx.moveTo(sp.x, sp.y); ctx.lineTo(p.x, p.y); ctx.stroke();
    }
  }

  function spark(n, col, spread) {
    var sp = px(G.x, G.y, G.z);
    var sx = sp ? sp.x : cx, sy = sp ? sp.y : cy;
    for (var i = 0; i < n && G.sparks.length < 90; i++) {
      var a = Math.random() * TAU;
      G.sparks.push({
        sx: sx, sy: sy, col: col, life: 1,
        vx: Math.cos(a) * spread * (0.4 + Math.random()),
        vy: Math.sin(a) * spread * (0.4 + Math.random()) - 1.4
      });
    }
  }

  /* ---------------------------------------------------------------- layout */

  function layout() {
    DPR = Math.min(2, window.devicePixelRatio || 1);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    cx = W / 2;
    /* On a portrait phone the canal is width-bound, so it lands as a thin band
     * with dead black above and below. Dropping the horizon pushes that band up
     * and lets the near floor run off the bottom of the screen, which fills the
     * lower half with something moving instead of nothing. */
    var portrait = H > W;
    cy = H * (portrait ? 0.42 : 0.46);

    /* Key the lens to the SHORT edge so the canal fills the screen the same way
     * in portrait and landscape — keying it to the long edge would make a phone
     * held upright a far harder game than the same phone turned sideways. */
    /* A longer lens on a phone: it is the only screen with height to spare, so
     * spend it making the guns and the crosshair bigger rather than on sky. */
    var FILL_Z = portrait ? 30 : 24;
    var sw = (W * 1.05) / (HALF * 2);
    var sh = H / (FLOOR - TOP);
    FOCAL = Math.min(sw, sh) * FILL_Z;
    SCALE = FOCAL / CAM_BACK;              // px per world unit at the ship
    CTRL = SCALE * (1 - CAM_F);            // px per world unit the ship slides on screen

    G.stars = [];
    var n = Math.round(W * H / 14000);
    for (var i = 0; i < n; i++) {
      G.stars.push({
        x: Math.random() * W, y: Math.random() * H,
        r: Math.random() < 0.8 ? 1 : 1.8,
        a: Math.random() * 0.4 + 0.1, p: Math.random() * TAU
      });
    }
  }

  /* ----------------------------------------------------------------- audio */

  var audio = (function () {
    var A = null, mix = null, master = null, revIn = null, on = true, ready = false;
    var eng = null;                       // the engine bed, running for the whole flight

    function ir(sec, decay) {
      var rate = A.sampleRate, len = Math.floor(rate * sec), buf = A.createBuffer(2, len, rate);
      for (var ch = 0; ch < 2; ch++) {
        var d = buf.getChannelData(ch), lp = 0;
        for (var i = 0; i < len; i++) {
          lp += ((Math.random() * 2 - 1) - lp) * 0.36;
          d[i] = lp * Math.pow(1 - i / len, decay);
        }
      }
      return buf;
    }

    function noiseBuf(sec, brown) {
      var len = Math.max(1, Math.ceil(A.sampleRate * sec));
      var buf = A.createBuffer(1, len, A.sampleRate), d = buf.getChannelData(0), last = 0;
      for (var i = 0; i < len; i++) {
        var w = Math.random() * 2 - 1;
        if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.2; }
        else d[i] = w;
      }
      return buf;
    }

    function build() {
      if (ready) return;
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      A = new AC();
      mix = A.createGain();
      master = A.createGain(); master.gain.value = on ? 1 : 0;

      var comp = A.createDynamicsCompressor();
      comp.threshold.value = -6; comp.ratio.value = 3; comp.knee.value = 6;
      comp.attack.value = 0.004; comp.release.value = 0.18;
      var limit = A.createDynamicsCompressor();
      limit.threshold.value = -1.5; limit.ratio.value = 20; limit.knee.value = 0;
      limit.attack.value = 0.002; limit.release.value = 0.09;

      var rev = A.createConvolver(); rev.buffer = ir(2.2, 2.8);
      var revG = A.createGain(); revG.gain.value = 0.8;
      var revHP = A.createBiquadFilter(); revHP.type = "highpass"; revHP.frequency.value = 300;
      revIn = A.createGain();
      revIn.connect(revHP); revHP.connect(rev); rev.connect(revG); revG.connect(mix);

      mix.connect(master); master.connect(comp); comp.connect(limit); limit.connect(A.destination);

      var s0 = A.createBufferSource();      // iOS unlock
      s0.buffer = A.createBuffer(1, 1, A.sampleRate);
      s0.connect(A.destination); s0.start(0);
      ready = true;
    }

    function chain(pan, send) {
      var g = A.createGain();
      if (A.createStereoPanner) {
        var pn = A.createStereoPanner();
        pn.pan.value = Math.max(-1, Math.min(1, pan));
        g.connect(pn); pn.connect(mix);
      } else g.connect(mix);
      if (send) { var sg = A.createGain(); sg.gain.value = send; g.connect(sg); sg.connect(revIn); }
      return g;
    }

    /* The engine is AIR and HULL, not an oscillator patch: brown noise through a
     * lowpass that opens with speed, plus a low rumble that wanders. A sawtooth
     * through a filter would read as a synth, which is the house's standing
     * complaint about machine sounds. */
    function startEngine() {
      if (!ready || eng) return;
      var src = A.createBufferSource();
      src.buffer = noiseBuf(3, true); src.loop = true;
      var lp = A.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 420; lp.Q.value = 0.8;
      var peak = A.createBiquadFilter(); peak.type = "peaking"; peak.frequency.value = 160; peak.Q.value = 1.2; peak.gain.value = 5;
      var g = A.createGain(); g.gain.value = 0.0;
      src.connect(lp); lp.connect(peak); peak.connect(g); g.connect(mix);

      var rum = A.createOscillator(); rum.type = "triangle"; rum.frequency.value = 47;
      var rg = A.createGain(); rg.gain.value = 0.0;
      var wob = A.createOscillator(); wob.type = "sine"; wob.frequency.value = 0.27;
      var wobG = A.createGain(); wobG.gain.value = 3.4;
      wob.connect(wobG); wobG.connect(rum.frequency);
      rum.connect(rg); rg.connect(mix);

      src.start(); rum.start(); wob.start();
      eng = { src: src, lp: lp, g: g, rum: rum, rg: rg, wob: wob };
    }

    function stopEngine() {
      if (!eng) return;
      var t = A.currentTime;
      eng.g.gain.setTargetAtTime(0, t, 0.08);
      eng.rg.gain.setTargetAtTime(0, t, 0.08);
      var e = eng; eng = null;
      setTimeout(function () {
        try { e.src.stop(); e.rum.stop(); e.wob.stop(); } catch (err) {}
      }, 500);
    }

    function modal(freqs, amp, pan, decay) {
      if (!ready) return;
      var t = A.currentTime, out = chain(pan, 0.3);
      out.gain.value = amp;
      var burst = A.createBufferSource(); burst.buffer = noiseBuf(0.014, false);
      freqs.forEach(function (f, k) {
        var Q = 10 + k * 5;
        var bp = A.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = f; bp.Q.value = Q;
        var g = A.createGain();
        g.gain.setValueAtTime(Math.sqrt(Q) * (k ? 0.45 / k : 1), t);
        g.gain.exponentialRampToValueAtTime(1e-4, t + decay / (1 + k * 0.7));
        burst.connect(bp); bp.connect(g); g.connect(out);
      });
      var tack = A.createBufferSource(); tack.buffer = noiseBuf(0.012, false);
      var lp = A.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 5000; lp.Q.value = 0.6;
      var tg = A.createGain();
      tg.gain.setValueAtTime(0.5, t); tg.gain.exponentialRampToValueAtTime(1e-4, t + 0.05);
      tack.connect(lp); lp.connect(tg); tg.connect(out);
      burst.start(t); tack.start(t);
      setTimeout(function () { try { out.disconnect(); } catch (e) {} }, (decay + 0.4) * 1000);
    }

    var PARTIAL = [1, 2, 3.01, 4.17, 5.43];
    var PGAIN = [0.49, 0.22, 0.15, 0.09, 0.05];        // normalised: amp means the peak
    function bell(freq, amp, pan, dur) {
      if (!ready) return;
      var t = A.currentTime, out = chain(pan, 0.8);
      out.gain.value = amp;
      PARTIAL.forEach(function (rr, k) {
        var o = A.createOscillator(); o.type = "sine";
        o.frequency.value = freq * rr;
        var g = A.createGain();
        var d = dur / (1 + k * 0.55);
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(PGAIN[k], t + 0.004);
        g.gain.exponentialRampToValueAtTime(1e-4, t + d);
        o.connect(g); g.connect(out); o.start(t); o.stop(t + d + 0.05);
      });
      setTimeout(function () { try { out.disconnect(); } catch (e) {} }, (dur + 0.6) * 1000);
    }

    var lastGraze = 0;
    return {
      unlock: function () { build(); if (A && A.state === "suspended") A.resume(); },
      startEngine: startEngine,
      stopEngine: stopEngine,
      toggle: function () {
        on = !on;
        if (master) master.gain.setTargetAtTime(on ? 1 : 0, A.currentTime, 0.02);
        try { localStorage.setItem(KEY_SOUND, on ? "1" : "0"); } catch (e) {}
        return on;
      },
      init: function (v) { on = v; },
      // speed 0..1, heat 0..1
      engine: function (spd, over) {
        if (!eng) return;
        var t = A.currentTime;
        eng.lp.frequency.setTargetAtTime(380 + spd * 1500, t, 0.09);
        eng.g.gain.setTargetAtTime(0.1 + spd * 0.12, t, 0.09);
        eng.rg.gain.setTargetAtTime(0.05 + spd * 0.06, t, 0.12);
        eng.rum.frequency.setTargetAtTime(44 + spd * 16 + (over ? 8 : 0), t, 0.2);
      },
      /* A near miss is AIR, panned to the side you shaved — that is the only
       * cue telling you which way you nearly died. */
      graze: function (side, tight) {
        if (!ready || !on) return;
        var now = performance.now();
        if (now - lastGraze < 70) return;
        lastGraze = now;
        var t = A.currentTime, out = chain(side * 0.85, 0.25);
        out.gain.value = 0.15 + tight * 0.1;
        var src = A.createBufferSource(); src.buffer = noiseBuf(0.3, false);
        var bp = A.createBiquadFilter(); bp.type = "bandpass";
        bp.frequency.setValueAtTime(900, t);
        bp.frequency.exponentialRampToValueAtTime(320, t + 0.22);
        bp.Q.value = 1.1;
        var g = A.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(1, t + 0.05);
        g.gain.exponentialRampToValueAtTime(1e-4, t + 0.26);
        src.connect(bp); bp.connect(g); g.connect(out);
        src.start(t); src.stop(t + 0.32);
      },
      clip: function () { modal([190, 437, 812, 1290], 0.42, 0, 0.42); },
      scrape: function () {
        if (!ready || !on) return;
        var t = A.currentTime, out = chain(0, 0.15);
        out.gain.value = 0.11;
        var src = A.createBufferSource(); src.buffer = noiseBuf(0.2, false);
        var bp = A.createBiquadFilter(); bp.type = "bandpass";
        bp.frequency.value = 2600; bp.Q.value = 1.6;
        var g = A.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(1, t + 0.02);
        g.gain.exponentialRampToValueAtTime(1e-4, t + 0.18);
        src.connect(bp); bp.connect(g); g.connect(out);
        src.start(t); src.stop(t + 0.22);
      },
      // taking a hit: low, wrong, and nothing like your own gun
      damage: function () {
        if (!ready || !on) return;
        modal([96, 214, 402, 655], 0.34, 0, 0.55);
        var t = A.currentTime, out = chain(0, 0.4);
        out.gain.value = 0.2;
        var o = A.createOscillator(); o.type = "sine";
        o.frequency.setValueAtTime(150, t);
        o.frequency.exponentialRampToValueAtTime(42, t + 0.42);
        var g = A.createGain();
        g.gain.setValueAtTime(0.9, t);
        g.gain.exponentialRampToValueAtTime(1e-4, t + 0.5);
        o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.55);
      },
      /* Fires every 145ms for a whole minute, so it has to be SHORT and it must
       * not fatigue: a tiny filtered blip with a touch of pitch variance, well
       * under the turrets and the engine in the mix. */
      /* A BLASTER. The classic is a taut steel cable struck hard: waves travel
       * down it at different speeds, so the pitch DIVES, and the canyon it was
       * recorded in gives it a slapback. So: a hard transient, three detuned
       * partials diving together (dispersive, not one clean sweep — one sweep
       * is a synth, three is a cable), and a short feedback delay for the
       * space. Nothing here is a recording; the dive is a genre trope, and the
       * only protected thing is somebody's actual tape. */
      pew: function (pan) {
        if (!ready || !on) return;
        var t = A.currentTime;
        var out = chain(pan * 0.55, 0.2);
        out.gain.value = 0.15;

        var dl = A.createDelay(0.4); dl.delayTime.value = 0.068;
        var fb = A.createGain(); fb.gain.value = 0.3;
        var dw = A.createGain(); dw.gain.value = 0.42;
        var dlp = A.createBiquadFilter(); dlp.type = "lowpass"; dlp.frequency.value = 2400;
        dl.connect(fb); fb.connect(dl); dl.connect(dlp); dlp.connect(out);

        var det = 0.97 + Math.random() * 0.06;
        [[1, 1], [1.51, 0.5], [2.14, 0.26]].forEach(function (pr, k) {
          var o = A.createOscillator();
          o.type = k === 0 ? "sawtooth" : "triangle";
          o.frequency.setValueAtTime(2300 * pr[0] * det, t);
          o.frequency.exponentialRampToValueAtTime(140 * pr[0], t + 0.115 + k * 0.018);
          var g = A.createGain();
          g.gain.setValueAtTime(pr[1], t);
          g.gain.exponentialRampToValueAtTime(1e-4, t + 0.15 + k * 0.02);
          var lp = A.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 5200; lp.Q.value = 0.8;
          o.connect(lp); lp.connect(g); g.connect(out); g.connect(dw);
          o.start(t); o.stop(t + 0.2);
        });
        dw.connect(dl);

        var tick = A.createBufferSource(); tick.buffer = noiseBuf(0.006, true);
        var thp = A.createBiquadFilter(); thp.type = "highpass"; thp.frequency.value = 1800;
        var tg = A.createGain();
        tg.gain.setValueAtTime(0.7, t);
        tg.gain.exponentialRampToValueAtTime(1e-4, t + 0.02);
        tick.connect(thp); thp.connect(tg); tg.connect(out);
        tick.start(t); tick.stop(t + 0.01);

        setTimeout(function () {
          try { fb.disconnect(); dl.disconnect(); dw.disconnect(); dlp.disconnect(); out.disconnect(); } catch (e) {}
        }, 700);
      },
      // incoming fire: the same family, dirtier and an octave down, so you can
      // tell what is yours and what is coming at you without looking
      turret: function (pan) {
        if (!ready || !on) return;
        var t = A.currentTime, out = chain(pan * 0.9, 0.3);
        out.gain.value = 0.13;
        var dl = A.createDelay(0.4); dl.delayTime.value = 0.09;
        var fb = A.createGain(); fb.gain.value = 0.26;
        dl.connect(fb); fb.connect(dl); dl.connect(out);
        [[1, 1], [1.44, 0.5]].forEach(function (pr, k) {
          var o = A.createOscillator(); o.type = "sawtooth";
          o.frequency.setValueAtTime(900 * pr[0], t);
          o.frequency.exponentialRampToValueAtTime(70 * pr[0], t + 0.17);
          var g = A.createGain();
          g.gain.setValueAtTime(pr[1] * 0.85, t);
          g.gain.exponentialRampToValueAtTime(1e-4, t + 0.22);
          var lp = A.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 2000; lp.Q.value = 1.6;
          o.connect(lp); lp.connect(g); g.connect(out); g.connect(dl);
          o.start(t); o.stop(t + 0.26);
        });
        setTimeout(function () {
          try { fb.disconnect(); dl.disconnect(); out.disconnect(); } catch (e) {}
        }, 900);
      },

      /* ⚠ THE THING THAT MAKES AN EXPLOSION AN EXPLOSION IS THAT IT GETS
       * DARKER. The first version swept its lowpass UPWARD (260 -> 3200), which
       * is the shape of a whoosh or a build, not a blast — owner: "the
       * explosions don't sound like explosions". Every blast here now opens
       * bright and closes dark, over: a shock transient, a low body, a sub, and
       * a crackling tail of falling debris. `size` scales all four. */
      blast: function (size, amp, pan) {
        if (!ready || !on) return;
        var t = A.currentTime;
        var out = chain(pan, 0.55);
        out.gain.value = amp;
        var dur = 0.45 + size * 2.6;

        var shock = A.createBufferSource(); shock.buffer = noiseBuf(0.05, false);
        var sg = A.createGain();
        sg.gain.setValueAtTime(1, t);
        sg.gain.exponentialRampToValueAtTime(1e-4, t + 0.05);
        shock.connect(sg); sg.connect(out);
        shock.start(t); shock.stop(t + 0.06);

        var body = A.createBufferSource(); body.buffer = noiseBuf(dur + 0.2, true);
        var lp = A.createBiquadFilter(); lp.type = "lowpass"; lp.Q.value = 0.7;
        lp.frequency.setValueAtTime(5200 + size * 2000, t);          // bright...
        lp.frequency.exponentialRampToValueAtTime(140, t + dur);      // ...to dark
        var bg = A.createGain();
        bg.gain.setValueAtTime(0.0001, t);
        bg.gain.exponentialRampToValueAtTime(1.1, t + 0.012);
        bg.gain.exponentialRampToValueAtTime(1e-4, t + dur);
        body.connect(lp); lp.connect(bg); bg.connect(out);
        body.start(t); body.stop(t + dur + 0.1);

        var sub = A.createOscillator(); sub.type = "sine";
        sub.frequency.setValueAtTime(110 - size * 30, t);
        sub.frequency.exponentialRampToValueAtTime(26 - size * 5, t + dur * 0.8);
        var ug = A.createGain();
        ug.gain.setValueAtTime(0.0001, t);
        ug.gain.exponentialRampToValueAtTime(0.85 + size * 0.5, t + 0.02);
        ug.gain.exponentialRampToValueAtTime(1e-4, t + dur * 0.9);
        sub.connect(ug); ug.connect(out);
        sub.start(t); sub.stop(t + dur);

        // rubble: the tail has to be lumpy or it is just noise fading out
        var n = Math.round(6 + size * 26);
        for (var k = 0; k < n; k++) {
          var at = t + 0.09 + Math.random() * dur * 0.75;
          var ck = A.createBufferSource(); ck.buffer = noiseBuf(0.04, false);
          var cb = A.createBiquadFilter(); cb.type = "bandpass";
          cb.frequency.value = 180 + Math.random() * 1400; cb.Q.value = 1.4;
          var cg = A.createGain();
          cg.gain.setValueAtTime(0.22 * (1 - (at - t) / dur), at);
          cg.gain.exponentialRampToValueAtTime(1e-4, at + 0.09);
          ck.connect(cb); cb.connect(cg); cg.connect(out);
          ck.start(at); ck.stop(at + 0.05);
        }
        setTimeout(function () { try { out.disconnect(); } catch (e) {} }, (dur + 0.8) * 1000);
      },

      kill: function (pan) { this.blast(0.12, 0.24, pan); },

      // the targeting computer climbing as the lock fills
      lockTick: function (n) {
        if (!ready || !on) return;
        bell(523.25 * Math.pow(2, n / 12), 0.12, 0, 0.5);
      },

      /* The core going up. One blast is a bang; a detonation is blasts ON
       * blasts — an initial crack, then bigger, slower ones rolling out behind
       * it as the structure tears itself apart, each darker than the last. */
      detonate: function () {
        if (!ready || !on) return;
        var self = this;
        this.blast(1, 0.3, 0);
        [[180, 0.75, 0.2, -0.5], [420, 0.9, 0.22, 0.55], [820, 0.6, 0.16, -0.3],
         [1350, 0.85, 0.15, 0.35], [2000, 0.5, 0.11, 0]].forEach(function (b2) {
          setTimeout(function () { self.blast(b2[1], b2[2], b2[3]); }, b2[0]);
        });
        // and the long structural groan underneath the whole thing
        var t = A.currentTime, out = chain(0, 0.6);
        out.gain.value = 0.13;
        var o = A.createOscillator(); o.type = "sawtooth";
        o.frequency.setValueAtTime(58, t);
        o.frequency.exponentialRampToValueAtTime(19, t + 3.2);
        var lp = A.createBiquadFilter(); lp.type = "lowpass";
        lp.frequency.setValueAtTime(900, t);
        lp.frequency.exponentialRampToValueAtTime(90, t + 3.2);
        var g = A.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(1, t + 0.25);
        g.gain.exponentialRampToValueAtTime(1e-4, t + 3.3);
        o.connect(lp); lp.connect(g); g.connect(out);
        o.start(t); o.stop(t + 3.4);
      },

      win: function () {
        if (!ready || !on) return;
        [0, 7, 12, 16, 19].forEach(function (n, k) {
          setTimeout(function () { bell(261.63 * Math.pow(2, n / 12), 0.17, (k - 2) * 0.3, 2.4); }, k * 90);
        });
      },
      fail: function () {
        if (!ready || !on) return;
        var t = A.currentTime, out = chain(0, 0.3);
        out.gain.value = 0.24;
        var o = A.createOscillator(); o.type = "triangle";
        o.frequency.setValueAtTime(196, t);
        o.frequency.exponentialRampToValueAtTime(58, t + 0.7);
        var g = A.createGain();
        g.gain.setValueAtTime(0.9, t);
        g.gain.exponentialRampToValueAtTime(1e-4, t + 0.85);
        o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.9);
      }
    };
  })();

  /* ---------------------------------------------------------------- input */

  var input = { tx: 0, ty: 0, have: false, steerId: null, boostId: null, keys: {} };

  /* Invert the projection at the ship's depth: given a point on screen, where
   * does the ship have to be for it to land there? The camera follows sideways
   * by CAM_F, so the ship's own travel is only (1 - CAM_F) of the total, which
   * is what CTRL folds in. ⚠ The first version used an arbitrary "reach" that
   * had nothing to do with the lens, so the canal you SAW and the canal you
   * could STEER to were different sizes — the single worst bug in this build.
   * On a touch screen the target is lifted clear of the finger, or your own
   * thumb covers the ship you are aiming. */
  function pointerToLocal(clientX, clientY, touch) {
    var lift = touch ? TOUCH_LIFT : 0;
    var az = G.z + AIM_DEPTH;
    var sc = FOCAL / (AIM_DEPTH + CAM_BACK);
    input.tx = (clientX - cx) / sc + CAM.x - canalX(az);
    input.ty = (clientY - lift - cy) / sc + CAM.y - canalY(az);
    input.have = true;
  }

  function onPointerDown(ev) {
    audio.unlock();
    if (G.phase === "idle") return;
    var touch = ev.pointerType !== "mouse";
    if (input.steerId === null) {
      input.steerId = ev.pointerId;
      // Aim at the tap, then shoot it. On a phone "tap the gun to kill it" is
      // the whole control scheme, and it survives a thumb that keeps sliding.
      pointerToLocal(ev.clientX, ev.clientY, touch);
      fireShot();
    } else if (input.boostId === null) {
      // ANY second finger boosts, anywhere on the glass. Making the player find
      // a pad while threading a gap is the opposite of fun on a phone.
      input.boostId = ev.pointerId;
      el.boost.classList.add("is-on");
    }
    ev.preventDefault();
  }

  function onPointerMove(ev) {
    if (ev.pointerId === input.boostId) return;
    var touch = ev.pointerType !== "mouse";
    if (touch) {
      if (ev.pointerId !== input.steerId) return;       // touch steers only while held
    }
    pointerToLocal(ev.clientX, ev.clientY, touch);
  }

  function onPointerUp(ev) {
    if (ev.pointerId === input.boostId) {
      input.boostId = null;
      el.boost.classList.remove("is-on");
    }
    if (ev.pointerId === input.steerId) input.steerId = null;
  }

  canvas.addEventListener("pointerdown", onPointerDown, { passive: false });
  window.addEventListener("pointermove", onPointerMove, { passive: false });
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerUp);
  if (el.boost) {
    el.boost.addEventListener("pointerdown", function (ev) {
      audio.unlock();
      if (input.boostId === null) { input.boostId = ev.pointerId; el.boost.classList.add("is-on"); }
      ev.preventDefault();
      ev.stopPropagation();
    }, { passive: false });
  }

  window.addEventListener("keydown", function (ev) {
    var k = ev.key.toLowerCase();
    if (k === " " || k === "enter") {
      ev.preventDefault();
      audio.unlock();
      if (G.phase === "idle" || G.phase === "dead" || G.phase === "won") { el.ovBtn.click(); return; }
      if (ev.repeat) return;              // one shot per press, not a held stream
      fireShot();
      return;
    }
    if (k === "shift") input.keys.boost = true;
    if (["arrowleft", "a", "arrowright", "d", "arrowup", "w", "arrowdown", "s"].indexOf(k) >= 0) {
      ev.preventDefault();
      input.keys[k] = true;
      input.have = true;
    }
  });
  window.addEventListener("keyup", function (ev) {
    var k = ev.key.toLowerCase();
    if (k === "shift") input.keys.boost = false;
    input.keys[k] = false;
  });

  /* ---------------------------------------------------------------- update */

  function keyAxis(neg, neg2, pos, pos2) {
    return (input.keys[neg] || input.keys[neg2] ? -1 : 0) + (input.keys[pos] || input.keys[pos2] ? 1 : 0);
  }

  function update(dt) {
    if (G.phase === "idle") {
      /* Alive, but calm: a slow drift straight down the middle. The earlier
       * version added its own sway on top of the canal's curve, which read as
       * the whole scene weaving about behind a panel you are trying to read. */
      G.z += 15 * dt;
      G.x = 0; G.y = MIDY;
      G.vx = 0; G.vy = 0;
      G.roll = 0;
      return;
    }
    if (G.phase === "boom") {
      G.boomT += dt;
      G.z += G.speed * dt * 0.35;            // coasting out, not driving on
      CAM_BACK = 20 + Math.min(46, G.boomT * 17);   // draw back for the wide shot
      G.shockZ -= SHOCK_SPD * dt;
      if (!G.washed && G.shockZ <= G.z) {                  // the front reaches you, ONCE
        G.washed = true;
        G.whiteout = 1;
      }
      G.shake = Math.max(G.shake, Math.max(0, 1 - G.boomT / 1.6) * 0.9);
      for (var di = G.debris.length - 1; di >= 0; di--) {
        var d2 = G.debris[di];
        d2.x += d2.vx * dt; d2.y += d2.vy * dt; d2.z += d2.vz * dt;
        d2.life -= dt * 0.26;
        if (d2.life <= 0 || d2.z < CAM.z - 30) G.debris.splice(di, 1);
      }
      audio.engine(0.2, false);
      updateHud();
      return;
    }
    if (G.phase !== "fly" && G.phase !== "lock") return;

    // steering: pointer sets a target, keys nudge it
    var kx = keyAxis("arrowleft", "a", "arrowright", "d");
    var ky = keyAxis("arrowup", "w", "arrowdown", "s");
    if (kx || ky) {
      input.tx += kx * 26 * dt;
      input.ty += ky * 20 * dt;
      input.have = true;
    }
    input.tx = Math.max(-HALF - 2, Math.min(HALF + 2, input.tx));
    input.ty = Math.max(TOP - 2, Math.min(FLOOR + 2, input.ty));

    // the reticle answers instantly — it is the thing under your thumb
    var aimLim = HALF * 1.25;
    input.tx = Math.max(-aimLim, Math.min(aimLim, input.tx));
    input.ty = Math.max(TOP - 3, Math.min(FLOOR + 3, input.ty));
    G.ax += (input.tx - G.ax) * Math.min(1, dt * 26);
    G.ay += (input.ty - G.ay) * Math.min(1, dt * 26);

    /* The ship leans after the reticle and settles back toward the middle. You
     * are not flying it, you are nudging it.
     *
     * ⚠ This was a SPRING, which overshoots: a fast sweep of the crosshair
     * threw the ship past where you pointed and it wobbled back. Flying has to
     * be predictable while your attention is on the crosshair, so it is now an
     * exponential approach — never overshoots — with a hard cap on sideways
     * speed so a big swing and a small one feel like the same aircraft. */
    var wantX = G.ax * SHIP_FOLLOW, wantY = MIDY + (G.ay - MIDY) * SHIP_FOLLOW;
    var keepX = HALF - SHIP_R - 0.6, keepYlo = TOP + SHIP_R + 0.4, keepYhi = FLOOR - SHIP_R - 0.4;
    wantX = Math.max(-keepX, Math.min(keepX, wantX));
    wantY = Math.max(keepYlo, Math.min(keepYhi, wantY));
    var follow = 1 - Math.pow(0.0022, dt);
    var nx = G.x + (wantX - G.x) * follow;
    var ny = G.y + (wantY - G.y) * follow;
    var mvx = (nx - G.x) / dt, mvy = (ny - G.y) / dt;
    var lat = Math.hypot(mvx, mvy);
    if (lat > MAX_LAT) {
      var f = MAX_LAT / lat;
      nx = G.x + mvx * f * dt; ny = G.y + mvy * f * dt;
      mvx *= f; mvy *= f;
    }
    G.vx = mvx; G.vy = mvy;          // still drives roll and the turrets' lead
    G.x = nx; G.y = ny;

    // banking reads the lateral velocity, which is what a real aircraft does
    var wantRoll = Math.max(-0.5, Math.min(0.5, -G.vx * 0.014));
    G.roll += (wantRoll - G.roll) * Math.min(1, dt * 7);

    // boost + heat
    var wantBoost = (input.keys.boost || input.boostId !== null) && !G.over;
    G.boosting = wantBoost;
    if (wantBoost) {
      G.heat += HEAT_UP * dt;
      if (G.heat >= 1) { G.heat = 1; G.over = true; G.boosting = false; audio.clip(); }
    } else {
      G.heat -= HEAT_DOWN * dt;
      if (G.heat <= 0) { G.heat = 0; G.over = false; }
      if (G.over && G.heat < 0.35) G.over = false;
    }
    var target = G.boosting ? SPEED_BOOST : SPEED_BASE;
    G.speed += (target - G.speed) * Math.min(1, dt * 2.6);
    G.z += G.speed * dt;

    // walls
    var wallPad = SHIP_R;
    // no bounce: being stopped by a wall is enough, and a kick sends you back
    // across the canal just as you are lining up a shot
    if (G.x < -HALF + wallPad) { G.x = -HALF + wallPad; G.vx = 0; scrape(-1); }
    if (G.x > HALF - wallPad) { G.x = HALF - wallPad; G.vx = 0; scrape(1); }
    if (G.y > FLOOR - wallPad) { G.y = FLOOR - wallPad; G.vy = 0; scrape(0); }
    if (G.y < TOP + wallPad) { G.y = TOP + wallPad; G.vy = 0; scrape(0); }

    if (G.fireCd > 0) G.fireCd -= dt;

    var i, j;
    for (i = G.shots.length - 1; i >= 0; i--) {
      var sh = G.shots[i];
      var pz = sh.z;               // where it was last frame: the port crossing test
      sh.z += SHOT_SPD * dt;
      if (sh.z - G.z > FAR + 60) { G.shots.splice(i, 1); continue; }
      // anything the bolt passed through this step
      for (j = 0; j < G.turrets.length; j++) {
        var tt = G.turrets[j];
        if (tt.dead || tt.z <= pz || tt.z > sh.z) continue;
        var run = tt.z - sh.z0;
        var hx = sh.x + sh.dx * run, hy = sh.y + sh.dy * run;
        if (Math.hypot(hx - tt.x, hy - tt.y) < 2.5) {
          tt.dead = true; tt.boom = 1;
          for (var bk = G.bolts.length - 1; bk >= 0; bk--) {
            if (G.bolts[bk].src === tt) G.bolts.splice(bk, 1);
          }
          G.hitMark = 1;
          G.kills++; G.hitsLanded++; G.combo++;
          var pts = Math.round(120 * (1 + Math.min(G.combo, 15) * 0.1));
          G.score += pts;
          audio.kill(Math.max(-1, Math.min(1, tt.x / HALF)));
          if (G.combo % 5 === 0) flashCallout("x" + G.combo + " STREAK");
          G.shots.splice(i, 1);
          break;
        }
      }
      // wall structure: one shot removes it and opens the lane
      for (j = 0; j < G.props.length; j++) {
        var pr2 = G.props[j];
        if (pr2.dead || pr2.z <= pz || pr2.z > sh.z) continue;
        var runp = pr2.z - sh.z0;
        if (inProp(pr2, sh.x + sh.dx * runp, sh.y + sh.dy * runp, 0.7)) {
          pr2.dead = true; pr2.boom = 1;
          G.hitMark = 1;
          G.hitsLanded++;
          G.score += 45;
          audio.kill((pr2.x0 + pr2.x1) / 2 / HALF);
          G.shots.splice(i, 1);
          break;
        }
      }
      if (i >= G.shots.length || G.shots[i] !== sh) continue;

      // the port at the end of the canal
      if (G.phase === "lock" && !G.portHit && pz < RUN_LEN && sh.z >= RUN_LEN) {
        var runP = RUN_LEN - sh.z0;
        var px2 = sh.x + sh.dx * runP, py2 = sh.y + sh.dy * runP;
        /* The LOCK is the aiming — holding the centre until it fills is what the
         * player is asked to do. Re-testing a tight lateral tolerance on top of
         * it just punishes the extrapolation: a shot aimed 108 units ahead and
         * measured 300 units away magnifies a 1-unit error into 3. */
        if (G.lockAmt >= 1 && Math.hypot(px2, py2 - MIDY) < 4) {
          breach();
        }
      }
    }

    // turrets: telegraph, then shoot back
    for (i = 0; i < G.turrets.length; i++) {
      var t2 = G.turrets[i];
      if (t2.boom) t2.boom = Math.max(0, t2.boom - dt * 2.2);
      if (t2.dead) continue;
      var ahead = t2.z - G.z;
      if (ahead < 12 || ahead > 190) continue;
      t2.cd -= dt;
      if (t2.cd <= 0.55 && t2.charge < 1) t2.charge = Math.min(1, t2.charge + dt * 2.2);
      if (t2.cd <= 0) {
        t2.cd = 0.95 + Math.random() * 0.95; t2.charge = 0; t2.fired++;
        /* Fired along a fixed line toward where the ship is heading. Once it
         * is away the line never changes, so moving off it dodges the shot —
         * which is the whole point of being able to see it coming. */
        var lead = ahead / BOLT_SPD;
        var span = Math.max(1, ahead);
        var aimX = G.x + G.vx * lead * 0.3, aimY = G.y + G.vy * lead * 0.3;
        G.bolts.push({
          x: t2.x, y: t2.y, z: t2.z, z0: t2.z, span: span, src: t2,
          dx: (aimX - t2.x) / span, dy: (aimY - t2.y) / span
        });
        audio.turret(Math.max(-1, Math.min(1, t2.x / HALF)));
      }
    }

    for (i = G.bolts.length - 1; i >= 0; i--) {
      var bo = G.bolts[i];
      var before = bo.z;
      bo.z -= BOLT_SPD * dt;

      /* Line of sight: anything solid between the mount and you eats the shot.
       * That turns the girders into cover instead of only obstacles. */
      var blocked = false;
      for (j = 0; j < G.props.length && !blocked; j++) {
        var bp = G.props[j];
        if (bp.dead || bp.z > before || bp.z < bo.z) continue;
        if (inProp(bp, boltX(bo, bp.z), boltY(bo, bp.z), 0)) blocked = true;
      }
      for (j = 0; j < G.bars.length && !blocked; j++) {
        var bb = G.bars[j];
        if (bb.z > before || bb.z < bo.z) continue;
        if (!through(bb, boltX(bo, bb.z), boltY(bo, bb.z), 0)) blocked = true;
      }
      if (blocked) { G.bolts.splice(i, 1); continue; }

      if (bo.z <= G.z) {
        // the same line that was drawn, sampled where it passes the ship
        if (Math.hypot(boltX(bo, G.z) - G.x, boltY(bo, G.z) - G.y) < 1.45) takeHit("HIT");
        G.bolts.splice(i, 1);
        continue;
      }
      if (before - bo.z <= 0) G.bolts.splice(i, 1);
    }

    for (i = 0; i < G.props.length; i++) {
      var pr3 = G.props[i];
      if (pr3.boom > 0) pr3.boom = Math.max(0, pr3.boom - dt * 2.2);
      if (pr3.scored || pr3.z > G.z) continue;
      pr3.scored = true;
      if (pr3.dead) continue;
      if (inProp(pr3, G.x, G.y, HIT_R)) bump();
      else G.score += 6;                     // a little for threading it
    }

    // hazards: score the graze as the bar passes, take the hit if we are in it
    for (var i = 0; i < G.bars.length; i++) {
      var b = G.bars[i];
      if (b.scored || b.z > G.z) continue;
      b.scored = true;
      if (!through(b, G.x, G.y, HIT_R)) {
        b.hit = true;
        takeHit();
      } else {
        var cl = clearance(b, G.x, G.y) - SHIP_R;
        if (cl < 1.5) {
          var tight = 1 - Math.max(0, cl) / 1.5;
          G.grazes++;
          G.combo++;
          var pts = Math.round((40 + tight * 110) * (1 + Math.min(G.combo, 12) * 0.12) * (G.boosting ? 1.5 : 1));
          G.score += pts;
          audio.graze(G.x > 0 ? 1 : -1, tight);
          spark(6, "150,255,190", 3);
          if (G.combo % 5 === 0) flashCallout("x" + G.combo + " CLEAN");
        } else {
          G.score += 12;
        }
      }
    }

    // the last stretch: the throat, and the lock
    if (G.phase === "fly" && G.z > RUN_LEN - FINAL) {
      G.phase = "lock";
      el.lock.hidden = false;
      flashCallout("THROAT AHEAD");
    }
    if (G.phase === "lock") {
      /* ⚠ This used to measure the SHIP's position while the panel, the label
       * and the throat rings all ask you to AIM. The ship only follows the
       * crosshair partway, so putting the crosshair on the port never centred
       * the ship and the lock could not fill at all — every run ended in
       * "you passed the throat without a lock". Measure the gun LINE, the same
       * maths the breach shot itself uses. */
      var runP = Math.max(1, RUN_LEN - G.z);
      var lx = G.x + (G.ax - G.x) / AIM_DEPTH * runP;
      var ly = G.y + (G.ay - G.y) / AIM_DEPTH * runP;
      var off = Math.hypot(lx, ly - MIDY);
      var onTarget = off < 3.1;              // a real aim, not "roughly ahead"
      var was = G.lockAmt;
      G.lockAmt += (onTarget ? 1 : -1.7) * dt * 0.58;   // held, not brushed
      G.lockAmt = Math.max(0, Math.min(1, G.lockAmt));
      if (Math.floor(G.lockAmt * 5) !== Math.floor(was * 5) && G.lockAmt > was) {
        audio.lockTick(Math.floor(G.lockAmt * 5) * 2);
      }
      el.lock.className = "lock" + (G.lockAmt >= 1 ? " is-locked" : "");
      el.lock.textContent = G.lockAmt >= 1 ? "LOCKED — FIRE" : "AIM AT THE CORE";
      el.lock.style.setProperty("--amt", G.lockAmt.toFixed(3));
      if (G.z > RUN_LEN + 40 && !G.fired) miss();
    }

    if (G.inv > 0) G.inv = Math.max(0, G.inv - dt);
    G.elapsed = performance.now() - G.t0;
    audio.engine(Math.max(0, (G.speed - SPEED_BASE) / (SPEED_BOOST - SPEED_BASE)) * 0.7
      + Math.min(1, G.speed / SPEED_BOOST) * 0.3, G.over);
    updateHud();
  }

  /* Clouting a girder: it costs you the streak and some speed, and it is felt
   * and heard — but never hull. */
  var lastBump = 0;
  function bump() {
    var now = performance.now();
    if (now - lastBump < 220) return;
    lastBump = now;
    G.combo = 0;
    G.speed *= 0.72;
    G.shake = Math.min(0.55, G.shake + 0.35);
    G.scrapeFlash = 1;
    audio.clip();
    spark(14, "255,209,102", 4);
    flashCallout("GLANCED", true);
  }

  // A bolt's position is a pure function of how far IT has travelled, so the
  // drawn line and the hit test can never drift apart.
  function boltX(b, z) { return b.x + b.dx * (b.z0 - z); }
  function boltY(b, z) { return b.y + b.dy * (b.z0 - z); }

  var lastScrape = 0;
  function scrape(side) {
    var now = performance.now();
    if (now - lastScrape < 160) return;
    lastScrape = now;
    G.shake = Math.min(0.22, G.shake + 0.1);
    G.scrapeFlash = 1;                     // amber edge, NOT the damage wash
    audio.scrape();
    spark(8, "255,209,102", 3);
  }

  function takeHit(label) {
    if (G.inv > 0) return;
    G.inv = INV_TIME;
    G.hits++;
    G.combo = 0;
    G.score = Math.max(0, G.score - 120);
    G.shake = 1;
    G.hitFlash = 1;
    el.hull.classList.remove("is-struck");
    void el.hull.offsetWidth;
    el.hull.classList.add("is-struck");
    audio.damage();
    spark(22, "255,61,129", 6);
    flashCallout((label || "CLIPPED") + " — " + Math.max(0, 3 - G.hits) + " LEFT", true);
    if (G.hits >= 3) crash();
  }

  /* One shot per click or tap. A constant stream made the crosshair the whole
   * game and the trigger meaningless; a discrete shot puts the decision back in
   * the player's hands and makes each hit worth something. */
  function fireShot() {
    if (G.phase !== "fly" && G.phase !== "lock") return;
    if (G.fireCd > 0) return;
    G.fireCd = FIRE_CD;
    var dirX = (G.ax - G.x) / AIM_DEPTH, dirY = (G.ay - G.y) / AIM_DEPTH;
    G.shots.push({ x: G.x, y: G.y, z: G.z, z0: G.z, dx: dirX, dy: dirY, life: 1 });
    G.shotsFired++;
    audio.pew(Math.max(-1, Math.min(1, G.x / HALF)));
    if (G.phase === "lock" && G.lockAmt < 1) flashCallout("NO LOCK", true);
  }

  /* The core goes up. The whole point of flying the canal is this, so it gets
   * three and a half seconds rather than a fade: the throat blows apart, a
   * blast front races back UP the canal and washes over you, and the far end
   * keeps tearing itself open behind it. */
  function breach() {
    G.portHit = true;
    G.fired = true;
    G.phase = "boom";
    G.boomT = 0;
    G.shockZ = RUN_LEN;
    G.whiteout = 0;
    G.washed = false;
    el.lock.hidden = true;                                 // the targeting job is done
    G.flash = 1;
    G.shake = 1;
    G.debris.length = 0;
    CAM_BACK = 20;
    for (var i = 0; i < 300; i++) {
      var a = Math.random() * TAU, rr = Math.random() * 9;
      G.debris.push({
        x: Math.cos(a) * rr, y: MIDY + Math.sin(a) * rr, z: RUN_LEN + Math.random() * 40,
        vx: Math.cos(a) * (6 + Math.random() * 26),
        vy: Math.sin(a) * (6 + Math.random() * 26),
        vz: -(90 + Math.random() * 760),
        life: 1
      });
    }
    audio.detonate();
    flashCallout("CORE BREACHED");
    setTimeout(win, BOOM_LEN * 1000);
  }

  /* ------------------------------------------------------------------ flow */

  function updateHud() {
    el.score.textContent = G.score.toLocaleString();
    el.kills.textContent = G.kills;
    el.hull.textContent = Math.max(0, 3 - G.hits);
    el.hull.style.color = G.hits >= 2 ? "var(--hot)" : "";
    el.time.textContent = (G.elapsed / 1000).toFixed(1) + "s";
    var p = Math.max(0, Math.min(1, G.z / RUN_LEN));
    el.progFill.style.transform = "scaleX(" + p.toFixed(4) + ")";
    el.heatFill.style.transform = "scaleX(" + G.heat.toFixed(3) + ")";
    el.heat.classList.toggle("is-over", G.over);
  }

  function flashCallout(txt, bad) {
    el.callout.textContent = txt;
    el.callout.hidden = false;
    el.callout.classList.toggle("is-bad", !!bad);
    el.callout.classList.remove("is-pop");
    void el.callout.offsetWidth;
    el.callout.classList.add("is-pop");
    clearTimeout(flashCallout._t);
    flashCallout._t = setTimeout(function () { el.callout.hidden = true; }, 900);
  }

  function startRun() {
    G.phase = "fly";
    G.z = 0; G.x = 0; G.y = 0; G.vx = 0; G.vy = 0;
    G.speed = SPEED_BASE; G.roll = 0;
    G.heat = 0; G.over = false; G.boosting = false;
    G.score = 0; G.combo = 0; G.hits = 0; G.grazes = 0;
    G.lockAmt = 0; G.fired = false; G.portHit = false;
    G.shake = 0; G.flash = 0; G.hitFlash = 0; G.scrapeFlash = 0; G.hitMark = 0; G.inv = 0;
    G.boomT = -1; G.whiteout = 0; G.washed = false; G.debris.length = 0;
    CAM_BACK = 20;
    G.sparks.length = 0;
    G.ax = 0; G.ay = MIDY;
    G.shots.length = 0; G.bolts.length = 0; G.props.length = 0;
    G.fireCd = 0; G.kills = 0; G.shotsFired = 0; G.hitsLanded = 0;
    G.bars = buildBars();
    G.props = buildProps(G.bars);
    G.turrets = buildTurrets(G.bars, G.props);
    input.tx = 0; input.ty = 0; input.have = !coarse;
    G.t0 = performance.now(); G.elapsed = 0;
    el.hud.hidden = false;
    el.lock.hidden = true;
    if (coarse) el.boost.hidden = false;
    updateHud();
    audio.unlock();
    audio.startEngine();
    gtagSafe("run_start", { toy: "trench-runner" });
  }

  function endCommon() {
    audio.stopEngine();
    el.lock.hidden = true;
    el.boost.hidden = true;
    input.boostId = null;
    G.boosting = false;
  }

  function crash() {
    if (G.phase === "dead" || G.phase === "won") return;
    G.phase = "dead";
    endCommon();
    audio.fail();
    G.shake = 1;
    spark(40, "255,61,129", 8);
    showPanel("Hull failed", "Three hits and you are out.",
      "<b>" + G.kills + " guns</b> down, <b>" + Math.round(G.z / RUN_LEN * 100) + "%</b> of the canal, <b>" +
      G.score.toLocaleString() + "</b> points.<br />Kill the emplacements before they charge — a red one is about to fire.",
      "Run it again");
    gtagSafe("run_end", { toy: "trench-runner", outcome: "crash", value: G.score });
  }

  function miss() {
    if (G.phase === "dead" || G.phase === "won") return;
    G.phase = "dead";
    endCommon();
    audio.fail();
    showPanel("Overshot", "You passed the throat without a lock.",
      "Hold the crosshair on the core until it reads <b>LOCKED</b>, then fire.<br />" +
      "Final score <b>" + G.score.toLocaleString() + "</b>.", "Run it again");
    gtagSafe("run_end", { toy: "trench-runner", outcome: "miss", value: G.score });
  }

  function win() {
    if (G.phase === "won") return;
    G.phase = "won";
    endCommon();
    var secs = G.elapsed / 1000;
    var timeBonus = Math.max(0, Math.round((120 - secs) * 22));
    var acc = G.shotsFired ? Math.round(G.hitsLanded / G.shotsFired * 100) : 0;
    var cleanBonus = G.hits === 0 ? 1500 : 0;
    G.score += timeBonus + cleanBonus;
    audio.win();
    G.flash = 1;

    var pb = G.score > G.best;
    if (pb) { G.best = G.score; store(KEY_BEST, String(G.best)); }
    var prevT = parseFloat(store(KEY_TIME) || "0");
    if (!prevT || secs < prevT) store(KEY_TIME, secs.toFixed(2));
    G.bestTime = parseFloat(store(KEY_TIME) || "0");

    window.OPT_SHARE_IMAGE = function () { draw(performance.now()); return canvas; };
    window.OPT_SHARE_LINE = G.score.toLocaleString() + " pts · " + G.kills + " guns · " + secs.toFixed(1) + "s";
    window.OPT_SHARE_TEXT = "I breached the core on Trench Runner — " + G.kills +
      " guns down, " + G.score.toLocaleString() + " points in " + secs.toFixed(1) + "s" +
      (G.hits === 0 ? ", untouched." : ".");

    showPanel(pb ? "New best" : "Core breached",
      "Run complete",
      "<b>" + G.score.toLocaleString() + " points</b> in <b>" + secs.toFixed(1) + "s</b>.<br />" +
      "<b>" + G.kills + " guns</b> destroyed · " + acc + "% accuracy · " + G.grazes + " grazes<br />" +
      (G.hits === 0 ? "<b>Untouched +1,500</b> · " : G.hits + " hit" + (G.hits > 1 ? "s" : "") + " · ") +
      "speed bonus " + timeBonus.toLocaleString() + "<br />" +
      (G.bestTime ? "Best time " + G.bestTime.toFixed(1) + "s." : ""),
      "Fly it again");
    gtagSafe("run_end", { toy: "trench-runner", outcome: "win", value: G.score });
  }

  function showPanel(eyebrow, title, html, btn) {
    setTimeout(function () {
      el.ovEyebrow.textContent = eyebrow;
      el.ovTitle.textContent = title;
      el.ovText.innerHTML = html;
      el.ovBtn.textContent = btn;
      el.ovDemo.setAttribute("hidden", "");   // <svg> has no `hidden` IDL property
      el.overlay.hidden = false;
      el.overlay.classList.remove("is-out");
    }, reduceMotion ? 300 : 900);
  }

  function store(k, v) {
    try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); }
    catch (e) { return null; }
  }
  function gtagSafe(n, p) { try { if (typeof gtag === "function") gtag("event", n, p); } catch (e) {} }

  el.ovBtn.addEventListener("click", function () {
    audio.unlock();
    el.overlay.classList.add("is-out");
    setTimeout(function () { el.overlay.hidden = true; }, 240);
    window.OPT_SHARE_IMAGE = null;
    window.OPT_SHARE_LINE = null;
    window.OPT_SHARE_TEXT = null;
    if (el.hint) el.hint.classList.add("is-gone");
    startRun();
  });

  el.soundBtn.addEventListener("click", function () {
    audio.unlock();
    var v = audio.toggle();
    el.soundBtn.setAttribute("aria-pressed", v ? "true" : "false");
  });

  /* ------------------------------------------------------------------ loop */

  var last = 0;
  var loopWarned = false;
  function frame(now) {
    var dt = Math.min(0.05, (now - last) / 1000 || 0);
    last = now;
    // decayed OUT here, so it keeps settling through every phase including the
    // stopped ones — a run that ends mid-shake must come to rest
    // the hit lands in slow motion, then time runs back up
    if (G.phase === "boom" && G.boomT >= 0 && G.boomT < 0.75 && !reduceMotion) {
      dt *= 0.22 + (G.boomT / 0.75) * 0.78;
    }
    G.shake *= Math.pow(0.02, dt);
    if (G.shake < 0.002) G.shake = 0;
    /* ⚠ An exception here used to kill requestAnimationFrame outright and the
     * toy froze mid-run with no way back. Keep the loop alive and let the error
     * surface in the console instead of taking the game with it. */
    try { update(dt); } catch (e) {
      if (!loopWarned) { loopWarned = true; try { console.error("update failed:", e); } catch (e2) {} }
    }
    try { draw(now); } catch (e) {
      if (!loopWarned) { loopWarned = true; try { console.error("draw failed:", e); } catch (e2) {} }
    }
    requestAnimationFrame(frame);
  }

  function init() {
    var sv = store(KEY_SOUND);
    var on = sv !== "0";
    audio.init(on);
    el.soundBtn.setAttribute("aria-pressed", on ? "true" : "false");

    G.best = parseInt(store(KEY_BEST) || "0", 10) || 0;
    G.bestTime = parseFloat(store(KEY_TIME) || "0") || 0;
    el.best.textContent = G.best ? G.best.toLocaleString() : "—";

    layout();
    // a canal drifting past behind the intro panel, so the toy is alive on arrival
    G.bars = buildBars();
    G.props = buildProps(G.bars);
    G.turrets = buildTurrets(G.bars, G.props);
    G.ax = 0; G.ay = MIDY;
    G.phase = "idle";
    requestAnimationFrame(frame);
    gtagSafe("toy_open", { toy: "trench-runner" });
  }

  window.addEventListener("resize", layout);
  window.addEventListener("orientationchange", function () { setTimeout(layout, 120); });

  init();
})();
