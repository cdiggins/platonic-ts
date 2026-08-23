# Questions to Ask After Writing Code

**Status:** technical report.
**Date:** 2026-08-23
**Companion to:** [pre-coding-questions-2026-08-23.md](pre-coding-questions-2026-08-23.md), which
covers the other end of the session.

---

## 1. What this document is

The same treatment as the pre-coding report, applied after the edit exists. It sorts the
after-the-fact questions into the phases where they can actually be answered, says what each
answer is allowed to cost, and proposes a tiered checklist with a stop rule — because the
failure mode at this end is not skipping the review, it is never finishing it.

Terms used once:

* **Gate** — `npm run check`: typecheck, then lint, then the escape-hatch ratchet, then tests,
  stopping at the first failure.
* **Ratchet** — `ratchet.json`, the per-kind ceiling on escape hatches (`any`, `as`, `!`,
  `@ts-*`, `eslint-disable`). Counts may fall, never rise, unless the change is deliberate.
* **Disposal** — where a finding goes: fixed now, tested now, filed in `backlog/`, or dropped.
* **Score** — the per-file `platonicScore` computed in `packages/codemap/src/metrics.ts`:
  100 minus weighted penalties for escape hatches, mutable bindings, classes, throws, file
  length, export surface, nesting depth, and statement density.

The starting list came from the prompt: syntax, typecheck, compile, tests, comment quality,
guideline conformance, test usefulness, test sufficiency, duplication, refactoring, code
reduction, performance, technical debt, and better options for later. All fourteen are worth
asking. They are not worth asking at the same moment, at the same cost, or with the same
willingness to act.

---

## 2. Two axes that sort the list

**Who answers — machine or judgement.** Syntax, types, lint, ratchet, and tests are answered by
running one command. Comment quality, test usefulness, and "is this debt" are answered by
reading. Mixing the two in one checklist makes the machine-answerable questions look optional
and the judgement questions look mechanical. They are separated below.

**What the answer may cost.** This is the axis that matters more, and the list above hides it. A
type error costs a fix now. A missing test costs a test now. A better idea for next time costs a
backlog line and nothing else. The single most useful rule in this report:

> A finding that will not change this diff must leave the session as a `backlog/` item or leave
> the session entirely. It may not become a paragraph of prose in the summary.

Without that rule, post-coding review produces a wall of observations that nobody acts on, which
is the same as producing nothing while costing tokens and attention.

---

## 3. The phases

### Phase 1 — Mechanical: does it work at all

Four of the prompt's questions collapse into one command here, and it is worth being precise
about why.

* **Is the syntax correct?** In TypeScript there is no separate answer. A syntax error is a
  compiler diagnostic, so it surfaces as a typecheck failure. If the edit went through the MCP
  server, `replace_symbol` and `insert_symbol` already refused source that does not parse, so
  this question was answered before the write landed.
* **Does it type-check?** `tsc --noEmit`, with `strict`, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, and `noImplicitReturns`.
* **Does it compile?** There is no emit step in this repository; `tsx` runs the sources directly.
  So "compiles" and "type-checks" are the same question here, and pretending otherwise adds a
  phase that never fails.
* **Do the tests pass?** `vitest run`.

One command covers all four: `npm run check`, or the `check` tool over MCP. Adding the ratchet
step, that is the whole of phase 1. The useful extra question is not in the prompt's list:

* **Did the gate actually exercise the change?** Green proves the suite passed, not that the new
  code ran. A new file that no test imports, a test whose assertions sit after an early return,
  a case that was silently skipped — all produce green. The cheap check is to break the change on
  purpose and confirm something turns red. It costs one edit and one run, and it is the only
  direct evidence that the gate has an opinion about the new code at all.

Phase 1 is not negotiable and not a judgement call. Nothing else in this document is worth doing
until it passes.

### Phase 2 — Read the diff as a reviewer

Cheap, done once, on the diff rather than on the files. The questions are the ones a reviewer
would ask, and the point of asking them yourself is that the diff is still small and still in
context.

* **Do the comments make sense today, alone, to someone who was not here?** This is the sharpest
  version of the prompt's comment question, and the three qualifiers are each doing work.
  *Today*: no "changed in wave 2", no dates, no ticket numbers — PS-050 bans those outright, and
  they are the most common thing an agent leaves behind. *Alone*: the comment must not depend on
  the request that produced it. *Not here*: it must not narrate the session's reasoning.
* **Does any comment restate the code?** Delete it. The good comment records a non-obvious
  trade-off; the bad one paraphrases the line below it and then rots.
* **Is there anything here that no call site needs?** PS-051. Speculative parameters, options,
  and exports are cheapest to delete in the minute after writing them.
* **Does it match the guidelines?** Lint answers the mechanical part, and the ratchet answers the
  escape-hatch part. The residue is judgement: one concern per file (PS-041), one level of
  abstraction per function (PS-055), errors carrying data rather than prose (PS-053), values
  built by pipeline rather than accumulator (PS-052). A useful proxy is the score on the touched
  files — statement density and nesting depth are exactly the judgement rules that the metric
  approximates.
* **Did I break a rule without saying so?** PS-056 requires a violation to be visible: one place,
  a comment naming the rule, and a `ratchet.json` bump in the same commit if an escape hatch was
  added. A silent violation is the failure; a documented one is a decision.

### Phase 3 — Duplication and reduction

The prompt asks three related questions — duplication, refactoring, and reducing code here or
elsewhere. They are worth separating, because two of them are usually "not yet" and one is
usually the highest-value thing in the whole review.

* **Is there duplication?** PS-049 says duplicate twice before abstracting, so the honest
  question is not "is anything repeated" but "is this the third copy?" Two copies is the policy
  working. Three is the signal to extract, and the extraction is cheapest now, while all three
  sites are known.
* **Is there refactoring to do?** Only if it is behaviour-preserving and the gate is green. If
  it changes behaviour it is not a refactor, it is the next task. The trap is that this question
  invites diff growth *after* review, so the answer either happens immediately as a separate
  commit against a green tree, or it becomes a backlog item.
* **Can code be removed — here or elsewhere?** This is the question worth spending real effort
  on, and it is the one most often skipped. A new function often makes an older path redundant;
  `usages` answers whether the old path still has callers, in one call. Deleting code is the only
  change that reliably makes the next session cheaper, and the moment just after the new path
  goes green is when the redundancy is most visible.

### Phase 4 — Are the tests any good

Two different questions that get run together and should not be.

* **Are the tests useful?** A useful test fails when the behaviour breaks. The thought experiment
  is mutation: if I inverted this condition or dropped this clause, would something turn red? If
  no, the test is decoration. The related check is PS-054 — a test that reaches into an
  unexported helper freezes an implementation detail and will block the next refactor, so it is
  worse than no test. Prefer tests that go through the exported seam with plain data in and plain
  data out.
* **Are the tests sufficient?** Sufficiency is about cases, not counts. The three that matter:
  the case that motivated the change, the boundary (empty, one, missing, malformed), and the
  error path. Coverage percentage is not the measure — it reports which lines ran, not which
  behaviours are pinned, and optimizing it produces tests that execute code without asserting
  anything about it.
* **Would the test have caught the bug it was written for?** For a bug fix this has a mechanical
  answer: revert the source change, keep the test, and confirm it fails. If it does not, the test
  is testing something else.

### Phase 5 — Cost and performance

The prompt asks "how is the performance?" The honest answer for most changes is that the question
does not apply, and asking it anyway produces speculation dressed as analysis. A trigger is
better than a habit. Ask only when one of these is true:

* the change loops over input whose size is controlled by data rather than by the code;
* it sits on a path that runs per request, per file, or per keystroke;
* it rebuilds something whole where it could update a part — the incremental-versus-full question
  that the code index already faces;
* it added an await inside a loop.

When the trigger fires, measure rather than reason. This repository already prints per-step
durations from the gate, and the MCP report records the index rebuild cost, so there is a
baseline to compare against. When no trigger fires, write "not applicable" and move on; that is a
complete answer.

### Phase 6 — What did I leave behind

* **Was technical debt introduced?** Debt is only real if it is named and located. "Some
  cleanup needed" is not a finding. "`packages/x/src/y.ts` parses the same string twice because
  the shared parser takes a different shape" is a finding, and it becomes a `backlog/` item with
  type `debt`. Filing it is the entire action; explaining it in the session summary is not.
* **Is any documentation now wrong?** H8 in the README says documentation and code drift apart,
  and this is the moment it happens. The specific things that go stale here are the package table
  in `AGENTS.md`, the seams listed in `CONTRACTS.md`, and any doc that describes the changed
  behaviour. Checking three files costs seconds; noticing in three weeks costs a confused agent.
* **Is there a better option worth exploring later?** Yes, often — and the disposal rule applies
  hardest here. A better idea recorded in a session summary is lost when the session ends. The
  same idea as a `backlog/` item with type `idea` is a thing the next planning pass sees. If it
  is not worth a backlog line, it was not worth writing down.
* **Did the score on the touched files go down?** The per-file `platonicScore` is a rough
  ordering, not a target, but a drop concentrated in the files just edited is a real signal about
  density, nesting, or escape hatches — and it is the one quality question here that a machine
  already answers.

### Phase 7 — After the commit

* Did it stay green after rebasing onto whatever other agents pushed?
* Did anything downstream break that the gate does not cover — the dashboard, the index rebuild,
  a script that reads a format that changed?
* How did the actual blast radius compare with the estimate made before coding? That comparison
  is one of the indicators the pre-coding report proposes for telling whether its own checklist
  is working, and this is where the data comes from.

---

## 4. Disposal: where each answer goes

| Answer | Disposal | Deadline |
|---|---|---|
| Gate is red | Fix | Before anything else |
| Gate is green but did not exercise the change | Add the test | Same session |
| Comment restates code, or records history | Delete | Same session |
| Unused parameter, option, or export | Delete | Same session |
| Third copy of the same block | Extract | Same session |
| Rule broken without a note | Add the note, bump the ratchet | Same commit |
| Old path now has no callers | Delete | Same session |
| Missing boundary or error-path case | Add the test | Same session |
| Behaviour-preserving refactor, gate green | Separate commit, or backlog item | Now or never |
| Named, located debt | `backlog/` item, type `debt` | Same session |
| Better approach for later | `backlog/` item, type `idea` | Same session |
| Performance concern with no trigger | Drop it | — |
| Anything that will not change this diff and has no backlog line | Drop it | — |

The last row is the one that keeps the review finite.

---

## 5. Failure modes

**The endless polish loop.** Post-coding questions have no natural exit, because there is always
one more thing that could be cleaner. H19 in the README notes that overly strict rules push
agents into loops, and this is the place it happens. The defence is a stop rule: one pass through
the checklist, findings disposed of by the table above, then stop. A second pass may only run if
the first pass changed code.

**Inventing debt to look thorough.** A review that reports nothing looks lazy, so a model under
review pressure will manufacture findings. Requiring every debt item to name a file and a
concrete consequence makes manufactured findings hard to write.

**Growing the diff after it was reviewed.** "Refactor while I'm here" is how a fifteen-line change
becomes two hundred lines that nobody has read as a whole. Refactors go in their own commit
against a green tree.

**Coverage theatre.** Adding tests until a percentage moves produces tests that run code without
pinning behaviour, and those tests then block refactors while catching nothing.

**Premature performance work.** Optimizing without a trigger and without a measurement adds
complexity and removes clarity, and the metrics penalize exactly the density it produces.

**Trusting your own review.** Self-review catches mechanical slips and misses framing errors, for
the same reason stated in the pre-coding report: the explanation is not a window into the
computation. Anything shared, persisted, or hard to reverse deserves a second pass with a fresh
context rather than a second pass by the agent that just wrote it.

---

## 6. What a machine can answer today, and what it cannot

| Question | Mechanized | By what |
|---|---|---|
| Syntax, types, compile | Yes | `tsc --noEmit`, and the parse check in the MCP write tools |
| Tests pass | Yes | `vitest run` |
| Mechanical style rules | Yes | `eslint .` with `eslint-plugin-functional` |
| Escape hatches did not increase | Yes | ratchet against `ratchet.json` |
| File length, nesting, density, export surface | Yes | `platonicScore` in `packages/codemap` |
| Old path still has callers | Yes | `usages` |
| Gate exercised the change | No | Break-it-on-purpose, by hand |
| Comments are useful | No | Judgement |
| Tests are useful | No | Judgement; mutation testing would approximate it |
| Tests are sufficient | No | Judgement; coverage is the wrong proxy |
| Duplication is the third copy | Partly | Judgement, aided by search |
| Debt was introduced | No | Judgement, disposed of as a backlog item |

Three candidates for mechanization stand out, in rough order of value per unit of work:

1. **Score delta on touched files.** The metrics module already computes a per-file score, and
   git already knows which files changed. Reporting the before-and-after for exactly the touched
   files turns "does it match the guidelines" from a judgement into a number with evidence
   attached. It reuses code that exists rather than adding a checker.
2. **Change-was-exercised check.** Any signal that the changed lines ran under the test suite
   would catch the most common false green. Coverage instrumentation is the obvious route and
   carries the usual risk of becoming a percentage target, so it should report per-change, not
   per-repository.
3. **Mutation testing on changed functions only.** The direct answer to "are these tests useful",
   and expensive enough that it only makes sense scoped to the diff.

The honest summary is the same as at the other end of the session: tooling covers the tedious
questions, and the two that matter most — are the comments useful, are the tests useful — remain
judgement.

---

## 7. Proposal: the tiered post-coding checklist

The tiers mirror the pre-coding ones, so a session picks its tier once and uses the matching pair.

### Tier 0 — after any edit

1. **Gate green?** `npm run check`, or the `check` tool.
2. **Did it exercise the change?** Break it on purpose; confirm red; restore.
3. **Read the diff.** Comments that say why and stand alone; nothing unused; nothing that
   restates the code.

### Tier 1 — non-trivial work, add three

4. **Can anything be deleted, here or elsewhere?** Check the old path's callers.
5. **Are the tests useful and sufficient?** Would they fail if the behaviour broke; is the
   motivating case, the boundary, and the error path covered.
6. **What did I leave behind?** Named debt and better options become backlog items, or they are
   dropped.

### Tier 2 — shared contracts, formats, or anything hard to reverse, add three

7. **Is the documentation still true?** `AGENTS.md`, `CONTRACTS.md`, and any doc describing the
   changed behaviour.
8. **Does the performance trigger fire, and if so what did the measurement say?**
9. **Fresh-context review.** A second pass that has not seen the session, on the diff alone.

### Stop rule

One pass. Dispose of every finding using the table in section 4. A second pass only if the first
one changed code. If the same finding survives two passes without being fixed, it is a backlog
item by definition.

---

## 8. Assumptions

**Noted, high confidence, not tested:**

* Green is weaker evidence than it looks, and "did the gate see this change" catches more real
  problems per second spent than any other question in the list.
* Deletion is the highest-value outcome of a post-coding review, and the least likely to happen
  without an explicit prompt.
* A finding with no disposal is not a finding.

**Worth testing, medium confidence:**

* That a score delta scoped to touched files is a useful review signal rather than a number that
  gets argued with. Test by recording it for a few weeks and checking whether a drop ever
  corresponded to something a human agreed was worse.
* That the break-it-on-purpose check is cheap enough to be run every time. If it is routinely
  skipped, it needs mechanizing rather than exhorting.
* That backlog items filed at this moment are read later. The same open question as in the
  pre-coding report, and the same test: check whether any of them are ever picked up.

**Low confidence:**

* That mutation testing is worth its cost here even scoped to changed functions. It is the right
  answer in principle to "are the tests useful", and the runtime may make it academic on a suite
  that is meant to stay fast.
* That the phase split survives stronger models. Phases 1 and 6 are informational — run the
  tools, record what was left behind — and should age well. Phases 2 to 4 compensate for a
  self-review weakness that may shrink, and should be re-examined rather than defended.

---

## 9. The short version

Run the gate; that answers syntax, types, compile, and tests in one command. Then prove the gate
saw the change by breaking it on purpose. Then read the diff once: comments that say why and
stand alone, nothing unused, nothing restating the code. For anything larger than a small edit,
ask what can now be deleted, whether the tests would fail if the behaviour broke, and what got
left behind — filing the debt and the better ideas as backlog items rather than prose. Ask about
performance only when a trigger fires. Make one pass, dispose of every finding, and stop.
