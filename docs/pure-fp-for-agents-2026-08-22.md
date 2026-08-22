# Pure Functional Programming for Agent-Driven Development

**Status:** technical report.
**Date:** 2026-08-22
**Companion to:** [agent-development-framework-2026-08-18.md](agent-development-framework-2026-08-18.md)

---

## 1. What this document is

The [README](../README.md) stakes this project on two hypotheses about functional programming: "Mutable state is harder to reason about" (H5) and "Pure functional code is easier to reason about" (H6), plus the approach item "Prefer pure functional code whenever possible." Like the TDD positions examined in the [TDD report](tdd-for-agents-2026-08-22.md), these deserve to be checked against evidence rather than asserted — especially because the evidence is genuinely mixed, and because the strongest argument *against* functional programming in an agentic context (training-data distribution) is one the classic FP literature never had to consider.

This report examines the case for and against pure functional programming when the primary author of the code is a coding agent. It distinguishes three things that are often conflated: pure functional *languages* (Haskell, OCaml), heavy functional *abstractions* in mainstream languages (fp-ts-style monadic TypeScript), and a pure functional *subset* of a mainstream language (readonly data, expression-oriented plain functions, effects at the edges). The distinction turns out to carry most of the conclusion.

---

## 2. What the pre-agent evidence actually says

Before asking what changes with agents, it is worth being honest about the human-era evidence, because H6 is often presented as settled when it is not.

**The defect-rate evidence is weak.** The most-cited support is [Ray, Posnett, Devanbu, and Filkov (2014)](https://cs.uwaterloo.ca/~m2nagapp/courses/CS846/1171/papers/ray_fse14.pdf), which studied 729 GitHub projects across 11 languages and reported that "functional languages have a smaller relationship to defects than either procedural or scripting languages" — with the caveat, in the original, that the effect was small. The [2019 reproduction study by Berger et al.](https://dl.acm.org/doi/fullHtml/10.1145/3340571) is close to a demolition: after data cleaning and statistical corrections, only four of the eleven language associations survived (C++ positively associated with defects; Clojure, Haskell, and Ruby negatively), the repetition was only partially successful due to missing code and language-classification problems, and the headline claim about language *classes* did not hold up. A [subsequent Bayesian reanalysis](https://arxiv.org/pdf/2101.12591) found the surviving effects small enough to be of little practical significance. Haskell and Clojure do survive on the favorable side of the reanalysis — but as two languages with modest effects, not as a vindication of a paradigm.

**Functional constructs in mainstream languages can cut the other way.** [A 2025 study in Empirical Software Engineering](https://link.springer.com/article/10.1007/s10664-024-10568-z) mined ~630,000 commits across 200 Python projects and found that changes adding or modifying functional constructs (lambdas, comprehensions, map/reduce/filter) had *higher* odds of inducing later fixes than other changes, correlating with construct complexity. The plausible reading is not "functional is worse" but "dense functional one-liners bolted onto an imperative language concentrate defect risk" — which is an argument about *how* functional style is adopted, and directly relevant to section 5.

**The strong claims survive as mechanism, not measurement.** What does hold up, because it is definitional rather than statistical: a pure function's behavior is fully determined by its inputs; immutable data cannot be changed by distant code; referentially transparent expressions can be reasoned about, tested, cached, and reordered locally. These properties are not hypotheses — they are what purity *means*. The open question H5/H6 actually poses is whether those properties translate into faster, cheaper, more accurate work, and for agents that question has new mechanics.

---

## 3. The case for purity with agents

The agent era changes the arithmetic in FP's favor in several specific, mechanical ways.

### 3.1 Local reasoning is context-window economics

For a human, "easier to reason about" is a cognitive claim. For an agent it is a *billing* claim. An agent editing a pure function needs the function, its type signature, and its callees' signatures — a few hundred tokens. An agent editing a method that reads and writes shared mutable state needs everything that state touches: initialization order, every other writer, aliasing, lifecycle. Purity puts a static bound on how much context a correct edit requires; mutable state makes that bound whole-program in the worst case. This is the token-cost goal of the README made concrete: the same edit, at the same quality bar, needs less context when the blast radius is guaranteed local. Industry commentary on [why functional languages suit LLM-assisted programming](https://bensaadi.com/2024/09/functional-languages-for-llm-assisted-programming/) makes the same point from the prompt-construction side: imperative and OO code scatters state and logic across locations, making it hard to hand a model clean, sufficient context.

### 3.2 Purity is what makes verification cheap

The companion documents bet on tools over process: a continuous gate, static analysis over run-time evidence. Purity is the property that makes those tools strong.

- **Deterministic tests.** A pure function cannot produce a flaky test. Flaky tests are poison for agents specifically — a spurious red sends an agent off to "fix" working code, and a spurious green launders a real defect. Determinism removes the entire class.
- **Property-based testing works best on pure functions.** [Recent work on bridging LLM generation and validation with property-based testing](https://arxiv.org/html/2506.18315v1) uses invariants plus generated inputs as the verifier in a generate/test agent loop; the approach presupposes functions whose behavior is a checkable function of inputs. With [fast-check](https://www.davideaversa.it/blog/property-based-testing-typescript-fast-check/) this is off the shelf in TypeScript. A property over a pure function is a stronger, shorter specification than example tests — fewer tokens to state, harder to reward-hack than a hand-picked example (the TDD report's section 4.2 documents why that matters).
- **Test caching becomes sound.** H12's claim — pure code plus content addressing means tests never rerun on unchanged functions — is only *sound* under purity. [Unison](https://www.unison-lang.org/) demonstrates the mechanism. Impure code invalidates it: a test's result can change without its transitive code changing.
- **Purity is statically enforceable.** Unlike "write good code," "no mutation, no throw, no expression statements" is checkable by [eslint-plugin-functional](https://github.com/eslint-functional/eslint-plugin-functional) and `readonly` types. That moves the rule out of the prompt and into the gate — the project's central move. An agent cannot argue with a lint error, and (unlike a test) cannot delete it.

### 3.3 Immutability is what makes agent parallelism tractable

H4 claims mutable state makes agentic parallelism harder; the mechanism is concrete. Two agents editing code that shares mutable state can each produce individually-green changes that are jointly wrong — writer interleavings, invalidated invariants — and no textual merge detects it. Two agents editing disjoint pure functions compose: if both are green and the types agree at the seam, the combination is green. The [worktrees report](worktrees-and-branches-for-agents-2026-08-22.md) chose a shared tree for concurrent agents; pure functions with narrow signatures are precisely what makes file-level work partitioning honest, because the file boundary *is* the dependency boundary. The same property underpins the multi-agent refactoring literature — [LLM multi-agent systems working over Haskell](https://arxiv.org/html/2502.07928v1) lean on purity to let agents transform code independently.

### 3.4 Expressions match how agents edit

Expression-oriented code — small functions, data-in data-out, pipelines — produces smaller diffs per unit of behavior change, and diffs whose correctness is visible in the hunk itself rather than in distant control flow. Every README preference in this family (expressions over statements, data-flow emphasis, succinct code, small files) reduces the tokens an agent reads and emits per edit and reduces the chance that a correct-looking local edit is globally wrong. It also shrinks the surface for H9-style rot: a function with no state has no "history" for an agent to narrate in comments.

---

## 4. The case against

### 4.1 The training-data problem is real — for pure functional *languages*

LLMs are distribution machines, and pure functional languages are thin in the distribution. The [FPBench evaluation](https://arxiv.org/pdf/2601.02060) (721 tasks across Haskell, OCaml, Scala) found a consistent, persistent gap: GPT-3.5 passed 14.5% in Haskell and 9.4% in OCaml against 22.2% in Java, with compilation-error rates of 25–43% in the pure languages; stronger models narrow but do not close the gap, and error rates remain significantly higher in purely functional languages than in hybrid or imperative ones. The broader [low-resource-language literature](https://arxiv.org/pdf/2410.03981) tells the same story: model capability tracks corpus volume. The same evaluation found something subtler and more damning for prompt-level fixes: even when models emit functional-language syntax, they [generalize from imperative training data](https://arxiv.org/pdf/2601.02060), producing code that betrays purity, immutability, and declarative control flow. An agent writing Haskell is, statistically, an imperative programmer writing Haskell.

For this project the force of the objection is blunted but not gone. TypeScript is among the highest-resource languages there is, so choosing a *subset* of TypeScript sidesteps the corpus problem at the language level. But idioms have corpora too: `readonly` records, `ReadonlyArray`, discriminated unions, and expression-style TypeScript are common in the training data; fp-ts-style monadic TypeScript is not. The closer the enforced subset stays to mainstream TypeScript idiom, the more of the model's competence it keeps.

### 4.2 Heavy abstraction failed its own community first

The cautionary tale is [fp-ts](https://github.com/gcanti/fp-ts): the flagship of monadic TypeScript, which [merged into Effect](https://dev.to/effect/a-bright-future-for-effect-455m) after its author concluded the library had to be re-adapted "as the target user group shifted from functional programming experts to mainstream TypeScript users." HKT emulation, `pipe`-chained type-class instances, and monad transformers produced a dialect that most TypeScript developers could not read — and that produces the deep, page-long generic errors that are expensive for anyone to debug and are *paid per token* when the debugger is an agent. The [Python fix-inducing study](https://link.springer.com/article/10.1007/s10664-024-10568-z) is the quantitative echo: functional constructs grafted onto a mainstream language, at high density, correlate with more fixes, not fewer. Purity as data discipline and purity as abstraction tower are different bets; the evidence favors the first and warns against the second.

### 4.3 Effects exist, and the boundary must live somewhere

A program that only contains pure functions does nothing. File IO, processes, the network, the clock — the tooling this project intends to build (`platonic check` itself) is effectful at its core. Pure FP does not remove effects; it relocates them, and the relocation has costs: an imperative-shell/functional-core architecture must be designed and *policed*, TypeScript gives no compiler help distinguishing pure from impure calls (no effect types), and the Node ecosystem is pervasively impure, so every third-party dependency is a hole in the discipline. The lint subset can ban mutation syntax but cannot see through a library call. The honest statement is that purity in TypeScript is a *convention enforced at the syntax level*, weaker than what Haskell's type system guarantees — real, but partial.

### 4.4 Residual costs

- **Performance.** Immutable update in TypeScript is copy-based; without structural-sharing libraries, hot paths pay allocation and GC. Usually irrelevant for tooling workloads, occasionally decisive; the escape hatch (local mutation inside a pure function, invisible to callers) must be permitted or the rule gets ignored.
- **Update verbosity.** Deep immutable updates via spread are noisy and error-prone — precisely the "dense construct" risk of section 4.2 in another form. This is a place where agents' tolerance for boilerplate helps, but the tokens are still paid.
- **Agent drift under convenience pressure.** Left unenforced, agents mutate — it is the dominant pattern in their training data. This is not an argument against purity; it is the argument for the ratchet and gate rather than a CLAUDE.md sentence. But it means the discipline has a standing enforcement cost.

---

## 5. Synthesis

The pros and cons sort cleanly once the three meanings of "pure FP" from section 1 are kept apart:

| Bet | Verdict |
|---|---|
| Pure functional **language** (Haskell/OCaml) | Wrong bet for agents today. The verification and reasoning benefits are real, but the [training-data gap](https://arxiv.org/pdf/2601.02060) taxes every single generation, and the tax compounds across an agentic workflow. |
| Heavy functional **abstraction** in TypeScript (fp-ts style) | Wrong bet, per its [own ecosystem's retreat](https://dev.to/effect/a-bright-future-for-effect-455m) and the [fix-inducing evidence](https://link.springer.com/article/10.1007/s10664-024-10568-z). Low-resource idiom inside a high-resource language re-creates the corpus problem, plus type-error debugging costs. |
| Pure functional **subset** of TypeScript (readonly data, plain functions, expressions, effects at the edges) | The favorable trade. Keeps the mechanical benefits — bounded context per edit (3.1), cheap and strong verification (3.2), sound test caching (3.2), composable parallel agent work (3.3) — while staying inside the idiom the models know best. |

The subset bet also has the right enforcement shape for this project: purity-as-syntax is exactly what a lint gate can check, so the discipline lives in `platonic check` rather than in prompts, and section 4.4's drift problem becomes a ratchet count rather than a supervision burden.

What the evidence does **not** yet support is H5/H6 as measured outcomes — the human-era defect data is inconclusive, and no one has published tokens-per-task or first-attempt-accuracy comparisons for functional-subset versus unrestricted TypeScript under agents. That is a measurement this project is positioned to produce (Challenges: Measurement, H11), and it should be treated as an open experiment, not a settled premise.

### Recommendations

1. **Enforce purity as a syntactic subset, not an abstraction style.** `readonly`/`ReadonlyArray` everywhere, no `class` state, no `throw`, expressions over statements — via [eslint-plugin-functional](https://github.com/eslint-functional/eslint-plugin-functional) in the gate. No fp-ts/Effect-style monadic core.
2. **Functional core, imperative shell, with the shell explicitly marked.** Isolate effectful code in designated modules (thin, boring, mostly library calls); apply the strict rules to everything else. The lint config can differ by directory, which makes the boundary machine-visible.
3. **Spend the purity dividend on verification.** Property-based tests ([fast-check](https://www.davideaversa.it/blog/property-based-testing-typescript-fast-check/)) over the pure core, and content-addressed test caching (H12) as a later deliverable — both are only sound because of the purity the gate enforces.
4. **Permit local mutation inside pure functions.** A function that builds an array imperatively but is observably pure keeps the callers' guarantees at none of the allocation cost, and matches the training distribution. Purity at the interface, pragmatism inside.
5. **Measure H5/H6 instead of assuming them.** Once `platonic check` exists, compare tokens-per-task and rework rate on tasks inside vs. outside the enforced subset. This report's conclusion is a prediction; the project's own instrumentation is the test.
