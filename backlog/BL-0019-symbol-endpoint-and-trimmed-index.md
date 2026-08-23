---
id: BL-0019
title: Give references a symbol envelope and trim the index payload
type: debt
status: ready
priority: p3
effort: M
risk: low
area: codeview
sprint:
created: 2026-08-23
closed:
links: [BL-0016]
---

## Problem
Two consequences of one shape decision in the wave that built the code browser: `CodeIndex`
carries everything, and `SymbolReference` carries almost nothing.

`GET /api/index` serialises to about 2.1 MB on this repository, of which the `symbols` and
`references` arrays — roughly 3,500 and 8,900 entries — are never read by the page. The tree
needs `files` and `folders` only; symbol data is fetched per file.

`SymbolReference` is `{ symbolId, file, span, line, isDefinition }`. It has no name and no
signature. When the browser lists references to a symbol declared in a file that is not on
screen, it has nothing to display but the raw id, and it must fetch that file's entire
`FileView` — source HTML included — purely to learn the symbol's name.

## Impact
Both are harmless at this repository's size and both get worse linearly. The index payload is
the one that will bite first: it is fetched on every page load and on every rebuild after the
five-second time-to-live expires.

## Affected code
- `packages/core/src/index.ts` — `CodeIndex`, `SymbolReference`.
- `packages/codeview/src/server.ts` — the `/api/index` and `/api/references` routes.
- `packages/codeview/src/main.ts` — the providers.
- `packages/codeview/src/ui.ts` — the reference list and the cross-file navigation path.

## Fix approaches
- **Split the index type.** A `CodeOutline` (`files`, `folders`, `generatedAt`, `root`) for the
  tree, with `CodeIndex` staying whole for consumers that want everything — a future MCP server
  among them. `/api/index` serves the outline.
- **Envelope the references.** `/api/references` returns `{ symbol: SymbolInfo, references:
  readonly SymbolReference[] }` instead of a bare array, which is one extra field on the wire
  and removes the whole "fetch a file to learn a name" path.
- **Add `GET /api/symbol?id=`.** Makes hover previews and a symbol search box cheap. Worth doing
  at the same time as the envelope, since both need the same id-to-`SymbolInfo` lookup.
- **Compress instead.** Gzip the index response and change nothing else. Cheapest, and it
  addresses only the payload, not the awkward navigation path.

## Simplest fix
The envelope on `/api/references`, and drop `symbols` and `references` from the `/api/index`
response while leaving the `CodeIndex` type intact — the route trims what it serves rather than
the type changing shape.

- Gets: both problems addressed with no new type and no new endpoint, and the reference list
  starts showing real names.
- Gives up: the route now serves something narrower than its declared return type, which is the
  kind of quiet mismatch that a later reader has to discover. If that is unacceptable, do the
  `CodeOutline` split properly instead.

## Done means
- [ ] `/api/index` no longer ships per-symbol data the page does not read
- [ ] The reference list shows a symbol's name and signature without fetching another file's
      source
- [ ] The index response is under 500 KB on this repository
