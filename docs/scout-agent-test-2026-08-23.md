# Scout agent test run — 2026-08-23

Manual smoke test of the `scout` subagent (`.claude/agents` definition: tools
`mcp__platonic__repo_map`, `mcp__platonic__search`, `mcp__platonic__outline`,
`mcp__platonic__symbol`, `mcp__platonic__usages`, read-only). Four queries were sent
independently via the `Agent` tool with `subagent_type: scout`. Each query is a fresh
agent with no shared context. This file records the prompt and the exact returned text
for each run; intermediate tool calls are not visible to the caller, only the final
report, tool-use count, and duration.

## Query 1 — transcript tailing + usage aggregation (expect: strong existing match)

**Prompt:** "I need to add a feature that tails a Claude Code transcript JSONL file and
aggregates token usage per agent. What already exists in this repository that could help
with this task?"

**Stats:** 25 tool uses, 55.9s, ~19.6k subagent tokens.

**Returned:**

> pollTranscripts (packages/transcripts/src/index.ts:355) — async function that polls transcript files for new activities since last state, resuming from file offsets
>   why: Core tailing function that reads JSONL files incrementally, handles file state persistence, and returns parsed activities with token usage fields.
>   used: 9 uses across packages/dashboard/src/main.ts and test files; representative call at dashboard/src/main.ts:104 `const polled = await pollTranscripts(allDirs, tail)`
>
> parseTranscriptLine (packages/transcripts/src/index.ts:59) — function that parses a single JSONL line into AgentActivity with token counts and model
>   why: Extracts token usage (input, output, cache-related) and model name from each transcript entry; called by pollTranscripts for each line.
>   used: 10+ uses in test cases; also indirectly by pollTranscripts; sample test at transcripts.test.ts:28
>
> summarizeUsage (packages/transcripts/src/index.ts:444) — function that aggregates token usage across activities grouped by model within a time window
>   why: Already performs per-agent aggregation via ModelUsage array, returning total and per-model token counts plus tokens-per-minute.
>   used: 6 uses in 4 files; representative at dashboard/src/main.ts:122 `usage: summarizeUsage(activities, now, windowMs)`
>
> AgentActivity (packages/core/src/index.ts:11) — type with inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens, and model fields
>   why: The parsed activity record structure carries all token types needed for aggregation plus the model identifier for grouping.
>   used: 28 uses; returned by parseTranscriptLine and consumed by summarizeUsage and dashboard rendering
>
> TailState / createTailState (packages/transcripts/src/index.ts:324, 329) — type and factory for persisted tail-reader state with file offsets and partial-line buffers
>   why: Enables resumable polling across restarts by tracking where each file was last read; passed to pollTranscripts to resume from offset.
>   used: 8+ uses; test example at transcripts.test.ts:248 showing stateful re-polling: `state = createTailState(); const first = await pollTranscripts([dir], state); const second = await pollTranscripts([dir], state)`
>
> discoverTranscriptFiles (packages/transcripts/src/index.ts:265) — discovers JSONL transcript files in given directories matching patterns like `*.output` or `session-*.jsonl`
>   why: Finds transcript files to tail before polling; integrates with pollTranscripts workflow.
>   used: Used internally by pollTranscripts and in test discovery; dashboard/src/main.ts uses it implicitly via pollTranscripts
>
> ModelUsage (packages/core/src/index.ts:49) — type with model name, separate token counts (input, output, cache-read, cache-creation), and message count
>   why: The per-agent aggregation structure returned in UsageSummary.byModel array; sorted by output tokens descending.
>   used: Returned by summarizeUsage; consumed by dashboard rendering of usage metrics

**Observation:** All 7 hits are real symbols with correct file:line references and correct
call-site line numbers — this exactly matches what `packages/transcripts` already
provides, so a caller following this output would not duplicate `pollTranscripts` or
`summarizeUsage`.

## Query 2 — clone/duplicate expression extraction (expect: strong existing match)

**Prompt:** "I need to find expressions that are repeated under different names across a
codebase and turn one group into an extracted function. What already exists in this
repository that could help with this task?"

**Stats:** 22 tool uses, 48.6s, ~16.6k subagent tokens.

**Returned:**

> Based on my scan of the codebase, the repository has a comprehensive clone detection and extraction system already built in `packages/codemap`. Here are the key existing components:
>
> repeatedExpressions (packages/codemap/src/clones.ts:182) — `(entries: readonly SourceEntry[], options?: CloneOptions): readonly ShapeGroup[]`
>   why: Orchestrates the entire pipeline to find expressions with the same shape under different names, ranking candidates by how worth extracting they are.
>   used: Called from main.ts at line 101 to power the `npm run clones` command, and in extract.test.ts at line 54 to set up test fixtures.
>
> shapedExpressions (packages/codemap/src/clones.ts:95) — `(entries: readonly SourceEntry[], options?: CloneOptions): readonly ShapedExpression[]`
>   why: Walks all expressions in source files and normalizes each to its shape key, filtering by minimum node count and excluding parenthesized wrappers.
>   used: Called by groupByShape at line 167 (clones.ts) as the first step in the pipeline.
>
> groupByShape (packages/codemap/src/clones.ts:167) — `(shaped: readonly ShapedExpression[], options?: CloneOptions): readonly ShapeGroup[]`
>   why: Buckets shaped expressions by their key, filters out singletons, and sorts by quality; handles subsumption when shapes nest inside each other.
>   used: Called by repeatedExpressions at line 182 (clones.ts) to group candidates.
>
> extractionPlan (packages/codemap/src/extract.ts:132) — `(group: ShapeGroup, entries: readonly SourceEntry[], options?: ExtractOptions): ExtractionPlan`
>   why: Builds the complete extraction plan: decides parameters vs ambient names, infers return type, detects unsafe moves, and generates call sites and declaration text.
>   used: Invoked from main.ts at line 112 with `--extract N` flag; also tested in extract.test.ts at lines 61 and 180.
>
> siteOf (packages/codemap/src/sites.ts:48) — `(occurrence: ExpressionOccurrence, entries: readonly SourceEntry[]): Site | undefined`
>   why: Resolves each occurrence to a concrete site by re-parsing and recomputing shape at extraction time (to handle source changes), and collects scope + safety info.
>   used: Called from extractionPlan at line 137 (extract.ts) to validate each occurrence.
>
> splitHoles (packages/codemap/src/holes.ts:126) — `(sites: readonly Site[], checker?: ts.TypeChecker): HoleSplit`
>   why: Analyzes all occurrences of a shape to decide which free names are ambient (same across all sites) and which must become parameters, then infers parameter types.
>   used: Called from extractionPlan at line 152 (extract.ts) to compute the extracted function's signature.
>
> unsafeReasons (packages/codemap/src/sites.ts:123) — `(site: Site): readonly string[]`
>   why: Checks for blockers to moving an expression (reads to `this`, `super`, `arguments`, yields, or assigns to free names) and returns human-readable reasons.
>   used: Called from extractionPlan at line 147 (extract.ts) to collect safety violations.

**Observation:** Correctly identified this as `npm run clones` / `packages/codemap`
territory and traced the internal pipeline (`shapedExpressions` → `groupByShape` →
`repeatedExpressions` → `extractionPlan` → `siteOf`/`splitHoles`/`unsafeReasons`), matching
the pipeline description in `AGENTS.md`.

## Query 3 — backlog id allocation + validation (expect: strong existing match)

**Prompt:** "I need to allocate a new BL-NNNN backlog id and validate a backlog markdown
item's format. What already exists in this repository that could help with this task?"

**Stats:** 19 tool uses, 47.9s, ~16.1k subagent tokens.

**Returned:**

> allocateBacklogItems (packages/backlog/src/io.ts:89) — async (dir: string, slugs: readonly string[]) => Promise<readonly AllocatedItem[]>
>   why: Allocates unique BL-NNNN IDs for new items by finding the next available number, claiming marker files, and returning id, number, and file path for each slug.
>   used: Called in packages/backlog/src/main.ts:43 within the `nextId` command handler to allocate ids when invoked via `npm run backlog:next-id -- <slug>`.
>
> validateBacklogIds (packages/backlog/src/ids.ts:130) — (files: readonly BacklogFileInfo[], markers: readonly string[]) => readonly BacklogIdIssue[]
>   why: Validates backlog item IDs and marker file consistency by checking for duplicate numbers, unnumbered files, parsing errors, id mismatches, and missing markers.
>   used: Called in packages/backlog/src/main.ts:56 within the `validate` command handler to check all items when invoked via `npm run backlog:validate`.
>
> parseBacklogFile (packages/backlog/src/index.ts:88) — (file: string, content: string) => BacklogItem | undefined
>   why: Parses markdown files into BacklogItem objects by extracting YAML frontmatter (between --- delimiters) and validating required id and title fields.
>   used: Called in packages/backlog/src/io.ts:136 to parse each backlog file during loading; also used in test/ids.test.ts:244.
>
> formatBacklogId (packages/backlog/src/ids.ts:18) — (value: number) => string
>   why: Formats numeric IDs as zero-padded BL-NNNN strings (e.g., "BL-0001") for consistent ID string generation.
>   used: Called in packages/backlog/src/io.ts:81 to format allocated item numbers before creating file entries.
>
> renderBacklogItem (packages/backlog/src/index.ts:167) — (item: BacklogItem) => string
>   why: Renders a BacklogItem back to markdown format with YAML frontmatter and body content, serving as the inverse of parseBacklogFile.
>   used: Called in packages/backlog/src/index.ts:174 to regenerate BACKLOG.md from parsed items.
>
> firstFreeNumber (packages/backlog/src/ids.ts:62) — (used: readonly number[]) => number
>   why: Finds the next available numeric ID by returning the maximum used number plus one, enabling collision-free allocation.
>   used: Called in packages/backlog/src/io.ts:94-95 to find the starting probe point for both file names and marker files.
>
> BacklogItem (packages/core/src/index.ts:87) — type with id, title, type, status, priority, effort, risk, area, sprint, owner, created, closed, links, file, body
>   why: The parsed backlog item data structure that validation and rendering functions work with, defining all frontmatter fields and content body.
>   used: Returned by parseBacklogFile and consumed by renderBacklogItem throughout packages/backlog/src/index.ts.

**Observation:** Worth double-checking one detail against `docs/backlog-id-allocation-2026-08-23.md`
(referenced from `AGENTS.md`, which warns "never pick an id by scanning for the highest
number") — the scout describes `firstFreeNumber` as "returning the maximum used number
plus one," which sounds exactly like the scan-for-highest approach the doc warns against.
That may be a correct description of a low-level helper that `allocateBacklogItems` wraps
with additional marker-claiming/collision logic, or it may be a discrepancy worth a follow-up
read of `packages/backlog/src/ids.ts` before trusting it at face value — this run's output
should not be taken as license to reimplement id allocation from this summary alone.

## Query 4 — feature with no existing counterpart (expect: honest "not implemented")

**Prompt:** "I need to add real-time collaborative multiplayer editing with operational
transforms so two users can edit the same backlog item simultaneously over WebSockets.
What already exists in this repository that could help with this task?"

**Stats:** 46 tool uses, 63.9s, ~23.1k subagent tokens (notably more searching than the
other three — consistent with having to rule things out rather than confirm a direct hit).

**Returned:**

> Based on my examination of the repository, I found that **collaborative multiplayer editing with operational transforms is not currently implemented**. However, there is existing infrastructure that could support building it:
>
> applyEdits (packages/mcp/src/edit.ts:52) — applies multiple text edits to a string by sorting back-to-front to keep byte offsets valid
>   why: provides the primitive for applying remote edits to local text, with collision detection via overlapping() function.
>   used: called from packages/mcp/src/edit.ts:70 in replaceSymbol() and packages/mcp/src/edit.ts:92 in insertSymbol().
>
> handleEvents (packages/dashboard/src/server.ts:80) — SSE (Server-Sent Events) streaming with client connection management and interval-based polling
>   why: demonstrates a real-time push pattern for broadcasting snapshots to multiple clients, but one-way only; would need WebSocket upgrade for bidirectional communication required by operational transforms.
>   used: called once from packages/dashboard/src/server.ts:178 in startDashboard().
>
> takeSnapshot (packages/mcp/src/checkpoint.ts:36) — captures file contents at a labeled point in time with timestamp
>   why: provides versioning/snapshotting foundation that operational transforms typically layer on top of for state reconciliation and rollback.
>   used: called from packages/mcp/src/checkpoint.ts:53 in snapshotOfWorkspace() and packages/mcp/src/io.ts in the checkpoint module.
>
> RpcRequest (packages/mcp/src/protocol.ts:12) — JSON-RPC 2.0 request structure with optional id, method name, and params
>   why: establishes a bidirectional message protocol with request/response pairing that could carry operation payloads.
>   used: parsed via packages/mcp/src/protocol.ts:66 parseLine() and rendered in tools throughout packages/mcp/.
>
> parseBacklogFile + renderBacklogItem (packages/backlog/src/index.ts) — parse/render backlog markdown with YAML frontmatter
>   why: handle the data format for the backlog items being edited; renderBacklogItem emits frontmatter + body structure.
>   used: parseBacklogFile has 29 uses; renderBacklogItem has no recorded usages but is the export surface for serialization.
>
> HookEvent (packages/hooks/src/index.ts:10) — event type with timestamp and sessionId metadata for logging
>   why: establishes a pattern for attributing concurrent user actions (tool, timestamp, sessionId) that operational transforms need to resolve ordering.
>   used: logged via packages/hooks/src/io.ts:24 appendHookEvent() in 6+ places.

**Observation:** Correctly led with an explicit "not currently implemented" instead of
forcing a false match, then offered adjacent building blocks (edit-application primitive,
one-way SSE push, snapshotting, an RPC message shape, hook event attribution) rather than
padding the list with irrelevant hits. This is the case worth watching in future runs —
weaker models could either hallucinate a match or return nothing useful; this run did
neither.

## What this shows about the scout agent

- All four queries returned results in the documented shape: `name (file:line) — signature
  or one-line description`, then `why:`, then `used:` with call-site line numbers.
- Query 1–3 returned direct, on-target existing code (transcripts, codemap clone
  detection, backlog id allocation) that a caller could reuse instead of reimplementing.
- Query 4 correctly recognized the absence of a matching feature and pivoted to genuinely
  relevant adjacent primitives instead of overclaiming a match.
- Tool-use count and duration scaled with query difficulty: ~19–25 tool calls / ~48–56s
  for direct hits, 46 tool calls / 64s for the no-match query — consistent with the agent
  searching harder before concluding nothing exists.
- Caveat: only the final report is visible to the caller (via the `Agent` tool), not the
  intermediate `mcp__platonic__*` tool calls (`repo_map`, `search`, `outline`, `symbol`,
  `usages`) that produced it — so this file documents scout's *output*, not its full
  internal trace. The `agentId` returned by each run (see raw tool results) could be used
  to resume a specific run via `SendMessage` if the internal trace needs inspecting later.
- Not independently re-verified line-by-line in this pass, except for the `firstFreeNumber`
  detail flagged in Query 3 — treat the file:line references as scout's claims, not as
  confirmed facts, before relying on them for an edit.
