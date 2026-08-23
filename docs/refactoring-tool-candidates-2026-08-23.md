# Candidate tools for agentic refactoring

*2026-08-23*

`packages/mcp` currently advertises nine tools: `outline`, `symbol`, `usages`, `search`,
`repo_map`, `replace_symbol`, `insert_symbol`, `rename_symbol`, and `check`. Those cover
finding code and rewriting one declaration at a time. They do not cover the transformations
that make up most real refactoring work: moving a declaration to a different file, changing a
function's parameters, fixing the imports afterwards, and undoing the whole thing when the
gate goes red.

This report brainstorms twenty-eight further tools, scores each one, and recommends an order
to build them in. Two conclusions come out of the scoring, and both are worth stating before
the table.

The first is that the TypeScript language service already implements most of the expensive
transformations. `organizeImports`, `getCodeFixes`, `getEditsForFileRename`, and
`getApplicableRefactors` are shipped functions that return edit lists. Exposing them costs
a day each; reimplementing them costs weeks and produces something worse. The highest-return
work in this list is almost entirely wrapping, not writing.

The second is that a tool catalogue is not free. Every tool's name, description, and schema
is sent on every request that the server participates in — roughly sixty to eighty tokens
each, so the present nine cost around six hundred tokens per call. A tool the agent invokes
once a week is worse than no tool at all, because its description is paid for continuously
and its behaviour is learned rarely. That is why likelihood of use is weighted as heavily as
value below, and why the bottom of the list is a recommendation against building rather than
a backlog.

## How the scores work

Each candidate gets three ratings from 1 to 5.

**Likelihood** is how often an agent doing ordinary work in this repository would reach for
it. 5 means several times a session; 1 means a few times a year.

**Challenge** is implementation cost. 1 is a thin wrapper over an existing function; 3 is a
few hundred lines of new compiler-API code with tests; 5 is a research problem with a long
tail of cases where it must refuse rather than guess.

**Value** is how much better the outcome is than what the agent does today with the tools it
has. A tool that replaces a fragile workaround scores higher than one that replaces a
merely verbose one.

**Return** is `likelihood x value / challenge`. It ranges from 0.2 to 25. It is a sorting
device, not a measurement — it is useful for separating the top of the list from the bottom,
and meaningless for distinguishing 6.0 from 6.7.

## The candidates

| # | Tool | What it does | L | C | V | Return |
|---|---|---|---|---|---|---|
| 1 | `type_of` | The checker's inferred type for a symbol or an expression at a position | 4 | 1 | 4 | 16.0 |
| 2 | `organize_imports` | Remove unused imports, add missing ones, sort, across named files | 5 | 1 | 3 | 15.0 |
| 3 | `apply_code_fix` | Offer and apply the compiler's own quick fixes for a diagnostic | 5 | 2 | 5 | 12.5 |
| 4 | `diagnostics` | Type errors for one file or symbol, without running the full gate | 5 | 2 | 5 | 12.5 |
| 5 | `preview` (option on every write tool) | Return the diff the call would produce, without writing it | 4 | 2 | 4 | 8.0 |
| 6 | `rename_file` | Move or rename a module and rewrite every import specifier | 3 | 2 | 5 | 7.5 |
| 7 | `checkpoint` / `revert` | Mark a point, then undo every edit made since it | 4 | 3 | 5 | 6.7 |
| 8 | `delete_symbol` | Remove a declaration, refusing if it still has uses | 4 | 2 | 3 | 6.0 |
| 9 | `implementations` | Classes implementing an interface, and methods overriding a method | 3 | 2 | 4 | 6.0 |
| 10 | `module_graph` | Import edges for a file or folder, plus any cycles | 3 | 2 | 4 | 6.0 |
| 11 | `unused_exports` | Exported declarations with no use outside their own file | 3 | 2 | 4 | 6.0 |
| 12 | `symbol_diff` | The working-tree change against `HEAD`, grouped by declaration | 3 | 2 | 4 | 6.0 |
| 13 | `symbol_metrics` | Length, nesting, branch count for one declaration or folder | 2 | 1 | 3 | 6.0 |
| 14 | `callers` | The call graph above a function, to a given depth | 4 | 3 | 4 | 5.3 |
| 15 | `batch_edit` | Apply several symbol-addressed edits as one all-or-nothing call | 4 | 3 | 4 | 5.3 |
| 16 | `move_symbol` | Move a declaration to another file, fixing imports on both sides | 4 | 4 | 5 | 5.0 |
| 17 | `members_of` | The full surface of a type, including inherited members | 3 | 2 | 3 | 4.5 |
| 18 | `change_signature` | Add, remove, or reorder parameters and update every call site | 4 | 5 | 5 | 4.0 |
| 19 | `apply_refactor` | Run one of the compiler's named refactorings on a range | 3 | 3 | 4 | 4.0 |
| 20 | `tests_for_symbol` | The tests that reach a symbol, through the reference graph | 3 | 3 | 4 | 4.0 |
| 21 | `blast_radius` | Uses, transitive callers, and covering tests for a symbol, in one call | 3 | 3 | 4 | 4.0 |
| 22 | `escape_hatch_index` | Every `any`, `as`, and suppression comment, with the ratchet count | 2 | 1 | 2 | 4.0 |
| 23 | `inline_symbol` | Replace uses of a trivial declaration with its body and delete it | 2 | 3 | 3 | 2.0 |
| 24 | `edit_journal` | Every write this session, as a list of declarations touched | 2 | 2 | 2 | 2.0 |
| 25 | `format` | Run the formatter on named files | 2 | 1 | 1 | 2.0 |
| 26 | `codemod` | Match an AST pattern across the repo and rewrite each match | 2 | 5 | 4 | 1.6 |
| 27 | `similar_symbols` | Declarations whose shape is close to a given one | 2 | 4 | 3 | 1.5 |
| 28 | `symbol_history` | Commits and authors that touched a declaration | 1 | 3 | 2 | 0.7 |

## What to build, in order

### First — the wrappers that pay for themselves immediately

`type_of` (1) is the cheapest useful tool in the list. An agent editing a function it did not
write guesses at the type of a parameter or an intermediate value, and the guess is wrong
often enough to cost a gate cycle. The checker knows the answer, `typeToString` formats it,
and the whole tool is a lookup and a call.

`organize_imports` (2) and `apply_code_fix` (3) are the two places where the agent currently
does by hand what the compiler will do for it. After a symbol moves or a name changes, imports
are wrong in a mechanical, entirely determined way; the language service computes the exact
edits. `apply_code_fix` is the more valuable of the two because it covers the long tail —
missing import, missing property, unimplemented interface member — where the agent's own
repair attempt is a guess that may itself not compile.

`diagnostics` (4) closes the loop. `check` is the gate and should stay the gate, but it runs
the whole repository, and an agent in the middle of a five-edit refactor wants to know whether
edit three broke edit two. A scoped diagnostic call against the already-loaded program answers
in a fraction of the time. The risk is that the agent starts treating it as the gate; the
description has to say plainly that it is not.

### Second — the safety layer

`preview` (5) and `checkpoint`/`revert` (7) are not refactorings. They are what makes the
refactorings safe to attempt. Today an agent that applies `rename_symbol` and then discovers
the rename was wrong has to reconstruct the old state from memory. A checkpoint that snapshots
the affected files and a revert that restores them turns a bad refactoring from an incident
into a retry. `preview` is the same idea one step earlier: let the agent see the edit before
committing to it, so a wrong plan costs a read rather than a repair.

`batch_edit` (15) belongs to this layer too. Most real refactorings are several symbol edits
that are only correct together — change a type, then its three consumers. Applying them one
call at a time leaves the repository broken between calls, and any failure halfway through
leaves it broken permanently. All-or-nothing application removes that window.

### Third — the transformations proper

`rename_file` (6) and `move_symbol` (16) are the two moves that agents currently avoid because
doing them by hand is tedious and error-prone. `rename_file` is mostly a wrapper over
`getEditsForFileRename` and should come first. `move_symbol` is genuinely new work — it has to
decide which imports the moved declaration needs in its new home, which the old file no longer
needs, and whether the move creates a cycle — but it is the tool that turns "this file is too
big" from an observation into an action.

`change_signature` (18) has the highest value in the list and the highest cost. Adding a
parameter to a function with fourteen call sites is exactly the work an agent is bad at by
hand and exactly the work it does often. The difficulty is that the correct new argument at
each call site is not mechanically derivable in general, so the tool has to either take a
default expression, or rewrite only the sites it can and report the rest. Building it as
"rewrite what is determined, list what is not" makes it tractable and probably makes it more
useful, since the listed sites are the ones a human should look at anyway.

`apply_refactor` (19) scores lower than its underlying capability deserves, because it is a
generic passthrough: the agent has to discover which refactorings apply at a position before
it can use one, which is two calls where the specific tools are one. It is worth building
after the specific tools, as the escape hatch for everything they do not cover.

### Fourth — the analyses that direct the work

`callers` (14), `module_graph` (10), `unused_exports` (11), `implementations` (9), and
`blast_radius` (21) all answer the question "what will this break, and what should I change
next". They are cheap to build on the existing index, and they matter more as the repository
grows than they do now. `unused_exports` in particular tends to find real dead code on first
run, which makes it easy to justify.

`symbol_diff` (12) deserves a note. An agent reviewing its own work reads a line diff, which
for a refactoring is mostly noise — moved code shows as a large deletion and a large addition
with no indication they are the same thing. A diff grouped by declaration, marking each one
added, removed, moved, or changed, is both smaller and more accurate about what happened.

### Do not build

The bottom five are not close calls.

`similar_symbols` (27) and `codemod` (26) are the two that sound most appealing and score
worst. Near-duplicate detection is a research problem whose output is a list of suggestions a
human has to adjudicate; an agent that acts on it unsupervised will unify things that happen
to look alike. A general AST-pattern codemod is a language inside a tool — powerful, hard to
get right, and hard for an agent to use correctly from a description. Both are better served
by the specific transformations above, which fail loudly and in known ways.

`symbol_history` (28) loses to running `git log` directly. `format` (25) is already covered by
the gate. `edit_journal` (24) duplicates what the transcript already records.

## Cross-cutting requirements

Three properties should hold for every write tool added, not be decided per tool.

**Refuse rather than guess.** `rename_symbol` already does this — when it finds an occurrence
it cannot rewrite safely, it reports and changes nothing. Every transformation above has cases
it cannot resolve, and in each of them a partial edit that compiles is worse than a refusal,
because the agent cannot see what was silently skipped.

**Detect staleness.** The existing tools re-read each file and compare it against the index
before writing, so a plan computed against an old state fails rather than corrupting a new
one. Multi-file transformations make this more important, not less: `move_symbol` touches
files the agent never read.

**Report in symbols, not offsets.** Results that name declarations compose with the read
tools; results that give character ranges do not, and force the agent back to reading files.

## Suggested first slice

Six tools, in this order: `type_of`, `diagnostics`, `apply_code_fix`, `organize_imports`,
`preview` as an option on the existing write tools, and `checkpoint`/`revert`. Five of the six
are wrappers, the sixth is file snapshots, and together they cover the two things missing from
the current server: knowing what the compiler knows, and being able to undo. `rename_file`,
`move_symbol`, and `batch_edit` follow once that base is in place.
