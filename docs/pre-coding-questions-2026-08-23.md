# Questions to Ask Before Writing Code

**Status:** technical report.
**Date:** 2026-08-23
**Companion to:** [abstraction-timing-2026-08-23.md](abstraction-timing-2026-08-23.md) (when the
shared thing should exist) and [weak-hypotheses-evidence-2026-08-22.md](weak-hypotheses-evidence-2026-08-22.md)
(the published evidence on questioning, H16–H18).

---

## 1. What this document is

A brainstorm and then a proposal. The brainstorm collects the questions worth asking before a
coding session starts, sorts them by what they are actually for, and says which ones do not earn
their cost. The proposal is a short, tiered checklist an agent can run against itself, plus the
triggers that decide which tier applies and a way to tell whether the checklist is helping.

Terms used throughout, defined once:

* **Session** — one continuous stretch of work on one task, from reading the request to running
  the gate.
* **Gate** — the automated check that defines "green" here: `npm run check`, meaning typecheck,
  lint, escape-hatch ratchet, and tests.
* **Blast radius** — the set of call sites and files a change forces to change with it.
* **Reversibility** — how cheaply the change can be undone once other code depends on it.

The starting list came from the prompt that produced this report: does an abstraction already
exist, could a new one be imagined, could one be factored out of existing code, what is the
simplest thing, what are the options and their trade-offs, which one is chosen and why, how will
it be validated, and what assumptions are worth noting or testing. Those are good questions.
Most of the work below is deciding which of them to ask *when*, and adding the ones the list is
missing.

---

## 2. What the questions are for

A pre-coding question is worth asking only if some answer changes what happens next. That filter
is stricter than it sounds. "What are the trade-offs?" asked of a one-line bug fix produces a
paragraph that changes nothing. The same question asked before adding a third field to a type in
`packages/core` decides which of four designs gets built.

Questions do four distinct jobs. Keeping them separate makes it obvious when a question is being
asked out of ritual.

| Job | What it buys | Example |
|---|---|---|
| **Resolve ambiguity** | Stops the agent confidently building the wrong thing | "What is the acceptance condition?" |
| **Find leverage** | Cuts how much code has to exist at all | "Does something already do this?" |
| **Choose deliberately** | Makes the decision reviewable later | "What are the options, and why this one?" |
| **Set an exit** | Stops the session running past done | "How do I know it works?" |

The evidence supports the first job most strongly. ClarifyGPT resolved ambiguity before
implementation and gained ten points of Pass@1; that is a measured result about ambiguity, not
about questioning in general. The evidence is weaker on volume: the same work gates questioning
behind an ambiguity detector rather than asking every time, and the verdict recorded for H17 in
the companion report is "supported in mechanism, mixed on the *lots* quantifier." A checklist
with nine questions per session will be answered ritually within a week, which is worse than
asking three and meaning them.

There is a second cost specific to agents. Every answer consumes context and then stays in
context for the rest of the session. That is cheap at three questions and a real tax at ten,
half of them boilerplate.

---

## 3. Brainstorm: the question families

### 3.1 Reuse and leverage

The highest-value family in this repository, because the code index makes these answerable
mechanically rather than from memory.

* Does an existing function, type, or module already do some or all of this?
* Can it be used as it stands, without changing its internals? If yes, that is the best outcome
  available and the session may be nearly over.
* If it nearly fits, does it need one more parameter, an adapter at the call site, or a fork?
* Is it in the platform already? This repository has zero runtime dependencies by policy, so the
  library question is really a question about the standard library.
* Is there code that could be factored out into something useful here and then reused in its
  original place? This is the extraction case, and the abstraction-timing report argues it is
  where a new shared thing is most likely to have the right shape.
* Can I imagine an abstraction that does not exist yet and would make this much smaller if it
  did? Worth asking. Worth acting on only when the third use is already visible; otherwise it is
  prediction, and prediction is the part that fails.
* Is there a tool that answers this faster than reading code? `outline` and `usages` answer
  "what exists" and "who calls it" without loading whole files.

### 3.2 Scope and simplicity

* What is the simplest thing that could work?
* What is the smallest slice that is independently useful and independently verifiable?
* Can any part of this be *not built* — deferred, deleted, or already satisfied by an existing
  path? The do-nothing option belongs on every options list and is almost never written down.
* Is this actually two tasks? If the second half has a different acceptance condition, it is a
  different session.

### 3.3 Options and choice

* What are the two or three real options? Two is usually enough; four is usually padding.
* What does each cost in code, in coupling, and in future edits?
* Which one is chosen, and what is the one-sentence reason?
* What would have to be true for a different option to win? More useful than a trade-off table,
  because it is a claim a reviewer can check.

### 3.4 Risk and blast radius

Missing from the starting list, and the family that most often predicts a bad session.

* How many call sites does this touch? `usages` answers that in one call.
* Does it change something another package or another agent depends on — a type in
  `packages/core`, a rule in `CONTRACTS.md`, a file format under `backlog/`?
* Is the change reversible? A private helper is. A format already written to disk by a running
  process is not.
* What breaks *silently* — that is, what could be wrong without the gate turning red?
* Is anything irreversible outside the code: a push, a delete, a published document?

### 3.5 Validation

* How do I know this works? Name the test, the type, or the gate.
* Can "done" be written as a checkable predicate before the code exists? If not, the task is
  ambiguous by construction. This is the mechanical ambiguity check the H17 evidence points at,
  and it is the single most valuable question in the list.
* Does the existing gate already cover this, or does the gate need to grow first?
* What is the failing case that proves the change was necessary?

### 3.6 Assumptions

* What am I assuming with high but not complete confidence? Record it and move on.
* What am I assuming with medium or low confidence that the design depends on? Test it before
  building on it — usually a five-line probe, not a design document.
* What am I assuming about the *request* rather than the code? A misread intent is more expensive
  than a wrong technical guess, because no gate can catch it.

### 3.7 Questions that sound good and are not

* "What are the long-term maintainability implications?" — unanswerable at this altitude, and the
  answer never changes the next action.
* "Should I use a design pattern here?" — pattern-shaped code is the failure mode, not the goal.
* "Is this the best possible design?" — starts a search with no exit condition.
* "What could go wrong?" — too open. The bounded version is section 3.4's "what breaks silently."
* Any question whose answer is the same for every task in the repository. Those belong in
  `AGENTS.md` once, not in the checklist every time.

---

## 4. Failure modes of a pre-coding checklist

**Ritual compliance.** The agent writes a heading per question and fills it with fluent text that
had no influence on the code. This is the default outcome for long checklists, and it is hard to
spot from outside because the text looks like thinking. The defence is brevity, plus the rule
that every answer must be an assertion someone could later find wrong.

**Plan inflation.** Questioning expands to fill the space it is given, and a three-line fix
acquires an options table. The defence is the trigger table in section 5: most sessions get the
short tier.

**Rationalization after the fact.** The stated reason need not be the operating reason. The
faithfulness results cited under H16 are explicit that a fluent explanation is not a window into
the computation. So the answers are useful as a record a human can check, not as evidence that
the reasoning was sound.

**Sycophantic revision.** Questions phrased as doubt push models to abandon correct positions as
readily as wrong ones. Ask "what is the acceptance condition," not "are you sure this is right."

**Answering from memory.** "I don't think anything like this exists" is a guess unless a search
was run. Reuse questions should be answered with a tool call or not answered at all.

---

## 5. Proposal: a tiered checklist

Three tiers, chosen by the trigger table rather than by taste.

### Tier 0 — always, before any edit

1. **What is done?** State the acceptance condition as something checkable: a test name, a type
   that must compile, a gate that must pass. If it cannot be stated, stop and ask.
2. **What already exists?** Run one search of the code index for the concepts in the task. Name
   what was found, and whether it is usable as-is, adaptable, or irrelevant.
3. **What is the smallest change that satisfies (1)?** One sentence.

Three answers, one or two tool calls. Cheap enough to be answered honestly.

### Tier 1 — non-trivial work, add three

4. **What are the two or three options, and which one and why?** One line each, one sentence of
   reason.
5. **What is the blast radius?** The number of call sites, and whether any shared contract is
   touched.
6. **What am I assuming?** Split into "noted" — high confidence, recorded and not tested — and
   "to test", with the probe named.

### Tier 2 — shared contracts, formats, or anything hard to reverse, add three

7. **What breaks without turning the gate red?** If the answer is "something", the gate grows
   before the feature does.
8. **What would make a different option win?** The condition, not the trade-off table.
9. **What is the rollback?** Name the revert path, and whether anything outside the repository
   would survive it.

### Triggers

| Condition | Tier |
|---|---|
| Any code change at all | 0 |
| More than one file, or a new exported symbol | 1 |
| A new dependency between packages | 1 |
| An abstraction is being created rather than used | 1 |
| Changes to `packages/core`, `CONTRACTS.md`, or a persisted format | 2 |
| Anything a running process or another agent already consumes | 2 |
| Deleting or rewriting existing behaviour rather than adding to it | 2 |

### Where the answers go

Tier 0 answers go in the session as a three-line preamble, not a document. Tier 1 answers go in
the same place, and the chosen option plus its reason is copied into the commit message body.
Tier 2 answers go in `decisions/` as a dated file, because those are the ones someone will want
to find in six months. Nothing here should produce a new document per session; `NOTES.md` and
`backlog/` already hold what is worth keeping.

---

## 6. Answering the questions mechanically

Reuse and blast radius are the two questions an agent is most likely to answer from memory, and
they are the two this repository can answer with tools.

| Question | Tool | Cost |
|---|---|---|
| Does something like this exist? | `outline` on candidate modules; symbol search over the index | One call, shape rather than bytes |
| Can it be used unchanged? | `symbol` for the one declaration and its comment | One call |
| How many call sites? | `usages`, resolved through the type checker | One call |
| Is "done" checkable? | Can the condition be written as a `vitest` case or a type? | Free, but it is a judgement |
| Did it work? | `check`, the same gate as `npm run check` | Full gate |

Only the fourth row is unmechanized, and it is the highest-value question. That is the honest
shape of the situation: tooling covers the questions that are tedious, not the one that matters
most.

---

## 7. Validating the checklist itself

H11 in the README says measuring the impact of tools and approaches is hard, and this is a case
in point: a checklist cannot be A/B tested cleanly on a single-developer repository with a
shifting task mix. What can be tracked, from data this repository already produces:

* **Rework rate** — commits that revert or substantially rewrite code committed in the previous
  session. A checklist that works should reduce these.
* **Files touched per task** against the tier-1 blast-radius estimate. Systematic
  underestimation means question 5 is being answered from memory.
* **Gate failures after the first green** — a change that passed and then broke something later
  is exactly what question 7 exists to catch.
* **Answer length over time.** If tier-0 preambles grow, the checklist is inflating; if they
  become identical across tasks, it has become ritual. Both are failure signals, and both are
  visible in the transcripts the dashboard already parses.

None of these is a controlled result. They are cheap indicators, and naming them is what makes it
possible to cut the checklist down if they do not move.

---

## 8. Assumptions in this proposal

Following the report's own advice, split by confidence.

**Noted, high confidence, not tested:**

* Ambiguity is the dominant cause of wasted agent sessions, more than wrong technical choices.
  The gate catches the second class and cannot catch the first.
* Reuse questions answered by search beat reuse questions answered by recall, by a wide margin.
* A short checklist that gets followed beats a thorough one that gets performed.

**Worth testing, medium confidence:**

* That the three tier-0 questions capture most of the value and the higher tiers add little on
  typical tasks. Test by running tier-0-only for a week and looking for failures the higher tiers
  would have caught.
* That "state done as a checkable predicate" works as an ambiguity detector rather than always
  producing a plausible-sounding answer. Test by comparing the stated predicate against the test
  that actually ended up being written.
* That the chosen option recorded in a commit message is ever read again, by a person or by a
  later agent. If nothing reads it, that step is cost without return.

**Low confidence:**

* That the checklist survives model improvement. The H14 pattern says compensatory scaffolding
  ages quickly and informational context does not. Questions 1 and 2 are informational — they
  pull repository facts into context — so they should age well. The rest compensates for a
  planning weakness that stronger models may not have, and should be re-examined rather than
  defended.

---

## 9. The short version

Ask three questions every time: what counts as done and can it be checked, what already exists,
and what is the smallest change that satisfies the first answer. Add options-and-reason, blast
radius, and assumptions when the work touches more than one file. Add silent-failure,
switching-condition, and rollback when it touches something shared or hard to reverse. Answer the
reuse question with a tool, never from memory. Keep the answers short enough that writing them
stays cheaper than skipping them.
