# Typed Functional Programming: Libraries, Language Subsets, and Mechanical Optimization

**Status:** technical report.
**Date:** 2026-08-23
**Companion to:** [fp-and-immutability-in-ts-js-2026-08-23.md](fp-and-immutability-in-ts-js-2026-08-23.md), [pure-fp-for-agents-2026-08-22.md](pure-fp-for-agents-2026-08-22.md)

---

## 1. Scope and hypothesis

The [previous report](fp-and-immutability-in-ts-js-2026-08-23.md) surveyed functional idioms and immutability across TypeScript and JavaScript broadly. This one narrows to the strongly typed end of the spectrum and goes deeper on three questions:

1. What do the actual **immutability libraries and functional frameworks** for TypeScript offer, mechanically — and which niche does each one genuinely own?
2. Is there a case for going past libraries to a **pure functional subset or a separate language** — a linted TypeScript subset, an embedded DSL, or an external language like [Elm](https://elm-lang.org/) or [Plato](https://github.com/cdiggins/plato) — for the parts of a system where purity pays most?
3. Can **static analysis and optimization passes** mechanically transform naive functional code into efficient code, so that the "immutability is slow" objection is answered by the compiler rather than by the programmer?

The working hypothesis, which this repository's H5/H6 make explicit: **even small pure, strongly typed functional modules are easier to test, refactor, and reason about than their imperative equivalents** — and this holds at module granularity, so a system does not need to be functional throughout to collect the benefit. Purity composes downward: one pure module in an imperative program is still fully pure, fully testable, and fully locally reasoned about. The reverse is not true — one mutable module in a "pure" program poisons every caller that touches it.

JavaScript-without-types appears here only historically. Untyped FP in JS was where the ecosystem learned most of these lessons — Underscore/Lodash normalized higher-order collection functions (2009–2012), React's `shouldComponentUpdate` and later Redux (2015) made immutability a mainstream requirement rather than an academic preference, and Ramda demonstrated both the appeal and the ceiling of curried point-free style without types. But the hypothesis under examination is about *strong typing plus purity*, and every serious contender today is typed.

---

## 2. The immutability library landscape, in depth

The libraries divide by mechanism, and the mechanism determines the trade-offs more than the API does.

### 2.1 Copy-on-write helpers: Immer and Mutative

**[Immer](https://immerjs.github.io/immer/)** wraps your state in a Proxy "draft"; you write ordinary mutating code against the draft; on exit it replays the recorded writes as a structurally shared copy. Untouched branches keep reference identity — which is exactly what reference-equality change detection needs.

- *Where it wins:* nested updates (the deep-spread problem from the previous report disappears); `readonly` types on the outside with mutable ergonomics on the inside — `produce` accepts a `Draft<T>` that strips readonly, so you can mint deeply readonly state types and still update them legibly; patch generation (`produceWithPatches`) gives you undo/redo and operational sync nearly for free.
- *Where it costs:* Proxy interception on every property access inside the recipe — fine at UI event frequency, wrong inside a tight loop; drafts in the debugger show as Proxies; classes and exotic objects need opt-in (`immerable`); frozen output by default in development can surprise code that mutates results downstream.
- *Ecosystem position:* `produce` is built into Redux Toolkit's `createReducer`/`createSlice`, so it is the de facto standard update mechanism for a large share of React apps whether or not the author knows it.

**[Mutative](https://github.com/unadlib/mutative)** is the same draft model reimplemented for speed — its benchmarks show large multiples over Immer, achieved mainly by not freezing by default, cheaper draft bookkeeping, and faster handling of large arrays. It supports the same patch generation. Sensible reading: same niche as Immer; consider it when profiling shows Immer itself in the frame, and note it is a younger project with a smaller ecosystem.

### 2.2 Persistent data structures: Immutable.js and successors

**[Immutable.js](https://immutable-js.com/)** ships real persistent structures — HAMT-backed `Map`/`Set`, a trie-of-32 `List` — with O(log₃₂ n) updates and genuine structural sharing at any size. It also ships value equality (`Immutable.is`, `hashCode`), the thing the platform lacks. The costs were covered before and remain decisive for most teams: its own types at every boundary, `.get('field')` instead of `.field` (with the accompanying loss of structural typing and inference), conversion churn at JSON and library edges, size, and maintenance-mode velocity. It remains the right tool for one profile: **large collections (10⁴+ entries) with frequent point updates and a need for cheap snapshots** — an editor buffer, a CRDT store, a big normalized cache.

The successors take slices of that niche with better TypeScript stories:

- **[Rimbu](https://rimbu.org/)** — a modern, TypeScript-first persistent collections library (maps, sets, ordered variants, multi-maps, graphs) with strong typing throughout; closest thing to "Immutable.js designed after TypeScript existed."
- **[List (funkia)](https://github.com/funkia/list)** — a single, very fast persistent list built on relaxed radix balanced trees, with an API mirroring `Array`; the best drop-in when only the list case matters.
- **[Mori](https://swannodette.github.io/mori/)** — ClojureScript's persistent structures exposed to JS; historically important, now mostly of reference interest.
- **`@rimbu/*`, `@thi.ng/associative`, `prelude-ts`'s Vector** — smaller options; the common lesson is that persistent structures in JS live or die on interop friction, not asymptotics.

### 2.3 Value-equality records: what died and what remains

The **Records and Tuples** proposal (`#{a: 1}`, `#[1, 2]` — deeply immutable, compared by value, usable as Map keys) was the platform-level fix, and it is effectively dead in its original form; TC39 redirected toward a narrower "composite values" exploration with no shipping timeline. The practical residue for typed codebases:

- Key composite lookups with a **canonical key function** (`` `${x}:${y}` `` or a stable stringify) — boring, fast, and type-safe if you brand the key type.
- Or adopt a library with value equality at its core (Immutable.js, Rimbu) *for the collections that need it only*.
- Interning ("hash-consing") — canonicalize construction so equal values are the same reference — is the high-end answer, and a natural fit for a pure module that constructs all its own values. It converts value equality back into reference equality, and makes memoization by identity sound. It is rarely worth hand-rolling except in compiler-shaped workloads (ASTs, types, geometry kernels), where it is standard practice.

### 2.4 Functional frameworks: fp-ts, Effect, and the lightweight tier

**[fp-ts](https://gcanti.github.io/fp-ts/)** brought Haskell-style typeclasses (via a higher-kinded-type encoding) to TypeScript: `Option`, `Either`, `Task`, `Reader`, and lawful instances connecting them. It proved the encoding works and also demonstrated its ceiling — inference failures inside deep generic pipelines produce error messages measured in pages. Its maintainer joined the Effect project, and fp-ts v3's planned direction was folded into Effect; new adoption of fp-ts proper is hard to recommend in 2026.

**[Effect](https://effect.website/)** is the maximal position: a full effect system for TypeScript. `Effect<A, E, R>` types the success value, the error channel, *and* the required dependencies; on top sit structured concurrency with fibers, retry/timeout policies, resource scoping, streams, an STM, schema validation, and dependency injection via the `R` channel. It is genuinely impressive engineering, and the honest classification is that it is a **language implemented as a library** — adopting it means code that is unrecognizable to a TypeScript developer who hasn't learned it, generator-based `Effect.gen` as your new `async/await`, and a runtime that owns your program's execution. Where the previous report's caution applies doubly: this is the dialect *least* represented in code-model training data relative to its sophistication, so agent-written Effect code is measurably weaker than agent-written plain TypeScript. Adopt it as you would adopt a framework migration, or not at all.

The **lightweight tier** takes single ideas without the paradigm:

- **[neverthrow](https://github.com/supermacro/neverthrow)** — just `Result`/`ResultAsync` with `map`/`andThen`/`match` and an ESLint rule to force handling. The best "minimum viable typed errors" library.
- **[purify-ts](https://gigobyte.github.io/purify/)** — `Maybe`/`Either`/`EitherAsync` plus codecs; a small, pragmatic ADT toolkit without HKT emulation.
- **[Remeda](https://remedajs.com/)** — Lodash-shaped utilities designed for TypeScript inference, with `pipe`-friendly data-last overloads and lazy evaluation in pipelines. The best answer to "I want Ramda but with types that work."
- **[ts-pattern](https://github.com/gvergnaud/ts-pattern)** — exhaustive pattern matching as a library (`match(x).with(...).exhaustive()`), with inference-driven narrowing. Pairs with discriminated unions to give TS most of what `case of` gives Elm; the [TC39 pattern-matching proposal](https://github.com/tc39/proposal-pattern-matching) that would make it native remains stalled at Stage 1.
- **[ts-belt](https://mobily.github.io/ts-belt/)** — fast, data-first FP utilities; a smaller Remeda competitor.

### 2.5 State frameworks: where immutability meets architecture

The state-management layer is where these mechanics become architecture, and the notable pattern is that **every survivor converged on immutable snapshots + reference-equality subscription**, differing only in who writes the copy:

- **Redux Toolkit** — you write "mutations," Immer writes the copies; time-travel and patches fall out.
- **Zustand** — you write the copies (spread), the store does reference-diffed subscription; minimal and unopinionated.
- **Jotai** — immutable atoms with dependency tracking; the state graph is a DAG of pure derivations, which is the most functional architecture of the mainstream options.
- **XState** — statecharts: state as a value, transitions as pure functions from (state, event) to state, effects declared as data and executed by the interpreter. This is the Elm architecture's discipline delivered as a TypeScript library, and it is the strongest mainstream evidence that "model state as an immutable value, make transitions pure, push effects to an interpreter" survives contact with production.
- **Solid / signals** — fine-grained reactivity mutates *signal containers* while treating contained values as immutable snapshots; a reminder that the ecosystem's real invariant is "values don't change, references to current-value do."

---

## 3. Beyond libraries: pure functional subsets and separate languages

Libraries leave you inside TypeScript's semantics: no purity checking, no value equality, erasable types. The next rung is changing the language — by subsetting it, embedding a DSL in it, or leaving it for selected modules.

### 3.1 The linted subset (this repository's bet)

Define a pure subset of TypeScript and enforce it mechanically: `eslint-plugin-functional` (`no-let`, `immutable-data`, `no-expression-statements`, `no-throw-statements`), strict compiler flags, `readonly` everywhere, and a ratchet on escape hatches. This is Platonic TypeScript's approach, and its trade profile is distinctive:

- *Wins:* zero interop cost — a pure module is just a TypeScript module; the full toolchain, ecosystem, and (critically for agents) the full training-data distribution still apply; adoption is per-module and reversible; violations are warnings you can ratchet rather than a wall.
- *Losses:* the guarantees are advisory. Lint doesn't see through `any`, dependencies, or JS callers; purity is checked syntactically (no mutation *statements*) rather than semantically (no observable effects), so a call to an impure function passes. You get the *discipline* of purity with the *verification* of a style guide.

The subset approach is best understood as buying most of the reasoning benefit (sections 4–5) at near-zero adoption cost, while giving up the compiler-enforced guarantees that make aggressive optimization sound (section 6). That is a good trade for most modules and the wrong trade for none-shall-mutate kernels.

### 3.2 Embedded DSLs: purity as a library-level language

An embedded DSL uses the host language's syntax but its own semantics. TypeScript turns out to be a strong eDSL host because of literal types, template-literal types, and inference:

- **Zod / ArkType / Valibot** are type-level DSLs for data shapes — you write a schema value, the *type* is derived from it, and validation is interpretation of the DSL.
- **Effect** is, as classified above, an eDSL for effectful programs: `Effect` values are *descriptions*, and the runtime interprets them. This is precisely Elm's effects-as-data design, embedded.
- **SQL builders (Kysely), parser combinators (arcsecond), animation timelines, shader builders** — each embeds a small pure language whose programs are values you can inspect, transform, and optimize before execution.

The eDSL insight relevant to the hypothesis: **when programs are values, the "static analysis" of section 6 becomes ordinary code** — you can walk, rewrite, fuse, and specialize the description at runtime with no compiler plugin. The cost is the familiar one: two languages in one file, inference strain at the seams, and unfamiliarity tax.

### 3.3 Elm: general-purpose language, domain-specific *platform*

Does Elm classify as a DSL? Strictly, no — it is a general-purpose pure functional language (functions, ADTs, modules, a full type system). But it is *domain-specific in its platform commitments*, and that is the interesting part: Elm refuses arbitrary JS interop (ports only — typed message passing, no FFI), refuses escape hatches, targets exactly one domain (browser UIs via The Elm Architecture), and in exchange delivers guarantees no subset-of-TS can: **no runtime exceptions in practice** (famously reported by NoRedInk across hundreds of thousands of lines), enforced semantic versioning computed from type diffs, and total-language properties the compiler can rely on.

Elm is therefore the cleanest existing test of this report's hypothesis at *application* granularity, and its history is instructive in both directions:

- *Confirming:* the reliability results are real; refactoring in Elm is the best-in-class experience its users claim ("if it compiles, it works" is exaggerated but less than you'd think, because effects are data and state transitions are total functions); the architecture it enforced was so obviously right that Redux, XState, and half the signals world are its descendants.
- *Cautioning:* the walled garden has costs — a single-maintainer compiler with years between releases, a hard interop boundary that makes incremental adoption inside a TS codebase awkward (embed an Elm app in a subtree, talk through ports), and an ecosystem that a typed-JS team must leave behind entirely. Elm demonstrates that the guarantees are worth a lot *when you can commit a whole app*; it is a poor fit for "small pure modules inside a TS system," which is exactly the granularity our hypothesis targets.

The compile-to-JS neighbors fill in the spectrum: **PureScript** (Haskell-grade types including real HKTs and typeclasses, JS output, steep learning curve), **ReScript** (OCaml lineage, excellent inference and build speed, pragmatic mutation allowed, first-class React story), **Gleam** (simple, strict, friendly; BEAM-first with a JS target), **F#/Fable** (mature .NET language with a good JS backend). Each is a viable "different language for selected modules" answer; all pay the interop and hiring tax at their boundary, and none has meaningful training-data mass compared to TypeScript.

### 3.4 Plato: a pure functional language designed to compile away its purity

[Plato](https://github.com/cdiggins/plato) sits at a different point than any of the above: a small, statically typed, **pure** functional language designed so that idiomatic mathematical code — concrete types with fields, interface-like *concepts* providing operations, operator overloading, everything immutable and expression-oriented — can be compiled to efficient imperative output in mainstream targets (C# today, with JavaScript/TypeScript as a natural target). Its design premises align with this report's hypothesis almost one-to-one:

- **Purity as an analysis premise, not just a style.** Because the language has no mutation and no hidden effects, the compiler may assume referential transparency *everywhere* — every optimization in section 6 that TypeScript can only apply after a whole-program purity proof, Plato can apply unconditionally.
- **Small-module orientation.** Plato is aimed at libraries — geometry, vector math, numerics — exactly the "small pure strongly typed modules" of the hypothesis, not whole applications. The imperative host application calls into compiled pure kernels.
- **Value semantics throughout** — types are immutable data with value equality, which sidesteps the JS value-equality hole (§2.3) by construction in generated code.

This is the "DSL/subset in certain contexts" position taken to its logical end: rather than lint TypeScript into approximate purity, write the pure kernels in a language where purity is a theorem, and generate the TypeScript. The risks are the standard external-language ones — toolchain maturity, debugging through generated code, single-language-author bus factor, zero training-data presence (an agent writing Plato needs the grammar and stdlib in context) — but the *architecture* it implies is sound and testable: pure kernels in a checked language, orchestration in TypeScript, a generated boundary between them. Notably, the agent objection is weaker for a small language than a big one: a language whose entire grammar and idiom set fits in a few thousand tokens of context is one an agent can be *taught per-session*, which is not true of, say, Haskell.

### 3.5 The granularity argument

Putting §3.1–3.4 together, the options order by guarantee strength and adoption cost simultaneously:

| Approach | Purity guarantee | Adoption unit | Interop cost | Agent fluency |
|---|---|---|---|---|
| Plain TS + discipline | none | function | zero | maximal |
| Linted subset (this repo) | advisory | module | zero | maximal |
| eDSL (Effect, schemas) | semantic, within the DSL | subsystem | medium | low–medium |
| External language (Elm, PureScript, ReScript) | compiler-enforced | app / subtree | high | low |
| Generated kernels (Plato) | compiler-enforced | module | codegen boundary | teachable (small language) |

The hypothesis predicts the sweet spot is at **module granularity with the strongest guarantee you can afford there** — which is why the linted subset is the right default and generated pure kernels are the right escalation for the modules where correctness or optimization pressure is highest, while whole-app external languages are the right choice only when you can commit an entire deliverable to one.

---

## 4. The small-pure-module hypothesis, examined

Why would *small* pure typed modules be disproportionately easy to test, refactor, and reason about? The mechanisms are specific:

**Testing.** A pure function's test is a table: inputs, expected outputs. No fixtures, no mocks, no ordering. Two multipliers apply in the typed case. First, **property-based testing becomes natural**: [fast-check](https://fast-check.dev/) generates arbitrary inputs from the types, and purity is what makes properties (`decode(encode(x)) === x`, idempotence, commutativity) even *statable* — an impure function has no properties, only scenarios. Second, **golden/snapshot testing is sound**: same input, same output, forever, so a recorded output is a specification rather than a flake.

**Refactoring.** Referential transparency is literally the license to refactor: equals may be substituted for equals. Extract-function, inline, reorder, deduplicate, and memoize are all *semantics-preserving by construction* on pure code, and merely *hopefully-preserving* on impure code (where extracting a duplicated expression changes behavior if it has effects, and reordering changes behavior if it races a write). Strong typing then converts each mechanical refactor into a compiler-checked one. This is why "if it compiles it works" is truer in Elm than in TS, and truer in a readonly-discriminated-union TS module than in an `any`-ridden one: the fraction of behavior captured in types is the fraction of refactoring the compiler verifies.

**Reasoning — human and agent.** The companion report made the context-window-economics argument: purity puts a static bound on how much code an edit requires reading. The *small module* qualifier tightens it: a module whose public surface is a handful of total functions over immutable data is fully specifiable in its type signatures plus a paragraph — which is to say it fits in a prompt, a code review, or a working memory. Coupling through mutable state is precisely what breaks module-sized reasoning bounds; remove it and module size becomes an honest proxy for comprehension cost.

**The composition caveat.** The hypothesis is about modules, and the risk is at the seams: a system of beautifully pure modules glued by an imperative orchestrator has all its bugs in the orchestrator. That is still a win (the bugs are concentrated where you know to look, and the pure parts are excluded from suspicion during debugging), but honesty requires saying that purity relocates integration complexity rather than deleting it. Functional-core/imperative-shell is the pattern *because* the shell exists.

---

## 5. Historical evidence, briefly

Downplaying untyped JS as instructed, the record still supplies useful data points:

- **Redux's rise (2015–)** mainstreamed "state is an immutable value, updates are pure functions" for the largest developer population in history; its pain points (boilerplate) were ergonomic, not conceptual, and Redux Toolkit fixed them with Immer rather than by abandoning immutability. The concept won; the syntax was iterated.
- **React itself** moved *toward* purity over time — function components over classes, the "components must be pure" framing in the new docs, Strict Mode double-invoking renders specifically to flush out impurity, and the React Compiler (§6.3) making purity an optimization contract.
- **NoRedInk's Elm deployment** (hundreds of thousands of lines, near-zero runtime exceptions over years) remains the strongest production citation for compiler-enforced purity in a shipped web product.
- **Facebook's Flow/Immutable.js era** showed the interop ceiling of foreign-typed collections, which is why the ecosystem's second generation (Immer) chose "plain objects, checked discipline" over "special objects, real guarantees."
- **Jane Street (OCaml) and the finance/formal-methods world** supply the longer-run evidence that strongly typed mostly-functional code sustains large systems with small teams — with the same architecture this report converges on: pure core, imperative edges, mutation permitted locally where profiled.

---

## 6. Static analysis and optimization: making naive FP fast mechanically

The strongest version of the hypothesis is not "purity is worth its runtime cost" but "**purity's runtime cost is mechanically removable**, because pure code is the easiest code to optimize." The supporting evidence from compilers for pure languages is substantial, and the interesting question is how much transfers to TypeScript.

### 6.1 What compilers for pure languages actually do

- **Fusion / deforestation.** GHC's short-cut fusion rewrites `map f (map g xs)` into `map (f . g) xs` and, more generally, eliminates intermediate structures between producers and consumers (`foldr`/`build`, stream fusion). The naive pipeline the programmer wrote never allocates its middle lists. This is *only* sound because the functions are pure — the transformation reorders and merges applications.
- **Rewrite rules as user-extensible optimization.** GHC lets libraries declare equations (`{-# RULES "map/map" map f . map g = map (f.g) #-}`) that the compiler applies wherever the purity contract makes them valid. Optimization becomes a library concern, not only a compiler concern.
- **Perceus / functional-but-in-place (Koka, Roc, Lean 4).** Precise reference counting with reuse analysis: when the compiler proves a value's count is 1 at its last use, a "copy" is compiled into an **in-place mutation** of the same memory. Naive persistent-update code — rebuild the record with one field changed — becomes a store instruction when the old value is dead. This is the direct mechanical answer to §3.1 of the previous report ("allocation is the cost of immutability"): with uniqueness information, the copies are elided. Koka's "FBIP" style even lets programmers write recursive pure code that compiles to the same loop-with-mutation a C programmer would write.
- **Escape analysis and unboxing** (GHC, JVM, V8 alike): values proven not to escape are stack-allocated or held in registers; purity widens applicability because absence of aliasing is easier to prove.
- **Common subexpression elimination, memoization, parallelization** — all sound-by-default on pure expressions, all requiring effect analysis otherwise.

The pattern: every one of these is an *equational* transformation whose soundness condition is referential transparency. A pure language gets them for free; an impure language must first prove purity, which is usually where the analysis dies.

### 6.2 What exists for JS/TS today

- **V8/JSC/SpiderMonkey JITs** already do escape analysis, allocation sinking, and inlining — which is why short-lived spread objects are often cheaper than feared. But a JIT optimizes *hot paths from observed behavior*; it will not fuse your `map().filter().map()` pipeline (each callback is an observable call) and cannot assume purity of arbitrary functions.
- **Closure Compiler** performs whole-program dead-code elimination and property collapsing given annotations — an early proof that JS submits to aggressive static optimization when the program promises to be well-behaved.
- **Prepack** (Facebook, abandoned ~2019) tried symbolic evaluation of JS at build time — partially evaluating initialization into a residual program. Its failure is instructive: in *unrestricted* JS, almost anything can have effects, so the abstract interpreter drowned in soundness obligations. The lesson is not "this can't work" but "this can't work without a purity contract" — which is precisely what a functional subset supplies.
- **The React Compiler** (shipped with React 19) is the most important live example: it statically analyzes components *assumed to follow the Rules of React* (rendering is pure, props/state immutable) and auto-inserts fine-grained memoization. It is a production optimization pass whose soundness condition is exactly "you wrote in the pure subset," enforced by lint. This is the template: **subset + lint = license to optimize.**
- **Elm's compiler** does modest classical optimization (full dead-code elimination to declaration granularity, record field renaming) — and community work like `elm-optimize-level-2` showed sizable further wins (function unwrapping, better dispatch) were available cheaply *because* the language is pure. Notably Elm does *not* do fusion; even in pure languages, aggressive optimization has to be built deliberately.

### 6.3 What a TypeScript-targeted optimization pass could plausibly do

Given a mechanically enforced pure subset (lint + `readonly` + no-escape-hatch ratchet), a build-time pass over the TypeScript AST (via the compiler API, `ts-morph`, or an SWC/Babel plugin) could soundly perform:

1. **Pipeline fusion:** rewrite `xs.map(f).filter(p).map(g)` chains into a single loop (or a single `reduce`), eliminating intermediate arrays. Sound when `f`, `p`, `g` are pure — which the subset asserts and a conservative checker (no free mutable variables, no calls outside a pure whitelist) can verify per call site. This is deforestation as a lint-fixer.
2. **Quadratic-spread rewriting:** detect `[...acc, x]` / `{...acc, ...}` in accumulator position inside `reduce`/loops and rewrite to a local mutable accumulator that never escapes — the Perceus insight applied syntactically: the intermediate is dead, so mutate it. (Today `eslint-plugin` rules can at least *detect* this; the fix is mechanical.)
3. **Copy elision on unique references:** within a function, when a locally constructed object is spread-updated and the original is provably dead (no other reads), collapse to in-place field writes. A conservative intraprocedural liveness analysis suffices for the common cases.
4. **Auto-memoization and CSE:** hoist repeated pure calls; memoize expensive pure functions by reference-keyed cache where profiling or annotation warrants — sound only under purity, and identity-keyed caches are sound only under immutability. (The React Compiler is this, specialized to components.)
5. **Shape stabilization:** rewrite conditional spread (`...(c ? {k} : {})`) into fixed-shape objects with `undefined` fields, keeping hidden classes monomorphic — a pure-subset-safe transformation with outsized JIT benefit (§6 of the previous report).
6. **Const-folding and partial evaluation of the eDSL layer:** schemas, pipelines, and other programs-as-values (§3.2) can be specialized at build time — compile a Zod schema to a monomorphic validator function, a `pipe` of known stages to a fused function. Several libraries already do this at runtime (ArkType compiles validators via `new Function`); a build-time pass moves the cost to compile time.

None of this is speculative machinery — each item has a working precedent (GHC rules, Perceus, React Compiler, ArkType's compiled validators). What does not exist is the *assembled* tool: a purity-aware optimizing pass for a linted TypeScript subset. That gap is a genuine opportunity, and it is also the strongest architectural argument for the Plato-style approach: a language that is pure by construction can ship these passes in its one compiler, whereas the TS-subset route must maintain both the subset checker and the pass, and every unchecked escape hatch (an `any`, a JS dependency) is a soundness hole the pass must treat conservatively.

The realistic ordering for a project like this one: items 2 and 5 are lint-fixers you could ship this month; item 1 is a focused transform over verified-pure callbacks; items 3, 4, and 6 want real analysis and should be driven by profiles, not ambition.

---

## 7. Recommendations

1. **Default stack for typed immutable state:** plain readonly types + spread for flat updates; **Immer** (or Mutative if profiled) for nested updates; patches for undo/sync. Reserve **persistent collections (Rimbu, funkia/List)** for the specific large-collection profiles that need them; do not adopt Immutable.js today.
2. **Take single-idea libraries over paradigm libraries:** neverthrow for `Result`, ts-pattern for matching, Remeda for utilities, fast-check for properties. Adopt **Effect** only as a deliberate framework commitment by a team that will learn it — and expect degraded agent assistance inside it.
3. **Enforce the pure subset per-module with lint + ratchet** (this repository's existing bet) and treat it as the default home of the hypothesis: small pure modules, property-tested, with signatures rich enough that the compiler checks refactors.
4. **Use an external pure language only at a clean granularity:** a whole app or subtree for Elm-class languages; **generated kernels for Plato-class languages** — pure, hot, correctness-critical modules (math, geometry, parsing, pricing) where compiler-enforced purity and optimization license justify a codegen boundary. For agent authorship, prefer small languages whose full definition fits in context.
5. **Exploit programs-as-values where you already have them:** schemas and pipelines are optimizable descriptions; prefer libraries that compile their DSLs (ArkType-style) and structure your own DSLs so a later pass can specialize them.
6. **Treat optimization of pure code as a build concern, not a style concern.** Write the naive `map`/`filter` pipeline; add the mechanical fixes (quadratic-spread rewriting, shape stabilization) as lint-fixers now; grow toward fusion and copy elision only where profiles demand it. The purity discipline is what keeps every one of those transformations sound and cheap to apply later — that optionality is itself a return on the discipline.

---

## 8. Conclusion

The library landscape has matured into a clear shape: draft-based copy-on-write (Immer/Mutative) won the update-ergonomics problem, persistent structures survive only in niches where their asymptotics are decisive, and the paradigm frameworks (fp-ts → Effect) demonstrate both that full typed FP is expressible in TypeScript and that expressing it strains the language, the team, and the code-generating agent.

The subset-and-DSL question resolves by granularity. Elm shows compiler-enforced purity delivering its promises at whole-app scale and paying interop costs that make it wrong for module-scale adoption. The linted TypeScript subset delivers most of the reasoning, testing, and refactoring benefit at module scale for near-zero cost, but with advisory guarantees. A Plato-style generated kernel — a small pure language compiled into the host — is the coherent way to get compiler-grade guarantees *at* module granularity, and its small size is an unexpected asset in the agent era, since the whole language can be taught to an agent in-context.

On the hypothesis itself: the mechanisms all point the same way. Purity makes tests tables, makes properties statable, makes refactoring equational, bounds the context an edit needs, and — the under-appreciated point — makes efficiency a *mechanical* concern, because every classic optimization of functional code is an equational rewrite whose soundness condition is exactly the purity the discipline enforces. Small, pure, strongly typed modules are not just easier to reason about; they are the only modules for which the reasoning, the testing, and the optimizing can all be delegated to machinery. That is the version of H5/H6 worth betting a toolchain on.
