# packages/backlog/src

Parses, renders, and loads backlog markdown items from `backlog/`, and allocates and
validates their `BL-NNNN` ids. It also owns the second regenerate-a-view job in the repo:
the generated inventory blocks inside README.md and docs/tools-and-process.md.

<!-- BEGIN GENERATED: src-index (npm run docs:regen) -->
| File | Purpose |
|---|---|
| `docsgen.ts` | Pure half of `npm run docs:regen`: renders the inventory tables (npm scripts, workspace packages, vendored skills) and splices them into a document's generated marker blocks. |
| `docsgenIo.ts` | Filesystem half of `npm run docs:regen`: reads the inventory sources (root and package manifests, vendored SKILL.md frontmatter) and rewrites or audits the documents' blocks. |
| `ids.ts` | Backlog id allocation — the pure half: how a number becomes a name, which numbers a set of filenames already uses, and what makes an allocation invalid. The concurrency-safe claim itself is filesystem work and lives in `io.ts`; this module is what that claim is reasoning about. |
| `index.ts` | Parses one backlog markdown file's frontmatter into a `BacklogItem` (tolerating the pre-WorkQuarry schema), loads the full backlog from disk, and renders the generated views. |
| `indexdoc.ts` | Pure half of the src-folder INDEX.md generator (BL-0032): harvests each source file's PS-057 purpose comment and each subfolder's INDEX.md opening statement into one table. |
| `indexdocIo.ts` | Filesystem half of the src-folder INDEX.md generator: finds every folder that must carry an INDEX.md and reads the purpose text each of its entries publishes, for indexdoc.ts to render. |
| `io.ts` | Root zone: the filesystem half of backlog id allocation. |
| `main.ts` | Composition root / CLI entry for the backlog: item ids, the generated backlog views, and the generated documentation blocks. |
<!-- END GENERATED -->
