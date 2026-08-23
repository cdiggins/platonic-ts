# When to Build the Abstraction: Early, Late, or in Cleanup Passes

## 1. What this document is

A weighing of three positions on the same question — *when should a shared function, type, or
module come into existence?*

* **Early.** Work out the right shape up front, then look for chances to use it. This is the
  position stated in the prompt that produced this report: having the abstraction on hand makes
  each new piece of work cheaper, and each use is an occasion to notice that older code can now
  be simplified.
* **Late.** Write the duplicate. Wait until a third use makes the real shape obvious. This is
  the position this repository has already written down as rule PS-049 in
  [docs/style-guide.md](style-guide.md).
* **In cleanup passes.** Neither commit early nor wait indefinitely. Get the feature working
  and passing its tests, then immediately run a pass whose only job is to remove the
  duplication that the feature just created.

These are usually argued as if one must win. They do not conflict. They answer for different
kinds of code, and the useful output of this report is a rule for telling those kinds apart.

Terms used throughout, defined once:

* **Abstraction** — a named thing (function, type, or module) that more than one caller depends
  on, such that changing it changes all of them.
* **Commitment** — the point at which the abstraction's shape becomes expensive to change,
  which is a function of how many callers it has and how far they are from your keyboard.
* **Cleanup pass** — a change set that alters structure without altering behaviour, run
  against a green test suite.

## 2. The two claims inside "abstract early"

The early position bundles two claims that have very different evidence behind them.

| # | Claim | Verdict |
|---|---|---|
| E1 | Having a suitable abstraction *available* makes the next piece of work cheaper and prompts opportunistic cleanup of older code | **Strong.** This is a claim about discovery, and it holds. |
| E2 | You can reliably determine the right shape *before* the second and third use exist | **Weak.** This is a claim about prediction, and prediction is what fails. |

The prompt's own phrasing gives this away. "I can use this existing function to create a new
one" and "this existing function can now be simplified" both describe moments of
*recognition*, not moments of *design*. The value being reported is that a well-named, visible,
correct piece of code was sitting there when it was needed. That value is real, and it is
almost entirely independent of whether the code was written speculatively or extracted from
two earlier copies.

This matters because the two claims recommend different actions. E1 recommends investing in
naming, placement, and searchability. E2 recommends investing in up-front design. Only the
first is well supported.

## 3. The case for early

### 3.1 Availability drives reuse more than quality does

Code is reused when it is found. A helper that exists, has a name that says what it does, and
lives where someone would look, gets reused. A better helper buried in a file with a vague name
does not. Early creation helps because it front-loads the naming and placement decisions — not
because it front-loads the design.

### 3.2 Small refactors are cheaper than large ones

The prompt's second observation is the stronger one: with the abstraction present, an older
call site can be simplified *now*, in the same session, while the developer or agent already
has the context loaded. The alternative is a large restructuring later, when nobody remembers
why the old code looked that way. Refactoring cost grows faster than linearly with the number
of sites touched at once, so many one-site cleanups beat one twelve-site cleanup, even when the
total number of edits is identical.

### 3.3 Duplicates drift, and drift produces real bugs

Two copies of the same logic do not stay the same. This repository already has an instance.
`isRecord` — a one-line type guard — exists in four places, and one of them is not the same
function as the other three:

```
packages/hooks/src/payload.ts:4        typeof v === 'object' && v !== null && !Array.isArray(v)
packages/transcripts/src/analyze.ts:8  typeof v === 'object' && v !== null && !Array.isArray(v)
packages/transcripts/src/index.ts:31   typeof v === 'object' && v !== null && !Array.isArray(v)
packages/codeview/src/server.ts:53     typeof value === 'object' && value !== null
```

The fourth accepts arrays. Nothing announced that divergence, and no test covers it, because
each copy is exercised only through its own module's behaviour. This is the cost the early
position is trying to avoid, and it is not hypothetical here.

### 3.4 Coordination value for parallel work

When several agents work on one checkout under a fence scheme (`CONTRACTS.md`), a shared type
that already exists is a coordination point that costs nothing to agree on. A shared type that
must be introduced mid-wave requires a contract edit, which is serialised and slow. For *types*
specifically, existing early has a scheduling benefit that has nothing to do with code quality.

### 3.5 Agents rediscover badly

An agent that cannot find an existing helper does not fail loudly — it writes a new one. Its
default failure mode is silent duplication, not an error. Every additional copy also raises the
cost of the eventual consolidation, because the copies have already begun to differ. The early
position is partly a bet that this failure mode is worse than the wrong-abstraction failure
mode. In an agent-heavy codebase that bet is more defensible than it is in a human-only one.

## 4. The case against early

### 4.1 The wrong abstraction costs more than the duplication

The standard statement of this is Sandi Metz's: duplication is cheaper than the wrong
abstraction. The mechanism is specific and worth spelling out. When an abstraction is close but
not right, the next caller does not delete it — the caller adds a parameter. The parameter is
usually a flag, and the flag usually selects between two behaviours inside one function. After
three such callers the function has eight paths, no caller uses more than one, and the tests
cover the paths rather than the behaviours. Unwinding that is far more work than deleting three
independent copies would have been.

Duplication has a bounded, visible cost. A wrong abstraction has an unbounded, invisible one,
because each accommodation looks locally reasonable.

### 4.2 Prediction from one example is unreliable

An abstraction extracted from a single use encodes that use's incidental details as if they
were essential. There is no way to tell which details are incidental until a second example
disagrees with the first. This is why the rule of three exists: three examples is roughly the
point where the variable parts separate from the fixed parts by observation rather than by
guess.

### 4.3 Speculative surface is read forever

Rule PS-051 in this repository already bans code that exists "for later". The reason is cost
per read, not disk space. An unused parameter is read by every agent that opens the file, is
included in every context window that contains the file, and must be reasoned about by anyone
deciding whether a change is safe. Early abstractions tend to carry exactly this kind of unused
surface, because they were built for uses that had not happened yet.

### 4.4 Premature sharing turns independent modules into coupled ones

Extracting a helper into a shared location creates a dependency edge. Two modules that
previously could be changed, tested, and regenerated independently now cannot. For a one-line
type guard this trade is probably bad: the coupling is permanent and the saving is one line.
The extraction is worth the edge only when the shared logic is either non-trivial or genuinely
required to agree across callers.

### 4.5 The lookup cost is real

"Is there already something for this?" is not free to answer. In a repository of ten packages,
checking costs an agent a search, a file read, and a judgement about whether the existing thing
fits. If the answer is usually no, that cost is paid on every task and repaid on few. Early
abstraction increases the number of things that must be searched before writing anything.

## 5. Evidence from this repository

Measurements taken 2026-08-23, at 94 commits.

### 5.1 The shared functions are barely shared

`packages/core` exports thirty names: twenty-seven types and three functions. The three
functions have these non-test call sites:

| Function | Modules calling it |
|---|---|
| `splitJsonlChunk` | 3 |
| `truncate` | 2 |
| `outputTokensPerMinute` | 1 |

One of the three shared functions has a single caller. It is shared in location only.

### 5.2 The genuinely duplicated code was never promoted

The helpers that actually repeat were never moved into `core` at all:

| Helper | Copies | Extracted? |
|---|---|---|
| `isRecord` | 4 | No — and one copy has diverged (§3.3) |
| `asString` | 3 | No |
| `readAppended` | 3 | No |
| Recursive directory walk | 3 (`walkTsFiles`, `walkMarkdownFiles`, `walkSourceFiles`) | No |

The three directory walkers are the clearest case. `packages/check/src/scan.ts`,
`packages/codemap/src/io.ts`, and `packages/init/src/io.ts` contain the same eight-line
recursive `readdir`, with the same `catch(() => [])`, the same `Promise.all` fan-out, and the
same shape of result. They differ only in which file extensions they accept and which
directories they skip — that is, exactly in the two places a parameter belongs. Here the rule
of three has been satisfied, the correct signature is now observable rather than guessed, and
the extraction still has not happened.

### 5.3 What that pattern means

The repository has a promotion mechanism, and it works for things that were *designed* to be
shared. It has no mechanism at all for things that *became* shared. Deferring the abstraction
was the right call in each individual case; the failure is that nothing ever revisits the
decision. This is the real weakness of the late position, and it is a process weakness rather
than a design one.

The commit history says the same thing: of 94 commits, two mention restructuring. Cleanup is
not currently happening on any cadence, triggered or otherwise.

## 6. The variable that actually matters is not time

Framing this as early-versus-late hides the real driver. What determines the cost of being
wrong is **how expensive it is to change the abstraction once it has callers**, and that
depends on properties you can assess immediately.

| Property | Cheap to fix later | Expensive to fix later |
|---|---|---|
| Kind | Data type | Behaviour with branching |
| Callers | Inside one module | Across packages, or external |
| Checked by | Compiler | Tests, or nothing |
| Wrongness shows up as | Type error at every site | Subtly wrong output at one site |

Under strict TypeScript, changing a shared *type* produces an error at every affected site. The
compiler performs the survey for you, so a wrong type is a bounded, mechanical fix. This is why
`core` holding twenty-seven types and three functions is the right ratio and not an accident:
types are the cheap thing to commit to early, and behaviour is the expensive thing.

Restating the guidance in terms of reversibility rather than timing:

> **Commit early to shapes the compiler can survey. Commit late to behaviour it cannot.**

This resolves most of the apparent conflict. Defining `AgentActivity` on day one was correct
even though only one module consumed it. Defining a shared `formatActivity` on day one would
not have been, because its wrongness would have surfaced as bad output rather than as a build
failure.

## 7. The third option: cleanup immediately after green

The prompt's third suggestion — frequent debt-reduction passes run as soon as the work passes
its tests — is the strongest of the three, with one qualification.

### 7.1 Why it is the right default here

* **The evidence is complete.** After the feature works, the number of copies is known. The
  extraction is a measurement, not a prediction. This is the rule of three applied at the
  moment the third instance actually appears, rather than "eventually".
* **The safety net exists.** A green suite is what makes a behaviour-preserving change
  checkable. Running the pass at any other time means restructuring without a verifier.
* **The context is still loaded.** Whoever just wrote the duplicate is the cheapest one to
  remove it. A week later that context must be rebuilt from scratch.
* **The diff stays reviewable.** Separating "make it work" from "make it clean" produces two
  small diffs with different review questions, instead of one large diff that mixes them. That
  matters more with agents than with humans, because review confidence falls off sharply as
  diffs grow.

### 7.2 Where it fails

* **A pass with no trigger does not run.** "After it works" is the moment of least appetite for
  more work. This is exactly what the two-in-94 commit ratio above records.
* **Batching couples unrelated changes.** A pass that sweeps up everything it notices produces
  a diff touching many modules for many reasons, which is the hardest kind to review and the
  hardest to revert.
* **It can be used to justify skipping design entirely.** "We will clean it up in the pass" is
  the same sentence as "we will fix it later" with better branding.
* **Behaviour-preserving is a claim, not a fact.** The pass is only as safe as the tests are
  real. Where coverage is thin — and by §3.3 the duplicate `isRecord` copies are covered only
  indirectly — a consolidation pass can change behaviour silently.

### 7.3 The qualification

A cleanup pass needs a **trigger**, not a schedule. Something must count the duplicates and say
so, or the pass will be skipped exactly when it is most needed. The count is mechanical: a
detector reporting identical or near-identical function bodies in three or more files would
have flagged `isRecord`, `asString`, and the three walkers today, with no judgement involved.

## 8. Synthesis: the rule

Combining the three positions rather than choosing between them:

1. **Name the concept early, always.** Give the thing an accurate name and a findable location
   from the first use. This is the part of "abstract early" that pays, and it costs nothing,
   because you have to name it anyway.
2. **Commit early to types.** A shared data type with one consumer is fine. The compiler makes
   the correction cheap, and parallel work benefits from a fixed shape.
3. **Duplicate behaviour until the third use.** Keep PS-049 as it stands. Two copies are
   cheaper than one wrong parameterisation.
4. **Treat the third use as an obligation, not a permission.** The current rule licenses
   extraction at three; it should require it. That closes the gap in §5.3.
5. **Run the extraction in its own pass, immediately after green.** Structure-only diff,
   separate commit, no behaviour change.
6. **Make the trigger automatic.** A count, not a memory.
7. **When the abstraction turns out to be wrong, inline it back.** Deleting a shared function
   and restoring two copies is a normal, cheap operation. It only feels expensive because
   abstractions get treated as one-way. Treating extraction as reversible is what makes rule 4
   safe to apply aggressively.

The prompt's instinct is right in its second half and needs adjusting in its first. The gain
described — "I can use this existing function", "this can now be simplified" — comes from the
abstraction being present and findable, which is a naming and cleanup-cadence property. It does
not require having guessed the right shape in advance, and guessing is where the cost is.

## 9. Recommended next steps for this repo

1. Add a duplicate-body detector to `packages/check` that reports any function body appearing
   in three or more files, and let it fail the gate above a ratchet threshold in
   `ratchet.json`. This is the trigger from §7.3.
2. Extract the three directory walkers into one function taking a file predicate and a skip
   list. The signature is now observable from three real uses.
3. Promote `isRecord`, `asString`, and `asNumber` into `packages/core`, and decide explicitly
   whether arrays count as records — the `codeview` copy currently disagrees with the other
   three.
4. Amend PS-049 to state the obligation as well as the permission: *duplicate twice; extract at
   the third use, in a separate structure-only commit against a green suite.*
5. Reconsider whether `outputTokensPerMinute` belongs in `core` at all, given it has one
   caller. Inlining it back into `packages/transcripts` is the rule-7 move.

## 10. Open questions

* What is the right ratchet threshold for duplicate bodies? Three files is the rule-of-three
  reading, but one-line type guards may deserve a length floor, so that trivia does not force
  cross-package coupling (§4.4).
* Does the reversibility framing in §6 survive contact with runtime-validated data, where the
  compiler cannot survey the call sites? Probably not, and those cases may need the late rule
  even for types.
* Is silent duplication by agents (§3.5) frequent enough here to shift the balance further
  toward early? Measuring how often an agent writes a helper that already existed would settle
  it, and the detector in §9.1 would produce that data as a side effect.

## 11. Related reading

* Sandi Metz, "The Wrong Abstraction" (2016) — the duplication-versus-wrong-abstraction
  argument in §4.1.
* Martin Fowler, *Refactoring* — the rule of three, and refactoring as a separate step from
  behaviour change.
* [docs/small-modules-for-agents-2026-08-23.md](small-modules-for-agents-2026-08-23.md) — the
  companion question of module granularity; its promotion ladder is the mechanism this report
  asks to be made automatic.
* [docs/style-guide.md](style-guide.md) — PS-049, PS-051, PS-055.
