# packages/core/src

Shared contract types and small pure helpers for the observability layer (transcripts,
dashboard, codemap, codeview). Supervisor-owned — see the file's own header before editing.

| File | Purpose |
|---|---|
| `index.ts` | Defines every cross-package type (`AgentActivity`, `BacklogItem`, `CodeIndex`, `SymbolInfo`, etc.) plus three pure helpers (`splitJsonlChunk`, `outputTokensPerMinute`, `truncate`). The one place shared shapes are declared, so packages agree on them without importing each other. |
