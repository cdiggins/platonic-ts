---
date: 2026-08-22
title: Adopt WorkQuarry issue-tracking format natively in TypeScript
status: accepted
superseded-by:
links: [packages/backlog/src/index.ts, packages/core/src/index.ts, backlog/BACKLOG.md]
---

## Context

`backlog/` already held nine `BL-000X` markdown files with a thin frontmatter schema
(id, title, status: todo|doing|done|blocked, priority: number, owner, created), parsed by
`packages/backlog/src/index.ts` into a `BacklogItem` type shared from `packages/core`.
Separately, `C:\Users\cdigg\git\studio\submodules\workquarry` (a sibling project, read-only
reference here) defines a richer markdown-plus-YAML-frontmatter issue format — type, status,
priority, effort, risk, area, sprint, links, a required `## Done means` section before an
item is promoted to `ready`, plus generated `BACKLOG.md`/`DONE.md` views and dated ADRs —
along with a Python CLI (`track.py`) and three Claude Code skills that elaborate ideas and
issues before filing them.

The question: how does platonic-ts get the benefit of WorkQuarry's schema and process
without breaking its own constraints (TypeScript-only monorepo, no Python runtime
dependency, `npm run check`'s strict tsc + eslint functional subset + escape-hatch ratchet
gate, hand-rolled frontmatter parsing rather than a YAML library)?

## Decision

Adopt the WorkQuarry *format and process* natively in TypeScript. Keep the existing
`packages/backlog` and `packages/core` TypeScript code as the only implementation:

- `BacklogItem` in `packages/core/src/index.ts` gains `type`, `effort`, `risk`, `area`,
  `sprint`, `closed`, `links`, and `status`/`priority` move to WorkQuarry's value sets
  (`idea|ready|in-progress|done|dropped` and `p1|p2|p3|?`).
- `packages/backlog/src/index.ts`'s hand-rolled frontmatter parser is extended, not
  replaced — no YAML library is added. It stays tolerant: old thin-schema files parse with
  defaults (legacy `todo`→`ready`, `doing`→`in-progress`, `blocked`→`ready`,
  numeric priority `1..3+`→`p1..p3`).
  See `packages/backlog/test/backlog.test.ts` for the exact mapping table under test.
- Pure functions (`buildBacklogTable`, `buildDoneLog`) plus a small CLI
  (`packages/backlog/src/main.ts`, `npm run backlog:regen`) regenerate `backlog/BACKLOG.md`
  and `backlog/DONE.md` from the item files, following the same composition-root pattern as
  `packages/check/src/main.ts`.
- `.claude/skills/track-idea`, `track-issue`, `track-backlog` are adapted from
  WorkQuarry's skills, rewritten to call the TS CLI and reference this repo's paths instead
  of `track.py`.
- `packages/dashboard` renders the new fields.

## Rationale

The valuable part of WorkQuarry is not the Python script — it is the schema (the
record-versus-document test, `## Done means` gating promotion to `ready`, generated views,
dated ADRs) and the elaboration skills. platonic-ts already has a working TypeScript
backlog reader wired into its dashboard; duplicating that machinery in a second language, or
depending on it at runtime, adds a moving part for no benefit a solo/single-agent repo would
notice. Extending the existing parser keeps one source of truth for the schema (the
TypeScript types) and one gate (`npm run check`) that all backlog code must pass.

## Alternatives rejected

- **3rd-party install (run `install.py` against this repo).** Pulls in a Python runtime
  dependency and a second write path (`track.py`) alongside the existing TypeScript one.
  Two implementations of "regenerate BACKLOG.md" is exactly the kind of drift WorkQuarry's
  own README warns installed copies can suffer from.
- **Git submodule.** Explicitly ruled out by the task: adds a second repository to clone,
  pin, and update for a ~400-line script whose logic is small enough to port directly.
  Also reintroduces the Python dependency.
- **Fork-copy (vendor `track.py` verbatim into this repo).** Keeps Python without even the
  submodule's update path, and still leaves two languages doing the same job (backlog
  reading already exists in TypeScript for the dashboard).
- **Format-adoption (chosen).** Keep the WorkQuarry schema and process; port only the parts
  that carry real value into the existing TypeScript implementation. One language, one gate,
  one write path (`packages/backlog`), and the schema stays interoperable with WorkQuarry's
  documented format if the two projects ever want to compare notes.

## Consequences

- `packages/backlog` becomes the single source of truth for the schema; changes to the
  WorkQuarry format upstream do not propagate automatically and must be re-ported by hand.
  Acceptable: the schema is expected to be stable, and the process docs
  (`.claude/skills/track-*`) already live in this repo, not upstream.
- No `report --html`/`--md` snapshot command was ported (out of scope for this change); the
  live dashboard already covers that need for this repo.
- Legacy thin-schema files remain parseable indefinitely (tolerant defaults), so no forced
  rewrite of history is required, but new items should use the full schema going forward.
