// Finding expressions that repeat up to renaming, across a set of files. `shapes.ts` decides
// when two expressions have the same shape; this module asks the repository-scale question
// built on top of it: which shapes occur more than once, and where.
//
// A group of occurrences is a candidate for one function — the shape is its body, the free
// names of each occurrence are its arguments — which is what makes this the input to an
// "extract this expression into a function" step rather than only a duplication report.
//
// Two filters keep the output readable, because without them a repository answers this
// question with thousands of groups.
//
//   * Size. Every sub-expression of a repeated expression repeats too, so the population is
//     dominated by two-node fragments that no one would extract. `minNodes` sets the floor.
//   * Subsumption. When a whole pipeline repeats four times, so does each of its stages, and
//     each stage becomes its own group that says nothing the whole does not already say.
//     A group whose every occurrence sits inside an occurrence of a larger group, and which
//     is no more frequent than that group, is dropped.
import ts from 'typescript'
import { type LiteralMode, expressionShape } from './shapes.ts'
import type { SourceEntry } from './stats.ts'
import { sizedNodes } from './walk.ts'

// One expression, where it was, and what it would need as parameters.
export type ExpressionOccurrence = {
  readonly file: string
  // 1-based, matching what an editor shows.
  readonly line: number
  readonly start: number
  readonly end: number
  readonly nodes: number
  readonly parameters: readonly string[]
  readonly text: string
}

export type ShapedExpression = {
  readonly key: string
  readonly occurrence: ExpressionOccurrence
}

export type ShapeGroup = {
  readonly key: string
  // AST size of the shape. Occurrences can differ by a parenthesis, so this is the smallest.
  readonly nodes: number
  readonly parameterCount: number
  readonly occurrences: readonly ExpressionOccurrence[]
  // Rough AST nodes removed by extracting the group into one function: every occurrence
  // collapses to a call, and one copy of the expression survives as the body. Negative for
  // a small shape with many parameters, where the call is as big as the thing it replaces.
  readonly savedNodes: number
}

export type CloneOptions = {
  readonly minNodes: number
  readonly minOccurrences: number
  readonly literals: LiteralMode
  readonly dropSubsumed: boolean
}

export const defaultCloneOptions: CloneOptions = {
  minNodes: 8,
  minOccurrences: 2,
  literals: 'keep',
  dropSubsumed: true,
}

// ---------------------------------------------------------------------------
// Collecting candidates.
// ---------------------------------------------------------------------------

const occurrenceIn = (
  entry: SourceEntry,
  node: ts.Node,
  nodes: number,
  options: CloneOptions,
): ShapedExpression => {
  const start = node.getStart(entry.sourceFile)
  const shape = expressionShape(node, { literals: options.literals })
  return {
    key: shape.key,
    occurrence: {
      file: entry.file,
      line: entry.sourceFile.getLineAndCharacterOfPosition(start).line + 1,
      start,
      end: node.getEnd(),
      nodes,
      parameters: shape.parameters,
      text: node.getText(entry.sourceFile),
    },
  }
}

// Every expression of at least `minNodes` nodes, in source order, with its shape key.
// Sub-expressions are kept: a repeated fragment inside two otherwise different expressions
// is exactly the case a maximal-expressions-only walk would miss.
export const shapedExpressions = (
  entries: readonly SourceEntry[],
  options: CloneOptions = defaultCloneOptions,
): readonly ShapedExpression[] =>
  entries.flatMap((entry) =>
    sizedNodes(entry.sourceFile)
      // A parenthesized expression is skipped rather than filtered later: it has the same
      // key as the expression inside it, so keeping both would report one occurrence twice.
      .filter(
        (sized) =>
          sized.size >= options.minNodes &&
          ts.isExpression(sized.node) &&
          !ts.isParenthesizedExpression(sized.node),
      )
      .map((sized) => occurrenceIn(entry, sized.node, sized.size, options)),
  )

// ---------------------------------------------------------------------------
// Grouping.
// ---------------------------------------------------------------------------

// Runs of equal keys in a sorted list, found by their start indexes. Sorting and slicing
// costs one pass more than a mutable map would and stays a function of its argument.
const runsOf = (
  sorted: readonly ShapedExpression[],
): readonly (readonly ShapedExpression[])[] => {
  const starts = sorted.flatMap((item, index) =>
    index === 0 || sorted[index - 1]?.key !== item.key ? [index] : [],
  )
  return starts.map((start, nth) => sorted.slice(start, starts[nth + 1] ?? sorted.length))
}

const groupOf = (run: readonly ShapedExpression[]): ShapeGroup => {
  const occurrences = run.map((item) => item.occurrence)
  const nodes = Math.min(...occurrences.map((occurrence) => occurrence.nodes))
  const parameterCount = Math.max(
    ...occurrences.map((occurrence) => occurrence.parameters.length),
  )
  const callCost = 1 + parameterCount
  return {
    key: run[0]?.key ?? '',
    nodes,
    parameterCount,
    occurrences,
    savedNodes: (occurrences.length - 1) * nodes - occurrences.length * callCost,
  }
}

const encloses = (outer: ExpressionOccurrence, inner: ExpressionOccurrence): boolean =>
  outer.file === inner.file &&
  outer.start <= inner.start &&
  outer.end >= inner.end &&
  (outer.start !== inner.start || outer.end !== inner.end)

// A group says nothing new when a bigger shape covers every one of its occurrences and
// repeats at least as often: extracting the bigger shape removes these occurrences too.
const subsumed = (group: ShapeGroup, groups: readonly ShapeGroup[]): boolean =>
  groups.some(
    (other) =>
      other.key !== group.key &&
      other.occurrences.length >= group.occurrences.length &&
      group.occurrences.every((occurrence) =>
        other.occurrences.some((candidate) => encloses(candidate, occurrence)),
      ),
  )

const byValue = (left: ShapeGroup, right: ShapeGroup): number =>
  right.savedNodes - left.savedNodes ||
  right.occurrences.length - left.occurrences.length ||
  left.key.localeCompare(right.key)

// Groups of expressions that share a shape, best candidates first.
export const groupByShape = (
  shaped: readonly ShapedExpression[],
  options: CloneOptions = defaultCloneOptions,
): readonly ShapeGroup[] => {
  const sorted = [...shaped].sort((left, right) => left.key.localeCompare(right.key))
  const repeated = runsOf(sorted)
    .filter((run) => run.length >= options.minOccurrences)
    .map(groupOf)
  const kept = options.dropSubsumed
    ? repeated.filter((group) => !subsumed(group, repeated))
    : repeated
  return [...kept].sort(byValue)
}

// The headline: expressions in these files that have the same shape under different names.
export const repeatedExpressions = (
  entries: readonly SourceEntry[],
  options: CloneOptions = defaultCloneOptions,
): readonly ShapeGroup[] => groupByShape(shapedExpressions(entries, options), options)
