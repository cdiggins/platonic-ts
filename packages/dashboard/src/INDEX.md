# packages/dashboard/src

This folder holds the dashboard's own logic: the pure row/arc/page shaping that feeds the
UI, the HTTP+SSE server that exposes it, and the composition root that wires transcripts,
backlog, docs, and git history into a running process. It does not parse transcripts,
backlog markdown, or git log itself — those live in `packages/transcripts`, `packages/backlog`,
and `packages/gitlink`, and are only consumed here.

<!-- BEGIN GENERATED: src-index (npm run docs:regen) -->
| File | Purpose |
|---|---|
| `commits.ts` | Pure merge of gitlink's CommitInfo + CommitSessionLink into dashboard row shape (BL-0014). Reading git and running parseGitLog/correlateCommits happens in main.ts (composition root); this module only shapes the result for the /api/commits endpoint and the commits table. |
| `invocations.ts` | Dashboard-local incremental tail for tool/skill invocations (BL-0012). The dashboard's fence this wave does not include packages/transcripts, and pollTranscripts only returns AgentActivity (one record per line, first tool_use block folded away) — not enough to show a per-invocation history. This module re-tails the same transcript files independently, tracking its own byte offsets, and runs parseToolInvocations (already exported from packages/transcripts, read-only import here) over newly appended lines. |
| `main.ts` | Composition root: wires transcripts + backlog + docs into the dashboard server. Supervisor-owned. Run with: npm run dashboard |
| `paging.ts` | Pagination for the dashboard's tables. This module is the tested source of truth for the page arithmetic; the client script it exports embeds an equivalent plain JS implementation (it runs in the browser against live SSE data and cannot import an ES module), so keep the two in sync when the arithmetic changes. |
| `pie.ts` | Hand-rolled inline-SVG pie-chart geometry (BL-0013). No charting library — zero external requests, matches ui.ts's constraint. This module is the tested source of truth for the arc math; the client script in ui.ts embeds an equivalent plain JS implementation (it runs in the browser against live SSE data and cannot import an ES module), so keep the two in sync when the formula changes. |
| `range.ts` | Pure usage-range slicing (BL-0008). Dashboard-side only: slices the raw activity list before feeding it into `summarizeUsage`/`outputTokensPerMinute` from packages/core and packages/transcripts. No packages/core edits. |
| `server.ts` | HTTP + SSE dashboard server. node:http only, zero runtime deps. Depends only on core types + an injected provider — no filesystem access here. |
| `ui.ts` | Single-page dashboard HTML. All CSS/JS inline, zero external requests. Client connects to /api/events (SSE) and renders on every push. |
<!-- END GENERATED -->
