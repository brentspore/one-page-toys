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

**Last updated:** 2026-06-26 · **Latest pushed commit:** `main <pending>` (**28 toys live**). This round added 4 toys (025–028) + two all-toys.html features. Earlier baseline (`94a631c`, 24 toys): every toy has a full-screen toggle + is interactive; Newton's Cradle drag-direction grab + Auto-swing; Spirograph gear sliders; Lava Lamp full-viewport metaballs; Plasma Ball (024) met the bar.

### New this session (025–028)
- **025 Kaleidoscope** (`toys/kaleidoscope/`, visual) — drag to stir glowing jewel shards into 12-fold mirrored symmetry, tap to drop a gem. Offscreen "object cell" reflected through dihedral wedges.
- **026 Zen Ripple Pond** (`toys/ripple-pond/`, visual) — real damped-wave height-field sim (9-point Laplacian to avoid checkerboard instability) rendered as moonlit water; koi (proper fish shapes w/ koi patterns), lily pads + lotus. **Audio:** rock-drop *ker-plunk* (impact thud + rising cavity bloop + splash noise) + water-relevant ambient (layered brown-noise river bed w/ moving lowpass + sweeping bandpass + occasional panned trickle runs). NO pure drone.
- **027 Wind Chimes** (`toys/wind-chimes/`, audio) — **rigid support bar that swings (phi) AND tilts (psi)**; tubes are pendulums driven by their **moving pivots** (correct `g/L` gravity + pivot-acceleration coupling — earlier versions had ~100× too-weak stiffness = "zero-G", since fixed). Grab the **bar** (move whole thing), a single tube, or the clapper; tap to ring. Tone = bright upper-octave pentatonic w/ **inharmonic tubular-bell partials** (ratios ~1, 2.76, 5.40, 8.93) + mallet "tink" transient + ~8.5k lowpass.
- **028 Marble Drop** (`toys/marble-drop/`, game) — plinko: glossy glass marbles bounce down a brass pegboard into bins (Galton bell curve). Anti-rest peg nudge + a per-frame **anti-stuck** pass (wall-biased) so marbles never lodge in the field or on the side rails. **Auto** button = self-running sim; Clear button. Glass-clack audio (velocity-scaled, throttled).
- **all-toys.html:** **infinite scroll** (12/page via an IntersectionObserver sentinel after `#toolsGrid`, in `assets/main.js` `renderNextPage`/`ensureScrollObserver`; home's random-9 path untouched) + the **Friends of the gallery** `<aside>` (copied from index.html, above the footer).
- **Audio rule (now in project DECISIONS.md):** realistic, physically-grounded synthesis across every toy with sound — transient + body + tail, velocity-scaled, consonant. Headless can't audition sound, so audio is verified structurally only — owner should listen + tune.
- Shared-asset cache-bust at session end: `styles.css?v=31`, `main.js?v=29` (in index.html + all-toys.html).

## ⚠ Design quality bar — READ BEFORE BUILDING ANY TOY
The owner is a **designer** and holds a high visual bar. A toy is NOT done when it merely "works" — it must look *intentional, polished, and richly itself*. The first desktop pass at toys 020–023 was rejected for being flat/crude with unrepresentative cards; this is the standard that pass missed:
- **Every toy MUST be interactive** (owner rule, 2026-06-22). No purely passive "just watch" toys — each must respond to tap / drag / click / controls in a meaningful way (e.g. Lava Lamp: drag to stir the wax; Spirograph: gear sliders; Plasma Ball: arcs follow your finger). If a concept is inherently ambient, add a way to disturb, shape, or steer it.
- **Each toy is its own curated little world** — a deliberate palette, lighting, depth, motion. No flat primitives on flat backgrounds. Study the strongest live toys before building and match that level: **Goo Cursor, Star Click Sky, Tiny Idle Garden, Falling Sand, Three Doors, Plasma Ball**.
- **Render real-world toys *as the real object*** — material, lighting, shadow, glow. (Newton's cradle needs a grounded frame + chrome balls, not flat dots. A spirograph needs dense layered glowing rosettes, not one thin loop. Plasma needs jagged crackling lightning, not smooth rotating lines.) [Note: Lava Lamp is intentionally full-viewport metaballs now — NOT a vessel — per owner request; don't re-add a lamp shell.]
- **Card images MUST clearly represent the toy.** Strongly prefer a **real rendered thumbnail** captured from the finished toy (`assets/cards/<slug>.png`, overlays hidden, square-ish crop) over abstract CSS gradients — abstract blobs that don't read as the toy are NOT acceptable. The card CSS is then `background:#<bg> url("cards/<slug>.png") center/cover`.
- **Never ship without an OG image.** Generate one for every toy via `scripts/og-gen.html` (you can reuse the rendered card thumbnail as the motif — see the `img()` helper + toy entries already in that file). A missing `assets/og/<slug>.png` = a broken share link.
- **Always SCREENSHOT and look at it** (toy, card, and OG) before committing — "no console errors" is not the bar; *how it looks* is. Note: headless Chromium throttles `requestAnimationFrame`, so animated toys may not finish drawing in a normal screenshot — drive frames with `await page.evaluate(()=>new Promise(r=>requestAnimationFrame(r)))` in a loop, or the toy will look unfinished when it's actually fine.

## To continue on another machine
1. `git pull` (the remote is authoritative; everything below is committed/pushed).
2. Run locally — **no build, no deps needed**: from the repo root, `python3 -m http.server 8000`, then open `http://localhost:8000`.
3. Only if you need the headless verify / screenshot / OG-render workflow (Playwright): `npm install` then `npx playwright install chromium`. **`node_modules` is gitignored on purpose** (it once bloated pushes), so it won't come down with the pull — reinstall it.

## What this site is now (post-pivot, 2026-06)
A branded **launcher hub** + **19 standalone, full-bleed toys**, each in its own `toys/<slug>/` (or `tools/<slug>/` for the lone utility), opening in a NEW TAB. Geist design system (Geist Sans/Mono, neutral grays, restrained red `#941e1e`, 3-way System/Light/Dark theme). The old ~57 toys were archived to `/archive/`. **Direction: FUN / playful / experiential — NOT dev tools** (dev tools belong on the separate BuildUtilities site). Static site, GitHub Pages from `main` → onepagetoys.com.

**The 28 toys:** Goo Cursor, Meeting Cost Meter (the one utility), Breathing Pacer, Coin Flip, Dice Roller, Magic 8-Ball, Blob Choir, Tic-Tac-Toe, Rock Paper Scissors, Three Doors, Memory Match, Snake, Weird Generative Canvas, Star Click Sky, Tiny Idle Garden (015), Echo (016), Chimp Test (017), Beat Maker (018), Falling Sand (019), Lava Lamp (020), Bubble Wrap (021), Newton's Cradle (022), Spirograph (023), Plasma Ball (024), Kaleidoscope (025), Zen Ripple Pond (026), Wind Chimes (027), Marble Drop (028).

## Key files
- `tools-registry.json` — drives the gallery. Prepend new toys (newest first). slug/name/shortDescription/category/tags/status/path.
- `assets/main.js` — gallery render + search; `TYPE_NL_PHRASES` map (natural-language search terms per tag); home shows a RANDOM 9; GA4 events (`toy_launch`, `outbound_click`, `tip_jar_click`). Cache-bust `?v=N`.
- `assets/styles.css` — hub styles + per-slug `.card__preview[data-slug="…"]` thumbnails (+ a `:not()` default-exclusion list). Cache-bust `?v=N`.
- `assets/theme.js` — 3-way theme toggle. `assets/tip-jar.js` — Mighty Army shield badge → PayPal `brent@mightyarmy.com`.
- `sitemap.xml`, `assets/og/<slug>.png` (per-toy share images — every toy has one), `assets/cards/<slug>.png` (real rendered card thumbnails — used by Falling Sand + Lava Lamp + Bubble Wrap + Newton's Cradle + Spirograph; the rest use CSS motifs, but new toys should prefer a rendered thumbnail per the quality bar above).
- **`scripts/og-gen.html`** — parameterized 1200×630 template for per-toy OG share images (and the Falling Sand card thumbnail). Open `file://…/scripts/og-gen.html#<slug>` and screenshot at 1200×630. (Was historically in `/tmp` — now committed here.)

## Conventions / how to add a toy
- New `toys/<slug>/` = self-contained `index.html` + `styles.css` + `script.js`, full-bleed, frame corners (`No. NNN`, name, back-link), a hint line, includes `assets/tip-jar.js?v=9`. Full SEO meta + JSON-LD + GA snippet + no-flash theme init (copy any recent toy as a template — e.g. `toys/echo/` or `toys/falling-sand/`).
- Register: add to `tools-registry.json` (top) + `sitemap.xml` + `TYPE_NL_PHRASES` in `main.js` + a `.card__preview[data-slug]` rule in `assets/styles.css` (and add the slug to the default `:not()` chain) + a per-toy OG image via `scripts/og-gen.html`.
- **Cache-busting:** bump `?v=N` on any shared asset you change (`assets/styles.css`, `assets/main.js`, `assets/theme.js`, `assets/tip-jar.js`) across `index.html` + `all-toys.html`, and on a toy's own `script.js`/`styles.css` in its `index.html`. Browsers cache aggressively.
- **Audio toys (LEARNED):** always add the iOS silent-buffer unlock + `resume()` inside the first user gesture, or Web Audio can stay silent on iOS Safari — `var b=actx.createBuffer(1,1,22050); var s=actx.createBufferSource(); s.buffer=b; s.connect(actx.destination); s.start(0);`. Tune tones to be consonant + calm (pentatonic / major-6, lower octaves, sine + lowpass).
- **3D-transformed elements (LEARNED):** on a `transform-style: preserve-3d` element, `box-shadow` rings render with a clipped edge — use `outline` for focus/selection rings instead (bit Three Doors' picked door).
- Verify each toy headless before committing (Playwright): no console errors, no horizontal overflow at 375px, interactions work. Screenshot to eyeball visuals.

## Open ideas / next candidates (fun-aligned)
Toys 020–023 built, redesigned to the quality bar, and given real card + OG images. Next candidates: archive options **Mood Meteor**, **Void Oracle**, **Emoji Slots**; genre gaps: more audio, more cozy/idle. Skip as too-simple: the reflex cluster + one-shot gag generators in `/archive/`.

## Other repos (separate)
- **BuildUtilities** (`~/Personal Projects/buildutilities` = GitHub `brentspore/buildutilities` = Lovable project "BuildUtilities.com") — the dev-tools site; git push syncs into Lovable, then Publish in Lovable to deploy. Different repo entirely.
