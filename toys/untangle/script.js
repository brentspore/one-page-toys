/* Untangle — No. 120. Drag the stars until no two filaments cross.
 *
 * The board is generated as a LINE ARRANGEMENT: n straight lines in general
 * position, every pairwise intersection becomes a node, and each line joins its
 * own intersections in order along itself. Two distinct lines meet exactly
 * once, so that drawing is provably crossing-free — a solution always exists
 * and we never have to write a planarity solver to prove it.
 *
 * Positions are normalised to a unit disc and mapped to the play rect at draw
 * time, so a resize or a phone rotation never distorts a board in progress.
 */
(function () {
  "use strict";

  var TAU = Math.PI * 2;
  var canvas = document.getElementById("canvas");
  var ctx = canvas.getContext("2d");
  var W = 0, H = 0, DPR = 1;

  var el = {
    hud: document.getElementById("hud"),
    crossings: document.getElementById("crossings"),
    level: document.getElementById("level"),
    time: document.getElementById("time"),
    best: document.getElementById("best"),
    bar: document.getElementById("bar"),
    btnNew: document.getElementById("btnNew"),
    btnReset: document.getElementById("btnReset"),
    callout: document.getElementById("callout"),
    overlay: document.getElementById("overlay"),
    ovEyebrow: document.getElementById("ovEyebrow"),
    ovTitle: document.getElementById("ovTitle"),
    ovText: document.getElementById("ovText"),
    ovBtn: document.getElementById("ovBtn"),
    ovDemo: document.getElementById("ovDemo"),
    soundBtn: document.getElementById("soundBtn"),
    hint: document.getElementById("hint")
  };

  var KEY_BEST = "untangle_best";
  var KEY_SOUND = "untangle_sound";
  var KEY_TIME = "untangle_t";

  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var coarse = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;

  /* ---------------------------------------------------------------- state */

  var G = {
    level: 1,
    nodes: [],        // {x, y} in the unit disc, plus drag/aura bookkeeping
    edges: [],        // {a, b, cross}
    adj: [],          // node index -> [edge index]
    pairs: null,      // Set of packed edge-pair keys that currently cross
    crossings: 0,
    startCrossings: 0,
    solved: false,
    running: false,
    t0: 0,
    elapsed: 0,
    best: 0,
    drag: null,       // {node, ox, oy, vx, vy}
    sel: -1,          // keyboard selection
    held: false,      // keyboard pick-up
    wave: -1,         // solve ripple progress, in seconds
    waveOrder: [],    // edge index -> ripple depth
    waveMax: 1,
    flash: 0
  };

  var stars = [];
  var sparks = [];   // little pops where a crossing was just resolved

  /* ------------------------------------------------------------- geometry */

  function cross2(ax, ay, bx, by) { return ax * by - ay * bx; }

  /* Proper segment crossing. Pairs that share an endpoint are never counted —
   * they meet legitimately at a node, and two consecutive edges of the same
   * generating line are collinear, which a naive test reports as an overlap. */
  function segCross(p, q, r, s) {
    var d1 = cross2(q.x - p.x, q.y - p.y, r.x - p.x, r.y - p.y);
    var d2 = cross2(q.x - p.x, q.y - p.y, s.x - p.x, s.y - p.y);
    var d3 = cross2(s.x - r.x, s.y - r.y, p.x - r.x, p.y - r.y);
    var d4 = cross2(s.x - r.x, s.y - r.y, q.x - r.x, q.y - r.y);
    return (d1 > 0) !== (d2 > 0) && (d3 > 0) !== (d4 > 0);
  }

  function segPoint(p, q, r, s) {
    var d = cross2(q.x - p.x, q.y - p.y, s.x - r.x, s.y - r.y);
    if (Math.abs(d) < 1e-12) return null;
    var t = cross2(r.x - p.x, r.y - p.y, s.x - r.x, s.y - r.y) / d;
    return { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t };
  }

  /* ------------------------------------------------------------ generator */

  var MAX_LINES = 8;                     // 28 stars, 48 filaments — the ceiling
  function linesForLevel(lv) { return Math.min(3 + lv, MAX_LINES); }
  function atCeiling(lv) { return linesForLevel(lv) === MAX_LINES; }

  function buildArrangement(nLines) {
    // Angles spread evenly over a half turn keep every pair well away from
    // parallel, which is what stops an intersection flying off to infinity.
    var ang = [], off = [], i, j;
    for (i = 0; i < nLines; i++) {
      ang.push((i + 0.5 + (Math.random() - 0.5) * 0.55) / nLines * Math.PI);
      off.push((Math.random() - 0.5) * 1.15);
    }
    var lines = ang.map(function (a, k) {
      return { px: Math.cos(a) * off[k], py: Math.sin(a) * off[k], dx: -Math.sin(a), dy: Math.cos(a) };
    });

    var nodes = [], onLine = [];
    for (i = 0; i < nLines; i++) onLine.push([]);
    for (i = 0; i < nLines; i++) {
      for (j = i + 1; j < nLines; j++) {
        var A = lines[i], B = lines[j];
        var den = cross2(A.dx, A.dy, B.dx, B.dy);
        if (Math.abs(den) < 1e-9) return null;
        var t = cross2(B.px - A.px, B.py - A.py, B.dx, B.dy) / den;
        var u = cross2(B.px - A.px, B.py - A.py, A.dx, A.dy) / den;
        var idx = nodes.length;
        nodes.push({ x: A.px + A.dx * t, y: A.py + A.dy * t });
        onLine[i].push({ i: idx, t: t });
        onLine[j].push({ i: idx, t: u });
      }
    }

    var edges = [];
    for (i = 0; i < nLines; i++) {
      onLine[i].sort(function (a, b) { return a.t - b.t; });
      for (j = 0; j + 1 < onLine[i].length; j++) {
        edges.push({ a: onLine[i][j].i, b: onLine[i][j + 1].i, cross: 0 });
      }
    }
    return { nodes: nodes, edges: edges };
  }

  function generate(lv) {
    var nLines = linesForLevel(lv), out = null, tries = 0;
    while (!out && tries++ < 120) out = buildArrangement(nLines);
    if (!out) out = buildArrangement(nLines) || buildArrangement(4);

    G.edges = out.edges;
    G.adj = out.nodes.map(function () { return []; });
    G.edges.forEach(function (e, i) { G.adj[e.a].push(i); G.adj[e.b].push(i); });

    // Scatter onto a jittered ring. Every edge becomes a chord, which is the
    // most tangled honest starting point there is — and it reads as a knot.
    var N = out.nodes.length;
    var order = out.nodes.map(function (_, i) { return i; });
    for (var k = N - 1; k > 0; k--) {
      var r = (Math.random() * (k + 1)) | 0;
      var tmp = order[k]; order[k] = order[r]; order[r] = tmp;
    }
    G.nodes = out.nodes.map(function () { return { x: 0, y: 0, aura: 0 }; });

    // A ring scatter can occasionally deal a board that is already nearly
    // solved, which is not a puzzle. Reshuffle until it is worth pulling on.
    var floor = Math.max(3, Math.round(N * 0.6));
    for (var attempt = 0; attempt < 40; attempt++) {
      for (var k2 = N - 1; k2 > 0; k2--) {
        var r2 = (Math.random() * (k2 + 1)) | 0;
        var t2 = order[k2]; order[k2] = order[r2]; order[r2] = t2;
      }
      order.forEach(function (idx, pos) {
        var a = pos / N * TAU + (Math.random() - 0.5) * (TAU / N) * 0.5;
        var rr = 0.97 - Math.random() * 0.13;
        G.nodes[idx].x = Math.cos(a) * rr;
        G.nodes[idx].y = Math.sin(a) * rr;
      });
      recountAll();
      if (G.crossings >= floor) break;
    }
    G.startCrossings = Math.max(1, G.crossings);
  }

  /* ------------------------------------------------- crossing bookkeeping */

  function key(i, j) { return i < j ? i * 4096 + j : j * 4096 + i; }

  function edgeCrosses(i, j) {
    var e = G.edges[i], f = G.edges[j];
    if (e.a === f.a || e.a === f.b || e.b === f.a || e.b === f.b) return false;
    return segCross(G.nodes[e.a], G.nodes[e.b], G.nodes[f.a], G.nodes[f.b]);
  }

  function recountAll() {
    G.pairs = new Set();
    G.edges.forEach(function (e) { e.cross = 0; });
    for (var i = 0; i < G.edges.length; i++) {
      for (var j = i + 1; j < G.edges.length; j++) {
        if (edgeCrosses(i, j)) {
          G.pairs.add(key(i, j));
          G.edges[i].cross++; G.edges[j].cross++;
        }
      }
    }
    G.crossings = G.pairs.size;
  }

  /* Only the edges touching the moved node can change, and a node has at most
   * four of them, so a drag costs a few hundred tests rather than E squared. */
  function recountNode(n) {
    var mine = G.adj[n], i, j, e, before = G.crossings;
    for (i = 0; i < mine.length; i++) {
      e = mine[i];
      for (j = 0; j < G.edges.length; j++) {
        if (j === e) continue;
        var k = key(e, j), had = G.pairs.has(k), now = edgeCrosses(e, j);
        if (had === now) continue;
        if (now) { G.pairs.add(k); G.edges[e].cross++; G.edges[j].cross++; }
        else {
          G.pairs["delete"](k);
          G.edges[e].cross--; G.edges[j].cross--;
          var pt = segPoint(G.nodes[G.edges[e].a], G.nodes[G.edges[e].b],
                            G.nodes[G.edges[j].a], G.nodes[G.edges[j].b]);
          if (pt && sparks.length < 40) sparks.push({ x: pt.x, y: pt.y, life: 1 });
        }
      }
    }
    G.crossings = G.pairs.size;
    if (G.crossings !== before) onCrossingsChanged(before);
  }

  function onCrossingsChanged(before) {
    el.crossings.textContent = G.crossings;
    if (G.crossings < before) {
      var done = 1 - G.crossings / G.startCrossings;
      audio.resolve(done, before - G.crossings);
    } else {
      audio.snag();
    }
    if (G.crossings === 0 && !G.solved) solve();
  }

  /* ----------------------------------------------------------------- flow */

  function startLevel(lv, fresh) {
    G.level = lv;
    G.solved = false;
    G.running = true;
    G.wave = -1;
    G.flash = 0;
    G.drag = null;
    G.sel = -1;
    G.held = false;
    sparks.length = 0;
    generate(lv);
    sizeNodes();
    G.t0 = performance.now();
    G.elapsed = 0;
    el.level.textContent = lv;
    el.crossings.textContent = G.crossings;
    el.best.textContent = G.best ? "L" + G.best : "—";
    el.hud.hidden = false;
    el.bar.hidden = false;
    el.btnReset.hidden = lv <= 1;
    window.OPT_SHARE_IMAGE = null;
    window.OPT_SHARE_LINE = null;
    window.OPT_SHARE_TEXT = null;
    if (fresh) flashCallout("Level " + lv);
    gtagSafe("level_start", { toy: "untangle", level: lv, nodes: G.nodes.length });
  }

  function solve() {
    G.solved = true;
    G.running = false;
    G.elapsed = performance.now() - G.t0;
    G.wave = 0;
    G.flash = 1;
    lastPing = -1;
    buildWave();
    audio.solve();

    var secs = G.elapsed / 1000;
    var tKey = KEY_TIME + G.level;
    var prevT = parseFloat(store(tKey) || "0");
    var pb = !prevT || secs < prevT;
    if (pb) store(tKey, secs.toFixed(2));
    // One ticket key for the whole toy: the deepest level cleared. Writing it
    // is what earns — never also call award(), that double-counts.
    if (G.level > G.best) { G.best = G.level; store(KEY_BEST, String(G.best)); }
    el.best.textContent = "L" + G.best;

    var nodes = G.nodes.length;
    window.OPT_SHARE_IMAGE = function () { draw(performance.now()); return canvas; };
    window.OPT_SHARE_LINE = "Level " + G.level + " · " + nodes + " stars · " + fmtTime(G.elapsed);
    window.OPT_SHARE_TEXT = "I untangled " + nodes + " stars on level " + G.level +
      " of Untangle in " + fmtTime(G.elapsed) + ".";

    gtagSafe("level_complete", { toy: "untangle", level: G.level, value: Math.round(secs) });

    setTimeout(function () {
      el.ovEyebrow.textContent = pb && prevT ? "New best time" : "No crossings left";
      el.ovTitle.textContent = "Level " + G.level + " clear";
      el.ovText.innerHTML =
        "<b>" + nodes + " stars, " + G.edges.length + " filaments, " + fmtTime(G.elapsed) + ".</b><br />" +
        (prevT ? "Your best at this level: " + fmtTime(Math.min(secs, prevT) * 1000) + ".<br />" : "") +
        (atCeiling(G.level)
          ? "Boards stay this size from here. Now it is about the clock."
          : "Level " + (G.level + 1) + " adds " + (nodeCount(G.level + 1) - nodes) + " more stars.");
      el.ovDemo.hidden = true;
      el.ovBtn.textContent = "Level " + (G.level + 1);
      el.overlay.hidden = false;
      el.overlay.classList.remove("is-out");
    }, reduceMotion ? 600 : 1750);
  }

  function nodeCount(lv) { var n = linesForLevel(lv); return n * (n - 1) / 2; }

  function buildWave() {
    // Light the filaments outward from one star so the finish travels through
    // the shape the player just made, rather than flashing all at once.
    var seed = (Math.random() * G.nodes.length) | 0;
    var depth = G.nodes.map(function () { return -1; });
    var q = [seed]; depth[seed] = 0;
    G.waveOrder = G.edges.map(function () { return 0; });
    G.waveMax = 1;
    while (q.length) {
      var n = q.shift();
      for (var i = 0; i < G.adj[n].length; i++) {
        var ei = G.adj[n][i], e = G.edges[ei];
        var o = e.a === n ? e.b : e.a;
        if (!G.waveOrder[ei]) G.waveOrder[ei] = depth[n] + 1;
        if (depth[o] < 0) { depth[o] = depth[n] + 1; q.push(o); }
      }
    }
    G.waveOrder.forEach(function (d) { if (d > G.waveMax) G.waveMax = d; });
  }

  function flashCallout(txt) {
    el.callout.textContent = txt;
    el.callout.hidden = false;
    clearTimeout(flashCallout._t);
    flashCallout._t = setTimeout(function () { el.callout.hidden = true; }, 1100);
  }

  function fmtTime(ms) {
    var s = Math.max(0, ms) / 1000;
    var m = Math.floor(s / 60);
    var r = s - m * 60;
    return m ? m + ":" + (r < 10 ? "0" : "") + r.toFixed(0) : r.toFixed(1) + "s";
  }

  function store(k, v) {
    try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); }
    catch (e) { return null; }
  }

  function gtagSafe(name, params) {
    try { if (typeof gtag === "function") gtag("event", name, params); } catch (e) {}
  }

  /* ---------------------------------------------------------------- audio */

  var audio = (function () {
    var ctxA = null, mix = null, master = null, revIn = null, on = true, ready = false;
    var SCALE = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];   // major pentatonic, two and a bit octaves
    var ROOT = 261.63;
    var lastSnag = 0, lastNote = 0, lastTouch = 0;

    function gate() {
      var now = performance.now();
      if (now - lastTouch < 40) return false;
      lastTouch = now;
      return true;
    }

    function ir(seconds, decay) {
      var rate = ctxA.sampleRate, len = Math.floor(rate * seconds);
      var buf = ctxA.createBuffer(2, len, rate);
      for (var ch = 0; ch < 2; ch++) {
        var d = buf.getChannelData(ch), lp = 0;
        for (var i = 0; i < len; i++) {
          lp += ((Math.random() * 2 - 1) - lp) * 0.34;   // lowpass, or the tail is grainy
          d[i] = lp * Math.pow(1 - i / len, decay);
        }
      }
      return buf;
    }

    function build() {
      if (ready) return;
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctxA = new AC();
      mix = ctxA.createGain();
      master = ctxA.createGain();
      master.gain.value = on ? 1 : 0;

      var comp = ctxA.createDynamicsCompressor();     // glue
      comp.threshold.value = -6; comp.ratio.value = 3; comp.knee.value = 6;
      comp.attack.value = 0.004; comp.release.value = 0.18;
      var limit = ctxA.createDynamicsCompressor();    // brickwall behind the glue
      limit.threshold.value = -1.5; limit.ratio.value = 20; limit.knee.value = 0;
      limit.attack.value = 0.002; limit.release.value = 0.09;

      var rev = ctxA.createConvolver();
      rev.buffer = ir(2.8, 2.6);
      var revG = ctxA.createGain(); revG.gain.value = 0.9;
      var revHP = ctxA.createBiquadFilter(); revHP.type = "highpass"; revHP.frequency.value = 260;
      var shelf = ctxA.createBiquadFilter(); shelf.type = "highshelf"; shelf.frequency.value = 3400; shelf.gain.value = 3;
      revIn = ctxA.createGain();
      revIn.connect(revHP); revHP.connect(rev); rev.connect(shelf); shelf.connect(revG); revG.connect(mix);

      mix.connect(master); master.connect(comp); comp.connect(limit); limit.connect(ctxA.destination);

      // iOS will not start a context without a real buffer played on a gesture
      var s = ctxA.createBufferSource();
      s.buffer = ctxA.createBuffer(1, 1, ctxA.sampleRate);
      s.connect(ctxA.destination); s.start(0);
      ready = true;
    }

    function chain(panv, send) {
      var g = ctxA.createGain();
      var p = ctxA.createStereoPanner ? ctxA.createStereoPanner() : null;
      if (p) { p.pan.value = Math.max(-1, Math.min(1, panv)); g.connect(p); p.connect(mix); }
      else g.connect(mix);
      var sg = ctxA.createGain(); sg.gain.value = send;
      g.connect(sg); sg.connect(revIn);
      return g;
    }

    function noise(seconds, shape) {
      var len = Math.max(1, Math.ceil(ctxA.sampleRate * seconds));
      var buf = ctxA.createBuffer(1, len, ctxA.sampleRate);
      var d = buf.getChannelData(0);
      for (var i = 0; i < len; i++) {
        var w = shape ? 1 - i / len : 1;
        d[i] = (Math.random() * 2 - 1) * w;
      }
      var src = ctxA.createBufferSource(); src.buffer = buf;
      return src;
    }

    /* A contact: a noise burst through parallel resonant bandpasses at the
     * object's own modes, opened by a wide lowpassed tack. The burst is 14ms
     * on purpose — a shorter click cannot push energy into a narrow filter,
     * so "crisper" would quietly also mean "quieter". */
    function contact(freqs, amp, panv, decay) {
      if (!ready) return;
      var t = ctxA.currentTime;
      var out = chain(panv, 0.3);
      out.gain.value = amp;

      var burst = noise(0.014, true);
      freqs.forEach(function (f, k) {
        var Q = 11 + k * 5;
        var bp = ctxA.createBiquadFilter();
        bp.type = "bandpass"; bp.frequency.value = f; bp.Q.value = Q;
        var g = ctxA.createGain();
        var d = decay / (1 + k * 0.7);
        var lvl = Math.sqrt(Q) * (k ? 0.45 / k : 1);   // narrow filters reject the burst; make it up
        g.gain.setValueAtTime(lvl, t);
        g.gain.exponentialRampToValueAtTime(1e-4, t + d);
        burst.connect(bp); bp.connect(g); g.connect(out);
      });

      var tack = noise(0.012, true);
      var lp = ctxA.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 5200; lp.Q.value = 0.6;
      var tg = ctxA.createGain();
      tg.gain.setValueAtTime(0.5, t);
      tg.gain.exponentialRampToValueAtTime(1e-4, t + 0.05);
      tack.connect(lp); lp.connect(tg); tg.connect(out);

      burst.start(t); tack.start(t);
      burst.stop(t + 0.02); tack.stop(t + 0.02);
      setTimeout(function () { try { out.disconnect(); } catch (e) {} }, (decay + 0.4) * 1000);
    }

    /* A long ringing tail cannot be modal — a bandpass cannot hold for two
     * seconds without screaming. Bells are additive and inharmonic. */
    var PARTIAL = [1, 2, 3.01, 4.17, 5.43, 6.79];
    // normalised to sum to 1, so `amp` is the voice's actual peak rather than
    // 2.14x it — the partial stack was the real gain stage all along
    var PGAIN = [0.467, 0.215, 0.140, 0.089, 0.056, 0.033];
    function bell(freq, amp, panv, dur) {
      if (!ready) return;
      var t = ctxA.currentTime;
      var out = chain(panv, 0.85);
      out.gain.value = amp;

      PARTIAL.forEach(function (r, k) {
        var o = ctxA.createOscillator();
        o.type = "sine";
        o.frequency.value = freq * r * (1 + (Math.random() - 0.5) * 0.004);
        var g = ctxA.createGain();
        var d = dur / (1 + k * 0.55);
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(PGAIN[k], t + 0.004);
        g.gain.exponentialRampToValueAtTime(1e-4, t + d);
        o.connect(g); g.connect(out);
        o.start(t); o.stop(t + d + 0.05);
      });

      // the strike: without it the bell arrives from nowhere
      var st = noise(0.01, true);
      var bp = ctxA.createBiquadFilter();
      bp.type = "bandpass"; bp.frequency.value = freq * 4.2; bp.Q.value = 1.1;
      var sg = ctxA.createGain();
      sg.gain.setValueAtTime(0.42, t);
      sg.gain.exponentialRampToValueAtTime(1e-4, t + 0.045);
      st.connect(bp); bp.connect(sg); sg.connect(out);
      st.start(t); st.stop(t + 0.02);

      setTimeout(function () { try { out.disconnect(); } catch (e) {} }, (dur + 0.6) * 1000);
    }

    function semi(n) { return ROOT * Math.pow(2, n / 12); }

    return {
      unlock: function () { build(); if (ctxA && ctxA.state === "suspended") ctxA.resume(); },
      get on() { return on; },
      toggle: function () {
        on = !on;
        if (master) master.gain.setTargetAtTime(on ? 1 : 0, ctxA.currentTime, 0.02);
        store(KEY_SOUND, on ? "1" : "0");
        return on;
      },
      init: function (o) { on = o; },
      grab: function (px) { if (gate()) contact([1180, 2640, 4120], 0.5, px, 0.16); },
      drop: function (px) { if (gate()) contact([760, 1810, 2930], 0.34, px, 0.2); },
      /* The note rises as the tangle clears, so the last few crossings resolve
       * into an ascending cadence instead of the same ping every time. */
      resolve: function (done, n) {
        if (!ready || !on) return;
        var now = performance.now();
        if (now - lastNote < 60) return;      // a drag can clear several at once
        lastNote = now;
        var i = Math.max(0, Math.min(SCALE.length - 1, Math.round(done * (SCALE.length - 1))));
        bell(semi(SCALE[i]), 0.26 + Math.min(0.09, n * 0.028), (Math.random() - 0.5) * 0.7, 1.5);
      },
      snag: function () {
        if (!ready || !on) return;
        var now = performance.now();
        if (now - lastSnag < 140) return;
        lastSnag = now;
        var t = ctxA.currentTime;
        var out = chain(0, 0.2); out.gain.value = 0.15;
        var o = ctxA.createOscillator(); o.type = "sine";
        o.frequency.setValueAtTime(128, t);
        o.frequency.exponentialRampToValueAtTime(58, t + 0.1);
        var g = ctxA.createGain();
        g.gain.setValueAtTime(0.9, t);
        g.gain.exponentialRampToValueAtTime(1e-4, t + 0.16);
        o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.2);
      },
      solve: function () {
        if (!ready || !on) return;
        [0, 4, 7, 9, 12].forEach(function (s, k) {
          setTimeout(function () { bell(semi(s), 0.18, (k - 2) * 0.32, 2.6); }, k * 85);
        });
      },
      ping: function (depth, panv) {
        if (!ready || !on) return;
        bell(semi(SCALE[Math.min(SCALE.length - 1, depth)] + 12), 0.12, panv, 1.2);
      }
    };
  })();

  /* --------------------------------------------------------------- layout */

  var view = { cx: 0, cy: 0, r: 1, rx: 1, ry: 1, nodeR: 9 };

  function layout() {
    DPR = Math.min(2, window.devicePixelRatio || 1);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

    var padX = 22;
    var padTop = H < 560 ? 58 : 76;
    var padBottom = W < 620 ? 128 : 112;
    var aw = Math.max(80, W - padX * 2);
    var ah = Math.max(80, H - padTop - padBottom);
    // Positions are normalised, so mapping x and y by different radii is just
    // an affine squash — and an affine map cannot create or remove a crossing,
    // so filling the screen costs the puzzle nothing.
    var rx = aw / 2 * 0.93, ry = ah / 2 * 0.93;
    var cap = 1.4;
    if (rx > ry * cap) rx = ry * cap;
    if (ry > rx * cap) ry = rx * cap;
    view.rx = rx; view.ry = ry;
    view.r = Math.min(rx, ry);
    view.cx = padX + aw / 2;
    view.cy = padTop + ah / 2;
    sizeNodes();

    stars = [];
    var count = Math.round(W * H / 11000);
    for (var i = 0; i < count; i++) {
      stars.push({
        x: Math.random() * W, y: Math.random() * H,
        r: Math.random() * 1.15 + 0.25,
        a: Math.random() * 0.4 + 0.12,
        p: Math.random() * TAU
      });
    }
  }

  function sizeNodes() {
    var n = Math.max(6, G.nodes.length);
    view.nodeR = Math.max(4.5, Math.min(13, view.r / (2.9 * Math.sqrt(n))));
  }

  function toScreen(n) { return { x: view.cx + n.x * view.rx, y: view.cy + n.y * view.ry }; }
  function toWorldX(px) { return (px - view.cx) / view.rx; }
  function toWorldY(py) { return (py - view.cy) / view.ry; }

  /* --------------------------------------------------------------- render */

  var COOL = [143, 233, 255];
  var HOT = [255, 92, 110];
  var GOLD = [255, 214, 138];

  function rgba(c, a) { return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + a + ")"; }

  function draw(now) {
    var t = now / 1000;

    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#04060f";
    ctx.fillRect(0, 0, W, H);

    var neb = ctx.createRadialGradient(view.cx, view.cy * 0.86, 0, view.cx, view.cy, Math.max(W, H) * 0.72);
    neb.addColorStop(0, "rgba(38,48,112,0.5)");
    neb.addColorStop(0.45, "rgba(20,24,64,0.28)");
    neb.addColorStop(1, "rgba(4,6,15,0)");
    ctx.fillStyle = neb;
    ctx.fillRect(0, 0, W, H);

    ctx.globalCompositeOperation = "lighter";
    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      var tw = reduceMotion ? 1 : 0.72 + 0.28 * Math.sin(t * 0.8 + s.p);
      ctx.fillStyle = "rgba(190,214,255," + (s.a * tw).toFixed(3) + ")";
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, TAU);
      ctx.fill();
    }

    if (!G.nodes.length) { ctx.globalCompositeOperation = "source-over"; return; }

    var waveT = G.wave >= 0 ? G.wave : -1;
    var drag = G.drag;

    /* Filaments: a wide soft pass for the glow, then a thin bright core. */
    for (var pass = 0; pass < 2; pass++) {
      for (var e = 0; e < G.edges.length; e++) {
        var ed = G.edges[e];
        var A = toScreen(G.nodes[ed.a]), B = toScreen(G.nodes[ed.b]);
        var hot = ed.cross > 0;
        var col = hot ? HOT : COOL;
        var amt = hot ? Math.min(1, 0.45 + ed.cross * 0.18) : 0.5;

        if (waveT >= 0) {
          var reach = waveT * 9;
          var lit = Math.max(0, 1 - Math.abs(reach - G.waveOrder[e]) * 0.55);
          col = GOLD;
          amt = 0.42 + lit * 0.58;
        }

        var lift = 0;
        if (drag && (ed.a === drag.node || ed.b === drag.node) && !reduceMotion) {
          lift = Math.max(-9, Math.min(9, -(drag.vx + drag.vy) * 0.5));
        }

        ctx.beginPath();
        ctx.moveTo(A.x, A.y);
        if (lift) {
          var mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2;
          var dx = B.x - A.x, dy = B.y - A.y, L = Math.hypot(dx, dy) || 1;
          ctx.quadraticCurveTo(mx - dy / L * lift, my + dx / L * lift, B.x, B.y);
        } else {
          ctx.lineTo(B.x, B.y);
        }
        ctx.lineCap = "round";
        if (pass === 0) {
          ctx.strokeStyle = rgba(col, 0.1 * amt);
          ctx.lineWidth = 7;
        } else {
          ctx.strokeStyle = rgba(col, 0.42 + 0.48 * amt);
          ctx.lineWidth = hot && waveT < 0 ? 1.7 : 1.3;
        }
        ctx.stroke();
      }
    }

    /* Crossing markers. Below a threshold each one is a precise target worth
     * pointing at; above it they would be a red smear, and the hot filaments
     * already say "chaos" on their own. */
    if (waveT < 0 && G.crossings > 0 && G.crossings <= 44) {
      G.pairs.forEach(function (k) {
        var i = Math.floor(k / 4096), j = k % 4096;
        var ei = G.edges[i], ej = G.edges[j];
        var p = segPoint(G.nodes[ei.a], G.nodes[ei.b], G.nodes[ej.a], G.nodes[ej.b]);
        if (!p) return;
        var sx = view.cx + p.x * view.rx, sy = view.cy + p.y * view.ry;
        var pulse = reduceMotion ? 1 : 0.72 + 0.28 * Math.sin(t * 3.4 + i);
        var g = ctx.createRadialGradient(sx, sy, 0, sx, sy, 15);
        g.addColorStop(0, "rgba(255,130,140," + (0.85 * pulse).toFixed(3) + ")");
        g.addColorStop(0.5, "rgba(255,100,118," + (0.22 * pulse).toFixed(3) + ")");
        g.addColorStop(1, "rgba(255,90,110,0)");
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(sx, sy, 15, 0, TAU); ctx.fill();
        ctx.strokeStyle = "rgba(255,196,202," + (0.5 * pulse).toFixed(3) + ")";
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(sx, sy, 5.4, 0, TAU); ctx.stroke();
        ctx.fillStyle = "rgba(255,236,236," + (0.95 * pulse).toFixed(3) + ")";
        ctx.beginPath(); ctx.arc(sx, sy, 2.3, 0, TAU); ctx.fill();
      });
    }

    for (var sp = sparks.length - 1; sp >= 0; sp--) {
      var k2 = sparks[sp];
      k2.life -= 0.045;
      if (k2.life <= 0) { sparks.splice(sp, 1); continue; }
      var px = view.cx + k2.x * view.rx, py = view.cy + k2.y * view.ry;
      var rr = (1 - k2.life) * 22 + 3;
      ctx.strokeStyle = "rgba(180,255,235," + (k2.life * 0.6).toFixed(3) + ")";
      ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(px, py, rr, 0, TAU); ctx.stroke();
    }

    /* Stars (the nodes). */
    for (var n = 0; n < G.nodes.length; n++) {
      var nd = G.nodes[n];
      var P = toScreen(nd);
      var isDrag = drag && drag.node === n;
      var isSel = G.sel === n;
      nd.aura += ((isDrag || isSel ? 1 : 0) - nd.aura) * 0.2;
      var R = view.nodeR * (1 + nd.aura * 0.28);
      var tint = waveT >= 0 ? GOLD : COOL;

      var hr = R * 3.4;
      var halo = ctx.createRadialGradient(P.x, P.y, 0, P.x, P.y, hr);
      halo.addColorStop(0, rgba(tint, 0.42 + nd.aura * 0.34));
      halo.addColorStop(0.22, rgba(tint, 0.14));
      halo.addColorStop(0.6, rgba(tint, 0.03));
      halo.addColorStop(1, rgba(tint, 0));
      ctx.fillStyle = halo;
      ctx.beginPath(); ctx.arc(P.x, P.y, hr, 0, TAU); ctx.fill();

      ctx.fillStyle = "rgba(255,255,255," + (0.88 + nd.aura * 0.12) + ")";
      ctx.beginPath(); ctx.arc(P.x, P.y, R * 0.58, 0, TAU); ctx.fill();

      // a ring wider than a fingertip, so the star you are holding is not
      // simply hidden under your own thumb
      if (nd.aura > 0.02) {
        ctx.strokeStyle = rgba(tint, 0.5 * nd.aura);
        ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(P.x, P.y, R + 20 + nd.aura * 6, 0, TAU); ctx.stroke();
      }
    }

    if (G.flash > 0) {
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = "rgba(120,150,255," + (G.flash * 0.16).toFixed(3) + ")";
      ctx.fillRect(0, 0, W, H);
      G.flash -= reduceMotion ? 0.12 : 0.028;
    }

    ctx.globalCompositeOperation = "source-over";
  }

  /* ---------------------------------------------------------------- input */

  function hitRadius() { return Math.max(view.nodeR * 2.4, coarse ? 26 : 15); }

  function pick(px, py) {
    var best = -1, bd = hitRadius();
    for (var i = 0; i < G.nodes.length; i++) {
      var P = toScreen(G.nodes[i]);
      var d = Math.hypot(P.x - px, P.y - py);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  function clampNode(n) {
    var d = Math.hypot(n.x, n.y);
    if (d > 1.06) { n.x = n.x / d * 1.06; n.y = n.y / d * 1.06; }
  }

  function onDown(ev) {
    audio.unlock();
    if (!G.running || G.solved) return;
    var px = ev.clientX, py = ev.clientY;
    var i = pick(px, py);
    if (i < 0) return;
    var P = toScreen(G.nodes[i]);
    G.drag = { node: i, ox: P.x - px, oy: P.y - py, vx: 0, vy: 0, lx: px, ly: py, moved: false };
    G.sel = i;
    G.held = false;
    canvas.setPointerCapture && canvas.setPointerCapture(ev.pointerId);
    audio.grab(Math.max(-1, Math.min(1, (px / W) * 2 - 1)));
    hideHint();
    ev.preventDefault();
  }

  function onMove(ev) {
    if (!G.drag) return;
    var px = ev.clientX, py = ev.clientY;
    var d = G.drag;
    d.vx = px - d.lx; d.vy = py - d.ly;
    d.lx = px; d.ly = py;
    if (Math.abs(d.vx) + Math.abs(d.vy) > 1) d.moved = true;
    var nd = G.nodes[d.node];
    nd.x = toWorldX(px + d.ox);
    nd.y = toWorldY(py + d.oy);
    clampNode(nd);
    recountNode(d.node);
    ev.preventDefault();
  }

  function onUp(ev) {
    if (!G.drag) return;
    var d = G.drag;
    G.drag = null;
    if (d.moved) audio.drop(Math.max(-1, Math.min(1, ((ev.clientX || 0) / W) * 2 - 1)));
    ev.preventDefault();
  }

  canvas.addEventListener("pointerdown", onDown, { passive: false });
  window.addEventListener("pointermove", onMove, { passive: false });
  window.addEventListener("pointerup", onUp, { passive: false });
  window.addEventListener("pointercancel", onUp, { passive: false });

  /* Keyboard play is a real way through the toy, not an afterthought: arrows
   * step the selection to the nearest star in that direction, space picks it
   * up, and then the same arrows carry it. */
  function stepSelection(dx, dy) {
    if (!G.nodes.length) return;
    if (G.sel < 0) { G.sel = 0; return; }
    var from = toScreen(G.nodes[G.sel]);
    var best = -1, bs = Infinity;
    for (var i = 0; i < G.nodes.length; i++) {
      if (i === G.sel) continue;
      var P = toScreen(G.nodes[i]);
      var vx = P.x - from.x, vy = P.y - from.y;
      var along = vx * dx + vy * dy;
      if (along <= 4) continue;
      var off = Math.abs(vx * dy - vy * dx);
      var s = along + off * 2.2;
      if (s < bs) { bs = s; best = i; }
    }
    if (best >= 0) G.sel = best;
  }

  window.addEventListener("keydown", function (ev) {
    if (!G.running || G.solved) {
      if (ev.key === "Enter" || ev.key === " ") {
        if (!el.overlay.hidden) { ev.preventDefault(); el.ovBtn.click(); }
      }
      return;
    }
    var dx = 0, dy = 0;
    if (ev.key === "ArrowLeft") dx = -1;
    else if (ev.key === "ArrowRight") dx = 1;
    else if (ev.key === "ArrowUp") dy = -1;
    else if (ev.key === "ArrowDown") dy = 1;
    else if (ev.key === " " || ev.key === "Enter") {
      ev.preventDefault();
      if (G.sel < 0) { G.sel = 0; return; }
      G.held = !G.held;
      audio.unlock();
      var pxx = Math.max(-1, Math.min(1, (toScreen(G.nodes[G.sel]).x / W) * 2 - 1));
      if (G.held) audio.grab(pxx); else audio.drop(pxx);
      hideHint();
      return;
    } else return;

    ev.preventDefault();
    hideHint();
    if (!G.held) { stepSelection(dx, dy); return; }
    var nd = G.nodes[G.sel];
    var step = (ev.shiftKey ? 3 : 14) / view.r;
    nd.x += dx * step; nd.y += dy * step;
    clampNode(nd);
    recountNode(G.sel);
  });

  /* ------------------------------------------------------------------ HUD */

  function hideHint() {
    if (el.hint && !el.hint.classList.contains("is-gone")) el.hint.classList.add("is-gone");
  }

  el.btnNew.addEventListener("click", function () { startLevel(G.level, false); });
  el.btnReset.addEventListener("click", function () { startLevel(1, true); });

  el.soundBtn.addEventListener("click", function () {
    audio.unlock();
    var on = audio.toggle();
    el.soundBtn.setAttribute("aria-pressed", on ? "true" : "false");
  });

  el.ovBtn.addEventListener("click", function () {
    audio.unlock();
    el.overlay.classList.add("is-out");
    setTimeout(function () { el.overlay.hidden = true; }, 240);
    startLevel(G.solved ? G.level + 1 : G.level, G.solved);
  });

  /* ----------------------------------------------------------------- loop */

  var lastPing = -1;

  function frame(now) {
    if (G.running && !G.solved) {
      G.elapsed = now - G.t0;
      el.time.textContent = fmtTime(G.elapsed);
    }
    if (G.wave >= 0) {
      G.wave += 1 / 60;
      var reach = Math.floor(G.wave * 9);
      if (reach !== lastPing && reach <= G.waveMax) {
        lastPing = reach;
        var every = Math.max(1, Math.round(G.waveMax / 7));
        if (reach % every === 0) audio.ping(reach, (Math.random() - 0.5) * 0.8);
      }
      if (G.wave * 9 > G.waveMax + 3) G.wave = -1;
    }
    draw(now);
    requestAnimationFrame(frame);
  }

  /* ----------------------------------------------------------------- init */

  function init() {
    var s = store(KEY_SOUND);
    var on = s !== "0";
    audio.init(on);
    el.soundBtn.setAttribute("aria-pressed", on ? "true" : "false");

    G.best = parseInt(store(KEY_BEST) || "0", 10) || 0;
    var start = Math.max(1, G.best);
    G.level = start;

    layout();
    generate(start);           // a live tangle sitting behind the intro panel
    sizeNodes();
    el.best.textContent = G.best ? "L" + G.best : "—";
    el.level.textContent = start;
    el.crossings.textContent = G.crossings;

    if (G.best >= 2) {
      el.ovEyebrow.textContent = "Welcome back";
      el.ovText.innerHTML =
        "<b>Drag a star until none of the filaments cross.</b><br />" +
        "Crossed filaments burn red; a clean one cools to white.<br />" +
        "Picking up where you left off, at <b>level " + start + "</b>.";
      el.ovBtn.textContent = "Play level " + start;
    }

    requestAnimationFrame(frame);
    gtagSafe("toy_open", { toy: "untangle" });
  }

  window.addEventListener("resize", function () {
    layout();
  });
  window.addEventListener("orientationchange", function () { setTimeout(layout, 120); });

  init();
})();
