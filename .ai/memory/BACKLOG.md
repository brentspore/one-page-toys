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
