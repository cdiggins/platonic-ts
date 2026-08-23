// The read-only tools. Each returns finished text: the output is the product,
// and it is written to be read by an agent, so it is dense — one line per fact,
// no framing prose, locations in `file:line` form so they stay clickable.
import type { SymbolInfo, SymbolKind } from '../../core/src/index.ts'
import { declarationText } from './declaration.ts'
import { lineTextAt, resolveSymbol, sourceOf, type SymbolLookup, type Workspace } from './workspace.ts'

export type ToolOutput = {
  readonly ok: boolean
  readonly text: string
}

const failed = (text: string): ToolOutput => ({ ok: false, text })

const located = (symbol: SymbolInfo): string => `${symbol.file}:${symbol.line}`

// A type alias, interface, class, enum, or module already names its kind in its
// own signature; a function or a variable does not.
const declarationOf = (symbol: SymbolInfo): string => {
  const signature = symbol.signature ?? symbol.name
  return signature.startsWith(`${symbol.kind} `) ? signature : `${symbol.kind} ${signature}`
}

const describeSymbol = (symbol: SymbolInfo): string =>
  `${located(symbol)} ${declarationOf(symbol)}`

const withDocLine = (symbol: SymbolInfo, text: string): string =>
  symbol.docLine === undefined ? text : `${text} — ${symbol.docLine}`

export type LookupFailure = Extract<SymbolLookup, { readonly ok: false }>

export const explainLookup = (name: string, lookup: LookupFailure): ToolOutput =>
  lookup.reason === 'not-found'
    ? failed(`no declaration named ${name}. Try search.`)
    : lookup.reason === 'file-not-indexed'
      ? failed(`${name} is declared in ${lookup.candidates[0]?.file ?? 'a file'}, which is not indexed.`)
      : failed(
          [`${name} is declared ${lookup.candidates.length} times; pass file= to choose:`]
            .concat(lookup.candidates.map(describeSymbol))
            .join('\n'),
        )

const outlineOfFile = (
  workspace: Workspace,
  file: string,
  includeNested: boolean,
): readonly string[] => {
  const source = sourceOf(workspace, file)
  if (source === undefined) return [`${file}: not indexed`]
  const symbols = workspace.index.symbols.filter(
    (symbol) =>
      symbol.file.toLowerCase() === file.toLowerCase() &&
      (includeNested || symbol.containerName === undefined),
  )
  const lines = source.text.split('\n').length
  return [`${file} — ${lines} lines, ${symbols.length} declarations`].concat(
    symbols.map(
      (symbol) => `  ${symbol.line} ${symbol.exported ? 'export ' : ''}${declarationOf(symbol)}`,
    ),
  )
}

export const outline = (
  workspace: Workspace,
  files: readonly string[],
  includeNested: boolean,
): ToolOutput => ({
  ok: true,
  text: files.flatMap((file) => outlineOfFile(workspace, file, includeNested)).join('\n'),
})

export const symbolSource = (
  workspace: Workspace,
  name: string,
  file: string | undefined,
): ToolOutput => {
  const lookup = resolveSymbol(workspace, name, file)
  if (!lookup.ok) return explainLookup(name, lookup)
  const source = declarationText(lookup.sourceFile, lookup.symbol)
  return source === undefined
    ? failed(`${name} is indexed at ${located(lookup.symbol)} but has no declaration range.`)
    : { ok: true, text: `${located(lookup.symbol)}\n${source}` }
}

export const usages = (
  workspace: Workspace,
  name: string,
  file: string | undefined,
): ToolOutput => {
  const lookup = resolveSymbol(workspace, name, file)
  if (!lookup.ok) return explainLookup(name, lookup)
  const references = workspace.index.references
    .filter((reference) => reference.symbolId === lookup.symbol.id)
    .slice()
    .sort((left, right) =>
      left.file === right.file ? left.line - right.line : left.file < right.file ? -1 : 1,
    )
  const lines = references.map((reference) => {
    const source = sourceOf(workspace, reference.file)
    const context = source === undefined ? '' : lineTextAt(source, reference.span.start)
    return `${reference.file}:${reference.line}${reference.isDefinition ? ' [def]' : ''} ${context}`
  })
  const files = new Set(references.map((reference) => reference.file))
  const uses = references.filter((reference) => !reference.isDefinition).length
  return {
    ok: true,
    text: [`${name} — ${uses} uses in ${files.size} files`].concat(lines).join('\n'),
  }
}

const kinds: readonly SymbolKind[] = [
  'function', 'variable', 'type', 'interface', 'class', 'enum', 'method', 'property', 'module', 'other',
]

const isKind = (value: string): value is SymbolKind =>
  kinds.some((kind) => kind === value)

const SEARCH_LIMIT = 60

export const search = (
  workspace: Workspace,
  query: string,
  kind: string | undefined,
  includeAll: boolean,
): ToolOutput => {
  if (kind !== undefined && !isKind(kind))
    return failed(`unknown kind ${kind}; one of ${kinds.join(', ')}`)
  const needle = query.toLowerCase()
  const matches = workspace.index.symbols.filter(
    (symbol) =>
      symbol.name.toLowerCase().includes(needle) &&
      (includeAll || symbol.exported) &&
      (kind === undefined || symbol.kind === kind),
  )
  const shown = matches.slice(0, SEARCH_LIMIT)
  const more = matches.length > shown.length ? [`… ${matches.length - shown.length} more`] : []
  return {
    ok: true,
    text: [`${matches.length} matches for "${query}"`]
      .concat(shown.map((symbol) => withDocLine(symbol, describeSymbol(symbol))))
      .concat(more)
      .join('\n'),
  }
}

// Take lines from the front until their cumulative length passes the budget.
const withinBudget = (lines: readonly string[], budget: number): readonly string[] => {
  const totals = lines.reduce<readonly number[]>(
    (sums, line) => sums.concat((sums.at(-1) ?? 0) + line.length + 1),
    [],
  )
  return lines.filter((_, index) => (totals[index] ?? Infinity) <= budget)
}

// Ranked by how often the rest of the repository uses it — plain reference
// counts, not graph centrality. The count is a proxy for "worth knowing about",
// and BL-0028's measurement decides whether the proxy ever misleads here.
const rankedDeclarations = (workspace: Workspace, budget: number): readonly string[] => {
  const uses = workspace.index.references
    .filter((reference) => !reference.isDefinition)
    .reduce(
      (counts: ReadonlyMap<string, number>, reference) =>
        new Map([...counts, [reference.symbolId, (counts.get(reference.symbolId) ?? 0) + 1]]),
      new Map<string, number>(),
    )
  const lines = workspace.index.symbols
    .filter((symbol) => symbol.exported && symbol.containerName === undefined)
    .map((symbol) => ({ symbol, count: uses.get(symbol.id) ?? 0 }))
    .filter((entry) => entry.count > 0)
    .sort((left, right) => right.count - left.count)
    .map((entry) =>
      withDocLine(entry.symbol, `${describeSymbol(entry.symbol)} — ${entry.count} uses`),
    )
  const shown = withinBudget(lines, budget)
  return shown.length === 0
    ? []
    : [`Most-used exports (${shown.length} of ${lines.length}):`].concat(shown)
}

export const DEFAULT_MAP_BUDGET = 4000

// Folders with no measured lines hold documents rather than code; their file
// count is already in the total, and a quality score for them means nothing.
export const repoMap = (workspace: Workspace, budget?: number): ToolOutput => ({
  ok: true,
  text: [`${workspace.index.files.length} files, ${workspace.index.symbols.length} declarations`]
    .concat(
      workspace.index.folders
        .filter((folder) => folder.metrics.lines > 0 && folder.path.length > 0)
        .map(
          (folder) =>
            `${folder.path} — ${folder.fileCount} files, ${folder.metrics.lines} lines, score ${folder.metrics.platonicScore}`,
        ),
    )
    .concat(rankedDeclarations(workspace, budget ?? DEFAULT_MAP_BUDGET))
    .join('\n'),
})
