---
name: Project reference
description: Commands, repo pointers, external systems, and operational notes
type: reference
---

- **Local repo:** /Users/bspore/Personal Projects/one-page-toys
- **Remote repo:** https://github.com/brentspore/one-page-toys
- **Commands:**
  - Dev server: `python3 -m http.server 3000` (no build pipeline; serve static files)
  - ⚠ DO NOT RUN `node scripts/sync-registry-paths.cjs` — it is a **one-off migration**, not a routine command: it alphabetically SORTS the registry (breaks newest-first), rewrites every `path` to `/index.html` form (convention is dir-form `tools/<slug>/`), and injects stale hardcoded entries. It corrupted the registry once (2026-07-14); to add a toy just prepend the entry by hand. Only `build-sitemap.cjs` is safe/routine.
  - Rebuild sitemap: `node scripts/build-sitemap.cjs` (regenerates sitemap.xml from registry)
  - Scaffold new tool: `node scripts/implement-new-25.js` (references new25-impls-{a,b}.cjs templates)
  - Verify changes: Playwright is a devDependency — drive headless Chromium with `NODE_PATH="$(pwd)/node_modules" node <script>` to screenshot pages
- **External systems:**
  - Hosting: GitHub Pages (CNAME → onepagetoys.com); no CI — push to main deploys automatically
  - Analytics: Google Analytics GA-4 (G-VBVJ93GL8L) on every page
  - Fonts: Google Fonts (Outfit, Plus Jakarta Sans)
  - No database, no backend, no auth, no email, no API keys in codebase
- **Secrets/env:** None. No .env file, no server-side secrets.
- **Deployment notes:** Push to main branch → GitHub Pages deploys automatically. No build step required.
- **Builder/sync notes:** Hand-coded HTML/CSS/JS. Not Lovable-generated. Built with Gemini AI assistance. No builder sync.
