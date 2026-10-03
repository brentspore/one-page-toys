#!/usr/bin/env node
/* Builds toys/decant/levels.js: the Decant level pack. GENERATED, never
 * hand-edit the output.
 *
 *   node scripts/build-decant-levels.cjs           # the whole pack
 *   node scripts/build-decant-levels.cjs --try 60  # print level 60's candidates, write nothing
 *
 * Each level: shuffle `colors x cap` layers into `colors` full bottles, add two
 * empty ones, hide some layers, then prove it solvable with the solver in
 * toys/decant/rules.js, which plays by the player's rules (it only pours
 * revealed layers; it just knows the colors). The recorded line is replayed.
 * The spare bottle the player can add is never needed.
 *
 * Difficulty comes from the schedule: more colors, then hidden layers, then
 * taller bottles (6 layers). Among a level's candidates the builder keeps the
 * one whose solution length sits nearest the middle, so no level is a fluke
 * that solves itself or a monster.
 */
"use strict";
const path = require("path"), fs = require("fs");
const R = require(path.join(__dirname, "..", "toys", "decant", "rules.js"));

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// level number (1-based) -> its settings
function plan(L) {
  if (L === 1) return { colors: 2, cap: 4, empty: 1, hidden: 0, tip: "Tap a bottle, then tap another to pour. Sort every potion into its own bottle." };
  if (L === 2) return { colors: 3, cap: 4, empty: 2, hidden: 0, tip: "You can only pour onto the same color, or into an empty bottle." };
  if (L <= 5) return { colors: 4, cap: 4, empty: 2, hidden: 0 };
  if (L <= 9) return { colors: 5, cap: 4, empty: 2, hidden: 0 };
  if (L <= 14) return { colors: 6, cap: 4, empty: 2, hidden: 0, tip: L === 10 ? "Get stuck and a spare bottle unlocks, once per level. Undo is always free." : null };
  if (L <= 20) return { colors: 7, cap: 4, empty: 2, hidden: L >= 16 ? 0.3 : 0, tip: L === 16 ? "Clouded layers hide their color until they reach the top." : null };
  if (L <= 30) return { colors: 8, cap: 4, empty: 2, hidden: 0.4 };
  if (L <= 40) return { colors: 9, cap: 4, empty: 2, hidden: 0.5 };
  if (L <= 50) return { colors: 10, cap: 4, empty: 2, hidden: 0.55 };
  if (L <= 60) return { colors: 7, cap: 6, empty: 2, hidden: 0.3, tip: L === 51 ? "Taller bottles from here: six layers each." : null };
  if (L <= 75) return { colors: 8, cap: 6, empty: 2, hidden: 0.45 };
  if (L <= 90) return { colors: 9, cap: 6, empty: 2, hidden: 0.5 };
  if (L <= 105) return { colors: 10, cap: 6, empty: 2, hidden: 0.55 };
  return { colors: 12, cap: 6, empty: 2, hidden: 0.6 };
}
const LEVELS = 120;

function deal(p, rng) {
  const units = [];
  for (let c = 0; c < p.colors; c++) for (let k = 0; k < p.cap; k++) units.push(c);
  for (let i = units.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [units[i], units[j]] = [units[j], units[i]]; }
  const t = [], h = [];
  for (let b = 0; b < p.colors; b++) {
    t.push(units.slice(b * p.cap, (b + 1) * p.cap));
    // the top layer always shows; below it, hidden with probability p.hidden
    h.push(t[b].map((_, i) => i < p.cap - 1 && rng() < p.hidden));
  }
  for (let e = 0; e < p.empty; e++) { t.push([]); h.push([]); }
  return { t, h };
}

// a shelf worth playing: nothing already finished, no bottle more than half one color
function fair(S, p) {
  for (const t of S.t) {
    if (!t.length) continue;
    const counts = {};
    t.forEach((c) => { counts[c] = (counts[c] || 0) + 1; });
    if (Math.max(...Object.values(counts)) > Math.ceil(p.cap / 2)) return false;
  }
  return true;
}

function replay(S0, p, line) {
  const S = R.clone(S0);
  for (const [a, b] of line) if (!R.pour(S, p.cap, a, b)) return false;
  return R.solved(S, p.cap);
}

function build(L, tries) {
  const p = plan(L), cands = [];
  for (let k = 0; k < (tries || 14) && cands.length < 6; k++) {
    const rng = mulberry32(L * 7919 + k * 104729);
    const S = deal(p, rng);
    if (!fair(S, p)) continue;
    const t0 = Date.now(), line = R.solve(S, p.cap, 400000);
    if (!line) continue;
    if (!replay(S, p, line)) throw new Error("level " + L + ": recorded line does not replay");
    cands.push({ S, line, ms: Date.now() - t0 });
  }
  if (!cands.length) throw new Error("level " + L + ": no solvable shelf found");
  cands.sort((a, b) => a.line.length - b.line.length);
  const pick = cands[Math.floor((cands.length - 1) / 2)];
  return { p, pick, cands };
}

const args = process.argv.slice(2);
if (args.includes("--try")) {
  const L = +args[args.indexOf("--try") + 1], { p, cands } = build(L, 30);
  console.log("level", L, JSON.stringify(p));
  cands.forEach((c) => console.log("  moves", c.line.length, "solve ms", c.ms));
  process.exit(0);
}

const t0 = Date.now(), pack = [];
for (let L = 1; L <= LEVELS; L++) {
  const { p, pick } = build(L);
  const lvl = { cap: p.cap, t: pick.S.t, h: pick.S.h.map((row) => row.map((x) => (x ? 1 : 0))), line: pick.line.length };
  if (p.tip) lvl.tip = p.tip;
  pack.push(lvl);
  if (L % 10 === 0) console.log(`level ${L}: ${p.colors} colors x ${p.cap}, hidden ${p.hidden}, solution ${pick.line.length} pours (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}
const out = path.join(__dirname, "..", "toys", "decant", "levels.js");
const body = "/* GENERATED by scripts/build-decant-levels.cjs on " + new Date().toISOString().slice(0, 10) +
  ". Do not edit: change the builder and rerun it.\n * " + pack.length + " levels; t = bottles bottom to top (color numbers), h = hidden layers, line = pours in the builder's own solution. */\n" +
  "window.DECANT_LEVELS = " + JSON.stringify(pack) + ";\n";
fs.writeFileSync(out, body);
console.log(`wrote ${pack.length} levels to ${path.relative(process.cwd(), out)} (${(body.length / 1024).toFixed(0)} KB) in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
