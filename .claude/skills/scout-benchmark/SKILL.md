---
name: scout-benchmark
description: Run the fuzzy code-discovery benchmark — five fixed questions with known answers, sent to the scout subagent and to two text-search baselines, then scored on hit rate, false leads, and cost into a dated results document. Use when the user says /scout-benchmark, "run the scout benchmark", "re-run the scout measurement", "is the scout still better than grep", or changes the scout definition, repo_map ranking, or MCP read tools and wants the effect measured.
argument-hint: [optional: a subset of questions, e.g. "Q1 Q4", or "arm A only"]
---

# scout-benchmark — measure the scout against text search

Runs the measurement specified in [docs/scout-benchmark.md](../../../docs/scout-benchmark.md).
That file holds the questions, the ground truth, the arms, and the scoring rules; this file is
only the procedure. Read the spec first — do not restate its questions from memory, and do not
invent new ones mid-run, or results stop being comparable across runs.

Fifteen subagents cost real tokens. Confirm with the user before launching unless they asked
for the benchmark by name.

## 1. Re-verify the ground truth

For each question in the spec, call `mcp__platonic__symbol` on its primary leads. A primary
lead that no longer exists means the repository moved and the spec's ground truth needs
updating before the run — score against stale expectations and you report failures that are
the benchmark's fault, not the agent's. Fix the spec, say what you changed, then continue.

## 2. Launch all fifteen agents in one message

Five questions times three arms, concurrently. Use the question text from the spec verbatim.

**Arm A — scout.** `subagent_type: scout`, no model override (the agent definition pins haiku).
Prompt is exactly:

```
<question text>

What already exists in this repository that could help with this task?
```

**Arms B and C — the baselines.** `subagent_type: general-purpose`, `model: opus` for B and
`model: haiku` for C. Prompt is the arm A prompt plus this wrapper, unchanged:

```
Constraints for this run: use only the Read, Grep, Glob, and Bash tools. Do not use any
mcp__platonic__* tool.

Return 3 to 8 leads, best first, and nothing else. Each lead is exactly:

name (file:line) — signature
  why: one sentence connecting it to the task, based on what you read in its body.
  used: how many places use it, one representative call site.

Only include declarations you actually read. If nothing existing helps, say so plainly and
list the two or three closest near-misses. No preamble and no methodology narrative.
```

The wrapper gives the baselines the report contract that scout gets from its agent definition,
so the comparison is about tools and model rather than about output formatting. It does not
give them scout's search methodology, which is part of what is being measured.

Record the tool-use count, duration, and token count the `Agent` tool reports for each run —
they are the cost half of the score and are not recoverable later.

## 3. Verify every claimed lead

Do not score a report on its own authority. For each distinct symbol any report names, call
`mcp__platonic__symbol` and check three things: the declaration exists, it is in the claimed
file, and its body supports the `why` sentence. A wrong line number is a minor defect; a `why`
line the body contradicts is a false lead, and it is the failure mode the whole exercise exists
to catch.

Batch the verification — one message with many `symbol` calls, not one per turn.

## 4. Write the results document

`docs/scout-benchmark-run-YYYY-MM-DD.md`, containing:

- the run date, the commit under test (`git rev-parse --short HEAD`), and the arm table
- a scoring table: primary hits, supporting hits, false leads, trap taken, tool uses, seconds,
  tokens — per query per arm
- the individual results worth reading, quoted, with what each one got right or wrong
- an assessment that answers the question the benchmark was built for: is the scout worth
  running, and where does it fail
- anything that made the run itself unsound — a baseline that used a forbidden tool, a
  question whose ground truth had drifted, an agent that returned nothing

Write it for someone who was not in the session and will read it a month from now. Prose rules
are in `AGENTS.md`.

## 5. Land it

Update the "Done means" checkboxes in
[BL-0028](../../../backlog/BL-0028-fuzzy-code-discovery.md) if this run closes one, run
`npm run check`, and commit the results file with pathspec.
