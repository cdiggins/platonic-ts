# Building the refactoring tools: what the ranking got right, and what it missed

*2026-08-23*

[The candidate list](refactoring-tool-candidates-2026-08-23.md) ranked twenty-eight possible
tools and recommended a first slice of six. What actually got built is the four layers it
described — twenty-four new tools — by eight agents working in parallel on one checkout, each
writing pure functions with their own tests, with the wiring onto the protocol left to a single
integration pass at the end.

This is the report on what that produced. The interesting parts are the two predictions that
held, the one that did not, and the defect the parallelism found that no single agent would
have.

## The server now

Thirty-three tools, up from nine. They fall into the layers the ranking used.

**Ask the compiler** — `type_of`, `members_of`, `diagnostics`, `code_fixes`, `refactorings`.
These wrap what the TypeScript language service already computes. The prediction that they
would be cheap held: all five are thin, and four of the five came in under two hundred lines
including their error handling.

**Analyse what depends on what** — `callers`, `implementations`, `tests_for_symbol`,
`blast_radius`, `module_graph`, `unused_exports`, `symbol_metrics`, `escape_hatch_index`,
`symbol_diff`. All of these run off the existing index and need no bound program, which is why
they answer in three to twelve milliseconds against a repository whose index takes 2.8 seconds
to build.

**Change things** — `delete_symbol`, `organize_imports`, `apply_code_fix`, `move_symbol`,
`rename_file`, `change_signature`, `apply_refactor`, beside the three that already existed.

**Undo things** — `checkpoint`, `revert`, `batch_edit`, and a `preview` option on every tool
that writes.

## What the ranking got right

**The compiler had already done the hard parts.** `organize_imports` and `rename_file` are
wrappers. `apply_code_fix` and `apply_refactor` are passthroughs over `getCodeFixesAtPosition`
and `getApplicableRefactors`. Together they took a fraction of the effort that `move_symbol`
and `change_signature` took, and they cover more ground.

**The safety layer mattered more than any single transformation.** `preview` turned out to be
the cheapest thing in the wave and is the one option now present on every write tool: a wrong
plan costs a read instead of a repair. `batch_edit` exists because most real refactorings are
several edits that are only correct together, and applying them one call at a time leaves the
repository broken in between.

## What the ranking got wrong

**`change_signature` was rated the highest-value tool and it is, but the design that makes it
tractable also makes it refuse more often than expected.** The tool takes an explicit argument
mapping — `$0` copies the existing argument at index 0, anything else is inserted as source —
so the caller states the mapping rather than the tool inferring it. That much worked. What the
ranking did not anticipate is how many references to a function are not calls: a re-export
through a barrel, the function passed as a value, a use in a type position. On this repository
almost every exported function is re-exported from `packages/mcp/src/index.ts`, so
`change_signature` on a public function refuses on the barrel line every time. The refusal is
correct — but the tool is far less applicable in a barrel-exporting codebase than the ranking
assumed, and that is a property of the repository, not of the tool.

**The catalogue cost is worse than estimated.** The ranking put a tool's description at sixty
to eighty tokens and warned that a rarely-used tool is net-negative. Thirty-three tools now
cost about 4,800 tokens on every request — closer to 145 tokens each, because a description
that says what a tool *cannot see* is longer than one that only says what it does. Those limits
are worth their length: `unused_exports` reporting candidates rather than verdicts, `callers`
not seeing dynamic dispatch, `diagnostics` not being the gate. But the total is now large
enough that a test holds a ceiling on it, and the next tool added should displace one rather
than join it.

## The defect the parallelism found

`applyEdits` sorts edits back to front and applies them by reduction, so that earlier offsets
stay valid. If one edit's range *contains* another's, the outer edit lands second and
overwrites the inner one — carrying the text the first edit already replaced. The file is
corrupted, and nothing anywhere reports it.

This is not a hypothetical. Two agents hit it from different directions within an hour:
the one building `change_signature` found that `twice(twice(1))` yields two nested call sites,
and the one building `preview` found that the compiler's own import edits replace an entire
import block as one span, which overlaps anything else editing that region.

Neither could fix it — the file is outside both their fences — and each independently derived
the same range-collision rule to protect itself. That is the signal worth keeping: when two
agents working on unrelated tools invent the same guard, the guard belongs underneath both of
them. It now lives once, beside `applyEdits`, and `writeEdits` checks it before anything
reaches the disk, which covers the three write tools that shipped before this wave and had the
same hazard all along.

## What the tools found when pointed at this repository

`unused_exports` reports 32 candidates in 18 files, mostly exported types used only in their own
module. `module_graph` reports 5 import cycles, all between a barrel and its own modules —
which is the pressure point of the one-level-of-re-export rule, showing up as a measurement
rather than an opinion. Both lists are triage input, not verdicts.

## What is still missing

`revert` cannot undo a refactoring that created or deleted a file, because an edit plan
expresses replacements only. It refuses the whole restore and names the files rather than
half-undoing. Since `move_symbol` and `rename_file` are exactly the tools that move files, the
safety layer does not yet cover the transformation layer. Extending the plan shape with create
and delete variants is the change that would close it.

`move_symbol` leaves the source file's now-unused import in place — unused, not broken —
because removing it is `organize_imports`' job and composing the two was out of scope. The
composition is one call today and should be one tool tomorrow.

Nothing here has been tried by an agent other than the one that wrote it. The tools are tested;
the descriptions that decide when an agent reaches for them are not.
