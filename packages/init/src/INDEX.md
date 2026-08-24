# packages/init/src

Implements `platonic init`, a retrofitter that scans a target repository for existing
config, plans what installing this repo's strictness gates would change, and applies that
plan only on explicit confirmation — a file the target already has is merged or installed
alongside, never overwritten.

| File | Purpose |
|---|---|
| `args.ts` | Parses `platonic init` CLI arguments into a `ParsedArgs` value — target directory, `StrictnessProfile`, and a `dryRun` flag that is true unless `--yes` is present — kept pure so the "nothing is written without `--yes`" rule is testable without a filesystem. |
| `format.ts` | Renders an `InitPlan` and an `ApplyReport` as the exact text an operator reads before and after approving a retrofit: one line per action or outcome, plus manual steps. |
| `index.ts` | The pure planning core: given a `TargetSnapshot` of what a repository already has, decides what to write, what to merge key-by-key, and what to leave as a manual step — package.json scripts and dependencies, tsconfig strictness flags, an ESLint config (sidecar-named when one exists), and a ratchet baseline. |
| `io.ts` | The impure edges of `platonic init` — walks a target's TypeScript sources to count escape hatches, reads its config files into a `TargetSnapshot`, and applies an `InitPlan` to disk (or reports what it would do, in dry-run mode) without ever overwriting a file that appeared since the plan was made. |
| `main.ts` | CLI entry (`npx tsx packages/init/src/main.ts <targetDir> ...`) — snapshots the target, computes and prints the plan, applies it, and always prints the plan before anything happens. |
| `templates` | Source text for the configuration files a retrofit can install (ESLint, package.json, tsconfig), one module per file family — see `templates/INDEX.md`. |
