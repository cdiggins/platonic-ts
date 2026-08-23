---
id: BL-0027
title: Report distribution statistics for function, expression, and statement size
type: feature
status: done
priority: p2
effort: M
risk: low
area: codemap
sprint:
created: 2026-08-23
closed: 2026-08-23
links: [BL-0011, BL-0017, BL-0016, BL-0024, docs/small-pure-functions-2026-08-23.md, docs/style-guide.md, packages/codemap/src/metrics.ts]
---

## Idea
A tool that reports the *distribution* of code-size measures across the repo, not just totals
and a score. For every function: length in lines, size in AST nodes, and arity (parameter
count). For every expression and every statement: size in AST nodes (and, for statements,
lines). For each of those populations report min, max, mean, median, quartiles, quintiles, and
the 90th / 95th / 99th percentiles.

Interpretation of the two ambiguous points. "Argument size" is read as *arity* — the number of
parameters a function declares — since that is the measure the style guide and
[docs/small-pure-functions-2026-08-23.md](../docs/small-pure-functions-2026-08-23.md) already
argue about; a second reading ("size of each argument's type") is a much bigger job and is left
as an adjacent idea. "Something similar for expression and statements" is read as: treat every
expression node and every statement node as its own population and run the same percentile
summary over their subtree node counts, so the report answers "how big is a typical expression
here, and how big is the 99th-percentile one".

The point is not a new score. `scoreMetrics` already collapses counts into one number per file
and BL-0011 warns against blending further. This is the opposite move: keep the raw population
and describe its shape, so claims like "median function is 7 lines" are recomputable rather
than hand-measured once for a document.

## Assumptions
- Per-function data already exists and does not need re-deriving: `functionMetrics`
  ([packages/codemap/src/metrics.ts](../packages/codemap/src/metrics.ts)) emits `lines`,
  `statements`, and `parameters` for every named function, and `CodeIndex.files[].functions`
  carries them repo-wide.
- AST node count is genuinely new. `subtreeNodes` exists in the same file and is exactly the
  walk needed, but nothing stores `nodes` on `CodeMetrics` today — adding it is a field on
  `CodeMetrics` in [packages/core/src/index.ts:196](../packages/core/src/index.ts:196) plus one
  line in `structuralCounts` and `sumMetrics`.
- Expression- and statement-level populations are new work of a different kind: they are *not*
  per-file aggregates, they are tens of thousands of individual observations. Whether they are
  materialised into the index or computed on demand is the main design question below.
- The numbers are worth having because they get cited. The table in
  docs/small-pure-functions-2026-08-23.md (median 7 lines, 75th/90th at 14/27, 99th at 116,
  arity histogram, 477 parameters) was measured by hand for that one document and is already
  stale the moment the repo changes. A tool makes that table a build product.
- Percentile definition must be pinned down and stated, not left to a library default —
  nearest-rank vs linear interpolation differ visibly on the small populations here (298
  functions), and a doc that quotes "p99 = 116" needs to mean one thing.

## Design decisions
- **Where the statistics live** — a new pure module `packages/codemap/src/stats.ts` (sibling of
  `metrics.ts`, same posture: pure, no IO, unit-tested) vs a new `packages/stats` package. The
  sibling module wins unless the summariser is meant to serve non-code populations too; the
  distribution maths itself (`summarise(numbers) -> Summary`) is domain-free and is the one
  piece that might justify living in `core`.
- **Materialise or recompute** — store expression/statement observations in `CodeIndex` vs
  recompute them from the `ts.Program` on demand. Materialising every expression node count
  would multiply index size by orders of magnitude for data no viewer needs per-file;
  recomputing costs a full AST walk but the walk already happens in `indexRepo`
  ([packages/codemap/src/io.ts](../packages/codemap/src/io.ts)). A third option: store only the
  *summary* (a dozen numbers per population per scope) in the index and never the raw
  observations — cheap, and enough for every stated use.
- **Scope of a report** — repo-wide only, vs per-folder / per-package, vs per-zone. BL-0017
  establishes that Core / Root / Test are different populations that should not be pooled; if
  that lands first, zone-partitioned summaries are nearly free and much more honest than one
  repo-wide median.
- **Percentile convention** — nearest-rank (`ceil(p/100 * n)`) vs linear interpolation between
  order statistics (the R-7 / `numpy` default). Nearest-rank always returns an actual observed
  value, which matters when the next question is "which function is that".
- **Does it name names** — a pure summary (numbers only) vs a summary plus the top-N outliers
  by symbol id. The doc's most useful sentence was not the p99, it was *which three functions*
  sat above it. `FunctionMetrics.symbolId` already gives a stable handle, and the code browser
  (BL-0016) already resolves those ids to a page.
- **Surface** — `npm run codeview` page vs a `platonic stats` CLI printing a table vs JSON for
  docs generation. These are not exclusive; the decision is which one is v1 and whether the
  JSON is the contract the other two consume.
- **Statement "size"** — subtree node count vs source lines vs both. A `return` spanning 12
  lines of pipeline and a `return` of one node are very different objects and lines alone will
  mislead; node count alone loses the formatting signal that PS-052 is actually about.

## Related
- [BL-0011](BL-0011-conformance-score.md) — overlaps at the seam: BL-0011 wants a per-unit
  conformance *score*, this wants per-population *distributions*. Complementary, and this one
  supplies the evidence BL-0011 says to keep alongside any score. It explicitly calls for
  keeping the raw parameter count rather than inventing a threshold, which is exactly what this
  item does.
- [BL-0017](BL-0017-zone-aware-platonic-score.md) — depends on, softly. Its finding that
  Core/Root/Test are different populations applies verbatim to distributions; pooled percentiles
  will be as misleading as pooled scores.
- [BL-0016](BL-0016-code-overview-browser.md) (done) — the natural surface. It already renders
  function-level metrics; a distribution view is the missing "is this function unusual" context
  next to each number.
- [BL-0024](BL-0024-metrics-rollup-glance-page.md) — same shape of problem in the other tool
  (raw events → daily rollup → KPI tiles). Worth reading for its "recompute, don't persist"
  conclusion before deciding the materialisation question.
- [docs/small-pure-functions-2026-08-23.md](../docs/small-pure-functions-2026-08-23.md) — the
  hand-measured table this tool would replace, and the best statement of what the numbers are
  *for*: locating the reversal point where splitting stops paying.
- [docs/style-guide.md](../docs/style-guide.md) — PS-024 (300-line file budget) and PS-052
  (pipelines over accumulators) are the rules the statement/expression distributions would give
  evidence for or against. No PS rule sets a function-length or arity budget; this tool is how
  you would decide what one should be.
- [packages/codemap/src/metrics.ts](../packages/codemap/src/metrics.ts) — `functionMetrics`,
  `subtreeNodes`, `structuralCounts`: the three building blocks that already exist.

## Approaches
**Short term**
1. `summarise(values: readonly number[]): Summary` in a new pure module, plus a
   `functionSizeReport(index: CodeIndex)` that feeds it `lines` / `statements` / `parameters`
   straight out of `CodeIndex.files[].functions`. No new AST work at all, no index change —
   reproduces most of the doc's table today.
2. Add `nodes` to `CodeMetrics` (one line in `structuralCounts`: `nodes: nodes.length`). Now
   function AST size joins the report and every existing consumer gets it free.
3. Expression/statement populations as a separate walk producing summaries only, run behind a
   CLI flag so the cost is opt-in until it proves useful.

**Long term**
- Zone-partitioned distributions once BL-0017 lands, and distributions over time (the shape of
  the repo's function-length curve across commits is a better health signal than any single
  score).
- Percentile bands rendered in the code browser next to each function's numbers: "this function
  is at p97 for length in this package".
- Distribution-derived budgets: set the PS-024-style ceiling at the current p95 and ratchet it,
  rather than picking 300 by feel.

**Adjacent ideas worth their own item**
- Argument *type* size — how big is the type each parameter accepts, measured over the type's
  structural node count. The second reading of "argument size", and a much larger job.
- Comparative distributions against other repositories, to answer "is this style unusual".

## Bedrock
The seam this strengthens is the one between *measurement* and *judgement*. Today
`packages/codemap/src/metrics.ts` fuses them: it walks the AST, counts, and immediately applies
`PENALTIES` to produce a score, so the counts only survive as a by-product on their way to a
number. A `summarise` function that takes `readonly number[]` and returns order statistics knows
nothing about code at all — which is exactly why it can describe any population the walker
produces (functions today, expressions and statements next, commits or token counts later)
without `metrics.ts` growing a branch for each. Concretely it makes two future changes cheap:
BL-0017's zone partitioning becomes "group the observations, call `summarise` per group" instead
of a second penalty table, and BL-0011's per-unit score gets a defensible baseline (the current
distribution) instead of hand-picked constants.

Verdict: **simplest-along-the-grain**.

The simple version must NOT: (a) put percentile logic inside `scoreMetrics` or the `PENALTIES`
table — the summariser takes numbers and returns numbers, and never imports `typescript`;
(b) fold any distribution figure back into `platonicScore`, which would make the score depend on
the rest of the repo and destroy its per-file meaning; (c) persist raw per-expression
observations into `CodeIndex`, which would commit the on-disk index format to a shape only this
one report needs.

## Done means
- [x] `summarise` returns min, max, mean, median, quartiles (p25/p50/p75), quintiles
      (p20/p40/p60/p80), p90, p95, p99, and count, for any `readonly number[]`, with the
      percentile convention stated in a comment and covered by unit tests including n=0, n=1,
      and a population where interpolation and nearest-rank disagree.
- [x] A report over the current repo prints distributions for function lines, function AST
      nodes, and function arity, and the median/p90/p99 figures match a manual spot-check
      against `docs/small-pure-functions-2026-08-23.md`'s methodology.
- [x] The same report covers expression and statement node-count populations.
- [x] `CodeMetrics` carries an AST node count and `sumMetrics` sums it, with the existing
      metrics tests still green.
- [x] `npm run test`, `npm run typecheck`, `npm run lint`, and `npm run check` all pass with no
      new escape hatches.

## Simplest possible implementation
One new file, `packages/codemap/src/stats.ts`, exporting `summarise(values) -> Summary` (a
readonly record of the order statistics) and `functionSizeReport(index: CodeIndex)` returning
`{ lines, nodes, arity }` summaries built from `index.files.flatMap(f => f.functions)`. A dozen
lines added to `packages/codeview` or a `stats` subcommand prints them as a table. Expression and
statement populations arrive in step two, from a `subtreeNodes` walk filtered by
`ts.isExpression` / `ts.isStatement`.

**What you get**
- The doc's table becomes reproducible in seconds, and stops going stale.
- Zero risk to existing behaviour: nothing is removed, no score changes, no index format change
  in step one.
- A domain-free `summarise` that BL-0011, BL-0017, and BL-0024 can all reuse.

**What you give up / risk**
- Repo-wide pooled numbers are misleading until BL-0017's zones exist — a median that mixes
  `expect(...)`-dense tests with pure Core code describes neither.
- Step two's full-AST walk over every expression is the first thing here with a real cost, and
  it duplicates a walk `indexRepo` already does unless it is threaded into that pass.
- Distributions invite premature budget-setting: "p95 is 34 lines" reads as "34 is the limit",
  which is precisely the invented-threshold move BL-0011 warns against.

## Outcome

Landed in `92d89da` as `npm run stats` (`--json` for the same data).
`packages/codemap/src/summary.ts` holds the domain-free order statistics,
`stats.ts` the populations and zones, `report.ts` the table, `main.ts` the CLI.
The AST walk moved out of `metrics.ts` into `walk.ts`, which both now share.

Two definitions had to be pinned down during the build, neither of them obvious
at capture time.

**Expressions are compound maximal expressions.** `ts.isExpression` classifies a
node by its syntax kind, not its position, so every declared name, property
name, and name inside a type annotation qualifies as an expression of one node.
Measuring all of them put the median at 1 for every zone. Restricting the
population to expressions whose parent is not an expression was not enough on
its own — the names are exactly the nodes with non-expression parents. Requiring
more than one node removes them without needing `ts.isExpressionNode`, which the
compiler does not include in its public typings.

**Statements do not double count.** The compiler does not treat a function body
block as a statement, so a body and the statements inside it never both appear
in the population. A test asserts this rather than leaving it to be rediscovered.

Measured on the repository at that commit, Core zone: function length median 7,
p75 14, p90 25, p99 57, max 241 over 510 functions; arity median 2, p90 6;
compound expression size median 10, p90 63. The hand-measured table in
`docs/small-pure-functions-2026-08-23.md` agrees on the median and 75th
percentile and differs in the upper tail, because it counted only top-level
functions where the tool counts local helpers as well. That doc now says so.
