---
id: BL-0020
title: Add track-work skill for capturing scoped work items
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

Add a `/track-work` skill alongside `track-idea` and `track-issue`, completing the capture
triad. It files already-scoped work — a feature or task the user has decided to do — into
`backlog/` in one shot. Interpretation of "for completeness from within the command": the
existing skills have a gap that surfaces mid-command. `track-issue` explicitly punts
`feature` to `track-idea`, but `track-idea` forces `type: idea`, `status: idea`, and a full
elaboration pass (assumptions, approaches, bedrock) — heavyweight and wrong-shaped when the
work is already decided. `track-work` captures decided work with `type: feature` (or task),
`status: ready`, a required `## Done means`, and light elaboration. It should also be cheap
enough for other skills/agents (feature-dev, parallel-wave debt sweep) to invoke mid-task
without derailing.

## Assumptions

- Scoped-but-unfiled work happens often enough that routing it through track-idea's
  elaboration is real friction (it does: track-issue's own header documents the punt).
- The existing schema needs no change — `type: feature`, `status: ready` already exist in
  `BacklogType`/`BacklogStatus` (`packages/core/src/index.ts:68-70`); this is process/skill
  work only, no code.
- Filing straight to `ready` is legitimate when the user has already decided to do the work
  — the idea→ready promotion gate (per the WorkQuarry ADR) exists to force `## Done means`,
  which track-work requires at capture instead.

## Design decisions

- **Straight to `ready` vs land as `idea`** — A: `status: ready` at capture (the point of
  the command; requires `## Done means` filled in, honoring the promotion gate's intent) vs
  B: always `idea` first (redundant with track-idea, defeats the purpose). A implied unless
  the user objects.
- **New type value vs reuse `feature`** — reuse `feature`; adding `task` to `BacklogType`
  would touch `packages/core` + parser + dashboard for little gain.
- **Elaboration depth** — full track-idea template vs minimal (Idea, Done means, Related,
  Simplest implementation). Minimal fits "work already decided"; Bedrock/Approaches are
  planning artifacts for undecided ideas.

## Related

- [.claude/skills/track-idea/SKILL.md] — sibling; track-work is the "already decided"
  variant with lighter elaboration.
- [.claude/skills/track-issue/SKILL.md] — sibling; its type table (`bug|debt|problem|retire`)
  is the model for track-work's scope (`feature`, maybe chores).
- [.claude/skills/track-backlog/SKILL.md] — overlaps: it owns idea→ready promotion; track-work
  bypasses that path, so both must agree on what `ready` requires (`## Done means` ticked-in).
- [decisions/2026-08-22-adopt-workquarry-format.md] — constrains: schema is the TS types,
  one write path, skills edit files directly + `npm run backlog:regen`.
- [BL-0016] — cites the track-* skills as the capture surface; a third skill extends that
  surface, no conflict.

## Approaches

Short term: copy `track-issue/SKILL.md` structure, adapt: type `feature`, status `ready`,
required Done-means at capture, sections trimmed to Idea / Related / Done means / Simplest
implementation. Register the same way the other two are registered.
Long term: a shared `track-common.md` referenced by all three skills so the id-allocation,
frontmatter, and regen/commit rules live in one place (they are currently duplicated).
Adjacent ideas worth their own item:
- Dedup the three skills' shared boilerplate into one referenced doc (the long-term above).

## Bedrock

The seam is the capture surface: three skills that all funnel into one schema
(`packages/core`) and one write path (`packages/backlog`). track-work strengthens it by
making the triad total over `BacklogType` — every type now has exactly one capture command,
so no more "which command do I use" punts inside skill docs, and mid-task agents (feature-dev
scope sweeps, parallel-wave debt handoff) get a deterministic filing target. Future skills
that discover work can reference `/track-work` instead of re-explaining the format.
**Verdict: simplest** — no code changes, one new SKILL.md.

## Done means

- [ ] `.claude/skills/track-work/SKILL.md` exists and appears in the session skill list
- [ ] Filing a feature via /track-work produces a valid item (`npm run backlog:regen` clean)
- [ ] `track-issue`'s "use /track-idea for feature" punt is updated to point at /track-work
- [ ] track-backlog's promotion rules and track-work's ready-at-capture rule state the same
      `## Done means` requirement

## Simplest possible implementation

One new file `.claude/skills/track-work/SKILL.md`, adapted from track-issue: type fixed to
`feature`, status `ready`, Done-means mandatory, minimal elaboration sections. Plus a
one-line edit to track-issue's punt text.
Pros:
- Zero code; schema untouched; ships in one commit.
- Closes the documented gap the other two skills punt around.
Cons:
- Third copy of the shared boilerplate (id allocation, regen rule) — drift risk grows.
- "Work" vs "idea" boundary is judgment; users may still pick the wrong command (mitigate:
  each skill's header names its siblings and their scope).
