// What every tool reads: the code index plus the parsed files it was built
// from. Symbol lookup lives here because "which declaration did you mean" is
// the one question every tool asks first.
import ts from 'typescript'
import type { CodeIndex, SymbolInfo } from '../../core/src/index.ts'

// The indexed codebase with its symbol and import metadata.
export type Workspace = {
  readonly index: CodeIndex
  // Repo-relative path (forward slashes, as the index keys it) -> parsed file.
  readonly sources: ReadonlyMap<string, ts.SourceFile>
}

// The result of looking up a symbol by name: either found with source file, or details of the failure.
export type SymbolLookup =
  | { readonly ok: true; readonly symbol: SymbolInfo; readonly sourceFile: ts.SourceFile }
  | { readonly ok: false; readonly reason: 'not-found' | 'ambiguous' | 'file-not-indexed'; readonly candidates: readonly SymbolInfo[] }

// Retrieve the parsed source file for a file path, with case-insensitive fallback.
export const sourceOf = (workspace: Workspace, file: string): ts.SourceFile | undefined =>
  workspace.sources.get(file) ?? workspace.sources.get(file.toLowerCase())

// A file hint matches on path suffix, so `symbols.ts` and the full
// `packages/codemap/src/symbols.ts` both work.
const matchesFile = (symbol: SymbolInfo, file: string | undefined): boolean =>
  file === undefined ||
  symbol.file.toLowerCase() === file.toLowerCase() ||
  symbol.file.toLowerCase().endsWith(`/${file.toLowerCase()}`)

// Exported declarations win outright: a local of the same name in another file
// is almost never what a caller meant, and reporting it as ambiguous would make
// the common case need a disambiguator.
const preferExported = (matches: readonly SymbolInfo[]): readonly SymbolInfo[] => {
  const exported = matches.filter((symbol) => symbol.exported)
  return exported.length > 0 ? exported : matches
}

// Find declarations with a given name, optionally filtering by file.
export const findSymbols = (
  workspace: Workspace,
  name: string,
  file: string | undefined,
): readonly SymbolInfo[] =>
  preferExported(
    workspace.index.symbols.filter(
      (symbol) => symbol.name === name && matchesFile(symbol, file),
    ),
  )

// Look up a named symbol, returning its definition and source file, or why it could not be resolved.
export const resolveSymbol = (
  workspace: Workspace,
  name: string,
  file: string | undefined,
): SymbolLookup => {
  const matches = findSymbols(workspace, name, file)
  const first = matches[0]
  if (first === undefined) return { ok: false, reason: 'not-found', candidates: [] }
  if (matches.length > 1) return { ok: false, reason: 'ambiguous', candidates: matches }
  const sourceFile = sourceOf(workspace, first.file)
  return sourceFile === undefined
    ? { ok: false, reason: 'file-not-indexed', candidates: matches }
    : { ok: true, symbol: first, sourceFile }
}

// Outermost-to-innermost chain of nodes containing `position`. Computed by
// walking down rather than by reading `node.parent`, because parent pointers on
// a program's source files exist only after the checker has bound them.
export const ancestorsAtPosition = (
  sourceFile: ts.SourceFile,
  node: ts.Node,
  position: number,
): readonly ts.Node[] => {
  const child = node
    .getChildren(sourceFile)
    .find((candidate) => candidate.getStart(sourceFile) <= position && position < candidate.end)
  return child === undefined ? [node] : [node, ...ancestorsAtPosition(sourceFile, child, position)]
}

// Compute the one-indexed line number containing a character position.
export const lineAt = (sourceFile: ts.SourceFile, position: number): number =>
  sourceFile.getLineAndCharacterOfPosition(position).line + 1

// Extract the text of the line containing a character position, trimmed and newline-free.
export const lineTextAt = (sourceFile: ts.SourceFile, position: number): string => {
  const { line } = sourceFile.getLineAndCharacterOfPosition(position)
  const starts = sourceFile.getLineStarts()
  const start = starts[line] ?? 0
  const end = starts[line + 1] ?? sourceFile.text.length
  return sourceFile.text.slice(start, end).replace(/\r?\n$/, '').trim()
}
