---
name: Project overview
description: Durable project-specific context for AI tools
type: project
---

**What it is:** One Page Toys (onepagetoys.com) — a growing collection of small browser-based toys, generators, and utilities Synergy ships for fun. Each one is a self-contained static page (currently ~60+ across `/toys/` and `/tools/`). Nothing is monetized directly; no sales CTAs; no affiliate links. **Secondary purpose: top-of-funnel traffic for the rest of the Synergy portfolio** — utility tools and small toys are search-rich, and any visitor who lands on a toy is gently discoverable to the affiliate-feeder family (SE / BI / BOK) once cross-linking is added. **It is NOT an affiliate feeder** — the "feeding" is passive: spread the net wider, some traffic finds the other sites. Don't add affiliate CTAs or sales surfaces; that would break what the site is for.

The codebase happens to embody a **consistency-first UI framework** (static HTML/CSS/JS, token-driven CSS, no SPA, no build pipeline beyond a few node scripts). That framework is a portable side-benefit — patterns may eventually get lifted into other Synergy projects — but the framework is a property of the code, not the purpose of the site.

**Audience/user:** General public; people who land on a specific toy from search or word-of-mouth. The "framework consumer" audience (future-Synergy, AI tools studying the patterns) is secondary.

**Core product direction:** Ship small things, keep them self-contained, don't overthink. The consistency framework is the discipline that keeps shipping painless. Three-layer architecture:
1. **Invariants** — semantics, accessibility, interaction contracts (focus visible, hit targets, reduced motion), scoping rules. Non-negotiable.
2. **Shared primitives + patterns** — `.panel`, `.btn`, tool shell layout, chips/segmented controls, "choice" grids, common empty/error blocks. Token-driven, not hardcoded.
3. **Theme** — swappable CSS variables. A full re-skin is a theme swap, not a rewrite.

Tools/toys must read semantic tokens (not hardcoded colors/radii/shadows) so re-skinning works automatically.

**Tech stack:** Static HTML/CSS/JS (no SPA framework). Token-driven CSS architecture.

**Important source areas:**
- `assets/styles.css` — base site styling + global tokens (no tool-specific selectors)
- `assets/main.js` — gallery behavior (home grid, all-tools search/filters)
- `assets/tool-shell.css` — shared page layout, `.panel`, `.tool-directions`, shared components
- `assets/tool-cross.js` — injects "Related tools" from `tools-registry.json`

**Working rules:**
- New "looks" should be added as themes/variants (CSS variables), not by editing page-local CSS.
- **Tool code must not leak into global assets** (scoping discipline).
- Shared components depend on tokens, not hardcoded one-off values.
- Predictable structure: tool pages follow the same layout hierarchy.

**Tool page contract (every page must follow):**
1. Three CSS imports in order: `../../assets/styles.css` → `../../assets/tool-shell.css` → `styles.css` (tool-local)
2. `data-tool-slug="my-slug"` on `<body>`
3. Semantic header / main / footer structure
4. `.panel` wrapping the primary interactive area
5. `.tool-directions` help text placed *after* controls, not before
6. `<div id="toolCrossRoot" class="tool-cross-mount"></div>` before `</main>` (related tools injection point)
7. Deferred `../../assets/site-chrome.js` and `../../assets/tool-cross.js` script imports at end of body
8. Tool-local CSS must use a slug-prefixed BEM namespace (e.g. `.qrg-`, `.sm-`) — never extend or duplicate global selectors (`.btn`, `.panel`) in tool-local files

**How to add a new tool/toy:**
1. Create `/tools/my-slug/` (utility) or `/toys/my-slug/` (game/visual/audio/wellness) with `index.html` + `styles.css`
2. Follow the tool page contract above
3. Add entry to `tools-registry.json`: slug, name, shortDescription, category, tags, status, related (path auto-filled by script)
4. Run `node scripts/sync-registry-paths.cjs` then `node scripts/build-sitemap.cjs`

**Builder/import notes:** Hand-coded HTML/CSS/JS. PUBLIC repo, not Lovable-generated. Built with Gemini AI assistance.

**Current-state checkpoint (2026-05-25):** Live at https://onepagetoys.com (GitHub Pages via CNAME). ~60+ toys + tools shipped. Google Analytics + structured data (JSON-LD WebSite) in place. No cross-links to the affiliate-feeder family yet — adding a sister-sites footer linking SE / BI / BOK is in BACKLOG to realize the latent traffic-feeding potential.
