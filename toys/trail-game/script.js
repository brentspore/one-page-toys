/* The Trail Game — practice edition (a random-puzzle feeder for thetrailgame.com).
 *
 * Same game as the daily at thetrailgame.com: draw ONE continuous trail that fills every
 * square of a 6x6 grid, threading the numbered dots in order (1 -> 2 -> 3 ...), never
 * crossing a wall. This build serves an endless supply of RANDOM practice puzzles and points
 * players to the daily challenge (same puzzle for everyone, worldwide) on the real site.
 *
 * The puzzle generator is ported verbatim from the-trail-game repo (src/lib/game/*) so the
 * puzzles look and feel identical — cyrb53 + mulberry32 PRNG, a serpentine Hamiltonian path
 * shuffled by 4000 "backbite" steps, dots placed along it, walls drawn only on non-solution
 * edges (so every puzzle is guaranteed solvable). */
(function () {
  "use strict";

  var SITE = "https://thetrailgame.com";
  var SIZE = 6;

  /* ============================ PRNG (cyrb53 + mulberry32) ============================ */
  function cyrb53(str, seed) {
    seed = seed || 0;
    var h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
    for (var i = 0; i < str.length; i++) {
      var ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
    h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
    h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
  }
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function rngFromString(s) { return mulberry32(cyrb53(s)); }

  /* ============================ types / helpers ============================ */
  function sameCell(a, b) { return a.r === b.r && a.c === b.c; }
  function isAdjacent(a, b) { return Math.abs(a.r - b.r) + Math.abs(a.c - b.c) === 1; }
  function edgeKey(a, b) {
    var x, y;
    if (a.r < b.r || (a.r === b.r && a.c < b.c)) { x = a; y = b; } else { x = b; y = a; }
    return x.r + "," + x.c + "|" + y.r + "," + y.c;
  }

  /* ============================ generator (ported) ============================ */
  function serpentine(size) {
    var path = [];
    for (var r = 0; r < size; r++) {
      if (r % 2 === 0) { for (var c = 0; c < size; c++) path.push({ r: r, c: c }); }
      else { for (var c2 = size - 1; c2 >= 0; c2--) path.push({ r: r, c: c2 }); }
    }
    return path;
  }
  function neighbors(cell, size) {
    var r = cell.r, c = cell.c, out = [];
    if (r > 0) out.push({ r: r - 1, c: c });
    if (r < size - 1) out.push({ r: r + 1, c: c });
    if (c > 0) out.push({ r: r, c: c - 1 });
    if (c < size - 1) out.push({ r: r, c: c + 1 });
    return out;
  }
  function backbite(path, rng) {
    var useEnd = rng() < 0.5;
    var endIdx = useEnd ? path.length - 1 : 0;
    var end = path[endIdx];
    var adjOnPath = path[useEnd ? path.length - 2 : 1];
    var nbrs = neighbors(end, SIZE).filter(function (n) { return !sameCell(n, adjOnPath); });
    if (nbrs.length === 0) return path;
    var pick = nbrs[Math.floor(rng() * nbrs.length)];
    var idx = -1;
    for (var i = 0; i < path.length; i++) { if (sameCell(path[i], pick)) { idx = i; break; } }
    if (idx < 0) return path;
    if (useEnd) {
      return path.slice(0, idx + 1).concat(path.slice(idx + 1).reverse());
    } else {
      return path.slice(0, idx).reverse().concat(path.slice(idx));
    }
  }
  function generatePath(rng, iterations) {
    var p = serpentine(SIZE);
    for (var i = 0; i < (iterations || 4000); i++) p = backbite(p, rng);
    return p;
  }
  function placeDots(path, count, rng) {
    var dots = [], n = path.length;
    dots.push({ cell: path[0], value: 1 });
    dots.push({ cell: path[n - 1], value: count });
    for (var i = 1; i < count - 1; i++) {
      var base = Math.round((i * (n - 1)) / (count - 1));
      var jitter = Math.floor((rng() - 0.5) * 3);
      var idx = base + jitter;
      idx = Math.max(2, Math.min(n - 3, idx));
      while (dots.some(function (d) { return sameCell(d.cell, path[idx]); })) idx++;
      dots.push({ cell: path[idx], value: i + 1 });
    }
    dots.sort(function (a, b) { return a.value - b.value; });
    return dots;
  }
  function allEdges(size) {
    var edges = [];
    for (var r = 0; r < size; r++) for (var c = 0; c < size; c++) {
      if (c + 1 < size) edges.push([{ r: r, c: c }, { r: r, c: c + 1 }]);
      if (r + 1 < size) edges.push([{ r: r, c: c }, { r: r + 1, c: c }]);
    }
    return edges;
  }
  function pickWalls(path, rng, count) {
    var used = {};
    for (var i = 0; i < path.length - 1; i++) used[edgeKey(path[i], path[i + 1])] = true;
    var candidates = allEdges(SIZE).map(function (e) { return edgeKey(e[0], e[1]); })
      .filter(function (k) { return !used[k]; });
    for (var j = candidates.length - 1; j > 0; j--) {
      var k = Math.floor(rng() * (j + 1));
      var tmp = candidates[j]; candidates[j] = candidates[k]; candidates[k] = tmp;
    }
    return candidates.slice(0, Math.min(count, candidates.length));
  }
  // difficulty -> dot/wall counts (Easy = more dots + fewer walls)
  var DIFFS = {
    easy:   { dots: 6, walls: 3, label: "Easy" },
    medium: { dots: 5, walls: 5, label: "Medium" },
    hard:   { dots: 4, walls: 8, label: "Hard" }
  };
  function generatePuzzle(diffKey) {
    var d = DIFFS[diffKey] || DIFFS.medium;
    var seed = "u:" + Date.now() + ":" + Math.floor(Math.random() * 1e9);
    var rng = rngFromString(seed);
    var path = generatePath(rng);
    return { size: SIZE, dots: placeDots(path, d.dots, rng), walls: pickWalls(path, rng, d.walls), solution: path, seed: seed, diff: diffKey };
  }

  /* ============================ DOM ============================ */
  var svg = document.getElementById("board");
  var dashCount = document.getElementById("dashCount");
  var dotTrack = document.getElementById("dotTrack");
  var timeEl = document.getElementById("timeVal");
  var barFill = document.getElementById("barFill");
  var cleanBadge = document.getElementById("cleanBadge");
  var statusEl = document.getElementById("status");
  var newBtn = document.getElementById("newBtn");
  var diffBtn = document.getElementById("diffBtn");
  var soundBtn = document.getElementById("soundBtn");
  var themeBtn = document.getElementById("themeBtn");
  var hintEl = document.getElementById("hint");
  var solved = document.getElementById("solved");
  var solvedTime = document.getElementById("solvedTime");
  var solvedSub = document.getElementById("solvedSub");
  var shareBtn = document.getElementById("shareBtn");
  var againBtn = document.getElementById("againBtn");
  var countdownEls = Array.prototype.slice.call(document.querySelectorAll(".js-countdown"));
  var toast = document.getElementById("toast");
  var SVGNS = "http://www.w3.org/2000/svg";

  var REDMO = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ============================ state ============================ */
  var puzzle = null, wallSet = null, dotMap = null, maxDot = 0, startCell = null;
  var path = [], drawing = false, backtracks = 0, startedAt = null, won = false;
  var lastCell = null, cellRects = [], pathEl = null;
  var diffKey = "medium";
  try { diffKey = localStorage.getItem("trailfeed_diff") || "medium"; } catch (e) {}
  var VB = 100, CS = VB / SIZE;
  function cx(c) { return (c + 0.5) * CS; }
  function cy(r) { return (r + 0.5) * CS; }
  function key(r, c) { return r + "," + c; }

  /* ============================ build board ============================ */
  function el(name, attrs) {
    var e = document.createElementNS(SVGNS, name);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }
  function newPuzzle() {
    puzzle = generatePuzzle(diffKey);
    wallSet = {}; puzzle.walls.forEach(function (w) { wallSet[w] = true; });
    dotMap = {}; puzzle.dots.forEach(function (d) { dotMap[key(d.cell.r, d.cell.c)] = d.value; });
    maxDot = puzzle.dots.length;
    startCell = puzzle.dots[0].cell;
    path = []; drawing = false; backtracks = 0; startedAt = null; won = false; lastCell = null;
    svg.innerHTML = "";
    cellRects = [];
    // cells
    for (var i = 0; i < SIZE * SIZE; i++) {
      var r = Math.floor(i / SIZE), c = i % SIZE;
      var rect = el("rect", { x: c * CS + 0.4, y: r * CS + 0.4, width: CS - 0.8, height: CS - 0.8, rx: 1.8, "class": "cell" });
      svg.appendChild(rect); cellRects.push(rect);
    }
    // path element (updated as you draw)
    pathEl = el("path", { "class": "trail", d: "", fill: "none", "stroke-width": CS * 0.42, "stroke-linecap": "round", "stroke-linejoin": "round" });
    svg.appendChild(pathEl);
    // walls
    puzzle.walls.forEach(function (w) {
      var parts = w.split("|");
      var a = parts[0].split(",").map(Number), b = parts[1].split(",").map(Number);
      var ln;
      if (a[0] === b[0]) { var x = Math.max(a[1], b[1]) * CS; ln = el("line", { x1: x, y1: a[0] * CS, x2: x, y2: (a[0] + 1) * CS }); }
      else { var y = Math.max(a[0], b[0]) * CS; ln = el("line", { x1: a[1] * CS, y1: y, x2: (a[1] + 1) * CS, y2: y }); }
      ln.setAttribute("class", "wall"); ln.setAttribute("stroke-width", 1.1); ln.setAttribute("stroke-linecap", "round");
      svg.appendChild(ln);
    });
    // dots
    puzzle.dots.forEach(function (d) {
      var g = el("g", { "class": "dot" });
      g.appendChild(el("circle", { cx: cx(d.cell.c), cy: cy(d.cell.r), r: CS * 0.29 }));
      var t = el("text", { x: cx(d.cell.c), y: cy(d.cell.r), "text-anchor": "middle", "dominant-baseline": "central" });
      t.setAttribute("style", "font-size:" + (CS * 0.4) + "px");
      t.textContent = d.value;
      g.appendChild(t);
      svg.appendChild(g);
    });
    diffBtn.textContent = DIFFS[diffKey].label;
    solved.classList.add("is-hidden");
    setHint("Start on 1 · connect every dot in order · fill every square");
    render();
  }

  /* ============================ render ============================ */
  function onPath(r, c) { for (var i = 0; i < path.length; i++) if (path[i].r === r && path[i].c === c) return true; return false; }
  function dotsHitCount() { var n = 0; for (var i = 0; i < path.length; i++) if (dotMap[key(path[i].r, path[i].c)] !== undefined) n++; return n; }

  function render() {
    // path
    var d = "";
    for (var i = 0; i < path.length; i++) d += (i === 0 ? "M " : "L ") + cx(path[i].c) + " " + cy(path[i].r) + " ";
    pathEl.setAttribute("d", d);
    // cell states
    var dotsHit = dotsHitCount();
    var allDotsHit = !won && dotsHit === maxDot && path.length < SIZE * SIZE;
    for (var j = 0; j < cellRects.length; j++) {
      var rr = Math.floor(j / SIZE), cc = j % SIZE;
      var cls = "cell";
      if (onPath(rr, cc)) cls += " on";
      else if (allDotsHit) cls += " remain";
      cellRects[j].setAttribute("class", cls);
    }
    // dashboard
    dashCount.textContent = path.length;
    barFill.style.width = (path.length / (SIZE * SIZE) * 100) + "%";
    // dot tracker
    var pills = "";
    for (var k = 0; k < puzzle.dots.length; k++) {
      var v = puzzle.dots[k].value;
      var st = v <= dotsHit ? "hit" : (!won && v === dotsHit + 1 ? "next" : "");
      pills += '<span class="pill ' + st + '">' + v + "</span>";
    }
    dotTrack.innerHTML = pills;
    // clean/backtracks
    if (backtracks === 0) { cleanBadge.textContent = "Clean"; cleanBadge.className = "badge clean"; }
    else { cleanBadge.textContent = backtracks + (backtracks === 1 ? " backtrack" : " backtracks"); cleanBadge.className = "badge"; }
    // status line
    if (!won) {
      if (path.length === 0) statusEl.textContent = "";
      else if (allDotsHit) statusEl.textContent = (SIZE * SIZE - path.length) === 1 ? "One square left." : "Cover the last " + (SIZE * SIZE - path.length) + " squares.";
      else statusEl.textContent = "";
    }
  }

  /* ============================ interaction ============================ */
  function cellFromEvent(e) {
    var rect = svg.getBoundingClientRect();
    var csPx = rect.width / SIZE;
    var c = Math.floor((e.clientX - rect.left) / csPx);
    var r = Math.floor((e.clientY - rect.top) / csPx);
    if (r < 0 || r >= SIZE || c < 0 || c >= SIZE) return null;
    return { r: r, c: c };
  }
  function tryExtendTo(next) {
    if (path.length === 0) return;
    var last = path[path.length - 1];
    if (sameCell(last, next)) return;
    var idx = -1;
    for (var i = 0; i < path.length; i++) if (sameCell(path[i], next)) { idx = i; break; }
    if (idx >= 0) {
      if (idx < path.length - 1) { backtracks += path.length - 1 - idx; path = path.slice(0, idx + 1); sndBack(); render(); }
      return;
    }
    if (!isAdjacent(last, next)) return;
    if (wallSet[edgeKey(last, next)]) return;
    var dotVal = dotMap[key(next.r, next.c)];
    if (dotVal !== undefined) {
      var expected = dotsHitCount() + 1;
      if (dotVal !== expected) return;   // must hit dots in order
    }
    path.push(next);
    if (dotVal !== undefined) sndDot(dotVal); else sndTick();
    render();
    checkWin();
  }
  function onDown(e) {
    if (won) return;
    var cell = cellFromEvent(e);
    if (!cell) return;
    ensureAudio();
    try { svg.setPointerCapture(e.pointerId); } catch (er) {}
    e.preventDefault();
    if (path.length === 0) {
      if (!sameCell(cell, startCell)) { flashStart(); return; }
      path = [cell]; if (startedAt === null) startedAt = Date.now();
      drawing = true; lastCell = cell; sndTick(); render(); startClock(); return;
    }
    var idx = -1;
    for (var i = 0; i < path.length; i++) if (sameCell(path[i], cell)) { idx = i; break; }
    if (idx >= 0) {
      if (idx < path.length - 1) { backtracks += path.length - 1 - idx; path = path.slice(0, idx + 1); sndBack(); render(); }
      drawing = true; lastCell = path[idx]; return;
    }
    var last = path[path.length - 1];
    if (isAdjacent(last, cell) && !wallSet[edgeKey(last, cell)]) { tryExtendTo(cell); drawing = true; lastCell = cell; }
  }
  function onMove(e) {
    if (!drawing || won) return;
    var cell = cellFromEvent(e);
    if (!cell) return;
    if (lastCell && sameCell(lastCell, cell)) return;
    lastCell = cell;
    tryExtendTo(cell);
  }
  function onUp() { drawing = false; }

  svg.addEventListener("pointerdown", onDown);
  svg.addEventListener("pointermove", onMove);
  svg.addEventListener("pointerup", onUp);
  svg.addEventListener("pointercancel", onUp);

  function flashStart() {
    setHint("Start on the dot marked 1");
    var d1 = svg.querySelector(".dot"); if (d1) { d1.classList.remove("flash"); void d1.getBBox(); d1.classList.add("flash"); }
  }

  /* ============================ clock ============================ */
  var clockId = null;
  function startClock() {
    if (clockId) return;
    clockId = setInterval(function () {
      if (startedAt === null || won) return;
      timeEl.textContent = fmtTime(Math.floor((Date.now() - startedAt) / 1000));
    }, 250);
  }
  function fmtTime(s) { var m = Math.floor(s / 60); return m + ":" + String(s % 60).padStart(2, "0"); }

  /* ============================ win ============================ */
  function checkWin() {
    if (won || path.length !== SIZE * SIZE) return;
    var order = [];
    for (var i = 0; i < path.length; i++) { var v = dotMap[key(path[i].r, path[i].c)]; if (v !== undefined) order.push(v); }
    if (order.length !== maxDot) return;
    for (var j = 0; j < order.length; j++) if (order[j] !== j + 1) return;
    won = true; drawing = false;
    var secs = startedAt ? Math.round((Date.now() - startedAt) / 1000) : 0;
    timeEl.textContent = fmtTime(secs);
    winFlourish(secs);
  }
  function winFlourish(secs) {
    pathEl.setAttribute("pathLength", "1");
    pathEl.classList.add("win");        // trace animation via CSS
    sndWin();
    burstConfetti();
    // best time + solves in localStorage
    var best = 0, solves = 0;
    try { best = parseInt(localStorage.getItem("trailfeed_best_" + diffKey) || "0", 10) || 0; } catch (e) {}
    try { solves = parseInt(localStorage.getItem("trailfeed_solves") || "0", 10) || 0; } catch (e) {}
    solves += 1;
    var isBest = best === 0 || secs < best;
    if (isBest) best = secs;
    try { localStorage.setItem("trailfeed_best_" + diffKey, String(best)); localStorage.setItem("trailfeed_solves", String(solves)); } catch (e) {}
    lastResult = { secs: secs, clean: backtracks === 0, isBest: isBest, solves: solves };
    setTimeout(showSolved, REDMO ? 250 : 1450);
  }
  var lastResult = null;
  function showSolved() {
    if (!lastResult) return;
    updateNudge();
    solvedTime.textContent = fmtTime(lastResult.secs);
    var bits = [DIFFS[diffKey].label + " practice"];
    if (lastResult.clean) bits.push("clean solve ✨");
    if (lastResult.isBest) bits.push("new best!");
    solvedSub.textContent = bits.join(" · ");
    solved.classList.remove("is-hidden");
  }

  /* ============================ share ============================ */
  shareBtn.addEventListener("click", function () {
    var clean = lastResult && lastResult.clean ? " ✨" : "";
    var txt = "The Trail Game (practice) in " + (lastResult ? fmtTime(lastResult.secs) : "") + clean +
      "\nPlay today's daily against everyone → " + SITE + "/?utm_source=onepagetoys&utm_medium=share";
    if (navigator.share) {
      navigator.share({ text: txt }).catch(function () {});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(txt).then(function () { showToast("Copied — paste it anywhere"); }, function () { showToast(txt); });
    } else { showToast(txt); }
    if (window.gtag) try { gtag("event", "share", { method: "trail_feeder" }); } catch (e) {}
  });
  againBtn.addEventListener("click", function () { newPuzzle(); });

  var toastId = null;
  function showToast(msg) {
    toast.textContent = msg; toast.classList.add("show");
    if (toastId) clearTimeout(toastId);
    toastId = setTimeout(function () { toast.classList.remove("show"); }, 2600);
  }

  /* ============================ countdown to next daily ============================ */
  function tickCountdown() {
    var now = new Date();
    var next = new Date(now); next.setHours(24, 0, 0, 0);
    var total = Math.max(0, Math.floor((next.getTime() - now.getTime()) / 1000));
    var h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
    var str = String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
    countdownEls.forEach(function (e) { e.textContent = str; });
  }
  tickCountdown(); setInterval(tickCountdown, 1000);

  /* ============================ controls ============================ */
  // track outbound clicks to the daily so the feeder's conversion is measurable
  ["dailyCta", "solvedCta"].forEach(function (id) {
    var a = document.getElementById(id);
    if (a) a.addEventListener("click", function () {
      if (window.gtag) try { gtag("event", "outbound_click", { destination: "thetrailgame.com", link_id: id }); } catch (e) {}
    });
  });
  newBtn.addEventListener("click", function () { newPuzzle(); });
  diffBtn.addEventListener("click", function () {
    var order = ["easy", "medium", "hard"];
    diffKey = order[(order.indexOf(diffKey) + 1) % order.length];
    try { localStorage.setItem("trailfeed_diff", diffKey); } catch (e) {}
    newPuzzle();
  });

  var hintTimer = null;
  function setHint(t) { hintEl.textContent = t; hintEl.classList.remove("is-gone"); if (hintTimer) clearTimeout(hintTimer); hintTimer = setTimeout(function () { hintEl.classList.add("is-gone"); }, 5200); }

  /* theme toggle (matches the real game: light paper / dark charcoal) */
  function applyTheme(mode) {
    var dark = mode === "dark" || (mode === "system" && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
    themeBtn.textContent = dark ? "☾" : "☀";
  }
  var themeMode = "system";
  try { var tm = localStorage.getItem("opt-theme"); if (tm === "light" || tm === "dark" || tm === "system") themeMode = tm; } catch (e) {}
  themeBtn.addEventListener("click", function () {
    themeMode = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    try { localStorage.setItem("opt-theme", themeMode); } catch (e) {}
    applyTheme(themeMode);
  });
  applyTheme(themeMode);

  /* ============================ audio ============================ */
  var AC = null, bus = null, audioOn = true;
  try { audioOn = localStorage.getItem("trailfeed_sound") !== "off"; } catch (e) {}
  function ensureAudio() {
    if (AC) { if (AC.state === "suspended") AC.resume(); return; }
    var Ctx = window.AudioContext || window.webkitAudioContext; if (!Ctx) return;
    AC = new Ctx();
    try { var b = AC.createBuffer(1, 1, 22050), s = AC.createBufferSource(); s.buffer = b; s.connect(AC.destination); s.start(0); } catch (e) {}
    var comp = AC.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 3; comp.attack.value = 0.003; comp.release.value = 0.14;
    bus = AC.createGain(); bus.gain.value = audioOn ? 0.9 : 0.0001; bus.connect(comp); comp.connect(AC.destination);
    if (AC.state === "suspended") AC.resume();
  }
  function tone(freq, dur, type, vol, glideTo) {
    if (!AC || !bus || !audioOn) return;
    var now = AC.currentTime;
    var o = AC.createOscillator(); o.type = type || "sine"; o.frequency.setValueAtTime(freq, now);
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, now + dur);
    var g = AC.createGain(); g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(vol, now + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    o.connect(g); g.connect(bus); o.start(now); o.stop(now + dur + 0.02);
  }
  function sndTick() {
    // soft pencil tick: tiny noise click + a woody blip
    if (!AC || !bus || !audioOn) return;
    var now = AC.currentTime, len = Math.floor(AC.sampleRate * 0.012);
    var buf = AC.createBuffer(1, len, AC.sampleRate), d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    var src = AC.createBufferSource(); src.buffer = buf;
    var bp = AC.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 1900; bp.Q.value = 0.9;
    var g = AC.createGain(); g.gain.value = 0.14;
    src.connect(bp); bp.connect(g); g.connect(bus); src.start(now); src.stop(now + 0.03);
    tone(240 + Math.random() * 30, 0.05, "triangle", 0.08);
  }
  function sndBack() { tone(180, 0.06, "sine", 0.09, 120); }
  function sndDot(v) {
    // rising pentatonic ping per dot reached
    var scale = [0, 2, 4, 7, 9, 12, 14, 16];
    var semis = scale[Math.min(v - 1, scale.length - 1)];
    var f = 440 * Math.pow(2, semis / 12);
    tone(f, 0.28, "sine", 0.22);
    tone(f * 2.0, 0.18, "sine", 0.06);
  }
  function sndWin() {
    if (!AC || !bus || !audioOn) return;
    var arp = [0, 4, 7, 12, 16], now = AC.currentTime;
    arp.forEach(function (s, i) {
      setTimeout(function () {
        var f = 392 * Math.pow(2, s / 12);
        tone(f, 0.5, "triangle", 0.16);
        tone(f * 2, 0.4, "sine", 0.05);
      }, i * 90);
    });
  }
  function setSound(on) {
    audioOn = on;
    soundBtn.setAttribute("aria-pressed", on ? "true" : "false");
    soundBtn.textContent = on ? "♪" : "♪̸";
    try { localStorage.setItem("trailfeed_sound", on ? "on" : "off"); } catch (e) {}
    if (on) { ensureAudio(); if (bus) bus.gain.setTargetAtTime(0.9, AC.currentTime, 0.05); }
    else if (bus) bus.gain.setTargetAtTime(0.0001, AC.currentTime, 0.05);
  }
  soundBtn.addEventListener("click", function () { setSound(!audioOn); });
  soundBtn.setAttribute("aria-pressed", audioOn ? "true" : "false");
  soundBtn.textContent = audioOn ? "♪" : "♪̸";

  /* ============================ confetti (win burst) ============================ */
  var confCanvas = document.getElementById("confetti");
  var confCtx = confCanvas ? confCanvas.getContext("2d") : null;
  var confParts = [], confRAF = null, confLast = 0;
  function sizeConfetti() {
    if (!confCanvas) return;
    var d = Math.min(window.devicePixelRatio || 1, 2);
    confCanvas.width = window.innerWidth * d; confCanvas.height = window.innerHeight * d;
    confCtx.setTransform(d, 0, 0, d, 0, 0);
  }
  window.addEventListener("resize", sizeConfetti); sizeConfetti();
  function burstConfetti() {
    if (!confCtx || REDMO) return;
    var cxp = window.innerWidth / 2, cyp = window.innerHeight * 0.42;
    var cols = ["#c91d2b", "#a51d1d", "#e6b800", "#f2efe9", "#e8622a", "#2c8a5b"];
    for (var i = 0; i < 140; i++) {
      var a = Math.random() * Math.PI * 2, sp = 3 + Math.random() * 9.5;
      confParts.push({ x: cxp + (Math.random() - 0.5) * 90, y: cyp, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 7 - Math.random() * 4,
        w: 5 + Math.random() * 6, h: 8 + Math.random() * 9, rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.4, col: cols[i % cols.length], life: 1 });
    }
    if (!confRAF) { confLast = 0; confRAF = requestAnimationFrame(confFrame); }
  }
  function confFrame(ts) {
    var dt = confLast ? Math.min((ts - confLast) / 16.67, 2) : 1; confLast = ts;
    confCtx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    for (var i = confParts.length - 1; i >= 0; i--) {
      var p = confParts[i];
      p.vy += 0.28 * dt; p.vx *= 0.99; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt; p.life -= 0.006 * dt;
      if (p.y > window.innerHeight + 30 || p.life <= 0) { confParts.splice(i, 1); continue; }
      confCtx.save(); confCtx.translate(p.x, p.y); confCtx.rotate(p.rot);
      confCtx.globalAlpha = Math.max(0, Math.min(1, p.life * 1.4));
      confCtx.fillStyle = p.col; confCtx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); confCtx.restore();
    }
    if (confParts.length) confRAF = requestAnimationFrame(confFrame);
    else { confRAF = null; confLast = 0; confCtx.clearRect(0, 0, window.innerWidth, window.innerHeight); }
  }

  /* ============================ how-to intro ============================ */
  var introEl = document.getElementById("intro");
  var introBtn = document.getElementById("introBtn");
  var helpBtn = document.getElementById("helpBtn");
  function showIntro() { introEl.hidden = false; }
  function hideIntro() { introEl.hidden = true; try { localStorage.setItem("trailfeed_seen", "1"); } catch (e) {} }
  introBtn.addEventListener("click", hideIntro);
  helpBtn.addEventListener("click", showIntro);

  /* ============================ escalating daily nudge ============================ */
  var solvedCtaLabel = document.getElementById("solvedCtaLabel");
  var solvedCtaSub = document.getElementById("solvedCtaSub");
  var ctaMain = document.querySelector(".daily-cta__main");
  var ctaGo = document.querySelector(".daily-cta__go");
  function solveCount() { try { return parseInt(localStorage.getItem("trailfeed_solves") || "0", 10) || 0; } catch (e) { return 0; } }
  function updateNudge() {
    // after a few practice solves, escalate the pitch toward the daily's streak
    if (solveCount() >= 3) {
      if (ctaMain) ctaMain.textContent = "You've got this — the daily builds a streak";
      if (ctaGo) ctaGo.innerHTML = "Start&nbsp;→";
      if (solvedCtaLabel) solvedCtaLabel.textContent = "Start your daily streak →";
      if (solvedCtaSub) solvedCtaSub.textContent = "practice doesn't count — the daily does";
    } else {
      if (ctaMain) ctaMain.textContent = "Today's daily — one puzzle, everyone, worldwide";
      if (ctaGo) ctaGo.innerHTML = "Play&nbsp;→";
      if (solvedCtaLabel) solvedCtaLabel.textContent = "Play today's daily against everyone →";
      if (solvedCtaSub) solvedCtaSub.textContent = "same puzzle worldwide";
    }
  }

  /* ============================ boot ============================ */
  newPuzzle();
  updateNudge();
  var seen = false; try { seen = localStorage.getItem("trailfeed_seen") === "1"; } catch (e) {}
  if (!seen) showIntro();
})();
