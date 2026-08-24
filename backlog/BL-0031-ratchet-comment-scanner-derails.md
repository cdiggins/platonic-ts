---
id: BL-0031
title: Ratchet comment scanner derails on templates, missing 24% of comments
type: bug
status: ready
priority: p1
effort: S
risk: low
area: packages/check
sprint:
created: 2026-08-23
closed:
links: [packages/check/src/ratchet.ts, packages/mcp/src/inspect.ts, ratchet.json]
---

## Symptom

`collectCommentText` in `packages/check/src/ratchet.ts` drives `ts.createScanner` token by token
with no parser above it. A context-free scanner cannot resume a template literal: at the `}`
closing a `${...}` substitution it emits a close-brace token, and the rest of the template is
re-read as ordinary source. When that remainder holds an unbalanced quote, the scanner enters a
string or template it never leaves, and every comment after that point in the file is invisible.

Measured across `packages/*/{src,test}`: **58 of 145 files lose comments; the scanner sees 1,437
of 1,893 comment ranges (24% invisible).**

Concrete case — `packages/mcp/src/inspect.ts:185` builds a `RegExp` from a template whose text
after the substitution starts with `"`. The scanner stops seeing comments at line 183, so the
`eslint-disable` on line 219 is not counted. `countEscapeHatches` returns `eslintDisables: 0` for
that file.

## Impact

Two of the ratchet's six axes — `tsDirectives` and `eslintDisables` — are computed from comments,
so a suppression comment placed after the first derailing template in 40% of files is uncounted
and `npm run check` reports `ok`. The other four axes come from the syntax tree and are
unaffected.

The MCP server's `escape_hatch_index` implements the same count independently, via
`ts.getLeadingCommentRanges` in `hatchesOfFile` (`packages/mcp/src/inspect.ts`), and currently
reports `regressed: eslintDisables` on the same tree where the gate reports clean. Its tool
description claims the two "cannot disagree". Nothing tests them against each other.

Neither implementation is simply right. The gate under-scans. The MCP version over-counts,
because it treats prose that mentions `eslint-disable` as a suppression, and it misses trailing
comments since it reads only leading ranges.

## Fix

1. Replace the raw-scanner walk with comment ranges taken from the parsed source file, which
   `countEscapeHatches` already creates. Cover both leading and trailing ranges.
2. Require a directive to *begin* the comment (optionally after whitespace), so prose mentions
   stop counting. Under this rule the `@ts-ignore` mention in `packages/check/src/ratchet.ts:7`
   is no longer a directive, and the baseline's `tsDirectives: 1` becomes 0.
3. Add a differential test asserting `packages/check`'s per-file counts and the MCP server's
   `hatchesOfFile` agree on every file in the repository.
4. Re-bless `ratchet.json` in a separate commit from the instrument change. Correcting the
   scanner can only raise counts, and an automatic rewrite on "improvement" cannot distinguish a
   real fix from an instrument that silently sees less.

## Simplest version

Steps 1 and 4 alone close the blindness. Steps 2 and 3 are what stop it recurring.
