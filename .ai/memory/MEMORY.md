# MEMORY.md

- [Handoff — resume here](HANDOFF.md) — **read first.** Cross-device current state + how to continue (in-repo so it travels via `git pull`). Supersedes `project.md` where they conflict.
- [Project overview](project.md) — purpose & architecture — **NOTE: pre-2026-06 era (old ~60-toy tool-shell framework); see HANDOFF.md for the current launcher-hub + 19 standalone toys**
- [Project reference](reference.md) — commands, repo pointers, external systems, and operational notes
- [Project decisions](DECISIONS.md) — project-specific decisions that should not be relitigated
- [Project backlog](BACKLOG.md) — deferred ideas and follow-ups for this project
- [Design principles](design-principles.md) — CSS scoping rules, architecture vs. style, tool page structure, interaction safety
- [New tool strategy](new-tool-strategy.md) — SEO-first approach and implementation checklist for adding tools/toys

## How to use this memory

Read `~/.ai/memory/MEMORY.md` first when available, then this project memory. Keep this file as an index. Put durable project facts in the linked files, not in chat history.

If a decision discovered in this project should apply across projects, add it to `~/.ai/memory/DECISIONS.md` instead of burying it here. If this project is an exception to a global preference, document the exception in this project memory.

If the user asks to "remember this for later", ask whether it should become a backlog item and whether it belongs globally or in this project. If the user says "make this global", ask whether to record a global decision, project decision, or both.

If the user says "memory audit", audit this project memory, global memory, and native-tool memory for conflicts, stale entries, misplaced backlog, secrets/public-safety issues, reusable lessons, unclear source attribution, and missing handoff summaries. Ask before editing.

Keep canonical project memory lean. Store conclusions, decisions, constraints, and pointers rather than long copied source content. Use `.ai/memory/dump.md` only as temporary staging; once fully reviewed and assimilated, remove it from the project files.
