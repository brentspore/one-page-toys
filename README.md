## One Page Toys — consistency-first UI framework

This repo is a small “one page per tool” site, but the real goal is larger:
**a reusable architecture you can start from for any future app**.

The framework is **consistency-first** (structure + behavior + tokens), not
style-policing. You can do a complete UI redesign by swapping the theme layer
without rewriting tools.

### The 3 layers

- **Invariants (non-negotiables UX)**
  - Semantic structure: predictable tool pages and layout hierarchy.
  - Interaction contracts: visible keyboard focus, reasonable hit targets, reduced motion support.
  - State language: pressed/selected/disabled/error/success mean the same thing everywhere.
  - Scoping: tool code doesn’t leak into global assets.

- **Shared primitives + patterns (reusable contracts)**
  - Primitives: `.panel`, `.btn`, tool shell layout, focus ring, etc.
  - Patterns: chips/segmented controls, “choice” grids, tool cross-links, common empty/error blocks.
  - These should depend on tokens (CSS variables), not hardcoded one-off values.

- **Theme (swappable look & feel)**
  - A theme is primarily **CSS variables** that define the look.
  - Tools remain stable because they consume semantic tokens.

### Where things live

- **Global base (gallery + shared tokens)**
  - `assets/styles.css`: base site styling and global tokens (no tool-specific selectors).
  - `assets/main.js`: gallery behavior (home grid, all-tools search/filters).

- **Tool shell (toy/tool pages only)**
  - `assets/tool-shell.css`: shared page layout, `.panel`, `.tool-directions`, shared components.
  - `assets/tool-cross.js`: injects “Related tools” from `tools-registry.json`.

- **Content pages (scoped)**
  - `toys/<slug>/index.html`: toys, games, and experiments.
  - `tools/<slug>/index.html`: utilitarian tools (kept clean on purpose).
  - Each page owns its own `styles.css` for local visuals only; scripts are typically inline in `index.html` unless they grow large.

- **Tool registry**
  - `tools-registry.json`: the catalog the gallery uses (cards, categories, tags, related).
  - `sitemap.xml`: public URLs for SEO.

### Tool page contract (copy/paste standard)

Every toy/tool page should:
- Include styles in this order:
  - `../../assets/styles.css`
  - `../../assets/tool-shell.css`
  - `styles.css` (tool-local)
- Set `body data-tool-slug="<slug>"`
- Include `<div id="toolCrossRoot" class="tool-cross-mount"></div>` before `</main>`
- Load `../../assets/tool-cross.js` (defer)
- Put the primary interactive surface in a `.panel`
- Put `.tool-directions` after the primary controls (help is secondary to doing)

### Global vs tool-unique rule of thumb

Before adding CSS to global files, scan across toys/tools:
- **Global** (`assets/styles.css` / `assets/tool-shell.css`) if it’s an app-wide invariant
  or a reusable pattern that appears in multiple toys/tools (rule of thumb: ~3+ pages).
- **Tool-local** (`toys/<slug>/styles.css` or `tools/<slug>/styles.css`) if it’s part of the page’s identity or interaction.
- Prefer adding/using **tokens** over duplicating big CSS blocks.
- Never put tool-specific selectors (like `.mm-*`, `.mgs-*`) in global assets.

### Governance (Cursor rules)

The repo uses Cursor rules to keep the framework consistent:
- `.cursor/rules/intentional-design-principles.mdc`

These rules are intentionally about **consistency**, not forcing a single aesthetic.

### Updating this README

This file should evolve as the framework evolves:
- If a new shared component is added, document it here (what it is, when to use it).
- If the tool contract changes, update the checklist above.
- If a new theme mechanism is introduced, document how to swap themes.

