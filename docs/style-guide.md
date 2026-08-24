# Platonic TypeScript Style Guide

Rules for writing TypeScript in this repository, for humans and coding agents.

Every rule has an ID (`PS-nnn`). Cite the ID in review comments, backlog items, and commit
messages. IDs are stable and never reused.

Rules are grouped by **who enforces them**:

* **Tier 1 — Mechanical.** A tool fails the build. Listed here only so the ID exists; the
  tool is the authority. Do not argue with this section, run `npm run check`.
* **Tier 2 — Mechanizable.** Real rules, not yet enforced. Each is a candidate lint rule.
* **Tier 3 — Judgment.** Cannot be checked by a tool. This is the part worth reading.

When a Tier 2 or Tier 3 rule becomes enforceable, move it to Tier 1 and **delete its prose**.
This document should shrink over time. Prose is a staging area for lint rules.

Rationale for the functional subset is in
[Pure Functional Programming for Agent-Driven Development](pure-fp-for-agents-2026-08-22.md).
Rationale for the enforcement mechanisms is in
[Testing, Gates, Ratchets, and Goldens](testing-gates-ratchets-goldens-2026-08-22.md).
This guide does not repeat either.

## Zones

Three zones. Most rules apply differently in each.

| Zone | Files | Rules |
|---|---|---|
| **Core** | `packages/*/src/**` except the roots below | Pure. Full rules apply. |
| **Root** | `src/main.ts`, `src/server.ts`, `src/io.ts` | Composition and IO. Ambient access and mutation allowed. |
| **Test** | `packages/*/test/**` | Ambient access, mutation, and `throw` allowed. Type safety stays. |

"Pure" means: same inputs, same outputs, no observable effect. No clock, no filesystem, no
network, no randomness, no logging, no mutation of anything the caller can see.

## Tier 1 — Mechanical

Enforced by `tsconfig.json`, `eslint.config.js`, and `ratchet.json`. See `npm run check`.

| ID | Rule | Enforced by |
|---|---|---|
| PS-001 | No `any` | `@typescript-eslint/no-explicit-any`, ratchet |
| PS-002 | No classes | `functional/no-classes` |
| PS-003 | No `throw` outside Test | `functional/no-throw-statements` |
| PS-004 | No mutation of data outside Root/Test | `functional/immutable-data` |
| PS-005 | No `Math.random`, `Date.now`, `process.env` outside Root | `no-restricted-properties` |
| PS-006 | No `fetch` outside Root | `no-restricted-globals` |
| PS-007 | No `console` outside Root | `no-console` |
| PS-008 | No floating promises | `@typescript-eslint/no-floating-promises` |
| PS-009 | Escape hatches (`as`, `!`, `@ts-*`, `eslint-disable`) may fall, never rise | ratchet |
| PS-010 | Strict compiler settings, including `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` | `tsc --noEmit` |

## Tier 2 — Mechanizable

Not yet enforced. Follow them anyway; expect each to become a lint rule.

**PS-020 — `const` only in Core.** No `let`, no `var`. Build the value, do not accumulate into
a variable. In Root, `let` is allowed for loop and lifecycle state.

**PS-021 — Exported functions declare their return type.** Inference is fine for locals. An
exported signature is a contract and must be readable without running the compiler.

**PS-022 — No default exports.** Named exports only. Default exports get renamed at every
import site, which breaks grep and rename.

**PS-023 — One level of re-export.** A package's `index.ts` may re-export from its own modules.
It may not re-export another package's barrel. Chains hide where a symbol lives.

**PS-024 — Files stay under 300 lines.** Over that, split by concern. Large files are more
expensive to edit and harder to work on in parallel (H2, H3, H4).

**PS-025 — A module exports at most about 15 symbols.** More than that means the file holds
more than one concern.

**PS-026 — `type`, not `interface`.** Type aliases compose with unions and intersections and
cannot be reopened by declaration merging.

**PS-027 — Everything is `readonly`.** Every field of every record type, and every array in a
parameter or return position (`readonly string[]`, not `string[]`).

**PS-028 — Arrow consts, not `function` declarations.**

```ts
// no
export function sumCounts(counts: RatchetCounts[]): RatchetCounts { ... }
// yes
export const sumCounts = (counts: readonly RatchetCounts[]): RatchetCounts => ...
```

**PS-029 — No `enum`.** Use a union of string literals. It is erasable, structurally typed, and
prints usefully.

```ts
export type ActivityKind = 'assistant' | 'user' | 'tool_result' | 'other'
```

**PS-030 — No `namespace`, no `declare module` outside type-shim files.** Modules are the unit.

**PS-031 — `undefined`, not `null`.** One absent value. Convert at the IO edge where an external
format uses `null`.

**PS-032 — Relative imports across packages.** Repo convention; no path aliases, no build step
between packages.

**PS-033 — No abbreviated identifiers.** `request`, not `req`. `configuration`, not `cfg`. The
exceptions are established domain terms (`id`, `url`, `json`, `http`) and single-letter
callback parameters in a one-line lambda.

## Tier 3 — Judgment

**PS-040 — Data first, behaviour second.** Define the types before the functions that operate on
them. A package's shared types live in one place (`packages/core/src/index.ts` for the shared
contract, the package's own type block otherwise) so a reader can learn the shape without
reading logic.

**PS-041 — One concern per file, named after the concern.** `ratchet.ts` counts escape hatches,
`scan.ts` walks the repo, `run.ts` runs steps. If the honest filename would be `utils.ts`, the
file has no concern and should be split into the files that use it.

**PS-042 — Total functions. Encode failure in the return type.** A function that can fail returns
a result, it does not throw and does not return a lie.

```ts
// no — caller cannot see the failure, and PS-003 forbids it in Core
const parseItem = (text: string): Item => { if (!ok) throw new Error('bad') }

// yes
export type ParseResult =
  | { readonly ok: true; readonly item: Item }
  | { readonly ok: false; readonly reason: 'missing-header' | 'bad-status' }

export const parseItem = (text: string): ParseResult => ...
```

Do not build a general `Result<T, E>` monad stack. A purpose-built union per module is smaller,
reads better, and needs no combinators.

**PS-043 — Parse at the edge, trust inside.** Validation happens once, in Root, where untrusted
text becomes a typed value. Core receives values that are already valid and does not re-check.
Every defensive check inside Core is either dead code or evidence that the edge is wrong.

**PS-044 — Dependencies point inward.** Core does not import Root. Core does not know that a
filesystem, a socket, or a dashboard exists. If a Core function needs the current time, it takes
`now: number` as a parameter.

**PS-045 — Ambient values are parameters.** Time, randomness, environment, and IO handles are
passed in. This is what makes a function testable without a mock, and it is the whole reason
PS-005 exists.

**PS-046 — Prefer plain data over closures over objects.** A record you can log, diff, and store
beats a function you captured state in. Reach for a closure only when the captured state is
genuinely private and short-lived.

**PS-047 — Verbs for functions, nouns for types.** Ban `Manager`, `Helper`, `Util`, `Service`,
`Handler`, `Info`, `Data`, and `Base` in every name. They describe nothing. If no better name
exists, the concern is not yet understood — that is the finding, not the name.

**PS-048 — No defensive code for cases the types exclude.** No `if (x === undefined)` on a
non-optional parameter. No `try`/`catch` around a pure call. Trust the type system; it is
configured strictly for exactly this reason.

**PS-049 — Duplicate twice before abstracting.** Two similar blocks are cheaper than one wrong
abstraction. Wait for the third use, when the shape is known.

**PS-050 — Comments say why, never what or when.** No history, no dates, no ticket numbers, no
"changed in wave 2", no restating the code. The good use is a non-obvious trade-off, stated once
at the top of the file or above the surprising line:

```ts
// Approximation: matched by regex over raw source rather than comment-trivia parsing.
// These are fixed magic tokens that essentially never appear outside real directives, so a
// whole-text regex is robust and far simpler. Trade-off: a string literal containing
// "eslint-disable-line" is miscounted — acceptable for a counter that only needs to move
// monotonically with real usage.
```

**PS-051 — No speculative parameters, options, or exports.** Nothing exists "for later". If no
call site needs it today, delete it. Unused surface is read by every agent that touches the file
and costs tokens forever.

**PS-052 — Build values with pipelines, not accumulators.** `filter`/`map`/`reduce` over a loop
with a mutable target. The result is one expression whose type the compiler checks end to end.

**PS-053 — Errors carry data, not prose.** A failure value holds a discriminant and the fields a
caller needs to decide. Message strings are formatted at the Root, where the audience is known.

**PS-054 — Test the seam, not the interior.** Tests exercise a module's exported contract with
plain data in and plain data out. A test that reaches into an unexported helper freezes an
implementation detail and blocks the next refactor.

**PS-055 — One level of abstraction per function.** A function either orchestrates named steps or
does one step. Not both. Around 30 lines is where this usually breaks.

**PS-056 — Break a rule in the open.** If a rule must be violated, do it in one place, add a
comment naming the rule ID and the trade-off, and — if the violation is an escape hatch — bump
`ratchet.json` in the same commit. A silent violation is the failure mode; a documented one is a
decision.

**PS-057 — Every source file opens with a `//` purpose comment, at most two lines.** State what
lives in this file and why — information the file name does not already carry. Same doctrine as
AGENTS.md's "Documenting exports": earn the lines, write from evidence, timeless present tense. A
`util` file may say so honestly; vagueness is not an accepted answer, but "unclassifiable" is. If
the purpose does not fit two lines, the file holds more than one concern — split it, don't
summarize around the problem. New files comply from creation; an existing file gains the comment
the next time it is touched, not by a repo-wide retrofit.

## Applying this

For an agent editing this repository:

1. Read the zone table. Know which zone the file is in before writing a line.
2. Write to Tier 2 and Tier 3 by default. Do not wait for a linter to object.
3. Run `npm run check` before and after. That is the only definition of green.
4. If you break a rule, apply PS-056.
5. If you find a Tier 3 rule that could be mechanized, record it in `NOTES.md`. Moving a rule out
   of this document is the highest-value change anyone can make to it.
