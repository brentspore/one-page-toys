# AI.md

Tool-agnostic instructions for AI coding assistants working in this repo.

1. Read the user-level memory when available: `~/.ai/memory/MEMORY.md`.
2. Read this repo's project memory: `.ai/memory/MEMORY.md`.
3. Treat `.ai/memory` as the source of truth for durable project context. Native AI-tool or builder memory may exist separately, but should not become the canonical project memory store.
4. Keep user-level memory broad and stable; keep project memory specific to this repo's product, architecture, commands, external systems, decisions, and backlog.

## Decision and backlog rule

When a durable decision comes up, ask whether it belongs in global decisions (`~/.ai/memory/DECISIONS.md`) or this project's decisions (`.ai/memory/DECISIONS.md`). When an idea is worth saving but not acting on yet, add it to the appropriate backlog: global `~/.ai/memory/BACKLOG.md` or project `.ai/memory/BACKLOG.md`.

Use this split even when the decision emerges while working inside one project:

- Put cross-project preferences, recurring UI standards, collaboration norms, engineering defaults, and reusable workflow decisions in `~/.ai/memory`.
- Put project-specific product direction, architecture, commands, deployment notes, external systems, and local tradeoffs in `.ai/memory`.
- If a project intentionally differs from a global default, record the global default globally and the exception in the project memory.
- Treat backlog items as memory, not approval to implement. Surface them when planning next work, and ask before acting.
- If a backlog item is duplicated, stale, vague, or appears to belong in both global and project memory, ask whether to keep, combine, split, update, or delete it.
- Treat global memory as the default. Project memory may override it only when a project-specific exception is explicitly documented.

Example: "dropdown carets should never visually crowd the right border" is a global UI preference unless a specific project's design system intentionally overrides it.

## Builder-to-repo workflow

Some projects may start as ideation/testing in Lovable or another builder, then sync to GitHub later. Once a project has a local repo, initialize or update this memory scaffold and capture what the builder established: product purpose, routes/pages, external services, deployment behavior, generated code constraints, and anything that future AI coding tools need before making deeper changes. Builder/native-tool folders such as `.lovable`, `.cursor`, `.codex`, or `.claude` may contain useful clues, but durable memory should be promoted into `.ai/memory`.

## Memory hygiene rule

Only add memory when it passes this test: "Will this save us from repeating a meaningful conversation later?" Prefer updating or pruning stale memory over appending forever.

Compress before writing canonical memory. Store conclusions, decisions, constraints, and source pointers, not full transcripts or long copied passages. Prefer updating an existing entry over appending a near-duplicate.

Keep memory files separated by purpose: `project.md` and `reference.md` are summaries; `DECISIONS.md` is for settled choices; `BACKLOG.md` is for deferred items. Do not let one file become a catch-all.

Treat `.ai/memory/dump.md` as temporary staging, not canonical memory. Once it has been fully reviewed and assimilated, remove it from the project files.

Flag stale memory instead of following it blindly. If memory appears outdated, contradicted by the repo, or tied to an old workflow, ask whether to update, archive, or delete it.

Do not commit secrets, `.env` values, auth files, provider tokens, private keys, service role keys, or credentials to memory. Store only where secrets live and what they are for.

Before committing memory, consider repo visibility. If the repo is public or visibility is unknown, flag memory that may expose personal, client, infrastructure, operational, or private business context.

Commit memory changes separately from code changes when practical.

Prefer memory entries with source context: where the fact came from, when it was learned, or what file/system supports it.

## Conversational memory triggers

If the user says something like "remember this for later", "save this for later", "park this", "put this on the list", or "we should come back to this", ask whether it should become a backlog item and whether it belongs in the global backlog (`~/.ai/memory/BACKLOG.md`) or this project's backlog (`.ai/memory/BACKLOG.md`).

If the user says something like "make this global", "this should apply everywhere", "always do this", or "new rule", ask whether it should become a global decision, a project decision, or both with a project-specific exception. Use `~/.ai/memory/DECISIONS.md` for global decisions and `.ai/memory/DECISIONS.md` for project decisions.

If the user says something like "remember this about me", "my preference is", or "I like/don't like", ask whether it belongs in the global user profile (`~/.ai/memory/user_*.md`) or as a decision. If the target is ambiguous, ask before writing.

If the user says "memory audit", audit global, project, and native-tool memory for conflicts, stale items, misplaced backlog, secrets/public-safety issues, promotion candidates, project exceptions, unclear source attribution, and missing handoff summaries. Show findings and ask before editing.

If the user says "memory dump", collect learned context from this one project into `.ai/memory/dump.md` without merging it into canonical memory yet. The dump should be lean temporary staging: summarize source files inspected, project facts, commands, external systems, decisions, backlog, reusable global candidates, project memory candidates, conflicts/questions, and public-safety concerns. Reference source paths instead of copying long content.
