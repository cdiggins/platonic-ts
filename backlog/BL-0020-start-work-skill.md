---
id: BL-0020
title: Add start-work command that records the execution approach
type: idea
status: idea
priority: "?"
effort: s
risk: low
area: repo
sprint:
created: 2026-08-23
closed:
links: [.claude/skills/track-idea/SKILL.md, .claude/skills/track-issue/SKILL.md, .claude/skills/track-backlog/SKILL.md, decisions/2026-08-22-adopt-workquarry-format.md, packages/core/src/index.ts]
---

## Idea

A `/start-work` command that takes work from decided to underway. Two jobs: (1) file it —
scoped work the user has decided to do lands in `backlog/` as `type: feature`,
`status: in-progress`, with `## Done means` required at capture (the gap the capture triad
leaves: `track-issue` punts `feature` to `track-idea`, and `track-idea` forces
`status: idea` plus a full elaboration pass, both wrong-shaped for already-decided work);
(2) **choose and record the execution approach** — parallel (fenced wave, one subagent per
track) versus sequential (inline or one subagent) — written into the item itself so the
choice is a durable record, not a decision re-made from scratch each session. Supersedes the
earlier `/track-work` framing of this item, which captured but never started.

## Assumptions

- The approach choice is worth recording. It drives fence tables, wave findings, and
  post-hoc "why did this take three sessions" questions — and today it lives only in a
  transcript.
- The existing schema covers filing — `type: feature`, `status: in-progress` already exist
  in `BacklogType`/`BacklogStatus` (`packages/core/src/index.ts:68-70`). Recording the
  approach may need one new optional frontmatter field (see design decisions), which is the
  only part that could touch code (`packages/backlog` parser + `packages/dashboard`).
- Filing straight past `idea` is legitimate when the user has decided — the idea→ready gate
  exists to force `## Done means`, which start-work requires at capture instead.
- `feature-dev` (currently user-global, not in this repo) stays the deep planning workflow;
  start-work is the thin front door, not a replacement.

## Design decisions

- **New skill vs extend feature-dev** — `feature-dev` already triggers on "start work on
  BL-xxxx" and already size-routes (XS/S build inline, M/L invoke `parallel-wave`). A: a
  thin `/start-work` that files the item, records the approach, and delegates to feature-dev
  for anything non-trivial vs B: no new skill — vendor feature-dev into the repo and add the
  filing + approach-recording steps to it. B is less surface; A is cheaper to reach for on
  small work. Decide before building.
- **Where the approach is recorded** — a frontmatter field (`approach: parallel |
  sequential`, machine-readable, dashboard can chart it, costs a parser + type + dashboard
  change) vs a body section (`## Approach`, zero code, invisible to tooling). Body section
  unless the dashboard need is real.
- **Who picks the approach** — always ask the user vs propose from size using feature-dev's
  own rule (XS/S sequential, M/L parallel) and let the user override. Propose-with-override
  matches how the size table already works.
- **Status at filing** — `in-progress` at start (accurate; the point of the command) vs
  `ready` then a separate promotion (redundant). `in-progress` implied.

## Related

- [.claude/skills/track-idea/SKILL.md] — sibling; start-work is the "already decided, doing
  it now" variant with lighter elaboration.
- [.claude/skills/track-issue/SKILL.md] — sibling; its type table
  (`bug|debt|problem|retire`) is the model for scoping, and its "use /track-idea for
  feature" punt is what start-work replaces.
- [.claude/skills/track-backlog/SKILL.md] — overlaps: it owns idea→ready promotion and
  sprint planning; start-work bypasses that path, so both must state the same `## Done
  means` requirement.
- [~/.claude/skills/feature-dev/SKILL.md] — heavy overlap: same trigger phrase, same
  parallel-vs-inline routing (size table, "M/L: invoke the `parallel-wave` skill";
  "XS/S: build inline"). Resolve the overlap before writing anything (design decision 1).
- [BL-0021] — vendoring `parallel-wave` into the repo; start-work's parallel branch should
  hand off to the repo copy, and both should cite the same no-worktree rule.
- [decisions/2026-08-22-adopt-workquarry-format.md] — constrains: schema is the TS types,
  one write path, skills edit item files directly + `npm run backlog:regen`.

## Approaches

Short term: write `/start-work` as a thin skill — allocate id (or accept an existing
`BL-XXXX`), file with `type: feature`, `status: in-progress`, required `## Done means`,
propose an approach from size and record the user's choice in an `## Approach` body section,
then hand off (parallel → `parallel-wave`, sequential → build inline). Update
`track-issue`'s feature punt to point at it.
Long term: vendor `feature-dev` into the repo and let `/start-work` be its entry point, so
one document owns framing → approach → handoff → shipping. If the approach becomes a
frontmatter field, the dashboard can show the parallel-vs-sequential mix and correlate it
with elapsed time and commit counts (the dashboard already correlates commits with sessions).
Adjacent ideas worth their own item:
- Vendor `feature-dev` into `.claude/skills/` (same rationale as BL-0021: repo-critical
  process living in an unversioned user-global file).
- Add an `approach` field to `BacklogItem` + dashboard visualization.

## Bedrock

The seam is the capture surface: skills that all funnel into one schema
(`packages/core/src/index.ts`) and one write path (`packages/backlog`). start-work
strengthens it twice — it makes the triad total over `BacklogType` (every type gets exactly
one entry command, no more cross-skill punts), and it moves one decision that currently
evaporates with the transcript (parallel vs sequential) into the durable record, which is
the precondition for ever measuring whether waves actually pay off here.
**Verdict: simplest-along-the-grain.** The simple version must NOT invent a parallel/
sequential planning process of its own — it delegates to `feature-dev` and `parallel-wave`
and only records the choice — otherwise a third overlapping process doc appears and the
"one process, one place" property that makes vendoring worthwhile (BL-0021) is lost.

## Done means

- [ ] `.claude/skills/start-work/SKILL.md` exists and appears in the session skill list
- [ ] Starting work via /start-work produces a valid `in-progress` item with `## Done means`
      filled and the chosen approach recorded (`npm run backlog:regen` clean)
- [ ] The approach branch actually hands off — parallel → `parallel-wave`, sequential →
      inline — with no duplicated planning steps of its own
- [ ] `track-issue`'s "use /track-idea for feature" punt points at /start-work
- [ ] `track-backlog` promotion rules and start-work's start-at-`in-progress` rule state the
      same `## Done means` requirement

## Simplest possible implementation

One new file `.claude/skills/start-work/SKILL.md`, adapted from `track-issue`: type fixed to
`feature`, status `in-progress`, Done-means mandatory, an `## Approach` section recording
parallel-or-sequential plus one line of why, then a handoff line. Plus a one-line edit to
`track-issue`'s punt text. No code, no schema change.
Pros:
- Zero code; ships in one commit; closes the documented gap the other skills punt around.
- Makes the parallel-vs-sequential choice a versioned record instead of transcript-only.
Cons:
- Fourth copy of the shared boilerplate (id allocation, regen rule, commit rule) — drift risk.
- Overlaps `feature-dev`'s trigger phrase; if the overlap is not resolved first, two skills
  compete for "start work on BL-xxxx".
- Body-section approach recording stays invisible to the dashboard until it becomes a field.
