// Research prototype for a color-exit sliding-block toy (the Block Out! /
// color-block-jam genre). Not shipped: scripts/ is in .vercelignore.
// Written 2026-10-03 to measure what the build can rely on; the numbers are
// in the BACKLOG entry and reproducible with lab.js in this folder.
//
// RULES (Block Out! style, slide until stopped):
// - A W x H tray. Blocks are polyominoes, one color each. Optional fixed
//   pillars (walls) inside the tray.
// - Gates sit on the outer walls: { side: "L"|"R"|"T"|"B", from, to, color },
//   an inclusive span of cells along that wall.
// - A move picks a block and a direction. The block glides until the next
//   step would hit the wall, a pillar or another block. It never stops
//   part-way by choice.
// - If it reaches a wall where a gate of ITS color covers its whole
//   cross-section (a 2-tall block needs a gate at least 2 long, lined up),
//   and every row (or column) of the block has a clear run to that wall, it
//   leaves the tray. Otherwise it stops against the wall.
// - Optional one-axis blocks ("h" or "v") can only move along that axis.
// - Clear every block to win.

"use strict";

const SHAPES = {
  M1: [[0, 0]],
  D2h: [[0, 0], [1, 0]],
  D2v: [[0, 0], [0, 1]],
  I3h: [[0, 0], [1, 0], [2, 0]],
  I3v: [[0, 0], [0, 1], [0, 2]],
  L3a: [[0, 0], [0, 1], [1, 1]],
  L3b: [[1, 0], [0, 1], [1, 1]],
  L3c: [[0, 0], [1, 0], [0, 1]],
  L3d: [[0, 0], [1, 0], [1, 1]],
  O4: [[0, 0], [1, 0], [0, 1], [1, 1]],
  I4h: [[0, 0], [1, 0], [2, 0], [3, 0]],
  I4v: [[0, 0], [0, 1], [0, 2], [0, 3]],
  T4a: [[0, 0], [1, 0], [2, 0], [1, 1]],
  T4b: [[1, 0], [0, 1], [1, 1], [2, 1]],
  T4c: [[0, 0], [0, 1], [0, 2], [1, 1]],
  T4d: [[1, 0], [1, 1], [1, 2], [0, 1]],
  L4a: [[0, 0], [0, 1], [0, 2], [1, 2]],
  L4b: [[0, 0], [1, 0], [2, 0], [0, 1]],
  L4c: [[0, 0], [1, 0], [1, 1], [1, 2]],
  L4d: [[2, 0], [0, 1], [1, 1], [2, 1]],
  J4a: [[1, 0], [1, 1], [1, 2], [0, 2]],
  J4b: [[0, 0], [0, 1], [1, 1], [2, 1]],
  S4h: [[1, 0], [2, 0], [0, 1], [1, 1]],
  S4v: [[0, 0], [0, 1], [1, 1], [1, 2]],
  Z4h: [[0, 0], [1, 0], [1, 1], [2, 1]],
  Z4v: [[1, 0], [0, 1], [1, 1], [0, 2]],
};

// The mix every measurement used: dominoes doubled so small pieces are common.
const POOL = ["M1", "D2h", "D2v", "D2h", "D2v", "I3h", "I3v", "L3a", "L3b", "L3c", "L3d", "O4",
  "T4a", "T4b", "T4c", "T4d", "L4a", "L4b", "L4c", "L4d", "S4h", "Z4v", "I4h", "I4v"];

function shapeInfo(cells) {
  let w = 0, h = 0;
  for (const [x, y] of cells) { w = Math.max(w, x + 1); h = Math.max(h, y + 1); }
  const rowMin = new Array(h).fill(99), rowMax = new Array(h).fill(-1);
  const colMin = new Array(w).fill(99), colMax = new Array(w).fill(-1);
  for (const [x, y] of cells) {
    rowMin[y] = Math.min(rowMin[y], x); rowMax[y] = Math.max(rowMax[y], x);
    colMin[x] = Math.min(colMin[x], y); colMax[x] = Math.max(colMax[x], y);
  }
  return { cells, w, h, rowMin, rowMax, colMin, colMax };
}

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Directions: 0 left, 1 right, 2 up, 3 down. A gate's side IS the direction
// a block travels to leave through it.
const DX = [-1, 1, 0, 0], DY = [0, 0, -1, 1];
const SIDE = ["L", "R", "T", "B"];
const GONE = -100;

// level: { W, H, walls: Set<cellIndex>, gates: [...], blocks: [{ name, info, color, axis }] }
// state: Int16Array [x0, y0, x1, y1, ...]; x === GONE once a block has left.

function buildOcc(level, st) {
  const { W, H } = level;
  const occ = new Int16Array(W * H);
  for (const c of level.walls) occ[c] = -1;
  level.blocks.forEach((b, i) => {
    const x = st[2 * i];
    if (x === GONE) return;
    const y = st[2 * i + 1];
    for (const [dx, dy] of b.info.cells) occ[(y + dy) * W + (x + dx)] = i + 1;
  });
  return occ;
}

// 1 = can step, 0 = blocked, 2 = a cell would leave the tray
function canStep(level, occ, i, x, y, d) {
  const { W, H } = level;
  for (const [dx, dy] of level.blocks[i].info.cells) {
    const nx = x + dx + DX[d], ny = y + dy + DY[d];
    if (nx < 0 || ny < 0 || nx >= W || ny >= H) return 2;
    const o = occ[ny * W + nx];
    if (o !== 0 && o !== i + 1) return 0;
  }
  return 1;
}

// At the wall on side d: does a same-color gate cover the whole block, and
// does every row/column of the block have a clear run to the wall? (A rigid
// block cannot pass through the gap if a trailing row would hit something.)
function canExit(level, occ, i, x, y, d) {
  const { W, H } = level;
  const b = level.blocks[i], inf = b.info;
  const lo = d < 2 ? y : x, hi = d < 2 ? y + inf.h - 1 : x + inf.w - 1;
  if (!level.gates.some((g) => g.side === SIDE[d] && g.color === b.color && g.from <= lo && hi <= g.to)) return false;
  const clear = (cx, cy) => { const o = occ[cy * W + cx]; return o === 0 || o === i + 1; };
  if (d === 0) { for (let r = 0; r < inf.h; r++) for (let cx = 0; cx < x + inf.rowMin[r]; cx++) if (!clear(cx, y + r)) return false; }
  else if (d === 1) { for (let r = 0; r < inf.h; r++) for (let cx = x + inf.rowMax[r] + 1; cx < W; cx++) if (!clear(cx, y + r)) return false; }
  else if (d === 2) { for (let c = 0; c < inf.w; c++) for (let cy = 0; cy < y + inf.colMin[c]; cy++) if (!clear(x + c, cy)) return false; }
  else { for (let c = 0; c < inf.w; c++) for (let cy = y + inf.colMax[c] + 1; cy < H; cy++) if (!clear(x + c, cy)) return false; }
  return true;
}

// -> { x, y, exit, dist } or null when the block cannot move that way
function slide(level, occ, st, i, d) {
  let x = st[2 * i], y = st[2 * i + 1];
  if (x === GONE) return null;
  const ax = level.blocks[i].axis;
  if ((ax === "h" && d > 1) || (ax === "v" && d < 2)) return null;
  let dist = 0;
  for (;;) {
    const s = canStep(level, occ, i, x, y, d);
    if (s === 1) { x += DX[d]; y += DY[d]; dist++; continue; }
    if (s === 2 && canExit(level, occ, i, x, y, d)) return { x: GONE, y: GONE, exit: true, dist };
    break;
  }
  return dist ? { x, y, exit: false, dist } : null;
}

function key(st) {
  let s = "";
  for (let k = 0; k < st.length; k += 2) s += st[k] === GONE ? "\u0000" : String.fromCharCode(1 + st[k] + st[k + 1] * 32);
  return s;
}

function moves(level, st) {
  const occ = buildOcc(level, st);
  const out = [];
  for (let i = 0; i < level.blocks.length; i++) {
    for (let d = 0; d < 4; d++) {
      const r = slide(level, occ, st, i, d);
      if (!r) continue;
      const ns = st.slice();
      ns[2 * i] = r.x; ns[2 * i + 1] = r.y;
      out.push({ i, d, st: ns, exit: r.exit, dist: r.dist });
    }
  }
  return out;
}

function isGoal(st) { for (let k = 0; k < st.length; k += 2) if (st[k] !== GONE) return false; return true; }
function alive(st) { let n = 0; for (let k = 0; k < st.length; k += 2) if (st[k] !== GONE) n++; return n; }

// ---------------------------------------------------------------- solvers

// Plain BFS. Exact, but the state space explodes past ~6 blocks; kept only
// to cross-check A*.
function bfs(level, start, cap = 2000000) {
  const seen = new Set([key(start)]);
  let frontier = [start], depth = 0;
  while (frontier.length) {
    const next = [];
    for (const st of frontier) {
      for (const m of moves(level, st)) {
        const k = key(m.st);
        if (seen.has(k)) continue;
        if (isGoal(m.st)) return { par: depth + 1, explored: seen.size };
        seen.add(k);
        next.push(m.st);
      }
      if (seen.size > cap) return { par: -1, capped: true, explored: seen.size };
    }
    frontier = next; depth++;
  }
  return { par: -1, capped: false, explored: seen.size };
}

// Admissible, consistent heuristic: every remaining block needs at least one
// move (its exit), and at least two if it is not already lined up with a
// same-color gate it fits (it has to reposition first). A block's alignment
// only changes when that block moves, so one move changes h by at most 1.
function heuristic(level, st) {
  let h = 0;
  level.blocks.forEach((b, i) => {
    const x = st[2 * i];
    if (x === GONE) return;
    const y = st[2 * i + 1], inf = b.info;
    const lined = level.gates.some((g) => g.color === b.color && (g.side === "L" || g.side === "R"
      ? g.from <= y && y + inf.h - 1 <= g.to
      : g.from <= x && x + inf.w - 1 <= g.to));
    h += lined ? 1 : 2;
  });
  return h;
}

// A* for the optimal move count (par) plus the move list (hints).
function astar(level, start, cap = 1200000) {
  const k0 = key(start);
  const best = new Map([[k0, 0]]);
  const parent = new Map([[k0, null]]);
  const buckets = [];
  const push = (f, item) => { (buckets[f] || (buckets[f] = [])).push(item); };
  const h0 = heuristic(level, start);
  push(h0, { st: start, g: 0, k: k0 });
  let expanded = 0;
  for (let f = h0; f < buckets.length; f++) {
    const B = buckets[f];
    while (B && B.length) {
      const it = B.pop(); // LIFO inside a bucket prefers deeper nodes
      if (best.get(it.k) !== it.g) continue;
      if (isGoal(it.st)) {
        const path = [];
        for (let cur = it.k; parent.get(cur); cur = parent.get(cur).prev) path.push({ i: parent.get(cur).i, d: parent.get(cur).d });
        return { par: it.g, path: path.reverse(), expanded, stored: best.size };
      }
      expanded++;
      if (best.size > cap) return { par: -1, capped: true, expanded, stored: best.size };
      for (const m of moves(level, it.st)) {
        const k = key(m.st), g = it.g + 1, old = best.get(k);
        if (old !== undefined && old <= g) continue;
        best.set(k, g);
        parent.set(k, { prev: it.k, i: m.i, d: m.d });
        push(g + heuristic(level, m.st), { st: m.st, g, k });
      }
    }
  }
  return { par: -1, capped: false, expanded, stored: best.size };
}

// Depth-first, exits first. Fast proof that a board is still winnable (its
// solutions are long and useless as par). This is the "stranded?" check.
function solvable(level, start, cap = 60000) {
  const seen = new Set([key(start)]);
  const stack = [{ st: start, ms: null, k: 0 }];
  while (stack.length) {
    const top = stack[stack.length - 1];
    if (!top.ms) {
      if (isGoal(top.st)) return { ok: true, visited: seen.size };
      top.ms = moves(level, top.st).sort((a, b) => (b.exit - a.exit) || (b.dist - a.dist));
    }
    if (top.k >= top.ms.length) { stack.pop(); continue; }
    const m = top.ms[top.k++];
    const k = key(m.st);
    if (seen.has(k)) continue;
    seen.add(k);
    if (seen.size > cap) return { ok: null, capped: true, visited: seen.size };
    stack.push({ st: m.st, ms: null, k: 0 });
  }
  return { ok: false, visited: seen.size };
}

// ---------------------------------------------------------------- generator

// Reverse construction: start from the EMPTY (solved) tray and run time
// backwards with two operations, recording the forward move that undoes each:
//   unexit: put a new block on a same-color gate's lane where its forward
//     slide to that gate is clear (forward, it can leave from there)
//   unslide: move a block backwards from a spot it would STOP at, so a
//     forward slide in that direction lands exactly there again
// Every level is solvable by construction (verify() replays it). Construction
// length is a loose upper bound; par must come from astar().
// Note: slides are not reversible (sliding back keeps going until something
// stops it), which is why the forward moves are recorded, not inferred.
function makeGates(p, rng) {
  const { W, H } = p;
  const used = { L: new Int8Array(H), R: new Int8Array(H), T: new Int8Array(W), B: new Int8Array(W) };
  const gates = [];
  for (let color = 0; color < p.nColors; color++) {
    for (let made = 0, t = 0; made < (p.gatesPerColor || 1) && t < 300; t++) {
      const side = SIDE[Math.floor(rng() * 4)];
      const along = side === "L" || side === "R" ? H : W;
      const len = p.gateLens[Math.floor(rng() * p.gateLens.length)];
      if (len > along) continue;
      let from = Math.floor(rng() * (along - len + 1));
      if (p.gatePlacement === "corner") from = rng() < 0.5 ? 0 : along - len;
      else if (p.gatePlacement === "middle") { if (along - len < 2) continue; from = 1 + Math.floor(rng() * (along - len - 1)); }
      let free = true; // keep a gap between gates on one wall so they read apart
      for (let k = Math.max(0, from - 1); k < Math.min(along, from + len + 1); k++) if (used[side][k]) free = false;
      if (!free) continue;
      for (let k = from; k < from + len; k++) used[side][k] = 1;
      gates.push({ side, from, to: from + len - 1, color });
      made++;
    }
  }
  return gates;
}

const DIR_OF = { L: 0, R: 1, T: 2, B: 3 };

function generate(p, rng) {
  const { W, H } = p;
  const pick = (a) => a[Math.floor(rng() * a.length)];
  const walls = new Set();
  for (let k = 0; k < (p.pillars || 0); k++) walls.add(Math.floor(rng() * W * H));
  const level = { W, H, walls, gates: makeGates(p, rng), blocks: [] };
  let st = new Int16Array(0);
  const undo = []; // forward moves, newest-construction first
  let fails = 0;
  while (level.blocks.length < p.nBlocks && fails < 400) {
    if (level.blocks.length && rng() < (p.slideProb || 0) && unslide(level, st, rng, undo)) continue;
    const name = pick(p.pool || POOL);
    const info = shapeInfo(SHAPES[name]);
    const axis = rng() < (p.arrowProb || 0) ? (rng() < 0.5 ? "h" : "v") : null;
    const lanes = level.gates.filter((g) => (g.side === "L" || g.side === "R" ? info.h : info.w) <= g.to - g.from + 1
      && (!axis || (axis === "h") === (g.side === "L" || g.side === "R")));
    if (!lanes.length) { fails++; continue; }
    const g = pick(lanes), d = DIR_OF[g.side];
    const spots = [];
    if (g.side === "L" || g.side === "R") { for (let y = g.from; y + info.h - 1 <= g.to; y++) for (let x = 0; x + info.w <= W; x++) spots.push([x, y]); }
    else { for (let x = g.from; x + info.w - 1 <= g.to; x++) for (let y = 0; y + info.h <= H; y++) spots.push([x, y]); }
    spots.sort(() => rng() - 0.5);
    const i = level.blocks.length;
    level.blocks.push({ name, info, color: g.color, axis });
    const next = new Int16Array(st.length + 2); next.set(st);
    let placed = false;
    for (const [x, y] of spots) {
      next[2 * i] = x; next[2 * i + 1] = y;
      const occ = buildOcc({ ...level, blocks: level.blocks.slice(0, i) }, st);
      if (info.cells.some(([dx, dy]) => occ[(y + dy) * W + x + dx] !== 0)) continue;
      const r = slide(level, buildOcc(level, next), next, i, d);
      if (r && r.exit) { placed = true; break; }
    }
    if (!placed) { level.blocks.pop(); fails++; continue; }
    st = next;
    undo.push({ i, d, exit: true });
  }
  // a gate nobody uses is noise on the board
  const used = new Set(level.blocks.map((b) => b.color));
  level.gates = level.gates.filter((g) => used.has(g.color));
  return { level, start: st, solution: undo.slice().reverse() };
}

function unslide(level, st, rng, undo) {
  const { W, H } = level;
  const order = level.blocks.map((_, i) => i).sort(() => rng() - 0.5);
  for (const i of order) {
    if (st[2 * i] === GONE) continue;
    const ax = level.blocks[i].axis;
    const dirs = [0, 1, 2, 3].filter((d) => !(ax === "h" && d > 1) && !(ax === "v" && d < 2)).sort(() => rng() - 0.5);
    for (const d of dirs) {
      const occ = buildOcc(level, st);
      const x0 = st[2 * i], y0 = st[2 * i + 1];
      if (slide(level, occ, st, i, d)) continue; // not a resting spot for direction d
      const cands = [];
      for (let x = x0, y = y0; ;) {
        const nx = x - DX[d], ny = y - DY[d];
        const ok = level.blocks[i].info.cells.every(([dx, dy]) => {
          const cx = nx + dx, cy = ny + dy;
          if (cx < 0 || cy < 0 || cx >= W || cy >= H) return false;
          const o = occ[cy * W + cx];
          return o === 0 || o === i + 1;
        });
        if (!ok) break;
        x = nx; y = ny; cands.push([x, y]);
      }
      if (!cands.length) continue;
      const [qx, qy] = cands[Math.floor(rng() * cands.length)];
      st[2 * i] = qx; st[2 * i + 1] = qy;
      const chk = slide(level, buildOcc(level, st), st, i, d);
      if (!chk || chk.exit || chk.x !== x0 || chk.y !== y0) { st[2 * i] = x0; st[2 * i + 1] = y0; continue; }
      undo.push({ i, d, exit: false });
      return true;
    }
  }
  return false;
}

function verify(level, start, solution) {
  const st = start.slice();
  for (const m of solution) {
    const r = slide(level, buildOcc(level, st), st, m.i, m.d);
    if (!r || r.exit !== m.exit) return false;
    st[2 * m.i] = r.x; st[2 * m.i + 1] = r.y;
  }
  return isGoal(st);
}

// ---------------------------------------------------------------- grading

// A "greedy novice" takes any exit on offer, otherwise a random slide. The
// share of greedy games that clear the tray is the best difficulty signal
// found (par and block count barely separate easy from hard).
function novice(level, start, games, seed) {
  const rng = mulberry32(seed);
  let wins = 0, stranded = 0, byExit = 0;
  const leftAtStrand = [];
  for (let g = 0; g < games; g++) {
    let st = start;
    for (let t = 0; t < 150; t++) {
      if (isGoal(st)) { wins++; break; }
      const ms = moves(level, st);
      if (!ms.length) break;
      const ex = ms.filter((m) => m.exit);
      const m = ex.length ? pick(ex) : pick(ms);
      const r = solvable(level, m.st, 40000);
      if (r.ok === false) { stranded++; if (m.exit) byExit++; leftAtStrand.push(alive(m.st)); break; }
      st = m.st;
    }
  }
  function pick(a) { return a[Math.floor(rng() * a.length)]; }
  return { win: wins / games, stranded: stranded / games, byExit, leftAtStrand };
}

// ---------------------------------------------------------------- ascii

const COLORS = "RGBYPOCW";
function render(level, st) {
  const { W, H } = level;
  const cell = Array.from({ length: H }, () => new Array(W).fill(" . "));
  for (const c of level.walls) cell[Math.floor(c / W)][c % W] = "###";
  level.blocks.forEach((b, i) => {
    const x = st[2 * i]; if (x === GONE) return;
    const y = st[2 * i + 1];
    const tag = " " + COLORS[b.color] + (b.axis === "h" ? "-" : b.axis === "v" ? "|" : String.fromCharCode(97 + (i % 26)));
    for (const [dx, dy] of b.info.cells) cell[y + dy][x + dx] = tag;
  });
  const edge = (side, k) => {
    const g = level.gates.find((g) => g.side === side && g.from <= k && k <= g.to);
    return g ? COLORS[g.color] : side === "L" || side === "R" ? "|" : "-";
  };
  let s = "   " + Array.from({ length: W }, (_, k) => " " + edge("T", k) + " ").join("") + "\n";
  for (let y = 0; y < H; y++) s += " " + edge("L", y) + " " + cell[y].join("") + " " + edge("R", y) + "\n";
  return s + "   " + Array.from({ length: W }, (_, k) => " " + edge("B", k) + " ").join("") + "\n";
}

module.exports = {
  SHAPES, POOL, shapeInfo, mulberry32, DX, DY, SIDE, GONE,
  buildOcc, slide, moves, key, isGoal, alive,
  bfs, heuristic, astar, solvable,
  makeGates, generate, verify, novice, render,
};
