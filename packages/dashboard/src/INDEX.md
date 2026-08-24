# packages/dashboard/src

This folder holds the dashboard's own logic: the pure row/arc/page shaping that feeds the
UI, the HTTP+SSE server that exposes it, and the composition root that wires transcripts,
backlog, docs, and git history into a running process. It does not parse transcripts,
backlog markdown, or git log itself — those live in `packages/transcripts`, `packages/backlog`,
and `packages/gitlink`, and are only consumed here.

| File | Purpose |
|---|---|
| `commits.ts` | Merges `gitlink`'s `CommitInfo` and `CommitSessionLink` into the `CommitRow` shape the commits table and `/api/commits` render, choosing a display label for the linked session (session id, else transcript file basename) and defaulting unmatched commits to confidence `'none'`. |
| `invocations.ts` | Re-tails the same transcript files `packages/transcripts` already tails, independently, to extract per-invocation history (`parseToolInvocations`) that the shared `pollTranscripts` path folds away. Deliberately duplicates the offset/remainder tailing shape so the two readers behave identically. |
| `main.ts` | Composition root: discovers transcript, subagent, and task-temp directories, polls transcripts and invocations, reads backlog and docs off disk, re-reads and correlates git log into commit rows, and starts the HTTP server. Run via `npm run dashboard`. |
| `paging.ts` | Pure page arithmetic (`computePage`) plus the pager's HTML/CSS and a hand-mirrored plain-JS copy of the same arithmetic (`PAGER_CLIENT_SCRIPT`) for the browser, since an inline `<script>` cannot import the ES module. |
| `pie.ts` | Pure SVG pie-chart geometry (`computePieArcs`, `pieSvg`) with a fixed color palette; the tested source of truth for arc math that `ui.ts`'s client script re-implements inline for the same reason `paging.ts` does. |
| `range.ts` | Defines the usage time/count windows (`last-hour`, `today`, `all`, `last-100`, `last-500`) and slices an activity list down to one, for the `/api/state` and `/api/events` `?range=` query param. |
| `server.ts` | `node:http` server serving the dashboard page, an SSE snapshot stream, and JSON endpoints for state, invocations, and commits; re-summarizes usage over a range without needing changes to `packages/core`. |
| `ui.ts` | Renders the single-page dashboard: inline CSS, and an inline client script that connects to `/api/events`, renders every table and pie chart, and separately polls `/api/invocations` and `/api/commits`. |
