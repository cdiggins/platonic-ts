# Project Anatomy

**Status:** taxonomy. Names the parts of a TypeScript project and derives a maintenance policy for
each part from a small set of axes. Descriptive for now; nothing here is enforced by tooling yet.
**Date:** 2026-08-22
**Companion to:** [agent-development-framework-2026-08-18.md](agent-development-framework-2026-08-18.md),
[tooling-catalog.md](tooling-catalog.md), [deliverable-ideas-2026-08-22.md](deliverable-ideas-2026-08-22.md)

---

## The question

A TypeScript project is usually described as five things: source files, tests, documentation,
tooling, dependencies. That list is too coarse to build tools against. The gate (B2), the ratchet
(B3), the index generator (B5), and the decision logs (B15) each operate on a specific class of
artifact, and the rules an agent should follow — what it may create, what it must regenerate, what
it must delete — differ by class, not by whim.

This document does three things: extends the five-part list to the categories it misses, breaks the
result into a finer tree, and then makes the claim that matters for maintenance: **policy follows
from a handful of cross-cutting axes, not from the categories themselves.** The categories are for
finding things; the axes are for keeping them healthy.

## What the five-part list misses

- **Configuration.** `tsconfig.json`, the ESLint rule set, Prettier settings, Vitest config. This is
  the policy layer, distinct from tooling: ESLint is a tool, the project's rule set is configuration.
  They are maintained differently — tools are upgraded, configuration evolves with the codebase.
- **Contracts.** The public API surface, type declarations, schemas and data models, wire formats,
  the CLI interface, the error taxonomy. In TypeScript these are partially separable from
  implementation (`.d.ts` files, an API Extractor report). They earn their own category because the
  README already commits to it: signatures, type declarations, and interfaces require more clarity
  and care than implementations.
- **Automation.** CI pipelines, git hooks, codegen, release scripts, `package.json` scripts. Also
  distinct from tooling: a tool is something invocable; automation decides *when* it runs.
- **Distribution.** Build output, sourcemaps, the exports map, npm metadata, version numbers, the
  changelog. The published form of the project, almost entirely derived.
- **History.** Commits, tags, releases. A first-class artifact, not exhaust: agents mine it to
  answer "why is this here," and commit discipline is a form of maintenance.
- **Environment.** Node version, the `engines` field, browser targets, the *shape* of required
  environment variables (`.env.example`). A common source of silent breakage because nothing checks
  it.
- **Agent layer.** CLAUDE.md / AGENTS.md, skills, MCP configuration. New enough that most
  taxonomies omit it; central to this project.

## The tree

### Product

What ships, or could.

- **Implementation source** — function bodies, module internals. Highest churn, lowest ceremony.
- **Contracts** — exported types, schemas, data models, domain-specific languages, error taxonomy.
  Slowest churn, highest care.
- **Boundary code** — wrappers exposing the library to other languages or platforms, adapters.
  Owned by the project but shaped by an external surface.
- **Generated code** — codegen output checked into the tree. Source-shaped but derived: regenerate,
  never hand-edit.
- **Vendored code and dependency patches** — external code the project has taken responsibility
  for. A liability register more than a code category.

### Verification

Everything whose job is to fail when the product is wrong.

- **Test cases**, by what they assert: unit, integration, end-to-end, smoke, regression,
  property-based, golden/snapshot, contract, fuzz — and **type-level tests** (`expect-type`,
  `tsd`), which are TypeScript-specific, run at compile time, and cost nothing at runtime.
- **Benchmarks** — tests with a numeric assertion and a tolerance. Same lifecycle as regression
  tests, different failure signal.
- **Ephemeral verification** — spikes-as-tests and in-flight scaffolding tests written to drive out
  a design. Legitimate, but born with an expiry: the README's "delete tests when not necessary
  anymore" applies to exactly this class.
- **Test infrastructure** — fixtures, test data, factories, fakes, harnesses. Separate from cases
  because it churns on a different schedule and rots differently (unused fixtures outlive their
  tests).
- **Static policy** — compiler strictness, lint rules, ratchet baselines. Verification that runs
  without executing anything; the framework notes bet most of the token economy on this class.
- **Verification reports** — coverage, mutation scores. Derived, disposable, regenerated at will.

### Knowledge

Everything written for a reader rather than a runtime.

- **In-place** — code comments and TSDoc. Travels with the code; the only knowledge with a chance
  of staying adjacent to what it describes.
- **Standalone human documentation** — README, guides, essays like this one.
- **Agent-facing documentation** — CLAUDE.md, skills, prompt fragments. Same content class as human
  docs, different register: plain prioritized prose beats exhaustive rules (per the README's
  anecdotal observations).
- **Design records** — architectural designs (durable), comparative analyses (inputs to a decision;
  archive once the decision is made), brainstorming (ephemeral by construction).
- **Orientation** — indexes, dependency diagrams, concept maps, API reports, folder-structure
  descriptions. All derivable from source, therefore all candidates for generation. A hand-drawn
  dependency diagram is a rot promise.
- **Examples and demos** — executable knowledge. The only documentation that can be gated: examples
  compile in CI or they are deleted.

### Process state

The project's memory of its own work.

- **Work inventory** — backlog, work items, bug reports, known issues, the technical-debt register.
  One class, many names; all are claims that something should change, annotated with priority.
- **In-flight claims** — which agent holds which files, task state for recovery. The B9 ledger,
  deliberately minimal.
- **Decision and idea logs** — append-only records (B15). Decisions are the durable extract of all
  the ephemeral knowledge above.
- **History and changelog** — the record of deltas, written once, never edited.

### Substrate

What everything else stands on.

- **Dependencies** — the manifest (source of truth), the lockfile (derived), `node_modules`
  (disposable cache). Three artifacts, three policies, one word.
- **Toolchain** — compiler, linter, formatter, test runner, package manager.
- **Configuration** — the policy layer binding toolchain to project.
- **Automation** — CI, hooks, scripts: the schedule on which the toolchain runs.
- **Environment** — runtime versions, targets, env-var shape.
- **Structure** — folder layout, package boundaries, submodules. Not an artifact at all: a
  namespace imposed on every artifact above, which is why restructuring touches everything and why
  package boundaries are the unit of agent parallelism.

## The axes

Maintenance policy follows from where an artifact sits on four axes, plus its audience.

| Axis | Question | Policy it dictates |
|---|---|---|
| **Truth vs derived** | Is it generated from something else? | Derived: regenerate and gate, never hand-edit. If a derived artifact is maintained by hand, either automate it or delete it — there is no stable third option. |
| **Checked vs unchecked** | Does anything fail when it is wrong? | Push unchecked artifacts toward checked (examples that compile, type-level tests, link checkers) — or minimize the count of unchecked words. |
| **Durable vs ephemeral** | Does it outlive the current task? | Ephemeral artifacts need a deletion trigger assigned at creation time. This is the counterweight to the observed agent tendency to hoard historical records. |
| **Interface vs interior** | Contract or implementation? | Contracts: slow change, breaking-change discipline, the most review. Interiors: churn freely. Verify contracts, not interiors — interior-coupled regression tests ossify refactoring. |

**Audience** (machine, human, agent) is a fifth, orthogonal dimension that sets *format* rather
than lifecycle: machines want schemas, agents want plain prioritized prose, humans want narrative.
One fact often deserves all three renderings — generated from one source of truth.

The compact formulation: **a project is a set of truth artifacts, plus derivation rules, plus a
decay policy.** Everything else is generated. The categories in the tree say where a thing lives;
the axes say who writes it, what checks it, and when it dies.

## The three drifts

Almost every maintenance failure is one of three drifts, one per axis:

1. **Derived gone stale** — the index describes last month's exports; the lockfile disagrees with
   the manifest; the diagram shows a deleted module. Cure: generation plus a gate on drift.
2. **Unchecked gone wrong** — the comment lies, the README example no longer compiles, the concept
   map names dead concepts. Cure: make it checked, or make it shorter.
3. **Ephemeral gone hoarded** — the scaffolding test that never got deleted, the brainstorm that
   reads like a commitment, the spike that looks like production code. Cure: expiry assigned at
   birth, and periodic sweeps (knip for code; a date convention for documents).

## Relations

Contracts anchor the graph: implementation implements them, tests verify them, documentation
describes them, consumers depend on them. Configuration governs the toolchain; automation runs the
toolchain against the product; orientation derives from the product; process state points at all of
it; history records deltas of all of it.

Drawn as a dependency graph, the derived artifacts are exactly the nodes with only incoming edges —
which is why they are the automatable ones, and why the orientation layer (B5) can be regenerated
on every commit without asking anyone anything.

## Mapping to the deliverables

The taxonomy is the theory the planned tools implement:

- **Gate (B2) and verdict compactor (B4)** operate the *checked* axis: they are the machinery that
  makes "does anything fail when this is wrong" answerable in one compact verdict.
- **Ratchet (B3)** is static policy — checked verification of the configuration layer itself.
- **Index generator (B5)** automates the orientation class, converting it from unchecked-and-rotting
  to derived-and-gated.
- **Decision and idea logs (B15)** implement the durable/ephemeral split for knowledge: decisions
  are the durable residue; everything upstream of them is allowed to die.
- **Work ledger (B9)** is process state; the structure category explains why package boundaries may
  make most of it unnecessary.

What the taxonomy adds beyond vocabulary is a default answer for artifacts the tools don't yet
cover: place the artifact on the four axes, and its maintenance policy falls out.
