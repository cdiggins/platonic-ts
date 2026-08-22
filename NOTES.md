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

### Supervisor — wave 1 setup

- Dashboard reads Claude Code transcripts directly (passive session-log parsing) rather than
  requiring hooks — matches deliverable-ideas' "turn on C passively day one". Hooks come later.
