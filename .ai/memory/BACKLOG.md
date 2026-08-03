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
### New toy: Pinball (mini table)

**Why it matters:** A flagship arcade classic with enormous nostalgia and replay pull — real flipper physics, bumpers, and a score chase. The kind of showpiece that gets shared. Category `game`.

**When to revisit:** Next big-game round. The largest game idea on this list — scope the flipper/ball physics and a single curated table first; keep it one table, no progression (per the keep-it-small rule).

**Notes:** AI suggestion (2026-07-05, per-category brainstorm). One lovingly-crafted mini table: two flippers (tap left/right halves or arrow keys), plunger launch (pull-drag), bumpers/slingshots that kick, rollover lanes, maybe one ramp. Ball = circle vs. line-segment/arc table geometry (continuous collision so it never tunnels); flippers as rotating segments with angular impulse. Score + best in `localStorage`, multiball optional stretch. Design bar: a curated neon-noir or retro-space table with lit inserts that react, bumper flash, screen-shake on slam; synth arcade audio (flipper thock, bumper ding chorus, drain thud, launch spring) per the audio bar. Real card + OG; full add-a-toy pipeline.
---
### New toy: Bowling (real-3D, WebGL)

**Why it matters:** The natural next real-3D physics toy after the dice rebuild — a throw, a hush, then a hugely satisfying pin crash. Broad appeal, instantly understood. Category `game`. Reuses the zero-dep WebGL foundation (Newton's Cradle) + the rigid-body work from the 3D dice.

**When to revisit:** After the 3D Dice Roller ships — it will have proven the quaternion rigid-body + floor collision patterns this needs.

**Notes:** AI suggestion (2026-07-05). Drag-back-and-release (or swipe) to throw with power + curve/spin; ball physics down a glossy reflective lane (cubemap reflection like the cradle floor), 10 pins as rigid bodies (cylinder-ish collision or capsule approximations) with pin-pin knockdown chatter; frame scoring (strikes/spares) kept casual — 10 frames, best series in `localStorage`. Design: dark lane, single raking key light, lane-oil sheen, pin glow rims; synth audio: rolling rumble that follows ball speed, pin crash burst (layered inharmonic clatter), gutter thunk. Real card + OG; full pipeline.
---
### New toy: Snow Globe

**Why it matters:** Shake it and watch the world settle — a one-gesture cozy ritual everyone already knows. Seasonal spotlight potential (December feature). Category `wellness`.

**When to revisit:** Cozy round / before the holidays.

**Notes:** AI suggestion (2026-07-05). A glass globe (specular + refraction-ish distortion of the tiny scene) over a carved base; shake via drag-flick (or device motion) — hundreds of snow particles swirl with fluid-ish turbulence then settle drift-by-drift; tiny scene inside (cabin + pines, lantern-lit; maybe 2-3 scenes to cycle). Glass glints, warm interior glow, falling-settled snow accumulates. Audio: soft glass-muffled swirl, twinkling music-box phrase that plays as snow falls (reuse Music Box voice), settling hush. Real card + OG; full pipeline.
---
### New toy: Word Hunt (Boggle-style letter grid)

**Why it matters:** The site has zero word games — a gap for a huge audience. Drag-to-trace word finding is tactile, satisfying, and endlessly replayable with a fresh grid each round. Category `game`/word.

**When to revisit:** Next puzzle round. Needs a bundled dictionary decision (see notes) — scope that first.

**Notes:** AI suggestion (2026-07-05). 4×4 or 5×5 letter grid (dice-distribution letter frequencies); drag through adjacent letters (incl. diagonals) to trace words; 90-second round or zen mode; scoring by length; found-words list + best score in `localStorage`. Constraint: needs a word list — a compact common-word list (~30-60k words, ~200-400KB raw, less gzipped) bundled locally keeps it self-contained; prefix-trie for live validation. Keep name/trade dress distinct from Boggle. Design: warm wooden letter tiles or glowing runes, a glowing trace line, tile pop + pentatonic pluck per letter (rises with word length), fanfare on rare long words. Real card + OG; full pipeline.
---
### New toy: Nonogram / Picross

**Why it matters:** A beloved logic-puzzle genre (huge dedicated audience) absent from the site; solving reveals pixel-art — inherently rewarding and screenshot-friendly. Category `game`/puzzle.

**When to revisit:** Next puzzle round. Main scope: a curated set of solvable puzzles (or a generator + solvability checker).

**Notes:** AI suggestion (2026-07-05). Row/column count clues; tap to fill, long-press/second-tool to mark X; mistake-forgiveness toggle; 5×5 → 15×15 sizes. Content: procedurally generate boards and verify line-solvability, or hand-curate a pack of charming pixel-art reveals (animals, objects) — reveal animates + colorizes on completion. Timer + best per size in `localStorage`. Design: clean paper-grid aesthetic or glowing terminal; satisfying fill thunk, error buzz (gentle), completion chime + the picture coming alive. Keep the name generic ("Picture Logic" etc. — Picross is trademarked). Real card + OG; full pipeline.
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
### New toy: Dominoes (topple chains)

**Why it matters:** Set up, then topple — the payoff loop of every domino video, now yours to build. The setup-anticipation-cascade arc is deeply satisfying and infinitely replayable. Category `simulation`.

**When to revisit:** Next physics round; medium scope.

**Notes:** AI suggestion (2026-07-05). Top-down or slight-perspective table; drag to lay smooth curves of dominoes (auto-spaced along your stroke), stamp presets (spiral, fork, loop), then tap the first one — falling-domino physics chain (each tile a thin rigid body: tip → strike next; simplified 2.5D physics is fine if convincing). Colored tiles paint patterns visible mid-cascade. Undo/eraser; slow-mo replay of the topple; counter of toppled tiles. Audio: THE sound — accelerating clack-clack-clack cascade (velocity-scheduled clicks with slight pitch variance), a hush before the first tip. Real card + OG; full pipeline.
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
### New tool: D&D Character Builder (form → downloadable worksheet)

**Why it matters:** Broadens the gallery beyond arcade toys into a genuinely useful, highly-shareable **tabletop utility** with strong evergreen search demand (huge D&D audience). A guided character-builder that spits out a clean printable/downloadable sheet is the kind of "one tool that does one thing well" that fits the site and drives top-of-funnel discovery. Different lane from the games — sits in the light/dark Geist **`tools/<slug>/` utility family** (like Meeting Cost Meter / Countdown / Sleep Cycle), not a full-bleed Canvas toy.

**When to revisit:** Next utility/tool round (owner interest in a broader tool). More of a form/UX + PDF-generation build than a physics/Canvas build.

**Notes:** Owner idea (2026-07-03): "D&D Character Builder form with downloadable worksheet(s)." A guided form that walks a player through building a character, then generates one or more **downloadable / printable worksheets** (a filled character sheet). Scope to consider:
- **Form flow:** name, race/species, class, background, ability scores (point-buy or standard array or roll), skills/proficiencies, alignment, starting equipment, spells (for casters), personality/bonds/ideals/flaws. Auto-compute derived stats (modifiers, proficiency bonus, AC, HP, initiative, saving throws, skill bonuses) so the user doesn't have to.
- **Downloadable worksheet(s):** render a clean character sheet the user can **download (PDF) or print** (`window.print()` with a print stylesheet is the zero-dependency path; a PDF via canvas/jsPDF is heavier — decide based on fidelity wanted). Possibly a multi-page set: main sheet + spells + inventory/notes.
- **Share/resume:** encode the build in the URL hash so a character is shareable/re-openable (cf. Countdown/Aurebesh hash-sharing), and/or save to `localStorage`.
- ⚠ **LEGAL/IP:** D&D / Dungeons & Dragons and the official sheet layout are Wizards of the Coast trademarks/trade dress. Keep it legally safe — use the **SRD 5.x / Creative Commons (CC-BY-4.0) content** only (races/classes/spells released under the SRD), our **own original sheet layout** (don't reproduce the official WotC sheet), and avoid the D&D logo/branding. Consider a generic-but-clear public name (e.g. "Character Sheet Builder" / "Adventurer Builder" / "TTRPG Character Forge") with D&D/5e as search keywords in the NL tags rather than the visible brand. Confirm SRD scope before shipping.
- **Design quality bar:** the polished light/dark Geist tool system (topbar + brand + theme toggle), a clean multi-step form, a live preview of the sheet, an on-brand printable sheet design (parchment or clean-modern — offer via AskUserQuestion). CSS-motif or rendered card + OG; full add-a-toy pipeline (registry/sitemap/NL/card+`:not()`/og-gen, hub cache-bust). Category `utility`.
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

### New toy: Steady Hand (buzz-wire)

**Why it matters:** The last of the Perfect Circle precision family. Same proven DNA — one dead-simple input, an instantly brutal score, a share-worthy number — but sustained motor control rather than a single gesture, so it plays differently from its siblings. (Perfect Timing shipped as No. 092 and Color Match as No. 099, both 2026-07-25.)

**When to revisit:** Any time we want a small, fast, high-shareability build.

**Notes:** Trace a glowing wire A to B without touching the edges; scored on time plus how close you skirted the walls, with a buzz and a shake on contact. Great audio payoff — a rising hum as you near an edge, a satisfying buzz on a hit. Single input identical on mouse and touch, best in `localStorage`, share pill, ticket-economy earn key, real card + OG, full pipeline.

---
