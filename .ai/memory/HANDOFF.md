# Handoff

**Last updated: 2026-09-12 (No. 119 Tiny Across shipped with its daily at tinyacross.com; All Toys gained a session-collapsible newest-toy panel).** This is a handoff, not a journal: keep ONE current-state block and overwrite it each session. The full session-by-session journal to this point is preserved verbatim in [archive/HANDOFF-archive-2026-08-29.md](archive/HANDOFF-archive-2026-08-29.md); the earlier archives still exist and hold the per-toy detail — 001–069 ([2026-07-08](archive/HANDOFF-archive-2026-07-08.md)), 070–100 ([2026-07-27](archive/HANDOFF-archive-2026-07-27.md)), 101–107 + the 08-04 search audit ([2026-08-14](archive/HANDOFF-archive-2026-08-14.md)).

## What this site is / key files

A branded launcher hub + standalone full-bleed toys (`toys/<slug>/`, utilities in `tools/<slug>/`), each opening in a new tab. Geist design system, 3-way theme. Direction: FUN/playful — dev tools belong on BuildUtilities (separate repo; that one IS Lovable-connected: push syncs, then Publish in Lovable). Key files: `tools-registry.json` (authoritative toy list, newest first, drives the gallery), `assets/main.js` (gallery + NL search + GA4; home = random 9), `assets/styles.css`, `assets/{theme,tip-jar,share,fullscreen,tickets,prizes,more-games}.js`, `sitemap.xml`, `assets/cards/` + `assets/og/`, `scripts/{og-gen.html,gen-card.cjs,gen-og.cjs}`. Memory: `BACKLOG.md` (~24 open ideas), `DECISIONS.md` (standards), `reference.md` (infra), `archive/`.

**119 toys, live at onepagetoys.com.** Latest on `main`: `2b214df`. **Hosting is Vercel:** push `main` → deploy in 1–2 min (`pages-build-deployment` is a legacy leftover; single 404s during edge rollout are normal, retry). ⚠ Redirect is **`www` → apex, a 307** (per the 08-04 audit; an older note claimed the reverse — trust the audit), so **live-verify against `https://onepagetoys.com/`**.

## Newest work

**No. 117 Skyscrapers** (`toys/skyscrapers/`) — the catalogue's first real logic puzzle: a Latin square where **the numbers ARE building heights** and the edge clues are sightlines. Sizes 4/5/6; keys `sky_best_4|5|6` (one regex ticket rule, **dir `down`**), `sky_size`, `sky_sound`. ✅ Owner play-tested; both findings fixed and live (`a83cc21`).
- ⚠ Generator: **if arc consistency drives every cell to a single candidate, the puzzle is PROVABLY unique and guess-free** — one pass instead of an exponential count (6×6: 10.7s → 8ms).
- ⚠ **Minimal-under-propagation is legal but UNFAIR** (the solver intersects 720 permutations at once). The **clue floor 5/9/14 at n=4/5/6** keeps chains human, and **is a judgement call, untested in play.**
- ⚠ **One storey is DERIVED — `0.9 · DEPTH/(n−1)`**, the tallest at which a back-row roof still shows. Do not raise it for drama. ⚠ **The projection is solved PER SCREEN** (a fixed camera left portrait phones with 38px cells).
- ⚠ **A touch target may be larger than its artwork, never smaller** — the hit area was the tower footprint inset 19%, so ~40% of taps died, and keyboard play hid it. ⚠ **Sweep coverage with DRAGS, not taps** — a tap CYCLES height, so dense tapping walks cells back to empty.
- ⚠ **A puzzle with two independent win conditions must show BOTH as live counters** — otherwise players satisfy the legible one and call the toy broken (*"I completed sudoku in the buildings but not the numbers outside"*).
- ⚠ **Card pose is KEYBOARD-driven** (`scripts/poses/skyscrapers.js`) and leaves **one gap per row AND column** — a completed line gets judged, and a judged line missing its clue turns the chip red, which reads as broken.

⚠ **JENGA IS PARKED ON THE `jenga` BRANCH, not main** (`git checkout jenga`). Physics, rules and placement work; **one bug left — sliding a block out drags the level above it ~0.63m.** Friction is RULED OUT with evidence (a global sweep 0.15→0.6 moved it <2%; a slick puller material verified active at 0.6→0.02 still dragged 0.626). Next: suppress collision between the pulled block and the one directly above while it slides. **The branch also carries the ONE vendored dependency — cannon-es 0.20.0 MIT in `toys/jenga/lib/` — and its `DECISIONS.md` entry; neither is on main**, deliberately, so main does not claim a dep exception for code it lacks.

## No. 119 Tiny Across + the All Toys newest-toy panel — shipped 2026-09-12 (`2b214df`), live

Launched the same evening as the daily at tinyacross.com (its repo HANDOFF has the launch record).
Live-verified: toy page 200, gallery renders, All Toys panel shows Tiny Across, feeder plays on a phone,
IndexNow accepted. ⚠ **Audio has never been heard** (levels measured in the daily repo only).
- **`toys/tiny-across/`** is the practice feeder for the daily crossword at tinyacross.com: a vanilla
  port of that repo's React game (cursor rules, solve state, audio all ported; keep them in step).
  `puzzles.js` is GENERATED there (`node scripts/export-feeder.mjs`), never hand-edited. Keys:
  `tinyacross_best` (clean solve ms, ticket rule dir `down`), `tinyacross_runs`, `tinyacross_seen`,
  `tinyacross_sound`. Registered everywhere: registry, sitemap, NL phrases, card CSS + `:not()` chain,
  og-gen, ticket rule, card (`scripts/poses/tiny-across.js`, `--el ".tray"`) and OG, cross-promo in all
  four lists. Verified headless: 22 flow checks, no console errors, no overflow at 375px.
  - ⚠ **While typing on a touch screen the tip jar, fullscreen, tickets pill and back link are hidden**
    (`body.is-typing.is-touch`): the pinned keyboard owns the bottom of the screen. They return on the
    start and finish panels.
  - ⚠ **The overlay grid needs `grid-template-columns: minmax(0, 1fr)`**: the More Toys cards' nowrap text
    otherwise pushed the panel past a phone's right edge.
- **All Toys newest-toy panel** (owner request): `#newestToy` above the grid on `/all-toys/` only, fed by
  the registry's first entry. Collapse (one-line strip) or close (×) holds for the SESSION in
  `sessionStorage['opt-newest-panel']`, keyed by slug so the NEXT new toy shows again. Hidden while any
  search, tag or category filter is active, and never on category pages. `renderNewestPanel()` in
  `main.js`, `.newest*` in `styles.css`. Uses featured art when the slug has it, else the card image.
- Versions bumped for this: `main.js?v=113`, `styles.css?v=117`, `tickets.js?v=26` (128 pages),
  `more-games.js?v=21` (42 pages).

## No. 118 Chess (`toys/chess/`) — shipped 2026-09-05, live and owner-approved

The catalogue's first real opponent AI. Four files: `chess-core.js` (rules), `engine.js`
(search, a Worker), `script.js` (render/audio/UI), `styles.css`. **The core is loaded by
BOTH threads** — `<script>` in the page, `importScripts` in the worker — so there is exactly
one move generator and the board can never disagree with the engine about what is legal.
Keys: `chess_beaten` (ticket rule, dir `up`), `chess_defeated`, `chess_wins|losses|draws`,
`chess_sound`. Owner supplied the key art; the board palette was pulled toward it.

- ⚠⚠ **THE BUG WORTH REMEMBERING — a narrowing root window silently breaks any
  score-based personality system.** Root moves were searched with `(-INF, -alpha)`, so only
  the best move returned a TRUE score; every other came back as a **fail-low bound sitting
  just under alpha**. Sorting still worked, so it looked fine — but the personality layer
  reads those numbers as centipawns, and a losing move scored ~alpha instead of −900 sat
  well inside the temperature jitter. Measured: the Architect (temp 32) found mate-in-1
  **1/20** while the Novice (temp 260) found it **14/20** — a *lower* temperature was
  *worse*, because deeper search tightens the bounds. **Give every root move a FULL window**;
  the saving is worthless here and root move counts are tiny.
- ⚠ **Quiescence is the difficulty lever, not depth.** It is what stops an engine hanging a
  piece to a one-move recapture, so the Novice searches WITHOUT it on purpose — that is what
  produces a beginner who leaves pieces en prise. The flag existed on all six personalities
  and was never read for weeks of tuning; wire the gate before trusting a ladder result.
- ⚠ **Judge the ladder by adjudicated material, never by win/loss alone.** Weak engines
  shuffle to the move cap; scoring those as draws gave 9 draws in 10 games and hid the
  ordering completely. Also ⚠ **scaling time budgets down to speed up a round-robin
  penalises the DEEPER personalities** and can manufacture an inversion — measured, the
  depth cap binds, not the clock (2–28ms used against 200–1400ms budgets).
- ⚠ **Perft is the only honest proof of a move generator.** All six standard positions match
  exactly (~16M nodes) — that is what makes castling-through-check, en-passant discovered
  check and promotion trustworthy without hand-testing them.
- ⚠ **The opening book must verify its own history.** It is indexed by move list, so a stale
  or desynced history returns a move for a DIFFERENT position — which still passes a legality
  test often enough to be played. `historyMatches()` replays and compares before trusting it.
- ⚠ **Camera: a piece hides `height * tan(TILT)` ranks behind it.** That is the entire
  readability budget. 26° squashed pieces to 44% of their height (bottles); 38° let the king
  swallow 1.4 ranks and the back row became guesswork. **31.5° off vertical** puts the king
  near 1.1 ranks with board depth still 85% of its width.
- ⚠ **A shape drawn in raw model units is stretched by the camera.** The knight is scaled
  ~1.0 horizontally but only `COS` (0.52) vertically, so a head authored in model units came
  out past 2:1 — a beak. Map it onto the piece's real on-screen height instead. Related: a
  muzzle must be nearly as DEEP as it is long (the failing version measured 18px by 5px).
- ⚠ **Battlements must be built as extruded blocks, not painted as dark gaps.** At this
  camera the top face is most of what you see, so darkened gaps read as spots on a die.
- ⚠ **`r | 0 > 255 ? 255 : clamp(r)` does NOT clamp** — `>` binds tighter than `|`, so it
  evaluates as `r | clamp(r)` and saturates the channel. It turned every obsidian piece
  bright pink. Colour clamping gets its own named function.
- ⚠ **Keyboard play is a real feature AND the test/pose harness.** Arrows + Enter drive the
  board, so `scripts/poses/chess.js` and every headless test use real input with no debug
  hook. `moveCursor()` clamps at the edges, so spamming Down/Left HOMES the cursor on a1 —
  that is how the pose navigates absolutely. ⚠ In a pose helper, `for (i=0; i<(n||1); i++)`
  fires ONCE for `n === 0`; that turned 1.e4 into 1.e3 and scrambled the card position.
- ⚠ **Audio was measured, never assumed:** 0.114 avg → the bus compressor at −15dB was
  limiting single hits (raising amp 53% moved the peak 15%) → threshold to −6 and amp ×1.93
  → **0.200 avg**, inside the 0.15–0.30 target. **Average 7+ real hits**: a single
  noise-excited render scatters ±20% and will invert an A/B.
- ⚠⚠ **`sampleProfile` CLAMPS past a profile's last control point.** The knight's
  lathe stops at t=0.34, so every ring above it kept returning the same radius and
  the lathe quietly drew a full-height CYLINDER to the top of the piece — a literal
  lollipop stick with the flat head pasted on the front (owner: *"a horse head glued
  on a lollipop"*). Fixed with a per-piece `latheTo` cap. Any future profile that
  stops short of 1.0 needs one. ⚠ A sculpted silhouette must also close on a base as
  WIDE as the collar under it, and wants a darker offset copy behind it for
  thickness, or it reads as a cut-out standing on the board.
- ⚠ **The rook's notches are PAINTED, and that is deliberate.** Cutting them through
  with `destination-out` works, but what shows behind them is the board — so the same
  rook reads with dark notches on one square and light ones on the next. Owner has
  seen and accepted the painted top.
- ⚠ **`.tray` is used by 3 other toys** — chess's material tray is `.captured` so
  `gen-card.cjs`'s hide list can target it without changing their cards.

## Image sharing (`assets/share.js?v=6`, 43 pages)

Measured first: **73 of 117 pages had no share button, 13 toys with a real score sent the generic "come play X" line, none shared an image.** A share button that says "come play X" is an advertisement, and people do not post advertisements.
- Opt in with **`OPT_SHARE_TEXT`** (message), **`OPT_SHARE_LINE`** (short caption), **`OPT_SHARE_IMAGE`** (a canvas). Mobile → native file share, desktop → clipboard, download last.
- ⚠ **The caption strip is not decoration** — an image share carries no link and every link preview is the same generic OG card, so the strip is the only thing carrying `onepagetoys.com`.
- ⚠ **`OPT_SHARE_IMAGE` is called and copied SYNCHRONOUSLY on tap** — a WebGL toy just redraws and returns its canvas, so **`preserveDrawingBuffer` is never needed.**
- ⚠ **The label tracks the globals through PROPERTY SETTERS, not a DOM observer** (an observer broke instantly on Dominoes, whose toolbar never toggles).
- ⚠ **Guard every wired toy against a nothing result** (*"I cleared 0 wires"* is an anti-advertisement): fall back to the plain share, and clear the previous run.
- Dominoes has no end overlay so it carries `data-opt-share` on its toolbar; Dot Loop and Coin Pusher are endless, so their share is only reachable from the intro panel.

## ⚠ STANDING RULE (owner, 2026-08-23): cross-promo is part of shipping a game

*"When I push a new game, the cross promo piece needs to be a part of it."* **A REQUIRED ship step, not a deferred curation pass** — the old "curated, not the whole catalogue" framing let the list fall ten toys behind (`DECISIONS.md`). Now **42 entries, `?v=21` across 42 pages** (Tiny Across added 2026-09-12, verified in all four DEPLOYED bundles). Still genuinely out: Accretion and the three tools.
- ⚠ **FOUR surfaces move together, not three** — `assets/more-games.js` plus the `MoreGames.tsx` in five-second-game, the-trail-game and word-kraven.
- ⚠ **Verify the DEPLOYED bundle: the-trail-game CODE-SPLITS**, so its list is in `assets/routes-*.js` and grepping the main bundle is a false negative — fetch the built chunk hash from production.
- ⚠ **External entries carry `"slug": null`** (Eyeball It, Global War, Symmetry Genius); the siblings carry no `slug` at all, which is how each site drops itself from its own list.
- ⚠ **Feeder entries point at the OPT FEEDER page, not the external site** — the hop lands on a page with full chrome carrying its own tagged CTAs, so attribution survives.
- ⚠ **Do NOT read the more-games version from `index.html`** (the hub never loads that widget, so a `sed` bump inserts a digit instead of replacing one — that produced `?v=115` once). Read it from a toy page.

## ⚠ Audio: modal synthesis is the house technique (owner, 2026-08-14)

Owner called three of four toys "too computery"; the one that passed was the only one modelling a physical string. **A stack of clean partials at tidy ratios is a CHORD, not an object.** Contacts are **MODAL** — a short noise burst through **parallel resonant bandpasses** at the object's own inharmonic modes; copy `modalHit()` from Twisty Cube or Claw Machine.
- ⚠ **THE LOUDNESS TRAP, bitten three times** (0.00001 once, ~0.05 on Skyscrapers, with perfect mode frequencies both times). Causes: `amp` applied twice (excitation AND per mode), and **a narrow bandpass rejects almost all of a 2ms burst** — the envelope carries SHAPE only and each mode needs a **`sqrt(Q)` makeup**. **Deriving Q from the decay is right for colour, wrong for level: always measure the level.**
- ⚠ **Apply velocity ONCE** — a layer with its own `* v` over the mix gain scales as v² (a Dominoes cascade measured 0.025).
- ⚠ **Bells CANNOT be modal**: **contacts are modal, long tails are ADDITIVE** (inharmonic 1 : 2 : 3.01 : 4.17 : 5.43 plus a noise strike transient).
- ⚠ **What says "two solid things touched" is the broadband CONTACT NOISE before the ring** — open every percussive voice with a wide (Q≈0.6) **lowpassed** tack, and run the set through **one shared body**. ⚠ Overcorrecting puts the centroid at 11kHz (a hiss): highpassed noise runs to Nyquist, so the tack needs a **lowpass ~9k**.
- ⚠ **A resonant bandpass gliding upward is one of the most recognisably synthetic gestures there is** (use a wide LOWPASS opening); **evenly spaced bells are an arpeggio**; **a sawtooth through a bandpass is a synth patch, not a motor.**
- ⚠ **Pitch spread across a size axis reads as a TUNE** — keep it near a fourth; **magnitude belongs in the WEIGHT (deeper thump, longer body), not the pitch.**
- ⚠ **The bus compressor is GLUE, not a limiter** (at ratio 3 a burst measured 2.6) — brickwall after it at **thresh −1.5 / ratio 20 / knee 0**. ⚠ **A contact persists over many substeps**: throttle contact voices to one hit per event, or one Pinball flip measures 3.35.
- **MACHINE recipe** (`DECISIONS.md`): a coil slamming a plunger into a stop = a `solenoid()` voice (low thump + metal clack + short coil buzz) UNDER the tonal voice, all percussion through a wooden **cabinet body** (peaking ~196Hz / ~430Hz). Chimes alone read as a toy. **Accretion is the reference build** — a 55/55.4Hz beating hum with upper partials, since 60/120Hz alone is inaudible on a phone.
- **Headless CAN measure level, spectrum, mode frequencies and decay** (OfflineAudioContext, or splice an analyser before `destination` by wrapping the AudioContext constructor before load — no debug hook), but **never character**, so new audio is always "needs owner ears". ⚠ A reading of 0.000 may not be a bug — a win overlay over the canvas eats the clicks.

## Reusable WebGL / method lessons

- ⚠ **Mirrored aim on ANY +z-facing camera:** `mLookAt`'s right vector is `cross(up, z)` = **−x**, so world **+x renders on the LEFT**; one `SX = -1` at the input boundary fixes it.
- ⚠ **Flat geometry wound to a −y normal is eaten by back-face culling — check winding FIRST when flat geometry vanishes** (it ate Bowling's lane and Dominoes' table; going to the shader first lost a round). ⚠ **GLSL `smoothstep` requires edge0 < edge1**; reversed edges are undefined.
- ⚠ **A `readPixels` "proof" is worthless without `preserveDrawingBuffer`** (it reported 0% even for the control) — **screenshots are how you check what WebGL drew.**
- ⚠ **Re-measure after ANY mesh-density change, and measure before optimising: smoothness comes from the NORMALS, not the polygon count** (`pinMesh(3, 22)`, headless 23 → 41 fps).
- ⚠ **Turn-based 3D puzzle orientation is an INTEGER 3×3 matrix, never a quaternion** (exact state, so a solved-check cannot drift false). ⚠ **NEVER round cubie coordinates** — on an even cube they are half-integers and `Math.round(0.5)` is 1, so "cleaning up float error" destroys every 2×2 and 4×4.
- ⚠ Canvas 2D: **`ctx.save()/restore()` does NOT restore the current path**, and **draw a vibrating string as its ENVELOPE, not a displaced line.**
- ⚠ **Continuous collision or the ball tunnels**; reject spawn points **inside** a wall when torture-testing (fake escapes); and **a moving bat re-kicks a ball that stays in contact once per substep** — cap to the local contact-point speed, and beware `max(preSpeed, …)` when preSpeed is already inflated.

## Live conventions (bake into every new toy)

- **Directory URLs everywhere:** canonical / og:url / JSON-LD / registry path / sitemap use `onepagetoys.com/toys/<slug>/`; back-links `../../`. `all-toys/` is a directory (root `all-toys.html` is an unlinked leftover); category pages `all-toys/<cat>/` carry static meta + a `data-cat` body attr main.js reads.
- **Safe-area insets** on fixed UI (`max(16px, env(safe-area-inset-*))`); transparent **iOS tap highlight** on full-bleed canvas; **quote canvas font families containing digits**; **key world scale to the long edge** (rotation-invariant difficulty); check computed styles for **media-query order**; **cache-bust `?v=N` on every edit** the owner will test; real WebKit (`npx playwright install webkit`) for Safari-only bugs.
- **Badges:** tip-jar/fullscreen default right-center; when that blocks play, dock bottom-right with the doubled-class CSS override + center→corner entrance slide (nova-coil pattern). Tickets pill is bottom-LEFT, self-docking above the back-link via measured `dock()`.
- **New-toy pipeline:** self-contained `toys/<slug>/` (SEO + JSON-LD + GA + no-flash theme init + tip-jar/share includes); registry prepend; sitemap; `TYPE_NL_PHRASES`; card CSS rule + `:not()` chain; og-gen entry (+`light:true` for light backgrounds); REAL rendered card then OG (**card first** — og-gen pulls the card as motif); ticket rule if it stores a best; **cross-promo across all four surfaces**; hub cache-bust across all 8 hub pages. Full checklist: `~/.ai/skills/new-toy`. Multi-toy builds: parallel subagents write ONLY `toys/<slug>/`; the parent does shared registration serially.
- **Quality bars** (owner is a designer): every toy interactive, its own curated world, a real rendered card that reads as the toy, never ship without an OG, always screenshot and LOOK. Audio: layered physically-grounded voices + convolver + stereo + compressor + brickwall, consonant scales, iOS unlock + toggle. Recipes in `DECISIONS.md`.
- ⚠ **A ticket rule OR a direct `OPT_TICKETS.award()`, never both — the pair double-counts** (the Skee Ball trap; Bowling, Claw Machine, Pinball, Dominoes, Steady Hand and Skyscrapers use the rule only). Ticket economy + `/store/` (55 prizes, 14 gag effects) live site-wide; bank pill default-on (`?tickets=0` opts out); rules encode direction `up`/`down`/`count`. Excluded on purpose: `bj_bank` and the seeded `vp_best` (a bankroll legitimately falls); `fsg_best` is dir `down`.
- ⚠ **Skee Ball (090) is the owner's own build.** If that folder is overwritten again, RE-APPLY both fixes: the per-game payout in `endGame()` (it saves under `skeeball_target_pass_best`, so the old `skeeball_best` rule never fired) and the mobile peak-flick input — exact code in the 08-14 archive.
- ⚠ **A card must photograph the toy BEING PLAYED, not idle.** For a procedurally-generated toy, **SOLVE the scene** — Word Kraven's pose reads the DOM letters, fetches the toy's own `words.txt`, traces a real word with real PointerEvents and **holds the gesture down**. ⚠ Each run deals a different grid, so it is a **candidate generator**: render several, pick by eye. ⚠ Watch for state that reveals chrome (`showCta()` at three words pushes the shell out of the crop, so the pose stops at two).
- **Captures:** `gen-card.cjs` has flags for tools, element capture, posing (`--eval`) and `--motion`; poses in `scripts/poses/` drive the page through **real input only, never a debug hook**. ⚠ `.card__preview` shows only the vertical middle ~30% — check the rendered card, not the source image. ⚠ **`--at` counts from AFTER the `--eval` promise resolves, not page load** — for a mid-action shot leave the last gesture **un-awaited** (`scripts/poses/chord-harp.js`). Transient HUD captions are hidden by default; `--show` restores the ones that ARE the toy's identity.
- **Verification gotchas:** capture canvas at `deviceScaleFactor: 1` (Playwright tears at 2); headless forces reduced-motion and throttles rAF (drive frames via `evaluate(rAF)`); sim vs wall time diverge — probe internal state, not timed screenshots; force-clicking hidden chrome hits the canvas underneath; `getByteFrequencyData` saturates — use `getFloatFrequencyData` on a tone's own partial bins; grep-clean temp debug hooks before commit.
- ⚠ **`[hidden]` HUDs:** an author `display:flex` on a fixed HUD outranks the UA's `[hidden]{display:none}` and paints over the intro panel — every hidden HUD needs `.hud[hidden]{display:none}`. Detect by flagging bare-`hidden` elements whose CSS sets a non-`none` `display`, then confirm in a browser (static matching over-reports). **Verify the reveal too.**
- ⚠ **INCIDENT — a missing comma in `assets/main.js` took out the ENTIRE gallery, site-wide.** main.js threw on load and **nothing after a throw runs, so every hub page rendered ZERO cards** while still returning 200 and looking normal. **Whenever `main.js` is edited, parse-check it:** `node -e "new Function(require('fs').readFileSync('assets/main.js','utf8'))"`. Caught only by driving the LIVE hub after deploy.
- **Gallery search ranks by relevance** (name ≫ slug ≫ category ≫ tag ≫ description ≫ NL blob ≫ substring), OR fallback, empty query scores 0 so browsing stays A–Z. ⚠ **Weights must stay far apart** — a name hit must beat any number of blob hits. ⚠ **Every field `normalizeHaystack()` includes must be scored in `scoreToken`, in the same edit**, or it silently degrades to A–Z.
- **Search visibility (08-04 audit):** crawl fundamentals healthy; IndexNow live (`node scripts/indexnow-submit.mjs` — ⚠ **re-run after adding a toy**; reaches Bing/Yandex/Seznam/Naver, **not Google**). ⚠ Sitemap fixes belong in `scripts/build-sitemap.cjs`; an output-only fix regresses on the next run. ⚠ **The ceiling on OPT search traffic is THIN CONTENT, not crawlability** (~470 chars of visible text per canvas toy) — **OPT is a share-and-word-of-mouth asset more than a search asset.**

## Shared-asset versions (bump uniformly)

`main.js?v=113` (8 pages) / `styles.css?v=117` (9 hub/store pages); **`tickets.js?v=26` across all 128 — keep it uniform** (the excluded `shuriken-night-visual-pass` sandbox stays on v=12 by design); `more-games.js?v=21` (42 pages); `share.js?v=6` (43 pages); `prizes.js?v=1`; store `store.js?v=6` / `store.css?v=7`.

**Featured art** — the home panel ROTATES bespoke key art, one of **32** toys per load, not always the newest. `assets/featured/<slug>.webp`, 1200x675, `cwebp -q 82`; sources in `assets/featured/_sources/`, kept out of the deploy by `.vercelignore`. The random-9 grid excludes `featuredTool` (not `newestTool`); the pool is art-only on purpose. The h2 is `.sr-only` when art is present, by owner's call (each image carries the game's logo) — I argued to keep it and was overruled; eyebrow is "Featured toy".
- ⚠ **Adding art is TWO steps** — drop the `.webp` in **and** add the slug to `FEATURED_ART` in `main.js`; the file alone does nothing.
- ⚠ **All featured URLs share ONE version string (`.webp?v=N` in `renderHomeHero`), so REPLACING any single piece means bumping N for all of them** — currently `?v=4` (bumped 2026-08-23 when the Skyscrapers piece was replaced). ⚠ **ADDING a new piece must NOT bump it**: a new file has no cached copies to invalidate and the bump needlessly re-fetches all 32. **The bump is for REPLACEMENTS only.**
- ⚠ **The featured media element also carries `data-slug`, so a card motif can bleed through the art** — the art branch must `removeAttribute("data-slug")` and set every background longhand inline, because the `[data-slug]` card rules sit ~700 lines further down `styles.css` and **beat `.home-featured__*` on source order at equal specificity.**
- ⚠ The art is a CSS background painted after the registry fetch, so it **cannot be `rel=preload`ed** — likely the home LCP, a round-trip late; the fix, if it ever matters, is `<img fetchpriority="high">`.

## Standing exclusions and commit discipline

- **Never stage** `.claude/settings.json` / `.claude/settings.local.json`, `toys/shuriken-night-visual-pass/`, or `.DS_Store`. `git pull` before any commit; check `git status` for another session's working-tree state before staging (working-tree-only work would be destroyed by checkout/stash/clean).
- ⚠ **A repo-wide HTML sweep dirties `toys/shuriken-night-visual-pass/`** — another session's tracked, clean sandbox; exclude that path or `git checkout --` it afterwards. Two machines have also edited Shuriken Night itself concurrently: `git pull` before touching that toy.
- **Never run `scripts/sync-registry-paths.cjs`** — a one-off migration that sorts/corrupts the registry (`reference.md` wrongly lists it as routine). Register toys by hand (prepend, dir-form path) + `scripts/build-sitemap.cjs` (safe, read-only on the registry).
- `/archive/` is legacy: intentionally on old unversioned favicon refs, so sweeps must exclude it (BSD grep gotcha: paths lack `./`, so `grep -v /archive/` can fail to match).

## To continue on another machine

This doc lives in the repo (`.ai/memory/`), so it syncs between devices via `git pull`, and it is the authoritative current-state bridge. (A richer running log lives in the *global* `~/.ai/memory/PULSE.md`, but that is machine-local and may NOT exist on every device — trust this file when they disagree; `project.md` here is pre-2026-06 and stale.)

1. `git pull` (remote is authoritative; everything above is pushed).
2. Run locally, no build/deps: `python3 -m http.server 8000` from repo root.
3. Playwright only if needed: `npm install && npx playwright install chromium` (`node_modules` is gitignored on purpose).

## Open next steps

- **Image share has never been tried on a real phone** — the native file-share path is the whole point and is unverified outside headless.
- **5 pages ship `share.js` with nothing to mount into** (chord-harp, glass-harp, moon-phase, golden-hour, typing-speed) — pre-existing dead includes; each needs a `[data-opt-share]` host placed by hand.
- **3 toys carry leftover debug hooks on main:** `window.__dom`, `window.__pin`, `window.__steady`.
- **Jenga's one remaining bug** (see above).
- **Chess audio has never been heard** — level is measured at 0.20 peak, character never is. Same for the ladder: verified engine-vs-engine (10-0 / 10-0 / 8-2 / 8-2 by rung), never against a human, so the ~elo labels are estimates.

### Closed — do not re-open or offer

- ✅ **RETRO-TUNING IS CLOSED (owner, 2026-08-21):** *"As far as sound and play on any of the existing toys, I don't need that. We move forward from here."* The whole owed-ears + feel-play-test list is gone — 108-111 audio, Rain Stick `gyroSign`, Bowling, Accretion, Air Hockey, Darts, Skee Ball, all of it. **New toys are still built to the full bar; this closes going BACK, not the standard.**
- ✅ **The audio backlog is CLEARED** (owner, 2026-08-06) across all ten outstanding toys — a blanket "no complaints", **NOT** a per-toy tuning pass. ✅ **Pinball play-tested and approved 2026-08-21** (*"pinball look and sounds good"*), visuals AND audio. In all three cases, **a specific complaint later is new information, not a contradiction.**
- **Do not re-open:** backfilling category-as-tag onto the 65 toys missing it (category is scored directly now); "tetris" anywhere in Accretion's name, slug, copy, tags or NL string (*Tetris Holding v. Xio*); "Rubik" anywhere in Twisty Cube's. **The keyword cost is intentional.**
- **Word Kraven (No. 112)** is the unlimited practice feeder for the daily at wordkraven.com (own repo, `brentspore/word-kraven`): practice only, no daily, no streaks, **no email capture**, two UTM-tagged CTAs, self-canonical. ⚠ **The countdown targets LOCAL midnight because that is what wordkraven.com keys its daily on** — if that flips to UTC, this flips with it or the banner lies.
