---
id: BL-0024
title: Daily metrics rollup + KPI glance page; invocation table moves to second page
type: feature
status: ready
priority: p2
effort: M
risk: low
area: dashboard
sprint:
created: 2026-08-23
links: []
---

## Goal
Dashboard landing page answers "how much work did agents do, what did it cost, is it
getting better" at a glance — KPI tiles with trends, no tables. The raw invocation
table (BL-0012) moves to a second page reached by clicking through; it becomes
evidence for digging, not the landing view. End goal: metrics feed continuous
improvement, self-guided or via the human operator.

## Key finding that shapes the design
[main.ts:104](packages/dashboard/src/main.ts:104) tail-polls from byte offset 0 at
process start, so the **full transcript history is re-read into memory on every
dashboard launch**. That means v1 needs **no persistence file**: daily rollups are a
pure recompute over the in-memory `activities` / `invocations` / commit lists the
composition root already holds. A snapshot JSONL only becomes necessary if/when
transcript files get pruned — deferred, noted under Approaches.

## Data available today (no new parsing needed for v1)
- `AgentActivity` — timestamp, sessionId, model, toolName, isSidechain,
  input/output/cacheRead/cacheCreation tokens
  ([core/src/index.ts](packages/core/src/index.ts)).
- `ToolInvocation` — timestamp, sessionId, tool, skill, detail
  ([transcripts/src/index.ts:180](packages/transcripts/src/index.ts:180)).
- `CommitRow` — hash, timestamp, sessionLabel, confidence
  ([dashboard/src/commits.ts:8](packages/dashboard/src/commits.ts:8)).

Not available yet: tool errors. `parseToolInvocations` reads only `tool_use` blocks;
`tool_result` (`is_error`) lives on user-type lines. Error-rate KPI is v2 (below).

## Design

### 1. `packages/dashboard/src/rollup.ts` — pure module
Same posture as [range.ts](packages/dashboard/src/range.ts) /
[commits.ts](packages/dashboard/src/commits.ts): pure functions, no IO, unit-tested.

```ts
export type DailyRollup = {
  readonly date: string                 // YYYY-MM-DD, local time (matches range.ts startOfDay)
  readonly sessions: number             // distinct sessionIds active that day
  readonly invocations: number
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens: number
  readonly cacheCreationTokens: number
  readonly sidechainOutputTokens: number   // isSidechain slice of outputTokens
  readonly outputTokensByModel: readonly { readonly model: string; readonly tokens: number }[]
  readonly invocationsBySkill: readonly { readonly skill: string; readonly count: number }[]
  readonly commits: number              // commits whose timestamp falls on that day
}

export const computeDailyRollups = (
  activities: readonly AgentActivity[],
  invocations: readonly ToolInvocation[],
  commits: readonly CommitRow[],
  days: number,                          // how many trailing days, ending today
  now: number,
): readonly DailyRollup[]
```

Derived KPIs are separate pure helpers over `DailyRollup` (not stored fields, so the
formula can change without touching the rollup shape):
- `tokensPerCommit(r)` — output tokens / commits; `undefined` when commits = 0
  (render "–", never divide-by-zero or fake infinity).
- `cacheHitRatio(r)` — cacheRead / (cacheRead + input); `undefined` when denominator 0.
- `sidechainShare(r)` — sidechainOutput / output; `undefined` when output 0.
- `weakModelShare(r)` — non-Fable/Opus output tokens / output; measures whether
  weak-model delegation (bootstrap plan goal) actually happens.

Array-of-pairs over `Record<string, number>` for by-model/by-skill: deterministic
order (sorted desc by value) for stable rendering and stable test assertions.

### 2. API — `GET /api/metrics?days=N`
New optional `metricsProvider` on `startDashboard` options, exactly the
[server.ts](packages/dashboard/src/server.ts) pattern for invocations/commits:
absent → 404. Returns `readonly DailyRollup[]` (oldest→newest, so sparklines read
left-to-right). `days` clamped to [1, 90], default 14. Provider closes over the
composition root's `activities`/`invocations` and calls `commitsProvider` — the
commit list is already re-read per request (BL-0014 decision), reuse that.

### 3. `packages/dashboard/src/spark.ts` — sparkline geometry
Pure SVG path computation (points → polyline path string, min/max normalization,
flat-line and single-point cases), mirroring the [pie.ts](packages/dashboard/src/pie.ts)
arrangement: TS module is the tested source of truth, inline JS copy in
[ui.ts](packages/dashboard/src/ui.ts) with a comment naming that fact (inline
script can't import ES modules — same reason as the pie copy).

### 4. UI — two pages
- `/` (glance): KPI tile row at top. Six tiles, each = big number for today +
  14-day sparkline + trend arrow vs prior day: sessions, invocations, output
  tokens, commits, tokens/commit, cache-hit %. Existing pies/agents/backlog
  sections stay below. Invocation table REMOVED from this page.
- `/invocations` (dig): the current invocation table with its pager, plus a back
  link. Server route serves a second rendered page (`renderInvocationsPage()` in
  ui.ts); the tile row's "invocations" tile links here.
- Two full pages over client-side tabs: URL is bookmarkable/sharable, no
  toggle-state to persist, and SSE stays scoped to the glance page (the
  invocations page can poll `/api/invocations` on an interval — it already
  re-fetches today).

## Design decisions
- **Recompute vs persist** — recompute-in-memory wins for v1 (see key finding).
  Persist-to-JSONL deferred until transcript pruning is real; when it comes, write
  one line per closed day into `metrics/daily.jsonl` and merge at startup —
  the `DailyRollup` shape is the file format, so nothing above the rollup module
  changes.
- **Where derived KPIs compute** — server sends raw rollups only; client computes
  ratios for display. Keeps the API additive (new derived metrics need no endpoint
  change) — but the ratio helpers live in rollup.ts and are tested there; the
  inline-copy rule applies.
- **Local-time day bucketing** — matches `startOfDay` in range.ts ("today" filter);
  operator thinks in local days. UTC would misalign the tile row with the existing
  Today range.
- **Second page vs optional toggle** — page. Toggle = hidden state, page = URL.

## v2 (separate items when picked up)
- Error-rate KPI: extend transcripts parsing to read `tool_result.is_error` from
  user-type lines; per-tool error counts join the rollup.
- Thrash detector: same tool + same detail N× in a row within a session = one
  thrash episode; count per day; top sessions listed for review.
- Wasted-run list: sessions above a token threshold with zero correlated commits.
- Ratchet snapshots: once persistence lands, trend arrows over weeks not days;
  agent-readable so self-guided improvement can consume the same file.

## Build plan (milestones, each commit-able)
1. `rollup.ts` + tests (pure; largest test surface, zero integration risk).
2. `/api/metrics` endpoint + server test (provider-absent → 404, clamp, shape).
3. `spark.ts` + tests; tile row on `/` with inline copies.
4. `/invocations` page; remove table from `/`; link from tile.

Milestones 1–2 and 3 are fence-separable (rollup/server vs spark/ui) if run as a
parallel wave; milestone 4 depends on 3.
