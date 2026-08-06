/* Accretion — No. 103
 *
 * A falling-block puzzle on a polar grid. Gravity points inward: debris arrives
 * at the rim and falls toward a burning core, one ring at a time. Complete a
 * whole ring and it collapses into the star, pulling everything outside it in.
 *
 * The geometry is the whole design. Two consequences worth knowing before you
 * edit anything:
 *   1. There are NO side walls — sectors wrap, so a piece can orbit forever.
 *      That is why spawning scans for a free sector instead of failing on one.
 *   2. Cells narrow as they approach the core (arc length is 2*PI*r/SECTORS),
 *      so the same piece covers less ground the deeper it sits. The difficulty
 *      curve is in the geometry; the speed ramp only sharpens it.
 */

(function () {
  "use strict";

  // ------------------------------------------------------------------ grid

  var SECTORS = 16;                 // cells around the disk
  var RINGS = 9;                    // ring 0 hugs the core, RINGS-1 is the rim
  var CORE_FRAC = 0.3;              // core radius as a fraction of the disk
  var TAU = Math.PI * 2;
  var SECTOR_A = TAU / SECTORS;

  // grid[ring][sector] = null | { hue, heat }
  var grid = [];

  function blankGrid() {
    var g = [];
    for (var r = 0; r < RINGS; r++) {
      var row = [];
      for (var s = 0; s < SECTORS; s++) row.push(null);
      g.push(row);
    }
    return g;
  }

  function mod(n, m) { return ((n % m) + m) % m; }

  // ---------------------------------------------------------------- pieces

  /* Cells are [dr, ds] offsets: dr outward from the piece's innermost ring,
   * ds clockwise from its anchor sector. Sizes deliberately run 2–4 so the
   * bag mixes gap-fillers with commitments; `lance` is the one big play. */
  var SHAPES = [
    { id: "pair",   cells: [[0, 0], [0, 1]] },
    { id: "arc",    cells: [[0, 0], [0, 1], [0, 2]] },
    { id: "spoke",  cells: [[0, 0], [1, 0], [2, 0]] },
    { id: "hook",   cells: [[0, 0], [0, 1], [1, 0]] },
    { id: "wedge",  cells: [[0, 0], [0, 1], [1, 0], [1, 1]] },
    { id: "tee",    cells: [[0, 0], [0, 1], [0, 2], [1, 1]] },
    { id: "zig",    cells: [[0, 0], [0, 1], [1, 1], [1, 2]] },
    { id: "lance",  cells: [[0, 0], [1, 0], [2, 0], [3, 0]] }
  ];

  /* Warm mineral spectrum with cool ends. Deliberately NOT the saturated
   * primary set every other falling-block game uses — these are lit stone,
   * and the core is the only genuinely hot colour on the page. */
  var HUES = [
    { h: 34,  s: 78, l: 58 },   // amber
    { h: 16,  s: 72, l: 56 },   // copper
    { h: 348, s: 64, l: 60 },   // rose
    { h: 318, s: 48, l: 60 },   // orchid
    { h: 268, s: 46, l: 62 },   // violet
    { h: 218, s: 46, l: 60 },   // indigo
    { h: 44,  s: 62, l: 66 }    // pale gold
  ];

  function hsl(h, s, l, a) {
    return "hsla(" + h + "," + s + "%," + l + "%," + (a === undefined ? 1 : a) + ")";
  }

  /* Settled matter cools: it desaturates, darkens a touch and drifts toward
   * violet. Keeps the disk reading as one cooling mass instead of confetti. */
  function cooled(hue) {
    var dh = ((265 - hue.h + 540) % 360) - 180;   // shortest way round to violet
    return { h: mod(hue.h + dh * 0.18, 360), s: hue.s * 0.72, l: hue.l * 0.9 };
  }

  function rotateCells(cells) {
    // 90 degrees on the (dr, ds) lattice: a spoke becomes an arc.
    var out = cells.map(function (c) { return [c[1], -c[0]]; });
    var minR = Infinity, minS = Infinity;
    out.forEach(function (c) { minR = Math.min(minR, c[0]); minS = Math.min(minS, c[1]); });
    return out.map(function (c) { return [c[0] - minR, c[1] - minS]; });
  }

  function heightOf(cells) {
    var m = 0;
    cells.forEach(function (c) { m = Math.max(m, c[0]); });
    return m + 1;
  }

  // A shuffled bag, so you are never starved of the piece you need.
  var bag = [];
  function nextShape() {
    if (!bag.length) {
      bag = SHAPES.slice();
      for (var i = bag.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var t = bag[i]; bag[i] = bag[j]; bag[j] = t;
      }
    }
    return bag.pop();
  }

  function makePiece() {
    var sh = nextShape();
    return {
      cells: sh.cells.map(function (c) { return c.slice(); }),
      hueIdx: Math.floor(Math.random() * HUES.length),
      ring: 0,
      sector: 0
    };
  }

  // ----------------------------------------------------------------- state

  var phase = "idle";               // idle | falling | collapsing | over
  var paused = false;
  var piece = null;
  var nextPiece = null;
  var visR = 0;                     // smoothed render radius of the falling piece
  var fallT = 0, lockT = 0, lockResets = 0;
  var score = 0, ringsCleared = 0, level = 1, best = 0;
  var collapse = null;              // { snapshot, cleared, t, dur }
  var lastSector = 0;
  var sparks = [];
  var coreFlash = 0, corePulse = 0, shake = 0;
  var dangerPulse = 0;

  var LOCK_MS = 430;
  var MAX_LOCK_RESETS = 8;
  var CLEAR_SCORE = [0, 100, 300, 700, 1500, 2600];

  // Attract mode: the disk plays itself behind the intro panel, so the first
  // thing you see is the toy working rather than an empty field. It is also
  // what makes a posed card/OG capture possible without debug hooks.
  var attract = false;
  var ai = null, aiT = 0;
  var AI_TICK = 72;

  var BEST_KEY = "accretion_best";
  var SOUND_KEY = "accretion_sound";

  var reduceMotion = window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ------------------------------------------------------------- placement

  function canPlace(cells, ring, sector) {
    for (var i = 0; i < cells.length; i++) {
      var r = ring + cells[i][0];
      if (r < 0 || r >= RINGS) return false;          // inside the core, or past the rim
      if (grid[r][mod(sector + cells[i][1], SECTORS)]) return false;
    }
    return true;
  }

  /* No walls means a blocked spawn sector is not a loss — the disk may be wide
   * open a quarter turn away. Scan outward from the last drop so the next piece
   * appears near where you were working. */
  function findSpawnSector(cells, ring) {
    for (var d = 0; d < SECTORS; d++) {
      var a = mod(lastSector + Math.ceil(d / 2) * (d % 2 ? 1 : -1), SECTORS);
      if (canPlace(cells, ring, a)) return a;
    }
    return null;
  }

  function spawn() {
    piece = nextPiece || makePiece();
    nextPiece = makePiece();
    drawNext();

    piece.ring = RINGS - heightOf(piece.cells);
    var s = findSpawnSector(piece.cells, piece.ring);
    if (s === null) { gameOver(); return; }

    piece.sector = s;
    // a small ease-in reads as "arriving"; any more and the piece floats
    // detached in the void outside the rim
    visR = RINGS + 0.4;
    fallT = 0; lockT = 0; lockResets = 0;
    if (attract) { ai = null; aiT = 0; held.down = 0; }
  }

  function grounded() {
    return !canPlace(piece.cells, piece.ring - 1, piece.sector);
  }

  function landingRing() {
    var r = piece.ring;
    while (canPlace(piece.cells, r - 1, piece.sector)) r--;
    return r;
  }

  function lockPiece() {
    var base = HUES[piece.hueIdx];
    var cells = piece.cells;
    for (var i = 0; i < cells.length; i++) {
      var r = piece.ring + cells[i][0];
      var s = mod(piece.sector + cells[i][1], SECTORS);
      grid[r][s] = { hue: base, heat: 1 };
      puff(r, s, base);
    }
    lastSector = piece.sector;

    if (!attract) audio.settle(piece.ring, sectorAngle(piece.sector), 1);

    var full = [];
    for (var r2 = 0; r2 < RINGS; r2++) {
      var all = true;
      for (var s2 = 0; s2 < SECTORS; s2++) if (!grid[r2][s2]) { all = false; break; }
      if (all) full.push(r2);
    }

    piece = null;
    if (full.length) startCollapse(full);
    else spawn();
  }

  // ---------------------------------------------------------- ring collapse

  function startCollapse(full) {
    phase = "collapsing";
    var snapshot = grid.map(function (row) { return row.slice(); });

    // score before the grid changes, so ring depth still means something
    var n = full.length;
    var gained = (CLEAR_SCORE[Math.min(n, CLEAR_SCORE.length - 1)] || 0) * level;
    // inner rings are smaller and harder to complete — pay for the difficulty
    var depthBonus = 0;
    full.forEach(function (r) { depthBonus += Math.round(40 * (RINGS - r) / RINGS * level); });
    addScore(gained + depthBonus);

    ringsCleared += n;
    if (ringsEl) ringsEl.textContent = ringsCleared;
    var newLevel = 1 + Math.floor(ringsCleared / 8);
    if (newLevel > level) { level = newLevel; if (!attract) audio.levelUp(); }

    // rebuild: drop everything outside a cleared ring inward
    var ng = blankGrid();
    var write = 0;
    for (var r = 0; r < RINGS; r++) {
      if (full.indexOf(r) !== -1) continue;
      ng[write++] = grid[r];
    }
    grid = ng;

    full.forEach(function (r) { ringSparks(r); });
    coreFlash = 1;
    corePulse = Math.min(1, 0.5 + n * 0.25);
    shake = reduceMotion ? 0 : Math.min(9, 3.5 + n * 2);
    if (!attract) audio.ringClear(n, full[0]);

    collapse = { snapshot: snapshot, cleared: full, t: 0, dur: reduceMotion ? 90 : 420 };
    bumpScore();
  }

  function endCollapse() {
    collapse = null;
    phase = "falling";
    piece = null;
    spawn();
  }

  // ------------------------------------------------------------------ moves

  function tryOrbit(dir) {
    if (!piece || phase !== "falling") return false;
    if (canPlace(piece.cells, piece.ring, piece.sector + dir)) {
      piece.sector = mod(piece.sector + dir, SECTORS);
      touchLock();
      audio.orbit();
      return true;
    }
    return false;
  }

  function tryRotate(dir) {
    if (!piece || phase !== "falling") return false;
    var cells = piece.cells;
    var n = dir > 0 ? 1 : 3;
    for (var i = 0; i < n; i++) cells = rotateCells(cells);

    // Kicks: sector nudges first (cheap, no walls to fight), then outward.
    var kicks = [[0, 0], [0, 1], [0, -1], [0, 2], [0, -2], [1, 0], [1, 1], [1, -1], [2, 0]];
    for (var k = 0; k < kicks.length; k++) {
      var r = piece.ring + kicks[k][0];
      var s = piece.sector + kicks[k][1];
      if (canPlace(cells, r, s)) {
        piece.cells = cells;
        piece.ring = r;
        piece.sector = mod(s, SECTORS);
        touchLock();
        audio.rotate();
        return true;
      }
    }
    return false;
  }

  function stepIn() {
    if (canPlace(piece.cells, piece.ring - 1, piece.sector)) {
      piece.ring--;
      lockT = 0;
      return true;
    }
    return false;
  }

  function hardDrop() {
    if (!piece || phase !== "falling") return;
    var from = piece.ring;
    var to = landingRing();
    if (to < from) {
      piece.ring = to;
      addScore((from - to) * 2);
      visR = Math.min(visR, to + 0.9);
      audio.hardDrop(from - to);
      shake = reduceMotion ? 0 : Math.min(6, 1.5 + (from - to) * 0.5);
    }
    lockPiece();
  }

  // -------------------------------------------------------- attract player

  function sectorHeights() {
    var h = [];
    for (var s = 0; s < SECTORS; s++) {
      var top = 0;
      for (var r = RINGS - 1; r >= 0; r--) if (grid[r][s]) { top = r + 1; break; }
      h.push(top);
    }
    return h;
  }

  /* Score a hypothetical placement. Weights are the usual stack-game intuition
   * translated to the round: completing rings dominates, buried holes are the
   * real killer, and a bumpy surface makes the next piece harder to seat. */
  function evaluatePlacement(cells, ring, sector) {
    var i, r, s, marks = [];
    for (i = 0; i < cells.length; i++) {
      r = ring + cells[i][0];
      s = mod(sector + cells[i][1], SECTORS);
      grid[r][s] = 1;
      marks.push([r, s]);
    }

    var val = 0;
    for (r = 0; r < RINGS; r++) {
      var full = true;
      for (s = 0; s < SECTORS; s++) if (!grid[r][s]) { full = false; break; }
      if (full) val += 950;
    }

    var holes = 0, maxTop = 0;
    for (s = 0; s < SECTORS; s++) {
      var seen = false, top = 0;
      for (r = RINGS - 1; r >= 0; r--) {
        if (grid[r][s]) { if (!seen) top = r + 1; seen = true; }
        else if (seen) holes++;
      }
      maxTop = Math.max(maxTop, top);
    }
    val -= holes * 145;
    val -= maxTop * 26;
    val -= ring * 20;                      // reward seating it deep

    var hs = sectorHeights();
    var bump = 0;
    for (s = 0; s < SECTORS; s++) bump += Math.abs(hs[s] - hs[(s + 1) % SECTORS]);
    val -= bump * 7;

    for (i = 0; i < marks.length; i++) grid[marks[i][0]][marks[i][1]] = null;
    return val;
  }

  function planMove() {
    var cells = piece.cells;
    var best = null;
    for (var rot = 0; rot < 4; rot++) {
      // a rotation can make the piece taller than the room left above it, so
      // simulate from the deepest ring that orientation could legally start at
      var start = Math.min(piece.ring, RINGS - heightOf(cells));
      for (var s = 0; s < SECTORS; s++) {
        if (!canPlace(cells, start, s)) continue;
        var r = start;
        while (canPlace(cells, r - 1, s)) r--;
        var v = evaluatePlacement(cells, r, s);
        if (!best || v > best.v) best = { v: v, rot: rot, sector: s };
      }
      cells = rotateCells(cells);
      // a piece with rotational symmetry would otherwise be scored four times
      if (JSON.stringify(cells) === JSON.stringify(piece.cells)) break;
    }
    return best;
  }

  function stepAttract(dt) {
    if (!piece) return;
    aiT += dt;
    if (aiT < AI_TICK) return;
    aiT = 0;

    if (!ai) { ai = planMove(); if (!ai) return; ai.done = 0; }

    if (ai.done < ai.rot) { if (tryRotate(1)) ai.done++; else ai.done = ai.rot; return; }

    if (piece.sector !== ai.sector) {
      // go whichever way round the disk is shorter — there are no walls
      var diff = mod(ai.sector - piece.sector, SECTORS);
      tryOrbit(diff <= SECTORS / 2 ? 1 : -1);
      return;
    }
    held.down = 1;                          // aligned: let it fall home
  }

  function touchLock() {
    // Let the player keep working a grounded piece, but not forever.
    if (lockT > 0 && lockResets < MAX_LOCK_RESETS) { lockT = 0; lockResets++; }
  }

  function fallInterval() {
    // the demo runs brisk so the disk fills while someone reads the panel
    if (attract) return 215;
    return Math.max(110, 820 - (level - 1) * 68);
  }

  // ----------------------------------------------------------------- score

  var scoreEl, ringsEl, bestEl, hudEl, nextEl, hintEl, overlay;
  var ovTitle, ovText, ovBtn, ovEyebrow, ovKeys;

  function addScore(n) {
    score += n;
    if (scoreEl) scoreEl.textContent = score;
  }

  function bumpScore() {
    if (!scoreEl || reduceMotion) return;
    scoreEl.classList.remove("is-bump");
    void scoreEl.offsetWidth;
    scoreEl.classList.add("is-bump");
  }

  function syncHud() {
    if (scoreEl) scoreEl.textContent = score;
    if (ringsEl) ringsEl.textContent = ringsCleared;
    if (bestEl) bestEl.textContent = best;
  }

  // ----------------------------------------------------------------- audio

  var audio = (function () {
    var ac = null, out = null, comp = null, masterLP = null;
    var conv = null, revSend = null, noiseBuf = null;
    var hum = null;
    var on = true;
    var lastOrbit = 0;

    try {
      var stored = localStorage.getItem(SOUND_KEY);
      if (stored === "off") on = false;
    } catch (e) {}

    function makeNoise(sec) {
      var len = Math.floor(ac.sampleRate * sec);
      var buf = ac.createBuffer(1, len, ac.sampleRate);
      var d = buf.getChannelData(0);
      var last = 0;
      for (var i = 0; i < len; i++) {
        var w = Math.random() * 2 - 1;
        last = (last + 0.02 * w) / 1.02;         // brown-ish, no harsh top
        d[i] = last * 3.2;
      }
      return buf;
    }

    /* Smooth impulse: lowpass the noise so the tail is not grainy, and remove
     * the running mean so the lows do not muddy the disk's hum. */
    function makeImpulse(sec, decay) {
      var len = Math.floor(ac.sampleRate * sec);
      var buf = ac.createBuffer(2, len, ac.sampleRate);
      for (var ch = 0; ch < 2; ch++) {
        var d = buf.getChannelData(ch);
        var lp = 0, dc = 0;
        for (var i = 0; i < len; i++) {
          lp += (Math.random() * 2 - 1 - lp) * 0.34;
          dc += (lp - dc) * 0.0055;
          d[i] = (lp - dc) * Math.pow(1 - i / len, decay);
        }
      }
      return buf;
    }

    function init() {
      if (ac) return true;
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ac = new AC();

      out = ac.createGain();
      out.gain.value = on ? 1 : 0;
      out.connect(ac.destination);

      masterLP = ac.createBiquadFilter();
      masterLP.type = "lowpass";
      masterLP.frequency.value = 12500;
      masterLP.connect(out);

      // glue + a hard stop on clipping when a four-ring clear stacks up
      comp = ac.createDynamicsCompressor();
      comp.threshold.value = -15;
      comp.ratio.value = 3;
      comp.attack.value = 0.004;
      comp.release.value = 0.22;
      comp.connect(masterLP);

      conv = ac.createConvolver();
      conv.buffer = makeImpulse(2.8, 2.4);
      var shimmer = ac.createBiquadFilter();
      shimmer.type = "highshelf";
      shimmer.frequency.value = 3600;
      shimmer.gain.value = 4;
      var cut = ac.createBiquadFilter();
      cut.type = "highpass";
      cut.frequency.value = 240;
      conv.connect(shimmer); shimmer.connect(cut); cut.connect(comp);

      revSend = ac.createGain();
      revSend.gain.value = 1;
      revSend.connect(conv);

      noiseBuf = makeNoise(2);
      return true;
    }

    function unlock() {
      if (!init()) return;
      if (ac.state === "suspended") ac.resume();
      // iOS will not start the graph without a real buffer play on a gesture
      var b = ac.createBuffer(1, 1, ac.sampleRate);
      var s = ac.createBufferSource();
      s.buffer = b; s.connect(ac.destination); s.start(0);
    }

    function panner(pan) {
      if (ac.createStereoPanner) {
        var p = ac.createStereoPanner();
        p.pan.value = Math.max(-1, Math.min(1, pan));
        return p;
      }
      return ac.createGain();
    }

    function noise(dur, type, freq, q, gain, when, pan) {
      var src = ac.createBufferSource();
      src.buffer = noiseBuf;
      src.loop = true;
      var f = ac.createBiquadFilter();
      f.type = type; f.frequency.value = freq; f.Q.value = q;
      var g = ac.createGain();
      g.gain.setValueAtTime(0.0001, when);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), when + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
      var p = panner(pan || 0);
      src.connect(f); f.connect(g); g.connect(p);
      p.connect(comp);
      var rs = ac.createGain(); rs.gain.value = 0.3;
      p.connect(rs); rs.connect(revSend);
      src.start(when); src.stop(when + dur + 0.05);
      return f;
    }

    function tone(type, f0, f1, dur, gain, when, pan, rev) {
      var o = ac.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(f0, when);
      if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), when + dur * 0.9);
      var g = ac.createGain();
      g.gain.setValueAtTime(0.0001, when);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), when + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
      var p = panner(pan || 0);
      o.connect(g); g.connect(p); p.connect(comp);
      var rs = ac.createGain(); rs.gain.value = rev === undefined ? 0.24 : rev;
      p.connect(rs); rs.connect(revSend);
      o.start(when); o.stop(when + dur + 0.05);
      return o;
    }

    // A-minor pentatonic, climbing as the debris nears the core.
    var PENT = [0, 3, 5, 7, 10];
    function ringFreq(ring) {
      var deg = RINGS - 1 - ring;                 // innermost ring is the top note
      return 165 * Math.pow(2, (PENT[deg % 5] + 12 * Math.floor(deg / 5)) / 12);
    }

    return {
      get on() { return on; },
      unlock: unlock,

      setOn: function (v) {
        on = v;
        try { localStorage.setItem(SOUND_KEY, v ? "on" : "off"); } catch (e) {}
        if (ac && out) out.gain.setTargetAtTime(v ? 1 : 0, ac.currentTime, 0.02);
      },

      /* Rock meeting rock: a bandpassed contact transient, a short pitched body
       * an octave-stacked, and a low thud underneath. Panned by where on the
       * disk it landed. */
      settle: function (ring, angle, vel) {
        if (!ac || !on) return;
        var t = ac.currentTime;
        var pan = Math.cos(angle) * 0.75;
        var f = ringFreq(ring);
        var v = 0.5 + vel * 0.5;

        noise(0.05, "bandpass", 1500 + (RINGS - ring) * 160, 1.3, 0.16 * v, t, pan);
        tone("sine", f, f, 0.30 + ring * 0.012, 0.13 * v, t, pan, 0.3);
        tone("triangle", f * 2.005, f * 2.005, 0.16, 0.05 * v, t, pan, 0.22);
        tone("sine", 92, 54, 0.15, 0.1 * v, t, pan * 0.4, 0.12);
      },

      rotate: function () {
        if (!ac || !on) return;
        noise(0.035, "bandpass", 920, 2.4, 0.05, ac.currentTime, 0);
      },

      orbit: function () {
        if (!ac || !on) return;
        var t = ac.currentTime;
        if (t - lastOrbit < 0.035) return;        // holding a key should not machine-gun
        lastOrbit = t;
        noise(0.02, "bandpass", 2300, 3, 0.022, t, 0);
      },

      hardDrop: function (dist) {
        if (!ac || !on) return;
        var t = ac.currentTime;
        var d = Math.min(1, dist / 7);
        tone("sawtooth", 380 + d * 160, 120, 0.13, 0.07 + d * 0.05, t, 0, 0.1);
        noise(0.1, "lowpass", 1400, 0.9, 0.07 * d, t, 0);
      },

      /* The payoff. A harmonic bloom over a downward collapse whoosh and a low
       * thump as the core swallows it — everything heavy on the reverb send so
       * the tail blooms into the hall. */
      ringClear: function (n, ring) {
        if (!ac || !on) return;
        var t = ac.currentTime;
        var f = ringFreq(ring) * Math.pow(2, (n - 1) / 12 * 3);
        var parts = [1, 2, 3, 4, 6, 8];
        for (var i = 0; i < parts.length; i++) {
          var g = 0.14 / (1 + i * 0.85) * (0.7 + n * 0.14);
          var d = (2.1 - i * 0.2) * (0.8 + n * 0.08);
          tone("sine", f * parts[i], f * parts[i], Math.max(0.35, d), g,
               t + i * 0.008, (i % 2 ? 0.3 : -0.3), 0.75);
        }
        // collapse: a bandpass sweeping down as the ring falls into the core
        var sw = noise(0.55, "bandpass", 2600, 1.6, 0.16, t, 0);
        sw.frequency.exponentialRampToValueAtTime(210, t + 0.5);
        tone("sine", 128, 40, 0.42, 0.2, t + 0.03, 0, 0.35);
        if (n > 1) tone("sine", 62, 34, 0.7, 0.16, t + 0.06, 0, 0.4);
      },

      levelUp: function () {
        if (!ac || !on) return;
        var t = ac.currentTime;
        for (var i = 0; i < 3; i++) {
          tone("sine", 660 * Math.pow(2, i * 4 / 12), null, 0.5, 0.05, t + i * 0.07,
               i === 1 ? 0 : (i ? 0.4 : -0.4), 0.6);
        }
      },

      /* The disk's own voice: a low binaural pair plus a filtered bed, which
       * tightens and rises as the field fills. This is the tension channel —
       * you should feel the trouble before you read it. */
      startHum: function () {
        if (!ac || !on || hum) return;
        var t = ac.currentTime;
        var g = ac.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.05, t + 1.6);
        var lp = ac.createBiquadFilter();
        lp.type = "lowpass"; lp.frequency.value = 320; lp.Q.value = 0.7;
        g.connect(lp); lp.connect(comp);

        var oscs = [];
        // 55/55.4 beat slowly; the upper pair keeps it audible on phone speakers
        [[55, 0.5], [55.4, 0.5], [110, 0.16], [165, 0.07]].forEach(function (spec) {
          var o = ac.createOscillator();
          o.type = "sine";
          o.frequency.value = spec[0];
          var og = ac.createGain();
          og.gain.value = spec[1];
          o.connect(og); og.connect(g);
          o.start(t);
          oscs.push(o);
        });

        var src = ac.createBufferSource();
        src.buffer = noiseBuf; src.loop = true;
        var nf = ac.createBiquadFilter();
        nf.type = "lowpass"; nf.frequency.value = 190;
        var ng = ac.createGain(); ng.gain.value = 0.5;
        src.connect(nf); nf.connect(ng); ng.connect(g);
        src.start(t);

        hum = { g: g, lp: lp, oscs: oscs, src: src };
      },

      setTension: function (fill) {
        if (!ac || !hum) return;
        var t = ac.currentTime;
        hum.g.gain.setTargetAtTime(0.05 + fill * 0.09, t, 0.5);
        hum.lp.frequency.setTargetAtTime(320 + fill * 620, t, 0.6);
        hum.oscs[0].frequency.setTargetAtTime(55 + fill * 5, t, 0.8);
        hum.oscs[1].frequency.setTargetAtTime(55.4 + fill * 7, t, 0.8);
      },

      stopHum: function (fall) {
        if (!ac || !hum) return;
        var t = ac.currentTime;
        var h = hum;
        hum = null;
        if (fall) {
          h.oscs.forEach(function (o, i) {
            o.frequency.exponentialRampToValueAtTime(o.frequency.value * 0.42, t + 1.5);
          });
          h.lp.frequency.setTargetAtTime(120, t, 0.5);
        }
        h.g.gain.setTargetAtTime(0.0001, t, fall ? 0.55 : 0.15);
        setTimeout(function () {
          try { h.oscs.forEach(function (o) { o.stop(); }); h.src.stop(); } catch (e) {}
        }, fall ? 2600 : 700);
      },

      gameOver: function () {
        if (!ac || !on) return;
        var t = ac.currentTime;
        [110, 130.8, 164.8].forEach(function (f, i) {
          tone("sine", f, f * 0.5, 2.2, 0.09, t + i * 0.05, i === 1 ? 0 : (i ? 0.35 : -0.35), 0.8);
        });
        var sw = noise(1.4, "lowpass", 900, 0.8, 0.1, t, 0);
        sw.frequency.exponentialRampToValueAtTime(110, t + 1.2);
      }
    };
  })();

  // ------------------------------------------------------------- particles

  function puff(ring, sector, hue) {
    if (reduceMotion) return;
    var a = sectorAngle(sector);
    var r = R_CORE + (ring + 0.5) * ringH();
    for (var i = 0; i < 6; i++) {
      var sp = 0.35 + Math.random() * 0.9;
      sparks.push({
        x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r,
        vx: Math.cos(a + (Math.random() - 0.5) * 1.6) * sp,
        vy: Math.sin(a + (Math.random() - 0.5) * 1.6) * sp,
        life: 1, decay: 0.022 + Math.random() * 0.02,
        size: 1 + Math.random() * 1.6,
        h: hue.h, s: hue.s, l: hue.l + 16
      });
    }
  }

  function ringSparks(ring) {
    if (reduceMotion) return;
    var r = R_CORE + (ring + 0.5) * ringH();
    for (var i = 0; i < 52; i++) {
      var a = Math.random() * TAU;
      // inward, with a tangential smear so it reads as orbital infall
      var vin = 1.6 + Math.random() * 3.2;
      var vt = (Math.random() - 0.5) * 2.6;
      sparks.push({
        x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r,
        vx: -Math.cos(a) * vin - Math.sin(a) * vt,
        vy: -Math.sin(a) * vin + Math.cos(a) * vt,
        life: 1, decay: 0.014 + Math.random() * 0.014,
        size: 1.2 + Math.random() * 2.4,
        h: 38 - Math.random() * 18, s: 92, l: 74
      });
    }
  }

  function stepSparks(dt) {
    var k = dt / 16.67;
    for (var i = sparks.length - 1; i >= 0; i--) {
      var p = sparks[i];
      p.x += p.vx * k; p.y += p.vy * k;
      // everything falls toward the star
      var dx = cx - p.x, dy = cy - p.y;
      var d = Math.hypot(dx, dy) || 1;
      p.vx += (dx / d) * 0.09 * k;
      p.vy += (dy / d) * 0.09 * k;
      p.vx *= 0.985; p.vy *= 0.985;
      p.life -= p.decay * k;
      if (p.life <= 0 || d < R_CORE * 0.5) sparks.splice(i, 1);
    }
  }

  // ------------------------------------------------------------- rendering

  var canvas, ctx, W = 0, H = 0, cx = 0, cy = 0, R_OUT = 0, R_CORE = 0, dpr = 1;
  var stars = [], dust = [];
  var t0 = 0, tNow = 0;

  function ringH() { return (R_OUT - R_CORE) / RINGS; }
  function sectorAngle(s) { return s * SECTOR_A - Math.PI / 2 + SECTOR_A / 2; }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.floor(W * dpr);
    canvas.height = Math.floor(H * dpr);
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    cx = W / 2;
    cy = H / 2;
    // the disk must fit whichever way the phone is held, with room for chrome
    R_OUT = Math.min(W * 0.46, H * 0.46);
    R_CORE = R_OUT * CORE_FRAC;

    buildStars();
    buildDust();
  }

  function buildStars() {
    stars = [];
    var n = Math.round((W * H) / 9000);
    n = Math.max(70, Math.min(260, n));
    for (var i = 0; i < n; i++) {
      stars.push({
        a: Math.random() * TAU,
        r: R_OUT * (1.06 + Math.random() * 1.9),
        size: Math.random() < 0.86 ? 0.7 + Math.random() * 0.7 : 1.5 + Math.random() * 1.1,
        tw: Math.random() * TAU,
        sp: 0.4 + Math.random() * 0.8
      });
    }
  }

  function buildDust() {
    dust = [];
    if (reduceMotion) return;
    for (var i = 0; i < 96; i++) {
      dust.push({
        a: Math.random() * TAU,
        r: R_OUT * (1.02 + Math.random() * 0.85),
        sp: 0.0016 + Math.random() * 0.0034,
        vin: 0.06 + Math.random() * 0.16,
        size: 0.6 + Math.random() * 1.5,
        al: 0.14 + Math.random() * 0.4
      });
    }
  }

  /* An annular sector, inset by a constant number of pixels on all four sides.
   * The angular inset has to be divided by the radius or the gap looks huge at
   * the rim and closes up entirely near the core. */
  function cellPath(r0, r1, a0, a1, inset) {
    var ri = r0 + inset;
    var ro = Math.max(ri + 0.5, r1 - inset);
    var mid = (ri + ro) / 2;
    var da = inset / Math.max(8, mid);
    var ai = a0 + da;
    var ao = Math.max(ai + 0.004, a1 - da);
    ctx.beginPath();
    ctx.arc(cx, cy, ro, ai, ao);
    ctx.arc(cx, cy, ri, ao, ai, true);
    ctx.closePath();
    return { ri: ri, ro: ro, ai: ai, ao: ao };
  }

  function drawCell(fr, sector, hue, heat, emissive) {
    var h = ringH();
    var r0 = R_CORE + fr * h;
    var r1 = r0 + h;
    var a0 = sector * SECTOR_A - Math.PI / 2;
    var a1 = a0 + SECTOR_A;
    var geo = cellPath(r0, r1, a0, a1, 1.8);

    var c = emissive ? hue : cooled(hue);
    // Keep the lift small and push SATURATION rather than lightness for hot
    // cells — raising lightness alone just bleaches them to white glass and
    // the piece loses its colour exactly when you most need to read it.
    var lift = heat * 9;
    var sat = emissive ? Math.min(100, c.s + 14) : c.s;

    // Lit from the core: the inner edge is bright, the outer edge falls away.
    var g = ctx.createRadialGradient(cx, cy, geo.ri, cx, cy, geo.ro);
    g.addColorStop(0, hsl(c.h, sat, Math.min(82, c.l + 19 + lift), 1));
    g.addColorStop(0.52, hsl(c.h, sat, Math.min(76, c.l + 4 + lift * 0.5), 1));
    g.addColorStop(1, hsl(c.h, sat * 0.92, Math.max(11, c.l - 17 + lift * 0.2), 1));
    ctx.fillStyle = g;
    ctx.fill();

    // rim light along the core-facing edge — the single strongest depth cue
    ctx.beginPath();
    ctx.arc(cx, cy, geo.ri + 0.7, geo.ai + 0.006, geo.ao - 0.006);
    ctx.strokeStyle = hsl(c.h, Math.min(100, sat + 10), Math.min(90, c.l + 28 + lift), 0.9);
    ctx.lineWidth = 1.4;
    ctx.stroke();

    // and a dark lip on the shadowed outer edge
    ctx.beginPath();
    ctx.arc(cx, cy, geo.ro - 0.6, geo.ai + 0.01, geo.ao - 0.01);
    ctx.strokeStyle = "rgba(6,4,12,0.5)";
    ctx.lineWidth = 1.1;
    ctx.stroke();
  }

  function glowCell(fr, sector, hue, amount) {
    if (amount <= 0.01) return;
    var h = ringH();
    var r0 = R_CORE + fr * h;
    cellPath(r0, r0 + h, sector * SECTOR_A - Math.PI / 2,
             sector * SECTOR_A - Math.PI / 2 + SECTOR_A, 0.6);
    // additive, so keep it low — this stacks on top of an already-bright fill
    ctx.fillStyle = hsl(hue.h, Math.min(100, hue.s + 16), 64, 0.1 * amount);
    ctx.fill();
  }

  function drawBackdrop() {
    var g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(W, H) * 0.78);
    g.addColorStop(0, "#140c1e");
    g.addColorStop(0.42, "#0c0718");
    g.addColorStop(1, "#04030a");
    ctx.fillStyle = g;
    // oversized so a screen-shake translate never exposes an unpainted edge
    ctx.fillRect(-14, -14, W + 28, H + 28);
  }

  function drawStars(time) {
    var spin = reduceMotion ? 0 : time * 0.000012;
    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      var a = s.a + spin * s.sp;
      var x = cx + Math.cos(a) * s.r;
      var y = cy + Math.sin(a) * s.r;
      if (x < -4 || x > W + 4 || y < -4 || y > H + 4) continue;
      var tw = reduceMotion ? 0.7 : 0.5 + 0.5 * Math.sin(time * 0.0013 * s.sp + s.tw);
      ctx.fillStyle = "rgba(232,226,255," + (0.18 + tw * 0.42) + ")";
      ctx.beginPath();
      ctx.arc(x, y, s.size, 0, TAU);
      ctx.fill();
    }
  }

  function drawDust(time, dt) {
    if (reduceMotion) return;
    ctx.globalCompositeOperation = "lighter";
    for (var i = 0; i < dust.length; i++) {
      var d = dust[i];
      d.a += d.sp * (dt / 16.67);
      d.r -= d.vin * (dt / 16.67);
      if (d.r < R_OUT * 0.99) {
        // swallowed by the disk; a fresh mote drifts in from outside
        d.r = R_OUT * (1.5 + Math.random() * 0.6);
        d.a = Math.random() * TAU;
      }
      var x = cx + Math.cos(d.a) * d.r;
      var y = cy + Math.sin(d.a) * d.r;
      var fade = Math.min(1, (d.r - R_OUT) / (R_OUT * 0.5));
      ctx.fillStyle = "rgba(255,196,126," + (d.al * (0.3 + fade * 0.7)) + ")";
      ctx.beginPath();
      ctx.arc(x, y, d.size, 0, TAU);
      ctx.fill();
    }
    ctx.globalCompositeOperation = "source-over";
  }

  function drawGuides(fill) {
    var h = ringH();
    // strong enough that the empty disk reads as ground you can still fill
    ctx.strokeStyle = "rgba(168,148,218,0.15)";
    ctx.lineWidth = 1;
    for (var r = 0; r <= RINGS; r++) {
      ctx.beginPath();
      ctx.arc(cx, cy, R_CORE + r * h, 0, TAU);
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(168,148,218,0.1)";
    for (var s = 0; s < SECTORS; s++) {
      var a = s * SECTOR_A - Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * R_CORE, cy + Math.sin(a) * R_CORE);
      ctx.lineTo(cx + Math.cos(a) * R_OUT, cy + Math.sin(a) * R_OUT);
      ctx.stroke();
    }

    // the rim reddens as the disk backs up toward it
    if (dangerPulse > 0.01) {
      ctx.beginPath();
      ctx.arc(cx, cy, R_OUT + 1.5, 0, TAU);
      ctx.strokeStyle = "rgba(255,88,72," + (0.16 + dangerPulse * 0.42) + ")";
      ctx.lineWidth = 2 + dangerPulse * 2.4;
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(cx, cy, R_OUT + 1.5, 0, TAU);
      ctx.strokeStyle = "rgba(180,158,232,0.14)";
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }
  }

  function drawCore(time, fill) {
    var pulse = corePulse;
    var breathe = reduceMotion ? 0 : Math.sin(time * 0.0016) * 0.03 + Math.sin(time * 0.0041) * 0.017;
    var r = R_CORE * (0.94 + breathe + pulse * 0.2);
    // a full disk drives the star angry
    var heat = Math.min(1, fill * 1.15);
    var hIn = 46 - heat * 14;
    var hOut = 30 - heat * 22;

    // A defined body with a soft edge — the bloom pass does the spill, so the
    // star itself should read as an object, not a smudge.
    var g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, "rgba(255,253,246,0.99)");
    g.addColorStop(0.44, hsl(hIn, 100, 86 + pulse * 8, 0.99));
    g.addColorStop(0.76, hsl(hOut, 97, 58 + pulse * 12, 0.88));
    g.addColorStop(0.93, hsl(Math.max(6, hOut - 8), 94, 44, 0.34));
    g.addColorStop(1, hsl(Math.max(4, hOut - 10), 92, 40, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, TAU);
    ctx.fill();
  }

  function drawCoreBloom(time, fill) {
    ctx.globalCompositeOperation = "lighter";
    var pulse = corePulse + coreFlash;
    // reaches past the first ring so the star visibly lights the debris nearest
    // it, instead of leaving a dark moat between the core and the disk
    var rr = R_CORE * (2.2 + pulse * 1.6);
    var g = ctx.createRadialGradient(cx, cy, R_CORE * 0.4, cx, cy, rr);
    var a = 0.32 + pulse * 0.5;
    g.addColorStop(0, "rgba(255,214,150," + a * 0.8 + ")");
    g.addColorStop(0.3, "rgba(255,176,92," + a * 0.4 + ")");
    g.addColorStop(0.62, "rgba(255,140,54," + a * 0.15 + ")");
    g.addColorStop(1, "rgba(255,110,40,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, rr, 0, TAU);
    ctx.fill();

    // shock ring on a clear
    if (coreFlash > 0.02) {
      var sr = R_CORE + (1 - coreFlash) * (R_OUT - R_CORE) * 1.35;
      ctx.beginPath();
      ctx.arc(cx, cy, sr, 0, TAU);
      ctx.strokeStyle = "rgba(255,236,196," + coreFlash * 0.5 + ")";
      ctx.lineWidth = 1 + coreFlash * 5;
      ctx.stroke();
    }
    ctx.globalCompositeOperation = "source-over";
  }

  function drawSparks() {
    ctx.globalCompositeOperation = "lighter";
    for (var i = 0; i < sparks.length; i++) {
      var p = sparks[i];
      ctx.fillStyle = hsl(p.h, p.s, p.l, Math.max(0, p.life) * 0.85);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (0.4 + p.life * 0.8), 0, TAU);
      ctx.fill();
    }
    ctx.globalCompositeOperation = "source-over";
  }

  function drawLanding() {
    if (!piece || phase !== "falling") return;
    var lr = landingRing();
    if (lr >= piece.ring - 0.01 && Math.abs(visR - piece.ring) < 0.05) return;
    var h = ringH();
    var pulse = reduceMotion ? 0.6 : 0.45 + 0.25 * Math.sin(tNow * 0.006);
    for (var i = 0; i < piece.cells.length; i++) {
      var r = lr + piece.cells[i][0];
      var s = mod(piece.sector + piece.cells[i][1], SECTORS);
      var r0 = R_CORE + r * h;
      var a0 = s * SECTOR_A - Math.PI / 2;
      cellPath(r0, r0 + h, a0, a0 + SECTOR_A, 3);
      // needs enough body to read as a lit target — at a whisper the outline
      // alone makes the empty cells look like a hole punched in the disk
      ctx.fillStyle = "rgba(255,176,86," + (0.09 + pulse * 0.05) + ")";
      ctx.fill();
      ctx.strokeStyle = "rgba(255,206,138," + pulse * 0.85 + ")";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  function drawPiece() {
    if (!piece) return;
    var hue = HUES[piece.hueIdx];
    var i;
    for (i = 0; i < piece.cells.length; i++) {
      drawCell(visR + piece.cells[i][0], mod(piece.sector + piece.cells[i][1], SECTORS), hue, 1, true);
    }
    ctx.globalCompositeOperation = "lighter";
    for (i = 0; i < piece.cells.length; i++) {
      glowCell(visR + piece.cells[i][0], mod(piece.sector + piece.cells[i][1], SECTORS), hue, 0.9);
    }
    ctx.globalCompositeOperation = "source-over";
  }

  function drawDisk() {
    // During a collapse the grid has already changed, so render the snapshot
    // and slide each surviving ring inward by how many cleared rings sat inside
    // it. That is what makes the stack visibly fall into the hole.
    var src = collapse ? collapse.snapshot : grid;
    var ease = collapse ? easeOutCubic(Math.min(1, collapse.t / collapse.dur)) : 0;
    var hot = [];

    for (var r = 0; r < RINGS; r++) {
      var shift = 0, gone = false;
      if (collapse) {
        if (collapse.cleared.indexOf(r) !== -1) gone = true;
        for (var c = 0; c < collapse.cleared.length; c++) if (collapse.cleared[c] < r) shift++;
      }
      var fr = r - shift * ease;

      for (var s = 0; s < SECTORS; s++) {
        var cell = src[r] && src[r][s];
        if (!cell) continue;
        if (gone) {
          // the cleared ring flares white and shrinks into the star
          ctx.save();
          ctx.globalAlpha = 1 - ease;
          drawCell(r - ease * (r + 0.9), s, { h: 44, s: 100, l: 62 + ease * 30 }, 1, true);
          ctx.restore();
          continue;
        }
        drawCell(fr, s, cell.hue, cell.heat, false);
        if (cell.heat > 0.02) hot.push([fr, s, cell.hue, cell.heat]);
      }
    }

    if (hot.length) {
      ctx.globalCompositeOperation = "lighter";
      for (var i = 0; i < hot.length; i++) glowCell(hot[i][0], hot[i][1], hot[i][2], hot[i][3]);
      ctx.globalCompositeOperation = "source-over";
    }
  }

  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

  function fillFraction() {
    var n = 0;
    for (var r = 0; r < RINGS; r++) for (var s = 0; s < SECTORS; s++) if (grid[r][s]) n++;
    return n / (RINGS * SECTORS);
  }

  function outerOccupancy() {
    var n = 0;
    for (var s = 0; s < SECTORS; s++) if (grid[RINGS - 1][s]) n++;
    return n / SECTORS;
  }

  function render(time, dt) {
    ctx.save();
    if (shake > 0.05) {
      ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    }

    var fill = fillFraction();
    drawBackdrop();
    drawStars(time);
    drawDust(time, dt);
    drawGuides(fill);
    drawCore(time, fill);
    drawDisk();
    drawLanding();
    drawPiece();
    drawCoreBloom(time, fill);
    drawSparks();

    ctx.restore();

    if (paused && phase === "falling") {
      ctx.fillStyle = "rgba(6,4,13,0.7)";
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "rgba(244,238,230,0.8)";
      ctx.font = "600 15px 'Geist Mono', ui-monospace, Menlo, monospace";
      ctx.textAlign = "center";
      ctx.fillText("PAUSED", cx, cy);
      ctx.font = "400 10px 'Geist Mono', ui-monospace, Menlo, monospace";
      ctx.fillStyle = "rgba(244,238,230,0.4)";
      ctx.fillText("PRESS P TO RESUME", cx, cy + 22);
      ctx.textAlign = "start";
    }
  }

  // ------------------------------------------------------- next-piece inset

  var nextCanvas, nctx;

  function drawNext() {
    if (!nctx || !nextPiece) return;
    var w = nextCanvas.width, h = nextCanvas.height;
    nctx.clearRect(0, 0, w, h);

    // Same annular language as the board, on a small virtual disk whose centre
    // sits below the canvas — a flat grid preview would misrepresent the game.
    var ncx = w / 2, ncy = h * 1.16;
    var nCore = h * 0.42, nRing = h * 0.15, nA = 0.30;

    var cells = nextPiece.cells;
    var maxS = 0;
    cells.forEach(function (c) { maxS = Math.max(maxS, c[1]); });
    var span = maxS + 1;
    var hue = nextPiece.hueIdx;
    var c0 = HUES[hue];

    for (var i = 0; i < cells.length; i++) {
      var r0 = nCore + cells[i][0] * nRing;
      var r1 = r0 + nRing;
      var a0 = -Math.PI / 2 + (cells[i][1] - span / 2) * nA;
      var a1 = a0 + nA;
      var ri = r0 + 1.4, ro = r1 - 1.4;
      var da = 1.4 / ((ri + ro) / 2);

      nctx.beginPath();
      nctx.arc(ncx, ncy, ro, a0 + da, a1 - da);
      nctx.arc(ncx, ncy, ri, a1 - da, a0 + da, true);
      nctx.closePath();

      var g = nctx.createRadialGradient(ncx, ncy, ri, ncx, ncy, ro);
      g.addColorStop(0, hsl(c0.h, c0.s, Math.min(92, c0.l + 22), 1));
      g.addColorStop(1, hsl(c0.h, c0.s * 0.9, Math.max(8, c0.l - 16), 1));
      nctx.fillStyle = g;
      nctx.fill();

      nctx.beginPath();
      nctx.arc(ncx, ncy, ri + 0.6, a0 + da + 0.01, a1 - da - 0.01);
      nctx.strokeStyle = hsl(c0.h, c0.s + 10, Math.min(96, c0.l + 34), 0.85);
      nctx.lineWidth = 1.2;
      nctx.stroke();
    }
  }

  // ------------------------------------------------------------------ loop

  var held = { left: 0, right: 0, down: 0 };
  var DAS = 155, ARR = 48;

  function stepInput(dt) {
    ["left", "right"].forEach(function (k) {
      if (held[k] <= 0) return;
      held[k] += dt;
      var dir = k === "left" ? -1 : 1;
      // charge past DAS, then repeat every ARR
      while (held[k] >= DAS + ARR) { held[k] -= ARR; tryOrbit(dir); }
    });
  }

  function update(dt) {
    if (phase === "collapsing") {
      collapse.t += dt;
      if (collapse.t >= collapse.dur) endCollapse();
    } else if (phase === "falling" && piece) {
      if (attract) stepAttract(dt);
      else stepInput(dt);

      var iv = fallInterval();
      if (held.down > 0) iv = Math.min(iv, 42);

      fallT += dt;
      while (fallT >= iv) {
        fallT -= iv;
        if (stepIn()) {
          if (held.down > 0) addScore(1);
        } else {
          // grounded: drop the remainder so a rotate into a gap does not
          // instantly fall several rings on the next frame
          fallT = 0;
          break;
        }
      }

      if (grounded()) {
        lockT += dt;
        if (lockT >= LOCK_MS) lockPiece();
      } else {
        lockT = 0;
      }
    }

    // smooth the radius so falling reads as motion, not teleporting
    if (piece) {
      var target = piece.ring;
      var tau = Math.max(28, Math.min(60, fallInterval() * 0.34));
      visR += (target - visR) * (1 - Math.exp(-dt / tau));
      if (Math.abs(visR - target) < 0.004) visR = target;
    }

    // cool the freshly placed cells
    var k = dt / 16.67;
    for (var r = 0; r < RINGS; r++) {
      for (var s = 0; s < SECTORS; s++) {
        var c = grid[r][s];
        if (c && c.heat > 0) c.heat = Math.max(0, c.heat - 0.022 * k);
      }
    }

    coreFlash = Math.max(0, coreFlash - 0.03 * k);
    corePulse = Math.max(0, corePulse - 0.018 * k);
    shake *= Math.pow(0.86, k);
    if (shake < 0.05) shake = 0;

    var occ = outerOccupancy();
    var wantDanger = occ > 0.25 ? Math.min(1, (occ - 0.25) / 0.5) : 0;
    dangerPulse += (wantDanger - dangerPulse) * Math.min(1, 0.08 * k);

    stepSparks(dt);
  }

  var tensionT = 0;
  function frame(time) {
    if (!t0) t0 = time;
    var dt = tNow ? Math.min(50, time - tNow) : 16.7;
    tNow = time;

    if (!paused && phase !== "idle" && phase !== "over") update(dt);
    else if (phase === "over" || phase === "idle") { stepSparks(dt); shake *= 0.9; coreFlash = Math.max(0, coreFlash - 0.02); corePulse = Math.max(0, corePulse - 0.014); }

    render(time, dt);

    tensionT += dt;
    if (tensionT > 400 && phase === "falling") {
      tensionT = 0;
      audio.setTension(fillFraction());
    }

    requestAnimationFrame(frame);
  }

  // ------------------------------------------------------------- game flow

  function startAttract() {
    attract = true;
    grid = blankGrid();
    sparks = []; bag = []; ai = null; aiT = 0;
    score = 0; ringsCleared = 0; level = 1;
    lastSector = 0; collapse = null;
    nextPiece = makePiece();
    phase = "falling";
    spawn();
  }

  function startGame() {
    attract = false;
    ai = null;
    held.left = 0; held.right = 0; held.down = 0;
    grid = blankGrid();
    sparks = [];
    bag = [];
    score = 0; ringsCleared = 0; level = 1;
    lastSector = 0;
    collapse = null;
    coreFlash = 0; corePulse = 0; shake = 0; dangerPulse = 0;
    paused = false;
    nextPiece = makePiece();
    phase = "falling";

    document.body.classList.add("is-playing");
    if (hudEl) hudEl.hidden = false;
    if (nextEl) nextEl.hidden = false;
    if (overlay) overlay.hidden = true;
    syncHud();

    audio.unlock();
    audio.startHum();
    spawn();

    if (hintEl) setTimeout(function () { hintEl.classList.add("is-gone"); }, 4200);
    track("game_start", { toy: "accretion" });
  }

  function gameOver() {
    // the demo never dies — it just starts a fresh disk and keeps going
    if (attract) {
      grid = blankGrid();
      sparks = []; bag = []; ai = null;
      score = 0; ringsCleared = 0; level = 1;
      coreFlash = 0; corePulse = 0; shake = 0; dangerPulse = 0;
      nextPiece = makePiece();
      spawn();
      return;
    }

    phase = "over";
    piece = null;
    document.body.classList.remove("is-playing");
    audio.stopHum(true);
    audio.gameOver();
    shake = reduceMotion ? 0 : 7;

    if (score > best) {
      best = score;
      try { localStorage.setItem(BEST_KEY, String(best)); } catch (e) {}
    }
    syncHud();

    if (ovEyebrow) ovEyebrow.textContent = ringsCleared + (ringsCleared === 1 ? " ring collapsed" : " rings collapsed");
    if (ovTitle) ovTitle.textContent = score.toLocaleString();
    if (ovText) {
      ovText.innerHTML = score >= best && score > 0
        ? "A new best. The disk reached the rim — but you fed the star <b>" + ringsCleared + "</b> " +
          (ringsCleared === 1 ? "ring" : "rings") + " first."
        : "The disk backed up to the rim. Best so far is <b>" + best.toLocaleString() + "</b>.";
    }
    if (ovBtn) ovBtn.textContent = "Again";
    if (ovKeys) ovKeys.textContent = "drag to orbit · tap to rotate · swipe down to drop";
    if (hudEl) hudEl.hidden = true;
    if (nextEl) nextEl.hidden = true;
    if (overlay) overlay.hidden = false;

    track("game_over", { toy: "accretion", value: score, rings: ringsCleared });
  }

  function togglePause() {
    if (attract || phase !== "falling") return;
    paused = !paused;
    if (paused) audio.stopHum(false);
    else { audio.unlock(); audio.startHum(); }
  }

  function track(name, params) {
    try { if (window.gtag) window.gtag("event", name, params || {}); } catch (e) {}
  }

  // ----------------------------------------------------------------- input

  function onKeyDown(e) {
    var k = e.key;
    if (attract || phase === "idle" || phase === "over") {
      if (k === " " || k === "Enter") { e.preventDefault(); startGame(); }
      return;
    }
    switch (k) {
      case "ArrowLeft": case "a": case "A":
        e.preventDefault(); if (!paused && held.left <= 0) { held.left = 1; tryOrbit(-1); } break;
      case "ArrowRight": case "d": case "D":
        e.preventDefault(); if (!paused && held.right <= 0) { held.right = 1; tryOrbit(1); } break;
      case "ArrowUp": case "w": case "W": case "x": case "X":
        e.preventDefault(); if (!paused) tryRotate(1); break;
      case "z": case "Z":
        e.preventDefault(); if (!paused) tryRotate(-1); break;
      case "ArrowDown": case "s": case "S":
        e.preventDefault(); if (!paused) held.down = 1; break;
      case " ":
        e.preventDefault(); if (!paused) hardDrop(); break;
      case "p": case "P": case "Escape":
        e.preventDefault(); togglePause(); break;
    }
  }

  function onKeyUp(e) {
    switch (e.key) {
      case "ArrowLeft": case "a": case "A": held.left = 0; break;
      case "ArrowRight": case "d": case "D": held.right = 0; break;
      case "ArrowDown": case "s": case "S": held.down = 0; break;
    }
  }

  /* Touch: horizontal drag orbits (relative, so it stays precise no matter
   * where on screen the thumb is), a tap rotates, a downward hold soft-drops,
   * and a flick down hard-drops. The flick uses PEAK velocity over a short
   * window, not the final delta — a thumb decelerates before it lifts, so the
   * last sample always under-reads the throw. */
  var ptr = null;
  var ORBIT_PX = 26;

  function onPointerDown(e) {
    if (attract || phase !== "falling" || paused) return;
    canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
    ptr = {
      id: e.pointerId,
      x0: e.clientX, y0: e.clientY,
      lx: e.clientX, ly: e.clientY,
      t0: performance.now(), lt: performance.now(),
      acc: 0, moved: false, soft: false, samples: []
    };
  }

  function onPointerMove(e) {
    if (!ptr || e.pointerId !== ptr.id) return;
    var now = performance.now();
    var dx = e.clientX - ptr.lx;
    var dy = e.clientY - ptr.ly;
    var dt = Math.max(1, now - ptr.lt);

    ptr.samples.push({ t: now, vy: dy / dt });
    while (ptr.samples.length && now - ptr.samples[0].t > 130) ptr.samples.shift();

    ptr.lx = e.clientX; ptr.ly = e.clientY; ptr.lt = now;

    var totalX = e.clientX - ptr.x0;
    var totalY = e.clientY - ptr.y0;
    if (Math.abs(totalX) > 10 || Math.abs(totalY) > 10) ptr.moved = true;

    ptr.acc += dx;
    while (Math.abs(ptr.acc) >= ORBIT_PX) {
      var dir = ptr.acc > 0 ? 1 : -1;
      ptr.acc -= dir * ORBIT_PX;
      tryOrbit(dir);
    }

    // hold downward to soft drop, but only if the gesture is clearly vertical
    var wantSoft = totalY > 55 && totalY > Math.abs(totalX) * 1.2;
    if (wantSoft !== ptr.soft) {
      ptr.soft = wantSoft;
      held.down = wantSoft ? 1 : 0;
    }
  }

  function onPointerUp(e) {
    if (!ptr || e.pointerId !== ptr.id) return;
    var dur = performance.now() - ptr.t0;
    var totalX = e.clientX - ptr.x0;
    var totalY = e.clientY - ptr.y0;

    var peak = 0;
    for (var i = 0; i < ptr.samples.length; i++) peak = Math.max(peak, ptr.samples[i].vy);

    held.down = 0;

    if (!ptr.moved && dur < 280) {
      tryRotate(1);
    } else if (peak > 1.35 && totalY > 50 && totalY > Math.abs(totalX)) {
      hardDrop();
    }
    ptr = null;
  }

  // ------------------------------------------------------------------ boot

  function init() {
    canvas = document.getElementById("canvas");
    if (!canvas) return;
    ctx = canvas.getContext("2d");

    nextCanvas = document.getElementById("nextCanvas");
    if (nextCanvas) nctx = nextCanvas.getContext("2d");

    scoreEl = document.getElementById("score");
    ringsEl = document.getElementById("rings");
    bestEl = document.getElementById("best");
    hudEl = document.getElementById("hud");
    nextEl = document.getElementById("next");
    hintEl = document.getElementById("hint");
    overlay = document.getElementById("overlay");
    ovTitle = document.getElementById("ovTitle");
    ovText = document.getElementById("ovText");
    ovBtn = document.getElementById("ovBtn");
    ovEyebrow = document.getElementById("ovEyebrow");
    ovKeys = document.getElementById("ovKeys");

    try { best = parseInt(localStorage.getItem(BEST_KEY), 10) || 0; } catch (e) { best = 0; }

    grid = blankGrid();
    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("orientationchange", function () { setTimeout(resize, 120); });

    if (ovBtn) ovBtn.addEventListener("click", function () { audio.unlock(); startGame(); });

    // spell the controls in whichever language this device speaks
    var coarse = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
    if (!coarse) {
      if (ovKeys) ovKeys.textContent = "← → orbit · ↑ rotate · ↓ soft drop · space to slam · p to pause";
      if (hintEl) hintEl.textContent = "← → orbit · ↑ rotate · space to slam";
    }

    var soundBtn = document.getElementById("soundBtn");
    if (soundBtn) {
      soundBtn.setAttribute("aria-pressed", audio.on ? "true" : "false");
      soundBtn.addEventListener("click", function () {
        audio.unlock();
        var v = !audio.on;
        audio.setOn(v);
        soundBtn.setAttribute("aria-pressed", v ? "true" : "false");
        if (v && phase === "falling" && !paused) audio.startHum();
        if (!v) audio.stopHum(false);
      });
    }

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);

    document.addEventListener("visibilitychange", function () {
      if (document.hidden && !attract && phase === "falling" && !paused) togglePause();
    });

    startAttract();
    requestAnimationFrame(frame);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
