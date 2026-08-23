---
id: BL-0030
title: backlog validate and backfill-markers skip archived items
type: bug
status: ready
priority: p3
effort: S
risk: low
area: packages/backlog
sprint:
created: 2026-08-23
closed:
links: [packages/backlog/src/io.ts, packages/backlog/src/index.ts, backlog/BL-0023-archive-closed-items.md]
---

## Symptoms and impact

Two functions in `packages/backlog/src/io.ts` list only the top level of `backlog/`, so
since BL-0023 moved closed items into `backlog/archive/` they no longer see 14 of the 29
items:

- `readBacklogFileInfos` (`packages/backlog/src/io.ts:128`) — backs
  `npm run backlog:validate`, which is the `backlog` step of `npm run check`. Duplicate-id
  and misnamed-file detection now covers live items only; a duplicate or malformed id
  inside `backlog/archive/` passes the gate silently.
- `backfillMarkers` (`packages/backlog/src/io.ts:110`) — would not re-derive id markers for
  archived items if `backlog/.ids/` were ever lost or partially recreated.

Not currently failing: `validate` reports `ids ok — 29 allocated, no duplicates` because
the markers in `backlog/.ids/` are complete and are the real source of truth for
allocation. Id reuse is prevented by `allocateBacklogItems`, which claims a marker with an
exclusive create, so this is a hole in *verification*, not in allocation. It becomes real
the moment markers and files disagree — which is exactly the case `validate` exists to catch.

By contrast `loadBacklog` (`packages/backlog/src/index.ts`) was taught about the archive in
BL-0023 and is correct, which is why `BACKLOG.md`, `DONE.md`, and the dashboard were
unaffected by the move.

## Root cause

BL-0023 fixed file discovery in one of the two places that do it. `loadBacklog` reads
`dir` plus `dir/archive`; `io.ts` kept its single `listNames(dir)` call. The archive layout
is now knowledge duplicated across two modules instead of owned by one — the exact failure
the BL-0023 Bedrock note warned about ("the simple version must NOT let any caller glob
`backlog/*.md` directly").

## Fix approaches

- **Shared helper (preferred)** — extract the "list item files in `dir` and `dir/archive`"
  logic used by `loadBacklog` into one exported function and have both `io.ts` callers use
  it. Removes the duplication rather than patching the second copy.
- **Patch in place** — add the archive directory to `listNames` in both `io.ts` functions.
  Two lines, but leaves three places that know the layout.
- **Do nothing** — defensible only while markers are authoritative, and it silently weakens
  a gate step, so no.

Either fix must keep archived files reported with a path that distinguishes them, or
duplicate-detection error messages will name two files with the same basename and no way to
tell them apart.

## Done means

- [ ] `npm run backlog:validate` inspects `backlog/` and `backlog/archive/` and reports
      duplicates across both
- [ ] `backfillMarkers` re-derives markers for archived items
- [ ] A test covers a duplicate id where one of the pair is archived
- [ ] Only one function in the codebase knows the archive directory layout
- [ ] `npm run check` green

## Simplest possible fix

Export the archive-aware listing helper from `packages/backlog/src/index.ts` (or move it
beside `listNames` in `io.ts`) and call it from `readBacklogFileInfos` and
`backfillMarkers`, then add the duplicate-across-archive test.
Pros:
- Restores the gate's coverage and collapses three copies of the layout rule into one.
Cons:
- Touches `io.ts`, which a concurrent session recently rewrote for race-free allocation —
  check for in-flight work before starting.
