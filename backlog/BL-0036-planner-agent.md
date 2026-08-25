---
id: BL-0036
title: Add a planner agent that balances features, bugs, debt, and reviews
type: idea
status: idea
priority: "?"
effort: "?"
risk: "?"
area: repo
sprint:
created: 2026-08-25
closed:
links: [BL-0034, BL-0035, .claude/skills/track-backlog/SKILL.md, .claude/skills/start-work/SKILL.md, .claude/agents/architect.md, packages/core/src/index.ts, packages/backlog/src/index.ts, docs/technical-debt-in-agentic-projects-2026-08-23.md]
---

## Idea

A planner agent that decides what to work on next by balancing the *kinds* of work against each
other: big features, small bugs, technical debt, and recurring review passes. Not a
prioritiser — the backlog already carries `priority: p1|p2|p3` — but a **mix** judge. Its output
is a proposed working set whose composition is defensible: how much of the next batch goes to new
capability, how much to defect repair, how much to paying down debt, and how much to the reviews
that generate the next round of findings.

Interpretation of the ambiguous half. "Regular reviews" means the review passes this repository is
in the process of acquiring — the diff-scoped code review in
[BL-0035](BL-0035-code-review-agent.md) and the standing architecture survey in
[BL-0034](BL-0034-architecture-opportunities-command.md) — treated as *scheduled work that
consumes budget*, not as something that happens for free between tasks. That is the part
`track-backlog`'s existing sprint planner cannot express, because a review is not a backlog item
until it has already run and filed one.

## Assumptions

- The frontmatter is already a sufficient database for the mix question. Every item carries
  `type` (`feature | debt | bug | idea | problem | retire`), `priority`, `effort`, `risk`, `area`,
  `status`, `approach`, `created`, and `closed` — the full schema is in
  `packages/core/src/index.ts:72-106`, and `loadBacklog` in `packages/backlog/src/index.ts:160`
  reads all of it. Nothing new needs to be recorded for a mix to be computed.
- There is a real problem to solve, visible in today's state. Five items are `in-progress`
  simultaneously (BL-0004, BL-0005, BL-0010, BL-0020, BL-0021), no item has a `sprint:` value set,
  and three items sit at `status: done` in `backlog/` without having been archived (BL-0023,
  BL-0025, BL-0032). Whatever is deciding what happens next is not producing a balanced or
  closed-out working set.
- The existing sprint planner balances the wrong axes for this question. `track-backlog`'s
  `sprint plan` composes by **size** (big rocks / little rocks), **parallel safety**, and **risk**.
  It never asks what fraction of the batch is defect repair versus new capability, and it has no
  concept of a review pass at all.
- Part of the procedure it does specify is not backed by data. Step 3 tells the planner to check
  each candidate's `## Dependencies` section for blocked-by and touches; **no item in `backlog/`
  has such a section**. A planner agent built on that instruction inherits a check that silently
  passes every time.
- Balance is a judgement, not a formula. A fixed ratio ("20% debt every sprint") is
  administratively tidy and usually wrong — it forces debt work in a week where a p1 bug is open.
  What is worth automating is the *evidence* for the judgement, not the judgement.
- The user wants this run occasionally and deliberately, at the start of a batch of work, not on
  every commit.

## Design decisions

- **Agent vs. an operation on the existing skill.** A new `.claude/agents/planner.md`, versus a
  new operation inside `.claude/skills/track-backlog/SKILL.md` (which already owns `status`,
  `triage`, `promote`, `sprint plan`, `sprint show`). The skill owns backlog state and is the
  documented home for planning; splitting the mix decision into an agent puts two things that
  write `sprint:` in two files. Against that: an agent gets fresh context, and a planner that has
  been watching the session argue for one feature all afternoon is not neutral about it. The
  precedent in this repo is that agents exist for isolation and skills for procedure — see
  `.claude/agents/architect.md`, which is spawned by `/start-work` rather than inlined into it.
- **Whether the mix is computed or read.** A planner that greps 35 item files spends its budget on
  arithmetic. `loadBacklog` already parses every item into a typed record, so a `npm run backlog:mix`
  style summary — counts and effort totals grouped by `type` and `status`, open versus closed in a
  window — would hand the agent numbers instead of files. That is a small pure function next to
  `buildBacklogTable` in `packages/backlog/src/index.ts`, and it is the only part of this idea that
  plausibly wants code rather than prose.
- **How review work enters the plan.** Three options, and they differ in what they cost. (a) The
  planner *schedules* review runs as part of the batch — "this batch includes one architecture
  survey" — with nothing tracked. (b) Each scheduled review is filed as a backlog item before the
  batch starts, so it appears in the mix and can be closed. (c) Reviews are triggered by a
  condition rather than a schedule — after N items close, or when a package's changed-line count
  passes a threshold. Option (b) makes reviews visible to every other query at the cost of item
  churn; option (c) is the only one that survives the user forgetting to run the planner.
- **What "balance" is measured against.** The open backlog's composition (what is queued), the
  closed history's composition (what actually shipped, from `closed:` dates in `backlog/archive/`),
  or a target the user states once. Only the second is honest about where time goes, and it is
  computable today. The first is a plan; the second is a record; a planner that reports both is
  more useful than one that reports either.
- **Whether it may write.** Setting `sprint:` on the members is the whole point of a plan, but
  `track-backlog`'s rules state that priority and promotion changes are proposed to the user
  before applying. If the planner is an agent it should propose and let the calling session apply,
  matching the routing decision taken in [BL-0035](BL-0035-code-review-agent.md).
- **Whether the work-in-progress limit is part of this.** Five concurrent `in-progress` items is
  the most visible imbalance in the current state, and a WIP cap is a different mechanism from a
  mix target — it constrains starting rather than selecting. Deciding whether the planner enforces
  it or merely reports it changes whether this stays advisory.

## Related

- [.claude/skills/track-backlog/SKILL.md](../.claude/skills/track-backlog/SKILL.md) — the direct
  overlap. It already owns `triage` (proposes priority/effort/risk), `promote`, and `sprint plan`.
  This item is either a new operation there or an agent it calls; it must not become a second
  writer of `sprint:` frontmatter.
- [BL-0034](BL-0034-architecture-opportunities-command.md) — one of the "regular reviews" this
  planner would schedule. Its own open question is how repetition is suppressed across runs, which
  is the same question as "how often should this be scheduled".
- [BL-0035](BL-0035-code-review-agent.md) — the other review pass, and the item that settles the
  agent-proposes / session-applies routing pattern this one should follow.
- [.claude/skills/start-work/SKILL.md](../.claude/skills/start-work/SKILL.md) — the consumer. It
  takes work that is already decided; the planner is what makes the decision, so the seam between
  them is "planner proposes a set, start-work executes one member".
- [docs/technical-debt-in-agentic-projects-2026-08-23.md](../docs/technical-debt-in-agentic-projects-2026-08-23.md)
  — the repo's existing thinking on debt accumulation; the debt share of the mix is the lever it
  argues about, and the planner should not re-derive its conclusions.
- `packages/core/src/index.ts:72-106` — `BacklogType`, `BacklogPriority`, `BacklogEffort`,
  `BacklogRisk`, `BacklogApproach` and the `BacklogItem` record. The mix vocabulary is fixed here;
  the planner must use these values rather than invent categories.
- `packages/backlog/src/index.ts` — `loadBacklog`, `isOpen`, `buildBacklogTable`, `buildDoneLog`.
  Any computed mix summary belongs beside these, as a pure function over `readonly BacklogItem[]`.

## Approaches

Short term:

1. **Report before deciding.** Add a mix summary — open and closed items grouped by `type`, with
   effort totals and a work-in-progress count — as a pure function next to `buildBacklogTable`,
   exposed as `npm run backlog:mix`. It answers "what is the current balance" without any agent
   at all, and it is the evidence any planner would need first. Smallest useful piece, and the
   only piece that is testable.
2. **A `plan` operation in `track-backlog`** that runs the mix summary, then proposes a working
   set with a stated composition and a one-line reason per member, extending the existing
   `sprint plan` step list with a type-mix step and a review-scheduling step. No new agent, no
   second writer of `sprint:`.
3. **`.claude/agents/planner.md`** only if fresh context turns out to matter — that is, if the
   in-session planner is observed to over-select whatever the session was just discussing.

Long term: close the loop. Every item records `created`, `closed`, `effort`, and `approach`, and
`packages/transcripts` already parses session activity, so the planner could eventually compare
planned mix against actual time and report where the batch drifted. That is also what would make
review scheduling condition-based rather than calendar-based — reviews fire when the measured
change volume since the last one crosses a line.

Adjacent ideas worth their own item:

- Fix `track-backlog`'s `sprint plan` step 3: it checks a `## Dependencies` section that no item
  has. Either the section becomes part of the item template or the step becomes a real check.
- A work-in-progress cap, enforced or reported — five concurrent `in-progress` items today.
- Archive the three closed-but-unarchived items (BL-0023, BL-0025, BL-0032) and decide whether
  `npm run backlog:archive` should be part of the check gate rather than a manual step.

## Bedrock

The seam this strengthens is the one between `backlog/` frontmatter and the procedures that read
it. Today every planning procedure is prose in `.claude/skills/track-backlog/SKILL.md` that
instructs a model to eyeball item files, and the cost of that shows up as an instruction nobody
notices is dead — step 3's `## Dependencies` check reads a section that does not exist in any of
the 35 items. Turning the readable half of planning into a pure function over
`readonly BacklogItem[]`, beside `buildBacklogTable` and `isOpen` in `packages/backlog/src/index.ts`,
makes the planner's inputs testable and makes a dead instruction fail loudly instead of quietly.

The invariant worth protecting is single ownership of `sprint:`. `track-backlog` writes it today
and its rules require user approval first. A planner that also writes it creates two paths to the
same field with different approval rules, which is exactly the kind of drift the architect exists
to prevent.

Verdict: **simplest-along-the-grain**.

The simple version — a mix summary plus a `plan` operation in the existing skill — must NOT:

- become a second writer of `sprint:`, `priority:`, or `status:`; it proposes and the user applies,
  matching the rule already stated in `track-backlog`;
- hard-code a ratio ("20% debt") anywhere in code; the numbers are evidence, the mix is a judgement,
  and a ratio in a pure function will be obeyed long after it stops being right;
- invent new work categories; `BacklogType` in `packages/core/src/index.ts:75` is the vocabulary;
- schedule reviews by wall-clock date, which nothing in this repository can observe or enforce.

## Done means

- [ ] A command reports the current mix — open and closed items grouped by `type`, with effort
      totals and the in-progress count — from `loadBacklog`, with tests over a fixture item set.
- [ ] Planning produces a proposed working set that states its composition by `type` and gives a
      one-line reason per member, including at least one review pass when one is due.
- [ ] Scheduled reviews are visible in the backlog rather than implied, or the item records the
      explicit decision not to track them and why.
- [ ] Exactly one documented path writes `sprint:`, and the planner is not it.
- [ ] Running the planner on today's tree flags the five concurrent `in-progress` items.

## Simplest possible implementation

Add one pure function to `packages/backlog/src/index.ts` — `summarizeMix(items)` returning counts
and effort totals grouped by `type` and `status`, plus the in-progress count — wire it to
`npm run backlog:mix` through `packages/backlog/src/main.ts`, and add a `plan` operation to
`.claude/skills/track-backlog/SKILL.md` that runs it, then proposes a working set whose composition
is stated and whose reviews are named. One function, one test file, one CLI verb, one skill section.
No agent, no new package.

What you get:

- The evidence half is code, so it is tested, cheap to run, and identical on every invocation.
- The judgement half stays prose next to the other planning procedures, so there is one place to
  look and one writer of `sprint:`.
- The mix summary is useful on its own, before any planner exists, and the dashboard could render
  it later without rework.

What you give up or risk:

- No fresh context. A planner running inside the session that just spent an hour on one feature
  will over-weight that feature, and nothing here prevents it.
- "Balance" stays a model's judgement over numbers. Two runs a week apart may propose different
  mixes from the same data with no way to tell which was right.
- Review scheduling stays advisory — nothing fires a review pass if the planner is never run.
- One more CLI verb and one more generated view to keep honest, on a repo that already has
  `backlog:regen`, `backlog:validate`, `backlog:archive`, and `backlog:next-id`.
