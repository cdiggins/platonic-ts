---
id: BL-0004
title: Claude Code hooks emit events
type: feature
status: ready
priority: p3
effort: M
risk: med
area: dashboard
sprint:
created: 2026-08-22
closed:
links: []
---
PostToolUse/SessionStart hooks appending JSONL for dashboard.

## Done means
- [ ] PostToolUse hook appends a JSONL event line per tool call
- [ ] SessionStart hook appends a session-start event line
- [ ] dashboard reads the new event stream without breaking existing transcript parsing
- [ ] `npm run check` passes
