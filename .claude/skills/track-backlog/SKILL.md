---
name: track-backlog
description: View and manage the backlog — show in-progress work, current priorities, sprint contents; triage untriaged items; promote ideas to ready; plan a sprint (big rocks + little rocks, parallel-safe). Use when the user says /track-backlog, "what's in progress", "show the backlog", "triage", "promote X", "plan a sprint", "what should we work on next".
argument-hint: [status | triage | promote <id> | sprint plan <name> | sprint show]
---

# track-backlog — query and manage the backlog

Item frontmatter is the database — `backlog/BL-XXXX-*.md` for open work plus
`backlog/archive/BL-XXXX-*.md` for closed work, and any question about the full item set
(ids in use, prior art) must cover both directories. `backlog/BACKLOG.md` is a
generated view — never hand-edit it or `backlog/DONE.md`. Edit item frontmatter directly,
then run `npm run backlog:regen` (calls `buildBacklogTable`/`buildDoneLog` in
`packages/backlog/src/index.ts` via `packages/backlog/src/main.ts`). Process reference:
`decisions/2026-08-22-adopt-workquarry-format.md`.

## Operations (pick by argument or intent)

### status (default, no argument)
Show the working picture. Read `backlog/BACKLOG.md` (or `Grep` the frontmatter directly for
a live view) and report three short groups: items with `status: in-progress`, items in the
current `sprint:` if one is active, and `status: ready` sorted by priority. Report: what's
moving, what's queued, anything stale (in-progress with no recent commits touching its
area — flag, don't assume). Keep it to one screen.

### triage
List items with `status: idea`, sorted by priority. For each untriaged item (`priority: "?"`
or similarly unscoped) or aging idea, propose: priority (severity × frequency × what it
blocks), effort, risk, and promote/keep/drop. Present as a short table of proposals; apply
only what the user approves by editing the item's frontmatter fields directly, then
`npm run backlog:regen`. Recommend dropping ideas untouched for weeks with no champion —
setting `status: dropped` + `closed: <date>` is cheap; the file remains greppable.

### promote <id>
Promotion = `idea` → `ready` ("an agent may pick this up"). Before flipping:
- priority/effort/risk must be real values, not `?`
- `feature`/`debt`/`bug` REQUIRE a `## Done means` section (2–5 verifiable statements) to
  exist in the body first — add it if missing before promoting
- `problem` needs no acceptance criteria (it closes with an ADR)
Edit the item's `status:`, `priority:`, `effort:`, `risk:` fields, then
`npm run backlog:regen`.

### sprint plan <name>   (e.g. 2026-01-A)
A sprint is a **working set**, not a time-box: the batch of items selected for parallel
execution now. Selection is not priority order alone — compose it:
1. **Big rocks** (1–3): highest impact `ready` items, typically L/M effort.
2. **Little rocks**: S/M items that fill gaps — quick wins, debt paydown, and items that
   de-risk future big rocks.
3. **Parallel safety**: check each candidate's `## Dependencies` section (blocked-by must be
   empty or done; "touches" must not collide with another sprint member — two agents editing
   the same area/package = merge pain). Prefer spreading across `area:` values.
4. **Risk balance**: not all high-risk items at once; pair each risky item with sure things
   so the sprint always ships something.
Propose the set with one-line reasoning each; on approval, set `sprint: <name>` on each
member's frontmatter and `npm run backlog:regen`. Remove with `sprint:` (empty). Only one
sprint should normally be active.

### sprint show
List items whose `sprint:` field matches the given name (`Grep` frontmatter or filter
`backlog/BACKLOG.md`'s sprint column). Plus per-item one-liner: on track / blocked / not
started.

## Queries agents can use directly
`Grep`/read `backlog/BACKLOG.md` for open items, or scan `backlog/*.md` frontmatter (add
`backlog/archive/*.md` when the question includes closed items — ids in use, for instance)
for:
```
type: debt
status: ready
area: dashboard
```

## Rules
- Every frontmatter edit is followed by `npm run backlog:regen` — no manual
  `BACKLOG.md`/`DONE.md` edits, ever.
- Don't change priorities silently: triage and promotion changes are proposed to the user
  first (exception: filing brand-new items via `/track-idea` or `/track-issue`, where the
  filer sets initial values).
- Closing items: set `status: done` (or `dropped`) + `closed: <date>` on the item, run
  `npm run backlog:archive` to move it into `backlog/archive/` and then
  `npm run backlog:regen`, and mention the item's id in the closing commit message so git
  history and backlog state stay joined. Archiving is a separate command on purpose — regen
  never moves files.
