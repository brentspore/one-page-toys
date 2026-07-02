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

### Add a "Sister sites" footer column linking to the affiliate-feeder family

**Why it matters:** Per project.md, one-page-toys' secondary purpose is top-of-funnel traffic for the rest of the Synergy portfolio. Currently the cross-link is **passive only** — visitors who land on a toy have no way to discover SE / BI / BOK from here. Adding a small "Sister sites" footer column (matching the pattern already shipped across SE / BI / BOK / JMML on 2026-05-24) realizes the latent traffic-feeding role without changing the character of the site.

**When to revisit:** Whenever this repo is next touched. Small change.

**Notes:** Pattern reference — see the corresponding footer columns already shipped on the four affiliate-feeder sites for the visual treatment and link copy shape (short descriptors per site, no icons, text-only, same-tab). For one-page-toys, just three target sites:
- **Supercharged Email** → https://superchargedemail.com — "Free tools + DIY email marketing"
- **Beautiful Inbox** → https://beautifulinbox.com — "White-glove email marketing service"
- **Biz Online Kit** → https://bizonlinekit.com — "Get your business online (domains, email, websites)"

JMML is omitted — it's the email-capture backend, not a customer-facing destination from a toys audience. Implementation in `assets/styles.css` or wherever the global footer lives; check `index.html` / `all-tools.html` for the current footer markup. No tracking params on the URLs — these are family links, not affiliate referrals.

---

### New toy: Maze (adventure / randomly-generated)

**Why it matters:** A maze is a broadly appealing, endlessly replayable fun toy that fits the "FUN / playful / experiential" direction and the `game` category. Random generation means infinite content from a small amount of code, and it photographs well for a card/OG.

**When to revisit:** Next time we're building new toys (owner picks candidates via AskUserQuestion). Good self-contained vanilla-Canvas build.

**Notes:** Owner idea (2026-07-02): "get through like an adventure game, or a randomly generated maze you have to get through." Two flavors to consider (offer via AskUserQuestion, or blend):
- **Pure random maze** — procedurally generate a perfect maze (recursive backtracker / DFS, or Prim's) on a grid; player navigates start→exit via swipe/arrow/tap-to-path; new maze each play, difficulty via grid size. Add a subtle "fog"/limited-view or minimap for tension; timer + best-time in `localStorage`.
- **Adventure flavor** — top-down explorer: a character walks the maze, collect a key → open the exit, maybe torch-lit limited vision, a few pickups/hazards, themed tileset (dungeon / hedge garden / cave). Keep it a single screen or a smoothly-scrolling camera.
- Must be **interactive + a curated little world** per the design quality bar (lighting, palette, depth — not flat cells). Real rendered card + OG. Touch controls (swipe to move) for mobile. Follow the add-a-toy pipeline (registry/sitemap/NL/card+`:not()`/og-gen, hub cache-bust). Consider a synth footstep/pickup/win voice per the audio quality bar.

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
