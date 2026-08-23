---
id: BL-0007
title: Dashboard polish - subagent transcripts, readable labels, session scoping
type: debt
status: done
priority: p2
effort: M
risk: low
area: dashboard
sprint:
created: 2026-08-22
closed: 2026-08-22
links: []
---
Found by using the live dashboard:
1. Watch per-session task transcript dirs (%LOCALAPPDATA%\Temp\claude\<proj>\<session>\tasks\*.output) - needs recursive/glob discovery.
2. Readable agent labels (transcript carries custom-title / last-prompt line types) instead of session UUIDs.
3. Scope usage view to a selectable time range instead of all-time totals.
