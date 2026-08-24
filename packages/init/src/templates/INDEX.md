# packages/init/src/templates

Source text for the configuration files a retrofit can install — ESLint config, `package.json`
entries, and `tsconfig.json` compiler options — one module per file family, each parameterized
by `StrictnessProfile` so `observe` never proposes a runnable script or a compiler gate.

<!-- BEGIN GENERATED: src-index (npm run docs:regen) -->
| File | Purpose |
|---|---|
| `eslint.ts` | The flat ESLint config a retrofit installs, as source text rather than a value: the target repo needs a file it can read and edit, and a JS config is not JSON, so there is nothing to merge key-by-key. `standard` installs type safety only; `full` adds the functional subset and the purity bans, with the same three zones this repo uses (core / composition roots / tests) but generalized to any layout. |
| `packageJson.ts` | The `package.json` entries a retrofit contributes. `observe` contributes nothing runnable: it is a measurement profile, so it must not add a script that can fail. |
| `tsconfig.ts` | The compiler settings a retrofit installs, split into the flags that are merged into an existing tsconfig (strictness only — never module/target, which are the target repo's business) and the complete file written when there is no tsconfig at all. |
<!-- END GENERATED -->
