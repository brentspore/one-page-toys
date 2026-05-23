---
name: Project overview
description: Durable project-specific context for AI tools
type: project
---

**What it is:** One Page Toys (OnePageToys.com) — a small "one page per tool" site, but more importantly a **consistency-first UI framework** intended as a reusable architecture starting point for future apps.

**Audience/user:** General public for the toys/tools. For the framework consumer: future-Brent and anyone using this as a base for a new app.

**Core product direction:** Consistency-first, not style-policing. Three-layer architecture:
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

**Builder/import notes:** Hand-coded HTML/CSS/JS. PUBLIC repo, not Lovable-generated.

**Current-state checkpoint:** TODO: Fill on next session.
