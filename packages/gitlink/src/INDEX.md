# packages/gitlink/src

Correlates git commits to the agent sessions that produced them, for the dashboard's commit
view.

<!-- BEGIN GENERATED: src-index (npm run docs:regen) -->
| File | Purpose |
|---|---|
| `index.ts` | Pure library for correlating git commits to agent sessions. Parsing and correlation logic; IO in io.ts. |
| `io.ts` | Impure I/O for reading git log. The pure parsing library (index.ts) is independent and can be tested without git access. |
<!-- END GENERATED -->
