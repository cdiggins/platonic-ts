# packages/check/src

Implements `platonic check`, the pipeline that runs typecheck, lint, ratchet, tests, and
backlog-id validation in order and stops at the first failure — the repo's only definition
of green.

| File | Purpose |
|---|---|
| `index.ts` | Barrel re-exporting the package's types and functions (`countEscapeHatches`, `runCheck`, `checkIndexFolders`, etc.) for callers outside `packages/check`. |
| `indexScan.ts` | IO: finds every `packages/*/src` folder and, recursively, every subfolder of one that holds `.ts` source files, and reads each folder's file listing and `INDEX.md` content into a `FolderCheck` for `indexTable.ts` to validate. |
| `indexTable.ts` | Pure INDEX.md completeness check (BL-0032): parses an INDEX.md's file table and flags a folder whose index is missing, missing an entry for a real file, listing a ghost entry, or listing an entry with an empty description. |
| `main.ts` | CLI entry (`npx tsx packages/check/src/main.ts`) — runs `runCheck` against the repo root and `ratchet.json`, prints one pass/fail line per step, and sets the process exit code. |
| `ratchet.ts` | Pure escape-hatch counting via the TypeScript compiler API: tallies `any`, `as` casts (excluding `as const`), non-null assertions, `@ts-*`/`eslint-disable` comments, and undocumented exported declarations per file, and compares a count against a baseline to classify it as ok/improved/regressed. |
| `run.ts` | Orchestrates the six check steps as subprocesses (typecheck, lint, tests, backlog validate) plus the in-process ratchet and INDEX.md-completeness steps, summarizes each step's output to one line, and stops the run at the first failing step. |
| `scan.ts` | IO: walks every `packages/*/src` and `packages/*/test` folder for `.ts` files and sums their escape-hatch counts via `ratchet.ts`, producing the current `RatchetCounts` the ratchet step compares to baseline. |
