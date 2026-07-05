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

**Status:** next

**Why it matters:** A beautiful, flowy endless-runner with genuine trick depth and a famously gorgeous, moody art direction — exactly the kind of high-design-bar experience that shows off the site and photographs stunningly for card/OG. `game`/`arcade`, cozy-but-skillful lane. Strong viral/replay potential (score chase + "one more run").

**When to revisit:** NOW — owner is building this tonight (2026-07-05). Deep research is DONE (4-agent workflow: mechanics/feel, art direction, terrain/physics tech, audio — sources include the Alto's wiki trick tables, Harry Nesbitt's making-of, the Kodeco/Feronato Tiny-Wings terrain tutorials, a Love2D Alto clone with real constants, and Team Alto interviews). The blueprint below is the build brief. Coexists with the Tiny-Wings idea (both being built): THIS one = serene tricks/grinds/flow; Tiny Wings = cheerful pump-for-speed/fever/sun-race.

**Notes:** Owner idea (2026-07-02); FULL BUILD BLUEPRINT (researched 2026-07-05). **CORE INPUT (one pointer/spacebar, the whole game):** press on ground = jump INSTANTLY (no charge; impulse `JUMP_VY≈620px/s + 0.12*s` so speed grows jumps; `G≈1700px/s²`); press-and-HOLD in air = backflip at constant `ROT_SPEED≈360°/s` (release stops rotation w/ ~80ms decay; re-press resumes — mastery lives in the RELEASE, never auto-complete flips); tap while grinding = hop off. Forgiveness: coyote-time 80ms after leaving a crest, 100ms input buffer before landing. **THE LOAD-BEARING FLYWHEEL:** a landed trick banks points AND grants a decaying speed boost (+18–30% vel over ~3–5s, refreshed per trick) WITH boost-invincibility (smash rocks +50 / campfires +100 that otherwise kill you) → more speed → bigger air → bigger tricks. Score and momentum are ONE system. **COMBO RULE (canonical):** all trick points while the board never touches plain snow are SUMMED then MULTIPLIED by the number of tricks in the chain, banked only on clean landing, lost entirely on crash. Trick table: backflip 10 / double 60 / triple 200 / quad 600; proximity-flip 300 (inverted + head skims within ~1.2 rider-heights of terrain); rock bounce 80; ramp kicker 20; chasm jump 50; grinds 10/m, 60m-grind bonus 300, "kiss the rail" (mount in last ~3m) 250. Show a live pending-chain chip; multiplier pop on bank = rising pentatonic chime pitched by N. **TERRAIN (the rhythm instrument):** cosine-interpolated random keypoints (NOT summed sines — keypoints give authorial control + zero slope at every crest/trough): `L=rand(280,520)px`, `y=ymid+a·cos(πt)` per segment (slope/curvature analytic), mean descent `BASE_SLOPE 10–14°` forever downhill, amp 40–120px early → 70–220px by 30k px w/ a slow breathing oscillation (mellow↔steep sections), clamp max segment slope ≤55°; stream keypoints as the ring buffer (gen ahead 2 screens, drop 0.75 behind; rebase world origin every ~200k px). Every rand(8,14) keypoints insert ONE feature: a CHASM (gap 220–420px scaled by expected speed; far-side drop `= max(60, G·(GAP_W/(0.8·s_expected))²/2)` so 80%-speed riders still land the downslope; warning sign ahead; no-snow span, fall below lip+250 = run ends) or a RAIL RUN. **PHYSICS:** grounded scalar speed along slope: `a = G·sinθ − DRAG_K·s − ROLL_F` (DRAG_K 0.32/s, ROLL_F 60, MIN_SPEED 150 anti-stall, soft max ~1250); pop-off crests DERIVED not authored: per frame compare snapped-y vs ballistic-y — if terrain falls away >1.5px, go airborne with v along the launch slope (concave valleys auto-stick); PUMP: holding on a ground downslope ×1.35 slope accel, holding in air ×2.2 gravity (dive); landing converts air velocity by projecting onto the tangent (dive→speed = the swoop). Substep physics when `s·dt>12px`. **LANDING BANDS:** |board−slope| ≤25° = clean (keep 100% speed, bank combo, +8° window bonus if a full flip completed); 25–60° = stumble (speed×0.55, combo drops, 0.5s crash-immunity); >60° = crash (tumble ragdoll, run ends, one honest death, instant one-tap restart). AUTO-LEVEL assist 200°/s ONLY while released && predicted-landing <0.45s (predict via ~10×50ms analytic steps) — rescues sloppy singles, never saves lazy doubles; ease board onto slope over 150ms w/ suspension squash (the buttery feel). **GRINDS (combo glue):** bunting lines = straight chords ~28px above 2+ descending crests (posts to terrain, sagging wire + pennant flags drawn, physics = the chord); snap ONLY from air, descending (vy≥−40), within 16px vertical — deliberately NO angle requirement (grinds are forgiveness machines); on rail: `a=G·sin(railAngle)`, zero friction (free speed), points tick, sparks (pooled, 'lighter'), quiet comb-filter scrape; tap = hop (0.8× jump), or ride off the end. **CAMERA:** camX locks rider at anchor 0.34W→0.26W as speed rises (look-ahead by sliding anchor, not lerp); camY exp-lerp `CAM_KY=3.2` (2.2 during big air so the rider climbs the frame), target rider at 0.55H blended 30% toward terrain 250px ahead; zoom 1.0→0.86 with speed (→0.8 on huge air), pivot at rider; shake only on stumble/crash. **ART (flat silhouettes, the sky gradient is the master control):** NO outlines, no textures, ≤5 hues on screen, one saturated accent (the scarf). Layer stack (scroll factor / tint = mix(layerColor, skyHorizon, depth)): sky fixed → celestial (sun/moon disc + radial glow drawn AFTER sky BEHIND silhouettes — the "sun sinks behind the range" shot — + additive screen flare via 'lighter' at 0.05–0.15 when sun visible; stars fade in by night, occasional shooting star) → far range 0.08–0.12 (barely darker than horizon) → mid 0.2–0.3 → near 0.45–0.6 → playfield 1.0 (darkest mass; snow = flat fill + 3px bright rim stroke + darker under-band; chunk-cached Path2D per 1024px, never rebuilt per frame) → sparse foreground accents 1.3–1.6. DAY/NIGHT: one dayT param, full cycle ~8min (dawn 15% / day 30% / dusk 15% / night 40%), lerp keyframe palettes in HSL (naive RGB passes through dead gray — insert saturated dusk keyframes); WEATHER = independent intensity axis over any hour: snowfall (2–3 particle depths), blizzard (wind + streaked flakes + white veil), thunderstorm (slate palette + diagonal rain streaks + 300ms additive flash that LIGHTENS far silhouettes + delayed thunder), fog bands parked BETWEEN parallax layers, rare rainbow after light rain. CONCRETE PALETTES (gradient stops, from research): ALPINE DAY sky #91b7a4→#cfe3d6, far #689689, mid #55877b, playfield #343f23→#15231a, sun #fdf6e3; DAWN #2e3466→#7a5a8e→#c96a80→#f7b16c, ranges #8a6a92/#5c4a78/#3a2d55, playfield #262040; DUSK #3b2d5e→#8e4a6e→#d96a5a→#f2a65a, sun #ffe0b0 huge glow; NIGHT #0b1026→#17203e→#2e4a6b, moon #e8f0ff, ranges #1a2742/#131c33, playfield #080d1c, crest rim #9fb4d8; STORM slate #37404f→#6b7684, flash #fff7e8@0.5. RIDER: tiny (~30–45px) flat 2–3-tone silhouette, rotates as one rigid unit; THE SCARF = verlet ribbon 10–24 points pinned at neck (repo has cloth verlet know-how), dragged by rider velocity so it streams with speed + whips through flips, GROWS with combo / shortens when idle (the diegetic speedometer — Alto's most iconic pixel), tapered stroke ~5px→1px, accent coral #e5484d (ours, not Alto's); snow-spray particles at board contact scaled by speed (cap 120) + landing burst. **AUDIO (all synth, shared master chain: per-voice dry+wet → convolver w/ smooth 4s impulse + feedback delay 0.35s fb0.3 feeding the reverb → compressor → 11kHz lowpass → outGain; buses: musicBus/worldBus/sfxBus; iOS unlock + Sound toggle):** MUSIC = calm pad (sine root + fifth + detuned triangle octave + a ninth gated by day, one lowpass whose cutoff lerps 900–2400Hz with dayPhase, 0.06Hz breathing LFO) + sparse generative piano — PORT the Vapor `melodyTick` pattern (`toys/vapor/script.js:358`): interval 2.8–6s w/ jitter (shortened subtly by speed), 30% rests, pentatonic random-walk pulled toward a drifting contour, register/decay darker+lower at night. NOT literally reactive — fluid enough to feel alive (Team Alto's own philosophy). SFX: carve bed (looped pink→bandpass 400+speedNorm·1800Hz, gain 0→0.14·speedNorm; KILLED in 40ms on takeoff, restored in 120ms on landing — that restore IS the landing reward), jump whoosh (bandpass sweep 300→1400), rotation whoosh once per flip (center ×1.15^n per consecutive flip), landing thump (Fireworks `boom()`-lite, `toys/fireworks/script.js:409`, velocity-scaled) + powder puff (two decorrelated lowpassed bursts ±0.4 pan), combo chime ladder (pentatonic degree per level, hot delay send), grind hum (comb filter: 3–6ms delay fb 0.85 + inharmonic partials + Poisson spark ticks), wind 2-layer (body 250Hz + whistle 900Hz, random-walked LFOs, gust envelopes), rain bed + delayed distant thunder (boom() lowpassed 300→50Hz, 80–200ms after the flash), crash = staggered thumps + 0.6s master-lowpass dip to 1.2kHz (a musical wince, no buzzer). Storm ducks musicBus −6..−9dB. **CUT (keeps it a one-sitting toy):** goals/levels/XP, characters/unlocks/workshop, elders chase, llama mechanic (a decorative llama at the start at most), wingsuit, coins/power-ups/revives, separate zen mode (the whole toy IS zen-leaning), Odyssey biomes/balloons/wall-rides. Persist ONLY best score (+ optional best distance) in `localStorage`. **LEGAL:** new name + no Alto wordmark, original rider/scarf color/palettes, original music. **FEEL RULES:** tune "too kind" first then pull back; failure must be legible + self-owned; rewards physical + diegetic (speed/scarf/zoom — HUD nearly vanishes: score, distance, pending-chain chip); terrain generated from authored keypoint features, never raw noise. **HUD/FLOW:** instant restart <1s, best-score chip, new-best flourish. Full add-a-toy pipeline (registry prepend `game`, sitemap, NL incl. "alto"/"snowboard"/"backflip", card rule + `:not()`, og-gen, REAL rendered card/OG from a mid-flip dusk moment, hub cache-bust, headless verify incl. 375px + autopilot trick test, temp hooks removed).

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

**Status:** active

**Why it matters:** Owner idea (2026-07-05): rebuild the existing Dice Roller (toys/dice-roller/) with real tumbling 3D dice — a major glow-up for an existing toy using the proven zero-dep raw-WebGL foundation from Newton's Cradle.

**When to revisit:** IN PROGRESS now — research workflow running (physics, provably-fair relabel trick, d4–d20 geometry/numbering, texture atlas); design questions to owner next, then build in place (same slug).

**Notes:** Real rigid-body tumbling (quaternions, floor/wall/die-die collision, settle detection, read the top face), CSPRNG-fair via face-relabel trick, canvas texture atlas for numbers (d4 corner-read, d10 trapezohedron), synth dice-clatter audio, drag-to-throw. Keep all current features (d4–d20, pool, running total, best).

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

### New toy: Minesweeper

**Why it matters:** A beloved classic logic game missing from the collection — instantly recognized, deeply replayable, quick to build well. Category `game`/puzzle.

**When to revisit:** Any quick-win round between larger builds.

**Notes:** AI suggestion (2026-07-05). Classic rules with first-click-always-safe board generation; long-press/right-click to flag (touch-first); Easy/Medium/Hard grids; timer + best per difficulty in `localStorage`; chord-clicking for pros. Design bar: premium dark skin — beveled tiles with soft depth, satisfying reveal ripple on flood-fill, mine detonation shake + flash, confetti on a clean sweep; crisp synth ticks/pops per the audio bar, tension bed optional. Real card + OG; full pipeline.

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

### New toy: Breakout / brick smasher

**Why it matters:** An arcade staple with instant muscle-memory appeal and very juicy feedback potential (brick shatter, screen shake, multiball). Category `game`/arcade.

**When to revisit:** Next arcade round; medium-small scope.

**Notes:** AI suggestion (2026-07-05). Paddle follows pointer/touch; ball physics with paddle-english (hit position steers angle); a few hand-designed brick layouts cycling with speed ramp; power-ups kept minimal (widen, multiball, laser — pick 2); lives, score + best in `localStorage`. Design bar: neon-glass bricks that crack then shatter with particles, trail on the ball, bloom-y glow, screen-shake on last-brick; synth audio: pitch-rising brick pings (pentatonic ladder = the addictive part), paddle thock, multiball shimmer. Real card + OG; full pipeline.

---

### New toy: Darts

**Why it matters:** A quick, universally-understood aim-and-timing pub game; short sessions, high "one more throw" pull. Category `game`.

**When to revisit:** Quick-win round.

**Notes:** AI suggestion (2026-07-05). Aim via a drifting/oscillating reticle (timing skill) or drag-back throw with wobble; proper dartboard scoring (doubles/triples/bull); play 301/501 vs. a simple AI or a 10-dart high-score mode. Perspective board with a satisfying THUNK + dart quiver on landing; felt-lined pub-corner mood, warm spotlight; crowd-less quiet ambience, synth thunk/ding per the audio bar. Best in `localStorage`. Real card + OG; full pipeline.

---

### New toy: Air Hockey (vs AI)

**Why it matters:** Fast, physical, instantly fun on touch (finger = mallet); the table glow + puck clack is naturally juicy. Category `game`/arcade.

**When to revisit:** Next arcade round; small-medium scope.

**Notes:** AI suggestion (2026-07-05). Drag your mallet (bottom half only); puck physics with friction + wall bounce + mallet impulse; AI opponent with tunable reaction/speed (rubber-bands to stay fun); first to 7. Design: glowing neon table, air-hole dot grid, puck trail, goal flash + shake; audio: authentic hollow puck CLACK (velocity-scaled), table air hiss bed, goal horn (tasteful). Best-of streak in `localStorage`. Real card + OG; full pipeline.

---

### New toy: More card games — Video Poker + Pyramid

**Why it matters:** The card-render foundation (Solitaire/Blackjack: pips, courts, chips, felt, deal animations) makes each additional card game a cheap, high-polish win for the popular `game`/cards lane.

**When to revisit:** Any quick-win round — these were already flagged as follow-ups when Solitaire/Blackjack shipped.

**Notes:** AI suggestion (2026-07-05, consolidating the standing Pyramid/Video Poker note). **Video Poker (Jacks or Better):** bet chips, deal 5, hold/redraw once, standard paytable, bankroll persists (like Blackjack's `bj_bank`). **Pyramid:** clear pairs summing to 13 from a 28-card pyramid + stock; drag/tap pairs; win cascade like Solitaire's. Each is its own toy folder/slug. Reuse felt + audio bus; distinct table accent colors. Real cards + OGs; full pipeline each.

---

### New toy: Paper Snowflake Cutter (kirigami)

**Why it matters:** Deeply tactile childhood magic — cut notches from a folded paper wedge, then unfold to reveal the six-fold snowflake. The reveal moment is inherently shareable and photographs beautifully. Category `visual`/craft (Pottery Wheel energy).

**When to revisit:** Next visual/craft round — also a natural December feature.

**Notes:** AI suggestion (2026-07-05). Show a folded triangle wedge; drag to cut polyline snips from the edges (polygon clipping on the wedge shape); an unfold button (or auto-preview) mirrors the wedge 12× (6-fold + reflection) into the full snowflake with a paper-unfolding animation. Then: cut another, drift finished flakes in a gentle snow scene, download/share. Design: soft paper texture, scissor-line preview, warm desk-lamp scene vs. cool snowy backdrop for the reveal; audio: crisp paper-snip, soft unfolding rustle, a twinkle on reveal. Real card + OG; full pipeline.

---

### New toy: Mandelbrot Infinite Zoom (WebGL)

**Why it matters:** The definitive mesmerizing math-visual — smooth infinite-feeling zoom into the fractal with flowing palettes. A perfect fit for the proven zero-dep WebGL capability (fragment-shader compute). Category `visual`.

**When to revisit:** Next visual round; medium scope (precision handling is the crux).

**Notes:** AI suggestion (2026-07-05). Fragment-shader Mandelbrot with smooth (continuous) coloring + animated palette cycling; tap/drag to pan, pinch/scroll to zoom toward the cursor. Handle float precision: single-precision WebGL1 runs out ~10^-4 scale — use double-emulation (split-float) in-shader or cap zoom gracefully with a "journey" of curated deep-zoom waypoints. Julia-set morph mode as a second palette of play (drag to sweep the c-parameter live — very interactive). Design: curated palettes (ember, glacier, bioluminescent), subtle bloom; ambient drone that deepens with zoom depth per the audio bar. Real card + OG; full pipeline.

---

### New toy: Lite-Brite pegboard

**Why it matters:** Pure glowing nostalgia in the Pin Art / Magnetic Face family — punch luminous pegs into a black board and paint with light. Simple, tactile, screenshot-friendly. Category `visual`.

**When to revisit:** Quick-win visual round.

**Notes:** AI suggestion (2026-07-05). Dark board with a hex/square hole grid; pick from ~8 glowing peg colors, tap/drag to place (drag = paint), long-press to remove; each peg is a bright core + halo bloom on the dark board; optional template outlines (rocket, flower) as faint guides. Clear/save-to-PNG buttons. Trademark-safe generic name ("Glow Pegs" / "Peg Glow"). Audio: soft plastic *click-in* per peg (velocity-varied), gentle hum bed that thickens with board fullness. Real card + OG; full pipeline.

---

### New toy: Voronoi Stained Glass

**Why it matters:** Interactive geometry that reads as art — shatter a glowing stained-glass window into living cells that grow, merge, and recolor under your finger. Category `visual`/generative.

**When to revisit:** Next generative-visual round.

**Notes:** AI suggestion (2026-07-05). Voronoi diagram over drifting seed points; tap adds a seed (a new glass pane grows in), drag herds seeds; palettes = cathedral jewel tones with leaded borders, backlit glow (light source slowly moves like the sun through a window). Optional Lloyd-relaxation "settle" button for even panes. Audio: crystalline chime per new pane (pentatonic), soft glass shimmer bed. Real card + OG; full pipeline.

---

### New toy: Fractal Tree Grower (L-systems)

**Why it matters:** Watching a tree grow from your touch is quietly magical; parameterized L-systems give endless organic variety with tiny code. Crosses visual + wellness. Category `visual`.

**When to revisit:** Next visual/cozy round.

**Notes:** AI suggestion (2026-07-05). Tap the ground to plant; the tree grows branch-by-branch (animated L-system with slight randomness); sliders/chips for branch angle, lushness, and season (spring blossom / summer green / autumn fire / winter bare + snow); drag to bend the wind through the canopy (leaves flutter, petals fall). Multiple trees compose a grove scene. Audio: soft creak/rustle that follows wind strength, birdsong at full bloom. Real card + OG; full pipeline.

---

### New toy: Marble Music Machine

**Why it matters:** Wintergatan-style magic — marbles drop onto tuned bars and the machine plays a melody: physics + music in one loop, hypnotic to watch and inherently viral. The strongest audio idea on this list. Category `audio` (flagship).

**When to revisit:** Next audio round when there's appetite for a medium-large build.

**Notes:** AI suggestion (2026-07-05). A marble dropper on a loop timer releases marbles down pegs/ramps onto a row of tuned vibraphone bars (pentatonic — everything sounds good); the player edits the machine: drag gates/ramps to route marbles, toggle drop columns per loop step (a physical step-sequencer). Marble hits = the note; visual bar shimmer + marble bounce physics (reuse Marble Drop's collision knowledge). Tempo control; maybe 2 marble sizes = 2 octaves. Audio bar fully loaded: warm vibraphone/kalimba-family synthesis (reverb+delay bus), wooden ramp rolls, marble clacks. Real card + OG; full pipeline.

---

### New toy: Singing Bowl

**Why it matters:** Rub the rim and the bowl slowly blooms into its ring — a meditative gesture-to-sound loop that crosses `audio` and `wellness` perfectly (Tongue Drum's sibling).

**When to revisit:** Next audio/wellness round; small-medium scope.

**Notes:** AI suggestion (2026-07-05). A bronze bowl (top-down or 3/4 pseudo-3D); circle your finger around the rim — sustained circling builds amplitude (a resonance model: slow attack, long release, wobble/beating between close partials as it swells); strike the side for an immediate warm GONG with long decay; a mallet follows your touch around the rim. Water-in-bowl option: droplets dance when loud. Inharmonic-ish bowl partials (like the tongue-drum research), heavy lush reverb, iOS unlock. Design: warm bronze with hammered texture, cushion, incense-calm scene; ripple rings emanate while singing. Real card + OG; full pipeline.

---

### New toy: Euclidean Rhythm Circles

**Why it matters:** Circular sequencers distributing K hits over N steps produce world-rhythms automatically — gorgeous rotating geometry + instant polyrhythmic grooves; a beautiful, brainy step up from Beat Maker. Category `audio`.

**When to revisit:** Next audio round.

**Notes:** AI suggestion (2026-07-05). 3-4 concentric rings, each a voice (kick/hat/pluck/chime); per-ring controls: steps N, pulses K (Euclidean/Bjorklund distribution), rotation offset, sound. Playhead sweeps like a radar; hits light and pulse outward. Tempo + swing; mute/solo per ring. The geometry IS the interface — dragging K reshapes the polygon inscribed in the ring. Synth voices through the standard bus (reverb/delay/compressor); visual: neon polygons on dark, vertices flash on hit. Real card + OG; full pipeline.

---

### New toy: Omnichord / Strum Pad

**Why it matters:** Pick a chord, strum a glowing harp strip — instant lush music for people who play nothing. One of the most satisfying "anyone sounds good" instruments. Category `audio`.

**When to revisit:** Next audio round; small-medium scope.

**Notes:** AI suggestion (2026-07-05). Chord buttons (I–vi across a friendly key, or a small major/minor grid) + a vertical touch strip: sliding across it arpeggiates the held chord's notes (harp-like, velocity from slide speed); optional gentle rhythm pad (soft drum loop) and auto-bass on chord press. Sparkly plucked-string synthesis (detuned pairs, shimmer reverb per the audio bar). Design: a dreamlike instrument-object with a glowing strum field, light motes rising per note (Kalimba's world-language). Trademark-safe name ("Strumboard"?). Real card + OG; full pipeline.

---

### New toy: Radio Dial (numbers station)

**Why it matters:** Pure atmosphere — turn a heavy analog dial through synthesized static and drift past ghost stations (a numbers voice? a distant waltz? morse?). Unique mood-piece unlike anything on the site. Category `audio`.

**When to revisit:** Next audio/mood round.

**Notes:** AI suggestion (2026-07-05). A beautiful vintage radio face; drag the needle across the band — filtered-noise static whose texture shifts, with stations at hidden frequencies that fade in through the crackle as you approach (synthesized: shortwave interval tones, a lonely piano loop, morse bursts, a "numbers" pattern via synthesized vocal-ish formants or tone-coded digits, whale-song-like sweeps). Fine-tuning knob narrows the crackle; signal-strength meter twitches. All audio synthesized (no samples, per the audio bar) — bandpassed noise beds, heterodyne whistles, AM warble. Design: warm dial lamp glow, brushed metal + bakelite, VU needle physics. Easter-egg station log in `localStorage`. Real card + OG; full pipeline.

---

### New toy: Rain Stick

**Why it matters:** Tip it and a thousand beads cascade — tactile, calming, and a rare *device-motion* toy (gyro tilt on mobile). Category `audio`/wellness.

**When to revisit:** Quick-ish audio round; motion-permission UX needs care (iOS requires a user-gesture permission prompt).

**Notes:** AI suggestion (2026-07-05). A long transparent-ish tube of beads; tilt via device orientation (with a drag-to-tilt fallback on desktop) — beads tumble past internal pins with granular bead-shower synthesis (density/pitch follows flow rate + tilt angle); full invert = the big satisfying cascade. Design: warm wood/woven tube, bead sparkle, soft desert-evening backdrop. iOS `DeviceOrientationEvent.requestPermission` behind a tap; graceful desktop mode. Real card + OG; full pipeline.

---

### New toy: Dominoes (topple chains)

**Why it matters:** Set up, then topple — the payoff loop of every domino video, now yours to build. The setup-anticipation-cascade arc is deeply satisfying and infinitely replayable. Category `simulation`.

**When to revisit:** Next physics round; medium scope.

**Notes:** AI suggestion (2026-07-05). Top-down or slight-perspective table; drag to lay smooth curves of dominoes (auto-spaced along your stroke), stamp presets (spiral, fork, loop), then tap the first one — falling-domino physics chain (each tile a thin rigid body: tip → strike next; simplified 2.5D physics is fine if convincing). Colored tiles paint patterns visible mid-cascade. Undo/eraser; slow-mo replay of the topple; counter of toppled tiles. Audio: THE sound — accelerating clack-clack-clack cascade (velocity-scheduled clicks with slight pitch variance), a hush before the first tip. Real card + OG; full pipeline.

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

### New toy: Orrery (brass solar system, real-3D)

**Why it matters:** A clockwork solar-system model you crank — brass, gears, ivory planets; educational-adjacent beauty with real orbital ratios. Gorgeous card material. Category `simulation`.

**When to revisit:** WebGL round after dice; medium scope (mostly modeling/materials, physics is simple).

**Notes:** AI suggestion (2026-07-05). Zero-dep WebGL: stylized brass armature, planets on arms with correct *relative* periods (crank speed = time multiplier; drag to spin time forward/back, watch retrograde alignments); tap a planet for its name + a fact chip; toggle real-scale vs. display-scale spacing. Single warm key light (museum spot), brass env-glints (cradle's material language), soft table shadow. Audio: gentle clockwork tick + gear whirr that follows crank speed, a chime on planetary alignment. Real card + OG; full pipeline.

---

### New toy: Magnetic Pendulum Fractal

**Why it matters:** A pendulum over three magnets — release it and it dances chaotically before choosing one; the hidden basin-of-attraction fractal it traces is a jaw-dropping reveal. Chaos you can play with. Category `simulation`.

**When to revisit:** Next physics round.

**Notes:** AI suggestion (2026-07-05). Top-down pendulum bob attracted to 3 colored magnets (+ drag friction); drag to place/release the bob — it swirls and settles on a magnet (trail colored by eventual winner). "Reveal the map" mode: progressively raster-compute which magnet each start point falls into → the famous fractal basin image paints in live (chunked so the UI stays responsive). Move the magnets and watch the map morph. Audio: swooshes following speed, a soft lock-in chime colored per magnet. Real card + OG; full pipeline.

---

### New toy: Lorenz Attractor (3D butterfly)

**Why it matters:** The icon of chaos theory as a living 3D ribbon you orbit — glowing particle trails weaving the butterfly forever, never repeating. Category `simulation`/visual.

**When to revisit:** WebGL round; small-medium scope.

**Notes:** AI suggestion (2026-07-05). Zero-dep WebGL: integrate many Lorenz trajectories (slightly offset starts — watch them diverge: chaos made visible); render as glowing additive ribbons/particles; drag to orbit, pinch to zoom; sliders for ρ (rho) morph the attractor shape live; a "twins" button launches two dyed trails from near-identical starts. Deep-space palette, bloom. Audio: an ethereal shimmer bed modulated by trajectory divergence. Real card + OG; full pipeline.

---

### New toy: Thunderstorm Maker

**Why it matters:** The classic ambient-mixer, done to this site's audio bar — layer rain, thunder, wind, and distance into your perfect storm and just… stay a while. Enormous cozy appeal. Category `wellness`.

**When to revisit:** Next wellness round; small-medium scope (audio-first build).

**Notes:** AI suggestion (2026-07-05). Elegant sliders/dials: rain intensity (drizzle→downpour), thunder frequency + distance (delay + lowpass = far rumbles vs. near cracks), wind, rain-on-surface character (leaves/tin roof/window). All synthesized per the audio bar (layered filtered noise beds, the Rain-on-a-Window + Fireworks boom know-how). Visual: a living storm vignette that matches the mix — clouds darken, rain streaks thicken, lightning flashes precede thunder by the right distance-delay, wind bends the trees. A "sleep" dim mode. Real card + OG; full pipeline.

---

### New toy: Bonsai Pruning

**Why it matters:** The Pottery Wheel of plants — slow, deliberate shaping of a living thing; snip a branch, watch it heal and regrow, care for it across a sitting. Deeply calm. Category `wellness`.

**When to revisit:** Next wellness/craft round.

**Notes:** AI suggestion (2026-07-05). A procedural bonsai (recursive branch structure) in a ceramic pot on a wooden stand; tap a branch to snip (clean cut animation + a leaf flutter), pinch/drag to wire a branch's angle gently; the tree slowly buds/regrows toward light over the session; choose pot + style (cascade, windswept, formal). Seasons/flowering as a quiet reward for balanced pruning. Audio: crisp snip, leaf rustle, distant temple ambience (synthesized bell, wind). Photo-mode card composition. Real card + OG; full pipeline.

---

### New toy: Snow Globe

**Why it matters:** Shake it and watch the world settle — a one-gesture cozy ritual everyone already knows. Seasonal spotlight potential (December feature). Category `wellness`.

**When to revisit:** Cozy round / before the holidays.

**Notes:** AI suggestion (2026-07-05). A glass globe (specular + refraction-ish distortion of the tiny scene) over a carved base; shake via drag-flick (or device motion) — hundreds of snow particles swirl with fluid-ish turbulence then settle drift-by-drift; tiny scene inside (cabin + pines, lantern-lit; maybe 2-3 scenes to cycle). Glass glints, warm interior glow, falling-settled snow accumulates. Audio: soft glass-muffled swirl, twinkling music-box phrase that plays as snow falls (reuse Music Box voice), settling hush. Real card + OG; full pipeline.

---

### New toy: Grass Field in Wind

**Why it matters:** Drag gusts through a golden meadow and watch waves roll across it — the pure "touch the landscape" fantasy; wind made visible. Category `wellness`/visual.

**When to revisit:** Next wellness/visual round.

**Notes:** AI suggestion (2026-07-05). Thousands of grass blades (instanced strokes with per-blade phase; canvas-2D batched or WebGL for density) swaying to a wind field; drag = a gust that bends a traveling wave through the field (blades bow + shimmer as it passes); ambient breeze keeps it alive; fireflies or seeds drift at dusk; time-of-day tint chip (noon gold / dusk rose / night silver). Audio: wind bed that follows gust strength + soft grass hiss (bandpassed noise), distant birds by day, crickets at night. Real card + OG; full pipeline.

---

### New toy: Fireflies at Dusk

**Why it matters:** Catch-and-release fireflies in a jar on a summer evening — nostalgia distilled; gentle, luminous, and quietly interactive. Category `wellness`.

**When to revisit:** Cozy round (summer feature).

**Notes:** AI suggestion (2026-07-05). A dusk meadow-edge scene; fireflies drift and blink in organic patterns (synchronizing waves occasionally — real firefly behavior); move a cupped-hand/jar cursor to gently catch them (they glow inside the jar, lighting your corner of the scene); open the lid to release a swirl of light. No score — just the ritual. Audio: cricket bed, soft jar clink, a warm swell when the jar glows bright. Design: deep blue-hour palette, bloom on every lantern-belly. Real card + OG; full pipeline.

---

### New toy: Tide Pool

**Why it matters:** Waves washing over sand — foam lines, retreating shimmer, and small discoveries (shells, anemones that shy from touch). A beach in a browser tab. Category `wellness`.

**When to revisit:** Next wellness round.

**Notes:** AI suggestion (2026-07-05). A gentle shoreline loop: waves slide up the sand (translucent water edge + foam lace that decays), retreat leaving wet-sand sheen that dries; tap the water to splash, touch anemones to make them shy closed, flip small shells; maybe write in the wet sand with a finger and watch the next wave erase it (the poetic hook). Audio: the wave cycle (approach hiss, wash, retreating fizz — layered noise beds), gull far off. Real card + OG; full pipeline.

---

### New tool: Decision Wheel (spin to decide)

**Why it matters:** Type your options, spin the wheel, let fate decide — the most shareable utility imaginable (hash-encoded wheels = send a "where do we eat?" wheel to the group chat). Category `utility`.

**When to revisit:** Next tools round; small scope, high virality.

**Notes:** AI suggestion (2026-07-05). Editable option list (2-12 entries) → a colorful wheel; drag-flick to spin with real angular momentum + friction + a ticking flapper (pointer physics against pegs); dramatic slow-down, winner celebration. Presets: dinner picker, chore assigner, yes/no/maybe. **Share via URL hash** (like Countdown) so a specific wheel is linkable; last wheel in `localStorage`. Geist tool-family styling (light/dark) OR full-bleed toy treatment — decide at build. Audio: accelerating tick-tick-tick that slows to the verdict, fanfare. CSS-motif or rendered card + OG; full pipeline.

---

### New tool: Pomodoro Timer

**Why it matters:** The classic focus ritual, done in the site's clean meter-family style — a genuinely useful daily-return tool (rare retention driver for the portfolio). Category `utility`.

**When to revisit:** Next tools round; small scope.

**Notes:** AI suggestion (2026-07-05). 25/5 cycles (customizable work/break lengths, long-break every 4); a beautiful big dial/arc that drains; session tally today (localStorage); gentle synth chime on transitions (no jarring alarm), optional tick. Title-bar countdown (`document.title`) so it works in a background tab; Notification API optional (permission-gated). Geist tool family (copy meeting-cost-meter styles, recolor tomato-warm). CSS-motif card + og-gen `bignum` OG; full pipeline.

---

### New tool: Tip Splitter

**Why it matters:** The utility everyone reaches for after dinner — bill + tip% + people = per-person amount, zero friction. Completes the money-tool family (Time Is Money, Latte Factor). Category `utility`.

**When to revisit:** Quick-win tools round.

**Notes:** AI suggestion (2026-07-05). Bill amount, tip presets (15/18/20/25% + custom, with a service-quality hint), split count with a big stepper; outputs per-person tip + total, rounded-up "make it even" toggle; everything updates live in a big odometer hero (meter-family style). Optionally itemized "who had what" as a stretch — probably keep v1 simple. Geist tool family, money-green sibling palette. CSS-motif card + OG; full pipeline.

---

### New tool: World Clock Overlap ("when can we call?")

**Why it matters:** Visual answer to the eternal remote-work/family question — pick 2-4 places, see the stacked day/night bars, and the green window where waking hours overlap. Category `utility`.

**When to revisit:** Next tools round; small-medium scope (timezone data via `Intl` keeps it dependency-free).

**Notes:** AI suggestion (2026-07-05). City/timezone picker (curated list + search over IANA zones via `Intl.supportedValuesOf('timeZone')`); horizontal 24h bars per place aligned to *your* now-line, tinted night/dawn/day/dusk with sleeping hours hatched; the mutual "good call window" glows; drag the now-line to scrub ("if I call at 9pm my time it's 6am for Mom"). Share via URL hash. Geist tool family, sky-gradient palette. CSS-motif card + OG; full pipeline.

---

### New toy: Pool / 8-Ball (billiards)

**Why it matters:** A beloved classic with instantly satisfying physics — the crack of the break, balls rolling true, the corner-pocket drop. Broad appeal, endless replay, and it photographs beautifully (green felt + gloss balls). Category `game`.

**When to revisit:** Next game round with appetite for a medium-large physics build (ball-ball collision + pockets + cue feel are the meat).

**Notes:** Owner request (2026-07-05). Top-down (or slight-perspective) table; **drag back from the cue ball to aim + set power** (like Mini Golf's proven de-cheated aim: direction arrow + power ring, no full trajectory preview), release to strike; optional english via a small spin-offset picker. Physics: elastic ball-ball collisions with rolling friction + cushion restitution (2D circles — well-trodden), pocket capture with a satisfying drop. Mode scoped SMALL per the keep-it-small rule: solo **clear-the-table** (fewest strokes, best in `localStorage`) and/or **pass-and-play 8-ball** on one device — skip AI opponent v1 (rubber-banding cue AI is a project of its own). Design bar: deep-felt table under a warm low lamp, glossy numbered balls (reuse the card/pip rendering discipline), subtle cloth texture, chalk-dust puff on strike. Audio bar: the authentic cue *tock*, ball-ball *clack* (velocity-scaled, the Newton's Cradle steel-click family retuned for phenolic resin), cushion thump, pocket rumble-drop. Real rendered card + OG; full add-a-toy pipeline. If it grows toward opponents/multiplayer → separate project per the scoping rule.

---
