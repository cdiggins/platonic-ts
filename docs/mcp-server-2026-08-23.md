# An MCP server for the mechanical half of coding

*2026-08-23*

Most of what a coding agent does to a repository is mechanical: find where something is
declared, see what is in a file, find everything that uses a symbol, rewrite one function,
rename something everywhere. The general-purpose tools an agent is given — read a file, search
text, replace a string — solve all of these, and solve none of them well. Each one reads more
text than the question needs, and two of them get the answer wrong in ways the agent cannot see.

`packages/mcp` is a server that answers those questions directly. It speaks the Model Context
Protocol over standard input and output, so any agent that supports the protocol can use it.
On this repository it is registered in [`.mcp.json`](../.mcp.json) and appears as the tools
`outline`, `symbol`, `usages`, `search`, `repo_map`, `replace_symbol`, `insert_symbol`,
`rename_symbol`, and `check`.

## Why the general tools are expensive

Reading a file to learn what is in it is the common case, and it is the wasteful one. A file's
shape — what it declares, in what order, with what signatures — is a tenth of its bytes. The
rest is the bodies, which the agent did not ask for and which it will read again the next time
it reads the file.

Searching text for a symbol has the opposite problem: it is cheap but wrong. `git grep truncate`
on this repository returns 23 lines. Nine of them are uses of the function called `truncate`.
The others are a different function whose name contains it, comments, and the word in prose.
The agent cannot tell which is which without reading around each hit, so it either reads more or
guesses. The failure runs the other way too: a symbol imported under a different name is not
found by searching for its name at all.

Editing by matching surrounding text is the third. To replace a function with `Edit`, the agent
must reproduce the existing text exactly, character for character, including whitespace and
comments it may have read some time ago. When the reproduction is wrong the edit fails and the
work is repeated; when it is right but not unique it can land in the wrong place.

## What the server does instead

The read tools answer with the shape rather than the bytes. `outline` returns one line per
declaration: line number, whether it is exported, and its signature. `symbol` returns exactly
one declaration and the comment written above it. `usages` returns the places a symbol is
actually used, resolved through the TypeScript type checker, with one line of context each.

The writing tools address a declaration by its name. `replace_symbol` takes a name and the new
source; there is no surrounding text to reproduce, so there is nothing to reproduce wrongly, and
the name identifies one declaration or the tool says which candidates it found. `insert_symbol`
adds a declaration to a file, optionally after a named one. `rename_symbol` rewrites the
declaration and every use of it across the repository in a single call.

Both writing tools reject source that does not parse before anything is written, and every tool
that changes a file re-reads it and compares it to what was indexed, so a plan computed against
stale text is refused rather than applied to the wrong offsets.

`check` runs the repository gate — typecheck, lint, escape-hatch ratchet, tests — and reports
the first failure. It is the same gate `npm run check` runs.

## What it costs

Measured on this repository, comparing the text each approach puts into the agent's context.
Tokens are estimated at four characters each, which is close enough for a ratio.

| Question | Conventional | Tokens | Server | Tokens | Saving |
|---|---|---|---|---|---|
| What is in `packages/core/src/index.ts`? | read the file | 2,111 | `outline` | 830 | 61% |
| Where is `truncate` used? | `git grep -n` | 558 | `usages` | 226 | 59% |
| Where is `search` used? | `git grep -n` | 487 | `usages` | 279 | 43% |
| Show me `collectReferences` | read `symbols.ts` | 3,136 | `symbol` | 138 | 96% |
| Rewrite `collectReferences` | `Edit` old text plus new | 150 | `replace_symbol` | 16 | 89% |

The two search rows understate the difference, because they compare a correct answer with an
approximate one. Of the 23 lines `git grep truncate` returns, 9 are uses of that function; of the
20 lines it returns for `search`, 9 are. The agent pays the larger number of tokens and still
does not know which subset it wanted.

The last row is the input to the edit call rather than the output. It is also where the accuracy
argument is strongest: a `replace_symbol` call cannot fail because the agent misremembered
whitespace, and a rename cannot half-apply.

The first call after a change costs about two seconds, which is the compiler indexing the
repository. Every call after that is two to four milliseconds, until a file changes and the
index is rebuilt. A tool that writes therefore costs the next call its rebuild — about 1.5
seconds here.

## What it does not do

The index covers `packages/*/src` and `packages/*/test`. Anything outside that is invisible to
every tool.

`rename_symbol` declines rather than guesses. Two source forms cannot be rewritten by replacing
an identifier in place: a shorthand property (`{ name }`) and a renamed import or export
(`{ name as other }`). When either appears anywhere with the name being renamed, the tool
reports the locations and does nothing. That is a real limit — the fix is to widen the rewrite
to handle both forms — but a rename that silently half-applies is worse than one that refuses.

There is no incremental indexing. Any write invalidates the whole index and the next call pays
to rebuild it. On a repository several times this size that trade would need revisiting.

Nothing here is Claude-specific, but nothing here has been tried with another agent either.

## How it is built

Zero runtime dependencies, like the rest of the repository. The protocol is a dozen lines of
JSON-RPC over newline-delimited standard input and output, written by hand in
`packages/mcp/src/protocol.ts` rather than taken from the reference SDK.

The symbol index comes from `packages/codemap`, which the code browser already uses; this server
adds the query and edit layers on top of it. Deciding what to change is pure and tested against
in-memory sources (`packages/mcp/test`); writing to disk is a separate step in
`packages/mcp/src/io.ts`. An edit plan is a list of byte ranges and their replacements, which is
what makes the interesting half testable without a filesystem.
