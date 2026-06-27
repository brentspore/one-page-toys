# Project Decisions

Durable decisions specific to this project that should not be relitigated every time they come up.

Use this for product direction, architecture choices, deployment constraints, naming decisions, scope boundaries, and tradeoffs that apply to this repo only.

If a decision should apply across multiple projects, record it in `~/.ai/memory/DECISIONS.md` instead. If this project intentionally differs from a global decision, record the exception here and reference the global default.

## Entry format

### YYYY-MM-DD — Decision title

**Context:** What kept coming up or forced the choice.

**Decision:** What was decided for this project.

**Rationale:** Why this is the right default here.

**Revisit if:** What would make this worth reconsidering.

### 2026-06-11 — AI-tool agnostic repo (no tool-specific config files)

**Context:** Claude Code suggested adding a `CLAUDE.md` to persist project context across environments.

**Decision:** No tool-specific config files (no `.claude/`, no `CLAUDE.md`, no `.cursor/`, etc.) committed to the repo. Use `.ai/memory/` as the canonical portable memory layer instead.

**Rationale:** Keeps the repo agnostic to whichever AI assistant is in use. `.ai/memory/` travels with the code and works with any tool that follows the AI.md convention.

**Revisit if:** A specific tool offers capabilities that genuinely require its own config and there's no agnostic equivalent.

---

### 2026-06-11 — No affiliate CTAs or sales surfaces on the site

**Context:** The site's secondary purpose is top-of-funnel traffic for the Synergy portfolio, which could be misread as "add CTAs."

**Decision:** No affiliate links, no sales CTAs, no promoted content on any page. Cross-linking to sister sites is passive (footer only, text links, no tracking params).

**Rationale:** Adding sales surfaces would break the site's character and trust with users who found a toy via search. Passive discovery is the intent.

**Revisit if:** Synergy explicitly decides to change the monetization model for this property.

---

### 2026-06-21 — New-toy conventions (carried over from removed `.cursor/` rules)

**Context:** Two Cursor `alwaysApply` rules (`new-tools-seo-traffic`, `intentional-design-principles`) governed how toys were added. The `.cursor/` dir was removed; the durable, still-valid parts are captured here. Parts that conflict with the 2026-06-21 monochrome redesign + standalone-toy model are intentionally dropped.

**Decision — kept (still apply to every new toy):**
- **Indexable + share-worthy:** each toy is a real HTML page shipping the full SEO stack (specific `<title>`, `meta description`, `canonical`, Open Graph, Twitter, JSON-LD). The site is a passive traffic feeder, so toys must be findable/linkable. Goo Cursor follows this.
- **Registry-driven:** register in `tools-registry.json` (category, specific `shortDescription`, `tags`, `related`) and update the sitemap. Folder by `category`: `utility` → `tools/<slug>/`; `game|visual|audio|wellness` → `toys/<slug>/`. Add `TYPE_NL_PHRASES` in `assets/main.js` for any new tag so search matches.
- **Token + scoping discipline:** read shared tokens (`--accent`, `--shadow-md`, `--radius`, focus rings); never put toy-specific selectors/JS in `assets/styles.css` or `assets/main.js`; scope page visuals to `toys/<slug>/styles.css` (mirrors project.md three-layer architecture).
- **UX invariants:** visible `:focus-visible`, readable contrast, correct `pointer-events`/`z-index` on interactive surfaces, honor `prefers-reduced-motion`.

**Decision — dropped (conflict with new focus):**
- **Gallery/hub design = Geist-inspired** (`assets/styles.css`, current). Geist Sans + Geist Mono (Google Fonts), neutral gray scale, white `#fff` / near-black, **pure-black `#000` Geist dark**, hairline 1px borders (`#eaeaea` light / `#2a2a2a` dark), small radii (`--radius:10px`, `--radius-sm:6px` — NOT pills), minimal shadows (borders define structure), generous whitespace, mono uppercase micro-labels. **Primary buttons are black→white-inverting (Geist), red is a restrained accent only** (LIVE badge, links, active states). Brand red `#941e1e` (light) / `#e5484d` (dark) — chosen to complement the Synergy footer logo red `#a51c1c`. **Card previews are STATIC thumbnails** — a calm, real still of each toy in a 130px header band (`.card__preview[data-slug=...]` in `assets/styles.css`, injected in `main.js`): the `$342.45` red→white-hot odometer on the dark burn field for Meeting Cost Meter, a still iridescent liquid-metal bead for Goo Cursor, a neutral accent-tint default for future toys. NO animation (owner: previews are good but "don't want it busy or ugly" → static, like Vercel template thumbnails; an earlier spinning/animated version + `body::before` backdrop were cut).
  - History (superseded for the hub): 2026-06-21 went coral brutalist → "too blocky/bright, don't like orange" → warm friendly (off-white, rounded pills, soft shadows, red) → animated card previews → finally **Geist clean** at owner's request ("I like the simple, clean feel of the Geist Design System").
  - Toys are exempt: each keeps its own self-contained ambitious visual (Goo Cursor iridescent; Meeting Cost Meter "The Burn" still uses warm-light / cool-synergy-dark tokens). Geist applies to the hub chrome, not toy interiors.
- **Dark mode** exists: `assets/theme.js` + a tiny inline no-flash init in each page's `<head>` set `<html data-theme="light|dark">` from `localStorage['opt-theme']` (falling back to `prefers-color-scheme`). Dark token overrides live under `:root[data-theme="dark"]` in `assets/styles.css` (and in each self-contained toy's own CSS). A `.iconbtn.theme-toggle` (sun/moon) in the topbar flips it. Goo Cursor is exempt (already a dark immersive piece). Dark palettes by surface: the **hub** now uses **Geist neutral pure-black** (`--bg:#000`, borders `#2a2a2a`). The **cool blue-charcoal** synergyprod-style dark (`--bg:#14171f`, cream text `#e8e2d9`) now lives only in the **Meeting Cost Meter** toy. (History: an earlier warm/brown dark was rejected "ew, brown".)
- Mandatory tool-shell chrome (`tool-shell.css`, `site-chrome.js`, `tool-cross.js`, `#toolCrossRoot`, `data-tool-slug`) → new toys are **standalone full-bleed experiences opening in a new tab** (Goo Cursor model), not wrapped in the gallery/tool shell. Use the shell only if a toy genuinely wants gallery chrome.
- SEO-utility bias over "pure toys" → softened: focus is fun, shareable creative toys; keep them indexable but don't gate ideas on search volume.

**Revisit if:** the site returns to a utilities-heavy, shell-wrapped model, or adopts a non-monochrome theme.

---

### 2026-06-21 — Toys must be visually ambitious (owner is a designer)

**Context:** Owner is a designer and "responds well to visually stimulating things." First-pass toys were judged too plain.

**Decision:** Build toys to be **visually impressive and fairly unique — don't keep them simple if they don't need to be.** Lean into custom motion/visuals: canvas/SVG/WebGL particle systems, reactive backgrounds, bespoke filters, animated typography (e.g. odometer reels), aurora/gradient fields. The gallery hub itself is also held to this bar — each toy card carries a **live animated preview band** (motif per slug, in `assets/styles.css` `.card__preview[data-slug=...]`, wired in `assets/main.js`), and the page has a subtle animated backdrop (`body::before`).
- Reference builds: **Goo Cursor** = iridescent hue-shifting ferrofluid (SVG goo + turbulence displacement) over a living aurora, ripples on tap. **Meeting Cost Meter** = "The Burn": odometer rolling digits with a red→white-hot gradient, heat-reactive bg (`--heat`), canvas ember field scaling with burn rate. **Breathing Pacer** = serene immersive orb that expands/holds/contracts through selectable patterns (Calm 4-6 / Box 4-4-4-4 / 4·7·8), SVG phase ring, scene brightens with the breath, drifting canvas motes, optional Web Audio tones. **Coin Flip** = tactile 3D gold coin (14 stacked translateZ discs + 2 faces for real thickness) that tosses with rAF arc/tumble physics, fair crypto bit, stats + ratio + history, metallic ting on land. Each toy is its own curated palette (no shared theme) — goo iridescent, meter red-burn, breathing calm aqua/indigo, coin gold-on-dark.
- Always keep `prefers-reduced-motion` fallbacks and verify in headless Chromium (light + dark).

**Revisit if:** owner asks for restraint/minimalism on a given toy, or perf becomes a problem on low-end devices.

---

## 2026-06-26 — Realistic sounds across every toy that uses audio (owner pref)

**Decision:** Any toy with sound should use **realistic, physically-grounded synthesis**, not simple beeps/blips. Model the actual sound source and layer transient + body + tail, velocity-scale the volume, and keep tones consonant/calm. Applies retroactively — when touching a toy with sound, upgrade it toward realism.

Reference recipes already shipped:
- **Water drop / rock-in-pond** (Zen Ripple Pond): deep impact thud (sine 150→58Hz) + rising cavity "bloop" (sine f0→2.4·f0) + bandpassed splash-noise burst. Ambient = layered brown-noise river bed (moving lowpass + sweeping bandpass "burble") + occasional panned trickle runs of soft drips. No pure drone tones.
- **Metal wind chime** (Wind Chimes): inharmonic tubular-bell partials at ratios ~1, 2.76, 5.40, 8.93 (higher partials louder-attack but faster decay), bright lowpass (~8.5k), plus a short bandpassed mallet "tink" transient. Bright upper-octave pentatonic.
- **Glass marble clack** (Marble Drop): short triangle + bandpass click, fast decay, throttled, volume scaled by impact speed.

Pattern: `transient (noise/click) + harmonic/inharmonic body + decaying tail`, all through a filter, gain velocity-scaled. iOS: always unlock with a 1-sample silent buffer on first gesture. (Global twin: see `~/.ai/memory/DECISIONS.md` if promoted later; for now project-scoped.)

---
