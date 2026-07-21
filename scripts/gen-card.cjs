#!/usr/bin/env node
/**
 * gen-card.cjs — render a real card thumbnail straight out of a live toy.
 *
 * The house rule is that a card must be a genuine still of the toy (see the
 * "Design quality bar" in .ai/memory/HANDOFF.md), not an abstract gradient. So
 * this drives the actual page, hides every piece of chrome, waits for a good
 * moment, and captures a square crop.
 *
 * Usage (dev server must be running: python3 -m http.server 3000):
 *   node scripts/gen-card.cjs <slug> [--at 6000] [--size 1080] [--start "Begin the night"]
 *                                    [--out assets/cards/<slug>.png] [--probe]
 *
 *   --probe   capture a strip of candidate frames instead of one image, so you
 *             can eyeball which moment to freeze, then re-run with --at
 *
 * NOTE: capture at deviceScaleFactor 1. Playwright tears canvas screenshots at
 * higher scale factors — it produces torn/half-painted frames that look like a
 * rendering bug and are not one.
 */
const { chromium } = require("playwright");
const path = require("path");

const args = process.argv.slice(2);
const slug = args[0];
if (!slug) {
  console.error("usage: node scripts/gen-card.cjs <slug> [--at ms] [--size px] [--start label] [--probe]");
  process.exit(1);
}
const flag = (name, dflt) => {
  const i = args.indexOf("--" + name);
  return i === -1 ? dflt : args[i + 1];
};
const has = (name) => args.indexOf("--" + name) !== -1;

const SIZE = parseInt(flag("size", "1080"), 10);
// Viewport may be TALLER than the square we keep. Shuriken Night keys its world
// scale to the long edge, so a taller viewport gives a tighter lens (bigger
// screens and ninjas); we then crop the action band out of the middle.
const VW = parseInt(flag("vw", String(SIZE)), 10);
const VH = parseInt(flag("vh", String(SIZE)), 10);
const CROP_Y = flag("cropy", null);
const AT = parseInt(flag("at", "6000"), 10);
const START = flag("start", "");
const BASE = flag("base", "http://localhost:3000");
const OUT = flag("out", path.join("assets", "cards", slug + ".png"));

// Everything that must not appear in a thumbnail: the toy's own HUD/frame, plus
// every shared badge injected by tip-jar.js / fullscreen.js / tickets.js /
// more-games.js / share.js.
const HIDE = `
  .hud, .frame, .abilities, .hint, .sound-btn, .overlay,
  .opt-tipjar, .opt-fs, .opt-tickets, .opt-share, .mg-root,
  [class*="tipjar"], [class*="fullscreen"], [id*="Overlay"] { display: none !important; opacity: 0 !important; }
  html, body { cursor: none !important; }
`;

// Square crop out of the viewport; centred unless --cropy overrides it.
function clipRect() {
  const y = CROP_Y === null ? Math.round((VH - SIZE) / 2) : parseInt(CROP_Y, 10);
  return { x: Math.round((VW - SIZE) / 2), y: Math.max(0, y), width: SIZE, height: SIZE };
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: VW, height: VH },
    deviceScaleFactor: 1,
  });
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));

  await page.goto(`${BASE}/toys/${slug}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(700);

  if (START) {
    try {
      await page.getByText(START).first().click();
    } catch (e) {
      console.warn("start control not found:", START);
    }
  }

  if (has("probe")) {
    // Candidate frames, so the right moment can be chosen by eye.
    for (const t of [2500, 4000, 5500, 7000, 8500, 10000]) {
      await page.waitForTimeout(t - (page.__last || 0));
      page.__last = t;
      await page.addStyleTag({ content: HIDE });
      await page.screenshot({ path: `scratch-card-${t}.png`, clip: clipRect() });
      console.log("probe frame at", t + "ms");
    }
  } else {
    await page.waitForTimeout(AT);
    await page.addStyleTag({ content: HIDE });
    await page.waitForTimeout(120);
    await page.screenshot({ path: OUT, clip: clipRect() });
    console.log("wrote", OUT, `(${SIZE}x${SIZE} from ${VW}x${VH}, frozen at ${AT}ms)`);
  }

  if (errs.length) console.warn("page errors:", errs);
  await browser.close();
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
