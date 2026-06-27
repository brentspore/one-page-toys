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

**Last updated:** 2026-06-26 · **Latest pushed commit:** `main 79d0b4c` (**32 toys live**). Post-031/032 tweaks: Aurora Drift curtains now ease in/out by fade instead of a hard pop (`script.js?v=2`; rays only culled once `peaked` + fading out — an earlier proportional-grow attempt culled every ray on frame 1 and made all auroras vanish); Campfire logs burn away (fuel model, char/shrink/fade). Recent rounds: two new **wellness** toys (031/032, this round); wellness toys 029/030 (`77fc8a6`); Chimp Test (017) "Full fun pass" (`067a42e`); toys 025–028 (`b78fab1`); baseline `94a631c` (24 toys).

### New this round (031–032, wellness)
- **031 Aurora Drift** (`toys/aurora-drift/`, wellness) — drag paints soft draped **aurora curtains** (green/teal/violet ray particles on a travelling-wave sway, additive `lighter`, fade in/out; `MAX_RAYS=150`, `sat=78`) over 2 layered near-black snowy-peak silhouettes (`#0a1020`/`#02040a`) with faint rim light + starfield; a gentle self-running ambient aurora keeps it alive on arrival. Audio = very soft evolving sine pad (A2/E3/A3/B3 + low LFOs) + breathy bandpass air that opens while painting + sparse pentatonic `shimmer()`. ⚠ Tuning history: first pass was far too intense (neon flames, blown to white, peaks invisible) — fixed by dropping ray count/alpha/sat, calming amp, and making peaks solid near-black silhouettes w/ rim light.
- **032 Campfire** (`toys/campfire/`, wellness) — tap tosses a **log** (flares + grows fire), drag **fans** flames; particle flames (white-hot→orange→red tongues, vertically elongated)/embers/smoke, warm ground glow, log + rock ring. **Logs burn away:** each has `fuel` (1→0, ~40-50s, faster when fanned), chars brown→charcoal + shrinks + fades, removed at fuel≤0; fire `intensity` eases toward `FLOOR+totalFuel*0.5` (FLOOR=0.34) so it's bright with logs, sinks to an ember floor as they char, and spikes when you add one. **Audio fully synthesized (owner requirement, no samples):** filtered-noise roar bed w/ breathing LFO + Poisson crackle pops (mostly faint ticks, ~12% sharp broadband woody snaps — NO tonal ring, that was the "ping") + high sizzle + log-add = woody resonant-mode knock (2 hits) + bark scrape + spark flare. Owner to audition audio + watch burn-down live.
- Both: rendered card thumbnails (`assets/cards/`) + per-toy OG (`assets/og/` via og-gen.html). Registered in tools-registry.json (prepended), sitemap.xml, TYPE_NL_PHRASES (main.js), card rule + :not() chain (styles.css). Cache-bust hub `styles.css?v=33` + `main.js?v=31`. Wellness filter now shows 5 (Aurora Drift, Breathing Pacer, Campfire, Floating Lanterns, Zen Sand Garden).

### Prior round (029–030, wellness)
- **029 Zen Sand Garden** (`toys/zen-sand-garden/`, wellness) — drag rakes lit, combed furrows into a **persistent offscreen sand layer** (per-tine: shadow valley + highlight ridge offset toward a top-left light); tap sets a smooth lit pebble (irregular blob outline, radial gradient, contact shadow) with concentric rings raked around it. "Smooth sand" (clears furrows, keeps stones) / "Clear stones" controls. Audio = speed-driven continuous raking noise (bandpassed brown noise) + wooden "tock" (sine thunk + click) on placement. Tap-vs-drag: a near-stationary quick press (<8px, <360ms) places a stone; movement rakes.
- **030 Floating Lanterns** (`toys/floating-lanterns/`, wellness) — night lake scene (twinkling stars, moon + glow + shimmering reflection path, 2 layered hill silhouettes, water band at HY=0.72H); tap releases a warm glowing **sky lantern** (rounded paper capsule + halo + flame core, composite `lighter`) that rises/sways/flickers/shrinks/fades, **mirrored on the lake** (clipped to water, flipped+squashed, alpha fades as it climbs). Audio = ambient night wind (low brown noise + slow LFO) + lake lapping (2nd lower band) + soft pentatonic shimmer + airy "fwoom" on release.
- Both: rendered card thumbnails (`assets/cards/`) + per-toy OG (`assets/og/` via og-gen.html). Registered in tools-registry.json (prepended), sitemap.xml, TYPE_NL_PHRASES (main.js), card rule + :not() chain (styles.css). Cache-bust hub `styles.css?v=32` + `main.js?v=30`.

### Earlier this session (025–028)
- **025 Kaleidoscope** (`toys/kaleidoscope/`, visual) — drag to stir glowing jewel shards into 12-fold mirrored symmetry, tap to drop a gem. Offscreen "object cell" reflected through dihedral wedges.
- **026 Zen Ripple Pond** (`toys/ripple-pond/`, visual) — real damped-wave height-field sim (9-point Laplacian to avoid checkerboard instability) rendered as moonlit water; koi (proper fish shapes w/ koi patterns), lily pads + lotus. **Audio:** rock-drop *ker-plunk* (impact thud + rising cavity bloop + splash noise) + water-relevant ambient (layered brown-noise river bed w/ moving lowpass + sweeping bandpass + occasional panned trickle runs). NO pure drone.
- **027 Wind Chimes** (`toys/wind-chimes/`, audio) — **rigid support bar that swings (phi) AND tilts (psi)**; tubes are pendulums driven by their **moving pivots** (correct `g/L` gravity + pivot-acceleration coupling — earlier versions had ~100× too-weak stiffness = "zero-G", since fixed). Grab the **bar** (move whole thing), a single tube, or the clapper; tap to ring. Tone = bright upper-octave pentatonic w/ **inharmonic tubular-bell partials** (ratios ~1, 2.76, 5.40, 8.93) + mallet "tink" transient + ~8.5k lowpass.
- **028 Marble Drop** (`toys/marble-drop/`, game) — plinko: glossy glass marbles bounce down a brass pegboard into bins (Galton bell curve). Anti-rest peg nudge + a per-frame **anti-stuck** pass (wall-biased) so marbles never lodge in the field or on the side rails. **Auto** button = self-running sim; Clear button. Glass-clack audio (velocity-scaled, throttled).
- **all-toys.html:** **infinite scroll** (12/page via an IntersectionObserver sentinel after `#toolsGrid`, in `assets/main.js` `renderNextPage`/`ensureScrollObserver`; home's random-9 path untouched) + the **Friends of the gallery** `<aside>` (copied from index.html, above the footer).
- **Audio rule (now in project DECISIONS.md):** realistic, physically-grounded synthesis across every toy with sound — transient + body + tail, velocity-scaled, consonant. Headless can't audition sound, so audio is verified structurally only — owner should listen + tune.
- Shared-asset cache-bust (025–028 round): `styles.css?v=31`, `main.js?v=29` (now superseded by v=32 / v=30 above).

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

**The 30 toys:** Goo Cursor, Meeting Cost Meter (the one utility), Breathing Pacer, Coin Flip, Dice Roller, Magic 8-Ball, Blob Choir, Tic-Tac-Toe, Rock Paper Scissors, Three Doors, Memory Match, Snake, Weird Generative Canvas, Star Click Sky, Tiny Idle Garden (015), Echo (016), Chimp Test (017), Beat Maker (018), Falling Sand (019), Lava Lamp (020), Bubble Wrap (021), Newton's Cradle (022), Spirograph (023), Plasma Ball (024), Kaleidoscope (025), Zen Ripple Pond (026), Wind Chimes (027), Marble Drop (028), Zen Sand Garden (029), Floating Lanterns (030).

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
