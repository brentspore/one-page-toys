# Context

One Page Toys is a collection of self-contained browser-based web toys and mini-games — lightweight single-HTML-file tools that drive top-of-funnel discovery for the Synergy portfolio.

Not loaded into context every session — pull from here when picking up new work or reviewing project scope. If an item belongs across multiple projects, move it to `~/.ai/memory/BACKLOG.md` instead. Work items only: decisions belong in `.ai/memory/DECISIONS.md`; active missions and directives belong in project memory that loads every session.

## Entry format

Items in this file follow the structure below so that any AI tool or human editing the file directly produces entries Backlog Viewer can parse, display, and manage. Keep this section intact — it is the in-file format reference that prevents format drift. Backlog Viewer hides it from the app display and treats the example item as a template, not a real entry.

### Item title

**Why it matters:** What value this delivers or what risk it avoids.

**When to revisit:** The specific trigger or condition that makes this worth acting on.

**Notes:** Context, constraints, related files, or prior decisions.
---

### Trench Runner: a high-graphics version — owner idea 2026-09-24

**Why it matters:** Owner suggested it while Maw was in play-test. Trench Runner is Canvas 2D strokes; Maw showed what one WebGL layer adds (shader-lit surfaces, headlamp depth falloff, wet highlights). Lifting a toy people already play is a cheaper win than a new one.

**When to revisit:** After Maw is finished (owner: "maybe something to add after we finish this game").

**Notes:** ✅ Decided (owner, 09-24): *"keep the neon look, offer it as a second mode but really take it up."* **Keep the neon-vector version as-is and add the high-graphics one as a player-selectable mode** (a toggle, remembered in localStorage), not a replacement. **"Really take it up" is the bar: push the presentation as far as it will go**, not a light reskin: lit and textured metal, real depth and atmosphere, bloom, richer explosions, the works. Keep the zero-build soul (raw WebGL, no Three.js). Maw's split is the template: one WebGL mesh for the big surfaces (trench walls and floor, shaded, with lamp falloff) and Canvas 2D on top for ships, shots and HUD, both driven by ONE projection function so the layers never disagree. Do not touch the measured placement and fairness code (reachable box, gun placement against hazards: see HANDOFF). This is new work the owner asked for, so the 2026-08-21 "retro-tuning is closed" rule does not block it.
---

### Daily #1 — Numbers Target (own domain + practice feeder here)

**Why it matters:** ⚠ **Passes the daily-viral test on all four criteria AND fills the single clearest genre gap in the catalogue: `arithmetic` returns NOTHING across all 116 toys.** Four numbers and a target; combine them with + − × to hit it exactly, or get as close as you can. Mental arithmetic pulls a completely different audience from the word and reflex games, so it widens the network rather than competing inside it. Category `game`/number.

**When to revisit:** Next daily-game round. Nothing blocks it — no content authoring, no backend, no word list.

**Notes:** Spotted 2026-08-23 while reviewing daily games the owner sent through (numbobulate.com is a live example of this mechanic; the family is the Countdown numbers round). Ranked above every other candidate in that review.
- ⚠ **ROUTE VIA `new-feeder-game`, NOT as a toy here** (project `DECISIONS.md`, 2026-08-16): one set a day identical for everyone, a knowable best answer so scores are comparable, a 2-5 minute solve, and a reason to return. A daily with streaks cannot live in this repo.
- ⚠ **The reason this one is buildable and Seldom is not: the puzzle is GENERATED AND SCREENED ALGORITHMICALLY**, the same property that made Word Kraven work. Pick four numbers plus a target, then solve it exhaustively before publishing to guarantee the target is reachable and to know the optimum. **Never ship a set you have not solved** — an unreachable target is the one bug that destroys trust in a daily.
- **The share is genuinely spoiler-free and is the whole spread mechanism.** Numbobulate's version: green squares for correct, blue for a fast correct, orange for close, with the square count encoding how many operators were used. Reveals the difficulty and your performance, never the solution.
- **Feeder here** = unlimited practice edition per the `new-toy` "Feeder toys" checklist: practice only, no daily, no streaks, **no email capture** (that belongs on the game's domain), two UTM-tagged CTAs, `outbound_click` + `share` events, self-canonical, countdown targeting the daily site's ACTUAL rollover.

---

### Daily #2 — Cryptogram (own domain + practice feeder here)

**Why it matters:** Numbers map consistently to letters and you decode the phrase; there is exactly one right answer, difficulty is comparable between players, and the share can report mistakes or time **without leaking a single letter**. `cryptogram` returns nothing in the catalogue — the only near-neighbour is Aurebesh Translator, which is a transliterator, not a puzzle. A classic with real standing search demand. Category `game`/word.

**When to revisit:** After Numbers Target, or instead of it if a word game is preferred over an arithmetic one.

**Notes:** Spotted 2026-08-23 in the same review (cyphrgame.com is a live example, laid out as a pyramid where each row is a word). Second-ranked of that set.
- ⚠ **ROUTE VIA `new-feeder-game`** per the same rule as Daily #1.
- **Generable, so no daily authoring:** the only content needed is a phrase list; the substitution is randomised per day. That keeps it in the same "generate and screen" family as Word Kraven and Numbers Target.
- **Design the difficulty deliberately:** letter-frequency crib, a starting letter or two revealed, and a cap on wrong guesses (Cyphr allows 26). The interesting knob is how much of the alphabet is pre-filled — too little and it is a chore, too much and it solves itself.
- **Feeder here** = unlimited practice edition, same checklist as Daily #1.

---

### Daily — Inverse trivia (Seldom-style) ⚠ NEEDS A BACKEND — own project, not a feeder

**Why it matters:** The most original mechanic in the 2026-08-23 review and worth recording even though it cannot be built the usual way. Name something in a category, and score by how **common** your answer was — lowest wins, and zero is the perfect round. The share is spoiler-free by construction, because your score is a bare number that reveals nothing about your answer.

**When to revisit:** Only if the network ever gains a shared backend with enough players to score against. Not before.

**Notes:** playseldom.com is the live example ("Rare beats obvious", new puzzle daily at midnight UTC).
- ⚠ **THE BLOCKER IS STRUCTURAL, NOT EFFORT: scoring requires a corpus of everyone else's answers.** It needs both a backend and a population before it works at all — with ten players the scores are meaningless. That is the opposite of every other game in the network, which is self-contained and works for player one on day one.
- Recorded so it is not re-proposed as a feeder. If it is ever built it is a product with a database, not a static daily.

---

### Reviewed and NOT recommended (2026-08-23)

**Why it matters:** Saves re-reviewing the same daily games. The owner sent eight sites; these are the ones deliberately passed over, with the reason.

**When to revisit:** Only if the constraint named against each one changes.

**Notes:**
- **Waffle (wafflegame.net)** — qualifies well (knowable optimum, star-rating share, ~2-3 min) but it is a well-known existing game and cloning its trade dress directly is off-brand. **The transferable idea is the FAMILY: fix-a-grid-by-swapping with a limited swap budget**, which is worth a future original take.
- **GridChain (gridchain.fisherloop.com)** — word-association chain across a 5×5 grid. Qualifies on share but **needs hand-authored content every day**, which is an ongoing operational commitment rather than a build. Same objection as Connections.
- **Timeline / chronology games (wasthatbefore.com)** — ordering events by date. Strong share (a tick/cross per item) but again **daily content authoring**, plus fact-checking risk.
- **NYT Games** — the reference set, not a target. Of them, **Letter Boxed** and **Pips** are the two whose mechanics are least cloned elsewhere if an original take is ever wanted.
- ⚠ **The filter that produced this split is worth keeping: a daily works for this network when the puzzle can be GENERATED AND SCREENED algorithmically.** Anything needing authored content each day is a different kind of commitment and should be judged as one.
- ⚠ **Two of the eight could not be assessed: `playpocketpuzzles.com` and `wasthatbefore.com` are JS-rendered and only their titles were readable.** Their mechanics are unverified — look at them in a browser before acting on either.

---

### Puzzle #1 — New toy: Colour Pour (water-sort)

**Why it matters:** ⚠ **The single most viral casual-puzzle format of the last several years, and the best fit for this site of anything on this list.** It needs ZERO rules text — one screenshot teaches the whole game — the input is two taps, it is infinitely generatable with guaranteed solvability, and the payoff is liquid pouring, which lands squarely on the "must look and sound intentional" bar. Category `game`.

**When to revisit:** Next puzzle round, and **build this one first.** Small-to-medium scope with no content authoring and no dictionary decision, so it is the cheapest of the top four to ship.

**Notes:** A rack of tall glass tubes part-filled with bands of coloured liquid. Tap a tube to lift its top band, tap another to pour it in; a pour is only legal onto the same colour or into empty space, and the whole band of that colour moves at once. Win when every tube is single-coloured or empty. **Generate by REVERSE-SHUFFLING from a solved state** — that guarantees solvability without writing a solver, which is the trap this genre usually falls into. Undo, plus one "extra tube" get-out per board.
- **Design bar:** real glass (refraction-ish distortion of the bands behind, specular streak, meniscus at each boundary — the Glass Harp already solved that rendering language and this can share it). The pour is an ARC of liquid between tubes with the receiving surface rising and settling, not an instant swap. Colour-blind safety matters here more than usual: distinct hues AND a subtle pattern or symbol per colour, since the entire game is colour identity.
- **Audio:** this is the whole appeal — a glug that pitches DOWN as the receiving tube fills (the resonant air column shortens, exactly like filling a real bottle), a soft glass clink on tube select, and a bright settle when a tube completes. Model it, per the 2026-08-14 modal/additive split.
- Best count + moves in `localStorage`; ticket rule. Real card + OG; full pipeline.
---
### Puzzle #3 — New toy: Circuit (rotate-the-tiles network puzzle)

**Why it matters:** ⚠ **The most mesmerizing one-tap puzzle there is, and the best CARD image of anything on this list** — a dark grid of dead wires that lights up as one connected network the instant it is solved. Tap-only input, no dexterity, no reading, infinitely generatable, and the completion moment is a genuine light show. Category `game`/`visual` crossover.

**When to revisit:** Next puzzle round. Small scope — the generator is the only real work and it is easy (see notes).

**Notes:** A grid of tiles, each carrying a fragment of wire (end-stub, elbow, T, straight, cross). Tap a tile to rotate it 90°. Solve by rotating every tile until all wire fragments join into one closed network with no loose ends, at which point current flows from the source and the whole board lights.
- ⚠ **Generate the SOLVED board first, then scramble the rotations.** Building a random tile soup and checking solvability is the hard way round and mostly produces unsolvable boards. Grow a random spanning tree over the grid, derive each cell's tile shape from which neighbours it connects to, then randomly rotate every tile. Always solvable, any size, no solver required.
- **Design bar:** unlit wire is a dull etched channel; as segments join the source, current CRAWLS along them (animated, not an instant recolour) with a travelling glow head, so partial progress is visible and rewarding. Solved = a bloom across the whole board. Wrap toggle (edges connect around) as a harder mode.
- **Audio:** a soft relay click per rotation with pitch tied to how much of the network is now live, a rising hum as coverage grows, and a satisfying power-on swell at completion.
- Best time per size in `localStorage`; ticket rule (dir `down`). Real card + OG; full pipeline.
---
### Puzzle #4 — New toy: Threads (numberlink / flow)

**Why it matters:** ⚠ **The largest mobile-puzzle audience on this list after word games**, and a perfect one-gesture fit: drag from one coloured dot to its twin, fill every cell, cross nothing. Instantly readable, endlessly replayable, and the finished board is a genuinely pretty object. Category `game`.

**When to revisit:** Next puzzle round, after Colour Pour. ⚠ **Scope the generator FIRST** — it is the one real risk on this item (see notes).

**Notes:** Square grid seeded with pairs of coloured dots. Drag from a dot to trace a path to its pair; paths may not cross or overlap, and a proper solve fills EVERY cell. Dragging a new path over an old one truncates the old one rather than refusing, which is what makes it feel fluid rather than fussy.
- ⚠ **The generator is the whole build.** Naive random dot placement mostly yields boards that are unsolvable or have many solutions. The reliable method is the same trick as Circuit — **construct the solution first**: partition the grid into a set of non-crossing snake paths that between them cover every cell, then keep only each path's two endpoints as the dot pair. Guaranteed solvable and guaranteed full-coverage by construction.
- **Design bar:** paths are thick rounded ribbons with a soft glow, laid down with a satisfying trailing animation; the cell under the finger snaps. Completion sweeps a shine along every thread in turn. Sizes 5×5 → 9×9.
- **Audio:** a soft pitched blip per cell entered, rising through a pentatonic run as a path extends (so tracing a long path is musical), a dull thunk on an illegal move, a chord on completion.
- Best moves/time per size; ticket rule. Real card + OG; full pipeline.
---
### Puzzle #5 — New toy: Nonogram / Picture Logic

**Why it matters:** ⚠ **Ranked #5 of the puzzle set: the most share-worthy PAYOFF of any puzzle here (the reveal is a picture), but the slowest to start and the only one needing real content work.** A beloved logic-puzzle genre (huge dedicated audience) absent from the site; solving reveals pixel-art — inherently rewarding and screenshot-friendly. Category `game`/puzzle.

**When to revisit:** Next puzzle round. Main scope: a curated set of solvable puzzles (or a generator + solvability checker).

**Notes:** AI suggestion (2026-07-05). Row/column count clues; tap to fill, long-press/second-tool to mark X; mistake-forgiveness toggle; 5×5 → 15×15 sizes. Content: procedurally generate boards and verify line-solvability, or hand-curate a pack of charming pixel-art reveals (animals, objects) — reveal animates + colorizes on completion. Timer + best per size in `localStorage`. Design: clean paper-grid aesthetic or glowing terminal; satisfying fill thunk, error buzz (gentle), completion chime + the picture coming alive. Keep the name generic ("Picture Logic" etc. — Picross is trademarked). Real card + OG; full pipeline.
- ⚠ **THE SHARE PROBLEM MIGHT BE SOLVABLE — this is what the "maybe" in the standing daily assessment was waiting on.** Nonogram was rated a maybe because **the picture reveal IS the spoiler**, so there is nothing to post that does not give the puzzle away. **The fix: colour the shared emoji grid by WHEN each cell was filled, not by what is in it** — early greens through to late reds, or first-try versus corrected. That shows the SHAPE of your solve, where you found the foothold and where you struggled, and reveals not one cell of the picture.
- **This is Wordle's actual trick — share the journey, not the answer** — and it is the general fix for any puzzle whose completed state is the spoiler. Worth trying here first because a nonogram's solve order genuinely varies between people (everyone attacks a different line first), so the grids differ enough to be worth comparing. It does NOT rescue Sudoku or Skyscrapers, whose bigger problem is that they need teaching before a shared link means anything (2026-08-23).
- **If that share works, re-run the daily test on this entry** — it already passes same-puzzle-for-everyone, a 2-5 minute solve at small sizes, and a reason to return; the share was the only failing criterion. ⚠ It would still be **the only candidate needing real content authoring**, so weigh that against Numbers Target and Cryptogram, which generate themselves.
---
### Puzzle #6 — New toy: Sudoku

**Why it matters:** **Almost certainly the highest evergreen search volume of any puzzle in the world**, which is the entire argument for it — this is a traffic play, not a delight play, and it should be judged that way. Category `game`.

**When to revisit:** When the priority is search traffic rather than novelty. ⚠ **Rank it below the four above on FUN**: it is a serious, slow puzzle in a very crowded space, and it is the largest UI build of the set.

**Notes:** 9×9 with four difficulties. The build cost is not the solver, it is the UX: pencil marks/notes mode, conflict highlighting, same-number highlighting, undo, a proper mobile number pad, and keyboard entry on desktop. Generate by filling a valid grid then removing clues while a solver confirms uniqueness at each step.
- ⚠ **"Sudoku" is generic worldwide** (Nikoli's trademark is Japan-only), so the name is safe to use plainly — and using it is the entire point, since the search term IS the product.
- **Design bar:** this is where it earns its place on THIS site rather than being one of ten thousand sudoku pages — a beautiful typographic grid, ink-on-paper or lit-glass, genuinely pleasurable number entry, and restrained, elegant feedback. No garish red error states.
- Best time per difficulty; ticket rule (dir `down`). Real card + OG; full pipeline.
---
### Puzzle #7 — New toy: Sliding Block Escape

**Why it matters:** Instantly recognizable from a single frame ("get the long block out of the jam"), tactile drag input, and a small build. Ranks below the others only because it needs authored or solver-generated levels rather than being freely generatable. Category `game`.

**When to revisit:** Any quick-win puzzle round, once there is appetite for authoring ~30 levels.

**Notes:** A 6×6 tray of blocks that slide only along their own axis; free the target block through the gap in one wall. **⚠ Rush Hour is a ThinkFun trademark — the sliding-block genre is not.** Use our own name, art and framing (a foundry, a log jam, an ice floe — offer options via AskUserQuestion), never their car/traffic dress.
- Levels: hand-author a set, or generate by breadth-first search from random configurations and keep boards whose minimum solution is long enough to be interesting. The BFS approach doubles as the "minimum moves" par score, which is what makes it replayable.
- **Design bar:** heavy blocks with real weight — they resist, then slide with momentum and clunk against neighbours. Move counter against par.
- Best moves per level; ticket rule. Real card + OG; full pipeline.
---
### Puzzle #8 — New toy: Tangram

**Why it matters:** The most beautiful puzzle on this list and the most on-brand for the site's visual bar; seven pieces, public domain, thousands of years old. Ranks lower purely on virality — it is a slow, contemplative puzzle with less "one more go" pull than the top four. Category `game`/`visual`.

**When to revisit:** Next visual/craft round, or alongside a cozy release. Small-to-medium scope.

**Notes:** The classic seven pieces (5 triangles, 1 square, 1 parallelogram) dragged and rotated to fill a target silhouette. Snap to position and angle when close; the silhouette fills with colour piece by piece as each one lands.
- ⚠ **The parallelogram is chiral and cannot be flipped by rotation** — a real tangram set allows turning it over, so the toy must offer an explicit flip control or a meaningful fraction of the classic figures become unsolvable. This is the one rule everyone gets wrong.
- Content: a curated set of classic silhouettes (cat, rabbit, boat, house, running figure) — public domain, and hand-picking them is cheap.
- **Design bar:** thick lacquered wooden or glass pieces with real edge lighting and a soft drop shadow; a satisfying magnetic snap. Free-play mode with no target, since people will want to make their own shapes — and that mode is the shareable one.
- **Audio:** a woody click on snap, a soft slide while dragging, a warm chord on completion.
- Figures completed in `localStorage`. Real card + OG; full pipeline.
---
### New toy: Snow Globe

**Why it matters:** Shake it and watch the world settle — a one-gesture cozy ritual everyone already knows. Seasonal spotlight potential (December feature). Category `wellness`.

**When to revisit:** Cozy round / before the holidays.

**Notes:** AI suggestion (2026-07-05). A glass globe (specular + refraction-ish distortion of the tiny scene) over a carved base; shake via drag-flick (or device motion) — hundreds of snow particles swirl with fluid-ish turbulence then settle drift-by-drift; tiny scene inside (cabin + pines, lantern-lit; maybe 2-3 scenes to cycle). Glass glints, warm interior glow, falling-settled snow accumulates. Audio: soft glass-muffled swirl, twinkling music-box phrase that plays as snow falls (reuse Music Box voice), settling hush. Real card + OG; full pipeline.
---
### New toy: Omnichord / Strum Pad

**Why it matters:** Pick a chord, strum a glowing harp strip — instant lush music for people who play nothing. One of the most satisfying "anyone sounds good" instruments. Category `audio`.

**When to revisit:** Next audio round; small-medium scope.

**Notes:** AI suggestion (2026-07-05). Chord buttons (I–vi across a friendly key, or a small major/minor grid) + a vertical touch strip: sliding across it arpeggiates the held chord's notes (harp-like, velocity from slide speed); optional gentle rhythm pad (soft drum loop) and auto-bass on chord press. Sparkly plucked-string synthesis (detuned pairs, shimmer reverb per the audio bar). Design: a dreamlike instrument-object with a glowing strum field, light motes rising per note (Kalimba's world-language). Trademark-safe name ("Strumboard"?). Real card + OG; full pipeline.
---
### New toy: Euclidean Rhythm Circles

**Why it matters:** Circular sequencers distributing K hits over N steps produce world-rhythms automatically — gorgeous rotating geometry + instant polyrhythmic grooves; a beautiful, brainy step up from Beat Maker. Category `audio`.

**When to revisit:** Next audio round.

**Notes:** AI suggestion (2026-07-05). 3-4 concentric rings, each a voice (kick/hat/pluck/chime); per-ring controls: steps N, pulses K (Euclidean/Bjorklund distribution), rotation offset, sound. Playhead sweeps like a radar; hits light and pulse outward. Tempo + swing; mute/solo per ring. The geometry IS the interface — dragging K reshapes the polygon inscribed in the ring. Synth voices through the standard bus (reverb/delay/compressor); visual: neon polygons on dark, vertices flash on hit. Real card + OG; full pipeline.
---
### New toy: Spinning Top / Gyroscope (real-3D, WebGL)

**Why it matters:** Flick a top and watch real precession, wobble, and the slow death-spiral rattle — mesmerizing physics you can feel. The perfect desk-toy sibling to the 3D Newton's Cradle. Category `simulation`.

**When to revisit:** After the 3D dice ship (shares the rigid-body + WebGL foundation).

**Notes:** AI suggestion (2026-07-05). Zero-dep WebGL: a machined metal top (lathe profile = surface of revolution mesh) on a reflective dark surface (cradle's floor language); drag-flick or twist-gesture to spin (spin rate from gesture); simulate gyroscopic precession + nutation (Euler's equations for an axisymmetric top — well-known closed forms), friction slowly bleeding spin until the wobble grows and it clatters down (satisfying rattle audio). Multiple tops to duel? (collisions optional/stretch). Spin-time record in `localStorage`. Audio: spin hum whose pitch follows RPM, scrape as the tip wanders, the end-rattle. Real card + OG; full pipeline.
---
### New toy: Soft-body Jelly Cube

**Why it matters:** Poke it, stretch it, fling it — wobble physics is universally, giggle-inducingly satisfying (the digital stress-ball). Category `simulation`.

**When to revisit:** Next physics round; small-medium scope.

**Notes:** AI suggestion (2026-07-05). A 2D soft-body (spring-mass lattice or pressure-model blob, like Cloth's verlet cousin) sitting on a floor: drag to grab/stretch any point, release to *sproing*; toss it at walls; it jiggles with damped shear waves. Maybe 2-3 bodies with different squish (jelly / dough / water balloon). Design: translucent wobbling jelly with internal glow + specular film, squash-and-stretch shadows; audio: comedic-but-tasteful squish/wobble (filtered noise + pitch-bent body tones scaled by deformation energy). Real card + OG; full pipeline.
---
### New toy: Lorenz Attractor (3D butterfly)

**Why it matters:** The icon of chaos theory as a living 3D ribbon you orbit — glowing particle trails weaving the butterfly forever, never repeating. Category `simulation`/visual.

**When to revisit:** WebGL round; small-medium scope.

**Notes:** AI suggestion (2026-07-05). Zero-dep WebGL: integrate many Lorenz trajectories (slightly offset starts — watch them diverge: chaos made visible); render as glowing additive ribbons/particles; drag to orbit, pinch to zoom; sliders for ρ (rho) morph the attractor shape live; a "twins" button launches two dyed trails from near-identical starts. Deep-space palette, bloom. Audio: an ethereal shimmer bed modulated by trajectory divergence. Real card + OG; full pipeline.
---
### New toy: Magnetic Pendulum Fractal

**Why it matters:** A pendulum over three magnets — release it and it dances chaotically before choosing one; the hidden basin-of-attraction fractal it traces is a jaw-dropping reveal. Chaos you can play with. Category `simulation`.

**When to revisit:** Next physics round.

**Notes:** AI suggestion (2026-07-05). Top-down pendulum bob attracted to 3 colored magnets (+ drag friction); drag to place/release the bob — it swirls and settles on a magnet (trail colored by eventual winner). "Reveal the map" mode: progressively raster-compute which magnet each start point falls into → the famous fractal basin image paints in live (chunked so the UI stays responsive). Move the magnets and watch the map morph. Audio: swooshes following speed, a soft lock-in chime colored per magnet. Real card + OG; full pipeline.
---
### New toy: Orrery (brass solar system, real-3D)

**Why it matters:** A clockwork solar-system model you crank — brass, gears, ivory planets; educational-adjacent beauty with real orbital ratios. Gorgeous card material. Category `simulation`.

**When to revisit:** WebGL round after dice; medium scope (mostly modeling/materials, physics is simple).

**Notes:** AI suggestion (2026-07-05). Zero-dep WebGL: stylized brass armature, planets on arms with correct *relative* periods (crank speed = time multiplier; drag to spin time forward/back, watch retrograde alignments); tap a planet for its name + a fact chip; toggle real-scale vs. display-scale spacing. Single warm key light (museum spot), brass env-glints (cradle's material language), soft table shadow. Audio: gentle clockwork tick + gear whirr that follows crank speed, a chime on planetary alignment. Real card + OG; full pipeline.
---
### New toy: Fractal Tree Grower (L-systems)

**Why it matters:** Watching a tree grow from your touch is quietly magical; parameterized L-systems give endless organic variety with tiny code. Crosses visual + wellness. Category `visual`.

**When to revisit:** Next visual/cozy round.

**Notes:** AI suggestion (2026-07-05). Tap the ground to plant; the tree grows branch-by-branch (animated L-system with slight randomness); sliders/chips for branch angle, lushness, and season (spring blossom / summer green / autumn fire / winter bare + snow); drag to bend the wind through the canopy (leaves flutter, petals fall). Multiple trees compose a grove scene. Audio: soft creak/rustle that follows wind strength, birdsong at full bloom. Real card + OG; full pipeline.
---
### New toy: Bonsai Pruning

**Why it matters:** The Pottery Wheel of plants — slow, deliberate shaping of a living thing; snip a branch, watch it heal and regrow, care for it across a sitting. Deeply calm. Category `wellness`.

**When to revisit:** Next wellness/craft round.

**Notes:** AI suggestion (2026-07-05). A procedural bonsai (recursive branch structure) in a ceramic pot on a wooden stand; tap a branch to snip (clean cut animation + a leaf flutter), pinch/drag to wire a branch's angle gently; the tree slowly buds/regrows toward light over the session; choose pot + style (cascade, windswept, formal). Seasons/flowering as a quiet reward for balanced pruning. Audio: crisp snip, leaf rustle, distant temple ambience (synthesized bell, wind). Photo-mode card composition. Real card + OG; full pipeline.
---
### New toy: Paper Snowflake Cutter (kirigami)

**Why it matters:** Deeply tactile childhood magic — cut notches from a folded paper wedge, then unfold to reveal the six-fold snowflake. The reveal moment is inherently shareable and photographs beautifully. Category `visual`/craft (Pottery Wheel energy).

**When to revisit:** Next visual/craft round — also a natural December feature.

**Notes:** AI suggestion (2026-07-05). Show a folded triangle wedge; drag to cut polyline snips from the edges (polygon clipping on the wedge shape); an unfold button (or auto-preview) mirrors the wedge 12× (6-fold + reflection) into the full snowflake with a paper-unfolding animation. Then: cut another, drift finished flakes in a gentle snow scene, download/share. Design: soft paper texture, scissor-line preview, warm desk-lamp scene vs. cool snowy backdrop for the reveal; audio: crisp paper-snip, soft unfolding rustle, a twinkle on reveal. Real card + OG; full pipeline.
---

### New toy: Pyramid (card game)

**Why it matters:** The card-render foundation (Solitaire / Blackjack / Video Poker: pips, courts, chips, felt, deal animations) makes each additional card game a cheap, high-polish win for the popular `game`/cards lane.

**When to revisit:** Any quick-win round. Video Poker — the other half of this pair — shipped as No. 095 on 2026-07-25.

**Notes:** Clear pairs summing to 13 from a 28-card pyramid plus a stock; drag or tap pairs; win cascade like Solitaire's. Its own toy folder/slug. Reuse the felt + audio bus with a distinct table accent colour. Real card + OG; full pipeline.

---
### New toy: Explorative Music (loop/track maker)

**Why it matters:** Fills the "more audio" genre gap and is highly shareable/viral — users craft a loop and can share it. Builds naturally on the Web Audio foundations already proven in Music Box, Theremin, Kalimba, Steel Tongue Drum, Beat Maker (bus → compressor → convolver reverb + delay, iOS unlock, Sound toggle).

**When to revisit:** Next audio-toy round. Meatier than a single-instrument toy — scope carefully.

**Notes:** Owner idea (2026-07-02): "several tools for you to use to generate an audio track or loop." An exploratory mini-DAW / generative sandbox, `audio` category. Ideas for the "several tools" palette (pick a coherent subset — don't overbuild):
- A **step sequencer / drum grid** (reuse Beat Maker/Music Box patterns) for rhythm.
- A **melodic layer** — pentatonic/Akebono note lane(s) so anything sounds consonant; maybe a piano-roll-lite or a generative arpeggiator seeded by taps.
- **Chords/pad** bed, a **bass** lane, and per-lane instrument voice choices (reuse the synth voices already built).
- **Generative helpers** — "randomize/evolve", density/mutation sliders, a Euclidean-rhythm generator, tempo + swing, so users *explore* rather than compose from scratch (the "explorative" framing).
- Everything loops in sync on one transport; a visible cycling playhead (like Music Box's loop track).
- **Shareable:** encode the pattern/seed in the URL hash so a friend opens your loop (cf. Countdown/Aurebesh hash-sharing).
- Hold to the **audio quality bar** (layered voices w/ correct partials, reverb/delay space, stereo width, bus compressor, consonant scales). Owner must audition by ear — headless can't. Real rendered card + OG; full add-a-toy pipeline.
---
### New toy: Tower Defense (Kingdom Rush-style)  ⚠ likely TOO LARGE for one-page-toys

**Why it matters:** Tower defense is a hugely popular, deep, replayable genre with massive evergreen search demand. BUT ⚠ per the project scoping rule (`.ai/memory/DECISIONS.md`, 2026-07-03: keep one-page-toys builds small/self-contained — no save/progression here), a full Kingdom Rush-style TD is probably **too large for this site and better built as its own dedicated project**. Keep on the backlog as either (a) a **stripped MVP** that fits one sitting (1 short path, 2–3 tower types, ~5 waves, 2 enemy types, best-score only) OR (b) a pointer to spin up a **standalone TD project**. Discuss which with the owner before building.

**When to revisit:** Only if the owner explicitly wants the MVP-here version; otherwise route the full game to a separate project. The most systems-heavy idea on the backlog.

**Notes:** Owner idea (2026-07-03): "tower defense game like monsters or Kingdom Rush." Core loop: **enemies (monsters) march along a fixed path** from a spawn to your base/exit; you **place & upgrade towers** on buildable spots beside the path; towers **auto-target and attack** enemies in range; **kills earn gold** to build/upgrade more; **waves escalate**; enemies that reach the exit cost **lives** (lose all = game over); **survive all waves = win**. Systems to build (scope as MVP → richer):
- **Path** (waypoint polyline; enemies lerp along it) + **buildable tower slots**.
- **Enemy types** (fast/weak, slow/tank, maybe flying or armored) with HP bars, speed, bounty; **wave definitions** (a schedule of spawns, ramping).
- **Tower types** (à la Kingdom Rush: archer = fast single-target, cannon/artillery = slow AoE splash, mage = pierces armor, + maybe a barracks that spawns blockers) with **range/damage/fire-rate**, **targeting** (first/closest/strongest), **projectiles**, and **2–3 upgrade tiers** each.
- **Economy + UI:** gold counter, lives, wave counter, a tower-build palette (tap a slot → choose tower → pay gold), sell/upgrade menu, a start-next-wave button, speed-up toggle.
- **Juice:** hit flashes, death poofs, projectile trails, gold-pop numbers, a "wave incoming" banner; synth audio (shoot/hit/enemy-death/gold/wave/lose per the audio bar).
- ⚠ **Scope + legal:** this is FAR bigger than a typical one-page toy — plan an MVP (1 path, 2–3 tower types, 3–5 waves, 2 enemy types) then expand. Tower defense is a genre (fine); **Kingdom Rush is a specific game** — use our **own art/theme/name** (e.g. a neon/fantasy/bug-invasion skin — offer via AskUserQuestion), not its assets or branding. Category `game`. Full add-a-toy pipeline (registry/sitemap/NL/card+`:not()`/og-gen, hub cache-bust); real rendered card + OG.
---
### New toy: Community draw (shared/social drawing)  ⚠ needs a backend — maybe its own project

**Why it matters:** The **first multiplayer/social toy** — users draw and see each other's drawings, which gives the site the repeat-visit pull that solo toys structurally can't have (you come back to see what changed / what others made). That's a genuinely different value lane from the self-contained arcade/generative toys and worth having in the portfolio.

**When to revisit:** Next new-toy build session, **once shared persistence is sorted** (i.e. once we've decided this belongs on one-page-toys vs. as a standalone project — see scope note). The owner flagged it as "for one-page-toys but maybe something bigger."

**Notes:** Owner idea (from Claude mobile, 2026-07-10). ⚠ **Departs from the self-contained single-file rule** (`.ai/memory/DECISIONS.md`, 2026-07-03: one-page-toys builds are small/self-contained, no server state) — unlike every current toy, this needs a **backend for shared state**. Supabase is already in the portfolio stack (used by PulseDB), so that's the natural backend, but hosting server state on a one-page-toy breaks the site's core constraint → this may be **better as its own project**; decide that before building (same routing as Tower Defense / billiards-if-it-grows).
- **Decide scope early — two very different products:** (a) **one shared canvas** everyone draws on together (real-time-ish collaborative surface, feels alive, but griefing is instant and total) vs. (b) a **gallery of individual submissions** (each person draws their own, browse everyone's — easier to moderate, no live-collision problem). These have almost nothing in common in build terms; pick one first.
- ⚠ **Moderation/abuse is the main open question** for anything community-submitted — offensive drawings, spam, and (for shared-canvas) griefing/defacement. Needs at least a plan (report/flag, per-session rate limits, clear/undo, maybe review-before-public for the gallery variant) before it ships publicly. This is the real blocker, not the drawing tech.
- Drawing surface itself is well-trodden (canvas pointer strokes, pressure/size, palette, undo) and reuses the repo's canvas/audio discipline; the hard part is entirely the shared-state + moderation layer.
---

