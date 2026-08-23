---
id: BL-0026
title: MCP server for mechanical coding tasks
type: feature
status: done
priority: p2
effort: M
risk: med
area: packages/mcp
sprint:
created: 2026-08-23
closed: 2026-08-23
links: [BL-0016, BL-0019]
---

## Problem
The mechanical work an agent does to this repository — find a declaration, see what is in a
file, find every use of a symbol, rewrite a function, rename something everywhere — is done with
general-purpose tools that read far more text than the question needs, and that are wrong in
ways the agent cannot detect. Text search cannot tell a use of `truncate` from a use of
`truncateDetail`, and cannot find a symbol imported under another name. Editing by matching
surrounding text fails whenever the agent misremembers whitespace.

## Impact
Every one of these is on the hot path of nearly every task, so the waste compounds across a
session. Measured on this repository, reading a file to learn its shape costs about 2.5 times
what the shape costs; reading one function out of `packages/codemap/src/symbols.ts` costs 23
times what that function costs.

## Affected code
- `packages/mcp` — new package: protocol, tool catalogue, queries, edit planning, rename, IO.
- `packages/codemap` — reused for symbols, references, and folder metrics.
- `packages/check` — reused for the `check` tool and the source-file walk.
- `.mcp.json` — project-scoped registration.

## Fix approaches
- **Wrap the existing index in an MCP server.** Reuses the code browser's index; the new work is
  the query, edit, and protocol layers.
- **Extend the code browser's HTTP API instead.** No new protocol, but agents would need a
  bespoke client and could not discover the tools.
- **Ship a CLI.** Cheapest, but every call pays the process start and the index rebuild.

## Simplest fix
The first: an MCP server over the existing `CodeIndex`, with editing addressed by declaration
name rather than by matching text.

## Done means
- [x] Nine tools: outline, symbol, usages, search, repo_map, replace_symbol, insert_symbol,
      rename_symbol, check
- [x] Edits are planned purely and tested against in-memory sources; writing is separate
- [x] Rename resolves through the type checker, and declines where it cannot rewrite safely
- [x] Registered in `.mcp.json`; `npm run mcp` runs it directly
- [x] Token cost measured against the conventional tools and written up in
      [docs/mcp-server-2026-08-23.md](../docs/mcp-server-2026-08-23.md)
- [x] `npm run check` green

## Follow-ups
- Incremental reindexing: any write currently invalidates the whole index, so the next call pays
  about 1.5 seconds to rebuild it.
- Widen `rename_symbol` to rewrite shorthand properties and renamed import specifiers instead of
  declining when it meets them.
- Index beyond `packages/*/src` and `packages/*/test`.
