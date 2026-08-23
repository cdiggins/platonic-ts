# Backlog id allocation

Every backlog item is `BL-NNNN`, a monotonically increasing four-digit number. This note
records how a new number is handed out, and why it works the way it does.

## The problem

The original rule was "take the highest existing `backlog/BL-*.md` number and add one."
That is correct only if one process does it at a time. Two sessions filing an item in the
same second both read 24 and both write a `BL-0025-*.md` file — with different slugs, so
neither overwrites the other and nothing complains. The duplicate is silent, and by the
time anyone notices, the id is in commit messages and cross-links.

This is not hypothetical. Implementing the allocator turned up an existing collision: two
committed items both claimed `BL-0028`, filed four minutes apart. The later one is now
`BL-0029`.

## What this repo is not

No branches, no worktrees, no second machine — see the conventions in `AGENTS.md`. That
removes the harder version of the problem. There is exactly one copy of the backlog on one
filesystem, so there is no merge to reconcile and no invisible remote writer. Everything
below assumes that; reintroduce branches and this design needs revisiting.

## The mechanism

One primitive does the real work: exclusive file creation. `open(path, 'wx')` either
creates the file or fails with `EEXIST`, atomically, on NTFS and POSIX alike. So the act
of claiming a number and the act of recording it can be the *same* operation, and there is
no interval during which two processes both believe they hold number 25.

Every number ever handed out is recorded by an empty marker file in `backlog/.ids/`, named
by the zero-padded number. To allocate:

1. Scan `backlog/` and `backlog/.ids/` for the highest number in use. This picks a
   starting point only.
2. Try to create the marker with `wx`. On `EEXIST`, move up and try again.
3. With the marker held, create the item file at `BL-NNNN-<slug>.md`, also with `wx`.

Correctness comes entirely from step 2. Step 1 can be stale, wrong, or skipped and the
result is a few extra failed attempts, never a duplicate.

## Why a marker file and not the item file

The obvious shortcut — claim `BL-0025-<slug>.md` directly — does not work. Exclusive create
guards one exact path, and two callers with different slugs are creating different paths,
so both succeed on the same number. The claim has to happen on a name that does not depend
on the slug, which is what the marker is.

Markers are never deleted. That gives a second property the filename scan never had:
renaming or deleting an item does not free its number for reuse. An id that appeared in a
commit message stays retired.

## Why no lock file

A lock is the conventional answer and it is strictly worse here. It needs a stale-lock
timeout, because a killed agent leaves the lock held; the timeout is a guess, and guessing
wrong either hangs the next caller or lets two of them through. Exclusive create has no
such state. A killed agent leaves an empty `BL-0025-<slug>.md` — the number correctly
marked as taken, and a visible sign that someone started an item and did not finish it.

## Gaps are fine, duplicates are not

A crashed allocation burns a number. So does an item created and then deleted. The sequence
is therefore gappy, and deliberately so: renumbering to close a gap would invalidate ids
already referenced in commits, links, and conversation. A gap costs nothing.

## Using it

```
npm run backlog:next-id -- <slug> [<slug> ...]
```

Prints `BL-NNNN<tab><path>` per slug and creates each file, empty. Passing several slugs at
once returns a contiguous block, which is what a supervisor fanning work out to several
subagents wants: allocate up front, hand each track its number, and no subagent has to
coordinate with any other.

```
npm run backlog:validate
```

Reports duplicate numbers, frontmatter that disagrees with the filename, unparseable or
unnumbered files, and items with no marker (meaning: created by hand, outside the
allocator). This runs as the last step of `npm run check`. The allocator cannot prevent
someone hand-creating a colliding file; the validator is what makes that visible the same
day rather than six items later.

```
npx tsx packages/backlog/src/main.ts backfill-markers
```

Idempotent repair: records markers for items that predate the allocator, or for an item
someone created by hand and wants to keep.

## Code

| Where | What |
|---|---|
| `packages/backlog/src/ids.ts` | Pure: name/number conversion, which numbers are in use, validation rules. |
| `packages/backlog/src/io.ts` | The exclusive-create claim, block allocation, marker backfill. |
| `packages/backlog/src/main.ts` | CLI. |
| `packages/backlog/test/ids.test.ts` | Includes concurrent allocation, deletion and rename not freeing a number, and stepping over a hand-created file. |

## Tested and untested

The concurrency tests fire many overlapping allocations against a real temporary directory
within one process. That exercises the real `open(…, 'wx')` syscall and real interleaving,
and it did catch a genuine bug during development. It is not a multi-process test: the
cross-process guarantee rests on the operating system's exclusive-create semantics rather
than on anything measured here.
