#!/usr/bin/env node
/* Builds toys/jettison/levels.js: the Jettison level pack. GENERATED, never
 * hand-edit the output (the Tiny Across puzzles.js precedent).
 *
 *   node scripts/build-jettison-levels.cjs            # the whole pack
 *   node scripts/build-jettison-levels.cjs --stage 5  # one stage, printed, nothing written
 *
 * A hold starts PACKED (owner, 2026-10-02: the reference game starts as a
 * traffic jam you clear, and the first build's sparse holds were "too empty").
 *
 *   1. Shape the hold: a rectangle, or one with notched corners, a U, an H or
 *      a hole in it. Airlocks go on any stretch of wall, inner walls included.
 *   2. Tile it with chunky modules (2x3s, squares, Ts, Ls, bars), leaving only
 *      a cell or few of slack.
 *   3. Color the modules. Easy stages color by PEELING: take modules out one
 *      at a time and give each the color of the lock it left by, which yields
 *      holds that need no parking. Later stages color at random among the
 *      locks each module fits, which yields holds that need modules dragged
 *      aside first. Holds where some module could never leave are thrown out
 *      cheaply before the solver runs.
 *   4. Solve exactly (rules.js `solve`: fewest drags, breadth-first over
 *      parking moves with every jettison taken as soon as it is on offer) and
 *      keep holds whose parking count suits the stage.
 */
"use strict";

const path = require("path");
const fs = require("fs");
const os = require("os");
const { Worker, isMainThread, parentPort, workerData } = require("worker_threads");
const R = require(path.join(__dirname, "..", "toys", "jettison", "rules.js"));
const { SHAPES, shapeInfo, DX, DY, SIDE, GONE } = R;

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (r, a) => a[Math.floor(r() * a.length)];
const ri = (r, v) => Array.isArray(v) ? v[0] + Math.floor(r() * (v[1] - v[0] + 1)) : v;
function shuffle(r, a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

// chunky pieces, so a packed hold reads as cargo and not as confetti
const SMALL = ["D2h", "D2v", "D2h", "D2v", "I3h", "I3v", "L3a", "L3b", "L3c", "L3d", "O4", "O4"];
const CHUNKY = ["D2h", "D2v", "I3h", "I3v", "L3a", "L3b", "L3c", "L3d", "O4", "O4", "O4", "T4a", "T4b", "T4c", "T4d",
  "L4a", "L4b", "L4c", "L4d", "J4a", "J4b", "I4h", "I4v", "S4h", "Z4v", "R6h", "R6v", "R6h", "R6v", "P5a", "P5b", "P5c", "P5d", "M1"];
const BIG = CHUNKY.concat(["R6h", "R6v", "U5a", "U5b", "O9"]);

/* ------------------------------------------------------------ the stages
 * tip: the line the game shows on a stage's first level.
 * keep: how many levels. park: the parking moves the best line needs. */
const STAGES = [
  { id: "first", keep: 3, tip: "Drag a module into the airlock of its own color.",
    p: { W: [3, 4], H: [4, 5], kinds: ["rect"], gates: [2, 3], lens: [2, 3], colors: [1, 2], pool: SMALL, slack: [2, 4], fill: 0.55, color: "peel" },
    want: { park: [0, 0], blocks: [2, 4] } },
  { id: "fit", keep: 4, tip: "A module only fits through an airlock at least as wide as it is.",
    p: { W: 4, H: 5, kinds: ["rect"], gates: [3, 4], lens: [1, 2, 3], colors: [2, 3], pool: SMALL, slack: [1, 3], fill: 0.75, color: "peel" },
    want: { park: [0, 0], blocks: [4, 7], fit: true } },
  { id: "path", keep: 5, tip: "Packed in. Find the module that can get out first.",
    p: { W: 5, H: [5, 6], kinds: ["rect"], gates: [4, 5], lens: [1, 2, 3], colors: 3, pool: CHUNKY, slack: [1, 3], fill: 0.85, color: "peel" },
    want: { park: [0, 0], blocks: [6, 10] } },
  { id: "room", keep: 6, tip: "Nothing can get out? Drag a module aside to make room.",
    p: { W: 5, H: 6, kinds: ["rect", "rect", "notch"], gates: [4, 6], lens: [1, 2, 3], colors: 3, pool: CHUNKY, slack: [1, 3], fill: 0.85, color: "random" },
    want: { park: [1, 1], blocks: [6, 11] } },
  { id: "odd", keep: 6, tip: "Odd-shaped holds. Airlocks on the inner walls work too.",
    p: { W: [5, 6], H: [6, 7], kinds: ["U", "H", "hole", "notch"], gates: [5, 7], lens: [1, 2, 3], colors: [3, 4], pool: CHUNKY, slack: [1, 3], fill: 0.85, color: "random" },
    want: { park: [0, 2], blocks: [7, 13], inner: true } },
  { id: "jam", keep: 10, tip: null,
    p: { W: 6, H: 7, kinds: ["rect", "rect", "notch", "U", "H", "hole"], gates: [5, 7], lens: [1, 2, 2, 3, 3], colors: [3, 4], pool: CHUNKY, slack: [1, 3], fill: 0.88, color: "random" },
    want: { park: [1, 3], blocks: [9, 15] } },
  { id: "deep", keep: 12, tip: null,
    p: { W: [6, 7], H: 8, kinds: ["rect", "notch", "U", "H", "hole"], gates: [6, 8], lens: [1, 2, 2, 3, 3], colors: [4, 5], pool: BIG, slack: [1, 3], fill: 0.88, color: "random" },
    want: { park: [2, 5], blocks: [11, 18] } },
  { id: "expert", keep: 10, tip: null,
    p: { W: 7, H: [8, 9], kinds: ["rect", "notch", "U", "H", "hole"], gates: [7, 9], lens: [1, 2, 2, 3, 3], colors: [5, 6], pool: BIG, slack: [1, 2], fill: 0.9, color: "random" },
    want: { park: [4, 8], blocks: [13, 22] } }
];

/* ------------------------------------------------------------- the hold */

function holdShape(r, W, H, kind) {
  const holes = new Set();
  const cut = (x0, y0, w, h) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) if (x >= 0 && y >= 0 && x < W && y < H) holes.add(y * W + x); };
  if (kind === "notch") {
    for (const [cx, cy] of shuffle(r, [[0, 0], [1, 0], [0, 1], [1, 1]]).slice(0, ri(r, [1, 2]))) {
      const w = ri(r, [1, 2]), h = ri(r, [1, 2]); cut(cx ? W - w : 0, cy ? H - h : 0, w, h);
    }
  } else if (kind === "U") {
    // wide and deep enough that a lock can open into it
    const w = ri(r, [2, Math.max(2, W - 3)]), h = ri(r, [2, Math.max(2, Math.floor(H / 2))]), x0 = ri(r, [1, W - 1 - w]);
    if (r() < 0.5) cut(x0, 0, w, h); else cut(x0, H - h, w, h);
  } else if (kind === "H") {
    const w = ri(r, [2, Math.max(2, W - 3)]), x0 = ri(r, [1, W - 1 - w]), h = Math.max(2, Math.floor(H / 2) - 1);
    cut(x0, 0, w, ri(r, [2, h])); cut(x0, H - ri(r, [2, h]), w, H);
  } else if (kind === "hole") {
    const w = ri(r, [1, 2]), h = ri(r, [1, 2]); cut(ri(r, [1, W - 1 - w]), ri(r, [1, H - 1 - h]), w, h);
  }
  return holes;
}

// straight stretches of wall a lock could sit in: { side, line, from, to }
function wallRuns(W, H, holes) {
  const act = (x, y) => x >= 0 && y >= 0 && x < W && y < H && !holes.has(y * W + x);
  const out = [];
  for (let d = 0; d < 4; d++) {
    const lines = d < 2 ? W : H, n = d < 2 ? H : W;
    for (let ln = 0; ln < lines; ln++) {
      let s = -1;
      for (let a = 0; a <= n; a++) {
        const x = d < 2 ? ln : a, y = d < 2 ? a : ln;
        // a lock needs open space behind it, two cells deep and a cell clear
        // either side, or the hull drawn round a narrow notch covers the door
        let edge = a < n && act(x, y) && !act(x + DX[d], y + DY[d]);
        const px = Math.abs(DY[d]), py = Math.abs(DX[d]);
        for (let k = 1; k <= 2 && edge; k++) for (let q = -1; q <= 1; q++) if (act(x + DX[d] * k + px * q, y + DY[d] * k + py * q)) edge = false;
        if (edge && s < 0) s = a;
        if (!edge && s >= 0) { out.push({ side: SIDE[d], line: ln, from: s, to: a - 1 }); s = -1; }
      }
    }
  }
  return out;
}

function placeGates(r, W, H, holes, n, lens) {
  const runs = wallRuns(W, H, holes), gates = [], used = new Set();
  // spread over the sides first, so locks are not all on one wall
  const sides = shuffle(r, ["L", "R", "T", "B"]);
  for (let t = 0; gates.length < n && t < 600; t++) {
    const want = sides[gates.length % 4];
    const pool = t < 300 ? runs.filter((q) => q.side === want) : runs;
    if (!pool.length) continue;
    const run = pick(r, pool), len = Math.min(pick(r, lens), run.to - run.from + 1);
    const from = ri(r, [run.from, run.to - len + 1]);
    let ok = true;
    for (let a = from; a < from + len; a++) if (used.has(run.side + run.line + ":" + a)) ok = false;
    if (!ok) continue;
    for (let a = from; a < from + len; a++) used.add(run.side + run.line + ":" + a);
    gates.push({ side: run.side, line: run.line, from, to: from + len - 1, color: -1 });
  }
  return gates;
}

function tile(r, W, H, holes, pool) {
  const occ = new Int8Array(W * H); for (const h of holes) occ[h] = 1;
  const blocks = [];
  for (let c = 0; c < W * H; c++) {
    if (occ[c]) continue;
    const x0 = c % W, y0 = Math.floor(c / W);
    let placed = false;
    for (const name of shuffle(r, pool.slice())) {
      const cells = SHAPES[name];
      let ax = 99, ay = 99;
      for (const [cx, cy] of cells) if (cy < ay || (cy === ay && cx < ax)) { ax = cx; ay = cy; }
      const bx = x0 - ax, by = y0 - ay;
      if (!cells.every(([cx, cy]) => { const X = bx + cx, Y = by + cy; return X >= 0 && Y >= 0 && X < W && Y < H && !occ[Y * W + X]; })) continue;
      for (const [cx, cy] of cells) occ[(by + cy) * W + bx + cx] = 1;
      blocks.push({ shape: name, x: bx, y: by, color: -1 });
      placed = true; break;
    }
    if (!placed) occ[c] = 2;   // a cell of slack
  }
  return blocks;
}

function colorGates(r, gates, nColors) {
  shuffle(r, gates.map((_, k) => k)).forEach((k, j) => { gates[k].color = j < nColors ? j : Math.floor(r() * nColors); });
}

// random colors among the locks each module could physically pass
function colorRandom(r, raw, nColors) {
  const count = new Array(nColors).fill(0);
  for (const b of raw.blocks) {
    const inf = shapeInfo(b.shape), ok = [];
    for (const g of raw.gates) {
      const cross = g.side === "L" || g.side === "R" ? inf.h : inf.w;
      if (cross <= g.to - g.from + 1 && ok.indexOf(g.color) < 0) ok.push(g.color);
    }
    if (!ok.length) return false;
    ok.sort((a, b2) => count[a] - count[b2] + (r() - 0.5) * 1.5);
    b.color = ok[0]; count[b.color]++;
  }
  return true;
}

// which lock (any color) would take module i out going d from (x, y)?
function anyLock(level, occ, i, x, y, d) {
  const W = level.W, H = level.H;
  let gate = null, touching = false;
  for (const [ox, oy] of level.blocks[i].info.cells) {
    const cx = x + ox, cy = y + oy; let px = cx, py = cy;
    for (;;) {
      const nx = px + DX[d], ny = py + DY[d];
      if (nx < 0 || ny < 0 || nx >= W || ny >= H || occ[ny * W + nx] === -1) {
        const along = d < 2 ? py : px, line = d < 2 ? px : py;
        const g = level.gates.find((q) => q.side === SIDE[d] && q.line === line && q.from <= along && along <= q.to);
        if (!g || (gate && g !== gate)) return null;
        gate = g; if (px === cx && py === cy) touching = true; break;
      }
      const o = occ[ny * W + nx]; if (o !== 0 && o !== i + 1) return null;
      px = nx; py = ny;
    }
  }
  return touching ? gate : null;
}

// peel: take modules out one at a time, each colored for the lock it used
function colorPeel(r, raw) {
  const level = R.prepare(raw), st = level.start.slice(), N = level.blocks.length;
  const use = level.gates.map(() => 0);
  for (let guard = 0; !R.isGoal(st) && guard < 100; guard++) {
    const occ = R.buildOcc(level, st), opts = [];
    for (let i = 0; i < N; i++) {
      if (st[2 * i] === GONE) continue;
      for (const [x, y] of R.reach(level, occ, i, st[2 * i], st[2 * i + 1]).list)
        for (let d = 0; d < 4; d++) { const g = anyLock(level, occ, i, x, y, d); if (g) opts.push({ i, k: level.gates.indexOf(g) }); }
    }
    if (!opts.length) return false;
    opts.sort((a, b) => use[a.k] - use[b.k] + (r() - 0.5) * 2);
    const o = opts[0];
    raw.blocks[o.i].color = level.gates[o.k].color; use[o.k]++;
    st[2 * o.i] = GONE; st[2 * o.i + 1] = GONE;
  }
  return R.isGoal(st);
}

// cheap rejection: a module that could not leave an EMPTY hold never will
function eachCanLeave(level) {
  const N = level.blocks.length;
  for (let i = 0; i < N; i++) {
    const st = new Int16Array(N * 2).fill(GONE); st[2 * i] = level.start[2 * i]; st[2 * i + 1] = level.start[2 * i + 1];
    const occ = R.buildOcc(level, st);
    if (!R.reach(level, occ, i, st[2 * i], st[2 * i + 1]).list.some(([x, y]) => R.exitDir(level, occ, i, x, y) >= 0)) return false;
  }
  return true;
}

// replay a line move by move: the proof the par is real
function verify(level, line) {
  const st = level.start.slice();
  for (const [i, x, y, d] of line) {
    if (st[2 * i] === GONE) return false;
    const occ = R.buildOcc(level, st);
    if (!R.reach(level, occ, i, st[2 * i], st[2 * i + 1]).list.some((p) => p[0] === x && p[1] === y)) return false;
    if (d >= 0) { if (!R.canExit(level, occ, i, x, y, d)) return false; st[2 * i] = GONE; st[2 * i + 1] = GONE; }
    else { st[2 * i] = x; st[2 * i + 1] = y; }
  }
  return R.isGoal(st);
}

// how many modules can go straight out at the start (fewer = harder to see)
function openers(level) {
  const occ = R.buildOcc(level, level.start); let n = 0;
  for (let i = 0; i < level.blocks.length; i++) {
    if (R.reach(level, occ, i, level.start[2 * i], level.start[2 * i + 1]).list.some(([x, y]) => R.exitDir(level, occ, i, x, y) >= 0)) n++;
  }
  return n;
}

function candidate(s, seed) {
  const r = mulberry32(seed), p = s.p;
  const W = ri(r, p.W), H = ri(r, p.H), holes = holdShape(r, W, H, pick(r, p.kinds));
  const nColors = ri(r, p.colors);
  const gates = placeGates(r, W, H, holes, ri(r, p.gates), p.lens);
  if (gates.length < nColors) return null;
  colorGates(r, gates, nColors);
  let blocks = tile(r, W, H, holes, p.pool);
  const area = W * H - holes.size;
  let free = area - blocks.reduce((t, b) => t + SHAPES[b.shape].length, 0);
  const slack = ri(r, p.slack);
  shuffle(r, blocks);
  while (free < slack && blocks.length > 2) free += SHAPES[blocks.pop().shape].length;
  if (1 - free / area < p.fill) return null;
  const raw = { W, H, holes: [...holes].sort((a, b) => a - b), gates, blocks };
  if (!(p.color === "peel" ? colorPeel(r, raw) : colorRandom(r, raw, nColors))) return null;
  // locks of a color no module carries are dropped
  const used = new Set(raw.blocks.map((b) => b.color));
  raw.gates = raw.gates.filter((g) => used.has(g.color));
  // colors renumbered so each level starts at the first palette entry
  const map = {}; let next = 0;
  raw.gates.forEach((g) => { if (map[g.color] === undefined) map[g.color] = next++; });
  raw.gates.forEach((g) => { g.color = map[g.color]; });
  raw.blocks.forEach((b) => { b.color = map[b.color]; });
  // modules in reading order, so their stencil codes run sensibly
  raw.blocks.sort((a, b) => a.y - b.y || a.x - b.x);
  // no hold that is nearly all one color
  const counts = {};
  raw.blocks.forEach((b) => { counts[b.color] = (counts[b.color] || 0) + 1; });
  const cv = Object.values(counts);
  if (Math.max(...cv) > Math.min(...cv) * 2 + 1) return null;
  const level = R.prepare(raw);
  if (raw.blocks.length < s.want.blocks[0] || raw.blocks.length > s.want.blocks[1]) return null;
  if (s.want.fit && !raw.blocks.some((b) => {
    const inf = shapeInfo(b.shape);
    return raw.gates.some((g) => g.color === b.color && (g.side === "L" || g.side === "R" ? inf.h : inf.w) > g.to - g.from + 1);
  })) return null;
  if (s.want.inner && !raw.gates.some((g) => g.line !== (g.side === "L" || g.side === "T" ? 0 : g.side === "R" ? W - 1 : H - 1))) return null;
  if (!eachCanLeave(level)) return null;
  const res = R.solve(level, level.start, 60000, s.want.park[1]);
  if (res.par < 0 || res.park < s.want.park[0]) return null;
  const line = res.path.map((m) => [m.i, m.x, m.y, m.d]);
  if (!verify(level, line)) return { bad: "replay", seed };
  return {
    seed,
    lvl: { W, H, holes: raw.holes, gates: raw.gates.map((g) => ({ side: g.side, line: g.line, from: g.from, to: g.to, color: g.color })),
      blocks: raw.blocks, par: res.par, park: res.park, open: openers(level), line, stage: s.id }
  };
}

// -------------------------------------------------------------- worker side

if (!isMainThread) {
  const { stageIndex, seeds } = workerData, s = STAGES[stageIndex], out = [];
  for (const seed of seeds) { const c = candidate(s, seed); if (c) out.push(c); }
  parentPort.postMessage(out);
  return;
}

// ---------------------------------------------------------------- main side

function runStage(si, nSeeds) {
  const cores = Math.max(2, os.cpus().length - 1), base = 1000003 * (si + 1), all = [];
  for (let k = 0; k < nSeeds; k++) all.push(base + k * 7919);
  const chunks = Array.from({ length: cores }, () => []);
  all.forEach((s, k) => chunks[k % cores].push(s));
  return Promise.all(chunks.map((seeds) => new Promise((res, rej) => {
    const w = new Worker(__filename, { workerData: { stageIndex: si, seeds } });
    w.on("message", res); w.on("error", rej);
  }))).then((parts) => parts.flat());
}

// spread the picks across the stage's difficulty, easiest first
function difficulty(l) { return l.park * 3 + l.blocks.length * 0.25 - l.open * 0.6; }
function choose(cands, keep) {
  const seen = new Set();
  const uniq = cands.filter((c) => { const k = JSON.stringify([c.lvl.W, c.lvl.H, c.lvl.holes, c.lvl.blocks]); if (seen.has(k)) return false; seen.add(k); return true; });
  uniq.sort((a, b) => difficulty(a.lvl) - difficulty(b.lvl));
  if (uniq.length <= keep) return uniq;
  const out = [];
  for (let k = 0; k < keep; k++) out.push(uniq[Math.round(k * (uniq.length - 1) / (keep - 1))]);
  return out;
}

const SEEDS = { first: 300, fit: 600, path: 600, room: 1200, odd: 1500, jam: 1800, deep: 2600, expert: 4000 };

(async function main() {
  const args = process.argv.slice(2);
  const only = args.includes("--stage") ? +args[args.indexOf("--stage") + 1] : null;
  const t0 = Date.now(), pack = [];
  for (let si = 0; si < STAGES.length; si++) {
    if (only !== null && si !== only) continue;
    const s = STAGES[si], ts = Date.now();
    const res = await runStage(si, SEEDS[s.id]);
    const bad = res.filter((q) => q.bad), cands = res.filter((q) => q.lvl), picked = choose(cands, s.keep);
    const parks = {}; cands.forEach((c) => { parks[c.lvl.park] = (parks[c.lvl.park] || 0) + 1; });
    console.log(`${s.id.padEnd(7)} candidates ${String(cands.length).padStart(4)} ${JSON.stringify(parks)}  kept ${picked.length}/${s.keep}  ` +
      `par ${picked.map((c) => c.lvl.par).join(",")}  park ${picked.map((c) => c.lvl.park).join(",")}  ` +
      `${bad.length ? "FAILED " + bad.length + " " : ""}(${((Date.now() - ts) / 1000).toFixed(1)}s)`);
    if (bad.length) { console.error("replay failures:", bad.slice(0, 5)); process.exitCode = 1; }
    picked.forEach((c, k) => { if (k === 0 && s.tip) c.lvl.tip = s.tip; pack.push(c.lvl); });
  }
  if (only !== null) {
    pack.forEach((l, k) => console.log(k, l.W + "x" + l.H, "holes " + l.holes.length, l.blocks.length + " modules", "par " + l.par, "park " + l.park, "open " + l.open));
    return;
  }
  const out = path.join(__dirname, "..", "toys", "jettison", "levels.js");
  const body = "/* GENERATED by scripts/build-jettison-levels.cjs on " + new Date().toISOString().slice(0, 10) +
    ". Do not edit: change the builder and rerun it.\n * " + pack.length + " levels in teaching order; each carries its exact par and an optimal line ([module, x, y, side or -1 to park]). */\n" +
    "window.JETTISON_LEVELS = " + JSON.stringify(pack) + ";\n";
  fs.writeFileSync(out, body);
  console.log(`wrote ${pack.length} levels to ${path.relative(process.cwd(), out)} (${(body.length / 1024).toFixed(0)} KB) in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
})();
