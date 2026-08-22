---
id: BL-0008
title: Scope usage view to selectable time range
type: feature
status: ready
priority: p3
effort: S
risk: low
area: dashboard
sprint:
created: 2026-08-22
closed:
links: [BL-0007]
---
Usage totals are all-time; mixing old sessions with current work hides today's burn.
Add a range selector (last hour / today / all) applied to usage + per-model tables.

Widened 2026-08-22: also support an item-count range (e.g. "last 100 activities") as an
alternative to time-based windows — useful when activity is bursty and a time window either
over- or under-includes. `outputTokensPerMinute` in
[packages/core/src/index.ts:132](packages/core/src/index.ts:132) already takes a `windowMs`
+ `now`, so time-range plumbing exists; a count-range variant would slice the underlying
`AgentActivity` list by index instead of timestamp before feeding the same summarizers.

## Design decisions
- Range unit: time window (last hour/today/all) vs item-count window (last N activities) vs
  both, user-selectable. Time is simpler for "what happened today"; count is more robust
  when activity bursts make a time window misleading. Doing both means one selector with a
  unit toggle, not two separate controls.

## Done means
- [ ] range selector control added to the dashboard UI
- [ ] usage totals and per-model table both respect the selected range (time-based)
- [ ] default range is sensible (e.g. "today") without losing access to all-time
- [ ] item-count range option available alongside time range (e.g. "last N activities")
