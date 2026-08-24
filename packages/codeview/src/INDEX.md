# packages/codeview/src

Serves the code overview browser (BL-0016) on port 4848: a single-page app that browses this
repository's own source with syntax highlighting, symbol navigation, and the quality metrics
`packages/codemap` computes, plus a feedback box that files a backlog item.

<!-- BEGIN GENERATED: src-index (npm run docs:regen) -->
| File | Purpose |
|---|---|
| `io.ts` | IO edge: turns browser feedback into a backlog item file. |
| `main.ts` | Composition root: wires the code index, the renderers, and the feedback sink into the code browser server. Supervisor-owned. Run with: npm run codeview |
| `render.ts` | Pure rendering: syntax highlighting, navigable source HTML, markdown. |
| `server.ts` | HTTP server for the code browser. node:http only, zero runtime deps. Depends on core types plus injected providers — no filesystem access here. |
| `ui.ts` | Single-page code browser HTML. All CSS/JS inline, zero external requests. The client fetches /api/index, /api/file, /api/references and POSTs /api/feedback. |
<!-- END GENERATED -->
