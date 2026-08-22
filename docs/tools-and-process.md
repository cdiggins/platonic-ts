# Tools, Skills, and Process

A human-facing guide to how this repository is built and operated: the commands you run, the
tools behind them, the Claude Code skills in use, and the multi-agent process that produced the
code. Agents get their orientation from [AGENTS.md](../AGENTS.md) and
[CONTRACTS.md](../CONTRACTS.md); this document is the same material explained for people, plus
the pieces that live outside the repository (skills, session transcripts) that the agent docs
take for granted.

## Tools

### `npm run check` — the gate

The single definition of green. It runs four steps in order and stops at the first failure:

1. **Typecheck** — `tsc --noEmit` with strict settings (`strict`, `noUncheckedIndexedAccess`,
   `exactOptionalPropertyTypes`, `noImplicitReturns`).
2. **Lint** — ESLint with a functional-subset configuration (`eslint.config.js`, built on
   `eslint-plugin-functional`): immutable data, no classes, expressions over statements. A
   small purity ban (no `Date.now`, `process.env`, `console`, `throw`) applies everywhere
   except files named `main.ts`, `server.ts`, or `io.ts`, where IO is allowed.
3. **Ratchet** — counts the escape hatches in the codebase (`any`, `as` casts, non-null `!`
   assertions, `@ts-ignore`-style directives, `eslint-disable` comments) and compares against
   the committed baseline in [ratchet.json](../ratchet.json). Counts may fall but never rise;
   a rise fails the gate. Lowering the baseline is done by committing the improved counts.
4. **Tests** — `vitest run` across all packages.

Each step also runs on its own: `npm run typecheck`, `npm run lint`, `npm run test`. The
implementation lives in `packages/check` — a pure per-file scanner (`countEscapeHatches`,
TypeScript AST walk) plus a thin CLI. The scanner works on any TypeScript file, not just this
repo; it was pointed unmodified at a foreign codebase during the first Gratify probe.

### `npm run dashboard` — observability

Starts a local server on <http://localhost:4747> that tails Claude Code session transcripts
(the JSONL files Claude Code writes for every session, including subagent transcripts) and
shows, live via server-sent events:

- every agent seen in the transcripts, with its most recent model, tool, and activity snippet;
- token usage totals and output-tokens-per-minute;
- the backlog (from `backlog/`) and the design documents (from `docs/`).

It is passive: it reads transcripts Claude Code writes anyway, so it needs no hooks or
instrumentation in the agents themselves. This is how weak-model delegation is verified — a
track handed to Haiku shows up on the dashboard as a Haiku row with its own token count.

Implementation: `packages/transcripts` (parsing, tailing, aggregation),
`packages/dashboard` (HTTP + SSE server, single-page UI), composed in
`packages/dashboard/src/main.ts`.

### The backlog

Work items are one markdown file each in `backlog/`, named `BL-0001-slug.md`, with a small
frontmatter block (`id`, `title`, `status`, `priority`, optionally `owner` and `created`) and a
free-form body. Status is one of `todo`, `doing`, `done`, `blocked`. The dashboard renders the
backlog sorted by status then priority. Parsing and rendering live in `packages/backlog`; the
exact format is specified in [CONTRACTS.md](../CONTRACTS.md).

## Skills

Skills are reusable prompt packages installed in Claude Code (they live in the user's
`~/.claude` configuration, not in this repository). The ones this project actually uses:

- **parallel-wave** — the multi-agent wave process described below: split a feature into
  fenced tracks, spawn one subagent per track, integrate and gate. This is the skill that
  built most of the code here.
- **caveman** (and its companions `cavecrew`, `caveman-commit`, `caveman-stats`) — an
  ultra-compressed output style that cuts token usage roughly 65% while keeping technical
  content intact. Used for day-to-day interaction and for subagent reports, in service of the
  project's tokens-per-task goal. Session token numbers quoted in [NOTES.md](../NOTES.md) were
  gathered under it.
- **write-readme** — plain-prose README writing and review; used to keep the README honest
  about what is tested versus aspirational.

The reasoning about what should be a skill versus a hook versus an MCP tool is in
[Claude Code Integration](claude-code-integration-2026-08-22.md): checkable rules become
hooks, questions become MCP tools, and only the uncheckable residue becomes skills.

## Process

### Fenced parallel waves

Features are built in *waves*: a supervisor agent splits the work into tracks that can proceed
in parallel on one shared checkout (no branches, no worktrees), then spawns one subagent per
track. Two mechanisms keep them from colliding:

- **Fences** — each track has an explicit write-list (glob patterns in
  [CONTRACTS.md](../CONTRACTS.md)); everything else, including `packages/core` and all
  configuration, is supervisor-owned and read-only to tracks. Tracks commit with a pathspec
  limited to their fence (`git commit -- <paths>`), and only the supervisor pushes.
- **Seams** — the exact exported types and function signatures each track must implement,
  written down in CONTRACTS.md before the wave starts. Tracks implement to the seam; the
  supervisor composes the results (in `packages/dashboard/src/main.ts` and root scripts) after
  the wave.

If a track needs something outside its fence (a dependency, a contract change), it requests
the smallest unblocking change by appending to [NOTES.md](../NOTES.md) rather than editing
supervisor-owned files.

Two waves have run so far. Wave 1 (transcripts, backlog, dashboard) integrated with zero merge
conflicts and a green gate on the first run. Wave 2 (the check runner, dashboard polish, lint
cleanup) surfaced the findings recorded in NOTES.md. Per-track token costs and what worked are
logged there after every wave.

### NOTES.md as a deliverable

Every agent appends its findings — contract friction, format surprises, gate results, token
costs — to [NOTES.md](../NOTES.md). It is treated as a first-class output alongside the code:
the raw material for improving the contracts, the fences, and the process itself.

### Model selection

Tracks are matched to model strength. Well-specified tracks with tight seams go to weaker,
cheaper models (Haiku handled the backlog track for 8.3k output tokens); tracks involving
design judgment or heavy refactoring go to stronger ones. The wave 1 finding: spec precision,
not model strength, was the binding constraint.

### Git conventions

Commit directly to `main` — no branches, no worktrees (the reasoning is in
[Git Worktrees and Branches for Concurrent Coding Agents](worktrees-and-branches-for-agents-2026-08-22.md)).
Commit at milestones with a fence-scoped pathspec; `git pull --rebase` before pushing, because
parallel agents collide; only push after the gate is green.
