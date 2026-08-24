# What the scout is good for, and how to find out properly

*2026-08-23*

An assessment of the `scout` subagent after 31 subagent runs in one session: 15 for [the
benchmark](scout-benchmark-run-2026-08-23.md) (five questions across three arms) and 16 more
re-running the scout arm against four versions of its definition. The benchmark spec, the
questions, and the ground truth are in [docs/scout-benchmark.md](scout-benchmark.md).

The short version: the scout is a cheap, reliable *finder* and an unreliable *judge*. Every
strength below is about locating code. Every weakness is about saying something true beyond
"here it is".

## What works

**Cost, by a wide margin.** Across five questions the scout spent 95k tokens to a strong
model's 319k for the same hit rate — 9.5k tokens per correct lead against 29k, before counting
that it runs on a cheaper model. This is the entire practical case for it and it held on every
question and every definition version (86k–100k per five-question sweep).

**It does not invent declarations.** In 21 scout runs, no report named a symbol that does not
exist, put one in the wrong file, or described a body as doing something it does not do. The
instruction to read a declaration with `symbol` before claiming what it does appears to hold.
The two baselines were nearly as clean; the haiku-plus-grep arm was the only one to produce
wrong claims, and both were in `used:` lines rather than about the declarations themselves.

**It finds things named differently from the question.** Every scout run found
`repeatedExpressions` from "copy-pasted", the checkpoint module from "record their current
contents so it can be put back", and the ratchet from "worse than the last recorded run". This
is what the scout was built for and it does it. The caveat is in "What the measurement could
not settle" below: the text-search baselines did it too.

**Signature-shaped tools make exploration cheap.** The scout made roughly twice as many tool
calls as the strong baseline and still spent a third of the tokens, because `outline` and
`symbol` return declarations rather than files. The search is not smarter; each step is just
much smaller.

**Its report format is stable and scannable.** Name, location, signature, one reason, one call
site. Across 21 runs the shape held, which is what makes the output cheap to read and cheap to
score.

## What does not work

**Saying "this does not exist" is unstable.** Asked about a feature the repository genuinely
lacks, the original definition returned six real, adjacent declarations under the heading
"leads for implementing Slack notification" and never mentioned that no notification code
exists. Both text-search arms said it plainly. The definition already carried an instruction to
say so; it simply did not fire. Someone acting on that report starts work believing the
plumbing is half-built. Four definition versions later this is improved but not proven stable —
see the addendum in the run file for what each version did.

**Guarding the negative produced an over-broad negative.** The version that reliably stated
absence also widened it: "No existing Slack, webhook, environment variable reading, or HTTP
client patterns found in the repo." The environment-variable half is false —
`wideCommitAllowed` (`packages/hooks/src/io.ts:54`) and three `process.env` reads do exactly
that. An unverified absence is the same defect as an unverified lead pointing the other way,
and it is worse, because an absence claim is what stops the reader looking. A further rule
bounding absence claims to what was actually searched fixed the one case it was tested on.

**It will not adopt a new output requirement.** A required `verdict:` first line was specified
in one version and demonstrated in a complete worked example in the next. It appeared in zero
of ten reports. The same versions' *prohibitions* did take effect — "no framing sentence"
removed the "Based on my exploration…" opener immediately. Adding a constraint on what not to
write works; adding a required element does not. Plan definition changes accordingly.

**Rewriting its contract degrades what already worked.** The version carrying the full worked
example produced the worst results of any version: no absence statement at all on the negative
question, and signatures replaced by `export const repeatedExpressions` because the example's
signature column was abbreviated. Every edited version also lost `takeSnapshot` on the
checkpoint question, which the original found. The definition is more load-bearing than it
looks, and edits to it need the benchmark, not a read-through.

**`used:` lines are the weakest part of every report.** They are prose about call sites rather
than tool output, and they are where the wrong claims cluster — "used by the revert feature"
for a function only `writePlan` calls, "called by `snapshotOfWorkspace`" for a sibling that
calls nothing. Treat the `name (file:line)` half of a lead as checked and the `used:` half as a
hint.

**It stops at the symbols.** Asked how to track quality over time, it found both halves — the
ratchet's compare-to-baseline and codemap's per-folder scores — and said they "would need to be
combined". The strong baseline found the same symbols and then noticed that
`forbiddenEdges` (`packages/check/src/boundary.ts:23`) forbids `packages/check` from importing
`packages/codemap`, so the obvious combination is illegal. Same evidence, different conclusion.
The scout reports what exists; it does not work out what follows.

**It cannot run anything.** Its tool list is read-only by design. The strong baseline answered
the copy-paste question by running `npm run clones` and returning three real duplicated
functions by file and line — verified, actionable, and permanently out of the scout's reach.

## How to use it, given that

- Run it first, on anything that might already exist. It is cheap enough that the wrong answer
  costs less than the search you skipped.
- Trust the locations. Confirm the `used:` lines yourself if they matter.
- Do not accept a silent absence. If the report does not say the feature is missing and does
  not name a declaration that plainly does the task, that is an unanswered question, not a no.
- Escalate to a capable agent when the answer depends on running something, on whether the
  pieces may legally be combined, or on a judgment about consequences.

## What the measurement could not settle

The benchmark was built to expose the failure the [design
note](code-discovery-scout-2026-08-23.md) predicts for text search: the agent searches its own
word, the code uses another, the search returns empty, and a duplicate gets written. That
failure did not occur once in ten text-search runs.

The reason is that this repository ships its own map in prose. `AGENTS.md` names every package
and its purpose, `docs/` holds a design note per subsystem, and every source folder carries an
`INDEX.md` the gate keeps honest. A grep agent reads those and arrives where `repo_map` would
have put it. On this repository the different-words problem is solved by documentation, so the
benchmark measures cost, hallucination rate, and honesty about absence — not the thing it was
named for.

## How to test this properly

What was run is a smoke test with a scoring rubric, not a measurement. Every defect below was
visible in this session; each has a fix.

**Repeat every cell.** One run per question per arm. A single unlucky sample moved whole rows,
and the one result that drove a definition change rested on one run. Three to five runs per
cell, reporting the spread rather than the number, is the minimum for a claim about behavior
rather than an anecdote.

**Pin the commit and check it again at the end.** A commit from another session landed
mid-benchmark and moved `packages/check/src/run.ts` and `packages/backlog/src/docsgenIo.ts`.
Correct citations then looked like drift, and several scoring notes had to be withdrawn. Record
`git rev-parse HEAD` before launching and compare after the last agent returns; re-verify
against the commit the agents actually saw.

**Enforce the tool restriction in the harness.** The baselines were told in their prompt not to
use the index tools. Nothing stopped them. Define a purpose-built agent type with the text tools
only, so the arm is what it claims to be.

**Keep the definition out of the questions.** One iteration put a worked example into the scout
definition whose content was the answer to one of the benchmark's own questions. That run was
discarded. Examples inside an agent definition must be drawn from code no question touches.

**Score blind, and verify before scoring.** Every claimed lead was checked against the index
here, which is right and should stay. But the same person wrote the questions, chose the ground
truth, and graded the answers, having already seen several reports. Fix the ground truth in
writing before any run, and grade from the report text alone with the arm labels hidden.

**Measure the decision, not the report.** Hit rate rewards naming symbols. What matters is
whether an implementer reading the report does the right thing — reuses instead of duplicating,
or builds instead of hunting for something that is not there. Give the same reports to a
separate agent asked "what would you do next?" and score that. It is the only measure under
which the Slack failure and a missing supporting lead carry their real, very different weights.

**Test on a repository the scout has no map of.** Until it runs somewhere without `AGENTS.md`,
per-folder `INDEX.md` files, and a design note per subsystem, the central claim is untested.
Clone something mid-sized and undocumented, write questions with verified answers, and run the
same three arms. This is the single highest-value change to the benchmark.

**Include negatives deliberately, and more than one.** The one true-negative question carried
the only failure worth acting on. It should be a class of three or four — a feature genuinely
absent, a feature present under another name, a feature half-present, and a feature that used to
exist and was removed — each scored on whether the report's claim about existence is correct and
correctly bounded.

**Normalize cost honestly.** Subagent tokens are not the only price. A scout report also costs
the parent context what it takes to read, and the default approach in a real session is often
the main agent searching inline, which spends into a context that has to keep working
afterwards. Report tokens spent, tokens returned, and model price separately.

**Re-run the whole benchmark on any definition edit.** Three of the four edits tested here
improved the target behavior and damaged something else. Nothing about the definition should be
changed on the strength of reading it.
