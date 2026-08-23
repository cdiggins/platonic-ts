# Build the code index on the TypeScript compiler API, not tsserver

Date: 2026-08-22
Status: accepted
Context: BL-0016 (code overview browser)

## Context

BL-0016 needs go-to-definition and find-references over the repo's own TypeScript, plus
per-function and per-file quality metrics. Three backends were on the table:

1. **`tsserver`** — the daemon behind every TypeScript editor. Already exists, already speaks
   definition/references/quick-info. `docs/tooling-catalog.md` section 9 recommends wrapping it
   over building navigation, and `docs/claude-code-integration-2026-08-22.md` section 3 already
   names it as the intended navigation source for the planned MCP server.
2. **The TypeScript compiler API** — `ts.createProgram` plus a `TypeChecker`, walked once to
   produce a serializable index.
3. **`scip-typescript`** — emits a persisted SCIP cross-reference index.

## Decision

Use the compiler API (option 2), behind `indexRepo(repoDir, now): Promise<CodeIndex>` in
`packages/codemap`.

## Why

- **The metrics walk is unavoidable.** Nesting depth, statement counts, mutable bindings, and
  parameter counts are not tsserver queries; they require walking the AST ourselves. Having
  taken that walk, the incremental cost of also recording declarations and identifier
  resolutions is small. Choosing tsserver means running *both* a daemon and an AST walk.
- **Purity.** `tsserver` is a stateful process reached over a request/response protocol. Wrapping
  it puts a live daemon at the bottom of the dependency graph, and every consumer becomes async
  and order-dependent. A pure `Program -> CodeIndex` function is testable with a synthetic
  source file and no process at all, which is what `docs/style-guide.md`'s Core zone asks for.
- **One serializable artifact.** The browser, a future MCP navigation tool, and a future CLI all
  want the same answers. A plain JSON `CodeIndex` serves all three; a daemon serves only callers
  willing to speak its protocol.
- **`scip-typescript` was rejected** on dependency weight: it introduces an external toolchain
  and an index format to parse, for cross-repo scale this project does not have.

## Cost of being wrong

The tooling catalogue's argument is real: we are writing navigation code that already exists,
and ours will be worse at the edges (re-exports, declaration merging, JSX, `.d.ts`). The
mitigation is the `indexRepo` boundary itself — every consumer reads `CodeIndex`, so replacing
the implementation with a tsserver client is one file, not a rewrite. Revisit if reference
accuracy on re-exported symbols proves unacceptable, or if the walk exceeds a few seconds on
this repo.

## Consequences

- `packages/codemap` depends on `typescript` (already a dev dependency; used the same way by
  `packages/check/src/ratchet.ts`).
- Escape-hatch counts are reused from `countEscapeHatches` rather than recomputed, so the
  browser and `platonic check` cannot disagree.
- The index is rebuilt on demand with a short TTL rather than watched; freshness is a follow-up.
