# Notes — findings that must feed back into the design

Agents: append findings here (contract friction, surprises, perf numbers).
This file is a first-class deliverable alongside the code.

## Contract changes

- 2026-08-22 S: pnpm not installed on this machine; using npm workspaces instead of the
  tooling-catalog shortlist's pnpm. Revisit if fence-by-package needs pnpm's stricter isolation.

## Findings

### Track B — backlog seam

- parseBacklogFile: YAML-ish frontmatter (key: value lines between --- delimiters). Requires id and title; status defaults 'todo', priority defaults 3 (int parse). Captures owner/created as optional. Body trimmed after closing ---.
- loadBacklog: Reads *.md non-recursive, drops unparseable, sorts by status order (doing, todo, blocked, done) then ascending priority. Missing dir returns empty array.
- renderBacklogItem: Round-trips through parse. Omits owner/created lines when undefined.
- Seeded 6 backlog items (BL-0001..0006): 1 doing (p1 dashboard), 4 todo (p1–p4 check/ratchet/eslint/hooks), 1 trial run (p4 gratify).
- Tests: 23 passing (parse valid/invalid/defaults, render round-trip, sort order, missing dir, subdirs skipped).
- Gate: typecheck clean (backlog only); vitest 23/23 pass.

### Supervisor — wave 1 integration

- Wave 1 outcome: 3 fenced tracks, zero merge conflicts, zero contract friction reported.
  Full gate 50/50 green on first integration run; main.ts composition typechecked against
  real seams unchanged. Fence-by-package + supervisor-owned contracts worked as designed.
- Token cost (subagent output tokens): doc-extraction 53k (sonnet), Track A transcripts 80k
  (sonnet), Track B backlog 46.5k (haiku), Track C dashboard 73k (sonnet). Haiku handled the
  well-specified track fine — spec precision, not model strength, was the binding constraint.
- Dashboard live on :4747 against real transcripts within ~2h of wave start. Gaps found by
  looking at it: (1) subagent/task transcripts live in per-session temp dirs
  (`%LOCALAPPDATA%\Temp\claude\<proj>\<session>\tasks\*.output`) which non-recursive discovery
  misses; (2) agent labels are raw session UUIDs — unreadable; (3) all-time usage totals mix
  old sessions with current work. All queued as BL-0007.

### Supervisor — wave 1 setup

- Dashboard reads Claude Code transcripts directly (passive session-log parsing) rather than
  requiring hooks — matches deliverable-ideas' "turn on C passively day one". Hooks come later.

### Track C — dashboard server + UI

Files: `packages/dashboard/src/server.ts`, `packages/dashboard/src/ui.ts`,
`packages/dashboard/test/server.test.ts`.

Exports (match seam exactly): `SnapshotProvider`, `startDashboard(options): Promise<{ port, close }>`
from `server.ts`; `renderPage(): string` from `ui.ts` (name not seam-mandated, chose plain export).

HTTP surface built on `node:http` only: `GET /` (HTML, inline CSS/JS, EventSource client, no
external requests), `GET /api/state` (JSON snapshot, 500 on provider throw), `GET /api/events`
(SSE, immediate push + `pollIntervalMs` interval per client, cleans up on `req`/`res` close),
404 otherwise. `close()` clears all SSE intervals, ends open SSE responses, then closes the
HTTP server — verified port frees after close in test.

No contract friction: core types (`DashboardSnapshot` etc.) matched UI needs directly, no
changes requested. Zero deps used (node:http, node:url via WHATWG `URL` global).

Gate results (this fence): `npm run typecheck` — clean, no errors. `npx vitest run
packages/dashboard` — 6/6 passed. Full `npm run check` — typecheck clean; vitest 49/50 passed,
1 failure in `packages/transcripts/test/transcripts.test.ts` (`pollTranscripts` tail/shrink
case, Track A, outside this fence) — not touched, not caused by dashboard changes.

### Track A — transcripts seam

Files: `packages/transcripts/src/index.ts`, `packages/transcripts/test/transcripts.test.ts`,
`packages/transcripts/test/fixtures/sample.jsonl`.

Exports match seam exactly: `parseTranscriptLine`, `discoverTranscriptFiles`, `TailState`,
`createTailState`, `pollTranscripts`, `computeStatuses`, `summarizeUsage`. No contract
friction, no dependency requests — node:fs/promises + node:path only.

Real transcript format surprise (checked live files under
`C:\Users\cdigg\.claude\projects\C--Users-cdigg-git-platonic-ts\`): far more line `type`s than
the seam sketch implied — `queue-operation`, `attachment`, `custom-title`, `bridge-session`,
`last-prompt`, `system`, `summary`, etc. All of these fall through to `kind: 'other'` (or
`undefined` if no parseable `timestamp`), which the seam already covers, so no design change
needed — just more real-world noise than doc examples showed. Assistant `message.content`
blocks include a `thinking` type alongside `text`/`tool_use` (thinking blocks contribute
neither snippet nor toolName, correctly ignored by "first block of type X" lookup). User
`message.content` can be a bare string, an array of `tool_result` blocks, or an array of
`text` blocks (a plain follow-up turn) — all three are exercised in the fixture. `usage`
object on assistant lines carries many more fields than the four the contract needs
(`service_tier`, `iterations`, `cache_creation.ephemeral_*`, etc.) — ignored, only the four
named fields read, defaulting to 0 when absent.

Design choices where the seam was silent: `computeStatuses` picks `lastModel`/`lastTool`/
`lastSnippet`/`sessionId` by scanning backward per-file for the most recent activity that
actually carries that field (not just the literal last activity, which is often a tool_result
or other-kind line with everything undefined) — otherwise a status card would blank out after
every tool call. `summarizeUsage` totals are all-time sums over the full activity list (not
window-filtered); only `outputTokensPerMinute` uses `windowMs`, via the core helper, matching
"pure aggregations over the full accumulated activity list" in CONTRACTS.md. Tail state is a
`ReadonlyMap<file, {offset, remainder}>` rebuilt fresh from `discoverTranscriptFiles` each
poll (files that vanish are silently dropped from state, not retained speculatively).

Gate results (this fence): `npm run typecheck` — clean. `npx vitest run packages/transcripts`
— 15/15 passed. Full `npm run check` — typecheck clean, vitest 50/50 passed (all four package
test files, including dashboard and backlog).
