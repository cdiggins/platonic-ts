---
id: BL-0028
title: Answer fuzzy availability questions with a ranked map and a scout agent
type: idea
status: idea
priority: "?"
effort: "?"
risk: "?"
area: mcp
sprint:
created: 2026-08-23
links: [docs/code-discovery-scout-2026-08-23.md, BL-0026, BL-0019, packages/mcp/src/query.ts, packages/core/src/index.ts]
---

## Idea
Before writing code, an agent should be able to ask "what already exists here that helps with
task X?" and get a trustworthy answer. Text search fails on this when the agent's word differs
from the code's word (searches `throttle`, misses `debounce`). Two additions close the gap:
enrich `repo_map` so it lists the most-referenced declarations with kind, signature, and first
doc line under a token budget (Aider's repository-map idea, but built on checker-resolved
references instead of tree-sitter name matches); and define a scout — a subagent on a cheap
model, given the task, the enriched map, and only the read-only tools — whose contract is a
short report of the most promising functions and types with one sentence each on why. Full
design discussion and tool-landscape comparison: [the design
note](../docs/code-discovery-scout-2026-08-23.md).

## Assumptions
- Duplicate-avoidance and reuse failures are frequent enough to justify a discovery step
  before implementation (worth confirming from transcripts via `npm run transcripts`).
- A weak model reading signatures can recognize relevance across vocabulary mismatch — the
  premise of layer 2; the measurement exists to test it.
- Incoming-reference count is a good enough importance proxy to pick which declarations make
  the map's budget cut.

## Design decisions
- **Ranking — plain reference counts vs graph centrality.** Counts are one pass over
  `CodeIndex.references`; centrality (PageRank-style over the reference graph) resists the
  "one hub file inflates its helpers" distortion but adds an algorithm. Start with counts;
  the measurement says whether distortion shows up.
- **Doc line extraction — index time vs query time.** `SymbolInfo` has `signature` but no doc
  comment; the MCP `symbol` tool extracts comments on demand. Storing a `docLine` on
  `SymbolInfo` grows the index BL-0019 wants trimmed; extracting per `repo_map` call re-reads
  files. Interacts with BL-0019's outline/index split.
- **New tool vs richer `repo_map`.** Overloading `repo_map` keeps the tool count at nine but
  couples orientation (folder sizes) with discovery (ranked symbols); a separate `index` or
  `map_symbols` tool keeps each answer small.
- **Scout placement — harness subagent vs in-server.** Design note decides: harness subagent
  (reuses permissions, supervision, dashboard). Server-side only if other MCP clients need it.
- **Budget shape — fixed token cap vs caller-supplied.** Aider defaults to 1,000 tokens and
  resizes dynamically; a `budget` parameter is simpler and lets the scout ask for more.

## Related
- [BL-0026] — the MCP server this extends; its "what it does not do" list is where this item's
  gaps live.
- [BL-0019] — trims the index payload and proposes a `CodeOutline` split; the doc-line decision
  above should land on whichever side of that split survives.
- [docs/code-discovery-scout-2026-08-23.md] — the design note this item implements; includes
  the Aider / Claude Code / Cursor / Cody / Superpowers comparison and the measurement plan.
- [docs/mcp-server-2026-08-23.md] — token measurements that make a weak-model scout economical.

## Approaches
Short term:
1. Ranked signatures in `repo_map` (or a sibling tool): sort exported declarations by
   non-definition reference count, emit `name — kind — signature` until the budget is spent.
   Pure function over `CodeIndex`, testable in-memory like the rest of `packages/mcp`.
2. Scout subagent definition (`.claude/agents/scout.md` or equivalent): read-only MCP tools,
   fixed report contract ("3–8 leads: name, signature, why"), weak model.
3. The measurement: fixed fuzzy questions with known answers, scout vs text-search agent,
   scored on tokens, hit rate, and hallucinated leads.
Long term: semantic (embedding) search over declarations when the map outgrows a scout's
context — deferred by the design note, revisited by the measurement; the incremental index
already solves the staleness half of that pipeline.
Adjacent ideas worth their own item: none — the transcript-mining assumption check fits
BL-0008/`npm run transcripts` as-is.

## Bedrock
The seam is that discovery ranking becomes a pure function `CodeIndex -> ranked declarations`
in `packages/mcp/src/query.ts` (or codemap, if codeview wants it too) — the same index, one
new query, no new state. That keeps the later embedding layer a drop-in replacement for the
ranking function rather than a parallel infrastructure, and it gives the scout measurement a
stable target. **Verdict: simplest-along-the-grain.** The simple version must NOT extract doc
comments by re-reading files inside the query — doc lines come from the index or wait for
BL-0019's split, so the query stays pure over `CodeIndex`.

## Done means
- [x] A tool call returns the repository's most-referenced exported declarations with
      signatures, trimmed to a token budget
- [x] A scout subagent definition exists with the fixed report contract
- [ ] The fuzzy-question benchmark runs: scout vs text-search baseline, reporting tokens and
      hit rate
- [ ] The `throttle`/`debounce`-shaped question (right answer under a different name) is
      answered correctly by the scout on this repository

## Simplest possible implementation
One pure function in `packages/mcp/src/query.ts`: count non-definition references per exported
symbol from `CodeIndex.references`, sort descending, emit `name — kind — signature` lines until
a character budget is hit; expose as a `budget`-parameterized variant of `repo_map`. Plus a
one-file scout agent definition. No doc lines, no centrality, no embeddings.

- Gets: the different-words fix in its cheapest form; the benchmark can run against something
  real; zero new dependencies or index changes.
- Gives up: no doc lines means signatures carry the whole meaning burden (weak for `(a: number,
  b: number) => number`-shaped helpers); plain counts may over-rank plumbing symbols; `repo_map`
  grows a second responsibility.
