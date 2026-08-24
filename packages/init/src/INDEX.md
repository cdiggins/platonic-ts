# packages/init/src

Implements `platonic init`, a retrofitter that scans a target repository for existing
config, plans what installing this repo's strictness gates would change, and applies that
plan only on explicit confirmation — a file the target already has is merged or installed
alongside, never overwritten.

<!-- BEGIN GENERATED: src-index (npm run docs:regen) -->
| File | Purpose |
|---|---|
| `args.ts` | Command-line argument parsing for `platonic init`, pure so the safety rule — nothing is written unless `--yes` is present — is testable without a filesystem. |
| `format.ts` | Rendering an init plan as text. Kept pure and separate from the CLI so the exact wording an operator reads before approving a retrofit is testable. |
| `index.ts` | Pure planning core for `platonic init`: given a description of what already exists in a target repository, decide what a retrofit would install. |
| `io.ts` | Impure edges of `platonic init`: read the target repository into a snapshot, and apply a plan to disk. Everything that decides *what* to do lives in index.ts; this file only looks and writes. |
| `main.ts` | Composition root / CLI entry for `platonic init`: npx tsx packages/init/src/main.ts <targetDir> [--profile observe\|standard\|full] [--dry-run] [--yes] |
| `templates/` | Source text for the configuration files a retrofit can install — ESLint config, `package.json` entries, and `tsconfig.json` compiler options — one module per file family, each parameterized by `StrictnessProfile` so `observe` never proposes a runnable script or a compiler gate. |
<!-- END GENERATED -->
