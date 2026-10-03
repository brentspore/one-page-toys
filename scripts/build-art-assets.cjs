#!/usr/bin/env node
/* Builds the share image and the gallery card for every toy that has
 * featured key art (owner, 2026-10-03: "replace it and the card images but
 * always crop to still show the title nicely").
 *
 *   node scripts/build-art-assets.cjs            # every toy in FEATURED_ART
 *   node scripts/build-art-assets.cjs jettison   # just these
 *
 * For each slug:
 *   assets/og/<slug>.jpg     1200x630 JPEG under ~290KB (WhatsApp drops heavier
 *                            previews), cropped from the 16:9 art
 *   assets/cards/<slug>.webp the whole 16:9 art, small
 *   assets/styles.css        its .card__preview rule points at the webp, with
 *                            the vertical position that keeps the title in
 *   toys|tools/<path>/index.html  og:image and twitter:image point at the jpg
 * Both image URLs carry a content hash, so a re-crop never shows a stale copy.
 *
 * TITLE says where each title sits, as a percentage down the art (0 = keep
 * the top, 50 = centre, 100 = keep the bottom). The card strip is wider than
 * the art (2.3 to 2.6 : 1 against 1.78), so a card always shows the art's
 * full width and loses 22 to 32% of its height; the share image loses 7%.
 * One number drives both. Check by eye after changing it: render the sheet
 * with `--sheet <out.png>`.
 *
 * Sources: assets/featured/_sources/<slug>.png (1672x941). Word Kraven has
 * no source left and is built from its 1200x675 webp, which still crops to
 * exactly 1200x630. macOS only (sips + cwebp), like the rest of the art pipeline.
 */
"use strict";

const fs = require("fs"), path = require("path"), os = require("os"), crypto = require("crypto");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const TITLE = {
  accretion: 50, "air-hockey": 0, alpenglow: 30, bowling: 30, "brick-smasher": 30, chess: 0, decant: 0,
  darts: 20, "deep-descent": 40, "deep-hollow": 45, "dot-loop": 4, "five-second-game": 45,
  jettison: 0, maw: 0, meld: 25, "mini-golf": 15, "nova-coil": 35, "paper-plane": 20,
  "perfect-circle": 50, "perfect-timing": 45, pinball: 15, pool: 30, puffling: 20,
  "random-maze": 30, "shuriken-night": 20, "skee-ball": 10, "sky-fortress": 15, skyscrapers: 0,
  "slice-it": 30, "spelling-blocks": 40, "stack-tower": 45, "tiny-across": 25, "tossing-cards": 15,
  "trail-game": 40, "trench-runner": 0, trio: 35, "twisty-cube": 35, "word-kraven": 30
};
// Tiny Across keeps the share image the owner signed off (`og/tiny-across.jpg`,
// cropped by hand); only its card comes from here.
const KEEP_OG = new Set(["tiny-across"]);
const OG_MAX = 290 * 1024;

function sh(cmd, args) { return execFileSync(cmd, args, { stdio: ["ignore", "pipe", "pipe"] }).toString(); }
function hash(file) { return crypto.createHash("sha1").update(fs.readFileSync(file)).digest("hex").slice(0, 8); }
function size(file) { const o = sh("sips", ["-g", "pixelWidth", "-g", "pixelHeight", file]); return [+/pixelWidth: (\d+)/.exec(o)[1], +/pixelHeight: (\d+)/.exec(o)[1]]; }

const mainJs = fs.readFileSync(path.join(ROOT, "assets", "main.js"), "utf8");
const FEATURED = /const FEATURED_ART = \[([\s\S]*?)\];/.exec(mainJs)[1].match(/"[a-z0-9-]+"/g).map((s) => s.slice(1, -1));
const registry = JSON.parse(fs.readFileSync(path.join(ROOT, "tools-registry.json"), "utf8"));

const args = process.argv.slice(2);
const sheetAt = args.indexOf("--sheet");
const sheet = sheetAt >= 0 ? args.splice(sheetAt, 2)[1] : null;
const only = args.length ? args : FEATURED;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "art-"));
let css = fs.readFileSync(path.join(ROOT, "assets", "styles.css"), "utf8");
const done = [];

for (const slug of only) {
  if (!FEATURED.includes(slug)) { console.error(`${slug}: not in FEATURED_ART, skipped`); process.exitCode = 1; continue; }
  if (TITLE[slug] === undefined) { console.error(`${slug}: no TITLE position, skipped (add one)`); process.exitCode = 1; continue; }
  const P = TITLE[slug] / 100;
  let src = path.join(ROOT, "assets", "featured", "_sources", slug + ".png");
  if (!fs.existsSync(src)) {
    const webp = path.join(ROOT, "assets", "featured", slug + ".webp");
    src = path.join(tmp, slug + ".png");
    sh("sips", ["-s", "format", "png", webp, "--out", src]);
  }
  const [w, h] = size(src);

  // the card: the whole art, small
  const card = path.join(ROOT, "assets", "cards", slug + ".webp");
  sh("cwebp", ["-quiet", "-q", "78", "-resize", "720", "405", src, "-o", card]);
  const cardUrl = `cards/${slug}.webp?v=${hash(card)}`;
  const rule = `.card__preview[data-slug="${slug}"]{ background: #05070d url("${cardUrl}") center ${TITLE[slug]}% / cover no-repeat; }`;
  const re = new RegExp(`^\\.card__preview\\[data-slug="${slug}"\\]\\{[^\\n]*\\}$`, "m");
  if (!re.test(css)) { console.error(`${slug}: no card rule in styles.css`); process.exitCode = 1; continue; }
  css = css.replace(re, rule);

  // the share image: a 1.905:1 window, placed by TITLE, at 1200x630
  let ogNote = "kept";
  if (!KEEP_OG.has(slug)) {
    const ch = Math.round(w * 630 / 1200), off = Math.round((h - ch) * P);
    // ⚠ `sips --cropOffset` is ignored (sips always crops from the centre), so
    // the crop is cwebp's, which is exact, into a lossless intermediate
    const crop = path.join(tmp, slug + "-crop.webp"), og = path.join(ROOT, "assets", "og", slug + ".jpg");
    sh("cwebp", ["-quiet", "-lossless", "-crop", "0", String(off), String(w), String(ch), "-resize", "1200", "630", src, "-o", crop]);
    let q = 84;
    do { sh("sips", ["-s", "format", "jpeg", "-s", "formatOptions", String(q), crop, "--out", og]); q -= 4; }
    while (fs.statSync(og).size > OG_MAX && q >= 50);
    const ogUrl = `https://onepagetoys.com/assets/og/${slug}.jpg?v=${hash(og)}`;
    const tool = registry.find((t) => t.slug === slug);
    const page = tool && path.join(ROOT, tool.path, "index.html");
    if (!page || !fs.existsSync(page)) { console.error(`${slug}: page not found`); process.exitCode = 1; continue; }
    let html = fs.readFileSync(page, "utf8");
    const before = html;
    html = html.replace(/(<meta property="og:image" content=")[^"]*(")/, `$1${ogUrl}$2`)
      .replace(/(<meta name="twitter:image" content=")[^"]*(")/, `$1${ogUrl}$2`)
      .replace(/(<meta property="og:image:type" content=")[^"]*(")/, "$1image/jpeg$2")
      .replace(/(<meta property="og:image:width" content=")[^"]*(")/, "$11200$2")
      .replace(/(<meta property="og:image:height" content=")[^"]*(")/, "$1630$2");
    if (html === before && !before.includes(ogUrl)) { console.error(`${slug}: no og:image meta to update`); process.exitCode = 1; }
    fs.writeFileSync(page, html);
    ogNote = `${(fs.statSync(og).size / 1024).toFixed(0)}KB q${q + 4}`;
  }
  done.push({ slug, src, P: TITLE[slug] });
  console.log(`${slug.padEnd(17)} title ${String(TITLE[slug]).padStart(3)}%  card ${(fs.statSync(card).size / 1024).toFixed(0)}KB  og ${ogNote}`);
}
fs.writeFileSync(path.join(ROOT, "assets", "styles.css"), css);

// a review sheet: each piece as the narrowest card, the widest card and the share image
if (sheet) {
  const { chromium } = require("playwright");
  (async () => {
    const tiles = done.map((d) => {
      const og = KEEP_OG.has(d.slug) ? "og/" + d.slug + ".jpg" : "og/" + d.slug + ".jpg";
      const b64 = (f) => "data:image/" + (f.endsWith(".jpg") ? "jpeg" : f.endsWith(".webp") ? "webp" : "png") + ";base64," + fs.readFileSync(f).toString("base64");
      const card = b64(path.join(ROOT, "assets", "cards", d.slug + ".webp"));
      return `<div class="row"><b>${d.slug} ${d.P}%</b>
        <div class="c" style="width:269px;background-image:url(${card});background-position:center ${d.P}%"></div>
        <div class="c" style="width:308px;background-image:url(${card});background-position:center ${d.P}%"></div>
        <img src="${b64(path.join(ROOT, "assets", og))}"></div>`;
    }).join("");
    const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1180, height: 800 } });
    await p.setContent(`<style>body{margin:0;background:#111;color:#ddd;font:12px monospace;display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:8px}
      .row{display:grid;grid-template-columns:auto auto auto;gap:6px;align-items:start}.row b{grid-column:1/-1}
      .c{height:118px;background-size:cover;border-radius:6px}img{width:225px;border-radius:4px}</style>${tiles}`);
    await p.waitForTimeout(400);
    await p.screenshot({ path: sheet, fullPage: true });
    await b.close();
    console.log("sheet:", sheet);
  })();
}
