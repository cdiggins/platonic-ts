# packages/transcripts/src

Parses and tails Claude Code transcript JSONL files into normalized activity records, and
provides corpus-level analysis for auditing where context tokens go.

<!-- BEGIN GENERATED: src-index (npm run docs:regen) -->
| File | Purpose |
|---|---|
| `analyze.ts` | Corpus-level analysis of Claude Code session transcripts: classify every JSONL entry into byte-counted content slices, deduplicate resumed sessions, and build tabular views (composition, per-session, per-tool, per-model, user-message grep). Pure module — no IO; main.ts feeds it file contents. |
| `index.ts` | Parse and tail Claude Code transcript JSONL files into normalized AgentActivity records, plus pure aggregations (statuses, usage) over the accumulated list. |
| `main.ts` | CLI entry: analyze a Claude Code session-transcript corpus. |
<!-- END GENERATED -->
