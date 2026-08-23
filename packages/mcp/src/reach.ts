// What sits above a declaration: who calls it, which tests reach it, and both
// at once. `usages` answers "where is this mentioned"; these answer "what
// breaks if I change it".
//
// Three limits are worth stating, because the output looks complete either way.
// A caller is the nearest enclosing function, method, or class, so a reference
// from a top-level initializer or an import statement has no caller at all and
// simply does not appear in the tree. A call made through a value the index could not resolve back to
// the declaration is not a reference at all, so dynamic dispatch is invisible.
// And a test is recognised by its path — a file named `*.test.ts` or any file
// under a `test/` directory — not by what it contains.
import ts from 'typescript'
import type { SymbolInfo, SymbolReference } from '../../core/src/index.ts'
import { explainLookup, usages, type ToolOutput } from './query.ts'
import { ancestorsAtPosition, resolveSymbol, sourceOf, type Workspace } from './workspace.ts'

const TREE_LIMIT = 120

const USE_LIMIT = 20

const BLAST_DEPTH = 3

const located = (symbol: SymbolInfo): string => `${symbol.file}:${symbol.line}`

const cap = (lines: readonly string[], limit: number): readonly string[] =>
  lines.length <= limit ? lines : [...lines.slice(0, limit), `… ${lines.length - limit} more`]

const symbolsById = (workspace: Workspace): ReadonlyMap<string, SymbolInfo> =>
  new Map(workspace.index.symbols.map((symbol) => [symbol.id, symbol]))

const hasFunctionInitializer = (node: ts.VariableDeclaration | ts.PropertyAssignment): boolean =>
  node.initializer !== undefined &&
  (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))

// Only declarations that own a body can be callers. A plain `const` inside a
// function is a named declaration too, and treating it as the owner produced
// call trees made of local variables calling their siblings — the nearest
// *function* is the answer a reader wants.
const nameOfDeclaration = (node: ts.Node): ts.Node | undefined =>
  ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)
    ? node.name
    : ts.isMethodDeclaration(node)
      ? node.name
      : (ts.isVariableDeclaration(node) || ts.isPropertyAssignment(node)) &&
          hasFunctionInitializer(node)
        ? node.name
        : undefined

const enclosingDeclaration = (
  workspace: Workspace,
  byId: ReadonlyMap<string, SymbolInfo>,
  file: string,
  position: number,
): SymbolInfo | undefined => {
  const source = sourceOf(workspace, file)
  if (source === undefined) return undefined
  const owners = ancestorsAtPosition(source, source, position).flatMap((node) => {
    const name = nameOfDeclaration(node)
    if (name === undefined) return []
    const start = name.getStart(source)
    const symbol = byId.get(`${file}#${start}`)
    return symbol === undefined || start === position ? [] : [symbol]
  })
  return owners[owners.length - 1]
}

const usesOf = (workspace: Workspace, symbol: SymbolInfo): readonly SymbolReference[] =>
  workspace.index.references.filter(
    (reference) => reference.symbolId === symbol.id && !reference.isDefinition,
  )

const callersOf = (
  workspace: Workspace,
  byId: ReadonlyMap<string, SymbolInfo>,
  symbol: SymbolInfo,
): readonly SymbolInfo[] => {
  const owners = usesOf(workspace, symbol).flatMap((reference) => {
    const owner = enclosingDeclaration(workspace, byId, reference.file, reference.span.start)
    return owner === undefined ? [] : [owner]
  })
  return [...new Map(owners.map((owner) => [owner.id, owner])).values()]
}

type CallerNode = {
  readonly symbol: SymbolInfo
  readonly recursive: boolean
  readonly children: readonly CallerNode[]
}

// `seen` is the path from the queried symbol down to here, so a name that
// reappears on its own path closes a cycle and stops rather than recursing.
const callerTree = (
  workspace: Workspace,
  byId: ReadonlyMap<string, SymbolInfo>,
  symbol: SymbolInfo,
  depth: number,
  seen: readonly string[],
): readonly CallerNode[] =>
  depth <= 0
    ? []
    : callersOf(workspace, byId, symbol).map((caller) =>
        seen.includes(caller.id)
          ? { symbol: caller, recursive: true, children: [] }
          : {
              symbol: caller,
              recursive: false,
              children: callerTree(workspace, byId, caller, depth - 1, [...seen, caller.id]),
            },
      )

const renderTree = (nodes: readonly CallerNode[], level: number): readonly string[] =>
  nodes.flatMap((node) => [
    `${'  '.repeat(level)}${located(node.symbol)} ${node.symbol.name}${node.recursive ? ' [recursive]' : ''}`,
    ...renderTree(node.children, level + 1),
  ])

const flattenIds = (nodes: readonly CallerNode[]): readonly string[] =>
  nodes.flatMap((node) => [node.symbol.id, ...flattenIds(node.children)])

const countCallers = (nodes: readonly CallerNode[]): number => new Set(flattenIds(nodes)).size

export const callers = (
  workspace: Workspace,
  name: string,
  file: string | undefined,
  depth: number,
): ToolOutput => {
  const lookup = resolveSymbol(workspace, name, file)
  if (!lookup.ok) return explainLookup(name, lookup)
  const levels = Math.max(1, depth)
  const tree = callerTree(workspace, symbolsById(workspace), lookup.symbol, levels, [
    lookup.symbol.id,
  ])
  const header = `callers of ${name} (${located(lookup.symbol)}) — ${countCallers(tree)} callers, depth ${levels}`
  const lines = renderTree(tree, 1)
  return {
    ok: true,
    text: lines.length === 0 ? `${header}\nno callers` : [header, ...cap(lines, TREE_LIMIT)].join('\n'),
  }
}

const isTestFile = (file: string): boolean =>
  file.endsWith('.test.ts') || file.split('/').includes('test')

// A helper that nothing but tests reaches is part of the test scaffolding, so
// the tests reaching it also reach whatever it calls. One level only: past that
// the claim stops being about coverage.
const reachedOnlyFromTests = (workspace: Workspace, symbol: SymbolInfo): boolean => {
  const uses = usesOf(workspace, symbol)
  return uses.length > 0 && uses.every((reference) => isTestFile(reference.file))
}

const coverageLines = (
  workspace: Workspace,
  byId: ReadonlyMap<string, SymbolInfo>,
  symbol: SymbolInfo,
): readonly string[] => {
  const direct = usesOf(workspace, symbol)
    .filter((reference) => isTestFile(reference.file))
    .map((reference) => `${reference.file}:${reference.line} direct`)
  const indirect = callersOf(workspace, byId, symbol)
    .filter((caller) => !isTestFile(caller.file) && reachedOnlyFromTests(workspace, caller))
    .flatMap((caller) =>
      usesOf(workspace, caller)
        .filter((reference) => isTestFile(reference.file))
        .map((reference) => `${reference.file}:${reference.line} via ${caller.name}`),
    )
  return [...direct, ...indirect]
}

export const testsForSymbol = (
  workspace: Workspace,
  name: string,
  file: string | undefined,
): ToolOutput => {
  const lookup = resolveSymbol(workspace, name, file)
  if (!lookup.ok) return explainLookup(name, lookup)
  const lines = coverageLines(workspace, symbolsById(workspace), lookup.symbol)
  const header = `tests for ${name} (${located(lookup.symbol)}) — ${lines.length} tests`
  return {
    ok: true,
    text:
      lines.length === 0
        ? `${header}\nno test reaches ${name}`
        : [header, ...cap(lines, TREE_LIMIT)].join('\n'),
  }
}

export const blastRadius = (
  workspace: Workspace,
  name: string,
  file: string | undefined,
): ToolOutput => {
  const lookup = resolveSymbol(workspace, name, file)
  if (!lookup.ok) return explainLookup(name, lookup)
  const byId = symbolsById(workspace)
  const symbol = lookup.symbol
  const references = workspace.index.references.filter(
    (reference) => reference.symbolId === symbol.id,
  )
  const uses = references.filter((reference) => !reference.isDefinition).length
  const files = new Set(references.map((reference) => reference.file)).size
  const tree = callerTree(workspace, byId, symbol, BLAST_DEPTH, [symbol.id])
  const tests = coverageLines(workspace, byId, symbol)
  const headline = `${name} (${located(symbol)}) — ${uses} uses in ${files} files, ${countCallers(tree)} callers, ${tests.length} tests`
  return {
    ok: true,
    text: [
      headline,
      'uses:',
      ...cap(usages(workspace, name, file).text.split('\n').slice(1), USE_LIMIT),
      'callers:',
      ...cap(renderTree(tree, 1), TREE_LIMIT),
      'tests:',
      ...cap(tests, TREE_LIMIT),
    ].join('\n'),
  }
}
