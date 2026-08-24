# packages/gitlink/src

Correlates git commits to the agent sessions that produced them, for the dashboard's commit
view.

| File | Purpose |
|---|---|
| `index.ts` | Pure parsing and correlation: turns raw `git log` output into `CommitInfo` records and matches each commit to a session by trailer (`Session-Id`, `Co-Authored-By`) or, failing that, a ±10-minute activity-time window. |
| `io.ts` | Runs `git log` with the delimiter format `index.ts` expects and returns its raw stdout. |
