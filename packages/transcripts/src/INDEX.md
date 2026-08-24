# packages/transcripts/src

Parses and tails Claude Code transcript JSONL files into normalized activity records, and
provides corpus-level analysis for auditing where context tokens go.

| File | Purpose |
|---|---|
| `index.ts` | Parses one transcript line into an `AgentActivity`, discovers transcript files and subagent task directories on disk, tails files incrementally by byte offset, and aggregates activities into per-file `AgentStatus` and windowed `UsageSummary`. |
| `analyze.ts` | Pure corpus analysis: classifies each transcript entry into byte-counted content slices (assistant text, thinking, tool args, injected text, etc.), deduplicates resumed sessions by `uuid`, and builds the composition/sessions/tools/models/skills/grep tables `main.ts` prints. |
| `main.ts` | CLI entry (`npm run transcripts`) — loads the transcript corpus for the current project, dispatches to one of `analyze.ts`'s table builders by subcommand, and prints as text or JSON. |
