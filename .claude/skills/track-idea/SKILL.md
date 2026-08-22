---
name: track-idea
description: Log a new idea into backlog/ with elaboration — assumptions, design decisions, related work links, approach brainstorm, and simplest implementation. Use when the user says /track-idea, "log this idea", "track this idea", "add to backlog", or fires off a "we should someday…" thought worth keeping.
argument-hint: <the idea, in a phrase or paragraph>
---

# track-idea — capture and elaborate an idea

Turn a raw idea into a well-formed backlog item. Item files are plain markdown with YAML
frontmatter under `backlog/`; you create and edit them directly (there is no separate CLI
for `new`/`set` the way WorkQuarry's `track.py` has — Claude Code can already read and write
files). After creating or changing any item, regenerate the generated views:
`npm run backlog:regen` (rebuilds `backlog/BACKLOG.md` and `backlog/DONE.md` from
`packages/backlog/src/index.ts`'s `buildBacklogTable`/`buildDoneLog`).

Process reference: `decisions/2026-08-22-adopt-workquarry-format.md` (the ADR that adopted
this schema). Schema types: `packages/core/src/index.ts` (`BacklogItem`, `BacklogStatus`,
`BacklogType`, `BacklogPriority`, `BacklogEffort`, `BacklogRisk`).

## Steps

### 1. Understand the idea
From the argument or recent conversation. If genuinely ambiguous (two different products fit
the words), ask one clarifying question; otherwise proceed and state your interpretation in
the item body.

### 2. Find related work (before writing anything)
Search for prior art and overlaps — link, don't duplicate:
- `Grep` over `backlog/*.md` and `backlog/BACKLOG.md`/`backlog/DONE.md` for keywords and
  synonyms. If an existing item already covers the idea, say so and offer to enrich that
  item instead of creating a new one.
- `Grep` over `NOTES.md`, `docs/`, and any other discussion folders for related plans,
  assessments, idea banks.
- Check `decisions/` for ADRs that constrain the direction.
- Relevant `packages/*/src` folders if the idea touches known code.
Collect repo-relative paths and item ids for the `links:` field.

### 3. Create the item file
Allocate the next id: highest existing `backlog/BL-XXXX-*.md` number + 1, zero-padded to 4
digits (e.g. current highest is `BL-0009` → next is `BL-0010`). Write
`backlog/BL-00NN-<slug>.md`:

```yaml
---
id: BL-00NN
title: <short imperative title>
type: idea            # idea | feature | problem | debt (idea for anything not yet scoped)
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
Leave priority/effort/risk as `?` unless the user stated them or the idea is obviously
scoped (then pass your estimate). Then run `npm run backlog:regen`.

### 4. Elaborate — append body to the item file
Write these sections after the frontmatter. Terse, substantive, no padding. Skip a section
only when it would be empty.

```markdown
## Idea
One-paragraph restatement, including your interpretation of anything ambiguous.

## Assumptions
Bullet list: what must be true for this to be worth doing (user need, technical
precondition, dependency on other work).

## Design decisions
Decision points that change the direction — each as "Question — option A vs B, what each
implies". These become ADRs (`decisions/`) if the idea graduates.

## Related
- [id or path] — one line on the relationship (overlaps / depends on / supersedes / informed by).

## Approaches
Short term: 1–3 ways to get value soon.
Long term: where this could go if it works.
Adjacent ideas worth their own item: bullet list (see step 6).

## Bedrock
The version of this change that leaves the architecture stronger: name the specific seam,
invariant, boundary, or file it strengthens, and what future changes it makes cheaper or
safer. Then a one-line verdict: **simplest / right / simplest-along-the-grain**. When the
verdict is simplest-along-the-grain, state exactly what the simple version must NOT do so
the stronger design stays reachable.

## Done means
2–5 verifiable statements of what "done" looks like, written as checkboxes. Optional at
capture; required before idea→ready promotion for feature/debt/bug.
- [ ] X passes
- [ ] Y no longer reproduces
- [ ] Z benchmark ≤ N ms

Whoever lands the work ticks these in the commit that satisfies them; when all are ticked,
set `status: done` + `closed: <date>` and regenerate views in the following commit.
Progress is read from these boxes — never stored as a percentage.

## Simplest possible implementation
The smallest thing that could possibly work. Then pros/cons in two bullet lists: what you
get, what you give up or risk.
```

The **Bedrock** section may be a single line — "No architectural leverage here — simplest
wins." — when that is true. What is NOT allowed: generic design-principle recitation that
names no concrete file, seam, or invariant.

Ground every claim in what you actually found in step 2 — no invented file names or
capabilities. Where the repo already has a building block, name the file.

### 5. Report to the user
Give: the new id (linked), one-line summary of the strongest short-term approach, the key
design decision they'll need to make, and any overlap warnings. Do not paste the whole item
body back.

### 6. Offer spin-offs
If elaboration surfaced adjacent ideas worth tracking separately, list them and ask which to
file. File approved ones the same way (capture only — no full elaboration unless asked).

## Rules
- One idea per item file. Compound requests: split, confirm the split with the user.
- Never renumber or reuse ids.
- If the user gives a bare phrase mid-conversation, capture context from the conversation
  into the Idea section — the item must stand alone without this transcript.
- Always run `npm run backlog:regen` after creating or editing an item, and commit the item
  file together with the regenerated `backlog/BACKLOG.md`/`backlog/DONE.md` — never one
  without the other.
