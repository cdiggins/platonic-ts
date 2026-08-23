# Agent orientation — platonic-ts

Read in this order: this file, `CONTRACTS.md` (fences + seams), `docs/style-guide.md` (how to
write the code — rule IDs `PS-nnn`), `NOTES.md` (findings — append yours).

## Run + verify (before AND after changing anything)

```
npm run typecheck   # tsc --noEmit, strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes + noImplicitReturns
npm run test        # vitest run, all packages
npm run check       # both; the only definition of green
npm run dashboard   # observability server on http://localhost:4747
npm run mcp         # MCP server on stdio; registered for this repo in .mcp.json
npm run stats       # size distributions of this repo's functions, statements, expressions
```

## Map

| Where | What |
|---|---|
| `packages/core` | Shared types + pure helpers. Supervisor-owned contract — change carefully. |
| `packages/transcripts` | Parse/tail Claude Code transcript JSONL into `AgentActivity`; usage aggregation. |
| `packages/backlog` | Parse/render/load backlog markdown items in `backlog/`. |
| `packages/codemap` | Builds a `CodeIndex` of the repo: symbols, references, quality metrics. Pure; IO in `src/io.ts`; change detection in `src/watch.ts`. `openSession`/`updateSession` rebuild only what changed. `npm run stats` reports size distributions by zone. |
| `packages/codeview` | Code overview browser (BL-0016) on port 4848 — source, navigation, metrics, readmes, feedback box. |
| `packages/dashboard` | HTTP + SSE server and single-page UI; composition in `src/main.ts`. Agent observability only — transcripts, usage, backlog, docs. Source browsing, symbol navigation, and code metrics/quality scoring are out of scope and belong to a separate app; do not add them here (see `docs/tools-and-process.md`). |
| `packages/mcp` | MCP server (BL-0026) over the code index: outlines, one declaration at a time, type-checked references, rename, name-addressed editing, and the check gate. Prefer these over reading whole files, grepping, and text-matching edits — see `docs/mcp-server-2026-08-23.md`. |
| `backlog/` | One markdown file per work item (format in CONTRACTS.md). |
| `docs/` | Design notes; the dashboard lists them. |

## Conventions

Commit to `main` with pathspec (`git commit -- <paths>`); push only after a verified
milestone (`git pull --rebase` first — parallel agents collide). No branches, no worktrees.
Pure functional style, zero runtime deps, relative imports across packages.
Full rules in [docs/style-guide.md](docs/style-guide.md); breaking one requires PS-056.

## Prose style (docs, summaries, reports)

Write for an experienced developer, but strip jargon and shorthand: prefer standard
vocabulary over coined terms ("lock" not "fence", "authoritative check" not "sacred");
when a project-specific term must appear, define it in a plain clause on first use.
One idea per sentence; no nested parentheticals doing the real work. Worked example:
version #11 in [docs/summary-style-explorations-2026-08-23.md](docs/summary-style-explorations-2026-08-23.md).
