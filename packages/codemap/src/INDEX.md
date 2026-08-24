# packages/codemap/src

Builds and maintains a `CodeIndex` over this repository's own TypeScript and markdown —
symbols, references, and quality metrics — and, on top of that index, finds expressions that
repeat under different names and turns one group of them into an extracted function plus a
call at every site.

<!-- BEGIN GENERATED: src-index (npm run docs:regen) -->
| File | Purpose |
|---|---|
| `clones.ts` | Finding expressions that repeat up to renaming, across a set of files. `shapes.ts` decides when two expressions have the same shape; this module asks the repository-scale question built on top of it: which shapes occur more than once, and where. |
| `edits.ts` | Text ranges and what it means to apply them. A refactoring in this package is data — a list of ranges and their replacements — and this module is the only place that turns that data back into a string. Nothing here reads or writes a file: the caller supplies the text it wants edited, which is what makes a rewrite testable and a preview identical to the thing that would be written. |
| `extract.ts` | Turning a group of same-shaped expressions into one declaration and a call at each site. |
| `holes.ts` | Deciding which of a shape's holes become parameters, and what to call them. |
| `incremental.ts` | Pure rules for reusing a code index across rebuilds: what a change to a file invalidates, and how the facts that survive merge with freshly computed ones. The IO that produces the fresh facts lives in io.ts. |
| `index.ts` | Barrel for the code index. Supervisor-owned: one level of re-export (PS-023). |
| `io.ts` | IO edge for the code index: creates the program and walks the repo. |
| `main.ts` | Composition root / CLI entry for this package's two reports over the repository's own code: `npm run stats` and `npm run clones`. |
| `metrics.ts` | Pure quality metrics and the platonic score. |
| `placement.ts` | Where an extracted declaration goes, and what has to be true once it is there. |
| `report.ts` | Rendering this package's reports as fixed-width text. Presentation only: the numbers are decided in `stats.ts` and `clones.ts`, and this module never computes one. |
| `rewrite.ts` | Building the text a rewrite inserts. Every function here takes strings and returns strings: it decides how the new code is spelled, never what it should be. `extract.ts` makes those decisions and calls in here for the spelling. |
| `scope.ts` | Where a name would come from, seen from one position in one file. |
| `shapes.ts` | The shape of an expression: what is left of it once every name has been replaced by a position. Two expressions have the same shape when one can be turned into the other by renaming, which is the precondition for replacing both with one call to one function. |
| `sites.ts` | One occurrence of a shape, found again in its own file. |
| `stats.ts` | Size distributions over the repository's own code (BL-0027). |
| `summary.ts` | Order statistics for a population of numbers. Deliberately domain-free: nothing here knows what a function or an AST node is, which is what lets the same summariser describe function lengths today and any other measured population later. |
| `symbols.ts` | Pure symbol extraction and reference resolution over a TypeScript program. |
| `walk.ts` | Walking the TypeScript AST. Every other module in this package that needs to see nodes rather than types goes through here, so there is one definition of "the children of a node" and one definition of "the subtree under a node". |
| `watch.ts` | Noticing that the repository changed, by the two means available: the operating system's file-change notifications, and a scan of modification times for callers that cannot use them. Neither decides what to do about a change — that is io.ts, which re-reads whatever is named here. |
<!-- END GENERATED -->
