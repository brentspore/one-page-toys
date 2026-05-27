# Project Backlog

Ideas and follow-ups for this project that are worth preserving but are not ready to act on yet.

Use this for parked feature ideas, audit candidates, cleanup tasks, product experiments, and future improvements. Backlog items are not approval to implement; surface them when choosing next work.

If a backlog item is reusable across projects, belongs to a shared workflow, or should become a portfolio-level standard, propose moving or copying it to `~/.ai/memory/BACKLOG.md`. If an item conflicts with global memory or duplicates another backlog item, ask before merging or deleting it.

## Entry format

### Idea title

**Why it matters:** The value or risk.

**When to revisit:** The trigger that makes it worth doing.

**Notes:** Any useful context, files, or constraints.

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
