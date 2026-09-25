---
name: Project reference
description: Commands, repo pointers, external systems, and operational notes
type: reference
---

- **Local repo:** /Users/bspore/Personal Projects/one-page-toys
- **Remote repo:** https://github.com/brentspore/one-page-toys
- **Commands:**
  - Dev server: say **`start`** (runs the global `~/.ai/bin/dev-start`). This repo has no `dev` script on purpose: dev-start serves any project with a root `index.html` via `python3 -m http.server` on **http://127.0.0.1:8000** (or the next free port), detached; saying it again restarts it. No build pipeline.
  - Docker (added 2026-09-24): `docker compose up -d` serves the LIVE working tree through nginx at http://localhost:8080 (edits show on reload, no rebuild; `docker compose down` to stop). `docker build -t one-page-toys . && docker run --rm -p 8080:8080 one-page-toys` bakes a standalone copy. nginx config in `docker/nginx.conf` mirrors Vercel (directory index, no clean URLs); `.dockerignore` mirrors `.vercelignore` plus dev tooling/memory. ⚠ Port 3000 is held by another app on this machine — that is why it is 8080.
  - ⚠ DO NOT RUN `node scripts/sync-registry-paths.cjs` — it is a **one-off migration**, not a routine command: it alphabetically SORTS the registry (breaks newest-first), rewrites every `path` to `/index.html` form (convention is dir-form `tools/<slug>/`), and injects stale hardcoded entries. It corrupted the registry once (2026-07-14); to add a toy just prepend the entry by hand. Only `build-sitemap.cjs` is safe/routine.
  - Rebuild sitemap: `node scripts/build-sitemap.cjs` (regenerates sitemap.xml from registry)
  - Scaffold new tool: `node scripts/implement-new-25.js` (references new25-impls-{a,b}.cjs templates)
  - Verify changes: Playwright is a devDependency — drive headless Chromium with `NODE_PATH="$(pwd)/node_modules" node <script>` to screenshot pages
- **External systems:**
  - Hosting: **Vercel** (migrated off GitHub Pages ~2026-07-14; the leftover GitHub `pages-build-deployment` action still runs but does NOT serve the live site — ignore it). Push to `main` → Vercel auto-deploys (~1-2 min, no build step for this static site). ⚠ **Redirect direction (observed 2026-07-15, the REVERSE of the earlier note):** **`www.onepagetoys.com` 307-redirects to the apex `onepagetoys.com`** — the apex is the canonical serving host now. So **live-verify against `https://onepagetoys.com/…`** (or always use `curl -L`); grepping bare **www** returns only the redirect stub ("Redirecting…"), which reads as "stale"/empty. Whichever host you hit, `curl -L` follows to the 200 and is the safe default.
  - Analytics: Google Analytics GA-4 (G-VBVJ93GL8L) on every page
  - Fonts: Google Fonts (Outfit, Plus Jakarta Sans)
  - No database, no backend, no auth, no email, no API keys in codebase
- **Secrets/env:** None. No .env file, no server-side secrets.
- **Deployment notes:** Push to `main` → **Vercel** auto-deploys (~1-2 min). No build step (static site). Verify live at **onepagetoys.com** (apex is canonical; **www 307-redirects to apex** as of 2026-07-15 — use `curl -L` to be safe). The GitHub Pages action is a legacy leftover; don't rely on its "success" to mean the live site updated.
- **Builder/sync notes:** Hand-coded HTML/CSS/JS. Not Lovable-generated. Built with Gemini AI assistance. No builder sync.
