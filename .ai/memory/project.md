---
name: Project overview
description: Durable project-specific context for One Page Toys
type: project
---

> **Read `HANDOFF.md` first** for current state (latest pushed commit, what's in flight, how to
> resume) and `DECISIONS.md` for the standing quality bars + engineering defaults. This file is the
> slow-moving overview; where it disagrees with HANDOFF, trust HANDOFF. (Refreshed 2026-07-01 —
> the earlier version described a pre-2026-06 "tool-shell / tool-cross / .panel" architecture that
> no longer exists; that has been removed.)

**What it is:** One Page Toys (onepagetoys.com) — a branded **launcher hub** plus a growing set of
**standalone, full-bleed browser toys** (50 as of 2026-07-01), each in its own `toys/<slug>/` (or
`tools/<slug>/` for the small utility family). Every toy opens in a NEW TAB and is a completely
self-contained static page. Direction is **FUN / playful / experiential — NOT dev tools** (dev
tools live on the separate BuildUtilities site). Nothing is monetized directly; no sales CTAs, no
affiliate links (there is a low-key "tip jar" → PayPal, and a "Friends of the gallery" aside).

**Purpose:** delight first; **secondary** = top-of-funnel search traffic for the wider Synergy
portfolio (toys are search-rich; a visitor who lands on one is passively discoverable). It is NOT
an affiliate feeder — keep it that way; don't add sales surfaces.

**Audience:** general public who land on a specific toy from search or word-of-mouth. The owner is
a **designer** and holds a high visual bar — see the "Design quality bar" + "Audio quality bar"
sections in `HANDOFF.md` / `DECISIONS.md`. A toy isn't done when it "works"; it must look and sound
intentional, and **every toy must be interactive**.

**Tech stack:** hand-written static **HTML + CSS + vanilla JS**. **No build, no framework, no deps**
to run (`python3 -m http.server` and open it). Toys are typically vanilla **Canvas 2D** (some raw
WebGL as an escape hatch; avoid Three.js) + **Web Audio** (fully synthesized, no sample files).
Playwright is a dev-only dependency for headless verification / screenshots / OG rendering
(`node_modules` is gitignored — reinstall with `npm install && npx playwright install chromium`).
Geist design system (Geist Sans/Mono, neutral grays, restrained red `#941e1e`, 3-way
System/Light/Dark theme). Deployed via **GitHub Pages from `main`** → onepagetoys.com (CNAME);
GA4 + JSON-LD structured data in place.

**Two page shapes:**
- **Toys** (`toys/<slug>/`) — full-bleed dark experiences: `index.html` + `styles.css` + `script.js`,
  frame corners (`No. NNN` / name / back-link), a hint line, full SEO meta + JSON-LD + GA + no-flash
  theme init + `assets/tip-jar.js` + `assets/fullscreen.js`. Copy any recent toy as a template.
- **Tools** (`tools/<slug>/`) — the small utility family (Meeting Cost Meter, Time Is Money, Life in
  Numbers, The Latte Factor): a shared light/dark Geist "tool" chrome (topbar + brand + theme toggle
  + odometer hero + glassy console). Copy `tools/meeting-cost-meter/` and recolor.

**Key shared files:**
- `tools-registry.json` — drives the gallery; prepend new toys newest-first (slug/name/
  shortDescription/category/tags/status/path).
- `assets/main.js` — gallery render + search (home shows a random 9; all-toys paginates 12/page
  alphabetically w/ infinite scroll); `TYPE_NL_PHRASES` natural-language search map (keyed by tag);
  GA4 events. Cache-bust `?v=N`.
- `assets/styles.css` — hub styles + per-slug `.card__preview[data-slug]` CSS-motif thumbnails (+ a
  `:not()` default-exclusion chain). Cache-bust `?v=N`.
- `assets/theme.js` (3-way theme), `assets/tip-jar.js`, `assets/fullscreen.js`.
- `sitemap.xml`; `assets/og/<slug>.png` (per-toy share image, every toy has one);
  `assets/cards/<slug>.png` (rendered card thumbnails — many toys; the tool family uses CSS-motif
  cards instead).
- `scripts/og-gen.html` — parameterized 1200×630 OG template (`#<slug>`, screenshot at 1200×630).

**How to add a toy (the manual pipeline — there is no codegen step):**
1. Create `toys/<slug>/` (or `tools/<slug>/`) = self-contained `index.html` + `styles.css` +
   `script.js`, following a recent toy as the template.
2. Register everywhere: prepend to `tools-registry.json`; add to `sitemap.xml`; add a
   `TYPE_NL_PHRASES` entry in `assets/main.js` (keyed by the toy's tag); add a
   `.card__preview[data-slug]` rule in `assets/styles.css` **and** add the slug to the `:not()`
   default-exclusion chain; add an og-gen entry + render `assets/og/<slug>.png` (and a real card
   `assets/cards/<slug>.png` where it beats a CSS motif).
3. Cache-bust: bump `?v=N` on any shared asset changed (`assets/styles.css`, `assets/main.js`, …)
   across `index.html` + `all-toys.html`, and on the toy's own `script.js`/`styles.css`.
4. Verify headless (Playwright): no console errors, no horizontal overflow at 375px, interactions
   work; screenshot to eyeball visuals; audio can only be truly judged by the owner's ears.

**Workflow constraints (see DECISIONS.md for the full list):** only commit/push when the owner says
`push`; **exclude both `.claude/settings.json` and `.claude/settings.local.json` from every commit**;
after a push, bump the HANDOFF pointer + add a "Handoff: commit pointer XXX" follow-up commit + mark
PULSE PUSHED. The old ~57 pre-pivot toys were archived to `/archive/`.
