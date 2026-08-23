---
id: BL-0016
title: Build a code overview browser separate from the observability dashboard
type: feature
status: in-progress
priority: p2
effort: L
risk: med
area: repo
sprint:
created: 2026-08-22
closed:
links: [BL-0006, BL-0011, decisions/2026-08-22-code-index-backend.md, docs/tooling-catalog.md, docs/claude-code-integration-2026-08-22.md, docs/tools-and-process.md]
---

## Idea
A second local web app — separate from `packages/dashboard` — for reading the repo's own
TypeScript. It shows the folder/file/symbol structure, renders syntax-colored source,
supports click-to-navigate from a symbol to its definition and to its references, renders
markdown files (readmes, `docs/`) as formatted prose, displays platonic-quality metrics at
function, file, and folder granularity, and offers a box for typing feedback aimed at Claude.
Interpretation of two ambiguous points: (1) "platonic quality" means the measurable dimensions
BL-0011 is already trying to pin down (purity signals, complexity, size/coupling proxies) —
this item consumes those scores rather than redefining them; (2) this is explicitly *not* an
addition to the observability dashboard, whose scope boundary was just documented in
[docs/tools-and-process.md](../docs/tools-and-process.md) — that dashboard covers agent
activity and logged work, this one covers source code.

A VS Code extension was considered and rejected. It solves the browsing third of the request
for free but turns the metrics and feedback surfaces into a webview — the same HTML work,
inside a slower build-and-reload loop, unshareable, and coupled to one editor.

## Assumptions
- The structural questions (definition, references, outline) need real type information, not
  regex. Whatever backend is chosen must be program-aware.
- Metrics are worth displaying only if they are computed once and shared — a browser that
  invents its own scoring formula immediately diverges from `platonic check`.
- The feedback box is worth building only if something downstream actually reads it. Today
  that "something" is the `backlog/` directory plus the `track-idea`/`track-backlog` skills,
  which already form a working intake path.
- The repo's zero-runtime-dependency posture (see `packages/dashboard/src/server.ts`, which
  uses `node:http` only) applies here too, at least for the server. Syntax coloring can come
  from `ts.createScanner`, which is already a dev dependency via `typescript`.
- Nobody needs this hosted or multi-user. Local, single-user, read-mostly.

## Design decisions
- **Navigation backend — `tsserver` vs a compiler-API index vs `scip-typescript`.**
  [docs/claude-code-integration-2026-08-22.md](../docs/claude-code-integration-2026-08-22.md)
  already names `tsserver` as the intended navigation source ("Definition, references, rename,
  quick-info via `tsserver`"), and [docs/tooling-catalog.md:158](../docs/tooling-catalog.md)
  argues wrapping it is cheaper than building navigation. A hand-built compiler-API index gives
  full control over what is stored and lets metrics ride along in the same pass, but rebuilds
  something that already exists. `scip-typescript` (tooling-catalog.md:160) gives a persisted
  whole-repo cross-reference, better for "who references this across everything" and staler by
  construction. This is the decision that most changes the shape of the work.
- **Index as its own package vs baked into the app.** A `packages/codemap` exposing
  `buildIndex(tsconfig) -> CodeIndex` as a pure function is testable and can later feed an MCP
  server, so the human browser and the agent answer the same questions from the same data. Baking
  it into the app is fewer files now and forecloses that.
- **Who computes the metrics.** Reuse BL-0011's per-unit scores versus computing a second,
  browser-local set. Reusing means this item is blocked on BL-0011 producing per-file/per-function
  attribution; computing separately means two formulas that will disagree.
- **Feedback delivery — file append vs `claude -p` vs MCP.** Appending a WorkQuarry item to
  `backlog/` costs no process, no auth, and no concurrency handling, but is not immediate.
  Spawning `claude -p` gets a real agent that can edit and verify, at the cost of a fresh context
  per invocation, a permission-mode decision on text arriving from a web form, and two concurrent
  invocations colliding on one working tree (the no-worktrees stance in
  [docs/worktrees-and-branches-for-agents-2026-08-22.md](../docs/worktrees-and-branches-for-agents-2026-08-22.md)
  makes that collision likelier). MCP cannot serve this direction at all — an MCP server answers a
  running agent, it cannot start work.
- **Index freshness.** Rebuild on file watch, rebuild on request, or explicit reload endpoint.
  Watch is nicest and is the most moving parts.

## Decisions taken (2026-08-22, wave 3)
- Backend: TypeScript compiler API, not `tsserver` or `scip-typescript` —
  [ADR](../decisions/2026-08-22-code-index-backend.md).
- Index in its own package `packages/codemap`, behind `indexRepo(repoDir, now): Promise<CodeIndex>`.
- Metrics computed in `codemap`, reusing `countEscapeHatches` from `packages/check`.
- Feedback writes a `backlog/` item; no `claude -p`, no MCP, for now.
- Freshness: rebuild on demand with a 5s TTL; no file watching.
- Browser serves on port 4848; the observability dashboard keeps 4747.

## Related
- [BL-0011](BL-0011-conformance-score.md) — supplies the metrics this browser renders. **Conflict resolved 2026-08-22:** BL-0011's long-term approaches say "feed scores into the dashboard as a
  per-file/per-package heatmap", which the documented dashboard boundary forbids. That bullet now
  points at this item instead.
- [BL-0006](BL-0006-dashboard.md) — the observability dashboard. Not a parent; the deliberate
  contrast. Its `packages/dashboard/src/server.ts` (`node:http` + SSE, injected `SnapshotProvider`)
  is the pattern to copy, not the app to extend.
- [BL-0001](BL-0001-platonic-check.md) — `packages/check/src/scan.ts` already counts the escape
  hatches that are the crudest available quality signal; the browser can display those before
  BL-0011 lands anything finer.
- [docs/claude-code-integration-2026-08-22.md](../docs/claude-code-integration-2026-08-22.md) —
  section 3 already specifies a Navigation tool in the planned MCP server. If the index here is
  reusable, that tool is a consumer of it rather than separate work.
- [docs/tooling-catalog.md](../docs/tooling-catalog.md) — section 9 (navigation and code
  intelligence) is the buy-side menu for the backend decision; `knip` there is also a ready-made
  unused-export signal worth showing per file.
- [docs/tools-and-process.md](../docs/tools-and-process.md#scope-what-the-dashboard-is-not) — the
  boundary this item exists on the far side of.

## Approaches
Short term:
- Structure and readability first, no navigation: a static tree of files with syntax-colored
  source via `ts.createScanner` and rendered markdown. Proves the reading experience is worth
  having before any index exists.
- Per-file escape-hatch counts from `packages/check/src/scan.ts` displayed alongside each file —
  the only quality signal that already exists today.
- Feedback box writing a `backlog/` item, reusing the schema in `packages/core/src/index.ts`.

Long term:
- `packages/codemap` producing a queryable index, with the browser and an MCP Navigation tool as
  two consumers of one index.
- Folder-level rollups so the tree itself is the heatmap.
- Doc-drift signal: markdown that names symbols no longer present (H8).

Adjacent ideas worth their own item:
- Adopting `knip` for unused files/exports as a ratchet — a standalone tooling decision.
- A `claude -p` invocation seam (timeout, permission mode, single-flight lock) usable by any local
  tool, not just this one.

## Bedrock
The seam is `packages/codemap`'s `buildIndex(tsconfig) -> CodeIndex` boundary: a pure function from
a program to a serializable structure, with every consumer — HTTP handler, MCP tool, CLI — reading
the structure rather than the compiler. That boundary is what makes the navigation-backend decision
above reversible: swapping `tsserver` for a compiler-API walk or a SCIP index becomes one
implementation change behind an unchanged type. It also gives the planned MCP Navigation tool
(claude-code-integration doc, section 3) something to be built on instead of built from scratch.
Verdict: **simplest-along-the-grain** — the first version may skip the index entirely and render
colored text with per-file counts, but it must not put symbol resolution, metric computation, or
compiler access inside the HTTP handlers, or the second consumer becomes a rewrite.

## Done means
- [ ] A command starts a local server on its own port, distinct from the dashboard's 4747
- [ ] The tree lists every TypeScript file under `packages/`, and clicking one shows
      syntax-colored source
- [ ] Clicking a symbol navigates to its definition; a references view lists its use sites
- [ ] Each file shows at least one quality metric, computed by code shared with `platonic check`
      rather than duplicated
- [ ] Markdown files render as formatted prose
- [ ] Feedback typed in the browser lands somewhere an agent reads without a human relaying it

## Simplest possible implementation
Copy the `node:http` server shape from `packages/dashboard/src/server.ts` into a new
`packages/codeview`. One route serves a file tree built by walking `packages/`; one route serves a
file, colored by wrapping `ts.createScanner` token kinds in spans, or rendered as markdown when the
extension is `.md`; one route accepts a POST of feedback text and appends a `backlog/BL-XXXX` file.
No index, no symbol resolution, no compiler program — links between files only, and per-file
escape-hatch counts read from `packages/check/src/scan.ts`.

- Gets: the reading and feedback halves of the request working in a day, on existing code, with
  zero new dependencies, and honest metrics rather than invented ones.
- Gives up: the navigation half entirely — no go-to-definition, no references, no symbol search —
  which is the part a VS Code extension would have given for free, and the part most likely to
  determine whether this tool gets used.
