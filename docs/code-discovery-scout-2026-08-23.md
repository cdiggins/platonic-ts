# Answering fuzzy questions about a codebase

*2026-08-23*

Before an agent writes code, it should ask whether the repository already contains something
that helps: a function to reuse, a type to extend, a pattern to follow. That question is fuzzy —
"what exists here that is relevant to this task?" — and the tools that answer precise questions
answer it badly. This note captures a design discussion about closing that gap, compares the
approach with how other tools handle the same problem, and ends with a decision.

## The problem: the words don't match

Text search fails on the fuzzy question for a structural reason: the agent searches for the
word it has in mind while the code uses a different word. An agent looking for a way to limit
how often a function runs searches for `throttle` and never finds the function called
`debounce`, even though that function is exactly what it needs. The failure is invisible — the
search returns nothing, the agent concludes nothing exists, and it writes a duplicate.

The MCP server in `packages/mcp` ([design note](mcp-server-2026-08-23.md)) already supports the
browsing half of discovery. `repo_map` gives a one-line-per-folder overview, `outline` lists
what one file declares, `symbol` returns one declaration. That is the drill-down; what is
missing is the entry point. `search` is a case-insensitive substring match over symbol names,
so it fails on precisely the different-words case that makes the question fuzzy.

## The proposal: three layers, in order

The layers are ordered so that each is useful alone and each produces the evidence for whether
the next is needed.

### 1. Put meaning into the map

Today `repo_map` reports folder names, file counts, line counts, and quality scores — sizes,
not purposes. The enrichment is to also list the important declarations, each with its name,
kind, signature, and the first line of its documentation comment. The index in
`packages/codemap` already holds all of this.

When the full listing exceeds a token budget, keep the declarations the rest of the repository
refers to most. The reference data collected for `usages` gives incoming-reference counts per
declaration for free; ranking by that count (or by a graph-centrality measure over the
reference graph, if plain counts prove too crude) keeps the load-bearing names and drops the
leaves. A one-screen listing of ranked signatures answers many fuzzy questions with no model
involved, because a reader — human or agent — can recognize relevance in a signature where a
keyword match cannot.

### 2. A scout agent resolves the fuzzy query

For the questions the map alone cannot answer, a cheap model acts as a scout. It receives the
task description, the enriched map as starting context, and only the read-only tools
(`outline`, `symbol`, `usages`, `search`). Its entire contract: return the handful of most
promising functions and types, with signatures, and one sentence each on why. The coding agent
starts from that report and confirms the leads with `symbol` before relying on them.

Three things make this economical where a generic research subagent is not:

- A model reading `debounce`'s signature recognizes that it solves the "throttle" problem —
  the different-words failure disappears.
- The read tools put 43–96% fewer tokens into a context than reading and searching files
  ([measurements](mcp-server-2026-08-23.md#what-it-costs)), so the exploration itself is cheap
  enough to run on a weak model.
- The main agent's context receives only the distilled report, not the exploration.

The scout also doubles as the test harness for layer 1: every question it fails to answer from
the map is a report on what the map is missing.

### 3. Semantic search, deferred

The heavier approach is to convert every declaration into a numeric fingerprint of its meaning
(an embedding) and answer a question by finding the declarations whose fingerprints sit closest
to it. That solves the different-words problem mechanically, without an agent, and it scales to
repositories too large for any agent to browse. It also brings a conversion pipeline that must
be kept current as files change, and a similarity cutoff that must be tuned.

At this repository's size, a scout reading a good map should be more accurate per dollar. The
embedding approach becomes worth its costs when the map itself no longer fits in a scout's
context — which matches the later multiple-repository ambition, not the current situation. The
decision is deferred, not rejected, and the measurement below is what would revisit it.

## How other tools handle this

The landscape splits into three architectural camps, and the proposal above is deliberately a
hybrid of two of them.

**Index-first: Aider.** Aider is the closest prior art for layer 1, and the strongest evidence
that it works. Aider parses every source file with tree-sitter, extracts where definitions
occur and where they are referenced, and builds a graph in which files are nodes and
references between them are edges. A graph-ranking algorithm scores the identifiers most often
referenced by the rest of the code, and the highest-ranked definitions — with their signatures
— are assembled into a repository map trimmed to a token budget (1,000 tokens by default).
That map is sent to the model with every request, so the model can see distant code it has
never read ([how it works](https://aider.chat/docs/repomap.html),
[design article](https://aider.chat/2023/10/22/repomap.html)).

Two differences matter. Aider's map is built from syntax alone — tree-sitter sees names, not
meanings, so a reference is a name match, with the same aliasing blind spots as text search.
This repository's index comes from the TypeScript checker, so references are resolved, and the
ranking would count real uses. And Aider pushes its map into every prompt, paying the budget on
every request whether or not the task needs orientation; a `repo_map` tool is pulled on demand
and costs nothing when unused. Aider's design is shaped by having no agent loop to pull with —
it predates cheap tool calls. With an agent loop available, pull is strictly better.

**Agentic search: Claude Code.** Claude Code ships no index at all; the agent explores with
generic search and read tools at task time, deciding what to look at as it goes. That is
maximally flexible and always current, but every exploration starts from zero and pays full
price in tokens, and it inherits text search's blindness to the different-words problem.
The scout is agentic search made cheap: the same explore-as-you-go loop, but starting from a
map instead of from nothing, drilling with tools that answer in signatures instead of file
bodies, and run on a model priced for the errand.

**Embedding and graph indexes: Cursor, Sourcegraph Cody.** Cursor builds embedding indexes for
semantic retrieval; Sourcegraph pairs embeddings with a precompiled structured code graph for
symbol-level answers at monorepo scale
([comparison of approaches](https://intuitionlabs.ai/articles/ai-code-assistants-large-codebases)).
These are layer 3 built as infrastructure, and they demonstrate both sides of the trade:
recent independent measurements find large token and tool-call reductions from indexed
retrieval on large codebases
([survey](https://zylos.ai/research/2026-04-19-codebase-intelligence-repository-understanding-ai-agents/)),
and the cost is exactly the pipeline-and-staleness burden that layer 3 defers. Notably, this
repository already owns the expensive ingredient — a checker-backed symbol index kept current
incrementally — so the marginal cost of embeddings later is the fingerprinting, not the
indexing.

**Process frameworks: Superpowers.** [Superpowers](https://github.com/obra/superpowers) is a
skill library that tells an agent how to work: plan in small tasks, dispatch a fresh subagent
per task, review in stages, keep the main context clean by having subagents return distilled
summaries. Its research-subagent pattern is the scout's choreography — but its subagents
explore with generic tools, so the investigation is expensive and its quality depends on the
model stumbling into the right files. The relationship is complementary, and it states the two
projects' theses: Superpowers bets that better process makes agents effective; this repository
bets that better tools and code shape do. The scout is the process pattern with purpose-built
instruments under it.

## Measuring it

The same discipline as the MCP server's evaluation: pose a fixed set of fuzzy questions
("does anything here already do X?") where the right answer is known, and compare the scout —
enriched map plus read tools on a weak model — against a general-purpose agent with text
search. Score tokens consumed, whether the right declaration was found, and whether anything
was hallucinated. The two failure modes to watch are misses (the scout stops at the map and
never drills) and false confidence (the report names a plausible symbol that does not do what
the sentence claims — which is why the coding agent confirms leads with `symbol`).

## Decision

Build layer 1 (enrich `repo_map` with ranked, documented signatures under a token budget) and
layer 2 (a scout subagent definition with a fixed report contract), measure them against
text-search baselines, and defer layer 3 until the map outgrows a scout's context. The scout
lives in the agent harness as a subagent, not inside the MCP server: the harness already
provides permissions, supervision, and the observability dashboard, and moving it server-side
only pays off if other MCP clients need it. Tracked as a backlog item.
