---
name: track-issue
description: Log a concrete issue (bug, technical debt, open design problem, or retire candidate) into backlog/ with elaboration — symptoms/impact, affected code links, root-cause notes, fix approaches, and simplest fix. Use when the user says /track-issue, "file an issue", "log this bug", "track this debt", "this should be retired", or an agent discovers out-of-scope debt/bugs mid-task.
argument-hint: <the issue, in a phrase or paragraph>
---

# track-issue — capture and elaborate a concrete issue

Sibling of `/track-idea`, for defects and liabilities rather than opportunities:
`type: bug | debt | problem | retire` (use `/track-idea` for `idea`/`feature`). You create
and edit `backlog/*.md` item files directly (closed ones live in `backlog/archive/`);
investigation is yours. After creating or
changing any item, run `npm run backlog:regen` to rebuild `backlog/BACKLOG.md` and
`backlog/DONE.md`. Process reference: `decisions/2026-08-22-adopt-workquarry-format.md`.
Schema types: `packages/core/src/index.ts`.

## Steps

### 1. Understand the issue
From the argument or recent conversation. Pick the type:
- **bug** — observed wrong behavior
- **debt** — code that works but resists change/reuse (coupling, duplication, missing
  tests, raw types, escape hatches — see `ratchet.json`)
- **problem** — open design question that needs an answer before dependent work
- **retire** — code, doc, or feature that should be deleted or deprecated
If ambiguous between two types, pick the one whose closing action is clearer (a bug closes
with a fix; debt closes with a refactor; a problem closes with an ADR; retire closes with a
deletion).

### 2. Locate the evidence (before writing anything)
Unlike ideas, issues must point at something real:
- Find the affected files/symbols with `Grep`/`Glob`; record `path:line` where possible.
- For bugs: capture the repro or the observed-vs-expected behavior from conversation, logs,
  or a quick check. Do not run long builds/tests just to file — note "unverified" instead.
- Check `backlog/*.md` + `backlog/archive/*.md` (closed items are moved into the archive by
  `npm run backlog:archive`, so the live glob alone misses them) + `BACKLOG.md`/`DONE.md`
  for an existing item covering the same thing — enrich it rather than duplicate.
- Check `decisions/` for ADRs that explain why the current state is intentional (if one
  does, say so in the body — the item may be a supersede-proposal, not a defect).

### 3. Create the item file
Allocate the id with the allocator — never by scanning `backlog/BL-XXXX-*.md` for the highest
number. That scan races when two sessions file an item at the same moment, and it misses the
closed items sitting in `backlog/archive/`, so it can hand out an id that is already taken:

```
npm run backlog:next-id -- <slug>
```

It prints `BL-00NN<tab><path>` and creates that file, empty. Write your content into the
path it printed; do not rename it. For several items at once, pass every slug in one call
(`npm run backlog:next-id -- slug-one slug-two`) and you get a contiguous block back.

The file takes this frontmatter:

```yaml
---
id: <the id the allocator printed>
title: <short imperative title>
type: bug              # bug | debt | problem | retire
status: idea
priority: "?"
effort: "?"
risk: "?"
area: <package name, or 'repo' for cross-cutting>
sprint:
created: <today, YYYY-MM-DD>
closed:
links: []
---
```
Always reason about priority — don't default to `?`. Weigh: impact severity × frequency,
whether it blocks other backlog items, and cost growth if deferred (debt compounds; bugs
usually don't). State the reasoning in the Priority section below. Effort/risk likewise when
evident (risk for retire = blast radius). Run `npm run backlog:regen` after writing the file.

### 4. Elaborate — append body to the item file
Sections after the frontmatter; terse, evidence-first. Skip a section only when empty.

```markdown
## Issue
What is wrong / at risk, one paragraph. For bugs: observed vs expected, repro steps or
"unverified — reported in conversation <date>".

## Impact
Who/what hits this and how often. What it blocks or slows. Cost of doing nothing.

## Affected code
- path:line — role in the problem.

## Cause / analysis
Root-cause hypothesis (bugs), why the debt accumulated (debt), what makes the question hard
(problem), why the code is obsolete (retire). Mark speculation as such.

## Priority
Why this priority: severity × frequency, what it blocks, cost of deferral.

## Dependencies
- Blocked by: [ids/paths] — what must land first.
- Blocks: [ids] — backlog items this gates.
- Touches: shared code/areas where concurrent work would collide.

## Fix approaches
1–3 options with one-line trade-offs. For problems: candidate answers; note that closing
should produce an ADR (`decisions/`) + follow-up items.

## Bedrock
The version of this fix that leaves the architecture stronger — patch the symptom vs. fix
the invariant. Name the specific seam, invariant, boundary, or file it strengthens (the
invariant the bug violated, the boundary that let it through), and what future changes it
makes cheaper or safer. Then a one-line verdict: **simplest / right / simplest-along-the-grain**.
When the verdict is simplest-along-the-grain, state exactly what the simple fix must NOT do
so the stronger design stays reachable.

## Done means
2–5 verifiable statements of what "fixed" looks like, written as checkboxes. Optional at
capture; required before promotion to `ready` for bug/debt/feature. Include the verification
step as its own box when a fix needs runtime confirmation — a landed fix awaiting
verification is not done.
- [ ] the repro no longer reproduces
- [ ] regression test added and passing (`npm run check` includes `npx vitest run`)
- [ ] verified in the running app

Whoever lands the fix ticks these in the commit that satisfies them; when all are ticked,
set `status: done` + `closed: <date>` and regenerate views in the following commit. Progress
is read from these boxes — never stored as a percentage.

## Simplest fix
Smallest change that resolves it, with pros/cons: what you get, what you give up or risk.

## Prevention
How to keep this class of issue from recurring:
- Existing backlog items that would already prevent it — link and say how.
- Tests: the missing test that would have caught it (regression test = part of the fix;
  class-level test coverage = its own item).
- New features/tooling ideas (invariants, typed APIs, checks, gates) — offer to file each
  via `/track-idea` or as a capture-only item.
```

The **Bedrock** section may be a single line — "No architectural leverage here — simplest
wins." — when that is true. What is NOT allowed: generic design-principle recitation that
names no concrete file, seam, or invariant.

Ground everything in what you actually found in step 2 — real paths, real symbols, no
invented behavior.

### 5. Report to the user
Give: the new id (linked), one-line impact statement, recommended fix, chosen priority +
why, and whether it is safe to defer. If Prevention surfaced new test/feature ideas, list
them and ask which to file (capture-only). Do not paste the whole body back.

## Rules
- One issue per file. A cluster of related debt: file the umbrella, list members in the
  body, split only when someone starts work.
- Never renumber or reuse ids.
- Filed mid-task while working on something else: keep it capture-quality (steps 1–3 + a
  short Issue/Affected-code body), don't derail the main task with full elaboration.
- The item must stand alone without this conversation's transcript.
- Always run `npm run backlog:regen` after creating or editing an item, and commit the item
  file together with the regenerated `backlog/BACKLOG.md`/`backlog/DONE.md` — never one
  without the other.
