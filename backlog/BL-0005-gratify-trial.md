---
id: BL-0005
title: Trial run on Gratify library
type: debt
status: in-progress
priority: p3
effort: L
risk: med
area: repo
sprint:
created: 2026-08-22
closed:
links: [BL-0037, BL-0031, BL-0033, docs/repo-review-2026-08-29.md]
---
Apply the platonic-ts method to Gratify — now at `C:\Users\cdigg\git\gratify` (moved out of
the studio submodule) — and measure whether it earns its cost off home turf. This is the
outward experiment `docs/repo-review-2026-08-29.md` names as the most valuable next step:
everything measured so far is self-referential.

First probe (2026-08-22, read-only): 31 TS files (src+tests). Escape hatches:
any 41, as-casts 67, non-null 26, ts-directives 4, eslint-disable 0.
Own tsc: clean. Under platonic strict flags (+noUncheckedIndexedAccess,
exactOptionalPropertyTypes, noImplicitReturns): 322 error lines.

Second survey (2026-08-30): 56 TS files, ~8.8k lines, strict already on, 85 tests in two
files, its own boundary-check script (`scripts/check-boundary.mjs` — keep it, it encodes
domain rules), no ESLint, three.js dependency. Classes and mutation are intentional
(canvas/animation framework), so the full functional profile would fight the domain.

## Plan

### Phase 0 — prerequisites in platonic-ts
- Layout-agnostic source scanning: `packages/check/src/scan.ts` hardcodes
  `packages/*/{src,test}`; codemap and mcp both import it, so the MCP server would index
  zero Gratify files today. Generalize to configurable roots (Gratify needs `src/`,
  `tests/`, `examples/`); `packages/init/src/io.ts` already has a layout-agnostic walk.
- Fix BL-0031 (comment scanner) before taking any baseline, so the numbers are trustworthy.
- Replace the hardcoded project slug in `packages/dashboard/src/main.ts` with the
  `projectSlug` derivation from `packages/transcripts/src/main.ts`, so the dashboard and
  `npm run transcripts` can observe Gratify sessions.

### Phase 1 — baseline before changing anything
- `npm run init` against Gratify with the observe profile: ratchet baseline only.
- Run `stats` and `clones` against Gratify (its `core/` math files are the likely clone
  candidates).
- Split the 322 strict-flag errors per flag (suspicion: three.js types make
  exactOptionalPropertyTypes the expensive one).
- Control measurement: 4-6 representative tasks (bug fix, small feature, cross-file
  refactor, two comprehension questions) run by an agent with no platonic tooling; record
  tokens, wall-clock, and correctness via `npm run transcripts`. Prefer tasks with
  objectively checkable outcomes.

### Phase 2 — gates, ratchet-style
- Strictness as a sidecar `tsconfig.platonic.json`, advisory; promote each flag into the
  real tsconfig only when its error count reaches zero. Baseline-and-tighten, never
  fix-everything-first.
- Lint zoned to the domain: functional subset for `src/gratify/core/**` (pure math);
  type-checked baseline only for `runtime`/`painter`/`scene`/`particles` (mutation is the
  job); test zone for `tests/` and `examples/`. If the zones cannot be drawn cleanly, that
  is a finding about the zone model.
- One `check` script chaining Gratify's existing boundary checker + typecheck + lint +
  ratchet + tests. Commit `ratchet.json` and let it fall.

### Phase 3 — agent tooling
- Install the agent toolkit via BL-0037 (`init --agents`): skills, `scout`/`doc-writer`
  agent definitions, and the `.mcp.json` entry for the MCP server rooted at Gratify.
- Verify the index handles a codebase with classes — platonic-ts has none, so this
  exercises paths covered only by synthetic tests.
- Run the scout-benchmark methodology with five Gratify-specific questions.
- The port doubles as the general-vs-binding survey: whatever needs editing to work in
  Gratify is repo-specific binding; whatever survives unmodified is the portable core, and
  becomes the candidate set for later plugin packaging (decision deferred in BL-0037).

### Phase 4 — the experiment proper
- Re-run the Phase 1 tasks with the tools in place, fresh sessions, same models. Compare
  tokens, wall-clock, first-attempt correctness, escape hatches introduced.
- Count the retrofit's own token cost as part of the result.
- Write results as a dated doc here; every friction point becomes a backlog item; decide
  per-piece what Gratify keeps and what gets removed.

Risks: n is tiny (treat results as directional); three.js typings may make some flags
permanently unreachable (sidecar makes that a report, not a blocker); the functional subset
may be genuinely wrong for a canvas framework — if so, the honest conclusion is that the
portable value is gates + ratchet + MCP tools, not the style.

## Done means
- [ ] platonic check adopted in Gratify with a baseline ratchet.json
- [ ] escape-hatch counts trending down across at least one retrofit wave
- [ ] MCP server indexes Gratify and the Phase 1/Phase 4 task comparison is recorded with
      token, wall-clock, and correctness numbers
- [ ] findings recorded back in this item or a follow-up ADR, including which skills/agents
      survived the port unmodified
