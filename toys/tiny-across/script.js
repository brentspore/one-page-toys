/* Tiny Across (practice edition), One Page Toys No. 119.
 *
 * A vanilla port of the daily game at tinyacross.com (Vite + React there). The
 * cursor rules, solve state, reducer and audio are straight ports of
 * src/game/{puzzle,nav,solve,reducer,audio,share}.ts in that repo, where each is
 * covered by tests; keep them in step when either side changes.
 *
 * Feeder rules (house): practice only, no daily, no streak, no email capture.
 * A banner counts down to the daily's rollover and two tagged links send people
 * to it. ⚠ tinyacross.com rolls at LOCAL midnight (EPOCH + local date there);
 * if that ever changes, the countdown here changes with it or the banner lies.
 */
(function () {
  "use strict";

  var SIZE = 5, CELLS = 25;
  var POOL = window.TA_PRACTICE || [];
  var DAILY = "https://tinyacross.com/";

  // ================================================================ puzzle

  function slotCells(g) {
    var out = [];
    function white(r, c) { return r >= 0 && c >= 0 && r < SIZE && c < SIZE && g[r * SIZE + c] !== "#"; }
    var r, c, k, cells;
    for (r = 0; r < SIZE; r++) for (c = 0; c < SIZE; c++) {
      if (white(r, c) && !white(r, c - 1) && white(r, c + 1)) {
        cells = []; for (k = c; white(r, k); k++) cells.push(r * SIZE + k);
        out.push({ dir: "across", cells: cells });
      }
    }
    for (r = 0; r < SIZE; r++) for (c = 0; c < SIZE; c++) {
      if (white(r, c) && !white(r - 1, c) && white(r + 1, c)) {
        cells = []; for (k = r; white(k, c); k++) cells.push(k * SIZE + c);
        out.push({ dir: "down", cells: cells });
      }
    }
    return out;
  }

  function buildPuzzle(raw, id) {
    var solution = raw.g.split("");
    var geo = slotCells(raw.g);
    var starts = {};
    geo.forEach(function (s) { starts[s.cells[0]] = true; });
    var numbers = [], n = 0, i;
    for (i = 0; i < CELLS; i++) numbers.push(starts[i] ? ++n : 0);
    var across = geo.filter(function (s) { return s.dir === "across"; });
    var down = geo.filter(function (s) { return s.dir === "down"; });
    var slots = across.map(function (s, j) { return mkSlot(s, raw.a[j]); })
      .concat(down.map(function (s, j) { return mkSlot(s, raw.d[j]); }));
    function mkSlot(s, clue) {
      return { dir: s.dir, cells: s.cells, num: numbers[s.cells[0]], clue: clue, answer: s.cells.map(function (c) { return solution[c]; }).join("") };
    }
    var acrossAt = [], downAt = [];
    for (i = 0; i < CELLS; i++) { acrossAt.push(-1); downAt.push(-1); }
    slots.forEach(function (s, j) { s.cells.forEach(function (c) { (s.dir === "across" ? acrossAt : downAt)[c] = j; }); });
    return { id: id, solution: solution, slots: slots, numbers: numbers, acrossAt: acrossAt, downAt: downAt };
  }

  function slotIndexAt(p, cell, dir) { return dir === "across" ? p.acrossAt[cell] : p.downAt[cell]; }
  function isBlock(p, cell) { return p.solution[cell] === "#"; }

  // ================================================================ nav

  function other(d) { return d === "across" ? "down" : "across"; }
  function empty(entries, cell) { return !entries[cell]; }

  function activeSlot(p, cur) {
    var i = slotIndexAt(p, cur.cell, cur.dir);
    return i !== -1 ? i : slotIndexAt(p, cur.cell, other(cur.dir));
  }
  function normalise(p, cur) {
    return slotIndexAt(p, cur.cell, cur.dir) !== -1 ? cur : { cell: cur.cell, dir: other(cur.dir) };
  }
  function firstCursor(p, entries) {
    var s = p.slots[0];
    var gap = entries ? s.cells.filter(function (c) { return empty(entries, c); })[0] : undefined;
    return { cell: gap !== undefined ? gap : s.cells[0], dir: s.dir };
  }
  function tapCell(p, cur, cell) {
    if (isBlock(p, cell)) return cur;
    if (cell === cur.cell) return normalise(p, { cell: cell, dir: other(cur.dir) });
    return normalise(p, { cell: cell, dir: cur.dir });
  }
  function nextOpenSlot(p, from, entries, delta) {
    var n = p.slots.length;
    for (var step = 1; step <= n; step++) {
      var i = (((from + delta * step) % n) + n) % n;
      if (p.slots[i].cells.some(function (c) { return empty(entries, c); })) return i;
    }
    return -1;
  }
  function jumpTo(p, si, entries) {
    var s = p.slots[si];
    var gap = s.cells.filter(function (c) { return empty(entries, c); })[0];
    return { cell: gap !== undefined ? gap : s.cells[0], dir: s.dir };
  }
  /* Typing moves to the next EMPTY square, skipping crossings already filled,
   * then to the next word with a gap. ⚠ Except when the word was already full:
   * that is a correction, and it walks one square at a time. */
  function afterType(p, cur, entries, wasFull) {
    var si = activeSlot(p, cur), s = p.slots[si], idx = s.cells.indexOf(cur.cell), next;
    if (wasFull) {
      if (idx < s.cells.length - 1) return { cell: s.cells[idx + 1], dir: s.dir };
      next = nextOpenSlot(p, si, entries, 1);
      return next === -1 ? cur : jumpTo(p, next, entries);
    }
    var ahead = s.cells.slice(idx + 1).filter(function (c) { return empty(entries, c); })[0];
    if (ahead !== undefined) return { cell: ahead, dir: s.dir };
    var behind = s.cells.slice(0, idx).filter(function (c) { return empty(entries, c); })[0];
    if (behind !== undefined) return { cell: behind, dir: s.dir };
    next = nextOpenSlot(p, si, entries, 1);
    if (next === -1) return idx < s.cells.length - 1 ? { cell: s.cells[idx + 1], dir: s.dir } : cur;
    return jumpTo(p, next, entries);
  }
  function backspace(p, cur, entries, locked) {
    var nextE = entries.slice();
    if (nextE[cur.cell] && !locked[cur.cell]) { nextE[cur.cell] = ""; return { cursor: cur, entries: nextE }; }
    var si = activeSlot(p, cur), s = p.slots[si], idx = s.cells.indexOf(cur.cell), target;
    if (idx > 0) target = { cell: s.cells[idx - 1], dir: s.dir };
    else {
      var n = p.slots.length, prev = p.slots[(si - 1 + n) % n];
      target = { cell: prev.cells[prev.cells.length - 1], dir: prev.dir };
    }
    if (!locked[target.cell]) nextE[target.cell] = "";
    return { cursor: target, entries: nextE };
  }
  function arrow(p, cur, key) {
    var dir = key === "ArrowLeft" || key === "ArrowRight" ? "across" : "down";
    if (dir !== cur.dir && slotIndexAt(p, cur.cell, dir) !== -1) return { cell: cur.cell, dir: dir };
    var dr = key === "ArrowUp" ? -1 : key === "ArrowDown" ? 1 : 0;
    var dc = key === "ArrowLeft" ? -1 : key === "ArrowRight" ? 1 : 0;
    var r = Math.floor(cur.cell / SIZE) + dr, c = (cur.cell % SIZE) + dc;
    while (r >= 0 && c >= 0 && r < SIZE && c < SIZE) {
      var cell = r * SIZE + c;
      if (!isBlock(p, cell)) return normalise(p, { cell: cell, dir: cur.dir });
      r += dr; c += dc;
    }
    return cur;
  }
  function stepSlot(p, cur, entries, delta) {
    var si = activeSlot(p, cur), open = nextOpenSlot(p, si, entries, delta);
    if (open !== -1) return jumpTo(p, open, entries);
    var n = p.slots.length, s = p.slots[(((si + delta) % n) + n) % n];
    return { cell: s.cells[0], dir: s.dir };
  }
  function isFull(p, e) { return p.solution.every(function (ch, i) { return ch === "#" || !!e[i]; }); }
  function isSolved(p, e) { return p.solution.every(function (ch, i) { return ch === "#" || e[i] === ch; }); }
  function slotFull(p, si, e) { return p.slots[si].cells.every(function (c) { return !!e[c]; }); }

  // ================================================================ solve state

  function fill(v) { var a = []; for (var i = 0; i < CELLS; i++) a.push(v); return a; }
  function newSolve(id) {
    return { key: id, entries: fill(""), revealed: fill(false), wrong: fill(false), times: fill(0),
      elapsed: 0, started: false, solved: false, gaveUp: false, checks: 0, reveals: 0 };
  }
  function finished(s) { return s.solved || s.gaveUp; }
  function clean(s) { return s.checks === 0 && s.reveals === 0; }

  // ================================================================ audio (port of audio.ts; levels were measured there)

  var actx = null, outGain = null, body = null, verbSend = null, muted = false, lastPlace = -1;
  try { muted = localStorage.getItem("tinyacross_sound") === "off"; } catch (e) {}

  function initAudio() {
    if (actx) { if (actx.state === "suspended") actx.resume(); return; }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    var c = new AC();
    actx = c;
    var b = c.createBuffer(1, 1, 22050), s = c.createBufferSource(); s.buffer = b; s.connect(c.destination); s.start(0);
    outGain = c.createGain(); outGain.gain.value = muted ? 0 : 1;
    var silk = c.createBiquadFilter(); silk.type = "lowpass"; silk.frequency.value = 12500; silk.Q.value = 0.5;
    var glue = c.createDynamicsCompressor();
    glue.threshold.value = -15; glue.ratio.value = 3; glue.attack.value = 0.003; glue.release.value = 0.18;
    var wall = c.createDynamicsCompressor();
    wall.threshold.value = -1.5; wall.ratio.value = 20; wall.knee.value = 0; wall.attack.value = 0.001; wall.release.value = 0.08;
    glue.connect(wall); wall.connect(silk); silk.connect(outGain); outGain.connect(c.destination);
    var b1 = c.createBiquadFilter(); b1.type = "peaking"; b1.frequency.value = 230; b1.Q.value = 1.1; b1.gain.value = 3;
    var b2 = c.createBiquadFilter(); b2.type = "peaking"; b2.frequency.value = 520; b2.Q.value = 1.4; b2.gain.value = 1.5;
    var shelf = c.createBiquadFilter(); shelf.type = "highshelf"; shelf.frequency.value = 7000; shelf.gain.value = -3;
    b1.connect(b2); b2.connect(shelf); shelf.connect(glue);
    body = b1;
    var len = Math.floor(c.sampleRate * 1.3), ir = c.createBuffer(2, len, c.sampleRate);
    for (var ch = 0; ch < 2; ch++) {
      var d = ir.getChannelData(ch), lp = 0;
      for (var i = 0; i < len; i++) { lp += ((Math.random() * 2 - 1) - lp) * 0.35; d[i] = lp * Math.pow(1 - i / len, 3.4) * 1.6; }
    }
    var verb = c.createConvolver(); verb.buffer = ir;
    var vhp = c.createBiquadFilter(); vhp.type = "highpass"; vhp.frequency.value = 220;
    var vshine = c.createBiquadFilter(); vshine.type = "highshelf"; vshine.frequency.value = 5000; vshine.gain.value = 2;
    var vret = c.createGain(); vret.gain.value = 0.3;
    verb.connect(vhp); vhp.connect(vshine); vshine.connect(vret); vret.connect(glue);
    verbSend = verb;
  }
  function live() { return !!actx && !!body && !muted && actx.state !== "closed"; }
  function noiseBuffer(sec) {
    var len = Math.max(1, Math.floor(actx.sampleRate * sec)), buf = actx.createBuffer(1, len, actx.sampleRate), d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }
  function panner(pan) {
    if (typeof actx.createStereoPanner !== "function") return actx.createGain();
    var p = actx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan)); return p;
  }
  function panFor(cell) { return ((cell % SIZE) / (SIZE - 1) - 0.5) * 0.7; }
  function modal(t, base, amp, modes, o) {
    o = o || {};
    var c = actx, burst = o.burst || 0.012, dest = panner(o.pan || 0);
    dest.connect(body);
    if (verbSend && o.send) { var sg = c.createGain(); sg.gain.value = o.send; dest.connect(sg); sg.connect(verbSend); }
    if (o.tack) {
      var n = c.createBufferSource(); n.buffer = noiseBuffer(0.03);
      var lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 8500; lp.Q.value = 0.6;
      var bp = c.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = base * 3.2; bp.Q.value = 0.6;
      var g = c.createGain();
      g.gain.setValueAtTime(o.tack * amp, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.012);
      n.connect(lp); lp.connect(bp); bp.connect(g); g.connect(dest); n.start(t); n.stop(t + 0.03);
    }
    var ex = c.createBufferSource(); ex.buffer = noiseBuffer(0.06);
    var eg = c.createGain();
    eg.gain.setValueAtTime(1, t); eg.gain.exponentialRampToValueAtTime(0.0001, t + burst);
    ex.connect(eg);
    var longest = 0;
    modes.forEach(function (m) {
      var f = base * m[0]; if (f > 16000) return;
      longest = Math.max(longest, m[2]);
      var Q = Math.max(1.5, Math.PI * f * m[2] * 0.5);
      var bq = c.createBiquadFilter(); bq.type = "bandpass"; bq.frequency.value = f; bq.Q.value = Q;
      var gn = c.createGain();
      gn.gain.setValueAtTime(m[1] * amp * Math.sqrt(Q), t); gn.gain.exponentialRampToValueAtTime(0.0002, t + m[2]);
      eg.connect(bq); bq.connect(gn); gn.connect(dest);
    });
    ex.start(t); ex.stop(t + longest + 0.05);
  }
  function chime(t, f0, amp, partials, o) {
    o = o || {};
    var c = actx, dest = panner(o.pan || 0);
    dest.connect(body);
    if (verbSend) { var sg = c.createGain(); sg.gain.value = o.send === undefined ? 0.5 : o.send; dest.connect(sg); sg.connect(verbSend); }
    partials.forEach(function (m) {
      var f = f0 * m[0]; if (f > 16000) return;
      var osc = c.createOscillator(); osc.type = "sine"; osc.frequency.value = f * (1 + (Math.random() - 0.5) * 0.0012);
      var gn = c.createGain();
      gn.gain.setValueAtTime(0.0001, t); gn.gain.exponentialRampToValueAtTime(m[1] * amp, t + 0.004);
      gn.gain.exponentialRampToValueAtTime(0.0001, t + m[2]);
      osc.connect(gn); gn.connect(dest); osc.start(t); osc.stop(t + m[2] + 0.05);
    });
    if (o.strike) {
      var n = c.createBufferSource(); n.buffer = noiseBuffer(0.02);
      var bp = c.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = f0 * 4; bp.Q.value = 0.9;
      var g = c.createGain(); g.gain.setValueAtTime(o.strike * amp, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.015);
      n.connect(bp); bp.connect(g); g.connect(dest); n.start(t); n.stop(t + 0.02);
    }
  }
  function jitter(x, a) { return x * (1 + (Math.random() - 0.5) * a); }
  function semis(f, n) { return f * Math.pow(2, n / 12); }
  var TILE = [[1, 1, 0.075], [1.51, 0.55, 0.05], [2.33, 0.32, 0.035], [3.08, 0.16, 0.024]];
  var BAR = [[1, 1, 0.55], [3.93, 0.22, 0.16], [9.2, 0.05, 0.05]];
  var BELL = [[1, 1, 1.9], [2, 0.42, 1.3], [3.01, 0.26, 0.9], [4.17, 0.14, 0.6], [5.43, 0.08, 0.4]];
  var sfx = {
    place: function (cell) {
      if (!live()) return;
      var t = actx.currentTime;
      if (t - lastPlace < 0.025) return;
      lastPlace = t;
      modal(t, jitter(860, 0.06), 0.9, TILE, { tack: 0.9, pan: panFor(cell), burst: 0.014, send: 0.12 });
      var o = actx.createOscillator(); o.type = "sine";
      o.frequency.setValueAtTime(190, t); o.frequency.exponentialRampToValueAtTime(95, t + 0.05);
      var g = actx.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.22, t + 0.003); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
      o.connect(g); g.connect(body); o.start(t); o.stop(t + 0.09);
    },
    erase: function (cell) { if (live()) modal(actx.currentTime, jitter(640, 0.05), 1.0, TILE.slice(0, 3), { tack: 0.5, pan: panFor(cell), burst: 0.01, send: 0.08 }); },
    word: function (cell) {
      if (!live()) return;
      var t = actx.currentTime + 0.03, root = 587.33;
      chime(t, root, 0.16, BAR, { pan: panFor(cell), send: 0.35, strike: 0.5 });
      chime(t + 0.075, semis(root, 7), 0.13, BAR, { pan: panFor(cell), send: 0.35, strike: 0.4 });
    },
    solved: function () {
      if (!live()) return;
      var t = actx.currentTime + 0.05, root = 523.25, steps = [0, 4, 7, 12, 16, 19];
      steps.forEach(function (n, i) { chime(t + i * 0.085, semis(root, n), 0.095, BELL, { pan: -0.6 + (i / (steps.length - 1)) * 1.2, send: 0.6, strike: 0.6 }); });
      var tc = t + steps.length * 0.085 + 0.08;
      [12, 16, 19, 24].forEach(function (n, i) { chime(tc + i * 0.012, semis(root, n), 0.06, BELL, { pan: (i - 1.5) * 0.3, send: 0.8 }); });
    },
    nope: function () {
      if (!live()) return;
      var t = actx.currentTime, K = [[1, 1, 0.09], [1.72, 0.4, 0.05], [2.61, 0.15, 0.03]];
      modal(t, 170, 1.9, K, { tack: 0.6, burst: 0.018 });
      modal(t + 0.13, 150, 1.6, K, { tack: 0.5, burst: 0.018 });
    },
    checked: function (wrong) {
      if (!live()) return;
      var t = actx.currentTime;
      if (wrong === 0) chime(t, 1318.5, 0.15, [[1, 1, 0.35], [2.76, 0.3, 0.12]], { send: 0.4, strike: 0.3 });
      else modal(t, 300, 1.8, [[1, 1, 0.08], [1.6, 0.35, 0.04]], { tack: 0.4, burst: 0.015 });
    },
    revealed: function (count) {
      if (!live()) return;
      var t = actx.currentTime;
      for (var i = 0; i < Math.min(count, 6); i++) chime(t + i * 0.045, jitter(1760, 0.04), 0.05, [[1, 1, 0.18], [2.4, 0.3, 0.07]], { pan: (i / 5 - 0.5) * 0.8, send: 0.35, strike: 0.2 });
    },
    start: function () {
      if (!live()) return;
      var t = actx.currentTime;
      for (var i = 0; i < 7; i++) modal(t + i * 0.038 + Math.random() * 0.01, jitter(980, 0.12), 0.38, TILE.slice(0, 2), { tack: 0.6, pan: (i / 6 - 0.5) * 0.9, burst: 0.009, send: 0.1 });
    },
    tick: function () { if (live()) modal(actx.currentTime, jitter(2100, 0.08), 1.3, [[1, 1, 0.02], [2.3, 0.4, 0.012]], { burst: 0.005 }); }
  };

  // ================================================================ DOM refs

  var $ = function (id) { return document.getElementById(id); };
  var gridEl = $("grid"), trayEl = $("tray"), timerEl = $("timer"), helpBtn = $("helpBtn"), menuEl = $("menu");
  var cluebar = $("cluebar"), clueTag = $("clueTag"), clueClue = $("clueClue");
  var listsEl = $("lists"), listA = $("listAcross"), listD = $("listDown"), kbEl = $("kb"), toastEl = $("toast");
  var overlay = $("overlay"), panelBody = $("panelBody"), dailyEl = $("daily"), dailyTime = $("dailyTime"), soundBtn = $("soundBtn");

  var coarse = window.matchMedia && matchMedia("(pointer: coarse)").matches;
  var wide = function () { return window.matchMedia && matchMedia("(min-width: 900px)").matches; };
  if (coarse) document.body.classList.add("is-touch");

  // ================================================================ state

  var puzzle = null, solve = null, cursor = null, cellEls = [];
  var runs = 0;
  try { runs = parseInt(localStorage.getItem("tinyacross_runs") || "0", 10) || 0; } catch (e) {}

  function track(name, params) { if (window.gtag) { try { gtag("event", name, params || {}); } catch (e) {} } }

  function readSeen() {
    try { var a = JSON.parse(localStorage.getItem("tinyacross_seen") || "[]"); return Array.isArray(a) ? a : []; } catch (e) { return []; }
  }
  function pickPuzzle() {
    var seen = readSeen();
    var ids = POOL.map(function (_, i) { return i; });
    var fresh = ids.filter(function (i) { return seen.indexOf("p" + (i + 1)) === -1; });
    var choices = fresh.length ? fresh : ids.filter(function (i) { return "p" + (i + 1) !== seen[0]; });
    var i = choices[Math.floor(Math.random() * choices.length)];
    var id = "p" + (i + 1);
    try { localStorage.setItem("tinyacross_seen", JSON.stringify([id].concat(seen.filter(function (x) { return x !== id; })).slice(0, 120))); } catch (e) {}
    return buildPuzzle(POOL[i], id);
  }

  // ================================================================ render

  function buildGrid() {
    gridEl.innerHTML = "";
    cellEls = [];
    puzzle.solution.forEach(function (ch, i) {
      var el = document.createElement("div");
      var r = Math.floor(i / SIZE), c = i % SIZE;
      el.style.setProperty("--r", r); el.style.setProperty("--c", c); el.style.setProperty("--d", r + c);
      if (ch === "#") { el.className = "cell cell--block"; el.setAttribute("aria-hidden", "true"); }
      else {
        el.className = "cell";
        el.setAttribute("role", "gridcell");
        if (puzzle.numbers[i]) { var num = document.createElement("span"); num.className = "cell__num"; num.textContent = puzzle.numbers[i]; el.appendChild(num); }
        var letter = document.createElement("span"); letter.className = "cell__ch"; el.appendChild(letter);
        el.addEventListener("pointerdown", function (e) {
          e.preventDefault();
          if (!solving()) return;
          cursor = tapCell(puzzle, cursor, i);
          render();
        });
      }
      gridEl.appendChild(el);
      cellEls.push(el);
    });
    listA.innerHTML = ""; listD.innerHTML = "";
    puzzle.slots.forEach(function (s, si) {
      var li = document.createElement("li"); li.className = "list__item";
      var b = document.createElement("button"); b.type = "button";
      b.innerHTML = '<span class="list__num"></span><span class="list__clue"></span>';
      b.firstChild.textContent = s.num; b.lastChild.textContent = s.clue;
      b.addEventListener("click", function () {
        if (!solving()) return;
        var gap = s.cells.filter(function (c) { return !solve.entries[c]; })[0];
        cursor = { cell: gap !== undefined ? gap : s.cells[0], dir: s.dir };
        render();
      });
      li.appendChild(b);
      (s.dir === "across" ? listA : listD).appendChild(li);
    });
  }

  function solving() { return solve && solve.started && !finished(solve); }

  function render(fx) {
    var faceDown = !solve.started;
    var done = finished(solve);
    var si = done || faceDown ? -1 : activeSlot(puzzle, cursor);
    var word = si === -1 ? [] : puzzle.slots[si].cells;
    var flash = fx && (fx.kind === "word" || fx.kind === "check" || fx.kind === "reveal") ? fx.cells : [];
    puzzle.solution.forEach(function (ch, i) {
      if (ch === "#") return;
      var el = cellEls[i];
      var cls = "cell";
      if (!faceDown && !done && cursor.cell === i) cls += " is-cursor";
      else if (word.indexOf(i) !== -1) cls += " is-word";
      if (!faceDown && solve.wrong[i]) cls += " is-wrong";
      if (!faceDown && solve.revealed[i]) cls += " is-revealed";
      if (done) cls += solve.solved ? " is-solved" : " is-done";
      el.className = cls;
      el.setAttribute("aria-label", (puzzle.numbers[i] ? puzzle.numbers[i] + ", " : "") + (solve.entries[i] || "empty"));
      var letterEl = el.querySelector(".cell__ch");
      var text = faceDown ? "" : solve.entries[i];
      var pop = fx && fx.cell === i && (fx.kind === "place" || fx.kind === "word" || fx.kind === "solved" || fx.kind === "nope");
      var sweep = flash.indexOf(i) !== -1;
      if (pop || sweep) {
        // ⚠ Replay a CSS animation by swapping in a fresh node: re-adding the
        // same class to the same element does not restart it.
        var fresh = letterEl.cloneNode(false);
        fresh.className = "cell__ch" + (pop ? " is-pop" : "") + (sweep ? " is-flash" : "");
        fresh.textContent = text;
        el.replaceChild(fresh, letterEl);
      } else if (letterEl.textContent !== text) {
        letterEl.textContent = text;
      }
    });
    trayEl.classList.toggle("tray--solved", solve.solved);

    var showBar = solving();
    cluebar.hidden = !showBar;
    helpBtn.hidden = !showBar;
    if (!showBar) closeMenu();
    if (showBar) {
      var s = puzzle.slots[si];
      clueTag.textContent = s.num + (s.dir === "across" ? "A" : "D");
      clueClue.textContent = s.clue;
    }
    listsEl.hidden = !(wide() && solve.started);
    if (!listsEl.hidden) {
      var crossing = done || faceDown ? -1 : (cursor.dir === "across" ? puzzle.downAt[cursor.cell] : puzzle.acrossAt[cursor.cell]);
      var items = [].slice.call(listA.children).concat([].slice.call(listD.children));
      var order = puzzle.slots.map(function (_, j) { return j; }).filter(function (j) { return puzzle.slots[j].dir === "across"; })
        .concat(puzzle.slots.map(function (_, j) { return j; }).filter(function (j) { return puzzle.slots[j].dir === "down"; }));
      items.forEach(function (li, k) {
        var j = order[k];
        li.className = "list__item" + (j === si ? " is-active" : "") + (j === crossing ? " is-cross" : "") +
          (puzzle.slots[j].cells.every(function (c) { return solve.entries[c]; }) ? " is-full" : "");
      });
    }
    kbEl.hidden = !(coarse && showBar);
    document.body.classList.toggle("is-typing", showBar);
    timerEl.textContent = fmt(solve.elapsed);
    timerEl.classList.toggle("is-live", showBar);
  }

  function fmt(ms) {
    var t = Math.max(0, Math.floor(ms / 1000)), m = Math.floor(t / 60), s = t % 60;
    return m + ":" + (s < 10 ? "0" : "") + s;
  }

  var toastTimer = 0;
  function toast(text) {
    toastEl.hidden = false;
    var fresh = toastEl.cloneNode(false);
    fresh.textContent = text;
    toastEl.parentNode.replaceChild(fresh, toastEl);
    toastEl = fresh;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.hidden = true; }, 2600);
  }

  // ================================================================ actions

  function completedBy(cell, before, after) {
    var out = [];
    [puzzle.acrossAt[cell], puzzle.downAt[cell]].forEach(function (si) {
      if (si !== -1 && !slotFull(puzzle, si, before) && slotFull(puzzle, si, after)) out = out.concat(puzzle.slots[si].cells);
    });
    return out.filter(function (c, i) { return out.indexOf(c) === i; });
  }

  function typeLetter(l) {
    if (!solving()) return;
    var letter = l.toUpperCase();
    if (!/^[A-Z]$/.test(letter)) return;
    var si = activeSlot(puzzle, cursor), wasFull = slotFull(puzzle, si, solve.entries), cell = cursor.cell;
    if (solve.revealed[cell]) { cursor = afterType(puzzle, cursor, solve.entries, wasFull); sfx.tick(); render(); return; }
    var before = solve.entries.slice(), wasGridFull = isFull(puzzle, before);
    solve.entries[cell] = letter; solve.wrong[cell] = false; solve.times[cell] = solve.elapsed;
    cursor = afterType(puzzle, cursor, solve.entries, wasFull);
    if (isSolved(puzzle, solve.entries)) { solve.solved = true; render({ kind: "solved", cell: cell }); sfx.place(cell); sfx.solved(); onFinish(); return; }
    if (isFull(puzzle, solve.entries) && (!wasGridFull || before[cell] !== letter)) {
      render({ kind: "nope", cell: cell });
      shakeTray();
      sfx.place(cell); sfx.nope();
      toast("Not quite. Something is off.");
      return;
    }
    var done = completedBy(cell, before, solve.entries);
    if (done.length) { render({ kind: "word", cell: cell, cells: done }); sfx.place(cell); sfx.word(cell); }
    else { render({ kind: "place", cell: cell }); sfx.place(cell); }
  }

  function shakeTray() {
    trayEl.classList.remove("tray--nope");
    void trayEl.offsetWidth;
    trayEl.classList.add("tray--nope");
  }

  function back() {
    if (!solving()) return;
    var r = backspace(puzzle, cursor, solve.entries, solve.revealed);
    var changed = r.entries.some(function (e, i) { return e !== solve.entries[i]; });
    if (changed) {
      r.entries.forEach(function (e, i) { if (e !== solve.entries[i]) solve.wrong[i] = false; });
      solve.entries = r.entries;
      sfx.erase(r.cursor.cell);
    }
    cursor = normalise(puzzle, r.cursor);
    render();
  }

  function scopeCells(scope) {
    if (scope === "square") return [cursor.cell];
    if (scope === "word") return puzzle.slots[activeSlot(puzzle, cursor)].cells;
    return puzzle.solution.map(function (ch, i) { return ch === "#" ? -1 : i; }).filter(function (i) { return i >= 0; });
  }

  function doCheck(scope) {
    var cells = scopeCells(scope), wrong = 0;
    cells.forEach(function (c) { if (solve.entries[c] && solve.entries[c] !== puzzle.solution[c]) { solve.wrong[c] = true; wrong++; } });
    solve.checks++;
    render({ kind: "check", cell: cursor.cell, cells: cells });
    sfx.checked(wrong);
    toast(wrong === 0 ? "Nothing wrong so far." : wrong === 1 ? "1 letter is wrong." : wrong + " letters are wrong.");
    track("check_used", { mode: "practice", wrong: wrong });
  }

  function doReveal(scope) {
    var cells = scopeCells(scope), n = 0;
    var wasFull = slotFull(puzzle, activeSlot(puzzle, cursor), solve.entries);
    cells.forEach(function (c) {
      if (puzzle.solution[c] === "#" || solve.entries[c] === puzzle.solution[c]) return;
      solve.entries[c] = puzzle.solution[c]; solve.revealed[c] = true; solve.wrong[c] = false; solve.times[c] = solve.elapsed; n++;
    });
    solve.reveals += n;
    track("reveal_used", { mode: "practice", count: n, scope: scope });
    if (isSolved(puzzle, solve.entries)) {
      if (scope === "puzzle" && n > 0) { solve.gaveUp = true; render(); sfx.revealed(n); onFinish(); return; }
      solve.solved = true; render({ kind: "solved", cell: cursor.cell }); sfx.solved(); onFinish(); return;
    }
    cursor = scope === "square" ? afterType(puzzle, cursor, solve.entries, wasFull) : scope === "word" ? stepSlot(puzzle, cursor, solve.entries, 1) : cursor;
    render({ kind: "reveal", cell: cursor.cell, cells: cells });
    sfx.revealed(n);
  }

  // ================================================================ menu

  function closeMenu() {
    menuEl.hidden = true;
    helpBtn.setAttribute("aria-expanded", "false");
    $("revealAllConfirm").hidden = true;
    $("revealAllAsk").hidden = false;
  }
  helpBtn.addEventListener("click", function () {
    var open = menuEl.hidden;
    closeMenu();
    if (open) { menuEl.hidden = false; helpBtn.setAttribute("aria-expanded", "true"); }
  });
  menuEl.addEventListener("click", function (e) {
    var b = e.target.closest ? e.target.closest("[data-act]") : null;
    if (!b) return;
    var act = b.getAttribute("data-act"), scope = b.getAttribute("data-scope");
    closeMenu();
    if (act === "check") doCheck(scope); else doReveal(scope);
  });
  $("revealAllAsk").addEventListener("click", function () { $("revealAllAsk").hidden = true; $("revealAllConfirm").hidden = false; });
  $("revealAllCancel").addEventListener("click", function () { $("revealAllConfirm").hidden = true; $("revealAllAsk").hidden = false; });
  document.addEventListener("pointerdown", function (e) {
    if (menuEl.hidden) return;
    if (!menuEl.contains(e.target) && !helpBtn.contains(e.target)) closeMenu();
  });

  // ================================================================ clue bar + keyboard

  $("prevClue").addEventListener("pointerdown", function (e) { e.preventDefault(); if (solving()) { cursor = stepSlot(puzzle, cursor, solve.entries, -1); render(); } });
  $("nextClue").addEventListener("pointerdown", function (e) { e.preventDefault(); if (solving()) { cursor = stepSlot(puzzle, cursor, solve.entries, 1); render(); } });
  $("clueText").addEventListener("pointerdown", function (e) { e.preventDefault(); if (solving()) { cursor = tapCell(puzzle, cursor, cursor.cell); render(); } });

  (function buildKeyboard() {
    ["QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM"].forEach(function (row, ri) {
      var r = document.createElement("div"); r.className = "kb__row";
      row.split("").forEach(function (l) {
        var k = document.createElement("button"); k.type = "button"; k.className = "kb__key"; k.textContent = l;
        // ⚠ pointerdown, not click: click waits for the finger to lift, and that
        // lag on every letter is the whole feel of a timed game
        k.addEventListener("pointerdown", function (e) { e.preventDefault(); initAudio(); typeLetter(l); });
        r.appendChild(k);
      });
      if (ri === 2) {
        var del = document.createElement("button"); del.type = "button"; del.className = "kb__key kb__key--wide"; del.setAttribute("aria-label", "Delete");
        del.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M9 5h11a1.5 1.5 0 0 1 1.5 1.5v11A1.5 1.5 0 0 1 20 19H9l-6.5-7z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M11.5 9.5l5 5m0-5l-5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
        del.addEventListener("pointerdown", function (e) { e.preventDefault(); back(); });
        r.appendChild(del);
      }
      kbEl.appendChild(r);
    });
  })();

  document.addEventListener("keydown", function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    if (!overlay.hidden) {
      if ((e.key === "Enter" || e.key === " ") && t && t.tagName !== "BUTTON" && t.tagName !== "A") { e.preventDefault(); var b = panelBody.querySelector("[data-go]"); if (b) b.click(); }
      return;
    }
    if (!solving()) return;
    initAudio();
    if (/^[a-zA-Z]$/.test(e.key)) { e.preventDefault(); typeLetter(e.key); }
    else if (e.key === "Backspace" || e.key === "Delete") { e.preventDefault(); back(); }
    else if (e.key.indexOf("Arrow") === 0) { e.preventDefault(); cursor = arrow(puzzle, cursor, e.key); render(); }
    else if (e.key === "Tab" || e.key === "Enter") { e.preventDefault(); cursor = stepSlot(puzzle, cursor, solve.entries, e.shiftKey ? -1 : 1); render(); }
    else if (e.key === " ") { e.preventDefault(); cursor = tapCell(puzzle, cursor, cursor.cell); render(); }
    else if (e.key === "Escape") closeMenu();
  });

  // ================================================================ clock

  var last = 0;
  setInterval(function () {
    var now = performance.now();
    if (solving() && document.visibilityState === "visible" && last) {
      solve.elapsed += Math.min(now - last, 1000);
      timerEl.textContent = fmt(solve.elapsed);
    }
    last = now;
  }, 250);
  document.addEventListener("visibilitychange", function () { last = performance.now(); });

  // ================================================================ rounds

  function newRound() {
    puzzle = pickPuzzle();
    solve = newSolve(puzzle.id);
    cursor = firstCursor(puzzle, solve.entries);
    window.OPT_SHARE_TEXT = window.OPT_SHARE_LINE = window.OPT_SHARE_IMAGE = null;
    buildGrid();
    render();
  }

  function begin() {
    initAudio();
    overlay.hidden = true;
    if (!puzzle || finished(solve)) newRound();
    solve.started = true;
    last = performance.now();
    render();
    trayEl.classList.remove("tray--deal"); void trayEl.offsetWidth; trayEl.classList.add("tray--deal");
    setTimeout(function () { trayEl.classList.remove("tray--deal"); }, 900);
    sfx.start();
    track("puzzle_start", { mode: "practice", puzzle: puzzle.id });
  }

  function onFinish() {
    runs++;
    try { localStorage.setItem("tinyacross_runs", String(runs)); } catch (e) {}
    var cleanSolve = solve.solved && clean(solve);
    if (cleanSolve) {
      var best = null;
      try { best = parseInt(localStorage.getItem("tinyacross_best") || "", 10); } catch (e) {}
      // Written only when it improves, as a time in ms: the ticket rule for
      // this key counts DOWN, so a slower time must never overwrite a faster one.
      if (!best || solve.elapsed < best) { try { localStorage.setItem("tinyacross_best", String(Math.round(solve.elapsed))); } catch (e) {} }
    }
    if (solve.solved) {
      track("puzzle_solved", { mode: "practice", puzzle: puzzle.id, seconds: Math.round(solve.elapsed / 1000), clean: cleanSolve });
      var line = "Solved in " + fmt(solve.elapsed);
      window.OPT_SHARE_LINE = line;
      window.OPT_SHARE_TEXT = "I solved a Tiny Across in " + fmt(solve.elapsed) + (cleanSolve ? " with no help" : "") +
        ". Try today's puzzle: " + DAILY + "?utm_source=onepagetoys&utm_medium=share";
      window.OPT_SHARE_IMAGE = function () { return drawCard(); };
    } else {
      // answers shown: nothing worth posting, so fall back to the plain share
      window.OPT_SHARE_TEXT = window.OPT_SHARE_LINE = window.OPT_SHARE_IMAGE = null;
    }
    render();
    setTimeout(showEnd, solve.solved ? 1700 : 700);
  }

  function helpNote(s) {
    if (s.reveals > 0) return s.reveals === 1 ? "1 reveal" : s.reveals + " reveals";
    if (s.checks > 0) return s.checks === 1 ? "1 check" : s.checks + " checks";
    return "no help";
  }

  function showEnd() {
    var solved = solve.solved;
    var ctaLine = runs >= 3
      ? "That is <b>" + runs + " practice puzzles</b>. The daily one gives everyone the <b>same grid</b>, and a streak for coming back."
      : "On the daily, everyone gets the <b>same puzzle</b> and keeps a streak.";
    if (runs >= 3) dailyEl.classList.add("is-hot");
    panelBody.innerHTML =
      '<p class="panel__eyebrow">Practice <span class="dot">·</span> ' + (solved ? "Solved" : "Answers shown") + "</p>" +
      (solved ? '<p class="panel__time">' + fmt(solve.elapsed) + "</p>" : '<h2 class="panel__title">That one got away</h2>') +
      '<p class="panel__note">' + (solved ? (clean(solve) ? "No help." : "With " + helpNote(solve) + ".") : "On to the next one.") + "</p>" +
      '<div class="panel__actions"><button type="button" class="ghost-btn" data-go="new">New puzzle</button></div>' +
      '<div class="panel__cta"><p class="panel__ctaline">' + ctaLine + '</p>' +
      '<a class="play-btn play-btn--small" id="ctaBtn" href="' + DAILY + '?utm_source=onepagetoys&utm_medium=feeder&utm_campaign=tinyacross_solved" target="_blank" rel="noopener">' +
      (runs >= 3 ? "Start a streak →" : "Play today's puzzle →") + "</a></div>";
    panelBody.querySelector('[data-go="new"]').addEventListener("click", function () { newRound(); begin(); });
    $("ctaBtn").addEventListener("click", function () { track("outbound_click", { destination: "tinyacross.com", link_id: "solved" }); });
    overlay.hidden = false;
    render();
  }

  // ================================================================ share card

  function drawCard() {
    var W = 1080, H = 1350, cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    var g = cv.getContext("2d");
    var bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, "#161c3d"); bg.addColorStop(1, "#080a18");
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    var glow = g.createRadialGradient(W / 2, 560, 60, W / 2, 560, 620);
    glow.addColorStop(0, "rgba(62,230,180,0.16)"); glow.addColorStop(1, "rgba(62,230,180,0)");
    g.fillStyle = glow; g.fillRect(0, 0, W, H);
    g.textAlign = "center";
    g.fillStyle = "#f4efe6"; g.font = "650 76px Fraunces, Georgia, serif"; g.fillText("Tiny Across", W / 2, 170);
    g.fillStyle = "#8f97c2"; g.font = "500 40px Outfit, system-ui, sans-serif"; g.fillText("Practice", W / 2, 232);
    var cell = 128, gap = 14, pad = 30, size = cell * 5 + gap * 4 + pad * 2, x0 = (W - size) / 2, y0 = 300;
    rr(g, x0, y0 + 10, size, size, 44); g.fillStyle = "#05070f"; g.fill();
    rr(g, x0, y0, size, size, 44); g.fillStyle = "#1a2148"; g.fill();
    var total = Math.max(1, solve.elapsed);
    var COLORS = { early: "#3ee6b4", middle: "#f7d154", late: "#ff8a5c", revealed: "#e8e4da" };
    var EDGES = { early: "#28967a", middle: "#a08836", late: "#a65a3c", revealed: "#97948e" };
    puzzle.solution.forEach(function (ch, i) {
      var r = Math.floor(i / 5), c = i % 5, x = x0 + pad + c * (cell + gap), y = y0 + pad + r * (cell + gap);
      if (ch === "#") { rr(g, x, y, cell, cell, 22); g.fillStyle = "#0b0f24"; g.fill(); return; }
      var f = solve.times[i] / total;
      var h = solve.revealed[i] ? "revealed" : f < 1 / 3 ? "early" : f < 2 / 3 ? "middle" : "late";
      rr(g, x, y + 9, cell, cell, 22); g.fillStyle = EDGES[h]; g.fill();
      rr(g, x, y, cell, cell, 22); g.fillStyle = COLORS[h]; g.fill();
      var sheen = g.createLinearGradient(0, y, 0, y + cell);
      sheen.addColorStop(0, "rgba(255,255,255,0.28)"); sheen.addColorStop(0.5, "rgba(255,255,255,0)");
      rr(g, x, y, cell, cell, 22); g.fillStyle = sheen; g.fill();
    });
    var yt = y0 + size + 150;
    g.fillStyle = "#f4efe6"; g.font = "700 132px Outfit, system-ui, sans-serif"; g.fillText(fmt(solve.elapsed), W / 2, yt);
    g.fillStyle = "#b9bfe0"; g.font = "500 42px Outfit, system-ui, sans-serif"; g.fillText(helpNote(solve), W / 2, yt + 70);
    // ⚠ an image share carries no link: the site on the card is how anyone finds the game
    g.fillStyle = "#3ee6b4"; g.font = "600 44px Outfit, system-ui, sans-serif"; g.fillText("tinyacross.com", W / 2, H - 70);
    return cv;
  }
  function rr(g, x, y, w, h, r) {
    g.beginPath(); g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }

  // ================================================================ banner, sound, share tracking

  function tickCountdown() {
    var now = new Date();
    var next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
    var left = Math.max(0, next - now.getTime());
    var h = Math.floor(left / 3600000), m = Math.floor(left / 60000) % 60, s = Math.floor(left / 1000) % 60;
    dailyTime.textContent = h + "h " + (m < 10 ? "0" : "") + m + "m " + (s < 10 ? "0" : "") + s + "s";
    dailyEl.title = "A new puzzle is up in " + h + "h " + m + "m at tinyacross.com";
  }
  tickCountdown();
  setInterval(tickCountdown, 1000);
  dailyEl.addEventListener("click", function () { track("outbound_click", { destination: "tinyacross.com", link_id: "banner" }); });
  document.addEventListener("click", function (e) {
    var t = e.target && e.target.closest ? e.target.closest(".opt-share") : null;
    if (t) track("share", { method: "tinyacross_feeder", value: solve && solve.solved ? Math.round(solve.elapsed / 1000) : 0 });
  });

  function syncSound() {
    soundBtn.setAttribute("aria-pressed", String(!muted));
    soundBtn.setAttribute("aria-label", muted ? "Sound off" : "Sound on");
    soundBtn.classList.toggle("is-muted", muted);
  }
  soundBtn.addEventListener("click", function () {
    initAudio();
    muted = !muted;
    if (outGain && actx) outGain.gain.setTargetAtTime(muted ? 0 : 1, actx.currentTime, 0.02);
    try { localStorage.setItem("tinyacross_sound", muted ? "off" : "on"); } catch (e) {}
    syncSound();
  });
  syncSound();

  window.addEventListener("resize", function () { if (solve) render(); });

  // ================================================================ boot

  var startBtn = $("startBtn");
  startBtn.setAttribute("data-go", "start");
  startBtn.addEventListener("click", begin);
  if (!POOL.length) { startBtn.disabled = true; startBtn.textContent = "Puzzles failed to load"; return; }
  newRound();
})();
