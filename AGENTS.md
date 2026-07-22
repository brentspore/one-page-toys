# AGENTS.md

Instructions for Codex and other AI coding agents working in this repository.

## Start here

Durable project context lives in `.ai/memory/`. The tool-agnostic memory and
collaboration conventions live in `AI.md`.

Before substantive work, read these files in order:

1. `AI.md`
2. `.ai/memory/HANDOFF.md` — current state and resume instructions
3. `.ai/memory/MEMORY.md` — index of the full project memory
4. `.ai/memory/DECISIONS.md` — settled project decisions

Then read the task-relevant files linked from `.ai/memory/MEMORY.md`, including
`.ai/memory/reference.md`, `.ai/memory/design-principles.md`, and
`.ai/memory/new-tool-strategy.md` when applicable.

## Source-of-truth rules

- Treat `.ai/memory/HANDOFF.md` as the authoritative current-state bridge.
- `.ai/memory/project.md` describes the pre-June 2026 architecture and is stale;
  when it conflicts with `HANDOFF.md`, follow `HANDOFF.md`.
- Keep durable, tool-independent project knowledge in `.ai/memory/`, not in this
  file or tool-specific instruction folders.
- Follow the memory-writing and backlog rules in `AI.md`. Do not update durable
  memory unless the user asks or approves it.

## Repository safeguards

- Do not commit or push unless the owner explicitly says `push`.
- Never include `.claude/settings.json` in a commit.
- Preserve `CLAUDE.md`; it is the Claude-specific entrypoint to the same shared
  project memory.
