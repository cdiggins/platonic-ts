---
id: BL-0017
title: Make the platonic score zone-aware
type: problem
status: ready
priority: p2
effort: M
risk: low
area: codemap
sprint:
created: 2026-08-23
closed:
links: [BL-0011, BL-0016, docs/style-guide.md]
---

## Problem
`scoreMetrics` in `packages/codemap/src/metrics.ts` penalises every file by the same rules,
but [the style guide](../docs/style-guide.md) does not. It defines three zones: Core
(`packages/*/src/**`, pure, full rules), Root (`src/main.ts`, `src/server.ts`, `src/io.ts`,
where ambient access and mutation are allowed), and Test (`packages/*/test/**`, where mutation
and `throw` are allowed). `CodeMetrics` carries no zone, so the score cannot tell the
difference.

## Impact
The score punishes code for obeying the style guide. Concretely, measured during the wave that
built it:
- `packages/codeview/src/server.ts` scores 61 — a Root file penalised for the nesting and
  mutation PS-004/PS-020 explicitly permit there.
- `packages/transcripts/test/transcripts.test.ts` scores 39, the worst file in the repository,
  largely for non-null assertions and a statement density that is inherent to `expect(...)`
  assertions in a well-written test.

That is not noise around a good signal; it inverts the ranking. The files the score points at
hardest are among the ones with the least to answer for, which is exactly the failure mode that
makes a metric get ignored.

## Affected code
- `packages/codemap/src/metrics.ts` — `scoreMetrics`, and the penalty table above it.
- `packages/core/src/index.ts` — `CodeMetrics`, `FileEntry`.
- `packages/codemap/src/io.ts` — `indexRepo`, which knows each file's path and therefore its
  zone.
- `packages/codeview/src/ui.ts` — would want to show the zone next to the score, so a reader
  knows which rules were applied.

## Root cause
The zone is a property of the file's *path*, and the metric functions were given a
`ts.SourceFile` and a source text but no path-derived context. `fileMetrics(sourceFile,
sourceText)` cannot know its own zone from its arguments. The score was therefore built as a
pure function of counts, which is the right shape but the wrong input set.

## Fix approaches
- **Zone on the data.** Add `zone: 'core' | 'root' | 'test'` to `FileEntry` (derived in
  `indexRepo` from the repo-relative path, which is the same rule `eslint.config.js` already
  encodes in its `files:` globs) and pass it into `scoreMetrics`. Weights become a per-zone
  table: Root zeroes the mutation and nesting penalties, Test zeroes `throw` and statement
  density.
- **Zone as a weight multiplier.** Keep one table, multiply each weight by a per-zone factor in
  `[0, 1]`. Less code, but it cannot express "this rule does not apply here" as distinctly from
  "this rule matters less here".
- **Derive the zone from the lint config.** The zone boundaries already exist as globs in
  `eslint.config.js`. Reading them would guarantee the score and the linter never disagree, at
  the cost of parsing a config file that is not designed to be read as data. Worth considering
  only if the zones start to drift.

## Simplest fix
Add `zone` to `FileEntry`, derive it in `indexRepo` from the path, and give `scoreMetrics` an
optional second parameter defaulting to `'core'` so no existing call site breaks. Zero the
penalties the style guide already exempts, per zone. Function-level scores inherit their file's
zone.

- Gets: the ranking stops being inverted, with no change to the weight table's design and no
  new concepts beyond one the style guide and the lint config already both use.
- Gives up: the zone rule is duplicated in a third place (lint config, style guide, and now the
  indexer). Worth writing a comment in `metrics.ts` pointing at the other two.

## Done means
- [ ] `FileEntry` carries the file's zone, derived from its path
- [ ] `scoreMetrics` applies per-zone weights; Root is not penalised for mutation, Test is not
      penalised for `throw` or statement density
- [ ] No test file and no `main.ts`/`server.ts`/`io.ts` sits in the bottom decile of the repo's
      score distribution purely on zone-exempt rules
- [ ] The browser shows which zone a file was scored under
