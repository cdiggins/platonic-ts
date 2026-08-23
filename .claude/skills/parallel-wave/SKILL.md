---
name: parallel-wave
description: Run a multi-subagent development wave on one shared checkout — a supervisor splits a feature into fenced parallel tracks, lands shared contract edits first, spawns one subagent per track, then integrates, gates with `npm run check`, and commits to main. Use this whenever the user says "run a parallel wave", "split this across subagents", "multi-agent wave", "fenced parallel tracks", "fan out agents on this feature", "parallelize this work across agents", or asks to build several independent pieces of one feature concurrently with subagents on the same checkout. Also use it when planning any multi-agent implementation where the agents will write to the same repository, even if the user doesn't use the word "wave" — the fence discipline here is what prevents them from clobbering each other.
---

# Parallel wave — fenced multi-subagent development on one shared checkout

One supervisor (you), N subagents, one shared checkout — the main working tree of this
repo, on `main`. No merge conflicts, because conflicts are prevented *by construction*:
every track gets an explicit write fence, shared contracts are edited by the supervisor
before anyone spawns, and the supervisor alone integrates, runs `npm run check`, and
pushes. This recipe has landed multi-track waves repeatedly in this repo (see
[docs/tools-and-process.md](../../../docs/tools-and-process.md) §"Fenced parallel waves"
for the record of past waves); its two deliverables are the working code **and** the
findings that feed the next wave's design.

## Hard rule: no worktrees, no branches for wave tracks

Wave tracks **MUST NOT** use worktree isolation. The supervisor **MUST NOT** spawn a
subagent with `isolation: worktree` as part of a wave, and no track may create a branch.
All tracks work in the one shared checkout and commit directly to `main` with a
fence-scoped pathspec. This restates [AGENTS.md](../../../AGENTS.md) ("Commit to `main`
with pathspec … No branches, no worktrees").

This is a decision rule, not a blanket ban. The analysis is
[docs/worktrees-and-branches-for-agents-2026-08-22.md](../../../docs/worktrees-and-branches-for-agents-2026-08-22.md)
§8, which keeps the shared tree as the default for ordinary fenced feature work and
allows worktrees in exactly two situations — **neither of which is a wave track**:

1. **A risky spike likely to be discarded** — `claude --worktree spike-x`; merges or is
   deleted within a day. The value is wholesale abandonment with no revert trail on `main`.
2. **A long-running background agent** — a dependency upgrade, a large mechanical
   migration, an adversarial reviewer running tests destructively. That agent should not
   share the gate with foreground work for hours, so it runs in the background with
   `isolation: worktree` and integrates only via a green `npm run check` on the *merged*
   state.

Long-lived branches are forbidden in every case. If two tracks need the same files at the
same time, do not reach for a worktree — do not parallelize them at all; sequence them.
The fence is telling you the tasks were never parallel.

## When NOT to use this

- **Single-file or small changes** — one agent editing one file needs no fences.
- **Tasks under ~30 minutes of work** — the fence-table + prompt-writing overhead
  exceeds the parallelism win. Just do it inline or with one subagent.
- **Work that cannot be fenced** — if every track must edit the same hot file, the
  wave degenerates into a merge-conflict generator. Either restructure first (split
  the hot file into per-track modules, as a supervisor pre-step) or run tracks
  sequentially.

## The recipe (follow in order)

### 1. Verify the baseline is green

Run the gate **before touching anything**:

```
npm run check
```

That is the single definition of green in this repo. It runs
`tsx packages/check/src/main.ts`, which executes four steps in order, stopping at the
first failure: **typecheck** (`npx tsc --noEmit`), **lint** (`npx eslint .`), **ratchet**
(scans the repo for escape hatches and compares against `ratchet.json`; a regression
fails, an improvement rewrites the baseline), and **tests** (`npx vitest run`).
`npm run typecheck` and `npm run test` exist for narrowing a failure, but they are not the
gate.

If the gate is already red, stop and fix or explicitly waive it — otherwise later reds are
unattributable and every track wastes time suspecting itself. Per the user's git rules,
also make sure the working tree has a clean commit point for the files about to change.

### 2. Supervisor lands shared contracts FIRST

Identify the files every track depends on — type definitions in `packages/core`,
vocabularies/registries, reducers, wire formats, port assignments. Edit them yourself,
now, before spawning anyone. Mark them **supervisor-owned**: subagents read them freely,
may request the smallest change that unblocks them (recorded in `NOTES.md` so other tracks
find out), and never redesign them. This is the single highest-leverage step: when the
contracts are right, N agents build against them without meeting and the assembly
typechecks on first integration.

### 3. Write the fence table

Each track lists the **exact paths it may write** (see template below). Put the table in
[CONTRACTS.md](../../../CONTRACTS.md). Rules:

- Fences must not overlap. Name spec/test files explicitly, not just directories —
  two tracks "owning tests/" will both create the same spec file.
- Anything not in a fence belongs to the supervisor: integration files (e.g.
  `packages/dashboard/src/main.ts`), demo data, root docs, gate scripts, `package.json`
  (or: additions allowed by any track, noted in `NOTES.md`).
- If two tracks genuinely need the same file, either give one of them a tiny seam
  (a register function, a re-export shim) the other calls, or move that file to
  the supervisor and have both tracks request edits.

### 4. Assign shared resources explicitly

- Exactly **one** track may restart a shared server/daemon; name it in its brief. In this
  repo the standing servers are the dashboard on `:4747` (`npm run dashboard`) and
  codeview on `:4848` (`npm run codeview`).
- Every other track verifies inside its fence against its own harness or mocks, on
  its **own ports** (assign port numbers in the fence table so nobody guesses).
- Only the supervisor runs `npm run check`, once, at integration. Shared
  browser panes and embedded previews are unreliable under multi-agent load
  (background tabs freeze timers); tracks needing browser verification should use a
  private headless browser instance instead.

### 5. Spawn all independent subagents concurrently

One Agent call per track, all in the same message so they run in parallel — **without**
`isolation: worktree` (see the hard rule above). Each prompt (template below) must contain:

- its **fence** (verbatim from the table) and the rule set: never edit outside the
  fence, never push, no branches and no worktrees, commit only with explicit pathspec
  (`git commit -- <paths>`), never bare `git commit` or `git add -A`/`-a` — the tree is
  shared;
- **orientation**: the files to read first (`AGENTS.md`, `CONTRACTS.md`,
  `docs/style-guide.md`, `NOTES.md`), and the contract changes already landed in step 2;
- the **required behavior**, concretely;
- **how to verify inside its fence** (which commands, which ports, which mocks);
- **what to report back**: raw facts — files changed, signature/contract changes
  requested or made, gate results, and NOTES.md-ready findings.

### 6. Require checkpointing (agents die; work must not)

An agent that dies with its parent process loses all in-flight state — this has
happened. Instruct every subagent to make its work durable **as it goes**: either
commit per-fence at milestones (with pathspec) or write progress notes / partial
findings to a file inside its fence. A relaunched agent should be able to read the
checkpoint and resume, not restart.

### 7. Supervisor integration pass

When the tracks return:

1. Wire the pieces together in supervisor-owned files (the integration entry point,
   registration lists, demo data).
2. Run `npm run check` — the whole thing, on the integrated state. Per-track green proves
   nothing about integration. Fix integration-layer breakage yourself; send a track-fence
   defect back to a fresh subagent with the same fence if it's substantial.
3. Append each track's findings to `NOTES.md` (verbatim or lightly edited — attribute by
   track).
4. Commit **to `main`** — no branch — with a pathspec covering the wave's files, then
   `git pull --rebase` and push. Parallel agents on one repo have collided on push before;
   the rebase is not optional. Push only after `npm run check` is green.

### 8. Treat findings as a first-class deliverable

Each subagent returns findings ready to paste into `NOTES.md`: what surprised
it, what contract friction it hit, perf numbers, API warts, verification recipes
that worked or failed. The supervisor appends them all. These notes are what make
the *next* wave's contracts better — a wave that ships code but no findings only
did half its job.

### 9. Sweep out-of-scope findings into `backlog/`

`NOTES.md` is the wave's narrative record; `backlog/` is where work that outlived the wave
goes. At the end of the integration pass, the supervisor turns each durable finding into a
tracked item:

- **Bugs and technical debt discovered mid-wave** (including debt the wave knowingly
  created to hit its fence) → `/track-issue`, which writes a `backlog/BL-XXXX-*.md` item
  with `type: bug | debt | problem | retire`.
- **Adjacent ideas** the wave surfaced but did not build → `/track-idea`, same
  destination, `type: idea | feature`.

Both skills live in `.claude/skills/` in this repo. After creating or changing any item,
run `npm run backlog:regen` to rebuild `backlog/BACKLOG.md` and `backlog/DONE.md`. Tracks
may also be told to file items directly, as long as `backlog/` is in their fence —
otherwise they report the finding and the supervisor files it.

---

## Templates

### (a) Fence table

Put this in [CONTRACTS.md](../../../CONTRACTS.md):

```markdown
## Fences (who writes where)

Supervisor-owned (all tracks READ only; request smallest unblocking change via NOTES.md):
`packages/core/**`, `package.json`, `tsconfig*.json`, `eslint.config.js`, `ratchet.json`,
`AGENTS.md`, this doc.

| Track | Writes only | Ports/resources |
|---|---|---|
| A <name> | `packages/<area-a>/src/**`, `packages/<area-a>/test/<area-a>.spec.ts` | harness on :<port-a> |
| B <name> | `packages/<area-b>/src/**`, `packages/<area-b>/test/<area-b>.spec.ts` | mocks only |
| C <name> | `packages/dashboard/src/<sub>/**` | MAY restart dashboard :4747 |
| S integration (supervisor) | `packages/dashboard/src/main.ts`, demo data, root docs, gate scripts | runs `npm run check` |

`package.json`: additions allowed by any track; note in NOTES.md and run install after.
Commit to `main` with pathspec limited to your fence: `git commit -- <your paths>`.
No branches, no worktrees. Do not push; the supervisor pushes.
```

### (b) Subagent prompt

```
You are Track <X> (<name>) of a parallel wave on the SHARED checkout at <repo path>,
working on `main`. Do NOT create a branch and do NOT create or use a git worktree.

ORIENTATION — read these first:
- AGENTS.md
- CONTRACTS.md — the fence table and seams
- docs/style-guide.md — the code rules (PS-nnn)
- NOTES.md — accumulated findings; you will append yours
Contract changes already landed this wave: <summary of step-2 edits>.

YOUR FENCE — you may write ONLY these paths:
  <exact paths from the fence table>
Supervisor-owned files (<list>) are read-only. If one blocks you, make the smallest
change that unblocks you and record it under "Contract changes" in your report —
never redesign them.

TASK:
<required behavior, concretely: inputs, outputs, edge cases, what done looks like>

VERIFY inside your fence:
<commands to run, e.g. `npx tsc --noEmit` plus `npx vitest run <your spec>`>
The full `npm run check` is the supervisor's job at integration; do not treat a red
step caused by another track as yours.
Use <your own port / mock harness>: <details>. Do NOT restart <shared resource> —
Track <Y> owns it. Do NOT use shared browser panes; use a private headless instance
if you need a browser.

CHECKPOINT as you go: <commit per-fence at milestones with pathspec | write progress
to <fence-path>/PROGRESS.md> so a relaunch resumes instead of restarting.

RULES: never edit outside your fence; never push; no branches, no worktrees; commit only
with explicit pathspec (`git commit -- <paths>`), never bare commit or `git add -A`.

REPORT back raw facts:
- files changed; any signature/contract changes made or requested
- gate results (exact numbers)
- NOTES.md-ready findings: surprises, contract friction, perf numbers, warts
- out-of-scope bugs/debt or adjacent ideas you hit (the supervisor files them via
  /track-issue and /track-idea)
```

### (c) Orientation files

This repo already has them — do not recreate, extend:

- [AGENTS.md](../../../AGENTS.md) — read order, the gate commands, the package map, the
  git conventions (`main`, pathspec, `git pull --rebase`, no branches, no worktrees).
- [CONTRACTS.md](../../../CONTRACTS.md) — the fence table plus one short section per seam:
  each inter-track interface (function signature, endpoint table, wire format) with who
  provides it and who consumes it.
- [NOTES.md](../../../NOTES.md) — findings, appended per wave and attributed by track.
- `backlog/` — durable work items, via `/track-issue` and `/track-idea`.

For a project that lacks them, `AGENTS.md` should carry: read order; the commands to start
the app and run every gate (green before AND after); a `| Where | What |` map marking
shared contract files "change carefully"; known warts; and the commit conventions.
`NOTES.md` should carry a "Contract changes" section and a "Findings" section with one
`### Track <X> — <name>` heading per track.
