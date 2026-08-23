# Very Small Modules for Agentic Programming

## 1. What this document is

A deep look at one design bet: that agent-driven development goes better when the codebase is
made of **many very small modules**, each well defined, well tested, and well documented.

The bet is attractive because it lines up with how agents fail. It is also the kind of bet that
looks free and is not. This document separates the part that is real from the part that is
folklore, measures what this repository actually does, and then answers the question the user
actually asked: *what concretely keeps a module self-contained?*

Terminology used throughout:

* **Module** — a unit with a named contract and a fence: in this repo, a package under
  `packages/*`, or a single file inside one that owns one concern.
* **Small** — roughly one screen of implementation (≤300 lines, PS-024) behind an interface of
  a handful of exports (≤15, PS-025).
* **Self-contained** — everything needed to change the module correctly fits in one agent's
  context, and nothing outside the fence has to move with it.

The last one is the load-bearing definition. Size is a proxy for it, and a bad proxy on its own.

## 2. The claim, stated precisely

> Decompose the system into many small modules with explicit contracts, exhaustive tests, and
> local documentation, because an agent can then load one module, change it, verify it, and
> stop — without reading or breaking the rest.

Three separable sub-claims live inside it:

| # | Sub-claim | Status |
|---|---|---|
| C1 | Small units reduce the context an agent needs per task | **Strong** — mechanical, measurable |
| C2 | Explicit contracts + tests make a change verifiable locally | **Strong**, conditional on the gate being real |
| C3 | *More* modules is therefore *better* | **False as stated** — has an interior optimum |

Most of the disagreement in the literature is about C3 while people argue as if it were about C1.

## 3. The case for (with mechanisms, not vibes)

### 3.1 Context economy is the dominant cost

An agent's working set is bounded and expensive. A task scoped to a 150-line module with a
10-line contract and a test file costs a few thousand tokens to fully understand. The same task
inside a 1,700-line module costs an order of magnitude more, and the agent will read *selectively*
— which is where hallucinated assumptions about the unread parts come from. Small modules do not
make the agent smarter; they make the "read everything relevant" strategy affordable, and that
strategy is the one that does not hallucinate.

### 3.2 Verification granularity

A small module with a real test suite converts "did I break something?" from a judgment call into
a command. The value is not the tests per se — it is that the **feedback loop fits inside one
agent turn**. A module you can typecheck and test in under a second can be iterated on
autonomously; one that needs a 90-second full build cannot, and the agent starts guessing.

### 3.3 Fenced parallelism

This repo's wave model (`CONTRACTS.md`) only works because tracks can be assigned disjoint file
sets. Fences are cheap to draw around small modules and impossible to draw around big ones. The
practical limit on how many agents can work at once is roughly the number of independently
fenceable units — so module granularity *is* the parallelism budget.

### 3.4 Rewrite beats repair

Below some size, regenerating a module from its contract and tests is cheaper and more reliable
than surgically patching it. That option only exists when the contract and tests are complete
enough to be the source of truth. This is a genuinely new economics: for humans, rewrite is
expensive and repair is cheap; for agents at small scale, the ordering can invert.

### 3.5 Blast radius and reviewability

A change confined to one fence produces a diff a reviewer (human or agent) can hold entirely in
mind. Confidence in a review decays sharply with diff size, and small modules cap diff size
structurally rather than by discipline.

### 3.6 Retrieval precision

Agents locate code by search. A module whose name, path, and exports all describe one concern is
findable in one grep. A grab-bag module is found repeatedly for the wrong reasons and read
repeatedly for nothing.

## 4. The case against (the parts that are usually skipped)

### 4.1 Ousterhout's objection: shallow modules add complexity

*A Philosophy of Software Design* argues the opposite of C3: the value of a module is
implementation hidden per unit of interface exposed. A "deep" module has a small interface over
substantial behavior; a "shallow" one has an interface nearly as large as its body. Splitting a
cohesive 300-line function into six 50-line modules with six interfaces does not remove
complexity — it converts implementation complexity, which is local and hidden, into interface
complexity, which is global and permanent. Classitis is the named failure mode.

This objection is real and it does not go away because the reader is an agent. It is *weakened*,
because an agent's cost of traversing an interface is lower than a human's (it can grep and read
the definition in milliseconds), but the cost of *maintaining* consistency across N interfaces is
paid at change time, and agents are not obviously better at that than humans.

### 4.2 Cross-cutting change becomes the expensive case

The regime that small modules optimize is "change one thing." The regime they punish is "change a
concept that appears in nine modules." That second regime is where the schedule actually goes.
Every seam is a place a refactor must stop, negotiate, and re-verify. With 40 modules, a type
change is a 40-file diff that no single fence contains — and fenced parallelism, the thing
granularity bought, is exactly what you cannot use for it.

### 4.3 The integration gap

Per-module tests verify each module against its *own* understanding of the contract. Two modules
can both pass and still disagree. As module count rises, the fraction of total behavior that is
"between" modules rises, and that fraction is the part unit tests structurally cannot see. Small
modules therefore *shift* testing burden toward integration and contract tests rather than
reducing it.

### 4.4 Discovery cost and duplication

An agent that cannot find the existing module writes a new one. At 10 modules this is rare; at
100 it is routine, and the failure is silent — two competing implementations of the same idea,
both tested, both documented, quietly diverging. This is the single most common way agent-built
repos rot, and it gets worse monotonically with module count.

### 4.5 The fixed per-module tax

Every module carries overhead: a `package.json`, a barrel, a README, a test file, an entry in the
map, a line in the mental model. At 150 lines of implementation the tax is maybe 20% overhead. At
30 lines it can exceed 100%, and the docs go stale faster than they earn their keep (see §5.3).

### 4.6 Over-fragmentation degrades reasoning

There is a floor below which splitting hurts the agent too. A module that cannot be understood
without simultaneously reading three neighbours has not been isolated — it has been *scattered*.
The agent then loads more context than the monolithic version required, plus the seams.

### 4.7 False confidence

"Well tested and documented" is asserted per module. Neither property is load-bearing unless a
gate checks it. Unenforced, both decay, and the architecture keeps claiming a guarantee it
stopped providing. §5.3 has this repo's own example.

## 5. Evidence from this repository

### 5.1 Measured sizes (2026-08-23)

| Package | src files | src lines | test lines | test:src | `index.ts` exports |
|---|---:|---:|---:|---:|---:|
| core | 1 | 268 | 61 | 0.23 | 30 |
| gitlink | 2 | 167 | 363 | 2.17 | 5 |
| backlog | 2 | 241 | 473 | 1.96 | 6 |
| hooks | 6 | 281 | 443 | 1.58 | 5 |
| check | 5 | 344 | 189 | 0.55 | 5 |
| init | 8 | 790 | 381 | 0.48 | 15 |
| codemap | 4 | 791 | 546 | 0.69 | 3 |
| transcripts | 3 | 1177 | 538 | 0.46 | 11 |
| dashboard | 8 | 1469 | 786 | 0.54 | — (app) |
| codeview | 5 | 1688 | 819 | 0.49 | — (app) |

Reading:

* The packages built **library-first behind a narrow seam** (gitlink, backlog, hooks) have
  test:src ratios around 2. The ones that grew organically sit near 0.5. The seam-first
  discipline, not the size, predicts the test density.
* `codemap` at 791 lines exports **3** symbols; `core` at 268 lines exports **30**. By
  Ousterhout's measure `codemap` is the deep module and `core` is a near-pure interface. `core`
  is fine — a shared vocabulary is supposed to look like that — but it is also the module every
  fence is forbidden to touch, which is the predicted consequence of a wide interface.
* `codeview` and `dashboard` (the two app roots) are the only units above 1,400 lines. They are
  compositions, and composition is where size legitimately accumulates.

### 5.2 The dependency shape

```
core     ← backlog, transcripts, hooks, codemap, dashboard, codeview
check    ← codemap, init
gitlink  ← dashboard
backlog  ← dashboard, codeview
codemap  ← codeview
```

No cycles; depth 2. That is a healthy shape, and it is healthy because `core` is deliberately
leaf-ward and pure. The risk visible here is `core` as a **gravity well**: it is imported by six
of ten packages, so it accretes types that only two callers need, and every addition widens the
one interface nobody is allowed to change during a wave.

### 5.3 The documentation claim does not hold

Of ten packages, **one** (`hooks`, 47 lines) has a README. `codeview` ships a feature for
browsing package readmes that has, at present, one readme to browse.

This is the §4.7 failure in miniature and it is worth being blunt about: the "well documented"
leg of the three-legged claim is currently aspirational. Nothing failed, because nothing checks.
Contrast with the "well tested" leg, which holds — because `npm run check` fails without it.

**The general law:** in an agent-built repo, an architectural property that is not gated is not a
property. It is a comment.

## 6. Reframing: size is the wrong variable

The pros in §3 all reduce to one property, and the cons in §4 all reduce to its violation:

> **A module is self-contained if an agent can load it, change it, and verify it without reading
> or writing anything outside its fence.**

Size correlates with this, which is why "small modules" works as a heuristic. But a 100-line
module that reaches into ambient state, imports three sibling barrels, and is spec'd only in a
design doc is *not* self-contained, and a 280-line pure module with a 5-symbol interface and a
2:1 test ratio is. Optimize the property; let size fall out.

Six components, in dependency order:

| Component | Question it answers | Enforceable today? |
|---|---|---|
| **Contract** | What is the interface, exactly? | Partly (PS-021, PS-022, PS-025) |
| **Purity** | Can I run it without setting up the world? | Yes (PS-003..PS-007) |
| **Locality** | Does anything else have to change with it? | No — see §7.3 |
| **Executable spec** | How do I know a change is right? | Yes (`npm run check`) |
| **Rationale** | Why is it this way; what did we reject? | No — see §7.5 |
| **Termination** | When does this module get deleted? | No — see §7.7 |

## 7. What to do — concrete mechanisms

Ordered by leverage per unit of effort. Rule IDs marked *(proposed)* do not exist yet.

### 7.1 One contract file, and the contract is the file

Every package exposes exactly one `src/index.ts`; it contains type aliases and function
signatures with explicit return types (PS-021), no default exports (PS-022), no re-export of
another package's barrel (PS-023). An agent reading only `index.ts` must be able to *use* the
module correctly. If it needs to open `impl.ts` to know what a parameter means, the contract is
incomplete, and the fix is a better type, not a comment.

The strongest version of this — already practiced here — is **land the stubs first**: the
supervisor writes every fenced file as a stub with the final signature before any track starts.
Tracks fill bodies and may not change signatures. This makes the contract prior to the
implementation rather than a summary of it, which is precisely what makes parallel tracks
composable.

### 7.2 A hard dependency budget, enforced by lint

*(proposed PS-060)* — A package may import from at most **two** other workspace packages, and
`core` does not count against the budget. Zero runtime dependencies stays as-is.

The number matters less than the fact that exceeding it fails the build and forces an explicit
decision. Today `dashboard` imports four; that is legitimate for a composition root, so the rule
needs a Root exemption — the zone table in the style guide already gives us the vocabulary for
that.

### 7.3 Import-boundary rules, not conventions

Locality is the one component of §6 with no enforcement at all today. Three lint rules would
close it:

* *(proposed PS-061)* No deep imports across packages — `../../foo/src/internal.ts` is banned;
  only `../../foo/src/index.ts` is importable. Otherwise every internal file is de facto public
  and no module can be rewritten without a survey.
* *(proposed PS-062)* No cycles between packages. Cheap to check, catastrophic to discover late.
* *(proposed PS-063)* Layer assertion — a declared allowed-edges list in `eslint.config.js`, so
  the dependency graph in §5.2 is a *checked* fact rather than a picture in a doc that drifted.

### 7.4 Purity as the isolation mechanism

The existing subset (PS-003 through PS-007: no throw, no mutation, no clock/random/env, no fetch,
no console outside Root) is doing most of the actual isolation work, and it deserves to be named
as such rather than filed under "style." Purity is what makes a module testable without fixtures,
runnable without setup, cacheable by content hash, and — critically — *readable without reading
its callers*. Effects are the main reason a module's behavior is not locally determined.

Keep IO in `io.ts` and composition in `main.ts`/`server.ts`, both Root zone, both deliberately
outside the fenced-parallel work. Impurity is allowed but it is concentrated where it can be
audited, and the concentration is what buys the rest of the tree its self-containment.

### 7.5 The package README as a gated artifact

Given §5.3, prose that is merely encouraged does not survive. Make it structural:

* *(proposed PS-064)* Every package has `README.md` with fixed sections: **Purpose** (one
  sentence), **Contract** (generated from `index.ts`), **Non-goals**, **Invariants**,
  **Rationale/rejected alternatives**.
* Generate the Contract section into a marker block and fail `npm run check` when it disagrees
  with the actual exports. BL-0025 already establishes marker-block inventories with a staleness
  gate — this is the same mechanism aimed at package docs.
* The sections that cannot be generated (Non-goals, Rationale) are the only prose an agent must
  write, and they are the highest-value prose in the repo: they carry the information the code
  provably cannot.

Non-goals earn their place specifically for agents. `AGENTS.md` already carries one — source
browsing and metrics do not belong in `dashboard` — and that single sentence prevents a
recurring, expensive class of mistake. Scope boundaries are the cheapest defense against agents
helpfully expanding a module.

### 7.6 Tests as the executable half of the contract

* Tests live in the module's fence and depend on nothing outside it. A test needing a fixture
  from another package is a contract leak, not a test-infrastructure problem.
* Where a module is consumed by another, put a **contract test** in the *provider* asserting the
  shape the consumer relies on. This is the direct countermeasure to §4.3, and it is what makes
  regeneration (§3.4) safe: it pins the seam independently of either implementation.
* Goldens for anything with rich output (rendering, formatting, indexing). They are cheap to
  produce, they catch the diffuse regressions unit tests miss, and an agent can regenerate and
  diff them without understanding the implementation.

### 7.7 Termination conditions

*(proposed PS-065)* — Every package README states what would make it obsolete. Agents create
modules eagerly and delete them never; a stated kill condition turns "should this still exist?"
from a judgment call into a check. Modules with no remaining inbound edges should be reported by
the same tooling that checks §7.3.

### 7.8 A promotion ladder instead of a package-per-idea reflex

The cheapest defense against §4.4 and §4.5 is to make new modules *earn* their existence:

1. **Function** in an existing module. Default. No ceremony.
2. **File** in that package, when it has its own tests and one clear concern.
3. **Package**, only when at least one of: a second package needs it, it must be fenced for
   parallel work, or it has a distinct release/runtime story.

Never skip a rung to "keep things tidy." Tidiness is not one of the three reasons, and the
150-line package that exists for tidiness costs more than the 150 lines it moved.

### 7.9 Make discovery cheaper than re-creation

Duplication is a search failure. Countermeasures, in order of value:

* One canonical map — this repo's `AGENTS.md` table — with a gate that fails when a directory
  under `packages/` has no row.
* `codemap`'s symbol index put in front of the agent *at task start*, not on demand. An agent
  that must choose to search will sometimes not.
* Naming discipline: the package name, the directory, and the primary export share a stem.

## 8. Failure modes worth naming

| Smell | Signature | Fix |
|---|---|---|
| **Sawdust modules** | <50 lines, one caller, exists for tidiness | Inline it (§7.8) |
| **Gravity well** | One package imported by nearly all; frozen during every wave | Split by consumer set; move single-consumer types local |
| **Barrel maze** | Re-export chains; symbols not greppable to a definition | PS-023, one level only |
| **Twin modules** | Two implementations of one idea, both green | §7.9 discovery |
| **Doc taxidermy** | README describes an interface that changed months ago | §7.5 generate + gate |
| **Fence leak** | Tests reach outside the fence for fixtures | Move the fixture or the boundary |
| **Interface inflation** | Exports grow monotonically; nothing is ever unexported | PS-025 as a ratchet, not a guideline |

## 9. Verdict

**Supported, with the quantifier corrected.** Many small, well-contracted, well-tested modules is
the right shape for agent-driven development, for the mechanical reasons in §3 — context economy,
loop latency, fenceability — and those reasons are properties of how agents work, not fashion.

But the benefit comes from **self-containment**, of which size is a symptom. Pushed past the
optimum, granularity converts hidden implementation complexity into permanent interface
complexity (§4.1), inflates the cost of exactly the cross-cutting changes that dominate real
schedules (§4.2), and multiplies discovery failures (§4.4). The interior optimum in this
codebase looks like **100–300 implementation lines behind ≤10 exports with a ≥1:1 test ratio and
≤2 workspace dependencies** — which is roughly where the seam-first packages already landed, and
notably *not* where the organically grown ones did.

The sharper restatement, and the one worth carrying forward:

> Optimize for modules an agent can hold entirely in context and verify entirely in one command.
> Let size be the consequence. Gate every property you claim, because in an agent-built repo an
> ungated property has already stopped being true.

## 10. Recommended next steps for this repo

| # | Action | Cost | Notes |
|---|---|---|---|
| 1 | README gate with generated Contract block (§7.5) | M | Closes the §5.3 gap; reuses BL-0025 machinery |
| 2 | Import-boundary lint: no deep imports, no cycles, declared layers (§7.3) | S | Highest ratio of leverage to effort |
| 3 | Contract tests at each consumed seam (§7.6) | M | Prerequisite for safe module regeneration |
| 4 | Dependency budget with a Root exemption (§7.2) | S | Prevents the next gravity well |
| 5 | Audit `core`'s 30 exports; push single-consumer types local | M | Directly reduces wave-time contention |
| 6 | Promotion ladder written into `AGENTS.md` (§7.8) | XS | Cheapest item here; prevents package sprawl |
| 7 | Map-completeness gate: every `packages/*` has an `AGENTS.md` row (§7.9) | XS | |

Items 2, 4, 6, and 7 are small enough to do as one wave; 1 and 3 deserve their own backlog items.

## 11. Open questions

* **Where is the floor?** No measurement here distinguishes a 60-line module from a 200-line one
  in agent success rate. It is testable — same task, two granularities, measure turns to green —
  and nobody has run it.
* **Does regeneration actually beat repair, and below what size?** §3.4 is asserted, not measured.
  A cheap experiment: for a module with goldens, regenerate from contract+tests and compare cost
  and defect rate against patching.
* **Does contract-test coverage close the integration gap in practice**, or does it merely relocate
  the disagreement into the contract test?
* **Is `core` one module or three?** The 30-export interface suggests three, but splitting it
  raises import counts everywhere. Unresolved.

## 12. Related reading

* D. L. Parnas, *On the Criteria To Be Used in Decomposing Systems into Modules* (1972) — the
  original argument that modules should hide decisions likely to change, which is the §4.2
  criterion for where seams belong.
* J. Ousterhout, *A Philosophy of Software Design* — deep vs. shallow modules, classitis; the
  strongest available counterargument to C3 (§4.1).
* In this repo: [pure-fp-for-agents](pure-fp-for-agents-2026-08-22.md) (why the functional subset),
  [testing-gates-ratchets-goldens](testing-gates-ratchets-goldens-2026-08-22.md) (the enforcement
  mechanisms §7 leans on), [tdd-for-agents](tdd-for-agents-2026-08-22.md) (contract-first vs.
  test-first), [weak-hypotheses-evidence](weak-hypotheses-evidence-2026-08-22.md) (H19 — strictness
  on things that do not matter is the cost, not strictness itself), and `CONTRACTS.md` (the fence
  model §3.3 depends on).
