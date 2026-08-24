# packages/codeview/src

Serves the code overview browser (BL-0016) on port 4848: a single-page app that browses this
repository's own source with syntax highlighting, symbol navigation, and the quality metrics
`packages/codemap` computes, plus a feedback box that files a backlog item.

| File | Purpose |
|---|---|
| `main.ts` | Composition root — wires a live `codemap` session (rebuilt from watcher events and a timestamp-scan fallback on every request) into `FileView` and reference lookups, and starts the server. Run with `npm run codeview`. |
| `io.ts` | IO edge that turns a submitted `FeedbackInput` into a new backlog item file: allocates the next `BL-NNNN` id from existing filenames, derives a slug and title from the feedback text, and writes the rendered markdown. |
| `render.ts` | Pure rendering: a TypeScript tokenizer/classifier for syntax highlighting, `renderSourceHtml` (numbered, navigable source with symbol reference anchors), and a small markdown-to-HTML renderer for the docs the browser also shows. Exempted from the 300-line file cap (PS-056) as one cohesive rendering artifact. |
| `server.ts` | HTTP server (`node:http`, no framework) exposing `/api/index`, `/api/file`, `/api/references`, and `/api/feedback` over injected provider functions; validates that any repo-relative path from the browser cannot escape the repo. |
| `ui.ts` | The single self-contained HTML page — inline CSS and client-side JavaScript — that renders the file tree, source pane, metrics pane, and feedback form, and drives them by polling the `/api/*` endpoints. Exempted from the 300-line file cap (PS-056) for the same reason as `render.ts`. |
