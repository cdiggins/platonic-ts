# Notes — findings that must feed back into the design

Agents: append findings here (contract friction, surprises, perf numbers).
This file is a first-class deliverable alongside the code.

## Contract changes

- 2026-08-22 S: pnpm not installed on this machine; using npm workspaces instead of the
  tooling-catalog shortlist's pnpm. Revisit if fence-by-package needs pnpm's stricter isolation.

## Findings

### Track B — backlog seam

- parseBacklogFile: YAML-ish frontmatter (key: value lines between --- delimiters). Requires id and title; status defaults 'todo', priority defaults 3 (int parse). Captures owner/created as optional. Body trimmed after closing ---.
- loadBacklog: Reads *.md non-recursive, drops unparseable, sorts by status order (doing, todo, blocked, done) then ascending priority. Missing dir returns empty array.
- renderBacklogItem: Round-trips through parse. Omits owner/created lines when undefined.
- Seeded 6 backlog items (BL-0001..0006): 1 doing (p1 dashboard), 4 todo (p1–p4 check/ratchet/eslint/hooks), 1 trial run (p4 gratify).
- Tests: 23 passing (parse valid/invalid/defaults, render round-trip, sort order, missing dir, subdirs skipped).
- Gate: typecheck clean (backlog only); vitest 23/23 pass.

### Supervisor — wave 1 integration

- Wave 1 outcome: 3 fenced tracks, zero merge conflicts, zero contract friction reported.
  Full gate 50/50 green on first integration run; main.ts composition typechecked against
  real seams unchanged. Fence-by-package + supervisor-owned contracts worked as designed.
- Token cost (subagent output tokens): doc-extraction 53k (sonnet), Track A transcripts 80k
  (sonnet), Track B backlog 46.5k (haiku), Track C dashboard 73k (sonnet). Haiku handled the
  well-specified track fine — spec precision, not model strength, was the binding constraint.
- Dashboard live on :4747 against real transcripts within ~2h of wave start. Gaps found by
  looking at it: (1) subagent/task transcripts live in per-session temp dirs
  (`%LOCALAPPDATA%\Temp\claude\<proj>\<session>\tasks\*.output`) which non-recursive discovery
  misses; (2) agent labels are raw session UUIDs — unreadable; (3) all-time usage totals mix
  old sessions with current work. All queued as BL-0007.

### Supervisor — wave 1 setup

- Dashboard reads Claude Code transcripts directly (passive session-log parsing) rather than
  requiring hooks — matches deliverable-ideas' "turn on C passively day one". Hooks come later.

### Track C — dashboard server + UI

Files: `packages/dashboard/src/server.ts`, `packages/dashboard/src/ui.ts`,
`packages/dashboard/test/server.test.ts`.

Exports (match seam exactly): `SnapshotProvider`, `startDashboard(options): Promise<{ port, close }>`
from `server.ts`; `renderPage(): string` from `ui.ts` (name not seam-mandated, chose plain export).

HTTP surface built on `node:http` only: `GET /` (HTML, inline CSS/JS, EventSource client, no
external requests), `GET /api/state` (JSON snapshot, 500 on provider throw), `GET /api/events`
(SSE, immediate push + `pollIntervalMs` interval per client, cleans up on `req`/`res` close),
404 otherwise. `close()` clears all SSE intervals, ends open SSE responses, then closes the
HTTP server — verified port frees after close in test.

No contract friction: core types (`DashboardSnapshot` etc.) matched UI needs directly, no
changes requested. Zero deps used (node:http, node:url via WHATWG `URL` global).

Gate results (this fence): `npm run typecheck` — clean, no errors. `npx vitest run
packages/dashboard` — 6/6 passed. Full `npm run check` — typecheck clean; vitest 49/50 passed,
1 failure in `packages/transcripts/test/transcripts.test.ts` (`pollTranscripts` tail/shrink
case, Track A, outside this fence) — not touched, not caused by dashboard changes.

### Track A — transcripts seam

Files: `packages/transcripts/src/index.ts`, `packages/transcripts/test/transcripts.test.ts`,
`packages/transcripts/test/fixtures/sample.jsonl`.

Exports match seam exactly: `parseTranscriptLine`, `discoverTranscriptFiles`, `TailState`,
`createTailState`, `pollTranscripts`, `computeStatuses`, `summarizeUsage`. No contract
friction, no dependency requests — node:fs/promises + node:path only.

Real transcript format surprise (checked live files under
`C:\Users\cdigg\.claude\projects\C--Users-cdigg-git-platonic-ts\`): far more line `type`s than
the seam sketch implied — `queue-operation`, `attachment`, `custom-title`, `bridge-session`,
`last-prompt`, `system`, `summary`, etc. All of these fall through to `kind: 'other'` (or
`undefined` if no parseable `timestamp`), which the seam already covers, so no design change
needed — just more real-world noise than doc examples showed. Assistant `message.content`
blocks include a `thinking` type alongside `text`/`tool_use` (thinking blocks contribute
neither snippet nor toolName, correctly ignored by "first block of type X" lookup). User
`message.content` can be a bare string, an array of `tool_result` blocks, or an array of
`text` blocks (a plain follow-up turn) — all three are exercised in the fixture. `usage`
object on assistant lines carries many more fields than the four the contract needs
(`service_tier`, `iterations`, `cache_creation.ephemeral_*`, etc.) — ignored, only the four
named fields read, defaulting to 0 when absent.

Design choices where the seam was silent: `computeStatuses` picks `lastModel`/`lastTool`/
`lastSnippet`/`sessionId` by scanning backward per-file for the most recent activity that
actually carries that field (not just the literal last activity, which is often a tool_result
or other-kind line with everything undefined) — otherwise a status card would blank out after
every tool call. `summarizeUsage` totals are all-time sums over the full activity list (not
window-filtered); only `outputTokensPerMinute` uses `windowMs`, via the core helper, matching
"pure aggregations over the full accumulated activity list" in CONTRACTS.md. Tail state is a
`ReadonlyMap<file, {offset, remainder}>` rebuilt fresh from `discoverTranscriptFiles` each
poll (files that vanish are silently dropped from state, not retained speculatively).

Gate results (this fence): `npm run typecheck` — clean. `npx vitest run packages/transcripts`
— 15/15 passed. Full `npm run check` — typecheck clean, vitest 50/50 passed (all four package
test files, including dashboard and backlog).

### Track E — BL-0007 (subagent transcripts, labels) + lint cleanup

Files: `packages/transcripts/src/index.ts`, `packages/transcripts/test/transcripts.test.ts`,
`packages/transcripts/test/fixtures/sample.jsonl`, `packages/dashboard/test/server.test.ts`.

New export: `discoverSessionTaskDirs(tempRoot): Promise<readonly string[]>` — lists direct
child dirs of `tempRoot`, keeps only those with an existing `tasks` subdir, resolved to
absolute paths. Missing `tempRoot` -> `[]`. Task transcripts inside are `*.output` JSONL,
already matched by the existing `discoverTranscriptFiles` once given these dirs — supervisor
wires `discoverSessionTaskDirs(tempRoot)` results into the dirs list passed to
`pollTranscripts`/`discoverTranscriptFiles` in `main.ts`.

Real custom-title line shape (verified against live files under
`C:\Users\cdigg\.claude\projects\C--Users-cdigg-git-platonic-ts\`):
`{"type":"custom-title","customTitle":"...","sessionId":"..."}` — matches the seam sketch
exactly, BUT the line carries **no `timestamp` field at all**. The prior early-return
(`parseTimestamp` gate before the type switch) silently dropped every custom-title line pre-
Wave-2. Fixed by moving the custom-title check ahead of the timestamp gate and giving it a
fixed sentinel `timestamp: 0` (kind `'other'`, zero tokens, `title` set) — deterministic and
JSON-safe (unlike `NaN`/`Infinity`, which `JSON.stringify` turns into `null` and would corrupt
the SSE/state payload). `computeStatuses` picks `label` via the same
"reverse-scan-the-timestamp-sorted-group-for-the-last-defined-field" pattern already used for
model/tool/snippet/session — since all custom-title entries share the same sentinel timestamp,
a stable sort preserves their original (chronological) relative order, so the reverse-find
still lands on the most-recently-emitted title; falls back to `basename` when a file has none.
Also saw a `last-prompt` variant (`{"type":"last-prompt","lastPrompt":"...","leafUuid":"...",
"sessionId":"..."}`, also no timestamp) carrying the literal first user prompt — not wired to
`title` per the seam's scope (only custom-title was requested); flagging here in case a future
label fallback wants it.

Lint cleanup (14 -> 0 errors in `packages/transcripts` + `packages/dashboard`, no
eslint-disable, no rule changes): `transcripts/src/index.ts` — removed two unnecessary
`as ActivityKind` assertions (object-literal context already narrows the string literal); every
`array.push`/`map.set` mutation site (`discoverTranscriptFiles`, `pollTranscripts`,
`computeStatuses`, `summarizeUsage`) rebuilt as an immutable derivation: `Promise.all(...).flat()`
/`.flatMap()` for discovery and polling, `[...new Set(...)].map(...)` grouping (replacing
`Map`-based accumulation) for statuses/usage aggregation, `new Map(entries)` constructor instead
of repeated `.set()`. Confirmed the existing `[...group].sort(...)` / `[...sorted].reverse()`
idiom (spread-then-mutate a freshly created array) is lint-clean, so every new sort reuses that
exact idiom. `dashboard/test/server.test.ts` — `require-await` fixed by dropping `async` from
providers that never awaited (`() => Promise.resolve(snapshot)` / `() => Promise.reject(...)`);
`no-unsafe-assignment` on `res.json()`/`JSON.parse()` fixed with two local helpers
(`readJson`, `parseJson`) that immediately cast the `any` result to `unknown` before assignment.

Gate results (this fence): `npm run typecheck` — clean. `npx eslint packages/transcripts
packages/dashboard` — 0 errors (was 14). `npx vitest run packages/transcripts
packages/dashboard` — 26/26 passed (20 transcripts incl. 5 new: discoverSessionTaskDirs x2,
custom-title parse x2, computeStatuses title-label x1). Full `npm run check` — typecheck clean,
vitest 71/71 passed across all six package test files.

No contract friction, no dependency requests. Did not touch `packages/dashboard/src/main.ts`
(supervisor-owned) — `discoverSessionTaskDirs` is exported and ready but unwired until the
supervisor composes it into the dirs list in `main.ts`.

### Track D — check seam (`platonic check`)

Files: `packages/check/src/ratchet.ts`, `src/scan.ts`, `src/run.ts`, `src/index.ts`,
`src/main.ts`, `test/ratchet.test.ts`, `test/baseline.test.ts`.

Exports: `RatchetCounts` type; `countEscapeHatches(fileName, sourceText): RatchetCounts`
(pure, `ts.createSourceFile` + AST walk); `sumCounts(counts): RatchetCounts`;
`compareToBaseline(current, baseline): { verdict: 'ok'|'improved'|'regressed', regressions }`
— regressed if any dimension rises, improved if none rise and at least one falls.
`collectSourceFiles(repoDir)` / `scanRepo(repoDir)` in `scan.ts` (IO: recursive `*.ts` under
`packages/*/src` and `packages/*/test`, skips `node_modules`). `run.ts`: `StepName`,
`CheckStepResult`, `CheckReport`, `RatchetVerdict`, `ApplyBaselineResult`,
`applyBaseline(baselinePath, current)` (baseline init/rewrite, split out from scanning so it's
testable with fabricated counts + a temp dir — no real repo scan needed in tests), `runCheck
(options): Promise<CheckReport>` (typecheck -> lint -> ratchet -> tests in order, stop at
first failure). `main.ts` is CLI entry (repoDir = repo root, baselinePath =
`<root>/ratchet.json`), prints one line per step + overall verdict, sets `process.exitCode`.

Counting approximations: `as const` excluded from `asCasts` by checking the cast's type is a
`TypeReferenceNode` named `const` (no dedicated AST kind exists for it). `tsDirectives`
(@ts-ignore/@ts-expect-error/@ts-nocheck) and `eslintDisables` (eslint-disable[-line|
-next-line]) are counted via regex over the *raw source text*, not real comment-trivia
parsing — documented in `ratchet.ts` as a deliberate simplification: these are fixed magic
tokens that essentially never occur outside real directive comments, so whole-text regex is
robust and much simpler than walking leading/trailing comment ranges per node; a string
literal containing the literal text would false-positive (accepted, rare edge case).

Contract friction / design note: `eslint.config.js` purityBans (no `Date.now`, no
`process.env`, no `console`, no `throw`) are only lifted for files literally named
`main.ts`/`server.ts`/`io.ts`. `run.ts` isn't on that list, so step timing uses
`process.hrtime.bigint()` instead of `Date.now()` — not banned by the rule (which names only
`Math.random`/`Date.now`/`process.env`), and arguably more correct for elapsed-time
measurement anyway (monotonic). No rule change requested; flagging in case other tracks hit
the same wall in a non-exempt file.

Gate results (this fence, fence-scoped as instructed — not full `npx eslint .`): `npm run
typecheck` — clean. `npx eslint packages/check` — clean, zero warnings/errors. `npx vitest run
packages/check` — 16/16 passed (11 ratchet.test.ts + 5 baseline.test.ts).

### Supervisor — wave 2 integration

- `platonic check` live: `npm run check` = typecheck -> lint -> ratchet -> tests, ~22s total,
  one-line-per-step verdict. Baseline initialized: any 0, as 7, nonNull 23, tsDirectives 4,
  eslintDisables 7 (last two inflated by ratchet's own test fixtures — BL-0009).
- Temp `tasks\*.output` files are ALWAYS 0 bytes — dead end for subagent observation. Real
  subagent transcripts: `<projectTranscriptDir>\<session-id>\subagents\agent-*.jsonl`.
  Wired in main.ts; dashboard now shows 17 agents (8 sidechains) with model + tokens each —
  weak-model delegation is directly visible (Track B row shows haiku, 8.3k out).
- Wave 2 token cost (subagent output): Track D 94.6k (sonnet), Track E 115.9k (sonnet).
  Wave 2 heavier than wave 1 per track — lint refactoring under immutable-data is expensive.
- Contract friction (Track D): purity-ban exemption is filename-based (main/server/io.ts);
  run.ts fell outside and used process.hrtime.bigint() instead of Date.now(). Filename
  convention as policy works but is blunt — consider explicit io/ directories later.

### Supervisor — Gratify first probe

- countEscapeHatches worked unmodified on a foreign repo (31 files) — per-file purity of the
  scanner paid off; only the packages/*-shaped scanRepo wrapper is platonic-ts-specific.
- Gratify: tsc clean under its own config, 322 error lines under platonic strict flags.
  Confirms the ratchet thesis: retrofit needs baseline-and-tighten, not fix-everything-first.

### Track K — hooks seam (BL-0004, Wave 4)

Files: `packages/hooks/package.json`, `src/index.ts`, `src/payload.ts`, `src/io.ts`,
`src/postToolUse.ts`, `src/sessionStart.ts`, `README.md`, `test/hooks.test.ts`.

Exports match the seam exactly from `src/index.ts`: `HookEvent`, `parseHookEventLine`,
`formatHookEvent`. Split IO into `src/io.ts` (`readStdinPayload`, `appendHookEvent`) so the
codec stays pure/testable, and shared payload guards into `src/payload.ts` (`isRecord`,
`asString`) reused by both entry scripts — mirrors the `packages/transcripts` style. Both
`postToolUse.ts`/`sessionStart.ts` export their `buildEvent` (and `postToolUse.ts` also
`skillNameFrom`) purely so tests can exercise payload mapping without touching stdin; the
seam only names `index.ts` exports so this is additive, not a deviation.

Gotcha worth flagging for future hook-script tracks: a runnable entry script that calls
`main()` unconditionally at module scope hangs forever when *imported* by a test file,
because `readStdinPayload` -> `readFileSync(0, 'utf8')` blocks waiting for EOF on the test
runner's stdin (a TTY/pipe that never closes) — `npx vitest run packages/hooks` sat with zero
output past its timeout until this was found. Fixed by gating the call: `const isMainModule =
process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href; if
(isMainModule) main()`. Any future package with a stdin-reading CLI entry point should use the
same guard rather than a bare top-level `main()` call.

`exactOptionalPropertyTypes: true` shaped `HookEvent` construction throughout: optional fields
(`tool`/`skill`/`cwd`) are added via conditional object spread (`...(x === undefined ? {} :
{ x })`) rather than ever assigning `field: undefined`, in both the pure codec and the two
entry scripts' `buildEvent`.

`.claude/settings.json` wiring is intentionally NOT written this wave (per contract) — the
JSON snippet a human pastes in lives in `packages/hooks/README.md`.

Gate results (this fence): `npx tsc --noEmit` — 0 errors under `packages/hooks` (pre-existing
errors surfaced in `packages/gitlink` and `packages/transcripts` from other Wave 4 tracks, not
touched, not caused by this track). `npx eslint packages/hooks` — 0 errors/warnings. `npx
vitest run packages/hooks` — 17/17 passed (round-trip x2, malformed-line tolerance x6,
postToolUse mapping/skill-extraction x5, sessionStart mapping x3, `appendHookEvent` temp-dir
append x1).

No contract friction, no dependency requests — `node:fs`, `node:fs/promises`, `node:os`,
`node:path`, `node:url` only.

### Track N — invocations seam (BL-0012 library half, Wave 4)

- Added `ToolInvocation` type and `parseToolInvocations(file, line)` beside the existing
  exports; existing `parseTranscriptLine`/`discoverTranscriptFiles`/`pollTranscripts`/
  `computeStatuses`/`summarizeUsage` untouched, their tests pass unmodified.
- Verified the `Skill` tool_use input field against live transcripts under
  `C:\Users\cdigg\.claude\projects\C--Users-cdigg-git-platonic-ts\`:
  `{"name":"Skill","input":{"skill":"caveman"}}` — field is `skill`, matches the contract.
- `parseToolInvocations` collects every `tool_use` block per assistant message (not just the
  first, unlike `firstBlockOfType`/`parseTranscriptLine`'s `toolName`), returns `[]` for
  non-assistant lines, malformed JSON, blocks missing `name`, or lines with no tool_use blocks.
- `detail` is derived defensively from common input shapes in priority order: `description`
  (Bash), `file_path`/`path`/`notebook_path` basename (Read/Edit/Write/NotebookEdit), `command`
  (Bash fallback), `pattern` (Grep/Glob), `prompt` (Task/Agent) — truncated to 80 chars via the
  existing `truncate` helper. Sampled real transcripts to confirm Bash carries both `command`
  and `description`, Read carries `file_path`.
- Added `ToolInvocation` fields as `T | undefined` (not `field?:`) to satisfy
  `exactOptionalPropertyTypes` — matches the existing `AgentActivity`/`AgentStatus` convention
  in `packages/core/src/index.ts` rather than the shorthand `?:` in the seam doc text.
- Added optional pure aggregator `invocationHistory(invocations, limit?)`: most-recent-first
  slice, capped when `limit` given.
- Gates (transcripts package only): `tsc --noEmit` clean (pre-existing unrelated errors in
  `packages/gitlink` from Track P, outside this fence, left as-is); `vitest run
  packages/transcripts` 24/24 pass (was 15, +9 new); `eslint packages/transcripts` clean.

### Track Q (wave 4) — hook lifecycle by workflow shape (BL-0015)

- Wrote `docs/hook-lifecycle-by-workflow-shape-2026-08-22.md`. Sourced from
  `code.claude.com/docs/en/hooks` + `/hooks-guide` (the `docs.claude.com/en/docs/claude-code/*`
  URLs 301 to `code.claude.com/docs/en/*` — update any stale links).
- The documented event set is ~31 events, not the 9 BL-0015 assumed. Beyond the familiar ones:
  `Setup`, `UserPromptExpansion`, `StopFailure`, `PostToolUseFailure`, `PostToolBatch`,
  `PermissionRequest`, `PermissionDenied`, `SubagentStart`, `TaskCreated`/`TaskCompleted`,
  `TeammateIdle`, `PostCompact`, `FileChanged`, `DirectoryAdded`, `CwdChanged`,
  `WorktreeCreate`/`WorktreeRemove`, `ConfigChange`, `InstructionsLoaded`, `MessageDisplay`,
  `Elicitation`/`ElicitationResult`.
- Two facts that change BL-0004's design: (a) `PostToolUse` fires only on SUCCESS — failures are
  a separate `PostToolUseFailure` event, so the planned wiring silently drops every failed tool
  call; (b) subagents run the SAME configured hooks as the main thread, tagged with `agent_id` /
  `agent_type`, so `PostToolUse` alone already sees wave traffic but with no start/end markers.
- `SessionStart` over-counts: it fires with `source` ∈ startup|resume|clear|compact|fork. One
  terminal session that compacts twice and clears once emits four `SessionStart` events. Record
  `source`, don't count bare starts.
- Subagent frontmatter converts a `Stop` hook to `SubagentStop`; `Stop` is main-thread only.
- Headless (`-p`): subagent frontmatter hooks do NOT run (a `-p` session doesn't count as
  accepting workspace trust); skill frontmatter hooks DO. `PreToolUse` is the documented
  permission mechanism in `-p`, and has a `-p`-only `"defer"` decision value.
- Recommended minimum emitter set for full shape coverage: SessionStart(+source), SessionEnd,
  UserPromptSubmit, PostToolUse, PostToolUseFailure, SubagentStart, SubagentStop, Stop,
  PreCompact. Avoid `MessageDisplay` for logging — unbounded volume, fires while text streams.
- Left explicitly unverified (docs silent, needs BL-0004's log to settle): whether subagent
  events share the parent `session_id`; ordering of `PostCompact` vs `SessionStart(compact)`;
  whether `Notification` fires headless; `SessionEnd` reason for a `-p` exit; whether a
  model-invoked (vs user-typed) skill fires `UserPromptExpansion`. The docs cover none of
  BL-0015's /loop, cron, remote, or Workflow shapes by name.

## Track L — BL-0009 ratchet fixture noise (Wave 4)

- Fixed `countEscapeHatches` in `packages/check/src/ratchet.ts`: `tsDirectives` /
  `eslintDisables` now match against comment trivia only (collected via `ts.createScanner`
  walking the full token stream for `SingleLineCommentTrivia`/`MultiLineCommentTrivia`), not a
  regex over raw source text. A test fixture containing the literal strings "@ts-ignore" /
  "eslint-disable" inside a string literal now counts zero; a real directive comment still
  counts. Exported signature of `countEscapeHatches` is unchanged (Wave 3 Track G still consumes
  it as-is).
- Repo-wide scan after the fix: `tsDirectives` 4→1, `eslintDisables` 7→0 — the dropped 3/7 were
  all fixture-string noise in `packages/check/test/**`. `ratchet.json` updated to
  `tsDirectives: 1, eslintDisables: 0`; `asCasts`/`nonNullAssertions` left untouched (7/23,
  AST-based counts, not in scope of this fix).
- Note for integration: a fresh repo-wide scan right now shows `asCasts: 11` (was 7), from other
  Wave 3/4 tracks' concurrent commits on the shared tree, unrelated to this fix — whoever lands
  last should re-run the scan and bump that baseline component before merging, or `npm run
  check`'s ratchet step will flag a false regression.
- Fence gates (packages/check only) all green: `npx tsc --noEmit` clean for packages/check;
  `npx eslint packages/check` clean; `npx vitest run packages/check` 18/18 passed (added 1 test).
  Whole-repo `npx tsc --noEmit` currently fails on unrelated in-progress files outside this fence
  (`packages/transcripts/src/index.ts`, `packages/init/src/index.ts` — other Wave 4 tracks mid-edit),
  so `npm run check` end-to-end is not green yet, but not from this track's files.

### Track O — usage-range seam (BL-0008)

- `DashboardSnapshot.usage` in `packages/core/src/index.ts` is already fully aggregated
  (`summarizeUsage` output) — no raw `AgentActivity[]` travels to the browser, and `main.ts` is
  outside this fence (Wave 4 O writes `packages/dashboard/src/**` except `main.ts`). So neither
  a client-side re-slice (no per-activity data exists client-side) nor a core-type change
  (frozen this wave) was available. Went server-side, per the task's own fallback option.
- New pure module `packages/dashboard/src/range.ts`: `UsageRangeKey` = `'last-hour' | 'today' |
  'all' | 'last-100' | 'last-500'`, `USAGE_RANGES`, `DEFAULT_USAGE_RANGE = 'today'`,
  `usageRangeLabel`, `parseUsageRange` (unknown/missing value -> default, never throws), and
  `sliceActivitiesByRange(activities, range, now)` — time ranges filter by timestamp
  (`today` uses local-midnight via `Date#setHours(0,0,0,0)`, matching whatever timezone the
  dashboard process runs in), count ranges use `Array#slice(-n)` (no-op when the list is
  shorter than the window — tested).
- `server.ts` grew an **optional** `activitiesProvider?: () => Promise<readonly
  AgentActivity[]>` on `startDashboard`'s options, plus a `?range=` query param on both
  `/api/state` and `/api/events`. When `activitiesProvider` is supplied, the server slices its
  activities by the requested range, re-runs `summarizeUsage` (imported read-only from
  `packages/transcripts`, not reimplemented) over the slice, and splices the result over
  `snapshot.usage` — keeping `outputTokensPerMinute` from the original all-time snapshot
  unchanged, since that figure is a live 5-minute burn rate, not a historical total the range
  selector should touch. When `activitiesProvider` is omitted (current state — see below), the
  route ignores `?range=` and returns the untouched snapshot: fully backward compatible, zero
  breakage for the existing behavior/tests.
- **Integration TODO for the Wave-4 S4 supervisor** (main.ts is out of this fence): `main.ts`
  already keeps the full `activities` array in a closure (see its `provider`). Wiring this
  feature end-to-end is a two-line addition to the `startDashboard({...})` call there:
  `activitiesProvider: () => Promise.resolve(activities)`. Until that lands, the range
  dropdown renders and reconnects correctly but the server has no activities to slice, so
  every range currently returns the same all-time totals — inert but harmless.
- `ui.ts` adds a `<select id="range-select">` next to the Usage heading (options from
  `USAGE_RANGES`/`usageRangeLabel`, default `today` selected to match `DEFAULT_USAGE_RANGE`).
  Selection persistence across SSE pushes: `render()` never touches `#range-select`, so the
  live DOM node (and the user's choice) survives every 2s re-render untouched. Changing the
  dropdown closes the existing `EventSource` and opens a new one at
  `/api/events?range=<value>` — range travels as a per-connection query string rather than a
  message pumped over an already-open stream, which keeps `ui.ts`'s zero-external-request /
  inline-only constraint intact and needed no new protocol on top of SSE.
- Payload growth: none per tick beyond the existing snapshot shape — `usage` is replaced in
  place with the same `UsageSummary` shape, no new top-level fields sent to the browser.
- Tests: `packages/dashboard/test/range.test.ts` (9 tests) — `parseUsageRange` round-trip +
  fallback, `usageRangeLabel` non-empty for every key, and `sliceActivitiesByRange` boundary
  cases (last-hour/today inclusive-start exclusive-just-before boundary, `all` passthrough,
  count ranges both truncating and no-op when `count >= length`).
  `packages/dashboard/test/server.test.ts` gained 2 tests on port 0: `?range=` is a no-op
  without `activitiesProvider`, and re-summarization produces different totals for `all` vs
  `last-hour` with a synthetic 2-activity list once `activitiesProvider` is supplied.
- No `packages/core` edits, no dependency requests, no `packages/dashboard/src/main.ts` edits.
- Gates (this fence): `npx tsc --noEmit` — 2 pre-existing errors, both outside this fence
  (`packages/gitlink/src/index.ts` `CommitSessionLink.confidence` widening, unrelated
  in-progress Wave 4 track P); zero errors touching `packages/dashboard`. `npx eslint
  packages/dashboard` — clean. `npx vitest run packages/dashboard` — 17/17 passed (9 new
  range.test.ts + 8 server.test.ts, 2 of which are new).

### Track P — gitlink seam (BL-0014 library half, Wave 4)

- New package `packages/gitlink` (private, type module, exports `./src/index.ts`).
- Pure library `src/index.ts`: `GIT_LOG_FORMAT` constant documents the git log format string
  (`%H%x1f%aI%x1f%s%x1f%(trailers)%x1e` — records delimited by ASCII 0x1e, fields by 0x1f),
  `CommitInfo` type (hash, ISO timestamp, subject, trailers dict), `parseGitLog(raw): readonly
  CommitInfo[]` (parses git output, skips malformed records, extracts trailers as key:value),
  `CommitSessionLink` type (hash, sessionId?, sessionFile?, confidence: 'trailer'|'time-window'|
  'none'), `correlateCommits(commits, activities): readonly CommitSessionLink[]` (trailer match
  wins; else nearest session activity within ±10 min; else 'none'). Trailer priority: `Session-Id`
  > `Co-Authored-By`. No child_process here, pure derivation with `.map()`/`.filter()` idioms.
- Impure `src/io.ts`: `readGitLog(repoDir): Promise<string>` shells to `git log` via
  `node:child_process` (one edge for caller to run git on demand, pure parsing separate).
- Tests `test/gitlink.test.ts`: 22 vitest cases — GIT_LOG_FORMAT exports (5 checks),
  parseGitLog round-trip and edge cases (8: empty input, single commit, trailers, multiple
  commits, missing fields, whitespace handling, with/without trailers), correlateCommits (9:
  trailer match, Co-Authored-By, priority, time-window ±10min, rejection >10min, closest-win
  tiebreaker, empty inputs, trailer-over-time precedence, readonly arrays), round-trip scenario
  (1 realistic fixture with mixed outcomes).
- No external deps, no `any`/`as`/`!` (except `as const` where TypeScript's type inference
  narrowing didn't go far enough — not the case in final clean code). Pure functional style with
  immutable derivations per the repo's `functional/immutable-data` rule.
- Trailer parsing: defensive extraction via `.map()` over lines, `.filter()` to drop malformed
  (no colon, empty key/value), `.Object.fromEntries()` to build the dict immutably.
- Gates: `npx tsc --noEmit` clean (gitlink only — pre-existing errors outside this fence in
  `packages/init`, unrelated), `npx vitest run packages/gitlink` 22/22 passed, `npx eslint
  packages/gitlink` clean.

### Wave 4 Track M — `platonic init` retrofitter (BL-0010)

New package `packages/init` (`@platonic/init`, private, zero deps beyond `node:*` + a
read-only relative import of `packages/check`). Shape: pure planner (`src/index.ts`), impure
edges (`src/io.ts`), CLI root (`src/main.ts`), profile-parameterized templates under
`src/templates/`.

Plan format decisions worth keeping:

- **Three action kinds, no fourth.** `writeFile` (path + full content), `mergeJson` (path +
  `additions` + `conflicts`), `skip` (path + reason). Every action carries a `reason` string
  so the printed plan explains itself without a second lookup table.
- **Conflicts are data, not prose, and are never applied.** `splitMerge` walks the proposed
  JSON fragment against the target's: missing key -> addition, same value -> vanishes,
  different value -> `{ key: 'compilerOptions.strict', existing, proposed }`. `applyPlan` only
  ever writes `additions`, so a merge can grow a file but never change a value the target
  already chose. Conflicts are re-rendered as `manualSteps`.
- **Non-JSON files get a sidecar, never a merge.** An existing eslint config of any of ten
  known names means the plan writes `eslint.platonic.config.js` instead, plus a manual step.
  Consequence worth knowing: re-running init on a repo init already retrofitted proposes the
  sidecar (init's own `eslint.config.js` now exists). Consistent with never-clobber, mildly
  surprising.
- **`tsconfig` merge proposes strictness flags only** — never `target`/`module`/`lib`. Those
  are the target repo's business and would produce noise conflicts. The full file (with
  `target`/`module`/`lib`) is written only when the target has no tsconfig at all.
- **`observe` is a measurement profile: it installs nothing that can fail.** ratchet baseline
  only — no tsconfig, no eslint config, no npm scripts, no devDependencies. `standard` adds
  strict tsc + type-checked lint + `typecheck`/`lint`/`check` scripts; `full` adds the
  functional subset and the purity bans, with the same three zones this repo uses but
  generalized (`**/main.ts|server.ts|io.ts` for roots, `**/*.test.ts` + `**/test/**` for tests).
- **An existing `ratchet.json` is never rewritten — it becomes a drift report.** The skip
  reason runs `compareToBaseline` and prints `counts ok|improved` or `regressed on asCasts`.
  Re-running `platonic init` is therefore the ratchet check for a retrofitted repo; there is
  no `platonic check` binary to point a script at yet, and the plan does not pretend otherwise
  (installed scripts are plain `tsc --noEmit` / `eslint .` that the target can really run).
- **Nothing is written without `--yes`.** `parseInitArgs` folds `--dry-run || !--yes` into a
  single `dryRun` flag; the plan is always printed first. Default profile is `observe`.

Findings:

- `countEscapeHatches` retrofitted onto a foreign layout with no change, confirming the
  earlier Gratify probe. Only check's `scanRepo` is platonic-ts-shaped (it assumes
  `packages/*/src`), so `io.ts` carries its own walk (skips `node_modules`, `.git`, `dist`,
  `build`, `out`, `coverage`, `.next`, and `*.d.ts`). Candidate for a later BL: give
  `packages/check` a layout-agnostic scanner and delete the duplicate walk.
- `JSON.parse` returns `any`, and `... as JsonValue` would have cost the repo an `asCasts`
  point. Avoided by typing the parse result `unknown` and widening `isJsonObject` to
  `(value: unknown) => value is JsonObject`. Same trick works for `Array.isArray`, which
  widens a `JsonValue` union to `any[]` and trips `no-unsafe-argument` — a
  `(value: JsonValue): value is readonly JsonValue[]` predicate fixes it without a cast.
  Worth generalizing: **strict JSON handling needs zero escape hatches if you own a
  `JsonValue` type and two type predicates.**
- Package adds **0** escape hatches across its 11 files, so `ratchet.json` needs no bump.

Gate results (fence-scoped): `npx eslint packages/init` clean; `npx tsc --noEmit` reports no
errors in `packages/init` (2 pre-existing errors in `packages/gitlink/src/index.ts` from
Track P, untouched); `npx vitest run packages/init` 25/25 passed (13 plan, 7 io, 5 args).
Smoke: dry run against a temp repo with a conflicting `scripts.lint` and `strict: false`
printed a 4-action plan + 4 manual steps and wrote nothing; `--yes` applied it, leaving both
conflicting values intact; a re-run after adding an `as` cast reported
`regressed on asCasts`; the generated `eslint.config.js` parses under `node --check`.

### Track R — dashboard views (BL-0012, BL-0013, BL-0014, Wave 5)

Files: new `packages/dashboard/src/{pie,invocations,commits}.ts` +
`test/{pie,invocations,commits}.test.ts`; modified `server.ts` (+tests), `ui.ts`, `main.ts`.
`DashboardSnapshot` untouched — every new data path travels over its own endpoint with types
local to the dashboard package, per the fence's hard rule.

- **BL-0013 pie charts**: `pie.ts` exports pure `computePieArcs`/`pieSvg`/`colorForIndex` —
  hand-rolled SVG arc math (radians clockwise from 12 o'clock, prefix-sum angles via
  `reduce` so no `push`), tested for angle-sum-to-2π, positive-slice filtering, single-slice
  full-circle path, and XML-escaping of label text. **Not called from server-rendered HTML**:
  the chart must redraw client-side on every SSE push against live snapshot data, and ui.ts's
  inline `<script>` cannot `import` an ES module, so `clientScript` carries a hand-copied
  plain-JS mirror of the exact same formula (`pieSvg`/`pieArcPoint` inside the template
  literal). Only the fixed color palette (`PIE_PALETTE`) is shared for real, injected via
  `JSON.stringify(PIE_PALETTE)` into the client script at render time — the one piece that
  can cross the TS/inline-JS boundary as data instead of code. Flagging the duplication
  explicitly: if the arc formula ever needs a fix, both `pie.ts` and the copy in `ui.ts`'s
  `clientScript` need it. Wired into `render()`: usage-by-model pie (slices = `byModel`
  entries by `outputTokens`) next to `#usage-table`, backlog-by-status pie (all five
  `BacklogStatus` values, including `idea`) next to `#backlog`.
- **BL-0012 invocations**: `pollTranscripts` only returns `AgentActivity` (one record per
  line, collapsed to a single `lastTool` downstream) — not enough for a per-call history, and
  `packages/transcripts` is outside this track's fence anyway. `invocations.ts` re-tails the
  *same* transcript files independently (own `discoverTranscriptFiles` call, own per-file
  byte-offset/remainder state mirroring `pollTranscripts`'s shape exactly) and runs the
  already-exported `parseToolInvocations` over newly appended lines only. Two separate readers
  of the same files, verified independently in tests (tail/shrink/vanish parity with the
  transcripts package's own tests). `main.ts` keeps a second tail state + a capped 2000-entry
  buffer alongside the existing `activities` array; `/api/invocations` serves
  `invocationHistory(invocations, 100)` (most-recent-first). Client polls it via `fetch` every
  4s — a plain same-origin `fetch`, not a new SSE channel, kept separate from the 2s snapshot
  push so the invocation ring buffer never bloats the per-tick SSE payload. Table: time, tool,
  skill (as a highlighted badge when present), detail.
- **BL-0014 commits**: `commits.ts` exports pure `buildCommitRows(commits, links)` merging
  gitlink's `CommitInfo` + `CommitSessionLink` by hash into a flat row (short hash, subject,
  timestamp, session label, confidence) — session label prefers `sessionId`, falls back to
  `sessionFile`, else `undefined`. `main.ts`'s `commitsProvider` shells to `readGitLog` +
  `parseGitLog` + `correlateCommits` fresh **on every request** (no caching), matching the
  task's "refresh server-side per request" instruction — `/api/commits` is a plain GET, not
  SSE. `correlateCommits`'s activity param type uses bare optional fields (`sessionId?:
  string`, not `T | undefined`) under `exactOptionalPropertyTypes: true`; assigning
  `sessionId: possiblyUndefined` there is a type error, so `toCorrelationActivity` builds the
  object via conditional spread (`...(x === undefined ? {} : { x })`) rather than ever writing
  `sessionId: undefined` — same pattern Track K documented for `HookEvent` in Wave 4. Client
  polls `/api/commits` every 5s; confidence renders as a 3-way badge (trailer / time-window /
  none) with distinct colors matching the existing badge/dot color language in `ui.ts`.
- No `packages/core` edits (fence's hard rule honored — every new type is local to
  `packages/dashboard`: `PieSlice`/`PieArc` in `pie.ts`, `InvocationTailState` in
  `invocations.ts`, `CommitRow` in `commits.ts`). No new runtime dependencies. `server.ts`
  gained two more **optional** providers (`invocationsProvider`, `commitsProvider`) following
  the exact pattern Track O set for `activitiesProvider` — omitted means the route 404s,
  fully backward compatible with any caller that doesn't supply them.
- Commit granularity note: implemented and gated all three features before the first commit
  (interleaved edits to shared `main.ts`/`server.ts`/`ui.ts` rather than three cleanly
  separable diffs), so — unlike the "commit after each feature" checkpoint instruction —
  this landed as a single commit covering all three. Each feature's own new files
  (`pie.ts`/`invocations.ts`/`commits.ts` + their tests) are cleanly separable in the diff by
  filename if a future split is wanted.
- Did not push (repo convention across every wave's fence table reserves push for the
  supervisor track; this track's own instructions specify commit only).

Gate results (this fence): `npx tsc --noEmit` — clean, no errors touching
`packages/dashboard` (or anywhere else at the time of this check). `npx eslint
packages/dashboard` — clean. `npx vitest run packages/dashboard` — 40/40 passed (8 new
pie.test.ts, 4 new invocations.test.ts, 5 new commits.test.ts, 6 new server.test.ts cases for
the two new endpoints, plus the 9 range.test.ts + 8 pre-existing server.test.ts cases
unchanged).

### Track T — hook tail seam (BL-0004 read half, Wave 5)

- New module `packages/hooks/src/tail.ts`: incremental reader for `.claude/events/events.jsonl`.
- Exports: `HookTailState` type (opaque), `createHookTailState(): HookTailState`, `pollHookEvents(file: string, state: HookTailState): Promise<{ readonly state: HookTailState; readonly events: readonly HookEvent[] }>`.
- Pattern matches `packages/transcripts` TailState exactly: per-file state tracks byte offset + partial-line remainder; poll reads only appended bytes since last offset, splits lines via existing `splitJsonlChunk` from core, parses via existing `parseHookEventLine`, skips malformed lines (undefined -> filtered out).
- Missing file: no throw, returns empty events, drops file from state (if present).
- File truncation (size < offset): resets offset to 0, clears remainder, re-reads from start.
- Partial lines held in remainder until next poll completes them (\\n newline finishes a line).
- Immutable derivations: Map rebuild via spread + filter (missing) or spread + new entry (appended), no mutation.
- Re-export from `src/index.ts` alongside `HookEvent`, `parseHookEventLine`, `formatHookEvent`.
- Tests: `packages/hooks/test/tail.test.ts` (8 tests) — missing file ok, read from new file, append-then-poll incremental, partial line held then completed, malformed-line skip, truncation reset, remainder preservation across multi-chunk partial, empty-line tolerance. Uses temp dir (node:os tmpdir).
- No external deps (node:fs/promises, node:path, core's splitJsonlChunk only).
- Gate results (this fence): `npx tsc --noEmit` clean for packages/hooks; `npx vitest run packages/hooks` 25/25 passed (17 existing + 8 new); `npx eslint packages/hooks` clean (immutable-data and no-unsafe-assignment enforced).

## Wave 3 — BL-0016 code overview browser (`packages/codemap`, `packages/codeview`)

Five fenced tracks built on stubs the supervisor landed first. Every track kept its signature;
the only integration defects were two the supervisor's own seam spec left ambiguous, both
listed below. Findings by track.

### Track F — symbol index (`codemap/src/symbols.ts`, `codemap/src/io.ts`)

- **`ts.getCombinedModifierFlags` needs bound parent pointers, and caches the wrong answer
  without them.** It walks parents to find the `export` on the `VariableStatement` two levels
  above a `VariableDeclaration`. On an unbound program file every `export const` in the repo
  came back `exported: false` — and the wrong `0` is cached on the node, so it stays wrong
  after binding. Correctness silently depended on whether the checker had been created yet.
  Fixed by making `extractSymbols` parent-independent (`ts.canHaveModifiers`/`ts.getModifiers`,
  which are syntactic and uncached) and threading the statement's export flag down the walk.
  `indexRepo` also creates the checker up front, which binds every file eagerly.
- `node.getChildren(sourceFile)` was chosen over `ts.forEachChild` because the latter only
  reports through a callback and forces a mutable accumulator. The cost is materializing token
  nodes; measured worth it.
- Measured on this repo (100 files, 3531 symbols, 8854 references): ~1.9s cold. Phase split
  roughly `buildProgram` 1.0s, `extractSymbols` 70ms, `getTypeChecker()` 180ms, references
  480ms. Under concurrent-agent load the whole thing inflates about sixfold and uniformly —
  machine contention, not a hot spot.
- Import specifiers count as references, so an imported name yields the specifier plus each use
  site. Deliberate: the browser wants the import line clickable.
- Overloads and merged declarations: only the declaration `valueDeclaration`/`declarations[0]`
  points at is marked `isDefinition`. This repo has no overloads; a repo with them would see a
  declaration name marked `isDefinition: false`.
- Symbol kinds actually present repo-wide: `variable`, `property`, `function`, `type`. Zero
  classes, interfaces, enums, methods — the style guide holding. Those code paths are covered
  by synthetic-source unit tests rather than by real data.
- `metrics: undefined` on markdown entries disappears through `JSON.stringify`, so a
  `FileEntry` round-trips as a missing key rather than a present-undefined one. Equivalent for
  `=== undefined`, not for key-existence checks, and `exactOptionalPropertyTypes` says
  otherwise in the type.

### Track G — metrics and the platonic score (`codemap/src/metrics.ts`)

- Score is `round(clamp(100 - sum of weight x value))` over an explicit penalty table, each
  entry naming the PS rule it maps to. Rate penalties normalise per 100 lines with a 40-line
  floor, so a big clean file does not lose to a small dirty one. Observed over 55 files at the
  time: median 86, best 100, worst 39.
- **The score is zone-blind, and that is the single biggest source of unfair numbers.**
  `CodeMetrics` carries no zone, so Root files are penalised for the `let` and nesting that
  PS-020/PS-004 explicitly permit there, and Test files for the `throw` PS-003 permits and for
  a statement density inherent to `expect(...)` assertions. `codeview/src/server.ts` at 61 and
  every test file are artefacts of this, not signal.
- **PS-024 and PS-025 do not survive summation.** They are per-file ceilings; once files are
  summed into a folder the file count is gone and the terms saturate into "this aggregate is
  big". Bounded as fractions to cap the damage at 30 points. Measuring them properly at folder
  level needs a per-file distribution on `FolderEntry`, not a summed `CodeMetrics`.
- `sumMetrics` takes the **max** of `maxNestingDepth` rather than summing it; summed depths
  across dozens of files are uninterpretable and would peg every folder to zero.
- Per-function escape hatches re-parse the function's own text (`countEscapeHatches` is a text
  function), wrapping the fragment so it parses standalone.
- Not mechanically measurable from an AST alone: PS-023 (needs the cross-package import graph),
  PS-033/041/047 (need a name lexicon), PS-042/043/048/049/051 (need type and call-graph
  information — `functionMetrics` has a `SourceFile`, not a `Program`), PS-055, PS-056 (needs
  commit context). PS-021/022/026/027/028/029/030/031 are all cheap additions left out only to
  keep the table small.

### Track H — server and feedback sink (`codeview/src/server.ts`, `codeview/src/io.ts`)

- **`packages/dashboard/src/server.ts` has a latent hang**: its `close()` never calls
  `server.closeAllConnections()`, so a leaked keep-alive socket can make `server.close()` wait
  forever. It works today on undici timing luck. codeview does call it.
- Body caps need two checks: an early `content-length` reject and a streaming byte counter for
  chunked or absent headers. An oversized body must be **drained**, not destroyed — destroying
  the socket loses the 413 response.
- **Backlog titles must be single-line.** `parseBacklogFile` splits frontmatter on the first
  newline, so a multi-line title silently corrupts the item. The sink collapses whitespace and
  truncates to 72 characters. Now written into the seam.
- Id allocation reads filenames, not frontmatter, so one directory read suffices and a
  corrupt-frontmatter file still reserves its number. Two concurrent posts could collide on an
  id; acceptable for a single-user local tool, worth naming if feedback ever goes concurrent.
- `FeedbackResult.file` returns a native path (backslashes on Windows) while everything in
  `CodeIndex` is forward-slash repo-relative. Two path conventions in one API.
- `packages/backlog/src/index.ts` imports core with a `.js` extension while every other package
  uses `.ts`. Both resolve under Bundler resolution; the repo is just inconsistent.

### Track I — the page (`codeview/src/ui.ts`)

- **`SymbolReference` carries no name or signature.** When a reference points into a file that
  is not on screen, `FileView.symbols` has no entry for it, so the pane can only show a raw id.
  Cross-file navigation currently loads an entire `FileView` — source HTML included — just to
  learn a symbol's name. Wants either fields on `SymbolReference` or a `{ symbol, references }`
  envelope, plus a single-symbol endpoint.
- **The index endpoint serializes to about 2.1 MB** on this repo, and the UI discards its
  `symbols` and `references` fields entirely — it fetches per file. A trimmed index would be
  strictly better; harmless only because the repo is small.
- `FolderEntry` has no parent/child links, so the tree is rebuilt client-side by splitting
  `FileEntry.file` on `/` and joining against `folders` by path string — the client re-deriving
  structure the indexer already knew.
- `FeedbackResult` cannot confirm what was filed beyond an id; no path to open, no echo of the
  file/symbol context.
- Error bodies are `{ error: string }` throughout. Now written into the seam.

### Track J — rendering (`codeview/src/render.ts`)

- **Recursion per token overflows the stack at roughly 700 source lines.** The first
  implementation followed the recursion pattern in `packages/check/src/ratchet.ts` and threw a
  `RangeError` on a 1000-line file. Replaced with cursor-driven loops and a binary search to
  locate a line's tokens: 50k lines highlight in about 220ms and render in about 320ms.
- **The same latent bug was live in `ratchet.ts` itself** and the supervisor hit it at
  integration — see below.
- Scanner warts, classification only, never affecting the byte-exact cover: template literals
  with substitutions lose their framing after the first closing brace, and regex literals scan
  as a slash punctuation token because there is no rescan pass.
- Security: all text is escaped before any inline pass, so raw HTML can never pass through, and
  link and image URLs outside `http`/`https`/`mailto` are left as escaped text.
- Markdown deliberately unsupported, all degrading to escaped plain text: setext headings,
  reference links, footnotes, task-list checkboxes, two-space hard breaks, autolinks, lazy list
  continuation, emphasis inside link text, table column alignment, and a table not preceded by
  a blank line.

### Supervisor — integration

- **Two seam ambiguities, both the supervisor's fault, both invisible until the panes met.**
  CONTRACTS.md said tokens carry `class="token-<class>"` but never specified the per-line
  markup; Track I built CSS against bare `.keyword` and `.line`, Track J emitted `.token-keyword`
  and `.code-line`. Everything typechecked, every test passed, and syntax colouring was simply
  dead. Fixed by moving the UI onto the renderer's actual markup and writing the full markup
  contract into the seam. The lesson: a seam expressed only as TypeScript signatures does not
  constrain the strings crossing it. HTML class names are an interface and need the same
  treatment as a function signature.
- **`collectCommentText` in `packages/check/src/ratchet.ts` recursed once per token** and
  overflowed at about 26 KB of source (`packages/dashboard/src/ui.ts`). It failed as a function
  of the caller's own stack depth, so `platonic check` passed while the identical call from
  `packages/codemap` threw — a green gate sitting over a real defect. Rewritten as a cursor.
- End-to-end verified against the live server on 4848: cross-file go-to-definition (`truncate`
  in `codemap/src/symbols.ts` to `core/src/index.ts`, 10 references), markdown with frontmatter
  stripped, 404 on an unknown path, 400 on traversal, and the feedback box filing a real
  backlog item (removed afterwards).

### Incremental indexing and file watching

- **A rebuild after one edit costs 50ms where a full index costs 1.6s**, and the two produce the
  same index. Three separate savings, measured on this repository: handing the compiler its
  previously parsed source files plus the old program takes program construction from 740ms to
  9ms; declarations and metrics are recomputed only for changed files; references are
  recollected only for the changed files plus the files that referred into them.
- **The reference rule is the only subtle part.** A reference recorded in an unchanged file is
  still true unless the declaration it points at moved, so the rewalk set is the changed files
  plus every file that referenced one of them. Nothing outside that set can gain or lose a
  reference, because a file refers to something new only when its own text changes.
- **A full index is now an update that treats every file as changed**, so both paths run one
  code path and the incremental path cannot drift from the full one.
- **The timestamp scan is cheap enough to stay the authority**: 3ms over 143 files. File
  watching is layered on top rather than trusted alone — it coalesces events, names directories
  instead of files on some platforms, and is not available recursively everywhere. Writes made
  by the MCP server's own edit tools are recorded directly, since a notification need not arrive
  before the next call does.
- **Measured through the MCP server**: first call 2.4s, steady state 4ms, first call after an
  external edit 65-91ms (it was a full rebuild before).

### Size distributions (BL-0027)

- **`ts.isExpression` classifies by syntax kind, not by position.** Every declared name,
  property name, and identifier inside a type annotation answers true, so a population of
  "all expressions" has a median of one node in any codebase. Restricting to expressions
  whose parent is not an expression does not help — those names are precisely the nodes with
  non-expression parents. Requiring more than one node removes them, and avoids depending on
  `ts.isExpressionNode`, which exists at runtime but is not in the compiler's public typings.
- **A function body block is not a statement**, by the compiler's own definition, so counting
  every `ts.isStatement` node does not double count a body against the statements inside it.
  This is what makes `metrics.ts`'s statement count meaningful, and it is now asserted by a
  test rather than assumed.
- **Sizes must be accumulated bottom-up.** Calling `subtreeNodes(node).length` at every node
  re-walks each subtree once per ancestor. `sizedNodes` in `walk.ts` returns every node paired
  with its own subtree size from a single pass; the whole repository (117 files, 21877
  expressions) reports in a couple of seconds.
- **Zone partitioning changes the reading, as BL-0017 predicted.** Core functions have a
  median length of 7 lines and Root functions 10; test functions run half the length of Core
  but their statements are the densest in the repository. The pooled median describes none of
  the three.


## Wave 5 — refactoring tools for the MCP server

Eight tracks, one shared worktree, disjoint fences. Everything below came back from a track
that hit it; the supervisor appended it verbatim or lightly edited.

### The contract that made it parallel

`Workspace` is deliberately unbound — files are parsed without a checker, which is what makes
the existing tools fast. Most of the new tools need the checker, so `compiler.ts` landed first:
a `Compiler` is the workspace plus a TypeScript program and language service over the same
texts, and `toFileEdits` converts what the language service computes into the existing
`FileEdit` shape. Eight tracks then built against it without meeting, and the assembly
typechecked on first integration.

Two things cost real debugging and are now settled once:

- **A file-only language-service host resolves nothing.** Module resolution walks directories
  before it looks at files, so a host that answers `fileExists` but not `directoryExists`
  reports `TS2307` for every import. The directories are derived from the file paths.
- **The language service throws on a file the program does not contain.** `Could not find
  source file` escapes rather than returning a failure — it takes the server down instead of
  declining. Every entry point gates on `boundSourceFile(file) !== undefined` first.

### Overlapping edits corrupt files silently (Tracks C and F)

`applyEdits` sorts back to front and reduces, so an edit whose range contains another lands
second and overwrites it, carrying the text the first edit already replaced. Nothing about the
failure is visible in the result — the file is simply wrong. It is not theoretical: Track F hit
it on `twice(twice(1))`, where two call sites nest, and the compiler's own import edits replace
a whole import block as one span, which overlaps anything else editing that region.

Two tracks derived the same range rule independently. It now lives once, beside `applyEdits`,
and `writeEdits` checks it — which covers every write tool including the three that predate
this wave.

### An import is a reference (Tracks E, F, G)

`collectReferences` records `import { x } from …` and `export { x } from …` clauses with
`isDefinition: false`, identically to a real call. A tool that treats every non-definition
reference as a use reports each importing module as a caller of everything it imports, and each
test file's import line as a test. Every reference-walking tool filters ancestors for
`ImportDeclaration`/`ImportEqualsDeclaration`/`ExportDeclaration`. This belongs in the index's
own documentation — every future tool over `references` hits it.

### The nearest named declaration is the wrong owner (Track G)

Resolving a reference to the innermost *named* declaration gives, in this codebase's style,
almost always a local `const`. On the real repository `callers of resolveSymbol` returned 80
"callers" that were local variables calling their siblings. Restricting owners to declarations
with a body cut it to 22 real ones and made it five times faster. Pure-functional style with
heavy local `const` use makes this failure mode much louder here than it would be elsewhere.

### The compiler generates code this repository bans (Tracks B and F)

`fixMissingFunctionDeclaration` emits `throw new Error(…)`, which PS-003 forbids.
`Convert named export to default export` — the most commonly applicable refactoring here —
produces a default export, which PS-022 forbids. Both are reachable through `apply_code_fix`
and `apply_refactor`, and both are noted in those tools' descriptions rather than filtered,
since the caller may have a reason.

Related: `fixName` is not a unique key. Two importable modules produce two fixes both named
`import`, distinguishable only by description, so `apply_code_fix` declines on multiple matches
even when given a name. And a plain type error (`TS2322`) offers no fixes at all, so an empty
result from `code_fixes` is the common case rather than an error.

### What `revert` cannot undo (Track D)

`EditPlan` expresses replacements, not file creation or deletion, so `revert` can never undo a
refactoring that added or removed a file — which includes what `move_symbol` and `rename_file`
do. It refuses the whole restore and names the files rather than half-undoing, because a
partial revert leaving a new file behind is the failure the tool exists to prevent. Extending
`EditPlan` with create and delete variants is the change that would lift this.

`restorePlan` computes each edit's `end` from the **current** text, never the snapshot.
`writeEdits` compares against the indexed text before writing, so a snapshot-derived `end`
truncates every file that grew and overruns every file that shrank. Two tests assert the
direction so a swap fails loudly rather than corrupting files.

### Smaller findings

- `typeToString` prints an alias's name back at you: asking for the type of `Point` answers
  `type Point`. `InTypeAlias`, applied only when the parent is a type-alias declaration,
  expands the shape while leaving `typeOf` on a *value* of type `Point` saying `Point`.
- Inherited-member attribution must compare against the type's own name, not the looked-up
  name; using the lookup name marked every member of `const point: Point` as inherited.
  `ts.Symbol.parent` is internal, so ownership walks `declaration.parent` instead.
- `formatSettings` does not rewrite `.ts` specifiers to `.js` despite
  `importModuleSpecifierEnding: 'js'`. Generated imports arrive in house style already.
- `organizeImports` returns no changes for an already-tidy file, so an empty edit list is the
  reliable "nothing to do" signal.
- Two texts differing only in their trailing newline split into identical line arrays, so a
  line diff of them vanishes. `unifiedDiff` converts the final context line into a
  delete/insert pair, which is what git prints.
- Removing an import and adding one in the same file overlap unless fused: the natural
  implementation anchors the insertion inside the range it is deleting. The emptied statement
  is *replaced* by the new ones instead.
- `getApplicableRefactors` depends on surrounding text, not just the declaration — the same
  declaration answered differently in two fixtures that differed only in later statements.
  Do not write golden tests against the full refactor list.
- The catalogue costs about 4,800 tokens on every request, for 33 tools. A test holds a
  ceiling on it, because the cost is continuous and the benefit is per-use.
