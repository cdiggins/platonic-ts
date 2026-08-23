---
id: BL-0028
title: Split metrics.ts, which is over the PS-024 file budget
type: debt
status: ready
priority: p3
effort: S
risk: low
area: codemap
sprint:
created: 2026-08-23
closed:
links: [BL-0027, BL-0017, docs/style-guide.md]
---

## Problem
`packages/codemap/src/metrics.ts` is 331 lines against PS-024's 300-line budget. The file's
own `file-length` penalty therefore fires on the file that defines it.

## Impact
Low but self-undermining: the module that measures conformance does not conform, and the
number it reports for itself is one it caused. It is also the file BL-0017 has to change next,
and a file already over budget is the more expensive place to add zone handling.

## Affected code
- [packages/codemap/src/metrics.ts](../packages/codemap/src/metrics.ts) — three concerns in
  one file: the penalty table and score, per-file and per-function measurement, and the folder
  rollup at the bottom.

## Root cause
Growth, not design. The AST walk already moved out to `walk.ts` during BL-0027, which took the
file from 336 lines to 331 — enough to show the split direction, not enough to get under the
budget.

## Fix approaches
- Move the folder rollup (`ancestorFolders`, `isWithin`, `definedMetrics`, `folderMetrics`,
  about 35 lines) into `packages/codemap/src/folders.ts`. Its concern is aggregating over a
  directory tree, not measuring code, and nothing else in `metrics.ts` calls it.
- Or split per-function measurement (`functionSiteOf` through `functionMetrics`, about 80
  lines) into `functions.ts`. A larger move, and the better one if BL-0017 ends up needing
  zone-aware function scoring.
- Either way `packages/codemap/src/index.ts` re-exports from the new module, so no caller
  outside the package changes.

## Done means
- [ ] Every file in `packages/codemap/src` is under 300 lines
- [ ] `npm run check` green, no new escape hatches
- [ ] No change to any number `scoreMetrics` or `sizeReport` produces

## Simplest fix
Move the folder rollup to `folders.ts` and re-export it from the package barrel. About 35
lines relocated, no logic touched.
