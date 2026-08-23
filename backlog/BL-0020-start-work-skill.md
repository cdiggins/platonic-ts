---
id: BL-0020
title: Add start-work command that records the execution approach
type: feature
status: idea
priority: "?"
effort: M
risk: low
area: repo
sprint:
created: 2026-08-23
closed:
links: [.claude/skills/track-idea/SKILL.md, .claude/skills/track-issue/SKILL.md, .claude/skills/track-backlog/SKILL.md, .claude/skills/parallel-wave/SKILL.md, decisions/2026-08-22-adopt-workquarry-format.md, packages/core/src/index.ts, packages/backlog/src/index.ts]
---

## Idea

One command, `/start-work`, that takes work from decided to underway. It absorbs most of
what the user-global `feature-dev` skill does (frame the outcome, scan for reuse, size the
job, land contracts and a fence table, review, ship) rather than sitting in front of it, so
there is a single command owning the phrase "start work on BL-xxxx". It does three things
the current skills do not:

1. **Logs the item when missing** — if no `BL-XXXX` exists for this work, create one
   (`type: feature`, `## Done means` required); if an id is given, use it. This closes the
   gap where `track-issue` punts `feature` to `track-idea`, and `track-idea` forces
   `status: idea` plus a full elaboration pass — both wrong-shaped for decided work.
2. **Records the execution approach in the item's frontmatter** — a real field, not prose,
   so the choice survives the session and the dashboard can chart it.
3. **Delegates execution** — parallel work hands off to the vendored `parallel-wave` skill
   (BL-0021); sequential work is built inline or by a single subagent.

## Decisions taken

These were open; they are now settled and drive the plan below.

- **One command, absorbing `feature-dev`** — not a thin wrapper in front of it. `feature-dev`
  is vendored into `.claude/skills/` (same treatment as BL-0021) and becomes `/start-work`,
  with the logging and approach-recording steps added. This avoids two commands competing
  for the same trigger phrase, and puts a repo-critical process under version control.
- **Parallelism delegates to `parallel-wave`** — `/start-work` decides *whether* the work is
  parallel and records it; `.claude/skills/parallel-wave/SKILL.md` owns *how* (fence table,
  spawn, integrate, gate). `/start-work` must not restate wave mechanics.
- **The approach is a frontmatter field, not a body section** — `approach: sequential |
  parallel | undecided`, with `undecided` the default at capture.

## Still open

- **Who picks the approach** — always ask, or propose from size (`feature-dev`'s existing
  XS/S vs M/L rule) and let the user override. Propose-with-override matches the size table
  already in the skill.
- **Status at filing** — `in-progress` at start (accurate) vs `ready` then a separate
  promotion (redundant). `in-progress` implied.
- **Whether `undecided` is allowed to persist** — if an item is still `undecided` when work
  starts, is that a warning in the dashboard or just silence?

## Where the code change goes

The user's instinct was to colocate the type and the parser in one file. Checked against
the code, the answer is **partly** — the change is small and two-file, and colocating would
cost more than it saves:

- `BacklogItem` and its value-set types live in `packages/core/src/index.ts:68-94`; the
  parser lives in `packages/backlog/src/index.ts` (`validStatuses`/`parseStatus` and
  friends, lines 23-116). Adding the field touches both.
- Moving the types into `packages/backlog` would **invert the dependency**:
  `DashboardSnapshot` (`packages/core/src/index.ts:107`) embeds
  `readonly backlog: readonly BacklogItem[]`, and `packages/core/src/index.ts` imports
  nothing at all — it is a leaf. Colocating would force `core` to import from `backlog`,
  which is exactly backwards, or force `DashboardSnapshot` out of core.
- The ADR already fixes this: the schema is the TypeScript types in `core`, and
  `packages/backlog` is the one write path
  (`decisions/2026-08-22-adopt-workquarry-format.md`).

So the change is: `packages/core/src/index.ts` — add `BacklogApproach` and one field on
`BacklogItem` (~3 lines); `packages/backlog/src/index.ts` — add `validApproaches`,
`parseApproach`, one line in `parseBacklogFile`, and the field in `renderBacklogItem`
(~10 lines); `packages/backlog/test/backlog.test.ts` — cases for each value plus the
legacy default (`undecided` when the field is absent, matching the existing tolerant-parse
rule); `packages/dashboard` — display, optional and separable.

## Design space — what can vary when work starts

Every dimension below changes how a start goes. Most must be *derived or defaulted*, not
asked: a command that asks twenty questions is slower than doing the work. Marked
**[option]** are the ones worth surfacing as explicit choices.

**A. What gets recorded (the item)**
- Logged vs unlogged — new `BL-XXXX`, an existing id, or ad-hoc with no item. **[option]**
- `## Done means` present vs absent — required here (it is the promotion gate's substance).
- ADR needed — does the work decide something architectural (`decisions/`).
- Sprint / dependency — blocked-by, ordering, sprint membership (owned by `track-backlog`).
- Findings sink — item body, notes file, `docs/`, dashboard.

**B. How the work splits**
- Parallel vs serial — fenced wave vs single track. **[option]**, and now a recorded field.
- Track count + fence table — derived from the split (`parallel-wave` steps 3-4).
- Shared-resource assignment — ports, which track may restart a server/daemon
  (`parallel-wave` step 4).

**C. Who does the work**
- Current agent vs subagent — mostly a *consequence* of parallel-vs-serial, not an
  independent axis; serial+subagent is for context saving (`cavecrew`) or long background runs.
- Agent type — general-purpose, `Explore`, `cavecrew-builder`, reviewer.
- Model / effort / token budget — weak-model delegation for mechanical tracks.
- Foreground vs background — blocking, `run_in_background`, scheduled, remote.

**D. Where the work happens**
- Shared checkout vs worktree vs branch — fixed by repo policy: shared checkout; worktrees
  only for spikes and long-running background agents
  (`.claude/skills/parallel-wave/SKILL.md` hard rule,
  docs/worktrees-and-branches-for-agents-2026-08-22.md). Not a per-invocation choice.
- Clean commit point before touching files — always (user git rule, AGENTS.md).

**E. How it is verified**
- Gate depth — `npm run check` is the gate (typecheck, lint, ratchet, tests).
- Test discipline — TDD-first vs types-prove-it vs after-the-fact.
- Review policy — none / fresh-eyes subagent / `/code-review` level / adversarial verify.

**F. How it lands and is supervised**
- Commit + push policy — per-milestone auto-commit and push, direct to `main` (repo
  default) vs hold for approval.
- Autonomy level — checkpoint frequency, ask-before-commit, permission mode.
- Time-box — spike with a kill time vs run-to-done. **[option]** when the work is a spike.
- Escape hatch — what a track does when the plan looks wrong; must be mechanical or it
  never fires (`feature-dev` already defines this; keep it).
- Plan-first vs just-build — approval gate before any code. **[option]**

**The options the command surfaces:** logged-or-new, parallel-or-serial (recorded),
plan-first-or-just-build, and time-box when it is a spike. Everything else is defaulted from
repo policy or derived from size. Plan-first-vs-just-build and time-box move the outcome more
than inline-vs-subagent does, which is why they are options and that is not.

## Related

- [.claude/skills/track-idea/SKILL.md] — sibling; `/start-work` is the "already decided,
  doing it now" variant, and takes over `track-issue`'s feature punt.
- [.claude/skills/track-issue/SKILL.md] — its "use /track-idea for feature" line must point
  at `/start-work` once this lands.
- [.claude/skills/track-backlog/SKILL.md] — owns idea→ready promotion and sprint planning;
  `/start-work` bypasses that path, so both must state the same `## Done means` requirement.
  It should also learn to show the new `approach` field.
- [.claude/skills/parallel-wave/SKILL.md] — the delegation target for parallel work, now
  vendored in-repo (BL-0021). Its step 9 findings sweep is the debt sink `/start-work` hands
  off to.
- [~/.claude/skills/feature-dev/SKILL.md] — the source being absorbed: framing, reuse scan,
  size table, contract/fence pre-step, escape hatch, shipping checklist.
- [BL-0021] — done in part; establishes the vendoring pattern this item follows.
- [BL-0023] — archiving completed items to `backlog/archive/`; touches the same
  `loadBacklog` file-discovery code, so sequence the two rather than running them in parallel.
- [decisions/2026-08-22-adopt-workquarry-format.md] — constrains: schema is the TS types in
  `core`, `packages/backlog` is the one write path, skills edit item files directly plus
  `npm run backlog:regen`.

## Approaches

Short term, in order:
1. Vendor `feature-dev` into `.claude/skills/start-work/SKILL.md`, renamed and adapted the
   way BL-0021 adapted `parallel-wave` (repo gate, repo paths, no worktrees).
2. Add the logging step (create or adopt a `BL-XXXX`) and the approach-recording step.
3. Add the `approach` field to `packages/core` + `packages/backlog` + tests.
4. Point `track-issue`'s feature punt and `track-backlog`'s vocabulary at the new command.
5. Dashboard display of `approach`, once there is data worth looking at.

Long term: with the field populated, correlate approach against elapsed time and commit
counts (the dashboard already correlates commits with sessions) and find out whether waves
actually pay off in this repo — which is the whole reason for recording it.

## Bedrock

The seam is the capture surface: every command funnels into one schema
(`packages/core/src/index.ts`) and one write path (`packages/backlog/src/index.ts`).
`/start-work` strengthens it twice — it makes the command set total over `BacklogType`
(every type gets exactly one entry command, no cross-skill punts), and it moves a decision
that currently evaporates with the transcript into a typed field, which is the precondition
for ever measuring whether parallelism pays. Absorbing `feature-dev` rather than wrapping it
also removes the last repo-critical process living outside version control.
**Verdict: right.** The typed field is what makes this more than a convenience command; a
prose section would leave the data unqueryable and the measurement impossible.

## Done means

- [ ] `.claude/skills/start-work/SKILL.md` exists in-repo, absorbing `feature-dev`'s
      framing/sizing/shipping content, adapted to this repo (gate, paths, no worktrees)
- [ ] `approach: sequential | parallel | undecided` parses in `packages/backlog`, defaults to
      `undecided` when absent, is typed in `packages/core`, and is covered by tests
- [ ] `/start-work` creates the item when one is missing, with `## Done means` filled, and
      records the approach in frontmatter
- [ ] Parallel work hands off to `.claude/skills/parallel-wave/SKILL.md` with no wave
      mechanics restated in `/start-work`
- [ ] `track-issue`'s feature punt points at `/start-work`, and `track-backlog` agrees with
      it on the `## Done means` requirement
- [ ] `npm run check` green

## Simplest possible implementation

Vendor `feature-dev` as `.claude/skills/start-work/SKILL.md` with two steps added (log the
item; record `approach:`), plus ~13 lines across `packages/core/src/index.ts` and
`packages/backlog/src/index.ts` and their tests. Dashboard display deferred.
Pros:
- One command owns the trigger phrase; no wrapper indirection to maintain.
- The approach becomes queryable data on day one, so the measurement question is answerable
  later without a migration.
- Follows the pattern BL-0021 just proved out.
Cons:
- Larger than a pure-docs change: it touches two packages and their tests, so `npm run
  check` is now part of the loop.
- Absorbing `feature-dev` means the repo copy and the user-global copy diverge; the global
  one should be retired or it will compete for the trigger phrase (same open question
  BL-0021 left).
- Existing items all parse as `undecided`, so early dashboard charts will be mostly empty
  until enough work starts through the new command.
