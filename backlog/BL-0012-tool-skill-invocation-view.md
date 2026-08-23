---
id: BL-0012
title: Show skill and tool invocation history in dashboard
type: idea
status: done
priority: "?"
effort: "?"
risk: "?"
area: dashboard
sprint:
created: 2026-08-22
closed: 2026-08-22
links: [BL-0004, BL-0007]
---

## Idea
User want dashboard show which tools (and which skills, specifically) agent invoke, not
just last one. Today [packages/transcripts/src/index.ts:99-109](packages/transcripts/src/index.ts:99)
grab only first `tool_use` block per assistant message via `firstBlockOfType`, keep just
tool `name` — no input args, so `Skill` calls all look identical (name says "Skill", not
which skill). [packages/core/src/index.ts:316-334](packages/core/src/index.ts:316) then
collapse whole session down to single `lastTool` field on `AgentStatus`, rendered as one
table cell in [packages/dashboard/src/ui.ts:74](packages/dashboard/src/ui.ts:74). History
lost, multi-tool messages lost, skill identity lost.

## Assumptions
- User want per-invocation visibility (sequence of tool/skill calls), not just current state.
- Skill invocations show up as `tool_use` blocks with `name: "Skill"` and `skill` in input —
  need verify exact field name against live transcript, [NOTES.md:72-84](NOTES.md:72)
  confirm `tool_use` blocks carry arbitrary `input` already read for other fields.
- Existing SSE push (`/api/events`, [server.ts:29](packages/dashboard/src/server.ts:29))
  can carry richer payload without new transport — no infra change needed, just contract.

## Design decisions
- Extend `AgentActivity` (append-only log entry) to also carry all tool_use blocks in a
  message, not just first — vs add second field for skill name only. Full block list is
  more general, costs more (parses `input` object) but does not lose parallel tool calls.
- History depth: unbounded log vs ring buffer (last N per agent) vs let UI page for it.
  Ring buffer (e.g. 50) keeps `DashboardSnapshot` payload bounded — matches existing "last
  activity wins" philosophy in `computeStatuses`.
- Where it renders: new column/expandable row on existing agent table
  ([ui.ts](packages/dashboard/src/ui.ts)) vs separate "activity feed" panel. Feed reads
  better for multi-agent fan-out (workflow runs) but is bigger UI lift.

## Related
- [BL-0004](backlog/BL-0004-hooks-events.md) — alternate data source (PostToolUse hook JSONL)
  for same underlying need; this idea uses transcript `tool_use` blocks already flowing
  through `parseTranscriptLine`, no hook plumbing required. Could co-exist: hooks give
  richer/faster events later, transcript mining works today with zero new moving parts.
- [BL-0007](backlog/BL-0007-dashboard-polish.md) — sibling "polish found by using the live
  dashboard" item; this is same category of gap.

## Approaches
Short term:
- Widen `firstBlockOfType` call site to collect all `tool_use` blocks per line, keep name +
  (for `Skill` tool) the invoked skill name from `input`.
- Add bounded per-agent tool/skill history array to `AgentStatus`, render as expandable
  list or small scrollable log under each agent row.

Long term:
- Aggregate view: "skills used this session" / "tool call counts by name" — feeds into
  BL-0011 (conformance/complexity scoring) style rollups.
- If BL-0004 hooks land, switch primary source to hook-emitted events (lower latency, no
  transcript tail-parsing lag) and keep transcript parsing as fallback.

Adjacent ideas worth their own item:
- Per-tool-call cost (tokens) breakdown, not just count.

## Bedrock
Strengthens the `AgentActivity` seam in [packages/core/src/index.ts:10-26](packages/core/src/index.ts:10) —
the "one normalized record derived from a transcript line" contract that Track A/B/C/D all
depend on ([NOTES.md](NOTES.md) documents it as supervisor-owned, tracks request changes
via NOTES.md). Right now it silently drops information (only first tool_use, no input) that
downstream consumers can never recover without re-parsing raw transcripts. Fixing it here
means every future dashboard feature that needs tool detail (skill stats, cost-per-tool,
this idea) reads it off the existing record instead of re-deriving from JSONL.
Verdict: **simplest-along-the-grain** — must not add unbounded per-line storage (keep ring
buffer / bounded history) or the snapshot payload growth breaks the SSE poll model.

## Simplest possible implementation
In `parseTranscriptLine`, collect every `tool_use` block's `{name, skillName?}` instead of
just the first; append to a capped (e.g. 50-entry) ring buffer on `AgentStatus`; render as a
`<details>` list per agent row in `ui.ts`.
- Get: full tool/skill call history per agent, skill names distinguishable, no new
  transport/infra.
- Give up: no durability beyond ring buffer (older calls silently drop) or beyond the
  transcript file itself; no counts/aggregation until a later pass.
