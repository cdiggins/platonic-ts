# The scout benchmark

Fixed fuzzy-discovery questions, their known answers, and the procedure for running them
against the `scout` subagent and against a text-search baseline. This file is the spec; each
execution writes its own dated results file (`docs/scout-benchmark-run-YYYY-MM-DD.md`).

It exists to close the third and fourth boxes of [BL-0028](../backlog/BL-0028-fuzzy-code-discovery.md)
and to run the measurement described in
[the design note](code-discovery-scout-2026-08-23.md#measuring-it).

## What is being measured

The claim under test is that a cheap model with symbol-level read tools answers "does anything
here already do X?" more accurately, and for fewer tokens, than a strong model with text search.
The questions are written so that the word in the task is *not* the word in the code, because
that mismatch is the failure text search cannot see: the search returns nothing, the agent
concludes nothing exists, and it writes a duplicate.

Two of the five questions carry a deliberate trap — a symbol that a plain `grep` for the task's
own vocabulary ranks first and that has nothing to do with the task.

## Arms

| Arm | Agent | Model | Tools |
|---|---|---|---|
| A — scout | `subagent_type: scout` | haiku | `mcp__platonic__` repo_map, search, outline, symbol, usages |
| B — default | `subagent_type: general-purpose` | session model (Opus 5) | Read, Grep, Glob, Bash |
| C — control | `subagent_type: general-purpose` | haiku | Read, Grep, Glob, Bash |

Arm B is the default approach: what happens today when no scout exists and a general agent
greps and reads. Arm C holds the model constant against arm A so that a difference between A
and B can be attributed to tools rather than to model strength.

Arms B and C are given the report contract in their prompt, because they have no agent
definition carrying one. They are *not* given scout's search methodology. Their tool
restriction is stated in the prompt rather than enforced by the harness — the `general-purpose`
agent type can reach every tool, so a violation is possible and is treated as a run defect to
be noted, not silently accepted.

## The five questions

Each prompt is sent verbatim. Fresh agent per query per arm; no shared context.

### Q1 — copy-pasted logic (word mismatch, with trap)

> Task: find places in this codebase where the same logic has been copy-pasted under different
> names, and factor one of those groups into a single shared helper, rewriting each copy into a
> call.

- **Primary:** `repeatedExpressions` (`packages/codemap/src/clones.ts:182`),
  `extractionPlan` (`packages/codemap/src/extract.ts:132`)
- **Supporting:** `shapedExpressions`, `groupByShape` (`clones.ts`), `splitHoles`
  (`holes.ts:126`), `siteOf` (`sites.ts:48`), `unsafeReasons` (`sites.ts:123`), `spliceText` /
  `applyEdits` (`codemap/src/edits.ts`), the `npm run clones -- --extract N` entry point
- **Trap:** `duplicateIssues` (`packages/backlog/src/ids.ts:90`) is the only declaration whose
  name contains "duplicate" and it detects repeated backlog ids, not repeated code.

### Q2 — restore files after a bad rewrite (word mismatch, with trap)

> Task: before an automated tool rewrites a batch of files, record their current contents so the
> whole batch can be put back exactly as it was if the rewrite turns out to be wrong.

- **Primary:** `takeSnapshot` (`packages/mcp/src/checkpoint.ts:36`), `snapshotOfWorkspace`
  (`packages/mcp/src/checkpoint.ts:53`), `takeCheckpoint` (`packages/mcp/src/io.ts:217`)
- **Supporting:** the `Snapshot` type, the `revert` tool, `applyEdits`
  (`packages/mcp/src/edit.ts:52`), `EditPlan` (`edit.ts:17`)
- **Trap:** searching the task's own word, "undo", returns thirteen matches, every one of them
  the substring inside `undocumentedExports`.

### Q3 — fail the build on stale generated markdown (cross-package, meaning in the body)

> Task: generate a section of a markdown file from data elsewhere in the repository, and make
> the build fail when the checked-in file no longer matches what would be generated.

- **Primary:** `staleBlockNames` (`packages/backlog/src/docsgen.ts:75`), `buildBlocks`
  (`docsgen.ts:133`), `regenerateDocs` (`packages/backlog/src/docsgenIo.ts:128`)
- **Supporting:** `extractMarkers`, `spliceBlocks`, `unknownBlockNames`, `missingDescriptions`
  (`docsgen.ts`), `DocsRegenReport` (`docsgenIo.ts:31`), `docsRegen`
  (`packages/backlog/src/main.ts:123`), the `'docs'` member of `StepName`
  (`packages/check/src/run.ts:18`)
- The answer spans two packages, and the connection to the build gate lives in a union member
  rather than in any name.

### Q4 — Slack notification (true negative)

> Task: when the check gate fails, post a message to a Slack channel naming the step that
> failed.

- **Primary:** nothing. No outbound HTTP client exists in any package's source; `fetch` appears
  only inside browser-side UI strings in `dashboard` and `codeview`.
- **Acceptable adjacent:** `runCheck` / `CheckReport` / `CheckStepResult`
  (`packages/check/src/run.ts`), `appendHookEvent` (`packages/hooks/src/io.ts:24`), the
  dashboard's SSE push.
- A correct answer says plainly that this is not implemented before listing anything.

### Q5 — quality trend over time (analogy jump)

> Task: track whether this repository's code quality is getting better or worse over time —
> record a per-folder score and fail the build when it gets worse than the last recorded run.

- **Primary:** `compareToBaseline` (`packages/check/src/ratchet.ts:55`), `applyBaseline`
  (`packages/check/src/run.ts:62`)
- **Supporting:** `scoreMetrics` (`packages/codemap/src/metrics.ts:114`), `folderMetrics`
  (`metrics.ts:324`), `RatchetCounts` (`ratchet.ts:13`), `CodeMetrics`
  (`packages/core/src/index.ts:220`), `ratchet.json`
- The jump under test: "worse than last time, fail the build" is the ratchet, which is recorded
  for escape-hatch counts and not for the quality score. A good answer names both halves and
  says the halves are not connected.

## Scoring

Per query and arm:

- **Primary hits** — how many of that query's primary leads the report names, out of the total.
  This is the headline number.
- **Supporting hits** — how many supporting leads it names.
- **False leads** — leads that do not exist, sit at the wrong file, or carry a `why` line the
  declaration's body contradicts. Verify each claim with `mcp__platonic__symbol`; a wrong line
  number alone is a minor defect, a wrong claim about behavior is a false lead.
- **Trap taken** — whether the query's trap symbol was reported as relevant.
- **Cost** — tool uses, wall-clock seconds, and subagent tokens, all reported by the `Agent`
  tool alongside each result.

Q4 scores inverted: the primary hit is the explicit statement that the feature does not exist.
Naming an adjacent primitive is neutral; claiming a notifier exists is a false lead.

## Running it

`/scout-benchmark` runs the whole thing. By hand:

1. Launch all fifteen agents (5 questions x 3 arms) in one message so they run concurrently.
   Arm A: `subagent_type: scout`, prompt = the question text plus "What already exists in this
   repository that could help with this task?". Arms B and C: `subagent_type: general-purpose`,
   `model: opus` and `model: haiku`, prompt = the same, plus the report contract and the tool
   restriction (see `.claude/skills/scout-benchmark/SKILL.md` for the exact wrapper text).
2. Verify every claimed lead against the index with `mcp__platonic__symbol` before scoring it.
   Reports are claims, not facts.
3. Write `docs/scout-benchmark-run-YYYY-MM-DD.md`: the scoring table, the notable individual
   results, and an assessment.

## Maintenance

The questions are pinned to declarations that exist today. When one of them moves or is
deleted, the question is still valid but the ground truth above must be re-derived — a run that
scores against stale ground truth reports failures that are the benchmark's fault. Re-verify the
primary leads before each run; it costs five `symbol` calls.
