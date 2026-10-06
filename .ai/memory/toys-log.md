# Toys log

Per-toy ship records moved verbatim out of HANDOFF.md on 2026-10-05 (owner-approved restructure). **Reference, not a handoff:** open the section for the toy you are touching; its toy-specific traps live here. Cross-toy rules stay in HANDOFF.md. Newest first. Not imported by CLAUDE.md.

## No. 136 Backgammon — built 2026-10-06, local, NOT yet pushed

**`toys/backgammon/`** — backgammon against six café regulars at a table by the sea (BACKLOG "Deep #2"). Owner picks
(2026-10-06): world **Seaside café**, **a match to 5** (gammon 2, backgammon 3), **doubling cube OFF with a start-panel
switch** (Crawford enforced when on), extras **Hint and Pip count** only (no undo, no replay, by choice). Built by one
builder agent from the Checkers template; registration done after. Files: `core.js` (rules, page + Worker), `engine.js`
(Worker: 1-ply / 2-ply expectimax personalities + cube), `audio.js`, `script.js`. Regulars, easiest first: Mina (the
owner's granddaughter), Teo (mends nets), Auntie Despina (almond cakes), Captain Marek (the ferry), Mr. Aris (retired
schoolmaster), Madame Noor (runs the café). Keys: `backgammon_beaten` (ticket rule dir `up`, rule only),
`backgammon_defeated|wins|losses|cube|foe|sound`. **Owner's key art** (`_sources/backgammon.png`, `TITLE` 0) is in the
featured pool and is the card (`cards/backgammon.webp`) and share image (`og/backgammon.jpg`); the builder pulled the
scene's palette toward it. `scripts/poses/backgammon.js` stays as the gameplay-still pose. Registered: registry,
sitemap 139, NL phrase ("tavla", "tavli", "nardy", "shesh besh"...), card CSS + `:not()`, og-gen entry (unused while
the art is the share image), ticket rule, cross-promo in all FOUR lists (tagline "A match to 5 by the sea", a board +
die favicon). Tickets pill clears the back link in WebKit at 375x667.
- **Move generator verified like perft** against an independent brute force: 3,000 random positions x 21 rolls,
  3,370,755 plays, 0 mismatches; opening 3-2 = 17 distinct plays (the published count). Larger-die and part-playable
  doubles rules checked.
- **Ladder measured with duplicate dice** (same rolls both seats): every rung beats the one below, 52-61% of games;
  Marek over Despina is the narrowest (~5 standard errors). ⚠ More 2-ply candidates did NOT separate rungs (top 3 vs
  top 8 was a coin flip); spacing comes from temperature and cruder evaluations. ⚠ A random-move bot loses even to
  Mina 0-6: judge the ladder with the hint-following bot. Engine vs engine only, never against a human.
- **Dice fair:** 6M rolls, face chi-square 3.94 (critical 11.07), doubles 0.1665.
- ⚠⚠ **No input while a play is in progress.** A tap in the pause before an auto-played forced remainder moved a
  checker, then the stale queued play landed too and corrupted the board (1132 pips). Input is locked for the whole
  chain and any step the board no longer allows is refused (and logged as a console error so tests catch it).
- ⚠ Full-resolution canvas pattern fills for the water caustics cost 90ms a frame at 2x; a third of the resolution,
  every other frame, brought it to 17ms.
- ⚠ Highlights must be loud at this camera: a gold gradient with a glowing edge, a ghost checker where it lands, a gold
  ring on the lifted checker (0.26-alpha fills vanished on the ebony points).
- **Audio, measured offline** (7 renders each): checker place 0.30, clack 0.27, hit 0.25, full dice throw 0.33, cube
  0.26, match win 0.27, select 0.10 (soft on purpose); sea bed RMS 0.019. No NaN. **Never heard.**

## Useful tools round, No. 129-135 — shipped 2026-10-04 (`461b78a`), live

Owner: *"I want more tools but they always seem to come out the same"*, then *"I like all 7 tools ideas, build them
all"* (BACKLOG "Useful tools round"). The fix was a different INPUT and an output you USE, each with its own signature
object. Built by seven parallel builder agents, each writing only its own `tools/<slug>/` (+ `scripts/poses/<slug>.js`
and `assets/cards/<slug>.png`); shared registration done after, serially: registry (newest first, Tuner on top),
sitemap 138 urls, NL phrases, card CSS + `:not()` chain, og-gen entries (new `imgW`/`imgH` motif helpers for non-square
cards) + `og/<slug>.png`. Tools stay OUT of the cross-promo and carry no ticket rule (no scores). Every page: tool
chrome copied from Moon Phase, `track.js`, test hook only under `navigator.webdriver`, zero console errors and no
overflow on Chromium 390 + WebKit 375 in both themes (28-page smoke test). **None of the sound has been heard, and
nothing touching a mic, a motion sensor, location or iPhone background audio has run on a real phone.** **Live-verified**
(same smoke test against onepagetoys.com: all seven pages, cards and share images 200, 28 page checks clean, 14 of 14
search phrases rank the right tool first, All Toys newest panel shows Tuner); IndexNow accepted (138 urls).
- **No. 135 Tuner** (`tools/tuner/`): mic tuner. Backlit cream needle meter, a three-band strobe that stands still in
  tune, rosewood headstock pegs that play reference tones (exactly tuned Karplus-Strong, allpass solved at the note's
  frequency; bowed tone for violin family), presets for guitar (5 tunings), bass 4/5, uke, violin, viola, cello,
  chromatic pitch pipe, A4 415-466. `pitch.js` (pure detector) tested on 13,008 frames B0-E6: <1 cent clean, <3 noisy,
  zero octave errors; tuned a full guitar end to end through Chromium's fake mic. ⚠ The tuner hears its own reference
  tones (echo cancellation off), so it ignores input 1.3s after a peg tap. ⚠ A fake mic in Playwright needs
  `permissions: ["microphone"]` on the context or getUserMedia hangs. ⚠ Remove only the MEAN from a short window,
  never a fitted line (bent B0 by 11 cents). Keys `tuner_kind|tuning_guitar|tuning_bass|ref|pipe_oct`.
- **No. 134 Sleep Sounds** (`tools/sleep-sounds/`): eight mixable synthesized layers (brown/pink/white noise, rain,
  box fan, waves, fire, far thunder) from an AudioWorklet (`engine.js`), six presets, 8s fade-in, sleep timer that
  fades over a quarter of its length, Dim mode, a night window that follows the mix (lightning flashes a beat before
  each roll). No loop anywhere (max autocorrelation 0.07 out to 140s). Presets measure -30 to -34 dBFS RMS at the
  quiet default. ⚠⚠ **iPhone background audio:** routing Web Audio through a MediaStream into `<audio>` does NOT help;
  what works (iOS 17.5+) is `navigator.audioSession.type = "playback"` plus a looping near-silent `<audio>` started in
  the tap, with every event scheduled on the audio thread (page timers stop when locked). Unverified on a real phone.
  ⚠ Normalize a convolver IR to unit ENERGY; DynamicsCompressor adds ~3.5dB auto makeup; a brickwall compressor still
  passed 1.09 peaks, so a WaveShaper soft clip follows it. Share = `#mix=` link. Keys `sleepsounds_*`.
- **No. 133 Settle Up** (`tools/settle-up/`): group trip splitter. Receipt tape for the expenses, a felt card table
  with chip tokens and coin-carrying arrows for the payments, an "ALL SQUARE" stamp when the last one is ticked off.
  Equal or by-shares splits in integer minor units, 20 currencies, the TRUE minimum number of payments (bitmask DP
  over zero-sum groups, greedy past ~18 people). **The whole trip lives in the URL hash** (`#t=1` + base64url of
  deflate-raw JSON, `#t=0` fallback). ⚠ A settlement recomputed from scratch reshuffles the remaining payments when one
  is ticked off; ticked payments are matched against the plan computed without them. ⚠ Leftover cents are rotated by a
  hash of the expense's own content, not its position, or deleting one expense moves a cent in another. No share row
  (its own Share/Copy link buttons). Keys `settleup_recent|sound`.
- **No. 132 Recipe Scaler** (`tools/recipe-scaler/`): paste a recipe; it becomes a ruled index card with highlighted
  amounts that roll like an odometer; scale by servings, a multiplier, or "I only have 3 eggs" (tap a line, a sticky
  note asks). Kitchen rounding, US / metric with a 57-ingredient density table of our own numbers (AP flour 125g/cup),
  oven temps, fractional-egg advice. `scaler.js` 260 node checks. "litre"/"gramme" exist ONLY as parser vocabulary.
- **No. 131 Level & Ruler** (`tools/level-and-ruler/`): brass machinist's level on edge, bull's-eye flat, from the
  gravity vector; locks within 0.2 deg with a detent click; two-position calibration; "raise the left end 3/16 in
  over 24 in". Steel rule with caliper jaws, calibrated by a relative drag against a bank card (a finger on a plastic
  card does not register on glass). ⚠⚠ **iPhone reports `accelerationIncludingGravity` with the OPPOSITE sign to the
  spec/Android**; guessed by platform, then decided by deviceorientation agreement. ⚠ WebKit throws on
  `new DeviceMotionEvent()`; tests use `document.createEvent("DeviceMotionEvent")` + `initDeviceMotionEvent`.
  Keys `level-and-ruler_*`.
- **No. 130 Sun Path** (`tools/sun-path/`): polar sun chart (today's arc with hour marks, both solstices, equinox),
  drag the sun to scrub time, a window/balcony/garden wedge with an obstruction height, the answer in words ("Sun on
  this window from 12:01 to 5:37 PM today... In December: ..."), monthly direct-sun bars, garden verdict, phone
  compass with a "line it up with the sun" calibration. 103 cities with IANA zones. Solar math matched NOAA's tables
  on 693 city-days within 0.8 min and USNO within 0.03 deg. ⚠ Near the Arctic Circle sunset must be the LAST downward
  crossing of the day. ⚠ `Intl` truncates to the minute: round, and sum durations from the rounded ends.
- **No. 129 Hearing Age** (`tools/hearing-age/`): pulsed pure tones climb from 8 kHz, a fine confirm pass, silent
  catch trials, result as kHz plus a playful ear age from published age-limit data, a phosphor scope and kHz ladder,
  challenge link `#beat=15200`, image share. Test path is a raw sine buffer, 60ms raised-cosine ramps, NO compressor
  or reverb, fixed -20 dBFS (energy below 12 kHz around a 16 kHz pulse: -118 dB). ⚠ An OfflineAudioContext only hears
  nodes still connected when rendering starts, so a level harness must stub `disconnect`. Key `hearingage_best`.
  **Two owner calls, unasked:** the 1 kHz volume check plays 10 dB under the test tones on purpose (matching them
  would crowd young ears near 15-16 kHz), and "mosquito tone" is used generically in copy, tags and keywords although
  "Mosquito" is also an anti-loitering device's brand name.
- **Shared change, `assets/share.js?v=7` (all 62 pages bumped):** on `/tools/` the pill says "Share this tool" /
  "Share your result" (never "Share your run"), the default text drops "Come play", and the caption-strip name stops
  at a colon as well as the dash (long tool titles ran into the domain). Sleep Sounds relabels its own to "Share this mix".
- ⚠ **`gen-card.cjs` hides generic class names** (`.controls`, `.readout`, `.status`, `.bar`, `.hint`, `.intro`), so
  a signature panel must not use them. `--size 1080` on a tool can land in its two-column layout; pass `--vw`.

## No. 128 Timber — shipped 2026-10-04 (`96ef508`), live (the old `jenga` branch, finished and renamed)

**`toys/timber/`** — a tower of 36 wooden blocks with real physics (vendored cannon-es, DECISIONS 2026-08-22). Orbit
(drag the table), zoom (pinch/scroll), drag a block along its own length to slide it out (either end, below the
highest complete level), then carry it onto the top, or tap a glowing slot (a level fills to three before the next
starts). Score = blocks moved; any block that falls ends it (see below). Owner (2026-10-04): **name "Timber"** ("TIMBER!" is the
fall's callout) and **"jenga" kept off every surface, hidden search keywords included** (trademark, the Tetris/Suika
rule). Keys: `timber_best` (ticket rule dir `up`, rule only), `timber_sound`. Registered everywhere in the working
tree (registry, sitemap 131 urls, NL phrase, card CSS + `:not()`, og-gen, ticket rule, cross-promo in all four lists:
five-second-game `3a8f7c5`, the-trail-game `8f6e75d`, word-kraven `c45fb55`, all four DEPLOYED bundles carry it).
**Live-verified**: a block pulled and placed by mouse on onepagetoys.com, newest panel, search ("block tower"),
featured rotation; IndexNow accepted. The `jenga` branch (`0d01d86`) was deleted locally and on GitHub.
- **What "finishing" was** (the branch was built in the Steady Hand era and well under the bar): the stylesheet had
  been copied from Steady Hand (its HUD stacked into a tall pill over the tower; rewritten); the level counter read 13
  for 12 levels; a pull needed ~430px of finger travel (now 1:1 along the block's on-screen axis, either direction);
  the held block parked IN FRONT of the tower and hid it (now it floats beside the top, turned like the slots, as far
  right as fits on screen: a fixed offset put it half off a portrait phone); the
  callout sat on the slots (now low); the test handle was public (now `navigator.webdriver` only, `window.__timber`).
- **Renderer rebuilt** (raw WebGL, still hand-written): hardwood with annual rings around a pith OUTSIDE the block, so
  each block has its own figure (arcs on sides, stripes on tops, rings on ends), grain faded by `fwidth` so it never
  shimmers; rounded-edge bevel plus a dark seam so blocks separate; one warm lamp (`LAMP`) plus a warm fill and
  hemisphere ambient, a gentle highlight roll-off; a walnut table in the lamp's pool that fogs into the room (no
  horizon line); soft shadows = four planar passes from jittered lamp positions with a STENCIL so overlaps never
  double-darken; the camera fits the tower and follows its top as it grows.
- ⚠⚠ **Placement reworked (owner, 2026-10-04: "the put it on top is just one click and sometimes it's a weird
  placement")** — shipped `dd5bfb9`, live-verified (the placement test passes against onepagetoys.com). Three causes, three fixes: (1) **the slots were computed for a PERFECT tower**
  centered on the table, so once the real one had drifted or twisted a block went down centimeters off the real top;
  `freeTopSlots()` now takes a part-built level's center and angle from its own blocks (`levelFrame`), and a new level
  from the level below, turned 90. (2) **A tap took whichever slot center was within 90px**, and the slots are only
  25-35px apart on screen, so it often took the wrong one and an orbit tap could place the block; now a tap places only
  when the ray hits a slot's box (`slotUnderRay`, padded in length and height, not across). (3) **It teleported**; now
  you CARRY it: press the floating block (or a slot) and drag, it rides a plane just above the top (46px above a
  fingertip on touch), snaps into line over the nearest free slot within 0.32m with only that ghost lit, and on
  release glides there and lowers in (320ms, `G.anim`, instant under reduced motion) before the physics takes it.
  Verified headless with real input, desktop mouse + phone touch, motion on and off: carry, tap-on-slot, tap on the
  block or table does NOT place, seven moves in a row across three levels, every block within 1.3cm of its slot and
  exactly one width from its neighbors, no false game over, no console errors. ⚠ A harness that projects a slot right
  after a pull aims wrong: the camera eases up for ~1s when a block comes out (placing mode frames the top higher).
- ⚠⚠ **A tipping tower fell ASLEEP mid-fall** and hung leaning off one block: a topple starts slower than the sleep
  speed limit. During play any block tilted more than ~2 degrees is woken every frame (blocks on their sides are left
  alone). Sleep still keeps a standing tower dead still.
- ⚠⚠ **Any block that falls ends the game** (owner play-test 2026-10-04: "one fell off the top and it still thinks
  it's on top"). It used to end only when THREE blocks reached the table, so a single block sliding off the top lay
  there while the game still counted it on the top level (wrong free slots, wrong level count). `offTower(b)`: dropped
  more than half a level below where it was built, or 1m off the footprint. Half a second later the game counts what
  is MOVING (off the tower, faster than 0.25 m/s, or tipped past ~20 degrees): four or more = "TIMBER!" and "It came
  down"; fewer = "dropped one" and "A block came off". ⚠ Counting only landed blocks misread a real topple as a
  single drop, because the new rule fires at the FIRST block's drop.
- ⚠ **Test the visible END of a block, not its center**: a middle block's center is inside the tower, so a pick there
  hits the block in front (a test "pulled" side blocks of other levels and the tower rightly stood).
- **Audio rebuilt to the house bar**: knocks come from REAL contacts (`beginContact`, impact speed scales the hit,
  panned by screen position, each block throttled to one knock per 55ms, max ~46/s), maple bar modes 1 : 2.76 : 5.40
  over a table or tower thump, a continuous grainy scrape that follows pull speed with stick-slip ticks, a lumpy low
  thump under the collapse, small room IR, compressor + brickwall. Measured (real physics, voices scheduled onto an
  OfflineAudioContext timeline): place 0.19-0.26, pull+lift 0.09-0.15, a full collapse 0.55. Scrape raised after it
  measured near-silent. Never heard.
- ⚠ **Headless screenshots of WebGL can LOOK flatter than the frame while being pixel-identical**: an hour went into
  "fixing" a difference that measured as the same RGB at every probe. Read pixels (`gl.readPixels` inside a rAF after
  the toy's frame, or decode the PNG) before believing your eyes on a downscaled screenshot.
- **Owner's key art** (2026-10-04, the MID-COLLAPSE piece, owner's pick over a standing-tower version on the desktop;
  source `_sources/timber.png`, `TITLE` 0) is in the featured pool (40) and is the card (`cards/timber.webp`) and share
  image (`og/timber.jpg`, 167KB) via `build-art-assets.cjs`. ⚠ The repo copy appeared at 11:38 from an unknown process
  (not this session, and not the desktop file); the owner confirmed it is the one to use. `scripts/poses/timber.js`
  (real pointer events, a block caught half way out) stays as the gameplay-still pose. Verified headless: pull + place
  by mouse, toppling by pulling two level-2 blocks (TIMBER callout, end panel, share line), phone 390x844, WebKit 375x667.

## No. 127 Checkers — shipped 2026-10-03 (`9993076`), live

**`toys/checkers/`** — American checkers (English draughts) on a worn folk-art board on a cracker barrel at the back of
a country store, the BACKLOG "Deep #1" pick after the admin data showed deep games hold people (Chess 5:50, Meld 5:37).
Owner picks: look **Country store**, captures **official + a toggle** (forced jumps by default, "Jumps are optional
(house rules)" switch on the start panel, `checkers_forced`), extras **Hint** and **Replay at the end** (no undo, no
two-player). Five files: `core.js` (rules, loaded by page AND worker), `engine.js` (Worker), `audio.js`, `script.js`,
`styles.css`. Keys: `checkers_beaten` (ticket rule dir `up`, rule only), `checkers_defeated`, `checkers_wins|losses|
draws`, `checkers_side` (black moves first; the player picks), `checkers_forced`, `checkers_sound`. Registered
everywhere in the working tree: registry, sitemap (130 urls), NL phrase, card CSS + `:not()`, og-gen entry, ticket rule,
cross-promo in all FOUR lists (five-second-game `d22be55`, the-trail-game `36c7493`, word-kraven `45d43c5`; all four
DEPLOYED bundles carry it). **Live-verified**: phone game plays and the engine replies, `/toys/checkers` redirects to the
slash, All Toys newest panel, search ("draughts"), featured rotation; IndexNow accepted.
- **Rules verified by perft**: 7 / 49 / 302 / 1469 / 7361 / 36768 / 179740 / 845931 / 3963680 through depth 9, plus spot
  checks (men never capture backward, crowning ends the move, a king's capture loop may land on its own start square).
- **Six regulars** (Junie the storekeeper's girl, Hal the mail carrier, Miss Odette the schoolteacher, Jasper Quill the
  traveling salesman, Doc Whitlow, Old Silas the county champion), each a depth/time/temperature/blunder setting plus
  symmetric eval weights. **Ladder measured engine-vs-engine, adjacent pairs, material-adjudicated at a 200-ply cap**:
  Hal > Junie 6/6, Odette > Hal 5/6, Jasper > Odette 6.5/8, Doc > Jasper 3.5/4, Silas > Doc 4/4. ⚠ Jasper first tied
  Odette 3-3; fixed by Odette depth 5 (was 6) and Jasper depth 9 / temp 9. Old Silas converts 2K v 1K out of the double
  corner and 3K v 2K; Doc can run out the 40-move clock on 2K v 1K, which is fine one rung down.
- ⚠ **The capture search has no stand-pat when jumps are forced** (a pending capture is compulsory, so the position is not
  quiet); with jumps optional it is a normal quiescence. Junie searches without it on purpose.
- ⚠ **The engine needs the game history for repetition** (`past`: positions since the last irreversible move). A test
  harness that omitted it watched a strong player blunder a won ending into a repetition loop.
- ⚠⚠ **Selection bug worth remembering: read "was it already selected?" BEFORE selecting.** Pointer-down selected the
  checker and then recorded `wasSel`, which was therefore always true, so the pointer-up deselected it: no tap move ever
  registered. Keyboard play hid it.
- ⚠ **Replay steps end when the captured checkers LAND, not when the hop ends.** A Forward click during the flight
  started the next step and the old step's cleanup then wiped the board mid-hop (a null `mover` error). Steps now carry a
  token and a busy flag; clicks during a step are queued.
- **Crowning is physical**: the other side hands you one of YOUR captured checkers off their stack and it drops on top
  (from above if they hold none), then the counter bell rings and "King me!". Captured stacks on the barrel head: yours
  near right, theirs far left; counts are incremental live and snapshotted per ply for the replay.
- **Look**: perspective camera (`TILT` 0.68) like Chess, everything static baked once (room with shelves, potbelly
  stove, lamp, barrel with staves and hoops, painted board with "CHECKERS" lettered flat on the rim); per frame only
  marks, checkers, stove flicker and dust. Checkers are baked sprites (fluted rim, two cut rings, lacquer, gilded crown).
- **Audio, measured** (OFFLINE render, see below): place 0.23, crown 0.24, win 0.28, lose 0.27, draw 0.28, stack clink
  0.13, deny knock 0.12, hint 0.10, slide 0.10, select 0.07 (soft on purpose); bed RMS 0.024. No NaN. Never heard.
- ⚠⚠ **Headless real-time audio WAS dead on this Mac on 2026-10-03** (working again 2026-10-04: the Tuner build ran a fake mic through a live AnalyserNode): `ac.currentTime` stays at 0.005 even for a bare
  `new AudioContext()`, so every analyser reads 0.000. It worked earlier the same day (an output-device change is the
  likely cause). Measure instead by replacing `window.AudioContext` in an init script with an `OfflineAudioContext`
  whose `currentTime` is a getter you set per slot, scheduling each voice in its own 2.6s slot, then `startRendering()`
  and take peaks per slot (`scratchpad/ck/levels-off.cjs` pattern).
- Verified headless: full games through real clicks and drags at 1280 and 390 wide (hint-driven bot: wins, multi-jumps,
  4-8 crownings, drags, replay with 8 rapid Forward clicks landing exactly on move 8), WebKit at 375 (tap highlight off,
  no overflow, a tapped move plays), search ("checkers", "draughts", "king me", "board game"), All Toys newest panel.
- **Owner's key art** (2026-10-03, `featured/checkers.webp`, source `_sources/checkers.png`, `TITLE` 0) is in the featured
  pool (39) and, per DECISIONS 2026-10-03, is the gallery card (`cards/checkers.webp`) and share image
  (`og/checkers.jpg`, 287KB), built by `build-art-assets.cjs`. The owner replaced a first piece (a marble board in a
  study, which did not match the toy) with one of the country store itself: hanging CHECKERS sign, stove, lantern,
  the green-and-mustard board on the barrel. Never deployed before the swap, so the featured `?v` was not bumped.
  `scripts/poses/checkers.js` (hint-driven real input vs Jasper) stays as the gameplay-still pose if the art is dropped.
- Test handle `window.__checkers` (state + square centers) exists only under `navigator.webdriver`.

## No. 126 Decant — shipped 2026-10-03 (`da30edf`, art `e74d95f`), live

**`toys/decant/`** — the water-sort puzzle (BACKLOG "Puzzle #1", working title Color Pour), built as an
**apothecary's shelf of glowing potions** by candlelight. Owner picks (2026-10-03): look Apothecary potions, all
three twists (hidden layers, bigger boards later, a spare bottle), name Decant. Reference checked first (DECISIONS
2026-10-03): App Store screenshots of Water Sort Puzzle (IEC), Magic Sort! (Grand Games), Tripledot, Water Match.
Tap a bottle, tap another: its top potion pours across, only onto the same color or into an empty bottle, as much
as fits. 120 levels: 2 to 12 colors, clouded "?" layers from level 16 (revealed when they reach the top), 6-layer
bottles from level 51. Every potion carries an alchemical mark (colorblind safety). Files: `rules.js` (rules +
solver, shared with the builder), `levels.js` (GENERATED by `node scripts/build-decant-levels.cjs`, ~4s),
`audio.js`, `script.js`. Keys `decant_level` (ticket rule dir `up`), `decant_best`, `decant_tips`, `decant_sound`.
**Live-verified:** levels 2 and 16 played to "Shelf sorted" on onepagetoys.com, home featured art + newest panel, search ("decant", "water sort", "potion"), all four DEPLOYED cross-promo bundles, IndexNow accepted. Registered everywhere (registry, sitemap, NL phrase, card CSS + `:not()`, og-gen, ticket rule, all four
cross-promo lists with a corked-bottle favicon). **Owner's key art** (2026-10-03, `featured/decant.webp`) is in the featured pool, and per DECISIONS 2026-10-03 it is also the gallery card and share image (`build-art-assets.cjs`, `TITLE` 0). `scripts/poses/decant.js` (level 22 caught mid-pour) stays as the gameplay-still pose if the art is ever dropped.
- ⚠⚠ **The SPARE BOTTLE IS RESCUE-ONLY** (owner, after asking "is it too easy with the empty bottle?"). Measured
  with a casual-player sim (no undo): the two starting empties are needed (one empty: 0% everywhere) and the game
  is not easy (80% at level 6, 19% at 25, 0% from 65), but a FREE spare took level 25 from 19% to 82%. So "+ Bottle"
  stays locked until the solver proves the shelf can't be sorted from here (or no pours are left); undoing out of
  the dead end locks it again. Dead-end checks take ~1ms even on 12x6 shelves, so they run after every pour.
  The solver's verdicts matched an exhaustive search on 48 of 48 wrecked shelves.
- ⚠⚠ **A hint must follow ONE plan.** Re-solving from scratch each time can start a different plan and pour
  straight back: a test following "first move of a fresh solve" ran 462 pours without finishing. `nextPour()` keeps
  the plan with the exact state at each step and only re-plans when the player leaves it. All test levels now finish
  via the game's own Hint key (16 in 28 pours, 51 in 55, 90 in 64, 120 in 82).
- ⚠ `R.solve` returns null for BOTH "unsolvable" and "gave up"; `R.lastCapped` tells them apart. Never treat a
  capped search as a dead end.
- **Liquid is drawn by volume**: a layer's top is where the area inside the bottle below it reaches its share,
  measured in screen space, so a tilted bottle keeps every surface level and the potion runs to the neck.
- ⚠ Badge docking: on a phone the tip jar / full screen go top-left (they sat on the top row of bottles); in
  landscape top-left side by side. ⚠ Those rules must come AFTER the global docking rules at the bottom of
  `styles.css`: same specificity, later wins (a landscape override placed earlier silently lost its `top`).
- ⚠ A pending "Shelf sorted" panel timer is cleared on `startLevel`, or it pops over the next level.
- **Audio, measured** (analyser before `destination`, real play): pours 0.19–0.25 (stream + the receiving bottle's
  air column rising as it fills + glugs from the emptying bottle), pour that corks 0.23, reveal 0.19, clink 0.11 →
  raised ×1.4, hint 0.09, clear 0.20, lift 0.05 (deliberately soft), room bed 0.03. No NaN. ✅ **Owner-approved 2026-10-03: "sounds good".**
- Test hook `window.__decant` exists only under `navigator.webdriver` (tests and the card pose read positions; every
  move they make is real input).

## Admin page `/admin/` — shipped 2026-10-03 (`da30edf`), live, owner signed in and seeing real data

Owner: *"I want a simple admin tracking page so I know what toys people use … protected by a login."* He chose a
custom page over Looker Studio. **The site's first server code** (DECISIONS 2026-10-03). **Live-verified:** `/admin/` shows the not-set-up notice listing the four missing settings, `/api/admin?op=session` answers with `demo:false`, stats without a sign-in → 401, `api/_admin.js` and `scripts/` are not served (404), responses carry `no-store` + `noindex`.
- **Tracking fix that ships with it:** `assets/track.js?v=1` on all 125 toy and tool pages sends `toy_play`
  `{toy, toy_kind}` ONCE per page view, the first time a visitor touches, clicks or types on the toy (not the
  back link, tip jar, full screen, tickets, share, More Toys, Tab or modifier keys; nothing under
  `navigator.webdriver`). Before this only ~17 toys sent any "started" event, under five names. Opens = GA page
  views; time = GA's own `userEngagementDuration`; shares = the existing `share` event. **Plays exist only from the
  day this ships** (`TRACK_SINCE` in `admin/admin.js`: update it if the push lands on another day).
- **Pieces:** `admin/` (index.html, admin.css, admin.js: Geist, light/dark), `api/admin.js` (`?op=session|login|
  logout|stats`), `api/_admin.js` (Google ID-token check, signed cookie, GA4 Data API via a service-account JWT,
  5-minute cache), `scripts/admin-dev.cjs` (local server; `ADMIN_DEMO=1` for fake data and a fake sign-in),
  `scripts/test-admin.cjs` (23 offline checks of the real paths: forged/expired/wrong-app/non-admin tokens,
  tampered cookies, path merging, JWT signing).
- **Dashboard:** range 7/28/90 days; tiles for visitors, toy opens, plays (+ % of opens), average time per
  visitor, shares, and "right now" (GA realtime); a daily-visitors chart with a hover readout and a table view;
  every toy (top 25, "Show all"), sortable, filterable: opens + change vs the previous period, plays, play rate,
  average time, shares; where visitors come from, devices, countries, and the non-toy site pages.
- **Owner setup DONE 2026-10-03** (Data API enabled, service account as GA Viewer, OAuth web client with origin
  `https://onepagetoys.com`, the four Vercel env vars in `reference.md`); first real sign-in and report worked. To add
  local sign-in later, add `http://localhost:8125` as an authorized origin on the OAuth client.
- ⚠⚠ **Never name a GA event parameter `source`, `medium` or `campaign`.** GA4 reads them as the visit's traffic
  source: the hub's `toy_launch` sent `source: "gallery"` (also `home_featured`, `all_toys_newest`, `surprise_me`),
  and the first real dashboard listed those as where visitors came from, re-filing Google and Facebook visits under
  our own buttons. Renamed to `placement` (`main.js?v=129`). Data before the rename stays polluted.
- ⚠ **Vercel served a folder's page WITHOUT adding the trailing slash** (`/admin` and `/toys/decant` both returned 200
  with the page), so relative asset paths resolved one folder too high and the page loaded unstyled and dead (owner hit
  it on /admin). Fixed site-wide 2026-10-03: **`vercel.json` `"trailingSlash": true`** 308s every extensionless path to
  its slashed form; files with an extension (`.js`, `.xml`, `.txt`, images) are untouched. ⚠ **It redirects the API
  too** (`/api/admin` → `/api/admin/`), which still reaches the function (GET and a POST through the 308 both tested on
  the preview), so `admin/admin.js` calls `/api/admin/` directly to skip the hop; `admin-dev.cjs` accepts both. The
  admin page also keeps absolute asset paths as a second guard. ⚠ nginx in `docker/` already redirects folders this way.
- **"What to do next" banner (2026-10-03, owner request), written by Claude:** `?op=advice&days=N` sends the
  dashboard's numbers (top 60 opened toys with names/descriptions, totals, daily visitors, sources, devices,
  countries) to `claude-opus-5-5` with a brief on the site's goals, its levers, the no-monetizing rule and the known
  data quirks (plays only since 10-03, the hub labels that posed as sources, the owner's own test visits), and gets
  2-4 recommendations back as JSON via **structured outputs** (`output_config.format` json_schema, effort medium,
  max_tokens 8000). ⚠⚠ **Opus 5.5 always thinks, so it REJECTS forced tool calls** (`tool_choice` type `tool`/`any`:
  "not supported for this model"; only `auto`/`none`), and thinking counts against `max_tokens`. The answer is the
  `text` block after the `thinking` block. ⚠ An org-wide Anthropic key needs a workspace: the owner swapped in a
  workspace-scoped key (the error names the `anthropic-workspace-id` header otherwise). ~6k tokens in, cents per call. Cached six hours per range per
  warm function; "Rewrite" asks again (min one minute apart). Needs `ANTHROPIC_API_KEY` in Vercel (optional: without
  it the banner says how to turn it on; local demo without a key shows sample text). `vercel.json` gives the function
  120s and bundles `tools-registry.json` (`includeFiles`). Tested: 31 offline checks (Claude faked), a real call with
  a fake key reaches Anthropic and its error shows on the page. Shipped `da9525f`, key set in Vercel (Production);
  the first REAL write-up is unverified (it needs the owner's sign-in). ⚠ The prompt refers to "the owner", never he/his.
- ⚠⚠ **With nobody on the site, GA's realtime report returns `totals: [{}]` (a total with no values)**, and reading
  `metricValues[0]` off it took the WHOLE dashboard down ("Cannot read properties of undefined (reading '0')"; owner
  hit it 2026-10-03 at a quiet moment; the admin page itself sends no GA hits, so the owner looking does not count).
  `liveNow()` now treats the live count as optional and can only come back empty. The handler now `console.error`s
  every 500 with its stack, so `vercel logs -p one-page-toys --scope mightyarmy --environment production -x` shows the
  line next time (before, the error was returned to the page and never logged).
- ⚠ Never commit the JSON key. ⚠ The one piece that cannot be tested offline is Google itself: the first real
  sign-in and the first real report are the live test.

## No. 125 Jettison — shipped 2026-10-03 (`bcf638e`), live

**`toys/jettison/`** — a color block puzzle in a zero-g cargo bay (owner picks: drag movement, no clock, zero-g
cargo bay look, the name). The hold starts PACKED with colored modules; drag one and it follows your finger a
cell at a time through whatever space there is; drag it into an airlock of its own color, at least as wide as it
is, and it is jettisoned and drifts off into space. Clear the hold in as few moves as you can (one drag = one
move, par is exact). 56 levels in 8 stages (First out, Fit, Clear a path, Make room, Odd holds, Jams, Deep hold,
Expert), up to 7x9 with 8 modules to drag aside. Files: `rules.js` (shared by game, hint worker and builder),
`levels.js` (GENERATED by `node scripts/build-jettison-levels.cjs`, ~4.5 min, never hand-edit), `hint-worker.js`,
`audio.js`, `script.js`. Keys `jettison_level` (ticket rule dir `up`), `jettison_best`, `jettison_tips`,
`jettison_sound`. Registration (registry, sitemap, NL phrase, card CSS + `:not()` chain, og-gen entry, ticket
rule, all four cross-promo lists), card (`scripts/poses/jettison.js`, level 38 at its first jettison, cropped so the
exit sits mid-height where the gallery band shows it) and OG. **Live-verified:** levels 1, 13, 33 and 40 cleared at par
by mouse on onepagetoys.com, All Toys newest panel shows it, search finds it ("color block puzzle", "airlock",
"traffic jam"), Jettison is in all four DEPLOYED cross-promo bundles (siblings `2e170c8` / `7217d4a` / `98f019c`),
IndexNow accepted. ✅ **Owner play-tested on a phone and approved 2026-10-03** (*"all 3 are great"*, with Meld and Trench Runner Cinematic): drag feel, difficulty curve, sound.
- ⚠⚠ **The first build was the WRONG GAME and was thrown away** (owner: *"that wasn't it at all. look at the
  reference"*). The BACKLOG research had read the reference from fan sites as glide-until-stopped on a sparse tray.
  It is drag-anywhere on a packed board. DECISIONS 2026-10-03: check the reference itself first.
- **Owner's key art** (2026-10-03, `assets/featured/jettison.webp`, source `_sources/jettison.png`) is in the
  featured pool and the All Toys newest panel. ⚠ **Doors redesigned the same day, `4e648be`, live** (owner: "kinda hard to see the
  doors"): the first doors were dark slots with a thin colored outline. Now, after the key art: two leaves in the
  lock's own color, lit from within, with the glyph and white block arrows out, in a glowing neon frame, filling the
  full hull depth (`BT` 0.5 to 0.6, so cells are ~3% smaller). Card re-rendered (`cards/jettison.png?v=2` in
  `styles.css`) and OG regenerated. ⚠ Any test harness that rebuilds the layout uses `L.W + 2*BT + 0.3`.
- ⚠ **The drag model can never get stuck, which made the whole thing simpler.** A parked move can always be
  dragged back, and jettisoning only frees space, so no state is ever unwinnable (no stuck detector, no rewind)
  and taking any jettison on offer is always right. Par = modules + fewest parking moves, found by a
  breadth-first search over parking moves with every available jettison taken after each one (`R.solve`). The
  hint needs no search when a jettison is on offer; otherwise the worker solves from the current position.
- ⚠ **Levels: random packed tiling, then color.** Easy stages color by PEELING (take modules out one at a time,
  each colored for the lock it left by: zero parking needed). Later stages color at random among locks each
  module fits, reject any hold where a module could not leave even an EMPTY hold (cheap), then solve with a
  60k-state cap and keep holds whose parking count suits the stage. Every kept line is replayed (`verify`).
- ⚠ **Irregular holds** (notches, U, H, interior holes): the hull is drawn by offsetting the hold's own outline
  loops (`loopsOf` + `tracePath` with a negative inset), and airlocks can sit on INNER walls (`gate.line`). ⚠ A
  lock needs open space behind it two cells deep and a cell clear either side, or the hull drawn into a narrow
  notch covers the door (it happened: a door opening into solid hull). A module leaving by an inner lock is
  clipped at the far hull and drifts on beneath the station.
- ⚠ **Keyboard: arrows pick by a nearest-module rule that can (rarely) leave a module unreachable**, measured 1
  position in 861 along the solution lines, and four other rules were worse. Tab / Shift+Tab step through modules
  in order and hand Tab back to the page after the last one; M toggles sound. The card pose
  (`scripts/poses/jettison.js`) searches the toy's own cursor graph and falls back to Tab.
- ⚠ **The audio module had a helper called `drop()` (disconnect a node later); naming a new voice `drop` shadowed
  it, every voice got a NaN and the clear panel never appeared** (the throw happened before the win check). The
  voice is `clamp()` inside, exported as `drop`.
- **Audio, measured** (analyser before `destination`): knock 0.17–0.19, clamp on let-go 0.12–0.17, airlock + chime
  0.17, per-cell step 0.05–0.07 (deliberately quiet), grab ~0.09, hint 0.09, station bed 0.03. No NaN. Never
  heard by the owner. A module pressed into its own-color lock that will not take it (too wide, or blocked) flashes
  the lock's frame red with a short two-note refusal.
- Verified headless: mouse drags clear levels 1, 6, 13, 19, 24, 33 (phone) and 40 (desktop) at par; **all 56
  levels replayed through the toy's real keyboard input, every one cleared at par**; WebKit + Chromium at 375px:
  no overflow, tap highlight off, hint works; no console errors.
- Trademark: "Block Out!", "Color Block Jam", "Blockout" on no surface; no studs on the modules. "block jam" kept
  out of the hidden keywords (owner's call, never answered).

## No. 124 Meld — shipped 2026-10-01 (`6d9458c`, sound rebuild `3eb1457`, phone controls `5552cca`, music `2976c82`), live

**`toys/meld/`** — a drop-and-merge physics puzzle (the Suika genre) in hand-blown GLASS: drop orbs into a jar, two
of a kind melt into the next of eleven (Seed, Amber, Cobalt, Jade, Cat's Eye, Rose, Millefiori, Dichroic, Galaxy,
Opal, Sun; only the first five drop), two Suns burn out together. Owner picked the molten-glass concept and the
**combo multiplier** twist (2026-10-01). Four files: `physics.js` (own circle solver, also runs in node),
`glass.js` (orb sprites), `audio.js`, `script.js`. Keys: `meld_best` (ticket rule **dir `up`**, rule only),
`meld_found` (bitmask of orbs ever made; 0-4 always count), `meld_chain`, `meld_runs`, `meld_sound`.
Registered everywhere (registry, sitemap, NL phrases, card CSS + `:not()`, og-gen, card + OG, ticket rule,
cross-promo in all FOUR lists, verified in all four DEPLOYED bundles) plus the owner's featured key art (36 in the
pool; source in `_sources/meld.png`). IndexNow accepted. Live-verified: toy plays by touch, hub card + newest panel +
search. ⚠ **The Trail Game could not deploy the cross-promo until its TanStack Start was bumped 1.168.26 to 1.168.60**
(`e693e8a` in that repo): Vercel now BLOCKS deploys on advisory GHSA-qx66-fv34-fjm8. Any TanStack Start site in the
portfolio on an older 1.168.x will hit the same wall on its next push. Verified headless: Chromium and WebKit, 375px,
portrait, landscape phone, reduced motion, challenge link, full run to overflow. ✅ **Owner play-tested on a phone and approved 2026-10-03** (*"all 3 are great"*, with Meld and Trench Runner Cinematic): feel, drag, sound and music.
- **Music (owner 10-01: "calming background music. Different every time"):** generative, in `audio.js` (`Piece`).
  Glass-harmonica pad (doublet + stick-slip harmonics, each voice breathing), a soft root, 3-4 Eno-style melody loops
  on their own odd periods (13-35s) so they phase and never repeat, glints far off; chords wander by weighted chance
  between FOUR PENTATONIC-ONLY chords (E add9, C#m7, B6sus4, F#11), voice-led, so nothing can clash with the
  E-pentatonic clacks and melts. Each piece rolls its lead (kalimba / celesta / glass marimba), chord pace,
  registers. ⚠ **Seeded from the run seed (`G.seed ^ 0x5bd1e995`), so a challenge replays the same music.** Own
  4.8s hall; `MU.level` 0.16 puts it at ~0.02-0.03 RMS alone (first pass at 0.62 was LOUDER than the game). Ducks
  and darkens with the danger level, recovers after overflow. Lookahead scheduler on a 120ms interval that skips
  (never catches up) after a stall or a hidden tab. Separate toggle `#musicBtn` (headphones), `meld_music`; it is
  top-left on phones, beside the sound button on desktop (the top-right frame label moved to 104px). gen-card now
  hides `.music-btn`. Owner-approved 2026-10-03.
- ⚠⚠ **Phone controls are a TRACKPAD drag, not the original's jump-to-finger** (owner 10-01: the phone was "harder
  to use than the desktop"; picked this over the exact original). A drag slides the orb by the finger's travel from
  wherever it touched (8px slop, incremental and clamped each step so reversing at a wall moves at once), so a thumb
  can stay low and clear of the pile; lifting drops it. A quick TAP still drops at the touch-DOWN point (the original
  does this on phones too). Neither reads the lift position: fingertips roll a few px as they leave, which was
  nudging the aim. Mouse unchanged (hover aims, click drops). Verified with CDP touch events.
- **Viral:** a run's drops come from a seed, so the challenge link `#c=<seed36>-<score>-<tier>` hands a friend the
  SAME orbs in the same order (physics is not deterministic and does not need to be). Challenged players replay the
  same drops ("Same drops again"), with a text button out to fresh drops. Image share via `OPT_SHARE_IMAGE`.
- **Collection hook:** the ladder under the jar (beside it in landscape) shows all eleven; 5-10 stay "?" until first
  made, ever. First make of each = callout + chime + GA `new_orb`.
- ⚠ **Chains reset on every drop.** A time window alone let spam-dropping string unrelated melds together (a random
  tapper reached x9). Now a chain is the melds that follow one drop within 0.62s of each other.
- ⚠⚠ **Physics lessons, all measured with a node bot (thousands of drops), reusable for any stacking toy:**
  (1) **Bounce only on a FRESH impact.** Restitution on resting contacts turned solver residue into a bounce that
  never died, and whole piles never fell asleep. (2) **Sleep is what makes a pile truly still** (8 velocity
  iterations + sleep = zero drift); a meld wakes everything (a vanished orb can leave anything unsupported).
  (3) **Sleeping pairs must CARRY their warm-start impulses**, or every wake-all makes the pile sag a frame (a twitch
  on every merge). (4) **Cap the mass ratio at 2 for overlap correction only**: a big orb on small ones otherwise
  sinks into them because the correction moves the small ones almost entirely. Remaining overlap happens only in the
  0.35s after a meld (the swell shoving neighbours, by design).
- ⚠⚠ **Owner, on the rebuilt sound (10-01): "the sound of the hitting glass is good but it's really repetitive. The
  different sizes should have different pitches."** So the orbs are HOLLOW and RING: `TIER_F` gives each size its own
  note, two octaves of E major pentatonic (Seed E6 1318Hz down to Sun E4 330Hz, measured 1315/987/656/416/328).
  Both orbs in a collision ring (a changing dyad); every knock randomises overtone balance, length, doublet beat
  rate and brightness (soft = darker); at most 12 rings at once. The JAR now rings ONLY on wall/floor hits; its
  fixed B on nearly every pile hit was the main repetition. This overrides the house "keep size pitch near a
  fourth" rule FOR THIS TOY, by owner request; the chain bell still climbs separately.
- ⚠⚠ **Audio was REBUILT after the owner heard pass one** ("could be a whole lot better", "all of it feels cheap").
  Pass one was the house modal/additive recipe; pass two works from the physics of glass and renders most of its
  sound into buffers once, after the first tap, in small jobs (each <=17ms): (1) a SMALL SOLID glass ball barely
  rings audibly, so a clack is a Hertz contact pulse radiated as its derivative, with 1-2 chatter re-bounces, a
  highpass at c/(2*pi*a) for the ball's size and a whisper of ring; contact time grows with size, so the clack
  darkens from 9.3kHz (Seed) to 2.8kHz (Sun) centroid. (2) What sounds like GLASS is the JAR: wine-glass mode
  ratios on B5, every mode a split doublet that BEATS; struck hard by wall/floor hits, faintly through the pile.
  (3) A looping rustle of micro-contacts follows pile motion (`AU.roll`, driven from script.js; ROLL_FULL 160,
  calibrated on the node sim, p97 of real play ~110). (4) A meld = contact click + turbulent torch puff (a cluster
  of gusts, never one envelope) + crystal ring with beating doublets on the chain's pentatonic step + glints + a
  thump for heavy orbs + annealing ticks. (5) Near overflow the jar SINGS (rubbed-rim doublet on B4, stick-slip
  wobble, creeps sharp) with quickening stress ticks. (6) Sun = glass-harmonica chord; overflow = a real fracture
  run with the jar's ring choked. Room IR: early reflections + 3-band tail, treble dies first.
- ⚠⚠ **ONE NaN SAMPLE SILENCED THE WHOLE TOY** until reload: `Math.pow(Math.sin(PI*i/n), 1.5)` at i = n can land a
  hair past PI, sin goes a hair negative, the 1.5 power is NaN, and NaN in a shared compressor is permanent. Clamp
  the base, and every rendered buffer is now scrubbed of non-finite samples in `buf()`. A level meter that suddenly
  reads 0.000 for everything after one voice is this, not a quiet voice.
- Levels (analyser before destination, measured with NO run going, or the game loop overwrites roll/danger every
  frame): clacks 0.27-0.29, wall 0.17, soft 0.06, drop 0.05, melds 0.23-0.40, sun 0.47, two suns 0.54, overflow 0.46,
  rustle full 0.23, singing jar 0.21, worst pile-up 0.52. Real touch play: per-second peak median 0.29.
  ⚠ Short noise bursts come from a POOL of eight per length: one cached burst made every hit identical and swung a
  session's level 0.26 vs 0.33 depending on which burst it drew.
- ⚠ **Trademark:** "Suika" (Aladdin X) is on NO surface, hidden search keywords included (the Tetris/Tempest
  precedent). "Watermelon game" is also out; whether to add it as a hidden keyword is the owner's call, unasked.
- **Card pose** `scripts/poses/meld.js`: real taps sweep 58 drops across the jar; candidate generator, regenerate
  with the command at its foot (`--size 760 --vw 760 --vh 1400 --cropy 470`). Card = candidate 4 of 6.

## No. 123 Maw, shipped 2026-09-24 (`90036d7`, rotary knob + key art `8465092`), live

**`toys/maw/`** — the Tempest-style tube shooter from BACKLOG, built ORGANIC (a living well: flesh, veins,
photophores, a ring of fangs on the rim) so it reads as nothing like the original or Trench Runner. You slide
around the rim and spit light down your lane; five creatures (grub, lane-hopping skitter, brood sac that splits,
spitter, silk weaver); anything reaching the rim crawls round it at you (fire inside the 0.34s bite window);
one flare per depth plus a weak second; clear the well and dive down the throat, dodging silk. Ten well shapes
with their own palettes. Three files: `well.js` (shapes, camera, WebGL membrane with a 2D fallback), `audio.js`,
`script.js`. Keys: `maw_best` (ticket rule **dir `up`**, rule only), `maw_depth`, `maw_sound`. Registered
everywhere, live-verified (toy plays, hub + newest panel + search, all four DEPLOYED cross-promo bundles),
IndexNow accepted.
- ⚠⚠ **"Tempest" is a live Atari trademark** (the genre where a clone, TxK, drew legal action). It is on no
  searchable surface anywhere on the site now: removed from Trench Runner's NL string too (owner, 09-24).
  Trench Runner's string still says "battlezone" (also Atari's); not raised with the owner.
- ⚠ **The GL membrane and the 2D overlay share ONE projection** (`WELL.project`; the vertex shader does the same
  maths). Any camera change goes through `WELL.cam`/`WELL.view` or the layers disagree about where a lane is.
- ⚠ **Shapes must run clockwise with no reversal**: the Eye's lower arc used `-cos b`, retracing the upper arc
  left to right, so the ring self-intersected and a creature rendered huge. The Mantle came out upside down
  (your start lane off screen). Render all ten wells after touching any shape.
- ⚠⚠ **Touch steering is a ROTARY KNOB** (owner: "the bar makes it harder on phone. The original game had a
  rotary joystick"). A dial under the well (right-hand margin in landscape): circle your thumb round it and you go
  round the rim by the SAME angle — a quarter turn is a quarter of the well, pure angle, never speed. It doubles as
  a map: a tick per lane at its true angle (`buildAngles()`, world space so the camera lean cannot wobble it), red
  where danger climbs, red dots for rim crawlers, a needle where you are. A touch that starts ON the well points
  like the desktop mouse (`pickLane`), so either works. A held finger fires only at something in your lane
  (`laneHasTarget()`); a beam down your lane (`drawBeam()`, all devices) answers "where am I".
  ⚠ **Four touch schemes were tried; do not walk back into the first three**: a tangent-projected drag (stalled
  at the ring's sides); a stroke-locked drag ("I overshoot and undershoot a lot", "losing track of where I am");
  an unrolled bar of lane cells (owner first liked it, then "makes it harder on phone": its ends are the ring's
  TOP, which fights the picture of the well). Bite window 0.46s, depths 1–2 open slower.
- **Viral:** image share (`shareCanvas` renders GL + 2D synchronously, no preserveDrawingBuffer) and a
  "Challenge a friend" link `#beat=<score>-<depth>` that shows the target in the HUD and calls out a win.
- **Audio, measured** (analyser before `destination`): shots and kills ~0.2, spit 0.30, rim steps 0.19, heartbeat
  0.18 / 0.12, big events 0.27–0.37, full flare cascade 0.59. ⚠ The hot voices were the `bloop()` layers, which
  carry their OWN gain on top of the voice's out gain — trimming `out.gain` barely moved them.
- ⚠ **Card pose** (`scripts/poses/maw.js`, keyboard only): the creature is walked to nine o'clock so it lands in
  the card's middle band. gen-card waits ~370ms after the eval resolves and a shot crosses the well in 0.4s, so
  the photographed shots are fired un-awaited LATER. ⚠ **Render candidates one at a time**: six in parallel
  starved the CPU, the game clock crawled and nothing had climbed.
- ⚠ **Difficulty is bot-tested only** (a sloppy bot reached depth 5, yet the owner found the phone hard: bots
  do not feel touch controls, so never read bot survival as a difficulty signal for touch). Audio never heard.

## No. 122 Barkeep, shipped 2026-09-23 (`99edb21`), live

**`tools/barkeep/`** — a tool (Moon Phase chrome), not a full-bleed toy: tick the bottles on your shelf,
see every cocktail you can make, what's one away, and the **best next bottle** (drinks it alone would
finish). 166 recipes in `drinks.js` (24 zero-proof), every glass drawn by `glassSVG()`, deep links
`#<slug>`, oz/ml (quarter ounces only), shopping list that shares as plain text. ⚠ The list button is a SOLID gold pill first in the shelf header, plus a floating bottom-centre copy (`#listFab`) shown only when the list has items AND the shelf button is off screen (IntersectionObserver) — owner couldn't find the original outline button (`09e1414`). Keys: `barkeep_bar`,
`barkeep_list`, `barkeep_units`, `barkeep_sound`. No score, so **no ticket rule**; a tool, so **not in the
cross-promo** (the tool family stays out of it). Live-verified; IndexNow accepted. ✅ **Audio (glass clink, knock, ice rattle; 0.215 / 0.132 / 0.144) owner-approved 2026-10-03.**
- ⚠⚠ **NO AFFILIATE LINKS — owner asked 09-23 ("I'm an affiliate", Amazon) and chose the plain list after
  the conflict with DECISIONS 2026-06-11 was flagged.** Also: Amazon US doesn't generally sell spirits, and
  Associates can only add to a CART (multi-ASIN add-to-cart link), not to a customer's list. If the owner
  ever changes the rule, record the exception in DECISIONS first; the suggested home for earning was a
  bar-tools page on Measure & Buy with a passive text link from here.
- ⚠ **Recipe text is our own wording; specs are the standard (IBA-ish) builds.** Never paste method text
  from a recipe site or TheCocktailDB. Brand-y items stay generic ("Zero-proof gin", "Orange liqueur");
  "Pornstar Martini" is only an aka on "Passion Fruit Martini".
- ⚠ **Zero-proof swaps are ADVICE, never counted toward "can make"** (NA spirits don't behave like the real
  thing). The line only shows when EVERY alcoholic ingredient has a stand-in in `SWAPS`; **bitters count as
  alcoholic**. A classic with its own zero recipe (name `Zero-Proof X` / `X Zero` / aka) links to it — the
  match runs on the classic's name AND aka, or the G&T ("G&T") and Aperol Spritz ("Spritz") miss.
- ⚠ **Adding a drink:** validate with the node one-liner pattern (every ingredient key must exist in
  `SHELF`/`PANTRY`, no duplicate names, every shelf item used). Pantry items never count as missing.
- ⚠ **`gen-card.cjs`/`gen-og.cjs` default to port 3000, which another app on this machine holds** — pass
  `--base http://localhost:8123`. Card = `--el ".backbar"` posed by real clicks; the OG motif is a custom SVG
  (`scripts/og-motifs/barkeep.svg`, three of the page's own glasses) because a square crop of the wide
  back-bar was blurry and cut labels.
- ⚠ **The Write tool turns `\u0300` escapes into literal combining characters** — it happened in
  `fold()`/`slug()`. It still works, but restore the escapes if you see mojibake in a regex.

## Trench Runner CINEMATIC mode (shipped 2026-10-01, `a512069`, live)

A second, player-picked look for No. 121 (owner: "keep the neon look, offer it as a second mode but really take it
up"). Neon is untouched and stays the default. **Look: Neon | Cinematic** on the start panel, an **HD** button under
the sound button to flip mid-run, choice in `trench_look`, GA `look_change`. `toys/trench-runner/hifi.js` renders
everything SOLID in WebGL (walls, floor, a deck past the rim, piers, hatches, grates, towers with lit windows,
trusses, blast-door barriers, girders, gun housings, a 3D ship); `script.js` keeps drawing everything that is LIGHT
on the top canvas (shots, bolts, blasts, wreckage, brackets, crosshair, ghost marker, throat rings, flashes). Three
stacked canvases: `#sky` (the sky, moved off the main canvas), `#gl`, `#canvas` (the only one taking input).
- ⚠⚠ **ONE PROJECTION**: hifi.js's vertex shader is `project()`/`px()` in GLSL (canal wander, camera, focal, roll,
  shake, near 1.2). Change one and a gun's 2D bracket stops sitting on its 3D housing.
- ⚠ **Furniture comes from the SAME `hash(n, k)`** as neon `drawTrench()`, built once as static geometry (slab
  ranges drawn per frame), so a stretch looks the same in both looks and flipping mid-run moves nothing.
- ⚠ **Gameplay colours stay 2D or match neon**: a barrier's opening edge is lime/red by the same `through()` test;
  a girder in your path stays steel in 3D and gets the neon HOT outline as light on top (a solid pink box read as a
  billboard); gun brackets and charge rings stay 2D.
- ⚠ **Light budget**: 8 dynamic lights (blasts, shots, bolts, charging guns, core, blast front, engine) ranked by
  brightness over distance, plus the wall lamps analytic in the shader. The first pass blew every wall to white: a
  kill's light at 7 x size lit 30 units of trench. Blasts now 2.4, shots 1.1, exposure 0.95, metal Fresnel x0.45.
- ⚠ **The starlight is LOW on purpose** (`normalize(0.85,-1,0.35)`): steep light lit the whole floor; low light
  puts half the trench in the rim's shadow, which is the look. The shadow is analytic (ray to the far rim).
- Bloom (1/4 + 1/8 res), ACES, vignette, light grain and lens fringing; WebGL2 MSAA when available. Adaptive
  resolution (`GLS` 1.25 down to 0.6) on slow frames; `webglcontextlost` drops to neon; no WebGL hides the choice.
- Share image in cinematic flattens all three canvases (`snapshot()`), drawn in the same task so no
  preserveDrawingBuffer.
- ✅ **Owner play-tested on a phone and approved 2026-10-03** (*"all 3 are great"*, with Meld and Trench Runner Cinematic). Fragment cost (14 lights + plating height field + bloom) was the risk; it held up on his phone.

## No. 121 Trench Runner, shipped 2026-09-23 (`b6dcc13`), live

**`toys/trench-runner/`** — a neon-vector canal flyer. **The ship flies itself and you AIM**: a crosshair
sits ahead, the gun fires one shot per click, and the ship only leans after it. Wall emplacements shoot
back, girders block the lane, gates must be threaded, and the run ends holding a lock on the reactor core.
Keys: `trench_best` (score, ticket rule **dir `up`**, rule only), `trench_time`, `trench_sound`.
Registered everywhere and live-verified. ✅ **Audio owner-approved 2026-09-23** (*"sounds great!"*) — blaster and
the rebuilt explosions (`a848972`). Levels: kill ~0.30 incl. the 0.14 engine bed, detonation 0.67.
- **Second pass (`a848972`, owner asks 09-23):** kills EXPLODE, BREAK APART and FADE — the object's own
  outline cut into tumbling shards (`shatterTurret`/`shatterProp` → `G.frags`, Rodrigues tumble) plus a
  fireball and embers. ⚠ **Owner: "this is space, no gravity"** — no gravity or drag term on debris OR on the
  clip/graze sparks; shards reflect elastically off walls/floor and leave through the open top.
- **The trench is SOLID now** (it was wireframe; stars showed through the walls). `drawTrench()` fills slabs
  between ribs far→near, then furniture per slab: raked piers, hatches, floor grates, rim housings, towers,
  overhead trusses. ⚠ **A truss must LAND on something** — it ends in pier blocks on the coping (`0c106d1`; owner: ending in mid-air "looks weird"). ⚠ **All furniture is a pure `hash(slabIndex)` — nothing stored**; it sits above the coping
  or flush with the walls so it is never an obstacle, and is drawn in `DETAIL` grey so it never reads as a
  shootable girder. Sky is pre-rendered once per size (`buildSky`: galaxy band + dust lane) and blitted with
  the roll; rocks and a station drift in front. Headless ~83fps landscape, ~120 phone.
- **Explosions rebuilt** (owner: "don't sound very real"): a turbulent puff-cluster roar baked into a stereo
  buffer; N-wave crack and noise thump through a tanh soft clipper; ONE shared flutter-echo loop for the
  parallel walls (never per shot — the leak trap below); modal metal debris. The finale's sawtooth groan is noise now.
- ⚠⚠ **THE SHIP'S REACHABLE BOX MUST COVER THE PLAYFIELD.** At `SHIP_FOLLOW` 0.52 it reached only **65% of
  the canal's width**, so a gap hard against a wall was *literally unreachable* — and **58% of all deaths
  were flying into a barrier**. Measured, not guessed. The "it flies for you" feel must come from LAG and a
  SPEED CAP, never from a scale factor that breaks the map between where you point and where you arrive.
- ⚠ **Targets must be placed against the hazards, not independently.** Aiming drags the ship, so a gun
  beyond a gate whose opening is elsewhere makes shooting it and surviving it mutually exclusive.
  **43.8% of guns were in that trap** until the placer began testing *the position aiming at them would
  drag the ship into*. Same rule extended to girders.
- ⚠ **Owner rule: the trench never costs hull** — not walls, floor, or the girders bolted to them, because
  lateral position is largely the GAME's doing. Only gates and enemy fire take hull; a girder is a glance.
- ⚠ **A destroyed enemy must take its shots with it.** Killing a gun stopped it firing but left its bolt in
  the air, so the thing you just destroyed still hit you.
- ⚠ **The lock must measure what the HUD tells you to do.** It measured the SHIP while the panel said AIM;
  since the ship only follows the crosshair partway, the lock could never fill. Measure the gun LINE.
- ⚠ **A goal faded by draw distance is invisible when the final stretch is that long** — the core sat at
  alpha 0 for the first 3s of the lock phase. Goals get their own curve and a floor.
- ⚠ **Explosions get DARKER.** The first roar swept its lowpass UP (260→3200), which is a whoosh, not a
  blast. Every blast now opens bright and closes dark, with a LUMPY rubble tail. Blaster = a dispersive
  three-partial dive with slapback (a struck cable), not one clean glide. Measured: blaster 0.247 peak,
  detonation 0.44–0.50, centroid 2719→594Hz.
- ⚠ **A feedback delay keeps ITSELF alive** — one per shot meant hundreds of live loops by the end of a run.
  Disconnect the loop explicitly.
- ⚠⚠ **A missing audio voice HUNG the game**: a deleted `lockTick` threw every frame of the lock phase and
  killed the rAF loop, freezing the toy at the climax. `frame()` now survives a throw, and a one-line check
  greps every `audio.*` call against the definitions.
- ⚠ **Difficulty ramps normalised by `RUN_LEN`** (`p = z / RUN_LEN`) mean shortening the run for a test
  COMPRESSES the whole curve and spawns late-game difficulty from the start. That harness lies.

## No. 120 Untangle, shipped 2026-09-21 (`fef4354`), live

**`toys/untangle/`** — drag a knot of stars until no two filaments cross. Crossed filaments burn
red and cool to white; below 44 crossings each one also shows a pip, so late on they become targets
rather than a red smear. Keys: `untangle_best` (deepest level cleared, ticket rule **dir `up`**,
rule only), `untangle_t<level>` (best time per level, deliberately NOT a ticket key), `untangle_sound`.
Registered everywhere and verified live (toy plays, gallery renders, search hits, all three sibling
bundles carry the cross-promo, IndexNow accepted). ✅ **Audio owner-approved 2026-09-23** (*"untangle sounds good too"*).
- ⚠ **The board is a LINE ARRANGEMENT, and that is the whole trick.** n straight lines in general
  position; every pairwise intersection is a star; each line joins its own intersections in order
  along itself. Two distinct lines meet exactly once, so that drawing is crossing-free by
  construction — **every board is provably solvable with no solver written**. Levels add a line:
  6, 8, 10, 12, 14, 17, 20, 23, 26, 28 stars. ⚠ **A line arrangement can only have C(n,2) nodes**, so the
  first ladder jumped 6→10→15→21→28 and level 2 arrived with four times level 1's crossings ("too hard too
  fast"). Build a LARGER arrangement and delete nodes down to a target, splicing each line's chain across
  the gap — it stays on the same straight line, so the board stays provably solvable. ⚠ A ring scatter is
  wildly variable, so deal seven and keep the MEDIAN. ⚠ **`hidden` is an HTMLElement property: assigning it
  to an `<svg>` sets a JS expando and never reflects**, which left the intro diagram on the finish panel.
- ⚠ **A guard that rejected "lopsided" arrangements silently broke every level above ~9 lines**: it
  fired on nearly every candidate, the 120 retries ran out, and the fallback dealt a **6-node board
  at level 9**. It was never needed — the scatter throws the arrangement's geometry away and keeps
  only which edges exist, and by Fary a graph with any planar straight-line drawing is planar. **A
  generator's fallback must be loud, not a quietly easier puzzle.**
- ⚠ **The ladder STOPS growing at 8 lines / 28 stars, on purpose.** The authentic ramp keeps adding
  lines, but level 7 opened with **916 crossings** — a twenty-minute grind against the one-sitting
  rule. Past level 5 the boards stay full size and the chase becomes the clock. Untested in play.
- ⚠ **It resumes at your best level, not level 1** ("Back to level 1" is in the bar).
- ⚠ **A ring scatter can deal a board that is nearly solved already**, which is not a puzzle — it
  reshuffles until crossings clear a floor of `0.6 x stars`.
- ⚠ **x and y are mapped by DIFFERENT radii** so a portrait phone is not left with a small disc in a
  tall frame. Safe because **an affine squash cannot create or remove a crossing.**
- ⚠ **Crossing detection is incremental**: only the ≤4 edges touching the dragged star can change, so
  a drag costs a few hundred tests instead of E². Pairs sharing an endpoint are never counted — two
  consecutive edges of one generating line are collinear, which a naive test reports as an overlap.
- **Audio, measured** (analyser spliced ahead of `destination`, no debug hook): grab contact 0.198,
  resolve bell 0.240, one real drag 0.207, finish 0.275 avg — all inside 0.15–0.30; drag-spam
  stress 0.649, under the 0.84 brickwall. ⚠ **Isolate a bell from the contact by playing on the
  KEYBOARD** (space lifts, arrows carry) — a measurement that includes the grab reads ~50% high and
  sent me chasing the wrong voice. ⚠ **The partial stack IS a gain stage**: PGAIN summed to 2.14, so
  `amp` was never the level it looked like. Normalised to sum 1, then set per voice.
- ⚠ **Card pose traps** (`scripts/poses/untangle.js`, reads stars off the canvas, drives real
  PointerEvents): a plain "fewest crossings" search **heaps every star into one corner**, because
  crossing count says nothing about spacing — candidates are a grid and a move must also leave the
  star clear of its neighbours. And **re-reading the star list inside the loop RESHUFFLES it** (the
  clusters come back in scan order), so `list[i]` stops meaning the same star and the search starts
  dragging whatever is i-th now; read once per sweep and keep your own copy, since drags translate
  exactly and can be undone blind. ⚠ Clicking `#ovBtn` while the overlay is hidden **restarts the
  level instead of advancing**, which quietly photographed level 1 twice.

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
- Versions that release bumped (history — current numbers live under "Shared-asset versions"):
  `main.js?v=113`, `styles.css?v=117`, `tickets.js?v=26` (128 pages), `more-games.js?v=22` (42 pages).

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
