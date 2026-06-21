---
name: Project reference
description: Commands, repo pointers, external systems, and operational notes
type: reference
---

- **Local repo:** `~/Personal Projects/one-page-toys`
- **Remote repo:** https://github.com/brentspore/one-page-toys
- **Commands:** Static site, no build step. **Dev:** `python3 -m http.server 8000` (serve from repo root → http://localhost:8000/). **Verify changes:** Playwright is a devDependency — drive headless Chromium with `NODE_PATH="$(pwd)/node_modules" node <script>` to screenshot pages (the goo-cursor toy and the gallery render correctly this way). No test/lint/build.
- **External systems:** TODO: hosting, database, analytics, email, APIs.
- **Secrets/env:** TODO: Where secrets live. Do not paste secret values here.
- **Deployment notes:** TODO: What deploys automatically and what needs manual action.
- **Builder/sync notes:** TODO: If applicable, note how Lovable or another builder syncs with GitHub, what it may regenerate, and what requires manual redeploy or review.
