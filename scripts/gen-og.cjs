#!/usr/bin/env node
/**
 * gen-og.cjs — render a per-toy Open Graph share image from scripts/og-gen.html.
 *
 * og-gen.html is the parameterised 1200x630 template; each toy has an entry in
 * its TOYS map keyed by slug. Most entries use img("<slug>"), which pulls in
 * assets/cards/<slug>.png as the motif — so REGENERATE THE CARD FIRST
 * (scripts/gen-card.cjs) and the OG will pick the new art up automatically.
 *
 * Output is 2400x1260 (2x) to match the rest of assets/og/.
 *
 * Usage (dev server must be running: python3 -m http.server 3000):
 *   node scripts/gen-og.cjs <slug> [--out assets/og/<slug>.png] [--base http://localhost:3000]
 *
 * Served over http rather than file:// so the motif <img> actually loads.
 */
const { chromium } = require("playwright");
const path = require("path");

const args = process.argv.slice(2);
const slug = args[0];
if (!slug) {
  console.error("usage: node scripts/gen-og.cjs <slug> [--out path]");
  process.exit(1);
}
const flag = (name, dflt) => {
  const i = args.indexOf("--" + name);
  return i === -1 ? dflt : args[i + 1];
};
const BASE = flag("base", "http://localhost:3000");
const OUT = flag("out", path.join("assets", "og", slug + ".png"));

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 2,
  });
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));

  await page.goto(`${BASE}/scripts/og-gen.html#${slug}`, { waitUntil: "networkidle" });
  // the template renders off the hash; give the motif image time to decode
  await page.waitForTimeout(900);

  const ok = await page.evaluate(() => {
    const im = document.querySelector("img");
    return { hasCard: !!im, complete: im ? im.complete && im.naturalWidth > 0 : null,
             title: (document.querySelector("h1") || {}).textContent || null };
  });
  if (ok.hasCard && !ok.complete) {
    console.error("motif image failed to load — is the dev server running?");
    process.exit(1);
  }

  await page.screenshot({ path: OUT, clip: { x: 0, y: 0, width: 1200, height: 630 } });
  console.log("wrote", OUT, "(2400x1260)", ok.title ? "— " + ok.title : "");
  if (errs.length) console.warn("page errors:", errs);
  await browser.close();
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
