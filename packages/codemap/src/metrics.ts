// Pure quality metrics and the platonic score.
//
// Every field of `CodeMetrics` is a raw count kept alongside the score, deliberately:
// BL-0011 warns against blending dimensions into one number before there is data, so the
// score is a convenience ordering and the counts remain the evidence.
//
// The score is `100 - sum(weight * value)`, clamped to [0, 100] and rounded. `PENALTIES`
// below is the whole formula; tuning it is a data change, not a logic change. Two shapes
// of penalty, chosen so the number means the same thing at every granularity:
//
//  * Rate penalties — occurrences per 100 lines, with a 40-line floor on the denominator.
//    A 600-line file with two `as` casts is cleaner than a 30-line file with two, and the
//    floor stops a tiny file from being annihilated by one hit. Unbounded on purpose: a
//    file that is mostly escape hatches should reach 0.
//  * Budget-fraction penalties — `(value - budget) / value`, i.e. the fraction of the
//    thing that sits beyond its budget, bounded by the weight. Used where the rule states
//    a per-unit ceiling (PS-024 file length, PS-025 export surface) so that summing files
//    into a folder saturates the term instead of exploding it.
//
// Penalty -> rule map: explicit-any PS-001; ts-directive / lint-suppression / as-cast /
// non-null-assertion PS-009; class PS-002; throw PS-003; mutable-binding PS-020;
// file-length PS-024; export-surface PS-025; nesting-depth PS-055; statement-density
// PS-052 (build values with pipelines, not statement sequences).
//
// `parameters` and `nodes` are counted but not penalised — no PS rule sets a parameter or
// AST-size budget, and BL-0011 says keep the raw count rather than invent a threshold. What
// reads them is the size report in `stats.ts`, which describes their distribution instead.
//
// Escape-hatch counts come from `countEscapeHatches` (packages/check/src/ratchet.ts) so the
// browser and `platonic check` can never disagree about what an escape hatch is.
import ts from 'typescript'
import type {
  CodeMetrics,
  FileEntry,
  FolderEntry,
  FunctionMetrics,
} from '../../core/src/index.ts'
import { countEscapeHatches } from '../../check/src/ratchet.ts'
import { toRepoRelative } from './symbols.ts'
import { childrenOf, subtreeNodes } from './walk.ts'

// Everything in CodeMetrics except the derived score.
type MetricCounts = Omit<CodeMetrics, 'platonicScore'>

export const emptyMetrics: CodeMetrics = {
  lines: 0,
  nodes: 0,
  statements: 0,
  maxNestingDepth: 0,
  parameters: 0,
  mutableBindings: 0,
  classes: 0,
  throwStatements: 0,
  explicitAny: 0,
  asCasts: 0,
  nonNullAssertions: 0,
  tsDirectives: 0,
  eslintDisables: 0,
  exportedSymbols: 0,
  imports: 0,
  platonicScore: 100,
}

// ---------------------------------------------------------------------------
// The penalty table.
// ---------------------------------------------------------------------------

type Penalty = {
  readonly label: string
  readonly rule: string
  // Points removed per unit of `value`.
  readonly weight: number
  readonly value: (counts: MetricCounts) => number
}

const RATE_FLOOR_LINES = 40
const LINE_BUDGET = 300
const EXPORT_BUDGET = 15
const NESTING_BUDGET = 3
const STATEMENT_BUDGET = 0.25

const rate = (count: number, lines: number): number =>
  (count * 100) / Math.max(lines, RATE_FLOOR_LINES)

const overBudgetFraction = (value: number, budget: number): number =>
  value <= budget ? 0 : (value - budget) / value

const PENALTIES: readonly Penalty[] = [
  { label: 'explicit-any', rule: 'PS-001', weight: 14, value: (c) => rate(c.explicitAny, c.lines) },
  { label: 'ts-directive', rule: 'PS-009', weight: 14, value: (c) => rate(c.tsDirectives, c.lines) },
  { label: 'eslint-disable', rule: 'PS-009', weight: 10, value: (c) => rate(c.eslintDisables, c.lines) },
  { label: 'as-cast', rule: 'PS-009', weight: 7, value: (c) => rate(c.asCasts, c.lines) },
  { label: 'non-null-assertion', rule: 'PS-009', weight: 7, value: (c) => rate(c.nonNullAssertions, c.lines) },
  { label: 'class', rule: 'PS-002', weight: 15, value: (c) => rate(c.classes, c.lines) },
  { label: 'throw', rule: 'PS-003', weight: 10, value: (c) => rate(c.throwStatements, c.lines) },
  { label: 'mutable-binding', rule: 'PS-020', weight: 6, value: (c) => rate(c.mutableBindings, c.lines) },
  { label: 'file-length', rule: 'PS-024', weight: 20, value: (c) => overBudgetFraction(c.lines, LINE_BUDGET) },
  { label: 'export-surface', rule: 'PS-025', weight: 10, value: (c) => overBudgetFraction(c.exportedSymbols, EXPORT_BUDGET) },
  { label: 'nesting-depth', rule: 'PS-055', weight: 8, value: (c) => Math.max(0, c.maxNestingDepth - NESTING_BUDGET) },
  {
    label: 'statement-density',
    rule: 'PS-052',
    weight: 60,
    value: (c) => Math.max(0, c.statements / Math.max(c.lines, RATE_FLOOR_LINES) - STATEMENT_BUDGET),
  },
]

const scoreCounts = (counts: MetricCounts): number => {
  const penalty = PENALTIES.reduce((sum, entry) => sum + entry.weight * entry.value(counts), 0)
  return Math.round(Math.max(0, Math.min(100, 100 - penalty)))
}

// 0..100. Deterministic function of the counts above.
export const scoreMetrics = (metrics: CodeMetrics): number => scoreCounts(metrics)

const withScore = (counts: MetricCounts): CodeMetrics => ({
  ...counts,
  platonicScore: scoreCounts(counts),
})

// Component-wise sum; platonicScore is recomputed from the summed components.
// `maxNestingDepth` is the one exception: it is a maximum by construction, and summing the
// depths of a hundred files would produce a number no reader could interpret and would peg
// the nesting penalty for every folder.
export const sumMetrics = (metrics: readonly CodeMetrics[]): CodeMetrics =>
  withScore(
    metrics.reduce<MetricCounts>(
      (acc, m) => ({
        lines: acc.lines + m.lines,
        nodes: acc.nodes + m.nodes,
        statements: acc.statements + m.statements,
        maxNestingDepth: Math.max(acc.maxNestingDepth, m.maxNestingDepth),
        parameters: acc.parameters + m.parameters,
        mutableBindings: acc.mutableBindings + m.mutableBindings,
        classes: acc.classes + m.classes,
        throwStatements: acc.throwStatements + m.throwStatements,
        explicitAny: acc.explicitAny + m.explicitAny,
        asCasts: acc.asCasts + m.asCasts,
        nonNullAssertions: acc.nonNullAssertions + m.nonNullAssertions,
        tsDirectives: acc.tsDirectives + m.tsDirectives,
        eslintDisables: acc.eslintDisables + m.eslintDisables,
        exportedSymbols: acc.exportedSymbols + m.exportedSymbols,
        imports: acc.imports + m.imports,
      }),
      emptyMetrics,
    ),
  )

// ---------------------------------------------------------------------------
// AST walking.
// ---------------------------------------------------------------------------

// Nesting is counted in braces: a block, a switch body, a module body. An `if` without
// braces or an arrow with an expression body adds no level, which is the point — the
// signal is indentation you cannot read, not control flow you can.
const increasesNesting = (node: ts.Node): boolean =>
  ts.isBlock(node) || ts.isCaseBlock(node) || ts.isModuleBlock(node)

const nestingDepth = (node: ts.Node, depth: number): number => {
  const here = increasesNesting(node) ? depth + 1 : depth
  return childrenOf(node).reduce((deepest, child) => Math.max(deepest, nestingDepth(child, here)), here)
}

const lineCount = (text: string): number =>
  text.length === 0 ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0)

const isClassNode = (node: ts.Node): boolean =>
  ts.isClassDeclaration(node) || ts.isClassExpression(node)

const mutableBindingCount = (nodes: readonly ts.Node[]): number =>
  nodes
    .filter(ts.isVariableDeclarationList)
    .reduce(
      (sum, list) =>
        sum + ((list.flags & ts.NodeFlags.Const) === 0 ? list.declarations.length : 0),
      0,
    )

const hasExportModifier = (node: ts.Node): boolean =>
  ts.canHaveModifiers(node) &&
  (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)

const exportsOfStatement = (statement: ts.Statement): number =>
  ts.isExportDeclaration(statement)
    ? statement.exportClause !== undefined && ts.isNamedExports(statement.exportClause)
      ? statement.exportClause.elements.length
      : 1
    : ts.isExportAssignment(statement)
      ? 1
      : hasExportModifier(statement)
        ? ts.isVariableStatement(statement)
          ? statement.declarationList.declarations.length
          : 1
        : 0

const exportedSymbolCount = (sourceFile: ts.SourceFile): number =>
  sourceFile.statements.reduce((sum, statement) => sum + exportsOfStatement(statement), 0)

const structuralCounts = (
  nodes: readonly ts.Node[],
): Pick<
  MetricCounts,
  | 'nodes'
  | 'statements'
  | 'parameters'
  | 'mutableBindings'
  | 'classes'
  | 'throwStatements'
  | 'imports'
> => ({
  nodes: nodes.length,
  statements: nodes.filter(ts.isStatement).length,
  parameters: nodes.filter(ts.isParameter).length,
  mutableBindings: mutableBindingCount(nodes),
  classes: nodes.filter(isClassNode).length,
  throwStatements: nodes.filter(ts.isThrowStatement).length,
  imports: nodes.filter(ts.isImportDeclaration).length,
})

export const fileMetrics = (sourceFile: ts.SourceFile, sourceText: string): CodeMetrics =>
  withScore({
    lines: lineCount(sourceText),
    maxNestingDepth: nestingDepth(sourceFile, 0),
    ...structuralCounts(subtreeNodes(sourceFile)),
    ...countEscapeHatches(sourceFile.fileName, sourceText),
    exportedSymbols: exportedSymbolCount(sourceFile),
  })

// ---------------------------------------------------------------------------
// Per-function metrics.
// ---------------------------------------------------------------------------

type FunctionNode =
  | ts.FunctionDeclaration
  | ts.FunctionExpression
  | ts.ArrowFunction
  | ts.MethodDeclaration

type FunctionSite = {
  readonly nameNode: ts.Node
  readonly fn: FunctionNode
}

// Function declarations, methods, and function/arrow initialisers of a variable. A bare
// callback arrow is not a site: it has no name to hang a symbol id on.
const functionSiteOf = (node: ts.Node): FunctionSite | undefined =>
  ts.isFunctionDeclaration(node) && node.name !== undefined
    ? { nameNode: node.name, fn: node }
    : ts.isMethodDeclaration(node)
      ? { nameNode: node.name, fn: node }
      : ts.isVariableDeclaration(node) &&
          node.initializer !== undefined &&
          (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
        ? { nameNode: node.name, fn: node.initializer }
        : undefined

// countEscapeHatches is a text function, so a function's own counts come from re-parsing
// its own source. Modifiers are dropped and the slice is wrapped so the fragment parses
// standalone: a method needs a class shell, everything else parses in parentheses.
const functionSourceText = (sourceFile: ts.SourceFile, fn: FunctionNode): string => {
  const start = fn.modifiers?.end ?? fn.getStart(sourceFile)
  const text = sourceFile.text.slice(start, fn.getEnd())
  return ts.isMethodDeclaration(fn) ? `class Wrapper {${text}\n}` : `(${text})`
}

const lineOf = (sourceFile: ts.SourceFile, position: number): number =>
  sourceFile.getLineAndCharacterOfPosition(position).line + 1

const functionEntry = (
  file: string,
  sourceFile: ts.SourceFile,
  site: FunctionSite,
): FunctionMetrics => {
  const nameStart = site.nameNode.getStart(sourceFile)
  const startLine = lineOf(sourceFile, site.fn.getStart(sourceFile))
  return {
    symbolId: `${file}#${nameStart}`,
    name: site.nameNode.getText(sourceFile),
    line: lineOf(sourceFile, nameStart),
    metrics: withScore({
      lines: lineOf(sourceFile, site.fn.getEnd()) - startLine + 1,
      maxNestingDepth: nestingDepth(site.fn, 0),
      ...structuralCounts(subtreeNodes(site.fn)),
      ...countEscapeHatches(sourceFile.fileName, functionSourceText(sourceFile, site.fn)),
      // Export surface is a property of a module, not of a function body.
      exportedSymbols: 0,
    }),
  }
}

export const functionMetrics = (
  root: string,
  sourceFile: ts.SourceFile,
): readonly FunctionMetrics[] => {
  const file = toRepoRelative(root, sourceFile.fileName)
  return subtreeNodes(sourceFile)
    .map(functionSiteOf)
    .filter((site): site is FunctionSite => site !== undefined)
    .map((site) => functionEntry(file, sourceFile, site))
}

// ---------------------------------------------------------------------------
// Folder rollup.
// ---------------------------------------------------------------------------

// '' (the repo root) plus every ancestor directory of the file, outermost first.
const ancestorFolders = (file: string): readonly string[] =>
  file
    .split('/')
    .slice(0, -1)
    .reduce<readonly string[]>(
      (acc, part) => [...acc, [...acc.slice(-1), part].filter((segment) => segment.length > 0).join('/')],
      [''],
    )

const isWithin = (folder: string, file: string): boolean =>
  folder === '' || file.startsWith(`${folder}/`)

const definedMetrics = (files: readonly FileEntry[]): readonly CodeMetrics[] =>
  files
    .map((entry) => entry.metrics)
    .filter((metrics): metrics is CodeMetrics => metrics !== undefined)

export const folderMetrics = (files: readonly FileEntry[]): readonly FolderEntry[] =>
  [...new Set(files.flatMap((entry) => ancestorFolders(entry.file)))].sort().map((path) => {
    const within = files.filter((entry) => isWithin(path, entry.file))
    return {
      path,
      fileCount: within.length,
      metrics: sumMetrics(definedMetrics(within)),
    }
  })
