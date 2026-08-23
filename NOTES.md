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
