# The backlog `approach` field is typed in core, parsed and rendered only in packages/backlog

**Date:** 2026-08-23  **Mode:** before  **Status:** active

## Question
Where the BL-0020 `approach: sequential | parallel | undecided` frontmatter field lives:
the type, the parser, the renderer, the tests, and the new `/start-work` skill.

## Ruling
- `packages/core/src/index.ts`: add `BacklogApproach = 'sequential' | 'parallel' | 'undecided'`
  next to the other `Backlog*` value-set types (lines 72-84) and one non-optional
  `readonly approach: BacklogApproach` field on `BacklogItem`. Non-optional: the parser
  totalizes with a default, exactly as `status`/`priority`/`effort`/`risk` do.
- `packages/backlog/src/index.ts`: `validApproaches` beside the other `valid*` arrays
  (lines 23-27), `parseApproach` following the `parseEffort`/`parseRisk` shape via the
  existing `isOneOf`, defaulting to `undecided` when absent or unrecognized; one line in
  `parseBacklogFile`'s return object; one unconditional `approach: ${item.approach}` line in
  `renderBacklogItem`, placed after `risk` (unconditional, like the other enum fields —
  not conditional like `owner` — so round-tripping a parsed item is stable).
- `packages/backlog/test/backlog.test.ts`: one case per value plus default-when-absent.
- `.claude/skills/start-work/SKILL.md`: new skill file, vendoring the user-global
  `feature-dev` skill per the BL-0021 pattern; one-line pointer edits in
  `track-issue` and `track-backlog` SKILL.md files. Skills are docs; no code placement
  question there.
- Dashboard display: deferred, correctly. Do not touch `packages/dashboard` in this change.

## Because
- `BacklogItem` and all its value-set types live in `packages/core/src/index.ts:72-103`;
  `packages/core/src/index.ts` imports nothing (leaf), and `DashboardSnapshot` embeds
  `readonly backlog: readonly BacklogItem[]`. Colocating the type in `packages/backlog`
  would force core to import from backlog or evict `DashboardSnapshot` from core.
- The parse/render pattern is uniform and already in place: `validStatuses`..`validRisks`
  at `packages/backlog/src/index.ts:23-27`, `parse*` at 32-66, `renderBacklogItem` at 167.
  The new field is a fifth instance of an existing pattern, not a new idea.
- `decisions/2026-08-22-adopt-workquarry-format.md` (referenced from the item) already
  fixes the seam: schema is the TS types in core, `packages/backlog` is the one write path.

## Constraints for implementers
- `BacklogApproach` and the `approach` field go in `packages/core/src/index.ts`; no backlog
  type may be declared in `packages/backlog`.
- `approach` is non-optional on `BacklogItem`; `parseApproach` returns `'undecided'` for
  absent or unrecognized values (tolerant parse, matching the sibling parsers).
- `renderBacklogItem` emits `approach:` unconditionally, after `risk:`.
- Reuse `isOneOf` (`packages/backlog/src/index.ts:29`); do not write a new membership check.
- Tests live in `packages/backlog/test/backlog.test.ts`: each valid value round-trips, and
  a file without the field parses as `undecided`.
- No `packages/dashboard` changes in this item.
- `/start-work` must not restate wave mechanics; parallel work delegates to
  `.claude/skills/parallel-wave/SKILL.md` (per the item's own decided constraints).

## Rejected
- Type in `packages/backlog` next to its parser — inverts the core→backlog dependency via
  `DashboardSnapshot`; contradicts the WorkQuarry ADR.
- `approach?: BacklogApproach` optional field — breaks the totalized-parse convention every
  other enum field follows and pushes `undefined` handling onto every consumer.
- Rendering `approach` only when not `undecided` — makes parse→render→parse unstable and
  differs from the sibling enum fields for no gain.
- New `approach.ts` file in packages/backlog — ~10 lines does not justify a file; the
  sibling parsers all live in `index.ts`.

## Enforcement
Judgment plus existing gates: `npm run check` covers types and tests; no new mechanical
check is warranted for a three-value enum. The core→backlog direction is already visible in
`module_graph` if anyone inverts it.

## Revisit when
The dashboard starts charting `approach` (may want an aggregation helper — that belongs in
`packages/backlog` or `packages/dashboard`, not core), or `BacklogItem` grows enough enum
fields that a table-driven frontmatter codec pays for itself.
