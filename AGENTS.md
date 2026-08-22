# Agent orientation — platonic-ts

Read in this order: this file, `CONTRACTS.md` (fences + seams), `docs/style-guide.md` (how to
write the code — rule IDs `PS-nnn`), `NOTES.md` (findings — append yours).

## Run + verify (before AND after changing anything)

```
npm run typecheck   # tsc --noEmit, strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes + noImplicitReturns
npm run test        # vitest run, all packages
npm run check       # both; the only definition of green
npm run dashboard   # observability server on http://localhost:4747
```

## Map

| Where | What |
|---|---|
| `packages/core` | Shared types + pure helpers. Supervisor-owned contract — change carefully. |
| `packages/transcripts` | Parse/tail Claude Code transcript JSONL into `AgentActivity`; usage aggregation. |
| `packages/backlog` | Parse/render/load backlog markdown items in `backlog/`. |
| `packages/dashboard` | HTTP + SSE server and single-page UI; composition in `src/main.ts`. Agent observability only — transcripts, usage, backlog, docs. Source browsing, symbol navigation, and code metrics/quality scoring are out of scope and belong to a separate app; do not add them here (see `docs/tools-and-process.md`). |
| `backlog/` | One markdown file per work item (format in CONTRACTS.md). |
| `docs/` | Design notes; the dashboard lists them. |

## Conventions

Commit to `main` with pathspec (`git commit -- <paths>`); push only after a verified
milestone (`git pull --rebase` first — parallel agents collide). No branches, no worktrees.
Pure functional style, zero runtime deps, relative imports across packages.
Full rules in [docs/style-guide.md](docs/style-guide.md); breaking one requires PS-056.
