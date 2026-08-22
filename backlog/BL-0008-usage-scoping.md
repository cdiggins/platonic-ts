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

## Done means
- [ ] range selector control added to the dashboard UI
- [ ] usage totals and per-model table both respect the selected range
- [ ] default range is sensible (e.g. "today") without losing access to all-time
