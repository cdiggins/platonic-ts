# Contracts — fences and seams

## Wave 4 fences (concurrent with Wave 3) — tooling wave

Runs alongside Wave 3 on the same tree, disjoint fences. Wave 4 never writes
`packages/core/**`, `packages/codemap/**`, `packages/codeview/**`, `.claude/**`, or root
`package.json`. Wave 4 supervisor owns wiring + root script additions at integration.

| Track | Item | Writes only | Ports/resources |
|---|---|---|---|
| K hooks | BL-0004 | `packages/hooks/**` | none |
| L ratchet-fix | BL-0009 | `packages/check/src/**`, `packages/check/test/**`, `ratchet.json` | none |
| M init | BL-0010 | `packages/init/**` | none |
| N invocations | BL-0012 (lib half) | `packages/transcripts/src/**`, `packages/transcripts/test/**` | none |
| O usage-range | BL-0008 | `packages/dashboard/src/**` except `main.ts`, `packages/dashboard/test/**` | tests on port 0; runtime 4747 reserved |
| P gitlink | BL-0014 (lib half) | `packages/gitlink/**` | read-only `git log` |
| S4 supervisor | — | everything else in Wave 4 scope | full gate; only S4 pushes Wave 4 files |

New packages carry their own `package.json` (`"private": true`, `"type": "module"`, export
`./src/index.ts`) inside their fence; root workspaces glob (`packages/*`) picks them up.
NOTES.md: append-only for all tracks in both waves.

### Wave 4 seams

- **Track K** `packages/hooks/src/index.ts` exports: `HookEvent` type
  (`{ type: 'tool' | 'session-start'; timestamp: string (ISO); sessionId: string; tool?: string; skill?: string; cwd?: string }`),
  `parseHookEventLine(line: string): HookEvent | undefined` (pure),
  `formatHookEvent(event: HookEvent): string` (pure, JSONL round-trip), plus runnable hook
  entry scripts (`postToolUse.ts`, `sessionStart.ts`) that read the hook JSON payload from
  stdin and append one JSONL line to `<repo>/.claude/events/events.jsonl` — but the scripts
  live in `packages/hooks/src`; nothing writes `.claude/settings.json` this wave (wiring is a
  human/supervisor step, documented in the package README).
- **Track L** keeps `countEscapeHatches` exported signature identical — Wave 3 Track G
  consumes it. Behavior change (directives counted from comment trivia, not raw text) is the
  bug fix itself and applies to both consumers.
- **Track N** adds new exports beside the existing ones (no changes to
  `parseTranscriptLine` outputs): local type `ToolInvocation`
  (`{ file: string; sessionId?: string; timestamp?: string; tool: string; skill?: string; detail?: string }`)
  and `parseToolInvocations(file: string, line: string): readonly ToolInvocation[]`
  returning one entry per `tool_use` block (all blocks, not just the first; for `Skill`
  invocations, `skill` carries the skill name from the input). Types stay local to the
  package — `packages/core` is frozen by Wave 3.
- **Track O** computes range filtering dashboard-side (slice activities by timestamp or by
  last-N count before feeding existing summarizers) — no `packages/core` edits.
- **Track P** `packages/gitlink/src/index.ts` exports pure functions to parse `git log`
  porcelain output and correlate commits to sessions: `parseGitLog(raw: string): readonly CommitInfo[]`,
  `correlateCommits(commits, activities: readonly { sessionId?: string; timestamp?: string; file?: string }[]): readonly CommitSessionLink[]`
  (trailer match `Session-Id:`/`Co-Authored-By` first, else time-window heuristic with
  confidence field). Reading git is done by the caller; the library stays pure.

## Wave 3 fences (current) — BL-0016 code overview browser

Two new packages. `packages/codemap` builds a serializable index of the repo's TypeScript;
`packages/codeview` serves it as a browsable page on port 4848. The observability dashboard
(port 4747) is untouched — the scope boundary in `docs/tools-and-process.md` is the reason
this is a separate app.

Supervisor-owned (READ only for every track; report needed changes, never edit):
`packages/core/src/index.ts`, `packages/codemap/src/index.ts`, `packages/codeview/src/main.ts`,
`packages/*/package.json`, root `package.json`, `tsconfig.json`, `eslint.config.js`,
`ratchet.json`, this doc, `AGENTS.md`, `README.md`, `docs/**`, `decisions/**`, `backlog/**`,
`NOTES.md`.

| Track | Writes only | Ports/resources |
|---|---|---|
| F symbols | `packages/codemap/src/symbols.ts`, `packages/codemap/src/io.ts`, `packages/codemap/test/symbols.test.ts` | none |
| G metrics | `packages/codemap/src/metrics.ts`, `packages/codemap/test/metrics.test.ts` | none |
| H server | `packages/codeview/src/server.ts`, `packages/codeview/src/io.ts`, `packages/codeview/test/server.test.ts`, `packages/codeview/test/io.test.ts` | tests on port 0; manual smoke on 4849 only |
| I ui | `packages/codeview/src/ui.ts`, `packages/codeview/test/ui.test.ts` | none |
| J render | `packages/codeview/src/render.ts`, `packages/codeview/test/render.test.ts` | none |
| S supervisor | everything else; integration in `packages/codeview/src/main.ts` | port 4848; full gate; only S pushes |

Every fenced file already exists as a **stub with the final signature**, landed by the
supervisor before the tracks started. Tracks replace stub bodies; they do not change exported
signatures. A track that believes a signature is wrong reports it and keeps the signature.

### Seam — `packages/codemap/src/symbols.ts` (Track F, pure)

```ts
toRepoRelative(root: string, absolutePath: string): string
extractSymbols(root: string, sourceFile: ts.SourceFile): readonly SymbolInfo[]
collectReferences(root, program: ts.Program, symbols: readonly SymbolInfo[]): readonly SymbolReference[]
```

`SymbolInfo.id` is `` `${file}#${span.start}` `` where `span` is the declaration *name* span
and `file` is repo-relative with forward slashes. `line` is 1-based. `collectReferences`
returns one entry per identifier occurrence that resolves to a listed symbol, including the
declaration itself (`isDefinition: true`).

### Seam — `packages/codemap/src/io.ts` (Track F, Root zone)

```ts
buildProgram(repoDir: string): ts.Program
indexRepo(repoDir: string, now: number): Promise<CodeIndex>
```

`indexRepo` covers TypeScript under `packages/*/src/**` and `packages/*/test/**`, plus markdown
from the repo root, `docs/`, `decisions/`, and `backlog/`. `node_modules` is skipped. It calls
Track G's `fileMetrics`/`functionMetrics`/`folderMetrics` for the metric fields — it does not
compute metrics itself.

### Seam — `packages/codemap/src/metrics.ts` (Track G, pure)

```ts
emptyMetrics: CodeMetrics
sumMetrics(metrics: readonly CodeMetrics[]): CodeMetrics
scoreMetrics(metrics: CodeMetrics): number          // 0..100
fileMetrics(sourceFile: ts.SourceFile, sourceText: string): CodeMetrics
functionMetrics(root: string, sourceFile: ts.SourceFile): readonly FunctionMetrics[]
folderMetrics(files: readonly FileEntry[]): readonly FolderEntry[]
```

Escape-hatch counts come from `packages/check/src/ratchet.ts`'s `countEscapeHatches` — reused,
not reimplemented, so the browser and `platonic check` can never disagree. `sumMetrics`
recomputes `platonicScore` from the summed components rather than averaging scores.

### Seam — `packages/codeview/src/render.ts` (Track J, pure)

```ts
type TokenClass = 'keyword'|'string'|'number'|'comment'|'identifier'|'type'|'punctuation'|'plain'
type HighlightToken = { readonly text: string; readonly class: TokenClass; readonly start: number }
escapeHtml(text: string): string
highlightTypeScript(source: string): readonly HighlightToken[]
renderSourceHtml(source, symbols: readonly SymbolInfo[], references: readonly SymbolReference[]): string
renderMarkdown(markdown: string): string
```

`renderSourceHtml` emits numbered lines. A token that coincides with a reference span becomes
`<a class="symbol" data-symbol="<id>" href="#">`; a token that coincides with a definition span
also carries `id="sym-<id>"` so in-file jumps work without JavaScript. All text is escaped.

### Seam — `packages/codeview/src/ui.ts` (Track I, pure)

```ts
renderPage(): string
```

One self-contained HTML document: inline CSS and JavaScript, no external requests. It fetches
`/api/index`, `/api/file?path=`, `/api/references?symbol=`, and POSTs `/api/feedback`.

### Seam — `packages/codeview/src/server.ts` + `io.ts` (Track H, Root zone)

```ts
startCodeView(options: CodeViewOptions): Promise<{ port: number; close: () => Promise<void> }>
appendFeedbackItem(backlogDir: string, input: FeedbackInput, now: number): Promise<FeedbackResult>
```

HTTP surface:
- `GET /` — the page from `renderPage()`
- `GET /api/index` — `CodeIndex` JSON
- `GET /api/file?path=<repo-relative>` — `FileView` JSON, 404 when unknown
- `GET /api/references?symbol=<id>` — `readonly SymbolReference[]` JSON
- `POST /api/feedback` — body `FeedbackInput` JSON, returns `FeedbackResult`

The server reads no files: everything comes from the injected providers, exactly as
`packages/dashboard/src/server.ts` does. `appendFeedbackItem` allocates the next free
`BL-XXXX` id in `backlogDir` and writes a WorkQuarry item with `status: idea`.

## Wave 2 fences (superseded)

### Wave 2 detail

Supervisor-owned unchanged (plus `eslint.config.js`, `ratchet.json` once created).

| Track | Writes only | Notes |
|---|---|---|
| D check | `packages/check/src/**`, `packages/check/test/**`, NOTES.md append | ratchet + platonic check CLI |
| E observability | `packages/transcripts/**`, `packages/dashboard/src/**` except `main.ts`, `packages/dashboard/test/**`, NOTES.md append | BL-0007 + lint cleanup |
| S supervisor | everything else | wiring, root scripts, push |

Wave 2 contract additions:
- `AgentActivity.title: string | undefined` — set from transcript `custom-title` lines
  (shape: `{"type":"custom-title","customTitle":"...","sessionId":...}` — verify against real
  transcripts). `computeStatuses` label = most recent title for the file, else basename.
- New Track E export: `discoverSessionTaskDirs(tempRoot: string): Promise<readonly string[]>`
  returning existing `<tempRoot>\<session-dir>\tasks` directories (one level deep), for
  subagent task transcript discovery. Supervisor wires it in main.ts.

## Wave 1 fences and seams (historical)

## Fences (who writes where)

Supervisor-owned (all tracks READ only; request smallest unblocking change via NOTES.md):
`packages/core/**`, root `package.json`, `tsconfig.json`, `vitest.config.ts`,
`packages/*/package.json`, `packages/dashboard/src/main.ts`, this doc, `AGENTS.md`, `README.md`.

| Track | Writes only | Ports/resources |
|---|---|---|
| A transcripts | `packages/transcripts/src/**` (except none reserved), `packages/transcripts/test/**` | no ports; fixture files under its own `test/fixtures/` |
| B backlog | `packages/backlog/src/**`, `packages/backlog/test/**`, `backlog/**` | no ports |
| C dashboard | `packages/dashboard/src/**` EXCEPT `main.ts`, `packages/dashboard/test/**` | server tests on port 0 (ephemeral); runtime port 4747 reserved |
| S supervisor | everything else; integration in `packages/dashboard/src/main.ts` | full gate; only S pushes |

`package.json` (root and per-package): supervisor-owned. If a track needs a dependency,
record the request in NOTES.md under Contract changes; prefer zero dependencies (node:* only).

Commit with pathspec limited to your fence: `git commit -- <your paths>`. Never push.

## Shared types

All cross-package types live in `packages/core/src/index.ts` (`@platonic/core` — but import
via relative path, see Conventions). Tracks implement to these types exactly.

## Seams

### Track A — `packages/transcripts/src/index.ts` must export

```ts
// Pure. One Claude Code transcript JSONL line -> normalized activity, or undefined
// for lines that carry no useful signal (summaries, malformed JSON, etc.).
parseTranscriptLine(file: string, line: string): AgentActivity | undefined

// List absolute paths of transcript files in the given directories (non-recursive):
// files ending in .jsonl or .output. Missing directories are skipped silently.
discoverTranscriptFiles(dirs: readonly string[]): Promise<readonly string[]>

// Incremental tailing. State tracks per-file byte offset + partial-line remainder.
// pollTranscripts re-discovers files, reads only appended bytes, returns new activities.
type TailState  // opaque to callers
createTailState(): TailState
pollTranscripts(dirs: readonly string[], state: TailState):
  Promise<{ readonly state: TailState; readonly activities: readonly AgentActivity[] }>

// Pure aggregations over the full accumulated activity list.
computeStatuses(activities: readonly AgentActivity[], now: number): readonly AgentStatus[]
summarizeUsage(activities: readonly AgentActivity[], now: number, windowMs: number): UsageSummary
```

`AgentStatus.active` = last activity within 120s of `now`. `label` = file basename without
extension. Group activities by `file`.

### Track B — `packages/backlog/src/index.ts` must export

```ts
// Pure. Markdown with YAML-ish frontmatter -> item, or undefined if unparseable.
parseBacklogFile(file: string, content: string): BacklogItem | undefined

// Read every *.md in dir (non-recursive), parse, drop failures, sort by
// (status: doing, todo, blocked, done) then ascending priority.
loadBacklog(dir: string): Promise<readonly BacklogItem[]>

// Pure. Item -> markdown round-trippable through parseBacklogFile.
renderBacklogItem(item: BacklogItem): string
```

Backlog file format (`backlog/BL-0001-slug.md`):

```markdown
---
id: BL-0001
title: Short imperative title
status: todo | doing | done | blocked
priority: 1
owner: optional-agent-or-person
created: 2026-08-22
---
Free-form body.
```

### Track C — `packages/dashboard/src/server.ts` must export

```ts
type SnapshotProvider = () => Promise<DashboardSnapshot>

startDashboard(options: {
  readonly port: number            // 0 allowed for tests
  readonly provider: SnapshotProvider
  readonly pollIntervalMs: number  // SSE push cadence
}): Promise<{ readonly port: number; readonly close: () => Promise<void> }>
```

HTTP surface:
- `GET /` — single-page HTML dashboard (inline CSS/JS, no external assets)
- `GET /api/state` — current `DashboardSnapshot` as JSON
- `GET /api/events` — Server-Sent Events; each event: `data: <DashboardSnapshot JSON>\n\n`,
  pushed every `pollIntervalMs`

Track C does NOT read files or import A/B: it depends only on core types and the injected
provider. Supervisor composes A + B + docs listing into a provider in `main.ts`.

## Conventions

- Imports between packages use relative paths (`../../core/src/index.ts`) — no path mapping,
  works under tsx, vitest, and tsc unchanged.
- Zero runtime dependencies; `node:*` modules only.
- Pure functions in their own modules; IO isolated in thin wrappers.
- Expressions over statements; no classes; no mutation of inputs. Local mutable state inside
  a function body is acceptable where it is clearly simpler.
- Every exported function has at least one test in the owning package's `test/`.
