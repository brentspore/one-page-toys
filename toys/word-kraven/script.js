/* Word Kraven — the unlimited practice edition, and a feeder for
 * wordkraven.com.
 *
 * ⚠ FEEDER RULES (house checklist, `new-toy` skill -> "Feeder toys"):
 * practice ONLY, no daily, no streaks, and **no email capture here** — capture
 * belongs on the game's own domain. Two tagged CTAs, a share line carrying ONE
 * tagged link to the daily, and a countdown that must target the daily's ACTUAL
 * rollover.
 *
 * ⚠ wordkraven.com keys its daily on a LOCAL date (`EPOCH` + local midnight in
 * that repo's `src/game/daily.ts`), so this counts down to local midnight. If
 * that ever flips to UTC this must flip with it, or the banner lies to players.
 *
 * Unlike the daily, grids here are generated and screened IN THE BROWSER: the
 * dictionary is loaded anyway, solving one 4x4 takes a couple of milliseconds,
 * and practice results are deliberately not comparable between players so there
 * is nothing to keep stable.
 */
(function () {
  "use strict";

  var GRID = 4, MINLEN = 4, BAND_LO = 30, BAND_HI = 65;

  var gridEl = document.getElementById("grid");
  var trailCanvas = document.getElementById("trailCanvas");
  var trailEl = document.getElementById("trail");
  var statEl = document.getElementById("stat");
  var rankEl = document.getElementById("rank");
  var toNextEl = document.getElementById("toNext");
  var meterEl = document.getElementById("meterFill");
  var foundEl = document.getElementById("found");
  var hintEl = document.getElementById("hint");
  var newBtn = document.getElementById("newBtn");
  var soundBtn = document.getElementById("soundBtn");
  var overlay = document.getElementById("overlay");
  var ovBtn = document.getElementById("ovBtn");
  var dailyEl = document.getElementById("daily");
  var dailyTime = document.getElementById("dailyTime");
  var ctaEl = document.getElementById("cta");
  var ctaLine = document.getElementById("ctaLine");
  var ctaBtn = document.getElementById("ctaBtn");

  var RANKS = [
    { name: "Stirring", at: 0.00 }, { name: "Prowling", at: 0.08 },
    { name: "Hunting", at: 0.18 }, { name: "Stalking", at: 0.30 },
    { name: "Ravenous", at: 0.45 }, { name: "Kraven", at: 0.62 }
  ];

  var trie = null, letters = [], total = 0, found = [], score = 0, path = [], state = "idle";
  var runs = 0;
  try { runs = parseInt(localStorage.getItem("wordkraven_runs") || "0", 10) || 0; } catch (e) {}

  // ------------------------------------------------------------- dictionary

  function buildTrie(text) {
    var root = {};
    var lines = text.split("\n");
    for (var i = 0; i < lines.length; i++) {
      var w = lines[i].trim();
      if (!w) continue;
      var n = root;
      for (var k = 0; k < w.length; k++) {
        var c = w[k];
        n = n[c] || (n[c] = {});
      }
      n.$ = 1;
    }
    return root;
  }
  function walk(w) {
    var n = trie;
    if (!n) return null;
    for (var i = 0; i < w.length; i++) {
      n = n[w[i]];
      if (!n) return null;
    }
    return n;
  }
  function isWord(w) { var n = walk(w); return !!n && !!n.$; }
  function isPrefix(w) { return walk(w) !== null; }

  // ------------------------------------------------------------ grid + solve

  var FREQ = { e:12.7,t:9.1,a:8.2,o:7.5,i:7.0,n:6.7,s:6.3,h:6.1,r:6.0,d:4.3,l:4.0,c:2.8,u:2.8,
               m:2.4,w:2.4,f:2.2,g:2.0,y:2.0,p:1.9,b:1.5,v:1.0,k:0.8,j:0.15,x:0.15,q:0.10,z:0.07 };
  var BAG = [];
  for (var ch in FREQ) for (var i2 = 0; i2 < Math.round(FREQ[ch] * 10); i2++) BAG.push(ch);

  var NB = [];
  for (var i3 = 0; i3 < GRID * GRID; i3++) {
    var r = (i3 / GRID) | 0, c3 = i3 % GRID, list = [];
    for (var dr = -1; dr <= 1; dr++) for (var dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      var rr = r + dr, cc = c3 + dc;
      if (rr >= 0 && rr < GRID && cc >= 0 && cc < GRID) list.push(rr * GRID + cc);
    }
    NB.push(list);
  }

  function randomGrid() {
    var g, vowels;
    do {
      g = [];
      for (var i = 0; i < GRID * GRID; i++) g.push(BAG[(Math.random() * BAG.length) | 0]);
      vowels = 0;
      for (var k = 0; k < g.length; k++) if ("aeiou".indexOf(g[k]) >= 0) vowels++;
    } while (vowels < 5);
    return g;
  }

  function solve(g) {
    var out = {}, n = 0, seen = new Uint8Array(GRID * GRID);
    function dfs(i, node, str) {
      var nx = node[g[i]];
      if (!nx) return;
      var s2 = str + g[i];
      seen[i] = 1;
      if (nx.$ && s2.length >= MINLEN && !out[s2]) { out[s2] = 1; n++; }
      for (var k = 0; k < NB[i].length; k++) if (!seen[NB[i][k]]) dfs(NB[i][k], nx, s2);
      seen[i] = 0;
    }
    for (var i = 0; i < GRID * GRID; i++) dfs(i, trie, "");
    return n;
  }

  /* Screen exactly as the daily does: a grid with almost nothing in it is a
   * bad board, and one with too much makes the denominator hopeless. */
  function screenedGrid() {
    for (var tries = 0; tries < 400; tries++) {
      var g = randomGrid();
      var n = solve(g);
      if (n >= BAND_LO && n <= BAND_HI) return { g: g, n: n };
    }
    var fallback = randomGrid();
    return { g: fallback, n: solve(fallback) };
  }

  // ------------------------------------------------------------------ audio

  var actx = null, bus = null, verb = null, muted = false;
  try { muted = localStorage.getItem("wordkraven_sound") === "off"; } catch (e) {}

  function initAudio() {
    if (actx) { if (actx.state === "suspended") actx.resume(); return; }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    actx = new AC();
    var b = actx.createBuffer(1, 1, 22050);
    var s = actx.createBufferSource(); s.buffer = b; s.connect(actx.destination); s.start(0);
    bus = actx.createGain(); bus.gain.value = muted ? 0 : 0.9;
    var comp = actx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 3;
    comp.connect(bus); bus.connect(actx.destination);
    var len = Math.floor(actx.sampleRate * 0.7);
    var ir = actx.createBuffer(2, len, actx.sampleRate);
    for (var ch2 = 0; ch2 < 2; ch2++) {
      var d = ir.getChannelData(ch2), last = 0;
      for (var i = 0; i < len; i++) {
        var t = i / len, nz = (Math.random() * 2 - 1) * Math.pow(1 - t, 3.2);
        last = last * 0.5 + nz * 0.5; d[i] = last;
      }
    }
    verb = actx.createConvolver(); verb.buffer = ir;
    var vg = actx.createGain(); vg.gain.value = 0.22;
    verb.connect(vg); vg.connect(comp);
    target = comp;
  }
  var target = null;

  function noiseBuf(sec) {
    var len = Math.floor(actx.sampleRate * sec);
    var b = actx.createBuffer(1, len, actx.sampleRate);
    var d = b.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  /* Modal: noise through resonant bandpasses at the object's own modes. A
   * stack of clean oscillators is a chord, not an object. */
  /* ⚠ LEVELS. Measured, after this shipped inaudible at a peak of 0.013 (about
   * -38dBFS). Gain scales roughly linearly with amp, but the EXCITATION BURST
   * LENGTH matters more: at the same amp a 2ms burst measured 0.19 peak and a
   * 20ms burst 0.47, because a very short click cannot push energy into a
   * narrow resonator. Short bursts plus amps around 0.2 compounded to silence.
   * A highpass above the fundamental was suspected and measured innocent. */
  function modal(base, amp, modes, burst, hp) {
    if (!actx || !target || muted) return;
    var t = actx.currentTime;
    var ex = actx.createBufferSource(); ex.buffer = noiseBuf(0.05);
    var f = actx.createBiquadFilter(); f.type = "highpass"; f.frequency.value = hp || 300;
    var eg = actx.createGain();
    eg.gain.setValueAtTime(1, t);
    eg.gain.exponentialRampToValueAtTime(0.0001, t + (burst || 0.003));
    ex.connect(f); f.connect(eg);
    var longest = 0;
    for (var i = 0; i < modes.length; i++) {
      var freq = base * modes[i][0];
      if (freq > 15000) continue;
      var decay = modes[i][2];
      longest = Math.max(longest, decay);
      var Q = Math.max(1.2, Math.PI * freq * decay);
      var bp = actx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = freq; bp.Q.value = Q;
      var gn = actx.createGain();
      gn.gain.setValueAtTime(modes[i][1] * amp * Math.sqrt(Q) * 6, t);
      gn.gain.exponentialRampToValueAtTime(0.0004, t + decay);
      eg.connect(bp); bp.connect(gn); gn.connect(target);
      if (verb) gn.connect(verb);
    }
    ex.start(t); ex.stop(t + longest + 0.1);
  }
  var LADDER = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26];
  function playStep(i) { modal(196 * Math.pow(2, LADDER[Math.min(i, 11)] / 12), 2.6, [[1,0.9,0.10],[2.01,0.4,0.06],[3.02,0.16,0.04]], 0.007, 120); }
  function playFound(len) {
    var f = 261.63 * Math.pow(2, LADDER[Math.min(len - 2, 11)] / 12);
    [1, 1.5, 2].forEach(function (m, i) {
      setTimeout(function () { modal(f * m, 5.5 / (i + 1), [[1,0.9,0.5],[2,0.5,0.36],[3.01,0.3,0.24]], 0.006, 140); }, i * 55);
    });
  }
  function playDud() { modal(150, 2.2, [[1,0.8,0.07],[1.9,0.3,0.04]], 0.010, 60); }
  function playRank() {
    [0, 7, 12, 16].forEach(function (s, i) {
      setTimeout(function () { modal(392 * Math.pow(2, s / 12), 4.5, [[1,0.9,0.9],[2,0.5,0.6],[3.01,0.28,0.4]], 0.006, 160); }, i * 90);
    });
  }

  // ------------------------------------------------------------------- game

  function rankFor(f, t) {
    var out = RANKS[0], frac = t > 0 ? f / t : 0;
    for (var i = 0; i < RANKS.length; i++) if (frac >= RANKS[i].at) out = RANKS[i];
    return out;
  }
  function nextRank(f, t) {
    var frac = t > 0 ? f / t : 0;
    for (var i = 0; i < RANKS.length; i++) if (RANKS[i].at > frac) return RANKS[i];
    return null;
  }
  function scoreWord(w) {
    var n = w.length;
    return n <= 4 ? 1 : n === 5 ? 2 : n === 6 ? 3 : n === 7 ? 5 : 11;
  }

  function newGrid() {
    var picked = screenedGrid();
    letters = picked.g; total = picked.n;
    found = []; score = 0; path = []; state = "idle";
    renderGrid();
    render();
  }

  function renderGrid() {
    gridEl.innerHTML = "";
    for (var i = 0; i < letters.length; i++) {
      var el = document.createElement("span");
      el.className = "tile";
      el.setAttribute("data-index", String(i));
      el.textContent = letters[i].toUpperCase();
      gridEl.appendChild(el);
    }
  }

  function render() {
    var tiles = gridEl.children;
    for (var i = 0; i < tiles.length; i++) {
      var pos = path.indexOf(i);
      tiles[i].className = "tile" + (pos >= 0 ? " tile--on tile--" + state : "") + (pos === 0 ? " tile--head" : "");
    }
    var w = word();
    trailEl.textContent = w || " ";
    trailEl.className = "trail trail--" + state;
    statEl.textContent = found.length + " of " + total + " · " + score + " pts";
    var rk = rankFor(found.length, total), nx = nextRank(found.length, total);
    rankEl.textContent = rk.name;
    toNextEl.textContent = nx ? (Math.max(1, Math.ceil(nx.at * total) - found.length) + " more to " + nx.name) : "top rank";
    meterEl.style.width = (total ? Math.round(found.length / total * 100) : 0) + "%";
    if (found.length) {
      var groups = {};
      for (var k = 0; k < found.length; k++) (groups[found[k].length] = groups[found[k].length] || []).push(found[k]);
      var lens = Object.keys(groups).sort(function (a, b) { return b - a; });
      var html = "";
      for (var g = 0; g < lens.length; g++) {
        html += '<div class="foundrow"><span class="foundlen">' + lens[g] + '</span><span class="foundwords">' +
                groups[lens[g]].sort().join(" ") + "</span></div>";
      }
      foundEl.innerHTML = html;
      hintEl.hidden = true;
    } else {
      foundEl.innerHTML = "";
      hintEl.hidden = false;
    }
    drawTrail();
  }

  function word() {
    var s = "";
    for (var i = 0; i < path.length; i++) s += letters[path[i]];
    return s;
  }

  function setState() {
    var w = word();
    if (w.length < MINLEN) state = (!w || isPrefix(w)) ? "idle" : "dead";
    else if (found.indexOf(w) >= 0) state = "already";
    else if (isWord(w)) state = "word";
    else state = isPrefix(w) ? "maybe" : "dead";
  }

  function commit() {
    var w = word();
    var drawn = samples.slice();
    samples = [];
    if (w.length >= MINLEN && isWord(w) && found.indexOf(w) < 0) {
      var before = rankFor(found.length, total).name;
      found.push(w); score += scoreWord(w);
      playFound(w.length);
      if (rankFor(found.length, total).name !== before) playRank();
      showCta();
      if (drawn.length > 1) celebrate(drawn);
    } else if (path.length >= MINLEN) {
      playDud();
    }
    path = []; state = "idle";
    render();
  }


  // ------------------------------------------------------------------ trail
  /* A light trail showing where the cursor actually went.
   *
   * ⚠ This strokes the FREEHAND PATH — every sampled pointer position — the way
   * Perfect Circle does. An earlier version connected tile CENTRES and it was
   * wrong in the way that matters: the line popped from letter to letter
   * instead of following the hand, and ended inside a tile rather than at the
   * cursor. The tiles already show which letters are locked in; the trail's job
   * is to record the gesture.
   *
   * ⚠ Trace the path in ONE continuous stroke per pass. Under `lighter` the
   * round cap at every sample overlaps its neighbour, and stroking segment by
   * segment beads the trail into a dotted line. */
  var TONE = {
    idle:    { h: 38,  s: 100, l: 72 },
    maybe:   { h: 42,  s: 100, l: 74 },
    word:    { h: 145, s: 85,  l: 70 },
    already: { h: 215, s: 90,  l: 76 },
    dead:    { h: 265, s: 12,  l: 62 }
  };
  var MIN_STEP = 2.5, MAX_POINTS = 320, CELEBRATE_MS = 650;
  var samples = [], celebration = null, celebRaf = 0;

  function sizeTrail() {
    var r = trailCanvas.getBoundingClientRect();
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
    if (trailCanvas.width !== w || trailCanvas.height !== h) { trailCanvas.width = w; trailCanvas.height = h; }
    var ctx = trailCanvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  }

  function pushSample(x, y) {
    var r = trailCanvas.getBoundingClientRect();
    var p = { x: x - r.left, y: y - r.top };
    var last = samples[samples.length - 1];
    if (last) {
      var dx = p.x - last.x, dy = p.y - last.y;
      if (dx * dx + dy * dy < MIN_STEP * MIN_STEP) return;
    }
    if (samples.length >= MAX_POINTS) samples.shift();
    samples.push(p);
  }

  function tracePts(ctx, pts, from) {
    ctx.beginPath();
    if (pts.length - from < 2) {
      var only = pts[pts.length - 1];
      ctx.moveTo(only.x, only.y); ctx.lineTo(only.x + 0.01, only.y); ctx.stroke();
      return;
    }
    ctx.moveTo(pts[from].x, pts[from].y);
    for (var i = from + 1; i < pts.length - 1; i++) {
      var mx = (pts[i].x + pts[i + 1].x) / 2, my = (pts[i].y + pts[i + 1].y) / 2;
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
    }
    var last = pts[pts.length - 1];
    ctx.lineTo(last.x, last.y);
    ctx.stroke();
  }

  function drawTrail() {
    if (celebration) return;                 // the payoff owns the canvas
    var ctx = sizeTrail();
    var r = trailCanvas.getBoundingClientRect();
    ctx.clearRect(0, 0, r.width, r.height);
    if (!samples.length) return;
    var t = TONE[state] || TONE.idle;
    function hsl(l, a) { return "hsla(" + t.h + ", " + t.s + "%, " + l + "%, " + a + ")"; }

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineJoin = "round"; ctx.lineCap = "round";
    ctx.strokeStyle = hsl(t.l - 6, 0.16); ctx.lineWidth = 26; tracePts(ctx, samples, 0);
    ctx.strokeStyle = hsl(t.l + 4, 0.30);  ctx.lineWidth = 11; tracePts(ctx, samples, 0);
    ctx.strokeStyle = hsl(Math.min(96, t.l + 20), 0.92); ctx.lineWidth = 3; tracePts(ctx, samples, 0);
    // the head carries the light
    ctx.strokeStyle = hsl(Math.min(98, t.l + 24), 0.55); ctx.lineWidth = 7;
    tracePts(ctx, samples, Math.max(0, samples.length - 26));

    var head = samples[samples.length - 1];
    var g = ctx.createRadialGradient(head.x, head.y, 0, head.x, head.y, 20);
    g.addColorStop(0, hsl(96, 0.95));
    g.addColorStop(0.4, hsl(t.l + 10, 0.35));
    g.addColorStop(1, hsl(t.l, 0));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(head.x, head.y, 20, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  /* When a word lands the trail pays off rather than vanishing: it flares
   * white-hot along its length, throws sparks, then lifts and fades. Short on
   * purpose — a reward that outstays the next gesture becomes lag. */
  function makeSparks(pts, hue) {
    var out = [], count = Math.min(22, 8 + Math.floor(pts.length / 8));
    for (var i = 0; i < count; i++) {
      var t = Math.pow(Math.random(), 0.6);
      var p = pts[Math.min(pts.length - 1, Math.floor(t * pts.length))];
      var ang = Math.random() * Math.PI * 2, sp = 26 + Math.random() * 90;
      out.push({ x: p.x, y: p.y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 30,
                 life: 0.55 + Math.random() * 0.45, hue: hue + Math.random() * 26 - 8 });
    }
    return out;
  }

  function drawCelebration(pts, sparks, prog) {
    var ctx = sizeTrail();
    var r = trailCanvas.getBoundingClientRect();
    ctx.clearRect(0, 0, r.width, r.height);
    if (!pts.length) return;
    var t = TONE.word;
    var p = Math.max(0, Math.min(1, prog));
    var flare = p < 0.18 ? p / 0.18 : 1;
    var fade = p < 0.30 ? 1 : 1 - (p - 0.30) / 0.70;
    function hsl(l, a) { return "hsla(" + t.h + ", " + t.s + "%, " + l + "%, " + a + ")"; }

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineJoin = "round"; ctx.lineCap = "round";
    ctx.translate(0, -p * 14);
    ctx.strokeStyle = hsl(t.l, 0.30 * flare * fade); ctx.lineWidth = 34 + 26 * flare; tracePts(ctx, pts, 0);
    ctx.strokeStyle = hsl(t.l + 14, 0.45 * flare * fade); ctx.lineWidth = 13; tracePts(ctx, pts, 0);
    ctx.strokeStyle = "hsla(" + t.h + ", " + t.s + "%, 98%, " + (0.95 * flare * fade) + ")";
    ctx.lineWidth = 3.5; tracePts(ctx, pts, 0);
    ctx.restore();

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    var tt = p * (CELEBRATE_MS / 1000);
    for (var i = 0; i < sparks.length; i++) {
      var s2 = sparks[i], life = 1 - p / s2.life;
      if (life <= 0) continue;
      var x = s2.x + s2.vx * tt, y = s2.y + s2.vy * tt + 160 * tt * tt;
      var rad = 2.4 * life + 0.6;
      var sg = ctx.createRadialGradient(x, y, 0, x, y, rad * 3.4);
      sg.addColorStop(0, "hsla(" + s2.hue + ", 95%, 92%, " + (0.9 * life) + ")");
      sg.addColorStop(1, "hsla(" + s2.hue + ", 95%, 70%, 0)");
      ctx.fillStyle = sg;
      ctx.beginPath(); ctx.arc(x, y, rad * 3.4, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  function celebrate(pts) {
    celebration = { pts: pts, sparks: makeSparks(pts, 145), start: performance.now() };
    cancelAnimationFrame(celebRaf);
    (function step() {
      if (!celebration) return;
      var prog = (performance.now() - celebration.start) / CELEBRATE_MS;
      if (prog >= 1) { celebration = null; drawTrail(); return; }
      drawCelebration(celebration.pts, celebration.sparks, prog);
      celebRaf = requestAnimationFrame(step);
    })();
  }
  window.addEventListener("resize", drawTrail);

  // ---------------------------------------------------------------- pointer
  /* One pointer path. With touch, events keep firing at the element the gesture
   * STARTED on, so the handlers live on the container and hit-test the point. */
  var dragging = false;
  function indexAt(x, y) {
    var el = document.elementFromPoint(x, y);
    var t = el && el.closest ? el.closest("[data-index]") : null;
    if (!t || !gridEl.contains(t)) return -1;
    return parseInt(t.getAttribute("data-index"), 10);
  }
  gridEl.addEventListener("pointerdown", function (e) {
    initAudio();
    var i = indexAt(e.clientX, e.clientY);
    if (i < 0) return;
    dragging = true;
    celebration = null;
    samples = [];
    pushSample(e.clientX, e.clientY);
    if (gridEl.setPointerCapture) { try { gridEl.setPointerCapture(e.pointerId); } catch (er) {} }
    path = [i]; setState(); playStep(0); render();
    dismissHint();
  });
  gridEl.addEventListener("pointermove", function (e) {
    if (!dragging) return;
    /* Sample coalesced moves too: on a fast flick the browser batches several
     * positions into one event, and taking only the last turns a curve into a
     * straight chord. */
    var raw = e.getCoalescedEvents ? e.getCoalescedEvents() : null;
    if (raw && raw.length) { for (var q = 0; q < raw.length; q++) pushSample(raw[q].clientX, raw[q].clientY); }
    else pushSample(e.clientX, e.clientY);
    var i = indexAt(e.clientX, e.clientY);
    if (i < 0) { drawTrail(); return; }
    if (path.length >= 2 && i === path[path.length - 2]) { path.pop(); setState(); render(); return; }
    if (path.indexOf(i) >= 0) return;
    var last = path[path.length - 1];
    var ar = (last / GRID) | 0, ac = last % GRID, br = (i / GRID) | 0, bc = i % GRID;
    if (Math.abs(ar - br) > 1 || Math.abs(ac - bc) > 1) return;
    path.push(i); setState(); playStep(path.length - 1); render();
  });
  function up() { if (!dragging) return; dragging = false; commit(); }
  gridEl.addEventListener("pointerup", up);
  gridEl.addEventListener("pointercancel", up);

  function dismissHint() { if (hintEl) hintEl.classList.add("is-gone"); }

  // ------------------------------------------------------------------ feeder

  function tickCountdown() {
    var now = new Date();
    var next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0).getTime();
    var left = Math.max(0, next - now.getTime());
    var h = Math.floor(left / 3600000), m = Math.floor(left / 60000) % 60, s = Math.floor(left / 1000) % 60;
    dailyTime.textContent = h + "h " + (m < 10 ? "0" : "") + m + "m " + (s < 10 ? "0" : "") + s + "s";
    dailyEl.title = "A new grid lands in " + h + "h " + m + "m at wordkraven.com";
  }
  tickCountdown();
  setInterval(tickCountdown, 1000);

  function showCta() {
    if (found.length < 3) return;
    ctaEl.hidden = false;
    if (runs >= 3) {
      dailyEl.classList.add("is-hot");
      ctaLine.innerHTML = "That is <b>" + runs + " grids</b> in the practice edition. " +
        "The daily gives everyone the <b>same grid</b> — and a streak for coming back.";
      ctaBtn.textContent = "Start a streak →";
    } else {
      ctaLine.innerHTML = "Everyone gets the <b>same grid</b> on the daily, with a rank to chase " +
        "and a streak for turning up.";
      ctaBtn.textContent = "Play today's grid →";
    }
  }

  function track(name, params) {
    if (window.gtag) { try { gtag("event", name, params); } catch (e) {} }
  }
  document.addEventListener("click", function (e) {
    var t = e.target && e.target.closest ? e.target.closest(".opt-share") : null;
    if (t) track("share", { method: "wordkraven_feeder", value: found.length });
  });
  [[dailyEl, "banner"], [ctaBtn, "post_round"]].forEach(function (pair) {
    pair[0].addEventListener("click", function () {
      track("outbound_click", { destination: "wordkraven.com", link_id: pair[1] });
    });
  });

  // ------------------------------------------------------------------ chrome

  soundBtn.addEventListener("click", function () {
    muted = !muted;
    if (bus && actx) bus.gain.setTargetAtTime(muted ? 0 : 0.9, actx.currentTime, 0.02);
    soundBtn.setAttribute("aria-pressed", String(!muted));
    soundBtn.textContent = muted ? "♪̸" : "♪";
    try { localStorage.setItem("wordkraven_sound", muted ? "off" : "on"); } catch (e) {}
  });
  soundBtn.setAttribute("aria-pressed", String(!muted));
  soundBtn.textContent = muted ? "♪̸" : "♪";

  newBtn.addEventListener("click", function () {
    initAudio();
    runs++;
    try { localStorage.setItem("wordkraven_runs", String(runs)); } catch (e) {}
    newGrid();
    ctaEl.hidden = true;
  });

  ovBtn.addEventListener("click", function () {
    initAudio();
    overlay.hidden = true;
    newGrid();
  });

  // ------------------------------------------------------------------- boot

  fetch("words.txt")
    .then(function (r) { return r.text(); })
    .then(function (text) {
      trie = buildTrie(text);
      ovBtn.disabled = false;
      ovBtn.textContent = "Start hunting";
    })
    .catch(function () {
      ovBtn.textContent = "Dictionary failed to load";
    });
})();
