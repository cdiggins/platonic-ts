---
id: BL-0014
title: Correlate git commits to agent sessions in dashboard
type: idea
status: in-progress
priority: "?"
effort: "?"
risk: "?"
area: dashboard
sprint:
created: 2026-08-22
closed:
links: []
---

## Idea
Dashboard should show which git commits came out of which agent/session, so an activity
row is traceable to what actually shipped — not just token counts and a snippet. User
confirmed intent (asked via clarifying question): correlate commits to sessions, not a
plain read-only commit log and not a write/commit-from-UI action.

## Assumptions
- `AgentActivity`/`AgentStatus` already carry `sessionId` as a first-class field
  ([core/src/index.ts:12](packages/core/src/index.ts:12),
  [core/src/index.ts:34](packages/core/src/index.ts:34)) — the join key exists on the
  dashboard side.
- Nothing on the git side currently carries session id. Checked recent commits
  (`git log`) in this repo: no `Session-Id`-style trailer, no `Co-Authored-By` line either
  — commit messages are free text with no machine-readable session reference today.
- Dashboard has no filesystem/git access currently — [server.ts:1-2](packages/dashboard/src/server.ts:1)
  states it depends "only on core types + an injected provider — no filesystem access
  here"; correlation needs a new provider input (git log) wired in from
  [main.ts](packages/dashboard/src/main.ts), same pattern as backlog/docs providers.

## Design decisions
- Correlation key — add a git trailer (e.g. `Session-Id: <uuid>`) written at commit time
  (would need a commit-message convention or hook) vs heuristic match by timestamp (commit
  time falls within a session's activity window) vs no automatic correlation, just show
  both lists side by side and let the user eyeball it. Trailer is exact but requires
  changing how commits get made (this session's own commits don't do this yet); timestamp
  heuristic works retroactively on existing history but is approximate (overlapping
  sessions, manual commits break it).
- Data source — shell out to `git log` at snapshot time (simple, matches "provider" pattern)
  vs a `.git`-parsing library (no such dependency exists in repo, would break the
  documented zero-runtime-deps posture used elsewhere, e.g.
  [server.ts:1](packages/dashboard/src/server.ts:1)/[ui.ts:1](packages/dashboard/src/ui.ts:1)).
  Shelling to `git log --format=...` is the only zero-dep option.
- Scope of "session" — Claude Code session (`sessionId` from transcripts, includes
  sub-agent/sidechain runs) vs just top-level sessions. Sub-agent commits (if any) should
  probably roll up to the parent session for display, not appear as orphans.

## Related
- No existing backlog item covers commit history or session-to-commit linkage — checked
  `backlog/*.md` for "commit"/"session" keywords, only incidental mentions (BL-0002 ratchet
  counts, BL-0004 hook session-start events). Not a duplicate.
- [BL-0004](backlog/BL-0004-hooks-events.md) — if that lands (`SessionStart` hook emitting
  JSONL), the session-id-at-commit-time problem gets easier: a `PostToolUse` hook could
  capture session id at the moment `git commit` runs, no manual trailer convention needed.
  Worth landing BL-0004 first if this idea gets picked up.

## Approaches
Short term:
- Add a `git log --format='%H|%ad|%s'` read into a new dashboard provider, show a plain
  commit list (no correlation yet) as a stepping stone — cheap, immediately useful, doesn't
  block on solving the correlation-key problem.
- Timestamp-heuristic correlation: for each commit, find the session whose activity window
  contains the commit time; show as a "likely session" on hover, clearly marked as a guess.

Long term:
- Hook-based exact correlation (see BL-0004 relation above) — capture session id at commit
  time via a git hook or wrapper, store as trailer or side file, join exactly in the
  dashboard provider.
- Reverse view: from a session row, list "commits produced" instead of only from commit to
  session.

Adjacent ideas worth their own item:
- General git activity panel (branches, ahead/behind, dirty state) — commit correlation is
  one slice of a broader "git status in dashboard" idea; not filing separately unless asked.

## Bedrock
The exact-correlation path (git trailer or hook-captured session id) strengthens the
boundary between "what an agent did" (transcript-derived `AgentActivity`) and "what shipped"
(git history) — right now these are two disconnected data sources with a shared key
(`sessionId`) that never gets written to the git side. Building that link makes future asks
("what did session X actually change") answerable without manual archaeology.
Verdict: **simplest-along-the-grain** — start with a plain commit-list provider (no
correlation), but do NOT hardcode assumptions that prevent joining on `sessionId` later
(e.g. don't discard commit timestamps or hashes when displaying the list) so the exact-match
path stays reachable once a session-id-at-commit-time source exists.

## Simplest possible implementation
New provider function that runs `git log --format=...` (bounded to last N commits) and
returns commit list; dashboard renders it as a new section, un-joined, with a heuristic
"session: ~label (by time)" annotation computed client- or server-side from existing
`sessionId`/`lastActivityAt` data.
- Get: visible commit history in dashboard now, groundwork for correlation later, no new
  runtime dependency.
- Give up: correlation is approximate (timestamp-based) until an exact session-id-at-commit
  mechanism exists; shelling to `git log` ties the provider to running inside a git repo
  with `git` on PATH (already implicitly true for this project).
