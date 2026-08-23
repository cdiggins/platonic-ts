# Managing Technical Debt in Agentic Coding Projects

**Status:** technical report.
**Date:** 2026-08-23
**Companion to:** [testing-gates-ratchets-goldens-2026-08-22.md](testing-gates-ratchets-goldens-2026-08-22.md)
(the enforcement vocabulary), [abstraction-timing-2026-08-23.md](abstraction-timing-2026-08-23.md)
(when duplication should become an abstraction), [tools-and-process.md](tools-and-process.md)
(what each command does).

---

## 1. What this document is

A practical account of how technical debt behaves in a repository written mostly by coding
agents, and what to do about it using the tools this repository already has. Every number in it
was measured against the working tree on 2026-08-23, and the command that produced each one is
named so a reader can re-run it.

The companion report on gates and ratchets settles *what kinds of mechanical check exist*. This
one settles a different question: given a codebase that agents are actively enlarging, which
debt is worth tracking, which tool sees it, and what should happen next.

One finding is not about process at all. The ratchet — the mechanism this project relies on to
keep escape hatches from rising — is silently blind to roughly a quarter of the comments in the
repository, and disagrees with the MCP server's implementation of the same count. Section 5
covers it. It is the most important item in this report, because it is a concrete instance of
the general rule the rest of the report argues for.

---

## 2. What is different about debt when agents write the code

Technical debt is usually described as a deliberate trade: ship now, pay interest later. That
framing assumes a scarce, expensive writer who chooses shortcuts knowingly. Agentic development
breaks the assumption in four ways, each of which changes what a debt practice has to do.

**Code arrives faster than review.** This repository holds 23,599 lines of TypeScript across 141
source and test files, plus 679 tests, written in two days. Debt accrues at the rate code is
produced, not at the rate a person reads it. Any practice that depends on a human noticing
something in a diff will not keep up. What survives is what a tool can count.

**Agents optimize against the gate, not the codebase.** An agent's objective is the check it was
given. Whatever `npm run check` measures stays bounded; whatever it does not measure drifts
freely. This is not a defect of any particular model — it is the predictable result of stating a
goal as a command. The consequence for debt management is direct: the set of debts that stay
bounded is exactly the set of debts that are counted, and expanding that set is the highest
leverage move available.

**Agents have no memory between sessions.** A person accumulates a mental list of places that
need attention. An agent starts each session with the repository and nothing else. Debt that is
not written into a file does not exist. This is why `backlog/` and `NOTES.md` are infrastructure
rather than paperwork — they are the only channel by which one session's observation reaches the
next session's work.

**Parallel agents duplicate rather than reuse.** Fenced waves (see [CONTRACTS.md](../CONTRACTS.md))
let several agents work on one tree at once, and they cannot see each other's code as it lands.
The result is the characteristic debt of this development style: the same helper written several
times under different names. It is visible here. `npm run clones` reports 641 repeated
expression shapes across the repository; the largest genuine one is a 74-node incremental
file-tail reader written three separate times, in
[packages/dashboard/src/invocations.ts:30](../packages/dashboard/src/invocations.ts),
[packages/hooks/src/tail.ts:25](../packages/hooks/src/tail.ts), and
[packages/transcripts/src/index.ts:331](../packages/transcripts/src/index.ts). Three agents,
three fences, one function.

Taken together these say that a debt practice for agentic work must be mechanical, written down,
and specific about duplication. Habits, review culture, and shared intuition — the three things
human teams usually rely on — are exactly the things not available.

---

## 3. Four kinds of debt, sorted by what can see them

Debt is easier to reason about when sorted by which tool observes it and whether anything blocks
on it. The rows below are ordered by decreasing control.

| Category | Example | Instrument | Blocks? |
|---|---|---|---|
| Counted and gated | `any`, `as`, `!`, suppression comments, undocumented exports | `packages/check` ratchet against `ratchet.json` | Yes — a rise fails `npm run check` |
| Counted, not gated | Files over the 300-line budget, function size, duplication, unused exports | `npm run stats`, `npm run clones`, `npm run codeview`, MCP `unused_exports` | No |
| Recorded, not counted | Known bugs, deferred design problems, retire candidates | `backlog/`, `NOTES.md` | No |
| Neither | Stale prose, wrong doc comments, design drift | — | No |

The value of the sort is that each row has a distinct remedy. Row 1 needs nothing but occasional
payment. Row 2 needs a decision about whether to promote it to row 1. Row 3 needs triage
discipline. Row 4 needs to be moved into row 2 by inventing a measurement, or accepted as
permanently unmanaged.

The project has already run this promotion once, and it worked. Undocumented exports were row 4
until `countUndocumentedExports` was added to
[packages/check/src/ratchet.ts](../packages/check/src/ratchet.ts), which made them row 1; 212 doc
comments were then backfilled in a single pass (commit `968be7a`) and the baseline now stands at
63. That is the template: invent the count, backfill once, ratchet the remainder.

---

## 4. The current inventory

Measured on 2026-08-23 against the working tree.

**Row 1 — counted and gated.** `ratchet.json` holds 0 `any`, 5 `as` casts, 23 non-null
assertions, 1 `@ts-` directive, 0 `eslint-disable`, and 63 undocumented exports. The gate passes:

```
[PASS] typecheck (3729ms)  [PASS] lint (9347ms)  [PASS] ratchet (280ms)
[PASS] tests (12976ms)     [PASS] backlog (2939ms)     check: OK
```

Of the 23 non-null assertions, 21 are in
[packages/transcripts/test/transcripts.test.ts](../packages/transcripts/test/transcripts.test.ts)
and are one idiom repeated — `parseTranscriptLine(FIXTURE, lines[0]!)` under
`noUncheckedIndexedAccess`. That is one fix, not 21: a fixture helper returning a checked line
would retire most of the count. The 63 undocumented exports are spread over 30 files, led by the
newest `packages/codemap` modules (`rewrite.ts` 5, `stats.ts` 5, `clones.ts` 4, `metrics.ts`
4).

**Row 2 — counted, not gated.** Fifteen files exceed the PS-024 300-line budget, led by
[packages/codeview/src/ui.ts](../packages/codeview/src/ui.ts) at 814 lines and
[packages/dashboard/src/ui.ts](../packages/dashboard/src/ui.ts) at 631. Both are single-page HTML
documents held as one string, which is a defensible reason to be long and no reason at all to
stay uncounted — nothing currently distinguishes them from
[packages/transcripts/src/analyze.ts](../packages/transcripts/src/analyze.ts) at 583 lines, which
is ordinary code that has simply grown.

Duplication, from `npm run clones`: 641 repeated shapes repository-wide, of which 259 are in test
code and 145 are in non-test code at 12 nodes or larger. Only 14 non-test shapes are 30 nodes or
larger. That last number is the actionable list; section 6 explains why it is not the top of the
default ranking.

Function size, from `npm run stats` over 850 functions: median 7 lines, 90th percentile 23, and a
maximum of 241. The distribution is healthy and the tail is short, which is the evidence that
PS-024 is worth gating at the file level rather than the function level.

**Row 3 — recorded, not counted.** Eighteen live backlog items. Six are `ready`: BL-0017
(zone-aware score), BL-0018 (dashboard close hang), BL-0019 (index payload), BL-0024 (metrics
rollup), BL-0029 (split `metrics.ts`, a PS-024 violation already filed), BL-0030 (validate skips
archive). Four are `in-progress`, including BL-0005 and BL-0010, which have held that status
since 2026-08-22 without landing.

**Row 4 — unmanaged.** [README.md](../README.md) states the MCP server "gives an agent nine
tools"; [AGENTS.md](../AGENTS.md) states 33, and the catalogue is the larger number. Nothing
detects the disagreement. BL-0025 proposes generated marker blocks with a staleness gate, which
is the row-4-to-row-2 promotion for exactly this class of drift.

**Uncommitted work.** While this report was being written the tree carried roughly 1,200 new
lines under `packages/codemap` — the clone-extraction modules — with no commit point. They landed
mid-measurement as `adf5a17`. That is the debt with the shortest fuse and the one most specific
to parallel agents: uncommitted work has no revert point, the standing convention in
[CLAUDE.md](../CLAUDE.md) is that a clean commit point exists before new work starts, and a
second session cannot see work that has not been committed. One untracked id marker,
`backlog/.ids/0030`, was left behind by the same style of oversight; an unmarked id can be
handed out twice.

---

## 5. The instrument is code, and this one has a defect

`platonic check` counts suppression comments by scanning the token stream for comment trivia, in
`collectCommentText` in [packages/check/src/ratchet.ts](../packages/check/src/ratchet.ts). The
scanner is created directly with `ts.createScanner` and driven token by token, with no parser
above it.

A context-free scanner cannot resume a template literal. When it reaches the `}` that closes a
`${...}` substitution it emits a close-brace token; the parser is normally the thing that calls
`reScanTemplateToken` to continue reading template text. With no parser, the remainder of the
template is re-read as ordinary source. If that remainder contains an unbalanced quote, the
scanner enters a string or template it never leaves, and every comment after that point in the
file is invisible.

That is not hypothetical. [packages/mcp/src/inspect.ts:185](../packages/mcp/src/inspect.ts)
contains a template whose text after the substitution begins with a double quote. The scanner
reads that quote as the start of a string literal, which never closes on that line; the trailing
backtick then opens a template that runs to the end of the file. As far as the ratchet is
concerned the file has 21 comments, all before line 183, and none after. Line 219 of the same
file reads:

```ts
// Lists escape hatches (ts-ignore, eslint-disable, etc) in the codebase.
```

`countEscapeHatches` returns `eslintDisables: 0` for that file.

Repository-wide, comparing the scanner's output against comment ranges taken from the parsed
syntax tree: **58 of 145 files lose comments, and the scanner sees 1,437 of 1,893 comment
ranges — 24% are invisible.** Two of the ratchet's six axes, `tsDirectives` and `eslintDisables`,
are computed from those comments. The other four are computed from the syntax tree and are
unaffected.

The exposure is bounded but real: an `@ts-ignore` or `eslint-disable` placed anywhere after the
first derailing template, in 40% of the repository's files, is not counted, and the gate reports
`ok`.

**The second half of the finding is worse than the first.** The MCP server implements the same
count a second time, in `hatchesOfFile` in
[packages/mcp/src/inspect.ts](../packages/mcp/src/inspect.ts), reading comments from
`ts.getLeadingCommentRanges` over syntax-tree nodes. Its tool description asserts it is "the same
classification the gate uses, so the two cannot disagree." Running it right now returns:

```
escape hatches — 30 in 7 files: any 0, as 5, non-null 23, ts-directive 1, eslint-disable 1
baseline 29 in ratchet.json, counted 30 — regressed: eslintDisables
```

The gate says clean; the tool that claims it cannot disagree says regressed. Neither is simply
right. The gate under-scans. The MCP implementation over-counts, because it treats a doc comment
that *mentions* `eslint-disable` in prose as a suppression, and it also misses trailing comments
entirely, since it reads only leading ranges. Two implementations of one claim, both partial, in
opposite directions, with no test comparing them.

Three rules follow, and they generalize past this bug.

1. **A measurement that gates the codebase is load-bearing code and needs its own tests.** The
   ratchet has tests and they pass; they test small hand-written strings, not the property that
   matters. A differential test against the second implementation would have caught this on the
   day the second implementation was written.
2. **Silent under-counting is the failure mode to design against.** A gate that fails loudly gets
   fixed within the hour. A gate that quietly reports `ok` accumulates unmeasured debt for as
   long as it lives, while confidence in the number grows.
3. **Fixing an instrument raises the numbers, and that must be expected.** Correcting the scanner
   will discover suppressions the baseline never knew about, and the ratchet will fail. That
   failure is the tool working. Per axis 4 of the
   [gates report](testing-gates-ratchets-goldens-2026-08-22.md), re-blessing a baseline after an
   instrument change is a human decision, not something the agent that changed the instrument may
   do for itself.

---

## 6. Practices that hold up here

**Count first, fix second.** Every debt this project has actually reduced was reduced after
someone made it countable — escape hatches, then undocumented exports. The reverse order, a
cleanup pass with no count behind it, produces a one-time improvement that decays, because
nothing notices the decay.

**Ratchet, do not target.** A ratchet states "never worse" and lets improvement happen where it
is cheap. A target ("get to zero by Friday") invites the shortest path to the number, which is
deletion of the thing being measured. The distinction matters more with agents than with people
because the shortest path is found faster.

**Give debt to the tool that can pay it, not to a prompt.** "Clean up the duplication in
`packages/mcp`" is a prompt that produces a large uncheckable diff. The MCP server's
`move_symbol`, `change_signature`, `delete_symbol`, and `unused_exports` produce plans a reviewer
can read, and `checkpoint`/`revert` bound the damage. The `npm run clones -- --extract N`
work in `packages/codemap` (`adf5a17`) is the same idea for duplication: it prints the
declaration it would create, every call site, and every reason the extraction would not compile,
before writing anything. Preview, then apply, is the correct default for every automated debt payment.

**Read the duplication ranking with judgment.** `npm run clones` ranks by nodes removed, and the
top entry repository-wide is `expect(plan.ok).toBe(false)` appearing 44 times. Extracting it
would be a mistake: repeated assertions are how a test suite stays readable, and PS-054 wants
tests to exercise the seam plainly. The entries worth acting on have few occurrences and many
nodes — the 3-occurrence, 74-node file-tail reader, not the 44-occurrence, 9-node assertion. In
this repository that is 14 shapes, not 641. A ranking is an input to a decision, not the
decision; section 8 of the [abstraction-timing report](abstraction-timing-2026-08-23.md) gives
the rule for which side of PS-049 a given case falls on.

**Write the finding down where the next agent will read it.** `NOTES.md` is append-only and
carries the discoveries that cost real debugging — that an import is a reference, that
overlapping edits corrupt files silently, that the nearest named declaration is the wrong owner.
Each of those was a bug someone would otherwise have rediscovered. Appending a paragraph costs
far less than the second discovery.

**Pay debt inside the wave that created it.** A separate cleanup sprint competes with feature
work and loses. A cleanup pass immediately after a wave goes green, while the code is still the
most recent thing anyone touched, competes with nothing and has the best available information.

---

## 7. What to do next

Ordered by exposure against cost. The first is the one that matters.

1. **Fix the ratchet's comment scanner, and make the two implementations agree.** Replace the
   raw-scanner walk in `collectCommentText` with comment ranges taken from the parsed source
   file, which `countEscapeHatches` already creates a few lines above. Then add a differential
   test asserting that `packages/check`'s counts and the MCP server's `hatchesOfFile` agree on
   every file in the repository. Expect the fix to raise `tsDirectives` and `eslintDisables`,
   expect the ratchet to fail, and re-bless the baseline deliberately.

2. **Decide what a suppression comment is, once.** A comment that mentions `eslint-disable` in
   prose is not a suppression, and the two implementations get this wrong in opposite directions.
   The narrow rule — the directive must begin the comment, optionally after whitespace — is what
   ESLint and TypeScript themselves apply, and it removes both false positives without weakening
   the count. Note that the `@ts-ignore` in
   [packages/check/src/ratchet.ts:7](../packages/check/src/ratchet.ts) is a prose mention too, so
   the baseline's `tsDirectives: 1` should become 0 under the corrected rule.

3. **Promote two row-2 debts to row-1 counts.** Add a `filesOverBudget` axis (PS-024, currently
   15) and an `unusedExports` axis to `RatchetCounts`. Both quantities are already computed — the
   first by `packages/codemap/src/metrics.ts`, the second by the MCP `unused_exports` tool — so
   the work is wiring and a baseline, not analysis. BL-0029 already covers the first offender.

4. **Retire the 21 non-null assertions in `transcripts.test.ts` as one change.** A fixture helper
   returning a checked line removes 21 of the repository's 23 non-null assertions and drops the
   baseline in a single commit.

5. **Finish the undocumented exports to zero.** 63 remain in 30 files, concentrated in the new
   `packages/codemap` modules. The `doc-writer` agent exists for exactly this and refuses rather
   than guesses, which is the property that makes an automated pass safe.

6. **Expose duplication payment through the MCP server.** `clones --extract` has landed; an agent
   should be able to ask for a group's extraction plan and apply it, with the same preview-and-
   refuse discipline as the other write tools. Duplication is the debt this development style
   generates fastest, and it is currently the one with no automated payment path.

7. **Close the row-4 gap on docs.** BL-0025 (generated marker blocks with a staleness gate) is
   already filed; the README's "nine tools" against the catalogue's 33 is the concrete case it
   would have caught.

8. **Triage the four stale `in-progress` items.** BL-0005 and BL-0010 have been `in-progress`
   since 2026-08-22. An item that is `in-progress` and untouched is worse than one marked
   `ready`, because it suppresses the question of whether anyone will do it.

---

## 8. What not to do

**Do not run a debt sprint.** It competes with feature work, and the information needed to do it
well — why the code is shaped the way it is — is freshest immediately after the code lands, not
weeks later.

**Do not set a coverage target.** Coverage measures execution, not verification, and as a target
it produces tests that run code without checking it. Section 2 of the
[gates report](testing-gates-ratchets-goldens-2026-08-22.md) makes the case; mutation testing is
the arbiter to reach for instead.

**Do not let the agent that changed an instrument re-bless the baseline.** `applyBaseline` in
[packages/check/src/run.ts](../packages/check/src/run.ts) rewrites `ratchet.json` automatically
when counts improve. That is safe for ordinary work and unsafe across an instrument change,
because a scanner that silently sees less looks exactly like genuine improvement. Instrument
changes and baseline changes should not land in the same commit.

**Do not extract from the top of the clone ranking.** See section 6.

**Do not add a debt count that nothing will ever pay down.** A ratchet axis with no plausible path
to zero becomes a permanent floor that everyone learns to read past, and it costs the credibility
of the axes that do matter.

---

## 9. Open questions

- **What is the right ratchet axis for duplication?** Total repeated nodes is noisy and moves with
  test volume. "Non-test shapes above 30 nodes" tracks the actionable list better, but it is
  sensitive to a threshold nobody has justified.
- **Should the two long UI files be exempted from PS-024, or split?** Both are single HTML
  documents held as a string. An exemption needs a rule that does not also exempt ordinary long
  files; a split needs a template mechanism the project does not have.
- **How is an instrument change reviewed when no human reads every diff?** The differential test
  in step 2 answers it for one measurement. The general form — how a project gains confidence in
  a measurement it never verified by hand — is unsolved here.
