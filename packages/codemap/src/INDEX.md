# packages/codemap/src

Builds and maintains a `CodeIndex` over this repository's own TypeScript and markdown —
symbols, references, and quality metrics — and, on top of that index, finds expressions that
repeat under different names and turns one group of them into an extracted function plus a
call at every site.

| File | Purpose |
|---|---|
| `clones.ts` | Groups same-shaped expressions (via `shapes.ts`) across a set of files into `ShapeGroup`s, filtered by minimum size and with subsumed groups (whose occurrences a larger group already covers) dropped — the candidate list an extraction step works from. |
| `edits.ts` | Turns a list of `TextEdit` ranges into the resulting string (`spliceText`/`applyEdits`), refusing overlapping or out-of-range edits rather than corrupting text; the only place a refactoring plan is turned back into source. |
| `extract.ts` | Assembles one `ExtractionPlan` — declaration text, its destination, and the edit at every call site — from a `ShapeGroup`, `holes.ts`'s parameter split, and `sites.ts`'s safety check; chooses between a shared value and a shared function form. |
| `holes.ts` | Decides which free names in a shape become parameters of the extracted function versus names the body can keep reading directly (ambient: same spelling and resolves above the expression everywhere), and picks non-colliding parameter names. |
| `incremental.ts` | Pure rules for reusing a `CodeIndex` across rebuilds: which files a change invalidates (including files that only referenced a changed one), and how surviving facts merge with freshly computed ones into a new index. |
| `index.ts` | Barrel for the code index package: one level of re-export over symbols, io, watch, metrics, walk, stats, clones, edits, scope, sites, holes, rewrite, extract, and placement. |
| `io.ts` | IO edge that builds the TypeScript compiler program and walks the repo into a `CodeIndex`; `openSession`/`updateSession` reuse the previous program's parsed source files so a rebuild after one edit costs milliseconds instead of a full re-parse. |
| `main.ts` | CLI entry for `npm run stats` and `npm run clones`, including `clones -- --extract N` (print what extracting group N would do) and `--write` (apply the plan to disk, all files or none). |
| `metrics.ts` | Computes the `platonicScore` and its component counts (escape hatches, nesting, statement density, export surface, etc.) for a file, a function, or a folder rollup, per the weighted-penalty formula this module defines and documents. |
| `placement.ts` | Decides whether an extraction plan's declaration can actually land at its destination — name collisions, import cycles, types or names the destination file would be missing — and builds the declaration and import edits once it can. |
| `report.ts` | Renders this package's two reports (size distributions, repeated-expression groups) and an extraction plan as fixed-width text; computes nothing itself. |
| `rewrite.ts` | Pure string-building for the code an extraction inserts: the declaration form (arrow function or value), the call that replaces each occurrence, de-indenting a lifted expression's later lines, and computing relative import specifiers. |
| `scope.ts` | Classifies where a name used inside an expression would resolve from — locally bound, module-level, a known global, or unknown — which is what separates a name the extracted code can keep reading from one it must receive as a parameter. |
| `shapes.ts` | Normalizes an expression (or any AST node) into a shape key that is equal for two nodes exactly when one becomes the other by renaming, tracking bound names by de Bruijn index and free names by first-use position; the comparison primitive `clones.ts` groups on. |
| `sites.ts` | Resolves one `ExpressionOccurrence` back into its live AST node, scope, and free-name references, and flags reasons (`this`, `super`, yield, assignment to a free name) that would make moving that expression change what it means. |
| `stats.ts` | Collects per-function, per-statement, and per-expression size observations from `FileEntry`/`SourceEntry` data, partitioned into core/root/test zones, feeding `summary.ts`'s percentile summaries for `npm run stats`. |
| `summary.ts` | Domain-free order-statistics summarizer (min/mean/percentiles) over a population of numbers, using nearest-rank percentiles so every reported value is one some population member actually has. |
| `symbols.ts` | Walks a `ts.SourceFile` to extract every browsable declaration as a `SymbolInfo` (name, kind, signature, doc line, export status) and, given a type checker, resolves every identifier to the `SymbolId` of its declaration as a `SymbolReference`. |
| `walk.ts` | The one definition of "children of a node" and "subtree under a node" that every other module in this package uses instead of calling the compiler's AST traversal directly, plus a bottom-up subtree-size computation. |
| `watch.ts` | Notices that the repository changed, by OS file-change notifications (`watchRepo`) or by a modification-time scan (`scanTimestamps`) for callers that cannot use the former; decides nothing about what to do with a change. |
