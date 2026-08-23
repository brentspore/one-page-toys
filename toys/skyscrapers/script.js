/* Skyscrapers — a Latin-square logic puzzle played as a city at night.
 *
 * The rule that makes it a toy rather than a form: the numbers ARE building
 * heights. An edge clue counts the towers you can see looking down that line,
 * because a taller tower hides every shorter one behind it — so verification is
 * something you look at, not something you recall. Tap an edge number and a beam
 * sweeps the line, lighting what is seen and dimming what is hidden.
 */
(function () {
  "use strict";

  var canvas = document.getElementById("canvas");
  var ctx = canvas.getContext("2d");
  var hud = document.getElementById("hud");
  var bar = document.getElementById("bar");
  var filledEl = document.getElementById("filled");
  var timeEl = document.getElementById("time");
  var bestEl = document.getElementById("best");
  var calloutEl = document.getElementById("callout");
  var soundBtn = document.getElementById("soundBtn");
  var overlay = document.getElementById("overlay");
  var ovEyebrow = document.getElementById("ovEyebrow");
  var ovTitle = document.getElementById("ovTitle");
  var ovText = document.getElementById("ovText");
  var ovBtn = document.getElementById("ovBtn");
  var ovDemo = document.getElementById("ovDemo");
  var hintEl = document.getElementById("hint");

  /* ------------------------------------------------------------------ core
   * Generation and solving. Kept whole and DOM-free — it was written and proven
   * in node before any of this drew a pixel.
   *
   * ⚠ The load-bearing idea: if arc consistency drives every cell to a single
   * candidate, the puzzle is BOTH uniquely solvable and solvable without
   * guessing. Every line still has a surviving permutation, and it can only be
   * the singleton assignment, so that assignment is a solution and nothing else
   * fits the domains. One cheap propagation pass therefore replaces an
   * exponential solution count that took ten seconds on a 6x6.
   */
  function SkyCore(n) {
    var FULL = 0; for (var v = 1; v <= n; v++) FULL |= (1 << v);

    var perms = [], cur = [], used = new Array(n + 1).fill(false);
    (function rec() {
      if (cur.length === n) { perms.push(cur.slice()); return; }
      for (var v2 = 1; v2 <= n; v2++) if (!used[v2]) { used[v2] = true; cur.push(v2); rec(); cur.pop(); used[v2] = false; }
    })();
    var P = perms.length;

    var pmask = new Int32Array(P * n), visF = new Int8Array(P), visB = new Int8Array(P);
    for (var i = 0; i < P; i++) {
      var p = perms[i], mf = 0, cf = 0, mb = 0, cb = 0;
      for (var j = 0; j < n; j++) {
        pmask[i * n + j] = 1 << p[j];
        if (p[j] > mf) { mf = p[j]; cf++; }
        var q = p[n - 1 - j]; if (q > mb) { mb = q; cb++; }
      }
      visF[i] = cf; visB[i] = cb;
    }

    function visible(seq) { var m = 0, c = 0; for (var k = 0; k < seq.length; k++) if (seq[k] > m) { m = seq[k]; c++; } return c; }
    function shuffle(a, rnd) { for (var k = a.length - 1; k > 0; k--) { var j = (rnd() * (k + 1)) | 0, t = a[k]; a[k] = a[j]; a[j] = t; } return a; }

    function randomLatin(rnd) {
      var rows = [], colUsed = new Int32Array(n);
      function rec2(r) {
        if (r === n) return true;
        var cand = [];
        for (var k = 0; k < P; k++) {
          var ok = true;
          for (var c = 0; c < n; c++) if (colUsed[c] & pmask[k * n + c]) { ok = false; break; }
          if (ok) cand.push(k);
        }
        shuffle(cand, rnd);
        for (var a = 0; a < cand.length; a++) {
          var pi = cand[a];
          for (var c2 = 0; c2 < n; c2++) colUsed[c2] |= pmask[pi * n + c2];
          rows.push(perms[pi]);
          if (rec2(r + 1)) return true;
          rows.pop();
          for (var c3 = 0; c3 < n; c3++) colUsed[c3] &= ~pmask[pi * n + c3];
        }
        return false;
      }
      return rec2(0) ? rows : null;
    }

    function cluesOf(g) {
      var C = { top: [], bottom: [], left: [], right: [] };
      for (var r = 0; r < n; r++) { C.left.push(visible(g[r])); C.right.push(visible(g[r].slice().reverse())); }
      for (var c = 0; c < n; c++) {
        var col = []; for (var r2 = 0; r2 < n; r2++) col.push(g[r2][c]);
        C.top.push(visible(col)); C.bottom.push(visible(col.slice().reverse()));
      }
      return C;
    }

    function lineCands(a, b) {
      var out = [];
      for (var k = 0; k < P; k++) if ((!a || visF[k] === a) && (!b || visB[k] === b)) out.push(k);
      return out;
    }

    function logicSolve(C) {
      var dom = new Int32Array(n * n).fill(FULL);
      var lines = [], cellsOf = [];
      for (var r = 0; r < n; r++) {
        var cs = new Int32Array(n); for (var c = 0; c < n; c++) cs[c] = r * n + c;
        lines.push(lineCands(C.left[r], C.right[r])); cellsOf.push(cs);
      }
      for (var c2 = 0; c2 < n; c2++) {
        var cs2 = new Int32Array(n); for (var r2 = 0; r2 < n; r2++) cs2[r2] = r2 * n + c2;
        lines.push(lineCands(C.top[c2], C.bottom[c2])); cellsOf.push(cs2);
      }
      var un = new Int32Array(n);
      for (var pass = 0; pass < 200; pass++) {
        var changed = false;
        for (var L2 = 0; L2 < lines.length; L2++) {
          var cand = lines[L2], cells = cellsOf[L2], w = 0;
          un.fill(0);
          for (var a = 0; a < cand.length; a++) {
            var base = cand[a] * n, ok = true;
            for (var j = 0; j < n; j++) if (!(dom[cells[j]] & pmask[base + j])) { ok = false; break; }
            if (!ok) continue;
            cand[w++] = cand[a];
            for (var j2 = 0; j2 < n; j2++) un[j2] |= pmask[base + j2];
          }
          if (!w) return null;
          cand.length = w;
          for (var j3 = 0; j3 < n; j3++) {
            var nd = dom[cells[j3]] & un[j3];
            if (!nd) return null;
            if (nd !== dom[cells[j3]]) { dom[cells[j3]] = nd; changed = true; }
          }
        }
        if (!changed) break;
      }
      var out = [];
      for (var r3 = 0; r3 < n; r3++) {
        out.push([]);
        for (var c3 = 0; c3 < n; c3++) {
          var d = dom[r3 * n + c3];
          if (d & (d - 1)) return null;
          out[r3].push(31 - Math.clz32(d));
        }
      }
      return out;
    }

    /* `floor` stops the stripping early. Minimal-under-propagation is legal but
     * brutal: the solver intersects every permutation of a line at once, which
     * is far more than a person holds in their head, so a puzzle it can still
     * crack can feel like guesswork. Leaving clues in keeps the chains short. */
    function generate(rnd, floorCount) {
      for (var attempt = 0; attempt < 400; attempt++) {
        var g = randomLatin(rnd);
        if (!g) continue;
        var C = cluesOf(g);
        if (!logicSolve(C)) continue;
        var slots = [];
        ["top", "bottom", "left", "right"].forEach(function (s) { for (var i2 = 0; i2 < n; i2++) slots.push([s, i2]); });
        shuffle(slots, rnd);
        var live = 4 * n;
        for (var k = 0; k < slots.length && live > (floorCount || 0); k++) {
          var side = slots[k][0], ix = slots[k][1], keep = C[side][ix];
          if (!keep) continue;
          C[side][ix] = 0;
          if (!logicSolve(C)) C[side][ix] = keep;   // that clue was carrying a deduction
          else live--;
        }
        return { grid: g, clues: C };
      }
      return null;
    }

    return { visible: visible, generate: generate };
  }

  var CORES = {};
  function coreFor(n) { if (!CORES[n]) CORES[n] = SkyCore(n); return CORES[n]; }
  var FLOORS = { 4: 5, 5: 9, 6: 14 };

  /* ----------------------------------------------------------------- state */
  var G = {
    n: 5, clues: null, sol: null, cell: null,
    sel: { r: -1, c: -1 }, hasSel: false,
    started: false, solved: false,
    t0: 0, elapsed: 0,
    sweep: null,            // { side, i, t, count }
    winT: 0,
    bump: null              // per-cell placement bounce, keyed r*n+c
  };
  var best = {};
  ["4", "5", "6"].forEach(function (k) {
    try { var v = parseInt(localStorage.getItem("sky_best_" + k), 10); if (v > 0) best[k] = v; } catch (e) {}
  });
  try { var sz = parseInt(localStorage.getItem("sky_size"), 10); if (sz >= 4 && sz <= 6) G.n = sz; } catch (e) {}

  /* ---------------------------------------------------------------- layout
   * Everything scales off one tile size, and every constant below is expressed
   * in tiles so the whole diorama is resolution independent.
   *
   * ⚠ HU (one storey) is DERIVED, not chosen: a tower of height 1 standing
   * behind a tower of height n must still show its roof, which needs
   * HU*(n-1) < DEPTH. Pick a taller storey and the back row simply vanishes
   * behind the front one and the puzzle becomes unreadable.
   */
  var FOOT = 0.19;
  var L = { TS: 60, SKEW: 0, DEPTH: 0, HU: 0, ox: 0, oy: 0, chip: 18, topClueY: 0,
            sk: 0.26, dp: 0.74, cm: 0.62, W: 0, H: 0, dpr: 1 };

  function proj(gx, gy, h) {
    return { x: L.ox + gx * L.TS + gy * L.SKEW, y: L.oy + gy * L.DEPTH - h * L.HU };
  }

  function derive(ts) {
    L.TS = ts; L.SKEW = ts * L.sk; L.DEPTH = ts * L.dp;
    L.HU = (ts * L.dp) / (G.n - 1) * 0.9;
    L.chip = Math.max(11, ts * 0.29);
  }

  // Extents with the origin at 0,0 — everything is linear in ts, so one pass
  // measures the shape and a single scale lands it in the box.
  function extents() {
    var n = G.n, xs = [], ys = [];
    function add(p, pad) { xs.push(p.x - pad, p.x + pad); ys.push(p.y - pad, p.y + pad); }
    add(proj(0, 0, 0), 0); add(proj(n, 0, 0), 0); add(proj(0, n, 0), 0); add(proj(n, n, 0), 0);
    var topY = proj(0.5, 0.5, n).y - L.TS * 0.46;
    for (var i = 0; i < n; i++) {
      add(proj(-L.cm, i + 0.5, 0), L.chip);
      add(proj(n + L.cm, i + 0.5, 0), L.chip);
      add(proj(i + 0.5, n + L.cm, 0), L.chip);
      var t = proj(i + 0.5, -L.cm, 0); xs.push(t.x - L.chip, t.x + L.chip); ys.push(topY - L.chip);
      add(proj(i + 0.5, 0.5, n), 0);   // a full-height tower in the back row
    }
    return { x0: Math.min.apply(null, xs), x1: Math.max.apply(null, xs),
             y0: Math.min.apply(null, ys), y1: Math.max.apply(null, ys) };
  }

  function layout() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = window.innerWidth, h = window.innerHeight;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    canvas.style.width = w + "px"; canvas.style.height = h + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    L.W = w; L.H = h; L.dpr = dpr;

    var narrow = w < 620;
    var padX = narrow ? 8 : 12;
    /* Fixed reserves are fine on a tall screen and ruinous on a short one: at
     * 360px tall they claimed 40% of the height for chrome. Scale them, with a
     * floor that still clears the toolbar. */
    var topRes = Math.max(44, Math.min(narrow ? 62 : 74, h * 0.14));
    var botRes = Math.max(102, Math.min(narrow ? 196 : 146, h * 0.24));
    var availW = w - padX * 2;
    var availH = Math.max(160, h - topRes - botRes);

    /* ⚠ A fixed camera wastes whichever dimension the phone happens to have.
     * The grid is naturally much wider than tall, so on a portrait screen it
     * was width-bound with half the height empty and cells barely 38px. Search
     * the projection instead: a deeper, less skewed diorama is taller on
     * screen, so pick the shape that lets the tiles come out biggest here. */
    L.ox = 0; L.oy = 0;
    var bestK = 0, bestDp = 0.74, bestSk = 0.26, bestCm = 0.62;
    for (var d = 0.62; d <= 1.12; d += 0.03) {
      L.dp = d;
      L.sk = Math.max(0.08, Math.min(0.28, 0.26 - (d - 0.74) * 0.34));
      L.cm = narrow ? 0.54 : 0.62;
      derive(100);
      var ee = extents();
      var kk = Math.min(availW / (ee.x1 - ee.x0), availH / (ee.y1 - ee.y0));
      if (kk > bestK) { bestK = kk; bestDp = L.dp; bestSk = L.sk; bestCm = L.cm; }
    }
    L.dp = bestDp; L.sk = bestSk; L.cm = bestCm;
    derive(Math.max(24, Math.min(132, 100 * bestK)));
    var e = extents();
    L.ox = padX + (availW - (e.x1 - e.x0)) / 2 - e.x0;
    L.oy = topRes + (availH - (e.y1 - e.y0)) / 2 - e.y0;
    L.topClueY = proj(0.5, 0.5, G.n).y - L.TS * 0.46;
  }

  function cluePos(side, i) {
    if (side === "left") return proj(-L.cm, i + 0.5, 0);
    if (side === "right") return proj(G.n + L.cm, i + 0.5, 0);
    if (side === "bottom") return proj(i + 0.5, G.n + L.cm, 0);
    var p = proj(i + 0.5, -L.cm, 0); p.y = L.topClueY; return p;
  }

  /* ------------------------------------------------------------- puzzle ops */
  function at(r, c) { return G.cell[r * G.n + c]; }
  function setAt(r, c, v) { G.cell[r * G.n + c] = v; }

  function lineCells(side, i) {
    var n = G.n, out = [], k;
    if (side === "left") for (k = 0; k < n; k++) out.push([i, k]);
    else if (side === "right") for (k = 0; k < n; k++) out.push([i, n - 1 - k]);
    else if (side === "top") for (k = 0; k < n; k++) out.push([k, i]);
    else for (k = 0; k < n; k++) out.push([n - 1 - k, i]);
    return out;
  }

  // Which towers along a sightline you would actually be able to count.
  function seenAlong(side, i) {
    var cells = lineCells(side, i), m = 0, out = [], count = 0;
    for (var k = 0; k < cells.length; k++) {
      var v = at(cells[k][0], cells[k][1]);
      var vis = v > 0 && v > m;
      if (v > m) m = v;
      out.push(vis);
      if (vis) count++;
    }
    return { cells: cells, vis: out, count: count, full: m > 0 && cells.every(function (rc) { return at(rc[0], rc[1]) > 0; }) };
  }

  function lineComplete(side, i) {
    var cells = lineCells(side, i);
    for (var k = 0; k < cells.length; k++) if (!at(cells[k][0], cells[k][1])) return false;
    return true;
  }

  // 0 = not judged yet, 1 = satisfied, -1 = broken.
  function clueState(side, i) {
    var want = G.clues[side][i];
    if (!want) return 0;
    if (!lineComplete(side, i)) return 0;
    return seenAlong(side, i).count === want ? 1 : -1;
  }

  function conflicts() {
    var n = G.n, bad = new Uint8Array(n * n);
    for (var r = 0; r < n; r++) {
      for (var c = 0; c < n; c++) {
        var v = at(r, c); if (!v) continue;
        for (var c2 = 0; c2 < n; c2++) if (c2 !== c && at(r, c2) === v) { bad[r * n + c] = 1; break; }
        if (bad[r * n + c]) continue;
        for (var r2 = 0; r2 < n; r2++) if (r2 !== r && at(r2, c) === v) { bad[r * n + c] = 1; break; }
      }
    }
    return bad;
  }

  function filledCount() {
    var k = 0; for (var i = 0; i < G.cell.length; i++) if (G.cell[i]) k++;
    return k;
  }

  function isSolved() {
    var n = G.n;
    if (filledCount() !== n * n) return false;
    var bad = conflicts();
    for (var i = 0; i < bad.length; i++) if (bad[i]) return false;
    var sides = ["top", "bottom", "left", "right"];
    for (var s = 0; s < sides.length; s++)
      for (var k = 0; k < n; k++) if (clueState(sides[s], k) === -1) return false;
    return true;
  }

  /* ------------------------------------------------------------------ new */
  function newPuzzle(keepSize) {
    if (!keepSize) { try { localStorage.setItem("sky_size", String(G.n)); } catch (e) {} }
    var core = coreFor(G.n);
    var made = core.generate(Math.random, FLOORS[G.n]);
    if (!made) { say("could not build that city — try again", 2200); return; }
    G.clues = made.clues;
    G.sol = made.grid;
    G.cell = new Uint8Array(G.n * G.n);
    G.sel = { r: 0, c: 0 }; G.hasSel = false;
    G.started = false; G.solved = false; G.elapsed = 0; G.t0 = 0;
    G.sweep = null; G.winT = 0; G.bump = {};
    layout();
    updateHud();
    window.OPT_SHARE_TEXT = window.OPT_SHARE_LINE = window.OPT_SHARE_IMAGE = null;
  }

  function clearCity() {
    if (!G.cell) return;
    G.cell = new Uint8Array(G.n * G.n);
    G.solved = false; G.sweep = null; G.winT = 0;
    updateHud();
  }

  /* ------------------------------------------------------------------ hud */
  function fmtTime(s) {
    var m = Math.floor(s / 60), sec = Math.floor(s % 60);
    return m + ":" + (sec < 10 ? "0" : "") + sec;
  }
  function updateHud() {
    var n = G.n;
    filledEl.textContent = filledCount() + "/" + n * n;
    timeEl.textContent = fmtTime(G.elapsed);
    bestEl.textContent = best[String(n)] ? fmtTime(best[String(n)]) : "—";
    var btns = bar.querySelectorAll("[data-size]");
    for (var i = 0; i < btns.length; i++) btns[i].classList.toggle("is-on", +btns[i].dataset.size === n);
  }

  var sayT = null;
  function say(msg, ms) {
    calloutEl.textContent = msg; calloutEl.hidden = false;
    clearTimeout(sayT);
    sayT = setTimeout(function () { calloutEl.hidden = true; }, ms || 1500);
  }

  /* ---------------------------------------------------------------- audio
   * House technique: contacts are MODAL — noise driven through parallel
   * resonant bandpasses tuned to the object's own modes — and only long tails
   * are additive. A stack of clean oscillators at tidy ratios is a chord, and
   * a chord is what "computery" sounds like.
   */
  var Audio2 = (function () {
    var actx = null, master = null, comp = null, verb = null, delay = null, muted = false;
    try { muted = localStorage.getItem("sky_sound") === "off"; } catch (e) {}

    function init() {
      if (actx) return;
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      actx = new AC();
      var b = actx.createBuffer(1, 1, 22050);
      var s = actx.createBufferSource(); s.buffer = b; s.connect(actx.destination); s.start(0);

      master = actx.createGain(); master.gain.value = muted ? 0 : 0.9;
      var lp = actx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 13500;
      comp = actx.createDynamicsCompressor();
      comp.threshold.value = -15; comp.ratio.value = 3; comp.attack.value = 0.003; comp.release.value = 0.2;
      comp.connect(lp); lp.connect(master); master.connect(actx.destination);

      // a city block at night, not a desk: a longer tail with air on top
      var len = Math.floor(actx.sampleRate * 1.9);
      var ir = actx.createBuffer(2, len, actx.sampleRate);
      for (var ch = 0; ch < 2; ch++) {
        var d = ir.getChannelData(ch), lastv = 0;
        for (var i = 0; i < len; i++) {
          var t = i / len;
          var nz = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.6);
          lastv = lastv * 0.62 + nz * 0.38;     // low-pass the noise or the tail is grainy
          d[i] = lastv;
        }
      }
      verb = actx.createConvolver(); verb.buffer = ir;
      var shelf = actx.createBiquadFilter(); shelf.type = "highshelf"; shelf.frequency.value = 3800; shelf.gain.value = 3;
      var hpv = actx.createBiquadFilter(); hpv.type = "highpass"; hpv.frequency.value = 220;
      var vg = actx.createGain(); vg.gain.value = 0.3;
      verb.connect(hpv); hpv.connect(shelf); shelf.connect(vg); vg.connect(comp);

      delay = actx.createDelay(1.0); delay.delayTime.value = 0.28;
      var fb = actx.createGain(); fb.gain.value = 0.26;
      var dlp = actx.createBiquadFilter(); dlp.type = "lowpass"; dlp.frequency.value = 2600;
      delay.connect(dlp); dlp.connect(fb); fb.connect(delay);
      var dg = actx.createGain(); dg.gain.value = 0.5;
      dlp.connect(dg); dg.connect(comp); dg.connect(verb);   // repeats bloom into the hall
    }

    var nb = null;
    function noiseBuf() {
      if (nb) return nb;
      var len = Math.floor(actx.sampleRate * 0.05);
      nb = actx.createBuffer(1, len, actx.sampleRate);
      var d = nb.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      return nb;
    }

    /* A high-Q bandpass rings for about Q/(pi*f) seconds, so Q comes from the
     * decay each mode should have. It also only passes a band f/Q wide out of
     * broadband noise, so the tighter the resonance the quieter it gets —
     * output RMS scales as 1/sqrt(Q) and that has to be put back, or the whole
     * voice lands inaudible with its mode frequencies perfectly correct. */
    function modal(o) {
      if (!actx || muted) return;
      var t = o.at || actx.currentTime;
      var dest = o.dest || comp;
      var ex = actx.createBufferSource(); ex.buffer = noiseBuf();
      var hp = actx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = o.exHighpass || 180;
      var exGain = actx.createGain();
      var burst = o.burst || 0.006;
      exGain.gain.setValueAtTime(1.0, t);     // shape only — amp is applied per mode
      exGain.gain.exponentialRampToValueAtTime(0.0001, t + burst);
      ex.connect(hp); hp.connect(exGain);

      var pan = actx.createStereoPanner ? actx.createStereoPanner() : null;
      if (pan) { pan.pan.value = Math.max(-1, Math.min(1, o.pan || 0)); pan.connect(dest); if (verb && o.verb !== false) pan.connect(verb); }

      var longest = 0;
      for (var i = 0; i < o.modes.length; i++) {
        var m = o.modes[i];
        var f = o.base * m[0];
        if (f > 16000) continue;
        var decay = m[2] * (0.85 + Math.random() * 0.3);
        longest = Math.max(longest, decay);
        var bp = actx.createBiquadFilter();
        bp.type = "bandpass";
        bp.frequency.value = f * (1 + (Math.random() - 0.5) * 0.04);
        var Q = Math.max(1.2, Math.PI * f * decay);
        bp.Q.value = Q;
        var g = actx.createGain();
        g.gain.setValueAtTime(m[1] * o.amp * Math.sqrt(Q) * 6, t);
        g.gain.exponentialRampToValueAtTime(0.0004, t + decay);
        exGain.connect(bp); bp.connect(g);
        if (pan) g.connect(pan); else { g.connect(dest); if (verb && o.verb !== false) g.connect(verb); }
      }
      ex.start(t);
      ex.stop(t + Math.min(2.5, longest + 0.1));
    }

    // Long ringing tails cannot be modal — a noise burst has nothing left to
    // sustain a second of resonance — so bells are additive, with inharmonic
    // partials and a noise strike so they still start like something struck.
    function bell(freq, amp, pan, dur) {
      if (!actx || muted) return;
      var t = actx.currentTime;
      var ratios = [1, 2, 3.01, 4.17, 5.43], gains = [1, 0.5, 0.32, 0.16, 0.09];
      var p = actx.createStereoPanner ? actx.createStereoPanner() : null;
      var into = p || comp;
      if (p) { p.pan.value = Math.max(-1, Math.min(1, pan || 0)); p.connect(comp); if (verb) p.connect(verb); if (delay) p.connect(delay); }
      for (var i = 0; i < ratios.length; i++) {
        var o = actx.createOscillator(); o.type = "sine";
        o.frequency.value = freq * ratios[i] * (1 + (Math.random() - 0.5) * 0.004);
        var g = actx.createGain();
        var d = (dur || 1.5) / (1 + i * 0.55);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(amp * gains[i], t + 0.006);
        g.gain.exponentialRampToValueAtTime(0.0001, t + d);
        o.connect(g); g.connect(into);
        o.start(t); o.stop(t + d + 0.05);
      }
      modal({ base: freq * 2.6, amp: amp * 0.5, burst: 0.002, exHighpass: 900, pan: pan,
              modes: [[1, 1, 0.012], [1.9, 0.5, 0.008]] });
    }

    var PENT = [0, 2, 4, 7, 9];
    function pent(i) { return 261.63 * Math.pow(2, (PENT[i % 5] + 12 * Math.floor(i / 5)) / 12); }

    return {
      init: init,
      muted: function () { return muted; },
      toggle: function () {
        muted = !muted;
        try { localStorage.setItem("sky_sound", muted ? "off" : "on"); } catch (e) {}
        if (master) master.gain.setTargetAtTime(muted ? 0 : 0.9, actx.currentTime, 0.02);
        return muted;
      },
      // A tower settling: glass and concrete, dense and gone fast. A taller
      // building is a bigger object, so it lands lower.
      place: function (h, n, pan) {
        init();
        var base = 520 * Math.pow(0.86, h - 1);
        modal({ base: base, amp: 1.15, burst: 0.015, exHighpass: 240, pan: pan,
                modes: [[1, 1, 0.055], [2.41, 0.62, 0.036], [4.09, 0.34, 0.022], [6.31, 0.17, 0.014]] });
        modal({ base: 96 - h * 5, amp: 0.75 + h * 0.05, burst: 0.020, exHighpass: 40, pan: pan,
                modes: [[1, 1, 0.10], [2.05, 0.3, 0.05]] });
      },
      tick: function (pan) {
        init();
        modal({ base: 2100, amp: 0.62, burst: 0.006, exHighpass: 900, pan: pan, verb: false,
                modes: [[1, 1, 0.008], [2.3, 0.4, 0.005]] });
      },
      // A wrong height is the same contact heavily damped: no ring, just mass.
      bad: function (pan) {
        init();
        modal({ base: 150, amp: 1.0, burst: 0.018, exHighpass: 50, pan: pan,
                modes: [[1, 1, 0.055], [1.72, 0.4, 0.03], [2.6, 0.2, 0.018]] });
      },
      look: function () {
        init();
        if (!actx || muted) return;
        var t = actx.currentTime;
        var src = actx.createBufferSource(); src.buffer = noiseBuf(); src.loop = true;
        var bp = actx.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = 1.3;
        bp.frequency.setValueAtTime(300, t);
        bp.frequency.exponentialRampToValueAtTime(2400, t + 0.5);
        var g = actx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.34, t + 0.09);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
        src.connect(bp); bp.connect(g); g.connect(comp); if (verb) g.connect(verb);
        src.start(t); src.stop(t + 0.6);
      },
      seen: function (i, pan) { init(); bell(pent(i + 5), 0.13, pan, 1.1); },
      lineDone: function (pan) { init(); bell(pent(7), 0.16, pan, 1.6); },
      win: function () {
        init();
        if (!actx || muted) return;
        for (var i = 0; i < 6; i++) {
          (function (i) { setTimeout(function () { bell(pent(3 + i), 0.17 - i * 0.012, (i % 2 ? 0.4 : -0.4), 2.4); }, i * 118); })(i);
        }
      }
    };
  })();

  /* ----------------------------------------------------------------- draw */
  function poly(pts, fill, stroke, lw) {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 1; ctx.stroke(); }
  }

  function hash(a, b, c) {
    var h = (a * 73856093) ^ (b * 19349663) ^ (c * 83492791);
    h = (h ^ (h >>> 13)) * 1274126177;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawSky() {
    var g = ctx.createLinearGradient(0, 0, 0, L.H);
    g.addColorStop(0, "#05060e");
    g.addColorStop(0.55, "#080a18");
    g.addColorStop(1, "#0c0d1c");
    ctx.fillStyle = g; ctx.fillRect(0, 0, L.W, L.H);
    // a low warm glow behind the city, as if the sun just went down
    var c = proj(G.n / 2, G.n / 2, 0);
    var rg = ctx.createRadialGradient(c.x, c.y - L.TS * 1.6, 0, c.x, c.y - L.TS * 1.6, L.TS * (G.n + 3));
    rg.addColorStop(0, "rgba(255, 150, 60, 0.10)");
    rg.addColorStop(0.5, "rgba(120, 90, 200, 0.05)");
    rg.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = rg; ctx.fillRect(0, 0, L.W, L.H);
  }

  function drawPlate() {
    var n = G.n;
    poly([proj(0, 0, 0), proj(n, 0, 0), proj(n, n, 0), proj(0, n, 0)], "#0b0e1c");
    var e0 = proj(0, 0, 0), e1 = proj(n, n, 0);
    var g = ctx.createLinearGradient(e0.x, e0.y, e1.x, e1.y);
    g.addColorStop(0, "rgba(80, 110, 200, 0.10)");
    g.addColorStop(1, "rgba(20, 24, 50, 0.04)");
    poly([proj(0, 0, 0), proj(n, 0, 0), proj(n, n, 0), proj(0, n, 0)], g);
    ctx.strokeStyle = "rgba(140, 175, 255, 0.10)"; ctx.lineWidth = 1;
    for (var i = 1; i < n; i++) {
      var a = proj(i, 0, 0), b = proj(i, n, 0);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      a = proj(0, i, 0); b = proj(n, i, 0);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    poly([proj(0, 0, 0), proj(n, 0, 0), proj(n, n, 0), proj(0, n, 0)], null, "rgba(150, 185, 255, 0.24)", 1.4);
  }

  function towerBox(r, c, h) {
    var x0 = c + FOOT, x1 = c + 1 - FOOT, y0 = r + FOOT, y1 = r + 1 - FOOT;
    return {
      A: proj(x0, y1, 0), B: proj(x1, y1, 0), C: proj(x1, y0, 0), D: proj(x0, y0, 0),
      A2: proj(x0, y1, h), B2: proj(x1, y1, h), C2: proj(x1, y0, h), D2: proj(x0, y0, h),
      x0: x0, x1: x1, y0: y0, y1: y1
    };
  }

  function drawShadows() {
    var n = G.n;
    ctx.save();
    for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) {
      var h = at(r, c); if (!h) continue;
      var b = towerBox(r, c, h);
      var dx = h * L.HU * 0.62, dy = h * L.HU * 0.30;
      ctx.globalAlpha = 0.40;
      poly([{ x: b.A.x + dx, y: b.A.y + dy }, { x: b.B.x + dx, y: b.B.y + dy },
            { x: b.C.x + dx, y: b.C.y + dy }, { x: b.D.x + dx, y: b.D.y + dy }], "#03040a");
      ctx.globalAlpha = 0.55;
      poly([b.A, b.B, b.C, b.D], "rgba(2,3,8,0.9)");
    }
    ctx.restore();
  }

  function drawTower(r, c, h, mark, bad, selected, lightAll) {
    var n = G.n;
    var bump = G.bump[r * n + c] || 0;
    var b = towerBox(r, c, h + bump * 0.12);
    var dim = mark === -1;
    var lit = mark === 1 || lightAll;

    var faceTop = dim ? "#1b2038" : (lit ? "#4a5580" : "#3d4870");
    var faceFront = dim ? "#10142a" : "#1b2242";
    var faceLeft = dim ? "#0a0d1e" : "#12172f";
    if (bad) { faceTop = "#6b2b3a"; faceFront = "#3a1220"; faceLeft = "#280c17"; }

    poly([b.A, b.D, b.D2, b.A2], faceLeft);
    // storey lines on the flank read as floors without needing windows there
    ctx.strokeStyle = "rgba(150,180,255,0.07)"; ctx.lineWidth = 1;
    for (var k = 1; k < h; k++) {
      var p1 = proj(b.x0, b.y1, k), p2 = proj(b.x0, b.y0, k);
      ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
    }

    var fg = ctx.createLinearGradient(b.A2.x, b.A2.y, b.A.x, b.A.y);
    fg.addColorStop(0, bad ? "#4a1826" : (dim ? "#141830" : "#232b52"));
    fg.addColorStop(1, bad ? "#2a0c15" : (dim ? "#0a0c1c" : "#12172f"));
    poly([b.A, b.B, b.B2, b.A2], fg);

    // windows: one band per storey, so the height is something you count
    var fw = b.B.x - b.A.x;
    var cols = fw > 54 ? 4 : 3, wm = fw * (cols === 4 ? 0.09 : 0.13);
    var ww = (fw - wm * (cols + 1)) / cols;
    var wh = L.HU * 0.5, warm = dim ? 0.13 : 1;
    for (var f = 0; f < h; f++) {
      var yTop = b.A.y - (f + 1) * L.HU + L.HU * 0.30;
      for (var i = 0; i < cols; i++) {
        var on = hash(r * 31 + c, f, i) > (lightAll ? 0.05 : 0.3);
        var a = on ? (0.55 + hash(c, f * 7 + i, r) * 0.4) * warm : 0.07;
        ctx.fillStyle = on ? "rgba(255," + (188 + ((hash(f, i, r) * 40) | 0)) + ",120," + a.toFixed(3) + ")"
                           : "rgba(120,150,220," + a.toFixed(3) + ")";
        ctx.fillRect(b.A.x + wm + i * (ww + wm), yTop, ww, Math.max(1, wh));
      }
    }

    ctx.strokeStyle = dim ? "rgba(140,170,255,0.05)" : "rgba(170,200,255,0.16)";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(b.A.x, b.A.y); ctx.lineTo(b.A2.x, b.A2.y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(b.B.x, b.B.y); ctx.lineTo(b.B2.x, b.B2.y); ctx.stroke();

    poly([b.A2, b.B2, b.C2, b.D2], faceTop);
    poly([b.A, b.B, b.B2, b.C2, b.D2, b.D], null, "rgba(2,3,10,0.6)", 1.2);
    // rim light along the front lip of the roof
    ctx.strokeStyle = dim ? "rgba(150,180,255,0.18)" : "rgba(210,230,255,0.62)";
    ctx.lineWidth = 1.3;
    ctx.beginPath(); ctx.moveTo(b.A2.x, b.A2.y); ctx.lineTo(b.B2.x, b.B2.y); ctx.stroke();

    if (lit && !bad) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      poly([b.A2, b.B2, b.C2, b.D2], "rgba(255,168,66,0.30)");
      poly([b.A, b.B, b.B2, b.A2], "rgba(255,150,58,0.13)");
      ctx.restore();
    }

    // the numeral confirms what the storeys already say
    var mid = proj((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, h + bump * 0.12);
    ctx.font = "800 " + Math.max(9, Math.min(L.TS * 0.26, L.DEPTH * 0.46)).toFixed(0) + 'px "Archivo", system-ui, sans-serif';
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillStyle = dim ? "rgba(200,215,255,0.32)" : "rgba(10,13,26,0.62)";
    ctx.fillText(String(h), mid.x, mid.y + 1);

    if (selected) {
      poly([b.A, b.B, b.B2, b.A2], null, "rgba(111,216,255,0.9)", 1.6);
      poly([b.A2, b.B2, b.C2, b.D2], null, "rgba(111,216,255,0.9)", 1.6);
    }
  }

  function drawEmpty(r, c, selected) {
    var b = towerBox(r, c, 0);
    poly([b.A, b.B, b.C, b.D], "rgba(120,160,255,0.05)", "rgba(140,175,255,0.16)", 1);
    if (selected) poly([b.A, b.B, b.C, b.D], "rgba(111,216,255,0.14)", "rgba(111,216,255,0.85)", 1.6);
  }

  /* A top clue has to sit clear of a full-height tower in the back row, which
   * leaves it stranded in the sky with nothing tying it to its column. A hair
   * line to the first cell of its line is what makes it read as a sightline. */
  function drawClueGuides() {
    var sides = ["top", "bottom", "left", "right"];
    ctx.save();
    for (var s = 0; s < sides.length; s++) {
      var side = sides[s];
      for (var i = 0; i < G.n; i++) {
        if (!G.clues[side][i]) continue;
        var focus = G.sweep && G.sweep.side === side && G.sweep.i === i;
        var p = cluePos(side, i);
        var first = lineCells(side, i)[0];
        var q = proj(first[1] + 0.5, first[0] + 0.5, 0);
        ctx.strokeStyle = focus ? "rgba(111,216,255,0.55)" : "rgba(150,185,255,0.13)";
        ctx.lineWidth = focus ? 1.6 : 1;
        ctx.setLineDash(focus ? [] : [3, 5]);
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
      }
    }
    ctx.setLineDash([]);
    ctx.restore();
  }

  function drawClues() {
    var sides = ["top", "bottom", "left", "right"];
    for (var s = 0; s < sides.length; s++) {
      var side = sides[s];
      for (var i = 0; i < G.n; i++) {
        var want = G.clues[side][i];
        if (!want) continue;
        var p = cluePos(side, i);
        var st = clueState(side, i);
        var focus = G.sweep && G.sweep.side === side && G.sweep.i === i;
        var rr = L.chip;
        var fill = "rgba(12,15,30,0.85)", edge = "rgba(150,185,255,0.3)", ink = "rgba(224,232,255,0.82)";
        if (st === 1) { fill = "rgba(60,42,12,0.9)"; edge = "rgba(255,180,74,0.9)"; ink = "#ffdca6"; }
        if (st === -1) { fill = "rgba(58,14,24,0.9)"; edge = "rgba(255,95,109,0.9)"; ink = "#ffc2c8"; }
        if (focus) { edge = "rgba(111,216,255,1)"; ink = "#dff4ff"; }
        ctx.save();
        if (focus || st === 1) { ctx.shadowColor = edge; ctx.shadowBlur = 14; }
        roundRect(p.x - rr, p.y - rr * 0.82, rr * 2, rr * 1.64, rr * 0.42);
        ctx.fillStyle = fill; ctx.fill();
        ctx.strokeStyle = edge; ctx.lineWidth = 1.4; ctx.stroke();
        ctx.restore();
        ctx.font = "800 " + (rr * 1.05).toFixed(0) + 'px "Archivo", system-ui, sans-serif';
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillStyle = ink;
        ctx.fillText(String(want), p.x, p.y + 1);
      }
    }
  }

  function drawSweep() {
    var sw = G.sweep; if (!sw) return;
    var info = seenAlong(sw.side, sw.i);
    var p0 = cluePos(sw.side, sw.i);
    var last = info.cells[info.cells.length - 1];
    var pEnd = proj(last[1] + 0.5, last[0] + 0.5, 0);
    var k = Math.min(1, sw.t / 0.42);
    var x = p0.x + (pEnd.x - p0.x) * k, y = p0.y + (pEnd.y - p0.y) * k;
    var fade = sw.t > 1.7 ? Math.max(0, 1 - (sw.t - 1.7) / 0.5) : 1;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    var g = ctx.createLinearGradient(p0.x, p0.y, x, y);
    g.addColorStop(0, "rgba(111,216,255," + (0.34 * fade).toFixed(3) + ")");
    g.addColorStop(1, "rgba(111,216,255,0)");
    ctx.strokeStyle = g; ctx.lineWidth = L.TS * 0.14; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(x, y); ctx.stroke();
    ctx.restore();

    var lbl = info.count + (info.count === 1 ? " seen" : " seen");
    ctx.font = "800 " + (L.chip * 0.78).toFixed(0) + 'px "Archivo", system-ui, sans-serif';
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.globalAlpha = fade;
    ctx.fillStyle = "rgba(111,216,255,0.95)";
    var off = sw.side === "bottom" ? L.chip * 1.75 : -L.chip * 1.75;
    ctx.fillText(lbl, p0.x, p0.y + off);
    ctx.globalAlpha = 1;
  }

  function sweepMarks() {
    var sw = G.sweep;
    if (!sw) return null;
    var n = G.n, m = new Int8Array(n * n);
    var info = seenAlong(sw.side, sw.i);
    var reach = Math.min(n, Math.floor(sw.t / 0.42 * n) + 1);
    for (var k = 0; k < info.cells.length; k++) {
      if (k >= reach) continue;
      var rc = info.cells[k];
      m[rc[0] * n + rc[1]] = info.vis[k] ? 1 : -1;
    }
    return m;
  }

  function draw() {
    drawSky();
    if (!G.clues) return;
    drawPlate();
    drawClueGuides();
    drawShadows();
    var bad = conflicts();
    var marks = sweepMarks();
    var n = G.n;
    var lightAll = G.winT > 0;
    for (var r = 0; r < n; r++) {
      for (var c = 0; c < n; c++) {
        var h = at(r, c);
        var sel = G.hasSel && G.sel.r === r && G.sel.c === c;
        var wave = lightAll && (r + c) / (2 * n) < G.winT * 0.9;
        if (h) drawTower(r, c, h, marks ? marks[r * n + c] : 0, !!bad[r * n + c], sel, wave);
        else drawEmpty(r, c, sel);
      }
    }
    drawClues();
    drawSweep();
  }

  /* ---------------------------------------------------------------- picking
   * Hit-test the tower's silhouette, near row first, so tapping a roof selects
   * the building you can see rather than the tile that happens to sit under
   * that pixel — those are different cells the moment anything is tall.
   */
  function inPoly(px, py, pts) {
    var inside = false;
    for (var i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      var xi = pts[i].x, yi = pts[i].y, xj = pts[j].x, yj = pts[j].y;
      if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  function pickCell(px, py) {
    var n = G.n, r, c;
    // Standing towers first, nearest row first, so tapping a roof picks the
    // building you can see rather than the plot it happens to sit in front of.
    for (r = n - 1; r >= 0; r--) {
      for (c = n - 1; c >= 0; c--) {
        var h = at(r, c);
        if (!h) continue;
        var b = towerBox(r, c, h);
        if (inPoly(px, py, [b.A, b.B, b.B2, b.C2, b.D2, b.D])) return { r: r, c: c };
      }
    }
    /* ⚠ Then the ground, tested against the WHOLE tile rather than the inset
     * plot that gets drawn. Testing the plot left the streets between them
     * dead — nearly 40% of the board ignored taps, which keyboard play hid
     * completely. A touch target may be larger than its artwork; never smaller. */
    for (r = n - 1; r >= 0; r--) {
      for (c = n - 1; c >= 0; c--) {
        if (inPoly(px, py, [proj(c, r + 1, 0), proj(c + 1, r + 1, 0), proj(c + 1, r, 0), proj(c, r, 0)]))
          return { r: r, c: c };
      }
    }
    return null;
  }

  function pickClue(px, py) {
    var sides = ["top", "bottom", "left", "right"];
    for (var s = 0; s < sides.length; s++) {
      for (var i = 0; i < G.n; i++) {
        if (!G.clues[sides[s]][i]) continue;
        var p = cluePos(sides[s], i);
        if (Math.abs(px - p.x) <= L.chip * 1.2 && Math.abs(py - p.y) <= L.chip * 1.1) return { side: sides[s], i: i };
      }
    }
    return null;
  }

  /* ------------------------------------------------------------ interaction */
  var drag = null;

  function panOf(c) { return G.n > 1 ? (c / (G.n - 1) - 0.5) * 1.2 : 0; }

  function localPt(e) {
    var r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function startTimer() {
    if (G.started || G.solved) return;
    G.started = true; G.t0 = performance.now();
    if (window.gtag) window.gtag("event", "toy_start", { toy_slug: "skyscrapers" });
  }

  function applyHeight(r, c, v, quiet) {
    var old = at(r, c);
    if (v === old) return;
    setAt(r, c, v);
    G.bump[r * G.n + c] = 1;
    if (!quiet) {
      if (v === 0) Audio2.tick(panOf(c));
      else Audio2.place(v, G.n, panOf(c));
    }
    startTimer();
    updateHud();
    checkWin();
  }

  function checkWin() {
    if (G.solved || !isSolved()) return;
    G.solved = true;
    G.winT = 0.0001;
    G.elapsed = G.started ? (performance.now() - G.t0) / 1000 : 0;
    var secs = Math.max(1, Math.round(G.elapsed));
    var key = String(G.n);
    var isBest = !best[key] || secs < best[key];
    if (isBest) { best[key] = secs; try { localStorage.setItem("sky_best_" + key, String(secs)); } catch (e) {} }
    updateHud();
    Audio2.win();
    say(G.n + "×" + G.n + " solved in " + fmtTime(secs), 2600);
    if (window.gtag) window.gtag("event", "toy_score", { toy_slug: "skyscrapers", value: secs });
    window.OPT_SHARE_TEXT = "I solved a " + G.n + "×" + G.n + " Skyscrapers in " + fmtTime(secs) + ". Your turn.";
    window.OPT_SHARE_LINE = G.n + "×" + G.n + " solved in " + fmtTime(secs);
    window.OPT_SHARE_IMAGE = function () { return canvas; };
    setTimeout(function () {
      ovEyebrow.textContent = isBest ? "New best time" : "Skyline complete";
      ovTitle.textContent = fmtTime(secs);
      ovText.innerHTML = "Every sightline checks out on the " + G.n + "×" + G.n + ". Best so far <b>" +
        fmtTime(best[key]) + "</b>.";
      if (ovDemo) ovDemo.style.display = "none";
      ovBtn.textContent = "New city";
      overlay.hidden = false; overlay.classList.remove("is-out");
    }, 2100);
  }

  canvas.addEventListener("pointerdown", function (e) {
    e.preventDefault();
    Audio2.init();
    if (!G.clues) return;
    var p = localPt(e);

    var cl = pickClue(p.x, p.y);
    if (cl) {
      G.sweep = { side: cl.side, i: cl.i, t: 0 };
      Audio2.look();
      var info = seenAlong(cl.side, cl.i);
      for (var k = 0; k < info.cells.length; k++) {
        if (!info.vis[k]) continue;
        (function (k, rc) {
          setTimeout(function () { Audio2.seen(k, panOf(rc[1])); }, 90 + k * (420 / G.n));
        })(k, info.cells[k]);
      }
      return;
    }

    if (G.solved) return;
    var hit = pickCell(p.x, p.y);
    if (!hit) return;
    G.sel = hit; G.hasSel = true;
    canvas.setPointerCapture(e.pointerId);
    drag = { id: e.pointerId, y0: p.y, h0: at(hit.r, hit.c), moved: false, r: hit.r, c: hit.c };
    hintEl.classList.add("is-gone");
  }, { passive: false });

  canvas.addEventListener("pointermove", function (e) {
    if (!drag || e.pointerId !== drag.id) return;
    var p = localPt(e);
    var step = Math.max(15, L.HU);
    var dy = drag.y0 - p.y;                        // up is taller
    if (Math.abs(dy) > 5) drag.moved = true;
    var v = Math.max(0, Math.min(G.n, drag.h0 + Math.round(dy / step)));
    applyHeight(drag.r, drag.c, v);
  });

  function endDrag(e) {
    if (!drag || (e && e.pointerId !== drag.id)) return;
    if (!drag.moved) {
      // a plain tap cycles, which is the fastest way in on a phone
      var v = at(drag.r, drag.c) + 1;
      applyHeight(drag.r, drag.c, v > G.n ? 0 : v);
    }
    drag = null;
  }
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);

  window.addEventListener("keydown", function (e) {
    if (!G.clues || overlay.hidden === false) return;
    var n = G.n, k = e.key;
    if (k === "ArrowUp" || k === "ArrowDown" || k === "ArrowLeft" || k === "ArrowRight") {
      if (!G.hasSel) { G.sel = { r: 0, c: 0 }; G.hasSel = true; }
      else {
        if (k === "ArrowUp") G.sel.r = (G.sel.r + n - 1) % n;
        if (k === "ArrowDown") G.sel.r = (G.sel.r + 1) % n;
        if (k === "ArrowLeft") G.sel.c = (G.sel.c + n - 1) % n;
        if (k === "ArrowRight") G.sel.c = (G.sel.c + 1) % n;
      }
      e.preventDefault(); return;
    }
    if (!G.hasSel || G.solved) return;
    if (k >= "1" && k <= String(n)) { Audio2.init(); applyHeight(G.sel.r, G.sel.c, +k); e.preventDefault(); return; }
    if (k === "0" || k === "Backspace" || k === "Delete") { Audio2.init(); applyHeight(G.sel.r, G.sel.c, 0); e.preventDefault(); return; }
    if (k === " ") {
      Audio2.init();
      var v = at(G.sel.r, G.sel.c) + 1;
      applyHeight(G.sel.r, G.sel.c, v > n ? 0 : v);
      e.preventDefault();
    }
  });

  /* ------------------------------------------------------------------ chrome */
  var sizeBtns = bar.querySelectorAll("[data-size]");
  for (var i = 0; i < sizeBtns.length; i++) {
    sizeBtns[i].addEventListener("click", function () {
      var n = +this.dataset.size;
      if (n === G.n && G.clues && filledCount() === 0) return;
      G.n = n;
      newPuzzle(false);
      say(n + "×" + n + " city", 1200);
    });
  }
  document.getElementById("btnNew").addEventListener("click", function () { newPuzzle(true); say("new city", 1100); });
  document.getElementById("btnClear").addEventListener("click", function () { clearCity(); });

  soundBtn.addEventListener("click", function () {
    Audio2.init();
    var m = Audio2.toggle();
    soundBtn.setAttribute("aria-pressed", m ? "false" : "true");
  });
  soundBtn.setAttribute("aria-pressed", Audio2.muted() ? "false" : "true");

  ovBtn.addEventListener("click", function () {
    Audio2.init();
    overlay.classList.add("is-out");
    setTimeout(function () { overlay.hidden = true; }, 260);
    if (G.solved || !G.clues) newPuzzle(true);
    hud.hidden = false; bar.hidden = false;
    setTimeout(function () { hintEl.classList.add("is-gone"); }, 6500);
  });

  window.addEventListener("resize", function () { if (G.clues) layout(); });
  window.addEventListener("orientationchange", function () { setTimeout(function () { if (G.clues) layout(); }, 220); });

  /* ------------------------------------------------------------------- loop */
  var lastT = 0;
  // The sightline beam stays under reduced motion — it is the toy explaining
  // its own rule, not decoration. The placement bounce and the victory wave go.
  var calm = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  function frame(ms) {
    var dt = lastT ? Math.min(0.05, (ms - lastT) / 1000) : 0;
    lastT = ms;
    if (G.sweep) { G.sweep.t += dt; if (G.sweep.t > 2.2) G.sweep = null; }
    if (G.winT > 0) G.winT = calm ? 1.6 : Math.min(1.6, G.winT + dt * 0.7);
    for (var k in G.bump) { G.bump[k] = calm ? 0 : G.bump[k] - dt * 5; if (G.bump[k] <= 0) delete G.bump[k]; }
    if (G.started && !G.solved) {
      G.elapsed = (performance.now() - G.t0) / 1000;
      timeEl.textContent = fmtTime(G.elapsed);
    }
    draw();
    requestAnimationFrame(frame);
  }

  newPuzzle(true);
  requestAnimationFrame(frame);
})();
