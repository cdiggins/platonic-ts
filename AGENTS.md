# Agent orientation — platonic-ts

Read in this order: this file, `CONTRACTS.md` (fences + seams), `docs/style-guide.md` (how to
write the code — rule IDs `PS-nnn`), `NOTES.md` (findings — append yours).

## Run + verify (before AND after changing anything)

```
npm run typecheck   # tsc --noEmit, strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes + noImplicitReturns
npm run test        # vitest run, all packages
npm run check       # typecheck -> lint -> ratchet -> tests -> backlog ids, in order, first failure stops it; the only definition of green
npm run dashboard   # observability server on http://localhost:4747
npm run mcp         # MCP server on stdio; registered for this repo in .mcp.json
npm run stats       # size distributions of this repo's functions, statements, expressions
```

Ratchet counts escape hatches (`any`, `as`, `!`, `@ts-` and eslint-disable comments) under
`packages/*/{src,test}` against `ratchet.json`: more fails, fewer rewrites the baseline.

## Map

| Where | What |
|---|---|
| `packages/core` | Shared types + pure helpers. Supervisor-owned contract — change carefully. |
| `packages/transcripts` | Parse/tail Claude Code transcript JSONL into `AgentActivity`; usage aggregation. |
| `packages/backlog` | Parse/render/load backlog markdown items in `backlog/`; allocates `BL-NNNN` ids (`npm run backlog:next-id -- <slug>`) and validates them (`npm run backlog:validate`). Never pick an id by scanning for the highest number — see `docs/backlog-id-allocation-2026-08-23.md`. |
| `packages/codemap` | Builds a `CodeIndex` of the repo: symbols, references, quality metrics. Pure; IO in `src/io.ts`; change detection in `src/watch.ts`. `openSession`/`updateSession` rebuild only what changed. `npm run stats` reports size distributions by zone; `npm run clones` reports expressions that repeat under different names (`shapes.ts` normalizes one expression, `clones.ts` groups them). |
| `packages/codeview` | Code overview browser (BL-0016) on port 4848 — source, navigation, metrics, readmes, feedback box. |
| `packages/dashboard` | HTTP + SSE server and single-page UI; composition in `src/main.ts`. Agent observability only — transcripts, usage, backlog, docs. Source browsing, symbol navigation, and code metrics/quality scoring are out of scope and belong to a separate app; do not add them here (see `docs/tools-and-process.md`). |
| `packages/mcp` | MCP server (BL-0026) over the code index: 33 tools — outlines, declarations, type-checked references, inferred types, diagnostics, dependency analyses, name-addressed editing, move/rename/signature transformations, checkpoint and revert, and the check gate. Every write tool takes `preview`. Prefer these over reading whole files, grepping, and text-matching edits — see `docs/mcp-server-2026-08-23.md` and `docs/refactoring-tools-built-2026-08-23.md`. |
| `backlog/` | One markdown file per work item (format in CONTRACTS.md); `backlog/.ids/` holds one empty marker per id ever allocated. |
| `docs/` | Design notes; the dashboard lists them. |

## Conventions

Commit to `main` with pathspec (`git commit -- <paths>`); push only after a verified
milestone (`git pull --rebase` first — parallel agents collide). No branches, no worktrees.
Pure functional style, zero runtime deps, relative imports across packages.
Full rules in [docs/style-guide.md](docs/style-guide.md); breaking one requires PS-056.

## Prose style (responses, docs, summaries, reports)

Everything an agent writes in prose — chat responses to the user, commit bodies, docs,
summaries, review reports — follows the same rule: write like a technical writer for a
professional developer audience who is reading the text out of context, with no memory of
the conversation that produced it.

- Be clear and concise. Say the thing; do not narrate the approach to saying it.
- Minimize jargon and shorthand. Prefer standard vocabulary over coined terms
  ("lock" not "fence", "authoritative check" not "sacred"). When a project-specific term
  must appear, define it in a plain clause on first use.
- One idea per sentence. No nested parentheticals doing the real work.
- Keep it easy to parse: short paragraphs, lists where the content is a list, and
  file references as paths a reader can open.

Worked example: version #11 in
[docs/summary-style-explorations-2026-08-23.md](docs/summary-style-explorations-2026-08-23.md).

## Documenting exports

When you create an exported declaration, or touch one that has no doc comment, leave it
with one `//` line above it stating its purpose or contract — what a caller can rely on,
not what the code does step by step (that is PS-050's job to prevent).

- **Earn the line.** It must say something the name and signature do not. If deleting the
  comment would lose nothing, do not write it. "Builds a workspace from sources" above
  `workspaceOf(sources)` is noise; "Symbols resolve but line numbers are fake" is a doc.
- **Write from evidence.** A claim about behavior must come from the body, a call site, or
  a covering test — never from what the name suggests. If those three do not make the
  purpose clear, do not guess: leave the declaration undocumented and note what you could
  not determine (a review comment, a NOTES.md line, or a backlog item). An honest gap
  beats a wrong doc, because readers trust the doc over the code.
- **Timeless present tense.** The comment describes the code as it is, addressed to the
  next reader — never the change you just made or the reviewer of your diff. "Now
  handles the empty case", "refactored to use X", and anything with "previously" or
  "updated" is diff narration and will be stale the moment it merges.
- **Contract before mechanism.** Prefer the guarantee ("returns the same index a full
  rebuild would produce") over the implementation ("iterates changed files and merges
  maps") — mechanisms change without the comment noticing; contracts fail tests when
  they change.
