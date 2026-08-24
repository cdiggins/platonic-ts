# packages/check/src

Implements `platonic check`, the pipeline that runs typecheck, lint, ratchet, tests, and
backlog-id validation in order and stops at the first failure — the repo's only definition
of green.

<!-- BEGIN GENERATED: src-index (npm run docs:regen) -->
| File | Purpose |
|---|---|
| `boundary.ts` | Pure import-boundary check: flags import specifiers in one package's files that resolve into a package it must not depend on. IO (walking a rule's `from` directory) lives in boundaryScan.ts. |
| `boundaryScan.ts` | IO: reads the source files each forbidden-edge rule applies to — every `.ts` file under a rule's `from` directory (repo-relative, forward slashes) — for boundary.ts to validate. |
| `index.ts` | Barrel: the escape-hatch counting, check-run, and import-boundary surface this package offers callers outside `packages/check`. |
| `main.ts` | Composition root / CLI entry for `platonic check`. Run with: npx tsx packages/check/src/main.ts |
| `ratchet.ts` | Pure escape-hatch counting via the TypeScript compiler API. |
| `run.ts` | The `platonic check` runner: typecheck -> lint -> ratchet -> tests -> backlog ids -> import boundaries -> generated doc blocks, stopping at the first failure. |
| `scan.ts` | IO: collect *.ts files under packages/*/src and packages/*/test, recursively, skipping node_modules, and sum their escape-hatch counts. |
<!-- END GENERATED -->
