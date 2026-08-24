---
id: BL-0033
title: Assess platonic-ts against the superpowers skills framework, on real repos
type: idea
status: idea
priority: "?"
effort: "?"
risk: "?"
area: repo
sprint:
created: 2026-08-23
closed:
links: [BL-0005, BL-0010, BL-0021, docs/claude-code-integration-2026-08-22.md, docs/deliverable-ideas-2026-08-22.md, docs/tdd-for-agents-2026-08-22.md, packages/init/src/INDEX.md]
---

## Idea

Compare what this repository has built against `pcvelz/superpowers` (a Claude Code fork of the
Superpowers skills framework), then check the comparison against reality by running both on
repositories other than this one.

Interpretation of the ask, stated because the words are ambiguous. "The current system" means
the agent-facing layer of platonic-ts as a whole — the `npm run check` gate, the hooks in
`packages/hooks`, the MCP server, the `.claude/skills` set, the `backlog/` item format, and
`platonic init` — not any single package. "Test it on some existing code repos" means point
that layer at repositories it was not developed against, and record what it does there, since
every claim in this repo so far has been measured on this repo alone (the one exception being
the read-only Gratify probe in BL-0005).

What superpowers is, from its README: a markdown skills library plus optional Bash enforcement
hooks layered over Claude Code's native task tools. Skills cover process — `brainstorming`,
`writing-plans`, `executing-plans`, `subagent-driven-development`, `test-driven-development`,
`systematic-debugging`, `verification-before-completion`, `requesting-code-review`,
`using-git-worktrees`. Hooks block `git commit` while tasks are in progress, block a task
moving to `in_progress` while its `blockedBy` tasks are open, block task closure without
per-criterion evidence, and block completion claims at the `Stop` event. A JSON config routes
task tiers to models. It contains no compiled code and no knowledge of any particular language.

## Assumptions

- The two systems are not substitutes. platonic-ts enforces properties of *code* in one
  TypeScript repository; superpowers enforces properties of *process* in any repository. A
  useful comparison is therefore about overlap and gaps, not about picking a winner.
- The comparison is only worth doing if it can change what gets built next. It qualifies:
  superpowers has enforcement in places this repo has only convention (see Approaches, item 3).
- Running on foreign repos is now cheap enough to be evidence rather than a project.
  `packages/init` already plans and applies a retrofit at three strictness profiles without
  overwriting existing files, so an `observe`-profile run is close to read-only.
- Candidate targets exist. TypeScript repositories beside this one under `C:\Users\cdigg\git`:
  `vim-web`, `vim-webgl-viewer`, `ara3d-webgl`, `type-inference`, `adhd`, plus the Gratify
  submodule under `studio` already probed in BL-0005. Most of the author's other repositories
  are C#, which bounds what any TypeScript-specific gate can say.

## Design decisions

- What the deliverable is — an assessment document in `docs/` versus a set of adoption items in
  `backlog/`. A document risks being another survey that changes nothing (this repo already has
  `docs/tooling-catalog.md` and `docs/deliverable-ideas-2026-08-22.md` in that shape). A set of
  items risks adopting mechanisms before understanding them. Likely both: one short document
  holding the comparison table and the measurements, and separate items for anything worth
  adopting.
- Whether to actually install superpowers — read its skills and hooks and compare on paper,
  versus install the marketplace plugin and run a task under it. Installing gives real evidence
  about token cost and about interference with this repo's own hooks; it also puts a
  third-party plugin's `PreToolUse` hooks in front of the guards in `packages/hooks`, which are
  the reason broad `git add` is refused here. Decide the isolation before installing, not after.
- What "test on existing repos" measures — the gate (does `npm run init` produce a passing
  baseline in a foreign repo, and what does the ratchet read?) versus the navigation layer (do
  the MCP tools and the `scout` agent still beat text search off home turf?) versus the process
  skills. These are three different experiments; the third is where superpowers competes.
- Whether the code index survives foreign repos at all. Everything in `packages/codemap` and
  `packages/mcp` assumes a TypeScript program builds. Against a repo whose own `tsc` fails, the
  index is degraded and the comparison is unfair unless that is stated.

## Related

- `BL-0005` (in-progress) — the Gratify trial is the one prior instance of pointing this repo's
  tools at foreign code; its numbers (41 `any`, 67 casts, 322 errors under strict flags) are
  the template for what a per-repo probe should record. This item generalizes it.
- `BL-0010` (in-progress) — the init retrofitter is the mechanism the foreign-repo runs would
  use. This item consumes that work rather than duplicating it; if BL-0010 stalls, the testing
  here degrades to read-only scans.
- `BL-0021` (in-progress) — vendoring `parallel-wave` into the repo. Superpowers'
  `dispatching-parallel-agents` and `subagent-driven-development` are its direct counterparts
  and should be read before that adaptation is finalized.
- `docs/claude-code-integration-2026-08-22.md` — states this repo's placement rule: mechanical
  checks go in hooks, queries go in MCP, and "only the genuinely uncheckable residue goes in
  skills." Superpowers is almost entirely skills, so that document is the axis the comparison
  runs along and the standard by which any adoption is judged.
- `docs/tdd-for-agents-2026-08-22.md`, `docs/testing-gates-ratchets-goldens-2026-08-22.md` —
  this repo's thinking on TDD and evidence, currently prose with no enforcement, versus
  superpowers' `test-driven-development` and `verification-before-completion` skills plus the
  hooks that back them.
- `docs/worktrees-and-branches-for-agents-2026-08-22.md` — direct conflict: this repo forbids
  worktrees for wave tracks, superpowers ships `using-git-worktrees`. Any adoption must not
  quietly reverse that ruling.

## Approaches

Short term:

1. Paper comparison, one table, three columns: capability, how platonic-ts covers it, how
   superpowers covers it. Rows drawn from the surfaces in
   `docs/claude-code-integration-2026-08-22.md` — hook, MCP, skill, agent — so the output is a
   placement judgment rather than a feature count. Cheap, no installation, no risk.
2. `observe`-profile `npm run init` runs against two or three of the TypeScript repositories
   listed above, recording per repo: file count, escape-hatch counts, own-`tsc` result, result
   under this repo's strict flags, and whether the code index built. Extends the BL-0005 probe
   shape to a small population, and is the first evidence that the gate is about TypeScript
   rather than about this repository.
3. Read the superpowers hook scripts and name every case where this repo has the same intent
   without enforcement. Two are already visible: a backlog item's `## Done means` checkboxes
   are ticked by convention with nothing checking the evidence, and nothing prevents a commit
   while an item sits `in-progress`. Whether those should be enforced is a separate decision;
   listing them is this item's job.

Long term: if the comparison shows the process layer is where this repo is thinnest, the answer
is not to import a skills library. It is to find which of those process rules are mechanically
checkable against artifacts this repo already has — items in `backlog/`, the `check` gate
result, the transcripts `packages/transcripts` parses — and move them into `packages/hooks`,
leaving the residue as skills.

Adjacent ideas worth their own item:

- Enforce backlog `## Done means` evidence at commit time (a hook in `packages/hooks`).
- A per-repo probe report — the BL-0005 measurement shape as a repeatable command.
- Model-tier routing for subagents, the one superpowers feature with no counterpart here.

## Bedrock

The seam this strengthens is the placement rule in
`docs/claude-code-integration-2026-08-22.md` — hooks for the checkable, MCP for the queryable,
skills for the residue. That rule has never been tested against a serious alternative that made
the opposite bet, and an untested rule is an opinion. Running the comparison either confirms it
with a named list of what superpowers puts in a skill that this repo puts in a hook, or
produces the first honest case for widening the skills layer.

The second thing it strengthens is the boundary between "works" and "works here." Every
measurement in this repository was taken inside this repository. Pointing `packages/init` and
the code index at foreign repositories is the cheapest available test of whether
`packages/check` and `packages/codemap` are general tools or one repo's furniture — and that
answer changes how BL-0010 should be finished.

Verdict: **simplest-along-the-grain**. The simple version is a comparison document plus a few
`observe` runs. It must NOT: install the superpowers plugin into this repository's
`.claude/settings.json` alongside the guards in `packages/hooks` (isolate first, or the staging
guard's behavior becomes unattributable); copy any superpowers skill file into
`.claude/skills/`; or write a single line into a foreign repository without `--yes` and a clean
tree there.

## Done means

- [ ] A dated document in `docs/` holds the capability comparison table and states, per row,
      which system enforces mechanically and which advises.
- [ ] At least three repositories other than this one have recorded probe results —
      escape-hatch counts, own-`tsc` result, result under strict flags, and whether the code
      index built.
- [ ] Every gap where this repo has an intent with no enforcement is listed, each either filed
      as its own backlog item or explicitly declined with a reason.
- [ ] No file in any foreign repository was modified, or the modifications were made with
      `--yes` on a clean tree and are named in the document.

## Simplest possible implementation

Read the superpowers skills and hook scripts. Write one document with a comparison table. Run
`npm run init -- <path> --profile observe --dry-run` against `vim-web`, `ara3d-webgl`, and
`type-inference`, paste the three plans into the same document, and file backlog items for
anything the comparison surfaced. No installation, no new package, no change to this
repository's configuration.

What you get:

- The placement rule tested against a real alternative, at the cost of an afternoon.
- The first evidence about whether `packages/check` generalizes, which BL-0010 needs anyway.
- Adoption candidates arrive as backlog items with reasons, not as a vendored skills directory.

What you give up or risk:

- A paper comparison cannot measure token cost or how superpowers' hooks behave in practice;
  claims about its cost stay estimates.
- `--dry-run` reports what a retrofit would do, not whether the retrofitted repo passes. The
  interesting number — where the ratchet baseline settles after a real install — needs a write,
  so the cheap version stops one step short of the question that matters most to BL-0010.
- Another survey document in `docs/` that changes nothing is the standing failure mode here;
  the item is only complete when the gaps are filed or declined.
