# Notes — findings that must feed back into the design

Agents: append findings here (contract friction, surprises, perf numbers).
This file is a first-class deliverable alongside the code.

## Contract changes

- 2026-08-22 S: pnpm not installed on this machine; using npm workspaces instead of the
  tooling-catalog shortlist's pnpm. Revisit if fence-by-package needs pnpm's stricter isolation.

## Findings

### Supervisor — wave 1 setup

- Dashboard reads Claude Code transcripts directly (passive session-log parsing) rather than
  requiring hooks — matches deliverable-ideas' "turn on C passively day one". Hooks come later.
