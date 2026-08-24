# packages/mcp/src

Implements the MCP server (BL-0026): a JSON-RPC-over-stdio process that exposes the code
index as 33 tools — outlines, declarations, type-checked references, inferred types,
diagnostics, dependency analyses, name-addressed editing, move/rename/signature
transformations, checkpoint and revert, and the repository's own check gate. Every write
tool computes an `EditPlan` before touching disk, so it can be previewed, combined with
others into one all-or-nothing batch, or declined outright when a change cannot be made
safely.

<!-- BEGIN GENERATED: src-index (npm run docs:regen) -->
| File | Purpose |
|---|---|
| `batch.ts` | Several symbol-addressed edits that are only correct together, applied all or nothing. Combining is pure: the check that the edits do not fight each other happens before anything is written, so a batch that cannot be applied cleanly is refused rather than half-run. |
| `checkpoint.ts` | Mark a point, then undo everything since. A snapshot is the exact text of a set of files at one moment; restoring is a whole-file replacement per changed file, computed as a plan so the caller can see it before anything is written. |
| `compiler.ts` | The bound half of the workspace: a TypeScript program and language service over the same texts the index was built from. Tools that need inferred types, diagnostics, or the compiler's own edit computations take this; tools that only need shapes keep taking a Workspace, which costs no binding. |
| `declaration.ts` | Where one declaration begins and ends in its file, including the comment written above it. This is the unit the editing tools address: naming a declaration is unambiguous where a text match is not. |
| `diagnostics.ts` | The compiler's own opinion of the code, scoped to named files: errors, the quick fixes it offers for them, and import tidying. |
| `dispatch.ts` | One tool call to one answer. Everything above this is protocol and everything below it is pure, so this is the only place that knows both which tools exist and how to reach the disk. |
| `edit.ts` | Editing by name rather than by matching surrounding text. A plan is a list of byte ranges and their replacements; computing it is pure, applying it is not, which is what makes the interesting part testable. |
| `graph.ts` | Structure between declarations and between files: who implements what, which modules import which, and which exports nobody outside their own file wants. |
| `index.ts` | Barrel for the MCP server's pure surface. One level of re-export (PS-023). |
| `inspect.ts` | The tools that measure rather than change: how bad is this declaration, and where are the escape hatches. Both pure over `Workspace`. |
| `io.ts` | The IO edge: holds the repository open, rebuilds only what changed since the last call, and writes edit plans back to disk. |
| `main.ts` | Entry point for the MCP server. Run with: npx tsx packages/mcp/src/main.ts |
| `move.ts` | Moving code between files. Renaming a file rewrites every import specifier that pointed at it; moving one declaration decides what that declaration needs in its new home, what its old home no longer needs, and whether the two files end up importing each other. Neither creates or deletes a file, because a plan can only rewrite contents: `renameFile` leaves the filesystem move to its caller, and `moveSymbol` declines when the target file is not there yet. |
| `options.ts` | What every tool call is given besides its own arguments: where the repository is, where the ratchet baseline lives, and what time it is. The clock is a value rather than something a tool may read (PS-045). |
| `plan.ts` | One write tool, one edit plan. Nothing here writes: a plan is a value, which is what lets `batch_edit` ask for several and combine them before any of them reaches the disk, and what lets `preview` render one instead of applying it. |
| `preview.ts` | Seeing an edit before running it. The line diff is written here rather than taken from a package because this repository has no runtime dependencies: a longest-common-subsequence over lines, with the common prefix and suffix trimmed off first, is short and is exact on the cases a plan produces. The walk is recursive and builds its result by spreading, which is quadratic in the size of the changed region — fine for one file's worth of edits, and the reason the prefix/suffix trim happens first. |
| `protocol.ts` | JSON-RPC 2.0 over newline-delimited JSON: the framing the Model Context Protocol uses on a stdio transport. Pure — text in, values out. Dispatch and the transport itself live in server.ts. |
| `query.ts` | The read-only tools. Each returns finished text: the output is the product, and it is written to be read by an agent, so it is dense — one line per fact, no framing prose, locations in `file:line` form so they stay clickable. |
| `reach.ts` | What sits above a declaration: who calls it, which tests reach it, and both at once. `usages` answers "where is this mentioned"; these answer "what breaks if I change it". |
| `refactor.ts` | The escape hatch. The specific tools cover the transformations worth naming; the compiler ships dozens more, and this exposes them addressed by declaration name rather than by character offset. Two calls, not one: the caller lists what applies to a declaration, then applies one by name. |
| `rename.ts` | Type-checker-accurate rename. Every occurrence comes from the index's resolved references, so a same-named stranger in another file is never touched and an aliased import is never missed. |
| `review.ts` | Reviewing a change rather than making one: is this declaration safe to remove, and what actually changed since a known-good snapshot. Both answer in declarations, not in lines — a refactoring read as a line diff is a large deletion beside a large addition with nothing saying they are the same thing. |
| `schema.ts` | The vocabulary the tool catalogue is written in, and the readers that take a call's arguments back out. Separate from the catalogue itself so the catalogue can be split across files without any of them importing each other. |
| `server.ts` | Composition of the tools onto the wire: one request in, one line of JSON out. Nothing here decides anything a pure module could decide; dispatch owns the tools and this owns the protocol. |
| `signature.ts` | Changing a function's parameter list and every call site with it. The mapping from old arguments to new ones is not derivable in general, so the caller states it: an entry of the form `$0`, `$1`, … copies the existing argument at that index verbatim, and anything else is literal source text inserted at that position. Adding a parameter with a default is `arguments: ['$0', '1']`; removing the second is `['$0']`; swapping two is `['$1', '$0']`. |
| `tools.ts` | The catalogue the server advertises, in the order a caller meets it: find something, ask the compiler about it, analyse what depends on it, change it, undo the change. |
| `toolsRead.ts` | The catalogue entries for the tools that only answer questions. A description is the whole of what an agent knows when it picks a tool, so each one says what the tool replaces, what it costs, and — where it matters most — what it cannot see. |
| `toolsWrite.ts` | The catalogue entries for the tools that change files. Every one of them takes `preview`, and every one of them refuses rather than guessing — the descriptions say which cases it refuses on, because a caller who knows that asks differently. |
| `types.ts` | What the checker knows, printed for a reader. An outline shows what a file declares; these two answer what a declaration *is* — the inferred type, the call signatures behind it, and the whole member surface including the parts that arrive by extension. Nothing here truncates: a type printed as `...` is the one case where the answer is worse than no answer. |
| `workspace.ts` | What every tool reads: the code index plus the parsed files it was built from. Symbol lookup lives here because "which declaration did you mean" is the one question every tool asks first. |
<!-- END GENERATED -->
