---
name: Design principles
description: Intentional design consistency rules for gallery and tool pages
type: project
---

## Architecture vs. style

- **Architecture** = invariants: information hierarchy, semantics, accessibility, interaction contracts, scoping boundaries, component API (classes + states like `[aria-pressed]`). Non-negotiable.
- **Style** = aesthetics: token values (color, type, radii, shadows), motion curves, optional component variants. Swappable.
- Modern UX/UI trends go in as swappable themes/variants — not ad-hoc one-offs baked into individual pages. When proposing a trend-driven change, identify which layer it belongs to and why.

## CSS scoping rules

- Use existing tokens from `assets/styles.css` / `assets/tool-shell.css` (`--accent`, `--shadow-md`, `--radius`, focus rings, etc.). No one-off colors/shadows unless they map to a token.
- **Never** add tool-specific selectors into global assets (no `.mm-*`, `.mgs-*`, etc. in `assets/styles.css` or `assets/main.js`).
- Tool visuals go in `toys/<slug>/styles.css` or `tools/<slug>/styles.css`, scoped to that page. Avoid redefining shared primitives (`.btn`, `.tool`, `.panel`) from inside tool CSS.
- Promote a pattern to global only if it appears in ~3+ tools or is clearly "core" — audit reuse first, then promote.

## Tool page structure

- CSS import order: `../../assets/styles.css` → `../../assets/tool-shell.css` → `styles.css` (tool-local).
- Interactive primary UI before secondary details.
- `.tool-directions` sits *after* the main panel/controls — interaction surface reads first.
- Related/external links use `.tool-ext-link` patterns, appear after the main panel.

## Interaction safety

- For clickable canvas/grid/button surfaces inside a panel, verify `pointer-events` and stacking context (`z-index`) so overlays don't swallow clicks.
- Always preserve a visible `:focus-visible` state for keyboard users.

## Gallery visual rhythm

- Keep category chip ordering stable (defined in `assets/main.js`).
- Warm palette + chunky shadows consistently — don't make one tool feel visually different via ad-hoc styling.

## Collaborative reasoning rule

- When a decision impacts global architecture, shared shells, tokens, reusable components, IA/naming, or future theming flexibility — surface tradeoffs and ask before acting.
- Default to tool-local implementation first; promote globally only after auditing reuse.

## Natural-language coherence

- When updating tool filters/search terms, adjust synonyms in `assets/main.js` (`TYPE_NL_PHRASES`) to match new `tools-registry.json` tags.
