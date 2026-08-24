---
id: BL-0034
title: Add a command that asks whether the architecture can be improved
type: idea
status: idea
priority: "?"
effort: "?"
risk: "?"
area: repo
sprint:
created: 2026-08-24
closed:
links: [BL-0011, BL-0017, BL-0033, docs/post-coding-questions-2026-08-23.md, docs/technical-debt-in-agentic-projects-2026-08-23.md, docs/tooling-catalog.md, .claude/agents/architect.md, packages/check/src/boundary.ts, packages/codemap/src/metrics.ts]
---

## Idea
A slash command — call it `/architecture-review` — that answers "are there opportunities to
improve the architecture right now?" without being handed a task or a diff first. The
`architect` agent (`.claude/agents/architect.md`) already has two modes, and both are reactive:
mode 1 rules on where a proposed change belongs, mode 2 judges changes that already landed.
Neither can be invoked when nothing is pending, so no agent in this repository ever asks whether
the design as it stands has drifted, put a seam in the wrong place, or grown a package past its
stated purpose.

Interpretation of the ask, stated because "improve the architecture" is broad: this is a
**standing survey of the repository as it is**, scoped to structural questions — package
boundaries, module dependencies, duplicated concepts, dead export surface, scope statements in
`AGENTS.md` that no longer match the code. It is not a line-level code review, not a quality
score (BL-0011/BL-0017 cover that), and not a general "make it better" prompt.

## Assumptions
- The reactive-only gap is real: `architect` is spawned by `/start-work` and after waves, never
  on its own. Nothing in `.claude/skills/` asks a design question absent pending work.
- The repository already produces most of the evidence such a survey needs, so this is
  orchestration rather than new analysis. Available today: `module_graph` and `blast_radius`
  (MCP), `unused_exports` (MCP), `symbol_metrics`/`platonicScore`
  (`packages/codemap/src/metrics.ts`), `npm run clones` for expressions repeated under different
  names, `npm run stats` for size distributions by zone, and `findBoundaryViolations`
  (`packages/check/src/boundary.ts`) for declared forbidden edges.
- A survey that emits prose is worthless. The rule from
  [post-coding-questions-2026-08-23.md](../docs/post-coding-questions-2026-08-23.md) applies
  verbatim: a finding that will not change the current diff must leave the session as a
  `backlog/` item or leave the session entirely.
- The user wants this run occasionally and deliberately, not on every commit. It costs real
  tokens and its findings are structural, which means they change slowly.

## Design decisions
- **New skill vs. third architect mode.** A `.claude/skills/architecture-review/SKILL.md` that
  spawns the existing `architect` with a survey prompt, versus adding "mode 3 — no task, no
  diff" to the agent definition itself. The skill makes the command discoverable and typed as
  `/architecture-review`; the agent mode makes the survey available to any caller, including
  `/start-work`. Doing both is likely correct: mode 3 in the agent, a thin skill that invokes it.
- **Whole repo vs. scoped.** A whole-repo survey returns a wall of findings on the first run and
  almost nothing on the second. Scoping to one package or one seam per invocation
  (`/architecture-review packages/codemap`) keeps each run cheap and actionable. An optional
  argument defaulting to whole-repo is the compromise, at the cost of an expensive default.
- **Where findings terminate.** Decision records under `docs/decisions/` (the architect's only
  current write) versus backlog items via `/track-issue` and `/track-idea`. An *opportunity* is
  work, not a ruling, so it belongs in `backlog/`. A record is warranted only when the survey
  concludes something should NOT change — a refusal that future sessions would otherwise
  re-litigate.
- **How repetition is suppressed on later runs.** Without state, every run re-finds the same
  opportunities and the user re-reads them. Options: grep `backlog/` for already-filed findings
  before reporting (cheap, no new state, misses rephrasings), or write a dated survey document
  under `docs/` (precise, but one more file to keep fresh).
- **Whether any of it becomes a gate.** Every decision record's `Enforcement` section asks this.
  Some survey signals are mechanically checkable and could move into `npm run check` (import
  cycles, dead exports); most — "this package has quietly become two things" — cannot.

## Related
- [BL-0011](BL-0011-conformance-score.md) — overlaps on measurement, not on judgement: it scores
  files against the platonic ideals, this asks structural questions a per-file score cannot pose.
- [BL-0017](BL-0017-zone-aware-platonic-score.md) — the survey would consume `platonicScore`, so
  a score that penalises code for obeying the style guide feeds it false findings. Sequence
  BL-0017 first if the survey leans on the score.
- [BL-0033](BL-0033-assess-vs-superpowers.md) — superpowers has no equivalent standing design
  review, so this is a point of comparison for that assessment.
- `.claude/agents/architect.md` — the agent this command drives; its mode-2 checklist (placement,
  boundaries, concept duplication, convention drift) is already most of the survey's question set.
- [docs/tooling-catalog.md](../docs/tooling-catalog.md) §4 — `dependency-cruiser` and `madge`
  cover cycle and forbidden-edge detection off the shelf, if the survey's mechanical half is
  worth outsourcing.

## Approaches
Short term:
1. Add mode 3 to `.claude/agents/architect.md` — a fixed question set aimed at the repository
   rather than a diff, run with the tools the agent already has, reporting opportunities and
   nothing else. One file edited, no new code.
2. Add `.claude/skills/architecture-review/SKILL.md` that spawns the architect in mode 3, then
   files each accepted finding through `/track-issue` or `/track-idea` so the run terminates in
   tracked work rather than a chat message.
3. Give the survey a mechanical pre-pass: run `npm run clones`, `npm run stats`,
   `unused_exports`, and `module_graph` first and hand the results to the agent as evidence, so
   its judgement starts from numbers instead of from reading.

Long term: a periodic architecture report the dashboard renders, each run diffed against the
last so the user sees drift rather than a re-listing. That needs the survey's output to be
structured data, not prose — a reason to keep the finding shape machine-readable from the start.

Adjacent ideas worth their own item:
- Move the mechanically checkable half (import cycles, dead exports) into `npm run check`.
- A `/decision-review` that checks whether `active` records in `docs/decisions/` still hold —
  each has a `Revisit when` clause that nothing currently evaluates.

## Bedrock
The seam this strengthens is the one between `docs/decisions/` (rulings that bind future work)
and `backlog/` (work that is tracked). Today that seam only opens when a change is in flight:
the architect rules, the ruling constrains an implementer, and the loop closes. Nothing opens it
from the other end — no path exists from "the design has drifted" to a tracked item, because
nothing is looking. Mode 3 in `.claude/agents/architect.md` makes the survey a first-class entry
to the same seam, which makes every later design question cheaper: the evidence sources are
named once, the finding shape is fixed once, and the routing into `backlog/` is decided once.

The invariant worth protecting is the one `AGENTS.md`'s map table asserts — each package's scope
statement is a ruling, and a ruling that nothing verifies decays into a comment. A survey that
checks actual imports and actual exports against those statements turns the map table from
documentation into something falsifiable.

Verdict: **simplest-along-the-grain**.

The simple version — mode 3 in the agent definition plus a thin skill that invokes it — must NOT:
- invent a new analysis package or a new report format; it composes `module_graph`,
  `unused_exports`, `symbol_metrics`, `npm run clones`, `npm run stats`, and
  `findBoundaryViolations`, all of which already exist;
- write findings as prose into `docs/`; findings go to `backlog/` so the existing triage path
  handles them;
- become part of `npm run check`. The gate reports and never judges; a survey is judgement, and
  putting it in the gate makes every commit pay for it.

## Done means
- [ ] `/architecture-review` runs with no arguments and returns a ranked list of opportunities,
      each naming a specific file, package, or seam and the evidence for it.
- [ ] Every finding it reports is either filed as a `backlog/` item or explicitly dropped by the
      user in that session; none is left as prose only.
- [ ] Running it twice in a row on an unchanged tree does not re-report findings already filed.
- [ ] It reports at least one finding this repository's authors agree is real, on first run.

## Simplest possible implementation
Add a "Mode 3 — no task, no diff (a standing survey)" section to `.claude/agents/architect.md`
with a fixed question set — the mode-2 checklist re-aimed at the repository rather than a diff —
plus an instruction to grep `backlog/` before reporting so filed findings are suppressed. Add a
short `.claude/skills/architecture-review/SKILL.md` that spawns it. No TypeScript, no new
package, two files.

What you get:
- Working the day it lands; nothing to maintain beyond prose.
- Uses the agent's existing tool grant, so no wiring or permission change.
- Cheap to reverse — delete two files.

What you give up or risk:
- The whole-repo default is expensive, and the first run will over-report.
- Findings are unstructured, so the dashboard cannot render them and successive runs cannot be
  diffed mechanically — the "don't re-report" check is a grep, which will miss rephrasings.
- No mechanical pre-pass, so the agent's judgement starts from reading rather than from numbers,
  which is where mode-2 reviews are weakest.
