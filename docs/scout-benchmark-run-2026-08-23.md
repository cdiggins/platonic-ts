# Scout benchmark run — 2026-08-23

First execution of [the scout benchmark](scout-benchmark.md) at commit `63e2f81`. Fifteen
subagents: five fuzzy discovery questions with known answers, each sent to three arms.

| Arm | Agent | Model | Tools |
|---|---|---|---|
| A | `scout` | haiku | `mcp__platonic__` repo_map, search, outline, symbol, usages |
| B | `general-purpose` | Opus 5 | Read, Grep, Glob, Bash |
| C | `general-purpose` | haiku | Read, Grep, Glob, Bash |

Every symbol named in every report was checked against the index with `mcp__platonic__symbol`
and `mcp__platonic__outline` before scoring.

## Scores

Primary hits are the declarations a correct answer must contain, listed per question in the
spec. Q4 is the true negative: its single primary is the explicit statement that the feature
does not exist.

| Question | Primary hits A | B | C | Tokens A | B | C |
|---|---|---|---|---|---|---|
| Q1 copy-pasted logic | 2/2 | 2/2 | 2/2 | 16.1k | 71.0k | 54.3k |
| Q2 restore after a bad rewrite | 3/3 | 3/3 | 3/3 | 14.3k | 59.0k | 49.3k |
| Q3 stale generated markdown | 3/3 | 3/3 | 2/3 | 23.8k | 56.5k | 57.4k |
| Q4 Slack notification (negative) | 0/1 | 1/1 | 1/1 | 15.9k | 59.6k | 48.6k |
| Q5 quality trend over time | 2/2 | 2/2 | 2/2 | 25.1k | 72.4k | 62.1k |
| **Total** | **10/11** | **11/11** | **10/11** | **95k** | **319k** | **272k** |

| | A — scout | B — Opus + grep | C — haiku + grep |
|---|---|---|---|
| Primary hit rate | 91% | 100% | 91% |
| False leads | 0 | 0 | 0 |
| Wrong `used:` claims | 0 | 0 | 2 |
| Traps taken | 0 | 0 | 0 |
| Tool calls | 134 | 67 | 115 |
| Wall clock | 370s | 360s | 307s |
| Subagent tokens | 95k | 319k | 272k |
| Tokens per correct primary | 9.5k | 29k | 27k |

No arm invented a declaration, put one in the wrong file, or wrote a `why` line the body
contradicts. Two `used:` lines in arm C were wrong: C's Q1 report claimed codemap's
`applyEdits` is used by "the revert feature" (its only production caller is `writePlan` in
`packages/codemap/src/main.ts:69`), and its Q2 report claimed `takeSnapshot` is called by
`snapshotOfWorkspace` (they are siblings; `takeSnapshot` has no production caller at all —
which arm B stated correctly and treated as useful information). One line number drifted by
one in arm C's Q1 report.

Neither trap fired. No arm reported `duplicateIssues` for the copy-paste question, and none
of the thirteen `undocumentedExports` substring matches surfaced in a Q2 report.

## The premise the run did not confirm

The benchmark was built to expose the failure the design note predicts for text search: the
agent searches the word in the task, the code uses a different word, the search comes back
empty, and the agent concludes nothing exists. That failure did not occur once in ten
text-search runs. Both grep arms found `repeatedExpressions` from "copy-pasted", the
checkpoint module from "record their current contents", and the ratchet from "worse than the
last recorded run".

The reason is visible in how they worked: this repository ships its own map in prose.
`AGENTS.md` names every package and what it is for, `docs/` holds a design note per subsystem,
and every source folder carries an `INDEX.md` that `npm run check` keeps honest. A grep agent
reads those first and gets the same orientation `repo_map` gives the scout. The
different-words problem is real, but on this repository at this size it is already solved by
documentation rather than by tooling — which is a finding about the repository, not a
refutation of the tool. It also means this benchmark cannot settle the question it was built
for until it runs against a repository without that documentation.

## Where the arms actually differed

**Cost.** The scout answered as well as a strong model with grep for 30% of the tokens, on a
model that costs a fraction per token on top of that. Per correct primary lead it is three
times cheaper than either baseline. That gap is the whole practical case for the scout, and it
held on every question.

**The honest negative.** Arm A failed Q4. Asked about posting to Slack when the gate fails, it
returned six real declarations from `packages/check` under the heading "leads for implementing
Slack notification" and never said that no notification code exists. Both text arms said it
plainly — arm C led with it, arm B closed with a verified gap statement: no outbound HTTP
client exists anywhere in `packages/*/src`, every `fetch` is browser-side UI code, and adding
one is a package-boundary decision with no ruling in `docs/decisions/`.

This is the failure mode the design note names as the one to watch, and the scout definition
already instructs against it ("if you find none, say 'no existing code helps with this
task'"). It fired in the earlier smoke test
([docs/scout-agent-test-2026-08-23.md](scout-agent-test-2026-08-23.md), query 4) and did not
fire here, so the behavior is unstable rather than absent. A reader who trusted arm A's Q4
report would start implementing believing the plumbing was half-built.

**Running things.** Arm B's Q1 report did not stop at naming the clone pipeline; it ran it.
The report states that `npm run clones -- --zone core --min-nodes 12` finds 151 repeating
shapes and that the top group is a 74-node asynchronous tail-read helper duplicated verbatim
in `packages/dashboard/src/invocations.ts:30`, `packages/hooks/src/tail.ts:25`, and
`packages/transcripts/src/index.ts:331`. Re-running the command reproduces all of it exactly.
That is a concrete, actionable finding about this repository that no arm without a shell could
have produced, and the scout's tool list has no shell.

**Judgment about consequences.** Arm B's Q5 report was the only one to notice that
`packages/check` is forbidden by `forbiddenEdges` (`packages/check/src/boundary.ts:23`) from
importing `packages/codemap`, so a folder-score gate cannot simply import `folderMetrics` —
the scoring has to move to `packages/core` or the step has to shell out. Every arm found the
same seven or eight symbols; only the strong model worked out that the obvious way to combine
them is blocked. Arm A's Q5 report was correct and useful, but stopped at "they would need to
be combined".

**Search shape.** The scout made twice as many tool calls as arm B (134 against 67) and still
spent a third of the tokens, because each call returns signatures rather than file bodies.
Wall-clock was a wash across all three arms.

## Assessment

The scout is worth running, for cost rather than for accuracy. On this repository it matches a
strong model with grep on hit rate and beats it three-to-one on tokens per useful answer, and
it did not hallucinate anything across five questions. As the first step before implementing —
"has someone already built this?" — it is the right default.

It is not a substitute for a capable agent in three situations, all of which this run
demonstrated rather than predicted:

- when the honest answer may be "this does not exist", because that is the one thing it got
  wrong;
- when the answer depends on running something, because it cannot;
- when the answer depends on whether the pieces can legally be combined, because that needs
  the repository's rules and not just its symbols.

Two changes follow from the run. First, the scout definition should check for absence before
it reports leads, rather than as a fallback at the end of its report rules — the current
ordering lets a partial match crowd the negative out. That change would invalidate this run as
a baseline for arm A, so it belongs with a re-run. Second, the different-words hypothesis needs
a repository without `AGENTS.md`-grade documentation to be tested at all; until then this
benchmark measures cost, hallucination rate, and honest-negative behavior, and should be
described that way.

## What limits this run

- One sample per cell. Fifteen agents, no repeats, so a single unlucky run moves a whole row.
  Q4's arm A result is the one that most deserves a repeat before it is treated as settled.
- The tool restriction on arms B and C was stated in their prompts, not enforced by the
  harness. Their reports cite only file paths and line numbers, consistent with grep and read,
  but a violation would not have been visible.
- The comparison is scout-versus-subagent. A real session's default is often the main agent
  searching inline, which pays the same token cost into a context that has to keep working
  afterwards — a cost this benchmark does not model.
- Q3's ground truth was wrong when the run started: it named `docsRegen`, the CLI wrapper,
  where the substantive answer is `regenerateDocs` in `docsgenIo.ts`. The spec has been
  corrected and scoring used the corrected set.

## Addendum — fixing the honest-negative failure

Same day, after the run above. Twenty-one further arm A runs across four versions of
`.claude/agents/scout.md`, testing whether the Q4 failure could be edited out. Only arm A
changed; the baselines are the ones recorded above.

The repository moved under the run: commit `ec1d405` landed from another session and shifted
`packages/check/src/run.ts` (`runCheck` 206 → 190, `applyBaseline` 62 → 61) and
`packages/backlog/src/docsgenIo.ts` (`regenerateDocs` 128 → 143). Several citations that looked
like drift were correct against the commit the agent actually saw. The spec's ground truth and
its maintenance section have been corrected; treat any `file:line` scoring across a mid-run
commit as suspect until re-checked.

### What was tried

| Version | Change | Q4 absence stated | Primary hits | Arm A tokens |
|---|---|---|---|---|
| v0 | as benchmarked above | no | 10/11 | 95k |
| v1 | added an existence check step; required a `verdict:` first line | yes, as a trailing note | 10/11 | 86k |
| v2 | v1 plus one full worked example of verdict-then-leads | no | 9/11 | 100k |
| v3 | dropped the `verdict:` line; kept the content rule | yes, but over-broad | 10/11 | 91k |
| v4 | v3 plus "claim an absence only for what you searched for" | yes, first sentence, correctly scoped | Q4 only | — |

### What the versions showed

**A required output token did not land, twice.** The `verdict:` line was specified in v1 and
demonstrated in a full example in v2. It appeared in zero of ten reports. The same definitions'
*prohibitions* did land — v2's "no framing sentence" removed the "Based on my exploration…"
opener that every v0 and v1 report carried. The scout model drops added format requirements
while obeying added constraints on what not to write.

**Rewriting the contract cost accuracy elsewhere.** v2's worked example used an abbreviated
signature column, and the next Q1 report replaced real signatures with `export const
repeatedExpressions`. v2 also produced the worst Q4 result of any version — no absence
statement at all, despite the example in front of it showing exactly that case. Every edited
version lost `takeSnapshot` on Q2, which v0 found.

**The instruction that worked was about content, not shape.** v3 and v4 say when to state an
absence, not how to format one, and both produced it. v4 states it in the first sentence.

**Guarding against one failure produced the next.** v3 stated the absence and then widened it:
"No existing Slack, webhook, environment variable reading, or HTTP client patterns found in the
repo." The environment-variable half is false — `wideCommitAllowed`
(`packages/hooks/src/io.ts:54`) and three `process.env` reads in `dashboard` and `codeview` do
exactly that. An unverified absence is the same error as an unverified lead, pointing the other
way, and it is more dangerous because absence claims are what stop someone looking. v4 adds a
rule bounding an absence claim to what was actually searched, and its Q4 report opens with "no
existing Slack integration code" and keeps the rest scoped.

### Provenance

Q1, Q2, Q3, and Q5 numbers for v3 come from a five-agent batch against v3. Q4's v4 result is a
single agent run against v4, which differs from v3 by one rule that only fires on an absence
claim. The other four questions have not been re-run against v4. The shipped definition is v4.
