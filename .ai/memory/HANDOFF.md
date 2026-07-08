---
name: Cross-device handoff
description: Resume-here state + how-to-continue, kept IN the repo so it travels via git pull between machines
type: project
---

# Handoff — resume here

This doc lives in the repo (`.ai/memory/`), so it syncs between devices via `git pull`.
It is the authoritative current-state bridge. (A richer running log lives in the *global*
`~/.ai/memory/PULSE.md`, but that is machine-local and may NOT exist on every device — trust
this file when they disagree, and note `project.md` here is from the pre-2026-06 era and is stale.)

**This is a handoff, not a journal.** Keep ONE current-state block below and overwrite it each session; the full per-toy build history through 2026-07-07 (toys 001–069, every lesson and convention as it was learned) is preserved verbatim in [archive/HANDOFF-archive-2026-07-08.md](archive/HANDOFF-archive-2026-07-08.md).

## Current state

**Last updated:** 2026-07-08 (memory compression only — no site changes) · **Latest pushed site commit:** `main 7fcce94` · **69 toys live** at onepagetoys.com.

- Latest shipped round (`7fcce94`, 2026-07-07): Puffling clean shorelines (lip ends flush, island edges taper underwater) + notch-safe tip-jar/fullscreen buttons via safe-area `env()` insets across all 69 toys+tools (`tip-jar.js?v=10`/`fullscreen.js?v=3`).
- Prior round (`7375602`): clean directory URLs site-wide (`onepagetoys.com/toys/<slug>/` canonicals/OG/JSON-LD/sitemap/registry) + Puffling mobile perf (popup sprites, DPR cap 1.75, water-layer skip).
- Uncommitted in the working tree: an unreviewed edit to `.ai/memory/DECISIONS.md` from a prior session (left unstaged during the 2026-07-08 memory compression; review before committing).

**Next step:** Fresh owner priorities. Backlog: Alto's-style sandboarder (marked `next`), LinkedIn-Zip-style daily path puzzle (queued). See `.ai/memory/BACKLOG.md`.

## ⚠ Live conventions (accreted from builds — bake into every new toy)

- **Directory URLs:** canonical/og:url/JSON-LD/registry path/sitemap all use `onepagetoys.com/toys/<slug>/`; back-links are `../../`.
- **Safe-area insets:** fixed-position UI (tip jar, fullscreen, sound toggles) must use `max(16px, env(safe-area-inset-*))` — `viewport-fit=cover` is live on some toys and the notch will cover corners otherwise.
- **iOS tap highlight:** full-bleed canvas toys MUST set `-webkit-tap-highlight-color: transparent` on html/body/canvas (+ `-webkit-touch-callout:none`/`user-select:none`) or iOS washes the screen blue per tap.
- **Cache-busting:** bump `?v=N` on EVERY edit the owner will test — a stale `script.js?v=1` once cost a whole play-test round.
- **Quote canvas font families containing digits** (`'Baloo 2'`) — Safari treats the unquoted string as invalid and silently falls back to `10px sans-serif`.
- **Rotation-invariant world scale:** viewport-relative world scaling changes difficulty when aspect flips — key world scale to the device's long dimension.
- **Media-query order:** equal-specificity base rules later in a stylesheet silently override earlier `@media` blocks — check COMPUTED styles, not rule presence.
- **Real WebKit for Safari-only bugs:** `npx playwright install webkit` — headless Chromium can't reproduce Safari rendering (font-string fallback, tap highlight, shadowBlur rasterization).
- Older lessons (3D box-shadow → outline, iOS audio unlock, headless rAF throttling, etc.) live below, in the archive, and in `.ai/memory/DECISIONS.md`.

## ⚠ Design quality bar — READ BEFORE BUILDING ANY TOY
The owner is a **designer** and holds a high visual bar. A toy is NOT done when it merely "works" — it must look *intentional, polished, and richly itself*. The first desktop pass at toys 020–023 was rejected for being flat/crude with unrepresentative cards; this is the standard that pass missed:
- **Every toy MUST be interactive** (owner rule, 2026-06-22). No purely passive "just watch" toys — each must respond to tap / drag / click / controls in a meaningful way (e.g. Lava Lamp: drag to stir the wax; Spirograph: gear sliders; Plasma Ball: arcs follow your finger). If a concept is inherently ambient, add a way to disturb, shape, or steer it.
- **Each toy is its own curated little world** — a deliberate palette, lighting, depth, motion. No flat primitives on flat backgrounds. Study the strongest live toys before building and match that level: **Goo Cursor, Star Click Sky, Tiny Idle Garden, Falling Sand, Three Doors, Plasma Ball**.
- **Render real-world toys *as the real object*** — material, lighting, shadow, glow. (Newton's cradle needs a grounded frame + chrome balls, not flat dots. A spirograph needs dense layered glowing rosettes, not one thin loop. Plasma needs jagged crackling lightning, not smooth rotating lines.) [Note: Lava Lamp is intentionally full-viewport metaballs now — NOT a vessel — per owner request; don't re-add a lamp shell.]
- **Card images MUST clearly represent the toy.** Strongly prefer a **real rendered thumbnail** captured from the finished toy (`assets/cards/<slug>.png`, overlays hidden, square-ish crop) over abstract CSS gradients — abstract blobs that don't read as the toy are NOT acceptable. The card CSS is then `background:#<bg> url("cards/<slug>.png") center/cover`.
- **Never ship without an OG image.** Generate one for every toy via `scripts/og-gen.html` (you can reuse the rendered card thumbnail as the motif — see the `img()` helper + toy entries already in that file). A missing `assets/og/<slug>.png` = a broken share link.
- **Always SCREENSHOT and look at it** (toy, card, and OG) before committing — "no console errors" is not the bar; *how it looks* is. Note: headless Chromium throttles `requestAnimationFrame`, so animated toys may not finish drawing in a normal screenshot — drive frames with `await page.evaluate(()=>new Promise(r=>requestAnimationFrame(r)))` in a loop, or the toy will look unfinished when it's actually fine.

## ⚠ Audio quality bar — READ BEFORE BUILDING ANY TOY WITH SOUND
Sound is a **first-class part of the presentation**, held to the same standard as the visuals (owner directive, 2026-06-30). A toy's audio isn't done when it plays the right note — it must sound **rich, spacious, and intentional**. Full standard + reference recipes in `.ai/memory/DECISIONS.md` ("Audio quality bar"). The essentials:
- **Layered, physically-grounded voice:** `transient + body (correct harmonic/inharmonic partials) + decaying tail`. Know the physics — clamped-free bar (kalimba) is inharmonic ≈1:6.27:17.55; a tuned tongue drum/hang is harmonic (strong octave ×2, twelfth ×3); a tube (chimes) ≈1:2.76:5.40. Right partial ratios = "real instrument" vs "beep."
- **Space is non-negotiable:** convolver reverb (smooth impulse — low-pass the noise so the tail isn't grainy; highshelf for shimmer, highpass so lows stay clean) + a feedback **delay** where it fits (feed it into the reverb so repeats bloom). Dry = cheap.
- **Stereo width** (pan voices by on-screen position), **bus compressor** (glue + anti-clip on strums), master lowpass for silk, **velocity/detune variation** (no machine-gun sameness), **consonant scales** (pentatonic/Akebono), **iOS unlock** + Sound toggle.
- **Headless CANNOT hear** — the automated pass only proves the graph builds. Audio is always "needs the owner's ears"; say so and iterate on feedback. Copy **Kalimba** / **Steel Tongue Drum** audio architecture as the starting point.
- **Meta-principle:** *keep pushing the presentation envelope — visual AND audio — as far as we dare within reason.* Each release a notch more polished than the last; when touching a toy, look for the upgrade, not just "works" (without breaking the zero-build vanilla soul).

## To continue on another machine
1. `git pull` (the remote is authoritative; everything below is committed/pushed).
2. Run locally — **no build, no deps needed**: from the repo root, `python3 -m http.server 8000`, then open `http://localhost:8000`.
3. Only if you need the headless verify / screenshot / OG-render workflow (Playwright): `npm install` then `npx playwright install chromium` (add `webkit` for Safari-only bugs). **`node_modules` is gitignored on purpose** (it once bloated pushes), so it won't come down with the pull — reinstall it.

## What this site is now (post-pivot, 2026-06)
A branded **launcher hub** + **69 standalone, full-bleed toys**, each in its own `toys/<slug>/` (or `tools/<slug>/` for the lone utility), opening in a NEW TAB. Geist design system (Geist Sans/Mono, neutral grays, restrained red `#941e1e`, 3-way System/Light/Dark theme). The old ~57 toys were archived to `/archive/`. **Direction: FUN / playful / experiential — NOT dev tools** (dev tools belong on the separate BuildUtilities site). Static site, GitHub Pages from `main` → onepagetoys.com. The authoritative toy list is `tools-registry.json` (newest first) — don't maintain a prose copy here.

## Key files
- `tools-registry.json` — drives the gallery. Prepend new toys (newest first). slug/name/shortDescription/category/tags/status/path. ~7 concept tags per toy (mechanic/vibe/input/theme/comparables), always keeping each toy's NL-phrase key.
- `assets/main.js` — gallery render + search; `TYPE_NL_PHRASES` map (natural-language search terms per tag); home shows a RANDOM 9 (featured toy excluded); GA4 events (`toy_launch`, `outbound_click`, `tip_jar_click`, `share`). Cache-bust `?v=N`.
- `assets/styles.css` — hub styles + per-slug `.card__preview[data-slug="…"]` thumbnails (+ a `:not()` default-exclusion list). Cache-bust `?v=N`.
- `assets/theme.js` — 3-way theme toggle. `assets/tip-jar.js` — Mighty Army shield badge → PayPal. `assets/share.js` — drop-in share pill for overlay games (12 wired). `assets/fullscreen.js` — shared fullscreen button.
- `sitemap.xml`, `assets/og/<slug>.png` (per-toy share images — every toy has one), `assets/cards/<slug>.png` (real rendered card thumbnails — new toys use a rendered thumbnail per the quality bar above).
- **`scripts/og-gen.html`** — parameterized 1200×630 template for per-toy OG share images. Open `file://…/scripts/og-gen.html#<slug>` and screenshot at 1200×630.

## Conventions / how to add a toy
- New `toys/<slug>/` = self-contained `index.html` + `styles.css` + `script.js`, full-bleed, frame corners (`No. NNN`, name, back-link `../../`), a hint line, includes `assets/tip-jar.js` (current `?v=`) + `assets/share.js` for overlay games. Full SEO meta + JSON-LD + GA snippet + no-flash theme init (copy a recent toy as a template).
- Register: add to `tools-registry.json` (top) + `sitemap.xml` + `TYPE_NL_PHRASES` in `main.js` + a `.card__preview[data-slug]` rule in `assets/styles.css` (and add the slug to the default `:not()` chain) + a per-toy OG image via `scripts/og-gen.html`. Directory-form URLs everywhere (see Live conventions).
- **Audio toys (LEARNED):** always add the iOS silent-buffer unlock + `resume()` inside the first user gesture, or Web Audio can stay silent on iOS Safari. Tune tones to be consonant + calm.
- **3D-transformed elements (LEARNED):** on a `transform-style: preserve-3d` element, `box-shadow` rings render with a clipped edge — use `outline` for focus/selection rings instead.
- Verify each toy headless before committing (Playwright): no console errors, no horizontal overflow at 375px, interactions work. Screenshot to eyeball visuals. Remove temp debug hooks (grep-clean) before commit.
- The full build checklist lives in the **new-toy skill** (`~/.ai/skills/new-toy`); this file carries the repo-local specifics it points at.

## Open ideas / next candidates (fun-aligned)
See `.ai/memory/BACKLOG.md` (Backlog-Viewer format; sandboarder marked `next`). Genre gaps: more audio, more cozy/idle. Skip as too-simple: the reflex cluster + one-shot gag generators in `/archive/`.

## Other repos (separate)
- **BuildUtilities** (`~/Personal Projects/buildutilities` = GitHub `brentspore/buildutilities` = Lovable project "BuildUtilities.com") — the dev-tools site; git push syncs into Lovable, then Publish in Lovable to deploy. Different repo entirely.
