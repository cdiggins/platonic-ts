# Agent orientation — platonic-ts

Read in this order: this file, `CONTRACTS.md` (fences + seams), `NOTES.md` (findings — append yours).

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
| `packages/dashboard` | HTTP + SSE server and single-page UI; composition in `src/main.ts`. |
| `backlog/` | One markdown file per work item (format in CONTRACTS.md). |
| `docs/` | Design notes; the dashboard lists them. |

## Conventions

Commit to `main` with pathspec (`git commit -- <paths>`); push only after a verified
milestone (`git pull --rebase` first — parallel agents collide). No branches, no worktrees.
Pure functional style, zero runtime deps, relative imports across packages.
