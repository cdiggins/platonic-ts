# Contracts — fences and seams

## Wave 2 fences (current)

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
