---
id: BL-0025
title: docs:regen — generated marker-block inventories with staleness gate
type: feature
status: idea
priority: "?"
effort: s
risk: low
area: repo
sprint:
created: 2026-08-23
closed:
links: [docs/tools-and-process.md, README.md, packages/backlog/src/index.ts, packages/check/src/main.ts, backlog/BL-0022-caveman-final-answer-clarity.md]
---

## Idea

Keep the tool/skill/package inventories in README.md and docs/tools-and-process.md from
drifting by generating them in place inside marked regions, and enforce freshness in the
gate. A `docs:regen` script assembles inventory tables from sources that already exist and
are machine-readable — root and per-package `package.json` (scripts, add `description`
fields), `.claude/skills/*/SKILL.md` frontmatter — and rewrites only the content between
`<!-- BEGIN GENERATED: <name> (npm run docs:regen) -->` / `<!-- END GENERATED -->` markers.
Prose around the blocks stays hand-written and freely editable. `npm run check` gains a
staleness step: regenerate to a temp buffer, diff against the committed file, fail if they
differ. Decided AGAINST mustache template/output file pairs: two-artifact edit ambiguity,
doubled agent read cost (README.md is already the corpus's most expensive read at ~20.8k
est tokens per `npm run transcripts -- files`), and templates don't self-enforce freshness
— only a check does.

## Assumptions

- The drift problem is real: the transcripts analyzer shipped without any README/docs path
  (fixed by hand in 447ca9f) — exactly the gap generation closes.
- Inventory data stays derivable from package.json + SKILL.md frontmatter; anything not
  derivable (interaction prose) stays hand-written outside the blocks.
- The check gate is the right enforcement point (same pattern as ratchet: committed
  artifact must match recomputed truth).

## Design decisions

- **Block granularity** — one big inventory block per file vs one block per list (tools,
  skills, packages). Per-list blocks let docs place them in different sections;
  recommended.
- **Description source for packages** — add `description` to each `packages/*/package.json`
  (npm-standard, machine-readable; recommended) vs a separate inventory.json (second
  source of truth; avoid).
- **Gate behavior** — fail on stale (strict, matches ratchet philosophy; recommended) vs
  auto-regenerate during check (mutating gate steps surprise agents mid-wave).
- **Scope of first cut** — README tool summary table + tools-and-process.md inventory +
  skills list, or also AGENTS.md. Start with the two human docs; AGENTS.md when stable.

## Related

- [BL-0022] — the transcripts `files` view supplied the read-cost evidence against the
  mustache twin-file approach.
- `packages/backlog/src/index.ts` (`buildBacklogTable`/`buildDoneLog`) — the proven
  regenerate-a-view pattern this extends; BACKLOG.md/DONE.md are whole-file generated,
  this adds the in-place marker variant for files with hand-written prose.
- `packages/check/src/main.ts` — the gate that gains the staleness step.
- `.claude/skills/*/SKILL.md` — frontmatter (name, description) is the skills data source.
- docs/tools-and-process.md — primary target file; its Skills section (~line 164) and Tools
  sections become partly generated.

## Approaches

Short term: `packages/docsgen` (or a module inside `packages/backlog` renamed later):
pure functions `extractMarkers(md)`, `renderInventory(sources)`, `spliceBlock(md, name,
content)`; a main.ts that reads sources, splices, writes; a check-mode (`--check`) that
exits nonzero on diff, wired into packages/check as step 5.

Long term: same mechanism serves any derived list (backlog counts in README, dashboard
panel docs, per-package README stubs). If multi-file stamping ever appears, a template
engine can live inside the generator without changing what readers see.

Adjacent ideas worth their own item: none — inventory-interaction prose stays manual by
design.

## Bedrock

Seam: the repo's existing "committed artifact must equal recomputed truth" invariant
(ratchet.json, BACKLOG.md). This extends that invariant to prose-embedded lists via
markers, keeping ONE enforcement point (`npm run check`) instead of adding a second
generation system. Verdict: **simplest-along-the-grain**. The simple version must NOT
introduce template/output file pairs or a template language — the generated region lives
inside the published file, and the gate (not convention) enforces freshness.

## Done means

- [ ] `npm run docs:regen` regenerates marker blocks in README.md and
      docs/tools-and-process.md from package.json + SKILL.md frontmatter.
- [ ] Every `packages/*/package.json` has a `description` field.
- [ ] `npm run check` fails when a generated block is stale; passes after regen.
- [ ] Deleting a package or skill and running regen removes it from every inventory.
- [ ] Hand-written prose outside markers survives regen byte-for-byte.

## Simplest possible implementation

Single script `packages/backlog/src/docsgen.ts` (reuse the package that already owns
regen) + `docs:regen` npm script + one marker block in tools-and-process.md listing npm
scripts with descriptions. Gate step diffs regenerated output.

Pros:
- Closes the observed drift gap with ~150 lines in an existing package; no new deps.
- Gate-enforced: cannot silently rot, unlike templates or convention.
- Zero new artifacts; agents keep editing the same files they read.

Cons:
- Marker blocks are editable in place; agents may edit inside them and lose the change at
  next regen (mitigated: marker text names the generator; gate catches the stale state).
- package.json `description` fields must be written once and kept honest.
- In-place splicing needs careful idempotent parsing (regen twice = identical output) —
  covered by Done means #5 and a unit test.
