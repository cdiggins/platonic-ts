---
id: BL-0013
title: Pie charts for usage/backlog breakdowns, live-updating
type: idea
status: idea
priority: "?"
effort: "?"
risk: "?"
area: dashboard
sprint:
created: 2026-08-22
closed:
links: [BL-0008]
---

## Idea
Add pie-chart visuals to dashboard, updating live as new snapshots arrive — not a
one-time render. Interpreting "dynamically updated as the system is upgraded" as: chart
redraws on every SSE push (same mechanism all existing tables already use), tracking
whatever the underlying data is at that moment as agents run and backlog state changes —
not a claim about the chart code itself changing across dashboard releases.

## Assumptions
- [ui.ts:1](packages/dashboard/src/ui.ts:1) states "zero external requests" as a hard
  constraint (inline CSS/JS, `EventSource` only) — no charting library, must be hand-rolled
  inline SVG.
- `render(snapshot)` at [ui.ts:58](packages/dashboard/src/ui.ts:58) already re-runs in full
  on every `/api/events` push ([server.ts:42](packages/dashboard/src/server.ts:42) ticks on
  `pollIntervalMs`) — a pie chart is just one more thing `render()` draws, no new update
  mechanism needed. "Dynamically updated" is free once data is wired in.
- Candidate data already in `DashboardSnapshot` needs no core-type change: `usage.byModel`
  ([core/src/index.ts:46-53](packages/core/src/index.ts:46), token share per model) and
  backlog counts by `status`/`type` (already grouped client-side via `STATUS_ORDER` at
  [ui.ts:39](packages/dashboard/src/ui.ts:39)).

## Design decisions
- Chart tech — hand-rolled inline SVG `<path>` arcs (matches zero-dep doctrine, small code)
  vs `<canvas>` (imperative redraw, harder to keep declarative with `innerHTML` pattern used
  elsewhere) vs pull in a charting library (violates stated zero-external-requests rule).
  SVG is the only option consistent with current file.
- What to chart — model token-share (`usage.byModel`, input+output per model) vs backlog
  status/type breakdown vs both as separate small pies. Token-share pie sits naturally next
  to the existing `#usage-table`; backlog pie next to `#backlog` section.
- Redraw strategy — full DOM replace of the `<svg>` (matches existing `innerHTML = ''` +
  rebuild pattern used for every other section in `render()`) vs diffing individual `<path>`
  elements. Full replace is consistent with rest of file and pie charts are cheap to redraw.

## Related
- [BL-0008](backlog/BL-0008-usage-scoping.md) — range-scoped usage view; once that lands,
  the usage pie should reflect the selected range, not just all-time totals. Sequencing:
  land range scoping first, or pie chart will need its own range awareness later.

## Approaches
Short term:
- Add a small inline-SVG pie-chart helper (compute arc paths from an array of
  `{label, value}`) in `ui.ts`, call it once for `usage.byModel` token share.
- Reuse same helper for backlog status/type counts.

Long term:
- Generalize the helper into a small chart module if more chart types get requested
  (bar, sparkline) — but no evidence yet that's needed; one pie helper covers this idea.

Adjacent ideas worth their own item:
- Sparkline of `outputTokensPerMinute` over time (trend, not just current snapshot) — pie
  charts show a static breakdown, a time-series view is a different need.

## Bedrock
No core contract change — `usage.byModel` and backlog status grouping already flow through
`DashboardSnapshot` unchanged; this is presentation-only on top of an existing seam.
Verdict: **simplest wins** — a self-contained SVG-drawing function added to `ui.ts`, no
`packages/core` or `packages/transcripts` change needed.

## Simplest possible implementation
One pure function `pieSvg(slices: {label, value, color}[]): string` returning an inline SVG
string, called from `render()` for `usage.byModel`, inserted into a new `<div id="usage-pie">`
next to `#usage-table`.
- Get: live-updating visual breakdown of token usage by model, zero new dependencies or
  transport, consistent with existing full-redraw render pattern.
- Give up: no interactivity (tooltips/click-to-filter) in first pass; colors need a small
  fixed palette picked up front since there's no charting-lib default to lean on.
