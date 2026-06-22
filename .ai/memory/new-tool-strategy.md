---
name: New tool strategy
description: SEO-first strategy and implementation checklist for adding new tools/toys
type: project
---

## Bias toward traffic and search intent

When adding a toy, tool, or page, prioritize ideas that earn organic visits — not only "fun" or technical novelty.

**Prefer tools that:**
- Match real queries: "how to…", calculators, converters, checkers, validators, generators, timers, comparisons (things people type into Google)
- Support long-tail copy: specific `<title>`, `<meta name="description">`, H1, and body text that naturally include target phrases (no stuffing)
- Are cite- and link-worthy: useful enough that blogs, docs, or social posts might link (utilities > pure toys unless the toy is highly shareable)
- Differentiate: avoid clones of ten identical free tools unless we add a clearer angle (speed, privacy, UX, niche audience)
- Stay indexable: real HTML pages with the same SEO stack as existing tools (`canonical`, Open Graph, Twitter, JSON-LD `WebApplication`)

**Deprioritize for pure SEO goals:**
- Ultra-niche experiments with no search volume and no share hook
- Duplicate functionality of an existing on-site tool without a new keyword angle

## Before building: offer candidates

Offer 2–3 candidate ideas in short form, each with one line on **who searches for it** and **what phrase cluster** it could capture. Let the user pick — unless they already named the tool.

## Implementation checklist (do not skip)

- **Folder from category:** `utility` → `tools/<slug>/`; `game | visual | audio | wellness` → `toys/<slug>/`
- Create `index.html` + `styles.css` (and a local `.js` only if the script is large — otherwise inline is fine)
- CSS import order in `<head>`: `../../assets/styles.css` → `../../assets/tool-shell.css` → `styles.css`
- On `<body>`: `data-tool-slug="<slug>"`
- Before `</main>`: `<div id="toolCrossRoot" class="tool-cross-mount"></div>`
- Before `</body>`: `<script src="../../assets/site-chrome.js" defer></script>` + `<script src="../../assets/tool-cross.js" defer></script>`
- Canonical URL pattern: `https://onepagetoys.com/tools/<slug>/` or `.../toys/<slug>/`
- Register in `tools-registry.json` with: `category`, specific `shortDescription`, `tags` (1–2 hyphenated role nouns), `related` (2–4 existing slugs)
- If adding a new tag, also add entries to `TYPE_NL_PHRASES` in `assets/main.js`
- Run `node scripts/sync-registry-paths.cjs` then `node scripts/build-sitemap.cjs`
