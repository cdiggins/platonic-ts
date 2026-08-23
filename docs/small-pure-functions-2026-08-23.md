# Many Small Pure Functions: The Case For and Against

## 1. What this document is

A weighing of one coherent style bet, stated as six practices that usually travel together:

1. **Many small functions.** Prefer a large number of short functions over a small number of
   long ones.
2. **Pure and referentially transparent.** Same inputs, same outputs, no observable effect; any
   call can be replaced by its result without changing the program.
3. **Few parameters, grouped into types.** When a function needs several inputs, name the group
   as a record type instead of extending the parameter list.
4. **Few flags.** Avoid boolean parameters that select between behaviours inside the callee.
5. **Few compound expressions.** Give intermediate results names rather than nesting calls and
   operators several levels deep.
6. **Little duplication.** Route similar work through one shared function.

The claimed payoffs are that the code documents itself, that behaviour is shared through a
single path so a fix lands everywhere at once, and that edits — especially edits by several
people or agents at once — stay small and local.

Terms used throughout, defined once:

* **Referential transparency** — an expression can be replaced by its value anywhere in the
  program without changing behaviour. It is the property; purity is how you get it.
* **Arity** — the number of parameters a function declares.
* **Parameter object** — a record type introduced to carry what would otherwise be several
  separate parameters.
* **Change amplification** — one requirement change forcing edits in many places.
* **Fan-in** — the number of distinct call sites a function has.

The short answer: practices 1–4 are well supported and this repository should keep them, with
one correction to how "small" is measured. Practice 5 is a style preference with a real cost
that is usually understated. Practice 6 is the one that goes wrong most often, and the existing
rule PS-049 ("duplicate twice before abstracting") already encodes the correction.

## 2. The claims, separated

The bet is usually argued as a single package. It is not one claim, and the evidence behind the
parts is very uneven.

| # | Claim | Verdict |
|---|---|---|
| A | Purity makes a function understandable and testable in isolation | **Strong.** Mechanical, and the basis for everything else here. |
| B | Small functions are cheaper to read, review, and change than large ones | **Strong up to a point**, then reverses. Section 5.1. |
| C | Lower arity reduces the ways a call can be wrong | **Strong**, but parameter objects move the problem rather than removing it. Section 5.2. |
| D | Flags hide a second function inside the first | **Strong**, with a narrow exception. Section 4.3. |
| E | Naming intermediate results documents the code | **Mixed.** Depends entirely on whether a true name exists. Section 5.3. |
| F | Routing everything through one function makes the system more robust | **Conditional.** True for invariants, false for coincidence. Section 5.4. |
| G | The style makes parallel edits easier | **True but for a different reason than usually given.** Section 4.4. |

Most disagreements about this style are really about B's reversal point and F's condition.
People argue as if they were about A.

## 3. What this repository already does

Measured across the 41 pure source files under `packages/*/src` — excluding tests and the
`main.ts` / `server.ts` / `io.ts` composition roots — covering 298 top-level named functions.

| Measure | Value |
|---|---|
| Function length, median | 7 lines |
| Function length, 75th / 90th percentile | 14 / 27 lines |
| Function length, 99th percentile / max | 116 / 241 lines |
| Functions of 5 lines or fewer | 129 of 298 (43%) |
| Functions over 30 lines | 19 of 298 (6%) |
| Arity 0 / 1 / 2 / 3 / 4 / 5 | 7 / 164 / 84 / 28 / 14 / 1 |
| Boolean parameters | 4 of 477 total parameters (0.8%) |
| Parameters whose type is a named record | 110 of 477 (23%) |

These figures were measured by hand for this report. `npm run stats` now recomputes the same
kind of table from the repository as it stands, split by the style guide's Core, Root, and Test
zones. Its numbers will not match this table exactly, and the difference is a population
definition rather than a discrepancy: the tool counts every named function, including the local
helpers declared inside another function, where the count above was of top-level functions only.
Median and 75th percentile agree; the upper tail is lower in the tool's figures, because the
larger population it measures contains many more small functions.

So the style is not aspirational here — it is already the shape of the code. Over half of all
functions take exactly one argument, and flags have all but disappeared. That makes this a good
place to ask what the practice has actually bought, and what it has cost.

The 19 functions over 30 lines are the interesting minority. They cluster in two kinds of work:
HTML page assembly (`renderPage` in `packages/dashboard/src/ui.ts`, 241 lines) and parsing
external formats (`parseEntry` in `packages/transcripts/src/analyze.ts`, 131 lines;
`parseTranscriptLine` in `packages/transcripts/src/index.ts`, 116 lines). Both are cases where
splitting produces named fragments that are only ever used once, in one order. Section 5.1
argues that is the reversal point, not a backlog of unfinished cleanup.

## 4. The case for

### 4.1 Purity is what makes the rest work

A pure function's meaning is entirely in its signature and body. To understand it you need no
call history, no initialisation order, no knowledge of what else is running. That is the
property the other five practices are trying to exploit; without it, splitting a long function
into ten short ones produces ten functions that each still depend on invisible shared state, and
you have made things worse, not better.

This is also the only item on the list that is enforced rather than encouraged here: PS-004
through PS-007 ban mutation, ambient clocks and randomness, network access, and logging outside
the composition roots.

Two consequences matter in practice. A pure function can be tested with plain data in and plain
data out, which is why this repository has 381 tests across 31 test files and no mocking
library — vitest is the only test-side dependency. And a pure function can be read out of order,
which is what makes a codebase of many small functions navigable at all.

### 4.2 Self-documentation is real, but it is naming that does the work

"Self-documenting" is usually attributed to smallness. Smallness is not the cause. A 4-line
function named `helper` documents nothing. What documents the code is that a name is *forced* at
a boundary where, in a long function, no name would have existed. Splitting is the occasion;
naming is the mechanism.

The same mechanism is why lower arity helps. Compare:

```ts
// arity 4 — three of the four arguments are position-dependent and interchangeable in type
const declared = (node: ts.Node, source: ts.SourceFile, file: string, kind: string) => ...

// arity 2 — the group is named, and the fields are named at every construction site
const declared = (node: ts.Node, site: DeclarationSite) => ...
```

The second form cannot be called with the arguments transposed. It also gives the group a name
that can be searched for, which the first does not. The benefit is not "fewer things to pass" —
it is the same information, but each piece is now labelled at the point where it is supplied.

### 4.3 Flags really do hide a second function

A boolean parameter means the callee contains a branch that the caller has already decided. The
caller knows statically which side it wants; the branch exists only because the two behaviours
share a name. Splitting into two named functions makes the call sites readable
(`outlineIncludingNested(...)` rather than `outline(..., true)`) and removes a branch from the
callee that no test can reach from the other side.

Only 4 of this repository's 477 parameters are booleans, and all four are of the same kind —
`includeNested`, `includeAll`, and an `ok` discriminant. That is close enough to zero that the
rule is not currently costing anything.

The exception worth naming: a flag that is genuinely computed at runtime, and passed through
several layers to a single decision point, is not hiding a second function. It is data. Splitting
that into two functions forces the branch upward into every intermediate layer, which is a
strictly worse trade. The rule is about flags whose value is a literal at the call site.

### 4.4 Parallel editing improves — because of file layout, not function size

The usual claim is that small functions reduce merge conflicts. That is only half right. Version
control merges by line region, not by function, so two agents editing different 5-line functions
in the same file conflict roughly as often as two agents editing different halves of one 50-line
function.

What actually helps is the second-order effect. Many small pure functions make it practical to
put one concern in one file (PS-041) and keep files under 300 lines (PS-024), and *file
boundaries* are what parallel work is fenced along. The mechanism is:

1. Small pure functions make small files possible.
2. Small files make it possible to assign non-overlapping file sets to concurrent workers.
3. Non-overlapping file sets are what actually prevent conflicts.

Getting this causal order right matters, because it tells you which cases are worth splitting.
Splitting a function into two functions in the same file buys nothing for parallelism. Splitting
it so that a coherent group can move to its own file buys the whole benefit.

There is a second effect that matters specifically for coding agents. A pure function with an
explicit signature is a unit that can be replaced whole. An agent can be told "rewrite
`scoreMetrics`" and does not need to read the callers, because the signature and the type checker
define the obligation. This repository's MCP server is built on that assumption — its editing
tools address code by symbol name, one declaration at a time, which only works when a
declaration is a meaningful unit of change.

### 4.5 Shared code paths concentrate correctness

When two places compute the same thing, they can disagree. Routing them through one function
makes disagreement impossible rather than unlikely.

The clearest case here is `countEscapeHatches` in `packages/check/src/ratchet.ts`, used from 21
places across the checker and the code browser. The comment in `packages/codemap/src/metrics.ts`
states the reason directly: the browser and the `platonic check` gate can never disagree about
what an escape hatch is. Had each computed its own count, the two would drift, and the drift
would show up as a confusing dashboard rather than as a failing test.

That is the real payoff of removing duplication, and it is worth being precise about it: the
benefit is not that there is less code. It is that a class of inconsistency has been made
unrepresentable. Section 5.4 argues that this only holds when the two uses share an invariant,
and that the same move is harmful when they do not.

## 5. The case against

### 5.1 Smallness has a reversal point, and it is not far away

Reading a call to a named function costs less than reading its body only if the name is trusted.
The first time through a codebase, no name is trusted, so every call is a jump. A 30-line
function split into six 5-line functions has the same total volume plus six names, six
signatures, and — for the reader who does not yet trust the names — six jumps. Ousterhout's term
for the result is a shallow module: an interface nearly as large as the implementation it hides.

The honest formulation is that splitting trades *depth of reading* for *breadth of reading*.
That trade is good when the extracted piece is used more than once, or is independently
meaningful, or is independently testable. It is bad when the piece is used exactly once, in
exactly one order, and its name is a restatement of its body.

This is why the long functions in section 3 are not automatically debt. `renderPage` at 241
lines is a linear sequence of string assembly with no branching worth naming; splitting it
produces two dozen functions each called once. That is a real judgment call and it can go the
other way — 241 lines exceeds PS-024's file budget by itself and is worth revisiting — but the
argument for splitting it has to be made on grounds other than length.

The practical correction: measure smallness by *number of things the reader must hold at once*,
not by line count. A 40-line function with no branching and one level of abstraction is smaller
in the sense that matters than a 10-line function with three nested conditionals. PS-055 ("one
level of abstraction per function") already says this better than a line count can.

### 5.2 Parameter objects move coupling; they do not remove it

Replacing four parameters with one record reduces arity to one. It does not reduce the number of
things the caller must supply, and it adds three costs:

* **A construction site.** Every caller now builds a record. If the record is built inline at
  one call site, nothing was gained over four arguments.
* **A type to maintain.** Adding a field is now a change to a shared type, which means every
  consumer of that type recompiles and — if the field is required — every construction site
  changes. With positional parameters, only the callers of the one function change.
* **Over-supply.** A parameter object tends to accumulate fields that only some callees read.
  The signature then overstates what the function depends on, which is exactly the information
  the low-arity style was trying to make visible.

The version that works is the one where the group is a real concept in the domain that already
had a name, and the record is passed through several functions unchanged. The version that fails
is the one where a record named `Options` or `Context` is invented purely to lower a number.
PS-047 already bans `Info` and `Data` as type names for the same reason; extending it to
`Options` and `Context` would close the gap.

This repository's 15 functions with arity 4 or more are concentrated in
`packages/codemap/src/symbols.ts` and `packages/mcp/src/`. Those are TypeScript compiler-API
walks that thread `sourceFile`, `file`, `node`, and `container` through every level. That is the
honest case for a parameter object — the same four values, unchanged, at every level — and it is
the one place here where the refactor would pay.

### 5.3 Naming intermediates is not free

"Minimise compound expressions" says to replace `f(g(h(x)))` with three named steps. Sometimes
that is a clear improvement. Sometimes the intermediate has no name, and the code acquires
`parsed`, `normalized`, `result`, and `finalResult` — four names that carry no information and
must nonetheless be read, held, and kept accurate as the code changes.

A wrong or vacuous name is worse than no name, because a reader will believe it. A compound
expression, by contrast, is transparent: it says what it does with no claim beyond that. Point-free
and pipeline styles (`filter`/`map`/`reduce` chains, PS-052) are compound expressions, and this
repository correctly prefers them to sequences of named assignments.

The defensible version of the rule is narrower: split a compound expression when a sub-expression
(a) is repeated, (b) is what a comment would otherwise explain, or (c) is deeply enough nested
that the reader must count parentheses. Otherwise leave it.

### 5.4 A shared code path is also a coupling

Every call site routed through one function is a call site that a change to that function can
break. This is the same property as section 4.5 seen from the other side: concentrating
correctness also concentrates blast radius.

The distinction that decides which one you get:

* **Shared invariant.** The two uses must agree, and a future change should hit both. Sharing is
  right, and it is right *immediately* — `countEscapeHatches` should never have been written
  twice.
* **Coincidental similarity.** The two uses look alike today for unrelated reasons. Sharing them
  creates a function that must serve two masters. The next divergence arrives as a flag
  parameter, and section 4.3's rule then gets broken to preserve section 4.5's.

The failure mode is recognisable: the shared function grows a parameter whose only purpose is to
restore a difference that was deleted. When that happens, the correct move is to undo the
extraction, not to add the flag.

Because coincidental similarity is indistinguishable from a shared invariant at the moment of
the second occurrence, PS-049 says to wait for the third. That rule is in tension with practice
6 as stated, and PS-049 wins: a wrong shared path is more expensive than a duplicate, because
the duplicate is deleted by one person in one afternoon and the wrong abstraction is unwound
across every caller.

The exception, argued at more length in
[When to Build the Abstraction](abstraction-timing-2026-08-23.md), is when the invariant is
known in advance — a definition the system must agree on, like the escape-hatch count. There,
one use is enough.

### 5.5 The costs nobody puts in the ledger

* **Navigation.** Understanding a feature requires visiting more locations. Tooling reduces this
  cost but does not remove it, and for a coding agent each visit is tokens. This repository's MCP
  server exists partly to make that traversal cheap; a codebase of this shape without such tooling
  is genuinely harder to read than a monolithic one.
* **Name supply.** Every extraction consumes a name from a finite vocabulary. Past a few hundred
  functions, names start colliding, qualifying, and drifting from their meaning. PS-033's ban on
  abbreviations makes each name longer, which raises the pressure further.
* **Stack and allocation.** Real but almost always irrelevant. Modern engines inline small pure
  functions aggressively. It becomes relevant only in a measured hot loop, and PS-056 exists for
  exactly that: break the rule in one place, with the reason written down.
* **Type inference load.** Long chains of small generic functions can produce inference failures
  and error messages that name types the author never wrote. In practice this is the most common
  real friction with the style in TypeScript, and it argues for explicit return types on exported
  functions — which is already PS-021.

## 6. Where the line is

The rules that survive both sections, stated as decisions rather than preferences:

| Practice | Do it when | Do not when |
|---|---|---|
| Extract a function | It is used more than once, is independently meaningful, or is worth a test of its own | It is used once, in one place, and the name restates the body |
| Lower arity with a record | The group is a domain concept passed unchanged through several layers | The record exists only to lower the count, or is built inline at its only call site |
| Remove a flag | Its value is a literal at every call site | It is computed at runtime and threaded to one decision point |
| Name an intermediate | It repeats, needs a comment, or nests deeply | The expression is a pipeline that already reads left to right |
| Share a code path | The uses must agree by definition | They merely look alike today — wait for the third (PS-049) |

One test covers most cases. Ask what a change to this code would look like in six months. If the
answer is "edit one function and every caller is correct by construction", the split earned its
keep. If the answer is "edit one function, then edit the four callers to match", the split bought
a name and charged an indirection for it.

## 7. What this implies for the style guide

Nothing in this report contradicts a Tier 1 rule. Three suggestions for Tier 2 and Tier 3:

1. **State the reversal point in PS-055.** The rule is right; the phrase "around 30 lines" invites
   line counting. Adding "a linear sequence with no branching may be longer; a short function with
   nested conditionals is already too long" makes it about levels of abstraction, which is what the
   rule name says.
2. **Add a parameter-object caveat to PS-040 or as a new judgment rule.** Something to the effect
   of: group parameters into a type when the group has a name in the domain and travels unchanged
   through more than one function; do not invent a record to lower an arity. The existing PS-047
   name ban is the enforcement lever.
3. **Add a flag rule.** There is currently no PS rule against boolean parameters, and the code has
   almost none, so the rule would cost nothing to adopt and would document why. Suggested wording:
   a boolean parameter whose value is a literal at every call site is two functions; split it. The
   `parameters` count already tracked in `packages/codemap/src/metrics.ts` gives the measurement
   hook, and a literal-argument check is mechanizable, so this is a Tier 2 candidate that could
   reach Tier 1.

## 8. Related documents

* [Pure Functional Programming for Agent-Driven Development](pure-fp-for-agents-2026-08-22.md) —
  why purity, rather than why small.
* [Very Small Modules for Agentic Programming](small-modules-for-agents-2026-08-23.md) — the same
  question one level up, at module granularity. Its finding that "more is better" has an interior
  optimum is the same shape as section 5.1's reversal point.
* [When to Build the Abstraction](abstraction-timing-2026-08-23.md) — the timing half of the
  duplication argument in section 5.4.
* [docs/style-guide.md](style-guide.md) — the rules themselves.
