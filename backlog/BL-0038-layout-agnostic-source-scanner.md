---
id: BL-0038
title: Layout-agnostic source scanner shared by check, codemap, and mcp
type: debt
status: idea
priority: p2
effort: S
risk: low
area: check
sprint:
created: 2026-08-30
closed:
links: [BL-0005, BL-0037, BL-0010]
---

## Idea
`collectSourceFiles` in `packages/check/src/scan.ts` hardcodes `packages/*/{src,test}` as
the only place TypeScript lives. `packages/codemap/src/io.ts` and `packages/mcp/src/io.ts`
both import it, so the code index — and therefore every MCP tool — sees zero files in any
repo that is not shaped like this one. Gratify (`src/`, `tests/`, `examples/`) is the first
real casualty. Generalize the walker to take source roots as a parameter, defaulting to the
current behavior so this repo's gate is unchanged, and make the MCP server and codemap
resolve roots for the repo they are pointed at.

## Assumptions
- The Gratify trial (BL-0005 Phase 0) and the agent-toolkit install (BL-0037) both block on
  this; it is a prerequisite, not an optimization.
- Root discovery can stay simple: an explicit list (config or argument) with a sensible
  fallback (`packages/*/{src,test}` if present, else `src`/`tests`/`test`/`examples` at the
  repo root, skipping `node_modules`, `dist`, `.git`). `packages/init/src/io.ts` already
  carries the richer skip list (`walkSourceFiles`) — NOTES.md's Wave 4 Track M finding
  explicitly names deleting that duplicate walk as the candidate follow-up.
- The ratchet's meaning does not change for this repo: same roots, same counts, no baseline
  movement.

## Design decisions
- Where the root list lives — a `platonic.json`-style config in the target repo vs an
  argument threaded from each entry point (mcp `main.ts`, codemap `openSession`, check
  `main.ts`). An argument is simpler and keeps config surface at zero; a config file is what
  `init` could write. Start with the argument; let BL-0037 decide if a file is needed.
- Which walker survives — `scan.ts`'s `walkTsFiles` (also duplicated in `boundaryScan.ts`)
  vs `init`'s `walkSourceFiles` (better skip list, skips `*.d.ts`). One should win and the
  other three call sites converge on it; the review doc lists all four walkers.
- Where the shared walker lives — it is used by check, codemap, mcp, and init, but
  `packages/check` is scoped "gates only" (AGENTS.md), so the walker arguably belongs in
  `packages/core` (pure signature, IO edge beside it) or a caller-owned module. Placement is
  a decision — spawn the architect before landing (AGENTS.md rule); this also affects the
  `check -> codemap` boundary rule's rationale.

## Related
- [BL-0005](BL-0005-gratify-trial.md) — Phase 0 names this as the first prerequisite.
- [BL-0037](BL-0037-init-agent-toolkit-install.md) — its done-criteria ("MCP server indexes
  the target repo") depend on this landing first.
- [BL-0010](BL-0010-init-retrofitter.md) — its Bedrock section states the constraint this
  item finishes: "must not hardcode any assumption specific to this repo's file layout… or
  the boundary doesn't hold for repo number two."
- [docs/repo-review-2026-08-29.md](../docs/repo-review-2026-08-29.md) — records the four
  duplicate walkers and the `packages/check`-as-utility-library smell this item resolves.
- NOTES.md, Wave 4 Track M — "give `packages/check` a layout-agnostic scanner and delete
  the duplicate walk."

## Approaches
Short term: parameterize `collectSourceFiles(repoDir, roots?)` with the fallback discovery
above; thread roots through `openSession`/`loadWorkspace` and the mcp/codemap mains; delete
the `boundaryScan.ts` duplicate.
Long term: one walker in one home (architect ruling), `init` writing the root list for
retrofitted repos, and the boundary/docs gates using the same discovery so every gate step
agrees on what "the sources" are.

## Bedrock
The invariant this strengthens: "the set of source files" is defined once, by one function,
and every consumer — ratchet, index, boundary gate, MCP tools, init — agrees on it. Today
four walkers each answer slightly differently, which is how a file can be counted by the
ratchet but invisible to the index. Fixing the layout assumption and the duplication in one
move makes repo number two (Gratify) and every later target cheap, and removes the reason
`packages/check` doubles as a utility library. Verdict: **simplest-along-the-grain** — the
simple version parameterizes the existing function, but it must not add a fifth walker or
leave `boundaryScan.ts`'s copy behind.

## Done means
- [ ] `collectSourceFiles` (or its successor) takes source roots with a fallback that
      discovers both `packages/*/{src,test}` and plain `src`/`tests`/`examples` layouts
- [ ] The MCP server pointed at the Gratify checkout indexes all of its TypeScript files
- [ ] This repo's gate output is unchanged (same file set, same ratchet counts)
- [ ] The duplicate walker in `packages/check/src/boundaryScan.ts` is gone; an architect
      ruling records where the shared walker lives

## Simplest possible implementation
Add an optional `roots` parameter to `collectSourceFiles`, defaulting to the current
`packages/*` derivation when a `packages/` directory exists and falling back to
`src`/`tests`/`test`/`examples` otherwise; update `boundaryScan.ts`, `codemap/src/io.ts`,
and `mcp/src/io.ts` to call it; leave `init`'s walker untouched for now.

- Gets: Gratify indexable this week; one behavior change, three call sites, low risk; this
  repo's counts provably unchanged.
- Gives up: the walker consolidation and placement ruling (four walkers become three, not
  one); no per-repo config file; `*.d.ts` still counted by the check walker even though
  init's walker skips it.
