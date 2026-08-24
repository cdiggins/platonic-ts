---
name: start-work
description: Take decided work from "we're doing this" to underway — log or adopt the backlog item, record the execution approach (sequential vs parallel) in its frontmatter, frame the outcome, scan for reuse, land contracts, then build inline or hand off to parallel-wave; review, ship with evidence, sweep debt. Use when the user says /start-work, "start work on BL-xxxx", "develop this feature", "let's build X", "plan and implement", or hands over a feature-sized request that is already decided.
argument-hint: [BL-xxxx | the work, in a phrase or paragraph]
---

# start-work — from decided to underway

Owns the phrase "start work on X". Six stages, each with an exit gate and an artifact —
the artifacts are what the next stage (and, for parallel work, the `parallel-wave` skill)
consume. Stage 4 delegates: parallel work goes to `.claude/skills/parallel-wave/SKILL.md`,
which owns fences, spawning, and integration — never restate its mechanics here.

Siblings: `/track-idea` captures undecided ideas; `/track-issue` captures defects and
liabilities. This command is for work the user has already decided to do.

**Do not skip stages silently.** If you skip one (see Sizing), say which and why.

---

## Stage 0 — LOG + FRAME

**Log the item first.** Every start gets a backlog item:

- If the user named a `BL-XXXX`, use it. Re-read its body — specs go stale (check its
  claims against the current tree before trusting them).
- If no item exists, create one: allocate the id with `npm run backlog:next-id -- <slug>`
  (never by scanning for the highest number — the scan races and misses
  `backlog/archive/`), then fill the frontmatter with `type: feature`,
  `status: in-progress`, real priority/effort/risk, `created: <today>`. A `## Done means`
  section (2–5 verifiable checkboxes) is REQUIRED at creation — it is the same gate
  `/track-backlog` enforces at idea→ready promotion, paid here instead.
- Either way, set `status: in-progress` and run `npm run backlog:regen`.

**Record the approach** in the item's frontmatter — a real field, not prose:

```yaml
approach: sequential   # sequential | parallel | undecided
```

Propose it from size (XS/S → `sequential`, M/L → `parallel`; see Sizing) and let the user
override. `undecided` is only for items filed ahead of a start; by the time work begins the
field must be `sequential` or `parallel`.

Then frame, before reading any code:

- **Intent**, one sentence, user-visible.
- **Acceptance criteria** — observable, checkable; these are the `## Done means` boxes.
- **Non-goals**, explicit. Highest-leverage line in the whole brief.
- **Size**: XS / S / M / L. Everything below scales off this.

Gate: user has seen intent + non-goals + approach and not objected.
Artifact: the brief (template a), pasted into the backlog item body.

## Stage 1 — GROUND (search before building)

- **Backlog scan** — `backlog/BACKLOG.md`, `backlog/DONE.md`, and `Grep` over
  `backlog/*.md` + `backlog/archive/*.md`. Existing item to fold in or block on?
  Something already built and retired for a reason?
- **Related-code scan** — spawn the `scout` agent with the task; do not build a second
  one of anything. Read the target folders' `INDEX.md` files.
- **Rulings** — check `docs/decisions/` for a governing ruling on where this belongs;
  spawn the `architect` agent if the work adds a file, export surface, or crosses a
  package boundary and no ruling covers it.
- **What this replaces** — name the code path that becomes dead, or say "nothing —
  deliberate".
- **Vocabulary** — pick the names now (types, events, files).

Gate: for each candidate file, a verdict — **reuse / extend / replace / leave alone**.
Artifact: file list with verdicts + the retirement target.

## Stage 2 — PROBE (only if real unknowns)

One question per spike, one **time-box**, throwaway code, written answer. List risks and
**kill criteria** (what finding makes abandoning this correct). Skip when unknowns are
zero — and say so.

## Stage 3 — SHAPE (design + decomposition)

- **Contracts first.** Types (usually `packages/core`), wire formats, event names, ports.
  For parallel work this is `parallel-wave` step 2 — landed before anyone spawns.
- **Signatures, not pseudo-code.** Real signatures with `throw new Error("unimplemented")`
  bodies, typechecked, plus one worked example per module.
- **Decomposition test:** would this piece compile on its own, with its own spec file?
  If you cannot name its spec file, it is not a track.
- **Fence table** (parallel only) — non-overlapping write paths, spec files named, ports
  assigned; use the `parallel-wave` template.
- **Test plan** — which acceptance criterion is covered by unit, integration, eyeball.
- **Rollback** — confirm the working tree has a clean commit point for every file about
  to change (commit or surface pending edits first).

**Gate before any build:** `npm run check` green on the baseline. A red baseline makes
every later red unattributable.

Artifact: plan + landed contract diff + fence table (parallel) + test plan.

## Stage 4 — BUILD

- **`approach: parallel`** — invoke the `parallel-wave` skill and follow it; stages 0–3
  produced its step 1–3 inputs, so start at its step 4. It owns fences, spawning,
  checkpointing, integration.
- **`approach: sequential`** — build inline or with a single subagent. No fence table,
  no wave.

Whichever path, every track/subagent prompt carries the two addenda from template (b):
tests written inside the fence, and the trouble protocol verbatim. The trouble protocol
exists because an agent's default failure mode is to grind — make the escape hatch
mechanical or it never fires. A tripped track stops and reports; **it does not re-plan
itself** — the supervisor decides. If two tracks trip on the same contract, the contract
is wrong: stop, redesign, respawn.

## Stage 5 — LAND

1. **`npm run check` green** — the only definition of green.
2. **Fresh-context review** (M/L; XS/S: `/code-review` on the diff). Spawn a subagent
   that did not build this; give it the diff plus acceptance criteria only (template c).
3. **Evidence** — run output, screenshot, dashboard shot. Never "should work".
4. **Docs** — README, `INDEX.md`, orientation docs if the map changed; `npm run docs:regen`
   if inventories moved.
5. **Commit** with pathspec to `main` (no branches, no `git add -A`), `git pull --rebase`,
   push.
6. **Backlog** — tick the item's `## Done means` boxes in the commit that satisfies them;
   when all are ticked set `status: done` + `closed: <date>`, run `npm run backlog:archive`
   then `npm run backlog:regen`, and name the id in the closing commit.

## Stage 6 — LEARN

- **Debt sweep** — every shortcut knowingly taken becomes an item via `/track-issue`.
- **Ideas** discovered mid-build go to `/track-idea`, not into this feature.
- **Findings** appended to `NOTES.md`.
- **Ratchet** — add the check that prevents this bug class from returning.
- **Dogfood** it once, for real, before declaring victory.

---

## Sizing

| Size | Shape | Approach | Stages |
|---|---|---|---|
| **XS** | one file, under ~30 min | sequential | 0 (brief = one line), 1 (dup check), build, test, commit |
| **S** | one module, few files | sequential | 0, 1, build, 5, 6 debt sweep. No spikes, no fences |
| **M** | 2–4 independent pieces | parallel | All six. One wave |
| **L** | crosses subsystems, real unknowns | parallel | All six, spikes mandatory, multiple sequential waves — wave 1 lands contracts + one vertical slice |

Track count ≤ the number of pieces you can name a distinct spec file for.

---

## Templates

### (a) Brief

```markdown
## <feature> — brief
**Intent:** <one sentence, user-visible>
**Size:** <XS|S|M|L>   **Approach:** <sequential|parallel>
**Acceptance criteria** (observable, checkable):
- [ ] <criterion>
**Non-goals:** <what this explicitly does not do>
**Replaces / retires:** <code path that becomes dead, or "nothing — deliberate">
**Risks:** <technical | integration | perf | migration>
**Kill criteria:** <finding that makes abandoning this correct>
```

### (b) Track-prompt addendum

```
TESTS: write the tests for your behavior yourself, inside your fence, at the spec
path named in the fence table. Do not rely on another track or the supervisor.

TROUBLE PROTOCOL — stop and report, do NOT keep grinding, if any of these trip:
- the same gate/test fails 3 times across 3 genuinely distinct fix attempts
- the fix needs an edit outside your fence
- the fix needs a contract change bigger than one field or one signature
- you are about to disable a test, widen a type to `any`, or add a special case
  whose only purpose is to make one test pass
- you have used <N> tool calls without a passing test

On trip, STOP and report: what you attempted; the shortest decisive line of failing
output; why the plan appears wrong; two alternative approaches with rough cost.
Do NOT re-plan your track yourself — other tracks are building against the contract
you would be changing. The supervisor decides.
```

### (c) Fresh-context reviewer prompt

```
Review this diff. You did not write it and you have not seen the plan — that is
deliberate. Reconstruct the intent from the code; if you cannot, say so, that is
a finding.

ACCEPTANCE CRITERIA the change must satisfy:
<paste from the brief — nothing else from the plan>

DIFF:
<paste, or: git diff <base>..HEAD -- <paths>>

Two passes, report separately:
1. CORRECTNESS — for each acceptance criterion, does the code satisfy it? Look for
   where it breaks: edge cases, error paths, concurrency, state left inconsistent
   on failure. Cite file:line.
2. DUPLICATION / REUSE — does anything here re-implement something that already
   exists in this repo? Search before answering. Cite both locations.

Report raw findings, most severe first. Style nits: omit entirely.
```

## Rules

- One command owns the start: do not route decided work through `/track-idea` (it forces
  `status: idea` plus a full elaboration pass, wrong-shaped here).
- The `approach:` field must be set before Stage 4 — it is the data that lets the
  dashboard eventually answer whether waves pay off in this repo.
- Never restate `parallel-wave` mechanics; invoke the skill.
- Commit the item file together with the regenerated `backlog/BACKLOG.md`/`DONE.md` —
  never one without the other.
