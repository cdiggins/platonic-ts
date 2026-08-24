# Status

Early prototype. Started August 22nd, 2026.

## What exists

An npm-workspaces monorepo built by parallel fenced agent waves. The process is described in
[CONTRACTS.md](../CONTRACTS.md) and the findings in [NOTES.md](../NOTES.md). The package
inventory is in the [README](../README.md#packages-and-commands), which regenerates it from the
workspace manifests.

A functional-subset ESLint configuration, run as part of `npm run check`.

A live agent-observability dashboard (`npm run dashboard`, port 4747). It tails Claude Code
session transcripts and shows agents, models, token rates, the backlog, and documents in real
time. It covers agent activity and logged work only. Browsing and scoring the source code is a
separate tool's job; the boundary is explained in
[Tools, Skills, and Process](tools-and-process.md#scope-what-the-dashboard-is-not).

That separate tool now exists: a code overview browser (`npm run codeview`, port 4848). It
indexes the repository's own TypeScript with the compiler API and serves syntax-coloured source
with go-to-definition, find-references, rendered markdown, per-function and per-folder quality
metrics, and a feedback box that files backlog items.

A session-corpus analyzer (`npm run transcripts`) reports where tokens went across a project's
Claude Code transcripts — context composition, per-tool and per-file cost, and skill usage.
It is documented in
[Tools, Skills, and Process](tools-and-process.md#npm-run-transcripts--session-corpus-analyzer).

An MCP server (`npm run mcp`, registered in `.mcp.json`) gives an agent tools for the mechanical
work: file outlines, one declaration at a time, type-checked find-references, rename across the
repository, editing addressed by declaration name rather than by matching surrounding text, and
the check gate. Measured against the general-purpose read, search, and edit tools on the same
questions, the first nine of those tools put 43% to 96% fewer tokens into the agent's context,
and answered two of the questions correctly where text search did not. The design note and the
measurements are in [An MCP Server for the Mechanical Half of Coding](mcp-server-2026-08-23.md);
the server has since grown to 33 tools, which have not been measured the same way.

## Conventions in force

The backlog follows the [WorkQuarry](https://github.com/ara3d/workquarry) issue-tracking schema,
implemented natively in TypeScript. The reasoning is in the
[adoption ADR](../decisions/2026-08-22-adopt-workquarry-format.md).

The tools, skills, and multi-agent process are documented for humans in
[Tools, Skills, and Process](tools-and-process.md). The design notes are indexed from the
[Documents section of the README](../README.md#documents).
