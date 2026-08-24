---
id: BL-0032
title: Per-src-folder README.md as a maintained file index
type: idea
status: idea
priority: "?"
effort: "?"
risk: "?"
area: repo
sprint:
created: 2026-08-23
closed:
links: [backlog/BL-0025-docs-regen-marker-blocks.md, docs/small-modules-for-agents-2026-08-23.md, packages/codemap/src, packages/hooks/README.md]
---

## Idea

Every `packages/*/src` folder (and any subfolder) carries a `README.md` that acts as an
index: one entry per file and subfolder, each with a one-or-two-line statement of purpose.
The index serves two audiences — humans learning what lives where, and agents orienting in
a package before touching it. The two-line budget doubles as a design probe: a file whose
purpose cannot be stated in two lines is doing more than one thing and is a candidate for
splitting. A `util` file or folder is an accepted escape valve for the genuinely
unclassifiable. The index must be mechanically maintained (generated or gate-checked), not
convention-maintained, or it rots.

## Assumptions

- Agents actually read a folder README before working in that folder — cheap to make true
  by adding one line to AGENTS.md, but worth verifying via transcripts.
- The one-to-two-line descriptions carry information the file name does not; otherwise the
  index is noise (same "earn the line" rule AGENTS.md already applies to doc comments).
- Descriptions cannot be fully generated — purpose is judgment — so the mechanism must
  combine a generated file list with hand-written description text, and gate the list's
  completeness rather than the prose's quality.
- Ten packages with mostly flat `src/` folders keep the surface small (~10–15 READMEs).

## Design decisions

- **Generated vs gated** — fully generate the README from source (descriptions must then
  live somewhere in code, e.g. a `//!` first-line file comment) vs hand-written README with
  a gate that fails when a file is missing from or removed after the index. Generation
  gives one source of truth; gating keeps prose free-form. The BL-0025 marker-block
  mechanism is the middle path: generated file list skeleton, hand-written description
  cells.
- **Description home** — in the README itself vs a leading `//` file-purpose comment in
  each source file that the generator harvests. Harvesting keeps description next to code
  (moves/renames carry it along) and makes the README fully generated; recommended if
  BL-0025's generator lands first.
- **Enforcement point** — `npm run check` staleness step (matches ratchet philosophy) vs
  advisory-only. Advisory indexes rot; the whole premise is mechanical maintenance.
- **Relationship to package-level README (PS-064 proposal)** — is the src-folder index a
  section of the package README or a separate file? One file per package avoids two
  half-overlapping docs; but subfolders (e.g. a future nested `src/`) need their own.

## Related

- [BL-0025] — supplies the exact mechanism: marker-block regen plus a check-gate staleness
  step. This item is plausibly a second consumer of that generator, not new machinery.
- docs/small-modules-for-agents-2026-08-23.md §7.5 — proposes PS-064 (package README with
  fixed sections, generated Contract block). This idea extends it downward: file-level
  index, not just export-level contract. §7.7 (PS-065, termination conditions) shares the
  "prose only an agent can write, structure the machine enforces" split.
- [BL-0016] (archived) — codeview already renders package readmes; folder READMEs would
  appear there for free.
- `packages/codemap/src` — the code index already knows every file and its symbols; it is
  the natural source for the generated file list (and for detecting files missing an
  entry).
- `packages/hooks/README.md` — the repo's one existing package README; evidence that
  convention alone produced one README across ten packages.

## Approaches

Short term: piggyback on BL-0025. Add a `docs:regen` target that writes/updates each
`packages/*/src/README.md` with a generated table (file name column from disk, description
column preserved from the existing README or harvested from a leading file comment), and a
check step that fails on unlisted or ghost files. Empty description cells fail the gate —
that is the "can you say it in two lines?" probe made mechanical.

Long term: descriptions harvested from first-line file comments make the README fully
generated and the source file self-describing; `npm run stats` zones or codemap metrics
could annotate each row (size, zone) so the index doubles as a health map. The two-line
rule could become a lint (PS-nnn): flag files whose description exceeds the budget or is
missing.

Adjacent ideas worth their own item:
- A first-line file-purpose comment convention (style-guide rule) independent of READMEs —
  landed as PS-057.

## Bedrock

Seam: the same "committed artifact must equal recomputed truth" invariant that ratchet and
BL-0025 use, extended to folder membership. The concrete strengthening: `packages/codemap`
already computes the file/symbol inventory, so the index gate gives that inventory a
human-facing consumer, and every future file added to a `src/` folder must declare its
purpose to pass `npm run check` — which is the decomposition pressure the idea is really
after. Verdict: **simplest-along-the-grain**. The simple version must NOT hand-write whole
READMEs with no gate (they rot, and the repo already has the evidence: one README in ten
packages) and must NOT build a second generator alongside BL-0025's.

## Done means

- [ ] Every `packages/*/src` folder has a `README.md` listing every file in it with a
      one-or-two-line purpose.
- [ ] `npm run check` fails when a source file is missing from its folder README, listed
      but deleted, or has an empty description.
- [ ] Regenerating twice produces byte-identical output; hand-written description text
      survives regen.
- [ ] AGENTS.md tells agents to read the folder README before working in a package.

## Simplest possible implementation

Hand-write the ~10 `src/README.md` files once, then add a small check (inside the BL-0025
generator when it exists, or a standalone ~60-line step in `packages/check`) that diffs the
set of listed file names against the directory listing and fails on mismatch or empty
description. No harvesting, no generation of prose.

Pros:
- Immediate orientation value for agents; codeview renders them for free.
- The gate makes the index self-healing: adding a file without describing it fails check.
- Writing the first pass is itself the audit — files that resist a two-line description
  get flagged for splitting now.

Cons:
- Descriptions live only in the README, so file moves/renames need a manual README edit.
- Without BL-0025 landed, this adds a second bespoke check step that should later merge
  into the shared generator.
- Ten more prose files to keep honest; the gate checks presence, not truthfulness.
