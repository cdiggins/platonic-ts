---
id: BL-0015
title: Diagram which hooks fire across different agent workflow shapes
type: idea
status: done
priority: "?"
effort: "?"
risk: "?"
area: repo
sprint:
created: 2026-08-22
closed: 2026-08-22
links: [BL-0004]
---

## Idea
Produce a diagram mapping which Claude Code hook events fire, in what order, for a manual
interactive agent session — then repeat for other workflow shapes this environment actually
supports, since they don't all fire the same hooks the same number of times. Interpreting
"what hooks are started by default" as: this project has no hooks configured yet (checked
`.claude/settings.json` — does not exist; `.claude/settings.local.json` only has a Bash
permission entry, no `hooks` key), so the graph documents the *available* hook lifecycle
Claude Code exposes, not repo-specific wiring. `docs/claude-code-integration-2026-08-22.md`
already scopes hooks as one of four extension surfaces but is marked "design notes, nothing
implemented yet" and doesn't enumerate the event graph itself — this idea fills that gap.

## Assumptions
- [BL-0004](backlog/BL-0004-hooks-events.md) (status ready) plans to wire `PostToolUse` +
  `SessionStart` specifically for dashboard event emission — that choice implicitly assumes
  a single workflow shape. Mapping all shapes first avoids wiring hooks that miss most of
  what actually runs (e.g. sub-agent activity, scheduled runs).
- Workflow shapes actually available in this environment (grounded in this session's own
  tool surface, not invented): a manual interactive top-level session; a subagent spawned
  via the Agent tool (foreground or background); a `Workflow`-orchestrated run (deterministic
  script fanning out many `agent()`/`parallel()`/`pipeline()` calls, each an independent
  subagent); a `/loop` self-paced recurring session (`ScheduleWakeup`); a cron-scheduled
  autonomous session (`CronCreate`); a remote/cloud session (`ListAgents`/`SendMessage`
  cross-session). These likely differ in whether/how often `SessionStart`, `Stop`,
  `SubagentStop`, and `PreCompact` fire — e.g. a `Workflow` script's internal `agent()` calls
  are plausibly closer to `SubagentStop` territory than a fresh top-level `SessionStart`.
- Exact hook-firing semantics per workflow shape are not something this repo has observed or
  logged yet (no hooks configured to observe with) — the graph's first version will be based
  on documented Claude Code hook behavior, then should be verified empirically once BL-0004
  gives the repo an actual event log to check assumptions against.

## Design decisions
- Deliverable format — Mermaid diagram(s) in a `docs/` file (matches existing
  `docs/*-2026-08-22.md` convention, shows up in dashboard's Docs section for free via
  [core/src/index.ts:96](packages/core/src/index.ts:96) `DocInfo` indexing, already built by
  BL-0006) vs a section added to the existing
  `docs/claude-code-integration-2026-08-22.md` companion doc vs a dashboard visualization.
  A docs file is more actionable now since BL-0004's event stream doesn't exist yet to
  visualize live.
- One diagram vs one per workflow shape — a single diagram with shape-specific branches
  gets dense fast (6 shapes × ~8 hook events); likely clearer as one small diagram per shape
  plus a short comparison table (which hooks fire / how many times / triggered by what).
- Scope — document only the hook lifecycle (this idea) vs also propose which hooks BL-0004
  should actually wire per shape (couples this idea's output directly into BL-0004's design).
  Keeping this idea to "map what exists" and letting BL-0004 consume it keeps the two
  separable.

## Related
- [BL-0004](backlog/BL-0004-hooks-events.md) — this idea is design groundwork BL-0004 should
  probably consume before wiring `PostToolUse`/`SessionStart` specifically; risk otherwise is
  BL-0004 ships instrumentation that only covers the manual-session shape.
- [docs/claude-code-integration-2026-08-22.md](docs/claude-code-integration-2026-08-22.md) —
  companion doc, already scopes hooks as an extension surface at a principles level; this
  idea is the concrete event-graph layer underneath it.

## Approaches
Short term:
- Write one `docs/` file with a Mermaid sequence or flowchart diagram per workflow shape
  (manual session, subagent, Workflow-orchestrated, /loop, cron, remote), grounded in
  documented Claude Code hook event names, plus a comparison table.
- Cross-link from `docs/claude-code-integration-2026-08-22.md` as a companion doc, matching
  its existing "Companion to:" header convention.

Long term:
- Once BL-0004 lands and the dashboard has a real hook-event stream, verify the diagram
  against observed data and correct any assumptions; feed corrections back into BL-0004's
  own hook selection.
- If BL-0012 (tool/skill invocation history) also lands, the per-workflow-shape event counts
  become directly checkable against real sessions instead of documented behavior alone.

Adjacent ideas worth their own item:
- None surfaced beyond what BL-0004/BL-0012 already cover.

## Bedrock
De-risks [BL-0004](backlog/BL-0004-hooks-events.md)'s design before code gets written: without
this mapping, BL-0004 is one implicit guess (manual-session shape) away from silently missing
most of what this environment actually runs (Workflow fan-outs, scheduled sessions, remote
agents). A written comparison table is cheap insurance against building the wrong
instrumentation surface once and having to redo it.
Verdict: **simplest wins** — pure documentation, no code or contract change; feeds BL-0004's
design rather than replacing any part of it.

## Simplest possible implementation
One new `docs/hook-lifecycle-by-workflow-shape-2026-08-22.md` file: a short intro, one
Mermaid diagram per workflow shape (or one combined diagram if it stays legible), and a
comparison table (shape × hook event × fires?/count). Cross-linked from
`docs/claude-code-integration-2026-08-22.md`.
- Get: a concrete reference BL-0004 (and anyone else touching hooks) can check design
  choices against, discoverable via the dashboard's existing Docs section with zero new code.
- Give up: first version is based on documented behavior, not observed logs (this repo has
  no hook events yet to verify against) — some detail may be wrong until BL-0004 ships and
  the diagram gets checked against reality.
