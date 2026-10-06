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

**Why it matters:** Numbers map consistently to letters and you decode the phrase; there is exactly one right answer, difficulty is comparable between players, and the share can report mistakes or time **without leaking a single letter**. `cryptogram` returns nothing in the catalogue — the only near-neighbor is Aurebesh Translator, which is a transliterator, not a puzzle. A classic with real standing search demand. Category `game`/word.

**When to revisit:** After Numbers Target, or instead of it if a word game is preferred over an arithmetic one.

**Notes:** Spotted 2026-08-23 in the same review (cyphrgame.com is a live example, laid out as a pyramid where each row is a word). Second-ranked of that set.
- ⚠ **ROUTE VIA `new-feeder-game`** per the same rule as Daily #1.
- **Generable, so no daily authoring:** the only content needed is a phrase list; the substitution is randomized per day. That keeps it in the same "generate and screen" family as Word Kraven and Numbers Target.
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

### Useful tools round — why these, and the ranking (2026-10-04)

**Why it matters:** Owner: *"I want more tools but they always seem to come out the same."* The tool family has one shape: fill in a form, read a number (Countdown, Tip Splitter, Sleep Cycle, Latte Factor, Time Is Money). Barkeep is the only tool holding people (3:05 average), and it is the one you browse and use. **The fix is not new chrome, it is a different INPUT (the microphone, the motion sensors, text you paste, a link the group shares) and an output you USE (a tuned string, a night of sleep, a settled debt), not a number to read.** Each entry below breaks the pattern a different way.

**When to revisit:** Whenever the next tool is open. Owner asked for these to be backlogged on 2026-10-04.

**Notes:**
- Ranking: Tuner and Sleep Sounds first (the most-used, recurring every day, and they lean on the site's audio strength), Trip Settle-Up the strongest non-audio pick, then the rest.
- Tools stay out of the cross-promo (the tool family convention) and keep the shared tool chrome, but each should get its own signature visual the way Barkeep has its back bar.
- No affiliate links, no sales surfaces (DECISIONS 2026-06-11), no developer tools (they belong on BuildUtilities), no backend or API keys.
- Daily check (DECISIONS 2026-08-16): none of these is a daily. Hearing Age has a shareable result but no daily puzzle.

---

### Useful tool #1 — New tool: Instrument Tuner — BUILT as No. 135 Tuner (2026-10-04); see HANDOFF

**Why it matters:** Every musician tunes every time they play, "online guitar tuner" is a huge evergreen search, and listening through the microphone is an interaction no tool here has. A big analog needle, cents off, and the target note. Category `utility`.

**When to revisit:** Next tool round; the first pick.

**Notes:**
- Presets: guitar (standard, drop D, DADGAD, open G), ukulele, bass, violin/viola/cello, plus chromatic mode. Reference A adjustable (440 default; 432 for those who ask).
- ⚠ **Pitch detection is the build**: autocorrelation or YIN on the microphone's time-domain signal, with octave-error guards (a guitar's low E is strong at its second harmonic) and smoothing so the needle settles rather than jitters. Test against synthesized tones and recorded strings at known pitches before trusting it.
- A reference-tone button (play the target string) and a "strum detected" auto-advance to the next string.
- Mic permission prompt with a clear explanation; nothing leaves the device. iOS Safari needs a gesture before `getUserMedia`.
- Look: a real instrument tuner object (brass needle, backlit dial) per the house visual bar.

---

### Useful tool #2 — New tool: Sleep Sounds (noise machine) — BUILT as No. 134 Sleep Sounds (2026-10-04); see HANDOFF

**Why it matters:** "Brown noise" is one of the biggest audio searches there is, it is a nightly habit, and synthesized ambient sound is exactly what this site builds well (Rain Stick, Campfire, Zen Ripple Pond). Category `utility` (or `wellness`).

**When to revisit:** Next tool round, alongside the Tuner.

**Notes:**
- Sources, mixable with per-layer volume: brown, pink and white noise; rain (light to heavy), a box fan, ocean waves, a crackling fire, a distant thunderstorm. All synthesized, never samples, and seamless: long buffers or continuous generators, no audible loop point.
- Sleep timer with a long fade (15 / 30 / 60 / 90 min, or until morning), and a gentle fade-in.
- ⚠ **Phones**: use the Screen Wake Lock API so audio keeps running with the page open; say plainly that locking the phone may stop it on iPhone. Test that it survives the screen dimming.
- Remember the last mix (`localStorage`); presets ("Rainy cabin", "Airplane cabin", "Ocean house").
- Measure levels like any audio toy, and keep the master quiet by default: this plays at night.

---

### Useful tool #3 — New tool: Trip Settle-Up — BUILT as No. 133 Settle Up (2026-10-04); see HANDOFF

**Why it matters:** After every group trip, someone does this math on a napkin. Everyone adds what they paid and for whom; it works out the fewest payments that square everyone up. It is the opposite of a one-person form: the whole tab lives in the LINK, so the group shares one URL and nobody signs up. Category `utility`.

**When to revisit:** Next tool round; the strongest non-audio pick.

**Notes:**
- Expenses: who paid, how much, split equally or by shares among chosen people. Currency per trip.
- Settlement: the minimal-transfers result (greedy on net balances is near-optimal and explainable; show "3 payments settle 6 people").
- ⚠ **State in the URL hash** (compressed, e.g. a compact encoding plus deflate via CompressionStream), so the link IS the trip. Warn when the link gets long; offer copy and share. No server, no accounts.
- Emotional payoff: the "all square" moment, and a clean summary to paste into the group chat.
- Sibling to Tip Splitter (one bill); this is the whole trip.

---

### Useful tool #4 — New tool: Recipe Scaler — BUILT as No. 132 Recipe Scaler (2026-10-04); see HANDOFF

**Why it matters:** Paste any recipe, choose the servings, and every amount is rewritten sensibly: 48 teaspoons becomes 1 cup, 1.5 eggs is flagged, a cup of flour can switch to grams. You transform your own text instead of filling in boxes. Category `utility`.

**When to revisit:** A tool round after the top three.

**Notes:**
- Parse quantities (fractions, unicode fractions, ranges, "a pinch"), units (US and metric) and ingredient names line by line; leave lines it does not understand untouched.
- ⚠ **The content is an ingredient density table** (flour, sugars, butter, rice, oats, honey, ~60 common items) for volume-to-weight; our own numbers from standard references, never pasted tables.
- Smart rounding to kitchen measures (1/3 cup, not 0.33), unit upgrades and downgrades, and oven temperature conversion.
- Output as clean text to copy or print; no recipe storage beyond `localStorage`.

---

### Useful tool #5 — New tool: Level and Ruler — BUILT as No. 131 Level & Ruler (2026-10-04); see HANDOFF

**Why it matters:** Your phone becomes the tool: a bubble level for hanging pictures and shelves, and an on-screen ruler for small things. Both are evergreen searches, and using the phone's sensors is an input no tool here has. Category `utility`.

**When to revisit:** A tool round after the top three.

**Notes:**
- Level: DeviceOrientation (flat and edge modes), a real liquid vial with a bubble that lags and settles, degrees readout, a calibrate-zero button, a click when level.
- ⚠ iOS asks permission for motion sensors (`DeviceOrientationEvent.requestPermission()` on a gesture); desktops have no sensor, so they get the ruler only.
- Ruler: calibrate once against a credit card (85.6 mm) or a US quarter, then measure in inches and centimeters; remember the calibration per device.
- Look: brass-and-glass instruments.

---

### Useful tool #6 — New tool: Sun Path — BUILT as No. 130 Sun Path (2026-10-04); see HANDOFF

**Why it matters:** Point your phone at a window or a garden bed and see when the sun will cross it, today or in December. Gardeners, apartment hunters and photographers all want this, and it is the natural next step from Golden Hour (which gives times, not directions). Category `utility`.

**When to revisit:** After the Level (shares the sensor permission flow).

**Notes:**
- Sun position from date, time and location (the solar math Golden Hour already has), drawn as today's arc plus the summer and winter solstice arcs over the camera-free compass view; scrub the time of day.
- Compass from DeviceOrientation (`webkitCompassHeading` on iOS); ⚠ phone compasses drift and vary, so show an accuracy note and allow a manual heading.
- No camera required (an optional camera overlay is a stretch goal, and needs its own permission).
- Output in words too: "Sun on this window from 2:10 to 6:40 PM today; in December, not at all."

---

### Useful tool #7 — New tool: Hearing Age — BUILT as No. 129 Hearing Age (2026-10-04); see HANDOFF

**Why it matters:** A tone sweeps up through high pitches to find the highest you can hear, then says something like "your ears are about 34." People compare with friends, so it spreads. Category `utility` (or a toy).

**When to revisit:** Any round; small build.

**Notes:**
- A stepped high-frequency sweep (8 kHz to 20 kHz), press when it disappears, repeated to confirm; map the result to a playful age band (typical age-related high-frequency loss figures).
- ⚠ **Safety and honesty**: start quiet and never loud, ask for headphones, and say clearly it is for fun, not a hearing test; results depend on the headphones and speakers.
- Share line: "I can hear up to 15.2 kHz. Ears of a 38-year-old." Image share via `OPT_SHARE_IMAGE`.

---

### Deep sit-down round — why these, and the ranking (2026-10-03)

**Why it matters:** The first real analytics (the admin page, 28 days to 2026-10-03) show the toys people stay with are the deep ones: **Chess 5:50 average per visitor, Meld 5:37, Barkeep 3:05**, against under a minute for most of the catalog. Chess holds people with a real opponent that has personality, Meld with a replayable run and music, Barkeep with a tool you browse. Claude's own read on the admin page said the same thing ("build more deep, sit-down games like Chess"). The entries tagged **Deep** below are the strongest candidates for that lane, in rank order.

**When to revisit:** Whenever the next build is open. Check the admin page first: if the long-session pattern holds once the owner's own test visits wash out, this lane is the priority.

**Notes:**
- **Ranking logic:** board games against an AI first, because Chess proved the format and they reuse its whole architecture (one rules core loaded by both the page and a Worker engine, a personality ladder, keyboard play that doubles as the test harness, perft-style rule tests). Then the deep solitaires on the existing card and tile foundations, then two tools in Barkeep's mold, then one creative builder.
- ⚠ **Small numbers:** Chess had 28 opens and Meld 27, and the owner's testing is in them. A direction, not proof.
- **Daily check** (DECISIONS 2026-08-16): none of these qualifies. Results are wins, times or scores against an opponent or a random deal, which nobody shares. All are toys or tools here.
- **One-sitting rule** (DECISIONS 2026-07-03): every one fits a single sitting (a game of 5-20 minutes, a browse); nothing needs saved progress beyond a `localStorage` best or ladder rung.
- Already on the list and also in this lane: Sudoku (#6), Nonogram (#5), the Tower Defense MVP.

---

### Deep #1 — New toy: Checkers vs AI — BUILT as No. 127 Checkers (2026-10-03); see HANDOFF

**Why it matters:** The cheapest win in the lane. Chess's whole stack carries straight over (rules core shared with a Worker engine, alpha-beta with a personality ladder, the 3D board camera, the keyboard harness), and checkers has enormous evergreen search demand ("play checkers online"). A game runs 10-15 minutes. Category `game`.

**When to revisit:** Next build. The smallest of the board games.

**Notes:**
- **Rules:** American checkers / English draughts on 8x8. Men move diagonally forward; **captures are mandatory** and multi-jumps must be finished; a man reaching the far row is crowned and the move ends there. ⚠ Mandatory capture is the rule casual players forget AND the rule that makes the game: pulse the pieces that must take rather than silently refusing other moves. A "captures optional" house-rules toggle is a common ask.
- **Engine:** alpha-beta with quiescence on captures. ⚠ Carry over the Chess lessons: a FULL window for every root move if personalities read scores, judge the ladder by adjudicated material, quiescence is the difficulty lever. Kings can shuffle forever: draw on 40 moves without a capture or man move, and on threefold repetition.
- **Ladder:** 5-6 named opponents like Chess; `checkers_beaten`, ticket rule dir `up`.
- **Look:** its own world, not Chess's palette (lacquered wood and bone, or river stones on slate). A king is a stacked piece with a visible crown ring.
- **Audio:** modal wood or stone clacks per the house recipe; a multi-jump as a quickening chain of hits; a crowning chime.
- Generic name, no trademark issue ("Checkers", "Draughts").

---

### Deep #2 — New toy: Backgammon vs AI — BUILT as No. 136 Backgammon (2026-10-06); see toys-log

**Why it matters:** Dice plus real strategy: luck keeps it friendly, decisions keep it deep. Huge audience, 10-20 minute games, and the physical set is gorgeous (inlaid board, stacked checkers, dice cups). The Dice Roller already has 3D dice. Category `game`.

**When to revisit:** After Checkers, or first if dice appeal more.

**Notes:**
- **Rules:** 15 checkers each, the bar, bearing off, doubles move four, and **you must use both dice if you can, or the larger one if only one fits** (the rule everyone gets wrong). Gammons and backgammons score in a short match (3 or 5 points fits one sitting). Doubling cube optional and off by default; it confuses newcomers.
- **AI:** no deep search needed. A 1-ply evaluation of every legal play for the roll, scored by a hand-tuned position function (pip count, exposed blots, made points, primes, anchors), plays decently; 2-ply expectimax over the 21 rolls for the stronger personalities, in a Worker. ⚠ The move generator (bear-off, "use both dice") must be exact; test it like perft.
- **Input:** tap a checker then a lit destination, or drag; forced moves auto-play; undo within the turn.
- **Audio:** dice rattling in a cup and tumbling on wood, checkers sliding and clacking, a stacked click when landing on your own point.
- **Look:** inlaid wood and felt, or a modern stone set; offer both via AskUserQuestion. Ticket rule on matches won.

---

### Deep #3 — New toy: Go (9x9) vs AI

**Why it matters:** The deepest game there is, on its smallest board, with the most beautiful set (slate and shell stones on a wooden board, and that iconic stone snap). A 9x9 game takes 10-15 minutes. A large, curious audience has never had an approachable way in. Category `game`.

**When to revisit:** Once Checkers proves the board-game lane. ⚠ The riskiest board game here: AI strength and end-of-game scoring.

**Notes:**
- **AI:** Monte Carlo tree search with light playouts in a Worker (no neural net, no deps). On 9x9, a few thousand playouts a move gives a beginner-to-casual opponent, which is the audience. **Handicap stones are the difficulty ladder** (more natural to Go than named personalities).
- ⚠ **Scoring is the hard part:** area (Chinese) scoring. After both pass, estimate dead stones from Monte Carlo ownership (a stone that loses in most playouts is dead), show the territory map, and let the player tap groups to toggle before confirming. Ko via positional superko (no repeating any earlier position).
- **Teaching:** a short first-game overlay (capture by surrounding; two eyes live) is essential. Go is the one game here most people don't know.
- **Audio is the selling point:** the stone snap is a sharp slate-on-wood click with a short woody body (modal), plus a soft hand lift and place; captures clatter gently into a lid.
- Name: "Go" (generic); Weiqi and Baduk go in the NL keywords.

---

### Deep #4 — New toy: Mancala vs AI

**Why it matters:** The most tactile board game there is: scoop a handful of glass beads and sow them pit by pit. Short games (5-10 minutes) with real depth, ancient and generic, and the sound can be the star. Category `game`.

**When to revisit:** Any board-game round; a small build.

**Notes:**
- **Rules:** Kalah (6 pits, 4 stones each; an extra turn when your last stone lands in your store; capture from your own empty pit). Oware (abapa) as a second ruleset for depth.
- **AI:** alpha-beta is easy and strong (tiny branching factor); personalities via depth and noise.
- **Animation:** sow stone by stone with a hand-like arc; each bead settles individually in its pit, with a count toggle.
- **Audio:** each bead dropping into a wooden cup (modal), its pitch shifting with how full the pit is, which is what real stones do; captures pour.
- **Look:** carved hardwood with glass beads, or stone on stone.

---

### Deep #5 — New toy: Reversi vs AI

**Why it matters:** A minute to learn, a lifetime to master; a game takes 5-10 minutes, and the big swing flips are a great visual and audio moment. Alpha-beta plays it very well, so the ladder can run from gentle to brutal. Category `game`.

**When to revisit:** Any board-game round; the smallest engine after Mancala.

**Notes:**
- ⚠ **"Othello" is a trademark (MegaHouse); the game is "Reversi".** Keep "othello" off every surface, hidden keywords included (the Tetris and Suika precedent).
- **Engine:** alpha-beta on mobility, corners, stability and parity; solve the endgame exactly over the last ~14 empty squares. Personalities as in Chess.
- **Flips** ripple outward from the placed disc, staggered, each a coin-like 3D turn; a big capture should read as a wave.
- **Audio:** a disc snap per flip, rising in pitch along the ripple.

---

### Deep #6 — New toy: Mahjong Solitaire (tile matching)

**Why it matters:** One of the most-searched casual games anywhere, and a real sit-down: a layout is 10-20 minutes of calm scanning. Carved tiles are a gift to the visual bar. Category `game`.

**When to revisit:** Next puzzle or cozy round.

**Notes:**
- **Rules:** 144 tiles in a layered layout; remove matching pairs of FREE tiles (nothing on top, and an open left or right side). Seasons and flowers match within their group.
- ⚠ **Random deals are often unwinnable. Generate in REVERSE:** fill the layout from empty by placing each pair only where both tiles would be free at that moment, so the reverse order is a guaranteed solution (the Circuit and Threads trick). Hint, plus a shuffle that re-deals the remaining tiles solvably.
- **Look:** thick ivory or jade tiles with carved, inked faces drawn ourselves (dots, bamboo, characters, winds, dragons), real stack depth and shadow, free tiles subtly lit.
- ⚠ "Mahjong" is generic; **"Shanghai" (Activision) is not**: keep it off every surface.
- **Audio:** the bone-and-resin tile click (modal), a soft chime per pair. Best time per layout, ticket rule dir `down`.

---

### Deep #7 — New toy: Hearts vs three AIs

**Why it matters:** The classic sit-down card game: a game to 100 takes 15-20 minutes, and people play hand after hand. Big evergreen search demand ("hearts card game"). The card foundation (Solitaire, Blackjack, Video Poker) already does the rendering. Category `game`.

**When to revisit:** After Pyramid, or any card round.

**Notes:**
- **Rules:** pass three cards (left, right, across, hold), the 2 of clubs leads, hearts can't lead until broken, the queen of spades is 13, and shooting the moon gives everyone else 26.
- **AI:** rule-based play plus light card counting (tracking voids, guarding against the queen) makes fun opponents. Give the three seats personalities (cautious, aggressive, moon-shooter) with names and small portraits; that's where Chess's character comes from.
- ⚠ **Phone layout:** four hands on a small screen. Show only yours; the others are card backs at the edges, and tricks sweep to the winner.
- **Audio:** card flicks, the trick sweep, a sting when someone takes the queen.

---

### Deep #8 — New toy: FreeCell and Spider (the deep solitaires)

**Why it matters:** FreeCell is pure skill (almost every deal is winnable); Spider is the long-session one. Both cost little on top of the card foundation and Solitaire's win cascade, and both have very large search demand. Category `game`.

**When to revisit:** Any quick-win card round; pairs naturally with Pyramid.

**Notes:**
- **FreeCell:** the classic numbered deals come from a known, public generator (Microsoft's LCG; deal 11982 is the famous unwinnable one), so "Deal #N" links work and players can trade deals. Supermoves (moving a run sized by free cells and empty columns) must be computed exactly. A solver in a Worker powers hints and checks winnability.
- **Spider:** 1, 2 and 4 suits; deal from stock; finished runs fly off.
- Two pages or one with a mode switch: decide at build time (two pages are two search entries).
- ⚠ Check the name "FreeCell" before shipping. It's used generically everywhere, but confirm no live mark is enforced.

---

### Deep tool #1 — New tool: Pantry (what can I cook tonight)

**Why it matters:** Barkeep's sibling for food, and Barkeep is the only tool holding people (3:05 average). Tick what's in your kitchen; see what you can cook now, what's one ingredient away, and the single item that would unlock the most. The payoff: dinner solved from what you already have. Category `utility`.

**When to revisit:** Next tool round.

**Notes:**
- Same architecture as Barkeep: a recipe file keyed to a fixed ingredient list, staples that never count as missing (salt, oil, pepper), "best next ingredient", deep links per recipe, a shopping list that shares as text.
- ⚠ **The content is the build:** ~120-150 home recipes in OUR OWN wording (never paste method text from recipe sites), with servings and time; validate with Barkeep's node one-liner pattern.
- ⚠ **No affiliate or grocery links** (DECISIONS 2026-06-11; the Barkeep precedent).
- Filters that matter: under 30 minutes, vegetarian, one pot.

---

### Deep tool #2 — New tool: Night Sky Tonight

**Why it matters:** Golden Hour tells you to go shoot; this tells you to go look up. Which planets are up tonight and where, the moon, the bright stars, any meteor shower peaking. It sits in the family with Moon Phase and Golden Hour, and it's the kind of page people explore at length. Category `utility`.

**When to revisit:** Next tool round; reuse Moon Phase's chrome.

**Notes:**
- **Everything computed offline:** planet positions from low-precision orbital elements (Paul Schlyter's method or Meeus; well under a degree, plenty for "look southeast, 30 degrees up"), rise and set times, a ~300-star bright-star catalog, the meteor shower calendar. Location from the browser with a city fallback. No API keys, no network.
- **Output:** a sky dome for the observer's horizon at a chosen time (scrub through the evening), led by one headline ("Jupiter rises in the east at 9:40 PM, the brightest thing in the sky").
- ISS passes would need live orbital data: leave them out.

---

### Deep #9 — New toy: Little Harbor (tap-to-build town)

**Why it matters:** A creative toy people lose half an hour in: tap the water to raise a building, tap again to stack, and the town arranges itself into rooftops, arches, stairs and gardens. Every result is screenshot-worthy, and the URL can hold the whole town for sharing. The one creative entry in this round. Category `visual`.

**When to revisit:** When the owner wants a showpiece. The biggest build on this list.

**Notes:**
- Genre reference: Townscaper (Oskar Stålberg). ⚠ Our own look, name and language; don't copy its palette or trade dress (a snowy alpine village, a desert terrace town, or a floating island).
- **Core:** a grid where each cell holds a height stack, and tile shapes are chosen from neighbor rules (marching-squares/cubes auto-tiling), so walls, corners, roofs and arches appear by themselves. An irregular grid is Townscaper's magic; a square or hex grid is the safe start.
- **3D:** needs real depth: raw WebGL with a fixed orbiting camera, soft shadows and water (the 3D direction decision: raw WebGL, no Three.js).
- **Share:** the grid in the URL hash, plus an image share through `OPT_SHARE_IMAGE`.
- **Audio:** soft wooden placement taps pitched by height, gulls, wind and water, a little chime when an arch or garden forms.
- ⚠ **Scope:** big. MVP: one palette, square grid, five tile families.

---

### Puzzle #0 — New toy: slide-out color sort, a game like Block Out! (owner pick, researched 2026-10-03; SHIPPED as No. 125 Jettison, `bcf638e`)

⚠⚠ **THE RESEARCH BELOW MISREAD THE REFERENCE. Read this first.** It was done from fan sites (the store was blocked), which describe a glide-until-stopped game. **The owner has played it: a block FOLLOWS YOUR FINGER through free space and stops where you let go; dragged into a door of its own color it leaves (the Color Block Jam model). And the board starts PACKED, a jam you clear, not a sparse tray.** The first Jettison build followed the research (glides, sparse holds, backstops) and was rejected outright: *"that wasn't it at all. look at the reference."* Before building anything "like X", look at X's own screenshots (the App Store page's `<picture>` sources are fetchable) or ask the owner how it plays. Everything below about glides, backstops, the last-one-out trap, stuck detection and A* belongs to the wrong game. The drag model has no dead ends at all; see HANDOFF for how Jettison actually works.


**Why it matters:** Owner asked for it on 2026-10-03 ("I want to build a game like Block Out", https://apps.apple.com/us/app/block-out-color-sort-puzzle/id6752672568) and had the research done first so the build can start cold. It is the current mass-market casual puzzle: **Block Out! (Grand Games, Istanbul, launched Oct 2025) hit #2 on the US iPhone most-downloaded games chart, ~4.6M downloads and ~$7.2M revenue by mid-2026**, and Color Block Jam (Rollic, 2024) leads the genre. Nothing like it in the catalogue (nearest: Slide Puzzle, Trio). One screenshot teaches it, the input is one swipe, levels can be generated and proven solvable, and the glide-and-clack is the juice. Category `game`.

**When to revisit:** Owner's next build. Open with the four starred calls below (control, clock, look, name) via AskUserQuestion, then build the level generator first.

**Notes:** The prototype solver/generator this research measured is in `scripts/research/color-exit/` (`rules.js` = rules, A*, winnable check, reverse generator, simulated novice; `lab.js <experiment>` reproduces every number below). `scripts/` is in `.vercelignore`, so none of it deploys.
- **How the reference plays** (store copy + fan walkthrough sites; the store, Play and guide pages were blocked by the cloud session's network policy, so this is secondhand. Owner can confirm in one level of the app): swipe a block and it **glides until it hits a wall or another block**; reaching a gate of its own color, it leaves; clear every block. **Undo is unlimited and free. A countdown per level** (reviews: "three puzzles with 50+ moves each in 90 seconds" past level 100). 900+ hand-built levels. Signature twists: **moving elevators** (carry blocks between lanes), **block generators** (spawn new blocks), shifting layouts. Blocks are described as LEGO-like. The genre is crowded with clones (e.g. Clear Block Puzzle, May 2026, same mechanic), so the mechanic itself is fair game.
- **Gate fit rule** (stated for Color Block Jam, assumed for Block Out!): a block only leaves through a same-color gate at least as wide as its cross-section. A wide block bumps a narrow gate.
- **Color Block Jam's obstacle list** (twist mine, all solver-friendly): one-direction arrow blocks, layered blocks (outer color leaves first), ice blocks (frozen until N other blocks clear), star blocks and doors, locked doors opened by key blocks, iced doors, moving door locks, +time capsules; boosters (time freeze, hammer, color vacuum). Note: Color Block Jam is drag-anywhere (the block stops where you let go); Block Out! is glide-until-stopped. Different games.
- ⚠ **Timers are the genre's loudest complaint** ("driving me mad with how little time it gave", "hard levels are only hard because the time limit is inhumanely low"), and "NO TIMER" spin-offs now sell on exactly that (Block Jam NO TIMER, Color Block Buster: "Play freely with no stress").
- **Daily-viral check (2026-08-16 rule): does NOT qualify.** A result is a move count against par, the same verdict as Color Pour and Sliding Block Escape. Build it here as a normal toy. The viral hook is a "beat my moves on this level" challenge link (Meld pattern).
- ⚠ **Trademark: "Block Out!" (Grand Games), "Color Block Jam" (Rollic) and "Blockout" (the 1989 3D falling-block game) go on NO surface, hidden search keywords included** (the Suika / Tetris / Tempest precedent). **No studs on the blocks** (LEGO trade dress, and reportedly the original's look). Generic phrases are fine: color sort puzzle, sliding block puzzle, slide the blocks out, block sorting. Whether "block jam" goes in the hidden keywords is the owner's call: it is in Rollic's title but also huge search volume. Not asked yet.
- ⚠⚠ **PLAIN SEARCH IS OUT.** Glide-until-stopped has a huge state space: on random 6×6 boards with only 6 blocks, plain BFS passed 200k states on more than half; at 9 to 16 blocks it never finished inside 300k states. Random dense boards also come out messy and hard (10 to 17 setup moves on top of the exits), and up to a third cannot be won at all.
- **What works, measured:**
  - **"Can this still be won?" is cheap**: depth-first with exits tried first, median ~2 ms. That is the stuck detector. Its solutions are hundreds of moves long, so useless as par.
  - **A* gives exact par fast.** Heuristic: each remaining block needs 1 move, or 2 if it is not lined up with a same-color gate it fits (admissible and consistent: a block's alignment only changes when it moves). Matched plain BFS on 120/120 small boards. Reverse-built 6×6 levels solve in a few ms (p90 under 0.35 s at 10 blocks). Bigger boards get expensive fast (two seed batches each): 7×7 with 12 blocks p50 40 to 75 ms, p90 0.7 to 1.4 s, max 1.6 to 4.3 s; 7×8 with 14 p50 0.2 to 0.9 s, p90 3 to 8 s, up to 15% passed the 1.2M-state cap; 7×8 with 18, 35 to 45% passed it. **So ship a pre-generated level pack and never solve in the browser**, except optionally an endless mode capped at 6×6 / 10 blocks in a Worker.
  - ⚠ **Build levels BACKWARDS from the empty tray.** Two reverse moves: "unexit" (put a new block on a same-color gate's lane where its forward glide out is clear) and "unslide" (move a block back from a spot it would stop at, so gliding forward lands exactly there). Every level is solvable by construction (0 replay failures), setup moves land around 3 to 10 (dialed by block count and how many unslides), and generating one takes ~5 ms. ⚠ **Construction length is not par** (often 3 to 20× longer); par comes from A*. ⚠ **Glides are not reversible** (gliding back keeps going until something stops it), so record each forward move as you build; it cannot be inferred. Color Pour's reverse-shuffle trick does not transfer.
- ⚠⚠ **THE GENRE'S CORE TRAP, measured: a block left alone can only stop against the walls.** Simulated greedy players (take any exit on offer, else a random glide) stranded the tray in 137/300 games at 6 blocks and 200/300 at 10, **98-99% of strandings were an EXIT, and right after the fatal exit only 1 block was left** (p50; never more than 2). The last block can no longer stop in line with a mid-wall gate because the block it needed as a backstop just left. That is what the fan guides mean by "work out which block leaves last". Early moves are almost never fatal (~0-1%), so the trap lives entirely in the endgame.
- ⚠⚠ **GATE POSITION IS THE DIFFICULTY DIAL**, far stronger than block count or par. Same 6×6 / 8-block settings: gates flush with a corner, the greedy player won **every level (30/30)**; gates mid-wall, **0.4% (0/30 levels; 3% in an earlier run)**; anywhere, ~30%. A gate in a corner lets a lone block line up against the side wall. Block count moves it far less: 6 to 12 blocks land between ~10% and ~45% greedy wins depending on the batch, and the spread is bimodal (most levels are either always won or almost never). **Curate by greedy-player win rate, setup moves and gate placement.**
- **Twists, measured:** 3 fixed pillars soften the trap, as permanent backstops (greedy wins 16% to 39% in one batch, 30% to 48% in another), but slow A* (p90 1.2 to 2 s, max 7 to 9 s at 6×6 / 10 blocks). One-axis blocks speed A* up (p90 under 50 ms) at similar difficulty. Reference twists (dispensers, elevators) are deterministic, so the solver copes (state adds a queue index or phase), but they break reverse construction: generate those levels forward and verify with A* on small boards.
- **Generator fixes still owed:** balance colors (random gate choice left some levels with 2 of 4 colors), keep 5 to 6 colors per level at most, drop gates nobody uses (done in the prototype). Two gates per color is untested.
- **Recommended design** (★ = owner's call):
  - ★ **Glide-until-stopped (the reference), not drag-anywhere.** Touch a block and drag: a ghost shows where it will land (and its gate lights if it will leave); release to commit, drag back to cancel. That one choice makes the trap a decision instead of a fat-finger. Keyboard: arrows move a cursor, Enter grabs, arrows glide, Z undo, R restart (also the test and card-pose harness).
  - ★ **No clock.** Score = moves against A*-exact par, best per level, a mark for matching par. Undo free; moves = moves on the board after undos.
  - **Stuck detector:** after each move run the winnable check (cap ~60k states, warn only when PROVEN stuck) and say why: "Nothing is left to stop Blue in line with its gate." One tap rewinds to the last winnable position (usually 1 to 3 moves back). Hint = next move of the stored optimal line, or A* from the current position in a Worker with a time cap.
  - **Level pack:** ~60 to 100 levels made offline by a node script (reverse construction, A* par, greedy-player grade) into a generated `levels.js`, never hand-edited (the Tiny Across `puzzles.js` precedent), each with par and its optimal line. Phones: at most 7 columns (about 50px cells on a 390px-wide phone); sizes 5×5 up to 7×7, only a few 7×8 (even offline, many 7×8 boards are too costly to grade). Resume at the deepest level (Untangle pattern).
  - **Teaching order:** one block and a corner gate (the glide) → a block stops against another → the fit rule (flash the gate's width when a block bumps it) → several blocks share one gate (order) → **the first mid-wall gate, the backstop lesson** → pillars → one-axis blocks → mixed. Stretch twists: layered shells, ice, then the reference's dispensers and elevators.
- **Look, three directions** (★ owner picks; recommend A):
  - **A. Air table (recommended):** anodized aluminium blocks riding a perforated gunmetal deck; the air cushion is the physical reason a block glides until it hits. Jewel-tone anodizing, chamfered edges catching a hard specular streak, glyphs laser-etched in bare silver (real detail: laser marking strips the dyed layer). Gates are LED-lit slots in brushed steel rails; a cleared block slides through and drops into a chute. Industrial and machined, unlike anything here (Air Hockey's table is neon arcade).
  - **B. Zero-g cargo bay:** Newton's first law is the glide; color-coded cargo modules, airlocks for gates, and a cleared module drifts out and tumbles away into the stars (the best exit moment of the three). Space is already well used here (Trench Runner, Untangle).
  - **C. Lacquer puzzle box:** black lacquer tray, lacquered hardwood blocks (vermilion, jade, indigo, saffron, plum), gold-leaf glyphs, brass-rimmed slots. Warmest and most tactile. ⚠ Keep every wood surface lacquered; bare wood reads brown.
  - Any direction: dark, dimensional board; 5 to 6 hues per level, each with its own glyph on block and gate (colorblind safety, the Color Pour rule); each polyomino drawn as one merged extruded outline, never separate cells (trace the cell union's boundary once per shape, round the outer corners, keep inner corners crisp); a leaving block is clipped at the rail so it visibly slides INTO the wall; slight top-down perspective in Canvas 2D (Skyscrapers and Chess precedent). Motion: quick ramp to cruise, hard stop with a 2-3% squash and a small recoil, the struck block nudges and settles, a micro-shake scaled by mass × speed. Reduced motion = short eased glides, no shake or particles.
- **Audio (house bars; recipe for A):**
  - ⚠ **Small solid blocks barely ring: the DECK rings.** A 4 cm solid aluminium or hardwood block's own modes sit far above hearing, so a clack is a contact click plus the deck and rail resonance. Same lesson as Meld ("what sounds like glass is the jar"). Model: a lowpassed broadband tack (~9 kHz LP) + steel-plate deck modes via `modalHit()` (Twisty Cube / Chess) + one shared cabinet body + room.
  - Bigger blocks = more WEIGHT (deeper thump, longer body), not higher or lower pitch (keep the spread within a fourth).
  - Glide: a very quiet air-bed hiss plus a whoosh that follows speed. Gate: Pinball's `solenoid()` for the flap kick, a pneumatic puff, a soft thunk in the chute, then a chime per clear climbing a pentatonic ladder through the level. Clear: the gates flash in turn over an arpeggio.
  - Throttle contact voices to one per event; bus compressor then brickwall; measure every voice (0.15 to 0.30 peak for foreground) with an analyser spliced before `destination`, averaging 7+ renders of anything noise-excited.
  - B: structure-borne thunks, mag-clamp clunks, airlock hiss, servo and seal, then silence outside. C: a darker hardwood tok + tray box resonance (~200 Hz) + a felt-drawer thud.
- ★ **Names** (no game found under the first three): **Last One Out** (names the strategy), **Backstop** (names the aha), **Jettison** (fits B). Weaker: Clearance (a "Puzzle Clearance" app exists) and Airlock (several small games use it).
- **Ship pipeline reminders:** keys `<slug>_level` (deepest cleared, ticket rule dir `up`, rule only), `<slug>_best` (moves per level), `<slug>_sound`; `game-screen.js` + the four metas; share line "Level N in M moves (par P)" + challenge link (e.g. `#l=N-M`), `OPT_SHARE_IMAGE` of the board; card = keyboard pose caught mid-glide with a gate lit, then the OG; GA via the Meld-style `gtagSafe` (`toy_open`, `level_start`, `level_clear` {level, moves, par}, `stuck`, `hint`, `share`, `challenge_open`); cross-promo in all four lists; NL phrases per the trademark note; IndexNow after deploy.
- Related: **Puzzle #7 Sliding Block Escape** can reuse this solver, A* par and heavy-block feel. **Color Pour** shares the colorblind rule.

---

### Puzzle #1 — New toy: Color Pour (water-sort) — BUILT as No. 126 Decant (2026-10-03); see HANDOFF

**Why it matters:** ⚠ **The single most viral casual-puzzle format of the last several years, and the best fit for this site of anything on this list.** It needs ZERO rules text — one screenshot teaches the whole game — the input is two taps, it is infinitely generatable with guaranteed solvability, and the payoff is liquid pouring, which lands squarely on the "must look and sound intentional" bar. Category `game`.

**When to revisit:** Next puzzle round, and **build this one first.** Small-to-medium scope with no content authoring and no dictionary decision, so it is the cheapest of the top four to ship.

**Notes:** A rack of tall glass tubes part-filled with bands of colored liquid. Tap a tube to lift its top band, tap another to pour it in; a pour is only legal onto the same color or into empty space, and the whole band of that color moves at once. Win when every tube is single-colored or empty. **Generate by REVERSE-SHUFFLING from a solved state** — that guarantees solvability without writing a solver, which is the trap this genre usually falls into. Undo, plus one "extra tube" get-out per board.
- **Design bar:** real glass (refraction-ish distortion of the bands behind, specular streak, meniscus at each boundary — the Glass Harp already solved that rendering language and this can share it). The pour is an ARC of liquid between tubes with the receiving surface rising and settling, not an instant swap. Color-blind safety matters here more than usual: distinct hues AND a subtle pattern or symbol per color, since the entire game is color identity.
- **Audio:** this is the whole appeal — a glug that pitches UP as the receiving tube fills (the resonant air column above the liquid shortens, exactly like filling a real bottle; an earlier note here said DOWN, which is backwards), a soft glass clink on tube select, and a bright settle when a tube completes. Model it, per the 2026-08-14 modal/additive split.
- Best count + moves in `localStorage`; ticket rule. Real card + OG; full pipeline.
---
### Puzzle #3 — New toy: Circuit (rotate-the-tiles network puzzle)

**Why it matters:** ⚠ **The most mesmerizing one-tap puzzle there is, and the best CARD image of anything on this list** — a dark grid of dead wires that lights up as one connected network the instant it is solved. Tap-only input, no dexterity, no reading, infinitely generatable, and the completion moment is a genuine light show. Category `game`/`visual` crossover.

**When to revisit:** Next puzzle round. Small scope — the generator is the only real work and it is easy (see notes).

**Notes:** A grid of tiles, each carrying a fragment of wire (end-stub, elbow, T, straight, cross). Tap a tile to rotate it 90°. Solve by rotating every tile until all wire fragments join into one closed network with no loose ends, at which point current flows from the source and the whole board lights.
- ⚠ **Generate the SOLVED board first, then scramble the rotations.** Building a random tile soup and checking solvability is the hard way round and mostly produces unsolvable boards. Grow a random spanning tree over the grid, derive each cell's tile shape from which neighbors it connects to, then randomly rotate every tile. Always solvable, any size, no solver required.
- **Design bar:** unlit wire is a dull etched channel; as segments join the source, current CRAWLS along them (animated, not an instant recolor) with a travelling glow head, so partial progress is visible and rewarding. Solved = a bloom across the whole board. Wrap toggle (edges connect around) as a harder mode.
- **Audio:** a soft relay click per rotation with pitch tied to how much of the network is now live, a rising hum as coverage grows, and a satisfying power-on swell at completion.
- Best time per size in `localStorage`; ticket rule (dir `down`). Real card + OG; full pipeline.
---
### Puzzle #4 — New toy: Threads (numberlink / flow)

**Why it matters:** ⚠ **The largest mobile-puzzle audience on this list after word games**, and a perfect one-gesture fit: drag from one colored dot to its twin, fill every cell, cross nothing. Instantly readable, endlessly replayable, and the finished board is a genuinely pretty object. Category `game`.

**When to revisit:** Next puzzle round, after Color Pour. ⚠ **Scope the generator FIRST** — it is the one real risk on this item (see notes).

**Notes:** Square grid seeded with pairs of colored dots. Drag from a dot to trace a path to its pair; paths may not cross or overlap, and a proper solve fills EVERY cell. Dragging a new path over an old one truncates the old one rather than refusing, which is what makes it feel fluid rather than fussy.
- ⚠ **The generator is the whole build.** Naive random dot placement mostly yields boards that are unsolvable or have many solutions. The reliable method is the same trick as Circuit — **construct the solution first**: partition the grid into a set of non-crossing snake paths that between them cover every cell, then keep only each path's two endpoints as the dot pair. Guaranteed solvable and guaranteed full-coverage by construction.
- **Design bar:** paths are thick rounded ribbons with a soft glow, laid down with a satisfying trailing animation; the cell under the finger snaps. Completion sweeps a shine along every thread in turn. Sizes 5×5 → 9×9.
- **Audio:** a soft pitched blip per cell entered, rising through a pentatonic run as a path extends (so tracing a long path is musical), a dull thunk on an illegal move, a chord on completion.
- Best moves/time per size; ticket rule. Real card + OG; full pipeline.
---
### Puzzle #5 — New toy: Nonogram / Picture Logic

**Why it matters:** ⚠ **Ranked #5 of the puzzle set: the most share-worthy PAYOFF of any puzzle here (the reveal is a picture), but the slowest to start and the only one needing real content work.** A beloved logic-puzzle genre (huge dedicated audience) absent from the site; solving reveals pixel-art — inherently rewarding and screenshot-friendly. Category `game`/puzzle.

**When to revisit:** Next puzzle round. Main scope: a curated set of solvable puzzles (or a generator + solvability checker).

**Notes:** AI suggestion (2026-07-05). Row/column count clues; tap to fill, long-press/second-tool to mark X; mistake-forgiveness toggle; 5×5 → 15×15 sizes. Content: procedurally generate boards and verify line-solvability, or hand-curate a pack of charming pixel-art reveals (animals, objects) — reveal animates + colorizes on completion. Timer + best per size in `localStorage`. Design: clean paper-grid aesthetic or glowing terminal; satisfying fill thunk, error buzz (gentle), completion chime + the picture coming alive. Keep the name generic ("Picture Logic" etc. — Picross is trademarked). Real card + OG; full pipeline.
- ⚠ **THE SHARE PROBLEM MIGHT BE SOLVABLE — this is what the "maybe" in the standing daily assessment was waiting on.** Nonogram was rated a maybe because **the picture reveal IS the spoiler**, so there is nothing to post that does not give the puzzle away. **The fix: color the shared emoji grid by WHEN each cell was filled, not by what is in it** — early greens through to late reds, or first-try versus corrected. That shows the SHAPE of your solve, where you found the foothold and where you struggled, and reveals not one cell of the picture.
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
- **Design bar:** heavy blocks with real weight — they resist, then slide with momentum and clunk against neighbors. Move counter against par.
- Best moves per level; ticket rule. Real card + OG; full pipeline.
---
### Puzzle #8 — New toy: Tangram

**Why it matters:** The most beautiful puzzle on this list and the most on-brand for the site's visual bar; seven pieces, public domain, thousands of years old. Ranks lower purely on virality — it is a slow, contemplative puzzle with less "one more go" pull than the top four. Category `game`/`visual`.

**When to revisit:** Next visual/craft round, or alongside a cozy release. Small-to-medium scope.

**Notes:** The classic seven pieces (5 triangles, 1 square, 1 parallelogram) dragged and rotated to fill a target silhouette. Snap to position and angle when close; the silhouette fills with color piece by piece as each one lands.
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

**Notes:** Clear pairs summing to 13 from a 28-card pyramid plus a stock; drag or tap pairs; win cascade like Solitaire's. Its own toy folder/slug. Reuse the felt + audio bus with a distinct table accent color. Real card + OG; full pipeline.

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

