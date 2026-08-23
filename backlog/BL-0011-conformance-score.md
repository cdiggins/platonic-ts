---
id: BL-0011
title: Score purity, complexity, and quality against the platonic ideals
type: idea
status: idea
priority: "?"
effort: "?"
risk: "?"
area: repo
sprint:
created: 2026-08-22
closed:
links: [BL-0001, BL-0003, BL-0010, BL-0016, docs/tooling-catalog.md, docs/deliverable-ideas-2026-08-22.md]
---

## Idea
A graded assessment of how well a unit of code — file, class, package, or whole repo —
conforms to the platonic ideals (purity, low complexity, general "quality"), not just a
pass/fail gate. Today `platonic check` (BL-0001) only produces binary escape-hatch counts
(`any`/`as`/`!`/`@ts-ignore`/`eslint-disable`) summed across the whole repo — no per-file or
per-class breakdown, no complexity metric, no single conformance score. This idea asks for
something that can answer "how platonic is this file" or "how platonic is this library",
not just "did the repo's total escape-hatch count go up."

## Assumptions
- "Purity" is decomposable into the same syntactic signals the check package already treats
  as escape hatches (BL-0001, BL-0003's eslint-plugin-functional rules), plus possibly
  finer-grained ones (mutation inside a function body, `class` usage, `throw`, ambient
  impurity) — see [pure-fp-for-agents-2026-08-22.md](../docs/pure-fp-for-agents-2026-08-22.md).
- "Complexity" is a metric not yet computed anywhere in this repo (no cyclomatic/cognitive
  complexity tool wired up) — eslint-plugin-sonarjs is noted in the tooling catalog as a
  candidate but not adopted (docs/tooling-catalog.md:57).
- "Quality" is the vaguest of the three and needs to be pinned down to concrete, checkable
  proxies (file size, coupling, test presence) rather than left as a subjective label — else
  this becomes unmeasurable and the ratchet's "agent cannot argue with a lint error" property
  (pure-fp-for-agents doc) is lost.
- A per-unit score is worth building on top of the existing whole-repo ratchet, not instead of
  it — the ratchet's monotonic guarantee (BL-0001) stays useful as a coarse gate even once a
  finer score exists.

## Design decisions
- Granularity — file-level vs class/function-level vs package-level. File-level is what the
  AST walk in `packages/check/src/ratchet.ts` already visits node-by-node; class/function
  level requires attributing each escape hatch to its enclosing declaration, which the current
  `countNode` recursion doesn't track.
- Composition — one blended "platonic score" (single number) vs three separate dimensions
  (purity, complexity, quality) surfaced independently. A blended score is easier to eyeball
  but hides which dimension is driving a bad grade; three dimensions match H2/H3 (files get
  bigger and more coupled, edits get more error-prone) more directly, each measurable on its
  own axis.
- Complexity metric source — adopt eslint-plugin-sonarjs's cognitive-complexity rule (buy,
  per the deliverable-ideas doc's criterion 5: "buy over build") vs hand-roll cyclomatic
  complexity over the TS AST already being walked for ratchet counts.
- Where it lives — a new `packages/score` (or extend `packages/check`) vs folding into B4's
  "verdict compactor" (deliverable-ideas doc) which already dedupes compiler/lint/test output
  by root cause; a per-unit score is a natural extension of a compactor that already groups by
  owning file.
- Surface — CLI-only text/JSON output vs feeding the dashboard (`packages/dashboard`) so
  scores render as a heatmap or sortable table over files/classes, not just numbers in a
  terminal.

## Related
- [BL-0001](BL-0001-platonic-check.md) — the existing binary ratchet is the direct predecessor; this idea graduates it from whole-repo pass/fail counts to a graded, attributable score.
- [BL-0003](BL-0003-eslint-functional.md) — the functional-subset lint rules are exactly the purity signals this idea would score against.
- [BL-0016](BL-0016-code-overview-browser.md) — the browser that renders these scores; it consumes this item's metrics rather than defining a second formula.
- [BL-0010](BL-0010-init-retrofitter.md) — if this ships as a scored profile, the retrofitter is how another repo gets scored too; sequence this after or alongside BL-0010, not before it's clear what's being retrofitted.
- [docs/tooling-catalog.md:57](../docs/tooling-catalog.md) — eslint-plugin-sonarjs already flagged as the buy-side candidate for complexity limits.
- [docs/deliverable-ideas-2026-08-22.md](../docs/deliverable-ideas-2026-08-22.md) — B4 "Verdict compactor" (dedupe by owning file) and B2 "Gate daemon" (compact green/red verdict) are the closest named candidates; this idea is closer to a graded B4 than a new build item.
- [docs/pure-fp-for-agents-2026-08-22.md](../docs/pure-fp-for-agents-2026-08-22.md) — defines what purity means here (no mutation, no throw, no expression statements, no ambient impurity) and why it's chosen to be syntactically (not semantically) enforceable — the score should stay inside that same enforceable boundary, not drift into unmeasurable semantic purity.

## Approaches
Short term:
- Extend `packages/check/src/ratchet.ts`'s `countNode` to attribute counts to the nearest
  enclosing function/class declaration instead of only summing per-file, giving free
  per-function purity counts from the AST walk that already exists.
- Add eslint-plugin-sonarjs's cognitive-complexity rule to the existing ESLint config
  (BL-0003's config) and read its per-file violation counts as the complexity dimension —
  no new AST walker needed, reuses the lint run `platonic check` already performs.
- Report the two dimensions (purity counts, complexity violations) per file as a sorted table
  from a new `platonic score` subcommand, before inventing a blended number.

Long term:
- Surface scores in the code overview browser (BL-0016) as a per-file/per-package heatmap so
  degradation is visible without running a CLI command. Not the observability dashboard: that
  app is agent activity and logged work only (docs/tools-and-process.md). BL-0016 consumes the
  scores this item defines; it does not define its own.
- Use scores to drive BL-0010's graduated-strictness retrofit profile — a target repo's
  initial ratchet baseline could be its current per-file score distribution, not just a flat
  repo-wide count.
- A blended single "platonic score" once the three dimensions have enough real data
  (measurement per H11/B8) to justify a weighting.

Adjacent ideas worth their own item:
- Adopting eslint-plugin-sonarjs generally (independent of scoring) — it's a buy-side tooling
  decision that stands alone.
- A "quality" dimension proxy set (file size, test presence, coupling) — vague enough right
  now that it may deserve its own idea item to pin down before this one is scoped further.

## Bedrock
The seam this strengthens: `packages/check/src/ratchet.ts`'s `countNode` walk currently
discards structural position — it sums escape hatches to one repo-wide number and throws away
which file, function, or class each hit lived in. Attributing counts to their enclosing
declaration (rather than only to a file total) is the change that unlocks everything else
here: per-file scores, per-class scores, a dashboard heatmap, and a smarter BL-0010 retrofit
baseline all fall out of that one structural fix for free. Verdict:
**simplest-along-the-grain** — start with per-file attribution (already almost free, since the
walk is already per-file) and text-table output; it must not hardcode a blended score formula
or a fixed severity threshold, or the later three-dimension/weighting decision above gets
foreclosed before there's data to justify it.

## Simplest possible implementation
Change `ratchet.ts`'s `countNode` to also record each hit's enclosing file path (already
available) and print a sorted-by-count table from the existing `scanRepo` output — no new
complexity metric yet, just make the existing purity counts visible per-file instead of only
as one repo-wide sum.

- Gets: immediate visibility into which files carry the most escape hatches, using code that
  already exists, with no new dependency or scoring formula to design.
- Gives up: no complexity dimension, no class/function-level attribution, no "quality" axis,
  no dashboard surface — those all wait for follow-up work once per-file purity visibility
  proves useful.

## Done means
- [ ] `platonic check` (or a new subcommand) reports escape-hatch counts per file, not only
      as one repo-wide total
- [ ] At least one complexity signal (e.g. sonarjs cognitive complexity) is computed and
      reported alongside the purity counts
- [ ] Dimensions are reported separately (not silently blended into one score) until a
      weighting is justified by measurement
