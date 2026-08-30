---
id: BL-0037
title: init installs the agent toolkit into a target repo
type: feature
status: idea
priority: p2
effort: M
risk: low
area: init
sprint:
created: 2026-08-30
closed:
links: [BL-0005, BL-0010, BL-0021]
---

## Idea
`platonic init` currently retrofits the gates (tsconfig strictness, lint config, ratchet
baseline, check script). Extend it to also install the agent toolkit: copy the portable
skills and agent definitions into the target repo's `.claude/`, and register the MCP server
in the target's `.mcp.json` pointed at the platonic-ts checkout with the target as root.
This makes one command the whole distribution story for using platonic-ts tooling in
another repository — the alternative mechanisms (user-level `~/.claude`, symlinks, a plugin
marketplace repo) are all either machine-local, unversioned, or premature before a second
consumer proves which skills are actually general. Deferred decision recorded here: promote
the proven-general set to a Claude Code plugin only after the Gratify trial (BL-0005) shows
which skills survive the port unmodified.

## Assumptions
- The never-clobber plan/apply machinery in `packages/init` (`splitMerge`, `applyPlan`,
  drift-report-on-rerun) extends naturally from JSON configs to copied markdown files and an
  `.mcp.json` merge.
- Skills separate cleanly into a general protocol plus a repo-specific binding section
  (command names, paths, ports). Today they do not: `track-idea`/`track-issue` invoke
  `npm run backlog:next-id`, `start-work` names this repo's gate steps. Part of this work is
  marking that seam inside each skill.
- The MCP server can index a non-`packages/*` layout. It cannot today —
  `packages/check/src/scan.ts` hardcodes `packages/*/{src,test}` and both codemap and mcp
  import it — so the layout-agnostic scanner is a prerequisite, not part of this item.

## Design decisions
- Copy vs reference — copy skills into the target (drift, but self-contained) vs point the
  target at the platonic-ts checkout (always fresh, but machine-local). Copy-with-drift-report
  matches init's existing ratchet posture and is the recommendation.
- What is in the toolkit — all six vendored skills plus three agents, or a curated portable
  subset. `scout`/`doc-writer` depend on the MCP tools; `architect` assumes
  `docs/decisions/`; the track-* skills assume the WorkQuarry backlog. Installing the backlog
  skills implies installing the backlog convention — decide whether that is opt-in.
- Where repo bindings live — a marked section inside each skill file vs a single
  `.claude/platonic-bindings.md` the skills reference. One file is easier to regenerate.
- `.mcp.json` server command — absolute path to this checkout (works now, machine-local) vs
  an npm-published bin (portable, requires BL-0010's long-term packaging). Start absolute.

## Related
- [BL-0010](BL-0010-init-retrofitter.md) — parent. Its Design decisions section already names
  this exact question ("whether init also drops CLAUDE.md/skills… a thin adapter, not baked
  into the retrofitter"); this item is that adapter, kept separate as designed.
- [BL-0005](BL-0005-gratify-trial.md) — first consumer. Phase 3 of the trial plan uses this
  item's output; the trial's port results decide the later plugin extraction.
- [BL-0021](BL-0021-vendor-parallel-wave-skill.md) — vendored parallel-wave into this repo;
  this item redistributes vendored skills outward, so the two must not fight (the copy in the
  target must carry a provenance line naming its source and version).
- [docs/repo-review-2026-08-29.md](../docs/repo-review-2026-08-29.md) — records the layout
  prerequisite and the gratify plan this item folds into.

## Approaches
Short term: a new init profile or flag (`--agents`) whose plan copies `.claude/skills/*` and
`.claude/agents/*` (with provenance headers), merges an `.mcp.json` entry, and prints manual
steps for anything conflicting — reusing the existing three action kinds (writeFile,
mergeJson, skip) unchanged.
Long term: promote the proven-general skills to a Claude Code plugin marketplace repo; the
init profile shrinks to repo-specific wiring only.
Adjacent ideas worth their own item: the layout-agnostic source scanner (prerequisite,
currently only named inside the review doc and NOTES.md).

## Bedrock
The seam this strengthens is the same one BL-0010 names — the boundary between the method
and this codebase — extended from configs to the agent layer: each skill is forced to
declare which of its content is protocol and which is binding, because the installer has to
know what to copy verbatim and what to rewrite per target. That declaration is exactly what
the later plugin packaging needs, so doing it here makes the plugin extraction a cut along
an existing seam. Verdict: **simplest-along-the-grain** — the simple version copies files
and merges JSON, but it must not bake target-specific edits into the skill bodies by hand;
bindings go in the marked seam or the boundary is lost for repo number three.

## Done means
- [ ] `npm run init -- <target> --agents` plans and (with --yes) installs the chosen skills,
      agents, and `.mcp.json` entry into a target repo without overwriting existing files
- [ ] Each installed skill carries a provenance line; re-running init reports drift between
      the target's copies and this repo's originals instead of silently rewriting
- [ ] The MCP server registered by the install starts and indexes the target repo's sources
      (depends on the layout-agnostic scanner landing first)
- [ ] Exercised for real against the Gratify checkout as part of BL-0005 Phase 3

## Simplest possible implementation
Extend `packages/init` with an `agents` profile: plan entries that copy each file under
`.claude/skills/` and `.claude/agents/` (skip when the target already has one), plus a
`mergeJson` on `.mcp.json` adding the `platonic` server with an absolute command path to
this checkout. No binding rewrite in v1 — skills are copied as-is and any repo-specific
command they invoke simply fails visibly in the target, which is itself the survey of which
bindings exist.

- Gets: one-command distribution for the Gratify trial this week; reuses tested plan/apply
  machinery; drift reporting for free.
- Gives up: copied skills reference platonic-ts commands that do not exist in the target
  until bindings are separated; machine-local MCP path; no versioning beyond the provenance
  line.
