# packages/init/src/templates

Source text for the configuration files a retrofit can install — ESLint config, `package.json`
entries, and `tsconfig.json` compiler options — one module per file family, each parameterized
by `StrictnessProfile` so `observe` never proposes a runnable script or a compiler gate.

| File | Purpose |
|---|---|
| `eslint.ts` | Builds the flat ESLint config as source text rather than a value, because the target repo needs a file it can read and edit and a JS config has nothing to merge key-by-key; `full` adds the functional-style bans (`no-classes`, `immutable-data`, ambient-impurity restrictions) with per-zone carve-outs for composition roots and tests, `standard` installs type safety only. |
| `packageJson.ts` | The `scripts` and `devDependencies` a retrofit contributes to `package.json`, and a complete fresh `package.json` for a target that has none; `observe` contributes an empty object on both so it can never add a script that fails. |
| `tsconfig.ts` | Splits the compiler settings a retrofit installs into `strictCompilerOptions` (the flags merged into an existing `tsconfig.json` — strictness only, never `module`/`target`) and `freshTsconfig` (the complete file written when there is none). |
