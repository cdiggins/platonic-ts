# Off-the-Shelf Tooling Catalogue

**Status:** survey, not a decision. Nothing here is adopted yet.
**Date:** 2026-08-22
**Companion to:** [agent-development-framework-2026-08-18.md](agent-development-framework-2026-08-18.md)

---

## How to read this

The framework notes argue that most of what this project needs already exists and should not be built.
This is the inventory behind that claim, organised by the job to be done rather than by tool name.

Three cautions before the list.

**Overlap is the rule, not the exception.** Several tools below do the same job in incompatible ways —
Biome and ESLint, Nx and Turborepo, Zod and valibot and ArkType. Picking two overlapping tools is worse
than picking either one, because the definition of "green" fragments across them. Where a section has
competing entries, that is a decision to make, not a set to adopt.

**Every dependency is a maintenance surface.** The framework notes list ecosystem churn as a risk. A
tool that saves an hour of writing and costs an hour a quarter of upgrade work is a bad trade. Prefer
the boring, widely-used option, and prefer configuration over plugins where both would work.

**Versions and project health move fast.** This list reflects what was true at the time of writing.
Before adopting anything here, check that it is still maintained, still compatible with the current
TypeScript release, and still the consensus choice. Treat entries marked *(verify)* as especially
likely to have moved.

---

## 1. Compile and type-check

| Tool | What it does | Notes |
|---|---|---|
| **`tsc`** | The type checker. Non-negotiable. | Watch mode is the basis of the continuous gate. Not extensible — custom rules must live elsewhere. |
| **TypeScript native port** *(verify)* | Native (Go) reimplementation of the compiler, targeting a large speed-up. | If shipped and stable, it changes the economics of the per-edit gate substantially. Check status rather than assuming. |
| **`tsx`** / **`tsimp`** | Run TypeScript directly under Node without a build step. | Useful for check scripts and tooling. Node's own type-stripping may make these unnecessary — check first. |
| **esbuild** / **swc** / **Rolldown** *(verify)* | Fast transpilers. Strip types, do not check them. | Only relevant for shipping output. Never let a transpiler's silence be mistaken for a passing type check. |
| **Node type stripping** *(verify)* | Node can run some TypeScript directly. | Reduces the toolchain by one layer where it applies. Limited to erasable syntax. |

The distinction that matters: **transpiling is not checking.** Any pipeline where the fast tool builds
and the slow tool checks needs an explicit rule that the slow one gates.

---

## 2. Lint and custom rules

| Tool | What it does | Notes |
|---|---|---|
| **ESLint** (flat config) | The rule engine. | The place all custom architectural rules live, since `tsc` cannot host them. |
| **typescript-eslint** | Type-aware rules on top of ESLint. | Source of `no-floating-promises`, the `no-unsafe-*` family, `no-explicit-any`. Use project-service mode; per-file project resolution is slower. |
| **eslint-plugin-functional** | Immutability and purity rules. | Closest thing to an off-the-shelf implementation of the code subset — `immutable-data`, `no-classes`, `no-throw-statements`, `no-expression-statements`. |
| **`no-restricted-globals` / `no-restricted-properties`** | Built-in ESLint rules. | The whole ambient-impurity ban is these two rules plus a list. No plugin needed. This is the cheapest high-value item in the catalogue. |
| **eslint-plugin-import-x** | Import hygiene, cycle detection, resolution correctness. | The maintained successor to `eslint-plugin-import` *(verify)*. |
| **eslint-plugin-unicorn** | Large grab-bag of correctness and modernisation rules. | Valuable but opinionated. Adopt selectively; enabling the whole set generates noise. |
| **eslint-plugin-sonarjs** | Bug-pattern and cognitive-complexity rules. | Complexity limits are a plausible fence against the file-growth problem. |
| **eslint-plugin-total-functions** *(verify)* | Bans partial functions and unsound operations. | Narrow, aligned with the subset, but check maintenance before depending on it. |
| **oxlint** | Rust-based linter, very fast. | Type-aware coverage is the open question *(verify)*. Plausible as the fast syntactic tier with ESLint at merge. |
| **Biome** | Formatter and linter in one, fast. | An alternative to ESLint plus Prettier, not a supplement. Custom-rule story is the deciding factor for this project. |

**Writing custom rules.** When no off-the-shelf rule fits, the options are an ESLint rule (AST-aware,
integrates with the existing gate), an `ast-grep` YAML rule (no code at all, good for structural bans),
or a standalone `.mjs` script (fine for whole-repo invariants that are not per-file).

---

## 3. Formatting

| Tool | Notes |
|---|---|
| **Prettier** | The default. Uncontroversial and universally supported. |
| **Biome** | Faster, Prettier-compatible for most input. Take it only as part of the Biome-instead-of-ESLint decision. |
| **dprint** | Fast, plugin-based, configurable. Less common. |

Formatting matters more here than usual for a non-obvious reason: a deterministic formatter means
agent-generated diffs contain only semantic change. Formatting noise is tokens spent on nothing.

---

## 4. Architecture and boundaries

| Tool | What it does | Notes |
|---|---|---|
| **`dependency-cruiser`** | Declarative forbidden-dependency rules plus cycle detection. Can emit graphs. | The main candidate for enforcing package-boundary rules — no code, just configuration. |
| **eslint-plugin-boundaries** | Layer/element-type rules expressed in ESLint. | Overlaps `dependency-cruiser`. Advantage is living in the same gate as everything else. |
| **Sheriff** *(verify)* | Module-boundary enforcement with explicit public APIs per module. | Same job, different model. |
| **`madge`** | Dependency graphs and circular-dependency detection. | Largely subsumed by `dependency-cruiser`. Useful for one-off inspection. |
| **package manager workspaces** | pnpm / npm / yarn workspaces. | The strongest fence available, and free: an undeclared cross-package import does not resolve. |
| **`syncpack`** | Keeps dependency versions consistent across workspace packages. | Small, prevents a real class of drift in a multi-package repo. |

---

## 5. Public API surface

| Tool | What it does | Notes |
|---|---|---|
| **API Extractor** | Emits a human-readable `.api.md` report; `--verify` fails the build on undeclared surface change. | The report doubles as a semantic-conflict detector between parallel agents, and as a compact review artifact. |
| **`publint`** | Checks a published package's manifest, `exports` map, and file layout for correctness. | Cheap, catches real packaging mistakes. |
| **`are-the-types-wrong`** (`attw`) | Checks that type declarations actually resolve for consumers across module systems. | Catches the "types are broken for half of consumers" failure that nothing else notices. |
| **TypeDoc** | Generates API documentation from source. | Relevant to the "documentation drifts from code" observation: generated docs cannot drift. |

---

## 6. Testing

| Tool | What it does | Notes |
|---|---|---|
| **Vitest** | Test runner. Watch mode, `--changed`, `related <files>`, snapshots, coverage, `expectTypeOf`. | Covers several catalogue entries by itself. The `--changed` / `related` support is directly the "only run the tests required" goal. |
| **`node:test`** | Node's built-in runner. | Zero dependencies. Fewer features — no `--related`, weaker watch story. |
| **`expectTypeOf`** (Vitest) / **`tsd`** | Assertions about types rather than values. | Verification that most languages cannot express at all. Underused. |
| **fast-check** | Property-based testing. | The natural partner to a pure-functional subset: state a law, let the tool search for a counterexample. Far better value per test than example-based tests on pure code. |
| **StrykerJS** | Mutation testing — measures whether tests actually detect breakage. | Coverage says lines ran; mutation says the tests would notice. Expensive to run; suits a periodic rather than per-edit cadence. |
| **Playwright** | Browser automation and end-to-end tests. | Only if there is a UI. Slow, so keep it out of the per-edit gate. |
| **MSW** | Network interception for tests. | Less needed if the ambient-impurity ban keeps `fetch` out of the interior. |
| **Vitest coverage** (V8 / Istanbul) | Coverage reporting. | Useful as a ratchet input; poor as a target in its own right. |

---

## 7. Data, types, and runtime validation

| Tool | What it does | Notes |
|---|---|---|
| **Zod** | Schema validation, infers TypeScript types from schemas. | The mainstream choice for parse-don't-validate at boundaries. Largest ecosystem. |
| **valibot** | Same job, modular, much smaller bundle. | Preferable where size matters. |
| **ArkType** *(verify)* | Validation with type syntax and strong inference performance. | Newer; check maturity. |
| **`type-fest`** | Library of useful utility types. | Pure types, no runtime cost. |
| **`ts-essentials`** | Similar, with a stronger deep-readonly story. | Overlaps `type-fest`. |
| **`ts-pattern`** | Exhaustive pattern matching with type narrowing. | Turns a class of missed-case bug into a compile error. Fits the expressions-over-statements preference directly. |
| **`neverthrow`** / **`true-myth`** | `Result` and `Option` types. | Needed to make "throw only for bugs" workable. Pick one. |
| **Effect** | Large ecosystem: typed errors, dependency injection, structured concurrency, schema. | Genuinely powerful and genuinely a commitment. Adopting it is choosing a programming model, not adding a library — weigh against the simplest-thing-that-could-work principle. |
| **Immer** | Structural sharing via a mutable-looking draft API. | Solves ergonomics of immutable updates. Tension with a no-mutation lint rule; may be more friction than help here. |
| **`Object.freeze`** | Built in. Runtime immutability enforcement. | The dev-build backstop for erased `readonly`. Costs nothing to try; measure before shipping it in production builds. |

---

## 8. Codemods and structural editing

| Tool | What it does | Notes |
|---|---|---|
| **`ast-grep`** | Structural search-and-replace from a YAML rule. No code required. | Doubles as a custom-lint mechanism. The first thing to reach for on a mechanical repo-wide change. |
| **`ts-morph`** | Programmatic TypeScript AST manipulation over a real program. | For refactors that need type information — moving a symbol, updating every call site correctly. Friendlier than raw compiler API. |
| **`jscodeshift`** | The long-standing codemod runner. | Older, still widely used, weaker TypeScript story than `ts-morph`. |
| **`putout`** *(verify)* | Plugin-based transform and lint tool. | Niche. |
| **Comby** | Language-agnostic structural rewriting. | Useful when the change spans more than TypeScript files. |
| **TypeScript compiler API** | The floor beneath all of the above. | Only when nothing higher-level fits. |

The pattern that matters: when a compiler flag or a new rule enumerates a hundred violation sites with a
uniform fix, that is a codemod, not agent work. Paying per-site token cost for a mechanical
transformation is the most avoidable expense in this whole system.

---

## 9. Navigation and code intelligence for agents

| Tool | What it does | Notes |
|---|---|---|
| **`tsserver`** | The language server behind every TypeScript editor. Persistent daemon: definition, references, rename, diagnostics, quick-info. | Already exists, already running, already speaks the protocol. Wrapping it is cheaper than building navigation, and it turns "grep and guess" into one exact answer. |
| **`typescript-language-server`** | LSP wrapper over `tsserver`. | Use if speaking LSP is preferable to the raw protocol. |
| **`scip-typescript`** *(verify)* | Emits a SCIP index — a persisted, queryable cross-reference of the codebase. | Better than a live server for whole-repo questions; staler by construction. |
| **`knip`** | Finds unused files, exports, and dependencies. | Directly serves "delete unneeded code". Good ratchet candidate: a committed baseline that may only fall. |
| **`repomix`** / **`code2prompt`** *(verify)* | Pack a repository into a single model-readable file. | Relevant to context management, but in tension with the token-economy goal — packing everything is the opposite of reading only what is needed. Consider generated indexes instead. |
| **MCP servers** | Expose tools to agents over a defined protocol. | The likely delivery mechanism for navigation and gate access. |

---

## 10. Build and monorepo orchestration

| Tool | Notes |
|---|---|
| **pnpm workspaces** | Strict `node_modules` layout, fast, content-addressed store. The strictness is a feature here: it prevents undeclared-dependency access, which is a fence. |
| **npm / yarn workspaces** | Fine. Less strict about phantom dependencies. |
| **Turborepo** | Task graph with caching. Simple model, quick to adopt. |
| **Nx** | More powerful task graph, affected-project detection, generators. Heavier and more opinionated. |
| **moon** *(verify)* | Similar niche, Rust-based. |
| **`tsup`** / **`unbuild`** / **`tsdown`** *(verify)* | Library bundling with declaration output. |
| **Bazel** | Genuinely hermetic builds. Almost certainly overkill; noted for completeness. |

For a small repo, **workspaces plus a plain `check` script may be the whole answer.** Task-graph
caching earns its keep when the full check gets slow, not before.

---

## 11. Environment determinism

| Tool | Notes |
|---|---|
| **Lockfiles + `--frozen-lockfile` / `npm ci`** | The single most important item in this section. Non-negotiable when multiple agents share a tree. |
| **Corepack** | Pins the package manager version itself. |
| **Volta** / **mise** / **`.nvmrc`** | Pin the Node version. |
| **Dev containers / Docker** | Full environment pinning. Heavier; worth it only if drift becomes a real problem. |
| **`npm-run-all` / `concurrently`** | Run multiple watchers or checks together. Small, useful for the `check` script and the watch-mode gate. |

---

## 12. Process, git, and CI

| Tool | Notes |
|---|---|
| **lefthook** / **husky** + **lint-staged** | Git hooks. Lefthook is faster and parallel; husky is more common. Note the tension with agent workflows — a hook that blocks a commit an agent expected to succeed produces confusing failures. |
| **commitlint** | Enforces commit-message format. Useful if commit trailers become machine-readable work records. |
| **Changesets** | Version and changelog management for workspace packages. |
| **Danger JS** | Rules about the *change* rather than the code — size, missing tests, missing changeset. |
| **GitHub Actions** | CI. Whatever runs there must be exactly the `check` script, never a subset. |
| **reviewdog** | Turns tool output into inline review comments. |

---

## 13. Measurement

The weakest-supported area in the catalogue, and — per the framework notes — one of the hardest open
problems. There is no off-the-shelf answer to "did this rule change make agents more effective."

| Tool | Notes |
|---|---|
| **`gh` CLI + git plumbing** | The raw material. Commit trailers, task IDs, timestamps. Boring and sufficient to start. |
| **Agent session logs** | Claude Code and similar tools write structured session transcripts. The most direct source of per-task token cost *(verify the format before depending on it)*. |
| **OpenTelemetry** | Standard tracing, if gate runs and agent turns become spans. Probably premature. |
| **`hyperfine`** | Benchmarks command-line tools. Directly useful for keeping the per-edit gate under its latency budget. |
| **`tsc --diagnostics` / `--generateTrace`** | Where compile time is actually going. Relevant once the watch gate exists. |

---

## 14. Shortlist

If the goal is the smallest set that delivers most of the framework:

1. **pnpm workspaces** — fences, free.
2. **`tsc`** with full strictness — the floor.
3. **ESLint** + **typescript-eslint** + **eslint-plugin-functional** — the subset.
4. **`no-restricted-globals` / `no-restricted-properties`** — the purity ban, pure configuration.
5. **Vitest** — tests, watch, `--changed`, snapshots, type assertions, coverage.
6. **`dependency-cruiser`** — boundaries, declaratively.
7. **Prettier** — deterministic diffs.
8. **`knip`** — dead code, ratcheted.
9. **`ast-grep`** — mechanical change without agent tokens.
10. **API Extractor** — surface as a reviewable contract.

Everything else in this document is a later decision, and several entries are decisions this project
may reasonably never make.
