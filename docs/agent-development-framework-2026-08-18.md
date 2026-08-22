# An Agent Development Framework for TypeScript

**Status:** design notes. Nothing here is implemented yet.
**Date:** 2026-08-18
**Scope:** first thoughts on where this project could go.

---

## 1. What this document is

These are opening notes for this project, whose goal — as the [README](../README.md) puts it — is to
get coding agents to finish work faster while consuming fewer tokens.

The idea behind the project is that most of what slows agents down is not the model. It is the code and
the process around it. Files grow, concerns tangle, state becomes non-local, and every subsequent edit
costs more tokens and produces more mistakes. An agent working in a codebase like that spends most of
its budget reading, guessing, and re-reading.

The response proposed here has three parts:

1. **Constrain the code.** A restricted, mostly-functional subset of TypeScript that is easier for both
   people and agents to reason about locally.
2. **Move rules into tools.** Anything an agent is repeatedly told in a prompt should eventually become
   something a program checks. Prompts are advisory; a failing build is not.
3. **Make the feedback fast and small.** An agent should get a short, decisive verdict after each edit
   instead of a wall of build output.

None of this is TypeScript-specific in principle. What follows is an argument that TypeScript is an
unusually good place to *start*, plus an honest account of the places where it is a worse place than
the alternatives.

This is a first draft of a set of ideas, not a plan of record. Expect it to be wrong in places.

---

## 2. Why start in TypeScript

The decisive property is that the tooling is written in the same language as the code it checks.

A custom architectural rule in TypeScript can be a sixty-line `.mjs` script wired into `npm run check`.
It needs no separate project, no build step, no packaging, and no test harness beyond the one the repo
already has. Writing one is roughly an hour of work.

That cost matters more than it first appears. If turning a convention into an enforced rule is cheap,
you can afford to be wrong about rules. You promote a convention to enforcement early, discover in a
week that it was too strict, and delete it — having lost an hour. If enforcement is expensive, you
delay it, which means the rule lives in a prompt, which means it is followed unevenly and forgotten
under pressure.

**So the working assumption for this project is: promote rules to enforcement aggressively and early.**
The expensive mistake is not an over-strict rule. It is a rule that stays advisory for months while
agents quietly violate it.

There is a second reason, developed in section 6: the TypeScript toolchain can run *continuously*, so
the cost of checking an edit can approach zero.

---

## 3. The code subset

The subset is not "functional programming" as an ideology. It is a specific bet: agents make fewer
mistakes when the behaviour of a piece of code can be determined by reading that piece of code. Every
rule below exists to remove a way that behaviour can be non-local.

Most of these rules already exist off the shelf. `eslint-plugin-functional` and `typescript-eslint`
between them cover the majority; the rest is configuration.

| Intent | Enforcement |
|---|---|
| No mutable classes | `functional/no-classes` — or simply prefer type aliases plus factory functions |
| No setters | `functional/prefer-immutable-types`; ban `set` accessors |
| Readonly fields | `functional/prefer-readonly-type` — compile-time only, see section 7 |
| No implementation inheritance | `functional/no-class-inheritance`; largely moot if there are no classes |
| No member mutation | `functional/immutable-data` — the load-bearing rule of the whole set |
| No events in the core | ban `EventEmitter` and `addEventListener` inside core packages |
| No mutable collections in signatures | require `readonly T[]` / `ReadonlyArray<T>` on exported APIs |
| No `any`, no unsafe operations | `no-explicit-any`, the `no-unsafe-*` family, `no-non-null-assertion`, ban `eval` |
| No reflection | ban the `Function` constructor, prototype access, dynamic own-type indexing |
| No ambient impurity | `no-restricted-globals` / `no-restricted-properties` on `Date.now`, `Math.random`, `fetch`, `localStorage`, `process.env`, `console` |
| Throw only for bugs | `functional/no-throw-statements` plus a `Result` type for expected failure |

The ambient-impurity row deserves emphasis because it is the cheapest of the set. It is pure
configuration — no custom rule, no plugin, no code. It also does the most to make tests optional: a
function that cannot read the clock, the network, or the environment produces the same output for the
same input, and a test that has already passed for those inputs does not need to be re-run when
unrelated code changes.

### 3.1 Two rules specific to JavaScript

These have no counterpart in most other languages, and both matter more than any single rule above.

**Module-level side effects.** Importing a module executes it. A top-level statement is therefore
non-local state with a load-order dependency, and the resulting bugs are invisible in every file an
agent is currently looking at. `functional/no-expression-statements`, scoped to module level, catches
this.

**Floating promises.** An effect that escapes its call site and completes later is an entire class of
failure that static reading cannot recover. `@typescript-eslint/no-floating-promises` should be treated
as mandatory in any codebase agents write into, not as a style preference.

---

## 4. Escape hatches are the central problem

This is the place where TypeScript is materially worse than a nominally-typed compiled language, and it
shapes everything else.

The escape hatches are `any`, `as`, `!`, `@ts-ignore`, and `// eslint-disable-next-line`. Each is one
token. Each is nearly invisible in review. None of them costs anything socially to write.

Type assertions are the worst of them, because they *propagate*. A disabled lint rule stops applying at
the end of the line. A bad `as` poisons every inference that flows downstream from it, silently and
without bound.

Left alone, this defeats the whole scheme. An agent optimising for a green check will discover that the
fastest route to green is a cast, and every gate after that point reports success on code that has
already lost its guarantees. This is the concrete shape that gate-gaming takes in TypeScript, and it is
more likely here than elsewhere precisely because the move is so cheap.

**The proposed mitigation is a ratchet: a committed baseline count that may fall but never rise.**
It should count five things, each requiring a justification comment:

1. `any` occurrences, including implicit ones caught by `noImplicitAny`
2. type assertions (`as`, excluding `as const`)
3. non-null assertions (`!`)
4. `@ts-ignore`, `@ts-expect-error`, and `@ts-nocheck`
5. `eslint-disable` comments

The check fails on an increase and re-baselines automatically on a decrease. It is perhaps half a day
of work, and it is what makes it safe to hand work to a cheaper, faster model — which is one of the
project's stated goals.

### 4.1 Compiler strictness

`strict: true` is the floor, not the ceiling. Three additional flags are worth turning on from the
start, while the cost of doing so is zero:

- **`noUncheckedIndexedAccess`** — makes `arr[i]` yield `T | undefined`. This catches a failure class
  that agents produce constantly and that `strict` alone does not cover. It is the single
  highest-value flag outside `strict`.
- **`exactOptionalPropertyTypes`** — distinguishes an absent property from one explicitly set to
  `undefined`. Cheap correctness for option-bag APIs.
- **`noImplicitReturns`** — catches the branch that forgets to return.

Turning these on in an empty repository is free. Turning them on in a mature one is a bounded but real
fix-up. That asymmetry is a reason to decide now.

---

## 5. Tools instead of agents

A recurring theme in the README is to prefer tools over agents wherever a tool can do the job. The
TypeScript ecosystem makes that unusually easy: most of what a framework like this needs already
exists and does not have to be built.

| Need | Existing tool |
|---|---|
| Public API surface control | Microsoft API Extractor — emits a reviewable `.api.md`; `--verify` fails the build on undeclared change |
| Run only the affected tests | `vitest --changed`, `vitest related <files>` |
| Build only the affected packages | workspace filters (`pnpm --filter`), or Nx / Turborepo for a cached task graph |
| Golden / snapshot outputs | `toMatchSnapshot`, `toMatchFileSnapshot` in vitest |
| Architectural dependency rules | `dependency-cruiser` — declarative forbidden-dependency rules plus cycle detection |
| Dead code | `knip` — unused files, exports, and dependencies |
| Coverage and mutation testing | StrykerJS |
| Type-level assertions | `expectTypeOf` (vitest) or `tsd` — verification that most languages cannot express at all |
| Structural search and replace | `ast-grep` (YAML rules, no code) and `ts-morph` (programmatic refactors) |
| Code navigation for agents | `tsserver`, already a persistent daemon speaking definition / references / rename / diagnostics |

The last two rows are worth a note. Bulk mechanical refactoring — the kind where a compiler flag
enumerates two hundred sites and they all need the same treatment — is a job for `ast-grep` or
`ts-morph`, not for an agent burning tokens per site. And an agent that can ask `tsserver` "where is
this defined" does not need to grep, read three files, and guess.

The API surface report deserves a note too: it doubles as a semantic conflict detector. If two agents
working in parallel both change the public surface, the diff on the `.api.md` file says so in
kilobytes, without anyone reading either implementation.

---

## 6. The gate can run continuously

This is the strongest single argument for starting in TypeScript.

`tsc --watch` and `vitest --watch` are persistent processes that already hold the answer. A hook that
fires after an agent edits a file does not need to *start* a build; it reads the watcher's current
state and returns a verdict. That is near-zero-latency gating, and it pays on every single turn
thereafter.

The verdict itself matters as much as the latency. What the agent should receive is a short structured
answer — pass or fail, and if fail, the smallest useful description of why — not raw compiler output.
Token economy is a stated project goal, and build output is one of the largest avoidable expenses in an
agent session.

One caveat specific to TypeScript: individual diagnostics are terser than most compilers produce, but a
single error in a shared type cascades into hundreds of downstream errors. **Deduplicate by root cause,
not by count.** Group by error code and by the file that *owns* the offending type, not by the files
that merely consume it. A verdict that says "one error, in `Foo.ts`, and here it is" is worth far more
than a truthful list of three hundred consequences.

### 6.1 Two gates, one script

`tsc` is not extensible. There is no supported way to add a custom rule to the TypeScript compiler, so
custom rules live in ESLint — a separate process, separate configuration, separate invocation. This
forfeits the cleanest possible property, which would be *the build is the enforcement*.

The mitigation is a convention rather than a mechanism: **one `check` script that runs everything, and
an absolute rule that nothing else counts as green.** Not CI, not a hook, not an agent instruction may
ever invoke a subset of it and call the result passing. The discipline that a single extensible
compiler would give for free, this project has to get from a script name — which means the script name
has to be treated as sacred.

---

## 7. Where TypeScript is genuinely weaker

Worth planning around rather than discovering later.

**`readonly` is erased.** It is a compile-time fiction with no runtime guarantee, and a cast removes
it. Anything that leans on *genuine* immutability — equivalence checking, sound impact analysis, stable
goldens — therefore rests on softer ground than it would in a language with real immutable values.

Two mitigations. `Object.freeze` in development builds gives a runtime backstop where it matters. More
importantly, parse-don't-validate at the boundaries (Zod, valibot) makes the interior genuinely
trustworthy even though the type system alone cannot prove it. That boundary-validation pattern is
mature and idiomatic in TypeScript in a way it is not everywhere, so this weakness comes with a partial
compensation.

**Type-aware linting is slow.** The `no-unsafe-*` family needs full program type information. Use
project-service mode rather than the older per-file project resolution, and be prepared to split the
rule set: syntactic rules on every edit, type-aware rules at merge. If the per-edit gate gets slow,
agents will route around it — measure it, and split before that happens.

**Structural typing softens contracts.** Any object of the right shape satisfies an interface, so the
small explicit contract that agents work well against is less crisp than it would be under nominal
typing. Branded types recover some of this where an invariant genuinely matters. Do not brand
everything; brand the things where being wrong is expensive.

**The environment is less deterministic than the language.** `node_modules`, transitive dependency
drift, and install races between concurrent agents are worse than they look, because they can change
build *results* rather than merely failing loudly. Lockfile discipline, `npm ci` or
`pnpm install --frozen-lockfile`, and a single completed install before any parallel work begins.

---

## 8. How the work might be organised

The README rules out git worktrees and branches on the grounds that they do not help multiple agents
cooperate. That constraint pushes toward a specific shape.

**Packages are the natural fences.** In a workspace, `package.json` boundaries are enforced by the
package manager itself — an import that crosses a boundary the manifest does not declare simply does
not resolve. That is a fence nobody has to police. `dependency-cruiser` adds the finer-grained rules
(this package may reference that one only through its contract module) declaratively.

The alternative — a coordination ledger where agents claim files and others wait — is still needed, but
it should carry less. **Let the package boundaries do the structural work, and let the ledger carry
only cross-package coordination.** Violations then become cheaper to detect and harder to commit by
accident, because the tooling refuses them before any human or supervising agent has to notice.

Two things this implies for repository layout, decided early because they are expensive to change late:

- Small packages, split by concern, from the beginning. A single large package has no fences.
- An explicit contract module per package. What is exported *is* the contract, and API Extractor makes
  changes to it reviewable.

---

## 9. Getting better over time

The README lists continuous improvement and measurement as open challenges, and they are the hardest
part of this.

The core idea: an agent's work should leave a machine-readable trace — what was asked, what was
changed, which gates ran, what they said, how many tokens it cost. Given a corpus of those traces, the
same task can be replayed against different models, different prompts, and different rule sets, and the
results compared. That is the path from anecdote to evidence, which is the stated goal.

This layer is entirely language-agnostic — it is git, JSON, and process. But it runs *better* in
TypeScript for one economic reason: the gates are fast and cheap to execute, so replaying a task across
model tiers costs less. More replays per dollar means tighter variance estimates and faster, more
confident delegation to cheaper models. The flywheel spins faster here than it would elsewhere.

A related mechanism worth building early: **detect when a rule has graduated.** When a convention has
been stated in a prompt repeatedly, or violated repeatedly, that is a signal it should stop being a
prompt and start being a check. Section 2 argued that promotion is cheap; this is how you notice that
promotion is due.

---

## 10. A possible order of work

Ordered by cost against value. Each step should be independently landable and independently useful, so
that stopping after any of them still leaves the project better off.

1. **Compiler strictness (hours).** `strict`, plus `noUncheckedIndexedAccess`,
   `exactOptionalPropertyTypes`, and `noImplicitReturns`. Free in an empty repository.
2. **The `check` script (hours).** Establish the single definition of green before there is anything to
   check. Everything after this wires into it.
3. **ESLint (half a day).** `typescript-eslint` and `eslint-plugin-functional`, configured from the
   section 3 table. Start with the ambient-impurity rules and `no-floating-promises` — pure
   configuration, highest-value failures caught.
4. **The escape-hatch ratchet (half a day).** Section 4. Do this *before* delegating work to cheaper
   model tiers, because it is the gate that makes that delegation safe.
5. **Package boundaries (a day).** Workspace layout plus `dependency-cruiser` rules. Cheaper to
   establish before there is code than after.
6. **API Extractor (half a day).** Once packages have real exports.
7. **The watch-mode gate (a day).** Persistent `tsc --watch` and `vitest --watch`, plus a post-edit
   hook that reads their state and returns a compact verdict. This is where the token-economy payoff
   arrives.
8. **The trace and replay layer.** Section 9. Last, because it needs real work to observe.

---

## 11. Risks

- **Rule-set fragmentation.** Two gates can drift apart; a rule can be on in one configuration and off
  in another. The `check` script is the only source of truth, and nothing may invoke a subset of it.
- **Lint latency.** If the per-edit gate becomes slow, agents will route around it. Measure it; split
  syntactic from type-aware if it exceeds a couple of seconds.
- **Ratchet gaming through configuration.** An agent that cannot pass a rule can disable the rule.
  ESLint configuration and `tsconfig.json` must be supervisor-owned and never writable by a working
  agent.
- **Erased immutability.** Anything depending on genuine purity is weaker here. Do not assume it
  carries at full strength without the boundary-validation layer.
- **Ecosystem churn.** Off-the-shelf tooling is why this is cheap, and it is also a maintenance
  surface. Pin versions, and treat a tooling upgrade as a change requiring the same gates as a code
  change.
- **Over-strictness.** The README observes that overly precise rules can slow agents down — an agent
  can loop trying to satisfy a rule that was never worth satisfying. Cheap enforcement cuts both ways:
  it makes rules cheap to add *and* cheap to delete. Delete them.
