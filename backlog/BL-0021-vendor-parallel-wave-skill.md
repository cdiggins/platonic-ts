---
id: BL-0021
title: Vendor parallel-wave skill into repo, adapt, drop worktree framing
type: idea
status: in-progress
priority: "?"
effort: s
risk: low
area: repo
sprint:
created: 2026-08-23
closed:
links: [.claude/skills/parallel-wave/SKILL.md, docs/tools-and-process.md, docs/worktrees-and-branches-for-agents-2026-08-22.md, AGENTS.md, .claude/skills/track-idea/SKILL.md]
---

## Idea

Move the parallel-wave skill from the user-global location
(`C:\Users\cdigg\.claude\skills\parallel-wave\SKILL.md`, single file) into this repo as
`.claude/skills/parallel-wave/SKILL.md`, then adapt it to platonic-ts. Two adaptations:
(1) repo-specific process — the wave's gate is `npm run check`, integration commits go
straight to `main` with pull-rebase discipline (AGENTS.md), findings feed `backlog/` via the
track-* skills; (2) remove the worktree framing/usage. Note the global skill already runs
all tracks on ONE shared checkout — "shared git worktree" is its wording for the main tree,
not per-agent isolated worktrees — but the wording contradicts this repo's stated stance
("no branches, no worktrees", AGENTS.md:31) and invites agents to reach for `isolation:
worktree`. The repo copy should say "shared checkout" and explicitly forbid worktree
isolation for wave tracks, per the decision rule in
docs/worktrees-and-branches-for-agents-2026-08-22.md (shared tree by default; worktrees only
for spikes and long-running background agents — never wave tracks).

## Assumptions

- Waves will keep being run in this repo (they have: BL-0012/13/14 landed via waves per git
  history), so a repo-local, repo-accurate process doc pays off each wave.
- Repo-local `.claude/skills/` shadows or coexists with the user-global skill of the same
  name so the repo copy actually wins here (verify during implementation; if both load, the
  global one may need renaming or deleting).
- The global skill stays useful for other repos, or the user is fine deleting it once
  vendored (decide at implementation).

## Design decisions

- **Shadow vs delete the global copy** — A: keep global for other repos, accept two copies
  drifting vs B: delete global after vendoring, other repos lose it. Depends on whether
  other repos use waves; ask user at implementation.
- **How hard to forbid worktrees** — soft wording ("use the shared checkout") vs hard rule
  ("tracks MUST NOT use isolation: worktree; supervisor MUST NOT spawn worktree agents in a
  wave"). Repo stance suggests hard rule with the documented exceptions (spike, background
  migrator) named as the only escape.
- **Generic recipe vs platonic-ts-specific** — fold in repo specifics (npm run check as the
  single gate, backlog/notes file conventions, dashboard ports) vs keep generic with a repo
  addendum section. Specific is simpler for a single-repo copy.

## Related

- [docs/tools-and-process.md] — §"Fenced parallel waves" already documents the process
  repo-side ("no branches, no worktrees"); the vendored skill and this doc must not drift —
  one should reference the other rather than duplicate.
- [docs/worktrees-and-branches-for-agents-2026-08-22.md] — the ADR-grade analysis behind the
  no-worktrees default and its three exceptions; the vendored skill's worktree rule should
  cite it.
- [AGENTS.md:31] — "No branches, no worktrees" + pull-rebase rule the skill must restate in
  track prompts.
- [BL-0020] — start-work idea names parallel-wave as its parallel handoff target; a
  repo-local copy can reference /track-issue and /start-work directly by path.

## Approaches

Short term: copy SKILL.md into `.claude/skills/parallel-wave/`, rewrite title/intro from
"shared worktree" to "shared checkout", add a hard no-worktree rule citing the worktrees
doc, swap generic gate language for `npm run check`, and point the findings step at the
track-* skills. Verify the repo copy is the one that loads; then delete or leave the global.
Long term: tools-and-process.md §waves shrinks to a pointer at the skill (single source);
wave findings/fence tables get a standard home (e.g. `docs/waves/`) the dashboard could read.
Adjacent ideas worth their own item:
- Skill-shadowing audit: which user-global skills does this repo unintentionally depend on
  (cavecrew, feature-dev reference parallel-wave too)?

## Bedrock

The seam is process-as-code locality: every process this repo depends on lives in the repo
(track-* skills already do, per the WorkQuarry ADR's consequence that "process docs live in
this repo, not upstream"). parallel-wave is currently the exception — a repo-critical
process defined in a user-global file that version control never sees and other
agents/machines never get. Vendoring it closes that hole and makes the worktree stance
enforceable in one reviewable file. **Verdict: simplest** — one file moved and edited, no
code.

## Done means

- [x] `.claude/skills/parallel-wave/SKILL.md` exists in-repo, adapted (shared checkout
      wording, hard no-worktree rule citing docs/worktrees-and-branches doc, npm run check
      as the gate, track-* skills as the findings sink)
- [ ] Repo copy is the one a session loads (shadowing verified; global copy deleted or
      renamed if it conflicts)
- [x] docs/tools-and-process.md §waves and the skill reference each other without
      contradiction
- [ ] Next wave run uses the repo copy without manual steering

## Simplest possible implementation

Copy the global SKILL.md into `.claude/skills/parallel-wave/SKILL.md`; edit wording
(worktree→checkout), add the no-worktree rule + repo gate + repo findings sink; commit.
Leave the global copy in place until shadowing is confirmed.
Pros:
- One commit, no code; wave process becomes versioned and reviewable in-repo.
- Kills the worktree-wording contradiction with AGENTS.md.
Cons:
- Two copies exist until the global one is retired — drift risk if both keep loading.
- Repo-specific rewrite makes the skill non-portable to other repos (global copy or a
  generic upstream would need separate maintenance).
