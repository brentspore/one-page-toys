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

### New toy: Random Maze (solve-the-maze)

**Status:** done

**Why it matters:** A maze is broadly appealing and endlessly replayable — random generation means infinite content from a small amount of code, and it fits the "FUN / playful / experiential" direction and the `game` category. Photographs well for a card/OG. Self-contained vanilla-Canvas build.

**When to revisit:** Next time we're building new toys (owner picks candidates via AskUserQuestion). Quick, satisfying build.

**Notes:** Owner idea (2026-07-02): "a randomly generated maze you have to get through." Procedurally generate a **perfect maze** (recursive backtracker / DFS, or Prim's) on a grid; player navigates start→exit via swipe / arrow keys / tap-to-path; new maze each play, difficulty scales via grid size. Add tension with a subtle "fog" / limited-view radius or a minimap; **timer + best-time** in `localStorage`, confetti on a new best. Optional path-trail so you can see where you've been. Must be **interactive + a curated little world** per the design quality bar (lighting, palette, depth — not flat cells; e.g. hedge maze / stone dungeon / neon grid). Touch controls (swipe to move) for mobile. Synth footstep / wall-bump / solve voice per the audio quality bar. Real rendered card + OG; full add-a-toy pipeline (registry/sitemap/NL/card+`:not()`/og-gen, hub cache-bust).

---

### New toy: Vertical-scrolling maze runner (adventure)

**Why it matters:** A distinct, more dynamic take than the static solve-the-maze — an endless, reflex-driven descent that's naturally replayable and score-chasey (viral/arcade lane, cf. Flappy/Tiny-Wings ideas). Endless procedural terrain = infinite content. `game`/`arcade` category.

**When to revisit:** Next fun/arcade toy round. Slightly more physics/scroll work than the static maze — scope the terrain generation + collision first.

**Notes:** Owner idea (2026-07-02): "an adventure game — top scrolling down: move the adventurer through while the randomly generated terrain comes down from the top of the screen." The adventurer stays near the bottom; **procedurally-generated maze/cavern terrain scrolls DOWN from the top** and the player steers left/right (and maybe up/down within a band) to thread the passages before they reach the bottom — a continuous endless run, not a fixed board. Scroll speed **ramps up** over time for escalating difficulty; touching a wall = game over (or a life/health system). Score = distance survived; **best in `localStorage`**, new-best confetti. Generation: stream new maze rows/segments as they enter from the top (rolling ring buffer, guaranteed-passable — carve at least one open path per row so it's never a dead end); collision vs. the wall cells. Controls: swipe/drag or tilt/arrows, touch-first. **Design quality bar:** a curated descending world — themed tileset (cave, ruins, ice, circuit board), depth/parallax, torch or glow lighting on the adventurer, a motion/dust trail, screen-shake + flash on crash. Synth audio per the audio bar: footstep/scrape ambience, near-miss whoosh, crash thud, escalating tension bed (iOS unlock + Sound toggle). Real rendered card + OG; full add-a-toy pipeline (registry/sitemap/NL/card+`:not()`/og-gen, hub cache-bust).

---

### New toy: Connect-the-dots puzzle (Dots & Co-style)

**Status:** done

**Why it matters:** A calm, minimalist, deeply satisfying connect-the-dots puzzle — instantly learnable, endlessly replayable, and gorgeous in a restrained way that suits the design bar and photographs beautifully for card/OG. Fits `game`/puzzle and the cozy lane. The connect-loop mechanic is genuinely juicy (chain sounds, board-clear cascades).

**When to revisit:** Next puzzle/cozy toy round. Moderate scope — the grid + gravity refill + loop-detection is the meat.

**Notes:** Owner idea (2026-07-02): "something inspired by Dots & Co (iOS)." Core mechanic: a grid of **colored dots**; **drag to connect adjacent same-color dots** (orthogonally — up/down/left/right, no diagonals); releasing clears the connected chain and dots above **fall to refill** with new ones dropping in from the top. **Closing a loop** (a square/rectangle path back to a dot of that color) clears **ALL dots of that color** on the board — the signature satisfying move. Keep it legally distinct (our own palette, dot style, name — not a clone). Modes to consider (pick one, or offer via AskUserQuestion): a **zen/endless** relaxing mode (just chain and clear, ambient) and/or a **move-limited or timed** score chase (best in `localStorage`, new-best confetti). Design: minimalist calm — soft pastel dot palette, gentle bounce/drop physics on refill, a glowing connection line that thickens as the chain grows, a ripple/pop when dots clear, a full-color-clear flourish (screen wash) on a closed loop. Touch-first (drag). **Audio quality bar:** an ascending pentatonic pluck per dot added to the chain (rises with chain length — the addictive part), a satisfying pop/chime on clear, a shimmering cascade on a loop-clear (bus → reverb/delay, iOS unlock + Sound toggle). Real rendered card + OG; full add-a-toy pipeline (registry/sitemap/NL/card+`:not()`/og-gen, hub cache-bust).

---

### New toy: Alto's-Adventure-style trick sandboarder

**Why it matters:** A beautiful, flowy endless-runner with genuine trick depth and a famously gorgeous, moody art direction — exactly the kind of high-design-bar experience that shows off the site and photographs stunningly for card/OG. `game`/`arcade`, cozy-but-skillful lane. Strong viral/replay potential (score chase + "one more run").

**When to revisit:** Next fun/arcade toy round. More scope than the Flappy idea — the trick/rotation system + grinds + procedural terrain are the meat; consider building AFTER (or instead of) the Tiny-Wings idea to avoid two near-identical hill-gliders.

**Notes:** Owner idea (2026-07-02): "inspired by Alto's Adventure." Endless downhill boarder over procedurally-generated rolling hills. **One button: tap-and-hold to jump; hold in the air to backflip/rotate** (release to land — landing upright/at-angle keeps speed, over-rotating crashes). Add **grinds** (ride ropes/rails/bunting for a speed boost + combo), gaps/chasms to clear, and collectibles (coins / a chased critter). Chain tricks + grinds for a combo multiplier; score = distance × combo; best in `localStorage`, new-best confetti. **DISTINCT from the Tiny-Wings idea** (which is pure speed/flow diving with no tricks): this one's identity is the **backflip/grind trick system + a serene, cinematic mood**. Keep legally distinct (our own boarder + world, not Alto). **Design quality bar is the whole point here:** signature Alto-esque minimalist elegance — layered parallax mountains, a slow **day↕night + dynamic weather** cycle (dawn/dusk/storm/aurora), long soft shadows, a particle snow/dust spray off the board, gentle camera. Synth audio per the audio bar: whoosh on jump, a rising tone through a flip, a satisfying land thud, a grind hum, ambient wind/pad bed that shifts with time-of-day (iOS unlock + Sound toggle). Touch-first (tap-hold). Real rendered card + OG; full add-a-toy pipeline (registry/sitemap/NL/card+`:not()`/og-gen, hub cache-bust).

---

### New toy: Zuma-style marble shooter

**Status:** done

**Why it matters:** A classic, tense, deeply satisfying match-3 chain-shooter — instantly readable, combo-driven, and endlessly replayable. Distinct mechanic from anything in the gallery (aim-and-shoot vs. tap/drag), strong arcade/viral appeal, and a vivid look that pops on a card/OG. `game`/`arcade` (or puzzle).

**When to revisit:** Next fun/arcade toy round. Moderate scope — the track path + advancing chain + insert/match/collapse logic is the meat.

**Notes:** Owner idea (2026-07-02): "inspired by Zuma." A **chain of colored marbles advances along a curved track** toward an end-point (a hole/goal); a **shooter fixed in the center rotates to aim and fires colored balls** into the chain. A ball that lands so it makes **3+ same-color in a row clears them** (pop), the gap **closes** and can trigger **chain-reaction combos**; clear the whole chain before it reaches the end = win/next wave, chain reaches the end = game over. Controls: aim with mouse/finger position, tap/click to shoot; a **swap** (current↔next ball) on a second input. Feel: back-pressure combos (matched-color ends colliding after a gap closes re-match), speed ramps as it nears the goal. Score + best in `localStorage`, new-best confetti; escalating waves for difficulty. Keep legally distinct (our own shooter character + theme — e.g. jungle idol / arcane orb / robot core — not Zuma's frog; offer options via AskUserQuestion). **Design quality bar:** glossy marbles with specular highlights, a smooth **Catmull-Rom / bezier track** with depth (the chain snakes convincingly), a curated themed world, particle burst + flash on each pop, screen-shake on big combos. Synth audio per the audio bar: a launch *thunk*, a rising pop pitch that climbs with combo size, a chain-reaction cascade, a danger/near-end warning bed, win fanfare / lose rumble (bus → reverb, iOS unlock + Sound toggle). Real rendered card + OG; full add-a-toy pipeline (registry/sitemap/NL/card+`:not()`/og-gen, hub cache-bust).

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

### New toy: Flappy-Bird-style one-tap flyer

**Status:** done

**Why it matters:** A proven viral/addictive one-tap arcade game — trivially learnable, endlessly replayable, great for top-of-funnel discovery and sharing a high score. Fits the `game` category and the "super addictive/viral" lane (cf. Perfect Circle, Slice It). Small, self-contained vanilla-Canvas build.

**When to revisit:** Next fun/arcade toy round. Quick to build; lean on it when we want an easy crowd-pleaser.

**Notes:** Owner idea (2026-07-02): "something inspired by Flappy Bird." Core loop: tap/click/space to flap → gravity pulls the character down → thread gaps in scrolling obstacles; one hit = game over; score per gap passed; best in `localStorage`, new-best confetti. Keep it legally distinct (our own character + theme — not a bird-in-pipes clone): pick a fresh skin (e.g. a paper plane through skyscraper gaps, a firefly through branches, a submarine through coral, a rocket through asteroids) — offer options via AskUserQuestion. Must clear the **design quality bar**: a curated little world (parallax layers, lighting, palette, particle trail), not flat rects — study the tuning that made Flappy hard-but-fair (gravity, flap impulse, gap size, scroll speed ramp). Juicy feel: screen-shake + flash on crash, a satisfying flap sound + score blip + fail thud (synth, per the audio quality bar, iOS unlock + Sound toggle). Touch-first (tap anywhere). Real rendered card + OG; full add-a-toy pipeline (registry/sitemap/NL/card+`:not()`/og-gen, hub cache-bust).

---

### New toy: Tiny-Wings-style hill glider

**Why it matters:** Another beloved, deeply satisfying one-touch arcade game with a gorgeous, tactile feel — momentum-based sliding down rolling hills. High "juice"/flow ceiling that suits our design bar, and a distinct mechanic from the Flappy-style flyer (momentum + terrain vs. flap-through-gaps). Strong `game`/`arcade` candidate. Pairs well with a warm, painterly art direction that photographs beautifully for card/OG.

**When to revisit:** Next fun/arcade toy round. A notch more physics work than the Flappy idea — scope the terrain + momentum first.

**Notes:** Owner idea (2026-07-02): "something inspired by Tiny Wings." Core mechanic: procedurally-generated rolling **sine/perlin hills** scroll left; **hold to dive** (increase downward pull) so you build speed on the downslopes and **launch off crests** into long airborne glides — timing dives to hills is the whole skill (a perfect slope-hug = big speed + a "perfect takeoff" bounce). One button (tap-and-hold). Character = our own skin (keep it legally distinct — not a literal little bird; e.g. a seed pod, a paper glider, a stingray, a ski jumper — offer options via AskUserQuestion). Scoring: distance + speed/flow multiplier, maybe a day→night ramp like the original; best in `localStorage`, new-best confetti. Physics: velocity along terrain, gravity, a dive impulse, air drag, landing-angle matters (smooth landing keeps speed, hard landing kills it). **Design quality bar:** rich layered parallax hills, warm gradient sky (dawn/dusk), soft island silhouettes, a dust/spray particle trail, smooth camera — a curated painterly world, not flat curves. Synth audio per the audio bar: whoosh on dive, a rising "whee" on a good launch, soft land thud, ambient wind bed (iOS unlock + Sound toggle). Touch-first. Real rendered card + OG; full add-a-toy pipeline (registry/sitemap/NL/card+`:not()`/og-gen, hub cache-bust).

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

### New toy: Ink Marbling (generative visual)

**Why it matters:** Calm, gorgeous, endlessly satisfying generative visual — drop and swirl blooming clouds of color into dark water (paper-marbling). Cozy lane, photographs beautifully, strong "just watch / gently play" appeal. Distinct from the existing visual toys.

**When to revisit:** Next generative-visual round. Moderate build (a lightweight fluid/advection or a bloom-and-comb particle model — doesn't need a full Navier-Stokes solver like Vapor).

**Notes:** Owner idea (2026-07-03, from the generative-visual shortlist; was also a runner-up when Ferrofluid was replaced). Drop ink (tap) → a bloom of color expands and mixes into the "water"; drag to **comb/rake** the currents (the classic marbling gesture) so blooms stretch into feathered veins; palette options (jewel / monochrome ink / metallic gold). Calm, no fail. Reuse Vapor's dye-advection ideas OR a simpler concentric-ring + comb-displacement model. Real card + OG; full add-a-toy pipeline. Category `visual`.

---

### New toy: Slime Mold (Physarum) (generative visual)

**Why it matters:** Mesmerizing emergent behavior — thousands of tiny agents lay down glowing trails and follow each other, self-organizing into living vein-like networks. High "watch it come alive" appeal; a genre-distinct generative toy.

**When to revisit:** Next generative-visual round. Meaty-ish (agent sim + a trail map with diffuse/decay), but well-understood (Physarum / Jeff Jones model).

**Notes:** Owner idea (2026-07-03, from the generative-visual shortlist). Model: N agents each with position + heading; each senses the trail map ahead (3 sensors L/C/R), steers toward the strongest, moves, and deposits trail; the trail map **diffuses + decays** each frame → emergent networks. Interactive: **tap/drag to drop "food"/attractant** the agents swarm toward; maybe a palette + a "reset" and a density/behavior slider. GPU would be ideal but a CPU version at ~20–60k agents on a downscaled trail grid is doable in vanilla JS/typed arrays (keep the trail grid modest, cap agents for mobile). Glowing on dark. Real card + OG; full pipeline. Category `visual`.

---

### New toy: Reaction-Diffusion (Turing patterns) (generative visual)

**Why it matters:** Hypnotic organic patterns — spots, stripes, mazes, and coral-like growth that morph endlessly (Gray-Scott model). A classic generative-art centerpiece; deeply satisfying to watch and tweak.

**When to revisit:** Next generative-visual round. Moderate build (a two-chemical grid update; the math is simple but needs a decent grid resolution + a couple of update steps/frame for speed).

**Notes:** Owner idea (2026-07-03, from the generative-visual shortlist). Gray-Scott reaction-diffusion on a grid (two chemicals A,B; feed/kill rates control the regime). Interactive: **drag to seed** new growth (paint B), buttons to switch the **regime** (coral / mitosis / worms / spots / maze) by changing feed/kill, a speed control, and a palette (the density mapped through a gradient). Alive on arrival (start with a seeded blob growing). Run 2–4 solver steps/frame for smooth motion; keep grid ~200² and render via ImageData scaled up. Real card + OG; full pipeline. Category `visual`.

---

### New toy: Flow Field (generative visual)

**Why it matters:** Silky, elegant generative art — thousands of particles ride a hidden Perlin-noise vector field, painting layered flowing ribbons. The quintessential "flow field" generative aesthetic; gorgeous stills for a card.

**When to revisit:** Next generative-visual round. Light-to-moderate build (particles + a noise field; the classic generative-coding sketch).

**Notes:** Owner idea (2026-07-03, from the generative-visual shortlist). A hidden vector field from layered value/Perlin noise (evolving slowly over time); thousands of particles sample the field at their position and steer along it, drawing thin fading trails → silky ribbons. Interactive: **drag to disturb/push** the field near the cursor, **tap to reseed** the field (a whole new pattern), palette + trail-length/persistence controls. Additive glow on dark; particles recycle when off-screen or aged. Real card + OG; full pipeline. Category `visual`.

---

### New toy: Particle Life (generative visual)

**Why it matters:** Surprisingly alive — a few colors of particles governed by simple asymmetric attraction/repulsion rules self-assemble into cells, chasers, membranes, and drifting "creatures." Endlessly fascinating emergent life from tiny rules; a standout generative toy.

**When to revisit:** Next generative-visual round. Moderate build (N-body-ish interactions — needs spatial hashing / a cutoff radius to stay fast; cap particle count for mobile).

**Notes:** Owner idea (2026-07-03, from the generative-visual shortlist). ~4–6 particle "species" (colors); a random (or curated) **attraction matrix** defines how each species is attracted to/repelled by each other within a cutoff radius; integrate with friction. Emergent structures form. Interactive: **tap to spawn/scatter**, **drag to stir**, a "**new rules**" button (reroll the matrix → a whole new ecosystem), palette, particle-count/friction sliders. Use a **spatial grid** for neighbor queries so it stays 60fps with a few thousand particles (cap on mobile). Glowing dots on dark. Real card + OG; full pipeline. Category `visual`.

---
### Upgrade dice to 3D

---