// Measurements behind the color-exit BACKLOG entry (2026-10-03).
// Run: node scripts/research/color-exit/lab.js <experiment>
//   random   random boards: why plain search is out
//   ladder   reverse-built levels by size: par, A* time, greedy-player wins
//   gates    corner vs mid-wall gates: the difficulty dial
//   strand   when and how greedy players strand the tray
//   timing   7x7 and 7x8 boards: is solving in the browser viable? (run it
//            alone: other jobs on the CPU inflate the times)
//   twists   pillars and one-axis blocks
//   check    A* par equals BFS par wherever BFS can finish
//   show     print a few levels as ASCII (gate letters on the rim)
// Each takes a few minutes to a quarter of an hour.

"use strict";
const R = require("./rules");

function stats(a) {
  if (!a.length) return "n/a";
  const s = a.slice().sort((x, y) => x - y);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return `mean ${(s.reduce((x, y) => x + y, 0) / s.length).toFixed(1)} p50 ${q(0.5)} p90 ${q(0.9)} max ${s[s.length - 1]}`;
}
const BASE = { gatesPerColor: 1, gateLens: [1, 2, 2, 3], W: 6, H: 6, nColors: 4 };

function built(name, p, n, { grade = false, seed = 1 } = {}) {
  const par = [], extra = [], ms = [], win = [];
  let capped = 0;
  for (let k = 0; k < n; k++) {
    const { level, start, solution } = R.generate(p, R.mulberry32(seed * 1000 + k * 97));
    if (!R.verify(level, start, solution)) throw new Error("construction failed to verify");
    const t0 = Date.now();
    const a = R.astar(level, start);
    ms.push(Date.now() - t0);
    if (a.par < 0) { capped++; continue; }
    par.push(a.par); extra.push(a.par - level.blocks.length);
    if (grade) win.push(Math.round(100 * R.novice(level, start, 16, k + 1).win));
  }
  console.log(`\n${name} (${p.W}x${p.H}, ${p.nBlocks} blocks)`);
  console.log(`  par ${stats(par)} | setup moves (par minus blocks) ${stats(extra)}`);
  console.log(`  A* ms ${stats(ms)}${capped ? ` | capped ${capped}/${n}` : ""}`);
  if (grade) console.log(`  greedy novice win % ${stats(win)} | always-won levels ${win.filter((w) => w === 100).length}/${win.length}`);
}

const X = {
  random() {
    // Forward random placement, gates sized to fit every block of their color.
    for (const nBlocks of [6, 9, 12]) {
      let bfsCapped = 0, dead = 0;
      const dfsMs = [], par = [], aMs = [];
      for (let k = 0; k < 30; k++) {
        const rng = R.mulberry32(7000 + k * 31);
        const { level, start } = randomBoard({ ...BASE, nBlocks }, rng);
        if (nBlocks === 6 && R.bfs(level, start, 200000).capped) bfsCapped++;
        let t0 = Date.now();
        const s = R.solvable(level, start, 300000);
        dfsMs.push(Date.now() - t0);
        if (s.ok !== true) { dead++; continue; }
        t0 = Date.now();
        const a = R.astar(level, start);
        aMs.push(Date.now() - t0);
        if (a.par >= 0) par.push(a.par - level.blocks.length);
      }
      console.log(`\nrandom 6x6, ${nBlocks} blocks: ${dead}/30 unsolvable or undecided${nBlocks === 6 ? ` | plain BFS hit 200k states on ${bfsCapped}/30` : ""}`);
      console.log(`  winnable-check ms ${stats(dfsMs)} | setup moves ${stats(par)} | A* ms ${stats(aMs)}`);
    }
  },
  ladder() {
    built("intro: 3 blocks, no setup", { ...BASE, nBlocks: 3, nColors: 2, slideProb: 0 }, 30, { grade: true });
    built("easy: 6 blocks", { ...BASE, nBlocks: 6, nColors: 3, slideProb: 0.3 }, 30, { grade: true });
    built("mid: 8 blocks", { ...BASE, nBlocks: 8, slideProb: 0.4 }, 30, { grade: true });
    built("hard: 10 blocks", { ...BASE, nBlocks: 10, slideProb: 0.5 }, 30, { grade: true });
    built("harder: 12 blocks", { ...BASE, nBlocks: 12, nColors: 5, slideProb: 0.6 }, 30, { grade: true });
  },
  gates() {
    const p = { ...BASE, nBlocks: 8, slideProb: 0.4 };
    built("gates flush with a corner", { ...p, gatePlacement: "corner" }, 30, { grade: true, seed: 61 });
    built("gates mid-wall", { ...p, gatePlacement: "middle" }, 30, { grade: true, seed: 61 });
    built("gates anywhere", p, 30, { grade: true, seed: 61 });
  },
  strand() {
    for (const nBlocks of [6, 10]) {
      let games = 0, stranded = 0, byExit = 0;
      const left = [];
      for (let k = 0; k < 30; k++) {
        const { level, start } = R.generate({ ...BASE, nBlocks, slideProb: nBlocks / 20 }, R.mulberry32(51000 + k * 13));
        const r = R.novice(level, start, 10, k + 1);
        games += 10; stranded += Math.round(r.stranded * 10); byExit += r.byExit; left.push(...r.leftAtStrand);
      }
      console.log(`\n${nBlocks} blocks: ${stranded}/${games} greedy games stranded, ${byExit} of them by an exit`);
      console.log(`  blocks left right after the fatal move ${stats(left)}`);
    }
  },
  timing() {
    built("7x7, 12 blocks", { ...BASE, W: 7, H: 7, nBlocks: 12, nColors: 5, slideProb: 0.4 }, 25, { seed: 9 });
    built("7x7, 14 blocks, 40% one-axis", { ...BASE, W: 7, H: 7, nBlocks: 14, nColors: 5, slideProb: 0.4, arrowProb: 0.4 }, 25, { seed: 9 });
    built("7x8, 14 blocks", { ...BASE, W: 7, H: 8, nBlocks: 14, nColors: 6, slideProb: 0.4 }, 20, { seed: 9 });
    built("7x8, 18 blocks", { ...BASE, W: 7, H: 8, nBlocks: 18, nColors: 6, slideProb: 0.4 }, 20, { seed: 9 });
  },
  twists() {
    const p = { ...BASE, nBlocks: 10, slideProb: 0.5 };
    built("plain", p, 30, { grade: true, seed: 20 });
    built("3 pillars", { ...p, pillars: 3 }, 30, { grade: true, seed: 20 });
    built("40% one-axis blocks", { ...p, arrowProb: 0.4 }, 30, { grade: true, seed: 20 });
  },
  check() {
    let same = 0, diff = 0;
    for (let k = 0; k < 120; k++) {
      const p = { ...BASE, W: 5 + (k % 2), H: 5 + (k % 2), nBlocks: 3 + (k % 4), nColors: 3, slideProb: 0.5, arrowProb: k % 3 ? 0 : 0.4, pillars: k % 5 ? 0 : 2 };
      const { level, start } = R.generate(p, R.mulberry32(777 + k * 3));
      const b = R.bfs(level, start, 3000000), a = R.astar(level, start, 3000000);
      if (b.par === a.par) same++; else { diff++; console.log("mismatch", k, b.par, a.par); }
    }
    console.log(`A* par matched BFS on ${same}/${same + diff} boards`);
  },
  show() {
    for (let k = 0; k < 4; k++) {
      const { level, start } = R.generate({ ...BASE, nBlocks: 8, slideProb: 0.4 }, R.mulberry32(300 + k));
      const a = R.astar(level, start);
      console.log(`\nlevel ${k}: ${level.blocks.length} blocks, par ${a.par}`);
      console.log(R.render(level, start));
    }
  },
};

// Forward random board (the approach that does NOT work, kept for contrast).
function randomBoard(p, rng) {
  const { W, H } = p;
  const occ = new Int8Array(W * H), blocks = [], st = [];
  for (let t = 0; blocks.length < p.nBlocks && t < 2000; t++) {
    const name = R.POOL[Math.floor(rng() * R.POOL.length)];
    const info = R.shapeInfo(R.SHAPES[name]);
    const x = Math.floor(rng() * (W - info.w + 1)), y = Math.floor(rng() * (H - info.h + 1));
    if (info.cells.some(([dx, dy]) => occ[(y + dy) * W + x + dx])) continue;
    for (const [dx, dy] of info.cells) occ[(y + dy) * W + x + dx] = 1;
    blocks.push({ name, info, color: Math.floor(rng() * p.nColors), axis: null });
    st.push(x, y);
  }
  const used = { L: new Int8Array(H), R: new Int8Array(H), T: new Int8Array(W), B: new Int8Array(W) };
  const gates = [];
  for (const color of new Set(blocks.map((b) => b.color))) {
    const mine = blocks.filter((b) => b.color === color);
    for (let t = 0; t < 200; t++) {
      const side = R.SIDE[Math.floor(rng() * 4)];
      const along = side === "L" || side === "R" ? H : W;
      const need = Math.max(...mine.map((b) => (side === "L" || side === "R" ? b.info.h : b.info.w)));
      const len = Math.min(along, need + Math.floor(rng() * 2));
      const from = Math.floor(rng() * (along - len + 1));
      let free = true;
      for (let k = from; k < from + len; k++) if (used[side][k]) free = false;
      if (!free) continue;
      for (let k = from; k < from + len; k++) used[side][k] = 1;
      gates.push({ side, from, to: from + len - 1, color });
      break;
    }
  }
  return { level: { W, H, walls: new Set(), gates, blocks }, start: Int16Array.from(st) };
}

const which = process.argv[2];
if (!X[which]) { console.log("experiments: " + Object.keys(X).join(", ")); process.exit(1); }
X[which]();
