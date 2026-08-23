---
id: BL-0023
title: Move closed items to backlog/archive/ so the live backlog stays small
type: feature
status: done
priority: "?"
effort: S
risk: low
area: packages/backlog
sprint:
created: 2026-08-23
closed: 2026-08-23
links: [packages/backlog/src/index.ts, packages/backlog/src/main.ts, packages/core/src/index.ts, decisions/2026-08-22-adopt-workquarry-format.md]
---

## Idea

When an item is completed (`status: done`) or dropped, move its file from `backlog/` into
`backlog/archive/`. History stays findable — the file is not deleted, and `backlog/DONE.md`
still lists it — but `backlog/` itself only ever holds live work, so the current state of the
project is legible at a glance instead of buried under closed items. Today all 23 item files
sit in one flat directory and the ratio only gets worse.

## Assumptions

- The archive is a plain subdirectory, not a separate format — archived files keep the same
  frontmatter and body, so nothing needs migrating and an item can be un-archived by moving
  it back.
- `backlog/DONE.md` remains the human-facing index of closed work, so archiving must not
  make closed items disappear from generated views.
- Nothing outside `packages/backlog` reads item files directly; `packages/dashboard` gets
  them through `loadBacklog` (`packages/dashboard/src/main.ts:16`).

## Design decisions

- **Who moves the file** — A: `npm run backlog:regen` moves closed items as a side effect of
  regenerating (one command, but a regen that silently does `git mv` is surprising and hard
  to review) vs B: a separate explicit `npm run backlog:archive` step vs C: the skills move
  the file when they set `status: done`. B is the most predictable; C is the least code.
- **What `loadBacklog` scans** — recurse into `archive/` always (so `DONE.md` stays
  complete and ids stay unique-checkable) vs scan `backlog/` only, with the archive read
  separately for `DONE.md`. Recursing is simpler and keeps id allocation safe — the
  track-* skills allocate the next id by looking at existing files, so they must still see
  archived ones or ids will be reused.
- **Whether the dashboard shows archived items** — hide by default with a toggle, or drop
  them entirely from the snapshot.

## Related

- [packages/backlog/src/index.ts] — `loadBacklog` (line ~128) does the file discovery that
  must learn about the subdirectory; `isOpen` (line ~174) already knows open-vs-closed.
- [packages/backlog/src/main.ts] — the `regen` CLI; a new `archive` subcommand would live here.
- [decisions/2026-08-22-adopt-workquarry-format.md] — fixes `packages/backlog` as the single
  write path, so the move belongs there rather than in a script or a skill.
- [BL-0020] — `/start-work` also changes `packages/backlog/src/index.ts`. The two edits
  overlap in one file, so sequence them; do not run them as parallel wave tracks.
- [.claude/skills/track-idea/SKILL.md] — its id-allocation rule ("highest existing
  `backlog/BL-XXXX-*.md` number + 1") breaks if archived files stop being visible to the
  glob. All three track-* skills need the same wording fix.

## Approaches

Short term: teach `loadBacklog` to recurse one level into `archive/`, add
`npm run backlog:archive` that `git mv`s every `done`/`dropped` item into `backlog/archive/`,
and update the three track-* skills' id-allocation wording to include the archive directory.
Long term: archive by period (`archive/2026-Q3/`) if the flat archive itself gets large; the
dashboard could then show a closed-work timeline.

## Bedrock

The seam is file discovery: `loadBacklog` is the single place that decides what an "item" is
and where items live. Putting the archive rule there — rather than in a script, a skill, or
the dashboard — means every consumer (regen, dashboard, future tooling) inherits it for
free, and the directory layout stays a detail of one function instead of a convention three
skills have to remember. **Verdict: simplest-along-the-grain.** The simple version must NOT
let any caller glob `backlog/*.md` directly — id allocation especially — or the archive
becomes invisible to exactly the code that must not reuse an id.

## Done means

- [x] Closed items live in `backlog/archive/` and `backlog/` holds only open work
- [x] `loadBacklog` finds archived items, so `backlog/DONE.md` is unchanged by the move and
      no id can be reused
- [x] Archiving is an explicit, reviewable step, not a silent side effect of regen
- [x] The three track-* skills' id-allocation wording accounts for the archive directory
- [x] `npm run check` green

## Simplest possible implementation

Add an `archive` subcommand to `packages/backlog/src/main.ts` that moves `done`/`dropped`
item files into `backlog/archive/`, and make `loadBacklog` glob both `backlog/*.md` and
`backlog/archive/*.md`. Update the skills' id rule. Run it once against the current backlog.
Pros:
- Small, self-contained, and reversible — archived files are ordinary items in a subfolder.
- Live backlog becomes legible immediately, which is the entire point.
Cons:
- Any consumer that globs `backlog/*.md` by hand (skills, ad-hoc greps) silently misses
  archived items until updated — the id-reuse risk is the sharp edge.
- File paths of closed items change, so links pointing at `backlog/BL-XXXX-*.md` from docs
  or commit messages go stale.
