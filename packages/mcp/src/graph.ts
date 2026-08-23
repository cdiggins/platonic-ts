// Structure between declarations and between files: who implements what, which
// modules import which, and which exports nobody outside their own file wants.
//
// Two limits shape how the answers should be read. `unusedExports` can only see
// the indexed set, so a symbol consumed by something outside it — a build
// script, a consumer package, a dynamic import — is indistinguishable from a
// dead one; it reports candidates, not verdicts. And `moduleGraph` follows
// relative specifiers only, resolving them against the parsed files; a bare
// package specifier is not an edge, and neither is an import of a file the
// index does not hold.
import ts from 'typescript'
import type { SymbolInfo } from '../../core/src/index.ts'
import { explainLookup, type ToolOutput } from './query.ts'
import { ancestorsAtPosition, lineAt, resolveSymbol, sourceOf, type Workspace } from './workspace.ts'

const LIST_LIMIT = 100

const EDGE_LIMIT = 200

const CYCLE_LIMIT = 20

// Longest cycle searched. The search is exponential in path length, and an
// import cycle worth reporting is short; a longer one is reported as whichever
// shorter cycle it contains, or not at all.
const MAX_CYCLE_LENGTH = 10

const located = (symbol: SymbolInfo): string => `${symbol.file}:${symbol.line}`

const cap = (lines: readonly string[], limit: number): readonly string[] =>
  lines.length <= limit ? lines : [...lines.slice(0, limit), `… ${lines.length - limit} more`]

const inFolder = (file: string, folder: string | undefined): boolean =>
  folder === undefined ||
  folder.length === 0 ||
  file === folder ||
  file.startsWith(`${folder.replace(/\/+$/, '')}/`)

// ---------------------------------------------------------------------------
// implementations
// ---------------------------------------------------------------------------

type ClassLike = ts.ClassDeclaration | ts.InterfaceDeclaration

const isClassLike = (node: ts.Node): node is ClassLike =>
  ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node)

const textOf = (source: ts.SourceFile, node: ts.Node): string =>
  source.text.slice(node.getStart(source), node.end)

const nameOfClassLike = (source: ts.SourceFile, node: ClassLike): string =>
  node.name === undefined ? '(anonymous)' : textOf(source, node.name)

const heritageOf = (source: ts.SourceFile, node: ClassLike): readonly string[] =>
  (node.heritageClauses ?? []).flatMap((clause) =>
    clause.types.map((type) => textOf(source, type.expression)),
  )

const classLikeNamed = (
  source: ts.SourceFile,
  node: ts.Node,
  name: string,
): ClassLike | undefined =>
  isClassLike(node) && node.name !== undefined && textOf(source, node.name) === name
    ? node
    : node
        .getChildren(source)
        .flatMap((child) => {
          const found = classLikeNamed(source, child, name)
          return found === undefined ? [] : [found]
        })[0]

// A heritage reference is the interesting half of `implementations`: the same
// identifier appearing in a type annotation is a use, not an implementation.
const heritageUses = (workspace: Workspace, symbol: SymbolInfo): readonly string[] =>
  workspace.index.references
    .filter((reference) => reference.symbolId === symbol.id && !reference.isDefinition)
    .flatMap((reference) => {
      const source = sourceOf(workspace, reference.file)
      if (source === undefined) return []
      const chain = ancestorsAtPosition(source, source, reference.span.start)
      const clause = chain.filter(ts.isHeritageClause)[0]
      const owners = chain.filter(isClassLike)
      const owner = owners[owners.length - 1]
      if (clause === undefined || owner === undefined) return []
      const keyword = clause.token === ts.SyntaxKind.ImplementsKeyword ? 'implements' : 'extends'
      const kind = ts.isClassDeclaration(owner) ? 'class' : 'interface'
      const line = owner.name === undefined ? reference.line : lineAt(source, owner.name.getStart(source))
      return [`${reference.file}:${line} ${kind} ${nameOfClassLike(source, owner)} ${keyword} ${symbol.name}`]
    })

// A method that overrides another shares its name but not its container, and
// its container names the original's container in a heritage clause. The
// checker resolves the two names to different declarations, so references
// cannot find this — the class's own heritage is the only link.
const overrides = (workspace: Workspace, symbol: SymbolInfo): readonly string[] => {
  const container = symbol.containerName
  if (container === undefined) return []
  return workspace.index.symbols
    .filter(
      (candidate) =>
        candidate.name === symbol.name &&
        candidate.id !== symbol.id &&
        (candidate.kind === 'method' || candidate.kind === 'property') &&
        candidate.containerName !== undefined &&
        candidate.containerName !== container,
    )
    .flatMap((candidate) => {
      const source = sourceOf(workspace, candidate.file)
      const owner =
        source === undefined || candidate.containerName === undefined
          ? undefined
          : classLikeNamed(source, source, candidate.containerName)
      return source === undefined || owner === undefined || !heritageOf(source, owner).includes(container)
        ? []
        : [`${located(candidate)} ${candidate.containerName}.${candidate.name} overrides ${container}.${symbol.name}`]
    })
}

export const implementations = (
  workspace: Workspace,
  name: string,
  file: string | undefined,
): ToolOutput => {
  const lookup = resolveSymbol(workspace, name, file)
  if (!lookup.ok) return explainLookup(name, lookup)
  const lines = [...heritageUses(workspace, lookup.symbol), ...overrides(workspace, lookup.symbol)]
  const header = `implementations of ${name} (${located(lookup.symbol)}) — ${lines.length} found`
  return {
    ok: true,
    text:
      lines.length === 0
        ? `${header}\nnothing extends, implements, or overrides ${name}`
        : [header, ...cap(lines, LIST_LIMIT)].join('\n'),
  }
}

// ---------------------------------------------------------------------------
// moduleGraph
// ---------------------------------------------------------------------------

const specifiersOf = (source: ts.SourceFile): readonly string[] =>
  source.statements.flatMap((statement) =>
    (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) &&
    statement.moduleSpecifier !== undefined &&
    ts.isStringLiteral(statement.moduleSpecifier)
      ? [statement.moduleSpecifier.text]
      : [],
  )

const normalizePath = (path: string): string =>
  path
    .split('/')
    .reduce<readonly string[]>(
      (parts, part) =>
        part === '.' || part === '' ? parts : part === '..' ? parts.slice(0, -1) : [...parts, part],
      [],
    )
    .join('/')

// A specifier may be written with the extension, without it, or as a folder
// standing for its `index.ts`; all three name the same module here.
const resolveSpecifier = (
  workspace: Workspace,
  from: string,
  specifier: string,
): string | undefined => {
  if (!specifier.startsWith('.')) return undefined
  const directory = from.slice(0, from.lastIndexOf('/') + 1)
  const base = normalizePath(`${directory}${specifier}`)
  return [base, base.replace(/\.js$/, '.ts'), `${base}.ts`, `${base}/index.ts`].find((candidate) =>
    workspace.sources.has(candidate),
  )
}

type Graph = ReadonlyMap<string, readonly string[]>

const importGraph = (workspace: Workspace): Graph =>
  new Map(
    [...workspace.sources.entries()].map(([file, source]) => [
      file,
      [
        ...new Set(
          specifiersOf(source).flatMap((specifier) => {
            const target = resolveSpecifier(workspace, file, specifier)
            return target === undefined || target === file ? [] : [target]
          }),
        ),
      ].sort(),
    ]),
  )

// Every elementary cycle, found once: the walk starts at each node and only
// steps to nodes that sort after it, so a cycle is discovered exactly once —
// from its alphabetically first member.
const cyclesFrom = (
  graph: Graph,
  start: string,
  path: readonly string[],
): readonly (readonly string[])[] => {
  const current = path[path.length - 1]
  if (current === undefined) return []
  return (graph.get(current) ?? []).flatMap((next) =>
    next === start
      ? [path]
      : next < start || path.includes(next) || path.length >= MAX_CYCLE_LENGTH
        ? []
        : cyclesFrom(graph, start, [...path, next]),
  )
}

const cyclesIn = (graph: Graph): readonly (readonly string[])[] =>
  [...graph.keys()].sort().flatMap((start) => cyclesFrom(graph, start, [start]))

export const moduleGraph = (workspace: Workspace, folder: string | undefined): ToolOutput => {
  const graph = importGraph(workspace)
  const scoped = [...graph.entries()]
    .filter(([file]) => inFolder(file, folder))
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
  const edges = scoped.flatMap(([file, targets]) => targets.map((target) => `${file} -> ${target}`))
  const cycles = cyclesIn(graph)
  const where = folder === undefined ? 'repo' : folder
  return {
    ok: true,
    text: [
      `${where} — ${scoped.length} files, ${edges.length} import edges; ${cycles.length} cycles repo-wide`,
      ...cap(
        cycles.map((cycle) => `cycle: ${[...cycle, cycle[0] ?? ''].join(' -> ')}`),
        CYCLE_LIMIT,
      ),
      ...cap(edges, EDGE_LIMIT),
    ].join('\n'),
  }
}

// ---------------------------------------------------------------------------
// unusedExports
// ---------------------------------------------------------------------------

export const unusedExports = (workspace: Workspace, folder: string | undefined): ToolOutput => {
  const fileById = new Map(workspace.index.symbols.map((symbol) => [symbol.id, symbol.file]))
  // A mention from another file counts, and a barrel's `export … from` is such
  // a mention: a symbol re-exported through an `index.ts` is used, not dead.
  const usedElsewhere = new Set(
    workspace.index.references
      .filter(
        (reference) =>
          !reference.isDefinition && fileById.get(reference.symbolId) !== reference.file,
      )
      .map((reference) => reference.symbolId),
  )
  const unused = workspace.index.symbols
    .filter(
      (symbol) =>
        symbol.exported &&
        symbol.containerName === undefined &&
        inFolder(symbol.file, folder) &&
        !usedElsewhere.has(symbol.id),
    )
    .slice()
    .sort((left, right) => (left.file === right.file ? left.line - right.line : left.file < right.file ? -1 : 1))
  const where = folder === undefined ? 'repo' : folder
  const files = new Set(unused.map((symbol) => symbol.file)).size
  return {
    ok: true,
    text: [
      `${where} — ${unused.length} exports referenced only in their own file, in ${files} files`,
      ...cap(
        unused.map((symbol) => `${located(symbol)} ${symbol.kind} ${symbol.name}`),
        LIST_LIMIT,
      ),
    ].join('\n'),
  }
}
