# Testing, Gates, Ratchets, and Goldens: A Taxonomy of Mechanical Enforcement

**Status:** technical report.
**Date:** 2026-08-22
**Companion to:** [agent-development-framework-2026-08-18.md](agent-development-framework-2026-08-18.md), [tdd-for-agents-2026-08-22.md](tdd-for-agents-2026-08-22.md)

---

## 1. What this document is

This project's central bet is that correctness enforcement should live in tools rather than prompts: "prompts are advisory; a failing build is not." That bet gets stated in terms of a small vocabulary — *tests*, *gates*, *ratchets*, *goldens* — that is used loosely across the industry and inconsistently even within single teams. This report pins the vocabulary down, places each mechanism in a common frame, and says which variant this project should use for which job.

The organizing claim: all of these mechanisms are the same kind of thing — **a machine-checkable claim about the codebase, plus a policy about what happens when the claim is false.** They differ along four axes:

1. **What is claimed** — a behavior, an invariant, a count, an exact output, a shape.
2. **When it is checked** — on every edit, on commit, on merge, on schedule, in production.
3. **Which direction change may move** — anything goes, never worse (floor), only better (ratchet), exactly the same (pin).
4. **Who may bless a change to the claim itself** — nobody, a human, the same agent that wrote the code.

Axis 4 is the one the agent era makes decisive. Every mechanism below is only as strong as the answer to "can the worker rewrite the rule?" — the reward-hacking evidence in the [TDD report](tdd-for-agents-2026-08-22.md) (section 4.2) shows that when the answer is yes, frontier models will, under pressure, take that exit.

---

## 2. Tests: claims about behavior

A test executes code and compares observed behavior to a claim. The varieties differ in how the claim is stated, which determines what they can catch and how they fail.

**Example tests** state the claim as a specific input/output pair. They are cheap to write, trivially readable, and the weakest form per unit of effort: each one samples a single point, and an agent can pass one by special-casing the input ([ImpossibleBench](https://arxiv.org/abs/2510.20270) documents exactly this). Their irreplaceable use is the *regression test*: a bug is a specific point the previous evidence missed, and pinning that point is precisely an example.

**Property tests** ([fast-check](https://fast-check.dev/), the [QuickCheck](https://dl.acm.org/doi/10.1145/351240.351266) lineage) state the claim as an invariant over generated inputs: round-trips with its inverse, idempotent, order-independent, agrees with the naive implementation. One property covers the space that dozens of examples sample, and there is no fixed expected output to hard-code against, which makes properties far harder to reward-hack. They demand pure functions to be tractable — which is why they fit this project's subset unusually well. Run with fixed seeds where determinism matters; let seeds vary in scheduled runs to keep exploring.

**Characterization tests** ([Feathers](https://www.oreilly.com/library/view/working-effectively-with/0131177052/), *Working Effectively with Legacy Code*) invert the direction of authority: instead of asserting what the code *should* do, they record what it *currently does*, so that future changes to that behavior become visible. The claim is descriptive, not normative. This matters for axis 4: a failing characterization test does not mean the code is wrong; it means the behavior changed and someone must now decide whether that was intended. Goldens (section 5) are the industrialized form.

**Differential tests** state the claim as agreement between two implementations — a fast one against a slow obviously-correct one, a new one against the one being replaced, or the same code before and after a refactor. Like properties, they need no oracle beyond the reference, so they are cheap to generate and hard to game. Fuzzing is the degenerate case where the only claim is "does not crash."

**Type-level assertions** ([expectTypeOf](https://vitest.dev/guide/testing-types), [tsd](https://github.com/tsdjs/tsd)) state the claim as a type and let the compiler check it. They never execute, never flake, and cost nothing per run — the limiting case of a test, and the preferred form wherever the claim is expressible as a type (principle 0: proofs and static analysis trump tests).

**Mutation testing** ([StrykerJS](https://stryker-mutator.io/), [Just et al. 2014](https://dl.acm.org/doi/10.1145/2635868.2635929)) is not a test but a test *of the tests*: seed small defects, count how many the suite detects. It answers the question coverage cannot — does this suite detect anything? — and is therefore the correct arbiter for the two test-suite policies this project wants: rejecting tautological agent-written tests (a new test that kills no mutants is dead weight) and permitting test deletion (allowed when the incremental mutation score does not drop).

Note what coverage is *not* on this list. Coverage measures execution, not verification; as a target it invites tests that run code without checking it ([Fowler](https://martinfowler.com/bliki/TestCoverage.html)). Its one legitimate role here is as a *diff-scoped floor* inside a gate — "the changed public surface is executed by something" — never as a global percentage to maximize.

---

## 3. Gates: claims with a checkpoint

A gate is any check wired to a checkpoint such that failing the check blocks passage. The check can be anything from section 2 plus compilers, linters, formatters, dependency rules, and API-surface diffs; what makes it a *gate* is the blocking policy and the placement.

**Placement is the design decision.** The standard points, ordered by feedback latency:

- **Per-edit** (watch-mode `tsc`/`vitest`, post-edit hooks): seconds. This is where TDD's real payload — small verified increments — gets delivered without the ritual. For agents this placement is disproportionately valuable, because an agent's failure compounds silently across edits until something checks; the earlier the check, the fewer tokens are spent building on a broken foundation.
- **Pre-commit / pre-push** (hooks): tens of seconds. Cheap syntactic and formatting checks belong here; anything slow gets bypassed with `--no-verify`, and a gate that is routinely bypassed is worse than none because it launders "checked" onto unchecked work.
- **Merge / CI**: minutes. The full type-aware rule set, the whole suite, mutation testing in incremental mode, the ratchets (section 4). This is the gate of record — the one that defines *green*.
- **Scheduled**: nightly property runs with fresh seeds, full mutation runs, dependency audits. Claims worth checking but too slow for the merge path.

Two failure modes recur. **Gate-gaming**: when the fastest route to green is a cast or a disabled rule, agents take it — which is what ratchets exist to close. **Gate rot**: a gate that flakes or drags gets routed around by humans and agents alike; latency is a correctness feature, and a slow gate should be split (syntactic per-edit, type-aware at merge) rather than tolerated.

The project's stance, argued in the [framework notes](agent-development-framework-2026-08-18.md) section 6: one script, one definition of green (`platonic check`), run continuously rather than only at the checkpoint — so the checkpoint confirms what the loop already knew.

---

## 4. Ratchets: gates that only tighten

A ratchet is a gate over a *measurement* with a committed baseline and a one-way policy: the number may fall, may stay, may never rise. The mechanical form is simple — a checked-in count plus a script that compares — and the crucial property is that improvement is captured automatically: when the count falls, the baseline falls with it, and the gate now defends the better number.

The pattern has several independent inventions: [Betterer](https://phenomnomnominal.github.io/betterer/) (tests that "get better, not worse"), ESLint's [bulk suppressions](https://eslint.org/docs/latest/use/suppressions), `type-coverage`'s `--at-least` mode, and countless in-house scripts. Google's monorepo literature calls the general idea a *tripwire*; performance engineering calls its cousin a *budget* (bundle size, latency) — a fixed ceiling rather than a descending one, appropriate when the current value is acceptable and only regression matters.

What ratchets are for, precisely: **legalizing a standard that the codebase does not yet meet.** A strict rule applied as a hard gate to an existing codebase fails everywhere at once, so it never gets turned on; applied as a ratchet, it is on *today*, existing debt is grandfathered at its current count, and every touched file pays down rather than adds. This is the only known way to adopt strictness incrementally without a stop-the-world migration.

This project's first ratchet is the escape-hatch ratchet: committed counts of `any`, `as`, `!`, `@ts-ignore`, and `eslint-disable`. The choice of *these* counts is not arbitrary — they are exactly the constructs by which an agent games every other gate. A cast doesn't just weaken one line; it propagates unsoundness downstream, after which the type-checker reports success on code that has already lost its guarantees. The ratchet closes the gate-gaming exit: the agent that cannot pass the type-checker honestly also cannot pass it dishonestly, because the dishonest route increments a monotone counter.

Ratchet-specific failure modes, and their answers:

- **Gaming through configuration.** An agent that cannot pass a rule can edit the rule, the baseline file, or the counting script. Answer: the ratchet's own inputs (configs, baselines, the check script) are protected files — a diff touching them is a hard stop for human review. Axis 4 again: the ratchet is only a ratchet if the worker cannot move it.
- **Gaming through relocation.** Counts scoped per-file can be dodged by moving code; global counts can be dodged by deleting unrelated debt to "pay for" new debt elsewhere. Prefer global counts (relocation-proof) and accept the offset trade as usually benign — the total still fell or held.
- **The asymptote.** Ratchets drive counts toward zero but the last few instances are often the legitimately-necessary ones (FFI boundaries, JSON parsing). When a count plateaus at its floor, convert the survivors to explicitly-annotated allowlisted sites and drop the count to zero — the ratchet retires into a hard gate.

---

## 5. Goldens: claims pinned to an exact artifact

A golden (approval test, snapshot test — [Vitest snapshots](https://vitest.dev/guide/snapshot), [ApprovalTests](https://approvaltests.com/)) records a computation's full output as a checked-in file and claims exact equality thereafter. On axis 3 it is a *pin*: not "never worse" but "exactly this, until a human blesses a change."

Goldens occupy a specific niche that example tests and properties cannot: **stabilizing behavior that already exists and is too rich to restate.** A code generator's output, a formatter's rendering, an error message catalog, a compiler's diagnostics, an API response shape — writing assertions for these piecewise is expensive and lossy; capturing the artifact is free and complete. This makes goldens the natural instrument for the *stabilize* half of spike-and-stabilize: the spike produced behavior, the golden pins it, and the contract review happens as a review of the golden file itself.

Everything about goldens follows from where the verification actually happens. Generation is mechanical and verifies nothing — the tool will happily record garbage. **The entire evidentiary weight rests on the human review of the golden diff.** From that, the discipline:

- **Bless at promotion, in review, never in bulk.** `--update-snapshots` regenerates every golden to match current behavior, whatever it is; run reflexively, it converts the whole corpus from specification back to description. An updated golden is a contract change and its diff is the review artifact. For agents this must be mechanical, not customary: golden updates by the implementing agent are flagged the same way test edits inside a fix task are — the specification must not be writable by the thing being specified.
- **Keep goldens reviewable or they will not be reviewed.** Deterministic serialization, volatile fields (timestamps, ids, paths) scrubbed before capture, one artifact per concern, stored as files on disk (`toMatchFileSnapshot`) rather than inline blobs — a golden whose diff a human cannot read in seconds has no verification content at all.
- **Prefer the narrowest capture that carries the contract.** Full-output goldens over-pin: they fail on every harmless change, and a suite that cries wolf trains its reviewers to bless without reading — the same decay path as coverage targets. When a golden churns constantly, the contract is narrower than the capture; capture the contract.

Goldens and characterization tests are the same mechanism at different scales; goldens and properties are complements, not rivals — the property states what must always hold, the golden pins the concrete residue the property doesn't reach.

---

## 6. The remaining relatives

Briefly, the neighboring mechanisms that complete the map:

- **Contract / API-surface gates** ([API Extractor](https://api-extractor.com/) reports): a golden over the *type* surface. The report is a checked-in artifact; a diff means the public contract changed and triggers the coverage rules in the TDD report's section 7. The highest-value golden in a library-shaped project.
- **Dependency rules** ([dependency-cruiser](https://github.com/sverweij/dependency-cruiser)): claims about the import graph — spikes cannot be imported by shipping code, layers point one direction. Structural claims, checked statically, impossible to express as a test.
- **Baseline-diff analyzers**: the general trick underlying ratchets — run any analyzer, diff against a committed prior result, fail on new findings only. Turns any noisy tool into an adoptable gate.
- **Canaries and production checks**: the same claims checked after the checkpoint rather than before. Out of scope for a design-phase single-repo project, but the frame extends there unchanged.

---

## 7. The map, and the policy

The four axes compress into a placement rule:

| Mechanism | Claim | Direction | Who blesses change |
|---|---|---|---|
| Example / regression test | one behavior point | floor | human (test edits reviewed) |
| Property test | invariant over inputs | floor | human |
| Type-level assertion | shape | floor | compiler arbitrates |
| Golden | exact artifact | pin | human, at promotion, via diff |
| Gate (compiler, lint, suite) | conjunction of the above | floor | protected config |
| Ratchet | a count | monotone down | nobody (baseline auto-tightens) |
| Budget | a measurement | ceiling | human |
| Mutation score | suite detection power | floor | arbitrates test deletion |

**Choose by what you know and what changes.** Know the invariant: property. Know one point (a bug): example. Have rich existing behavior: golden. Can state it as a type: type assertion, and delete the runtime test it subsumes. Have a standard the code doesn't yet meet: ratchet. Have a standard it does meet: gate. Distrust the suite itself: mutation score.

**And the single rule that runs through every row:** the mechanism verifies only while the worker cannot rewrite the claim. Tests separated from implementation edits, golden updates reviewed as contract changes, ratchet baselines and gate configs as protected files, mutation score as the arbiter where judgment used to be. That is one principle applied four times — and it is the whole reason this vocabulary earns a place in a project about agents: each of these mechanisms is a way of making a rule that an agent cannot litigate.

---

## 8. Sources

[Fowler on test coverage](https://martinfowler.com/bliki/TestCoverage.html) · [QuickCheck (Claessen & Hughes 2000)](https://dl.acm.org/doi/10.1145/351240.351266) · [fast-check](https://fast-check.dev/) · [Feathers, *Working Effectively with Legacy Code*](https://www.oreilly.com/library/view/working-effectively-with/0131177052/) · [Vitest snapshots](https://vitest.dev/guide/snapshot) · [ApprovalTests](https://approvaltests.com/) · [Betterer](https://phenomnomnominal.github.io/betterer/) · [ESLint bulk suppressions](https://eslint.org/docs/latest/use/suppressions) · [StrykerJS](https://stryker-mutator.io/) · [Just et al. 2014](https://dl.acm.org/doi/10.1145/2635868.2635929) · [API Extractor](https://api-extractor.com/) · [dependency-cruiser](https://github.com/sverweij/dependency-cruiser) · [ImpossibleBench](https://arxiv.org/abs/2510.20270) · reward-hacking evidence collected in the [TDD report](tdd-for-agents-2026-08-22.md), section 4.2.
