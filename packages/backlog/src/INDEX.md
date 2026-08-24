# packages/backlog/src

Parses, renders, and loads backlog markdown items from `backlog/`, and allocates and
validates their `BL-NNNN` ids. It also owns the second regenerate-a-view job in the repo:
the generated inventory blocks inside README.md and docs/tools-and-process.md.

| File | Purpose |
|---|---|
| `docsgen.ts` | Pure half of `npm run docs:regen`: parses `<!-- BEGIN GENERATED: <name> … -->` marker blocks, renders the npm-script, package, and skill inventory tables, splices them back in idempotently, and reports which blocks are stale. |
| `docsgenIo.ts` | Filesystem half of `npm run docs:regen`: reads the root and per-package `package.json` manifests and `.claude/skills/*/SKILL.md` frontmatter, then rewrites the target documents (`write`) or reports their stale blocks (`check`). |
| `ids.ts` | Pure id logic: formats/parses `BL-NNNN` strings and marker filenames, computes the first free number from a set of used numbers, and validates a set of backlog files against their `.ids/` markers (duplicate numbers, missing markers, id/filename mismatches). |
| `index.ts` | Parses one backlog markdown file's frontmatter (with tolerant migration from the pre-WorkQuarry schema) into a `BacklogItem`, loads and sorts the full backlog (live plus archived) from disk, and renders items and the generated `BACKLOG.md`/`DONE.md` views. |
| `io.ts` | Filesystem half of id allocation: claims a backlog id with an exclusive-create marker file in `backlog/.ids/` so concurrent claims never collide, backfills markers for pre-allocator items, and reads file/marker listings for validation. |
| `main.ts` | CLI entry (`npx tsx packages/backlog/src/main.ts`) — dispatches `regen`, `next-id`, `validate`, `backfill-markers`, and `archive` (which moves closed items into `backlog/archive/` with `git mv`). |
