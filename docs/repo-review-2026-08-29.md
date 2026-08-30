# Repository review — 2026-08-29

A full-repo review: what is working, what is at risk, where the docs and the code disagree,
and what to add, change, or remove. Three parallel review passes covered (1) `packages/core`,
`packages/codemap`, `packages/mcp`; (2) the eight observability and tooling packages; and
(3) the backlog, docs, decisions, and configuration. `npm run check` was run first and passed
all seven steps in about 80 seconds.

**The bottom line.** The repo is in unusually good mechanical health for something built in a
two-day burst: the gate is green, the ratchet is actively falling, the pure-core/IO-edge
convention held across five multi-agent waves, and the strongest design decisions are backed
by evidence rather than assertion. The risks are not in the code style — they are (a) a layer
of dead and unwired code that the gate cannot see, (b) an inverted test distribution that
covers pure functions heavily and the wiring that actually runs them not at all, (c) process
documents that have started contradicting each other, and (d) a project that has so far only
been pointed at itself. The single most valuable next step is the outward experiment: use
these tools on a repo that is not this one.

## 1. What is working well

These are the decisions worth keeping and building on, each with the evidence.

**"Refuse rather than guess" is implemented at real cost, not just asserted.**
`packages/mcp/src/move.ts` declines a move on six named conditions and names the offending
declarations with `file:line`. `changeSignature` collects every problem site before refusing
instead of stopping at the first. `restorePlan` refuses a whole restore rather than doing a
half-undo. Each of these is a case where returning *something* would have been easier. This is
the repo's strongest idea and it survived contact with implementation.

**The plan-as-value seam.** Every write tool returns an `EditPlan`; one funnel
(`packages/mcp/src/io.ts`) writes plans to disk, re-reads every file, and byte-compares it
against the index first, so a stale plan fails loudly instead of corrupting. `preview`,
`batch_edit`, and `revert` are the same computation rather than three code paths, and the
overlap check lives once, at the funnel.

**The `Workspace` / `Compiler` split plus the incremental session.** Most tools cost a map
lookup; only the branches that need inferred types pay the seconds to bind a program.
Underneath, an incremental rebuild after one edit costs 50ms against 1.6s for a full index,
and `packages/codemap/test/incremental.test.ts` asserts the merged index is identical to a
full rebuild — correctness by construction, verified, not hoped.

**Backlog id allocation by exclusive file create** (`packages/backlog/src/io.ts`). Claiming a
number and recording it are one atomic `open(path, 'wx')`, so there is no lock to time out,
steal, or clean up after a killed agent. For a project whose central problem is concurrent
agents on one tree, this is the right primitive, and it is the only concurrency mechanism in
the repo that would survive contention.

**Injected providers as the servers' only dependency.** Neither the dashboard nor codeview
server touches the filesystem; every data source is a function passed in. The payoff is 30
route tests across the two packages that run with no fixtures and cover the failures that
matter (provider throws → 500, oversized body → 413 with the body drained, traversal → 400).

**The ratchet actually ratchets.** `asCasts` fell 7 → 5; `undocumentedExports` was introduced
at 274 and driven to 63 in the next commit; `explicitAny` and `eslintDisables` are pinned at
zero. The gate has caught real regressions and the baseline moves in one direction.

**Process artifacts that pay their way.** The decision records in `docs/decisions/` were
tested by a real conflict and resolved it cleanly by supersession with the reasoning written
down. The generated doc blocks (package tables, npm-script tables, `INDEX.md` tables) are
gated by `npm run check` and are the only inventories in the repo that have not drifted. Five
fenced waves produced zero merge conflicts, and the per-track token costs were recorded.

## 2. What might not work

### 2.1 Dead and unwired code the gate cannot see

The gate proves the code compiles, lints, and passes its tests. It does not prove anything
runs. Three subsystems currently pass every check while doing nothing:

- **The hook event log has no producer and no consumer.** `.claude/settings.json` wires only
  `PreToolUse`. `postToolUse.ts`, `sessionStart.ts`, `appendHookEvent`, the codec, and
  `tail.ts` — roughly 250 source lines plus 450 test lines — are reachable only through
  manual wiring that has not been done, `.claude/events/` does not exist, and `pollHookEvents`
  has zero consumers even if it were written. BL-0004 is honestly marked in-progress, but the
  code has been parked since Wave 5.
- **Tested source of truth, untested copy in production.** `packages/dashboard/src/pie.ts`
  and `paging.ts` have zero production callers — only their tests import them. The code that
  actually runs is the hand-copied plain-JS mirror inside `ui.ts`'s inline script, which has
  no tests. The duplication was flagged in NOTES.md; what NOTES did not say is that the
  "real" implementation is dead.
- **`packages/mcp/src/index.ts` has zero importers.** The barrel labelled the server's pure
  surface (~60 names) is dead as a public API, and it re-exports `createCompiler` and
  `callTool`, which are not pure.

Smaller instances: `buildProgram` and `indexRepo` in `packages/codemap/src/io.ts` are
test-only (production uses `openSession`); `discoverSessionTaskDirs` runs a `readdir` per
dashboard tick against a directory NOTES.md already established is always empty; the
`packages/check` barrel is consumed by one package while `codemap` and `mcp` deep-import past
it.

### 2.2 The test distribution is inverted

The pure functions are well covered; the wiring that runs them is not.

- **32 of the 33 MCP tools are never dispatched in a test.** Each tool's underlying function
  has tests, but nothing calls `callTool` for them, so the entire argument-plumbing layer —
  `readTool`'s 22 branches, `planTool`'s 11, every `missing()`/`declined()` message — is
  untested. A typo in a `case` label would ship green, and nothing verifies a catalogued tool
  name is reachable in dispatch.
- **No CLI `main.ts` is tested anywhere** — four composition roots (`check`, `init`,
  `backlog`, `transcripts`) with real argument parsing and dispatch, zero coverage.
- **`packages/dashboard/src/ui.ts` (631 lines) has no test file at all**, while codeview's
  `ui.test.ts` is a model of what the dashboard needs: it asserts the DOM class contract
  against what the renderer emits — exactly the failure mode that silently killed syntax
  colouring in Wave 3.

### 2.3 Concrete defects found

Ordered roughly by severity.

1. **The MCP server can hang silently and permanently.** `packages/mcp/src/server.ts:120-123`
   chains `pending = pending.then(...)` with no `.catch`; a throw from `options.write` (EPIPE
   on closed stdout) or `encodeResponse` poisons the chain and every later request
   short-circuits with no log. One `.catch` fixes it.
2. **`revert` after a repo switch restores the wrong repository's files.** The checkpoint
   store in `packages/mcp/src/io.ts:212-226` is module-level and not keyed by `repoDir`,
   while `loadWorkspace` explicitly supports switching repos.
3. **The preview path does not refuse stale plans.** `applyPlan` re-reads before *writing*,
   but `previewFile` applies plan offsets to whatever text is current with no comparison — a
   stale plan renders a wrong diff and reports `ok: true`. `batch_edit` has a cousin defect:
   each step loads the workspace independently, so a batch can combine plans built against
   different base texts, which the overlap check cannot detect.
4. **The dashboard `close()` hang is still unfixed** (`packages/dashboard/src/server.ts:217`,
   no `closeAllConnections()`), a year-one finding in NOTES.md and now backlog item BL-0018.
   The fix exists twenty lines away in codeview's copy of the same server scaffold — the
   duplication is what kept it from propagating.
5. **The dashboard runs on exactly one machine.** `packages/dashboard/src/main.ts:28`
   hardcodes the project slug `C--Users-cdigg-git-platonic-ts` (twice). The portable
   derivation already exists in `packages/transcripts/src/main.ts:35` (`projectSlug`).
6. **Unbounded `git log` on a five-second poll.** `packages/gitlink/src/io.ts` runs `git log`
   with no `-n`, buffers all history, and the caller keeps 30 rows; on a repo with real
   history this exceeds `maxBuffer` and the panel silently 500s. Related: the
   `Co-Authored-By` fallback treats a constant trailer as a high-confidence session match, so
   correlation is confidently useless rather than honestly `none`.
7. **Two SSE clients race the shared tail state.** Each dashboard SSE connection calls the
   provider on its own interval, and the provider mutates shared tail offsets — two open tabs
   can double-ingest activities.
8. **`symbol_diff` spawns one `git show` process per indexed file** (~150 processes, seconds
   of wall time on Windows) and blocks the serialized MCP queue while it runs; the `check`
   tool similarly blocks all reads for the duration of a full test run. `git cat-file
   --batch` would do the diff in one process.
9. **Windows case-folding is inconsistent** across `sourceFileIndex` (lower-cases keys),
   `changesSince` (does not), and `writeFileEdits` (raw `get`, no fallback) — `insert_symbol`
   with a differently-cased path previews fine and then refuses to write.
10. **The ratchet baselines are measured by a scanner known to be broken.** BL-0031 (the only
    p1 item) records that `collectCommentText` loses the rest of a template literal after the
    first `${...}`, missing roughly a quarter of comment text — so `undocumentedExports: 63`
    and `tsDirectives: 1` are not trustworthy numbers until it is fixed.

### 2.4 Process drift

- **NOTES.md has stopped being maintained — in both directions.** Its last entry is
  2026-08-23; the clone/extract pipeline, the scout agent, and the boundary gate left no
  findings at all, while old findings never leave for the backlog: the eight file-split
  candidates recorded at the end of NOTES.md exist nowhere in `backlog/`, and the
  `revert`-cannot-undo-file-creation limitation is unfiled. Meanwhile `AGENTS.md` still says
  "append yours."
- **Backlog status is drifting from reality.** Of five in-progress items, four are wrong:
  BL-0020 and BL-0021 shipped, BL-0010 shipped and is still `type: idea, priority: ?`,
  BL-0005 has been parked for a week. BL-0028 is `idea` while four commits implemented both
  halves of it. Three done items sit unarchived — one of them the item that built the archive
  command. `backlog/.ids/0035` and `0036` are untracked, so a fresh clone would re-allocate
  those ids.
- **Required backlog sections are unenforced.** `## Done means` is required before `ready`
  (seven items are ready; the validator checks ids only), and the sprint planner is told to
  read `## Dependencies` sections that no item has — the check silently passes every time.
  BL-0036's own evidence section already diagnoses most of this.

## 3. Ambiguities and contradictions

Each of these is a place where two documents, or a document and the code, disagree.

1. **"Fence" is banned and load-bearing at the same time.** `AGENTS.md` mandates standard
   vocabulary — explicitly "lock, not fence" — while `CONTRACTS.md` is titled "fences and
   seams", every wave heading says fences, and the parallel-wave skill uses the term
   throughout. Either grant the term a defined-term exemption in AGENTS.md or rename it;
   as written the rule is unfollowable.
2. **Four push policies.** README says push frequently; AGENTS.md says only after a verified
   milestone; tools-and-process says only when the gate is green; the parallel-wave skill
   says tracks never push. An agent's behavior depends on which file it read first. One
   sentence in AGENTS.md should own this, and the others should point at it.
3. **The worktree prohibition is written as settled but is not.**
   `docs/worktrees-and-branches-for-agents-2026-08-22.md` concludes the absolute ban is wrong
   and asks for a README change that never happened; README and AGENTS.md still carry the
   absolute form. No decision record adjudicates it — this is exactly what `docs/decisions/`
   is for.
4. **The README Documents section contradicts itself.** Its lead says "nothing is implemented
   yet"; three entries carry "(Implemented — unlike the design notes below/above)"
   parentheticals that now point in both directions; and 21 of the repo's 37 docs are not
   listed at all. The generated tables directly above it never drift — this list is the
   obvious next `docs:regen` block.
5. **The AGENTS.md map is missing two packages** (`gitlink`, `init`) while declaring itself
   doctrine the architect maintains. The README's generated table has all eleven.
6. **Two decision directories.** Root `decisions/` holds two ADRs (WorkQuarry format, index
   backend); `docs/decisions/` holds the architect rulings; AGENTS.md tells agents about only
   the second. An agent following instructions never sees the WorkQuarry ADR.
7. **The style guide's zone definition does not match the repo.** Ten files outside the
   `main.ts`/`server.ts`/`io.ts` glob do filesystem IO (`docsgenIo.ts`, `indexdocIo.ts`,
   `scan.ts`, `boundaryScan.ts`, `watch.ts`, `tail.ts`, ...), so they are lint-classified as
   pure Core while being Root in fact. This is upstream of the zone-blind score problem
   BL-0017 files: the zone assignment itself is wrong before the score ever runs.
8. **CONTRACTS.md's historical sections read as live spec.** The Wave 1 section presents the
   pre-WorkQuarry backlog schema (`todo | doing | blocked`) as the only fenced-code-block
   format spec in the repo, and the Wave 5 section says `applyPlan` lives in `server.ts`
   (it is in `dispatch.ts`). The `check` MCP tool's description says the gate is four steps;
   it has been seven for a week.
9. **`packages/hooks/README.md` instructs the reader to reintroduce a fixed bug.** Its
   paste-in snippet uses `tsx ...`, which is not on PATH — the exact silent failure fixed in
   commit `9f890b5` and guarded by `wiring.test.ts` — where the decision record and the live
   settings use `node --import tsx`.
10. **Small but telling comment/code mismatches:** `readBaseline`'s stated justification for
    avoiding `JSON.parse` is contradicted by `parseBaseline` next door; `checkpoint` claims
    to record "every indexed file" but skips markdown, so `revert` silently will not restore
    it; `packages/core/src/INDEX.md` names four consumers when there are seven; the
    incremental-invalidation comment states as absolute a rule with a known narrow exception
    (a new declaration that an unchanged file's dangling identifier now resolves to).

## 4. Experiments worth running

The README's hypothesis list is the right frame; these are the measurements that would
actually move items from weak to confirmed or refuted.

1. **Point the tools at a repo that is not this one** (BL-0005 Gratify, BL-0033 superpowers
   comparison). Everything so far is self-referential: the index, the metrics, the MCP
   measurements all ran against platonic-ts. Run `platonic init` plus the MCP server against
   a real foreign repo, give an agent the same tasks with and without them, and record token
   cost, wall-clock, and correctness. This tests H7 and the core bet of the project, and it
   is the experiment everything else is a proxy for.
2. **Re-measure the tool catalogue at 33 tools.** The 43–96% token savings were measured on
   the first nine tools; the catalogue now costs ~4,800 tokens per request. There is a real
   possibility that the marginal tool is net-negative (catalogue cost plus agent
   choice-confusion versus usage frequency). Measure per-tool usage frequency from the
   transcripts the repo already parses, and cut the tools that do not earn their tokens.
3. **The ratchet-behavior experiment.** Does the ratchet change what agents write, or only
   catch it after? Compare escape-hatch introduction rates in sessions before and after the
   gate landed — the transcripts and git history to answer this already exist in the repo.
4. **Kill-or-commit on the hook event log.** Wire `PostToolUse` and `SessionStart` for one
   week of real work. If the event log changes any decision the transcripts could not, keep
   it and finish BL-0004; otherwise delete the subsystem (~700 lines). Either outcome beats
   the current state.
5. **Affected-tests-only gate.** "Only run the tests required" is in the README approach list,
   but `npm run check` runs everything, and tests are 24 of the gate's 80 seconds. The
   codemap's change detection plus the import graph is exactly the information needed to run
   only affected packages' tests. This is also the cheap, honest version of H12
   (content-addressed test caching) — worth a spike before believing the full Unison vision.
6. **Zone-aware scoring** (BL-0017). The stats work already showed the pooled median
   describes none of the three zones; fix the zone definition first (finding 3.7), then make
   the score zone-aware, and check whether the files it flags change.
7. **Formalize the wave-economics numbers.** Per-track token costs exist for waves 1–5 in
   NOTES.md. Turn them into a small table (tokens per track, integration defects per wave,
   wall-clock) so the next "should this be a wave or one agent?" decision cites data. The two
   recorded integration defects were both string-contract ambiguities — evidence that seam
   specs need to cover strings (HTML classes, JSON shapes), which is already written down but
   not yet acted on as a checklist item for the next wave.

## 5. Add, change, remove

### Add

- `.catch` on the MCP server's request chain, and handlers for stdin `error`/`end`
  (defect 3.1 above; small, urgent).
- `closeAllConnections()` in the dashboard's `close()` (BL-0018; one line).
- A staleness comparison in `previewFile`, so preview refuses where write would.
- Boundary rules that exist only as prose: `backlog ↛ check`, `backlog ↛ codemap` (the
  docsgen ruling names them as hard constraints; `forbiddenEdges` holds one rule today).
- A generated Documents index in README (new `docs:regen` block) and an agents table in
  `docs/tools-and-process.md` — the three `.claude/agents/` are currently documented nowhere.
- Backlog validation for the rules that exist only as prose: single-line titles, `## Done
  means` present on `ready` items, archived-id collisions, and untracked `.ids` markers.
- An observe-only unused-exports report in the gate (the `unused_exports` tool exists; this
  review found the dead surface by hand that it should be reporting continuously).

### Change

- Fix BL-0031 (the comment scanner) before trusting or lowering `undocumentedExports`; it is
  correctly the only p1.
- True up the backlog: mark BL-0020/0021/0010/0028, archive the three done items, commit the
  two untracked `.ids` markers, decide BL-0005's fate explicitly.
- Derive the dashboard's project slug with `projectSlug(process.cwd())` instead of the
  hardcoded string; bound `git log` with `-n`.
- Consolidate the four path/ADR/policy splits: one push policy, one decisions directory (or
  cross-references), the AGENTS.md map completed, the fence-terminology ruling made.
- Align the lint Root zone with reality — either an `io/` directory convention or adding the
  `*Io.ts` / `scan.ts` / `watch.ts` / `tail.ts` files to the exemption glob, then re-examine
  `nonNullAssertions: 23`, the one baseline number that has never moved.
- Restructure NOTES.md by subject rather than exhausted track letters, and sweep its stranded
  findings (eight split candidates, the `revert` limitation) into backlog items. Consider
  making the sweep part of `/track-backlog` so it recurs.
- Move CONTRACTS.md's superseded wave sections into `docs/` history so the file contains only
  live contracts; fix the stale `applyPlan` reference and the `check` tool description.
- Fix the hooks README command and delete its hand-maintained file list in favor of the
  generated `INDEX.md`.
- Deduplicate where the duplication has already caused a defect: one server-lifecycle helper
  (listen/close/`closeAllConnections`), one `readAppended` tail reader, one `walkTsFiles` in
  `packages/check`.

### Remove

- The dead halves of `pie.ts` and `paging.ts` — either delete the unused exports and test
  the inline copies, or generate the client script from the TypeScript source; the current
  arrangement tests the code that does not run.
- `packages/mcp/src/index.ts` as a barrel, unless it is deliberately the future public API —
  in which case say so in its purpose comment and stop re-exporting the impure entries.
- The hook event subsystem, if experiment 4 says it earns nothing.
- The stale machine-specific allow-entry in `.claude/settings.local.json`.
- `buildProgram`/`indexRepo` from codemap's production surface (fold into the session path or
  mark them test fixtures).

## 6. A closing observation

The repo's own thesis is that enforcement should live in tools, not prose — and the findings
split cleanly along that line. Everything gated is healthy: generated tables have not
drifted, the ratchet falls, the id allocator is race-free. Everything prose-governed has
drifted in one week: push policy, the Documents list, backlog statuses, NOTES.md, the zone
definition. That is not a failure of discipline; it is the thesis confirming itself. The
implication is to keep converting: every rule this review found broken in prose form
(single-line titles, Done-means, dependency sections, the Documents index, unused exports)
is a candidate for the same treatment the package tables got. The second implication is the
converse: prose that cannot be converted should be minimized, deduplicated, and given one
owner per statement, because every copy is a future contradiction.
