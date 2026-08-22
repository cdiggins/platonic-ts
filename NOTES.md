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
