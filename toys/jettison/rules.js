/* Jettison — the rules. Shared by the game, the hint worker and the offline
 * level builder (scripts/build-jettison-levels.cjs), so the board can never
 * disagree with the solver about what a move does.
 *
 *   - A cargo hold: a W x H grid, some cells of it solid hull (an irregular
 *     hold). Modules are polyominoes, one color each, and the hold starts
 *     PACKED: a jam you clear.
 *   - Airlocks sit in the bulkheads: { side: "L"|"R"|"T"|"B", line, from,
 *     to, color }. `line` is the column (L/R) or row (T/B) of the hold cells
 *     the lock opens off, so a lock can sit on an inner wall of an irregular
 *     hold as well as the outer one; from..to is its span along that wall.
 *   - A drag picks up a module and moves it, a cell at a time, anywhere it can
 *     get to through free space (no rotation), and it stays where you let go.
 *   - Dragged into an airlock of its own color, it is jettisoned: every one of
 *     its cells must have a clear run out through that lock, so the lock must
 *     be at least as wide as the module, and the module must be touching it.
 *   - One drag is one move, whether it ends parked or out of the airlock.
 *
 * Two facts make this a clean puzzle: a parked move can always be dragged
 * back the way it came, and jettisoning a module never takes room from the
 * others. So a hold can never become unwinnable, and taking any jettison on
 * offer is always right. Par is therefore (modules) + (fewest parking moves),
 * found by a breadth-first search over parking moves with every available
 * jettison taken after each one.
 *
 * State is an Int16Array [x0, y0, x1, y1, ...]; x === GONE once jettisoned.
 */
(function (root) {
  "use strict";

  var SHAPES = {
    M1: [[0, 0]],
    D2h: [[0, 0], [1, 0]], D2v: [[0, 0], [0, 1]],
    I3h: [[0, 0], [1, 0], [2, 0]], I3v: [[0, 0], [0, 1], [0, 2]],
    L3a: [[0, 0], [0, 1], [1, 1]], L3b: [[1, 0], [0, 1], [1, 1]],
    L3c: [[0, 0], [1, 0], [0, 1]], L3d: [[0, 0], [1, 0], [1, 1]],
    O4: [[0, 0], [1, 0], [0, 1], [1, 1]],
    I4h: [[0, 0], [1, 0], [2, 0], [3, 0]], I4v: [[0, 0], [0, 1], [0, 2], [0, 3]],
    T4a: [[0, 0], [1, 0], [2, 0], [1, 1]], T4b: [[1, 0], [0, 1], [1, 1], [2, 1]],
    T4c: [[0, 0], [0, 1], [0, 2], [1, 1]], T4d: [[1, 0], [1, 1], [1, 2], [0, 1]],
    L4a: [[0, 0], [0, 1], [0, 2], [1, 2]], L4b: [[0, 0], [1, 0], [2, 0], [0, 1]],
    L4c: [[0, 0], [1, 0], [1, 1], [1, 2]], L4d: [[2, 0], [0, 1], [1, 1], [2, 1]],
    J4a: [[1, 0], [1, 1], [1, 2], [0, 2]], J4b: [[0, 0], [0, 1], [1, 1], [2, 1]],
    S4h: [[1, 0], [2, 0], [0, 1], [1, 1]], S4v: [[0, 0], [0, 1], [1, 1], [1, 2]],
    Z4h: [[0, 0], [1, 0], [1, 1], [2, 1]], Z4v: [[1, 0], [0, 1], [1, 1], [0, 2]],
    // the chunky ones that make a hold feel packed
    R6h: [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1]],
    R6v: [[0, 0], [1, 0], [0, 1], [1, 1], [0, 2], [1, 2]],
    P5a: [[0, 0], [1, 0], [0, 1], [1, 1], [0, 2]], P5b: [[0, 0], [1, 0], [0, 1], [1, 1], [1, 2]],
    P5c: [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1]], P5d: [[0, 0], [1, 0], [2, 0], [1, 1], [2, 1]],
    U5a: [[0, 0], [2, 0], [0, 1], [1, 1], [2, 1]], U5b: [[0, 0], [1, 0], [2, 0], [0, 1], [2, 1]],
    O9: [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1], [0, 2], [1, 2], [2, 2]]
  };

  var infoCache = {};
  function shapeInfo(name) {
    if (infoCache[name]) return infoCache[name];
    var cells = SHAPES[name], w = 0, h = 0;
    for (var k = 0; k < cells.length; k++) { w = Math.max(w, cells[k][0] + 1); h = Math.max(h, cells[k][1] + 1); }
    return (infoCache[name] = { name: name, cells: cells, w: w, h: h });
  }

  var DX = [-1, 1, 0, 0], DY = [0, 0, -1, 1];
  var SIDE = ["L", "R", "T", "B"];
  var GONE = -100;

  function prepare(raw) {
    var active = new Uint8Array(raw.W * raw.H);
    for (var k = 0; k < active.length; k++) active[k] = 1;
    (raw.holes || []).forEach(function (c) { active[c] = 0; });
    var blocks = raw.blocks.map(function (b) { return { shape: b.shape, info: shapeInfo(b.shape), color: b.color }; });
    var gates = raw.gates.map(function (g) {
      var line = g.line !== undefined ? g.line : g.side === "L" || g.side === "T" ? 0 : g.side === "R" ? raw.W - 1 : raw.H - 1;
      return { side: g.side, line: line, from: g.from, to: g.to, color: g.color };
    });
    var start = new Int16Array(blocks.length * 2);
    raw.blocks.forEach(function (b, i) { start[2 * i] = b.x; start[2 * i + 1] = b.y; });
    return { W: raw.W, H: raw.H, active: active, gates: gates, blocks: blocks, start: start, par: raw.par, line: raw.line };
  }

  function buildOcc(level, st) {
    var W = level.W, occ = new Int16Array(W * level.H);
    for (var c = 0; c < occ.length; c++) if (!level.active[c]) occ[c] = -1;
    for (var i = 0; i < level.blocks.length; i++) {
      var x = st[2 * i];
      if (x === GONE) continue;
      var y = st[2 * i + 1], cells = level.blocks[i].info.cells;
      for (var k = 0; k < cells.length; k++) occ[(y + cells[k][1]) * W + (x + cells[k][0])] = i + 1;
    }
    return occ;
  }

  // can module i sit at (x, y)? its own old cells count as free
  function fits(level, occ, i, x, y) {
    var W = level.W, H = level.H, cells = level.blocks[i].info.cells;
    for (var k = 0; k < cells.length; k++) {
      var cx = x + cells[k][0], cy = y + cells[k][1];
      if (cx < 0 || cy < 0 || cx >= W || cy >= H) return false;
      var o = occ[cy * W + cx];
      if (o !== 0 && o !== i + 1) return false;
    }
    return true;
  }

  // every spot module i can be dragged to from (x0, y0), with the way back
  // to each (for animating the path and for the solver)
  function reach(level, occ, i, x0, y0) {
    var W = level.W, seen = {}, list = [[x0, y0]], parent = {};
    seen[x0 + y0 * 64] = 1;
    for (var q = 0; q < list.length; q++) {
      var px = list[q][0], py = list[q][1];
      for (var d = 0; d < 4; d++) {
        var nx = px + DX[d], ny = py + DY[d], k = nx + ny * 64;
        if (seen[k] || !fits(level, occ, i, nx, ny)) continue;
        seen[k] = 1; parent[k] = px + py * 64;
        list.push([nx, ny]);
      }
    }
    return { list: list, parent: parent };
  }

  function lockAt(level, d, px, py, color) {
    for (var k = 0; k < level.gates.length; k++) {
      var g = level.gates[k];
      if (g.side !== SIDE[d] || g.color !== color || g.line !== (d < 2 ? px : py)) continue;
      var along = d < 2 ? py : px;
      if (g.from <= along && along <= g.to) return g;
    }
    return null;
  }

  // From (x, y), can module i be jettisoned going d? It has to be touching
  // the bulkhead, and every cell needs a clear run out through its own lock.
  // A run ends at the hold's edge or at hull (an inactive cell).
  function canExit(level, occ, i, x, y, d) {
    var W = level.W, H = level.H, b = level.blocks[i], cells = b.info.cells, touching = false, gate = null;
    for (var k = 0; k < cells.length; k++) {
      var cx = x + cells[k][0], cy = y + cells[k][1], px = cx, py = cy;
      for (;;) {
        var nx = px + DX[d], ny = py + DY[d];
        if (nx < 0 || ny < 0 || nx >= W || ny >= H || occ[ny * W + nx] === -1) {
          var g = lockAt(level, d, px, py, b.color);
          if (!g) return null;
          gate = g;
          if (px === cx && py === cy) touching = true;
          break;
        }
        var o = occ[ny * W + nx];
        if (o !== 0 && o !== i + 1) return null;
        px = nx; py = ny;
      }
    }
    return touching ? gate : null;
  }

  function exitDir(level, occ, i, x, y) {
    for (var d = 0; d < 4; d++) if (canExit(level, occ, i, x, y, d)) return d;
    return -1;
  }

  function key(st) {
    var s = "";
    for (var k = 0; k < st.length; k += 2) s += st[k] === GONE ? "\u0000" : String.fromCharCode(1 + st[k] + st[k + 1] * 32);
    return s;
  }
  function isGoal(st) { for (var k = 0; k < st.length; k += 2) if (st[k] !== GONE) return false; return true; }
  function alive(st) { var n = 0; for (var k = 0; k < st.length; k += 2) if (st[k] !== GONE) n++; return n; }

  // Take every jettison on offer, over and over, until none is left. Each one
  // is one drag: { i, x, y, d } = drag module i to (x, y), out through side d.
  function closure(level, st) {
    var exits = [];
    for (var changed = true; changed;) {
      changed = false;
      var occ = buildOcc(level, st);
      for (var i = 0; i < level.blocks.length && !changed; i++) {
        if (st[2 * i] === GONE) continue;
        var R = reach(level, occ, i, st[2 * i], st[2 * i + 1]);
        for (var q = 0; q < R.list.length; q++) {
          var d = exitDir(level, occ, i, R.list[q][0], R.list[q][1]);
          if (d >= 0) {
            exits.push({ i: i, x: R.list[q][0], y: R.list[q][1], d: d });
            st[2 * i] = GONE; st[2 * i + 1] = GONE;
            changed = true;
            break;
          }
        }
      }
    }
    return exits;
  }

  // Fewest drags to clear the hold: modules + fewest parking moves. A
  // breadth-first search over parking moves, every jettison taken after each.
  function solve(level, start, cap, maxPark) {
    cap = cap || 200000; maxPark = maxPark || 12;
    var s0 = start.slice(), ex0 = closure(level, s0);
    if (isGoal(s0)) return { par: ex0.length, park: 0, path: ex0, states: 1 };
    var seen = new Set([key(s0)]), frontier = [{ st: s0, path: ex0 }];
    for (var depth = 1; depth <= maxPark; depth++) {
      var next = [];
      for (var f = 0; f < frontier.length; f++) {
        var node = frontier[f], occ = buildOcc(level, node.st);
        for (var i = 0; i < level.blocks.length; i++) {
          if (node.st[2 * i] === GONE) continue;
          var x0 = node.st[2 * i], y0 = node.st[2 * i + 1];
          var R = reach(level, occ, i, x0, y0);
          for (var q = 1; q < R.list.length; q++) {
            var ns = node.st.slice();
            ns[2 * i] = R.list[q][0]; ns[2 * i + 1] = R.list[q][1];
            var ex = closure(level, ns), k = key(ns);
            if (seen.has(k)) continue;
            seen.add(k);
            var path = node.path.concat([{ i: i, x: R.list[q][0], y: R.list[q][1], d: -1 }], ex);
            if (isGoal(ns)) return { par: path.length, park: depth, path: path, states: seen.size };
            next.push({ st: ns, path: path });
            if (seen.size > cap) return { par: -1, capped: true, park: depth, states: seen.size };
          }
        }
      }
      if (!next.length) return { par: -1, unsolvable: true, states: seen.size };
      frontier = next;
    }
    return { par: -1, capped: true, park: maxPark, states: seen.size };
  }

  var api = {
    SHAPES: SHAPES, shapeInfo: shapeInfo, DX: DX, DY: DY, SIDE: SIDE, GONE: GONE,
    prepare: prepare, buildOcc: buildOcc, fits: fits, reach: reach, canExit: canExit, exitDir: exitDir,
    key: key, isGoal: isGoal, alive: alive, closure: closure, solve: solve
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.JettisonRules = api;
})(typeof self !== "undefined" ? self : this);
