// Size distributions over the repository's own code (BL-0027).
//
// This module is the opposite move from `metrics.ts`. That one collapses counts into a
// single score per file; this one keeps every observation and describes the shape of the
// population it forms, so a claim like "the median function is seven lines" is recomputed
// rather than measured by hand once and quoted forever. Nothing here feeds `platonicScore`:
// a score that depended on the rest of the repository would stop meaning anything per file.
//
// Observations are partitioned by the three zones the style guide defines, because pooling
// them describes none of them. Test files are dense with `expect(...)` calls and Root files
// are allowed the mutation and nesting that Core is not, so a median taken across all three
// is an average of populations that were never meant to look alike.
import ts from 'typescript'
import type { FileEntry } from '../../core/src/index.ts'
import { type Summary, summarize } from './summary.ts'
import { type SizedNode, sizedNodes } from './walk.ts'

export type Zone = 'core' | 'root' | 'test'

export type PopulationName =
  | 'function-lines'
  | 'function-nodes'
  | 'function-arity'
  | 'statement-nodes'
  | 'statement-lines'
  | 'expression-nodes'

export const populationNames: readonly PopulationName[] = [
  'function-lines',
  'function-nodes',
  'function-arity',
  'statement-nodes',
  'statement-lines',
  'expression-nodes',
]

// One measured thing: how big it was, and which zone it lives in.
export type Observation = {
  readonly zone: Zone
  readonly value: number
}

// 'all' is reported alongside the zones rather than instead of them: it is the number most
// people quote, and seeing it next to its parts is what shows when it is misleading.
export type ZoneSummary = {
  readonly zone: Zone | 'all'
  readonly summary: Summary | undefined
}

export type PopulationReport = {
  readonly population: PopulationName
  readonly zones: readonly ZoneSummary[]
}

export type SizeReport = {
  readonly fileCount: number
  readonly populations: readonly PopulationReport[]
}

// ---------------------------------------------------------------------------
// Zones.
// ---------------------------------------------------------------------------

// The composition roots named by the style guide's zone table. A file is Root by its own
// name, not by its package, so every package gets the same three-way split.
const rootFileNames: readonly string[] = ['main.ts', 'server.ts', 'io.ts']

const lastSegment = (file: string): string => file.split('/').slice(-1).join('')

// Repo-relative, forward-slashed paths, as `FileEntry.file` and `toRepoRelative` produce.
export const zoneOf = (file: string): Zone =>
  file.includes('/test/')
    ? 'test'
    : rootFileNames.includes(lastSegment(file))
      ? 'root'
      : 'core'

// ---------------------------------------------------------------------------
// Observations.
// ---------------------------------------------------------------------------

type FunctionSizes = {
  readonly lines: readonly Observation[]
  readonly nodes: readonly Observation[]
  readonly arity: readonly Observation[]
}

// Function sizes come straight out of the index: `functionMetrics` already recorded the
// line span, the AST size, and the parameter count of every named function.
export const functionObservations = (files: readonly FileEntry[]): FunctionSizes => {
  const measured = files.flatMap((entry) =>
    entry.functions.map((fn) => ({ zone: zoneOf(entry.file), metrics: fn.metrics })),
  )
  return {
    lines: measured.map(({ zone, metrics }) => ({ zone, value: metrics.lines })),
    nodes: measured.map(({ zone, metrics }) => ({ zone, value: metrics.nodes })),
    arity: measured.map(({ zone, metrics }) => ({ zone, value: metrics.parameters })),
  }
}

// A source file paired with the repo-relative path that decides its zone.
export type SourceEntry = {
  readonly file: string
  readonly sourceFile: ts.SourceFile
}

type NodeSizes = {
  readonly statementNodes: readonly Observation[]
  readonly statementLines: readonly Observation[]
  readonly expressionNodes: readonly Observation[]
}

const lineSpan = (sourceFile: ts.SourceFile, node: ts.Node): number =>
  sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line -
  sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line +
  1

// The population is compound maximal expressions: an expression whose parent is not itself
// an expression, and which is built from more than one node.
//
// Maximal, because counting every sub-expression would make the population mostly
// identifiers and literals and drive the median to one for any codebase; the thing a reader
// reads is the whole pipeline, not each link of it.
//
// Compound, because a maximal expression of exactly one node carries no size information
// and, worse, is usually not a value at all: `ts.isExpression` classifies an identifier by
// its syntax kind rather than its position, so every declared name, property name, and
// name inside a type annotation qualifies. Requiring more than one node removes all of
// them without needing the compiler's internal position test, which is not part of its
// public typings.
const isCompoundExpression = (sized: SizedNode): boolean =>
  sized.size > 1 && ts.isExpression(sized.node) && !ts.isExpression(sized.node.parent)

// Statements are all counted, nested ones included. There is no double counting to undo:
// the compiler does not classify a function body block as a statement, so a body and the
// statements inside it never both appear. Unlike expressions, no statement degenerates to a
// single node, so the whole population is worth describing.
export const nodeObservations = (entries: readonly SourceEntry[]): NodeSizes => {
  const perFile = entries.map(({ file, sourceFile }) => {
    const zone = zoneOf(file)
    const sized = sizedNodes(sourceFile)
    return {
      statements: sized
        .filter(({ node }) => ts.isStatement(node))
        .map(({ node, size }) => ({ zone, size, lines: lineSpan(sourceFile, node) })),
      expressions: sized.filter(isCompoundExpression).map(({ size }) => ({ zone, value: size })),
    }
  })
  return {
    statementNodes: perFile.flatMap(({ statements }) =>
      statements.map(({ zone, size }) => ({ zone, value: size })),
    ),
    statementLines: perFile.flatMap(({ statements }) =>
      statements.map(({ zone, lines }) => ({ zone, value: lines })),
    ),
    expressionNodes: perFile.flatMap(({ expressions }) => expressions),
  }
}

// ---------------------------------------------------------------------------
// The report.
// ---------------------------------------------------------------------------

const zones: readonly (Zone | 'all')[] = ['all', 'core', 'root', 'test']

const valuesIn = (observations: readonly Observation[], zone: Zone | 'all'): readonly number[] =>
  observations
    .filter((observation) => zone === 'all' || observation.zone === zone)
    .map((observation) => observation.value)

const populationReport = (
  population: PopulationName,
  observations: readonly Observation[],
): PopulationReport => ({
  population,
  zones: zones.map((zone) => ({ zone, summary: summarize(valuesIn(observations, zone)) })),
})

// Every population, every zone. `files` supplies the function sizes and `entries` the
// statement and expression sizes; both describe the same set of TypeScript files.
export const sizeReport = (
  files: readonly FileEntry[],
  entries: readonly SourceEntry[],
): SizeReport => {
  const functions = functionObservations(files)
  const nodes = nodeObservations(entries)
  const observations: Record<PopulationName, readonly Observation[]> = {
    'function-lines': functions.lines,
    'function-nodes': functions.nodes,
    'function-arity': functions.arity,
    'statement-nodes': nodes.statementNodes,
    'statement-lines': nodes.statementLines,
    'expression-nodes': nodes.expressionNodes,
  }
  return {
    fileCount: entries.length,
    populations: populationNames.map((name) => populationReport(name, observations[name])),
  }
}
